/**
 * Derived numbers stay exact until the exhibit's formatter prints them, and
 * no nonzero value prints as 0. Each block pins a reading that used
 * to be rounded on the way: stack totals rounded to two decimals before the
 * annotations and total labels read them, a KPI hero that printed 0.0,
 * heatmap means rounded early with an all-null row reported as 0, and a
 * sparkline label printed with String(value).
 */

import './helpers/link-core';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { layoutColumn } from '../src/core/charts/column/layout';
import { layoutCombo } from '../src/core/charts/combo/layout';
import { layoutCreative } from '../src/core/charts/creative/layout';
import { creativePlaceholderFixture } from '../src/core/charts/creative/fixtures';
import { layoutHeatmap } from '../src/core/charts/heatmap/layout';
import { layoutKpi } from '../src/core/charts/kpi/layout';
import { layoutLine } from '../src/core/charts/line/layout';
import { layoutPareto } from '../src/core/charts/pareto/layout';
import { layoutSparkline } from '../src/core/charts/sparkline/layout';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import type { Geometry } from '../src/core/types/scene';

type Laid = Geometry<object, object>;
const text = (geometry: Laid, id: string) => geometry.labels.find((label) => label.id === id)?.text;
const desc = (geometry: Laid) => geometry.a11y.desc;
const annotation = (geometry: Laid, kind: string) => geometry.annotations.find((a) => a.kind === kind)?.computedText;
const codes = (geometry: Laid) => (geometry.warnings ?? []).map((w) => w.code);

const cats = (...ids: string[]) => ids.map((id) => ({ id, label: id.toUpperCase() }));

describe('column and combo stack totals stay exact until printed', () => {
  const small = { categories: cats('c0', 'c1'), series: [{ id: 'a', label: 'A', values: [0.014, 0.02] }] };
  const diff = [{ kind: 'diff', mode: 'relative', from: 'c0', to: 'c1' }];

  it('a relative diff on values below 0.1 reads the same on column and line', () => {
    const column = layoutColumn(small, { annotations: diff } as never);
    const line = layoutLine(small as never, { annotations: diff } as never);
    expect(annotation(line, 'diff')).toBe('+43%');
    expect(annotation(column, 'diff')).toBe(annotation(line, 'diff'));
  });

  it('a cagr on values below 0.1 reads the same on column and line', () => {
    const years = { categories: [{ id: 'y2020', label: '2020' }, { id: 'y2024', label: '2024' }], series: small.series };
    const cagr = [{ kind: 'cagr', from: 'y2020', to: 'y2024' }];
    const column = layoutColumn(years, { annotations: cagr } as never);
    const line = layoutLine(years as never, { annotations: cagr } as never);
    expect(annotation(line, 'cagr')).toContain('+9.3% p.a.');
    expect(annotation(column, 'cagr')).toBe(annotation(line, 'cagr'));
  });

  it('a base of 0.004 is not a zero base', () => {
    const data = { ...small, series: [{ id: 'a', label: 'A', values: [0.004, 0.02] }] };
    const column = layoutColumn(data, { annotations: diff } as never);
    expect(codes(column)).not.toContain('ref-zero');
    expect(annotation(column, 'diff')).toBe('+400%');
  });

  it('stacked column totals print the sum of the segments the reader sees', () => {
    const data = {
      categories: cats('c0', 'c1'),
      series: [{ id: 'a', label: 'A', values: [0.01, 0.02] }, { id: 'b', label: 'B', values: [0.015, 0.005] }],
    };
    const column = layoutColumn(data, { variant: 'stacked' } as never);
    expect(text(column, 'grandTotal:c0')).toBe('0.025');
    expect(text(column, 'grandTotal:c1')).toBe('0.025');
    expect(desc(column)).toContain('Totals: C0 0.025, C1 0.025.');
  });

  it('the description and the label of a single-series column state one total', () => {
    const data = { categories: cats('c0', 'c1', 'c2'), series: [{ id: 'a', label: 'A', values: [0.04, 0.025, 0.01] }] };
    const column = layoutColumn(data, {});
    expect(desc(column)).toContain('Totals: C0 0.040, C1 0.025, C2 0.010.');
  });

  it('combo column totals and pareto bars print the exact sums', () => {
    const combo = layoutCombo({
      categories: cats('c0', 'c1'),
      series: [
        { id: 'a', label: 'A', kind: 'column', values: [0.004, 0.002] },
        { id: 'b', label: 'B', kind: 'column', values: [0.001, 0.001] },
      ],
    } as never, {} as never);
    expect(desc(combo)).toContain('Column totals: C0 0.005, C1 0.003.');
    const pareto = requireGeometry(layoutPareto({
      items: [{ id: 'a', label: 'A', value: 0.04 }, { id: 'b', label: 'B', value: 0.025 }, { id: 'c', label: 'C', value: 0.01 }],
    }, {}));
    expect(['a', 'b', 'c'].map((id) => text(pareto, `grandTotal:${id}`))).toEqual(['0.040', '0.025', '0.010']);
  });
});

