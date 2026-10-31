import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getChart } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { runDocLints } from '../src/core/lint';
import { normalizeGridData } from '../src/core/charts/grid/normalize';

// A dense key must leave the plot its furniture budget while keeping every series identifiable.
it('fits 25 long series names inside the furniture budget', () => {
  const series = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, label: `Campaign group ${i + 1} of the autumn promotion`, values: [10 + i, 20 + i, 15 + i, 30 + i] }));
  const spec = { type: 'line',
    data: { categories: ['Q1', 'Q2', 'Q3', 'Q4'].map(id => ({ id })), series },
    options: { title: '25 series', size: { width: 720 } },
  };
  const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest(spec)));
  const tickBand = (geo.derived as { tickBand: { reserved: number } }).tickBand;
  expect((geo.size.height - geo.frame.plotRect!.h + tickBand.reserved) / geo.size.height).toBeLessThanOrEqual(0.4);
  const labels = geo.scene.flatMap(node => node.t === 'text' && node.part === 'legendLabel' ? [node] : []);
  expect(labels).toHaveLength(25);
  expect(new Set(labels.map(node => node.lines.join(' '))).size).toBe(25);
  expect(labels.map(node => node.title ?? node.lines.join(' '))).toEqual(series.map(item => item.label));
  expect(runDocLints({ charts: [{ ...spec, geometry: geo }] }).map(warning => warning.code)).not.toContain('series-unexplained');
  for (const [type, id, text] of [
    ['line', 'line-near-zero-tails', 'Search 25.8'],
    ['mekko', 'zero-total-column', 'Not drawn (total 0 or too thin): Dormant'],
  ] as const) {
    const fixture = getFixtures(type).find(item => item.id === id)!;
    const keyed = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type, data: fixture.data, options: {
      ...fixture.options, target: 'dashboard', size: { width: 400, height: 300 },
    } })));
    expect(keyed.scene.flatMap(node => node.t === 'text' && node.part === 'legendLabel' ? [node.lines.join(' ')] : []), id)
      .toContain(text);
  }
  const full = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'line',
    data: { categories: ['Q1', 'Q2', 'Q3', 'Q4'].map(id => ({ id })), series },
    options: { title: '25 series', size: { width: 720 }, legend: 'top' },
  })));
  expect(full.scene.flatMap(node => node.t === 'text' && node.part === 'legendLabel' ? [node.lines.join(' ')] : []))
    .toEqual(series.map(item => item.label));
});

// A cut that leaves the chart over its budget saves one row and costs every company name.
it('keeps full key names when shortening cannot meet the furniture budget', () => {
  const fixture = getFixtures('column').find(item => item.id === 'stacked-ribbons-rank-flow')!;
  const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'column', data: fixture.data, options: {
    ...fixture.options, target: 'dashboard', size: { width: 400, height: 300 },
  } })));
  const labels = geo.scene.flatMap(node => node.t === 'text' && node.part === 'legendLabel' ? [node.lines.join(' ')] : []);
  expect(labels).toEqual(fixture.data.series.map((item: { id: string; label?: string }) => item.label ?? item.id));
});

// 'Group 1…' could also be Group 10 to 19, so such a key keeps its full names.
it('keeps full key names when a shortened name also starts another', () => {
  const series = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, label: `Kampagnengruppe ${i + 1} der Herbstaktion`, values: [10 + i, 20 + i, 15 + i, 30 + i] }));
  const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'line',
    data: { categories: ['Q1', 'Q2', 'Q3', 'Q4'].map(id => ({ id })), series },
    options: { title: '25 series', size: { width: 360 }, locale: { language: 'de-DE' } },
  })));
  expect(geo.scene.flatMap(node => node.t === 'text' && node.part === 'legendLabel' ? [node.lines.join(' ')] : []))
    .toEqual(series.map(item => item.label));
});

