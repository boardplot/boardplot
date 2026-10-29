/** The one theme shape (`THEME_SHAPE`): presets pass, unsafe families and unknown keys are refused with a way out. */
import { describe, expect, it } from 'vitest';
import { roadshowFamilyThemes, themes, resolveTheme } from '../src/core/theme';
import { parseThemeJson, validateTheme } from '../src/core/themeValidate';
import '../src/core/themeShapeRules';
import { parseJsonPointer } from '../src/core/diagnostics/jsonPatch';
import { checkThemeShape, unknownThemeKeyRepair } from '../src/core/themeShape';
import { getChartDefinition, measure } from '../src/index';
import { getFixtures } from '../src/fixtures';
import { requireGeometry } from '../src/core/sizing';

const clone = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
const drop = (theme: Record<string, unknown>, path: string[]): void => {
  let cursor: Record<string, unknown> = theme;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  delete cursor[path[path.length - 1]!];
};

describe('theme shape', () => {
  // A two-series chart must accept two authored colours without repeating them in preset-filled slots.
  it('fills a short series override from distinct preset colours', () => {
    const preset = themes.boardroom!;
    const authored = [preset.color.series[0]!.toLowerCase(), '#8C3B26'];
    const theme = resolveTheme({ preset: 'boardroom', overrides: { color: { series: authored } } });
    expect(theme.color.series.slice(0, 2)).toEqual(authored);
    expect(theme.color.series.length).toBe(preset.color.series.length);
    expect(theme.color.series.slice(2)).not.toContain(preset.color.series[0]);
    expect(new Set(theme.color.series.map(value => value.toLowerCase())).size).toBe(theme.color.series.length);
    expect(resolveTheme({ preset: 'boardroom', overrides: { color: { series: [authored[0]!] } } }).color.series.length).toBe(preset.color.series.length);
    expect(() => resolveTheme({ preset: 'boardroom', overrides: { color: { series: [] } } })).toThrow(/color.series/);
    expect(() => resolveTheme({ preset: 'boardroom', overrides: { color: { series: [42] } } } as never)).toThrow(/color.series/);
  });
  // A brand theme with two series colours for a two-series chart must draw, not be refused.
  it('accepts a full theme with two series colours, from a file and as a spec object', () => {
    const theme = { ...clone(themes.boardroom), name: 'two-colours' } as Record<string, any>;
    theme.color.series = ['#0B5FA5', '#8C3B26'];
    expect(parseThemeJson(theme).theme.color.series).toEqual(['#0B5FA5', '#8C3B26']);
    expect(checkThemeShape(theme)).toEqual([]);
  });
  // Authored key and note sizes must survive the frame's default font caps, including sizes shared by the target tables.
  it('draws the authored secondary and footnote sizes in the key and notes', () => {
    const chart = getChartDefinition('column')!;
    const geometry = requireGeometry(chart.layout({
      categories: [{ id: 'a' }, { id: 'b' }],
      series: [{ id: 's', values: [10, 20] }, { id: 'r', values: [5, 8] }],
    }, { size: { width: 900, height: 600 }, legend: 'top', footnotes: ['Authored note'], source: 'Invented data',
      theme: { preset: 'boardroom', overrides: { type: {
        axis: { size: 13 }, secondary: { size: 13, weight: 400 }, footnote: { size: 13 },
      } } },
    }));
    for (const part of ['legendLabel', 'footnote', 'source']) {
      const nodes = geometry.scene.filter(node => node.t === 'text' && node.part === part);
      expect(nodes.length, part).toBeGreaterThan(0);
      expect(nodes.map(node => node.t === 'text' ? node.font.size : 0), part).toEqual(nodes.map(() => 13));
    }
  });

  // Supported no-fill table settings must draw without permitting invisible text or lines.
  it('accepts transparent table fills without allowing transparent inks or lines', () => {
    const base = themes.boardroom!;
    const table = {
      grounds: { subtotal: 'transparent', total: 'transparent', good: 'transparent', goodStrong: 'transparent', warn: 'transparent', bad: 'transparent' },
      bar: { fill: 'transparent', muted: 'transparent' },
    };
    const theme = { ...base, table: { ...base.table, ...table } };
    expect(checkThemeShape(theme)).toEqual([]);
    expect(validateTheme(theme).filter(finding => finding.code === 'unparseable-color')).toEqual([]);
    expect(() => parseThemeJson(theme)).not.toThrow();
    expect(() => resolveTheme({ preset: 'boardroom', overrides: { table } })).not.toThrow();
    const inks = { ...theme, table: { ...theme.table, inks: { head: 'transparent' } } };
    expect(checkThemeShape(inks).join(' ')).toContain('table.inks.head');
    expect(validateTheme(inks).filter(finding => finding.code === 'unparseable-color').map(finding => finding.message))
      .toEqual([expect.stringContaining('table.inks.head')]);
    for (const key of ['grid', 'background', 'focus'] as const) {
      expect(checkThemeShape({ ...theme, color: { ...theme.color, [key]: 'transparent' } }).join(' ')).toContain(`color.${key}`);
    }
  });
  // Invalid table grounds and bar colours must be reported before a renderer reads them.
  it('checks table colour fields in theme files and overrides', () => {
    const base = themes.boardroom!;
    const theme = { ...base, table: { ...base.table, grounds: { total: 'not-a-color' }, bar: { fill: 'not-a-color' } } };
    expect(validateTheme(theme).filter(finding => finding.code === 'unparseable-color').map(finding => finding.message)).toEqual([
      expect.stringContaining('table.grounds.total'), expect.stringContaining('table.bar.fill'),
    ]);
    expect(() => parseThemeJson(theme)).toThrow(/table\.grounds\.total/);
    expect(() => resolveTheme({ preset: 'boardroom', overrides: { table: theme.table } })).toThrow(/table\.grounds\.total/);
  });
  it('accepts every bundled preset', () => {
    for (const [name, theme] of [...Object.entries(themes), ...Object.entries(roadshowFamilyThemes)]) {
      expect(checkThemeShape(theme), name).toEqual([]);
    }
  });

  // An unsafe role family must not reach a React inline style, where its semicolons add CSS declarations.
  it('refuses a role family outside the type.family grammar', () => {
    const family = 'Arial;position:fixed;inset:0;z-index:2147483647;border:9px solid;border-image:url(http://127.0.0.1:8765/kpi-leak) 1';
    for (const role of ['title', 'subtitle', 'label', 'axis', 'footnote', 'micro', 'secondary']) {
      const value = clone(Object.values(themes)[0]);
      const type = value.type as Record<string, Record<string, unknown>>;
      type[role] = { ...(type[role] ?? type.footnote), family };
      expect(checkThemeShape(value)[0], role).toMatch(new RegExp(`^type\\.${role}\\.family: must be comma-separated`));
    }
  });
  // A record copy would turn the key into the copy's prototype, hidden from Object.keys and the theme hash.
  it('refuses __proto__ as a palette name, with the remove patch', () => {
    const value = clone(Object.values(themes)[0]);
    (value.color as Record<string, unknown>).palettes = JSON.parse('{"__proto__": ["#111111", "#222222"]}');
    const issues = checkThemeShape(value);
    expect(issues).toEqual(['color.palettes: Unrecognized key: "__proto__"']);
    expect(unknownThemeKeyRepair(issues, '/theme')?.fix).toEqual([{ op: 'remove', path: '/theme/color/palettes/__proto__' }]);
  });
});

