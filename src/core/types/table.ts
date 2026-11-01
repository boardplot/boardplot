/**
 * Table contract v1.
 * ResolvedTable is the semantic, pixel-free IR: SVG layout and the HTML
 * renderer consume it.
 * The SVG scene is an output, never the shared model.
 */

import type { ValueBand } from '../bandSelect';
import type { Rect } from '../geometry';
import type { TextMeasurer } from '../text';
import type { Id, Scenario, Direction } from './cell';
import type { BaseOptionsFor } from './options';
import type { Theme } from './theme';
import type { Paint } from './scene';

// ---------- authored data ----------

/** `stickyLabels`: the 0.27 forms (`true`, a column count) and the object form that also pins the head to the page and the active section label. */
export type StickyLabels = boolean | number | { head?: 'table' | 'page' | false; columns?: number; top?: number; sections?: boolean };

export type CellTone = 'good' | 'bad' | 'warn' | 'neutral';
export type CellState = 'value' | 'missing' | 'na' | 'nm' | 'suppressed' | 'open';

/** Cell states beyond numbers carry distinct audit meanings. */
export interface TableCellObject {
  /** Override the missing glyph for this cell, as on a row. */
  missing?: 'blank' | 'dash';
  v?: number | string | null;
  note?: string; // inline annotation, e.g. "(−51%)"
  tone?: CellTone;
  /**
   * Value bands for a numeric cell: ascending upper bounds in the cell's own
   * units (before display formatting), each with a tone and a label. The cell
   * takes the tone of the first band its value is at or under; a value under
   * the first bound takes the first band, and one over the last bound takes
   * the last. An explicit `tone` beats the bands, and the bands beat the
   * automatic sign judgement of a change. A missing, n/a, n.m., suppressed or
   * open cell is not judged, and a text cell ignores the bands.
   */
  bands?: ValueBand[];
  href?: string; // HTML renderer emits a link; SVG renders text only
  /** 'open': a period still to come, drawn empty on the band ground. */
  state?: 'na' | 'nm' | 'suppressed' | 'open';
  /**
   * false: the cell stays out of its column's heat lane, unshaded
   * and printed in the muted ink, and out of the lane's range. The M0
   * diagonal of a cohort grid on the calendar axis is the case.
   */
  heat?: false;
  /**
   * A value cell's own format-by-example. It beats the row's and the
   * column's format: a percent YoY column prints a share KPI's change in
   * points ('+1.2pp').
   */
  format?: string;
  /**
   * Presentation hints. `strong` is also an authored table field. `bar` and
   * `muted` are compile hints set by dimswitch. `strong`: the judgment cleared its
   * strong threshold, and a theme with `table.tones: 'fill'` paints a deeper
   * ground. `bar`: the share of the row's scale the figure fills, 0 to 1,
   * drawn as a grey bar from the cell's left edge. `muted`: the figure prints
   * in the muted ink at the body weight, with no tone (an unjudged change).
   */
  strong?: true;
  bar?: number;
  muted?: true;
}
export type TableCell = number | string | null | TableCellObject;

/**
 * Calculation address. A column id still means that column on the current row.
 * `{ row }` is the column being evaluated on another row. `{ row, previous: true }`
 * is the preceding columnGroup member of that row (first member is n/a).
 */
export type CalcCellRef = Id | { row: Id; col?: Id; previous?: true };

/** Typed calc AST — no strings, no eval. */
export type Calc =
  | { ref: CalcCellRef }
  | { lit: number }
  | { op: 'add' | 'sub' | 'mul' | 'div'; a: Calc; b: Calc }
  | { op: 'abs'; of: Calc }
  | { op: 'delta'; a: CalcCellRef; b: CalcCellRef }
  | { op: 'percentDelta'; a: CalcCellRef; b: CalcCellRef } // 100·(a−b)/b, points; n.m. when b ≤ 0
  | { op: 'share'; of: CalcCellRef }; // % of column leaf total, points

export type ColumnKind =
  | 'rowLabel'
  | 'value'
  | 'computed'
  | 'text'
  | 'status'
  | 'date'
  | 'encoding';

