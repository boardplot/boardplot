import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';

const notation = (id: string): string => {
  const { data, options } = getFixtures('diagram').find((entry) => entry.id === id)!;
  return (render({ spec: { type: 'diagram', data, options: { ...options, theme: 'notation' } } as any, format: 'svg', return: ['svg'] } as any).body as any).svg;
};
const texts = (svg: string, part: string): string[] =>
  [...svg.matchAll(new RegExp(`<text[^>]*data-part="${part}"[^>]*>(.*?)</text>`, 'g'))].map((match) => match[1]!.replace(/<[^>]+>/g, ''));

describe('diagram text under the notation unit', () => {
  // Notation's 4 px unit left no room for callout digits and group titles: the discs drew blank and the frames drew a gap with no title.
  it('draws callout digits and group titles', () => {
    expect(texts(notation('nested-service'), 'diagramBadge')).toEqual(['1', '2']);
    expect(texts(notation('journey-attribution'), 'diagramGroup')).toContain('Personal data');
    expect(texts(notation('portfolio-health-sampler'), 'diagramGroup')).toContain('On track');
  });
});

describe('architecture columns', () => {
  // An eight-step chain at 1600 px wrapped its last node to a second row and dropped the long labels between the steps.
  it('keeps a chain in one row where its nodes fit, and draws the labels between them', () => {
    const steps = Array.from({ length: 8 }, (_, index) => ({ id: `n${index + 1}`, kind: 'entity', shape: { kind: 'roundedRect' }, label: `Step ${index + 1}`, role: 'primary' }));
    const verbs = ['Request', 'Validated order', 'Approved', 'Scheduled job', 'Processed', 'Shipped goods', 'Delivered'];
    const edges = verbs.map((verb, index) => ({ id: `e${index + 1}`, source: { nodeId: `n${index + 1}` }, target: { nodeId: `n${index + 2}` }, label: `${verb} and then more detail text` }));
    const spec = { type: 'diagram', data: { nodes: steps, edges }, options: { variant: 'architecture', title: 'Eight step chain', source: 'Invented', size: { width: 1600 } } };
    const geometry = layoutResolvedRequest(resolveChartRequest(spec as never)) as any;
    expect(new Set(geometry.marks.nodes.map((node: any) => node.rect.y)).size).toBe(1);
    expect(geometry.labels.filter((label: any) => label.id.startsWith('edge-label:') && !label.hidden)).toHaveLength(7);
  });

  // At 720 px the column cap kept a nested zone in one band, every such layout failed to route, and the
  // band break that drew at 480 px was never tried, so the wider canvas was refused.
  it('still tries the band break of a narrower width, so a wider canvas still draws', () => {
    const node = (id: string, label: string, groupId: string, track: string) => ({ id, kind: 'step', shape: { kind: 'rectangle' }, label: `${label} and its much longer descriptive name`, groupId, track });
    const spec = (width: number) => ({ type: 'diagram', data: {
      groups: [{ id: 'public', title: 'Public edge' }, { id: 'region', title: 'Hosting region' }, { id: 'cluster', title: 'Service cluster', parentId: 'region' },
        { id: 'runtime', title: 'Protected runtime', parentId: 'cluster' }, { id: 'data', title: 'Data stores', parentId: 'region' }],
      nodes: [node('gateway', 'API gateway', 'public', 'request'), node('router', 'Request router', 'cluster', 'request'), node('workers', 'Model workers', 'runtime', 'request'),
        node('keys', 'Key service', 'runtime', 'state'), node('sessions', 'Session store', 'data', 'request'), node('ledger', 'Audit ledger', 'data', 'state')],
      edges: [
        { id: 'in', source: { nodeId: 'gateway' }, target: { nodeId: 'router' } },
        { id: 'run', source: { nodeId: 'router' }, target: { nodeId: 'workers' } },
        { id: 'seal', source: { nodeId: 'keys' }, target: { nodeId: 'workers' }, label: 'Keys and its much longer descriptive name' },
        { id: 'write', source: { nodeId: 'workers' }, target: { nodeId: 'sessions' } },
        { id: 'audit', source: { groupId: 'runtime' }, target: { nodeId: 'ledger' }, label: 'Audit trail and its much longer descriptive name' },
      ],
    }, options: { variant: 'architecture', title: 'Only the runtime reads the keys', size: { width } } });
    for (const width of [480, 720]) expect((render({ spec: spec(width), format: 'svg' } as never).body as any).ok, `${width} px`).toBe(true);
  });

  // A wide edge label asked for room in a row gutter already as tall as it needs, so nothing grew:
  // the diagram drew at 400 px and was refused at 440 px.
  it('seats a wide edge label in a row that can still grow, so a wider canvas still draws', () => {
    const node = (id: string, label: string, groupId: string, track: string, shape = 'rectangle') => ({ id, kind: 'step', shape: { kind: shape }, label: `${label} and its much longer descriptive name`, groupId, track });
    const label = (text: string) => `${text} and its much longer descriptive name`;
    const spec = (width: number) => ({ type: 'diagram', theme: 'notation', data: {
      groups: [{ id: 'intake', title: 'Regional intake and validation services' }, { id: 'core', title: 'Central settlement and reconciliation platform' }],
      nodes: [{ ...node('gateway', 'Cross-border payment instruction gateway', 'intake', 'main'), secondaryLabel: 'Validates every incoming instruction' },
        node('screen', 'Sanctions and counterparty screening service', 'intake', 'side'),
        node('ledger', 'Multi-currency general ledger posting engine', 'core', 'main', 'store'), node('recon', 'End-of-day reconciliation and exception workbench', 'core', 'side')],
      edges: [
        { id: 'post', source: { nodeId: 'gateway' }, target: { nodeId: 'ledger' }, label: label('Validated instructions') },
        { id: 'check', source: { nodeId: 'gateway' }, target: { nodeId: 'screen' } },
        { id: 'match', source: { nodeId: 'ledger' }, target: { nodeId: 'recon' }, label: label('Posted entries') },
        { id: 'reject', source: { nodeId: 'recon' }, target: { nodeId: 'gateway' }, label: label('Rejected items'), flow: 'return', dash: 'dashed' },
      ],
    }, options: { variant: 'architecture', title: 'Every payment passes screening before it posts', size: { width }, target: 'print' } });
    for (const width of [400, 440]) expect((render({ spec: spec(width), format: 'svg' } as never).body as any).ok, `${width} px`).toBe(true);
  });
});

