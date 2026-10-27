/**
 * Aspect ladder and type→class map.
 *
 * The ladder is an aspect-RATIO enum, not a height table. Every document
 * width inherits the same seven steps via H = round(W / ratio), tolerance
 * ±2% after integer rounding — which is why the printed heights
 * (608@1080, 405/540@720) may sit one pixel off the arithmetic: they are
 * rounded from the true device ratios (16:9, 4:3) and land inside the
 * tolerance band, exactly as the four shipping SIZE_PRESETS do.
 *
 * This table is the single source the aspect lints (`src/core/lint/aspect.ts`)
 * and any future embed-class derivation read. It is keyed by registry type.
 */

import type { Size } from './geometry';

/** Maximum height share for the title, key, axes and footer together. */
export const furnitureBudget = (width: number): number => width < 720 ? 0.5 : 0.4;

export type LadderStepName = 'strip' | 'band' | 'wide' | 'broad' | 'std' | 'a4' | 'tall';

interface LadderStep {
  name: LadderStepName;
  /** W:H — flatter steps first (rung distance = index distance). */
  ratio: number;
}

/** The seven-step height ladder as ratios. */
export const ASPECT_LADDER: readonly LadderStep[] = [
  { name: 'strip', ratio: 4.5 },
  { name: 'band', ratio: 3.6 },
  { name: 'wide', ratio: 2.84 },
  { name: 'broad', ratio: 2.25 },
  { name: 'std', ratio: 1.78 },
  { name: 'a4', ratio: 1.41 },
  { name: 'tall', ratio: 1.33 },
] as const;

/** Tolerance: ±2% after integer rounding. */
export const LADDER_TOLERANCE = 0.02;

/** Aspect caps. `flatNonStrip` doubles as the flattest legal non-strip step. */
export const ASPECT_CAPS = { flatAbsolute: 4.5, flatNonStrip: 3.6, tall: 1.33 } as const;

/** All seven heights at a given width, flattest first. */
export function ladderHeights(width: number): { name: LadderStepName; height: number }[] {
  return ASPECT_LADDER.map((s) => ({ name: s.name, height: Math.round(width / s.ratio) }));
}

/**
 * The step a canvas sits on, or null when the height clears no step's ±2%
 * band. With overlapping bands (impossible on this ladder above ~100px
 * width) the numerically closest step wins, so the answer is deterministic.
 */
export function onLadderStep(size: Size): LadderStepName | null {
  let best: { name: LadderStepName; distance: number } | null = null;
  for (const { name, height } of ladderHeights(size.width)) {
    const distance = Math.abs(size.height - height);
    if (distance <= LADDER_TOLERANCE * height && (!best || distance < best.distance)) {
      best = { name, distance };
    }
  }
  return best?.name ?? null;
}

/** Nearest step by height distance — for lint messages, never for gating. */
export function nearestLadderStep(size: Size): { name: LadderStepName; height: number } {
  const steps = ladderHeights(size.width);
  return steps.reduce((a, b) =>
    Math.abs(size.height - b.height) < Math.abs(size.height - a.height) ? b : a,
  );
}

/** The eight aspect classes. `strip` is a composition step
 * (kpi-row) with no realization among today's 30 types. */
export type AspectClass =
  | 'card'
  | 'strip'
  | 'wide-time'
  | 'standard-cartesian'
  | 'row-driven'
  | 'matrix'
  | 'tall'
  | 'geo-free';

/** Classes whose plot height share the space lint checks. */
export const HEIGHT_FLOOR_CLASSES: ReadonlySet<AspectClass> = new Set([
  'standard-cartesian',
  'wide-time',
  'tall',
  'matrix',
  'geo-free',
]);

/**
 * Whether a proportioned chart of this class keeps the furniture budget. A matrix off the
 * ladder takes its height from the row pitch, so no budget applies to it.
 */
export function furnitureScoped(cls: AspectClass, size: Size): boolean {
  return (HEIGHT_FLOOR_CLASSES.has(cls) && !(cls === 'matrix' && onLadderStep(size) === null))
    || cls === 'card' || cls === 'strip';
}

interface AspectProfile {
  cls: AspectClass;
  /** Deterministic default step per type. Row-driven and matrix types
   * derive exact heights from rows × pitch instead; their entry is
   * the fallback step their fixtures ship on today. */
  defaultStep: LadderStepName;
}

/**
 * All 30 registered types. wide-time covers line/combo at
 * ≥16 periods; below that they fall to standard-cartesian (`h.std`) — a
 * data-dependent refinement that changes the default STEP, never which caps
 * apply, so the static table carries the class's own step (`wide`).
 */
