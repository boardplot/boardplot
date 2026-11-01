import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
// Pre-baked, NOT derived from the packs at module load: `fixtures` is an eager
// ChartDefinition field, so importing the packs here would keep ~99 KB gzip of
// baked geometry alive in every bundle that touches this chart definition.
// scripts/generate-choropleth-fixtures.mjs owns these literals.
import { US_MARGIN_BY_STATE, WORLD_INFLATION } from './fixtures.generated';
import type { ChoroplethData, ChoroplethOptions } from './types';

const deValues = [
  ['DE-BW', 68.4],
  ['DE-BY', 82.1],
  ['DE-BE', 31.8],
  ['DE-BB', 18.6],
  ['DE-HB', 8.7],
  ['DE-HH', 26.4],
  ['DE-HE', 46.9],
  ['DE-MV', 9.8],
  ['DE-NI', 49.2],
  ['DE-NW', 104.3],
  ['DE-RP', 25.7],
  ['DE-SL', 7.1],
  ['DE-SN', 24.9],
  ['DE-ST', 13.3],
  ['DE-SH', 20.8],
  ['DE-TH', 12.6],
] as const;

const euInflation = [
  ['AT', 3.4],
  ['BE', 3.1],
  ['BG', 2.8],
  ['HR', 4.5],
  ['CY', 2.2],
  ['CZ', 2.7],
  ['DK', 1.8],
  ['EE', 4.1],
  ['FI', 1.2],
  ['FR', 1.6],
  ['DE', 2.3],
  ['GR', 2.9],
  ['HU', 5.2],
  ['IE', 1.4],
  ['IT', 1.1],
  ['LV', 3.3],
  ['LT', 3.7],
  ['LU', 2.1],
  ['MT', 2.6],
  ['NL', 3.8],
  ['PL', 4.7],
  ['PT', 2.1],
  ['RO', 5.6],
  ['SK', 3.9],
  ['SI', 2.5],
  ['ES', 2.4],
  ['SE', 1.9],
] as const;

const worldInflation = WORLD_INFLATION;

const usMarginByState = US_MARGIN_BY_STATE;

