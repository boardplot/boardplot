/** Annotations: semantic, data-bound, collision-managed. */

import type { IconName } from '../icons';
import type { Direction, Id, Scenario } from './cell';

/**
 * Optional circled glyph chip on note/callout annotations. `icon` and
 * `status` are mutually exclusive — the schema refuses both together — and
 * the union here makes that unrepresentable in TypeScript too.
 */
export type AnnotationGlyphSlot =
  | { icon?: IconName; status?: never }
  | { status?: 'good' | 'bad' | 'warn' | 'info'; icon?: never };

export type AnchorRef<X extends string | number = Id> =
  | X // category/item id, or a continuous x value
  | { categoryId: X; seriesId?: Id; segmentId?: Id; edge?: 'start' | 'end' | 'total' }
  | { pointId: Id } // scatter
  | { valueLineId: Id }; // diff arrows may anchor to value lines

export interface AnnotationBase {
  id?: Id; // default: `${kind}-${n}` in authored order
  text?: string; // replaces auto text; `${value}` remains a live field
  /** Number format: annotation > anchored series > chart; diff reads to, then from. Rates keep percent units. */
  format?: string;
  priority?: number;
}

export type Annotation<X extends string | number = Id> =
  | (AnnotationBase & {
      kind: 'diff';
      from: AnchorRef<X>;
      to: AnchorRef<X>;
      // 'pctOf100' is not in the advertised union: it is not implemented, and
      // every non-relative mode would fall into the absolute branch, drawing
      // the raw difference as if it were percentage points. The schema and the annotate pass refuse it by name.
      mode?: 'relative' | 'absolute' | 'reversed'; // default 'relative'
    } & GapPlacement)
  | (AnnotationBase & {
      kind: 'cagr';
      from?: AnchorRef<X>; // default: first total (waterfall) / first category
      to?: AnchorRef<X>; // default: last total / last category
      suffix?: string; // default 'p.a.'
      /** Print the period before the rate ("2014–2019: +5.8% p.a."); default true when the chart carries several CAGRs, except on an 'arrow'. */
      period?: boolean;
      /** 'bracket' (default) runs over the marks; 'arrow' is one straight arrow with the rate in an oval on it. */
      shape?: 'bracket' | 'arrow';
    })
  | (AnnotationBase & {
      /**
       * A bracket over the steps `from` to `to` (inclusive) of a bridge. The engine adds up the
       * steps and prints the sum, after `label` when one is given: "Commercial +81". Brackets
       * over one chart stand in one row above the steps.
       */
      kind: 'bracket';
      from: X;
      to: X;
      label?: string;
    })
  | (AnnotationBase & { kind: 'delta'; at: AnchorRef<X>; vs: AnchorRef<X> | number } & GapPlacement)
  | (AnnotationBase & { kind: 'abs'; at: AnchorRef<X> }) // true-value flag (outlier marker)
  | (AnnotationBase & { kind: 'note'; at: AnchorRef<X>; text: string } & AnnotationGlyphSlot)
  | (AnnotationBase & {
      kind: 'callout';
      at: AnchorRef<X>;
      text: string;
      preferSide?: 'left' | 'right' | 'above' | 'below';
      /** A bold first line over the text, which then prints plain; `${value}` in it prints the anchored value. */
      headline?: string;
      /** A thin arrow from the text to the anchored point; the text sits level with the point where it can. */
      arrow?: boolean;
    } & AnnotationGlyphSlot)
  | (Omit<AnnotationBase, 'text'> & {
      kind: 'valueLine';
      /** Refused: a valueLine prints `label`. */
      text?: never;
      /** Numeric value and tolerance are fractions; multiply by 100 before layout. Independent of data.valueKind. */
      valueKind?: 'fraction';
      value?: number | 'mean'; // default 'mean'; weighted mean on mekko
      /**
       * Which series the computed 'mean' is measured over (line charts;
       * default: the first drawn data series). Scoping fields are refused
       * with an authored numeric `value` — the engine measures the mean from
       * series cells so the claim stays derivable.
       */
      seriesId?: Id;
      /** Inclusive category span the 'mean' is measured over; both or neither, like band. */
      from?: X;
      to?: X;
      label?: string | false;
      side?: 'left' | 'right';
      /**
       * Which value scale `value` is expressed in. 'secondary' requires an
       * acknowledged secondary axis (combo); a chart without one WARNS
       * `valueline-axis-unsupported` and draws nothing — never a silent
       * no-op. Used by the pareto threshold, which lives
       * in cumulative-share percent, not in count units.
       */
      axis?: 'primary' | 'secondary';
      /**
       * Value-axis tolerance band around the line. A positive number is ± that
       * amount; {low, high} is an authored corridor in the same units as value.
       */
      tolerance?: number | { low: number; high: number };
      /**
       * Shade each category between the resolved actual and this line's value.
       * seriesId selects a series; omission uses the category total. Missing
       * cells are skipped.
       */
      attainment?: boolean | { seriesId?: Id; direction?: Direction };
    })
  | (Omit<AnnotationBase, 'text'> & { kind: 'indicator100'; side?: 'left' | 'right'; /** Refused: it prints a fixed '100%'. */ text?: never })
  | (AnnotationBase & {
      /**
       * Inclusive category span as a shade or bracket, or a value-axis plan
       * corridor / tolerance / attainment band. Era bands keep from/to as
       * category ids. Corridor and tolerance use low/high on the value scale.
       * Attainment shades each category between the resolved actual and value.
       */
      kind: 'band';
      from?: X;
      to?: X;
      label?: string;
      tone?: 'neutral' | 'muted';
      style?: 'shade' | 'bracket' | 'corridor' | 'tolerance' | 'attainment';
      divider?: false | 'start' | 'end' | 'both';
      low?: number;
      high?: number;
      value?: number;
      seriesId?: Id;
      scenario?: Scenario;
      direction?: Direction;
    })
  | (AnnotationBase & EventAnchor<X> & {
      /**
       * A dated event (a stock-out, a launch, a price change). Column, combo
       * and line draw it in the event lane above the plot: a block with the
       * group, the date, the title and the detail, and a thin pole down to
       * the data. An event that does not fit moves to the numbered event key
       * below the plot and keeps a numbered marker on its pole. Gantt draws
       * its own event rules and reads `at` and `label` only.
       */
      kind: 'event';
      /** Title, at most two lines after wrapping; never cut. */
      label: string;
      /** Authored detail lines under the title; at most three lines inline, never cut. */
      detail?: string | string[];
      /**
       * More changes on the same date, after this event's own label and
       * detail. The lane draws a compact "+N" after the title; the hover
       * card, the SVG `<title>`, the description and the interaction records
       * list every item with its detail. Column, combo and line only; Gantt refuses it.
       */
      items?: EventItem[];
      /** Id of a group in `options.events.groups`, which carries the kind label, tone and glyph. */
      group?: Id;
      /** Overrides the group tone. */
      tone?: EventTone;
      /** 'key' sends this event to the numbered key; 'auto' (default) lets the lane decide. */
      placement?: 'auto' | 'key';
      /**
       * Line charts: 'inline' sets the block beside the rule inside the plot.
       * Gantt: 'badge' draws the label, at most 3 characters, in a filled
       * circle at the top of the rule, with no footnote key.
       */
      labelPlacement?: 'top' | 'inline' | 'badge';
    });

