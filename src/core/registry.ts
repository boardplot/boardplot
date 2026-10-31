/**
 * Chart registry. Charts are values; the registry is the single
 * source for the CLI, JSON Schemas, docs, React component generation, and
 * third-party extension.
 */

import { prepareFractionAnnotations } from './normalize/fraction';
import type { z } from 'zod';
import { withChartDefaultStrings, withLocaleStrings } from './strings';
import { withNumberMarks } from './numberMarks';
import type { Annotation, AnnotationKind } from './types/annotations';
import type { Id, OwnerRef } from './types/cell';
import type { BaseOptions, RenderTarget } from './types/options';
import { withSmallValues } from './formatPrecision';
import type { Geometry, LayoutResult, LintWarning, RefusedLayout } from './types/scene';
import type { ChartSizing } from './types/sizing';
import { chartSizing, declaredSizing, fitsSize, compactFallbackApplies, FORCE_COMPACT, LAYOUT_CALL, FULL_LAYOUT_PROBE, type LayoutCall, plotRepairHeight, WIDTH_PROBE, FIXED_SIZE_PROBE, ACCEPTANCE_PROBE, CARD_HEIGHT_MEMO, type CardHeightMemo, type FitLayout, isWidthProbe, compactReplacesRefusal, sizeRefusal, withoutForcedCompact, hiddenForSpace, narrowShareApplies, PLOT_SHARE, PLOT_FLOOR_SHARE, withLayoutMemo, SIZE_TOLERANCE } from './sizing';
import { NormalizeError, resolveCanvasOptions, resolveSize } from './normalize/shared';
import { checkItemBudget } from './itemBudget';
import { DENSITY_VALUES, UNVERIFIED_DENSITY_REFUSALS, authoredNotes, dataOrder, densityNoteInList, hiddenNoteLine, withDensityNotes, withCutLabelNotes, finishCutLabelNotes, footnoteSwitch, markNotedLabels, owedHiddenLabels, withHiddenLabelNote, withNoteInA11y } from './frame';
import { layoutWithLegendPolicy, prepareLegendLayout } from './legendPolicy';
import { loadedDeferred } from './deferred';
import { markLostOnBandWarnings } from './paintWarnings';
import { casingUnderFills, labelsOnFills, fillEdges, marksOnBands, referenceLineClearance, withoutOrphanAnnotationMarks } from './markVisibility';
import { groundEdges } from './label/emit';
import { withoutRepeatedAxisBreaks } from './axis';
import { panelTypeClass, REMOVED_NAMES, removedNameWarnings, resolveTargetTheme, stampHatchLook } from './theme';
import { textScaleOf, textSizeOf } from './typeFloors';
import { DEFAULT_TARGET, resolveTargetSize, TARGET_SIZE, withDefaultTarget } from './target';
import type { Category } from './types/data';
import { presentationInfo } from './themeGeometry';
import { chartRefusals, isRefused } from './schema/refusals';
import { rectsOverlap } from './geometry';
import { isOwnMark } from './label/solver';
import { reportLabelOmissions } from './label/omissions';
import { withCalendarLabels } from './calendarData';
import { staticFrame } from './footer';
import { addWhereAbsent } from './diagnostics/jsonPatch';
import { pushAll } from './arrays';

/** Chart types may refine shared mode names and label content. */
export type ChartOptions = Omit<BaseOptions, 'mode' | 'labels'> & { mode?: unknown; labels?: false | Partial<Record<import('./types/options').LabelKind, boolean | string[]>> };

/**
 * A layout that draws reports an estimated height and no patch: the estimate was never drawn, and a patch that
 * was not drawn can end in a refusal. Exact repair verification belongs to measure.
 */
function estimatedPlotAdvice<M extends object, DV extends object>(result: LayoutResult<M, DV>, options: ChartOptions | undefined): void {
  const warning = result.warnings.find(w => w.code === 'plot-under-floor');
  if (!warning || isRefused(result) || result.refused) return;
  // A taller frame can restore larger text and labels; reserve 25% without another layout.
  const height = Math.ceil(plotRepairHeight(result, options?.target ?? DEFAULT_TARGET) * 1.25);
  const { fix: _fix, ...rest } = warning;
  result.warnings = result.warnings.map(w => w === warning ? { ...rest,
    message: `${rest.message.replace(/; (?:the chart needs|the estimated height is) .*$/, '')}; the estimated height is ${height} px; use measure for the exact verified size`,
    suggest: 'Use measure for the exact verified size, or leave options.size.height out.',
  } : w);
}

export type LayoutFn<D, O extends ChartOptions, M extends object, DV extends object> = (
  data: D,
  options?: O,
) => LayoutResult<M, DV>;

export interface Fixture<D = unknown, O = unknown> {
  id: Id;
  title: string;
  kind: 'example' | 'torture';
  /** Additional authored tags. Registered fixtures always include their canonical tag from kind. */
  tags?: string[];
  hover?: { owner: OwnerRef; panel?: string };
  /**
   * A refusal example: the spec exists to show a refusal, so the CLI and
   * React refuse it with this code, at this path when given (the dotted display
   * path, such as 'options.legend'). getFixtures leaves it out, since nothing
   * can draw it; getRefusalExamples returns it for the gallery and the test that
   * holds it refused. Its title starts with "Refusal example".
   */
  refuses?: { code: string; path?: string };
  /**
   * A headless fixture (title: false) is drawn for a host that prints the
   * message title above it. The gallery shows it in such a host frame
   * with this title; rendered alone, it warns missing-message-title.
   */
  hostTitle?: string;
  data: D;
  options?: O;
  annotations?: Annotation[];
}

export interface ChartCore<
  D = unknown,
  O extends ChartOptions = BaseOptions,
  M extends object = Record<string, unknown>,
  DV extends object = Record<string, unknown>,
> {
  type: string;
  /** Resolved on registration; omitted custom definitions use the standard floor. */
  sizing?: ChartSizing;
  title: string;
  summary: string;
  aliases?: string[];
  /** Alias-specific values for existing options, applied before authored options. */
  aliasDefaults?: Record<string, Partial<O>>;
  layout: LayoutFn<D, O, M, DV>;
  defaults: Partial<O>;
  annotationKinds: AnnotationKind[];
  lint?(data: D, options: O): LintWarning[];
  /** `options` is the resolved request's, where there is one: a line on a continuous x axis reads its zone there. */
  prepare?(data: D, options?: O): D;
  /** The chart's own wording for shared string keys, over the locale fill; the caller's words still win. */
  defaultStrings?(options: O): Record<string, string>;
  /**
   * Labels date categories the author left unlabelled (calendarLabels.ts).
   * Only types whose data has `categories` set it, so the date code stays out
   * of the other React entries.
   */
  categoryLabels?(categories: readonly (string | Category)[], language?: string): Category[] | undefined;
  /**
   * Band charts: full mode prints every category name. A finished full chart that hides
   * one falls back to compact when compact prints them all, else it refuses and names the blockers.
   * The check runs on the finished chart, not on the size probes: a probe at a short first height
   * hides names the grown chart prints.
   */
  namesMustPrint?: boolean;
  /**
   * The layout under legend 'none' when the chart
   * keeps a key no drawn label replaces. It gets the 'none' layout and the
   * fit layout for the key row. Only the grid core sets it, so its code stays
   * out of the other React entries.
   */
  requiredKey?(baseline: Geometry<M, DV>, data: D, options: O, fitKeyed: FitLayout<O, M, DV>): LayoutResult<M, DV>;
  /**
   * Whether this data has the type's compact form. A type whose compact form exists for some data
   * only (the grid stacks an authored layout of several columns) sets it; the others have one for all data.
   */
  compactForm?(data: D, options: O | undefined): boolean;
}

export interface ChartDefinition<
  D = unknown,
  O extends ChartOptions = BaseOptions,
  M extends object = Record<string, unknown>,
  DV extends object = Record<string, unknown>,
