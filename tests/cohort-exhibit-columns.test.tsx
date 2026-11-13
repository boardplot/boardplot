// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';
import { cohortOptionsSchema } from '../src/core/charts/cohort';
import { layoutCohort } from '../src/core/charts/cohort/layout';
import type { CohortData, CohortMarks, CohortDerived, CohortOptions } from '../src/core/charts/cohort/types';
import { CohortChart } from '../src/react/charts/cohort';
import type { Geometry } from '../src/core/types/scene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: CohortData = {
  periodLabel: 'Month',
  cohorts: [
    { id: 'a', label: 'Early signups', active: [1000, 700, 600, 500] },
    { id: 'b', label: 'Later signups', active: [800, 600, 500] },
    { id: 'c', label: 'Newest signups', active: [600, 480] },
  ],
};
const layout = (options: CohortOptions, chart = data) => layoutCohort(chart, options) as Geometry<CohortMarks, CohortDerived>;
const warning = (options: CohortOptions, code: string) => layout(options).warnings.find((item) => item.code === code);
const printed = (geometry: { scene: readonly { t: string; lines?: string[] }[] }) => geometry.scene.flatMap((node) => (node.t === 'text' ? node.lines ?? [] : [])).join(' | ');

describe('warnings of the exhibit keys', () => {
  // A reader who loses the sizes reads a cohort of 40 and one of 4,000 as equals.
  it('warns when the size column goes, and keeps the bases in the total and its base line', () => {
    const geometry = layout({ variant: 'pure', columnVisibility: { size: false }, size: { width: 760 } });
    expect(geometry.warnings.map((item) => item.code)).toContain('cohort-size-hidden');
    expect(geometry.marks.sizeCells).toEqual([]);
    expect(printed(geometry)).toContain('base 2,400');
    expect(geometry.derived.total?.base).toBe(2400);
    expect(geometry.a11y.desc).not.toContain('cohort-size');
  });

  // Without heads nothing else names the periods, the corner's unit or the numbers behind Low and High.
  it('names what the heads carried', () => {
    const pure = warning({ variant: 'pure', columnHeads: false, size: { width: 760 } }, 'cohort-heads-hidden')!;
    expect(pure.message).toContain('M0');
    expect(pure.message).toContain('the unit (%)');
    const stepped = warning({ variant: 'stepped', formatScope: 'column', columnHeads: false, size: { width: 760 } }, 'cohort-heads-hidden')!;
    expect(stepped.message).toContain('Low and High');
    expect(stepped.message).not.toContain('the unit');
  });

  // An unset unit prints only in the corner of a pure table, so a corner head can remove it silently.
  it('warns when an authored corner head leaves the unit printed nowhere', () => {
    const size = { width: 760 };
    expect(warning({ variant: 'pure', size, columnOverrides: { label: { label: 'Signup' } } }, 'cohort-unit-unprinted')).toBeDefined();
    expect(warning({ variant: 'pure', size, columnOverrides: { label: { label: 'Signup, %' } } }, 'cohort-unit-unprinted')).toBeUndefined();
    expect(warning({ variant: 'pure', size, showPercentSign: true, columnOverrides: { label: { label: 'Signup' } } }, 'cohort-unit-unprinted')).toBeUndefined();
  });

  // A setting with no reader must say so instead of doing nothing.
  it('warns on settings with no reader and never refuses them', () => {
    const size = { width: 760 };
    const periods = layout({ variant: 'pure', size, columnOverrides: { periods: { label: 'Months' } } });
    expect(periods.warnings.find((item) => item.code === 'option-ignored')?.field).toEqual(['options', 'columnOverrides', 'periods', 'label']);
    const headless = layout({ variant: 'pure', size, columnHeads: false, columnOverrides: { size: { label: 'Customers', headAlign: 'left' } } });
    expect(headless.warnings.filter((item) => item.code === 'option-ignored')).toHaveLength(2);
    expect(printed(headless)).not.toContain('Customers');
    expect(warning({ variant: 'pure', size, total: false, totalPosition: 'top' }, 'option-ignored')?.field).toEqual(['options', 'totalPosition']);
    expect(layout({ variant: 'pure', size, columnVisibility: { nope: false }, columnOrder: ['nope'], columnOverrides: { nope: { width: 90 } } }).warnings
      .filter((item) => item.code === 'generated-id-unknown')).toHaveLength(3);
    expect(warning({ variant: 'pure', size, columnVisibility: { label: false } }, 'generated-name-column-kept')).toBeDefined();
  });
});

