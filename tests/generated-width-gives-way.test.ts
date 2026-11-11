/** An authored width never turns a chart that draws without it into a refusal. */
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, measure, resolveChartRequest } from '../src/core/request';
import { render } from '../src/cli/render';
import { measure as cliMeasure } from '../src/cli/measure';
import { isRefused } from '../src/core/schema/refusals';

const fixture = (type: string, id: string) => getFixtures(type as never).find((item) => item.id === id)!;
const draw = (type: string, id: string, options: object) => {
  const { data, options: own, annotations } = fixture(type, id);
  const { columnOverrides: _own, ...base } = (own ?? {}) as Record<string, unknown>;
  return layoutResolvedRequest(resolveChartRequest({ type, data, options: { ...base, ...options }, annotations } as never));
};

describe('authored column widths give way', () => {
  // Each row is a width that refused while the same chart without it drew.
  it.each([
    ['creative', 'creative-placeholder', { size: { width: 320 } }, { value: { width: 120 } }],
    ['creative', 'creative-placeholder', { size: { width: 480 } }, { value: { width: 5000 } }],
    ['choropleth', 'lookup-no-emphasis', { size: { width: 640, height: 360 } }, { code: { width: 96 } }],
    ['choropleth', 'lookup-no-emphasis', { size: { width: 960, height: 540 }, valueTable: 'below' }, { code: { width: 5000 } }],
    ['waterfall', 'column-overrides', { size: { width: 480 } }, { label: { width: 300 }, value: { width: 300 } }],
    ['waterfall', 'column-overrides', { size: { width: 960 } }, { label: { width: 5000 }, value: { width: 5000 } }],
    ['pvm', 'column-overrides', { size: { width: 640 } }, { label: { width: 300 }, value: { width: 300 } }],
    ['sankey', 'column-overrides', { size: { width: 1280, height: 300 } }, { first: { width: 5000 } }],
  ])('%s %s draws and warns', (type, id, options, columnOverrides) => {
    expect(draw(type, id, options).refused).toBeFalsy();
    const geometry = draw(type, id, { ...options, columnOverrides });
    expect(geometry.refused).toBeFalsy();
    expect(geometry.warnings.map((warning) => warning.code)).toContain('generated-column-width-capped');
  });
});

describe('authored widths give way through the CLI', () => {
  // A later pass refused these, so a layout-level check alone did not see them.
  it.each([
    [{ first: { width: 60 } }, 1280, 'generated-column-width-floored'],
    [{ first: { width: 5000 } }, 1280, 'generated-column-width-capped'],
  ])('sankey %j draws and warns', (columnOverrides, width, code) => {
    const { data, options } = fixture('sankey', 'column-overrides');
    const body = render({ spec: { type: 'sankey', data, options: { ...options, size: { width, height: 300 }, columnOverrides } }, format: 'svg' } as never).body as { ok: boolean; warnings: { code: string }[] };
    expect(body.ok).toBe(true);
    expect(body.warnings.map((warning) => warning.code)).toContain(code);
  });
  // The inset keys live in data, so the warning must point there.
  it('draws the inset at its short size and warns under data.inset', () => {
    const { data, options } = fixture('diagram', 'inset-no-heading');
    const body = render({ spec: { type: 'diagram', data, options: { ...options, size: { width: 720, height: 360 } } }, format: 'svg' } as never).body as { ok: boolean; warnings: { code: string; path?: string }[] };
    expect(body.ok).toBe(true);
    expect(body.warnings.find((warning) => warning.code.startsWith('generated-column-width'))?.path).toBe('/data/inset/columnOverrides');
  });
  // An aligned value column is as wide as its widest value, so the names wrap and can need more height than the chart has.
  it('drops the inset value alignment before it refuses', () => {
    const { data, options } = fixture('diagram', 'inset-no-heading');
    const rows = [['Failed loads this month', '3'], ['Tables with a named owner', '$1,234,567'], ['Open incidents in the last ninety days', '7'], ['Pipelines over their service level today', '12'],
      ['Dashboards without a certified source', '9'], ['Models with stale documentation pages', '1'], ['Loads retried more than twice this week', '5'], ['Sources without a freshness check', '2']].map(([label, value]) => ({ label, value }));
    const inset = { ...(data as { inset: object }).inset, rows, columnOverrides: { value: { align: 'left' } } };
    const body = render({ spec: { type: 'diagram', data: { ...(data as object), inset }, options: { ...options, size: { width: 1280, height: 360 } } }, format: 'svg' } as never).body as { ok: boolean; warnings: { code: string; path?: string }[] };
    expect(body.ok).toBe(true);
    expect(body.warnings).toContainEqual(expect.objectContaining({ code: 'option-ignored', path: '/data/inset/columnOverrides/value/align' }));
  });
  // A value head must not cost the draw where its row is the only reason the lookup misses.
  it('drops the lookup head before it refuses', () => {
    const { data, options } = fixture('choropleth', 'lookup-columns');
    const body = render({ spec: { type: 'choropleth', data, options: { ...options, size: { width: 480, height: 360 } } }, format: 'svg' } as never).body as { ok: boolean; warnings: { code: string; path?: string }[] };
    expect(body.ok).toBe(true);
    expect(body.warnings.map((warning) => warning.path)).toContain('/options/columnOverrides/value/label');
  });
});

