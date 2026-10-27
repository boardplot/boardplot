import { chartString } from '../../strings/scatter';
/**
 * Scatter phase 1, the 2x2 part: the cut points, the box each point
 * falls in, and every note and warning the cut points owe the reader. The
 * thresholds depend only on the plotted values, so they are known before the
 * frame — which is what lets the method note enter `footnotes` as a frame
 * participant instead of being appended as unreserved text afterwards.
 */

import type { Id } from '../../types/cell';
import type { QuadrantThreshold } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import {
  QUADRANT_BOXES,
  QUADRANT_BOX_NAME,
  quadrantBoxName,
  type Disclosed,
  type NormPt,
  type QuadrantBox,
  type QuadrantDerived,
  type QuadrantPlan,
  type ScatterEnv,
} from './model';

type CutSource = 'declared' | 'median' | 'mean';
type Cut = Disclosed & { source: CutSource };

/**
 * Conventional ("textbook", R type-7) median: sort the values ascending; odd n
 * takes the middle order statistic, even n the arithmetic mean of the two
 * central ones. Written down because an undeclared quantile method is exactly
 * the failure this product exists to prevent — a quartile-style interpolation
 * would put the cut point somewhere else and silently re-sort the portfolio.
 */
function quadrantMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Resolve one cut point, failing CLOSED on every degenerate case: a guessed
 * or invented threshold looks like analysis and is not. Returns null and
 * records an error-severity lint; the caller then derives no quadrants at all.
 */
function resolveCut(
  threshold: QuadrantThreshold,
  axis: 'x' | 'y',
  values: number[],
  warnings: LintWarning[],
): { value: number; source: CutSource } | null {
  const nonfinite = (value: unknown): void => {
    warnings.push({
      code: 'quadrant-threshold-nonfinite',
      severity: 'error',
      message: `the ${axis} quadrant cut point resolved to ${String(value)} — no dividers, no assignment and no claims were produced. A non-finite threshold cannot classify anything, and publishing a box count against it would be an invented number.`,
      suggest: `declare quadrants.${axis} as a finite number`,
    });
  };
  if (typeof threshold === 'number') {
    if (!Number.isFinite(threshold)) {
      nonfinite(threshold);
      return null;
    }
    return { value: threshold, source: 'declared' };
  }
  if (values.length < 3) {
    warnings.push({
      code: 'quadrant-stat-underpowered',
      severity: 'error',
      message: `quadrants.${axis} asks for the ${threshold.stat} of ${values.length} plotted point(s) — refused. A median of two points is the midpoint of the two: it reads as analysis and is not.`,
      suggest: `plot at least 3 points, or declare quadrants.${axis} as a number`,
    });
    return null;
  }
  const value =
    threshold.stat === 'median'
      ? quadrantMedian(values)
      : values.reduce((a, v) => a + v, 0) / values.length;
  if (!Number.isFinite(value)) {
    nonfinite(value);
    return null;
  }
  return { value, source: threshold.stat };
}

/** The two cut points, disclosed; null when either one was refused. */
function resolveCuts(pts: NormPt[], env: ScatterEnv, warnings: LintWarning[]): { x: Cut; y: Cut } | null {
  const qOpt = env.options.quadrants!;
  const rawX = resolveCut(qOpt.x, 'x', pts.map((p) => p.x), warnings);
  const rawY = resolveCut(qOpt.y, 'y', pts.map((p) => p.y), warnings);
  // The disclosure runs BEFORE classification, and classification reads its
  // `.value`. Every later mention of a cut point reads its `.text`.
  const cutX = rawX ? { ...rawX, ...env.discloseCut(rawX.value, 'x') } : undefined;
  const cutY = rawY ? { ...rawY, ...env.discloseCut(rawY.value, 'y') } : undefined;
  for (const [axis, raw, disclosed] of [
    ['horizontal', rawX, cutX],
    ['vertical', rawY, cutY],
  ] as const) {
    if (!raw || !disclosed || disclosed.exact) continue;
    warnings.push({
      code: 'quadrant-threshold-unprintable',
      severity: 'warn',
      message:
        `the ${axis} cut point cannot be printed exactly at any decimal count, so it was applied at the value the exhibit prints (${disclosed.text}) rather than at ${String(raw.value)} — ` +
        'classifying at a number no reader can see would file points against a boundary the exhibit does not state.',
      suggest: `declare the ${axis} cut point at a magnitude the chart format can print`,
    });
  }
  return cutX && cutY ? { x: cutX, y: cutY } : null;
}

/**
 * Boundary rule — half-open, upper-right inclusive: a point is on the right
 * when x >= cut, on the top when y >= cut. Stated in a footnote because
 * "exactly at 1.0x share" is a contested case in a real portfolio review and
 * must be visible, not absorbed.
 */
