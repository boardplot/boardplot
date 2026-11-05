/**
 * Why each key in the capability tables is refused where it is (capability.ts).
 * Schema side only: shared.ts and the chart schemas link it, so the CLI, the
 * MCP and BoardplotChart answer with the full reason, and no per-type React
 * entry carries these strings.
 */
import { valueAxisRefusal, type OPTION_CAPABILITY, type VALUE_AXIS_CAPABILITY, type VALUE_AXIS_ONLY } from './capability';

export const OPTION_REASONS: Readonly<Record<keyof typeof OPTION_CAPABILITY, string>> = {
  animate:
    "no chart type implements 'animate' — this library emits static, deterministic SVG; use 'interactive: true' for data-bp-* hover/focus semantics, or animate the emitted SVG downstream",
  debug:
    "no chart type implements 'debug'; drop the key. The CLI refuses '--debug' as not supported in v1",
  rowLabels:
    "only the horizontal row-label families read rowLabels (bar, bullet, box, dot, likert). A vertical category axis prints its labels under the bands, where they already share one baseline and there is nothing to align",
  categoryAxis:
    "only 'line', 'column' and 'combo' accept categoryAxis; dateTicks picks a calendar interval for the tick labels of a dated row, and crossesBetween selects bands or points on a line. Other banded category types print their own category rows",
  categoryLabels:
    "staircase category names sit in the free space over columns sorted by height, and only the vertical column family reads categoryLabels (column, combo, pareto). A horizontal bar prints each name beside its row already; a waterfall or variance keeps its bridge order and its delta labels in that space; histogram bins and mekko widths have no free triangle over sorted columns",
  secondaryAxis:
    "only 'combo' and 'box' have a second value scale to acknowledge; a single-scale chart has no second axis, so declaring one acknowledges nothing",
  labels:
    "this type never consults the per-kind label toggle map. On waterfall use labelDensity ('minimal' keeps totals and endpoints, dropping delta and segment values); pvm takes labels.point: false; on grid author labels on each panel's own options; table and diagram have their own display models",
  hatchStrength:
    "this type draws no forecast, partial-period or no-data hatch, so there is nothing to strengthen or soften. Drop hatchStrength",
  sort:
    "sort reorders categories on bar, box, bullet, butterfly, column, dimswitch, dot, heatmap, likert, mekko, pie, table and variance, and cohort takes sort.segments. A time sequence, funnel stages, bridge steps and histogram bins keep their meaningful order. Maps keep geographic positions, and a Pareto ranks contributions itself. Send the data in the order to draw",
  topN:
    "topN keeps the n largest categories and folds the rest on bar, butterfly, column, mekko, pareto, pie and table. Dot and variance keep the n largest by size without a rest bucket, and a choropleth world map picks labelled regions. Time sequences, stages, bridge steps, matrix axes/cells, histogram bins and box groups keep their full structure because dropping entries would change its meaning. Filter the data before sending it",
  rounding:
    "rounding changes how computed shares of one whole print, on a bar, column or combo stack, a bartable cascade, a stacked100 area, a mekko and a pie. This type prints no share of a whole, or prints them through its own rules. Drop rounding",
  bandFraction:
    "bandFraction sets how much of a category band a bar, column, bridge step or dot row fills. This type sets its own: a line or slope runs through points, mekko column widths come from the data, a box row takes the height its labels need, and a pie, map, matrix or table has no band. Drop the key",
  highlight:
    "no mark here takes emphasis; a map colours every region by its value. Name the region in the title or an annotation, or rank the regions in a bar chart with highlight",
  detailFields:
    "cell details and their detailFields reach the hover card on bar, butterfly, column, combo, dot, funnel, heatmap, line, mekko, pie and slope. This type's cells carry no details. Drop detailFields, or name the extra facts in a category label or an annotation",
  story:
    "this type has no story layer. Drop story, or tell the story over a type that takes it, such as scatter, column or line",
};

