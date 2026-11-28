import { HOST_CLAIMS } from '../../claims/ids';
import { staticFrame } from '../../footer';
import type { FrameResult } from '../../frame';
import { zeroLifts } from '../../formatPrecision';
import { disclosuresShown, withEngineNotes } from '../../notes';
import type { ChartOptions } from '../../registry';
import { COLLECT_IDENTITIES } from '../../seriesIdentity';
import { heightOmitted, PLOT_FLOOR_PX } from '../../sizing';
import { DEFAULT_TARGET } from '../../target';
import type { ChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';
import type { Geometry } from '../../types/scene';

export function keylessAreaFits(options: ChartOptions, frame: FrameResult, plot: { h: number }, height: number, printedDisclosure: boolean): boolean {
  return (frame.frame.minHeight ?? Infinity) <= height && (frame.frame.plotMinHeight ?? Infinity) <= height
    && (heightOmitted(options.size) || !disclosuresShown(options) || !printedDisclosure
      || plot.h >= PLOT_FLOOR_PX[options.target ?? DEFAULT_TARGET]);
}

/** A discarded trial keeps its notes, footer count and rounding lifts to itself. A throw gives `failed`. */
export function speculate<T>(run: () => T, failed: T): T {
  const counted = staticFrame.countable, lifts = zeroLifts.count;
  try { return withEngineNotes(run, true); } catch { return failed; } finally { staticFrame.countable = counted; zeroLifts.count = lifts; }
}

type MeasureBody = (data: ChartData, options: ColumnOptions, opening: number) => boolean;

/** A key item whose series no keyless label can name decides the coverage comparison. */
export function bandKeyFirst(measureBody: MeasureBody) {
  return (type: string, input: unknown, options: ChartOptions, opening: number) => {
    const data = input as ChartData | undefined;
    const band = options as ColumnOptions;
    if (!Array.isArray(data?.series) || data.series.length < 2 || !Array.isArray(data.categories) || !data.categories.length
      || HOST_CLAIMS in options || COLLECT_IDENTITIES in options || options.annotations?.length
      || band.seriesLabels || band.ribbons || band.anomaly || band.ratioTier || band.categoryLabels === 'staircase'
      || options.labels && Object.values(options.labels).some(setting => Array.isArray(setting) && setting.includes('series'))
      || data.categories.some(c => !c || c.partial)
      || data.series.some(s => !s || s.role === 'reference' || s.scenario || !Array.isArray(s.values)
        || s.values.some(cell => cell && typeof cell === 'object' && ('scenario' in cell || 'range' in cell)))) return;
    const categories = new Set(data.categories.map(c => c.id));
    const primary = data.series.filter(s => s.axis !== 'secondary');
    const secondary = data.series.filter(s => s.axis === 'secondary');
    const unnamed = new Set(data.series.filter(s => !categories.has(s.id) &&
      (type !== 'combo' || (s.axis === 'secondary' ? secondary : primary).length > 1)).map(s => s.id));
    if (!unnamed.size) return;
    if (!speculate(() => measureBody(data, band, opening), false)) return;
    return (key: Geometry<object, object>) => key.mode === (options.mode === 'compact' ? 'compact' : 'full') && !!key.legend?.items.some(item => unnamed.has(item.id))
      && (!staticFrame.pinned || staticFrame.countable || options.notes?.maxListed === 0);
  };
}