export const fixtures: Fixture<ChoroplethData, ChoroplethOptions>[] = [
  {
    id: 'german-states-revenue',
    title: 'Germany: revenue concentration by state',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'DE-BB' } },
    data: {
      pack: 'de-states',
      regions: deValues.map(([id, value]) => ({ id, value })),
    },
    options: {
      labels: 'auto',
      title: 'Four states, NW, BY, BW and NI, earn 55% of regional revenue',
      footnotes: ['NW 104.3, BY 82.1, BW 68.4 and NI 49.2: $304.0bn of $550.6bn, 55.2%.'],
      subtitle: { measure: 'Revenue by state', period: 'FY25' },
      unit: '$bn',
      format: '1.1',
      scale: { kind: 'sequential' },
      classes: 5,
      source: 'Illustrative management reporting',
    },
  },
  {
    id: 'eu-inflation',
    title: 'EU-27: inflation around a declared 2% midpoint',
    kind: 'example',
    data: {
      pack: 'eu27',
      regions: euInflation.map(([id, value]) => ({ id, value })),
    },
    options: {
      title: 'Inflation remains above 2% across much of Central and Eastern Europe',
      subtitle: { measure: 'Annual consumer-price inflation', period: 'June 2026' },
      format: '1.1%',
      scale: { kind: 'diverging', midpoint: 2, polarity: 'lowerIsBetter' },
      source: 'Illustrative harmonized inflation dataset',
      // At slide width the EU sliver belt (LV/CZ/AT/HU) spills into the
      // leader column, and 8 leaders break the ≤5 leader bound. The a4 page
      // (same steps, ~46% more map) places all but SI/MT inside their own shapes.
      size: 'a4',
    },
  },
  {
    id: 'dach-market-shares',
    title: 'DACH: sequential market shares',
    kind: 'torture',
    data: {
      pack: 'dach',
      regions: [
        { id: 'DE', value: 34.6 },
        { id: 'AT', value: 27.8 },
        { id: 'CH', value: 31.2 },
      ],
    },
    options: {
      title: 'Germany leads DACH share, with Switzerland close behind',
      subtitle: { measure: 'Category market share', period: 'FY25' },
      format: '1.1%',
      scale: { kind: 'sequential' },
      source: 'Illustrative syndicated market panel',
    },
  },
  {
    id: 'world-inflation',
    title: 'World inflation: relevance-driven country labels',
    kind: 'example',
    data: {
      pack: 'world',
      regions: worldInflation,
    },
    options: {
      size: 'a4',
      title: 'Inflation pressure remains uneven across the world',
      subtitle: { measure: 'Illustrative annual consumer-price inflation', period: '2026' },
      format: '1.1%',
      scale: { kind: 'diverging', midpoint: 3, polarity: 'lowerIsBetter' },
      labelDensity: 'full',
      source: 'Illustrative values; newspaper-style cartography',
    },
  },
  {
    id: 'world-inflation-all-labels',
    title: 'Torture: world inflation with the full region census',
    kind: 'torture',
    // What the lattice cannot name, and every micro-state that
    // needed a leader across the map, is listed with its value above the map.
    data: {
      pack: 'world',
      regions: worldInflation,
    },
    options: {
      // a4 does not seat every code of the world pack, so this census
      // fixture takes the 1642 wide tall step.
      size: { width: 1642, height: 1235 },
      title: 'Full world label census remains available on demand',
      subtitle: { measure: 'Illustrative annual consumer-price inflation', period: '2026' },
      format: '1.1%',
      scale: { kind: 'diverging', midpoint: 3, polarity: 'lowerIsBetter' },
      labelDensity: 'full',
      labels: 'all',
      source: 'Illustrative values; newspaper-style cartography',
    },
  },
  {
    id: 'us-margin-by-state',
    title: 'US states: sequential operating margin with Northeast callouts',
    kind: 'example',
    data: {
      pack: 'us-states',
      regions: usMarginByState,
    },
    options: {
      // Every state prints its value, so the map takes the
      // tallest rung (800 / 1.33) and the key row above it; the states whose
      // value does not fit are listed with it above the map.
      size: { width: 800, height: 602 },
      regionValues: true,
      title: 'State margins vary by more than ten percentage points',
      subtitle: { measure: 'Illustrative operating margin', period: 'FY26' },
      unit: '%',
      format: '1.1%',
      scale: { kind: 'sequential' },
      classes: 5,
      labelDensity: 'full',
      source: 'Illustrative data',
    },
  },
  {
    id: 'world-footprint',
    title: 'World footprint: nine market Harvey overlays on a muted choropleth',
    kind: 'example',
    data: {
      pack: 'world',
      regions: [
        { id: 'US', value: 22 },
        { id: 'GB', value: 8 },
        { id: 'DE', value: 10 },
        { id: 'BR', value: 7 },
        { id: 'ZA', value: 4 },
        { id: 'IN', value: 9 },
        { id: 'CN', value: 13 },
        { id: 'JP', value: 6 },
        { id: 'AU', value: 5 },
      ],
      overlays: [
        { id: 'us', at: { region: 'US' }, glyph: { kind: 'harvey', value: 0.92 }, label: 'US 92%', size: 'md' },
        { id: 'gb', at: { region: 'GB' }, glyph: { kind: 'harvey', value: 0.78 }, label: 'UK 78%', size: 'sm' },
        { id: 'de', at: { region: 'DE' }, glyph: { kind: 'harvey', value: 0.84 }, label: 'DE 84%', size: 'sm' },
        { id: 'br', at: { region: 'BR' }, glyph: { kind: 'harvey', value: 0.61 }, label: 'BR 61%', size: 'md' },
        { id: 'za', at: { region: 'ZA' }, glyph: { kind: 'harvey', value: 0.46, tone: 'warn' }, label: 'ZA 46%', size: 'sm' },
        { id: 'in', at: { region: 'IN' }, glyph: { kind: 'harvey', value: 0.69 }, label: 'IN 69%', size: 'md' },
        { id: 'cn', at: { region: 'CN' }, glyph: { kind: 'harvey', value: 0.73 }, label: 'CN 73%', size: 'md' },
        { id: 'jp', at: { region: 'JP' }, glyph: { kind: 'harvey', value: 0.88 }, label: 'JP 88%', size: 'sm' },
        { id: 'au', at: { region: 'AU' }, glyph: { kind: 'harvey', value: 0.57 }, label: 'AU 57%', size: 'md' },
      ],
    },
    options: {
      // At slide height the legend, pack note and source push the map band
      // under the 0.60 floor; the a4 rung keeps it above.
      size: { width: 720, height: 511 },
      // With methodNote the pack disclaimer still prints once, on the source line.
      methodNote: true,
      title: 'Priority-market footprint and activation progress',
      // The fill and the Harvey balls are two measures, each named once.
      subtitle: { measure: 'Market weight and activation progress', period: 'FY26' },
      keyTitle: 'Indexed market weight',
      overlayMeasure: 'Market activation progress, %',
      overlayTones: { warn: 'Activation behind plan' },
      format: '1',
      scale: { kind: 'sequential' },
      classes: 3,
      labels: 'none',
      source: 'Illustrative market footprint',
    },
  },
  {
    id: 'world-all-null',
    title: 'Torture: every world region is explicit no-data',
    kind: 'torture',
    data: {
      pack: 'world',
      regions: WORLD_INFLATION.map(({ id }) => ({ id, value: null })),
    },
    options: {
      size: 'a4',
      title: 'No country observations are available',
      subtitle: { measure: 'Illustrative reporting coverage', period: '2026' },
    },
  },
  {
    id: 'all-null',
    title: 'Torture: every DACH region is explicit no-data',
    kind: 'torture',
    data: {
      pack: 'dach',
      regions: [
        { id: 'DE', value: null },
        { id: 'AT', value: null },
        { id: 'CH', value: null },
      ],
    },
    options: {
      title: 'No DACH observations are available',
      subtitle: { measure: 'Survey response rate', period: 'Wave 1' },
    },
  },
  {
    id: 'single-region-data',
    title: 'Torture: one supplied value, fifteen visible missing regions',
    kind: 'torture',
    data: {
      pack: 'de-states',
      regions: [{ id: 'DE-BY', value: 82.1 }],
    },
    options: {
      title: 'Bavaria is reported; every other state remains visibly missing',
      subtitle: { measure: 'Revenue reported', period: 'FY25' },
      unit: '$bn',
      format: '1.1',
    },
  },
  {
    id: 'dense-labels',
    title: 'Torture: EU-27 full labels on a dashboard tile',
    kind: 'torture',
    data: {
      pack: 'eu27',
      regions: euInflation.map(([id, value]) => ({ id, value })),
    },
    options: {
      // At 480 wide even the tall rung cannot fund title + subtitle + legend +
      // source above the 0.60 floor, so the measure sits in the title and every
      // label carries the '%' through format. The fixture stays a label-solver
      // stress (EU-27 full labels on a small map).
      size: { width: 480, height: 361 },
      // Numeral-free on purpose: this fixture has no data claim to make,
      // so its title carries no digits.
      title: 'EU inflation label-solver stress',
      format: '1.1%',
      scale: { kind: 'diverging', midpoint: 2, polarity: 'lowerIsBetter' },
      labelDensity: 'full',
    },
  },
];