describe('a self-loop label at the larger text size', () => {
  // The loop was too short for one line of the larger text beside it, so a diagram that drew at 1079 px was refused from 1080 px.
  it.each([1079, 1080, 1400])('draws the long retry label at %i px', (width) => {
    const { data, options } = fixture('diagram', 'agent-approval');
    const edges = (data as { edges: Array<{ id: string; label?: string }> }).edges.map((edge) => (edge.id === 'retry' ? { ...edge, label: 'Retry and its much longer descriptive name' } : edge));
    const body = render({ spec: { type: 'diagram', data: { ...(data as object), edges }, options: { ...options, size: { width } } }, format: 'svg' } as never).body as { ok: boolean; svg: string };
    expect(body.ok).toBe(true);
    expect(body.svg).toContain('descriptive');
  });
});

describe('wrong generated ids through the CLI', () => {
  const codes = (type: string, id: string, options: object) => {
    const { data, options: own } = fixture(type, id);
    const body = render({ spec: { type, data, options: { ...own, ...options } }, format: 'svg' } as never).body as { warnings: { code: string; path?: string }[] };
    return body.warnings;
  };
  // A list id in a field path broke the JSON pointer, and the render ended in internal-error.
  it.each([
    ['creative', 'creative-placeholder', { rowOrder: ['nope'] }],
    ['creative', 'creative-placeholder', { columnOrder: ['nope'] }],
    ['choropleth', 'lookup-no-emphasis', { rowOrder: ['nope'] }],
    ['choropleth', 'lookup-no-emphasis', { rowOrder: ['DE-BE'], valueTable: false }],
  ])('%s %s warns on %j', (type, id, options) => {
    expect(codes(type, id, options).map((warning) => warning.code)).toContain('generated-id-unknown');
  });
});

