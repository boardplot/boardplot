import { isHatchPattern } from './svgPath';
import { adaptivePaintColor } from './colorRecipes';
/**
 * Theme presets + resolution. Chart code references semantic
 * tokens only; the theme resolves them. 'boardroom' is the shipped default —
 * one of the four design families (boardroom/capital/studio/
 * glass) that ship as presets with fixed schemes and page chrome. 'standard'
 * and 'notation' (+ dark pairs) are the other presets.
 */

import { apcaContrast, compositeColor, contrastRatio, mixColors, onFillInks, parseColor, pickOnFillInk, tint } from './color';
import type { Margin } from './geometry';
import { markVisibilityFloor } from './markVisibility';
import { READER_LABEL_MIN_PX, tableHeadFloorPx } from './typeFloors';
import { NormalizeError } from './normalize/shared';
import { scaleTextAtFloor, targetFloorsPx, targetTypeSizesPx } from './target';
import type { RenderTarget } from './types/options';
import { AUTHORED_TYPE_SIZE, hasAuthoredTypeSize, type FontSpec } from './text';
import { pieRamp, quietestTintCap } from './pieRamp';
import { FILL_SEPARATION_FLOOR, MARK_CONTRAST_FLOOR, TEXT_CONTRAST_FLOOR, oklabLightness, PALETTE_CVD_FLOOR, PALETTE_NORMAL_FLOOR, PALETTE_TRITAN_FLOOR, palettePerceptualDistance, swatchApart } from './themeRules';
import { registerDeferredLoader, requireDeferred } from './deferred';
import boardroomFamilyJson from './themeFamilies/boardroom.json';
import capitalFamilyJson from './themeFamilies/capital.json';
import studioFamilyJson from './themeFamilies/studio.json';
import glassFamilyJson from './themeFamilies/glass.json';
import type { DeepPartial, Scenario } from './types/cell';
import type { HatchCue, HatchLook, LintWarning, Paint, PaintToken, SceneNode, ThemePaintSource } from './types/scene';
import type { DashRole, StrokeRole, Theme, ThemeRef, ThemeTable, TypeRoleName } from './types/theme';
import { adoptedTheme } from './themeStore';
import { RETIRED_PALETTES, RETIRED_PRESETS, RETIRED_THEME_KEYS, retiredThemeKeyWarning, withoutRetiredThemeKeys } from './retired';
import { themeColors } from './themeColors';

/**
 * The structural theme checks below run only over a theme a caller PATCHED,
 * so a bundle that never sees an override never needs them. `resolveTheme`
 * asks for them at the moment it has one; this is the chunk they arrive in
 * (see `core/deferred` and `core/themeShapeRules`).
 */
registerDeferredLoader('theme-rules', () => import('./themeShapeRules').then((module) => module.linkThemeShapeRules()));

type SurfaceWithAnchorTint = NonNullable<Theme['surface']> & { anchorTint?: number; bandTint?: number };

// Fresh maritime six: navy anchor, sky, teal, periwinkle, sea green, violet.
// Broadened hues, chroma capped at 0.14 (0.15-0.22 reads neon), OKLCH L held to
// the readable [0.43, 0.77] band, chroma >= 0.10 so no rank reads gray.
// All pairs clear the 12/6/4 floors; the binding pair (sky/teal, normal
// exactly 12.0) is hue-categorically distinct and stack-adjacent, where mark
// gaps and rules add separation.
const ATLANTIC_SERIES = ['#075A8E', '#55BEF7', '#2AB1A9', '#838CDA', '#208668', '#9259AC'];

// Atlantic-on-dark keeps the same navy / sky / teal / periwinkle / sea-green /
// violet identities. OKLCH lightness is lifted or respaced only where the dark
// surface needs it; every rank clears 3:1 on the surface and the 12/6/4
// normal/protan-deutan/tritan pairwise floors with non-zero margin.
const ATLANTIC_DARK_SERIES = ['#087397', '#55BEFB', '#25AAA2', '#828BD9', '#1E9240', '#A054C4'];

// Five neutral ranks are the maximum honest notation dark ramp that can
// keep adjacent OKLab distance above 12 while every rank stays >=3:1 on the
// near-black surface. Scenario notation remains the primary discriminator.
const NOTATION_DARK_SERIES = ['#606060', '#858585', '#ACACAC', '#D5D5D5', '#FFFFFF'];
const DARK_WARN = '#F2C14E';
// The light presets' warn is a dark amber chosen to read as text (4.5:1 on the
// page); as a cell or a bar it reads as olive. Their large warn fills take this
// amber: the theme ink reads on it at 6.5:1 or more, it stays 20 OKLab
// or more from the good and bad fills and from a missing cell, and its grounded
// hatch 12 or more from a missing cell. The dark presets' warn already fills
// as amber, so their warnFill repeats it.
const LIGHT_WARN_FILL = '#F5A800';
// Under colorblindSafe a large bad fill takes colorblind.bad, an olive or
// orange near the amber warn fill; hatched and washed toward the page, warn
// and bad come out 2 to 3 OKLab apart. This rust keeps every hatched
// status pair 12 or more apart on the light presets. The shared hatch recipe
// is not touched, so forecast bars and columns do not move.
const LIGHT_CB_BAD_FILL = '#A0431A';


/**
 * ONE type scale. The canonical W-M column is the 18-set; W-S and W-L are the
 * two other columns, selected by width class at layout time
 * (`themeForWidth`). Weights and line heights: title 700 @
 * 1.25, subtitle 400 @ 1.3, label 400 @ 1.2, axis 400 @ 1.2, footnote 400 @ 1.3,
 * micro 400 @ 1.2. Every shipped preset uses THIS block — it is the sole
 * size/weight table, so presets differ in family/color/spacing,
 * never in the scale (a table restated per preset drifts).
 */
function canonicalType(family: string): Theme['type'] {
  return {
    family,
    title: { family, size: 18, weight: 700, lineHeight: 1.25 },
    subtitle: { family, size: 12, weight: 400, lineHeight: 1.3 },
    label: { family, size: 11.5, weight: 400, lineHeight: 1.2 },
    axis: { family, size: 10.5, weight: 400, lineHeight: 1.2 },
    footnote: { family, size: 9, weight: 400, lineHeight: 1.3 },
    micro: { family, size: 9, weight: 400, lineHeight: 1.2 },
    scale: {
      S: { title: 15, subtitle: 10.5, label: 10, axis: 9.5, footnote: 8.5, micro: 9 },
      L: { title: 22, subtitle: 14, label: 13, axis: 12, footnote: 10.5, micro: 9.5 },
    },
  };
}

/** Width classes: W-S 480–719, W-M 720–1079 (canonical), W-L ≥ 1080. */
export type TypeWidthClass = 'S' | 'M' | 'L';

/**
 * The width class a canvas width selects for the type scale. Widths under
 * the W-S band (<480, too narrow for full charts; the
 * card families that legitimately live there are exempt at their call sites)
 * clamp to the smallest class rather than inventing a sub-S scale.
 */
export function typeWidthClass(width: number): TypeWidthClass {
  if (width >= WIDE_CANVAS_MIN_WIDTH) return 'L';
  return width >= 720 ? 'M' : 'S';
}

/**
 * The smallest size the theme gives its title across the width classes. A
 * compact frame sets its title at this size in the title weight, so
 * a small chart keeps a title that reads as one. A theme without steps
 * returns its one title size.
 */
export function smallestTitleSize(theme: Theme): number {
  const { title, scale } = theme.type;
  return Math.min(title.size, scale?.S?.title ?? title.size, scale?.L?.title ?? title.size);
}

const TYPE_ROLE_NAMES: readonly TypeRoleName[] = ['title', 'subtitle', 'label', 'axis', 'footnote', 'micro', 'secondary'];

/**
 * Grid-panel width-class override, read from an INTERNAL options key the
 * grid layouts set when invoking panel layouts: a panel is not a canvas
 * (the boundary the aspect lints draw), so a slot-sized panel must
 * render the parent canvas's width class, not re-class itself at slot width.
 * Deliberately NOT declared on `BaseOptions` and NOT in any JSON schema —
 * declarations follow the runtime,
 * and this key belongs to the engine, not to authors; an authored
 * `typeClass` in JSON is refused as an unknown option.
 */
export function panelTypeClass(options: unknown): TypeWidthClass | undefined {
  const value = (options as { typeClass?: unknown } | undefined)?.typeClass;
  return value === 'S' || value === 'M' || value === 'L' ? value : undefined;
}

/**
 * `labels: false` takes the data labels off, not the names under
 * the marks, on Cartesian types with a category axis; a grid panel leaves
 * its names to its grid.
 */
export function labelsOffKeepsNames(options: unknown): boolean {
  return panelTypeClass(options) === undefined;
}

/**
 * Micro role accessor. External themes may predate the token; they get
 * footnote − 1 px, never under the 9 px a reader label needs (the
 * micro role names regions, tiles and events, so the column runs 9, 9,
 * 9.5).
 */
export function microType(theme: Theme): FontSpec {
  const micro = theme.type.micro ?? {
    size: Math.max(READER_LABEL_MIN_PX, theme.type.footnote.size - 1),
    weight: 400,
    lineHeight: 1.2,
  };
  return micro.family ? micro : { ...micro, family: theme.type.family };
}

/**
 * The secondary text role: tick labels, axis titles,
 * scenario markers and background series labels. A theme without it (an
 * external theme) gets its axis role, so it renders as before. A default size
 * is never larger than the axis role; an authored size wins.
 */
export function secondaryType(theme: Theme): FontSpec {
  const { axis, secondary } = theme.type;
  if (!secondary) return axis;
  if (hasAuthoredTypeSize(secondary)) return secondary;
  return { ...secondary, size: Math.min(secondary.size, axis.size) };
}

/** The secondary role's font with the theme family, for measuring and drawing. */
export function secondaryFont(theme: Theme): FontSpec {
  return { family: theme.type.family, ...secondaryType(theme) };
}

/**
 * Activate the type scale for one width class (or a canvas width).
 * Returns a theme whose role sizes are the active class column, whose micro
 * role is materialised, and whose `scale` braces are stripped — scene fonts
 * built from the result never carry step metadata, and the W-M canonical
 * column IS each role's own `size`, so a theme without `scale` renders its
 * one fixed set at every class (external-theme compatibility).
 *
 * Callers: every chart layout, once, at its own resolved canvas width — the
 * two card types (kpi, bullet) are EXEMPT from the width classes
 * and simply skip this call at their sites, which leaves them on the
 * W-M canonical column; grid panels inherit the
 * parent canvas class through `options.typeClass`, because a panel is not a
 * canvas (the same boundary the aspect lints draw).
 */
export function themeForWidth(theme: Theme, widthOrClass: number | TypeWidthClass): Theme {
  const cls = typeof widthOrClass === 'number' ? typeWidthClass(widthOrClass) : widthOrClass;
  const column = cls === 'M' ? undefined : theme.type.scale?.[cls];
  const roles: Partial<Record<TypeRoleName, FontSpec>> = {};
  for (const role of TYPE_ROLE_NAMES) {
    const base = role === 'micro' ? microType(theme) : role === 'secondary' ? theme.type.secondary : theme.type[role];
    if (!base) continue;
    const step = column?.[role];
    const sized = step !== undefined && step !== base.size ? { ...base, size: step } : base;
    // Every role carries its family so the measurer picks the right table; a role's own family (theme.type.title.family) wins.
    roles[role] = sized.family ? sized : { ...sized, family: theme.type.family };
  }
  return {
    ...theme,
    type: {
      family: theme.type.family,
      title: roles.title!,
      subtitle: roles.subtitle!,
      label: roles.label!,
      axis: roles.axis!,
      footnote: roles.footnote!,
      micro: roles.micro!,
      ...(roles.secondary ? { secondary: roles.secondary } : {}),
      ...(theme.type.numeric ? { numeric: theme.type.numeric } : {}),
      ...(theme.type.emphasis ? { emphasis: theme.type.emphasis } : {}),
    },
  };
}

/**
 * The table family's look, in every preset: column heads at weight 600
 * without tracking in the text ink, section headings at 500 with 0.14 em in
 * the text ink, 1 px rules under the head block and between rows, a block
 * rule above each open top-level block, no group or total ground, and the
 * family's air above and under the head and group rows. `colors` sets a
 * preset's own secondary ink, row rule and size bar. A fresh copy per preset,
 * so a merge never shares one object between themes.
 */
function tableFamily(colors: { secondary?: string; ruleInk?: string; barFill?: string } = {}): ThemeTable {
  return {
    head: { weight: 600, tracking: 0 },
    section: { weight: 500, lineHeight: 14 / 11, tracking: 0.14, ink: 'ink' },
    headPad: { top: 10, bottom: 8 },
    groupPad: { top: 8, bottom: 4 },
    ruleWidths: { head: 1, row: 1 },
    weights: { emphasis: 600 },
    mark: 'bare',
    endRule: 'none',
    fixedType: true,
    noPrevious: 'missing',
    ofWhich: 'ink',
    glyphs: { missing: '\u2013', suppressed: '\u2013' },
    groupGround: 'none',
    grounds: { total: 'transparent' },
    blockRule: 'rule',
    ...(colors.secondary === undefined ? {} : { inks: { secondary: colors.secondary } }),
    ...(colors.ruleInk === undefined ? {} : { ruleInk: colors.ruleInk }),
    ...(colors.barFill === undefined ? {} : { bar: { fill: colors.barFill } }),
  };
}

/** line weights. `theme.stroke` overrides each role. */
export const GRAMMAR_STROKE: Readonly<Record<StrokeRole, number>> = Object.freeze({ seam: 0.5, hair: 0.75, rule: 1, mark: 1.5, data: 2, focus: 2.5, casing: 5 });
/** The default dash patterns. `theme.dash` overrides each role. */
const GRAMMAR_DASH: Readonly<Record<DashRole, readonly number[]>> = Object.freeze({ reference: Object.freeze([4, 3]), dotted: Object.freeze([1, 3]) });
/** The two text weights: role text, and emphasis. */
export const WEIGHT_REGULAR = 400;
export const WEIGHT_EMPHASIS = 700;

/** The stroke width in px a chart draws for one grammar role. */
export function strokeToken(theme: Pick<Theme, 'stroke'>, role: StrokeRole): number {
  return theme.stroke?.[role] ?? GRAMMAR_STROKE[role];
}

/** The dash array a chart draws for one grammar role; a fresh copy, so a node may own it. */
export function dashToken(theme: Pick<Theme, 'dash'>, role: DashRole): number[] {
  return [...(theme.dash?.[role] ?? GRAMMAR_DASH[role])];
}

/** The dash a value axis draws its gridlines in (`theme.valueAxis.gridDash`); none when solid. */
export function gridDash(theme: Pick<Theme, 'dash' | 'valueAxis'>): { dash?: number[] } {
  const style = theme.valueAxis?.gridDash;
  return style === 'dotted' ? { dash: dashToken(theme, 'dotted') } : style === 'dashed' ? { dash: dashToken(theme, 'reference') } : {};
}

/** The weight of a total, a hero figure or an authored focus. */
export function emphasisWeight(theme: Pick<Theme, 'type'>): number {
  return theme.type.emphasis?.weight ?? WEIGHT_EMPHASIS;
}

/**
 * The theme an annotation pass measures in when its chart draws every
 * annotation label in the emphasis weight: the seats then hold the bold text.
 */
export function emphasisLabelTheme<T extends Pick<Theme, 'type'>>(theme: T): T {
  return { ...theme, type: { ...theme.type, label: { ...theme.type.label, weight: emphasisWeight(theme) } } };
}

