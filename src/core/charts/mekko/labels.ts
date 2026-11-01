import { chartString } from '../../strings/mekko';
import { namesOnly } from '../../markVisibility';
import { formatterFromExample } from '../../formatSpec';
/**
 * Mekko phase 3: mark geometry in, label requests out. Every drawn
 * segment's label first, then per column its total and its category name.
 * Planning reads the phase 2 struct only, never the OccupiedIndex.
 */

import { PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import { rectsOverlap, type Rect } from '../../geometry';
import { seatsPastBlockers, stackSegmentCandidates } from '../../label/slots';
import { categoryLineAlign } from '../../label/categoryRow';
import type { LabelContent, LabelKind } from '../../types/options';
import { segmentTooShort } from '../band/labels';
import { warnIncompleteComposition, warnShareRoundingDrift } from '../../dataGaps';
import { shareSetDecimals } from '../../formatPrecision';
import type { LintWarning } from '../../types/scene';
import { colCx, colW, type MekkoArea, type MekkoDomain, type MekkoEnv, type MekkoMarkGeometry, type MekkoPaints } from './model';
import { GUTTER_GAP, UPPER_TIER_GAP, kindSetting } from './plot';
import { composedTextRole } from '../../textRole';
import { planValueAxisTitle, valueAxisTitleRequest } from '../../axis';
import { unitPrinted } from '../../frame';
import { resolveSubtitle } from '../../normalize/shared';
import { pushAll } from '../../arrays';
import { withUnit } from '../../unitJoin';

/** Columns narrower than this hide their segment labels (density != full, unpinned; documented on labelDensity). */
const SLIVER_MIN_W = 24;

interface LabelCtx {
  env: MekkoEnv;
  domain: MekkoDomain;
  area: MekkoArea;
  paints: MekkoPaints;
  requests: LabelRequest[];
}

function contentOf(env: MekkoEnv, kind: LabelKind, dflt: LabelContent): LabelContent | null {
  const s = kindSetting(env, kind);
  if (s === false) return null;
  return Array.isArray(s) ? s : dflt;
}

function composeText(
  env: MekkoEnv,
  content: LabelContent,
  values: { abs: number | null; pct: number | null; authoredPct?: boolean; pctText?: string },
  catLabel: string,
  serLabel: string,
  example?: string,
  absFmt = env.fmt,
): string {
  const parts: string[] = [];
  for (const c of content) {
    if (c === 'absolute' && values.abs !== null) parts.push(example ? formatterFromExample(example, env.options.locale?.language)(values.abs) : absFmt(values.abs));
    else if (c === 'percent' && values.pct !== null) parts.push((env.options.rounding === 'sum-consistent' ? values.pctText : undefined) ??
      (example ? formatterFromExample(example, env.options.locale?.language)(values.pct) : values.authoredPct ? env.authoredPctFmt(values.pct) : values.pctText ?? env.pctFmt(values.pct)));
    else if (c === 'category' && catLabel) parts.push(catLabel);
    else if (c === 'series' && serLabel) parts.push(serLabel);
  }
  return parts.join(' ');
}

/**
 * Segment labels: percent → share %, unit → absolute; bar mode has none (its
 * value is the total). Candidates follow the label cascade: centered
 * inside if it fits → contrasting backing → outside with auto-routed leader.
 * Interior columns have no gaps, so outside slots usually collide and the
 * label hides — that is the intended sliver behavior; edge columns escape
 * sideways.
 */
/**
 * The value lines the annotation pass draws after this solve ('mean', the
 * default, is the width-weighted mean here), as rules across the plot.
 */
function valueLineRules(env: MekkoEnv, domain: MekkoDomain, area: MekkoArea): Rect[] {
  return (env.options.annotations ?? []).flatMap((annotation) => {
    if (annotation.kind !== 'valueLine') return [];
    const value = typeof annotation.value === 'number' ? annotation.value : domain.meanValue;
    return value === undefined || !Number.isFinite(value) ? [] : [{ x: area.plot.x, y: area.y(value) - 1, w: area.plot.w, h: 2 }];
  });
}

/**
 * An inside seat a value line crosses moves up or down its own segment, past
 * the line, when the segment has the room. The line is solved later and
 * would otherwise take the value, as with Powertrain's Labor 40 in
 * unit-cost-staircase.
 */
function clearOfRules(candidates: SlotCandidate[], segment: Rect, rules: readonly Rect[]): SlotCandidate[] {
  if (rules.length === 0) return candidates;
  return candidates.flatMap((candidate) => {
    if (candidate.insideFill === undefined) return [candidate];
    const seats = seatsPastBlockers(candidate.rect, 'y', segment.y, segment.y + segment.h, rules, 3);
    return seats.length === 0 ? [candidate] : seats.map((rect) => ({ ...candidate, rect }));
  });
}

function segmentLabels(ctx: LabelCtx, geometry: MekkoMarkGeometry): void {
  const { env, domain, area, paints } = ctx;
  const { mode, cats } = domain;
  if (mode === 'bar') return;
  const rules = valueLineRules(env, domain, area);
  // One series in unit mode: each segment is its column, and the total
  // already prints that value above it.
  if (mode === 'unit' && domain.series.length === 1 && area.showTotals) return;
  const baseContent = contentOf(env, 'segment', mode === 'percent' ? ['percent'] : ['absolute']);
  if (!baseContent) return;
  const last = cats.length - 1;
  for (const { s, si, ci, v, rect } of geometry.segments) {
    const c = cats[ci]!;
    const val = s.vals[ci]!;
    // The named column's labels carry their series name: it stands in for the key.
    const content: LabelContent = ci === area.namedCol && !baseContent.includes('series') ? ['series', ...baseContent] : baseContent;
    // A share of a column with a missing part is a share of the known parts
    // only: withheld, unless an authored total100 states the whole.
    const shareWithheld = domain.incomplete.has(c.id) && (mode !== 'percent' || c.total100 === undefined);
    const pct = shareWithheld ? null : mode === 'percent' ? v : (domain.shares[c.id]![s.id] ?? null);
    let text = composeText(env, content, {
      abs: domain.absAt(s, ci), pct, authoredPct: mode === 'percent' && val.isPct, pctText: domain.shareTexts.get(`${c.id}\0${s.id}`),
    }, c.label ?? c.id, s.label, val.format ?? s.format);
    if (typeof val.labelOverride === 'string') {
      text = val.labelOverride.replace(/\$\{value\}/g, text);
    }
    if (!text && val.labelOverride !== false) continue;
    const tsize = env.measure(text || '0', area.labelFont);
    const bw = colW(area, ci);
    // +4 vertical breathing room. +2 leaves inside labels kissing the cell
    // borders in short cells, and +6 overshoots — segments holding a label
    // with 2–3px of air on EACH side (three equal "9%" labels at heights
    // 18.87/20.2/20.2) escalate to a backing chip that near-covers the
    // segment, so equal values render one boxed and two plain. +4 keeps the
    // floor against kissing borders (a chip still fires when the label has
    // under ~2px of air) without boxing labels whose air a reader can see.
    const fits = tsize.height + 4 <= rect.h && tsize.width + 4 <= bw;
    // sliver gate: min column width AND min segment height (totals stay)
    const pin = env.options.labelPlacements?.[`segment:${s.id}:${c.id}`];
    const inGutter = area.gutter > 0 && ci === last;
    // Under 'smart' a share stays while its segment holds the label's line
    // box with the solver's 2 px of air to the neighbour segment: 2 px on
    // both sides, or, in the column's top segment, which has no segment
    // above, 2 px on the side of the segment below. A band row labelled in
    // some columns and blank in others reads as missing data.
    // 'minimal' keeps the inside room.
    const topSegment = Math.abs(rect.y - area.y(Math.max(domain.posTop[ci]!, 0))) < 0.5;
    const air = topSegment ? 2 : 4;
    const tooShort = env.density === 'smart' ? !pin && rect.h < tsize.height + air : segmentTooShort(env.density, rect.h, tsize.height, pin);
    // The top segment's tight seat sits against its lower edge's air, not centred.
    const topSeat = (candidates: SlotCandidate[]): SlotCandidate[] => {
      const tight = topSegment && rect.h < tsize.height + 4 ? candidates.find((candidate) => candidate.slot === 'insideTight') : undefined;
      const y = rect.y + rect.h - 2.01 - tsize.height;
      return tight && y >= rect.y ? [{ ...tight, slot: 'insideTightTop', rect: { ...tight.rect, y }, penalty: 0.9 }, ...candidates] : candidates;
    };
    const sliver = (!pin && !inGutter && env.density !== 'full' && bw < SLIVER_MIN_W) || (!inGutter && tooShort);
    // The gutter right of the last column holds its shares, level with their segments, in the plain ink.
    const gutterSeat: SlotCandidate[] = inGutter && !fits
      ? [{ slot: 'outsideRight', rect: { x: rect.x + rect.w + GUTTER_GAP, y: rect.y + rect.h / 2 - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0 }]
      : [];
    const hl = env.highlights.has(c.id) || env.highlights.has(s.id);
    const priority = val.priority ?? PRIORITY.interior + Math.min(99, Math.abs(v)) + (hl ? PRIORITY.highlightBonus : 0);
    const candidates = [...gutterSeat, ...clearOfRules(topSeat(stackSegmentCandidates(rect, tsize, fits, paints.inside(s, val, c, si, v), { baselineY: area.y0 })), rect, rules)
      // A value escaping the first column into the axis gutter reads as a tick.
      .filter((candidate) => (typeof val.labelOverride === 'string' || candidate.insideFill !== undefined) && (!area.showAxis || candidate.rect.x >= area.plot.x))
      .map(candidate => ({ ...candidate, insidePaint: paints.cell(s, val, c, si, v), insidePattern: paints.pattern(s, val) }))];
    const noInsideSeat = typeof val.labelOverride !== 'string' && gutterSeat.length === 0 && !candidates.some(candidate => candidate.insideFill !== undefined);
    ctx.requests.push({
      id: `segment:${s.id}:${c.id}`,
      kind: 'segment',
      owner: { seriesId: s.id, categoryId: c.id },
      // A withheld share or a share-only cell's missing amount does not print: only what prints counts.
      ...namesOnly(content.filter((part) => (part !== 'percent' || pct !== null) && (part !== 'absolute' || domain.absAt(s, ci) !== null)), val.labelOverride),
      // A label that carries its series name ("Acme 44%") is composed: its role follows the string.
      ...(content.includes('series') ? { role: composedTextRole(text) } : {}),
      text,
      lines: [text],
      font: area.labelFont,
      priority,
      redundant: val.labelOverride === false || sliver || noInsideSeat,
      ...(typeof val.labelOverride !== 'string' ? { noLeader: true } : {}),
      ...(val.labelOverride !== false && noInsideSeat ? { suppressedAs: 'density' as const } : {}),
      candidates,
    });
  }
}

function totalCandidates(
  negative: boolean, barMode: boolean, cx: number, edgeY: number,
  tsize: { width: number; height: number },
  inside: Pick<SlotCandidate, 'insideFill' | 'insidePaint' | 'insidePattern'>,
): SlotCandidate[] {
  const at = (slot: string, y: number, penalty: number, extra = {}): SlotCandidate =>
    ({ slot, rect: { x: cx - tsize.width / 2, y, w: tsize.width, h: tsize.height }, penalty, ...extra });
  return negative
    ? [
        at('outsideBottom', edgeY + 4, 0),
        ...(barMode ? [at('insideEnd', edgeY - tsize.height - 2, 2, inside)] : []),
      ]
    : [
        at('columnTop', edgeY - tsize.height - 2, 0),
        ...(barMode ? [at('insideEnd', edgeY + 2, 2, inside)] : []),
      ];
}

/**
 * The unit of a percent mekko's column totals. The chart unit names the
 * shares there, so the totals, which are sums of the data, take the unit
 * every data series declares; without one they stay bare.
 */
function percentTotalsUnit(domain: MekkoDomain): string | undefined {
  if (domain.mode !== 'percent') return undefined;
  const units = new Set(domain.series.map((s) => s.unit));
  return units.size === 1 ? [...units][0] : undefined;
}

/**
 * A column's total as its label prints it, for the label, the description
 * and the notes alike: a bar its own value (an authored percent as one), a
 * percent or unit column its absolute total.
 */
export function columnTotalText(env: MekkoEnv, domain: MekkoDomain, ci: number, value = domain.columnTotals[domain.cats[ci]!.id]!): string {
  const series = domain.series[0]!;
  const example = domain.mode === 'bar' ? series.vals[ci]!.format ?? series.format : undefined;
  return example ? formatterFromExample(example, env.options.locale?.language)(value)
    : domain.mode === 'bar' && series.vals[ci]!.isPct ? env.authoredPctFmt(value) : env.totalFmt(value);
}

/** The solver's 2 px of air to a rule, plus a hair so the seat is free, not touching. */
const TOTAL_RULE_AIR = 2.05;

const gutterColumn = (area: MekkoArea, ci: number): boolean => area.gutter > 0 && ci === area.xEdge.length - 2;

/**
 * The left edge of a head label (name or total) of width `w`: centred on its
 * column, or, over the gutter column, starting at the column's left edge.
 * Percent mode keeps the last column's heads inside the plot's (and its
 * gutter's) right edge: a name wider than its column reaches left instead.
 */
function headLeft(area: MekkoArea, ci: number, w: number): number {
  // 3 px in from the edge: the solver keeps 2 px of air to the neighbour column's marks.
  const left = gutterColumn(area, ci) ? area.xEdge[ci]! + 3 : colCx(area, ci) - w / 2;
  return area.catsOnTop && ci === area.xEdge.length - 2 ? Math.min(left, area.plot.x + area.plot.w + area.gutter - w) : left;
}

/** A column's total: percent/unit the absolute column total, bar the value itself. */
function totalLabel(ctx: LabelCtx, ci: number, visibleCol: boolean, edges: { top: number; bot: number }, unit?: string): void {
  const { env, domain, area, paints } = ctx;
  const { mode } = domain;
  const c = domain.cats[ci]!;
  const s0 = domain.series[0]!;
  const val0 = s0.vals[ci]!;
  const barV = mode === 'bar' ? domain.plottedAt(s0, ci) : null;
  const totalContent = contentOf(env, 'total', ['absolute']);
  let text = '';
  if (totalContent) {
    if (mode === 'bar') {
      if (barV !== null) text = columnTotalText(env, domain, ci, barV);
    } else {
      text = composeText(env, totalContent, { abs: domain.columnTotals[c.id]!, pct: null }, c.label ?? c.id, '', undefined, env.totalFmt);
    }
  }
  // The shared join: a currency sign where the locale writes it ("$10,000", "10.000 $").
  if (text && unit) text = withUnit(text, unit, false, env.options.locale?.language);
  // A unit column whose stack reaches past zero both ways prints the
  // sum of its parts; the word says so (North: 30 up, -6 down, net 24).
  const net = Boolean(text) && mode === 'unit' && domain.posTop[ci]! > 0 && domain.negBot[ci]! < 0;
  if (net) text = chartString(env.options, 'netValue', { v1: text });
  if (!text || !visibleCol || domain.invalidAt(ci) || domain.incomplete.has(c.id) || domain.wholeUnknown.has(c.id) || (mode !== 'bar' && domain.unknownTotals.has(c.id))) return;
  const tsize = env.measure(text, area.strongFont);
  // A negative total hangs under its column, in unit mode as in bar mode.
  const negative = mode === 'bar' ? barV !== null && barV < 0 : mode === 'unit' && domain.columnTotals[c.id]! < 0;
  const owner = mode === 'bar' ? { seriesId: s0.id, categoryId: c.id } : { categoryId: c.id };
  const candidates = totalCandidates(negative, mode === 'bar', headLeft(area, ci, tsize.width) + tsize.width / 2, negative ? edges.bot : edges.top, tsize,
    negative || mode === 'bar' ? {
      insideFill: paints.inside(s0, val0, c, 0, barV ?? 0),
      insidePaint: paints.cell(s0, val0, c, 0, barV ?? 0),
      insidePattern: paints.pattern(s0, val0),
    } : {},
  );
  // A value line just over the column takes both total seats: the total
  // steps past the line on its own side of the column instead of dropping.
  if (!negative) {
    const rules = valueLineRules(env, domain, area);
    const past = seatsPastBlockers(candidates[0]!.rect, 'y', area.frame.plot.y, edges.top - 2, rules, 3);
    // A column whose top lies just under the line keeps its total between the
    // line and the column. The seat is the ink box (line box less 2 px, the
    // rest is air below the digits) centred in the gap, with the solver's 2 px
    // of air on both sides.
    const first = candidates[0]!.rect;
    const inkH = tsize.height - 2;
    const under = rules.flatMap((rule) => {
      const lo = rule.y + rule.h + TOTAL_RULE_AIR;
      const hi = edges.top - TOTAL_RULE_AIR - inkH;
      if (!rectsOverlap(rule, first, 2) || rule.y + rule.h > edges.top || hi < lo) return [];
      const rect = { ...first, y: (lo + hi) / 2, h: inkH };
      return rules.some((other) => rectsOverlap(other, rect, 2)) ? [] : [rect];
    });
    pushAll(candidates, under.map((rect) => ({ slot: 'columnTopUnderRule', rect, penalty: 0.5 })));
    pushAll(candidates, past.map((rect) => ({ slot: 'columnTopPastRule', rect, penalty: 1.5 })));
  }
  ctx.requests.push({
    id: `total:${c.id}`,
    kind: 'total',
    owner,
    ...(mode === 'bar' ? {} : namesOnly(totalContent?.filter((part) => part !== 'percent'), undefined)),
    ...(net ? { role: composedTextRole(text) } : {}),
    text,
    lines: [text],
    font: area.strongFont,
    priority: PRIORITY.total + (env.highlights.has(c.id) ? PRIORITY.highlightBonus : 0),
    candidates,
  });
}

/**
 * A category name: percent above the total row, unit/bar in one row under
 * the plot, under the lowest bar and its hanging total. A negative
 * column keeps its name and width in that row and its total under the bar,
 * as every other column does; it never swaps them across the axis.
 * A date or numeric name: centred on the column, one row, no stagger slots.
 */
function categoryLabel(ctx: LabelCtx, ci: number, visibleCol: boolean, edges: { top: number; bot: number }): void {
  const { area } = ctx;
  const { catPlan, dateNumericTicks } = area;
  const c = ctx.domain.cats[ci]!;
  if (!visibleCol && ctx.domain.incomplete.has(c.id)) return;
  const { info, left: tx, width } = nameBlock(ctx, ci);
  const at = (slot: string, y: number, penalty: number): SlotCandidate => ({ slot, rect: { x: tx, y, w: info.w, h: info.h }, penalty });
  const aboveY = edges.top - (area.showTotals ? area.totalH + 4 : 2) - info.h - 2;
  const pack = area.namePack;
  const packed = (slot: string, y: number, penalty: number): SlotCandidate => ({ slot, rect: { x: pack!.left[ci]!, y, w: info.w, h: info.h }, penalty });
  // Percent: a name that did not fit its column stands on a second tier over the first names and their totals.
  const upperY = edges.top - (area.showTotals ? area.totalH + 4 : 2) - 2 - (catPlan.rowHeight + area.widthLineH) - UPPER_TIER_GAP - info.h;
  const candidates: SlotCandidate[] = area.catsOnTop
    ? pack?.row[ci] === 1
      ? [{ ...packed('aboveTier', upperY, 0), ...upperLeader(ctx, ci, info.w, edges) }]
      : [at('aboveColumn', aboveY, 0), ...(dateNumericTicks ? [] : [at('aboveColumnShifted', aboveY - catPlan.rowHeight, 1)])]
    : pack
      ? (pack.row[ci] === 1 ? [{ ...packed('belowShifted', area.catRowY + info.h + 2, 0), ...tierLeader(ctx, ci, info.w, edges) }] : [packed('below', area.catRowY, 0), packed('belowShifted', area.catRowY + info.h + 2, 1)])
      : [
        at('below', area.catRowY, 0),
        ...(dateNumericTicks ? [] : [at('belowShifted', area.catRowY + catPlan.rowHeight, 1)]),
      ];
  ctx.requests.push({
    id: `category:${c.id}`,
    kind: 'category',
    owner: { categoryId: c.id },
    text: c.label ?? c.id,
    lines: info.lines,
    ...(width || (pack && !area.catsOnTop) || pack?.row[ci] === 1 ? { align: 'middle' as const } : categoryLineAlign(catPlan, ci)),
    ...(info.title !== undefined ? { title: info.title } : {}),
    font: catPlan.font,
    priority: PRIORITY.endpoint,
    redundant: !catPlan.keep[ci] || !visibleCol,
    candidates,
  });
}

/** A name with its width line under it, and the left edge of the block on the first tier. */
function nameBlock(ctx: LabelCtx, ci: number): { info: MekkoArea['catPlan']['infos'][number]; left: number; width: string | undefined } {
  const { area } = ctx;
  const { catPlan } = area;
  const named = catPlan.infos[ci]!;
  // The column's width rides one line under its name, both centred.
  const width = area.widthTexts?.[ci];
  const info = width
    ? {
      ...named,
      lines: [...named.lines, width],
      w: Math.max(named.w, ctx.env.measure(width, catPlan.font).width),
      h: named.h + area.widthLineH,
    }
    : named;
  const left = area.catsOnTop && ci === area.xEdge.length - 2 ? headLeft(area, ci, info.w) : width ? catPlan.anchor(ci, info.w) : catPlan.x(ci);
  return { info, left, width };
}

/**
 * A name on the second tier over a percent mekko hangs from a thin vertical
 * leader down to the top of its column's total, on a line that no
 * first-tier name covers; with no such line the name draws without one.
 */
function upperLeader(ctx: LabelCtx, ci: number, w: number, edges: { top: number; bot: number }): Pick<SlotCandidate, 'leaderFrom' | 'leaderVertical'> {
  const { area, domain } = ctx;
  const pack = area.namePack!;
  const left = pack.left[ci]!;
  const lo = Math.max(area.xEdge[ci]! + 1, left + 2);
  const hi = Math.min(area.xEdge[ci + 1]! - 1, left + w - 2);
  if (lo > hi) return {};
  const first = domain.cats.flatMap((_, cj) => {
    if (cj === ci || pack.row[cj] !== 0 || !area.catPlan.keep[cj] || area.catPlan.infos[cj]!.w === 0) return [];
    const block = nameBlock(ctx, cj);
    return [{ left: block.left, right: block.left + block.info.w }];
  });
  const clear = (x: number) => first.every((name) => x < name.left - 3 || x > name.right + 3);
  const centre = Math.max(lo, Math.min(hi, (area.xEdge[ci]! + area.xEdge[ci + 1]!) / 2));
  const xs = [centre, ...Array.from({ length: Math.floor(hi - lo) + 1 }, (_, k) => lo + k).sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))];
  const x = xs.find(clear);
  if (x === undefined) return {};
  return { leaderFrom: { x, y: edges.top - (area.showTotals ? area.totalH + 3 : 1) }, leaderVertical: true };
}

