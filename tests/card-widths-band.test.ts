import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { cardFloorProblems, type CardRequest } from './helpers/cardFloor';

// The band types report a measured card-width floor.
const BAND = ['waterfall', 'pareto', 'variance', 'pyramid', 'box', 'mekko', 'pvm'] as const;
const request = (type: string, fixture: { data: unknown; options?: object; annotations?: unknown[] }): CardRequest =>
  ({ type, data: fixture.data, options: { ...fixture.options }, ...(fixture.annotations ? { annotations: fixture.annotations } : {}) });

// Each known problem has a cause; a new problem fails the test.
// Mekko has no band floor because its widths encode data.
const KNOWN = new Set([
  'mekko/unit-cost-staircase: R1 ann:valueLine-1:line:0 at 400',
  'mekko/unit-cost-staircase: R1 ann:valueLine-1:line:0 at 320',
  'mekko/dense-10-columns: R2 total:c06 / total:c07 at 400',
  'mekko/dense-10-columns: R2 total:c05 / total:c06 at 320',
  'mekko/dense-10-columns: R2 total:c07 / total:c09 at 320',
  'mekko/dense-10-columns: R2 total:c08 / total:c10 at 320',
  'mekko/topn-others: R2 total:de / total:jp at 320',
  'waterfall/torture-long-labels: R2 total:gross / sum:volume at 320',
  // full mode must print every name. On the slide target the rotated name claim reaches
  // into the axis line (rotatedClaimRect, shared category row), so every name hides below 480 and
  // the chart refuses.
  "pvm/revenue-bridge-notes-listed: refused at its minimum width 360: More height did not resolve the hidden labels: 'Current' (category:current) against axis ; 'Lost items' (category:lost) against axis ; 'Mix' (category:mix) against axis ; 'New items' (category:new) against axis ; 'Price' (category:price) against axis ; 'Prior' (category:prior) against axis ; 'Volume' (category:volume) against axis ",
  'pvm/revenue-bridge-notes-listed: refused at 359 without a fix of at least 320 px',
  // At 280 px the automatic height takes the 400 px card's 583 px, where the rotated 50-character
  // names collide; it refuses with a 322 px fix that draws. Pinned at 280 x 315 (measure's pair) it draws.
  'waterfall/torture-long-labels: refused at its minimum width 280: Waterfall / bridge needs at least 322 × 603px; received 280 × 583px',
]);

describe('band card widths', () => {
  // A sweep measures and draws every fixture at its floor, 400 and 320 px: about 19 s for waterfall on a loaded machine.
  it.each(BAND)('%s keeps the card-width contract on every fixture', (type) => {
    const broken = getFixtures(type).flatMap((fixture) =>
      cardFloorProblems(request(type, fixture as never)).map((problem) => `${type}/${fixture.id}: ${problem}`))
      .filter((problem) => !KNOWN.has(problem));
    expect(broken).toEqual([]);
  }, 60_000);

});