describe('a form whose floor is above the asked width gives way', () => {
  const layout = (type: string, data: object, options: object) => layoutResolvedRequest(resolveChartRequest({ type, data, options } as never));
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ganttRows = [
    ['build', 'Platform build, data migration and the hosting contract for every regional office', 'bar'],
    ['pilot', 'Pilot rollout in the three largest stores with the new point-of-sale software', 'chevron'],
    ['train', 'Staff training, help-desk handover and the first quarterly review of the program', 'bar'],
  ].map(([id, label, kind], i) => ({ id, label, items: [{ id: `${id}-item`, kind, start: `2026-0${2 * i + 1}-05`, end: `2026-0${2 * i + 3}-27` }] }));
  // Each row drew at a narrower width and was refused here: a bracket, a column count or a side key raised the floor above the width.
  it.each([
    ['butterfly', {
      categories: [{ id: 'fy21', label: 'FY21' }, { id: 'fy22', label: 'FY22' }, { id: 'fy23', label: 'FY23' }],
      series: [{ id: 'online', label: 'Online', values: [100000, 120000, 144000] }, { id: 'store', label: 'Store', values: [130000, 150000, 180000] }],
    }, {
      a: 'online', b: 'store', title: 'Online grows 20% a year; Store is 30 ahead in FY21', theme: 'notation', size: { width: 600 },
      annotations: [{ id: 'growth', kind: 'cagr', from: { categoryId: 'fy21', seriesId: 'online' }, to: { categoryId: 'fy23', seriesId: 'online' } },
        { id: 'gap', kind: 'diff', mode: 'absolute', from: { categoryId: 'fy21', seriesId: 'online' }, to: { categoryId: 'fy21', seriesId: 'store' } }],
    }],
    ['waffle', {
      categories: weekdays.map((day) => ({ id: day.toLowerCase(), label: day })),
      series: [{ id: 'share', label: 'Share', values: [12, 38, 5, 0.4, 100, 57.5, 66] }],
    }, { title: 'Share of orders by weekday', theme: 'notation', size: { width: 480 } }],
    // Full mode picked three panel columns whose cells needed 1,072 px, where two columns draw from 712 px.
    ['waffle', {
      categories: [{ id: 'tel', label: 'Telecommunications' }, { id: 'man', label: 'Manufacturing' }, { id: 'pha', label: 'Pharmaceuticals' }],
      series: [{ id: 'share', label: 'Share', values: [42, 57, 33] }],
    }, { title: 'Share of firms with a data team', grid: { rows: 2, columns: 40 }, mode: 'full', size: { width: 720 } }],
    ['gantt', { rows: ganttRows }, { title: 'Program plan', today: '2026-07-03', legend: { position: 'right' }, size: { width: 470 } }],
    // The solver seats the step values with less than the floor's air; at 390 px it thins them itself.
    ['waterfall', {
      items: [
        { id: 'fy21', label: 'FY21', type: 'total', value: 142000 }, { id: 'price', label: 'Price', value: 38000 },
        { id: 'volume', label: 'Volume', segments: [{ id: 'b2b', label: 'B2B', value: 11000 }, { id: 'b2c', label: 'B2C', value: 6000 }] },
        { id: 'gross', label: 'Gross', type: 'subtotal' }, { id: 'cost', label: 'Cost', value: -24000 },
        { id: 'fx', label: 'FX', value: -6000 }, { id: 'fy24', label: 'FY24F', type: 'total' },
      ],
    }, { unit: '$m', mode: 'full', size: { width: 400 } }],
    // The one-column card form stopped at 480 px, where the two-column grid still needed 490.
    ['grid', {
      panels: [
        { id: 'list', type: 'table', row: 0, column: 0, options: { variant: 'status', density: 'compact', legend: 'none' }, data: {
          columns: [{ id: 'label', kind: 'rowLabel', label: 'Initiative' }, { id: 'status', kind: 'status', label: 'Delivery status' }],
          rows: [['A', 'A · Core expansion', 'on-track'], ['B', 'B · Service attach', 'on-track'], ['C', 'C · Partner channel', 'at-risk']]
            .map(([id, label, status]) => ({ id, label, cells: { status } })),
        } },
        { id: 'map', type: 'scatter', row: 0, column: 1, data: {
          groups: [{ id: 'priority', label: 'Priority' }, { id: 'selective', label: 'Selective' }],
          points: [{ id: 'A', group: 'priority', label: 'A', x: 8.4, y: 8.8 }, { id: 'B', group: 'priority', label: 'B', x: 7.1, y: 8 }, { id: 'C', group: 'selective', label: 'C', x: 6.8, y: 5.7 }],
        }, options: { valueAxis: { show: true, gridlines: true }, legend: 'none', axisTitles: { x: 'Execution feasibility', y: 'Strategic attractiveness' }, unit: 'Attractiveness × feasibility' } },
      ],
    }, { title: 'A–G assessment links the decision list to the portfolio map', columns: [1.15, 1.05], target: 'slide', theme: 'notation', size: { width: 480 } }],
  ])('%s draws', (type, data, options) => {
    expect(layout(type, data, options).refused).toBeFalsy();
  });
  // A creative name with no break point drew at 639 and 719 px and threw an overflow at 650 and 720 px:
  // the wide card at 640 px and the larger type at 720 px narrowed its column before any step could give way.
  it.each([650, 720])('creative draws a long unbroken name at %i px', (width) => {
    const { data, options } = fixture('creative', 'creative-placeholder');
    const facts = { ...(data as { facts: object }).facts, name: 'QuarterlyrevenuedashboardheroimageQuarterlyrevenuedashboardheroi' };
    expect(layout('creative', { ...(data as object), facts }, { ...options, size: { width } }).refused).toBeFalsy();
  });
});