/**
 * A name packed onto the second tier hangs from a thin vertical leader to its
 * own column, so the reader sees which column it names. The leader runs from under the column
 * (under its total when that hangs below) to the name, on a line that no
 * first-tier name covers; with no such line the name draws without one.
 */
function tierLeader(ctx: LabelCtx, ci: number, w: number, edges: { top: number; bot: number }): Pick<SlotCandidate, 'leaderFrom' | 'leaderVertical'> {
  const { area, domain } = ctx;
  const pack = area.namePack!;
  const left = pack.left[ci]!;
  const lo = Math.max(area.xEdge[ci]! + 1, left + 2);
  const hi = Math.min(area.xEdge[ci + 1]! - 1, left + w - 2);
  if (lo > hi) return {};
  const clear = (x: number) => domain.cats.every((_, cj) => cj === ci || pack.row[cj] !== 0
    || x < pack.left[cj]! - 3 || x > pack.left[cj]! + pack.width[cj]! + 3);
  const centre = Math.max(lo, Math.min(hi, (area.xEdge[ci]! + area.xEdge[ci + 1]!) / 2));
  // The column centre first, then the nearest clear line within the column and the name.
  const xs = [centre, ...Array.from({ length: Math.floor(hi - lo) + 1 }, (_, k) => lo + k).sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))];
  const x = xs.find(clear);
  if (x === undefined) return {};
  const hangs = edges.bot > area.y0 + 0.5;
  const y = (hangs && area.showTotals ? edges.bot + area.totalH + 2 : Math.max(edges.bot, area.y0)) + 4;
  return y < area.catRowY ? { leaderFrom: { x, y }, leaderVertical: true } : {};
}

