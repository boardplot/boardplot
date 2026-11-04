/** The gantt reading of columnOverrides and columnOrder. Layouts read the settings from the env. */
import { generatedIdList, generatedIdWarnings } from '../../schema/generatedColumns';
import type { LintWarning } from '../../types/scene';
import type { GanttOptions } from './layout';
import type { NormRow } from './model';

/** The metadata columns a gantt draws. */
export const MAX_COLS = 3;

export type ColumnAlign = 'left' | 'right' | 'center';

export interface GanttColumnOverride {
  width?: number;
  align?: ColumnAlign;
  headAlign?: ColumnAlign;
  label?: string;
}

export interface GanttColumnSettings {
  name?: GanttColumnOverride;
  /** One entry per metadata position. */
  meta: readonly (GanttColumnOverride | undefined)[];
  /** colHeaders, with each override label in place of its entry. */
  headers: readonly string[] | undefined;
  /** The metadata block follows the timeline. */
  metaAfter: boolean;
  /** A setting of a metadata column exists, so a plan reads them. */
  authored: boolean;
}

/** What the width overrides resolved to on one plot. */
export interface AuthoredWidths {
  name?: number;
  meta: readonly (number | undefined)[];
  floored: readonly string[];
  capped: readonly string[];
}

export function resolveGanttColumns(options: GanttOptions): GanttColumnSettings {
  const overrides = options.columnOverrides;
  const meta = Array.from({ length: MAX_COLS }, (_, k) => overrides?.[`meta${k}`]);
  const labelled = meta.some((column) => column?.label !== undefined);
  const headers = !labelled ? options.colHeaders : meta.map((column, k) => column?.label ?? options.colHeaders?.[k] ?? '');
  const order = options.columnOrder ?? [];
  const plotAt = order.indexOf('plot');
  const metaAt = order.indexOf('meta');
  return {
    ...(overrides?.name ? { name: overrides.name } : {}),
    meta,
    headers,
    metaAfter: plotAt >= 0 && (metaAt < 0 || plotAt < metaAt),
    authored: meta.some(Boolean) || plotAt >= 0 && (metaAt < 0 || plotAt < metaAt),
  };
}

/** Where text of width `w` starts in a track of width `track` that starts at `x`. */
export function alignedX(x: number, track: number, w: number, align: ColumnAlign): number {
  return align === 'right' ? x + track - w : align === 'center' ? x + (track - w) / 2 : x;
}

/** What the overrides warn on one draw: wrong ids, what the stacked form cannot read, and widths that gave way. */
export function ganttColumnWarnings(env: { options: GanttOptions }, rows: readonly NormRow[], stacked: boolean, widths: AuthoredWidths): LintWarning[] {
  const { columnOverrides: overrides, columnOrder: order } = env.options;
  if (overrides === undefined && order === undefined) return [];
  const count = Math.min(MAX_COLS, Math.max(0, ...rows.map((row) => row.cols.length)));
  const metaIds = Array.from({ length: count }, (_, k) => `meta${k}`);
  const warnings = [
    ...generatedIdWarnings('gantt', 'columnOverrides', overrides, ['name', ...metaIds]),
    ...generatedIdWarnings('gantt', 'columnOrder', order, [...(count ? ['meta'] : []), 'plot']),
  ];
  if (stacked) {
    const layoutKeys = Object.entries(overrides ?? {}).filter(([, column]) => column.width !== undefined || column.align !== undefined || column.headAlign !== undefined).map(([id]) => id);
    if (layoutKeys.length) warnings.push({ code: 'option-ignored', severity: 'warn', field: ['options', 'columnOverrides'],
      message: `this canvas draws the gantt in its stacked form, which has no columns, so width, align and headAlign of ${layoutKeys.join(', ')} do nothing here; label still prints`,
      suggest: 'Widen the chart to draw the columns.' });
    if (order?.length) warnings.push({ code: 'option-ignored', severity: 'warn', field: ['options', 'columnOrder'],
      message: 'this canvas draws the gantt in its stacked form, where the metadata sits on each name line, so columnOrder does nothing here',
      suggest: 'Widen the chart to draw the columns.' });
    return warnings;
  }
  if (widths.floored.length) warnings.push({ code: 'generated-column-width-floor', severity: 'warn', field: ['options', 'columnOverrides'],
    message: `columnOverrides width of ${widths.floored.join(', ')} is under what the text needs, so the column stays as wide as its text`,
    suggest: 'Raise the width, or shorten the text.' });
  if (widths.capped.length) warnings.push({ code: 'generated-column-width-capped', severity: 'warn', field: ['options', 'columnOverrides'],
    message: `columnOverrides width of ${widths.capped.join(', ')} leaves too little timeline on this canvas, so it gave way. Ids: ${generatedIdList('gantt', 'columnOverrides')}`,
    suggest: 'Lower the width, or widen the chart.' });
  return warnings;
}
