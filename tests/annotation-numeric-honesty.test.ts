import './helpers/link-core';
import { describe, expect, it } from 'vitest';

import { yearSpan } from '../src/core/annotate';
import { claimsForChart } from '../src/core/claims';
import { recomputeClaim } from './helpers/recompute';
import { cagr as publicCagr } from '../src/core/format';
import { layoutBar } from '../src/core/charts/bar/layout';
import { layoutColumn } from '../src/core/charts/column/layout';
import { layoutDot } from '../src/core/charts/dot/layout';
import { layoutLine } from '../src/core/charts/line/layout';
import { layoutMekko } from '../src/core/charts/mekko/layout';
import { layoutVariance } from '../src/core/charts/variance/layout';
import { fixtures as waterfallFixtures } from '../src/core/charts/waterfall/fixtures';
import { layoutWaterfall } from '../src/core/charts/waterfall/layout';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineChart } from '../src/react/charts/line';
import { ColumnChart } from '../src/react/charts/column';
import { VarianceChart } from '../src/react/charts/variance';
import { prepareChart } from '../src/react/prepare';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { interactionRecords } from '../src/core/a11y/records';
import { deltaValueText, displayedValueText } from '../src/core/a11y/valueText';
import { labelCardContent } from '../src/react/hover/labelCard';
import { requireGeometry } from '../src/core/sizing';
import { boxGap } from '../src/core/geometry';
import { render } from '../src/cli/render';
import { callTool } from '../src/mcp/server';

