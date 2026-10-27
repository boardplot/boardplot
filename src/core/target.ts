/** Render targets share layout pixels. Physical type tables are measured in points. */
import type { Size } from './geometry';
import { NormalizeError } from './normalize/shared';
import type { CanvasSizeInput, LengthUnit, RenderTarget, SizePreset } from './types/options';
import type { TypographyRole } from './types/scene';
import type { PresentationInfo } from './types/sizing';
import type { TypeRoleName } from './types/theme';

export const DEFAULT_TARGET: RenderTarget = 'report';

/**
 * The options a registered layout draws with: an unset target is the default
 * target on every surface. The layout entry
 * applies it once, before sizing, the footer or the narrow-share retry read
 * the target, so a direct `layout` call draws what a resolved request draws.
 */
export function withDefaultTarget<O>(options: O): O {
  return (options as { target?: RenderTarget } | undefined)?.target === undefined
    ? { ...options, target: DEFAULT_TARGET } as O : options;
}

export const SIZE_PRESETS: Record<SizePreset, Size> = {
  'slide-16x9': { width: 720, height: 405 },
  'slide-4x3': { width: 720, height: 540 },
  a4: { width: 1052, height: 744 },
  dashboard: { width: 480, height: 270 },
  'a4-landscape-content': { width: toLayoutPx(267, 'mm'), height: toLayoutPx(180, 'mm') },
  'a4-portrait-content': { width: toLayoutPx(180, 'mm'), height: toLayoutPx(267, 'mm') },
};

type TypeColumn = Readonly<Record<TypeRoleName, number>>;
type TargetTable = {
  unit: 'px' | 'pt'; S: TypeColumn; M: TypeColumn; L: TypeColumn; floors: TypeColumn; heroMinimum: number;
  /** The headline of each panel in a multi-panel waffle, from 720 px canvas width and below it. */
  panelHero?: { wide: number; narrow: number };
};
/** `secondary` defaults to the axis size: a target without its own secondary step draws that text at the axis size. */
const column = (title: number, subtitle: number, label: number, axis: number, footnote: number, micro: number, secondary = axis): TypeColumn =>
  Object.freeze({ title, subtitle, label, axis, footnote, micro, secondary });

/** type tables. Only this module converts them to layout pixels. */
export const TARGET_TYPE_TABLES: Readonly<Record<RenderTarget, Readonly<TargetTable>>> = Object.freeze({
  dashboard: Object.freeze({ unit: 'px', S: column(16, 13, 13, 13, 12, 11), M: column(18, 13, 13, 13, 12, 11), L: column(20, 14, 14, 14, 12, 11), floors: column(14, 12, 12, 12, 11, 11), heroMinimum: 24 }),
  // Report type steps by width. S (< 720 px): title 17, subtitle 13, labels 12, key and secondary 11.
  // M (720-1079 px): title 20, subtitle 14, labels 13, key and secondary 12. Secondary text (ticks, axis titles,
  // AC | FC markers, background series labels) takes the secondary step. The footer draws 11 px (footer.ts
  // FOOTER_TEXT_PX), so the footnote floor is 11 px (8.25 pt on slides). Floor 11 for every role but the title.
  report: Object.freeze({ unit: 'px', S: column(17, 13, 12, 12, 12, 12, 11), M: column(20, 14, 13, 13, 12, 12, 12), L: column(22, 15, 15, 15, 13, 13, 13), floors: column(17, 11, 11, 11, 11, 11, 11), heroMinimum: 28, panelHero: { wide: 22, narrow: 18 } }),
  slide: Object.freeze({ unit: 'pt', S: column(18, 13, 13, 13, 10, 11), M: column(20, 14, 14, 14, 10, 11), L: column(22, 14, 14, 14, 11, 11), floors: column(16, 12, 12, 12, 8.25, 11), heroMinimum: 24 }),
  print: Object.freeze({ unit: 'pt', S: column(14, 10, 10, 10, 9, 9), M: column(16, 11, 11, 11, 9, 9), L: column(18, 11, 11, 11, 9, 9), floors: column(12, 10, 9, 9, 8, 8), heroMinimum: 16 }),
});

export function toLayoutPx(value: number, unit: LengthUnit = 'px'): number {
  return unit === 'pt' ? value / 72 * 96 : unit === 'mm' ? value / 25.4 * 96 : value;
}

interface ResolvedTargetSize {
  sizePx: Size;
  fixed: { width: boolean; height: boolean };
}

export function resolveTargetSize(target: RenderTarget, input?: CanvasSizeInput): ResolvedTargetSize {
  if (!Object.hasOwn(TARGET_TYPE_TABLES, target)) {
    throw new NormalizeError('invalid-target', 'options.target', `unknown render target '${target}'`, Object.keys(TARGET_TYPE_TABLES).join(', '));
  }
  if (input === undefined) {
    const sizePx = target === 'slide' ? { width: 1184, height: 528 }
      : target === 'print' ? { ...SIZE_PRESETS['a4-landscape-content'] }
      : { ...SIZE_PRESETS[target === 'dashboard' ? 'dashboard' : 'slide-16x9'] };
    const fixed = target === 'slide' || target === 'print';
    return { sizePx, fixed: { width: fixed, height: fixed } };
  }
  if (typeof input === 'string') {
    if (!Object.hasOwn(SIZE_PRESETS, input)) {
      throw new NormalizeError('invalid-size', 'options.size', `unknown size preset '${input}'`, Object.keys(SIZE_PRESETS).join(', '));
    }
    return { sizePx: { ...SIZE_PRESETS[input] }, fixed: { width: true, height: true } };
  }
  if (!Number.isFinite(input.width) || input.width <= 0
    || (input.height !== undefined && (!Number.isFinite(input.height) || input.height <= 0))
    || (input.unit !== undefined && !['px', 'pt', 'mm'].includes(input.unit))) {
    throw new NormalizeError('invalid-size', 'options.size', 'size needs a width, and a height when it has one, as finite positive numbers in px, pt or mm');
  }
  const width = toLayoutPx(input.width, input.unit);
  const height = input.height === undefined ? Math.round(width * (9 / 16)) : toLayoutPx(input.height, input.unit);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new NormalizeError('invalid-size', 'options.size', 'size must remain finite after unit conversion');
  }
  return { sizePx: { width, height }, fixed: { width: true, height: input.height !== undefined } };
}

