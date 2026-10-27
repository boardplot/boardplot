/**
 * The structs the column layout phases hand to each other. Each phase
 * is a function from the structs before it to one new struct, plus the run's
 * warnings log, which a phase only appends to. The frame claims into a fresh
 * index, which then becomes the run's index; the marks claim into a fresh
 * index of their own, which `layoutColumn` replays in claim order. Label
 * planning reads the phase 2 struct and no index.
 */

import type { ValueAxisTitle } from '../../axis';
import type { NumberFormatSpec } from '../../formatSpec';
import type { FrameResult } from '../../frame';
import type { Rect } from '../../geometry';
import type { CategoryRowPlan } from '../../label/categoryRow';
import type { OccupiedIndex } from '../../label/occupied';
import type { DataRange, RangeMark } from '../../rangeRules';
import type { PreparedRatioTier } from '../../ratioTier';
import type { BandScale, LinearBreak, LinearScale } from '../../scale';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Annotation } from '../../types/annotations';
import type { Direction, Id, Scenario } from '../../types/cell';
import type { Category } from '../../types/data';
import type { LabelContent, LabelDensity, ValueAxisOptions } from '../../types/options';
import type { AxisGeometry, Paint, PlacedAnnotation, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { StackExtents } from '../band/stacks';
import type { AnomalyModel } from './anomaly';
import type { ColumnMarks, IntegratedVariancePoint } from './layout';
import type { AnomalyColumnOptions } from './types';

export interface NormVal {
  v: number | null;
  isPct: boolean;
  fill?: string;
  scenario?: Scenario;
  format?: string;
  labelOverride?: string | false;
  priority?: number;
  range?: DataRange;
}

/** A Total column the engine filled: its base and the computed share per series, in percent. */
export interface ComputedTotal {
  categoryId: Id;
  total100: number;
  values: Record<Id, number>;
}

export interface NormSer {
  id: Id;
  label: string;
  role: 'data' | 'reference';
  scenario?: Scenario;
  direction: Direction;
  colorRole?: string;
  fill?: string;
  /** Series format example and unit (a series format overrides). */
  format?: string;
  unit?: string;
  vals: NormVal[];
}

export type ColumnVariant = 'grouped' | 'stacked' | 'stacked100';
type Pattern = 'hatch45' | 'outline' | undefined;

/** What the options resolve to once, before any phase runs. */
export interface ColumnEnv {
  options: AnomalyColumnOptions;
  theme: Theme;
  /** The authored palette when the theme knows it, else undefined. */
  palette: string | undefined;
  size: { width: number; height: number };
  measure: TextMeasurer;
  pctFmt: (p: number) => string;
  authoredPctFmt: (p: number) => string;
  highlights: Set<Id>;
  density: LabelDensity;
}

/** The PY growth figure per category, before its position is known. */
export type IntegratedValue = Omit<
  IntegratedVariancePoint,
  'x' | 'tickY' | 'totalLabelId' | 'growthLabelId' | 'referenceLabelId' | 'tickNodeId'
>;

/**
 * Phase 1 output: the resolved options, the series after sort and topN, the
 * variant and its options, the plotted values and stacks, the anomaly rule,
 * the value domain and the annotation list.
 */
export interface ColumnDomain extends ColumnEnv {
  /** rounding 'sum-consistent': the printed share per `categoryId\0seriesId` (shareKey). */
  shareTexts: Map<string, string>;
  /** rounding 'sum-consistent': the shares printed off their nearest rounding. */
  roundingAdjustments: import('../../shareRounding').RoundingAdjustment[];
  cats: Category[];
  seriesNorm: NormSer[];
  dataSeries: NormSer[];
  refSeries: NormSer[];
  othersId: Id | null;
  /** Every authored non-null cell of the plotted series is a percent cell. */
  pctLevels: boolean;
  /** The exhibit-wide format raster; `fmt` is its formatter. */
  valueSpec: ReturnType<typeof import('../../formatSpec').seriesRasterFormatter>;
  fmt: (v: number) => string;
  /** Formats a stack's absolute total; a 100 % stack drops the percent sign of the chart format. */
  totalFmt: (v: number) => string;
  /** Derived statistics keep their own precision inside the raster's style. */
  statFmt: (v: number) => string;
  variant: ColumnVariant;
  refStyle: 'tick' | 'line' | 'marker';
  signColor: boolean;
  /** The one PY reference that carries the integrated growth grammar on a stacked column. */
  pyRef: NormSer | undefined;
  /** Its growth figure per category. */
  pyGrowth: Map<Id, IntegratedValue>;
  /** Categories whose whole stack carries one scenario. */
  uniformScenario: Map<Id, Scenario>;
  connectorsOn: boolean;
  /** options.ribbons on a stacked variant: bands join each series across adjacent columns. */
  ribbonsOn: boolean;
  /** Ribbons stack each column by rank (options.ribbons.order 'rank'); false keeps the series order. */
  ribbonRank: boolean;
  /** The weighted Total column cells the engine computed (role 'total', stacked100). */
  computedTotal: ComputedTotal | undefined;
  connectorDashed: boolean;
  connectorSeries: Set<Id> | null;
  netLineOn: boolean;
  netLineSeries: NormSer | undefined;
  /** Whether the net line steps between categories (netLine.connectors). */
  netLineSteps: boolean;
  va: ValueAxisOptions;
  nmCats100: Set<Id>;
  naCats100: Set<Id>;
  /** Stacked (not 100%) categories with a negative component: their segments have no share. */
  mixedSignCats: Set<Id>;
  /** Stacked categories with a missing part: no total, and on stacked100 no normalised shares. */
  incompleteCats: Set<Id>;
  /** Stacked categories with no value in any series: one n/a at the baseline, not a partial stack. */
  emptyCats: Set<Id>;
  /** The data series add: one series, none stated in percent, or declared sharesOfOneWhole. */
  partsAdd: boolean;
  /** Why a stack has no mean; set where the parts do not add. */
  meanMissing?: string;
  /** Value in plotted units (percent for stacked100, absolute otherwise). */
  plottedOf: (s: NormSer, ci: number) => number | null;
  rangeOf: (s: NormSer, ci: number) => DataRange | undefined;
  /** Absolute value (pct cells converted through the basis). */
  absOf: (s: NormSer, ci: number) => number | null;
  /** A segment's share of its stack in percent; null where the stack has no honest whole (mixed signs, a missing part, an empty basis, grouped). */
  shareOf: (s: NormSer, ci: number) => number | null;
  /** Per category, the stack of the plotted values. */
  stacks: StackExtents[];
  stackTotals: Record<Id, number>;
  percents: Record<Id, Record<Id, number>> | undefined;
  anomaly: AnomalyModel | undefined;
  /** Per category, the top of the positive part and the bottom of the negative part, in plotted units. */
  posTopP: number[];
  negBotP: number[];
  dLo: number;
  dHi: number;
  /** The ticks of an authored `valueAxis.tickStep`; the domain spans them exactly. */
  stepTicks?: number[];
  meanValue: number | undefined;
  /** The averageMarker value, when one is drawn. */
  averageMark: number | undefined;
  /** The periods a mean covers where a window or zoom draws fewer (viewportMeanSpan). */
  meanSpan: (scope?: { from?: Id; to?: Id }) => string | undefined;
  /** Which corridor bounds the value axis reaches, and so are drawn. */
  corridorShown: { low: boolean; high: boolean };
  /** The on-exhibit trace for a suppressed corridor rule. */
  corridorNote: string;
  activeBreak: LinearBreak | undefined;
  /** What a grand total prints, or null when the totals are off. */
  gtContent: LabelContent | null;
  /** Series CAGR (seriesLabels.cagr): the name each right-edge label prints, and its claim record. */
  seriesCagr: Map<Id, { text: string; placed: PlacedAnnotation }>;
  /** The authored annotations plus the average marker and the auto indicator100. */
  annList: Annotation[];
}

/** One paint decision per series and cell, shared by legend, marks and labels. */
export interface ColumnPaints {
  css(paint: Paint): string;
  cell(s: NormSer, val: NormVal, cat: Category, dataIdx: number): Paint;
  /** The scenario pattern, or the partial-period hatch. */
  pattern(s: NormSer, val: NormVal, cat: Category): Pattern;
  outline(cat: Category): boolean;
  /** What the viewer SEES, for auto-ink. */
  inside(s: NormSer, val: NormVal, cat: Category, dataIdx: number): string;
  /** The anomaly furniture's paint. */
  corridor: Paint;
  ref(s: NormSer): Paint;
  refStroke(s: NormSer): Paint;
}

/** Phase 1 output, second half: the reserves around the plot, the band and the scale. */
export interface ColumnArea {
  frame: FrameResult;
  axisFmt: (v: number) => string;
  axisSpec: NumberFormatSpec | undefined;
  tier: PreparedRatioTier | undefined;
  tickFont: FontSpec;
  labelFont: FontSpec;
  strongFont: FontSpec;
  /** Height of a grand total label. */
  gtH: number;
  /** The anomaly rule sentence: whether it prints, its text as rendered, its wrap, the band it reserves. */
  ruleOn: boolean;
  ruleText: string;
  ruleWrap: { lines: string[]; title?: string } | undefined;
  ruleH: number;
  /** The value-axis title, drawn under the rule band, and the band it adds to topPad. */
  axisTitle: ValueAxisTitle | undefined;
  axisTitleBand: number;
  /** Headroom above the plot: grand totals, PY growth, cagr arms, the rule band. */
  topPad: number;
  band: BandScale;
  catPlan: CategoryRowPlan;
  showCatRow: boolean;
  /** options.categoryLabels 'staircase' on this pass: the highest y the names may use. */
  stairTop?: number;
  /** The category tick-row reserve (the tick-band record), and the whole band below the plot. */
  tickReserve: number;
  catBandH: number;
  /** Top of the category row: under the lowest column and the value hanging under it. */
  catRowY: number;
  plot: Rect;
  y: LinearScale;
  y0: number;
}

/** Where a flag marker sits, solved with its column. */
export interface FlagMarker {
  cx: number;
  base: number;
  tip: number;
  up: boolean;
  outside: boolean;
  value: number;
  /** What the column paints where an inside-flipped marker would sit. */
  insideFill: string;
  insidePaint: Paint;
  insidePattern?: 'hatch45' | 'outline';
}

/** One drawn column or segment, where phase 2 put it: what the label phase reads. */
export interface BarPlace {
  s: NormSer;
  si: number;
  c: Category;
  ci: number;
  v: number;
  rect: Rect;
}

/** Phase 2 output. */
export interface ColumnMarkGeometry {
  /** In paint order, from the frame's own nodes on. */
  nodes: SceneNode[];
  /** The phase's own index: every rect it claimed, in claim order. */
  claims: OccupiedIndex;
  axes: AxisGeometry[];
  marks: ColumnMarks;
  rangeMarks: RangeMark[];
  bars: BarPlace[];
  /** Keyed by `sk(series, category)`: grouped column centres and stack segment edges, for annotation anchors. */
  subCenters: Map<string, number>;
  segEdges: Map<string, { v0: number; v1: number; v: number }>;
  /** Per category, the y of every non-marker reference tick (leader clearance). */
  refTickYs: Map<Id, number[]>;
  flagMarkers: Map<Id, FlagMarker>;
  /** The net line's last edge, where its label hangs. */
  netLineEnd: { x: number; y: number } | undefined;
}

export { ANOMALY_FLAG_GAP, ANOMALY_FLAG_H } from './anomaly';


/**
 * Set on a grid panel's options when the grid key names the panel's series
 * and references. A registered symbol, so the grid sets it without importing
 * the column. The integrated PY tick then prints its value alone.
 */
export const PANEL_KEYED = Symbol.for('boardplot.panelKeyed');

/**
 * The right margin a hidden integrated PY tick
 * label of the last column needs; the column is laid out again with it.
 */
export const TICK_LABEL_RESERVE = Symbol('tickLabelReserve');

/** The integrated PY tick reaches 8 px past its column; its label starts 4 px further out. */
export const PY_TICK_LEAD = 12;
