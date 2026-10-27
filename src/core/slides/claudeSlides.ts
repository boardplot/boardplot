/**
 * Claude Slides export: one laid-out chart as a fragment for a slide of the
 * Claude Slides artifact type. All shapes go in one SVG; every text line
 * becomes one absolutely positioned `<p>` in the deck font, pinned to the
 * slide's `<section>`. The exporter works from the scene graph, never from
 * SVG text, and uses only CSS from the type's closed subset.
 *
 * Scale: the slide canvas is 1920 px wide for 960 pt, so 2 slide px per pt.
 * The chart lays out at the slide target's type sizes in layout px (96 per
 * inch, 4/3 per pt) on the placement divided by 1.5, and the export scales
 * the geometry by 1.5: a 14 pt label is 18.67 layout px and 28 slide px.
 */
import { defaultMeasurer, type TextMeasurer } from '../text';
import { createMetricTablesMeasurer } from '../fontMetrics/injected';
import type { FontMetricFace, FontMetricTables } from '../fontMetrics/tableDocument';
import { bundledStandIn, familiesOf, resolveFace, tableFamilyKey, tabledFamilies } from '../fontMetrics';
import { escapeMarkup, renderSlideShapes, TEXT_ASCENT } from '../svg/renderSvg';
import { resolvePaint } from '../svg/paint';
import { haloPaint } from '../haloPaint';
import { numericVariant, textRole } from '../textRole';
import { sceneThemeBindings } from '../repaintGeometry';
import { emphasisWeight, resolveTheme } from '../theme';
import { gridPanelOptionTargets } from '../doc/chartValidation';
import type { Geometry, SceneNode } from '../types/scene';
import type { Theme, ThemeRef } from '../types/theme';

/** Slide px per layout px: 2 slide px per pt over 4/3 layout px per pt. */
export const SLIDE_SCALE = 1.5;

/** A box on the 1920 × 1080 slide canvas, in slide px. */
export interface SlidePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The default chart box: inside the slide's 128 px side margins, under the
 * slide heading (from y 232) and above the footer band (to y 920).
 */
export const SLIDE_CHART_PLACEMENT: Readonly<SlidePlacement> = Object.freeze({ x: 128, y: 232, width: 1664, height: 688 });

/** Where pinned content ends on a slide with a footer, in slide px. */
const SLIDE_CONTENT_BOTTOM = 920;

/**
 * Boardplot's floor for slide text. The Slides type asks for 24 px or more on
 * all text but does not build-check it; the export warns under it.
 */
export const SLIDE_MIN_TEXT_PX = 24;

/** A slide holds 200 elements; the chart keeps 20 for the heading and footer. */
export const SLIDE_CHART_ELEMENT_BUDGET = 180;

/** The type refuses an SVG over 52 KB; the export keeps a margin. */
export const SLIDE_SVG_BYTE_BUDGET = 48_000;

/** The type's build refuses more than 100 inline marks on a slide. */
const SLIDE_INLINE_MARK_LIMIT = 100;

/** The deck's text face: the family the deck loads and the weights it loads. */
export interface DeckFont {
  family: string;
  /** Weights the deck loads; default 400 and 700. */
  weights?: readonly number[];
}

export interface ClaudeSlidesExport {
  /** One `<svg>` and one `<p>` per text line, all pinned to the `<section>`. */
  html: string;
  /** The chart title, for the slide heading. */
  title: string;
  /** Source and notes, for the slide footer. */
  source: string;
  /** 1 + the number of `<p>`. */
  elements: number;
  svgBytes: number;
  font: { family: string; measured: 'exact' | 'fallback' };
  /**
   * The deck's `project/deck.json` `faces` entry for a Google Fonts family:
   * its key, the family and the plain css2 link for the loaded weights. The
   * metric tables measure the instance this link serves. Absent for a basic face.
   */
  face?: { key: string; family: string; href: string };
  fit: { fits: boolean; needed?: { width: number; height: number } };
  warnings: string[];
}

const DEFAULT_WEIGHTS: readonly number[] = [400, 700];

/** The Slides type's rule for a face's family name. */
const DECK_FAMILY = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;

/** Why a deck font or placement cannot go on a slide, or undefined. */
export function claudeSlidesInputError(font: DeckFont, placement: SlidePlacement = SLIDE_CHART_PLACEMENT): string | undefined {
  if (typeof font.family !== 'string' || !DECK_FAMILY.test(font.family.trim())) {
    return 'the deck font family must start with a letter and hold only letters, digits, spaces, _ and -, at most 40 characters, as the Slides type requires';
  }
  if (font.weights !== undefined && (!Array.isArray(font.weights) || font.weights.some((weight) => !Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0))) {
    return 'deck font weights must be whole hundreds from 100 to 900';
  }
  const sides = [placement.x, placement.y, placement.width, placement.height];
  if (sides.some((value) => typeof value !== 'number' || !Number.isFinite(value)) || placement.width <= 0 || placement.height <= 0) {
    return 'the placement needs a finite x and y and a positive width and height, in slide px';
  }
  return undefined;
}

