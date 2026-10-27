/**
 * Color utilities: parsing, luminance, and automatic contrast ink selection
 * for labels rendered inside filled shapes.
 */

import { literalColor, SAFE_COLOR_KEYWORDS } from './colorLiteral';
export { SAFE_COLOR_KEYWORDS } from './colorLiteral';

interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * The opaque RGB of every colour form the SVG writer accepts (svg/paint.ts):
 * a keyword, #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba() with numbers
 * or percentages, hsl(), oklch(), and var() with a required literal fallback.
 * New forms use the same clipped sRGB bytes as the renderer. Alpha is ignored.
 * `transparent` and unsupported forms are null.
 * 'black', '#000000cc' and 'rgb(0%,0%,0%)' parse here: a null would send a
 * label on such a fill to the fallback dark ink, dark on near-black.
 */
export function parseColor(color: string): Readonly<RGB> | null {
  // Contrast and tint walks parse the same few theme colours many times per layout.
  // The result is a pure function of the string; callers only read it, so it is shared frozen.
  let parsed = parsedColors.get(color);
  if (parsed === undefined) {
    parsed = parseColorText(color);
    if (parsed) Object.freeze(parsed);
    if (parsedColors.size >= 4096) parsedColors.clear();
    parsedColors.set(color, parsed);
  }
  return parsed;
}

const parsedColors = new Map<string, Readonly<RGB> | null>();

/** Composite an accepted alpha colour over an opaque ground; opaque colours keep their spelling. */
export function compositeColor(color: string, background: string): string {
  color = literalColor(color) ?? color;
  const value = color.trim().toLowerCase();
  if (value === 'transparent') return background;
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const alpha = hex.length === 4 ? hex[3]!.repeat(2) : hex.slice(6);
    return mixColors(color, background, parseInt(alpha, 16) / 255);
  }
  const alpha = /^rgba?\([^,]+,[^,]+,[^,]+,([^)]+)\)$/i.exec(value)?.[1]?.trim();
  return alpha === undefined ? color
    : mixColors(color, background, alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha));
}

function parseColorText(color: string): RGB | null {
  const literal = literalColor(color);
  if (literal === null) return null;
  let value = literal.toLowerCase();
  if (Object.hasOwn(SAFE_COLOR_KEYWORDS, value)) value = SAFE_COLOR_KEYWORDS[value]!;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const rgb = hex.length <= 4 ? hex.slice(0, 3).replace(/./g, '$&$&') : hex.slice(0, 6);
    const v = parseInt(rgb, 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value)?.[1];
  if (!fn) return null;
  const channels = fn.split(',').slice(0, 3).map((raw) => {
    const token = raw.trim();
    return Math.round(token.endsWith('%') ? Number(token.slice(0, -1)) * 2.55 : Number(token));
  });
  if (channels.length < 3 || !channels.every(Number.isFinite)) return null;
  return { r: channels[0]!, g: channels[1]!, b: channels[2]! };
}