const TYPE_ASPECT_PROFILE: Record<string, AspectProfile> = {
  // card — kpi min 240×135; both specimens sit on the 1.78 ratio.
  kpi: { cls: 'card', defaultStep: 'std' },
  bullet: { cls: 'card', defaultStep: 'std' },
  // wide-time
  line: { cls: 'wide-time', defaultStep: 'wide' },
  combo: { cls: 'wide-time', defaultStep: 'wide' },
  // standard-cartesian — h.std, or h.broad in some embeds.
  column: { cls: 'standard-cartesian', defaultStep: 'std' },
  waterfall: { cls: 'standard-cartesian', defaultStep: 'std' },
  pvm: { cls: 'standard-cartesian', defaultStep: 'std' },
  variance: { cls: 'standard-cartesian', defaultStep: 'std' },
  pareto: { cls: 'standard-cartesian', defaultStep: 'std' },
  mekko: { cls: 'standard-cartesian', defaultStep: 'std' },
  histogram: { cls: 'standard-cartesian', defaultStep: 'std' },
  scatter: { cls: 'standard-cartesian', defaultStep: 'std' },
  slope: { cls: 'standard-cartesian', defaultStep: 'std' },
  pie: { cls: 'standard-cartesian', defaultStep: 'std' },
  box: { cls: 'standard-cartesian', defaultStep: 'std' },
  // row-driven — H = furniture + n_rows × rowPitch.
  bar: { cls: 'row-driven', defaultStep: 'std' },
  bartable: { cls: 'row-driven', defaultStep: 'std' },
  dot: { cls: 'row-driven', defaultStep: 'std' },
  likert: { cls: 'row-driven', defaultStep: 'std' },
  butterfly: { cls: 'row-driven', defaultStep: 'std' },
  pyramid: { cls: 'row-driven', defaultStep: 'std' },
  gantt: { cls: 'row-driven', defaultStep: 'std' },
  // matrix
  heatmap: { cls: 'matrix', defaultStep: 'tall' },
  status: { cls: 'matrix', defaultStep: 'tall' },
  cohort: { cls: 'matrix', defaultStep: 'tall' },
  table: { cls: 'matrix', defaultStep: 'tall' },
  grid: { cls: 'matrix', defaultStep: 'tall' },
  // tall — the centered funnel silhouette (the
  // engine-default stacked-row variant resolves to row-driven below).
  funnel: { cls: 'tall', defaultStep: 'tall' },
  // geo-free — both 1.78 and 1.33 permitted without counting as deviation;
  // the deterministic default is h.std.
  choropleth: { cls: 'geo-free', defaultStep: 'std' },
  tilemap: { cls: 'geo-free', defaultStep: 'std' },
  diagram: { cls: 'geo-free', defaultStep: 'std' },
};

/** The panel metadata a grid geometry carries (GridMarks, structurally). */
interface PanelMarks {
  panels?: { type?: string; content?: { y: number } }[];
}

/**
 * Class of a chart AS AUTHORED. Two compositions resolve past the static
 * table:
 *  - funnel (two faces): `variant:'centered'` is the tall silhouette,
 *    everything else is the stacked-row variant — row-driven;
 *  - grid: the strip class is a composition step — several cards authored
 *    into ONE canvas row (a KPI strip). A grid whose panels are ALL card-class types sitting on one
 *    row IS that composition (a KPI strip) and is judged on the
 *    4.50 strip cap; every other grid stays matrix.
 * `marks` is the laid-out geometry's marks object, when the caller has one —
 * without it a grid conservatively stays matrix.
 */
export function aspectClassFor(
  type: string,
  options?: Record<string, unknown>,
  marks?: unknown,
): AspectClass | null {
  const profile = TYPE_ASPECT_PROFILE[type];
  if (!profile) return null;
  if (type === 'funnel') return options?.variant === 'centered' ? 'tall' : 'row-driven';
  // A compact bullet is a mark inside a host's cell, as a sparkline is: no canvas proportion to judge.
  if (type === 'bullet' && options?.density === 'compact') return null;
  if (type === 'grid') {
    const panels = (marks as PanelMarks | undefined)?.panels;
    if (
      Array.isArray(panels) &&
      panels.length > 0 &&
      panels.every((p) => TYPE_ASPECT_PROFILE[p.type ?? '']?.cls === 'card') &&
      panels.every((p) => p.content?.y !== undefined && p.content.y === panels[0]!.content?.y)
    ) {
      return 'strip';
    }
  }
  return profile.cls;
}
