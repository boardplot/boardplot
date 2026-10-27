import { sequentialShare } from '../../../colorRecipes';
import { clamp } from '../../../geometry';
import { formatExactNumber, intervalText } from '../../../format';
import { differenceExample, formatWithSpec, parseFormatExample, specUnitKind, withChartMarks } from '../../../formatSpec';
import { contrastInkPaint, groundTextPaint, markRolePaint, mixedPaint, semanticPalettePaint, signedFillPaint } from '../../../theme';
import type { Direction, Id } from '../../../types/cell';
import type { StringsSpec } from '../../../types/options';
import type { Paint, SceneNode } from '../../../types/scene';
import type { EncodingContext, HeatTolerance, ResolvedColumn, ResolvedRow } from '../../../types/table';
import type { Theme } from '../../../types/theme';
import { maxOf, minOf } from '../../../arrays';

export interface HeatRange {
  min: number;
  max: number;
  /**
   * Signed columns (± formats, polarity computeds) ALWAYS use the
   * diverging good/bad ramp even when this column's slice happens to be
   * all-positive — otherwise one month's column in a Δ% grid switches to
   * the blue magnitude ramp and reads as a different metric.
   */
  signed?: boolean;
  /** True when the column prints percent or percentage points, which picks `cap.pct`. */
  percent?: boolean;
  /** The centre of the diverging scale: the drawn values' mean, or the total row's value under `center: 'total'`. */
  mean?: number;
  /**
   * Set where `mean` is the total row's value. A `center: 'total'` lane
   * whose total row prints no number falls back to the data rows' mean and
   * leaves it unset, so its key and note say "average".
   */
  totalCentre?: true;
  /** A 'status' lane on a column with polarity lowerIsBetter: below the centre is good. */
  lowerIsBetter?: true;
}

/**
 * The lane's own settings, resolved from the authored encoding.
 * `cap` is where the tint saturates; without one the column's own extreme
 * does, which is the behaviour the bare `'heat'` string always had.
 */
interface HeatOptions {
  cap?: { pct?: number; abs?: number };
  alpha?: number;
  excludeTotals?: boolean;
  /**
   * Discrete ramp: how many bands the lane paints. The last band is
   * the full ink with inverse text, the ones under it the theme's step
   * alphas. Without it the lane stays the continuous tint it always was.
   */
  steps?: number;
  /**
   * How a value finds its band. 'column' normalises over the column's own
   * min and max, 'absolute' cuts at `bins`, 'diverging' measures the
   * distance from the column average, 'status' judges it against that
   * centre as good, warn or bad.
   */
  scale?: 'column' | 'absolute' | 'diverging' | 'status';
  /**
   * Ascending band edges. On 'absolute' a value takes the band of the last
   * edge it reaches; on 'diverging' they are the |distance| edges, default
   * 1 and 4.
   */
  bins?: number[];
  /**
   * On 'column': the narrowest spread that fills the ramp. A column
   * whose values span less takes the bands from the lightest up.
   */
  span?: number;
  /** On 'diverging' and 'status': the centre is the table's total row; omitted, the data rows' mean. */
  center?: 'total';
  /** On 'status': the warn band around the centre; default 5 % of it. */
  tolerance?: HeatTolerance;
  /** Columns this one rule paints, so a 60-column grid names it once. */
  columns?: Id[];
}

interface HeatEmission {
  nodes: SceneNode[];
  ink: Paint;
  /** Weight the cell prints in, where the band asks for one. */
  weight?: number;
}

/**
 * The lane each heat column paints over: its own extreme, whether it is a
 * signed column and whether it prints percent. Both surfaces ask here, so
 * the React grid tints a cell exactly as the SVG does.
 */
