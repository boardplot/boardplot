/**
 * The structs the combo layout phases hand to each other. Each phase
 * is a function from the structs before it to one new struct, plus the run's
 * warnings log, which a phase only appends to. No phase writes to the run's
 * OccupiedIndex: a phase that claims space claims into a fresh index of its
 * own, and `layoutCombo` commits it, in claim order. Label planning reads the
 * committed index through an `OccupiedView`, which has no claim method.
 */

import type { ForecastBoundary } from '../line/forecast';
import type { NumberFormatSpec } from '../../formatSpec';
import type { FrameResult } from '../../frame';
import type { Rect } from '../../geometry';
import type { CategoryRowPlan } from '../../label/categoryRow';
import type { OccupiedIndex } from '../../label/occupied';
import type { SlotCandidate } from '../../label/solver';
import type { BandScale, LinearScale } from '../../scale';
import type { FontSpec, TextMeasurer } from '../../text';
import type { CurveSegment } from '../../curve';
import type { Id, Scenario } from '../../types/cell';
import type { LineAnomaly } from '../line/model';
import type { Category, MarkerShape } from '../../types/data';
import type { ComboOptions, LabelDensity, LineInterpolation } from '../../types/options';
import type { AxisGeometry, LintWarning, Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { AreaGround } from '../../label/areaGround';
import type { ComboAxisTitles } from './axisTitles';
import type { EndpointGutters, EndpointText } from './endpoints';
import type { ComboMarks } from './layout';

export interface NormVal {
  v: number | null;
  isPct: boolean;
  fill?: string;
  scenario?: Scenario;
  labelOverride?: string | false;
  format?: string;
  priority?: number;
}

export interface NormSer {
  id: Id;
  label: string;
  role: 'data' | 'reference';
  kind: 'column' | 'line' | 'area';
  axis: 'primary' | 'secondary';
  scenario?: Scenario;
  colorRole?: string;
  fill?: string;
  format?: string;
  unit?: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  marker?: MarkerShape;
  smooth?: boolean;
  interpolateGaps: boolean;
  vals: NormVal[];
}

export const MARKER_R = 2.75;

/** What the options resolve to once, before any phase runs. */
export interface ComboEnv {
  theme: Theme;
  /** The authored palette when the theme knows it, else undefined. */
  palette: string | undefined;
  size: { width: number; height: number };
  measure: TextMeasurer;
  highlights: Set<Id>;
  density: LabelDensity;
  /** Memoised format-by-example for series formats. */
  byExample: (example: string) => (v: number) => string;
}

/** Phase 1 output: the series by role, the formats per scale group, the stacks and both value domains. */
export interface ComboDomain {
  /** rounding 'sum-consistent': a segment's printed share per `categoryId\0seriesId`. */
  shareTexts: Map<string, string>;
  /** rounding 'sum-consistent': the shares printed off their nearest rounding. */
  roundingAdjustments: import('../../shareRounding').RoundingAdjustment[];
  /** The hidden method note on moved shares. */
  shareNotes: string[];
  /** The options with the view window applied to the annotations. */
  options: ComboOptions;
  cats: Category[];
  data: NormSer[];
  columns: NormSer[];
  lines: NormSer[];
  refs: NormSer[];
  secondaryActive: boolean;
  /** An acknowledged secondary scale drawn without its tick column (`secondaryAxis.show: false`). */
  secondaryTicksHidden: boolean;
  /** The anatomy labels every value, so neither tick column is drawn by default. */
  ticksFromLabels?: boolean;
  /** The dual-axis anatomy is drawn (`dualAxisAnatomy`). */
  anatomy: boolean;
  /** The chosen scales keep the secondary lines above the columns. */
  lineBand: boolean;
  /** Recompute only scales and the anomaly corridor when measured clearance changes the pair. */
  withLineBandClearance?: (clearance: number) => { domain: ComboDomain; warnings: LintWarning[] } | undefined;
  showPrimaryAxis: boolean;
  interpolationFor: (s: NormSer) => LineInterpolation;
  fmt: (v: number) => string;
  valueSpec: NumberFormatSpec;
  pctFmt: (v: number) => string;
  /** The series' own scale-group formatter (an authored s.format still wins at the call sites). */
  scaleFmtOf: (s: NormSer) => (v: number) => string;
  /** Cell and series examples override either scale; the chart example belongs to the primary scale. */
  explicitFormatOf: (s: NormSer, value: NormVal) => string | undefined;
  /** Marker display on the right axis: the secondary series format, else the secondary raster. */
  secFmt: (v: number) => string;
  /** With a view window, the mean over the source categories (valueLine 'mean'). */
  sourceMean: number | undefined;
  /** The periods a mean covers where a window or zoom draws fewer (viewportMeanSpan). */
  meanSpan: (scope?: { from?: Id; to?: Id }) => string | undefined;
  /** The id of the averageMarker's value line, when one is drawn. */
  averageMarkerId: Id | undefined;
  /** options.anomaly over the one line series. */
  anomaly: LineAnomaly | undefined;
  stackTotals: Record<Id, number>;
  /** Column stacks with a missing component; totals count the known parts only. */
  incompleteCats: Set<Id>;
  /** The column series add: one series, or none stated in percent. */
  columnsAdd: boolean;
  posTop: number[];
  negBot: number[];
  anyByCat: boolean[];
  dLo: number;
  dHi: number;
  pticks: number[];
  secondaryDomain?: [number, number];
  rightTicks: { at: number; text: string }[];
}

/** One paint decision per series and cell, shared by legend, marks and labels. */
export interface ComboPaints {
  edge: (fill: Paint, pattern?: 'hatch45' | 'outline') => Pick<import('../../seriesIdentity').SeriesIdentity, 'stroke' | 'width' | 'separation'>;
  css(p: Paint): string;
  column(s: NormSer, colIdx: number): Paint;
  cell(s: NormSer, val: NormVal, cat: Category, colIdx: number): Paint;
  /** A partial category hatches too, but it is no scenario key. */
  pattern(s: NormSer, val: NormVal, cat: Category): 'hatch45' | 'outline' | undefined;
  /** Auto-ink contrasts against the RENDERED appearance. */
  inside(s: NormSer, val: NormVal, cat: Category, colIdx: number): string;
  /** Fill at the stack's outer end, for the grand-total insideEnd auto-ink. */
  top(ci: number, above: boolean): Pick<SlotCandidate, 'insideFill' | 'insidePaint' | 'insidePattern'>;
  line(s: NormSer, li: number): Paint;
  lineHollow(s: NormSer): boolean;
  lineWidth(s: NormSer, li: number): number;
  dash(s: NormSer): number[] | undefined;
  ref(s: NormSer): Paint;
}

/** Phase 1 output, second half: the frame, the reserves around the plot, the band and the scales. */
export interface ComboArea {
  frame: FrameResult;
  leftAxisReserve: number;
  rightAxisReserve: number;
  /** Where the anomaly rule numbers start, right of the ticks, the end-label gutter and the growth figures. */
  anomalyLabelX: number;
  axisTitles: ComboAxisTitles;
  topPad: number;
  valueLineRows: Map<Id, Rect>;
  tickFont: FontSpec;
  labelFont: FontSpec;
  strongFont: FontSpec;
  gtH: number;
  first: Map<Id, EndpointText>;
  last: Map<Id, EndpointText>;
  gutters: EndpointGutters;
  /** Width before staircase and category overhang reserves, used by the inside-end retry. */
  endpointWidth: number;
  band: BandScale;
  catPlan: CategoryRowPlan;
  dateNumericTicks: boolean;
  showCatTickRow: boolean;
  /** options.categoryLabels 'staircase' on this pass: the highest y the names may use. */
  stairTop?: number;
  catBandH: number;
  /** Top of the category row: under the lowest column and the total hanging under it. */
  catRowY: number;
  plot: Rect;
  rightTickX: number;
  y: LinearScale;
  y0: number;
  /** The secondary scale when one is acknowledged, else `y`. */
  y2: LinearScale;
  /** The anatomy's growth statement beyond the right ticks, when asked for. */
  growth?: { x: number; valueFont: FontSpec; nameFont: FontSpec; items: GrowthItem[]; oneLine: boolean };
  /** Where per-cell forecasts start, and the top of the "FC" row above the totals. */
  forecast: ForecastBoundary[];
  forecastHeaderY: number;
}

/** One series' growth from its first to its last value, as the anatomy states it at the right end. */
export interface GrowthItem {
  seriesId: Id;
  text: string;
  name: string;
  /**
   * The name beside the figure on the plot's side: the series label up to its
   * first comma, in the authored case, plus the span when the name has one.
   */
  short: string;
  /** The series' text-safe ink (its text twin), set where the paints are known. */
  textPaint?: Paint;
  /** The last value on the series' own scale, where the statement is centred. */
  last: number;
  axis: 'primary' | 'secondary';
  /** The line's growth takes the ink, the columns' the muted ink. */
  ink: 'ink' | 'inkMuted';
}

export interface LinePlan {
  s: NormSer;
  li: number;
  interpolation: LineInterpolation;
  pts: { ci: number; x: number; y: number }[];
  runs: { ci: number; x: number; y: number }[][];
  curveRuns: CurveSegment[][];
}

/** One drawn stack segment, where phase 2 put it: what the label phase reads. */
export interface SegmentPlace {
  s: NormSer;
  si: number;
  ci: number;
  v: number;
  rect: Rect;
}

/** Phase 2 output. */
export interface ComboMarkGeometry {
  /** In paint order, after the frame's own nodes. */
  nodes: SceneNode[];
  /** The phase's own index: every rect it claimed, in claim order. */
  claims: OccupiedIndex;
  axes: AxisGeometry[];
  /** x of the leftmost primary tick label, Infinity without the axis. */
  leftTickX: number;
  marks: ComboMarks;
  segEdges: Map<string, { v0: number; v1: number; v: number }>;
  segments: SegmentPlace[];
  plans: LinePlan[];
  meanValue: number | undefined;
  /** Right ticks a value-line label may take the place of, decided after the annotation pass. */
  yieldingTicks: { labelId: Id; annotationId: Id; rect: Rect }[];
  /** The area fills as drawn, where another series' value may sit (label/areaGround.ts). */
  areaGrounds: AreaGround[];
}

