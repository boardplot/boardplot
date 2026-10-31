import { nameIsDrawn, textNames, scatterGroupIdentities, scatterGroupNameIsDrawn } from '../seriesIdentity';
import type { DocLintWarning } from './index';
import { lineLabelModes } from '../charts/line/labelModes';
import type { LineOptions } from '../types/options';
import {
  cellNumber,
  categoriesOf,
  chartOptions,
  hasAuthoredFootnote,
  hasFormatOrUnit,
  isRecord,
  labelOf,
  legendEnabled,
  numericDataValues,
  scenarioCodes,
  seriesOf,
  warning,
  type LintRecord,
  type ScopedLintChart,
} from './shared';

export function runPartnerLints(charts: readonly ScopedLintChart[]): DocLintWarning[] {
  const warnings: DocLintWarning[] = [];

  for (const chart of charts) {
    // A kpi card states its message in its label and figure, so it needs no message title.
    if (!chart.requireMessageTitle || chart.type === 'kpi') continue;
    const title = chartOptions(chart).title;
    if (title === false) continue;
    if (
      typeof title !== 'string' ||
      title.trim() === '' ||
      isGenericTitle(title, [chart.type, chart.authoredType, chart.typeTitle])
    ) {
      warnings.push(
        warning(
          chart,
          'missing-message-title',
          'warn',
          'consulting titles carry the message; this title is missing or generic',
          'state the decision-relevant takeaway in options.title',
        ),
      );
    }
  }

  for (const chart of charts) {
    const options = chartOptions(chart);
    // A bump chart ranks a field and has its own entity limit (bump-series-limit).
    const applies = (chart.type === 'line' && options.variant !== 'bump') || (chart.type === 'column' && (options.variant === undefined || options.variant === 'grouped'));
    if (!applies) continue;
    const series = seriesOf(chart).filter((item) => item.role !== 'reference');
    if (series.length > 6) {
      warnings.push(
        warning(
          chart,
          'series-overload',
          'warn',
          `${series.length} data series exceed the 6-series readability limit`,
          'show the top series or facet the comparison',
        ),
      );
    }
  }

  for (const chart of charts) {
    if (chart.type !== 'column') continue;
    const options = chartOptions(chart);
    const labels = isRecord(options.labels) ? options.labels : {};
    const valueAxis = isRecord(options.valueAxis) ? options.valueAxis : {};
    const series = seriesOf(chart);
    const pyReferences = series.filter(
      (item) =>
        item.role === 'reference' &&
        typeof item.scenario === 'string' &&
        item.scenario.toUpperCase() === 'PY',
    );
    const integratedRequested =
      options.variant === 'stacked' &&
      valueAxis.percent !== true &&
      (options.referenceStyle === undefined || options.referenceStyle === 'tick') &&
      options.grandTotalLabels !== false &&
      options.labels !== false &&
      labels.grandTotal !== false &&
      labels.annotation !== false &&
      labels.tick !== false &&
      pyReferences.length === 1;
    if (!integratedRequested) continue;
    const periods = categoriesOf(chart).length;
    const components = series.filter((item) => item.role !== 'reference').length;
    if (periods <= 6 && components <= 4) continue;
    warnings.push(
      warning(
        chart,
        'integrated-stacked-variance-overload',
        'info',
        `integrated stacked variance has ${periods} periods and ${components} components; the readable maximum is 6 periods and 4 components`,
        'reduce periods/components or use the explicit dual-tier relative-variance grid',
      ),
    );
  }

  for (const chart of charts) {
    if (chart.type !== 'pie') continue;
    const categories = categoriesOf(chart);
    const options = chartOptions(chart);
    const topN = typeof options.topN === 'object' && options.topN !== null ? options.topN as Record<string, unknown> : { n: 5, rest: true };
    const n = typeof topN.n === 'number' && topN.n > 0 ? Math.floor(topN.n) : null;
    let effectiveCount = categories.length;
    // 'Other'/'Others', any case — the semantic, not the exact string
    const isOthers = (s: string | null | undefined) => /^others?$/i.test((s ?? '').trim());
    let hasOthers = categories.some(
      (category) => isOthers(labelOf(category)) || (typeof category.id === 'string' && isOthers(category.id)),
    );
    if (n !== null && categories.length > n) {
      effectiveCount = topN.rest === false ? n : n + 1;
      if (topN.rest !== false) hasOthers = true;
    }
    if (effectiveCount > 6 && !hasOthers) {
      warnings.push(
        warning(
          chart,
          'pie-too-many-slices',
          'warn',
          `${effectiveCount} pie slices without an 'Others' slice exceed the 6-slice readability limit`,
          "aggregate small slices into 'Others' or switch to a bar chart",
        ),
      );
    }
  }

  for (const chart of charts) {
    const options = chartOptions(chart);
    const legend = options.legend;
    if (chart.type === 'pie' || legend === 'auto' || !legendEnabled(legend)) continue;
    const series = seriesOf(chart);
    if (series.length === 1 && !(chart.type === 'line' && lineDirectlyNamesSeries(options, series[0]!, categoriesOf(chart), 1))) {
      warnings.push(
        warning(
          chart,
          'legend-redundant',
          'warn',
          'a forced legend repeats the only series',
          'turn the legend off and label the series directly',
          typeof series[0]!.id === 'string' ? { seriesId: series[0]!.id } : undefined,
        ),
      );
      continue;
    }
    const dataSeries = series.filter((item) => item.role !== 'reference');
    const categories = categoriesOf(chart);
    if (
      chart.type === 'line' &&
      dataSeries.length === series.length &&
      dataSeries.length > 0 &&
      dataSeries.every((item) => lineDirectlyNamesSeries(options, item, categories, dataSeries.length))
    ) {
      warnings.push(
        { ...warning(
          chart,
          'legend-redundant',
          'info',
          `options.legend repeats series names requested by ${options.seriesLabels !== undefined ? 'options.seriesLabels' : 'options.labels (or its default)'}`,
          'remove options.legend to use the direct names without the repeated key',
        ), fix: [{ op: 'remove', path: `${chart.path ?? ''}/options/legend` }] },
      );
    }
  }

  if (!charts.some(hasFormatOrUnit)) {
    const chart = charts.find((candidate) => numericDataValues(candidate).some((value) => Math.abs(value) >= 1000));
    if (chart) {
      warnings.push(
        warning(
          chart,
          'unlabeled-units',
          'warn',
          'values at or above 1000 have no format or unit anywhere in the document; readers must not guess magnitudes',
          'declare options.unit or a format-by-example',
        ),
      );
    }
  }

  for (const chart of charts) {
    if (!['column', 'bar', 'combo', 'line', 'dot', 'scatter'].includes(chart.type)) continue;
    const options = chartOptions(chart);
    const scatterGroups = chart.type === 'scatter' ? scatterGroupIdentities(chart.data, chart.geometry, chart.geometryPrefix) : undefined;
    if (chart.geometry) {
      const geometry = chart.geometry;
      const prefix = chart.geometryPrefix ?? '';
      const drawn: LintRecord[] = scatterGroups ? scatterGroups.map(group => ({ ...group })) : seriesOf(chart).filter(s => geometry.scene.some(node => node.t !== 'text' && node.part !== 'swatch' && (node.owner.seriesId === prefix + s.id || (node.owner.seriesId === s.id && node.id.startsWith(prefix)))));
      const unnamed = drawn.filter(s => {
        const group = scatterGroups?.find(group => group.id === s.id);
        return group ? !scatterGroupNameIsDrawn(geometry, group, prefix) : !nameIsDrawn(geometry, labelOf(s) ?? '', prefix + s.id);
      });
      if ((drawn.length > 1 && unnamed.length > 0) || unnamed.some(s => s.role === 'reference')) warnings.push(warning(chart,
        'series-unexplained', 'warn', `Drawn series ${unnamed.map(s => labelOf(s)).join(', ')} have no visible name`,
        'set options.legend to top, or show a direct label for each series'));
      continue;
    }
    if (legendEnabled(options.legend) || legendEnabled(chart.parentLegend) || drawsRequiredKey(chart)) continue;
    // The tornado variant paints its own legend from the layout — the low and
    // high case keys are mandatory anatomy, not an option — so this lint, which
    // can only see `options.legend`, reported `series-unexplained` on a DEFAULT
    // tornado while the legend was on the page. Suppressing it is covered from
    // the other side: an author who turns the legend off gets
    // `tornado-legend-suppressed` from the layout, which is the case this lint
    // was reaching for.
    if (options.variant === 'tornado') continue;
    const series: LintRecord[] = scatterGroups ? scatterGroups.map(group => ({ ...group })) : seriesOf(chart);
    const categories = categoriesOf(chart);
    const dataSeries = series
      .filter((s) => s.role !== 'reference')
      .filter((s) => chart.type !== 'line' || lineSeriesRenders(options, s, categories));
    const refSeries = series
      .filter((s) => s.role === 'reference')
      .filter((s) => chart.type !== 'line' || effectiveLineValues(options, s, categories).filter((v) => v !== null).length >= 2);
    const rawSubtitle = JSON.stringify(options.subtitle ?? '');

    // Scenario coding is identification too. FC/PL styling is
    // scenario-unexplained's beat (one warning per cause); any other code
    // (AC, PY, …) counts only when the subtitle actually carries it —
    // matched as an uppercase word, never as a substring ('AC' ≠ 'across').
    const canonicalScenario = (v: unknown): string | null => {
      if (typeof v !== 'string') return null;
      const u = v.toUpperCase();
      return u === 'FCST' ? 'FC' : u === 'BUD' ? 'PL' : u;
    };
    const scenarioIdentified = (s: LintRecord): boolean => {
      const code = canonicalScenario(s.scenario);
      if (code === null) return false;
      if (code === 'FC' || code === 'PL') return true;
      return new RegExp(`\\b${code}\\b`).test(rawSubtitle);
    };

    // Direct labeling counts as identification — but only where the chart
    // really renders series NAMES: line puts them at the ends or on the lines
    // (seriesLabels), or draws its key row for two or more unnamed series;
    // combo on the 'point' kind only when the author asks (its default
    // end label is the value). labels:false, the kind set to false, or a
    // content array without 'series' strip them.
    const endpointLabeled = (s: LintRecord): boolean => {
      if (chart.type === 'line') {
        const names = lineLabelModes(options as LineOptions, lineVariantOf(options), dataSeries.length).series;
        return names === 'key' || (names === 'none' && dataSeries.length >= 2 && (options.legend === undefined || options.legend === 'auto'))
          || lineDirectlyNamesSeries(options, s, categories, dataSeries.length);
      }
      if (chart.type === 'combo')
        return (s.kind === 'line' || s.kind === 'area') && kindKeepsSeriesNames(options, 'point', false);
      // Stacked columns name their layers at an edge column (seriesLabels).
      if (chart.type === 'column' && (options.variant === 'stacked' || options.variant === 'stacked100')) {
        const seriesLabels = options.seriesLabels as { only?: unknown } | undefined;
        if (seriesLabels === undefined) return false;
        return !Array.isArray(seriesLabels.only) || seriesLabels.only.includes(s.id);
      }
      return false;
    };

    // A scenario names a data series only when no other data series shares
    // it: two series both hatched as FC are told apart by fill alone, and
    // the hatch is then the only cue the key must explain.
    const scenarioCount = new Map<string | null, number>();
    for (const s of dataSeries) scenarioCount.set(canonicalScenario(s.scenario), (scenarioCount.get(canonicalScenario(s.scenario)) ?? 0) + 1);
    const identified = (s: LintRecord): boolean =>
      endpointLabeled(s) || (scenarioIdentified(s) && scenarioCount.get(canonicalScenario(s.scenario)) === 1);
    const unidentifiedData = dataSeries.filter((s) => !identified(s));
    const unexplainedRefs = refSeries.filter((s) => !scenarioIdentified(s));
    // ≥2 unidentified data series = grey-vs-grey ambiguity; a single data
    // series is carried by the title (legend-redundant even says so).
    const ambiguousData = unidentifiedData.length >= 2 ? unidentifiedData : [];
    if (ambiguousData.length === 0 && unexplainedRefs.length === 0) continue;
    const subject = ambiguousData.length
      ? `${ambiguousData.length} series${unexplainedRefs.length ? ' and a reference marker' : ''} are visually distinguished but never identified`
      : 'a reference marker is drawn as a bare stroke with nothing naming it';
    const isGridPanel = chart.displayName.includes('/');
    warnings.push(
      warning(
        chart,
        'series-unexplained',
        'warn',
        `${subject} — no legend, no direct labels`,
        isGridPanel
          ? 'enable legend on the grid options (one exhibit-level legend) or on this panel, or show direct series names'
          : 'enable options.legend, or show direct series names',
      ),
    );
  }

  for (const chart of charts) {
    const scenarios = scenarioCodes(chart);
    if (chart.geometry) {
      const names: Record<string, string> = { AC: 'actual', PY: 'prior year', PL: 'plan', FC: 'forecast' };
      const geometry = chart.geometry;
      const missing = [...scenarios].filter(code => {
        if (nameIsDrawn(geometry, code) || nameIsDrawn(geometry, names[code] ?? code)) return false;
        // Scenario notation can be explained in prose even though prose does not map series colours.
        if (geometry.scene.some(node => (node.part === 'subtitle' || node.part === 'footnote') &&
          (textNames(node, code) || textNames(node, names[code] ?? code)))) return false;
        // A series key already shows the scenario's styling under its authored name (for example, Target).
        return !seriesOf(chart).some(series => {
          const scenario = typeof series.scenario === 'string' ? series.scenario.toUpperCase() : '';
          if (scenario !== code && scenario !== (code === 'PL' ? 'BUD' : 'FCST')) return false;
          const ids = [series.id, `${chart.geometryPrefix ?? ''}${series.id}`];
          return geometry.scene.some(node => node.part === 'legendLabel' && ids.includes(node.owner.seriesId) && textNames(node, labelOf(series) ?? '')) &&
            geometry.scene.some(node => node.part === 'swatch' && ids.includes(node.owner.seriesId));
        });
      });
      if (missing.length > 0) warnings.push(warning(chart, 'scenario-unexplained', 'info',
        `${missing.join('/')} scenario styling has no visible explanation`, 'name the scenario in the key, subtitle or footnote'));
      continue;
    }
    const legendOff =
      !legendEnabled(chartOptions(chart).legend) && !legendEnabled(chart.parentLegend) && !drawsRequiredKey(chart);
    // Notation rule: the subtitle line "… · AC vs FC" IS the explanation —
    // a subtitle naming every used scenario code satisfies the rule
    const subtitle = JSON.stringify(chartOptions(chart).subtitle ?? '');
    const subtitleExplains =
      scenarios.size > 0 && [...scenarios].every((code) => subtitle.includes(code));
    if (scenarios.size > 0 && legendOff && !subtitleExplains && !hasAuthoredFootnote(chart)) {
      warnings.push(
        warning(
          chart,
          'scenario-unexplained',
          'info',
          `${[...scenarios].sort().join('/')} scenario styling is used with no legend or explanatory footnote`,
          'enable the legend or explain the scenario abbreviation in a footnote',
        ),
      );
    }
  }

  return warnings;
}

