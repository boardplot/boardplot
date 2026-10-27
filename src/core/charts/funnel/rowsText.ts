import { chartString } from '../../strings/funnel';
/**
 * Text fitting for the funnel rows variant.
 *
 * One ladder for every piece of funnel text: place it at its natural width,
 * wrap it when the reserved width is narrower, and cut it with an ellipsis
 * only when a single word is still too wide. A cut record carries the full
 * text so the caller can put it into `<title>` — a reader who cannot read the
 * label on the canvas can still read it from the document.
 */

import { MINUS } from '../../format';
import { clamp } from '../../geometry';
import { type FontSpec, type TextMeasurer } from '../../text';
import { fitText as fitTextPolicy, type FitOptions } from '../../label/fitText';

export interface FittedText {
  lines: string[];
  /** Widest line. */
  w: number;
  /** Line count times the font's line box. */
  h: number;
  /** The untruncated text, present only when a line was cut. */
  title?: string;
}

export function lineHeight(font: FontSpec): number {
  return font.size * (font.lineHeight ?? 1.2);
}

/**
 * Wrap `text` into at most `maxLines` lines of `maxWidth`; ellipsis last.
 * The shared truncation policy (src/core/label/fitText.ts) decides; the
 * funnel keeps its one empty line for a blank name.
 */
export function fitText(
  text: string,
  font: FontSpec,
  maxWidth: number,
  maxLines: number,
  measure: TextMeasurer,
  options?: FitOptions,
): FittedText {
  const fitted = fitTextPolicy(text, font, maxWidth, maxLines, measure, options);
  const lines = fitted.lines.length > 0 ? fitted.lines : [''];
  return {
    lines,
    w: Math.max(1, ...lines.map((line) => measure(line, font).width)),
    h: lines.length * lineHeight(font),
    ...(fitted.title !== undefined ? { title: fitted.title } : {}),
  };
}

export interface DropCallout {
  /** The callout as its own right-hand column, absent when unaffordable. */
  column: FittedText | null;
  /** Column width the layout has to keep free, gutter included; 0 without one. */
  reserve: number;
  /** The callout under the bar, fitted to the caption width. */
  below: FittedText;
}

const CALLOUT_GUTTER = 12;
const CALLOUT_MAX_LINES = 3;

function calloutForm(
  cap: number,
  dropText: string,
  pair: string,
  font: FontSpec,
  measure: TextMeasurer,
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>,
): FittedText {
  const wide = chartString(options, 'biggestDrop', { v1: dropText });
  const head = measure(wide, font).width <= cap ? wide : chartString(options, 'dropValue', { v1: dropText });
  const body = fitText(pair, font, cap, CALLOUT_MAX_LINES - 1, measure);
  const lines = [head, ...body.lines];
  const w = Math.max(...lines.map((line) => measure(line, font).width));
  const cut = body.title !== undefined || measure(head, font).width > cap;
  return { lines, w, h: lines.length * lineHeight(font), ...(cut ? { title: `${wide} · ${pair}` } : {}) };
}

/**
 * The automatic worst-drop callout and the width its column needs. The widest
 * form that does not truncate wins, as long as its column still leaves the
 * bars 60 percent of the free width; otherwise the form wraps narrower. When
 * even the narrowest column is unaffordable the callout gets `reserve: 0` and
 * the caller places it under the bar instead. There it stands beside the step
 * caption when that caption is drawn, which already names both stages, so the
 * form under the bar keeps only the drop.
 */