function classifyQuadrants(pts: NormPt[], cutX: Cut, cutY: Cut): { derived: QuadrantDerived; onThreshold: NormPt[] } {
  const counts: Record<QuadrantBox, number> = { tl: 0, tr: 0, bl: 0, br: 0 };
  const assignment: Record<Id, QuadrantBox> = {};
  const onThreshold: NormPt[] = [];
  for (const p of pts) {
    const right = p.x >= cutX.value;
    const top = p.y >= cutY.value;
    const box: QuadrantBox = top ? (right ? 'tr' : 'tl') : right ? 'br' : 'bl';
    assignment[p.id] = box;
    counts[box] += 1;
    if (p.x === cutX.value || p.y === cutY.value) onThreshold.push(p);
  }
  const derived: QuadrantDerived = {
    x: cutX.value,
    y: cutY.value,
    xText: cutX.text,
    yText: cutY.text,
    xSource: cutX.source,
    ySource: cutY.source,
    counts,
    assignment,
  };
  return { derived, onThreshold };
}

/** What the cut points are, where they came from, and what the shading and bubbles mean. */
function quadrantMethodNotes(
  cutX: Cut,
  cutY: Cut,
  pointCount: number,
  bubbleMode: boolean,
  env: ScatterEnv,
  notes: string[],
  warnings: LintWarning[],
): void {
  const provenance = (source: CutSource): string =>
    source === 'declared' ? chartString(env.options, 'declaredLower') : chartString(env.options, 'cutProvenance', { v1: source, v2: pointCount });
  // With authored short axis names and two
  // declared cuts, one short line says where the cuts are and the tie rule.
  const names = env.options.quadrants?.axisNames;
  if (names?.x && names.y && cutX.source === 'declared' && cutY.source === 'declared') {
    notes.push(chartString(env.options, 'quadrantCutShort', { v1: names.x, v2: cutX.text, v3: names.y, v4: cutY.text }));
  } else {
    notes.push(
      chartString(env.options, 'quadrantCutX', { v1: cutX.text, v2: provenance(cutX.source) }) +
        chartString(env.options, 'quadrantCutY', { v1: cutY.text, v2: provenance(cutY.source) }) +
        chartString(env.options, 'quadrantEquality'),
    );
  }


  if (bubbleMode && (cutX.source !== 'declared' || cutY.source !== 'declared')) {
    notes.push(chartString(env.options, 'quadrantWeights'));
    warnings.push({
      code: 'quadrant-stat-unweighted',
      severity: 'info',
      message:
        'points carry a size channel, but the computed cut point weights every unit equally — with a size channel present an unweighted statistic is a choice, not a default. ' +
        'No size-weighted statistic is offered: a weighted median needs declared weight semantics and there is no honest default.',
      suggest: 'declare the cut point as a number if a size-weighted threshold is intended',
    });
  }
}

/** A cut point on or beyond a domain edge draws no divider: the exhibit is a 1x2, and says so. */
function quadrantsOffDomain(
  cuts: { x: Cut; y: Cut },
  plan: QuadrantPlan,
  dx: [number, number],
  dy: [number, number],
  env: ScatterEnv,
  warnings: LintWarning[],
): Set<QuadrantBox> {
  const voided = new Set<QuadrantBox>();
  for (const [axis, key, cut, cutLabel, isDrawn, lo, hi] of [
    ['horizontal', 'x', cuts.x.value, cuts.x.text, plan.drawX, dx[0], dx[1]],
    ['vertical', 'y', cuts.y.value, cuts.y.text, plan.drawY, dy[0], dy[1]],
  ] as const) {
    if (isDrawn) continue;
    // The domain bounds are spelled through the same lossless disclosure
    // as the cut point: this sentence asks the reader to compare the two,
    // and a rounded bound could put the cut on the wrong side of the range
    // it is being compared against.
    const loLabel = env.discloseCut(lo, key).text;
    const hiLabel = env.discloseCut(hi, key).text;
    warnings.push({
      code: 'quadrant-divider-outside-domain',
      severity: 'warn',
      message:
        `the ${axis} cut point ${cutLabel} does not fall strictly inside the plotted domain ${loLabel} to ${hiLabel} — no divider is drawn on that axis, ` +
        'so the exhibit is a 1x2, not a 2x2: every plotted unit sits on one side of that cut point.',
      suggest: `move the ${axis} cut point strictly inside the plotted range, or drop it`,
    });
    plan.notes.push(
      chartString(env.options, 'quadrantOutsideRange', { v1: axis, v2: cutLabel, v3: loLabel, v4: hiLabel }),
    );
    const boxes: QuadrantBox[] =
      axis === 'horizontal'
        ? cut > hi
          ? ['tr', 'br']
          : ['tl', 'bl']
        : cut > hi
          ? ['tl', 'tr']
          : ['bl', 'br'];
    boxes.forEach((box) => voided.add(box));
  }
  return voided;
}

