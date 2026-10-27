import { PLOT_FLOOR_RECT } from '../sizing';
import { canvasMargin, resolveTheme } from '../theme';
import type { Rect } from '../geometry';
import type { Geometry } from '../types/scene';
import { maxOf, minOf } from '../arrays';

interface GridPanelLayout {
  geometry: Geometry;
  slot: Rect;
  margin: { top?: number; right?: number; bottom?: number; left?: number };
  relayout?: (margin: GridPanelLayout['margin']) => Geometry;
}

/** Relayout a child with its plot's left edge moved by `dl` and its right edge in by `dr`. */
export function moveChildPlot(child: GridPanelLayout, dl: number, dr: number, theme: ReturnType<typeof resolveTheme>): void {
  const effectiveLeft =
    typeof (child.geometry.derived as { leftInset?: unknown }).leftInset === 'number'
      ? (child.geometry.derived as { leftInset: number }).leftInset
      : child.margin.left ?? canvasMargin(theme, child.slot.w).left;
  const effectiveRight =
    typeof (child.geometry.derived as { rightInset?: unknown }).rightInset === 'number'
      ? (child.geometry.derived as { rightInset: number }).rightInset
      : child.margin.right ?? canvasMargin(theme, child.slot.w).right;
  child.margin = { ...child.margin, left: effectiveLeft + dl, right: effectiveRight + dr };
  child.geometry = child.relayout!(child.margin);
}

/**
 * Equal plot edges are not equal category centres: a type can inset its bands
 * inside the plot (combo over line sat 3.3 px apart). Each panel of an anchored
 * group moves its plot so its first and last shared category land on the
 * innermost pair; the tick share of the plot is read anew on each pass.
 */
export function alignCategoryPanels(
  children: GridPanelLayout[],
  theme: ReturnType<typeof resolveTheme>,
): number {
  const before = new Map(children.map((child) => [child, [child.slot.x + child.geometry.plot.x, child.geometry.plot.w]] as const));
  const ticksOf = (child: GridPanelLayout) => child.geometry.axes.find((axis) => axis.axis === 'x')?.ticks ?? [];
  const candidates = children.filter((child) => child.relayout !== undefined && ticksOf(child).length >= 2);
  if (candidates.length < 2) return 0;
  const shared = ticksOf(candidates[0]!).map((tick) => tick.at)
    .filter((at) => candidates.every((child) => ticksOf(child).some((tick) => tick.at === at)));
  if (shared.length < 2) return 0;
  const [firstId, lastId] = [shared[0], shared.at(-1)];
  const posOf = (child: GridPanelLayout, at: unknown) => child.slot.x + ticksOf(child).find((tick) => tick.at === at)!.pos;
  for (let pass = 0; pass < 3; pass++) {
    const first = maxOf(candidates.map((child) => posOf(child, firstId)));
    const last = minOf(candidates.map((child) => posOf(child, lastId)));
    if (!(last > first)) break;
    const off = candidates.filter((child) => Math.abs(posOf(child, firstId) - first) > 0.01 || Math.abs(posOf(child, lastId) - last) > 0.01);
    if (off.length === 0) break;
    for (const child of off) {
      const x = child.slot.x + child.geometry.plot.x;
      const w = child.geometry.plot.w;
      const f = (posOf(child, firstId) - x) / w;
      const l = (posOf(child, lastId) - x) / w;
      if (!(l > f)) continue;
      const w2 = (last - first) / (l - f);
      const x2 = first - f * w2;
      moveChildPlot(child, x2 - x, x + w - (x2 + w2), theme);
    }
  }
  // The largest edge move, so the caller can say what the centres cost.
  return Math.max(0, maxOf(children.map((child) => {
    const [x, w] = before.get(child)!;
    const x2 = child.slot.x + child.geometry.plot.x;
    return Math.max(Math.abs(x2 - x), Math.abs(x2 + child.geometry.plot.w - x - w));
  })));
}

/** Under a baseline anchor: each panel's top margin, and the share of its plot above its baseline. */
export interface BaselineKeep<C extends GridPanelLayout> {
  top: (child: C) => number;
  above: (child: C) => number;
}

/**
 * Map one shared domain through equally tall data rectangles, keeping each panel's frame. Under a baseline
 * anchor a plot shrinks around its baseline, so the anchored baselines stay where they are.
 */
export function alignValuePanels<C extends GridPanelLayout>(children: C[], theme: ReturnType<typeof resolveTheme>, keep?: BaselineKeep<C>): void {
  const members = children.filter(child => child.relayout !== undefined);
  if (members.length < 2) return;
  const heightOf = (child: GridPanelLayout) =>
    ((child.geometry as Geometry & { [PLOT_FLOOR_RECT]?: Rect })[PLOT_FLOOR_RECT] ?? child.geometry.plot).h;
  for (let pass = 0; pass < 3; pass++) {
    const height = minOf(members.map(heightOf));
    const off = members.filter(child => heightOf(child) - height > 0.01);
    if (off.length === 0) break;
    for (const child of off) {
      const cut = heightOf(child) - height;
      const above = keep ? keep.above(child) : 0;
      const bottom = child.margin.bottom ?? canvasMargin(theme, child.slot.w).bottom;
      child.margin = { ...child.margin, bottom: bottom + cut * (1 - above), ...(keep ? { top: keep.top(child) + cut * above } : {}) };
      child.geometry = child.relayout!(child.margin);
    }
  }
}
