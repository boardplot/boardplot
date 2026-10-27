import type { LineDerived, LineMarks } from '../charts/line/layout';
import type { Geometry, LintWarning } from '../types/scene';
import { compareText } from '../text';
import { maxOf, minOf } from '../arrays';

const LINE_SERIES_SPAN_MIN_FRACTION = 0.05;
const LINE_SERIES_SPAN_MIN_EFFECTIVE_PX = 12;
const LINE_SERIES_CONTEXT_MIN_FRACTION = 0.25;
const LINE_SERIES_VALUE_VARIATION_MIN_RATIO = 0.25;

function effectiveScale(
  options: Record<string, unknown> | undefined,
  geometry: { size: { width: number } },
): number {
  const embed = options?.embed as { width?: unknown } | undefined;
  return typeof embed?.width === 'number' && embed.width > 0
    ? embed.width / geometry.size.width
    : 1;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Checks that depend on solved line geometry. */
export function lineIntegrityDocLints(
  type: string,
  options: Record<string, unknown> | undefined,
  geometry: Geometry<LineMarks, LineDerived>,
): LintWarning[] {
  if (type !== 'line' || geometry.warnings.some((warning) => warning.severity === 'error')) return [];
  const findings: LintWarning[] = [];
  const economy = geometry.derived.endpointLabelEconomy;
  if (economy?.overflow) {
    const legendPosition =
      options?.legend && typeof options.legend === 'object' && !Array.isArray(options.legend)
        ? (options.legend as { position?: unknown }).position
        : options?.legend;
    const horizontalLegendAllowed =
      legendPosition !== 'none' &&
      legendPosition !== 'right' &&
      (!options?.labelPlacements || Object.keys(options.labelPlacements as object).length === 0);
    // legend:'none' also disqualifies the short rung (its key would be a legend),
    // so series.shortLabel is not a usable repair there.
    const repairs = horizontalLegendAllowed
      ? 'Set series.shortLabel, move the legend to a horizontal band, or widen the canvas.'
      : legendPosition === 'none'
        ? "Shorten the series labels, drop legend: 'none' so a legend carries the names, or widen the canvas."
        : 'Set series.shortLabel, or widen the canvas.';
    findings.push({
      code: 'label-gutter-over-budget',
      severity: 'warn',
      message:
        `The end labels need ${economy.effectiveRequiredGutter.toFixed(1)} effective px of gutter, ` +
        `over the ${economy.effectiveBudget.toFixed(1)} px budget ` +
        `(${(economy.maxGutterFraction * 100).toFixed(0)}% of the width). ` +
        repairs,
      suggest: repairs,
    });
  }

  const variant = typeof options?.variant === 'string' ? options.variant : 'line';
  if ((variant !== 'line' && variant !== 'area') || geometry.plot.h <= 0) return findings;
  const scale = effectiveScale(options, geometry);
  const spans = geometry.marks.series.flatMap((series) => {
    if (series.points.length < 2) return [];
    const ys = series.points.map((point) => point.y);
    const spanSvg = maxOf(ys) - minOf(ys);
    return [{
      id: series.seriesId,
      fraction: spanSvg / geometry.plot.h,
      effectivePx: spanSvg * scale,
      relativeRange: geometry.derived.seriesValueStats[series.seriesId]?.relativeRange ?? 0,
    }];
  });
  const collapsed = spans.flatMap((series) => {
    if (
      series.effectivePx >= LINE_SERIES_SPAN_MIN_EFFECTIVE_PX &&
      series.fraction >= LINE_SERIES_SPAN_MIN_FRACTION
    ) return [];
    if (series.relativeRange < LINE_SERIES_VALUE_VARIATION_MIN_RATIO) return [];
    const contextSeries = spans
      .filter((candidate) => candidate.id !== series.id)
      .sort((a, b) => b.fraction - a.fraction || compareText(a.id, b.id))[0];
    if (!contextSeries || contextSeries.fraction < LINE_SERIES_CONTEXT_MIN_FRACTION) return [];
    return [{ series, contextSeries }];
  });
  if (collapsed.length > 0) {
    findings.push({
      code: 'series-span-collapsed',
      severity: 'warn',
      message:
        collapsed.map(({ series, contextSeries }) =>
          `Series '${series.id}' spans ${series.effectivePx.toFixed(1)} effective px and ` +
          `${percent(series.fraction)} of the plot ` +
          `(collapse thresholds: ${LINE_SERIES_SPAN_MIN_EFFECTIVE_PX} effective px or ` +
          `${percent(LINE_SERIES_SPAN_MIN_FRACTION)}), while its values vary by ` +
          `${percent(series.relativeRange)} of |mean| and '${contextSeries.id}' spans ` +
          `${percent(contextSeries.fraction)} ` +
          `(context threshold ${percent(LINE_SERIES_CONTEXT_MIN_FRACTION)}).`,
        ).join(' ') +
        ` Split unlike magnitudes into separate panels with 'grid', or mark the flat line ` +
        `with role 'reference'.`,
      suggest: "Split unlike magnitudes into separate panels with 'grid', or mark the flat line with role 'reference'.",
    });
  }
  return findings;
}
