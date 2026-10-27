import { chartString } from '../../strings/gantt';
import { structureCount } from '../../structureCounts';
/**
 * Gantt / timeline — consulting Gantt layout: a two-tier calendar header
 * chosen by span (years+quarters / quarters+months / months+ISO weeks),
 * activity rows with bars, chevrons, milestones, brackets, and shades, a
 * measured left label band with up to three text columns, anchor-resolved
 * item starts, optional weekend shading, and a dashed 'today' line.
 *
 * Slot vocabulary:
 *   activity (row labels + text columns): 'left'
 *   item bar/chevron/shade: 'insideCenter' → 'insideSlide:*' →
 *                           'insideStart' → 'insideEnd' → 'outsideRight' → 'outsideLeft'
 *                           (→ 'insideBacked' when the text never fit)
 *   item milestone: 'above' → 'below' within its row, then side seats,
 *                   'clusterLane' or 'milestoneLane'; crowded rows retry with
 *                   stacked flags before keeping a numbered key
 *   item bracket: 'above' → 'right' → 'belowInside'
 *   valueLine (today): 'aboveLine' → 'aboveLineLeft' → 'aboveLineRight'
 *
 * `layoutGantt` runs five phases, each a function from typed structs
 * to one new struct:
 *   1. domain and scales: `resolveGanttDomain` (domain.ts), then
 *      `ganttFrame` and `ganttBody` (plot.ts);
 *   2. mark geometry: `layoutGanttMarks` (marks.ts);
 *   3. label planning: `planGanttLabels` (labels.ts);
 *   4. annotations: `layoutGanttAnnotations` (events.ts), the event rules and
 *      the today line gantt draws itself; then `solveLabels`;
 *   5. geometry assembly: `assembleGanttGeometry`.
 * No phase touches the run's OccupiedIndex. The frame, the marks and the
 * annotations claim into fresh indexes of their own; this function commits
 * them in order before the solver reads the run's index.
 */

import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { leaderPieces, solveLabels, type SolveResult } from '../../label/solver';
import { authoredFootnoteCount, type FrameResult, type InternalFootnoteOptions } from '../../frame';
import { disclosureNote, disclosuresShown } from '../../notes';
import { rectContains, rectsOverlap, segmentHitsRect, type Rect } from '../../geometry';
import { accessibleTitle } from '../../normalize/shared';
import { rowDrivenHeight } from '../../rowCanvas';
import { ACCEPTANCE_PROBE, CARD_HEIGHT_MEMO, cardReferenceHeight, FORCE_COMPACT, heightOmitted, rowSizing } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { getChart } from '../../registry';
import { AUTO_LEGEND } from '../../legendPolicy';
import { panelTypeClass } from '../../theme';
import type { Id } from '../../types/cell';
import type { GanttData, GanttItem } from '../../types/data';
import type { BaseOptionsFor, LabelKind, LabelContent } from '../../types/options';
import type { Geometry, LintWarning, PlacedLabel, SceneNode } from '../../types/scene';
import { dateFromDay, dayNum } from './calendar';
import { GANTT_ROW_PITCH, resolveGanttDomain, resolveGanttEnv } from './domain';
import { badgeLevels, layoutGanttAnnotations, ruleNodes, type GanttAnnotationLayer } from './events';
import { flagRowPitch, ganttSpanBlockers, planGanttLabels, planRowFlags } from './labels';
import { fmtDay, ganttPaints, layoutGanttMarks, type GanttMarkGeometry } from './marks';
import { BADGE_LEVELS, NO_LANE, ROW_TEXT_PITCH, RULE_LABEL_GAP, type GanttBand, type GanttBody, type GanttDomain, type GanttEnv } from './model';
import { formatDate } from '../../dateFormat';
import { ganttBody, ganttFrame, STACKED_LANE_FLOOR } from './plot';
import { maxOf, minOf, pushAll } from '../../arrays';

/** Per-chart options, declared through optionsSchema. */
export interface GanttOptions extends Omit<BaseOptionsFor<'gantt'>, 'labels'> {
  /** Item category selects its name; absolute (or legacy value) selects its date. */
  labels?: false | (Partial<Record<Exclude<LabelKind, 'item'>, boolean | LabelContent>> & {
    item?: boolean | (LabelContent[number] | 'value')[];
  });
  /** ISO date — dashed vertical 'today' line with a label on top. */
  today?: string;
  /** Tint the elapsed era from the visible start through today. Default true when today renders. */
  elapsed?: boolean;
  /** Sat/Sun background bands; only rendered at week granularity. Default false. */
  weekends?: boolean;
  /** Alternate-row faint background tint. Default false. */
  rowTint?: boolean;
  /** Headers for the existing cols positions, up to three. Extra headers without a column are ignored. */
  colHeaders?: string[];
}