// A bracket endpoint must not print a second copy of a value already visible at that point.
it('prints annotated point values once in line, area and column SVG and React', async () => {
  const data = {
    categories: Array.from({ length: 6 }, (_, i) => ({ id: `y${i}`, label: `FY${20 + i}`, date: `${2020 + i}-12-31` })),
    series: [
      { id: 'a', label: 'Series A', values: [48, 66, 86, 118, 152, 189] },
      { id: 'b', label: 'Series B', values: [124, 118, 109, 97, 88, 71] },
    ],
  };
  const start = { categoryId: 'y0', seriesId: 'a' };
  const end = { categoryId: 'y5', seriesId: 'a' };
  const annotations = [
    { kind: 'cagr', from: start, to: end },
    { kind: 'diff', from: start, to: end, mode: 'absolute' },
    { kind: 'diff', from: { categoryId: 'y5', seriesId: 'b' }, to: end, mode: 'absolute', placement: 'bracket' },
    { id: 'start', kind: 'abs', at: start },
    { id: 'end', kind: 'abs', at: end },
  ];
  const texts = (svg: string) => [...svg.matchAll(/<text\b[^>]*data-part="(?:point|annotation|series|total|grandTotal)"[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]!.replace(/<title>.*?<\/title>/g, '').replace(/<[^>]*>/g, ''));
  for (const variant of ['line', 'area', 'column'] as const) {
    for (const [names, fractional] of [['none', false], ['end', false], ['end', true]] as const) {
      const chartData = structuredClone(data);
      if (fractional) chartData.series[0]!.values[1] = 66.5;
      const options = { size: { width: 1000, height: 650 }, valueLabels: 'all', highlight: 'a',
        annotations, ...(variant === 'column' ? { variant: 'grouped' } : { variant, seriesLabels: names, highlightMode: 'grey' }) };
      const geometry = variant === 'column' ? layoutColumn(chartData, options as never) : layoutLine(chartData, options as never);
      const svg = renderSvg(geometry as never, resolveTheme());
      const prepared = await prepareChart({ type: variant === 'column' ? 'column' : 'line', data: chartData, options } as never);
      const props = { data: chartData, ...options, prepared };
      const react = renderToStaticMarkup(variant === 'column' ? createElement(ColumnChart, props as never) : createElement(LineChart, props as never));
      for (const output of [svg, react]) {
        expect(texts(output).filter(text => /(?:^| )48(?:\.0+)?$/.test(text)), `${variant}/${names} start`).toHaveLength(1);
        expect(texts(output).filter(text => /(?:^| )189(?:\.0+)?$/.test(text)), `${variant}/${names} end`).toHaveLength(1);
      }
      expect(renderSvg((variant === 'column' ? layoutColumn(chartData, options as never) : layoutLine(chartData, options as never)) as never, resolveTheme())).toBe(svg);
      expect(geometry.annotations.filter(annotation => annotation.kind === 'abs')).toHaveLength(2);
      // A line with end names seats the gap bracket; the endpoint dedupe must keep it.
      if (variant === 'line' && names === 'end') expect(geometry.scene.some(node => node.part === 'bracket' && node.owner?.annotationId === 'diff-3'), `${variant}/${names} bracket`).toBe(true);
      // Without point values the annotation is still needed; authored words keep their meaning.
      const fallback = { ...options, valueLabels: 'none', annotations: [
        { kind: 'abs', at: start }, { kind: 'abs', at: end, text: 'Closing value' },
      ] };
      const alone = variant === 'column' ? layoutColumn(chartData, fallback as never) : layoutLine(chartData, fallback as never);
      expect(alone.labels.filter(label => !label.hidden && label.kind === 'annotation').map(label => label.text)).toEqual(expect.arrayContaining(['48', 'Closing value']));
    }
  }
});

/**
 * Annotation numeric honesty.
 *
 * Every case here is "the number printed is not the number claimed". Each
 * block below pins both the wrong answer and the honest one for the cagr
 * date math.
 */

type Ann = { kind: string; computedText?: string; valueText?: string; tone?: string };
type Warned = { warnings?: { code?: string }[] };

const codes = (geometry: Warned): string[] => (geometry.warnings ?? []).map((w) => w.code ?? '');
const annOf = (geometry: { annotations: Ann[] }, kind: string): Ann | undefined =>
  geometry.annotations.find((a) => a.kind === kind);

// A computed reference must use the observations on its axis, not differences on a level axis.
it('measures variance value-line statistics on the drawn axis', () => {
  for (const percent of [false, true]) for (const variant of ['absolute', 'integrated'] as const) {
    const cell = (value: number) => percent ? { pct: value } : value;
    const data = { categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [
      { id: 'ac', values: [12, 20, 31].map(cell) },
      { id: 'ref', role: 'reference' as const, values: [10, 15, 22].map(cell) },
    ] };
    for (const value of ['mean', undefined, 7] as const) for (const format of [undefined, '0.00']) {
      const options = { variant, variance: { vs: 'ref' }, valueAxis: { show: true },
        size: { width: 640 }, format,
        annotations: [{ kind: 'valueLine' as const, id: 'stat', value, label: 'Average' }] };
      const geometry = layoutVariance(data, options);
      const expected = typeof value === 'number' ? value : variant === 'integrated' ? 21 : 16 / 3;
      expect(geometry.annotations.find(annotation => annotation.id === 'stat')?.derivation?.raw).toBeCloseTo(expected, 12);
      const printed = format ? expected.toFixed(2) : expected === 16 / 3 ? '5.3' : String(expected);
      const unit = percent ? variant === 'absolute' ? 'pp' : '%' : '';
      expect(annOf(geometry, 'valueLine')?.valueText).toBe(`${printed}${unit}`);
      const line = geometry.scene.find(node => node.part === 'valueLine');
      if (line?.t !== 'line') throw new Error('missing reference line');
      const ticks = geometry.axes.find(axis => axis.axis === 'y')!.ticks;
      const [lo, hi] = [ticks[0]!, ticks.at(-1)!];
      const at = (tick: typeof lo) => Number(tick.at);
      const position = lo.pos + (expected - at(lo)) * (hi.pos - lo.pos) / (at(hi) - at(lo));
      expect(line.y1).toBeCloseTo(position, 8);
    }
    for (const value of ['median', 'min', 'max', 'sum']) {
      expect(() => resolveChartRequest({ type: 'variance', data, options: { variant, variance: { vs: 'ref' },
        annotations: [{ kind: 'valueLine', value: value as never }] } })).toThrow(/finite number or 'mean'/);
    }
  }
});

// Prevents percent levels and their differences from losing or mixing units across variance surfaces.
it('uses percent for integrated levels and percentage points for integrated differences', async () => {
  const data = { categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [
    { id: 'ac', values: [{ pct: 12.5 }, { pct: 16.25 }, { pct: 9 }] },
    { id: 'ref', role: 'reference' as const, values: [{ pct: 10 }, { pct: 12 }, { pct: 11.4 }] },
  ] };
  for (const width of [280, 640, 720]) for (const language of ['en', 'de']) for (const source of ['cells', 'unit', 'chart-format', 'series-format', 'cell-format', 'series-unit']) for (const format of [undefined, '0.00%']) {
    if (source === 'chart-format' && !format) continue;
    const chartData = source === 'cells' ? data : { ...data, series: data.series.map(series => ({ ...series,
      ...(source === 'series-format' ? { format: '0.00%' } : {}),
      ...(source === 'series-unit' ? { unit: '%' } : {}),
      values: series.values.map(cell => source === 'cell-format' ? { number: cell.pct, format: '0.00%' } : cell.pct),
    })) };
    const options = { variant: 'integrated' as const, variance: { vs: 'ref' }, format, ...(source === 'unit' ? { unit: '%' } : {}),
      locale: { language }, size: { width }, valueAxis: { show: true },
      annotations: [{ kind: 'valueLine' as const, value: 3, label: 'Target' }, { kind: 'valueLine' as const, value: 'mean' as const, label: 'Average' }] };
    const request = resolveChartRequest({ type: 'variance', data: chartData, options });
    const geometry = layoutResolvedRequest(request);
    if (geometry.refused) throw new Error('percent variance refused');
    const tickIds = new Set(geometry.axes.find(axis => axis.axis === 'y')!.ticks.map(tick => tick.labelId));
    const levels = geometry.labels.filter(label => label.kind === 'total' && !label.hidden);
    const deltas = geometry.labels.filter(label => label.kind === 'point' && !label.hidden);
    expect(levels).toHaveLength(3);
    expect(deltas).toHaveLength(3);
    expect(geometry.labels.filter(label => label.kind === 'valueLine' && !label.hidden)).toHaveLength(2);
    for (const label of levels) expect(label.text).toMatch(/%$/);
    for (const label of deltas) expect(label.text).toMatch(/pp$/);
    const ticks = geometry.scene.filter(node => node.t === 'text' && tickIds.has(node.id));
    expect(ticks.length).toBeGreaterThan(0);
    for (const node of ticks) if (node.t === 'text') expect(node.lines.join('')).toMatch(/%$/);
    expect(annOf(geometry, 'valueLine')?.valueText).toMatch(/%$/);
    const svg = renderSvg(geometry, request.theme);
    const prepared = await prepareChart({ type: 'variance', data: chartData, options });
    const react = renderToStaticMarkup(createElement(VarianceChart, { data: chartData, ...options, prepared }));
    for (const output of [svg, react]) for (const label of [...levels, ...deltas]) expect(output).toContain(label.text);
    const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
    for (const record of records.filter(record => record.comparisons.length)) {
      expect(displayedValueText(record.value, request.locale?.language)).toMatch(/%$/);
      expect(deltaValueText(record.comparisons[0]!.delta, 2, request.locale?.language)).toMatch(/pp$/);
    }
    expect(renderSvg(layoutResolvedRequest(request) as never, request.theme)).toBe(svg);
  }
});

// Prevents the chart and its hover card from spacing one unit two ways: "+2.50pp" on the bar, "+2.50 pp" in the card.
it('prints percentage points with one spacing on the chart and in the hover card', () => {
  const data = { categories: [{ id: 'a' }], series: [{ id: 'ac', values: [12.5] }, { id: 'ref', role: 'reference' as const, values: [10] }] };
  for (const language of ['en', 'de']) {
    const request = resolveChartRequest({ type: 'variance', data, options: { variant: 'integrated', variance: { vs: 'ref' }, format: '0.00%', locale: { language }, size: { width: 640 } } });
    const geometry = layoutResolvedRequest(request);
    if (geometry.refused) throw new Error('variance refused');
    const drawn = geometry.labels.find(label => label.kind === 'point' && !label.hidden)!.text;
    const record = interactionRecords({ request, geometry, scope: request.scope, claims: [] }).find(item => item.comparisons.length)!;
    expect(deltaValueText(record.comparisons[0]!.delta, 2, request.locale?.language)).toBe(drawn);
  }
});

// Percent differences must read as percentage points on bars, ticks and references in both languages.
it('prints absolute percent variance in percentage points and integrated references in percent', () => {
  const data = { categories: [{ id: 'a' }, { id: 'b' }], series: [
    { id: 'ac', values: [{ pct: 12.5 }, { pct: 16 }] },
    { id: 'ref', role: 'reference' as const, values: [{ pct: 10 }, { pct: 12 }] },
  ] };
  for (const variant of ['absolute', 'integrated'] as const) {
    for (const [value, printed] of [[2.5, '2.5%'], [0.0341, '0.034%'], [0.00493, '0.0049%']] as const) {
      for (const language of ['en', 'de']) {
        const options = { variant, variance: { vs: 'ref' }, locale: { language },
          annotations: [{ kind: 'valueLine' as const, value, label: 'Plan' }] };
        const geometry = layoutVariance(data, options);
        const unit = variant === 'integrated' ? printed : printed.replace('%', 'pp');
        const text = language === 'de' ? unit.replace('.', ',') : unit;
        expect(annOf(geometry, 'valueLine')?.computedText).toBe(`Plan ${text}`);
        expect(annOf(geometry, 'valueLine')?.valueText).toBe(text);
        expect(renderSvg(geometry as never, resolveTheme())).toBe(renderSvg(layoutVariance(data, options) as never, resolveTheme()));
      }
    }
    const draw = (extra: object, source = data) => layoutVariance(source, { variant, variance: { vs: 'ref' }, ...extra,
      annotations: [{ kind: 'valueLine', value: 2.5, label: 'Plan' }] });
    expect(annOf(draw({ format: '0.00%' }), 'valueLine')?.computedText).toBe(variant === 'integrated' ? 'Plan 2.50%' : 'Plan 2.50pp');
    expect(annOf(draw({}), 'valueLine')?.computedText).toBe(variant === 'integrated' ? 'Plan 2.5%' : 'Plan 2.5pp');
    const axis = draw({ valueAxis: { show: true } });
    if (variant === 'absolute') {
      expect(axis.labels.filter(label => label.kind === 'point' && !label.hidden).map(label => label.text).sort()).toEqual(['+2.5pp', '+4.0pp']);
      const tickIds = new Set(axis.axes.find(item => item.axis === 'y')!.ticks.map(tick => tick.labelId));
      const ticks = axis.scene.filter(node => node.t === 'text' && tickIds.has(node.id));
      expect(ticks.length).toBeGreaterThan(0);
      for (const tick of ticks) if (tick.t === 'text') expect(tick.lines.join('')).toMatch(/pp$/);
      const own = layoutVariance(data, { variant, variance: { vs: 'ref' }, annotations: [
        { kind: 'valueLine', value: 2.5, label: 'Plan', format: '0.000%' },
      ] });
      expect(annOf(own, 'valueLine')?.valueText).toBe('2.500pp');
    }
    const mixed = { ...data, series: [data.series[0]!, { ...data.series[1]!, values: [10, 12] }] };
    expect(annOf(draw({}, mixed as never), 'valueLine')?.computedText).toBe('Plan 2.5');
    const spec = { type: 'variance', data,
      options: { variant, variance: { vs: 'ref' }, size: { width: variant === 'absolute' ? 320 : 360 },
        annotations: [{ kind: 'valueLine' as const, value: 2.5, label: 'Plan' }] } };
    const narrow = layoutResolvedRequest(resolveChartRequest(spec));
    if (narrow.refused) throw new Error('percent variance refused');
    const reference = narrow.labels.find(label => label.kind === 'valueLine' && !label.hidden);
    expect(reference?.lines.join(' ')).toBe(variant === 'integrated' ? 'Plan 2.5%' : 'Plan 2.5pp');
    for (const value of narrow.labels.filter(label => ['point', 'total'].includes(label.kind) && !label.hidden)) {
      expect(boxGap(reference!.rect, value.rect) + 1e-6).toBeGreaterThanOrEqual(6);
    }
    const input = { spec, return: ['svg', 'reading'] };
    expect(callTool('boardplot_render', input).structuredContent).toMatchObject(render(input).body);
  }
});

// A percent reference must keep its unit when automatic precision needs more digits than the bars.
it('keeps the percent unit and precision of a reference', () => {
  const data = { categories: [{ id: 'a' }, { id: 'b' }], series: [{ id: 's', values: [{ pct: 1 }, { pct: 4 }] }] };
  for (const layout of [layoutBar, layoutColumn, layoutLine]) {
    for (const [value, printed] of [[2.5, '2.5%'], [0.0341, '0.034%'], [0.00493, '0.0049%']] as const) {
      const geometry = layout(data, { annotations: [{ kind: 'valueLine', value, label: 'Plan' }] });
      expect(annOf(geometry, 'valueLine')?.computedText).toBe(`Plan ${printed}`);
      expect(annOf(geometry, 'valueLine')?.valueText).toBe(printed);
      expect(renderSvg(geometry as never, resolveTheme())).toBe(renderSvg(layout(data, { annotations: [{ kind: 'valueLine', value, label: 'Plan' }] }) as never, resolveTheme()));
    }
  }
  expect(annOf(layoutBar(data, { annotations: [{ kind: 'valueLine', value: 'mean', label: 'Mean' }] }), 'valueLine')?.computedText).toBe('Mean 2.5%');
  expect(layoutBar(data, { averageMarker: true }).annotations.find(annotation => annotation.id.startsWith('averageMarker'))?.computedText).toContain('2.5%');
  for (const options of [{ topN: { n: 1 } }, { annotations: [{ kind: 'valueLine', value: 2.5, label: 'Plan', tolerance: 0.5 }] }]) {
    expect(annOf(layoutBar(data, { annotations: [{ kind: 'valueLine', value: 2.5, label: 'Plan' }], ...options } as never), 'valueLine')?.computedText).toBe('Plan 2.5%');
  }
  for (const type of ['bar', 'column', 'line', 'waterfall', 'combo', 'slope', 'scatter', 'bullet', 'mekko', 'variance', 'dot']) {
    const fixture = getFixtures(type).find(fixture => fixture.kind === 'example')!;
    const geometry = layoutResolvedRequest(resolveChartRequest({ type,
      data: type === 'bar' ? data : type === 'bullet' ? { rows: [{ id: 'a', value: 1, target: 4 }, { id: 'b', value: 4, target: 4 }] } : fixture.data,
      options: { ...(type === 'bar' ? {} : fixture.options), valueLine: undefined, format: '0.00%', ...(type === 'bullet' ? { sharedScale: true } : {}),
        annotations: [{ kind: 'valueLine', value: 2.5, label: 'Plan' }] } }));
    if (geometry.refused) throw new Error(`${type} refused`);
    expect(annOf(geometry, 'valueLine')?.computedText, type).toBe('Plan 2.50%');
  }
  const counts = { ...data, series: [{ id: 's', values: [1, 4] }] };
  const implicit: { type: string; data: unknown; options?: Record<string, unknown> }[] = [
    ...['bar', 'column', 'line', 'combo', 'slope', 'dot', 'mekko'].map(type => ({ type, data })),
    { type: 'waterfall', data: { items: [{ id: 'a', type: 'total', value: { pct: 1 } }, { id: 'b', value: { pct: 3 } }] } },
    { type: 'scatter', data: { points: [{ id: 'a', x: 1, y: { pct: 1 } }, { id: 'b', x: 2, y: { pct: 4 } }] } },
    { type: 'bullet', data: { rows: [{ id: 'a', value: { pct: 1 } }, { id: 'b', value: { pct: 4 } }] }, options: { sharedScale: true } },
    { type: 'bar', data: counts, options: { variant: 'stacked100' } },
    { type: 'column', data: counts, options: { variant: 'stacked100' } },
    { type: 'line', data: counts, options: { variant: 'stacked100-area' } },
  ];
  const variance = getFixtures('variance').find(fixture => fixture.kind === 'example')!;
  implicit.push({ type: 'variance', data: variance.data, options: { ...variance.options, format: undefined, variant: 'relative' } });
  for (const spec of implicit) {
    const request = resolveChartRequest({ ...spec,
      options: { ...spec.options, annotations: [{ kind: 'valueLine', id: 'plan', value: 2.5, label: 'Plan' }] } });
    const geometry = layoutResolvedRequest(request);
    if (geometry.refused) throw new Error(`${spec.type} refused`);
    expect(annOf(geometry, 'valueLine')?.computedText, `${spec.type} implicit percent`).toBe('Plan 2.5%');
    expect(annOf(geometry, 'valueLine')?.valueText, `${spec.type} hover value`).toBe('2.5%');
    const record = interactionRecords({ request, geometry, scope: request.scope, claims: [] }).find(record => record.target.owner.annotationId === 'plan');
    expect(record?.value.displayed, `${spec.type} hover record`).toBe('2.5%');
  }
  for (const { primaryPercent, format, secondaryFormat, primaryText, secondaryText } of [
    { primaryPercent: true, primaryText: 'Primary 2.5%', secondaryText: 'Secondary 10.5' },
    { primaryPercent: false, primaryText: 'Primary 2.5', secondaryText: 'Secondary 10.5%' },
    { primaryPercent: false, format: '$1,234', primaryText: 'Primary $3', secondaryText: 'Secondary 10.5%' },
    { primaryPercent: false, format: '$1,234', secondaryFormat: '0.000%', primaryText: 'Primary $3', secondaryText: 'Secondary 10.500%' },
  ]) {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'combo',
      data: { categories: data.categories, series: [
        { id: 'p', values: primaryPercent ? [{ pct: 1 }, { pct: 4 }] : [1, 4] },
        { id: 's', kind: 'line', axis: 'secondary', format: secondaryFormat, values: primaryPercent ? [10, 20] : [{ pct: 10 }, { pct: 20 }] },
      ] }, options: { format, secondaryAxis: { acknowledge: true }, annotations: [
        { kind: 'valueLine', id: 'p', value: 2.5, label: 'Primary' },
        { kind: 'valueLine', id: 's', axis: 'secondary', value: 10.5, label: 'Secondary' },
      ] } }));
    if (geometry.refused) throw new Error('combo refused');
    expect(geometry.annotations.find(annotation => annotation.id === 'p')?.computedText).toBe(primaryText);
    expect(geometry.annotations.find(annotation => annotation.id === 's')?.computedText).toBe(secondaryText);
  }
});

