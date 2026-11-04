/**
 * The reader side of `columnOverrides` and `columnOrder` for the types that
 * lay out their own tracks: which authored settings take effect on this draw,
 * how wide a track gets, and where a text sits in it. Ids and warnings come
 * from schema/generatedColumns.ts, the zod-free list these layouts may import.
 */
import { generatedIdWarnings, type GeneratedColumnType } from '../schema/generatedColumns';
import type { ColumnAlign, ColumnOverride } from '../types/options';
import type { LintWarning } from '../types/scene';

/** The least a plot keeps beside an authored track: 80 px, or 40% of the width the tracks share. */
export function trackPlotFloor(sharedW: number): number {
  return Math.max(80, sharedW * 0.4);
}

function pushOnce(warnings: LintWarning[], warning: LintWarning): void {
  if (!warnings.some((old) => old.code === warning.code && old.message === warning.message)) warnings.push(warning);
}

/**
 * What the authored overrides warn on one draw. `drawn` holds the tracks this
 * form draws, `headed` the ones with a head. A head setting on a track with no
 * head warns, because nothing else tells the author it did nothing.
 */
export function columnOverrideWarnings(type: GeneratedColumnType, overrides: Readonly<Record<string, ColumnOverride>> | undefined, drawn: readonly string[], headed: readonly string[], warnings: LintWarning[]): void {
  if (overrides === undefined) return;
  for (const warning of generatedIdWarnings(type, 'columnOverrides', overrides, drawn)) pushOnce(warnings, warning);
  for (const [id, override] of Object.entries(overrides)) {
    if (!drawn.includes(id) || headed.includes(id) || (override.label === undefined && override.headAlign === undefined)) continue;
    pushOnce(warnings, {
      code: 'column-override-no-head', severity: 'warn', field: ['options', 'columnOverrides', id],
      message: `columnOverrides.${id} sets a head, but this ${type} prints no head over '${id}', so label and headAlign changed nothing`,
      suggest: `Remove label and headAlign from columnOverrides.${id}.`,
    });
  }
}

/**
 * The width of one authored track. A width under what the track must hold keeps
 * that floor, and a width over `room` stops there, so the plot keeps its floor.
 * Each says so in a warning, and neither refuses.
 */
export function authoredTrackWidth(id: string, authored: number, floor: number, room: number, warnings: LintWarning[]): number {
  if (authored < floor) {
    pushOnce(warnings, {
      code: 'column-width-floored', severity: 'warn', field: ['options', 'columnOverrides', id, 'width'],
      message: `columnOverrides.${id}.width ${authored} is under the ${Math.ceil(floor)} px this column needs, so the column keeps ${Math.ceil(floor)} px`,
      suggest: `Set columnOverrides.${id}.width to ${Math.ceil(floor)} or more.`,
    });
    return floor;
  }
  if (authored > room) {
    const width = Math.max(floor, room);
    pushOnce(warnings, {
      code: 'column-width-capped', severity: 'warn', field: ['options', 'columnOverrides', id, 'width'],
      message: `columnOverrides.${id}.width ${authored} leaves the plot under its floor, so the column stops at ${Math.floor(width)} px`,
      suggest: `Set columnOverrides.${id}.width to ${Math.floor(width)} or less, or widen the chart.`,
    });
    return width;
  }
  return authored;
}

/** The left edge of a text `textW` wide in a track that starts at `left`. */
export function alignedLeft(left: number, trackW: number, textW: number, align: ColumnAlign): number {
  return align === 'left' ? left : align === 'right' ? left + trackW - textW : left + (trackW - textW) / 2;
}

/** The right edge of a text `textW` wide in a track that ends at `right`. */
export function alignedRight(right: number, trackW: number, textW: number, align: ColumnAlign): number {
  return alignedLeft(right - trackW, trackW, textW, align) + textW;
}

/** Whole blocks in the authored order: ids this form has, then the rest in default order. */
export function orderedBlocks<T extends string>(defaults: readonly T[], authored: readonly string[] | undefined): T[] {
  if (authored === undefined) return [...defaults];
  const listed = defaults.filter((id) => authored.includes(id)).sort((a, b) => authored.indexOf(a) - authored.indexOf(b));
  return [...listed, ...defaults.filter((id) => !listed.includes(id))];
}
