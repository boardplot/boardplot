import { chartString } from './strings';
import { hasCompleteTextWidths } from './fontMetrics/injected';
import { defaultMeasurer } from './text';
import { needsSeriesKey, scatterGroupIdentities, scatterGroupNameIsDrawn } from './seriesIdentity';
import { typeDocLints } from './lint/type';
import { compactOptions } from './compact';
import { FOOTNOTE_REFS, LEGEND_HEIGHT, UNIT_LINE, unitMissing, unitPrinted, type LegendBudget } from './frame';
import { furnitureBudget } from './aspect';
import { resolveSubtitle } from './normalize/shared';
import { getChart, type ChartCore, type ChartOptions } from './registry';
import { CARD_CLASS_WIDTH, FORCE_COMPACT, contentSized, declaredSizing, hostlessHeight, prepareFitLayout, type FitLayout } from './sizing';
import { EARLIER_PARTIAL_LEGEND_ID } from './partialPeriod';
import { panelTypeClass, resolveTheme } from './theme';
import type { LabelKind } from './types/options';
import type { Geometry, LayoutResult, SceneNode } from './types/scene';

/** Registered drawings that can bound the full chart without its automatic key. */
export const keylessFitBounds = new WeakMap<object, (
  type: string, data: unknown, options: ChartOptions, opening: number,
) => ((keyed: Geometry<object, object>) => boolean) | undefined>();

/** Internal layout marker; authored JSON cannot enable or retain it. */
export const AUTO_LEGEND = Symbol('autoLegend');

export function isAutomaticLegend(options: unknown): boolean {
  return (options as { [AUTO_LEGEND]?: unknown } | undefined)?.[AUTO_LEGEND] === true;
}

const ID_FIELDS = ['seriesId', 'segmentId', 'categoryId', 'pointId'] as const;
const REFERENCE_PARTS = new Set(['referenceLine', 'referenceTick', 'referenceMarker']);

