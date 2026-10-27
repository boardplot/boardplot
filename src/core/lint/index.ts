import type { Geometry } from '../types/scene';
import { keepsUnnamedSeriesKey, needsSeriesKey } from '../seriesIdentity';
import type { LintWarning } from '../types/scene';
import { getChart } from '../registry';
import { resolveTheme } from '../theme';
import type { ThemeRef } from '../types/theme';
import { runHonestyLints } from './honesty';
import { runPartnerLints } from './partner';
import { runDesignLints, type DesignWarning } from './design';
import { asRecord, isRecord, type ScopedLintChart } from './shared';
import { toJsonPointer } from '../diagnostics/jsonPatch';

export const lintCodes = [
  'partial-period-pairing',
  'basis-change',
  'non-additive-stack',
  'duplicate-category-labels',
  'spurious-precision',
  'missing-message-title',
  'series-overload',
  'integrated-stacked-variance-overload',
  'pie-too-many-slices',
  'legend-redundant',
  'unlabeled-units',
  'scenario-unexplained',
  'series-unexplained',
] as const;

export type LintCode = (typeof lintCodes)[number];
export interface DocLintWarning extends Omit<LintWarning, 'code'> {
  code: LintCode;
}

export interface LintChart {
  /** Resolved drawing supplied by render; input-only callers can omit it. */
  geometry?: Geometry;
  geometryPrefix?: string;
  name?: string;
  type: string;
  data: unknown;
  options?: Record<string, unknown>;
  annotations?: unknown[];
  /** Render supplies it: whether the drawn chart still draws at its size with these options changed, and raises no new warning code. */
  drawsWith?: (changed: Record<string, unknown>) => boolean;
}

export interface LintDocument {
  charts: readonly LintChart[];
}

/**
 * Central document lint runner. It observes authored input only and never
 * calls layout, normalization, or table resolution. Render can supply its final geometry.
 */
export function runDocLints(doc: LintDocument, includePaths = false): DocLintWarning[] {
  const charts = flattenCharts(doc.charts, includePaths);
  return [...runHonestyLints(charts), ...runPartnerLints(charts)];
}

/**
 * The design advice of the drawn charts (lint/design.ts): at most
 * ADVICE_PER_RENDER warnings of severity `advice`. Render passes the geometry.
 */
export function runDocAdvice(doc: LintDocument, includePaths = false): DesignWarning[] {
  return runDesignLints(flattenCharts(doc.charts, includePaths));
}

function flattenCharts(charts: readonly LintChart[], includePaths: boolean): ScopedLintChart[] {
  const flattened: ScopedLintChart[] = [];
  charts.forEach((chart, index) => {
    const displayName = chart.name?.trim() || `${chart.type}-${index + 1}`;
    visit(chart, displayName, true, flattened, undefined, includePaths ? `/charts/${index}` : undefined);
  });
  return flattened;
}

function visit(
  chart: LintChart,
  displayName: string,
  requireMessageTitle: boolean,
  output: ScopedLintChart[],
  parentLegend?: unknown,
  path?: string,
  dataPath = path === undefined ? undefined : `${path}/data`,
): void {
  const definition = getChart(chart.type);
  const canonicalChart = {
    ...chart,
    type: definition?.type ?? chart.type,
    options: requireMessageTitle ? automaticLegendOptions(chart.options, chart.type, chart.data) : chart.options,
  };
  output.push({
    ...canonicalChart,
    displayName,
    requireMessageTitle,
    authoredType: chart.type,
    typeTitle: definition?.title,
    parentLegend,
    path,
  });
  if (canonicalChart.type !== 'grid') return;

  const data = asRecord(canonicalChart.data);
  const parentFootnotes = Array.isArray(canonicalChart.options?.footnotes)
    ? canonicalChart.options.footnotes
    : undefined;
  // The grid's subtitle line speaks for every panel (notation rule: notation once,
  // at the exhibit level) — panels inherit it for explanation-type lints.
  const parentSubtitle = canonicalChart.options?.subtitle;
  const parentPalette = canonicalChart.options?.palette;
  const gridLegend = canonicalChart.options?.legend;
  if (Array.isArray(data.panels)) {
    // Preserve existing fallback names while paths retain authored array indexes.
    let recordIndex = -1;
    data.panels.forEach((panel, index) => {
      if (!isRecord(panel)) return;
      recordIndex += 1;
      if (typeof panel.type !== 'string') return;
      const id = typeof panel.id === 'string' ? panel.id : `panel-${recordIndex + 1}`;
      visit(
        {
          name: id,
          geometry: chart.geometry, geometryPrefix: `${chart.geometryPrefix ?? ''}${id}/`,
          type: panel.type,
          data: panel.data,
          options: inheritExplanations(panel.options, parentFootnotes, parentSubtitle, parentPalette),
          annotations: Array.isArray(panel.annotations) ? panel.annotations : undefined,
        },
        `${displayName}/${id}`,
        false,
        output,
        gridLegend,
        dataPath === undefined ? undefined : `${dataPath}/panels/${index}`,
      );
    });
    return;
  }

  const repeat = asRecord(data.repeat);
  const template = asRecord(data.template);
  const bySlice = asRecord(asRecord(template.data).bySlice);
  if (typeof template.type !== 'string' || !Array.isArray(repeat.values)) return;
  repeat.values.forEach((value, index) => {
    if (typeof value !== 'string' || !(value in bySlice)) return;
    const slicePath = dataPath === undefined ? undefined : `${dataPath}/template/data/bySlice${toJsonPointer([value])}`;
    // Same string substitution as expandRepeatPanels, before locating drawn ink.
    const id = typeof template.id === 'string' ? template.id.split(`$${repeat.dimension}`).join(value) : value;
    visit(
      {
        name: id,
        geometry: chart.geometry, geometryPrefix: `${chart.geometryPrefix ?? ''}${id}/`,
        type: template.type as string,
        data: bySlice[value],
        options: inheritExplanations(template.options, parentFootnotes, parentSubtitle, parentPalette),
        annotations: Array.isArray(template.annotations) ? template.annotations : undefined,
      },
      `${displayName}/${value || index + 1}`,
      false,
      output,
      gridLegend,
      slicePath,
      slicePath,
    );
  });
}

/** The theme switch has the same authored meaning as legend:'auto' on the outer exhibit. */
function automaticLegendOptions(options: LintChart['options'], type: string, data: unknown): LintChart['options'] {
  if (options?.legend === 'none' && keepsUnnamedSeriesKey(type)) return { ...options, legend: 'auto' };
  if (options?.legend !== undefined) return options;
  try {
    return (needsSeriesKey(type, data, options) || resolveTheme(options?.theme as ThemeRef | undefined).legend?.auto === true)
      ? { ...options, legend: 'auto' } : options;
  } catch {
    // Theme validation reports malformed themes; document lints remain input-only.
    return options;
  }
}

function inheritExplanations(
  options: unknown,
  parentFootnotes: unknown[] | undefined,
  parentSubtitle: unknown,
  parentPalette: unknown,
): Record<string, unknown> | undefined {
  const authored = isRecord(options) ? options : undefined;
  let merged = authored;
  if (authored?.footnotes === undefined && parentFootnotes !== undefined) {
    merged = { ...(merged ?? {}), footnotes: parentFootnotes };
  }
  if (authored?.subtitle === undefined && parentSubtitle !== undefined) {
    merged = { ...(merged ?? {}), subtitle: parentSubtitle };
  }
  if (authored?.palette === undefined && typeof parentPalette === 'string') {
    merged = { ...(merged ?? {}), palette: parentPalette };
  }
  return merged;
}