describe('an automatic height grows before a width refusal', () => {
  const layout = (type: string, data: object, options: object) => layoutResolvedRequest(resolveChartRequest({ type, data, options } as never));
  const steps = [['base', 'Full year 2023 reported baseline', 'total', 812000], ['d1', 'Volume and mix effects in core markets', 'delta', 46000],
    ['d2', 'Pricing carryover from prior-year increases', 'delta', 31000], ['d3', 'Raw material cost inflation', 'delta', -58000],
    ['d4', 'Energy surcharges (contracted)', 'delta', -12000], ['d5', 'Logistics normalization', 'delta', 9000], ['sub', 'Operational subtotal', 'subtotal'],
    ['d6', 'Restructuring program savings', 'delta', 27000], ['d7', 'One-off legal settlement', 'delta', -19000], ['d8', 'Currency translation effects', 'delta', -7000],
    ['d9', 'Portfolio changes net', 'delta', 4000], ['end', 'Full year 2024 reported', 'total']]
    .map(([id, label, kind, value]) => ({ id, label, ...(kind === 'delta' ? {} : { type: kind }), ...(value === undefined ? {} : { value }) }));
  const regions = [['north', 1000, 20000, 1100, 25300], ['east', 500, 6000, 560, 7560], ['south', 400, 4000, 900, 10800], ['west', 300, 7500, 120, 2640],
    ['new', 0, 0, 400, 6000], ['closed', 250, 4500, 0, 0]].map(([id, q0, r0, q1, r1]) => ({ id, label: String(id), prior: { qty: q0, revenue: r0 }, current: { qty: q1, revenue: r1 } }));
  // Each row drew at a narrower width and was refused here: the height the chart took was too short, and a taller one draws.
  it.each([
    ['waterfall', { items: steps }, { title: 'Dense bridge', variant: 'horizontal', valueAxis: { break: { from: 41, to: 800 } }, size: { width: 1079 } }],
    ['pvm', { quantityUnit: 'contracts', items: regions }, {
      title: 'Revenue grew $10.3m: price added $3.7m at prior-year volumes, plus $1.9m where price and volume moved together',
      subtitle: { company: 'Example Software', measure: 'Revenue by region', period: 'FY24 to FY25' }, unit: '$k', interaction: 'separate',
      source: 'Invented order book', methodNote: true, mode: 'full', size: { width: 400 },
    }],
  ])('%s draws', (type, data, options) => {
    expect(layout(type, data, options).refused).toBeFalsy();
  });

  // A bullet, heatmap or status chart that drew at a narrower width was refused here, because the form it picked for this width needed more.
  // Measure then named that form's floor as the minimum width, above the width it draws at, at an open and at a pinned height.
  it.each([
    ['bullet', 485, { rows: ['fy21', 'fy22', 'fy23'].map((id, i) => ({ id, label: `FY${21 + i} and its much longer descriptive name`, value: 100 * 1.2 ** i, target: 110 * 1.2 ** i })) },
      { title: 'Orders grow 20% per year', unit: 'thousand orders', sharedScale: true, theme: 'notation', annotations: [{ id: 'growth', kind: 'cagr', from: 'fy21', to: 'fy23' }] }],
    ['heatmap', 360, { categories: [1, 2, 3, 4, 5].map((n) => ({ id: `wave${n}`, label: `Wave ${n}` })), series: [
      { id: 'procurement', label: 'Procurement', values: [12.4, 15.1, null, 18.2, 20.5] }, { id: 'logistics', label: 'Logistics', values: [8.2, null, 9.6, 11, null] },
      { id: 'manufacturing', label: 'Manufacturing', values: [null, 22.4, 24.8, null, 28.1] }, { id: 'overhead', label: 'Overhead', values: [4.1, 4.4, null, null, 6.2] }] },
      { title: 'Unreported waves stay blank', unit: '$m', missing: 'blank', legend: 'right', target: 'dashboard' }],
    ['status', 500, { rows: ['pricing', 'service'].map((id) => ({ id, label: `${id} and its much longer descriptive name` })),
      columns: ['draft', 'review'].map((id) => ({ id, label: `${id} and its much longer descriptive name` })),
      cells: [['pricing', 'draft', 'reviewed'], ['pricing', 'review', 'reviewed'], ['service', 'draft', 'reviewed'], ['service', 'review', 'pending']].map(([row, col, state]) => ({ row, col, state })) },
      { title: 'Pricing review is complete', theme: 'notation', legend: 'right', target: 'slide', states: [{ id: 'reviewed', label: 'Reviewed', tone: 'info' }, { id: 'pending', label: 'Pending', tone: 'neutral' }] }],
  ])('%s draws at %i px', (type, width, data, options) => {
    expect(layout(type, data, { ...options, size: { width } }).refused).toBeFalsy();
    for (const size of [{ width }, { width, height: 600 }]) {
      const measured = measure({ type, data, options: { ...options, size } } as never);
      expect(measured.geometry).toBeDefined();
      expect(measured.minWidth).toBeLessThanOrEqual(width);
    }
  });

  // At a pinned height measure named the width a refusal at the declared floor asked for (701 px), above 460 px, where this board draws in its own form.
  it('measure at a pinned height names no minimum above a width that draws', () => {
    const label = (id: string) => `${id[0]!.toUpperCase()}${id.slice(1)} and its much longer descriptive name`;
    const measured = measure({ type: 'status', theme: 'notation', data: {
      rows: ['pricing', 'service'].map((id) => ({ id, label: label(id) })), columns: ['draft', 'review'].map((id) => ({ id, label: label(id) })),
      cells: [['pricing', 'draft', 'reviewed'], ['pricing', 'review', 'reviewed'], ['service', 'draft', 'reviewed'], ['service', 'review', 'pending']].map(([row, col, state]) => ({ row, col, state })) },
    options: { states: [{ id: 'reviewed', label: 'Reviewed', tone: 'info' }, { id: 'pending', label: 'Pending', tone: 'neutral' }], legend: 'right', columnLabels: 'bottom',
      title: 'Pricing review is complete; service review remains open', subtitle: { measure: 'Review progress by workstream and stage' }, source: 'Illustrative review log',
      target: 'slide', size: { width: 460, height: 500 } } } as never);
    expect(measured.geometry).toBeDefined();
    expect(measured.minWidth).toBeLessThanOrEqual(460);
  });
});

