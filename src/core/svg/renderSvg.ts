import { assertEmbeddedImage } from '../image';
import { ENGINE_REV } from '../engine';
/**
 * Framework-free SVG serializer. React and the CLI are both
 * folds over the same scene; this is the canonical text fold. Deterministic:
 * same geometry + theme ⇒ identical bytes.
 */

import type { Geometry, HatchLook, Paint, SceneNode } from '../types/scene';
import type { Theme } from '../types/theme';
import { hatchPatternId, hatchTile, isHatchPattern, POINTER_TRANSPARENT_PARTS } from '../svgPath';
import { strokeToken, hatchGapFactor, hatchPaint, hatchStrokeWidthFor, PLAN_MUTED_PAINT, resolveTheme, solidMutedPlan } from '../theme';
import { sceneThemeBindings } from '../repaintGeometry';
import { haloPaint } from '../haloPaint';
import { numericVariant, textRole } from '../textRole';
import { assertPaintToken, checkedColor, resolvePaint, validateTint } from './paint';


export interface RenderSvgOptions {
  /** Draw the theme canvas (default) or leave the outer canvas transparent (`false`). */
  background?: boolean;
  /** Emit progressive-enhancement metadata without changing chart geometry. */
  interactive?: boolean;
  /** Claim records for this chart; only records with matching nodeIds are marked. */
  claims?: readonly { id: string; nodeId?: string }[];
  /**
   * Suffix that makes every `id` this SVG emits unique inside a HOST document.
   *
   * The ids in the output are the description (`bp-desc`), the optional title
   * and the hatch pattern defs. The patterns are content-addressed so identical
   * patterns dedupe *within* one chart, which is exactly what makes them
   * collide *across* charts: two exhibits with the same forecast hatch emit the
   * same `id="bp-hatch-…"`, and a host page that inlines both holds ONE
   * document. Duplicate ids are invalid HTML and make `url(#…)` ambiguous; a
   * chart hidden in a closed `<details>` then takes the visible chart's hatch
   * with it.
   *
   * Every exporter passes one: the CLI and MCP render the spec's source hash,
   * the React export the same hash of its request. A caller that inlines
   * charts it serializes itself MUST pass a scope unique per placement.
   */
  idScope?: string;
}

/** Scopes are pasted into an id and into `url(#…)`; keep them boring and loud. */
const ID_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * XML 1.0 §2.2 Char is the whole grammar of what a document may contain:
 *   #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
 * Everything outside it — U+0000..U+0008, U+000B, U+000C, U+000E..U+001F,
 * U+FFFE, U+FFFF, and any unpaired UTF-16 surrogate — has NO representation
 * in XML 1.0. A numeric character reference does not help: `&#0;` is itself
 * ill-formed (§4.1 requires the referenced character to match Char), so there
 * is no escaping our way out. The only honest options are to drop the
 * characters (silent content loss) or to refuse the document. We
 * refuse: this serializer already fails closed on an invalid color, paint
 * token or coordinate, and a chart whose category label is not expressible is
 * exactly as unrenderable as one whose fill is not a color.
 *
 * Returns the index and UTF-16 code unit of the first offending unit.
 */
function xmlCharFault(value: string): { index: number; unit: number } | undefined {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0x20 && unit <= 0xd7ff) continue;
    if (unit === 0x09 || unit === 0x0a || unit === 0x0d) continue;
    if (unit >= 0xe000 && unit <= 0xfffd) continue;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      // High surrogate: legal only as the first half of a pair. Reading past
      // the end yields NaN, which fails the range test — a trailing high
      // surrogate is a fault, as it must be.
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        i += 1;
        continue;
      }
    }
    return { index: i, unit };
  }
  return undefined;
}

const codePointName = (unit: number) => `U+${unit.toString(16).toUpperCase().padStart(4, '0')}`;

/** Render a string for an error message with every non-printable unit escaped,
 *  so the message can be logged, diffed and pasted without carrying the fault. */