// A column Others sum and a column average marker must keep the percent unit of typed percent cells.
it('keeps the percent unit through column Others and the column average marker', () => {
  const data = { categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [{ id: 's', values: [{ pct: 1 }, { pct: 4 }, { pct: 2 }] }] };
  const others = layoutColumn(data, { topN: { n: 1 }, annotations: [{ kind: 'valueLine', value: 2.5, label: 'Plan' }] });
  expect(annOf(others, 'valueLine')?.computedText).toBe('Plan 2.5%');
  const marker = layoutColumn(data, { averageMarker: true }).annotations.find(annotation => annotation.id.startsWith('averageMarker'));
  expect(marker?.computedText).toMatch(/^Average 2\.33?%$/);
});

// A reference at 2.5 must not call itself 3 because the plotted values use an integer format.
it('keeps a value line precise unless its author chooses a format', () => {
  const data = { categories: [{ id: 'a' }, { id: 'b' }], series: [{ id: 's', label: 'Series', values: [1, 4] }] };
  const draw = (value: number, format?: string) => layoutBar(data, {
    size: { width: 640, height: 360 },
    annotations: [{ kind: 'valueLine', value, label: 'Plan', ...(format ? { format } : {}) }],
  });
  expect(annOf(draw(2.5), 'valueLine')?.computedText).toBe('Plan 2.5');
  expect(annOf(draw(2.54), 'valueLine')?.computedText).toBe('Plan 2.54');
  expect(annOf(draw(2.543), 'valueLine')?.computedText).toBe('Plan 2.54');
  expect(annOf(draw(2.543, '1.0000'), 'valueLine')?.computedText).toBe('Plan 2.5430');
  expect(annOf(draw(2.5, '1'), 'valueLine')?.computedText).toBe('Plan 3');
  expect(annOf(layoutBar(data, { format: '1', annotations: [{ kind: 'valueLine', value: 2.5, label: 'Plan' }] }), 'valueLine')?.computedText).toBe('Plan 3');
  expect(annOf(layoutLine(data, { annotations: [{ kind: 'valueLine', value: 2.543, label: 'Plan' }] }), 'valueLine')?.computedText).toBe('Plan 2.54');
  expect(annOf(layoutLine(data, { annotations: [{ kind: 'valueLine', value: 0.034, label: 'Plan' }] }), 'valueLine')?.computedText).toBe('Plan 0.034');
  // The fallback must not drop below the value's own automatic precision: print 0.0049, not <0.01.
  expect(annOf(layoutLine(data, { annotations: [{ kind: 'valueLine', value: 0.00493, label: 'Plan' }] }), 'valueLine')?.computedText).toBe('Plan 0.0049');
  expect(annOf(layoutLine(data, { annotations: [{ kind: 'valueLine', value: 0.0341, label: 'Plan' }] }), 'valueLine')?.computedText).toBe('Plan 0.034');
  expect(annOf(draw(0.0341), 'valueLine')?.computedText).toBe('Plan 0.034');
  const mean = layoutColumn({ categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [{ id: 's', label: 'Series', values: [1, 2, 2] }] }, { averageMarker: true });
  expect(mean.annotations.find(annotation => annotation.id.startsWith('averageMarker'))?.valueText).toBe('1.7');
  expect(renderSvg(draw(2.543) as never, resolveTheme())).toBe(renderSvg(draw(2.543) as never, resolveTheme()));
});