/** Phase 3: segment labels, then per column its total (bold) and its category name. */
export function planMekkoLabels(
  env: MekkoEnv,
  domain: MekkoDomain,
  area: MekkoArea,
  geometry: MekkoMarkGeometry,
  paints: MekkoPaints,
  warnings: LintWarning[],
): LabelRequest[] {
  const ctx: LabelCtx = { env, domain, area, paints, requests: [] };
  const sharesOn = contentOf(env, 'segment', domain.mode === 'percent' ? ['percent'] : ['absolute'])?.includes('percent') === true;
  const withheld = [sharesOn ? 'share labels' : '', area.showTotals ? 'totals' : ''].filter(Boolean).join(' and ');
  if (withheld) {
    warnIncompleteComposition(warnings, domain.cats.filter((c) => domain.incomplete.has(c.id)).map((c) => c.label ?? c.id),
      `their ${withheld} would describe the known parts only and are not printed`);
  }
  // Computed percent-mode shares only: an authored percent or total100 is the
  // author's number. rounding 'sum-consistent' closes the drift instead.
  if (sharesOn && domain.mode === 'percent' && env.options.rounding !== 'sum-consistent') {
    warnShareRoundingDrift(warnings, domain.cats.flatMap((c, ci) =>
      domain.invalidAt(ci) || domain.incomplete.has(c.id) || c.total100 !== undefined || domain.series.some((s) => s.vals[ci]!.isPct)
        ? []
        : [((shares) => ({ name: c.label ?? c.id, shares, decimals: shareSetDecimals(shares) }))(domain.series.flatMap((s) => domain.plottedAt(s, ci) ?? []))]));
  }
  segmentLabels(ctx, geometry);
  if (area.widthTitle) {
    // Start-aligned at the frame's left edge, under the axis gutter too: a
    // caption read from the left, wrapped to two lines before it is cut.
    const title = planValueAxisTitle(area.widthTitle.text, env.theme, env.measure, area.frame.plot.w, 2)!;
    ctx.requests.push(valueAxisTitleRequest(title, { x: area.frame.plot.x, y: area.widthTitle.y }, 'start', 'axis:x:title'));
  }
  const { y, y0 } = area;
  // The first printed total names the totals' unit, as the first box names its median.
  // With no subtitle to name it, the chart unit rides the first total.
  const totalsUnit = percentTotalsUnit(domain) ??
    (domain.mode !== 'percent' && env.options.unit && !unitPrinted({ subtitle: resolveSubtitle(env.options.subtitle), unit: env.options.unit, unitShown: env.options.unitShown }) ? env.options.unit : undefined);
  let unitNamed = false;
  domain.cats.forEach((c, ci) => {
    const visibleCol = colW(area, ci) >= 0.5 && (domain.anyByCat[ci]! || domain.incomplete.has(c.id));
    const edges = { top: y(Math.max(domain.posTop[ci]!, 0)), bot: Math.max(y0, y(Math.min(0, domain.negBot[ci]!))) };
    const printsTotal = visibleCol && !domain.invalidAt(ci) && !domain.incomplete.has(c.id) && !domain.wholeUnknown.has(c.id);
    if (area.showTotals) totalLabel(ctx, ci, visibleCol, edges, printsTotal && !unitNamed ? totalsUnit : undefined);
    unitNamed ||= area.showTotals && printsTotal;
    if (area.showCats) categoryLabel(ctx, ci, visibleCol, edges);
  });
  return ctx.requests;
}
