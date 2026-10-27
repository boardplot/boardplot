import { DENSE_CATEGORY_COUNT } from '../../denseCharts';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import type { TextMeasurer } from '../../text';
import type { LabelDensity } from '../../types/options';

/** What the guaranteed values (first, last, highest, lowest) add to their priority. */
const GUARANTEED_BONUS = 10;

interface ValueDensityInput {
  /** How many categories the chart draws. */
  categories: number;
  /** Band width (column) or row height (bar) one value label has to fit in. */
  pitch: number;
  orientation: 'vertical' | 'horizontal';
  measure: TextMeasurer;
  /** In compact mode, the latest category's id: its values rank after the highlighted ones and before the rest. */
  last?: string;
}

/** What a value of the latest category adds to its priority: half a highlight, so a highlight still ranks first. */
const LATEST_BONUS = PRIORITY.highlightBonus / 2;

/**
 * 'smart' value labels (column, bar, combo columns) in a DENSE chart: more than
 * DENSE_CATEGORY_COUNT categories, or most labels wider than the pitch. Every
 * value stays eligible. The first, last, highest and lowest value (ties: the
 * first) rank above the others and keep the bounded one-step rule; a guaranteed
 * value without a seat is owed to the note. Any other value takes its natural
 * seat or none: it drops as `density` and the shared frame names or counts it
 * in the note. It never takes a seat nearer another mark than its
 * own. Authored, highlighted and pinned values keep their usual rank and never drop
 * quietly. A chart that is not dense, and 'full', change nothing: every value
 * keeps the one-step rule and, without a seat, is owed.
 */
export function rankValueLabels(
  requests: LabelRequest[],
  valueOf: (request: LabelRequest) => number | null | undefined,
  density: LabelDensity,
  pins: Record<string, string> = {},
  chart: ValueDensityInput,
): void {
  // The latest value is the one a reader looks for first; it wins a contested seat.
  if (chart.last !== undefined) for (const request of requests) {
    if (['point', 'segment', 'grandTotal', 'total'].includes(request.kind) && request.owner.categoryId === chart.last && request.owner.annotationId === undefined) request.priority += LATEST_BONUS;
  }
  if (density === 'full') return;
  const groups = new Map<string, { request: LabelRequest; value: number }[]>();
  for (const request of requests) {
    if (request.redundant || !['point', 'grandTotal'].includes(request.kind)) continue;
    const value = valueOf(request);
    if (value == null) continue;
    const key = `${request.kind}:${request.owner.seriesId ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push({ request, value });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const wide = group.filter(({ request }) => {
      const sizes = request.lines.map(line => chart.measure(line, request.font));
      return (chart.orientation === 'vertical' ? Math.max(...sizes.map(size => size.width)) : sizes.reduce((sum, size) => sum + size.height, 0)) > chart.pitch;
    }).length;
    if (chart.categories <= DENSE_CATEGORY_COUNT && wide <= group.length / 2) continue;
    const low = group.reduce((a, b) => b.value < a.value ? b : a);
    const high = group.reduce((a, b) => b.value > a.value ? b : a);
    const keep = new Set([group[0]!.request.id, group.at(-1)!.request.id, low.request.id, high.request.id]);
    for (const { request } of group) {
      if (keep.has(request.id)) request.priority += GUARANTEED_BONUS;
      else if (!request.keepWhenDense && !request.protect && !request.pinnedSlot && !pins[request.id]) {
        request.quietWhenCrowded = true;
        request.candidates = request.candidates.filter(c => !c.lastResort && !/Shifted|Step|Lifted/.test(c.slot));
      }
    }
  }
}