> extends ChartCore<D, O, M, DV> {
  /** Authoring guidance stays with schema definitions, outside browser chart cores. */
  discovery?: {
    /** A data shape the type cannot draw, when there is one; the reference prints it under "Not for". */
    notFor?: string;
    example: { data: unknown; options?: Record<string, unknown> };
    /**
     * Per density value, the options it refuses when they ask for content
     * (bullet's compact): the dotted key, the value that asks, the
     * values accepted as no-ops, and the refusal's message. Describe --full prints it.
     */
    densities?: Record<string, Array<{ key: string; contentForm: unknown; noOpForms?: unknown[]; message: string }>>;
  };
  normalize(raw: unknown): D;
  dataSchema: z.ZodType<D>;
  /** Explicit option keys that select one data branch before validation. */
  dataSchemaByOption?: Record<string, z.ZodType>;
  optionsSchema: z.ZodType<O>;
}

export type RegisteredChart<
  D = unknown,
  O extends ChartOptions = BaseOptions,
  M extends object = Record<string, unknown>,
  DV extends object = Record<string, unknown>,
> = ChartCore<D, O, M, DV> & { sizing: ChartSizing;
  [LAYOUT_CALL]?: (data: D, options?: O) => LayoutCall<O, M, DV>;
} &
  Partial<Pick<ChartDefinition<D, O, M, DV>, 'normalize' | 'dataSchema' | 'dataSchemaByOption' | 'optionsSchema' | 'discovery'>>;

/**
 * What validation needs of a chart type: the two schemas and the canonical
 * name. A `ChartDefinition` is one; so is a type's `schema.ts` on its own,
 * which carries no layout and registers no engine.
 */
export interface ChartSchemas<D = unknown, O extends ChartOptions = BaseOptions> {
  type: string;
  /** Existing option defaults carried by an alias before its type is canonicalized. */
  aliasDefaults?: Record<string, Partial<O>>;
  dataSchema: z.ZodType<D>;
  /** Explicit option keys that select one data branch before validation. */
  dataSchemaByOption?: Record<string, z.ZodType>;
  optionsSchema: z.ZodType<O>;
}

const registry = new Map<string, RegisteredChart<any, any, any, any>>();
const aliasIndex = new Map<string, string>();
const registryWaiting = new Set<() => void>();
let registryRevision = 0;

/** Runs when a chart type registers. A plan made before its chunk arrived runs again. */
export function onChartRegistered(redraw: () => void): () => void {
  registryWaiting.add(redraw);
  return () => { registryWaiting.delete(redraw); };
}

/** The store snapshot: a number that changes when a chart type registers. */
export function chartRegistryRevision(): number {
  return registryRevision;
}

/**
 * The engine-free index beside the chart registry. `BoardplotChart` fills it
 * from the schema chunk of the type a spec names, before — often long before
 * — that type's engine arrives, so validation reads its schemas here while
 * `getChart` still answers undefined and the chart draws the placeholder.
 */
const schemaIndex = new Map<string, ChartSchemas<any, any>>();
const schemaAliasIndex = new Map<string, string>();

function isDefinition(
  chart: ChartCore<any, any, any, any> & Partial<ChartDefinition<any, any, any, any>>,
): chart is ChartDefinition<any, any, any, any> {
  return (
    typeof chart.normalize === 'function' &&
    chart.dataSchema !== undefined &&
    chart.optionsSchema !== undefined
  );
}

