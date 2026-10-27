/**
 * The steering form of a standalone KPI card: the hero
 * figure, the comparisons as rows of toned text with their baseline names in
 * a column, and the attainment as a progress bar with a 100% tick. Three
 * arrangements share the parts:
 *
 * - band: hero | comparisons | attainment in one row, split by thin rules,
 *   on a wide card;
 * - split: the hero on its own row, then comparisons | attainment;
 * - stacked: hero, comparison rows, attainment label, a full-width bar.
 *
 * The hero is the biggest mark on the card: twice the title on a card, and
 * up to 2.6 times on a band, stepping down until the bar column keeps a third
 * of the width. Every text goes through the label solver at the rect laid out
 * here; rules, bar, tick and carets are marks.
 */

import type { Rect } from '../../geometry';
import type { LabelRequest } from '../../label/solver';
import { PRIORITY } from '../../label/solver';
import { lineBox } from '../../label/fitText';
import { arrowHeadPath } from '../../svgPath';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { Paint, SceneNode } from '../../types/scene';
import { maxOf } from '../../arrays';

interface SteeringComparison {
  id: Id;
  /** The change as printed: "−9% (−€1.1M)". */
  body: string;
  /** The leading figure of the body, printed bold: "−9%". */
  lead: string;
  /** The baseline name: "YoY". */
  label: string;
  caretDir?: 'up' | 'down';
  tone: 'good' | 'bad' | 'neutral';
}

interface SteeringAttainment {
  pct: number | null;
  /** The percent as printed ("89%", ">999%", "n.m."). */
  figure: string;
  label: string;
  tone: 'good' | 'bad' | 'warn' | 'neutral';
}

interface SteeringInput {
  plot: Rect;
  /** Top of the hero (below an eyebrow label when the card prints one). */
  top: number;
  titleSize: number;
  family: string;
  regularWeight: number;
  boldWeight: number;
  figure: { family: string; weight: number };
  /** Smallest hero the target allows, and the hero the card would print without the steering form. */
  heroMinimum: number;
  heroBase: number;
  /** The reader floor of a label under the target. */
  labelFloor: number;
  footnote: FontSpec;
  valueText?: string;
  noteLines: readonly string[];
  noteFont: FontSpec;
  comparisons: readonly SteeringComparison[];
  attainment?: SteeringAttainment;
  measure: TextMeasurer;
  /** The chip tint of the surface: the bar track uses it. */
  trackTint: number;
}

export interface SteeringPlan {
  form: 'band' | 'split' | 'stacked';
  requests: LabelRequest[];
  marks: SceneNode[];
  /** Fonts of the labels this plan asks for, by label id. */
  fonts: Map<Id, FontSpec>;
  /** Bold leads of the comparison bodies, by label id. */
  leads: Map<Id, string>;
  /** Muted texts (baseline names, "of Plan", "100%"), by label id. */
  muted: Set<Id>;
  valueFont: FontSpec;
  valueRect?: Rect;
  noteRect?: Rect;
  /** Bottom of the content, from the plot top. */
  contentHeight: number;
}

/** Air between a rule and the column on either side. */
const COLUMN_GAP = 22;
/** Air between the caret and the change text. */
const CARET_GAP = 6;
/** The bar under the attainment label, and its tick reach above and below it. */
const BAR_H = 10;
const TICK_REACH = 5;
/** A bar column narrower than this stacks the attainment under the comparisons. */
const MIN_BAR_COLUMN = 200;
/** A band hero steps through these multiples of the title. */
const BAND_HERO_STEPS = [2.6, 2.4, 2.2];
/**
 * Below this plot width (a 720 px card) the
 * band hero starts at the smallest step, 44 px under a 20 px title, not 48 px.
 */
const BAND_LARGE_HERO_PLOT = 800;
/** A card wider than this (plot width) may draw the band. */
const BAND_MIN_PLOT = 576;
/** The band keeps this much more air at its right end than the frame margin. */
const BAND_RIGHT_INSET = 16;
/** Air under a row of columns (band, split) before the footer. */
const COLUMNS_BOTTOM_AIR = 11;

