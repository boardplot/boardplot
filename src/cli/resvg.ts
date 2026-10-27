/**
 * PNG without a browser through @resvg/resvg-js, an optional dependency
 *. It is loaded at run time, so the package, the plugin
 * and every bundle work without it; `loadResvg` answers null when it is not
 * installed or has no binary for this platform.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FontkitFont } from 'fontkit';
import { resolveFace } from '../core/fontMetrics';
import { GLYPH_FALLBACK_FAMILIES } from '../core/fontMetrics/tables.generated';

/** The part of @resvg/resvg-js this module uses; declared here so no type import needs the package. */
interface ResvgModule {
  Resvg: new (svg: string, options?: {
    fitTo?: { mode: 'width'; value: number };
    font?: { loadSystemFonts?: boolean; defaultFontFamily?: string; sansSerifFamily?: string };
  }) => { render(): { asPng(): Buffer } };
}

let loaded: ResvgModule | null | undefined;

/**
 * fontkit is a 1.9 MB chunk, and only a PNG reads raster faces, so the CLI and the MCP
 * server load it before a call that can draw a PNG (`loadRasterFonts`). A checkout that
 * has fontkit installed (tests, scripts) also finds it on first use.
 */
let fontkit: typeof import('fontkit') | undefined;

export async function loadRasterFonts(): Promise<void> {
  fontkit ??= await import('fontkit');
}

function rasterFontkit(): typeof import('fontkit') | undefined {
  if (!fontkit) {
    try {
      fontkit = createRequire(import.meta.url)('fontkit') as typeof import('fontkit');
    } catch {
      return undefined;
    }
  }
  return fontkit;
}

