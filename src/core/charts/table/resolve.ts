/**
 * resolveTable(): authored data → ResolvedTable + ComputedCellRecords
 * All calc math runs on RAW values; every fact
 * rounds conventionally ONCE against a display spec resolved from data
 * only; verification records verify — they never overwrite.
 */

import { disclosuresShown } from '../../notes';
import { bandFor } from '../../bandSelect';
import { datePatternFromExample, formatDate, parseISODate } from '../../dateFormat';
import { currencyWholeNumbers, MINUS } from '../../format';
import { MAX_FORMAT_DECIMALS, nonzeroDecimals, typicalDecimals, withSmallValues, zeroLifts } from '../../formatPrecision';
import { unitPrinted } from '../../frame';
import {
  AUTOMATIC_FORMAT,
  type AutomaticFormatSource,
  MAGNITUDE_GROUP,
  type MagnitudeGroupSource,
  formatWithSpec,
  parseFormatExample as parseExample,
  effectiveScale,
  roundedNumber,
  nonAdditiveSpec,
  specUnitKind,
  unitOfSpec,
  MAGNITUDE_DIVISOR,
  magnitudeLabel,
  MAGNITUDE_LABEL,
  sameUnit as sameUnitText,
  type NumberFormatSpec,
} from '../../formatSpec';
import { NormalizeError, resolveHighlight, resolveSubtitle } from '../../normalize/shared';
import { resolveTheme } from '../../theme';
import { localeStrings } from '../../strings';
import type { Theme } from '../../types/theme';
import { closestKey } from '../../schema/unknownKeyWords';
import { tableCellKey } from './cellKey';
import { isCohortDensity } from './ladder';
import { presetLanguage } from './presets';
import type { Id, Direction } from '../../types/cell';
import type { LintWarning } from '../../types/scene';
import type {
  Calc,
  CalcCellRef,
  CellState,
  CellTone,
  ComputedCellRecord,
  ResolvedCell,
  ResolvedCellEncoding,
  TableCellEncoding,
  ResolvedColumn,
  ResolvedRow,
  ResolvedTable,
  RowRelation,
  RowRole,
  TableCell,
  TableCellObject,
  TableColumn,
  TableData,
  TableOptions,
  TableRow,
  TotalPolicy,
} from '../../types/table';
import { previousColumnInGroup, readCalcInput, resolveCalcRef } from './calcRef';
import { calcFlipsWithInputs, calcIsLinear, calcPreservesScale, calcYieldsPoints, columnOwnsFormat } from '../../tableCalc';
import {
  additiveRankKey,
  assertTableRankOptions,
  foldTableTopN,
  ranksAsData,
  requireAdditiveRanking,
} from './rank';
import { BADGE_SECTION_ONLY, BADGE_TEXT_EMPTY, STATUS_VALUES } from './rules';
import { ARROW_FOOTNOTE } from './encodings/arrow';
import { heatRanges, statusDirectionNote } from './encodings/heat';
import { chartNumberMarks } from '../../numberMarks';
import { minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface ResolveResult {
  table: ResolvedTable;
  computedCells: ComputedCellRecord[];
  warnings: LintWarning[];
  /** An automatic format printed a nonzero value with extra digits so it does not read as 0. */
  lifted?: true;
}

/**
 * How an automatic format prints a nonzero value that rounds to 0: full
 * digits (default), the compact bound ("<0.1"), or 'none', the plain rounded
 * text, which width fitting measures. The layout picks it.
 */
export const ZERO_LIFT = Symbol('tableZeroLift');
export type ZeroLiftOptions = { [ZERO_LIFT]?: 'none' | 'compact' };

/**
 * State glyph policy: missing '—' · notApplicable 'n/a'
 * · notMeaningful 'n.m.' · suppressed '—' PLUS a mandatory footnote marker.
 * The marker is not decoration: withheld and absent are different facts about
 * the world, and a bare '—' for both tells the reader they are the same one.
 */
export const SUPPRESSED_MARKER = '*';
export const STATE_GLYPHS: Record<Exclude<CellState, 'value'>, string> = {
  missing: '—',
  na: 'n/a',
  nm: 'n.m.',
  suppressed: `—${SUPPRESSED_MARKER}`,
  // An open period prints nothing: the band ground under the cell
  // says the period has not happened, and no theme glyph replaces that.
  open: '',
};

/**
 * The glyphs a theme's table prints: `table.glyphs` over the
 * frozen set. The suppressed marker is appended to whatever dash the theme
 * writes, because the footnote that explains it is keyed to the marker.
 */
function stateGlyphs(theme: Theme | undefined, notApplicable: string = STATE_GLYPHS.na): Record<Exclude<CellState, 'value'>, string> {
  const own = theme?.table?.glyphs;
  // The n/a word comes from the locale strings ('k. A.' in German); a theme glyph still wins.
  if (own === undefined) return { ...STATE_GLYPHS, na: notApplicable };
  return {
    missing: own.missing ?? STATE_GLYPHS.missing,
    na: own.na ?? notApplicable,
    nm: own.nm ?? STATE_GLYPHS.nm,
    suppressed: own.suppressed === undefined ? STATE_GLYPHS.suppressed : `${own.suppressed}${SUPPRESSED_MARKER}`,
    open: STATE_GLYPHS.open,
  };
}

/** The largest percent change a table prints; past it the cell is n.m. */
export const PERCENT_DELTA_CAP = 999;

const ROUNDING_FOOTNOTE = 'Figures may not add due to rounding.';
/**
 * A heat lane on the 'column' scale (the default) ranks each column against
 * itself, so a low figure in one column can shade darker than a higher one
 * beside it. With two or more such columns nothing else tells the reader, and
 * the printed figures alone do not say it.
 */
const HEAT_COLUMN_FOOTNOTE = 'Shading compares values within each column, not across columns.';
/** The mark on the head of a column whose total skipped a missing value, and on its note. */
export const PARTIAL_MARKER = '†';
export const PARTIAL_FOOTNOTE = `${PARTIAL_MARKER} Partial aggregate: missing values skipped.`;
/** Carries the same marker the glyph does, so the tie survives numbering. */
export const SUPPRESSED_FOOTNOTE = `${SUPPRESSED_MARKER} Suppressed: value withheld, not missing.`;

/**
 * Which non-value state a derived cell inherits when several block it.
 * Withholding outranks judgment: a cell computed from a suppressed input must
 * not re-publish the suppression as a mere '—'. 'missing' is last — it is the
 * absence of a reason, so any stated reason beats it.
 */
const STATE_PRECEDENCE: Exclude<CellState, 'value'>[] = ['suppressed', 'open', 'nm', 'na', 'missing'];
const STATE_REASON: Record<Exclude<CellState, 'value'>, string> = {
  missing: 'missing',
  na: 'not applicable (n/a)',
  nm: 'not meaningful (n.m.)',
  suppressed: 'suppressed',
  open: 'an open period',
};

function dominantState(states: CellState[]): Exclude<CellState, 'value'> {
  for (const candidate of STATE_PRECEDENCE) {
    if (states.includes(candidate)) return candidate;
  }
  return 'missing';
}

/**
 * The header string a column publishes, EXCLUDING typography. Scenario and
 * unit ride the header whenever the unit did not hoist to the frame; every
 * surface (SVG layout, HTML, React) must print the same affix or the same
 * table states two different money scales depending on where it is read.
 */
/**
 * Whether a forced magnitude reaches this format. A format that already
 * names a scale does, and so does a currency that names none: "$1,234" is
 * money written without a scale letter, and a board in thousands would leave it at
 * "$1,234,000" beside its own "1,234". A percent, a
 * difference in points and a bare count are not money and keep what they
 * say, because `unitOfSpec` answers null for all three.
 */
function scalesWithMagnitude(spec: NumberFormatSpec): boolean {
  return spec.magnitude !== 'none' || unitOfSpec(spec) !== null;
}

/**
 * The scale a forced magnitude writes into a format. A locked scale reaches
 * four and five digits, and "11300" is the number nobody reads, so a format
 * that never needed grouping takes the locale's separator. A format that
 * named NO scale of its own ("$1,234") also takes one decimal at the
 * million step: its zero was written for units, and at a million scale it
 * would print "0" for 74,500.
 */
/**
 * An authored format prints in its own unit: '$0k' prints 2,496,000 as
 * "$2,496k", not "$2.5M" beside "$640k" in the same column. A held scale
 * reaches four digits, so a format without grouping takes the locale's
 * mark, or the other mark where the locale's is the format's decimal mark.
 */
function holdAuthoredScale(spec: NumberFormatSpec, thousands: NumberFormatSpec['thousandsSep']): void {
  if (spec.magnitude === 'none' || spec.lockMagnitude) return;
  spec.rollMagnitude = false;
  if (spec.thousandsSep === '') spec.thousandsSep = spec.decimals > 0 && thousands === spec.decimalSep ? (spec.decimalSep === ',' ? '.' : ',') : thousands;
}

function forceScale(
  spec: NumberFormatSpec,
  magnitude: 'k' | 'm',
  thousands: NumberFormatSpec['thousandsSep'],
): void {
  if (spec.magnitude === 'none' && magnitude === 'm') spec.decimals = Math.max(spec.decimals, 1);
  spec.magnitude = magnitude;
  spec.lockMagnitude = true;
  if (spec.thousandsSep === '') spec.thousandsSep = thousands;
}

/**
 * The scale letter a hoisted unit already carries, taken off the figure:
 * "11,300.0k" becomes "11,300" once "$k" stands on the row's label or in
 * the column header.
 */
/** Whether two specs print the same unit and differ at most in their decimals. */
function sameUnit(a: NumberFormatSpec, b: NumberFormatSpec): boolean {
  return a.prefix === b.prefix && a.suffix === b.suffix && a.magnitude === b.magnitude && a.signed === b.signed
    && a.negative === b.negative && a.thousandsSep === b.thousandsSep && a.decimalSep === b.decimalSep;
}

function stripMagnitude(text: string, spec: NumberFormatSpec): string {
  const label = magnitudeLabel(spec, spec.magnitude);
  if (!label) return text;
  return text.endsWith(')')
    ? text.replace(`${label})`, ')')
    : text.endsWith(label) ? text.slice(0, -label.length) : text;
}

/** Float noise from magnitude math (bn-scale): a gap this small between two figures is no disagreement. */
const floatNoise = (a: number, b: number): number => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export function columnHeaderAffix(column: {
  scenario?: string;
  unitLabel?: string;
  partial?: true;
}): string {
  const affix = [column.scenario, column.unitLabel].filter(Boolean).join(', ');
  // The partial-aggregate note names the column it is about.
  return `${affix ? ` (${affix})` : ''}${column.partial ? ` ${PARTIAL_MARKER}` : ''}`;
}

interface FlatRow {
  sign?: -1;
  operator?: TableData['rows'][number]['operator'];
  final?: true;
  kind?: TableData['rows'][number]['kind'];
  divider?: true;
  scale?: TableData['rows'][number]['scale'];
  rung?: number;
  id: Id;
  label: string;
  parentId: Id | null;
  role: RowRole;
  relation: RowRelation;
  totalPolicy?: TotalPolicy;
  calc?: Calc;
  format?: string;
  polarity?: Direction;
  /** Printed as a line inside the parent's cells rather than as a row. */
  inline?: true;
  inlineGroup?: Id;
  /** Authored affix beside the label; a forced magnitude overrides it. */
  unitAffix?: string;
  /** What this row's missing cells print; absent takes `options.nulls`. */
  missing?: 'blank' | 'dash';
  /** Authored empty px before the row. */
  spacer?: number;
  /** A parent the reader cannot fold. */
  foldable?: false;
  /** A section heading's status chip. */
  badge?: TableData['rows'][number]['badge'];
  cells: Record<Id, TableCell>;
  level: number;
  order: number; // document order
}

export function resolveTable(data: TableData, options: TableOptions = {}, magnitudeSource: TableData = data): ResolveResult {
  // The React grid, its server snapshot and DimSwitch resolve outside a chart layout: each follows the table's smallValues mode.
  return withSmallValues(options.smallValues, () => resolveTableIn(data, options, magnitudeSource));
}

function resolveTableIn(data: TableData, options: TableOptions, magnitudeSource: TableData): ResolveResult {
  const liftsBefore = zeroLifts.count;
  const liftMode = (options as ZeroLiftOptions)[ZERO_LIFT];
  const automaticAs = (on: boolean): NumberFormatSpec['automatic'] => on && liftMode !== 'none' ? liftMode ?? true : false;
  // Formats repeat across cells; each caller still gets its own mutable spec.
  const formats = new Map<string, NumberFormatSpec>();
  // Every entry (resolveChartRequest, the registry layout) has put the chart's marks into the language tag.
  const markedLanguage = options.locale?.language;
  const parseFormatExample = (example: string): NumberFormatSpec => {
    let spec = formats.get(example);
    if (spec === undefined) {
      spec = parseExample(example);
      // The chart's marks replace the example's own (numberMarks.ts).
      spec.locale = markedLanguage;
      formats.set(example, spec);
    }
    return { ...spec };
  };
  const warnings: LintWarning[] = [];
  data.columns.forEach((column, index) => {
    if (column.kind !== 'status') return;
    for (const [key, label] of Object.entries(column.labels ?? {})) {
      if (typeof label !== 'string' || label.trim() !== '') continue;
      warnings.push({
        code: 'status-label-blank',
        severity: 'warn',
        message: `status label '${key}' in column '${column.id}' contains only whitespace and draws blank. A later release refuses this label.`,
        owner: { colId: column.id },
        field: ['data', 'columns', index, 'labels', key],
        suggest: 'Give the status a visible label, or remove this label so the status key prints.',
        fix: [{ op: 'remove', path: `/data/columns/${index}/labels/${key}` }],
      });
    }
  });
  // A cell key that names a column almost, but not quite, draws nothing: the number vanishes without a word.
  // A key far from every column, or beside a column the row also fills, is data the author left out of the columns on purpose, so it stays quiet.
  // One warning per key keeps the response small on a wide row set.
  const columnIds = data.columns.map((column) => column.id);
  const columnIdSet = new Set(columnIds);
  // closestKey depends on the key alone, so each distinct key is measured once, not once per row.
  const nearColumn = new Map<string, string | undefined>();
  const unknownKeys = new Map<string, { row: TableData['rows'][number]; rowPath: (string | number)[]; near: string; rows: number }>();
  const checkCellKeys = (rows: TableData['rows'], path: (string | number)[]): void => {
    rows.forEach((row, index) => {
      const rowPath = [...path, index];
      for (const key of Object.keys(row.cells ?? {})) {
        if (columnIdSet.has(key)) continue;
        if (!nearColumn.has(key)) {
          const nearest = closestKey(key, columnIds);
          nearColumn.set(key, nearest?.near ? nearest.key : undefined);
        }
        const near = nearColumn.get(key);
        // The near column holds a cell in this row too: the key is another column, left out on purpose.
        if (near === undefined || Object.hasOwn(row.cells!, near)) continue;
        const seen = unknownKeys.get(key);
        if (seen) seen.rows += 1;
        else unknownKeys.set(key, { row, rowPath, near, rows: 1 });
      }
      if (row.children) checkCellKeys(row.children, [...rowPath, 'children']);
    });
  };
  // The authored rows: a fitted resolution rewrites cell formats, which the repair patch must not test.
  checkCellKeys(magnitudeSource.rows, []);
  for (const [key, { row, rowPath, near, rows }] of unknownKeys) {
    const cells = row.cells!;
    warnings.push({
      code: 'cell-column-unknown',
      severity: 'warn',
      message: `cell '${key}' in row '${row.id}'${rows > 1 ? ` and ${rows - 1} more` : ''} names no column, so its value is not drawn; did you mean '${near}'?`,
      owner: { rowId: row.id },
      field: ['data', 'rows', ...rowPath, 'cells', key],
      suggest: `Rename the cell key to '${near}'.`,
      // A patch for the first row only would leave the others; a key in several rows gets the suggestion alone.
      ...(rows > 1 ? {} : {
        fix: [
          { op: 'test', path: `/data/rows/${rowPath.join('/')}/cells`, value: cells },
          { op: 'replace', path: `/data/rows/${rowPath.join('/')}/cells`, value: Object.fromEntries(Object.entries(cells).map(([name, value]) => [name === key ? near : name, value])) },
        ],
      }),
    });
  }
  const records: ComputedCellRecord[] = [];
  const autoFootnotes = new Set<string>();
  /** Row labels whose changes took a tone, by the direction that judged them. */
  const lowerJudged = new Set<string>();
  const higherJudged = new Set<string>();
  // Columns whose aggregate skipped a null child: the partial footnote is theirs.
  const partialColumnIds = new Set<Id>();
  const highlightedRows = new Set(resolveHighlight(options.highlight));
  assertTableRankOptions(options);
  const folded = applyTableTopN(data, options);
  data = folded.data;
  const generatedOthers = folded.generatedOthers;

  // What the preset means, in one place: the look is the library's
  // and identical on all five, so the preset only supplies these defaults.
  const language = presetLanguage(options.variant);
  /**
   * What a MISSING cell prints. A cohort staircase is mostly not
   * yet observed, and a triangle of em dashes is noise the reader has to
   * look past; `nulls: 'blank'` leaves those cells empty. The stated
   * non-values keep their glyphs, because withheld is not absent.
   */
  // The theme's glyphs and its answer for a change with no previous column.
  // A table with no theme option draws the default theme, so it reads that.
  const theme = resolveTheme(options.theme);
  const glyphs = stateGlyphs(theme, options.strings?.notApplicable ?? localeStrings(options.locale?.language).notApplicable);
  /**
   * A calc that reads the previous member of its column
   * has no value in a group's first member or outside a group. Each such
   * cell prints the row's dash, the glyph its empty computed cells print,
   * so the row shows one marker for "no value"; never the n/a word, never a
   * blank beside a dash. A theme that names its own answer
   * (`table.noPrevious`) keeps it.
   */
  const previousPlaceholders = theme?.table?.noPrevious === undefined;
  const noPrevious = theme?.table?.noPrevious ?? 'na';
  // A cohort grid is the table twin of the cohort chart and prints its
  // unobserved cells with the chart's en dash, where the
  // theme names no glyph of its own.
  const cohortDash = isCohortDensity(options.density ?? 'regular') && theme?.table?.glyphs?.missing === undefined ? '\u2013' : glyphs.missing;
  const tableMissingGlyph = options.nulls === 'blank' ? '' : cohortDash;
  /**
   * One meaning per mark: a value the data does not
   * have prints the n/a word ('k. A.' in German), and the muted dash stays
   * for the structural cells with nothing to compare. An authored
   * `missing`, a table-wide `nulls: 'blank'`, a cohort grid and a theme glyph
   * keep their own glyph; `table.dataGap` names the answer outright.
   */
  const dataGap = theme?.table?.dataGap ?? (theme?.table?.glyphs?.missing === undefined ? 'word' : 'glyph');
  const gapWord = options.nulls !== 'blank'
    && !isCohortDensity(options.density ?? 'regular') && dataGap === 'word';

  // ---- columns: structural validation ----
  const columns = data.columns;
  const colById = new Map<Id, TableColumn>();
  for (const c of columns) {
    if (colById.has(c.id)) {
      throw new NormalizeError('duplicate-column-id', `columns[${c.id}]`, `duplicate column id '${c.id}'`);
    }
    colById.set(c.id, c);
  }
  const rowLabelCols = columns.filter((c) => c.kind === 'rowLabel');
  if (rowLabelCols.length !== 1) {
    throw new NormalizeError(
      'row-label-count',
      'columns',
      `exactly one rowLabel column required, found ${rowLabelCols.length}`,
    );
  }
  validateGroups(data, colById);
  validateCalcRefs(columns, colById);
  const toggleResolution = resolveColumnToggles(data, options, colById, warnings);

  // ---- rows: flatten (nested sugar → flat canonical), uniqueness, levels ----
  const flat = flattenRows(data.rows);
  const flatById = new Map(flat.map((row) => [row.id, row]));
  // `previous` reads the member before the cell's column in its columnGroup.
  // Row calcs run in value columns and scale-keeping computed ones; any value or computed column
  // (a ratio too) can be the member they read. With no such pair, every such cell prints the dash;
  // a group over a label and a status column changes nothing.
  const calcRunIds = new Set(columns.filter((c) => c.kind === 'value' || (c.kind === 'computed' && calcPreservesScale(c.calc))).map((c) => c.id));
  const predecessorIds = new Set(columns.filter((c) => c.kind === 'value' || c.kind === 'computed').map((c) => c.id));
  if (![...calcRunIds].some((id) => predecessorIds.has(previousColumnInGroup(data.columnGroups ?? [], id) ?? ''))) {
    for (const row of flat) {
      if (row.calc === undefined || !calcRefs(row.calc).some((ref) => typeof ref !== 'string' && ref.previous === true)) continue;
      warnings.push({
        code: 'calc-previous-ungrouped',
        severity: 'warn',
        message: `row '${row.id}' reads the previous period ({ row, previous: true }), but no value column has a value column before it in its columnGroup, so every cell of the row prints the missing dash`,
        owner: { rowId: row.id },
        suggest: 'Add a columnGroups entry that lists the period value columns in order, e.g. { id: "months", columns: ["jan", "feb", "mar"] }.',
      });
    }
  }
  // The rung shift a board authors: the ladder's own steps stay
  // where they are and every row moves together.
  const levelOffset = Math.trunc(options.levelOffset ?? 0);
  const childrenOf = new Map<Id | null, FlatRow[]>();
  for (const r of flat) {
    const list = childrenOf.get(r.parentId) ?? [];
    list.push(r);
    childrenOf.set(r.parentId, list);
  }
  // An inline row is drawn inside its parent's cells, not under it, so it is
  // no child as far as the tree is concerned: a KPI whose only children are
  // its MoM and YoY lines is a leaf with no fold mark and no group ground.
  // Everything that reads the accounting model keeps the full `childrenOf`.
  const treeChildrenOf = new Map<Id | null, FlatRow[]>();
  for (const [parentId, list] of childrenOf) {
    const kept = list.filter((child) => child.inline !== true);
    if (kept.length > 0) treeChildrenOf.set(parentId, kept);
  }
  const expansion = resolveExpansion(flat, treeChildrenOf, options, warnings, generatedOthers);

  // ---- the accounting model: WHICH rows are summands of which parent ----
  // Resolved ONCE here and reused by aggregation, the rounding-gap check and
  // the share denominator — three sites that must never disagree about what
  // adds up to what:
  //   · relation ofWhich/displayOnly → never a summand (display ≠ accounting)
  //   · role 'section' → an unruled group HEADER with no cells; it is
  //     transparent, so its own summands belong to its nearest non-section
  //     ancestor (a section may not swallow its children out of the total)
  //   · role 'total' → RESTATES its additive siblings, so it is not one of
  //     them (orderRows hoists it for display for the same reason). Sole
  //     exception: when a parent has no non-total additive child there is
  //     nothing to restate, and the total rows ARE the accounting model.
  // ORDER IS LOAD-BEARING: sections are dissolved FIRST, and the restatement
  // question is then asked ONCE over the hoisted set at the destination level.
  // Asked per authored level instead, a total that is the only additive child
  // of a section finds "nothing to restate" inside that section and rides
  // upward as a summand — double-counting the ancestor, silently.
  // Sections are transparent. Include their signs in each hoisted summand.
  const signTo = (row: FlatRow, stop: Id | null): number => contributionSignOf(row, (id) => flatById.get(id), stop);
  const summandCache = new Map<Id | null, FlatRow[]>();
  const summandsOf = (parentId: Id | null): FlatRow[] => {
    const cached = summandCache.get(parentId);
    if (cached) return cached;
    const hoisted: FlatRow[] = [];
    const dissolveSections = (pid: Id | null): void => {
      for (const k of childrenOf.get(pid) ?? []) {
        if (k.relation !== 'additive') continue;
        if (k.role === 'section') dissolveSections(k.id);
        else hoisted.push(k);
      }
    };
    dissolveSections(parentId);
    const restated = hoisted.some((k) => k.role !== 'total');
    const out = restated ? hoisted.filter((k) => k.role !== 'total') : hoisted;
    summandCache.set(parentId, out);
    return out;
  };

  /**
   * Percentages, percentage points and multiples do not add, and neither do
   * summand rows in different formats: three margins of 12.5%, 8% and
   * 10% printed a "30.5%" total. The parent's own format counts too: a "1.0%"
   * parent over plain 8 and 10 printed "18.0%". A parent in a coarser unit of
   * the same kind ("$1m" over "1.0m") still adds. Such a parent aggregates to
   * 'none' unless the author asks for a sum, and an authored sum there is
   * warned once per column.
   */
  // The table's cached parse feeds the shared predicate: it runs for every summand cell.
  const nonAdditiveFormat = (format: string | undefined): boolean => !!format && nonAdditiveSpec(parseFormatExample(format));
  // A cell's own format counts where it sits: a pp change among summands does not add either.
  const formatAt = (row: FlatRow, colId: Id): string | undefined => cellFormat(row.cells[colId]) ?? row.format;
  // Decimals are no unit: "$1.2m" and "$1.23m" add, "$1.2m" and "$500k" do not.
  const unitOf = (format: string): string => {
    if (!format) return '';
    const spec = parseFormatExample(format);
    return `${spec.prefix}\u0000${spec.suffix}\u0000${spec.magnitude}`;
  };
  const nonAdditiveSum = (col: Extract<TableColumn, { kind: 'value' }>, row: FlatRow, kids: readonly FlatRow[]): boolean =>
    nonAdditiveFormat(col.format) || [row, ...kids].some((k) => nonAdditiveFormat(formatAt(k, col.id))) ||
    new Set(kids.map((k) => unitOf(formatAt(k, col.id) ?? col.format ?? ''))).size > 1;
  const aggregateFor = (col: Extract<TableColumn, { kind: 'value' }>, row: FlatRow): 'sum' | 'none' | 'source' =>
    col.aggregate ?? (nonAdditiveSum(col, row, summandsOf(row.id)) ? 'none' : 'sum');
  const warnedNonAdditive = new Set<Id>();

  // ---- raw evaluation: value columns bottom-up, then computed per row ----
  // rawOf[rowId][colId] = number | null ('missing') | CellState for na/nm/suppressed
  const rawState = new Map<Id, Map<Id, CellEval>>();
  for (const r of flat) rawState.set(r.id, new Map());
  for (const [id, row] of folded.hidden) rawState.set(id, new Map(row.states));

  const valueCols = columns.filter((c) => c.kind === 'value') as Extract<TableColumn, { kind: 'value' }>[];
  const postOrder = orderPostfix(childrenOf);

  for (const row of postOrder) {
    // a section is a group header with no cells and its summands
    // belong to its nearest non-section ancestor — evaluating it here would
    // only duplicate that ancestor's lints against a row that renders nothing
    if (row.role === 'section') continue;
    const states = rawState.get(row.id)!;
    for (const col of valueCols) {
      states.set(col.id, evalValueCell(row, col));
    }
  }
  // A total row restates its siblings. Where it prints the sum of the siblings
  // that carry a value while one is missing or partial, it is that partial sum.
  for (const row of flat) {
    // A 'source' total is the author's own figure (a cohort's weighted closer), not a restated sum.
    if (row.role !== 'total' || row.totalPolicy === 'source' || summandsOf(row.id).length > 0) continue;
    const siblings = summandsOf(row.parentId);
    if (siblings.includes(row) || siblings.length === 0) continue;
    for (const col of valueCols) {
      const own = rawState.get(row.id)!.get(col.id)!;
      if (own.state !== 'value' || typeof own.raw !== 'number' || own.partial || aggregateFor(col, row) !== 'sum') continue;
      let sum = 0;
      const skipped: string[] = [];
      for (const sibling of siblings) {
        const state = rawState.get(sibling.id)!.get(col.id);
        if (state?.state === 'value' && typeof state.raw === 'number') { sum += signTo(sibling, row.parentId) * state.raw; if (state.partial) pushAll(skipped, skippedRows(state)); }
        else skipped.push(sibling.id);
      }
      if (skipped.length > 0 && Math.abs(sum - own.raw) <= floatNoise(own.raw, sum)) rawState.get(row.id)!.set(col.id, { ...own, partial: true, skipped: skippedKey(skipped) });
    }
  }

  function evalValueCell(
    row: FlatRow,
    col: Extract<TableColumn, { kind: 'value' }>,
  ): { raw: number | null; state: CellState; partial?: true; skipped?: string } {
    const authored = readNumeric(row.cells[col.id]);
    if (authored.nonNumeric !== undefined) {
      // A quoted number in a value cell is not data the engine may guess at:
      // '1 234' / '1,234' / '1.234' mean different amounts in different
      // locales, so parsing it would invent a fact. It stays MISSING — but it
      // says so, because silently dropping it poisons the parent aggregate and
      // the share denominator with no trace at all.
      warnings.push({
        code: 'value-cell-not-numeric',
        severity: 'warn',
        message: `'${row.id}'.'${col.id}': ${JSON.stringify(authored.nonNumeric)} is a string in a value column — it is treated as MISSING (it drops out of aggregates and share denominators); author the number unquoted`,
        owner: { rowId: row.id, colId: col.id },
      });
    }
    const kids = summandsOf(row.id);
    const aggregate = aggregateFor(col, row);
    const isParent = kids.length > 0;
    if (isParent && col.aggregate === 'sum' && !warnedNonAdditive.has(col.id) && nonAdditiveSum(col, row, kids)) {
      warnedNonAdditive.add(col.id);
      warnings.push({
        code: 'aggregate-non-additive',
        severity: 'warn',
        message: `column '${col.id}' sums rows that do not add (a percentage, percentage points, a multiple, or rows in different formats): the parent '${row.id}' prints a sum that is no total`,
        owner: { rowId: row.id, colId: col.id },
        suggest: "drop aggregate: 'sum' so the parent shows its authored value, or author a weighted figure on the parent row",
      });
    }

    if (authored.state === 'na' || authored.state === 'nm' || authored.state === 'suppressed' || authored.state === 'open') {
      return { raw: null, state: authored.state };
    }
    if (!isParent || aggregate === 'none' || aggregate === 'source') {
      // leaf, or column that never aggregates: the author is the source
      return authored.raw === null
        ? { raw: null, state: 'missing' }
        : { raw: authored.raw, state: 'value' };
    }

    // parent with additive children: compute the sum
    const inputs: { rowId: Id; colId: Id; value: number }[] = [];
    // Blockers keep their OWN state. Lumping n/a, n.m. and suppressed into
    // "missing" made the lint accuse the author of a hole where the child had
    // in fact stated a reason — and printed the parent as '—' when the truth
    // was "withheld" or "not meaningful".
    const blockers: { id: Id; state: Exclude<CellState, 'value'> }[] = [];
    let sum = 0;
    let partialKid = false;
    const skippedKids: string[] = [];
    for (const kid of kids) {
      const ks = rawState.get(kid.id)!.get(col.id)!;
      if (ks.state === 'value' && typeof ks.raw === 'number') {
        const contribution = signTo(kid, row.id) * ks.raw;
        sum += contribution;
        if (ks.partial) { partialKid = true; pushAll(skippedKids, skippedRows(ks)); }
        inputs.push({ rowId: kid.id, colId: col.id, value: contribution });
      } else {
        blockers.push({ id: kid.id, state: ks.state as Exclude<CellState, 'value'> });
      }
    }
    const nulls = col.nulls ?? 'propagate';
    let derived: { raw: number | null; state: CellState; partial?: true; skipped?: string };
    /**
     * A SUM OF NO SUMMANDS IS NOT A TOTAL, under any nulls policy.
     *
     * With `nulls:'ignore'` and EVERY child blocked, this fell into the 'else'
     * below and produced `raw: 0, state: 'value'` — the parent printed a hard
     * "0" that nothing in the table supports — and then filed a
     * `kind:'aggregate', op:'sum@1', inputs: []` receipt for it. `verify` called
     * that `no-operands` and failed the whole document; it was right to, and the
     * displayed 0 was the deeper defect. (The 'validate' branch below had the
     * same shape waiting: a `reconciliation` receipt over the same empty set.)
     *
     * 'ignore' means "a hole among the children does not stop the total", not
     * "a column of holes IS a total". So the derived value fails closed to the
     * dominant child state with the usual visible glyph — and it is
     * still only the DERIVED value: `totalPolicy` still decides afterwards
     * whether the author's own total is what displays.
     */
    const noSummands = inputs.length === 0;
    /**
     * NOT a derivation, and deliberately not stamped as one: there is no
     * arithmetic to reproduce. What it carries is WHY the number is unaudited —
     * every child, with the state that blocked it — so suppressing the receipt
     * does not also suppress the reason.
     */
    const unauditedRecord = (): void => {
      records.push({
        rowId: row.id,
        colId: col.id,
        op: 'no-measured-summands',
        inputs: blockers.map((b) => ({
          rowId: b.id,
          colId: col.id,
          value: null,
          state: b.state,
        })),
        raw: null,
        state: dominantState(blockers.map((b) => b.state)),
        displayed: '',
        kind: 'unaudited',
      });
    };
    if (noSummands && blockers.every((b) => b.state === 'open')) {
      // Every child is an open period: the total is open too, and that is
      // not a gap anyone should be told about.
      derived = { raw: null, state: 'open' };
    } else if (noSummands) {
      const inherited = dominantState(blockers.map((b) => b.state));
      warnings.push({
        code: 'aggregate-no-summands',
        // INFO reports a data state without asking the author to change it.
        // Lints for generated documents split in two: 'warn'/'error' is for
        // cases a generator chooses DELIBERATELY (and must then declare, for
        // example in the title), 'info' is an honesty disclosure about a state
        // the data happened to reach. This is the second kind — it appears
        // when sibling leaves happen to be sparse in the same column, and no
        // title could announce it because nothing chose it.
        // It is also not actionable: there is no nulls policy under which an
        // empty set of summands honestly yields a number, so there is nothing
        // for the author to change. The reader is not left guessing either —
        // the cell prints the state glyph and this message names every child.
        // The twin below stays 'warn' on purpose: under 'propagate', values
        // that EXIST are being discarded, and switching the policy is a real
        // action the author can take.
        severity: 'info',
        message: `'${row.id}'.'${col.id}' is '${glyphs[inherited]}': not one of its ${kids.length} additive children carries a value (${blockers.map((b) => `'${b.id}' is ${STATE_REASON[b.state]}`).join(', ')}) — an empty sum is not a total`,
      });
      derived = { raw: null, state: inherited };
    } else if (blockers.length > 0 && nulls === 'propagate') {
      const inherited = dominantState(blockers.map((b) => b.state));
      warnings.push({
        code: 'aggregate-null-child',
        severity: 'warn',
        message: `'${row.id}'.'${col.id}' is '${glyphs[inherited]}' because ${blockers.map((b) => `child '${b.id}' is ${STATE_REASON[b.state]}`).join(', ')} (column nulls policy 'propagate')`,
      });
      derived = { raw: null, state: inherited };
    } else {
      if (blockers.length > 0) {
        autoFootnotes.add(PARTIAL_FOOTNOTE);
        partialColumnIds.add(col.id);
      }
      // A sum that skipped a child, or adds a partial one, prints marked on the cell.
      derived = { raw: sum, state: 'value', ...(blockers.length > 0 || partialKid ? { partial: true as const, skipped: skippedKey([...blockers.map((b) => b.id), ...skippedKids]) } : {}) };
    }

    const policy: TotalPolicy = row.totalPolicy ?? (authored.raw !== null ? 'validate' : 'derive');
    if (policy === 'source') {
      return authored.raw === null ? derived : { raw: authored.raw, state: 'value' };
    }
    if (policy === 'validate' && authored.raw !== null) {
      // Nothing was summed, so there is no reconciliation to record — only the
      // fact that the author's total stands unchecked, and why.
      if (noSummands) unauditedRecord();
      else
        records.push({
          rowId: row.id,
          colId: col.id,
          op: 'sum',
          inputs,
          raw: derived.raw,
          state: derived.state,
          displayed: '', // filled after formatting
          kind: 'reconciliation',
        });
      if (derived.raw !== null && Math.abs(derived.raw - authored.raw) > floatNoise(derived.raw, authored.raw)) {
        warnings.push({
          code: 'total-reconciliation',
          severity: 'warn',
          message: `'${row.id}'.'${col.id}': authored total ${authored.raw} differs from the sum of additive children ${derived.raw} (Δ ${authored.raw - derived.raw}); authored value displays (policy 'validate')`,
        });
        return { raw: authored.raw, state: 'value' };
      }
      // An authored total that matches a partial sum is that partial sum.
      return { raw: authored.raw, state: 'value', ...(derived.partial ? { partial: true as const, skipped: derived.skipped } : {}) };
    }
    // derive
    if (authored.raw !== null && policy === 'derive') {
      warnings.push({
        code: 'computed-overridden',
        severity: 'warn',
        message: `'${row.id}'.'${col.id}': authored value ${authored.raw} ignored — totals derive from children (policy 'derive'); use totalPolicy 'validate' or 'source' to keep it`,
      });
    }
    if (derived.raw !== null) {
      records.push({
        rowId: row.id,
        colId: col.id,
        op: 'sum',
        inputs,
        raw: derived.raw,
        state: 'value',
        displayed: '',
        kind: 'aggregate',
      });
    } else if (noSummands) {
      // The displayed cell IS this derived nothing, so the reason it is nothing
      // has to be on the record. (A 'propagate' blocker keeps its existing
      // behaviour: no record, and the warn above carries it.)
      unauditedRecord();
    }
    return derived;
  }

  // ---- share denominators: the exhaustive leaf partition of the model ----
  // The denominator is the column TOTAL, so it is the same set the root sums
  // over — the leaves reached by descending summandsOf(). A restating total
  // row, an 'of which' detail row and an aggregating parent are all excluded
  // by construction: counting any of them would count the same money twice.
  const leafRows: FlatRow[] = [];
  const collectLeafSummands = (parentId: Id | null): void => {
    for (const r of summandsOf(parentId)) {
      if (summandsOf(r.id).length === 0) leafRows.push(r);
      else collectLeafSummands(r.id);
    }
  };
  collectLeafSummands(null);
  partitionLeafIds.set(rawState, leafRows.map((r) => r.id));
  // Rows that topN.rest false omits still belong to the partition, so hiding a row leaves the other shares as they were.
  const hiddenLeaves = [...folded.hidden].filter(([, h]) => h.leaf);
  const leafTotal = (colId: Id): number | null => {
    let t = 0;
    for (const [s, sign] of [
      ...leafRows.map((r) => [rawState.get(r.id)!.get(colId), signTo(r, null)] as const),
      ...hiddenLeaves.map(([, h]) => [h.states.get(colId), h.sign] as const),
    ]) {
      if (!s || s.state !== 'value' || typeof s.raw !== 'number') return null;
      t += sign * s.raw;
    }
    return t;
  };

  // ---- computed columns then row-level calcs (RAW inputs) ----
  const computedCols = columns.filter((c) => c.kind === 'computed') as Extract<
    TableColumn,
    { kind: 'computed' }
  >[];
  // A change printed n.m. for a near-zero base, or over totals of different rows, says so once, in the locale's words.
  const calcNotes = evaluateTableCalcs(flat, valueCols, computedCols, rawState, records, leafTotal, data.columnGroups ?? [], colById, noPrevious, id => {
    const row = flatById.get(id);
    return row ? signTo(row, null) : folded.hidden.get(id)?.sign ?? 1;
  });
  if (calcNotes.nearZero) autoFootnotes.add(options.strings?.nearZeroChange ?? localeStrings(options.locale?.language).nearZeroChange);
  if (calcNotes.mixedCoverage) autoFootnotes.add(options.strings?.mixedCoverage ?? localeStrings(options.locale?.language).mixedCoverage);
  // A ratio off a negative base prints as plain arithmetic, so a reader sees -2 / -17 as 11.8%. The number stays; the lint says it is not n.m.
  for (const { scope, rowId, colId, cells } of calcNotes.negativeBase) {
    const more = cells > 1 ? ` and ${cells - 1} more` : '';
    warnings.push({
      code: 'ratio-negative-base',
      severity: 'info',
      message: `${scope === 'column' ? `column '${colId}' in row '${rowId}'` : `row '${rowId}' in column '${colId}'`}${more} divides by a negative number, so the ratio prints as plain arithmetic; a percentDelta calc prints n.m. off a negative base`,
      owner: { rowId, colId },
    });
  }

  // ---- display specs: from data + options ONLY (before any width solving) ----
  const locale = localeDefaults(options.locale);
  // Fitting may add a compact suffix. Only the original format decides
  // whether the table's forced magnitude and hoisted affix apply.
  const sourceRows = magnitudeSource === data ? flatById : new Map(flattenRows(magnitudeSource.rows).map(row => [row.id, row]));
  const sourceColumns = new Map(magnitudeSource.columns.map(col => [col.id, col]));
  const scales = (example: string) => scalesWithMagnitude(parseFormatExample(example));
  const specs = new Map<Id, NumberFormatSpec>();
  const formatExamples = new Map<Id, string>();
  const localeDerivedColumns = new Set<Id>();
  for (const col of [...valueCols, ...computedCols]) {
    // A document-level format-by-example describes the table's VALUE scale.
    // It may only reach a computed column whose algebra keeps that scale:
    // '€1.2m' imposed on a percentDelta renders every variance as "0.0".
    const inherited =
      col.kind === 'computed' && !calcPreservesScale(col.calc) ? undefined : options.format;
    const authoredExample = col.format ?? inherited;
    const example = authoredExample ?? defaultExample(col);
    if (authoredExample === undefined) localeDerivedColumns.add(col.id);
    formatExamples.set(col.id, example);
    const spec = parseFormatExample(example);
    const sourceExample = (sourceColumns.get(col.id) as { format?: string } | undefined)?.format ?? inherited;
    spec.automatic = automaticAs(sourceExample === undefined && options.unit === undefined && options.magnitude !== 'million' && options.magnitude !== 'thousand');
    if (authoredExample === undefined && currencyWholeNumbers(options.unit, options.target)
      && (col.kind !== 'computed' || calcPreservesScale(col.calc))) spec.currencyWhole = true;
    // The forced scale is the author's claim about the WHOLE table, so
    // every money format in it holds that scale instead of rolling up at
    // 1000: a column printing "€2.4M" in a board
    // of thousands is the defect the option exists to prevent. A percent or
    // a count has no magnitude to force.
    if (scales((sourceColumns.get(col.id) as { format?: string } | undefined)?.format ?? inherited ?? defaultExample(col))
      && (options.magnitude === 'million' || options.magnitude === 'thousand')) {
      forceScale(spec, options.magnitude === 'million' ? 'm' : 'k', locale.thousands);
    }
    if (sourceExample !== undefined) holdAuthoredScale(spec, locale.thousands);
    specs.set(col.id, spec);
  }
  // A row's own format-by-example: a calc row prints its result through it
  // (percent by default), and a data row prints its authored cells through it
  // where the column has no authored format of its own. That is the KPI-rows
  // steering table: the columns are months, the rows are revenue in $M,
  // subscribers as a count and CAC in $, each row naming its own unit.
  const rowSpecs = new Map<Id, NumberFormatSpec>();
  const rowById = new Map<Id, FlatRow>();
  // A forced magnitude is the author saying the whole table reads in one
  // scale, and a row format is the other place a scale is authored: a board
  // in thousands whose revenue row says '$1.2m' still prints thousands.
  // A percent or a count has no magnitude to force.
  const forcedMagnitude: NumberFormatSpec['magnitude'] | undefined =
    options.magnitude === 'million' ? 'm' : options.magnitude === 'thousand' ? 'k' : undefined;
  const authoredSpec = (example: string, sourceExample = example): NumberFormatSpec => {
    const spec = parseFormatExample(example);
    if (forcedMagnitude !== undefined && scales(sourceExample)) {
      forceScale(spec, forcedMagnitude, locale.thousands);
    }
    return spec;
  };
  // The figures a row's magnitude reads: its visible value cells without a format of their own.
  const cellsOfRow = new Map<string, (readonly [Id, number])[]>();
  const rowCells = (row: FlatRow): (readonly [Id, number])[] => {
    let cells = cellsOfRow.get(row.id);
    if (cells === undefined) cellsOfRow.set(row.id, cells = rowCellsUncached(row));
    return cells;
  };
  const rowValues = (row: FlatRow): number[] => rowCells(row).map(([, value]) => value);
  const rowCellsUncached = (row: FlatRow) => valueCols.filter(col => col.format === undefined && cellFormat(row.cells[col.id]) === undefined && !(data.columnToggles ?? []).some(toggle => toggle.columns.includes(col.id) && (options.columnVisibility?.[toggle.id] ?? toggle.defaultVisible ?? false) === false)).flatMap(col => { const raw = rawState.get(row.id)?.get(col.id)?.raw; return typeof raw === 'number' ? [[col.id, raw] as const] : []; });
  const largest = (values: number[]) => values.reduce((n,v)=>Math.max(n,Math.abs(v)),0);
  // Rows of one composed measure share the magnitude of their largest cell.
  const groupOf = (row: FlatRow) => (sourceRows.get(row.id) as MagnitudeGroupSource | undefined)?.[MAGNITUDE_GROUP];
  const groupMax = new Map<string, number>();
  // The figures of a group by column: each column takes its precision from its own largest figure.
  const groupColumns = new Map<string, Map<Id, number[]>>();
  for (const row of flat) {
    const group = groupOf(row);
    if (group === undefined) continue;
    groupMax.set(group, Math.max(groupMax.get(group) ?? 0, largest(rowValues(row))));
    let columns = groupColumns.get(group);
    if (columns === undefined) groupColumns.set(group, columns = new Map());
    for (const [colId, value] of rowCells(row)) {
      const column = columns.get(colId);
      if (column === undefined) columns.set(colId, [value]);
      else column.push(value);
    }
  }
  // The spec a group row prints a column through: the row's, with the decimals that column needs.
  const groupCellSpecs = new Map<Id, Map<Id, NumberFormatSpec>>();
  for (const row of flat) {
    rowById.set(row.id, row);
    const example = row.format ?? (row.scale ? row.scale === 'percent' ? '1.2%' : '1,234' : undefined) ?? (row.calc && calcYieldsPoints(row.calc) ? `1${locale.decimal}2%` : undefined);
    if (example) {
      const spec = authoredSpec(example, sourceRows.get(row.id)?.format ?? example);
      const authoredRow = sourceRows.get(row.id) as (TableRow & AutomaticFormatSource) | undefined;
      if (authoredRow?.format !== undefined && authoredRow[AUTOMATIC_FORMAT] !== true) holdAuthoredScale(spec, locale.thousands);
      const group = groupOf(row);
      // Resolve owns the row scale, including formats rewritten by width fitting.
      // Test the actual formatter: locked thousands ignore authored decimals.
      const rowScale = row.scale === 'money' || row.scale === 'perUnit';
      if (rowScale || specUnitKind(spec) === 'number') {
        const values = rowValues(row);
        const max = group === undefined ? largest(values) : groupMax.get(group)!;
        // A money row climbs k, M, B by its largest figure, so 1.2e11 prints 120.0B, not 120,000,000.0k.
        const climb = (from: number): NumberFormatSpec['magnitude'] => max >= 1e9 ? 'bn' : max >= 1e6 ? 'm' : max >= from ? 'k' : 'none';
        // A count climbs only with no format of its own: an authored '1,234' keeps its digits. A money row's
        // scale owns its precision and climbs either way, over an authored format too.
        const authoredFormat = sourceRows.get(row.id)?.format !== undefined;
        if (rowScale) {
          // An authored options.magnitude wins for a money row: 'thousand' and 'million' hold k and M; a thousand figure of 100,000 or more prints whole.
          // 'auto' or no magnitude keeps the climb.
          const heldMoney = row.scale === 'money' && forcedMagnitude !== undefined;
          spec.magnitude = heldMoney ? forcedMagnitude : row.scale === 'money' ? climb(1000) : 'none';
          if (row.scale === 'money') {
            spec.decimals = max >= 1000 && !(heldMoney && forcedMagnitude === 'k' && max >= 100000) ? 1 : 0;
          } else if (!authoredFormat || values.every(Number.isInteger)) {
            spec.decimals = max >= 10 ? 0 : 1;
            if (!authoredFormat) {
              for (const value of values) {
                while (value !== 0 && spec.decimals < MAX_FORMAT_DECIMALS
                  && Math.abs(roundedNumber(value, spec) - value) > Math.abs(value) * 0.01) spec.decimals++;
              }
            }
          }
          spec.prefix = ''; spec.suffix = '';
          spec.lockMagnitude = heldMoney; spec.rollMagnitude = false;
          if (spec.thousandsSep === '') spec.thousandsSep = locale.thousands;
        } else if (row.scale === 'count' && !authoredFormat && max >= 1e6 && spec.magnitude === 'none' && !spec.signed) {
          // A count keeps its digits up to a million (2,140 orders stay 2,140), then climbs M, B with one decimal.
          spec.magnitude = climb(Infinity);
          spec.decimals = 1;
          spec.lockMagnitude = false; spec.rollMagnitude = false;
        }
        const smallMoney = !rowScale && forcedMagnitude && scales(example) && values.every(v => Math.abs(v) < 1000);
        // A change line prints its authored format as authored: +0.01k under '+1.2k' rounds to +0.0k and never adds decimals.
        // A level row keeps "nonzero stays nonzero", so a small money or count figure never prints as 0.
        // A row of a measure group keeps the group's precision instead: its small member prints the bound (<0.01M).
        const changeLine = row.inline === true || spec.signed;
        if (smallMoney || (!changeLine && group === undefined && values.some(v => v !== 0 && roundedNumber(v, spec) === 0))) {
          // A k row that would print a nonzero value as 0.0k reads in whole units, not in 0.04k.
          if (smallMoney || (!rowScale && spec.lockMagnitude && spec.magnitude === 'k') || (row.scale === 'money' && spec.magnitude === 'k')) {
            // In whole units the row prints the decimals its example names: '$1.23' keeps "12.93" under a forced thousand.
            const authored = parseFormatExample(example);
            spec.decimals = !rowScale && authored.magnitude === 'none' ? authored.decimals : 0;
            spec.magnitude = 'none';
          }
          spec.decimals = values.reduce((decimals, value) => nonzeroDecimals(value / MAGNITUDE_DIVISOR[spec.magnitude], decimals), spec.decimals);
        }
        // A large Range total must not hide the level of a smaller period. The rows of a measure group
        // share one precision: 1% of the group's largest figure, read over every figure of the group,
        // with no magnitude letter too (a 0.18 spend prints 0.18, not <1).
        if (!changeLine && (spec.magnitude !== 'none' || (group !== undefined && row.scale === 'money')) && !(spec.lockMagnitude && spec.magnitude === 'k')
          && (row.scale === 'money' || (row.scale === 'count' && !authoredFormat))) {
          if (group === undefined) {
            for (const value of values) {
              while (value !== 0 && spec.decimals < MAX_FORMAT_DECIMALS
                && Math.abs(roundedNumber(value, spec) - value) > Math.abs(value) * 0.01) spec.decimals++;
            }
          } else {
            // The group precision is the floor. A column of 1.46M cells then adds the decimals its own
            // largest figure asks for, which a Range total of 18.2M does not.
            const columns = groupColumns.get(group)!;
            for (const column of columns.values()) {
              for (const value of column) {
                while (value !== 0 && spec.decimals < MAX_FORMAT_DECIMALS
                  && Math.abs(roundedNumber(value, spec) - value) > max * 0.01) spec.decimals++;
              }
            }
            const inRow = new Map<Id, NumberFormatSpec>();
            for (const [colId, column] of columns) {
              const cellSpec = { ...spec };
              const bound = largest(column) * 0.01;
              for (const value of column) {
                while (value !== 0 && cellSpec.decimals < MAX_FORMAT_DECIMALS
                  && Math.abs(roundedNumber(value, cellSpec) - value) > bound) cellSpec.decimals++;
              }
              inRow.set(colId, cellSpec);
            }
            groupCellSpecs.set(row.id, inRow);
          }
        }
      }
      // The row precision above is the rule on unlifted rounding; the lift applies to the printed value only.
      const sourceRow = sourceRows.get(row.id) as (TableRow & AutomaticFormatSource) | undefined;
      // A measure group's row prints a small member as the shared bound, authored format or not.
      spec.automatic = automaticAs(group !== undefined || ((sourceRow?.format === undefined || sourceRow[AUTOMATIC_FORMAT] === true) && options.format === undefined && options.unit === undefined && forcedMagnitude === undefined));
      for (const cellSpec of groupCellSpecs.get(row.id)?.values() ?? []) cellSpec.automatic = spec.automatic;
      rowSpecs.set(row.id, spec);
    }
  }
  // A value or computed cell's own format beats its row's and its column's: the YoY
  // column prints percent, and a share KPI's change in it prints points.
  // Separate row and column keys avoid pair-string allocation and id collisions.
  const cellSpecs = new Map<Id, Map<Id, NumberFormatSpec>>();
  const cellFormatCols = [...valueCols, ...computedCols];
  for (const row of flat) {
    for (const col of cellFormatCols) {
      const example = cellFormat(row.cells[col.id]);
      if (example !== undefined) {
        const sourceRow = sourceRows.get(row.id);
        const sourceColumn = sourceColumns.get(col.id) as { format?: string } | undefined;
        const sourceExample = cellFormat(sourceRow?.cells[col.id])
          ?? sourceColumn?.format ?? sourceRow?.format ?? options.format ?? defaultExample(col);
        let inRow = cellSpecs.get(row.id);
        if (!inRow) cellSpecs.set(row.id, inRow = new Map());
        const spec = authoredSpec(example, sourceExample);
        const sourceCell = sourceRow?.cells[col.id] as AutomaticFormatSource | undefined;
        if (cellFormat(sourceRow?.cells[col.id]) !== undefined && sourceCell?.[AUTOMATIC_FORMAT] !== true) holdAuthoredScale(spec, locale.thousands);
        if (sourceCell?.[AUTOMATIC_FORMAT] === true) spec.automatic = automaticAs(true);
        inRow.set(col.id, spec);
      }
    }
  }
  // A head or a row label names a unit only when every figure under it prints
  // in that unit. A cell's own format that names another one ("€900" under
  // "$") leaves the unit in the cells.
  const cellNamesOtherUnit = (rowId: Id, colId: Id, spec: NumberFormatSpec): boolean => {
    const own = cellSpecs.get(rowId)?.get(colId);
    return own !== undefined && typeof rawState.get(rowId)?.get(colId)?.raw === 'number' && unitOfSpec(own) !== unitOfSpec(spec);
  };
  /**
   * The unit a row-formatted money row hoists out of its cells and onto its
   * own label: every cell of the row said "11,300.0k" where the row
   * label can say "$k" once, as an affix on the label's own line. Only under
   * a forced magnitude, where every such row reads at the same scale and the
   * letter is the author's claim about the table rather than about the cell.
   */
  const hoistedRowUnits = new Map<Id, string>();
  if (forcedMagnitude !== undefined) {
    for (const [rowId, spec] of rowSpecs) {
      if (rowById.get(rowId)?.scale === 'money' || rowById.get(rowId)?.scale === 'perUnit'
        || rowById.get(rowId)?.calc !== undefined
        || !scales(sourceRows.get(rowId)?.format ?? '1,234')
        || valueCols.some((col) => cellNamesOtherUnit(rowId, col.id, spec))) continue;
      // Only a scale letter leaves the cells: a row that reads in whole units keeps "$215.9" and "5.1x".
      const unit = spec.magnitude === 'none' ? null : unitOfSpec(spec);
      if (unit !== null) hoistedRowUnits.set(rowId, unit);
    }
  }
  // A row format ranks between the column's own format and the chart-level
  // default: `col.format` beats it, `options.format` and the derived default
  // yield to it. A column without its own format whose cells belong to rows
  // with their own formats has no one unit to hoist into the frame or the
  // header: each cell carries its row's unit.
  // A computed column's own format counts too: an authored '+1.1%'
  // YoY calc column on a row that prints its months in $M keeps its percent.
  // So does the kind of its calculation: a percent change or a share is points
  // whatever its row prints in, and a row's '$1.2m' never turns it into "$0.0M".
  // A mul or div by a literal keeps its row's scale and currency.
  const ownFormatColumns = new Set<Id>([...valueCols, ...computedCols].filter(columnOwnsFormat).map(col => col.id));
  const rowFormattedColumns = new Set<Id>();
  for (const row of flat) {
    if (row.calc || !rowSpecs.has(row.id)) continue;
    for (const col of valueCols) {
      if (!ownFormatColumns.has(col.id) && typeof rawState.get(row.id)?.get(col.id)?.raw === 'number') rowFormattedColumns.add(col.id);
    }
  }
  /**
   * Every row that prints a figure hoisted one and the same unit: it prints
   * once, in the heads of the columns those rows fill, and no row label
   * repeats it ("€k" after five labels, over Q1 and Q2 heads that name
   * none).
   */
  const hoistedUnitSet = new Set(hoistedRowUnits.values());
  const figureRows = flat.filter((row) => !row.calc && valueCols.some((col) => typeof rawState.get(row.id)?.get(col.id)?.raw === 'number'));
  const headUnit = figureRows.length > 1 && hoistedUnitSet.size === 1 && figureRows.every((row) => hoistedRowUnits.has(row.id))
    ? [...hoistedUnitSet][0] : undefined;
  function defaultExample(col: Extract<TableColumn, { kind: 'value' | 'computed' }>): string {
    // a points-valued calc has no magnitude to derive — its unit IS the
    // percent sign, and the magnitude default can never emit one
    if (col.kind === 'computed' && calcYieldsPoints(col.calc)) return `1${locale.decimal}2%`;
    // A forced magnitude is the author saying every money column of this
    // table reads in one scale, so a $6.4M revenue row and a $1.1M spend row
    // stop picking their own and the unit hoists once. It reaches
    // the DERIVED example only: an authored column or row format still wins.
    // Grouped, because a locked scale reaches four digits: a board in
    // thousands prints "2,430.0", and "2430.0" is the number nobody reads.
    if (options.magnitude === 'million') return `1${locale.thousands}234${locale.decimal}2m`;
    // No decimals on a locked thousand: the example says what the column
    // prints, and a locked thousand prints whole.
    if (options.magnitude === 'thousand') return `1${locale.thousands}234k`;
    const colId = col.id;
    let maxAbs = 0;
    const values: number[] = [];
    for (const r of flat) {
      const s = rawState.get(r.id)!.get(colId);
      if (s && typeof s.raw === 'number') { maxAbs = Math.max(maxAbs, Math.abs(s.raw)); values.push(s.raw); }
    }
    if (maxAbs >= 1e9) return `1${locale.decimal}2bn`;
    if (maxAbs >= 1e6) return `1${locale.decimal}2m`;
    if (maxAbs >= 100) return `1${locale.thousands}234`;
    // A column under 1 keeps two significant digits of its largest value: '0.012' (typicalDecimals).
    const decimals = typicalDecimals(values);
    return decimals > 1 ? `0${locale.decimal}${'1234'.slice(0, decimals)}` : `1${locale.decimal}2`;
  }

  // ---- units once: hoist money units out of cells ----
  // uniform across all money columns → the frame's unit slot ("in €M");
  // mixed → per-column header labels; percent stays per-cell (signs are data)
  const unitByCol = new Map<Id, string | null>();
  // A head names a magnitude only when every cell prints in it: a '1.2k' column whose largest cell
  // rolls to "1.1M" prints each cell with its own letter, not "1.1M" under "(k)".
  const rollsOff = (colId: Id, spec: NumberFormatSpec): boolean => spec.magnitude !== 'none' && flat.some((row) => {
    // Only a cell that prints through the column's spec: a row or cell format carries its own unit.
    const rowPath = rowSpecs.has(row.id) && (row.calc !== undefined || row.inline === true || !ownFormatColumns.has(colId));
    if (rowPath || cellSpecs.get(row.id)?.has(colId)) return false;
    const raw = rawState.get(row.id)?.get(colId)?.raw;
    return typeof raw === 'number' && raw !== 0 && effectiveScale(Math.abs(raw), spec).magnitude !== spec.magnitude;
  });
  const lettersInCells = new Set<Id>();
  for (const col of [...valueCols, ...computedCols]) {
    const spec = specs.get(col.id)!;
    if (!rowFormattedColumns.has(col.id) && (rollsOff(col.id, spec) || flat.some((row) => cellNamesOtherUnit(row.id, col.id, spec)))) lettersInCells.add(col.id);
    unitByCol.set(col.id, rowFormattedColumns.has(col.id) || lettersInCells.has(col.id) ? null : unitOfSpec(spec));
  }
  const headerUnitFor = (id: Id): string | null => unitByCol.get(id) ?? (rowFormattedColumns.has(id) ? headUnit ?? null : null);
  // Whether the head's unit carries a magnitude the cells print without ("$k" from '$1,234k' or
  // options.magnitude); a literal suffix ('1,234 EURk') prints the raw figure.
  const headerScaledFor = (id: Id): boolean => unitByCol.get(id) != null ? specs.get(id)!.magnitude !== 'none'
    : rowFormattedColumns.has(id) && headUnit !== undefined && figureRows.some((row) => (rowSpecs.get(row.id)?.magnitude ?? 'none') !== 'none');
  const distinctUnits = [...new Set([...unitByCol.keys()].map(headerUnitFor).filter((u): u is string => u !== null))];
  // a uniform unit hoists to the FRAME — but only when the frame renders
  // text to carry it (a frameless panel would lose the unit entirely);
  // otherwise fall back to per-column header labels. The predicate belongs to
  // the frame, not to a guess made here: `title` alone renders NO unit slot,
  // so hoisting on it dropped '$M' off a titled table entirely.
  const candidateUnit = distinctUnits.length === 1 && [...valueCols, ...computedCols].every(col => {
    const kind = specUnitKind(specs.get(col.id)!);
    return kind === 'percent' || kind === 'pp' || headerUnitFor(col.id) === distinctUnits[0];
  }) ? distinctUnits[0]! : undefined;
  // Under options.unitShown the host prints it, so the head drops it too.
  const frameCarriesUnit = unitPrinted({
    subtitle: resolveSubtitle(options.subtitle),
    unit: candidateUnit,
    unitShown: options.unitShown,
  });
  // A shared bare scale ("B" from '1.2bn') carries no currency, so options.unit's currency stays in front of it
  // ("EUR B"). A scale word anywhere in options.unit ("Mio. EUR", "k EUR", "EUR bn (adj.)") either is this scale, so the
  // unit prints as written, or conflicts with it. Only a unit without a scale word gets the scale appended.
  const authoredUnit = typeof options.unit === 'string' ? options.unit.trim() : undefined;
  const scaleWords = (authoredUnit?.split(/[\s$€£¥()]+/) ?? []).filter((word) => Object.values(MAGNITUDE_LABEL).some((label) => label !== '' && sameUnitText(word, label)));
  // Row formats can supply the unit too, so their affixes count as well as the columns'.
  const bareScale = candidateUnit !== undefined && [...[...valueCols, ...computedCols].map((col) => specs.get(col.id)!), ...rowSpecs.values()]
    .every((spec) => specUnitKind(spec) !== 'number' || (spec.prefix.trim() === '' && spec.suffix.trim() === ''));
  const carriesScale = scaleWords.some((word) => sameUnitText(word, candidateUnit ?? ''));
  // Only a bare currency code or symbol takes the scale appended. Any other text ('USDbn', 'EURm', 'EUR Md') may hold a scale this check cannot read.
  const composes = bareScale && !!authoredUnit && (carriesScale || (scaleWords.length === 0 && /^(?:[A-Z]{3}|\p{Sc})$/u.test(authoredUnit)));
  const composedUnit = composes ? carriesScale ? authoredUnit : `${authoredUnit} ${candidateUnit}` : candidateUnit;
  const uniformUnit = composedUnit && frameCarriesUnit ? composedUnit : null;
  if (uniformUnit !== null && options.unit !== undefined && options.unit !== uniformUnit && !composes) {
    warnings.push({
      code: 'table-unit-overridden',
      severity: 'warn',
      field: ['options', 'unit'],
      message: `options.unit '${options.unit}' is not printed. The table prints '${uniformUnit}' because its column formats resolve that shared unit.`,
      suggest: 'Remove options.unit so the column formats supply the unit.',
      fix: [{ op: 'remove', path: '/options/unit' }],
    });
  }

  const rowOverridesColumn = (rowId: Id): boolean => {
    const row = rowById.get(rowId);
    return row?.calc !== undefined || row?.inline === true;
  };

  /** The spec a cell prints through: its own, else the row's where it applies, else the column's. */
  const specFor = (colId: Id, rowId?: Id): NumberFormatSpec => {
    const cellSpec = rowId ? cellSpecs.get(rowId)?.get(colId) : undefined;
    if (cellSpec) return cellSpec;
    const rowSpec = rowId ? rowSpecs.get(rowId) : undefined;
    return rowSpec && (rowOverridesColumn(rowId!) || !ownFormatColumns.has(colId)) ? groupCellSpecs.get(rowId!)?.get(colId) ?? rowSpec : specs.get(colId)!;
  };
  // `lift: false` prints the plain rounded text, which the near-zero base check reads.
  const formatNumber = (raw: number, colId: Id, rowId?: Id, lift = true): string => {
    const cellSpec = rowId ? cellSpecs.get(rowId)?.get(colId) : undefined;
    const rowSpec = rowId ? rowSpecs.get(rowId) : undefined;
    // A calc or inline row uses its own spec; other data rows only where
    // the column names no format of its own (an authored '+1.1%' YoY column
    // keeps its percent on a row that prints its months in $M; a chart-level
    // `options.format` yields to the row).
    const rowPath = rowSpec !== undefined && (rowOverridesColumn(rowId!) || !ownFormatColumns.has(colId));
    // A cell's own format prints whole: its unit is not the one the column
    // or the row hoists. One that names the same unit and changes only the
    // decimals prints as its row or column does, so a hoisted unit is not
    // printed twice: fitFormats lifts a figure its fitted precision would
    // print as 0 that way.
    const base = rowPath ? rowSpec! : specs.get(colId)!;
    if (cellSpec && !sameUnit(cellSpec, base)) return formatWithSpec(raw, lift ? cellSpec : { ...cellSpec, automatic: false });
    const decimals = cellSpec?.decimals ?? (rowPath ? groupCellSpecs.get(rowId!)?.get(colId)?.decimals : undefined) ?? base.decimals;
    if (rowPath) {
      // A measure group's exact zero prints "0": no decimals, no magnitude letter.
      if (raw === 0 && lift && !cellSpec && groupOf(rowById.get(rowId!)!) !== undefined) return '0';
      const hoisted = rowId !== undefined && hoistedRowUnits.has(rowId);
      const automatic = lift && (cellSpec ? cellSpec.automatic : rowSpec!.automatic);
      if (!hoisted) return formatWithSpec(raw, { ...rowSpec!, decimals, automatic });
      return stripMagnitude(formatWithSpec(raw, { ...rowSpec!, decimals, automatic, prefix: '', suffix: '' }), rowSpec!);
    }
    const spec = { ...specs.get(colId)!, decimals, ...(cellSpec ? { currencyWhole: undefined, automatic: cellSpec.automatic } : {}), ...(lift ? {} : { automatic: false }) };
    const rendered =
      unitByCol.get(colId) == null
        ? formatWithSpec(raw, spec)
        : formatWithSpec(raw, { ...spec, prefix: '', suffix: '' });
    const localized =
      localeDerivedColumns.has(colId) && locale.minusGlyph === '-' && rendered.startsWith(MINUS)
        ? `-${rendered.slice(MINUS.length)}`
        : rendered;
    if (unitByCol.get(colId) == null) return localized;
    return stripMagnitude(localized, spec);
  };

  // A percent change off a base the table prints as 0 ("0", "0.0") is n.m. with the
  // near-zero note, as one off an exact zero. Only the printed base can say so, so this runs after the specs.
  // Records are in evaluation order, so one pass also turns every later calc that reads such a cell into n.m.
  const madeNm = new Set<string>();
  for (const record of records) {
    if (record.kind !== 'calc' || record.state !== 'value') continue;
    const baseInput = record.op === 'percentDelta($0,$1)' ? record.inputs[1] : undefined;
    const nearZeroBase = baseInput !== undefined && baseInput.value !== null && !/[1-9]/.test(formatNumber(baseInput.value, baseInput.colId, baseInput.rowId, false));
    if (!nearZeroBase && (madeNm.size === 0 || !record.inputs.some(input => madeNm.has(JSON.stringify([input.rowId, input.colId]))))) continue;
    record.raw = null;
    record.state = 'nm';
    rawState.get(record.rowId)?.set(record.colId, { raw: null, state: 'nm' });
    madeNm.add(JSON.stringify([record.rowId, record.colId]));
    if (nearZeroBase) autoFootnotes.add(options.strings?.nearZeroChange ?? localeStrings(options.locale?.language).nearZeroChange);
  }

  // ---- share columns: largest-remainder over leaves to exactly 100.0 ----
  const displayOverride = new Map<string, string>(); // tableCellKey(rowId, colId) → displayed
  const overrideAmount = new Map<string, number>(); // the reconciled amount a displayOverride prints
  for (const col of computedCols) {
    if (!('op' in col.calc) || col.calc.op !== 'share') continue;
    const spec = specs.get(col.id)!;
    reconcileShares(col.id, spec);
  }
  function reconcileShares(colId: Id, spec: NumberFormatSpec) {
    // Rows topN.rest false omits take their units too, so the shown shares stay what they are with all rows shown.
    const entries = [
      ...leafRows.map((r) => ({ r, s: rawState.get(r.id)!.get(colId)!, shown: true })),
      ...hiddenLeaves.map(([id, h]) => ({ r: { id }, s: h.states.get(colId)!, shown: false })),
    ].filter((e) => e.s?.state === 'value' && typeof e.s.raw === 'number');
    const LAST = Number.MAX_SAFE_INTEGER;
    // The full table breaks equal remainders by its own row order, so shown and hidden rows keep that order.
    entries.sort((a, b) => (folded.leafOrder.get(a.r.id) ?? LAST) - (folded.leafOrder.get(b.r.id) ?? LAST));
    if (entries.length !== leafRows.length + hiddenLeaves.length || entries.length === 0) return;
    const decimals = spec.decimals ?? 1;
    const unit = Math.pow(10, -decimals);
    const floors = entries.map((e) => Math.floor((e.s.raw as number) / unit) * unit);
    const remainders = entries.map((e, i) => (e.s.raw as number) - floors[i]!);
    let deficit = Math.round((100 - floors.reduce((a, b) => a + b, 0)) / unit);
    // A cell whose own format has another precision prints its own rounding: it takes no unit of the column's total.
    const ownPrecision = entries.map((e) => {
      const cellSpec = cellSpecs.get(e.r.id)?.get(colId);
      return cellSpec !== undefined && (cellSpec.decimals ?? 1) !== decimals;
    });
    const order = entries
      .map((_, i) => i)
      .filter((i) => !ownPrecision[i])
      .sort((a, b) => remainders[b]! - remainders[a]! || a - b); // larger remainder first, then row order
    const adjusted = new Set<number>();
    for (const i of order) {
      if (deficit <= 0) break;
      adjusted.add(i);
      deficit--;
    }
    entries.forEach((e, i) => {
      if (ownPrecision[i] || !e.shown) return;
      const shown = floors[i]! + (adjusted.has(i) ? unit : 0);
      // A cell format of the column's precision prints the reconciled amount through itself.
      const cellSpec = cellSpecs.get(e.r.id)?.get(colId);
      // A nonzero share the reconciled unit floors to 0 reads "<0.1%", as formatShare prints it in a chart.
      displayOverride.set(tableCellKey(e.r.id, colId), shown === 0 && (e.s.raw as number) > 0 && spec.automatic && !cellSpec ? `<${formatNumber(unit, colId)}` : formatNumber(shown, colId, e.r.id));
      overrideAmount.set(tableCellKey(e.r.id, colId), shown);
      if (adjusted.has(i) && Math.abs(shown - (e.s.raw as number)) > 1e-9) {
        records.push({
          rowId: e.r.id,
          colId,
          op: 'share-reconcile',
          // The display UNIT is half the calculation: this record says "the
          // exact share, rounded up by one unit". With only the exact share in
          // the receipt, the adjustment could not be checked against anything.
          inputs: [
            { rowId: e.r.id, colId, value: e.s.raw as number },
            { rowId: SHARE_UNIT_ROW_ID, colId, value: unit },
          ],
          raw: shown,
          state: 'value',
          displayed: formatNumber(shown, colId, e.r.id),
          kind: 'rounding-adjustment',
        });
      }
    });
  }

  // ---- percent-scale lint (points, not fractions) ----
  // Computed columns are in scope: div(gp, revenue) yields a FRACTION, and
  // formatting 0.42 as '12.3%' prints "0.4%" — wrong by 100x, silently.
  // share/percentDelta are exempt: the engine itself produces their points,
  // and so is a value column that declares its scale at the source.
  for (const col of [...valueCols, ...computedCols]) {
    if (col.kind === 'computed' ? calcYieldsPoints(col.calc) : col.percentScale === 'points') continue;
    const spec = col.kind === 'computed' ? specs.get(col.id) : col.format ? specs.get(col.id) : undefined;
    if (!spec || !(spec.suffix ?? '').includes('%')) continue;
    const vals = flat
      .map((r) => rawState.get(r.id)!.get(col.id))
      .filter((s): s is { raw: number; state: CellState } => !!s && typeof s.raw === 'number');
    if (vals.length > 0 && vals.every((v) => Math.abs(v.raw) <= 1.5)) {
      warnings.push({
        code: 'percent-scale-suspect',
        severity: 'warn',
        message:
          col.kind === 'computed'
            ? `column '${col.id}': the format is percent but every computed value is within ±1.5 — percent columns carry POINTS, and a ratio calc yields a FRACTION (0.42 renders "0.4%"); multiply by 100 (mul(div(a,b), lit 100)) or drop the '%'`
            : `column '${col.id}': every value is within ±1.5 but the format is percent — percent values are authored in POINTS (6.2 → "6.2%"); these look like fractions`,
        ...(col.kind === 'value' ? { suggest: "values already in points: set percentScale: 'points' on the column" } : {}),
      });
    }
  }

  // The same lint for a data row that names a percent format of its own: its
  // authored cells on the columns that print through it.
  for (const row of flat) {
    const rowSpec = rowSpecs.get(row.id);
    if (!rowSpec || row.calc || !(rowSpec.suffix ?? '').includes('%')) continue;
    const vals = valueCols
      .filter((col) => !ownFormatColumns.has(col.id) && col.percentScale !== 'points')
      .map((col) => rawState.get(row.id)!.get(col.id))
      .filter((s): s is { raw: number; state: CellState } => !!s && typeof s.raw === 'number');
    if (vals.length > 0 && vals.every((v) => Math.abs(v.raw) <= 1.5)) {
      warnings.push({
        code: 'percent-scale-suspect',
        severity: 'warn',
        message: `row '${row.id}': every value is within ±1.5 but the row format is percent — percent values are authored in POINTS (6.2 → "6.2%"); these look like fractions`,
      });
    }
  }

  // ---- rounding gaps: rounding is one CAUSE of a gap, never the default one ----
  // "Figures may not add due to rounding." is a claim about WHY a displayed
  // total differs from its displayed parts. What the reader sees not adding up
  // (displayGap) has exactly two sources, and they add:
  //     displayGap = rawGap + roundingGap
  // rawGap is a real disagreement in the DATA — an authored total that is not
  // the sum of its children. Rounding cannot explain that, so the footnote may
  // not claim it. roundingGap is the remainder, the part display precision
  // actually moved, and it is the only part the footnote speaks for. Reporting
  // displayGap as "rounding" dresses a 5m disagreement as a rounding
  // artefact; DROPPING the footnote whenever rawGap ≠ 0 is the
  // opposite error, and it deletes a true footnote from every table that has
  // both (2.9 authored over 1.4 + 1.4 displays as 3 = 1 + 1: 0.1 real, 0.9
  // rounding). Decompose; do not choose.
  // The engine does NOT lint rawGap here: policy 'validate' already reconciled
  // it above, and policy 'source' is contractually a no-comparison promise
  // ("authored value trusted, no comparison
  // (confidential / partial detail)"). A warning the author is forbidden to
  // act on is noise.
  for (const row of flat) {
    if (row.role === 'section') continue; // no cells to reconcile against
    const kids = summandsOf(row.id);
    if (kids.length === 0) continue;
    for (const col of valueCols) {
      if (aggregateFor(col, row) !== 'sum') continue;
      // Each row rounds the way it prints: a row with its own format has its
      // own display unit, and the gap is measured in the parent's.
      const spec = specFor(col.id, row.id);
      const p = rawState.get(row.id)!.get(col.id)!;
      if (p.state !== 'value' || typeof p.raw !== 'number') continue;
      const childStates = kids.map((k) => rawState.get(k.id)!.get(col.id)!);
      const childRaw = childStates
        .filter((s) => s.state === 'value' && typeof s.raw === 'number')
        .map((s, i) => (s.raw as number) * signTo(kids[i]!, row.id));
      if (childRaw.length !== kids.length) continue;
      const rawSum = childRaw.reduce((a, b) => a + b, 0);
      const rawGap = p.raw - rawSum;
      // float noise from magnitude math (bn-scale) is not a disagreement:
      // subtracting it back out would only inject it into the rounding term
      const noise = floatNoise(p.raw, rawSum);
      const parentShown = roundedNumber(p.raw, spec);
      const childShown = childRaw.map((value, i) => roundedNumber(value, specFor(col.id, kids[i]!.id)));
      const displayGap = parentShown - childShown.reduce((a, b) => a + b, 0);
      const roundingGap = Math.abs(rawGap) > noise ? displayGap - rawGap : displayGap;
      // THE RECEIPT CARRIES EVERY OPERAND THE ARITHMETIC USES.
      // The gap the record publishes is a function of the parent, the
      // children, AND the precision each is printed at. A record of the
      // children's RAW values only gives `recomputeClaim` no definition to
      // apply: it answers `unknown-op`, and a correct table comes back
      // SEMANTIC_FAIL.
      // So the claim kind is not relaxed; the record is complete. Both the raw and the PRINTED value of the parent and of every
      // child go in (`role` keeps the pair apart on one ref), which lets
      // `rounding-gap@1` be defined as pure arithmetic over recorded numbers:
      // no reader needs the engine's formatter to check it, and every operand
      // is a number that appears in the exhibit or in the source.
      // Operand ORDER is the contract: parent raw, parent displayed, then each
      // child's raw and displayed in child order.
      const inputs: ComputedCellRecord['inputs'] = [
        { rowId: row.id, colId: col.id, value: p.raw, role: 'raw' },
        { rowId: row.id, colId: col.id, value: parentShown, role: 'displayed' },
        ...kids.flatMap((k, i) => [
          { rowId: k.id, colId: col.id, value: childRaw[i]!, role: 'raw' as const },
          { rowId: k.id, colId: col.id, value: childShown[i]!, role: 'displayed' as const },
        ]),
      ];
      // a REAL rounding gap is at least one display unit; float noise from
      // magnitude math (bn-scale) must never trigger the honesty footnote.
      // The unit is the finest one in the reconciliation: children on a finer
      // row format can show a gap the parent's coarser unit would swallow
      // (2.8m as "3M" over 1.4M + 1.4M).
      const unitOf = (candidate: NumberFormatSpec): number => Math.pow(10, -candidate.decimals) * MAGNITUDE_DIVISOR[candidate.magnitude];
      const displayUnit = Math.min(unitOf(spec), minOf(kids.map((k) => unitOf(specFor(col.id, k.id)))));
      if (Math.abs(roundingGap) > displayUnit * 0.5) {
        autoFootnotes.add(ROUNDING_FOOTNOTE);
        records.push({
          rowId: row.id,
          colId: col.id,
          op: 'rounding-gap',
          inputs,
          raw: roundingGap,
          state: 'value',
          displayed: '',
          kind: 'rounding-adjustment',
        });
      }
    }
  }

  // ---- resolve cells to final strings ----
  for (const column of columns) {
    if ((column.kind === 'value' || column.kind === 'computed') && column.align === 'left') {
      warnings.push({
        code: 'align-override-suspect',
        severity: 'warn',
        message: `column '${column.id}' forces a numeric column left — right alignment is the comparison-safe default`,
        owner: { colId: column.id },
      });
    }
  }

  const resolvedColumns: ResolvedColumn[] = columns.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.label ?? (c.kind === 'rowLabel' ? '' : c.id),
    ...(c.subLabel === undefined ? {} : { subLabel: c.subLabel }),
    format:
      c.kind === 'value' || c.kind === 'computed'
        ? formatExamples.get(c.id)
        : c.kind === 'date'
          ? c.format
          : undefined,
    scenario: c.kind === 'value' ? c.scenario : undefined,
    polarity: c.kind === 'value' || c.kind === 'computed' ? c.polarity : undefined,
    aggregate: c.kind === 'value' ? (c.aggregate ?? (nonAdditiveFormat(c.format) ? 'none' : 'sum')) : 'none',
    groupId: data.columnGroups?.find((g) => g.columns.includes(c.id))?.id,
    toggleGroup: toggleResolution.membership.get(c.id),
    width: c.width, maxWidth: c.kind === 'rowLabel' ? c.maxWidth : undefined, maxTextWidth: c.kind === 'rowLabel' ? c.maxTextWidth : undefined, wrap: c.kind === 'text' ? c.wrap : undefined, statusMark: c.kind === 'status' && c.mark === 'square' ? 'square' : undefined,
    unitLabel:
      uniformUnit === null && (c.kind === 'value' || c.kind === 'computed')
        ? (headerUnitFor(c.id) ?? undefined)
        : undefined,
    ...(uniformUnit === null && (c.kind === 'value' || c.kind === 'computed') && headerUnitFor(c.id) !== null && headerScaledFor(c.id) ? { unitScaled: true as const } : {}),
    ...(lettersInCells.has(c.id) ? { magnitudeInCells: true as const } : {}),
    encoding: c.kind === 'encoding' ? c.encoding : undefined,
    cellEncoding: resolveCellEncoding(encodingFor(options.encodings, c.id), specs.get(c.id)?.suffix.includes('%') === true),
    // The preset's own two column decisions: a benchmark's first
    // column is the subject and carries the header's weight, a receipts
    // table's dates sit under each other on the right.
    emphasis: c.emphasis ?? (c.kind === 'rowLabel' ? language.labelEmphasis : undefined),
    ...(c.band === undefined ? {} : { band: c.band }),
    ...(c.noteLine === undefined ? {} : { noteLine: c.noteLine }),
    // A cohort grid centres its figures: every cell in a period column is
    // the same two or three digits, and a right edge would draw a ragged
    // column of gaps. A column that names its own alignment, the
    // cohort size beside the label, keeps it.
    align: c.align ?? (c.kind === 'value' || c.kind === 'computed'
      ? (isCohortDensity(options.density ?? 'regular') ? 'center' : 'right')
      : c.kind === 'status' ? 'center'
      : c.kind === 'date' && language.datesRight ? 'right'
      : 'left'),
  }));

  // One decision for both surfaces (`options.driverTones`): 'grouped' tones a driver under a parent that is not a section heading.
  const driverToneMode = options.driverTones ?? 'grouped';
  function driverToneOf(row: FlatRow): boolean {
    if (driverToneMode !== 'grouped') return driverToneMode === 'always';
    return row.parentId !== null && flatById.get(row.parentId)?.role !== 'section';
  }
  const resolvedRows: ResolvedRow[] = flat.map((row) => {
    const cells: Record<Id, ResolvedCell> = emptyIdRecord();
    for (const col of columns) {
      cells[col.id] = resolveCell(row, col);
    }
    const hasChildren = (treeChildrenOf.get(row.id) ?? []).length > 0;
    return {
      id: row.id,
      label: row.label,
      ...(row.parentId === null ? {} : { parentId: row.parentId }),
      hasChildren,
      ...(hasChildren ? { defaultExpanded: expansion.get(row.id)! } : {}),
      level: row.level,
      step: ladderStep(row, flatById, levelOffset),
      ...(row.kind === undefined ? {} : { kind: row.kind }),
      ...(row.kind === 'driver' && driverToneOf(row) ? { driverTone: true as const } : {}),
      ...(row.sign === undefined ? {} : { sign: row.sign }),
      ...(row.final === undefined ? {} : { final: row.final }),
      ...(options.signs === 'operators' ? { operator: row.sign === -1 ? '−' as const : row.kind === 'result' ? '=' as const : row.operator } : {}),
      ...(row.divider === true ? { divider: true as const } : {}),
      role: row.role,
      relation: row.relation,
      order: row.order,
      ...(row.polarity === undefined ? {} : { polarity: row.polarity }),
      ...(row.inline === true ? { inline: true as const, inlineGroup: row.inlineGroup ?? row.id } : {}),
      highlightTone: highlightedRows.has(row.id) ? rowHighlightTone(cells) : undefined,
      // A forced magnitude wins: it is a claim about the whole table, and
      // the letter it hoists out of the cells has to be the one the label
      // prints. Without one the author's own affix stands.
      ...(hoistedRowUnits.has(row.id)
        ? headUnit === undefined ? { unitAffix: row.kind === 'member' && row.unitAffix ? `${row.unitAffix.split(',')[0]}, ${hoistedRowUnits.get(row.id)!}` : hoistedRowUnits.get(row.id)! } : {}
        : row.unitAffix === undefined ? {} : { unitAffix: row.unitAffix }),
      ...(row.spacer === undefined ? {} : { spacer: row.spacer }),
      ...(hasChildren && row.foldable === false ? { foldable: false as const } : {}),
      ...(row.badge === undefined ? {} : { badge: { text: row.badge.text, tone: row.badge.tone ?? 'neutral' } }),
      cells,
    };
  });
  // The parent carries its lines in authored order; the lines stay in
  // `rows` so records, the accessible table and every claim still see them.
  {
    const resolvedById = new Map(resolvedRows.map((row) => [row.id, row]));
    for (const [parentId, list] of childrenOf) {
      if (parentId === null) continue;
      const lines = list.filter((child) => child.inline === true)
        .map((child) => resolvedById.get(child.id)!);
      if (lines.length > 0) resolvedById.get(parentId)!.inlineRows = lines;
    }
  }

  function judgementTone(tone: CellTone, strong?: true): CellTone {
    return options.judgements === 'exceptions' && (tone === 'warn' || (tone === 'good' && !strong)) ? 'neutral' : tone;
  }
  /** A calculation whose missing inputs are all explicit blanks has nothing to compare, so it keeps the structural dash. */
  function blankInputs(row: FlatRow, col: TableColumn): boolean {
    const calc = row.calc ?? (col.kind === 'computed' ? col.calc : undefined);
    if (calc === undefined) return false;
    const gaps = calcRefs(calc).flatMap((ref) => {
      const rowId = typeof ref === 'string' ? row.id : ref.row;
      const colId = typeof ref === 'string' ? ref : ref.col ?? (ref.previous ? previousColumnInGroup(data.columnGroups ?? [], col.id) : col.id);
      if (colId === null) return [];
      const state = rawState.get(rowId)?.get(colId);
      return state !== undefined && state.state === 'missing' ? [{ rowId, colId }] : [];
    });
    return gaps.length > 0 && gaps.every(({ rowId, colId }) => {
      const input = flatById.get(rowId);
      const cell = input?.cells[colId];
      return ((isCellObject(cell) ? cell.missing : undefined) ?? input?.missing) === 'blank';
    });
  }
  function resolveCell(row: FlatRow, col: TableColumn): ResolvedCell {
    // A row may say what its own gaps print: a change line with
    // nothing to say in a block column stays empty, and the table's real
    // gaps keep the table's glyph.
    const authored = row.cells[col.id];
    const obj = isCellObject(authored) ? authored : undefined;
    const missing = obj?.missing ?? row.missing;
    const missingGlyph = missing === undefined ? tableMissingGlyph
      : missing === 'blank' ? '' : glyphs.missing;
    const base: ResolvedCell = {
      rowId: row.id,
      colId: col.id,
      kind: col.kind,
      raw: null,
      state: 'missing',
      displayed: '',
      tone: judgementTone(obj?.tone ?? 'neutral', obj?.strong),
      note: obj?.note,
      href: obj?.href,
      ...(obj?.heat === false ? { heat: false as const } : {}),
      ...(obj?.strong === true && obj.tone !== undefined && obj.tone !== 'neutral' ? { strong: true as const } : {}),
      ...(typeof obj?.bar === 'number' && Number.isFinite(obj.bar) ? { bar: Math.min(1, Math.max(0, obj.bar)) } : {}),
      ...((col.kind === 'value' || col.kind === 'computed') && obj?.format !== undefined ? { format: obj.format } : {}),
      scenario: col.kind === 'value' ? col.scenario : undefined,
      role: row.role,
      relation: row.relation,
      level: row.level,
    };
    if (row.role === 'section' && col.kind !== 'rowLabel') {
      return { ...base, state: 'na', displayed: '' };
    }
    if (obj?.state && col.kind !== 'rowLabel' && col.kind !== 'encoding') {
      return { ...base, raw: null, state: obj.state, displayed: glyphs[obj.state], tone: 'neutral', ...(obj.muted === true ? { deEmphasized: true } : {}) };
    }
    switch (col.kind) {
      case 'rowLabel':
        return { ...base, raw: row.label, state: 'value', displayed: row.label };
      case 'value':
      case 'computed': {
        // Skipped row calculations have no evaluated state and keep their structural glyph.
        const evaluated = rawState.get(row.id)!.get(col.id);
        const s = evaluated ?? { raw: null, state: 'missing' as CellState };
        let displayed: string;
        let negated = false;
        if (s.state !== 'value' || typeof s.raw !== 'number') {
          const state = s.state === 'value' ? 'missing' : (s.state as Exclude<CellState, 'value'>);
          const noPreviousColumn = row.calc !== undefined && JSON.stringify(row.calc).includes('"previous":true') && previousColumnInGroup(data.columnGroups ?? [], col.id) === null;
          const noPreviousValue = state === 'na' && previousPlaceholders && noPreviousColumn;
          const dataGap = state === 'missing' && gapWord && missing === undefined && evaluated !== undefined && !(noPreviousColumn && noPrevious === 'missing')
            && !blankInputs(row, col);
          displayed = dataGap ? glyphs.na : state === 'missing' || noPreviousValue ? missingGlyph : glyphs[state];
        } else {
          const relativeChange = (row.inline === true || row.calc !== undefined || col.kind === 'computed')
            && (specUnitKind(specFor(col.id, row.id)) !== 'number' || (row.calc !== undefined && calcYieldsPoints(row.calc)) || (col.kind === 'computed' && calcYieldsPoints(col.calc)));
          const negate = (options.signs ?? 'signed') === 'signed' && row.kind !== 'driver' && row.kind !== 'result'
            && !relativeChange && signTo(row, null) === -1
            // A ratio of two cells prints the same on the negated figures, so only a calc that flips with its inputs flips.
            && (col.kind !== 'computed' || row.calc !== undefined || calcFlipsWithInputs(col.calc));
          negated = negate && s.raw !== 0;
          displayed = (negate ? undefined : displayOverride.get(tableCellKey(row.id, col.id))) ?? formatNumber(negate && s.raw !== 0 ? -s.raw : s.raw, col.id, row.id);
          if (negate && locale.minusGlyph === '-') displayed = displayed.replace(MINUS, '-');
          // The head's † and its note say it where they print (disclosures shown, a column that skipped a child); else the cell says it.
          if (s.partial && !(disclosuresShown(options) && partialColumnIds.has(col.id))) displayed = `${displayed} ${options.strings?.incomplete ?? localeStrings(options.locale?.language).incomplete}`;
        }
        // Value bands: an explicit tone beats them, they beat the sign judgement.
        const band = obj?.bands !== undefined && s.state === 'value' && typeof s.raw === 'number' ? bandFor(s.raw, obj.bands) : undefined;
        const bandIndex = band === undefined ? -1 : obj!.bands!.indexOf(band);
        let tone: CellTone = obj?.tone ?? band?.tone ?? 'neutral';
        let deEmphasized: boolean | undefined;
        // ofWhich/displayOnly rows are context, not steering lines — they
        // never carry judgment tones or badges, and they whisper unless the
        // theme keeps them in the text colour (`table.ofWhich`). An inline
        // line that names its own polarity is the exception: it IS a signed
        // change, authored as displayOnly only because a change is never a
        // summand.
        const judgmentRow = row.relation === 'additive' || row.calc !== undefined
          || (row.inline === true && row.polarity !== undefined);
        // The measure's direction governs every change it prints:
        // a row's polarity wins over the column's in a column that judges a
        // change, and judges every cell that is itself a change (a calc, an
        // inline line, a signed format such as '+1.0'). A level ($89 of CAC)
        // stays unjudged.
        const polarity = col.polarity !== undefined ? row.polarity ?? col.polarity
          : row.calc !== undefined || row.inline === true || specFor(col.id, row.id).signed ? row.polarity : undefined;
        if (s.state === 'value' && typeof s.raw === 'number' && judgmentRow) {
          // A value that prints as zero at its own precision has no sign to
          // judge: "-0.02%" shown as "0.0%" is not a loss.
          if (polarity && !obj?.tone && band === undefined && roundedNumber(s.raw, specFor(col.id, row.id)) !== 0) {
            const goodSign = polarity === 'higherIsBetter' ? 1 : -1;
            tone = Math.sign(s.raw) === goodSign ? 'good' : 'bad';
            // The measure the direction belongs to: the column's where the
            // column set it, else the row's; an inline change line ("MoM %")
            // belongs to the row it sits in.
            const measure = row.polarity === undefined ? col.label ?? col.id
              : row.inline === true && row.parentId !== null ? flatById.get(row.parentId)?.label ?? row.label : row.label;
            (polarity === 'lowerIsBetter' ? lowerJudged : higherJudged).add(measure);
          }
          const mat = col.materiality;
          const threshold = specs.get(col.id)!.suffix.includes('%') ? mat?.pct : mat?.abs;
          if (threshold !== undefined && Math.abs(s.raw) < threshold) {
            deEmphasized = true;
            tone = 'neutral';
          }
        }
        // An authored whisper: the figure keeps its place and drops its tone.
        if (obj?.muted === true) {
          deEmphasized = true;
          tone = 'neutral';
        }
        // The marker is mandatory and so is the footnote that
        // explains it — but NOT from here. Cell resolution runs for every row
        // and column whether or not the surface renders them, so a footnote
        // raised here would explain a marker inside a collapsed row or a
        // toggled-off column: an asterisk the reader cannot find. The footnote
        // is assembled where visibility is known, by `tableFootnotes` in
        // ./view, from the cells a surface actually emits.
        // A figure that prints as zero carries no amount to read.
        // A reconciled share prints its override, so its reconciled amount decides.
        tone = judgementTone(tone, obj?.strong);
        const reconciled = overrideAmount.get(tableCellKey(row.id, col.id));
        const zero = tone === 'neutral' && !deEmphasized && s.state === 'value' && typeof s.raw === 'number'
          && (reconciled !== undefined ? Math.abs(reconciled) < 1e-9 : roundedNumber(s.raw, specFor(col.id, row.id)) === 0);
        // The direction travels with the cell: a heat ground or an in-cell bar
        // judges a fall under lowerIsBetter as good even where the tone stays
        // neutral (an ofWhich line, a muted cell).
        return { ...base, raw: s.raw, state: s.state, displayed, tone, deEmphasized, polarity, ...(zero ? { zero: true as const } : {}),
          ...(negated ? { negated: true as const } : {}),
          ...(band === undefined ? {} : { band: { to: band.to, ...(bandIndex > 0 ? { from: obj!.bands![bandIndex - 1]!.to } : {}), ...(band.label === undefined ? {} : { label: band.label }) } }) };
      }
      case 'status': {
        const given = typeof authored === 'number' ? authored : obj?.v;
        const v = typeof authored === 'string' ? authored : typeof given === 'string' ? given : null;
        // A number is no status. It still draws the missing dash, as before,
        // and now warns; a later release refuses it as an unknown key.
        if (typeof given === 'number') {
          warnings.push({
            code: 'status-value-number',
            severity: 'warn',
            message: `status cell rows[${row.id}].cells[${col.id}] holds the number ${given} and draws the missing dash; write one of: ${STATUS_VALUES.join(' · ')}, or use a text column with a cell tone. A later release refuses a number here.`,
            owner: { rowId: row.id, colId: col.id },
          });
          return { ...base, displayed: missingGlyph };
        }
        if (v !== null && !(STATUS_VALUES as readonly string[]).includes(v)) {
          throw new NormalizeError(
            'status-value-invalid',
            `rows[${row.id}].cells[${col.id}]`,
            `status '${v}' is not one of: ${STATUS_VALUES.join(' · ')}; for free status text use a text column with a cell tone`,
          );
        }
        if (v === null) return { ...base, displayed: missingGlyph };
        // at-risk is a JUDGMENT (warn), pending is procedural (neutral) —
        // a grey at-risk chip tells the reader "nothing to see here" while
        // the data says "FX headwind building"
        const tone: CellTone =
          v === 'off-track' ? 'bad' : v === 'at-risk' ? 'warn' : v === 'done' || v === 'on-track' ? 'good' : 'neutral';
        const labels: Readonly<Record<string, string | undefined>> | undefined = col.kind === 'status' ? col.labels : undefined;
        return { ...base, raw: v, state: 'value', displayed: labels?.[v] ?? v, tone: judgementTone(tone, obj?.strong) };
      }
      case 'date': {
        const given = typeof authored === 'number' ? authored : obj?.v;
        const v = typeof authored === 'string' ? authored : typeof given === 'string' ? given : null;
        // A number is no date. It keeps the missing dash it drew, and says so.
        if (typeof given === 'number') {
          warnings.push({
            code: 'date-value-number',
            severity: 'warn',
            message: `date cell rows[${row.id}].cells[${col.id}] holds the number ${given} and draws the missing dash; write an ISO date (YYYY-MM-DD), or use a value or text column.`,
            owner: { rowId: row.id, colId: col.id },
          });
        }
        if (v === null) return { ...base, displayed: missingGlyph };
        const d = parseISODate(v);
        if (!d) {
          throw new NormalizeError(
            'date-invalid',
            `rows[${row.id}].cells[${col.id}]`,
            `'${v}' is not an ISO date (YYYY-MM-DD)`,
          );
        }
        const pattern = datePatternFromExample(col.kind === 'date' ? col.format : undefined);
        return { ...base, raw: v, state: 'value', displayed: formatDate(d, pattern, options.locale?.language) };
      }
      case 'text': {
        const v =
          typeof authored === 'string'
            ? authored
            : typeof authored === 'number'
              ? String(authored)
              : obj?.v !== undefined
                ? String(obj.v)
                : null;
        // text columns render missing as BLANK — nothing to say ≠ data
        // missing; numeric/date/status keep '—'
        if (v === null && !obj?.note) return { ...base, displayed: '' };
        return { ...base, raw: v, state: 'value', displayed: v ?? '' };
      }
      case 'encoding':
        return { ...base, state: 'value', displayed: '' };
    }
  }

  stampRecordDisplay(records, resolvedRows, formatNumber);
  sortSiblingGroups(childrenOf, resolvedRows, resolvedColumns, options, generatedOthers);
  const totalPos = options.totalPosition ?? language.totalPosition;
  const ordered = orderRows(resolvedRows, childrenOf, totalPos);
  ordered.forEach((r, i) => (r.order = i));
  for (const row of ordered) {
    if (!generatedOthers.has(row.id) || !row.hasChildren) continue;
    const members = (treeChildrenOf.get(row.id) ?? []).map((child) => child.label);
    autoFootnotes.add(`${row.label} groups ${members.join(', ')}.`);
  }

  const perColumnHeat = resolvedColumns.filter((column) => (column.kind === 'value' || column.kind === 'computed') &&
    column.cellEncoding?.type === 'heat' && (column.cellEncoding.scale ?? 'column') === 'column' &&
    column.cellEncoding.cap === undefined);
  if (perColumnHeat.length > 1) autoFootnotes.add(HEAT_COLUMN_FOOTNOTE);
  // A traffic-light key reads higher is better unless every status lane
  // reads lower; where both directions share the table, the lanes that read
  // the other way are named, so no reader takes their green for "above".
  // `tableFootnotes` restates it for the columns a surface draws.
  const statusNote = statusDirectionNote(resolvedColumns, heatRanges(resolvedColumns, ordered), options.colorblindSafe === true);
  if (statusNote !== undefined) autoFootnotes.add(statusNote);
  // A relative arrow key's percentages are shares of each column's largest change.
  if (resolvedColumns.some((column) => column.cellEncoding?.type === 'arrow' && column.cellEncoding.scale === 'relative' && column.kind === 'computed' && column.polarity)) {
    autoFootnotes.add(ARROW_FOOTNOTE);
  }
  // A table that colours changes in both directions says which measures read
  // the other way, so green never has to be guessed.
  if (lowerJudged.size && higherJudged.size) {
    const [fewer, word] = lowerJudged.size <= higherJudged.size ? [lowerJudged, 'Lower'] : [higherJudged, 'Higher'];
    autoFootnotes.add(`${options.colorblindSafe === true ? 'The good tone' : 'Green'} marks a favourable change. ${word} is better for ${[...fewer].join(', ')}.`);
  }
  const footnotes = [...autoFootnotes];
  // The † in the head points at its note, so it prints only where the note does.
  if (disclosuresShown(options)) for (const column of resolvedColumns) if (partialColumnIds.has(column.id)) column.partial = true;

  const result: ResolveResult = {
    ...(zeroLifts.count === liftsBefore ? {} : { lifted: true as const }),
    table: {
      columns: resolvedColumns,
      columnGroups: (data.columnGroups ?? []).map((g) => ({
        id: g.id,
        label: g.label,
        columnIds: g.columns,
        ...(g.band === undefined ? {} : { band: g.band }),
        ...(g.note === undefined ? {} : { note: g.note }),
        ...(g.spacer === undefined ? {} : { spacer: g.spacer }),
        ...(g.heading === undefined ? {} : { heading: g.heading }),
        ...(g.hoverSeries === undefined ? {} : { hoverSeries: g.hoverSeries }),
      })),
      columnToggles: toggleResolution.toggles,
      rows: ordered,
      unit: uniformUnit ?? undefined,
      ...(data.levelNouns === undefined ? {} : { levelNouns: data.levelNouns }),
      footnotes,
      ...(partialColumnIds.size > 0 ? { partialColumnIds: [...partialColumnIds] } : {}),
      ...(options.colorblindSafe === true ? { colorblindSafe: true as const } : {}),
      provenance: {},
    },
    computedCells: records,
    warnings,
  };
  evaluatedStates.set(result, rawState);
  return result;
}

