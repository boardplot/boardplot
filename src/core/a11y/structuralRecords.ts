import { chartString } from '../strings/a11y-structuralRecords';
import type { DimSwitchDerived } from '../charts/dimswitch/types';
import type { GridDerived } from '../charts/grid/layout';
import type { MetricStackData } from '../charts/grid/metricStack';
import { wholeCurrencyValue } from '../format';
import { calcPreservesScale } from '../tableCalc';
import type { BarTableData, BarTableDerived, BarTableMarks, BarTableOptions } from '../charts/bartable/types';
import type { GanttMarks } from '../charts/gantt/layout';
import type { GridMarks } from '../charts/grid/layout';
import { normalizeGridData } from '../charts/grid/normalize';
import type { StatusData, StatusMarks, StatusOptions } from '../charts/status/layout';
import type { Rect } from '../geometry';
import type { OwnerRef } from '../types/cell';
import type { GanttData, GanttItem } from '../types/data';
import type { DiagramData, DiagramMarks } from '../types/diagram';
import type { ResolvedCell, ResolvedColumn, TableData, TableDerived, TableRow, TableOptions } from '../types/table';
import { resolveChartRequest, type RequestOptions } from '../request';
import { derivedValue, makeRecord, numericValue, targetId, textValue, type RecordContext } from './recordsShared';
import { DERIVED_PERCENT_FORMAT } from './valueText';
import { parseFormatExample, specUnitKind, unitOfSpec } from '../formatSpec';
import { unscaledUnit } from './valueText';
import type { InteractionRecord, InteractionScope, InteractionValue } from './types';

/**
 * The value a table cell's record carries. A row's own format beats the
 * column's where the renderer's does (specFor in table/resolve.ts): on a
 * calc row, and on a data row under a column with no authored format. A
 * MoM line under a money column prints "−8.3%", so its record is a
 * percentage, not euros; a $1.2m row under an authored '+1.1%' column
 * prints the percent, and so does its record. A cell a row calc or a
 * computed column produced is derived, so the accessible table prints it at
 * display precision instead of every binary digit ("7,433.77", not
 * "7,433.76623376623").
 */
function tableValue(options: RecordContext['request']['options'], cell: ResolvedCell, column: ResolvedColumn, row: { format?: string; calc?: unknown; rollUp?: boolean } = {}, columnFormatAuthored = false): InteractionValue {
  const kind = cell.kind === 'date' ? 'date' :
    cell.kind === 'value' || cell.kind === 'computed' ? 'number' : 'text';
  const rowFormat = row.calc !== undefined || !columnFormatAuthored ? row.format : undefined;
  const own = cell.format ?? rowFormat;
  const format = own ?? column.format;
  const unit = column.unitLabel && own === undefined ? column.unitLabel : undefined;
  const computed = cell.kind === 'computed' || (kind === 'number' && (row.calc !== undefined || row.rollUp === true));
  // A computed percentage (a share, a change in %) is a derived percentage:
  // the accessible table reads it as the hover card reads a share ("6.12%").
  const derivedPct = computed &&
    (unit === '%' || (format !== undefined && unit === undefined && specUnitKind(parseFormatExample(format)) === 'percent'));
  return {
    // An open period has no value yet: unavailable, and it says why.
    kind, raw: cell.state === 'value' ? cell.raw : null, state: cell.state === 'open' ? 'unavailable' : cell.state,
    displayed: cell.displayed,
    // A cell that names its own format reads through it ("2.7 pp", not
    // "2.7 %"), and the unit the column hoists is not its unit.
    ...(derivedPct ? { format: DERIVED_PERCENT_FORMAT, unit: '%', derived: 'percent' as const } : {
      ...(format ? { format } : {}),
      ...(unit ? { unit } : {}),
      // The head's "M" or "$k" scales the printed figure; the raw value is in units. Resolve says whether
      // it does: a literal suffix ('1,234 EURk') prints the raw figure, so its unit stays whole.
      ...(unit && column.unitScaled && unscaledUnit(unit) !== unit ? { scaledUnit: true as const } : {}),
      ...(computed ? { derived: 'number' as const } : {}),
    }),
    ...(cell.state !== 'value' ? { reason: cell.state === 'suppressed' ? chartString(options, 'valueWithheld') : cell.state === 'open' ? chartString(options, 'openPeriod') : cell.state } : {}),
  };
}

interface TableRecordCell {
  row: TableDerived['table']['rows'][number];
  column: ResolvedColumn;
  cell: ResolvedCell;
  value: InteractionValue;
}

