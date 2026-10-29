/**
 * Theme validation — the guardrails of the design interface. A theme JSON
 * from any source (designer, Claude Design, brand-ingestion agent) passes
 * through schema + perceptual lints before it can touch a chart. Layout is
 * unreachable from here by construction: themes carry only tokens.
 */

import { contrastRatio, mixColors, onFillGap, onFillInks, onFillPairFloor, parseColor, readsAsLoss, tint } from './color';
import { isTransparentTableFill } from './themeFill';
import { COLOR_FIX } from './colorLiteral';
import type { LintWarning } from './types/scene';
import type { Theme } from './types/theme';
import { familiesOf, resolveFace, tableFamilyKey } from './fontMetrics';

/** The paint roles and chart types present in a render. Omitted for full theme validation. */
export interface ThemeUsage { roles: ReadonlySet<string>; types: ReadonlySet<string>; series?: ReadonlyMap<string, ReadonlySet<string>> }
const uses = (usage: ThemeUsage | undefined, ...roles: string[]) => !usage || roles.every((role) => usage.roles.has(role));
const floor2 = (value: number) => (Math.floor(value * 100) / 100).toFixed(2);
function pairMeasurements(a: string, b: string, normalOnly = false): string {
  return (normalOnly ? ['normal'] as const : ['normal', 'protan', 'deutan', 'tritan'] as const).map((vision) =>
    `${vision} DeltaE ${palettePerceptualDistance(a, b, vision).toFixed(1)} (floor ${vision === 'normal' ? PALETTE_NORMAL_FLOOR : vision === 'tritan' ? PALETTE_TRITAN_FLOOR : PALETTE_CVD_FLOOR})`).join(', ');
}

const PALETTE_RANK_COUNT = 6;
// Floors: 12 is ~5x the OKLab
// JND — in line with published categorical-discriminability targets
// in colour-perception research — while 15 provably
// forces neon chroma at zero margin for any 6-rank light-legible ramp (such
// ramps pass at margin 0.02/0.00). Protan/deutan stay at 6
// (~8% of males, colour-blind-safe palette practice); tritan gets its own floor 4 because
// full tritanopia is ~1e-5 rare — still gated, but it must not dictate the
// whole ramp's character. The severity-1 CVD simulation matrices are unchanged.
export const PALETTE_NORMAL_FLOOR = 12;
export const PALETTE_CVD_FLOOR = 6;
export const PALETTE_TRITAN_FLOOR = 4;
/** Two colours shown side by side meet the swatch floor: 12 normal, 6 protan and deutan, 4 tritan. */
export function swatchApart(a: string, b: string): boolean {
  return palettePerceptualDistance(a, b, 'normal') >= PALETTE_NORMAL_FLOOR &&
    Math.min(palettePerceptualDistance(a, b, 'protan'), palettePerceptualDistance(a, b, 'deutan')) >= PALETTE_CVD_FLOOR &&
    palettePerceptualDistance(a, b, 'tritan') >= PALETTE_TRITAN_FLOOR;
}
// Bands (single authority: this file). Outside the L band a mark washes out or turns ink;
// under the chroma floor a hue "reads as gray".
// Warn-level: external brand ramps may deliberately trade these off.
// PALETTE_L_BAND and PALETTE_CHROMA_FLOOR apply to named multi-hue palettes
// (`palette-band`) and to the hue gate in oklchHueDistance, never to
// color.series: a theme may lead with low-chroma navy and grey ranks.
const PALETTE_L_BAND: readonly [number, number] = [0.43, 0.77];
const PALETTE_CHROMA_FLOOR = 0.1;
// Accent against loss only (accent-reads-as-loss, highlight-bad-similar).
// There is no hue rule between series ranks: the pair floors above keep the
// ranks apart.
const PALETTE_ADJACENT_HUE_FLOOR = 40;

type PaletteVision = 'normal' | 'protan' | 'deutan' | 'tritan';

const MACHADO: Record<Exclude<PaletteVision, 'normal'>, readonly (readonly number[])[]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

// ---------------------------------------------------------------------------
// Font-family grammar — the theme -> CSS paint boundary.
// `type.family` is the only free-form STRING a theme injects into a stylesheet,
// and a stylesheet in a host page lives inside <head><style>. A blocklist there
// loses (there is always one more escape: `</style`, `\3c`, `;}`, `/*`), so the
// grammar below is an ALLOWLIST built the same way the SVG side builds
// isSafeSvgColor: two shapes are admitted and everything else is refused.
// CSS Fonts 4 §2.2: a font-family list is comma-separated entries; each is
// either a <string> or a sequence of <custom-ident>s. Restricting both shapes
// to ASCII letters/digits/space/_/-/. makes markup, declaration terminators,
// block delimiters, CSS escapes and comment openers unrepresentable by
// construction, and a comma is admitted by ONE shape only: inside a quoted
// name, where CSS reads it as part of the name (`"Acme, Display"` is one
// family, unquoted `Acme, Display` is two). Every shipped preset family parses
// under it (see tests).
// ONE authority, expressed as ONE regex: `THEME_SHAPE` (themeShape.ts) checks
// every family against it. A second hand-written check here would be free to
// drift from it.
// ---------------------------------------------------------------------------
export const FONT_FAMILY_MAX_LENGTH = 240;
const FAMILY_PART =
  String.raw`(?:"[A-Za-z0-9, ._-]+"|'[A-Za-z0-9, ._-]+'|-?[A-Za-z_][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+)*)`;
/** The published font-family grammar. Anchored, ASCII-only, no backtracking. */
export const FONT_FAMILY_PATTERN = new RegExp(
  String.raw`^ *${FAMILY_PART}(?: *, *${FAMILY_PART})* *$`,
);

export const FONT_FAMILY_GRAMMAR =
  "comma-separated ASCII family names: unquoted idents (Arial, -apple-system, Helvetica Neue) or quoted names ('Helvetica Neue', \"Acme, Display\"), plus a generic (sans-serif)";

/** True when `value` is a font-family list inside the allowlisted grammar. */
export function isSafeFontFamily(value: string): boolean {
  if (value.length === 0 || value.length > FONT_FAMILY_MAX_LENGTH) return false;
  return FONT_FAMILY_PATTERN.test(value);
}

/**
 * Fail-closed accessor used by every surface that PAINTS the family into CSS
 * (HTML table stylesheet, theme stylesheet). Mirrors `checkedColor` on the
 * SVG side: a theme that never went through `parseThemeJson` still cannot
 * smuggle markup past this point.
 */
export function checkedFontFamily(value: string): string {
  const family = value.trim();
  if (!isSafeFontFamily(family)) {
    throw new Error(
      `invalid theme font family ${JSON.stringify(value.slice(0, 80))} — expected ${FONT_FAMILY_GRAMMAR}`,
    );
  }
  return family;
}