// ---------------------------------------------------------------- --------

describe('yearSpan — the date math nothing covered', () => {
  it('counts an end-of-month anniversary as a whole year', () => {
    expect(yearSpan('2024-02-29', '2025-02-28')).toBe(1);
  });
});

// The ends of an arrow show its span, so years in the oval only widen it and cover more of the line.
it('prints the rate alone on each of several cagr arrows unless period asks for the years', () => {
  const data = {
    categories: [{ id: 'y1', label: '2021', date: '2021-12-31' }, { id: 'y2', label: '2022', date: '2022-12-31' }, { id: 'y3', label: '2024', date: '2024-12-31' }],
    series: [{ id: 'a', label: 'A', values: [100, 120, 160] }],
  };
  const texts = (extra: object) => layoutColumn(data, { annotations: [{ kind: 'cagr', shape: 'arrow', to: 'y2', ...extra }, { kind: 'cagr', shape: 'arrow' }] } as never)
    .annotations.filter((ann) => ann.kind === 'cagr').map((ann) => ann.computedText);
  expect(texts({})).toEqual(['+20.0% p.a.', '+17.0% p.a.']);
  expect(texts({ period: true })[0]).toBe('2021–2022: +20.0% p.a.');
});

// An oval wider than the span would hide the whole arrow, head included, so the bracket must show the span.
it('draws a cagr too short for its oval as a bracket and says so', () => {
  const categories = Array.from({ length: 12 }, (_, i) => ({ id: `y${i}`, label: `${2010 + i}`, date: `${2010 + i}-12-31` }));
  const data = { categories, series: [{ id: 'a', label: 'A', values: categories.map((_, i) => 100 + i) }] };
  const geometry = layoutColumn(data, { size: { width: 480 }, annotations: [{ kind: 'cagr', from: 'y3', to: 'y4', shape: 'arrow' }] } as never);
  expect(codes(geometry)).toContain('cagr-arrow-no-room');
});

