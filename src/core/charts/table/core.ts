import { chartSizing } from '../../sizing';
/** Zod-free table chart registration. */

import type { ChartCore } from '../../registry';
import type { Geometry } from '../../types/scene';
import type { TableData, TableDerived, TableOptions } from '../../types/table';
import { claimId, withUnprintedClaims } from '../../claims/ids';
import { printsInCell } from './cellKey';
import { layoutTableCard, prepareTableCardExecutor, type TableMarks } from './layout';
import { cellPrinted } from './view';

/** A computed cell's claim prints only where its number is the cell's figure and the layout prints that cell. */
function withUnprintedCells(geometry: Geometry<TableMarks, TableDerived>, options: TableOptions = {}): Geometry<TableMarks, TableDerived> {
  const { table, computedCells } = geometry.derived;
  const printed = cellPrinted(table, geometry.marks, options);
  const rows = new Map(table.rows.map((row) => [row.id, row]));
  return withUnprintedClaims(geometry, computedCells
    .filter((c) => !printsInCell(c, rows.get(c.rowId)?.cells[c.colId]?.raw) || !printed(c.rowId, c.colId))
    .map((c) => (c.kind === 'calc' || c.kind === 'aggregate' ? claimId('table', c.rowId, c.colId) : claimId('table', c.rowId, c.colId, c.kind))));
}

export const tableCore: ChartCore<TableData, TableOptions, TableMarks, TableDerived> = {
  type: 'table',
  sizing: chartSizing('table'),
  title: 'Table',
  summary:
    'Consulting-grade table: hierarchy with honest totals (derive/validate/source), typed calc columns, status chips, composite cells — self-verifying via computed-cell records',
  aliases: ['tbl'],
  layout: (data, options) => withUnprintedCells(layoutTableCard(data, options), options),
  prepareLayout(data) {
    const run = prepareTableCardExecutor(data);
    return (_data, options) => withUnprintedCells(run(options), options);
  },
  defaults: { variant: 'hierarchy', density: 'regular' },
  annotationKinds: []
};