export function loadResvg(): ResvgModule | null {
  if (loaded !== undefined) return loaded;
  try {
    loaded = createRequire(import.meta.url)('@resvg/resvg-js') as ResvgModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** The families of a CSS font stack, in order, without quotes. */
function stackFamilies(stack: string): string[] {
  return stack.split(',').map((family) => family.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** The first family of a CSS font stack, without quotes: the one the theme asks for. */
export function primaryFamily(stack: string): string {
  return stackFamilies(stack)[0] ?? '';
}

/** Open faces a Linux host usually has, tried after the theme's own stack. */
const FALLBACK_FAMILIES = ['Liberation Sans', 'Arimo', 'Nimbus Sans', 'DejaVu Sans', 'Noto Sans'];

/**
 * The font families fontconfig lists, lower-cased; null off Linux, where the
 * system fonts a browser uses are present and resvg finds them. A Linux host
 * without fc-list counts as having none: a PNG without text is the failure
 * this check exists to stop.
 */
export function installedFamilies(): Set<string> | null {
  if (process.platform !== 'linux') return null;
  try {
    const listed = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(listed.split(/[\n,]/).map((family) => family.trim().toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** System symbol faces resvg loads cover all six arrows used in engine text. */
export function hasArrowFallback(installed: Set<string> | null): boolean {
  if (installed) return installed.has('dejavu sans') || installed.has('noto sans symbols 2');
  if (process.platform === 'darwin') return existsSync('/System/Library/Fonts/Apple Symbols.ttf');
  return process.platform === 'win32' && existsSync(join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'seguisym.ttf'));
}

/**
 * The family resvg falls back to: the first family of the theme stack that is
 * installed, else the first installed of FALLBACK_FAMILIES; null when none is.
 * resvg took the stack's first family unchecked, and on a Linux host without
 * it drew with whatever face came first (Courier) or with none.
 * Without a family list (`installed` null) the stack's first family stands.
 */
export function rasterFamily(stack: string, installed: Set<string> | null): string | null {
  if (!installed) return primaryFamily(stack);
  return [...stackFamilies(stack), ...FALLBACK_FAMILIES].find((family) => installed.has(family.toLowerCase())) ?? null;
}

/** A known installed face for a borrowed glyph; a stored width alone is not coverage. */
export function glyphFallbackFamily(codePoint: number, installed: Set<string> | null): string | null {
  const family = GLYPH_FALLBACK_FAMILIES[codePoint];
  if (!family) return null;
  if (installed) return installed.has(family.toLowerCase()) ? family : null;
  if (process.platform === 'darwin') {
    const file = family === 'Arial' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/System/Library/Fonts/Supplemental/STIXGeneral.otf';
    return existsSync(file) ? family : null;
  }
  if (process.platform === 'win32' && family === 'Arial') {
    return existsSync(join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'arial.ttf')) ? family : null;
  }
  return null;
}

/** Read the actual raster face; an unverified family keeps the old fallback path. */
function rasterFont(family: string, weight: number): FontkitFont | undefined {
  // STIX has 400/700 only; CSS weights above 500 select its bold face.
  if (family === 'STIXGeneral') weight = weight > 500 ? 700 : 400;
  let file: string | undefined;
  try {
    if (process.platform === 'darwin') {
      file = ({
        'Helvetica Neue': '/System/Library/Fonts/HelveticaNeue.ttc',
        Helvetica: '/System/Library/Fonts/Helvetica.ttc',
        Arial: `/System/Library/Fonts/Supplemental/Arial${weight >= 700 ? ' Bold' : ''}.ttf`,
        STIXGeneral: `/System/Library/Fonts/Supplemental/STIXGeneral${weight >= 700 ? 'Bol' : ''}.otf`,
      } as Record<string, string>)[family];
    } else if (process.platform === 'win32' && family === 'Arial') {
      file = join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', weight >= 700 ? 'arialbd.ttf' : 'arial.ttf');
    } else if (process.platform === 'linux') {
      file = execFileSync('fc-match', ['-f', '%{file}', `${family}:weight=${weight >= 700 ? 'bold' : weight >= 500 ? 'medium' : 'regular'}`],
        { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    }
    if (!file || !existsSync(file)) return undefined;
    const reader = rasterFontkit();
    if (!reader) return undefined;
    const opened = reader.openSync(file);
    const faces = ('fonts' in opened ? opened.fonts : [opened]).filter(font =>
      font.familyName.toLowerCase() === family.toLowerCase() && !/italic|oblique/i.test(font.subfamilyName));
    return faces.find(font => font['OS/2']?.usWeightClass === weight);
  } catch {
    return undefined;
  }
}

/** Only the engine's flat text/tspan form is rewritten; exported SVG stays untouched. */
function isolateFallbackGlyphs(svg: string, defaultFamily: string): string {
  const attr = (attrs: string, name: string) => attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
  const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#9|#10|#13);/g, (_, entity: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", "#9": ' ', "#10": ' ', "#13": ' ' })[entity]!);
  const rootFamily = decode(attr(svg.match(/<svg\b([^>]*)>/)?.[1] ?? '', 'font-family') ?? defaultFamily);
  const installed = installedFamilies();
  const fonts = new Map<string, FontkitFont | undefined>();
  const fontFor = (family: string, weight: number) => {
    const key = `${family}|${weight}`;
    if (!fonts.has(key)) fonts.set(key, rasterFont(family, weight));
    return fonts.get(key);
  };
  return svg.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (original, attrs: string, body: string) => {
    const title = body.match(/^<title>[\s\S]*?<\/title>/)?.[0] ?? '';
    const content = body.slice(title.length);
    const spans = [...content.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>/g)];
    if (spans.length ? spans.map(span => span[0]).join('') !== content : content.includes('<')) return original;
    const family = decode(attr(attrs, 'font-family') ?? rootFamily);
    const size = Number(attr(attrs, 'font-size'));
    const weight = Number(attr(attrs, 'font-weight') ?? 400);
    const spacing = Number(attr(attrs, 'letter-spacing') ?? 0);
    if (!Number.isFinite(size) || !size) return original;
    const runs = (spans.length ? spans.map(span => ({ attrs: span[1]!, raw: span[2]! })) : [{ attrs: '', raw: content }])
      .map(run => ({ ...run, face: resolveFace(decode(attr(run.attrs, 'font-family') ?? family), Number(attr(run.attrs, 'font-weight') ?? weight)) }));
    if (!runs.some(run => [...decode(run.raw)].some(ch => run.face?.borrowed?.has(ch.codePointAt(0)!)))) return original;
    // Preserve-space and inherited styles need a full SVG cascade; leave those to resvg.
    if (/xml:space="preserve"/.test(svg) || attr(attrs, 'font-style') || runs.some(run => attr(run.attrs, 'font-style'))) return original;
    let previousSpace = true;
    for (const run of runs) {
      let text = decode(run.raw).replace(/[ \t\r\n]+/g, ' ');
      if (previousSpace) text = text.replace(/^ /, '');
      if (text) previousSpace = text.endsWith(' ');
      run.raw = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i]!.raw) { runs[i]!.raw = runs[i]!.raw.replace(/ $/, ''); break; }
    }
    // Explicit x starts a line; styled runs without x stay on the same line.
    const lines: typeof runs[] = [];
    for (const run of runs) {
      if (!lines.length || attr(run.attrs, 'x') !== undefined) lines.push([]);
      lines[lines.length - 1]!.push(run);
    }
    let isolated = false;
    const changed = lines.map(line => {
      if (!line.some(run => [...decode(run.raw)].some(ch => run.face?.borrowed?.has(ch.codePointAt(0)!)))) {
        return line.map(run => `<tspan${run.attrs}>${run.raw}</tspan>`).join('');
      }
      // shortcut: only verified raster faces are split; add host font paths when more families need isolation.
      if (line.some(run => !run.face || primaryFamily(decode(attr(run.attrs, 'font-family') ?? family)).toLowerCase() !== run.face.family.toLowerCase() ||
        !fontFor(run.face.family, Number(attr(run.attrs, 'font-weight') ?? weight)) ||
        [...decode(run.raw)].some(ch => run.face?.borrowed?.has(ch.codePointAt(0)!) && !glyphFallbackFamily(ch.codePointAt(0)!, installed)))) {
        return line.map(run => `<tspan${run.attrs}>${run.raw}</tspan>`).join('');
      }
      const chunks: { attrs: string; raw: string; width: number; family?: string }[] = [];
      for (const run of line) {
        const runWeight = Number(attr(run.attrs, 'font-weight') ?? weight);
        const firstChunk = chunks.length;
        const runAttrs = run.attrs.replace(/\s(?:x|y|dy)="[^"]*"/g, '');
        let chunk: (typeof chunks)[number] | undefined;
        for (const raw of run.raw.match(/&(?:amp|lt|gt|quot|apos|#9|#10|#13);|[\s\S]/gu) ?? []) {
          const ch = decode(raw);
          const cp = ch.codePointAt(0)!;
          const fallback = run.face?.borrowed?.has(cp)
            ? GLYPH_FALLBACK_FAMILIES[cp] : undefined;
          if (!chunk || chunk.family !== fallback) {
            chunk = { attrs: runAttrs, raw: '', width: 0, family: fallback };
            chunks.push(chunk);
          }
          chunk.raw += raw;
        }
        for (const part of chunks.slice(firstChunk)) {
          const font = fontFor(part.family ?? run.face!.family, runWeight);
          const text = decode(part.raw);
          // resvg adds a dotted circle before a leading combining mark; fontkit does not.
          if (!font || /^\p{Mark}/u.test(text) || [...text].some(ch => !font.hasGlyphForCodePoint(ch.codePointAt(0)!))) return line.map(run => `<tspan${run.attrs}>${run.raw}</tspan>`).join('');
          try {
            const shaped = font.layout(text);
            part.width = shaped.advanceWidth * size / font.unitsPerEm + shaped.positions.filter(position => position.xAdvance !== 0).length * spacing;
          } catch {
            return line.map(run => `<tspan${run.attrs}>${run.raw}</tspan>`).join('');
          }
        }
      }
      const lineAttrs = line[0]!.attrs;
      const x = Number(attr(lineAttrs, 'x') ?? attr(attrs, 'x'));
      if (!Number.isFinite(x)) return line.map(run => `<tspan${run.attrs}>${run.raw}</tspan>`).join('');
      isolated = true;
      const anchor = attr(attrs, 'text-anchor') ?? 'start';
      let cursor = x - chunks.reduce((sum, chunk) => sum + chunk.width, 0) * (anchor === 'end' ? 1 : anchor === 'middle' ? 0.5 : 0);
      // resvg falls back per absolute-x chunk, even across font-family spans.
      const positioned = chunks.map(chunk => {
        const start = Math.round(cursor * 1000) / 1000;
        cursor += chunk.width;
        const style = chunk.family ? chunk.attrs.replace(/\sfont-family="[^"]*"/g, '') + ` font-family="${chunk.family}"` : chunk.attrs;
        return `<tspan${style} x="${start}" text-anchor="start">${chunk.raw}</tspan>`;
      }).join('');
      const vertical = ['y', 'dy'].map(name => attr(lineAttrs, name) === undefined ? '' : ` ${name}="${attr(lineAttrs, name)}"`).join('');
      return `<tspan${vertical}>${positioned}</tspan>`;
    }).join('');
    return isolated ? `<text${attrs}>${title}${changed}</text>` : original;
  });
}

/**
 * Rasterise one SVG at `scale` device pixels per layout unit. resvg reads the
 * font families the SVG names from the system fonts, the same fonts a browser
 * on this machine would use; `fontFamily` is the fallback for a family the
 * system lacks.
 */
export function rasterizeWithResvg(resvg: ResvgModule, svg: string, width: number, scale: number, fontFamily: string): Buffer {
  const renderer = new resvg.Resvg(isolateFallbackGlyphs(svg, fontFamily), {
    fitTo: { mode: 'width', value: Math.round(width * scale) },
    font: { loadSystemFonts: true, defaultFontFamily: fontFamily, sansSerifFamily: fontFamily },
  });
  return Buffer.from(renderer.render().asPng());
}