// A value line under the oval must not cost the chart its rate: the solver dropped the seat and the whole arrow with it.
it('keeps the rate of a cagr arrow when a value line crosses its oval', () => {
  const data = {
    categories: ['2021', '2022', '2023', '2024'].map((label) => ({ id: `y${label}`, label, date: `${label}-12-31` })),
    series: [{ id: 'a', label: 'A', values: [100, 120, 140, 160] }],
  };
  const geometry = layoutBar(data, { annotations: [{ kind: 'valueLine', value: 170, label: 'Plan' }, { kind: 'cagr', shape: 'arrow' }] } as never);
  expect(codes(geometry)).not.toContain('cagr-arrow-no-room');
  expect(renderSvg(geometry as never, resolveTheme())).toContain('+17.0% p.a.');
});

// An arrow from over an inner layer would read as the growth of the whole stack, so the bracket keeps the rate on that layer.
it('draws a cagr on an inner stack layer as a bracket and says so', () => {
  const data = {
    categories: [{ id: 'y1', label: '2021', date: '2021-12-31' }, { id: 'y2', label: '2024', date: '2024-12-31' }],
    series: [{ id: 'a', label: 'A', values: [40, 50] }, { id: 'b', label: 'B', values: [30, 45] }],
  };
  const geometry = layoutColumn(data, { variant: 'stacked', annotations: [{ kind: 'cagr', from: { categoryId: 'y1', seriesId: 'a' }, to: { categoryId: 'y2', seriesId: 'a' }, shape: 'arrow' }] } as never);
  expect(codes(geometry)).toContain('cagr-arrow-no-room');
  expect(annOf(geometry, 'cagr')?.computedText).toContain('p.a.');
});