interface TableColumnBase {
  id: Id;
  kind: ColumnKind;
  label?: string;
  /**
   * A second head line under the column label, at the ladder's micro step in
   * the muted ink: the weekday under a date ("Thu"), the ISO week under a
   * week start ("W41"). Where one column in a head row carries one, every
   * primary label still shares the same baseline.
   */
  subLabel?: string;
  /**
   * Width in px. React keeps it and scrolls. SVG narrows authored tracks only
   * when the fixed frame needs it, with `table-overflow` and a wider-size fix.
   * Value and computed tracks widen for figures, and a row-label track for its
   * labels up to 180 px (`table-column-widened`).
   * Other content may cut (`table-column-clipped`); remove width for automatic sizing.
   */
  width?: number;
  align?: 'left' | 'right' | 'center';
  /**
   * Print this column's cell notes as a SECOND LINE under the figure, at the
   * ladder's inline step in the muted ink. A note stays inline after the
   * figure by default, where a 90 px block track cuts it off: the block
   * column of a KPI board says "sum" under its year-to-date figure and
   * "vs FY25" under its year-on-year one. The note takes the first line slot
   * the cell's own change lines leave empty; where they fill every slot, or
   * where the row prints no line at all, the row grows by one inline line.
   */
  noteLine?: boolean;
  /** false: `options.fitFormats` leaves this column's format as authored, even where a figure is cut at its width. */
  fitFormat?: false;
  /** Typographic weight of the whole column: 'strong' sets the emphasis weight (700 by default), 'muted' paints it in inkMuted. */
  emphasis?: ColumnEmphasis;
  /**
   * Carry the band ground down this column. A run of neighbouring banded
   * columns reads as one block and the first of the run takes the hairline,
   * so a block can be a part of a column group instead of a group of its own:
   * the FY-to-date pair inside a twelve-month group is a band, and
   * making it a group would split the toggle that covers the fiscal year.
   */
  band?: boolean;
}

export type ColumnEmphasis = 'strong' | 'muted';
interface RowLabelColumn extends TableColumnBase {
  kind: 'rowLabel';
  /** Cap the measured label track, including indent and affix. Explicit width wins. */
  maxWidth?: number;
  /** Caps how much the label text adds to the column width. The indent, the affix and the collapsed hint come on top. Not a hard cap: a column made wider by other content lets labels use the room. Ignored when width is set; maxWidth still caps the whole track. */
  maxTextWidth?: number;
}
interface ValueColumn extends TableColumnBase {
  kind: 'value';
  format?: string; // format-by-example; default derived from data
  scenario?: Scenario;
  polarity?: Direction;
  /** Display de-emphasis threshold — value stays visible and recorded. */
  materiality?: { pct?: number; abs?: number };
  aggregate?: 'sum' | 'none' | 'source'; // default 'sum'; 'none' for %, pp, x formats or mixed-format summand rows
  nulls?: 'propagate' | 'skip'; // default 'propagate'
  /** 'points': the percent values are already points (1.2 prints 1.2%), so percent-scale-suspect stays quiet. */
  percentScale?: 'points';
}
interface ComputedColumn extends TableColumnBase {
  kind: 'computed';
  calc: Calc;
  format?: string;
  polarity?: Direction;
  /** Display de-emphasis threshold — value stays visible and recorded. */
  materiality?: { pct?: number; abs?: number };
}
interface TextColumn extends TableColumnBase {
  kind: 'text';
  /** Prose may fall to two lines so the note does not set the table's width floor. */
  wrap?: boolean;
}
interface StatusColumn extends TableColumnBase {
  kind: 'status';
  /** Display text per status key, e.g. { pending: 'Learning' }; the key keeps its tone. */
  labels?: Partial<Record<'on-track' | 'at-risk' | 'off-track' | 'done' | 'pending', string>>;
  /** 'chip' (default): a tone wash behind the text. 'square': a small tone square before ink text. */
  mark?: 'chip' | 'square';
}
interface DateColumn extends TableColumnBase {
  kind: 'date';
  format?: string; // date format-by-example, e.g. "30 Sep 2026"
}
type SparklineKind = 'line' | 'column';
interface EncodingColumn extends TableColumnBase {
  kind: 'encoding';
  encoding: { type: 'sparkline'; kind?: SparklineKind; sourceColumns: Id[] };
}
export type TableColumn =
  | RowLabelColumn
  | ValueColumn
  | ComputedColumn
  | TextColumn
  | StatusColumn
  | DateColumn
  | EncodingColumn;

export type RowRole = 'data' | 'total' | 'section';
export type RowRelation = 'additive' | 'ofWhich' | 'displayOnly';
export type TotalPolicy = 'derive' | 'validate' | 'source';

