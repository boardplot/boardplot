/**
 * src/core/doc/chartValidation.ts: an unknown data key is refused where it
 * sits, with the near miss when there is one. Zod strips unknown keys from a
 * plain object, and a combo series with `type: 'line'` drew as a column
 * without a word.
 */

import { describe, expect, it } from 'vitest';
import { render } from '../src/cli/render';
import { layoutDiagram } from '../src/core/charts/diagram/layout';
import { rectLineDistance, type Rect } from '../src/core/geometry';
import type { DiagramData, DiagramMarks, DiagramOptions, DiagramPolylineRoute } from '../src/core/types/diagram';
import { canDraw, getChartDefinition, measure, resolveChartRequest } from '../src/index';
import { getFixtures } from '../src/fixtures';
import { checkedColor } from '../src/core/svg/paint';
import { compositeColor, contrastRatio } from '../src/core/color';
import { registerTheme, resolveTheme } from '../src/core/theme';
import { tableStylesheet } from '../src/react/tablePresentation';

describe('design system colours', () => {
  const spec = (fill: string, theme: unknown = 'standard') => ({
    type: 'column', data: { categories: ['a'], series: [{ id: 's', fill, values: [100] }] },
    options: { theme, size: { width: 480, height: 300 }, labelPlacements: { 'point:s:a': 'insideEnd' }, legend: 'none' },
  });
  const svg = (input: unknown): string => {
    const result = render({ spec: input, return: ['svg'] });
    expect(result.body.ok, JSON.stringify(result.body.errors)).toBe(true);
    return result.body.svg as string;
  };

  // Design tokens must draw the same sRGB fill that the engine uses to choose readable label ink.
  it('draws modern colour functions as deterministic sRGB, including alpha and gamut clipping', () => {
    const cases = [
      ['oklch(65% 0.15 270)', '#6c88ea'], ['oklch(50% 0.4 30)', '#fd0000'],
      ['hsl(210 50% 40%)', '#336699'], ['hsl(.5turn, 100%, 50%)', '#00ffff'],
      ['rgb(51 102 153 / 50%)', 'rgba(51,102,153,0.5)'],
      ['rgb(0, 0, 0, 0.2)', 'rgb(0, 0, 0, 0.2)'], ['rgba(51,102,153)', 'rgba(51,102,153)'],
      ['oklch(0 0 none / 4%)', 'rgba(0,0,0,0.04)'],
    ];
    for (const [input, expected] of cases) {
      expect(checkedColor(input!)).toBe(expected);
      const drawing = svg(spec(input!));
      expect(drawing).toContain(`fill="${expected}"`);
      expect(svg(spec(input!))).toBe(drawing);
    }
    const theme = resolveTheme({ preset: 'standard', overrides: { color: { series: ['oklch(65% 0.15 270)'] } } });
    expect(theme.color.series[0]).toBe('#6c88ea');
    const custom = { ...theme, name: 'modern-colour-test', color: { ...theme.color, ink: 'hsl(210 50% 10%)' } };
    registerTheme(custom);
    expect(resolveTheme(custom.name)).toBe(resolveTheme(custom.name));
    expect(Object.isFrozen(custom.color)).toBe(true);
    for (const fill of ['oklch(0 0 none / 4%)', 'hsl(210 50% 20%)']) {
      for (const preset of ['standard', 'standard-dark']) {
        const drawing = svg(spec(fill, preset));
        const ink = drawing.match(/<text\b[^>]*id="[^"]*label:point:s:a"[^>]*fill="([^"]+)"/)?.[1];
        expect(ink).toBeDefined();
        expect(contrastRatio(ink!, compositeColor(fill, resolveTheme(preset).color.background))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // A page variable must never change a fill without recalculating its label ink, including table CSS.
  it('bakes required CSS-variable fallbacks on light and dark themes and names the fix for bare variables', () => {
    for (const preset of ['standard', 'standard-dark']) {
      const fill = 'var(--brand, hsl(210 50% 40%))';
      const theme = resolveTheme({ preset, overrides: { color: { series: [fill] }, table: { grounds: { total: fill } } } });
      expect(theme.color.series[0]).toBe('#336699');
      expect(tableStylesheet(theme)).not.toContain('var(--brand');
      const drawing = svg(spec(fill, { preset, overrides: { color: { series: [fill] } } }));
      expect(drawing).toContain('fill="#336699"');
      expect(drawing).not.toContain('var(--brand');
      expect(svg(spec(fill, { preset, overrides: { color: { series: [fill] } } }))).toBe(drawing);
    }
    for (const input of ['var(--brand)', 'var(--brand, currentColor)', 'var(--brand, #123);color:red', 'oklch(from red l c h)', 'oklch(1e999 0 0)', 'hsl(0 1e999% 50%)', 'rgb(1e999 0 0)']) {
      expect(() => checkedColor(input)).toThrow(/fallback|literal/);
    }
    expect(() => resolveTheme({ preset: 'standard', overrides: { color: { ink: 'var(--ink)' } } })).toThrow(/fallback/);
  });

  // A ninth series must name both sides of a repeated colour and give a repair that preserves meaning.
  it('names the series that share an exhausted palette colour', () => {
    const series = Array.from({ length: 9 }, (_, i) => ({ id: `s${i + 1}`, label: `Series ${i + 1}`, values: [20 + i] }));
    const draw = (count: number) => render({ spec: { type: 'column', data: { categories: ['a'], series: series.slice(0, count) }, options: { title: 'Series', size: { width: 1200, height: 600 } } } }).body;
    const warning = (draw(9).warnings as { code: string; message: string; suggest?: string }[]).find(w => w.code === 'series-colour-repeated');
    expect(warning?.message).toContain("'Series 8'");
    expect(warning?.message).toContain("'Series 9'");
    expect(warning?.suggest).toMatch(/Other.*small multiples.*colorRole/);
    expect((draw(8).warnings as { code: string }[]).some(w => w.code === 'series-colour-repeated')).toBe(false);
    const scatter = render({ spec: { type: 'scatter', data: {
      points: series.map((s, i) => ({ id: s.id, group: s.id, x: i + 1, y: i + 2 })),
      groups: series.map(s => ({ id: s.id, label: s.label })),
    }, options: { title: 'Groups', legend: 'top', size: { width: 1200, height: 600 } } } }).body;
    const collision = (scatter.warnings as { code: string; message: string; suggest?: string }[]).find(w => w.code === 'series-indistinguishable');
    expect(collision?.message).toContain("'Series 8'");
    expect(collision?.message).toContain("'Series 9'");
    expect(collision?.suggest).toMatch(/Other.*small multiples.*colorRole/);
    // Band keys are not series: their repair must not lead with series-only advice.
    const bands = getFixtures('bullet').find(f => f.id === 'band-key-labels')!;
    const bandWarning = (render({ spec: { type: 'bullet', data: bands.data, options: bands.options } }).body.warnings as { code: string; suggest?: string }[])
      .find(w => w.code === 'series-indistinguishable');
    expect(bandWarning?.suggest).toMatch(/^use distinct colours, shapes or patterns/);
  });
});

describe('actionable input refusals', () => {
  const bar = { type: 'bar', data: { categories: ['a', 'b'], series: [{ id: 's', values: [1, 2] }] }, options: { title: 'Example' } };
  const errors = (spec: unknown) => (render({ spec }).body.errors ?? []) as { code: string; path: string; message: string; suggest?: string }[];

  // An unknown theme colour key must name the supported roles so the caller can repair it.
  it('lists the accepted theme colour keys', () => {
    const [error] = errors({ ...bar, options: { theme: { preset: 'boardroom', overrides: { color: { ink2: '#123456' } } } } });
    expect(error?.suggest).toMatch(/color\.ink2.*color.*ink.*inkMuted/);
  });

  // A unit conflict must name the chart-level field that can cause it.
  it('names options.unit in the unit-conflict repair', () => {
    const [error] = errors({ type: 'combo', data: { categories: ['a'], series: [{ id: 's', kind: 'column', unit: 'USD', values: [2] }] }, options: { unit: 'EUR' } });
    expect(error).toMatchObject({ code: 'unit-conflict', path: '/data/series/0/unit', suggest: expect.stringContaining('options.unit') });
    const [secondary] = errors({ type: 'combo', data: { categories: ['a'], series: [
      { id: 's', kind: 'column', unit: 'EUR', values: [2] },
      { id: 'usd', kind: 'line', axis: 'secondary', unit: 'USD', values: [3] },
      { id: 'count', kind: 'line', axis: 'secondary', unit: 'count', values: [4] },
    ] }, options: { unit: 'EUR', secondaryAxis: { acknowledge: true }, axisTitles: { secondary: 'Other units' } } });
    expect(secondary).toMatchObject({ code: 'unit-conflict', path: '/data/series/2/unit', suggest: expect.stringContaining('secondary series one unit') });
    expect(secondary?.suggest).not.toContain('options.unit');
  });

  // Two nodes in one architecture cell have no drawing, so the refusal must name both and the fix.
  it('refuses two architecture nodes in one lane and track', () => {
    const node = (id: string) => ({ id, kind: 'step', shape: { kind: 'rectangle' }, label: id, laneId: 'l', track: 't' });
    expect(() => getChartDefinition('diagram')!.layout({ nodes: [node('a'), node('b')], lanes: [{ id: 'l', label: 'Layer', orientation: 'horizontal' }] }, { variant: 'architecture', flow: 'lanes' }))
      .toThrow(expect.objectContaining({ code: 'diagram-track-conflict', message: expect.stringContaining("'a' and 'b'") }));
  });

  // Two channels with one id emit one scene id twice, which crashes the React renderer.
  it('refuses two diagram channels with one id', () => {
    const node = (id: string) => ({ id, kind: 'step', shape: { kind: 'rectangle' }, label: id });
    const [error] = errors({ type: 'diagram', data: { nodes: [node('a'), node('b')], edges: [{ id: 'e', source: { nodeId: 'a' }, target: { nodeId: 'b' } }],
      channels: [{ id: 'c', edgeIds: ['e'], label: 'One' }, { id: 'c', edgeIds: ['e'], label: 'Two' }] }, options: { variant: 'architecture' } });
    expect(error).toMatchObject({ path: '/data/channels/1/id' });
  });

  // A lane label wider than the plot left no room for nodes, and layout threw a TypeError.
  it('keeps room for nodes beside a long unbroken architecture lane label', () => {
    const layout = layoutDiagram({ nodes: [{ id: 'a', kind: 'step', shape: { kind: 'rectangle' }, label: 'A', laneId: 'l' }], lanes: [{ id: 'l', label: 'W'.repeat(100), orientation: 'horizontal' }] } as DiagramData,
      { variant: 'architecture', flow: 'lanes', size: { width: 600, height: 540 } } as DiagramOptions);
    expect(layout.marks.nodes[0]!.rect.w).toBeGreaterThan(300);
  });

  // A narrow architecture lane hid its zone name and placed a return label closer to another edge.
  it('keeps a zone name and its return label readable', () => {
    const fixture = getFixtures('diagram').find((item) => item.id === 'journey-attribution')!;
    const layout = measure({ type: 'diagram', data: fixture.data, options: { ...fixture.options, size: { width: 480 } }, theme: 'notation' }).geometry!;
    const group = layout.labels.find((label) => label.id === 'group-label:personal');
    expect(group?.text).toBe('Personal data');
    expect(group?.hidden).toBeUndefined();
    const label = layout.labels.find((item) => item.id === 'edge-label:loop')!;
    expect(label.hidden).toBeUndefined();
    const edges = layout.marks.edges as DiagramMarks['edges'];
    const own = edges.find((edge) => edge.id === 'loop')!;
    const other = edges.filter((edge) => edge.id !== 'loop');
    const distance = (edge: typeof own) => rectLineDistance(label.rect, (edge.route as DiagramPolylineRoute).points);
    expect(distance(own)).toBeLessThan(Math.min(...other.map(distance)));
  });

  // Many unlike edges between two nodes pushed their ends past the node sides, and the lines floated.
  it('keeps every architecture edge end on its node', () => {
    const node = (id: string) => ({ id, kind: 'step', shape: { kind: 'rectangle' }, label: id });
    const roles = ['primary', 'secondary', 'muted', 'accent'];
    const edges = roles.flatMap((role) => ['solid', 'dashed', 'dotted', 'solid'].map((dash, index) => ({ id: `${role}${index}`, source: { nodeId: 'a' }, target: { nodeId: 'b' }, role, dash, weight: index === 3 ? 'strong' : 'normal' })));
    const { marks } = layoutDiagram({ nodes: [node('a'), node('b')], edges } as DiagramData, { variant: 'architecture', size: { width: 960, height: 1000 } } as DiagramOptions);
    const [a, b] = marks.nodes.map((item) => item.rect) as [Rect, Rect];
    const on = (point: { x: number; y: number }, rect: Rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
    for (const edge of marks.edges) {
      const { points } = edge.route as DiagramPolylineRoute;
      expect(on(points[0]!, a)).toBe(true);
      expect(on(points.at(-1)!, b)).toBe(true);
    }
  });

  // Two zones that hold each other have no outer frame, and the parent walk would never end.
  it('refuses a cycle in nested architecture zones', () => {
    const data = { nodes: [{ id: 'a', kind: 'step', shape: { kind: 'rectangle' }, label: 'A', groupId: 'x' }],
      groups: [{ id: 'x', title: 'X', parentId: 'y' }, { id: 'y', title: 'Y', parentId: 'x' }] };
    expect(() => getChartDefinition('diagram')!.layout(data, { variant: 'architecture' }))
      .toThrow(expect.objectContaining({ code: 'diagram-group-cycle' }));
  });

  // A mistyped highlight would mute the whole exhibit and emphasize nothing.
  it('refuses a highlight id that names no node or edge', () => {
    const data = { nodes: [{ id: 'a', kind: 'step', shape: { kind: 'rectangle' }, label: 'A' }] };
    expect(() => getChartDefinition('diagram')!.layout(data, { variant: 'architecture', highlight: 'nope' }))
      .toThrow(expect.objectContaining({ code: 'invalid-membership', message: expect.stringContaining("'nope'") }));
  });

  // A self-loop or a zone end that floats off its target claims a link the diagram does not have.
  it('ends a self-loop on its node and a zone edge on the frame', () => {
    const node = (id: string, groupId?: string) => ({ id, kind: 'step', shape: { kind: 'rectangle' }, label: id, groupId });
    const edges = [{ id: 'loop', source: { nodeId: 'a' }, target: { nodeId: 'a' } }, { id: 'zone', source: { nodeId: 'a' }, target: { groupId: 'z' } }];
    const { marks } = layoutDiagram({ nodes: [node('a'), node('b', 'z')], groups: [{ id: 'z', title: 'Zone' }], edges } as DiagramData, { variant: 'architecture', size: { width: 960, height: 500 } } as DiagramOptions);
    const a = marks.nodes.find((item) => item.id === 'a')!.rect;
    const frame = marks.groups[0]!.bounds;
    const on = (point: { x: number; y: number }, rect: Rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
    const points = (id: string) => (marks.edges.find((edge) => edge.id === id)!.route as DiagramPolylineRoute).points;
    expect(on(points('loop')[0]!, a) && on(points('loop').at(-1)!, a)).toBe(true);
    expect(points('zone').at(-1)!.x).toBe(frame.x);
  });

  // The key must show what the nodes wear, and architecture draws structural nodes on the background.
  it('keys architecture nodes with the paints they wear', () => {
    const node = (id: string, role: string) => ({ id, kind: 'step', shape: { kind: 'rectangle' }, label: id, role });
    const layout = layoutDiagram({ nodes: [node('a', 'primary'), node('b', 'secondary')], key: [{ role: 'primary', label: 'One' }, { role: 'secondary', label: 'Two' }] } as DiagramData, { variant: 'architecture' } as DiagramOptions);
    const swatches = layout.scene.filter((item) => item.part === 'swatch');
    expect(swatches.map((item) => (item as { pattern?: string }).pattern)).toEqual(['hollow', 'hollow']);
  });

  // A diagram kind refused by its variant must name the kinds that variant can place.
  it('lists the node kinds accepted by the diagram variant', () => {
    const [error] = errors({ type: 'diagram', data: { nodes: [{ id: 'n', kind: 'step', shape: { kind: 'rectangle' }, label: 'A', laneId: 'l' }], lanes: [{ id: 'l', label: 'Phase', orientation: 'vertical' }] }, options: { variant: 'customer-journey' } });
    expect(error).toMatchObject({ code: 'invalid-diagram-kind', path: '/data/nodes/0/kind', message: expect.stringContaining('painPoint'), suggest: expect.stringContaining('painPoint') });
    expect(() => getChartDefinition('diagram')!.layout({ nodes: [
      { id: 'ok', kind: 'painPoint', shape: { kind: 'rectangle' }, label: 'A', laneId: 'l', order: 1 },
      { id: 'bad', kind: 'step', shape: { kind: 'rectangle' }, label: 'B', laneId: 'l', order: 0 },
    ], lanes: [{ id: 'l', label: 'Phase', orientation: 'vertical' }] }, { variant: 'customer-journey' }))
      .toThrow(expect.objectContaining({ segments: ['data', 'nodes', 1, 'kind'] }));
  });

  // The old table preset name must point to variant rather than the unrelated theme field.
  it('points a table preset to variant', () => {
    const { body } = render({ spec: { type: 'table', data: { columns: [{ id: 'name', kind: 'rowLabel' }], rows: [{ id: 'r', cells: { name: 'A' } }] }, options: { preset: 'steering' } } });
    expect(body.errors ?? []).toEqual([]);
    expect(body.warnings).toContainEqual(expect.objectContaining({ code: 'option-deprecated', path: '/options/preset', fix: [
      { op: 'remove', path: '/options/preset' }, { op: 'add', path: '/options/variant', value: 'steering' },
    ] }));
  });

  // A malformed union cell needs one error describing valid shapes, not missing fields from every branch.
  it('describes the accepted union cell shapes in one refusal', () => {
    const found = errors({ ...bar, data: { ...bar.data, series: [{ id: 's', values: [{ value: 48, format: '0' }, 2] }] } });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: '/data/series/0/values/0', message: expect.stringContaining('categoryId') });
    expect(found[0]?.message).toContain('date');
    expect(found[0]?.message).toContain('number');
    expect(found[0]?.message).toContain('example');
    const wrongNumber = errors({ ...bar, data: { ...bar.data, series: [{ id: 's', values: [{ number: 'bad' }, 2] }] } });
    expect(wrongNumber).toHaveLength(1);
    expect(wrongNumber[0]?.path).toBe('/data/series/0/values/0/number');
  });

  // A dimswitch format without digits must refuse at its authored field before compile runs.
  it('validates the dimswitch measure format before layout', () => {
    const [error] = errors({ type: 'dimswitch', data: {
      dimension: { label: 'Group', total: { id: 'total', label: 'Total' }, members: [], headline: ['n'] },
      measures: [{ id: 'n', label: 'Count', value: { field: 'n' }, format: 'USD' }],
      periods: [{ id: 'range', label: 'Range', kind: 'range' }, { id: 'prior', label: 'Prior', kind: 'prior' }, { id: 'p', label: 'Period' }],
      facts: ['range', 'prior', 'p'].map(periodId => ({ memberId: 'total', periodId, sums: { n: 2 } })),
    } });
    expect(error).toMatchObject({ code: 'invalid-format', path: '/data/measures/0/format', suggest: expect.stringContaining('example') });
  });

  // The library request path must reject malformed data before a caller can pass it to layout.
  // Options that hold themselves overflowed the stack, so canDraw threw a RangeError instead of answering.
  it('refuses a self-referencing options object', () => {
    const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', label: 'S', values: [1] }] };
    const options: Record<string, unknown> = { title: 'T' };
    options.self = options;
    expect(canDraw({ type: 'column', data, options })).toMatchObject({ ok: false, code: 'circular-reference' });
  });

  it('validates library requests and returns the same refusal from canDraw', () => {
    const request = { type: 'waterfall', data: { items: [null] } };
    expect(() => resolveChartRequest(request as never)).toThrow(expect.objectContaining({ code: 'invalid-data', path: '/charts/0/data/items/0' }));
    expect(canDraw(request as never)).toMatchObject({ ok: false, code: 'invalid-data' });
    // Runtime validation must keep the library's existing support for model getters.
    class Model {
      get categories() { return ['a']; }
      get series() { return [{ id: 's', values: [2] }]; }
    }
    expect(canDraw({ type: 'bar', data: new Model() })).toMatchObject({ ok: true });
  });
});

describe('unknown data keys', () => {
  it('refuses a combo series type with the key path and a rename to kind', () => {
    const body = render({ spec: {
      type: 'combo',
      data: { categories: ['a', 'b'], series: [{ id: 'rev', values: [1, 2] }, { id: 'margin', type: 'line', values: [3, 4] }] },
      options: { title: 'Margin holds' },
    } }).body as { ok: boolean; errors: { code: string; path: string; message: string; suggest?: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ code: 'invalid-data', path: '/data/series/1/type', suggest: "Rename 'type' to 'kind'." });
    expect(body.errors[0]!.message).toContain('try: kind');
  });

  // A label beside a keyed value was refused without naming the rich value form, and an options-level valueKind was sent to 'annotations'.
  it('names the rich value form for a label beside value, and the series for an options-level valueKind', () => {
    const errors = (data: unknown, options: object = {}) => (render({ spec: { type: 'line', data, options: { title: 'Lines', ...options } } }).body as { errors: { path: string; message: string; suggest?: string }[] }).errors;
    const keyed = { categories: ['a', 'b'], series: [{ id: 's', values: [{ categoryId: 'a', value: 1, label: 'peak' }, { categoryId: 'b', value: 2 }] }] };
    expect(errors(keyed)[0]).toMatchObject({ path: '/data/series/0/values/0/label', message: expect.stringContaining('value: { number, label }') });
    const fractions = { categories: ['a', 'b'], series: [{ id: 's', values: [0.1, 0.2] }] };
    expect(errors(fractions, { valueKind: 'fraction' })[0]).toMatchObject({ path: '/options/valueKind', suggest: expect.stringContaining('data.series[].valueKind') });
  });

  // A record with fixed keys (status labels) and a computed column read as keyless or as every column kind, so the error named neither 'pending' nor 'calc'.
  it('lists the keys a fixed-key record and a tagged union branch take', () => {
    const errors = (column: object) => (render({ spec: { type: 'table', data: {
      columns: [{ id: 'name', kind: 'rowLabel' }, { id: 'a', kind: 'value' }, column],
      rows: [{ id: 'r', cells: { name: 'R', a: 1, s: 'done' } }],
    }, options: { title: 'Table' } } }).body as { errors: { path: string; message: string; suggest?: string }[] }).errors;
    expect(errors({ id: 's', kind: 'status', labels: { pendin: 'Learning' } })).toContainEqual(expect.objectContaining({
      path: '/data/columns/2/labels/pendin', suggest: "Rename 'pendin' to 'pending'.", message: expect.stringContaining('known keys: on-track, at-risk, off-track, done, pending'),
    }));
    expect(errors({ id: 's', kind: 'computed', formula: { op: 'abs', of: { ref: 'a' } } })).toContainEqual(expect.objectContaining({
      path: '/data/columns/2/formula', suggest: "Rename 'formula' to 'calc'.", message: expect.not.stringContaining('wrap'),
    }));
  });

  // options.stack on a panel grid switched to the metric-stack schema and refused data it never meant to read, with no word about the option.
  it('refuses a mode option on data of another form with one error at the option', () => {
    const body = render({ spec: { type: 'grid', data: { panels: [{ id: 'p', type: 'column', data: { categories: ['a'], series: [{ id: 's', values: [1] }] } }] },
      options: { title: 'Grid', stack: { heights: [100, 50] } } } }).body as { errors: { path: string; message: string; suggest?: string }[] };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ path: '/options/stack', message: expect.stringContaining('no categories, measures'), suggest: expect.stringContaining('Use rows for proportional heights') });
  });
});

// A table column without kind gave zod's "Invalid discriminator value", which names neither the field nor where it goes.
describe('a discriminated union with no matching branch', () => {
  it('names the field and its allowed values', () => {
    const body = render({ spec: { type: 'table', data: { columns: [{ id: 'name' }], rows: [{ id: 'a', cells: { name: 'A' } }] }, options: { title: 'Table' } } }).body as { errors: { path: string; message: string }[] };
    expect(body.errors[0]).toMatchObject({ path: '/data/columns/0/kind', message: expect.stringMatching(/^data\.columns\.0\.kind: kind must be one of 'rowLabel', 'value', /) });
  });
});

describe('bartable data', () => {
  const errors = (mutate: (data: any) => void) => {
    const data = {
      categories: [{ id: 'a' }, { id: 'b' }],
      series: [{ id: 'run' }, { id: 'grow' }],
      columns: [{ id: 'n', values: [1, 2] }],
      panels: [{ id: 'p', values: { run: [1, 2], grow: [3, 4] }, ends: [{ low: 1, high: 2 }, null] }],
    };
    mutate(data);
    return (render({ spec: { type: 'bartable', data, options: { title: 'Rows' } } }).body as { errors: { path: string; message: string }[] }).errors;
  };

  it('refuses an inverted range, a key that names no segment and a column of the wrong length where they sit', () => {
    expect(errors((data) => { data.panels[0].ends[0] = { low: 5, high: 2 }; })[0]).toMatchObject({ path: '/data/panels/0/ends/0/low', message: expect.stringContaining('range-inverted') });
    expect(errors((data) => { data.panels[0].values.other = [1, 2]; })[0]).toMatchObject({ path: '/data/panels/0/values/other' });
    expect(errors((data) => { data.columns[0].values = [1]; })[0]).toMatchObject({ path: '/data/columns/0/values' });
  });

  it('refuses a range below zero: the segments fill the bar to its low end', () => {
    expect(errors((data) => { data.panels[0].ends[0] = { low: -1, high: 2 }; })[0]).toMatchObject({ path: '/data/panels/0/ends/0/low', message: expect.stringContaining('zero') });
  });

  it('refuses a range whose segments sum to zero: nothing splits its low end', () => {
    expect(errors((data) => { data.panels[0].values = { run: [0, 2], grow: [0, 4] }; })[0]).toMatchObject({ path: '/data/panels/0/ends/0', message: expect.stringContaining('range-without-split') });
  });

  it('refuses __range as a segment id: the key gives it to the range extension', () => {
    expect(errors((data) => { data.series[0].id = '__range'; data.panels[0].values = { __range: [1, 2], grow: [3, 4] }; })[0]).toMatchObject({ path: '/data/series/0/id', message: expect.stringContaining('range entry') });
  });

  it('refuses __total as a row id: records and hover give it to the Total row', () => {
    expect(errors((data) => { data.categories[1].id = '__total'; })[0]).toMatchObject({ path: '/data/categories/1/id', message: expect.stringContaining('Total row') });
  });
});

describe('waterfall data', () => {
  it('refuses __total as a segment id: a total bar names its own segment so, and its record then claimed the whole total', () => {
    const body = render({ spec: { type: 'waterfall', data: { items: [
      { id: 'q1', segments: [{ id: '__total', value: 5 }, { id: 'other', value: 3 }] },
      { id: 'end', type: 'total' },
    ] }, options: { title: 'Bridge' } } }).body as { errors: { path: string }[] };
    expect(body.errors[0]).toMatchObject({ path: '/data/items/0/segments/0/id' });
  });
});

describe('a theme given as preset and overrides', () => {
  it('reports only the findings the overrides add, not the ones the preset carries', () => {
    const spec = (overrides: object) => ({ type: 'column', data: { categories: ['a', 'b'], series: [{ id: 's', values: [1, 2] }] },
      options: { theme: { preset: 'notation', overrides } } });
    const codes = (overrides: object) => (render({ spec: spec(overrides) }).body.warnings as { code: string }[]).map((warning) => warning.code);
    // notation carries series-similar by itself; the preset tests own it.
    expect(codes({ legend: { auto: true } })).not.toContain('series-similar');
    expect(codes({ color: { highlight: '#E2564A', bad: '#E2564A' } })).not.toContain('highlight-bad-similar');
    expect(codes({ color: { series: ['#FEFEFE', '#336699', '#663399'] } })).toContain('series-invisible');
  });
});

describe('legend values that draw nothing on a slope chart ', () => {
  it('refuses none and auto with the remove patch and keeps the values that draw a key', () => {
    const errors = (legend: unknown) => (render({ spec: { type: 'slope', data: {
      categories: ['2024', '2025'], series: [{ id: 'a', label: 'North', values: [10, 12] }, { id: 'b', label: 'South', values: [8, 7] }],
    }, options: { title: 'Share', legend } } }).body.errors ?? []) as { path: string; fix?: unknown }[];
    expect([errors('none')[0], errors('auto')[0], errors('top'), errors('bottom')]).toMatchObject([
      { path: '/options/legend', fix: [{ op: 'remove', path: '/options/legend' }] },
      { path: '/options/legend', fix: [{ op: 'remove', path: '/options/legend' }] },
      [], [],
    ]);
  });
});

describe('edge inputs that draw', () => {
  const body = (spec: unknown) => render({ spec }).body as { ok: boolean; errors?: { code: string; message: string }[] };
  // Blank series names gave an internal 'invalid SVG numeric' error in every chart with a series key.
  it('draws a series key whose names are blank', () => {
    for (const type of ['column', 'scatter', 'treemap'] as const) {
      const spec = JSON.parse(JSON.stringify(getFixtures(type)[0]!)) as { data: { series?: { label?: string }[] }; options?: object };
      for (const series of spec.data.series ?? []) series.label = ' ';
      expect(body({ type, data: spec.data, options: spec.options }), type).toMatchObject({ ok: true });
    }
  });
  // bandFraction 1 divided the target air by a zero gap and gave a layout error.
  it('draws a bullet whose band fills the row', () => {
    const fixture = getFixtures('bullet')[0]!;
    expect(body({ type: 'bullet', data: fixture.data, options: { ...fixture.options, bandFraction: 1 } })).toMatchObject({ ok: true });
  });
});

describe('label content parts', () => {
  // A part no chart reads passed validation and the chart drew no labels, with no word why.
  it('draws the number for value, drops a part no chart reads, and names the four parts', () => {
    const spec = (point: string[]) => ({ type: 'column', data: {
      categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      series: [{ id: 's', label: 'Sales', values: [10, 20] }] },
      options: { title: 'Sales by group', labels: { point } } });
    const draw = (point: string[]) => render({ spec: spec(point), return: ['svg'] }).body;
    const named = draw(['value']);
    const printsValues = (svg: unknown) => ['>10<', '>20<'].every(text => String(svg).includes(text));
    expect(printsValues(named.svg)).toBe(true);
    expect(named.warnings).toContainEqual(expect.objectContaining({ code: 'option-deprecated',
      message: "options.labels.point has 'value', which is not a label part. The parts are absolute, percent, category and series.",
      fix: [{ op: 'test', path: '/options/labels/point', value: ['value'] }, { op: 'replace', path: '/options/labels/point', value: ['absolute'] }] }));
    const unread = draw(['bogus']);
    expect(printsValues(unread.svg)).toBe(true);
    expect(unread.warnings).toContainEqual(expect.objectContaining({ fix: [{ op: 'remove', path: '/options/labels/point' }] }));
  });
});