// ---------- helpers ----------

/**
 * The authored encoding as one object with its defaults filled, so the SVG
 * layout and the HTML table read the same lane settings. The bare string
 * form is the object with nothing authored: heat caps at the column extreme,
 * tints at 0.18 and leaves totals alone.
 */
export const HEAT_DEFAULT_ALPHA = 0.18;
/** A traffic-light lane paints heavier, so the warn amber reads on a white ground. */
export const HEAT_STATUS_ALPHA = 0.26;
/**
 * The encoding a column takes: its own entry first, then any heat rule that
 * NAMES it in `columns`. A sixty-column cohort grid authors one
 * lane instead of sixty copies of it, and a column with an entry of its own
 * still wins.
 */
function encodingFor(
  encodings: Record<Id, TableCellEncoding> | undefined,
  columnId: Id,
): TableCellEncoding | undefined {
  const own = encodings?.[columnId];
  if (own !== undefined) return own;
  for (const entry of Object.values(encodings ?? {})) {
    if (typeof entry !== 'string' && entry.type === 'heat' && entry.columns?.includes(columnId) === true) return entry;
  }
  return undefined;
}

/** `percent`: the column prints percents, so an arrow cuts the change itself by default. */
function resolveCellEncoding(encoding: TableCellEncoding | undefined, percent: boolean): ResolvedCellEncoding | undefined {
  if (encoding === undefined) return undefined;
  if (encoding === 'arrow' || (typeof encoding === 'object' && encoding.type === 'arrow')) {
    return { type: 'arrow', scale: (typeof encoding === 'object' ? encoding.scale : undefined) ?? (percent ? 'absolute' : 'relative') };
  }
  if (typeof encoding === 'string') {
    return encoding === 'heat'
      ? { type: 'heat', alpha: HEAT_DEFAULT_ALPHA, excludeTotals: true }
      : { type: encoding };
  }
  return {
    type: 'heat',
    ...(encoding.cap === undefined ? {} : { cap: encoding.cap }),
    alpha: encoding.alpha ?? (encoding.scale === 'status' ? HEAT_STATUS_ALPHA : HEAT_DEFAULT_ALPHA),
    excludeTotals: encoding.excludeTotals ?? true,
    ...(encoding.steps === undefined ? {} : { steps: encoding.steps }),
    ...(encoding.scale === undefined ? {} : { scale: encoding.scale }),
    ...(encoding.bins === undefined ? {} : { bins: encoding.bins }),
    ...(encoding.span === undefined ? {} : { span: encoding.span }),
    ...(encoding.center === undefined ? {} : { center: encoding.center }),
    ...(encoding.tolerance === undefined ? {} : { tolerance: encoding.tolerance }),
  };
}

