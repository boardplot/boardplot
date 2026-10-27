/**
 * Rows as data: a flat table becomes a bare chart's data through its column
 * mapping. The adapter's refusals (a duplicate category and series pair, a
 * text value, a state beside a value) come back with their row, and its
 * suppression states travel in the result. No file access and no chart
 * registry: the CLI reads rows files and calls this, and the browser reaches
 * it through `boardplot/rows`.
 */
import { receivedDescription } from './diagnostics/describe';
import { isBareChart } from './doc/bareChart';
import { NormalizeError } from './normalize/shared';
import { adaptNamedColumns, type NamedColumnContract, type NamedColumnStateEntry, WRITTEN_NUMBER } from './schema/namedColumns';
import { assertSpecObject, InputError } from './inputError';
import { geoRegionIdIndex, resolveGeoRegionId, claimedRegionIds } from './geo/resolveRegionId';
import { getGeoPack } from './geo/packs/registry';
import type { GeoPackId } from './geo/types';
import type { TilePack, TilePackId } from './geo/tiles/types';
import { closestKey } from './schema/unknownKeyWords';
import { cellValue, isNumberCell, isPctCell, type Cell } from './types/cell';
import { CHART_TYPE_OF, ROWS_SHAPES, type RowsShape } from './rowsTypes';

const VALUE_KINDS = ['number', 'percent', 'fraction'] as const;
const CATEGORY_ROLES = ['category', 'series', 'value', 'categoryLabel', 'seriesLabel', 'unit', 'date', 'state'] as const;
const COLUMN_ROLES = [...CATEGORY_ROLES, 'label', 'type', 'x', 'y', 'size', 'group', 'source', 'target', 'sourceStage', 'targetStage'] as const;
type ColumnRole = (typeof COLUMN_ROLES)[number];
type RowContract = Partial<Record<ColumnRole, string>>;

/** Where the rows come from: the argument a refusal points at, and the read that yields them. */
export interface RowsSource {
  argument: '/rows' | '/rowsFile';
  /** A semicolon CSV sets decimalComma, so 0,505 reads as 0.505. */
  load(): { rows: unknown; decimalComma?: boolean };
  /**
   * The tile packs a tilemap's regions are checked against. Without it the
   * chart checks them when it draws, so a browser bundle carries no tile
   * geometry for rows alone.
   */
  tilePack?: (id: TilePackId) => TilePack;
}

export type RowsPathMap = Map<string, { path: string; displayPath: string }>;