/**
 * Keys a chart draws whatever `legend` says: a waterfall's and an integrated
 * variance's (frame.ts legendRequired), and the legend of a grid whose
 * `legend: 'none'` would leave its panels' colours unnamed (legendPolicy.ts),
 * which is the case the lints here look for. A grid with a legend panel names
 * them there instead.
 */
function drawsRequiredKey(chart: ScopedLintChart): boolean {
  if (chart.displayName.includes('/')) return chart.parentLegend === 'none';
  return chart.type === 'waterfall' || (chart.type === 'variance' && chartOptions(chart).variant === 'integrated');
}

function kindKeepsSeriesNames(options: LintRecord, kind: string, namesByDefault = true): boolean {
  const labels = options.labels;
  if (labels === false) return false;
  if (typeof labels !== 'object' || labels === null) return namesByDefault;
  const value = (labels as LintRecord)[kind];
  if (value === false) return false;
  return Array.isArray(value) ? value.includes('series') : namesByDefault;
}

function lineVariantOf(options: LintRecord): 'line' | 'area' | 'stacked-area' | 'stacked100-area' | 'bump' {
  const valueAxis = isRecord(options.valueAxis) ? options.valueAxis : {};
  const variant = valueAxis.percent === true ? 'stacked100-area' : options.variant;
  return variant === 'area' || variant === 'stacked-area' || variant === 'stacked100-area' || variant === 'bump' ? variant : 'line';
}