function suppressedTableCells(data: TableData): Set<string> {
  const withheld = new Set<string>();
  const visit = (row: TableRow): void => {
    for (const [column, cell] of Object.entries(row.cells ?? {})) {
      if (typeof cell === 'object' && cell?.state === 'suppressed') withheld.add(JSON.stringify([row.id, column]));
    }
    row.children?.forEach(visit);
  };
  data.rows.forEach(visit);
  return withheld;
}

/** Each authored row's own format, calc and cells, by id, nested rows included. */
function authoredRowSpecs(data: TableData): Map<string, { format?: string; calc?: unknown; cells?: TableRow['cells'] }> {
  const specs = new Map<string, { format?: string; calc?: unknown; cells?: TableRow['cells'] }>();
  const visit = (row: TableRow): void => {
    specs.set(row.id, { ...(row.format === undefined ? {} : { format: row.format }), ...(row.calc === undefined ? {} : { calc: row.calc }), cells: row.cells });
    row.children?.forEach(visit);
  };
  data.rows.forEach(visit);
  return specs;
}

function tableRecordCells(table: TableDerived['table'], data: TableData, options: TableOptions = {}): TableRecordCell[] {
  const withheld = suppressedTableCells(data);
  const rowSpecs = authoredRowSpecs(data);
  const authoredFormat = new Set(data.columns.filter((column) => 'format' in column && column.format !== undefined).map((column) => column.id));
  return table.rows.flatMap(row => table.columns.flatMap(column => {
    const resolved = row.cells[column.id];
    // The resolved cell already prints the theme's glyph; a record
    // keeps it, so records, hover and CSV say what the table shows.
    const cell = resolved && withheld.has(JSON.stringify([row.id, column.id]))
      ? { ...resolved, raw: null, state: 'suppressed' as const, displayed: resolved.state === 'suppressed' ? resolved.displayed : '—*', note: undefined, href: undefined }
      : resolved;
    if (!cell || column.kind === 'rowLabel') return [];
    // A parent's cell it does not author is the sum of its children: derived too.
    const spec = rowSpecs.get(row.id);
    const rollUp = row.hasChildren && spec?.cells?.[column.id] === undefined;
    const value = tableValue(options, cell, column, { ...spec, rollUp }, authoredFormat.has(column.id));
    const sourceColumn = data.columns.find(item => item.id === column.id);
    if (!cell.format && !spec?.format && !authoredFormat.has(column.id) && !options.format
      && typeof value.raw === 'number' && wholeCurrencyValue(value.raw, options.unit, options.target)
      && (sourceColumn?.kind === 'value' || (sourceColumn?.kind === 'computed' && calcPreservesScale(sourceColumn.calc)))
      && (!value.format || specUnitKind(parseFormatExample(value.format)) === 'number')) {
      // Cells that print their own letter ("1.0B" in an 'M' column) take the bare currency.
      const scaleUnit = value.format && !column.magnitudeInCells ? unitOfSpec(parseFormatExample(value.format)) : undefined;
      value.unit = [options.unit, scaleUnit].filter(Boolean).join(' ');
      // The column's generated example is a default, not an authored override.
      value.renderTarget = options.target;
    }
    return [{ row, column, cell, value }];
  }));
}

/** The value band a table cell fell in (`TableCellObject.bands`), as a hover and accessible field. Only a named band says anything. */
function bandFields(options: RecordContext['request']['options'], cell: ResolvedCell): InteractionRecord['fields'] {
  return cell.band?.label === undefined || cell.state !== 'value' ? [] : [{ key: 'band', label: chartString(options, 'band'), value: textValue(cell.band.label) }];
}

/** Typed table records for HTML preparation, without SVG geometry or artifact claims. */
export function preparedTableRecords(
  table: TableDerived['table'], data: TableData, scope: InteractionScope, options: TableOptions = {},
): InteractionRecord[] {
  return tableRecordCells(table, data, options).map(({ row, column, cell, value }) => {
    const owner = { rowId: row.id, colId: column.id };
    const target = { ...scope, owner };
    return {
      id: targetId(target), target, value,
      label: `${row.label} / ${column.label}`,
      ...(cell.scenario ? { scenario: cell.scenario } : {}),
      fields: bandFields(options, cell), comparisons: [], annotations: [], claimIds: [], nodeIds: [],
    };
  });
}