export function heatRanges(
  columns: readonly ResolvedColumn[],
  rows: readonly ResolvedRow[],
): Map<Id, HeatRange> {
  const ranges = new Map<Id, HeatRange>();
  for (const column of columns) {
    if (column.cellEncoding?.type !== 'heat') continue;
    if (column.kind !== 'value' && column.kind !== 'computed') continue;
    const spec = column.format === undefined ? undefined : parseFormatExample(column.format);
    // A stepped lane measures the DATA rows only: the closing row of
    // a cohort grid sums an active base into five figures, and with it in the
    // lane every cohort cell fell into the lightest band. The continuous lane
    // keeps counting every row, so no shipped tint moves. A traffic light
    // judges each cohort against the data rows' average.
    const status = column.cellEncoding.scale === 'status';
    const dataOnly = column.cellEncoding.steps !== undefined || status;
    const values: number[] = [];
    let total: number | undefined;
    for (const row of rows) {
      const raw = row.cells[column.id];
      if (row.role === 'total' && raw?.state === 'value' && typeof raw.raw === 'number') total ??= raw.raw;
      if (dataOnly && row.role === 'total') continue;
      const cell = row.cells[column.id];
      // A cell that opted out of the lane does not set its range.
      if (cell?.heat === false) continue;
      if (cell?.state === 'value' && typeof cell.raw === 'number') values.push(cell.raw);
    }
    ranges.set(column.id, {
      min: values.length > 0 ? minOf(values) : 0,
      max: values.length > 0 ? maxOf(values) : 0,
      signed: (column.kind === 'computed' && !!column.polarity) || (spec?.signed ?? false),
      percent: spec !== undefined && specUnitKind(spec) !== 'number',
      // Under `center: 'total'` a band is the distance from the figure the
      // closing row prints, which the reader can check.
      ...(column.cellEncoding.center === 'total' && total !== undefined
        ? { mean: total, totalCentre: true as const }
        : values.length > 0
          ? { mean: values.reduce((sum, value) => sum + value, 0) / values.length }
          : {}),
      ...(status && column.polarity === 'lowerIsBetter' ? { lowerIsBetter: true as const } : {}),
    });
  }
  return ranges;
}

const DEFAULT_ALPHA = 0.18;
const AUTO_INK_THRESHOLD = 0.35;
/**
 * The five-step ink ramp of cohort tables: four tints of the ink over
 * the background, then the full ink. A theme may restate them in
 * `surface.heatSteps`.
 */
const DEFAULT_HEAT_STEPS = [0.06, 0.14, 0.26, 0.42];
/**
 * The floor `fill-separation` holds a pale fill to (themeRules.ts,
 * fillReadabilityWarnings): a ground under it reads as the page.
 */
const FILL_SEPARATION_FLOOR = 1.1;
/** The two weights a diverging band paints at, near and far from the centre. */
const DIVERGING_ALPHAS = [0.12, 0.26];
/** Default |distance| edges of the diverging scale, in the column's own units. */
const DIVERGING_BINS = [1, 4];

/**
 * The alphas of a ramp with `steps` bands: `steps - 1` tints, taken from the
 * theme's own ladder and sampled evenly where the author asked for a
 * different number of bands than the ladder holds.
 */
function stepAlphas(theme: EncodingContext['theme'], steps: number): number[] {
  const ladder = theme.surface?.heatSteps ?? DEFAULT_HEAT_STEPS;
  const count = Math.max(1, steps - 1);
  if (count === ladder.length) return ladder;
  const last = ladder.length - 1;
  return Array.from({ length: count }, (_, index) =>
    ladder[count === 1 ? last : Math.round((index * last) / (count - 1))]!);
}

/**
 * Which band a value falls into, or null where the scale leaves it
 * unshaded. Band `steps - 1` is the full ink.
 */
function bandOf(value: number, range: HeatRange, options: HeatOptions, steps: number): number | null {
  const scale = options.scale ?? 'column';
  if (scale === 'absolute') {
    const bins = options.bins ?? [];
    return Math.min(steps - 1, bins.filter((edge) => value >= edge).length);
  }
  if (scale === 'diverging') {
    const edges = options.bins ?? DIVERGING_BINS;
    const distance = Math.abs(value - (range.mean ?? 0));
    const reached = edges.filter((edge) => distance >= edge).length;
    return reached === 0 ? null : reached;
  }
  const { min, max } = range;
  // The column's own lane: the top value takes the
  // last band, the bottom the first, and a flat column sits in the middle.
  // Under a span floor a narrow column fills only the lower bands.
  const spread = Math.max(max - min, options.span ?? 0);
  if (spread <= 0) return Math.floor((steps - 1) / 2);
  return Math.min(steps - 1, Math.floor(((value - min) / spread) * steps));
}