describe('a grid panel that spans columns keeps its plot under a column anchor', () => {
  const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const teams = [['finance', 'Finance transformation'], ['sales', 'Sales operations'], ['supply', 'Supply chain']];
  const panels = [
    ...[['orders', 'Orders', 120], ['returns', 'Returns', 8], ['shipments', 'Shipments', 112]].map(([id, label, value], column) => ({ id, type: 'kpi', row: 0, column, data: { label, value } })),
    { id: 'status', type: 'status', row: 1, column: 0, span: { columns: 3 }, data: {
      rows: teams.map(([id, label]) => ({ id, label })),
      columns: months.map((label) => ({ id: label.toLowerCase(), label })),
      cells: teams.flatMap(([row], r) => months.map((month, c) => ({ row, col: month.toLowerCase(), state: ['g', 'a', 'r'][(r + c) % 3] }))),
    }, options: { legend: 'none', states: [['g', 'On track', 'good'], ['a', 'At risk', 'warn'], ['r', 'Off track', 'bad']].map(([id, label, tone]) => ({ id, label, tone })) } },
  ];
  // The anchor grouped panels by their first column, so the full-width status matrix shrank to the first KPI's plot: refused at 600 px and cut at 840 px.
  it.each([600, 840])('draws the status matrix whole at %ipx', (width) => {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'grid', data: { panels }, options: { columns: 3, legend: 'none', anchors: { plotEdges: 'column' }, size: { width } } } as never));
    expect(geometry.refused).toBeFalsy();
    const codes = geometry.warnings.map((warning) => warning.code);
    expect(codes.filter((code) => code.startsWith('label'))).toEqual([]);
    expect(codes).toContain('grid-anchor-incompatible');
  });
});

