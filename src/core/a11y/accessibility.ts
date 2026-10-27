import { chartString } from '../strings/a11y-accessibility';
import { interactionValueText, rawUnit } from './valueText';
import type { InteractionRecord, InteractionValue } from './types';

/**
 * Record-derived accessible structures.
 *
 * Everything here reads the existing `InteractionRecord` population and the
 * existing shared value formatter. Nothing is measured, no geometry is
 * consulted, no value is invented: a fact the records do not carry is reported
 * as unavailable instead of being estimated, and a suppressed value keeps its
 * existing withheld wording rather than its raw number.
 */

/** How the accessible data table is presented by the React surface. */
export type A11yTablePlacement = 'hidden' | 'toggle' | 'below';

/** One table cell: formatted with the shared rules, tagged with its value state. */
interface A11yTableCell {
  text: string;
  state: InteractionValue['state'];
}

interface A11yTableColumn {
  key: string;
  label: string;
  /** Declared unit of this column's values, when the records carry one. */
  unit?: string;
}

interface A11yTableRow {
  id: string;
  /** Nesting depth of the row header; panel grouping sits above its categories. */
  level: number;
  header: string;
  /** One cell per column, in column order; null means no record was drawn. */
  cells: readonly (A11yTableCell | null)[];
}

export interface A11yDataTable {
  locale?: string;
  caption: string;
  columns: readonly A11yTableColumn[];
  rows: readonly A11yTableRow[];
}

/**
 * Series identity of a record: the semantic owner key a table column groups
 * by. A bar table names its number column or panel beside the row (`colId`
 * with a `categoryId`), so the same segment in two panels is two columns.
 */
function seriesIdentity(record: InteractionRecord): string | undefined {
  const owner = record.target.owner;
  const series = owner.seriesId ?? owner.rowId ?? owner.segmentId;
  if (owner.categoryId === undefined || owner.colId === undefined) return series;
  return series === undefined ? owner.colId : `${owner.colId}\u0000${series}`;
}

/** Category identity of a record: the semantic owner key for the category axis. */
function categoryIdentity(record: InteractionRecord): string | undefined {
  const owner = record.target.owner;
  return owner.categoryId ?? owner.pointId ?? owner.colId;
}

function unitOf(record: InteractionRecord): string | undefined {
  // The cells read raw values, so a head's magnitude ("k") is not their unit.
  const unit = rawUnit(record.value);
  return unit === undefined || unit.length === 0 ? undefined : unit;
}

function cellFor(record: InteractionRecord | undefined, locale?: string): A11yTableCell | null {
  if (!record) return null;
  return { text: interactionValueText(record.value, locale), state: record.value.state };
}

function rowLabel(record: InteractionRecord): string {
  return record.categoryLabel ?? record.seriesLabel ?? record.label ?? record.target.owner.categoryId ?? record.id;
}

function seriesLabelOf(record: InteractionRecord): string {
  return record.seriesLabel ?? seriesIdentity(record) ?? 'value';
}



/** The plotted records: an annotation (an event of the event lane, a value line) is no value and has no column or row of its own. */
function withoutEvents(records: readonly InteractionRecord[]): InteractionRecord[] {
  return records.filter(record => record.target.owner.annotationId === undefined);
}

function columnsOf(records: readonly InteractionRecord[]): A11yTableColumn[] {
  const columns: A11yTableColumn[] = [];
  for (const record of records) {
    const key = seriesIdentity(record) ?? 'value';
    if (columns.some(column => column.key === key)) continue;
    // A column names a unit only when every cell under it reads in that unit: a "k" or "m²" of one row is not the column's.
    // A range cell ("110–160") reads in its unit too; a text cell without one names none.
    const units = new Set(records.filter(entry => (seriesIdentity(entry) ?? 'value') === key && (entry.value.kind === 'number' || entry.value.unit !== undefined)).map(unitOf));
    const unit = units.size === 1 ? [...units][0] : undefined;
    columns.push({ key, label: seriesLabelOf(record), ...(unit === undefined ? {} : { unit }) });
  }
  return columns;
}

/** Category rows in draw order, nested under a panel header when panels exist. */
function rowsOf(records: readonly InteractionRecord[], columns: readonly A11yTableColumn[], locale?: string): A11yTableRow[] {
  const rows: A11yTableRow[] = [];
  const seen = new Set<string>();
  let lastPanel: string | undefined;
  let panelAnchored = false;
  for (const record of records) {
    const panel = record.target.panel;
    const depth = panel === undefined ? 0 : panel.split('/').length - 1;
    if (panel !== lastPanel) {
      lastPanel = panel;
      panelAnchored = panel !== undefined;
      if (panel !== undefined) rows.push({ id: `panel:${panel}`, level: depth, header: panel, cells: columns.map(() => null) });
    }
    const category = categoryIdentity(record);
    const header = rowLabel(record);
    const id = category === undefined ? record.id : `${record.target.panel ?? ''}/${category}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      level: panelAnchored ? depth + 1 : 0,
      header,
      cells: columns.map(column => cellFor(records.find(entry => entry.target.panel === panel
        && (category === undefined ? entry.id === record.id : categoryIdentity(entry) === category)
        && (seriesIdentity(entry) ?? 'value') === column.key), locale)),
    });
  }
  return rows;
}

/** Spec-derived accessible table over the displayed records; no invented values. */
export function accessibleDataTable(
  records: readonly InteractionRecord[],
  options: { title?: string; locale?: string } = {},
): A11yDataTable {
  records = withoutEvents(records);
  const columns = columnsOf(records);
  return {
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    caption: options.title === undefined ? chartString({ locale: { language: options.locale } }, 'chartData') : chartString({ locale: { language: options.locale } }, 'chartDataTitle', { v1: options.title }),
    columns,
    rows: rowsOf(records, columns, options.locale),
  };
}