export function registerChart<D, O extends ChartOptions, M extends object, DV extends object>(
  def: ChartCore<D, O, M, DV> | ChartDefinition<D, O, M, DV>,
): void {
  const existing = registry.get(def.type);
  const incomingIsDefinition = isDefinition(def);
  if (existing && isDefinition(existing)) {
    if (!incomingIsDefinition) return;
    throw new Error(`chart type '${def.type}' already registered`);
  }
  if (existing && !incomingIsDefinition) return;
  const typeAliasOwner = aliasIndex.get(def.type);
  if (typeAliasOwner && typeAliasOwner !== def.type) {
    throw new Error(`chart type '${def.type}' conflicts with alias owned by '${typeAliasOwner}'`);
  }
  const aliases = def.aliases ?? [];
  const aliasesInDefinition = new Set<string>();
  for (const alias of aliases) {
    if (alias === def.type) {
      throw new Error(`chart alias '${alias}' duplicates its own chart type`);
    }
    if (aliasesInDefinition.has(alias)) {
      throw new Error(`chart alias '${alias}' is declared more than once on '${def.type}'`);
    }
    aliasesInDefinition.add(alias);
    if (registry.has(alias) && alias !== def.type) {
      throw new Error(`chart alias '${alias}' conflicts with registered chart type '${alias}'`);
    }
    const aliasOwner = aliasIndex.get(alias);
    if (aliasOwner && aliasOwner !== def.type) {
      throw new Error(`chart alias '${alias}' is already owned by '${aliasOwner}'`);
    }
  }
  // Enforce annotationKinds uniformly: unsupported kinds are stripped before
  // layout and surfaced as a warning — never silently swallowed, never
  // accidentally rendered.
  const sizing = def.sizing ?? chartSizing(def.type);
  const supported = new Set(def.annotationKinds);
  const prepareLayout = (data: D, authored?: O): FitLayout<O, M, DV> => {
    const annotations = prepareFractionAnnotations(authored?.annotations);
    if (annotations !== authored?.annotations) authored = { ...authored, annotations } as O;
    const target = authored?.target ?? DEFAULT_TARGET;
    const removedNames = (authored as { [REMOVED_NAMES]?: LintWarning[] } | undefined)?.[REMOVED_NAMES] ?? removedNameWarnings(authored);
    const textScale = textScaleOf(authored);
    const textSize = textSizeOf(authored);
    const theme = resolveTargetTheme(authored?.theme, target, textScale, textSize);
    const ref = authored?.theme;
    // One pair of number marks per chart (numberMarks.ts).
    const localized = withNumberMarks(withLocaleStrings(footnoteSwitch(resolveCanvasOptions({ ...authored, target,
      theme: { preset: typeof ref === 'string' ? ref : ref?.preset ?? 'boardroom', overrides: theme },
    } as unknown as O))));
    const prepared = def.defaultStrings ? withChartDefaultStrings(localized, def.defaultStrings(localized)) : localized;
    if (def.type === 'grid') data = inheritGridTarget(data, target, textScale, textSize);
    if (def.categoryLabels) data = withCalendarLabels(data, authored?.locale?.language, def.categoryLabels);
    const origins = new WeakMap<object, object>();
    const legendLayout = prepareLegendLayout(def, data, origins);
    // The fixed result's identity includes its labels and their geometry.
    // Equal note text at another frame cannot reuse this note variant.
    let noteLayouts = new WeakMap<object, Map<string, FitLayout<O, M, DV>>>();
    const noteRuns: FitLayout<O, M, DV>[] = [];
    const layoutBody = ((options?: O) => {
    // Only the frame and search markers change within this prepared call.
    const sizeTarget = options?.size === undefined && ['kpi', 'bullet', 'sparkline'].includes(def.type)
      && (target === 'slide' || target === 'print') ? 'report' : target;
    const resolved = panelTypeClass(prepared) !== undefined && options?.size !== undefined
      ? { sizePx: resolveSize(options.size, target), fixed: { width: true, height: true } }
      : resolveTargetSize(sizeTarget, options?.size);
    const frame = options;
    const current: Record<PropertyKey, unknown> = { ...prepared };
    for (const key of ['size', 'mode', 'belowMinimum', FORCE_COMPACT, WIDTH_PROBE, FIXED_SIZE_PROBE] as const) {
      if (frame && Object.hasOwn(frame, key)) current[key] = (frame as O & Record<PropertyKey, unknown>)[key];
      else delete current[key];
    }
    options = { ...current,
      size: resolved.fixed.height ? resolved.sizePx : { width: resolved.sizePx.width },
      [TARGET_SIZE]: resolved,
    } as unknown as O;
    const densityFixed = DENSITY_VALUES in options && resolved.fixed.height;
    if (densityFixed) options = { ...options, [FIXED_SIZE_PROBE]: true } as O;
    const anns = options?.annotations;
    const dropped = anns?.filter((a) => !supported.has(a.kind)) ?? [];
    const layoutOptions = dropped.length === 0 ? options : { ...(options as O), annotations: anns!.filter((a) => supported.has(a.kind)) };
    // a value, name, value line, annotation or pinned label the
    // solver hid is named in the note line. The note takes height and can
    // hide another label, so the chart is laid out again with every label
    // named so far until nothing is owed, up to the finite label population. A failed pass
    // suggests more height only if the proposed size resolves it.
    // A grid panel's grid speaks for it.
    const pins = options?.labelPlacements;
    // An authored 'minimal' drops values by request: the note does not list them.
    const minimal = (options as { labelDensity?: string } | undefined)?.labelDensity === 'minimal';
    const nested = panelTypeClass(options) !== undefined;
    let lastGeometry: Geometry<M, DV> | undefined;
    const named = (runOptions: O | undefined, probeHeight = true): { geo: LayoutResult<M, DV>; noteRefused: boolean } => {
      let geo = legendLayout(runOptions);
      if (geo.refused || nested) return { geo, noteRefused: false };
      lastGeometry = geo;
      const first = geo;
      const noted = new Map<string, string>();
      let owed = owedHiddenLabels(geo, data, pins, options?.annotations, minimal);
      let previousOwed: string | undefined;
      for (let run = 0; owed.size > 0; run++) {
        // A pass that owes the same labels the note already names
        // repeats the last pass exactly; go to the run limit's answer now (otherwise a choropleth compact
        // measure repeats 24 identical passes per probe height).
        const owedKey = [...owed.keys()].sort().join('\u0000');
        const stalled = owedKey === previousOwed && [...owed.keys()].every((id) => noted.has(id));
        previousOwed = owedKey;
        // each note pass can displace another larger label; finish the finite label population.
        if (stalled || run === first.labels.length + 1) {
          const refusal = hiddenLabelRefusal(def.title, first, geo);
          const size = { width: refusal.sizing.minWidth, height: refusal.sizing.minHeight };
          // An estimate is advice only after the same note pass accepts it.
          const probe = probeHeight ? named(withoutForcedCompact({ ...runOptions, size } as O), false).geo : undefined;
          const names = new Set([...noted.keys(), ...owed.keys()]);
          // Freed means drawn: at its point, or printed in the label that holds
          // it (a bump value in its name). A note naming it is no proof.
          const lost = probe && !probe.refused ? owedHiddenLabels({ ...probe, labels: probe.labels.map(({ noted: _noted, ...label }) => label) }, data, pins, options?.annotations, minimal) : undefined;
          if (probe && !probe.refused && !isRefused(probe) && ![...names].some(id => lost!.has(id))) {
            return { geo: refusal, noteRefused: true };
          }
          // The estimate can stop below the height at which
          // the note line seats. Before a refusal without a repair size, try up to three taller
          // heights (x1.25 each) through the same check and offer the first that draws.
          if (probeHeight) {
            let height = size.height;
            for (let step = 0; step < 3; step++) {
              height = Math.ceil(height * 1.25);
              const taller = named(withoutForcedCompact({ ...runOptions, size: { width: size.width, height } } as O), false).geo;
              // Drawn means every label is at its point, in its name, or named (or counted, under the 8-item
              // limit) by a note line in the notes list (a note only in the description is no proof). The
              // frame prints that line where notes.show lists 'disclosure'.
              if (taller.refused || isRefused(taller)) continue;
              const missing = owedHiddenLabels({ ...taller, labels: taller.labels.map(({ noted: _noted, ...label }) => label) }, data, pins, options?.annotations, minimal);
              const pageNotes = [...(taller.frame?.notes ?? []), ...(taller.frame?.noteList ?? []).map(entry => entry.text)];
              if ([...names].some(id => missing.has(id) && !taller.labels.some(label => label.id === id && label.noted && pageNotes.some(note => note.includes(label.text) || (label.noteCounted === true && note.length > 0))))) continue;
              const grown = sizeRefusal(def.type, def.title, refusal.size, { ...refusal.sizing, minHeight: height, measuredMinHeight: Math.min(refusal.sizing.measuredMinHeight, height) });
              grown.warnings[0]!.message += '; at this size it hides labels its note line has no room to name';
              return { geo: grown, noteRefused: true };
            }
          }
          // A canvas under the chart's own width floor explains the collision: the refusal names that floor.
          if (geo.sizing && geo.sizing.minWidth > geo.size.width + SIZE_TOLERANCE) return { geo: sizeRefusal(def.type, def.title, geo.size, geo.sizing), noteRefused: true };
          return { geo: hiddenLabelCollision(def.title, geo, owed, [...owed.keys()].every(id => noted.has(id))), noteRefused: true };
        }
        // Rounds find labels in the order they lose their seat; the note lists them in data order.
        const byData = dataOrder(data, geo.labels);
        const merged = [...noted, ...owed].sort(([a], [b]) => byData(a, b));
        noted.clear();
        for (const [id, item] of merged) noted.set(id, item);
        const noteOptions: O = withHiddenLabelNote((runOptions ?? {}) as O, noted, { data, labels: geo.labels, annotations: options?.annotations });
        let next: LayoutResult<M, DV>;
        // Gantt's full-card context changes during raw layout. Keep
        // its note passes in order; its wider-card memo replays that context.
        if (def.type === 'gantt') next = layoutWithLegendPolicy(def, data, noteOptions);
        else {
          const origin = origins.get(geo) ?? geo;
          let variants = noteLayouts.get(origin);
          if (!variants) noteLayouts.set(origin, variants = new Map());
          const noteKey = JSON.stringify([...noted]);
          let noteRun = variants.get(noteKey);
          if (!noteRun) {
            noteRun = prepareLegendLayout(def, data, origins);
            variants.set(noteKey, noteRun);
            noteRuns.push(noteRun);
          }
          next = noteRun(noteOptions);
        }
        // Only compact framing can move the note; a full fixed frame would repeat the same layout.
        const moved: O | undefined = !staticFrame.pinned && (geo.mode === 'compact' || !resolved.fixed.height)
          && next.refused && next.warnings[0]?.code === 'size-below-floor' ? withNoteInA11y(noteOptions) : undefined;
        // The line moves to the description: it leaves the composed footnotes too, or a layout
        // that draws its footnotes as written prints the capped line beside its own disclosure.
        const movedLine: string | undefined = moved ? hiddenNoteLine(noteOptions as object) : undefined;
        const inA11y: O | undefined = moved && movedLine
          ? { ...moved, footnotes: authoredNotes(moved as Pick<BaseOptions, 'footnotes'>).filter((note) => note !== movedLine) } as O
          : moved;
        if (inA11y) { const quiet: LayoutResult<M, DV> = layoutWithLegendPolicy(def, data, inA11y); if (!quiet.refused) next = quiet; }
        if (!staticFrame.pinned && next.refused && resolved.fixed.height && [...noted.keys()].every(id => first.labels.some(label => label.id === id && label.hidden === 'density'))) {
          return { geo: densityNoteInList(first, noteOptions as BaseOptions, new Set(noted.keys())), noteRefused: false };
        }
        if (next.refused) return { geo: next, noteRefused: true };
        markNotedLabels(next, new Set(noted.keys()), noteOptions);
        geo = next;
        lastGeometry = geo;
        owed = owedHiddenLabels(geo, data, pins, options?.annotations, minimal);
      }
      // The note's own line can free a seat, so the last run drew a value the note
      // names (markNotedLabels then took it off). One run without those names keeps it
      // on the chart when that run owes nothing new; else the note stands.
      const freed = new Set(geo.labels.filter((label) => label.hidden === 'note').map((label) => label.id));
      if (freed.size > 0) {
        const kept = new Map([...noted].filter(([id]) => !freed.has(id)));
        const keptOptions: O = withHiddenLabelNote((runOptions ?? {}) as O, kept, { data, labels: geo.labels, annotations: options?.annotations });
        const retry = layoutWithLegendPolicy(def, data, keptOptions);
        if (!retry.refused) {
          markNotedLabels(retry, new Set(kept.keys()), keptOptions);
          if (owedHiddenLabels(retry, data, pins, options?.annotations, minimal).size === 0 && !retry.labels.some((label) => label.hidden === 'note')) {
            geo = retry;
            lastGeometry = geo;
          }
        }
      }
      return { geo, noteRefused: false };
    };
    // Type steps: S (under 720 px) and M type differ, so a content minimum under
    // 720 px measured with M type can refuse at that width. One run at the minimum, in S type, tells:
    // refused on width, the chart reports the width that refusal names (at most 720).
    const sClassMinimum = <S extends NonNullable<typeof geo.sizing>>(minimum: S, size: { width: number; height: number }): S => {
      if (nested || isWidthProbe(def.type, options) || minimum.aspect !== 'content'
        || size.width < 720 || minimum.minWidth >= 720) return minimum;
      const at = Math.ceil(minimum.minWidth);
      let probe: ReturnType<typeof named>['geo'];
      // A chart whose text cannot wrap at the probe width throws (creative-text-overflow in German).
      // The probe only refines the reported minimum, so the chart that drew keeps it.
      // Only a width refusal counts here. The hidden-label note rounds add note lines, which take
      // height and never width, so the probe skips them; the notes the spec asks for stay in it.
      try { probe = legendLayout(withoutForcedCompact({ ...layoutOptions, [FIXED_SIZE_PROBE]: true,
        ...(def.type === 'gantt' && !resolved.fixed.height ? { [ACCEPTANCE_PROBE]: true } : {}),
        size: resolved.fixed.height ? { width: at, height: Math.max(size.height, minimum.minHeight) } : { width: at } } as O)); }
      catch (error) { if (error instanceof NormalizeError) return minimum; throw error; }
      return probe.refused && probe.warnings[0]?.code === 'size-below-floor' && probe.sizing && probe.sizing.minWidth > minimum.minWidth
        ? { ...minimum, minWidth: Math.min(720, probe.sizing.minWidth) } : minimum;
    };
    const geo = named(layoutOptions).geo;
    if (geo.refused) {
      // A refused density footer on a fixed frame returns the selected chart, not a repair size.
      if (densityFixed) return geo;
      // This search discards refusal details. Every branch below still returns
      // a refusal, so verifying its repair would not change the search result.
      // A fixed-size probe (measure's compact floor) takes the chart's own estimate the same way.
      if (isWidthProbe(def.type, options) || (options as { [FIXED_SIZE_PROBE]?: boolean })[FIXED_SIZE_PROBE] === true) return geo;
      // A grid's full refusal gives way to its compact form in layoutFitted: no repair search for it.
      if (compactReplacesRefusal(def, options, data)) return geo;
      // A floor measured before the omission note can hide another label at
      // its suggested size. Verify that size through the same note pass.
      if (!nested && geo.warnings[0]?.code === 'size-below-floor') {
        let floor = geo.sizing!;
        // A compact call's refusal names the size compact needs. A host that pins that size gets
        // compact through the fallback in layoutFitted, so the check draws compact there too, and
        // the full chart only where compact refuses. A full call keeps its full-chart check.
        const compactCall = compactFallbackApplies(def, options, data) && ((options as { [FORCE_COMPACT]?: boolean })[FORCE_COMPACT] === true
          || !fitsSize(resolved.sizePx, declaredSizing(def, options)));
        // Under the declared floor the full probe already runs compact (`belowMinimum`). At a size
        // that fits it, compact goes first: a drawing there settles it without the full chart's repair search.
        const hostView = (runOptions: O, probeHeight?: boolean) => {
          const size = runOptions?.size as { width: number; height: number };
          if (!compactCall || !fitsSize(size, declaredSizing(def, options))) return named(withoutForcedCompact(runOptions), probeHeight).geo;
          const compact = named({ ...runOptions, [FORCE_COMPACT]: true } as O, probeHeight).geo;
          if (!isRefused(compact)) return compact;
          const full = named(withoutForcedCompact(runOptions), probeHeight).geo;
          return isRefused(full) && compact.warnings[0]?.code === 'size-below-floor' ? compact : full;
        };
        const probeAt = (width: number, height: number) => hostView({ ...layoutOptions, size: { width, height } } as O);
        // A hidden-label note stays on a compact canvas, so each taller probe can add a note line; six passes reach it.
        for (let pass = 0; pass < 6; pass++) {
          const width = Math.max(geo.size.width, floor.minWidth);
          const probe = probeAt(width, Math.max(geo.size.height, floor.minHeight));
          if (!isRefused(probe) && floor.minHeight <= geo.size.height) return sizeRefusal(def.type, def.title, geo.size, sClassMinimum(floor, geo.size));
          if (!isRefused(probe)) {
            // The floor was measured with the frame lines of the refused size: a hidden-label note or a
            // disclosure that a taller frame does not print. Search down to the lowest height that
            // draws through the same note pass, so the refusal never names more than the chart needs.
            let low = geo.size.height;
            let high = floor.minHeight;
            const accepts = (height: number) => !isRefused(hostView({
              ...layoutOptions, size: { width, height }, [FIXED_SIZE_PROBE]: def.type !== 'gantt', [ACCEPTANCE_PROBE]: true,
            } as O, def.type === 'gantt'));
            if (!resolved.fixed.height && accepts(low + 1)) high = low + 1;
            while (high - low > 1) {
              const mid = Math.floor((low + high) / 2);
              if (accepts(mid)) high = mid; else low = mid;
            }
            return sizeRefusal(def.type, def.title, geo.size, sClassMinimum({ ...floor, minHeight: high, measuredMinHeight: Math.min(floor.measuredMinHeight, high) }, geo.size));
          }
          if (probe.warnings.some(w => w.severity === 'error' && w.code !== 'size-below-floor')) {
            // A measured floor can sit a few px under the height a label needs; an open height
            // tries 25% more twice, and the search above then finds the lowest height that draws.
            if (!resolved.fixed.height && pass < 2) { floor = { ...floor, minHeight: Math.ceil(floor.minHeight * 1.25) }; continue; }
            // The cause leads: every reader of a refusal takes its first warning.
            return { ...geo, warnings: [...chartRefusals(probe.warnings), ...probe.warnings.filter(w => w.severity !== 'error')] };
          }
          const next = probe.sizing!;
          if (next.minWidth <= floor.minWidth && next.minHeight <= floor.minHeight) break;
          floor = { ...next, minWidth: Math.max(floor.minWidth, next.minWidth), minHeight: Math.max(floor.minHeight, next.minHeight) };
        }
        if (lastGeometry) return { ...hiddenLabelCollision(def.title, lastGeometry,
          owedHiddenLabels(lastGeometry, data, pins, options?.annotations, minimal)), size: geo.size };
        return { ...geo, warnings: [{ code: 'label-collision', severity: 'error',
          message: 'The frame blocks the layout; no repair size passed the layout probe.',
          suggest: 'Shorten or move the colliding labels, or remove the conflicting annotation.' }] };
      }
      return geo;
    }
    // labels collide at some heights and not at others, so a chart
    // drawn taller than its content can report a natural height at which
    // its note line finds no room. One run at that height tells: refused on
    // height for the note, the chart reports the height that refusal names.
    // shortcut: probes only charts with authored annotations, the one owed
    // kind the natural height did not cover; widen the gate when another
    // owed kind can hide at the natural height.
    const natural = geo.sizing?.naturalHeight;
    if (!nested && layoutOptions?.annotations?.length && geo.sizing?.fit === 'content' && natural !== undefined && natural < geo.size.height) {
      const probe = named(withoutForcedCompact({ ...layoutOptions, size: { width: geo.size.width, height: natural } } as O));
      const need = probe.geo.refused ? probe.geo.sizing : undefined;
      if (probe.noteRefused && probe.geo.warnings[0]?.code === 'size-below-floor' && need && need.minWidth <= geo.size.width && need.minHeight > natural) {
        geo.sizing = { ...geo.sizing, naturalHeight: need.minHeight };
      }
    }
    if (geo.sizing) geo.sizing = sClassMinimum(geo.sizing, geo.size);
    // A pale fill keeps its colour; without equivalent text or bounding neighbours it takes a 3:1 edge.
    fillEdges(geo, theme);
    // A key swatch, or a segment on a highlighted row's tint, that would vanish into the fill it lies on keeps a hairline.
    geo.scene = groundEdges(geo.scene, () => theme, false);
    // For every chart type: no halo on a label that sits on a fill.
    labelsOnFills(geo);
    // Reference lines break around labels and keep contrast over fills.
    referenceLineClearance(geo);
    withoutOrphanAnnotationMarks(geo);
    withoutRepeatedAxisBreaks(geo);
    geo.scene = casingUnderFills(geo.scene);
    // Every hatch draws at options.hatchStrength, its key swatch like its marks.
    geo.scene = stampHatchLook(geo.scene, (options as { hatchStrength?: number } | undefined)?.hatchStrength);
    const bandPairs = marksOnBands(geo.scene);
    if (bandPairs.length > 0) {
      geo.paintWarningRules = [...(geo.paintWarningRules ?? []), { kind: 'mark-lost-on-band', pairs: bandPairs, before: geo.warnings.length }];
      pushAll(geo.warnings, markLostOnBandWarnings(theme, bandPairs));
    }
    if (options?.a11y?.title !== undefined) geo.a11y.includeTitle = options.a11y.title;
    const frameWarnings = geo.frame.warnings ?? [];
    for (const warning of frameWarnings) {
      if (!geo.warnings.includes(warning)) geo.warnings.push(warning);
    }
    if (frameWarnings.length > 0) delete geo.frame.warnings;
    for (const a of dropped) {
      geo.warnings.push({
        code: 'unsupported-annotation',
        severity: 'warn',
        message: `'${def.type}' does not support annotation kind '${a.kind}' — dropped`,
        suggest: def.annotationKinds.join(', ') || 'none',
      });
    }
    const empty = noPlottedValuesWarning(data);
    if (empty) geo.warnings.push(empty);
    const categoryCuts = new Set(geo.warnings.filter(w => w.code === 'category-labels-truncated')
      .flatMap(w => Array.isArray(w.detail?.cut) ? w.detail.cut : []));
    const truncated = geo.labels.filter(label => !label.hidden && label.title !== undefined
      && !(label.kind === 'category' && categoryCuts.has(label.title)));
    geo.warnings = geo.warnings.filter(warning => warning.code !== 'labels-truncated');
    if (truncated.length > 0) {
      geo.warnings.push({ code: 'labels-truncated', severity: 'warn',
        message: `${truncated.length} placed label(s) omit text; the reading lists their full text in labelsTruncated`,
        suggest: 'give the labels more room or shorten their text' });
    }
    pushAll(geo.warnings, unmatchedIdWarnings(geo, data, options?.highlight, pins, nested));
    geo.presentation = presentationInfo(geo, target, panelTypeClass(options), textScale);
    pushAll(geo.warnings, removedNames);
    return geo;
    });
    // Every number this layout formats follows the chart's smallValues mode.
    const layout = ((options?: O) => withSmallValues((prepared as BaseOptions).smallValues, () => layoutBody(options))) as FitLayout<O, M, DV>;
    layout.finish = () => {
      legendLayout.finish();
      for (const run of noteRuns) run.finish();
      noteRuns.length = 0;
      noteLayouts = new WeakMap();
    };
    return layout;
  };
  const lostCategoryNames = (geo: LayoutResult<M, DV>) => geo.refused ? [] : geo.labels.filter(label => label.kind === 'category' && !!label.hidden && label.hidden !== 'redundant' && label.hidden !== 'density');
  // A name longer than a narrow card needs width, not a refusal without a fix: three wider cards
  // (x1.15 each) at the same height. The first that prints every name is the size the refusal names.
  const widerForNames = (full: LayoutResult<M, DV>, options: O | undefined, layoutOnce: (options?: O) => LayoutResult<M, DV>) => {
    if ((options as { [FIXED_SIZE_PROBE]?: boolean } | undefined)?.[FIXED_SIZE_PROBE]) return undefined;
    // The drawn size is in layout pixels; an authored pt or mm height is not.
    const height = (options?.size as { height?: number } | undefined)?.height === undefined ? undefined : full.size.height;
    let width = full.size.width;
    for (let step = 0; step < 3; step++) {
      width = Math.ceil(width * 1.15);
      const wider = layoutOnce({ ...options, size: height === undefined ? { width } : { width, height } } as O);
      if (isRefused(wider) || lostCategoryNames(wider).length > 0) continue;
      return sizeRefusal(def.type, def.title, full.size, { ...full.sizing!, minWidth: width, minHeight: Math.max(full.sizing!.minHeight, wider.size.height) }) as unknown as LayoutResult<M, DV>;
    }
    return undefined;
  };
  const fullProbe = (options: O | undefined, layoutOnce: (options?: O) => LayoutResult<M, DV>) => {
    const full = layoutOnce(options);
    if (def.namesMustPrint !== true || full.refused || full.mode === 'compact') return full;
    const lost = lostCategoryNames(full);
    return lost.length === 0 ? full : widerForNames(full, options, layoutOnce) ?? hiddenLabelCollision(def.title, full as Geometry<object, object>,
      new Map(lost.map(label => [label.id, label.text]))) as LayoutResult<M, DV>;
  };
  // Full mode that lacks room on a pinned canvas falls back to compact, here at the outermost
  // call: the probes above ask the full chart what it needs and must keep their refusals.
  const layoutFitted = (data: D, options: O | undefined, layoutOnce: (options?: O) => LayoutResult<M, DV>): LayoutResult<M, DV> => {
    const full = layoutOnce(options);
    // A band chart's full mode prints every category name (namesMustPrint). When the
    // finished chart hides one, compact replaces it only if compact prints them all; else it refuses.
    const lostNames = (geo: typeof full) => geo.refused ? [] : geo.labels.filter((label) => label.kind === 'category' && !!label.hidden && label.hidden !== 'redundant' && label.hidden !== 'density');
    if (def.namesMustPrint === true && !full.refused && full.mode !== 'compact' && lostNames(full).length > 0) {
      const compact = compactFallbackApplies(def, options, data) ? layoutOnce({ ...options, [FORCE_COMPACT]: true } as unknown as typeof options) : full;
      if (compact !== full && !isRefused(compact) && lostNames(compact).length === 0) return compact;
      const wider = widerForNames(full, options, layoutOnce);
      if (wider) return wider;
      return hiddenLabelCollision(def.title, full as Geometry<object, object>, new Map(lostNames(full).map((label) => [label.id, label.text]))) as unknown as typeof full;
    }
    if (!full.refused || full.warnings[0]?.code !== 'size-below-floor') return full;
    // A pinned card counts hidden values before compacting the plot. This
    // needs its own preparation because the note text is part of that input.
    if (staticFrame.pinned && staticFrame.countable && options?.notes?.maxListed !== 0) {
      const counted = { ...options, notes: { ...options?.notes, maxListed: 0 } } as O;
      const run = prepareLayout(data, counted);
      try {
        const fitted = layoutFitted(data, counted, run);
        if (!fitted.refused || fitted.warnings[0]?.code === 'size-below-floor') return fitted;
      } finally { run.finish(); }
    }
    if (!compactFallbackApplies(def, options, data)) return full;
    // A fixed canvas below the full floor already ran compact in fitSize,
    // including its source and subtitle fallbacks. Forcing compact again
    // repeats the same refusal and its repair search.
    const requested = resolveTargetSize(options?.target ?? DEFAULT_TARGET, options?.size);
    if (requested.fixed.height && !fitsSize(requested.sizePx, declaredSizing(def, options))) return full;
    const compact = layoutOnce({ ...options, [FORCE_COMPACT]: true } as unknown as typeof options);
    // Compact replaces the full refusal only if it draws, or if it is a size refusal with the
    // size compact needs. Any other compact failure would hide the usable size advice of full mode.
    return !isRefused(compact) || compact.warnings[0]?.code === 'size-below-floor' ? compact : full;
  };
  // A refusal keeps the retirement warnings that a drawn chart gets in layoutOnce (accept, ignore, warn).
  const layoutBaseline = (data: D, options: O | undefined, layoutOnce: (options?: O) => LayoutResult<M, DV>, probe = false) => {
    const geo = probe && !compactFallbackApplies(def, options, data) ? fullProbe(options, layoutOnce) : layoutFitted(data, options, layoutOnce);
    // Only a hard refusal skips layoutOnce's success tail; a lint refusal already carries the warnings.
    if (!geo.refused) return geo;
    const removed = (options as { [REMOVED_NAMES]?: LintWarning[] } | undefined)?.[REMOVED_NAMES] ?? removedNameWarnings(options);
    return removed.length ? { ...geo, warnings: [...geo.warnings, ...removed] } : geo;
  };
  const layoutPlain = (data: D, options: O | undefined, layoutOnce: (options?: O) => LayoutResult<M, DV>, probe = false) => {
    const noteData = def.categoryLabels
      ? withCalendarLabels(data, options?.locale?.language, def.categoryLabels) : data;
    return withDensityNotes(noteData, (options ?? {}) as BaseOptions, next => {
      if (!(DENSITY_VALUES in next)) return layoutBaseline(data, next as O, layoutOnce, probe);
      const notedLayout = prepareLayout(data, next as O);
      try { return layoutBaseline(data, next as O, notedLayout, probe); } finally { notedLayout.finish(); }
    });
  };
  // Preparation and the full/compact policy belong to one call, including its size probes.
  const createLayout = (data: D, authored?: O): LayoutCall<O, M, DV> => {
    checkItemBudget(def.type, data, authored);
    const options = withDefaultTarget(authored);
    const inherited = (options as { [CARD_HEIGHT_MEMO]?: CardHeightMemo } | undefined)?.[CARD_HEIGHT_MEMO];
    const borrowed = inherited?.active && inherited.type === def.type;
    const memo: CardHeightMemo = borrowed ? inherited : { type: def.type, active: true, heights: new Map() };
    // Every pass of this call (plot share, density note) gets the one labelled data object that
    // prepareLayout would build each time anew: labelled data stays as it is, and the request
    // memo keys a layout by its data object.
    const labelled = def.categoryLabels
      ? withCalendarLabels(data, options?.locale?.language, def.categoryLabels) : data;
    const layoutOnce = prepareLayout(labelled, { ...options, [CARD_HEIGHT_MEMO]: memo } as unknown as O);
    const plain: typeof def.layout = (d, o) => {
      const run = prepareLayout(d, o);
      try { return layoutPlain(d, o, run); } finally { run.finish(); }
    };
    const probes = new Map<string, LayoutResult<M, DV>>();
    const run = ((runOptions?: O) => withLayoutMemo(() => {
      const size = runOptions?.size;
      const key = `${typeof size === 'object' ? `${size?.width}x${size?.height}:${size?.unit}` : String(size)}:${String(runOptions?.mode)}:${runOptions?.belowMinimum}:${(runOptions as { [FULL_LAYOUT_PROBE]?: boolean } | undefined)?.[FULL_LAYOUT_PROBE]}:${(runOptions as { [FORCE_COMPACT]?: boolean } | undefined)?.[FORCE_COMPACT]}:${(runOptions as { [WIDTH_PROBE]?: string } | undefined)?.[WIDTH_PROBE]}:${(runOptions as { [FIXED_SIZE_PROBE]?: boolean } | undefined)?.[FIXED_SIZE_PROBE]}`;
      const cached = memo.active ? probes.get(key) : undefined;
      if (cached !== undefined) return cached;
      const fullProbe = (runOptions as { [FULL_LAYOUT_PROBE]?: boolean } | undefined)?.[FULL_LAYOUT_PROBE] === true;
      // Density-note retries must keep this call's wider-card cache.
      const callOptions = { ...runOptions, [CARD_HEIGHT_MEMO]: memo } as unknown as O;
      let geo = layoutPlain(labelled, callOptions, layoutOnce, fullProbe);
      // A narrow card keeps the 0.4 plot share only when no value moves into a note
      // because of it. Only a layout that hides something pays for the 0.5 layout, which wins
      // when it hides less.
      const lost = !fullProbe && narrowShareApplies(def, runOptions) ? hiddenForSpace(geo) : 0;
      if (lost > 0) {
        const share = { [PLOT_SHARE]: PLOT_FLOOR_SHARE };
        const wideOnce = prepareLayout(labelled, { ...options, ...share, [CARD_HEIGHT_MEMO]: memo } as unknown as O);
        try {
          const wide = layoutPlain(labelled, { ...callOptions, ...share } as unknown as O, wideOnce);
          if (hiddenForSpace(wide) < lost) geo = wide;
        } finally { wideOnce.finish(); }
      }
      if (memo.active && !(runOptions as { story?: unknown } | undefined)?.story) probes.set(key, geo);
      if (!(runOptions as { story?: unknown } | undefined)?.story || isRefused(geo)) return geo;
      const story = loadedDeferred('story');
      return (story ? story.applyStory(geo as Geometry<object, object>, data, runOptions as object, plain as never) : { ...geo, warnings: [...geo.warnings, { code: 'story-layer-not-loaded', severity: 'warn', message: 'options.story draws only through withStory', suggest: "import { withStory } from 'boardplot/react/story'" }] }) as typeof geo;
    })) as LayoutCall<O, M, DV>;
    run.probe = at => run({ ...at, [FULL_LAYOUT_PROBE]: true } as unknown as O);
    run.finish = () => { probes.clear(); layoutOnce.finish(); if (!borrowed) { memo.active = false; memo.heights.clear(); memo.references = undefined; } };
    const variable = new Set<PropertyKey>(['size', 'mode', 'belowMinimum', LAYOUT_CALL, FULL_LAYOUT_PROBE, FORCE_COMPACT, WIDTH_PROBE, ACCEPTANCE_PROBE]);
    run.accepts = (d, at) => d === data && [...new Set([...Reflect.ownKeys(options ?? {}), ...Reflect.ownKeys(at ?? {})])]
      .every(key => variable.has(key) || (options as Record<PropertyKey, unknown> | undefined)?.[key] === (at as Record<PropertyKey, unknown> | undefined)?.[key]);
    return run;
  };
  const layout: typeof def.layout = (data, options) => {
    const prepared = (options as { [LAYOUT_CALL]?: LayoutCall<O, M, DV> } | undefined)?.[LAYOUT_CALL];
    if (prepared?.accepts(data, options)) return prepared(options);
    const run = createLayout(data, options);
    try { return run(options); } finally { run.finish(); }
  };
  const layoutWithFooter: typeof def.layout = (data, authored) => {
    const options = withDefaultTarget(authored);
    return withLayoutMemo(() => {
      const withCuts: typeof layout = (data, options) => withCutLabelNotes(data, options ?? {} as O, next => layout(data, next));
      let geo = loadedDeferred('footer')?.(withCuts, data, options, def.type) ?? withCuts(data, options);
      geo = verifiedDensityRefusal(geo, def.title, options ?? {}, (size) => layoutWithFooter(data, { ...authored, size, [ACCEPTANCE_PROBE]: true } as unknown as O));
      if (!geo.refused) {
        finishCutLabelNotes(geo);
        reportLabelOmissions(geo, options, data);
      }
      if (!(options as { [FULL_LAYOUT_PROBE]?: boolean })[FULL_LAYOUT_PROBE]
        && !(options as { [ACCEPTANCE_PROBE]?: boolean })[ACCEPTANCE_PROBE]) {
        estimatedPlotAdvice(geo, options);
      }
      if (geo.warnings.some(warning => warning.fix)) {
        geo.warnings = geo.warnings.map(warning => warning.fix
          ? { ...warning, fix: addWhereAbsent({ data, options: authored }, warning.fix) } : warning);
      }
      // The author's description replaces every sentence the chart and the frame wrote into it.
      const description = options?.a11y?.description;
      if (description !== undefined && !geo.refused) {
        geo.a11y.desc = description;
        if (geo.story) geo.story.desc = description;
      }
      return geo;
    });
  };
  registry.set(def.type, { ...def, sizing, layout: layoutWithFooter, [LAYOUT_CALL]: createLayout } as RegisteredChart<any, any, any, any>);
  for (const alias of aliases) {
    aliasIndex.set(alias, def.type);
  }
  registryRevision += 1;
  for (const redraw of registryWaiting) redraw();
}

