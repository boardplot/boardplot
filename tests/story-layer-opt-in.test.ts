/**
 * The story pass is opt-in for React bundles: a per-type entry that never
 * links core/storyLayer draws the plain chart and says how to get the story.
 * Its own file, so no other import in the test run has linked the layer.
 */
import { expect, it } from 'vitest';
import '../src/react/charts/scatter';
import { getChart } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';

it('a per-type entry without withStory draws the plain chart and warns', () => {
  const fixture = getFixtures('scatter').find(item => item.id === 'story-use-case-matrix')!;
  const geo = getChart('scatter')!.layout(fixture.data as never, fixture.options as never);
  expect('story' in geo).toBe(false);
  expect(geo.warnings.find(entry => entry.code === 'story-layer-not-loaded')).toMatchObject({ severity: 'warn', suggest: "import { withStory } from 'boardplot/react/story'" });
});