/** Whether the line prints this series' name at its end or on its line, or in the values it prints. */
function lineDirectlyNamesSeries(
  options: LintRecord,
  series: LintRecord,
  categories: LintRecord[],
  count: number,
): boolean {
  const hasValue = effectiveLineValues(options, series, categories).some((value) => value !== null);
  if (!hasValue) return false;
  const modes = lineLabelModes(options as LineOptions, lineVariantOf(options), count);
  if ((modes.series === 'end' || modes.series === 'inline') && (modes.only === undefined || modes.only.has(series.id as string))) return true;
  return modes.values !== 'none' && kindKeepsSeriesNames(options, 'point', false);
}

function lineSeriesRenders(options: LintRecord, series: LintRecord, categories: LintRecord[]): boolean {
  const valueAxis = isRecord(options.valueAxis) ? options.valueAxis : {};
  const variant = valueAxis.percent === true ? 'stacked100-area' : options.variant ?? 'line';
  if (variant === 'stacked-area' || variant === 'stacked100-area') return categories.length >= 2;
  return effectiveLineValues(options, series, categories).some((value) => value !== null);
}

function effectiveLineValues(
  options: LintRecord,
  series: LintRecord,
  categories: LintRecord[],
): Array<number | null> {
  const entries = Array.isArray(series.values) ? series.values : [];
  const pointKeyed = entries.length > 0 && entries.every((entry) => isRecord(entry) && 'categoryId' in entry);
  const values = categories.map((category, index) => {
    const entry = pointKeyed
      ? entries.find((candidate) => isRecord(candidate) && candidate.categoryId === category.id)
      : entries[index];
    return cellNumber(isRecord(entry) && 'value' in entry ? entry.value : entry);
  });
  const rebase = options.rebase100;
  if (rebase === undefined || rebase === false) return values;
  const at = isRecord(rebase) && typeof rebase.at === 'string' ? rebase.at : categories[0]?.id;
  const baseIndex = categories.findIndex((category) => category.id === at);
  if (baseIndex < 0) return values;
  const base = values[baseIndex] ?? null;
  return base === null || base <= 0 ? values.map(() => null) : values;
}

function isGenericTitle(title: string, typeNames: (string | undefined)[]): boolean {
  const normalized = title.trim().toLowerCase();
  if (/^(?:chart|figure|untitled)\b/.test(normalized)) return true;
  return typeNames.some((typeName) => {
    if (!typeName) return false;
    const exact = typeName.trim().toLowerCase();
    if (normalized === exact) return true;
    const escapedType = exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `^${escapedType}(?:(?:\\s+(?:chart|plot|figure|card|\\d+))|(?:\\s*\\([^)]*\\))|(?:\\s*/\\s*[a-z0-9 /()-]+))?$`,
      'i',
    ).test(normalized);
  });
}
