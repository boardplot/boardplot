import type { Rect, Size } from '../../geometry';
import { bandSizing } from '../../sizing';
import type { ResolvedSizing } from '../../types/sizing';
import type { PlacedLabel } from '../../types/scene';

/** One band mark and the value labels it prints, as laid out at the current width. */
interface BandFloorEntry {
  bar: Rect;
  labels: readonly Rect[];
  /** Bars that share a band (a bridge's cases in one step): the label solver stacks their labels, so they set no floor. */
  group?: string;
}

const LABEL_AIR = 8;
/** A compact row of labels keeps a stagger's air plus the solver's pad. */
const COMPACT_ROW_AIR = 4;
/** The label solver's own pad (labelPad 2): nearer, it would move or hide the label anyway. */
const BAR_AIR = 2;
/**
 * Two labels offset by half a line or more read as a stagger, not a row: they keep the solver's
 * pad only. The solver pads the candidate alone (`hitsWhich(rect, 2)`), so 2 px is what it draws;
 * 4 px would refuse bridges the solver draws clean.
 */
const STAGGER_AIR = BAR_AIR;

const centre = (rect: Rect) => rect.x + rect.w / 2;
const sameHeight = (a: Rect, b: Rect) => a.y < b.y + b.h && b.y < a.y + a.h;
const oneRow = (a: Rect, b: Rect) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) >= Math.min(a.h, b.h) / 2;

/**
 * How far a label reaches past its bar's centre on one side. A label beside its bar
 * hangs off the bar's edge, which moves with the band (`scaled`); a label over its
 * bar hangs off the centre. Only `fixed` (text and its gap) keeps its size.
 */
function reach(bar: Rect, label: Rect, side: 'left' | 'right'): { scaled: number; fixed: number } {
  if (side === 'left') return label.x + label.w <= bar.x ? { scaled: bar.w / 2, fixed: bar.x - label.x } : { scaled: 0, fixed: centre(bar) - label.x };
  return label.x >= bar.x + bar.w ? { scaled: bar.w / 2, fixed: label.x + label.w - bar.x - bar.w } : { scaled: 0, fixed: label.x + label.w - centre(bar) };
}

/**
 * The narrowest plot in which the band's printed value labels still read.
 * Two neighbouring labels in one row (sharing half a line or more) keep 8 px of air
 * between them, a staggered pair the solver's 2 px, and a label keeps the solver's
 * 2 px from a neighbouring bar at its height. A label above or
 * below its neighbour's never collides with it, so it does not constrain the slot (a
 * bridge's labels mostly climb or fall with the running level).
 *
 * The bands scale with the plot width and the labels do not, so the floor is the
 * current plot width times the largest ratio of the room needed to the room there is.
 */
export function valueLabelPlotFloor(plotW: number, entries: readonly BandFloorEntry[], compact = false): number {
  // Compact mode trades a fifth of the spacing for the width (compact.ts): a row of labels keeps the stagger air.
  const rowAir = compact ? COMPACT_ROW_AIR : LABEL_AIR;
  const sorted = [...entries].sort((a, b) => centre(a.bar) - centre(b.bar));
  let scale = 0;
  const need = (fixed: number, room: number) => {
    if (room > 0) scale = Math.max(scale, fixed / room);
  };
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const d = centre(b.bar) - centre(a.bar);
    if (d <= 0 || (a.group !== undefined && a.group === b.group)) continue;
    for (const la of a.labels) {
      const ra = reach(a.bar, la, 'right');
      if (sameHeight(la, b.bar)) need(ra.fixed + BAR_AIR, d - ra.scaled - b.bar.w / 2);
      for (const lb of b.labels) {
        const rb = reach(b.bar, lb, 'left');
        if (sameHeight(la, lb)) need(ra.fixed + rb.fixed + (oneRow(la, lb) ? rowAir : STAGGER_AIR), d - ra.scaled - rb.scaled);
      }
    }
    for (const lb of b.labels) {
      const rb = reach(b.bar, lb, 'left');
      if (sameHeight(lb, a.bar)) need(rb.fixed + BAR_AIR, d - rb.scaled - a.bar.w / 2);
    }
  }
  return plotW * scale;
}

/** A value label the chart means to print. A blocked value owed to the note sets no plot-width floor. */
export function printedValueLabel(label: PlacedLabel | undefined): Rect | undefined {
  return label && label.hidden !== 'redundant' && label.hidden !== 'density'
    && !(label.owed && label.hidden === 'collision') ? label.rect : undefined;
}

/**
 * In full mode a value the solver hid for a collision goes to the visible
 * note ("Not labelled on the chart") and sets no floor. Compact mode keeps
 * values in the floor unless the solver explicitly owes them to the note.
 */
export function floorValueLabel(label: PlacedLabel | undefined, full: boolean): Rect | undefined {
  return full && label?.hidden === 'collision' ? undefined : printedValueLabel(label);
}

/**
 * The sizing a band chart reports from its laid-out bars and their value labels: the chrome
 * around the plot plus `valueLabelPlotFloor`. The natural width keeps the shared band step.
 */
export function bandFloorSizing(
  type: string, size: Size, plot: Rect, labels: readonly PlacedLabel[],
  bars: readonly { bar: Rect; labelIds: readonly string[]; group?: string }[],
  options: { mode?: string; target?: string },
): ResolvedSizing {
  const byId = new Map(labels.map((label) => [label.id, label]));
  const centres = bars.map((entry) => centre(entry.bar)).sort((a, b) => a - b);
  const step = centres.length > 1 ? (centres.at(-1)! - centres[0]!) / (centres.length - 1) : plot.w;
  const full = options.mode !== 'compact';
  const entries = bars.map(({ bar, labelIds, group }) => ({
    bar,
    labels: labelIds.flatMap((id) => floorValueLabel(byId.get(id), full) ?? []),
    ...(group === undefined ? {} : { group }),
  }));
  return bandSizing(type, size, plot.w, step, valueLabelPlotFloor(plot.w, entries, !full));
}
