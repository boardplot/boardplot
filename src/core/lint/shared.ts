import { cellValue, type Cell, type OwnerRef } from '../types/cell';
import type { LintWarning } from '../types/scene';
import type { DocLintWarning, LintChart, LintCode } from './index';
import { pushAll } from '../arrays';

export type LintRecord = Record<string, unknown>;

export interface ScopedLintChart extends LintChart {
  displayName: string;
  path?: string;
  requireMessageTitle: boolean;
  authoredType: string;
  typeTitle?: string;
  /** The enclosing grid legend explains encodings once for all panels. */
  parentLegend?: unknown;
}

export function legendEnabled(value: unknown): boolean {
  return value !== undefined && value !== null && value !== 'none' && value !== false;
}

export function isRecord(value: unknown): value is LintRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asRecord(value: unknown): LintRecord {
  return isRecord(value) ? value : {};
}

export function chartOptions(chart: LintChart): LintRecord {
  return asRecord(chart.options);
}

export function records(value: unknown): LintRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function seriesOf(chart: LintChart): LintRecord[] {
  return records(asRecord(chart.data).series);
}

export function categoriesOf(chart: LintChart): LintRecord[] {
  const categories = asRecord(chart.data).categories;
  if (!Array.isArray(categories)) return [];
  return categories.map((category) =>
    typeof category === 'string' ? { id: category, label: category } : asRecord(category),
  );
}

export function labelOf(item: LintRecord): string | null {
  if (typeof item.label === 'string') return item.label;
  return typeof item.id === 'string' ? item.id : null;
}

export function cellsOfSeries(series: LintRecord): unknown[] {
  if (!Array.isArray(series.values)) return [];
  return series.values.map((entry) =>
    isRecord(entry) && 'categoryId' in entry && 'value' in entry ? entry.value : entry,
  );
}

export function cellNumber(cell: unknown): number | null {
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  if (!isRecord(cell)) return null;
  if (typeof cell.number === 'number' && Number.isFinite(cell.number)) return cell.number;
  if (typeof cell.pct === 'number' && Number.isFinite(cell.pct)) return cell.pct;
  if ('value' in cell) return cellNumber(cell.value);
  return null;
}

function cellFormat(cell: unknown): string | undefined {
  return isRecord(cell) && typeof cell.format === 'string' ? cell.format : undefined;
}

export function hasAuthoredFootnote(chart: LintChart): boolean {
  const footnotes = chartOptions(chart).footnotes;
  return Array.isArray(footnotes) && footnotes.some((note) => typeof note === 'string' && note.trim() !== '');
}

export function warning(
  chart: ScopedLintChart,
  code: LintCode,
  severity: LintWarning['severity'],
  message: string,
  suggest?: string,
  owner?: OwnerRef,
): DocLintWarning {
  return {
    code,
    severity,
    message: `chart '${chart.displayName}': ${message}`,
    ...(suggest ? { suggest } : {}),
    ...(owner ? { owner } : {}),
    ...(chart.path === undefined ? {} : { path: chart.path }),
  };
}

export function numericDataValues(chart: LintChart): number[] {
  const data = asRecord(chart.data);
  const values: number[] = [];
  const addCell = (cell: unknown) => {
    const value = cellNumber(cell);
    if (value !== null) values.push(value);
  };

  const series = seriesOf(chart);
  if (series.length > 0) {
    for (const item of series) cellsOfSeries(item).forEach(addCell);
    return values;
  }

  if (chart.type === 'waterfall') {
    for (const item of records(data.items)) {
      addCell(item.value);
      for (const cell of Array.isArray(item.values) ? item.values : []) addCell(cell);
      for (const segment of records(item.segments)) addCell(segment.value);
    }
  } else if (chart.type === 'scatter') {
    for (const point of records(data.points)) {
      addCell(point.x);
      addCell(point.y);
      if (typeof point.size === 'number' && Number.isFinite(point.size)) values.push(point.size);
    }
  } else if (chart.type === 'bullet') {
    for (const row of records(data.rows)) {
      addCell(row.value);
      addCell(row.target);
      if (Array.isArray(row.bands)) row.bands.forEach(addCell);
    }
  } else if (chart.type === 'kpi') {
    addCell(data.value);
    const delta = asRecord(data.delta);
    addCell(delta.vs);
    const spark = asRecord(data.spark);
    if (Array.isArray(spark.values)) spark.values.forEach(addCell);
  } else if (chart.type === 'table') {
    for (const row of flattenRows(records(data.rows))) {
      const cells = asRecord(row.cells);
      for (const cell of Object.values(cells)) {
        addCell(isRecord(cell) && 'v' in cell ? cell.v : cell);
      }
    }
  }
  return values;
}

