/**
 * The annotation furniture a LAYOUT needs without running the placement
 * pass: the rect an edge-period "100%" label reserves, and the prune that
 * drops an indicator whose text the solver hid.
 *
 * A module of its own for one reason: code splitting works on whole modules,
 * so leaving these in `annotate.ts` pinned the whole 39 KB placement engine
 * into every layout that reads one of them (see `core/annotatePass`). The
 * dependency runs one way — `annotate.ts` imports from here, never back.
 */

import type { Rect } from './geometry';
import { defaultAnnotationId, type Annotation } from './types/annotations';
import type { Id } from './types/cell';
import type { PlacedAnnotation, PlacedLabel, SceneNode } from './types/scene';
import { maxOf } from './arrays';

/** Shared with layouts that reserve space for edge-period value labels. */
export function indicator100LabelRect(plot: Rect, y: number, size: { width: number; height: number }, side: 'left' | 'right'): Rect {
  return { x: side === 'left' ? plot.x - 14 - size.width : plot.x + plot.w + 14,
    y: y - size.height / 2, w: size.width, h: size.height };
}

/**
 * An arm whose label lost placement drops its lines and heads too.
 * The hidden label and derivation remain available to the footnote. The
 * solver's label-hidden lint already reports the loss (severity follows the
 * request's priority, so engine-added indicators inform instead of warn).
 * Charts that place indicator100 locally (bar) call this on their own lists.
 */
export function pruneOrphanAnnotationArms(
  nodes: SceneNode[],
  placed: PlacedAnnotation[],
  labels: PlacedLabel[],
): void {
  const hiddenIds = new Set(labels.filter((l) => l.hidden).map((l) => l.id));
  for (let i = placed.length - 1; i >= 0; i--) {
    const ann = placed[i]!;
    if (!ann.labelId || !hiddenIds.has(ann.labelId)) continue;
    const armKinds = ['indicator100', 'diff', 'cagr', 'callout', 'note', 'delta', 'abs'];
    const bracket = nodes.some((node) => node.owner.annotationId === ann.id && node.part === 'bandBracket');
    if (!armKinds.includes(ann.kind) && !bracket) continue;
    const drop = new Set(nodes.filter((node) => node.owner.annotationId === ann.id).map((node) => node.id));
    for (let n = nodes.length - 1; n >= 0; n--) {
      if (drop.has(nodes[n]!.id)) nodes.splice(n, 1);
    }
    ann.nodeIds = [];
    if (ann.kind === 'indicator100') placed.splice(i, 1);
  }
}

/**
 * Internal option: px of right margin a second pass keeps for a
 * right-side valueLine label the first pass had to hide. Authored JSON cannot set it.
 */
export const VALUE_LINE_RESERVE = Symbol('valueLineReserve');

/** Internal option: px a second line pass adds to the right margin for gap brackets (annotateGapBracket). Authored JSON cannot set it. */
export const GAP_BRACKET_RESERVE = Symbol('gapBracketReserve');

/** Internal option and geometry key: annotation ids whose bracket number found no seat, refused the bracket on the next pass. */
export const GAP_BRACKET_REFUSED = Symbol('gapBracketRefused');

/** Internal option: px of top headroom a second pass reserves for era band labels that could not fit on the first pass. Authored JSON cannot set it. */
export const BAND_PAD = Symbol('bandPad');

/**
 * The series pairs a delta or diff compares at the last category, where the
 * line draws a gap bracket (gapBracketApplies: asked for, or 'auto' over a
 * gap wash between the same two series): their end values then sit clear of
 * the bracket's guides.
 */
export function gapBracketPairs(annotations: readonly Annotation[], lastCategoryId: Id, washed?: readonly Id[], refused: readonly Id[] = []): [Id, Id][] {
  return annotations.flatMap((ann, index): [Id, Id][] => {
    if ((ann.kind !== 'delta' && ann.kind !== 'diff') || ann.placement === 'label' || refused.includes(defaultAnnotationId(ann, index))) return [];
    const [a, b] = ann.kind === 'delta' ? [ann.at, ann.vs] : [ann.from, ann.to];
    if (typeof a !== 'object' || typeof b !== 'object' || !('categoryId' in a) || !('categoryId' in b)) return [];
    if (a.categoryId !== lastCategoryId || b.categoryId !== lastCategoryId || !a.seriesId || !b.seriesId || a.seriesId === b.seriesId) return [];
    const asked = ann.placement === 'bracket' || (washed?.includes(a.seriesId) === true && washed.includes(b.seriesId));
    return asked ? [[a.seriesId, b.seriesId]] : [];
  });
}

