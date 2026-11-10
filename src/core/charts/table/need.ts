/**
 * What a table needs at one width, from its content: the rung of the fit ladder that holds,
 * the tracks it draws, its air and its size advice. Render and measure read this one answer.
 */
import { COMPACT_RETRY, HEAD_AIR_MIN, HEAD_LINES, TIGHT_SPACING, executeTableFit, type RunTableCandidate, type TableCandidate } from './fitPolicy';
import { tightAdvice } from '../tableFit';
import type { Id } from '../../types/cell';
import type { Geometry, LintWarning } from '../../types/scene';
import type { ResolvedTable, TableData, TableDerived, TableOptions } from '../../types/table';
import type { TableMarks } from './layout';

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
  /** The frame height at this width. */
  height: number;
  warnings: LintWarning[];
  /** The size the overflow or tight-spacing warning advises, as its patch names it. */
  advice: TableAdvice | undefined;
  geometry: TableGeometry;
}

/** The ladder that holds for a resolved table on its surface, at the frame its options name. */
export function tableNeed({ table, surface }: { table: ResolvedTable; surface: TableFrameSurface }): TableNeed {
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