/** The weight of table totals, subtotals, results and parent rows: `table.weights.emphasis`, else the emphasis weight. */
export function tableEmphasis(theme: Pick<Theme, 'type' | 'table'>): number {
  return theme.table?.weights?.emphasis ?? emphasisWeight(theme);
}

/**
 * A table ink by role: the authored `table.inks` key, else the text ink, or
 * `table.inks.secondary` (else the muted ink) for the roles that step back.
 * 'rule' is `table.ruleInk`, else 25% of the ink in the background.
 */
export function tableInkColor(theme: Pick<Theme, 'color' | 'table'>, role: keyof NonNullable<ThemeTable['inks']> | 'rule'): string {
  if (role === 'rule') return theme.table?.ruleInk ?? mixColors(theme.color.ink, theme.color.background, 0.25);
  const ink = theme.table?.inks?.[role];
  if (ink !== undefined) return ink;
  if (role === 'secondary') return theme.color.inkMuted;
  return SECONDARY_TABLE_ROLES.has(role) ? tableInkColor(theme, 'secondary') : theme.color.ink;
}
const SECONDARY_TABLE_ROLES: ReadonlySet<string> = new Set(['qualifier', 'operator', 'driver', 'toggle']);

/** The weight of a structural heading such as a diagram pillar, phase or branch: semibold, never above the emphasis weight. */
export function headingWeight(theme: Pick<Theme, 'type'>): number {
  return Math.min(600, emphasisWeight(theme));
}


/**
 * The shipped presets below form one token system.
 *
 * tests/theme-presets-validate.test.ts runs validateTheme over every preset.
 * Shared semantic layer across all three: good #0FA060 / bad #E2564A used
 * ONLY for judgment; the accent used ONLY for emphasis/totals; neutral
 * ramps carry all structure.
 */

/** Steel neutrals, deep blue accent. */
export const standardTheme: Theme = {
  name: 'standard',
  table: tableFamily(),
  color: {
    good: '#0FA060',
    bad: '#E2564A',
    neutral: '#79828C',
    neutralLight: '#CFD7DD',
    highlight: '#10529E',
    total: '#10529E',
    others: '#EDF0F3',
    // An Others mark has no outline by default, so it steps past the page floor (1.43:1);
    // the ground uses of color.others keep the quieter step.
    othersMark: '#D4D8DC',
    ink: '#0E1A26',
    inkInverse: '#FFFFFF',
    inkMuted: '#5C6B7A',
    axis: '#0E1A26',
    grid: '#E9EDF1',
    leader: '#9AA6B1',
    background: '#FFFFFF',
    series: [...ATLANTIC_SERIES, '#680000', '#B85800'],
    // Navy, mid and a light step about 1.75:1 on the page (dark ink reads 9.9:1 on it).
    stack: ['#075A8E', '#4C95C8', '#A9C6DC'],
    seriesOverflow: 'repeatLast',
    palettes: { atlantic: [...ATLANTIC_SERIES] },
    status: {
      advanced: '#79828C',
      open: '#CFD7DD',
      lost: '#E2564A',
      pending: '#9CA5AD',
      won: '#10529E',
      'gantt-workstream': '#477EAF',
      'gantt-detail': '#AEB7BE',
      'gantt-special': '#10529E',
      'gantt-cadence': '#477EAF',
    },
    colorblind: { good: '#457FE0', bad: '#A48228', badFill: LIGHT_CB_BAD_FILL },
    warn: '#8F6A00',
    warnFill: LIGHT_WARN_FILL,
  },
  scenario: { AC: 'solid', PY: 'solidLight', PL: 'outline', FC: 'hatch45' },
  pattern: { hatchAngle: 45, hatchColor: 'segment', hatchGap: 6, hatchStrokeWidth: 0.75, outlineStrokeWidth: 1.5 },
  // The canonical type scale.
  type: canonicalType("'Helvetica Neue', Helvetica, Arial, sans-serif"),
  space: { tierGap: 5, facetGap: 28, labelPad: 5 },
  surface: { chipTint: 0.9, rowTint: 0.94, elapsedTint: 0.95, anchorTint: 0.97, chipRadius: 2 } as SurfaceWithAnchorTint,
};

/** Atlantic identity on a dark navy surface; judgment colors stay fixed. */
export const standardDarkTheme: Theme = {
  ...standardTheme,
  name: 'standard-dark',
  table: tableFamily({ secondary: '#9EC3E2', ruleInk: '#344B60', barFill: '#22384D' }),
  color: {
    ...standardTheme.color,
    neutral: '#A9B5C0',
    neutralLight: '#667583',
    highlight: '#67A9EA',
    total: '#67A9EA',
    others: '#263542',
    // An Others mark has no outline by default, so it steps past the page floor (1.58:1);
    // the ground uses of color.others keep the quieter navy.
    othersMark: '#2F3D4A',
    ink: '#F4F7FA',
    inkInverse: '#0E1A26',
    inkMuted: '#AAB7C4',
    axis: '#DCE4EB',
    grid: '#2A3947',
    leader: '#758596',
    background: '#0E1A26',
    series: [...ATLANTIC_DARK_SERIES, '#F8C030', '#60E8A8'],
    // Strongest first, kept apart from the focus (#67A9EA); the quietest step sits
    // about 1.77:1 on the navy page (the light ink reads 9.2:1 on it).
    stack: ['#C2DCF5', '#4F7DA6', '#2A4560'],
    palettes: { atlantic: [...ATLANTIC_DARK_SERIES] },
    // The light presets' rust bad fill, hatched, sits 6.5 OKLab from a cell
    // with no status on the navy page; this page keeps colorblind.bad as fill.
    colorblind: { good: standardTheme.color.colorblind.good, bad: standardTheme.color.colorblind.bad },
    warn: DARK_WARN,
    warnFill: DARK_WARN,
    status: {
      ...standardTheme.color.status,
      advanced: '#A9B5C0',
      open: '#667583',
      pending: '#7C8995',
      won: '#67A9EA',
      'gantt-workstream': '#4D8EC5',
      'gantt-detail': '#667583',
      'gantt-special': '#67A9EA',
      'gantt-cadence': '#4D8EC5',
    },
  },
};

/** Strict notation — pure greys, grey totals, denser rhythm. */
export const notationTheme: Theme = {
  name: 'notation',
  table: tableFamily(),
  color: {
    // Tone text reaches 4.5:1 on the page and on its chip;
    // the signed fills keep the brighter pair.
    good: '#0C7B4A',
    goodFill: '#0FA060',
    bad: '#C13743',
    badFill: '#E2564A',
    neutral: '#818181',
    // The marks that paint in the neutral (a scatter's neutral group, a
    // butterfly's first side) sit 12 OKLab from the first series #6D6D6D;
    // the neutral itself stays the band and ladder ground.
    neutralMark: '#939393',
    neutralLight: '#D9D9D9',
    // The notation preset highlights with one signal colour. A grey accent would sit one step from
    // the neutral (#808080 against #818181), so a highlighted effect, a
    // butterfly's second side and an info state would read as the neutral.
    highlight: '#2A6CBA',
    total: '#404040',
    others: '#EFEFEF',
    // An Others mark has no outline by default, so it steps past the page floor (1.43:1);
    // the ground uses of color.others keep the quieter grey.
    othersMark: '#D8D8D8',
    ink: '#1A1A1A',
    inkInverse: '#FFFFFF',
    inkMuted: '#595959',
    axis: '#1A1A1A',
    grid: '#E6E6E6',
    leader: '#A0A0A0',
    background: '#FFFFFF',
    // Five greys is the most that keep 3:1 as marks and 12 OKLab apart (0.54,
    // 0.29, 0.66, 0.41, 0.15 lightness); the six pale greys before sat 5 apart.
    series: ['#6D6D6D', '#2A2A2A', '#939393', '#4A4A4A', '#0C0C0C'],
    seriesOverflow: 'repeatLast',
    status: {
      advanced: '#818181',
      open: '#D5D5D5',
      lost: '#E2564A',
      pending: '#A4A4A4',
      won: '#404040',
      'gantt-workstream': '#818181',
      'gantt-detail': '#B5B5B5',
      'gantt-special': '#404040',
      'gantt-cadence': '#6F6F6F',
    },
    // Colorblind-safe pair: a blue apart from the signal
    // accent and an orange apart from the amber warn under protan and deutan
    // vision, both mid-tone so ink furniture and the page read against them.
    colorblind: { good: '#5588FB', bad: '#E16D08', badFill: LIGHT_CB_BAD_FILL },
    warn: '#896600',
    warnFill: LIGHT_WARN_FILL,
  },
  scenario: { AC: 'solid', PY: 'solidLight', PL: 'outline', FC: 'hatch45' },
  pattern: { hatchAngle: 45, hatchColor: 'segment', hatchGap: 6, hatchStrokeWidth: 0.75, outlineStrokeWidth: 1.5 },
  // The canonical type scale, with regular body text. Notation identity
  // lives in the grey ramp, notation, and rhythm tokens below, not in a
  // private type scale.
  type: canonicalType("Arial, 'Helvetica Neue', sans-serif"),
  space: { tierGap: 4, facetGap: 24, labelPad: 4 },
  surface: { chipTint: 0.9, rowTint: 0.94, elapsedTint: 0.95, anchorTint: 0.97, chipRadius: 0 } as SurfaceWithAnchorTint,
};

/**
 * Notation dark profile. Printed notation assumes white paper; on screen the
 * grey hierarchy is inverted so AC is the strongest light solid, PY is the
 * quieter grey, FC stays hatched, and PL stays outlined against the surface.
 */
export const notationDarkTheme: Theme = {
  ...notationTheme,
  name: 'notation-dark',
  color: {
    ...notationTheme.color,
    // On the near-black page the bright tones read as text at 5:1 or more;
    // the fills are notation's own.
    good: '#0FA060',
    bad: '#E2564A',
    neutral: '#D5D5D5',
    neutralMark: '#D5D5D5',
    // Below the series greys, so a bartable range and a receded mark stay
    // apart from every series.
    neutralLight: '#3A3A3A',
    // The light-side signal colour, lifted for the dark page.
    highlight: '#64A9F3',
    total: '#ACACAC',
    others: '#303030',
    // The light preset's Others mark is a light grey: the dark page's Others mark is `others` (1.52:1).
    othersMark: undefined,
    ink: '#F2F2F2',
    inkInverse: '#080808',
    inkMuted: '#AFAFAF',
    axis: '#E5E5E5',
    grid: '#333333',
    leader: '#777777',
    background: '#080808',
    series: [...NOTATION_DARK_SERIES],
    warn: DARK_WARN,
    warnFill: DARK_WARN,
    status: {
      ...notationTheme.color.status,
      advanced: '#D5D5D5',
      open: '#858585',
      pending: '#5E5E5E',
      // Apart from the neutral #D5D5D5 a maturity key shows beside it.
      won: '#FFFFFF',
      'gantt-workstream': '#ACACAC',
      'gantt-detail': '#858585',
      'gantt-special': '#F2F2F2',
      'gantt-cadence': '#D5D5D5',
    },
    colorblind: { good: '#417CE4', bad: '#A48228' },
  },
};

/**
 * The four design families, parsed from src/core/themeFamilies/*.json, the
 * files the demo build renders with — ONE source per family. The
 * schema pass runs at module load so a family that stops parsing breaks the
 * build, not a later render; tsup inlines the JSON, so the installed package
 * carries the themes without any repo-relative file read.
 */
export const roadshowFamilyThemes: Readonly<
  Record<'boardroom' | 'capital' | 'studio' | 'glass', Theme>
> = Object.freeze({
  boardroom: { ...(boardroomFamilyJson as Theme), table: tableFamily({ secondary: '#305B86', ruleInk: '#C3D3E3', barFill: '#D6E3F0' }) },
  capital: { ...(capitalFamilyJson as Theme), table: tableFamily() },
  studio: { ...(studioFamilyJson as Theme), table: tableFamily() },
  glass: { ...(glassFamilyJson as Theme), table: tableFamily() },
});

/** The glass design family. */
export const glassTheme: Theme = roadshowFamilyThemes.glass;

/**
 * Theme registry. Null-prototype ON PURPOSE: this map is indexed by
 * caller-supplied names (`--theme <name>`, `options.theme`), and on a plain
 * object `themes['constructor']` resolves to Object's own constructor — the
 * clean unknown-theme error is bypassed and the caller gets a raw TypeError
 * from chart code instead. `Object.create(null)` removes the inherited keys
 * for EVERY consumer of this export (CLI included), not just resolveTheme.
 */
export const themes: Record<string, Theme> = Object.assign(Object.create(null) as Record<string, Theme>, {
  boardroom: roadshowFamilyThemes.boardroom,
  capital: roadshowFamilyThemes.capital,
  studio: roadshowFamilyThemes.studio,
  glass: roadshowFamilyThemes.glass,
  standard: standardTheme,
  'standard-dark': standardDarkTheme,
  notation: notationTheme,
  'notation-dark': notationDarkTheme,
});

const PRESET_NAMES = /* @__PURE__ */ new Set(/* @__PURE__ */ Object.keys(themes));

/**
 * Design-interface entry point: register a validated external theme so every
 * surface (React, CLI, demo) can reference it by name. Presets cannot be
 * overwritten. Re-registering the same custom name replaces it (live editor).
 */
export function registerTheme(theme: Theme): void {
  if (PRESET_NAMES.has(theme.name)) {
    throw new NormalizeError('theme-name-reserved', 'theme.name', `'${theme.name}' is a built-in preset`);
  }
  themes[theme.name] = theme;
  registrations++;
}

let registrations = 0;
/** Counts registerTheme calls: a layout cache keyed by a theme name adds it, so a replaced theme misses. */
export const themeRegistrations = (): number => registrations;


/**
 * Themes this module itself produced. `layoutResolvedRequest` hands the
 * RESOLVED theme back to every layout as `{ preset, overrides: theme }`, and
 * a chart lays out several times per render (the fit passes, the legend
 * probe, the container probe), so the structural check below would run five or six
 * times per chart over a theme that came out of this very function. A patch
 * a CALLER wrote is never in here and is checked in full.
 */
const ownThemes = new WeakSet<object>();
const normalizedThemes = new WeakMap<Theme, Theme>();

/**
 * Patches the library builds from tokens that are already checked: the
 * compact band's spacing over a preset or over a theme this module resolved.
 * They are merged exactly as a caller's patch, and skip only the structural
 * checks, so a chart in the compact band does not wait for the chunk that
 * carries them (see core/deferred).
 */
const libraryPatches = new WeakSet<object>();

/** Marks `patch` as built by the library when everything it carries over from `authored` is already checked. */
export function libraryPatch<T extends object>(patch: T, authored: object): T {
  if (Object.keys(authored).length === 0 || ownThemes.has(authored)) libraryPatches.add(patch);
  return patch;
}

/** Objects this module froze all the way down. Only these may be skipped. */
const deepFrozen = new WeakSet<object>();

