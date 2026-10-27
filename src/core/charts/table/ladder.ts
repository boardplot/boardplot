/**
 * The level ladder: one derivation of the size, weight and air a
 * table row takes at its level, shared by the SVG layout and the HTML
 * stylesheet so both surfaces speak the same language. Every step comes from
 * `theme.type`; nothing here is a literal size.
 */

import { readerFloorPx, tableHeadFloorPx } from '../../typeFloors';
import { DEFAULT_TARGET, scaleTextPx, targetFloorsPx } from '../../target';
import type { RenderTarget } from '../../types/options';
import { tableEmphasis, microType } from '../../theme';
import type { Theme } from '../../types/theme';

export type TableDensity = 'compact' | 'regular' | 'relaxed' | 'cohort' | 'cohort-small';

/**
 * The two matrix tiers. A cohort grid has one level and a fixed
 * row pitch the reader scans across, so its rows do not step the ladder:
 * they take these heights and the type one (two) steps under the label.
 */
const COHORT_GRID: Record<'cohort' | 'cohort-small', { rowHeight: number; sizeStep: number }> = {
  cohort: { rowHeight: 26, sizeStep: -0.5 },
  'cohort-small': { rowHeight: 20, sizeStep: -1 },
};

/** True where the density is one of the fixed cohort grids. */
export function isCohortDensity(density: TableDensity): density is 'cohort' | 'cohort-small' {
  return density === 'cohort' || density === 'cohort-small';
}

/**
 * Every function here takes a RUNG, not an authored depth: `ResolvedRow.step`,
 * which skips the section headings and carries `options.levelOffset`.
 * Rung 0 is the KPI line a steering table prints
 * at 12/16 with 7 px of air.
 */
export interface LevelLadder {
  /** Resolved target. */
  target: RenderTarget;
  /** The chart's `textScale`: the ladder's floors and its size steps scale with it. */
  textScale: number;
  /** Type size of a row at this rung (rung 0 is the KPI line). */
  size: (level: number) => number;
  /** Emphasis on a parent row; the label role weight on a leaf. */
  weight: (level: number, hasChildren: boolean) => number;
  /**
   * Air above and below the line box. Extra air marks a group head only:
   * the top rung takes 7 px, a rung-1 row with children takes 7
   * (a group row, 30 px) and a rung-1 leaf 4 (the
   * sub rows of a steering table). From rung 2 down children add nothing,
   * so a Line with children measures 23 like its siblings and a Sub-line 21.
   */
  pad: (level: number, hasChildren: boolean) => number;
  /** Whole-pixel line box, so the grid and its rules stay crisp. */
  lineBox: (size: number) => number;
  /**
   * Type size of an inline line printed under a value. It is ONE step for
   * the whole table, not a rung of the ladder: the table prints every change
   * line and every share line at 10/13, whatever rung the row it hangs
   * under sits on.
   */
  inlineSize: () => number;
  /** Whole-pixel line box of an inline line. */
  inlineBox: (size: number) => number;
  /** Air between a value and the first line under it; the lines then stack. */
  inlineGap: number;
  /** Air above and below a total row. */
  totalPad: number;
  label: number;
  /**
   * Size of a total row's label. It is `label` except where the theme fixes
   * the type (`table.fixedType`) in a cohort grid: the closing row's label
   * then keeps the total face while the matrix cells take their step.
   */
  total: number;
  /** The column-head step: `table.head.size` where the theme sets it, else the axis role. */
  axis: number;
  /** Column-group heading step: one below the column header, floored at micro. */
  group: number;
  /**
   * Whole-pixel line box of a head face, the column head's and the group
   * head's: ceil(size x `table.head.lineHeight`, 1.33 by default),
   * the box the SVG reserves and the grid paints.
   */
  headBox: (size: number) => number;
  /** Whole-pixel line box of a section heading: `table.section.lineHeight`, else the row ratio. */
  sectionBox: (size: number) => number;
  micro: number;
  /** Fixed pitch of a matrix density; absent means the ladder's own air. */
  rowHeight?: number;
}

/** The line-height relation of the table rows: 12/16, 11/15, 10.5/14. */
export const LINE_RATIO = 1.33;
/**
 * Inline change lines sit tighter than the row they hang under: they
 * set at 10/13, which is the relation below and not the row ratio above.
 */
export const INLINE_LINE_RATIO = 1.3;
/**
 * The one gap between a value and the lines under it (2 px). It is paid ONCE per cell, whatever the cell
 * stacks under the figure: a note line, one change line or three.
 */
const INLINE_GAP = 2;
/** Air a cohort grid's closing row stands off the matrix by (4 px, twice). */
const CLOSER_STANDOFF = 8;

/**
 * The whole-pixel line box of `size` at `ratio`. A micro-pixel
 * comes off before rounding up, so a ratio written as 14 / 11 gives 14 and
 * not the 15 that 14.000000000000002 would; the grid writes the same
 * formula in CSS (`LINE_BOX_EPSILON`).
 */
