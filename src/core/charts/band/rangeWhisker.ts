/**
 * Range whisker of a bar or a column: rail, low and high caps, optional mid
 * tick, split with a break glyph when the rail crosses a straight axis break.
 * The rail runs along the value axis: x for a bar, y for a column. Pure:
 * returns the nodes, the claims and the mark record; the layout decides where
 * they go.
 */
import { straightBreakGlyph } from '../../axis';
import type { Rect } from '../../geometry';
import type { RangeMark } from '../../range';
import { crossesLinearBreak, type LinearBreak, type LinearScale } from '../../scale';
import { strokeToken } from '../../theme';
import type { DataRange, Id, OwnerRef } from '../../types/cell';
import type { SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';

interface RangeWhiskerInput {
  seriesId: Id;
  categoryId: Id;
  /** The value axis: 'x' for a bar, 'y' for a column. */
  axis: 'x' | 'y';
  /** The mark's centre across the value axis. */
  center: number;
  /** The mark's size across the value axis. */
  markSize: number;
  range: DataRange;
  offset?: number;
  scale: LinearScale;
  activeBreak: LinearBreak | null | undefined;
  fmt: (value: number) => string;
}

interface RangeWhiskerClaim {
  rect: Rect;
  kind: 'axis' | 'mark';
  owner: OwnerRef;
  part: string;
}

interface RangeWhiskerResult {
  nodes: SceneNode[];
  claims: RangeWhiskerClaim[];
  mark: RangeMark;
}

export function rangeWhisker(theme: Theme, input: RangeWhiskerInput): RangeWhiskerResult {
  const { seriesId, categoryId, axis, center, markSize, range, scale, activeBreak, fmt } = input;
  const offset = input.offset ?? 0;
  const nodes: SceneNode[] = [];
  const claims: RangeWhiskerClaim[] = [];
  const lowValue = offset + range.low;
  const highValue = offset + range.high;
  const low = scale(lowValue);
  const high = scale(highValue);
  const capHalf = Math.max(2, Math.min(5, markSize * 0.34));
  const owner = { seriesId, categoryId };
  const railId = `range:${seriesId}:${categoryId}:rail`;
  const lowId = `range:${seriesId}:${categoryId}:low`;
  const highId = `range:${seriesId}:${categoryId}:high`;
  const nodeIds = [railId, lowId, highId];
  /** A rail segment from value pixel `a` to `b`. */
  const rail = (id: string, a: number, b: number): SceneNode => ({
    t: 'line', id,
    ...(axis === 'x' ? { x1: a, y1: center, x2: b, y2: center } : { x1: center, y1: a, x2: center, y2: b }),
    stroke: { token: 'markInk' }, width: strokeToken(theme, 'rule'), owner, part: 'rangeRail',
  });
  /** A cap (or mid tick) across the rail at value pixel `at`, carrying the value it marks. */
  const cap = (id: string, at: number, part: 'rangeCap' | 'rangeMid', width: number, value: number): SceneNode => ({
    t: 'line', id,
    ...(axis === 'x' ? { x1: at, y1: center - capHalf, x2: at, y2: center + capHalf } : { x1: center - capHalf, y1: at, x2: center + capHalf, y2: at }),
    stroke: { token: 'markInk' }, width, owner, part,
    display: { value: fmt(value) },
  });
  if (activeBreak && scale.break && crossesLinearBreak(lowValue, highValue, activeBreak)) {
    const position = scale.break.position;
    // The value grows toward larger x but toward smaller y.
    const gap = axis === 'x' ? -2 : 2;
    const beyondId = `${railId}:beyondBreak`;
    const glyph = straightBreakGlyph(theme, axis === 'x' ? { x: position, y: center } : { x: center, y: position }, `${railId}:break`, owner, { token: 'axis' }, 'rangeBreak');
    nodes.push(rail(railId, low, position + gap), rail(beyondId, position - gap, high), ...glyph.nodes);
    nodeIds.push(beyondId, ...glyph.nodeIds);
    claims.push({ rect: glyph.rect, kind: 'axis', owner, part: 'rangeBreak' });
  } else {
    nodes.push(rail(railId, low, high));
  }
  nodes.push(
    cap(lowId, low, 'rangeCap', strokeToken(theme, 'rule'), lowValue),
    cap(highId, high, 'rangeCap', strokeToken(theme, 'rule'), highValue),
  );
  if (range.mid !== undefined) {
    const midId = `range:${seriesId}:${categoryId}:mid`;
    nodes.push(cap(midId, scale(offset + range.mid), 'rangeMid', strokeToken(theme, 'mark'), offset + range.mid));
    nodeIds.push(midId);
  }
  const along = { start: Math.min(low, high) - 1, size: Math.max(Math.abs(high - low) + 2, 2) };
  const across = { start: center - capHalf - 1, size: capHalf * 2 + 2 };
  claims.push({
    rect: axis === 'x'
      ? { x: along.start, y: across.start, w: along.size, h: across.size }
      : { x: across.start, y: along.start, w: across.size, h: along.size },
    kind: 'mark',
    owner: { seriesId: `__range:${seriesId}`, categoryId },
    part: 'range',
  });
  return {
    nodes,
    claims,
    mark: {
      seriesId,
      categoryId,
      low: lowValue,
      high: highValue,
      ...(range.mid === undefined ? {} : { mid: offset + range.mid }),
      nodeIds,
    },
  };
}
