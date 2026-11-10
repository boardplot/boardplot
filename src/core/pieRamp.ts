import { contrastRatio, mixColors, tint } from './color';
import { oklabLightness, PALETTE_NORMAL_FLOOR, palettePerceptualDistance, swatchApart } from './themeRules';

/** The light-page mark floor (markVisibilityFloor), held by every slice tint on a light page. */
const PAGE_FLOOR = 1.4;
/** A dark page holds every fill to the 3:1 mark floor: below it a step sinks into the page. */
const DARK_PAGE_FLOOR = 3;
/** On a dark page the ramp starts at least this far from the page, so its steps have room above the floor. */
const DARK_PAGE_TOP = 7;

const isDarkPage = (background: string): boolean => contrastRatio(background, '#FFFFFF') > contrastRatio(background, '#000000');

/** The strongest step: the base, lifted toward white on a dark page until it reaches DARK_PAGE_TOP (at most 60%). */
function rampTop(base: string, background: string): string {
  if (!isDarkPage(background)) return base;
  for (let t = 0; t <= 0.6 + 1e-9; t += 0.01) {
    const lifted = t === 0 ? base : tint(base, t, '#FFFFFF');
    if (contrastRatio(lifted, background) >= DARK_PAGE_TOP) return lifted;
  }
  return tint(base, 0.6, '#FFFFFF');
}

/**
 * Keep the pie's ordered tint spacing when its theme colors change. The
 * palest step stops where it still meets the swatch floor against
 * `apartFrom`, the Others slice beside it: past that the last
 * named slice and Others read as one tint. Every step in between meets the
 * same floor, so the ramp steps over an Others colour it would pass through.
 *
 * With `quietest` (the default for a pie that draws Others) the named ramp
 * also ends above the Others colour: no named step has less contrast against
 * the background than Others, so Others is the quietest slice in either scheme.
 */
// shortcut: unbounded memo of a pure function; keys are theme colours and slice counts, a few per chart.
const ramps = new Map<string, { tints: number[]; distinguishableCount: number; base: string }>();
export function pieRamp(base: string, background: string, count: number, apartFrom?: string, quietest = false, pageFloor = true): {
  tints: number[];
  distinguishableCount: number;
  /** The colour the tints wash toward the page: the base, lifted on a dark page (rampTop). */
  base: string;
} {
  const key = `${base}|${background}|${count}|${apartFrom ?? ''}|${quietest}|${pageFloor}`;
  let ramp = ramps.get(key);
  if (!ramp) {
    const top = rampTop(base, background);
    ramps.set(key, ramp = { ...computePieRamp(top, background, count, apartFrom, quietest, pageFloor), base: top });
  }
  return { tints: [...ramp.tints], distinguishableCount: ramp.distinguishableCount, base: ramp.base };
}

function computePieRamp(base: string, background: string, count: number, apartFrom?: string, quietest = false, pageFloor = true): {
  tints: number[];
  distinguishableCount: number;
} {
  let maxTint = 0.82;
  // A page draws no slice outline by default (fillEdgesOff), so the palest step keeps the mark
  // floor against the page: past it a slice is the page. `pageFloor: false` (marks.contrastEdge,
  // which brings the outline back) keeps the full ramp.
  const floor = isDarkPage(background) ? DARK_PAGE_FLOOR : PAGE_FLOOR;
  while (pageFloor && maxTint > 0 && contrastRatio(tint(base, maxTint, background), background) < floor) maxTint = Math.max(0, maxTint - 0.01);
  const othersContrast = apartFrom === undefined ? 0 : contrastRatio(apartFrom, background);
  // An Others colour stronger than the first step leaves no room above it: keep the 'apart' ramp, so the slices stay different.
  if (quietest && contrastRatio(base, background) <= othersContrast) quietest = false;
  // A tint step is contrast-monotone (it mixes toward the page), so a step that passes keeps every darker step passing.
  const apart = (t: number) => {
    if (apartFrom === undefined) return true;
    const color = tint(base, t, background);
    return swatchApart(color, apartFrom) && (!quietest || contrastRatio(color, background) > othersContrast);
  };
  if (apartFrom !== undefined) {
    while (maxTint > 0 && !apart(maxTint)) maxTint = Math.max(0, maxTint - 0.01);
  }
  const tints = [0];
  while (tints.length < count) {
    const prev = tints[tints.length - 1]!;
    let next: number | null = null;
    for (let t = prev + 0.01; t <= maxTint + 1e-9; t += 0.01) {
      const previousColor = tint(base, prev, background);
      const candidateColor = tint(base, t, background);
      const previousL = oklabLightness(previousColor);
      const candidateL = oklabLightness(candidateColor);
      if (previousL !== null && candidateL !== null &&
          apart(t) &&
          Math.abs(candidateL - previousL) >= 0.1 &&
          contrastRatio(previousColor, candidateColor) >= 1.25) {
        next = t;
        break;
      }
    }
    if (next === null) break;
    tints.push(next);
  }
  const distinguishableCount = tints.length;
  if (distinguishableCount < count) {
    tints.length = 0;
    for (let i = 0; i < count; i++) {
      tints.push(count === 1 ? 0 : maxTint * (i / (count - 1)));
    }
    // Even spacing may land on the Others colour; then space the steps over the tints that stay apart from it.
    if (!tints.every((t) => apart(t))) {
      const allowed: number[] = [];
      for (let t = 0.01; t <= maxTint + 1e-9; t += 0.01) if (apart(t)) allowed.push(t);
      if (allowed.length >= count - 1) {
        for (let i = 1; i < count; i++) tints[i] = allowed[Math.round((i * (allowed.length - 1)) / (count - 1))]!;
      }
    }
  }
  return { tints, distinguishableCount };
}