describe('diagram inset heading and columns', () => {
  const fixture = getFixtures('diagram').find((entry) => entry.id === 'inset-no-heading')!;
  const body = (inset: object) => render({ spec: { type: 'diagram', data: { ...(fixture.data as object), inset: { title: 'Service levels', rows: [{ label: 'Failed loads', value: '3' }], ...inset } }, options: fixture.options } as never, format: 'svg' } as never).body as any;
  // The title must leave the drawing and stay the accessible name.
  it('draws no title and keeps it as the accessible name', () => {
    const { svg } = body({ heading: false });
    expect(svg.replace(/<(title|desc)[^>]*>.*?<\/\1>/gs, '')).not.toContain('Service levels');
    expect(svg).toContain('Service levels');
  });
  // Right-aligned names must share one edge, also where the values differ in width.
  it('aligns the inset names to one edge', () => {
    const inset = { title: 'Service levels', rows: [{ label: 'Failed loads', value: '3' }, { label: 'Tables', value: '41 of 44' }], columnOverrides: { label: { align: 'right' } } };
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'diagram', data: { ...(fixture.data as object), inset }, options: { ...fixture.options, size: { width: 960 } } } as never)) as any;
    const rects = geometry.labels.filter((label: any) => /inset-label:row:\d+:label/.test(label.id)).map((label: any) => label.rect);
    expect(rects).toHaveLength(2);
    expect(Math.abs(rects[0].x + rects[0].w - rects[1].x - rects[1].w)).toBeLessThanOrEqual(1);
  });
  // The helper's warning says options; the inset lives in data, so a fix must point there.
  it('warns on a wrong column under data.inset', () => {
    const warning = body({ columnOverrides: { nope: { width: 90 } } }).warnings.find((item: any) => item.code === 'generated-id-unknown');
    expect(warning.path).toBe('/data/inset/columnOverrides/nope');
  });
});

describe('diagram edge labels', () => {
  // An edge label that found no seat was left out of the drawing while the reading counted no dropped label.
  it('counts an edge label it cannot seat as dropped in the reading', () => {
    const node = (id: string, label: string, x: number, y: number) => ({ id, kind: 'entity', shape: { kind: 'roundedRect' }, label, position: { x, y } });
    const edge = (id: string, target: string, label: string) => ({ id, source: { nodeId: 'r' }, target: { nodeId: target }, label, routing: 'straight' });
    const spec = { type: 'diagram', data: {
      nodes: [node('r', 'Root', 0.5, 0.1), node('a', 'Alpha', 0.3, 0.5), node('b', 'Beta', 0.7, 0.5), node('c', 'Gamma', 0.5, 0.9)],
      edges: [
        edge('e1', 'a', 'A very long edge label that cannot fit anywhere near this short route at all'),
        edge('e2', 'b', 'Another very long label that also cannot find a clear place near the route'),
        edge('e3', 'c', 'Third long label crossing the others in a tight space of the drawing'),
      ],
    }, options: { variant: 'hierarchy', title: 'Unplaced edge labels', source: 'Invented' } };
    const body = render({ spec, format: 'svg', return: ['reading'] } as never).body as any;
    const unseated = body.warnings.filter((warning: any) => warning.code === 'diagram-edge-label-unplaced').map((warning: any) => `edge-label:${warning.owner.segmentId}`);
    expect(unseated.length).toBeGreaterThan(0);
    expect(body.reading.labelsDropped).toBeGreaterThanOrEqual(unseated.length);
    expect(body.reading.omissions.map((omission: any) => omission.labelId)).toEqual(expect.arrayContaining(unseated));
  });
});

