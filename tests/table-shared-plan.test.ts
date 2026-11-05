import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { renderSvg } from '../src/core/svg/renderSvg';
import type { Geometry } from '../src/core/types/scene';
import { defaultMeasurer, type TextMeasurer } from '../src/core/text';

const fixture = getFixtures('table').find((entry) => entry.id === 'steering-monthly')!;

function draw(data: object, width: number): string {
  const request = resolveChartRequest({ type: 'table', data, options: { ...fixture.options, size: { width } } } as Parameters<typeof resolveChartRequest>[0]);
  return renderSvg(layoutResolvedRequest(request) as Geometry, request.theme);
}

// The type class changes at 1080 px while the plot width stays 1023, so a plan shared across that edge draws the wrong fonts.
describe('table width plan shared on one data object', () => {
  // A caller may edit its returned cells and fonts without changing later charts that share measured tracks.
  it('keeps returned cells and fonts separate from shared preparation', () => {
    const data = structuredClone(fixture.data) as object;
    const request = resolveChartRequest({ type: 'table', data, options: { ...fixture.options, size: { width: 1200 } } } as Parameters<typeof resolveChartRequest>[0]);
    const result = layoutResolvedRequest(request) as Geometry;
    const expected = renderSvg(result, request.theme);
    const text = result.scene.find(node => node.t === 'text');
    if (text?.t === 'text') text.font.size += 20;
    const table = result.derived.table as import('../src/core/types/table').TableDerived['table'];
    const cell = Object.values(table.rows[0]!.cells)[0]!;
    const displayed = cell.displayed;
    cell.displayed = 'Changed by caller';
    const next = layoutResolvedRequest(request) as Geometry;
    expect(renderSvg(next, request.theme)).toBe(expected);
    expect(Object.values((next.derived.table as import('../src/core/types/table').TableDerived['table']).rows[0]!.cells)[0]!.displayed).toBe(displayed);
  });

  // A React host lays out again on stable data at every render, and it must not pay for the fit ladder each time.
  it('serves a repeat layout on stable data without measuring', () => {
    let calls = 0;
    const measure: TextMeasurer = (text, font) => { calls++; return defaultMeasurer(text, font); };
    const request = resolveChartRequest({ type: 'table', data: structuredClone(fixture.data), options: { ...fixture.options, measure, size: { width: 878 } } } as Parameters<typeof resolveChartRequest>[0]);
    const first = renderSvg(layoutResolvedRequest(request) as Geometry, request.theme);
    expect(calls).toBeGreaterThan(0);
    calls = 0;
    expect(renderSvg(layoutResolvedRequest(request) as Geometry, request.theme)).toBe(first);
    expect(calls).toBe(0);
  });

  it.each([[1079, 1087], [1087, 1079]])('draws %i then %i as fresh draws', (first, second) => {
    const shared = structuredClone(fixture.data) as object;
    draw(shared, first);
    expect(draw(shared, second)).toBe(draw(structuredClone(fixture.data) as object, second));
  });
});