/**
 * A density pass refused on a pinned height names the height its own frame needs; the frame at that
 * height can select other values and refuse again (combo.band-label-headroom-rising-tail at 300 px
 * named 309, and 309 refused). Raise the height to each refusal's size until the chart draws, then
 * search down to the lowest height that draws, so the advice is a size that draws.
 */
function verifiedDensityRefusal<M extends object, DV extends object>(geo: LayoutResult<M, DV>, title: string, options: ChartOptions,
  at: (size: { width: number; height: number }) => LayoutResult<M, DV>): LayoutResult<M, DV> {
  const refusal = geo.warnings[0];
  if (!refusal || !UNVERIFIED_DENSITY_REFUSALS.has(refusal) || !isRefused(geo) || !geo.sizing) return geo;
  const probe = options as Record<symbol, unknown>;
  if (probe[ACCEPTANCE_PROBE] || probe[FULL_LAYOUT_PROBE] || probe[FIXED_SIZE_PROBE] || probe[WIDTH_PROBE]) return geo;
  const width = geo.size.width;
  let low = Math.ceil(geo.size.height), height = Math.max(low + 1, Math.ceil(geo.sizing.minHeight));
  for (let pass = 0; ; pass++) {
    const taller = at({ width, height });
    if (!isRefused(taller)) break;
    if (pass === 7 || taller.warnings[0]?.code !== 'size-below-floor' || !taller.sizing || taller.sizing.minWidth > width + SIZE_TOLERANCE) return geo;
    low = height;
    height = Math.max(height + 1, Math.ceil(taller.sizing.minHeight));
  }
  while (height - low > 1) {
    const mid = Math.floor((low + height) / 2);
    if (isRefused(at({ width, height: mid }))) low = mid; else height = mid;
  }
  if (height === Math.ceil(geo.sizing.minHeight)) return geo;
  const verified = sizeRefusal(geo.type, title, geo.size,
    { ...geo.sizing, minHeight: height, measuredMinHeight: Math.min(geo.sizing.measuredMinHeight, height) });
  return { ...verified, warnings: [...verified.warnings, ...geo.warnings.slice(1)] } as unknown as LayoutResult<M, DV>;
}