/** The paint of one band of a stepped lane; `bad` picks the bad side of a diverging one. */
function bandPaint(
  theme: Theme,
  options: HeatOptions,
  steps: number,
  band: number,
  bad: boolean,
): { fill: Paint; ink: Paint; weight?: number } {
  if (options.scale === 'diverging') {
    const tone: Paint = signedFillPaint(bad ? 'bad' : 'good');
    const alpha = DIVERGING_ALPHAS[Math.min(band, DIVERGING_ALPHAS.length) - 1]!;
    return { fill: { ...tone, tint: 1 - alpha } as Paint, ink: { token: 'ink' } };
  }
  if (band >= steps - 1) {
    // The top band takes its own roles, which fall back to the full ink under
    // inverse figures.
    return { fill: { token: 'heatTop' }, ink: { token: 'heatTopInk' }, weight: theme.type.label.weight };
  }
  let bands = STEP_BANDS.get(theme);
  if (!bands) STEP_BANDS.set(theme, bands = new Map());
  let paint = bands.get(`${steps}:${band}`);
  if (paint === undefined) {
    const fill: Paint = { token: 'markInk', tint: 1 - stepAlphas(theme, steps)[band]! };
    bands.set(`${steps}:${band}`, paint = { fill, ink: groundTextPaint({ token: 'ink' }, fill) });
  }
  return paint;
}

/** One paint per theme and band: every cell of a band shares its ink recipe, so its contrast walk runs once. */
const STEP_BANDS = new WeakMap<Theme, Map<string, { fill: Paint; ink: Paint }>>();

function steppedPaint(
  context: Omit<EncodingContext, 'box' | 'nodeId' | 'owner'>,
  range: HeatRange,
  options: HeatOptions,
  steps: number,
  value: number,
): { fill?: Paint; ink: Paint; weight?: number } {
  const band = bandOf(value, range, options, steps);
  if (band === null) return { ink: { token: 'ink' } };
  return bandPaint(context.theme, options, steps, band, badSide(value < (range.mean ?? 0), context.cell.polarity));
}

/**
 * Whether a figure on the low side (below zero, or below a diverging lane's
 * centre) is the bad one: under lowerIsBetter the low side is good. The heat
 * lane, its key and the in-cell bar ask here, on both surfaces.
 */
export function badSide(low: boolean, polarity: Direction | undefined): boolean {
  return low !== (polarity === 'lowerIsBetter');
}

/** One swatch of a heat lane's key: the band's ground and its edges in words. */
export interface HeatKeyEntry {
  id: string;
  label: string;
  fill: Paint;
}

/**
 * The swatch key of a lane cut at fixed edges: 'absolute'
 * and 'diverging' bands mean numbers no cell prints, so the table names them
 * above the grid, each edge once and on the side it falls ("30 to under 40",
 * "4 and more"). A 'column' ramp is lighter for less within its column, which
 * the reader needs no key for. Both surfaces draw these entries.
 * Equal scales share one key; different scales name the columns they explain.
 */
export function heatKey(columns: readonly ResolvedColumn[], ranges: ReadonlyMap<Id, HeatRange>, theme: Theme, strings?: StringsSpec, language?: string): HeatKeyEntry[] {
  const groups = new Map<string, { columns: string[]; entries: HeatKeyEntry[] }>();
  let statusEntries: HeatKeyEntry[] | undefined;
  for (const column of columns) {
    const encoding = column.cellEncoding;
    if (encoding?.type !== 'heat') continue;
    // Status lanes already share a relative key plus a direction note. Keep
    // that contract; fixed-edge lanes need their own numerical scale keys.
    const entries = encoding.scale === 'status'
      ? statusEntries ??= statusKey(columns, ranges, encoding, strings)
      : laneHeatKey([column], ranges, theme, strings, language);
    if (entries.length === 0) continue;
    // Keep exact edges and paint in the identity. Display precision can
    // differ between columns with the same scale; units still distinguish them.
    const format = column.format === undefined ? undefined : parseFormatExample(column.format);
    const identity = JSON.stringify(encoding.scale === 'status' ? entries : [
      encoding.scale, encoding.bins ?? (encoding.scale === 'diverging' ? DIVERGING_BINS : null),
      entries.map(entry => entry.fill), format && [format.prefix, format.suffix, format.magnitude],
    ]);
    const group = groups.get(identity);
    if (group) group.columns.push(column.label);
    else groups.set(identity, { columns: [column.label], entries });
  }
  if (groups.size === 1) return groups.values().next().value!.entries;
  return [...groups.values()].flatMap((group, index) => group.entries.map((entry) => ({
    ...entry,
    id: `${entry.id}:scale${index}`,
    label: `${group.columns.join(', ')}: ${entry.label}`,
  })));
}