describe('a cagr without a usable span must not assert a per-annum rate', () => {
  const fixture = waterfallFixtures.find((item) => item.id === 'ebit-bridge')!;
  // The fixture totals are labelled FY21 and FY24. Since the label-year
  // inference a label that names a year IS a usable span, so
  // the refusal cases relabel the totals to plain words first.
  const unlabelled = (item: Record<string, unknown>) =>
    item.type === 'total' ? { ...item, label: item.id === 'fy21' ? 'Opening' : 'Closing' } : item;
  const withDates = (mapper: (item: Record<string, unknown>, n: number) => unknown) =>
    layoutWaterfall(
      { ...fixture.data, items: fixture.data.items.map((item, n) => mapper(unlabelled(item as never), n)) } as never,
      {
        ...fixture.options,
        annotations: [{ kind: 'cagr' }],
      } as never,
    );

  it('reads the span from fiscal-year labels when the dates are absent, and says so', () => {
    const geometry = layoutWaterfall(
      { ...fixture.data, items: fixture.data.items.map(({ date: _date, ...item }) => item) } as never,
      { ...fixture.options, annotations: [{ kind: 'cagr' }] } as never,
    );
    expect(annOf(geometry, 'cagr')?.computedText).toBe('+5.6% p.a.');
    expect(codes(geometry)).not.toContain('cagr-no-dates');
    expect(codes(geometry)).toContain('cagr-span-from-labels');
  });

  it.each([
    ['absent', (item: Record<string, unknown>) => ({ ...item, date: undefined })],
    ['year only', (item: Record<string, unknown>, n: number) => ({ ...item, date: String(2020 + n) })],
    ['unpadded', (item: Record<string, unknown>, n: number) => ({ ...item, date: `${2020 + n}-1-1` })],
    ['slashed', (item: Record<string, unknown>, n: number) => ({ ...item, date: `01/01/${2020 + n}` })],
  ])('refuses out loud on %s dates instead of printing total growth as "p.a."', (_name, mapper) => {
    const geometry = withDates(mapper as never);
    // A wrong text would be "+17.6% p.a." — the TOTAL growth over the span, annualised
    // by nothing at all. Nothing per-annum may survive.
    expect(annOf(geometry, 'cagr')).toBeUndefined();
    expect(codes(geometry)).toContain('cagr-no-dates');
    const warning = (geometry.warnings ?? []).find((w) => w.code === 'cagr-no-dates')!;
    // The suppressed element leaves a trace that says WHY.
    expect(warning.message).toMatch(/YYYY-MM-DD/);
    expect(warning.suggest).toMatch(/diff/);
  });

  it('refuses a zero-length span rather than dividing by it', () => {
    const geometry = withDates((item: Record<string, unknown>) =>
      item.date === undefined ? item : { ...item, date: '2024-12-31' },
    );
    expect(annOf(geometry, 'cagr')).toBeUndefined();
    expect(codes(geometry)).toContain('cagr-zero-span');
  });
});

// ---------------------- dot with cagr: anchors carry dates ------

describe('dot declares cagr, so its anchors must carry dates', () => {
  const dotData = {
    categories: [
      { id: 'fy21', label: 'FY21', date: '2021-12-31' },
      { id: 'fy24', label: 'FY24', date: '2024-12-31' },
    ],
    series: [{ id: 's', label: 'S', values: [100, 200] }],
  };

  it('annualises over the category dates (100 -> 200 across 3y = +26.0% p.a.)', () => {
    const geometry = layoutDot(dotData as never, { annotations: [{ kind: 'cagr' }] } as never);
    // The bug printed "+100.0% p.a." — the total doubling, because the dot
    // anchors carried no date at all and yearSpan fell back to 1.
    expect(annOf(geometry, 'cagr')?.computedText).toBe('+26.0% p.a.');
  });

  it('refuses rather than fabricates when the dot categories have no dates', () => {
    // Year-bearing labels carry the period, as on every other chart. Dot anchors carry
    // their row label; labels without a year refuse.
    const fromLabels = { ...dotData, categories: dotData.categories.map((c) => ({ id: c.id, label: c.label })) };
    expect(annOf(layoutDot(fromLabels as never, { annotations: [{ kind: 'cagr' }] } as never), 'cagr')?.computedText).toBe('+26.0% p.a.');
    const undated = { ...dotData, categories: dotData.categories.map((c, i) => ({ id: c.id, label: ['North', 'South'][i] })) };
    const geometry = layoutDot(undated as never, { annotations: [{ kind: 'cagr' }] } as never);
    expect(annOf(geometry, 'cagr')).toBeUndefined();
    expect(codes(geometry)).toContain('cagr-no-dates');
  });
});

// ---------------------------------------------------------------- --------

describe('a stacked100 SEGMENT annotation reports the value, not the share', () => {
  const data = {
    categories: [
      { id: 'q1', label: 'Q1', date: '2021-12-31' },
      { id: 'q2', label: 'Q2', date: '2024-12-31' },
    ],
    series: [
      { id: 'a', label: 'A', values: [10, 20] },
      { id: 'b', label: 'B', values: [5, 20] },
    ],
  };
  // q1: a=10 of 15 -> the plotted percentage is 66.7, the value is 10.
  const segmentAbs = [{ kind: 'abs', at: { categoryId: 'q1', seriesId: 'a' } }];
  const segmentCagr = [
    {
      kind: 'cagr',
      from: { categoryId: 'q1', seriesId: 'a' },
      to: { categoryId: 'q2', seriesId: 'a' },
    },
  ];
  // All FOUR composition surfaces, each in its own 100% mode. Whatever the
  // geometry is drawn in, the ANNOTATION must speak absolutes.
  const surfaces: [string, (annotations: unknown) => unknown][] = [
    ['column.stacked100', (a) => layoutColumn(data as never, { variant: 'stacked100', annotations: a } as never)],
    ['bar.stacked100', (a) => layoutBar(data as never, { variant: 'stacked100', annotations: a } as never)],
    ['mekko.stacked100', (a) => layoutMekko(data as never, { variant: 'stacked100', annotations: a } as never)],
    [
      'line.stacked100-area',
      (a) =>
        layoutLine(data as never, {
          variant: 'area',
          valueAxis: { percent: true },
          annotations: a,
        } as never),
    ],
  ];

  it.each(surfaces)('%s reports 10, not the plotted 67', (_name, layout) => {
    expect(annOf(layout(segmentAbs) as never, 'abs')?.computedText).toBe('10');
  });

  it.each(surfaces)('%s runs segment diff math on the VALUE, not the share', (_name, layout) => {
    // a: 10 of 15 (66.7%) -> 20 of 40 (50%). The share FELL; the value ROSE.
    const geometry = layout([
      {
        kind: 'diff',
        mode: 'relative',
        from: { categoryId: 'q1', seriesId: 'a' },
        to: { categoryId: 'q2', seriesId: 'a' },
      },
    ]);
    expect(annOf(geometry as never, 'diff')?.computedText).toBe('+100%');
  });

  // bar, column, mekko, and line all declare cagr; each annualises the VALUE.
  it.each(surfaces)(
    '%s annualises the VALUE, not the share drift',
    (_name, layout) => {
      // a runs 10 -> 20 over exactly 3 years = +26.0% p.a. Its SHARE runs
      // 66.7% -> 50%; annualising the share printed "+6.3% p.a." on
      // line/stacked100-area before this repair. The rate names the series it reads.
      expect(annOf(layout(segmentCagr) as never, 'cagr')?.computedText).toBe('A +26.0% p.a.');
    },
  );

  it('line.stacked100-area keeps the untouched variants and rebase100 honest', () => {
    const plain = layoutLine(data as never, { annotations: segmentAbs } as never);
    expect(annOf(plain, 'abs')?.computedText).toBe('10');
    const stackedArea = layoutLine(data as never, {
      variant: 'stacked-area',
      annotations: segmentAbs,
    } as never);
    expect(annOf(stackedArea, 'abs')?.computedText).toBe('10');
    // rebase100 declares the whole chart an index — there "the value" IS the
    // index, exactly as the point/endpoint labels render it.
    const indexed = layoutLine(data as never, {
      rebase100: true,
      annotations: [{ kind: 'abs', at: { categoryId: 'q2', seriesId: 'a' } }],
    } as never);
    expect(annOf(indexed, 'abs')?.computedText).toBe('200');
  });

  it('leaves the CATEGORY branch and non-stacked100 variants untouched', () => {
    const category = layoutColumn(data as never, {
      variant: 'stacked100',
      annotations: [{ kind: 'abs', at: { categoryId: 'q1' } }],
    } as never);
    expect(annOf(category, 'abs')?.computedText).toBe('15');
    for (const variant of ['stacked', 'grouped'] as const) {
      const geometry = layoutColumn(data as never, { variant, annotations: segmentAbs } as never);
      expect(annOf(geometry, 'abs')?.computedText).toBe('10');
    }
  });
});