/**
 * Deep-freezes a value. A container that is already frozen is still walked:
 * a caller may register `Object.freeze(theme)` with a mutable `color` inside,
 * and `Object.isFrozen` on the outer object says nothing about its children.
 * Only an object this function itself finished is skipped.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || deepFrozen.has(value)) return value;
  if (!Object.isFrozen(value)) Object.freeze(value);
  // Every own property, enumerable or not: a theme may define a branch such as
  // `color` non-enumerably and shape validation still reads it. Accessors hold
  // no value to freeze; a data property's value is walked.
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value);
  }
  deepFrozen.add(value);
  return value;
}

/**
 * Records and returns a theme this module vouches for, FROZEN.
 *
 * The freeze is what makes the vouch honest. A resolved theme is handed to
 * the caller, and `layoutResolvedRequest` hands it straight back as
 * `overrides`; without the freeze a caller could take the theme it was
 * given, set `color.good` to `color.background`, pass it back, and the
 * identity cache would wave through a patch the checks exist to refuse.
 * Frozen, the mutation throws where it is written — modules are strict — and
 * the object the cache remembers is the object it judged.
 *
 * Nothing inside the library writes to a resolved theme: `themeForWidth`,
 * `themeForDensity` and the palette resolvers all build a new object from a
 * spread. A caller that wants a variant does the same, or passes overrides.
 */
function own(theme: Theme): Theme {
  if (ownThemes.has(theme)) return theme;
  const known = normalizedThemes.get(theme);
  if (known) return known;
  const normalized = themeColors(theme);
  if (normalized !== theme) {
    deepFreeze(theme);
    normalizedThemes.set(theme, normalized);
  }
  ownThemes.add(normalized);
  return deepFreeze(normalized);
}

/** Replace the six role sizes and their S/L steps; keep all other type tokens. */
export function typeForTarget(base: Theme['type'], target: RenderTarget): Theme['type'] {
  const sizes = targetTypeSizesPx(target, 'M');
  const roles = Object.fromEntries(TYPE_ROLE_NAMES.map(role => [role, {
    ...(role === 'micro' ? base.micro ?? { family: base.family, weight: 400, lineHeight: 1.2 } : role === 'secondary' ? base.secondary ?? base.axis : base[role]),
    size: sizes[role],
  }]));
  return { ...base, ...roles, scale: { S: targetTypeSizesPx(target, 'S'), L: targetTypeSizesPx(target, 'L') } };
}

const targetThemes = new WeakMap<Theme, Map<RenderTarget, Theme>>();
/**
 * Preset appearance, target sizes, authored overrides, then `textScale`
 * (custom themes stay authored, and are scaled too). A resolved theme that
 * travels back as full overrides is already scaled and comes back as it is.
 * With `textSize` the theme drops its S and L columns and scales the middle
 * column so its label is `textSize` px: every width class draws the same sizes.
 */
export function resolveTargetTheme(ref: ThemeRef | undefined, target: RenderTarget, textScale = 1, textSize?: number): Theme {
  const theme = targetTheme(ref, target);
  if (typeof ref === 'object' && ref.overrides && ownThemes.has(ref.overrides)) return theme;
  if (textSize !== undefined) {
    const pinned = pinnedTheme(theme);
    return scaledTextTheme(pinned, textSize / pinned.type.label.size, target);
  }
  return textScale === 1 ? theme : scaledTextTheme(theme, textScale, target);
}

const pinnedThemes = new WeakMap<Theme, Theme>();

/**
 * The theme with the middle width column in every class: the S and L steps
 * repeat the middle sizes. (Dropping `type.scale` would not do: a resolved
 * theme travels as overrides and is merged over its preset, which would bring
 * the preset's own steps back.) Cached, so one theme keeps one pinned theme.
 */
function pinnedTheme(theme: Theme): Theme {
  let pinned = pinnedThemes.get(theme);
  if (!pinned) {
    const middle = Object.fromEntries(TYPE_ROLE_NAMES.flatMap(role => {
      const spec = role === 'micro' ? microType(theme) : role === 'secondary' ? theme.type.secondary : theme.type[role];
      return spec ? [[role, spec.size]] : [];
    })) as Partial<Record<TypeRoleName, number>>;
    pinned = own({ ...theme, type: { ...theme.type, scale: { S: { ...middle }, L: { ...middle } } } });
    pinnedThemes.set(theme, pinned);
  }
  return pinned;
}

const scaledThemes = new WeakMap<Theme, Map<string, Theme>>();

/**
 * The theme with every text size multiplied by `textScale`: the six roles,
 * their S and L steps, the KPI eyebrow and the absolute table faces (head,
 * section). Line heights and tracking are ratios and stay; the table toggle
 * is a box, and the qualifier's size delta stays in px. A scale under 1 stops at the target's
 * floor of each role (scaleTextAtFloor). Cached per theme, scale and target, so
 * one chart keeps one theme object (React snapshot keys read it).
 */
function scaledTextTheme(theme: Theme, textScale: number, target: RenderTarget): Theme {
  let byScale = scaledThemes.get(theme);
  if (!byScale) { byScale = new Map(); scaledThemes.set(theme, byScale); }
  const known = byScale.get(`${target}:${textScale}`);
  if (known) return known;
  const floors = targetFloorsPx(target);
  const px = (size: number, floor: number): number => scaleTextAtFloor(size, textScale, floor);
  const type = theme.type;
  const roles = Object.fromEntries(TYPE_ROLE_NAMES.flatMap(role => {
    const spec = role === 'micro' ? microType(theme) : type[role];
    return spec ? [[role, { ...spec, size: px(spec.size, floors[role]) }]] : [];
  })) as Record<TypeRoleName, FontSpec>;
  const step = (column?: Partial<Record<TypeRoleName, number>>) => column && Object.fromEntries(Object.entries(column).map(([role, size]) => [role, px(size!, floors[role as TypeRoleName])]));
  const table = theme.table;
  const face = <F extends { size?: number }>(value: F | undefined, floor: number): F | undefined => value?.size === undefined ? value : { ...value, size: px(value.size, floor) };
  const scaled = own({
    ...theme,
    type: {
      ...type,
      ...roles,
      ...(type.scale ? { scale: { ...(type.scale.S ? { S: step(type.scale.S) } : {}), ...(type.scale.L ? { L: step(type.scale.L) } : {}) } } : {}),
      ...(type.eyebrow ? { eyebrow: face(type.eyebrow, floors.micro) } : {}),
    },
    ...(table ? { table: {
      ...table,
      ...(table.head ? { head: face(table.head, tableHeadFloorPx(target)) } : {}),
      ...(table.section ? { section: face(table.section, floors.label) } : {}),
    } } : {}),
  });
  byScale.set(`${target}:${textScale}`, scaled);
  return scaled;
}

/** The registered name a preset name draws as: a retired preset name draws as its successor. */
function currentPreset(name: string): string {
  return !Object.hasOwn(themes, name) && Object.hasOwn(RETIRED_PRESETS, name) ? RETIRED_PRESETS[name]!.to : name;
}

function targetTheme(ref: ThemeRef | undefined, target: RenderTarget): Theme {
  const preset = currentPreset(typeof ref === 'string' ? ref : ref?.preset ?? 'boardroom');
  // A registered/uploaded complete theme owns its sizes. Internal resolved themes
  // also travel as full overrides and must not receive the target table twice.
  if (!PRESET_NAMES.has(preset) || (typeof ref === 'object' && ref.overrides && ownThemes.has(ref.overrides))) {
    return resolveTheme(ref);
  }
  const base = resolveTheme(preset);
  let byTarget = targetThemes.get(base);
  if (!byTarget) { byTarget = new Map(); targetThemes.set(base, byTarget); }
  let sized = byTarget.get(target);
  if (!sized) { sized = own({ ...base, type: typeForTarget(base.type, target) }); byTarget.set(target, sized); }
  return typeof ref === 'object' && ref.overrides ? validatedOverride(sized, ref.overrides, preset) : sized;
}

/** Carries the removal warnings of the authored request through the wrapped theme reference to the layout. */
export const REMOVED_NAMES = Symbol('removedNames');

/** The `option-deprecated` warnings for the retired preset name and theme keys of one chart's authored theme. */
export function removedNameWarnings(options: { theme?: unknown; palette?: unknown } | undefined): LintWarning[] {
  const warnings: LintWarning[] = [];
  const ref = options?.theme;
  // Our own wrapped reference (see REMOVED_NAMES): the layout that wrapped it already reported.
  if (ref !== null && typeof ref === 'object' && ownThemes.has((ref as { overrides?: object }).overrides ?? {})) return warnings;
  const authored = typeof ref === 'string' ? ref : ref !== null && typeof ref === 'object' ? (ref as { preset?: unknown }).preset : undefined;
  if (typeof authored !== 'string') return warnings;
  const preset = currentPreset(authored);
  if (preset !== authored) {
    const field = typeof ref === 'string' ? ['options', 'theme'] : ['options', 'theme', 'preset'];
    const path = `/${field.join('/')}`;
    warnings.push({
      code: 'option-deprecated', severity: 'warn', field,
      message: RETIRED_PRESETS[authored]!.same
        ? `Theme preset '${authored}' is renamed '${preset}'.`
        : `Theme preset '${authored}' is retired and draws as '${preset}'.`,
      suggest: `Set the theme preset to '${preset}'.`,
      fix: [{ op: 'test', path, value: authored }, { op: 'replace', path, value: preset }],
    });
  }
  const base = Object.hasOwn(themes, preset) ? themes[preset] : adoptedTheme(preset);
  const overrides = ref && typeof ref === 'object' ? (ref as Exclude<ThemeRef, string>).overrides : undefined;
  const has = (theme: unknown, dotted: string) => dotted.split('.').reduce<unknown>((node, key) =>
    node !== null && typeof node === 'object' && Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined, theme) !== undefined;
  for (const dotted of Object.keys(RETIRED_THEME_KEYS)) {
    const inOverrides = has(overrides, dotted);
    const inBase = has(base, dotted);
    if (inOverrides && !inBase) warnings.push(retiredThemeKeyWarning(dotted, ['options', 'theme', 'overrides']));
    // Removing the override would leave the key in the registered theme: the advice names its definition.
    else if (inBase) {
      warnings.push({
        code: 'option-deprecated', severity: 'warn', field: ['options', 'theme'],
        message: `Theme key ${dotted} is retired and ignored.`,
        suggest: `Remove ${dotted} from the '${preset}' theme definition${inOverrides ? ' and authored overrides' : ''}. ${RETIRED_THEME_KEYS[dotted]}`,
      });
    }
  }
  return warnings;
}

export function resolveTheme(ref?: ThemeRef): Theme {
  // The shipped default is the boardroom design family. A document that wants
  // the standard family pins `theme: 'standard'` explicitly.
  if (!ref) return own(roadshowFamilyThemes.boardroom);
  const presetName = typeof ref === 'string' ? currentPreset(ref) : typeof ref.preset === 'string' ? currentPreset(ref.preset) : ref.preset;
  // A registered theme, else one a spec brought along (core/themeStore). Own
  // keys only: a name is data, never a path to Object.prototype; a non-string
  // name matches neither.
  const base = Object.hasOwn(themes, presetName) ? themes[presetName] : adoptedTheme(presetName);
  if (!base) {
    // A theme a spec brought along travels with its request as { preset: its
    // content-addressed name, overrides: every token } (core/doc/themeObject).
    // When the lookup cache does not hold the name, the tokens are the theme.
    if (typeof ref === 'object' && ref.overrides && !requireDeferred('theme-rules').checkThemeShape(ref.overrides).length) return own(ref.overrides as Theme);
    throw new NormalizeError(
      'unknown-theme',
      'options.theme',
      `unknown theme '${String(presetName)}'`,
      Object.keys(themes).join(', '),
    );
  }
  if (typeof ref === 'string' || !ref.overrides) return own(base);
  return validatedOverride(base, ref.overrides, presetName);
}

/**
 * The merged themes this module has already produced, by the IDENTITY of the
 * two objects they were merged from.
 *
 * A preset resolves to the registered object every time, and a chart whose
 * theme is a preset hydrates a prepared snapshot without laying out again.
 * The same chart with `{ preset, overrides }` laid out once more, because
 * the merge returned a fresh object on every call: `geometryKey` reads the
 * resolved theme, so two renders of the SAME props produced two keys and
 * the second render rejected the snapshot the first had matched.
 *
 * Keyed by the caller's overrides object inside a map keyed by the base, so
 * both die with their inputs. A patch with the same CONTENT in a new object
 * is a new input: it resolves and is checked exactly as before.
 */
const mergedThemes = new WeakMap<object, WeakMap<object, Theme>>();

function memoizedMerge(base: Theme, overrides: object, resolve: () => Theme): Theme {
  let byOverrides = mergedThemes.get(base);
  if (!byOverrides) { byOverrides = new WeakMap(); mergedThemes.set(base, byOverrides); }
  const known = byOverrides.get(overrides);
  if (known) return known;
  const resolved = resolve();
  byOverrides.set(overrides, resolved);
  return resolved;
}

/**
 * A patch is external input, so the MERGED RESULT is validated — the same
 * gate `parseThemeJson` applies to a whole-theme upload. Without it a legal
 * patch shape (`{color:{series:42}}`, `{color:{ink:99}}`, `{space:{tierGap:400}}`,
 * `{color:{good:'#FFFFFF'}}`) produced either a raw TypeError deep inside a
 * layout or a silently unreadable chart with `warnings: []`. Derived values
 * are computed, never trusted — so is a theme.
 */
function validatedOverride(base: Theme, overrides: DeepPartial<Theme>, presetName: string): Theme {
  return memoizedMerge(base, overrides as object, () => checkedOverride(base, overrides, presetName));
}

/**
 * An authored role size holds in every width class. The
 * preset's S and L steps for that role would replace it below 720 px and from
 * 1080 px, so the patch carries the size into each step the preset has. A
 * step the patch names itself still wins.
 */
function authoredSizesHold(base: Theme, overrides: DeepPartial<Theme>): DeepPartial<Theme> {
  const type = overrides.type as Record<string, { size?: unknown } | undefined> | undefined;
  if (typeof type !== 'object' || type === null) return overrides;
  const steps: Record<string, Record<string, unknown>> = {};
  const roles: Record<string, object> = {};
  for (const role of TYPE_ROLE_NAMES) {
    if (typeof type[role]?.size === 'number') roles[role] = { ...type[role], [AUTHORED_TYPE_SIZE]: true };
  }
  for (const column of ['S', 'L'] as const) {
    for (const role of TYPE_ROLE_NAMES) {
      const size = type[role]?.size;
      if (typeof size === 'number' && base.type.scale?.[column]?.[role] !== undefined) (steps[column] ??= {})[role] = size;
    }
  }
  return Object.keys(roles).length > 0 ? { ...overrides, type: { ...type, ...roles, scale: mergeDeep(steps, type.scale as never) } } as DeepPartial<Theme> : overrides;
}

/**
 * An authored `type.family` reaches every role the patch does not give a
 * family of its own: the preset's roles carry the preset family, and a role's
 * family is drawn as it stands.
 */
function familyFollows(base: Theme, overrides: DeepPartial<Theme>): DeepPartial<Theme> {
  const type = overrides.type as Record<string, { family?: unknown } | undefined> & { family?: unknown } | undefined;
  if (typeof type?.family !== 'string' || type.family === base.type.family) return overrides;
  const roles: Record<string, object> = {};
  for (const role of TYPE_ROLE_NAMES) {
    // Only a role that carries the preset family follows; one without a family draws the global one already.
    if (base.type[role]?.family === base.type.family && typeof type[role]?.family !== 'string') roles[role] = { ...type[role], family: type.family };
  }
  return { ...overrides, type: { ...type, ...roles } } as DeepPartial<Theme>;
}

