/**
 * The chart catalogue `boardplot_list` returns: every type once, the options all
 * types share once, the theme presets, the chart forms Boardplot does not draw,
 * the output forms and the limits. Informs; never tells the caller what to
 * choose. Built for CLI and MCP only; browser chart cores never import it.
 */
import * as z from 'zod';
import { getChartDefinition, listCharts, unsupported } from './registry';
import { baseOptionsSchema } from './schema/shared';
import { WORDING_KEYS } from './schema/unknownKeyWords';
import { schemaReference, type SchemaFieldReference } from './schema/reference';
import { themes } from './theme';
import { PNG_PIXELS_MAX } from './pngPhysicalSize';
import { API_VERSION } from '../version';
import { gridFormOf } from './charts/grid/layout';
import { comboDrawsSecondaryAxis } from './charts/combo/domain';

/**
 * One line per type for the catalogue, and three typical uses in the words a
 * request would use: list and compact describe show the first two, full
 * describe and the reference all three. The registry summary stays the long
 * form that full describe returns.
 */
const CATALOG: Record<string, { summary: string; useCases: readonly string[] }> = {
  bar: { summary: 'Horizontal bars per item', useCases: ['Ranking items', 'Tornado or football-field ranges', 'Values with long category names'] },
  bartable: { summary: 'Table rows with stacked bars, one panel per measure', useCases: ['One measure per row as a stacked bar beside number columns: one panel', 'The same split in two units side by side, $bn and % of EBITDA: two panels', 'Impact ranges by sector with a Total row', 'Share of a total over 2 to 4 periods, such as category revenue share by year: cascade'] },
  box: { summary: 'Box plots of raw observations; rows category,value[,categoryLabel,date]', useCases: ['Spread per group', 'Outliers by team or region', 'Response times by service'] },
  bullet: { summary: 'KPI rows with bands and target', useCases: ['KPIs against target', 'Plan attainment per unit', 'Scorecard of several metrics'] },
  butterfly: { summary: 'Two mirrored bar panes', useCases: ['Two measures per category', 'Before and after by segment', 'Imports and exports by country'] },
  choropleth: { summary: 'Region map coloured by value', useCases: ['A value per country or state', 'Regional penetration', 'Growth rate by region'] },
  cohort: { summary: 'Retention by cohort and period', useCases: ['Retention by signup cohort', 'Repeat purchase by first month', 'Subscription churn by start month'] },
  column: { summary: 'Vertical bars, grouped or stacked', useCases: ['Revenue by year or quarter', 'Segment mix over time', 'Monthly actuals against plan', 'Rank change of a few players between periods (ribbons)'] },
  combo: { summary: 'Columns with line or area overlays', useCases: ['Volume with a rate line', 'Revenue and margin on two axes', 'Orders with average order value'] },
  creative: { summary: 'Ad-creative review card (early alpha)', useCases: ['Ad-creative review (early alpha)', 'Creative metrics against account medians', 'Daily trend per creative'] },
  diagram: { summary: 'Node and edge diagrams, including system architecture', useCases: ['Process or organisation flow', 'Driver tree or value chain', 'Organisation chart', 'System architecture and data flow', 'Trust boundaries and protected zones'] },
  dot: { summary: 'Dots, dumbbells or lollipops', useCases: ['Gap between two values', 'Many items on one scale', 'Before and after per item'] },
  funnel: { summary: 'Stage funnel with conversion rates', useCases: ['Sales funnel conversion', 'Drop-off between steps', 'Recruiting pipeline'] },
  gantt: { summary: 'Timeline with spans and events', useCases: ['Project plan with milestones', 'Rollout by workstream', 'Campaign calendar'] },
  grid: { summary: 'Facets and metric stacks on one category axis', useCases: ['Small multiples per region', 'Actuals with a variance tier', 'Metric stacks with computed readouts'] },
  heatmap: { summary: 'Row by column matrix', useCases: ['A value by row and column', 'Harvey-ball scoring', 'Sales by weekday and hour'] },
  histogram: { summary: 'Equal-width bins of raw values; rows value', useCases: ['Order value distribution', 'Spread of lead times', 'Deal size distribution'] },
  kpi: { summary: 'Single-metric card', useCases: ['Headline metric with trend', 'Metric against PY and plan', 'Dashboard tile'] },
  likert: { summary: 'Diverging bars for survey scales', useCases: ['Agreement by statement', 'Net sentiment per question', 'Employee survey results'] },
  line: { summary: 'Lines and areas over time', useCases: ['Trend over time', 'Actual against forecast', 'Indexed growth of several series'] },
  mekko: { summary: 'Variable-width stacked columns', useCases: ['Market size and share', 'Profit pool by segment', 'Share of wallet by customer size'] },
  pareto: { summary: 'Sorted columns with cumulative curve', useCases: ['Few causes, most volume', 'Customer concentration', 'Defect causes by count'] },
  pie: { summary: 'Pie or doughnut of shares', useCases: ['Share of a whole, few parts', 'Doughnut with a centre total', 'Revenue mix by channel'] },
  pvm: { summary: 'Price, volume and mix bridge', useCases: ['Revenue change by price, volume, mix', 'New and lost business', 'Price effect per product'] },
  pyramid: { summary: 'Mirrored bands on one scale', useCases: ['Population by age and sex', 'Mirrored distribution', 'Customer age by gender'] },
  sankey: { summary: 'Flows from sources to targets in stages; rows source,target,value', useCases: ['Channel to landing page to purchase', 'Budget to departments', 'Customers moving between segments month to month'] },
  scatter: { summary: 'XY/bubble; rows x,y[,size,label,group]', useCases: ['Related measures', 'Portfolio', 'Price against volume per product'] },
  slope: { summary: 'Two-point slope lines', useCases: ['Change between two dates', 'Rank shift', 'Market share start to end', 'Survey shares by group, two waves'] },
  sparkline: { summary: 'One series as a mini line', useCases: ['Trend inside a KPI card', 'Shape beside a table row', 'A strip of metrics on one board'] },
  status: { summary: 'Entity by period state matrix', useCases: ['Project status by period', 'RAG matrix', 'Milestone tracking'] },
  dimswitch: { summary: 'KPIs by one dimension and period, from sums', useCases: ['Weekly KPIs by channel', 'Channels by KPI with changes', 'Changes judged against the period before'] },
  table: { summary: 'Management table with totals; rows [label,id]', useCases: ['Table with totals', 'P&L with variances', 'Ranked list with status chips'] },
  tilemap: { summary: 'Equal-size region tiles', useCases: ['A value per state', 'Regions without area bias', 'Results by US state'] },
  treemap: { summary: 'Part of a whole as nested areas', useCases: ['Many parts of one total, in groups', 'A few items take most of the total'] },
  variance: { summary: 'Variance tier against PY, PL or FC', useCases: ['Actual against plan or PY', 'Variance in value and percent', 'Budget deviation by cost centre'] },
  waffle: { summary: 'Share of a whole as a grid of cells', useCases: ['One share of 100%, such as 30% of customers', 'Several shares side by side with one baseline', 'Stacked segments of one whole'] },
  waterfall: { summary: 'Bridge; rows label,value[,type]', useCases: ['EBIT or cash', 'Change contributions', 'Budget to actual walk'] },
};

