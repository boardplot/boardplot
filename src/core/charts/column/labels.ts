/**
 * Column phase 3, label planning: the phase 2 geometry in, label requests
 * for the solver out. The value labels come first (their font step reports
 * before the adjacency lint runs over the marks), then the totals, the
 * anomaly rule, the reference ticks, the net line and the category row.
 */

import { chosenValueIndices } from '../band/valueSelection';
import { namesOnly } from '../../markVisibility';
import type { Rect } from '../../geometry';
import { notApplicableGlyph, numberRange } from '../../format';
import { formatWithSpec } from '../../formatSpec';
import { categoryLineAlign, ROTATED_NAME_AIR, rotatedClaimRect, verticalNameRect, yearRowRequests } from '../../label/categoryRow';
import { REFERENCE_MARKER_R } from '../band/ticks';
import { PRIORITY, SERIES_VALUE_GAP, type LabelRequest, type SlotCandidate } from '../../label/solver';
import type { DataRange } from '../../rangeRules';
import type { FontSpec } from '../../text';
import type { LabelContent } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import { compactValueLabelFont, fitsInside, groupedValueLabelPolicy, linesSize, digitSeat, digitSeatEdge, segmentLabelCandidates, segmentTooShort, STACK_ROOM, valueRowCrowded, valueShareLines, warnShareParts, warnSliverLabels } from '../band/labels';
import { stepDownFont } from '../../label/rowFit';
import { lineBox } from '../../label/fitText';
import { groupedOffsets } from '../band/groups';
import { totalLabelCandidates } from '../band/totals';
import { rankValueLabels } from '../band/valueDensity';
import { netLineName, onePartDrawn, printsValue } from '../band/stacks';
import { restValueHiding, restValuesHidden } from '../../restLabels';
import { emphasisWeight } from '../../theme';
import { NET_TICK_REACH, netInsideStack, outsideTickReach } from './marks';
import type { IntegratedVariancePoint } from './layout';
import { contentOf, edgeNameFont, kindSetting, pyTickKeyed, rightEdgeSeriesLabels, RIGHT_EDGE_GAP, shareTextOf, toDateOnValues } from './domain';
import { toDateLabel } from '../../partialPeriod';
import {
  ANOMALY_FLAG_GAP,
  ANOMALY_FLAG_H,
  type BarPlace,
  type ColumnArea,
  type ColumnDomain,
  type ColumnMarkGeometry,
  type ColumnPaints,
  PY_TICK_LEAD,
} from './model';
import { composedTextRole } from '../../textRole';
import { textScaleOf } from '../../typeFloors';
import { noteName } from '../../calendarData';
import { chartString } from '../../strings';
import { disclosuresShown } from '../../notes';
import { maxOf, minOf, pushAll } from '../../arrays';

/** The label's parts as lines: the value and its share one over the other, the rest on one line. */
function composeLines(
  domain: ColumnDomain,
  content: LabelContent,
  abs: number | null,
  pct: number | null,
  catLabel: string,
  serLabel: string,
  authoredPct: boolean,
  valueFmt: (v: number) => string,
  /** The segment's ids, for its sum-consistent share text. */
  ids?: { categoryId: string; seriesId: string },
): string[] {
  const parts: [LabelContent[number], string][] = [];
  for (const c of content) {
    if (c === 'absolute' && abs !== null) parts.push([c, valueFmt(abs)]);
    else if (c === 'percent' && pct !== null) parts.push([c, ids ? shareTextOf(domain, ids.categoryId, ids.seriesId, pct, authoredPct) : authoredPct ? domain.authoredPctFmt(pct) : domain.pctFmt(pct)]);
    else if (c === 'category' && catLabel) parts.push([c, catLabel]);
    else if (c === 'series' && serLabel) parts.push([c, serLabel]);
  }
  return valueShareLines(parts);
}

function composeText(...args: Parameters<typeof composeLines>): string {
  return composeLines(...args).join(' ');
}

/**
 * An empty category prints one "n/a" on the baseline; on a 100% stack its
 * n/a glyph is drawn already. A missing part of a drawn stack prints
 * nothing: the column shows the parts it has, and the notes list names the gap.
 */
function emptyCategoryMarkers(domain: ColumnDomain, area: ColumnArea, requests: LabelRequest[]): void {
  if (domain.variant === 'grouped') return;
  const { band, tickFont } = area;
  const na = notApplicableGlyph(domain.options.strings);
  domain.cats.forEach((c, ci) => {
    if (!domain.emptyCats.has(c.id) || domain.naCats100.has(c.id)) return;
    const size = domain.measure(na, tickFont);
    requests.push({
      id: `na:${c.id}`, kind: 'segment', role: 'value',
      owner: { categoryId: c.id },
      text: na, lines: [na], typeRole: 'label', font: tickFont,
      priority: PRIORITY.endpoint,
      candidates: [{ slot: 'aboveBaseline', rect: { x: band.center(ci) - size.width / 2, y: area.y0 - size.height - 6, w: size.width, h: size.height }, penalty: 0 }],
    });
  });
}

/** The slivers' digit seats, filled by planColumnValueLabels and seated by the layout after every other label. */
export interface DigitSeats {
  requests: LabelRequest[];
  /** Every sliver of the chart in its warning order: label id and the name the warning prints. */
  slivers: (readonly [string, string])[];
  /** Where the sliver warning stands among the warnings. */
  warningAt: number;
}

/**
 * A suppressed value with no seat inside its segment keeps its box there: the
 * solver never places it, and the box tells the grid's growth search how
 * much segment the value needs.
 */
