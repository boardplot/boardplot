import type { Id } from './types/cell';
import type { LintWarning } from './types/scene';

// The checks column and bar share. Only their layouts import this file, so other chart types load none of it.

/** Check the authored net line before moving it to the nearest visible series. A bar's default line follows the
 * positive edge. A column's default line also follows the negative edge when the stack has no positive values. */
export function drawsNetLine<S extends { id: Id; lastVisibleIndex?: number }>(
  all: S[], id: Id | undefined, boundary: S | undefined, cells: (series: S) => readonly { v: number | null }[],
  defaultEdge: 'positive' | 'either', warnings: LintWarning[],
): boolean {
  if (id && !boundary) {
    warnings.push({
      code: 'net-line-series-missing',
      severity: 'warn',
      message: `netLine seriesId '${id}' is not a plotted data series; net line omitted`,
      owner: { seriesId: id },
    });
    return false;
  }
  if (!boundary || all.at(-1)?.id === boundary.id) {
    let positive = false;
    let negative = false;
    for (const series of all) {
      for (const { v } of cells(series)) {
        if (v === null) continue;
        if (v > 0) positive = true;
        if (v < 0) negative = true;
      }
      if (positive && negative) break;
    }
    if (positive !== negative && (boundary || positive || defaultEdge === 'either')) {
      warnings.push({
        code: 'netline-redundant',
        severity: 'warn',
        message: 'netLine traces the visible outer edge of a single-signed stack and adds no information',
        ...(boundary ? { owner: { seriesId: boundary.id } } : {}),
        suggest: 'Pick an inner boundary series with netLine.seriesId, or drop netLine.',
      });
    }
  }
  return boundary?.lastVisibleIndex !== -1;
}

/**
 * An invalid axis break as a warning: the chart draws without the break. Column and bar use it where the break fails
 * only after another choice (a tick step, a series a reader hid). A refusal there would end the hidden state at once,
 * so the reader could never hide the series the break was made for.
 */
export const drawnWithoutBreak = (warning: LintWarning): LintWarning => warning.code === 'axis-break-invalid'
  ? { ...warning, severity: 'warn', message: `${warning.message}; the chart is drawn without the break` } : warning;
