/**
 * `--font-tables` and `BOARDPLOT_FONT_TABLES`: a host licensed for a font that is
 * not bundled measures with its own tables through the CLI and the MCP server.
 * The tables are built from the OFL font in tests/fixtures/fonts, with the
 * family renamed to one the bundle does not know.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { main } from '../src/cli/main';
import { advanceWidths, buildFontTables, loadFontReader, serializeFontTables } from '../src/cli/fontTables';
import { callTool } from '../src/mcp/server';
import { validateTheme } from '../src/core/themeRules';
import { resolveTheme } from '../src/core/theme';
import { createMetricTablesMeasurer } from '../src/core/fontMetrics/injected';
import { codePointsOf, encodeWidths, parseFontMetricTables } from '../src/core/fontMetrics/tableDocument';
import { defaultMeasurer, wrapText } from '../src/core/text';

beforeAll(loadFontReader);

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BOARDPLOT_FONT_TABLES;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FAMILY = 'Host Sans';
const spec = {
  type: 'column',
  data: {
    categories: [{ id: 'a', label: 'Customer acquisition cost' }, { id: 'b', label: 'North America' }],
    series: [{ id: 's', label: 'Revenue', values: [1234, 2345] }],
  },
  options: {
    title: 'Revenue by segment', size: { width: 600, height: 360 },
    theme: { preset: 'boardroom', overrides: { type: { family: `'${FAMILY}', sans-serif` } } },
  },
};

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'boardplot-font-tables-'));
  dirs.push(dir);
  return dir;
}

/** Tables from the committed OFL font, under a family name the bundle does not carry. */
function hostTables(dir: string): string {
  const built = buildFontTables(join(process.cwd(), 'tests', 'fixtures', 'fonts')).tables;
  const renamed = { ...built, faces: built.faces.map((face) => ({ ...face, family: FAMILY })) };
  const file = join(dir, 'tables.json');
  writeFileSync(file, serializeFontTables(renamed));
  return file;
}

function run(args: string[]): { code: number; body: any } {
  const log: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...v) => log.push(v.join(' ')));
  const code = main(args);
  vi.restoreAllMocks();
  return { code, body: JSON.parse(log.join('\n')) };
}

function categoryX(file: string): string[] {
  const svg = readFileSync(file, 'utf8');
  return [...svg.matchAll(/data-id="label:category:\w+"[^>]* x="([\d.]+)"/g)].map((match) => match[1]!);
}