// ---------------------------------------------------------------------------
// Shadow grammar: the theme -> CSS paint boundary of `surface.panelShadow`.
// Same approach as the font-family grammar above: ALLOWLIST, one authority,
// checked through `THEME_SHAPE`. A shadow is `none`
// or comma-separated layers of optional `inset`, 2-4 px lengths and one
// trailing hex or rgb()/rgba() color. Semicolons, braces, CSS escapes,
// url(), var(), markup and control characters are unrepresentable.
// ---------------------------------------------------------------------------
const SHADOW_COLOR = String.raw`(?:#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})|rgba?\( *\d{1,3} *, *\d{1,3} *, *\d{1,3}(?: *, *(?:0|1|0?\.\d{1,4}|1\.0{1,4}))? *\))`;
const SHADOW_LENGTH = String.raw`(?:0|-?\d+(?:\.\d+)?px)`;
const SHADOW_LAYER = String.raw`(?:inset +)?${SHADOW_LENGTH}(?: +${SHADOW_LENGTH}){1,3} +${SHADOW_COLOR}`;
export const SHADOW_MAX_LENGTH = 400;
/** The published shadow grammar: `none` or comma-separated layers. */
export const SHADOW_PATTERN = new RegExp(
  String.raw`^(?:none|${SHADOW_LAYER}(?: *, *${SHADOW_LAYER})*)$`,
);
export const SHADOW_GRAMMAR =
  "'none' or comma-separated box-shadow layers: optional 'inset', 2-4 px lengths, then a hex/rgb()/rgba() color (e.g. '0 1px 2px rgba(13,42,67,0.10)')";

// ---------------------------------------------------------------------------
// Motion easing — the third free-form string a theme paints into CSS.
// The two keywords cover the shipped presets; a brand curve is a
// `cubic-bezier()` with four numeric control points and nothing else, so the
// value can carry no declaration terminator, no url(), no var() and no
// markup. Same allowlist approach as the grammars above, checked through
// `THEME_SHAPE`.
// ---------------------------------------------------------------------------
export const MOTION_EASING_MAX_LENGTH = 64;
/** The published easing grammar: a keyword or a four-point cubic-bezier(). */
export const MOTION_EASING_PATTERN =
  /^(?:linear|ease-out|cubic-bezier\(\s*-?\d*\.?\d+(\s*,\s*-?\d*\.?\d+){3}\s*\))$/;
export const MOTION_EASING_GRAMMAR =
  "'linear', 'ease-out', or a cubic-bezier() with four numeric control points (e.g. 'cubic-bezier(.2,.7,.2,1)')";

/** True when `value` is an easing inside the allowlisted grammar. */
function isSafeMotionEasing(value: string): boolean {
  if (value.length === 0 || value.length > MOTION_EASING_MAX_LENGTH) return false;
  return MOTION_EASING_PATTERN.test(value);
}

/**
 * Fail-closed accessor for every surface that PAINTS the easing into CSS
 * (the table stylesheet's transitions). Mirrors `checkedCssColor`.
 */
export function checkedMotionEasing(value: string): string {
  const easing = value.trim();
  if (!isSafeMotionEasing(easing)) {
    throw new Error(
      `invalid theme motion easing ${JSON.stringify(value.slice(0, 80))} — expected ${MOTION_EASING_GRAMMAR}`,
    );
  }
  return easing;
}


function validateColorFields(
  theme: Theme,
  push: (code: string, severity: LintWarning['severity'], message: string) => void,
): void {
  const c = theme.color;
  // parseability — only actual color fields (seriesOverflow is an enum)
  const COLOR_KEYS = [
    'good', 'bad', 'neutral', 'neutralLight', 'highlight', 'total', 'others',
    'ink', 'inkInverse', 'inkMuted', 'axis', 'grid', 'leader', 'background',
  ] as const;
  for (const k of COLOR_KEYS) {
    if (!parseColor(c[k])) {
      push('unparseable-color', 'error', `color.${k} = '${c[k]}' is not a parseable color. ${COLOR_FIX}`);
    }
  }
  c.series.forEach((s, i) => {
    if (!parseColor(s)) push('unparseable-color', 'error', `color.series[${i}] = '${s}' is not parseable. ${COLOR_FIX}`);
  });
  c.stack?.forEach((color, i) => {
    if (!parseColor(color)) push('unparseable-color', 'error', `color.stack[${i}] = '${color}' is not parseable. ${COLOR_FIX}`);
  });
  c.casePair?.forEach((color, i) => {
    if (!parseColor(color)) push('unparseable-color', 'error', `color.casePair[${i}] = '${color}' is not parseable. ${COLOR_FIX}`);
  });
  for (const k of ['focus', 'spark', 'neutralMark', 'goodFill', 'badFill', 'warnFill', 'inkMeta', 'rest', 'othersMark', 'markInk', 'heatTop', 'heatTopInk', 'onFillInk', 'onFillLightInk', 'rule', 'reference'] as const) {
    const value = c[k];
    if (value !== undefined && !parseColor(value)) {
      push('unparseable-color', 'error', `color.${k} = '${value}' is not a parseable color. ${COLOR_FIX}`);
    }
  }
  for (const [k, v] of Object.entries(c.status)) {
    if (!parseColor(v)) push('unparseable-color', 'error', `color.status.${k} = '${v}' is not parseable. ${COLOR_FIX}`);
  }
  for (const group of ['grounds', 'bar', 'inks'] as const) {
    for (const [key, value] of Object.entries(theme.table?.[group] ?? {})) {
      if (value !== undefined && !parseColor(value) && !isTransparentTableFill(`table.${group}.${key}`, value)) push('unparseable-color', 'error', `table.${group}.${key} = '${value}' is not a parseable color. ${COLOR_FIX}`);
    }
  }
}

/**
 * Perceptual lints. Severity 'error' blocks (`--validate` exits 1);
 * 'warn' ships but is reported.
 */
export function judgmentErasure(key: string, mark: string, background: string): LintWarning | undefined {
  const rgb = parseColor(mark);
  const bg = parseColor(background);
  if (!rgb || !bg || rgb.r !== bg.r || rgb.g !== bg.g || rgb.b !== bg.b) return undefined;
  return {
    code: 'semantic-equals-background', severity: 'error',
    message: `color.${key} = '${mark}' is the same colour as color.background = '${background}' — the ${key} mark does not exist`,
    suggest: `choose color.${key} distinct from the background so its mark is visible`,
  };
}


