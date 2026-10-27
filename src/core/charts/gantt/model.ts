/**
 * The structs the gantt layout phases hand to each other. Each phase
 * is a function from the structs before it to one new struct, plus the run's
 * warnings log, which a phase only appends to. No phase touches the run's
 * OccupiedIndex: a phase that claims space claims into a fresh index of its
 * own, and `layoutGantt` commits it, in claim order, before the solver runs.
 */

import type { Rect, Size } from '../../geometry';
import type { LabelRequest } from '../../label/solver';
import type { FontSpec, TextMeasurer, TextSize } from '../../text';
import type { Annotation, EventTone } from '../../types/annotations';
import type { Id, OwnerRef } from '../../types/cell';
import type { GanttCell, GanttItem } from '../../types/data';
import type { LabelKind } from '../../types/options';
import type { Paint } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { Tier } from './calendar';
import type { GanttGranularity, GanttOptions } from './layout';

export interface NormItem {
  id: Id;
  rowId: Id;
  kind: GanttItem['kind'];
  startDay: number;
  endDay: number; // exclusive
  label?: string;
  colorRole?: string;
  colorLabel?: string;
  /** A bar's or chevron's row status tone (own or inherited); the paint when no colorRole is set. */
  tone?: GanttCell['tone'];
  /** A shared milestone: drawn in the shared milestone row, identified by its authored row. */
  shared: boolean;
  anchor?: { toItemId: Id; edge: 'start' | 'end'; offsetDays: number };
  path: string;
}

export interface NormRow {
  id: Id;
  label: string;
  kind: 'task' | 'cadence';
  indent: number;
  cols: { text: string; tone?: GanttCell['tone'] }[];
  items: NormItem[];
  /** The shared milestone row the layout appends below the activities: no name, no columns. */
  shared?: true;
  cadence?: {
    events: { id: Id; day: number }[];
    marker: 'diamond' | 'triangle';
    colorRole?: string;
  };
}

export type GanttEventAnnotation = Extract<Annotation, { kind: 'event' }>;

/** The air an event rule and the today line keep left and right of a label, in px; a rule nearer than that breaks around the label. */
export const RULE_LABEL_GAP = { eventRule: 4, todayLine: 6 } as const;

export interface GanttEvent {
  id: Id;
  day: number;
  /** Where the rule draws, in days: the start edge of `day`, or the middle of it for a milestone or cadence marker, so the rule runs through the marker. */
  ruleDay: number;
  label: string;
  /** Gantt paints 'bad' and draws every other tone neutral. */
  tone?: EventTone;
  priority?: number;
  annotation: GanttEventAnnotation;
}

interface GanttFonts {
  tick: FontSpec;
  headerMajor: FontSpec;
  label: FontSpec;
  strong: FontSpec;
}

/** What the options resolve to once, before any phase runs. */
export interface GanttEnv {
  options: GanttOptions;
  theme: Theme;
  surface: { rowTint: number; elapsedTint: number };
  size: Size;
  lang: string | undefined;
  measure: TextMeasurer;
  highlights: ReadonlySet<Id>;
  labelOn: (kind: LabelKind) => boolean;
  fonts: GanttFonts;
}

/** A milestone's label text, measured before layout because it sizes rows and the lane. */
export interface MilestoneLabel {
  item: NormItem;
  rowIndex: number;
  text: string;
  size: TextSize;
}

export interface MilestonePlan {
  byId: Map<Id, MilestoneLabel>;
  /** Nearby milestones in the same or adjacent rows, sharing label lanes. */
  clusters: MilestoneLabel[][];
  /** Milestones whose label may take the shared lane right of the timeline. */
  laneIds: Set<Id>;
  laneLabelW: number;
  clusterRowH: number;
  /** Open height: the lane height a row with stacked milestone flags needs. Other rows keep the common pitch. */
  flagPitch: Map<Id, number>;
}

