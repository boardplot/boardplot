import type { Id } from './types/cell';
import type { SeriesIdentity } from './seriesIdentity';
import { HIDDEN_SERIES } from './hiddenSeriesKey';

/** The series of `all` the reader has not hidden: `all` itself when none is hidden or every one is. */
export function shownSeries<S extends { id: string }>(options: object, all: S[]): S[] {
  const hidden = (options as { [HIDDEN_SERIES]?: readonly string[] })[HIDDEN_SERIES];
  const shown = hidden ? all.filter((s) => !hidden.includes(s.id)) : all;
  return shown.length && shown.length < all.length ? shown : all;
}

/**
 * The key entry of a series a reader hid with a legend click: the omitted look, under the series' own name. No
 * pattern, so it keys no scenario that a cell paints. A box key draws no level: the series' place in the legend
 * keeps two hidden entries apart for the collision check, which would call them indistinguishable.
 */
export function hiddenKey(id: Id, label: string, place: number): SeriesIdentity {
  return { id, label, paint: { token: 'inkMuted' }, hollow: true, level: place };
}