/** Visibility of verdict colors; shared by validation and the theme override gate. */
function semanticVisibilityWarnings(theme: Theme, usage?: ThemeUsage): LintWarning[] {
  const w: LintWarning[] = [];
  const c = theme.color;
  const push = (code: string, severity: LintWarning['severity'], message: string, suggest?: string) =>
    w.push({ code, severity, message, suggest });
  // --- judgment-token visibility -------------------------------------------
  // WHICH TOKENS. Only `good`/`bad`/`warn` are gated here. They are the
  // VERDICT tokens: the reader gets "over plan / under plan / at risk" from
  // the mark's colour and from nothing else, and they always paint a solid AC
  // fill, so the fill is their only channel. `neutral`, `total`, `highlight`,
  // `neutralLight` and `others` are FILLS — they carry no verdict (position,
  // label and category carry the reading), a light-grey total or base bar on a
  // white deck is ordinary consulting output, and under PL notation the
  // library deliberately paints them background-coloured with an outline
  // (scenario PL -> 'outline'), so background-identity is a legitimate
  // rendering for them rather than a defect. Their label legibility is already
  // gated by `contrast-inside-label` above. Gating them here rejected themes a
  // designer would ship (`{color:{total:'#F5F5F5'}}` on white).
  // WHICH SEVERITY. Contrast against a surface is taste-adjacent: a designer
  // may knowingly ship a dark-on-dark brand primary. So the threshold check is
  // a WARN that names the token and its measured ratio and leaves the call to
  // the designer. The only `error` is the case with no reading at all — the
  // mark resolves to the SAME colour as the surface, so no visible fill exists
  // for any viewer. That case involves no threshold, so it cannot be a near
  // miss.
  // THE THRESHOLD (measure the population the gate JUDGES, which is
  // brand JSON and override patches, NOT the six shipped presets). Measured
  // over 66 judgment-token samples from 22 brand-ish themes (published
  // corporate/product palettes on the surfaces those brands ship, dark
  // surfaces over-represented because that is where a brand primary lands
  // closest to its own background): min 1.21, p05 1.63, median 4.65. A
  // floor of 1.4 fires on 3 of those 66, a boundary gate on the real
  // population. 1.1 fires on 0 of 66, with 1.10x
  // margin on the worst realistic sample and 1.48x on the p05. Under ~1.1 two
  // fills differ by less than ~10% relative luminance and read as one tone.
  const SEMANTIC_VISIBILITY_FLOOR = 1.1;
  const bg = parseColor(c.background);
  for (const [k, mark] of Object.entries({ good: c.good, bad: c.bad, warn: c.warn, goodFill: c.goodFill, badFill: c.badFill, warnFill: c.warnFill })) {
    if (!uses(usage, k)) continue;
    const rgb = mark === undefined ? null : parseColor(mark);
    if (!rgb || !bg) continue;
    const erased = judgmentErasure(k, mark!, c.background);
    if (erased) { w.push(erased); continue; }
    const seen = contrastRatio(mark!, c.background);
    if (seen < SEMANTIC_VISIBILITY_FLOOR) {
      push(
        'semantic-invisible',
        'warn',
        `color.${k} = '${mark}' is hard to separate from color.background = '${c.background}' (normal contrast ${floor2(seen)}, floor ${SEMANTIC_VISIBILITY_FLOOR})`,
        'a verdict token that sinks into the surface weakens the semantic — separate it from the background if that was not deliberate',
      );
    }
  }
  return w;
}

/**
 * Fill readability, kept apart from text contrast.
 *
 * The checks above answer "can a reader still see the text": `ink` and
 * `inkMuted` are gated against the background, and `contrast-inside-label`
 * gates the ink that sits ON a fill. Neither one says anything about whether a
 * FILL itself separates from the surface, which is the channel a pale PY or
 * Others mark actually uses. So this check names that channel explicitly and
 * reports it as `fill-separation`, never as a text-contrast failure.
 *
 * A fill that sinks into the surface is still a legitimate rendering: under
 * PL notation the library paints those marks background-coloured on
 * purpose, and the position, label and hatch outline carry the reading. The
 * finding therefore stays a WARN and its suggestion names the qualifying cue
 * (an outline or a hatch pattern) instead of asking for a text-level ratio.
 *
 * THE FLOOR (measured over the shipped presets): the lowest
 * separation any preset ships is `others` at 1.14
 * (standard). 1.1 reports none of them while still catching a fill
 * that is effectively the background, which is the defect this check exists
 * for. A preset that drops below it fails the pinned warning counts in
 * tests/theme-presets-validate.test.ts, so the number can only move on purpose.
 */
/** The fill-separation floor: a fill under it is effectively the background. */
export const FILL_SEPARATION_FLOOR = 1.1;

export function fillReadabilityWarnings(theme: Theme, usage?: ThemeUsage): LintWarning[] {
  const floor = FILL_SEPARATION_FLOOR;
  const background = theme.color.background;
  if (!parseColor(background)) return [];
  return (['neutralLight', 'others', 'othersMark', 'total'] as const).flatMap((key) => {
    if (!uses(usage, key)) return [];
    const fill = theme.color[key];
    if (fill === undefined || !parseColor(fill)) return [];
    const seen = contrastRatio(fill, background);
    return seen < floor
      ? [{
        code: 'fill-separation',
        severity: 'warn' as const,
        message: `color.${key} = '${fill}' separates from color.background = '${background}' by normal contrast ${floor2(seen)} as a fill (floor ${floor})`,
        suggest: 'this is fill readability, not text contrast: keep the pale fill if it is deliberate and qualify it with an outline or a hatch pattern so the mark still reads',
      }]
      : [];
  });
}

/**
 * THE COLOUR CHECK. Every
 * number, name and colour a theme paints has to be readable without guessing:
 *
 *   1. ink-on-fill: on every fill text can sit on, the theme ink, the inverse
 *      ink or an on-fill ink (near-black, or white on a dark theme's mid-tone
 *      fill) reaches 4.5:1 (WCAG AA body text).
 *   2. tone-text-contrast: good, bad and warn printed as text reach 4.5:1 on
 *      the background and on their own chip tint.
 *   3. series-invisible (floor 3 here): series and the neutral mark
 *      reach 3:1 as marks (WCAG 2.2 SC 1.4.11); markInk and reference have
 *      their own 3:1 checks above.
 *   4. swatch-similar: the colours one chart shows side by side meet the swatch
 *      floor pairwise (12 normal, 6 protan and deutan, 4 tritan; the series
 *      ramp keeps its own series-similar check).
 *   5. ramp-order: the sequential ramp and each side of the diverging ramp
 *      rise in contrast against the page class by class and neighbouring
 *      classes stay 6 OKLab apart; the sequential ramp's top class reaches 3:1.
 *   6. accent-reads-as-loss: the accent, the selection colour, the first series, the neutral mark and the ramp base neither
 *      read as loss nor sit within 40 degrees of OKLCH hue of bad. Warn and the
 *      semantic negatives are exempt.
 *
 * Warn level, so a host's own theme gets them as diagnostics and still draws;
 * tests/theme-presets-validate.test.ts holds the six gallery presets to zero.
 */
export const TEXT_CONTRAST_FLOOR = 4.5;
/**
 * The keyed classes of a sequential or diverging ramp, as the wash of the base
 * colour toward the page (the heatmap ladder's four ramp steps, the top class
 * the full base). A neighbour pair under the class floor (about three
 * just-noticeable differences) reads as one class.
 */
const RAMP_CLASS_TINTS = [0.72, 0.48, 0.24, 0] as const;
const RAMP_CLASS_FLOOR = 6;
export const MARK_CONTRAST_FLOOR = 3;
export const COLOUR_CHECK_CODES = [
  'ink-on-fill', 'tone-text-contrast', 'series-invisible', 'mark-ink-invisible', 'contrast-reference',
  'series-similar', 'swatch-similar', 'ramp-order', 'accent-reads-as-loss', 'highlight-bad-similar',
  'fill-separation', 'semantic-invisible',
] as const;