/** Minor calendar unit of the header (major is derived from it). */
export type GanttGranularity = 'weeks' | 'months' | 'quarters';

export interface GanttMarks {
  rows: {
    id: Id;
    y: number;
    h: number;
    itemNodes: { id: Id; kind: GanttItem['kind']; nodeId: Id; rect: Rect; start: string; end: string }[];
    cadenceNodes: { date: string; marker: 'diamond' | 'triangle'; nodeId: Id; rect: Rect }[];
  }[];
  headerRect: Rect;
}

export interface GanttDerived {
  /** Rendered (padded) calendar span, ISO dates, end inclusive. */
  span: { start: string; end: string };
  granularity: GanttGranularity;
}

/** One sentence per row for the accessible description. */
function rowSummaries(env: GanttEnv, domain: GanttDomain): string[] {
  return domain.rows.map((r) => {
    const name = r.sublabel ? `${r.label}, ${r.sublabel}` : r.label;
    if (r.cadence) {
      const days = r.cadence.events.map((event) => event.day);
      return chartString(env.options, 'cadenceSummary', { v1: name, v2: days.length, v3: fmtDay(env, minOf(days)), v4: fmtDay(env, maxOf(days)) });
    }
    if (r.shared) return chartString(env.options, 'sharedMilestonesSummary', { v1: r.items.map((it) => `${it.label ?? it.id} ${fmtDay(env, it.startDay)}`).join(', ') });
    if (r.items.length === 0) return name;
    let lo = Infinity;
    let hi = -Infinity;
    for (const it of r.items) {
      lo = Math.min(lo, it.startDay);
      hi = Math.max(hi, it.endDay);
    }
    return `${name} ${fmtDay(env, lo)} – ${fmtDay(env, hi - 1)}`;
  });
}

/** Placed labels to text nodes, each in the font its request was measured in. */
function labelNodes(env: GanttEnv, domain: GanttDomain, labels: PlacedLabel[]) {
  const { strong, tick, headerMajor, label } = env.fonts;
  const rowIndent = new Map(domain.rows.map((r) => [r.id, r.indent]));
  // A row's sublabel prints muted under (or after) its name.
  const badges = new Set(domain.events.filter((event) => event.badge).map((event) => `event:${event.id}`));
  const nodes = labelsToNodes(env.theme, labels, (l) =>
    l.kind === 'valueLine' || badges.has(l.id)
      ? strong
      : l.id.startsWith('event:')
        ? tick
      : l.id.startsWith('colHeader:')
        ? headerMajor
      : l.kind === 'activity' && !l.id.startsWith('col:') && !l.id.startsWith('sublabel:')
          ? (rowIndent.get(l.owner.categoryId ?? '') ?? 0) === 0
            ? strong
            : label
          : label,
  );
  // A rule's label is muted like the rule it names.
  const rules = new Set(domain.rows.flatMap((row) => row.items.filter((it) => it.kind === 'rule').map((it) => it.id)));
  // A badge label reads on its filled circle.
  return nodes.map((node) => node.t !== 'text' ? node
    : badges.has(node.id.replace(/^label:/, '')) ? { ...node, ink: { token: 'inkInverse' as const } }
    : node.id.startsWith('label:sublabel:') || (node.part === 'item' && rules.has(node.owner.segmentId ?? '')) ? { ...node, ink: { token: 'inkMuted' as const } } : node);
}

