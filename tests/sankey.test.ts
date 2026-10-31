import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { renderSvg } from '../src/core/svg/renderSvg';
import { requireGeometry } from '../src/core/sizing';
import { specFromRows } from '../src/rows';
import type { SankeyData, SankeyDerived } from '../src/core/charts/sankey/types';

const draw = (data: SankeyData, options: Record<string, unknown> = {}) => {
  const request = resolveChartRequest({ type: 'sankey', data, options: { title: 'Flows', size: { width: 640, height: 400 }, ...options } });
  const geometry = requireGeometry(layoutResolvedRequest(request));
  return { svg: renderSvg(geometry, request.theme), derived: geometry.derived as unknown as SankeyDerived };
};

// Nodes listed in an order whose links all cross: the 'flow' order must remove the crossings, and the same input must draw the same bytes.
it('orders nodes to remove crossings and draws identical input to identical SVG', () => {
  const data: SankeyData = {
    links: [{ source: 'a', target: 'z', value: 50 }, { source: 'b', target: 'y', value: 40 }, { source: 'c', target: 'x', value: 30 }],
    nodes: ['a', 'b', 'c', 'x', 'y', 'z'].map((id) => ({ id })),
  };
  const flow = draw(data);
  expect(flow.derived.crossings).toBe(0);
  expect(draw(data, { order: 'data' }).derived.crossings).toBeGreaterThan(0);
  expect(draw(structuredClone(data)).svg).toBe(flow.svg);
});

// Folding small nodes into Other must keep every column's total and keep each folded node and value readable.
it('keeps column totals when small nodes fold into Other', () => {
  const links = [
    { source: 'big', target: 'mid', value: 900 }, { source: 'tiny1', target: 'mid', value: 5 }, { source: 'tiny2', target: 'end2', value: 7 },
    { source: 'mid', target: 'end1', value: 600 }, { source: 'mid', target: 'end2', value: 300 },
  ];
  const kept = draw({ links }, { other: false }).derived;
  const folded = draw({ links }).derived;
  expect(folded.stages.map((stage) => stage.total)).toEqual(kept.stages.map((stage) => stage.total));
  const other = folded.nodes.find((node) => node.members);
  expect(other?.members).toEqual([{ id: 'tiny1', label: 'tiny1', value: 5 }, { id: 'tiny2', label: 'tiny2', value: 7 }]);
  expect(other?.value).toBe(12);
});

// SQL keys are often integers: the rows helper must turn them into node and stage ids, not leave them for the schema to refuse.
it('maps rows with integer keys and stages to stage-qualified links', () => {
  const { spec } = specFromRows({ type: 'sankey' }, {
    rows: [{ m: 202601, n: 202602, a: 1, b: 2, v: 10 }, { m: 202601, n: 202602, a: 1, b: 1, v: 30 }],
    columns: { source: 'a', target: 'b', value: 'v', sourceStage: 'm', targetStage: 'n' },
  });
  expect(spec.data.links).toEqual([
    { source: '1', target: '2', value: 10, sourceStage: '202601', targetStage: '202602' },
    { source: '1', target: '1', value: 30, sourceStage: '202601', targetStage: '202602' },
  ]);
  expect(draw(spec.data as unknown as SankeyData).derived.nodes.map((node) => node.key)).toEqual(['202601:1', '202602:1', '202602:2']);
});

// A percent format belongs to the shares, so cards must not print flows as percents; tiny flows must not round to 0.
it('keeps flow values in cards under a share format, and tiny flows nonzero', async () => {
  const { interactionRecords } = await import('../src/core/a11y/records');
  const request = resolveChartRequest({ type: 'sankey', data: { links: [{ source: 'a', target: 'b', value: 400 }, { source: 'a', target: 'c', value: 600 }] },
    options: { nodeValue: 'value-share', format: '0.0%', unit: 'customers', size: { width: 640, height: 400 } } });
  const records = interactionRecords({ request, geometry: requireGeometry(layoutResolvedRequest(request)), scope: request.scope, claims: [] });
  const node = records.find((record) => record.label === 'b')!;
  expect(node.value).toMatchObject({ raw: 400, unit: 'customers' });
  expect(node.value.format).toBeUndefined();
  expect(draw({ links: [{ source: 'a', target: 'b', value: 0.0000004 }] }).derived.links[0]!.value).toBe(0.0000004);
  expect(() => specFromRows({ type: 'sankey' }, { rows: [{ s: 'a', t: 'b', v: 0.25 }], columns: { source: 's', target: 't', value: 'v', valueKind: 'fraction' } })).toThrow(/valueKind must be number/);
});

