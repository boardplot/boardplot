/** An authored width never turns a chart that draws without it into a refusal. */
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { render } from '../src/cli/render';

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
    ['gantt', { rows: ganttRows }, { title: 'Program plan', today: '2026-07-03', legend: { position: 'right' }, size: { width: 470 } }],
  ])('%s draws', (type, data, options) => {
    expect(layout(type, data, options).refused).toBeFalsy();
  });
});