/** Phase 5: the scene in paint order, the sizing record, the axis ticks and the accessible description. */
function assembleGanttGeometry(input: {
  env: GanttEnv;
  domain: GanttDomain;
  frame: FrameResult;
  band: GanttBand;
  body: GanttBody;
  geometry: GanttMarkGeometry;
  annotated: GanttAnnotationLayer;
  solved: SolveResult;
  occupied: OccupiedIndex;
  warnings: LintWarning[];
  keyRowHeight: number;
  cardHeight?: number;
  flagRows: ReadonlySet<string>;
}): Geometry<GanttMarks, GanttDerived> {
  const { env, domain, frame, band, body } = input;
  let { solved } = input;
  const { size, options } = env;
  // Keep the selected layout and every other label seat. Retry an arrow
  // name with no seat as well as a span name that touches a diamond or tip,
  // or crowds an outside name.
  const spans = new Map(input.geometry.rows.flatMap(row => {
    return row.items.filter(item => ['bar', 'chevron', 'shade'].includes(item.it.kind))
      .map(item => [item.it.id, { row, item }] as const);
  }));
  const unsafe = new Set(solved.placed.filter(label => {
    const span = spans.get(label.owner.segmentId ?? '');
    if (label.pinned || !span) return false;
    // Keep milestone flag selection unchanged: this retry uses a row with no milestones.
    // A span name that an event or today rule hid retries inside its mark, across the rule.
    if (label.hidden) return label.hidden === 'collision' && ((span.item.it.kind === 'chevron'
      && !span.row.items.some(item => item.it.kind === 'milestone')) || body.ruleClaims.length > 0);
    return ganttSpanBlockers(span.row, { id: span.item.it.id, rect: label.rect })
      .some(rect => rectsOverlap(label.rect, rect, 2)) || (!rectContains(span.item.rect, label.rect)
        && solved.placed.some(other => other !== label && !other.hidden && other.kind === 'item'
          && other.owner.categoryId === label.owner.categoryId
          && label.rect.y < other.rect.y + other.rect.h && label.rect.y + label.rect.h > other.rect.y
          && rectsOverlap(label.rect, other.rect, 12)));
  }).map(label => label.id));
  if (unsafe.size) {
    const owners = new Set(solved.placed.filter(label => unsafe.has(label.id)).map(label => label.owner.segmentId));
    const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
    for (const claim of input.occupied.snapshot()) {
      if (claim.kind === 'label' && owners.has(claim.owner.segmentId)) continue;
      occupied.claim(claim.rect, claim.kind, claim.owner, claim.part, claim.polygon);
    }
    const kept = solved.placed.filter(label => !label.hidden && !unsafe.has(label.id));
    const leaders = kept.flatMap(label => label.leader ? leaderPieces(label.leader.d, 64) : []);
    const requests = planGanttLabels(env, domain, band, body, input.geometry, ganttPaints(env, domain.rows), new Map(), input.flagRows, kept.map(label => label.rect), true)
      .filter(request => unsafe.has(request.id)).map(request => ({ ...request,
        candidates: request.candidates.filter(candidate => !leaders.some(([a, b]) => segmentHitsRect(a, b, candidate.rect, 2))),
      }));
    const repair = solveLabels(requests, occupied, {
      focus: options.focus, density: 'full', pins: {}, measure: env.measure, plot: body.plot,
      canvas: { x: 0, y: 0, w: size.width, h: size.height }, darkInk: env.theme.color.ink, lightInk: env.theme.color.inkInverse, labelPad: LABEL_PAD,
    });
    // A hidden arrow name that still finds no seat stays hidden; it does not undo the other repairs.
    const retried = new Set(solved.placed.filter(label => unsafe.has(label.id) && label.hidden).map(label => label.id));
    if (repair.placed.length === unsafe.size && repair.placed.every(label => !label.hidden || retried.has(label.id))) {
      const moved = new Map(repair.placed.filter(label => !label.hidden).map(label => [label.id, label]));
      solved = { ...solved, placed: solved.placed.map(label => moved.has(label.id) ? { ...label, ...moved.get(label.id)!, hidden: undefined } : label),
        decisions: [...solved.decisions.filter(decision => !moved.has(decision.labelId)),
          ...repair.decisions.filter(decision => moved.has(decision.labelId))] };
      input.occupied = occupied;
      input.warnings.push(...repair.warnings);
    }
  }
  for (const label of solved.placed) {
    if (label.hidden !== 'collision' || spans.get(label.owner.segmentId ?? '')?.item.it.kind !== 'chevron') continue;
    input.warnings.push({ code: 'gantt-arrow-label-hidden', severity: 'warn', owner: label.owner,
      message: `Arrow name '${label.text}' has no clear label seat at this size`,
      suggest: 'increase chart width or shorten the arrow name' });
  }
  const { rows, granularity, d0Day, d1Day, milestones } = domain;
  const n = rows.length;
  const { colWs } = body.columns;
  const laneLabelW = milestones.laneLabelW;
  return {
    type: 'gantt',
    size,
    sizing: rowSizing('gantt', size, {
      chromeH: size.height - band.bodyH,
      minimumRowsH: band.stacked
        ? n * Math.max(STACKED_LANE_FLOOR, input.keyRowHeight) + rows.filter((row) => !row.shared || band.sharedLine).length * band.nameLineH
        : n * Math.max(28, input.keyRowHeight, maxOf(body.rowLabels.map((label) => label.h + (label.sub ? 2 + label.sub.h : 0) + LABEL_PAD))),
      naturalRowsH: Math.max(band.naturalRowsH, (input.cardHeight ?? 0) - (size.height - band.bodyH)),
      minWidth: band.stacked ? size.width - body.inner.w + Math.max(80, band.stackedLineW) : size.width - body.inner.w + body.minimumLabelBandW + 12 + colWs.reduce((sum, width) => sum + width, 0) + (colWs.length ? 4 : 0) + 80 + (laneLabelW && options.mode !== 'compact' ? body.laneGap + laneLabelW : 0),
    }),
    plot: body.plot,
    scene: [...frame.nodes, ...gridAroundLabels([...input.geometry.nodes, ...input.annotated.nodes], solved.placed, spans), ...labelNodes(env, domain, solved.placed)],
    labels: solved.placed,
    axes: [
      {
        axis: 'x',
        ticks: domain.minorStarts.map((s) => ({
          at: formatDate(s, 'yyyy-MM-dd'),
          pos: body.x(Math.max(dayNum(s), d0Day)),
        })),
      },
    ],
    annotations: [...input.geometry.elapsed, ...input.annotated.placed],
    legend: frame.legend,
    frame: frame.frame,
    marks: input.geometry.marks,
    derived: {
      span: {
        start: formatDate(dateFromDay(d0Day), 'yyyy-MM-dd'),
        end: formatDate(dateFromDay(d1Day - 1), 'yyyy-MM-dd'),
      },
      granularity,
    },
    a11y: {
      titleCounts: [structureCount('activities', rows.filter(row => !row.shared).length, undefined, env.options)],
      title: accessibleTitle(options.title, chartString(options, 'ganttTitle', { v1: rows.filter((row) => !row.shared).length })),
      counts: [...domain.rows.flatMap(row => row.cadence ? [structureCount('events', row.cadence.events.length, chartString(options, 'cadenceEvents', { v1: row.cadence.events.length }))] : [])],
      desc: chartString(options, 'ganttDesc', { v1: chartString(options, ({ days: 'ganttDays', weeks: 'ganttWeeks', months: 'ganttMonths', quarters: 'ganttQuarters', years: 'ganttYears' } as const)[granularity]), v2: fmtDay(env, d0Day), v3: fmtDay(env, d1Day - 1), v4: rowSummaries(env, domain).join('; ') }),
    },
    warnings: input.warnings,
    debug: { occupied: input.occupied.snapshot(), decisions: solved.decisions },
  };
}

