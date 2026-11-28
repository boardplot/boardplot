import { panelTypeClass } from '../../theme';
import type { BaseOptions } from '../../types/options';
import type { PlacedLabel } from '../../types/scene';

/**
 * The column totals whose seats a combo line end must leave free.
 */
const KEEP_TOTAL_SEATS = Symbol('keepTotalSeats');

/** The label kinds that a total may displace. */
const BAND_LABELS = ['segment', 'grandTotal', 'total', 'category'];

export function keepBandTotals<O extends Pick<BaseOptions, 'target' | 'theme'>, G extends { labels: PlacedLabel[] }>(
  options: O,
  layout: (options: O) => G,
): G {
  const first = layout(options);
  let geo = first;
  if (panelTypeClass(options) !== undefined) return geo;
  // Give hidden totals their seats if the line ends can move without losing another label.
  const owed = (label: { kind: string; hidden?: unknown; noted?: boolean }) =>
    !label.noted && label.hidden === 'collision' && BAND_LABELS.includes(label.kind);
  const totals = new Set(geo.labels.filter(label => label.kind === 'grandTotal' && owed(label)).map(label => label.id));
  if (totals.size > 0 && geo.labels.some(label => label.kind === 'point' && /^aboveColumn\d$/.test(label.slot ?? ''))) {
    const before = new Set(geo.labels.filter(owed).map(label => label.id));
    const kept = layout({ ...options, [KEEP_TOTAL_SEATS]: totals });
    if (kept.labels.every(label => !owed(label) || (before.has(label.id) && !totals.has(label.id)))) geo = kept;
  }
  return geo;
}
