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