/** Pass the parent target through both explicit and repeated grid panels.
 * The grid already passes its width class at each measured child width.
 */
function inheritGridTarget<D>(data: D, target: RenderTarget, textScale: number, textSize?: number): D {
  if (data === null || typeof data !== 'object') return data;
  if (Object.hasOwn(data, 'measures') && Object.hasOwn(data, 'categories')) return data;
  // A panel draws at the grid's text scale, as at its target: the grid's own theme is already scaled.
  const panel = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const entry = value as { type?: string; options?: object };
    if (entry.type === 'text' || entry.type === 'legend') return entry;
    const { textScale: _own, textSize: ownSize, ...options } = (entry.options ?? {}) as { textScale?: number; textSize?: number };
    // `textSize` on the grid applies to every panel; a panel with another value is refused, not overridden.
    if (ownSize !== undefined && ownSize !== textSize) {
      throw new NormalizeError('grid-panel-text-size', 'options.textSize', 'a grid panel cannot set its own textSize', 'set textSize once on the grid');
    }
    return { ...entry, options: { ...options, target, ...(textSize !== undefined ? { textSize } : textScale === 1 ? {} : { textScale }) } };
  };
  const grid = data as { panels?: unknown[]; template?: unknown };
  return { ...data,
    ...(Array.isArray(grid.panels) ? { panels: grid.panels.map(panel) } : {}),
    ...(grid.template ? { template: panel(grid.template) } : {}),
  };
}

