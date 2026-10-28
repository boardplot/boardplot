import { chartString } from '../../strings/gantt';
import { strokeToken, dashToken } from '../../theme';
/**
 * Gantt phase 4: the annotations gantt draws itself. Labelled event
 * rules (a date or a stable schedule-item anchor; numbered badges above three
 * events) and the dashed 'today' line. Nodes and claims come back like phase
 * 2's, label requests like phase 3's; the solver takes them after the rows'.
 */

import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { CROSSABLE_RULE_PART, PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import type { Rect } from '../../geometry';
import type { OwnerRef } from '../../types/cell';
import type { Paint, PlacedAnnotation, SceneNode } from '../../types/scene';
import { dayNum } from './calendar';
import { fmtDay } from './marks';
import { BADGE_LEVELS, laneTop, type GanttBand, type GanttBody, type GanttDomain, type GanttEnv } from './model';
import { composedTextRole } from '../../textRole';
import { authoredFootnoteCount } from '../../frame';
import { pushAll } from '../../arrays';

/** Phase 4 output. */
export interface GanttAnnotationLayer {
  nodes: SceneNode[];
  claims: OccupiedIndex;
  requests: LabelRequest[];
  placed: PlacedAnnotation[];
}

type RuleStyle = Pick<Extract<SceneNode, { t: 'line' }>, 'stroke' | 'width' | 'dash' | 'owner' | 'part'>;

/**
 * A dashed rule from the calendar head to the last row, as line nodes. It
 * passes a period name of the head with a gap instead of striking it through
 * ("Oct" under a today line); the first node keeps the rule's id and
 * runs down to the last row, the pieces above it follow.
 */
export function ruleNodes(id: string, x: number, top: number, bottom: number, headNames: readonly Rect[], style: RuleStyle): Extract<SceneNode, { t: 'line' }>[] {
  const cuts = headNames
    .filter((name) => x >= name.x - 2 && x <= name.x + name.w + 2)
    .map((name) => [name.y - 1, name.y + name.h + 1] as const)
    .sort((p, q) => p[0] - q[0]);
  const runs: [number, number][] = [];
  let y = top;
  for (const [from, to] of cuts) {
    if (from > y) runs.push([y, from]);
    y = Math.max(y, to);
  }
  if (y < bottom) runs.push([y, bottom]);
  // A piece shorter than a dash between two names reads as a speck, not a rule.
  return runs.filter(([y1, y2]) => y2 - y1 >= 3).reverse().map(([y1, y2], index) => ({ t: 'line', id: index === 0 ? id : `${id}:head:${index}`, x1: x, y1, x2: x, y2, ...style }));
}

/**
 * What a rule claims: the calendar head and the rows. Stacked, it claims the
 * head and each lane only: the name lines print across it, as the grid does,
 * so a row name or a status is never dropped for a rule. The row part is
 * crossable: a span name that has no seat clear of the rules may sit inside
 * its own mark across it, and the rule breaks around the mark (layout's
 * repair and gridAroundLabels). Every other label keeps it as an obstacle.
 */
function claimRule(claims: OccupiedIndex, band: GanttBand, domain: GanttDomain, x: number, halfWidth: number, owner: OwnerRef): void {
  const { headerTop, rowsTop, rowsBottom } = band;
  if (!band.stacked) {
    claims.claim({ x: x - halfWidth, y: headerTop, w: 2 * halfWidth, h: rowsTop - headerTop }, 'annotation', owner);
    claims.claim({ x: x - halfWidth, y: rowsTop, w: 2 * halfWidth, h: rowsBottom - rowsTop }, 'annotation', owner, CROSSABLE_RULE_PART);
    return;
  }
  claims.claim({ x: x - halfWidth, y: headerTop, w: 2 * halfWidth, h: band.headerH }, 'annotation', owner);
  domain.rows.forEach((_, i) => claims.claim({ x: x - halfWidth, y: laneTop(band, domain.rows, i), w: 2 * halfWidth, h: band.rowHs[i]! }, 'annotation', owner, CROSSABLE_RULE_PART));
}

/** The common radius of the filled event badges: room for the widest badge label, at least 9 px. */
export function badgeRadius(env: GanttEnv, domain: GanttDomain): number {
  return Math.max(9, ...domain.events.filter((event) => event.badge).map((event) => env.measure(event.label, env.fonts.strong).width / 2 + 4));
}

/** A badge's circle fill; its label ink is decided against it in each theme. */
export function badgeFill(event: GanttDomain['events'][number]): Paint {
  return { token: event.tone === 'bad' ? 'bad' : 'ink' };
}

/**
 * The marker band right over the calendar head: ordinary event labels or
 * numbered rings, else the today label; 0 without either. Badges stack in
 * their own strip above it, so a badge never takes a seat a marker draws in without badges.
 */
export function markerBand(domain: GanttDomain, markerLabelH: number): number {
  if (domain.events.some((event) => !event.badge)) return domain.eventBadgeMode ? markerLabelH + 8 : 2 * markerLabelH + 8;
  return domain.todayDay !== null ? markerLabelH + 6 : 0;
}

/** Badge levels by event id: a badge closer than 2r + 4 px to one already on a level moves up one level. None without annotation labels. */
export function badgeLevels(env: GanttEnv, domain: GanttDomain, x: (day: number) => number): Map<string, number> {
  const levels = new Map<string, number>();
  if (!env.labelOn('annotation')) return levels;
  const pitch = 2 * badgeRadius(env, domain) + 4;
  const xs: number[][] = [];
  for (const event of domain.events.filter((e) => e.badge).sort((a, b) => a.ruleDay - b.ruleDay)) {
    const ex = x(event.ruleDay);
    let level = 0;
    while (xs[level]?.some((other) => Math.abs(other - ex) < pitch)) level++;
    (xs[level] ??= []).push(ex);
    levels.set(event.id, level);
  }
  return levels;
}

/** The strip the badges need over the marker band, in px; 0 without badges or without annotation labels (no badge is drawn). */
export function badgeStrip(env: GanttEnv, domain: GanttDomain): number {
  if (!env.labelOn('annotation') || !domain.events.some((event) => event.badge)) return 0;
  const r = badgeRadius(env, domain);
  const levels = (env.options as { [BADGE_LEVELS]?: number })[BADGE_LEVELS] ?? 1;
  return 2 * r + 8 + (levels - 1) * (2 * r + 4);
}

/** Labelled event rules: a dashed vertical per event, then its badge, its numbered ring or its label. */
function eventRules(env: GanttEnv, domain: GanttDomain, band: GanttBand, body: GanttBody, layer: GanttAnnotationLayer, headNames: readonly Rect[]): void {
  const { headerTop, rowsBottom, markerLabelH } = band;
  const { labelOn, measure } = env;
  const { tick } = env.fonts;
  const { nodes, claims, requests } = layer;
  // Badge n is footnote n: the author's notes take the first numbers.
  const keyed = domain.events.filter((event) => !event.badge);
  const badgeNo = (event: GanttDomain['events'][number]): number => keyed.indexOf(event) + 1 + authoredFootnoteCount(env.options);
  const r = badgeRadius(env, domain);
  const levels = badgeLevels(env, domain, body.x);
  // Badges paint over every rule: a stacked badge's rule passes behind a lower badge.
  const badges: SceneNode[] = [];
  domain.events.forEach((event) => {
    const ex = body.x(event.ruleDay);
    const owner: OwnerRef = { annotationId: event.id };
    // A badge sits over the head; its rule starts 2 px under the circle.
    const badgeCy = headerTop - markerBand(domain, markerLabelH) - 2 - r - (levels.get(event.id) ?? 0) * (2 * r + 4);
    const drawsBadge = event.badge && labelOn('annotation');
    const rule = ruleNodes(`ann:event:${event.id}:line`, ex, drawsBadge ? badgeCy + r + 2 : headerTop, rowsBottom, headNames, {
      stroke: { token: event.tone === 'bad' ? 'bad' : 'leader' },
      width: strokeToken(env.theme, 'rule'),
      dash: dashToken(env.theme, 'reference'),
      owner,
      part: 'eventRule',
    });
    const nodeIds = rule.map((piece) => piece.id);
    pushAll(nodes, rule);
    claimRule(claims, band, domain, ex, 1.5, owner);

    const labelId = `event:${event.id}`;
    // Without annotation labels a badge would be an empty circle: the rule alone stays.
    if (event.badge) {
      if (drawsBadge) {
        const badgeId = `ann:event:${event.id}:badge`;
        badges.push({
          t: 'circle', id: badgeId, cx: ex, cy: badgeCy, r,
          fill: badgeFill(event),
          owner,
          part: 'eventBadge',
        });
        nodeIds.push(badgeId);
        claims.claim({ x: ex - r - 1, y: badgeCy - r - 1, w: 2 * (r + 1), h: 2 * (r + 1) }, 'annotation', owner);
        // A stacked badge's rule runs down past the lower level to the head; only a badge label may sit on it.
        if (badgeCy + r + 2 < headerTop) claims.claim({ x: ex - 1.5, y: badgeCy + r + 2, w: 3, h: headerTop - badgeCy - r - 2 }, 'annotation', owner, CROSSABLE_RULE_PART);
        const { strong } = env.fonts;
        const tsize = measure(event.label, strong);
        requests.push({
          id: labelId,
          kind: 'annotation', typeRole: 'label', role: 'note',
          owner,
          text: event.label,
          lines: [event.label],
          font: strong,
          priority: event.priority ?? PRIORITY.valueLine,
          candidates: [{ slot: 'badge', rect: { x: ex - tsize.width / 2, y: badgeCy - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0, overRules: true }],
        });
      }
    } else if (domain.eventBadgeMode) {
      const r = 7;
      const badgeCy = headerTop - markerLabelH / 2 - 2;
      const badgeId = `ann:event:${event.id}:badge`;
      nodes.push({
        t: 'circle',
        id: badgeId,
        cx: ex,
        cy: badgeCy,
        r,
        fill: { token: 'background' },
        stroke: { token: event.tone === 'bad' ? 'bad' : 'leader' }, strokeWidth: strokeToken(env.theme, 'mark'),
        owner,
        part: 'eventBadge',
      });
      nodeIds.push(badgeId);
      claims.claim({ x: ex - r - 1, y: badgeCy - r - 1, w: 2 * (r + 1), h: 2 * (r + 1) }, 'annotation', owner);
      if (labelOn('annotation')) {
        const text = String(badgeNo(event));
        const tsize = measure(text, tick);
        requests.push({
          id: labelId,
          kind: 'annotation', typeRole: 'axis', role: composedTextRole(text, 'note'),
          owner,
          text,
          lines: [text],
          font: tick,
          priority: event.priority ?? PRIORITY.valueLine,
          candidates: [
            { slot: 'badge', rect: { x: ex - tsize.width / 2, y: badgeCy - tick.size / 2, w: tsize.width, h: tick.size }, penalty: 0 },
          ],
        });
      }
    } else if (labelOn('annotation')) {
      const tsize = measure(event.label, tick);
      const top = headerTop - markerBand(domain, markerLabelH) + 2;
      const labelRowH = markerLabelH + 2;
      const candidates: SlotCandidate[] = [];
      for (const row of [0, 1]) {
        candidates.push(
          { slot: `right-${row}`, rect: { x: ex + 4, y: top + row * labelRowH, w: tsize.width, h: tick.size }, penalty: row },
          { slot: `left-${row}`, rect: { x: ex - 4 - tsize.width, y: top + row * labelRowH, w: tsize.width, h: tick.size }, penalty: row + 0.5 },
        );
      }
      requests.push({
        id: labelId,
        kind: 'annotation', typeRole: 'axis',
        owner,
        text: event.label,
        lines: [event.label],
        font: tick,
        priority: event.priority ?? PRIORITY.valueLine,
        candidates, role: 'note',
      });
    }
    layer.placed.push({
      id: event.id,
      kind: 'event',
      // The record says what the badge says: both count on from the
      // author's own notes, which the frame numbers first. A
      // record that kept its own count read as an authored override.
      computedText: domain.eventBadgeMode && !event.badge ? `${badgeNo(event)} — ${event.label}` : event.label,
      nodeIds,
      labelId: labelOn('annotation') ? labelId : undefined,
    });
  });
  pushAll(nodes, badges);
}

/** Phase 4: event rules, then the today line (dashed ink vertical, label on top), with claims and label requests. */
export function layoutGanttAnnotations(env: GanttEnv, domain: GanttDomain, band: GanttBand, body: GanttBody, headNames: readonly Rect[]): GanttAnnotationLayer {
  const layer: GanttAnnotationLayer = {
    nodes: [],
    claims: createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height }),
    requests: [],
    placed: [],
  };
  eventRules(env, domain, band, body, layer, headNames);
  const { todayDay } = domain;
  if (todayDay === null) return layer;
  const { strong } = env.fonts;
  const { headerTop, rowsBottom } = band;
  const tx = body.x(todayDay + 0.5);
  const rule = ruleNodes('ann:today:line', tx, headerTop, rowsBottom, headNames, {
    stroke: { token: 'ink' },
    width: strokeToken(env.theme, 'rule'),
    dash: dashToken(env.theme, 'reference'),
    owner: { annotationId: 'today' },
    part: 'todayLine',
  });
  pushAll(layer.nodes, rule);
  claimRule(layer.claims, band, domain, tx, 1, { annotationId: 'today' });
  // The date travels with the line: an exported chart keeps its snapshot date.
  const text = chartString(env.options, 'todayDate', { v1: fmtDay(env, todayDay) });
  const tsize = env.measure(text, strong);
  const ty = headerTop - strong.size - 3;
  const nearMinorBoundary = domain.minorStarts.some((boundary) => Math.abs(body.x(dayNum(boundary)) - tx) <= 6);
  const boundaryNudge = nearMinorBoundary ? 12 : 4;
  const leftCandidate: SlotCandidate = {
    slot: 'aboveLineLeft',
    rect: { x: tx - tsize.width - boundaryNudge, y: ty, w: tsize.width, h: strong.size },
    penalty: nearMinorBoundary ? 0 : 1,
    ...(nearMinorBoundary ? { leaderFrom: { x: tx, y: ty + strong.size } } : {}),
  };
  const rightCandidate: SlotCandidate = {
    slot: 'aboveLineRight',
    rect: { x: tx + boundaryNudge, y: ty, w: tsize.width, h: strong.size },
    penalty: nearMinorBoundary ? 0 : 2,
    ...(nearMinorBoundary ? { leaderFrom: { x: tx, y: ty + strong.size } } : {}),
  };
  const shiftedCandidates =
    tx + boundaryNudge + tsize.width <= body.plot.x + body.plot.w
      ? [rightCandidate, leftCandidate]
      : [leftCandidate, rightCandidate];
  if (env.labelOn('valueLine')) {
    layer.requests.push({
      id: 'valueLine:today',
      kind: 'valueLine', typeRole: 'label',
      role: composedTextRole(text),
      owner: { annotationId: 'today' },
      text,
      lines: [text],
      font: strong,
      priority: PRIORITY.valueLine,
      candidates: nearMinorBoundary
        ? shiftedCandidates
        : [
            { slot: 'aboveLine', rect: { x: tx - tsize.width / 2, y: ty, w: tsize.width, h: strong.size }, penalty: 0 },
            leftCandidate,
            rightCandidate,
          ],
    });
  }
  layer.placed.push({
    id: 'today',
    kind: 'valueLine',
    computedText: text,
    nodeIds: rule.map((piece) => piece.id),
    labelId: env.labelOn('valueLine') ? 'valueLine:today' : undefined,
  });
  return layer;
}
