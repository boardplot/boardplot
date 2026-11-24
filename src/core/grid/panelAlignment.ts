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
  /** The panel draws categories without taking the inset (a sparkline, bar or dot panel): its grid column draws as before. */
  holdsCategories?: boolean;
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

/** The texts a panel prints, per role (value label, end label, category name, tick, legend entry). */
function printedTexts(geometry: Geometry): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of geometry.scene) {
    if (node.t !== 'text' || node.opacity === 0) continue;
    const role = node.part ?? '';
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return counts;
}

/** No role prints fewer texts than before: a value that moves from its mark to the legend is lost at the mark. */
const keepsTexts = (before: Map<string, number>, after: Map<string, number>) =>
  [...before].every(([role, count]) => (after.get(role) ?? 0) >= count);

/**
 * Equal plot edges are not equal category centres: a type can inset its bands
 * inside the plot (combo over line sat 3.3 px apart). Each panel of an anchored
 * group places its first and last shared category on the innermost pair; the
 * tick share of the category range is read anew on each pass.
 *
 * A group whose panels all read a category inset keeps one plot rectangle: each
 * panel moves its categories inside its plot, and a panel wider than the group's
 * shared plot follows it. The group falls back to the older drawing when a panel
 * takes no inset (a rank line, an area, a waterfall), when the inner categories
 * of the panels are spaced differently, when the edges do not settle, or when a
 * panel prints fewer texts than before. Then every panel moves its plot, as
 * before; with `insetOnly` (the grid did not ask for category anchors) nothing moves.
 */
export function alignCategoryPanels(
  children: GridPanelLayout[],
  theme: ReturnType<typeof resolveTheme>,
  insetOnly = false,
): number {
  if (keepsOnePlot(children, theme)) return 0;
  // The group draws as before the inset existed, panel labels included.
  for (const child of children) {
    if (!child.relayout || !child.anchored) continue;
    const reset = child.anchored.captionLeft !== undefined;
    child.anchored.captionLeft = undefined;
    if (reset) child.geometry = child.relayout(child.margin);
  }
  return insetOnly ? 0 : movePlotsToCentres(children, theme);
}

/**
 * Line up the category centres inside one plot rectangle. True when the group holds it; false, with
 * every panel back at its zero inset and its starting margin, when it cannot.
 */
