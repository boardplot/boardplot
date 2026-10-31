import { resolveTable } from '../core/charts/table/resolve';
import { ENGINE_REV } from '../core/engine';
import { preparedTableRecords } from '../core/a11y/structuralRecords';
import type { LintWarning } from '../core/types/scene';
import type { PresentationInfo } from '../core/types/sizing';
import { tablePresentation } from './tablePresentation';
import type { InteractionRecord } from '../core/a11y/types';
import type { ResolvedChartRequest } from '../core/request';
import type { Id } from '../core/types/cell';
import type { ResolvedCell, ResolvedRow, ResolvedTable, TableData, TableOptions, TableRow } from '../core/types/table';
import { requestRenderKey, type PreparedHeader } from './prepared';

export interface PreparedTable extends PreparedHeader {
  kind: 'table';
  warnings?: LintWarning[];
  presentation?: Pick<PresentationInfo, 'target' | 'minDisplayWidth'>;
  records?: InteractionRecord[];
  table: Omit<ResolvedTable, 'provenance'>;
}

/** The grid does not render these suppression cases safely, so preparation refuses them. */
function assertSafeSuppression(data: TableData): void {
  const kinds = new Map(data.columns.map(column => [column.id, column.kind]));
  const visit = (row: TableRow): void => {
    for (const [columnId, cell] of Object.entries(row.cells ?? {})) {
      if (!cell || typeof cell !== 'object' || cell.state !== 'suppressed') continue;
      const kind = kinds.get(columnId);
      if ((kind !== 'value' && kind !== 'computed') || cell.note !== undefined || cell.href !== undefined) {
        throw new Error(`Cannot prepare suppressed table cell ${row.id}/${columnId}: only numeric suppression without note or href is supported`);
      }
    }
    row.children?.forEach(visit);
  };
  data.rows.forEach(visit);
}

function preparedCell(cell: ResolvedCell, keepRaw: boolean): ResolvedCell {
  if (cell.state === 'suppressed' && (cell.note !== undefined || cell.href !== undefined)) {
    throw new Error(`Cannot prepare suppressed table cell ${cell.rowId}/${cell.colId}: note and href disclosure is unsupported`);
  }
  return {
    rowId: cell.rowId, colId: cell.colId, kind: cell.kind,
    raw: cell.state === 'value' && keepRaw ? cell.raw : null,
    state: cell.state, displayed: cell.displayed, tone: cell.tone,
    note: cell.note, href: cell.href, deEmphasized: cell.deEmphasized, polarity: cell.polarity,
    ...(cell.zero ? { zero: true as const } : {}),
    ...(cell.negated ? { negated: true as const } : {}),
    ...(cell.heat === false ? { heat: false as const } : {}),
    ...(cell.strong ? { strong: true as const } : {}),
    ...(cell.bar === undefined ? {} : { bar: cell.bar }),
    ...(cell.band === undefined ? {} : { band: cell.band }),
    scenario: cell.scenario, role: cell.role, relation: cell.relation, level: cell.level,
  };
}


/**
 * One row as the grid reads it. The statement fields travel with it: `kind`, `sign`, `final`, `operator`,
 * `divider` and `driverTone` decide a subtotal's ground, a result's rule, an operator glyph and a driver's tone, and the
 * inline fields (`inline`, `inlineGroup`, `inlineRows`, `polarity`) place a change line inside its parent's cells. A snapshot
 * that dropped them drew a statement or a steering table differently from the live grid.
 */
function preparedRow(row: ResolvedRow, rawColumns: ReadonlySet<Id>): ResolvedRow {
  return {
    id: row.id, label: row.label, parentId: row.parentId, hasChildren: row.hasChildren,
    defaultExpanded: row.defaultExpanded, level: row.level, role: row.role,
    // The rung the row takes on the level ladder: the grid
    // reads it for size, weight, air, ground, indent and label ink, and
    // a prepared table that dropped it would draw its own ladder.
    step: row.step,
    relation: row.relation, order: row.order, highlightTone: row.highlightTone,
    kind: row.kind, sign: row.sign, final: row.final, operator: row.operator, divider: row.divider, driverTone: row.driverTone,
    polarity: row.polarity, inline: row.inline, inlineGroup: row.inlineGroup,
    inlineRows: row.inlineRows?.map((line) => preparedRow(line, rawColumns)),
    // The unit a forced magnitude hoisted onto the label: it is
    // the only place the scale is written, so a prepared table that
    // dropped it printed bare figures with no unit anywhere.
    unitAffix: row.unitAffix,
    // The empty band before the row is display, and a prepared
    // grid that dropped it closed every year gap of a cohort history.
    spacer: row.spacer,
    // A parent that does not fold and a section's chip are display too.
    foldable: row.foldable,
    badge: row.badge,
    cells: Object.fromEntries(Object.entries(row.cells).map(([id, cell]) => [id, preparedCell(cell, rawColumns.has(id))])),
  };
}

/** Resolve on the server; serialize only the table's display model, never calculation receipts. */
export function prepareTableRender(request: ResolvedChartRequest<TableData, TableOptions>): PreparedTable {
  if (request.type !== 'table') throw new Error('prepareTableRender requires a table request');
  const requestKey = requestRenderKey(request);
  assertSafeSuppression(request.data);
  const { table, warnings } = resolveTable(request.data, request.options);
  // A heat cell is painted from its raw value on both surfaces, so a heat
  // column keeps one: without it `heatRanges` saw an empty lane and every
  // tint went, and under `figures: false` the ground IS the reading, so the
  // cell arrived blank.
  // `fitFormats` asks whether a figure fits its authored track and caps a
  // unit step by the largest figure, so a fixed numeric track keeps its raw
  // values too; a snapshot without them fitted nothing.
  const fitColumn = (column: ResolvedTable['columns'][number]): boolean => request.options.fitFormats === true
    && column.width !== undefined && (column.kind === 'value' || column.kind === 'computed');
  const rawColumns = new Set(table.columns.filter(column => column.kind === 'status'
    || column.cellEncoding?.type === 'inCellBar'
    || column.cellEncoding?.type === 'heat'
    || fitColumn(column)).map(column => column.id));
  return {
    kind: 'table', engineRev: ENGINE_REV, requestKey, warnings,
    presentation: tablePresentation(request, table),
    records: preparedTableRecords(table, request.data, request.scope, request.options),
    table: {
      columns: table.columns.map(column => ({ ...column })),
      // The whole group, not three of its fields: the band, the heading's
      // note and the spacer track are display and a prepared grid draws
      // them. A named list would drop the spacer, so a prepared cohort
      // grid would close its 16 px gaps and place every cell one track off.
      columnGroups: table.columnGroups.map(group => ({ ...group, columnIds: [...group.columnIds] })),
      columnToggles: table.columnToggles.map(toggle => ({
        id: toggle.id, label: toggle.label, columnIds: [...toggle.columnIds],
        defaultVisible: toggle.defaultVisible, visible: toggle.visible,
      })),
      rows: table.rows.map((row) => preparedRow(row, rawColumns)),
      unit: table.unit, footnotes: [...table.footnotes],
    },
  };
}
