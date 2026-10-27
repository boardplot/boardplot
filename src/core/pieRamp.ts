import { contrastRatio, tint } from './color';
import { oklabLightness, swatchApart } from './themeRules';

/** The light-page mark floor (markVisibilityFloor), held by every slice tint on either page kind. */
const PAGE_FLOOR = 1.4;

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
const ramps = new Map<string, { tints: number[]; distinguishableCount: number }>();
export function pieRamp(base: string, background: string, count: number, apartFrom?: string, quietest = false, pageFloor = true): {
  tints: number[];
  distinguishableCount: number;
} {
  const key = `${base}|${background}|${count}|${apartFrom ?? ''}|${quietest}|${pageFloor}`;
  let ramp = ramps.get(key);
  if (!ramp) ramps.set(key, ramp = computePieRamp(base, background, count, apartFrom, quietest, pageFloor));
  return { tints: [...ramp.tints], distinguishableCount: ramp.distinguishableCount };
}

function computePieRamp(base: string, background: string, count: number, apartFrom?: string, quietest = false, pageFloor = true): {
  tints: number[];
  distinguishableCount: number;
} {
  let maxTint = 0.82;
  // A page draws no slice outline by default (fillEdgesOff), so the palest step keeps the mark
  // floor against the page: past it a slice is the page. `pageFloor: false` (marks.contrastEdge,
  // which brings the outline back) keeps the full ramp.
  while (pageFloor && maxTint > 0 && contrastRatio(tint(base, maxTint, background), background) < PAGE_FLOOR) maxTint = Math.max(0, maxTint - 0.01);
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
