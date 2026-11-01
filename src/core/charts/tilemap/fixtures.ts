import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import { getTilePack } from '../../geo/tiles';
import type { TilemapData, TilemapOptions } from './types';

function valuesFor(packId: TilemapData['pack'], valueOf: (index: number) => number | null) {
  return getTilePack(packId).regions.map((region, index) => ({
    id: region.id,
    value: valueOf(index),
  }));
}

export const fixtures: Fixture<TilemapData, TilemapOptions>[] = [
  {
    id: 'eu27-equal-tiles',
    title: 'EU-27 tile grid: equal visual weight for every member',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'AT' } },
    data: {
      pack: 'eu27',
      regions: valuesFor('eu27', (index) => index === 8 ? null : 82 + (index % 9) * 2.4),
    },
    options: {
      title: 'EU demand remains broad-based',
      subtitle: { measure: 'Demand index', period: '2026' },
      source: 'Illustrative planning data',
      format: '100.0',
      classes: 5,
      scale: { kind: 'sequential' },
    },
  },
  {
    id: 'us-state-tile-grid',
    title: 'US states + DC: equal-area alternative with explicit no-data trace',
    kind: 'example',
    data: {
      pack: 'us-states',
      regions: valuesFor('us-states', (index) => index % 17 === 0 ? null : 40 + (index * 13) % 61),
    },
    options: {
      title: 'State coverage is strongest through the central corridor',
      subtitle: { measure: 'Coverage score', period: '2026' },
      source: 'Illustrative planning data',
      format: '100',
      classes: 5,
      regionValues: true,
    },
  },
  {
    id: 'world-tile-grid-dense',
    title: 'Torture: every world-pack member remains an equal tile with an abbreviation',
    kind: 'torture',
    data: {
      pack: 'world',
      regions: valuesFor('world', (index) => index % 23 === 0 ? null : ((index * 29) % 121) - 60),
    },
    options: {
      size: { width: 1642, height: 1235 },
      title: 'World exposure is balanced across regions',
      subtitle: { measure: 'Index versus plan', period: '2026' },
      source: 'Illustrative planning data',
      format: '100',
      scale: { kind: 'diverging', midpoint: 0, polarity: 'higherIsBetter' },
      classes: 7,
      labelDensity: 'full',
    },
  },
];

for (const polarity of ['higherIsBetter', 'lowerIsBetter'] as const) {
  const higher = polarity === 'higherIsBetter';
  fixtures.push({
    id: higher ? 'eu27-demand-versus-plan' : 'eu27-cost-versus-plan',
    title: higher ? 'Demand above plan is favorable' : 'Cost below plan is favorable',
    kind: 'example',
    data: {
      pack: 'eu27',
      // Demand and cost get different integer gaps to plan, so the two maps do not repeat one pattern.
      regions: valuesFor('eu27', (index) => index === 8 ? null : higher ? ((index * 7) % 13 - 6) * 2 : ((index * 4 + 5) % 11 - 5) * 2),
    },
    options: {
      title: higher ? 'Demand varies around plan' : 'Cost control varies around plan',
      // the key prints each class in %, the subtitle defines the variance.
      subtitle: { measure: `${higher ? 'Demand' : 'Cost'} versus plan, (actual − plan) ÷ plan`, period: '2026' },
      source: 'Illustrative planning data',
      format: '+1%',
      scale: { kind: 'diverging', midpoint: 0, polarity },
      classes: 5,
    },
  });
}

// colorblindSafe paints the poles of the diverging scale from theme.color.colorblind.
const demand = fixtures.find((fixture) => fixture.id === 'eu27-demand-versus-plan')!;
fixtures.push({
  ...demand,
  id: 'eu27-demand-colorblind',
  title: 'Demand versus plan in the colorblind-safe good/bad pair',
  options: { ...demand.options, colorblindSafe: true },
});

/**
 * The value key right of the tiles, from their top, because the spec names
 * 'right'; the layout says what that costs the plot (lint legend-beside-plot).
 * Every unnamed key sits in one row above the plot.
 */
const coverage = fixtures.find((fixture) => fixture.id === 'us-state-tile-grid')!;
fixtures.push({
  ...coverage,
  id: 'tile-key-right',
  title: 'Refusal example: the value key right of the tiles, refused for the width it takes',
  kind: 'example',
  refuses: { code: 'invalid-options', path: 'options.legend' },
  options: {
    ...coverage.options,
    legend: 'right',
    footnotes: false,
  },
});

// The key below the tiles. 'none' draws
// the key anyway (tilemap-legend-required), so it has no demo.
const stateGrid = fixtures.find((fixture) => fixture.id === 'us-state-tile-grid')!;
fixtures.push(
  { ...stateGrid, id: 'tile-key-bottom', title: 'The value key in one row below the tiles', tags: ['coverage'], options: { ...stateGrid.options, legend: 'bottom' } },
);

