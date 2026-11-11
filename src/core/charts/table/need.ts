/**
 * What a table needs at one width, from its content: the rung of the fit ladder that holds,
 * the tracks it draws, its air and its size advice. Render, measure and the React grid read this one answer.
 */
import { COMPACT_RETRY, HEAD_AIR_MIN, HEAD_LINES, HEAD_LOOSE, TIGHT_SPACING, executeTableFit, type FitLayout, type RunTableCandidate, type TableCandidate } from './fitPolicy';
import { tightAdvice } from '../tableFit';
import type { Id } from '../../types/cell';
import type { Geometry, LintWarning } from '../../types/scene';
import type { ResolvedTable, TableData, TableDerived, TableOptions } from '../../types/table';
import type { TableMarks } from './layout';
import { tableWidths, type TableWidthPlan, type TableWidthView, type WidthOptions } from './widths';
import type { TextMeasurer } from '../../text';
import { SORT_BUTTON_MIN } from './tracks';
import type { Theme } from '../../types/theme';

type TableGeometry = Geometry<TableMarks, TableDerived>;

/**
 * The rungs of the fit ladder: the full table, 12 px side margins, the head at its least air,
 * less cell air (with heads on two lines where `headLines` is 2), the compact density, and the
 * compact density at tight spacing.
 */
export type TableRung = 'full' | 'gutter' | 'head-air' | 'cell-air' | 'compact' | 'tight';

/** A size a warning advises in its patch. */
export type TableAdvice = { width: number; height?: number };

/**
 * The SVG table's surface: a frame the table cannot scroll in, so the table steps down the
 * fit ladder before it refuses. `run` lays out one rung; the rest is what the ladder reads.
 */
export interface TableFrameSurface<G extends FitLayout = TableGeometry> {
  /** The authored data, for the compact rung's spacers and indents. */
  data: TableData;
  /** The options of this frame: size, target and the frame-only markers. */
  options: TableOptions;
  run: RunTableCandidate<G>;
  /** The cell texts a rung cut. */
  cutCount: (geometry: G) => number;
  /** Whether the theme gives the head or group row more than its least air. */
  hasHeadAir: (options: TableOptions) => boolean;
  /** Measurement keeps the compact floor of a rung it did not select. */
  preserveCompactFloor: boolean;
  /** The cell air a rung's layout drew. */
  cellPadOf: (geometry: G) => number;
}

/**
 * A host that scrolls (the React grid): it keeps authored tracks, draws the full rung and scrolls
 * where the table is wider. `view` carries what the host adds: sortable columns and their chevron
 * room, tree marks, the default columns of its toggles, the slack of its measurer.
 */
export interface TableScrollSurface {
  scroll: true;
  theme: Theme;
  measure: TextMeasurer;
  options: WidthOptions;
  /** The tracks' room is `view.available`; the host's side margins are around it. */
  view: TableWidthView;
  margins: { left: number; right: number };
  /**
   * The theme and plot width of another frame width. The overflow advice is checked at the type
   * class of the width it names; without it the advice stands unchecked.
   */
  at?: (width: number) => { theme: Theme; available: number; scrollBox?: TableWidthView['scrollBox'] };
}

export interface TableNeed {
  rung: TableRung;
  /** Each drawn column's track, in drawing order. */
  tracks: { id: Id; width: number }[];
  cellPadX: number;
  /** The frame's side margins around the grid. */
  margins: { left: number; right: number };
  headLines: number;
  /** The narrowest frame that draws every column at this rung, and the frame its tracks take before fitting. */
  minWidth: number;
  naturalWidth: number;
  /** The frame height at this width; a host whose rows set its height has none. */
  height: number | undefined;
  warnings: LintWarning[];
  /** The size the overflow or tight-spacing warning advises, as its patch names it. */
  advice: TableAdvice | undefined;
  /** The drawn layout of the rung, scene and all. */
  geometry: TableGeometry;
}

/** The rung of the fit ladder that holds, with the layout it selected. */
export interface TableRungChoice<G extends FitLayout = TableGeometry> {
  rung: TableRung;
  cellPadX: number;
  headLines: number;
  /** The selected rung's layout before it is drawn: no scene yet, and none of the warnings the drawing adds. */
  undrawn: G;
}