const VALUE_AXIS_REASONS: Readonly<Record<keyof typeof VALUE_AXIS_CAPABILITY, string>> = {
  tickStep:
    'this type has no independent linear value-axis ticks; pareto keeps its count and cumulative-percent scales tied to the total. Drop tickStep',
  reverse:
    'only line and scatter reverse the value axis; bars, columns and bridge steps grow from their baseline, and a reversed axis would read gains as losses. Drop reverse',
  break:
    'only bar, box, column, histogram and waterfall draw a value-axis break; this type would accept it and draw an unbroken axis. Drop break, or draw the data as a column or bar chart',
  log:
    'only line and scatter draw a log scale; bars and columns would distort mark lengths. Drop log, or plot the data as a line or scatter',
};

export const VALUE_AXIS_ONLY_REASONS: Readonly<Record<keyof typeof VALUE_AXIS_ONLY, string>> = {
  sankey:
    'a sankey has no value axis; node heights and ribbon widths share one scale, and the node labels carry the numbers',
  waterfall:
    'a waterfall scales to its running levels and draws no value axis; only valueAxis.break applies',
  pvm:
    'a pvm bridge scales to its running levels and draws no value axis; only valueAxis.break applies',
  slope:
    'a slope draws no value axis; only valueAxis.min and max widen its domain',
  sparkline:
    "a sparkline has no axes and scales to the data's own range",
  dimswitch: 'An dimswitch has no value axis; it draws a table of derived values.',
  table:
    'a table has no value axis; in-cell bars scale per column',
  bartable:
    'a bar table has no value axis; each panel scales to its own largest row, or all to one under sharedScale, and the labels carry the numbers',
  diagram:
    'a diagram has no value axis',
  creative:
    'the creative card has no value axis; its trend panels scale to their own observations',
  pie:
    'a pie has no value scale; slice angles and the printed shares carry the values',
  funnel:
    'a funnel has no value axis; every stage prints its own value and conversion',
  heatmap:
    'a heatmap has no value axis; cell colour and the in-cell values carry the scale',
  kpi:
    'a KPI tile prints its figures and has no value axis',
  status:
    'a status board shows states and has no value scale',
  gantt:
    'a gantt runs on a time axis and has no value axis',
  tilemap:
    'a tile map has no value axis; tile colour and the colour key carry the scale',
  choropleth:
    'a map has no value axis; region colour and the colour key carry the scale',
  cohort:
    'a retention triangle has no value axis; colour and the in-cell percentages carry the scale',
  likert:
    'a likert labels every segment with its share and draws no axis, because an axis around the diverging centre would print negative percentages',
  butterfly:
    'a butterfly prints each value at its bar and draws no value axis; sharedScale puts both panes on one scale',
  pyramid:
    'a pyramid prints each value at its bar and draws no value axis; both sides already share one scale',
};

export const LEGEND_REFUSED_REASONS: Readonly<Record<string, string>> = {
  box: 'a box plot names every row beside its box and its method note explains the box, whiskers and dots; drop legend',
};

export const LEGEND_DRAWS_REASONS: Readonly<Record<string, string>> = {
  slope: "a slope chart names every line at both ends, so 'none' and 'auto' draw what the chart draws without them; drop legend, or name 'top', 'bottom', 'right' or 'left' for a key",
};

/** The one key no type implements; the base schema refuses it on every type. */
export const TRANSPOSE_REFUSED =
  "no chart type implements 'transpose' — orientation is a type, not a flag: use 'bar' for horizontal categories, 'column' for vertical, 'butterfly' for mirrored panes (waterfall has its own 'variant')";

export const TYPE_REFUSED_REASONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  slope: {
    seriesLabels: "'seriesLabels' is not accepted on a slope: it labels both ends of every line itself, name and value together; labels.series sets what the end labels show",
    valueLabels: "'valueLabels' is not accepted on a slope: it prints the value at both ends of every line in its end labels; labels.series sets what they show",
  },
};

