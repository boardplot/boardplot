import type { RenderTarget } from './types/options';
import type { TypographyRole } from './types/scene';
import { DEFAULT_TARGET, scaleTextPx, targetFloorsPx, textSizeScale, TEXT_SCALE_RANGE, TEXT_SIZE_RANGE } from './target';
import { NormalizeError } from './normalize/shared';

/** No label a reader needs is under 9 px at the exhibit's own frame size and scale 1. */
export const READER_LABEL_MIN_PX = 9;

/** The target's floor for native reader text. A `textScale` above 1 raises the floor with the text. */
export function readerFloorPx(target: RenderTarget, role: TypographyRole = 'label', textScale = 1): number {
  return targetFloorsPx(target, textScale)[role];
}

/** The scene parts a table draws its column and group heads in, wherever the table is drawn (a grid panel, a dimension switch). */
export const TABLE_HEAD_PARTS: ReadonlySet<string> = new Set(['tableHeader', 'tableHeaderSub', 'tableGroupHeader']);

/** Table headers sit two pixels below the body floor. */
export function tableHeadFloorPx(target: RenderTarget, textScale = 1): number {
  textScale = Math.max(1, textScale);
  // The report and slide footnote floors are 11 px, as the footer draws 11 px; a table head keeps its 12 px floor (the head is data, not a footer).
  const footerFree = target === 'report' || target === 'slide' ? scaleTextPx(12, textScale) : 0;
  return Math.max(targetFloorsPx(target, textScale).footnote, footerFree, targetFloorsPx(target, textScale).label - scaleTextPx(2, textScale));
}

/**
 * The chart's `textSize` option in layout px, or undefined when absent. A
 * value outside 6 to 32 is refused here, so a TypeScript caller that skips
 * the JSON schema gets the same answer as a spec. `textSize` and `textScale`
 * together are refused.
 */
export function textSizeOf(options: unknown): number | undefined {
  // Hot path: every layout reads this many times, almost always without a textSize.
  const value = (options as { textSize?: unknown } | undefined)?.textSize;
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !(value >= TEXT_SIZE_RANGE.min && value <= TEXT_SIZE_RANGE.max)) {
    throw new NormalizeError('invalid-text-size', 'options.textSize', 'textSize must be a number from 6 to 32 (px)', 'use 13 for the sizes of a wide report chart')
  }
  if ((options as { textScale?: unknown }).textScale !== undefined) {
    throw new NormalizeError('text-size-and-scale', 'options.textSize', 'textSize and textScale cannot be used together', 'keep one: textSize for equal text across charts, textScale to scale the width-class sizes')
  }
  return value;
}

/**
 * The chart's text factor (1 when absent). `textScale` is the option itself.
 * `textSize` is the factor that puts the primary label at that size in the
 * middle width column; the theme holds every width class to that column
 * (`resolveTargetTheme`). A `textScale` outside 0.5 to 2.5 is refused here,
 * so a TypeScript caller that skips the JSON schema gets the same answer as a spec.
 */
export function textScaleOf(options: unknown): number {
  const size = textSizeOf(options);
  if (size !== undefined) return textSizeScale((options as { target?: RenderTarget }).target ?? DEFAULT_TARGET, size);
  const value = (options as { textScale?: unknown } | undefined)?.textScale;
  if (value === undefined) return 1;
  if (typeof value !== 'number' || !(value >= TEXT_SCALE_RANGE.min && value <= TEXT_SCALE_RANGE.max)) {
    throw new NormalizeError('invalid-text-scale', 'options.textScale', `textScale must be a number from ${TEXT_SCALE_RANGE.min} to ${TEXT_SCALE_RANGE.max}`, 'use 1 for the target sizes, 1.25 for text 25 % larger')
  }
  return value;
}
/** Internal grid layout constraint; never a public chart option. */
export const KPI_VALUE_SIZE = Symbol('kpiValueSize');
/** The text a grid prints around a kpi panel (its title and caption, the grid's title, subtitle and notes): a unit there counts as shown. */
export const KPI_HOST_TEXT = Symbol('kpiHostText');