export function dropCallout(
  dropPercent: string,
  fromLabel: string,
  toLabel: string,
  font: FontSpec,
  measure: TextMeasurer,
  space: { innerW: number; avail: number; captionW: number; besideCaption: boolean },
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>,
): DropCallout {
  const dropText = `${MINUS}${dropPercent}%`;
  const pair = chartString(options, 'stagePair', { v1: fromLabel, v2: toLabel });
  const below = space.besideCaption
    ? fitText(chartString(options, 'biggestDrop', { v1: dropText }), font, space.captionW, 2, measure)
    : fitText(`Biggest drop: ${dropText} · ${pair}`, font, space.captionW, 2, measure);
  const natural = calloutForm(Number.POSITIVE_INFINITY, dropText, pair, font, measure, options);
  const caps = [natural.w, space.innerW * 0.3, space.innerW * 0.24, space.innerW * 0.18]
    .filter((cap, index) => index === 0 || cap < natural.w)
    .map((cap) => Math.max(40, cap));
  for (const cap of caps) {
    const form = cap === natural.w ? natural : calloutForm(cap, dropText, pair, font, measure, options);
    const reserve = form.w + CALLOUT_GUTTER;
    if (form.title === undefined && space.avail - reserve >= space.avail * 0.6) {
      return { column: form, reserve, below };
    }
  }
  return { column: null, reserve: 0, below };
}

/** Space between a step caption and the drop callout beside it. */
const CALLOUT_BESIDE_GAP = 10;

/**
 * Places for the drop callout without a column: beside the step caption's
 * last line, then under the caption, then at the bottom of its row lane.
 * Without a drawn caption only the lane slot is left.
 */
export function belowCalloutCandidates(
  below: FittedText,
  caption: { x: number; y: number; w: number; h: number } | undefined,
  lane: { x: number; y: number },
  captionLineH: number,
): { slot: string; rect: { x: number; y: number; w: number; h: number }; penalty: number }[] {
  const size = { w: below.w, h: below.h };
  const laneSlot = { slot: 'sourceOutbound', rect: { ...lane, ...size }, penalty: 2 };
  if (!caption) return [laneSlot];
  const lastLineCy = caption.y + caption.h - captionLineH / 2;
  return [
    { slot: 'captionBeside', rect: { x: caption.x + caption.w + CALLOUT_BESIDE_GAP, y: lastLineCy - below.h / 2, ...size }, penalty: 0 },
    { slot: 'captionUnder', rect: { x: caption.x, y: caption.y + caption.h + LABEL_PAD, ...size }, penalty: 1 },
    // Under a caption in the right-aligned conversion column, aligned to its right edge.
    { slot: 'captionUnderRight', rect: { x: caption.x + caption.w - below.w, y: caption.y + caption.h + LABEL_PAD, ...size }, penalty: 1 },
    laneSlot,
  ];
}

/** Breathing space between a row-owned label and its lane edge. */
export const LANE_PAD = 3;

/**
 * The y of a label box that must stay inside its row lane. Centred on the row
 * while the lane has room, pushed in when it has not. Row lanes tile without
 * a gap, so a box that merely reaches over the edge is refused by the solver
 * as another row's territory. A centred box that already lies in the lane
 * keeps its place: the lane of every row after the first starts at its bar's
 * top, and a pad would push a total or a name centred on a bar barely taller
 * than it 2 to 3 px low.
 */
export function laneY(
  lane: { y: number; h: number },
  desiredCy: number,
  h: number,
  padding = LANE_PAD,
): number {
  const centred = desiredCy - h / 2;
  if (centred >= lane.y && centred + h <= lane.y + lane.h) return centred;
  const pad = Math.min(padding, Math.max(0, (lane.h - h) / 2));
  const top = lane.y + pad;
  const bottom = lane.y + lane.h - h - pad;
  return Math.min(Math.max(desiredCy - h / 2, top), Math.max(top, bottom));
}

/** Collision pad of the funnel's label solve; the row pitch keeps it free. */
export const LABEL_PAD = 2;

/** The largest share of a row step the gap between two rows takes. */
const MAX_GAP_FRACTION = 0.55;

/**
 * Share of the row step that goes to the gap between two rows. The gap widens
 * to hold the tallest conversion caption and is capped so the bars stay
 * readable; one stage keeps the authored band fraction.
 */
export function rowGapFraction(stageCount: number, step: number, captionBandH: number, piBase: number): number {
  if (stageCount <= 1) return piBase;
  return clamp((captionBandH + 8) / Math.max(step, 1), piBase, MAX_GAP_FRACTION);
}
