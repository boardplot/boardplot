/**
 * Annotation fields and category dates are checked where the spec is parsed:
 * a misspelt key, a missing or malformed anchor and a date the time axis
 * cannot read are refused at their field, never dropped or thrown later.
 */
import { describe, expect, it } from 'vitest';
import { BoardplotSpecError } from '../src/react/prepare';
import { beginSpecParse } from '../src/react/specValidation';
import { render } from '../src/cli/render';

const column = (annotation: Record<string, unknown>) => ({
  type: 'column',
  data: {
    categories: [{ id: 'y19', label: '2019' }, { id: 'y21', label: '2021' }, { id: 'y23', label: '2023' }],
    series: [{ id: 's', values: [100, 110, 160] }],
  },
  annotations: [annotation],
});

function errors(spec: unknown) {
  // The CLI import registers every schema, so the React spec parse finishes without loading any.
  try {
    beginSpecParse(spec).finish();
  } catch (error) {
    expect(error).toBeInstanceOf(BoardplotSpecError);
    return (error as BoardplotSpecError).errors;
  }
  return [];
}

// An empty tolerance caption must fail at its option instead of drawing an unnamed band.
it('refuses an empty value-line range caption through the schema', () => {
  const spec = { ...column({ kind: 'valueLine', value: 120, tolerance: 5 }), options: { strings: { valueLineRange: '' } } };
  expect(errors(spec)[0]).toMatchObject({
    path: '/options/strings/valueLineRange',
    message: expect.stringContaining('must not be empty'),
  });
});

describe('annotation fields', () => {
  // A category label used as an anchor must identify the failed fields and the IDs that the caller can use.
  it('names unmatched band anchors and valid category ids', () => {
    const body = render({ spec: column({ kind: 'band', from: '2019', to: '2021', label: 'Phase' }), return: ['svg'] }).body as {
      warnings: { code: string; severity: string; message: string }[];
    };
    const warning = body.warnings.find(w => w.code === 'bad-anchor');
    expect(warning).toMatchObject({ severity: 'warn' });
    expect(warning?.message).toContain("'2019'");
    expect(warning?.message).toContain("'2021'");
    expect(warning?.message).toContain('valid category ids: y19, y21, y23');
  });

  it('refuses a misspelt key with the rename, instead of falling back to a default', () => {
    expect(errors(column({ kind: 'cagr', form: 'y21', to: 'y23' }))[0]).toMatchObject({
      code: 'invalid-annotation',
      path: '/annotations/0/form',
      suggest: "Rename 'form' to 'from'.",
      fix: [
        { op: 'test', path: '/annotations/0', value: { kind: 'cagr', form: 'y21', to: 'y23' } },
        { op: 'replace', path: '/annotations/0', value: { kind: 'cagr', from: 'y21', to: 'y23' } },
      ],
    });
    expect(errors(column({ kind: 'diff', from: 'y19', to: 'y23', Mode: 'absolute' }))[0]).toMatchObject({ path: '/annotations/0/Mode', suggest: "Rename 'Mode' to 'mode'." });
    expect(errors(column({ kind: 'callout', at: 'y19', text: 't', arow: true }))[0]).toMatchObject({ path: '/annotations/0/arow' });
    expect(errors(column({ kind: 'band', from: 'y19', to: 'y21', lable: 'x' }))[0]).toMatchObject({ path: '/annotations/0/lable' });
    expect(errors(column({ kind: 'cagr', from: 'y21', to: 'y23' }))).toEqual([]);
  });

  it('refuses a misspelt key inside an object anchor, which fell back to the first series', () => {
    expect(errors(column({ kind: 'diff', from: { categoryId: 'y19', seriesID: 's' }, to: { categoryId: 'y23', seriesId: 's' } }))).toMatchObject([
      { code: 'invalid-annotation', path: '/annotations/0/from/seriesID', suggest: "Rename 'seriesID' to 'seriesId'." },
    ]);
  });

  it('names a missing or malformed anchor at its field instead of throwing a TypeError', () => {
    for (const annotation of [{ kind: 'callout', text: 'hi' }, { kind: 'diff', from: 'y19' }, { kind: 'abs', anchor: 'y19' }]) {
      const found = errors(column(annotation));
      expect(found.map((error) => error.code)).not.toContain('layout-error');
      expect(found.at(-1)).toMatchObject({ code: 'invalid-annotation', path: expect.stringMatching(/^\/annotations\/0\/(at|to)$/) });
    }
    expect(errors(column({ kind: 'note', text: 'hi', at: null }))[0]).toMatchObject({ path: '/annotations/0/at' });
    expect(errors(column({ kind: 'valueLine', value: 'abc' }))[0]).toMatchObject({ path: '/annotations/0/value' });
    expect(errors(column({ kind: 'delta', at: 'y19', vs: 5 }))).toEqual([]);
  });
});

it('refuses a category date the time axis cannot read', () => {
  const line = (date: string) => ({
    type: 'line',
    data: {
      categories: [{ id: 'a', date: '2020-01-01' }, { id: 'b', date: '2020-02-01' }, { id: 'c', date }],
      series: [{ id: 's', values: [1, 2, 3] }],
    },
  });
  expect(errors(line('2024-1-1'))[0]).toMatchObject({ code: 'invalid-data', path: '/data/categories/2/date' });
  expect(errors(line('2024-01-01'))).toEqual([]);
});