/** The ladder that holds for a resolved table on its surface, at the frame its options name. */
export function tableRung<G extends FitLayout = TableGeometry>({ table, surface }: { table: ResolvedTable; surface: TableFrameSurface<G> }): TableRungChoice<G> {
  const rungs = new WeakMap<G, TableCandidate>();
  let fullPad: number | undefined;
  const run: RunTableCandidate<G> = (candidate, ...rest) => {
    const geometry = surface.run(candidate, ...rest);
    rungs.set(geometry, candidate);
    fullPad ??= surface.cellPadOf(geometry);
    return geometry;
  };
  const undrawn = executeTableFit(surface.data, surface.options, table, surface.preserveCompactFloor, run, surface.cutCount, surface.hasHeadAir);
  const candidate = rungs.get(undrawn) ?? {};
  const cellPadX = surface.cellPadOf(undrawn);
  return { rung: rungOf(candidate, cellPadX < fullPad!), cellPadX, headLines: candidate[HEAD_LINES] ?? 1, undrawn };
}

/** The need a chosen rung answers, read from its drawn layout: the drawing adds warnings (text on an authored ground). */
export function tableNeed(choice: TableRungChoice, drawn: TableGeometry): TableNeed {
  const { size, plot, sizing, marks, warnings } = drawn;
  return {
    rung: choice.rung, cellPadX: choice.cellPadX, headLines: choice.headLines,
    tracks: marks.columns.map((column) => ({ id: column.id, width: column.w })),
    margins: { left: plot.x, right: size.width - plot.x - plot.w },
    minWidth: sizing?.minWidth ?? size.width,
    naturalWidth: sizing?.naturalWidth ?? size.width,
    height: size.height,
    warnings,
    advice: advisedSize(warnings),
    geometry: drawn,
  };
}

function rungOf(candidate: TableCandidate, lessAir: boolean): TableRung {
  if (candidate[TIGHT_SPACING] !== undefined) return 'tight';
  if (candidate[COMPACT_RETRY] !== undefined) return 'compact';
  if (candidate[HEAD_AIR_MIN]) return 'head-air';
  if (lessAir || candidate[HEAD_LINES] !== undefined) return 'cell-air';
  return candidate.margin === undefined ? 'full' : 'gutter';
}

/** The size the tight-spacing or overflow patch names. */
function advisedSize(warnings: readonly LintWarning[]): TableAdvice | undefined {
  const overflow = warnings.find((warning) => warning.code === 'table-overflow')?.fix?.[0];
  return tightAdvice(warnings.find((warning) => warning.code === 'table-tight-spacing'))
    ?? (overflow !== undefined && 'value' in overflow ? overflow.value as TableAdvice : undefined);
}

/** The overflow a scrolling host reports, checked at each width it advises until one holds. */
const ADVICE_PASSES = 3;

/** What a table needs in a host that scrolls: the full rung's tracks, and an overflow advice checked at the width it names. */
export function tableScrollNeed({ table, surface }: { table: ResolvedTable; surface: TableScrollSurface }): Omit<TableNeed, 'geometry'> & { plan: TableWidthPlan } {
  const { theme, measure, options, view, at } = surface;
  const plan = tableWidths(table, theme, measure, options, { ...view, scroll: true });
  const warnings = at === undefined ? plan.warnings : plan.warnings.map((warning) => warning.code === 'table-overflow' ? checkedOverflow(warning, (width) => {
    const frame = at(width);
    const size = { ...overflowSize(warning)!, width };
    return tableWidths(table, frame.theme, measure, { ...options, size }, { ...view, scroll: true, available: frame.available, scrollBox: frame.scrollBox })
      .warnings.find((next) => next.code === 'table-overflow');
  }) : warning);
  const sides = surface.margins.left + surface.margins.right;
  return {
    rung: 'full', tracks: plan.tracks.map(({ id, width }) => ({ id, width })), cellPadX: plan.cellPadX,
    margins: surface.margins, headLines: 1,
    // The host draws every track at its natural width and scrolls under it.
    minWidth: Math.ceil(plan.tracks.reduce((sum, track) => sum + track.natural, plan.spacerTotal)) + sides,
    naturalWidth: Math.ceil(plan.totalW) + sides,
    height: undefined, warnings, advice: overflowSize(warnings.find((warning) => warning.code === 'table-overflow')), plan,
  };
}

/** A scrolling host's need on the rung it draws, with that rung's density. */
export type TableScrollRungNeed = ReturnType<typeof tableScrollNeed> & { density: TableOptions['density'] };

/** One rung laid out with a scrolling host's tracks: the plan it draws, and whether it fits the box that scrolls. */
interface ScrollRung extends FitLayout {
  plan: TableWidthPlan;
  candidate: TableCandidate;
  fits: boolean;
}

/**
 * A host that scrolls takes a tighter rung of the fit ladder only where that rung ends the sideways
 * scroll. Each rung is laid out with the host's own tracks (sort chevrons, tree marks, its measurer) and
 * fits where it raises no overflow in the same scroll box. A table that fits at full spacing keeps that
 * answer; a table no rung fits keeps the full rung and scrolls, with the full rung's overflow advice.
 */
