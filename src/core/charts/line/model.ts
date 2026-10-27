/**
 * The structs the line layout phases hand to each other. Each phase
 * is a function from the structs before it to one new struct, plus the run's
 * warnings log, which a phase only appends to. No phase before the solver
 * writes to the run's OccupiedIndex: the frame and the marks claim into
 * indexes of their own, which `layoutLine` commits in claim order.
 */

import type { ValueAxisTitle } from '../../axis';
import type { FrameResult } from '../../frame';
import type { Rect } from '../../geometry';
import type { CategoryRowPlan } from '../../label/categoryRow';
import type { OccupiedIndex } from '../../label/occupied';
import type { LabelRequest } from '../../label/solver';
import type { PrepareRatioTierResult } from '../../ratioTier';
import type { LinearScale } from '../../scale';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Annotation } from '../../types/annotations';
import type { Id, Scenario } from '../../types/cell';
import type { Category, MarkerShape } from '../../types/data';
import type { LabelContent, LabelDensity, LabelKind } from '../../types/options';
import type { LineLabelModes } from './labelModes';
import type { AxisGeometry, Paint, PaintWarningRule, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { applyCategoryViewport } from '../../viewport';
import type { NormSer, NormTarget } from './context';
import type { AnomalyModel } from '../column/anomaly';
import type { FanPaintStep, FanResolved } from './fan';
import type { ForecastBoundary } from './forecast';
import type { EndpointLabelPlan } from './labels';
import type { BumpDerived, LineMarks } from './layout';
import type { LinePhaseResolved, RenderedLineMarks } from './marks';
import type { LineInterpolation, LineOptions } from './types';
import type { ReferenceBandColumn } from './referenceBands';
import type { LineTrend } from './trend';

export type LineVariant = 'line' | 'area' | 'stacked-area' | 'stacked100-area';
type LinePopulation = ReturnType<typeof applyCategoryViewport<NormSer>>;

/** What the options resolve to once, before any phase runs. */
export interface LineEnv {
  /**
   * Bump is a PRESET on this engine, not a fifth geometry: same polylines,
   * same run splitting, same label solver, a derived rank instead of the value
   * and an inverted y range. Every branch is guarded by this one flag so the
   * non-bump byte output is provably identical (byte-parity is a gate).
   */
  isBump: boolean;
  theme: Theme;
  /** The authored palette ramp when the theme knows it, else undefined. */
  paletteRamp: string[] | undefined;
  size: { width: number; height: number };
  measure: TextMeasurer;
  pctFmt: (p: number) => string;
  /** An authored { pct } cell keeps its own face; formatShare is for computed shares (column parity). */
  authoredPctFmt: (p: number) => string;
  highlights: Set<Id>;
  anyHighlight: boolean;
  density: LabelDensity;
}

type ValueSpec = ReturnType<typeof import('../../formatSpec').seriesRasterFormatter>;

/** Phase 1 output: the series, the plotted matrix, the presets that rewrite it and the value domain. */
export interface LineDomain {
  /** The options after the view window (annotations and subtitle). */
  options: LineOptions;
  cats: Category[];
  seriesNorm: NormSer[];
  dataSeries: NormSer[];
  refSeries: NormSer[];
  /**
   * The series actually DRAWN as lines. Band bounds keep their ids, their
   * values, their place in `data.series` and their contribution to the y
   * domain — they are simply not polylines, markers, endpoint labels or
   * palette consumers. Without a painting fan this is `dataSeries`.
   */
  drawnSeries: NormSer[];
  targets: NormTarget[];
  variant: LineVariant;
  isArea: boolean;
  isStacked: boolean;
  valueSpec: ValueSpec;
  fmt: (v: number) => string;
  interpolationFor: (s: NormSer) => LineInterpolation;
  /** Where the names print (after the key-row fallback) and which values print. */
  labelModes: LineLabelModes;
  /** The series that carry a direct label, where the author named a set. */
  labelOnly: ReadonlySet<Id> | undefined;
  bumpDerived: BumpDerived | undefined;
  /** Ranked entities `bump.focus` leaves undrawn: named in a note, kept in the records. */
  bumpOmitted: NormSer[];
  gapFillSeries: [NormSer, NormSer] | null;
  fan: FanResolved | null;
  phases: LinePhaseResolved | null;
  rebased: boolean;
  population: LinePopulation;
  /** Proportional category positions when the categories are unevenly spaced times, or the value positions of a continuous axis. */
  timeline: { positions: number[]; span: number } | undefined;
  /** The continuous x axis (options.xAxis): the model and the visible range. */
  x?: { model: import('./continuous').LineXModel; lo: number; hi: number; /** The x of each drawn category. */ shown: number[]; range?: import('./range').LineRange };
  trends: LineTrend[];
  /** The line sampled itself above the point budget (lineWindow); its crowded date ticks draw only under labels. */
  autoSampled: boolean;
  /** Values in plotted units (percent for stacked100-area, rank for bump, index under rebase100). */
  pv: (number | null)[][];
  /** Rounded display shares only. The plotted shares and stacks stay exact. */
  labelPv: (number | null)[][];
  shareTexts: Map<string, string>;
  roundingAdjustments?: import('../../shareRounding').RoundingAdjustment[];
  rowOf: Map<NormSer, number>;
  absOf: (s: NormSer, ci: number) => number | null;
  compositionInvalidAt: (ci: number) => boolean;
  nmCats100: Set<Id>;
  /** The n.m. categories whose shares add past 100%, not those whose parts mix signs. */
  overfullCats100: Set<Id>;
  naCats100: Set<Id>;
  /** stacked100-area categories with a missing part: shares of the known parts only, not printed. */
  sharesWithheld: Set<Id>;
  /** stacked-area categories whose missing parts are drawn as zero and disclosed. */
  incompleteStack: Category[];
  /** Rebase suppression, with the source base period kept through a viewport. */
  rebaseSuppressed: { id: Id; series: string; period: string; zero: boolean }[];
  /** Compact mode at its plot floor: the rebase note and a key row of its own give way; the left-out series' own key entry still names it. */
  rebaseCompact?: true;
  cumTop: number[][];
  cumBot: number[][];
  endpoints: Record<Id, { categoryId: Id; value: number }>;
  lastIdxOf: Map<Id, number>;
  dLo: number;
  dHi: number;
  domainExtendingValueLines: { id: Id; value: number }[];
  bumpLadderMax: number;
  /** The ticks of a drawn axis: an authored `valueAxis.tickStep` or the grid `axisGrid` picks; the domain spans them exactly. */
  stepTicks: number[] | undefined;
  /** Set when `axisGrid` drew the domain: the top the data reaches, whose label keeps its seat in the plot (plot.ts). */
  gridDataHi?: number;
  /** options.anomaly over the one drawn series: the model, the corridor bounds the axis reaches, the undrawn-bound note. */
  anomaly: LineAnomaly | undefined;
}

/** The anomaly rule on a line or on a combo's line, and what of it draws. */
export interface LineAnomaly {
  model: AnomalyModel;
  seriesId: Id;
  statFmt: (v: number) => string;
  corridorShown: { low: boolean; high: boolean };
  corridorNote: string;
}

/** Every paint decision, shared by legend, marks and labels. */
export type LineBandRule = Omit<Extract<PaintWarningRule, { kind: 'line-band-authored-contrast' }>, 'before'>;
export interface LinePaints {
  css(p: Paint): string;
  /** Authored strokes drawn darker to clear a shaded band, one per series. */
  bandRules(): LineBandRule[];
  seriesCrossesShadedBand(s: NormSer): boolean;
  series(s: NormSer, dataIdx: number): Paint;
  /** `forecast` asks for the hatched forecast region's fill. */
  areaFill(s: NormSer, dataIdx: number, forecast?: boolean): Paint;
  /** Whether the series draws its area fill: the stacked bands and a lone or lead area do, the other series of an unstacked area are lines. */
  areaFilled(s: NormSer): boolean;
  /** The paint of the series' key swatch and end-label swatch. */
  keyPaint(s: NormSer, dataIdx: number): Paint;
  lineWidthOf(s: NormSer): number;
  lineHollowOf(s: NormSer): boolean;
  ref(s: NormSer): Paint;
  dashOf(s: NormSer, dataIdx: number): number[] | undefined;
  legendDashOf(s: NormSer, dataIdx: number): number[] | undefined;
  markerOf(s: NormSer, dataIdx: number, ci: number): MarkerShape;
  hollowAt(s: NormSer, ci: number): boolean;
  pointScenario(s: NormSer, ci: number): Scenario | undefined;
  bumpPointState(row: (number | null)[], ci: number): { state: string } | Record<string, never>;
  heroMode: boolean;
  heroId: Id | null;
  fanLadder: FanPaintStep[];
  fanCentrePaint: Paint | null;
  fanPaints: boolean;
}

export type PrintsZero = (abs: number, authoredPct?: boolean, source?: NormSer) => boolean;

export type ComposeText = (
  content: LabelContent,
  abs: number | null,
  pct: number | null,
  catLabel: string,
  serLabel: string,
  unitSuffix?: string,
  authoredPct?: boolean,
  source?: NormSer,
  categoryId?: Id,
) => string;

/** The label-kind gates and the text composer every label path shares. */
export interface LineText {
  kindSetting(kind: LabelKind): boolean | LabelContent;
  contentOf(kind: LabelKind, dflt: LabelContent): LabelContent | null;
  composeText: ComposeText;
  /** The end-value set uses enough decimals to separate rounded ties. */
  composeEndText: ComposeText;
  /** Whether an absolute value is zero at the precision composeText prints it in, before the nonzero lift. */
  printsZero: PrintsZero;
  tickFont: FontSpec;
  /** Secondary text: value ticks, the AC | FC markers. */
  secondaryFont: FontSpec;
  labelFont: FontSpec;
  nameFont: FontSpec;
  labelH: number;
}

/** Phase 1, before the frame: what labels and annotations reserve around the plot. */
export interface LineReserves {
  endpoint: EndpointLabelPlan;
  /** Last values carried by the fallback key, shared by the key and point planners. */
  keyValues: ReadonlyMap<Id, string>;
  /** How far inside the plot the first and last category sit: a centred end value and the latest-point ring keep their air to the edge. */
  categoryEndRoom: { left: number; right: number };
  startLabels: ReturnType<typeof import('./bump').buildBumpStartLabels>['startLabels'];
  startReserve: number;
  /** The annotations the pass will draw: bump drops value arithmetic, stacked100-area adds its 100% indicator. */
  annList: Annotation[];
  /**
   * The end names start at the plot's right edge, not just past the line
   * ends: on a rank ladder, and where a band's end divider stands on that
   * edge, which a name inside the plot would cross.
   */
  namesAtPlotEdge: boolean;
  indicatorLeftReserve: number;
  indicatorRightReserve: number;
  /** options.referenceBands: the named column right of the plot and the margin it takes. */
  referenceBands: ReferenceBandColumn | undefined;
}

/** Phase 1 output, second half: the frame, the axis reserves, the category row, the plot rect and the scales. */
export interface LineArea {
  frame: FrameResult;
  margin: { top: number; right: number; bottom: number; left: number };
  leftMargin: number;
  axisShown: boolean;
  axisFmt: (v: number) => string;
  axisTickSpec: ValueSpec['spec'] | undefined;
  bumpTicks: number[] | undefined;
  disclosedTicks: number[] | undefined;
  /** The ticks of an authored `valueAxis.tickStep` or of `axisGrid`, when the axis is drawn. */
  stepTicks: number[] | undefined;
  discloseNonzeroBaseline: boolean;
  baselineValue: number;
  valueAxisReserve: number;
  ratioTier: PrepareRatioTierResult['tier'];
  categoryOverhang: number;
  catPlan: CategoryRowPlan;
  /** categoryAxis.dateTicks: the first category of every interval, each drawn as a tick under the plot. */
  intervalTicks?: boolean[];
  showCategoryTickRow: boolean;
  categoryTickReserve: number;
  /** Space below the baseline that clears the last value-axis tick. */
  categoryTickGap: number;
  categoryBandHeight: number;
  forecast: ForecastBoundary[];
  /** The "FC" row, directly above the plot top, or above the phase row when there is one; 0 when no boundary needs it. */
  forecastHeaderHeight: number;
  /** The header row sits inside the plot, under its top gridline (line.area); topPad then leaves it out. */
  forecastHeaderInPlot: boolean;
  /** The divider starts below the header rows, including headers inside a top-key plot. */
  forecastPlot: Rect;
  phaseHeaderHeight: number;
  /** The value-axis title, drawn at the top of the head band. */
  axisTitle: ValueAxisTitle | undefined;
  /** The part of topPad the title takes; the furniture under it starts that much lower. 0 when it shares the FC row. */
  axisTitleBand: number;
  /** The top of the value-axis title: in its own row at the top of the head band, or in the FC row. */
  axisTitleY: number;
  topPad: number;
  plot: Rect;
  y: LinearScale;
  xOf: (ci: number) => number;
  /** A continuous axis: its tick row and the pixel x of an x value. */
  xTicks?: import('./xTicks').XTickPlan;
  xOfValue?: (x: number) => number;
  step: number;
  categoryOrder: Map<Id, number>;
}

/** Phase 2 output. */
export interface LineMarkGeometry {
  /** The whole scene so far, frame nodes first: the mark helpers splice by index into it. */
  nodes: SceneNode[];
  /** The phase's own index: every rect it claimed, in claim order. */
  claims: OccupiedIndex;
  axes: AxisGeometry[];
  rendered: RenderedLineMarks;
  marks: LineMarks;
  paintWarningRules: PaintWarningRule[];
  /** Requests the mark helpers raise as they draw: forecast headers, phase names, target values. */
  headerRequests: LabelRequest[];
  phaseRequests: LabelRequest[];
  targetRequests: LabelRequest[];
  phaseDerived: ReturnType<typeof import('./marks').renderPhaseFills>;
  targetLabelIds: Set<Id>;
  baseY: number;
  meanValue: number | undefined;
  meanValueFor: ReturnType<typeof import('./means').lineMeans>['meanValueFor'];
}
