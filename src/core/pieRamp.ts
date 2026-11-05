import { contrastRatio, tint } from './color';
import { oklabLightness, swatchApart } from './themeRules';

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