describe('keys on a variant that can never have the part', () => {
  const refused: [CohortOptions, string][] = [
    [{ columnVisibility: { size: false } }, 'columnVisibility'],
    [{ variant: 'heatmap', columnOverrides: { size: { width: 90 } } }, 'columnOverrides'],
    [{ columnOrder: ['periods'] }, 'columnOrder'],
    [{ columnHeads: false }, 'columnHeads'],
    [{ totalPosition: 'top' }, 'totalPosition'],
    [{ figures: false }, 'figures'],
    [{ variant: 'pure', figures: false }, 'figures'],
    [{ variant: 'stepped', designatedPeriod: false }, 'designatedPeriod'],
    [{ designatedPeriod: false }, 'designatedPeriod'],
  ];
  // React entries do not link zod: a refusal only in the schema would draw a dead key on screen.
  it.each(refused)('refuses %j on the schema and on the layout path', (options, key) => {
    const parsed = cohortOptionsSchema.safeParse(options);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toContain(key);
    const lint = layout(options).warnings.find((item) => item.severity === 'error' && item.field?.[1] === key);
    expect(lint?.code).toBe('invalid-options');
    expect(lint?.fix).toEqual([{ op: 'remove', path: `/options/${key}` }]);
  });
});

// A corner aligned past the left edge of the table is hidden as a collision, and the unit it carried goes with it.
describe('a corner head wider than its track', () => {
  const small: CohortData = { cohorts: [{ id: 'a', label: 'A', active: [100, 60, 50] }, { id: 'b', label: 'B', active: [100, 70] }] };
  const corner = (label: NonNullable<CohortOptions['columnOverrides']>[string], chart = small) => {
    const geometry = layout({ variant: 'pure', total: false, cohortSizeLabel: 'N', size: { width: 720 }, columnOverrides: { label } }, chart);
    const head = geometry.labels.find((item) => item.id === 'cohort-header-label');
    const ignored = geometry.warnings.some((item) => item.code === 'option-ignored' && item.field?.join('.') === 'options.columnOverrides.label.headAlign');
    return { x: head?.rect.x, left: geometry.plot.x, ignored };
  };

  it.each([[{ headAlign: 'right' }, true], [{ headAlign: 'center' }, true], [{ align: 'right' }, false]] as const)('%j stays in the table', (label, ignored) => {
    const { x, left, ignored: warned } = corner(label);
    expect(x).toBeGreaterThanOrEqual(left);
    expect(warned).toBe(ignored);
  });

  // A name past the table edge is hidden as a collision, and the fallback for that drops the period-0 column.
  it.each(['right', 'center'] as const)('keeps a %s row name wider than its span in the table', (align) => {
    const names: CohortData = { cohorts: ['January signups', 'February signups', 'March signups', 'April signups'].map((label, row) => ({ id: `r${row}`, label, active: [100, 70, 60, 50, 40].slice(0, 5 - row) })) };
    const geometry = layout({ variant: 'pure', total: false, cohortSizeLabel: 'N', size: { width: 320 }, columnOverrides: { label: { align } } }, names);
    for (const label of geometry.labels.filter((item) => item.id.startsWith('cohort-row:'))) expect(label.rect.x).toBeGreaterThanOrEqual(geometry.plot.x);
  });

  it('keeps its alignment where it fits', () => {
    const { x, left, ignored } = corner({ headAlign: 'right' }, { cohorts: [{ ...small.cohorts[0]!, label: 'A longer cohort name' }, small.cohorts[1]!] });
    expect(x).toBeGreaterThan(left);
    expect(ignored).toBe(false);
  });
});

describe('authored widths', () => {
  const wide: CohortData = { periodLabel: 'Month', cohorts: Array.from({ length: 4 }, (_, row) => ({ id: `r${row}`, label: `Signup group ${row + 1}`, active: Array.from({ length: 12 - row }, (_, t) => 10000 - t * 317 - row * 13) })) };
  const compact: CohortOptions = { variant: 'stepped', mode: 'compact', size: { width: 320 } };

  // The compact form drops periods to fit. A width that entered that search would drop them with no warning, and React would read a chart short of room.
  it.each([[{ label: { width: 300 } }], [{ size: { width: 5000 } }], [{ periods: { width: 200 } }], [{ periods: { width: 2 } }]])('%j keeps the periods of the compact form', (columnOverrides) => {
    const without = layout(compact, wide);
    const withWidth = layout({ ...compact, columnOverrides }, wide);
    expect(withWidth.derived.visiblePeriods).toEqual(without.derived.visiblePeriods);
    expect(withWidth.derived.periodsLeftOut).toEqual(without.derived.periodsLeftOut);
  });

  // An authored width must not refuse a chart that draws without it, or hide its numbers.
  it.each([[{ label: { width: 5000 } }, 'capped'], [{ periods: { width: 3 } }, 'floored'], [{ size: { width: 5 } }, 'floored']])('%j gives way with a warning', (columnOverrides, kind) => {
    const body = render({ spec: { type: 'cohort', data, options: { title: 'Retention', variant: 'pure', size: { width: 480 }, columnOverrides } }, return: ['svg'] }).body as { ok: boolean; warnings: { code: string }[] };
    expect(body.ok).toBe(true);
    expect(body.warnings.map((item) => item.code)).toContain(`generated-column-width-${kind}`);
  });
});