export function tableScrollRung({ table, data, surface }: { table: ResolvedTable; data: TableData; surface: TableScrollSurface }): TableScrollRungNeed {
  const full = { ...tableScrollNeed({ table, surface }), density: surface.options.density };
  const available = surface.view.available;
  if (available === undefined || !full.warnings.some((warning) => warning.code === 'table-overflow')) return full;
  const { theme, measure, view, margins: sides } = surface;
  const host = available + sides.left + sides.right;
  const box = view.scrollBox?.width ?? available;
  const run: RunTableCandidate<ScrollRung> = (candidate) => {
    const left = candidate.margin?.left ?? sides.left;
    // The grid keeps the host's margins and fills its tracks into this room, so a rung's room never runs past the box.
    const room = Math.min(host - left - (candidate.margin?.right ?? sides.right), box);
    const plan = tableWidths(table, theme, measure, {
      ...surface.options,
      ...(candidate.density === undefined ? {} : { density: candidate.density }),
      ...(candidate.cellPadX === undefined ? {} : { cellPadX: candidate.cellPadX }),
      ...(candidate.labelIndent === undefined ? {} : { labelIndent: candidate.labelIndent }),
    }, { ...view, scroll: true, available: room, headLines: candidate[HEAD_LINES], headGlue: candidate[HEAD_LOOSE] !== true });
    // A rung fits on the tracks the grid draws, after the frame fill, where each sort button keeps its least width
    // inside the cell's air and its group dividers. A hidden column draws a 0 px track and no button.
    const drawn = plan.tracks.reduce((sum, track) => sum + track.width, plan.spacerTotal);
    const sortRoom = (track: { id: Id; width: number }) => track.width === 0 || !view.sortable?.has(track.id)
      || track.width - plan.cellPadX - (view.groupStart?.has(track.id) ? 1 : 0) - (view.groupEnd?.has(track.id) ? 1 : 0) >= SORT_BUTTON_MIN;
    const fits = !plan.warnings.some((warning) => warning.code === 'table-overflow') && drawn <= box && plan.tracks.every(sortRoom);
    return {
      size: { width: host, height: 0 }, plot: { x: left, w: room },
      sizing: { minWidth: fits ? host : host + Math.max(1, Math.ceil(drawn - box)), minHeight: 0 },
      marks: { columns: plan.tracks }, warnings: [...plan.warnings], plan, candidate, fits,
    };
  };
  // The host's tree toggles stand where outline marks stand, so the compact and tight rungs keep their indent.
  const options: TableOptions = { ...surface.options, size: { width: host }, ...(view.withMarks ? { outlineMarks: true } : {}) };
  const choice = tableRung({ table, surface: { data, options, run, cutCount: () => 0, hasHeadAir: () => false, preserveCompactFloor: false, cellPadOf: (rung) => rung.plan.cellPadX } });
  const { plan, candidate, fits, plot } = choice.undrawn;
  // Tighter spacing that still scrolls costs the reader both: the full rung scrolls instead.
  if (!fits) return full;
  return {
    ...full, rung: choice.rung, cellPadX: plan.cellPadX, headLines: choice.headLines, margins: { left: plot.x, right: host - plot.x - plot.w },
    plan, warnings: plan.warnings, advice: undefined, density: candidate.density ?? surface.options.density,
  };
}

function overflowSize(warning: LintWarning | undefined): TableAdvice | undefined {
  const op = warning?.fix?.[0];
  return op !== undefined && 'value' in op ? op.value as TableAdvice : undefined;
}

/**
 * The type steps up at 720 and 1080 px, so a frame the advice names can draw larger type and
 * overflow again. The advice moves to the width that holds; where none settles, it keeps no patch.
 */
function checkedOverflow(warning: LintWarning, overflowAt: (width: number) => LintWarning | undefined): LintWarning {
  const asked = overflowSize(warning);
  if (asked === undefined) return warning;
  let width = asked.width;
  for (let pass = 0; pass < ADVICE_PASSES; pass++) {
    const next = overflowSize(overflowAt(width));
    if (next === undefined) {
      if (width === asked.width) return warning;
      const swap = (text: string) => text.replaceAll(`${asked.width} px`, `${width} px`);
      return { ...warning, message: swap(warning.message), ...(warning.suggest === undefined ? {} : { suggest: swap(warning.suggest) }),
        detail: { ...warning.detail, naturalWidth: width }, fix: [{ op: 'add', path: '/options/size', value: { ...asked, width } }] };
    }
    width = next.width;
  }
  const { fix: _unsettled, ...rest } = warning;
  return { ...rest, suggest: 'No frame width was found at which the table fits without scrolling. Reduce the content or change the table settings.' };
}
