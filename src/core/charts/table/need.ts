/**
 * What a table needs at one width, from its content: the rung of the fit ladder that holds,
 * the tracks it draws, its air and its size advice. Render, measure and the React grid read this one answer.
 */
import { COMPACT_RETRY, HEAD_AIR_MIN, HEAD_LINES, TIGHT_SPACING, executeTableFit, type RunTableCandidate, type TableCandidate } from './fitPolicy';
import { tightAdvice } from '../tableFit';
import type { Id } from '../../types/cell';
import type { Geometry, LintWarning } from '../../types/scene';
import type { ResolvedTable, TableData, TableDerived, TableOptions } from '../../types/table';
import type { TableMarks } from './layout';
import { tableWidths, type TableWidthPlan, type TableWidthView, type WidthOptions } from './widths';
import type { TextMeasurer } from '../../text';
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
export interface TableFrameSurface {
  /** The authored data, for the compact rung's spacers and indents. */
  data: TableData;
  /** The options of this frame: size, target and the frame-only markers. */
  options: TableOptions;
  run: RunTableCandidate;
  /** The cell texts a rung cut. */
  cutCount: (geometry: TableGeometry) => number;
  /** Whether the theme gives the head or group row more than its least air. */
  hasHeadAir: (options: TableOptions) => boolean;
  /** Measurement keeps the compact floor of a rung it did not select. */
  preserveCompactFloor: boolean;
  /** The cell air a rung's layout drew. */
  cellPadOf: (geometry: TableGeometry) => number;
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
  at?: (width: number) => { theme: Theme; available: number };
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
  geometry: TableGeometry;
}

/** The ladder that holds for a resolved table on its surface, at the frame its options name. */
export function tableNeed(input: { table: ResolvedTable; surface: TableFrameSurface }): TableNeed;
export function tableNeed(input: { table: ResolvedTable; surface: TableScrollSurface }): Omit<TableNeed, 'geometry'> & { plan: TableWidthPlan };
export function tableNeed({ table, surface }: { table: ResolvedTable; surface: TableFrameSurface | TableScrollSurface }): TableNeed | Omit<TableNeed, 'geometry'> & { plan: TableWidthPlan } {
  if ('scroll' in surface) return scrollNeed(table, surface);
  const rungs = new WeakMap<TableGeometry, TableCandidate>();
  let fullPad: number | undefined;
  const run: RunTableCandidate = (candidate, ...rest) => {
    const geometry = surface.run(candidate, ...rest);
    rungs.set(geometry, candidate);
    fullPad ??= surface.cellPadOf(geometry);
    return geometry;
  };
  const geometry = executeTableFit(surface.data, surface.options, table, surface.preserveCompactFloor, run, surface.cutCount, surface.hasHeadAir);
  const candidate = rungs.get(geometry) ?? {};
  const cellPadX = surface.cellPadOf(geometry);
  const { size, plot, sizing, marks, warnings } = geometry;
  return {
    rung: rungOf(candidate, cellPadX < fullPad!),
    tracks: marks.columns.map((column) => ({ id: column.id, width: column.w })),
    cellPadX,
    margins: { left: plot.x, right: size.width - plot.x - plot.w },
    headLines: candidate[HEAD_LINES] ?? 1,
    minWidth: sizing?.minWidth ?? size.width,
    naturalWidth: sizing?.naturalWidth ?? size.width,
    height: size.height,
    warnings,
    advice: advisedSize(warnings),
    geometry,
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

function scrollNeed(table: ResolvedTable, surface: TableScrollSurface): Omit<TableNeed, 'geometry'> & { plan: TableWidthPlan } {
  const { theme, measure, options, view, at } = surface;
  const plan = tableWidths(table, theme, measure, options, { ...view, scroll: true });
  const warnings = at === undefined ? plan.warnings : plan.warnings.map((warning) => warning.code === 'table-overflow' ? checkedOverflow(warning, (width) => {
    const frame = at(width);
    const size = { ...overflowSize(warning)!, width };
    return tableWidths(table, frame.theme, measure, { ...options, size }, { ...view, scroll: true, available: frame.available })
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