/** The evaluated cell states of a resolve, kept for the top-N pass that resolves the full table first. */
const evaluatedStates = new WeakMap<ResolveResult, Map<Id, Map<Id, CellEval>>>();
/** The ids of the share partition (the leaves the column total sums), in row order, keyed by the evaluated states of their resolve. */
const partitionLeafIds = new WeakMap<Map<Id, Map<Id, CellEval>>, Id[]>();

/** A row topN.rest false omits: calcs of the rows it keeps still read it. */
interface HiddenRow {
  sign: number;
  states: Map<Id, CellEval>;
  /** The row is a leaf of the full table's share partition: the part of the share denominator it carries. */
  leaf: boolean;
}

function applyTableTopN(
  data: TableData,
  options: TableOptions,
): { data: TableData; generatedOthers: Set<Id>; hidden: Map<Id, HiddenRow>; leafOrder: Map<Id, number> } {
  const topN = options.topN;
  if (!topN || topN.n <= 0) return { data, generatedOthers: new Set(), hidden: new Map(), leafOrder: new Map() };
  const inner = resolveTable(data, { ...options, topN: undefined });
  const folded = foldTableTopN(data, inner.table, options);
  // Values come from the full table, so a kept result reads an omitted row as the untruncated table shows it.
  const kept = new Set(flattenRows(folded.data.rows).map((row) => row.id));
  const innerById = new Map(inner.table.rows.map((row) => [row.id, row]));
  const hidden = new Map<Id, HiddenRow>();
  const leafOrder = new Map((partitionLeafIds.get(evaluatedStates.get(inner)!) ?? []).map((id, i) => [id, i] as const));
  for (const row of inner.table.rows) {
    if (kept.has(row.id)) continue;
    // The evaluated states keep which rows a partial total skipped, so a kept calc reading it still compares like with like.
    const evaluated = evaluatedStates.get(inner)?.get(row.id);
    const states = new Map<Id, CellEval>();
    for (const [colId, cell] of Object.entries(row.cells)) {
      const own = evaluated?.get(colId);
      states.set(colId, { raw: cell.raw, state: cell.state, ...(own?.partial ? { partial: true as const, skipped: own.skipped } : {}) });
    }
    hidden.set(row.id, { sign: contributionSignOf(row, (id) => innerById.get(id), null), states, leaf: leafOrder.has(row.id) });
  }
  return { ...folded, hidden, leafOrder };
}

