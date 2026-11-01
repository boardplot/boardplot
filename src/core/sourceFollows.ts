/**
 * The notes and the source line follow the drawn content on a canvas the host pinned.
 * A pinned frame can be taller than its chart (a row chart stops at its row pitch cap, a circle is
 * bound by its width), and the frame puts the footer at the canvas bottom. The footer block (the
 * bottom key, the event key, the notes, the source) then moves up under the lowest drawn mark, at
 * the gap the frame itself leaves there, and the spare height stays below it at the canvas edge.
 * Layout owns this: the same input gives the same geometry. A chart that fills its canvas keeps
 * every byte, because nothing moves unless the empty band is larger than LIFT_OVER.
 * The theme patch `space: { footerFollows: false }` keeps the footer at the canvas bottom.
 */
import type { Rect } from './geometry';
import type { ChartOptions } from './registry';
import { defaultMeasurer } from './text';
import { cubicPoint } from './curve';
import { fixedHeightCanvas } from './rowCanvas';
import { panelTypeClass, resolveTheme } from './theme';
import type { Geometry, SceneNode } from './types/scene';
import type { ThemeRef } from './types/theme';

/** An empty band under the marks is left alone up to this much beyond the frame's own gap. */
const LIFT_OVER = 8;
/** The ascent of a text line in a line box, as the SVG writer places a rotated baseline. */
const ASCENT = 0.88;

const clear = (paint: unknown): boolean => !paint || paint === 'none' || (paint as { css?: string }).css === 'transparent' || (paint as { css?: string }).css === 'none';
const r2 = (value: number): number => Math.round(value * 100) / 100;

interface Pt { x: number; y: number }

/** An SVG arc (endpoint form) sampled along its curve, so a slice's bottom is its arc and not its radius box. */
function arcPoints(from: Pt, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, to: Pt): Pt[] {
  if (rx === 0 || ry === 0) return [to];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = rotation * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (from.x - to.x) / 2, dy = (from.y - to.y) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const scale = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
  if (scale > 1) { rx *= Math.sqrt(scale); ry *= Math.sqrt(scale); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = co * rx * y1 / ry, cyp = -co * ry * x1 / rx;
  const cx = cp * cxp - sp * cyp + (from.x + to.x) / 2, cy = sp * cxp + cp * cyp + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let span = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && span > 0) span -= 2 * Math.PI;
  if (sweep && span < 0) span += 2 * Math.PI;
  return Array.from({ length: 48 }, (_, k) => {
    const t = start + span * (k + 1) / 48;
    return { x: cp * rx * Math.cos(t) - sp * ry * Math.sin(t) + cx, y: sp * rx * Math.cos(t) + cp * ry * Math.sin(t) + cy };
  });
}

const POLYLINE = /^[MLZ\d\s,.eE+-]*$/;

/** Absolute polylines (every map region, every straight mark): the y of each second number, read by hand. */
function polylineLowest(d: string, stop: number): number {
  let lowest = -Infinity, index = 0;
  const end = d.length;
  for (let i = 0; i < end;) {
    const c = d.charCodeAt(i);
    // A number starts at a digit, a sign or a point; 'e' only continues one.
    if (c >= 48 && c <= 57 || c === 45 || c === 46) {
      const from = i++;
      for (let e = d.charCodeAt(i); i < end && (e >= 48 && e <= 57 || e === 46 || e === 101 || e === 69 || (e === 45 || e === 43) && (d.charCodeAt(i - 1) | 32) === 101); e = d.charCodeAt(++i));
      if (index++ & 1) {
        const y = +d.slice(from, i);
        if (y > lowest) { lowest = y; if (y >= stop) return lowest; }
      }
    } else i++;
  }
  return lowest;
}

/**
 * The largest y a path outline reaches (M L H V C Q A S T Z, absolute and relative); curves are sampled.
 * It may stop early with any value at or above `stop`, which is all a caller that only asks "does it reach `stop`" needs.
 */
