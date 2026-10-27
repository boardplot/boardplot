/**
 * The gallery: docs/gallery.md with one or two drawn fixtures per chart type,
 * their SVGs under docs/gallery/, and the README hero chart in a light and a dark version.
 * generate-reference.mjs writes these files, so `npm run docs:build --check`
 * fails when a drawing changes and the gallery was not drawn again.
 */
import { registerAllGeoPacks } from '../src/core/geo/packs/index.ts';
import { fixtures } from '../src/cli/fixtures.ts';
import { render } from '../src/cli/render.ts';

registerAllGeoPacks();

/**
 * One or two example fixtures per type, docs/gallery/<type>-<id>.svg. The
 * types most reports use come first (TYPE_ORDER in src/core/catalog.ts), then
 * the other groups as a reader looks for a chart, each in that same order.
 */
export const GALLERY_GROUPS = [
  ['Most common', [['column', 'weekly-events-lane'], ['column', 'category-break-years'], ['bar', 'margin-by-brand'],
    ['line', 'multiline-arr-endpoint-cagr'], ['dimswitch', 'statement-channels'], ['table', 'management-report-compact'],
    ['table', 'management-report'], ['waterfall', 'build-down']]],
  ['Variance, bridges and KPIs', [['kpi', 'dual-compare'], ['variance', 'dpy-absolute-regions'], ['bullet', 'exec-kpi-panel'],
    ['pvm', 'fy-revenue-bridge']]],
  ['Trends', [['combo', 'revenue-units-secondary'], ['pareto', 'defect-causes'], ['sparkline', 'orders-nine-months'],
    ['slope', 'diverging-regions']]],
  ['Tables and scorecards', [['bartable', 'impact-two-panels-named-share'], ['status', 'programme-rollout-rag'],
    ['heatmap', 'capability-matrix'], ['cohort', 'saas-logo-retention']]],
  ['Composition', [['pie', 'doughnut-device-revenue'], ['funnel', 'lead-funnel'], ['mekko', 'stacked100-market-map'],
    ['treemap', 'source-order-shares-circle'], ['waffle', 'stacked-segments'], ['sankey', 'channel-journeys']]],
  ['Plans and structure', [['gantt', 'product-launch'], ['grid', 'metric-stack-volume'], ['diagram', 'profit-issue-tree']]],
  ['Distribution and ranking', [['scatter', 'price-volume-trend'], ['dot', 'share-shift-arrow'], ['butterfly', 'license-vs-services'],
    ['histogram', 'order-value-distribution'], ['box', 'deal-size-by-region'], ['pyramid', 'germany-age-structure']]],
  ['Surveys and maps', [['choropleth', 'eu-inflation-values'], ['likert', 'employee-engagement-5pt'], ['tilemap', 'europe-tile-grid']]],
];

/** The README examples under the column hero, in TYPE_ORDER after column; each also gets a dark version for GitHub's dark mode. */
export const README_EXAMPLES = [['bar', 'margin-by-brand'], ['line', 'multiline-arr-endpoint-cagr'],
  ['dimswitch', 'statement-channels'], ['table', 'management-report-compact'], ['waterfall', 'build-down']];

/** The README hero: one chart of the most common type at about the width GitHub shows a README, drawn light and dark. */
export const HERO = ['column', 'integrated-stacked-variance'];
const HERO_WIDTH = 840;
const DARK_THEME = 'standard-dark';

/**
 * The fixture, drawn with the preset font family: a reader's browser draws these
 * SVGs with its own fonts, and a family such as the sheet look's Source Sans 3
 * is missing on most machines, so its measured text would not fit.
 */
function fixture(type, id) {
  const result = fixtures({ type, id, kind: 'all' });
  const found = result.exit === 0 ? result.body.fixtures?.[0] : undefined;
  if (!found) throw new Error(`gallery fixture ${type}/${id} does not exist`);
  if (!found.spec.options?.theme?.overrides?.type?.family) return found;
  const spec = structuredClone(found.spec);
  delete spec.options.theme.overrides.type.family;
  return { ...found, spec };
}