function printable(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    out +=
      unit >= 0x20 && unit <= 0x7e
        ? value[i]
        : `\\u${unit.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

/** Distinguishable so callers can add the node context they own without
 *  re-wording the serializer's other fail-closed errors. */
export class XmlCharError extends Error {}

function assertXmlText(value: string, channel: string): string {
  const fault = xmlCharFault(value);
  if (!fault) return value;
  const kind =
    fault.unit >= 0xd800 && fault.unit <= 0xdfff
      ? 'unpaired surrogate'
      : fault.unit === 0xfffe || fault.unit === 0xffff
        ? 'non-character'
        : 'control character';
  throw new XmlCharError(
    `invalid XML character ${codePointName(fault.unit)} (${kind}) at index ${fault.index} ` +
      `of ${channel} '${printable(value)}': XML 1.0 cannot represent it, ` +
      `not even as a character reference — remove it from the source string`,
  );
}

/**
 * Every user-facing string crosses into the document through here, so the
 * well-formedness check lives here too: no channel can be added without it.
 *
 * TAB/LF/CR are legal Char but are collapsed to spaces by attribute-value
 * normalization (§3.3.3). Since one `esc` serves both attributes and text
 * content, they are emitted as character references: identical meaning in
 * content, and the only way an attribute keeps them.
 */
const ESCAPABLE = /[&<>"\t\n\r]/;
const esc = (s: string, channel = 'text') => {
  // Most channels (numbers, ids, colors) carry none of the seven escapable
  // characters; one combined test skips the replace chain for them. The
  // fault scan still runs on every path, so refusals are unchanged.
  if (!ESCAPABLE.test(s)) return assertXmlText(s, channel);
  return assertXmlText(s, channel)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
};

function colorAttr(value: string): string {
  const color = checkedColor(value);
  return esc(color);
}

function validateNumber(
  label: string,
  value: number | undefined,
  minimum?: number,
): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || (minimum !== undefined && value < minimum))
  ) {
    throw new Error(`invalid SVG numeric ${label} '${String(value)}'`);
  }
}

const VALID_LINE_CAPS = new Set(['butt', 'round', 'square']);

function validateLineCap(label: string, value: string | undefined): void {
  if (value !== undefined && !VALID_LINE_CAPS.has(value)) {
    throw new Error(`invalid SVG lineCap ${label} '${value}'`);
  }
}

/**
 * Every other coordinate a node carries is a `number` and goes through
 * validateNumber. A path's coordinates are already serialized into one opaque
 * string, so nothing looked at them — pie wrote
 * `d="MNaN NaNLNaN NaNANaN NaN 0 1 1 NaN NaNZ"` into a file the CLI then
 * reported as ok. This applies the same numeric check to the one attribute that
 * escaped it.
 *
 * 'NaN', 'Infinity' and '-Infinity' are the ONLY strings JavaScript produces
 * for a non-finite number, so matching them exactly (case-sensitively)
 * covers the class without touching anything else in `d`. Deliberately narrow:
 * hostile or malformed path text is an ESCAPING question and belongs to the
 * escaping boundary, which is asserted separately and must keep escaping rather
 * than throw.
 */
const NON_FINITE_IN_PATH = /NaN|Infinity/;

function validatePathData(label: string, d: string): void {
  const nonFinite = NON_FINITE_IN_PATH.exec(d);
  if (!nonFinite) return;
  throw new Error(
    `invalid SVG path ${label}: non-finite coordinate '${nonFinite[0]}' in '${d.slice(0, 60)}'`,
  );
}

function validateRectNumbers(
  label: string,
  rect: { x: number; y: number; w: number; h: number },
): void {
  validateNumber(`${label}.x`, rect.x);
  validateNumber(`${label}.y`, rect.y);
  validateNumber(`${label}.w`, rect.w, 0);
  validateNumber(`${label}.h`, rect.h, 0);
}

function validateGeometryNumbers(geometry: Geometry): void {
  validateNumber('size.width', geometry.size.width, 0);
  validateNumber('size.height', geometry.size.height, 0);
  for (const node of geometry.scene) {
    validateNumber(`${node.id}.tx`, node.tx);
    if (node.opacity !== undefined && (typeof node.opacity !== 'number' || !(node.opacity >= 0 && node.opacity <= 1))) throw new Error(`invalid geometry opacity ${node.id}`);
    validateNumber(`${node.id}.ty`, node.ty);
    if (node.t === 'rect') {
      validateRectNumbers(`${node.id}.rect`, node.rect);
      validateNumber(`${node.id}.strokeWidth`, node.strokeWidth, 0);
      validateNumber(`${node.id}.radius`, node.radius, 0);
    } else if (node.t === 'image') {
      validateRectNumbers(`${node.id}.rect`, node.rect);
      assertEmbeddedImage(node.src);
    } else if (node.t === 'line') {
      validateNumber(`${node.id}.x1`, node.x1);
      validateNumber(`${node.id}.y1`, node.y1);
      validateNumber(`${node.id}.x2`, node.x2);
      validateNumber(`${node.id}.y2`, node.y2);
      validateNumber(`${node.id}.width`, node.width, 0);
      node.dash?.forEach((value, index) =>
        validateNumber(`${node.id}.dash[${index}]`, value, 0),
      );
      validateLineCap(`${node.id}.lineCap`, node.lineCap);
    } else if (node.t === 'path') {
      validatePathData(`${node.id}.d`, node.d);
      validateNumber(`${node.id}.width`, node.width, 0);
      node.dash?.forEach((value, index) =>
        validateNumber(`${node.id}.dash[${index}]`, value, 0),
      );
      validateLineCap(`${node.id}.lineCap`, node.lineCap);
    } else if (node.t === 'circle') {
      validateNumber(`${node.id}.cx`, node.cx);
      validateNumber(`${node.id}.cy`, node.cy);
      validateNumber(`${node.id}.r`, node.r, 0);
    } else {
      validateNumber(`${node.id}.x`, node.x);
      validateNumber(`${node.id}.y`, node.y);
      validateNumber(`${node.id}.font.size`, node.font.size, 0);
      validateNumber(`${node.id}.font.weight`, node.font.weight, 0);
      if (node.font.style !== undefined && node.font.style !== 'normal' && node.font.style !== 'italic') throw new Error(`invalid SVG font style ${node.id}`);
      validateNumber(`${node.id}.font.lineHeight`, node.font.lineHeight, 0);
      validateNumber(`${node.id}.font.letterSpacing`, node.font.letterSpacing);
      if (node.runs !== undefined) {
        // Same boundary class as lineCap above: run.weight reaches attribute
        // position in the markup, so shape and numbers are enforced at
        // runtime — the TypeScript type does not protect a public caller.
        if (!Array.isArray(node.runs) || node.runs.length === 0) {
          throw new Error(`invalid SVG text runs ${node.id} — expected a non-empty array`);
        }
        // index loop, not forEach: forEach/some/map skip sparse-array holes,
        // which would let `Array(1)` sail through every per-run check
        for (let index = 0; index < node.runs.length; index++) {
          const run: unknown = node.runs[index];
          if (typeof run !== 'object' || run === null) {
            throw new Error(`invalid SVG text run ${node.id}.runs[${index}] — expected an object`);
          }
          const { text, weight } = run as { text?: unknown; weight?: unknown };
          if (typeof text !== 'string') {
            throw new Error(`invalid SVG text run ${node.id}.runs[${index}].text — expected a string`);
          }
          // CSS Fonts 4: numeric font-weight is 1..1000 — enforce both ends
          validateNumber(`${node.id}.runs[${index}].weight`, weight as number | undefined, 1);
          if (typeof weight === 'number' && weight > 1000) {
            throw new Error(`invalid SVG numeric ${node.id}.runs[${index}].weight '${weight}' — above 1000`);
          }
        }
        if (node.lines.length !== 1 || node.lines[0] !== node.runs.map((run) => run.text).join('')) {
          throw new Error(
            `invalid SVG text runs ${node.id} — runs are single-line and lines[0] must equal the concatenated run texts`,
          );
        }
      }
      if (node.backing) validateRectNumbers(`${node.id}.backing`, node.backing);
    }
  }
}

function validateThemeNumbers(theme: Theme): void {
  validateNumber('theme.pattern.hatchGap', theme.pattern.hatchGap, Number.MIN_VALUE);
  validateNumber('theme.pattern.hatchStrokeWidth', theme.pattern.hatchStrokeWidth, 0);
  validateNumber('theme.pattern.hatchAngle', theme.pattern.hatchAngle);
  validateNumber('theme.pattern.outlineStrokeWidth', theme.pattern.outlineStrokeWidth, 0);
}

function validateThemeColors(theme: Theme): void {
  const color = theme.color;
  const values = [
    color.good,
    color.bad,
    color.warn,
    color.neutral,
    color.neutralLight,
    color.highlight,
    color.focus,
    color.spark,
    color.neutralMark,
    color.goodFill,
    color.badFill,
    color.warnFill,
    color.inkMeta,
    color.rest,
    color.othersMark,
    color.markInk,
    color.heatTop,
    color.heatTopInk,
    color.onFillInk,
    color.onFillLightInk,
    color.rule,
    color.reference,
    color.total,
    color.others,
    color.ink,
    color.inkInverse,
    color.inkMuted,
    color.axis,
    color.grid,
    color.leader,
    color.background,
    ...color.series,
    ...(color.casePair ?? []),
    ...(color.stack ?? []),
    ...Object.values(color.palettes ?? {}).flat(),
    ...Object.values(color.status),
    color.colorblind.good,
    color.colorblind.bad,
  ];
  for (const value of values) {
    if (value !== undefined) checkedColor(value);
  }
}

interface PaintFormatter {
  attr: (paint: Paint) => string;
  background: () => string;
  halo: (ink: Paint) => string;
}

function paintFormatter(theme: Theme): PaintFormatter {
  const attr = (paint: Paint): string => {
    if ('css' in paint) return colorAttr(paint.css);
    if ('token' in paint) assertPaintToken(paint.token);
    validateTint(paint.tint);
    return colorAttr(resolvePaint(paint, theme));
  };
  return {
    attr,
    background: () => attr({ token: 'background' }),
    halo: (ink) => attr(haloPaint(ink, theme)),
  };
}

/**
 * Baseline offset from the top of the line box, as a fraction of
 * font-size. Node y-coordinates are line-box TOPS (layout convention);
 * the renderer emits the baseline explicitly because WebKit ignores
 * dominant-baseline="text-before-edge". 0.88 matches the visual position
 * text-before-edge produced in spec-correct rasterizers (A/B verified)
 * and equals the table layout's NOTE_BASELINE_LOCK.
 */
/** Baseline offset from the line-box top as a fraction of font size (Helvetica/Arial ascent). */
export const TEXT_ASCENT = 0.88;

const n2 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * The root's own size, capped to its container, and resets for the inherited
 * text properties a host page can set: the layout measured every label
 * without them, so an inherited uppercase or letter-spacing overflows it.
 * `direction` is an attribute beside it.
 */
const ROOT_STYLE =
  'max-width:100%;height:auto;text-transform:none;letter-spacing:normal;word-spacing:normal;font-style:normal;font-variant:normal';

interface InteractiveContext {
  categoryLabels: Map<string, string>;
  seriesLabels: Map<string, string>;
  legendKeysByNodeId: Map<string, string>;
  legendTriggerNodeIds: Set<string>;
  legendKeysByPaint: Map<string, string>;
  claimsByNodeId: Map<string, string>;
}

function fillKey(node: SceneNode | undefined): string | undefined {
  if (!node || !('fill' in node) || !node.fill) return undefined;
  return `${JSON.stringify(node.fill)}\u001f${node.t === 'rect' || node.t === 'path' ? (node.pattern ?? '') : ''}`;
}

function interactiveContext(
  geometry: Geometry,
  claims: RenderSvgOptions['claims'],
): InteractiveContext {
  const categoryLabels = new Map<string, string>();

  for (const label of geometry.labels) {
    if (
      (label.kind === 'category' || label.kind === 'activity') &&
      label.owner.categoryId
    ) {
      categoryLabels.set(label.owner.categoryId, label.text);
    }
  }

  const sceneById = new Map(geometry.scene.map((node) => [node.id, node]));
  const legendKeysByNodeId = new Map<string, string>();
  const legendTriggerNodeIds = new Set<string>();
  const legendKeysByPaint = new Map<string, string>();
  const ambiguousLegendPaints = new Set<string>();
  const seriesLabels = new Map<string, string>();
  for (const item of geometry.legend?.items ?? []) {
    legendKeysByNodeId.set(item.swatchNodeId, item.id);
    legendKeysByNodeId.set(item.labelId, item.id);
    legendTriggerNodeIds.add(item.labelId);
    const swatchKey = fillKey(sceneById.get(item.swatchNodeId));
    if (swatchKey) {
      const existing = legendKeysByPaint.get(swatchKey);
      if (existing && existing !== item.id) {
        legendKeysByPaint.delete(swatchKey);
        ambiguousLegendPaints.add(swatchKey);
      } else if (!ambiguousLegendPaints.has(swatchKey)) {
        legendKeysByPaint.set(swatchKey, item.id);
      }
    }
    const labelNode = sceneById.get(item.labelId);
    if (labelNode?.t === 'text') seriesLabels.set(item.id, labelNode.lines.join(' '));
  }
  for (const label of geometry.labels) {
    if (
      label.kind === 'series' &&
      label.owner.seriesId &&
      !label.owner.categoryId &&
      !seriesLabels.has(label.owner.seriesId)
    ) {
      seriesLabels.set(label.owner.seriesId, label.text);
    }
  }

  const claimsByNodeId = new Map<string, string>();
  for (const claim of claims ?? []) {
    if (claim.nodeId) claimsByNodeId.set(claim.nodeId, claim.id);
  }

  return {
    categoryLabels,
    seriesLabels,
    legendKeysByNodeId,
    legendTriggerNodeIds,
    legendKeysByPaint,
    claimsByNodeId,
  };
}

function renderSvgInternal(
  geometry: Geometry,
  theme: Theme,
  opts: RenderSvgOptions,
): string {
  validateThemeColors(theme);
  validateThemeNumbers(theme);
  validateGeometryNumbers(geometry);
  const formatter = paintFormatter(theme);
  // The CLI export paints explicit panel themes as their layouts do.
  const bindings = sceneThemeBindings(geometry).map(binding => {
    const childTheme = resolveTheme(binding.theme);
    return { prefix: binding.prefix, theme: childTheme, formatter: paintFormatter(childTheme) };
  });
  const contextFor = (node: SceneNode) => {
    let context = { theme, formatter };
    for (const binding of bindings) if (node.id.startsWith(binding.prefix)) context = binding;
    return context;
  };
  const interactive = opts.interactive === true;
  const interaction = interactive ? interactiveContext(geometry, opts.claims) : undefined;
  const idScope = opts.idScope;
  if (idScope !== undefined && !ID_SCOPE_PATTERN.test(idScope)) {
    // Fail loud rather than sanitize: sanitizing could fold two distinct
    // scopes onto one string and reintroduce the collision it exists to stop.
    throw new Error(
      `renderSvg: idScope '${idScope}' must match ${ID_SCOPE_PATTERN.source} (it is pasted into an id)`,
    );
  }
  const { size } = geometry;
  // Slide and print declare their natural size in pt from the resolved
  // metadata; screen targets keep px. The viewBox stays in layout px.
  const natural = geometry.presentation?.naturalSize;
  const dims = natural?.unit === 'pt'
    ? `width="${n2(natural.width)}pt" height="${n2(natural.height)}pt"`
    : `width="${n2(size.width)}" height="${n2(size.height)}"`;
  const out: string[] = [];

  // Every inline chart references its own scoped description.
  const titleId = scopedId('bp-title', idScope);
  const descId = scopedId('bp-desc', idScope);
  // xlink:href beside href for importers that only read SVG 1.1.
  const xlink = geometry.scene.some((node) => node.t === 'image') ? ` xmlns:xlink="${XLINK_NS}"` : '';
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg"${xlink} data-bp-engine="${ENGINE_REV}" viewBox="0 0 ${n2(size.width)} ${n2(size.height)}" ` +
      `${dims} direction="ltr" style="${ROOT_STYLE}" ` +
      `preserveAspectRatio="xMidYMid meet" role="${interactive ? 'graphics-document document' : 'img'}" aria-label="${esc(geometry.a11y.title, 'a11y.title')}" aria-describedby="${descId}" ` +
      `${geometry.sizing ? `data-bp-sizing="${esc(JSON.stringify(geometry.sizing), 'sizing')}" ` : ''}` +
      `${geometry.mode ? `data-bp-mode="${geometry.mode}" ` : ''}` +
      `font-family="${esc(theme.type.family, 'theme.type.family')}"${interactive ? ` data-bp-interactive="" data-bp-chart="${esc(geometry.type, 'geometry.type')}"` : ''}>`,
  );
  if (geometry.a11y.includeTitle === true) {
    out.push(`<title id="${titleId}">${esc(geometry.a11y.title, 'a11y.title')}</title>`);
  }
  out.push(`<desc id="${descId}">${esc(geometry.a11y.desc, 'a11y.desc')}</desc>`);

  // Collect required pattern defs from the scene.
  const patternDefs = new Map<string, string>();
  for (const node of geometry.scene) {
    if ((node.t === 'rect' || node.t === 'path') && isHatchPattern(node.pattern) && node.fill) {
      const { theme, formatter } = contextFor(node);
      const ground = node.t === 'rect' ? node.hatchGround : undefined;
      const { id, stroke, background: bg, gap, width } = resolvedHatchPattern(node.fill, theme, formatter, idScope, ground, node.hatch, node.pattern);
      if (!patternDefs.has(id)) {
        const tile = hatchTile(gap, width, node.pattern);
        patternDefs.set(
          id,
          `<pattern id="${esc(id, 'pattern id')}" patternUnits="userSpaceOnUse" width="${tile.size}" height="${tile.size}">` +
            `<rect width="${tile.size}" height="${tile.size}" fill="${bg}"/>` +
            // A stroke-only path: without fill="none" its computed fill is
            // black, which paints nothing but reads as a raw black in a
            // colour audit.
            `<path d="${tile.d}" fill="none" stroke="${stroke}" stroke-width="${tile.strokeWidth}"/>` +
            `</pattern>`,
        );
      }
    }
  }
  if (patternDefs.size > 0) {
    out.push(`<defs>${[...patternDefs.values()].join('')}</defs>`);
  }

  if (opts.background !== false) {
    out.push(
      `<rect x="0" y="0" width="${n2(size.width)}" height="${n2(size.height)}" fill="${formatter.background()}"/>`,
    );
  }

  for (const node of geometry.scene) {
    const context = contextFor(node);
    out.push(renderNode(node, context.theme, context.formatter, interaction, idScope, theme.type.family));
  }

  out.push('</svg>');
  return out.join('\n');
}

