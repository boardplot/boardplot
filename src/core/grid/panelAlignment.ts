import { PLOT_FLOOR_RECT } from '../sizing';
import { canvasMargin, resolveTheme } from '../theme';
import type { Rect } from '../geometry';
import type { Geometry } from '../types/scene';
import { maxOf, minOf } from '../arrays';
import type { CategoryInset } from './categoryInset';

/**
 * Values the grid settles for a panel and its relayout reads: the category inset (only for a type that
 * reads it) and the left edge of its panel label. A panel without this holder moves its plot instead.
 */
export interface PanelAnchoring {
  categoryInset?: CategoryInset;
  captionLeft?: number;
}

interface GridPanelLayout {
  geometry: Geometry;
  slot: Rect;
  margin: { top?: number; right?: number; bottom?: number; left?: number };
  relayout?: (margin: GridPanelLayout['margin']) => Geometry;
  anchored?: PanelAnchoring;
}

/** The margin that moves a child's plot left edge by `dl` and its right edge in by `dr`. */
export function movedMargin(child: GridPanelLayout, dl: number, dr: number, theme: ReturnType<typeof resolveTheme>): GridPanelLayout['margin'] {
  const effectiveLeft =
    typeof (child.geometry.derived as { leftInset?: unknown }).leftInset === 'number'
      ? (child.geometry.derived as { leftInset: number }).leftInset
      : child.margin.left ?? canvasMargin(theme, child.slot.w).left;
  const effectiveRight =
    typeof (child.geometry.derived as { rightInset?: unknown }).rightInset === 'number'
      ? (child.geometry.derived as { rightInset: number }).rightInset
      : child.margin.right ?? canvasMargin(theme, child.slot.w).right;
  return { ...child.margin, left: effectiveLeft + dl, right: effectiveRight + dr };
}

/** Relayout a child with its plot's left edge moved by `dl` and its right edge in by `dr`. */
export function moveChildPlot(child: GridPanelLayout, dl: number, dr: number, theme: ReturnType<typeof resolveTheme>): void {
  child.margin = movedMargin(child, dl, dr, theme);
  child.geometry = child.relayout!(child.margin);
}

/**
 * Equal plot edges are not equal category centres: a type can inset its bands
 * inside the plot (combo over line sat 3.3 px apart). Each panel of an anchored
 * group places its first and last shared category on the innermost pair; the
 * tick share of the category range is read anew on each pass. A panel that reads
 * a category inset keeps its plot and moves its categories inside it, so stacked
 * axes stay on one line. Only a panel without one moves its plot.
 */
export function alignCategoryPanels(
  children: GridPanelLayout[],
  theme: ReturnType<typeof resolveTheme>,
): number {
  const before = new Map(children.map((child) => [child, [child.slot.x + child.geometry.plot.x, child.geometry.plot.w]] as const));
  // Category ticks carry the category id. Numeric ticks (a dot or scatter value axis) are no categories.
  const ticksOf = (child: GridPanelLayout) =>
    (child.geometry.axes.find((axis) => axis.axis === 'x')?.ticks ?? []).filter((tick) => typeof tick.at === 'string');
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
      const inset = child.anchored?.categoryInset;
      // The current category range: the plot less the inset already taken.
      const x0 = x + (inset?.left ?? 0);
      const w0 = w - (inset?.left ?? 0) - (inset?.right ?? 0);
      if (!(w0 > 0)) continue;
      const f = (posOf(child, firstId) - x0) / w0;
      const l = (posOf(child, lastId) - x0) / w0;
      if (!(l > f)) continue;
      const w2 = (last - first) / (l - f);
      const x2 = first - f * w2;
      if (inset) {
        // A new object on each pass: the layout memo keeps the JSON of an option object by identity.
        child.anchored!.categoryInset = { left: Math.max(0, x2 - x), right: Math.max(0, x + w - (x2 + w2)) };
        child.geometry = child.relayout!(child.margin);
        // Room the panel kept for its edge labels can change with the inset: its margin takes the change.
        const nx = child.slot.x + child.geometry.plot.x;
        const nr = nx + child.geometry.plot.w;
        if (Math.abs(nx - x) > 0.01 || Math.abs(nr - x - w) > 0.01) moveChildPlot(child, x - nx, nr - x - w, theme);
      } else moveChildPlot(child, x2 - x, x + w - (x2 + w2), theme);
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

/** The height floors a panel reports: the grid sums them into its own floor. */
type PanelFloors = { minHeight?: number; measuredMinHeight?: number; frameMinHeight?: number; plotMinHeight?: number };

const floorsOf = (geometry: Geometry): PanelFloors => ({
  minHeight: geometry.sizing?.minHeight, measuredMinHeight: geometry.sizing?.measuredMinHeight,
  frameMinHeight: geometry.frame.minHeight, plotMinHeight: geometry.frame.plotMinHeight,
});

/**
 * The margin that equalises a plot is slack the panel gives up, not chrome it needs: a shorter frame gives a
 * shorter cut. A panel keeps the floors it reported before the cut, so the grid's floor does not grow with the
 * frame. Taking the smaller value keeps this right when a cached layout returns the same geometry again.
 */
function keepFloors(geometry: Geometry, floors: PanelFloors): void {
  const lower = (current: number | undefined, before: number | undefined) =>
    current === undefined || before === undefined ? current : Math.min(current, before);
  if (geometry.sizing) {
    geometry.sizing.minHeight = lower(geometry.sizing.minHeight, floors.minHeight)!;
    geometry.sizing.measuredMinHeight = lower(geometry.sizing.measuredMinHeight, floors.measuredMinHeight)!;
  }
  geometry.frame.minHeight = lower(geometry.frame.minHeight, floors.frameMinHeight);
  geometry.frame.plotMinHeight = lower(geometry.frame.plotMinHeight, floors.plotMinHeight);
}

/**
 * Map one shared domain through equally tall data rectangles, keeping each panel's frame. Under a baseline
 * anchor a plot shrinks around its baseline, so the anchored baselines stay where they are.
 */
export function alignValuePanels<C extends GridPanelLayout>(children: C[], theme: ReturnType<typeof resolveTheme>, keep?: BaselineKeep<C>): void {
  const members = children.filter(child => child.relayout !== undefined);
  if (members.length < 2) return;
  const before = new Map<C, PanelFloors>();
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
      if (!before.has(child)) before.set(child, floorsOf(child.geometry));
      child.geometry = child.relayout!(child.margin);
    }
  }
  for (const [child, floors] of before) keepFloors(child.geometry, floors);
}
