/** Core data model and chart-specific shapes. */

import type { ValueBand } from '../bandSelect';
import type { NamedColumnState } from '../schema/namedColumns';
import type { Cell, ColorRole, ComparisonDirection, Direction, Id, RangeCell, Scenario } from './cell';

export interface Category {
  id: Id;
  label?: string; // default: id; '\n' supported
  date?: string; // ISO 8601; strictly increasing across ALL categories ⇒ date-axis promotion
  total100?: number; // explicit "100% =" basis; default: column sum
  /** Extra band-step fractions after this category; true means 0.5. */
  gapAfter?: boolean | number;
  /** Category axis break after this category: column and bar draw a gap with the break glyph; other charts ignore it. */
  breakAfter?: boolean;
  footnote?: number;
  /** Period still running: bars (including variance actuals and caps) hatch and markers turn hollow in place; the frame adds "<label> partial". */
  partial?: boolean;
  /**
   * Column only: 'total' marks a summary column set apart from the groups by
   * a gap and a divider, with a bold head and bold values; ribbons and
   * connectors stop before it. On a stacked100 column whose total cells are
   * all null and whose groups carry total100 bases, its shares are computed
   * as the base-weighted share Σ total100 × share / Σ total100; a series
   * with a null in some group keeps an empty total cell. Default 'data'.
   */
  role?: 'data' | 'total';
}

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'none';

/** Per-series target pin at one category (line family). */
export interface LineSeriesTarget {
  at: Id;
  value: number;
  label?: string;
}

export interface Series {
  id: Id;
  label?: string; // default: id
  /** Convert numeric values from fractions to percent cells at input. */
  valueKind?: 'fraction';
  values: Cell[]; // positionally aligned to categories (point-keyed accepted by normalize)
  scenario?: Scenario;
  direction?: Direction; // default 'higherIsBetter'
  role?: 'data' | 'reference'; // 'reference' is NOT plotted
  colorRole?: ColorRole;
  fill?: string;
  /**
   * The measure's declared unit, such as '€m' or '%', in place of
   * options.unit for this series. Series drawn against one value scale
   * declare the same unit; a layout refuses one that differs
   * (core/schema/units.ts). A unit is never read off the series name.
   */
  unit?: string;
  format?: string;
  kind?: 'column' | 'line' | 'area'; // combo switching
  axis?: 'primary' | 'secondary';
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  marker?: MarkerShape;
  smooth?: boolean;
  interpolateGaps?: boolean; // default false
}

/**
 * A heatmap row. `sizes` and `bases` run parallel to the categories, in
 * category order: the bubble glyph sizes each circle by `sizes`, and a cell
 * whose `bases` entry is below `options.minBase` is drawn hatched as a low base.
 */
export interface HeatmapSeries extends Series {
  sizes?: (number | null)[];
  bases?: (number | null)[];
  /** One per category: why a null cell has no value. null leaves the cell plain no data. */
  states?: (NamedColumnState | null)[];
}

/** The heatmap's document: `ChartData` whose rows may carry bubble sizes and bases. */
export interface HeatmapData extends ChartData {
  series: HeatmapSeries[];
}

export interface ChartData {
  /** Default valueKind for all series; explicit pct cells remain in percent units. */
  valueKind?: 'fraction';
  categories: Category[];
  series: Series[];
}