export function normalizedName(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

interface LabelContext {
  type: string;
  data: unknown;
  options?: ChartOptions;
  prefix: string;
  panelTitleId?: string;
}

/** Use each grid's existing preparation to resolve explicit and repeated panels. */
function labelContexts(type: string, data: unknown, options?: ChartOptions, prefix = ''): LabelContext[] {
  const definition = getChart(type);
  type = definition?.type ?? type;
  if (type !== 'grid') return [{ type, data, options, prefix }];
  const prepared = definition?.prepare?.(data) ?? data;
  const panels = (prepared as { panels?: { id: string; type: string; data: unknown; options?: ChartOptions }[] } | undefined)?.panels;
  return Array.isArray(panels) ? panels.flatMap(panel => {
    const panelPrefix = `${prefix}${panel.id}/`;
    return labelContexts(panel.type, panel.data, panel.options, panelPrefix).map(context => ({
      ...context,
      ...(context.prefix === panelPrefix ? { panelTitleId: `${prefix}panel:${panel.id}:title` } : {}),
    }));
  }) : [];
}

function panelTitlesCoverSeries(body: SceneNode[], contexts: LabelContext[], id: string, name: RegExp): boolean {
  const panels = contexts.flatMap(context => {
    const series = (context.data as { series?: { id: string; role?: string }[] } | undefined)?.series;
    const primary = Array.isArray(series) ? series.filter(entry => entry.role !== 'reference') : [];
    return primary.some(entry => entry.id === id) ? [{ context, primary }] : [];
  });
  return panels.length > 0 && panels.every(({ context, primary }) => primary.length === 1 &&
    body.some(node => (node.id === `label:${context.panelTitleId}` ||
      (node.part === 'tierCaption' && node.id.startsWith(context.prefix))) &&
      node.t === 'text' && name.test(normalizedName(node.lines.join(' ')))));
}

function labelIncludesName(node: SceneNode, field: typeof ID_FIELDS[number], context: LabelContext | undefined, marks: SceneNode[]): boolean {
  if (!context) return false;
  const { type, options, prefix } = context;
  if (options?.labels === false) return false;
  const identity = field === 'seriesId' || field === 'segmentId' ? 'series' : 'category';
  const setting = options?.labels?.[node.part as LabelKind];
  if (setting === false) return false;
  if (node.part === 'axisTitle') return type === 'combo' && identity === 'series';
  if (Array.isArray(setting)) {
    // These layouts use point/segment settings only as visibility gates.
    if ((type === 'bar' || type === 'dot') && (node.part === 'point' || node.part === 'segment')) return false;
    return setting.includes(identity);
  }
  if (node.part === 'category') return identity === 'category';
  if (type === 'pie' && node.part === 'outsidePie' && identity === 'category') {
    return options?.labels?.category !== false && marks.filter((mark) => mark.part === 'slice' && mark.id.startsWith(prefix)).length <= 4;
  }
  // A combo end label is the value at its mark. It names the series
  // only when the author asks for it in `labels.point` (the array branch).
  if (node.part === 'point') return false;
  // A line's series label is its name and nothing else.
  return node.part === 'series' && identity === 'series';
}

/** A visible measure or unit can identify a chart's single primary series. */
function subtitleCoversSeries(geometry: Geometry<object, object>, data: unknown, options: ChartOptions | undefined, id: string, name: RegExp): boolean {
  const series = (data as { series?: { id: string; role?: string }[] } | undefined)?.series;
  const primary = Array.isArray(series) ? series.filter((entry) => entry.role !== 'reference') : [];
  if (primary.length !== 1 || primary[0]!.id !== id) return false;
  const subtitle = resolveSubtitle(options?.subtitle);
  if (!subtitle) return false;
  // A subtitle wider than the frame wraps onto a second text node, so
  // the name is read across every subtitle line, as the reader reads it. Only
  // the frame draws subtitle text, and a grid has no single series to name.
  const lines = geometry.scene.flatMap((entry) => (entry.t === 'text' && entry.part === 'subtitle' ? entry.lines : []));
  if (!name.test(normalizedName(lines.join(' ')))) return false;
  const descriptors = [subtitle.measure];
  if (unitPrinted({ subtitle, unit: options?.unit, unitShown: options?.unitShown })) descriptors.push(options!.unit!);
  return descriptors.some((text) => name.test(normalizedName(text)));
}

/** Rendered names replace optional keys; numeric or hidden labels cannot. */
export function legendIsCovered(baseline: Geometry<object, object>, candidate: Pick<Geometry, 'scene' | 'legend'>, data: unknown, options?: ChartOptions): boolean {
  const baselineItems = baseline.legend?.items ?? [];
  const onlyPartialKey = baselineItems.length === 1 && baselineItems[0]!.id === EARLIER_PARTIAL_LEGEND_ID;
  if (baselineItems.length && !onlyPartialKey && baseline.type !== 'scatter') return false;
  const body = baseline.scene.filter((node) => node.part !== 'legendLabel' && node.part !== 'swatch');
  if (body.some((node) => REFERENCE_PARTS.has(node.part))) return false;
  const marks = body.filter((node) => node.t !== 'text' && node.part !== 'labelSwatch');
  const contexts = labelContexts(baseline.type, data, options).sort((a, b) => b.prefix.length - a.prefix.length);
  const scatterGroups = baseline.type === 'scatter' ? scatterGroupIdentities(data, baseline) : [];
  const candidateItems = candidate.legend?.items ?? [];
  const seriesKeyCount = onlyPartialKey ? candidateItems.filter(item => item.id !== EARLIER_PARTIAL_LEGEND_ID).length : candidateItems.length;
  return candidateItems.every((item) => {
    // Existing size or trend keys remain; only the added group keys need direct names.
    if (baseline.legend?.items.some(existing => existing.id === item.id)) return true;
    const keyLabel = candidate.scene.find((node) => node.id === item.labelId);
    if (keyLabel?.t !== 'text') return false;
    const name = normalizedName(keyLabel.lines.join(' '));
    if (!name) return false;
    const group = scatterGroups.find(group => group.id === item.id);
    if (group) return scatterGroupNameIsDrawn(baseline, group);
    const field = ID_FIELDS.find((key) => marks.some((node) => node.owner[key] === item.id));
    if (!field) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fullName = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u');
    if (field === 'seriesId' && panelTitlesCoverSeries(body, contexts, item.id, fullName)) return true;
    if (seriesKeyCount === 1 && field === 'seriesId' &&
      subtitleCoversSeries(baseline, data, options, item.id, new RegExp(fullName.source, 'iu'))) return true;
    return body.some((node) => node.t === 'text' && node.owner[field] === item.id &&
      fullName.test(normalizedName(node.lines.join(' '))) &&
      labelIncludesName(node, field, contexts.find((context) => node.id.startsWith(context.prefix)), marks));
  });
}

/**
 * One data series is carried by the title; two or more colours, a reference
 * marker or a scenario key need their names.
 */
export function keysNeedNames(baseline: Geometry<object, object>, candidate: Geometry<object, object>): boolean {
  const items = candidate.legend?.items ?? [];
  return items.length > 1 || (items.length === 1 && !baseline.scene.some((node) => node.owner.seriesId === items[0]!.id));
}

/**
 * The measure a unit line names: the primary series, or two joined by "and".
 * More, or none, leave the unit to stand alone.
 */
function unitLineMeasure(data: unknown, options?: Pick<import('./types/options').BaseOptions, 'locale' | 'strings'>): string {
  const series = (data as { series?: { label?: unknown; role?: unknown }[] } | undefined)?.series;
  const names = Array.isArray(series)
    ? series.filter((entry) => entry?.role !== 'reference').map((entry) => (typeof entry.label === 'string' ? entry.label.trim() : ''))
    : [];
  return names.length > 0 && names.length <= 2 && names.every(Boolean) ? names.join(` ${chartString(options, 'and')} `) : '';
}

/**
 * Ask each chart's existing builder for its keys, preserving required
 * explanations; then the unit line: a chart that prints its declared
 * unit nowhere (no subtitle, axis title or label carries it) is laid out
 * once more with the unit printed where the subtitle goes. A grid panel is
 * left to its grid, whose subtitle speaks for it.
 */
/** Every note number the data refers to: any `footnote` a category, row, item or cell carries. */
function footnoteRefs(data: unknown): Set<number> {
  const refs = new Set<number>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'footnote' && typeof entry === 'number') refs.add(entry);
      else walk(entry, depth + 1);
    }
  };
  walk(data, 0);
  return refs;
}

