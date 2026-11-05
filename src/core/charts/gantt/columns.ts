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
  /** A width, an alignment or an order is authored: the author asks for columns, so the form choice tests them. */
  layoutAuthored: boolean;
}

/** Internal option: what layoutGantt settled on after it compared the draw with the spec without the column settings. */
export const COLUMN_PLAN = Symbol('ganttColumnPlan');

export interface GanttColumnPlan {
  /** Draw as the spec without width, align, headAlign and order draws. */
  plain?: true;
  /** Draw the stacked form wherever a name line fits. */
  stacked?: true;
  /** The least timeline the columns must leave. */
  minimumTimeline?: number;
  /** Which of the name widths that unwrap a row to draw, narrowest first, in place of a width whose rows miss a fixed height. */
  nameStep?: number;
}

export const columnPlan = (options: GanttOptions): GanttColumnPlan | undefined => (options as { [COLUMN_PLAN]?: GanttColumnPlan })[COLUMN_PLAN];

/** What the width overrides resolved to on one plot. */
export interface AuthoredWidths {
  name?: number;
  /** The name width gave way because the rows at the authored width miss a fixed height. */
  nameGaveWay?: true;
  meta: readonly (number | undefined)[];
  /** Every metadata column keeps its values in full. False where they leave no timeline. */
  keepAll: boolean;
  floored: readonly string[];
  capped: readonly string[];
}

/** The overrides with only their labels: what a plain plan reads. */
const labelsOnly = (overrides: GanttOptions['columnOverrides']): GanttOptions['columnOverrides'] => overrides && Object.fromEntries(Object.entries(overrides)
  .flatMap(([id, column]) => (column.label === undefined ? [] : [[id, { label: column.label }]])));

export function resolveGanttColumns(options: GanttOptions): GanttColumnSettings {
  const plain = columnPlan(options)?.plain === true;
  const overrides = plain ? labelsOnly(options.columnOverrides) : options.columnOverrides;
  const meta = Array.from({ length: MAX_COLS }, (_, k) => overrides?.[`meta${k}`]);
  const labelled = meta.some((column) => column?.label !== undefined);
  const headers = !labelled ? options.colHeaders : meta.map((column, k) => column?.label ?? options.colHeaders?.[k] ?? '');
  const order = plain ? [] : options.columnOrder ?? [];
  const plotAt = order.indexOf('plot');
  const metaAt = order.indexOf('meta');
  const placesBlocks = plotAt >= 0 || metaAt >= 0;
  return {
    ...(overrides?.name ? { name: overrides.name } : {}),
    meta,
    headers,
    metaAfter: plotAt >= 0 && (metaAt < 0 || plotAt < metaAt),
    authored: meta.some(Boolean) || placesBlocks,
    layoutAuthored: placesBlocks || [overrides?.name, ...meta].some((column) => column?.width !== undefined || column?.align !== undefined || column?.headAlign !== undefined),
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
  const layoutKeys = Object.entries(overrides ?? {}).filter(([, column]) => column.width !== undefined || column.align !== undefined || column.headAlign !== undefined).map(([id]) => id);
  if (!stacked && columnPlan(env.options)?.plain) {
    if (layoutKeys.length) warnings.push({ code: 'option-ignored', severity: 'warn', field: ['options', 'columnOverrides'],
      message: `width, align and headAlign of ${layoutKeys.join(', ')} would hide a label or miss the height on this canvas, so they do nothing here; label still prints`,
      suggest: 'Widen the chart, or lower the width.' });
    if (order?.length) warnings.push({ code: 'option-ignored', severity: 'warn', field: ['options', 'columnOrder'],
      message: 'columnOrder would hide a label on this canvas, so it does nothing here',
      suggest: 'Widen the chart.' });
    return warnings;
  }
  if (stacked) {
    if (layoutKeys.length) warnings.push({ code: 'option-ignored', severity: 'warn', field: ['options', 'columnOverrides'],
      message: `this canvas draws the gantt in its stacked form, which has no columns, so width, align and headAlign of ${layoutKeys.join(', ')} do nothing here; label still prints`,
      suggest: 'Widen the chart or lower the width to draw the columns.' });
    if (order?.length) warnings.push({ code: 'option-ignored', severity: 'warn', field: ['options', 'columnOrder'],
      message: 'this canvas draws the gantt in its stacked form, where the metadata sits on each name line, so columnOrder does nothing here',
      suggest: 'Widen the chart to draw the columns.' });
    return warnings;
  }
  if (widths.floored.length) warnings.push({ code: 'generated-column-width-floored', severity: 'warn', field: ['options', 'columnOverrides'],
    message: `columnOverrides width of ${widths.floored.join(', ')} is under what the text needs, so the column stays as wide as its text`,
    suggest: 'Raise the width, or shorten the text.' });
  if (widths.nameGaveWay) warnings.push({ code: 'generated-column-width-floored', severity: 'warn', field: ['options', 'columnOverrides'],
    message: `columnOverrides width of name wraps the row names, and the rows would not fit this height, so the column is ${Math.round(widths.name ?? 0)} px wide`,
    suggest: 'Raise the width, or make the chart taller.' });
  if (widths.capped.length) warnings.push({ code: 'generated-column-width-capped', severity: 'warn', field: ['options', 'columnOverrides'],
    message: `columnOverrides width of ${widths.capped.join(', ')} leaves too little timeline on this canvas, so it gave way. Ids: ${generatedIdList('gantt', 'columnOverrides')}`,
    suggest: 'Lower the width, or widen the chart.' });
  return warnings;
}