describe('unknown-key repair', () => {
  // A brand theme saved when the theme export still wrote space.barGap must keep drawing; a typo must still refuse.
  it('draws a theme with a retired key and warns with its remove patch, on files, objects and overrides', () => {
    const valid = clone(themes.boardroom);
    const saved = { ...valid, space: { ...valid.space as object, barGap: 4 } };
    const parsed = parseThemeJson(saved);
    expect(parsed.theme).toEqual(parseThemeJson(valid).theme);
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: 'option-deprecated', fix: [{ op: 'remove', path: '/space/barGap' }] }));
    const bar = getFixtures('bar')[0]!;
    const result = measure({ type: 'bar', data: bar.data, options: { ...bar.options, theme: { preset: 'boardroom', overrides: { space: { barGap: 4 } } } } });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'option-deprecated', fix: [{ op: 'remove', path: '/options/theme/overrides/space/barGap' }] }));
    expect(() => parseThemeJson({ ...valid, space: { ...valid.space as object, barGapp: 4 } })).toThrow(/barGapp/);
  });

  it('keeps a flattened key as one escaped pointer segment', () => {
    expect(unknownThemeKeyRepair(['space: Unrecognized key: "a.b/c~d"'], '/theme')?.fix)
      .toEqual([{ op: 'remove', path: '/theme/space/a.b~1c~0d' }]);
  });

  it('removes exactly the offending key from a real theme', () => {
    const valid = clone(Object.values(themes)[0]);
    const doc = { theme: clone(valid) };
    (doc.theme.space as Record<string, unknown>)['canvas.base'] = 4;
    const fix = unknownThemeKeyRepair(checkThemeShape(doc.theme), '/theme')!.fix;
    for (const op of fix) drop(doc, parseJsonPointer(op.path));
    expect(doc.theme).toEqual(valid);
  });
});
