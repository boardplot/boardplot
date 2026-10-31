/**
 * Combo phase 3: mark geometry in, label requests out. Axis titles,
 * segment values, grand totals, line end labels and category names, in the
 * order the solver takes them. Two steps then read the committed claims: the
 * grand-total rhythm and the pairing of end labels with totals. They get the
 * run's index as an `OccupiedView`, which cannot claim.
 */

import { drawnStroke } from '../../curve';
import { sideAwayFrom, type Rect } from '../../geometry';
import { preparePolyline, type PolylineQueries } from '../../polyline';
import { categoryLineAlign, ROTATED_NAME_AIR, rotatedClaimRect, verticalNameRect, yearRowRequests } from '../../label/categoryRow';
import { seatValuesOnGround } from '../../label/areaGround';
import { shadesFills } from '../line/marks';
import { PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import type { LintWarning, Paint, PlacedLabel } from '../../types/scene';
import { isIncomplete } from '../../dataGaps';
import { linesSize, valueRowCrowded, warnShareParts } from '../band/labels';
import { stepDownFont } from '../../label/rowFit';
import { textScaleOf } from '../../typeFloors';
import { stackSegmentCandidates } from '../../label/slots';
import { anchorComboAxisTitles } from './axisTitles';
import { clearLift, clearOfStrokes, comboEndpointRequest, comboValueLabels, FIRST_END_BELOW_TOTALS, nearerOwnLine, withinOneFill } from './endpoints';
import { MARKER_R, type ComboArea, type ComboDomain, type ComboEnv, type ComboMarkGeometry, type ComboPaints } from './model';
import { composeLines, composeText, contentOf, growthLine, toDateOnTotals } from './plot';
import { toDateLabel } from '../../partialPeriod';
import { namesOnly } from '../../markVisibility';
import { composedTextRole } from '../../textRole';
import { formatterFromExample } from '../../formatSpec';
import { REFERENCE_MARKER_R } from '../band/ticks';
import { rankValueLabels } from '../band/valueDensity';
import { noteName } from '../../calendarData';
import { chartString } from '../../strings';
import { disclosuresShown } from '../../notes';
import { onePartDrawn } from '../band/stacks';
import { maxOf, minOf, pushAll } from '../../arrays';

/** Every drawn line run as the path it takes, for the stroke test. */
function comboStrokes(geometry: ComboMarkGeometry) {
  return geometry.plans.flatMap((plan) => plan.runs.filter((run) => run.length > 1).map((run) => drawnStroke(run, plan.interpolation)));
}

/** Half the line claim's stroke allowance plus the solver's label air. */
const STROKE_CLEAR = 1.5 + 2;
/** The least air between two totals side by side (the solver's series value gap). */
const SHIFTED_TOTAL_GAP = 6;

/** The air between a line point and the bottom of the value box above it. */
export const ABOVE_POINT_GAP = 5;


/** Segments shorter than this auto-hide their label (unless density=full). */
const SLIVER_MIN_H = 8;

/** Segment values; single-segment stacks never print segment value + identical total. */
function segmentLabels(env: ComboEnv, domain: ComboDomain, area: ComboArea, geometry: ComboMarkGeometry, paints: ComboPaints, requests: LabelRequest[], warnings: LintWarning[]): void {
  if (domain.columns.length < 2) return;
  const content = contentOf(domain, 'segment', ['absolute']);
  if (!content) return;
  // A total that prints the value alone can carry a segment's authored text.
  const totalValueAlone = domain.columnsAdd && contentOf(domain, 'grandTotal', ['absolute'])?.join() === 'absolute';
  const { labelFont, band, y0 } = area;
  // A segment's share of its stack, where the stack is a whole: no
  // negative part, no missing part, a positive total.
  const shareAsked = content.includes('percent');
  const mixedSigns: string[] = [];
  const unavailable: string[] = [];
  const shareBasis = domain.cats.map((c, ci) => {
    if (!shareAsked || !domain.anyByCat[ci]) return 0;
    const name = c.label ?? c.id;
    if (domain.negBot[ci]! < 0) mixedSigns.push(name);
    else if (domain.posTop[ci]! <= 0 || isIncomplete(domain.columns.map((s) => s.vals[ci]!.v))) unavailable.push(name);
    else return domain.posTop[ci]!;
    return 0;
  });
  warnShareParts(warnings, mixedSigns, unavailable);
  // Segment values print in every column or in none: where one is wider than
  // its column, none prints, and the note line names them (layout.ts).
  let tooWide = false;
  const first = requests.length;
  for (const { s, si, ci, v, rect } of geometry.segments) {
    const c = domain.cats[ci]!;
    const val = s.vals[ci]!;
    const serFmt = s.format ? env.byExample(s.format) : domain.scaleFmtOf(s);
    const share = shareBasis[ci]! > 0 ? (v / shareBasis[ci]!) * 100 : null;
    let lines = composeLines(domain, content, { abs: v, isPct: val.isPct, share, shareText: domain.shareTexts.get(`${c.id}\0${s.id}`), format: val.format ?? s.format ?? domain.options.format }, c.label ?? c.id, s.label, serFmt);
    let text = lines.join(' ');
    // The drawn part itself: a zero cell beside it is not the stack's one part.
    const single = v !== 0 && onePartDrawn(domain.columns.map(column => column.vals[ci]!.v));
    const printed = val.isPct || share !== null ? content : content.filter((part) => part !== 'percent');
    if (typeof val.labelOverride === 'string') {
      text = val.labelOverride.replace(/\$\{value\}/g, text);
      lines = [text];
    }
    if (!text && val.labelOverride !== false) continue;
    const tsize = linesSize(lines, labelFont, env.measure);
    const fits = tsize.height + 2 <= rect.h && tsize.width + 4 <= band.bandwidth;
    const sliver = env.density !== 'full' && rect.h < SLIVER_MIN_H;
    const hl = env.highlights.has(c.id) || env.highlights.has(s.id);
    const priority = val.priority ?? PRIORITY.interior + Math.min(99, Math.abs(v)) + (hl ? PRIORITY.highlightBonus : 0);
    if (typeof val.labelOverride !== 'string' && val.labelOverride !== false && !sliver && !single && env.density !== 'full' && tsize.width > rect.w) tooWide = true;
    requests.push({
      id: `segment:${s.id}:${c.id}`,
      kind: 'segment',
      ...namesOnly(printed, val.labelOverride),
      // A label that prints more than the value (a name, a share) keeps its seat. An authored text
      // yields only to a total that carries it: one that prints the value alone, for this column's cell.
      ...(single && printed.length === 1 && printed[0] === 'absolute' && (typeof val.labelOverride !== 'string' || (totalValueAlone && totalColumn(domain, ci) === s))
        ? { printedIn: `grandTotal:${c.id}` } : {}),
      owner: { seriesId: s.id, categoryId: c.id },
      text,
      lines,
      ...(lines.length > 1 ? { align: 'middle' as const } : {}),
      typeRole: 'label', font: labelFont,
      priority,
      redundant: val.labelOverride === false || sliver,
      // A value prints inside its own segment or nowhere. Beside the column
      // the value would stand in the gap between two stacks, as near the next
      // one, with no leader at that distance. A value its segment cannot hold
      // is named in the note line (layout.ts), and so is a value that fits its
      // segment but loses its seat to another label.
      ...(val.labelOverride !== false ? { noteText: `${s.label} ${text} (${noteName(c)})` } : {}),
      candidates: insideSeats(stackSegmentCandidates(rect, tsize, fits, paints.inside(s, val, c, si), { baselineY: y0 }), rect, tsize.height)
        .map(candidate => ({ ...candidate, insidePaint: paints.cell(s, val, c, si), insidePattern: paints.pattern(s, val, c) })),
    });
  }
  if (tooWide) for (const request of requests.slice(first)) {
    const ci = domain.cats.findIndex((c) => c.id === request.owner.categoryId);
    const cell = domain.columns.find((column) => column.id === request.owner.seriesId)?.vals[ci];
    if (typeof cell?.labelOverride !== 'string') request.redundant = true;
  }
}

/** Air between a segment edge and a value seated against it, clear of the baseline's ink and the solver's pad. */
const SEGMENT_EDGE_AIR = 3;

/**
 * a segment value's seats, all inside its own segment: the cascade's
 * inside seats, then, where the segment holds the value with room to spare,
 * the same seat against its top and its foot, for a centre a line or a total
 * crosses.
 */
function insideSeats(candidates: SlotCandidate[], rect: Rect, labelH: number): SlotCandidate[] {
  const inside = candidates.filter((candidate) => candidate.slot.startsWith('inside'));
  const centre = inside.find((candidate) => candidate.slot === 'insideCenter');
  if (!centre) return inside;
  const edges = [
    { ...centre, slot: 'insideUpper', rect: { ...centre.rect, y: rect.y + SEGMENT_EDGE_AIR }, penalty: centre.penalty + 1 },
    { ...centre, slot: 'insideLower', rect: { ...centre.rect, y: rect.y + rect.h - labelH - SEGMENT_EDGE_AIR }, penalty: centre.penalty + 1.5 },
  ].filter((seat) => Math.abs(seat.rect.y - centre.rect.y) >= 1 && seat.rect.y >= rect.y && seat.rect.y + labelH <= rect.y + rect.h);
  return [...inside, ...edges];
}

/** The column whose cell speaks for a stack's total: the only populated one, else the only drawn (non-zero) one. */
function totalColumn(domain: ComboDomain, ci: number): ComboDomain['columns'][number] | undefined {
  const populated = domain.columns.filter(column => column.vals[ci]!.v !== null);
  const drawn = populated.filter(column => column.vals[ci]!.v !== 0);
  return populated.length === 1 ? populated[0] : drawn.length === 1 ? drawn[0] : undefined;
}

/** Grand totals, signed: above a positive top, below a negative bottom. */
function grandTotalLabels(env: ComboEnv, domain: ComboDomain, area: ComboArea, paints: ComboPaints, requests: LabelRequest[], lineYs: (ci: number) => number[], strokes: readonly PolylineQueries[] = []): void {
  const gtContent = domain.columns.length > 0 && domain.columnsAdd ? contentOf(domain, 'grandTotal', ['absolute']) : null;
  if (!gtContent) return;
  const { posTop, negBot } = domain;
  const { y, band, strongFont } = area;
  const authored = new Set<string>();
  const bare = new Set<string>();
  // A one-part stack's segment names its total (printedIn). A total that prints the value alone
  // names the segment back, so a pinned segment placed first takes the value whatever its format.
  const linked = new Map(requests.flatMap((req) => req.printedIn ? [[req.printedIn, req.id] as const] : []));
  const valueAlone = gtContent.join() === 'absolute';
  const backLink = (id: string, words: unknown) => !words && valueAlone && linked.has(id) ? { printedIn: linked.get(id) } : {};
  // A reference rule does not move a total: it crosses the rule on a halo, as on column.
  const crossesRules = domain.averageMarkerId !== undefined || (domain.options.annotations ?? []).some(annotation => annotation.kind === 'valueLine');
  const texts = domain.cats.map((c, ci) => {
    if (!domain.anyByCat[ci]) return null;
    const single = totalColumn(domain, ci);
    const cell = single?.vals[ci];
    const composed = composeText(domain, gtContent, { abs: domain.stackTotals[c.id]!, isPct: cell?.isPct ?? false, format: cell?.format ?? single?.format ?? domain.options.format }, c.label ?? c.id, '', domain.fmt);
    // A single column's total is its value: an authored cell label speaks for it.
    const override = cell?.labelOverride;
    if (override === false) return null;
    if (typeof override === 'string') authored.add(c.id);
    if (namesOnly(cell?.isPct ? gtContent : gtContent.filter((part) => part !== 'percent'), override).printsFor) bare.add(c.id);
    const text = typeof override === 'string' ? override.replace(/\$\{value\}/g, composed) : composed;
    return text || null;
  });
  // The anatomy's column value sits inside the column top at the label size,
  // bold in the on-fill ink. It has no other seat: a value the
  // line covers is dropped.
  // A stack keeps its segment values, so its total keeps the seats above it.
  const anatomyFont = domain.anatomy && domain.columns.length === 1 ? { ...strongFont } : undefined;
  // A value wider than its column would run onto the page in the on-fill ink,
  // white on white, or into its neighbour, which drops it. Where one value is
  // too wide, the whole row takes the outer seats, so the values read as one
  // class.
  const insideFont = anatomyFont && texts.every((text) => text === null || env.measure(text, anatomyFont).width + 4 <= band.bandwidth)
    ? anatomyFont : undefined;
  // Totals that would stand closer than the neighbour gap at their
  // seats over the columns take one font step down, as a row.
  // A running category's total says so under the value, in the secondary step and the muted ink;
  // a stack that misses a part says "(partial)" there.
  const toDateIds = insideFont ? new Set<string>() : toDateOnTotals(env, domain);
  const toDate = domain.options.strings?.toDate ?? chartString(domain.options, 'toDate');
  const wordsAt = (ci: number, text: string, font: typeof strongFont) => {
    const id = domain.cats[ci]!.id;
    const words = toDateIds.has(id) ? toDate : !insideFont && domain.columnsAdd && domain.incompleteCats.has(id) && disclosuresShown(domain.options) ? domain.options.strings!.incomplete! : undefined;
    return words ? toDateLabel(text, font, words, env.theme, env.measure) : undefined;
  };
  const outerSeat = (font: typeof strongFont) => (text: string | null, ci: number): Rect | null => {
    if (text === null) return null;
    const size = wordsAt(ci, text, font)?.size ?? env.measure(text, font);
    const above = posTop[ci]! > 0 || negBot[ci]! === 0;
    const edgeY = above ? y(posTop[ci]!) : y(negBot[ci]!);
    return { x: band.center(ci) - size.width / 2, y: above ? edgeY - size.height - 4 : edgeY + 4, w: size.width, h: size.height };
  };
  const rowFont = !insideFont && valueRowCrowded(texts.map(outerSeat(strongFont)))
    ? stepDownFont(env.theme, strongFont, 'label', domain.options.target, textScaleOf(domain.options)) : undefined;
  const outerFont = rowFont ?? strongFont;
  // A stack still crowded at the step: every second total prints, counted back from
  // the latest column; the notes list names the others.
  const thinned = !insideFont && domain.columns.length > 1 && valueRowCrowded(texts.map(outerSeat(outerFont)));
  // The line claims its segments as boxes, which over-claim the corners of a steep
  // segment. A shifted seat the drawn line clears by its half stroke and the label
  // air needs no further pad (on pareto at 320 a box corner would hide the first total, 8 px off
  // its line). A neighbour total closer than 6 px keeps the pad, so two totals on one row never
  // touch (pareto torture-pareto-flat at 320 would read '2525').
  // Only a neighbour whose own shifted seat stands on the same row counts (equal stack tops).
  const shiftedTop = (ci: number) => {
    const above = posTop[ci]! > 0 || negBot[ci]! === 0;
    const h = env.measure(texts[ci]!, outerFont).height;
    return above ? y(posTop[ci]!) - 2 * h - 8 : y(negBot[ci]!) + h + 8;
  };
  const apart = (ci: number) => [ci - 1, ci + 1].every((n) => {
    const other = texts[n];
    if (other === null || other === undefined) return true;
    const own = env.measure(texts[ci]!, outerFont);
    if (Math.abs(shiftedTop(n) - shiftedTop(ci)) >= own.height) return true;
    const gap = Math.abs(band.center(n) - band.center(ci)) - (env.measure(other, outerFont).width + own.width) / 2;
    return gap >= SHIFTED_TOTAL_GAP;
  });
  const shiftedClear = (seat: SlotCandidate, ci: number): SlotCandidate => strokes.length > 0 && apart(ci)
    && strokes.every(stroke => !stroke.hits(seat.rect, STROKE_CLEAR))
    ? { ...seat, pad: 0 } : seat;
  domain.cats.forEach((c, ci) => {
    const text = texts[ci];
    if (text === null || text === undefined) return;
    const words = wordsAt(ci, text, outerFont);
    const tsize = words?.size ?? env.measure(text, insideFont ?? outerFont);
    const above = posTop[ci]! > 0 || negBot[ci]! === 0;
    const edgeY = above ? y(posTop[ci]!) : y(negBot[ci]!);
    const cx = band.center(ci);
    const at = (slot: string, ry: number, penalty: number) =>
      ({ slot, rect: { x: Math.max(area.plot.x, Math.min(cx - tsize.width / 2, area.plot.x + area.plot.w - tsize.width)), y: ry, w: tsize.width, h: tsize.height }, penalty });
    // the note names a total by its one column series ("Daily count 8,721 (2 Sep)"; a Pareto's
    // bars by their unit or value name), else as the stack's total ("Total 60 (Jan)").
    // The inside end is offered only when one fill holds the full label.
    const insideDepth = tsize.width + 4 > band.bandwidth ? 0 : (() => {
      const top = [...domain.columns].reverse().find(s => { const v = s.vals[ci]!.v; return v !== null && (above ? v > 0 : v < 0); });
      return top === undefined ? 0 : Math.abs(y(top.vals[ci]!.v!) - y(0));
    })();
    const inside = (dy: number, slot: string) => insideDepth >= tsize.height + dy
      ? { ...at(slot, above ? edgeY + dy : edgeY - tsize.height - dy, 2), ...paints.top(ci, above) } : undefined;
    const named = { noteText: `${domain.columns.length === 1 ? noteName(domain.columns[0]!) : chartString(domain.options, 'total')} ${text}${words ? ` ${words.lines[1]}` : ''} (${noteName(c)})` };
    if (insideFont && above && edgeY + 4 + tsize.height <= y(0)) {
      requests.push({
        id: `grandTotal:${c.id}`,
        ...named,
        kind: 'grandTotal',
        ...(authored.has(c.id) ? { keepWhenDense: true as const } : {}),
        ...(bare.has(c.id) ? { printsFor: [] } : {}),
        ...backLink(`grandTotal:${c.id}`, undefined),
        owner: { categoryId: c.id },
        text,
        lines: [text],
        typeRole: 'label', font: insideFont,
        fontStep: insideFont,
        priority: PRIORITY.grandTotal + (env.highlights.has(c.id) ? PRIORITY.highlightBonus : 0),
        candidates: [{ ...at('insideTop', edgeY + 4, 0), ...paints.top(ci, true) }],
      });
      return;
    }
    requests.push({
      id: `grandTotal:${c.id}`,
      ...named,
      kind: 'grandTotal',
      ...(authored.has(c.id) ? { keepWhenDense: true as const } : {}),
      ...(bare.has(c.id) ? { printsFor: [] } : {}),
      ...backLink(`grandTotal:${c.id}`, words),
      owner: { categoryId: c.id },
      text,
      lines: words?.lines ?? [text],
      ...words?.request,
      typeRole: 'label', font: outerFont,
      ...(rowFont ? { fontStep: rowFont } : {}),
      ...(thinned && ci % 2 !== (domain.cats.length - 1) % 2 && !env.highlights.has(c.id) ? { redundant: true, suppressedAs: 'density' as const, owed: true as const } : {}),
      priority: PRIORITY.grandTotal + (env.highlights.has(c.id) ? PRIORITY.highlightBonus : 0),
      candidates: nearestOwnMarkFirst([
        // An average marker across this seat does not move the total: it
        // crosses the rule on a halo, as on column.
        { ...at(above ? 'aboveStack' : 'belowStack', above ? edgeY - tsize.height - 4 : edgeY + 4, 0), ...(crossesRules ? { overRules: true } : {}) },
        { ...shiftedClear(at(above ? 'aboveStackShifted' : 'belowStackShifted', above ? edgeY - 2 * tsize.height - 8 : edgeY + tsize.height + 8, 1), ci), ...(crossesRules ? { overRules: true } : {}) },
        // Type steps: a line that rises from this column's top runs right of its centre;
        // the total then stands left of the line's start, level with its usual seat (pareto at 320: '120').
        // Only the first column (left of any other the total would stand over its neighbour), and only
        // one too narrow to hold its total inside.
        ...(ci === 0 && tsize.width + 4 > band.bandwidth && strokes.length > 0 && above && cx - LEFT_SEAT_AIR - tsize.width >= LEFT_SEAT_MIN_X
          ? [{ slot: 'aboveStackLeft', rect: { x: cx - LEFT_SEAT_AIR - tsize.width, y: edgeY - tsize.height - 4, w: tsize.width, h: tsize.height }, penalty: 2 }] : []),
      ], edgeY, lineYs(ci), inside(8, 'insideEnd'),
      domain.columns.length > 1,
      // Last of all, one step further in: a line marker just inside the column top blocks the inside end by a fraction of a pixel.
      inside(12, 'insideEndLowered')),
    });
  });
}

/** Air between a left-standing total and the line's start point, and the leftmost x it may take. */
const LEFT_SEAT_AIR = 6;
const LEFT_SEAT_MIN_X = 8;

/**
 * Every reference prints its value and name beside its mark, as
 * on bar and column ("54.0 Plan"), in the seat the column values leave.
 */
function referenceLabels(env: ComboEnv, domain: ComboDomain, area: ComboArea, requests: LabelRequest[]): void {
  const content = contentOf(domain, 'tick', ['absolute', 'series']);
  if (!content) return;
  const { band, y, tickFont } = area;
  const marker = domain.options.referenceStyle === 'marker';
  for (const s of domain.refs) domain.cats.forEach((c, ci) => {
    const val = s.vals[ci]!;
    if (val.v === null) return;
    const text = composeText(domain, content, { abs: val.v, isPct: val.isPct, format: val.format ?? s.format ?? domain.options.format }, c.label ?? c.id, s.label, s.format ? formatterFromExample(s.format, domain.options.locale?.language) : domain.fmt);
    const { width: w, height: h } = env.measure(text, tickFont);
    const ry = y(val.v);
    const seat = (slot: string, x: number, top: number, penalty: number): SlotCandidate => ({ slot, rect: { x, y: top, w, h }, penalty });
    const cx = band.center(ci);
    const right = band.position(ci) + band.bandwidth + 5;
    requests.push({
      id: `tick:${s.id}:${c.id}`,
      kind: 'tick',
      owner: { seriesId: s.id, categoryId: c.id },
      text, lines: [text], typeRole: 'label', font: tickFont,
      priority: PRIORITY.reference,
      candidates: [
        ...(marker ? [seat('rightOfMarker', cx + REFERENCE_MARKER_R + 4, ry - h / 2, 0), seat('leftOfMarker', cx - REFERENCE_MARKER_R - 4 - w, ry - h / 2, 0.5)] : []),
        seat('rightOfTick', right, ry - h / 2, 1),
        seat('rightOfTickAbove', right, ry - h - 4, 2),
        seat('rightOfTickBelow', right, ry + 4, 3),
        seat('leftOfTick', band.position(ci) - 7 - w, ry - h / 2, 4),
        // Where the gaps are taken, on the column above or below its tick, on a halo.
        { ...seat('aboveTickOnColumn', cx - w / 2, ry - h - 3, 5), overColumns: true, needsBacking: true },
        { ...seat('belowTickOnColumn', cx - w / 2, ry + 3, 6), overColumns: true, needsBacking: true },
      ],
    });
  });
}

/**
 * A total reads as its column's only while it sits nearer the
 * column end than any line mark in that category. Outer seats that do take
 * their turn first; the seat inside the column end comes next; outer seats
 * nearer a line mark stay as the last resort, so a total is never lost. The
 * solver still keeps every outer seat inside the plot and one step from the first.
 */
function nearestOwnMarkFirst(outer: SlotCandidate[], edgeY: number, lineYs: number[], inside: SlotCandidate | undefined, tieIsOwn: boolean, insideLast?: SlotCandidate): SlotCandidate[] {
  const own = (c: SlotCandidate) => {
    const cy = c.rect.y + c.rect.h / 2;
    // A line point on the column top (within half a pixel) is a tie: the column's own mark where
    // tieIsOwn, else a rival, never decided by float noise (a total-scaled Pareto starts its curve there).
    return lineYs.every((ly) => Math.abs(ly - edgeY) < 0.5 ? tieIsOwn : Math.abs(cy - ly) > Math.abs(cy - edgeY));
  };
  return [...outer.filter(own), ...(inside ? [inside] : []), ...outer.filter((c) => !own(c)).map(c => ({ ...c, lastResort: true as const })),
    ...(insideLast ? [insideLast] : [])].map((c, penalty) => ({ ...c, penalty }));
}

/**
 * Category names in one row under the band, under the lowest column and the
 * total hanging under it: a negative column's name never hops above
 * the baseline. A rotated row gets one rotated slot.
 */
function categoryLabels(domain: ComboDomain, area: ComboArea, requests: LabelRequest[]): void {
  const { catPlan, band, gtH, dateNumericTicks } = area;
  const rotated = catPlan.rotation !== 0;
  domain.cats.forEach((c, ci) => {
    const info = catPlan.infos[ci]!;
    const at = (slot: string, ry: number, penalty: number) =>
      ({ slot, rect: { x: catPlan.x(ci), y: ry, w: info.w, h: info.h }, penalty });
    requests.push({
      id: `category:${c.id}`,
      kind: 'category',
      owner: { categoryId: c.id },
      text: c.label ?? c.id,
      lines: info.lines,
      ...categoryLineAlign(catPlan, ci),
      ...(info.title !== undefined ? { title: info.title } : {}),
      typeRole: catPlan.typeRole, font: catPlan.font,
      priority: PRIORITY.endpoint,
      // A stride-hidden date label is the row's decision (one info lint), not a loss.
      redundant: !catPlan.keep[ci],
      ...(rotated ? { rotate: catPlan.rotation === 90 ? -90 : -45 } : {}),
      candidates: catPlan.rotation === 90
        ? [{ slot: 'below', rect: verticalNameRect(band.center(ci), area.catRowY, info.w, catPlan.font), penalty: 0 }]
        : rotated
        ? [{ slot: 'below', rect: rotatedClaimRect(band.center(ci), area.catRowY + Math.max(8, info.h * Math.SQRT1_2 / 2 + ROTATED_NAME_AIR), info.h), penalty: 0 }]
        : [
            at('below', area.catRowY + 6, 0),
            // A date/numeric tick row is ONE row, never the stagger tier.
            ...(dateNumericTicks ? [] : [at('belowShifted', area.catRowY + 6 + gtH + 4, 1)]),
          ],
    });
  });
  pushAll(requests, yearRowRequests(catPlan, area.catRowY + 6));
}

/**
 * A combo line's interior points. An authored `label` string is drawn
 * where it was written in every mode; `valueLabels: 'all'` adds the value of
 * every point between the ends and 'extremes' each series' minimum and
 * maximum, as on the line chart. Each goes through the solver with the
 * above/below/aboveShifted cascade a line point label uses, below first
 * where the other lines leave more air there, and never nearer
 * another line than its own.
 */
function linePointLabels(env: ComboEnv, domain: ComboDomain, area: ComboArea, geometry: ComboMarkGeometry, requests: LabelRequest[], strokes: readonly PolylineQueries[], fills: readonly Rect[]): void {
  const { labelFont, frame } = area;
  const labelH = env.measure('0', labelFont).height;
  const mode = comboValueLabels(domain.options, domain.anatomy, domain.cats.length);
  const content = mode === 'all' || mode === 'extremes' ? contentOf(domain, 'point', ['absolute']) : null;
  // A point options.anomaly flagged prints its value in every mode, as a flagged column does.
  const flaggedContent = contentOf(domain, 'point', ['absolute']);
  const anomaly = domain.anomaly;
  const flaggedAt = (s: { id: string }, ci: number) => anomaly?.seriesId === s.id && anomaly.model.flagByCategory.has(domain.cats[ci]!.id);
  // A one-point run stays: its point is the distance an isolated value keeps to its own series.
  const strokesOf = new Map(geometry.plans.map((plan) => [plan.s.id, plan.runs.filter((run) => run.length > 0).map((run) => drawnStroke(run, plan.interpolation))] as const));
  const queriesOf = new Map([...strokesOf.values()].flat().map(stroke => [stroke, preparePolyline(stroke)]));
  for (const { s, pts } of geometry.plans) {
    const own = strokesOf.get(s.id)!;
    const others = [...strokesOf].flatMap(([id, runs]) => (id === s.id ? [] : runs));
    const ownQueries = own.map(stroke => queriesOf.get(stroke)!);
    const otherQueries = others.map(stroke => queriesOf.get(stroke)!);
    const values = pts.map((point) => s.vals[point.ci]!.v!);
    const [min, max] = [minOf(values), maxOf(values)];
    for (const point of pts) {
      // The ends are the endpoint pass's; this is what sits between them.
      if (area.first.get(s.id)?.ci === point.ci || area.last.get(s.id)?.ci === point.ci) continue;
      const cell = s.vals[point.ci]!;
      const override = cell.labelOverride;
      const extreme = cell.v === min || cell.v === max;
      const flagged = flaggedContent !== null && override === undefined && flaggedAt(s, point.ci);
      const engine = (content !== null && override === undefined && (mode === 'all' || extreme)) || flagged;
      if (typeof override !== 'string' && !engine) continue;
      const category = domain.cats[point.ci]!;
      const serFmt = s.format ? env.byExample(s.format) : domain.scaleFmtOf(s);
      const text = typeof override === 'string'
        ? override.replace(/\$\{value\}/g, composeText(domain, ['absolute'], { abs: cell.v ?? 0, isPct: cell.isPct, format: domain.explicitFormatOf(s, cell) }, category.label ?? category.id, s.label, serFmt))
        : composeText(domain, (content ?? flaggedContent)!, { abs: cell.v, isPct: cell.isPct, format: domain.explicitFormatOf(s, cell) }, category.label ?? category.id, s.label, serFmt);
      if (!text) continue;
      const size = env.measure(text, labelFont);
      const below = sideAwayFrom(point, others) === 'below';
      const centeredX = Math.max(frame.plot.x, Math.min(point.x - size.width / 2, frame.plot.x + frame.plot.w - size.width));
      const aboveY = point.y - labelH - ABOVE_POINT_GAP;
      // Every anatomy value keeps one small offset over its point. Where the rising line clips the seat by a pixel or two, the
      // value lifts by just that much instead of a whole row (aboveShifted).
      const lift = domain.anatomy ? clearLift({ x: centeredX, y: aboveY, w: size.width, h: labelH }, strokes, labelH) : undefined;
      const free = [
        { slot: 'above', y: aboveY, penalty: below ? 1 : 0 },
        ...(lift ? [{ slot: 'aboveLifted', y: aboveY - lift, penalty: (below ? 1 : 0) + 0.25 }] : []),
        { slot: 'below', y: point.y + 5, penalty: below ? 0 : 1 },
        { slot: 'leftRaised', x: point.x - MARKER_R - 5 - size.width, y: point.y - labelH / 2 - 8, penalty: 1.5 },
        { slot: 'rightRaised', x: point.x + MARKER_R + 5, y: point.y - labelH / 2 - 8, penalty: 1.5 },
        { slot: 'aboveShifted', y: point.y - 2 * labelH - 9, penalty: 2 },
      ].sort((a, b) => a.penalty - b.penalty).flatMap(({ slot, x = centeredX, y, penalty }) => {
        return x >= frame.plot.x && x + size.width <= frame.plot.x + frame.plot.w && y >= frame.plot.y && y + labelH <= frame.plot.y + frame.plot.h
          ? [{ slot, rect: { x, y, w: size.width, h: labelH }, penalty }]
          : [];
      });
      const clear = nearerOwnLine(clearOfStrokes(free, strokes), ownQueries, otherQueries);
      // A line over columns has no free air above its interior points, so the
      // same on-column fallback the end labels use follows the free slots:
      // the label lands on the column with a backing rather than nowhere.
      const slots = domain.columns.length > 0
        ? [...clear, ...clear.map((candidate) => ({ ...candidate, slot: `${candidate.slot}OnColumn`, penalty: candidate.penalty + 10, needsBacking: true, overColumns: true }))]
        : clear;
      requests.push({
        id: `point:${s.id}:${category.id}`,
        kind: 'point',
        role: composedTextRole(text),
        owner: { seriesId: s.id, categoryId: category.id },
        text,
        lines: [text],
        typeRole: 'label', font: labelFont,
        priority: cell.priority ?? (engine && extreme ? PRIORITY.extreme : PRIORITY.interior) + (env.highlights.has(s.id) || env.highlights.has(category.id) ? PRIORITY.highlightBonus : 0),
        candidates: withinOneFill(slots, fills),
      });
    }
  }
}

/**
 * The growth of both series beyond the right ticks, each statement level
 * with its series' last value. Figure and name stand on one line ("+128% Units sold") where it fits; otherwise the name
 * goes under the figure. Blocks that would touch
 * are pushed apart downward in value order, keeping 4px.
 */
function growthLabels(env: ComboEnv, area: ComboArea, requests: LabelRequest[]): void {
  const growth = area.growth;
  if (!growth) return;
  const valueH = env.measure('0', growth.valueFont).height;
  const nameH = env.measure('0', growth.nameFont).height;
  // The solver keeps 2px between labels, so the name sits 2px under its figure.
  const blockH = growth.oneLine ? valueH : valueH + 2 + nameH;
  const placed = growth.items
    .map((item) => ({ item, y: (item.axis === 'secondary' ? area.y2 : area.y)(item.last) - valueH / 2 }))
    .sort((a, b) => a.y - b.y);
  let floor = -Infinity;
  for (const entry of placed) {
    entry.y = Math.max(entry.y, floor);
    floor = entry.y + blockH + 4;
  }
  for (const { item, y } of placed) {
    const text = growth.oneLine ? growthLine(item) : item.text;
    const valueW = env.measure(text, growth.valueFont).width;
    requests.push({
      // A figure with its name is prose; the figure alone a value.
      id: `growth:${item.seriesId}`, kind: 'annotation', role: growth.oneLine ? composedTextRole(text) : 'value', owner: { seriesId: item.seriesId },
      text, lines: [text], typeRole: 'label', font: growth.valueFont, fontStep: growth.valueFont, priority: PRIORITY.grandTotal,
      candidates: [{ slot: 'growth', rect: { x: growth.x, y, w: valueW, h: valueH }, penalty: 0 }],
    });
    // A statement without a text twin keeps the full name; one with a text twin takes the short one.
    const name = item.textPaint ? item.short : item.name;
    if (growth.oneLine || !name) continue;
    const nameW = env.measure(name, growth.nameFont).width;
    requests.push({
      id: `growth:${item.seriesId}:name`, kind: 'annotation', owner: { seriesId: item.seriesId },
      text: name, lines: [name], typeRole: 'label', font: growth.nameFont, fontStep: growth.nameFont, priority: PRIORITY.grandTotal,
      candidates: [{ slot: 'growthName', rect: { x: growth.x, y: y + valueH + 2, w: nameW, h: nameH }, penalty: 0 }],
    });
  }
}

/**
 * The growth statements take their series' text twin, figure
 * and name alike. Without one (a multi-column stack) the
 * figure takes the ink role and the name under it the muted ink.
 */
export function applyGrowthInk(labels: PlacedLabel[], area: ComboArea): void {
  const items = area.growth?.items ?? [];
  const twinOf = new Map<string, Paint>(items.flatMap((item) => (item.textPaint ? [[item.seriesId, item.textPaint] as const] : [])));
  const inkOf = new Map<string, 'ink' | 'inkMuted'>(items.map((item) => [`growth:${item.seriesId}`, item.ink]));
  for (const label of labels) {
    if (!label.id.startsWith('growth:')) continue;
    const twin = label.owner?.seriesId !== undefined ? twinOf.get(label.owner.seriesId) : undefined;
    label.ink = twin ?? { token: inkOf.get(label.id) ?? 'inkMuted' };
  }
}

/** Phase 3: every label request in solver order, then the two steps that read the committed claims. */
export function planComboLabels(
  env: ComboEnv,
  domain: ComboDomain,
  area: ComboArea,
  geometry: ComboMarkGeometry,
  paints: ComboPaints,
  warnings: LintWarning[],
): LabelRequest[] {
  const { frame, labelFont, band } = area;
  const rightAxisActive = domain.rightTicks.length > 0;
  // Each authored title sits over its own tick column.
  const requests = anchorComboAxisTitles(area.axisTitles, {
    left: Number.isFinite(geometry.leftTickX) ? geometry.leftTickX : undefined,
    right: rightAxisActive ? area.rightTickX + area.rightAxisReserve - 10 : undefined,
    rightStart: rightAxisActive ? area.rightTickX : undefined,
  }, frame.plot);
  segmentLabels(env, domain, area, geometry, paints, requests, warnings);
  // the drawn lines and column fills every line value keeps off or inside.
  const strokes = comboStrokes(geometry).map(preparePolyline);
  let lineYsByCat: number[][] | undefined;
  const lineYsAt = (ci: number): number[] => {
    if (!lineYsByCat) {
      lineYsByCat = domain.cats.map(() => []);
      for (const plan of geometry.plans) for (const point of plan.pts) lineYsByCat[point.ci]!.push(point.y);
    }
    return lineYsByCat[ci]!;
  };
  grandTotalLabels(env, domain, area, paints, requests, lineYsAt, strokes);
  const fills = geometry.segments.map((segment) => segment.rect);
  const segmentSeats = requests.flatMap((r) =>
    r.kind === 'segment' && !r.redundant && r.candidates[0]?.slot === 'insideCenter' ? [r.candidates[0].rect] : []);
  // End labels leave the total's first seat clear before the solver ranks them.
  const totalSeats = requests.flatMap((r) =>
    r.kind === 'grandTotal' && !r.redundant && r.candidates[0] ? [r.candidates[0].rect] : []);
  // first and last drawable line labels
  for (const { s, pts } of geometry.plans) {
    for (const endpoint of [
      { point: pts[pts.length - 1]!, end: area.last.get(s.id), first: false },
      { point: pts[0]!, end: area.first.get(s.id), first: true },
    ]) {
      if (endpoint.end === undefined) continue;
      requests.push(comboEndpointRequest({ s, last: endpoint.point, lastCat: domain.cats[endpoint.point.ci]!,
        text: endpoint.end.text, labelFont, measure: env.measure, MARKER_R, hasColumns: domain.columns.length > 0, band,
        adjacentAxisActive: endpoint.first ? domain.showPrimaryAxis : rightAxisActive, highlights: env.highlights, first: endpoint.first, firstBelowTotals: (domain.options as { [FIRST_END_BELOW_TOTALS]?: boolean })[FIRST_END_BELOW_TOTALS] === true,
        sharesOnColumns: (domain.options as { [FIRST_END_BELOW_TOTALS]?: boolean })[FIRST_END_BELOW_TOTALS] === true,
        allowOnColumn: !domain.lineBand,
        bounds: s.kind === 'line' && (domain.options as { [FIRST_END_BELOW_TOTALS]?: boolean })[FIRST_END_BELOW_TOTALS] !== true ? { x0: area.plot.x, x1: area.plot.x + area.plot.w, y0: area.plot.y, y1: area.plot.y + area.plot.h } : { x0: frame.plot.x, x1: frame.plot.x + frame.plot.w }, strokes, fills, segmentSeats, totalSeats, anatomy: domain.anatomy }));
    }
  }
  linePointLabels(env, domain, area, geometry, requests, strokes, fills);
  // A value may sit on an area where it clears that fill's edges by the solver's pad; another series' value keeps off a shaded one.
  seatValuesOnGround(requests, geometry.areaGrounds, 2, (ground) => paints.css(ground.paint), !shadesFills(domain.options.annotations ?? []), ['point', 'grandTotal']);
  referenceLabels(env, domain, area, requests);
  growthLabels(env, area, requests);
  if (area.showCatTickRow) categoryLabels(domain, area, requests);
  rankValueLabels(requests, request => request.kind === 'grandTotal' && request.owner.categoryId !== undefined
    ? domain.stackTotals[request.owner.categoryId] : undefined, env.density, domain.options.labelPlacements,
    { categories: domain.cats.length, last: domain.options.mode === 'compact' ? domain.cats.at(-1)?.id : undefined, pitch: band.step, orientation: 'vertical', measure: env.measure });
  return requests;
}
