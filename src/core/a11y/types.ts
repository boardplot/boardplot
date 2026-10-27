import type { RenderTarget } from '../types/options';
import type { Rect } from '../geometry';
import type { OwnerRef, Scenario } from '../types/cell';

/** Host-assigned chart identity; panel identifies a nested chart. */
export interface InteractionScope { chart: string; panel?: string }
export interface InteractionTarget extends InteractionScope { owner: OwnerRef }

type InteractionValueState = 'value' | 'missing' | 'na' | 'nm' | 'suppressed' | 'unavailable';
/** Raw source units are retained, including percent cells expressed as 0–100. */
export interface InteractionValue {
  kind: 'number' | 'text' | 'date';
  raw: number | string | null;
  state: InteractionValueState;
  unit?: string;
  /** `unit` names the scale of `displayed` ("M" hoisted into a table head), not of `raw`: raw text drops its magnitude. */
  scaledUnit?: true;
  format?: string;
  /** Target for the shared default currency precision; raw values stay exact. */
  renderTarget?: RenderTarget;
  /** Explains a missing, withheld, incompatible or undefined value. */
  reason?: string;
  displayed?: string;
  /**
   * A number the engine computed rather than one the author wrote: a share
   * or change ('percent', two decimals as the hover card prints a share),
   * or a sum, level or effect ('number', at most two decimals). Authored
   * values carry no mark and print at their own precision.
   */
  derived?: 'percent' | 'number';
}

/** An event of the event lane: when and where it sits, its kind, and every item it holds in full. */
export interface InteractionEvent {
  /** The authored ISO date of a dated event. */
  date?: string;
  /** The date as the reader reads it, with the year. */
  dateText?: string;
  /** The label of the category an `at` event sits on. */
  place?: string;
  group?: string;
  /** The event's own title and detail first, then each further item. */
  items: { title: string; detail: string[] }[];
}

export interface InteractionComparison {
  label: string;
  scenario?: Scenario;
  current: InteractionValue;
  reference: InteractionValue;
  delta: InteractionValue;
  percent: InteractionValue;
  target?: InteractionTarget;
}

export interface InteractionRecord {
  /** Stable serialization of scope and semantic owner, independent of order. */
  id: string;
  target: InteractionTarget;
  label: string;
  /**
   * Source category display text, kept apart from `label`. Shared hover
   * matches this EXACT string and never parses `label`, which composes
   * category and series text and may contain either one's separators.
   */
  categoryLabel?: string;
  /** Source series display text, kept apart from `label` for multi-series cards. */
  seriesLabel?: string;
  value: InteractionValue;
  /** The value's name where it is one statistic of several, such as a box's 'Median'. */
  valueLabel?: string;
  scenario?: Scenario;
  /** Additional typed facts such as x/y, interval endpoints or sample size. */
  fields: { key: string; label: string; value: InteractionValue }[];
  comparisons: InteractionComparison[];
  share?: { numerator: InteractionValue; denominator: InteractionValue; percent: InteractionValue };
  rank?: { value: number; of: number; policy: 'competition' | 'display-order'; direction: 'asc' | 'desc' };
  /** Source owners of an aggregate, never its display position. */
  members?: OwnerRef[];
  annotations: { id: string; text: string }[];
  claimIds: string[];
  nodeIds: string[];
  /** Explicit geometry for marks with no individual SVG node, such as vertices. */
  anchor?: { x: number; y: number } | Rect;
  /**
   * The keys of the fields the hover card shows, in place of its title and
   * value: the facts the mark does not print. An empty list opens no card and
   * draws no outline; the record stays in the data table. Absent: the full card.
   */
  cardFields?: string[];
  /** Set on the record of an event of the event lane: the hover card lists its items. */
  event?: InteractionEvent;
}
