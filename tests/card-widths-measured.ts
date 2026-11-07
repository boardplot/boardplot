import { expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { cardFloorProblems } from './helpers/cardFloor';

const types = ['butterfly', 'likert', 'status', 'gantt', 'cohort', 'heatmap', 'bullet'];

/** Every `parts`-th measured card-floor case, so the slow set runs as several files in parallel. */
export function measuredCases(part: number, parts: number): void {
  const cases = types.flatMap((type) => getFixtures(type).map((fixture) => ({ type, fixture })))
    // A compact bullet is an unlabelled 120 px mark, outside the 320 px card contract.
    .filter(({ type, fixture }) => !(type === 'bullet' && (fixture.options as any)?.density === 'compact'));
  for (const { type, fixture } of cases.filter((_, index) => index % parts === part - 1))
    it(`${type}/${fixture.id}`, () => {
      expect(cardFloorProblems({ type, data: fixture.data, options: fixture.options as any, annotations: fixture.annotations })).toEqual([]);
    }, 30_000);
}