/**
 * A rule of a design card. `engine` rules are computed from the spec and the
 * drawn layout: render returns them as `advice` warnings whose code is the
 * rule id and whose message is the rule text. `describe` rules need the
 * author's judgment; only describe and the reference carry them.
 */
export interface DesignRule {
  id: `design-${string}`;
  check: 'engine' | 'describe';
  text: string;
}

/** What a chart type says, when to use it, and the rules that keep it consulting grade. */
export interface DesignCard {
  message: string;
  use: string;
  notWhen: string;
  rules: readonly DesignRule[];
}

/**
 * Design cards, one per type, most important rule first. The compact describe
 * prints the first two rules; `describe <type> --path design` prints the card.
 */
const DESIGN_CARDS: Readonly<Record<string, DesignCard>> = {
  bar: {
    message: 'How items rank or compare on one measure.',
    use: 'Categories without a natural order, or names too long to fit under a column.',
    notWhen: 'The categories are periods (column or line); a few parts of one whole (pie or waffle); two measures per item (dot or butterfly).',
    rules: [
      { id: 'design-bar-sort', check: 'engine', text: 'Sort unordered bars by value, largest first, so the ranking reads from the top.' },
      { id: 'design-bar-one-colour', check: 'describe', text: 'Give one measure one colour and mark only the item the title names with options.highlight; a colour per bar is a code the reader must learn.' },
      { id: 'design-bar-many', check: 'engine', text: 'Show at most 15 bars; fold the tail into one Others bar so the items that matter stay readable.' },
      { id: 'design-bar-zero', check: 'describe', text: 'Start the value axis at zero: a bar\'s length is its value, so a cut axis overstates the differences.' },
      { id: 'design-bar-stack-limit', check: 'describe', text: 'Keep a stacked bar to about five segments: only the first segment and the total share a baseline, so the middle segments are hard to compare.' },
      { id: 'design-bar-title', check: 'describe', text: 'Write the finding in the title, such as "North sells 30% more than South", not the name of the measure.' },
    ],
  },
  line: {
    message: 'How a measure moves over time: trend, turning points, and where series part.',
    use: 'Ordered periods on the x axis, from about five points up; several series compared on their shape.',
    notWhen: 'The categories have no order (bar); two points only (slope); few periods where each value matters more than the shape (column); parts of one total over time (column stacked).',
    rules: [
      { id: 'design-line-direct-labels', check: 'engine', text: 'Name the lines at their ends, not in a legend, so the eye does not travel between key and line.' },
      { id: 'design-line-series-limit', check: 'describe', text: 'Draw at most five lines; grey the others with options.highlight, or split them into small multiples with grid.' },
      { id: 'design-line-label-points', check: 'engine', text: 'Print the last value, or the first and the last, not every point: a line shows the shape, and a table shows exact values.' },
      { id: 'design-line-forecast', check: 'describe', text: 'Mark forecast and plan periods with series[].scenario FC or PL, so the reader sees where the actuals end.' },
      { id: 'design-line-gaps', check: 'describe', text: 'Keep periods in time order at equal spacing, and give a missing period null, so the gap shows instead of a line across it.' },
      { id: 'design-line-straight', check: 'describe', text: 'Draw straight segments for measured data: a smoothed curve shows values between periods that nobody measured. Keep smoothing for concept curves.' },
      { id: 'design-line-zero', check: 'describe', text: 'A line may start above zero; an area must start at zero, because its filled height reads as the value.' },
    ],
  },
  waterfall: {
    message: 'What moved a number from A to B: the steps between an opening and a closing total.',
    use: 'An opening and a closing value exist and the steps add up to the change, such as an EBIT bridge, a cash walk or budget to actual.',
    notWhen: 'The steps are shares of different wholes (column stacked100); two values only (column with a diff annotation); the steps have no business order (bar sorted by value).',
    rules: [
      { id: 'design-waterfall-closing-total', check: 'engine', text: 'End the bridge on a total, so the reader does not have to add up the steps.' },
      { id: 'design-waterfall-order', check: 'describe', text: 'Keep the steps in their business order, such as the P&L order; sort by size only when the message is a ranking.' },
      { id: 'design-waterfall-horizontal', check: 'engine', text: 'Turn the bridge horizontal when the step names do not fit upright under the columns: rotated, cut or skipped names are hard to read.' },
      { id: 'design-waterfall-cost-direction', check: 'describe', text: 'In a cost bridge, set items[].direction to lowerIsBetter, so a rising cost paints bad.' },
      { id: 'design-waterfall-few-steps', check: 'describe', text: 'Show about eight steps or fewer; fold the small ones into one Other step at a place that keeps the business order.' },
      { id: 'design-waterfall-subtotals', check: 'describe', text: 'Add a subtotal where the business reads one, such as gross profit before overheads, so a long bridge reads in parts.' },
    ],
  },
  diagram: {
    message: 'How parts connect: a structure, a process, or a system and its data flows.',
    use: 'The links between the parts are the message, such as an organisation, a driver tree, a process or a system architecture with `variant: architecture`.',
    notWhen: 'The message is a number or a change (a chart); the items only rank (bar or table); dated work over time (gantt or the roadmap variant).',
    rules: [
      { id: 'design-diagram-variant', check: 'describe', text: 'Pick the variant that matches the links: architecture for systems, data flow and trust boundaries; linear-process for steps; hierarchy for reporting lines.' },
      { id: 'design-diagram-title', check: 'describe', text: 'Write the finding in the title, such as "Only the protected runtime reads the keys", not the name of the system.' },
      { id: 'design-diagram-one-focus', check: 'describe', text: 'Mark one node or path with options.highlight, so the reader sees the message first and the structure second.' },
      { id: 'design-diagram-size', check: 'describe', text: 'Keep an exhibit to about 20 nodes; split a larger system into one overview and detail exhibits.' },
      { id: 'design-diagram-return', check: 'describe', text: 'Set flow: return on a feedback edge, so it stays out of the node order and on the outer corridors.' },
      { id: 'design-diagram-protected', check: 'describe', text: 'Set protected only where the claim is true: the lock states that the zone is protected, and the engine cannot check it.' },
    ],
  },
};

