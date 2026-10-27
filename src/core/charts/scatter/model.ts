/**
 * The structs the scatter layout phases hand to each other. Each phase
 * is a function from the structs before it to one new struct, plus the run's
 * warnings log, which a phase only appends to. No phase touches the run's
 * OccupiedIndex: a phase that claims space claims into a fresh index of its
 * own, and `layoutScatter` commits that index's snapshot, in claim order,
 * before the label solver reads the run's index.
 */

import { chartString } from '../../strings/scatter';
import type { NumberFormatSpec } from '../../formatSpec';
import type { Rect, Size } from '../../geometry';
import type { LinearScale } from '../../scale';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Annotation } from '../../types/annotations';
import type { Id, Scenario } from '../../types/cell';
import type { MarkerShape } from '../../types/data';
import type { ScatterValueAxisOptions } from '../../types/options';
import type { Paint } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { ScatterClampPlan, ScatterClipRecord, ScatterDropRecord } from './clamp';
import type { LogAxes } from './logAxis';
import type { FrontierPlan } from './frontier';
import type { TrendFit } from './trend';
import type { ScatterStrategyOptions, StrategyZoneMark, StrategyZonesDerived } from './types';

export interface ScatterMarks {
  /**
   * Input order (not draw order). nodeId absent for marker:'none' points.
   * `cx`/`cy` are where the mark is DRAWN: on a clipped point that is the axis
   * edge, and `clipped` says so. The value it was drawn from stays in
   * `derived.clipped` and in the point's own display record.
   */
  points: { id: Id; cx: number; cy: number; r: number; nodeId?: Id; clipped?: true }[];
  /** Authored strategy regions/cells, behind the point marks. */
  zones?: StrategyZoneMark[];
}

export interface ScatterDerived {
  xExtent: [number, number];
  yExtent: [number, number];
  /** Bubble mode only: the size value that maps to the maximum radius. */
  sizeMax?: number;
  /** Present only when `options.quadrants` resolved to two usable cut points. */
  quadrants?: QuadrantDerived;
  /** Present only for the authored strategy-zone extension. */
  zones?: StrategyZonesDerived;
  /** One record per clamp bound that moved points to an edge. */
  clipped?: ScatterClipRecord[];
  /** Present only when options.minCount removed points. */
  dropped?: ScatterDropRecord;
  /** One ordinary least squares fit per drawn trend line (options.trend); its sums are the claim receipt. */
  trends?: TrendFit[];
  /** The Pareto line (options.frontier): which end is better on each axis and the point ids it runs through. */
  frontier?: FrontierPlan;
}

/** Reading order of the four boxes: top-left, top-right, bottom-left, bottom-right. */
export type QuadrantBox = 'tl' | 'tr' | 'bl' | 'br';
export const QUADRANT_BOXES: QuadrantBox[] = ['tl', 'tr', 'bl', 'br'];
export const QUADRANT_BOX_NAME: Record<QuadrantBox, string> = {
  tl: 'top-left',
  tr: 'top-right',
  bl: 'bottom-left',
  br: 'bottom-right',
};

export interface QuadrantDerived {
  /** The cut points actually used, whatever their provenance. */
  x: number;
  y: number;
  /**
   * The single spelling of each cut point that the exhibit is allowed to
   * print — divider tag, method footnote, warnings and the claim receipt all
   * read it from here. It is produced together with `x` / `y` by one
   * disclosure step, so the printed boundary IS the applied boundary: there is
   * no second formatting path that could round it somewhere else.
   */
  xText: string;
  yText: string;
  xSource: 'declared' | 'median' | 'mean';
  ySource: 'declared' | 'median' | 'mean';
  counts: Record<QuadrantBox, number>;
  assignment: Record<Id, QuadrantBox>;
}

export interface NormPt {
  id: Id;
  group?: Id;
  label: string;
  x: number;
  y: number;
  yIsPct?: true;
  size: number | null;
  /** The data gave a size that is not a non-negative number; it is read as 0. */
  sizeInvalid?: true;
  fill?: string;
  marker: MarkerShape;
  scenario?: Scenario;
  /** Observations behind the point; null when the data states none. */
  count: number | null;
  /** Input index — stable tie-break for draw order. */
  idx: number;
}

export interface NormGroup {
  id: Id;
  label: string;
  colorRole?: string;
  marker?: MarkerShape;
  /** Slot in the categorical ramp (declared groups first, then implicit). */
  idx: number;
}

/** A boundary printed so the printed number denotes the applied one. */
export interface Disclosed {
  value: number;
  text: string;
  exact: boolean;
}

