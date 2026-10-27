import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutButterfly } from '../src/core/charts/butterfly/layout';
import { measure } from '../src/core/request';
import { getChart } from '../src/core/registry';
// @ts-expect-error The scorecard script has no declaration file.
import { applyRepair } from '../scripts/layout-scorecard.mjs';

// An all-zero pane must not flatten the nonzero pane or make a both-zero chart non-finite.
it('fits a shared butterfly scale from the panes with a nonzero extent', () => {
  const draw = (a: number[], b: number[], sharedScale = true) => layoutButterfly({
    categories: [{ id: 'x' }, { id: 'y' }], series: [{ id: 'a', values: a }, { id: 'b', values: b }],
  }, { a: 'a', b: 'b', sharedScale, size: { width: 960, height: 540 } });
  for (const [a, b, side] of [[[0, 0], [10, 20], 'right'], [[10, 20], [0, 0], 'left']] as const) {
    const g = draw([...a], [...b]);
    const widths = g.marks[side].map((m) => m.rect.w);
    expect(widths[0]).toBeGreaterThan(20);
    expect(widths[1]! / widths[0]!).toBeCloseTo(2);
    expect(widths).toEqual(draw([...a], [...b], false).marks[side].map((m) => m.rect.w));
  }
  const empty = draw([0, 0], [0, 0]);
  expect([...empty.marks.left, ...empty.marks.right].every((m) => Object.values(m.rect).every(Number.isFinite))).toBe(true);
});

// Prevents either unit-conflict fix from leaving the other unit conflict in place.
it('repairs the shared scale and the difference sort together', () => {
  const request = { type: 'butterfly', data: {
    categories: ['North', 'South'], series: [
      { id: 'a', label: 'People', unit: 'FTE', values: [12, 18] },
      { id: 'b', label: 'Revenue', unit: 'EUR', values: [120, 90] },
    ],
  }, options: { a: 'a', b: 'b', sortBy: 'diff', size: { width: 720 } } };
  for (const result of [measure(request).refused!, getChart('butterfly')!.layout(request.data, request.options)]) {
    const warnings = result.warnings.filter(w => w.code === 'unit-conflict');
    expect(warnings).toHaveLength(2);
    for (const warning of warnings) {
      const repaired = measure(applyRepair(request, warning.fix));
      expect(repaired.geometry).toBeDefined();
      expect(repaired.warnings.filter(w => w.severity !== 'info')).toEqual([]);
    }
  }
});
