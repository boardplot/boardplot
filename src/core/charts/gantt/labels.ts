import { ganttItemLabel } from './domain';
/**
 * Gantt phase 3: mark geometry in, label requests out. Column
 * headers, then per row its item labels in authored order, its activity name
 * and its metadata columns. Planning reads the phase 2 struct only, never the
 * OccupiedIndex.
 */

import { SWATCH_RESERVE } from '../../label/emit';
import { fittedLabel } from '../../label/rowFit';
import { seatsPastBlockers } from '../../label/slots';
import { PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import { rectContains, rectsOverlap, type Rect } from '../../geometry';
import { markRolePaint, surfaceFloorPaint } from '../../theme';
import { barSurfaces, type GanttMarkGeometry } from './marks';
import { laneTop, type GanttBand, type GanttBody, type GanttDomain, type GanttEnv, type GanttPaints, type ItemPlace, type NormItem, type RowPlace } from './model';
import { stackedCells, stackedGap } from './plot';
import { maxOf, minOf } from '../../arrays';

interface LabelCtx {
  env: GanttEnv;
  domain: GanttDomain;
  band: GanttBand;
  body: GanttBody;
  paints: GanttPaints;
  requests: LabelRequest[];
  /** The marks' claims and the event and today rules a milestone label steps past. */
  obstacles: Rect[];
  keyed: ReadonlyMap<string, number>;
  flagRows: ReadonlySet<string>;
  spanClearance?: Rect[];
}

/** A name keeps clear of diamonds and the pointed part of every chevron. */
export function ganttSpanBlockers(row: RowPlace, name?: { id: string; rect: Rect }): Rect[] {
  return row.items.flatMap((item): Rect[] => {
    if (item.it.kind === 'milestone') return [item.rect];
    if (item.it.kind !== 'chevron') return [];
    let tip = Math.min(9, item.rect.h * 0.6, item.rect.w);
    // Its own name can use the arrow's fill up to the sloped edge at the
    // name's top and bottom. The full tip box needlessly loses that seat.
    if (name?.id === item.it.id && rectContains(item.rect, name.rect)) {
      const cy = item.rect.y + item.rect.h / 2;
      tip *= 2 * Math.max(cy - name.rect.y, name.rect.y + name.rect.h - cy) / item.rect.h;
    }
    return [{ ...item.rect, x: item.rect.x + item.rect.w - tip, w: tip }];
  });
}

const bonus = (env: GanttEnv, it: NormItem): number =>
  env.highlights.has(it.id) || env.highlights.has(it.rowId) ? PRIORITY.highlightBonus : 0;

/** Free horizontal spans clear both vertical rules and same-row milestone diamonds. */
function spanFreeRuns(rect: Rect, rules: readonly { x: number; halfWidth: number }[]) {
  const runs: { start: number; end: number }[] = [];
  const end = rect.x + rect.w;
  let start = rect.x;
  for (const rule of [...rules].sort((a, b) => a.x - b.x)) {
    const left = rule.x - rule.halfWidth - 2;
    const right = rule.x + rule.halfWidth + 2;
    if (right <= rect.x || left >= end) continue;
    if (left > start) runs.push({ start, end: Math.min(left, end) });
    start = Math.max(start, right);
  }
  if (start < end) runs.push({ start, end });
  return runs;
}

/** Bar/chevron/shade label: inside-center cascade → right of the item. */
function spanLabel(ctx: LabelCtx, row: RowPlace, place: ItemPlace): void {
  const { it, rect, owner } = place;
  const { measure, fonts } = ctx.env;
  const fillCss = ctx.paints.css(ctx.paints.item(it));
  const text = ganttItemLabel(it, ctx.env).text;
  const tsize = measure(text, fonts.label);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const fits = tsize.width + 6 <= rect.w && tsize.height <= rect.h + 1;
  const insideAt = (slot: string, rx: number, penalty: number): SlotCandidate => ({
    slot,
    rect: { x: rx, y: cy - tsize.height / 2, w: tsize.width, h: tsize.height },
    penalty,
    insideFill: fillCss,
    insidePaint: ctx.paints.item(it),
  });
  const inside = insideAt('insideCenter', cx - tsize.width / 2, 0);
  const insideStart = insideAt('insideStart', rect.x + 3, 1);
  const insideEnd = insideAt('insideEnd', rect.x + rect.w - tsize.width - 3, 2);
  const shapeEnd = rect.x + rect.w - Math.min(9, rect.h * 0.6, rect.w) * tsize.height / rect.h - 2;
  const insideShape = it.kind === 'chevron' && shapeEnd - rect.x - 1.5 >= tsize.width
    ? [insideAt('insideShape', Math.max(rect.x + 1.5, Math.min(shapeEnd - tsize.width, inside.rect.x)), 0.25)] : [];
  const rowH = ctx.band.rowH;
  const milestoneHalf = Math.max(3, Math.min(rowH * 0.32, 8));
  // A row the milestone lane makes tall keeps its bar at the natural height,
  // so the name may take the room above or below the bar, off the
  // row's centre line where the diamonds and lane leaders run.
  const room = (ctx.band.rowHs[ctx.domain.rows.findIndex((row) => row.id === it.rowId)]! - rect.h) / 2 - 2;
  let offCentre = room >= tsize.height + 2
    ? [rect.y - 2 - tsize.height, rect.y + rect.h + 2].map((y, i): SlotCandidate =>
      ({ slot: i ? 'belowBar' : 'aboveBar', rect: { ...insideStart.rect, y }, penalty: 5 + i }))
    : [];
  const rowMilestoneItems = ctx.domain.rows.find((row) => row.id === it.rowId)!.items.filter((item) => item.kind === 'milestone');
  const rowMilestones = rowMilestoneItems.map((item) => ({ x: ctx.body.x(item.startDay + 0.5), halfWidth: milestoneHalf }));
  if (ctx.flagRows.has(it.rowId)) {
    const free = spanFreeRuns({ ...rect, x: ctx.body.bodyX, w: ctx.body.inner.x + ctx.body.inner.w - ctx.body.bodyX }, rowMilestones);
    offCentre = offCentre.flatMap(candidate => free.filter(run => run.end - run.start >= tsize.width).map(run => ({
      ...candidate, rect: { ...candidate.rect, x: Math.max(run.start, Math.min(run.end - tsize.width, candidate.rect.x)) },
    })));
  }
  // A clustered milestone is labelled in the shared lane on the right, its
  // leader running from the diamond along the row: no bar label sits on
  // that run.
  const leaderFrom = Math.min(Infinity, minOf(rowMilestoneItems
    .filter((item) => !ctx.flagRows.has(it.rowId) && ctx.body.laneEnabled && ctx.body.clusteredLabelY.has(item.id))
    .map((item) => ctx.body.x(item.startDay + 0.5) - milestoneHalf)));
  const clearOfLeader = (candidates: SlotCandidate[]): SlotCandidate[] => {
    // An off-centre seat lies above or below the run, so it stays.
    const clear = candidates.filter((candidate) => candidate.rect.x + candidate.rect.w <= leaderFrom - 2 || offCentre.includes(candidate));
    return clear.length > 0 ? clear : candidates;
  };
  const straight = ctx.spanClearance && it.kind === 'chevron'
    ? { ...rect, w: Math.max(0, rect.w - Math.min(9, rect.h * 0.6, rect.w) - 2) }
    : rect;
  const freeRuns = spanFreeRuns(rect, [...ctx.body.ruleClaims, ...rowMilestones]);
  const slideCandidates = freeRuns.map(run => ({ ...run, end: Math.min(run.end, straight.x + straight.w) }))
    .filter((run) => run.end - run.start >= tsize.width)
    .sort(
      (a, b) =>
        Math.abs((a.start + a.end) / 2 - cx) - Math.abs((b.start + b.end) / 2 - cx) ||
        a.start - b.start,
    )
    .map((run, index) => insideAt(`insideSlide:${index + 1}`, (run.start + run.end - tsize.width) / 2, 0.5 + index * 0.1));
  const outsideAt = (slot: string, rx: number, penalty: number): SlotCandidate =>
    ({ slot, rect: { x: rx, y: cy - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty });
  const right = outsideAt('outsideRight', rect.x + rect.w + 5, 3);
  const left = outsideAt('outsideLeft', rect.x - 5 - tsize.width, 4);
  // The solver permits a name inside its own mark. A diamond or a chevron
  // tip is not a text surface, including the tip of that same mark.
  const blockers = ctx.spanClearance ? ganttSpanBlockers(row) : [];
  const clearOfMarks = (candidate: SlotCandidate) => (!ctx.spanClearance || !ganttSpanBlockers(row, { id: it.id, rect: candidate.rect })
    .some(blocker => rectsOverlap(candidate.rect, blocker, 2)))
    && (!ctx.spanClearance || rectContains(rect, candidate.rect) || !ctx.spanClearance.some(name =>
      candidate.rect.y < name.y + name.h && candidate.rect.y + candidate.rect.h > name.y && rectsOverlap(candidate.rect, name, 12)));
  // A backed name on a bar at the timeline start stays in the timeline: it does not cross
  // into the row names (a cut column is dropped, so the names sit next to the timeline).
  const backedX = Math.max(ctx.body.bodyX, inside.rect.x);
  const backed: SlotCandidate = { ...inside, rect: { ...inside.rect, x: backedX }, slot: 'insideBacked', penalty: 3, insideFill: undefined, needsBacking: true };
  // A narrow bar can have no clear inside or immediate side seat. Keep its
  // name on the row by sliding its backed seat just past a diamond or tip.
  const arrowRetry = it.kind === 'chevron' && !fits && !rowMilestoneItems.length;
  const otherMarks = row.items.filter(item => item !== place && item.it.kind !== 'shade').map(item => item.rect);
  const pastObstacles = [...blockers, ...(arrowRetry ? [rect] : []),
    ...(ctx.spanClearance ?? []).map(name => ({ ...name, x: name.x - 9, w: name.w + 18 })),
    ...otherMarks,
    ...ctx.body.ruleClaims.map(rule => ({ ...rect, x: rule.x - rule.halfWidth, w: 2 * rule.halfWidth }))];
  // An arrow name outside its arrow must read as that arrow's name: no other mark or name sits between them.
  const nextToArrow = (seat: Rect) => {
    const [from, to] = seat.x >= rect.x + rect.w ? [rect.x + rect.w, seat.x] : [seat.x + seat.w, rect.x];
    return !arrowRetry || ![...otherMarks, ...(ctx.spanClearance ?? [])].some(other =>
      other.y < seat.y + seat.h && seat.y < other.y + other.h && other.x < to && other.x + other.w > from);
  };
  const past = (ctx.spanClearance ? seatsPastBlockers(backed.rect, 'x', ctx.body.bodyX, ctx.body.inner.x + ctx.body.inner.w, pastObstacles, 3) : [])
    .filter(nextToArrow)
    .map((rect, index): SlotCandidate => ({ ...backed, slot: `backedPast:${index + 1}`, rect, penalty: 4.5 + index * 0.1 }));
  const duration = it.endDay - it.startDay;
  ctx.requests.push({
    id: `item:${it.rowId}:${it.id}`,
    kind: 'item', typeRole: 'label',
    owner,
    text,
    lines: [text],
    font: fonts.label,
    // Keep the one span name before milestones compete for the row bands.
    priority: (rowMilestoneItems.length && offCentre.length ? PRIORITY.extreme + 1 : PRIORITY.interior) + Math.min(99, duration) + bonus(ctx.env, it),
    candidates: clearOfLeader((fits
      ? [inside, ...insideShape, ...slideCandidates, insideStart, insideEnd, right, left, ...past, ...offCentre]
      : [right, left, backed, ...past, ...offCentre]).filter(clearOfMarks)),
  });
}

/** Milestone labels use their row bands before side seats and the shared lane. */
function milestoneLabel(ctx: LabelCtx, row: RowPlace, place: ItemPlace): void {
  const { cy } = row;
  const { it, owner, cx, rr } = place;
  const { body } = ctx;
  const entry = ctx.domain.milestones.byId.get(it.id)!;
  const number = ctx.keyed.get(it.id);
  const text = number === undefined ? entry.text : String(number);
  const tsize = number === undefined ? entry.size : ctx.env.measure(text, ctx.env.fonts.label);
  const right: Rect = { x: cx + rr + 4, y: cy - tsize.height / 2, w: tsize.width, h: tsize.height };
  const left: Rect = { ...right, x: cx - rr - 4 - tsize.width };
  // A rule or a neighbour on a side seat: the nearest seat just past it in
  // the row, 3 px clear, before the lane. The slide reaches one label width
  // plus the gaps, as on the dot chart.
  const reach = 2 * tsize.width + 8;
  const past = (slot: string, from: Rect, lo: number, hi: number): SlotCandidate[] =>
    seatsPastBlockers(from, 'x', lo, hi, ctx.obstacles, 3).map((rect) => ({ slot, rect, penalty: 3.5 }));
  // A shared milestone is labelled beside its diamond, inside its row and the timeline.
  const lo = body.bodyX;
  const hi = body.bodyX + body.bodyW;
  const rowBox = { x: lo, y: cy - ctx.band.rowHs[row.index]! / 2, w: body.bodyW, h: ctx.band.rowHs[row.index]! };
  // The bar can be taller than the diamond. Start outside both, then stack
  // within this row only. Do not borrow the activity-name band on the left.
  const halfMark = Math.max(rr, maxOf(row.items.filter(item => item.it.kind !== 'bracket').map(item => item.rect.h / 2)));
  const vertical: SlotCandidate[] = [];
  // Centred on the diamond, shifted inward at a timeline edge: the text still spans its diamond.
  const vx = Math.max(lo, Math.min(hi - tsize.width, cx - tsize.width / 2));
  for (let level = 0; level < rowBox.h / (tsize.height + 3); level++) {
    for (const above of [true, false]) {
      const rect = { x: vx, y: above
        ? cy - halfMark - 4 - tsize.height - level * (tsize.height + 3)
        : cy + halfMark + 4 + level * (tsize.height + 3), w: tsize.width, h: tsize.height };
      if (rectContains(rowBox, rect)) vertical.push({ slot: `${above ? 'above' : 'below'}${level ? `:${level}` : ''}`, rect, penalty: level });
    }
  }
  // A past seat stops short of the next diamond in the row: a name
  // beyond another milestone reads as that milestone's.
  const others = ctx.domain.rows.find((row) => row.id === it.rowId)!.items
    .filter((item) => item.kind === 'milestone' && item.id !== it.id)
    .map((item) => body.x(item.startDay + 0.5));
  const nextRight = Math.min(Infinity, minOf(others.filter((x) => x > cx).map((x) => x - rr - 3)));
  const nextLeft = Math.max(-Infinity, maxOf(others.filter((x) => x < cx).map((x) => x + rr + 3)));
  const standardCandidates: SlotCandidate[] = [
    ...vertical,
    ...(right.x + right.w <= hi ? [{ slot: 'right', rect: right, penalty: 0 }] : []),
    ...(left.x >= lo ? [{ slot: 'left', rect: left, penalty: 1 }] : []),
    ...past('rightPast', right, right.x, Math.min(hi, right.x + reach, nextRight)),
    ...past('leftPast', left, Math.max(lo, left.x + tsize.width - reach, nextLeft), left.x + tsize.width),
  ];
  // Stacked: the row's name line above the lane, flush with the diamond's
  // right edge, then starting at its left edge (rows that have the line).
  const { band } = ctx;
  if (band.stacked && laneTop(band, ctx.domain.rows, row.index) > band.rowY[row.index]!) {
    const y = band.rowY[row.index]! + band.nameLineH / 2 - tsize.height / 2;
    const clampX = (rx: number) => Math.max(lo, Math.min(hi - tsize.width, rx));
    standardCandidates.push(
      { slot: 'nameLineEnd', rect: { x: clampX(cx + rr - tsize.width), y, w: tsize.width, h: tsize.height }, penalty: 5 },
      { slot: 'nameLineStart', rect: { x: clampX(cx - rr), y, w: tsize.width, h: tsize.height }, penalty: 5.5 },
    );
  }
  const laneCenterY = body.clusteredLabelY.get(it.id);
  const flags: SlotCandidate[] = [];
  if (number === undefined && ctx.flagRows.has(row.row.id)) {
    const { seats, flagHalf, lineH } = planRowFlags(ctx.domain, body, row);
    const seat = seats.get(it.id);
    const rect = seat && { x: seat.x, y: seat.above ? cy - flagHalf - 4 - tsize.height - seat.level * lineH : cy + flagHalf + 4 + seat.level * lineH, w: tsize.width, h: tsize.height };
    if (seat && rect && rectContains({ ...rowBox, w: body.inner.x + body.inner.w - lo }, rect)) flags.push({
      slot: seat.above ? 'flagAbove' : 'flagBelow', rect, penalty: -1,
      leaderFrom: { x: cx, y: cy + (seat.above ? -rr : rr) }, leaderVertical: true,
    });
    // No other seat above or below the row's centre sits on a flag's leader.
    const leaders = [...seats].filter(([id]) => id !== it.id);
    for (let i = standardCandidates.length - 1; i >= 0; i--) {
      const candidate = standardCandidates[i]!;
      const side = candidate.rect.y + candidate.rect.h < cy ? true : candidate.rect.y > cy ? false : undefined;
      if (side !== undefined && leaders.some(([, other]) => other.above === side
        && other.cx >= candidate.rect.x - FLAG_GAP && other.cx <= candidate.rect.x + candidate.rect.w + FLAG_GAP)) standardCandidates.splice(i, 1);
    }
    // A fixed-height row may have no flag space; a shifted seat still names its diamond with a leader.
    for (const candidate of standardCandidates) {
      candidate.leaderFrom = candidate.rect.y + candidate.rect.h < cy
        ? { x: cx, y: cy - rr }
        : candidate.rect.y > cy ? { x: cx, y: cy + rr }
          : { x: cx + (candidate.rect.x > cx ? rr : -rr), y: cy };
      candidate.leaderVertical = true;
    }
  }
  const laneCandidate: SlotCandidate | null =
    number === undefined && body.laneEnabled && ctx.domain.milestones.laneIds.has(it.id)
      ? {
          slot: laneCenterY === undefined ? 'milestoneLane' : 'clusterLane',
          rect: { x: body.laneX, y: (laneCenterY ?? cy) - tsize.height / 2, w: tsize.width, h: tsize.height },
          penalty: 4,
          leaderFrom: { x: cx, y: cy },
        }
      : null;
  ctx.requests.push({
    id: `item:${it.rowId}:${it.id}`,
    kind: 'item', typeRole: 'label',
    owner,
    text,
    lines: [text],
    font: ctx.env.fonts.label,
    priority: (number === undefined ? PRIORITY.extreme : PRIORITY.total) + bonus(ctx.env, it),
    // A lane leader runs along the row: it crosses no label, and no later label sits on it.
    leaderAvoidsLabels: true,
    candidates: [...flags, ...standardCandidates, ...(laneCandidate ? [laneCandidate] : [])],
  });
}

/** Clearance between flags on one level, and between a leader and another flag's text. */
const FLAG_GAP = 4;

/**
 * Stacked flags of a crowded row, right to left: each flag takes the first
 * level, above then below, where its text stays clear of the flags on that
 * level and its vertical leader passes no flag text on a lower level. Level 0,
 * next to the bar, stays free for the bar's name. A flag with no clear level
 * gets no seat. Pitch and label placement read the same plan.
 */
export function planRowFlags(domain: GanttDomain, body: GanttBody, row: RowPlace): {
  seats: Map<string, { above: boolean; level: number; x: number; cx: number }>; flagHalf: number; lineH: number; textH: number;
} {
  const right = body.inner.x + body.inner.w;
  const flags = row.items.filter((item) => domain.milestones.byId.has(item.it.id)).map((item) => {
    const size = domain.milestones.byId.get(item.it.id)!.size;
    return { id: item.it.id, cx: item.cx, w: size.width, h: size.height, x: Math.min(item.cx, right - size.width) };
  }).sort((a, b) => b.x - a.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: { above: boolean; level: number; x0: number; x1: number; cx: number }[] = [];
  const seats = new Map<string, { above: boolean; level: number; x: number; cx: number }>();
  for (const flag of flags) {
    const x0 = flag.x, x1 = flag.x + flag.w;
    const clear = (above: boolean, level: number) => placed.every((other) => other.above !== above
      || (other.level === level ? x1 + FLAG_GAP <= other.x0 || other.x1 + FLAG_GAP <= x0
        : other.level < level ? flag.cx < other.x0 - FLAG_GAP || flag.cx > other.x1 + FLAG_GAP
          : other.cx < x0 - FLAG_GAP || other.cx > x1 + FLAG_GAP));
    seat: for (let level = 1; level <= flags.length; level++) {
      for (const above of [true, false]) {
        if (!clear(above, level)) continue;
        placed.push({ above, level, x0, x1, cx: flag.cx });
        seats.set(flag.id, { above, level, x: x0, cx: flag.cx });
        break seat;
      }
    }
  }
  // A shade fills the whole row and grows with it: flags clear the bars and diamonds only.
  const flagHalf = Math.max(0, maxOf(row.items.filter((item) => item.it.kind !== 'bracket' && item.it.kind !== 'shade').map((item) => item.rect.h / 2)));
  const textH = Math.max(0, maxOf(flags.map((flag) => flag.h)));
  return { seats, flagHalf, lineH: textH + 4, textH };
}

/** The lane height that holds the given flag seats of a row, or 0 for none; 4 px keep the outer flags clear of the row's edge and its neighbours' labels. */
export function flagRowPitch(plan: ReturnType<typeof planRowFlags>, ids: Iterable<string> = plan.seats.keys()): number {
  let level = 0;
  for (const id of ids) level = Math.max(level, plan.seats.get(id)?.level ?? 0);
  return level ? 2 * (plan.flagHalf + 4 + plan.textH + level * plan.lineH + 4) : 0;
}

/** A bracket label, in its own row: under the arm, centred, then beside its end, then under its start. */
function bracketLabel(ctx: LabelCtx, rowId: string, place: ItemPlace): void {
  const { it, owner, xs, xe, yT, armH } = place;
  const label = ganttItemLabel(it, ctx.env).text;
  const tsize = ctx.env.measure(label, ctx.env.fonts.label);
  const mid = (xs + xe) / 2;
  // Centred on the band under the arm (a shade ends 4 px above the row's
  // foot), and never outside the row.
  const rowY = yT - 1.5;
  const rowH = ctx.band.rowHs[ctx.domain.rows.findIndex((row) => row.id === rowId)]!;
  const y = Math.min(Math.max((yT + armH + rowY + rowH - 4 - tsize.height) / 2, rowY), rowY + rowH - tsize.height);
  ctx.requests.push({
    id: `item:${rowId}:${it.id}`,
    kind: 'item', typeRole: 'label',
    owner,
    text: label,
    lines: [label],
    font: ctx.env.fonts.label,
    priority: PRIORITY.endpoint + bonus(ctx.env, it),
    candidates: [
      { slot: 'belowInside', rect: { x: mid - tsize.width / 2, y, w: tsize.width, h: tsize.height }, penalty: 0 },
      { slot: 'right', rect: { x: xe + 5, y, w: tsize.width, h: tsize.height }, penalty: 1 },
      { slot: 'belowStart', rect: { x: xs + 4, y, w: tsize.width, h: tsize.height }, penalty: 2 },
      // Before the bracket, when it runs to the timeline end and its own band is taken.
      ...(xs - 5 - tsize.width >= ctx.body.bodyX ? [{ slot: 'left', rect: { x: xs - 5 - tsize.width, y, w: tsize.width, h: tsize.height }, penalty: 3 }] : []),
    ],
  });
}

/** Row label (left band) and its text columns. */
function activityLabels(ctx: LabelCtx, place: RowPlace): void {
  const { row: r, index: i, cy } = place;
  if (r.shared) return;
  const { env, body } = ctx;
  const { label } = env.fonts;
  const rl = body.rowLabels[i]!;
  // Stacked: the name line above the row's lane.
  const nameCy = ctx.band.rowY[i]! + ctx.band.nameLineH / 2;
  ctx.requests.push({
    id: `activity:${r.id}`,
    kind: 'activity', typeRole: 'label',
    owner: { categoryId: r.id },
    text: r.label,
    ...fittedLabel({ lines: rl.lines, w: rl.w, h: rl.h, font: rl.font, ...(rl.title ? { title: rl.title } : {}) }, rl.baseFont),
    font: rl.baseFont,
    priority: PRIORITY.endpoint + (env.highlights.has(r.id) ? PRIORITY.highlightBonus : 0),
    candidates: [{ slot: 'left', rect: { x: body.inner.x + rl.indentPx, y: (ctx.band.stacked ? nameCy : cy) - rl.h / 2, w: rl.w, h: rl.h }, penalty: 0 }],
  });
  if (ctx.band.stacked) {
    stackedCellLabels(ctx, place, nameCy);
    return;
  }
  body.columns.colTexts[i]!.forEach((cell, k) => {
    const text = cell.text;
    if (!text) return;
    const tsize = env.measure(text, label);
    // A status tone is a filled marker before the word, on the row's centre like the name.
    ctx.requests.push({
      id: `col:${r.id}:${k}`,
      kind: 'activity', typeRole: 'label',
      owner: { categoryId: r.id },
      text,
      lines: [text],
      ...(cell.title ? { title: cell.title } : {}),
      // The status square takes its bars' fill (marks.ts barSurfaces).
      ...(cell.tone ? { swatch: surfaceFloorPaint(markRolePaint(cell.tone, true), barSurfaces(env)) } : {}),
      font: label,
      priority: PRIORITY.extreme,
      candidates: [{
        slot: 'left',
        rect: { x: body.columns.colXs[k]!, y: cy - label.size / 2, w: (cell.tone ? SWATCH_RESERVE : 0) + tsize.width, h: label.size },
        penalty: 0,
      }],
    });
  });
}

/** A stacked row's cells, flush right on its name line, in column order: "owner · ■ status". */
function stackedCellLabels(ctx: LabelCtx, place: RowPlace, nameCy: number): void {
  const { env, body } = ctx;
  const { label } = env.fonts;
  const gap = stackedGap(env).cell;
  let x = body.inner.x + body.inner.w;
  const placed = [...stackedCells(env, place.row)].reverse().map((cell) => {
    x -= cell.w;
    const rect = { x, y: nameCy - label.size / 2, w: cell.w, h: label.size };
    x -= gap;
    return { cell, rect };
  }).reverse();
  for (const { cell, rect } of placed) {
    ctx.requests.push({
      id: `col:${place.row.id}:${cell.k}`,
      kind: 'activity', typeRole: 'label',
      owner: { categoryId: place.row.id },
      text: cell.text,
      lines: [cell.line],
      ...(cell.tone ? { swatch: surfaceFloorPaint(markRolePaint(cell.tone, true), barSurfaces(env)) } : {}),
      font: label,
      priority: PRIORITY.extreme,
      candidates: [{ slot: 'left', rect, penalty: 0 }],
    });
  }
}

/** Phase 3: column headers, then each row's item labels, activity name and columns. */
export function planGanttLabels(
  env: GanttEnv,
  domain: GanttDomain,
  band: GanttBand,
  body: GanttBody,
  geometry: GanttMarkGeometry,
  paints: GanttPaints,
  keyed: ReadonlyMap<string, number> = new Map(),
  flagRows: ReadonlySet<string> = new Set(),
  spanClearance?: Rect[],
): LabelRequest[] {
  const obstacles = [
    ...geometry.claims.snapshot().map((claim) => claim.rect),
    ...body.ruleClaims.map((rule) => ({ x: rule.x - rule.halfWidth, y: body.plot.y, w: 2 * rule.halfWidth, h: body.plot.h })),
  ];
  const ctx: LabelCtx = { env, domain, band, body, paints, requests: env.labelOn('activity') ? [...body.columns.headerRequests] : [], obstacles, keyed, flagRows, spanClearance };
  const itemsOn = env.labelOn('item');
  for (const place of geometry.rows) {
    for (const item of place.items) {
      const { it } = item;
      if (it.kind === 'milestone') {
        if (itemsOn && domain.milestones.byId.has(it.id)) milestoneLabel(ctx, place, item);
      } else if (itemsOn && ganttItemLabel(it, env).text) {
        if (it.kind === 'bracket') bracketLabel(ctx, place.row.id, item);
        else spanLabel(ctx, place, item);
      }
    }
    if (env.labelOn('activity')) activityLabels(ctx, place);
  }
  for (const request of ctx.requests) {
    if (request.kind !== 'item') continue;
    // Automatic compact density must not silently remove an authored name.
    if (ctx.env.options.mode === 'compact') request.keepWhenDense = true;
    const row = domain.rows.find(row => row.id === request.owner.categoryId);
    request.noteText = `${request.text}${row ? ` (${row.label})` : ''}`;
  }
  return ctx.requests;
}
