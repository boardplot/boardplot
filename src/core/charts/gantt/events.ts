import { chartString } from '../../strings/gantt';
import { strokeToken, dashToken } from '../../theme';
/**
 * Gantt phase 4: the annotations gantt draws itself. Labelled event
 * rules (a date or a stable schedule-item anchor; numbered badges above three
 * events) and the dashed 'today' line. Nodes and claims come back like phase
 * 2's, label requests like phase 3's; the solver takes them after the rows'.
 */

import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import type { Rect } from '../../geometry';
import type { OwnerRef } from '../../types/cell';
import type { PlacedAnnotation, SceneNode } from '../../types/scene';
import { dayNum } from './calendar';
import { fmtDay } from './marks';
import { laneTop, type GanttBand, type GanttBody, type GanttDomain, type GanttEnv } from './model';
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
 * so a row name or a status is never dropped for a rule.
 */
function claimRule(claims: OccupiedIndex, band: GanttBand, domain: GanttDomain, x: number, halfWidth: number, owner: OwnerRef): void {
  const { headerTop, rowsBottom } = band;
  if (!band.stacked) {
    claims.claim({ x: x - halfWidth, y: headerTop, w: 2 * halfWidth, h: rowsBottom - headerTop }, 'annotation', owner);
    return;
  }
  claims.claim({ x: x - halfWidth, y: headerTop, w: 2 * halfWidth, h: band.headerH }, 'annotation', owner);
  domain.rows.forEach((_, i) => claims.claim({ x: x - halfWidth, y: laneTop(band, domain.rows, i), w: 2 * halfWidth, h: band.rowHs[i]! }, 'annotation', owner));
}

/** Labelled event rules: a dashed vertical per event, then its numbered badge or its label. */
function eventRules(env: GanttEnv, domain: GanttDomain, band: GanttBand, body: GanttBody, layer: GanttAnnotationLayer, headNames: readonly Rect[]): void {
  const { headerTop, rowsBottom, markerLabelH } = band;
  const { labelOn, measure } = env;
  const { tick } = env.fonts;
  const { nodes, claims, requests } = layer;
  // Badge n is footnote n: the author's notes take the first numbers.
  const badgeNo = (i: number): number => i + 1 + authoredFootnoteCount(env.options);
  domain.events.forEach((event, i) => {
    const ex = body.x(event.day + 0.5);
    const owner: OwnerRef = { annotationId: event.id };
    const rule = ruleNodes(`ann:event:${event.id}:line`, ex, headerTop, rowsBottom, headNames, {
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
    if (domain.eventBadgeMode) {
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
        const text = String(badgeNo(i));
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
      const top = headerTop - band.markerStrip + 2;
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
      computedText: domain.eventBadgeMode ? `${badgeNo(i)} — ${event.label}` : event.label,
      nodeIds,
      labelId: labelOn('annotation') ? labelId : undefined,
    });
  });
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
