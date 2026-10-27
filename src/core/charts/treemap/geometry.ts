/**
 * Treemap geometry, pure and deterministic: the squarified rectangle layout
 * and the power-diagram Voronoi treemap with its iterative weight update,
 * both as published in the treemap literature.
 *
 * The Voronoi cells are built one site at a time: the container polygon
 * clipped by the half-plane of every other site. For a few dozen sites per
 * level this is short, exact and needs no Delaunay structure. Same input,
 * same arithmetic, same output: no randomness, a fixed iteration cap and a
 * fixed stop threshold.
 */

import type { Rect } from '../../geometry';
import { maxOf } from '../../arrays';

export interface Pt { x: number; y: number }
export type Polygon = Pt[];

/** Absolute polygon area (shoelace). */
export function polygonArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Area centroid; the vertex mean for a degenerate polygon. */
export function polygonCentroid(poly: Polygon): Pt {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-12) {
    const n = Math.max(1, poly.length);
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/** Keep the part of a convex polygon where a.x * x + a.y * y <= b (Sutherland–Hodgman, one edge). */
function clipHalfPlane(poly: Polygon, ax: number, ay: number, b: number): Polygon {
  const out: Polygon = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const fp = ax * p.x + ay * p.y - b;
    const fq = ax * q.x + ay * q.y - b;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

/** A regular polygon standing for a circle: `n` vertices, clockwise from 12 o'clock in y-down space. */
export function circlePolygon(cx: number, cy: number, r: number, n = 256): Polygon {
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return { x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) };
  });
}

/** The power cell of every site inside a convex container. */
function powerCells(sites: readonly Pt[], weights: readonly number[], container: Polygon): Polygon[] {
  return sites.map((p, i) => {
    let poly = container;
    for (let j = 0; j < sites.length && poly.length >= 3; j++) {
      if (j === i) continue;
      const q = sites[j]!;
      // |x - p|² - w_i <= |x - q|² - w_j  ⇔  2(q - p)·x <= |q|² - |p|² - w_j + w_i
      poly = clipHalfPlane(poly, 2 * (q.x - p.x), 2 * (q.y - p.y), q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y - weights[j]! + weights[i]!);
    }
    return poly.length >= 3 ? poly : [];
  });
}

/** The relative area error above which a circle treemap warns treemap-area-error (5%). */
export const TREEMAP_AREA_ERROR_LIMIT = 0.05;
/**
 * The most items a circle treemap draws. The power cells are pairwise, so the
 * time grows with the square of the item count.
 */
export const TREEMAP_CIRCLE_MAX_ITEMS = 24;
/** Stop once every cell is within this relative area error of its target. */
const VORONOI_STOP_ERROR = 0.002;
/** The fixed iteration cap of one Voronoi level. */
const VORONOI_MAX_ITERATIONS = 400;
/** The largest factor one iteration may change a weight by. */
const WEIGHT_STEP = 0.5;

/**
 * Lower weights until no site lies inside another site's power circle, so
 * every site stays inside its own cell and no cell goes empty.
 */
function capWeights(sites: readonly Pt[], weights: number[]): void {
  for (let i = 0; i < sites.length; i++) {
    for (let j = 0; j < sites.length; j++) {
      if (i === j) continue;
      const d2 = (sites[i]!.x - sites[j]!.x) ** 2 + (sites[i]!.y - sites[j]!.y) ** 2;
      // Site j stays in its own cell while w_i - w_j < d²; lower w_i, keep it positive.
      if (weights[i]! - weights[j]! >= d2) weights[i] = Math.max(1e-12, weights[j]! + d2 * 0.999);
    }
  }
}

interface VoronoiResult {
  cells: Polygon[];
  /** Iterations run, at most VORONOI_MAX_ITERATIONS. */
  iterations: number;
  /** Largest |area − target| / target over the cells. */
  maxError: number;
}

/**
 * Voronoi treemap of one level: cells inside `container` whose areas match
 * `shares` (positive, summing to 1). `seeds` are the start sites, one per
 * share, strictly inside the container and distinct.
 *
 * Each iteration moves every site to its cell's centroid (which keeps cells
 * convex and round), then scales every weight by target / area, at most by
 * WEIGHT_STEP either way, and caps weights so no cell empties. It stops at
 * VORONOI_STOP_ERROR or VORONOI_MAX_ITERATIONS, whichever comes first.
 */
