import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { render } from '../src/cli/render';
import type { Geometry } from '../src/core/types/scene';

const fixture = (type: string, id: string) => getFixtures(type as never).find((item) => item.id === id)!;
const draw = (type: string, id: string, options: object) => {
  const item = fixture(type, id);
  return layoutResolvedRequest(resolveChartRequest({ type: type as never, data: item.data as never, options: { ...item.options, ...options } as never }));
};
const codes = (type: string, id: string, options: object) => draw(type, id, options).warnings.map((warning) => warning.code);
const wide = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, { width: 5000 }]));

describe('authored column widths', () => {
  // Widths that fit one by one squeezed the likert bars out together, and the chart asked for a canvas 10,000 px wide.
  it('never refuses a chart for a wide width, alone or together', () => {
    const cases: [string, string, string[], object][] = [
      ['likert', 'column-overrides', ['label', 'net', 'base'], {}],
      ['bullet', 'column-overrides', ['label', 'actual', 'target', 'gap'], {}],
      ['funnel', 'column-overrides', ['label', 'totalCvr'], {}],
      ['funnel', 'column-overrides', ['label', 'value'], { variant: 'rows' }],
    ];
    for (const [type, id, ids, options] of cases) {
      for (const width of [320, 480, 800]) {
        const unset = draw(type, id, { ...options, columnOverrides: undefined, size: { width } });
        const authored = draw(type, id, { ...options, columnOverrides: wide(ids), size: { width } });
        expect(`${type} ${width} ${Boolean(authored.refused)}`).toBe(`${type} ${width} ${Boolean(unset.refused)}`);
      }
    }
  });

  // A cap the author does not hear about looks like the option did nothing.
  it('warns when a wide width stops at the plot floor', () => {
    expect(codes('dot', 'column-overrides', { columnOverrides: { label: { width: 5000 } } })).toContain('column-width-capped');
  });

  // The diverging slope has no change column, so a width there would do nothing without a word.
  it('refuses columnOverrides on the diverging slope', () => {
    const slope = fixture('slope', 'diverging-sort-data');
    expect(() => layoutResolvedRequest(resolveChartRequest({ type: 'slope', data: slope.data as never, options: { ...slope.options, columnOverrides: { change: { width: 60 } } } as never }))).toThrow();
    const result = render({ spec: { type: 'slope', data: slope.data, options: { ...slope.options, columnOverrides: { change: { width: 60 } } } } } as never);
    expect(result.exit).not.toBe(0);
  });
});

describe('bullet columns', () => {
  // An id in the warning's field path crashed the render as an invalid JSON array index.
  it('warns with the list for ids the current form does not draw', () => {
    const result = draw('bullet', 'column-overrides', { columnOverrides: undefined, columnVisibility: { share: false }, columnOrder: ['delta', 'plot'] });
    const unknown = result.warnings.filter((warning) => warning.code === 'generated-id-unknown');
    expect(unknown.map((warning) => warning.field?.[1])).toEqual(expect.arrayContaining(['columnVisibility', 'columnOrder']));
    expect(unknown[0]!.message).toContain('gap');
  });

  // Without the number and without the warning, the reader cannot tell what the target tick stands for.
  it('warns when the target column leaves the tick unexplained', () => {
    expect(codes('bullet', 'column-overrides', { columnOverrides: undefined, columnVisibility: { target: false } })).toContain('bullet-target-column-hidden');
  });

  // Two spellings of one request must draw the same rows, or authors get different charts for the same wish.
  it('draws strings.lowerBetter empty like labels.direction false on lower-is-better rows', () => {
    const item = fixture('bullet', 'no-direction-line');
    const lower = { ...item.data as object, rows: (item.data as { rows: object[] }).rows.map((row) => ({ ...row, direction: 'lowerIsBetter' })) };
    const scene = (options: object) => JSON.stringify((layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: lower as never, options: { ...item.options, labels: undefined, ...options } as never })) as Geometry).scene);
    expect(scene({ strings: { lowerBetter: '' } })).toBe(scene({ labels: { direction: false } }));
  });
});