/** Public rendering never rounds data-driven colors. */
export function renderSvg(geometry: Geometry, theme: Theme, opts: RenderSvgOptions = {}): string {
  return renderSvgInternal(geometry, theme, opts);
}

/** Escape text for markup with the serializer's XML rules: the five entities and numeric references only. */
export const escapeMarkup = (value: string, channel?: string): string => esc(value, channel);

export interface SlideShapesOptions {
  /** Slide px per layout px. */
  scale: number;
  /** The accessible name: the chart title and type. */
  ariaLabel: string;
  /** Inline CSS of the root, from the Slides subset (the placement on the slide). */
  style: string;
  background?: boolean;
  idScope?: string;
}

/**
 * The shapes of a chart as one SVG for a Claude Slides fragment: no text, no
 * ids, no `<style>`, no images, presentation attributes with literal colours.
 * Width and height equal the viewBox, in slide px; one group scales the layout.
 * The text goes on the slide as HTML (core/slides/claudeSlides).
 */
export function renderSlideShapes(geometry: Geometry, theme: Theme, opts: SlideShapesOptions): string {
  validateThemeColors(theme);
  validateThemeNumbers(theme);
  validateGeometryNumbers(geometry);
  validateNumber('scale', opts.scale, Number.MIN_VALUE);
  if (opts.idScope !== undefined && !ID_SCOPE_PATTERN.test(opts.idScope)) {
    throw new Error(`renderSlideShapes: idScope '${opts.idScope}' must match ${ID_SCOPE_PATTERN.source} (it is pasted into an id)`);
  }
  const formatter = paintFormatter(theme);
  const bindings = sceneThemeBindings(geometry).map(binding => {
    const childTheme = resolveTheme(binding.theme);
    return { prefix: binding.prefix, theme: childTheme, formatter: paintFormatter(childTheme) };
  });
  const contextFor = (node: SceneNode) => {
    let context = { theme, formatter };
    for (const binding of bindings) if (node.id.startsWith(binding.prefix)) context = binding;
    return context;
  };
  const { size } = geometry;
  const slideWidth = n2(size.width * opts.scale);
  const slideHeight = n2(size.height * opts.scale);
  const out: string[] = [
    `<svg viewBox="0 0 ${slideWidth} ${slideHeight}" width="${slideWidth}" height="${slideHeight}" aria-label="${esc(opts.ariaLabel, 'aria-label')}" style="${esc(opts.style, 'style')}">`,
  ];
  const patternDefs = new Map<string, string>();
  for (const node of geometry.scene) {
    if ((node.t === 'rect' || node.t === 'path') && isHatchPattern(node.pattern) && node.fill) {
      const { theme, formatter } = contextFor(node);
      const ground = node.t === 'rect' ? node.hatchGround : undefined;
      const { id, stroke, background: bg, gap, width } = resolvedHatchPattern(node.fill, theme, formatter, opts.idScope, ground, node.hatch, node.pattern);
      if (!patternDefs.has(id)) {
        const tile = hatchTile(gap, width, node.pattern);
        patternDefs.set(id,
          `<pattern id="${esc(id, 'pattern id')}" patternUnits="userSpaceOnUse" width="${tile.size}" height="${tile.size}">` +
          `<rect width="${tile.size}" height="${tile.size}" fill="${bg}"/>` +
          `<path d="${tile.d}" fill="none" stroke="${stroke}" stroke-width="${tile.strokeWidth}"/></pattern>`);
      }
    }
  }
  if (patternDefs.size > 0) out.push(`<defs>${[...patternDefs.values()].join('')}</defs>`);
  out.push(`<g transform="scale(${opts.scale})">`);
  if (opts.background !== false) {
    out.push(`<rect x="0" y="0" width="${n2(size.width)}" height="${n2(size.height)}" fill="${formatter.background()}"/>`);
  }
  for (const node of geometry.scene) {
    const context = contextFor(node);
    const shape = renderNode(node, context.theme, context.formatter, undefined, opts.idScope, theme.type.family, true);
    if (shape) out.push(shape);
  }
  out.push('</g></svg>');
  return out.join('');
}