/** The sentence a refused key answers with in the schema. */
export function notImplemented(key: string, type: string, suggest: string): string {
  if (key === 'sort' || key === 'topN') {
    const structure: Record<string, string> = {
      line: 'a time sequence', sparkline: 'a time sequence',
      waterfall: 'bridge steps', pvm: 'bridge steps', funnel: 'stages',
      heatmap: 'matrix axes/cells', status: 'matrix axes/cells',
      histogram: 'histogram bins', box: 'box groups',
    };
    if (structure[type]) suggest = `order carries meaning in ${structure[type]}. ${key === 'sort' ? 'Reordering' : 'Dropping'} entries would change that meaning. ${key === 'sort' ? 'Send the data in the order to draw' : 'Filter the data before sending it'}`;
  }
  return `'${key}' is not implemented by '${type}' — ${suggest}`;
}

/** a slope asked to reverse is usually showing ranks, which a bump chart draws. */
const SLOPE_REVERSE_REASON =
  "a slope draws no value axis to reverse. Ranks with 1 on top are a bump chart: type 'line' with variant 'bump', and bump.direction 'lowerIsBetter' ranks the smallest value first. A numeric scale flips on type 'line' with valueAxis.reverse";

/** The schema's reason for refusing the valueAxis sub-key `key` on `type`. */
export function valueAxisReason(type: string, key: string, why: 'only' | 'capability'): string {
  if (type === 'slope' && key === 'reverse') return SLOPE_REVERSE_REASON;
  return why === 'only'
    ? VALUE_AXIS_ONLY_REASONS[type as keyof typeof VALUE_AXIS_ONLY]
    : VALUE_AXIS_REASONS[key as keyof typeof VALUE_AXIS_CAPABILITY];
}

/**
 * The way out a refused key's `suggest` names: another
 * type, an option or a value that does the job, or why removing the key
 * loses nothing. Keyed by option path, then by type with '*' for every other
 * type. A valueAxis sub-key refused because the type reads only other
 * sub-keys falls back to the type's `valueAxis` entry.
 * tests/refusal-contract.test.ts sends every key a published schema refuses
 * and fails on a refusal this table does not answer.
 */