/**
 * Estimate the height the note took from the plot, at least 20px. The caller
 * must verify this size through the note pass before returning the refusal.
 */
function hiddenLabelRefusal(title: string, first: Geometry<object, object>, last: Geometry<object, object>): RefusedLayout {
  const sizing = last.sizing!;
  const height = last.size.height + Math.max(20, Math.ceil(first.plot.h - last.plot.h));
  const refusal = sizeRefusal(last.type, title, last.size, { ...sizing, minWidth: Math.max(sizing.minWidth, last.size.width), minHeight: Math.max(sizing.minHeight, height) });
  refusal.warnings[0]!.message += '; at this size it hides labels its note line has no room to name';
  return refusal;
}

/** Height cannot resolve this collision. Name the label and its blockers. */
function hiddenLabelCollision(title: string, geo: Geometry<object, object>, owed: ReadonlyMap<string, string>, noteMissing = false): RefusedLayout {
  const hidden = geo.labels.filter(label => owed.has(label.id));
  const collisions = hidden.map(label => {
    const blockers = geo.debug.occupied.filter(item => rectsOverlap(item.rect, label.rect)
      && !(item.kind === 'mark' && isOwnMark(item.owner, label.owner, label.kind, item.part)))
      .map(item => `${item.part ?? item.kind} ${Object.values(item.owner).join('/')}`);
    return `'${label.text}' (${label.id}) against ${[...new Set(blockers)].join(', ') || 'the frame or canvas edge'}`;
  });
  // Its own code: more room does not lift it, so a growing React container shows it at once (isSizeDependentRefusal).
  return { refused: true, type: geo.type, title, size: geo.size, sizing: geo.sizing!, warnings: [{
    code: 'label-collision', severity: 'error',
    // A hidden label goes into the capped note and the chart draws. The refusal is left for a note that
    // cannot be drawn: its labels were handed to the note, and the note is not on the page.
    message: `${noteMissing ? 'The note line that names the hidden labels is not drawn' : 'More height did not resolve the hidden labels'}: ${collisions.join('; ') || 'the note and chart frame compete for space'}`,
    suggest: 'Shorten or move the named labels, or remove the colliding element.',
  }] };
}