function colourCheckWarnings(theme: Theme, usage?: ThemeUsage): LintWarning[] {
  const w: LintWarning[] = [];
  const c = theme.color;
  if (!parseColor(c.background)) return w;
  const push = (code: string, message: string, suggest: string) => w.push({ code, severity: 'warn', message, suggest });
  const focus = c.focus ?? c.highlight;
  const neutralMark = c.neutralMark ?? c.neutral;
  const chipTint = theme.surface?.chipTint ?? 0.9;
  const own = <T extends string>(entries: [T, string | undefined][]): [T, string][] =>
    entries.filter((entry): entry is [T, string] => uses(usage, entry[0].replace(/^color\./, '')) && entry[1] !== undefined && parseColor(entry[1]) !== null);

  // 1. Text on a fill: one of three inks reaches 4.5:1.
  const fills = own([
    ['neutral', c.neutral], ['neutralMark', c.neutralMark], ['neutralLight', c.neutralLight],
    ['highlight', c.highlight], ['focus', c.focus], ['total', c.total], ['others', c.others],
    ['good', c.good], ['bad', c.bad], ['warn', c.warn], ['goodFill', c.goodFill], ['badFill', c.badFill], ['warnFill', c.warnFill],
    ['rest', c.rest], ['othersMark', c.othersMark], ...c.series.map((s, i): [string, string] => [`series[${i}]`, s]),
    ...Object.entries(c.status).map(([k, v]): [string, string] => [`status.${k}`, v]),
  ]);
  // The on-fill pair is the theme's own.
  const [onFillInk, onFillLightInk] = onFillInks(c);
  for (const [key, fill] of fills) {
    const inks = [c.ink, c.inkInverse, onFillInk, onFillLightInk];
    const best = Math.max(...inks.map((ink) => contrastRatio(ink, fill)));
    if (best < TEXT_CONTRAST_FLOOR) {
      push('ink-on-fill', `no ink reaches ${TEXT_CONTRAST_FLOOR}:1 on color.${key} = '${fill}' (normal contrast ${floor2(best)}; inks ${inks.join(', ')}; floor ${TEXT_CONTRAST_FLOOR})`,
        `move color.${key} out of the mid-tone band, or set an ink that reads on it`);
    }
  }

  // A theme that sets its own on-fill pair is held to what the defaults
  // promise: one of the two reaches 4.5:1 on every fill, which
  // needs 20.25:1 between them. Checked whatever the chart draws, since any
  // label on a mid-tone fill can fall back to the pair.
  if ((c.onFillInk !== undefined || c.onFillLightInk !== undefined) && parseColor(onFillInk) && parseColor(onFillLightInk)) {
    const floor = onFillPairFloor(onFillInk, onFillLightInk);
    if (floor < TEXT_CONTRAST_FLOOR) {
      // The fills an author can check against, widened to three decimals so a fill on a printed edge is inside.
      const gap = onFillGap(onFillInk, onFillLightInk, TEXT_CONTRAST_FLOOR);
      const band = gap ? `. Neither reaches ${TEXT_CONTRAST_FLOOR}:1 on a fill of relative luminance ${(Math.floor(gap[0] * 1000) / 1000).toFixed(3)} to ${(Math.ceil(gap[1] * 1000) / 1000).toFixed(3)}` : '';
      push('ink-on-fill', `color.onFillInk '${onFillInk}' and color.onFillLightInk '${onFillLightInk}' stand ${floor2(contrastRatio(onFillInk, onFillLightInk))}:1 apart, so on a mid-tone fill the better of them reaches normal contrast ${floor2(floor)} (floor ${TEXT_CONTRAST_FLOOR}; the pair needs ${TEXT_CONTRAST_FLOOR ** 2}:1)${band}`,
        'darken color.onFillInk or lighten color.onFillLightInk until the two stand 20.25:1 apart, or leave both out for #050505 and #FFFFFF');
    }
  }

  // 2. Tone text on the page and on its own chip tint.
  for (const [key, tone] of own([['good', c.good], ['bad', c.bad], ['warn', c.warn]])) {
    const chip = tint(tone, chipTint, c.background);
    const page = contrastRatio(tone, c.background);
    const onChip = contrastRatio(tone, chip);
    if (Math.min(page, onChip) < TEXT_CONTRAST_FLOOR) {
      push('tone-text-contrast', `color.${key} = '${tone}' as text reaches normal contrast ${floor2(page)}:1 on background '${c.background}' and ${floor2(onChip)}:1 on chip '${chip}' (floor ${TEXT_CONTRAST_FLOOR})`,
        `darken color.${key} for text and keep the brighter fill in color.${key}Fill if the marks need it`);
    }
  }

  // 4. Colours one chart shows side by side. A pair with a judgment tone
  // (good, bad, warn, lost) is held to the normal floor only: red against
  // green is the colour-vision case colorblindSafe exists for, and that mode's
  // own set is held to the full floor below.
  const JUDGMENT = new Set(['good', 'bad', 'warn', 'lost']);
  const apart = (set: string, pairs: [string, string][], types?: string[]) => {
    if (usage && types && !types.some((type) => usage.types.has(type))) return;
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const [ka, a] = pairs[i]!;
        const [kb, b] = pairs[j]!;
        const normal = palettePerceptualDistance(a, b, 'normal');
        const judged = JUDGMENT.has(ka) || JUDGMENT.has(kb);
        const cvd = judged ? Infinity : Math.min(palettePerceptualDistance(a, b, 'protan'), palettePerceptualDistance(a, b, 'deutan'));
        const tri = judged ? Infinity : palettePerceptualDistance(a, b, 'tritan');
        if (normal < PALETTE_NORMAL_FLOOR || cvd < PALETTE_CVD_FLOOR || tri < PALETTE_TRITAN_FLOOR) {
          push('swatch-similar', `${set}: ${ka} '${a}' and ${kb} '${b}' are hard to tell apart (${pairMeasurements(a, b, judged)})`,
            `respace the two colours to the swatch floor (${PALETTE_NORMAL_FLOOR} normal, ${PALETTE_CVD_FLOOR} CVD, ${PALETTE_TRITAN_FLOOR} tritan), or draw a keyed second cue`);
        }
      }
    }
  };
  const ranks = c.series.slice(0, PALETTE_RANK_COUNT);
  const s0 = c.series[0];
  if (s0 && parseColor(s0) && uses(usage, 'scenario.PY', 'series[0]')) apart('scenario AC and PY', [['AC', s0], ['PY', mixColors(s0, c.background, 0.45)]]);
  for (const [i, s] of ranks.entries()) {
    apart('bartable range and series', own([['neutralLight', c.neutralLight], [`series[${i}]`, s]]), ['bartable']);
    apart('scatter ring and groups', own([['focus', focus], [`series[${i}]`, s]]), ['scatter']);
  }
  apart('two panes, dumbbell ends, effects', own([['neutralMark', neutralMark], ['focus', focus]]), ['butterfly', 'dot', 'waterfall', 'pvm']);
  apart('waterfall and pvm effects and total', own([['neutralMark', neutralMark], ['focus', focus], ['total', c.total]]), ['waterfall', 'pvm']);
  apart('status tones', own([['good', c.goodFill ?? c.good], ['bad', c.badFill ?? c.bad], ['warn', c.warnFill ?? c.warn], ['neutralMark', neutralMark], ['focus', focus]]));
  // A maturity key puts a won state beside the neutral one.
  apart('status won and neutral', own([['status.won', c.status.won], ['neutralMark', neutralMark]]));
  apart('status tones under colorblindSafe', own([
    ['colorblind.good', c.colorblind.goodFill ?? c.colorblind.good], ['colorblind.bad', c.colorblind.badFill ?? c.colorblind.bad],
    ['warn', c.warnFill ?? c.warn], ['neutralMark', neutralMark], ['focus', focus],
  ]).map(([k, v]): [string, string] => [k === 'warn' ? 'warn under colorblindSafe' : k, v]));
  apart('funnel states', own([['open', c.status.open], ['pending', c.status.pending], ['won', c.status.won], ['lost', c.status.lost]]));
  apart('gantt roles', own([['workstream', c.status['gantt-workstream']], ['detail', c.status['gantt-detail']], ['special', c.status['gantt-special']]]));
  // The bullet band ladder is spaced by its recipe (bulletBandPaints) and
  // measured in the scene sweep, not here.

  // 5. Ordered ramps: the sequential ramp (series 1 washed toward the page)
  // and each side of the diverging ramp (the signed fills) run in order from
  // low to high contrast against the page, every keyed class stays readably
  // apart from its neighbour, and the top class reaches the mark floor.
  const ramps = own([['color.series[0]', s0], ['color.goodFill', c.goodFill ?? c.good], ['color.badFill', c.badFill ?? c.bad]]);
  for (const [key, base] of ramps) {
    const classes = RAMP_CLASS_TINTS.map((amount) => tint(base, amount, c.background));
    const contrasts = classes.map((step) => contrastRatio(step, c.background));
    const unordered = contrasts.findIndex((value, k) => k > 0 && value <= contrasts[k - 1]!);
    const merged = classes.findIndex((step, k) => k > 0 && palettePerceptualDistance(classes[k - 1]!, step) < RAMP_CLASS_FLOOR);
    // The sequential ramp's top class is a mark-strength colour; a signed
    // side's top class is a large fill, held to order and separation.
    if (key === 'color.series[0]' && contrasts[contrasts.length - 1]! < MARK_CONTRAST_FLOOR) {
      push('ramp-order', `the ramp on ${key} = '${base}' tops out at normal contrast ${floor2(contrasts[contrasts.length - 1]!)}:1 on background '${c.background}' (floor ${MARK_CONTRAST_FLOOR}), so its top class does not read as the strongest`,
        `give the ramp base at least ${MARK_CONTRAST_FLOOR}:1 on the background`);
    } else if (unordered !== -1) {
      push('ramp-order', `the ramp on ${key} = '${base}' does not rise in normal contrast from class ${unordered} '${classes[unordered - 1]}' (${floor2(contrasts[unordered - 1]!)}) to class ${unordered + 1} '${classes[unordered]}' (${floor2(contrasts[unordered]!)}) on '${c.background}'; required above ${floor2(contrasts[unordered - 1]!)}`,
        'use a ramp base that differs from the background in lightness');
    } else if (merged !== -1) {
      push('ramp-order', `classes ${merged} '${classes[merged - 1]}' and ${merged + 1} '${classes[merged]}' of the ramp on ${key} = '${base}' have normal OKLab DeltaE ${palettePerceptualDistance(classes[merged - 1]!, classes[merged]!).toFixed(1)} (floor ${RAMP_CLASS_FLOOR})`,
        'give the ramp base more contrast against the background so its classes stay apart');
    }
  }

  // 6. The accent never borrows the loss hue. A grey (chroma under one OKLab
  // JND, 0.02) has no hue to borrow, so it skips the RGB fallback.
  const readsAsBad = (value: string): boolean => {
    if (readsAsLoss(value)) return true;
    const hue = oklchHueDistance(value, c.bad);
    if (hue !== null) return hue < PALETTE_ADJACENT_HUE_FLOOR;
    return oklabLc(value)!.C >= 0.02 && rgbDistance(value, c.bad) < 90;
  };
  for (const [key, value] of own([
    ['highlight', c.highlight], ['focus', c.focus],
    ['series[0]', s0], ['neutralMark', neutralMark], ['total', c.total], ['status.gantt-special', c.status['gantt-special']],
  ])) {
    if (readsAsBad(value)) {
      push('accent-reads-as-loss', `color.${key} = '${value}' reads as loss next to bad '${c.bad}' (normal ${oklchHueDistance(value, c.bad) === null ? `RGB distance ${rgbDistance(value, c.bad).toFixed(1)}, floor 90` : `OKLCH hue distance ${oklchHueDistance(value, c.bad)!.toFixed(1)} degrees, floor ${PALETTE_ADJACENT_HUE_FLOOR}`}; the accent must also stay outside the red-orange family)`,
        `take a hue at least ${PALETTE_ADJACENT_HUE_FLOOR} degrees of OKLCH hue from bad and outside the red-orange family`);
    }
  }
  return w;
}