/**
 * A record's `displayed` must describe its OWN `raw`. For calc/aggregate
 * records the two are the same fact, so the cell's string is right. A
 * reconciliation or gap record carries a number the cell never shows (the
 * engine's sum, or the gap itself); copying the cell's string there
 * produced records that contradicted themselves — raw 95000000 displayed
 * as "100.0" — and the claims sidecar published the contradiction.
 */
function stampRecordDisplay(
  records: ComputedCellRecord[],
  resolvedRows: ResolvedRow[],
  formatNumber: (raw: number, colId: Id, rowId?: Id) => string,
): void {
  const cellIndex = new Map<string, ResolvedCell>();
  for (const r of resolvedRows) for (const c of Object.values(r.cells)) cellIndex.set(tableCellKey(c.rowId, c.colId), c);
  for (const rec of records) {
    if (rec.kind === 'reconciliation' || rec.kind === 'rounding-adjustment') {
      rec.displayed = typeof rec.raw === 'number' ? formatNumber(rec.raw, rec.colId, rec.kind === 'rounding-adjustment' ? rec.rowId : undefined) : '';
      continue;
    }
    rec.displayed = cellIndex.get(tableCellKey(rec.rowId, rec.colId))?.displayed ?? rec.displayed;
  }
}

function sortSiblingGroups(
  childrenOf: Map<Id | null, FlatRow[]>,
  resolvedRows: ResolvedRow[],
  columns: ResolvedColumn[],
  options: TableOptions,
  generatedOthers: Set<Id>,
): void {
  const catSort = options.sort?.categories ?? 'sheet';
  if (catSort === 'asc' || catSort === 'desc') {
    requireAdditiveRanking(columns, resolvedRows, 'options.sort.categories', 'sort.categories');
  }
  if (catSort === 'sheet') {
    pinOthersLast(childrenOf, resolvedRows, generatedOthers);
    return;
  }
  const byId = new Map(resolvedRows.map((row) => [row.id, row]));
  for (const sibs of childrenOf.values()) {
    const dataIdx = sibs
      .map((_, index) => index)
      .filter((index) => ranksAsData(byId.get(sibs[index]!.id)));
    if (dataIdx.length < 2) continue;
    const data = dataIdx.map((index) => sibs[index]!);
    const rest = data.filter((row) => !generatedOthers.has(row.id));
    const others = data.filter((row) => generatedOthers.has(row.id));
    if (catSort === 'reverse') rest.reverse();
    else {
      const dir = catSort === 'asc' ? 1 : -1;
      rest.sort((a, b) => {
        const ka = additiveRankKey(byId.get(a.id)!, columns) ?? 0;
        const kb = additiveRankKey(byId.get(b.id)!, columns) ?? 0;
        return (ka - kb) * dir || a.order - b.order;
      });
    }
    const ordered = [...rest, ...others];
    dataIdx.forEach((index, j) => {
      sibs[index] = ordered[j]!;
    });
  }
}