/** Layout px for a placement. */
export function slideLayoutSize(placement: SlidePlacement): { width: number; height: number } {
  return { width: placement.width / SLIDE_SCALE, height: placement.height / SLIDE_SCALE };
}

/** Basic faces: every computer has them, so the deck needs no `faces` entry. */
const BASIC_FACES = new Set(['arial', 'verdana', 'tahoma', 'trebuchet ms', 'georgia', 'times new roman', 'courier new', 'brush script mt']);

/**
 * Google Fonts families the export hands a `faces` link for, by their css2
 * name: the families the Slides type names (fonts.md) and the tabled ones.
 * Each answered css2 `wght@400;700` with HTTP 200 on 2026-10-25. Another
 * family gets no link: the export cannot know a family is served, and a
 * guessed link fails.
 */
const GOOGLE_FAMILIES: ReadonlyMap<string, string> = new Map([
  'Bitter', 'Caveat', 'Cormorant Garamond', 'Dancing Script', 'DM Sans', 'Domine', 'EB Garamond', 'Fira Code', 'Fredoka',
  'Geist', 'Geist Mono', 'IBM Plex Sans', 'Inter', 'JetBrains Mono', 'Libre Baskerville', 'Lora', 'Montserrat', 'Nunito',
  'Nunito Sans', 'Oswald', 'Playfair Display', 'Public Sans', 'Quicksand', 'Roboto', 'Rubik', 'Source Serif 4',
  'Space Grotesk', 'Syne', 'Work Sans',
].map((name) => [name.toLowerCase(), name]));

/** Other names of a Google family: the variable build of Geist is served as Geist. */
const GOOGLE_ALIASES: ReadonlyMap<string, string> = new Map([['geist variable', 'Geist']]);

/**
 * The deck font under its Google Fonts name, so the labels name the family the
 * link loads ('Geist Variable' → 'Geist'), and whether Google serves it.
 */
export function deckFamily(family: string): { family: string; google: boolean; basic: boolean } {
  const name = family.trim();
  const key = name.toLowerCase();
  const google = GOOGLE_ALIASES.get(key) ?? GOOGLE_FAMILIES.get(key);
  return google ? { family: google, google: true, basic: false } : { family: name, google: false, basic: BASIC_FACES.has(key) };
}

/** The deck.json `faces` entry for a Google Fonts family: the plain css2 link for the loaded weights, no optical-size pin. */
export function deckFace(font: DeckFont): { key: string; family: string; href: string } | undefined {
  const { family, google } = deckFamily(font.family);
  if (!google) return undefined;
  return {
    key: family.toLowerCase().replace(/ /g, '-'),
    family,
    href: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${loadedWeights(font).join(';')}&display=swap`,
  };
}

/** Layout px of 12 pt, the slide floor: 24 slide px. */
const SLIDE_FLOOR_LAYOUT_PX = SLIDE_MIN_TEXT_PX / SLIDE_SCALE;

const quoted = (family: string) => /^[A-Za-z][A-Za-z0-9-]*$/.test(family) ? family : `'${family.replace(/'/g, '')}'`;

/** The deck family first, then the stack it falls back to in the deck: a basic face and the generic. */
export function deckFontStack(family: string): string {
  const name = family.trim();
  const basic = /mono|code|courier/i.test(name) ? 'Courier New, monospace'
    : /serif|garamond|baskerville|times|georgia|domine|lora|playfair|bitter|merriweather/i.test(name) && !/sans/i.test(name)
      ? 'Georgia, serif' : 'Arial, sans-serif';
  return `${quoted(name)}, ${basic}`;
}

/** The text roles a theme sizes; each gets the deck family first. */
const TEXT_ROLES = ['title', 'subtitle', 'label', 'axis', 'footnote', 'micro', 'secondary'] as const;

/**
 * A theme for a slide: the deck family first on the theme and on every text
 * role (a role's own family follows it), footnote and micro type at the 12 pt
 * slide floor, and the emphasis weight resolved to the weight the deck draws.
 * `changes` names each weight the deck cannot draw (role: from → to).
 */
