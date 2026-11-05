import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';
import { interactionRecords } from '../src/core/a11y/records';
import { claimsForChart } from '../src/core/claims';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';

// A creative card was refused with "size-below-floor" at a full and a half slide canvas (888 × 396 pt and
// 432 × 396 pt), although its content fits once it takes three columns or moves its method lines to frame.notes.
const { data, options } = getFixtures('creative').find((entry) => entry.id === 'creative-image-fatigue')!;
const draw = (width: string, height: string) => render({ spec: { type: 'creative', data, options }, format: 'svg', target: 'slide', width, height }).body as any;

describe('creative card on a short slide canvas', () => {
  it('draws the full slide in three columns with every label', () => {
    const body = draw('888pt', '396pt');
    expect(body.ok).toBe(true);
    expect(body.warnings.filter((warning: any) => warning.code === 'label-hidden')).toEqual([]);
    expect(body.reading.omissions ?? []).toEqual([]);
  });

  it('draws the half slide with its method lines in the notes', () => {
    const body = draw('432pt', '396pt');
    expect(body.ok).toBe(true);
    expect(body.warnings.filter((warning: any) => warning.code === 'label-hidden')).toEqual([]);
    expect(body.notes.some((note: any) => note.kind === 'method')).toBe(true);
  });

  // A narrower fallback column can overflow its text; that threw creative-text-overflow where main returns a size refusal with a repair.
  it('refuses with a size repair when a fallback column overflows its text', () => {
    const body = render({ spec: { type: 'creative', data, options: { ...options, textScale: 1.5 } }, format: 'svg', target: 'slide', width: '900', height: '800' }).body as any;
    expect(body.errors.map((error: any) => error.code)).toEqual(['size-below-floor']);
  });

  it('keeps the two-column form where it fits', () => {
    const body = draw('720pt', '560pt');
    expect(body.ok).toBe(true);
    expect(body.notes.some((note: any) => note.kind === 'method')).toBe(false);
  });
});

describe('creative columns and rows', () => {
  const records = (extra: object) => {
    const request = resolveChartRequest({ type: 'creative', data, options: { ...options, ...extra } } as never);
    const geometry = layoutResolvedRequest(request);
    const claims = claimsForChart('creative', geometry as never);
    return interactionRecords({ request, geometry, claims } as never);
  };
  const metric = (list: ReturnType<typeof records>, id: string) => list.find((record) => record.id.includes(`\\"${id}\\"`));
  // A hidden row must leave the records, because hover, keyboard order and the data table all read them.
  it('pushes no record for a hidden row and keeps the fatigue record', () => {
    const list = records({ rowVisibility: { ctr: false } });
    expect(metric(list, 'ctr')).toBeUndefined();
    expect(metric(list, 'fatigue')).toBeDefined();
  });
  // A hidden column must not come back in the hover card.
  it('drops the hidden median from the hover fields, and leads with the median when the value is hidden', () => {
    expect(metric(records({ columnVisibility: { median: false } }), 'cpa')!.fields.map((field) => field.key)).not.toContain('accountMedian');
    const shown = metric(records({ columnVisibility: { value: false } }), 'cpa')!;
    expect(shown.value.raw).toBe(data.metrics.cpa.accountMedian);
    expect(shown.fields.map((field) => field.key)).not.toContain('accountMedian');
  });
  // The hover must print the number the card prints.
  it('reads the hover change as the card prints it', () => {
    const field = metric(records({ columnVisibility: { median: false } }), 'cpa')!.fields.find((entry) => entry.key === 'delta')!;
    expect(field.value.displayed).toBe('\u221214%');
    expect(metric(records({ columnVisibility: { value: false, median: false } }), 'cpa')!.value.displayed).toBe('\u221214%');
  });
  // A rename must read the same in the card and in the hover and data table.
  it('carries renames into the record', () => {
    const shown = metric(records({ rowOverrides: { cpa: { label: 'Cost' } }, columnOverrides: { value: { label: 'This ad' } } }), 'cpa')!;
    expect(shown.label).toBe('Cost');
    expect(shown.valueLabel).toBe('This ad');
  });
  const layout = (extra: object) => {
    const body = render({ spec: { type: 'creative', data, options: { ...options, ...extra } }, format: 'svg' } as never).body as any;
    return { body, codes: body.warnings.map((warning: any) => warning.code) as string[] };
  };
  const words = (svg: string) => svg.replace(/<[^>]+>/g, ' ');
  // Hiding the change must not leave its head or colour key, and the fatigue rule must still read the hidden columns.
  it('takes the head and the colour key with the change, and keeps the fatigue verdict', () => {
    const { body } = layout({ columnVisibility: { delta: false, value: false } });
    expect(words(body.svg)).not.toContain('vs median');
    expect(words(body.svg)).not.toContain('Highlighted');
    expect(words(body.svg)).toContain('Median basis');
    expect(words(body.svg)).toContain(words(layout({}).body.svg).includes('fatigue rule met') ? 'fatigue rule met' : 'fatigue rule');
  });
  // A hidden metric must leave no row, while a missing one keeps printing n/a.
  it('leaves a hidden metric out, and warns on an id it does not know', () => {
    const { body, codes } = layout({ rowVisibility: { ctr: false, nope: false } });
    expect(body.svg).not.toContain('>CTR<');
    expect(codes).toContain('generated-id-unknown');
  });
  it('warns and keeps the label column', () => {
    const { body, codes } = layout({ columnVisibility: { label: false } });
    expect(words(body.svg)).toContain('Metric');
    expect(codes).toContain('generated-name-column-kept');
  });
  // Authored widths too large for the table must warn and never refuse.
  it('caps a width that does not fit', () => {
    const { body, codes } = layout({ columnOverrides: { value: { width: 3000 } } });
    expect(body.ok).toBe(true);
    expect(codes).toContain('generated-column-width-capped');
  });
});
