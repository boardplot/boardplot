import { parseFormatExample, sameUnit, unitOfSpec } from '../../formatSpec';
import type { LabelContent, LabelKind, PieOptions } from '../../types/options';

/** Most slices a pie without a legend labels outside, all of them. */
const OUTSIDE_ALL_MAX = 8;

/**
 * Up to four slices name themselves outside the rim (eight without a legend). Above four the names
 * inside the slices go to the legend, so a pie without one keeps the name in
 * every label: a slice no text names is a colour the reader cannot read.
 * An outside label keeps its name either way: a small slice's swatch is the
 * one a reader cannot match to a key.
 */
export function pieLabelContent(options: PieOptions, displayedCount: number, legendDrawn: boolean) {
  const settings = options.labels;
  const kindSetting = (kind: LabelKind): boolean | LabelContent =>
    settings === false ? false : settings?.[kind] ?? true;
  // Without a legend, up to eight slices all name themselves outside in two
  // label columns, so no slice needs a key.
  const outsideCount = !legendDrawn ? OUTSIDE_ALL_MAX : 4;
  const preferOutside = displayedCount <= outsideCount && settings !== false &&
    settings?.insidePie === undefined && settings?.outsidePie !== false &&
    !Object.keys(options.labelPlacements ?? {}).some((id) => id.startsWith('insidePie:'));
  const contentOf = (kind: LabelKind, fallback: LabelContent): LabelContent | null => {
    const setting = kindSetting(kind);
    return setting === false ? null : Array.isArray(setting) ? setting : fallback;
  };
  const named = settings !== false && settings?.category !== false;
  const outsideDefault: LabelContent = named ? ['category', 'absolute', 'percent'] : ['absolute', 'percent'];
  const insideDefault: LabelContent = named && !legendDrawn
    ? ['category', 'absolute', 'percent'] : ['absolute', 'percent'];
  return {
    kindSetting,
    insideContent: preferOutside ? null : contentOf('insidePie', insideDefault),
    outsideContent: contentOf('outsidePie', outsideDefault),
  };
}

/** Keep authored number formatting; the separate unit line does not rescale values. */
export function pieCenterLines(formatted: string, unit?: string, format?: string): string[] {
  if (!unit?.trim()) return [formatted];
  const spec = format ? parseFormatExample(format) : undefined;
  const formattedUnit = spec && (unitOfSpec(spec) ?? spec.suffix.trim());
  return formattedUnit && sameUnit(formattedUnit, unit)
    ? [formatted] : [formatted, unit];
}
