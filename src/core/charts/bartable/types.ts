/**
 * Bar table: rows with a label column, number columns and one or more
 * stacked-bar panels. Every panel splits its bar into the same segments, so
 * one key names them all; each panel has its own unit and its own scale.
 */

import type { Rect } from '../../geometry';
import type { Id } from '../../types/cell';
import type { BaseOptionsFor } from '../../types/options';
import type { RoundingAdjustment } from '../../shareRounding';

interface BarTableRow {
  id: Id;
  label?: string;
  /** Row group id from data.rowGroups: the bar takes the group's colour. */
  group?: Id;
  /** A rest row ("Rest of …"): drawn in the neutral grey and pinned below the other rows. */
  residual?: boolean;
}

/** A row attribute that colours the bars of its rows, keyed under a titled legend. */
interface BarTableRowGroup {
  id: Id;
  label?: string;
  colorRole?: string;
  fill?: string;
}

interface BarTableSegment {
  id: Id;
  label?: string;
  colorRole?: string;
  fill?: string;
}

/** An authored non-value state of a bar or column cell: n/a or n.m., as the table prints them. */
export type BarTableCellState = 'na' | 'nm';

/** A cell value: a number, null (missing) or an authored state. */
export type BarTableValue = number | null | { state: BarTableCellState };

interface BarTableColumn {
  id: Id;
  label?: string;
  /** In row order; null prints the missing glyph, a state prints its glyph. */
  values: BarTableValue[];
  format?: string;
  /** What the Total row prints for this column; default 'sum'. */
  aggregate?: 'sum' | 'none';
}

/**
 * An authored range for a row's total, printed "low–high" at the bar's end.
 * The segments fill the bar to low in their own shares; a light extension runs on to high.
 */
export interface BarTableEnd {
  low: number;
  high: number;
}

interface BarTablePanel {
  id: Id;
  label?: string;
  unit?: string;
  /** Share of the width left after the label and number columns; default 1. */
  weight?: number;
  /** Segment id -> values in row order. */
  values: Record<Id, BarTableValue[]>;
  /** Per row; absent or null draws and prints the row's stack sum. */
  ends?: (BarTableEnd | null)[];
  format?: string;
  /** What the Total row prints for this panel; default 'sum'. */
  aggregate?: 'sum' | 'none';
}

export interface BarTableData {
  categories: BarTableRow[];
  series: BarTableSegment[];
  columns?: BarTableColumn[];
  panels: BarTablePanel[];
  /** Colour the bars by a row attribute; needs one segment. */
  rowGroups?: { title?: string; groups: BarTableRowGroup[] };
}

/** The data after the states are split off: every cell is a number or null. Internal to the layout. */
export interface BarTablePlainData extends Omit<BarTableData, 'columns' | 'panels'> {
  columns?: (Omit<BarTableColumn, 'values'> & { values: (number | null)[] })[];
  panels: (Omit<BarTablePanel, 'values'> & { values: Record<Id, (number | null)[]> })[];
}

/** Growth column after the last panel, from the first panel to the last. */
export interface BarTableGrowth {
  /** 'cagr': compound annual growth of each row's value, in %; 'share-change': last share minus first share, in pp. */
  measure: 'cagr' | 'share-change';
  /** Years from the first panel to the last, for 'cagr'; default read from the panel labels ("2019", "FY24"). */
  years?: number;
  /** Column head; default "<first>–<last> CAGR, %" or "<first>–<last> share change, pp". */
  label?: string;
}

/** Share-cascade layout: each panel splits one total, row by row. */
interface BarTableCascade {
  /** A computed share column (row over panel total) beside each panel; default true. */
  share?: boolean;
  /** Row groups only; default true. false: the Total bar keeps the theme total colour, even where it equals a group colour. */
  totalApart?: boolean;
  growth?: BarTableGrowth;
}

export interface BarTableOptions extends BaseOptionsFor<'bartable'> {
  /** Closing Total row; default true. */
  total?: boolean;
  /**
   * Rows whose combined share of each summed panel prints in a note: the
   * rows' sum over the panel's, at each range end where rows carry ranges.
   */
  combinedShare?: { rows: Id[]; label?: string };
  /**
   * Print each part's value inside its segment, where the text and 3 px of padding on each side fit.
   * Default true. A panel whose format has more than one decimal, and a row with a range, print end labels only.
   * Refused under variant 'cascade'.
   */
  segmentValues?: boolean;
  /**
   * 'panels' (default): one stacked-bar panel per measure. 'cascade': each panel
   * splits its total, a row's bar starts where the row above ended, on a light
   * track over the whole total.
   */
  variant?: 'panels' | 'cascade';
  /** Settings of variant 'cascade'. */
  cascade?: BarTableCascade;
  /** false: each panel scales to its own longest bar; true: one scale for all, panel width follows the panel's longest bar (its total under cascade). Default false, true under cascade. */
  sharedScale?: boolean;
  /** 'rows' (default): a pinned canvas gives its spare height to the rows, up to 1.25 times the natural pitch, and the bar thickens with them. 'none': rows keep the natural pitch. A theme `space.barRow` fixes the row either way. */
  heightFill?: 'rows' | 'none';
}

export interface BarTablePanelDerived {
  id: Id;
  /** Each row's stack sum; null when a segment of the row is missing. */
  rowSums: (number | null)[];
  /**
   * The Total row: the summed ranges when a row has one (a row without counts
   * its stack sum at both ends), else the sum of the stack sums; null when a
   * row is incomplete; absent under aggregate 'none'.
   */
  total?: number | BarTableEnd | null;
}

export interface BarTableDerived {
  panels: BarTablePanelDerived[];
  /** Row ids in the order the table draws them: residual rows pinned last. */
  rowOrder: Id[];
  /** Under cascade with combinedShare: the bracket's name, the authored label or the joined row labels. */
  combinedLabel?: string;
  /** Under cascade: per panel, each row's start and share (in %), and the combined share of combinedShare.rows. */
  cascade?: { id: Id; starts: number[]; shares: number[]; combined?: number }[];
  /** Under cascade.growth: one value per row in row order, then the Total row's; null when not defined. */
  growth?: (number | null)[];
  /** Under rounding 'sum-consistent': the shares printed off their nearest rounding. */
  roundingAdjustments?: RoundingAdjustment[];
  /** Summed number columns only; null when a value is missing. */
  columns: { id: Id; total: number | null }[];
}

interface BarTableSegmentMark {
  rowId: Id;
  panelId: Id;
  seriesId: Id;
  /** The drawn value: the authored one, or on a range bar its part of the low end, rounded as `text` prints it. */
  value: number;
  /** The value in the panel's format. */
  text: string;
  rect: Rect;
}

/** A printed number: a number column's cell, a panel's end label, or a cell of the Total row. */
interface BarTableCellMark {
  /** Absent on the Total row and on the combined-share bracket. */
  rowId?: Id;
  /** The share of the bracketed rows (`combinedShare`) beside a cascade panel: no row's cell and not the Total row's. */
  combined?: true;
  colId: Id;
  kind: 'column' | 'end' | 'total' | 'share' | 'growth';
  /**
   * The column value, or where the panel's segments end: the stack sum, the
   * low end of a range (summed over the rows in the Total row); null when a part is missing.
   */
  value: number | null;
  /** The authored range the label prints in place of `value`. */
  range?: BarTableEnd;
  /** The text the table prints. */
  text: string;
  rect: Rect;
}

export interface BarTableMarks {
  segments: BarTableSegmentMark[];
  cells: BarTableCellMark[];
}