const ALTERNATIVES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  transpose: {
    '*': "orientation is the chart type: type 'bar' draws horizontal bars and type 'column' vertical ones",
    waterfall: 'a waterfall turns with options.variant',
  },
  animate: { '*': 'the SVG is static; options.interactive adds hover and focus semantics' },
  debug: { '*': 'no chart type reads it, and the CLI has no debug flag' },
  ribbons: { bar: "bar rows are items, not a sequence, and ribbons draw a rank flow from period to period; type 'column' with variant 'stacked' draws them" },
  rowLabels: { '*': "aligned row labels belong to horizontal rows such as type 'bar'; this type prints its category labels on one baseline already" },
  categoryLabels: { '*': "type 'column', 'combo' or 'pareto' over columns sorted by height takes categoryLabels 'staircase'", bar: 'a horizontal bar prints each name beside its row already' },
  categoryAxis: { '*': "dateTicks is a setting of types 'line', 'column' and 'combo', and crossesBetween one of type 'line'; a banded type crosses between its bands already" },
  secondaryAxis: { '*': "a second value scale needs type 'combo'" },
  labels: {
    '*': "options.labelDensity 'minimal' keeps the totals and endpoints",
    grid: "set labels in each panel's own options",
    sparkline: 'options.endLabels and options.valueLabel set what prints',
    table: 'the columns set what each cell prints',
    bartable: "each row's value prints at its bar end",
    creative: 'the card prints the figures it is given',
    diagram: 'a diagram prints its own node and edge text',
  },
  hatchStrength: {
    '*': 'this type draws no forecast, partial-period or no-data hatch',
  },
  sort: {
    '*': 'send the categories in the order to draw',
    pyramid: 'send the bands in their age order',
    pareto: 'a Pareto sorts by contribution itself',
    choropleth: 'a map places its regions by geography',
    tilemap: 'a map places its regions by geography',
  },
  'sort.segments': { likert: 'keep the response scale in its ordered axis; sort.categories orders statements' },
  topN: {
    '*': 'filter the data before sending it',
    likert: "options.neutral 'exclude' drops the midpoint; filter the questions in the data",
    pyramid: 'widen the bands in the data',
  },
  rounding: { '*': 'this type prints no computed share of one whole' },
  bandFraction: { '*': 'this type has no category band to fill' },
  mode: { mekko: "a mekko draws one framing at every width; options.variant 'stacked100', 'stacked' or 'bar' sets the form" },
  highlight: {
    '*': 'this type has no mark that takes emphasis',
    choropleth: "a region's colour is its value; name the region in the title or an annotation, or rank the regions in type 'bar' with options.highlight",
    tilemap: "a region's colour is its value; name the region in the title or an annotation, or rank the regions in type 'bar' with options.highlight",
  },
  detailFields: { '*': 'drop detailFields; this type has no cell details' },
  story: { '*': "this type has no story layer; tell the story with a type that has one, such as type 'scatter', 'column' or 'line'" },
  legend: { box: 'a box plot names every row beside its box' },
  seriesLabels: { slope: 'options.labels.series sets what the end labels show' },
  valueLabels: { slope: 'options.labels.series sets what the end labels show' },
  valueAxis: {
    '*': 'this type draws no value axis',
    butterfly: 'options.sharedScale puts both panes on one scale',
    pyramid: 'both sides share one scale already',
    waterfall: 'options.valueAxis.break is the one value-axis setting a waterfall reads',
    pvm: 'options.valueAxis.break is the one value-axis setting a pvm bridge reads',
    slope: 'options.valueAxis.min and options.valueAxis.max widen the domain',
  },
  'valueAxis.tickStep': {
    '*': 'this type has no independent linear value-axis ticks',
    pareto: 'the count and cumulative-percent scales stay tied to the total; options.valueAxis.min and options.valueAxis.max widen the count domain',
  },
  'valueAxis.reverse': {
    '*': "this type grows its marks from a baseline, where a reversed axis reads gains as losses; type 'line' and type 'scatter' reverse",
    slope: "for ranks with 1 on top, draw type 'line' with options.variant 'bump' and options.bump.direction 'lowerIsBetter'; to flip a numeric scale, draw type 'line' with options.valueAxis.reverse",
  },
  'valueAxis.break': { '*': "type 'column', 'bar', 'box', 'histogram' and 'waterfall' draw a break; draw the data as type 'column' or 'bar' to cut a tall value" },
  'valueAxis.log': { '*': "type 'line' and type 'scatter' draw log scales" },
  'scaleGroup.x': { '*': 'options.scaleGroup.y shares the value scale; no chart type shares an x scale' },
  'window.decimate': { '*': 'keep options.window.last, or narrow the periods with options.viewDomain' },
  'window.maxPoints': { '*': 'keep options.window.last, or narrow the periods with options.viewDomain' },
};

/** The suggest for an option key refused on `type` at `path` (relative to options), or undefined when no row answers it. */
export function refusalSuggest(type: string, path: readonly (string | number)[]): string | undefined {
  const key = path.join('.');
  const own = ALTERNATIVES[key];
  const only = path.length === 2 && path[0] === 'valueAxis' && valueAxisRefusal(type, String(path[1])) === 'only'
    ? ALTERNATIVES.valueAxis![type] : undefined;
  const alternative = own?.[type] ?? only ?? own?.['*'];
  return alternative === undefined ? undefined : `Remove '${key}'; ${alternative}.`;
}
