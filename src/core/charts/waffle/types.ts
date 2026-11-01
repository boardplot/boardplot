/**
 * Waffle data and option types (registry type 'waffle'). They live in the
 * chart directory, not in `types/options`: nothing outside this type accepts
 * them.
 */

import type { BaseOptionsFor } from '../../types/options';
import type { ColorRole, Id } from '../../types/cell';
import type { Rect } from '../../geometry';
import type { RoundingAdjustment } from '../../shareRounding';

/** Rows and columns of the cell grid. Each cell is 100 / (rows × columns) percent. */
export interface WaffleGrid {
  rows: number;
  columns: number;
}

export interface WaffleOptions extends BaseOptionsFor<'waffle'> {
  /** Cell grid of every panel. Default 10 × 10, so one cell is 1%. */
  grid?: WaffleGrid;
  /** Where the fill starts. 'bottom' (default) starts at the bottom left and fills row by row upward; 'top' starts at the top left and fills downward. */
  fillFrom?: 'bottom' | 'top';
  /** Automatic: a headline for one segment, a value key for several. Authored 'value' prints a labelled total for several segments; 'none' leaves the headline out. */
  headline?: 'value' | 'none';
  /** One panel with one series on a pinned canvas. 'rows' (default): the grid takes the full plot height and the value and label stand beside the filled cells. 'none': the label, the value and the grid stack in a column. */
  heightFill?: 'rows' | 'none';
  /** 'auto' (default) prints a note "One cell = 5%" when one cell is not 1%; 'none' leaves it out. */
  cellNote?: 'auto' | 'none';
  /** 'cells' (default) draws the grid of cells; 'square' draws one solid square whose area is the share, inside a pale 100% square. */
  variant?: 'cells' | 'square';
  /** Square mode: one reference share drawn as a dashed square outline in every panel, from a panel (categoryId) or a number (value). */
  reference?: WaffleReference;
  /** Square mode: arrows between adjacent panels. Default false: the panels are separate measures, and an arrow reads as a flow. */
  arrows?: boolean;
  /** Contiguous runs of panels with a centred caption under them and an optional colour role for their fill. */
  panelGroups?: WafflePanelGroup[];
  /** Cells mode, one panel: the sum of the first segments, printed with a label beside a bracket (or under the key). */
  subtotal?: WaffleSubtotal;
}

interface WaffleSubtotal {
  /** Series ids summed: the first series and the ones after it, in series order. */
  series: Id[];
  /** What the sum stands for, such as 'within a day'. */
  label: string;
}

interface WaffleReference {
  /** The panel whose share is the reference. Give this or value. */
  categoryId?: Id;
  /** The reference share in percent, 0 to 100. Give this or categoryId. */
  value?: number;
  /** Text of the outline label; default "<panel label> <share>". Required with value. */
  label?: string;
}

interface WafflePanelGroup {
  id: Id;
  /** Member panel ids, contiguous in category order. */
  panels: Id[];
  /** Caption centred under the group. */
  label?: string;
  /** Theme colour role of the group's fill; the series colour otherwise. */
  colorRole?: ColorRole;
}

interface WaffleSegmentDerived {
  seriesId: Id;
  /** The authored value, in percent. */
  value: number;
  /** The value in cells before rounding. */
  exactCells: number;
  /** Whole cells drawn for the segment. */
  cells: number;
  /** What the reader is told: "30% = 30 of 100 cells". */
  reading: string;
}

export interface WafflePanelDerived {
  categoryId: Id;
  label: string;
  /** Sum of the segment values, in percent. */
  total: number;
  /** Whole cells filled across all segments. */
  filledCells: number;
  segments: WaffleSegmentDerived[];
}

export interface WaffleDerived {
  grid: WaffleGrid & { cells: number };
  fillFrom: 'bottom' | 'top';
  variant: 'cells' | 'square';
  /** Square mode: the resolved reference share. */
  reference?: { value: number; label: string; categoryId?: Id };
  /** The share of the whole one cell stands for, in percent. */
  cellShare: number;
  panels: WafflePanelDerived[];
  /** Segments whose whole-cell count moved off their nearest rounding so the filled cells add up. */
  roundingAdjustments?: RoundingAdjustment[];
}

export interface WaffleMarks {
  panels: {
    categoryId: Id;
    /** The cell grid of the panel. */
    rect: Rect;
    /** Scene path node of each segment. */
    segments: { seriesId: Id; nodeId: Id; cells: number }[];
    /** Scene path node of the empty cells (square mode: the pale 100% square); absent when every cell is filled. */
    restNodeId?: Id;
    /** Square mode: the solid square; its area over rect's area is the share. */
    shareRect?: Rect;
    /** Square mode: the dashed reference outline. */
    referenceNodeId?: Id;
    labelNodeId?: Id;
    headlineNodeId?: Id;
  }[];
}
