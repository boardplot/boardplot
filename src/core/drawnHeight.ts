/**
 * The height a chart draws. A pinned frame can be taller than its chart: a circle is bound by its
 * width, a row chart stops at its row pitch cap, and the rest of the frame stays empty. A host that
 * sizes its own frame from `measure` needs the height with no empty bands, and no layout reports it.
 * So `drawnHeight` finds it from two layouts: a shorter frame draws the same chart when its marks
 * keep their shape and move together, and only the frame's own text (title, key, notes) stays at
 * the top or the bottom edge.
 */
import type { Size } from './geometry';
import type { Geometry, LayoutResult, SceneNode } from './types/scene';
import { isRefused } from './schema/refusals';

/**
 * Layout rounds to 0.01 px, centres on halves, and a circle's diameter steps by 1 px with the room
 * it is searched in. Marks that spread or scale with the frame differ by far more.
 */
const TOLERANCE = 1.05;
/** Under this difference the tolerances pass every node of a chart that grows by so little; it is no empty band. */
const MIN_EMPTY_BAND = 4;

interface Band { top: number; height: number }

/** The vertical extent of a node's drawing: where it starts and how tall it is. */
function band(node: SceneNode): Band | undefined {
  const shift = ('ty' in node ? node.ty : undefined) ?? 0;
  switch (node.t) {
    case 'rect': case 'image': return { top: node.rect.y + shift, height: node.rect.h };
    case 'line': return { top: Math.min(node.y1, node.y2) + shift, height: Math.abs(node.y2 - node.y1) };
    case 'circle': return { top: node.cy - node.r + shift, height: 2 * node.r };
    case 'text': return { top: node.y + shift, height: 0 };
    case 'path': return pathBand(node.d, shift);
    default: return undefined;
  }
}

/** Parameters taken by one repeat of each path command. */
const PATH_ARGUMENTS: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };

/**
 * The y values a path passes through, read as absolute points: control points count, and an arc
 * counts its end points shifted by its radius, so a smaller arc is a shorter shape.
 */
function pathBand(d: string, shift: number): Band | undefined {
  const ys: number[] = [];
  let [y, startY] = [0, 0];
  for (const [, command, args] of d.matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
    const kind = command!.toUpperCase();
    const relative = command !== kind;
    const numbers = (args!.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (kind === 'Z') { y = startY; continue; }
    const step = PATH_ARGUMENTS[kind]!;
    for (let i = 0; i + step <= numbers.length; i += step) {
      const at = numbers.slice(i, i + step);
      if (kind === 'H') continue;
      if (kind === 'V') { y = relative ? y + at[0]! : at[0]!; ys.push(y); continue; }
      if (kind === 'A') {
        const end = relative ? y + at[6]! : at[6]!;
        ys.push(y - at[1]!, y + at[1]!, end - at[1]!, end + at[1]!);
        y = end;
        continue;
      }
      let next = y;
      for (let j = 1; j < step; j += 2) { next = relative ? y + at[j]! : at[j]!; ys.push(next); }
      y = next;
      if (kind === 'M' && i === 0) startY = y;
    }
  }
  if (ys.length === 0) return undefined;
  const top = ys.reduce((least, value) => Math.min(least, value));
  return { top: top + shift, height: ys.reduce((most, value) => Math.max(most, value)) - top };
}

/** An axis or annotation rule that marks a place along x (a baseline, a base value): its length follows the plot, so it grows with an empty frame. A rule that draws data (a range rail) does not. */
function verticalRule(node: SceneNode): boolean {
  if (!/^(?:axis|ann):/.test(node.id)) return false;
  if (node.t === 'line') return node.x1 === node.x2;
  if (node.t !== 'path' || /[^ML\d\s,.eE+-]/.test(node.d)) return false;
  const xs = (node.d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter((_, i) => i % 2 === 0);
  return xs.length > 0 && xs.every((x) => x === xs[0]);
}

/** What a node says besides where it stands: a changed text or a smaller type is a different drawing. */
function content(node: SceneNode): string {
  return node.t === 'text' ? `${node.font.size}|${node.lines.join('\n')}` : node.t;
}

/**
 * The frame's own nodes (title, subtitle, key, notes, source), text above or below the plot or on its
 * edge (axis labels, a total) and any other node wholly beyond the plot (a footer rule). A mark on the
 * plot's edge is not one.
 */
function chrome(node: SceneNode, at: Band, plot: Geometry['plot']): boolean {
  const slack = node.t === 'text' ? TOLERANCE : -TOLERANCE;
  return node.id.startsWith('frame:') || at.top + at.height <= plot.y + slack || at.top >= plot.y + plot.h - slack;
}

/**
 * True when `short` is `tall` minus empty space: both draw the same nodes, each as tall as before,
 * nothing is cut off by the shorter canvas, every node in the plot moved by one amount, and the nodes
 * outside it stayed at the top edge, moved by half the difference (centred) or by all of it (bottom edge).
 */
function sameDrawing(short: Geometry, tall: Geometry): boolean {
  if (short.mode !== tall.mode || short.scene.length !== tall.scene.length) return false;
  const gap = tall.size.height - short.size.height;
  const tallById = new Map(tall.scene.map((node) => [node.id, node]));
  let markMove: number | undefined;
  for (const node of short.scene) {
    const other = tallById.get(node.id);
    if (!other || other.t !== node.t || content(other) !== content(node)) return false;
    if (verticalRule(node) && verticalRule(other)) continue;
    const a = band(node), b = band(other);
    if (!a || !b) { if (a || b) return false; continue; }
    if (Math.abs(a.height - b.height) > TOLERANCE) return false;
    // A shorter frame that cuts a node off does not draw the chart.
    if (a.top < -TOLERANCE || a.top + a.height > short.size.height + TOLERANCE) return false;
    const moved = b.top - a.top;
    if (chrome(other, b, tall.plot)) {
      if (![0, gap / 2, gap].some((edge) => Math.abs(moved - edge) <= TOLERANCE)) return false;
    } else if (Math.abs(moved - (markMove ??= moved)) > TOLERANCE) return false;
  }
  return true;
}

/**
 * The least height whose layout draws the chart the pinned frame draws, with no empty bands.
 * `layoutAt` lays the chart out at a size; `lowest` is a height known to be too small. A chart that
 * uses all of its frame, or that no shorter frame draws the same, keeps the pinned height.
 */
export function drawnHeight(pinned: Geometry, lowest: number, layoutAt: (size: Size) => LayoutResult): number {
  const width = pinned.size.width;
  const draws = (height: number): boolean => {
    const probe = layoutAt({ width, height });
    // A canvas that grew past the height given (the notes outgrew it) is not a drawing at that height.
    return !isRefused(probe) && probe.size.height <= height + 0.01 && sameDrawing(probe as Geometry, pinned);
  };
  const frame = pinned.size.height;
  let [low, high] = [Math.max(1, Math.floor(lowest)), Math.ceil(frame)];
  if (high - low <= 1) return frame;
  if (!draws(low)) {
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (draws(middle)) high = middle; else low = middle;
    }
  } else high = low;
  return frame - high >= MIN_EMPTY_BAND ? Math.min(high, frame) : frame;
}