describe('the KPI card never prints a nonzero value as 0', () => {
  const kpi = (data: Record<string, unknown>) => layoutKpi({ label: 'Rate', ...data } as never, {});

  it('lifts the business default for a value under 0.05', () => {
    const card = kpi({ value: 0.042 });
    expect(text(card, 'total:value')).toBe('0.042');
    expect(desc(card)).toContain('Rate 0.042');
  });

  it('keeps the hero and its delta on one footing', () => {
    const card = kpi({ value: 0.004, delta: { vs: 0.003, scenario: 'PY' } });
    expect(text(card, 'total:value')).toBe('0.004');
    expect(text(card, 'point:delta')).toContain('+33.3% vs PY');
  });

  it('lifts an authored example only as far as the value needs', () => {
    expect(text(kpi({ value: 0.0042, format: '1.00%' }), 'total:value')).toBe('0.004%');
    expect(text(kpi({ value: 12.345, format: '1.00%' }), 'total:value')).toBe('12.35%');
  });

  it('prints the value and the reference it is measured against at one precision', () => {
    const card = kpi({ value: 6, delta: { vs: 7.9 } });
    expect(text(card, 'total:value')).toBe('6.0');
    expect(text(card, 'point:delta')).toContain('vs 7.9');
  });

  it('a reference a scenario names is not printed and does not lift the hero', () => {
    expect(text(kpi({ value: 6, delta: { vs: 7.9, scenario: 'PY' } }), 'total:value')).toBe('6');
    const absolute = kpi({ value: 6, delta: { vs: 7.9, scenario: 'PY', mode: 'absolute' } });
    expect(text(absolute, 'total:value')).toBe('6');
    expect(text(absolute, 'point:delta')).toContain('−1.9 vs PY');
  });

  it('a comparison keeps the decimals of its own change beside a whole hero', () => {
    const card = kpi({ value: 100, compare: [{ label: 'vs PY', vs: 98.6, mode: 'absolute' }, { label: 'vs plan', vs: 97 }] });
    expect(text(card, 'total:value')).toBe('100');
    // The steering form prints the change and its baseline name in two columns.
    expect(text(card, 'point:compare:0')).toBe('+1.4');
    expect(text(card, 'point:compareLabel:0')).toBe('vs PY');
    expect(text(card, 'point:compare:1')).toBe('+3.1% (+3.0)');
    expect(desc(card)).toContain('+1.4 vs PY');
  });

  // A loss of 42.5 against a plan of +18.2 printed "−333.5% vs PL", a percent that measures no gap.
  it('prints the absolute change when the value crosses zero from its reference', () => {
    const card = kpi({ value: -42.5, format: '1.1', delta: { vs: 18.2, scenario: 'PL', mode: 'both' } });
    expect(text(card, 'point:delta')).toBe('−60.7 vs PL');
    expect(card.warnings.map((w) => w.code)).toContain('sign-change');
    const compared = kpi({ value: -42.5, format: '1.1', compare: [{ label: 'vs PL', vs: 18.2 }] });
    expect(text(compared, 'point:compare:0')).toBe('−60.7');
  });

  // A percent measure printed "+22.6%" for a rate that moved 0.7 points, and two percents on one line.
  it('compares a percent measure in points unless a mode is set', () => {
    const delta = kpi({ value: 3.8, format: '1.1%', delta: { vs: 3.1, scenario: 'PY' } });
    expect(text(delta, 'point:delta')).toBe('+0.7pp vs PY');
    const compared = kpi({ value: 97.6, format: '1.1%', compare: [{ label: 'Plan', vs: 100 }] });
    expect(text(compared, 'point:compare:0')).toBe('−2.4pp');
    const relative = kpi({ value: 3.8, format: '1.1%', delta: { vs: 3.1, scenario: 'PY', mode: 'relative' } });
    expect(text(relative, 'point:delta')).toBe('+22.6% vs PY');
  });
});

