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

/**
 * One step down to a panel: a panel of a list, by id and index, a slice of a grid template, by the id of the panel it
 * builds and its key, or the template of a repeat with no slices of its own, which stands for every panel it builds.
 */
export type WidthStep = { id: string; index: number } | { id: string; slice: string } | 'template';

/** The authored path of a step list. A slice is a grid level itself, so the step after it has no `data` of its own. */
const widthStepField = (path: readonly WidthStep[]): (string | number)[] => path.flatMap((step, at) => {
  const previous = path[at - 1];
  const entry = previous !== undefined && previous !== 'template' && 'slice' in previous ? [] : ['data'];
  if (step === 'template') return [...entry, 'template'];
  return 'slice' in step ? [...entry, 'template', 'data', 'bySlice', step.slice] : [...entry, 'panels', step.index];
});

/** The authored overrides of one chart: the chart itself, or a panel of a grid at any depth, which `path` leads to. */
export interface WidthGroup {
  overrides: Readonly<Record<string, ColumnOverride>>;
  path?: readonly WidthStep[];
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
  groups.forEach(({ overrides, path = [] }, at) => {
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
        field: [...widthStepField(path), 'options', 'columnOverrides', id, 'width'],
        message: `${path.flatMap((step) => (step === 'template' ? [] : [`[${step.id}] `])).join('')}columnOverrides.${id}.width ${width} does not draw on this canvas, so ${where}`,
        suggest: seat === undefined ? `Remove columnOverrides.${id}.width, or give the chart more room.` : `Set columnOverrides.${id}.width to ${seat}, or give the chart more room.`,
      });
    }
  });
  return { overrides: held, warnings, moved };
}

const staleWidthWarning = (warning: LintWarning, columns: readonly string[], path: readonly WidthStep[] = []) => {
  if (!WIDTH_WARNINGS.has(warning.code)) return false;
  // A grid prefixes each warning with the id of the panel it came from, at every depth. A repeat's panels take their ids from its slices.
  let text = warning.message;
  for (const step of path) {
    const prefix = step === 'template' ? text.slice(0, text.indexOf('] ') + 2) : `[${step.id}] `;
    if (prefix.length < 3 || prefix[0] !== '[' || !text.startsWith(prefix)) return false;
    text = text.slice(prefix.length);
  }
  return columns.some((id) => text.startsWith(`columnOverrides.${id}.`));
};

/** Replaces what a tried width warned with what the author's own width did. */
export function movedWidthWarnings(warnings: readonly LintWarning[], fit: MovedWidths): LintWarning[] {
  return [...warnings.filter((warning) => !staleWidthWarning(warning, fit.moved[0]!)), ...fit.warnings];
}

interface PanelChart { geometry: GridLevel; warningOffset?: number }
interface GridLevel { warnings: LintWarning[]; marks: unknown }
interface StaleWidths { path: readonly WidthStep[]; columns: readonly string[] }

/**
 * The warnings a tried width left, gone from this level's list and from every level under it. Each list holds its
 * panels' lists as ranges that repainting a panel replaces, so each later range moves back by what left before it.
 */
function withoutStaleWidths<G extends GridLevel>(level: G, stale: readonly StaleWidths[]): G {
  const leaving = level.warnings.flatMap((warning, index) => (stale.some(({ path, columns }) => staleWidthWarning(warning, columns, path)) ? [index] : []));
  const marks = level.marks as { panels?: { id: string; chart?: PanelChart }[] } | undefined;
  const panels = marks?.panels?.map((panel) => {
    const chart = panel.chart;
    if (chart?.warningOffset === undefined) return panel;
    const offset = chart.warningOffset;
    const below = stale.flatMap(({ path, columns }) => {
      const [step, ...rest] = path;
      return step !== undefined && (step === 'template' || step.id === panel.id) ? [{ path: rest, columns }] : [];
    });
    return { ...panel, chart: { ...chart,
      warningOffset: offset - leaving.filter((index) => index < offset).length,
      geometry: below.length > 0 ? withoutStaleWidths(chart.geometry, below) : chart.geometry } };
  });
  return { ...level, ...(panels ? { marks: { ...marks, panels } } : {}), warnings: level.warnings.filter((_, index) => !leaving.includes(index)) };
}

/** The same for a grid at any depth. What the author's widths did joins the outermost list after all the ranges, so a repaint leaves it alone. */
export function movedGridWarnings<G extends GridLevel>(grid: G, groups: readonly WidthGroup[], fit: MovedWidths): G {
  const stale = groups.flatMap((group, at) => (fit.moved[at]!.length > 0 ? [{ path: group.path ?? [], columns: fit.moved[at]! }] : []));
  const kept = withoutStaleWidths(grid, stale);
  return { ...kept, warnings: [...kept.warnings, ...fit.warnings] };
}