function pinOthersLast(
  childrenOf: Map<Id | null, FlatRow[]>,
  resolvedRows: ResolvedRow[],
  generatedOthers: Set<Id>,
): void {
  const byId = new Map(resolvedRows.map((row) => [row.id, row]));
  for (const sibs of childrenOf.values()) {
    const dataIdx = sibs
      .map((_, index) => index)
      .filter((index) => ranksAsData(byId.get(sibs[index]!.id)));
    const data = dataIdx.map((index) => sibs[index]!);
    const rest = data.filter((row) => !generatedOthers.has(row.id));
    const others = data.filter((row) => generatedOthers.has(row.id));
    if (others.length === 0) continue;
    const ordered = [...rest, ...others];
    dataIdx.forEach((index, j) => {
      sibs[index] = ordered[j]!;
    });
  }
}

function rowHighlightTone(cells: Record<Id, ResolvedCell>): NonNullable<ResolvedRow['highlightTone']> {
  const tones = new Set(Object.values(cells).map((cell) => cell.tone));
  if (tones.has('bad')) return 'bad';
  if (tones.has('warn')) return 'warn';
  if (tones.has('good')) return 'good';
  return 'highlight';
}

function isCellObject(c: TableCell | undefined): c is TableCellObject {
  return typeof c === 'object' && c !== null;
}