/**
 * A line never touches text. A calendar gridline or today line passes a
 * drawn label (a status word, a row name, an owner) with a gap, as the today line passes the
 * period names of the head (ruleNodes). The shared pass in markVisibility breaks only a line
 * that runs through the glyphs; a line within 2 px of a label's edge breaks here.
 */
function gridAroundLabels(nodes: readonly SceneNode[], placed: SolveResult['placed'], spans: ReadonlyMap<string, { item: { rect: Rect } }>): SceneNode[] {
  const labels = placed.filter((label) => !label.hidden);
  if (labels.length === 0) return [...nodes];
  const grid = labels.map((label) => label.rect);
  // An event or today rule breaks over the whole mark a name sits in (a dash
  // left above or below the text reads as a speck), else 2 px above and below the name.
  const rules = labels.map((label) => {
    const mark = spans.get(label.owner.segmentId ?? '')?.item.rect;
    return mark && rectContains(mark, label.rect) ? { ...label.rect, y: mark.y, h: mark.h } : { ...label.rect, y: label.rect.y - 1, h: label.rect.h + 2 };
  });
  return nodes.flatMap((node) => {
    if (node.t !== 'line' || (node.part !== 'grid' && node.part !== 'todayLine' && node.part !== 'eventRule') || node.x1 !== node.x2) return [node];
    const { x1, y1, y2, id, t: _t, x2: _x2, ...style } = node;
    // The snapshot rule needs visible air beside a name, including after a
    // line-on-fill repaint. Grid rules keep their existing gap.
    const gap = node.part === 'grid' ? 2 : RULE_LABEL_GAP[node.part];
    const near = (node.part === 'grid' ? grid : rules).filter((rect) => x1 >= rect.x - gap && x1 <= rect.x + rect.w + gap && rect.y < Math.max(y1, y2) && rect.y + rect.h > Math.min(y1, y2));
    if (!near.length) return [node];
    const pieces = ruleNodes(id, x1, Math.min(y1, y2), Math.max(y1, y2), near.map(rect => ({ ...rect, x: rect.x - gap + 2, w: rect.w + 2 * (gap - 2) })), style);
    return node.part === 'grid' ? pieces : pieces.map((piece, index) => index ? { ...piece, id: `${id}:label:${index}` } : piece);
  });
}

