import { prepareFractionAnnotations, percentScaleWarnings } from './normalize/fraction';
import { colorVariableWarnings } from './colorVariables';
import { shownNoteKinds } from './notes';
import { getChart } from './registry';
import { chartSizing, compactFallbackApplies, declaredSizing, fitsSize, FIXED_SIZE_PROBE, FULL_LAYOUT_PROBE, SIZE_TOLERANCE, LAYOUT_CALL, type LayoutCall, plotFloorHeight, plotRepairHeight, resolveSizing, sizeRefusal, VERIFY_ADVICE, verifiedSizeRepair, WIDTH_PROBE } from './sizing';
import { EMPTY_DATA, hasNoDataRows } from './emptyData';
import { NormalizeError, canonicalLanguage } from './normalize/shared';
import { withNumberMarks } from './numberMarks';
import { chartRefusals, isRefused } from './schema/refusals';
import { REMOVED_NAMES, removedNameWarnings, resolveTargetTheme } from './theme';
import { DEFAULT_TARGET, resolveTargetSize } from './target';
import { textScaleOf, textSizeOf } from './typeFloors';
import { defaultMeasurer, type TextMeasurer } from './text';
import { drawnHeight } from './drawnHeight';
import { clippedTextWarnings } from './textClip';
import type { Size } from './geometry';
import type { Annotation } from './types/annotations';
import type { BaseOptions, LocaleSpec, RenderTarget, StringsSpec } from './types/options';
import type { Geometry, LayoutResult, LintWarning, RefusedLayout } from './types/scene';
import type { ResolvedSizing } from './types/sizing';
import type { Theme, ThemeRef } from './types/theme';
import type { GridMarks } from './grid/layoutGrid';
import type { InteractionScope } from './a11y/types';
import { addWhereAbsent } from './diagnostics/jsonPatch';
import { timeAnnotationAnchors } from './timeAxis';
import { retireChartSettings } from './retired';

/** Chart-specific options can replace these three shared fields. */
export type RequestOptions = Omit<BaseOptions, 'labels' | 'legend' | 'mode'> & {
  labels?: unknown;
  legend?: unknown;
  mode?: unknown;
};

/** Authored x anchors can be epoch milliseconds; chart layouts resolve them to category ids. */
export type RequestInputOptions = Omit<RequestOptions, 'annotations'> & { annotations?: Annotation<string | number>[] };

export interface RequestContext {
  target?: RenderTarget;
  /** Inherited text scale (options.textScale); a chart's own textScale or textSize wins. */
  textScale?: number;
  /** Inherited primary label size in px (options.textSize); a chart's own textSize or textScale wins. */
  textSize?: number;
  theme?: ThemeRef;
  /** Inherited locale. decimal and thousands set the marks of every number, and a format example gives only the shape; language changes words only. */
  locale?: LocaleSpec | string;
  /** Host wording for renderer-composed labels; an explicit chart option wins per key. */
  strings?: StringsSpec;
}

/**
 * The keys a layout may read. The provider's block also carries host-only
 * wording such as the refusal message, which never reaches a layout: dropping
 * it keeps `options.strings` inside the chart option schema.
 */
// Exhaustive over the public type, without pulling schema validation into React bundles.
const LAYOUT_STRING_KEYS = Object.keys({
  newItems: true, lostItems: true, cohortMeasure: true, cohortFormula: true,
  others: true, total: true, source: true, notApplicable: true, legendCount: true, partial: true,
  better: true,
  worse: true,
  positiveTotal: true,
  rangeMidNote: true,
  sensitivityNote: true,
  hatchedBaseNote: true,
  missingSwingNote: true,
  rankOmitted: true,
  noRank: true,
  rankMethod: true,
  higherBetter: true,
  lowerBetter: true,
  rankFormat: true,
  rankRing: true,
  nearZeroNote: true,
  flagged: true,
  corridor: true,
  corridorBounds: true,
  median: true,
  anomalySmallSample: true,
  anomalyZeroMad: true,
  anomalyMadRule: true,
  anomalyCentreZero: true,
  anomalyCentreMedian: true,
  anomalyThresholdRule: true,
  outsideBounds: true,
  belowBound: true,
  aboveBound: true,
  lowerBound: true,
  upperBound: true,
  undrawnBounds: true,
  hiddenLabels: true,
  noteOne: true,
  noteMany: true,
  notesAndSources: true,
  close: true,
  mapCredit: true,
  gapBetween: true,
  aboveSeries: true,
  belowSeries: true,
  average: true,
  valueLineRange: true,
  toDate: true,
  forecast: true,
  plan: true,
  forecastHeader: true,
  net: true,
  incomplete: true,
  range: true,
  valuesNotOnColumns: true,
  valuesNotBesideMarks: true,
  partialTotals: true,
  knownPartsTotals: true,
  without: true,
  and: true,
  aboveZero: true,
  belowZero: true,
  declaredBounds: true,
  tied: true,
  tiedSymbol: true,
  currentValue: true,
  baseCase: true,
  swingOutsideBase: true,
  fanGap: true,
  mixedShares: true,
  heatBelow: true, heatAround: true, heatAbove: true, target: true,
  actualColumn: true, shareColumn: true, deltaColumn: true, targetColumn: true, gapColumn: true, gapBelow: true, gapAbove: true, gapOn: true, cellNote: true, bandKey: true, moreListed: true,
  storyBack: true, storyNext: true, storyCounter: true, storyStep: true, axisLow: true, axisHigh: true,
  nearZeroChange: true, mixedCoverage: true, hiddenPeriods: true,
  share: true, histogramBins: true, histogramAbout: true, histogramMethod: true,
  histogramRuleCount: true, histogramRuleWidth: true, histogramSnapped: true,
  histogramRounded: true, histogramSmallSample: true,
  missingStack: true, incompleteStacks: true, knownPartsShares: true, rebaseZero: true, rebaseMissing: true,
} satisfies Record<keyof StringsSpec, true>) as (keyof StringsSpec)[];