describe('diagram hierarchy group titles', () => {
  // A group title that grew over a neighbouring branch covered that branch's edge entry, so 840 px refused what 600 px drew.
  it('keeps a widened group title clear of a neighbour edge, so a wider canvas still draws', () => {
    const branch = (index: number, groupId?: string) => ({ id: `b${index}`, kind: 'entity', shape: { kind: 'roundedRect' }, label: `Branch ${index} and its much longer descriptive name`, ...(groupId ? { groupId } : {}) });
    const spec = (width: number) => ({ type: 'diagram', data: {
      nodes: [{ id: 'root', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Root and its much longer descriptive name' }, branch(1), branch(2), branch(3, 'group'), branch(4)],
      groups: [{ id: 'group', title: 'An invented group title that needs two lines', role: 'secondary' }],
      edges: [1, 2, 3, 4].map((index) => ({ id: `e${index}`, source: { nodeId: 'root' }, target: { nodeId: `b${index}` } })),
    }, options: { variant: 'hierarchy', size: { width } } });
    for (const width of [600, 840]) expect((render({ spec: spec(width), format: 'svg' } as never).body as any).ok, `${width} px`).toBe(true);
  });
});

describe('diagram perimeter ports', () => {
  // The clockwise perimeter walk from top centre measured a full width before the top-right corner, pushing ports past the corner outside the node and skipping the left half of the top edge.
  it('places every perimeter fraction clockwise from top centre on the node boundary with its outward normal', () => {
    const cases = [
      [0, { x: 0, y: -1 }],
      [0.1, { x: 0, y: -1 }],
      [0.25, { x: 1, y: 0 }],
      [0.3, { x: 0, y: 1 }],
      [0.6, { x: 0, y: 1 }],
      [0.75, { x: -1, y: 0 }],
      [0.9, { x: 0, y: -1 }],
      [1, { x: 0, y: -1 }],
    ] as const;
    for (const [perimeter, normal] of cases) {
      const spec = {
        type: 'diagram',
        data: {
          nodes: [
            { id: 'mix', kind: 'entity', shape: { kind: 'rectangle' }, label: 'Mix', position: { x: 0.3, y: 0.5 }, size: { width: 280, height: 60 }, ports: [{ id: 'q', at: { perimeter } }] },
            { id: 'bake', kind: 'entity', shape: { kind: 'rectangle' }, label: 'Bake', position: { x: 0.8, y: 0.5 } },
          ],
          edges: [{ id: 'm2b', source: { nodeId: 'mix', portId: 'q' }, target: { nodeId: 'bake' } }],
        },
        options: { variant: 'hierarchy', title: 'Bread steps', size: { width: 640, height: 300 } },
      };
      const geometry = layoutResolvedRequest(resolveChartRequest(spec as never)) as any;
      expect(geometry.warnings, `perimeter ${perimeter}`).toEqual([]);
      const mix = geometry.marks.nodes.find((node: any) => node.id === 'mix');
      const rect = mix.rect;
      const port = mix.ports[0];
      const start = geometry.marks.edges[0].route.points[0];
      expect(start, `perimeter ${perimeter}`).toEqual(port.point);
      expect(port.normal, `perimeter ${perimeter}`).toEqual(normal);
      const onSide = normal.x !== 0
        ? port.point.x === (normal.x > 0 ? rect.x + rect.w : rect.x)
        : port.point.y === (normal.y > 0 ? rect.y + rect.h : rect.y);
      expect(onSide && port.point.x >= rect.x && port.point.x <= rect.x + rect.w && port.point.y >= rect.y && port.point.y <= rect.y + rect.h, `perimeter ${perimeter}`).toBe(true);
      if (perimeter === 0 || perimeter === 1) expect(port.point).toEqual({ x: rect.x + rect.w / 2, y: rect.y });
      if (perimeter === 0.1) expect(port.point).toEqual({ x: Math.round((rect.x + rect.w / 2 + 0.1 * 2 * (rect.w + rect.h)) * 2) / 2, y: rect.y });
      if (perimeter === 0.9) expect(port.point.x).toBeLessThan(rect.x + rect.w / 2);
    }
  });
});
