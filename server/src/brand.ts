/**
 * Theme choice and brand contrast repair. Runs in the render worker,
 * because it reads the engine's theme presets and theme checks.
 *
 * The engine only warns about contrast on the override path, so the server
 * enforces the floors for the colours a brand brings: it moves a failing
 * colour's lightness in small steps until the engine's own finding for it
 * clears and checks the complete theme it returns again. If a floor still
 * fails, the safe theme of its scheme draws instead and the failing roles
 * are reported. The safe themes are boardroom (light) and glass with the
 * boardroom type family (dark). A floor is a finding
 * with severity error, or one whose code names contrast or an invisible
 * mark. The same floor rule holds for every theme the server draws: a preset
 * or a spec theme with a floor finding is replaced by the safe theme of its
 * scheme. Each change is reported. The theme is built for this request only;
 * the server never registers a theme.
 */
import { resolveTheme, themes } from '../../src/core/theme';
import { validateTheme } from '../../src/core/themeRules';
import { contrastRatio, mixColors, parseColor } from '../../src/core/color';
import type { Theme, ThemeRef } from '../../src/core/types/theme';
import { InputError } from '../../src/cli/result';
import { tabledFamilies, tableFamilyKey } from '../../src/core/fontMetrics';
import { linkThemeShapeRules } from '../../src/core/themeShapeRules';

// Theme overrides need the engine's theme rules; the HTTP process loads this module without the render entry.
linkThemeShapeRules();

export interface Brand {
  preset?: string;
  background?: string;
  text?: string;
  muted?: string;
  accent?: string;
  good?: string;
  bad?: string;
  series?: unknown[] | Record<string, unknown>;
  font?: { family: string };
}

export interface BrandChange {
  role: string;
  from: string;
  to: string;
}

export interface ThemeChoice {
  /** The theme of the light drawing; undefined keeps the engine default (boardroom). */
  light: ThemeRef | undefined;
  /** The theme of the dark drawing; equal to light when the theme is explicit. */
  dark: ThemeRef | undefined;
  /** An explicit theme argument or a theme in the spec stays the same in both modes. */
  explicit: boolean;
  /** Series fills by series name, for a brand that colours series by name. */
  seriesFills?: Record<string, string>;
  changes: BrandChange[];
  /** Brand roles that failed a floor after repair: the brand was not applied and a safe theme draws. */
  rejected?: string[];
  /** A brand font family the engine has no metric table for: label widths are estimated. */
  fontNotMeasured?: string;
  /** A preset or spec theme with floor findings that the safe theme of its scheme replaced. */
  replaced?: { kind: 'brand-preset-replaced' | 'theme-replaced'; preset: string; codes: string[] };
}

const LIGHT_DEFAULT = 'boardroom';

/**
 * The dark default and the dark fallback: glass, the dark member of the
 * boardroom families, with the boardroom type family. Glass names Inter
 * first, which has no metric table and which the view cannot load; with the
 * boardroom family, measured equals drawn and both modes show the same face.
 * Built once, so the engine's theme cache keeps one entry.
 */
const DARK_THEME: ThemeRef = { preset: 'glass', overrides: { type: { family: resolveTheme(LIGHT_DEFAULT).type.family } } } as ThemeRef;

/** The safe theme of each scheme; both are checked at startup. */
export const SAFE_THEMES = { light: LIGHT_DEFAULT as ThemeRef, dark: DARK_THEME } as const;
/** Lightness steps: each moves the colour 4% further toward black or white. */
const STEP = 0.04;
const MAX_STEPS = 20;

/** #abc and #aabbcc become #AABBCC, so a colour matches the engine's messages. */
function normalHex(value: unknown, path: string): string {
  const match = typeof value === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim()) : null;
  if (!match) {
    throw new InputError('invalid-color', `${path}: '${String(value).slice(0, 40)}' is not a hex colour such as #1F4E79`, {
      path, expected: { condition: 'a hex colour #RGB or #RRGGBB' }, suggest: 'Pass the colour as #RRGGBB.',
    });
  }
  const digits = match[1]!.length === 3 ? match[1]!.split('').map((digit) => digit + digit).join('') : match[1]!;
  return `#${digits.toUpperCase()}`;
}

