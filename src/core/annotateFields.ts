/**
 * The target fields a LAYOUT fills in before the annotation pass runs, and
 * the two small readers beside them.
 *
 * A module of its own for the same reason as `annotateParts`: code splitting
 * works on whole modules, so a layout reading `categoryTargetFields` out of
 * `annotateTargets` pinned the whole corridor-and-attainment engine into its
 * bundle. The dependency runs one way — `annotateTargets` imports from here,
 * never back.
 */

import type { Rect } from './geometry';
import type { Annotation } from './types/annotations';
import type { Id } from './types/cell';
import type { SceneNode } from './types/scene';
import type { TargetScaleInput } from './annotateTargets';
import { pushAll } from './arrays';

export type CategoryBand = { x: number; w: number } | { y: number; h: number };

export function categoryBandFromCenters(
  ids: Id[],
  plot: Rect,
  centerOf: (index: number) => number,
  axis: 'x' | 'y',
): (categoryId: Id) => CategoryBand | null {
  return (categoryId) => {
    const ci = ids.indexOf(categoryId);
    if (ci < 0) return null;
    if (axis === 'x') {
      const left = ci === 0 ? plot.x : (centerOf(ci - 1) + centerOf(ci)) / 2;
      const right = ci === ids.length - 1 ? plot.x + plot.w : (centerOf(ci) + centerOf(ci + 1)) / 2;
      return { x: left, w: right - left };
    }
    const top = ci === 0 ? plot.y : (centerOf(ci - 1) + centerOf(ci)) / 2;
    const bottom = ci === ids.length - 1 ? plot.y + plot.h : (centerOf(ci) + centerOf(ci + 1)) / 2;
    return { y: top, h: bottom - top };
  };
}

export function categoryTargetFields(
  ids: Id[],
  plot: Rect,
  centerOf: (index: number) => number,
  axis: 'x' | 'y',
): Pick<TargetScaleInput, 'categoryIds' | 'resolveCategoryBand' | 'bandPlot'> {
  return {
    categoryIds: ids,
    resolveCategoryBand: categoryBandFromCenters(ids, plot, centerOf, axis),
    bandPlot: plot,
  };
}

/**
 * Puts the band and attainment fills of the annotation pass behind the chart's marks, gridlines
 * and lines, and the other annotation nodes on top. `owners`, when given, limits the fills that
 * move behind to those annotations; the rest stay on top, as a chart that drew them there had them.
 */
export function spliceAnnotationNodes(nodes: SceneNode[], annotationNodes: SceneNode[], owners?: ReadonlySet<Id>): void {
  const behind = (node: SceneNode) => (node.part === 'band' || node.part === 'attainment')
    && (owners === undefined || owners.has(node.owner?.annotationId ?? ''));
  const front = annotationNodes.filter(behind);
  const rest = nodes.splice(0);
  pushAll(nodes, front);
  pushAll(nodes, rest);
  pushAll(nodes, annotationNodes.filter((node) => !behind(node)));
}

export function isCategoryAlongY(band: CategoryBand): band is { y: number; h: number } {
  return !('x' in band);
}

export function valueLineHasTargetExtras(ann: Annotation): boolean {
  if (ann.kind !== 'valueLine') return false;
  return ann.tolerance !== undefined || ann.attainment !== undefined;
}

/**
 * A valueLine that bar and dot leave to the shared annotate pass, as column
 * draws it: one with a category span, a series scope, a tolerance or an
 * attainment. The pass clips the band to the span, warns on a span it cannot
 * resolve and omits a scoped line it cannot honour. Their own vertical
 * drawing knows none of this, so it takes only the plain line.
 */
export function valueLineNeedsSharedPass(ann: Annotation): boolean {
  if (ann.kind !== 'valueLine') return false;
  return valueLineHasTargetExtras(ann) || ann.from !== undefined || ann.to !== undefined || ann.seriesId !== undefined;
}