function tableRecords(ctx: RecordContext): InteractionRecord[] {
  const { table } = ctx.geometry.derived as unknown as TableDerived;
  return tableRecordCells(table, ctx.request.data as TableData, ctx.request.options as TableOptions).map(({ row, column, cell, value }) =>
    makeRecord(ctx, { rowId: row.id, colId: column.id }, value, {
      label: `${row.label} / ${column.label}`,
      ...(cell.scenario ? { scenario: cell.scenario } : {}),
      fields: bandFields(ctx.request.options, cell),
      // Withheld cells must not disclose operands or authored notes.
      ...(cell.state === 'suppressed' ? { annotations: [], claimIds: [] } : {}),
    }));
}

function statusRecords(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as StatusData;
  const options = ctx.request.options as StatusOptions;
  const marks = ctx.geometry.marks as unknown as StatusMarks;
  return marks.cells.map(mark => {
    const state = options.states.find(item => item.id === mark.state);
    const row = data.rows.find(item => item.id === mark.row);
    const col = data.columns.find(item => item.id === mark.col);
    return makeRecord(ctx, { seriesId: mark.row, categoryId: mark.col },
      textValue(mark.sourceState ?? (mark.missing ? null : mark.state)), {
        label: `${row?.label ?? mark.row} / ${col?.label ?? mark.col}`,
        fields: state ? [{ key: 'stateLabel', label: chartString(ctx.request.options, 'state'), value: textValue(state.label) }] : [],
        nodeIds: [mark.nodeId], anchor: mark.rect,
      });
  });
}

/** The Total row's category id in bar table records; the table draws that row without one. The bar table schema refuses it as a row id. */
const BARTABLE_TOTAL_ROW = '__total';

/**
 * One record per drawn segment and per printed number (a column cell, a
 * bar's end label, a Total cell), in reading order: row by row, left to
 * right, the Total row last. A record carries the format the table printed
 * with and the printed text; an end or Total that prints an authored range
 * reads as that range, with its low and high ends as fields. On a range bar
 * the segments read as drawn: their parts of the low end.
 */
function bartableRecords(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as BarTableData;
  const marks = ctx.geometry.marks as unknown as BarTableMarks;
  const options = ctx.request.options as BarTableOptions;
  const tracks: { id: string; name: string; unit?: string; format?: string; computed?: true }[] = [
    ...(data.columns ?? []).map(column => ({ id: column.id, name: column.label ?? column.id, format: column.format })),
    ...data.panels.flatMap(panel => [
      { id: panel.id, name: panel.label ?? panel.id, unit: panel.unit, format: panel.format ?? options.format },
      // Under cascade: the computed share column of each panel.
      ...(options.variant === 'cascade' ? [{ id: `share:${panel.id}`, name: `${panel.label ?? panel.id} share`, unit: '%', computed: true as const }] : []),
    ]),
    ...(options.variant === 'cascade' && options.cascade?.growth
      ? [{ id: 'growth', name: options.cascade.growth.label ?? (options.cascade.growth.measure === 'cagr' ? 'CAGR' : 'Share change'), unit: options.cascade.growth.measure === 'cagr' ? '%' : 'pp', computed: true as const }]
      : []),
  ];
  const derived = ctx.geometry.derived as unknown as BarTableDerived;
  // The order the table draws: residual rows pinned last.
  const rows = [...derived.rowOrder.map(id => data.categories.find(row => row.id === id)!).map(row => ({ id: row.id, label: row.label ?? row.id })),
    { id: BARTABLE_TOTAL_ROW, label: options.strings?.total ?? 'Total' }];
  const number = (raw: number | null, text: string, track: typeof tracks[number]): InteractionValue => {
    const value = track.computed ? derivedValue(raw, track.unit, track.format) : numericValue(raw, track.unit, track.format);
    return raw === null ? value : { ...value, displayed: text };
  };
  const perRow = rows.flatMap(row => tracks.flatMap(track => {
    const at = (seriesLabel: string, owner: OwnerRef, value: InteractionValue, anchor: Rect, fields: InteractionRecord['fields'] = []) =>
      makeRecord(ctx, owner, value, { label: `${row.label} / ${seriesLabel}`, categoryLabel: row.label, seriesLabel, anchor, fields });
    const segments = marks.segments.filter(mark => mark.rowId === row.id && mark.panelId === track.id).map(mark => at(
      `${track.name} / ${data.series.find(s => s.id === mark.seriesId)?.label ?? mark.seriesId}`,
      { categoryId: row.id, seriesId: mark.seriesId, colId: track.id }, number(mark.value, mark.text, track), mark.rect));
    const cells = marks.cells.filter(mark => !mark.combined && (mark.rowId ?? BARTABLE_TOTAL_ROW) === row.id && mark.colId === track.id).map(mark => {
      const owner = { categoryId: row.id, colId: track.id };
      if (mark.value === null && mark.kind === 'total') return at(track.name, owner, { ...number(null, mark.text, track), reason: chartString(ctx.request.options, 'rowMissing') }, mark.rect);
      // The total row sums its categories: a computed figure.
      if (!mark.range) return at(track.name, owner, number(mark.value, mark.text, mark.kind === 'total' ? { ...track, computed: true } : track), mark.rect);
      const range: InteractionValue = { kind: 'text', raw: mark.text, state: 'value', ...(track.unit === undefined ? {} : { unit: track.unit }) };
      return at(track.name, owner, range, mark.rect, [
        { key: 'low', label: chartString(ctx.request.options, 'low'), value: numericValue(mark.range.low, track.unit, track.format) },
        { key: 'high', label: chartString(ctx.request.options, 'high'), value: numericValue(mark.range.high, track.unit, track.format) },
      ]);
    });
    return [...segments, ...cells];
  }));
  // The bracket's share is the named rows together: a record of its own, after the Total row.
  const together = derived.combinedLabel ?? '';
  const combined = marks.cells.filter(mark => mark.combined).flatMap(mark => {
    const track = tracks.find(item => item.id === mark.colId);
    return track ? [makeRecord(ctx, { segmentId: 'combined', colId: track.id }, number(mark.value, mark.text, track), {
      label: `${together} / ${track.name}`, categoryLabel: together, seriesLabel: track.name, anchor: mark.rect,
    })] : [];
  });
  return [...perRow, ...combined];
}