// the europe pack holds the EU27 plus CH, NO, IS, GB, the Balkan states,
// UA, BY, MD and the small states. LI, MC, SM and VA draw as markers.
fixtures.push({
  id: 'europe-inflation',
  title: 'Europe: inflation around a declared 2% midpoint, with CH, NO, GB and UA',
  kind: 'example',
  data: {
    pack: 'europe',
    regions: [
      ...euInflation.map(([id, value]) => ({ id, value })),
      { id: 'CH', value: 0.4 },
      { id: 'NO', value: 3.1 },
      { id: 'IS', value: 4.2 },
      { id: 'GB', value: 3.6 },
      { id: 'AL', value: 2.9 },
      { id: 'BA', value: 3.3 },
      { id: 'ME', value: 3.5 },
      { id: 'MK', value: 3.8 },
      { id: 'RS', value: 4.4 },
      { id: 'XK', value: 2.7 },
      { id: 'UA', value: 8.1 },
      { id: 'MD', value: 5.9 },
      { id: 'LI', value: 0.6 },
      { id: 'MC', value: 1.9 },
    ],
  },
  options: {
    title: 'Inflation is highest in Ukraine and low in Switzerland',
    subtitle: { measure: 'Annual consumer-price inflation', period: 'June 2026' },
    unit: '%',
    format: '1.1%',
    scale: { kind: 'diverging', midpoint: 2, polarity: 'lowerIsBetter' },
    source: 'Illustrative harmonized inflation dataset',
    size: 'a4',
  },
});