describe('heatmap means are exact, and a row without values has none', () => {
  it('prints a mean of 0.0023 at the cells\' precision', () => {
    const grid = layoutHeatmap({
      categories: cats('a', 'b'),
      series: [{ id: 'n', label: 'N', values: [0.0012, 0.0034] }, { id: 's', label: 'S', values: [0.002, 0.004] }],
    }, { unit: 'rate' });
    expect(desc(grid)).toContain('Row means: N 0.0023, S 0.0030.');
    expect(grid.derived.rowMeans.n).toBeCloseTo(0.0023, 12);
  });

  it('describes an all-null row as unavailable and sorts it last', () => {
    const grid = layoutHeatmap({
      categories: cats('a', 'b'),
      series: [
        { id: 'n', label: 'N', values: [null, null] },
        { id: 's', label: 'S', values: [-2, -6] },
        { id: 'u', label: 'U', values: [3, 5] },
      ],
    }, { sort: { segments: 'desc' } });
    expect(grid.derived.rowMeans.n).toBeNull();
    expect(desc(grid)).toContain('Row means: U 4, S −4, N n/a.');
    expect(grid.axes.find((axis) => axis.axis === 'y')!.ticks.map((tick) => tick.at)).toEqual(['u', 's', 'n']);
  });
});

// A signed format ("+0.0%") printed "++0.1%" on the colour key while the cells read "+0.1%".
describe('the heatmap key prints a signed format once', () => {
  it('keeps one plus sign on the top key label', () => {
    const grid = layoutHeatmap({
      categories: cats('a', 'b', 'c'),
      series: [{ id: 'r1', label: 'R1', values: [0.12, -0.2, 0.05] }, { id: 'r2', label: 'R2', values: [-0.1, 0.03, 0.08] }],
    }, { format: '+0.0%' });
    const keyTexts = grid.scene.flatMap((node) => node.id.startsWith('label:scale:tickLabel:') && 'lines' in node ? node.lines as string[] : []);
    expect(keyTexts).toContain('+0.1%');
    expect(keyTexts.some((value) => value.includes('++'))).toBe(false);
    // A capped end keeps its saturation mark in front of the one sign.
    const capped = layoutHeatmap({ categories: cats('a', 'b'), series: [{ id: 'r1', label: 'R1', values: [-0.2, 0.3] }] },
      { format: '+0.0%', cap: { abs: 0.1 } } as never);
    const cappedTexts = capped.scene.flatMap((node) => node.id.startsWith('label:scale:tickLabel:') && 'lines' in node ? node.lines as string[] : []);
    expect(cappedTexts).toContain('≥+0.1%');
  });

  // At margin 0 the highlight outline ran 1.5 px past the viewBox, so a host that clips at the SVG box lost that edge.
  it('keeps the highlight outline on the canvas at margin 0', () => {
    const grid = layoutHeatmap({ categories: cats('a', 'b', 'c'), series: [{ id: 'r1', label: 'R1', values: [1, 2, 3] }] },
      { highlight: 'r1', margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    const outline = grid.scene.find((node) => node.id === 'rowTint:r1') as { d: string; width: number };
    const [x0, y0, x1, y1] = outline.d.match(/[\d.]+/g)!.map(Number).filter((_, index) => [0, 1, 2, 3].includes(index));
    const half = outline.width / 2;
    expect(Math.min(x0!, y0!) - half).toBeGreaterThanOrEqual(0);
    expect(x1! + half).toBeLessThanOrEqual(grid.size.width);
    expect(y1! + half).toBeLessThanOrEqual(grid.size.height);
  });
});

describe('the standalone sparkline prints its value through the exhibit formatter', () => {
  const spark = (values: number[], options: Record<string, unknown> = {}) =>
    layoutSparkline({ values }, { valueLabel: 'last', ...options } as never);

  it('groups digits and rounds a computed value to the raster', () => {
    const wide = spark([1.2e9, 1.3e9, 1.1e9, 1.5e9], { size: { width: 520, height: 220 } });
    expect(text(wide, 'spark:last')).toBe('1,500,000,000');
    expect(desc(wide)).toContain('ending at 1,500,000,000');
    expect(text(spark([12.3456789, 12.1, 12.9, 13.123456789]), 'spark:last')).toBe('13.12');
    expect(text(spark([120000, 130000, 110000, 150000], { size: { width: 520, height: 220 } }), 'spark:last')).toBe('150,000');
  });

  it('drops a value label it would have to cut, and says so', () => {
    const narrow = spark([1.2e9, 1.3e9, 1.1e9, 1.5e9], { size: { width: 120, height: 81 } });
    expect(text(narrow, 'spark:last')).toBeUndefined();
    expect(codes(narrow)).toContain('sparkline-value-label-cut');
    expect(desc(narrow)).toContain('ending at 1,500,000,000');
  });

  it('a dropped value label leaves no empty column: the line runs as wide as without one', () => {
    const size = { width: 120, height: 81 };
    const narrow = spark([1.2e9, 1.3e9, 1.1e9, 1.5e9], { size });
    const bare = layoutSparkline({ values: [1.2e9, 1.3e9, 1.1e9, 1.5e9] }, { size } as never);
    const line = (geometry: Laid) => geometry.scene.find((node) => node.id === 'spark:line');
    const ring = (geometry: Laid) => geometry.scene.find((node) => node.id === 'spark:ring');
    expect(line(narrow)).toEqual(line(bare));
    expect(ring(narrow)).toEqual(ring(bare));
  });
});

describe('values that print side by side share one precision', () => {
  it('creative metrics: the value and the account median of one metric share a precision', () => {
    const data = creativePlaceholderFixture.data;
    const creative = layoutCreative({
      ...data,
      metrics: { ...data.metrics, frequency: { value: 1, accountMedian: 1.5 }, cpa: { value: 0.04, accountMedian: 28 } },
    } as never, creativePlaceholderFixture.options as never);
    expect(text(creative, 'creative:value:frequency')).toBe('1.0×');
    expect(text(creative, 'creative:median:frequency')).toBe('1.5×');
    expect(text(creative, 'creative:value:cpa')).toMatch(/^0\.04 /);
  });
});

describe('a KPI card in a fixed slot keeps every text it draws at natural size', () => {
  const slot = (data: object, height: number): Laid => requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'kpi', data, options: { size: { width: 420, height } } })));
  const shown = (geometry: Laid, id: string) => geometry.labels.some((label) => label.id === id && !label.hidden);

  // Growing the delta past the card width, or a long note past the free height, hid labels that the natural sizes draw.
  it('grows the figure, delta and note only as far as the card holds them', () => {
    const wide = slot({ label: 'Units', value: 1, format: '1,000.00', delta: { vs: 9876543.21, mode: 'both' } }, 528);
    expect(shown(wide, 'point:delta')).toBe(true);
    const long = slot({ label: 'Units', value: 8, note: 'Excludes the Larkspur Tools division sold in June. '.repeat(10).trim(), delta: { vs: 6, scenario: 'PY' } }, 1000);
    expect(shown(long, 'note:kpi')).toBe(true);
    expect(shown(long, 'point:delta')).toBe(true);
  });
});