function checkedOverride(base: Theme, overrides: DeepPartial<Theme>, presetName: string): Theme {
  // Our own output coming back in: nothing external to judge, and the merge
  // is the same merge. This is what keeps the checks — and the chunk that
  // carries them — off the render path of every chart.
  if (ownThemes.has(overrides as object)) return own(mergeDeep(base, overrides));
  if (libraryPatches.has(overrides as object)) return own(mergeDeep(base, overrides));
  const series = overrides.color?.series;
  // One or two authored colours are a prefix of the preset ramp. Keep older,
  // complete ramp overrides unchanged, including their overflow policy.
  const authored = Array.isArray(series) ? series.filter((value): value is string => typeof value === 'string') : [];
  if (Array.isArray(series) && authored.length === series.length && series.length > 0 && series.length < 3) {
    const ramp = [...authored];
    const used = new Set(authored.map(value => JSON.stringify(parseColor(value))));
    for (const value of base.color.series) {
      const key = JSON.stringify(parseColor(value));
      if (used.has(key)) continue;
      ramp.push(value);
      used.add(key);
      if (ramp.length >= base.color.series.length) break;
    }
    overrides = { ...overrides, color: { ...overrides.color, series: ramp } };
  }
  // A retired key, authored or in a registered base, is ignored; removedNameWarnings reports it.
  const merged = withoutRetiredThemeKeys(mergeDeep(base, familyFollows(base, authoredSizesHold(base, overrides)))).theme;
  const rules = requireDeferred('theme-rules');
  const issues = rules.checkThemeShape(merged);
  if (issues.length > 0) {
    const repair = rules.unknownThemeKeyRepair(issues, '/options/theme/overrides');
    throw new NormalizeError(
      'invalid-theme-override',
      'options.theme.overrides',
      `overrides on preset '${presetName}' produce a structurally invalid theme — ${issues.join('; ')}`,
      repair?.suggest ?? 'keep each token within its declared type and bounds',
      repair?.fix,
    );
  }
  // `parsed.data` is the GATE, not the result: the schema does not model
  // surface.anchorTint, so returning it would silently drop shipped tokens.
  // A patch is answerable only for what IT breaks. A preset may carry an
  // error lint of its own; blocking on the merged lint set outright would
  // make every unrelated override of that preset fail, and would hand future preset drift the
  // power to break call sites that never touched the drifting token. So the
  // gate is the DIFF: error lints the merged theme has and the base does not.
  // The gate STOPS HERE, at the schema. Everything the gate has reported —
  // `color.series is not iterable`, `value.trim is not a function`, spacing
  // outside its declared bounds — is a shape or bounds violation, and
  // `checkThemeShape` above catches every one of them. That is what stops
  // a patch from crashing a layout.
  // What follows deliberately does NOT throw. `validateTheme` is a TASTE layer:
  // it judges contrast and colour proximity, and on those questions a caller's
  // eye beats a threshold. Escalating it to a hard error on the override path
  // rejected a legitimate shipped dark theme whose `warn` (#F2C14E amber) and
  // `bad` (#FF7B72 salmon) sit ~80 apart in RGB — plainly distinguishable, and
  // called "nearly identical" by a lint that is
  // over-sensitive here. A taste threshold must remain a warning, not masquerade as
  // a correctness error.
  // So: a patch cannot produce a structurally invalid theme, and it CAN produce
  // an ugly one — loudly, in the warning stream, where the person who chose the
  // colours can overrule it.
  // ONE exception, and it is not a taste call: a judgment token painted the
  // exact colour of its own background carries no information at all. That is
  // erasure, not proximity, and it gets its own lint code precisely so it can be
  // separated from the "nearly identical" family. Still diffed against the base,
  // so a preset's own pre-existing defect is never charged to a caller who
  // patched something else.
  const blocking = rules.semanticErasureWarnings(base).length > 0 ? [] : rules.semanticErasureWarnings(merged);
  if (blocking.length > 0) {
    throw new NormalizeError(
      'invalid-theme-override',
      'options.theme.overrides',
      `overrides on preset '${presetName}' erase a judgment token — ${blocking
        .map((b) => `${b.code}: ${b.message}`)
        .join('; ')}`,
      blocking.find((b) => b.suggest)?.suggest,
    );
  }
  return own(merged);
}

/** Keys that mutate a prototype rather than a token; never merged. */
const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function mergeDeep<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined || patch === null) return base;
  if (Array.isArray(patch) || typeof patch !== 'object') return patch as T;
  const out: Record<string | symbol, unknown> = { ...(base as Record<string, unknown>) };
  if (AUTHORED_TYPE_SIZE in patch) out[AUTHORED_TYPE_SIZE] = true;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    // A theme patch names TOKENS. `__proto__`/`constructor` name machinery,
    // and assigning them here would mutate a prototype instead of the theme.
    if (UNSAFE_MERGE_KEYS.has(k)) continue;
    // base may lack the key entirely (e.g. overriding optional `palettes`
    // on a preset that has none) — treat the missing branch as undefined
    const bv = base == null ? undefined : (base as Record<string, unknown>)[k];
    out[k] = mergeDeep(bv, v as never);
  }
  return out as T;
}

/**
 * The stripe paint of a hatch. Stripes are lines a reader has to see, so a
 * fill too pale to reach 3:1 on the page as a line (a pale corridor or band)
 * draws its stripes in the same hue deepened toward the mark ink until
 * they do; a fill that reaches it keeps its own colour. An authored colour is
 * left as authored.
 */
export function hatchPaint(fill: Paint, theme: Theme, ground?: Paint, look?: HatchLook): Paint {
  const stripe = fullHatchPaint(fill, theme, ground, look?.stacked);
  // A grounded hatch that carries its strength resolves it with its ground.
  const grounded = 'theme' in stripe && stripe.theme?.kind === 'hatch-stripe' && stripe.theme.strength !== undefined;
  if (!look || look.strength >= 100 || grounded) return stripe;
  return {
    token: 'token' in stripe ? stripe.token : 'background',
    theme: { kind: 'hatch-fade', stripe, ground: ground ?? { token: 'background' }, strength: look.strength, cue: look.cue },
  };
}

function fullHatchPaint(fill: Paint, theme: Theme, ground?: Paint, stacked?: true): Paint {
  if (theme.pattern.hatchColor === 'ink') return { token: 'ink' };
  if ('css' in fill) return fill;
  // Stripes on their own ground are drawn together with it (hatchGroundPaint).
  if (ground && 'theme' in ground && ground.theme?.kind === 'hatch-ground') {
    const { peers, strength, apart } = ground.theme;
    return { token: fill.token, theme: { kind: 'hatch-stripe', base: fill, grounded: true, ...(peers ? { peers } : {}),
      ...(strength !== undefined ? { strength } : {}), ...(apart ? { apart } : {}) } };
  }
  const color = paintColor(theme, fill);
  const step = stacked && greyStepped(theme, color);
  if (contrastRatio(color, theme.color.background) >= MARK_CONTRAST_FLOOR && !step) return fill;
  return { token: fill.token, theme: { kind: 'hatch-stripe', base: fill, ...(step ? { stacked } : {}) } };
}

/**
 * options.hatchStrength: how strongly forecast, partial and no-data
 * hatches draw, 0 to 100, where 100 is the theme's recipe. Below 100 a stripe
 * fades toward its ground, and a second-cue hatch (a line or area forecast,
 * where the dashed line, the divider and the key already say "forecast") also
 * spreads its stripes, up to 2.5 times the theme's gap at 0. The fade stops at
 * the floor the cue needs: a sole-cue hatch keeps its stripes 3:1 on their
 * ground (the mark floor plus the FC margin) and its spacing, so its cell
 * still reads on the page; a second-cue hatch keeps 2:1, the faintest stripe
 * that still reads as a hatch. Default 60 on a second cue, 100 on a sole one.
 */
export const HATCH_STRENGTH_DEFAULT: Readonly<Record<HatchCue, number>> = { second: 60, sole: 100 };
const HATCH_SECOND_CUE_FLOOR = 2;
const HATCH_MAX_FADE = 0.65;
const HATCH_MAX_SPREAD = 1.5;

/** The stripe pitch a hatch draws at, as a multiple of the theme's gap: 1 for a sole cue. */
export function hatchGapFactor(look: HatchLook | undefined): number {
  return look?.cue === 'second' ? 1 + HATCH_MAX_SPREAD * (1 - look.strength / 100) : 1;
}

/**
 * The share of a hatched cell the colour rules count as stripe (effectiveFill, scenarioSeriesColor, the grounded
 * solver): the share a sole cue draws, its stripe width over its gap (0.75 px at 6 px, 12.5%), at any
 * hatchStrength. A second cue (a line or area forecast) draws thinner and wider apart than this.
 */
function hatchRuleCoverage(theme: Pick<Theme, 'pattern'>): number {
  return Math.min(1, theme.pattern.hatchStrokeWidth / theme.pattern.hatchGap);
}

/**
 * The stripe weight a hatch draws at, in px. A sole-cue hatch draws at the theme's
 * weight (0.75 px at 6 px pitch, 12.5%); a second-cue hatch (a line or area
 * forecast, where the dashed edge, the divider and the key also say "forecast") draws 0.7 of it.
 */
export function hatchStrokeWidthFor(theme: Pick<Theme, 'pattern'>, look: HatchLook | undefined): number {
  return theme.pattern.hatchStrokeWidth * (look?.cue === 'second' ? 0.7 : 1);
}

/** The faded stripe of a 'hatch-fade' recipe: toward its ground, never under its cue's floor. */
function hatchFadeColor(stripe: string, ground: string, strength: number, cue: HatchCue): string {
  const floor = cue === 'sole' ? MARK_CONTRAST_FLOOR + 0.12 : HATCH_SECOND_CUE_FLOOR;
  for (let step = Math.round(HATCH_MAX_FADE * (1 - strength / 100) * 100); step > 0; step--) {
    const faded = mixColors(ground, stripe, step / 100);
    if (contrastRatio(faded, ground) >= floor) return faded;
  }
  return stripe;
}

/**
 * Stamps every hatched node of one chart with the strength it draws at
 * (registry, after layout): the forecast area of a line or an area is a second
 * cue, every other hatch a sole one; a key swatch draws like the marks it
 * keys, sole when any of them is. A node already stamped (a grid panel's) keeps
 * its look.
 */
export function stampHatchLook(nodes: SceneNode[], strength: number | undefined): SceneNode[] {
  const hatched = (node: SceneNode): node is Extract<SceneNode, { t: 'rect' | 'path' }> =>
    (node.t === 'rect' || node.t === 'path') && isHatchPattern(node.pattern);
  const second = (node: Extract<SceneNode, { t: 'rect' | 'path' }>) => node.t === 'path' && node.part === 'area';
  const marks = nodes.filter((node) => hatched(node) && !node.hatch && node.id.startsWith('mark:'));
  const keyCue: HatchCue = marks.length > 0 && marks.every((node) => second(node as Extract<SceneNode, { t: 'path' }>)) ? 'second' : 'sole';
  return nodes.map((node) => {
    if (!hatched(node) || node.hatch) return node;
    const cue: HatchCue = node.id.startsWith('mark:') ? (second(node) ? 'second' : 'sole') : keyCue;
    return { ...node, hatch: { strength: strength ?? HATCH_STRENGTH_DEFAULT[cue], cue } } as SceneNode;
  });
}

/**
 * A fill that separates from the page and the page-like surfaces it may lie
 * on without an outline: a pale status bar deepens toward the mark ink
 * until it clears the page floor on each of them; a fill that already does
 * stays as it is.
 */
export function surfaceFloorPaint(base: Paint, surfaces: Paint[]): Paint {
  return { token: 'css' in base ? 'background' : base.token, theme: { kind: 'surface-floor', base, surfaces } };
}

/**
 * A sankey ribbon carries its flow value, so it is a data mark: on a light page
 * it clears the mark floor (markVisibilityFloor). The alpha starts at the
 * theme's `surface.ribbonAlpha` and rises only as far as the floor needs, so
 * crossing ribbons still show through each other. A base that misses the floor
 * even when opaque draws opaque and warns as a series (series-invisible).
 * A dark page keeps `surface.ribbonAlpha`: its 3:1 floor needs ribbons of up to
 * 97% alpha, and those hide the node bar they leave and the ribbons they cross.
 */
export function ribbonPaint(base: Paint): Paint {
  return { token: 'css' in base ? 'background' : base.token, theme: { kind: 'ribbon', base } };
}

function ribbonColor(theme: Theme, source: Extract<ThemePaintSource, { kind: 'ribbon' }>): string {
  const page = theme.color.background;
  const base = compositeColor(paintColor(theme, source.base), page);
  const rgb = parseColor(base);
  if (!rgb) return base;
  const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  const translucent = (alpha: number) => `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}${hex(alpha)}`;
  const start = Math.round(resolveSurface(theme).ribbonAlpha * 255);
  if (darkPage(theme)) return translucent(start);
  for (let alpha = start; alpha < 255; alpha++) {
    if (contrastRatio(mixColors(base, page, alpha / 255), page) >= markVisibilityFloor(page)) return translucent(alpha);
  }
  return base;
}

function surfaceFloorColor(theme: Theme, base: string, surfaces: string[]): string {
  const grounds = [theme.color.background, ...surfaces];
  // A little over the floor, so the mark-visibility check never lands on the edge.
  const floor = markVisibilityFloor(theme.color.background) + 0.05;
  const markInk = paintTokenColor(theme, 'markInk');
  for (let step = 0; step <= 50; step++) {
    const fill = step === 0 ? base : mixColors(markInk, base, step / 50);
    if (grounds.every((ground) => contrastRatio(fill, ground) >= floor)) return fill;
  }
  return markInk;
}

/** How much of the fill colour the ground under a hatch keeps at most. */
const HATCH_GROUND_SHARE = 0.5;

/**
 * The ground a hatch lies on inside its own mark (a forecast segment):
 * the fill washed toward the page, so the key still names the cell. Pass it
 * to `hatchPaint` as well; stripes and ground are resolved together.
 */
export function hatchGroundPaint(fill: Paint, peers?: readonly Paint[], grounding?: { strength: number; apart: Paint }): Paint {
  return { token: 'css' in fill ? 'background' : fill.token, theme: { kind: 'hatch-ground', base: fill, ...(peers ? { peers: [...peers] } : {}), ...grounding } };
}

/**
 * Hand every grounded hatch of one chart the fills of the others,
 * so the forecast stripes of series drawn together are resolved
 * together and keep the swatch floor between them, as their keys do.
 */
export function joinHatchPeers(nodes: SceneNode[]): SceneNode[] {
  const grounded = (node: SceneNode): node is Extract<SceneNode, { t: 'rect' }> =>
    node.t === 'rect' && node.hatchGround !== undefined && 'theme' in node.hatchGround && node.hatchGround.theme?.kind === 'hatch-ground';
  const peers = new Map<string, Paint>();
  for (const node of nodes) if (grounded(node)) peers.set(JSON.stringify(node.fill), node.fill);
  if (peers.size < 2) return nodes;
  const list = [...peers.values()];
  return nodes.map((node) => (grounded(node) ? { ...node, hatchGround: hatchGroundPaint(node.fill, list) } : node));
}

/**
 * Stripes and ground of a grounded hatch. The reader sees
 * the stripes on the ground and the cell on the page, so the stripes must
 * reach 3:1 on the ground and, on a light page, the cell must still separate
 * from the page. The ground gives way first: it moves from half the fill
 * toward the page until the stripes read on it. Only where that leaves a light
 * cell too pale do the stripes deepen toward the mark ink, a step at a time.
 * An ink stripe or an authored colour keeps its colour; its ground goes as far
 * as the page if it has to.
 */