function laneHeatKey(columns: readonly ResolvedColumn[], ranges: ReadonlyMap<Id, HeatRange>, theme: Theme, strings?: StringsSpec, language?: string): HeatKeyEntry[] {
  for (const column of columns) {
    const encoding = column.cellEncoding;
    if (encoding?.type === 'heat' && encoding.scale === 'status') return statusKey(columns, ranges, encoding, strings);
    if (encoding?.type !== 'heat' || (encoding.scale !== 'absolute' && encoding.scale !== 'diverging')) continue;
    const diverging = encoding.scale === 'diverging';
    const edges = encoding.bins ?? (diverging ? DIVERGING_BINS : []);
    if (edges.length === 0) continue;
    const steps = encoding.steps ?? edges.length + 1;
    // A diverging edge is a distance: a percent column's in percentage points,
    // and unsigned, since "below" and "above" carry the side.
    // The edges print in the chart's marks (numberMarks.ts), as the cells do.
    const spec = column.format === undefined ? undefined
      : withChartMarks(diverging ? { ...parseFormatExample(differenceExample(column.format)), signed: false } : parseFormatExample(column.format), language);
    const text = spec === undefined ? (value: number) => formatExactNumber(value, language) : (value: number) => formatWithSpec(value, spec);
    const band = (index: number, last: boolean) => last
      ? `${text(edges[index - 1]!)} and more`
      : index === 0 ? `under ${text(edges[0]!)}` : intervalText(text(edges[index - 1]!), text(edges[index]!));
    const swatch = (id: string, label: string, fill: Paint): HeatKeyEntry => ({ id: `heatKey:${id}`, label, fill });
    if (diverging) {
      const sides = edges.map((_, index) => ({ index: index + 1, label: band(index + 1, index === edges.length - 1) }));
      // shortcut: the column's direction only; a row that overrides it paints
      // its own cells the other way round than this key says. A key per
      // direction when a lane mixes them.
      return [
        ...[...sides].reverse().map(({ index, label }) =>
          swatch(`below${index}`, `${label} below`, bandPaint(theme, encoding, steps, index, badSide(true, column.polarity)).fill)),
        swatch('none', `under ${text(edges[0]!)} either way`, { token: 'background' }),
        ...sides.map(({ index, label }) =>
          swatch(`above${index}`, `${label} above`, bandPaint(theme, encoding, steps, index, badSide(false, column.polarity)).fill)),
      ];
    }
    const count = Math.min(steps, edges.length + 1);
    return Array.from({ length: count }, (_, index) =>
      swatch(`band${index}`, band(index, index === count - 1), bandPaint(theme, encoding, steps, index, false).fill));
  }
  return [];
}

/** The three judgments of a 'status' lane. */
type StatusBand = 'good' | 'warn' | 'bad';

/** The warn band of a 'status' lane when the author names none: 5 % of the centre. */
const STATUS_TOLERANCE: HeatTolerance = { pct: 5 };

/**
 * The traffic light of one value: its distance from the lane's centre, the
 * sign flipped under lowerIsBetter, against the tolerance. The cell's own
 * direction wins where it has one, as on the other lanes: a lowerIsBetter
 * row in a higherIsBetter column reads its fall as good. A distance of
 * exactly the tolerance still reads warn. No centre, no judgment.
 */
function statusBand(value: number, range: HeatRange, tolerance: HeatTolerance = STATUS_TOLERANCE, polarity?: Direction): StatusBand | null {
  const centre = range.mean;
  if (centre === undefined) return null;
  const lower = polarity === undefined ? range.lowerIsBetter === true : polarity === 'lowerIsBetter';
  const distance = (value - centre) * (lower ? -1 : 1);
  const limit = tolerance.abs ?? (Math.abs(centre) * (tolerance.pct ?? 0)) / 100;
  // A float distance a hair over its limit (62.7 - 66 against 3.3) is the limit.
  const over = Math.abs(distance) - limit;
  if (over <= 1e-9 * Math.max(1, Math.abs(centre))) return 'warn';
  return distance > 0 ? 'good' : 'bad';
}

/**
 * The ground of one traffic-light band: the fill role of its judgment
 * (goodFill, warnFill, badFill, each falling back to good, warn, bad) at
 * the lane's alpha over the background (a cell is a large fill). On a dark
 * page it deepens until it reads against the page as the light wash reads
 * on white (no floor: a light page keeps the lane's alpha).
 */
