/**
 * Bubble size key: rings in the key row above the plot, one entry
 * per keyed size, each ring at the radius a bubble of that size is drawn with
 * and labelled with its size. The key row grows to the largest ring.
 */

import type { LegendItemInput } from '../../frame';
import { formatAutomaticNumber } from '../../format';
import { MAX_FORMAT_DECIMALS, roundHalfUp } from '../../formatPrecision';
import type { Rect } from '../../geometry';
import { rectsOverlap } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import { strokeToken } from '../../theme';
import type { LintWarning, SceneNode } from '../../types/scene';
import type { ScatterEnv, ScatterPlotArea } from './model';

/**
 * The keyed sizes, largest first. Authored sizes draw at scale; one above
 * the largest bubble is left out with a warning, one below the smallest is
 * drawn and named in an info. Without
 * authored sizes, round sizes from the data range: the largest whose ring
 * fits the ceiling, and one half of it or less, none below the smallest
 * bubble. A range too narrow for two distinct round sizes keys one.
 */
function sizeKeyValues(env: ScatterEnv, sizeMin: number, sizeMax: number, fits: (size: number) => boolean, warnings: LintWarning[],
  /** Nested rings key a quarter of the large size, so the two rings read apart. */
  nested = false): number[] {
  const authored = typeof env.options.sizeLegend === 'object' ? env.options.sizeLegend.values : undefined;
  // The key row caps its rings, so a size it cannot draw at scale is left out.
  const kept = authored?.filter((value) => value <= sizeMax && fits(value)) ?? [];
  const above = authored?.filter((value) => value > sizeMax) ?? [];
  const tooLarge = authored?.filter((value) => value <= sizeMax && !fits(value)) ?? [];
  const below = kept.filter((value) => value < sizeMin);
  const are = (values: number[]) => `${values.join(', ')} ${values.length === 1 ? 'is' : 'are'}`;
  const warn = (severity: 'warn' | 'info', message: string, suggest: string): void => {
    warnings.push({ code: 'size-legend-value-out-of-range', severity, message, suggest, field: ['options', 'sizeLegend', 'values'] });
  };
  if (above.length) {
    warn('warn', `sizeLegend.values ${are(above)} above the largest bubble (${sizeMax}), so the key leaves ${above.length === 1 ? 'it' : 'them'} out${kept.length ? '' : ' and shows its default sizes'}`,
      `key sizes up to ${sizeMax}, or drop sizeLegend.values for the default`);
  }
  if (tooLarge.length) {
    const largestFit = roundBelow(sizeMax).find(fits);
    warn('warn', `sizeLegend.values ${are(tooLarge)} larger than the key row can draw at scale${largestFit === undefined ? '' : `; the largest round size it draws is ${largestFit}`}, so the key leaves ${tooLarge.length === 1 ? 'it' : 'them'} out${kept.length ? '' : ' and shows its default sizes'}`,
      largestFit === undefined ? 'drop sizeLegend.values for the default' : `key sizes up to ${largestFit}, or drop sizeLegend.values for the default`);
  }
  if (below.length) {
    warn('info', `sizeLegend.values ${are(below)} below the smallest bubble (${sizeMin}); the key draws ${below.length === 1 ? 'it' : 'them'} at scale`,
      `key sizes from ${sizeMin} to ${sizeMax} to show the bubbles' own range`);
  }
  if (kept.length) return [...kept].sort((a, b) => b - a);
  const inRange = roundBelow(sizeMax).filter((value) => value >= sizeMin);
  // A narrow range can contain no round size. The key then keys the
  // largest bubble itself.
  const large = inRange.find(fits) ?? sizeMax;
  const small = roundBelow(large / (nested ? 4 : 2)).find((value) => value >= sizeMin);
  return small !== undefined && small < large ? [large, small] : [large];
}

/**
 * Round sizes (one significant digit: 1 to 9 times a power of ten) at most
 * `v`, largest first. A narrow range such as 30 to 70 still holds two of
 * them (70 and 30).
 */
function roundBelow(v: number): number[] {
  const out: number[] = [];
  for (let power = 10 ** Math.floor(Math.log10(v)), k = 0; k < 8; k++, power /= 10) {
    for (let digit = 9; digit >= 1; digit--) if (digit * power <= v * (1 + 1e-9)) out.push(Number((digit * power).toPrecision(1)));
  }
  return out;
}