function groundedHatchColors(
  theme: Theme, fill: string, authored = false, peers?: readonly { color: string; authored: boolean }[], grounding?: HatchGrounding,
): { stripe: string; ground: string } {
  if (!peers || peers.length < 2) {
    const soloKey = `${fill}|${authored}||${grounding?.strength ?? ''}|${grounding?.apart ?? ''}`;
    let soloCache = GROUNDED_HATCHES.get(theme);
    if (!soloCache) GROUNDED_HATCHES.set(theme, soloCache = new Map());
    const soloHit = soloCache.get(soloKey);
    if (soloHit) return soloHit;
    const solved = soloGroundedHatch(theme, fill, authored, undefined, grounding);
    soloCache.set(soloKey, solved);
    return solved;
  }
  const key = `${fill}|${authored}|${peers.map((peer) => `${peer.color}${peer.authored ? '*' : ''}`).join(',')}|${grounding?.strength ?? ''}|${grounding?.apart ?? ''}`;
  let cache = GROUNDED_HATCHES.get(theme);
  if (!cache) GROUNDED_HATCHES.set(theme, cache = new Map());
  const hit = cache.get(key);
  if (hit) return hit;
  // The strongest key on the page goes first: it needs the least, and every
  // paler one then stays a swatch apart from the stripes already drawn.
  const page = theme.color.background;
  const order = [...peers].sort((a, b) => contrastRatio(b.color, page) - contrastRatio(a.color, page));
  const drawn: { key: string; stripe: string }[] = [];
  let own = soloGroundedHatch(theme, fill, authored, undefined, grounding);
  for (const peer of order) {
    const solved = soloGroundedHatch(theme, peer.color, peer.authored, (stripe) =>
      drawn.every((other) => !swatchesApart(peer.color, other.key) || swatchesApart(stripe, other.stripe)), grounding);
    drawn.push({ key: peer.color, stripe: solved.stripe });
    if (peer.color === fill && peer.authored === authored) own = solved;
  }
  cache.set(key, own);
  return own;
}

function hatchPeers(theme: Theme, peers: readonly Paint[] | undefined): { color: string; authored: boolean }[] | undefined {
  return peers?.map((peer) => ({ color: paintColor(theme, peer), authored: 'css' in peer }));
}

/** A status hatch's strength and the colour of the cell with no status. */
interface HatchGrounding { strength: number; apart?: string }

function hatchGrounding(theme: Theme, source: { strength?: number; apart?: Paint }): HatchGrounding | undefined {
  return source.strength === undefined ? undefined : { strength: source.strength, ...(source.apart ? { apart: paintColor(theme, source.apart) } : {}) };
}

/**
 * hatchStrength on a grounded hatch (status cells): 60 draws the
 * recipe below, stripes at 3:1 on their ground; above it the stripes deepen
 * on the same ground, to 4.5:1 at 100; under 60 they fade toward their
 * ground, up to HATCH_MAX_FADE at 0, and stop where the cell would come
 * nearer a cell with no status than the swatch floor, or than the recipe at
 * 60 already stands.
 */
const GROUNDED_HATCH_DEFAULT = 60;
const GROUNDED_STRONG_TARGET = 4.5;

const GROUNDED_HATCHES = new WeakMap<Theme, Map<string, { stripe: string; ground: string }>>();

/** Two colours a reader tells apart as swatches: the palette floors (12 normal, 6 protan/deutan, 4 tritan). */
function swatchesApart(a: string, b: string): boolean {
  return palettePerceptualDistance(a, b, 'normal') >= PALETTE_NORMAL_FLOOR &&
    Math.min(palettePerceptualDistance(a, b, 'protan'), palettePerceptualDistance(a, b, 'deutan')) >= PALETTE_CVD_FLOOR &&
    palettePerceptualDistance(a, b, 'tritan') >= PALETTE_TRITAN_FLOOR;
}

/**
 * One grounded hatch. `allowed` stops the stripes deepening onto a
 * neighbour's: where that leaves the floors unmet, the stripes stay at the
 * last allowed step, the ground goes as light as the stripes need, and the
 * cell on the page gives (a pale series beside a darker one).
 */
function soloGroundedHatch(
  theme: Theme, fill: string, authored: boolean, allowed: (stripe: string) => boolean = () => true, grounding?: HatchGrounding,
): { stripe: string; ground: string } {
  const strength = grounding?.strength ?? GROUNDED_HATCH_DEFAULT;
  // The FC margin scenarioSeriesColor keeps above each floor.
  const solved = solveGroundedHatch(theme, fill, authored, allowed, MARK_CONTRAST_FLOOR + 0.12);
  if (strength > GROUNDED_HATCH_DEFAULT) {
    // Stronger: the stripes deepen toward the mark ink on the same ground, so
    // the cell only moves further from a cell with no status. An ink stripe or
    // an authored colour keeps its colour.
    if (theme.pattern.hatchColor === 'ink' || authored) return solved;
    const target = MARK_CONTRAST_FLOOR + 0.12 + (strength - GROUNDED_HATCH_DEFAULT) / (100 - GROUNDED_HATCH_DEFAULT) * (GROUNDED_STRONG_TARGET - MARK_CONTRAST_FLOOR - 0.12);
    const markInk = paintTokenColor(theme, 'markInk');
    for (let deepen = 1; deepen <= 100; deepen++) {
      const stripe = mixColors(markInk, solved.stripe, deepen / 100);
      if (!allowed(stripe)) break;
      if (contrastRatio(stripe, solved.ground) >= target) return { stripe, ground: solved.ground };
    }
    return solved;
  }
  if (strength === GROUNDED_HATCH_DEFAULT) return solved;
  const coverage = hatchRuleCoverage(theme);
  const seen = (stripe: string) => mixColors(stripe, solved.ground, coverage);
  const apart = grounding?.apart;
  const floor = apart === undefined ? 0 : Math.min(PALETTE_NORMAL_FLOOR, palettePerceptualDistance(seen(solved.stripe), apart));
  for (let step = Math.round(HATCH_MAX_FADE * (1 - strength / GROUNDED_HATCH_DEFAULT) * 100); step > 0; step--) {
    const stripe = mixColors(solved.ground, solved.stripe, step / 100);
    if (apart === undefined || palettePerceptualDistance(seen(stripe), apart) >= floor) return { stripe, ground: solved.ground };
  }
  return solved;
}

function solveGroundedHatch(
  theme: Theme, fill: string, authored: boolean, allowed: (stripe: string) => boolean, stripeTarget: number,
): { stripe: string; ground: string } {
  const page = theme.color.background;
  const floor = markVisibilityFloor(page);
  const cellTarget = floor === 3 ? 1 : floor + 0.12;
  const coverage = hatchRuleCoverage(theme);
  const fixed = theme.pattern.hatchColor === 'ink' ? theme.color.ink : authored ? fill : undefined;
  // Start at the key colour itself: the stripes lie on the ground, not the
  // page, so the page-based deepening of hatchStripeColor does not apply.
  const start = fixed ?? fill;
  const markInk = paintTokenColor(theme, 'markInk');
  const lightestGround = (stripe: string): string => {
    for (let step = HATCH_GROUND_SHARE * 50; step > 0; step--) {
      const ground = mixColors(fill, page, step / 50);
      if (contrastRatio(stripe, ground) >= stripeTarget) return ground;
    }
    return page;
  };
  let last = start;
  for (let deepen = 0; deepen <= 100; deepen++) {
    const stripe = deepen === 0 ? start : mixColors(markInk, start, deepen / 100);
    if (deepen > 0 && !allowed(stripe)) return { stripe: last, ground: lightestGround(last) };
    last = stripe;
    for (let step = HATCH_GROUND_SHARE * 50; step >= 0; step--) {
      const ground = mixColors(fill, page, step / 50);
      if (contrastRatio(stripe, ground) < stripeTarget) continue;
      if (contrastRatio(mixColors(stripe, ground, coverage), page) >= cellTarget) return { stripe, ground };
      break;
    }
    if (fixed !== undefined) return { stripe, ground: page };
  }
  return { stripe: markInk, ground: page };
}

/**
 * How far (OKLab) a stacked grey stripe stays from the floor grey in a grey theme. Every fill under 3:1
 * deepens to that one grey, and hue cannot keep two greys apart, so a hatched stack's segments came out
 * 0 to 12 apart (notation, metric stack). A 0.75 px stripe shows little of its grey: twice the swatch floor.
 */
const GREY_HATCH_STEP = 2 * PALETTE_NORMAL_FLOOR;

const isGrey = (color: string): boolean => {
  const rgb = parseColor(color);
  return rgb !== null && rgb.r === rgb.g && rgb.g === rgb.b;
};

/** A grey fill in a grey theme that clears 3:1 itself: its stripe takes GREY_HATCH_STEP. */
function greyStepped(theme: Theme, fill: string): boolean {
  return isGrey(fill) && theme.color.series.every(isGrey) && contrastRatio(fill, theme.color.background) >= MARK_CONTRAST_FLOOR;
}

/**
 * The stripe colour hatchPaint's recipe resolves to: `fill`, deepened toward the mark ink to 3:1 on the page.
 * In a grey theme (every series a grey) a stacked segment's grey fill that clears 3:1 itself deepens on until
 * it stands GREY_HATCH_STEP from the floor grey, so it stays a clear step from a paler segment beside it.
 */
function hatchStripeColor(theme: Theme, fill: string, stacked?: true): string {
  const background = theme.color.background;
  if (!parseColor(fill)) return fill;
  const ink = paintTokenColor(theme, 'markInk');
  const deepen = (from: string, done: (stripe: string) => boolean): string => {
    if (done(from)) return from;
    for (let weight = 0.02; weight < 1; weight += 0.02) {
      const stripe = mixColors(ink, from, weight);
      if (done(stripe)) return stripe;
    }
    return ink;
  };
  const onPage = (stripe: string) => contrastRatio(stripe, background) >= MARK_CONTRAST_FLOOR;
  if (!stacked || !greyStepped(theme, fill)) return deepen(fill, onPage);
  const floorGrey = deepen(background, onPage);
  return deepen(fill, (grey) => palettePerceptualDistance(grey, floorGrey, 'normal') >= GREY_HATCH_STEP);
}

/**
 * A wash of a colour role over the page that still separates from it: `amount`
 * toward the page, pulled back until the wash reaches the fill-separation
 * floor (a gap fill or a zone on a dark page).
 * 'surface-gap' reads `surface.gapTint` from the theme each scheme paints in.
 */
export function separatedWashPaint(token: PaintToken, amount: number | 'surface-gap'): Paint {
  return { token, theme: { kind: 'visible-tint', base: { token }, amount, floor: FILL_SEPARATION_FLOOR } };
}

/**
 * The fill of a plan mark under a theme's 'solidMuted' plan look:
 * color.inkMuted at 35 % over the background, with no outline.
 */
export const PLAN_MUTED_PAINT = { token: 'inkMuted', tint: 0.65 } as const satisfies Paint;

/**
 * Whether a mark in the outline notation draws solid and muted. The
 * scene keeps `pattern: 'outline'` either way and the renderers resolve the
 * look from the theme, as they resolve every other paint.
 */
export function solidMutedPlan(theme: Theme): boolean {
  return theme.scenario.PL === 'solidMuted';
}

/**
 * The fill a viewer actually SEES for a patterned mark: hatched fills render mostly background with thin colored strokes
 * (coverage = strokeWidth / hatchGap); outlined fills render as
 * background. Auto-ink must contrast against THIS, not the base color —
 * otherwise a dark hatched forecast bar picks invisible white ink.
 */
export function effectiveFill(
  fill: string,
  pattern: 'hatch45' | 'crosshatch' | 'horizontal' | 'vertical' | 'outline' | undefined,
  theme: Theme,
): string {
  if (pattern === 'outline') {
    return solidMutedPlan(theme) ? mixColors(theme.color.inkMuted, theme.color.background, 1 - PLAN_MUTED_PAINT.tint) : theme.color.background;
  }
  if (pattern === 'hatch45' || pattern === 'crosshatch' || pattern === 'horizontal' || pattern === 'vertical') {
    const coverage = hatchRuleCoverage(theme);
    return mixColors(theme.pattern.hatchColor === 'ink' ? theme.color.ink : hatchStripeColor(theme, fill), theme.color.background, coverage);
  }
  return fill;
}

/**
 * Warn colour with fallback — external themes may predate the token
 * (dark amber passes 4.5:1 on white and stays
 * ≥90 rgbDistance from both good and bad in every shipped preset).
 */
const WARN_FALLBACK = '#8F6A00';
export function warnColor(theme: Theme): string {
  return theme.color.warn ?? WARN_FALLBACK;
}

/** Surface anatomy with defaults (chip/badge wash, row/elapsed tints, chip radius). */
export function resolveSurface(
  theme: Theme,
): { chipTint: number; rowTint: number; elapsedTint: number; anchorTint: number; bandTint: number; gapTint: number; ribbonAlpha: number; ribbonSheetAlpha: number; chipRadius: number } {
  const surface = theme.surface as SurfaceWithAnchorTint | undefined;
  return {
    chipTint: surface?.chipTint ?? 0.9,
    rowTint: surface?.rowTint ?? 0.94,
    elapsedTint: surface?.elapsedTint ?? 0.95,
    anchorTint: surface?.anchorTint ?? 0.97,
    bandTint: surface?.bandTint ?? 0.06,
    gapTint: surface?.gapTint ?? (darkPage(theme) ? 0.65 : 0.82),
    ribbonAlpha: surface?.ribbonAlpha ?? 0.35,
    ribbonSheetAlpha: surface?.ribbonSheetAlpha ?? 0.18,
    chipRadius: surface?.chipRadius ?? 2,
  };
}

/**
 * Space tokens.
 *
 * ONE resolver, not four preset copies: the values are constants, so
 * presets do not restate them (a list restated per preset drifts)
 * and external themes may override them through the optional
 * `theme.space.canvas` / `.gap` / `.legendRowH` fields, bounds-checked by
 * `themeValidate`. Tier-1 tokens step by width class, not by a raw width
 * split: `wide` = W-L (≥ 1080 px), `base` = W-S/W-M.
 */
export interface SpaceTokens {
  margin: Margin;
  gapTitleSubtitle: number;
  gapSubtitlePlot: number;
  gapAxisFootnote: number;
  /** The gap between a key row under the plot and the footer. */
  gapKeyFootnote: number;
  gapFootnoteSource: number;
  gapLegend: number;
  legendRowH: number;
}

/** W-L begins at 1080 px canvas width. */
export const WIDE_CANVAS_MIN_WIDTH = 1080;

const SPACE_CANVAS_WIDE: Margin = { top: 24, right: 32, bottom: 20, left: 32 };

/**
 * Default canvas margins below W-L, by canvas width: 28 px sides at 960, 24 at 720, 16 at 480 and
 * below; the source line sits about 14 px above the bottom edge, and the first
 * title baseline at about 30 px on cards. An authored `space.canvas.base`, a
 * density override and an option `margin` still win.
 */
const CANVAS_MARGIN_STEPS: readonly { minWidth: number; margin: Margin }[] = [
  { minWidth: 840, margin: { top: 20, right: 28, bottom: 10, left: 28 } },
  { minWidth: 600, margin: { top: 20, right: 24, bottom: 10, left: 24 } },
  { minWidth: 0, margin: { top: 16, right: 16, bottom: 10, left: 16 } },
];

/** The default (unauthored) canvas margin at a canvas width. */
function defaultCanvasMargin(width: number): Margin {
  if (width >= WIDE_CANVAS_MIN_WIDTH) return SPACE_CANVAS_WIDE;
  for (const step of CANVAS_MARGIN_STEPS) if (width >= step.minWidth) return step.margin;
  return CANVAS_MARGIN_STEPS[CANVAS_MARGIN_STEPS.length - 1]!.margin;
}