function seatsOrBox(seats: SlotCandidate[], rect: Rect, tsize: { width: number; height: number }, suppressed: boolean): SlotCandidate[] {
  if (seats.length > 0 || !suppressed) return seats;
  return [{ slot: 'insideCenter', rect: { x: rect.x + rect.w / 2 - tsize.width / 2, y: rect.y + rect.h / 2 - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0 }];
}

/** The composed label lines with the cell's `${value}` override applied; null when there is none to show. */
function valueLines(domain: ColumnDomain, place: BarPlace, content: LabelContent, pct: number | null): { text: string; lines: string[] } | null {
  const { s, c, ci } = place;
  const val = s.vals[ci]!;
  // An authored percent cell keeps its '%' on the value.
  const valueFmt = val.isPct && !val.format && !s.format ? domain.valueSpec.fmtPercent : domain.valueSpec.forSeries(s, val.format);
  let lines = composeLines(domain, content, domain.absOf(s, ci), pct, c.label ?? c.id, s.label, pct !== null && val.isPct, valueFmt, { categoryId: c.id, seriesId: s.id });
  let text = lines.join(' ');
  if (typeof val.labelOverride === 'string') {
    text = val.labelOverride.replace(/\$\{value\}/g, text);
    lines = [text];
  }
  return !text && val.labelOverride !== false ? null : { text, lines };
}

/** A cell's value as its label prints it: the cell or series format, an authored percent cell's '%' and the `${value}` override. */
export function cellValueText(domain: ColumnDomain, s: ColumnDomain['dataSeries'][number], ci: number): string | null {
  const val = s.vals[ci]!;
  const abs = domain.absOf(s, ci);
  if (abs === null) return null;
  const valueFmt = val.isPct && !val.format && !s.format ? domain.valueSpec.fmtPercent : domain.valueSpec.forSeries(s, val.format);
  const text = valueFmt(abs);
  return typeof val.labelOverride === 'string' ? val.labelOverride.replace(/\$\{value\}/g, text) : text;
}

/** Grouped value labels: one font for all, stepped down when any label is wider than its column. */
function pointRequests(
  domain: ColumnDomain,
  paints: ColumnPaints,
  area: ColumnArea,
  scene: ColumnMarkGeometry,
  requests: LabelRequest[],
  warnings: LintWarning[],
): FontSpec {
  const { options, measure, highlights, cats, dataSeries, anomaly, rangeOf } = domain;
  const { labelFont, band, y } = area;
  const content = contentOf(options, 'point', ['absolute']);
  if (content?.includes('percent')) {
    warnings.push({
      code: 'label-part-unavailable',
      severity: 'warn',
      message: "grouped columns are not parts of a whole, so the value labels print no percent part",
      suggest: "use variant 'stacked' or 'stacked100' to print each column's share, or drop 'percent' from labels.point",
    });
  }
  const pendingPoints: { place: BarPlace; text: string; priority: number; protect: boolean; hl: boolean }[] = [];
  // valueLabels picks each series' values (band/valueSelection.ts). A value it
  // does not pick gets no request, so the note does not name it. An authored cell label and a
  // flagged period print in every mode, as on line.
  const mode = options.valueLabels;
  const chosen = mode === undefined ? undefined
    : new Map(dataSeries.map((s) => [s.id, chosenValueIndices(mode, cats.map((_, ci) => s.vals[ci]?.v ?? null))]));
  for (const place of content ? scene.bars : []) {
    const { s, c, ci, v } = place;
    if (chosen && !chosen.get(s.id)?.has(ci) && typeof s.vals[ci]?.labelOverride !== 'string' && anomaly?.flagByCategory.has(c.id) !== true) continue;
    const text = valueLines(domain, place, content!, null)?.text ?? null;
    if (text === null) continue;
    const endpoint = ci === 0 || ci === cats.length - 1;
    const hl = highlights.has(c.id) || highlights.has(s.id);
    // A flagged period is the one label the exhibit cannot afford to drop:
    // the marker above it is meaningless without the number it flags.
    const flagged = anomaly?.flagByCategory.has(c.id) === true;
    const priority =
      s.vals[ci]!.priority ??
      (flagged
        ? PRIORITY.extreme + PRIORITY.highlightBonus
        : (endpoint ? PRIORITY.endpoint : PRIORITY.interior + Math.min(99, Math.abs(v))) +
          (hl ? PRIORITY.highlightBonus : 0));
    pendingPoints.push({ place, text, priority, protect: hl || flagged, hl });
  }
  // One font for every value label of a grouped chart; it steps
  // down one role when any label is wider than its sub-column.
  const compactLabelFont = compactValueLabelFont(labelFont, domain.theme.type.footnote, domain.options.target, textScaleOf(domain.options));
  const groupSlots = groupedOffsets(band.bandwidth, dataSeries.length);
  const normalSizes = pendingPoints.map((point) => measure(point.text || '0', labelFont));
  const groupedPolicy = groupedValueLabelPolicy(
    'vertical',
    groupSlots[0]?.size ?? band.bandwidth,
    dataSeries.length,
    normalSizes,
    labelFont.size,
    compactLabelFont.size,
  );
  // Neighbours closer than the gap at their natural seats step the row down too.
  const crowded = valueRowCrowded(pendingPoints.map(({ place }, i) => {
    const size = normalSizes[i]!;
    const above = place.v >= 0;
    return { x: place.rect.x + place.rect.w / 2 - size.width / 2, y: above ? place.rect.y - size.height - 4 : place.rect.y + place.rect.h + 4, w: size.width, h: size.height };
  }));
  const steppedForGap = !groupedPolicy.compact && crowded && compactLabelFont.size < labelFont.size;
  const pointFont = groupedPolicy.compact || steppedForGap ? compactLabelFont : labelFont;
  if (groupedPolicy.compact || steppedForGap) {
    warnings.push({
      code: 'value-labels-font-stepped',
      severity: 'info',
      message: steppedForGap
        ? `value labels use the ${pointFont.size}px step: at ${labelFont.size}px neighbouring values stand closer than 6px`
        : `value labels use the ${pointFont.size}px step: at ${labelFont.size}px some are wider than their ${Math.round(pendingPoints[0]?.place.rect.w ?? 0)}px columns`,
    });
  }
  if (groupedPolicy.firstSeriesOnly && content) {
    warnings.push({
      code: 'value-labels-first-series-only',
      severity: 'info',
      message: `columns are ${(groupSlots[0]?.size ?? 0).toFixed(1)}px thick, thinner than a value label; only '${dataSeries[0]!.label ?? dataSeries[0]!.id}' carries value labels${highlights.size > 0 ? ', plus the highlighted values where they fit' : ''}`,
      suggest: 'give the chart more width, or fewer categories, to label every series',
    });
  }
  // The last interval prints its bounds beside its upper cap, once.
  const lastRanged = [...pendingPoints].reverse().find(({ place }) => rangeOf(place.s, place.ci) !== undefined);
  if (lastRanged) {
    const { s, c, ci, rect } = lastRanged.place;
    const range = rangeOf(s, ci)!;
    const fmt = domain.valueSpec.forSeries(s);
    const text = numberRange(fmt(Math.min(range.low, range.high)), fmt(Math.max(range.low, range.high)));
    const size = measure(text, labelFont);
    const cx = rect.x + rect.w / 2;
    const capY = y(Math.max(range.low, range.high));
    requests.push({
      id: `range:${s.id}:${c.id}`,
      kind: 'annotation', role: 'value',
      owner: { seriesId: s.id, categoryId: c.id },
      text, lines: [text], typeRole: 'label', font: labelFont,
      priority: PRIORITY.valueLine,
      candidates: [
        { slot: 'rightOfCap', rect: { x: cx + 8, y: capY - size.height / 2, w: size.width, h: size.height }, penalty: 0 },
        { slot: 'leftOfCap', rect: { x: cx - 8 - size.width, y: capY - size.height / 2, w: size.width, h: size.height }, penalty: 1 },
        { slot: 'aboveCap', rect: { x: cx - size.width / 2, y: capY - size.height - 3, w: size.width, h: size.height }, penalty: 2 },
      ],
    });
  }
  // A running category's value says so under it, in the secondary step and the muted ink.
  const toDateIds = toDateOnValues(domain);
  const toDate = options.strings?.toDate ?? chartString(options, 'toDate');
  const clampX = (r: Rect): Rect => ({ ...r, x: Math.max(area.plot.x, Math.min(r.x, area.plot.x + area.plot.w - r.w)) });
  // A highlighted value draws in the emphasis weight (label emit), so its seat is measured at it.
  const boldFont = { ...pointFont, weight: emphasisWeight(domain.theme) };
  const seated = pendingPoints.map((point) => {
    const { s, c, ci, v, rect } = point.place;
    const words = toDateIds.has(c.id) ? toDateLabel(point.text, point.hl ? boldFont : pointFont, toDate, domain.theme, measure) : undefined;
    const tsize = words?.size ?? measure(point.text || '0', point.hl ? boldFont : pointFont);
    const flag = scene.flagMarkers.get(c.id);
    const outset = flag && flag.outside ? ANOMALY_FLAG_GAP + ANOMALY_FLAG_H : 0;
    const natural = rangeOf(s, ci) ? undefined : pointCandidates(rect, tsize, v < 0, '', y, undefined, outset)[0]!.rect;
    return { ...point, words, tsize, outset, natural: natural && clampX(natural) };
  });
  const rows = valueSeatRows(seated.map(({ natural, place }) => natural && { rect: natural, negative: place.v < 0 }), scene.bars.map(({ rect }) => rect));
  for (const [index, { place, text, priority, protect, hl, words, tsize, outset }] of seated.entries()) {
    const { s, si, c, ci, v, rect } = place;
    // Too thin for every series: the first carries the values. A highlighted
    // value is still offered, and the solver drops it last.
    if (groupedPolicy.firstSeriesOnly && si !== 0 && !protect) continue;
    const val = s.vals[ci]!;
    const insidePaint = paints.cell(s, val, c, si);
    const insidePattern = paints.pattern(s, val, c);
    requests.push({
      id: `point:${s.id}:${c.id}`,
      kind: 'point',
      owner: { seriesId: s.id, categoryId: c.id },
      text,
      lines: words?.lines ?? [text],
      ...words?.request,
      typeRole: 'label', font: pointFont,
      priority,
      // Equal priorities seat left to right, not in id order ('s10' before 's9'), so a stagger alternates rows.
      order: ci,
      ...(protect ? { protect } : {}),
      ...(hl ? { emphasis: true } : {}),
      // Columns that touch (a histogram's bins) leave no air between them: a
      // count as wide as its column sits edge to edge over it.
      ...((options.bandFraction ?? 0) >= 1 ? { pad: 0 } : {}),
      redundant: val.labelOverride === false,
      ...(typeof val.labelOverride === 'string' ? { keepWhenDense: true as const } : {}),
      // A point label prints no percent part (label-part-unavailable).
      ...namesOnly(content!.filter((part) => part !== 'percent'), val.labelOverride),
      candidates: pointCandidates(rect, tsize, v < 0, paints.inside(s, val, c, si), y, rangeOf(s, ci), outset, rows[index])
        .map(candidate => ({ ...candidate, rect: clampX(candidate.rect), insidePaint, insidePattern })),
    });
  }
  return pointFont;
}

/** Phase 3, first half: the value labels, appended to the ratio tier's requests; returns their font. */
export function planColumnValueLabels(
  domain: ColumnDomain,
  paints: ColumnPaints,
  area: ColumnArea,
  scene: ColumnMarkGeometry,
  requests: LabelRequest[],
  warnings: LintWarning[],
  /** Filled with each segment value the note line may name: label id to "Series value (Category)", and the slivers among them. */
  noted: { items: Map<string, string>; slivers: Set<string> } = { items: new Map(), slivers: new Set() },
  /** Filled with the digit seats of slivers (digitSeat), when the caller seats them after every other label. */
  digits?: DigitSeats,
): FontSpec {
  if (domain.variant === 'grouped') return pointRequests(domain, paints, area, scene, requests, warnings);
  // Stacked segment labels, with the sliver gate: a segment shorter
  // than its label hides the value; totals always render.
  const { options, measure, highlights } = domain;
  const { labelFont } = area;
  const stacked100 = domain.variant === 'stacked100';
  const segment = contentOf(options, 'segment', stacked100 ? ['percent'] : ['absolute']);
  // shareLabels prints the value everywhere, adds the share in the columns it
  // names and takes it out of the others. A 100% chart's default content is
  // the share alone, so the value comes first.
  const shares = options.shareLabels;
  const only = shares?.only === undefined ? undefined : new Set(shares.only);
  const base = segment && shares && !segment.includes('absolute') ? ['absolute' as const, ...segment] : segment;
  const contentAt = (categoryId: string): LabelContent | null =>
    !base || !shares ? base
      : !only || only.has(categoryId) ? (base.includes('percent') ? base : [...base, 'percent'])
        : base.filter((part) => part !== 'percent');
  // One pass over the segments at one font. Where a value is wider than its
  // column, the whole row steps down a size and tries again, to the floor.
  const pass = (stepped?: FontSpec) => {
    const slivers: string[] = [];
    const tooWide: string[] = [];
    const pending: { id: string; owed: boolean; authored: boolean }[] = [];
    const sliverOrder: string[] = [];
    const seats: LabelRequest[] = [];
    const noShare = new Set<string>();
    const items = new Map<string, string>();
    const sliverIds = new Set<string>();
    const out: LabelRequest[] = [];
    let anyShare = false;
    for (const place of segment ? scene.bars : []) {

      const { s, si, c, ci, v, rect } = place;
      const val = s.vals[ci]!;
      const content = contentAt(c.id)!;
      const shareAsked = content.includes('percent');
      anyShare ||= shareAsked;
      // A share of a stack with a missing part is a share of the known parts
      // only; it is not printed. An authored total100 is a known whole.
      // Nor has a stack with a negative part a share.
      const share = shareAsked ? domain.shareOf(s, ci) : null;
      if (shareAsked && share === null && !stacked100 && !domain.mixedSignCats.has(c.id) && val.v !== null) noShare.add(c.label ?? c.id);
      const composed = valueLines(domain, place, content, share);
      if (composed === null) continue;
      const { text, lines } = composed;
      // A total column prints its values bold (categories[].role 'total').
      const font = c.role === 'total' ? { ...labelFont, weight: emphasisWeight(domain.theme) } : (stepped ?? labelFont);
      const tsize = linesSize(lines, font, measure);
      // An authored label on a zero cell has no segment to fit; it prints outside on a leader.
      const sliver = !(v === 0 && typeof val.labelOverride === 'string')
        && segmentTooShort(domain.density, rect.h, tsize.height, options.labelPlacements?.[`segment:${s.id}:${c.id}`], STACK_ROOM);
      const hl = highlights.has(c.id) || highlights.has(s.id);
      // A Rest series prints no value by default on the dashboard target (labels.restSeries); the note line owes it.
      const restHidden = val.labelOverride === undefined && !hl && restValuesHidden(options, s.colorRole);
      const owedHere = val.labelOverride !== false && !restHidden;
      // A withheld share does not print: only what prints counts.
      const printed = share === null ? content.filter((part) => part !== 'percent') : content;
      // A stack of one drawn part prints its number once, as the total, where the total prints.
      // A label that prints more than the value (a name, a share) keeps its seat.
      // An authored text with the value prints once too, where the total prints the value alone: the total carries that text.
      // A zero cell beside the part is not it.
      const onePart = !stacked100 && (printsValue(val.labelOverride) ? domain.gtContent?.join() === 'absolute'
        : typeof val.labelOverride !== 'string' && printed.length === 1 && printed[0] === 'absolute')
        && v !== 0 && onePartDrawn(domain.dataSeries.map((x) => x.vals[ci]!.v));
      // Its value prints in the total, so the warnings below do not name it as lost or too wide.
      const inTotal = onePart && domain.gtContent != null;
      if (sliver && !hl && owedHere && !inTotal) { slivers.push(`${s.label} in ${c.label ?? c.id}`); sliverOrder.push(`segment:${s.id}:${c.id}`); }
      const note = `${s.label} ${text} (${noteName(c)})`;
      if (owedHere) items.set(`segment:${s.id}:${c.id}`, note);
      // An authored 'minimal' drops this value at its gate anyway: the author's choice, not a loss the note names.
      if (sliver && !hl && owedHere && domain.density !== 'minimal') sliverIds.add(`segment:${s.id}:${c.id}`);
      const priority =
        val.priority ??
        PRIORITY.interior + Math.min(99, Math.abs(v)) + (hl ? PRIORITY.highlightBonus : 0);
      // A value prints inside its segment or not at all: beside the column it
      // stands over the neighbour and reads as its value. 'full' and an
      // authored label on a zero cell keep the seat outside on a leader.
      const leader = domain.density === 'full' || (v === 0 && typeof val.labelOverride === 'string');
      // A column whose content the author set alone (shareLabels.only) is not held to the others' fit.
      if (!leader && !inTotal && !only?.has(c.id) && typeof val.labelOverride !== 'string' && val.labelOverride !== false && !restHidden && !(sliver && !hl)
        && !fitsInside({ ...rect, h: Infinity }, tsize, 0)) { tooWide.push(c.label ?? c.id); }
      pending.push({ id: `segment:${s.id}:${c.id}`, owed: owedHere && domain.density !== 'minimal', authored: typeof val.labelOverride === 'string' });
      const request: LabelRequest = {
        id: `segment:${s.id}:${c.id}`,
        kind: 'segment',
        owner: { seriesId: s.id, categoryId: c.id },
        ...(onePart ? { printedIn: `grandTotal:${c.id}` } : {}),
        ...namesOnly(printed, val.labelOverride),
        text,
        lines,
        ...(lines.length > 1 ? { align: 'middle' as const } : {}),
        typeRole: 'label', font,
        ...(stepped && c.role !== 'total' ? { fontStep: stepped } : {}),
        priority,
        ...(hl ? { protect: hl } : {}),
        // The sliver gate passes the highlighted value, which the solver drops last.
        redundant: val.labelOverride === false || (sliver && !hl),
        ...(restHidden ? restValueHiding(note) : {}),
        candidates: seatsOrBox(segmentLabelCandidates(
          'vertical',
          rect,
          tsize,
          paints.inside(s, val, c, si),
          { baseline: area.y0, leaderObstacles: scene.refTickYs.get(c.id), insidePaint: paints.cell(s, val, c, si), insidePattern: paints.pattern(s, val, c), insideOnly: !leader },
        ), rect, tsize, val.labelOverride === false || (sliver && !hl)),
      };
      // A sliver the note would name keeps its value when the digits fit the segment.
      // 'minimal' drops it by the author's choice. A pin to the seat asks for it directly.
      const pinnedDigits = options.labelPlacements?.[request.id] === 'insideDigits';
      const seat = (pinnedDigits || (digits && sliver && !hl && owedHere && !inTotal && domain.density !== 'minimal')) && lines.length === 1
        ? digitSeat(rect, text, tsize, measure.capHeight?.(font), font.size, digitSeatEdge(domain.theme, paints.pattern(s, val, c))) : undefined;
      const seatCandidate: SlotCandidate | undefined = seat && {
        slot: 'insideDigits', rect: seat, penalty: 0, pad: 0,
        insideFill: paints.inside(s, val, c, si), insidePaint: paints.cell(s, val, c, si), insidePattern: paints.pattern(s, val, c),
      };
      if (pinnedDigits) out.push(seatCandidate ? { ...request, candidates: [...request.candidates, seatCandidate] } : request);
      else {
        out.push(request);
        if (seatCandidate) seats.push({ ...request, redundant: false, candidates: [seatCandidate] });
      }

    }
    return { slivers, sliverOrder, seats, tooWide, pending, noShare, items, sliverIds, out, anyShare };
  };
  let stepped: FontSpec | undefined;
  let done = pass();
  while (done.tooWide.length > 0) {
    const next = stepDownFont(domain.theme, stepped ?? labelFont, 'label', options.target, textScaleOf(options));
    if (!next) break;
    stepped = next;
    done = pass(stepped);
  }
  const { slivers, tooWide, pending, noShare, anyShare } = done;
  for (const [id, note] of done.items) noted.items.set(id, note);
  for (const id of done.sliverIds) noted.slivers.add(id);
  pushAll(requests, done.out);
  // Segment values print in every column or in none: where one is wider
  // than its column, none prints and the notes list names them.
  if (tooWide.length > 0) {
    const hidden = new Set(pending.filter((entry) => !entry.authored).map((entry) => entry.id));
    for (const request of requests) if (hidden.has(request.id)) request.redundant = true;
    for (const entry of pending) if (hidden.has(entry.id) && entry.owed) noted.slivers.add(entry.id);
    warnings.push({
      code: 'segment-labels-hidden',
      severity: 'info',
      message: `segment values are not printed: some are wider than their column (${[...new Set(tooWide)].slice(0, 5).join(', ')})`,
      suggest: 'widen the chart, use a shorter number format, or set labelDensity \'full\' to print them outside on leaders',
    });
  }
  // A sliver whose digit seat holds its value is not lost: the caller warns once those seats are known.
  if (digits && tooWide.length === 0 && done.seats.length > 0) {
    digits.requests.push(...done.seats);
    digits.slivers = done.sliverOrder.map((id, i) => [id, slivers[i]!] as const);
    digits.warningAt = warnings.length;
  } else warnSliverLabels(warnings, slivers);
  warnShareParts(warnings, anyShare && !stacked100 ? domain.cats.filter((c) => domain.mixedSignCats.has(c.id) && contentAt(c.id)?.includes('percent')).map((c) => c.label ?? c.id) : [], [...noShare]);
  return labelFont;
}

/**
 * The rule sentence. This IS the feature: a reader can see WHY a column is
 * flagged instead of trusting a coloured rectangle.
 */
function anomalyRuleRequest(domain: ColumnDomain, area: ColumnArea, requests: LabelRequest[], warnings: LintWarning[]): void {
  const { anomaly } = domain;
  const { tickFont, frame, plot } = area;
  if (!anomaly) return;
  if (!area.ruleOn) {
    warnings.push({
      code: 'label-hidden',
      severity: 'warn',
      // The label id is spelled into the message on purpose, so
      // that `label '<id>'` can be parsed out of every warning carrying this code.
      message:
        "label 'anomaly:rule' was suppressed by labels.valueLine while its corridor and flag markers still render — the reader is shown a threshold with no stated rule",
      owner: { annotationId: 'anomaly:rule' },
      suggest: 'enable labels.valueLine so the corridor explains itself, or drop options.anomaly',
    });
    return;
  }
  const wrapped = area.ruleWrap!;
  const ruleLines = wrapped.lines;
  if (wrapped.title !== undefined) {
    // A half-printed rule is worse than none: the reader would take the
    // visible fragment for the whole test.
    warnings.push({
      code: 'anomaly-rule-truncated',
      severity: 'warn',
      message: `the anomaly rule sentence does not fit the plot width and was cut: "${area.ruleText}"`,
      owner: { annotationId: 'anomaly:rule' },
      suggest: "use a wider size, or shorten it with anomaly.label",
    });
  }
  const width = Math.max(...ruleLines.map((line) => domain.measure(line, tickFont).width));
  const height = ruleLines.length * tickFont.size * 1.2;
  // Anchored on the FRAME's left edge, not the plot's: the value axis eats
  // into plot.x, and a sentence wrapped to the frame width but placed at
  // plot.x runs off the canvas and every candidate is rejected — which would
  // make the rule go missing.
  const at = (yy: number): Rect => ({ x: frame.plot.x + 2, y: yy, w: width, h: height });
  requests.push({
    id: 'anomaly:rule',
    kind: 'tick',
    // Same annotation id as the reserve claim, so the solver treats that
    // claim as this label's own instead of as a collision.
    owner: { annotationId: 'anomaly:rule' },
    text: anomaly.rule,
    lines: ruleLines,
    ...(wrapped.title !== undefined ? { title: wrapped.title } : {}),
    typeRole: 'footnote', font: tickFont,
    priority: PRIORITY.valueLine,
    candidates: [
      // The band reserved for it above the plot. Everything after this is a
      // fallback for the case where authored furniture took the band.
      { slot: 'ruleBand', rect: at(frame.plot.y + 2), penalty: 0 },
      { slot: 'plotTop', rect: at(plot.y + 2), penalty: 1 },
      { slot: 'plotBottom', rect: at(plot.y + plot.h - height - 2), penalty: 2 },
    ],
  });
}

/**
 * Category labels (prose wraps 2 lines; date/numeric ticks: one row,
 * centred on their bands, no stagger).
 */
function categoryRequests(domain: ColumnDomain, area: ColumnArea, requests: LabelRequest[]): void {
  const { cats, anomaly } = domain;
  const { catPlan, band } = area;
  // Date/numeric ticks are one line on one row; prose wraps to two.
  const dateTicks = catPlan.dateNumeric;
  // Anomaly corridor rules share the lane under the plot with shallow
  // category labels. Keep the solver's 2px clearance from the bar while
  // using the otherwise spare 2px to keep the category in that lane.
  const categoryLabelGap = anomaly ? 4 : 6;
  const catX = catPlan.x;
  const keep = catPlan.keep;
  const namesLost = !dateTicks && catPlan.warnings.some((w) => w.code === 'category-stride' && w.severity === 'warn');
  const rotated = catPlan.rotation !== 0;
  // One row under the lowest column and the value hanging under it.
  // A negative column's name stays in that row, as every other name does,
  // and never hops above the baseline beside a positive column's value.
  const rowY = area.catRowY + categoryLabelGap;
  cats.forEach((c, ci) => {
    const info = catPlan.infos[ci]!;
    // A total head and a highlighted name print bold (layout.ts): the seat takes the bold width, still centred on its column.
    const bold = !rotated && (c.role === 'total' || domain.highlights.has(c.id));
    const boldFont = { ...catPlan.font, weight: emphasisWeight(domain.theme) };
    const w = bold ? Math.max(info.w, ...info.lines.map((line) => domain.measure(line, boldFont).width)) : info.w;
    const at = (yy: number): Rect => ({ x: catX(ci) - (w - info.w) / 2, y: yy, w, h: info.h });
    const below = { slot: 'below', rect: at(rowY), penalty: 0 };
    const belowShifted = { slot: 'belowShifted', rect: at(rowY + area.gtH + 4), penalty: 1 };
    requests.push({
      id: `category:${c.id}`,
      kind: 'category',
      owner: { categoryId: c.id },
      text: c.label ?? c.id,
      lines: info.lines,
      ...categoryLineAlign(catPlan, ci),
      ...(info.title !== undefined ? { title: info.title } : {}),
      typeRole: catPlan.typeRole, font: c.role === 'total' ? boldFont : catPlan.font,
      priority: PRIORITY.endpoint,
      // A stride-hidden date label is the row's decision (one info lint), not a loss.
      // A name a nominal row leaves out did not fit: the reader lost it.
      ...(keep[ci] ? {} : namesLost && (c.label ?? c.id).trim() !== '' ? { redundant: true, suppressedAs: 'density' as const } : { redundant: true }),
      ...(rotated ? { rotate: catPlan.rotation === 90 ? -90 : -45 } : {}),
      candidates: catPlan.rotation === 90
        ? [{ slot: 'below', rect: verticalNameRect(band.center(ci), area.catRowY, info.w, catPlan.font), penalty: 0 }]
        : rotated
        ? [{ slot: 'below', rect: rotatedClaimRect(band.center(ci), area.catRowY + Math.max(categoryLabelGap + 2, info.h * Math.SQRT1_2 / 2 + ROTATED_NAME_AIR), info.h), penalty: 0 }]
        : dateTicks ? [below] : [below, belowShifted],
    });
  });
  pushAll(requests, yearRowRequests(catPlan, rowY));
}

/**
 * The total a stack prints: the sum of its drawn parts, which is what the
 * column shows. A missing part adds no marker; the notes list names it (plot.ts).
 * None for a suppressed 100% category or a 100% stack with a missing part.
 */
export function stackTotalText(domain: ColumnDomain, ci: number, format = domain.totalFmt): { text: string; net: boolean } | null {
  const c = domain.cats[ci]!;
  if (!domain.gtContent || !domain.stacks[ci]!.hasValue) return null;
  const stacked100 = domain.variant === 'stacked100';
  if (domain.nmCats100.has(c.id) || domain.naCats100.has(c.id) || (stacked100 && domain.incompleteCats.has(c.id))) return null;
  const text = composeText(domain, domain.gtContent, domain.stackTotals[c.id]!, stacked100 ? domain.posTopP[ci]! : null, c.label ?? c.id, '', false, format);
  if (!text) return null;
  // A net inside its stack is named, and stands by the tick that marks it.
  const net = !domain.netLineOn && netInsideStack(domain, ci);
  return { text: net ? `${domain.options.strings!.net} ${text}` : text, net };
}

/**
 * The line under a stack total that misses a part: "(partial)", in the muted secondary step.
 * It keys the total to a disclosure, so it prints only where disclosures print.
 */
export function partialWords(domain: ColumnDomain, ci: number): string | undefined {
  return domain.variant === 'stacked' && domain.incompleteCats.has(domain.cats[ci]!.id) && disclosuresShown(domain.options) ? domain.options.strings!.incomplete! : undefined;
}

/**
 * Phase 3, second half, appended to the value labels: the grand totals
 * (signed: above the positive top, below the negative bottom), each with its
 * PY growth when integrated; the anomaly rule; the integrated PY tick's own
 * label (right of the tick, with fallbacks above, below and left); the net
 * line's label; the category row.
 */
export function planColumnLabels(
  domain: ColumnDomain,
  area: ColumnArea,
  scene: ColumnMarkGeometry,
  requests: LabelRequest[],
  warnings: LintWarning[],
): IntegratedVariancePoint[] {
  const { measure, highlights, cats, gtContent, stackTotals, variant, posTopP, negBotP, pyRef, pyGrowth, totalFmt } = domain;
  const { strongFont, tickFont, band, y } = area;
  const growthPoints: IntegratedVariancePoint[] = [];
  // `labels: { growth: false }` drops the growth arrows and keeps the
  // integrated PY ticks and their labels.
  const growthOn = kindSetting(domain.options, 'growth') !== false;
  const box = (x: number, yy: number, size: { width: number; height: number }): Rect => ({ x, y: yy, w: size.width, h: size.height });
  emptyCategoryMarkers(domain, area, requests);
  const totalAt = (ci: number, format = totalFmt) => stackTotalText(domain, ci, format);
  // Totals that would stand closer than the neighbour gap over their
  // stacks take one font step down, as a row.
  const fullTotals = cats.map((_, ci) => totalAt(ci));
  const spec = domain.valueSpec.spec;
  const maxTotal = maxOf(cats.map(c => Math.abs(stackTotals[c.id]!)));
  // Compact cards try a shorter number before the density gate. Keep the
  // complete number and category for any total that still needs the note.
  const compactTotals = domain.options.mode === 'compact' && variant === 'stacked'
    && spec.magnitude === 'none' && !spec.suffix.includes('%') && maxTotal >= 1000
    && fullTotals.some(total => total && measure(total.text, strongFont).width + 6 > band.step);
  const compactFormat = (value: number) => Math.abs(value) < 1000 ? totalFmt(value) : formatWithSpec(value, { ...spec,
    magnitude: Math.abs(value) >= 1e9 ? 'bn' : Math.abs(value) >= 1e6 ? 'm' : 'k', decimals: 1, significantDigits: undefined });
  // A one-part stack's segment names its total (printedIn). A total that prints the value alone
  // names the segment back, so a pinned segment placed first takes the value whatever its format.
  const linked = new Map(requests.flatMap((req) => req.printedIn ? [[req.printedIn, req.id] as const] : []));
  // A linked part with an authored text that prints the value: its total carries that text, so it prints once.
  const authoredPart = (ci: number) => {
    const id = linked.get(`grandTotal:${cats[ci]!.id}`);
    const series = id && domain.dataSeries.find((s) => id === `segment:${s.id}:${cats[ci]!.id}`);
    return series && printsValue(series.vals[ci]!.labelOverride) ? requests.find((req) => req.id === id)?.text : undefined;
  };
  const totals = (compactTotals ? cats.map((_, ci) => totalAt(ci, compactFormat)) : fullTotals)
    .map((total, ci) => { const text = total && !total.net ? authoredPart(ci) : undefined; return text ? { ...total!, text } : total; });
  // A running category's total says so under the value, in the secondary step and the muted ink;
  // a stack that misses a part says "(partial)" there.
  const toDateIds = toDateOnValues(domain);
  const toDate = domain.options.strings?.toDate ?? chartString(domain.options, 'toDate');
  const wordsAt = (ci: number, text: string, font: FontSpec) => {
    const words = toDateIds.has(cats[ci]!.id) ? toDate : partialWords(domain, ci);
    return words ? toDateLabel(text, font, words, domain.theme, measure) : undefined;
  };
  const seats = (font: FontSpec) => totals.map((total, ci) => {
    if (!total || total.net) return null;
    const size = wordsAt(ci, total.text, font)?.size ?? measure(total.text, font);
    const above = posTopP[ci]! > 0 || negBotP[ci]! === 0;
    const edgeY = above ? y(posTopP[ci]!) : y(negBotP[ci]!);
    return { x: band.center(ci) - size.width / 2, y: above ? edgeY - size.height - 4 : edgeY + 4, w: size.width, h: size.height };
  });
  const rowFont = valueRowCrowded(seats(strongFont)) ? stepDownFont(domain.theme, strongFont, 'label', domain.options.target, textScaleOf(domain.options)) : undefined;
  const totalFont = rowFont ?? strongFont;
  // A stack still crowded at the step: every second total prints, counted back from
  // the latest column; the notes list names the others.
  const thinned = domain.dataSeries.length > 1 && valueRowCrowded(seats(totalFont));
  const valueAlone = gtContent?.join() === 'absolute';
  cats.forEach((c, ci) => {
    const total = totals[ci];
    if (!total) return;
    const { text, net } = total;
    const words = net ? undefined : wordsAt(ci, text, totalFont);
    const tsize = words?.size ?? measure(text, net ? strongFont : totalFont);
    const above = posTopP[ci]! > 0 || negBotP[ci]! === 0;
    const cx = band.center(ci);
    const netY = y(stackTotals[c.id]!);
    const netX = band.position(ci) + band.bandwidth + NET_TICK_REACH + 3;
    // A total stands at its column's top, no higher and never inside the
    // column, where it would read as a part.
    const totalCandidates = net
      ? [
        { slot: 'rightOfNet', rect: box(netX, netY - tsize.height / 2, tsize), penalty: 0 },
        { slot: 'rightOfNetAbove', rect: box(netX, netY - tsize.height - 2, tsize), penalty: 1 },
        { slot: 'rightOfNetBelow', rect: box(netX, netY + 2, tsize), penalty: 2 },
        // Dense columns leave no room beside the tick: the net then stands over its column, as a total does.
        { slot: 'aboveNet', rect: box(cx - tsize.width / 2, y(posTopP[ci]!) - tsize.height - 4, tsize), penalty: 3 },
      ]
      : totalLabelCandidates('vertical', { x: cx, y: above ? y(posTopP[ci]!) : y(negBotP[ci]!) }, tsize, above ? 'positive' : 'negative').slice(0, 1)
        // An edge column's total stays on the plot, as a grouped value does. A
        // reference line across the seat does not move it: it crosses the line on a halo.
        .map(candidate => ({ ...candidate, overRules: true, rect: { ...candidate.rect, x: Math.max(area.plot.x, Math.min(candidate.rect.x, area.plot.x + area.plot.w - candidate.rect.w)) } }))
        // In a thinned row the neighbours print no total: a total wider than its
        // column that would cut into a taller neighbour rises just clear of it,
        // still centred on its own column. It may rise four lines of its font and two seat gaps,
        // whatever its own line count: the reach a two-line total had before totals printed in one line.
        .flatMap(candidate => {
          if (!thinned || !above) return [candidate];
          const { x, w } = candidate.rect;
          const clear = Math.min(...[ci - 1, ci + 1]
            .filter(n => n >= 0 && n < cats.length && band.position(n) < x + w + 2 && band.position(n) + band.bandwidth > x - 2)
            .map(n => y(posTopP[n]!) - tsize.height - 4));
          return clear < candidate.rect.y - 0.5 ? [candidate, { ...candidate, slot: 'aboveNeighbours', rect: { ...candidate.rect, y: clear }, penalty: candidate.penalty + 1, reach: 4 * lineBox(totalFont) + 2 * 4 }] : [candidate];
        });
    const skipped = thinned && !net && ci % 2 !== (cats.length - 1) % 2 && !highlights.has(c.id);
    requests.push({
      id: `grandTotal:${c.id}`,
      kind: 'grandTotal',
      ...namesOnly(variant === 'stacked100' ? gtContent : gtContent?.filter((part) => part !== 'percent'), undefined),
      ...(net ? { role: 'category' as const } : {}),
      ...(skipped ? { redundant: true, suppressedAs: 'density' as const } : {}),
      ...(!net && !words && valueAlone && linked.has(`grandTotal:${c.id}`) ? { printedIn: linked.get(`grandTotal:${c.id}`) } : {}),
      owner: { categoryId: c.id },
      text,
      lines: words?.lines ?? [text],
      ...words?.request,
      // the note names a total by its one series, else as the stack's total ("Total 60 (Jan)"); a Net names itself.
      ...(net ? {} : { noteText: `${domain.dataSeries.length === 1 ? noteName(domain.dataSeries[0]!) : chartString(domain.options, 'total')} ${compactTotals ? fullTotals[ci]!.text : text}${words ? ` ${words.lines[1]}` : ''} (${noteName(c)})` }),
      typeRole: 'label', font: net ? strongFont : totalFont,
      ...(rowFont && !net ? { fontStep: rowFont } : {}),
      priority: PRIORITY.grandTotal + (highlights.has(c.id) ? PRIORITY.highlightBonus : 0),
      // A highlighted stack's total keeps the full ink under labels.ink 'muted'.
      ...(highlights.has(c.id) ? { emphasis: true } : {}),
      candidates: totalCandidates,
    });
    const integrated = growthOn ? pyGrowth.get(c.id) : undefined;
    if (!integrated) return;
    const annotationId = `integratedVariance:${integrated.referenceSeriesId}:${c.id}`;
    const growthLabelId = `annotation:${annotationId}`;
    const growthSize = measure(integrated.text, strongFont);
    const yy = totalCandidates[0]!.rect.y;
    const growthAt = box(cx - growthSize.width / 2, above ? yy - growthSize.height - 4 : yy + tsize.height + 4, growthSize);
    requests.push({
      id: growthLabelId,
      kind: 'annotation', role: composedTextRole(integrated.text, 'note'),
      owner: { annotationId, categoryId: c.id },
      text: integrated.text,
      lines: [integrated.text],
      typeRole: 'label', font: strongFont,
      priority: PRIORITY.total,
      candidates: [{ slot: above ? 'aboveTotal' : 'belowTotal', rect: growthAt, penalty: 0 }],
    });
    growthPoints.push({
      ...integrated,
      x: cx,
      tickY: y(integrated.reference),
      totalLabelId: `grandTotal:${c.id}`,
      growthLabelId,
      referenceLabelId: `tick:${integrated.referenceSeriesId}:${c.id}`,
      tickNodeId: `ref:${integrated.referenceSeriesId}:${c.id}`,
    });
  });
  anomalyRuleRequest(domain, area, requests, warnings);
  const tickContent = contentOf(domain.options, 'tick', ['absolute', 'series']);
  const pyKeyed = pyTickKeyed(domain, area.frame.legend);
  // Every reference prints its value beside its mark; the
  // integrated PY tick, which reaches further out, leads its label out 12 px.
  for (const s of tickContent && domain.variant !== 'stacked100' ? domain.refSeries : []) cats.forEach((c, ci) => {
    const v = domain.plottedOf(s, ci);
    if (v === null) return;
    const integrated = pyRef?.id === s.id && pyGrowth.has(c.id);
    const ry = y(v);
    const bx = band.position(ci);
    // Where the key names the integrated PY tick, its label is the value alone ("82").
    const valueOnly = integrated && pyKeyed;
    const text = composeText(domain, valueOnly ? ['absolute'] : tickContent!, v, null, c.label ?? c.id, s.label, false, domain.valueSpec.forSeries(s));
    const size = measure(text, tickFont);
    // The label starts 3 px past a tick that reaches out beside the column.
    const reach = outsideTickReach(domain, band, ci);
    const primaryX = bx + band.bandwidth + (integrated ? PY_TICK_LEAD : reach !== undefined && reach >= 4 ? reach + 3 : 5);
    requests.push({
      id: `tick:${s.id}:${c.id}`,
      kind: 'tick',
      owner: { seriesId: s.id, categoryId: c.id },
      text,
      lines: [text],
      typeRole: 'label', font: tickFont,
      // A plain reference value takes the seat the column values leave.
      priority: integrated ? PRIORITY.valueLine : PRIORITY.interior - 1,
      candidates: [
        // A dot sits mid-column: its value goes beside the dot first, clear of its ring.
        ...(domain.refStyle === 'marker' ? [
          { slot: 'rightOfMarker', rect: box(band.center(ci) + REFERENCE_MARKER_R + 4, ry - size.height / 2, size), penalty: 0 },
          { slot: 'leftOfMarker', rect: box(band.center(ci) - REFERENCE_MARKER_R - 4 - size.width, ry - size.height / 2, size), penalty: 0.5 },
        ] : []),
        { slot: 'rightOfTick', rect: box(primaryX, ry - size.height / 2, size), penalty: 1 },
        { slot: 'rightOfTickAbove', rect: box(primaryX, ry - size.height - 4, size), penalty: 2 },
        { slot: 'rightOfTickBelow', rect: box(primaryX, ry + 4, size), penalty: 3 },
        { slot: 'leftOfTick', rect: box(bx - 12 - size.width, ry - size.height / 2, size), penalty: 4 },
      ],
    });
  });
  const end = scene.netLineEnd;
  if (end) {
    const text = netLineName(domain.dataSeries, domain.netLineSeries, domain.stacks, domain.options.strings);
    const size = measure(text, strongFont);
    requests.push({
      id: 'netLine',
      kind: 'valueLine', role: 'category',
      owner: { annotationId: 'netLine' },
      text,
      lines: [text],
      typeRole: 'label', font: strongFont,
      priority: PRIORITY.valueLine,
      candidates: [
        { slot: 'right', rect: box(end.x + 4, end.y - size.height / 2, size), penalty: 0 },
        { slot: 'above', rect: box(end.x - size.width, end.y - size.height - 4, size), penalty: 1 },
      ],
    });
  }
  rightEdgeSeriesRequests(domain, area, requests);
  extremeNameRequest(domain, area, scene, requests);
  if (area.showCatRow) categoryRequests(domain, area, requests);
  rankValueLabels(requests, request => {
    const ci = cats.findIndex(c => c.id === request.owner.categoryId);
    if (ci < 0) return undefined;
    return request.kind === 'grandTotal' ? stackTotals[cats[ci]!.id]
      : domain.dataSeries.find(s => s.id === request.owner.seriesId)?.vals[ci]?.v;
  }, domain.density, domain.options.labelPlacements, {
    categories: cats.length, last: domain.options.mode === 'compact' ? cats.at(-1)?.id : undefined, pitch: band.step / (variant === 'grouped' ? domain.dataSeries.length : 1), orientation: 'vertical', measure,
  });
  return growthPoints;
}

/**
 * Where the category row thins its names, the most extreme column
 * still says which period it is and what it holds, beside its end ("P36
 * -241"), so the outlier the reader's eye goes to is named.
 */
function extremeNameRequest(domain: ColumnDomain, area: ColumnArea, scene: ColumnMarkGeometry, requests: LabelRequest[]): void {
  // A date row thins its ticks by rhythm, and the period reads off it.
  if (domain.options.labels === false || !area.showCatRow || area.catPlan.dateNumeric || area.catPlan.keep.every(Boolean)) return;
  const extreme = scene.bars.reduce<BarPlace | undefined>((best, place) => (!best || Math.abs(place.v) > Math.abs(best.v) ? place : best), undefined);
  if (!extreme || area.catPlan.keep[extreme.ci]) return;
  const { c, s, v, rect } = extreme;
  // Where the column prints its value already, the name alone is added.
  const valueShown = domain.variant === 'grouped' && contentOf(domain.options, 'point', ['absolute']) !== null;
  const text = valueShown ? (c.label ?? c.id) : `${c.label ?? c.id} ${domain.valueSpec.forSeries(s)(v)}`;
  // Measured in the face it is drawn in: the layout draws an annotation in the emphasis weight.
  const font = { ...area.labelFont, weight: emphasisWeight(domain.theme) };
  const size = domain.measure(text, font);
  const cx = rect.x + rect.w / 2;
  const endY = v < 0 ? rect.y + rect.h + 4 : rect.y - size.height - 4;
  const box = (x: number, y: number): Rect => ({ x, y, w: size.width, h: size.height });
  requests.push({
    id: `extreme:${s.id}:${c.id}`,
    kind: 'annotation', role: composedTextRole(text, 'note'),
    owner: { seriesId: s.id, categoryId: c.id },
    text, lines: [text], typeRole: 'label', font,
    priority: PRIORITY.valueLine,
    candidates: [
      { slot: 'atEnd', rect: box(cx - size.width / 2, endY), penalty: 0 },
      { slot: 'atEndRight', rect: box(rect.x + rect.w + 4, v < 0 ? rect.y + rect.h - size.height : rect.y), penalty: 1 },
      { slot: 'atEndLeft', rect: box(rect.x - 4 - size.width, v < 0 ? rect.y + rect.h - size.height : rect.y), penalty: 2 },
    ],
  });
}

/**
 * The stacked series named once, at the right edge of the last column
 * or the left edge of the first. Each name sits on the middle of its
 * own segment there, so the chart carries no legend and the reader matches
 * name to layer by position.
 */
function rightEdgeSeriesRequests(domain: ColumnDomain, area: ColumnArea, requests: LabelRequest[]): void {
  const named = rightEdgeSeriesLabels(domain);
  if (named.length === 0) return;
  const { measure, cats, stacks, dataSeries } = domain;
  const { band, y } = area;
  const labelFont = edgeNameFont(area.labelFont, domain);
  const left = domain.options.seriesLabels?.at === 'left-edge';
  const edge = left ? 0 : cats.length - 1;
  const stack = stacks[edge];
  if (stack === undefined || !stack.hasValue) return;
  for (const series of named) {
    const seriesIndex = dataSeries.findIndex((candidate) => candidate.id === series.id);
    const segment = seriesIndex < 0 ? null : stack.segments[seriesIndex];
    if (!segment) continue;
    const size = measure(series.label, labelFont);
    const middle = y((segment.start + segment.end) / 2);
    const x = left ? band.position(edge) - RIGHT_EDGE_GAP - size.width : band.position(edge) + band.bandwidth + RIGHT_EDGE_GAP;
    requests.push({
      id: `seriesEdge:${series.id}`,
      kind: 'series',
      owner: { seriesId: series.id, categoryId: cats[edge]!.id },
      text: series.label,
      lines: [series.label],
      typeRole: 'label', font: labelFont,
      priority: PRIORITY.endpoint,
      candidates: [
        { slot: left ? 'leftOfStack' : 'rightOfStack', rect: { x, y: middle - size.height / 2, w: size.width, h: size.height }, penalty: 0 },
      ],
    });
  }
}

/** The pad the column solver keeps between a label and another owner's mark or label. */
const SEAT_PAD = 2;

/**
 * Where a value wider than its column may sit when its natural seat is taken.
 * `lifted`: the natural seat moved off its mark only as far as the other
 * columns under it need (a taller neighbour of a sorted row), at most one line
 * step. `stagger`: a second row over the first seats of the neighbours it
 * spans, so dense sorted columns keep every other value one row up on a short
 * leader instead of dropping it. Both are label tops (bottoms for negative
 * values); the seat itself is the natural seat moved to that edge.
 */
interface SeatRows { lifted?: number; stagger: number }

function valueSeatRows(naturals: readonly ({ rect: Rect; negative: boolean } | undefined)[], bars: readonly Rect[]): (SeatRows | undefined)[] {
  const spans = (a: Rect, b: Rect, gap = SEAT_PAD) => b.x < a.x + a.w + gap && a.x < b.x + b.w + gap;
  const step = (rect: Rect) => rect.h + 4;
  const first = naturals.map((seat) => {
    if (!seat) return undefined;
    const { rect, negative } = seat;
    // Other columns under the label's span that reach past its near edge.
    const edge = negative
      ? Math.max(rect.y, maxOf(bars.filter((bar) => spans(rect, bar) && bar.y + bar.h + SEAT_PAD > rect.y && bar.y < rect.y).map((bar) => bar.y + bar.h + SEAT_PAD + 0.5)))
      : Math.min(rect.y + rect.h, minOf(bars.filter((bar) => spans(rect, bar) && bar.y - SEAT_PAD < rect.y + rect.h && bar.y + bar.h > rect.y + rect.h).map((bar) => bar.y - SEAT_PAD - 0.5))) - rect.h;
    const lift = Math.abs(edge - rect.y);
    return { ...rect, y: edge, lifted: lift > 1e-6 && lift <= step(rect) ? edge : undefined };
  });
  return naturals.map((seat, i) => {
    const row1 = first[i];
    if (!seat || !row1) return undefined;
    let stagger = seat.negative ? row1.y + step(row1) : row1.y - step(row1);
    for (const [j, other] of first.entries()) {
      // The stagger never takes the row a neighbour's first seat needs, whatever order the solver seats them in.
      if (j === i || !other || naturals[j]!.negative !== seat.negative || !spans(row1, other, SERIES_VALUE_GAP)) continue;
      stagger = seat.negative ? Math.max(stagger, other.y + other.h + SEAT_PAD + 0.5) : Math.min(stagger, other.y - SEAT_PAD - 0.5 - row1.h);
    }
    return { ...(row1.lifted === undefined ? {} : { lifted: row1.lifted }), stagger };
  });
}

/** Grouped bars: one consistent reading line — above the top (below for
 *  negatives), lifted clear of taller neighbours, a second staggered row,
 *  then inside the bar end as last resort. */
function pointCandidates(
  rect: Rect,
  tsize: { width: number; height: number },
  negative: boolean,
  insideFill: string,
  y: (value: number) => number,
  range?: DataRange,
  /** Extra clearance outside the column end (anomaly flag marker). */
  outset = 0,
  rows?: SeatRows,
): SlotCandidate[] {
  const cx = rect.x + rect.w / 2;
  const markTop = rect.y;
  const markBot = rect.y + rect.h;
  // A column with an interval keeps its value at its own top,
  // beside the whisker (its claim reaches 6 px out), before the seats past the caps.
  const beside: SlotCandidate[] = range
    ? [
      { slot: 'besideWhiskerRight', rect: { x: cx + 9, y: negative ? markBot + 3 : markTop - tsize.height - 3, w: tsize.width, h: tsize.height }, penalty: 0 },
      { slot: 'besideWhiskerLeft', rect: { x: cx - 9 - tsize.width, y: negative ? markBot + 3 : markTop - tsize.height - 3, w: tsize.width, h: tsize.height }, penalty: 0.5 },
    ]
    : [];
  const yTop = (range ? Math.min(markTop, y(range.low), y(range.high)) : markTop) - outset;
  const yBot = (range ? Math.max(markBot, y(range.low), y(range.high)) : markBot) + outset;
  const w = tsize.width;
  const h = tsize.height;
  // The inside end, the last resort, is offered only where the glyphs lie
  // on the column: the measured advance may pass each edge by its
  // side bearing (1 px), and the box stays clear of the column end. The
  // 28 px floor is for a label along a bar; a column value reads across.
  const inside = tsize.width <= rect.w && tsize.height + 4 <= rect.h;
  if (!negative) {
    return [
      ...beside,
      // A reference line across this seat (an average marker) does not move
      // the value: it crosses the line on a halo, level with its neighbours.
      { slot: 'outsideTop', rect: { x: cx - w / 2, y: yTop - h - 4, w, h }, penalty: 0, overRules: true },
      ...(rows?.lifted === undefined ? [] : [{ slot: 'outsideTopLifted', rect: { x: cx - w / 2, y: rows.lifted, w, h }, penalty: 0.5 }]),
      {
        slot: 'outsideTopShifted',
        rect: { x: cx - w / 2, y: rows?.stagger ?? yTop - 2 * h - 8, w, h },
        penalty: 1,
      },
      ...(inside ? [{ slot: 'insideEnd', rect: { x: cx - w / 2, y: markTop + 2, w, h }, penalty: 2, insideFill }] : []),
    ];
  }
  return [
    ...beside,
    { slot: 'outsideBottom', rect: { x: cx - w / 2, y: yBot + 4, w, h }, penalty: 0, overRules: true },
    ...(rows?.lifted === undefined ? [] : [{ slot: 'outsideBottomLifted', rect: { x: cx - w / 2, y: rows.lifted, w, h }, penalty: 0.5 }]),
    {
      slot: 'outsideBottomShifted',
      rect: { x: cx - w / 2, y: rows?.stagger ?? yBot + h + 8, w, h },
      penalty: 1,
    },
    ...(inside ? [{ slot: 'insideEnd', rect: { x: cx - w / 2, y: markBot - h - 2, w, h }, penalty: 2, insideFill }] : []),
  ];
}