// the world pack now holds small places such as HK, MC and LI as
// markers, so a host does not need an overlay to show them.
fixtures.push({
  id: 'world-small-markets',
  title: 'World: Hong Kong, Monaco and Liechtenstein draw as markers',
  kind: 'example',
  data: {
    pack: 'world',
    regions: [
      { id: 'US', value: 31 },
      { id: 'DE', value: 18 },
      { id: 'CN', value: 14 },
      { id: 'HK', value: 9 },
      { id: 'MC', value: 3 },
      { id: 'LI', value: 5 },
    ],
  },
  options: {
    size: { width: 720, height: 511 },
    title: 'Hong Kong outsells Monaco and Liechtenstein combined',
    subtitle: { measure: 'Revenue', period: 'FY26' },
    unit: '$m',
    format: '1',
    scale: { kind: 'sequential' },
    classes: 3,
    microStateMarkers: true,
    source: 'Illustrative market data',
  },
});

const smallMembers = fixtures.find((fixture) => fixture.id === 'eu-inflation')!;
fixtures.push({
  ...smallMembers,
  id: 'eu-small-members-target', kind: 'torture',
  title: 'EU small members beside a named inflation target',
  options: { ...smallMembers.options, smallRegionArea: 0.001,
    scale: { kind: 'diverging', midpoint: 2, midpointLabel: 'target', polarity: 'lowerIsBetter' } },
});

fixtures.push({
  ...smallMembers,
  id: 'eu-inflation-values',
  title: 'EU inflation with each region value printed after its code',
  options: { ...smallMembers.options, regionValues: true },
});

// colorblindSafe paints the poles of the diverging scale from theme.color.colorblind.
fixtures.push({
  ...smallMembers,
  id: 'eu-inflation-colorblind',
  title: 'EU inflation around 2% in the colorblind-safe good/bad pair',
  options: { ...smallMembers.options, colorblindSafe: true },
});

const margin = fixtures.find((fixture) => fixture.id === 'us-margin-by-state')!;
fixtures.push({
  ...margin,
  id: 'us-margin-versus-target',
  title: 'State margins above the target are favorable',
  // The spec names its states; labels false keeps meaning no labels.
  options: { ...margin.options,
    scale: { kind: 'diverging', midpoint: 15, polarity: 'higherIsBetter' } },
});
// A wide slot: the key and the list of unlabelled states stand in a column beside the map.
fixtures.push({
  ...margin,
  id: 'us-margin-wide-slot',
  title: 'State margins on a wide slot: the key and the unlabelled states stand beside the map',
  options: { ...margin.options, size: { width: 1184, height: 528 }, regionValues: false, labelDensity: 'smart' },
});
const dach = fixtures.find((fixture) => fixture.id === 'dach-market-shares')!;
fixtures.push({
  ...dach,
  id: 'dach-all-region-labels',
  kind: 'example',
  title: 'All three DACH markets carry their region labels',
  // The value table's default spelled out: three markets fit beside the map.
  options: { ...dach.options, labels: 'all', valueTable: 'auto' },
});