export function spaceTokens(theme: Theme, width: number): SpaceTokens {
  const wide = width >= WIDE_CANVAS_MIN_WIDTH;
  const canvas = theme.space.canvas;
  const gap = theme.space.gap;
  return {
    margin: { ...defaultCanvasMargin(width), ...(wide ? canvas?.wide : canvas?.base) },
    gapTitleSubtitle: gap?.titleSubtitle ?? 4,
    // 8 below W-L: the first plot element sits about 16-18 px under the last
    // header baseline; 12 would leave charts about 5 px lower.
    gapSubtitlePlot: (wide ? gap?.subtitlePlotWide : gap?.subtitlePlot) ?? (wide ? 14 : 8),
    gapAxisFootnote: (wide ? gap?.axisFootnoteWide : gap?.axisFootnote) ?? (wide ? 14 : 12),
    // A key row under the plot sits 10 px over the footer below W-L (key
    // baseline to source baseline 25.6-25.9 px). An authored axisFootnote gap still sets both.
    gapKeyFootnote: (wide ? gap?.axisFootnoteWide : gap?.axisFootnote) ?? (wide ? 14 : 10),
    gapFootnoteSource: gap?.footnoteSource ?? 4,
    gapLegend: gap?.legend ?? 8,
    legendRowH: theme.space.legendRowH ?? 18,
  };
}

/**
 * The canvas margin for a chart at a given width — the single source for
 * per-chart margins. Card-class charts (kpi, bullet) do NOT call this:
 * they are exempt from the width classes that key the token.
 */
export function canvasMargin(theme: Theme, width: number): Margin {
  return spaceTokens(theme, width).margin;
}

/** Resolve a series' fill color from the ramp with overflow policy. */
function seriesColor(theme: Theme, index: number, ramp?: string[]): string {
  const r = ramp && ramp.length > 0 ? ramp : theme.color.series;
  return r[seriesColorIndex(theme, index, r)]!;
}

/** The actual ramp entry painted after overflow, also used by theme diagnostics. */
export function seriesColorIndex(theme: Theme, index: number, ramp?: string[]): number {
  const length = ramp && ramp.length > 0 ? ramp.length : theme.color.series.length;
  if (index < length) return index;
  return theme.color.seriesOverflow === 'cycle' ? index % length : length - 1;
}

/**
 * The ramp rank of each series of one chart. `own[i]` is the paint of a series
 * that does not take the ramp (an authored fill, a colorRole, the focus), else
 * undefined. A ramp series keeps its position in the ramp unless that step
 * resolves to the colour of an own-paint series, or to a step an earlier ramp
 * series took; it then moves on to the next free step. Without a collision
 * every rank is its index, as before. Past the ramp's end a series takes a step
 * no series took; with none left it repeats or cycles per seriesOverflow.
 */
export function rampSlots(
  theme: Theme,
  own: readonly (Paint | undefined)[],
  palette?: string,
  repeats?: { labels: readonly string[]; warnings: LintWarning[] },
  /** A stack's segments touch: a plain series also skips a step that is not apart from an authored colour (swatchesApart), while one is. */
  stacked = false,
): number[] {
  const ramp = theme.color.palettes?.[palette ?? ''];
  // One colour, one key: '#fff', '#FFFFFF' and 'rgb(255, 255, 255)' collide.
  const key = (css: string): string => {
    const rgb = parseColor(css);
    return rgb ? `${rgb.r},${rgb.g},${rgb.b}` : css.trim().toUpperCase();
  };
  const taken = new Set(own.flatMap((paint) => (paint ? [key(paintColor(theme, paint))] : [])));
  const length = (ramp && ramp.length > 0 ? ramp : theme.color.series).length;
  const authored = stacked ? own.flatMap((paint) => (paint ? [paintColor(theme, paint)] : [])) : [];
  const near = (slot: number) => authored.some((css) => !swatchesApart(css, seriesColor(theme, slot, ramp)));
  let next = 0;
  const repeated: number[] = [];
  const slots = own.map((paint, index) => {
    if (paint) return index;
    let slot = Math.max(index, next);
    const apart = Array.from({ length: Math.max(0, length - slot) }, (_, k) => slot + k)
      .find((step) => !taken.has(key(seriesColor(theme, step, ramp))) && !near(step));
    if (apart !== undefined) slot = apart;
    while (slot < length && taken.has(key(seriesColor(theme, slot, ramp)))) slot += 1;
    // Past the ramp's end, a step no series took beats the overflow repeat.
    if (slot >= length) {
      slot = Array.from({ length }, (_, step) => step).find((step) => !taken.has(key(seriesColor(theme, step, ramp))))
        ?? Math.max(index, next);
    }
    next = slot + 1;
    if (taken.has(key(seriesColor(theme, slot, ramp)))) repeated.push(index);
    taken.add(key(seriesColor(theme, slot, ramp)));
    return slot;
  });
  // The ramp ran out: a repeated colour makes two series read as one.
  if (repeats && repeated.length > 0) {
    const groups = new Map<string, number[]>();
    for (const index of repeated) {
      const color = key(seriesColor(theme, slots[index]!, ramp));
      if (!groups.has(color)) groups.set(color, slots.flatMap((slot, i) =>
        key(own[i] ? paintColor(theme, own[i]!) : seriesColor(theme, slot, ramp)) === color ? [i] : []));
    }
    const names = [...groups.values()].map(group => group.map(index => `'${repeats.labels[index] ?? index}'`).join(' and ')).join('; ');
    repeats.warnings.push({
      code: 'series-colour-repeated',
      severity: 'warn',
      message: `${own.length} series share a ramp of ${length} colours. These series share a colour: ${names}.`,
      suggest: "group the tail into an 'Other' series when the values add, use small multiples, or set distinct colorRole values or fills; series-N needs a distinct step in color.series",
    });
  }
  return slots;
}

/** The optional colour roles and the required role each resolves to when a theme leaves it out. */
const OPTIONAL_ROLE_FALLBACK = { focus: 'highlight', spark: 'neutralMark', neutralMark: 'neutral', goodFill: 'good', badFill: 'bad', warnFill: 'warn', inkMeta: 'inkMuted', rest: 'neutralLight', othersMark: 'others', markInk: 'ink', heatTop: 'markInk', heatTopInk: 'inkInverse', rule: 'axis', reference: 'axis' } as const;
type OptionalRole = keyof typeof OPTIONAL_ROLE_FALLBACK;

/** Resolve optional and custom status tokens through the renderer's fallback chain. */
export function resolvedPaintToken(theme: Theme, token: PaintToken): PaintToken {
  const fallback = OPTIONAL_ROLE_FALLBACK[token as OptionalRole];
  if (fallback && theme.color[token as OptionalRole] === undefined) return resolvedPaintToken(theme, fallback);
  if (token.startsWith('status-') && theme.color.status[token.slice('status-'.length)] === undefined) {
    return resolvedPaintToken(theme, 'neutralMark');
  }
  return token;
}

/** Resolve one scene token without losing its symbolic identity beforehand. */
export function paintTokenColor(theme: Theme, token: PaintToken): string {
  token = resolvedPaintToken(theme, token);
  const color = theme.color;
  // A tornado's high case is a bar: without a case pair it takes the focus.
  if (token === 'case-1' || token === 'case-2') return (color.casePair ?? [color.neutralLight, color.series[0]!])[token === 'case-1' ? 0 : 1]!;
  if (token === 'warn') return color.warn ?? WARN_FALLBACK;
  // A theme without an optional role paints it in the role it falls back to:
  // focus in the highlight, spark in the neutral mark and that in the neutral,
  // the tone fills in good / bad / warn.
  if (token.startsWith('series-')) {
    return seriesColor(theme, Math.max(0, Number(token.slice('series-'.length)) - 1));
  }
  if (token.startsWith('status-')) {
    return color.status[token.slice('status-'.length)]!;
  }
  const direct = color[token as keyof typeof color];
  return typeof direct === 'string' ? direct : color.ink;
}

function scenarioSeriesColor(
  theme: Theme,
  index: number,
  ramp: string[] | undefined,
  scenario: Scenario | undefined,
  deEmphasizePy = true,
  surfaceFade = false,
  apart = false,
): string {
  const base = seriesColor(theme, index, ramp);
  const background = theme.color.background;
  const floor = markVisibilityFloor(background);
  // A forecast hatch beside its actual's solid column on a dark page reads by its stripes alone
  // (a dark page's grounded hatch keeps no cell floor), so they keep the strong grounded target.
  const target = scenario === 'FC' ? (apart && floor === 3 ? GROUNDED_STRONG_TARGET : floor + 0.12) : floor;
  const visibilityContrast = (candidate: string): number => {
    if (scenario !== 'FC') return contrastRatio(candidate, background);
    // A hatched forecast cell must stand apart from the page. The reader sees
    // it as its averaged cell (the drawn stripe share over the page) or by its
    // edge: the stripes and the outline share one colour, which must clear the
    // target against both the page and the cell it bounds. At a sparse stripe
    // the averaged cell can stay near the page on any colour; the edge is
    // what separates it, as the engine's mark-visibility separator arm does.
    const rendered = effectiveFill(candidate, 'hatch45', theme);
    const edge = theme.pattern.hatchColor === 'ink' ? theme.color.ink : hatchStripeColor(theme, candidate);
    return Math.max(contrastRatio(rendered, background), Math.min(contrastRatio(edge, rendered), contrastRatio(edge, background)));
  };

  if (surfaceFade) {
    // Plain argmax, deliberately NOT pickInk: this picks a fade TARGET (the
    // farther of page/ink from black), and pickInk's primary-ink preference
    // would bias an unrelated decision toward the background.
    const fadeTarget =
      contrastRatio('#000000', background) >= contrastRatio('#000000', theme.color.ink)
        ? background
        : theme.color.ink;
    let low = tint(base, 0.45, fadeTarget);
    for (let amount = 0.45; amount > 0.05 && contrastRatio(low, background) < 3; ) {
      low = tint(base, amount -= 0.01, fadeTarget);
    }
    return low;
  }

  if (scenario === 'PY' && deEmphasizePy) {
    const washed = ((): string => {
      const light = mixColors(base, background, 0.45);
      if (visibilityContrast(light) >= floor) return light;
      // Preserve the PY de-emphasis as far as the active surface permits. Dark
      // presets have a 3:1 mark floor, so the full base may be the lightest
      // legal member of the selected palette family.
      for (let lightWeight = 0.99; lightWeight >= 0; lightWeight -= 0.01) {
        const candidate = mixColors(light, base, lightWeight);
        if (visibilityContrast(candidate) >= floor) return candidate;
      }
      return base;
    })();
    if (!apart || swatchesApart(washed, base)) return washed;
    // A prior year beside its actual must not print as the actual. When the page floor
    // leaves no wash apart from it (an actual near the floor), it steps toward the ink.
    for (let amount = 0.01; amount < 1; amount = Number((amount + 0.01).toFixed(2))) {
      const step = tint(base, amount, theme.color.ink);
      if (swatchesApart(step, base)) return step;
    }
    return theme.color.ink;
  }

  if (visibilityContrast(base) >= target) return base;
  // Hatch coverage can pull a valid ramp color back toward the page until the
  // *rendered* FC mark misses the floor. Move only toward an achromatic
  // lightness pole, preserving the palette hue instead of importing a foreign
  // color, and keep deliberate margin above the floor.
  const lightnessPole = floor === 3 ? '#FFFFFF' : '#000000';
  for (let baseWeight = 0.99; baseWeight >= 0; baseWeight -= 0.01) {
    const candidate = mixColors(base, lightnessPole, baseWeight);
    if (visibilityContrast(candidate) >= target) return candidate;
  }
  // A sparse hatch that no mix can lift to the floor keeps the series colour,
  // as dark does; the bare pole would draw every forecast in black.
  return base;
}

/**
 * The pole a stage ramp brightens toward: the page in light, ink in dark.
 * A dark theme's heatTop caps it. When the mixed base already sits at or above
 * that cap there is no room to brighten, so the ramp fades toward the page.
 */
function brighterPole(theme: Theme, base?: string): string {
  const { background, ink } = theme.color;
  if ((oklabLightness(background) ?? 0) >= (oklabLightness(ink) ?? 0)) return background;
  // heatTop falls back to the mark ink; with neither set the ink is no cap.
  const heatTop = theme.color.heatTop ?? theme.color.markInk;
  if (heatTop === undefined) return ink;
  if (base === undefined) return heatTop;
  return (oklabLightness(heatTop) ?? 0) > (oklabLightness(base) ?? 0) ? heatTop : background;
}

const SERIES_TEXT_COLORS = new WeakMap<Theme, WeakMap<ThemePaintSource, string>>();
/**
 * Ground-text contrast walks run once per theme and recipe object: the cells of one heat band share one ground and
 * one ink recipe. Scene paints are caller data and may be edited in place, so a hit must still print as its recipe.
 */
const WALKED_COLORS = new WeakMap<Theme, WeakMap<ThemePaintSource, { recipe: string; color: string }>>();