function cellFormat(c: TableCell | undefined): string | undefined {
  return isCellObject(c) ? c.format : undefined;
}

/**
 * `nonNumeric` carries the authored string back to the caller when a value
 * cell holds one. The cell is still MISSING — the engine may not guess which
 * locale '1.234' was written in — but the caller owes the author a lint, and
 * from inside this function there is nothing to attach one to.
 */
function readNumeric(c: TableCell | undefined): {
  raw: number | null;
  state: CellState;
  nonNumeric?: string;
} {
  if (c === undefined || c === null) return { raw: null, state: 'missing' };
  if (typeof c === 'number') return { raw: c, state: 'value' };
  if (typeof c === 'string') return { raw: null, state: 'missing', nonNumeric: c };
  if (c.state) return { raw: typeof c.v === 'number' ? c.v : null, state: c.state };
  if (typeof c.v === 'number') return { raw: c.v, state: 'value' };
  if (typeof c.v === 'string') return { raw: null, state: 'missing', nonNumeric: c.v };
  return { raw: null, state: 'missing' };
}


/**
 * The rung a row takes on the level ladder: its depth with SECTION
 * HEADINGS skipped, shifted by `options.levelOffset` and floored at 0.
 *
 * A heading is not a rung. A steering table prints its KPI
 * rows at the top step (12/16, 7 px of air, the emphasis ground, the base
 * indent) under headings that carry their own uppercase style, and the
 * ground ladder has always read the tree that way (`rowGrounds` counted
 * non-section parents only) while the type ladder counted the heading as a
 * level. The two now answer the same question.
 *
 * A total takes no offset. It restates its siblings and is not a
 * rung, so a board that steps its group rows down with `levelOffset: 1`
 * keeps its total on the depth it was authored at: the indent, the anchor
 * wash and the label ink read that, and its size, weight and air stay the
 * total's own on both surfaces.
 */
