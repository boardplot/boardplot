import { dataOrder, markNotedLabels, NOTED_LABELS, withHiddenLabelNote } from '../../frame';
import { panelTypeClass } from '../../theme';
import type { ChartData } from '../../types/data';
import type { BaseOptions } from '../../types/options';
import type { Geometry } from '../../types/scene';
import { noteName } from '../../calendarData';

/**
 * The column totals whose seat a combo line end must leave free. The note pass sets it when a
 * line end lifted over the columns took a total's seat: a total drawn on the chart beats one
 * named in a note, and the line end still reads off its axis.
 */
const KEEP_TOTAL_SEATS = Symbol('keepTotalSeats');

/** The label kinds a hidden value is named for in the note. */
const NOTED_KINDS = ['segment', 'grandTotal', 'total', 'category'];

/** a hidden stack value or category needs a printed home at the target font size. */
export function withBandValueNotes<O extends Pick<BaseOptions, 'target' | 'theme'>, M extends object, D extends object>(
  data: ChartData,
  options: O,
  layout: (options: O) => Geometry<M, D>,
): Geometry<M, D> {
  let geo = layout(options);
  if (panelTypeClass(options) !== undefined) return geo;
  // Re-check before a note: a hidden total that a lifted line end displaced draws when that end leaves its seat.
  // Taken only when every such total draws and no other label the note would name is lost.
  const owed = (label: { kind: string; hidden?: unknown; noted?: boolean }) =>
    !label.noted && label.hidden === 'collision' && NOTED_KINDS.includes(label.kind);
  const totals = new Set(geo.labels.filter(label => label.kind === 'grandTotal' && owed(label)).map(label => label.id));
  if (totals.size > 0 && geo.labels.some(label => label.kind === 'point' && /^aboveColumn\d$/.test(label.slot ?? ''))) {
    const before = new Set(geo.labels.filter(owed).map(label => label.id));
    const kept = layout({ ...options, [KEEP_TOTAL_SEATS]: totals });
    if (kept.labels.every(label => !owed(label) || (before.has(label.id) && !totals.has(label.id)))) geo = kept;
  }
  let named = new Map<string, string>();
  const name = (rows: readonly { id: string; label?: string }[] | undefined, id: string | undefined) => {
    const row = rows?.find(item => item.id === id);
    return row ? noteName(row) : id;
  };
  for (let pass = 0; pass < 3; pass++) {
    const missing = geo.labels.filter(label => owed(label) && !named.has(label.id));
    if (missing.length === 0) break;
    for (const label of missing) {
      const series = name(data.series, label.owner.seriesId);
      const category = name(data.categories, label.owner.categoryId);
      named.set(label.id, label.noteText ?? (label.kind === 'category' ? label.text :
        `${series ? `${series} ` : ''}${label.text}${category ? ` (${category})` : ''}`));
    }
    const byData = dataOrder(data, geo.labels);
    named = new Map([...named].sort(([a], [b]) => byData(a, b)));
    const noteOptions = withHiddenLabelNote(options, named, { data, labels: geo.labels, annotations: (options as { annotations?: unknown }).annotations });
    geo = layout(noteOptions);
    markNotedLabels(geo, (noteOptions as unknown as { [NOTED_LABELS]: ReadonlySet<string> })[NOTED_LABELS], noteOptions);
  }
  return geo;
}
