/**
 * Authored stage comparisons on the rows funnel.
 *
 * A diff arrow runs in the band the layout keeps under the last row. The
 * gap between two rows is the fallback, taken only while the arrow and both
 * of its drop lines miss every drawn text box. CAGR keeps the shared arm.
 *
 * Two diffs on the same stages resolve to the same two candidate lanes, so
 * the hook remembers which lanes already carry an arrow: the second diff
 * takes the next free one, and when none is left it is dropped with a
 * warning instead of falling through the shared arm's own cascade to the
 * midpoint, which is the caption's row.
 */

import type { AnchorResolution } from '../../annotate';
import { annotateEngine } from '../../annotatePass';
import type { ArmDrawPass } from '../../annotateArms';
import type { Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import type { AnnotationDerivation, OccupiedRect, SceneNode } from '../../types/scene';

/**
 * Text an arrow must not cross. A solved label is one spelling, and the rows
 * funnel's step captions are exactly that; a caption drawn as annotation
 * furniture is the other, tagged with its part.
 */
function isText(claim: OccupiedRect): boolean {
  return claim.kind === 'label' || claim.part === 'caption';
}

/** The three rects an arrow at `y` covers: its two drop lines and its shaft. */
function arrowRects(a: AnchorResolution, b: AnchorResolution, y: number): Rect[] {
  return [
    { x: a.x - 1, y: Math.min(a.y, y), w: 2, h: Math.abs(y - a.y) },
    { x: b.x - 1, y: Math.min(b.y, y), w: 2, h: Math.abs(y - b.y) },
    { x: Math.min(a.x, b.x), y: y - 3, w: Math.max(Math.abs(a.x - b.x), 1), h: 6 },
  ];
}

/** True when the arrow at `y` and its two drop lines cross no drawn text. */
function clearOfText(occupied: OccupiedIndex, a: AnchorResolution, b: AnchorResolution, y: number): boolean {
  return arrowRects(a, b, y).every((rect) => !occupied.hitsWhich(rect, 1).some(isText));
}

/** The strip the shaft occupies, the one drawHorizontalLevelDiff itself tests. */
function shaftStrip(a: AnchorResolution, b: AnchorResolution, y: number): Rect {
  return { x: Math.min(a.x, b.x), y: y - 3, w: Math.max(Math.abs(a.x - b.x), 1), h: 6 };
}

/**
 * The comparison hook of the annotation pass. `bandY` is the arrow height in
 * the band under the last row, absent when the layout keeps no band.
 */
export function funnelComparisonLayout(bandY: number | undefined) {
  /** Lane heights already carrying an arrow, so a second diff cannot reuse one. */
  const takenLanes: number[] = [];
  return {
    draw(
      pass: ArmDrawPass,
      a: AnchorResolution,
      b: AnchorResolution,
      text: string,
      id: string,
      kind: 'cagr' | 'diff',
      computed: string,
      derivation?: AnnotationDerivation,
    ): void {
      const shared: ArmDrawPass = { ...pass, input: { ...pass.input, comparisonLayout: undefined } };
      if (kind === 'cagr') {
        annotateEngine().drawCagrArm(shared, a, b, text, id, computed, derivation);
        return;
      }
      // The band the layout reserves for the arrow comes first: the gap
      // between the rows is sized for one line of conversion, not for an
      // arrow with its value above it.
      const lanes = [...(bandY === undefined ? [] : [bandY]), (a.y + b.y) / 2];
      const lane = lanes.find(
        (y) =>
          !takenLanes.some((taken) => Math.abs(taken - y) < 0.5) &&
          clearOfText(pass.input.occupied, a, b, y) &&
          !pass.input.occupied.hits(shaftStrip(a, b, y), 2),
      );
      if (lane === undefined) {
        pass.warn?.(
          'label-hidden',
          `diff '${id}': every lane between the two stages and under the last row is taken by another arrow or crosses a step caption, so the arrow was not drawn`,
        );
        return;
      }
      takenLanes.push(lane);
      const before = pass.nodes.length;
      annotateEngine().drawHorizontalLevelDiff({ ...shared, diffHeights: [lane] }, a, b, text, id, computed, derivation);
      // The shared arrow claims its shaft only; claim the drop lines too, so
      // no later label is placed across one.
      for (const node of pass.nodes.slice(before)) {
        if (node.t !== 'line' || node.part !== 'leader') continue;
        pass.input.occupied.claim(
          { x: node.x1 - 1, y: Math.min(node.y1, node.y2), w: 2, h: Math.abs(node.y2 - node.y1) },
          'annotation', { annotationId: id }, 'leader',
        );
      }
    },
    emit: (): SceneNode[] => [],
  };
}