export interface AdaptedRows {
  spec: Record<string, unknown>;
  /** Generated data path -> the row field it came from, for {@link rewriteRowsDiagnostics}. */
  pathMap: RowsPathMap;
  rows: number;
  ignoredColumns: string[];
  states: NamedColumnStateEntry[];
}

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readColumns(columns: unknown, shape: RowsShape): { contract: RowContract; valueKind: (typeof VALUE_KINDS)[number] } {
  const required: ColumnRole[] = shape === 'waterfall' ? ['label', 'value'] : shape === 'scatter' ? ['x', 'y']
    : shape === 'flow' ? ['source', 'target', 'value'] : shape === 'map' ? ['category', 'value'] : ['category', 'series', 'value'];
  const roles: readonly ColumnRole[] = shape === 'waterfall' ? ['label', 'value', 'type'] : shape === 'scatter' ? ['x', 'y', 'size', 'label', 'group']
    : shape === 'flow' ? ['source', 'target', 'value', 'sourceStage', 'targetStage']
    : shape === 'map' ? ['category', 'value', 'state'] : CATEGORY_ROLES;
  if (!isRecord(columns)) {
    throw new InputError('invalid-argument', `rows need columns: { ${required.join(', ')} } naming the source columns`, {
      path: '/columns', expected: { types: ['object'] }, suggest: `Pass columns with ${required.join(', ')} naming the source columns.`,
    });
  }
  const { valueKind = 'number', ...contract } = columns;
  if (!(VALUE_KINDS as readonly unknown[]).includes(valueKind)) {
    throw new InputError('invalid-argument', `valueKind must be one of ${VALUE_KINDS.join(', ')}`, {
      path: '/columns/valueKind', expected: { values: [...VALUE_KINDS] },
      suggest: 'fraction when a share of one half arrives as 0.5, percent when it arrives as 50, number otherwise.',
    });
  }
  // A flow is a width, not a share: a fraction or percent cell would reach the schema as { pct } and be refused there.
  if (shape === 'flow' && valueKind !== 'number') {
    throw new InputError('invalid-argument', 'sankey flows are plain numbers; valueKind must be number', {
      path: '/columns/valueKind', expected: { values: ['number'] }, fix: [{ op: 'remove', path: '/columns/valueKind' }],
      suggest: 'Remove valueKind. To show shares, keep the counts as values and set options.nodeValue to share.',
    });
  }
  const unknown = Object.keys(contract).find((key) => !(roles as readonly string[]).includes(key));
  if (unknown !== undefined) {
    throw new InputError('invalid-argument', `columns has no role '${unknown}'`, {
      path: `/columns/${unknown}`, expected: { values: [...roles, 'valueKind'] }, fix: [{ op: 'remove', path: `/columns/${unknown}` }],
    });
  }
  const missing = [...required, ...Object.keys(contract)].find((role) => typeof contract[role] !== 'string' || !(contract[role] as string).trim());
  if (missing !== undefined) {
    throw new InputError('invalid-argument', `columns.${missing} must name the source column that holds the ${missing}`, {
      path: `/columns/${missing}`, expected: { types: ['string'] },
    });
  }
  return { contract: contract as RowContract, valueKind: valueKind as (typeof VALUE_KINDS)[number] };
}

/**
 * A value column in the declared kind: a share 0.505 becomes the percent cell
 * 50.5. In a semicolon CSV a decimal comma reads as a decimal, 0,505 as
 * 0.505; a number with grouping marks such as 1.234,5 stays text and is
 * refused with its row rather than guessed. So is 1.234 there, which is
 * either 1234 with a German thousands dot or 1.234 with a decimal point;
 * 0.505 cannot be a thousands group and reads as a decimal.
 */
function valueCell(value: unknown, kind: (typeof VALUE_KINDS)[number], decimalComma: boolean, path: string): unknown {
  if (decimalComma && typeof value === 'string' && /^\s*-?[1-9]\d{0,2}\.\d{3}\s*$/.test(value)) {
    throw new InputError('invalid-value', `${path}: '${value.trim()}' in a semicolon CSV is either ${value.trim().replace(/\./g, '')} with a thousands dot or ${value.trim()} with a decimal point`, {
      path: '/rowsFile', received: receivedDescription(value),
      suggest: 'Write the number without the thousands dot, or with a decimal comma.',
    });
  }
  if (decimalComma && typeof value === 'string' && /^\s*-?\d+,\d+\s*$/.test(value)) value = value.replace(',', '.');
  if (typeof value === 'string' && /^\s*-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/.test(value)) value = Number(value);
  else if (value === '') value = null;
  if (typeof value !== 'number' || kind === 'number') return value;
  return { pct: kind === 'fraction' ? Number((value * 100).toPrecision(15)) : value };
}

/**
 * How to write a formatted value cell so it reads as meant: the decimal mark
 * this file reads, and for a percent sign the number valueKind expects.
 */
function plainNumberAdvice(cell: string, kind: (typeof VALUE_KINDS)[number], decimalComma: boolean): string {
  const advice = `Write the number alone, without grouping marks or a currency sign, with ${decimalComma ? 'a decimal comma, as in 1234,5' : 'a dot as the decimal mark, as in 1234.5'}.`;
  if (!cell.includes('%')) return advice;
  if (kind === 'fraction') return `${advice} valueKind is fraction, so 12% is written ${decimalComma ? '0,12' : '0.12'}; or set valueKind to percent and write 12.`;
  return `${advice} Drop the percent sign${kind === 'number' ? ' and set valueKind to percent' : ''}; valueKind percent reads 12 as 12%.`;
}