/** The types that have a design card. */
export function designCardTypes(): string[] {
  return Object.keys(DESIGN_CARDS);
}

/** A type's design card, or undefined when it has none yet. */
export function designCardFor(type: string): DesignCard | undefined {
  return DESIGN_CARDS[type];
}

/** One engine rule's text by its id: the message of the advice that rule returns. */
export function designRuleText(id: DesignRule['id']): string {
  for (const card of Object.values(DESIGN_CARDS)) {
    const rule = card.rules.find((candidate) => candidate.id === id && candidate.check === 'engine');
    if (rule) return rule.text;
  }
  throw new Error(`no engine design rule '${id}'`);
}

/** The compact card describe prints: the first lines, two rules, and where the rest is. */
export function compactDesignCard(type: string) {
  const card = DESIGN_CARDS[type];
  if (!card) return undefined;
  return {
    message: card.message,
    use: card.use,
    notWhen: card.notWhen,
    rules: card.rules.slice(0, 2).map((rule) => `${rule.text} (${rule.check === 'engine' ? `engine: ${rule.id}` : 'judgment'})`),
    more: `path design returns all ${card.rules.length} rules`,
  };
}

/** The one-line summary `list` shows; describe's compact form uses it too. */
export function shortSummaryFor(type: string, fallback: string): string {
  return CATALOG[type]?.summary ?? fallback;
}