/** How far a role step may run away from the page (toward black on a light page, white on a dark one) or toward it. */
const ROLE_SHADE_MAX = 0.7;
const ROLE_TINT_MAX = 0.85;
/** Neighbouring role steps stand at most this far apart (OKLab x100), so two series do not jump to the palest step. */
const ROLE_SPREAD_MAX = 14;

// shortcut: unbounded memo of a pure function; keys are theme colours and series counts, a few per chart.
const roleStepMemo = new Map<string, string[]>();

/**
 * The colours of `count` series that share one colour role. Every step clears
 * the mark floor against the page (1.4:1 for a fill on a light page, 3:1 on a
 * dark page and for a stroke, which draws a thin line or a small dot), and
 * every two steps meet the swatch floor (12 OKLab normal, the floor of
 * series-adjacent-similar). A fill step also stays that far from `others`,
 * the Others colour a chart may draw beside it (a waffle's rest, a topN
 * bucket). The set holds the role's colour and washes toward the page.
 * Where the page side has no room for them all, further steps run away from
 * it (a darker shade on a light page). Where both sides together have no
 * room, the steps spread over the visible range as far apart as it allows.
 * The steps come strongest first (most contrast against the page), so the
 * series of one role run one way, from series 1 to the last.
 */
export function roleSteps(base: string, background: string, count: number, stroke: boolean, others?: string): string[] {
  const key = `${base}|${background}|${count}|${stroke}|${others ?? ''}`;
  const known = roleStepMemo.get(key);
  if (known) return [...known];
  const dark = isDarkPage(background);
  const floor = stroke || dark ? DARK_PAGE_FLOOR : PAGE_FLOOR;
  const pole = dark ? '#FFFFFF' : '#000000';
  // A fill also stays a swatch step from the Others colour beside it (a waffle's rest, a topN bucket), unless the role is that colour.
  const keepApart = others !== undefined && swatchApart(base, others);
  // The visible stretch of the line from the far shade through the base to the page, at 0.01 steps.
  const line: string[] = [];
  let baseAt = -1;
  for (let i = -Math.round(ROLE_SHADE_MAX * 100); i <= Math.round(ROLE_TINT_MAX * 100); i++) {
    const color = i < 0 ? mixColors(base, pole, 1 + i / 100) : tint(base, i / 100, background);
    if (contrastRatio(color, background) < floor || (keepApart && !swatchApart(color, others))) continue;
    if (i <= 0) baseAt = line.length;
    line.push(color);
  }
  const apart = (a: string, b: string, gap: number) => palettePerceptualDistance(a, b, 'normal') >= gap && (gap < PALETTE_NORMAL_FLOOR || swatchApart(a, b));
  // Indices stepping from `from` by `dir`, each the first at least `gap` from the one before.
  const walk = (from: number, dir: 1 | -1, gap: number, want: number): number[] => {
    const found: number[] = [];
    for (let i = from + dir, prev = from; i >= 0 && i < line.length && found.length < want; i += dir) {
      if (apart(line[prev]!, line[i]!, gap)) found.push(prev = i);
    }
    return found;
  };
  let steps: number[] | undefined;
  // The base, or the visible shade nearest it, leads; fewest shades first, widest gap first.
  for (let shades = 0; !steps && baseAt >= 0 && shades < count; shades++) {
    for (let gap = ROLE_SPREAD_MAX; !steps && gap >= PALETTE_NORMAL_FLOOR; gap -= 0.5) {
      const up = walk(baseAt, -1, gap, shades);
      const down = walk(baseAt, 1, gap, count - 1 - shades);
      if (up.length === shades && down.length === count - 1 - shades) steps = [...up, baseAt, ...down];
    }
  }
  // No room at the floor: spread from the strongest visible step, as far apart as the range allows.
  for (let gap = PALETTE_NORMAL_FLOOR; !steps && line.length > 0 && gap > 0; gap -= 0.5) {
    const down = walk(0, 1, gap, count - 1);
    if (down.length === count - 1) steps = [0, ...down];
  }
  // More series than any gap holds: spread them evenly over the visible range, repeating only past its last colour.
  if (!steps && line.length > 0) steps = Array.from({ length: count }, (_, i) => Math.round(count === 1 ? 0 : (i * (line.length - 1)) / (count - 1)));
  // `line` runs from the strongest step to the page, so index order is strongest first.
  const colors = steps ? steps.sort((a, b) => a - b).map((i) => line[i]!) : Array.from({ length: count }, () => base);
  roleStepMemo.set(key, colors);
  return [...colors];
}

/**
 * The largest tint amount, at most `max`, whose colour stays apart from the
 * Others colour and keeps more contrast against the background than it. Zero
 * when no amount does.
 */
export function quietestTintCap(base: string, background: string, others: string, max: number): number {
  const othersContrast = contrastRatio(others, background);
  for (let t = max; t > 0; t = Math.max(0, t - 0.01)) {
    const color = tint(base, t, background);
    if (swatchApart(color, others) && contrastRatio(color, background) > othersContrast) return t;
  }
  return 0;
}
