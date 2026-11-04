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

/** Widths to try after `authored` failed: half and double, in turn, up to the canvas. */
function nearbyWidths(authored: number, canvasW: number): number[] {
  const tries: number[] = [];
  for (let factor = 2; authored / factor >= 1 || authored * factor <= canvasW; factor *= 2) {
    if (authored / factor >= 1) tries.push(Math.floor(authored / factor));
    if (authored * factor <= canvasW) tries.push(Math.ceil(authored * factor));
  }
  return tries;
}

/** The authored overrides of one chart: the chart itself, or one panel of a grid, which `panel` names. */
export interface WidthGroup {
  overrides: Readonly<Record<string, ColumnOverride>>;
  panel?: { id: string; index: number };
}

export interface MovedWidths {
  overrides: Record<string, ColumnOverride>[];
  warnings: LintWarning[];
  /** The columns whose width moved, per group. */
  moved: readonly (readonly string[])[];
}

/**
 * The overrides that draw on a canvas where the authored ones refuse, with the warnings that say what moved.
 * A width changes how many lines the names take, so it can raise the height a chart needs. All the widths clear
 * together, then each comes back in turn: as authored if the chart draws, else at the first tested width that
 * draws, else it stays unset. `undefined` means the chart refuses with every width unset too, so no width is
 * the cause. Only the refusal path pays for these layouts.
 */
export function widthsThatDraw(groups: readonly WidthGroup[], canvasW: number, draws: (overrides: readonly Record<string, ColumnOverride>[]) => boolean): MovedWidths | undefined {
  const held = groups.map((group) => Object.fromEntries(Object.entries(group.overrides).map(([id, { width: _width, ...rest }]) => [id, rest as ColumnOverride])));
  if (!draws(held)) return undefined;
  const warnings: LintWarning[] = [];
  const moved: string[][] = groups.map(() => []);
  groups.forEach(({ overrides, panel }, at) => {
    const withWidth = (id: string, width: number) => held.map((group, index) => (index === at ? { ...group, [id]: { ...group[id]!, width } } : group));
    for (const [id, { width }] of Object.entries(overrides)) {
      if (width === undefined) continue;
      if (draws(withWidth(id, width))) { held[at]![id] = { ...held[at]![id]!, width }; continue; }
      const seat = nearbyWidths(width, canvasW).find((nearby) => draws(withWidth(id, nearby)));
      if (seat !== undefined) held[at]![id] = { ...held[at]![id]!, width: seat };
      moved[at]!.push(id);
      const wide = seat === undefined ? width > canvasW / 4 : seat < width;
      const where = seat === undefined ? 'the column keeps its unset width' : `the column takes ${seat} px`;
      warnings.push({
        code: wide ? 'generated-column-width-capped' : 'generated-column-width-floored', severity: 'warn',
        field: [...(panel ? ['data', 'panels', panel.index] : []), 'options', 'columnOverrides', id, 'width'],
        message: `${panel ? `[${panel.id}] ` : ''}columnOverrides.${id}.width ${width} does not draw on this canvas, so ${where}`,
        suggest: seat === undefined ? `Remove columnOverrides.${id}.width, or give the chart more room.` : `Set columnOverrides.${id}.width to ${seat}, or give the chart more room.`,
      });
    }
  });
  return { overrides: held, warnings, moved };
}

const staleWidthWarning = (warning: LintWarning, columns: readonly string[], prefix = '') =>
  WIDTH_WARNINGS.has(warning.code) && columns.some((id) => warning.message.startsWith(`${prefix}columnOverrides.${id}.`));

/** Replaces what a tried width warned with what the author's own width did. */
export function movedWidthWarnings(warnings: readonly LintWarning[], fit: MovedWidths): LintWarning[] {
  return [...warnings.filter((warning) => !staleWidthWarning(warning, fit.moved[0]!)), ...fit.warnings];
}

interface PanelChart { geometry: { warnings: LintWarning[] }; warningOffset?: number }

/**
 * The same for a grid, whose warnings hold each panel's as a range that repainting a panel replaces. A stale
 * warning leaves the panel's own list and the grid's, and each later range moves back by what left before it.
 */
export function movedGridWarnings<G extends { warnings: LintWarning[]; marks: unknown }>(grid: G, groups: readonly WidthGroup[], fit: MovedWidths): G {
  const stale = new Set<number>();
  const movedOf = groups.flatMap((group, at) => (group.panel && fit.moved[at]!.length ? [[group.panel.id, fit.moved[at]!] as const] : []));
  grid.warnings.forEach((warning, index) => { if (movedOf.some(([id, columns]) => staleWidthWarning(warning, columns, `[${id}] `))) stale.add(index); });
  const movedColumns = new Map(movedOf);
  const marks = grid.marks as { panels: { id: string; chart?: PanelChart }[] };
  const panels = marks.panels.map((panel) => {
    const chart = panel.chart;
    if (chart?.warningOffset === undefined) return panel;
    const offset = chart.warningOffset;
    const columns = movedColumns.get(panel.id) ?? [];
    return { ...panel, chart: { ...chart,
      warningOffset: offset - [...stale].filter((index) => index < offset).length,
      geometry: { ...chart.geometry, warnings: chart.geometry.warnings.filter((warning) => !staleWidthWarning(warning, columns)) } } };
  });
  return { ...grid, marks: { ...marks, panels }, warnings: [...grid.warnings.filter((_, index) => !stale.has(index)), ...fit.warnings] };
}
