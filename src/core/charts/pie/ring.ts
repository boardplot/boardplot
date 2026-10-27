import { spread1DResult } from '../../collide';
import { rectsOverlap, segmentHitsRect, type Point, type Rect } from '../../geometry';

/**
 * Outside pie labels on a ring round the circle. Each label hangs off the
 * ring at an angle near its slice's angle and takes a straight leader from
 * its slice's rim. The labels spread along the ring in slice order, so the
 * leaders keep the slices' order and do not cross.
 */


export interface RingItem {
  /** Slice mid-angle, degrees clockwise from 12 o'clock. */
  mid: number;
  /** The slice's own centre at radius r (an exploded slice sits off the pie centre). */
  center: (r: number) => Point;
  /** The label box sizes it may take, the preferred form first. */
  forms: { w: number; h: number }[];
}

export interface RingSeat {
  rect: Rect;
  /** Leader start on the slice's rim. */
  from: Point;
  /** Leader end beside the label, where it hangs from the ring. */
  to: Point;
  /** Ring angle the label hangs from. */
  angle: number;
}

export interface RingResult {
  r: number;
  /** The form each item takes (an index into its forms). */
  form: number[];
  seats: RingSeat[];
  /** Items whose seat leaves the plot, overlaps another label, or whose leader cuts a slice, a leader or a label. */
  bad: Set<number>;
}

/** Gap between the rim and the ring the labels hang from. */
export const RING_GAP = 12;
/** Least gap between two labels along the ring. */
const LABEL_GAP = 3;
/** Gap between a leader's end and its label. */
const LEADER_GUTTER = 2;
/** A label pushed this far (degrees) from its slice takes its shorter form. */
const CROWDED_DEG = 3;
/** The pie gives up radius in these steps before a label leaves its slice. */
const SHRINK_STEPS = [0.92, 0.84, 0.76, 0.7];

const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (c: Point, radius: number, deg: number): Point => ({ x: c.x + radius * Math.sin(rad(deg)), y: c.y - radius * Math.cos(rad(deg)) });

/** The point of a rect, grown by `pad`, nearest to `p`. */
export function nearestOnRect(rect: Rect, p: Point, pad = 0): Point {
  return {
    x: Math.min(Math.max(p.x, rect.x - pad), rect.x + rect.w + pad),
    y: Math.min(Math.max(p.y, rect.y - pad), rect.y + rect.h + pad),
  };
}

function distToSegment(c: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, s: Point) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/**
 * Along the ring a label at angle θ needs its height where the ring runs up
 * and down (3 and 9 o'clock) and its width where it runs across (12 and
 * 6 o'clock): two neighbours clear each other in one direction.
 */
function arcSize(form: { w: number; h: number }, deg: number): number {
  const s = Math.abs(Math.sin(rad(deg)));
  const c = Math.abs(Math.cos(rad(deg)));
  return Math.min(form.h / Math.max(s, 1e-3), form.w / Math.max(c, 1e-3)) + LABEL_GAP;
}