export function validateTheme(theme: Theme, usage?: ThemeUsage, measuredFamilies?: readonly string[]): LintWarning[] {
  const w: LintWarning[] = [];
  const c = theme.color;
  const push = (code: string, severity: LintWarning['severity'], message: string, suggest?: string) =>
    w.push({ code, severity, message, suggest });
  const darkBackground =
    contrastRatio(c.background, '#FFFFFF') > contrastRatio(c.background, '#000000');
  // WCAG 2.2 SC 1.4.11 uses 3:1 for meaningful graphical objects. Preserve
  // the existing 4.5:1 small-text guard on light surfaces; fixed semantic
  // colors cannot all reach it on a dark surface, where they are mark/outline
  // fills and their overlaid text still uses the separately validated ink.
  const semanticBackgroundFloor = darkBackground ? 3 : 4.5;
  // Series and the neutral mark are marks: 3:1 on either scheme.
  // Named palettes keep a lower light floor until they are respaced.
  const seriesBackgroundFloor = MARK_CONTRAST_FLOOR;
  const paletteBackgroundFloor = darkBackground ? 3 : 1.4;
  validateColorFields(theme, push);

  // readability — the invariants that keep charts consulting-grade
  const need = (a: string, b: string, min: number, label: string, code: string) => {
    const r = contrastRatio(a, b);
    if (r < min) {
      push(code, 'error', `${label} '${a}' on '${b}': normal contrast ${floor2(r)} < required ${min}`,
        'pick a darker/lighter pair — inside labels must stay readable');
    }
  };
  if (uses(usage, 'ink')) need(c.ink, c.background, 4.5, 'ink on background', 'contrast-ink');
  if (uses(usage, 'inkMuted')) need(c.inkMuted, c.background, 3, 'inkMuted on background', 'contrast-ink-muted');
  if (uses(usage, 'inkMeta') && c.inkMeta !== undefined) need(c.inkMeta, c.background, 3, 'inkMeta on background', 'contrast-ink-muted');
  // A slope's rails are read against: 3:1 like any meaningful graphic.
  // So is a data mark in the mark ink: it draws lines as thin as a hairline.
  if (uses(usage, 'markInk') && c.markInk !== undefined && parseColor(c.markInk) && contrastRatio(c.markInk, c.background) < 3) {
    push('mark-ink-invisible', 'warn',
      `color.markInk '${c.markInk}' paints data marks against background '${c.background}': normal contrast ${floor2(contrastRatio(c.markInk, c.background))} is under 3:1 on the background`,
      'set color.markInk to a mark-strength colour that reaches 3:1 as a line');
  }
  if (uses(usage, 'reference') && c.reference !== undefined) need(c.reference, c.background, 3, 'reference on background', 'contrast-reference');
  // inside labels sit on these fills with auto-ink — at least ONE ink must work per fill
  // A focus colour fills the highlighted bar or slice its label sits on, as
  // the highlight did, so it is held to the same floor when set;
  // the signed fill roles likewise.
  for (const [k, fill] of Object.entries({
    neutral: c.neutral, highlight: c.highlight, good: c.good, bad: c.bad, total: c.total,
    ...(c.focus === undefined ? {} : { focus: c.focus }),
    ...(c.goodFill === undefined ? {} : { goodFill: c.goodFill }),
    ...(c.badFill === undefined ? {} : { badFill: c.badFill }),
    ...(c.warnFill === undefined ? {} : { warnFill: c.warnFill }),
  })) {
    if (!uses(usage, k)) continue;
    const best = Math.max(contrastRatio(c.ink, fill), contrastRatio(c.inkInverse, fill));
    if (best < 3) {
      push('contrast-inside-label', 'error',
        `neither ink '${c.ink}' nor inkInverse '${c.inkInverse}' reaches normal contrast 3:1 on color.${k} '${fill}' (best ${floor2(best)}, floor 3)`);
    }
  }
  // A stepped heat lane prints its top band's figures in heatTopInk on
  // heatTop: once a theme sets either, the pair meets the same floor.
  if (uses(usage, 'heatTop', 'heatTopInk') && (c.heatTop !== undefined || c.heatTopInk !== undefined)) {
    const ratio = contrastRatio(c.heatTopInk ?? c.inkInverse, c.heatTop ?? c.markInk ?? c.ink);
    if (ratio < 3) {
      push('contrast-inside-label', 'error',
        `color.heatTopInk '${c.heatTopInk ?? c.inkInverse}' on color.heatTop '${c.heatTop ?? c.markInk ?? c.ink}' has normal contrast ${floor2(ratio)} (floor 3:1)`);
    }
  }
  w.push(...semanticVisibilityWarnings(theme, usage));
  // Fill readability is a separate channel from the ink contrast checks above.
  w.push(...fillReadabilityWarnings(theme, usage));
  // Judgment pairs must be distinguishable — the floor is one named number
  // so the four checks below cannot drift apart.
  const JUDGMENT_PAIR_RGB_FLOOR = 90;
  // good vs bad must be distinguishable — HUE distance, not luminance
  // (a proper red and green share luminance; contrast ratio is the wrong metric)
  if (uses(usage, 'good', 'bad') && rgbDistance(c.good, c.bad) < JUDGMENT_PAIR_RGB_FLOOR) {
    push('good-bad-similar', 'error', `good '${c.good}' and bad '${c.bad}' are nearly identical — variance semantics vanish (normal RGB distance ${rgbDistance(c.good, c.bad).toFixed(1)}, floor ${JUDGMENT_PAIR_RGB_FLOOR})`);
  }
  // The large signed fills are held to the same floor once a theme sets one.
  if (uses(usage, 'goodFill', 'badFill') && (c.goodFill !== undefined || c.badFill !== undefined) && rgbDistance(c.goodFill ?? c.good, c.badFill ?? c.bad) < JUDGMENT_PAIR_RGB_FLOOR) {
    push('good-bad-similar', 'error', `goodFill '${c.goodFill ?? c.good}' and badFill '${c.badFill ?? c.bad}' are nearly identical — large signed fills lose their verdict (normal RGB distance ${rgbDistance(c.goodFill ?? c.good, c.badFill ?? c.bad).toFixed(1)}, floor ${JUDGMENT_PAIR_RGB_FLOOR})`);
  }
  // --- accent vs bad --------------------------------------------------------
  // highlight is THE accent, not a verdict — but a reader cannot know that.
  // An accent close to `bad` makes every highlight-painted mark (sequential
  // map/heatmap ramps, accent marks beside signed variances) read as alarm.
  // "Reads as alarm" is a HUE-family judgment, so OKLCH hue distance is
  // authoritative when both colors carry chroma: it catches the coral-vs-
  // crimson case (capital, hue 10°) and the dark-crimson-vs-light-coral case
  // RGB distance misses entirely (RGB 174, hue 5°), while clearing gold vs
  // red (a gold series rank, hue 51°, RGB only 77 — a raw RGB floor over-fires
  // there). When either color sits under oklchHueDistance's chroma gate hue
  // is meaningless, and plain RGB distance takes over so a muted accent
  // next to a muted brick `bad` still warns.
  // Measured over the shipped population: every preset and palette clears
  // (greys like notation #808080 fall to the RGB arm at 119); the motivating
  // failures fire. Warn, not error: a brand may knowingly ship a red
  // accent, and the valence ramps themselves derive from good/bad.
  const accentReadsAsBad = (accent: string): boolean => {
    if (!parseColor(accent) || !parseColor(c.bad)) return false;
    const hueDistance = oklchHueDistance(accent, c.bad);
    if (hueDistance !== null) return hueDistance < PALETTE_ADJACENT_HUE_FLOOR;
    return rgbDistance(accent, c.bad) < JUDGMENT_PAIR_RGB_FLOOR;
  };
  if (uses(usage, 'highlight', 'bad') && accentReadsAsBad(c.highlight)) {
    push(
      'highlight-bad-similar',
      'warn',
      `highlight '${c.highlight}' and bad '${c.bad}' are hard to tell apart — accent marks and sequential ramps will read as alarm (normal ${oklchHueDistance(c.highlight, c.bad) === null ? `RGB distance ${rgbDistance(c.highlight, c.bad).toFixed(1)}, floor ${JUDGMENT_PAIR_RGB_FLOOR}` : `OKLCH hue ${oklchHueDistance(c.highlight, c.bad)!.toFixed(1)} degrees, floor ${PALETTE_ADJACENT_HUE_FLOOR}`})`,
      'move the accent to a different hue family than the bad verdict, or accept that highlighted marks read as unfavorable',
    );
  }
  // Named palettes are checked at rank 2 because resolveSemanticPaletteTheme
  // substitutes exactly that color for `highlight` when the palette is
  // selected — a safe blue accent proves nothing about `palette: 'house'`.
  for (const [name, ramp] of Object.entries(c.palettes ?? {})) {
    if (uses(usage, `palettes.${name}[1]`, 'bad') && ramp[1] !== undefined && accentReadsAsBad(ramp[1])) {
      push(
        'palette-accent-bad-similar',
        'warn',
        `color.palettes.${name}[1] '${ramp[1]}' and bad '${c.bad}' are hard to tell apart (normal ${oklchHueDistance(ramp[1], c.bad) === null ? `RGB distance ${rgbDistance(ramp[1], c.bad).toFixed(1)}, floor ${JUDGMENT_PAIR_RGB_FLOOR}` : `OKLCH hue distance ${oklchHueDistance(ramp[1], c.bad)!.toFixed(1)} degrees, floor ${PALETTE_ADJACENT_HUE_FLOOR}`}) — with palette '${name}' selected, rank 2 becomes the accent and sequential ramps will read as alarm`,
        `respace color.palettes.${name}[1] away from the bad verdict, or accept that this palette reads as unfavorable on semantic charts`,
      );
    }
  }
  const seriesAt = (role: string) => usage?.series?.get(role)?.size ? ` (series ${[...usage.series.get(role)!].map(id => `'${id}'`).join(', ')})` : '';
  // warn (at-risk) must read as its own judgment class, legible at chip size
  if (c.warn && uses(usage, 'warn')) {
    if (uses(usage, 'good') && rgbDistance(c.warn, c.good) < JUDGMENT_PAIR_RGB_FLOOR) {
      push('warn-good-similar', 'error', `warn '${c.warn}' and good '${c.good}' are nearly identical — at-risk reads as on-track (normal RGB distance ${rgbDistance(c.warn, c.good).toFixed(1)}, floor ${JUDGMENT_PAIR_RGB_FLOOR})`);
    }
    if (uses(usage, 'bad') && rgbDistance(c.warn, c.bad) < JUDGMENT_PAIR_RGB_FLOOR) {
      push('warn-bad-similar', 'error', `warn '${c.warn}'${seriesAt('warn')} and bad '${c.bad}'${seriesAt('bad')} are nearly identical — at-risk reads as off-track (normal RGB distance ${rgbDistance(c.warn, c.bad).toFixed(1)}, floor ${JUDGMENT_PAIR_RGB_FLOOR})`);
    }
    const warnContrast = contrastRatio(c.warn, c.background);
    if (warnContrast < semanticBackgroundFloor) {
      push(
        'warn-low-contrast',
        'warn',
        `warn '${c.warn}' against background '${c.background}': normal contrast ${floor2(warnContrast)} is under ${semanticBackgroundFloor}:1 on the background`,
      );
    }
  }
  // series ramp: pairwise distinguishable, visible on background
  for (let i = 0; i < c.series.length; i++) {
    if (!uses(usage, `series[${i}]`)) continue;
    const si = c.series[i]!;
    const backgroundContrast = contrastRatio(si, c.background);
    if (backgroundContrast < seriesBackgroundFloor) {
      push(
        'series-invisible',
        'warn',
        `color.series[${i}] '${si}' against background '${c.background}': normal contrast ${floor2(backgroundContrast)} is under ${seriesBackgroundFloor}:1 on the background`,
      );
    }
    // Perceptual pairwise check (same floors as named palettes) — a
    // luminance-ratio heuristic is hue-blind and flags equal-lightness
    // pairs that are trivially distinguishable (teal vs periwinkle).
    for (let j = i + 1; j < Math.min(PALETTE_RANK_COUNT, c.series.length); j++) {
      if (!uses(usage, `series[${j}]`) || !parseColor(si) || !parseColor(c.series[j]!)) continue;
      const normal = palettePerceptualDistance(si, c.series[j]!, 'normal');
      const tri = palettePerceptualDistance(si, c.series[j]!, 'tritan');
      const cvd = Math.min(
        palettePerceptualDistance(si, c.series[j]!, 'protan'),
        palettePerceptualDistance(si, c.series[j]!, 'deutan'),
      );
      if (normal < PALETTE_NORMAL_FLOOR || cvd < PALETTE_CVD_FLOOR || tri < PALETTE_TRITAN_FLOOR) {
        push('series-similar', 'warn', `color.series[${i}] '${si}' and [${j}] '${c.series[j]}' are hard to tell apart (${pairMeasurements(si, c.series[j]!)})`);
      }
    }
  }
  // A mark in the neutral (a butterfly side, a neutral-tone bar) paints
  // in color.neutralMark, falling back to color.neutral, and is held to the
  // series floor like any series. The neutral itself may stay a band ground.
  const neutralMarkKey = c.neutralMark === undefined ? 'neutral' : 'neutralMark';
  const neutralMarkContrast = parseColor(c[neutralMarkKey] ?? '') ? contrastRatio(c[neutralMarkKey]!, c.background) : Infinity;
  if (uses(usage, neutralMarkKey) && neutralMarkContrast < seriesBackgroundFloor) {
    push(
      'series-invisible',
      'warn',
      `color.${neutralMarkKey} '${c[neutralMarkKey]}' paints marks against background '${c.background}': normal contrast ${floor2(neutralMarkContrast)} is under ${seriesBackgroundFloor}:1 on the background`,
      'set color.neutralMark to a mark-strength colour; color.neutral can stay the band ground',
    );
  }
  // named palettes: same visibility/distinguishability bar as the main ramp
  for (const [name, ramp] of Object.entries(c.palettes ?? {})) {
    ramp.forEach((col, i) => {
      if (!parseColor(col)) push('unparseable-color', 'error', `color.palettes.${name}[${i}] = '${col}' is not parseable`);
    });
    for (let i = 0; i < ramp.length; i++) {
      if (!uses(usage, `palettes.${name}[${i}]`)) continue;
      if (parseColor(ramp[i]!) && contrastRatio(ramp[i]!, c.background) < paletteBackgroundFloor) {
        push(
          'series-invisible',
          'warn',
          `color.palettes.${name}[${i}] '${ramp[i]}' against background '${c.background}': normal contrast ${floor2(contrastRatio(ramp[i]!, c.background))} is under ${paletteBackgroundFloor}:1`,
        );
      }
      if (i < PALETTE_RANK_COUNT && parseColor(ramp[i]!)) {
        const lc = oklabLc(ramp[i]!);
        if (lc) {
          if (lc.L < PALETTE_L_BAND[0] || lc.L > PALETTE_L_BAND[1]) {
            push('palette-band', 'warn', `color.palettes.${name}[${i}] OKLCH lightness ${lc.L.toFixed(2)} is outside the readable band [${PALETTE_L_BAND[0]}, ${PALETTE_L_BAND[1]}]`);
          } else if (lc.C < PALETTE_CHROMA_FLOOR) {
            push('palette-band', 'warn', `color.palettes.${name}[${i}] OKLCH chroma ${lc.C.toFixed(2)} is under ${PALETTE_CHROMA_FLOOR} — the hue reads as gray`);
          }
        }
      }
      for (let j = i + 1; j < Math.min(PALETTE_RANK_COUNT, ramp.length); j++) {
        if (!uses(usage, `palettes.${name}[${j}]`) || !parseColor(ramp[i]!) || !parseColor(ramp[j]!)) continue;
        const normal = palettePerceptualDistance(ramp[i]!, ramp[j]!, 'normal');
        const cvd = (['protan', 'deutan', 'tritan'] as const)
          .map((vision) => ({
            vision,
            distance: palettePerceptualDistance(ramp[i]!, ramp[j]!, vision),
            floor: vision === 'tritan' ? PALETTE_TRITAN_FLOOR : PALETTE_CVD_FLOOR,
          }))
          .sort((a, b) => a.distance - a.floor - (b.distance - b.floor))[0]!;
        if (normal < PALETTE_NORMAL_FLOOR || cvd.distance < cvd.floor) {
          push(
            'palette-rank-separation',
            'error',
            `color.palettes.${name} ranks ${i + 1} (${ramp[i]}) and ${j + 1} (${ramp[j]}) are too similar: normal DeltaE ${normal.toFixed(1)} (floor ${PALETTE_NORMAL_FLOOR}), ${cvd.vision} DeltaE ${cvd.distance.toFixed(1)} (floor ${cvd.floor})`,
            `respace or reorder ranks ${i + 1} and ${j + 1}; every pair within the first ${PALETTE_RANK_COUNT} ranks must clear the normal and per-vision CVD floors`,
          );
        }
      }
    }
  }
  w.push(...colourCheckWarnings(theme, usage));
  // others must read as "less than" any series color
  for (const key of ['others', 'othersMark'] as const) {
    const fill = c[key];
    if (fill !== undefined && uses(usage, key, 'series[0]') && contrastRatio(fill, c.background) > contrastRatio(c.series[0]!, c.background)) {
      push('others-too-strong', 'warn', `color.${key} '${fill}' has normal contrast ${floor2(contrastRatio(fill, c.background))} on background '${c.background}'; it must be at most series[0] '${c.series[0]}' (${floor2(contrastRatio(c.series[0]!, c.background))}) to mean 'rest'`);
    }
  }
  // grid must stay quiet
  if (uses(usage, 'grid') && contrastRatio(c.grid, c.background) > 2.2) {
    push('grid-too-loud', 'warn', `grid '${c.grid}' on background '${c.background}' has normal contrast ${floor2(contrastRatio(c.grid, c.background))} (maximum 2.20); gridlines compete with data ink`);
  }
  // type scale sanity
  const t = theme.type;
  if (t.title.size <= t.label.size) {
    push('type-hierarchy', 'warn', 'title should be clearly larger than data labels');
  }
  if (t.footnote.size > t.label.size) {
    push('type-hierarchy', 'warn', 'footnote should be smaller than data labels');
  }
  // The theme's family is a LAYOUT contract, not just paint: the engine
  // measures every label with a char-class width model calibrated for the
  // Inter/Helvetica metric class (src/core/text.ts). A family whose first
  // entry resolves outside that class renders text the model did not measure
  // — with SF Pro leading the stack, bold subtitles overrun their unit text
  // and footnotes wrap past the frame. Warn, not error: a brand theme may knowingly accept the drift.
  // The check reads only the LEADING family name of each stack — which font a
  // fallback chain actually resolves to is machine-dependent, so a deeper
  // check would claim knowledge the validator cannot have. Documented trade:
  // 'Inter, Roboto, sans-serif' passes and still drifts on a machine without
  // Inter. Role-level family overrides are schema-legal and replace the root
  // family during layout (frame.ts withFamily), so every role stack is
  // checked, not just the root.
  // Families the host passes its own tables for (`measurableFamilies(tables)`) are measured, not estimated.
  const passed = new Set((measuredFamilies ?? []).map((family) => family.trim().toLowerCase()));
  const familyStacks: [string, string | undefined][] = [
    ['type.family', t.family],
    ['type.title.family', t.title?.family],
    ['type.subtitle.family', t.subtitle?.family],
    ['type.label.family', t.label?.family],
    ['type.axis.family', t.axis?.family],
    ['type.footnote.family', t.footnote?.family],
    ['type.micro.family', t.micro?.family],
    ['type.figure.family', t.figure?.family],
  ];
  for (const [path, stack] of familyStacks) {
    if (!stack) continue;
    // Roles inherit the theme stack; only a role that overrides it is checked on its own.
    if (path !== "type.family" && stack === t.family) continue;
    const leading = firstFamilyName(stack);
    if (leading && !CALIBRATED_METRIC_FAMILIES.has(leading.toLowerCase()) && !passed.has(leading.toLowerCase())) {
      push(
        'family-outside-metric-class',
        'warn',
        `${path}: '${leading}' has no calibrated metrics; ${measuredFont(stack, measuredFamilies)}; text may render wider than measured`,
        'Use Inter, Helvetica Neue or Arial, or build width tables for the font with `boardplot fonts build` and pass the measurer (docs/FONTS.md).',
      );
    }
  }
  return w;
}