function ganttItemRecord(ctx: RecordContext, rowId: string, rowLabel: string, item: GanttItem): InteractionRecord {
  const marks = ctx.geometry.marks as unknown as GanttMarks;
  const mark = marks.rows.find(row => row.id === rowId)?.itemNodes.find(node => node.id === item.id);
  const start: InteractionValue = mark ? textValue(mark.start, 'date') : item.anchor
    ? { kind: 'date', raw: null, state: 'unavailable', reason: chartString(ctx.request.options, 'anchoredDateUnavailable') }
    : textValue(item.start, 'date');
  return makeRecord(ctx, { categoryId: rowId, segmentId: item.id }, textValue(item.label ?? item.kind), {
    label: `${rowLabel} / ${item.label ?? item.id}`,
    fields: [{ key: 'start', label: chartString(ctx.request.options, 'start'), value: start },
      ...(mark || item.end ? [{ key: 'end', label: chartString(ctx.request.options, 'end'), value: textValue(mark?.end ?? item.end, 'date') }] : [])],
    ...(mark ? { nodeIds: [mark.nodeId], anchor: mark.rect } : {}),
  });
}

function ganttRecords(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as GanttData;
  return data.rows.flatMap(row => row.kind === 'cadence'
    ? row.events.map(event => makeRecord(ctx, { categoryId: row.id, segmentId: event.id },
      textValue(event.date, 'date'), { label: row.label }))
    : row.items.map(item => ganttItemRecord(ctx, row.id, row.label, item)));
}

/**
 * A diagram node prints its name, and its edges draw what they connect, so
 * neither opens a hover card or draws an outline: the card
 * only repeated the label. A node's card shows what its box does not print,
 * a description or caption the layout hid or cut, and nothing else. The
 * data table keeps every node with all its text.
 */
function diagramRecords(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as DiagramData;
  const marks = ctx.geometry.marks as unknown as DiagramMarks;
  const unprinted = (labelId: string) => {
    const label = ctx.geometry.labels.find(item => item.id === labelId);
    return !label || label.hidden !== undefined || label.title !== undefined;
  };
  const nodes = marks.nodes.map(mark => {
    const node = data.nodes.find(item => item.id === mark.id)!;
    const fields = [
      ...(node.secondaryLabel ? [{ key: 'secondaryLabel', label: chartString(ctx.request.options, 'description'), value: textValue(node.secondaryLabel), labelId: `secondary-label:${node.id}` }] : []),
      ...(node.caption ? [{ key: 'caption', label: chartString(ctx.request.options, 'caption'), value: textValue(node.caption), labelId: `caption-label:${node.id}` }] : []),
    ];
    return makeRecord(ctx, { pointId: mark.id }, textValue(node.label), {
      label: node.label, nodeIds: mark.sceneNodeIds, anchor: mark.rect,
      fields: fields.map(({ key, label, value }) => ({ key, label, value })),
      cardFields: fields.filter(field => unprinted(field.labelId)).map(field => field.key),
    });
  });
  const edges = marks.edges.map(mark => {
    const edge = data.edges?.find(item => item.id === mark.id);
    return makeRecord(ctx, { segmentId: mark.id }, textValue(edge?.label), {
      label: edge?.label ?? `${mark.source.nodeId} / ${mark.target.nodeId}`,
      nodeIds: mark.sceneNodeIds, anchor: mark.route.bounds,
      fields: [{ key: 'source', label: chartString(ctx.request.options, 'recordSource'), value: textValue(mark.source.nodeId) },
        { key: 'target', label: chartString(ctx.request.options, 'recordTarget'), value: textValue(mark.target.nodeId) }],
      cardFields: [],
    });
  });
  return [...nodes, ...edges];
}