export function layoutWithLegendPolicy<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options?: O,
): LayoutResult<M, DV> {
  const run = prepareLegendLayout(definition, data);
  try { return run(options); } finally { run.finish(); }
}

/** Explicit legend and unit-line variants; no frame content is a memo key. */
export function prepareLegendLayout<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, origins = new WeakMap<object, object>(),
): FitLayout<O, M, DV> {
  const baseline = prepareFitLayout(definition, data, origins);
  const candidate = prepareFitLayout(definition, data, origins);
  const unitBaseline = prepareFitLayout(definition, data, origins);
  const unitCandidate = prepareFitLayout(definition, data, origins);
  const compactLayouts = new Map<number, FitLayout<O, M, DV>>();
  const series = (data as { series?: { id: string; label?: string }[] } | undefined)?.series;
  const names = new Map(Array.isArray(series) ? series.map(item => [item.id, item.label ?? item.id]) : []);
  const refs = footnoteRefs(data);
  const draw = (options?: O): LayoutResult<M, DV> => {
    const automatic = names.size > 0 && !contentSized(definition.type, options) && panelTypeClass(options) === undefined
      && (options?.legend === undefined || options.legend === 'auto');
    if (automatic && (options as { [LEGEND_HEIGHT]?: LegendBudget })?.[LEGEND_HEIGHT] === undefined) {
      options = Object.assign({} as O, options, { [LEGEND_HEIGHT]: { height: 'auto', names } });
    }
    let result = layoutWithKeys(definition, data, options, baseline, candidate);
    if (!result.refused && panelTypeClass(options) === undefined && unitMissing(options as Record<string, unknown>, result)) {
      const withLine = layoutWithKeys(definition, data, Object.assign({} as O, options, { [UNIT_LINE]: unitLineMeasure(data, options) }), unitBaseline, unitCandidate);
      if (!withLine.refused) result = withLine;
    }
    if (!result.refused && result.legend && panelTypeClass(options) === undefined
      && (options as { [LEGEND_HEIGHT]?: LegendBudget })?.[LEGEND_HEIGHT]?.height === 'auto'
      && automatic) {
      const furniture = (geo: Geometry<M, DV>) => geo.size.height - (geo.frame.plotRect ?? geo.plot).h
        + ((geo.derived as { tickBand?: { reserved?: number } }).tickBand?.reserved ?? 0);
      const excess = furniture(result) - result.size.height * furnitureBudget(result.size.width);
      if (excess > 0 && excess < result.legend.rect.h && result.legend.items.every(item => {
        const label = result.scene.find(node => node.id === item.labelId);
        return label?.t === 'text' && names.get(item.id) === (label.title ?? label.lines.join(' '));
      })) {
        // Keep this canvas while returning the saved key space to the plot.
        const height = result.legend.rect.h - excess;
        let drawCompact = compactLayouts.get(height);
        if (!drawCompact) {
          drawCompact = prepareLegendLayout(definition, data, origins);
          compactLayouts.set(height, drawCompact);
        }
        const compact = drawCompact(Object.assign({} as O, options, { size: result.size, [LEGEND_HEIGHT]: { height, names } }));
        if (!compact.refused && furniture(compact) <= compact.size.height * furnitureBudget(compact.size.width) + 0.5) return compact;
      }
      // A cut key that still leaves the chart over its budget costs the names and saves too little.
      if (excess > 0.5 && result.legend.items.some(item => {
        const label = result.scene.find(node => node.id === item.labelId);
        return label?.t === 'text' && label.title !== undefined && label.title !== label.lines.join(' ');
      })) {
        let drawFull = compactLayouts.get(Infinity);
        if (!drawFull) {
          drawFull = prepareLegendLayout(definition, data, origins);
          compactLayouts.set(Infinity, drawFull);
        }
        const full = drawFull(Object.assign({} as O, options, { [LEGEND_HEIGHT]: { height: Infinity, names } }));
        if (!full.refused) return full;
      }
    }
    // The outer chart owns the scale. Grid child warnings would use the wrong
    // width and repeat in the parent.
    if (!result.refused && panelTypeClass(options) === undefined) {
      result.warnings.push(...typeDocLints(definition.type, options as Record<string, unknown>, result));
    }
    return result;
  };
  const run = ((options?: O) => {
    // An authored note nothing points at prints unnumbered.
    if (Array.isArray(options?.footnotes) && options.footnotes.length > 0) {
      options = Object.assign({} as O, options, { [FOOTNOTE_REFS]: refs });
    }
    // Grouped columns ignore seriesLabels (series-labels-ignored), so legend 'none' there
    // leaves the series unnamed: the key policy decides as it does for an unset legend.
    // The variant is the one the column resolves (valueAxis.percent makes it stacked100,
    // which draws its edge names). A key that makes the canvas too small is dropped, and
    // the key-less layout stays, as it was drawn before.
    const column = options as { variant?: string; seriesLabels?: unknown; valueAxis?: { percent?: boolean } } | undefined;
    if (definition.type === 'column' && options?.legend === 'none' && column?.seriesLabels !== undefined
      && !column.valueAxis?.percent && (column.variant ?? 'grouped') === 'grouped') {
      const keyed = draw(Object.assign({} as O, options, { legend: undefined }));
      if (!keyed.refused) {
        // The key on this drawing exists because seriesLabels is set, so its remove patch would take the key away.
        keyed.warnings = keyed.warnings.map((warning) => {
          if (warning.code !== 'series-labels-ignored') return warning;
          const { fix: _fix, ...kept } = warning;
          return kept;
        });
        return keyed;
      }
    }
    return draw(options);
  }) as FitLayout<O, M, DV>;
  run.finish = () => {
    baseline.finish(); candidate.finish(); unitBaseline.finish(); unitCandidate.finish();
    for (const draw of compactLayouts.values()) draw.finish();
    compactLayouts.clear();
  };
  return run;
}

