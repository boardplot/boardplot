import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli/main';
import { DocumentSchemaError } from '../src/core/doc/document';
import { parseChartSpec, BoardplotSpecError } from '../src/react/prepare';
import { specSettings } from '../src/react/parseChartSpec';
import { getFixtures } from '../src/fixtures';

const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function cliValidate(document: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'boardplot-spec-errors-'));
  directories.push(directory);
  const source = join(directory, 'document.json');
  writeFileSync(source, JSON.stringify(document));
  const output: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...values) => output.push(values.join(' ')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const code = main(['render', source]);
  vi.restoreAllMocks();
  return { code, envelope: JSON.parse(output.join('\n')) as { errors: unknown[] } };
}

// A text such as "1.234" can be a thousands mark, so it stays refused; "12" is read as a number.
const invalidData = {
  version: 1,
  charts: [{
    name: 'volume',
    type: 'column',
    data: { categories: ['A'], series: [{ id: 's', values: ['1.234'] }] },
  }],
};

async function captured(action: () => unknown): Promise<BoardplotSpecError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(BoardplotSpecError);
    return error as BoardplotSpecError;
  }
  throw new Error('Expected BoardplotSpecError');
}

describe('structured spec errors', () => {
  it('publishes CLI-equivalent invalid-data diagnostics without copying their objects', async () => {
    const cli = cliValidate(invalidData);
    const error = await captured(() => parseChartSpec(invalidData));

    expect(cli.code).toBe(1);
    expect(error.name).toBe('BoardplotSpecError');
    expect(error).toBeInstanceOf(DocumentSchemaError);
    expect(error.errors).toBe(error.envelopeErrors);
    expect(error.errors[0]).toBe(error.envelopeErrors[0]);
    expect(error.errors).toEqual(cli.envelope.errors);
    expect(error.message).toContain('/charts/0/data/series/0/values/0');
    expect(error.message).toContain('Expected:');
    expect(error.message).toContain('Fix: Replace /charts/0/data/series/0/values/0 with 1.234.');
    expect(error.message).not.toContain('alternatives');
    expect(error.errors[0]).toMatchObject({
      code: 'invalid-data',
      path: '/charts/0/data/series/0/values/0',
      expected: expect.any(Object),
      suggest: expect.any(String),
      fix: expect.any(Array),
    });
  });

  it('uses the public error for invalid host settings and chart selection', async () => {
    const host = await captured(() => specSettings({ size: 'wrong' as never }));
    expect(host.errors[0]).toMatchObject({
      code: 'invalid-react-options',
      path: '/size',
      expected: expect.any(Object),
    });

    const document = { version: 1, charts: [
      { ...invalidData.charts[0], name: 'West', data: { categories: ['A'], series: [{ id: 's', values: [12] }] } },
      { ...invalidData.charts[0], name: 'East', data: { categories: ['A'], series: [{ id: 's', values: [13] }] } },
    ] };
    const required = await captured(() => parseChartSpec(document));
    expect(required.errors[0]).toMatchObject({
      code: 'chart-selection-required',
      path: '/chart',
      expected: { values: ['West', 'East'] },
      suggest: 'Pass chart with one of the expanded chart names.',
    });
    const missing = await captured(() => parseChartSpec(document, 'North'));
    expect(missing.errors[0]).toMatchObject({ code: 'chart-not-found', path: '/chart' });
  });

  it('reads valueLine text as label with a rename patch', async () => {
    const chart = (annotation: Record<string, unknown>) => ({
      type: 'column',
      data: { categories: ['A', 'B'], series: [{ id: 's', values: [12, 14] }] },
      annotations: [annotation],
    });
    const valueLine = await parseChartSpec(chart({ kind: 'valueLine', value: 13, text: 'Target' }));
    expect(valueLine.warnings.find(warning => warning.code === 'annotation-text-as-label')).toMatchObject({
      code: 'annotation-text-as-label',
      path: '/charts/0/annotations/0/text',
      fix: [
        { op: 'test', path: '/charts/0/annotations/0', value: { kind: 'valueLine', value: 13, text: 'Target' } },
        { op: 'replace', path: '/charts/0/annotations/0', value: { kind: 'valueLine', value: 13, label: 'Target' } },
      ],
    });
    const both = await captured(() => parseChartSpec(chart({ kind: 'valueLine', value: 13, text: 'Target', label: 'Plan' })));
    expect(both.errors[0]).toMatchObject({ path: '/annotations/0/text', fix: [{ op: 'remove', path: '/annotations/0/text' }] });
    const indicator = await captured(() => parseChartSpec(chart({ kind: 'indicator100', text: 'Full' })));
    expect(indicator.errors[0]).toMatchObject({ path: '/annotations/0/text', fix: [{ op: 'remove', path: '/annotations/0/text' }] });
    // A band or event caption given as text was dropped without a warning: they print label only.
    for (const annotation of [{ kind: 'band', from: 'A', to: 'B', text: 'Forecast' }, { kind: 'event', at: 'B', text: 'Launch' }]) {
      const read = await parseChartSpec(chart(annotation));
      const { text, ...rest } = annotation;
      expect(read.warnings.find(warning => warning.code === 'annotation-text-as-label'), annotation.kind).toMatchObject({
        path: '/charts/0/annotations/0/text', fix: [{ op: 'test' }, { op: 'replace', value: { ...rest, label: text } }],
      });
      const conflict = await captured(() => parseChartSpec(chart({ ...annotation, label: 'Plan' })));
      expect(conflict.errors[0], annotation.kind).toMatchObject({ path: '/annotations/0/text', fix: [{ op: 'remove', path: '/annotations/0/text' }] });
    }
  });

  it('carries the object shape and the way out of a refused key into React as the CLI prints them', async () => {
    const chart = (type: string, data: unknown, options: object) => ({ version: 1, charts: [{ name: 'c', type, data, options }] });
    const waterfall = chart('waterfall', getFixtures('waterfall')[0]!.data, { valueAxis: { break: true } });
    const slope = chart('slope', getFixtures('slope')[0]!.data, { valueAxis: { reverse: true } });
    for (const document of [waterfall, slope]) {
      expect((await captured(() => parseChartSpec(document))).errors).toEqual(cliValidate(document).envelope.errors);
    }
    expect((await captured(() => parseChartSpec(waterfall))).message).toContain('required from (number), to (number); optional style (\'straight\'); break requires from < to');
    expect((await captured(() => parseChartSpec(slope))).errors[0]).toMatchObject({ suggest: expect.stringContaining("options.variant 'bump'") });
  });

  it('does not mutate inputs and preserves unexpected internal errors', async () => {
    const before = JSON.stringify(invalidData);
    await captured(() => parseChartSpec(invalidData));
    expect(JSON.stringify(invalidData)).toBe(before);

    const unexpected = new Error('unexpected');
    const hostile = new Proxy({}, { ownKeys: () => { throw unexpected; } });
    await expect(parseChartSpec(hostile)).rejects.toBe(unexpected);
  });

  // A root theme that is neither a string nor a plain object crashed at layout on null and was silently ignored on numbers, booleans and arrays.
  it('refuses a non-string, non-object root theme at /theme before layout in both CLI and React', async () => {
    const bare = {
      type: 'column',
      data: { categories: [{ id: 'n', label: 'North' }, { id: 's', label: 'South' }], series: [{ id: 'v', label: 'Visits', values: [12, 19] }] },
      options: { title: 'Visits by area' },
    };
    for (const theme of [null, 5, false, ['editorial']]) {
      for (const document of [{ ...bare, theme }, { version: 1, theme, charts: [{ name: 'visits', ...bare }] }]) {
        const cli = cliValidate(document);
        const error = await captured(() => parseChartSpec(document));
        expect(cli.code).toBe(1);
        expect(error.errors).toEqual(cli.envelope.errors);
        expect(error.errors).toEqual([expect.objectContaining({
          code: 'invalid-theme',
          path: '/theme',
          message: expect.stringContaining('{ preset, overrides }'),
        })]);
        expect(error.errors[0]!.message).toContain('preset name');
        expect(error.errors[0]!.message).toContain('full theme object');
        expect(error.errors[0]!.message).toContain('{ overrides }');
      }
    }
  });
});
