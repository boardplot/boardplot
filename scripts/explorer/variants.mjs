/** Visual forms only. Cosmetic choices are generated from each Zod schema. */
const v = (id, fixture, options, label = id) => ({ id, label, fixture, ...(options ? { options } : {}) });
// A one-form type has no variant: its card ID is the type alone.
const one = (fixture, options) => ({ variants: [v('', fixture, options, 'one form')] });
// The catalog example draws at the height its fixture pins. `auto` leaves the
// height to the chart where that draws every value and is close to the pinned height at most widths;
// `tall(h)` sets the height where the fixture's own pin is further off. The fixtures
// keep their pins: tests read them at those sizes. JSON drops the undefined height.
const auto = { size: { width: 720, height: undefined } };
// The mekko.stacked example has no value axis title; JSON drops the undefined title.
const noValueAxisTitle = { axisTitles: { primary: undefined } };
const tall = height => ({ size: { width: 720, height } });
// These fields describe host behaviour or non-visual metadata. Size/theme/locale
// have dedicated controls; a11y changes hidden metadata, not chart craft.
export const excluded = {
  interactive: 'Used only by the data-share measurement.', debug: 'Diagnostics only.',
  animate: 'Host motion only.', embed: 'Host embedding only.', story: 'Host navigation only.',
  a11y: 'Hidden accessibility metadata and HTML table presentation.',
  size: 'Width has dedicated controls; unit conversion is not a visual choice.',
  theme: 'Theme has dedicated controls.', locale: 'Locale has dedicated controls.',
  title: 'Authored text is outside the chart-craft review.',
  subtitle: 'Authored text is outside the chart-craft review.',
  source: 'Authored text is outside the chart-craft review.',
  footnotes: 'Authored text is outside the chart-craft review.',
};
export const variants = {
  waterfall: { axis: ['variant'], variants: [v('vertical', 'ebit-bridge'), v('horizontal', 'segment-cascade-horizontal')] },
  butterfly: one('customer-spend'),
  funnel: { idFields: {highlight:'categories'}, axis: ['variant'], variants: [v('rows', 'lead-funnel'), v('centered', 'lead-funnel-centered', auto)] },
  bar: { axis: ['variant'], variants: [v('grouped', 'grouped-cloud-cagr'), v('stacked', 'stacked-net-line-horizontal'), v('stacked100', 'ai-products-by-region'), v('football-field', 'valuation-football-field'), v('tornado', 'dcf-npv-sensitivity')] },
  box: one('deal-size-by-region'),
  column: { axis: ['variant'], variants: [v('grouped', 'grouped-average-marker'), v('stacked', 'stacked-revenue-cagr'), v('stacked100', 'stacked100-energy-mix')] },
  variance: { idFields: {highlight:'categories'}, axis: ['variant'], variants: [v('absolute', 'dpy-absolute-regions'), v('relative', 'dpl-relative-pins'), v('integrated', 'integrated-fc-caps')] },
  dot: { axis: ['variant'], variants: [v('dot', 'dot-range-benchmark'), v('dumbbell', 'share-shift-dumbbell'), v('lollipop', 'audit-findings-lollipop')] },
  bullet: one('exec-kpi-panel'),
  slope: { axis: ['variant'], variants: [v('lines', 'market-share-shift'), v('diverging', 'diverging-regions')] },
  line: { axis: ['variant'], variants: [v('line', 'multiline-arr-endpoint-cagr'), v('area', 'area-services-forecast'), v('stacked-area', 'stacked-area-services-growth', auto), v('stacked100-area', 'stacked100-area-revenue-mix'), v('bump', 'brand-share-bump')] },
  // Remote creative images are not shipped. This fixture uses the library's placeholder.
  creative: one('creative-placeholder'),
  // Combo forms follow the series axes.
  combo: { variants: [v('overlay', 'combo-partial-week'), v('dual-axis', 'revenue-units-secondary')] },
  // Grid forms follow the engine's decision (gridFormOf), not an options enum; repeat data is one way to author grid.facets.
  grid: { variants: [v('panels', 'kpi-and-waffle'), v('tiers', 'stacked-plus-dpy-tiered', auto), v('facets', 'facet-regions'), v('metric-stack', 'metric-stack-volume')] },
  scatter: { variants: [v('points', 'price-quality-brands'), v('bubbles', 'portfolio-bubbles'), v('quadrants', 'growth-share-matrix'), v('matrix', 'portfolio-nine-box', tall(455))] },
  kpi: one('dual-compare'),
  heatmap: { axis: ['variant'], variants: [v('value', 'regional-monthly-performance'), v('harvey', 'harvey-quarter-steps'), v('bubble', 'survey-journey-bubbles')] },
  sparkline: one('orders-nine-months'),
  status: one('programme-rollout-rag'),
  mekko: { axis: ['variant'], dataSettings: ['ridge','widthSeriesId'], variants: [v('stacked100', 'stacked100-market-map', tall(470)), v('stacked', 'unit-cost-staircase', noValueAxisTitle), v('bar', 'bar-mekko-profit-pool')] },
  // Doughnut is numeric, but changes the form; it belongs in this map, not settings.
  pie: { idFields: {highlight:'categories'}, axis: ['doughnut'], variants: [v('pie', 'streaming-genre-share'), v('doughnut', 'doughnut-device-revenue')] },
  gantt: one('transformation-program'),
  table: { axis: ['variant'], variants: [v('steering', 'column-groups-no-heading'), v('benchmark', 'benchmark-competitors'), v('status', 'table-scorecard', {variant:'status'}), v('receipts', 'receipts-changelog'), v('hierarchy', 'table-level-ladder')] },
  choropleth: one('german-states-revenue'),
  tilemap: one('eu27-equal-tiles'),
  cohort: { axis: ['variant'], variants: [v('heatmap', 'saas-logo-retention'), v('pure', 'retention-pure-exhibit'), v('stepped', 'retention-stepped-column')] },
  pvm: one('fy-revenue-bridge', auto),
  histogram: one('order-value-distribution'),
  diagram: { axis: ['variant'], variants: [v('hierarchy', 'org-structure'), v('issue-tree', 'profit-issue-tree'), v('linear-process', 'transformation-process'), v('customer-journey', 'onboarding-journey'), v('circular-process', 'operating-cycle', auto), v('strategy-house', 'strategy-house', auto), v('roadmap', 'growth-roadmap', tall(384)), v('architecture', 'protected-request', auto)] },
  dimswitch: { axis: ['variant'], variants: [v('by-measure', 'by-measure'), v('by-member', 'by-member')] },
  likert: one('employee-engagement-5pt'),
  pareto: one('defect-causes'),
  pyramid: one('germany-age-structure', auto),
  bartable: { idFields: {highlight:'categories'}, axis: ['variant'], variants: [v('panels', 'impact-two-panels-named-share'), v('cascade', 'cascade-two-periods')] },
  waffle: { axis: ['variant'], variants: [v('cells', 'stacked-segments'), v('square', 'share-squares')] },
  sankey: one('channel-journeys', auto),
  // Unpinned: a treemap takes the plot its content wants at each width; one pin fits no two widths.
  treemap: { axis: ['variant'], variants: [v('rect', 'growth-rect', auto), v('circle', 'growth-circle', auto)] },
};