export const LINE_BOX_EPSILON = 1e-6;
function lineBoxAt(size: number, ratio: number): number {
  return Math.ceil(size * ratio - LINE_BOX_EPSILON);
}

export function levelLadder(theme: Theme, density: TableDensity = 'regular', target: RenderTarget = DEFAULT_TARGET, textScale = 1): LevelLadder {
  const d = (px: number): number => scaleTextPx(px, textScale);
  const grid = isCohortDensity(density) ? COHORT_GRID[density] : undefined;
  const table = theme.table;
  // `table.fixedType`: a density changes air, never type. The
  // cohort grids keep their matrix step: it is the grid's own face.
  const sizeStep = d(grid ? grid.sizeStep : 0);
  const labelFloor = Math.min(theme.type.label.size, readerFloorPx(target, 'label', textScale));
  // A theme size under the head floor holds. Under a scale below 1 the theme already stopped each size at
  // its role floor (scaleTextAtFloor): a size still under that floor is the theme's own.
  const headFace = table?.head?.size ?? theme.type.axis.size;
  const ownHead = textScale < 1 && headFace >= (table?.head?.size !== undefined ? tableHeadFloorPx(target) : targetFloorsPx(target).axis) ? Infinity : headFace;
  const axisFloor = Math.min(ownHead, tableHeadFloorPx(target, textScale));
  const padStep = density === 'compact' ? -1 : density === 'relaxed' ? 2 : 0;
  const label = Math.max(labelFloor, theme.type.label.size + sizeStep);
  const total = grid && table?.fixedType === true ? theme.type.label.size : label;
  // The heads of a cohort grid stay on the axis step whatever the cells do,
  // and a head size the theme writes holds at every density.
  // Headers stay 2 px below the smallest body face, including matrix cells,
  // but never under the head floor.
  const body = Math.max(labelFloor, grid || table?.rows ? label : label - d(1));
  const headStep = table?.head?.size ?? Math.max(axisFloor, theme.type.axis.size + (grid ? 0 : sizeStep));
  const axis = Math.max(axisFloor, Math.min(headStep, body - d(2)));
  const headRatio = table?.head?.lineHeight ?? LINE_RATIO;
  const headBox = (value: number): number => lineBoxAt(value, headRatio);
  const sectionRatio = table?.section?.lineHeight;
  const micro = microType(theme).size;
  // `table.rows`: every rung on one face, the label's, with the theme's line
  // box and air; the ladder still steps weight and indent.
  const rows = grid ? undefined : table?.rows;
  const size = (level: number): number =>
    Math.max(labelFloor, grid || rows || level <= 0 ? label : label - d(1));
  const lineBox = (value: number): number => rows?.lineHeight === undefined ? Math.ceil(value * LINE_RATIO) : lineBoxAt(value, rows.lineHeight);
  const sectionBox = (value: number): number =>
    sectionRatio === undefined ? lineBox(value) : lineBoxAt(value, sectionRatio);
  if (grid) {
    // One pitch for every row: the air is what the pitch leaves over the
    // line box, so 26 px rows stay 26 px whatever face the theme brings.
    const rowHeight = Math.max(grid.rowHeight, lineBox(label) + 2);
    const air = Math.max(1, (rowHeight - lineBox(label)) / 2);
    return {
      target,
      textScale,
      label,
      total,
      axis,
      headBox,
      sectionBox,
      micro,
      rowHeight,
      group: Math.max(axisFloor, axis - d(0.5), micro),
      // The closing row stands 4 px off the matrix and carries a rule on
      // each side: one pitch of air plus that standoff, minus the rules.
      totalPad: Math.max(1, (rowHeight + CLOSER_STANDOFF - lineBox(total) - 2) / 2),
      lineBox,
      inlineSize: () => Math.max(labelFloor, micro, label - d(2)),
      inlineBox: (value) => Math.ceil(value * INLINE_LINE_RATIO),
      inlineGap: INLINE_GAP,
      size,
      weight: () => theme.type.label.weight,
      pad: () => air,
    };
  }
  return {
    target,
    textScale,
    label,
    total,
    axis,
    headBox,
    sectionBox,
    micro,
    group: Math.max(axisFloor, axis - d(0.5), micro),
    totalPad: Math.max(1, 8 + padStep),
    lineBox,
    inlineSize: () => Math.max(labelFloor, micro, label - d(2)),
    inlineBox: (size) => Math.ceil(size * INLINE_LINE_RATIO),
    inlineGap: INLINE_GAP,
    size,
    weight: (_level, hasChildren) => hasChildren ? tableEmphasis(theme) : theme.type.label.weight,
    pad: (level, hasChildren) =>
      Math.max(rows?.pad === undefined ? 1 : 0, (rows?.pad ?? (level <= 0 || (level === 1 && hasChildren) ? 7 : level <= 2 ? 4 : 3)) + padStep),
  };
}