function ladderStep(row: FlatRow, byId: Map<Id, FlatRow>, offset: number): number {
  if (row.rung !== undefined) return Math.max(0, row.rung + offset);
  let depth = 0;
  let parentId = row.parentId;
  while (parentId !== null && parentId !== undefined) {
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    if (parent.role !== 'section') depth += 1;
    parentId = parent.parentId;
  }
  return Math.max(0, depth + (row.role === 'total' ? 0 : offset));
}

function flattenRows(rows: TableData['rows']): FlatRow[] {
  const out: FlatRow[] = [];
  const seen = new Set<Id>();
  let order = 0;
  const walk = (row: TableData['rows'][number], parentId: Id | null, level: number) => {
    if (seen.has(row.id)) {
      throw new NormalizeError(
        'duplicate-row-id',
        `rows[${row.id}]`,
        `row id '${row.id}' appears more than once — row ids are globally unique (a fact shown in two groupings needs two rows referencing it)`,
      );
    }
    seen.add(row.id);
    // The schema refuses it on every validate path; this holds for a host that never ran it.
    if (row.badge !== undefined && row.role !== 'section') {
      throw new NormalizeError('invalid-data', `rows[${row.id}].badge`, BADGE_SECTION_ONLY);
    }
    // The schema trims the chip text and refuses it empty; a host that never ran it gets the same.
    const badgeText = row.badge?.text.trim();
    if (badgeText === '') throw new NormalizeError('invalid-data', `rows[${row.id}].badge.text`, BADGE_TEXT_EMPTY);
    const displayOnly = row.kind === 'result' || row.kind === 'driver';
    if (displayOnly && row.relation !== undefined && row.relation !== 'displayOnly') throw new NormalizeError('invalid-data', `rows[${row.id}].relation`, row.kind === 'result' ? 'a result is computed from rows above; adding it to a parent counts it twice' : 'a driver explains a row; adding it to a parent counts a different measure');
    if (row.sign !== undefined && (displayOnly || (row.relation ?? 'additive') !== 'additive')) throw new NormalizeError('invalid-data', `rows[${row.id}].sign`, 'sign requires relation additive');
    if (row.final && row.kind !== 'result') throw new NormalizeError('invalid-data', `rows[${row.id}].final`, 'final requires kind result');
    const declaredParent = row.parentId ?? parentId;
    if (row.parentId && parentId && row.parentId !== parentId) {
      throw new NormalizeError(
        'parent-conflict',
        `rows[${row.id}]`,
        `nested under '${parentId}' but declares parentId '${row.parentId}'`,
      );
    }
    out.push({
      id: row.id,
      label: row.label ?? row.id,
      parentId: declaredParent ?? null,
      kind: row.kind,
      sign: row.sign,
      operator: row.operator,
      final: row.final,
      ...(row.divider === true ? { divider: true as const } : {}),
      scale: row.scale,
      rung: row.rung,
      role: row.role ?? (row.kind === 'section' ? 'section' : 'data'),
      relation: displayOnly ? 'displayOnly' : row.relation ?? 'additive',
      totalPolicy: row.totalPolicy,
      calc: row.calc,
      format: row.format,
      polarity: row.polarity,
      ...(row.inline === true ? { inline: true as const, inlineGroup: row.inlineGroup ?? row.id } : {}),
      ...(row.unitAffix === undefined ? {} : { unitAffix: row.unitAffix }),
      ...(row.missing === undefined ? {} : { missing: row.missing }),
      ...(row.spacer === undefined || row.spacer <= 0 ? {} : { spacer: row.spacer }),
      ...(row.foldable === false ? { foldable: false as const } : {}),
      ...(row.badge === undefined ? {} : { badge: { ...row.badge, text: badgeText! } }),
      cells: row.cells ?? {},
      level,
      order: order++,
      ...((row as MagnitudeGroupSource)[MAGNITUDE_GROUP] === undefined ? {} : { [MAGNITUDE_GROUP]: (row as MagnitudeGroupSource)[MAGNITUDE_GROUP] }),
      ...((row as AutomaticFormatSource)[AUTOMATIC_FORMAT] === true ? { [AUTOMATIC_FORMAT]: true as const } : {}),
    });
    for (const child of row.children ?? []) walk(child, row.id, level + 1);
  };
  for (const row of rows) walk(row, null, 0);
  // resolve levels for flat-authored rows (parentId chains)
  const byId = new Map(out.map((r) => [r.id, r]));
  for (const r of out) {
    if (r.parentId && !byId.has(r.parentId)) {
      throw new NormalizeError('parent-missing', `rows[${r.id}]`, `parentId '${r.parentId}' does not exist`);
    }
    let level = 0;
    let p = r.parentId;
    const guard = new Set<Id>([r.id]);
    while (p) {
      if (guard.has(p)) {
        throw new NormalizeError('parent-cycle', `rows[${r.id}]`, `row hierarchy contains a cycle at '${p}'`);
      }
      guard.add(p);
      level++;
      p = byId.get(p)!.parentId;
    }
    r.level = level;
  }
  return out;
}

function orderPostfix(childrenOf: Map<Id | null, FlatRow[]>): FlatRow[] {
  const out: FlatRow[] = [];
  const visit = (rows: FlatRow[]) => {
    for (const r of rows) {
      visit(childrenOf.get(r.id) ?? []);
      out.push(r);
    }
  };
  visit(childrenOf.get(null) ?? []);
  return out;
}

function orderRows(
  rows: ResolvedRow[],
  childrenOf: Map<Id | null, FlatRow[]>,
  totalPos: 'top' | 'bottom',
): ResolvedRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ResolvedRow[] = [];
  const emit = (ids: FlatRow[]) => {
    const relocates = (r: FlatRow) => byId.get(r.id)!.role === 'total' && r.kind !== 'result' && r.kind !== 'driver';
    const totals = ids.filter(relocates);
    const rest = ids.filter((r) => !relocates(r));
    const sequence = totalPos === 'top' ? [...totals, ...rest] : [...rest, ...totals];
    for (const f of sequence) {
      out.push(byId.get(f.id)!);
      emit(childrenOf.get(f.id) ?? []);
    }
  };
  emit(childrenOf.get(null) ?? []);
  return out;
}

function localeDefaults(locale: TableOptions['locale']): {
  decimal: '.' | ',';
  thousands: NumberFormatSpec['thousandsSep'];
  minusGlyph: '−' | '-';
} {
  const { decimal, thousands } = chartNumberMarks(locale);
  return { decimal, thousands, minusGlyph: locale?.minusGlyph ?? MINUS };
}

function resolveExpansion(
  rows: FlatRow[],
  childrenOf: Map<Id | null, FlatRow[]>,
  options: TableOptions,
  warnings: LintWarning[],
  generatedOthers: Set<Id>,
): Map<Id, boolean> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parents = rows.filter((row) => (childrenOf.get(row.id) ?? []).length > 0);
  const depth = options.expansion?.depth ?? 'all';
  // The totals step folds every parent but a section heading, which stays open over its totals or its folded rows.
  const expanded = new Map<Id, boolean>(
    parents.map((row) => [row.id, row.foldable === false || depth === 'all' || (depth === 'totals' ? row.role === 'section' : row.level < depth)]),
  );
  for (const id of generatedOthers) {
    if (expanded.has(id)) expanded.set(id, false);
  }
  const apply = (ids: Id[] | undefined, value: boolean) => {
    for (const id of ids ?? []) {
      const row = byId.get(id);
      if (!row) {
        warnings.push({
          code: 'expansion-ref-unknown',
          severity: 'warn',
          message: `expansion references unknown row '${id}' — no view state was changed`,
          owner: { rowId: id },
        });
      } else if (!expanded.has(id)) {
        warnings.push({
          code: 'expansion-ref-leaf',
          severity: 'info',
          message: `expansion references leaf row '${id}' — leaves have no expansion state`,
          owner: { rowId: id },
        });
      } else if (row.foldable === false) {
        warnings.push({
          code: 'expansion-ref-unfoldable',
          severity: 'info',
          message: `expansion references row '${id}', which is foldable: false — its children stay drawn`,
          owner: { rowId: id },
        });
      } else {
        expanded.set(id, value);
      }
    }
  };
  apply(options.expansion?.collapsed, false);
  apply(options.expansion?.expanded, true);
  return expanded;
}

function resolveColumnToggles(
  data: TableData,
  options: TableOptions,
  colById: Map<Id, TableColumn>,
  warnings: LintWarning[],
): {
  membership: Map<Id, Id>;
  toggles: ResolvedTable['columnToggles'];
} {
  const membership = new Map<Id, Id>();
  const toggleIds = new Set<Id>();
  const groupByColumn = new Map<Id, Id>();
  for (const group of data.columnGroups ?? []) {
    for (const columnId of group.columns) groupByColumn.set(columnId, group.id);
  }

  for (const toggle of data.columnToggles ?? []) {
    if (toggleIds.has(toggle.id)) {
      throw new NormalizeError(
        'duplicate-toggle-id',
        `columnToggles[${toggle.id}]`,
        `duplicate toggle id '${toggle.id}'`,
      );
    }
    toggleIds.add(toggle.id);
    for (const columnId of toggle.columns) {
      if (!colById.has(columnId)) {
        throw new NormalizeError(
          'toggle-ref-invalid',
          `columnToggles[${toggle.id}]`,
          `toggle '${toggle.id}' references unknown column '${columnId}'`,
        );
      }
      const owner = membership.get(columnId);
      if (owner !== undefined) {
        throw new NormalizeError(
          'toggle-ref-invalid',
          `columnToggles[${toggle.id}]`,
          `column '${columnId}' already belongs to toggle '${owner}' — a column may belong to at most one toggle group`,
        );
      }
      membership.set(columnId, toggle.id);
    }
    // One header group, or none at all: a board with a single head
    // row carries its toggles over a plain run of columns. Straddling two
    // groups, or one group and the columns outside it, still refuses: a
    // heading's span would move under the reader.
    const groupIds = new Set(toggle.columns.map((columnId) => groupByColumn.get(columnId)));
    if (groupIds.size !== 1) {
      throw new NormalizeError(
        'toggle-group-span',
        `columnToggles[${toggle.id}]`,
        `every member of toggle '${toggle.id}' must belong to one columnGroup, or none of them to any`,
      );
    }
  }

  for (const toggleId of Object.keys(options.columnVisibility ?? {})) {
    if (!toggleIds.has(toggleId)) {
      warnings.push({
        code: 'column-visibility-ref-unknown',
        severity: 'warn',
        message: `columnVisibility references unknown toggle '${toggleId}' — no columns were changed`,
      });
    }
  }

  return {
    membership,
    toggles: (data.columnToggles ?? []).map((toggle) => {
      const defaultVisible = toggle.defaultVisible ?? false;
      return {
        id: toggle.id,
        label: toggle.label,
        columnIds: toggle.columns,
        defaultVisible,
        visible: options.columnVisibility?.[toggle.id] ?? defaultVisible,
      };
    }),
  };
}

function validateGroups(data: TableData, colById: Map<Id, TableColumn>): void {
  const groups = data.columnGroups ?? [];
  const claimed = new Map<Id, Id>();
  const columnIndex = new Map(data.columns.map((column, index) => [column.id, index]));
  for (const g of groups) {
    for (const cid of g.columns) {
      if (!colById.has(cid)) {
        throw new NormalizeError('group-ref-invalid', `columnGroups[${g.id}]`, `references unknown column '${cid}'`);
      }
      if (claimed.has(cid)) {
        throw new NormalizeError(
          'group-ref-invalid',
          `columnGroups[${g.id}]`,
          `column '${cid}' already belongs to group '${claimed.get(cid)}'`,
        );
      }
      claimed.set(cid, g.id);
    }
    const idx = g.columns.map((cid) => columnIndex.get(cid)!).sort((a, b) => a - b);
    for (let i = 1; i < idx.length; i++) {
      if (idx[i]! !== idx[i - 1]! + 1) {
        throw new NormalizeError(
          'group-not-contiguous',
          `columnGroups[${g.id}]`,
          `group members must be contiguous in columns[] order`,
        );
      }
    }
  }
}

function validateCalcRefs(columns: TableColumn[], colById: Map<Id, TableColumn>): void {
  const checkRef = (rid: Id, owner: Id): void => {
    const target = colById.get(rid);
    if (!target) {
      throw new NormalizeError('calc-ref-missing', `columns[${owner}].calc`, `references unknown column '${rid}'`);
    }
    if (target.kind !== 'value') {
      throw new NormalizeError(
        'compute-ref-computed',
        `columns[${owner}].calc`,
        `references '${rid}' (kind '${target.kind}') — calcs may reference value columns only in v1`,
      );
    }
  };
  const checkCell = (ref: CalcCellRef, owner: Id): void => {
    if (typeof ref !== 'string') {
      throw new NormalizeError(
        'row-ref-in-column-calc',
        `columns[${owner}].calc`,
        `column calculations still refer to the current row — use a column id, or put a cross-row calc on the row`,
      );
    }
    checkRef(ref, owner);
  };
  const check = (calc: Calc, owner: Id): void => {
    if ('lit' in calc) return;
    if ('ref' in calc) return checkCell(calc.ref, owner);
    switch (calc.op) {
      case 'abs':
        return check(calc.of, owner);
      case 'add':
      case 'sub':
      case 'mul':
      case 'div':
        check(calc.a, owner);
        check(calc.b, owner);
        return;
      case 'share':
        return checkCell(calc.of, owner);
      case 'delta':
      case 'percentDelta':
        checkCell(calc.a, owner);
        checkCell(calc.b, owner);
        return;
    }
  };
  for (const c of columns) {
    if (c.kind === 'computed') check(c.calc, c.id);
  }
}

/**
 * The row id a share denominator is filed under in a claim's inputs. It is not
 * a row in the table — it is the exhaustive leaf partition the share is taken
 * over — so it gets a reserved, non-colliding id rather than borrowing one.
 */
export const LEAF_TOTAL_ROW_ID = '__leafTotal';
/** Likewise for the display unit a largest-remainder adjustment moves by. */
export const SHARE_UNIT_ROW_ID = '__displayUnit';

function pushCalcRecord(
  records: ComputedCellRecord[],
  rowId: Id,
  colId: Id,
  res: CalcOutcome,
): void {
  records.push({
    rowId,
    colId,
    op: res.op,
    inputs: res.inputs,
    raw: res.raw,
    state: res.state,
    displayed: '',
    kind: 'calc',
  });
}

type SignedRow = Pick<FlatRow, 'id' | 'kind' | 'relation' | 'sign'> & { parentId?: Id | null };

/** The product of additive signs from a row up to `stop` (exclusive). */
function contributionSignOf<R extends SignedRow>(row: R, byId: (id: Id) => R | undefined, stop: Id | null): number {
  let sign = 1;
  let current: R | undefined = row;
  while (current && current.id !== stop) {
    // A driver or a result adds into nothing: the rows under it keep their own sign.
    if (current !== row && (current.kind === 'driver' || current.kind === 'result')) break;
    if (current.relation === 'additive') sign *= current.sign ?? 1;
    current = current.parentId == null ? undefined : byId(current.parentId);
  }
  return sign;
}

function numericColKind(kind: TableColumn['kind']): boolean {
  return kind === 'value' || kind === 'computed';
}