/** What the options resolve to once, before any phase runs. */
export interface ScatterEnv {
  options: ScatterStrategyOptions;
  /**
   * Which bubble values a layout prints: 0 every value,
   * 1 only the values that fit inside their bubble, 2 none. A layout that
   * loses a point name steps up, so names keep their seats before values do.
   */
  valueTier?: 0 | 1 | 2;
  /**
   * Points whose value prints only inside their bubble, at any tier: a value
   * beside the name cost a name its seat. A value left off the
   * plot is named in the page note.
   */
  valueInsideOnly?: ReadonlySet<Id>;
  /**
   * Callouts that print as a bold second line under their point's name: point
   * id to the callout text. The annotation pass does not see these, so no
   * leader runs from a far seat.
   */
  callouts?: ReadonlyMap<Id, string>;
  /** The callout lines wrap to the name's width (a narrow plot). */
  calloutWrap?: boolean;
  theme: Theme;
  /** The authored palette when the theme knows it, else undefined. */
  palette: string | undefined;
  size: Size;
  measure: TextMeasurer;
  /** The chart format: bubble sizes, and both axes unless axisFormat names one. */
  fmt: (value: number) => string;
  /** Each axis's format: options.axisFormat, else the chart format. */
  axisFmt: { x: (value: number) => string; y: (value: number) => string };
  /**
   * Each axis's format as a spec: options.axisFormat, else format, else a
   * plain number. Linear ticks raster over it (tickFormatter), log ticks take
   * the decimals each needs ("$5", "$0.4"), cut points disclose in it.
   */
  axisSpec: { x: NumberFormatSpec; y: NumberFormatSpec };
  discloseCut: (raw: number, axis: 'x' | 'y') => Disclosed;
  discloseCount: (raw: number) => Disclosed;
  highlights: ReadonlySet<Id>;
  va: ScatterValueAxisOptions;
  /** The axes valueAxis.log puts on a log10 scale. */
  log: LogAxes;
}

/** Phase 1 output for the 2x2: the cut points and what they did to the exhibit. */
export interface QuadrantPlan {
  derived?: QuadrantDerived;
  /** Engine-authored method notes; printed only with `methodNote: true`. */
  notes: string[];
  /** Boxes with no plot area (a cut point off-domain) — captions are refused there. */
  voidBoxes: ReadonlySet<QuadrantBox>;
  drawX: boolean;
  drawY: boolean;
}

/** Phase 1 output: the plotted points and both axis domains. */
export interface ScatterDomain {
  pts: NormPt[];
  groups: ReadonlyMap<Id, NormGroup>;
  /** Groups with at least one plotted point, in declaration order. */
  shownGroups: NormGroup[];
  dropped?: ScatterDropRecord;
  /** The disclosures of points not drawn (the minCount drop, points with no x or y); the key names them when they do not print. */
  omitted: string[];
  clamp?: ScatterClampPlan;
  meanY: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  bubbleMode: boolean;
  sizeMax?: number;
  dx: [number, number];
  dy: [number, number];
  /** The ticks of a plain dot scatter, whose axes end on them. */
  ticks?: { x: number[]; y: number[] };
  /** The strategy grid axes cut evenly, drawn as equal cells (scatter.matrix). */
  evenGrid?: { x: boolean; y: boolean };
  /** The annotations left after the vertical view window. */
  annotations: Annotation[];
  baselineNotes: string[];
  derivedNotes: string[];
  quadrants: QuadrantPlan;
  /** The trend fits options.trend asked for, over the drawn points. */
  trends: TrendFit[];
  /** The Pareto line options.frontier asked for, over the drawn points. */
  frontier?: FrontierPlan;
}

/** One paint decision per point and group, shared by marks, legend and labels. */
export interface ScatterPaints {
  group(gid: Id | undefined): Paint;
  point(p: NormPt): Paint;
  /** Circles cannot hatch — PL and FC both render hollow (outline in group color). */
  hollow(p: NormPt): boolean;
  insideFill(p: NormPt): string;
  /** The point is named by options.highlight, itself or through its group; it takes a ring. */
  highlighted(p: NormPt): boolean;
  /** The ring and its key: the focus where it reads apart from every point colour, else the ink. */
  ring: Paint;
}

export interface ScatterFonts {
  tick: FontSpec;
  label: FontSpec;
  caption: FontSpec;
  axisTitle: FontSpec;
}

/** Phase 1 output, second half: the plot rect and the scales over it. */
export interface ScatterPlotArea {
  plot: Rect;
  /** The plot rect the frame left, before axis columns and title bands. */
  inner: Rect;
  fonts: ScatterFonts;
  showAxes: boolean;
  /** options.qualitativeAxes: ends and arrows instead of ticks; the y title sits in the axis column. */
  qualitative: boolean;
  axisTitles: { x?: string; y?: string };
  xAxisH: number;
  yAxisW: number;
  xBandH: number;
  yBandW: number;
  /** The x and y band labels of a strategy grid, as wrapped (scatter.matrix). */
  xBandLines?: string[][];
  yBandLines?: string[][];
  x: LinearScale;
  y: LinearScale;
  radiusOf: (p: Pick<NormPt, 'size'>) => number;
}

export function quadrantBoxName(box: QuadrantBox, options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>): string {
  return chartString(options, ({ tl: 'topLeft', tr: 'topRight', bl: 'bottomLeft', br: 'bottomRight' } as const)[box]);
}
