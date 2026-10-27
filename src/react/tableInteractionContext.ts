import type { ReactElement } from 'react';
import type { ResolvedChartRequest } from '../core/request';
import type { Theme } from '../core/types/theme';
import type { ResolvedTable, TableData, TableOptions } from '../core/types/table';
import type { PreparedTable } from './preparedTable';

/** What TableChart hands the hover frame around its figure. */
export interface TableInteractionFrameProps {
  table: ResolvedTable;
  /** Live visible rows, after collapse. */
  rows: readonly ResolvedTable['rows'][number][];
  /** Live visible columns, after column-group hiding. */
  columns: readonly ResolvedTable['columns'][number][];
  request: ResolvedChartRequest<TableData, TableOptions>;
  theme: Theme;
  initialPrepared?: PreparedTable;
  refused?: boolean;
  /**
   * Where the hover card renders: absent or null is the end of
   * `document.body`, an element renders it there, false keeps it inside the
   * table's own frame.
   */
  portal?: HTMLElement | null | false;
  children: ReactElement;
}