describe('a chart refused in the text class of its width draws in a smaller class', () => {
  type Row = { id: string; label: string; children?: Row[] };
  const copied = (rows: Row[]): Row[] => rows.map((row) => ({ ...row, id: `${row.id}-2`, label: `${row.label} copy`, ...(row.children ? { children: copied(row.children) } : {}) }));
  const longLabels = (nodes: { label: string }[]) => nodes.map((node) => ({ ...node, label: `${node.label} and its much longer descriptive name` }));
  const tree = fixture('diagram', 'profit-issue-tree');
  const table = fixture('table', 'management-report');
  it.each([
    // The issue tree drew at 719 px and was refused at 720 px for unplaced node labels, a refusal that names no size.
    ['diagram', 720, { ...tree.data as object, nodes: longLabels((tree.data as { nodes: { label: string }[] }).nodes) }, { ...tree.options, target: 'print' }],
    // The table drew at 1079 px only in the small text class, so one step down from the large class at 1080 px was refused too.
    ['table', 1080, { ...table.data as object, rows: [...(table.data as { rows: Row[] }).rows, ...copied((table.data as { rows: Row[] }).rows)] }, table.options],
  ])('%s draws at %i px', (type, width, data, own) => {
    const options = { ...own as object, size: { width } };
    expect(isRefused(layoutResolvedRequest(resolveChartRequest({ type, data, options } as never)))).toBe(false);
    const measured = measure({ type, data, options } as never);
    expect(measured.geometry).toBeDefined();
    expect(measured.minWidth).toBeLessThanOrEqual(width);
  });

  // At a pinned height the CLI measured the table drawn in the smaller class with probes in the larger one, and named 1238 px where it draws at 1080 px.
  it('the CLI names a minimum width at which a pinned chart drawn in a smaller class draws', () => {
    const data = { ...table.data as object, rows: [...(table.data as { rows: Row[] }).rows, ...copied((table.data as { rows: Row[] }).rows)] };
    const cli = (size: { width: number; height: number }) => cliMeasure({ spec: { type: 'table', data, options: { ...table.options as object, size } } } as never).body as { minWidth: number; refused: unknown };
    const { minWidth } = cli({ width: 1080, height: 900 });
    expect(minWidth).toBeLessThanOrEqual(1080);
    expect(cli({ width: minWidth, height: 900 }).refused).toBeNull();
    expect(cli({ width: minWidth - 1, height: 900 }).refused).not.toBeNull();
  });
});

describe('measure gives one answer in every call order', () => {
  // A narrower form that was refused too left measure probing that form, so 320 px named 400 in a fresh process and 752 after a call at 390 px.
  it('names the same minimum width before and after a wider call', () => {
    const { data, options } = fixture('waffle', 'seven-panels-narrow');
    // Measure keeps its searches by content, so each order gets its own category ids.
    const own = (tag: string) => ({ ...(data as object), categories: (data as { categories: { id: string }[] }).categories.map((c) => ({ ...c, id: `${c.id}-${tag}` })) });
    const at = (spec: unknown, width: number) => measure({ type: 'waffle', data: spec, options: { ...options, size: { width } } } as never).minWidth;
    const first = at(own('a'), 320);
    const later = own('b');
    at(later, 390);
    expect(at(later, 320)).toBe(first);
  });

  // Measure kept the widths a search laid out through a call opened for another width, whose memos changed them: the refusal at
  // 160 px named 280 x 257 px in a fresh process and 280 x 254 px after a call at 320 px. Render draws 257 px at 280 px.
  it('names the same refusal size before and after a wider call', () => {
    const { data, options } = fixture('status', 'column-widths');
    const status = data as { rows: { id: string }[]; cells: { row: string }[] };
    const own = (tag: string) => ({ ...status, rows: status.rows.map((r) => ({ ...r, id: `${r.id}-${tag}` })), cells: status.cells.map((c) => ({ ...c, row: `${c.row}-${tag}` })) });
    const at = (spec: unknown, width: number) => measure({ type: 'status', data: spec, options: { ...options, size: { width } } } as never).warnings[0]?.expected;
    const first = at(own('a'), 160);
    const later = own('b');
    at(later, 320);
    expect(at(later, 160)).toEqual(first);
  });
});
