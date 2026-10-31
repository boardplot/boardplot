/**
 * A column chart whose category names cannot fit under the columns, and cannot
 * rotate either, draws as horizontal bars: a bar row has the room for a name.
 * The step is made only when the bar draws every name at the size asked for and
 * every setting and data key of the request is one a bar draws as a column does
 * (barDrawsAlike); else the column stays, and the names it leaves out are
 * listed as omissions (labels.ts).
 */

import { fitsSize, SIZE_TOLERANCE } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { authoredStrings } from '../../strings';
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

/**
 * Options a bar draws as a column does. Every option not named here keeps the column. The last row holds keys the
 * engine adds to the request itself: a text measurer, the compact size floor and the footnotes as authored.
 */
const SAME_OPTIONS = new Set([
  'size', 'target', 'textScale', 'textSize', 'a11y', 'mode', 'margin', 'canvas', 'title', 'subtitle', 'unit', 'unitShown', 'source', 'footnotes', 'notes', 'theme', 'locale', 'format',
  'sort', 'highlight', 'focus', 'signColor', 'legend', 'valueLabels', 'labelDensity', 'averageMarker',
  'variant', 'referenceStyle', 'netLine', 'labels', 'strings', 'valueAxis', 'annotations',
  'measure', 'sizeFloor', 'authoredFootnotes', 'footnotesOff',
]);
/** The wording keys a bar prints as a column does. */
const SAME_STRINGS = new Set(['net', 'average', 'others', 'toDate', 'hiddenLabels', 'valuesNotOnColumns', 'aboveZero', 'belowZero', 'knownPartsTotals']);
const SAME_VALUE_AXIS = new Set(['show', 'min', 'includeZero']);
const SAME_LABELS = new Set(['restSeries']);
const SAME_ANNOTATIONS = new Set(['note', 'callout', 'diff', 'delta', 'cagr', 'band', 'valueLine']);
const SAME_DATA = new Set(['categories', 'series', 'valueKind']);
const SAME_CATEGORY = new Set(['id', 'label', 'footnote', 'partial']);
const SAME_SERIES = new Set(['id', 'label', 'values', 'valueKind', 'scenario', 'colorRole', 'format']);
const SAME_CELL = new Set(['number', 'fill', 'format', 'label', 'pct', 'scenario']);

const hasOnly = (value: object, allowed: ReadonlySet<string>): boolean => Object.entries(value).every(([key, entry]) => entry === undefined || allowed.has(key));

/**
 * Whether every option, data key, cell key, annotation and label content of a column request is one a bar
 * draws the same way. A list of what bar draws alike keeps a new column setting on the column until it is
 * tested; a list of what bar drops would let it step to bars and be lost. The request alone decides, so a
 * column that stays pays for no bar layout.
 */
function barDrawsAlike(data: ChartData, options: AnomalyColumnOptions): boolean {
  if (!hasOnly(options, SAME_OPTIONS)) return false;
  if (options.variant === 'stacked100' || (options.referenceStyle !== undefined && options.referenceStyle !== 'tick')) return false;
  if (options.netLine !== undefined && options.netLine !== true) return false;
  if (options.labels !== undefined && (options.labels === false || !hasOnly(options.labels, SAME_LABELS))) return false;
  if (options.strings !== undefined && !hasOnly(authoredStrings(options) ?? {}, SAME_STRINGS)) return false;
  if (options.valueAxis !== undefined && !hasOnly(options.valueAxis, SAME_VALUE_AXIS)) return false;
  // Two growth rates are named by their periods in a column; a bar draws neither of them.
  const annotations = options.annotations ?? [];
  if (annotations.some((annotation) => !SAME_ANNOTATIONS.has(annotation.kind)) || annotations.filter((annotation) => annotation.kind === 'cagr').length > 1) return false;
  // A column's value line with a span or a series is measured over it and warns when it also has a value; a bar draws it over the span with no warning.
  if (annotations.some((annotation) => annotation.kind === 'valueLine' && (annotation.seriesId !== undefined || annotation.from !== undefined || annotation.to !== undefined || annotation.axis !== undefined))) return false;
  if (!hasOnly(data, SAME_DATA)) return false;
  if (!data.categories.every((category) => hasOnly(category, SAME_CATEGORY))) return false;
  return data.series.every((series) => hasOnly(series, SAME_SERIES) && series.role === undefined && series.values.every((cell) => cell === null || typeof cell === 'number' || hasOnly(cell, SAME_CELL)));
}

export function stepToBar(
  data: ChartData,
  options: AnomalyColumnOptions,
  column: Geometry<ColumnMarks, ColumnDerived>,
): Geometry<ColumnMarks, ColumnDerived> | undefined {
  const names = column.labels.filter((label) => label.kind === 'category');
  const lost = names.filter((label) => label.hidden === 'density');
  if (lost.length === 0 || panelTypeClass(options) !== undefined) return undefined;
  // A setting a bar draws differently, or drops, keeps the column: the request decides before any bar is laid out.
  if (!barDrawsAlike(data, options)) return undefined;
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