export function formatValuePairs(chart: LintChart): { format: string; value: number }[] {
  const data = asRecord(chart.data);
  const options = chartOptions(chart);
  const optionFormat = typeof options.format === 'string' ? options.format : undefined;
  const pairs: { format: string; value: number }[] = [];
  const add = (cell: unknown, fallback?: string) => {
    const value = cellNumber(cell);
    const format = cellFormat(cell) ?? fallback;
    if (value !== null && format) pairs.push({ format, value });
  };

  const series = seriesOf(chart);
  if (series.length > 0) {
    for (const item of series) {
      const format = typeof item.format === 'string' ? item.format : optionFormat;
      for (const cell of cellsOfSeries(item)) add(cell, format);
    }
    return pairs;
  }

  if (chart.type === 'waterfall') {
    for (const item of records(data.items)) {
      add(item.value, optionFormat);
      for (const cell of Array.isArray(item.values) ? item.values : []) add(cell, optionFormat);
      for (const segment of records(item.segments)) add(segment.value, optionFormat);
    }
  } else if (chart.type === 'scatter') {
    for (const point of records(data.points)) {
      add(point.x, optionFormat);
      add(point.y, optionFormat);
      if (typeof point.size === 'number' && optionFormat) pairs.push({ format: optionFormat, value: point.size });
    }
  } else if (chart.type === 'bullet') {
    for (const row of records(data.rows)) {
      add(row.value, optionFormat);
      add(row.target, optionFormat);
      if (Array.isArray(row.bands)) row.bands.forEach((band) => add(band, optionFormat));
    }
  } else if (chart.type === 'kpi') {
    const format = typeof data.format === 'string' ? data.format : optionFormat;
    add(data.value, format);
    add(asRecord(data.delta).vs, format);
    const spark = asRecord(data.spark);
    if (Array.isArray(spark.values)) spark.values.forEach((value) => add(value, format));
  } else if (chart.type === 'table') {
    const rows = flattenRows(records(data.rows));
    for (const column of records(data.columns)) {
      if (column.kind !== 'value' && column.kind !== 'computed') continue;
      const format = typeof column.format === 'string' ? column.format : optionFormat;
      if (!format || typeof column.id !== 'string') continue;
      for (const row of rows) {
        const cell = asRecord(row.cells)[column.id];
        add(isRecord(cell) && 'v' in cell ? cell.v : cell, format);
      }
    }
  }
  return pairs;
}

/**
 * A title in the 'Measure, unit' form an axis title and the bubble size key
 * take ('Revenue, €m') names its unit after its last comma.
 */
function titleNamesUnit(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const comma = text.lastIndexOf(', ');
  return comma > 0 && text.slice(comma + 2).trim() !== '';
}

export function hasFormatOrUnit(chart: LintChart): boolean {
  const data = asRecord(chart.data);
  const options = chartOptions(chart);
  if (nonEmptyString(options.format) || nonEmptyString(options.unit)) return true;
  if (Object.values(asRecord(options.axisTitles)).some(titleNamesUnit) || titleNamesUnit(asRecord(options.sizeLegend).label)) return true;

  for (const series of seriesOf(chart)) {
    if (nonEmptyString(series.format) || nonEmptyString(series.unit)) return true;
    if (cellsOfSeries(series).some((cell) => nonEmptyString(cellFormat(cell)))) return true;
  }

  if (chart.type === 'waterfall') {
    for (const item of records(data.items)) {
      if (nonEmptyString(cellFormat(item.value))) return true;
      if ((Array.isArray(item.values) ? item.values : []).some((cell) => nonEmptyString(cellFormat(cell)))) return true;
      if (records(item.segments).some((segment) => nonEmptyString(cellFormat(segment.value)))) return true;
    }
  } else if (chart.type === 'scatter') {
    for (const point of records(data.points)) {
      if (nonEmptyString(cellFormat(point.x)) || nonEmptyString(cellFormat(point.y))) return true;
    }
  } else if (chart.type === 'bullet') {
    for (const row of records(data.rows)) {
      if (nonEmptyString(cellFormat(row.value)) || nonEmptyString(cellFormat(row.target))) return true;
    }
  } else if (chart.type === 'kpi') {
    if (nonEmptyString(data.format)) return true;
  } else if (chart.type === 'table') {
    if (
      records(data.columns).some(
        (column) =>
          (column.kind === 'value' || column.kind === 'computed') && nonEmptyString(column.format),
      )
    ) {
      return true;
    }
    // A row may name the unit instead of a column: in a KPI-rows board the
    // columns are months and the rows are revenue in $M, orders as a count
    // and CAC in $. Reading the columns alone told those authors to declare
    // a unit they had already declared on every row.
    const rowNamesFormat = (row: LintRecord): boolean =>
      nonEmptyString(row.format) || records(row.children).some(rowNamesFormat);
    if (records(data.rows).some(rowNamesFormat)) return true;
  }
  return false;
}

export function scenarioCodes(chart: LintChart): Set<'FC' | 'PL'> {
  const data = asRecord(chart.data);
  const result = new Set<'FC' | 'PL'>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const canonical = value.toUpperCase() === 'FCST' ? 'FC' : value.toUpperCase() === 'BUD' ? 'PL' : value.toUpperCase();
    if (canonical === 'FC' || canonical === 'PL') result.add(canonical);
  };
  const addCell = (cell: unknown) => {
    if (cellValue(cell as Cell) !== null && isRecord(cell)) add(cell.scenario);
  };

  for (const series of seriesOf(chart)) {
    const cells = cellsOfSeries(series);
    if (!cells.some(cell => cellValue(cell as Cell) !== null)) continue;
    add(series.scenario);
    cells.forEach(addCell);
  }
  if (chart.type === 'waterfall') {
    for (const item of records(data.items)) {
      add(item.scenario);
      addCell(item.value);
      for (const cell of Array.isArray(item.values) ? item.values : []) addCell(cell);
      for (const segment of records(item.segments)) {
        add(segment.scenario);
        addCell(segment.value);
      }
    }
  } else if (chart.type === 'scatter') {
    for (const point of records(data.points)) add(point.scenario);
  } else if (chart.type === 'bullet') {
    for (const row of records(data.rows)) {
      addCell(row.value);
      addCell(row.target);
    }
  } else if (chart.type === 'kpi') {
    add(asRecord(data.delta).scenario);
  } else if (chart.type === 'table') {
    for (const column of records(data.columns)) add(column.scenario);
  }
  return result;
}

function flattenRows(rows: LintRecord[]): LintRecord[] {
  const flattened: LintRecord[] = [];
  for (const row of rows) {
    flattened.push(row);
    pushAll(flattened, flattenRows(records(row.children)));
  }
  return flattened;
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}
