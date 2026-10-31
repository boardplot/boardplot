/**
 * PNG raster. The SVG is the source of truth. The
 * rasterizer order is resvg when @resvg/resvg-js is installed, else headless
 * Chrome when one is found, else none: render then returns the SVG with a
 * no-rasterizer warning.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { familiesOf, resolveFace } from '../core/fontMetrics';
import { crc32, PNG_PIXELS_MAX, withPhysicalSize } from '../core/pngPhysicalSize';
import { InputError, ToolFailure } from './result';
import { glyphFallbackFamily, hasArrowFallback, installedFamilies, loadResvg, rasterFamily, rasterizeWithResvg } from './resvg';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

/** Path of a usable Chrome, or null. BOARDPLOT_CHROME_PATH wins. */
function findChrome(): string | null {
  const override = process.env['BOARDPLOT_CHROME_PATH'];
  if (override) return existsSync(override) ? override : null;
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/** How long one Chrome run may take before it is stopped. */
const CHROME_TIMEOUT_MS = 60_000;

/**
 * Rasterise one SVG document at `scale` device pixels per layout unit.
 * `width`/`height` are the SVG's layout size; the PNG is width*scale by
 * height*scale pixels. The page background is the SVG's own (a transparent
 * SVG stays transparent).
 *
 * Chrome's exit code is not the verdict. Under load it writes the screenshot,
 * then logs "Teardown watchdog expired" and exits 2, or hangs in teardown
 * until the timeout stops it. A whole PNG of the expected size counts as
 * drawn. Without one, Chrome runs once more, and a second miss throws a
 * png-export-failed ToolFailure that names the cause.
 */
function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
  scale: number,
  chromePath: string,
): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'boardplot-png-'));
  try {
    const html = join(dir, 'chart.html');
    // The SVG gets its own size in CSS px. Unsized, it filled the page width,
    // and headless Chrome lays out a page wider than a narrow window (about
    // 500 px): a 360 px card scaled up by 1.4 and the screenshot cut off its
    // bottom and right edge, sparkline included.
    writeFileSync(
      html,
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${Math.round(width)}px;height:${Math.round(height)}px}</style></head><body>${svg}</body></html>`,
    );
    // Chrome rounds the scaled window to whole pixels.
    const expected = { width: Math.round(Math.round(width) * scale), height: Math.round(Math.round(height) * scale) };
    const causes: string[] = [];
    for (const attempt of [1, 2]) {
      const png = join(dir, `chart-${attempt}.png`);
      const run = spawnSync(
        chromePath,
        [
          '--headless=new',
          '--disable-gpu',
          '--hide-scrollbars',
          '--no-first-run',
          '--no-default-browser-check',
          '--default-background-color=00000000',
          `--force-device-scale-factor=${scale}`,
          `--window-size=${Math.round(width)},${Math.round(height)}`,
          `--screenshot=${png}`,
          `file://${html}`,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], timeout: CHROME_TIMEOUT_MS, encoding: 'utf8' },
      );
      const written = existsSync(png) ? readFileSync(png) : null;
      if (written && completePng(written, expected)) return written;
      causes.push(chromeFailure(run, chromePath, written));
    }
    throw new ToolFailure('png-export-failed', `headless Chrome drew no complete PNG in two runs: ${causes.join('; then ')}`, {
      path: '/format',
      suggest: 'Retry when the machine is less busy, render --format svg, or install @resvg/resvg-js to draw PNGs without Chrome.',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Why one Chrome run gave no PNG: missing browser, timeout, crash or a bad file, with Chrome's last word. */
function chromeFailure(run: ReturnType<typeof spawnSync>, chromePath: string, written: Buffer | null): string {
  const lastLine = String(run.stderr ?? '').trim().split('\n').pop()?.trim().slice(0, 200);
  const said = lastLine ? ` (Chrome said: ${lastLine})` : '';
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'EACCES') return `the browser at ${chromePath} could not be started (${code})`;
  if (code === 'ETIMEDOUT') return `timed out after ${CHROME_TIMEOUT_MS / 1000} s${said}`;
  if (run.signal) return `crashed with ${run.signal}${said}`;
  if (written) return `wrote an incomplete or wrongly sized PNG (exit code ${run.status})${said}`;
  if (run.error) return `failed to run (${run.error.message})`;
  return `exited with code ${run.status} without writing the PNG${said}`;
}

/**
 * True when `buffer` is a whole PNG of `size` give or take one pixel: the
 * header names the size, and every chunk up to IEND is there with its CRC,
 * image data included. A file cut off mid-write has no IEND.
 */
export function completePng(buffer: Buffer, size: { width: number; height: number }): boolean {
  const header = pngSize(buffer);
  if (!header || Math.abs(header.width - size.width) > 1 || Math.abs(header.height - size.height) > 1) return false;
  let images = 0;
  for (let at = 8; at + 12 <= buffer.length;) {
    const end = at + 8 + buffer.readUInt32BE(at);
    if (end + 4 > buffer.length || crc32(buffer.subarray(at + 4, end)) !== buffer.readUInt32BE(end)) return false;
    const type = buffer.toString('ascii', at + 4, at + 8);
    if (type === 'IEND') return images > 0;
    if (type === 'IDAT') images += 1;
    at = end + 4;
  }
  return false;
}

/** Width and height from a PNG header (IHDR), for tests and receipts. */
export function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** The warning a PNG request gets when no rasterizer is available. */
function rasterizerMissingWarning() {
  return {
    code: 'no-rasterizer',
    severity: 'warn' as const,
    message: 'PNG needs @resvg/resvg-js (npm i @resvg/resvg-js) or Chrome; returning SVG only',
    path: '/format',
  };
}

type Rasterizer = 'resvg' | 'chrome';

/** The rasterizer render would use now: resvg, then Chrome, else null. */
export function availableRasterizer(): Rasterizer | null {
  if (loadResvg()) return 'resvg';
  return findChrome() ? 'chrome' : null;
}

type RasterWarning = ReturnType<typeof rasterizerMissingWarning> & { suggest?: string };

/** The warning a PNG request gets when resvg would draw without any font and no Chrome can take over. */
function rasterFontsMissingWarning(): RasterWarning {
  return {
    code: 'raster-fonts-missing',
    severity: 'warn',
    message: 'PNG needs one of the theme fonts or Liberation Sans, Arimo, Nimbus Sans, DejaVu Sans or Noto Sans installed, or Chrome; returning SVG only',
    path: '/format',
  };
}

/**
 * Characters absent from every tabled family in the theme's fallback stack:
 * resvg draws emoji as boxes and leaves CJK out. Whitespace is skipped;
 * a font without a table cannot be checked and reports none.
 */
export function uncoveredCharacters(text: string, fontFamily: string): string[] {
  const faces = familiesOf(fontFamily).flatMap(family => {
    const face = resolveFace(family, 400);
    return face ? [face] : [];
  });
  if (!faces.length) return [];
  const installed = installedFamilies();
  const missing = [...new Set([...text].filter(character => {
    const cp = character.codePointAt(0)!;
    return !/\s/u.test(character) && faces.every(face => face.advance(cp) === undefined || face.borrowed?.has(cp)) &&
      !glyphFallbackFamily(cp, installed);
  }))];
  const arrow = (character: string) => '←↑→↓↗↘'.includes(character);
  return missing.some(arrow) && hasArrowFallback(installed)
    ? missing.filter(character => !arrow(character)) : missing;
}

function glyphCoverageWarning(name: string, characters: readonly string[], text: string): RasterWarning {
  const listed = characters.slice(0, 5).map((character) => `'${character}'`).join(', ');
  const more = characters.length > 5 ? ` and ${characters.length - 5} more` : '';
  // resvg replaces the whole text run, so the Latin words next to a lost character go with it.
  const labels = [...new Set(text.split('\n').map((line) => line.trim()).filter((line) => characters.some((character) => line.includes(character))))];
  const named = labels.slice(0, 3).map((label) => `'${label}'`).join(', ') + (labels.length > 3 ? ` and ${labels.length - 3} more` : '');
  return {
    code: 'png-glyph-coverage',
    severity: 'warn',
    message: `chart '${name}': the theme font has no glyph for ${listed}${more}; the PNG draws them as boxes or leaves them out, and the whole label can go with them: ${named}. The SVG shows them in a browser.`,
    path: '/format',
    suggest: 'Install Chrome so the PNG is drawn by the browser, deliver the SVG, or leave these characters out of labels meant for the PNG.',
  };
}

interface RasterResult {
  /** One PNG per drawing, or null when render returns the SVG instead. */
  pngs: Buffer[] | null;
  warnings: RasterWarning[];
}

/**
 * Rasterise each drawing at `scale` device pixels per layout unit. `fontFamily`
 * is the theme's font stack and `text` the chart's visible label text. resvg
 * falls back to the first installed family of the stack (rasterFamily); when
 * a drawing has none, Chrome takes over, and without Chrome the result is no
 * PNG and the raster-fonts-missing warning. A drawing with a character the
 * theme font lacks (emoji, CJK) goes to Chrome too, because resvg loses the
 * whole label; without Chrome it keeps the resvg PNG and the png-glyph-coverage warning.
 */
export function rasterize(
  drawings: readonly { svg: string; size: { width: number; height: number }; fontFamily: string; name?: string; text?: string }[],
  scale: number,
  rasterizer: Rasterizer | null = availableRasterizer(),
): RasterResult {
  // Both rasterizers allocate the whole image up front, and a failed allocation in resvg aborts the process.
  for (const drawing of drawings) {
    const width = Math.round(drawing.size.width * scale);
    const height = Math.round(drawing.size.height * scale);
    if (width * height > PNG_PIXELS_MAX) {
      throw new InputError('png-too-large', `chart '${drawing.name ?? 'chart'}' would be a PNG of ${width} x ${height} px, above the limit of ${PNG_PIXELS_MAX} pixels`, {
        path: '/format', expected: { maximum: PNG_PIXELS_MAX },
        suggest: `Draw the SVG, lower scale, or make the canvas smaller so width x height x scale^2 stays within ${PNG_PIXELS_MAX} pixels.`,
        fix: [{ op: 'replace', path: '/format', value: 'svg' }],
      });
    }
  }
  const resvg = rasterizer === 'resvg' ? loadResvg() : null;
  let chrome = rasterizer === 'chrome' ? findChrome() : null;
  if (resvg) {
    const installed = installedFamilies();
    const families = drawings.map((drawing) => rasterFamily(drawing.fontFamily, installed));
    if (families.every((family) => family !== null)) {
      const warnings: RasterWarning[] = [];
      const browser = findChrome();
      const pngs = drawings.map((drawing, index) => {
        const lost = uncoveredCharacters(drawing.text ?? '', drawing.fontFamily);
        const drawn = () => Buffer.from(withPhysicalSize(rasterizeWithResvg(resvg, drawing.svg, drawing.size.width, scale, families[index]!), scale));
        if (!lost.length) return drawn();
        // Chrome draws the glyphs resvg lacks. If it fails too, the resvg PNG still beats no PNG.
        if (browser) {
          try {
            return Buffer.from(withPhysicalSize(rasterizeSvg(drawing.svg, drawing.size.width, drawing.size.height, scale, browser), scale));
          } catch (error) {
            if (!(error instanceof ToolFailure)) throw error;
          }
        }
        warnings.push(glyphCoverageWarning(drawing.name ?? 'chart', lost, drawing.text ?? ''));
        return drawn();
      });
      return { pngs, warnings };
    }
    chrome = findChrome();
    if (!chrome) return { pngs: null, warnings: [rasterFontsMissingWarning()] };
  }
  if (!chrome) return { pngs: null, warnings: [rasterizerMissingWarning()] };
  const browser = chrome;
  const pngs = drawings.map((drawing) =>
    Buffer.from(withPhysicalSize(rasterizeSvg(drawing.svg, drawing.size.width, drawing.size.height, scale, browser), scale)));
  return { pngs, warnings: [] };
}