describe('host font tables on the CLI and the MCP server', () => {
  // Repeated font warnings must not hide chart warnings or leave the measured family unknown.
  it('reports font metrics once per batch on the CLI and MCP, with the measured family', () => {
    const dir = workDir();
    const batch = { version: 1, charts: Array.from({ length: 3 }, (_, index) => ({
      ...spec, name: `chart-${index}`, options: { ...spec.options,
        theme: { preset: 'boardroom', overrides: { type: { family: "'Batch Brand Sans', Arial, sans-serif" } } },
      },
    })) };
    const file = join(dir, 'batch.json');
    writeFileSync(file, JSON.stringify(batch));
    const fontWarnings = (body: any) => body.warnings.filter((warning: any) => warning.code === 'family-outside-metric-class');
    const cli = run(['render', file]).body;
    const mcp = callTool('boardplot_render', { spec: batch }).structuredContent;
    for (const body of [cli, mcp]) {
      expect(body.ok).toBe(true);
      expect(fontWarnings(body)).toHaveLength(1);
      expect(fontWarnings(body)[0]).toMatchObject({ path: '/charts/0/options/theme', message: expect.stringContaining("measured with 'Arial'") });
    }
    // A CLI batch reports again; the MCP server keeps its existing once-per-theme policy.
    expect(fontWarnings(run(['render', file]).body)).toHaveLength(1);
    expect(fontWarnings(callTool('boardplot_render', { spec: batch }).structuredContent)).toHaveLength(0);
    const estimated = { ...spec, options: { ...spec.options,
      theme: { preset: 'boardroom', overrides: { type: { family: "'Estimate Brand Sans', sans-serif" } } },
    } };
    writeFileSync(file, JSON.stringify(estimated));
    expect(fontWarnings(run(['render', file]).body)[0].message).toContain('character-class estimate');
  });

  it('measures with the tables from the flag and from the environment, not with the estimate', () => {
    const dir = workDir();
    const tables = hostTables(dir);
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
    const render = (name: string, extra: string[]) =>
      run(['render', join(dir, 'spec.json'), '--format', 'svg', '--out', join(dir, `${name}.svg`), ...extra]);

    const plain = render('plain', []);
    expect(plain.body.fontTables).toBeUndefined();
    expect(plain.body.warnings.map((w: { code: string }) => w.code)).toContain('family-outside-metric-class');

    const flagged = render('flag', ['--font-tables', tables]);
    expect(flagged.code).toBe(0);
    expect(flagged.body.fontTables.families).toEqual([FAMILY]);
    // The theme check knows the tables cover the leading family.
    expect(flagged.body.warnings.map((w: { code: string }) => w.code)).not.toContain('family-outside-metric-class');
    expect(categoryX(join(dir, 'flag.svg'))).not.toEqual(categoryX(join(dir, 'plain.svg')));

    process.env.BOARDPLOT_FONT_TABLES = tables;
    const fromEnv = render('env', []);
    expect(fromEnv.body.fontTables.families).toEqual([FAMILY]);
    expect(readFileSync(join(dir, 'env.svg'), 'utf8')).toBe(readFileSync(join(dir, 'flag.svg'), 'utf8'));
  });

  it('refuses a tables file that is not one, and draws nothing', () => {
    const dir = workDir();
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
    writeFileSync(join(dir, 'bad.json'), '{"hello":1}');
    const out = join(dir, 'chart.svg');
    const bad = run(['render', join(dir, 'spec.json'), '--out', out, '--font-tables', join(dir, 'bad.json')]);
    expect(bad.code).toBe(1);
    expect(bad.body.errors[0].code).toBe('invalid-font-tables');
    expect(() => readFileSync(out)).toThrow();
    const missing = run(['measure', join(dir, 'spec.json'), '--font-tables', join(dir, 'nope.json')]);
    expect(missing.body.errors[0].code).toBe('font-tables-unreadable');
  });

  it('the MCP tools use BOARDPLOT_FONT_TABLES and name the families in the result', () => {
    const dir = workDir();
    process.env.BOARDPLOT_FONT_TABLES = hostTables(dir);
    const result = callTool('boardplot_render', { spec, return: ['svg'] });
    expect(result.structuredContent.fontTables).toEqual({ families: [FAMILY], faces: expect.any(Number) });
    delete process.env.BOARDPLOT_FONT_TABLES;
    expect(callTool('boardplot_render', { spec, return: ['svg'] }).structuredContent.fontTables).toBeUndefined();
  });

  it('the theme check takes the families a host passes tables for', () => {
    const theme = resolveTheme({ preset: 'standard', overrides: { type: { family: `'${FAMILY}', sans-serif` } } });
    const codes = (families?: string[]) => validateTheme(theme, undefined, families).map((w) => w.code);
    expect(codes()).toContain('family-outside-metric-class');
    expect(codes([FAMILY])).not.toContain('family-outside-metric-class');
  });

  it('measures a family the file does not hold with the bundled tables, then the estimate', () => {
    const dir = workDir();
    const tables = parseFontMetricTables(JSON.parse(readFileSync(hostTables(dir), 'utf8')));
    const spec = (family: string) => ({ family, size: 13, weight: 400 });
    const withFallback = createMetricTablesMeasurer(tables, { bundledFallback: true });
    const fileOnly = createMetricTablesMeasurer(tables);
    const bundledStack = "'Helvetica Neue', Helvetica, Arial, sans-serif";
    // Passed tables first, for the family they hold.
    expect(withFallback('1,234', spec(`'${FAMILY}', ${bundledStack}`)).width).toBe(fileOnly('1,234', spec(`'${FAMILY}', ${bundledStack}`)).width);
    // Then the bundled tables, for every other tabled family in the stack.
    expect(withFallback('1,234', spec(bundledStack)).width).toBe(defaultMeasurer('1,234', spec(bundledStack)).width);
    expect(withFallback('1,234', spec(`'Other Sans', ${bundledStack}`)).width).toBe(defaultMeasurer('1,234', spec(bundledStack)).width);
    // The file alone has no table for it and estimates by character class.
    expect(fileOnly('1,234', spec(bundledStack)).width).not.toBe(defaultMeasurer('1,234', spec(bundledStack)).width);
    // No tabled family anywhere: the character-class model.
    expect(withFallback('1,234', spec("'Other Sans', sans-serif")).width).toBe(defaultMeasurer('1,234', spec("'Other Sans', sans-serif")).width);
  });

  // This test prevents an invisible soft hyphen from making a label wider than the chart.
  it('measures default-ignorable code points at zero width and never writes a negative advance', () => {
    const dir = workDir();
    const tables = parseFontMetricTables(JSON.parse(readFileSync(hostTables(dir), 'utf8')));
    const codePoints = codePointsOf(tables.codePointRanges, tables.extraCodePoints);
    // A table built before the clamp: the soft hyphen's negative advance wrapped to 65,519 units.
    const wrapped = codePoints.map(() => 500);
    wrapped[codePoints.indexOf(0xad)] = 65519;
    const broken = { ...tables, faces: tables.faces.map((face) => ({ ...face, widths: encodeWidths(wrapped) })) };
    const font = (family: string) => ({ family, size: 13, weight: 400 });
    const hidden = 'Re\u00ADve\u200Bnue\u2060\uFEFF';
    for (const [measure, family] of [
      [createMetricTablesMeasurer(broken), `'${FAMILY}', sans-serif`],
      [defaultMeasurer, 'Helvetica, Arial, sans-serif'],
      [defaultMeasurer, "'Other Sans', sans-serif"],
    ] as const) {
      expect(measure(hidden, font(family)).width).toBe(measure('Revenue', font(family)).width);
      expect(measure(hidden, { ...font(family), letterSpacing: 1 }).width).toBe(measure('Revenue', { ...font(family), letterSpacing: 1 }).width);
      // A soft hyphen that a combining mark joins is still an invisible cluster.
      expect(measure('Re\u00AD\u0301venue', font(family)).width).toBe(measure('Revenue', font(family)).width);
      // The Hangul fillers draw as spacing glyphs, as in the browser.
      for (const filler of ['\u115F', '\u1160', '\u3164', '\uFFA0']) expect(measure(`A${filler}B`, font(family)).width).toBeGreaterThan(measure('AB', font(family)).width);
    }
    // A BOM inside a word is neither a space nor a break.
    expect(wrapText('A\uFEFFB', font('Helvetica, Arial, sans-serif'), 1000).lines).toEqual(['A\uFEFFB']);
    const source = { hasGlyphForCodePoint: () => true, glyphForCodePoint: () => ({ advanceWidth: -17 }), layout: () => ({ advanceWidth: -17 }) };
    expect(advanceWidths(source, [0xad], 1)).toEqual([0]);
  });
});