/** Whether a cached copy of a paint recipe still equals the recipe. */
export function sameRecipe(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => sameRecipe((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** Resolve a provenance-carrying theme paint for the baked serializer. */
function themePaintSourceColor(theme: Theme, source: ThemePaintSource): string {
  if (source.kind !== 'ground-text') return sourceColor(theme, source);
  let cache = WALKED_COLORS.get(theme);
  if (!cache) WALKED_COLORS.set(theme, cache = new WeakMap());
  const recipe = JSON.stringify(source);
  const known = cache.get(source);
  if (known !== undefined && known.recipe === recipe) return known.color;
  const color = sourceColor(theme, source);
  cache.set(source, { recipe, color });
  return color;
}

function sourceColor(theme: Theme, source: ThemePaintSource): string {
  if (source.kind === 'series-text') {
    let cache = SERIES_TEXT_COLORS.get(theme);
    const known = cache?.get(source);
    if (known !== undefined) return known;
    if (!cache) SERIES_TEXT_COLORS.set(theme, cache = new WeakMap());
    // Keep the recipe for repainting; a different theme gets its own contrast walk.
    const resolved = (color: string): string => { cache.set(source, color); return color; };
    const base = paintColor(theme, source.base);
    const grounds = [theme.color.background, ...(source.surfaces ?? []).map((surface) => paintColor(theme, surface))];
    const clears = (color: string) => grounds.every((ground) => contrastRatio(color, ground) >= TEXT_CONTRAST_FLOOR);
    if (clears(base)) return resolved(base);
    // An achromatic pole keeps the series hue. Dark pages need a lighter step.
    const pole = darkPage(theme) ? '#FFFFFF' : '#000000';
    for (let step = 1; step <= 100; step++) {
      const candidate = mixColors(base, pole, 1 - step / 100);
      if (clears(candidate)) return resolved(candidate);
    }
    return resolved(pole);
  }
  if (source.kind === 'colorblind') return colorblindColor(theme, source.role);
  if (source.kind === 'pie-ramp' || source.kind === 'visible-tint') {
    const ramp = source.kind === 'pie-ramp'
      ? pieRamp(paintColor(theme, source.base), theme.color.background, source.count, source.withOthers ? paintTokenColor(theme, 'othersMark') : undefined, source.othersShade !== 'apart', theme.marks?.contrastEdge !== true)
      : undefined;
    // A pie ramp washes from its own top colour, lifted on a dark page.
    const base = ramp ? ramp.base : paintColor(theme, source.base);
    const amount = source.kind === 'pie-ramp' ? ramp!.tints[source.index] ?? 0.82 : visibleTintAmount(theme, source);
    const washed = amount ? tint(base, amount, theme.color.background) : base;
    if (source.kind === 'visible-tint' && source.darkApartFrom && darkPage(theme)) return washApart(theme, base, amount, source.darkApartFrom);
    if (source.kind === 'visible-tint' && source.darkMatchLight && darkPage(theme)) return washLikeLight(theme, base, amount);
    return source.kind === 'visible-tint' && source.apart !== undefined && typeof source.amount === 'number' && amount < source.amount
      ? apartStep(theme, base, washed, source.apart)
      : washed;
  }
  if (source.kind === 'brighter-pole') return brighterPole(theme);
  if (source.kind === 'table-ground') return cellGroundColor(theme, source.ground);
  if (source.kind === 'ground-text') {
    const ground = compositeColor(paintColor(theme, source.ground), theme.color.background);
    const near = paintColor(theme, source.near);
    const far = farGround(theme, source.ground);
    if (far === undefined && contrastRatio(near, ground) >= TEXT_CONTRAST_FLOOR) return near;
    return (source.far === undefined ? undefined : seriesTextAlone(paintColor(theme, source.far), ground))
      ?? pickOnFillInk(ground, theme.color.ink, theme.color.inkInverse, onFillInks(theme.color));
  }
  if (source.kind === 'page-side-ground') {
    const color = compositeColor(paintColor(theme, source.ground), theme.color.background);
    return parseColor(color) === null || farGround(theme, source.ground) !== undefined ? theme.color.background : color;
  }
  if (source.kind === 'table-ink') return tableInkColor(theme, source.role);
  if (source.kind === 'focus-apart') {
    const focus = paintTokenColor(theme, 'focus');
    return source.apartFrom.every((paint) => swatchApart(focus, paintColor(theme, paint))) ? focus : theme.color.ink;
  }
  if (source.kind === 'line-on-fill') {
    const fill = paintColor(theme, source.fill);
    const base = paintColor(theme, source.base);
    return contrastRatio(base, fill) >= contrastRatio(theme.color.inkInverse, fill) ? base : theme.color.inkInverse;
  }
  if (source.kind === 'emphasis-ink') {
    const focus = theme.color.focus;
    return focus !== undefined && contrastRatio(focus, paintColor(theme, source.ground)) >= 4.5 ? focus : theme.color.ink;
  }
  if (source.kind === 'hatch-stripe') {
    const fill = paintColor(theme, source.base);
    return source.grounded
      ? groundedHatchColors(theme, fill, 'css' in source.base, hatchPeers(theme, source.peers), hatchGrounding(theme, source)).stripe
      : hatchStripeColor(theme, fill, source.stacked);
  }
  if (source.kind === 'ribbon') return ribbonColor(theme, source);
  if (source.kind === 'surface-floor') {
    return surfaceFloorColor(theme, paintColor(theme, source.base), source.surfaces.map((paint) => paintColor(theme, paint)));
  }
  if (source.kind === 'hatch-ground') {
    return groundedHatchColors(theme, paintColor(theme, source.base), 'css' in source.base, hatchPeers(theme, source.peers), hatchGrounding(theme, source)).ground;
  }
  if (source.kind === 'hatch-fade') {
    return hatchFadeColor(paintColor(theme, source.stripe), paintColor(theme, source.ground), source.strength, source.cue);
  }
  if (source.kind === 'stack-ramp') return stackRampColor(theme, source);
  if (source.kind === 'group-ramp') return groupRampColor(theme, source);
  if (source.kind === 'stack-apart') return stackApartColor(theme, source);
  if (source.kind === 'ordered-ramp') {
    let weakest = visibleTintAmount(theme, { kind: 'visible-tint', base: { token: 'markInk' }, amount: 0.9, floor: MARK_CONTRAST_FLOOR });
    // A Rest series beside the ramp is the quietest part: the weakest rung stops above its colour.
    // When the Rest colour is stronger than the ink itself, no rung can sit above it and the ramp stays.
    if (source.withOthers) {
      const ink = paintTokenColor(theme, 'markInk');
      const others = paintTokenColor(theme, 'othersMark');
      if (contrastRatio(ink, theme.color.background) > contrastRatio(others, theme.color.background)) {
        const cap = quietestTintCap(ink, theme.color.background, others, weakest);
        if (cap > 0) weakest = cap;
      }
    }
    const amount = source.count > 1 ? weakest * (1 - source.index / (source.count - 1)) : 0;
    return tint(paintTokenColor(theme, 'markInk'), amount, theme.color.background);
  }
  if (source.kind === 'mix') {
    const from = paintColor(theme, source.from);
    if (!('theme' in source.to) || source.to.theme?.kind !== 'brighter-pole') {
      const to = paintColor(theme, source.to);
      if (source.pageFloor === undefined || theme.marks?.contrastEdge === true) return mixColors(from, to, source.weight);
      // No outline carries a fill (fillEdgesOff): the wash steps back toward `from` until it reads.
      for (let weight = source.weight; weight < 1; weight = Number((weight + 0.01).toFixed(2))) {
        const mixed = mixColors(from, to, weight);
        if (contrastRatio(mixed, theme.color.background) >= source.pageFloor) return mixed;
      }
      return from;
    }
    const to = brighterPole(theme, from);
    if (to !== theme.color.background) return mixColors(from, to, source.weight);
    const weight = stageWashWeight(theme, source.from, source.weight);
    // No room toward the page for a base that clears the floor: its stages shade toward the ink
    // instead, so each stays at or above the floor and apart.
    if (weight === 'ink') return mixColors(from, theme.color.ink, source.weight);
    return mixColors(from, to, weight);
  }
  if (source.kind === 'contrast-ink') {
    const fill = compositeColor(paintColor(theme, source.fill), theme.color.background);
    const ground = source.pattern ? effectiveFill(fill, source.pattern, theme) : fill;
    const ink = pickOnFillInk(ground, theme.color.ink, theme.color.inkInverse, onFillInks(theme.color));
    if (!source.also?.length) return ink;
    // Text across several grounds: of the inks that may print on a fill, the one whose
    // lowest contrast over them is highest, the single-ground choice first on a tie.
    const grounds = [ground, ...source.also.map((paint) => compositeColor(paintColor(theme, paint), theme.color.background))];
    const worst = (candidate: string) => Math.min(...grounds.map((color) => contrastRatio(color, candidate)));
    return [ink, theme.color.ink, theme.color.inkInverse, ...onFillInks(theme.color)].reduce((best, candidate) => (worst(candidate) > worst(best) ? candidate : best));
  }
  if (source.kind !== 'series') return adaptivePaintColor(theme, source);
  const ramp = source.palette === undefined ? undefined : theme.color.palettes?.[source.palette];
  return source.scenario === undefined
    ? seriesColor(theme, source.index, ramp)
    : scenarioSeriesColor(
        theme,
        source.index,
        ramp,
        source.scenario,
        source.deEmphasizePy ?? true,
        source.surfaceFade ?? false,
        source.apart ?? false,
      );
}

const darkPage = (theme: Theme): boolean => contrastRatio(theme.color.background, '#FFFFFF') > contrastRatio(theme.color.background, '#000000');

/** The wash of `base` on a dark page, from `amount` back toward the base, until it reads against the page as the same wash reads on white. */
function washLikeLight(theme: Theme, base: string, amount: number): string {
  const background = theme.color.background;
  const target = apcaContrast(tint(base, amount, '#FFFFFF'), '#FFFFFF');
  // The text ink keeps 4.5:1 on the ground: the walk stops at the last step that holds it.
  let last = tint(base, amount, background);
  for (let a = amount; a > 0; a = Number((a - 0.01).toFixed(2))) {
    const washed = tint(base, a, background);
    if (contrastRatio(washed, theme.color.ink) < 4.5) return last;
    if (apcaContrast(washed, background) >= target) return washed;
    last = washed;
  }
  return last;
}

/** The wash of `base`, from `amount` back toward the base, until it sits `distance` OKLab from the other paint. */
function washApart(theme: Theme, base: string, amount: number, apart: { paint: Paint | Paint[]; distance: number }): string {
  const others = [apart.paint].flat().map((paint) => paintColor(theme, paint));
  for (let a = amount; a > 0; a = Number((a - 0.01).toFixed(2))) {
    const step = tint(base, a, theme.color.background);
    if (others.every((other) => palettePerceptualDistance(step, other) >= apart.distance)) return step;
  }
  return base;
}

/**
 * A wash the mark floor pulled back toward its token (a dark card, a token
 * near the floor) can land within 1.2:1 of it, and two Likert options then
 * read as one. Such a step goes toward the ink instead, which keeps it
 * visible on the card, until it is `apart` from the token.
 */
function apartStep(theme: Theme, base: string, washed: string, apart: number): string {
  if (contrastRatio(washed, base) >= apart) return washed;
  for (let amount = 0.01; amount < 1; amount += 0.01) {
    const step = tint(base, amount, theme.color.ink);
    if (contrastRatio(step, base) >= apart) return step;
  }
  return theme.color.ink;
}

/** Resolve the original visibility walk without storing its theme-specific result. */
export function visibleTintAmount(
  theme: Theme,
  source: Extract<ThemePaintSource, { kind: 'visible-tint' }>,
): number {
  const base = paintColor(theme, source.base);
  const background = theme.color.background;
  const floor = source.floor === 'mark'
    ? markVisibilityFloor(background)
    : source.floor;
  const amount = source.amount === 'surface-anchor' ? resolveSurface(theme).anchorTint
    : source.amount === 'surface-gap' ? resolveSurface(theme).gapTint : source.amount;
  for (let a = amount; a > 0; a = source.roundStep ? Math.max(0, Number((a - 0.01).toFixed(2))) : a - 0.01) {
    if (contrastRatio(tint(base, Math.max(0, a), background), background) >= floor) return Math.max(0, a);
  }
  return 0;
}

/** The widest wash a funnel stage takes toward its brighter pole (shadeStage). */
export const STAGE_SHADE_MAX = 0.6;

/**
 * A stage that fades toward the page keeps the mark floor on it. The visible-tint
 * walk pulls the widest wash back until it clears the floor, and every stage's
 * wash shrinks by the same factor, so the stages stay evenly apart and no two
 * share a fill. A dark theme drew its first stage at 2.35:1 on the card.
 */
function stageWashWeight(theme: Theme, base: Paint, weight: number): number | 'ink' {
  const reach = visibleTintAmount(theme, { kind: 'visible-tint', base, amount: STAGE_SHADE_MAX, floor: 'mark' });
  if (reach >= STAGE_SHADE_MAX) return weight;
  // Half the span or more toward the page keeps six stages apart after RGB rounding.
  if (reach >= STAGE_SHADE_MAX / 2) return 1 - (1 - weight) * (reach / STAGE_SHADE_MAX);
  // Too little room toward the page to keep the floor and the stages apart. A base that clears
  // the floor turns toward the ink; a base under it has no legal stage at all and keeps its
  // shading, so the stages stay apart.
  const background = theme.color.background;
  return contrastRatio(paintColor(theme, base), background) >= markVisibilityFloor(background) ? 'ink' : weight;
}

/** Build a computed theme paint while retaining enough recipe data for the dark pair. */
export function mixedPaint(
  from: Paint,
  to: Paint,
  weight: number,
  token: PaintToken = 'neutral',
): Paint {
  return {
    token,
    theme: { kind: 'mix', from, to, weight },
  };
}

/** Series identity as text at 4.5:1 on the page and on each surface it may lie on (a table band or total ground). */
export function seriesTextPaint(base: Paint, surfaces?: Paint[]): Paint {
  return { token: 'ink', theme: { kind: 'series-text', base, ...(surfaces ? { surfaces } : {}) } };
}

/** Text on an authored ground, decided again in the theme it is painted in (see the 'ground-text' recipe). */
export function groundTextPaint(near: Paint, ground: Paint, far?: Paint): Paint {
  return { token: 'css' in near ? 'ink' : near.token, theme: { kind: 'ground-text', near, ground, ...(far === undefined ? {} : { far }) } };
}

/** A ground needs its own ink when it crosses the page's lightness or the page ink cannot read on it. */
export function farGround(theme: Theme, ground: Paint): string | undefined {
  const color = compositeColor(paintColor(theme, ground), theme.color.background);
  if (parseColor(color) === null) return undefined;
  const light = (value: string) => contrastRatio(value, '#000000') >= contrastRatio(value, '#FFFFFF');
  const opposite = light(color) !== light(theme.color.background);
  return opposite || contrastRatio(theme.color.ink, color) < TEXT_CONTRAST_FLOOR ? color : undefined;
}

/** The tone step that reads at 4.5:1 on `ground` alone, or undefined when only the pole itself would. */
export function seriesTextAlone(base: string, ground: string): string | undefined {
  if (contrastRatio(base, ground) >= TEXT_CONTRAST_FLOOR) return base;
  const pole = contrastRatio(ground, '#FFFFFF') > contrastRatio(ground, '#000000') ? '#FFFFFF' : '#000000';
  for (let step = 1; step < 100; step++) {
    const candidate = mixColors(base, pole, 1 - step / 100);
    if (contrastRatio(candidate, ground) >= TEXT_CONTRAST_FLOOR) return candidate;
  }
  return undefined;
}

/** Select ink/inkInverse independently on each side of a validated pair. */
export function contrastInkPaint(
  fill: Paint,
  pattern?: import('./types/scene').HatchPattern | 'outline',
): Paint {
  return {
    token: 'ink',
    theme: {
      kind: 'contrast-ink',
      fill,
      ...(pattern ? { pattern } : {}),
    },
  };
}

/** Construct a series paint without materialising a theme hex in chart code. */
export function seriesPaint(
  index: number,
  palette?: string,
  scenario?: Scenario,
  deEmphasizePy = true,
  surfaceFade = false,
  apart = false,
): Paint {
  const source: Extract<ThemePaintSource, { kind: 'series' }> = { kind: 'series', index };
  if (palette !== undefined) source.palette = palette;
  if (scenario !== undefined) source.scenario = scenario;
  if (!deEmphasizePy) source.deEmphasizePy = false;
  if (surfaceFade) source.surfaceFade = true;
  if (apart) source.apart = true;
  return {
    token: `series-${index + 1}`,
    theme: source,
  };
}

/**
 * When the author makes one series the focus
 * (colorRole 'highlight', or its id in options.highlight), the one other
 * series without its own fill or colorRole recedes to the muted mark (a
 * neutral grey held at 3:1, mutedMarkPaint), so
 * the accent is the only colour that asks for attention. With two or more
 * such series the ramp keeps them apart, so none recedes.
 */
export function recedingSeriesId(
  series: readonly { id: string; fill?: string; colorRole?: string }[],
  highlights: ReadonlySet<string>,
): string | undefined {
  if (!series.some((s) => !s.fill && (s.colorRole === 'highlight' || (!s.colorRole && highlights.has(s.id))))) return undefined;
  const plain = series.filter((s) => !s.fill && !s.colorRole && !highlights.has(s.id));
  return plain.length === 1 ? plain[0]!.id : undefined;
}

/**
 * A series paint on the theme's ordered ramp, for marks whose
 * order is the encoding, such as cohorts: rung 0 of `count` is the weakest,
 * still 3:1 on the page, and the last rung is the full mark ink. It follows
 * the scheme, so it never needs a literal colour.
 */
export function orderedRampPaint(index: number, count: number, withOthers = false): Paint {
  return { token: 'markInk', theme: { kind: 'ordered-ramp', index, count, ...(withOthers ? { withOthers: true as const } : {}) } };
}

/**
 * A plain series of a stacked or 100% column or bar on the
 * theme's stack ramp, dark to light in authored order. It resolves in the
 * active theme, so a repaint follows; a theme without `color.stack` paints
 * the series rank `slot`.
 */
export function stackRampPaint(index: number, count: number, slot: number): Paint {
  return { token: `series-${slot + 1}`, theme: { kind: 'stack-ramp', index, count, slot } };
}

/** A plain series of a stack beside authored colours (`own`, in series order): its ramp step, chosen in the active theme. */
export function stackApartPaint(own: readonly (Paint | undefined)[], index: number, slot: number, palette?: string): Paint {
  return { token: `series-${slot + 1}`, theme: { kind: 'stack-apart', own: own.map((paint) => paint ?? null), index, ...(palette !== undefined ? { palette } : {}) } };
}

const STACK_APART = new WeakMap<Theme, Map<string, number[]>>();
function stackApartColor(theme: Theme, source: { own: (Paint | null)[]; index: number; palette?: string }): string {
  const cache = STACK_APART.get(theme) ?? new Map<string, number[]>();
  STACK_APART.set(theme, cache);
  const key = JSON.stringify([source.own, source.palette]);
  const slots = cache.get(key) ?? rampSlots(theme, source.own.map((paint) => paint ?? undefined), source.palette, undefined, true);
  cache.set(key, slots);
  return seriesColor(theme, slots[source.index]!, source.palette === undefined ? undefined : theme.color.palettes?.[source.palette]);
}

/**
 * Step `index` of `count` on `color.stack`: the steps themselves while the
 * series fit them, else even shares between the ends, through the steps.
 */
function stackRampColor(theme: Theme, source: { index: number; count: number; slot: number }): string {
  const ramp = theme.color.stack;
  if (!ramp || ramp.length < 2) return seriesColor(theme, source.slot);
  return rampStep(ramp, source.index, source.count);
}

/**
 * A treemap group by rank on one colour family: `color.treemap`, else
 * `color.stack`, else the first series colour stepped toward the page.
 */
export function groupRampPaint(index: number, count: number): Paint {
  return { token: 'series-1', theme: { kind: 'group-ramp', index, count } };
}

function groupRampColor(theme: Theme, source: { index: number; count: number }): string {
  const steps = [theme.color.treemap, theme.color.stack].find((own) => own !== undefined && own.length >= 2);
  if (steps) return rampStep(steps, source.index, source.count);
  const ramp = pieRamp(seriesColor(theme, 0), theme.color.background, source.count, undefined, false, theme.marks?.contrastEdge !== true);
  const amount = ramp.tints[source.index] ?? 0.82;
  return amount ? tint(ramp.base, amount, theme.color.background) : ramp.base;
}

function rampStep(ramp: readonly string[], index: number, count: number): string {
  if (count <= ramp.length) return ramp[index]!;
  const at = (index / (count - 1)) * (ramp.length - 1);
  const low = Math.min(ramp.length - 2, Math.floor(at));
  const share = at - low;
  return share < 1e-9 ? ramp[low]! : mixColors(ramp[low + 1]!, ramp[low]!, share);
}

/**
 * A muted data mark: a receded dot, a context slope line. The
 * neutral mark washed toward the page, pulled back until it still reaches 3:1
 * there, so muted reads lighter and never invisible. Area fills that recede
 * keep `rest` and the fill-separation floor.
 */
export function mutedMarkPaint(): Paint {
  return { token: 'neutralMark', theme: { kind: 'visible-tint', base: { token: 'neutralMark' }, amount: 0.6, floor: MARK_CONTRAST_FLOOR } };
}

/** Construct a colorblind-safe judgment paint without baking its theme value. */
export function colorblindPaint(role: 'good' | 'bad', fill = false): Paint {
  return { token: role, theme: { kind: 'colorblind', role: fill ? `${role}Fill` : role } };
}

/** A colorblind role's colour; a fill role the theme leaves out is its good / bad. */
function colorblindColor(theme: Theme, role: 'good' | 'bad' | 'goodFill' | 'badFill'): string {
  const pair = theme.color.colorblind;
  return pair[role] ?? pair[role === 'goodFill' ? 'good' : role === 'badFill' ? 'bad' : role];
}

/**
 * under colorblindSafe a layout that paints its judgments in many
 * places (the table: tone ink, heat grounds, in-cell bars, badges, washes)
 * swaps them in one pass. Every good / bad / goodFill / badFill token in
 * `value`, nested recipe bases included, takes theme.color.colorblind;
 * `swapped` counts the paints it changed.
 */
export function colorblindRoles<T>(value: T): { value: T; swapped: number } {
  let swapped = 0;
  const walk = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(walk);
    if (entry === null || typeof entry !== 'object') return entry;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(entry)) out[key] = walk(item);
    const token = out.token;
    if (out.theme !== undefined || (token !== 'good' && token !== 'bad' && token !== 'goodFill' && token !== 'badFill')) return out;
    swapped++;
    return { ...out, ...colorblindPaint(token.startsWith('good') ? 'good' : 'bad', token.endsWith('Fill')) };
  };
  return { value: walk(value) as T, swapped };
}

/** The theme with its good / bad pair (and fill pair) taken from theme.color.colorblind, for a surface that paints from theme colours (the React table). */
export function colorblindTheme(theme: Theme): Theme {
  const pair = theme.color.colorblind;
  return { ...theme, color: { ...theme.color, good: pair.good, bad: pair.bad, goodFill: colorblindColor(theme, 'goodFill'), badFill: colorblindColor(theme, 'badFill') } };
}

/** Resolve any scene paint to the color used by layout-side contrast math. */
export function paintColor(theme: Theme, paint: Paint): string {
  if ('css' in paint) return paint.css;
  const base = paint.theme === undefined
    ? paintTokenColor(theme, paint.token)
    : themePaintSourceColor(theme, paint.theme);
  return paint.tint ? tint(base, paint.tint, theme.color.background) : base;
}

/**
 * Resolve options.palette to a named ramp. Unknown names return the default
 * `series` ramp and report a warning through `warn` so charts surface an
 * `unknown-palette` lint instead of silently recoloring.
 */
/** A palette warning; a retired palette name carries the patch that removes it. */
export function paletteWarning(code: string, message: string): LintWarning {
  return code === 'option-deprecated'
    ? { code, severity: 'warn', message, field: ['options', 'palette'], suggest: 'Remove options.palette.', fix: [{ op: 'remove', path: '/options/palette' }] }
    : { code, severity: 'warn', message };
}

export function resolvePalette(
  theme: Theme,
  name: string | undefined,
  warn?: (code: string, message: string) => void,
): string[] | undefined {
  if (!name) return undefined;
  const ramp = theme.color.palettes?.[name];
  if (!ramp && RETIRED_PALETTES.has(name)) {
    warn?.('option-deprecated', `palette '${name}' is retired and ignored; the theme's own series draw.`);
    return undefined;
  }
  if (!ramp) {
    warn?.(
      'unknown-palette',
      `palette '${name}' is not defined in theme '${theme.name}' — using the default series ramp` +
        (theme.color.palettes ? ` (available: ${Object.keys(theme.color.palettes).join(', ')})` : ''),
    );
    return undefined;
  }
  return ramp;
}

export function resolveSemanticPaletteTheme(
  theme: Theme,
  name: string | undefined,
  warnings: LintWarning[],
): Theme {
  if (name === undefined) return theme;
  const ramp = resolvePalette(theme, name, (code, message) => {
    warnings.push(paletteWarning(code, message));
  });
  if (!ramp) return theme;
  const primary = seriesColor(theme, 0, ramp);
  const secondary = seriesColor(theme, 1, ramp);
  return {
    ...theme,
    color: {
      ...theme.color,
      neutral: primary,
      neutralLight: secondary,
      highlight: secondary,
      // What `options.highlight` selects follows the palette, as the highlight does.
      focus: secondary,
      // The spark line follows the palette's first rank, as the neutral does.
      spark: primary,
      total: primary,
    },
  };
}

/**
 * The colour of a mark `options.highlight` selects, for layout-side
 * contrast choices. The mark itself always carries the `focus` token, so a
 * scene laid out under a theme without the role repaints into one that has
 * it; a theme without it resolves the token to its `highlight`.
 */
export function focusColor(theme: Theme): string {
  return theme.color.focus ?? theme.color.highlight;
}

/**
 * The tones that print as text and also fill large marks, each with the fill
 * role a mark larger than a point paints in. The text tone is
 * chosen to read as text; the fill twin to read as a cell, bar or wash.
 * Text, strokes, ticks, pins and chips keep the tone itself.
 */
const TONE_FILL_TWINS = { good: 'goodFill', bad: 'badFill', warn: 'warnFill' } as const satisfies Record<string, PaintToken>;

/**
 * The paint of a mark larger than a point that names a colour role:
 * a line, area, bar, slice, cell or point group. The highlight role resolves
 * through `focus`, which falls back to the highlight, so the highlight stays
 * the one point accent. A `fill` (a bar, area, slice or cell) also
 * takes good, bad and warn through their fill twins. Every other role passes.
 */
export function markRolePaint(role: string, fill = false): Paint {
  const token = role === 'highlight' ? 'focus' : fill && Object.hasOwn(TONE_FILL_TWINS, role) ? TONE_FILL_TWINS[role as keyof typeof TONE_FILL_TWINS] : markRoleToken(role);
  return { token };
}

/**
 * The fill of each series that draws in a colour role, by series id. Series of
 * one chart that share a role take distinct steps of the role's colour (the
 * pie ramp, decided in the active theme), the first series the full colour, so
 * the reader can tell them apart by more than their order. A series with its
 * own fill keeps it and takes no step. `fill: false` steps the role's stroke
 * colour (a dot), as markRolePaint.
 */
export function colorRolePaints(series: readonly { id: string; colorRole?: string; fill?: string }[], fill = true): Map<string, Paint> {
  const byRole = new Map<string, string[]>();
  for (const s of series) {
    if (s.fill || !s.colorRole) continue;
    byRole.set(s.colorRole, [...(byRole.get(s.colorRole) ?? []), s.id]);
  }
  const paints = new Map<string, Paint>();
  for (const [role, ids] of byRole) {
    const base = markRolePaint(role, fill);
    ids.forEach((id, index) => paints.set(id, ids.length === 1 ? base
      : { token: 'token' in base ? base.token : 'series-1', theme: { kind: 'pie-ramp', base, index, count: ids.length } }));
  }
  return paints;
}

/** A mark's colour role as its paint token: the neutral paints a mark through `neutralMark`. */
export function markRoleToken(role: string): PaintToken {
  return (role === 'neutral' ? 'neutralMark' : role === 'others' ? 'othersMark' : role) as PaintToken;
}

/**
 * The paint of a large signed fill: a bar, column, area or cell
 * that the judgment colours. It resolves `color.goodFill` / `color.badFill`,
 * which fall back to good / bad. Text, ticks, strokes and small squares keep
 * the `good` / `bad` tokens.
 */
export function signedFillPaint(tone: 'good' | 'bad'): Paint {
  return { token: tone === 'good' ? 'goodFill' : 'badFill' };
}

/**
 * The paint as the given themes name it when none of them sets an optional
 * role: every `focus` token read as `highlight`, every `spark`
 * token as `neutralMark` and that as `neutral`, every `goodFill` / `badFill` / `warnFill` token as
 * `good` / `bad` / `warn` and every `inkMeta` token as `inkMuted`,
 * nested recipe bases included. The
 * CSS-variable writers and the React scene paint use it so a theme, or a
 * pair, that sets neither role keeps the variable names and recipe hashes it
 * always had. Returns the paint itself when it names no such role.
 */
export function unsetRolesAsFallback<T>(paint: T, themes: readonly Theme[]): T {
  const unset = new Map<string, string>();
  const isUnset = (role: string) => themes.every((theme) => theme.color[role as OptionalRole] === undefined);
  for (const [role, fallback] of Object.entries(OPTIONAL_ROLE_FALLBACK)) {
    if (!isUnset(role)) continue;
    // A fallback that is itself an unset optional role resolves one step on:
    // spark to neutralMark to neutral.
    let target: string = fallback;
    while (target in OPTIONAL_ROLE_FALLBACK && isUnset(target)) target = OPTIONAL_ROLE_FALLBACK[target as OptionalRole];
    unset.set(role, target);
  }
  if (unset.size === 0) return paint;
  const json = JSON.stringify(paint);
  if (![...unset.keys()].some((role) => json.includes(`"${role}"`))) return paint;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = key === 'token' && typeof entry === 'string' && unset.has(entry) ? unset.get(entry) : walk(entry);
    }
    return out;
  };
  return walk(paint) as T;
}