describe('heatmap total and visiblePeriods', () => {
  // A hidden period must leave no receipt: its average's node id pointed at a missing cell, and "N of M too small" counted it as lost.
  it('leaves no trace of a hidden period', () => {
    const options: CohortOptions = { averages: 'weighted', visiblePeriods: [1, 2], size: { width: 720 } };
    const body = render({ spec: { type: 'cohort', data, options: { title: 'Retention', ...options } }, return: ['svg', 'reading'] }).body as { ok: boolean; reading: { derived: { claimId: string }[] } };
    expect(body.ok).toBe(true);
    const claims = body.reading.derived.map((claim) => claim.claimId);
    expect(claims.filter((id) => /:t(0|3)$/.test(id))).toEqual([]);
    const geometry = layout(options);
    expect(geometry.marks.cells.every((cell) => [1, 2].includes(cell.periodIndex))).toBe(true);
    expect(geometry.a11y.desc).not.toContain('M3');
    expect(geometry.a11y.desc).not.toContain('Period 0');
    expect(printed(geometry)).not.toContain('M0 base');
    expect(printed(geometry)).not.toContain('too narrow');
  });

  it('total wins over averages', () => {
    expect(layout({ total: 'weighted' }).derived.averages).toBeDefined();
    expect(layout({ total: false, averages: 'weighted' }).derived.averages).toBeUndefined();
    expect(layout({ total: 'weighted', averages: false }).derived.averages).toBeDefined();
  });
});

// figures false stops printing only: a record or accessible value that went with it would lose the rate.
it('figures false keeps every cell value for hover and records', () => {
  const stepped: CohortOptions = { variant: 'stepped', formatScope: 'classic', size: { width: 760 } };
  // A drawn figure's text node states its value (display.shows); the cells keep theirs.
  const display = (geometry: Geometry<CohortMarks, CohortDerived>) => geometry.scene.flatMap((node) => {
    const { shows: _shows, ...kept } = node.display ?? {};
    return Object.keys(kept).length > 0 ? [[node.id, kept]] : [];
  });
  const off = layout({ ...stepped, figures: false });
  expect(display(off)).toEqual(display(layout(stepped)));
  expect(off.labels.filter((label) => label.id.startsWith('cohort-cell:') && !label.id.endsWith(':t0'))).toEqual([]);
  expect(off.labels.filter((label) => label.id.endsWith(':t0')).length).toBeGreaterThan(0);
});

// The React entry takes its own path to the layout: the chart on screen must match the spec, and a refused key must show the card.
describe('React', () => {
  const mount = async (props: object) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(CohortChart as never, { data, title: 'Retention', size: { width: 760 }, ...props })); });
    await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
    const text = host.textContent ?? '';
    await act(async () => { root.unmount(); });
    host.remove();
    return text;
  };

  it('draws the keys', async () => {
    const text = await mount({ variant: 'pure', columnOverrides: { size: { label: 'Customers' } }, totalPosition: 'top' });
    expect(text.toUpperCase()).toContain('CUSTOMERS');
    const hidden = await mount({ variant: 'pure', cohortSizeLabel: 'Customers', columnVisibility: { size: false } });
    expect(hidden.toUpperCase()).not.toContain('CUSTOMERS');
  });

  it('refuses a key the variant has no part for', async () => {
    const text = await mount({ columnHeads: false });
    expect(text).toContain('cannot be shown');
  });
});

// An author who turned the tint off must not get a warning about a column that is out of range.
it('designatedPeriod false draws no tint and does not warn', () => {
  const fixture = getFixtures('cohort').find((item) => item.id === 'no-designated-period')!;
  const geometry = layout(fixture.options as CohortOptions, fixture.data as CohortData);
  expect(geometry.warnings.map((item) => item.code)).not.toContain('designated-period-out-of-range');
  expect(geometry.scene.some((node) => node.t === 'rect' && (node.fill as { token?: string }).token === 'focus')).toBe(false);
  expect(layout({ variant: 'pure', designatedPeriod: false, mode: 'compact', size: { width: 320 } }).refused).toBeFalsy();
});

