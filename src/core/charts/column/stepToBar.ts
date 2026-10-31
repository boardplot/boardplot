/**
 * A column chart whose category names cannot fit under the columns, and cannot
 * rotate either, draws as horizontal bars: a bar row has the room for a name.
 * The step is made only when the bar draws every name at the size asked for and
 * nothing the author set is column-only; else the column stays, and the names
 * it leaves out are listed as omissions (labels.ts).
 */

import { valueAxisRefusal } from '../../schema/capability';
import { fitsSize, SIZE_TOLERANCE } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { panelTypeClass, resolveTheme } from '../../theme';
import { textScaleOf } from '../../typeFloors';
import type { ChartData } from '../../types/data';
import type { BarOptions } from '../../types/options';
import type { Geometry } from '../../types/scene';
import { layoutBar } from '../bar/layout';
import { barChromeFloor } from '../bar/plot';
import { BarTooTall, STOP_IF_TOO_TALL } from '../bar/model';
import type { ColumnDerived, ColumnMarks } from './layout';
import type { AnomalyColumnOptions } from './types';

/** Settings that bar has no counterpart for. A value axis key bar refuses and column reads (tickStep) counts too. */
const COLUMN_ONLY = ['anomaly', 'ratioTier', 'events', 'seriesRamp', 'othersShade', 'seriesLabels', 'shareLabels', 'window', 'viewDomain', 'categoryLabels', 'ribbons'] as const;

export function stepToBar(
  data: ChartData,
  options: AnomalyColumnOptions,
  column: Geometry<ColumnMarks, ColumnDerived>,
): Geometry<ColumnMarks, ColumnDerived> | undefined {
  const names = column.labels.filter((label) => label.kind === 'category');
  const lost = names.filter((label) => label.hidden === 'density');
  if (lost.length === 0 || panelTypeClass(options) !== undefined) return undefined;
  if (COLUMN_ONLY.some((key) => options[key] !== undefined) || options.annotations?.some((annotation) => annotation.kind === 'event')) return undefined;
  // A total category (role: 'total') is set apart by a gap, a divider and bold type in a column; a bar has no such row.
  if (data.categories.some((category) => category.role === 'total')) return undefined;
  // valueAxis.percent turns a column into shares of 100%, and an integrated PY reference draws growth labels; a bar draws neither.
  if (options.valueAxis?.percent || column.derived.integratedVariance !== undefined) return undefined;
  if (Object.entries(options.valueAxis ?? {}).some(([key, value]) => value !== undefined && valueAxisRefusal('bar', key) !== undefined && valueAxisRefusal('column', key) === undefined)) return undefined;
  // An open height is the bar's to choose: the fit step after the layout gives its rows their height.
  // A pinned height must already hold every row with its name.
  const pinned = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === true;
  if (pinned && rowsExceed(names.length, options, column.size.height)) return undefined;
  // A pinned height the rows cannot fit stops the bar layout once its frame and rows are sized, before its marks and labels are built.
  let bar: ReturnType<typeof layoutBar>;
  try {
    bar = layoutBar(data, (pinned ? { ...options, [STOP_IF_TOO_TALL]: true } : options) as BarOptions);
  } catch (error) {
    if (error instanceof BarTooTall) return undefined;
    throw error;
  }
  const fits = bar.sizing !== undefined && (pinned ? fitsSize(bar.size, bar.sizing) : bar.size.width + SIZE_TOLERANCE >= bar.sizing.minWidth);
  if (bar.refused || !fits || (pinned && bar.labels.some((label) => label.kind === 'category' && label.hidden))) return undefined;
  bar.warnings.push({
    code: 'column-stepped-to-bar',
    severity: 'info',
    message: `${lost.length} of ${data.categories.length} category names do not fit under the columns at ${Math.round(column.size.width)}px and cannot rotate, so the chart is drawn as horizontal bars`,
    suggest: `Set the chart type to bar, or widen the canvas to keep columns.`,
  });
  return bar as unknown as Geometry<ColumnMarks, ColumnDerived>;
}

/** The bar row floor in px, before the text scale (barSizing in bar/layout.ts). */
const BAR_ROW_FLOOR = 28;

/**
 * Whether a pinned height is too short for any bar layout of these rows, so none need be laid out. Every
 * bar row is at least the row floor times the text scale, and the frame (barChromeFloor) takes its own
 * height besides. A theme with its own row pitch sets another row height, so that case is laid out.
 */
function rowsExceed(rows: number, options: AnomalyColumnOptions, height: number): boolean {
  if (resolveTheme(options.theme).space.barRow !== undefined) return false;
  const rowsH = rows * BAR_ROW_FLOOR * textScaleOf(options);
  return rowsH > height + SIZE_TOLERANCE || rowsH + barChromeFloor(options as BarOptions) > height + SIZE_TOLERANCE;
}
