import { fractionLineWarnings, prepareFractionAnnotations, percentScaleWarnings } from './normalize/fraction';
import { AUTHORED_EXAMPLES, readFormatExamples, UNIT_STAND_INS } from './formatSpec';
import { colorVariableWarnings } from './colorVariables';
import { drawnRequest } from './drawnRequest';
import { PLAN_ONLY, withPlanInputs, contentKey, copyPlannedValue, repeatedResult } from './layoutPlan';
import { loadedDeferred } from './deferred';
import { shownNoteKinds } from './notes';
import { canonicalChartType, getChart } from './registry';
import { chartSizing, compactFallbackApplies, declaredSizing, fitsSize, FIXED_SIZE_PROBE, FULL_LAYOUT_PROBE, NARROW_FORM, NARROW_FORM_TYPES, SIZE_TOLERANCE, LAYOUT_CALL, type LayoutCall, plotFloorHeight, plotRepairHeight, resolveSizing, sizeGate, sizeRefusal, VERIFY_ADVICE, verifiedSizeRepair, WIDTH_PROBE } from './sizing';
import { EMPTY_DATA, hasNoDataRows } from './emptyData';
import { NormalizeError, canonicalLanguage, substitute } from './normalize/shared';
import { withNumberMarks } from './numberMarks';
import { chartRefusals, isRefused } from './schema/refusals';
import { movedGridWarnings, movedWidthWarnings, TRACK_WIDTH_TYPES, widthsThatDraw, type WidthGroup, type WidthStep } from './charts/columnOverrides';
import { isRecord } from './lint/shared';
import type { ColumnOverride } from './types/options';
import { DEFAULT_PRESET, inMarginStepBand, panelTypeClass, REMOVED_NAMES, removedNameWarnings, resolveTargetTheme, resolveTheme, typeWidthClass, WIDE_CANVAS_MIN_WIDTH, withMarginStepBelow, withTypeClassCap, type TypeWidthClass } from './theme';
import { DEFAULT_TARGET, floorTextScale, resolveTargetSize } from './target';
import { textScaleOf, textSizeOf } from './typeFloors';
import { defaultMeasurer, type TextMeasurer } from './text';
import { drawnHeight } from './drawnHeight';
import { clippedTextWarnings } from './textClip';
import type { Size } from './geometry';
import { withAnnotationOrigins, type Annotation } from './types/annotations';
import type { BaseOptions, LocaleSpec, RenderTarget, StringsSpec } from './types/options';
import type { Geometry, LayoutResult, LintWarning, RefusedLayout } from './types/scene';
import type { ResolvedSizing } from './types/sizing';
import type { Theme, ThemeRef } from './types/theme';
import type { GridMarks } from './grid/layoutGrid';
import type { InteractionScope } from './a11y/types';
import { addWhereAbsent } from './diagnostics/jsonPatch';
import { timeAnnotationAnchors } from './timeAxis';
import { retireChartSettings } from './retired';
import { checkedTightAdvice, tightAdvice, withTightAdvice } from './charts/tableFit';
import type { OptionsInput } from './types/optionInput';
import { normalizeOptionShapes } from './normalize/optionShapes';

/** Chart-specific options can replace these three shared fields. */
export type RequestOptions = Omit<BaseOptions, 'labels' | 'legend' | 'mode'> & {
  labels?: unknown;
  legend?: unknown;
  mode?: unknown;
};

/** Authored x anchors can be epoch milliseconds; chart layouts resolve them to category ids. */
export type RequestInputOptions = OptionsInput<Omit<RequestOptions, 'annotations'>> & { annotations?: Annotation<string | number>[] };

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
  others: true, total: true, source: true, notApplicable: true, partial: true,
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