/** Ties on a cut point, hidden axes and a one-box result: each is a finding the reader must see. */
function quadrantEdgeCases(
  derived: QuadrantDerived,
  onThreshold: NormPt[],
  pts: NormPt[],
  env: ScatterEnv,
  notes: string[],
  warnings: LintWarning[],
): void {
  if (onThreshold.length > 0) {
    const named = onThreshold.slice(0, 3).map((p) => p.label).join(', ');
    const rest = onThreshold.length - Math.min(3, onThreshold.length);
    const list = rest > 0 ? chartString(env.options, 'andMore', { v1: named, v2: rest }) : named;
    warnings.push({
      code: 'quadrant-on-threshold',
      severity: 'info',
      message: `${onThreshold.length} point(s) sit exactly on a cut point (${onThreshold.map((p) => p.id).join(', ')}) — the half-open rule counts them to the right and above; a different tie rule would move them`,
    });
    notes.push(chartString(env.options, 'quadrantOnThreshold', { v1: onThreshold.length === 1 ? chartString(env.options, 'oneUnitSits') : chartString(env.options, 'unitsSit', { v1: onThreshold.length }), v2: list }));
  }

  if (env.va.show === false) {
    // Where the axes START decides how big each box LOOKS. With the value
    // axes hidden the reader can still read the cut points off the tags,
    // but cannot check any unit's distance from them — the box a unit
    // sits in becomes an assertion instead of something visible.
    warnings.push({
      code: 'quadrant-axes-hidden',
      severity: 'warn',
      message:
        'valueAxis.show is false while quadrants are drawn: the cut points are tagged, but without ticks a reader cannot check where either axis starts, so the box sizes and every unit position become unverifiable',
      suggest: 'show the value axes (the scatter default) whenever quadrants are on',
    });
  }

  const soleBox = QUADRANT_BOXES.find((box) => derived.counts[box] === pts.length);
  if (soleBox) {
    warnings.push({
      code: 'quadrant-degenerate',
      severity: 'info',
      message: `all ${pts.length} plotted points fall in the ${QUADRANT_BOX_NAME[soleBox]} box; the other three are empty — an empty-box result is a finding, not a rendering fault`,
    });
    notes.push(chartString(env.options, 'quadrantAllUnits', { v1: pts.length, v2: quadrantBoxName(soleBox, env.options) }));
  }
}

/** Refusals that leave the exhibit without quadrants: a missing cut point or a reversed axis. */
function quadrantRefusal(env: ScatterEnv): LintWarning | undefined {
  const qOpt = env.options.quadrants!;
  const missing = [...(qOpt.x === undefined ? ['x'] : []), ...(qOpt.y === undefined ? ['y'] : [])];
  if (missing.length > 0) {
    return {
      code: 'quadrant-threshold-undeclared',
      severity: 'error',
      message:
        `options.quadrants is missing ${missing.join(' and ')} — no quadrants were derived. ` +
        'Where the dividing lines go decides which unit is a star and which is a dog, so a guessed cut point silently re-sorts the whole portfolio; the engine refuses to guess one.',
      suggest: missing
        .map(
          (axis) =>
            `declare quadrants.${axis} as a number (e.g. { ${axis}: 1 }) or as a statistic over the plotted points (e.g. { ${axis}: { stat: 'median' } }, also { stat: 'mean' })`,
        )
        .join('; '),
    };
  }
  if (env.va.reverse) {
    return {
      code: 'quadrant-scale-unsupported',
      severity: 'error',
      message:
        'options.quadrants supports non-reversed axes only; valueAxis.reverse was requested — no quadrants were derived. ' +
        'Quadrant MEMBERSHIP is scale-invariant: reversing an axis cannot move a point across a cut point, so the answer would not change — only the geometry would, and the boxes would swap sides.',
      suggest: 'remove valueAxis.reverse, or drop options.quadrants',
    };
  }
  return undefined;
}

/** Phase 1, 2x2 part: the cut points over the plotted points and domains. */
export function deriveQuadrants(
  pts: NormPt[],
  bubbleMode: boolean,
  dx: [number, number],
  dy: [number, number],
  env: ScatterEnv,
  warnings: LintWarning[],
): QuadrantPlan {
  const plan: QuadrantPlan = { notes: [], voidBoxes: new Set(), drawX: false, drawY: false };
  if (!env.options.quadrants) return plan;
  const refusal = quadrantRefusal(env);
  if (refusal) {
    warnings.push(refusal);
    return plan;
  }
  const cuts = resolveCuts(pts, env, warnings);
  if (!cuts) return plan;
  const { derived, onThreshold } = classifyQuadrants(pts, cuts.x, cuts.y);
  plan.derived = derived;
  // STRICTLY inside: a cut point sitting exactly on a domain edge paints
  // a line the reader cannot tell from the plot frame, and leaves no unit
  // on one of its sides. That is a 1x2 too, and it is reported as one.
  plan.drawX = cuts.x.value > dx[0] && cuts.x.value < dx[1];
  plan.drawY = cuts.y.value > dy[0] && cuts.y.value < dy[1];
  quadrantMethodNotes(cuts.x, cuts.y, pts.length, bubbleMode, env, plan.notes, warnings);
  plan.voidBoxes = quadrantsOffDomain(cuts, plan, dx, dy, env, warnings);
  quadrantEdgeCases(derived, onThreshold, pts, env, plan.notes, warnings);
  return plan;
}
