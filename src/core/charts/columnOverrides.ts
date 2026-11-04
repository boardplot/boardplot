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
      code: 'generated-column-width-floored', severity: 'warn', field: ['options', 'columnOverrides', id, 'width'],
      message: `columnOverrides.${id}.width ${authored} is under the ${Math.ceil(floor)} px this column needs, so the column keeps ${Math.ceil(floor)} px`,
      suggest: `Set columnOverrides.${id}.width to ${Math.ceil(floor)} or more.`,
    });
    return floor;
  }
  if (authored > room) {
    const width = Math.max(floor, room);
    pushOnce(warnings, {
      code: 'generated-column-width-capped', severity: 'warn', field: ['options', 'columnOverrides', id, 'width'],
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

/** The types whose authored widths give way before a chart refuses. */
export const TRACK_WIDTH_TYPES: ReadonlySet<string> = new Set(['bullet', 'dot', 'likert', 'butterfly', 'slope', 'kpi', 'pyramid', 'box', 'funnel', 'bar']);

const WIDTH_WARNINGS: ReadonlySet<string> = new Set(['generated-column-width-capped', 'generated-column-width-floored']);

/** Widths to try after `authored` failed, nearest first: half and double, in turn, up to the canvas. */
function nearbyWidths(authored: number, canvasW: number): number[] {
  const tries: number[] = [];
  for (let factor = 2; authored / factor >= 1 || authored * factor <= canvasW; factor *= 2) {
    if (authored / factor >= 1) tries.push(Math.floor(authored / factor));
    if (authored * factor <= canvasW) tries.push(Math.ceil(authored * factor));
  }
  return tries;
}

/**
 * The overrides that draw on a canvas where the authored ones refuse, with the warnings that say what moved.
 * A width changes how many lines the names take, so on a fixed height it can raise the floor. Each width
 * stays if it can, else takes the nearest width that draws, else goes back to unset. `undefined` means the
 * chart refuses with every width unset too, so no width is the cause. Only the refusal path pays for these layouts.
 */
export function widthsThatDraw(overrides: Readonly<Record<string, ColumnOverride>>, canvasW: number, draws: (overrides: Record<string, ColumnOverride>) => boolean): { overrides: Record<string, ColumnOverride>; warnings: LintWarning[]; moved: readonly string[] } | undefined {
  const authored = Object.entries(overrides).flatMap(([id, override]) => (override.width === undefined ? [] : [[id, override.width] as const]));
  if (authored.length === 0) return undefined;
  const held: Record<string, ColumnOverride> = { ...overrides };
  for (const [id] of authored) { const { width: _width, ...rest } = held[id]!; held[id] = rest; }
  if (!draws(held)) return undefined;
  const warnings: LintWarning[] = [];
  const moved: string[] = [];
  const withWidth = (id: string, width: number) => ({ ...held, [id]: { ...held[id]!, width } });
  for (const [id, width] of authored) {
    if (draws(withWidth(id, width))) { held[id] = { ...held[id]!, width }; continue; }
    const seat = nearbyWidths(width, canvasW).find((nearby) => draws(withWidth(id, nearby)));
    if (seat !== undefined) held[id] = { ...held[id]!, width: seat };
    moved.push(id);
    const wide = seat === undefined ? width > canvasW / 4 : seat < width;
    const where = seat === undefined ? 'the column keeps its unset width' : `the column takes ${seat} px`;
    warnings.push({
      code: wide ? 'generated-column-width-capped' : 'generated-column-width-floored', severity: 'warn', field: ['options', 'columnOverrides', id, 'width'],
      message: `columnOverrides.${id}.width ${width} does not draw on this canvas, so ${where}`,
      suggest: seat === undefined ? `Remove columnOverrides.${id}.width, or give the chart more room.` : `Set columnOverrides.${id}.width to ${seat}, or give the chart more room.`,
    });
  }
  return { overrides: held, warnings, moved };
}

/** Replaces what a tried width warned with what the author's own width did. */
export function movedWidthWarnings(warnings: readonly LintWarning[], moved: { warnings: readonly LintWarning[]; moved: readonly string[] }): LintWarning[] {
  const replaced = (warning: LintWarning) => WIDTH_WARNINGS.has(warning.code) && moved.moved.includes(String(warning.field?.[2]));
  return [...warnings.filter((warning) => !replaced(warning)), ...moved.warnings];
}