/** Seat every item on a ring of this radius round a pie of radius r, each in the form given. */
function seatRing(items: RingItem[], form: number[], r: number, ring: number, plot: Rect): RingResult {
  const n = items.length;
  const order = items.map((_, i) => i).sort((a, b) => norm(items[a]!.mid) - norm(items[b]!.mid) || a - b);
  // The ring opens at the middle of the widest gap between two labels' slices.
  let cut = 0;
  let widest = -1;
  order.forEach((i, k) => {
    const next = order[(k + 1) % n]!;
    const gap = k + 1 < n ? norm(items[next]!.mid) - norm(items[i]!.mid) : norm(items[next]!.mid) + 360 - norm(items[i]!.mid);
    if (gap > widest) { widest = gap; cut = (k + 1) % n; }
  });
  const ordered = [...order.slice(cut), ...order.slice(0, cut)];
  const start = norm(items[ordered[0]!]!.mid);
  const unrolled = ordered.map((i) => { const m = norm(items[i]!.mid); return m < start ? m + 360 : m; });
  const perDeg = rad(ring);
  const lo = (start - widest / 2) * perDeg;
  const seats: RingSeat[] = new Array(n);
  const seatAt = (k: number, t: number) => {
    const i = ordered[k]!;
    const item = items[i]!;
    const { w, h } = item.forms[form[i]!]!;
    const c = item.center(r);
    const p = polar(c, ring, t);
    // The box hangs off the ring outward: beside it at 3 and 9 o'clock, above or below it at 12 and 6.
    const rect = { x: p.x - w / 2 + (w / 2) * Math.sin(rad(t)), y: p.y - h / 2 - (h / 2) * Math.cos(rad(t)), w, h };
    for (let step = 0; step < 3; step++) {
      const near = nearestOnRect(rect, c);
      const short = ring - Math.hypot(near.x - c.x, near.y - c.y);
      if (short <= 0.5) break;
      rect.x += short * Math.sin(rad(t));
      rect.y -= short * Math.cos(rad(t));
    }
    seats[i] = { rect, from: polar(c, r + 1, item.mid), to: nearestOnRect(rect, p, LEADER_GUTTER), angle: t };
  };
  // The arc a label needs is a guess from its own box; two neighbours that
  // still overlap ask for more arc, round by round.
  const extra = new Array<number>(n).fill(0);
  let theta = [...unrolled];
  for (let pass = 0; pass < 10; pass++) {
    const spread = spread1DResult(ordered.map((i, k) => ({ desired: unrolled[k]! * perDeg, size: arcSize(items[i]!.forms[form[i]!]!, theta[k]!) + extra[k]! })), [lo, lo + 360 * perDeg], 0);
    theta = spread.positions.map((pos) => pos / perDeg);
    theta.forEach((t, k) => seatAt(k, t));
    if (pass < 2) continue;
    let crowded = false;
    for (let k = 0; k < n; k++) {
      const next = (k + 1) % n;
      if (next === k || !rectsOverlap(seats[ordered[k]!]!.rect, seats[ordered[next]!]!.rect, LABEL_GAP - 1)) continue;
      extra[k]! += 4;
      extra[next]! += 4;
      crowded = true;
    }
    if (!crowded) break;
  }
  const bad = new Set<number>();
  const ends = seats.map((seat) => seat.to);
  for (let i = 0; i < n; i++) {
    const { rect, from } = seats[i]!;
    if (rect.x < plot.x || rect.y < plot.y || rect.x + rect.w > plot.x + plot.w || rect.y + rect.h > plot.y + plot.h) bad.add(i);
    // A leader that dips under the rim would cut a slice.
    if (distToSegment(items[i]!.center(r), from, ends[i]!) < r - 0.5) bad.add(i);
    for (let j = i + 1; j < n; j++) {
      if (rectsOverlap(rect, seats[j]!.rect, LABEL_GAP - 1)) { bad.add(i); bad.add(j); }
      if (segmentsCross(from, ends[i]!, seats[j]!.from, ends[j]!)) { bad.add(i); bad.add(j); }
    }
    for (let j = 0; j < n; j++) if (j !== i && segmentHitsRect(from, ends[i]!, seats[j]!.rect)) bad.add(i);
  }
  return { r, form: [...form], seats, bad };
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** A slice wider than this (degrees) hangs its label at the side of the pie its arc reaches. */
const WIDE_SLICE = 90;
/** How far inside its slice's edge a moved label's leader starts (degrees). */
const WIDE_INSET = 20;

/**
 * The angle a slice's label hangs from: its mid-angle, or for a wide slice
 * the nearer of 3 and 9 o'clock within its arc, so the label sits beside the
 * pie and leaves 12 and 6 o'clock to small slices and callouts.
 */
export function labelAngle(a0: number, a1: number): number {
  const mid = (a0 + a1) / 2;
  if (a1 - a0 <= WIDE_SLICE) return mid;
  // 3 o'clock below 180°, 9 o'clock from 180° on: the side the column sizing counts the label on, also at a tie.
  const side = mid - norm(mid) + (norm(mid) < 180 ? 90 : 270);
  return Math.min(a1 - WIDE_INSET, Math.max(a0 + WIDE_INSET, side));
}

/**
 * Seat the labels near their slices. At each radius every label first takes
 * its preferred form (two lines); a label its neighbours push off its slice,
 * or one that collides, then takes its shorter form (one line), round by
 * round. When that fails too, the pie gives up radius, down to 70% of r:
 * the ring follows it in (room above and below grows) or keeps its size
 * (the ring keeps its length and each leader may lean further). The first
 * seating with no bad label wins, else the one with the fewest.
 */
export function placeRing(items: RingItem[], r0: number, plot: Rect, minRadius: number): RingResult {
  if (items.length === 0) return { r: r0, form: [], seats: [], bad: new Set() };
  let best: RingResult | undefined;
  const steps = [1, ...SHRINK_STEPS].flatMap((k) => k === 1 ? [[k, r0 + RING_GAP]] : [[k, r0 * k + RING_GAP], [k, r0 + RING_GAP]]);
  for (const [k, ring] of steps as [number, number][]) {
    const r = r0 * k;
    if (k < 1 && r < minRadius) break;
    const form = items.map(() => 0);
    for (let round = 0; round < 4; round++) {
      const tried = seatRing(items, form, r, ring, plot);
      if (tried.bad.size === 0) return tried;
      if (!best || tried.bad.size < best.bad.size) best = tried;
      let changed = false;
      const shorter = items.map((item, i) => item.forms.reduce((j, f, m) => (arcSize(f, item.mid) < arcSize(item.forms[j]!, item.mid) ? m : j), form[i]!));
      const pushed = items.map((item, i) => Math.abs(((norm(tried.seats[i]!.angle) - norm(item.mid) + 540) % 360) - 180) > CROWDED_DEG || tried.bad.has(i));
      // A label between two that switch switches too, so a crowded run of labels reads as one.
      const order = items.map((_, i) => i).sort((a, b) => norm(items[a]!.mid) - norm(items[b]!.mid) || a - b);
      const switching = items.map((_, i) => pushed[i]! && shorter[i] !== form[i]);
      order.forEach((i, k) => {
        const between = order.length > 2 && switching[order[(k + order.length - 1) % order.length]!] && switching[order[(k + 1) % order.length]!];
        if ((pushed[i] || between) && shorter[i] !== form[i]) { form[i] = shorter[i]!; changed = true; }
      });
      if (!changed) break;
    }
  }
  return best!;
}
