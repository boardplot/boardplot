/** Shared footer text wrapping and the static output layout. */
import { hasAuthoredTypeSize, wrapText, type FontSpec, type TextMeasurer } from './text';
import type { FrameGeometry } from './types/scene';
import type { FrameInput } from './frame';
import { DEFAULT_TARGET, scaleTextAtFloor, targetFloorsPx, targetTypeSizesPx } from './target';

// Layout-only state. No function or hidden property travels in geometry.
export const INTERACTIVE_LAYOUT = Symbol();
/**
 * The author notes compact mode left off the canvas (compact.ts). They reach
 * React's notes panel (`a11y.compactNotes`), so a React layout counts them in
 * the "+N notes" button it reserves a row for.
 */
export const COMPACT_OMITTED_NOTES = Symbol('compactOmittedNotes');
/**
 * The note kinds the React footer prints and counts (`shownNoteKinds` of the
 * request). A composing chart hands its host other options (pyramid drops
 * `methodNote`); this symbol travels with them, so the frame reserves the
 * button React draws.
 */
export const LIVE_NOTE_SHOW = Symbol('liveNoteShow');
/**
 * The rows a React footer draws beyond the footer text the frame stacks (the
 * notes button row): a React layout reserves them, and sizing lets them take
 * the plot under its floor with a warning rather than refuse a size the chart
 * draws without them.
 */
export const liveFooterExtra = new WeakMap<FrameGeometry, number>();
export const footerPlans = new WeakMap<FrameGeometry, FrameInput>();
/**
 * A pinned static chart must reserve every printed footer line before sizing its plot.
 * `live`: the layout is for React, whose 'info' footer draws in the room the frame reserves.
 * React without export does not link the static footer, so a layout outside it is live;
 * the static footer sets it for each layout it wraps.
 */
export const staticFrame = { pinned: false, countable: false, live: true };

/**
 * Header and footer room a spacing rule frees, per frame and per source. At a
 * height the engine chooses, sizing counts this room as frame
 * (`freedChromeOf`), so the freed pixels go to the plot and the canvas does
 * not get shorter because of them. An authored height ignores it. A rule that
 * frees header or footer room records the pixels it freed here.
 */
const freedChrome = new WeakMap<FrameGeometry, Map<string, number>>();
export function recordFreedChrome(frame: FrameGeometry, source: string, px: number): void {
  if (!(px > 0)) return;
  let entry = freedChrome.get(frame);
  if (!entry) freedChrome.set(frame, entry = new Map());
  entry.set(source, px);
}
/** The header and footer room the rules freed on this frame (0 when none). */
export function freedChromeOf(frame: FrameGeometry | undefined): number {
  let sum = 0;
  for (const px of frame ? freedChrome.get(frame)?.values() ?? [] : []) sum += px;
  return sum;
}

/**
 * The canvas height a frame part needs to draw in full, recorded when the part gave way on this
 * frame (an event key that left out its detail). An automatic height grows to it; an authored
 * height ignores it.
 */
const partNeeds = new WeakMap<FrameGeometry, number>();
export function recordPartNeed(frame: FrameGeometry, px: number): void {
  if (px > (partNeeds.get(frame) ?? 0)) partNeeds.set(frame, px);
}
/** The canvas height the frame's parts need (0 when none gave way). */
export function partNeedOf(frame: FrameGeometry | undefined): number {
  return (frame && partNeeds.get(frame)) ?? 0;
}

/** A grid whose natural height is what its tiers ask for in their slots: an automatic height grows to it until the tiers fit. */
export const slotDemandHeight = new WeakSet<FrameGeometry>();

/** Keep the static footer plan, the freed room and the part need when layout copies its frame. */
export function copyFrame(frame: FrameGeometry, patch?: Partial<FrameGeometry>): FrameGeometry {
  const copy = { ...frame, ...patch };
  const plan = footerPlans.get(frame);
  if (plan) footerPlans.set(copy, plan);
  const freed = freedChrome.get(frame);
  if (freed) freedChrome.set(copy, new Map(freed));
  const need = partNeeds.get(frame);
  if (need) partNeeds.set(copy, need);
  const extra = liveFooterExtra.get(frame);
  if (extra) liveFooterExtra.set(copy, extra);
  if (slotDemandHeight.has(frame)) slotDemandHeight.add(copy);
  return copy;
}

/**
 * A footnote wraps to as many lines as it needs and is never cut: a
 * note that ends in an ellipsis stopped being a receipt. A single word wider
 * than the content width (a URL, a long identifier) breaks between characters
 * rather than end in `…`.
 */
export function wrapFootnote(text: string, font: FontSpec, width: number, measure: TextMeasurer): string[] {
  // A listed entry stays together when it fits. An overwide entry first
  // releases its word spaces; only an overwide word breaks at characters.
  const words = text.split(' ').flatMap((word) => measure(word, font).width <= width ? [word] : word.split('\u00a0'));
  const pieces = words.flatMap((word) =>
    measure(word, font).width <= width ? [word] : breakWord(Array.from(word), font, width, measure));
  return wrapText(pieces.join(' '), font, width, Infinity, measure).lines;
}

/**
 * Split a word wider than the line at the longest prefixes that fit. Each cut
 * is found by doubling and then bisecting, so a token of n characters costs
 * about (n / line length) * log(line length) measures of line-length strings.
 */
function breakWord(chars: string[], font: FontSpec, width: number, measure: TextMeasurer): string[] {
  const parts: string[] = [];
  for (let from = 0; from < chars.length;) {
    const rest = chars.length - from;
    const fits = (n: number) => measure(chars.slice(from, from + n).join(''), font).width <= width;
    let good = 1;
    let bad = rest + 1;
    while (good < rest && bad > rest) {
      const next = Math.min(good * 2, rest);
      if (fits(next)) good = next;
      else bad = next;
    }
    while (bad - good > 1) {
      const mid = (good + bad) >> 1;
      if (fits(mid)) good = mid;
      else bad = mid;
    }
    // A URL breaks after a slash where one sits in the back half of the line.
    const slash = good < rest ? chars.lastIndexOf('/', from + good - 1) - from + 1 : 0;
    if (slash > good / 2) good = slash;
    parts.push(chars.slice(from, from + good).join(''));
    from += good;
  }
  return parts;
}

/** Footer text size, at every width and target. */
const FOOTER_TEXT_PX = 11;

/**
 * The footer's font: the footnote role at FOOTER_TEXT_PX (times textScale)
 * on every target. A footnote size the target tables do not hold is an
 * authored one and wins. Line height follows the role's ratio, so the
 * footer lines shrink with the text.
 */
export function footerType(footnote: FontSpec, target: FrameInput['target'] = DEFAULT_TARGET, textScale = 1): FontSpec {
  if (hasAuthoredTypeSize(footnote)) return footnote;
  const floor = targetFloorsPx(target).footnote;
  const tableSizes = (['S', 'M', 'L'] as const).map((step) => scaleTextAtFloor(targetTypeSizesPx(target, step).footnote, textScale, floor));
  if (!tableSizes.some((size) => Math.abs(size - footnote.size) < 0.01)) return footnote;
  return { ...footnote, size: scaleTextAtFloor(FOOTER_TEXT_PX, textScale, floor) };
}