describe('give-way edge cases', () => {
  const twenty: CohortData = { periodLabel: 'Month', cohorts: [
    { id: 'a', label: 'A', active: Array.from({ length: 20 }, (_, i) => 1000 - 10 * i) },
    { id: 'b', label: 'B', active: Array.from({ length: 19 }, (_, i) => 800 - 10 * i) },
  ] };
  // A width that started the compact search on another rung dropped the period-0 column.
  it('a width does not change which periods a wide compact table keeps', () => {
    const base: CohortOptions = { variant: 'pure', mode: 'compact', total: false, threshold: false, size: { width: 838 } };
    expect(layout({ ...base, columnOverrides: { size: { width: 5000 } } }, twenty).derived.visiblePeriods).toEqual(layout(base, twenty).derived.visiblePeriods);
  });

  // Counting hidden labels let a width print a cut name and hide a number instead.
  it('a width does not trade one hidden label for another', () => {
    const chart: CohortData = { cohorts: [{ id: 'a', label: 'W'.repeat(35), active: [100000, 60000] }, { id: 'b', label: 'M'.repeat(35), active: [100000] }] };
    const options: CohortOptions = { variant: 'pure', total: false, threshold: false, columnHeads: false, size: { width: 900 }, columnOverrides: { label: { width: 400 }, size: { width: 5 } } };
    const without = layout({ ...options, columnOverrides: undefined }, chart);
    const shown = new Set(layout(options, chart).labels.filter((label) => !label.hidden).map((label) => label.id));
    expect(without.labels.filter((label) => !label.hidden && !shown.has(label.id))).toEqual([]);
  });

  // A second head line can pass a pinned height the default table met.
  it('a long head stays on one line at a pinned height that has no room for two', () => {
    const chart: CohortData = { cohorts: [{ id: 'a', label: 'A', active: [100, 60] }, { id: 'b', label: 'B', active: [100] }] };
    const options: CohortOptions = { title: 'Retention', variant: 'pure', mode: 'compact', total: false, threshold: false, size: { width: 320, height: 151 } };
    const plain = layout(options, chart).sizing!.minHeight;
    const asked = layout({ ...options, columnOverrides: { size: { label: 'Customers at the beginning of the month' } } }, chart);
    expect(asked.sizing!.minHeight).toBeLessThanOrEqual(Math.max(plain, 151));
  });
});

// Centring each rate on its own width staggers the digits and decimal points of a period column when rates have different digit counts.
it('aligns every figure of a period column on one shared right edge centred under its head', () => {
  const rates: CohortData = {
    periodLabel: 'Week',
    cohorts: [
      { id: 'w1', label: 'Wk 1', active: [400, 400, 24, 2] },
      { id: 'w2', label: 'Wk 2', active: [250, 25, 160] },
      { id: 'w3', label: 'Wk 3', active: [600, 6] },
    ],
  };
  for (const variant of ['pure', 'stepped'] as const) {
    const geometry = layout({ variant, size: { width: 640 } }, rates);
    const head = geometry.labels.find((item) => item.id === 'cohort-header-period:1')!;
    const base = geometry.labels.find((item) => item.id === 'cohort-average-base:t1')!;
    const columnCentre = head.rect.x + head.rect.w / 2;
    const cells = geometry.labels.filter((item) => item.id.startsWith('cohort-cell:') && item.id.endsWith(':t1'));
    expect(cells).toHaveLength(4);
    const widest = Math.max(...cells.map((item) => item.rect.w));
    expect(Math.min(...cells.map((item) => item.rect.w))).toBeLessThan(widest);
    for (const cell of cells) expect(cell.rect.x + cell.rect.w).toBeCloseTo(columnCentre + widest / 2, 6);
    const nodes = geometry.scene.filter((node) => node.t === 'text' && node.id.startsWith('label:cohort-cell:') && node.id.endsWith(':t1'));
    for (const node of nodes) if (node.t === 'text') expect([node.align, node.x]).toEqual(['end', columnCentre + widest / 2]);
    expect(base.rect.x + base.rect.w).toBeCloseTo(columnCentre + base.rect.w / 2, 6);
  }
  const centred = layout({ variant: 'pure', size: { width: 640 }, columnOverrides: { periods: { align: 'center' } } }, rates);
  const centredHead = centred.labels.find((item) => item.id === 'cohort-header-period:1')!;
  const headCentre = centredHead.rect.x + centredHead.rect.w / 2;
  const centredCells = centred.labels.filter((item) => item.id.startsWith('cohort-cell:') && item.id.endsWith(':t1'));
  for (const cell of centredCells) expect(cell.rect.x + cell.rect.w / 2).toBeCloseTo(headCentre, 6);
});