function pathLowest(d: string, stop: number): number {
  if (POLYLINE.test(d)) return polylineLowest(d, stop);
  let lowest = -Infinity, at: Pt = { x: 0, y: 0 }, start = at;
  const see = (y: number) => { if (y > lowest) lowest = y; };
  for (const [, command, args] of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    if (lowest >= stop) return lowest;
    const n = (args!.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    const rel = command === command!.toLowerCase(), kind = command!.toUpperCase();
    if (kind === 'Z') { at = start; continue; }
    if (kind === 'M' || kind === 'L' || kind === 'T') {
      for (let i = 0; i + 1 < n.length; i += 2) {
        at = { x: n[i]! + (rel ? at.x : 0), y: n[i + 1]! + (rel ? at.y : 0) };
        if (kind === 'M' && i === 0) start = at;
        see(at.y);
      }
    } else if (kind === 'H') { for (const x of n) at = { x: x + (rel ? at.x : 0), y: at.y }; }
    else if (kind === 'V') { for (const y of n) { at = { x: at.x, y: y + (rel ? at.y : 0) }; see(at.y); } }
    else if (kind === 'C') {
      for (let i = 0; i + 5 < n.length; i += 6) {
        const ox = rel ? at.x : 0, oy = rel ? at.y : 0;
        const segment = { from: at, c1: { x: n[i]! + ox, y: n[i + 1]! + oy }, c2: { x: n[i + 2]! + ox, y: n[i + 3]! + oy }, to: { x: n[i + 4]! + ox, y: n[i + 5]! + oy } };
        for (let k = 1; k <= 16; k++) see(cubicPoint(segment, k / 16).y);
        at = segment.to;
      }
    } else if (kind === 'Q') {
      for (let i = 0; i + 3 < n.length; i += 4) {
        const ox = rel ? at.x : 0, oy = rel ? at.y : 0;
        const control = n[i + 1]! + oy, end = { x: n[i + 2]! + ox, y: n[i + 3]! + oy };
        for (let k = 1; k <= 16; k++) { const t = k / 16, u = 1 - t; see(u * u * at.y + 2 * u * t * control + t * t * end.y); }
        at = end;
      }
    } else if (kind === 'A') {
      for (let i = 0; i + 6 < n.length; i += 7) {
        const end = { x: n[i + 5]! + (rel ? at.x : 0), y: n[i + 6]! + (rel ? at.y : 0) };
        for (const point of arcPoints(at, n[i]!, n[i + 1]!, n[i + 2]!, !!n[i + 3], !!n[i + 4], end)) see(point.y);
        at = end;
      }
    } else if (kind === 'S') {
      for (let i = 0; i + 3 < n.length; i += 4) { at = { x: n[i + 2]! + (rel ? at.x : 0), y: n[i + 3]! + (rel ? at.y : 0) }; see(at.y); }
    }
  }
  return lowest;
}

/** Top and bottom of a node in canvas px, with its translation. A path's top is its bottom; it may stop early above `stop`. */
function extent(node: SceneNode, stop = Infinity): [number, number] | undefined {
  const dy = node.ty ?? 0;
  switch (node.t) {
    case 'rect': case 'image': {
      const half = node.t === 'rect' && node.stroke ? (node.strokeWidth ?? 1) / 2 : 0;
      return [node.rect.y + dy - half, node.rect.y + node.rect.h + dy + half];
    }
    case 'line': return [Math.min(node.y1, node.y2) + dy - node.width / 2, Math.max(node.y1, node.y2) + dy + node.width / 2];
    case 'circle': return [node.cy + dy - node.r, node.cy + dy + node.r];
    case 'path': {
      const half = node.stroke ? (node.width ?? 1) / 2 : 0;
      const low = pathLowest(node.d, stop - dy - half);
      if (!Number.isFinite(low)) return undefined;
      const bottom = low + dy + half;
      return [bottom, bottom];
    }
    case 'text': {
      const lineH = node.font.size * (node.font.lineHeight ?? 1.2) * node.lines.length;
      let bottom = node.y + dy + lineH;
      if (node.rotate) {
        const width = Math.max(0, ...node.lines.map(line => defaultMeasurer(line, node.font).width));
        const left = node.align === 'end' ? -width : node.align === 'middle' ? -width / 2 : 0;
        const ascent = node.font.size * ASCENT;
        const angle = node.rotate * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
        bottom = node.y + dy + ascent + Math.max(left * sin, (left + width) * sin) + Math.max(-ascent * cos, (lineH - ascent) * cos);
      }
      if (node.backing) bottom = Math.max(bottom, node.backing.y + node.backing.h + dy);
      return [node.y + dy, bottom];
    }
    default: return undefined;
  }
}

/** True where the node draws something. A page background and an invisible hit area are no content. */
function drawn(node: SceneNode, canvas: { width: number; height: number }): boolean {
  if (node.opacity === 0) return false;
  if (node.t === 'rect') {
    if (clear(node.fill) && !node.stroke) return false;
    return !(node.rect.w >= canvas.width * 0.97 && node.rect.h >= canvas.height * 0.97);
  }
  if (node.t === 'path') return !clear(node.fill) || !!node.stroke;
  if (node.t === 'text') return node.lines.some(line => String(line).trim() !== '');
  return true;
}

function moved(node: SceneNode, dy: number): SceneNode {
  switch (node.t) {
    case 'text': return { ...node, y: r2(node.y - dy), ...(node.backing ? { backing: { ...node.backing, y: r2(node.backing.y - dy) } } : {}) };
    case 'rect': case 'image': return { ...node, rect: { ...node.rect, y: r2(node.rect.y - dy) } };
    case 'line': return { ...node, y1: r2(node.y1 - dy), y2: r2(node.y2 - dy) };
    case 'circle': return { ...node, cy: r2(node.cy - dy) };
    default: return { ...node, ty: r2((node.ty ?? 0) - dy) };
  }
}

const up = (rect: Rect, dy: number): Rect => ({ ...rect, y: r2(rect.y - dy) });

/**
 * Lifts the footer block of a fresh copy of a layout (never of a memoised one) under the lowest mark.
 * Does nothing on an open height, a panel inside a grid, a story, or a canvas the content fills.
 */
export function sourceFollowsContent(geometry: Geometry<object, object>, options: ChartOptions | undefined): void {
  const { frame, size } = geometry;
  const plotBand = frame.plotRect;
  if (!plotBand || geometry.story || panelTypeClass(options) !== undefined || !fixedHeightCanvas(options ?? {})) return;
  const plotBottom = plotBand.y + plotBand.h;
  // The bottom block: the key under the plot (a legend that starts at or below the plot band), the event key, the footer.
  const tops = [frame.footerRect?.y, frame.eventKeyRect?.y, geometry.legend && geometry.legend.rect.y >= plotBottom - 0.5 ? geometry.legend.rect.y : undefined]
    .filter((top): top is number => top !== undefined);
  if (tops.length === 0) return;
  const blockTop = Math.min(...tops);
  const gap = blockTop - plotBottom;
  if (gap < 0) return;
  // A lift needs the lowest mark above this line. Marks that reach it end the search, and a path only has to be read up to the block.
  const line = plotBottom - LIFT_OVER;
  const inBlock = blockTop - 0.01;
  const boxes = geometry.scene.map(node => node.t === 'path' ? undefined : extent(node));
  let ink = -Infinity;
  geometry.scene.forEach((node, i) => {
    const box = boxes[i];
    if (box && box[0] < inBlock && drawn(node, size)) ink = Math.max(ink, box[1]);
  });
  if (ink >= line) return;
  for (const [i, node] of geometry.scene.entries()) {
    if (node.t !== 'path' || !drawn(node, size)) continue;
    const box = boxes[i] = extent(node, inBlock);
    if (!box || box[0] >= inBlock) continue;
    ink = Math.max(ink, box[1]);
    if (ink >= line) return;
  }
  if (!Number.isFinite(ink)) return;
  const spare = blockTop - ink - gap;
  if (spare <= LIFT_OVER) return;
  if (resolveTheme((options as { theme?: ThemeRef } | undefined)?.theme).space.footerFollows === false) return;
  const dy = r2(spare);
  geometry.scene = geometry.scene.map((node, i) => {
    const box = node.t === 'path' ? boxes[i] ?? extent(node, inBlock) : boxes[i];
    return box && box[0] >= inBlock ? moved(node, dy) : node;
  });
  const shifted: Partial<typeof frame> = {};
  if (frame.footerRect) shifted.footerRect = up(frame.footerRect, dy);
  if (frame.eventKeyRect) shifted.eventKeyRect = up(frame.eventKeyRect, dy);
  if (frame.notesButton?.y !== undefined) shifted.notesButton = { ...frame.notesButton, y: r2(frame.notesButton.y - dy) };
  Object.assign(frame, shifted);
  if (geometry.legend && geometry.legend.rect.y >= blockTop - 0.01) geometry.legend = { ...geometry.legend, rect: up(geometry.legend.rect, dy) };
  geometry.debug = { ...geometry.debug, occupied: geometry.debug.occupied.map(claim =>
    (claim.kind === 'frame' || claim.kind === 'legend') && claim.rect.y >= blockTop - 0.01 ? { ...claim, rect: up(claim.rect, dy) } : claim) };
}