// Bremen labelled on the map instead of in the small-member inset, under an
// authored key title.
const germanStates = fixtures.find((fixture) => fixture.id === 'german-states-revenue')!;
fixtures.push(
  {
    ...germanStates,
    kind: 'torture', id: 'german-states-bremen-on-map',
    title: 'Bremen keeps its label on the map through labelRegions, under an authored key title',
    tags: ['coverage'],
    options: { ...germanStates.options, labelRegions: ['DE-HB'], keyTitle: 'FY25 revenue, $bn' },
  },
  // The value table forced under the map, forced beside
  // it on a slide frame, and left off, where the map lists what it cannot label.
  {
    ...germanStates,
    id: 'german-states-table-below',
    title: 'The value table stands under the map',
    tags: ['coverage'],
    options: { ...germanStates.options, valueTable: 'below' },
  },
  {
    ...germanStates,
    kind: 'torture', id: 'german-states-table-side',
    title: 'The value table stands beside the map on a slide frame',
    tags: ['coverage'],
    options: { ...germanStates.options, valueTable: 'side', size: { width: 960, height: 540 } },
  },
  {
    ...germanStates,
    kind: 'torture', id: 'german-states-without-table',
    title: 'Without the value table the map labels every state it can and lists the rest',
    tags: ['coverage'],
    options: { ...germanStates.options, valueTable: false },
  },
);

// The automatic world labels cut to the six largest values, the overlay key
// naming every tone, and dots for micro-states listed without a value.
const worldInflationFixture = fixtures.find((fixture) => fixture.id === 'world-inflation')!;
const worldFootprint = fixtures.find((fixture) => fixture.id === 'world-footprint')!;
fixtures.push(
  {
    ...worldInflationFixture,
    id: 'world-inflation-top-six-labels',
    title: 'The automatic labels name the six largest values plus the large countries',
    tags: ['coverage'],
    options: { ...worldInflationFixture.options, topN: { n: 6 } },
  },
  {
    ...worldFootprint,
    id: 'world-footprint-every-tone',
    title: 'Market overlays in every tone, each tone named in the overlay key',
    tags: ['coverage'],
    data: {
      ...worldFootprint.data,
      overlays: [
        { id: 'us', at: { region: 'US' }, glyph: { kind: 'harvey', value: 0.92, tone: 'good' }, label: 'US 92%', size: 'md' },
        { id: 'br', at: { region: 'BR' }, glyph: { kind: 'harvey', value: 0.41, tone: 'bad' }, label: 'BR 41%', size: 'md' },
        { id: 'za', at: { region: 'ZA' }, glyph: { kind: 'harvey', value: 0.46, tone: 'warn' }, label: 'ZA 46%', size: 'sm' },
        { id: 'in', at: { region: 'IN' }, glyph: { kind: 'harvey', value: 0.69, tone: 'neutral' }, label: 'IN 69%', size: 'md' },
        { id: 'au', at: { region: 'AU' }, glyph: { kind: 'harvey', value: 0.57, tone: 'info' }, label: 'AU 57%', size: 'md' },
      ],
    },
    options: {
      ...worldFootprint.options,
      overlayTones: { good: 'Ahead of plan', bad: 'Stalled', warn: 'Behind plan', neutral: 'Not yet rated', info: 'Pilot market' },
    },
  },
  {
    ...worldFootprint,
    id: 'world-footprint-micro-dots',
    title: 'Singapore and Malta listed without data, drawn as dots through microStateMarkers',
    tags: ['coverage'],
    data: { ...worldFootprint.data, regions: [...worldFootprint.data.regions, { id: 'SG', value: null }, { id: 'MT', value: null }] },
    options: { ...worldFootprint.options, microStateMarkers: true },
  },
);