function presetName(name: string, path: string): string {
  if (Object.hasOwn(themes, name)) return name;
  throw new InputError('unknown-theme', `unknown theme '${name}'`, {
    path, expected: { values: cleanPresets() }, suggest: `Pass one of ${cleanPresets().join(', ')}, or a brand object.`,
  });
}

/** One colour slot of a brand: where it lands in the theme, and its preset fallback. */
interface Slot {
  role: string;
  value: string;
  write(overrides: Record<string, unknown>, value: string): void;
}

function colorPatch(overrides: Record<string, unknown>): Record<string, unknown> {
  return (overrides.color ??= {}) as Record<string, unknown>;
}

/** Series colours a brand may name. */
export const SERIES_LIMIT = 64;

function slots(brand: Brand): { slots: Slot[]; seriesNames?: string[] } {
  const out: Slot[] = [];
  const simple = (role: keyof Brand, keys: string[]) => {
    const raw = brand[role];
    if (typeof raw !== 'string') return;
    const value = normalHex(raw, `/theme/${role}`);
    out.push({
      role, value,
      write: (overrides, next) => { for (const key of keys) colorPatch(overrides)[key] = next; },
    });
  };
  simple('text', ['ink', 'axis']);
  simple('muted', ['inkMuted']);
  simple('accent', ['highlight', 'total']);
  simple('good', ['good']);
  simple('bad', ['bad']);
  const series = brand.series;
  const list = Array.isArray(series) ? series : series && typeof series === 'object' ? Object.values(series) : undefined;
  const seriesNames = series && !Array.isArray(series) && typeof series === 'object' ? Object.keys(series) : undefined;
  const accent = out.find((slot) => slot.role === 'accent');
  if (list && list.length > SERIES_LIMIT) {
    throw new InputError('invalid-argument', `theme.series has ${list.length} colours; a brand holds at most ${SERIES_LIMIT}`, { path: '/theme/series', suggest: `Pass at most ${SERIES_LIMIT} series colours.` });
  }
  const ramp = list ? list.map((value, index) => normalHex(value, `/theme/series/${seriesNames ? seriesNames[index] : index}`))
    : accent ? [accent.value] : [];
  ramp.forEach((value, index) => {
    out.push({
      role: seriesNames ? `series '${seriesNames[index]}'` : `series ${index + 1}`, value,
      write: (overrides, next) => {
        const color = colorPatch(overrides);
        const current = Array.isArray(color.series) ? [...color.series as string[]] : [...ramp];
        current[index] = next;
        color.series = current;
      },
    });
  });
  return { slots: out, ...(seriesNames ? { seriesNames } : {}) };
}

/** A colour floor: severity error, or a code that names contrast or an invisible mark (the rule of the dashboard runtime). */
function isFloor(finding: { code: string; severity: string }): boolean {
  return finding.severity === 'error' || /contrast|invisible/.test(finding.code);
}

/** Every floor finding of a theme, as code and message. */
export function floorFindings(theme: Theme): { code: string; message: string }[] {
  return validateTheme(theme).filter(isFloor).map(({ code, message }) => ({ code, message }));
}

/** The engine's floor findings that name this colour and that the preset does not have by itself. */
function findingsFor(theme: Theme, value: string, baseline: ReadonlySet<string>): string[] {
  return floorFindings(theme)
    .map((finding) => finding.message)
    .filter((message) => !baseline.has(message) && message.toUpperCase().includes(`'${value}'`));
}

/**
 * A theme from a fresh copy of the overrides. The engine caches a merged
 * theme by the identity of the overrides object, so a mutated object would
 * return the theme of an earlier candidate.
 */
function build(base: string, overrides: Record<string, unknown>): Theme {
  return resolveTheme({ preset: base, overrides: structuredClone(overrides) } as ThemeRef);
}