// `targets` is NOT on the shared Series: only the line family's series schema
// (src/core/charts/line/index.ts) accepts it. Every other category chart's
// series schema is a non-strict z.object that silently strips the key, so a
// shared declaration would have offered 25 chart types an option that renders
// nothing — and unlike BarOptions.currentValue there is no post-normalize
// warning possible, because the key is gone before layout ever sees the doc.
/** A series in the line family, which may pin per-series targets. */
export interface LineSeries extends Series {
  /** Short endpoint identity used only when the full label exceeds the line-label gutter budget. */
  shortLabel?: string;
  targets?: LineSeriesTarget[];
}
/** The line family's category document: `ChartData` whose series may carry targets. */
export interface LineCategoryData extends ChartData {
  series: LineSeries[];
  x?: undefined;
}
/** One x value of a continuous line axis: an ISO 8601 date or date-time, epoch milliseconds, or a plain number. */
export type LineXValue = string | number;
/** A line on a continuous x axis (options.xAxis): one reading per x value, each series' values in the order of `x`. */
export interface LineXData extends Omit<ChartData, 'categories'> {
  categories?: undefined;
  x: LineXValue[];
  /** The x values whose period the readings cover only in part: each marks its category partial, as `Category.partial` does. */
  partial?: LineXValue[];
  series: LineSeries[];
}
/** The line family's document: ordered categories, or continuous x values. */
export type LineChartData = LineCategoryData | LineXData;
/** A slope series; the extra fields are read by `variant: 'diverging'` only. */
export interface SlopeSeries extends Series {
  /** The negative answer share per category, as positive numbers; `values` then carry the positive share. */
  negative?: Cell[];
  /** The base (respondents) behind the shares: one number for both periods, or one per category. */
  n?: number | number[];
  /** 1-based reference into options.footnotes, drawn after the name in the panel head. */
  footnote?: number;
}
/** The slope document. */
export interface SlopeChartData extends ChartData {
  series: SlopeSeries[];
}

// Range family (bar, column, dot): `rangeCellSchema` accepts a low/high band on
// each cell; the shared `cellSchema` does not.
/** A series whose cells may carry a low/high band. */
export interface RangeSeries extends Omit<Series, 'values'> {
  values: RangeCell[];
}
/** The range family's document: `ChartData` whose cells may carry a band. */
export interface RangeChartData extends ChartData {
  series: RangeSeries[];
}

// ---- waterfall ----
export interface WaterfallSegment {
  id: Id;
  label?: string;
  value: Cell;
  colorRole?: ColorRole;
  scenario?: Scenario;
}
export interface WaterfallItem {
  id: Id;
  label?: string;
  type?: 'delta' | 'subtotal' | 'total'; // default 'delta'
  value?: Cell; // delta: signed contribution; subtotal/total: optional check value
  segments?: WaterfallSegment[];
  date?: string;
  scenario?: Scenario;
  direction?: Direction;
  toBaseline?: boolean;
  /** With `data.cases`: one value per case, in case order, in place of `value`. */
  values?: Cell[];
}
/** One case of a multi-case bridge (scenarios): its own bar in every step, in its own colour. */
export interface WaterfallCase {
  id: Id;
  label?: string;
}
export interface WaterfallConnector {
  from: Id;
  to: Id;
  anchor?: 'sum' | Id; // segment boundary
  hidden?: boolean; // hidden connector starts a new summation
}
export interface WaterfallData {
  items: WaterfallItem[];
  connectors?: WaterfallConnector[];
  /** Two or three cases drawn side by side in each step, each with its own running levels. */
  cases?: WaterfallCase[];
}

// ---- scatter / bubble ----
export interface ScatterPoint {
  id: Id;
  group?: Id;
  label?: string;
  x: Cell;
  y: Cell;
  size?: number; // ∝ area by default
  fill?: string;
  marker?: MarkerShape;
  scenario?: Scenario;
  /** Observations behind this point; `options.minCount` filters on it. */
  count?: number;
}
export interface ScatterGroup {
  id: Id;
  label?: string;
  colorRole?: ColorRole;
  marker?: MarkerShape;
}
export interface ScatterData {
  points: ScatterPoint[];
  groups?: ScatterGroup[];
}

// ---- bullet ----
export interface BulletBand {
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
  to: number;
  label?: string;
}
export interface BulletRow {
  id: Id;
  label?: string;
  /** Period date for comparisons of the same measure over time. */
  date?: string;
  value: Cell;
  target?: Cell;
  /** Numeric shorthand stays supported; object bands add visible qualitative labels. */
  bands?: (number | BulletBand)[];
  direction?: ComparisonDirection;
}
export interface BulletData {
  rows: BulletRow[];
}

