import { fmtPathNumber as fmtN } from '../../curve';
import type { Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import { PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import { linePath } from '../../svgPath';
import { defaultMeasurer, type FontSpec } from '../../text';
import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { LintWarning, Paint, SceneNode } from '../../types/scene';
import { separatedWashPaint, emphasisWeight, strokeToken, dashToken } from '../../theme';
import type { Theme } from '../../types/theme';
import type { LineMarks } from './layout';
import type { GapFillTone, LineInterpolation, LineOptions } from './types';
import type { NormSer, NormTarget } from './context';
import { pushAll } from '../../arrays';
import { cutEdge, rangeIndexes, type LineRange } from './range';

type GapFillSpec = NonNullable<LineOptions['gapFill']>;
type GapFillMark = NonNullable<LineMarks['gapFills']>[number];
type TargetMark = NonNullable<LineMarks['targets']>[number];

interface GapPoint {
  ci: number;
  x: number;
  yA: number;
  yB: number;
}

interface GapRegion {
  sign: 'positive' | 'negative';
  points: GapPoint[];
}

export function resolveGapFillSeries(input: {
  gapFill: LineOptions['gapFill'];
  seriesById: Map<Id, NormSer>;
  warnings: LintWarning[];
}): [NormSer, NormSer] | null {
  const { gapFill, seriesById, warnings } = input;
  if (!gapFill) return null;
  const [aId, bId] = gapFill.between;
  const a = seriesById.get(aId);
  const b = seriesById.get(bId);
  for (const missingId of [a ? null : aId, b ? null : bId]) {
    if (missingId === null) continue;
    warnings.push({
      code: 'gapfill-unknown-series',
      severity: 'error',
      message: `gapFill names unknown series '${missingId}'`,
      owner: { seriesId: missingId },
    });
  }
  if (a && b && a.id !== b.id) return [a, b];
  if (a && b) {
    warnings.push({
      code: 'gapfill-unknown-series',
      severity: 'error',
      message: `gapFill requires two distinct series ids; received '${a.id}' twice`,
      owner: { seriesId: a.id },
    });
  }
  return null;
}

function resolveInterpolation(input: {
  gapFillSeries: [NormSer, NormSer];
  interpolationFor: (series: NormSer) => LineInterpolation;
  warnings: LintWarning[];
}): LineInterpolation | null {
  const { gapFillSeries, interpolationFor, warnings } = input;
  const a = interpolationFor(gapFillSeries[0]);
  const b = interpolationFor(gapFillSeries[1]);
  if (a !== b) {
    warnings.push({
      code: 'gapfill-interpolation-conflict',
      severity: 'warn',
      message: `gapFill boundaries use different interpolation (${a} vs ${b}) — fill suppressed rather than drawing a wash that follows neither curve`,
      suggest: 'give both boundary series the same smooth setting',
    });
    return null;
  }
  if (a === 'monotone') {
    warnings.push({
      code: 'gapfill-monotone-unsupported',
      severity: 'warn',
      message:
        'gapFill crossing partitions are linear/step exact but do not yet solve cubic intersections — fill suppressed while both monotone lines remain visible',
      suggest: "use interpolate:'linear' for this gapFill exhibit",
    });
    return null;
  }
  return a;
}

function collectGapRegions(input: {
  range?: LineRange;
  cats: Category[];
  seriesA: NormSer;
  seriesB: NormSer;
  rowA: (number | null)[];
  rowB: (number | null)[];
  interpolation: LineInterpolation;
  compositionInvalidAt: (ci: number) => boolean;
  xOf: (ci: number) => number;
  y: (value: number) => number;
}): GapRegion[] {
  const { cats, seriesA, seriesB, rowA, rowB, interpolation, compositionInvalidAt, xOf, y } = input;
  const regions: GapRegion[] = [];
  let active: GapRegion | null = null;
  const samePoint = (a: GapPoint, b: GapPoint): boolean => a.x === b.x && a.yA === b.yA && a.yB === b.yB;
  const appendPiece = (sign: GapRegion['sign'], start: GapPoint, end: GapPoint): void => {
    if (samePoint(start, end)) return;
    const tail = active?.points.at(-1);
    if (active?.sign === sign && tail?.x === start.x) {
      if (!samePoint(tail, start)) active.points.push(start);
      if (!samePoint(active.points.at(-1)!, end)) active.points.push(end);
      return;
    }
    active = { sign, points: [start, end] };
    regions.push(active);
  };
  const connectsAcross = (series: NormSer, fromCi: number, toCi: number): boolean =>
    (series.interpolateGaps && (!input.range || fromCi >= input.range.indexes[0]! && toCi <= input.range.indexes[input.range.indexes.length - 1]!))
    || (input.range?.values.get(series.id) ?? series.vals).slice(fromCi + 1, toCi).every(value => value.v !== null);
  let previousCi: number | null = null;
  for (const ci of input.range ? rangeIndexes(input.range) : cats.keys()) {
    if (compositionInvalidAt(ci)) {
      active = null;
      previousCi = null;
      continue;
    }
    const a1 = rowA[ci]!;
    const b1 = rowB[ci]!;
    if (a1 === null || b1 === null) continue;
    if (previousCi !== null) {
      const a0 = rowA[previousCi]!;
      const b0 = rowB[previousCi]!;
      const connected = a0 !== null && b0 !== null && connectsAcross(seriesA, previousCi, ci) && connectsAcross(seriesB, previousCi, ci);
      if (!connected) active = null;
      else if (interpolation === 'linear') {
        const start = { ci: previousCi, x: xOf(previousCi), yA: y(a0), yB: y(b0) };
        const end = { ci, x: xOf(ci), yA: y(a1), yB: y(b1) };
        const d0 = a0 - b0;
        const d1 = a1 - b1;
        if (d0 * d1 < 0) {
          const fraction = d0 / (d0 - d1);
          const crossingValue = a0 + (a1 - a0) * fraction;
          const crossing = { ci, x: start.x + (end.x - start.x) * fraction, yA: y(crossingValue), yB: y(crossingValue) };
          appendPiece(d0 > 0 ? 'positive' : 'negative', start, crossing);
          active = null;
          appendPiece(d1 > 0 ? 'positive' : 'negative', crossing, end);
        } else {
          const nonzero = d0 !== 0 ? d0 : d1;
          if (nonzero !== 0) appendPiece(nonzero > 0 ? 'positive' : 'negative', start, end);
          else active = null;
        }
      } else {
        const heldCi = interpolation === 'step-after' ? previousCi : ci;
        const heldA = rowA[heldCi]!;
        const heldB = rowB[heldCi]!;
        const diff = heldA! - heldB!;
        if (diff === 0) active = null;
        else appendPiece(diff > 0 ? 'positive' : 'negative', { ci: previousCi, x: xOf(previousCi), yA: y(heldA!), yB: y(heldB!) }, { ci, x: xOf(ci), yA: y(heldA!), yB: y(heldB!) });
      }
    }
    previousCi = ci;
  }
  return regions;
}

/**
 * The wash of a gap region and of its key entry. A signed tone takes its fill
 * role, which falls back to good / bad. The step toward the page is
 * `surface.gapTint` of the theme each scheme paints in: the light
 * step left a dark-page wash the eye barely finds.
 */
export function gapFillPaint(tone: GapFillTone): Paint {
  return separatedWashPaint(tone === 'good' ? 'goodFill' : tone === 'bad' ? 'badFill' : tone, 'surface-gap');
}

function addGapRegion(input: {
  region: GapRegion;
  regionIndex: number;
  seriesA: NormSer;
  seriesB: NormSer;
  gapFill: GapFillSpec;
  cats: Category[];
  occupied: OccupiedIndex;
  nodes: SceneNode[];
  marks: GapFillMark[];
}): void {
  const { region, regionIndex, seriesA, seriesB, gapFill, cats, occupied, nodes, marks } = input;
  if (region.points.length < 2) return;
  const upper = region.points.map((point) => ({ x: point.x, y: point.yA }));
  const lower = [...region.points].reverse().map((point) => ({ x: point.x, y: point.yB }));
  const tone: GapFillTone = region.sign === 'positive' ? gapFill.positiveTone ?? 'good' : gapFill.negativeTone ?? 'bad';
  const nodeId = `mark:gapfill:${seriesA.id}:${seriesB.id}:${regionIndex}`;
  nodes.push({
    t: 'path',
    id: nodeId,
    d: `${linePath(upper)}${lower.map((point) => `L${fmtN(point.x)} ${fmtN(point.y)}`).join('')}Z`,
    fill: gapFillPaint(tone),
    owner: {},
    part: 'gapFill',
  });
  for (let pointIndex = 0; pointIndex + 1 < region.points.length; pointIndex++) {
    const a = region.points[pointIndex]!;
    const b = region.points[pointIndex + 1]!;
    occupied.claim({
      x: Math.min(a.x, b.x),
      y: Math.min(a.yA, a.yB, b.yA, b.yB),
      w: Math.max(Math.abs(b.x - a.x), 1),
      h: Math.max(Math.max(a.yA, a.yB, b.yA, b.yB) - Math.min(a.yA, a.yB, b.yA, b.yB), 1),
    }, 'mark', {}, 'gapFill');
  }
  marks.push({
    nodeId,
    sign: region.sign,
    fromCategoryId: cats[region.points[0]!.ci]!.id,
    toCategoryId: cats[region.points.at(-1)!.ci]!.id,
  });
}

export function renderGapFill(input: {
  range?: LineRange;
  xOfValue?: (value: number) => number;
  gapFillSeries: [NormSer, NormSer] | null;
  gapFill: LineOptions['gapFill'];
  interpolationFor: (series: NormSer) => LineInterpolation;
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  cats: Category[];
  compositionInvalidAt: (ci: number) => boolean;
  xOf: (ci: number) => number;
  y: (value: number) => number;
  warnings: LintWarning[];
  occupied: OccupiedIndex;
  nodes: SceneNode[];
  marks: LineMarks;
  analyticalSceneStart: number;
}): void {
  const { gapFillSeries, gapFill, interpolationFor, pv, rowOf, cats, compositionInvalidAt, xOf, y, warnings, occupied, nodes, marks, analyticalSceneStart } = input;
  if (!gapFillSeries || !gapFill) return;
  const interpolation = resolveInterpolation({ gapFillSeries, interpolationFor, warnings });
  if (!interpolation) return;
  const [seriesA, seriesB] = gapFillSeries;
  const range = input.range;
  let regions = collectGapRegions({ cats, seriesA, seriesB, rowA: pv[rowOf.get(seriesA)!]!, rowB: pv[rowOf.get(seriesB)!]!, interpolation, compositionInvalidAt, xOf, y,
    ...(range && input.xOfValue ? { range, cats: range.categories, rowA: range.plotted[rowOf.get(seriesA)!]!, rowB: range.plotted[rowOf.get(seriesB)!]!,
      compositionInvalidAt: (ci: number) => range.invalid.has(ci), xOf: (ci: number) => input.xOfValue!(range.xs[ci]!) } : {}) });
  if (range && input.xOfValue) {
    const visible = new Map(range.indexes.map((source, ci) => [source, ci]));
    regions = regions.flatMap(region => {
      const clipped = ['yA', 'yB'].map(key => cutEdge({ points: region.points.map(p => ({ x: p.x, y: p[key as 'yA' | 'yB'], ci: visible.get(p.ci) ?? (p.ci < range.indexes[0]! ? 0 : cats.length - 1) })) },
        'linear', input.xOfValue!(range.lo), input.xOfValue!(range.hi)).points);
      return clipped[0]!.length < 2 ? [] : [{ sign: region.sign, points: clipped[0]!.map((p, i) => ({ ci: p.ci, x: p.x, yA: p.y, yB: clipped[1]![i]!.y })) }];
    });
  }
  const gapFillNodes: SceneNode[] = [];
  const gapFillMarks: GapFillMark[] = [];
  regions.forEach((region, regionIndex) => addGapRegion({ region, regionIndex, seriesA, seriesB, gapFill, cats, occupied, nodes: gapFillNodes, marks: gapFillMarks }));
  if (gapFillNodes.length === 0) {
    warnings.push({ code: 'gapfill-no-area', severity: 'info', message: `gapFill '${seriesA.id}' vs '${seriesB.id}' has no non-zero shared region` });
    return;
  }
  marks.gapFills = gapFillMarks;
  const analyticalNodes = nodes.splice(analyticalSceneStart);
  const areas = analyticalNodes.filter((node) => node.part === 'area');
  const baseline = analyticalNodes.filter((node) => node.part === 'baseline');
  const foreground = analyticalNodes.filter((node) => node.part !== 'area' && node.part !== 'baseline');
  pushAll(nodes, areas);
  pushAll(nodes, gapFillNodes);
  pushAll(nodes, baseline);
  pushAll(nodes, foreground);
}

function targetCandidates(cx: number, cy: number, measured: { width: number; height: number }): SlotCandidate[] {
  return [
    { slot: 'above', rect: { x: cx - measured.width / 2, y: cy - measured.height - 8, w: measured.width, h: measured.height }, penalty: 0 },
    { slot: 'below', rect: { x: cx - measured.width / 2, y: cy + 8, w: measured.width, h: measured.height }, penalty: 1 },
    { slot: 'right', rect: { x: cx + 9, y: cy - measured.height / 2, w: measured.width, h: measured.height }, penalty: 2 },
    { slot: 'left', rect: { x: cx - measured.width - 9, y: cy - measured.height / 2, w: measured.width, h: measured.height }, penalty: 3 },
    // The quadrants a dashed goal path leaves free where it runs through the goal.
    { slot: 'aboveRight', rect: { x: cx + 6, y: cy - measured.height - 6, w: measured.width, h: measured.height }, penalty: 4 },
    { slot: 'belowLeft', rect: { x: cx - measured.width - 6, y: cy + 6, w: measured.width, h: measured.height }, penalty: 5 },
    { slot: 'aboveLeft', rect: { x: cx - measured.width - 6, y: cy - measured.height - 6, w: measured.width, h: measured.height }, penalty: 6 },
    { slot: 'belowRight', rect: { x: cx + 6, y: cy + 6, w: measured.width, h: measured.height }, penalty: 7 },
  ];
}

/**
 * True when a name ends with the value as a whole number, after a space or at the start, followed
 * only by "%", ")" or a full stop: "EU target 70%" for 70. Every other place keeps the value line:
 * "2028 goal", "from -20", "20k", "Goal by 20/11/2026", "Q2 target" and "1 500" name another number.
 */
function namesValue(name: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A space after a digit groups one number ("1 500"): its last group is not the value.
  return new RegExp(`(^|(?<!\\d)\\s)${escaped}[%).]*$`, 'u').test(name.trim());
}

function addTarget(theme: Theme, input: {
  target: NormTarget;
  categoryOrder: Map<Id, number>;
  xOf: (ci: number) => number;
  y: (value: number) => number;
  nodes: SceneNode[];
  occupied: OccupiedIndex;
  fmt: (value: number) => string;
  labelFont: FontSpec;
  measure: typeof defaultMeasurer;
  labelRequests: LabelRequest[];
  plot: Rect;
  /** Right bound for a goal's name: the canvas, since the last goal stands on the plot's edge. */
  rightEdge?: number;
  targetLabelIds: Set<Id>;
  /** The goal's series draws a filled area. */
  areaSeries: boolean;
}): TargetMark {
  const { target, categoryOrder, xOf, y, nodes, occupied, fmt, labelFont, measure, labelRequests, plot, targetLabelIds } = input;
  const right = Math.max(plot.x + plot.w, input.rightEdge ?? 0);
  const cx = xOf(categoryOrder.get(target.at)!);
  const cy = y(target.value);
  nodes.push({ t: 'circle', id: target.id, cx, cy, r: 4.5, fill: { token: 'background' }, stroke: { token: 'markInk' }, strokeWidth: strokeToken(theme, 'mark'), owner: { seriesId: target.seriesId, categoryId: target.at, pointId: target.id }, part: 'targetMarker', display: { value: fmt(target.value) } });
  occupied.claim({ x: cx - 5, y: cy - 5, w: 10, h: 10 }, 'mark', { seriesId: target.seriesId, categoryId: target.at, pointId: target.id }, 'targetMarker');
  let labelId: Id | undefined;
  if (target.label) {
    labelId = `target-label:${target.id}`;
    targetLabelIds.add(labelId);
    const targetFont = { ...labelFont, weight: emphasisWeight(theme) };
    // A goal prints its value under its name; "2028 goal" alone would leave the 72 to the axis.
    // A name that already prints the value ("EU target 70%") does not print it twice.
    const value = fmt(target.value);
    const lines = namesValue(target.label, value) ? [target.label] : [target.label, value];
    const text = lines.join(' ');
    const measured = { width: Math.max(...lines.map((line) => measure(line, targetFont).width)), height: lines.length * measure(lines[0]!, targetFont).height };
    labelRequests.push({
      id: labelId,
      kind: 'annotation',
      owner: { seriesId: target.seriesId, categoryId: target.at, pointId: target.id },
      text,
      lines,
      align: 'middle',
      typeRole: 'label', font: targetFont,
      priority: PRIORITY.extreme,
      candidates: targetCandidates(cx, cy, measured).filter((candidate) =>
        candidate.rect.x >= plot.x && candidate.rect.y >= plot.y &&
        candidate.rect.x + candidate.rect.w <= right &&
        candidate.rect.y + candidate.rect.h <= plot.y + plot.h &&
        // The label shares its series' owner, so the solver would let it sit on that series' line
        // and point markers; a goal's name there hides the point it is compared with. An area's
        // fill claims the same way, and a label may sit on that fill, so an area keeps every seat.
        (input.areaSeries || !occupied.hits(candidate.rect, 0, (claim) => !(claim.kind === 'mark' && claim.part === undefined && claim.owner.seriesId === target.seriesId)))),
    });
  }
  return { seriesId: target.seriesId, categoryId: target.at, value: target.value, nodeId: target.id, ...(labelId ? { labelId } : {}) };
}

export function renderTargets(theme: Theme, input: {
  targets: NormTarget[];
  categoryOrder: Map<Id, number>;
  xOf: (ci: number) => number;
  y: (value: number) => number;
  nodes: SceneNode[];
  occupied: OccupiedIndex;
  fmt: (value: number) => string;
  labelFont: FontSpec;
  measure: typeof defaultMeasurer;
  labelRequests: LabelRequest[];
  plot: Rect;
  marks: LineMarks;
  rightEdge?: number;
}): Set<Id> {
  const targetLabelIds = new Set<Id>();
  if (input.targets.length === 0) return targetLabelIds;
  // Goals past a series' last point continue it as a dashed path, so
  // the reader sees the way from the forecast to 2028 and 2030.
  for (const seriesId of new Set(input.targets.map((target) => target.seriesId))) {
    const targets = input.targets.filter((target) => target.seriesId === seriesId);
    const last = input.marks.series.find((mark) => mark.seriesId === seriesId)?.points.at(-1);
    const lastIndex = last ? input.categoryOrder.get(last.categoryId) : undefined;
    if (!last || lastIndex === undefined) continue;
    const ahead = targets.filter((target) => input.categoryOrder.get(target.at)! > lastIndex)
      .sort((a, b) => input.categoryOrder.get(a.at)! - input.categoryOrder.get(b.at)!);
    if (ahead.length === 0) continue;
    const path = [{ x: last.x, y: last.y }, ...ahead.map((target) => ({ x: input.xOf(input.categoryOrder.get(target.at)!), y: input.y(target.value) }))];
    input.nodes.push({ t: 'path', id: `target-path:${seriesId}`, d: path.map((point, i) => `${i === 0 ? 'M' : 'L'}${fmtN(point.x)} ${fmtN(point.y)}`).join(''), stroke: { token: 'markInk' }, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference'), owner: { seriesId }, part: 'targetPath' });
    path.slice(1).forEach((point, i) => {
      const from = path[i]!;
      for (let k = 0; k < 8; k++) {
        const [x0, y0] = [from.x + (point.x - from.x) * k / 8, from.y + (point.y - from.y) * k / 8];
        const [x1, y1] = [from.x + (point.x - from.x) * (k + 1) / 8, from.y + (point.y - from.y) * (k + 1) / 8];
        // An empty owner: no label, the series' own goal names included, sits on the dashes.
        input.occupied.claim({ x: Math.min(x0, x1) - 1, y: Math.min(y0, y1) - 1, w: Math.abs(x1 - x0) + 2, h: Math.abs(y1 - y0) + 2 }, 'mark', {}, 'targetPath');
      }
    });
  }
  const targetMarks = input.targets.map((target) => addTarget(theme, { ...input, target, targetLabelIds, areaSeries: input.marks.series.some((mark) => mark.seriesId === target.seriesId && mark.areaNodeId !== undefined) }));
  input.marks.targets = targetMarks;
  return targetLabelIds;
}