/** An adapter path, rows[3].revenue or contract.<column>, as a pointer into the arguments. */
function argumentPath(path: string, rowsArgument: '/rows' | '/rowsFile', contract: RowContract): string {
  const row = /^rows\[(\d+)\](?:\.(.*))?$/.exec(path);
  if (row) return rowsArgument === '/rows' ? `/rows/${row[1]}${row[2] ? `/${row[2].replace(/~/g, '~0').replace(/\//g, '~1')}` : ''}` : '/rowsFile';
  const named = /^contract\.(.+)$/.exec(path)?.[1];
  if (named === undefined) return path === 'contract' ? '/columns' : rowsArgument;
  // The adapter names a missing column by its name; the argument holds it under its role.
  const role = Object.hasOwn(contract, named) ? named : Object.keys(contract).find((key) => contract[key as ColumnRole] === named);
  return role === undefined ? '/columns' : `/columns/${role}`;
}

function byId(list: unknown): Map<string, Row> {
  const entries = Array.isArray(list) ? list : [];
  return new Map(entries.flatMap((entry) => (typeof entry === 'string'
    ? [[entry, { id: entry }] as [string, Row]]
    : isRecord(entry) && typeof entry.id === 'string' ? [[entry.id, entry] as [string, Row]] : [])));
}

/** One source row per item, point or link. Chart schemas validate the mapped fields. */
function adaptItemRows(
  shape: 'waterfall' | 'scatter' | 'flow', rows: Row[], contract: RowContract, data: Row,
  valueKind: (typeof VALUE_KINDS)[number], decimalComma: boolean, rowsArgument: '/rows' | '/rowsFile',
): { data: Row; pathMap: RowsPathMap; ignoredColumns: string[] } {
  if (!rows.length) throw new InputError('rows-empty', 'rows contain no data row', { path: rowsArgument });
  const columns = Object.values(contract);
  const duplicate = columns.find((column, index) => columns.indexOf(column) !== index);
  if (duplicate) throw new InputError('invalid-contract', `column '${duplicate}' is named for more than one role`, { path: '/columns' });
  const present = new Set(rows.flatMap(row => Object.keys(row)));
  for (const [role, column] of Object.entries(contract)) {
    if (!present.has(column)) throw new InputError('missing-column', `'${column}' is named in columns but no row provides it`, {
      path: `/columns/${role}`, suggest: `Columns present: ${[...present].sort().join(', ')}.`,
    });
  }
  const pathMap: RowsPathMap = new Map();
  const field = shape === 'waterfall' ? 'items' : shape === 'flow' ? 'links' : 'points';
  const groups = new Map<string, Row>();
  const templates = byId(data.groups);
  const entries = rows.map((row, index) => {
    // A link has no id: its source and target name it.
    const entry: Row = shape === 'flow' ? {} : { id: `row-${index + 1}` };
    for (const [role, column] of Object.entries(contract)) {
      const path = argumentPath(`rows[${index}].${column}`, rowsArgument, contract);
      const source = { path, displayPath: `${rowsArgument.slice(1)} row ${index + 1}.${column}` };
      pathMap.set(`/data/${field}/${index}/${role}`, source);
      const raw = row[column];
      if ((role === 'type' || role === 'group' || role === 'size') && (raw === undefined || raw === null || raw === '')) continue;
      if (role === 'label' && shape === 'scatter' && (raw === undefined || raw === null)) continue;
      if (['value', 'x', 'y', 'size'].includes(role)) {
        const kind = role === 'size' ? 'number' : valueKind;
        const value = valueCell(raw, kind, decimalComma, `rows[${index}].${column}`);
        if (typeof value === 'string') throw new InputError('invalid-value', `${source.displayPath}: '${value}' is not a numeric cell`, {
          ...source, received: receivedDescription(raw),
          ...(WRITTEN_NUMBER.test(value) ? { suggest: plainNumberAdvice(value, kind, decimalComma) } : {}),
        });
        entry[role] = value;
      } else if (shape === 'flow' && typeof raw === 'number') {
        // SQL keys are often integers; a node or stage id is text.
        entry[role] = String(raw);
      } else {
        if (role === 'label' && shape === 'waterfall' && (typeof raw !== 'string' || !raw)) {
          throw new InputError('invalid-identity', `${source.displayPath}: item label must be a non-empty string`, source);
        }
        entry[role] = raw;
      }
      if (role === 'group' && typeof raw === 'string' && raw && !groups.has(raw)) {
        pathMap.set(`/data/groups/${groups.size}/id`, source);
        groups.set(raw, { ...templates.get(raw), id: raw });
      }
    }
    return entry;
  });
  return {
    data: { ...data, [field]: entries, ...(shape === 'scatter' && contract.group ? { groups: [...groups.values()] } : {}) },
    pathMap, ignoredColumns: [...present].filter(column => !columns.includes(column)).sort(),
  };
}

/**
 * The spec with its data taken from the rows. A category or series the spec
 * already names keeps its other fields (label, colorRole, unit, format), so a
 * spec works as a template the rows refill; a column the map names wins.
 * The spec, its type and the columns are checked before `source.load` runs,
 * so a refused spec never reads its rows file.
 */
export function adaptRows(spec: unknown, columns: unknown, source: RowsSource): AdaptedRows {
  assertSpecObject(spec);
  if (!isRecord(spec) || !isBareChart(spec)) {
    throw new InputError('rows-need-one-chart', 'rows fill the data of one chart; send a bare chart spec, not an envelope', {
      path: '/spec', suggest: 'Render each chart of the envelope in its own call with its rows.',
    });
  }
  const type = typeof spec.type === 'string' ? CHART_TYPE_OF.get(spec.type) : undefined;
  const map = type === 'choropleth' || type === 'tilemap';
  if (type !== undefined && !ROWS_SHAPES.has(type)) {
    throw new InputError('rows-unsupported-type', `'${spec.type}' has no rows mapping`, {
      path: '/spec/type', expected: { values: [...ROWS_SHAPES.keys()].sort() },
      suggest: `Write the ${spec.type} data in the spec, or draw the rows with one of the listed types.`,
    });
  }
  const shape = type === 'waterfall' || type === 'scatter' ? type : type === 'sankey' ? 'flow' : map ? 'map' : 'category';
  const { contract: rowContract, valueKind } = readColumns(columns, shape);
  const rowsArgument = source.argument;
  const loaded = source.load();
  if (!Array.isArray(loaded.rows) || !loaded.rows.every(isRecord)) {
    throw new InputError('invalid-rows', 'rows must be an array of objects', { path: rowsArgument });
  }
  const decimalComma = loaded.decimalComma === true;
  if (shape === 'waterfall' || shape === 'scatter' || shape === 'flow') {
    const adapted = adaptItemRows(shape, loaded.rows, rowContract, isRecord(spec.data) ? spec.data : {}, valueKind, decimalComma, rowsArgument);
    return { spec: { ...spec, data: adapted.data }, pathMap: adapted.pathMap, rows: loaded.rows.length, ignoredColumns: adapted.ignoredColumns, states: [] };
  }
  const contract = rowContract as NamedColumnContract;
  // A row without the value column stays without it, so the adapter names the column as missing.
  const rows = loaded.rows.map((row, index) => (Object.hasOwn(row, contract.value)
    ? { ...row, [contract.value]: valueCell(row[contract.value], valueKind, decimalComma, `rows[${index}].${contract.value}`) }
    : row));
  // Reuse the existing single-series adapter, including value, duplicate and state checks.
  // Pick a private column name that cannot replace a source column.
  let mapSeriesColumn = '__map_measure';
  while (rows.some((row) => Object.hasOwn(row, mapSeriesColumn)) || Object.values(contract).includes(mapSeriesColumn)) mapSeriesColumn += '_';
  const adaptedContract = map ? { ...contract, series: mapSeriesColumn } : contract;
  const adaptedRows = map ? rows.map((row) => ({ ...row, [mapSeriesColumn]: 'value' })) : rows;
  let adapted: ReturnType<typeof adaptNamedColumns>;
  try {
    adapted = adaptNamedColumns({ contract: adaptedContract, rows: adaptedRows });
  } catch (error) {
    if (!(error instanceof NormalizeError)) throw error;
    // A refused cell is echoed as the source wrote it, before valueCell read it.
    const [, row, column] = /^rows\[(\d+)\]\.(.+)$/.exec(error.path) ?? [];
    const source = row === undefined ? undefined : loaded.rows[Number(row)];
    const cell = source && Object.hasOwn(source, column!) ? source[column!] : undefined;
    const suggest = column === contract.value && typeof cell === 'string' && WRITTEN_NUMBER.test(cell)
      ? plainNumberAdvice(cell, valueKind, decimalComma) : error.suggest;
    throw new InputError(error.code, `${error.path ? `${error.path}: ` : ''}${error.message}`, {
      path: argumentPath(map ? error.path.replace(`.${mapSeriesColumn}`, `.${contract.category}`) : error.path, rowsArgument, contract), ...(suggest ? { suggest } : {}),
      ...(source && Object.hasOwn(source, column!) ? { received: receivedDescription(cell) } : {}),
    });
  }
  const data = isRecord(spec.data) ? spec.data : {};
  if (map) adapted.data.series[0]?.values.forEach((cell, index) => {
    if (cell !== null && typeof cell === 'object' && 'date' in cell) {
      throw new InputError('invalid-value', `rows[${index}].${contract.value}: a map needs a number or null, not a date`, {
        path: argumentPath(`rows[${index}].${contract.value}`, rowsArgument, contract),
      });
    }
  });
  const bartable = type === 'bartable';
  const pathMap: RowsPathMap = new Map();
  const sourceField = (generated: string, row: number, column: string | undefined) => {
    if (!column || pathMap.has(generated)) return;
    pathMap.set(generated, {
      path: argumentPath(`rows[${row}].${column}`, rowsArgument, contract),
      displayPath: `${rowsArgument.slice(1)} row ${row + 1}.${column}`,
    });
  };
  if (!map) {
    const categoryIndices = new Map(adapted.data.categories.map((entry, i) => [entry.id, i]));
    const seriesIndices = new Map(adapted.data.series.map((entry, i) => [entry.id, i]));
    rows.forEach((row, i) => {
      const category = categoryIndices.get(String(row[contract.category]))!;
      const series = seriesIndices.get(String(row[contract.series]))!;
      // A bar table keys its one panel's values by segment id (bartablePanel).
      const cell = bartable
        ? `/data/panels/0/values/${adapted.data.series[series]!.id.replace(/~/g, '~0').replace(/\//g, '~1')}/${category}`
        : `/data/series/${series}/values/${category}`;
      sourceField(cell, i, contract.value);
      sourceField(`${cell}/state`, i, contract.state ?? contract.value);
      sourceField(`/data/categories/${category}/id`, i, contract.category);
      sourceField(`/data/categories/${category}/label`, i, contract.categoryLabel);
      sourceField(`/data/categories/${category}/date`, i, contract.date);
      sourceField(`/data/series/${series}/id`, i, contract.series);
      sourceField(`/data/series/${series}/label`, i, contract.seriesLabel);
      sourceField(`/data/series/${series}/unit`, i, contract.unit);
    });
  }
  if (map) {
    // Leave an unknown pack to schema validation, which names the authored pack field.
    let pack;
    try { pack = spec.type === 'tilemap' ? source.tilePack?.(data.pack as TilePackId) : getGeoPack(data.pack as GeoPackId); }
    catch { /* The normal chart boundary reports invalid packs. */ }
    if (pack) {
      const index = geoRegionIdIndex(pack.regions);
      const claimed = new Set<string>();
      adapted.data.categories.forEach((category, generated) => {
        const source = rows.findIndex(row => String(row[contract.category]) === category.id);
        const sourcePath = argumentPath(`rows[${source}].${contract.category}`, rowsArgument, contract);
        const displayPath = `${rowsArgument.slice(1)} row ${source + 1}.${contract.category}`;
        pathMap.set(`/data/regions/${generated}/id`, { path: sourcePath, displayPath });
        pathMap.set(`/data/regions/${generated}/value`, { path: argumentPath(`rows[${source}].${contract.value}`, rowsArgument, contract), displayPath: `${rowsArgument.slice(1)} row ${source + 1}.${contract.value}` });
        const resolution = resolveGeoRegionId(index, category.id);
        const ids = claimedRegionIds(resolution);
        if (ids.some(id => claimed.has(id))) throw new InputError('duplicate-id', `${displayPath}: region '${category.id}' repeats a pack member`, { path: sourcePath, displayPath, suggest: 'Keep one source row per pack member, using its canonical id.' });
        ids.forEach(id => claimed.add(id));
        if (resolution.kind === 'unknown') {
          const nearest = closestKey(category.id, [...index.canonical.keys()]);
          const hint = nearest?.near ? `; did you mean '${index.canonical.get(nearest.key)}'?` : '';
          throw new InputError(`${spec.type}-unknown-region`, `${displayPath}: region '${category.id}' is not in pack '${data.pack}'${hint}`, { path: sourcePath, displayPath, suggest: 'Use a canonical region id or an unambiguous pack alias.' });
        }
      });
    }
  }
  const categories = byId(data.categories);
  const series = byId(data.series);
  const named = (key: keyof NamedColumnContract) => contract[key] !== undefined;
  const labelled = new Set(contract.categoryLabel === undefined ? [] : rows
    .filter((row) => ![undefined, null, ''].includes(row[contract.categoryLabel!] as never)).map((row) => String(row[contract.category])));
  return {
    spec: {
      ...spec,
      data: {
        // The rows replace every per-row list of a bar table template: its number columns (bartablePanel).
        ...(bartable ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'columns')) : data),
        ...(map ? { regions: adapted.data.categories.map((category, index) => {
          const state = adapted.states.find(entry => entry.categoryId === category.id)?.state;
          return { id: category.id, value: cellValue(adapted.data.series[0]!.values[index]!), ...(state ? { state } : {}) };
        }) } : {
        categories: adapted.data.categories.map(({ label, ...category }) => {
          // The adapter fills a missing label with the id; written out, it would stop a date id from printing as a short date.
          const authored = labelled.has(category.id) ? { label } : {};
          const template = categories.get(category.id);
          if (!template) return { ...category, ...authored };
          return { ...template, id: category.id, ...authored, ...(named('date') && category.date !== undefined ? { date: category.date } : {}) };
        }),
        ...(bartable ? bartablePanel(data, adapted.data.series, series, contract.value, (generated) => pathMap.get(generated)) : {
          series: adapted.data.series.map((entry) => ({ ...series.get(entry.id), ...entry })),
        }),
        }),
      },
    },
    pathMap,
    rows: rows.length,
    ignoredColumns: adapted.ignoredColumns,
    states: adapted.states,
  };
}