/**
 * ONE place where a scope is welded onto an id — the def and the `url(#…)`
 * that points at it must never be derived by two different expressions
 * (a paint decision and its reference must not drift apart).
 */
function scopedId(id: string, scope: string | undefined): string {
  return scope === undefined ? id : `${id}-${scope}`;
}

function renderNode(
  node: SceneNode,
  theme: Theme,
  formatter: PaintFormatter,
  interaction?: InteractiveContext,
  idScope?: string,
  rootFontFamily = theme.type.family,
  plain = false,
): string {
  const tf = node.tx || node.ty ? ` transform="translate(${n2(node.tx ?? 0)},${n2(node.ty ?? 0)})"` : '';
  try {
    return renderNodeInner(node, theme, formatter, tf, interaction, idScope, rootFontFamily, plain);
  } catch (error) {
    // Name the node that carries the unrepresentable string: without it the
    // author is told a character is bad but not which of 40 labels holds it.
    if (error instanceof XmlCharError) {
      throw new XmlCharError(
        `scene node '${printable(node.id)}' (part '${printable(node.part)}'): ${error.message}`,
      );
    }
    throw error;
  }
}

function interactiveAttrs(node: SceneNode, context: InteractiveContext | undefined): string {
  if (!context) return '';
  const attrs = [` data-bp-part="${esc(node.part, 'node.part')}"`];
  const { owner } = node;
  if (owner.seriesId) {
    attrs.push(` data-bp-series="${esc(owner.seriesId, 'owner.seriesId')}"`);
    const label = context.seriesLabels.get(owner.seriesId);
    if (label) attrs.push(` data-bp-series-label="${esc(label, 'series label')}"`);
  }
  if (owner.categoryId) {
    attrs.push(` data-bp-category="${esc(owner.categoryId, 'owner.categoryId')}"`);
    const label = context.categoryLabels.get(owner.categoryId);
    if (label) attrs.push(` data-bp-category-label="${esc(label, 'category label')}"`);
  }
  if (owner.rowId) attrs.push(` data-bp-row="${esc(owner.rowId, 'owner.rowId')}"`);
  if (owner.colId) attrs.push(` data-bp-column="${esc(owner.colId, 'owner.colId')}"`);

  if (node.display?.value !== undefined) {
    attrs.push(` data-bp-value="${esc(node.display.value, 'display.value')}"`);
  }
  if (node.display?.state !== undefined) {
    attrs.push(` data-bp-state="${esc(node.display.state, 'display.state')}"`);
  }

  const legendKey = context.legendKeysByNodeId.get(node.id);
  const paintKey = context.legendKeysByPaint.get(fillKey(node) ?? '');
  const key =
    legendKey ??
    paintKey ??
    owner.seriesId ??
    owner.segmentId ??
    owner.pointId ??
    owner.categoryId ??
    owner.valueLineId ??
    owner.annotationId ??
    (owner.rowId || owner.colId ? `${owner.rowId ?? ''}:${owner.colId ?? ''}` : undefined);
  if (key) attrs.push(` data-bp-key="${esc(key, 'interaction key')}"`);
  if (context.legendTriggerNodeIds.has(node.id)) attrs.push(' data-bp-legend=""');

  const claim = context.claimsByNodeId.get(node.id);
  if (claim) attrs.push(` data-bp-claim-linked="${esc(claim, 'claim id')}"`);
  if (node.display?.value !== undefined || node.display?.state !== undefined || claim) {
    attrs.push(' data-bp-mark=""');
  }
  return attrs.join('');
}