function statusFill(band: StatusBand, alpha: number): Paint {
  const base = markRolePaint(band, true);
  return { token: 'token' in base ? base.token : 'neutral', theme: { kind: 'visible-tint', base, amount: 1 - alpha, floor: 1, darkMatchLight: true } } as Paint;
}

/** The status lanes among these columns. */
function statusLanes(columns: readonly ResolvedColumn[]): ResolvedColumn[] {
  return columns.filter((column) => column.cellEncoding?.type === 'heat' && column.cellEncoding.scale === 'status');
}

/** What a lane's centre is called: the total only where the total row set it. */
function centreNoun(range: HeatRange | undefined): 'total' | 'average' {
  return range?.totalCentre === true ? 'total' : 'average';
}

/**
 * The key of a traffic-light lane: three grounds, named for where a value
 * sits against the centre ("Below average", "Around average", "Above
 * average", or "... total" where the total row sets it), or by the authored
 * `strings.heatBelow`, `heatAround` and `heatAbove`. Where every status lane
 * drawn reads lowerIsBetter, below is the good side and the outer swatches
 * swap their grounds; a table with both directions keeps this reading, and
 * its footnote names the columns that read the other way.
 *
 * shortcut: the noun of the first lane; lanes with different centres would need one key each.
 */
function statusKey(columns: readonly ResolvedColumn[], ranges: ReadonlyMap<Id, HeatRange>, encoding: { alpha: number }, strings?: StringsSpec): HeatKeyEntry[] {
  const lanes = statusLanes(columns);
  const lower = lanes.length > 0 && lanes.every((column) => column.polarity === 'lowerIsBetter');
  const noun = centreNoun(ranges.get(lanes[0]!.id));
  const swatch = (id: string, label: string, band: StatusBand): HeatKeyEntry =>
    ({ id: `heatKey:${id}`, label, fill: statusFill(band, encoding.alpha) });
  return [
    swatch('below', strings?.heatBelow ?? `Below ${noun}`, lower ? 'good' : 'bad'),
    swatch('around', strings?.heatAround ?? `Around ${noun}`, 'warn'),
    swatch('above', strings?.heatAbove ?? `Above ${noun}`, lower ? 'bad' : 'good'),
  ];
}

/**
 * The note a table of both directions prints under its status key: the
 * key reads higher is better, so the lanes that read lower are named, each
 * with the centre it actually took ("below the total for Cost and below
 * the average for Churn" where they differ). Undefined where the columns
 * hold one direction only. Each surface asks with the columns and rows it
 * draws, so the note never names a lane a toggle hides.
 */
export function statusDirectionNote(columns: readonly ResolvedColumn[], ranges: ReadonlyMap<Id, HeatRange>, colorblindSafe = false): string | undefined {
  const lanes = statusLanes(columns);
  const lower = lanes.filter((column) => column.polarity === 'lowerIsBetter');
  if (lower.length === 0 || lower.length === lanes.length) return undefined;
  const byNoun = new Map<string, string[]>();
  for (const column of lower) {
    const noun = centreNoun(ranges.get(column.id));
    byNoun.set(noun, [...(byNoun.get(noun) ?? []), column.label]);
  }
  const where = byNoun.size === 1
    ? `below the ${[...byNoun.keys()][0]}`
    : [...byNoun].map(([noun, labels]) => `below the ${noun} for ${labels.join(', ')}`).join(' and ');
  // Under colorblindSafe the good side is not green.
  return `Lower is better for ${lower.map((column) => column.label).join(', ')}: there, ${colorblindSafe ? 'the good tone' : 'green'} marks ${where}.`;
}

/**
 * The lane's paint for one cell, without a box: the ground the cell takes
 * and the ink it prints in. The SVG wraps it in a rect and the React grid
 * writes it into the cell's background, so one function decides
 * what a heat cell looks like on both surfaces.
 */
