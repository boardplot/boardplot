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

export function spliceAnnotationNodes(nodes: SceneNode[], annotationNodes: SceneNode[]): void {
  const behind = (part: string) => part === 'band' || part === 'attainment';
  const front = annotationNodes.filter((node) => behind(node.part));
  const rest = nodes.splice(0);
  pushAll(nodes, front);
  pushAll(nodes, rest);
  pushAll(nodes, annotationNodes.filter((node) => !behind(node.part)));
}

export function isCategoryAlongY(band: CategoryBand): band is { y: number; h: number } {
  return !('x' in band);
}

export function valueLineHasTargetExtras(ann: Annotation): boolean {
  if (ann.kind !== 'valueLine') return false;
  return ann.tolerance !== undefined || ann.attainment !== undefined;
}