export function planSteering(input: SteeringInput): SteeringPlan | undefined {
  const { plot, measure } = input;
  const rowSize = Math.max(input.labelFloor, Math.round(input.titleSize * 0.75));
  const rowFont: FontSpec = { family: input.family, size: rowSize, weight: input.regularWeight, lineHeight: 1.2 };
  const boldFont: FontSpec = { ...rowFont, weight: input.boldWeight };
  // The scale reads at the label floor of the target (13 px in a report), never under it.
  const scaleFont: FontSpec = { ...input.footnote, family: input.footnote.family ?? input.family, size: Math.max(input.footnote.size, input.labelFloor) };
  const cap = (font: FontSpec) => measure.capHeight?.(font) ?? font.size * 0.72;
  const rowCap = cap(rowFont);
  const rowH = measure('0', rowFont).height;
  const pitch = Math.round(lineBox(rowFont) + 8);
  const caretSize = rowSize * 0.44;
  const caretW = 2 * caretSize * Math.sin(0.15 * Math.PI);
  const caretH = caretSize * Math.cos(0.15 * Math.PI);
  const textInset = input.comparisons.some((c) => c.caretDir) ? caretW + CARET_GAP : 0;

  const bodyWidth = (c: SteeringComparison) => {
    const rest = c.body.slice(c.lead.length);
    return measure(c.lead, boldFont).width + (rest ? measure(rest, rowFont).width : 0);
  };
  const bodyW = Math.max(0, maxOf(input.comparisons.map(bodyWidth)));
  const labelW = Math.max(0, maxOf(input.comparisons.map((c) => measure(c.label, rowFont).width)));
  const colGap = Math.round(rowSize * 0.9);
  const compareW = input.comparisons.length === 0 ? 0 : textInset + bodyW + colGap + labelW;
  const compareH = input.comparisons.length === 0 ? 0 : (input.comparisons.length - 1) * pitch;
  if (compareW > plot.w) return undefined;

  const heroFont = (size: number): FontSpec => ({ family: input.figure.family, size, weight: input.figure.weight, lineHeight: 1.2 });
  const heroWidth = (size: number) => (input.valueText === undefined ? 0 : measure(input.valueText, heroFont(size)).width);
  const cardHero = Math.max(input.heroBase, Math.round(input.titleSize * 2));
  /** The largest hero at or under `size` whose text fits `width`. */
  const fitHero = (size: number, width: number) => {
    let s = size;
    while (s > input.heroMinimum && heroWidth(s) > width) s -= 0.5;
    return Math.max(input.heroMinimum, s);
  };

  const attainment = input.attainment;
  const hasBoth = attainment !== undefined && input.comparisons.length > 0;

  // ---- choose the form ----
  let form: SteeringPlan['form'] = 'stacked';
  let heroSize = fitHero(cardHero, plot.w);
  if (plot.w >= BAND_MIN_PLOT && input.noteLines.length === 0) {
    for (const step of plot.w >= BAND_LARGE_HERO_PLOT ? BAND_HERO_STEPS : BAND_HERO_STEPS.slice(-1)) {
      const size = Math.max(input.heroBase, Math.round(input.titleSize * step));
      const heroW = input.valueText === undefined ? 0 : heroWidth(size) + 2 * COLUMN_GAP;
      const rest = plot.w - BAND_RIGHT_INSET - heroW - (input.comparisons.length > 0 ? compareW + (attainment ? 2 * COLUMN_GAP : 0) : 0);
      if (attainment ? rest >= Math.max(MIN_BAR_COLUMN, plot.w / 3) : rest >= 0) {
        form = 'band';
        heroSize = size;
        break;
      }
    }
  }
  if (form === 'stacked' && hasBoth && plot.w - compareW - 2 * COLUMN_GAP >= MIN_BAR_COLUMN) form = 'split';

  const requests: LabelRequest[] = [];
  const marks: SceneNode[] = [];
  const fonts = new Map<Id, FontSpec>();
  const leads = new Map<Id, string>();
  const muted = new Set<Id>();
  const owner = { categoryId: 'kpi' };
  const atBaseline = (x: number, baseline: number, text: string, font: FontSpec): Rect => {
    const m = measure(text, font);
    return { x, y: baseline - m.height / 2 - cap(font) / 2, w: m.width, h: m.height };
  };
  const text = (id: Id, rect: Rect, value: string, font: FontSpec, request: Partial<LabelRequest> = {}) => {
    fonts.set(id, font);
    requests.push({
      id, kind: 'point', owner, text: value, lines: [value], font, typeRole: 'label', pad: 0,
      priority: PRIORITY.endpoint, candidates: [{ slot: 'comparisonRow', rect, penalty: 0 }], ...request,
    });
  };
  const rule = (id: Id, x: number, y1: number, y2: number) => {
    marks.push({ t: 'line', id, x1: x, y1, x2: x, y2, stroke: { token: 'neutral', tint: 0.75 }, width: 1, owner, part: 'kpiRule' });
  };

  // ---- hero ----
  const valueFont = heroFont(heroSize);
  const heroM = input.valueText === undefined ? undefined : measure(input.valueText, valueFont);
  const heroCap = cap(valueFont);
  let valueRect: Rect | undefined;
  let noteRect: Rect | undefined;
  let y = input.top;
  /** Baseline of the first comparison row. */
  let firstBaseline: number;
  let left = plot.x;
  let right = plot.x + plot.w;
  if (form === 'band') {
    right -= BAND_RIGHT_INSET;
    firstBaseline = y + Math.round(rowH + rowCap);
    const barBottom = firstBaseline + Math.round(rowSize * 0.8) + BAR_H;
    const textBottom = input.comparisons.length > 0 ? firstBaseline + compareH : barBottom;
    const blockTop = firstBaseline - rowH;
    const blockBottom = Math.max(textBottom + 10, attainment ? barBottom + TICK_REACH : 0);
    if (heroM) {
      // The hero centres its cap band on the band's text block.
      const centre = (firstBaseline - rowCap + textBottom) / 2;
      const baseline = centre + heroCap / 2;
      valueRect = { x: plot.x, y: baseline - heroM.height / 2 - heroCap / 2, w: heroM.width, h: heroM.height };
      left = plot.x + heroM.width + COLUMN_GAP;
      rule('mark:kpi:rule:0', Math.round(left) + 0.5, blockTop, blockBottom);
      left = Math.round(left) + 0.5 + COLUMN_GAP;
    }
    y = blockBottom;
  } else {
    if (heroM) {
      valueRect = { x: plot.x, y, w: heroM.width, h: heroM.height };
      y += heroM.height;
    }
    if (input.noteLines.length > 0) {
      const noteH = measure(input.noteLines[0]!, input.noteFont).height + (input.noteLines.length - 1) * lineBox(input.noteFont);
      noteRect = { x: plot.x, y: y + 2, w: plot.w, h: noteH };
      y += 2 + noteH;
    }
    const heroBaseline = valueRect ? valueRect.y + valueRect.h / 2 + heroCap / 2 : undefined;
    firstBaseline = heroBaseline !== undefined && input.noteLines.length === 0
      ? heroBaseline + 2 * rowSize
      : y + Math.round(rowH + rowCap) - 6;
  }

  // ---- comparisons ----
  let compareEnd = left;
  input.comparisons.forEach((comparison, index) => {
    const baseline = firstBaseline + index * pitch;
    const x = left + textInset;
    const body = atBaseline(x, baseline, comparison.body, rowFont);
    body.w = bodyWidth(comparison);
    text(`point:compare:${index}`, body, comparison.body, rowFont, { owner: { categoryId: 'kpi', seriesId: comparison.id, segmentId: comparison.id }, claimId: `kpi:delta:${index}` } as Partial<LabelRequest>);
    leads.set(`point:compare:${index}`, comparison.lead);
    const labelId = `point:compareLabel:${index}`;
    // The comparison word ('YoY', 'vs Plan') is a caption beside its number, not a value.
    text(labelId, atBaseline(x + bodyW + colGap, baseline, comparison.label, rowFont), comparison.label, rowFont, { owner: { categoryId: 'kpi', seriesId: comparison.id, segmentId: comparison.id }, role: 'caption' });
    muted.add(labelId);
    if (comparison.caretDir) {
      const capCy = baseline - rowCap / 2;
      const tip = { x: left + caretW / 2, y: comparison.caretDir === 'up' ? capCy - caretH / 2 : capCy + caretH / 2 };
      marks.push({
        t: 'path', id: `mark:compare:${index}:caret`,
        d: arrowHeadPath(tip, comparison.caretDir === 'up' ? -Math.PI / 2 : Math.PI / 2, caretSize),
        fill: comparison.tone === 'neutral' ? { token: 'inkMuted' } : { token: comparison.tone },
        owner: { categoryId: 'kpi', seriesId: comparison.id, segmentId: comparison.id }, part: 'caret',
      });
    }
    compareEnd = x + bodyW + colGap + labelW;
  });
  const lastCompareBaseline = firstBaseline + compareH;

  // ---- attainment ----
  let attainmentLeft = plot.x;
  let attainmentBaseline = lastCompareBaseline + (input.comparisons.length > 0 ? pitch + 1 : 0);
  if (attainment && input.comparisons.length > 0 && form !== 'stacked') {
    const x = Math.round(compareEnd + COLUMN_GAP) + 0.5;
    rule(`mark:kpi:rule:${form === 'band' && valueRect ? 1 : 0}`, x, firstBaseline - rowH,
      form === 'band' ? y : lastCompareBaseline + 8);
    attainmentLeft = x + COLUMN_GAP;
    attainmentBaseline = firstBaseline;
  } else if (form === 'band') {
    attainmentLeft = left;
    attainmentBaseline = firstBaseline;
  }
  let bottom = form === 'band' ? y : Math.max(y, lastCompareBaseline + (input.comparisons.length > 0 ? 8 : 0));
  if (attainment) {
    const color: Paint = attainment.tone === 'neutral' ? { token: 'ink' } : { token: attainment.tone };
    const pctRect = atBaseline(attainmentLeft, attainmentBaseline, attainment.figure, boldFont);
    text('point:attainment', pctRect, attainment.figure, boldFont, { owner: { categoryId: 'kpi', seriesId: 'attainment', segmentId: 'attainment' }, claimId: 'kpi:attainment', candidates: [{ slot: 'attainmentRow', rect: pctRect, penalty: 0 }] } as Partial<LabelRequest>);
    const space = measure(' ', rowFont).width;
    const labelRect = atBaseline(pctRect.x + pctRect.w + space, attainmentBaseline, attainment.label, rowFont);
    text('point:attainmentLabel', labelRect, attainment.label, rowFont, { owner: { categoryId: 'kpi', seriesId: 'attainment', segmentId: 'attainment' }, role: 'caption', candidates: [{ slot: 'attainmentRow', rect: labelRect, penalty: 0 }] });
    muted.add('point:attainmentLabel');
    if (attainment.pct !== null) {
      const barW = right - attainmentLeft;
      const domain = Math.min(200, Math.max(100, attainment.pct));
      const share = Math.max(0, Math.min(attainment.pct, domain)) / domain;
      const tickX = attainmentLeft + (100 / domain) * barW;
      const barTop = attainmentBaseline + Math.round(rowSize * 0.8);
      const owner = { categoryId: 'kpi', seriesId: 'attainment', segmentId: 'attainment' };
      marks.push({ t: 'rect', id: 'mark:attainment:track', rect: { x: attainmentLeft, y: barTop, w: barW, h: BAR_H }, fill: { token: 'neutral', tint: input.trackTint }, owner, part: 'kpiAttainmentTrack' });
      if (share > 0) marks.push({ t: 'rect', id: 'mark:attainment:bar', rect: { x: attainmentLeft, y: barTop, w: share * barW, h: BAR_H }, fill: color, owner, part: 'kpiAttainmentBar' });
      marks.push({ t: 'line', id: 'mark:attainment:tick', x1: tickX, y1: barTop - TICK_REACH, x2: tickX, y2: barTop + BAR_H + TICK_REACH, stroke: { token: 'ink' }, width: 2, owner, part: 'kpiAttainmentTick' });
      const scale = '100%';
      const scaleM = measure(scale, scaleFont);
      const scaleX = Math.min(right - scaleM.width, Math.max(labelRect.x + labelRect.w + 8, tickX - scaleM.width / 2));
      if (scaleX + scaleM.width <= right + 0.5 && scaleX >= labelRect.x + labelRect.w + 4) {
        const scaleRect = atBaseline(tickX >= right - 1 ? right - scaleM.width : scaleX, attainmentBaseline, scale, scaleFont);
        text('point:attainmentScale', scaleRect, scale, scaleFont, { owner, candidates: [{ slot: 'attainmentRow', rect: scaleRect, penalty: 0 }] });
        muted.add('point:attainmentScale');
      }
      bottom = Math.max(bottom, barTop + BAR_H + TICK_REACH);
    } else {
      bottom = Math.max(bottom, attainmentBaseline + (rowH - rowCap));
    }
  }

  if (form !== 'stacked') bottom += COLUMNS_BOTTOM_AIR;
  return {
    form, requests, marks, fonts, leads, muted, valueFont, valueRect, noteRect,
    contentHeight: bottom - input.top,
  };
}
