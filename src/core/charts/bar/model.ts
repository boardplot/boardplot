/**
 * The structs the standard bar layout phases hand to each other.
 * Each phase is a function from the structs before it to one new struct, plus
 * the run's warnings log, which a phase only appends to. The frame claims into
 * a fresh index, which then becomes the run's index; the marks and the local
 * annotations claim into fresh indexes of their own, which `layoutStandardBar`
 * replays in claim order. Label planning reads the phase 2 struct and no index.
 */

import type { ValueAxisTitle } from '../../axis';
import type { AnchorResolution } from '../../annotate';
import type { FrameResult } from '../../frame';
import type { Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import type { rowLabelBand } from '../../label/rowLabels';
import type { DataRange, RangeMark } from '../../rangeRules';
import type { BandScale, LinearBreak, LinearScale } from '../../scale';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Annotation } from '../../types/annotations';
import type { CellMeta, Id, Scenario } from '../../types/cell';
import type { BarOptions } from '../../types/options';
import type { AxisGeometry, Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { StackExtents } from '../band/stacks';
import type { BarMarks } from './layout';
import type { CalendarInfo } from '../../calendarLabels';
import { maxOf } from '../../arrays';

export const OTHERS_ID = '__others';
export const LABEL_GAP = 5;
export const CAT_BAND_GAP = 10;
/** The most lines a row name takes; the natural height sizes rows for them, so a name that needs them is never cut there. */
export const CAT_MAX_LINES = 3;
/**
 * Internal option: px the plot leaves free right of the bars for furniture a
 * caller draws there (likert's calculation brackets). Without it a CAGR
 * annotation keeps its 36 px. Authored JSON cannot set it.
 */
export const RIGHT_ROOM = Symbol('rightRoom');
/**
 * Internal option: the caller draws the row names itself (likert's statements
 * above their bars on a card), so the plot keeps no name column and starts
 * at the content edge. Authored JSON cannot set it.
 */
export const NO_NAME_COLUMN = Symbol('noNameColumn');
/**
 * Internal option: the right edge of a column where the caller sets every
 * grand total (likert's net column). The solver seats the totals there, so
 * the room past each bar's end stays free for the bar's own values.
 * Authored JSON cannot set it.
 */
export const TOTAL_COLUMN = Symbol('totalColumn');
/**
 * Internal option: with the value axis hidden, the domain is the data extent
 * plus the label room, not snapped to round ticks nobody sees, so the bars
 * fill the row (likert). Authored JSON cannot set it.
 */
export const EXACT_DOMAIN = Symbol('exactDomain');
/**
 * Internal option: the caller resolves the adjacent-colour check from the
 * captured rule, once for the layout it keeps (likert lays bar out several
 * times while it sizes its rows). Authored JSON cannot set it.
 */
export const DEFER_ADJACENT = Symbol('deferAdjacent');
/** Internal option: the cut row names the band gave to the notes; the refit happens once. */
export const CUT_NOTES = Symbol('barCutNotes');
/** The room a CAGR arm and its label take right of the plot when RIGHT_ROOM is unset. */
export const CAGR_ROOM = 36;
/** The room right of the longest bar for an inset CAGR arm (grouped bars): the arm 22 px out and its stroke. */
export const CAGR_INSET_ROOM = 26;

/**
 * Grouped bars set their annotations inset: the CAGR
 * arm close beside the bars with its label inside it, and a difference in
 * one category as a gap arrow in the shorter bar's row. Grid panels and
 * charts that bring their own annotation pass keep the generic furniture.
 */
export function cagrInset(domain: Pick<BarDomain, 'variant' | 'dataSeries'>): boolean {
  return domain.variant === 'grouped' && domain.dataSeries.length > 1;
}

/** How many times a bar was laid out again for its CAGR arm's room. */
export const CAGR_TRIES = Symbol('cagrTries');

export interface NormSeries {
  id: Id;
  label: string;
  scenario?: Scenario;
  direction?: 'higherIsBetter' | 'lowerIsBetter';
  role: 'data' | 'reference';
  colorRole?: string;
  fill?: string;
  /** Series format example and unit (a series format overrides). */
  format?: string;
  unit?: string;
  slot: number; // ramp slot among data series
  cells: { v: number | null; isPct?: boolean; meta: CellMeta | null; range?: DataRange }[];
  /** Some authored cell is a `{ pct }` cell: the series is stated in percent. */
  pctCells?: boolean;
}

export interface NormCat {
  id: Id;
  label: string;
  date?: string;
  total100?: number;
  gapAfter?: boolean | number;
  breakAfter?: boolean;
  partial?: boolean;
  /** Authored footnote reference, drawn beside the row name. */
  footnote?: number;
  /** The derived calendar of a date row: a note names its period with the year where needed. */
  calendar?: CalendarInfo;
}

/**
 * HOST-ONLY, not in the public schema (as `rasterFromValues`): two series
 * that draw one option as halves meeting on the baseline, likert's split
 * neutral. The `pos` half's label names the whole option and centres on both
 * halves, across the baseline; the halves claim as that one label's mark,
 * and the baseline runs behind the bars, so it neither blocks the label nor
 * runs through its digits.
 */
export function barHalves(options: unknown): { neg: Id; pos: Id } | undefined {
  return (options as { halves?: { neg: Id; pos: Id } }).halves;
}

/**
 * Phase 1 output: the resolved options, the series after sort and topN, the
 * plotted values and stacks, the connectors and the net line, the annotations
 * split into the ones bar draws itself and the ones the shared pass draws,
 * and the value extent.
 */
export interface BarDomain {
  options: BarOptions;
  /** rounding 'sum-consistent': the printed share per `categoryId\0seriesId`. */
  shareTexts: Map<string, string>;
  /** rounding 'sum-consistent': the shares printed off their nearest rounding. */
  roundingAdjustments: import('../../shareRounding').RoundingAdjustment[];
  theme: Theme;
  /** The authored palette when the theme knows it, else undefined. */
  palette: string | undefined;
  size: { width: number; height: number };
  measure: TextMeasurer;
  highlights: Set<Id>;
  variant: 'grouped' | 'stacked' | 'stacked100';
  referenceStyle: 'tick' | 'line' | 'marker';
  /** Weight and ink of the reference tick; read under referenceStyle 'tick'. */
  referenceTick: { width: number; color: 'ink' | 'highlight' };
  connectorsOn: boolean;
  connectorDashed: boolean;
  connectorSeries: Set<Id> | null;
  grandTotalsOn: boolean;
  /** The data series add: one series, none stated in percent, or declared sharesOfOneWhole. */
  partsAdd: boolean;
  /** Why a stack has no mean; set where the parts do not add. */
  meanMissing?: string;
  cats: NormCat[];
  dataSeries: NormSeries[];
  refSeries: NormSeries[];
  /** The exhibit-wide format raster; `fmt` is its formatter. */
  valueSpec: ReturnType<typeof import('../../formatSpec').seriesRasterFormatter>;
  /** The value axis ticks: percent on a 100 % bar, the value raster otherwise. */
  axisFmt: { format: (value: number) => string; formatSpec?: import('../../formatSpec').NumberFormatSpec };
  fmt: (v: number) => string;
  /** Formats a stack's absolute total; a 100 % stack drops the percent sign of the chart format. */
  totalFmt: (v: number) => string;
  /** Derived statistics keep their own precision inside the raster's style. */
  statFmt: (v: number) => string;
  /** Categories whose whole stack carries one scenario. */
  uniformScenario: Map<Id, Scenario>;
  /** The actual each PY, PL or FC series takes its colour from (scenarioPairs), by series id. */
  scenarioPartner: Map<Id, NormSeries>;
  /** One series with a highlighted category, so the other bars step back. */
  restRecedes: boolean;
  totals: number[];
  /** stacked100 rows suppressed as n.m. (a negative component) or n/a (no basis). */
  nmRows: boolean[];
  naRows: boolean[];
  /** Stacked rows with a missing part: no total, and on stacked100 no normalised shares. */
  incompleteRows: Set<Id>;
  /** stacked100 percent share per category per series. */
  shares: number[][];
  /** Plot-space value of a bar or segment (percent in stacked100, raw otherwise). */
  plotVal: (ci: number, si: number) => number | null;
  plotRange: (ci: number, si: number) => DataRange | undefined;
  stacks: StackExtents[];
  /** Per category, the positive and negative end of the row. */
  rowEnds: { pos: number; neg: number }[];
  meanValue: number | undefined;
  netLineOn: boolean;
  netLineSeries: NormSeries | undefined;
  /** Vertical valueLines and indicator100, which bar draws itself. */
  localAnns: Annotation[];
  /** Everything else, for the shared annotation pass. */
  passAnns: Annotation[];
  lo: number;
  hi: number;
  /** Every value the exhibit renders, in draw order, for the axis-break check. */
  rendered: number[];
}

/** One paint decision per series and cell, shared by legend, marks and labels. */
export interface BarPaints {
  /** Fill, pattern and outline of a bar or segment, partial-period hatch included. */
  cell(s: NormSeries, cat: NormCat, meta: CellMeta | null, v: number | null): { paint: Paint; pattern?: 'hatch45' | 'outline'; outline?: boolean };
  /** What the viewer SEES: hatched fills read mostly-background. */
  css(paint: Paint, pattern?: 'hatch45' | 'crosshatch' | 'horizontal' | 'vertical' | 'outline'): string;
  /** The reference series paint: neutral markers, ink ticks and lines. */
  reference(): Paint;
}

/** Phase 1 output, second half: the fonts, the category band, the plot rect and the scales. */
export interface BarArea {
  frame: FrameResult;
  tickFont: FontSpec;
  labelFont: FontSpec;
  strongFont: FontSpec;
  /** The value-label font: one role down for the whole chart when bars are thin. */
  pointFont: FontSpec;
  compact: boolean;
  /** Grouped bars thinner than a label: only the first series carries value labels. */
  thinBars: boolean;
  availH: number;
  minWidth: number;
  capW: number;
  catLines: ReturnType<typeof rowLabelBand>['labels'];
  /** "n) Full name." for every row name the band cut and marked. */
  cutNotes: string[];
  catBandW: number;
  plot: Rect;
  /** The value-axis title: in the tick row where it fits, else in its own row under it. */
  axisTitle: ValueAxisTitle | undefined;
  /** Where the title ends on the right and where its top sits. */
  axisTitleAt?: { x: number; y: number };
  activeBreak: LinearBreak | undefined;
  x: LinearScale;
  x0: number;
  /** A theme's outside labels put negative values right of the zero line. */
  negativeLabelsAcross: boolean;
  band: BandScale;
  /** The rows' height when the theme fixes the bar row; absent, rows share the plot. */
  fixedRowsH?: number;
  /** The row step at which a bar holds its segment labels; 0 without them. */
  segmentStep: number;
  /** The row step a pinned height may not go below: the segment label's line box. */
  segmentMinStep: number;
}

/**
 * A theme's fixed bar row: the row step and the bar's share of it,
 * or undefined when the theme leaves rows to share the plot. The step is the
 * pitch, or the tallest row label when that is taller, so a name never runs
 * into the next row; the bar keeps its thickness either way.
 *
 * `minBar` is the thickness a bar needs to hold its segment labels. A
 * thinner theme bar grows to it and the row grows by the same amount, so the
 * gap to the next row stays; under an authored `bandFraction` the row grows
 * until that share of it is `minBar`.
 */
export function fixedBarRow(
  theme: Theme,
  labelHeights: readonly number[],
  minBar = 0,
  bandFraction?: number,
): { step: number; fraction: number } | undefined {
  const row = theme.space.barRow;
  if (!row) return undefined;
  // Whole pixels, so the bar's share of the step does not round under minBar.
  if (bandFraction !== undefined) return { step: Math.max(row.pitch, Math.ceil(minBar / bandFraction), maxOf(labelHeights)), fraction: bandFraction };
  const thickness = Math.max(row.thickness, minBar);
  const step = Math.max(row.pitch + thickness - row.thickness, maxOf(labelHeights));
  return { step, fraction: Math.min(1, thickness / step) };
}

/** Steps a band of `count` rows spans with the authored gaps (the last row's gap is ignored). */
export function bandSteps(count: number, gapAfter: readonly number[]): number {
  return count + gapAfter.slice(0, Math.max(0, count - 1)).reduce((sum, gap) => sum + gap, 0);
}

/** One drawn bar or segment, where phase 2 put it: what the label phase reads. */
export interface BarPlace {
  s: NormSeries;
  si: number;
  /** The raw value, and the plotted one (the share in stacked100). */
  v: number;
  val: number;
  rect: Rect;
}

/** Phase 2 output. */
export interface BarMarkGeometry {
  /** In paint order, from the frame's own nodes on. */
  nodes: SceneNode[];
  /** The phase's own index: every rect it claimed, in claim order. */
  claims: OccupiedIndex;
  axes: AxisGeometry[];
  marks: BarMarks;
  rangeMarks: RangeMark[];
  /** Per category, its drawn bars or segments in series order. */
  bars: BarPlace[][];
  anchorByCat: Map<Id, AnchorResolution>;
  anchorBySeg: Map<string, AnchorResolution>;
  /** The net line's last edge and its row, where its label hangs. */
  netLineEnd: { x: number; ci: number } | undefined;
}