export function useCasesFor(type: string, detail: 'compact' | 'full' = 'compact'): string[] {
  const all = CATALOG[type]?.useCases ?? [];
  return detail === 'full' ? [...all] : all.slice(0, 2);
}

/** The values of a type's top-level `variant` option, when it has one. */
function variantsFor(type: string): string[] {
  if (!getChartDefinition(type)) return [];
  const variant = optionFields(type).find((field) => field.path === 'variant');
  return variant?.values ? variant.values.map(String) : [];
}

/** Forms these types derive from their data and options; they take no `variant` option. */
const DERIVED_FORMS: Readonly<Record<string, readonly string[]>> = {
  pie: ['pie', 'doughnut'],
  scatter: ['points', 'bubbles', 'quadrants', 'matrix'],
  combo: ['overlay', 'dual-axis'],
  grid: ['panels', 'tiers', 'facets', 'metric-stack'],
};

/** The variant these types draw when `variant` is omitted; their schema registers no default. */
const IMPLIED_VARIANT: Readonly<Record<string, string>> = { funnel: 'rows', slope: 'lines', bartable: 'panels', waterfall: 'vertical' };

type Loose = Record<string, any> | undefined;

function derivedForm(type: string, data: Loose, options: Loose): string | undefined {
  if (type === 'pie') return Number(options?.doughnut ?? 0) > 0 ? 'doughnut' : 'pie';
  if (type === 'scatter') {
    if (options?.zones) return 'matrix';
    if (options?.quadrants) return 'quadrants';
    return (data?.points ?? []).some((point: Loose) => point?.size != null) ? 'bubbles' : 'points';
  }
  if (type === 'combo') return comboDrawsSecondaryAxis(data as never, (options ?? {}) as never) ? 'dual-axis' : 'overlay';
  if (type === 'grid') return gridFormOf(data as never, (options ?? {}) as never);
  return undefined;
}

/** The public chart IDs of a type (`type.variant`), or none for a one-form type, whose ID is the type. */
export function chartIds(type: string): string[] {
  return (DERIVED_FORMS[type] ?? variantsFor(type)).map((form) => `${type}.${form}`);
}

function variantDefault(type: string): string | undefined {
  if (!getChartDefinition(type)) return undefined;
  const value = optionFields(type).find((field) => field.path === 'variant')?.default;
  return value === undefined ? undefined : String(value);
}

/** The public chart ID one spec draws: `type.variant`, or `type` for a one-form type. */
export function chartIdOf(type: string, data: unknown, options?: unknown): string {
  const opts = options as Loose;
  const form = derivedForm(type, data as Loose, opts) ?? opts?.variant ?? variantDefault(type) ?? IMPLIED_VARIANT[type];
  return form === undefined ? type : `${type}.${form}`;
}

const optionFieldCache = new Map<string, SchemaFieldReference[]>();