/**
 * The lines a valueLine label takes in a side gutter: it wraps before it
 * widens, into two lines split at the space that leaves the narrower block,
 * so "Before 5.5%" takes the width of "Before", not of the whole line. The
 * first line only grows as the split moves right, so a binary search finds
 * the split in a few measurements, however long the label.
 */
export function lineLabelGutterLines(text: string, drawnWidth: (text: string) => number): string[] {
  const spaces: number[] = [];
  for (let i = text.indexOf(' '); i > 0; i = text.indexOf(' ', i + 1)) spaces.push(i);
  const split = (i: number) => [text.slice(0, i).trimEnd(), text.slice(i + 1).trimStart()];
  // The first space whose first line is at least as wide as its second.
  let lo = 0;
  let hi = spaces.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = split(spaces[mid]!);
    if (drawnWidth(a!) >= drawnWidth(b!)) hi = mid;
    else lo = mid + 1;
  }
  let best = [text];
  let bestW = drawnWidth(text);
  for (const k of [lo - 1, lo]) {
    if (k < 0 || k >= spaces.length) continue;
    const lines = split(spaces[k]!);
    const w = Math.max(...lines.map(drawnWidth));
    if (w < bestW) [best, bestW] = [lines, w];
  }
  return best;
}

/**
 * The right margin a right-side valueLine label needs at its line end, where
 * the first pass found no free seat on its line inside the plot: its gutter
 * width (lineLabelGutterLines) in the font it is drawn with, the 4 px gap and
 * 4 px of air. 0 when every such label was placed, so a chart whose label had
 * a seat keeps its geometry.
 */
export function hiddenValueLineReserve(labels: readonly PlacedLabel[], drawnWidth: (text: string) => number, canvasWidth = Infinity): number {
  const right = labels.filter((label) => label.kind === 'valueLine' && label.slots.includes('insideEnd'));
  const hidden = right.filter((label) => label.hidden === 'collision');
  // Two or more right labels can share the gutter (one placed inside may
  // move there in the next pass): their two-line boxes could stack into
  // each other, so the gutter keeps one-line room for each.
  const width = (text: string) => right.length > 1 ? drawnWidth(text) : Math.max(...lineLabelGutterLines(text, drawnWidth).map(drawnWidth));
  // A label that needs more than 60% of the canvas would leave no plot: it gets no seat and goes to the note.
  return Math.max(0, maxOf(hidden
    .map((label) => Math.ceil(width(label.text)) + 8)
    .filter((reserve) => reserve <= canvasWidth * 0.6)));
}

/**
 * A named reference line prints its value, "Target 90". The
 * name may place it with `${value}`; a name that already carries the number
 * ("Target 30", pareto's "95%"), and the average marker, which composes its
 * own ("Ø 42.1"), stay as written. A name ending in a figure takes a colon,
 * "Median 2024: 22.1".
 */
export function namedLineText(label: string, value: string, v: number, id: string): string {
  if (label.includes('${value}')) return label.replace(/\$\{value\}/g, value);
  if (holdsFigure(label, value) || id.startsWith('averageMarker') || carriesNumber(label, v)) return label;
  return /\d$/.test(label) ? `${label}: ${value}` : `${label} ${value}`;
}

/** True when `value` stands in the text as its own number: 20 is not in "120", "20.5" or "from -20". */
function holdsFigure(text: string, value: string): boolean {
  for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) {
    if (!LONGER_BEFORE.test(text.slice(0, at)) && !/^[.,]?\d/.test(text.slice(at + value.length))) return true;
  }
  return false;
}

/** The end of a text that makes the number after it another number: a digit, or a minus sign that is no hyphen. */
const LONGER_BEFORE = /(?:\d[.,]?|(?<![\p{L}\p{N}])[-\u2212])$/u;

/** True when a figure in the text is `v` at the decimals it is written with. A written minus is part of the figure; a name of 20 may stand for a line at -20. */
function carriesNumber(text: string, v: number): boolean {
  return [...text.matchAll(/((?<![\p{L}\p{N}])[-\u2212])?(\d+(?:[.,]\d+)?)/gu)].some(([, minus, figure]) => {
    const decimals = figure!.split(/[.,]/)[1]?.length ?? 0;
    return Math.abs(Number(figure!.replace(',', '.')) - (minus ? -v : Math.abs(v))) <= 0.5 * 10 ** -decimals;
  });
}
