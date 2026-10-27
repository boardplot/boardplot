/** Colour syntax shared by contrast math and the SVG/HTML paint boundary. */
export const SAFE_COLOR_KEYWORDS: Readonly<Record<string, string>> = {
  transparent: 'transparent',
  black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080',
  red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a',
};

export const COLOR_FIX = 'Use a literal hex, rgb(), hsl() or oklch() colour, or var(--token, <literal fallback>); page variables are not read.';
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const cache = new Map<string, string | null>();
const clamp = (n: number, max = 1) => Math.max(0, Math.min(max, n));
const number = (s: string) => NUMBER.test(s) ? Number(s) : NaN;
const component = (s: string, percent = 1): number => s === 'none' ? 0
  : s.endsWith('%') ? number(s.slice(0, -1)) * percent / 100 : number(s);
function hue(s: string): number {
  if (s === 'none') return 0;
  const match = /^(.*?)(deg|grad|rad|turn)?$/.exec(s)!;
  const n = number(match[1]!) * ({ deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[match[2] ?? 'deg']!);
  return ((n % 360) + 360) % 360;
}

/** Legacy spellings stay byte-identical. New forms become one fixed sRGB colour, never live CSS. */
export function literalColor(input: string): string | null {
  const known = cache.get(input);
  if (known !== undefined) return known;
  const result = parseLiteral(input.trim(), 0);
  if (cache.size >= 4096) cache.clear();
  cache.set(input, result);
  return result;
}

function parseLiteral(value: string, depth: number): string | null {
  if (value.length > 1024 || depth > 8) return null;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) || Object.hasOwn(SAFE_COLOR_KEYWORDS, value.toLowerCase())) return value;
  const variable = /^var\(\s*--[a-z_][a-z0-9_-]*\s*,\s*(.+)\)$/i.exec(value);
  if (variable) return parseLiteral(variable[1]!.trim(), depth + 1);
  const match = /^(rgb|rgba|hsl|hsla|oklch)\(([^()]+)\)$/i.exec(value);
  if (!match) return null;
  const fn = match[1]!.toLowerCase();
  const body = match[2]!.trim().toLowerCase();
  const comma = body.includes(',');
  if (comma && (fn === 'oklch' || body.includes('/'))) return null;
  const parts = comma ? body.split(',').map(s => s.trim()) : body.split(/\s*\/\s*/);
  const channels = comma ? parts.slice(0, 3) : parts[0]!.split(/\s+/);
  if (channels.length !== 3 || (comma ? parts.length < 3 || parts.length > 4 : parts.length > 2)) return null;
  const alphaText = comma ? parts[3] : parts[1];
  const alpha = alphaText === undefined ? 1 : component(alphaText);
  if (!Number.isFinite(alpha)) return null;
  let rgb: number[];
  if (fn.startsWith('rgb')) {
    rgb = channels.map(s => component(s, 255));
    if (!rgb.every(Number.isFinite)) return null;
    // Keep comma spelling for existing SVG bytes. rgb and rgba are aliases.
    if (comma) {
      if (channels.includes('none') || alphaText === 'none' ||
        rgb.some(n => !Number.isFinite(n) || n < 0 || n > 255) || alpha < 0 || alpha > 1) return null;
      return value;
    }
    rgb = rgb.map(n => clamp(n, 255));
  } else if (fn.startsWith('hsl')) {
    if (comma && (channels.includes('none') || alphaText === 'none')) return null;
    const h = hue(channels[0]!);
    if (!channels.slice(1).every(s => s.endsWith('%') || (!comma && s === 'none'))) return null;
    const saturation = component(channels[1]!), lightness = component(channels[2]!);
    if (![h, saturation, lightness].every(Number.isFinite)) return null;
    const s = clamp(saturation);
    const l = clamp(lightness);
    const a = s * Math.min(l, 1 - l);
    rgb = [0, 8, 4].map(n => {
      const k = (n + h / 30) % 12;
      return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    });
  } else {
    const lightness = component(channels[0]!);
    if (!Number.isFinite(lightness)) return null;
    const l = clamp(lightness);
    const c = Math.max(0, component(channels[1]!, 0.4));
    const h = hue(channels[2]!) * Math.PI / 180;
    if (![l, c, h].every(Number.isFinite)) return null;
    const a = c * Math.cos(h), b = c * Math.sin(h);
    // CSS Color 4 (2026-10-22), https://www.w3.org/TR/css-color-4/#color-conversion-code
    // OKLab -> LMS -> linear sRGB.
    // Clip each linear channel to [0,1], then encode and round to 8-bit sRGB.
    const x = (l + 0.3963377773761749 * a + 0.2158037573099136 * b) ** 3;
    const y = (l - 0.1055613458156586 * a - 0.0638541728258133 * b) ** 3;
    const z = (l - 0.0894841775298119 * a - 1.2914855480194092 * b) ** 3;
    const linear = l === 0 || l === 1 ? [l, l, l] : [
      4.076741661347994 * x - 3.307711590408193 * y + 0.230969929060199 * z,
      -1.2684380040921763 * x + 2.6097574006633715 * y - 0.3413193965711952 * z,
      -0.0041960865418371 * x - 0.7034186144594493 * y + 1.7076147010012864 * z,
    ];
    if (!linear.every(Number.isFinite)) return null;
    rgb = linear.map(n => {
      const v = clamp(n);
      return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    });
  }
  if (!rgb.every(Number.isFinite)) return null;
  const bytes = rgb.map(n => Math.round(n));
  return clamp(alpha) === 1 ? `#${bytes.map(n => n.toString(16).padStart(2, '0')).join('')}`
    : `rgba(${bytes.join(',')},${clamp(alpha)})`;
}