/** The SVG as `boardplot render` writes it, without the engine stamp, so it changes only when the drawing does. */
function drawn(spec, width) {
  const result = render({ spec, format: 'svg', return: ['svg'], ...(width && { width }) });
  if (result.exit !== 0 || typeof result.body.svg !== 'string') throw new Error(`gallery render failed: ${JSON.stringify(result.body.errors)}`);
  return result.body.svg.replace(/ data-bp-engine="[^"]*"/, '');
}

const title = (found) => found.spec.options?.title ?? found.useCase;

const file = (type, id, dark = false) => `gallery/${type}-${id}${dark ? '-dark' : ''}.svg`;
/** The spec in the dark preset; a pinned theme keeps its overrides, except colours tuned for a light preset. */
function darkened(spec) {
  const pin = spec.options?.theme;
  if (typeof pin !== 'object' || !pin.preset) return { ...spec, options: { ...spec.options, theme: DARK_THEME } };
  // Light hex colours in the pin (inks, table grounds and bar fills) would sit on the dark ground: the dark preset supplies its own.
  const table = pin.overrides?.table && { ...pin.overrides.table, grounds: undefined, bar: undefined, inks: undefined };
  const theme = { ...pin, preset: DARK_THEME, overrides: { ...pin.overrides, color: undefined, table } };
  return { ...spec, options: { ...spec.options, theme } };
}

function galleryPage(list, counts, plainSummary, specJson, slug) {
  const summary = new Map(list.types.map((entry) => [entry.type, plainSummary(entry)]));
  const sections = GALLERY_GROUPS.flatMap(([group, picks]) => [
    `## ${group}`, '',
    ...picks.flatMap(([type, id], at) => {
      const found = fixture(type, id);
      // A second pick of a type sits under the first one's heading.
      const first = at === 0 || picks[at - 1][0] !== type;
      return [
        ...(first ? [`### ${type}`, '', `${summary.get(type)}. [Reference](reference/${type}.md)`, ''] : []),
        `![${type} chart: ${title(found)}](${file(type, id)})`, '',
        `<details><summary>Spec: fixture <code>${id}</code></summary>`, '', '```json', specJson(found.spec), '```', '', '</details>', '',
      ];
    }),
  ]);
  const contents = GALLERY_GROUPS.map(([group, picks]) => `- [${group}](#${slug(group)}): ${[...new Set(picks.map(([type]) => type))].map((type) => `[${type}](#${slug(type)})`).join(', ')}`);
  return ['# Gallery', '',
    `Boardplot has ${counts}. This page shows one or two charts of each type except \`creative\` (early alpha), drawn by \`boardplot render\` from the spec under it with the default theme. Companies, products, sources and numbers are invented. Every spec is a fixture that ships with the package: \`boardplot fixtures --type <type> --id <id>\` returns it, and [fixtures.md](reference/fixtures.md) lists all of them.`, '',
    ...contents, '', ...sections].join('\n');
}

/** Every gallery file, keyed by its path from the repository root. `counts` reads "36 chart types, ...". */
export function galleryFiles({ list, counts, summary, specJson, slug }) {
  const files = new Map([['docs/gallery.md', galleryPage(list, counts, summary, specJson, slug)]]);
  for (const [, picks] of GALLERY_GROUPS) {
    for (const [type, id] of picks) files.set(`docs/${file(type, id)}`, `${drawn(fixture(type, id).spec)}\n`);
  }
  // The hero is drawn at HERO_WIDTH, so a size preset pinned for a slide (its height for another width) gives way to the height the engine picks.
  const hero = structuredClone(fixture(...HERO).spec);
  delete hero.options.size;
  files.set('docs/gallery/hero-light.svg', `${drawn(hero, HERO_WIDTH)}\n`);
  files.set('docs/gallery/hero-dark.svg', `${drawn(darkened(hero), HERO_WIDTH)}\n`);
  for (const [type, id] of README_EXAMPLES) files.set(`docs/${file(type, id, true)}`, `${drawn(darkened(fixture(type, id).spec))}\n`);
  return files;
}