/** Refuses to start when a safe theme has a floor finding: the fallback must always be safe. */
export function checkFallbackThemes(): void {
  for (const [scheme, ref] of Object.entries(SAFE_THEMES)) {
    const findings = floorFindings(resolveTheme(ref));
    if (findings.length) throw new Error(`the ${scheme} safe theme has colour floor findings: ${findings.map((finding) => finding.code).join(', ')}`);
  }
}

let clean: string[] | undefined;
/** The presets without a floor finding: the ones the theme argument offers. */
export function cleanPresets(): string[] {
  clean ??= Object.keys(themes).filter((name) => floorFindings(resolveTheme(name)).length === 0);
  return clean;
}

/** The safe theme of a theme's own scheme (light or dark background). */
function safeFor(theme: Theme): ThemeRef {
  return lightPage(theme.color.background) ? SAFE_THEMES.light : SAFE_THEMES.dark;
}

/**
 * One floor rule for every theme the server draws: a preset or a spec theme
 * with a floor finding draws the safe theme of its scheme, reported. A theme
 * the engine cannot resolve stays as it is, so the render reports its error.
 */
function floorChecked(ref: ThemeRef, label: string): { ref: ThemeRef; replaced?: ThemeChoice['replaced'] } {
  let theme: Theme;
  try {
    theme = resolveTheme(ref);
  } catch {
    return { ref };
  }
  const findings = floorFindings(theme);
  if (!findings.length) return { ref };
  return { ref: safeFor(theme), replaced: { kind: 'theme-replaced', preset: label, codes: [...new Set(findings.map((finding) => finding.code))] } };
}

function lightPage(background: string): boolean {
  return contrastRatio(background, '#000000') > contrastRatio(background, '#FFFFFF');
}

/** Toward black on a light page, toward white on a dark page: more contrast against the background. */
function stepped(value: string, background: string, step: number): string {
  return mixColors(value, lightPage(background) ? '#000000' : '#FFFFFF', 1 - STEP * step).toUpperCase();
}

