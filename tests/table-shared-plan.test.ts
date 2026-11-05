import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, planResolvedRequest, resolveChartRequest } from '../src/core/request';
import { renderSvg } from '../src/core/svg/renderSvg';
import { layoutTableCard } from '../src/core/charts/table/layout';
import { PLAN_ONLY, materializeLayout } from '../src/core/layoutPlan';
import type { TableData, TableOptions } from '../src/core/types/table';
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

// Sizing candidates must not draw, and a caller's edited scene must not corrupt the memoized plan.
it('defers drawing and returns an isolated result from the same numeric plan', () => {
  const data = structuredClone(fixture.data) as TableData;
  const options = { ...fixture.options, size: { width: 878 }, [PLAN_ONLY]: true } as TableOptions;
  const plan = layoutTableCard(data, options);
  expect(plan.scene).toEqual([]);
  const first = materializeLayout(plan);
  const expected = JSON.stringify(first);
  first.scene.length = 0;
  first.derived.table.rows[0]!.label = 'changed';
  const repeated = layoutTableCard(data, options);
  expect(repeated.scene).toEqual([]);
  expect(JSON.stringify(materializeLayout(repeated))).toBe(expected);
});

// A host's scene-free sizing must accept and refuse the same sizes as a full render.
it.each([878, 200])('keeps sizing and refusal advice without drawing at %i px', (width) => {
  const request = resolveChartRequest({ type: 'table', data: structuredClone(fixture.data), options: { ...fixture.options, size: { width }, belowMinimum: 'refuse' } } as Parameters<typeof resolveChartRequest>[0]);
  const planned = planResolvedRequest(request);
  const full = layoutResolvedRequest(request);
  expect(planned.refused).toBe(full.refused);
  expect(planned.size).toEqual(full.size);
  expect(planned.sizing).toEqual(full.sizing);
  if (planned.refused && full.refused) {
    expect(planned.required).toEqual(full.required);
    expect(planned.warnings).toEqual(full.warnings);
  } else if (!planned.refused) expect(planned.scene).toEqual([]);
});