/** The allowed range of the `textScale` option. */
export const TEXT_SCALE_RANGE = Object.freeze({ min: 0.5, max: 2.5 });

/** The allowed range of the `textSize` option, in layout px. */
export const TEXT_SIZE_RANGE = Object.freeze({ min: 6, max: 32 });

/**
 * The factor `textSize` stands for: the pinned primary label size over the
 * target's label size in the middle width column, the column every width class
 * is held to when `textSize` is set. Every role keeps its ratio to the label.
 */
export function textSizeScale(target: RenderTarget, textSize: number): number {
  const table = TARGET_TYPE_TABLES[target];
  return textSize / toLayoutPx(table.M.label, table.unit);
}

/** One text size under `textScale`, to 0.01 px. Floors and theme sizes use the same rounding, so equal sizes stay equal. */
export function scaleTextPx(size: number, textScale = 1): number {
  return textScale === 1 ? size : Math.round(size * textScale * 100) / 100;
}

/**
 * A text size under `textScale`. A scale under 1 stops at `floor`: smaller text
 * never goes under the reader floor, as no layout step takes it there; a size already under it keeps its own.
 */
export function scaleTextAtFloor(size: number, textScale: number, floor: number): number {
  const scaled = scaleTextPx(size, textScale);
  return textScale >= 1 ? scaled : Math.max(scaled, Math.min(size, floor));
}

/** The target's readability floors, raised with a `textScale` above 1; a smaller scale stops at them (scaleTextAtFloor). */
export function targetFloorsPx(target: RenderTarget, textScale = 1): Readonly<Record<TypographyRole, number>> {
  const table = TARGET_TYPE_TABLES[target];
  const floors = {
    ...mapColumn(table.floors, table.unit), kpiValue: toLayoutPx(table.heroMinimum, table.unit),
    panelValue: toLayoutPx(table.panelHero?.narrow ?? table.heroMinimum, table.unit),
  };
  return Object.freeze(textScale <= 1 ? floors : Object.fromEntries(Object.entries(floors).map(([role, size]) => [role, scaleTextPx(size, textScale)])) as typeof floors);
}

function mapColumn(values: TypeColumn, unit: LengthUnit): Record<TypeRoleName, number> {
  return Object.fromEntries(Object.entries(values).map(([role, size]) => [role, toLayoutPx(size, unit)])) as Record<TypeRoleName, number>;
}

export function targetTypeSizesPx(target: RenderTarget, typeClass: 'S' | 'M' | 'L'): TypeColumn {
  const table = TARGET_TYPE_TABLES[target];
  return mapColumn(table[typeClass], table.unit);
}

/** `resolvedMTitlePx` is the title as resolved, `textScale` included; the hero follows the same scale. */
export function kpiHeroSizesPx(target: RenderTarget, resolvedMTitlePx: number, textScale = 1): { preferred: number; minimum: number } {
  const table = TARGET_TYPE_TABLES[target];
  const minimum = toLayoutPx(table.heroMinimum, table.unit);
  const title = resolvedMTitlePx / textScale / toLayoutPx(1, table.unit);
  const preferred = Math.max(table.heroMinimum, Math.round(1.5 * title));
  return { preferred: scaleTextAtFloor(toLayoutPx(preferred, table.unit), textScale, minimum), minimum: scaleTextAtFloor(minimum, textScale, minimum) };
}

/**
 * The headlines of a multi-panel waffle are small
 * panel numbers, not one hero figure. On the report target they take 22 px
 * on a canvas 720 px and wider and 18 px below it (stepping to 18 px when 22
 * does not fit). A single hero number keeps kpiHeroSizesPx, and so does every
 * target without panel sizes.
 */
export function panelHeroSizesPx(target: RenderTarget, resolvedMTitlePx: number, canvasWidthPx: number, textScale = 1): { preferred: number; minimum: number } {
  const table = TARGET_TYPE_TABLES[target];
  if (!table.panelHero) return kpiHeroSizesPx(target, resolvedMTitlePx, textScale);
  const px = (size: number) => scaleTextAtFloor(toLayoutPx(size, table.unit), textScale, toLayoutPx(table.panelHero!.narrow, table.unit));
  return { preferred: px(canvasWidthPx >= 720 ? table.panelHero.wide : table.panelHero.narrow), minimum: px(table.panelHero.narrow) };
}

export function naturalOutputSize(target: RenderTarget, sizePx: Size): PresentationInfo['naturalSize'] {
  return target === 'slide' || target === 'print'
    ? { width: sizePx.width * 72 / 96, height: sizePx.height * 72 / 96, unit: 'pt' }
    : { ...sizePx, unit: 'px' };
}

/** Internal constraints survive option spreads without adding a public JSON key. */
export const TARGET_SIZE = Symbol('targetSize');
export type TargetSizeOptions = { [TARGET_SIZE]?: ResolvedTargetSize };