/** A brand on top of its preset, with every colour finding repaired or reported. */
function brandTheme(brand: Brand): { ref: ThemeRef; seriesFills?: Record<string, string>; changes: BrandChange[]; rejected?: string[]; fontNotMeasured?: string; replaced?: ThemeChoice['replaced'] } {
  const named = presetName(brand.preset ?? LIGHT_DEFAULT, '/theme/preset');
  // A base preset with floor findings of its own is replaced before the brand goes on, so the brand is not blamed for it.
  const namedFindings = floorFindings(resolveTheme(named));
  const safe = namedFindings.length ? safeFor(resolveTheme(named)) : named;
  const replaced: ThemeChoice['replaced'] = namedFindings.length
    ? { kind: 'brand-preset-replaced', preset: named, codes: [...new Set(namedFindings.map((finding) => finding.code))] } : undefined;
  const base = typeof safe === 'string' ? safe : (safe as { preset: string }).preset;
  const baseOverrides = typeof safe === 'string' ? {} : ((safe as { overrides?: Record<string, unknown> }).overrides ?? {});
  const baseTheme = resolveTheme(safe);
  const overrides: Record<string, unknown> = structuredClone(baseOverrides);
  if (brand.background !== undefined) colorPatch(overrides).background = normalHex(brand.background, '/theme/background');
  if (brand.font) {
    if (typeof brand.font.family !== 'string' || brand.font.family.trim() === '') {
      throw new InputError('invalid-argument', 'theme.font.family must name a font family', { path: '/theme/font/family' });
    }
    overrides.type = { ...((overrides.type as Record<string, unknown> | undefined) ?? {}), family: brand.font.family };
  }
  const primary = brand.font?.family.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  const tabled = new Set(tabledFamilies().map(tableFamilyKey));
  const fontNotMeasured = primary && !tabled.has(tableFamilyKey(primary)) ? primary : undefined;
  const { slots: brandSlots, seriesNames } = slots(brand);
  for (const slot of brandSlots) slot.write(overrides, slot.value);
  // Findings the preset has by itself are not the brand's to repair.
  const baseline = new Set(validateTheme(baseTheme).map((finding) => finding.message));
  const background = (colorPatch(overrides).background as string | undefined) ?? baseTheme.color.background;
  const changes: BrandChange[] = [];
  const current = new Map(brandSlots.map((slot) => [slot, slot.value]));
  // Steps 2 and 3: each failing colour moves until its own finding clears.
  for (const slot of brandSlots) {
    if (!findingsFor(build(base, overrides), slot.value, baseline).length) continue;
    for (let step = 1; step <= MAX_STEPS; step++) {
      const candidate = stepped(slot.value, background, step);
      slot.write(overrides, candidate);
      current.set(slot, candidate);
      if (!findingsFor(build(base, overrides), candidate, baseline).length) break;
    }
  }
  // Step 4: the theme this function returns, checked once more as a whole.
  // If it has any floor finding, the brand is not applied at all: a safe
  // preset draws, so no request ever gets a theme that fails a floor.
  const ref = { preset: base, overrides: structuredClone(overrides) } as ThemeRef;
  const final = resolveTheme(ref);
  const remaining = floorFindings(final);
  if (remaining.length) {
    const failing = brandSlots.filter((slot) => remaining.some((finding) => finding.message.toUpperCase().includes(`'${current.get(slot)!}'`))).map((slot) => slot.role);
    if (brand.background !== undefined && remaining.some((finding) => finding.message.toUpperCase().includes(`'${background.toUpperCase()}'`))) failing.push('background');
    if (!failing.length) failing.push(...new Set(remaining.map((finding) => finding.code)));
    const fallback = lightPage(background) ? SAFE_THEMES.light : SAFE_THEMES.dark;
    return { ref: fallback, changes: [], rejected: failing, ...(fontNotMeasured ? { fontNotMeasured } : {}), ...(replaced ? { replaced } : {}) };
  }
  for (const slot of brandSlots) {
    const value = current.get(slot)!;
    if (value !== slot.value) changes.push({ role: slot.role, from: slot.value, to: value });
  }
  if (!parseColor(background)) throw new InputError('invalid-color', 'theme.background is not a colour', { path: '/theme/background' });
  // Series named in the brand bind to those names, so a filter never recolours a series.
  const seriesFills = seriesNames
    ? Object.fromEntries(seriesNames.map((name, index) => [name, ((colorPatch(overrides).series as string[])[index])!]))
    : undefined;
  return { ref, ...(seriesFills ? { seriesFills } : {}), changes, ...(fontNotMeasured ? { fontNotMeasured } : {}), ...(replaced ? { replaced } : {}) };
}

/**
 * Theme precedence: an explicit theme argument, else the theme in
 * the spec, else the host default (boardroom light, the glass dark theme).
 */
export function chooseTheme(argument: string | Brand | undefined, specTheme: unknown): ThemeChoice {
  if (typeof argument === 'string') {
    const { ref, replaced } = floorChecked(presetName(argument, '/theme'), argument);
    return { light: ref, dark: ref, explicit: true, changes: [], ...(replaced ? { replaced } : {}) };
  }
  if (argument && typeof argument === 'object') {
    const { ref, seriesFills, changes, rejected, fontNotMeasured, replaced } = brandTheme(argument);
    return {
      light: ref, dark: ref, explicit: true, ...(seriesFills ? { seriesFills } : {}), changes,
      ...(rejected ? { rejected } : {}), ...(fontNotMeasured ? { fontNotMeasured } : {}), ...(replaced ? { replaced } : {}),
    };
  }
  if (specTheme !== undefined) {
    const label = typeof specTheme === 'string' ? specTheme : typeof (specTheme as { preset?: unknown }).preset === 'string' ? `${(specTheme as { preset: string }).preset} (spec theme)` : 'spec theme';
    const { ref, replaced } = floorChecked(specTheme as ThemeRef, label);
    return { light: ref, dark: ref, explicit: true, changes: [], ...(replaced ? { replaced } : {}) };
  }
  return { light: undefined, dark: SAFE_THEMES.dark, explicit: false, changes: [] };
}