// ---- KPI card ----
export interface KpiComparison {
  vs: number;
  label: string;
  direction?: ComparisonDirection;
  mode?: 'absolute' | 'relative' | 'both'; // default 'both'
}

export interface KpiAttainment {
  vs: number;
  label: string;
  tone?: 'good' | 'bad' | 'warn' | 'neutral'; // default 'neutral'
}

export interface KpiData {
  label: string;
  value: number;
  format?: string;
  delta?: {
    vs: number;
    scenario?: Scenario;
    direction?: ComparisonDirection;
    mode?: 'absolute' | 'relative' | 'both'; // default 'relative'
  };
  compare?: KpiComparison[];
  attainment?: KpiAttainment;
  /** Bands that colour the main value only: the first band with value <= to. A band without a tone keeps the ink. */
  bands?: ValueBand[];
  spark?: {
    kind: 'line' | 'area' | 'column';
    values: Cell[];
    /** One period name per value; the card prints the first and the last under the spark's ends. */
    labels?: string[];
  };
  /**
   * One authored caption under the value: the basis, the filter, the scope
   * the number is true of ("Paid channels only · all regions"). The card
   * prints it and never writes it.
   */
  note?: string;
}

// ---- sparkline — the standalone mini line ----
export interface SparklineData {
  /** Convert numeric values from fractions to percent cells at input. */
  valueKind?: 'fraction';
  /** The series, in order. A null leaves a gap; the line does not bridge it. */
  values: Cell[];
  /** One name per value, used for the end labels and the hover records. */
  labels?: string[];
}

// ---- grid: facets AND variance tiers ----
export interface GridPanel {
  id: Id;
  type: string; // registry chart type
  title?: string;
  caption?: string;
  data: unknown;
  options?: object;
  annotations?: unknown[];
}
export interface GridData {
  panels: GridPanel[];
}

// ---- gantt — types RESERVED, implementation v1.5 ----
export interface GanttItem {
  id: Id;
  /** 'rule': a quiet neutral line with a muted label, for the state before a change; it takes no colour and no key entry. */
  kind: 'bar' | 'milestone' | 'chevron' | 'bracket' | 'shade' | 'rule';
  start: string;
  end?: string;
  label?: string;
  colorRole?: ColorRole;
  /** What this bar's colour means, named in the colour key. */
  colorLabel?: string;
  /** A milestone's scope: 'shared' moves it to the shared milestone row below the activities. */
  scope?: 'row' | 'shared';
  anchor?: { toItemId: Id; edge: 'start' | 'end'; offsetDays?: number };
}
/** A metadata cell: text, with an optional tone drawn as a filled marker in the tone's colour before it. */
export interface GanttCell {
  text: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}
export interface GanttTaskRow {
  id: Id;
  label: string;
  /** Second, muted line under the row name, such as what the row measures. */
  sublabel?: string;
  kind?: 'task';
  indent?: number;
  cols?: (string | GanttCell)[];
  items: GanttItem[];
}
export interface GanttCadenceRow {
  id: Id;
  label: string;
  /** Second, muted line under the row name. */
  sublabel?: string;
  kind: 'cadence';
  indent?: number;
  cols?: (string | GanttCell)[];
  events: { id: Id; date: string }[];
  marker?: 'diamond' | 'triangle';
  colorRole?: ColorRole;
}
export type GanttRow = GanttTaskRow | GanttCadenceRow;
export interface GanttData {
  rows: GanttRow[];
}

// ---- variance — a chart type over ChartData with a reference series ----
export interface VarianceSpec {
  of?: Id | 'total'; // default 'total'
  vs: Id; // reference series id (role: 'reference')
}
