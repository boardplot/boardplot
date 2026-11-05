import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { renderSvg } from '../src/core/svg/renderSvg';
import type { Geometry } from '../src/core/types/scene';

const fixture = getFixtures('table').find((entry) => entry.id === 'steering-monthly')!;

function draw(data: object, width: number): string {
  const request = resolveChartRequest({ type: 'table', data, options: { ...fixture.options, size: { width } } } as Parameters<typeof resolveChartRequest>[0]);
  return renderSvg(layoutResolvedRequest(request) as Geometry, request.theme);
}

// The type class changes at 1080 px while the plot width stays 1023, so a plan shared across that edge draws the wrong fonts.
describe('table width plan shared on one data object', () => {
  it.each([[1079, 1087], [1087, 1079]])('draws %i then %i as fresh draws', (first, second) => {
    const shared = structuredClone(fixture.data) as object;
    draw(shared, first);
    expect(draw(shared, second)).toBe(draw(structuredClone(fixture.data) as object, second));
  });
});