function linearChannel(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// RGB bytes repeat through the contrast walks. Keep their exact arithmetic in
// a fixed table; fractional/out-of-range channels and signed zero keep the formula.
const LINEAR_BYTES = Array.from({ length: 256 }, (_, channel) => linearChannel(channel));
function channelLuminance(channel: number): number {
  return Number.isInteger(channel) && channel > 0 && channel < 256 ? LINEAR_BYTES[channel]! : linearChannel(channel);
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(rgb: RGB): number {
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

/**
 * APCA lightness contrast |Lc| (0..106) of `fg` on `bg`, after the W3C APCA
 * 0.0.98G-4g constants. Unlike the WCAG ratio it falls at low luminance, so
 * a wash that reads on a white page and one that matches its ratio on a dark
 * page are told apart: the dark one reads dimmer, as it looks.
 */
export function apcaContrast(fg: string, bg: string): number {
  const cf = parseColor(fg);
  const cb = parseColor(bg);
  if (!cf || !cb) return 0;
  const y = ({ r, g, b }: RGB) => 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
  const clamp = (v: number) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const text = clamp(y(cf));
  const ground = clamp(y(cb));
  const sapc = ground > text ? (ground ** 0.56 - text ** 0.57) * 1.14 : (ground ** 0.65 - text ** 0.62) * 1.14;
  return Math.abs(sapc) < 0.1 ? 0 : (Math.abs(sapc) - 0.027) * 100;
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * How much better the SECONDARY ink must be before it displaces the primary.
 *
 * A bare argmax flips at the tone where both inks measure the same — on a
 * sequential ramp that crossover lands mid-scale, where BOTH inks are at
 * their worst (≈3.8:1 for a near-black/white pair) and two cells a reader
 * sees as equal-toned straddle it: `heatmap` printed 9.6 in white at the
 * crossover while 9.4 one tone lighter got dark ink. With the margin, the
 * secondary ink wins only where it is clearly better — for a near-black
 * primary that boundary sits where white reaches ≈4.3:1, so the flip
 * happens between tones that also LOOK different. Callers pass the theme's
 * primary reading ink first (`solver.ts` passes `theme.color.ink`), so
 * near-ties resolve to the ink every label around the plot already uses.
 */
const INK_PREFERENCE_MARGIN = 1.25;

/**
 * Pick a readable ink for text on the given fill. `darkInk` is the caller's
 * PRIMARY ink (the theme's railed reading ink — light-colored on dark
 * presets, the parameter names keep their historical shape); it wins unless
 * `lightInk` beats it by `INK_PREFERENCE_MARGIN`. One rule outranks the
 * margin: when exactly one candidate clears WCAG AA (4.5:1), that candidate
 * is chosen — the preference must never keep a failing ink while rejecting a
 * passing one (with the bare margin, a fill where the primary reads 4.0:1
 * and the secondary 4.6:1 would have kept the failing primary). Unknown
 * fills fall back to the primary ink.
 */
export function pickInk(fill: string, darkInk = '#111827', lightInk = '#ffffff'): string {
  const rgb = parseColor(fill);
  if (!rgb) return darkInk;
  const primary = contrastRatio(fill, darkInk);
  const secondary = contrastRatio(fill, lightInk);
  if (primary >= 4.5 !== secondary >= 4.5) return primary >= 4.5 ? darkInk : lightInk;
  return secondary >= primary * INK_PREFERENCE_MARGIN ? lightInk : darkInk;
}

/**
 * The default on-fill inks for text on a fill, the values of
 * `color.onFillInk` and `color.onFillLightInk` where a theme sets none.
 * A mid-tone fill of relative luminance 0.15 to 0.29 keeps neither a navy
 * theme ink nor a near-white dark-theme ink at 4.5:1, while black or white
 * always reaches it on one side. #050505 is dark enough that it and white
 * together still reach 4.5:1 on every fill.
 */
const ON_FILL_INK = '#050505';
const ON_FILL_LIGHT_INK = '#FFFFFF';

/** A theme's on-fill pair, dark ink first; the defaults where it sets none. */
export function onFillInks(color: { onFillInk?: string; onFillLightInk?: string }): readonly [string, string] {
  return [color.onFillInk ?? ON_FILL_INK, color.onFillLightInk ?? ON_FILL_LIGHT_INK];
}

/**
 * The lowest contrast the better ink of an on-fill pair keeps over all
 * fills: on the fill whose luminance sits at the geometric mean of the two
 * inks' (L + 0.05), both read the square root of the pair's own contrast.
 * 4.5:1 on every fill therefore needs 20.25:1 between the two inks.
 */
export function onFillPairFloor(dark: string, light: string): number {
  return Math.sqrt(contrastRatio(dark, light));
}

/**
 * The fill relative luminances on which neither ink of a pair reaches
 * `floor`: above (Llight + 0.05) / floor - 0.05 the light ink falls
 * short, below floor * (Ldark + 0.05) - 0.05 the dark one does. Undefined
 * when the pair covers every fill or an ink does not parse.
 */
export function onFillGap(a: string, b: string, floor = 4.5): readonly [number, number] | undefined {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return undefined;
  const [dark, light] = [relativeLuminance(ca), relativeLuminance(cb)].sort((x, y) => x - y) as [number, number];
  const low = Math.max(0, (light + 0.05) / floor - 0.05);
  const high = Math.min(1, floor * (dark + 0.05) - 0.05);
  return low < high ? [low, high] : undefined;
}

/**
 * pickInk over the theme's two inks, then the dark or light on-fill ink
 * (the theme's `onFillInks`), whichever reads better, when neither theme
 * ink reaches 4.5:1 on the fill and it does better.
 */
export function pickOnFillInk(
  fill: string, primaryInk: string, secondaryInk: string,
  [darkInk, lightInk]: readonly [string, string] = [ON_FILL_INK, ON_FILL_LIGHT_INK],
): string {
  const ink = pickInk(fill, primaryInk, secondaryInk);
  if (!parseColor(fill) || contrastRatio(fill, ink) >= 4.5) return ink;
  const extreme = contrastRatio(fill, darkInk) >= contrastRatio(fill, lightInk) ? darkInk : lightInk;
  return contrastRatio(fill, extreme) > contrastRatio(fill, ink) ? extreme : ink;
}

/** Mix a color toward a background by `amount` (0..1) — used for de-emphasis. */
export function tint(color: string, amount: number, background = '#ffffff'): string {
  return mixColors(color, background, 1 - amount);
}

/** Linear RGB mix: `wa` weight on `a`, remainder on `b`. */
export function mixColors(a: string, b: string, wa: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const w = Math.max(0, Math.min(1, wa));
  const m = (x: number, y: number) => Math.round(x * w + y * (1 - w));
  return `#${[m(ca.r, cb.r), m(ca.g, cb.g), m(ca.b, cb.b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Hue in degrees (0–360) and saturation (0–1) of a colour, for semantic checks. */
export function hueSaturation(color: string): { hue: number; saturation: number } | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, saturation };
}

/**
 * A saturated red or orange: the hue family readers decode as loss or
 * alarm on a sign-coded chart, whatever the theme calls it.
 */
export function readsAsLoss(color: string): boolean {
  const hs = hueSaturation(color);
  return hs !== null && hs.saturation >= 0.35 && (hs.hue <= 45 || hs.hue >= 335);
}