/** Canonical flat row; `children` is accepted authoring sugar. */
export interface TableRow {
  id: Id;
  label?: string;
  parentId?: Id;
  /**
   * Presentation kind. Statement kinds: 'subtotal' is a line its children
   * add up to (Costs), on the theme's subtotal ground; 'result' is a
   * statement result (margin = income - costs): bold, a rule above, never moved
   * like a total; 'driver' explains a line and is never added (AOV, a
   * margin %). 'result' and 'driver' imply relation 'displayOnly'.
   */
  kind?: 'section' | 'member' | 'measure' | 'detail' | 'split' | 'subtotal' | 'result' | 'driver';
  /**
   * -1: the row subtracts from its additive parent (a cost authored as a
   * positive amount). The contribution sign is the product over additive
   * ancestors; `options.signs` decides how it prints.
   */
  sign?: -1;
  /** Glyph before the label under `options.signs: 'operators'`. A sign -1 or result kind takes priority. */
  operator?: '+' | '−' | '×' | '÷' | '=';
  /** The closing result of a statement: the theme's `table.finalRule` under it. */
  final?: true;
  /** Presentation rung override; independent of accounting depth. */
  rung?: number;
  /** DimSwitch compile hint, not an authored table field: the line above this row in the rule ink opens a family of rows. */
  divider?: true;
  role?: RowRole; // default 'data'
  relation?: RowRelation; // default 'additive'
  totalPolicy?: TotalPolicy; // default: authored value ? validate : derive
  /** Row scale from drawn value cells without their own format. */
  scale?: 'money' | 'perUnit' | 'count' | 'percent';
  /** Row-level calc, evaluated per value/computed column. Requires ofWhich or displayOnly. */
  calc?: Calc;
  /** Format-by-example; overrides the column format for calc rows and inline rows. */
  format?: string;
  /** false: `options.fitFormats` leaves this row's format as authored, even where a figure is cut at its width. */
  fitFormat?: false;
  polarity?: Direction;
  /**
   * Print this row as a line under its parent's value, inside the same cell,
   * instead of as a row of its own. Only a `displayOnly` child may do it.
   */
  inline?: true;
  /** Which switch hides this line; several rows may share one. Default: the row id. */
  inlineGroup?: Id;
  /**
   * A short affix printed beside the row label, in the muted ink on the
   * label's own line: the unit a KPI row reads in ("$M", "# orders"). It is
   * not a note, so it takes no second line and
   * the change lines under the label stay level with the ones under the
   * values. A forced `options.magnitude` overrides it with the scale letter
   * it hoists out of this row's cells.
   */
  unitAffix?: string;
  /**
   * What a MISSING cell of this row prints: 'blank' leaves it empty, 'dash'
   * prints the em dash. Omitted, the row takes `options.nulls`. A change
   * line with no value in a block column is a slot with nothing to say, and
   * a table-wide 'blank' would also empty the real gaps of the data rows.
   * Named `missing` and not `nulls`: a row field that shares a
   * column field's name overrides it (`format`, `polarity`), and a value
   * column's `nulls` says how a parent sums, which this does not touch.
   */
  missing?: 'blank' | 'dash';
  /**
   * Empty px before this row, the row twin of a column group's `spacer`:
   * 6 px before each January row of a long cohort history. It draws no
   * ground and no rule, and it replaces the rule above the row. The first
   * drawn row takes none.
   */
  spacer?: number;
  /**
   * false: a parent the reader cannot fold. It draws no toggle and
   * no fold mark, and its children stay drawn whatever the expansion, the
   * depth control or a controlled collapse state says.
   */
  foldable?: false;
  /** A status chip after a section heading's text, in the status chip paints. Section rows only. */
  badge?: { text: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' };
  cells?: Record<Id, TableCell>;
  children?: TableRow[];
}

/** The noun a level's children are counted in, for the collapsed-row hint. */
interface LevelNoun {
  one: string;
  other: string;
}

/** One header group over contiguous member columns. */
interface TableColumnGroup {
  id: Id;
  label: string;
  columns: Id[];
  band?: boolean;
  note?: string;
  spacer?: number;
  /**
   * Draw the heading. Default true. `false` keeps everything else the group
   * means: its membership (the hover series, `previous: true` calcs), its
   * label as the hover noun, its band, its spacer and its divider. Where no
   * group draws a heading, the head's group row goes.
   */
  heading?: boolean;
  /**
   * What the sparkline hover card draws for a member column. 'shown', like
   * absent, draws the members on screen. 'all' draws every member in
   * `columns[]` order, those a column toggle hides included, so a block can
   * show the history it does not draw ("FY22 YTD" to "FY27 YTD" behind one
   * visible "FY27 YTD"). A hidden member still draws, measures and counts
   * nowhere else.
   */
  hoverSeries?: 'shown' | 'all';
}

export interface TableData {
  /**
   * Two-row headers. `note` prints after the heading as "· note" in the
   * muted ink, lowercase and untracked: the period the block covers
   * ("Jul 1-15", "full month"), which the heading itself never says.
   */
  columnGroups?: TableColumnGroup[];
  columnToggles?: { id: Id; label: string; columns: Id[]; defaultVisible?: boolean }[];
  columns: TableColumn[];
  rows: TableRow[];
  /**
   * Nouns for the children of each level, indexed by the level they name
   * (`levelNouns[1]` names level-1 children). A collapsed parent appends
   * "· 4 markets" only where its children's level is authored here — the
   * engine never invents the word.
   */
  levelNouns?: LevelNoun[];
}

export type TableVariant = 'steering' | 'benchmark' | 'status' | 'receipts' | 'hierarchy';
type TableCellEncodingName = 'polarityBadge' | 'heat' | 'inCellBar' | 'arrow';
/**
 * How a stepped heat lane finds the band a value belongs to; 'status' is the
 * traffic light: good, warn or bad against the lane's centre.
 */
type HeatScale = 'column' | 'absolute' | 'diverging' | 'status';
/** The band around the centre of a 'status' lane that reads as warn: exactly one of the two. */
export interface HeatTolerance {
  /** Percent of the centre. */
  pct?: number;
  /** Column units. */
  abs?: number;
}
/** Heat with its authored lane settings; the bare string means these defaults. */
interface HeatEncodingOption {
  type: 'heat';
  /** Value that saturates the lane: `pct` on percent columns, `abs` elsewhere. */
  cap?: { pct?: number; abs?: number };
  /** Tint weight at the cap; default 0.18, and 0.26 on scale 'status'. */
  alpha?: number;
  /** Leave total rows untinted; default true. */
  excludeTotals?: boolean;
  /** Discrete ramp: how many bands the lane paints. Omitted stays continuous. */
  steps?: number;
  /** Where a value's band comes from; default 'column'. */
  scale?: HeatScale;
  /** Ascending band edges for 'absolute', |distance| edges for 'diverging'. */
  bins?: number[];
  /** On 'column': the narrowest spread that fills the ramp; a narrower column takes the bands from the lightest up. */
  span?: number;
  /** On 'diverging' and 'status': measure from the table's total row; omitted, from the data rows' mean. */
  center?: 'total';
  /**
   * On 'status': how far from the centre a value still reads as warn
   * (amber); farther above is good, farther below bad, the other way round
   * on a lowerIsBetter column. Default `{ pct: 5 }`.
   */
  tolerance?: HeatTolerance;
  /** Columns this one rule paints, beside the key it is authored under. */
  columns?: Id[];
}
/**
 * An arrow with its cut. 'absolute' cuts the change itself at 10 and 2 (a percent
 * column's points); 'relative' cuts its share of the column's largest change.
 * Default: 'absolute' on a percent column, 'relative' elsewhere.
 */
interface ArrowEncodingOption {
  type: 'arrow';
  scale?: ArrowScale;
}
export type ArrowScale = 'absolute' | 'relative';
export type TableCellEncoding = TableCellEncodingName | HeatEncodingOption | ArrowEncodingOption;
/** What `resolveTable` hands the renderers: always an object, defaults filled. */
export type ResolvedCellEncoding =
  | { type: 'polarityBadge' }
  | { type: 'inCellBar' }
  | { type: 'arrow'; scale: ArrowScale }
  | {
    type: 'heat';
    cap?: { pct?: number; abs?: number };
    alpha: number;
    excludeTotals: boolean;
    steps?: number;
    scale?: HeatScale;
    bins?: number[];
    span?: number;
    center?: 'total';
    tolerance?: HeatTolerance;
  };
type RowHighlightTone = Exclude<CellTone, 'neutral'> | 'highlight';

/**
 * sort.categories reorders data rows within each sibling group (sheet default,
 * reverse, or by the additive value-column total). sort.segments is refused.
 * topN keeps n siblings per group and nests the rest under an Others parent
 * so resolveTable still derives totals and claims; it does not sum text,
 * status or non-aggregating columns.
 */
export interface TableOptions extends BaseOptionsFor<'table'> {
  /**
   * How rows with contribution sign -1 print. 'signed' (default): the value
   * and its absolute changes print negated; relative and pp changes keep
   * their sign. 'operators': values as authored, a glyph before the label
   * (− for sign -1, = for a result, else the authored operator).
   * 'plain': neither. Tables without sign -1 rows draw the same in all three.
   */
  signs?: 'signed' | 'operators' | 'plain';
  /**
   * Whether a driver row (`kind: 'driver'`) shows the good, warn and bad
   * tones its figures earn. 'grouped' (default): a driver with a `parentId`
   * whose parent is not a section heading shows them, as the lines of a
   * statement do; a flat driver keeps the driver ink. 'always': every driver
   * shows them. 'never': a driver prints in the driver ink only (the 0.27
   * look). A neutral figure and the label keep the driver ink, and the
   * italic face stays.
   */
  driverTones?: 'grouped' | 'always' | 'never';
  /** 'exceptions' keeps only strong good and bad tones; good and warn print neutral. Default 'all'. */
  judgements?: 'all' | 'exceptions';
  /** Mount closed descendants. false removes them from the DOM. */
  mountCollapsed?: boolean;
  variant?: TableVariant; // default 'hierarchy'
  encodings?: Record<Id, TableCellEncoding>; // per column, opt-in
  totalPosition?: 'top' | 'bottom'; // variant supplies default
  /**
   * Cell spacing tier. Static output retries compact spacing, tight margins
   * and automatic height before refusal, unless belowMinimum is refuse.
   * The two cohort tiers are fixed grids rather than
   * steps of the level ladder: a cohort table has one level and its rows are
   * a 26 px (20 px) matrix the reader scans across, not a hierarchy.
   */
  density?: 'compact' | 'regular' | 'relaxed' | 'cohort' | 'cohort-small';
  /**
   * What a missing cell prints. 'dash' (the default) keeps the em dash the
   * contract has always drawn; 'blank' leaves it empty, which is what a
   * cohort staircase needs: a cohort acquired in May has not been observed
   * at M8, and a column of dashes draws a triangle of noise.
   * Explicit states (na, nm, suppressed) keep their glyphs.
   */
  nulls?: 'blank' | 'dash';
  /**
   * Print the cell figures. false draws the heat grounds alone, in cells
   * small enough for a sixty-column triangle; the heads keep their labels
   * and the numbers stay in the markup for a reader who cannot see the
   * grounds. A heat cell is 22 px wide, over any width authored for
   * its figures, and a row 14 px tall or the line box of the text it still
   * prints where that is taller.
   */
  figures?: boolean;
  expansion?: {
    /**
     * Parents at levels below `depth` start expanded; `'all'` (the default)
     * expands every parent. `'totals'` is the totals step of a depth control:
     * every parent folds and the level-0 data rows hide, so the totals and
     * the section headings show. A table without a total row keeps its
     * level-0 rows, folded, under open section headings.
     */
    depth?: number | 'all' | 'totals';
    collapsed?: Id[];
    expanded?: Id[];
    /**
     * Hide every level-0 data row with its subtree and keep the totals and
     * the section headings: the totals-only step of a depth control.
     * Collapsing a parent still draws the parent, so a depth
     * control needs this second half to show the Total alone.
     */
    rootsHidden?: boolean;
  };
  columnVisibility?: Record<Id, boolean>;
  /** Inline-line visibility keyed by `inlineGroup`; an absent group is visible. */
  inlineVisibility?: Record<Id, boolean>;
  /**
   * Force the magnitude every derived money format takes, instead of letting
   * each column pick its own from its largest value. 'auto' is the default.
   */
  magnitude?: 'auto' | 'thousand' | 'million';
  anchorWash?: boolean;
  /**
   * React only: what folds a parent row. 'row': a click on the row folds it
   * (and, where the host made the row selectable, selects it too). 'toggle':
   * only the fold mark folds, and a click on the row only selects. Default:
   * 'toggle' for a selectable row, 'row' for any other. Enter and Space on a
   * cell follow the same rule as the click.
   */
  foldOn?: 'row' | 'toggle';
  /**
   * Which group rows carry the group ground (the emphasis and band grounds of
   * the top two rungs, under a preset that draws them). 'expanded' (default,
   * a 0.28 characteristic): only the header row of an open group, so a folded
   * group row, and a leaf on its rung, look like normal rows. 'always': every
   * group row and every leaf on its rung, folded or open, as in 0.27. 'none':
   * no group ground. The Total keeps its own ground. Absent, the theme key
   * `table.groupGround` decides.
   */
  groupGround?: 'expanded' | 'always' | 'none';
  /**
   * Pin the header and the leading columns while the table scrolls. `true`
   * pins one, a number pins that many, and the last pinned column carries a
   * hairline shadow to its right so the reader sees where the scrolling
   * starts. The object form names each part: `head` is 'table'
   * (default: the head pins inside the table's own scroll box), 'page' (the
   * head pins to the page scroll at `top` px, the body has no vertical
   * scroll box and the head follows its sideways scroll) or false (no pinned
   * head); `columns` is the count of pinned columns (default 1); `top` is the
   * page offset in px for a host toolbar (default 0, page mode only); and
   * `sections: true` keeps the active section label under the head until the
   * next section starts (default false). `true` and a number keep their
   * 0.27 meaning. Page mode is refused with React `fillHeight`.
   */
  stickyLabels?: StickyLabels;
  /**
   * Frame fill. 'values' (default) grows automatic value tracks by at most maxGrowth.
   * The unauthored label track takes the rest, so the table ends at the frame
   * edge, a table with one value track too.
   * A label track too narrow for a name takes width back from the value
   * tracks' growth before the name wraps. 'none' keeps natural widths.
   */
  frameFill?: 'values' | 'none';
  /**
   * Spare height of a pinned canvas (a slide, a print page, an authored
   * height). 'rows' (default) spreads it over the leaf rows as air, up to
   * 16 px above and below each line. 'none' keeps the rows at their natural
   * height. An open height takes the rows' own height either way.
   */
  heightFill?: 'rows' | 'none';
  /**
   * Lines a row label may take before it is cut with an ellipsis (default 2).
   * A label breaks at a space or after `_`, `-`, `/` or `.`, so a long
   * campaign name such as `Brand_Paid-Social_FB_Q4` wraps instead of ending
   * in "…". 1 keeps every label on one line. The hover card always prints
   * the full name.
   */
  rowLabelLines?: 1 | 2;
  /**
   * Let the last drawn track take the remaining frame width when it has no
   * authored width. Both renderers use the same final pixel width. Default false.
   * `rowExtent: 'frame'` takes precedence: its empty track owns the slack.
   */
  lastTrackFlex?: boolean;
  /**
   * Row extent. Unset, rows and rules end at the last column when frame
   * fill leaves width beside the table, and fill the frame otherwise.
   * Explicit 'frame' fills the width inside frame margins and also extends
   * rows through authored side margins. 'tracks' stops at the last column.
   * Tables have no single end rule.
   */
  rowExtent?: 'tracks' | 'frame';
  /**
   * Which sortable headers draw a chevron. 'all' (the default) draws one on
   * every sortable header, saying which way the next click will sort it;
   * 'sorted' draws it on the sorted header alone and keeps the reserve on
   * the others, so nothing moves when the reader sorts.
   */
  sortIndicator?: 'all' | 'sorted';
  /**
   * Shift every row's rung on the level ladder. A board whose top
   * rows are groups rather than KPI lines reads one rung too heavy: `1`
   * moves them down a rung in size, weight, air, ground, indent and label
   * ink, `-1` moves them up one. Default 0, and the rungs stay floored at 0
   * and at the ladder's deepest step. A total takes no offset: it restates
   * its siblings and is not a rung.
   */
  levelOffset?: number;
  /**
   * Horizontal air inside every cell, in px. The default steps down with the
   * available width (12; only when needed, 5 for 20–24 columns or 3 for 25 or more); a
   * board that draws 6 px of cell air names it here instead of overriding
   * the grid's own variable.
   */
  cellPadX?: number;
  /**
   * How far a column-group heading's hairline runs. 'span' (the default)
   * runs it under every member, so a fiscal-year group over twelve months
   * shows which months it holds; 'label' underlines the heading's text alone.
   */
  groupRule?: 'label' | 'span';
  /**
   * Where a column-group heading sits over its columns. 'center' (the
   * default) centres it; 'left' and 'right' put it at the first or the last
   * column's cell air. In the React grid a heading stays in view while its
   * group scrolls, and a centred heading over a group wider than the visible
   * scroll area starts at the first column. A heading wider than its columns starts at the first.
   */
  groupAlign?: 'left' | 'center' | 'right';
  /**
   * Shorten a number format until the widest figure fits its fixed track
   * (a column with an authored `width`): one decimal less at a time, then
   * the next unit up ($k to $M) at one decimal. A row format changes for the
   * whole row, a column format for the whole column, so one row or one
   * column reads in one format. Where the unit steps, a row's `unitAffix`
   * that named the old unit names the new one. Default false.
   */
  fitFormats?: boolean;
  /**
   * Value-track growth cap in SVG and React frame fill. Default 2.5.
   * false removes the cap. The label track takes the remaining width.
   * Also caps React container fit growth.
   */
  maxGrowth?: number | false;
  /**
   * Draw outline or fold marks beside parent rows in static SVG/PNG and
   * read-only grids. Default false: no marks or gutter. true draws the
   * marks and reserves their gutter. Interactive grids keep their fold
   * buttons either way.
   */
  outlineMarks?: boolean;
  /**
   * Where a tree table's labels start, in px from the row's edge with the
   * cell air included, as a table ladder is usually written: rung 0
   * at `base`, each rung `step` further (default 16). A label never starts
   * inside the cell air. Absent, static output and read-only grids start at the cell air.
   * outlineMarks: true and interactive grids add a 24 px mark gutter.
   */
  labelIndent?: { base: number; step?: number };
}

// ---------- resolved model (frozen downstream interfaces) ----------

export interface ResolvedCell {
  rowId: Id;
  colId: Id;
  kind: ColumnKind;
  raw: number | string | null;
  state: CellState;
  displayed: string; // final string incl. state glyphs
  note?: string;
  tone: CellTone;
  /** The value band this cell fell in (`TableCellObject.bands`): its label and bounds. `from` is the bound of the band below, absent for the first band. */
  band?: { to: number; from?: number; label?: string };
  href?: string;
  deEmphasized?: boolean; // materiality
  /**
   * The figure prints as zero at its own precision ("0.0%" for −0.02 %) and
   * nothing else colours it: no tone, no materiality mute. It is
   * drawn in the tertiary ink, never the text colour, on the SVG and in the
   * grid alike.
   */
  zero?: true;
  /** The authored heat opt-out: no ground, the muted ink. */
  heat?: false;
  /** The authored strong judgment (`TableCellObject.strong`). */
  strong?: true;
  /** The authored size mark, 0 to 1 (`TableCellObject.bar`). */
  bar?: number;
  /** The cell prints the negative of `raw`, because its row carries sign -1. An arrow and a sort read the printed figure. */
  negated?: true;
  /**
   * The direction that judges this figure, where one does: the row's over
   * the column's in a judged column, the row's on a change. A heat ground and
   * an in-cell bar read it, since `tone` stays neutral on context rows.
   */
  polarity?: Direction;
  /** The value cell's own format-by-example, where it names one; it beats the row's and the column's. */
  format?: string;
  scenario?: Scenario;
  role: RowRole;
  relation: RowRelation;
  level: number;
}

export interface ResolvedColumn {
  id: Id;
  kind: ColumnKind;
  label: string;
  /** Authored second head line, printed under the label at the micro step. */
  subLabel?: string;
  /** A total in this column skipped a missing value: the head carries the partial-aggregate mark. */
  partial?: true;
  format?: string; // the RESOLVED example (deterministic from data+options)
  scenario?: Scenario;
  polarity?: Direction;
  aggregate: 'sum' | 'none' | 'source';
  groupId?: Id;
  toggleGroup?: Id;
  width?: number;
  maxWidth?: number;
  maxTextWidth?: number;
  /** Text column authored with wrap: true, so prose wraps instead of widening the table. */
  wrap?: boolean;
  /** Status column authored with mark: 'square'. */
  statusMark?: 'square';
  encoding?: EncodingColumn['encoding'];
  /** Resolved option-driven cell encoding for renderer parity. */
  cellEncoding?: ResolvedCellEncoding;
  /** Authored column emphasis; renderers paint it, layout never moves for it. */
  emphasis?: ColumnEmphasis;
  /** Authored column band; the ground and hairline of a banded column run. */
  band?: boolean;
  /** Authored `noteLine`: this column's cell notes print as a second line. */
  noteLine?: boolean;
  align: 'left' | 'right' | 'center';
  /** Money unit hoisted out of cells when table units are MIXED. */
  unitLabel?: string;
  /** The hoisted unit names a magnitude the cells print without ("$k"), so a raw value drops it. */
  unitScaled?: true;
  /** Each cell prints its own magnitude ("950.0k", "1.1M"), so no unit names one. */
  magnitudeInCells?: true;
}

export interface ResolvedRow {
  /** Authored statement sign and closing rule. */
  sign?: -1;
  final?: true;
  /** Resolved operator glyph; only present in operators mode. */
  operator?: TableRow['operator'];
  kind?: TableRow['kind'];
  /** A driver row whose tones show (`options.driverTones`), decided once here so the SVG and the grid agree. */
  driverTone?: true;
  /** The authored divider (`TableRow.divider`): the line above the row in the rule ink. */
  divider?: true;
  id: Id;
  label: string;
  parentId?: Id;
  hasChildren: boolean;
  /** Present iff hasChildren. */
  defaultExpanded?: boolean;
  level: number;
  /**
   * The rung this row takes on the level ladder: size, weight, air, ground,
   * indent and label ink. It is the row's depth with SECTION HEADINGS
   * skipped, shifted by `options.levelOffset` (a total excepted) and
   * floored at 0, so the KPI rows under a section heading read as the top
   * rung, as a KPI board reads them. `level`
   * stays the authored depth.
   */
  step: number;
  role: RowRole;
  relation: RowRelation;
  order: number; // final display order (totalPosition resolved)
  /** Authored polarity of a calc row; an inline line with one is a signed change. */
  polarity?: Direction;
  /** This row prints as a line inside its parent's cells, never as a row. */
  inline?: true;
  /** The switch that hides this line; defaults to the row id. */
  inlineGroup?: Id;
  /** A parent's inline lines, in authored order. Absent where there are none. */
  inlineRows?: ResolvedRow[];
  /** Present only when the row is selected by options.highlight. */
  highlightTone?: RowHighlightTone;
  /**
   * The unit this row's label carries after its label ('$k', '# orders'),
   * in the muted ink at the ladder's inline step: authored as
   * `rows[].unitAffix`, or hoisted out of the cells by a forced magnitude,
   * which wins. It is its own field and not a cell note, because a note is a
   * second line and a host's own note must keep it.
   */
  unitAffix?: string;
  /** Authored `spacer`: empty px before the row. */
  spacer?: number;
  /** Present only on a parent the reader cannot fold. */
  foldable?: false;
  /** A section heading's status chip, its tone resolved. */
  badge?: { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' };
  cells: Record<Id, ResolvedCell>;
}

export interface ResolvedTable {
  columns: ResolvedColumn[];
  columnGroups: { id: Id; label: string; columnIds: Id[]; band?: boolean; note?: string; spacer?: number; heading?: boolean; hoverSeries?: 'shown' | 'all' }[];
  columnToggles: {
    id: Id;
    label: string;
    columnIds: Id[];
    defaultVisible: boolean;
    visible: boolean;
  }[];
  rows: ResolvedRow[]; // in display order
  /** Uniform money unit hoisted out of every cell ("in €M"). */
  unit?: string;
  /** Authored nouns for the children of each level; absent means no collapsed hint. */
  levelNouns?: LevelNoun[];
  footnotes: string[]; // auto (rounding/partial) + authored
  /** Columns whose aggregates skipped a null child; the partial footnote shows only while one of them is drawn. */
  partialColumnIds?: Id[];
  /** Judgments paint in theme.color.colorblind, so the notes name the good tone, not green. */
  colorblindSafe?: true;
  provenance: { source?: string; generatedNote?: string };
}

/** The claims sidecar consumes these verbatim. */
export interface ComputedCellRecord {
  rowId: Id;
  colId: Id;
  op: string;
  /**
   * `role` distinguishes two operands drawn from the SAME cell — the raw value
   * and the value that cell prints. `rounding-gap@1` needs both of every cell
   * it reconciles, and without the role the two would collapse onto one ref
   * (`dept-0:mtdActual` twice) and the reader could not tell which was which.
   * Omitted everywhere else, so every existing record is byte-identical.
   */
  inputs: {
    rowId: Id;
    colId: Id;
    /** null only on a non-derivation record, where `state` says why. */
    value: number | null;
    role?: 'raw' | 'displayed';
    state?: Exclude<CellState, 'value'>;
  }[];
  raw: number | null;
  state: CellState;
  displayed: string;
  /**
   * `unaudited` is the ONE kind here that promises no arithmetic: the engine
   * produced no number and says which children stopped it. It exists so that a
   * cell with nothing to derive leaves a record explaining itself instead of
   * either (a) a `sum` receipt over no operands or (b) silence.
   */
  kind: 'calc' | 'aggregate' | 'reconciliation' | 'rounding-adjustment' | 'unaudited';
}

export interface TableDerived {
  table: ResolvedTable;
  computedCells: ComputedCellRecord[];
}

/** Encoding emitters are layout plugins (renderers add nothing). */
export interface EncodingContext {
  cell: ResolvedCell;
  box: Rect; // emit INSIDE this box, never claim outside it
  theme: Theme;
  /** Named semantic palette retained for symbolic renderer paints. */
  palette?: string;
  /** A toned cell's text colour on its row's ground. */
  toneInk?: Paint;
  measure: TextMeasurer;
  nodeId: (suffix: string) => Id;
  owner: { rowId: Id; colId: Id };
}