/**
 * A bar table from rows: the categories are its rows, the series its
 * segments, and the value column fills one stacked-bar panel, keyed by
 * segment id. The spec's first panel is the template (id, label, unit,
 * weight, format, aggregate); its per-row `ends`, its other panels and the
 * number `columns` cannot follow refilled rows and are dropped. The panel
 * takes the series' one unit, else the template's, else '%' for percent
 * cells, which a bar table reads as plain numbers. One panel adds its
 * segments, so two units, or percent cells beside number cells, are refused
 * at their row, and so is a cell that carries more than its number.
 */
function bartablePanel(
  data: Row, adapted: { id: string; label?: string; unit?: string; values: readonly Cell[] }[], templates: Map<string, Row>,
  valueColumn: string, sourceOf: (generated: string) => { path: string; displayPath: string } | undefined,
): Row {
  const [template] = Array.isArray(data.panels) ? data.panels.filter(isRecord) : [];
  const { values: _values, ends: _ends, ...panel } = template ?? {};
  const cellPath = (segment: string, row: number) => `/data/panels/0/values/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}/${row}`;
  const refuse = (generated: string, message: string, suggest: string): never => {
    const source = sourceOf(generated);
    throw new InputError('invalid-value', `${source ? `${source.displayPath}: ` : ''}${message}`, { ...(source ?? { path: '/rows' }), suggest });
  };
  const unitAt = adapted.findIndex((entry) => entry.unit !== undefined);
  const otherUnit = adapted.findIndex((entry) => entry.unit !== undefined && entry.unit !== adapted[unitAt]!.unit);
  if (otherUnit >= 0) {
    refuse(`/data/series/${otherUnit}/unit`,
      `unit '${adapted[otherUnit]!.unit}' beside '${adapted[unitAt]!.unit}': a bar table stacks every segment in one panel with one unit, so it would add values in different units`,
      'Convert the values to one unit, or draw one bar table per unit.');
  }
  let firstKind: 'pct' | 'number' | undefined;
  adapted.forEach((entry) => entry.values.forEach((cell, row) => {
    if (cell === null || typeof cell !== 'object') return;
    const extra = Object.keys(cell).filter((key) => key !== 'number' && key !== 'pct');
    if (extra.length > 0) {
      refuse(cellPath(entry.id, row), `a bar table cell holds a plain number; '${extra.join("', '")}' has no place in its panel and would be lost`,
        'Send the value alone, and set the format on the spec\'s panel.');
    }
    const kind = isPctCell(cell) ? 'pct' : 'number';
    firstKind ??= kind;
    if (kind !== firstKind) {
      refuse(cellPath(entry.id, row), 'percent and number values in one bar table: its one panel would add shares to amounts under one unit',
        'Send every value as a number or every value as a percent.');
    }
  }));
  const unit = unitAt >= 0 ? adapted[unitAt]!.unit : panel.unit ?? (firstKind === 'pct' ? '%' : undefined);
  return {
    series: adapted.map(({ values: _cells, unit: _unit, ...entry }) => ({ ...templates.get(entry.id), ...entry })),
    panels: [{
      id: valueColumn, ...panel, ...(unit !== undefined ? { unit } : {}),
      values: Object.fromEntries(adapted.map((entry) => [entry.id, entry.values.map((cell) => (isPctCell(cell) || isNumberCell(cell) ? cellValue(cell) : cell))])),
    }],
  };
}

/** Return diagnostics at the rows the caller authored, after bare-spec path conversion. */
export function rewriteRowsDiagnostics<T extends { path?: string; displayPath?: string; fix?: { path: string }[] }>(findings: T[], pathMap?: RowsPathMap): T[] {
  const sourceFor = (path: string | undefined) => {
    for (let prefix = path; prefix; prefix = prefix.slice(0, prefix.lastIndexOf('/'))) {
      const source = pathMap?.get(prefix);
      if (source) return source;
    }
    return undefined;
  };
  return findings.map(finding => {
    const source = sourceFor(finding.path);
    const fix = finding.fix?.map(operation => ({ ...operation, path: sourceFor(operation.path)?.path ?? operation.path }));
    return { ...finding, ...(source || {}), ...(fix ? { fix } : {}) };
  });
}