// An authored grid builds its legend from the panels, with the grid's strings, as the core grid does.
describe('authored grid legend', () => {
  it('uses the grid strings in the legend labels', () => {
    const grid = getChart('grid')!;
    const panel = (id: string) => ({ id, type: 'column', options: { signColor: true },
      data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'Delta', values: [3, -2] }] } });
    const geometry = grid.layout(grid.normalize!({ panels: [panel('p1'), panel('p2')] }) as never, {
      legend: 'top', columns: [1, 1], strings: { better: 'Besser', worse: 'Schlechter' }, size: { width: 800, height: 400 },
    } as never) as { scene: { t: string; id: string; lines?: string[] }[] };
    const legend = geometry.scene.filter((node) => node.t === 'text' && node.id.startsWith('frame:legendLabel')).map((node) => node.lines!.join(' '));
    expect(legend).toEqual(expect.arrayContaining(['Delta above 0 (Besser)', 'Delta below 0 (Schlechter)']));
    expect(legend.join(' ')).not.toMatch(/better|worse/);
  });

  // A series that draws markers in a short panel but not in a dense one (over 12 categories) keyed twice, once with a dot.
  it('keys one series once when only some panels draw its markers', () => {
    const grid = getChart('grid')!;
    const panel = (id: string, n: number) => ({ id, type: 'line', title: id, options: { legend: 'none', labels: { series: false } },
      data: { categories: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, label: `M${i}` })),
        series: [{ id: 'rev', label: 'Revenue', values: Array.from({ length: n }, (_, i) => 10 + i) },
          { id: 'cost', label: 'Cost', values: Array.from({ length: n }, (_, i) => 5 + i) }] } });
    const geometry = grid.layout(grid.normalize!({ panels: [panel('short', 6), panel('long', 14)] }) as never, {
      legend: 'top', columns: 2, title: 'Revenue and cost', size: { width: 960 },
    } as never) as { scene: { t: string; id: string; lines?: string[] }[] };
    const legend = geometry.scene.filter((node) => node.t === 'text' && node.id.startsWith('frame:legendLabel')).map((node) => node.lines!.join(' '));
    expect(legend).toEqual(['Revenue', 'Cost']);
    expect(geometry.scene.some((node) => node.id.endsWith(':marker'))).toBe(false);
  });
});

// Two-series panels with no legend option drew coloured bars that nothing named.
it('keys a grid of two-series panels with no legend set, and leaves single-series panels alone', () => {
  const panel = (id: string, series: [string, number[]][]) => ({ id, type: 'column', title: id, options: { variant: 'grouped' },
    data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      series: series.map(([label, values]) => ({ id: label, label, values })) } });
  const keyOf = (panels: unknown[]) => requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'grid', data: { panels },
    options: { title: 'Sales', size: { width: 640 }, sharedAxis: 'none', columns: 2 } })))
    .scene.flatMap(node => node.t === 'text' && node.part === 'legendLabel' ? node.lines : []);
  expect(keyOf([panel('North', [['Sales', [4, 5]], ['Target', [5, 5]]]), panel('South', [['Sales', [3, 4]], ['Target', [4, 4]]])])).toEqual(['Sales', 'Target']);
  expect(keyOf([panel('North', [['Sales', [4, 5]]]), panel('South', [['Returns', [3, 4]]])])).toEqual([]);
});

// A written-out grid coloured a series by its place in each panel, so Online was blue in one panel and navy in the next.
it('colours a series alike in every panel of a written-out grid', () => {
  const cats = ['a', 'b'].map(id => ({ id }));
  const panel = (id: string, column: number, series: Array<[string, number]>) => ({
    id, type: 'column', row: 0, column, options: { variant: 'stacked' },
    data: { categories: cats, series: series.map(([sid, v]) => ({ id: sid, label: sid, values: [v, v + 1] })) },
  });
  const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'grid',
    data: { panels: [panel('p1', 0, [['retail', 3], ['online', 2], ['wholesale', 1]]), panel('p2', 1, [['online', 2], ['wholesale', 1]])] },
    options: { columns: 2, legend: 'top' },
  })));
  const fills = new Map<string, Set<string>>();
  for (const node of geo.scene) {
    if (node.t !== 'rect' || node.part !== 'segment' || !node.owner?.seriesId) continue;
    fills.set(node.owner.seriesId, (fills.get(node.owner.seriesId) ?? new Set()).add(JSON.stringify(node.fill)));
  }
  expect([...fills.keys()].sort()).toEqual(['online', 'retail', 'wholesale']);
  for (const [id, set] of fills) expect(set.size, id).toBe(1);
});

// A colorRole on every series would override the authored highlight, so a panel that sets one keeps its series as written.
it('keeps the authored highlight of slope panels in a written-out grid', () => {
  const panel = (id: string, column: number, ids: string[]) => ({
    id, type: 'slope', row: 0, column, options: { highlight: 'acme' },
    data: {
      categories: [{ id: 'y1', label: '2020' }, { id: 'y2', label: '2025' }],
      series: ids.map((sid, i) => ({ id: sid, label: sid, values: [10 + i, 20 - i] })),
    },
  });
  const data = { panels: [panel('n', 0, ['acme', 'beta', 'gamma']), panel('s', 1, ['beta', 'acme', 'gamma'])] };
  for (const p of normalizeGridData(data).panels) {
    expect((p.data as { series: Array<{ colorRole?: string }> }).series.some((s) => s.colorRole !== undefined)).toBe(false);
  }
});
