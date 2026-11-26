import type { CreativeOptions } from './types';

export const creativeMetrics = [
  ['ctr', 'CTR', '%'], ['cpa', 'CPA', 'currency'], ['roas', 'ROAS', '×'],
  ['hookRate', 'Hook rate', '%'], ['holdRate', 'Hold rate', '%'], ['frequency', 'Frequency', '×'],
] as const;

export type NumberColumn = 'value' | 'median' | 'delta';
export const NUMBER_COLUMNS: readonly NumberColumn[] = ['value', 'median', 'delta'];

/** What the authored column and row keys leave of the table. Hidden is display only: fatigue and the medians read the data. */
export interface TablePlan {
  columns: readonly NumberColumn[];
  rows: readonly (typeof creativeMetrics)[number][];
  /** False while no key changes the table: the card keeps its fixed edges. */
  authored: boolean;
}

export function tablePlan(options: CreativeOptions): TablePlan {
  const listed = (options.columnOrder ?? []).filter((id): id is NumberColumn => (NUMBER_COLUMNS as readonly string[]).includes(id));
  const columns = [...new Set([...listed, ...NUMBER_COLUMNS])].filter((id) => options.columnVisibility?.[id] !== false);
  const named = (options.rowOrder ?? []).flatMap((id) => creativeMetrics.filter(([key]) => key === id));
  const rows = [...new Set([...named, ...creativeMetrics])].filter(([key]) => options.rowVisibility?.[key] !== false);
  return { columns, rows, authored: options.columnVisibility !== undefined || options.columnOverrides !== undefined || options.columnOrder !== undefined
    || options.rowVisibility !== undefined || options.rowOrder !== undefined || options.rowOverrides !== undefined };
}