/** Every declared option field of a type, with registered defaults. */
export function optionFields(type: string): SchemaFieldReference[] {
  const cached = optionFieldCache.get(type);
  if (cached) return cached;
  const definition = getChartDefinition(type);
  if (!definition) throw new Error(`unknown chart type '${type}'`);
  const fields = schemaReference(z.toJSONSchema(definition.optionsSchema, { io: 'input' }) as Record<string, unknown>, definition.defaults);
  optionFieldCache.set(type, fields);
  return fields;
}

let sharedCache: SchemaFieldReference[] | undefined;

/** The option fields every type inherits from the shared base schema. */
export function sharedOptionFields(): SchemaFieldReference[] {
  sharedCache ??= schemaReference(z.toJSONSchema(baseOptionsSchema, { io: 'input' }) as Record<string, unknown>);
  return sharedCache;
}

/**
 * The built-in presets, fixed when this module loads. Discovery lists these
 * and never a theme registered or adopted later, so its output does not
 * depend on what earlier requests did.
 */
export const PRESET_THEME_NAMES: readonly string[] = Object.freeze(Object.keys(themes));

const CLAUSE_MAX = 80;

/**
 * The first sentence of a schema description, one clause per field. A
 * sentence longer than CLAUSE_MAX characters ends at its last comma before
 * that length, so a row stays one line. A clause that leaves text out ends
 * in … instead of a full stop: an exception written later in the
 * description is one `describe --path` away.
 */
export function firstClause(text: string): string {
  const trimmed = text.trim();
  let depth = 0;
  let end = trimmed.length;
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index]!;
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === '.' || char === ';') && (index + 1 === trimmed.length || trimmed[index + 1] === ' ')
      && !/\b(?:e\.g|i\.e|etc|vs)$/.test(trimmed.slice(0, index))) {
      end = index;
      break;
    }
  }
  let clause = trimmed.slice(0, end);
  if (clause.length > CLAUSE_MAX) {
    // Cut only at a comma outside parentheses: "(a4 1052x744, …)" stays whole.
    const commas: number[] = [];
    let level = 0;
    for (let index = 0; index < clause.length; index++) {
      const char = clause[index]!;
      if (char === '(') level++;
      else if (char === ')') level = Math.max(0, level - 1);
      else if (level === 0 && char === ',' && clause[index + 1] === ' ') commas.push(index);
    }
    let comma = Math.max(-1, ...commas.filter(index => index <= CLAUSE_MAX));
    if (comma <= 30) comma = commas.find(index => index >= CLAUSE_MAX) ?? -1;
    if (comma > 30 && comma <= CLAUSE_MAX * 1.5) clause = clause.slice(0, comma);
  }
  return clause === trimmed.replace(/\.$/, '') ? `${clause}.` : `${clause}…`;
}

function valueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * One field as one line: type, whether it is required, the allowed values
 * (`accepts` when they are one branch of a wider type) that the type does not
 * already name, the default (not one only the schema annotates), then one clause. Keyed by path in the response, a row costs
 * about two thirds of the bytes an object with the same facts costs.
 */
export function fieldLine(
  field: Pick<SchemaFieldReference, 'type' | 'values' | 'valuesExhaustive' | 'default' | 'defaultInSchema'>,
  meaning: string,
  options: { required?: boolean; type?: string } = {},
): string {
  const type = options.type ?? field.type;
  const parts = [type];
  if (options.required) parts.push('required');
  if (field.values) {
    // A value the type already names as a member ("string | false") is not
    // repeated: `accepts` drops it, and `one of` goes when every value is one.
    const members = new Set(type.split(' | '));
    const named = (value: unknown) => members.has(valueText(value));
    const values = field.valuesExhaustive === false
      ? field.values.filter((value) => !named(value))
      : field.values.every(named) ? [] : field.values;
    if (values.length) parts.push(`${field.valuesExhaustive === false ? 'accepts' : 'one of'} ${values.map(valueText).join(' | ')}`);
  }
  // An object default is spelled out by its child rows; repeating it here doubles the row.
  const scalarDefault = field.default === null || typeof field.default !== 'object' || Array.isArray(field.default);
  if (Object.hasOwn(field, 'default') && field.default !== undefined && scalarDefault && !field.defaultInSchema) parts.push(`default ${valueText(field.default)}`);
  return `${parts.join(', ')}. ${meaning}`;
}

/** How an annotation names the data element it attaches to. */
const ANCHOR_FORM = 'An annotation anchor is a category or item id string, or an object with categoryId plus optional seriesId, segmentId and edge (start, end, total); pointId addresses a scatter point. Category anchors, including from/to, take category ids, not category labels.';

