import type { Id } from './types/cell';
import type { LintWarning } from './types/scene';
import type { SeriesIdentity } from './seriesIdentity';
import { HIDDEN_SERIES } from './hiddenSeriesKey';

/** Keep the original list when the reader hides none or all. Only normalized layout series receive indexes. */
export function shownSeries<S extends { id: string; lastVisibleIndex?: number }>(options: object, all: S[], indexForLayout = false): S[] {
  const hidden = (options as { [HIDDEN_SERIES]?: readonly string[] })[HIDDEN_SERIES];
  if (!hidden?.length) return all;
  const shown = all.filter((s) => !hidden.includes(s.id));
  if (!shown.length || shown.length === all.length) return all;
  if (indexForLayout) {
    // A hidden key shares its predecessor's index, the subtotal boundary after hiding it.
    let last = -1;
    for (const s of all) {
      if (s === shown[last + 1]) last++;
      s.lastVisibleIndex = last;
    }
  }
  return shown;
}

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

/**
 * The key entry of a series a reader hid with a legend click: the omitted look, under the series' own name. No
 * pattern, so it keys no scenario that a cell paints. A box key draws no level: the series' place in the legend
 * keeps two hidden entries apart for the collision check, which would call them indistinguishable.
 */
export function hiddenKey(id: Id, label: string, place: number): SeriesIdentity {
  return { id, label, paint: { token: 'inkMuted' }, hollow: true, level: place };
}
