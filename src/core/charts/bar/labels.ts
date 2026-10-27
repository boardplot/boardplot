/**
 * Standard bar phase 3, label planning: the phase 2 geometry in, label
 * requests for the solver out. Row by row: the value labels (points or
 * segments), the grand total, the category name; then the net line's label.
 */

import { chosenValueIndices } from '../band/valueSelection';
import { rowLabelX, unionRect, type Rect } from '../../geometry';
import { fittedLabel } from '../../label/rowFit';
import { namesOnly } from '../../markVisibility';
import { PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import type { DataRange } from '../../rangeRules';
import type { CellMeta, Id } from '../../types/cell';
import type { LintWarning, Paint } from '../../types/scene';
import type { FontSpec, TextMeasurer } from '../../text';
import { SWATCH_RESERVE } from '../../label/emit';
import { compactValueTextSize, fitsInside, segmentLabelCandidates, segmentTooShort, warnSliverLabels } from '../band/labels';
import { totalLabelCandidates } from '../band/totals';
import { rankValueLabels } from '../band/valueDensity';
import { REFERENCE_MARKER_R } from '../band/ticks';
import { restValueHiding, restValuesHidden } from '../../restLabels';
import { textFor, toDateOnValues } from './domain';
import { toDateLabel } from '../../partialPeriod';
import { chartString } from '../../strings';
import { labelOn } from '../labelOn';
import { emphasisWeight } from '../../theme';
import { barHalves, LABEL_GAP, TOTAL_COLUMN, type BarArea, type BarDomain, type BarMarkGeometry, type BarPaints, type NormSeries } from './model';
import { noteName } from '../../calendarData';
import { disclosuresShown } from '../../notes';
import { onePartDrawn, printsValue } from '../band/stacks';
import { maxOf, minOf, pushAll } from '../../arrays';

/** A series that stands out of a stack: a highlight role or an authored highlight, painted in its own colour. */
function emphasizedSeries(domain: BarDomain, s: NormSeries): boolean {
  return domain.variant !== 'grouped' && domain.dataSeries.length > 1 && !s.fill &&
    (s.colorRole === 'highlight' || (!s.colorRole && domain.highlights.has(s.id)));
}

/** The bar-family cascade: inside-end → outside-end (mirrored for negatives). */
function endCandidates(
  area: BarArea,
  rect: Rect,
  positive: boolean,
  tsize: { width: number; height: number },
  fillCss: string,
  range?: DataRange,
  outsideOnly = false,
): SlotCandidate[] {
  const { x } = area;
  const cy = rect.y + rect.h / 2;
  // The bar family's own padding (10 across, 2 along) plus the inside floor (28 x 14 px).
  const fits = fitsInside(rect, { width: 0, height: 0 }) && tsize.width + 10 <= rect.w && tsize.height + 2 <= rect.h;
  const inside: SlotCandidate = {
    slot: 'insideEnd',
    rect: {
      x: positive ? rect.x + rect.w - LABEL_GAP - tsize.width : rect.x + LABEL_GAP,
      y: cy - tsize.height / 2,
      w: tsize.width,
      h: tsize.height,
    },
    penalty: 0,
    insideFill: fillCss,
  };
  const outside: SlotCandidate = {
    slot: 'outsideEnd',
    rect: {
      x: range
        ? positive
          ? Math.max(rect.x + rect.w, x(range.low), x(range.high)) + LABEL_GAP
          : Math.min(rect.x, x(range.low), x(range.high)) - LABEL_GAP - tsize.width
        : positive
          ? rect.x + rect.w + LABEL_GAP
          // With the labels outside and bars on both sides of
          // zero, a negative value reads right of the zero line, where the
          // positive values start, so the negative side holds only its bars.
          : area.negativeLabelsAcross
            ? area.x0 + LABEL_GAP
            : rect.x - LABEL_GAP - tsize.width,
      y: cy - tsize.height / 2,
      w: tsize.width,
      h: tsize.height,
    },
    penalty: 1,
  };
  // A theme's `marks.barLabels: 'outside'`: past the end or not at
  // all. A label with no room there is dropped and reported as any hidden
  // label is. A label that does not fit inside is never kept there on a
  // halo either: outside, or dropped.
  if (outsideOnly || !fits) return [{ ...outside, penalty: 0 }];
  return [inside, outside];
}

/**
 * Phase 3: every label request the chart makes before the local annotations,
 * in solver order: row by row the value labels, the grand total and the
 * category name, then the net line's label.
 */
export function planBarLabels(domain: BarDomain, paints: BarPaints, area: BarArea, scene: BarMarkGeometry, warnings: LintWarning[]): LabelRequest[] {
  const { options, measure, highlights, cats, dataSeries, variant, totals, plotRange } = domain;
  const { labelFont, strongFont, tickFont, pointFont, compact, band } = area;
  const requests: LabelRequest[] = [];
  const slivers: string[] = [];
  const maxTotal = maxOf(totals);
  const minTotal = minOf(totals);
  const bonus = (catId: Id, seriesId?: Id) =>
    highlights.has(catId) || (seriesId !== undefined && highlights.has(seriesId))
      ? PRIORITY.highlightBonus
      : 0;
  const halves = barHalves(options);
  // valueLabels picks each series' values (band/valueSelection.ts); a value it does
  // not pick gets no request, so the note does not name it. An authored cell label prints in every mode.
  const mode = variant === 'grouped' ? options.valueLabels : undefined;
  const chosen = mode === undefined ? undefined
    : new Map(dataSeries.map((s) => [s.id, chosenValueIndices(mode, cats.map((_, ci) => s.cells[ci]?.v ?? null))]));
  // A running category's value says so under it, in the secondary step and the muted ink, past the bar's end.
  const toDateIds = toDateOnValues(domain);
  const toDate = options.strings?.toDate ?? chartString(options, 'toDate');
  cats.forEach((cat, ci) => {
    let part: Id | undefined;
    let partText: string | undefined;
    const rowCenter = band.position(ci) + band.bandwidth / 2;
    // The outermost segment on each side of a stack has free room past its end.
    const outer = variant === 'stacked' ? outerSegments(scene.bars[ci]!) : [];
    for (const { s, si, v, val, rect: own } of scene.bars[ci]!) {
      // The half that carries the option's label measures and centres it on
      // both halves together (barHalves).
      const twin = halves?.pos === s.id ? scene.bars[ci]!.find((bar) => bar.s.id === halves.neg)?.rect : undefined;
      const rect = twin ? unionRect(twin, own) : own;
      const cell = s.cells[ci]!;
      const owner = { seriesId: s.id, categoryId: cat.id };
      const { paint, pattern } = paints.cell(s, cat, cell.meta, cell.v);
      if (variant === 'grouped') {
        // Thin bars label the first series; a highlighted value is still
        // offered, and the solver drops it last.
        if (!labelOn(options, 'point') || (area.thinBars && si !== 0 && bonus(cat.id, s.id) === 0)) continue;
        if (chosen && !chosen.get(s.id)?.has(ci) && typeof cell.meta?.label !== 'string') continue;
        const text = textFor(domain, v, cell.meta, undefined, s);
        if (!text) continue;
        // A highlighted value draws in the emphasis weight (label emit), so its seat and to-date head are set at it.
        const valueFont = bonus(cat.id, s.id) > 0 ? { ...pointFont, weight: emphasisWeight(domain.theme) } : pointFont;
        const words = toDateIds.has(cat.id) ? toDateLabel(text, valueFont, toDate, domain.theme, measure) : undefined;
        const measured = measure(text, valueFont);
        // A compact label claims its ink height, not its line box, so it
        // sits inside a bar thinner than a line without touching the next.
        const tsize = words?.size ?? (compact ? compactValueTextSize('horizontal', measured, pointFont.size) : measured);
        requests.push({
          id: `point:${s.id}:${cat.id}`,
          kind: 'point',
          markAnchored: true,
          owner,
          text,
          lines: words?.lines ?? [text],
          ...words?.request,
          typeRole: 'label', font: pointFont,
          ...(bonus(cat.id, s.id) > 0 ? { protect: true, emphasis: true } : {}),
          ...(typeof cell.meta?.label === 'string' ? { keepWhenDense: true as const } : {}),
          // An authored label prints the value only through its ${value} slot.
          ...namesOnly(undefined, cell.meta?.label),
          // Thin bars: a compact label may touch its neighbour's slot edge to edge.
          ...(compact ? { pad: 0 } : {}),
          priority: cell.meta?.priority ?? (ci === 0 || ci === cats.length - 1
            ? PRIORITY.endpoint
            : totals[ci] === maxTotal || totals[ci] === minTotal
              ? PRIORITY.extreme
              : PRIORITY.interior + Math.min(99, Math.abs(v))) + bonus(cat.id, s.id),
          candidates: endCandidates(area, rect, v >= 0, tsize, paints.css(paint, pattern), plotRange(ci, si), domain.theme.marks?.barLabels === 'outside' || words !== undefined)
            .map(candidate => ({ ...candidate, insidePaint: paint, insidePattern: pattern })),
        });
        continue;
      }
      if (!labelOn(options, 'segment')) continue;
      // An n.m. or n/a row draws no parts: its glyph is the whole reading, with no 0% share beside it.
      if (domain.nmRows[ci] || domain.naRows[ci]) continue;
      // a zero segment has no extent to label; only an authored label prints.
      if (v === 0 && typeof cell.meta?.label !== 'string') continue;
      // A share of a stack with a missing part is a share of the known parts
      // only; it is not printed. An authored total100 is a known whole.
      // The value it would have carried is still lost on the canvas, so the note names it.
      if (variant === 'stacked100' && domain.incompleteRows.has(cat.id) && cat.total100 === undefined) {
        const value = textFor(domain, v, cell.meta, undefined, s);
        // An n.m. or n/a row says so on the canvas already.
        if (value && !domain.nmRows[ci] && !domain.naRows[ci]) requests.push({
          id: `segment:${s.id}:${cat.id}`, kind: 'segment', owner, text: value, lines: [value], typeRole: 'label', font: labelFont,
          priority: PRIORITY.interior, redundant: true, suppressedAs: 'density', owed: true, noteText: `${s.label} ${value} (${noteName(cat)})`, candidates: [],
        });
        continue;
      }
      const text = textFor(domain, v, cell.meta, variant === 'stacked100' ? val : undefined, s, cat.id);
      if (!text) continue;
      // The highlighted series' values print bold, as its fill stands out.
      const segmentFont = emphasizedSeries(domain, s) ? strongFont : labelFont;
      const tsize = measure(text, segmentFont);
      // A value prints in every segment it fits in: a label the tight inside
      // slot holds (as wide as its segment, over the 28 x 14 px inside floor)
      // passes the gate, so a 30 px likert segment holds a 28 px label.
      // A Rest series prints no value by default on the dashboard target (labels.restSeries); the note line owes it.
      const plain = bonus(cat.id, s.id) === 0;
      const restHidden = typeof cell.meta?.label !== 'string' && plain && restValuesHidden(options, s.colorRole);
      const sliver = !restHidden && plain && !fitsInside(rect, tsize, 0) && segmentTooShort(options.labelDensity ?? 'smart', rect.w, tsize.width, options.labelPlacements?.[`segment:${s.id}:${cat.id}`]);
      // A stack of one drawn part prints its number once, as the total, where the total prints.
      // An authored text with the value prints once too: the total carries that text. A zero cell beside the part is not it.
      const onePart = variant === 'stacked' && (typeof cell.meta?.label !== 'string' || printsValue(cell.meta.label)) && v !== 0 && onePartDrawn(dataSeries.map((x) => x.cells[ci]!.v));
      // A value its segment cannot hold, at the outer end of its stack, prints just past that end,
      // keyed by a swatch of its colour as a 100 % bar's share row is, so it does not read as the
      // row's total. Where that room is taken, it is hidden as before: a sliver as too narrow.
      const endSeat = !restHidden && !twin && !onePart && !(dataSeries.length === 1 && domain.grandTotalsOn)
        && outer.includes(own) && options.labelDensity !== 'minimal' && !fitsInside(rect, tsize, 0)
        ? stackEndSeat(own, v < 0, rowCenter, tsize) : undefined;
      if (endSeat) {
        requests.push({
          id: `segment:${s.id}:${cat.id}`,
          kind: 'segment',
          owner,
          ...namesOnly(undefined, cell.meta?.label),
          text,
          lines: [text],
          typeRole: 'label', font: segmentFont,
          ...(segmentFont !== labelFont ? { fontStep: segmentFont } : {}),
          ...(bonus(cat.id, s.id) > 0 ? { protect: true } : {}),
          swatch: paint,
          priority: cell.meta?.priority ?? PRIORITY.interior + Math.min(99, Math.abs(val)) + bonus(cat.id, s.id),
          pad: 3,
          ...(sliver ? { quietWhenCrowded: true as const, owed: true as const } : {}),
          noteText: `${s.label} ${text} (${noteName(cat)})`,
          candidates: [endSeat],
        });
        continue;
      }
      // On a 100 % bar a share too short for its segment prints
      // in a share row past the bar's end, keyed by a swatch of its colour.
      if (sliver && variant === 'stacked100') requests.push({ ...shareRowRequest(area, s.id, cat.id, ci, text, paint, labelFont, measure), ...namesOnly(undefined, cell.meta?.label) });
      // A value the total prints is not lost.
      else if (sliver && !((dataSeries.length === 1 || onePart) && domain.grandTotalsOn)) slivers.push(`${s.label} in ${cat.label}`);
      if (onePart) {
        part = `segment:${s.id}:${cat.id}`;
        partText = typeof cell.meta?.label === 'string' ? text : undefined;
      }
      requests.push({
        id: `segment:${s.id}:${cat.id}`,
        kind: 'segment',
        owner,
        ...(onePart ? { printedIn: `grandTotal:${cat.id}` } : {}),
        // A split neutral prints its full share once, over both halves.
        ...(twin ? { printsFor: [owner, { seriesId: halves!.neg, categoryId: cat.id }] } : {}),
        ...namesOnly(undefined, cell.meta?.label),
        text,
        lines: [text],
        typeRole: 'label', font: segmentFont,
        ...(segmentFont !== labelFont ? { fontStep: segmentFont } : {}),
        ...(bonus(cat.id, s.id) > 0 ? { protect: true } : {}),
        priority:
          cell.meta?.priority ??
          PRIORITY.interior + Math.min(99, Math.abs(val)) + bonus(cat.id, s.id),
        // Inside its segment only, so the segment's own edges are its air:
        // the theme's label pad (5 px in some house themes) against the
        // neighbouring segment would blank a value that fits.
        pad: 0,
        // single-segment stacks never print value + identical total;
        // a segment shorter than its label hides the value, unless it
        // is the highlighted one, which the solver drops last
        redundant: (dataSeries.length === 1 && domain.grandTotalsOn) || sliver,
        // A sliver's value is lost on the canvas, so the note names it (an authored 'minimal' drops it by choice).
        ...(sliver && variant !== 'stacked100' && !(dataSeries.length === 1 && domain.grandTotalsOn) && options.labelDensity !== 'minimal'
          ? { suppressedAs: 'density' as const, owed: true as const, noteText: `${s.label} ${text} (${noteName(cat)})` } : {}),
        ...(restHidden ? restValueHiding(`${s.label} ${text} (${noteName(cat)})`) : {}),
        // Inside the segment only: past the bar end a value reads as the row's
        // total, and on a 100 % bar it repeats one segment's share unnamed.
        candidates: segmentLabelCandidates('horizontal', rect, tsize, paints.css(paint, pattern), { insidePaint: paint, insidePattern: pattern }),
      });
    }
    // A stack with a missing part prints the sum of its drawn parts, as on column; a 100% bar has no known whole.
    if (variant !== 'grouped' && domain.grandTotalsOn && !domain.nmRows[ci] && !domain.naRows[ci] && !(variant === 'stacked100' && domain.incompleteRows.has(cat.id))) {
      const text = partText ?? domain.totalFmt(totals[ci]!);
      // A running row says "to date" under its total; a stack that misses a part says "(partial)".
      const second = toDateIds.has(cat.id) ? toDate : domain.incompleteRows.has(cat.id) && disclosuresShown(domain.options) ? domain.options.strings!.incomplete! : undefined;
      const words = second ? toDateLabel(text, strongFont, second, domain.theme, measure) : undefined;
      const tsize = words?.size ?? measure(text, strongFont);
      // A total the caller sets in a column takes its column seat first; the seats past the bar's end stay as fallbacks.
      const column = (options as { [TOTAL_COLUMN]?: number })[TOTAL_COLUMN];
      const candidates = [
        ...(column === undefined || words ? [] : [{ slot: 'column', rect: { x: column - tsize.width, y: rowCenter - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0 }]),
        ...totalLabelCandidates('horizontal', { x: area.x(domain.rowEnds[ci]!.pos), y: rowCenter }, tsize)
          .map((candidate) => column === undefined || words ? candidate : { ...candidate, penalty: candidate.penalty + 1 }),
      ];
      const end = [...scene.bars[ci]!].reverse().find(bar => bar.v > 0);
      if (!words && end && tsize.width + 10 <= end.rect.w && tsize.height + 2 <= end.rect.h) {
        const cell = end.s.cells[ci]!;
        const { paint, pattern } = paints.cell(end.s, cat, cell.meta, cell.v);
        candidates.push({ slot: 'insideEnd', rect: { x: end.rect.x + end.rect.w - LABEL_GAP - tsize.width, y: rowCenter - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 2,
          insideFill: paints.css(paint, pattern), insidePaint: paint, insidePattern: pattern });
      }
      requests.push({
        id: `grandTotal:${cat.id}`,
        kind: 'grandTotal',
        markAnchored: true,
        // The total prints the value alone: it names its one part back, so a pinned part placed first takes the value.
        ...(part && !words ? { printedIn: part } : {}),
        owner: { categoryId: cat.id },
        text,
        lines: words?.lines ?? [text],
        ...words?.request,
        typeRole: 'label', font: strongFont,
        priority: PRIORITY.grandTotal + bonus(cat.id),
        // A highlighted stack's total keeps the full ink under labels.ink 'muted'.
        ...(bonus(cat.id) > 0 ? { emphasis: true } : {}),
        candidates,
      });
    }
    // category label (left band, right-aligned toward the rows)
    if (labelOn(options, 'category')) {
      const cl = area.catLines[ci]!;
      requests.push({
        id: `category:${cat.id}`,
        kind: 'category',
        owner: { categoryId: cat.id },
        text: cat.label,
        ...fittedLabel(cl, tickFont),
        typeRole: 'axis', font: tickFont,
        priority: PRIORITY.endpoint + bonus(cat.id),
        candidates: [
          {
            slot: 'left',
            rect: {
              // Row labels share ONE left edge by default; 'right' restores the
              // block-against-the-plot behaviour (see rowLabelX).
              x: rowLabelX(area.frame.plot.x, area.catBandW, cl.w, options.rowLabels?.align ?? 'left'),
              y: rowCenter - cl.h / 2,
              w: cl.w,
              h: cl.h,
            },
            penalty: 0,
          },
        ],
      });
    }
  });
  pushAll(requests, referenceLabels(domain, area));

  // A bar segment has no leader seat outside it, so 'full' density would not bring the value back.
  warnSliverLabels(warnings, slivers, 'widen the chart, or shorten the values with a coarser format');
  rankValueLabels(requests, request => {
    const ci = cats.findIndex(c => c.id === request.owner.categoryId);
    if (ci < 0) return undefined;
    return request.kind === 'grandTotal' ? totals[ci]
      : dataSeries.find(s => s.id === request.owner.seriesId)?.cells[ci]?.v;
  }, options.labelDensity ?? 'smart', options.labelPlacements, {
    categories: cats.length, pitch: band.step / (variant === 'grouped' ? dataSeries.length : 1), orientation: 'horizontal', measure,
  });
  return requests;
}

/** Room a share-row entry takes before its digits: its swatch and gap. */
export const SHARE_ROW_SWATCH = SWATCH_RESERVE;

/** One share in a 100 % bar's share row: the first free seat right of the bar's end. */
/** The drawn segments at the outer ends of one stack: the leftmost below zero, the rightmost above it. */
function outerSegments(bars: readonly { v: number; rect: Rect }[]): Rect[] {
  const below = bars.filter((bar) => bar.v < 0).map((bar) => bar.rect);
  const above = bars.filter((bar) => bar.v > 0).map((bar) => bar.rect);
  return [
    ...(below.length ? [below.reduce((a, b) => (b.x < a.x ? b : a))] : []),
    ...(above.length ? [above.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a))] : []),
  ];
}

/** The seat past a stack's outer end, the swatch first: left of a stack below zero, right of one above it. */
function stackEndSeat(rect: Rect, below: boolean, rowCenter: number, tsize: { width: number; height: number }): SlotCandidate {
  const w = tsize.width + SHARE_ROW_SWATCH;
  const x = below ? rect.x - STACK_END_GAP - w : rect.x + rect.w + STACK_END_GAP;
  return { slot: 'outsideEnd', rect: { x, y: rowCenter - tsize.height / 2, w, h: tsize.height }, penalty: 0 };
}

/** Air between a stack's end and a sliver's value past it, as a 100 % bar's share row keeps. */
const STACK_END_GAP = 6;

function shareRowRequest(area: BarArea, seriesId: Id, catId: Id, ci: number, text: string, paint: Paint, font: FontSpec, measure: TextMeasurer): LabelRequest {
  const { band, x, plot } = area;
  const size = measure(text, font);
  const w = size.width + SHARE_ROW_SWATCH;
  const cy = band.position(ci) + band.bandwidth / 2 - size.height / 2;
  const right = plot.x + plot.w - w;
  const seats: SlotCandidate[] = [];
  for (let at = x(100) + 6, k = 0; at <= right + 0.5 && k < 40; at += 4, k++) {
    seats.push({ slot: k === 0 ? 'shareRow' : `shareRow${k}`, rect: { x: Math.min(at, right), y: cy, w, h: size.height }, penalty: k / 100 });
  }
  return {
    id: `share:${seriesId}:${catId}`,
    kind: 'segment',
    owner: { seriesId, categoryId: catId },
    text, lines: [text], typeRole: 'label', font,
    swatch: paint,
    priority: PRIORITY.interior,
    pad: 3,
    candidates: seats,
  };
}

/** A reference value as it prints beside its tick: the value, then the reference's name ("117 Prior year"). */
export function referenceLabelText(domain: BarDomain, s: NormSeries, v: number, meta: CellMeta | null): string | null {
  const value = textFor(domain, v, meta, undefined, s);
  return value === null ? null : `${value} ${s.label}`;
}

/**
 * Every reference prints its value. The value stands on its own
 * row, right of the tick, or further right past the bar's own value where the
 * bar or its label takes that seat; a tick past the bar end may also take its
 * left. The muted ink and the name keep it apart from the bar's value.
 */
function referenceLabels(domain: BarDomain, area: BarArea): LabelRequest[] {
  const { options, cats, refSeries, variant, measure } = domain;
  if (variant === 'stacked100' || !labelOn(options, 'tick')) return [];
  const { tickFont, band, x, plot } = area;
  const requests: LabelRequest[] = [];
  for (const s of refSeries) cats.forEach((cat, ci) => {
    const { v, meta } = s.cells[ci]!;
    if (v === null) return;
    const text = referenceLabelText(domain, s, v, meta);
    if (!text) return;
    const size = measure(text, tickFont);
    const cy = band.position(ci) + band.bandwidth / 2 - size.height / 2;
    const rx = x(v);
    // Clear of the tick's stroke, or of the whole dot of a marker.
    const clear = domain.referenceStyle === 'marker' ? REFERENCE_MARKER_R + 4 : 4;
    const right = plot.x + plot.w - size.width;
    const seats: SlotCandidate[] = [];
    for (let at = rx + clear, k = 0; at <= right + 0.5 && k < 60; at += 6, k++) {
      seats.push({ slot: k === 0 ? 'rightOfTick' : `rightOfTick${k}`, rect: { x: Math.min(at, right), y: cy, w: size.width, h: size.height }, penalty: k === 0 ? 0 : 1 + k / 100 });
    }
    seats.push({ slot: 'leftOfTick', rect: { x: rx - clear - size.width, y: cy, w: size.width, h: size.height }, penalty: 2 });
    requests.push({
      id: `tick:${s.id}:${cat.id}`,
      kind: 'tick',
      owner: { seriesId: s.id, categoryId: cat.id },
      text,
      lines: [text],
      typeRole: 'label', font: tickFont,
      // After every value of the bars: a reference value takes the seat the bars leave.
      priority: PRIORITY.interior - 1,
      // A word's space from the bar's own value, so the two read as two numbers.
      pad: 6,
      candidates: seats,
    });
  });
  return requests;
}