export function deckThemeRef(ref: ThemeRef | undefined, font: DeckFont): { theme: ThemeRef; changes: string[] } {
  const base = resolveTheme(ref);
  const deck = quoted(font.family.trim());
  const floor = SLIDE_FLOOR_LAYOUT_PX;
  const type: Record<string, unknown> = { family: `${deck}, ${base.type.family}` };
  for (const role of TEXT_ROLES) {
    const spec = base.type[role];
    if (!spec && role !== 'micro') continue;
    type[role] = {
      family: `${deck}, ${spec?.family ?? base.type.family}`,
      ...(role === 'footnote' || role === 'micro' ? { size: floor } : {}),
    };
  }
  type.scale = { S: { footnote: floor, micro: floor }, L: { footnote: floor, micro: floor } };
  type.figure = { family: `${deck}, ${base.type.figure?.family ?? base.type.family}` };
  const changes: string[] = [];
  const emphasis = emphasisWeight(base);
  const drawn = deckWeight(loadedWeights(font), emphasis);
  if (drawn !== emphasis) {
    type.emphasis = { weight: drawn };
    changes.push(`emphasis ${emphasis} → ${drawn}`);
  }
  const overrides: Record<string, unknown> = { type };
  // Overrides travel as JSON, which the theme resolution validates.
  const theme = (typeof ref === 'object' && ref !== null
    ? { preset: ref.preset, overrides: mergeDeep(ref.overrides as Record<string, unknown> ?? {}, overrides) }
    : { preset: typeof ref === 'string' ? ref : 'boardroom', overrides }) as ThemeRef;
  return { theme, changes };
}

/**
 * A chart's options for a slide export, and the text the slide carries
 * outside the chart. The chart lays out at the slide target on the placement
 * in layout px, with the deck theme of `deckThemeRef`. The title goes to the
 * slide heading and the source and authored footnotes to the slide footer,
 * so the chart draws neither: footer type (8.25 to 11 pt) is under 24 px.
 * A grid's panel themes get the deck theme too (`data`).
 */