/** Phase 1 output: rows, the calendar domain, today, events and the milestone label plan. */
export interface GanttDomain {
  rows: NormRow[];
  granularity: GanttGranularity;
  tier: Tier;
  d0Day: number;
  d1Day: number;
  majorStarts: Date[];
  minorStarts: Date[];
  todayDay: number | null;
  events: GanttEvent[];
  eventBadgeMode: boolean;
  eventFootnotes: string[];
  itemLabelNotes: string[];
  milestones: MilestonePlan;
}

/** Phase 1 output, vertical: marker strip, two header tiers and the rows. */
export interface GanttBand {
  headerRowH: number;
  headerH: number;
  markerLabelH: number;
  markerStrip: number;
  headerTop: number;
  rowsTop: number;
  bodyH: number;
  /** A row's lane height: the whole row in the table form, the part under the name line when stacked. */
  rowH: number;
  /** Each row's lane height: rowH, or more for a row with stacked milestone flags. */
  rowHs: number[];
  rowsBottom: number;
  /** Row tops, one per row and one for the bottom edge. */
  rowY: number[];
  /**
   * Stacked form (narrow canvases): each row prints its name and its metadata
   * cells on a line of their own above its lane, and the timeline takes the
   * full plot width. The table form keeps them in columns left of the timeline.
   */
  stacked: boolean;
  /** Height of a stacked row's name line; 0 in the table form and for the shared milestone row. */
  nameLineH: number;
  /** Stacked: the shared milestone row has a label line too, because a shared milestone's label has no seat beside its diamond. */
  sharedLine: boolean;
  /** Height of the stacked column-header strip between the calendar head and the first row. */
  colHeaderH: number;
  /** The widest stacked name line (name, gap, cells), for the width floor; 0 in the table form. */
  stackedLineW: number;
  /** The rows' height at their natural pitch: what the canvas grows to when its height is open. */
  naturalRowsH: number;
}

export interface RowLabel {
  lines: string[];
  w: number;
  h: number;
  indentPx: number;
  font: FontSpec;
  baseFont: FontSpec;
  title?: string;
}

export interface MetadataColumns {
  colTexts: { text: string; title?: string; tone?: GanttCell['tone'] }[][];
  colWs: number[];
  colXs: number[];
  headerRequests: LabelRequest[];
}

/** Phase 1 output, horizontal: the left band, the timeline scale and the milestone lane. */
export interface GanttBody {
  /** The plot rect the frame left. */
  inner: Rect;
  /** The timeline: body columns, from the header top to the last row. */
  plot: Rect;
  rowLabels: RowLabel[];
  labelBandW: number;
  /** Complete row names, wrapped at word boundaries to at most two lines. */
  minimumLabelBandW: number;
  columns: MetadataColumns;
  bodyX: number;
  bodyW: number;
  laneGap: number;
  laneEnabled: boolean;
  laneX: number;
  x: (day: number) => number;
  /** Event and today rules a span label slides around; `gap` is the air the rule keeps beside a label it breaks for. */
  ruleClaims: { x: number; halfWidth: number; gap: number }[];
  clusteredLabelY: Map<Id, number>;
}

export interface GanttPaints {
  item(it: NormItem): Paint;
  css(p: Paint): string;
  /** What a row's marks are painted on, as a colour and as a paint. */
  rowBacking(rowId: Id): string;
  rowBackingPaint(rowId: Id): Paint;
}

/** Where phase 2 drew one item: what the label phase reads. */
export interface ItemPlace {
  it: NormItem;
  owner: OwnerRef;
  rect: Rect;
  xs: number;
  xe: number;
  /** Milestone centre and radius. */
  cx: number;
  rr: number;
  /** Bracket arm top and height. */
  yT: number;
  armH: number;
}

export interface RowPlace {
  row: NormRow;
  index: number;
  cy: number;
  items: ItemPlace[];
}

/** Where a row's lane starts: under its name line when stacked (the shared milestone row has none). */
export function laneTop(band: GanttBand, rows: readonly NormRow[], index: number): number {
  return band.rowY[index]! + (rows[index]?.shared && !band.sharedLine ? 0 : band.nameLineH);
}

/** Internal option: lay the chart out without the milestone lane (layout.ts gives an unused lane back to the timeline). */
export const NO_LANE = Symbol('ganttNoLane');