/** Match the host and bundled tables in the same stack order as the CLI measurer. */
function measuredFont(stack: string, measuredFamilies: readonly string[] | undefined): string {
  for (const family of familiesOf(stack)) {
    const host = measuredFamilies?.find((name) => tableFamilyKey(name) === family);
    const measured = host ?? resolveFace(family, 400)?.family;
    if (measured) return `measured with '${measured}'${!host && measured === 'Helvetica Neue' ? ' (Helvetica tables)' : ''}`;
  }
  return 'measured with a character-class estimate (no tabled family)';
}

/**
 * Families the char-class width model (src/core/text.ts) is calibrated for:
 * Geist, Helvetica, Helvetica Neue and Arial have bundled tables; Inter and the
 * metric clones of Helvetica/Arial use those tables or the class model. First-entry membership is
 * what `family-outside-metric-class` checks. Deliberately NOT including
 * `-apple-system`/`SF Pro` (bold renders ~wider than the
 * model), `Roboto` (its own metric class),
 * or generic keywords (they resolve to anything).
 */
const CALIBRATED_METRIC_FAMILIES: ReadonlySet<string> = new Set([
  // Geist ships its own tables (static 400/500/600); the variable build is
  // the same drawing and measures from them.
  'geist',
  'geist variable',
  'inter',
  'helvetica',
  'helvetica neue',
  'arial',
  'arimo',
  'liberation sans',
  'nimbus sans',
]);

