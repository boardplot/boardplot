/**
 * The structs the mekko layout phases hand to each other. Each phase
 * is a function from the structs before it to one new struct, plus the run's
 * warnings log, which a phase only appends to. No phase touches the run's
 * OccupiedIndex: a phase that claims space claims into a fresh index of its
 * own, and `layoutMekko` commits it, in claim order, before the solver runs.
 */

import type { ValueAxisTitle } from '../../axis';
import type { RoundingAdjustment } from '../../shareRounding';
import type { FrameResult } from '../../frame';
import type { Rect } from '../../geometry';
import type { CategoryRowPlan } from '../../label/categoryRow';
import type { OccupiedIndex } from '../../label/occupied';
import type { LinearScale } from '../../scale';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Id, Scenario } from '../../types/cell';
import type { Category } from '../../types/data';
import type { LabelDensity, MekkoOptions, ValueAxisOptions } from '../../types/options';
import type { AxisGeometry, Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { MekkoMarks } from './layout';

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
  scenario?: Scenario;
  colorRole?: string;
  fill?: string;
  unit?: string;
  format?: string;
  vals: NormVal[];
}

/** What the options resolve to once, before any phase runs. */
export interface MekkoEnv {
  options: MekkoOptions;
  theme: Theme;
  /** The authored palette when the theme knows it, else undefined. */
  palette: string | undefined;
  size: { width: number; height: number };
  measure: TextMeasurer;
  fmt: (v: number) => string;
  /** A column total: `fmt`, with the digits a nonzero total needs to stay off 0. */
  totalFmt: (v: number) => string;
  /** A column width from the width series: the plain number format, never `options.format`, which is the plotted measure's. */
  widthFmt: (v: number) => string;
  pctFmt: (p: number) => string;
  authoredPctFmt: (p: number) => string;
  highlights: ReadonlySet<Id>;
  density: LabelDensity;
  va: ValueAxisOptions;
  /** Percent mode with no authored legend: the widest column names each series in its segment labels, and the chart draws no legend. */
  namesInPlace?: boolean;
}

/** Phase 1 output: categories in their final order, the plotted series, stacks, widths and the value domain. */
export interface MekkoDomain {
  mode: 'percent' | 'unit' | 'bar';
  cats: Category[];
  series: NormSer[];
  widthSer: NormSer | null;
  othersId: Id | null;
  /** The names the Others column pools, in their order. */
  othersMembers: string[];
  /** Percent mode: categories whose composition is not meaningful (negative parts) or not available (no basis). */
  nm: Set<Id>;
  na: Set<Id>;
  /** Columns with a missing part: no total, no shares of the known parts. */
  incomplete: Set<Id>;
  /** Percent columns of authored shares with no amount (no total100, no number cell): no total prints. */
  wholeUnknown: Set<Id>;
  /** Per category, series indices top to bottom. */
  order: number[][];
  columnTotals: Record<Id, number>;
  /** Columns of shares only: no amount, so no total prints. */
  unknownTotals: Set<Id>;
  posTop: number[];
  negBot: number[];
  anyByCat: boolean[];
  weights: number[];
  totalWeight: number;
  shares: Record<Id, Record<Id, number>>;
  dLo: number;
  dHi: number;
  /** Width-weighted mean of the plotted totals (valueLine 'mean'). */
  meanValue: number | undefined;
  validCount: number;
  plottedAt(s: NormSer, ci: number): number | null;
  absAt(s: NormSer, ci: number): number | null;
  invalidAt(ci: number): boolean;
  /** rounding 'sum-consistent': the printed share per `categoryId\0seriesId`. */
  shareTexts: ReadonlyMap<string, string>;
  /** rounding 'sum-consistent': the shares moved off their nearest rounding. */
  roundingAdjustments?: RoundingAdjustment[];
}

export type CellPattern = 'hatch45' | 'outline' | undefined;

/** One paint decision per series and cell, shared by marks, legend and labels. */
export interface MekkoPaints {
  css(p: Paint): string;
  base(s: NormSer, dataIdx: number): Paint;
  cell(s: NormSer, val: NormVal, cat: Category, dataIdx: number, v: number): Paint;
  pattern(s: NormSer, val: NormVal): CellPattern;
  /** What the viewer SEES inside a cell: auto-ink contrasts against this. */
  inside(s: NormSer, val: NormVal, cat: Category, dataIdx: number, v: number): string;
}

/** Phase 1 output, second half: the plot rect, the column edges and the value scale. */
export interface MekkoArea {
  frame: FrameResult;
  plot: Rect;
  y: LinearScale;
  y0: number;
  tickFont: FontSpec;
  labelFont: FontSpec;
  strongFont: FontSpec;
  totalH: number;
  catsOnTop: boolean;
  showCats: boolean;
  showTotals: boolean;
  showAxis: boolean;
  axisFmt: (v: number) => string;
  xEdge: number[];
  dateNumericTicks: boolean;
  catPlan: CategoryRowPlan;
  categoryTickReserve: number;
  /** Top of the category row under the plot (unit and bar mode): under the lowest column and its hanging total. */
  catRowY: number;
  topPad: number;
  /** The rect the plot floor measures: the plot and, in unit mode, the totals' headroom over it. */
  floorPlot: Rect;
  /** The authored value-axis title and the head band it adds to topPad. */
  axisTitle: ValueAxisTitle | undefined;
  axisTitleBand: number;
  /** Per column, its width-series value as a line under its name; absent without a width series. */
  widthTexts: string[] | undefined;
  widthLineH: number;
  /** The width measure's name and unit, printed once under the category row. */
  widthTitle?: { text: string; y: number };
  /** Columns too narrow for their name in place; the note names them left to right. */
  unnamed: number[];
  /** Where names go when the row could not centre them all (plot.ts packNames): unit and bar on a second tier under the plot; percent, a name too wide for its column on a second tier over the heads. */
  namePack?: { left: number[]; row: number[]; width: number[] };
  /** The column whose segment labels name their series (env.namesInPlace), or -1. */
  namedCol: number;
  /** Width of the gutter right of the plot that holds the last column's shares when that column is too narrow for them, or 0. */
  gutter: number;
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
export interface MekkoMarkGeometry {
  /** In paint order, after the frame's own nodes. */
  nodes: SceneNode[];
  /** The phase's own index: every rect it claimed, in claim order. */
  claims: OccupiedIndex;
  axes: AxisGeometry[];
  marks: MekkoMarks;
  /** Plotted stack edges per (seriesId, categoryId), in value units. */
  segEdges: Map<string, { top: number; bot: number; v: number; abs: number | null }>;
  segments: SegmentPlace[];
  widths: Record<Id, number>;
}

export const colX = (area: MekkoArea, ci: number) => area.xEdge[ci]!;
export const colW = (area: MekkoArea, ci: number) => area.xEdge[ci + 1]! - area.xEdge[ci]!;
export const colCx = (area: MekkoArea, ci: number) => (area.xEdge[ci]! + area.xEdge[ci + 1]!) / 2;
