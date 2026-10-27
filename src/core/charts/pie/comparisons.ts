import { emphasisWeight, strokeToken } from '../../theme';
import type { Theme } from '../../types/theme';
/**
 * Pie and doughnut comparisons. A CAGR or difference between
 * two slices is an arc just outside the ring from one slice to the other,
 * with a tick into each slice and the arrowhead on the `to` slice. It takes
 * the way round that passes fewer other slices, and its label sits outside
 * the arc, never in the hole beside the centre total.
 */

import type { AnchorResolution } from '../../annotate';
import type { ArmDrawPass } from '../../annotateArms';
import type { ComparisonLayout } from '../../annotateLinks';
import type { Rect } from '../../geometry';
import { PRIORITY, type SlotCandidate } from '../../label/solver';
import { arrowHeadPath, arrowShaftEnd } from '../../svgPath';
import { computedTextRole } from '../../textRole';
import type { Id } from '../../types/cell';
import type { AnnotationDerivation, PlacedAnnotation, PlacedLabel, SceneNode } from '../../types/scene';

/** Arc distance outside the ring, tick inset into a slice (degrees), label gap, stroke and arrow. */
const ARC_GAP = 8;
const END_INSET_DEG = 30;
const LABEL_GAP = 4;
const ARC_ARROW = 5;

/** The room a pie keeps round its ring for a comparison arc and its label. */
export function pieComparisonRoom(labelHeight: number): number {
  return ARC_GAP + LABEL_GAP + labelHeight + 2;
}

interface PieSliceArc {
  id: Id;
  a0: number;
  sweep: number;
  mid: number;
  /** The slice's own centre, moved when it is exploded. */
  scx: number;
  scy: number;
}

interface ArcPlan {
  annotation: PlacedAnnotation;
  d: string;
  head: string;
}

const norm = (deg: number): number => ((deg % 360) + 360) % 360;
const polar = (cx: number, cy: number, radius: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
};
const f = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * `ring`: the pie centre, the ring's radius and the outer radius any
 * exploded slice reaches; the arc runs outside the latter.
 */
export function pieComparisonLayout(theme: Theme, ring: { cx: number; cy: number; r: number; outer: number }, slices: PieSliceArc[]): ComparisonLayout {
  const plans: ArcPlan[] = [];
  const draw = (
    pass: ArmDrawPass, a: AnchorResolution, b: AnchorResolution, text: string,
    id: string, kind: 'cagr' | 'diff', computed: string, derivation?: AnnotationDerivation,
  ): void => {
    const from = slices.find((s) => s.id === a.owner.categoryId);
    const to = slices.find((s) => s.id === b.owner.categoryId);
    if (!from || !to || from === to) {
      pass.warn?.('bad-anchor', `${kind} '${id}': a pie comparison needs two different slices`);
      return;
    }
    // The way round that passes fewer other slices; the shorter one on a tie.
    const cw = norm(to.mid - from.mid);
    const between = (dir: 1 | -1) => slices.filter((s) => {
      if (s === from || s === to) return false;
      const t = norm(dir * (s.mid - from.mid));
      return t > 0 && t < (dir === 1 ? cw : 360 - cw);
    }).length;
    const dir: 1 | -1 = between(1) < between(-1) || (between(1) === between(-1) && cw <= 180) ? 1 : -1;
    // Each end sits well inside its slice, off the slice's own label leader,
    // which leaves the rim at mid-angle and runs level toward its label.
    const startDeg = from.mid + dir * Math.min(END_INSET_DEG, from.sweep / 3);
    const endDeg = to.mid - dir * Math.min(END_INSET_DEG, to.sweep / 3);
    const span = norm(dir * (endDeg - startDeg));
    const R = ring.outer + ARC_GAP;
    const at = (t: number) => startDeg + dir * span * t;
    const p0 = polar(ring.cx, ring.cy, R, startDeg);
    const p1 = polar(ring.cx, ring.cy, R, endDeg);
    const rim0 = polar(from.scx, from.scy, ring.r + 2, startDeg);
    const tip = polar(to.scx, to.scy, ring.r + 2, endDeg);
    const inward = Math.atan2(tip.y - p1.y, tip.x - p1.x);
    const shaft = arrowShaftEnd(ARC_ARROW, strokeToken(theme, 'rule'));
    const shaftEnd = { x: tip.x - Math.cos(inward) * shaft, y: tip.y - Math.sin(inward) * shaft };
    const d = `M${f(rim0.x)} ${f(rim0.y)}L${f(p0.x)} ${f(p0.y)}` +
      `A${f(R)} ${f(R)} 0 ${span > 180 ? 1 : 0} ${dir === 1 ? 1 : 0} ${f(p1.x)} ${f(p1.y)}` +
      `L${f(shaftEnd.x)} ${f(shaftEnd.y)}`;

    const { input } = pass;
    const font = { family: input.theme.type.family, ...input.theme.type.label, weight: emphasisWeight(input.theme) };
    const size = input.measure(text, font);
    // The label sits outside the arc at its middle, or a third of the way from either end.
    const candidates: SlotCandidate[] = [0.5, 0.33, 0.67].map((t, index) => {
      const deg = at(t);
      const p = polar(ring.cx, ring.cy, R + LABEL_GAP, deg);
      const rad = (deg * Math.PI) / 180;
      const rect: Rect = {
        x: p.x + (Math.sin(rad) - 1) * (size.width / 2),
        y: p.y - (Math.cos(rad) + 1) * (size.height / 2),
        w: size.width, h: size.height,
      };
      return { slot: `arc-${index}`, rect, penalty: index };
    });
    pass.labelRequests.push({
      id: `annotation:${id}`, kind: 'annotation', role: computedTextRole(text, computed), owner: { annotationId: id },
      text, lines: [text], font, priority: pass.priority ?? PRIORITY.valueLine, candidates,
    });
    const annotation: PlacedAnnotation = { id, kind, computedText: computed, nodeIds: [], labelId: `annotation:${id}`, ...(derivation ? { derivation } : {}) };
    pass.placed.push(annotation);
    // Claim the arc in short pieces, so a later label is not laid across it.
    for (let t = 0; t <= 1; t += 0.125) {
      const p = polar(ring.cx, ring.cy, R, at(t));
      input.occupied.claim({ x: p.x - 3, y: p.y - 3, w: 6, h: 6 }, 'annotation', { annotationId: id }, 'arc');
    }
    plans.push({ annotation, d, head: arrowHeadPath(tip, inward, ARC_ARROW) });
  };
  return {
    draw,
    emit(labels: PlacedLabel[]): SceneNode[] {
      const nodes: SceneNode[] = [];
      for (const { annotation, d, head } of plans) {
        const label = labels.find((l) => l.id === annotation.labelId);
        if (!label || label.hidden) continue;
        const owner = { annotationId: annotation.id };
        const pathId = `ann:${annotation.id}:bracket`;
        const headId = `ann:${annotation.id}:comparisonHead`;
        nodes.push(
          { t: 'path', id: pathId, d, stroke: { token: 'ink' }, width: strokeToken(theme, 'rule'), owner, part: 'bracket' },
          { t: 'path', id: headId, d: head, fill: { token: 'ink' }, owner, part: 'arrowHead' },
        );
        annotation.nodeIds.push(pathId, headId);
      }
      return nodes;
    },
  };
}