/** The key entries: one ring per keyed size, the size measure named on the first. */
export function sizeKeyItems(
  env: ScatterEnv,
  sizeMin: number,
  sizeMax: number,
  radiusOf: (size: number) => number,
  maxRadius: number,
  warnings: LintWarning[],
): LegendItemInput[] {
  const title = typeof env.options.sizeLegend === 'object' ? env.options.sizeLegend.label : undefined;
  const values = sizeKeyValues(env, sizeMin, sizeMax, (size) => radiusOf(size) <= maxRadius, warnings);
  // The size measure is named once, as a heading before the rings (scatter.matrix).
  const heading = title !== undefined;
  const rings = values.map((value, index): LegendItemInput => {
    // A reference value is a scale anchor: 0.25 must not read as 0.3.
    let decimals = 0;
    while (decimals < MAX_FORMAT_DECIMALS && Math.abs(Number(roundHalfUp(value, decimals)) - value) > value * 1e-12) decimals++;
    const text = formatAutomaticNumber(value, { locale: env.options.locale?.language, decimals });
    return {
      id: `size:${index}`,
      label: index === 0 && title && !heading ? `${title}: ${text}` : text,
      paint: { token: 'inkMuted' },
      key: 'sizes',
      radii: [radiusOf(value)],
    };
  });
  return heading ? [{ id: 'size:title', label: title!, paint: { token: 'ink' }, key: 'heading' }, ...rings] : rings;
}

/** Room between the in-plot key and the plot edge, and around the key for the free check. */
const KEY_INSET = 4;
/** A tick runs from the ring's top this far past the large ring, then the value. */
const KEY_TICK_PAST = 8;
const KEY_TEXT_GAP = 3;

/** The nested size key drawn inside the plot: its nodes and the rects it takes (the rings, the measure). */
export interface PlotSizeKey {
  nodes: SceneNode[];
  rects: Rect[];
}

function keyText(env: ScatterEnv, value: number): string {
  let decimals = 0;
  while (decimals < MAX_FORMAT_DECIMALS && Math.abs(Number(roundHalfUp(value, decimals)) - value) > value * 1e-12) decimals++;
  return formatAutomaticNumber(value, { locale: env.options.locale?.language, decimals });
}

/**
 * The size key as two nested rings at plot scale in a
 * free plot corner, bottom right first. The rings share their lowest point;
 * a tick from each ring's top leads to its value, and the size measure sits
 * above them. A corner is free when no bubble, no reference line and no zero
 * line meets the rings; a horizontal rule between the rings and the measure
 * lifts the measure over it. Undefined when no corner is free: the key then
 * goes to the key row.
 */
