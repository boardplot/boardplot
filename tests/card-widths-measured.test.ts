import { describe, expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { cardFloorProblems } from './helpers/cardFloor';

const types = ['butterfly', 'likert', 'status', 'gantt', 'cohort', 'heatmap', 'bullet'];

describe('Measured card floors for butterfly, likert, status, gantt, cohort, heatmap and bullet', () => {
  for (const type of types) for (const fixture of getFixtures(type)) {
    // A compact bullet is an unlabelled 120 px mark, outside the 320 px card contract.
    if (type === 'bullet' && (fixture.options as any)?.density === 'compact') continue;
    it(`${type}/${fixture.id}`, () => {
      expect(cardFloorProblems({ type, data: fixture.data, options: fixture.options as any, annotations: fixture.annotations })).toEqual([]);
    }, 30_000);
  }
});