describe('a value matrix steps its text down before it hides a value', () => {
  // A cell too narrow for "117.80" used to lose every number and keep only its colour.
  const cells = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, label: `C${i}` }));
  const series = ['a', 'b', 'c'].map((id, r) => ({ id, label: id.toUpperCase(), values: cells.map((_, i) => 80 + r * 40 + i * 7.31 + 0.07) }));
  const printed = (width: number, options: object = {}) => {
    const geometry = layoutHeatmap({ categories: cells, series } as never, { variant: 'value', size: { width, height: 300 }, ...options } as never);
    return { geometry, texts: geometry.labels.filter((label) => label.kind === 'point' && !label.hidden).map((label) => label.text) };
  };

  it('prints every value with fewer decimals while the hover card keeps them all', () => {
    const wide = printed(640);
    expect(wide.texts).toHaveLength(36);
    expect(wide.texts[0]).toBe('80.07');
    const narrow = printed(432);
    expect(narrow.texts).toHaveLength(36);
    expect(narrow.texts.every((value) => !value.includes('.'))).toBe(true);
    expect(narrow.geometry.scene.find((node) => node.part === 'cell')?.display).toEqual({ value: '80.07' });
  });

  it('leaves an authored format as written', () => {
    const { texts } = printed(432, { format: '1,234.00' });
    expect(texts.length).toBeLessThan(36);
    expect(texts.every((value) => /\.\d\d$/.test(value))).toBe(true);
  });

  // One wide number used to hide only its own cell, so the matrix printed the other 35 around a gap.
  it('prints all of its values or none of them', () => {
    const wideOne = series.map((s, r) => ({ ...s, values: s.values.map((_, i) => (r === 0 && i === 0 ? 123456 : 10 + i)) }));
    const geometry = layoutHeatmap({ categories: cells, series: wideOne } as never, { variant: 'value', size: { width: 432, height: 300 }, format: '1,234' } as never);
    expect(geometry.labels.filter((label) => label.kind === 'point' && !label.hidden)).toHaveLength(0);
  });
});