// wide gutters left no room between the columns, so the flow ran backward without a refusal.
it('refuses with the width it needs instead of drawing a flow backward', () => {
  const request = resolveChartRequest({ type: 'sankey', data: { links: [{ source: 'a', target: 'b', value: 123456789012345 }] },
    options: { format: '0,000', size: { width: 280, height: 320 } } });
  expect(JSON.stringify(layoutResolvedRequest(request))).toMatch(/size-below-floor/);
});

// A ribbon carries its flow value: drawn at the ribbon alpha, a pale node colour left it under the light-page mark floor (1.4:1).
it('draws every ribbon on a light page at or above the mark floor', async () => {
  const { paintColor } = await import('../src/core/theme');
  const { compositeColor, contrastRatio, mixColors } = await import('../src/core/color');
  const request = resolveChartRequest({ type: 'sankey', data: {
    nodes: [{ id: 'a', fill: '#8FD3F7' }, { id: 'b' }, { id: 'c' }],
    links: [{ source: 'a', target: 'b', value: 60 }, { source: 'a', target: 'c', value: 40 }],
  }, options: { title: 'Flows', size: { width: 640, height: 400 } } });
  const geometry = requireGeometry(layoutResolvedRequest(request));
  const page = request.theme.color.background;
  const ribbons = geometry.scene.filter((node) => node.part === 'sankeyLink');
  expect(ribbons).toHaveLength(2);
  for (const node of ribbons) {
    if (node.t !== 'path' || !node.fill) throw new Error('ribbon without fill');
    const drawn = mixColors(compositeColor(paintColor(request.theme, node.fill), page), page, node.opacity ?? 1);
    expect(contrastRatio(drawn, page)).toBeGreaterThanOrEqual(1.4);
  }
});

// A source node in a later stage still counts: the total is what flows in from outside, not the first column's sum.
it('totals every source node, also one in a later column', () => {
  const links = [
    { source: 'a', target: 'b', value: 10, sourceStage: 's1', targetStage: 's2' },
    { source: 'n', target: 'c', value: 90, sourceStage: 's2', targetStage: 's3' },
    { source: 'b', target: 'c', value: 10, sourceStage: 's2', targetStage: 's3' },
  ];
  const request = resolveChartRequest({ type: 'sankey', data: { links }, options: { title: 'Flows', size: { width: 640, height: 400 } } });
  const geometry = requireGeometry(layoutResolvedRequest(request));
  expect((geometry.derived as unknown as SankeyDerived).total).toBe(100);
  expect(geometry.a11y.desc).toContain('total 100');
});

// A folded Other node that is part source and part target must not change the total: 1 + 100 + 1 flow in from outside.
it('keeps the total when a source folds into an Other node that has inflow', () => {
  const st = (source: string, target: string, value: number, s: string, t: string) => ({ source, target, value, sourceStage: s, targetStage: t });
  const links = [st('a', 'b', 1, 's1', 's2'), st('b', 'c', 1, 's2', 's3'), st('n', 'c', 100, 's2', 's3'), st('m', 'c', 1, 's2', 's3')];
  for (const options of [{}, { other: { share: 0.1 } }]) {
    const request = resolveChartRequest({ type: 'sankey', data: { links }, options: { title: 'Flows', size: { width: 640, height: 400 }, ...options } });
    const geometry = requireGeometry(layoutResolvedRequest(request));
    expect((geometry.derived as unknown as SankeyDerived).total).toBe(102);
    expect(geometry.a11y.desc).toContain('total 102');
  }
});