/**
 * A highlight id or a labelPlacements key that names nothing in the drawn
 * chart changed nothing, so the author would believe a typo took effect.
 * Read off the finished geometry for every type: the ids its marks own and
 * the labels its solver placed or hid.
 */
function unmatchedIdWarnings(geo: Geometry<object, object>, data: unknown, highlight: unknown, pins: Record<string, unknown> | undefined, nested: boolean): LintWarning[] {
  const list = (ids: Iterable<string>) => {
    const all = [...new Set(ids)];
    return all.length > 20 ? `${all.slice(0, 20).join(', ')} and ${all.length - 20} more` : all.join(', ') || 'none';
  };
  const warnings: LintWarning[] = [];
  const asked = typeof highlight === 'string' ? [highlight] : Array.isArray(highlight) ? highlight.filter((id): id is string => typeof id === 'string') : [];
  // A waterfall checks its bar ids itself.
  if (asked.length > 0 && !geo.warnings.some((warning) => warning.code === 'highlight-unknown-id')) {
    // A grid prefixes each panel's nodes with '<panel>/', and its highlight names panels.
    const owned = geo.scene.flatMap((node) => [
      ...(node.id?.includes('/') ? [node.id.slice(0, node.id.indexOf('/'))] : []),
      ...Object.values(node.owner ?? {}).filter((id): id is string => typeof id === 'string'),
    ]);
    // A scatter highlights every point of a named group, and no mark owns the group id.
    const points = (data as { points?: unknown } | undefined)?.points;
    if (Array.isArray(points)) pushAll(owned, points.map((point) => (point as { group?: unknown } | null)?.group).filter((id): id is string => typeof id === 'string'));
    const known = new Set(owned);
    const unknown = asked.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      warnings.push({
        code: 'highlight-unknown-id',
        severity: 'warn',
        message: `highlight names ${unknown.map((id) => `'${id}'`).join(', ')}, which no mark of this chart carries, so nothing is highlighted for it; ids here: ${list(owned)}`,
        suggest: 'Name a series, category, point or row id of this chart.',
        // A grid panel's field is relative to the panel; the grid names the panel in the message.
        ...(nested ? {} : { field: ['options', 'highlight'] }),
      });
    }
  }
  const pinned = Object.keys(pins ?? {});
  if (pinned.length > 0) {
    const labels = [...geo.labels.map((label) => label.id), ...geo.debug.decisions.map((decision) => decision.labelId)];
    const known = new Set(labels);
    for (const id of pinned.filter((key) => !known.has(key))) {
      warnings.push({
        code: 'unknown-label-pin',
        severity: 'warn',
        message: `labelPlacements names label '${id}', which this chart does not draw, so the pin does nothing; label ids: ${list(labels)}`,
        suggest: 'Use a label id from the list, or remove the pin.',
        ...(nested ? {} : { field: ['options', 'labelPlacements', id] }),
      });
    }
  }
  return warnings;
}

