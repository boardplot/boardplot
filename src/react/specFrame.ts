import { resolveTargetSize } from '../core/target';
import type { BaseOptions, LegendOptions, RenderTarget } from '../core/types/options';
import type { Theme, ThemeRef } from '../core/types/theme';
import type { BoardplotChartProps } from './spec';
import { useBoardplotTheme } from './themeContext';
import { chartSizing, contentSized, hostlessHeight, rowSizing } from '../core/sizing';
import { textScaleOf, textSizeOf } from '../core/typeFloors';
import { canvasMargin, resolveTargetTheme, themeForWidth } from '../core/theme';
import { themeForDensity } from '../core/themeDensity';
import { frameTextOptions, normalizeLegendOption, solveFrame } from '../core/frame';
import { defaultMeasurer } from '../core/text';
import { createOccupiedIndex } from '../core/label/occupied';
import { needsSeriesKey } from '../core/seriesIdentity';

/** Read only safe frame fields before validation, including from a broken spec. */
export function useSpecFrame(spec: unknown, host: Pick<BoardplotChartProps, 'size' | 'fallbackSize' | 'target' | 'theme' | 'fixedSize' | 'prepared'>) {
  const settings = useBoardplotTheme();
  const root = record(spec);
  const chart = Array.isArray(root.charts) ? record(root.charts.length === 1 ? root.charts[0] : undefined) : root;
  const raw = record(chart.options);
  const target = host.target ?? raw.target ?? settings.target;
  const input = host.size === 'container' ? host.fallbackSize : host.size ?? raw.size;
  const type = typeof chart.type === 'string' ? chart.type : undefined;
  const policy = chartSizing(type ?? '', raw);
  const theme = host.theme ?? raw.theme ?? chart.theme ?? root.theme ?? settings.theme;
  let size;
  try {
    const resolved = resolveTargetSize(target as RenderTarget, input as BaseOptions['size']);
    size = resolved.sizePx;
    if (type && !resolved.fixed.height && host.prepared?.kind !== 'svg') {
      size.height = hostlessHeight(policy, size.width, size.height, true);
      const data = record(chart.data);
      const rows = [data.categories, data.rows, data.tasks, data.items, data.steps].find(Array.isArray);
      if (rows?.length && contentSized(type, { size: input }, policy.fit)) {
        // A chart that sets textScale or textSize takes neither from the provider.
        const chartText = raw.textScale !== undefined || raw.textSize !== undefined ? { textScale: raw.textScale, textSize: raw.textSize } : { textScale: settings.textScale, textSize: settings.textSize };
        const textScale = textScaleOf({ ...chartText, target });
        const textSize = textSizeOf({ ...chartText, target });
        // Keep the first frame independent of lazy validation. Read only bounded, plain geometry data.
        const tokens = themeForWidth(themeForDensity(resolveTargetTheme(undefined, target as RenderTarget, textScale, textSize), settings.density, size.width), size.width);
        const authored = record(theme);
        const barRow = record(record(record(authored.overrides ?? authored).space).barRow);
        const series = Array.isArray(data.series) ? data.series : [];
        const legend = raw.legend ?? (needsSeriesKey(type, data, raw) ? 'top' : undefined);
        const frame = solveFrame({
          ...frameTextOptions({ ...raw, target, textScale, textSize: undefined } as BaseOptions),
          size, theme: tokens, measure: defaultMeasurer,
          margin: { ...canvasMargin(tokens, size.width), ...margin(raw.margin), ...margin(record(raw.canvas).margin) },
          ...(legend && legend !== 'none' && legend !== 'auto' ? { legend: {
            options: normalizeLegendOption(legend as LegendOptions | LegendOptions['position']),
            items: series.map(s => ({ id: s.id, label: s.label ?? s.id, paint: { token: 'ink' as const } })),
          } } : {}),
        }, createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height }));
        let pitch = 28 * textScale;
        if (type === 'bar') {
          if ((raw.variant ?? 'grouped') === 'grouped' && raw.labels !== false && record(raw.labels).point !== false) {
            const n = series.filter(s => s.role !== 'reference').length;
            const barsH = n * defaultMeasurer('0', tokens.type.label).height + Math.max(0, n - 1) * 4;
            pitch = Math.max(pitch, Math.ceil(barsH / (typeof raw.bandFraction === 'number' ? raw.bandFraction : 0.7)));
          }
          pitch = tokens.space.barRow?.pitch ?? pitch;
          if (typeof barRow.pitch === 'number' && barRow.pitch >= 4 && barRow.pitch <= 120
            && typeof barRow.thickness === 'number' && barRow.thickness >= 2 && barRow.thickness <= 96) pitch = barRow.pitch;
        }
        // shortcut: derived notes and chart-specific annotations need prepared geometry for an exact first frame.
        size.height = rowSizing(type, size, { chromeH: size.height - frame.plot.h + (frame.deficit ?? 0) + 8, minimumRowsH: 0, naturalRowsH: rows.length * pitch }).naturalHeight;
      }
    }
  }
  catch { size = resolveTargetSize(settings.target ?? 'report').sizePx; }
  const language = record(raw.locale).language ?? root.locale;
  const options = {
    target: target as RenderTarget,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    source: typeof raw.source === 'string' ? raw.source : undefined,
    locale: typeof language === 'string' ? { language } : undefined,
    margin: margin(raw.margin),
    canvas: { margin: margin(record(raw.canvas).margin) },
  };
  size = host.prepared?.kind === 'svg' ? host.prepared.result.size : size;
  return { options, size,
    fixedSize: host.fixedSize, theme: theme as Theme | ThemeRef | undefined };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function margin(value: unknown): BaseOptions['margin'] {
  const raw = record(value);
  return Object.fromEntries(['top', 'right', 'bottom', 'left'].flatMap(side =>
    Number.isFinite(raw[side]) ? [[side, raw[side]]] : []));
}