/**
 * Where a delta or diff between two series at the last category stands
 * (line). 'bracket' draws the gap bracket in the right margin: rings at both
 * ends, dashed guides, a bracket with an arrowhead and the gap as a large
 * number. 'auto' (default) draws it where gapFill washes the same two series
 * and keeps the label elsewhere. 'label' keeps the label at the anchor.
 * Other anchors and other charts keep the label.
 */
export interface GapPlacement {
  placement?: 'auto' | 'label' | 'bracket';
  /** A short line under the bracket's number that says what it measures. */
  caption?: string;
}

/** Exactly one of `at` (a category) and `date` (ISO) places an event; `to` or `end` makes it a period. */
export type EventAnchor<X extends string | number = Id> =
  | { at: AnchorRef<X>; date?: never; to?: X; end?: never }
  | { date: X; at?: never; end?: X; to?: never };

/** One more change on an event's date: a title and its detail lines. */
export interface EventItem {
  label: string;
  detail?: string | string[];
}

export type EventTone = 'neutral' | 'bad' | 'good';
export type EventGlyph = 'dot' | 'triangle' | 'diamond' | 'square';

/** A kind of event, authored once: its label, tone and glyph. */
export interface EventGroup {
  id: Id;
  label: string;
  tone?: EventTone;
  glyph?: EventGlyph;
}

/** `options.events` on column, combo and line. */
export interface EventOptions {
  /** 'key' draws every event as a numbered marker with the key below the plot. */
  placement?: 'auto' | 'key';
  /** Lane rows for event blocks; the default follows the width class (0 small, 1 medium, 2 large). */
  rows?: 0 | 1 | 2;
  groups?: EventGroup[];
  /** Optional heading over the event key. */
  keyTitle?: string;
}

export type AnnotationKind = Annotation['kind'];

/**
 * Default annotation identity: `${kind}-${position in authored order}`.
 * The annotate pass and the CLI receipts address an
 * annotation by this id, so the rule lives in one place.
 */
export function defaultAnnotationId(annotation: { kind: AnnotationKind; id?: Id }, index: number): Id {
  return annotation.id ?? `${annotation.kind}-${index + 1}`;
}

/** Technical purpose text used by discovery commands for every annotation kind. */
export const ANNOTATION_KIND_PURPOSES: Record<AnnotationKind, string> = {
  diff: 'Draws a level-difference arrow between two anchors and computes either percent change or their signed value difference.',
  cagr: 'Draws a growth arrow between two anchored points and computes the compound annual growth rate from their values and ISO-date span.',
  bracket: 'Draws a bracket over an inclusive span of steps and prints the sum of their values, after an optional label.',
  delta: 'Computes the signed difference between an anchored value and another anchor or literal, then places a collision-managed label at the first anchor.',
  abs: 'Reads the anchored data value and places its formatted absolute value in a collision-managed label.',
  note: 'Places authored text at an anchored data element through collision avoidance, with an optional icon or status chip.',
  callout: 'Places authored free text at an anchored data element, routing a leader when displaced and honoring the preferred side.',
  valueLine: 'Draws a reference line at an authored value or an engine-computed mean, with optional tolerance shading and attainment fill between the line and resolved actuals.',
  indicator100: "Maps 100 through the chart's value scale and draws a side tick with a 100% label.",
  band: 'Draws an inclusive category span as a shaded band or bracket, or a value-axis plan corridor, tolerance band or attainment fill, with a collision-managed label.',
  event: 'Places a dated event in the lane above the plot as a block with a pole to the data, or, when it does not fit, as a numbered marker with an entry in the event key below the plot; periods draw a thin bar.',
};