function topKeyOptions<O extends ChartOptions>(type: string, options: O | undefined, mode: 'full' | 'compact' | undefined): O {
  const next = Object.assign({} as O, options, { [AUTO_LEGEND]: true });
  next.legend = 'top';
  if (type !== 'mekko') next.mode = mode;
  return next;
}

function layoutWithKeys<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options: O | undefined,
  fitBaseline: FitLayout<O, M, DV>, fitCandidate: FitLayout<O, M, DV>,
): LayoutResult<M, DV> {
  const requested = options?.legend === 'auto';
  const baselineOptions = requested ? { ...options, legend: undefined } as O : options;
  const size = baselineOptions?.size;
  const bound = keylessFitBounds.get(definition);
  let fullCandidate: LayoutResult<M, DV> | undefined;
  if (bound && baselineOptions && size && typeof size === 'object'
    && size.unit === undefined && size.width >= CARD_CLASS_WIDTH && hasCompleteTextWidths(baselineOptions.measure ?? defaultMeasurer)
    && baselineOptions.legend === undefined && !definition.requiredKey && baselineOptions.mode !== 'compact'
    && !(FORCE_COMPACT in baselineOptions) && panelTypeClass(options) === undefined) {
    const policy = declaredSizing(definition, baselineOptions);
    const opening = size.height ?? hostlessHeight(policy, size.width, policy.minHeight, true);
    if (size.width >= policy.minWidth && opening >= policy.minHeight) {
      const drawsKey = bound(definition.type, data, baselineOptions, opening);
      if (drawsKey && (requested || resolveTheme(options?.theme).legend?.auto === true || needsSeriesKey(definition.type, data, baselineOptions))) {
        const keyed = fullCandidate = fitCandidate(topKeyOptions(definition.type, baselineOptions, 'full'));
        if (!keyed.refused && drawsKey(keyed)) return keyed;
      }
    }
  }
  const baseline = fitBaseline(baselineOptions);
  // the grid core keeps its required key under legend 'none' and, unless the theme keys
  // automatically, with no legend set (gridRequiredKey in grid/gridKey.ts), so that code
  // stays out of the other React entries.
  if (!baseline.refused && definition.requiredKey && panelTypeClass(options) === undefined
    && (options?.legend === 'none' || (options?.legend === undefined && resolveTheme(options?.theme).legend?.auto !== true))) {
    return definition.requiredKey(baseline, data, options ?? {} as O, fitCandidate);
  }
  if (baseline.refused || (!requested &&
    (options?.legend !== undefined || panelTypeClass(options) !== undefined ||
      (resolveTheme(options?.theme).legend?.auto !== true && !needsSeriesKey(definition.type, data, options, baseline))))) return baseline;
  const candidateOptions = topKeyOptions(definition.type, baselineOptions, baseline.mode);
  const covering = definition.coveringKey?.(data, candidateOptions, baseline);
  if (covering && legendIsCovered(baseline, covering, data, baselineOptions)) return baseline;
  const candidate = fullCandidate && (baseline.mode === 'full' || definition.type === 'mekko') ? fullCandidate : fitCandidate(candidateOptions);
  if (candidate.refused) {
    // A refused probe supplies keys only. It never reaches claims or serialization.
    const probe = definition.layout(data, baseline.mode === 'compact'
      ? compactOptions(definition.type, candidateOptions) : candidateOptions);
    return !probe.refused && legendIsCovered(baseline, probe, data, baselineOptions) ? baseline : candidate;
  }
  if (!candidate.legend?.items.length) return baseline;
  const candidateIds = new Set(candidate.legend.items.map((item) => item.id));
  // The compact event key's entries (`__event…`) give way to a series key, so they do not hold the baseline.
  if (baseline.legend?.items.some((item) => !item.id.startsWith('__event') && !candidateIds.has(item.id))) return baseline;
  return legendIsCovered(baseline, candidate, data, baselineOptions) ? baseline : candidate;
}