// every overlay glyph kind on the map, the four statuses, a pie in
// every tone, the three marker shapes and the large size.
fixtures.push({
  ...worldFootprint,
  id: 'world-footprint-glyphs',
  title: 'Status, pie, icon and marker overlays in every tone, shape and size',
  kind: 'torture',
  // The smaller type seats the DE hub label, so no label-hidden is expected.
  tags: ['demo', 'coverage'],
  data: {
    ...worldFootprint.data,
    overlays: [
      { id: 'us', at: { region: 'US' }, glyph: { kind: 'status', status: 'good' }, label: 'US live' },
      { id: 'br', at: { region: 'BR' }, glyph: { kind: 'status', status: 'warn' }, label: 'BR behind' },
      { id: 'za', at: { region: 'ZA' }, glyph: { kind: 'status', status: 'bad' }, label: 'ZA stalled' },
      { id: 'in', at: { region: 'IN' }, glyph: { kind: 'status', status: 'neutral' }, label: 'IN not rated' },
      {
        id: 'cn', at: { region: 'CN' }, label: 'CN store audit', size: 'lg',
        glyph: { kind: 'pie', shares: [
          { label: 'Passed', value: 40, tone: 'good' },
          { label: 'Minor issues', value: 20, tone: 'warn' },
          { label: 'Failed', value: 10, tone: 'bad' },
          { label: 'Not audited', value: 15, tone: 'neutral' },
          { label: 'Re-audit due', value: 15, tone: 'info' },
        ] },
      },
      { id: 'gb', at: { region: 'GB' }, glyph: { kind: 'icon', name: 'flag', tone: 'info' }, label: 'UK pilot office', size: 'sm' },
      { id: 'de', at: { region: 'DE' }, glyph: { kind: 'marker', shape: 'circle' }, label: 'DE hub', size: 'sm' },
      { id: 'jp', at: { region: 'JP' }, glyph: { kind: 'marker', shape: 'square' }, label: 'JP hub', size: 'sm' },
      { id: 'au', at: { region: 'AU' }, glyph: { kind: 'marker', shape: 'diamond' }, label: 'AU hub' },
    ],
  },
  options: {
    ...worldFootprint.options,
    title: 'Rollout is live in the US and stalled in South Africa',
    subtitle: { measure: 'Market weight and rollout status', period: 'FY26' },
    overlayMeasure: undefined,
    overlayTones: { good: 'Live', warn: 'Behind plan', bad: 'Stalled', neutral: 'Not rated', info: 'Pilot' },
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
    overlayTones: { good: 'Ready' }, size: { width: 1000, height: 700 },
  },
});

fixtures.push({
  "id": "overlay-measure-heading",
  "title": "The overlay measure has a heading",
  "kind": "torture",
  "data": {
    "pack": "dach",
    "regions": [
      {
        "id": "DE",
        "value": 23
      }
    ],
    "overlays": [
      {
        "id": "site",
        "at": {
          "region": "DE"
        },
        "label": "Site A",
        "glyph": {
          "kind": "harvey",
          "value": 0.5
        }
      }
    ]
  },
  "options": {
    "title": "The overlay measure has a heading",
    "source": "Invented example",
    "overlayMeasure": "Completion",
    "size": {
      "width": 960,
      "height": 620
    }
  }
});

fixtures.push({
  id: 'named-null-states', title: 'Named map states differ from missing values', kind: 'torture',
  data: { pack: 'eu27', regions: [
    { id: 'DE', value: 12 }, { id: 'FR', value: null, state: 'suppressed' },
    { id: 'AT', value: null, state: 'nm' }, { id: 'IT', value: null, state: 'na' }, { id: 'ES', value: null },
  ] },
  options: { title: 'Map patterns explain each unavailable value', size: { width: 900, height: 650 } },
});
fixtures.push({
  id: 'info-glyphs-with-status', title: 'Info marker and icon tones appear beside status in the key', kind: 'torture',
  data: { pack: 'eu27', regions: [{ id: 'DE', value: 12 }, { id: 'FR', value: 17 }, { id: 'ES', value: 14 }], overlays: [
    { id: 'ready', at: { region: 'DE' }, label: 'Site A', glyph: { kind: 'status', status: 'good' } },
    { id: 'info-marker', at: { region: 'FR' }, label: 'Site B', glyph: { kind: 'marker', tone: 'info' } },
    { id: 'info-icon', at: { region: 'ES' }, label: 'Site C', glyph: { kind: 'icon', name: 'lightbulb', tone: 'info' } },
  ] },
  options: { title: 'Ready and information sites have matching keys', overlayTones: { good: 'Ready', info: 'Information' }, size: { width: 900, height: 650 } },
});
registerFixtures('choropleth', fixtures);
