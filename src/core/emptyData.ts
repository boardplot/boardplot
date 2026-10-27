/**
 * The one signal for a chart with nothing to draw: a data collection that
 * must hold an item (categories, series, rows, points, groups, ...) is empty.
 * Every chart type reports it with this code, from the schema and from the
 * layout alike, so a host can hide the card instead of showing a box.
 */

import { localeStrings } from './strings/ui';
import { NormalizeError } from './normalize/shared';
import { chartSizing, resolveSizing } from './sizing';
import type { Size } from './geometry';
import type { RefusedLayout } from './types/scene';

export const EMPTY_DATA = 'empty-data';

/** The wording of a chart with nothing to draw; a React host overrides it through `strings.emptyMessage`. */
export const DEFAULT_EMPTY_MESSAGE = localeStrings().emptyMessage;

/** A table with no data row: nothing but section headings and totals, or no row at all. Folds and `rootsHidden` do not make it empty. */
export function hasNoDataRows(table: { rows: readonly { role: string; inline?: true }[] }): boolean {
  return !table.rows.some((row) => row.role === 'data' && row.inline !== true);
}

/** A schema issue on a top-level data array that holds no item at all, whatever minimum the schema sets. The length comes from the input; a 1 of 2 array stays an invalid-data finding. */
export function isEmptyDataIssue(issue: { code?: unknown; origin?: unknown; path: readonly unknown[] }, data: unknown): boolean {
  if (issue.code !== 'too_small' || issue.origin !== 'array' || issue.path.length !== 1) return false;
  const value = (data as Record<PropertyKey, unknown> | null | undefined)?.[issue.path[0] as PropertyKey];
  return Array.isArray(value) && value.length === 0;
}

/** The layout's refusal from the error it threw (`empty-data` and every other code), as hosts and `canDraw` read it. */
export function layoutRefusal(type: string, title: string, size: Size, error: NormalizeError): RefusedLayout {
  return {
    refused: true,
    type,
    title,
    size,
    sizing: resolveSizing(chartSizing(type), size),
    warnings: [{
      code: error.code,
      severity: 'error',
      message: error.message,
      ...(error.suggest ? { suggest: error.suggest } : {}),
      ...(error.fix ? { fix: error.fix } : {}),
      field: error.code === EMPTY_DATA ? ['data', ...(error.path ? error.path.split('.') : [])] : error.segments ?? (error.path ? error.path.split('.') : []),
    }],
  };
}
