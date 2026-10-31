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
  // valueAxis.percent turns a column into shares of 100%, and an integrated PY reference draws growth labels; a bar draws neither.
  if (options.valueAxis?.percent || column.derived.integratedVariance !== undefined) return undefined;
  if (Object.entries(options.valueAxis ?? {}).some(([key, value]) => value !== undefined && valueAxisRefusal('bar', key) !== undefined && valueAxisRefusal('column', key) === undefined)) return undefined;
  // An open height is the bar's to choose: the fit step after the layout gives its rows their height.
  // A pinned height must already hold every row with its name.
  const pinned = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === true;
  if (pinned && rowsExceed(names.length, options, column.size.height)) return undefined;
  const bar = layoutBar(data, options as BarOptions);
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
 * Whether the category rows alone are taller than a pinned height, so no bar layout can hold them and the
 * bar need not be laid out. Every bar row is at least the row floor times the text scale; a theme
 * with its own row pitch sets another height, so that case is laid out.
 */
function rowsExceed(rows: number, options: AnomalyColumnOptions, height: number): boolean {
  if (resolveTheme(options.theme).space.barRow !== undefined) return false;
  return rows * BAR_ROW_FLOOR * textScaleOf(options) > height + SIZE_TOLERANCE;
}