export function heatPaint(
  context: Omit<EncodingContext, 'box' | 'nodeId' | 'owner'>,
  range: HeatRange,
  options: HeatOptions = {},
): { fill?: Paint; ink: Paint; weight?: number } {
  const value = context.cell.raw;
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const excludeTotals = options.excludeTotals ?? true;
  if (context.cell.state !== 'value' || typeof value !== 'number') {
    return { ink: { token: 'ink' } };
  }
  // The author took this one cell out of the lane: no ground, and
  // the figure whispers at the body weight, as an M0 cell does on either
  // cohort axis.
  if (context.cell.heat === false) return { ink: { token: 'inkMeta' }, weight: context.theme.type.label.weight };
  // A total carries no variance worth colouring, and a tinted total row reads
  // as one more data row.
  if (excludeTotals && context.cell.role === 'total') {
    return { ink: { token: 'ink' } };
  }
  if (options.scale === 'status') {
    const band = statusBand(value, range, options.tolerance, context.cell.polarity);
    if (band === null) return { ink: { token: 'ink' } };
    const fill = statusFill(band, alpha);
    // The figures keep the ink on the default ground; a heavier authored
    // alpha hands them to the contrast ink, as the continuous lane does.
    return { fill, ink: alpha > AUTO_INK_THRESHOLD ? contrastInkPaint(fill) : { token: 'ink' } };
  }
  const steps = options.steps ?? (options.bins === undefined ? undefined : options.bins.length + 1);
  if (steps !== undefined && steps >= 2) return steppedPaint(context, range, options, steps, value);

  const diverging = (range.min < 0 && range.max > 0) || range.signed === true;
  // The lane is anchored at zero and saturates at the cap: a YoY column capped
  // at ±20 points paints the same tint for +20 whatever the widest value in
  // the column happens to be. Without a cap the column's largest magnitude
  // is it, on both sides, so +27 and −27 paint one tint.
  const extreme = Math.max(Math.abs(range.min), Math.abs(range.max));
  const authoredCap = range.percent === true ? options.cap?.pct : options.cap?.abs;
  const capValue = Math.max(authoredCap ?? Math.abs(extreme), 1e-9);
  // Without a cap a sequential lane spans the column's own min..max (the
  // heatmap's rule), so a column of 88 to 100 does not paint one tint.
  const normalized = clamp(!diverging && authoredCap === undefined
    ? sequentialShare(value, range.min, range.max)
    : Math.abs(value) / capValue, 0, 1);

  // A heat cell is a large fill: the signed fill roles on a diverging lane,
  // the focus on a sequential one, each falling back as before.
  // The cell's direction judges the sign: under lowerIsBetter a fall is good,
  // as its badge and the footnote say. The tone cannot say it, since it stays
  // neutral on context rows and muted cells that the lane still paints.
  let tone: Paint;
  if (diverging) {
    tone = value === 0
      ? semanticPalettePaint(context.theme, context.palette, 'neutral')
      : signedFillPaint(badSide(value < 0, context.cell.polarity) ? 'bad' : 'good');
  } else {
    // A heat cell is larger than a point: the ramp takes series 1 and the
    // signed grounds the fill roles, falling back to good and bad. The
    // ramp is tints of series 1.
    tone = mixedPaint(
      semanticPalettePaint(context.theme, context.palette, 'sequential'),
      semanticPalettePaint(context.theme, context.palette, 'neutral'),
      normalized,
      'series-1',
    );
  }

  const tintWeight = alpha * normalized;
  // A zero-weight tint is the background painted over whatever ground the row
  // already has, so the lane emits nothing there instead of erasing a band.
  if (tintWeight <= 0) return { ink: { token: 'ink' } };
  // A cell the lane paints separates from the page: without a floor the
  // smallest moves take grounds of 1.01:1, a tint no reader sees, and a
  // -0.4 % reads as unshaded on a dark theme. The wash stops where the floor
  // holds, in the theme the scene is painted in, so a repaint keeps it.
  const fill: Paint = {
    token: 'token' in tone ? tone.token : 'neutral',
    theme: { kind: 'visible-tint', base: tone, amount: 1 - tintWeight, floor: FILL_SEPARATION_FLOOR },
  };
  let ink: Paint = { token: 'ink' };
  if (tintWeight > AUTO_INK_THRESHOLD) {
    ink = contrastInkPaint(fill);
  }

  return { fill, ink };
}

export function emitHeat(
  context: EncodingContext,
  range: HeatRange,
  options: HeatOptions = {},
): HeatEmission {
  const { fill, ink, weight } = heatPaint(context, range, options);
  return {
    nodes: fill === undefined ? [] : [
      {
        t: 'rect',
        id: context.nodeId('heat'),
        rect: { ...context.box },
        fill,
        owner: context.owner,
        part: 'tableHeat',
      },
    ],
    ink,
    ...(weight === undefined ? {} : { weight }),
  };
}