/**
 * Semantic layouts normally keep paints symbolic so the renderer owns theme
 * resolution. A named palette is a layout option, however, and is not visible
 * to the renderer. Materialise only the compatible semantic roles when a
 * valid named ramp was selected; judgment roles never pass through here.
 */
export function semanticPalettePaint(
  theme: Theme,
  name: string | undefined,
  token: 'neutral' | 'neutralMark' | 'neutralLight' | 'highlight' | 'focus' | 'spark' | 'total' | 'others' | 'sequential',
  tintAmount?: number,
): Paint {
  // The one sequential recipe tints
  // of series 1, or of the selected palette's first rank. The accent stays
  // for an authored focus.
  if (token === 'sequential') {
    const paint = seriesPaint(0, name !== undefined && theme.color.palettes?.[name] !== undefined ? name : undefined);
    return tintAmount === undefined ? paint : { ...paint, tint: tintAmount };
  }
  if (name === undefined || theme.color.palettes?.[name] === undefined) {
    return tintAmount === undefined ? { token } : { token, tint: tintAmount };
  }
  if (token === 'others') {
    return tintAmount === undefined ? { token } : { token, tint: tintAmount };
  }
  // A named palette outranks the spark role with its first rank, as it
  // outranks the neutral.
  const index = token === 'neutral' || token === 'neutralMark' || token === 'spark' || token === 'total' ? 0 : 1;
  return {
    ...seriesPaint(index, name),
    ...(tintAmount === undefined ? {} : { tint: tintAmount }),
  };
}

/**
 * The grounds a judged cell and a size bar paint under `table.tones: 'fill'`
 * and a cell's `bar`, one answer for both table surfaces. A key the theme
 * leaves out washes its role toward the background.
 */
export function cellGrounds(theme: Theme): { good: string; goodStrong: string; warn: string; bad: string; bar: string; barMuted: string } {
  const { background } = theme.color;
  const table = theme.table;
  const wash = (color: string, weight: number) => mixColors(color, background, weight);
  return {
    good: table?.grounds?.good ?? wash(theme.color.goodFill ?? theme.color.good, 0.12),
    goodStrong: table?.grounds?.goodStrong ?? wash(theme.color.goodFill ?? theme.color.good, 0.24),
    warn: table?.grounds?.warn ?? wash(theme.color.warnFill ?? warnColor(theme), 0.18),
    bad: table?.grounds?.bad ?? wash(theme.color.badFill ?? theme.color.bad, 0.18),
    bar: table?.bar?.fill ?? wash(theme.color.ink, 0.085),
    barMuted: table?.bar?.muted ?? wash(theme.color.inkMuted, 0.05),
  };
}

type CellGroundRole = keyof ReturnType<typeof cellGrounds>;

/** A cell ground as an opaque colour over the background, for a scene paint: an rgba() ground is laid over the page. */
function cellGroundColor(theme: Theme, role: CellGroundRole): string {
  const color = cellGrounds(theme)[role];
  const alpha = /^rgba\([^)]*,\s*([0-9.]+)\s*\)$/i.exec(color.trim())?.[1];
  return alpha === undefined ? color : mixColors(color, theme.color.background, Number(alpha));
}
