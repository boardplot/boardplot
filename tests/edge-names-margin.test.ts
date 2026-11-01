import { describe, expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { render } from '../src/cli/render';
import { claimsForChart } from '../src/core/claims';
import { layoutColumn } from '../src/core/charts/column/layout';
import type { LintWarning } from '../src/core/types/scene';

// A stacked column chart names four layers at the right edge (invented data).
const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const cohorts = ['Sep 25', 'Oct 25', 'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26'];
const spec = (right: number) => ({
  type: 'column',
  data: {
    categories: months.map((label) => ({ id: label.toLowerCase(), label })),
    series: cohorts.map((label, i) => ({ id: `c${i}`, label, values: months.map((_, c) => (c < i ? 0 : 400 + 30 * i - 10 * (c - i))) })),
  },
  options: {
    variant: 'stacked', format: '1,234', legend: 'none', title: false, labels: { segment: false }, grandTotalLabels: true,
    seriesLabels: { at: 'right-edge', only: ['c3', 'c6', 'c9', 'c11'] },
    size: { width: 560, height: 280 }, target: 'dashboard', canvas: { margin: { top: 0, right, bottom: 0, left: 0 } },
  },
});

describe('right-edge series names', () => {
  // Grouped columns must keep their series identifiable when authored edge names cannot draw.
  it('keys grouped series when their authored edge names cannot draw', () => {
    const data = {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [
        { id: 'a', label: 'Alpha', values: [10, 12] },
        { id: 'b', label: 'Beta', values: [8, 9] },
      ],
    };
    for (const at of ['left-edge', 'right-edge'] as const) {
      const options = { variant: 'grouped', legend: 'none', seriesLabels: { at } } as const;
      const grouped = layoutColumn(data, options);
      expect(grouped.legend?.items.map(item => item.id)).toEqual(['a', 'b']);
      expect(grouped.scene.flatMap(node => node.t === 'text' && node.part === 'legendLabel' ? [node.lines.join(' ')] : []))
        .toEqual(['Alpha', 'Beta']);
      expect(grouped.legend!.rect.y + grouped.legend!.rect.h).toBeLessThanOrEqual(grouped.plot.y);
      expect(grouped.warnings.map(warning => warning.code)).toContain('series-labels-ignored');
      const single = { ...data, series: [data.series[0]!, { ...data.series[1]!, role: 'reference' as const }] };
      expect(layoutColumn(single, options).legend).toBeUndefined();
      expect(layoutColumn(data, { ...options, seriesLabels: undefined }).legend).toBeUndefined();
      const panelOptions = { ...options, typeClass: 'M' as const };
      expect(layoutColumn(data, panelOptions).legend).toBeUndefined();
      const bottom = layoutColumn(data, { ...options, legend: 'bottom' });
      expect(bottom.legend!.rect.y).toBeGreaterThanOrEqual(bottom.plot.y + bottom.plot.h);
      for (const variant of ['stacked', 'stacked100'] as const) {
        const stacked = layoutColumn(data, { ...options, variant });
        expect(stacked.legend).toBeUndefined();
        expect(stacked.labels.filter(label => label.id.startsWith('seriesEdge:') && !label.hidden)).toHaveLength(2);
        expect(stacked.warnings.map(warning => warning.code)).not.toContain('series-labels-ignored');
      }
      expect(options.legend).toBe('none');
    }
  });

  // 0.43 widened default columns after the names took their room, so at a 0 px
  // canvas margin three of the four names ran past the canvas and were hidden.
  it('draw at a zero canvas margin as they do at 8 px', () => {
    for (const right of [0, 8]) {
      const svg = (render({ spec: spec(right), return: ['svg'] }).body as { svg: string }).svg;
      expect(['Dec 25', 'Mar 26', 'Jun 26', 'Aug 26'].filter((name) => !svg.includes(`>${name}<`)), `margin ${right}`).toEqual([]);
    }
  });

  // A key took over from edge names that did not fit, and the series CAGRs went with them, unwarned.
  it('leave their CAGR to the key when the key names the series', () => {
    const fixture = getFixtures('column').find((f) => f.id === 'stacked-series-cagr')!;
    const request = { type: 'column', data: fixture.data, options: { ...fixture.options, legend: 'top' } };
    const { svg } = render({ spec: request, return: ['svg'] }).body as { svg: string };
    expect(svg).toContain('>Product B +10.1% p.a.<');
    const geometry = layoutColumn(request.data as never, request.options as never);
    const claim = claimsForChart('column', geometry).find((item) => item.id.includes('seriesCagr:b'))!;
    const node = geometry.scene.find((item) => item.id === claim.nodeId);
    expect(node?.t === 'text' ? node.lines.join(' ') : undefined).toBe('Product B +10.1% p.a.');
  });
});

describe('line end names under legend none', () => {
  // Prevents a key fallback from naming only one overridden setting or promising an unverified layout change.
  it('names both overridden settings without promising a size-blind key repair', () => {
    const request = { type: 'line', data: { categories: ['2021', '2022', '2023', '2024', '2025'],
      series: ['North America enterprise accounts', 'Western Europe mid-market accounts', 'Asia Pacific small business accounts', 'Latin America public sector accounts']
        .map((label, i) => ({ id: `s${i}`, label, values: [10, 12, 14, 15, 17].map(v => v - 3 * i) })),
    }, options: { title: 'Regional accounts grew', unit: 'count', legend: 'none', seriesLabels: 'end', size: { width: 420 } } };
    const body = render({ spec: request, return: ['svg'] }).body as { warnings: LintWarning[] };
    const warning = body.warnings.find(w => w.code === 'legend-none-overridden')!;
    expect(warning.message).toContain('seriesLabels');
    expect(warning.suggest).toContain('seriesLabels');
    expect(warning.suggest).toContain('legend');
    expect(warning.fix).toBeUndefined();
  });
  // four long end names under legend 'none' squeezed a 420 px line to 35% of the width with only warnings;
  // at 600 px the forced key went to the side and the plot stayed under its floor.
  it('fall back to the key row and warn instead of starving the plot', () => {
    const series = ['North America enterprise accounts', 'Western Europe mid-market accounts', 'Asia Pacific small business accounts', 'Latin America public sector accounts']
      .map((label, i) => ({ id: `s${i}`, label, values: [10, 12, 14, 15, 17].map((v) => v - 3 * i) }));
    for (const width of [420, 600]) {
      const body = render({ spec: { type: 'line', data: { categories: ['2021', '2022', '2023', '2024', '2025'].map((id) => ({ id })), series },
        options: { title: 'Accounts', legend: 'none', size: { width } } }, return: ['svg'] }).body as { svg: string; warnings: { code: string }[] };
      const codes = body.warnings.map((warning) => warning.code);
      expect(codes, `${width} px`).toContain('legend-none-overridden');
      expect(codes, `${width} px`).not.toContain('plot-ratio-under-floor');
    }
  });

  // end names that start inside the plot's half-step were not counted as a right label column,
  // so the lint held the plot to 0.72 where the layout's key override uses 0.62.
  it('count as a right label column in the width floor', () => {
    const series = ['NorthernEuropeWholesaleGrp', 'SouthernEuropeRetailPartne', 'NorthAmericaDirectOnlineCh', 'AsiaPacificDistributorsGrp']
      .map((label, i) => ({ id: `s${i}`, label, values: [10, 12, 13, 15, 16, 18].map((v) => v - 3 * i) }));
    const body = render({ spec: { type: 'line', data: { categories: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'].map((id) => ({ id })), series },
      options: { title: 'Regions', legend: 'none', size: { width: 640 } } }, return: ['svg'] }).body as { warnings: { code: string }[] };
    expect(body.warnings.map((warning) => warning.code)).not.toContain('plot-ratio-under-floor');
    // any label that crossed the plot's right edge counted as a column, so a column chart's net line label lowered its floor.
    const net = getFixtures('column').find((f) => f.id === 'stacked-net-line-negatives')!;
    const column = render({ spec: { type: 'column', data: net.data, options: { ...net.options, size: { width: 320 } } }, return: ['svg'] }).body as { warnings: { code: string }[] };
    expect(column.warnings.map((warning) => warning.code)).toContain('plot-ratio-under-floor');
  });

  // a key that replaced the author's seriesLabels 'end' or 'inline' reported at info, so the authored option was dropped without a warning.
  it('warn when a key replaces authored series names and inform when it replaces the default', () => {
    const severity = (labels: string[], seriesLabels?: string) => {
      const series = labels.map((label, i) => ({ id: `s${i}`, label, values: [10 + 3 * i, 12, 14, 15, 17 + 0.1 * i] }));
      const body = render({ spec: { type: 'line', data: { categories: ['2021', '2022', '2023', '2024', '2025'].map((id) => ({ id })), series },
        options: { title: 'Accounts', size: { width: 480, height: 200 }, ...(seriesLabels ? { seriesLabels } : {}) } }, return: ['svg'] }).body as { warnings: { code: string; severity: string }[] };
      return body.warnings.filter((warning) => warning.code === 'line-end-label-key').map((warning) => warning.severity);
    };
    const converging = ['North region accounts', 'West region accounts', 'Asia region accounts'];
    expect(severity(converging)).toEqual(['info']);
    expect(severity(converging, 'end')).toEqual(['warn']);
    expect(severity(['North America enterprise accounts', 'Western Europe mid-market accounts', 'Asia Pacific small business accounts', 'Latin America public sector accounts'], 'inline')).toEqual(['warn']);
  });

  // A pinned end label is the author's seat: the key fallback once dropped it and warned unknown-label-pin.
  it('keep a pinned end label in place of the key row', () => {
    const series = ['North America enterprise accounts', 'Western Europe mid-market accounts', 'Asia Pacific small business accounts', 'Latin America public sector accounts']
      .map((label, i) => ({ id: `s${i}`, label, values: [10, 12, 14, 15, 17].map((v) => v - 3 * i) }));
    const body = render({ spec: { type: 'line', data: { categories: ['2021', '2022', '2023', '2024', '2025'].map((id) => ({ id })), series },
      options: { title: 'Accounts', legend: 'none', size: { width: 420 }, labelPlacements: { 'series:s0': 'lineEnd' } } }, return: ['svg'] }).body as { svg: string; warnings: { code: string }[] };
    const codes = body.warnings.map((warning) => warning.code);
    expect(codes).not.toContain('legend-none-overridden');
    expect(codes).not.toContain('unknown-label-pin');
    expect(body.svg).toContain('data-id="label:series:s0"');
  });

  // Two ends that crowd took their values into their names, while a third line apart printed its value over its
  // point and its name alone in the column: two labels for one series, two forms in one chart.
  it('give every name at the last category its value once one name takes it', () => {
    const series = [
      { id: 'spend', label: 'Ad spend', values: [3400, 2863, 2769, 2708] },
      { id: 'ids', label: 'Click ids', values: [3100, 2918, 2823, 2741] },
      { id: 'clicks', label: 'Outbound clicks', values: [2800, 2062, 2096, 2182] },
    ];
    const svg = (render({ spec: { type: 'line', data: { categories: ['d1', 'd2', 'd3', 'd4'].map((id) => ({ id })), series },
      options: { title: 'Clicks', size: { width: 960 } } }, return: ['svg'] }).body as { svg: string }).svg;
    expect(svg).not.toContain('data-id="label:point:clicks:d4"');
    expect(svg).toMatch(/data-id="label:series:clicks"[^>]*><tspan>Outbound clicks <\/tspan><tspan>2,182</);
  });
});
