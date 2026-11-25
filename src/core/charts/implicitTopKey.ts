import type { ChartOptions } from '../registry';
import { resolveTheme } from '../theme';
import type { ChartData, WaterfallData } from '../types/data';
import type { Geometry } from '../types/scene';

type Drawing = Geometry<object, object>;

function hasKey(drawing: Drawing): boolean {
  return drawing.mode === 'full' && !!drawing.legend?.items.length;
}

/** These builders already choose the same top key when its position is left open. */
export function implicitTopKey(type: string, input: unknown, options: ChartOptions): ((drawing: Drawing) => boolean) | undefined {
  const settings = options as ChartOptions & { variant?: string; signColor?: boolean; netLine?: unknown; widthSeriesId?: string };
  if (type === 'waterfall') {
    const data = input as WaterfallData | undefined;
    if ((resolveTheme(options.theme).legend?.required ?? 'top') !== 'top' || !data || !Array.isArray(data.items)) return;
    // Each case or segment names its paint in the required key. The chart uses the theme's position.
    if (Array.isArray(data.cases) && data.cases.length) return hasKey;
    const segments = new Set(data.items.flatMap(item => Array.isArray(item?.segments)
      ? item.segments.flatMap(part => typeof part?.id === 'string' && !part.id.startsWith('__') ? [part.id] : []) : []));
    if (segments.size) return drawing => hasKey(drawing) && drawing.legend!.items.some(item => segments.has(item.id));
    return;
  }
  const data = input as ChartData | undefined;
  if (!Array.isArray(data?.series) || data.series.some(series => !series || typeof series.id !== 'string')) return;
  if (type === 'mekko') {
    // A percent stack first tries direct names unless its labels are off. A bar uses another key policy.
    if (settings.variant !== 'stacked' && !((settings.variant ?? 'stacked100') === 'stacked100' && options.labels === false)) return;
    if (data.series.filter(series => series.role !== 'reference' && series.id !== settings.widthSeriesId).length > 1) return hasKey;
  }
  if (type === 'bar') {
    if (settings.variant === 'football-field' || settings.variant === 'tornado') return;
    if (settings.signColor === true) return hasKey;
    // A requested net line can be disabled during layout. Only a drawn net-line item certifies the implicit key.
    if (settings.netLine && !data.series.some(series => series.id === '__netLine')) {
      return drawing => hasKey(drawing) && drawing.legend!.items.some(item => item.id === '__netLine');
    }
  }
  if (type === 'dot' && !data.series.some(series => series.id === '__range') && data.series.some(series =>
    Array.isArray(series.values) && series.values.some(cell => cell && typeof cell === 'object' && 'range' in cell))) {
    // A drawn range brings the rail and every plotted series into the implicit top key.
    return drawing => hasKey(drawing) && drawing.legend!.items.some(item => item.id === '__range');
  }
}