function keepsOnePlot(children: GridPanelLayout[], theme: ReturnType<typeof resolveTheme>): boolean {
  // Category ticks carry the category id. Numeric ticks (a dot or scatter value axis) are no categories.
  const ticksOf = (child: GridPanelLayout) =>
    (child.geometry.axes.find((axis) => axis.axis === 'x')?.ticks ?? []).filter((tick) => typeof tick.at === 'string');
  const candidates = children.filter((child) => child.relayout !== undefined && ticksOf(child).length >= 2);
  if (candidates.length < 2) return false;
  if (children.some((child) => child.relayout !== undefined && child.anchored?.holdsCategories)) return false;
  if (!candidates.every((child) => child.anchored?.categoryInset !== undefined)) return false;
  const shared = ticksOf(candidates[0]!).map((tick) => tick.at)
    .filter((at) => candidates.every((child) => ticksOf(child).some((tick) => tick.at === at)));
  if (shared.length < 2) return false;
  const [firstId, lastId] = [shared[0], shared.at(-1)];
  const tickOf = (child: GridPanelLayout, at: unknown) => ticksOf(child).find((tick) => tick.at === at);
  const posOf = (child: GridPanelLayout, at: unknown) => child.slot.x + tickOf(child, at)!.pos;
  const leftOf = (child: GridPanelLayout) => child.slot.x + child.geometry.plot.x;
  const rightOf = (child: GridPanelLayout) => leftOf(child) + child.geometry.plot.w;

  // Every category that two or more panels draw sits at the same share of the span on each of them.
  const span = minOf(candidates.map((child) => posOf(child, lastId) - posOf(child, firstId)));
  if (!(span > 0)) return false;
  const shareOf = (child: GridPanelLayout, at: unknown) =>
    (posOf(child, at) - posOf(child, firstId)) / (posOf(child, lastId) - posOf(child, firstId));
  const drawn = new Set(candidates.flatMap((child) => ticksOf(child).map((tick) => tick.at)));
  for (const at of drawn) {
    const shares = candidates.filter((child) => tickOf(child, at)).map((child) => shareOf(child, at));
    if (shares.length >= 2 && (maxOf(shares) - minOf(shares)) * span > 1) return false;
  }

  const alignCentres = () => {
    for (let pass = 0; pass < 3; pass++) {
      const first = maxOf(candidates.map((child) => posOf(child, firstId)));
      const last = minOf(candidates.map((child) => posOf(child, lastId)));
      if (!(last > first)) break;
      const off = candidates.filter((child) => Math.abs(posOf(child, firstId) - first) > 0.01 || Math.abs(posOf(child, lastId) - last) > 0.01);
      if (off.length === 0) break;
      for (const child of off) {
        const x = leftOf(child);
        const w = child.geometry.plot.w;
        const inset = child.anchored!.categoryInset!;
        // The current category range: the plot less the inset already taken.
        const x0 = x + inset.left;
        const w0 = w - inset.left - inset.right;
        if (!(w0 > 0)) continue;
        const f = (posOf(child, firstId) - x0) / w0;
        const l = (posOf(child, lastId) - x0) / w0;
        if (!(l > f)) continue;
        const w2 = (last - first) / (l - f);
        const x2 = first - f * w2;
        // A new object on each pass: the layout memo keeps the JSON of an option object by identity.
        child.anchored!.categoryInset = { left: Math.max(0, x2 - x), right: Math.max(0, x + w - (x2 + w2)) };
        child.geometry = child.relayout!(child.margin);
      }
    }
  };
  // Two lines with end labels settle their shared centres within a few hundredths of a pixel.
  const centred = () => {
    const first = posOf(candidates[0]!, firstId);
    const last = posOf(candidates[0]!, lastId);
    return candidates.every((child) => Math.abs(posOf(child, firstId) - first) <= 0.5 && Math.abs(posOf(child, lastId) - last) <= 0.5);
  };
  const sameEdges = () => {
    const left = leftOf(candidates[0]!);
    const right = rightOf(candidates[0]!);
    return candidates.every((child) => Math.abs(leftOf(child) - left) <= 0.01 && Math.abs(rightOf(child) - right) <= 0.01);
  };

  const start = candidates.map((child) => ({ child, margin: child.margin, texts: printedTexts(child.geometry) }));
  alignCentres();
  // A panel that keeps more room than its margin gives it (rotated names) sets the group's plot:
  // the others follow its edges, and their categories move again inside the new plot.
  for (let pass = 0; pass < 3 && centred() && !sameEdges(); pass++) {
    const left = maxOf(candidates.map(leftOf));
    const right = minOf(candidates.map(rightOf));
    if (!(right > left)) break;
    for (const child of candidates) {
      if (Math.abs(leftOf(child) - left) > 0.01 || Math.abs(rightOf(child) - right) > 0.01) moveChildPlot(child, left - leftOf(child), rightOf(child) - right, theme);
    }
    alignCentres();
  }
  if (centred() && sameEdges() && start.every(({ child, texts }) => keepsTexts(texts, printedTexts(child.geometry)))) return true;
  for (const { child, margin } of start) {
    child.margin = margin;
    child.anchored!.categoryInset = { left: 0, right: 0 };
    child.geometry = child.relayout!(child.margin);
  }
  return false;
}

/** The older alignment: each panel moves its plot until its end categories sit on the shared centres. */
function movePlotsToCentres(children: GridPanelLayout[], theme: ReturnType<typeof resolveTheme>): number {
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
