import { prepareFractionData } from './normalize/fraction';
import { NormalizeError } from './normalize/shared';
import type { DataRange, OwnerRef, RangeCell } from './types/cell';
import type { LintWarning } from './types/scene';

export type { DataRange, RangeCell };

export interface RangeMark {
  seriesId: string;
  categoryId: string;
  low: number;
  high: number;
  mid?: number;
  nodeIds: string[];
}

export function resolveCellRange(
  cell: RangeCell,
  path: string,
  warnings: LintWarning[],
  owner: OwnerRef,
): DataRange | undefined {
  if (typeof cell !== 'object' || cell === null || !('range' in cell)) return undefined;
  const raw = cell.range;
  if (raw === undefined) return undefined;
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Number.isFinite(raw.low) ||
    !Number.isFinite(raw.high) ||
    (raw.mid !== undefined && !Number.isFinite(raw.mid))
  ) {
    throw new NormalizeError(
      'invalid-range',
      `${path}.range`,
      'range requires finite low/high values and an optional finite mid',
    );
  }
  if (raw.low > raw.high) {
    throw new NormalizeError(
      'range-inverted',
      `${path}.range`,
      `range-inverted: range low ${raw.low} exceeds high ${raw.high}`,
      'swap low/high or correct the source interval',
    );
  }
  if (raw.mid !== undefined && (raw.mid < raw.low || raw.mid > raw.high)) {
    warnings.push({
      code: 'range-mid-outside',
      severity: 'warn',
      message: `range mid ${raw.mid} is outside [${raw.low}, ${raw.high}] and was omitted`,
      owner,
      suggest: 'keep range.mid between range.low and range.high',
    });
    return { low: raw.low, high: raw.high };
  }
  return raw.mid === undefined
    ? { low: raw.low, high: raw.high }
    : { low: raw.low, high: raw.high, mid: raw.mid };
}

function assertRangeOrder(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) return;
  const series = (raw as { series?: unknown; }).series;
  if (!Array.isArray(series)) return;
  series.forEach((candidate, si) => {
    if (typeof candidate !== 'object' || candidate === null) return;
    const values = (candidate as { values?: unknown; }).values;
    if (!Array.isArray(values)) return;
    values.forEach((entry, ci) => {
      const cell =
        typeof entry === 'object' && entry !== null && 'categoryId' in entry && 'value' in entry
          ? (entry as { value: unknown; }).value
          : entry;
      if (typeof cell !== 'object' || cell === null || !('range' in cell)) return;
      const range = (cell as { range?: unknown; }).range;
      if (typeof range !== 'object' || range === null) return;
      const low = (range as { low?: unknown; }).low;
      const high = (range as { high?: unknown; }).high;
      if (typeof low === 'number' && typeof high === 'number' && low > high) {
        throw new NormalizeError(
          'range-inverted',
          `series[${si}].values[${ci}].range`,
          `range-inverted: range low ${low} exceeds high ${high}`,
          'swap low/high or correct the source interval',
        );
      }
    });
  });
}

export function prepareRangeData<T>(data: T): T {
  assertRangeOrder(data);
  if (typeof data !== 'object' || data === null) return data;
  const chart = data as { categories?: unknown; series?: unknown; };
  if (Array.isArray(chart.categories) && chart.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'range chart requires at least one category');
  }
  if (Array.isArray(chart.series) && chart.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'range chart requires at least one series');
  }
  return prepareFractionData(data);
}

/**
 * A supplied mid-point the chart does not draw. A tick inside a range means
 * nothing to a reader until the method note says what it marks, so the tick
 * waits for `methodNote: true`.
 */
export function rangeMidUndrawn(): LintWarning {
  return {
    code: 'range-mid-undrawn',
    severity: 'info',
    message: 'range mid-points are not drawn: a tick inside a range needs the method note that says what it marks',
    suggest: 'set methodNote: true to draw the ticks with their note',
  };
}