/** Replays a phase's claims, in claim order, into the run's index. */
function commitClaims(occupied: OccupiedIndex, phase: OccupiedIndex): void {
  for (const c of phase.snapshot()) occupied.claim(c.rect, c.kind, c.owner, c.part);
}

// The registry tries full before compact. Keep that full context so a wider
// reference does not inherit compact spacing or minimal label density.
/** The label solver keeps this gap between labels; rows touch, so a row name needs its height plus this gap. */
const LABEL_PAD = 2;
const fullCardOptions = new WeakMap<GanttData, GanttOptions>();

/** Rows that retry with stacked milestone flags; in open height, the lane height each needs, and whether unused flag height is already trimmed. */
interface FlagPass { rows: ReadonlySet<string>; pitch?: ReadonlyMap<string, number>; trimmed?: boolean }

function layoutGanttPass(data: GanttData, options: GanttOptions = {}, keyed: ReadonlySet<string> = new Set(), autoHeight = heightOmitted(options.size), flags: FlagPass = { rows: new Set() }): Geometry<GanttMarks, GanttDerived> {
  if (data && typeof data === 'object' && options.mode !== 'compact' && !(options as { [FORCE_COMPACT]?: boolean })[FORCE_COMPACT]) {
    const { [CARD_HEIGHT_MEMO]: _call, ...full } = options as GanttOptions & { [CARD_HEIGHT_MEMO]?: unknown };
    fullCardOptions.set(data, full);
  }
  const warnings: LintWarning[] = [];
  if (options.format !== undefined) warnings.push({
    code: 'format-unused', severity: 'warn', field: ['options', 'format'],
    message: "'gantt' has no value labels of its own; options.format is ignored in this release and will be refused in the next release",
    suggest: 'Remove options.format. Gantt formats calendar dates through its date options.', fix: [{ op: 'remove', path: '/options/format' }],
  });
  const env = resolveGanttEnv(options, warnings);
  const domain = resolveGanttDomain(data, env, warnings);
  const heightOpen = autoHeight || (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false;
  if (heightOpen && flags.pitch) for (const [id, pitch] of flags.pitch) domain.milestones.flagPitch.set(id, pitch);
  const keyEntries = [...domain.milestones.byId.values()].filter(entry => keyed.has(entry.item.id));
  // Under footnotes: false there is no key: a milestone that needs it
  // keeps its diamond, its label is left off, and the frame names its key
  // entry in the footnotes-off lint with the other notes it left off.
  // The key is engine text: it prints only where `notes.show` lists
  // 'disclosure'. Else the milestones take the same path, and the key
  // entries stay in the notes list as unnumbered disclosures.
  const footnotesOff = (options as InternalFootnoteOptions).footnotesOff === true || options.footnotes === false;
  const notesOff = footnotesOff || !disclosuresShown(options);
  const keyNumbers = new Map(notesOff ? [] : keyEntries.map((entry, i) => [entry.item.id, authoredFootnoteCount(options) + domain.eventFootnotes.length + i + 1]));
  const keyText = keyEntries.map(entry => `${entry.text} (${domain.rows[entry.rowIndex]!.label})`);
  const milestoneKey = notesOff && !footnotesOff ? [] : keyText;
  const listedKey = notesOff && !footnotesOff ? keyText.map(text => disclosureNote(text)) : [];
  const keyRowHeight = keyEntries.length && !notesOff ? 32 + 2 * maxOf(keyEntries.map(entry => entry.size.height)) : 0;
  if (keyEntries.length && !notesOff) {
    domain.milestones.clusterRowH = Math.max(domain.milestones.clusterRowH, keyRowHeight);
    warnings.push({ code: 'milestone-numbered-key', severity: 'info',
      message: `Milestones use a numbered key where labels or leaders have no clear seat: ${keyEntries.map(entry => entry.text).join('; ')}` });
  }
  const { size } = env;
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const paints = ganttPaints(env, domain.rows);
  // A fixed height keeps the table form when the stacked rows would not fit it.
  const { frame, claims, band } = ganttFrame(env, domain, paints, warnings, milestoneKey, heightOpen, listedKey, !notesOff);
  commitClaims(occupied, claims);
  const grow = rowDrivenHeight({
    options: autoHeight ? { ...options, size: undefined } : options,
    width: size.width,
    height: size.height,
    chromeH: size.height - band.bodyH,
    // A row's natural pitch is its cap: 40 px, or what a milestone cluster
    // needs. Brackets and cluster leaders sit inside it.
    rowsH: band.naturalRowsH,
  });
  if (grow !== undefined) return layoutGanttPass(data, { ...options, size: { width: size.width, height: grow } }, keyed, autoHeight, flags);
  const body = ganttBody(env, domain, frame, band, warnings);
  // Table form: a row whose name and sublabel need more than its pitch is laid out again with that pitch.
  if (!band.stacked) {
    const known = (options as { [ROW_TEXT_PITCH]?: ReadonlyMap<string, number> })[ROW_TEXT_PITCH] ?? new Map<string, number>();
    const grown = new Map(known);
    body.rowLabels.forEach((label, i) => {
      const need = label.sub ? label.h + 2 + label.sub.h + 2 * LABEL_PAD : 0;
      const id = domain.rows[i]!.id;
      if (need > Math.max(GANTT_ROW_PITCH, known.get(id) ?? 0) + 0.5) grown.set(id, need);
    });
    if (grown.size > known.size) return layoutGanttPass(data, { ...options, [ROW_TEXT_PITCH]: grown } as GanttOptions, keyed, autoHeight, flags);
  }
  // Badges that crowd on the drawn timeline stack up: lay the chart out again with the strip they need.
  const badgeLevelCount = 1 + Math.max(0, ...badgeLevels(env, domain, body.x).values());
  if (badgeLevelCount > ((options as { [BADGE_LEVELS]?: number })[BADGE_LEVELS] ?? 1)) {
    return layoutGanttPass(data, { ...options, [BADGE_LEVELS]: badgeLevelCount } as GanttOptions, keyed, autoHeight, flags);
  }
  const geometry = layoutGanttMarks(env, domain, band, body, paints);
  commitClaims(occupied, geometry.claims);
  // Open height: plan the flag levels on the drawn timeline, then lay the chart out with those row heights.
  if (heightOpen && flags.rows.size && !flags.pitch) {
    const pitch = new Map(geometry.rows.filter(place => flags.rows.has(place.row.id))
      .map(place => [place.row.id, flagRowPitch(planRowFlags(domain, body, place))] as const).filter(([, pitch]) => pitch > 0));
    return layoutGanttPass(data, options, keyed, autoHeight, { rows: flags.rows, pitch });
  }
  const requests = planGanttLabels(env, domain, band, body, geometry, paints, keyNumbers, flags.rows)
    .filter(request => !(notesOff && request.kind === 'item' && keyed.has(request.owner.segmentId ?? '')));
  const annotated = layoutGanttAnnotations(env, domain, band, body, geometry.headNames);
  commitClaims(occupied, annotated.claims);
  const solved = solveLabels([...requests, ...annotated.requests], occupied, {
    focus: options.focus,
    density: options.labelDensity ?? 'smart',
    pins: options.labelPlacements ?? {},
    measure: env.measure,
    plot: body.plot,
    canvas: { x: 0, y: 0, w: size.width, h: size.height },
    darkInk: env.theme.color.ink,
    lightInk: env.theme.color.inkInverse,
    labelPad: LABEL_PAD,
  });
  // Check the actual shared-solver path, including its curve. A leader may
  // leave its own bar, but cannot pass another diamond or another row's mark.
  const nextKey = new Set(keyed);
  for (const label of solved.placed) {
    const id = label.owner.segmentId;
    if (!id || keyed.has(id) || !domain.milestones.byId.has(id)) continue;
    const row = geometry.rows.find(row => row.items.some(item => item.it.id === id))!;
    const origin = row.items.find(item => item.it.id === id)!;
    const anchor = { x: origin.cx, y: origin.rect.y + origin.rect.h / 2, w: 0, h: 0 };
    const crossed = label.leader && leaderPieces(label.leader.d, 64).some(([a, b]) =>
      geometry.marks.rows.some(row => [...row.itemNodes, ...row.cadenceNodes.map(mark => ({ ...mark, id: mark.nodeId }))].some(mark => mark.id !== id
        && !(row.id === label.owner.categoryId && rectContains(mark.rect, anchor))
        && segmentHitsRect(a, b, mark.rect))));
    if (crossed) nextKey.add(id);
  }
  if (nextKey.size > keyed.size) return layoutGanttPass(data, options, nextKey, autoHeight, flags);
  // A flag the solver could not seat gives its height back. A squeezed probe
  // canvas seats fewer flags than the natural height, so it trims nothing.
  if (heightOpen && flags.pitch && !flags.trimmed && domain.rows.every((row, i) => band.rowHs[i]! >= (flags.pitch!.get(row.id) ?? 0) - 0.5)) {
    const used = new Map<string, number>();
    for (const place of geometry.rows) {
      if (!flags.pitch.has(place.row.id)) continue;
      const seated = solved.placed.filter(label => !label.hidden && label.slot?.startsWith('flag') && place.items.some(item => item.it.id === label.owner.segmentId));
      const pitch = flagRowPitch(planRowFlags(domain, body, place), seated.map(label => label.owner.segmentId!));
      if (pitch > 0) used.set(place.row.id, pitch);
    }
    if ([...flags.pitch].some(([id, pitch]) => (used.get(id) ?? 0) < pitch - 0.5)) return layoutGanttPass(data, options, keyed, autoHeight, { ...flags, pitch: used, trimmed: true });
  }
  // The report targets give the milestone lane back to the timeline when
  // the lane does not pay: the chart is laid out again without it, and that
  // run stands when it hides fewer labels, or as many while no item label
  // sat in the lane.
  if (body.laneEnabled && !(options as { [NO_LANE]?: true })[NO_LANE]) {
    const hidden = solved.placed.filter((label) => label.hidden).length;
    const laneUsed = solved.placed.some((label) => label.kind === 'item' && !label.hidden && label.rect.x + label.rect.w > body.bodyX + body.bodyW + 0.5);
    // Without the lane the timeline is wider: the flags are planned again.
    const wide = layoutGanttPass(data, { ...options, [NO_LANE]: true } as GanttOptions, keyed, autoHeight, { rows: flags.rows });
    const wideHidden = wide.refused ? Infinity : wide.labels.filter((label) => label.hidden).length;
    const flagsFit = flags.rows.size > 0 && [...domain.milestones.byId].every(([id, entry]) =>
      wide.labels.some(label => !label.hidden && label.owner.segmentId === id && label.text === entry.text));
    if (wideHidden < hidden || (wideHidden === hidden && (!laneUsed || flagsFit))) return wide;
  }
  pushAll(warnings, solved.warnings);
  // Content sizing needs the same card-height rule as fill sizing. Compare
  // with the registered wider form, including its key and composed notes.
  const openHeight = autoHeight || (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false;
  let cardHeight: number | undefined;
  if (openHeight && size.width < 480 && panelTypeClass(options) === undefined
    && !(options as { [ACCEPTANCE_PROBE]?: boolean })[ACCEPTANCE_PROBE]) {
    const host = (options as { [FORCE_COMPACT]?: boolean })[FORCE_COMPACT] ? fullCardOptions.get(data) ?? options : options;
    const internal = host as GanttOptions & InternalFootnoteOptions;
    // Engine note and key markers belong to the current drawing. A wider
    // reference must not mark its hidden labels as already disclosed here.
    const wider = { ...Object.fromEntries(Object.entries(host)) as GanttOptions, size: { width: size.width < 400 ? 400 : 480 },
      footnotes: internal.footnotesOff ? false as const : internal.authoredFootnotes ?? host.footnotes };
    delete (wider as TargetSizeOptions)[TARGET_SIZE];
    delete (wider as GanttOptions & { [FORCE_COMPACT]?: boolean })[FORCE_COMPACT];
    delete (wider as GanttOptions & InternalFootnoteOptions).authoredFootnotes;
    delete (wider as GanttOptions & InternalFootnoteOptions).footnotesOff;
    if (AUTO_LEGEND in host) { delete wider.mode; wider.legend = 'auto'; }
    cardHeight = cardReferenceHeight(data, options, wider, at => getChart('gantt')!.layout(data, at), () => {
      // A real wider draw leaves its full-mode context for a later compact
      // pass. A memo hit must leave the same context.
      const full = fullCardOptions.get(data);
      return () => { if (full) fullCardOptions.set(data, full); else fullCardOptions.delete(data); };
    });
  }
  return assembleGanttGeometry({ env, domain, frame, band, body, geometry, annotated, solved, occupied, warnings, keyRowHeight, cardHeight, flagRows: flags.rows });
}

/** Keep clear layouts unchanged; retry only rows whose final layout loses a milestone's identity. */
export function layoutGantt(data: GanttData, options: GanttOptions = {}): Geometry<GanttMarks, GanttDerived> {
  const first = layoutGanttPass(data, options);
  if (options.labels === false || options.labels?.item === false) return first;
  // This open-height probe reads only width acceptance, not the repaired labels or height.
  if ((options as { [ACCEPTANCE_PROBE]?: boolean })[ACCEPTANCE_PROBE]
    && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && first.size.width >= first.sizing!.minWidth) return first;
  const labels = new Map(first.labels.filter(label => label.kind === 'item').map(label => [label.owner.segmentId, label]));
  const crossings = new Set(first.warnings.filter(warning => warning.code === 'label-leader-crossing').map(warning => warning.owner?.segmentId));
  const suspects = first.marks.rows.flatMap(row => row.itemNodes.filter(mark => {
    if (mark.kind !== 'milestone') return false;
    const label = labels.get(mark.id);
    // labelDensity: 'minimal' drops a milestone label on request; flags would only add empty height.
    if (options.labelDensity === 'minimal' && label?.hidden === 'density') return false;
    return !label || label.hidden || crossings.has(mark.id) || label.slot === 'rightPast' || label.slot === 'leftPast'
      || first.warnings.some(warning => warning.code === 'milestone-numbered-key');
  }).map(mark => ({ row, mark })));
  if (!suspects.length) return first;
  const env = resolveGanttEnv(options, []);
  const domain = resolveGanttDomain(data, env, []);
  const flagRows = new Set(suspects.filter(({ mark }) => {
    const entry = domain.milestones.byId.get(mark.id);
    if (!entry) return false;
    const label = labels.get(mark.id);
    return !label || label.hidden || crossings.has(mark.id) || label.text !== entry.text
      || Math.max(label.rect.x - mark.rect.x - mark.rect.w, mark.rect.x - label.rect.x - label.rect.w) > env.fonts.label.size;
  }).map(({ row }) => row.id));
  if (!flagRows.size) return first;
  const autoHeight = heightOmitted(options.size);
  const retry = layoutGanttPass(data, options, new Set(), autoHeight, { rows: flagRows });
  // A constrained canvas must not lose a bar name or another full label to make room for flags.
  const keeps = (before: Geometry<GanttMarks, GanttDerived>, after: Geometry<GanttMarks, GanttDerived>): boolean => {
    const kept = new Map(after.labels.filter(label => !label.hidden).map(label => [label.id, label.text]));
    return before.labels.every(label => label.hidden || kept.get(label.id) === label.text
      || (domain.milestones.byId.has(label.owner.segmentId ?? '') && label.text !== domain.milestones.byId.get(label.owner.segmentId!)!.text));
  };
  if (!autoHeight && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height !== false) return keeps(first, retry) ? retry : first;
  // Open height: the sizing code lays a chart out at a first card height and
  // then at the natural height it reports. Judge both layouts at the height
  // they settle at, so every probe and the final size take the same choice.
  const settle = (geo: Geometry<GanttMarks, GanttDerived>, flags: FlagPass): Geometry<GanttMarks, GanttDerived> => {
    for (let round = 0; round < 3 && !geo.refused && geo.sizing && geo.sizing.naturalHeight > geo.size.height + 0.5; round++) {
      geo = layoutGanttPass(data, { ...options, size: { width: geo.size.width, height: geo.sizing.naturalHeight } }, new Set(), true, flags);
    }
    return geo;
  };
  const before = settle(first, { rows: new Set() });
  const after = settle(retry, { rows: flagRows });
  // Full milestone labels: the whole text, drawn, with no leader across another label.
  const full = (geo: Geometry<GanttMarks, GanttDerived>): number => geo.refused ? -1 : geo.labels.filter(label => !label.hidden && label.kind === 'item'
    && label.text === domain.milestones.byId.get(label.owner.segmentId ?? '')?.text
    && !geo.warnings.some(warning => warning.code === 'label-leader-crossing' && warning.owner?.segmentId === label.owner.segmentId)).length;
  // In open height the flags must show more full milestone labels: a retry
  // that only moves labels could still report a taller natural height.
  return full(after) > full(before) && keeps(before, after) ? retry : first;
}