export function voronoiTreemap(container: Polygon, shares: readonly number[], seeds: readonly Pt[]): VoronoiResult {
  const n = shares.length;
  if (n === 1) return { cells: [container], iterations: 0, maxError: 0 };
  const total = polygonArea(container);
  const targets = shares.map((share) => share * total);
  const sites = seeds.map((p) => ({ ...p }));
  // Start as plain Voronoi with a weight scaled to each target, capped to stay valid.
  const weights = targets.map((t) => t / Math.PI / 4);
  capWeights(sites, weights);
  let cells = powerCells(sites, weights, container);
  const errorOf = (polys: Polygon[]): number => maxOf(polys.map((poly, i) => Math.abs(polygonArea(poly) - targets[i]!) / targets[i]!));
  let maxError = errorOf(cells);
  let iterations = 0;
  while (iterations < VORONOI_MAX_ITERATIONS && maxError > VORONOI_STOP_ERROR) {
    iterations++;
    cells.forEach((poly, i) => {
      if (poly.length >= 3) sites[i] = polygonCentroid(poly);
    });
    capWeights(sites, weights);
    cells = powerCells(sites, weights, container);
    cells.forEach((poly, i) => {
      const area = polygonArea(poly);
      const ratio = area > 0 ? targets[i]! / area : 1 + WEIGHT_STEP;
      weights[i] = Math.max(1e-12, weights[i]! * Math.min(1 + WEIGHT_STEP, Math.max(1 - WEIGHT_STEP, ratio)));
    });
    capWeights(sites, weights);
    cells = powerCells(sites, weights, container);
    maxError = errorOf(cells);
  }
  return { cells, iterations, maxError };
}

/**
 * Start sites inside a convex polygon, deterministic: share k sits on the
 * ray at the middle of its cumulative angular sector, clockwise from 12
 * o'clock (or from `start`, in radians clockwise) as a pie would draw it,
 * half way from the centroid to the edge. Sorted shares put the largest
 * first, clockwise.
 */
export function seedSites(poly: Polygon, shares: readonly number[], start = 0): Pt[] {
  const c = polygonCentroid(poly);
  let cumulative = 0;
  return shares.map((share) => {
    const mid = start + (cumulative + share / 2) * 2 * Math.PI;
    cumulative += share;
    const dx = Math.sin(mid);
    const dy = -Math.cos(mid);
    return { x: c.x + dx * rayReach(poly, c, dx, dy) * 0.5, y: c.y + dy * rayReach(poly, c, dx, dy) * 0.5 };
  });
}

/** Distance from `c` (inside) along (dx, dy) to the polygon edge. */
function rayReach(poly: Polygon, c: Pt, dx: number, dy: number): number {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-15) continue;
    const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den;
    const u = ((a.x - c.x) * dy - (a.y - c.y) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * Squarified treemap: rectangles for `values` (positive) inside `rect`, in
 * the given order, areas exactly proportional. Rows run along the shorter
 * side and grow while the worst aspect ratio in the row improves.
 * With `nearSquare` > 0 a rectangle within that share of a square lays its
 * row along the other side.
 */
export function squarify(values: readonly number[], rect: Rect, nearSquare = 0): Rect[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  const out: Rect[] = new Array(values.length);
  if (values.length === 0 || total <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  const areas = values.map((v) => v * scale);
  let { x, y, w, h } = rect;
  const worst = (sum: number, max: number, min: number, side: number): number =>
    Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    let sum = areas[i]!;
    let max = sum;
    let min = sum;
    let score = worst(sum, max, min, side);
    let j = i + 1;
    while (j < areas.length) {
      const a = areas[j]!;
      const next = worst(sum + a, Math.max(max, a), Math.min(min, a), side);
      if (next > score) break;
      sum += a;
      max = Math.max(max, a);
      min = Math.min(min, a);
      score = next;
      j++;
    }
    const last = j === areas.length;
    // `nearSquare` (a share of the longer side): a rectangle that close to a
    // square lays its row the other way. Either way is squarified; the caller
    // takes the one whose cells hold more of their names.
    const columns = nearSquare > 0 && Math.abs(w - h) <= nearSquare * Math.max(w, h) ? w < h : w >= h;
    if (columns) {
      // The row is a column at the left, `thick` wide.
      const thick = last ? w : sum / h;
      let yy = y;
      for (let k = i; k < j; k++) {
        const hk = k === j - 1 ? y + h - yy : areas[k]! / thick;
        out[k] = { x, y: yy, w: thick, h: hk };
        yy += hk;
      }
      x += thick;
      w -= thick;
    } else {
      const thick = last ? h : sum / w;
      let xx = x;
      for (let k = i; k < j; k++) {
        const wk = k === j - 1 ? x + w - xx : areas[k]! / thick;
        out[k] = { x: xx, y, w: wk, h: thick };
        xx += wk;
      }
      y += thick;
      h -= thick;
    }
    i = j;
  }
  return out;
}