// ---------------------------------------------------------------- --------

describe('relative diff must not invert its sign on a negative base', () => {
  const relDiff = (v0: number, v1: number, mode: 'relative' | 'reversed' = 'relative') =>
    layoutColumn(
      {
        categories: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        series: [{ id: 's', label: 'S', values: [v0, v1] }],
      } as never,
      {
        annotations: [{ kind: 'diff', mode, from: { categoryId: 'a' }, to: { categoryId: 'b' } }],
      } as never,
    );

  it.each([
    // base, tip, text, tone — the sign must follow the direction of the move.
    [-100, 50, '+150%', 'neutral'],
    [-100, -50, '+50%', 'neutral'],
    [-100, -200, '−100%', 'bad'],
    [-100, -100, '0%', 'neutral'],
  ])('%d -> %d renders %s (%s)', (v0, v1, text, tone) => {
    const geometry = relDiff(v0 as number, v1 as number);
    const diff = annOf(geometry, 'diff')!;
    expect(diff.computedText).toBe(text);
    expect(diff.tone).toBe(tone);
    expect(codes(geometry)).toContain('diff-negative-base');
  });

  it.each([
    [100, 150, '+50%', 'neutral'],
    [100, 50, '−50%', 'bad'],
    [100, -50, '−150%', 'bad'],
  ])('leaves the positive-base cases byte-identical: %d -> %d = %s', (v0, v1, text, tone) => {
    const geometry = relDiff(v0 as number, v1 as number);
    const diff = annOf(geometry, 'diff')!;
    expect(diff.computedText).toBe(text);
    expect(diff.tone).toBe(tone);
    expect(codes(geometry)).not.toContain('diff-negative-base');
  });

  it('applies the same correction to mode:"reversed"', () => {
    // reversed swaps base/tip: base = -100 (B), tip = 50 (A).
    const geometry = relDiff(50, -100, 'reversed');
    expect(annOf(geometry, 'diff')?.computedText).toBe('+150%');
    expect(codes(geometry)).toContain('diff-negative-base');
  });

  it('still refuses a zero base', () => {
    const geometry = relDiff(0, 50);
    expect(annOf(geometry, 'diff')).toBeUndefined();
    expect(codes(geometry)).toContain('ref-zero');
  });
});

// ---------------------- cagr from a start at or below zero ------

describe('cagr from a start at or below zero omits the rate', () => {
  const cagr = (v0: number, v1: number) =>
    layoutColumn(
      {
        categories: [
          { id: 'a', label: 'A', date: '2021-12-31' },
          { id: 'b', label: 'B', date: '2024-12-31' },
        ],
        series: [{ id: 's', label: 'S', values: [v0, v1] }],
      } as never,
      {
        annotations: [{ kind: 'cagr', from: { categoryId: 'a' }, to: { categoryId: 'b' } }],
      } as never,
    );

  it.each([
    [100, 200, '+26.0% p.a.'],
    [100, 50, '−20.6% p.a.'],
  ])('%d -> %d over 3 years = %s', (v0, v1, text) => {
    expect(annOf(cagr(v0 as number, v1 as number), 'cagr')?.computedText).toBe(text);
  });

  // A sign-flipped rate from a loss read as compound growth.
  it.each([[-100, -200], [-100, -50], [-100, 50], [0, 50]])('omits %d -> %d and warns', (v0, v1) => {
    const geometry = cagr(v0 as number, v1 as number);
    expect(annOf(geometry, 'cagr')).toBeUndefined();
    expect(codes(geometry)).toContain('cagr-undefined');
  });

  // A -100% from an end of zero was drawn while the shared helper refused it, so its receipt failed.
  it.each([[100, 200], [100, 0]])('agrees with the public cagr() and the receipt check for %d -> %d', (v0, v1) => {
    const geometry = cagr(v0 as number, v1 as number);
    const claim = claimsForChart('column', geometry as never).find((c) => c.op === 'annotation-cagr@1')!;
    expect(recomputeClaim(claim).status).toBe('reproduced');
    expect(publicCagr(v0 as number, v1 as number, 3)).toBeCloseTo(claim.output.raw!, 8);
  });
});