function resolvedHatchPattern(
  fill: Paint, theme: Theme, formatter: PaintFormatter, idScope?: string,
  ground?: Paint, look?: HatchLook, pattern: 'hatch45' | 'crosshatch' | 'horizontal' | 'vertical' = 'hatch45',
) {
  const stroke = formatter.attr(hatchPaint(fill, theme, ground, look));
  const background = ground ? formatter.attr(ground) : formatter.background();
  const { hatchAngle } = theme.pattern;
  const width = hatchStrokeWidthFor(theme, look);
  const gap = theme.pattern.hatchGap * hatchGapFactor(look);
  return { id: scopedId(hatchPatternId(stroke, background, hatchAngle, gap, width) + (pattern === 'hatch45' ? '' : `-${pattern}`), idScope), stroke, background, gap, width };
}

function renderedPathFill(
  node: Extract<SceneNode, { t: 'path' }>,
  theme: Theme, formatter: PaintFormatter, idScope?: string,
): string {
  if (!node.fill) return 'none';
  return isHatchPattern(node.pattern)
    ? `url(#${resolvedHatchPattern(node.fill, theme, formatter, idScope, undefined, node.hatch, node.pattern).id})`
    : formatter.attr(node.fill);
}

function renderNodeInner(
  node: SceneNode,
  theme: Theme,
  formatter: PaintFormatter,
  tf: string,
  interaction?: InteractiveContext,
  idScope?: string,
  rootFontFamily = theme.type.family,
  /** Shapes only, for a slide fragment: no ids, titles, images or text, only a text node's backing. */
  plain = false,
): string {
  const rc = interactiveAttrs(node, interaction) + (node.opacity === undefined ? '' : ` opacity="${node.opacity}"`)
    + (POINTER_TRANSPARENT_PARTS.has(node.part) ? ' pointer-events="none"' : '');
  switch (node.t) {
    case 'image': {
      if (plain) return '';
      const { rect } = node;
      return `<image${tf} data-id="${esc(node.id)}" data-part="${esc(node.part)}"${rc} x="${n2(rect.x)}" y="${n2(rect.y)}" width="${n2(rect.w)}" height="${n2(rect.h)}" href="${esc(node.src)}" xlink:href="${esc(node.src)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(node.alt)}"><title>${esc(node.alt)}</title></image>`;
    }
    case 'rect': {
      const { rect } = node;
      let fill: string;
      let extra = '';
      if (isHatchPattern(node.pattern)) {
        const stroke = formatter.attr(node.fill);
        fill = `url(#${resolvedHatchPattern(node.fill, theme, formatter, idScope, node.hatchGround, node.hatch, node.pattern).id})`;
        extra = node.hatchEdge === false ? '' : ` stroke="${stroke}" stroke-width="${strokeToken(theme, 'hair')}"`;
      } else if (node.pattern === 'outline' && solidMutedPlan(theme)) {
        // A theme's solid, muted plan look: no outline.
        fill = formatter.attr(PLAN_MUTED_PAINT);
      } else if (node.pattern === 'outline' || node.pattern === 'hollow') {
        fill = formatter.background();
        extra = ` stroke="${formatter.attr(node.fill)}" stroke-width="${theme.pattern.outlineStrokeWidth}"`;
      } else {
        fill = formatter.attr(node.fill);
        if (node.stroke) {
          extra = ` stroke="${formatter.attr(node.stroke)}" stroke-width="${node.strokeWidth ?? strokeToken(theme, 'mark')}"`;
        }
      }
      const radius = node.radius ? ` rx="${n2(node.radius)}"` : '';
      const open = `<rect${tf}${plain ? '' : ` data-id="${esc(node.id, 'node.id')}" data-part="${esc(node.part, 'node.part')}"`}${rc} x="${n2(rect.x)}" y="${n2(rect.y)}" width="${n2(rect.w)}" height="${n2(rect.h)}"${radius} fill="${fill}"${extra}`;
      // A rectangle that stands for text carries it, the way an image does.
      if (node.title === undefined || plain) return `${open}/>`;
      return `${open} role="img" aria-label="${esc(node.title, 'node.title')}"><title>${esc(node.title, 'node.title')}</title></rect>`;
    }
    case 'line': {
      const dash = node.dash ? ` stroke-dasharray="${node.dash.join(' ')}"` : '';
      const lineCap = node.lineCap ? ` stroke-linecap="${esc(node.lineCap, 'line.lineCap')}"` : '';
      return `<line${tf}${plain ? '' : ` data-id="${esc(node.id, 'node.id')}" data-part="${esc(node.part, 'node.part')}"`}${rc} x1="${n2(node.x1)}" y1="${n2(node.y1)}" x2="${n2(node.x2)}" y2="${n2(node.y2)}" stroke="${formatter.attr(node.stroke)}" stroke-width="${node.width}"${dash}${lineCap}/>`;
    }
    case 'path': {
      const fill = renderedPathFill(node, theme, formatter, idScope);
      const stroke = node.stroke
        ? ` stroke="${formatter.attr(node.stroke)}" stroke-width="${node.width ?? strokeToken(theme, 'rule')}"`
        : '';
      const dash = node.dash ? ` stroke-dasharray="${node.dash.join(' ')}"` : '';
      const lineCap = node.lineCap ? ` stroke-linecap="${esc(node.lineCap, 'path.lineCap')}"` : '';
      return `<path${tf}${plain ? '' : ` data-id="${esc(node.id)}" data-part="${esc(node.part)}"`}${rc} d="${esc(node.d)}" fill="${fill}"${stroke}${dash}${lineCap} stroke-linejoin="round"/>`;
    }
    case 'circle': {
      const stroke = node.stroke
        ? ` stroke="${formatter.attr(node.stroke)}" stroke-width="${node.strokeWidth ?? strokeToken(theme, 'mark')}"`
        : '';
      return `<circle${tf}${plain ? '' : ` data-id="${esc(node.id, 'node.id')}" data-part="${esc(node.part, 'node.part')}"`}${rc} cx="${n2(node.cx)}" cy="${n2(node.cy)}" r="${n2(node.r)}" fill="${formatter.attr(node.fill)}"${stroke}${node.title === undefined || plain ? '/>' : `><title>${esc(node.title, 'node.title')}</title></circle>`}`;
    }
    case 'text': {
      const anchor = node.align === 'start' ? 'start' : node.align === 'end' ? 'end' : 'middle';
      const font = node.font;
      const lineH = font.size * (font.lineHeight ?? 1.2);
      const ink = formatter.attr(node.ink);
      const backing = node.backing
        ? `<rect x="${n2(node.backing.x)}" y="${n2(node.backing.y)}" width="${n2(node.backing.w)}" height="${n2(node.backing.h)}" fill="${formatter.background()}" opacity="0.92"/>`
        : '';
      // A slide fragment draws the label itself as HTML over the shapes; only its backing stays a shape.
      if (plain) return tf && backing ? `<g${tf}>${backing}</g>` : backing;
      // letter-spacing adds a trailing advance after the LAST glyph too —
      // shift end/middle anchors so tracked text keeps its shared edge
      const ls = font.letterSpacing ?? 0;
      const lsAttr = ls ? ` letter-spacing="${n2(ls)}"` : '';
      const lsShift = ls ? (node.align === 'end' ? ls : node.align === 'middle' ? ls / 2 : 0) : 0;
      const tx0 = node.x + lsShift;
      // Styled runs (single line): tspans WITHOUT x, so the font engine owns
      // the intra-line advance — a per-run x would re-print the width model's
      // error into the joins (see SceneNode.runs).
      const spans = node.runs
        ? node.runs
            .map(
              (run, i) =>
                `<tspan${run.weight !== undefined && run.weight !== font.weight ? ` font-weight="${n2(run.weight)}"` : ''}>${esc(run.text, `text run ${i}`)}</tspan>`,
            )
            .join('')
        : node.lines
            .map(
              (line, i) =>
                `<tspan x="${n2(tx0)}" dy="${i === 0 ? '0' : n2(lineH)}">${esc(line, `text line ${i}`)}</tspan>`,
            )
            .join('');
      // The root <svg> carries the theme family; a node repeats it only when it differs.
      const family =
        font.family && font.family !== rootFontFamily ? ` font-family="${esc(font.family, 'font.family')}"` : '';
      // node.y is the TOP of the line box; emit the BASELINE explicitly.
      // dominant-baseline="text-before-edge" is ignored by WebKit/Safari
      // (every table read as struck-through there) — explicit ascent math
      // renders identically everywhere. ASCENT approximates the Helvetica/
      // Arial/SF ascent as a fraction of font-size.
      const baselineY = node.y + font.size * TEXT_ASCENT;
      const rotateAttr = node.rotate ? ` transform="rotate(${n2(node.rotate)} ${n2(tx0)} ${n2(baselineY)})"` : '';
      // A cut line keeps its full text in <title>, the first child so every
      // renderer reads it as the element's accessible name.
      const fullText = node.title ? `<title>${esc(node.title, 'node.title')}</title>` : '';
      // Figures only on numeric roles; names and prose keep the font default.
      const role = textRole(node);
      const figures = numericVariant(role, theme);
      const numeric = figures ? ` style="font-variant-numeric: ${figures}"` : '';
      const placed = ` x="${n2(tx0)}" y="${n2(baselineY)}" text-anchor="${anchor}"${rotateAttr}${family} font-size="${font.size}" font-weight="${font.weight}"${font.style === undefined ? '' : ` font-style="${font.style}"`}${lsAttr}`;
      // The halo is a copy of the label drawn first, stroked in the halo
      // paint, and the label is drawn over it unstroked. paint-order on one
      // element does the same in browsers, but LibreOffice and the Office
      // importers ignore paint-order and stroke the glyphs away.
      const halo = node.halo ? formatter.halo(node.ink) : '';
      const haloText = halo
        ? `<text aria-hidden="true"${node.opacity === undefined ? '' : ` opacity="${node.opacity}"`}${placed} fill="${halo}" stroke="${halo}" stroke-width="2.5" stroke-linejoin="round"${numeric}>${spans}</text>`
        : '';
      const text = `<text data-id="${esc(node.id, 'node.id')}" data-part="${esc(node.part, 'node.part')}" data-bp-role="${role}"${rc}${placed} fill="${ink}"${numeric}>${fullText}${spans}</text>`;
      return tf ? `<g${tf}>${backing}${haloText}${text}</g>` : backing + haloText + text;
    }
  }
}