function validateRowCalcRef(
  ref: CalcCellRef,
  owner: Id,
  rowIds: Set<Id>,
  calcRows: Set<Id>,
  colById: Map<Id, TableColumn>,
  reads?: Id[],
): void {
  if (typeof ref === 'string') {
    const target = colById.get(ref);
    if (!target || !numericColKind(target.kind)) {
      throw new NormalizeError(
        'calc-ref-missing',
        `rows[${owner}].calc`,
        `references unknown numeric column '${typeof ref === 'string' ? ref : ''}'`,
      );
    }
    return;
  }
  if (!rowIds.has(ref.row)) {
    throw new NormalizeError('calc-ref-missing', `rows[${owner}].calc`, `references unknown row '${ref.row}'`);
  }
  // A calc row may read another calc row (EBIT = gross profit − opex); the caller orders them and refuses a cycle.
  if (calcRows.has(ref.row)) reads?.push(ref.row);
  if (ref.col) {
    const target = colById.get(ref.col);
    if (!target || !numericColKind(target.kind)) {
      throw new NormalizeError(
        'calc-ref-missing',
        `rows[${owner}].calc`,
        `references unknown numeric column '${ref.col}'`,
      );
    }
  }
}

/** The cell references a calc reads, in order. */
function calcRefs(calc: Calc, refs: CalcCellRef[] = []): CalcCellRef[] {
  if ('lit' in calc) return refs;
  if ('ref' in calc) { refs.push(calc.ref); return refs; }
  switch (calc.op) {
    case 'abs':
      return calcRefs(calc.of, refs);
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
      calcRefs(calc.a, refs);
      return calcRefs(calc.b, refs);
    case 'share':
      refs.push(calc.of);
      return refs;
    case 'delta':
    case 'percentDelta':
      refs.push(calc.a, calc.b);
  }
  return refs;
}

function walkRowCalc(calc: Calc, owner: Id, rowIds: Set<Id>, calcRows: Set<Id>, colById: Map<Id, TableColumn>, reads: Id[] = []): Id[] {
  const ref = (r: CalcCellRef) => validateRowCalcRef(r, owner, rowIds, calcRows, colById, reads);
  if ('lit' in calc) return reads;
  if ('ref' in calc) { ref(calc.ref); return reads; }
  switch (calc.op) {
    case 'abs':
      return walkRowCalc(calc.of, owner, rowIds, calcRows, colById, reads);
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
      walkRowCalc(calc.a, owner, rowIds, calcRows, colById, reads);
      walkRowCalc(calc.b, owner, rowIds, calcRows, colById, reads);
      return reads;
    case 'share':
      ref(calc.of);
      return reads;
    case 'delta':
    case 'percentDelta':
      ref(calc.a);
      ref(calc.b);
  }
  return reads;
}

interface NegativeBase {
  scope: 'column' | 'row';
  rowId: Id;
  colId: Id;
  /** How many cells of the column calc, or of the row calc, divide by a negative cell. */
  cells: number;
}

function evaluateTableCalcs(
  flat: FlatRow[],
  valueCols: Extract<TableColumn, { kind: 'value' }>[],
  computedCols: Extract<TableColumn, { kind: 'computed' }>[],
  rawState: Map<Id, Map<Id, CellEval>>,
  records: ComputedCellRecord[],
  leafTotal: (colId: Id) => number | null,
  columnGroups: { columns: Id[] }[],
  colById: Map<Id, TableColumn>,
  noPrevious: 'na' | 'missing' = 'na',
  contributionSign: (id: Id) => number = () => 1,
): { nearZero: boolean; mixedCoverage: boolean; negativeBase: NegativeBase[] } {
  /** The first cell of each column calc and each row calc that divides by a negative cell. */
  const negativeBase = new Map<string, NegativeBase>();
  const noteNegativeBase = (scope: 'column' | 'row', rowId: Id, colId: Id): void => {
    const key = `${scope}:${scope === 'column' ? colId : rowId}`;
    const seen = negativeBase.get(key);
    if (seen) seen.cells += 1;
    else negativeBase.set(key, { scope, rowId, colId, cells: 1 });
  };
  /** Whether a percent change printed n.m. for a near-zero base, so the table adds its note. */
  let nearZero = false;
  /** Whether a figure printed n.m. because its operands sum different rows. */
  let mixedCoverage = false;
  // rawState also holds the rows topN.rest false omits; calcs may read them.
  const rowIds = new Set(rawState.keys());
  const calcRows = new Set(flat.filter((row) => row.calc).map((row) => row.id));
  const previousCol = (colId: Id) => previousColumnInGroup(columnGroups, colId);
  const numericCols = [...valueCols, ...computedCols];
  // A figure computed from a partial total is partial too, and skips the rows its operands skip.
  // A row calc reads its own row's cells as they were before it ran, so `states` is what it read.
  const partialFrom = (res: CalcOutcome, rowId: Id, states: Map<Id, CellEval>): { partial?: true; skipped?: string } => {
    if (res.state !== 'value') return {};
    const partials = res.inputs.map((input) => (input.rowId === rowId ? states : rawState.get(input.rowId))?.get(input.colId)).filter((state) => state?.partial);
    return partials.length > 0 ? { partial: true, skipped: skippedKey(partials.flatMap((state) => skippedRows(state!))) } : {};
  };

  // The skipped rows of the cell a reference reads, resolved as the calc reads it.
  const coverageOf = (rowId: Id, states: Map<Id, CellEval>, currentCol: Id) => (ref: CalcCellRef): string | undefined => {
    const cell = resolveCalcRef(ref, rowId, currentCol, previousCol);
    if (typeof cell === 'string') return undefined;
    return (cell.rowId === rowId ? states.get(cell.colId) : rawState.get(cell.rowId)?.get(cell.colId))?.skipped ?? '';
  };

  for (const row of flat) {
    if (row.role === 'section' || row.calc) continue;
    const states = rawState.get(row.id)!;
    for (const col of computedCols) {
      let res = evalCalc(col.calc, row, states, leafTotal, undefined, contributionSign);
      // A full pace against an outlook that skipped a child compares two
      // different sets of rows: the change between them is no change, so it prints n.m.
      if (res.state === 'value' && comparesMixedRows(col.calc, coverageOf(row.id, states, col.id))) {
        res = { ...res, raw: null, state: 'nm' };
        mixedCoverage = true;
      }
      states.set(col.id, { raw: res.raw, state: res.state, ...partialFrom(res, row.id, states) });
      if (res.nearZero) nearZero = true;
      if (res.negativeBase && res.state === 'value') noteNegativeBase('column', row.id, col.id);
      pushCalcRecord(records, row.id, col.id, res);
    }
  }

  // Calc rows in dependency order: a row reads the calc rows it names after they are evaluated.
  const calcFlat = flat.filter((row) => row.role !== 'section' && row.calc);
  const byId = new Map(calcFlat.map((row) => [row.id, row]));
  const ordered: FlatRow[] = [];
  const visit = new Map<Id, 'open' | 'done'>();
  const place = (row: FlatRow) => {
    if (visit.get(row.id) === 'done') return;
    if (visit.get(row.id) === 'open') throw new NormalizeError('compute-ref-cycle', `rows[${row.id}].calc`, `row calcs form a cycle through '${row.id}'`);
    if (row.relation === 'additive') {
      throw new NormalizeError(
        'row-calc-relation',
        `rows[${row.id}]`,
        `row '${row.id}' has calc but relation '${row.relation}' — row calculations must be ofWhich or displayOnly so they are not summed`,
      );
    }
    visit.set(row.id, 'open');
    for (const id of walkRowCalc(row.calc!, row.id, rowIds, calcRows, colById)) place(byId.get(id)!);
    visit.set(row.id, 'done');
    ordered.push(row);
  };
  calcFlat.forEach(place);
  for (const row of ordered) {
    const states = rawState.get(row.id)!;
    const sourceStates = new Map(states);
    for (const col of numericCols) {
      if (col.kind === 'computed' && !calcPreservesScale(col.calc)) continue;
      // A delta column, or a sub column of two cells, takes the change of a nonlinear row calc's own cells
      // (a margin), not the ratio of the changes. A sum column keeps running the row calc on the sums: a YTD growth is the ratio of sums.
      const ownCalc = col.kind === 'computed' && isChangeCalc(col.calc) && !calcIsLinear(row.calc!);
      const calc = ownCalc ? col.calc : row.calc!;
      const read = ownCalc ? states : sourceStates;
      let res = evalCalc(calc, row, read, leafTotal, ownCalc ? undefined : {
        currentCol: col.id,
        rawState,
        previousCol,
        noPrevious,
      }, contributionSign);
      // A row calc compares rows the way a column calc compares columns.
      if (res.state === 'value' && comparesMixedRows(calc, coverageOf(row.id, read, col.id))) {
        res = { ...res, raw: null, state: 'nm' };
        mixedCoverage = true;
      }
      states.set(col.id, { raw: res.raw, state: res.state, ...partialFrom(res, row.id, read) });
      if (res.nearZero) nearZero = true;
      if (res.negativeBase && res.state === 'value') noteNegativeBase('row', row.id, col.id);
      pushCalcRecord(records, row.id, col.id, res);
    }
  }
  return { nearZero, mixedCoverage, negativeBase: [...negativeBase.values()] };
}

/** A column calc that is the change between two cells: delta, or sub of two column references. */
function isChangeCalc(calc: Calc): boolean {
  return 'op' in calc && (calc.op === 'delta' || (calc.op === 'sub' && 'ref' in calc.a && 'ref' in calc.b));
}

/**
 * A cell's evaluated value; `partial` marks a total that skipped a missing child, or a figure built on one.
 * `skipped` names the rows it skipped, so two partial totals compare only where they skipped the same rows.
 */
type CellEval = { raw: number | string | null; state: CellState; partial?: true; skipped?: string };

/**
 * Whether a comparison in the calc (sub, mul, div, delta, percentDelta) sets
 * operands against each other that skipped different rows. A sum may add
 * partial totals: it stays a partial sum of what exists. `skippedOf` names
 * the rows the cell a reference reads skipped ('' for a full cell), or
 * undefined where the reference reads no cell.
 */
function comparesMixedRows(calc: Calc, skippedOf: (ref: CalcCellRef) => string | undefined): boolean {
  // A side without a cell (a literal) covers no rows and compares with any side.
  const side = (node: Calc | CalcCellRef): string | undefined => {
    const refs = typeof node === 'string' || !('op' in node || 'ref' in node || 'lit' in node) ? [node as CalcCellRef] : calcRefs(node as Calc);
    const keys = refs.map(skippedOf).filter((key) => key !== undefined);
    return keys.length === 0 ? undefined : skippedKey(keys.flatMap((key) => skippedRows({ skipped: key })));
  };
  const differ = (a: Calc | CalcCellRef, b: Calc | CalcCellRef): boolean => {
    const left = side(a);
    const right = side(b);
    return left !== undefined && right !== undefined && left !== right;
  };
  const visit = (node: Calc): boolean => {
    if ('lit' in node || 'ref' in node) return false;
    switch (node.op) {
      case 'abs':
        return visit(node.of);
      case 'add':
        return visit(node.a) || visit(node.b);
      case 'sub':
      case 'mul':
      case 'div':
        return visit(node.a) || visit(node.b) || differ(node.a, node.b);
      case 'delta':
      case 'percentDelta':
        return differ(node.a, node.b);
      case 'share':
        return false;
    }
    return false;
  };
  return visit(calc);
}

/** The rows a partial cell skipped, as one sortable key. */
function skippedKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join('\u001f');
}

function skippedRows(state: { skipped?: string }): string[] {
  return state.skipped ? state.skipped.split('\u001f') : [];
}

interface CalcOutcome {
  raw: number | null;
  state: CellState;
  op: string;
  inputs: { rowId: Id; colId: Id; value: number }[];
  /** A ratio of a value that divides by a negative cell and prints as plain arithmetic. */
  negativeBase?: true;
  /** A percent change printed n.m. because its base is near zero. */
  nearZero?: true;
}

/**
 * Evaluate a calc AND emit the receipt for it.
 *
 * `op` is the WHOLE expression, never `calc.op`, the ROOT operator only. A
 * root-only receipt erases every nested operator and every literal:
 * `mul(div(gp, revenue), lit 100)` would read `op:'mul@1', inputs:[gp=4.19e9,
 * revenue=1.198e10]`, output 34.97, and a reader who does what the receipt says
 * computes 5.02e19 against a chart that prints 35.0% and concludes the exhibit
 * was tampered with. A missing receipt is a gap; that one is an accusation, and
 * `verify` cannot catch it because it recomputes the same mislabel on both sides.
 *
 * The expression is canonicalised with positional operand
 * placeholders and literals inline: `mul(div($0,$1),100)`. `$n` indexes
 * `inputs[n]` in emission order (the same cell read twice appears twice — the
 * placeholders are positional, never de-duplicated, so the tree stays exact).
 * A third party can parse and evaluate it from the manifest alone; that is what
 * `recomputeClaim` does, with no access to the chart.
 */
function evalCalc(
  calc: Calc,
  row: FlatRow,
  states: Map<Id, { raw: number | string | null; state: CellState }>,
  leafTotal: (colId: Id) => number | null,
  scope?: {
    currentCol: Id;
    rawState: Map<Id, Map<Id, { raw: number | string | null; state: CellState }>>;
    previousCol: (colId: Id) => Id | null;
    noPrevious?: 'na' | 'missing';
  },
  contributionSign: (id: Id) => number = () => 1,
): CalcOutcome {
  const inputs: { rowId: Id; colId: Id; value: number }[] = [];
  type NonValue = Exclude<CellState, 'value'>;
  type Node = number | NonValue;
  const isState = (v: Node): v is NonValue => typeof v !== 'number';
  /** Canonical text of the sub-expression last evaluated by `evalNode`. */
  let expr = '';
  let nearZero = false;
  let negativeBase = false;
  const emit = (text: string): void => {
    expr = text;
  };
  const read = (ref: CalcCellRef): Node =>
    readCalcInput(ref, {
      currentRow: row.id,
      currentCol: scope?.currentCol,
      states,
      rawState: scope?.rawState,
      previousCol: scope?.previousCol,
      noPrevious: scope?.noPrevious,
      inputs,
      emit,
    });
  /** Which reason survives a binary operator (see STATE_PRECEDENCE). */
  const worse = (a: NonValue, b: NonValue): NonValue => dominantState([a, b]);
  /** Evaluate a child and hand back both its value and its canonical text. */
  const child = (node: Calc): [Node, string] => {
    const value = evalNode(node);
    return [value, expr];
  };

  const evalNode = (node: Calc): Node => {
    if ('ref' in node) return read(node.ref);
    if ('lit' in node) {
      // `lit 100` is what turns a fraction into percentage points, and a
      // receipt that erased it would mislead the reader by orders of magnitude.
      emit(String(node.lit));
      return node.lit;
    }
    switch (node.op) {
      case 'abs': {
        const [v, vExpr] = child(node.of);
        emit(`abs(${vExpr})`);
        return typeof v === 'number' ? Math.abs(v) : v;
      }
      case 'add':
      case 'sub':
      case 'mul':
      case 'div': {
        const [a, aExpr] = child(node.a);
        const [b, bExpr] = child(node.b);
        emit(`${node.op}(${aExpr},${bExpr})`);
        if (isState(a) && isState(b)) return worse(a, b);
        if (isState(a)) return a;
        if (isState(b)) return b;
        if (node.op === 'add') return a + b;
        if (node.op === 'sub') return a - b;
        if (node.op === 'mul') return a * b;
        if (b === 0) return a === 0 ? 'na' : 'nm';
        // A literal divisor is the author's own constant, not a base that went negative.
        if (b < 0 && !('lit' in node.b)) negativeBase = true;
        return a / b;
      }
      case 'delta': {
        const a = read(node.a);
        const aExpr = expr;
        const b = read(node.b);
        emit(`delta(${aExpr},${expr})`);
        if (isState(a) && isState(b)) return worse(a, b);
        if (isState(a)) return a;
        if (isState(b)) return b;
        return a - b;
      }
      case 'percentDelta': {
        const a = read(node.a);
        const aExpr = expr;
        const b = read(node.b);
        emit(`percentDelta(${aExpr},${expr})`);
        if (isState(a) && isState(b)) return worse(a, b);
        if (isState(a)) return a;
        if (isState(b)) return b;
        if (b === 0) {
          if (a === 0) return 'na';
          // €650k vs €0 plan must scream; a zero base is the nearest to zero there is.
          nearZero = true;
          return 'nm';
        }
        // One rule with kpi and variance: a percent change off a negative
        // reference is not meaningful either.
        if (b < 0) return 'nm';
        // A change past +-999 % says the base is near zero, not that the figure grew; it prints n.m.
        const change = (100 * (a - b)) / b;
        if (Math.abs(change) <= PERCENT_DELTA_CAP) return change;
        nearZero = true;
        return 'nm';
      }
      case 'share': {
        const sign = contributionSign(typeof node.of === 'string' ? row.id : node.of.row);
        const authored = read(node.of);
        const v = typeof authored === 'number' ? sign * authored : authored;
        const vExpr = sign === -1 ? `mul(${expr},-1)` : expr;
        if (isState(v)) {
          emit(`share(${vExpr},?)`);
          return v;
        }
        const ofCol = typeof node.of === 'string' ? node.of : (node.of.col ?? scope?.currentCol);
        const total = ofCol ? leafTotal(ofCol) : null;
        if (!ofCol || total === null) {
          emit(`share(${vExpr},?)`);
          return 'missing';
        }
        // THE DENOMINATOR. A table share claim carries both operands, the
        // value and the leaf total, so the receipt shows "35.1%" of what.
        // The likert branch states the same rule — "the share claim carries
        // the COUNT and the BASE, which is what makes the denominator
        // auditable".
        inputs.push({ rowId: LEAF_TOTAL_ROW_ID, colId: ofCol, value: total });
        emit(`share(${vExpr},$${inputs.length - 1})`);
        if (total === 0) return v === 0 ? 'na' : 'nm';
        return (100 * v) / total;
      }
    }
  };

  const result = evalNode(calc);
  const op = 'ref' in calc ? `ref(${expr})` : 'lit' in calc ? `lit(${expr})` : expr;
  if (isState(result)) return { raw: null, state: result, op, inputs, ...(nearZero && result === 'nm' ? { nearZero: true as const } : {}) };
  return { raw: result, state: 'value', op, inputs, ...(negativeBase ? { negativeBase: true as const } : {}) };
}

export { datePatternFromExample, MINUS };