function layoutStrings(...sources: (StringsSpec | undefined)[]): StringsSpec | undefined {
  const merged: StringsSpec = {};
  for (const source of sources) {
    if (!source) continue;
    for (const key of LAYOUT_STRING_KEYS) {
      const value = source[key];
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export interface ChartRequest<D = unknown, O extends Omit<RequestOptions, 'annotations'> = RequestInputOptions> extends RequestContext {
  type: string;
  /** Stable host identity for headless interaction records. Defaults to the canonical type. */
  scope?: InteractionScope;
  data: D;
  options?: O;
  /** Top-level fields override the corresponding option, including an empty list. */
  annotations?: Annotation<string | number>[];
  size?: BaseOptions['size'];
  /** A deterministic custom measurer. Omit to use the bundled font tables. */
  fontMetrics?: 'bundled' | TextMeasurer;
}

export interface ResolvedChartRequest<D = unknown, O extends RequestOptions = RequestOptions> {
  type: string;
  target: RenderTarget;
  scope: InteractionScope;
  data: D;
  options: O;
  annotations: Annotation[];
  /** Input-unit warnings, computed before fraction normalization removes the declaration. */
  inputWarnings?: LintWarning[];
  theme: Theme;
  locale?: LocaleSpec;
  fontMetrics: TextMeasurer;
  /**
   * The starting frame in layout px. `fixed` states which sides are pinned.
   * An automatic content-fit chart can change this frame during layout.
   * Resolving does not run layout; final dimensions belong to geometry.size.
   */
  size: Size;
  fixed: { width: boolean; height: boolean };
}

/** Defaults, inherited context, chart options, then explicit request fields. */
export function resolveChartRequest<D, O extends object>(
  input: ChartRequest<D, O & RequestInputOptions>,
  context: RequestContext = {},
): ResolvedChartRequest<D, O & RequestOptions> {
  const def = getChart(input.type);
  if (!def) throw new NormalizeError('unknown-type', 'type', `unknown chart type '${input.type}'`);
  // A caller that skipped validation (a per-type React entry) still draws a retired setting as validation does.
  const retired = retireChartSettings(def.type, input, (name) => getChart(name)?.type);
  input = retired.chart;
  const inheritedLocale = typeof context.locale === 'string' ? { language: context.locale } : context.locale;
  const options = Object.assign(Object.create(null) as O & RequestOptions, def.defaults, {
    ...(context.theme === undefined ? {} : { theme: context.theme }),
    ...(inheritedLocale ? { locale: inheritedLocale } : {}),
    ...Object.fromEntries(Object.entries(input.options ?? {}).filter(([, value]) => value !== undefined)),
    ...(input.theme === undefined ? {} : { theme: input.theme }),
    ...(input.locale === undefined ? {} : {
      locale: typeof input.locale === 'string' ? { language: input.locale } : input.locale,
    }),
    ...(input.size === undefined ? {} : { size: input.size }),
    ...(input.annotations === undefined ? {} : { annotations: input.annotations }),
    ...(input.fontMetrics === undefined ? {} : { measure: input.fontMetrics === 'bundled' ? defaultMeasurer : input.fontMetrics }),
  });
  if (def.type === 'line' && (options as { xAxis?: { type?: string } }).xAxis?.type === 'time' && options.annotations) {
    // Records and hover cards read this request too, before the layout resolves its own anchors.
    options.annotations = options.annotations.map(annotation => timeAnnotationAnchors(annotation) as Annotation);
  }
  options.annotations = prepareFractionAnnotations(options.annotations);
  const target = input.target ?? input.options?.target ?? context.target ?? DEFAULT_TARGET;
  options.target = target;
  // A chart that sets textScale or textSize takes neither from the context; both together are refused below.
  const chartScale = input.textScale ?? input.options?.textScale;
  const chartSize = input.textSize ?? input.options?.textSize;
  const chartOwnsText = chartScale !== undefined || chartSize !== undefined;
  const scale = chartOwnsText ? chartScale : context.textScale;
  const pinnedSize = chartOwnsText ? chartSize : context.textSize;
  if (scale !== undefined) options.textScale = scale;
  if (pinnedSize !== undefined) options.textSize = pinnedSize;
  const textScale = textScaleOf(options);
  const textSize = textSizeOf(options);
  // unsized cards keep their content sizing under physical targets.
  const sizeTarget = options.size === undefined && ['kpi', 'bullet', 'sparkline'].includes(def.type)
    && (target === 'slide' || target === 'print') ? 'report' : target;
  const resolvedSize = resolveTargetSize(sizeTarget, options.size);
  const language = options.locale?.language;
  if (language !== undefined) {
    const canonical = canonicalLanguage(language);
    if (canonical === null) {
      throw new NormalizeError('invalid-locale', 'options.locale.language', `'${language}' is not a BCP 47 language tag`, 'use a tag such as "de" or "de-DE"');
    }
    if (canonical !== language) options.locale = { ...options.locale, language: canonical };
  }
  // The entry of every chart request: from here `locale.language` carries the chart's number marks (numberMarks.ts).
  options.locale = withNumberMarks(options).locale;
  const theme = resolveTargetTheme(options.theme, target, textScale, textSize);
  // The provider block is inherited; an explicit chart option wins per key, and
  // host-only keys never reach the layout.
  const strings = layoutStrings(context.strings, (input.options as { strings?: StringsSpec } | undefined)?.strings);
  if (strings === undefined) delete options.strings;
  else options.strings = strings;
  const fontMetrics = options.measure ?? defaultMeasurer;
  options.measure = fontMetrics;
  const data = prepared(def, input.data, options) as D;
  const inputWarnings = [...retired.warnings, ...requestInputWarnings(def.type, def.type === 'grid' ? data : input.data, options),
    ...colorVariableWarnings(input.data, options.theme)];
  return {
    ...(inputWarnings.length ? { inputWarnings } : {}),
    type: def.type,
    target,
    scope: input.scope ?? { chart: def.type },
    data,
    options,
    annotations: options.annotations ?? [],
    theme,
    locale: options.locale,
    fontMetrics,
    size: resolvedSize.sizePx,
    fixed: resolvedSize.fixed,
  };
}

/**
 * The data a layout reads. A prepare step that finds nothing to prepare (a chart with an
 * empty data collection) leaves the data as it is, and the layout then refuses it with
 * the same `empty-data` code, so the code has one source in every type.
 */
function prepared(def: { prepare?: (data: any, options?: any) => any }, data: unknown, options?: unknown): unknown {
  if (!def.prepare) return data;
  try { return def.prepare(data, options); }
  catch (error) {
    if (error instanceof NormalizeError && error.code === EMPTY_DATA) return data;
    throw error;
  }
}

/** The same registered layout used by components, measurement and artifacts. */
export function layoutResolvedRequest(request: ResolvedChartRequest): LayoutResult {
  const result = layoutOnce(request);
  const plainRequest = withoutAskedNotes(request, result);
  const plain = plainRequest && layoutOnce(plainRequest);
  return withClipWarnings(plain && !plain.refused ? askedNotesOff(plain, result) : result, request.fontMetrics);
}

/** The drawn result names every text the canvas cuts (textClip.ts); a refusal draws nothing. */
function withClipWarnings(result: LayoutResult, measure: TextMeasurer): LayoutResult {
  if (result.refused) return result;
  const clipped = clippedTextWarnings(result as Geometry, measure);
  return clipped.length ? { ...result, warnings: [...result.warnings, ...clipped] } : result;
}

function layoutOnce(request: ResolvedChartRequest): LayoutResult {
  const run = preparedLayout(request);
  try { return drawnAdvice(request, run(request.options), run); } finally { run.finish(); }
}

/**
 * A pinned canvas too small for the notes a spec asks for by methodNote or notes.placement
 * draws as without them; they stay in the notes list. An authored notes.show refuses as before.
 */
function withoutAskedNotes(request: ResolvedChartRequest, result: LayoutResult): ResolvedChartRequest | undefined {
  const options = request.options as Parameters<typeof shownNoteKinds>[0] & RequestOptions;
  if (!result.refused || result.warnings[0]?.code !== 'size-below-floor' || !request.fixed.height
    || options.notes?.show !== undefined || shownNoteKinds(options) === undefined) return undefined;
  return { ...request, options: { ...request.options, notes: { ...options.notes, show: ['note'] } } as typeof request.options };
}

function askedNotesOff(plain: LayoutResult, refused: LayoutResult): LayoutResult {
  const height = (refused.warnings[0]!.expected?.minimum as Size | undefined)?.height;
  return { ...plain, warnings: [...plain.warnings, {
    code: 'footnotes-off', severity: 'info',
    message: 'the pinned height has no room for the notes methodNote or notes.placement asks for; they are in the notes list',
    suggest: `Leave the height out${height === undefined ? '' : `, or give the chart ${height} px of height`}.`,
  }] };
}

/**
 * An open height grows with the width, so a size refusal at an open height advises the width alone.
 * The width the registry names can stand above the narrowest one that draws (a narrow diagram card
 * reads under its static floor), so the advice is the narrowest whole pixel that draws in full, the
 * same width measure names. The height is the one drawn there. A pinned height keeps the pair.
 */
function drawnAdvice(request: ResolvedChartRequest, result: LayoutResult, layoutAt: LayoutCall<any, any, any>): LayoutResult {
  const finding = result.refused ? result.warnings[0] : undefined;
  const need = finding?.code === 'size-below-floor' ? finding.expected?.minimum as Size | undefined : undefined;
  if (!result.refused || !need || request.fixed.height || need.width <= result.size.width) return result;
  // The same bounds as measure: a floor the chart declares statically is not searched under, and a width at it is the answer.
  // The advice is still width-only there, as everywhere else.
  const def = getChart(request.type);
  const staticMinWidth = def === undefined ? 0 : declaredSizing(def, request.options).minWidth;
  const floorOptions = request.type === 'table' || request.type === 'dimswitch' ? {} : { belowMinimum: 'refuse' as const };
  const fullAt = (width: number): Geometry | undefined => {
    const probe = layoutAt.probe({ ...request.options, ...floorOptions, size: { width }, [WIDTH_PROBE]: request.type });
    return !isRefused(probe) && (probe as Geometry).mode !== 'compact' ? probe as Geometry : undefined;
  };
  // One probe one pixel under the registry width ends the search when nothing narrower draws; a layout
  // is made for each step of the search only when it does.
  let drawn = need.width <= staticMinWidth ? undefined : fullAt(need.width - 1);
  let [low, high] = [Math.max(Math.ceil(result.size.width), staticMinWidth) - 1, drawn ? need.width - 1 : need.width];
  while (drawn && high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const probe = fullAt(mid);
    if (probe) [high, drawn] = [mid, probe];
    else low = mid;
  }
  const width = high;
  const height = drawn ? Math.max(Math.ceil(drawn.size.height), Math.ceil(result.sizing.minHeight)) : need.height;
  const advice = sizeRefusal(result.type, result.title, result.size, { ...result.sizing, minWidth: width, minHeight: height }).warnings[0]!;
  const warning = {
    ...advice,
    message: `${result.title} needs at least ${width}px of width; received ${Math.round(result.size.width)}px`,
    suggest: `Render it at ${width}px wide or wider; the height follows the width.${result.sizing.hint ? ` ${result.sizing.hint}` : ''}`,
    fix: [{ op: 'replace' as const, path: '/options/size', value: { width } }],
  };
  return { ...result, warnings: [warning, ...result.warnings.slice(1)] };
}

/** Grid children use the registered layout directly, so request diagnostics walk their authored input here. */
function inputPanels(data: unknown): { id: string; type: string; data: unknown; options?: RequestOptions }[] {
  const input = data as { panels?: unknown } | null;
  const normalized = Array.isArray(input?.panels) ? input : prepared(getChart('grid') ?? {}, data) as { panels?: unknown };
  return Array.isArray(normalized?.panels) ? normalized.panels : [];
}

function requestInputWarnings(type: string, data: unknown, options: RequestOptions): LintWarning[] {
  if (type !== 'grid') return percentScaleWarnings(data, options, type);
  return inputPanels(data).flatMap(panel => {
    const definition = getChart(panel.type);
    // Resolve defaults while the alias is still known, as the child layout does.
    return requestInputWarnings(definition?.type ?? panel.type, panel.data, { ...definition?.defaults, ...panel.options })
      .map(warning => ({ ...warning, message: `[${panel.id}] ${warning.message}` }));
  });
}

function stackPaletteWarnings(type: string, data: unknown, options: RequestOptions, geometry: Geometry): LintWarning[] {
  if (type === 'grid') {
    const panels = (geometry.marks as unknown as GridMarks).panels;
    if (!Array.isArray(panels)) return [];
    return inputPanels(data).flatMap(panel => {
      const child = panels.find(item => item.id === panel.id)?.chart?.geometry;
      return child ? stackPaletteWarnings(child.type, panel.data, { ...panel.options, theme: panel.options?.theme ?? options.theme }, child)
        .map(warning => ({ ...warning, message: `[${panel.id}] ${warning.message}` })) : [];
    });
  }
  const ref = options.theme;
  const color = typeof ref === 'object' ? ref.overrides?.color : undefined;
  if (type !== 'column' || color?.series === undefined || color.stack !== undefined ||
    !geometry.scene.some(node => 'fill' in node && node.fill && 'theme' in node.fill && node.fill.theme?.kind === 'stack-ramp')) return [];
  return [{ code: 'stack-palette-used', severity: 'warn',
    message: 'Stacked columns use color.stack for plain series. The color.series override does not set that ramp.',
    suggest: 'Set theme.overrides.color.stack, or set options.palette or a fill on each series.',
  }];
}

/** Prepare the registry once for this call; probes change only its frame and mode markers. */
function preparedLayout(request: ResolvedChartRequest, verifyAdvice = false): LayoutCall<any, any, any> {
  const def = getChart(request.type);
  if (!def) throw new NormalizeError('unknown-type', 'type', `unknown chart type '${request.type}'`);
  const ref = request.options.theme;
  const options = {
    ...request.options,
    theme: { preset: typeof ref === 'string' ? ref : ref?.preset ?? 'boardroom', overrides: request.theme },
    [REMOVED_NAMES]: removedNameWarnings(request.options),
    ...(verifyAdvice ? { [VERIFY_ADVICE]: true } : {}),
  };
  const warnings = request.inputWarnings ?? [];
  const run = def[LAYOUT_CALL]?.(request.data, options);
  const disclose = (result: LayoutResult): LayoutResult => {
    if (result.refused) return result;
    const extra = [...warnings, ...stackPaletteWarnings(request.type, request.data, request.options, result)];
    return extra.length ? { ...result, warnings: [...result.warnings, ...extra] } : result;
  };
  const at = ((frame: RequestOptions) => {
    if (!run) return disclose(def.layout(request.data, { ...frame, theme: options.theme, [REMOVED_NAMES]: options[REMOVED_NAMES] }));
    const current: Record<PropertyKey, unknown> = { ...options, [LAYOUT_CALL]: run };
    for (const key of ['size', 'mode', 'belowMinimum', FULL_LAYOUT_PROBE, WIDTH_PROBE, FIXED_SIZE_PROBE] as const) {
      if (Object.hasOwn(frame, key)) current[key] = (frame as RequestOptions & Record<PropertyKey, unknown>)[key];
      else delete current[key];
    }
    return disclose(def.layout(request.data, current));
  }) as LayoutCall<any, any, any>;
  at.probe = options => at({ ...options, [FULL_LAYOUT_PROBE]: true } as RequestOptions);
  at.finish = () => run?.finish();
  at.accepts = (data, options) => run?.accepts(data, options) ?? false;
  return at;
}

export interface ChartMeasurement extends ResolvedSizing {
  /**
   * The height needed at exactly the width asked for (the minimum width when the request is
   * narrower): a chart pinned at that width and this height draws in full mode. `minHeight` also
   * holds at the minimum width, so it can be taller; use this one as a card's floor.
   */
  minHeightAtWidth: number;
  /**
   * The height the chart draws at the measured width, with no empty band. A pinned frame can be
   * taller: the rest stays empty (a circle is bound by its width). Equals the frame's height when
   * the chart uses all of it, and when the height is automatic. Absent on refusal.
   */
  drawnHeight?: number;
  mode?: 'full' | 'compact';
  /** Lines the title takes at the measured width; 0 without a title, absent on refusal. */
  titleLines?: number;
  warnings: LintWarning[];
  geometry?: Geometry;
  /**
   * A size refusal, or the error lints that refuse the laid-out chart as the
   * CLI and React refuse it. Refusal has no marks, derived values or claims.
   */
  refused?: RefusedLayout;
}

/**
 * The least height at which the request, pinned at `width`, is not refused for size, found by
 * raising `from` to what each refusal names. Text wraps and notes grow with the frame, so the
 * answer is only valid at this width. `belowMinimum: 'refuse'` asks for the full chart's height.
 */
export function minHeightAtWidth(
  request: ResolvedChartRequest, width: number, from: number, belowMinimum?: 'refuse',
  layoutAt: (size: Size) => LayoutResult = (size) => layoutResolvedRequest({ ...request, options: { ...request.options, ...(belowMinimum ? { belowMinimum } : {}), size } }),
): number {
  let height = Math.ceil(from);
  for (let pass = 0; pass < 8; pass++) {
    const next = heightNamedBy(layoutAt({ width, height }), height);
    if (next === undefined || next <= height) return height;
    height = next;
  }
  return height;
}

/**
 * The height a refused layout at `height` asks for: the floor a size refusal reports, or the height
 * a refusal of unplaced text names in its size fix. Undefined when a taller frame does not help.
 */
function heightNamedBy(probe: LayoutResult, height: number): number | undefined {
  if (!isRefused(probe)) return undefined;
  if (probe.warnings[0]?.code === 'size-below-floor') return probe.sizing ? Math.ceil(probe.sizing.minHeight) : undefined;
  for (const warning of probe.warnings) {
    const op = warning.severity === 'error' ? warning.fix?.find(fix => fix.op !== 'test' && fix.op !== 'remove' && fix.path === '/options/size') : undefined;
    const size = op && 'value' in op ? op.value as Partial<Size> : undefined;
    if (size?.height !== undefined && size.height > height && (size.width ?? probe.size.width) <= probe.size.width + SIZE_TOLERANCE) return Math.ceil(size.height);
  }
  return undefined;
}

/** The measurement of a layout already made; the CLI judges the geometry it measured. */
export function measureLayout(request: ResolvedChartRequest, result: LayoutResult): ChartMeasurement {
  const run = preparedLayout(request);
  try { return measureWithLayout(request, result, run); } finally { run.finish(); }
}

/** Exact plot repairs may spend layouts; rendering only reports its estimate. */
function measuredPlotAdvice(request: ResolvedChartRequest, result: LayoutResult, layoutAt: LayoutCall<any, any, any>): void {
  const warning = result.warnings.find(w => w.code === 'plot-under-floor');
  if (!warning || result.refused || isRefused(result)) return;
  const clean = (size: Size) => {
    const probe = layoutAt({ ...request.options, size });
    return !isRefused(probe) && !probe.warnings.some(w => w.code === 'plot-under-floor' || w.code === 'size-below-floor');
  };
  const repair = verifiedSizeRepair({ width: result.size.width, height: plotRepairHeight(result, request.target) }, clean);
  const { fix: _fix, ...rest } = warning;
  let replacement: LintWarning = rest;
  if (repair.size) {
    let low = Math.ceil(result.size.height), height = repair.size.height;
    while (height - low > 1) {
      const mid = Math.floor((height + low) / 2);
      if (clean({ width: repair.size.width, height: mid })) height = mid;
      else low = mid;
    }
    replacement = { ...rest, message: `${rest.message.replace(/; (?:the chart needs|the estimated height is) .*$/, '')}; the chart needs ${height} px`,
      suggest: `Give the chart ${height} px of height, or leave the height out so the chart takes it.`,
      fix: [{ op: 'replace', path: '/options/size', value: { width: repair.size.width, height } }] };
  } else replacement = { ...rest, suggest: 'No size was verified within the measurement search bound. Reduce the content or change the chart settings.' };
  result.warnings = result.warnings.map(w => w === warning ? replacement : w);
}

function measureWithLayout(request: ResolvedChartRequest, result: LayoutResult,
  layoutAt: LayoutCall<any, any, any>,
): ChartMeasurement {
  measuredPlotAdvice(request, result, layoutAt);
  const def = getChart(request.type);
  // The declared floor, with the one option that lowers it (a compact KPI
  // card) — the same answer `fitLayout` gated the layout on.
  let sizing = resolveSizing(
    request.type === 'grid' && result.sizing?.fit === 'content' ? { ...declaredSizing(def!, request.options), minHeight: 0 } : def === undefined
      ? chartSizing(request.type, request.options as { density?: unknown })
      : declaredSizing(def, request.options),
    result.size,
    result.sizing,
  );
  const declaredMinHeight = sizing.minHeight;
  const sizeRepair = result.refused && result.warnings[0]?.code === 'size-below-floor';
  const cleanHeight = (probe: LayoutResult): number => {
    if (!sizeRepair) return 0;
    const fix = probe.warnings.find(w => w.code === 'plot-under-floor')?.fix
      ?.find(op => op.op === 'replace' && op.path === '/options/size');
    return fix && 'value' in fix && !probe.refused
      ? Math.max((fix.value as Size).height, plotFloorHeight(probe, request.target)) : 0;
  };
  // A table's ladder is the table at less air, not compact mode: its floor is the last rung's,
  // the narrowest width it draws at. An authored belowMinimum still wins through request.options.
  const floorOptions = request.type === 'table' || request.type === 'dimswitch' ? {} : { belowMinimum: 'refuse' as const };
  // One layout per frame: the floor loop and `minHeightAtWidth` probe the same frames with the same option.
  const probes = new Map<string, LayoutResult>();
  const probeAt = (size: Size): LayoutResult => {
    const key = `${size.width}x${size.height}`;
    let probe = probes.get(key);
    if (probe === undefined) {
      const options = { ...floorOptions, ...request.options, size };
      probe = layoutAt.probe(options);
      probes.set(key, probe);
    }
    return probe;
  };
  // Text and chrome depend on width. Verify the floor at the requested
  // width (or the minimum width when the request is narrower)
  // through the same registered layout that render uses, including its notes.
  for (let pass = 0; pass < 8; pass++) {
    let verified = true;
    const previousWidth = sizing.minWidth;
    const previousHeight = sizing.minHeight;
    for (const width of new Set([sizing.minWidth, Math.max(request.size.width, sizing.minWidth)])) {
      // The floor is the full chart's: a probe that fell back to compact would hide that it lacks room.
      const probe = probeAt({ width, height: sizing.minHeight });
      if (!probe.sizing) continue;
      const refused = isRefused(probe);
      const repairHeight = cleanHeight(probe);
      if (refused || repairHeight > sizing.minHeight) verified = false;
      sizing = resolveSizing(sizing, result.size, { ...sizing,
        minWidth: refused ? Math.max(sizing.minWidth, probe.sizing.minWidth) : sizing.minWidth,
        minHeight: Math.max(sizing.minHeight, refused ? probe.sizing.minHeight : 0, repairHeight),
        measuredMinWidth: Math.max(sizing.measuredMinWidth, probe.sizing.measuredMinWidth),
        measuredMinHeight: Math.max(sizing.measuredMinHeight, probe.sizing.measuredMinHeight),
      });
    }
    if (verified || (sizing.minWidth === previousWidth && sizing.minHeight === previousHeight)) break;
  }
  // At the automatic height a width alone takes the height it needs, so the
  // floor above, verified at minHeight, can stand over widths that draw in full. The minimum width
  // is the narrowest a width-only request draws in full; the pair grows to the height drawn there,
  // so the size a refusal names draws too. Find the first whole pixel that draws.
  const staticMinWidth = def === undefined ? 0 : declaredSizing(def, request.options).minWidth;
  if (!request.fixed.height && (!result.refused || sizeRepair) && sizing.minWidth > staticMinWidth) {
    const fullAt = (width: number): LayoutResult | undefined => {
      // The same floor rule as probeAt: a table draws below its natural width on its ladder.
      const options = { ...request.options, ...floorOptions, size: { width }, [WIDTH_PROBE]: request.type };
      const probe = layoutAt.probe(options);
      return !isRefused(probe) && (probe as Geometry).mode !== 'compact' ? probe : undefined;
    };
    let drawn = fullAt(sizing.minWidth - 1);
    if (drawn) {
      // Width acceptance can change with labels. Keep a verified accepted upper end.
      let [lo, hi] = [staticMinWidth - 1, sizing.minWidth - 1];
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const probe = fullAt(mid);
        if (probe) [hi, drawn] = [mid, probe];
        else lo = mid;
      }
      const lowered = { ...sizing, minWidth: hi, minHeight: Math.max(sizing.minHeight, Math.ceil(drawn.size.height)) };
      // The exact pair must draw too; otherwise keep the original repair advice.
      let pairDraws = false;
      try { pairDraws = !isRefused(probeAt({ width: lowered.minWidth, height: lowered.minHeight })); }
      catch (error) { if (!(error instanceof NormalizeError)) throw error; }
      if (pairDraws) sizing = resolveSizing(lowered, result.size, { ...lowered, measuredMinWidth: Math.min(sizing.measuredMinWidth, hi) });
    }
  }
  // The pair above is safe at the minimum width too. A host at one width needs the height for that width.
  // Keep the width-specific height lazy. A caller that does not read it needs no extra layouts.
  const atWidth = Math.max(request.size.width, sizing.minWidth);
  let atHeight: number | undefined;
  // The compact floor is reported only where this spec draws: the least height that draws at the
  // compact width, which the compact refusal there names. A spec that draws nowhere at that width
  // reports no compact floor, so a host never lays out at a size that refuses. Neither does a spec
  // without the fallback (`mode: 'full'`, `belowMinimum: 'refuse'`).
  if (sizing.compactFloor && def !== undefined && !compactFallbackApplies(def, { ...request.options, size: sizing.compactFloor }, request.data)) {
    const { compactFloor: _off, ...rest } = sizing;
    sizing = rest;
  } else if (sizing.compactFloor && def !== undefined) {
    const width = sizing.compactFloor.width;
    // Fixed-size probes: a refusal names its own estimate without the repair search, which made
    // this check cost several full measures on a slow chart. A probe that draws, draws as the host's call does.
    const at = (size: Size | { width: number }) => layoutAt({ ...request.options, size, [FIXED_SIZE_PROBE]: true });
    let height: number | undefined = sizing.compactFloor.height;
    let drawn = false;
    for (let pass = 0; height !== undefined && pass < 8; pass++) {
      const probe = at({ width, height });
      if (!isRefused(probe)) { drawn = true; break; }
      const named = probe.warnings[0]?.code === 'size-below-floor' ? probe.warnings[0].expected?.minimum as Size | undefined : undefined;
      if (named && named.width <= width + SIZE_TOLERANCE && named.height > height) { height = Math.ceil(named.height); continue; }
      // No compact size at this width: the height the chart takes there, when it draws pinned.
      const open = layoutAt({ ...request.options, size: { width } });
      const taken = isRefused(open) ? undefined : Math.ceil(open.size.height);
      drawn = taken !== undefined && taken > height && !isRefused(at({ width, height: taken }));
      height = taken;
      break;
    }
    const { compactFloor: _static, ...rest } = sizing;
    sizing = drawn && height !== undefined ? { ...sizing, compactFloor: { width, height } } : rest;
  }
  // drawn at its natural width, a content chart's natural height is
  // the one it measured there. A floor verified at the narrower minimum width
  // raises minHeight, not it. At another width the floor keeps the natural
  // pair renderable.
  // Size advice uses whole pixels; the authored canvas can have a fractional width.
  if (!result.refused && result.sizing?.fit === 'content' && Math.ceil(result.size.width) === sizing.naturalWidth) {
    sizing = { ...sizing, naturalHeight: result.sizing.naturalHeight };
  }
  // All measurement fields and repair advice describe the verified floor. A canvas below the full
  // floor that falls back to compact keeps the size compact needs, which the layout named (the
  // `belowMinimum: 'compact'` contract): the full floor is not the size the host must give.
  let updated = result.refused ? sizeRefusal(result.type, result.title, result.size, sizing) : undefined;
  const compactNeed = sizeRepair && def !== undefined && compactFallbackApplies(def, request.options, request.data) && !fitsSize(result.size, sizing)
    ? result.warnings[0]!.expected?.minimum as Size | undefined : undefined;
  if (compactNeed) {
    const repair = verifiedSizeRepair(compactNeed, size => {
      const probe = layoutAt({ ...request.options, size });
      return !isRefused(probe) && !probe.warnings.some(w => w.code === 'plot-under-floor' || w.code === 'size-below-floor');
    });
    // The pair, as every measure refusal names it; the hint is the compact layout's own.
    if (repair.size && updated) updated = { ...updated, warnings: sizeRefusal(updated.type, updated.title, updated.size,
      { ...sizing, minWidth: repair.size.width, minHeight: repair.size.height, hint: result.sizing?.hint }).warnings };
  }
  if (sizeRepair && updated && !compactNeed) {
    const initial = updated.warnings[0]!.expected!.minimum as Size;
    const repair = verifiedSizeRepair(initial, size => {
      const probe = layoutAt({ ...request.options, size });
      return !isRefused(probe) && !probe.warnings.some(w => w.code === 'plot-under-floor' || w.code === 'size-below-floor');
    });
    if (repair.size) {
      sizing = { ...sizing,
        ...(repair.size.height > initial.height ? { minHeight: repair.size.height } : {}),
        ...(repair.size.width > initial.width ? { minWidth: repair.size.width } : {}) };
      atHeight = Math.min(sizing.minHeight, repair.size.height);
      updated = sizeRefusal(result.type, result.title, result.size, sizing);
    } else {
      updated = { ...updated, warnings: [{ code: 'size-below-floor', severity: 'error',
        message: `${def?.title ?? request.type} needs more room for the current data and settings`,
        suggest: `No size could be verified within ${repair.limit.width} × ${repair.limit.height}px. Reduce the content or change the chart settings.`,
        field: ['options', 'size'],
      }] };
    }
  }
  const floorHeight = sizing.minHeight;
  const warnings = updated ? result.warnings.map(w => w.code === 'size-below-floor' ? updated.warnings[0]! : w) : result.warnings;
  // A complete height chain already observed by the floor search needs no
  // replay. Keep only its answer; an incomplete chain stays lazy below.
  let observedHeight = Math.ceil(declaredMinHeight);
  if (result.refused && result.warnings[0]?.code !== 'size-below-floor') atHeight = floorHeight;
  for (let pass = 0; atHeight === undefined && pass < 8; pass++) {
    const probe = probes.get(`${atWidth}x${observedHeight}`);
    if (!probe) break;
    const repairHeight = cleanHeight(probe);
    const named = heightNamedBy(probe, observedHeight);
    const next = Math.ceil(Math.max(named ?? probe.sizing?.minHeight ?? observedHeight, repairHeight));
    if ((!isRefused(probe) && !repairHeight && named === undefined) || !probe.sizing || (isRefused(probe) && named === undefined) || next <= observedHeight) {
      atHeight = Math.min(floorHeight, observedHeight);
      break;
    }
    observedHeight = next;
    if (pass === 7) atHeight = Math.min(floorHeight, observedHeight);
  }
  const measured: ChartMeasurement = {
    ...sizing,
    get minHeightAtWidth(): number {
      if (atHeight === undefined) {
        if (result.refused && result.warnings[0]?.code !== 'size-below-floor') atHeight = floorHeight;
        else {
          // This read owns a fresh call. Only its numeric answer survives its exit.
          const run = preparedLayout(request);
          try {
            atHeight = Math.min(floorHeight, minHeightAtWidth(request, atWidth, declaredMinHeight, 'refuse', size => {
              const floorOptions = request.type === 'table' || request.type === 'dimswitch' ? {} : { belowMinimum: 'refuse' as const };
              return run.probe({ ...floorOptions, ...request.options, size });
            }));
          } finally { run.finish(); }
        }
      }
      return atHeight;
    },
    // Lazy like `minHeightAtWidth`: only a pinned frame needs layouts at other heights.
    get drawnHeight(): number | undefined {
      if (result.refused || isRefused(result)) return undefined;
      if (!request.fixed.height) return result.size.height;
      // A probe that draws the same chart at the same width is the answer; the floor bounds the search.
      const run = preparedLayout(request);
      try { return drawnHeight(result, floorHeight, size => run({ ...request.options, size }), request.size.height); } finally { run.finish(); }
    },
    warnings,
    ...(result.refused ? { refused: { ...result, sizing, warnings } }
      : isRefused(result) ? { refused: { refused: true, type: result.type, title: def?.title ?? result.type, size: result.size, sizing, warnings: result.warnings } }
      : { mode: result.mode, titleLines: result.frame.titleLines ?? 0, geometry: result }),
  };
  // Only the computed height survives this call, not the probe cache.
  probes.clear();
  return measured;
}

export function measureResolvedRequest(request: ResolvedChartRequest): ChartMeasurement {
  const layoutAt = preparedLayout(request, true);
  let first: LayoutResult;
  try { first = layoutAt(request.options); } catch (error) { layoutAt.finish(); throw error; }
  const plainRequest = withoutAskedNotes(request, first);
  if (plainRequest) {
    const plainAt = preparedLayout(plainRequest, true);
    try {
      const plain = plainAt(plainRequest.options);
      if (!plain.refused) {
        layoutAt.finish();
        return measureWithLayout(plainRequest, askedNotesOff(plain, first), plainAt);
      }
    } finally { plainAt.finish(); }
  }
  try { return measureWithLayout(request, first, layoutAt); } finally { layoutAt.finish(); }
}

/**
 * A context key measure does not read, such as `{ width }`, never vanishes silently:
 * each one is a warning that names it; a frame key says where the
 * frame goes instead.
 */
function contextWarnings(context: RequestContext | undefined): LintWarning[] {
  if (context === null || typeof context !== 'object') return [];
  // Exhaustive over the public type; kept in here so a bundle without measure drops it.
  const CONTEXT_KEYS = Object.keys({ theme: true, locale: true, strings: true, target: true, textScale: true, textSize: true } satisfies Record<keyof RequestContext, true>);
  return Object.keys(context).filter((key) => !CONTEXT_KEYS.includes(key)).map((key) => ({
    code: 'unknown-context-key',
    severity: 'warn',
    message: key === 'width' || key === 'height'
      ? `measure ignored the context key '${key}': the frame belongs in options.size, as { ${key}: <px> }`
      : `measure ignored the context key '${key}': the context takes only ${CONTEXT_KEYS.join(', ')}`,
    suggest: key === 'width' || key === 'height'
      ? `Move ${key} into the request: measure({ ...request, options: { ...request.options, size: { ${key} } } }).`
      : `Remove '${key}' from the context, or move it into the request options.`,
  }));
}

/** Measure without serializing SVG, computing claims or touching the DOM. */
export function measure<D, O extends object>(input: ChartRequest<D, O & RequestInputOptions>, context?: RequestContext): ChartMeasurement {
  const measured = measureResolvedRequest(resolveChartRequest(input, context));
  // Measurement returns patches against the authored request, before defaults create parents.
  for (const warning of measured.warnings) {
    if (warning.fix) warning.fix = addWhereAbsent(input, warning.fix.map(op => input.size !== undefined && op.path === '/options/size'
      ? { ...op, path: '/size' } : op));
    if (input.size !== undefined && warning.field?.[0] === 'options' && warning.field[1] === 'size') {
      warning.field = ['size', ...warning.field.slice(2)];
    }
  }
  const ignored = contextWarnings(context);
  return ignored.length ? { ...measured, warnings: [...ignored, ...measured.warnings] } : measured;
}

/** What `canDraw` answers. `code` names the reason; `minimum` is the size a size refusal needs. */
export interface CanDraw {
  ok: boolean;
  code?: string;
  minimum?: { width: number; height: number };
  message?: string;
}

/**
 * Whether a chart request draws, without drawing it, for a host that hides a
 * card instead of showing an empty box. `empty-data` names a chart with no
 * categories, series, rows or points (the same code for every type);
 * `size-below-floor` names a canvas too small, with the `minimum` it needs
 * (under `belowMinimum: 'compact'` that is the size the compact chart needs).
 * Any other refusal answers with its own code. A table or a dimswitch with no data row draws its head and one row that says so, and
 * `canDraw` answers `empty-data` for it, so a host can hide the card first.
 */
export function canDraw<D, O extends object>(input: ChartRequest<D, O & RequestInputOptions>, context?: RequestContext): CanDraw {
  let result: LayoutResult;
  let resolved: ResolvedChartRequest;
  try { resolved = resolveChartRequest(input, context); result = layoutResolvedRequest(resolved); }
  catch (error) {
    if (error instanceof NormalizeError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
  if (!isRefused(result)) {
    // A table or a dimswitch with no data row still draws its head and one row that says so; a host that hides the card
    // asks here, as it asks of every other type.
    const rows = (result as { derived?: { table?: { rows?: { role: string; inline?: true }[] } } }).derived?.table?.rows;
    return rows !== undefined && (resolved.type === 'table' || resolved.type === 'dimswitch') && hasNoDataRows({ rows })
      ? { ok: false, code: EMPTY_DATA, message: 'The table has no data rows.' } : { ok: true };
  }
  const finding = result.refused ? result.warnings[0] : chartRefusals(result.warnings)[0];
  const named = finding?.expected?.minimum as { width?: number; height?: number } | undefined;
  // A request with a width gets the height needed at that width: a refusal can name the height of a taller frame.
  const minimum = finding?.code === 'size-below-floor' && resolved.fixed.width && named?.width !== undefined && named.height !== undefined
    ? { width: named.width, height: minHeightAtWidth(resolved, named.width, named.height) } : named;
  return {
    ok: false,
    code: finding?.code,
    ...(minimum?.width !== undefined && minimum.height !== undefined ? { minimum: { width: minimum.width, height: minimum.height } } : {}),
    ...(finding?.message ? { message: finding.message } : {}),
  };
}