// Generated annotations must keep small differences and rates visible while an authored format stays fixed.
it('keeps nonzero automatic annotation values off zero', () => {
  const geometry = layoutColumn({
    categories: [{ id: 'a', label: '2021', date: '2021-01-01' }, { id: 'b', label: '2022', date: '2022-01-01' }],
    series: [{ id: 's', label: 'S', values: [1, 1.000004] }],
  }, { annotations: [
    { id: 'abs-auto', kind: 'diff', mode: 'absolute', from: 'a', to: 'b' },
    { id: 'pct-auto', kind: 'diff', mode: 'relative', from: 'a', to: 'b' },
    { id: 'cagr-auto', kind: 'cagr', from: 'a', to: 'b' },
    { id: 'abs-authored', kind: 'diff', mode: 'absolute', from: 'a', to: 'b', format: '$1,234' },
  ] });
  const text = (id: string) => geometry.annotations.find(annotation => annotation.id === id)?.computedText;
  expect(text('abs-auto')).toBe('+4.0\u00a0×\u00a010⁻⁶');
  expect(text('pct-auto')).toBe('+0.0004%');
  expect(text('cagr-auto')).toBe('+0.0004% p.a.');
  expect(text('abs-authored')).toBe('$0');
});

describe('derived annotation numbers use the chart precision, language and unit', () => {
  const categories = [
    { id: 'a', label: '2021', date: '2021-12-31' },
    { id: 'b', label: '2022', date: '2022-12-31' },
    { id: 'c', label: '2023', date: '2023-12-31' },
  ];

  it('prints small differences with a decimal in the chart language, toned by what they print', () => {
    const geometry = layoutColumn(
      { categories, series: [{ id: 's', label: 'S', values: [1.2, 1.6, 1.62] }] } as never,
      {
        locale: { language: 'de' },
        annotations: [{ kind: 'diff', from: 'a', to: 'b', mode: 'absolute' }, { kind: 'delta', at: 'c', vs: 'b' }],
      } as never,
    );
    expect(annOf(geometry, 'diff')?.computedText).toBe('+0,40');
    expect(annOf(geometry, 'delta')?.computedText).toBe('+0,020');
    // The delta prints +0,020, a visible difference, so it has a direction; only a true zero is neutral.
    expect(annOf(geometry, 'delta')?.tone).toBe('good');
  });

  it('reads a grouped category anchor on one series, not the sum of the group', () => {
    const geometry = layoutColumn(
      {
        categories,
        series: [
          { id: 'rev', label: 'Revenue', values: [100, 130, 160] },
          { id: 'cost', label: 'Cost', values: [100, 90, 70] },
        ],
      } as never,
      { variant: 'grouped', annotations: [{ kind: 'diff', from: 'a', to: 'c' }] } as never,
    );
    expect(annOf(geometry, 'diff')?.computedText).toBe('+60%');
  });

  it('prints the absolute difference of two percent levels in points', () => {
    const geometry = layoutLine(
      { categories, series: [{ id: 'm', label: 'Margin', values: [{ pct: 12.5 }, { pct: 13.1 }, { pct: 15.2 }] }] } as never,
      { annotations: [{ kind: 'diff', from: 'a', to: 'c', mode: 'absolute' }] } as never,
    );
    expect(annOf(geometry, 'diff')?.computedText).toBe('+2.7pp');
  });
});

// ---------------------------------------------------------------- --------

describe('fixed line references remain visible at their authored value', () => {
  it('places a 5x ceiling inside a plot whose data tops out at 4.24', () => {
    const geometry = layoutLine(
      {
        categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        series: [{ id: 'ratio', label: 'Ratio', values: [3.6, 4.24] }],
      } as never,
      {
        seriesLabels: 'none', valueLabels: 'none',
        annotations: [{ kind: 'valueLine', id: 'ceiling', value: 5 }],
      } as never,
    );
    const annotation = geometry.annotations?.find((item) => item.id === 'ceiling');
    const node = geometry.scene.find((item) => annotation?.nodeIds.includes(item.id));
    expect(annotation?.computedText).toBe('5');
    expect(node?.t).toBe('line');
    if (node?.t === 'line') {
      expect(node.y1).toBeGreaterThanOrEqual(geometry.plot.y);
      expect(node.y1).toBeLessThanOrEqual(geometry.plot.y + geometry.plot.h);
    }
  });
});

// Prevents one value from printing two scales: the bar, the React text, the description and the hover card read alike,
// also where a value rolls down ("$1.0 billion" under "$1.0 trillion") and where the engine scale prints "Mrd." on a German chart.
it('prints a magnitude the same on every surface', async () => {
  for (const [format, language, text, value] of [['$1.0 trillion', 'en', '$2.5 trillion', 2.5e12], ['1,0 Bio.', 'de', '2,5 Bio.', 2.5e12], ['1,0M', 'de', '2,5 Bio.', 2.5e12],
    ['$1.0 trillion', 'en', '$1.0 billion', 1e9], [undefined, 'de', '2,5 Mrd.', 2.5e9]] as const) {
    const data = { categories: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], series: [{ id: 's', label: 'Sales', values: [value, value / 6] }] };
    const options = { format, locale: { language, decimal: language === 'de' ? ',' : '.', thousands: language === 'de' ? '.' : ',' }, valueLabels: 'all', size: { width: 640, height: 400 } };
    const request = resolveChartRequest({ type: 'column', data, options } as never);
    const geometry = requireGeometry(layoutResolvedRequest(request));
    const svg = renderSvg(geometry as never, request.theme);
    const react = renderToStaticMarkup(createElement(ColumnChart, { data, ...options, prepared: await prepareChart({ type: 'column', data, options } as never) } as never));
    for (const output of [svg, react]) expect(output, `${format} ${language}`).toContain(`>${text}<`);
    expect(geometry.a11y.desc).toContain(text);
    const record = interactionRecords({ request, geometry, scope: request.scope, claims: [] }).find(entry => entry.target.owner.categoryId === 'a')!;
    // Without a format the card prints the exact source number instead.
    expect(labelCardContent(record, request.locale?.language).rows.map(row => row.text)).toContain(format === undefined ? '2.500.000.000' : text);
  }
});