/**
 * First entry of a font-family list, quotes stripped and trimmed. Reads quotes
 * first, so a leading family that carries the list separator keeps its bytes:
 * `"Acme, Display", sans-serif` leads with `Acme, Display`, and splitting on
 * the first comma would report `"Acme`.
 */
function firstFamilyName(family: string): string {
  const text = family.trim();
  const quote = text.startsWith('"') || text.startsWith("'") ? text[0]! : undefined;
  if (quote === undefined) {
    const comma = text.indexOf(',');
    return (comma === -1 ? text : text.slice(0, comma)).trim();
  }
  const close = text.indexOf(quote, 1);
  return (close === -1 ? text.slice(1) : text.slice(1, close)).trim();
}

function rgbDistance(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 0;
  return Math.sqrt((ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2);
}

/** OKLab DeltaE x100 under normal vision or a severity-1 CVD simulation transform. */
export function palettePerceptualDistance(
  a: string,
  b: string,
  vision: PaletteVision = 'normal',
): number {
  const ca = linearRgb(a);
  const cb = linearRgb(b);
  if (!ca || !cb) return 0;
  const la = oklab(vision === 'normal' ? ca : simulateCvd(ca, vision));
  const lb = oklab(vision === 'normal' ? cb : simulateCvd(cb, vision));
  return 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

type LinearRgb = readonly [number, number, number];

function linearRgb(colorValue: string): LinearRgb | null {
  const parsed = parseColor(colorValue);
  if (!parsed) return null;
  const linearize = (channel: number): number => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return [linearize(parsed.r), linearize(parsed.g), linearize(parsed.b)];
}

function simulateCvd(
  rgb: LinearRgb,
  vision: Exclude<PaletteVision, 'normal'>,
): LinearRgb {
  const matrix = MACHADO[vision];
  const channel = (row: readonly number[]): number =>
    Math.max(0, Math.min(1, row[0]! * rgb[0] + row[1]! * rgb[1] + row[2]! * rgb[2]));
  return [channel(matrix[0]!), channel(matrix[1]!), channel(matrix[2]!)];
}

function oklabLc(hex: string): { L: number; C: number; h: number } | null {
  const rgb = linearRgb(hex);
  if (!rgb) return null;
  const [L, A, B] = oklab(rgb);
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}

function oklchHueDistance(a: string, b: string): number | null {
  const first = oklabLc(a);
  const second = oklabLc(b);
  if (!first || !second || first.C < PALETTE_CHROMA_FLOOR || second.C < PALETTE_CHROMA_FLOOR) return null;
  const distance = Math.abs(first.h - second.h);
  return Math.min(distance, 360 - distance);
}

function oklabRoots([r, g, b]: LinearRgb): LinearRgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [l, m, s];
}

function labLightness([l, m, s]: LinearRgb): number {
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** Lightness comparisons do not need chroma and hue calculations. */
export function oklabLightness(hex: string): number | null {
  const rgb = linearRgb(hex);
  return rgb ? labLightness(oklabRoots(rgb)) : null;
}

function oklab(rgb: LinearRgb): LinearRgb {
  const roots = oklabRoots(rgb);
  const [l, m, s] = roots;
  return [
    labLightness(roots),
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
