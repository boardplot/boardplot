import { boxGap, rectCenter, rectContains, type Rect } from '../../core/geometry';
import type { OwnerRef } from '../../core/types/cell';
import { targetId } from '../../core/a11y/recordsShared';
import { compareText } from '../../core/text';
import type { InteractionRecord, InteractionScope } from '../../core/a11y/types';

interface InteractionHit {
  scope: InteractionScope;
  owner?: OwnerRef;
  nodeId?: string;
  point?: { x: number; y: number };
  bounds?: Rect;
  band?: 'x' | 'y';
  /** Maximum distance for proximity hits. Exact owner and node hits need no radius. */
  radius?: number;
}

function inScope(record: InteractionRecord, scope: InteractionScope): boolean {
  return record.target.chart === scope.chart && record.target.panel === scope.panel;
}

function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return rectContains(rect, { ...point, w: 0, h: 0 });
}

function anchorDistance(anchor: InteractionRecord['anchor'], point: { x: number; y: number }): number {
  return anchor ? boxGap({ w: 0, h: 0, ...anchor }, { ...point, w: 0, h: 0 }) : Infinity;
}

function closest(records: readonly InteractionRecord[], point?: { x: number; y: number }): InteractionRecord | undefined {
  let best: InteractionRecord | undefined;
  let distance = Infinity;
  for (const record of records) {
    const next = point ? anchorDistance(record.anchor, point) : 0;
    if (!best || next < distance || (next === distance && compareText(record.id, best.id) < 0)) {
      best = record;
      distance = next;
    }
  }
  return best;
}

function bandRecords(
  records: readonly InteractionRecord[], hit: InteractionHit,
): InteractionRecord[] {
  if (!hit.band || !hit.point || !hit.bounds || !contains(hit.bounds, hit.point)) return [];
  const axis = hit.band;
  const centers = new Map<string, number[]>();
  for (const record of records) {
    const category = record.target.owner.categoryId;
    if (!category || !record.anchor) continue;
    const values = centers.get(category) ?? [];
    values.push(rectCenter({ w: 0, h: 0, ...record.anchor })[axis]);
    centers.set(category, values);
  }
  const ordered = [...centers].map(([category, values]) => ({
    category,
    center: values.reduce((sum, value) => sum + value, 0) / values.length,
  })).sort((left, right) => left.center - right.center || compareText(left.category, right.category));
  const coordinate = hit.point[axis];
  // The point is inside the plot. Passing the prior band's upper edge also
  // passes this band's lower edge; an exact midpoint belongs to the first.
  const selected = ordered.find((entry, index) => index === ordered.length - 1
    || coordinate <= (entry.center + ordered[index + 1]!.center) / 2);
  return selected ? records.filter(record => record.target.owner.categoryId === selected.category) : [];
}

/** Resolve one stable interaction record from semantic or geometric hit information. */
export function hitTestRecords(
  records: readonly InteractionRecord[], hit: InteractionHit,
): InteractionRecord | undefined {
  if (hit.radius !== undefined && (!Number.isFinite(hit.radius) || hit.radius < 0)) {
    throw new RangeError('hit radius must be a nonnegative finite number');
  }
  const scoped = records.filter(record => inScope(record, hit.scope));
  if (hit.owner) {
    const id = targetId({ ...hit.scope, owner: hit.owner });
    return scoped.find(record => record.id === id);
  }
  if (hit.nodeId) {
    return closest(scoped.filter(record => record.nodeIds.includes(hit.nodeId!)), hit.point);
  }
  if (!hit.point) return undefined;
  if (hit.bounds && !contains(hit.bounds, hit.point)) return undefined;
  const bands = bandRecords(scoped, hit);
  if (bands.length) return closest(bands, hit.point);
  const candidate = closest(scoped, hit.point);
  if (!candidate) return undefined;
  const distance = anchorDistance(candidate.anchor, hit.point);
  return distance === 0 || (hit.radius !== undefined && distance <= hit.radius) ? candidate : undefined;
}