export interface ChartRequest<D = unknown, O extends object = RequestInputOptions> extends RequestContext {
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
  const shaped = normalizeOptionShapes(def.type, input, name => getChart(name)?.type);
  input = shaped.chart;
  const retired = retireChartSettings(def.type, input, (name) => getChart(name)?.type);
  input = retired.chart;
  const inheritedLocale = typeof context.locale === 'string' ? { language: context.locale } : context.locale;
  const authoredOptions = Object.assign(Object.create(null) as O & RequestOptions, def.defaults, {
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
  const read = readFormatExamples(input.data, authoredOptions);
  const options = read.options;
  // The layout, the records and the hover cards print a unit-only format's stand-in as a unit (isExactExample).
  if (read.standIns.size) (options as Record<symbol, unknown>)[UNIT_STAND_INS] = read.standIns;
  // Only the examples the author wrote print exactly; one the engine writes later keeps its own precision.
  (options as Record<symbol, unknown>)[AUTHORED_EXAMPLES] = read.authored;
  // The root list replaces options.annotations. A list from the type's defaults is not authored and has no origin.
  const annotationList = input.annotations !== undefined ? ['annotations'] as const : input.options?.annotations !== undefined ? ['options', 'annotations'] as const : undefined;
  if (annotationList && Array.isArray(options.annotations)) options.annotations = withAnnotationOrigins<Annotation>(options.annotations, annotationList);
  if (def.type === 'line' && (options as { xAxis?: { type?: string } }).xAxis?.type === 'time' && options.annotations) {
    // Records and hover cards read this request too, before the layout resolves its own anchors.
    options.annotations = options.annotations.map(annotation => timeAnnotationAnchors(annotation) as Annotation);
  }
  const authoredAnnotations = options.annotations;
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
  const data = prepared(def, read.data, options) as D;
  const inputWarnings = [...shaped.warnings, ...retired.warnings, ...read.warnings, ...requestInputWarnings(def.type, def.type === 'grid' ? data : input.data, { ...options, annotations: authoredAnnotations },
    input.annotations === undefined ? '/options/annotations' : '/annotations'),
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
  if ((request.type !== 'table' && request.type !== 'dimswitch') || request.data === null || typeof request.data !== 'object') return layoutRequest(request);
  const { type, theme, target, size, fixed, inputWarnings } = request;
  return repeatedResult(request.data, request.options, { type, theme, target, size, fixed, inputWarnings }, () => layoutRequest(request));
}

/** @internal Host sizing path. Tables keep their fit diagnostics without drawing a scene. */
export function planResolvedRequest(request: ResolvedChartRequest): Pick<LayoutResult, 'type' | 'size' | 'sizing' | 'warnings'> & { refused?: true; plot?: Geometry['plot']; scene: [] } {
  const result = request.type === 'table' || request.type === 'dimswitch'
    ? withPlanInputs(() => layoutRequest({ ...request, options: { ...request.options, [PLAN_ONLY]: true } as RequestOptions }))
    : layoutResolvedRequest(request);
  // A host owns its dimensions and diagnostics. Internal cell models and draw closures stay inside the engine.
  return copyPlannedValue({ type: result.type, size: result.size, sizing: result.sizing, warnings: result.warnings,
    ...(result.refused ? { refused: true as const } : { plot: result.plot }), scene: [] });
}

function layoutRequest(request: ResolvedChartRequest): LayoutResult {
  const finish = (result: LayoutResult): LayoutResult => (request.options as { [PLAN_ONLY]?: boolean })[PLAN_ONLY]
    ? result : withClipWarnings(result, request.fontMetrics);
  const table = request.type === 'table' || request.type === 'dimswitch';
  const result = afterFirstLayout(request, layoutOnce(request), layoutOnce, table ? layoutWidthProbe : layoutOnce, layoutPlain);
  // A table's tight-spacing size is checked once at that size. The dimswitch checks its own card in its layout;
  // the cohort's render advice is an estimate that errs wide, and its check would cost two layouts.
  if (request.type !== 'table' || isRefused(result)) return finish(result);
  return finish(checkedTightAdvice(result, (size) => {
    const next = layoutPlain({ ...request, options: { ...request.options, size } as RequestOptions });
    return isRefused(next) ? undefined : next;
  }));
}

/**
 * Render's steps after its first layout of a request: authored widths give way, the type steps down
 * on a slide or print canvas, asked notes move to the notes list, the next smaller type class. Each
 * returns before any layout where it does not apply. Width searches take the same steps (`widthProbers`).
 */
function afterFirstLayout(request: ResolvedChartRequest, first: LayoutResult, layout: (asked: ResolvedChartRequest) => LayoutResult,
  probe: (asked: ResolvedChartRequest) => LayoutResult, plainLayout: (asked: ResolvedChartRequest) => LayoutResult): LayoutResult {
  const table = request.type === 'table' || request.type === 'dimswitch';
  const fitted = widthsGiveWay(request, first, layout, probe);
  if (fitted) return fitted[1];
  const [asked, result] = steppedType(request, first, layout) ?? [request, first];
  const plainRequest = withoutAskedNotes(asked, result);
  const plain = plainRequest && layout(plainRequest);
  const drawn = plain && !plain.refused ? askedNotesOff(plain, result) : result;
  // An unchanged refusal already tried the same authored widths.
  const fittedLate = table && asked === request && drawn === first
    ? undefined : widthsGiveWay(asked, drawn, layout, probe);
  const last = fittedLate ? fittedLate[1] : drawn;
  const final = fittedLate ? fittedLate[0] : asked;
  const stepped = smallerClass(final, last, plainLayout) ?? last;
  const drawnLast = typeStepped(result, narrowerForm(final, stepped, plainLayout) ?? stepped);
  const below = marginBelowRequest(request, drawnLast);
  const marginStepped = below && afterFirstLayout(below, layout(below), layout, probe, plainLayout);
  return marginStepped && !isRefused(marginStepped) ? drawnBy(marginStepped, 'marginStep') : drawnLast;
}

/** A request whose layouts take the default canvas margins of the step under its width (`withMarginStepBelow`). */
const MARGIN_BELOW = Symbol('boardplot.marginBelow');

/**
 * The default side margins step up at 600 and 840 px, so a few pixels over a step leave a narrower plot than the
 * pixel under it. A chart refused there takes render's steps again with the margins of the step below and draws
 * if that fits, so a chart that draws at a width draws at every wider width. Every drawn chart keeps its layout.
 * An authored belowMinimum 'refuse' and a grid panel keep the refusal, as for the class step.
 */
function marginBelowRequest(request: ResolvedChartRequest, result: LayoutResult): ResolvedChartRequest | undefined {
  const options = request.options as RequestOptions & { [MARGIN_BELOW]?: true };
  if (options[MARGIN_BELOW] || !stepsDown(result) || !inMarginStepBand(request.size.width) || panelTypeClass(options) !== undefined
    || options.belowMinimum === 'refuse') return undefined;
  return { ...request, options: { ...options, [MARGIN_BELOW]: true } as RequestOptions };
}

/**
 * The last step before a width refusal: a type whose form for this width has a floor above it draws
 * the form a narrower width draws, so a chart that draws at a width draws at every wider width.
 * Every drawn chart keeps its layout; a grid panel keeps its form for the grid.
 */
function narrowerForm(request: ResolvedChartRequest, result: LayoutResult, layout: (asked: ResolvedChartRequest) => LayoutResult): LayoutResult | undefined {
  const need = result.refused && result.warnings[0]?.code === 'size-below-floor' ? result.warnings[0].expected?.minimum as Size | undefined : undefined;
  if (!need || need.width <= result.size.width || !NARROW_FORM_TYPES.has(request.type) || panelTypeClass(request.options) !== undefined) return undefined;
  const narrow = layout({ ...request, options: { ...request.options, [NARROW_FORM]: true } as RequestOptions });
  return narrow.refused ? undefined : drawnBy(narrow, 'narrowerForm');
}

/** Which of render's later steps drew a result; it survives the copies render and the request cache make. */
const DRAWN_BY = Symbol('boardplot.drawnBy');
type DrawnBy = 'narrowerForm' | 'smallerClass' | 'marginStep';
function drawnBy(result: LayoutResult, step: DrawnBy): LayoutResult {
  return Object.assign(result, { [DRAWN_BY]: step });
}
const drawnStep = (result: LayoutResult): DrawnBy | undefined => (result as { [DRAWN_BY]?: DrawnBy })[DRAWN_BY];

/**
 * The type steps up at 720 and at 1080 px. A chart refused in the class its width selects draws in the
 * first smaller class that draws, as the width just under the step does; under the cap every width step
 * reads that width (`classStepWidth`). A size refusal that asks only for more height, an authored
 * belowMinimum 'refuse' and a grid panel keep the refusal with its own advice.
 */
function smallerClass(
  request: ResolvedChartRequest, result: LayoutResult, layout: (asked: ResolvedChartRequest) => LayoutResult = layoutPlain,
): LayoutResult | undefined {
  // Size advice asks first (advisedWidth); the same refusal is not laid out twice.
  const known = classSteps.get(result);
  if (known?.request === request) return known.drawn;
  const drawn = classStep(request, result, layout);
  classSteps.set(result, { request, drawn });
  return drawn;
}

const classSteps = new WeakMap<LayoutResult, { request: ResolvedChartRequest; drawn: LayoutResult | undefined }>();

function classStep(request: ResolvedChartRequest, result: LayoutResult, layout: (asked: ResolvedChartRequest) => LayoutResult): LayoutResult | undefined {
  if (!stepsDown(result) || panelTypeClass(request.options) !== undefined || (request.options as RequestOptions).belowMinimum === 'refuse') return undefined;
  const smaller = firstSmallerClass(result, () => layout(request));
  return smaller && drawnBy(smaller, 'smallerClass');
}

/** A refusal the class step answers: any refusal but a size refusal that asks only for more height, which its size advice answers. */
function stepsDown(result: LayoutResult): boolean {
  if (!isRefused(result)) return false;
  if (!result.refused || result.warnings[0]?.code !== 'size-below-floor') return true;
  const need = result.warnings[0].expected?.minimum as Size | undefined;
  return need !== undefined && need.width > result.size.width;
}

const SMALLER_CLASSES: Record<TypeWidthClass, readonly TypeWidthClass[]> = { L: ['M', 'S'], M: ['S'], S: [] };

/** The width just under a step can itself draw only in a smaller class: the first smaller class that draws. */
function firstSmallerClass(result: LayoutResult, layout: () => LayoutResult): LayoutResult | undefined {
  for (const cap of SMALLER_CLASSES[typeWidthClass(result.size.width)]) {
    const smaller = withTypeClassCap(cap, layout);
    if (!isRefused(smaller)) return smaller;
  }
  return undefined;
}

/** While measure probes a chart that drew in a smaller class, each of its layouts takes render's class step. */
let classStepping = false;

function withClassStepping<T>(run: () => T): T {
  const outer = classStepping;
  classStepping = true;
  try { return run(); } finally { classStepping = outer; }
}

/** A measurement whose layouts take the class step, its lazy fields included. */
function measuredWithClassStep(measured: () => ChartMeasurement): ChartMeasurement {
  const inner = withClassStepping(measured);
  const fields = Object.getOwnPropertyDescriptors(inner);
  for (const field of Object.values(fields)) {
    const get = field.get;
    if (get) field.get = () => withClassStepping(() => get.call(inner));
  }
  return Object.defineProperties({}, fields) as ChartMeasurement;
}

/** One layout of the request, without the size advice a refusal searches for. */
function layoutPlain(request: ResolvedChartRequest): LayoutResult {
  const run = preparedLayout(request);
  try { return run(request.options); } finally { run.finish(); }
}

interface WidthEntry { id?: string; type?: string; options?: { columnOverrides?: Record<string, ColumnOverride> }; data?: WidthLevel }
interface WidthLevel { panels?: WidthEntry[]; template?: WidthEntry; repeat?: { dimension: string; values: string[] }; bySlice?: Record<string, WidthLevel> }

const hasAuthoredWidth = (overrides: Record<string, ColumnOverride> | undefined): overrides is Record<string, ColumnOverride> =>
  overrides !== undefined && Object.values(overrides).some((override) => override.width !== undefined);
const ownWidthGroups = (type: string, options: WidthEntry['options']): WidthGroup[] => (TRACK_WIDTH_TYPES.has(canonicalChartType(type) ?? type) && hasAuthoredWidth(options?.columnOverrides) ? [{ overrides: options.columnOverrides }] : []);

/** The authored widths of a grid's panels, through nested grids at any depth, repeat templates and the slices that draw. */
function panelWidthGroups(level: WidthLevel | undefined, path: readonly WidthStep[] = []): WidthGroup[] {
  const widthsOf = (entry: WidthEntry, step: WidthStep): WidthGroup[] => {
    const type = canonicalChartType(entry.type ?? '') ?? entry.type ?? '';
    const below = [...path, step];
    return type === 'grid' ? panelWidthGroups(entry.data, below) : ownWidthGroups(type, entry.options).map((group) => ({ ...group, path: below }));
  };
  if (Array.isArray(level?.panels)) return level.panels.flatMap((panel, index) => (isRecord(panel) ? widthsOf(panel, { id: (panel as WidthEntry).id!, index }) : []));
  const template = level?.template;
  if (!template) return [];
  const slices = template.data?.bySlice;
  if (!slices || !level?.repeat || (canonicalChartType(template.type ?? '') ?? template.type) !== 'grid') return widthsOf(template, 'template');
  // Only the values draw, each with its placeholder filled in, so ids and types are read from a filled copy. Keys and indexes fit the authored data.
  const placeholder = `$${level.repeat.dimension}`;
  return level.repeat.values.flatMap((value) => {
    if (!Object.hasOwn(slices, value)) return [];
    const step = { id: substitute(template.id ?? value, placeholder, value) as string, slice: value };
    return panelWidthGroups(substitute(slices[value], placeholder, value) as WidthLevel, [...path, step]);
  });
}

/** A copy of the grid data with one panel's overrides replaced. The caller's data stays as it is. */
function withPanelOverrides(level: WidthLevel, [step, ...rest]: readonly WidthStep[], columnOverrides: Record<string, ColumnOverride>): WidthLevel {
  if (step !== 'template' && 'slice' in step!) {
    const template = level.template!;
    const slices = template.data!.bySlice!;
    return { ...level, template: { ...template, data: { ...template.data, bySlice: { ...slices, [step.slice]: withPanelOverrides(slices[step.slice]!, rest, columnOverrides) } } } };
  }
  const entry = step === 'template' ? level.template! : level.panels![step!.index]!;
  const next = rest.length > 0 ? { ...entry, data: withPanelOverrides(entry.data!, rest, columnOverrides) } : { ...entry, options: { ...entry.options, columnOverrides } };
  if (step === 'template') return { ...level, template: next };
  const panels = [...level.panels!];
  panels[step!.index] = next;
  return { ...level, panels };
}

/**
 * Nothing refuses because of an authored column width: where the chart draws with the width unset,
 * the width gives way toward it and warns. A refusal with every width unset stays as it is. A grid
 * refuses from the floors its panels add up to, so its panels' widths give way together, against the
 * whole grid. A request with no authored width returns before any extra layout.
 */
function widthsGiveWay(
  request: ResolvedChartRequest, result: LayoutResult, layout: (asked: ResolvedChartRequest) => LayoutResult,
  probe: (asked: ResolvedChartRequest) => LayoutResult = layout,
): [ResolvedChartRequest, LayoutResult] | undefined {
  if (!result.refused || result.warnings[0]?.code !== 'size-below-floor') return undefined;
  const grid = request.type === 'grid';
  const groups = grid ? panelWidthGroups(request.data as WidthLevel) : ownWidthGroups(request.type, request.options as WidthEntry['options']);
  if (groups.length === 0) return undefined;
  const asking = (overrides: readonly Record<string, ColumnOverride>[]): ResolvedChartRequest => (grid
    ? { ...request, data: groups.reduce((data, group, at) => withPanelOverrides(data, group.path!, overrides[at]!), request.data as WidthLevel) as typeof request.data }
    : { ...request, options: { ...request.options, columnOverrides: overrides[0]! } as typeof request.options });
  const fit = widthsThatDraw(groups, request.size.width, (overrides) => !probe(asking(overrides)).refused);
  if (!fit) return undefined;
  const asked = asking(fit.overrides);
  const drawn = layout(asked);
  if (drawn.refused) return undefined;
  return [asked, grid ? movedGridWarnings(drawn as Geometry, groups, fit) : { ...drawn, warnings: movedWidthWarnings(drawn.warnings, fit) }];
}

/**
 * A slide or print canvas a little too small for the class sizes draws once with the text stepped down to
 * its reader floor before it is refused. An authored textScale, textSize or belowMinimum 'refuse' keeps
 * the refusal. A stepped layout that is refused too gives the size the stepped text needs.
 */
function steppedType(
  request: ResolvedChartRequest, first: LayoutResult, layout: (stepped: ResolvedChartRequest) => LayoutResult = layoutOnce,
): [ResolvedChartRequest, LayoutResult] | undefined {
  const options = request.options as RequestOptions;
  const scale = floorTextScale(request.target);
  if (!first.refused || first.warnings[0]?.code !== 'size-below-floor' || scale === undefined
    || options.textScale !== undefined || options.textSize !== undefined || options.belowMinimum === 'refuse') return undefined;
  const steppedRequest: ResolvedChartRequest = {
    ...request, options: { ...request.options, textScale: scale },
    theme: resolveTargetTheme(request.options.theme, request.target, scale),
  };
  const result = layout(steppedRequest);
  const full = first.warnings[0].expected?.minimum as Size | undefined;
  const note: LintWarning = {
    code: 'type-stepped', severity: 'info',
    message: `the canvas is too small for the ${request.target} type sizes, so the text is drawn at ${Math.round(scale * 100)} % of them, down to its reader floor`,
    suggest: full === undefined ? 'Give the chart more room to draw the full type sizes.' : `Render it at ${full.width} × ${full.height}px or larger to draw the full type sizes.`,
  };
  // A stepped layout that is refused too keeps the note for a later step that draws the stepped text (`typeStepped`).
  if (result.refused) return [steppedRequest, Object.assign(result, { [STEPPED_NOTE]: note })];
  return [steppedRequest, { ...result, warnings: [...result.warnings, note] }];
}

const STEPPED_NOTE = Symbol('boardplot.steppedNote');
/** A later step that draws a request whose stepped layout was refused (`steppedType`) names the stepped text too. */
function typeStepped(refused: LayoutResult, drawn: LayoutResult): LayoutResult {
  const note = (refused as { [STEPPED_NOTE]?: LintWarning })[STEPPED_NOTE];
  return note && !drawn.refused && !drawn.warnings.some((warning) => warning.code === note.code) ? { ...drawn, warnings: [...drawn.warnings, note] } : drawn;
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

/** Authored-width trials need acceptance only; the chosen result keeps full advice and drawing. */
function layoutWidthProbe(request: ResolvedChartRequest): LayoutResult {
  const run = preparedLayout(request);
  try { return run({ ...request.options, [PLAN_ONLY]: true } as RequestOptions); }
  finally { run.finish(); }
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

/** One width-only probe: whether the request draws there, the width its own form needs, and the layout. */
interface WidthProbe {
  draws: boolean; floor?: number; result: LayoutResult;
  /** Drawn after a size refusal in the class of this width: the width that refusal names, where its own class draws again. */
  upper?: number;
}

/**
 * The request at a width alone, as render draws it: its layout, then render's steps after a refusal
 * (`afterFirstLayout`). `any` draws it at all, the compact fallback included; `full` draws it in its
 * own mode. A drawn width names its form's floor, a refused one the width its refusal names. Probes
 * skip the repair search of a refusal, which only refines that width.
 */
function widthProbers(request: ResolvedChartRequest, layoutAt: LayoutCall<any, any, any>, known?: Map<number, WidthProbe>, verify = false): { full: (width: number) => WidthProbe; any: (width: number) => WidthProbe } {
  const own = request.options as RequestOptions;
  const def = getChart(request.type);
  const table = request.type === 'table' || request.type === 'dimswitch';
  const sizeNeed = (probe: LayoutResult) => (probe.refused && probe.warnings[0]?.code === 'size-below-floor'
    ? (probe.warnings[0].expected?.minimum as Size | undefined)?.width ?? probe.sizing?.minWidth : undefined);
  const read = (probe: LayoutResult, draws: boolean): WidthProbe => ({ draws, floor: draws ? probe.sizing?.minWidth : sizeNeed(probe), result: probe });
  const probeOptions = (options: RequestOptions) => (table ? { ...options, [PLAN_ONLY]: true } : options);
  // Render's own steps lay out other requests (wider authored columns, stepped type, a smaller class): fresh calls.
  const stepLayout = (asked: ResolvedChartRequest): LayoutResult => {
    const run = preparedLayout(asked);
    try { return run(probeOptions(asked.options) as RequestOptions); } finally { run.finish(); }
  };
  // A width kept for later calls (`known`) is laid out as render lays it out alone, in a call of its own. A call keeps
  // memos for the request it was opened for, so a kept width must not depend on which call laid it out first.
  const alone = (asked: ResolvedChartRequest): LayoutResult => {
    const run = preparedLayout(asked, verify);
    try { return run(probeOptions(asked.options) as RequestOptions); } finally { run.finish(); }
  };
  // `shared` holds the widths of earlier calls; the asked width is this call's own layout and stays in it.
  const cached = (probe: (width: number) => WidthProbe, shared?: Map<number, WidthProbe>) => {
    const local = new Map<number, WidthProbe>();
    return (width: number) => {
      const store = shared && width !== request.size.width ? shared : local;
      if (!store.has(width)) {
        const found = probe(width);
        if (store === shared && shared.size >= STORED_WIDTHS) shared.delete(shared.keys().next().value!);
        // An earlier width's result is only read for its size and mode: keep no scene alive across calls.
        store.set(width, store === shared && found.result
          ? { ...found, result: { size: found.result.size, mode: (found.result as Geometry).mode } as LayoutResult } : found);
      }
      return store.get(width)!;
    };
  };
  // Under the floor fitSize checks first a width is refused before any layout, unless one of render's
  // steps lays out another request (the type class steps happen from 720 px).
  const steps = (floorTextScale(request.target) !== undefined && own.textScale === undefined && own.textSize === undefined && own.belowMinimum !== 'refuse')
    || (request.type === 'grid' ? panelWidthGroups(request.data as WidthLevel) : ownWidthGroups(request.type, own as WidthEntry['options'])).length > 0;
  const gated = (width: number): WidthProbe | undefined => {
    if (def === undefined || steps || panelTypeClass(own) !== undefined || typeWidthClass(width) !== 'S') return undefined;
    const gate = sizeGate(def, request.data, { ...request.options, size: { width } }, true).gatePolicy.minWidth;
    return width + SIZE_TOLERANCE < gate ? { draws: false, floor: gate, result: undefined as unknown as LayoutResult } : undefined;
  };
  // A width the chart refuses with a thrown finding (a metric stack panel shorter than the larger type of a wider
  // class asks for) does not draw there. The finding is that width's, not the asked one's.
  const refusedAt = (probe: (width: number) => WidthProbe) => (width: number): WidthProbe => {
    try { return probe(width); } catch (error) {
      if (!(error instanceof NormalizeError) || width === request.size.width) throw error;
      return { draws: false, result: undefined as unknown as LayoutResult };
    }
  };
  const any = cached(refusedAt((width) => {
    const gate = gated(width);
    if (gate) return gate;
    // The asked width is the layout render made.
    const asked = width === request.size.width ? request
      : { ...request, size: { ...request.size, width }, options: { ...request.options, size: { width } } as RequestOptions };
    const first = asked === request ? layoutAt(request.options as RequestOptions) : known ? alone(asked) : layoutAt(probeOptions(asked.options) as RequestOptions);
    if (!isRefused(first)) return read(first, true);
    const drawn = afterFirstLayout(asked, first, stepLayout, stepLayout, stepLayout);
    if (isRefused(drawn)) return read(first, false);
    const need = sizeNeed(first);
    return { ...read(drawn, true), ...(need !== undefined && need > width ? { upper: need } : {}) };
  }), known);
  // Drawn compact: the full chart's need is the width a refusing full layout names.
  const full = cached(refusedAt((width) => {
    const drawn = any(width);
    if (!drawn.draws || (drawn.result as Geometry).mode !== 'compact' || own.mode === 'compact') return drawn;
    const probe = layoutAt({ ...request.options, belowMinimum: 'refuse', size: { width }, [WIDTH_PROBE]: request.type } as RequestOptions);
    return { draws: false, floor: sizeNeed(probe), result: drawn.result };
  }));
  return { full, any };
}

/**
 * The smallest whole width from which every wider width draws: the one search render advice, measure,
 * canDraw and React read. It starts at `top` and follows the widths size refusals name up to one that
 * draws. The first pixel of each wider type class (720 and 1080 px) must draw too, else the search
 * starts there; widths from `verifiedFrom` on are known to draw. Then it steps down: a drawn width
 * names the floor of its own form, the next width tried, and the answer is a drawn floor, or a width
 * a refusal named (`topNamed` for `top`), whose next narrower pixel does not draw. A form's floor holds
 * in its own type class, and a floor that does not draw is searched between it and the drawn width
 * above. Widths at or under `bottom` are never tried. A form that refuses only between a floor and the
 * width above it is not seen.
 */
function drawsFrom(at: (width: number) => WidthProbe, top: number, bottom: number, verifiedFrom = Infinity, topNamed = false): { width: number; probe: LayoutResult } | undefined {
  let hi = Math.max(Math.ceil(top), bottom + 1);
  let low = bottom;
  let probe = at(hi);
  // Whether a refusal or a class step named hi: the pixel under it is the likely edge.
  let named = topNamed;
  for (let round = 0; round < 4; round++) {
    for (let pass = 0; !probe.draws && pass < 8; pass++) {
      // A refusal that names no wider width: the next type class can still draw.
      const next = probe.floor !== undefined && Math.ceil(probe.floor) > hi ? Math.ceil(probe.floor) : TYPE_CLASS_STEPS.find(width => width > hi);
      if (next === undefined) return undefined;
      low = hi;
      hi = next;
      probe = at(hi);
      named = true;
    }
    if (!probe.draws) return undefined;
    const steps = TYPE_CLASS_STEPS.filter(width => width > hi && width < verifiedFrom);
    const step = steps.find(width => !at(width).draws);
    if (step !== undefined) {
      [low, hi, probe, named] = [step, step, at(step), true];
      continue;
    }
    // A width drawn in the next smaller class: from the width its own class names, that class draws again,
    // and it can draw compact there first.
    const upper = Math.max(0, ...[hi, ...steps].map(width => at(width).upper ?? 0).filter(width => width > hi && width < verifiedFrom));
    if (upper === 0 || at(upper).draws) break;
    [low, hi, probe, named] = [upper - 1, upper, at(upper), true];
  }
  if (!probe.draws) return undefined;
  const bisect = (from: number) => {
    let lo = from;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      // Past 2^53 the next whole number is no longer a number: the middle stops moving, so the search has its answer.
      if (mid <= lo || mid >= hi) break;
      const next = at(mid);
      if (next.draws) [hi, probe] = [mid, next];
      else lo = mid;
    }
    return { width: hi, probe: probe.result };
  };
  for (let pass = 0; pass < 8; pass++) {
    if (hi - 1 <= low) return { width: hi, probe: probe.result };
    // At a width a refusal named or a floor, the next narrower pixel first: a form often needs a few
    // pixels more just under the width that draws it.
    const stepped = named;
    if (named) {
      const below = at(hi - 1);
      if (!below.draws) return { width: hi, probe: probe.result };
      [hi, probe] = [hi - 1, below];
    }
    const classStart = [...TYPE_CLASS_STEPS].reverse().find(width => hi >= width) ?? low + 1;
    const floor = probe.floor === undefined ? hi : Math.min(hi, Math.max(low + 1, classStart, Math.ceil(probe.floor)));
    // A narrower pixel that draws and names no narrower floor: the edge is further down.
    if (floor >= hi && stepped) break;
    named = true;
    if (floor < hi) {
      const atFloor = at(floor);
      if (!atFloor.draws) return bisect(floor);
      [hi, probe] = [floor, atFloor];
    }
  }
  return bisect(low);
}

/** The first pixel of each type class above S (theme.ts `typeWidthClass`). */
const TYPE_CLASS_STEPS = [720, WIDE_CANVAS_MIN_WIDTH] as const;

/**
 * An open height grows with the width, so a size refusal at an open height advises the width alone:
 * the width from which this request draws under its own belowMinimum setting (`drawsFrom`), the
 * compact chart's where the request falls back to compact. The height is the one drawn there. A
 * pinned height keeps the pair.
 */
function drawnAdvice(request: ResolvedChartRequest, result: LayoutResult, layoutAt: LayoutCall<any, any, any>): LayoutResult {
  if (!result.refused) return result;
  const advised = advisedRefusal(result, advisedWidth(request, result, () => widthProbers(request, layoutAt, refusalProbes(request, result)).any));
  // The advice keeps the asked size and names a wider width, so the smaller-class attempt advice made holds for it too.
  const step = classSteps.get(result);
  if (step && advised !== result) classSteps.set(advised, step);
  return advised;
}

/**
 * The stored width probes of a request at an open height. Render advice stores those of a size refusal,
 * measure those of every search, so a render and then a measure, or a measure at another width, lays out
 * a width once. A story is laid out only once its layer loads, so a stored probe of a story request can keep
 * the plain chart's size. `verify` marks measure's own layouts (VERIFY_ADVICE), which a table lays out otherwise.
 */
function refusalProbes(request: ResolvedChartRequest, result: LayoutResult, verify = false): Map<number, WidthProbe> | undefined {
  return result.refused && result.warnings[0]?.code === 'size-below-floor' ? openWidthProbes(request, verify) : undefined;
}

function openWidthProbes(request: ResolvedChartRequest, verify: boolean): Map<number, WidthProbe> | undefined {
  return !request.fixed.height && !(request.options as { story?: unknown }).story ? storedProbes(request, verify) : undefined;
}

const storedSearches = new Map<string, Map<number, WidthProbe>>();
const STORED_WIDTHS = 64;
const STORED_REQUESTS = 32;
const STORED_KEY_LENGTH = 200_000;

/**
 * A probe at a width depends on the request without its size, so a host that renders or measures a request
 * again at another width (a container that resizes, an agent that tries several widths) reuses the widths
 * the last search drew. The key holds the content of the data the layout reads and of the options, so a new
 * copy of the same request reuses them and an edit lays out again. The key covers data made of plain objects,
 * arrays, dates and JSON values only; other data (class instances, a Map, a BigInt) is searched without a store.
 * ponytail: STORED_REQUESTS requests of at most STORED_KEY_LENGTH key characters and STORED_WIDTHS widths
 * each; a new one replaces the oldest.
 */
function storedProbes(request: ResolvedChartRequest, verify: boolean): Map<number, WidthProbe> | undefined {
  if (request.data === null || typeof request.data !== 'object' || !jsonShowsAll(request.data)) return undefined;
  const { size: _size, ...options } = request.options as RequestOptions;
  const { type, theme, target, fixed, inputWarnings } = request;
  // The static footer changes a chart's size once a static entry links it.
  const footer = loadedDeferred('footer') !== undefined;
  let key: string;
  try {
    key = withPlanInputs(() => contentKey(request.data as object, options, { type, theme, target, fixed, inputWarnings, footer, verify }));
  } catch { return undefined; } // A BigInt in the options or a cycle: no store.
  if (key.length > STORED_KEY_LENGTH) return undefined;
  let probes = storedSearches.get(key);
  if (probes) storedSearches.delete(key);
  else if (storedSearches.size >= STORED_REQUESTS) storedSearches.delete(storedSearches.keys().next().value!);
  storedSearches.set(key, probes ??= new Map());
  return probes;
}

/** Whether JSON shows everything a layout can read from the data: plain objects, arrays, dates and JSON values. */
function jsonShowsAll(data: object): boolean {
  const open: unknown[] = [data];
  const seen = new Set<object>();
  while (open.length) {
    const value = open.pop();
    if (typeof value === 'bigint') return false;
    if (value === null || typeof value !== 'object' || seen.has(value) || value instanceof Date) continue;
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
    for (const item of Object.values(value)) open.push(item);
  }
  return true;
}

/** A size refusal that names the width `advisedWidth` found, and the height drawn there. */
function advisedRefusal(result: LayoutResult, found: { width: number; probe: LayoutResult } | undefined): LayoutResult {
  if (!found || !result.refused) return result;
  const { width, probe: drawn } = found;
  const height = Math.max(Math.ceil(drawn.size.height), Math.ceil(result.sizing.minHeight));
  const advice = sizeRefusal(result.type, result.title, result.size, { ...result.sizing, minWidth: width, minHeight: height }).warnings[0]!;
  const warning = {
    ...advice,
    message: `${result.title} needs at least ${width}px of width; received ${Math.round(result.size.width)}px`,
    suggest: `Render it at ${width}px wide or wider; the height follows the width.${result.sizing.hint ? ` ${result.sizing.hint}` : ''}`,
    fix: [{ op: 'replace' as const, path: '/options/size', value: { width } }],
  };
  return { ...result, warnings: [warning, ...result.warnings.slice(1)] };
}

/** The width an open-height size refusal names: where the request draws from, searched up from the width the layout named. */
function advisedWidth(request: ResolvedChartRequest, result: LayoutResult, any: () => (width: number) => WidthProbe): { width: number; probe: LayoutResult } | undefined {
  const finding = result.refused ? result.warnings[0] : undefined;
  const need = finding?.code === 'size-below-floor' ? finding.expected?.minimum as Size | undefined : undefined;
  if (!result.refused || !need || request.fixed.height || need.width <= result.size.width) return undefined;
  // Drawn in the next smaller type class at the asked width: there is nothing to advise.
  if (smallerClass(request, result)) return undefined;
  return drawsFrom(any(), need.width, Math.floor(result.size.width), Infinity, true);
}

/** Grid children use the registered layout directly, so request diagnostics walk their authored input here. */
function inputPanels(data: unknown): { id: string; type: string; data: unknown; options?: RequestOptions }[] {
  const input = data as { panels?: unknown } | null;
  const normalized = Array.isArray(input?.panels) ? input : prepared(getChart('grid') ?? {}, data) as { panels?: unknown };
  return Array.isArray(normalized?.panels) ? normalized.panels : [];
}

function requestInputWarnings(type: string, data: unknown, options: RequestOptions, annotationsPath = ''): LintWarning[] {
  if (type !== 'grid') return [...percentScaleWarnings(data, options, type), ...fractionLineWarnings(data, options.annotations, annotationsPath)];
  return inputPanels(data).flatMap(panel => {
    const definition = getChart(panel.type);
    // Resolve defaults while the alias is still known, as the child layout does.
    return requestInputWarnings(definition?.type ?? panel.type, panel.data, { ...definition?.defaults, ...panel.options })
      .map(({ fix: _fix, ...warning }) => ({ ...warning, message: `[${panel.id}] ${warning.message}` }));
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
  // Treemap groups read color.treemap, else color.stack: a preset ramp the color.series override leaves in place.
  if (type === 'treemap') {
    if (color?.series === undefined || color.treemap !== undefined || color.stack !== undefined ||
      !geometry.scene.some(node => 'fill' in node && node.fill && 'theme' in node.fill && node.fill.theme?.kind === 'group-ramp')) return [];
    const theme = resolveTheme(ref);
    if ((theme.color.treemap ?? theme.color.stack) === undefined) return [];
    return [{ code: 'stack-palette-used', severity: 'warn',
      message: 'Treemap groups use color.treemap, else color.stack. The color.series override does not set that ramp.',
      suggest: 'Set theme.overrides.color.treemap, or set options.palette or a fill on each group.',
    }];
  }
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
    theme: { preset: typeof ref === 'string' ? ref : ref?.preset ?? DEFAULT_PRESET, overrides: request.theme },
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
  const draw = (frame: RequestOptions, fresh = false): LayoutResult => {
    if (!run) {
      const plain = () => disclose(def.layout(request.data, { ...frame, theme: options.theme, [REMOVED_NAMES]: options[REMOVED_NAMES] }));
      return (options as { [MARGIN_BELOW]?: true })[MARGIN_BELOW] ? withMarginStepBelow(plain) : plain();
    }
    const current: Record<PropertyKey, unknown> = fresh ? { ...options } : { ...options, [LAYOUT_CALL]: run };
    for (const key of ['size', 'mode', 'belowMinimum', FULL_LAYOUT_PROBE, WIDTH_PROBE, FIXED_SIZE_PROBE, PLAN_ONLY] as const) {
      if (Object.hasOwn(frame, key)) current[key] = (frame as RequestOptions & Record<PropertyKey, unknown>)[key];
      else delete current[key];
    }
    // A margin-stepped request lays out with the margins of the step under its width (marginBelowRequest).
    return (options as { [MARGIN_BELOW]?: true })[MARGIN_BELOW] ? withMarginStepBelow(() => disclose(def.layout(request.data, current))) : disclose(def.layout(request.data, current));
  };
  // The frame probes of a chart that drew in a smaller class draw as render does at that frame:
  // a smaller class lays out in a fresh call, as render's class step does.
  const at = ((frame: RequestOptions) => {
    const first = draw(frame);
    return classStepping && stepsDown(first) ? firstSmallerClass(first, () => draw(frame, true)) ?? first : first;
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
  // A grid panel's need is the panel's, which render reports too: no grid size is searched for it.
  const warning = result.warnings.find(w => w.code === 'plot-under-floor' && w.detail?.panelId === undefined);
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

/**
 * A table's tight-spacing size, laid out until the table at that size no longer tightens: its minimum moves
 * with the frame (wraps, head lines, the provisional height of an open one). Where no size settles within
 * four layouts, the warning keeps no patch.
 */
function measuredTightAdvice(request: ResolvedChartRequest, result: LayoutResult, layoutAt: LayoutCall<any, any, any>): void {
  const warning = result.warnings.find(w => tightAdvice(w) !== undefined);
  if (!warning || isRefused(result)) return;
  const asked = tightAdvice(warning)!;
  let size: ReturnType<typeof tightAdvice> = asked;
  for (let pass = 0; size && pass < 4; pass++) {
    const probe = layoutAt({ ...request.options, size });
    const again = isRefused(probe) ? undefined : probe.warnings.find(w => w.code === 'table-tight-spacing');
    if (!isRefused(probe) && !again) {
      const settled = size === asked ? warning : withTightAdvice(warning, asked, size);
      result.warnings = result.warnings.map(w => w === warning ? settled : w);
      return;
    }
    size = tightAdvice(again);
  }
  const { fix: _fix, ...rest } = warning;
  result.warnings = result.warnings.map(w => w === warning
    ? { ...rest, suggest: 'No size was verified within the measurement search bound. Reduce the content or change the table settings.' } : w);
}

function measureWithLayout(request: ResolvedChartRequest, result: LayoutResult,
  layoutAt: LayoutCall<any, any, any>, verify = false,
  asked: { request: ResolvedChartRequest; layoutAt: LayoutCall<any, any, any> } = { request, layoutAt },
): ChartMeasurement {
  // A chart one of render's later steps drew is measured as it drew: in its narrower form, or with
  // render's class step at every probed frame. measure and the CLI's measureLayout both pass through here.
  const step = drawnStep(result);
  if (step === 'smallerClass' && !classStepping) return measuredWithClassStep(() => measureWithLayout(request, result, layoutAt, verify, asked));
  if (step === 'marginStep' && !(request.options as { [MARGIN_BELOW]?: true })[MARGIN_BELOW]) {
    return measureSteps({ ...request, options: { ...request.options, [MARGIN_BELOW]: true } as RequestOptions });
  }
  if (step === 'narrowerForm' && !(request.options as { [NARROW_FORM]?: true })[NARROW_FORM]) {
    const narrow = { ...request, options: { ...request.options, [NARROW_FORM]: true } as RequestOptions };
    const run = preparedLayout(narrow, verify);
    try { return measureWithLayout(narrow, result, run, verify); } finally { run.finish(); }
  }
  measuredPlotAdvice(asked.request, result, asked.layoutAt);
  measuredTightAdvice(asked.request, result, asked.layoutAt);
  const def = getChart(request.type);
  // The declared floor, with the one option that lowers it (a compact KPI
  // card) — the same answer `fitLayout` gated the layout on.
  const declared = request.type === 'grid' && result.sizing?.fit === 'content' ? { ...declaredSizing(def!, request.options), minHeight: 0 } : def === undefined
    ? chartSizing(request.type, request.options as { density?: unknown })
    : declaredSizing(def, request.options);
  let sizing = resolveSizing(declared, result.size, result.sizing);
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
  // At an open height the width search below finds the minimum width and the height drawn there.
  const openWidth = !request.fixed.height && (!result.refused || sizeRepair);
  // Text and chrome depend on width. Verify the floor at the requested
  // width (or the minimum width when the request is narrower)
  // through the same registered layout that render uses, including its notes.
  const floorStart = sizing.minWidth;
  const naturalStart = sizing.naturalHeight;
  let floorDrawn = false;
  for (let pass = 0; !openWidth && pass < 8; pass++) {
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
    floorDrawn = verified;
    if (verified || (sizing.minWidth === previousWidth && sizing.minHeight === previousHeight)) break;
  }
  // A floor that no probe above drew (for example on a grid refused for mismatched category axes, which draws at no
  // height) is only the height the last refusal named, and the next probe can name a taller one at every pass. A size
  // refusal verifies its floor below. Any other answer then names no height above the frame or the declared floor.
  const unverifiedCap = Math.max(result.size.height, resolveSizing(declared, result.size).minHeight);
  if (!openWidth && !floorDrawn && !sizeRepair && sizing.minHeight > unverifiedCap) {
    const minHeight = unverifiedCap;
    sizing = resolveSizing({ ...sizing, minHeight }, result.size, { ...sizing, minHeight,
      measuredMinHeight: Math.min(sizing.measuredMinHeight, minHeight), naturalHeight: Math.max(minHeight, Math.min(sizing.naturalHeight, naturalStart)) });
  }
  // A refusal names the width its own form needs, which can be wider than the asked width, where another
  // form draws at the floor height. The minimum width is then the narrowest width that draws there.
  const drawnWidth = Math.ceil(request.size.width);
  if (!openWidth && !result.refused && !isRefused(result) && sizing.minWidth > drawnWidth
    && !isRefused(probeAt({ width: drawnWidth, height: sizing.minHeight }))) {
    let [lo, hi] = [Math.floor(floorStart), drawnWidth];
    if (!isRefused(probeAt({ width: lo, height: sizing.minHeight }))) hi = lo;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (isRefused(probeAt({ width: mid, height: sizing.minHeight }))) lo = mid; else hi = mid;
    }
    sizing = resolveSizing({ ...sizing, minWidth: hi }, result.size, { ...sizing, minWidth: hi });
  }
  // At the automatic height a width alone takes the height it needs, so the floor above, verified at
  // minHeight, is not the minimum width. The minimum width is the one `drawsFrom` finds for the full
  // chart, searched from the asked width or that floor, whichever is wider. The pair grows to the
  // height drawn there, so the size a refusal names draws too.
  const staticMinWidth = def === undefined ? 0 : declaredSizing(def, request.options).minWidth;
  // The search shares its probes with render advice and with earlier measures of the same request at other widths.
  const probers = widthProbers(request, layoutAt, openWidth ? openWidthProbes(request, verify) : undefined, verify);
  let fullFrom = Infinity;
  if (openWidth) {
    const full = drawsFrom(probers.full, Math.max(request.size.width, sizing.minWidth), staticMinWidth - 1);
    if (full) {
      fullFrom = full.width;
      // The pinned height that draws from `from` at a width; a pinned frame can name a taller one.
      const pinned = (width: number, from: number): number => {
        try { return minHeightAtWidth(request, width, from, undefined, probeAt); }
        catch (error) { if (!(error instanceof NormalizeError)) throw error; return from; }
      };
      // The declared height where a pinned frame at the minimum width draws with it, else the height drawn there.
      // Either is verified at the asked width too.
      const least = pinned(full.width, sizing.minHeight);
      const floor = isRefused(probeAt({ width: full.width, height: least }))
        ? pinned(full.width, Math.max(sizing.minHeight, Math.ceil(full.probe.size.height))) : least;
      const height = request.size.width > full.width ? pinned(request.size.width, floor) : floor;
      sizing = resolveSizing({ ...sizing, minWidth: full.width, minHeight: height }, result.size,
        { ...sizing, minWidth: full.width, minHeight: height, measuredMinWidth: Math.min(sizing.measuredMinWidth, full.width) });
    }
  }
  // The pair above is safe at the minimum width too. A host at one width needs the height for that width.
  // Keep the width-specific height lazy. A caller that does not read it needs no extra layouts.
  const atWidth = Math.max(request.size.width, sizing.minWidth);
  // The one width a size refusal at an open height names, as render names it.
  const advised = openWidth ? advisedWidth(request, result, () => probers.any) : undefined;
  let atHeight: number | undefined;
  // The compact floor is reported only where this spec draws: the least height that draws at the
  // compact width, which the compact refusal there names. A spec that draws nowhere at that width
  // reports no compact floor, so a host never lays out at a size that refuses. Neither does a spec
  // without the fallback (`mode: 'full'`, `belowMinimum: 'refuse'`).
  if (sizing.compactFloor && def !== undefined && !compactFallbackApplies(def, { ...request.options, size: sizing.compactFloor }, request.data)) {
    const { compactFloor: _off, ...rest } = sizing;
    sizing = rest;
  } else if (sizing.compactFloor && def !== undefined) {
    // At an open height the compact floor is the width from which the request draws at all: the width a
    // size refusal names, or else the search down from the minimum width, where the full chart draws.
    const from = !openWidth ? undefined : advised ?? drawsFrom(probers.any, Math.min(sizing.compactFloor.width, sizing.minWidth), 0, fullFrom);
    const width = from?.width ?? sizing.compactFloor.width;
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
    // Render's steps after a refusal (stepped type on a slide) draw at the width the search found, where a
    // pinned frame without them can refuse: the height drawn there.
    if (!drawn && from) [drawn, height] = [true, Math.ceil(from.probe.size.height)];
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
  // A column that stepped to bars drew a bar, whose natural and comfortable sizes hold only at this
  // width. Those sizes are advice for the natural width, so they come from the chart drawn there.
  if (!result.refused && !isRefused(result) && drawnRequest(request, result) !== request && Math.ceil(result.size.width) !== sizing.naturalWidth) {
    const wide = layoutAt.probe({ ...request.options, size: { width: sizing.naturalWidth } });
    if (!isRefused(wide) && wide.sizing) {
      const { fit, aspect, naturalHeight, comfortableWidth, comfortableHeight } = wide.sizing;
      sizing = { ...sizing, fit, aspect, naturalHeight, comfortableWidth, comfortableHeight };
    }
  }
  // All measurement fields and repair advice describe the verified floor. A canvas below the full
  // floor that falls back to compact keeps the size compact needs, which the layout named (the
  // `belowMinimum: 'compact'` contract): the full floor is not the size the host must give.
  let updated = result.refused ? advised ? advisedRefusal(result, advised) as RefusedLayout : sizeRefusal(result.type, result.title, result.size, sizing) : undefined;
  const compactNeed = sizeRepair && !advised && def !== undefined && compactFallbackApplies(def, request.options, request.data) && !fitsSize(result.size, sizing)
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
  if (sizeRepair && updated && !compactNeed && !advised) {
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
  const measured = measureSteps(request);
  // The same margin step as layoutResolvedRequest: a chart render draws with the margins of the step below is measured so.
  const below = measured.refused && marginBelowRequest(request, measured.refused as LayoutResult);
  if (!below) return measured;
  const stepped = measureSteps(below);
  return stepped.refused ? measured : stepped;
}

function measureSteps(request: ResolvedChartRequest): ChartMeasurement {
  const runs: LayoutCall<any, any, any>[] = [];
  const open = (opened: ResolvedChartRequest) => { const run = preparedLayout(opened, true); runs.push(run); return run; };
  try {
    let asked = request;
    let layoutAt = open(request);
    const askedAt = layoutAt;
    let first = layoutAt(request.options);
    const initial = first;
    // The same step as layoutResolvedRequest, so measure agrees with render and canDraw; the sizing probes then use the stepped text.
    const stepped = steppedType(request, first, steppedRequest => { layoutAt = open(steppedRequest); return layoutAt(steppedRequest.options); });
    const drawnBy = (opened: ResolvedChartRequest) => open(opened)(opened.options);
    const fitted = widthsGiveWay(request, first, drawnBy);
    if (fitted) return measureWithLayout(fitted[0], fitted[1], open(fitted[0]), true);
    if (stepped) [asked, first] = stepped;
    const plainRequest = withoutAskedNotes(asked, first);
    if (plainRequest) {
      const plainAt = open(plainRequest);
      const plain = plainAt(plainRequest.options);
      // The caller's spec keeps its notes: at a size that has room they draw again, so size advice probes the request as asked.
      if (!plain.refused) return measureWithLayout(plainRequest, askedNotesOff(plain, first), plainAt, true, { request, layoutAt: askedAt });
    }
    const unchangedTable = (request.type === 'table' || request.type === 'dimswitch') && asked === request && first === initial;
    const fittedLate = unchangedTable ? undefined : widthsGiveWay(asked, first, drawnBy);
    if (fittedLate) return measureWithLayout(fittedLate[0], fittedLate[1], open(fittedLate[0]), true);
    // The same class step as layoutResolvedRequest, so measure does not refuse a chart that render draws.
    const smaller = smallerClass(asked, first, drawnBy);
    // The floor probes and the width search take render's class step (measureWithLayout).
    if (smaller) return measureWithLayout(asked, typeStepped(first, smaller), layoutAt, true);
    // And the same narrower form. The floor probes and the width search then lay out that form too,
    // so the minimum width is one the drawn form reaches, at an open and at a pinned height.
    // A narrower form that is refused too leaves the request as asked, with its own layout: its probes must not draw the narrower form.
    let narrowRequest = asked;
    let narrowAt = layoutAt;
    const narrow = narrowerForm(asked, first, (opened) => { narrowRequest = opened; narrowAt = open(opened); return narrowAt(opened.options); });
    return narrow ? measureWithLayout(narrowRequest, typeStepped(first, narrow), narrowAt, true) : measureWithLayout(asked, first, layoutAt, true);
  } finally { for (const run of runs) run.finish(); }
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
