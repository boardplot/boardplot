import { chartSizing } from '../../sizing';
/** Zod-free table chart registration. */

import type { ChartCore } from '../../registry';
import type { TableData, TableDerived, TableOptions } from '../../types/table';
import { layoutTableCard, type TableMarks } from './layout';

export const tableCore: ChartCore<TableData, TableOptions, TableMarks, TableDerived> = {
  type: 'table',
  sizing: chartSizing('table'),
  title: 'Table',
  summary:
    'Consulting-grade table: hierarchy with honest totals (derive/validate/source), typed calc columns, status chips, composite cells — self-verifying via computed-cell records',
  aliases: ['tbl'],
  layout: layoutTableCard,
  defaults: { variant: 'hierarchy', density: 'regular' },
  annotationKinds: []
};
