import type { Id } from './types/cell';
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

/**
 * The key entry of a series a reader hid with a legend click: the omitted look, under the series' own name. No
 * pattern, so it keys no scenario that a cell paints. A box key draws no level: the series' place in the legend
 * keeps two hidden entries apart for the collision check, which would call them indistinguishable.
 */
export function hiddenKey(id: Id, label: string, place: number): SeriesIdentity {
  return { id, label, paint: { token: 'inkMuted' }, hollow: true, level: place };
}