/**
 * Every value of every data series is missing: the chart is an empty frame.
 * Checked once for all registered types over the authored `series[].values`.
 * It lives here so the chart entries that link no other gap
 * check do not carry them.
 */
function noPlottedValuesWarning(data: unknown): LintWarning | null {
  const series = (data as { series?: unknown } | null)?.series;
  if (!Array.isArray(series)) return null;
  const dataSeries = (series as { role?: unknown; values?: unknown }[]).filter((s) => s?.role !== 'reference');
  const present = (cell: unknown): boolean => {
    if (cell === null || cell === undefined) return false;
    if (typeof cell === 'object' && 'categoryId' in cell) return present((cell as { value?: unknown }).value);
    return true;
  };
  // A shape this check does not know (no values array) counts as plotted.
  const plotted = dataSeries.length === 0 ||
    dataSeries.some((s) => !Array.isArray(s?.values) || s.values.some(present));
  return plotted ? null : {
    code: 'no-plotted-values',
    severity: 'warn',
    message: 'every data value is missing (null), so the chart draws an empty frame',
    suggest: 'supply the values, or leave the chart out until the data exists',
  };
}

export function getChart(typeOrAlias: string): RegisteredChart<any, any, any, any> | undefined {
  const chart = registry.get(typeOrAlias) ?? registry.get(aliasIndex.get(typeOrAlias) ?? '');
  const defaults = chart?.aliasDefaults?.[typeOrAlias];
  if (!chart || !defaults) return chart;
  return { ...chart, defaults: { ...chart.defaults, ...defaults },
    layout: (data, options) => chart.layout(data, { ...defaults, ...options }) };
}

export function getChartDefinition(
  typeOrAlias: string,
): ChartDefinition<any, any, any, any> | undefined {
  const chart = getChart(typeOrAlias);
  if (!chart) return undefined;
  if (!isDefinition(chart)) {
    throw new Error(
      `chart type '${chart.type}' is registered without its schema; import the chart's index module or \`boardplot/validate\``,
    );
  }
  return chart;
}

/**
 * Publishes one type's schemas without its engine. `aliases` are the names
 * that resolve to `schemas.type`, the same ones its core declares; a second
 * call for a type this index already holds is ignored.
 */
export function registerChartSchemas(schemas: ChartSchemas<any, any>, aliases: readonly string[] = []): void {
  if (schemaIndex.has(schemas.type)) return;
  schemaIndex.set(schemas.type, schemas);
  for (const alias of aliases) schemaAliasIndex.set(alias, schemas.type);
}

/**
 * The data and options schemas of a type or alias: the registered
 * definition's where this graph has the engine, the published schema chunk's
 * where it has only that. Undefined for an unknown type and for a chart
 * registered core-only with no schema chunk beside it.
 */
export function getChartSchemas(typeOrAlias: string): ChartSchemas<any, any> | undefined {
  const chart = getChart(typeOrAlias);
  if (chart && isDefinition(chart)) return chart;
  return schemaIndex.get(typeOrAlias) ?? schemaIndex.get(schemaAliasIndex.get(typeOrAlias) ?? '');
}

/** The canonical type behind a name or alias, from whichever index holds it. */
export function canonicalChartType(typeOrAlias: string): string | undefined {
  return getChart(typeOrAlias)?.type ?? getChartSchemas(typeOrAlias)?.type;
}

export function listCharts(): { type: string; aliases: string[]; summary: string; sizing: ChartSizing }[] {
  return [...registry.values()].map((d) => ({
    type: d.type,
    aliases: d.aliases ?? [],
    summary: d.summary,
    sizing: d.sizing,
  }));
}

/** The type and options that draw an unsupported chart form, when one exists. */
export interface UnsupportedUse {
  type: string;
  options: Record<string, unknown>;
}

/**
 * Chart forms Boardplot does not draw under their own name. `use` names the
 * type and options that draw the same thing; `null` means Boardplot does not
 * draw the form at all. A registered type never appears here; tests/
 * registry-consistency.test.ts enforces it, because `boardplot list --json`
 * emits `charts` and `unsupported` in one payload.
 */
export const unsupported: readonly { name: string; use: UnsupportedUse | null }[] = [
  { name: 'radar', use: null },
  { name: 'spider', use: null },
  { name: 'gauge', use: null },
  { name: 'control-chart', use: null },
  { name: 'tornado', use: { type: 'bar', options: { variant: 'tornado' } } },
  { name: 'ribbon', use: { type: 'column', options: { variant: 'stacked', ribbons: true } } },
  { name: 'alluvial', use: { type: 'column', options: { variant: 'stacked', ribbons: true } } },
  { name: 'bump', use: { type: 'line', options: { variant: 'bump' } } },
  { name: 'ranking', use: { type: 'line', options: { variant: 'bump' } } },
  { name: 'anomaly', use: { type: 'column', options: { anomaly: { method: 'mad' } } } },
  { name: 'outlier', use: { type: 'column', options: { anomaly: { method: 'mad' } } } },
  {
    name: 'fan',
    use: { type: 'line', options: { fan: { of: '<central series id>', bands: [{ low: '<low series id>', high: '<high series id>', label: '<what the interval means>' }] } } },
  },
  {
    name: 'confidence-band',
    use: { type: 'line', options: { fan: { of: '<central series id>', bands: [{ low: '<low series id>', high: '<high series id>', label: '<what the interval means>' }] } } },
  },
];