function gridRecords(ctx: RecordContext, childRecords?: (ctx: RecordContext) => InteractionRecord[]): InteractionRecord[] {
  const stack = (ctx.geometry.derived as GridDerived).metricStack;
  if (stack) {
    const data = ctx.request.data as MetricStackData;
    return stack.panels.flatMap(panel => panel.values.map((raw, i) => {
      const source = data.panels.find(p => p.id === panel.id)!;
      const category = data.categories[i]!;
      const target = { ...ctx.scope, panel: panel.id, owner: { seriesId: panel.id, categoryId: category.id } };
      const hidden = panel.displayed[i] === 'Not shown';
      return {
        id: targetId(target), target, label: `${source.title} / ${category.label}`, seriesLabel: source.title, categoryLabel: category.label,
        // Every stack figure is an expression over the measures: computed, so it reads without float residue.
        value: { ...(hidden ? numericValue(null, source.unit) : derivedValue(raw, source.unit)), displayed: panel.displayed[i], ...(hidden ? { state: 'unavailable' as const, reason: chartString(ctx.request.options, 'maturingHidden') } : {}) },
        fields: [{ key: 'state', label: chartString(ctx.request.options, 'categoryState'), value: { kind: 'text' as const, state: 'value' as const, raw: panel.states[i]! } }],
        comparisons: [], annotations: [], claimIds: [], nodeIds: panel.nodeIds[i]!,
      };
    }));
  }
  const marks = ctx.geometry.marks as unknown as GridMarks;
  const inputs = normalizeGridData(ctx.request.data).panels;
  return marks.panels.flatMap(panel => {
    const prepared = panel.chart;
    const input = inputs.find(candidate => candidate.id === panel.id);
    if (!prepared || !input || !childRecords) return [];
    const prefix = `${panel.id}/`;
    const scope = { chart: ctx.scope.chart, panel: ctx.scope.panel ? `${ctx.scope.panel}/${panel.id}` : panel.id };
    const records = childRecords({ request: resolveChartRequest({ type: panel.type, data: input.data, options: prepared.options as RequestOptions, fontMetrics: ctx.request.fontMetrics }), geometry: prepared.geometry, scope, claims: [] });
    return records.map(record => {
      const nodeIds = record.nodeIds.map(id => prefix + id);
      return { ...record, nodeIds,
        claimIds: record.value.state === 'suppressed' ? []
          : ctx.claims.filter(claim => claim.nodeId && nodeIds.includes(claim.nodeId)).map(claim => claim.id),
        annotations: record.annotations.map(annotation => ({ ...annotation, id: prefix + annotation.id })),
        ...(record.anchor ? { anchor: { ...record.anchor, x: record.anchor.x + prepared.offset.x, y: record.anchor.y + prepared.offset.y } } : {}),
      };
    });
  });
}

export function structuralRecords(
  ctx: RecordContext, recordsForChild?: (ctx: RecordContext) => InteractionRecord[],
): InteractionRecord[] | undefined {
  switch (ctx.request.type) {
    case 'dimswitch': {
      const compiled=(ctx.geometry.derived as unknown as DimSwitchDerived).compiled;
      // Every dimswitch figure is an aggregate the engine computed (sums, ratios, changes): derived, so it reads without float residue.
      return tableRecords({...ctx,request:{...ctx.request,data:compiled.data,options:compiled.options}})
        .map(record => record.value.kind === 'number' && record.value.derived === undefined ? { ...record, value: { ...record.value, derived: 'number' as const } } : record);
    }
    case 'table': return tableRecords(ctx);
    case 'status': return statusRecords(ctx);
    case 'bartable': return bartableRecords(ctx);
    case 'gantt': return ganttRecords(ctx);
    case 'diagram': return diagramRecords(ctx);
    case 'grid': return gridRecords(ctx, recordsForChild);
    default: return undefined;
  }
}