export function claudeSlidesOptions(
  options: Record<string, unknown> | undefined,
  context: { placement?: SlidePlacement; font: DeckFont; theme?: ThemeRef; type?: string; data?: unknown },
): { options: Record<string, unknown>; data?: unknown; title?: string; source?: string; changes: string[] } {
  const placement = context.placement ?? SLIDE_CHART_PLACEMENT;
  const invalid = claudeSlidesInputError(context.font, placement);
  if (invalid) throw new Error(invalid);
  context = { ...context, font: { ...context.font, family: deckFamily(context.font.family).family } };
  const authored = { ...(options ?? {}) };
  const ref = (authored.theme as ThemeRef | undefined) ?? context.theme;
  const { theme, changes } = deckThemeRef(ref, context.font);
  const title = typeof authored.title === 'string' ? authored.title : undefined;
  const footnotes = Array.isArray(authored.footnotes) ? authored.footnotes.filter((note): note is string => typeof note === 'string') : [];
  const source = [typeof authored.source === 'string' ? authored.source : '', ...footnotes].filter(Boolean).join(' · ');
  const { source: _source, ...rest } = authored;
  const notes = typeof authored.notes === 'object' && authored.notes !== null ? authored.notes : {};
  let data = context.data;
  if (context.type !== undefined && data !== undefined) {
    // A panel's own theme replaces the chart's, so it takes the deck theme as well.
    const panels = gridPanelOptionTargets(context.type, data, '');
    if (panels.some((panel) => panel.options.theme !== undefined)) {
      data = structuredClone(data);
      for (const panel of gridPanelOptionTargets(context.type, data, '')) {
        if (panel.options.theme === undefined) continue;
        const own = deckThemeRef(panel.options.theme as ThemeRef, context.font);
        panel.options.theme = own.theme;
        for (const change of own.changes) if (!changes.includes(change)) changes.push(change);
      }
    }
  }
  return {
    options: {
      ...rest,
      target: 'slide',
      size: slideLayoutSize(placement),
      theme,
      title: false,
      footnotes: false,
      notes: { ...notes, pointer: false },
    },
    ...(data !== context.data ? { data } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(source ? { source } : {}),
    changes,
  };
}

function mergeDeep(into: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...into };
  for (const [key, value] of Object.entries(from)) {
    const existing = out[key];
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && existing && typeof existing === 'object' && !Array.isArray(existing)
      ? mergeDeep(existing as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return out;
}

export interface ClaudeSlidesInput {
  /** The chart laid out with `claudeSlidesOptions`: target slide, on the placement in layout px. */
  geometry: Geometry;
  /** The theme the chart drew with; it supplies the literal colours. */
  theme: Theme;
  font: DeckFont;
  placement?: SlidePlacement;
  /** The tables the layout measured with (`--font-tables`); absent, the bundled tables. */
  tables?: FontMetricTables;
  /** The measurer the layout used, when it is not `deckMeasurer` over these tables. */
  measure?: TextMeasurer;
  /** The text `claudeSlidesOptions` took out of the chart. */
  title?: string;
  source?: string;
  /** The weight changes `claudeSlidesOptions` made before layout (role: from → to). */
  changes?: readonly string[];
  /** Draw the theme canvas (default) or leave it out. */
  background?: boolean;
  /** Suffix for the hatch pattern ids, unique per chart on the page. */
  idScope?: string;
}

type TextNode = Extract<SceneNode, { t: 'text' }>;

/** Vertical metrics in em. */
interface VerticalMetrics { ascent: number; descent: number; lineGap: number }

/** The vertical metrics of the face the deck family is measured with: its own table, else the first tabled family of the stack. */
function deckMetrics(font: DeckFont, stack: string, tables?: FontMetricTables): { metrics: VerticalMetrics; measuredAs: string } {
  const key = tableFamilyKey(font.family);
  const own = tables?.faces.filter((face) => face.style === 'normal' && tableFamilyKey(face.family) === key) ?? [];
  if (own.length) {
    const face = own.reduce((best: FontMetricFace, face) => Math.abs(face.weight - 400) < Math.abs(best.weight - 400) ? face : best, own[0]!);
    return { metrics: em(face), measuredAs: face.family };
  }
  const bundled = new Set(tabledFamilies().map(tableFamilyKey));
  const fileFamilies = new Set((tables?.faces ?? []).filter((face) => face.style === 'normal').map((face) => tableFamilyKey(face.family)));
  for (const family of [key, ...familiesOf(stack)]) {
    if (fileFamilies.has(family)) {
      const faces = tables!.faces.filter((face) => face.style === 'normal' && tableFamilyKey(face.family) === family);
      return { metrics: em(faces[0]!), measuredAs: faces[0]!.family };
    }
    if (bundled.has(family)) {
      const face = resolveFace(family, 400)!;
      return { metrics: em(face), measuredAs: face.family };
    }
  }
  const face = resolveFace(undefined, 400)!;
  return { metrics: em(face), measuredAs: face.family };
}

/**
 * Whether the faces the labels draw with were measured from their own
 * table: the deck family first in the stack, a table of that family (the
 * file's, else the bundle's, never a stand-in's rows), and a face at each
 * drawn weight. Otherwise 'fallback', with the reasons.
 */
function measuredStatus(font: DeckFont, tables: FontMetricTables | undefined, uses: ReadonlyMap<string, ReadonlySet<number>>): { measured: 'exact' | 'fallback'; reasons: string[] } {
  const key = tableFamilyKey(font.family);
  const reasons = new Set<string>();
  const own = tables?.faces.filter((face) => face.style === 'normal' && tableFamilyKey(face.family) === key) ?? [];
  const bundled = new Set(tabledFamilies().map(tableFamilyKey)).has(key);
  const standIn = bundledStandIn(font.family);
  for (const [stack, weights] of uses) {
    if (familiesOf(stack)[0] !== key) { reasons.add(`text laid out in '${stack}'`); continue; }
    for (const weight of weights) {
      if (own.length) {
        if (!own.some((face) => face.weight === weight)) reasons.add(`the tables have no ${weight} face`);
      } else if (bundled) {
        if (standIn) reasons.add(`the bundled ${standIn} rows stand in for it`);
        else if (resolveFace(font.family, weight)?.weight !== weight) reasons.add(`the bundled table has no ${weight} face`);
      } else {
        reasons.add('no table holds it');
      }
    }
  }
  return { measured: reasons.size ? 'fallback' : 'exact', reasons: [...reasons] };
}

const em = (face: { ascent: number; descent: number; lineGap: number }): VerticalMetrics =>
  ({ ascent: face.ascent / 1000, descent: Math.abs(face.descent) / 1000, lineGap: face.lineGap / 1000 });

const px = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
};

function nearestWeight(weights: readonly number[], weight: number): number {
  let best = weights[0] ?? 400;
  for (const candidate of weights) {
    const d = Math.abs(candidate - weight);
    const bestD = Math.abs(best - weight);
    if (d < bestD || (d === bestD && candidate > best)) best = candidate;
  }
  return best;
}

/** The weights the deck loads, ascending; default 400 and 700. */
function loadedWeights(font: DeckFont): number[] {
  // Unique: css2 refuses a repeated weight (wght@400;400;700 answers HTTP 400).
  return font.weights?.length ? [...new Set(font.weights)].sort((a, b) => a - b) : [...DEFAULT_WEIGHTS];
}

/**
 * The weight a text weight draws at in the deck. A slide span knows only
 * bold, so every weight of 600 or more draws as the deck's bold: the face CSS
 * picks for `<b>` (700), the lightest loaded weight from 700 up, else the
 * heaviest loaded weight from 600 up. A deck that loads no weight from 600 up
 * has no bold, and bold text draws at its regular weight (the loaded weight
 * nearest 400). A lighter weight draws at the nearest loaded weight under 600.
 */
export function deckWeight(weights: readonly number[] = DEFAULT_WEIGHTS, weight: number): number {
  const loaded = weights.length ? weights : DEFAULT_WEIGHTS;
  const light = loaded.filter((candidate) => candidate < 600);
  const regular = (target: number) => nearestWeight(light.length ? light : loaded, target);
  if (weight >= 600) {
    const bold = loaded.filter((candidate) => candidate >= 600);
    if (!bold.length) return regular(400);
    const up = bold.filter((candidate) => candidate >= 700);
    return up.length ? Math.min(...up) : Math.max(...bold);
  }
  return regular(weight);
}

/**
 * A measurer that measures every text at the weight it draws at in the deck
 * (`deckWeight`). The chart lays out with it, so the measured widths are those
 * of the faces the slide shows.
 */
export function deckMeasurer(measure: TextMeasurer, font: DeckFont): TextMeasurer {
  const weights = font.weights?.length ? font.weights : DEFAULT_WEIGHTS;
  const wrapped: TextMeasurer = (text, spec) => measure(text, { ...spec, weight: deckWeight(weights, spec.weight) });
  if (measure.capHeight) wrapped.capHeight = (spec) => measure.capHeight!({ ...spec, weight: deckWeight(weights, spec.weight) });
  return wrapped;
}

/** Eight halo offsets: the SVG halo strokes 2.5 layout px, 1.25 to each side. */
function haloShadow(color: string): string {
  const r = 1.25 * SLIDE_SCALE;
  const d = r * Math.SQRT1_2;
  const offsets: [number, number][] = [[r, 0], [-r, 0], [0, r], [0, -r], [d, d], [d, -d], [-d, d], [-d, -d]];
  return offsets.map(([x, y]) => `${x === 0 ? '0' : px(x)} ${y === 0 ? '0' : px(y)} ${color}`).join(', ');
}

/** The ids of the frame text the slide carries in its heading and footer. */
function frameTextIds(geometry: Geometry): { title: Set<string>; footer: Set<string> } {
  const frame = geometry.frame;
  const title = new Set([frame.titleNodeId].filter((id): id is string => id !== undefined));
  const footer = new Set([frame.sourceNodeId, frame.creditNodeId, ...(frame.footnoteNodeIds ?? [])].filter((id): id is string => id !== undefined));
  return { title, footer };
}

/**
 * Export one chart laid out for a slide. Above the element or SVG budget the
 * fragment is still complete and a warning names the choices: split the
 * chart, use a Slides table for a table, or upload a PNG. No label is ever
 * dropped in silence, and every emitted value stays inside the Slides subset:
 * a value outside its range is clamped with a warning.
 */
export function exportClaudeSlides(input: ClaudeSlidesInput): ClaudeSlidesExport {
  const { geometry, theme } = input;
  const placement = input.placement ?? SLIDE_CHART_PLACEMENT;
  const invalid = claudeSlidesInputError(input.font, placement);
  if (invalid) throw new Error(invalid);
  const asked = input.font.family.trim();
  const named = deckFamily(asked);
  input = { ...input, font: { ...input.font, family: named.family } };
  const weights = loadedWeights(input.font);
  const warnings: string[] = [];
  if (named.family !== asked) warnings.push(`Google Fonts serves '${asked}' as '${named.family}', so the labels and the face entry name '${named.family}'.`);
  if (!named.google && !named.basic) {
    warnings.push(`'${named.family}' is not a Google Fonts family the export knows, so the result has no face entry. Give the deck its own faces entry for '${named.family}' (an uploaded font file, or its css2 link if Google Fonts serves it); without one the labels draw in the fallback font and do not match their measured widths.`);
  }
  const measure = input.measure ?? deckMeasurer(input.tables ? createMetricTablesMeasurer(input.tables, { bundledFallback: true }) : defaultMeasurer, input.font);
  const stack = deckFontStack(input.font.family);
  const firstText = geometry.scene.find((node): node is TextNode => node.t === 'text');
  const layoutStack = firstText?.font.family ?? theme.type.family;
  const { metrics, measuredAs } = deckMetrics(input.font, layoutStack, input.tables);
  if (tableFamilyKey(familiesOf(layoutStack)[0] ?? '') !== tableFamilyKey(input.font.family)) {
    warnings.push(`The chart was laid out with '${layoutStack}', not with '${input.font.family}' first; lay it out with claudeSlidesOptions.`);
  }

  const bindings = sceneThemeBindings(geometry).map((binding) => ({ prefix: binding.prefix, theme: resolveTheme(binding.theme) }));
  const themeFor = (node: SceneNode) => {
    let found = theme;
    for (const binding of bindings) if (node.id.startsWith(binding.prefix)) found = binding.theme;
    return found;
  };

  const frameIds = frameTextIds(geometry);
  const titleParts: string[] = [];
  const footerParts: string[] = [];
  const labels: TextNode[] = [];
  let images = 0;
  for (const node of geometry.scene) {
    if (node.t === 'image') images++;
    if (node.t !== 'text') continue;
    if (frameIds.title.has(node.id)) titleParts.push(node.lines.join(' '));
    else if (frameIds.footer.has(node.id) || node.part === 'source' || node.part === 'credit') footerParts.push(node.lines.join(' '));
    else labels.push(node);
  }
  // The faces the labels draw with, by stack and weight, decide whether the widths are exact.
  const uses = new Map<string, Set<number>>();
  for (const node of labels) {
    const family = node.font.family ?? theme.type.family;
    const set = uses.get(family) ?? new Set<number>();
    for (const line of drawnRuns(node, weights)) for (const run of line) set.add(run.weight);
    uses.set(family, set);
  }
  const { measured, reasons } = measuredStatus(input.font, input.tables, uses);
  if (measured === 'fallback') {
    warnings.push(`'${input.font.family}' was not measured from its own faces (${reasons.join('; ')}): the labels were measured with ${measuredAs} and keep a width margin. Build tables from the font files the deck loads with 'boardplot fonts build' and pass them with --font-tables.`);
  }

  const paragraphs: string[] = [];
  const substituted = new Set<string>(input.changes ?? []);
  const clamped = new Set<string>();
  let marks = 0;
  let small = 0;
  for (const node of labels) {
    const placed = textParagraphs(node, themeFor(node), {
      placement, stack, weights, measure, metrics, margin: measured === 'exact' ? 0.01 : 0.04,
    });
    paragraphs.push(...placed.html);
    for (const change of placed.substituted) substituted.add(change);
    for (const change of placed.clamped) clamped.add(change);
    marks += placed.marks;
    if (placed.size < SLIDE_MIN_TEXT_PX - 0.005) small += placed.html.length;
  }

  const title = input.title ?? (titleParts.join(' ') || geometry.a11y.title);
  const svg = renderSlideShapes(geometry, theme, {
    scale: SLIDE_SCALE,
    ariaLabel: `${title} (${geometry.type} chart)`,
    style: `position:absolute;left:${px(placement.x)};top:${px(placement.y)};width:${px(geometry.size.width * SLIDE_SCALE)};height:${px(geometry.size.height * SLIDE_SCALE)}`,
    ...(input.background === false ? { background: false } : {}),
    ...(input.idScope ? { idScope: input.idScope } : {}),
  });
  const svgBytes = new TextEncoder().encode(svg).length;
  const elements = 1 + paragraphs.length;

  const choices = 'split the chart, use a Slides table for a table, or upload the chart as a PNG';
  if (elements > SLIDE_CHART_ELEMENT_BUDGET) {
    warnings.push(`The chart needs ${elements} elements (1 SVG and ${paragraphs.length} text lines); a slide holds 200 and the chart keeps ${SLIDE_CHART_ELEMENT_BUDGET} of them. Every label is in the fragment; ${choices}.`);
  }
  if (svgBytes > SLIDE_SVG_BYTE_BUDGET) {
    warnings.push(`The SVG has ${svgBytes} bytes, over the ${SLIDE_SVG_BYTE_BUDGET}-byte budget (the type refuses more than 52 KB); ${choices}.`);
  }
  if (marks > SLIDE_INLINE_MARK_LIMIT) warnings.push(`The labels carry ${marks} bold runs; the type refuses more than ${SLIDE_INLINE_MARK_LIMIT} inline marks on a slide; ${choices}.`);
  if (small) warnings.push(`${small} text lines are under ${SLIDE_MIN_TEXT_PX} px, Boardplot's floor for slide text (the Slides type asks for 24 px but does not check it); raise textScale or give the chart a larger placement.`);
  if (substituted.size) warnings.push(`The deck loads weights ${weights.join(', ')}, so these text weights were measured and drawn at a weight the deck draws (role: from → to): ${[...substituted].join('; ')}.`);
  if (clamped.size) warnings.push(`These values were outside the Slides subset and were clamped to its range: ${[...clamped].join('; ')}.`);
  if (images) warnings.push(`${images} embedded images are not in the fragment: a slide SVG holds no URLs. Upload the chart as a PNG to keep them.`);
  const right = placement.x + placement.width;
  const bottom = placement.y + placement.height;
  if (placement.x < 0 || placement.y < 0 || right > 1920 || bottom > 1080) {
    warnings.push(`The placement ${placement.x},${placement.y},${placement.width},${placement.height} leaves the 1920 × 1080 slide; the type clamps it.`);
  } else if (placement.x < 128 || placement.y < 128 || right > 1792 || bottom > SLIDE_CONTENT_BOTTOM) {
    warnings.push(`The placement leaves the slide's content area: 128 px margins, and the footer band from y ${SLIDE_CONTENT_BOTTOM} (default placement ${SLIDE_CHART_PLACEMENT.x},${SLIDE_CHART_PLACEMENT.y},${SLIDE_CHART_PLACEMENT.width},${SLIDE_CHART_PLACEMENT.height}).`);
  }

  const width = geometry.size.width * SLIDE_SCALE;
  const height = geometry.size.height * SLIDE_SCALE;
  const fits = width <= placement.width + 0.5 && height <= placement.height + 0.5;
  const face = deckFace(input.font);
  return {
    html: [svg, ...paragraphs].join('\n'),
    title,
    source: [input.source ?? '', ...footerParts].filter(Boolean).join(' · '),
    elements,
    svgBytes,
    font: { family: input.font.family, measured },
    ...(face ? { face } : {}),
    fit: fits ? { fits } : { fits, needed: { width: Math.ceil(width), height: Math.ceil(height) } },
    warnings,
  };
}

interface ParagraphContext {
  placement: SlidePlacement;
  stack: string;
  weights: readonly number[];
  measure: TextMeasurer;
  metrics: VerticalMetrics;
  /** Width margin as a share of the measured advance, on the side the text grows to. */
  margin: number;
}

/**
 * The weight each run of a text node draws at. A `<p>` takes one weight and
 * a span knows only bold, so a run draws at the paragraph's weight (the
 * lightest the runs resolve to) or, in a paragraph under 600, as `<b>` at the
 * deck bold. A run that resolves to neither draws at the paragraph weight.
 */
function drawnRuns(node: TextNode, weights: readonly number[]): { text: string; from: number; weight: number; bold: boolean }[][] {
  const base = node.font.weight;
  if (!node.runs) {
    const weight = deckWeight(weights, base);
    return node.lines.map((line) => [{ text: line, from: base, weight, bold: false }]);
  }
  const resolved = node.runs.map((run) => ({ text: run.text, from: run.weight ?? base, to: deckWeight(weights, run.weight ?? base) }));
  const paragraph = Math.min(...resolved.map((run) => run.to));
  return [resolved.map((run) => run.to !== paragraph && run.to >= 600 && paragraph < 600
    ? { text: run.text, from: run.from, weight: run.to, bold: true }
    : { text: run.text, from: run.from, weight: paragraph, bold: false })];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * One `<p>` per line of a text node, mapped from the SVG writer's text rule
 * (renderSvg, text case): `node.y` is the top of the line box and the
 * baseline sits at `node.y + s × TEXT_ASCENT`. CSS puts the baseline of a
 * line box of height L at `(L − (A + D)) / 2 + A` from its top, with A and
 * D the deck face's ascent and descent at the font size (the tables' 1/1000
 * em, descent negative there), so the box top follows. The line height is set
 * explicitly, so the face's lineGap does not enter (CSS 2.1, 10.8.1).
 * A rotated label turns about its anchor on the baseline in SVG and about the
 * box centre in CSS: the box centre is turned about the anchor and the box
 * placed there. Each label sets the text properties a deck could otherwise
 * pass down (font style, letter spacing, text transform).
 */
function textParagraphs(node: TextNode, theme: Theme, context: ParagraphContext): { html: string[]; marks: number; size: number; substituted: string[]; clamped: string[] } {
  const { placement, metrics } = context;
  const font = node.font;
  const role = textRole(node);
  const clamped = new Set<string>();
  // Layout px: s the size, Lpx the line pitch the engine set.
  const s = font.size;
  const Lpx = s * (font.lineHeight ?? 1.2);
  const baseline = node.y + s * TEXT_ASCENT;
  const ls = font.letterSpacing ?? 0;
  const lsShift = ls ? (node.align === 'end' ? ls : node.align === 'middle' ? ls / 2 : 0) : 0;
  // Then, once, the placement offset and the 1.5 scale.
  const slideX = (x: number) => placement.x + ((node.tx ?? 0) + x) * SLIDE_SCALE;
  const slideY = (y: number) => placement.y + ((node.ty ?? 0) + y) * SLIDE_SCALE;
  // Slide px, inside the subset's ranges: font-size 8–400, line-height 0.5–4 × the size, letter-spacing −24–32, opacity 0–1.
  const engineSize = s * SLIDE_SCALE;
  const size = clamp(engineSize, 8, 400);
  if (size !== engineSize) clamped.add(`${role} font-size ${px(engineSize)} → ${px(size)}`);
  const sizeRatio = size / engineSize;
  const lineRatio = clamp(font.lineHeight ?? 1.2, 0.5, 4);
  if (lineRatio !== (font.lineHeight ?? 1.2)) clamped.add(`${role} line-height ${font.lineHeight}× → ${lineRatio}×`);
  const lineBox = size * lineRatio;
  const A = size * metrics.ascent;
  const D = size * metrics.descent;
  const engineLs = ls * SLIDE_SCALE;
  const letterSpacing = clamp(engineLs, -24, 32);
  if (letterSpacing !== engineLs) clamped.add(`${role} letter-spacing ${px(engineLs)} → ${px(letterSpacing)}`);
  const opacity = node.opacity === undefined ? undefined : clamp(node.opacity, 0, 1);
  if (opacity !== node.opacity) clamped.add(`${role} opacity ${node.opacity} → ${opacity}`);
  const anchorX = slideX(node.x + lsShift);
  const anchorY = slideY(baseline);
  const angle = node.rotate ?? 0;
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const ink = resolvePaint(node.ink, theme);
  const lines = drawnRuns(node, context.weights);
  const substituted = new Set<string>();
  for (const run of lines.flat()) if (run.weight !== run.from) substituted.add(`${role} ${run.from} → ${run.weight}`);
  const weight = lines[0]!.find((run) => !run.bold)?.weight ?? lines[0]![0]!.weight;
  // Figures: the label draws tabular digits when its role does, and is measured with them.
  const tabular = numericVariant(role, theme) === 'tabular-nums' || font.tabular === true;
  const style = [
    `font-family:${context.stack}`,
    `font-size:${px(size)}`,
    `font-weight:${weight}`,
    `font-style:${font.style === 'italic' ? 'italic' : 'normal'}`,
    `line-height:${px(lineBox)}`,
    `color:${ink}`,
    `text-align:${node.align === 'start' ? 'left' : node.align === 'end' ? 'right' : 'center'}`,
    'white-space:nowrap',
    `letter-spacing:${letterSpacing ? px(letterSpacing) : 'normal'}`,
    'text-transform:none',
    ...(tabular ? ['font-variant-numeric:tabular-nums'] : []),
    ...(node.halo ? [`text-shadow:${haloShadow(resolvePaint(haloPaint(node.ink, theme), theme))}`] : []),
    ...(opacity !== undefined ? [`opacity:${opacity}`] : []),
    ...(angle ? [`transform:rotate(${Math.round(angle * 100) / 100}deg)`] : []),
  ].join(';');

  const html: string[] = [];
  let marks = 0;
  lines.forEach((line, index) => {
    // Measured at the weight each run draws at, with the figures it draws with.
    const measuredWidth = line.reduce((sum, run) => sum + context.measure(run.text, { ...font, weight: run.weight, ...(tabular ? { tabular: true } : {}) }).width, 0)
      + (line.length > 1 ? ls * (line.length - 1) : 0);
    const advance = (measuredWidth * SLIDE_SCALE) * sizeRatio + letterSpacing;
    const pad = Math.max(1, advance * context.margin);
    const width = advance + (node.align === 'middle' ? 2 * pad : pad);
    const left = node.align === 'start' ? anchorX : node.align === 'end' ? anchorX - width : anchorX - width / 2;
    const top = slideY(baseline + index * Lpx) - ((lineBox - (A + D)) / 2 + A);
    let x = left;
    let y = top;
    if (angle) {
      const cx = left + width / 2 - anchorX;
      const cy = top + lineBox / 2 - anchorY;
      x = anchorX + cx * cos - cy * sin - width / 2;
      y = anchorY + cx * sin + cy * cos - lineBox / 2;
    }
    const body = line.map((run) => {
      // A no-break space as its numeric entity: a model that copies the fragment keeps it.
      const text = escapeMarkup(run.text, 'text').replace(/ /g, '&#160;');
      if (run.bold) { marks++; return `<b>${text}</b>`; }
      return text;
    }).join('');
    html.push(`<p style="position:absolute;left:${px(x)};top:${px(y)};width:${px(width)};height:${px(lineBox)};${style}">${body}</p>`);
  });
  return { html, marks, size, substituted: [...substituted], clamped: [...clamped] };
}