// Overlays on the tile grid in every tone, each tone and the measure the
// Harvey balls show named in the overlay key.
fixtures.push({
  ...stateGrid,
  id: 'us-states-overlay-tones',
  title: 'Five state overlays in every tone, the tones and the ball measure named in the overlay key',
  tags: ['coverage'],
  data: {
    ...stateGrid.data,
    overlays: [
      // States on the grid's edge, so each label has open space beside its tile;
      // MO sits inside the grid, so its text moves to the note under the tiles.
      { id: 'wa', at: { region: 'US-WA' }, glyph: { kind: 'harvey', value: 0.9, tone: 'good' }, label: 'WA 90%' },
      { id: 'mo', at: { region: 'US-MO' }, glyph: { kind: 'harvey', value: 0.45 }, label: 'MO 45%' },
      { id: 'ri', at: { region: 'US-RI' }, glyph: { kind: 'harvey', value: 0.35, tone: 'bad' }, label: 'RI 35%' },
      { id: 'ak', at: { region: 'US-AK' }, glyph: { kind: 'harvey', value: 0.55, tone: 'warn' }, label: 'AK 55%' },
      { id: 'ct', at: { region: 'US-CT' }, glyph: { kind: 'harvey', value: 0.7, tone: 'neutral' }, label: 'CT 70%' },
      { id: 'me', at: { region: 'US-ME' }, glyph: { kind: 'harvey', value: 0.6, tone: 'info' }, label: 'ME 60%' },
    ],
  },
  options: {
    ...stateGrid.options,
    overlayTones: { good: 'Rollout ahead', bad: 'Rollout stalled', warn: 'Rollout behind', neutral: 'Not rated', info: 'Pilot state' },
    overlayMeasure: 'Rollout progress, %',
    // The overlay key takes a row, so the canvas is tall enough to keep the tiles their share.
    size: { width: 720, height: 714 },
  },
});

// every overlay glyph kind on the tile grid, the four statuses, a pie
// in every tone, the three marker shapes and the three sizes.
fixtures.push({
  ...stateGrid,
  id: 'us-states-overlay-glyphs',
  title: 'Status, pie, icon and marker overlays in every tone, shape and size',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    ...stateGrid.data,
    overlays: [
      { id: 'wa', at: { region: 'US-WA' }, glyph: { kind: 'status', status: 'good' }, label: 'WA live' },
      { id: 'ca', at: { region: 'US-CA' }, glyph: { kind: 'status', status: 'warn' }, label: 'CA behind' },
      { id: 'fl', at: { region: 'US-FL' }, glyph: { kind: 'status', status: 'bad' }, label: 'FL stalled' },
      { id: 'tx', at: { region: 'US-TX' }, glyph: { kind: 'status', status: 'neutral' }, label: 'TX not rated' },
      {
        id: 'me', at: { region: 'US-ME' }, label: 'ME store audit',
        glyph: { kind: 'pie', shares: [
          { label: 'Passed', value: 40, tone: 'good' },
          { label: 'Minor issues', value: 20, tone: 'warn' },
          { label: 'Failed', value: 10, tone: 'bad' },
          { label: 'Not audited', value: 15, tone: 'neutral' },
          { label: 'Re-audit due', value: 15, tone: 'info' },
        ] },
      },
      { id: 'nj', at: { region: 'US-NJ' }, glyph: { kind: 'icon', name: 'flag', tone: 'info' }, label: 'NJ pilot office' },
      { id: 'ri', at: { region: 'US-RI' }, glyph: { kind: 'marker', shape: 'circle' }, label: 'RI depot', size: 'sm' },
      { id: 'de', at: { region: 'US-DE' }, glyph: { kind: 'marker', shape: 'square' }, label: 'DE depot', size: 'md' },
      { id: 'hi', at: { region: 'US-HI' }, glyph: { kind: 'marker', shape: 'diamond' }, label: 'HI depot', size: 'lg' },
    ],
  },
  options: {
    ...stateGrid.options,
    title: 'Rollout is live in the west and stalled in Florida',
    overlayTones: { good: 'Live', warn: 'Behind plan', bad: 'Stalled', neutral: 'Not rated', info: 'Pilot' },
    size: { width: 720, height: 714 },
  },
});

fixtures.push({
  id: 'outlier-steps-and-missing-values',
  title: 'Explicit thresholds keep ordinary values distinct from an outlier',
  kind: 'example',
  data: {
    pack: 'eu27',
    regions: [
      { id: 'DE', value: 10 }, { id: 'FR', value: 20 }, { id: 'AT', value: 30 },
      { id: 'IT', value: 40 }, { id: 'ES', value: 900 }, { id: 'PL', value: null },
    ],
    overlays: [{ id: 'ready', at: { region: 'DE' }, glyph: { kind: 'status', status: 'good' }, label: 'Ready' }],
  },
  options: {
    title: 'Five areas span five score classes',
    subtitle: { measure: 'Illustrative score', period: 'Example' },
    source: 'Invented demonstration data', format: '100',
    steps: [15, 25, 35, 45], regionValues: true,
    overlayTones: { good: 'Ready' }, size: { width: 1000, height: 762 },
  },
});

fixtures.push({
  id: 'named-null-states', title: 'Named map states differ from missing values', kind: 'torture',
  data: { pack: 'eu27', regions: [
    { id: 'DE', value: 12 }, { id: 'FR', value: null, state: 'suppressed' },
    { id: 'AT', value: null, state: 'nm' }, { id: 'IT', value: null, state: 'na' }, { id: 'ES', value: null },
  ] },
  options: { title: 'Map patterns explain each unavailable value', size: { width: 900, height: 650 } },
});
// europe tiles hold CH, NO, GB, UA and the small states beside the EU27.
fixtures.push({
  id: 'europe-tile-grid',
  title: 'Europe tile grid: every member of the europe pack as an equal tile',
  kind: 'example',
  data: {
    pack: 'europe',
    regions: valuesFor('europe', (index) => index === 11 ? null : 70 + (index * 7) % 31),
  },
  options: {
    title: 'Demand is broad-based across Europe',
    subtitle: { measure: 'Demand index', period: '2026' },
    source: 'Illustrative planning data',
    format: '100',
    classes: 5,
    scale: { kind: 'sequential' },
  },
});
registerFixtures('tilemap', fixtures);