export function plotSizeKey(
  env: ScatterEnv,
  area: ScatterPlotArea,
  sizeMin: number,
  sizeMax: number,
  claims: OccupiedIndex,
  warnings: LintWarning[],
  boxes: Rect[] = [],
): PlotSizeKey | undefined {
  const { plot, fonts } = area;
  const values = sizeKeyValues(env, sizeMin, sizeMax, () => true, warnings, true);
  const radii = values.map((size) => area.radiusOf({ size }));
  const R = Math.max(...radii);
  const texts = values.map((value) => keyText(env, value));
  const font = fonts.tick;
  const textW = Math.max(...texts.map((text) => env.measure(text, font).width));
  const textH = env.measure('0', font).height;
  const title = typeof env.options.sizeLegend === 'object' ? env.options.sizeLegend.label : undefined;
  const titleSize = title ? env.measure(title, font) : { width: 0, height: 0 };
  const ringsW = 2 * R + KEY_TICK_PAST + KEY_TEXT_GAP + textW;
  // The rings block: both rings, their ticks and values; the large value rises half a line over the ring.
  const ringsH = textH / 2 + 2 * R;
  const titleGap = 3;
  const w = Math.max(ringsW, titleSize.width);
  // A plot corner may take up to half the plot each way; a 2x2 box is checked against the box itself.
  if (!boxes.length && (w + 2 * KEY_INSET > plot.w / 2 || ringsH + titleSize.height + titleGap + 2 * KEY_INSET > plot.h / 2)) return undefined;
  const snapshot = claims.snapshot();
  const rule = (c: (typeof snapshot)[number]) => c.kind === 'annotation' || c.part === 'referenceLine' || c.part === 'quadrantDivider';
  const blocked = snapshot.filter((c) => c.kind === 'mark' || rule(c));
  const free = (box: Rect) => !blocked.some((c) => rectsOverlap(c.rect, { x: box.x - KEY_INSET, y: box.y - KEY_INSET, w: box.w + 2 * KEY_INSET, h: box.h + 2 * KEY_INSET }));
  type Placed = { rings: Rect; title?: Rect };
  const place = (side: 'left' | 'right', edge: 'top' | 'bottom', region: Rect = plot): Placed | undefined => {
    if (region !== plot && (w + 2 * KEY_INSET > region.w || ringsH + titleSize.height + titleGap + 2 * KEY_INSET > region.h)) return undefined;
    const r = side === 'right' ? region.x + region.w - KEY_INSET : region.x + KEY_INSET + w;
    const ringsTop = edge === 'bottom' ? region.y + region.h - KEY_INSET - ringsH : region.y + KEY_INSET + (title ? titleSize.height + titleGap : 0);
    let rings: Rect = { x: r - ringsW, y: ringsTop, w: ringsW, h: ringsH };
    // A bottom key that meets a horizontal rule (the zero line close over
    // the axis) moves up over the rule, as long as it stays in the plot's lower half.
    for (let tries = 0; tries < 2 && edge === 'bottom'; tries++) {
      const hit = blocked.find((c) => rule(c) && c.rect.w > c.rect.h && rectsOverlap(c.rect, { x: rings.x - KEY_INSET, y: rings.y - KEY_INSET, w: rings.w + 2 * KEY_INSET, h: rings.h + 2 * KEY_INSET }));
      if (!hit) break;
      const y = hit.rect.y - KEY_INSET - ringsH - 0.5;
      if (y < region.y + region.h / 2) return undefined;
      rings = { ...rings, y };
    }
    if (!free(rings)) return undefined;
    const ringsTopAt = rings.y;
    if (!title) return { rings };
    // The title sits over the rings, right-aligned with them. A horizontal
    // rule between them (the zero line just over the rings) lifts the title
    // over the rule.
    let box: Rect = { x: r - titleSize.width, y: ringsTopAt - titleGap - titleSize.height, w: titleSize.width, h: titleSize.height };
    for (let tries = 0; tries < 3 && box.y >= region.y; tries++) {
      const hit = blocked.find((c) => rectsOverlap(c.rect, { x: box.x - KEY_INSET, y: box.y - KEY_INSET, w: box.w + 2 * KEY_INSET, h: box.h + 2 * KEY_INSET }));
        if (!hit) return { rings, title: box };
      if (!rule(hit) || hit.rect.w < hit.rect.h || edge === 'top') return undefined;
      box = { ...box, y: hit.rect.y - KEY_INSET - titleSize.height - 0.5 };
    }
    return undefined;
  };
  // On a 2x2 the key keeps inside one box, on the box's outer side, below its
  // caption (scatter.quadrants: lower right of the Stars box).
  const inBox = boxes.reduce<Placed | undefined>((found, box) => found ?? place(box.x + box.w / 2 >= plot.x + plot.w / 2 ? 'right' : 'left', 'bottom', box), undefined);
  const at = boxes.length ? inBox : place('right', 'bottom') ?? place('right', 'top') ?? place('left', 'top') ?? place('left', 'bottom');
  if (!at) return undefined;
  const ringsRight = at.rings.x + ringsW;
  const cx = ringsRight - ringsW + R;
  const bottom = at.rings.y + ringsH;
  const owner = {};
  const nodes: SceneNode[] = [];
  if (title && at.title) {
    nodes.push({ t: 'text', id: 'sizeKey:title', x: at.title.x + at.title.w, y: at.title.y, lines: [title], align: 'end', typeRole: 'axis', role: 'caption', font, ink: { token: 'inkMuted' }, owner, part: 'sizeKeyTitle' });
  }
  radii.forEach((r, i) => {
    nodes.push({ t: 'circle', id: `sizeKey:ring:${i}`, cx, cy: bottom - r, r, fill: { token: 'background' }, stroke: { token: 'inkMuted' }, strokeWidth: strokeToken(env.theme, 'rule'), owner, part: 'sizeKeyRing' });
  });
  radii.forEach((r, i) => {
    const top = bottom - 2 * r;
    const tickEnd = cx + R + KEY_TICK_PAST;
    nodes.push({ t: 'line', id: `sizeKey:tick:${i}`, x1: cx, y1: top, x2: tickEnd, y2: top, stroke: { token: 'inkMuted' }, width: strokeToken(env.theme, 'hair'), owner, part: 'sizeKeyTick' });
    nodes.push({ t: 'text', id: `sizeKey:value:${i}`, x: tickEnd + KEY_TEXT_GAP, y: top - textH / 2, lines: [texts[i]!], align: 'start', typeRole: 'axis', font, ink: { token: 'inkMuted' }, owner, part: 'sizeKeyValue' });
  });
  const rects = [at.rings, ...(at.title ? [at.title] : [])];
  return { nodes, rects };
}
