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
  ])('%s %s draws and warns', (type, id, options, columnOverrides) => {
    expect(draw(type, id, options).refused).toBeFalsy();
    const geometry = draw(type, id, { ...options, columnOverrides });
    expect(geometry.refused).toBeFalsy();
    expect(geometry.warnings.map((warning) => warning.code)).toContain('generated-column-width-capped');
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