/**
 * The value cell most series-based types share, described once here. Describe
 * folds every field that takes this cell into one row of type `cell`.
 */
const CELL_CONTRACT = 'A number, null (missing), or an object with one of number, pct (50.5 means 50.5%) or date (ISO 8601), plus optional fill, format, label (text or false), priority, scenario (AC|PY|PL|FC), footnote and, on range types, range {low, high, mid}.';

/** Top-level shared options by path, with their nested keys named in the type. */
function sharedOptionsSummary(): Record<string, string> {
  const fields = sharedOptionFields();
  const rows: Record<string, string> = {};
  for (const field of fields) {
    if (field.path.includes('.') || field.path.includes('[') || field.type === 'never' || /^Reserved\b/.test(field.description)) continue;
    const keys = [...new Set(fields
      .filter((child) => child.path.startsWith(`${field.path}.`) && !child.path.slice(field.path.length + 1).includes('.'))
      .map((child) => child.path.slice(field.path.length + 1)))];
    // `strings` keys name built-in texts, one per message: the catalogue counts them, describe lists them.
    const type = WORDING_KEYS.has(field.path) ? `${field.type} {${keys.length} label keys}` : keys.length ? `${field.type} {${keys.join(', ')}}` : field.type;
    rows[field.path] = fieldLine(field, firstClause(field.description), { type });
  }
  return rows;
}

/** Option paths an unsupported form's recipe needs before it renders. */
const UNSUPPORTED_REQUIRES: Record<string, readonly string[]> = {
  tornado: ['options.baseValue', 'options.tornado.low', 'options.tornado.high'],
};

/**
 * The order people read the types in: the five that carry most business
 * reporting first (column and bar, line, dimswitch, table, waterfall), then
 * the monthly management staples (KPI cards, combo, variance, bullet, bartable,
 * PVM), the other tables and matrices, then analysis charts by how often a report
 * needs them, and the early or redrawn types last. A type missing here
 * follows, in name order. Machine lists (enums, error values) stay in name order.
 */
export const TYPE_ORDER: readonly string[] = [
  'column', 'bar', 'line', 'dimswitch', 'table', 'waterfall',
  'kpi', 'combo', 'variance', 'bullet', 'bartable', 'pvm', 'pie', 'status', 'heatmap', 'gantt',
  'scatter', 'funnel', 'pareto', 'mekko', 'sparkline', 'treemap', 'sankey', 'grid', 'slope', 'dot', 'cohort',
  'choropleth', 'butterfly', 'likert', 'histogram', 'box', 'waffle', 'pyramid', 'diagram', 'tilemap', 'creative',
];

/** Sorts type names by TYPE_ORDER. */
export function byTypeOrder(left: string, right: string): number {
  const rank = (type: string) => { const at = TYPE_ORDER.indexOf(type); return at === -1 ? TYPE_ORDER.length : at; };
  return rank(left) - rank(right) || (left < right ? -1 : left > right ? 1 : 0);
}

export function buildCatalog() {
  const charts = listCharts().slice().sort((left, right) => byTypeOrder(left.type, right.type));
  const types = charts.map((chart) => {
    const ids = chartIds(chart.type);
    return {
      type: chart.type,
      summary: shortSummaryFor(chart.type, chart.summary),
      useCases: useCasesFor(chart.type),
      ...(ids.length ? { ids } : {}),
      ...(chart.aliases.length ? { aliases: chart.aliases } : {}),
      minWidth: chart.sizing.minWidth,
      minHeight: chart.sizing.minHeight,
      fit: chart.sizing.fit,
    };
  });
  return {
    engine: API_VERSION,
    types,
    sharedOptions: sharedOptionsSummary(),
    cell: CELL_CONTRACT,
    anchor: ANCHOR_FORM,
    themes: { presets: [...PRESET_THEME_NAMES], contract: 'boardplot_describe with type theme' },
    unsupported: unsupported.map((entry) => ({
      name: entry.name,
      use: entry.use === null ? null : {
        ...entry.use,
        ...(UNSUPPORTED_REQUIRES[entry.name] ? { requires: [...UNSUPPORTED_REQUIRES[entry.name]!] } : {}),
      },
    })),
    forms: { drawn: ['svg', 'png'], notDrawn: ['html report', 'slide deck', 'pdf', 'scrolling dashboard'] },
    limits: { requestBytes: 10 * 1024 * 1024, errorsPerResponse: 10, fixturesPerPage: 25, pngScaleMax: 8, pngPixelsMax: PNG_PIXELS_MAX },
  };
}
