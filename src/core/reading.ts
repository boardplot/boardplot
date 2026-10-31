import type { StackReadout } from './charts/grid/metricStack';
import type { GridDerived } from './charts/grid/layout';
/**
 * The short reading `render` returns next to each drawn chart. It is built
 * only from records the engine already published for that chart: the claim
 * records extracted from the geometry, the interaction records extracted from
 * the same request, and the placed labels. Nothing here lays out, measures or
 * recomputes a number.
 */
import { CLAIM_KIND_GROUPS, type ClaimRecordV1 } from './claims/browser';
import { interactionRecords } from './a11y/records';
import { dataOrder } from './frame';
import { cutLabels, labelOmissions, omissionScope, readableLabelDestination, type LabelOmission } from './label/omissions';
import { interactionValueText } from './a11y/valueText';
import type { OwnerRef } from './types/cell';
import type { ChartData } from './types/data';
import { normalizeCategory, normalizeSeriesValues } from './normalize/shared';
import { DEFAULT_REST_MIN, DEFAULT_TOP_N } from './charts/topN';
import { chartNotes, type ChartNote } from './notes';
import type { InteractionRecord } from './a11y/types';
import type { RoundingAdjustment } from './shareRounding';
import type { ResolvedChartRequest } from './request';
import type { Geometry } from './types/scene';
import type { StructureCount } from './structureCounts';
export type { StructureCount } from './structureCounts';

/** Plain spelling of a versioned op: 'waterfall-total@1' becomes 'waterfall total'. */
function operationWords(op: string): string {
  return op
    .replace(/@\d+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .join(' ');
}

function isDerivation(kind: ClaimRecordV1['kind']): boolean {
  return (CLAIM_KIND_GROUPS.derivations as readonly string[]).includes(kind);
}

/**
 * A raw number is reported only when the record says the value IS a number.
 * A withheld or unavailable value has no number to print, and printing the
 * withheld one is exactly what the suppression asked the chart not to do.
 */
function reportableNumber(record: { raw: number | null; state: string }): number | null {
  return record.state === 'value' && typeof record.raw === 'number' && Number.isFinite(record.raw)
    ? record.raw
    : null;
}

interface ClaimSummary {
  total: number;
  derivations: number;
  nonDerivations: number;
  observed: number;
  authored: number;
  states: string[];
  summary: string[];
}

/** What the engine derived, measured or was handed, counted by kind. */
function explainClaims(claims: readonly ClaimRecordV1[]): ClaimSummary {
  const derivations = claims.filter((claim) => isDerivation(claim.kind)).length;
  const observed = claims.filter((claim) => claim.kind === 'observed').length;
  const authored = claims.filter((claim) => claim.kind === 'authored').length;
  const states = [...new Set(claims.map((claim) => claim.output.state))].sort();
  const summary = [
    `${claims.length} claim ${claims.length === 1 ? 'record' : 'records'} for this chart: `
      + `${derivations} engine ${derivations === 1 ? 'derivation' : 'derivations'} and `
      + `${claims.length - derivations} that ${claims.length - derivations === 1 ? 'promises' : 'promise'} no arithmetic.`,
  ];
  if (claims.length - derivations > 0) {
    const parts: string[] = [];
    if (observed > 0) parts.push(`${observed} ${observed === 1 ? 'was' : 'were'} measured from the source sample`);
    if (authored > 0) parts.push(`${authored} came from the document`);
    if (parts.length > 0) summary.push(`Of the records without arithmetic, ${parts.join(' and ')}.`);
  }
  if (states.some((state) => state !== 'value')) {
    summary.push(`Claim states in this chart: ${states.join(', ')}.`);
  }
  return {
    total: claims.length,
    derivations,
    nonDerivations: claims.length - derivations,
    observed,
    authored,
    states,
    summary,
  };
}

interface DerivedNumber {
  claimId: string;
  /** Source and intermediate operands for stack readouts. */
  inputs?: ClaimRecordV1['inputs'];
  op: string;
  operation: string;
  displayed: string;
  /** Whether a final label or other published text displays this calculation. */
  visible: boolean;
  /** Destination when the displayed value is published in a note. */
  noteLocation?: string;
  /** False when the value is not drawn on the chart: it is in a note, or only counted there. */
  drawn?: false;
  value: number | null;
  state: string;
}

/** The numbers the engine computed, with `value` empty whenever the state is not `value`. */
function derivedNumbers(claims: readonly ClaimRecordV1[]): DerivedNumber[] {
  return claims.filter((claim) => isDerivation(claim.kind)).map((claim) => ({
    claimId: claim.id,
    ...(claim.id.startsWith('stack:') ? { inputs: claim.inputs.map(input => ({ ...input })) } : {}),
    op: claim.op,
    operation: operationWords(claim.op),
    displayed: claim.output.displayed || 'Not displayed',
    visible: claim.output.displayed.length > 0,
    ...(claim.noteLocation ? { noteLocation: claim.noteLocation } : {}),
    ...(claim.drawn === false ? { drawn: false as const } : {}),
    value: reportableNumber(claim.output),
    state: claim.output.state,
  }));
}

interface ValueNote {
  recordId: string;
  label: string;
  state: string;
  reason: string | null;
}

interface ValuesSummary {
  source: 'interaction-records' | 'unavailable';
  note?: string;
  total: number;
  /** Records whose value is a number in state `value`; text and dates are not counted. */
  numbers: number;
  byState: Record<string, number>;
  byKind: Record<string, number>;
  /** The first withheld values, at most VALUE_NOTE_LIMIT; `byState.suppressed` has the count. */
  suppressed: ValueNote[];
  /** The first values in a state other than `value` or `suppressed`, at most VALUE_NOTE_LIMIT. */
  withoutNumber: ValueNote[];
  summary: string[];
}

/** Per-value notes stay short: the counts are complete, the lists are samples. */
const VALUE_NOTE_LIMIT = 10;

/**
 * What the interaction records say about every value in the chart, including
 * the ones the chart deliberately withholds. A record that is not a plain
 * number is listed with its own state and reason, never with a raw value.
 */
function valuesSummary(records: readonly InteractionRecord[] | null, unavailableNote?: string): ValuesSummary {
  if (records === null) {
    const note = unavailableNote ?? 'No interaction record adapter covers this chart type.';
    return {
      source: 'unavailable',
      note,
      total: 0,
      numbers: 0,
      byState: {},
      byKind: {},
      suppressed: [],
      withoutNumber: [],
      summary: [`${note} No per-value description is reported.`],
    };
  }
  const byState: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const suppressed: ValueNote[] = [];
  const withoutNumber: ValueNote[] = [];
  let numbers = 0;
  for (const record of records) {
    const { state, kind } = record.value;
    byState[state] = (byState[state] ?? 0) + 1;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (kind === 'number' && state === 'value') numbers += 1;
    const note: ValueNote = { recordId: record.id, label: record.label, state, reason: record.value.reason ?? null };
    if (state === 'suppressed') {
      if (suppressed.length < VALUE_NOTE_LIMIT) suppressed.push(note);
    } else if (state !== 'value' && withoutNumber.length < VALUE_NOTE_LIMIT) withoutNumber.push(note);
  }
  const textOrDate = (byKind.text ?? 0) + (byKind.date ?? 0);
  const summary = [
    `The records describe ${records.length} ${records.length === 1 ? 'value' : 'values'}, `
    + `${numbers} of them a plain number${textOrDate > 0 ? ` and ${textOrDate} text or date` : ''}.`,
  ];
  const withheld = byState.suppressed ?? 0;
  if (withheld > 0) {
    summary.push(
      `${withheld} ${withheld === 1 ? 'value is' : 'values are'} withheld, `
      + 'so no raw number is reported for them.',
    );
  }
  const other = Object.entries(byState).filter(([state]) => state !== 'value' && state !== 'suppressed');
  const otherCount = other.reduce((sum, [, count]) => sum + count, 0);
  if (otherCount > 0) {
    summary.push(
      `${otherCount} ${otherCount === 1 ? 'value is' : 'values are'} neither present nor withheld: `
      + `${other.map(([state]) => state).sort().join(', ')}.`,
    );
  }
  return { source: 'interaction-records', total: records.length, numbers, byState, byKind, suppressed, withoutNumber, summary };
}

export interface ChartReading {
  name: string;
  type: string;
  /** Structural counts with the exact phrases in the accessible description. */
  counts: StructureCount[];
  /** The authored title text; null when the chart has none or suppresses it. */
  title: string | null;
  size: { width: number; height: number };
  mode: 'full' | 'compact';
  /** How many lines the drawn title takes; 0 without a title. */
  titleLines: number;
  /** Series labels in record order; empty for charts without series. */
  series: string[];
  labelsPlaced: number;
  /** Placed labels whose fitted text omits part of the authored text. */
  labelsTruncated: { labelId: string; text: string; displayed: string }[];
  /** Labels the solver dropped, by reason. `redundant` ones cost the reader nothing. */
  labelsDropped: number;
  labelsDroppedBy: Record<string, number>;
  /** One reason and destination for each hidden label, value moved to a note, or omitted source. */
  omissions: { labelId: string; text: string; reason: string; destination?: string }[];
  derived: DerivedNumber[];
  /** Metric-stack readouts, their windows and all source operands. */
  metricStack?: { readouts: StackReadout[] };
  claims: ClaimSummary;
  values: ValuesSummary;
  /**
   * The notes list (footer rule): every note under the chart with its kind
   * (source, credit, note, method, disclosure), its one-line short form where
   * the engine wrote one, and whether the frame prints it, in list order. A
   * host builds an appendix or an info panel from it. It includes the notes
   * compact mode leaves off the canvas.
   */
  notes: ChartNote[];
  /** Under rounding 'sum-consistent': every printed share moved off its nearest rounding so its whole adds up to 100%. */
  rounding?: RoundingAdjustment[];
}

interface ChartReadingInput {
  name: string;
  type: string;
  request: ResolvedChartRequest;
  geometry: Geometry;
  claims: readonly ClaimRecordV1[];
}

function recordsFor(input: ChartReadingInput): { records: InteractionRecord[] | null; note?: string } {
  try {
    return {
      records: interactionRecords({
        request: input.request,
        geometry: input.geometry,
        scope: input.request.scope,
        claims: input.claims,
        // An event of the event lane or a value line is an annotation, not a value the chart plots.
      }).filter((record) => record.target.owner.annotationId === undefined),
    };
  } catch (error) {
    return {
      records: null,
      note: `No interaction record adapter covers this chart type: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Selection can skip the solver entirely. Keep those authored omissions beside solver omissions. */
function unrequestedLabelOmissions(input: ChartReadingInput, records: readonly InteractionRecord[], omissions: LabelOmission[]): void {
  const named = new Set(omissions.map(item => item.labelId));
  const destinationOf = readableLabelDestination(input.geometry);
  const add = (labelId: string, text: string, reason: string, owner: OwnerRef = {}, kind?: string, printedText = text) => {
    if (named.has(labelId)) return;
    named.add(labelId);
    if (destinationOf(labelId, printedText, owner, kind, text)) return;
    omissions.push({ labelId, text, reason, destination: 'reading.omissions' });
  };
  const valueKey = (owner: InteractionRecord['target']['owner']) => JSON.stringify([owner.seriesId, owner.categoryId, owner.pointId]);
  const buildContext = (prefix: string) => {
    const scope = omissionScope(input.geometry, input.request.options, `${prefix}point`, input.request.data);
    const data = (scope.data ?? {}) as ChartData;
    const labels = scope.geometry.labels;
    const categories = (Array.isArray(data.categories) ? data.categories : []).map(normalizeCategory);
    const seriesById = new Map((Array.isArray(data.series) ? data.series : []).filter(series => series.values !== undefined)
      .map((series, index) => [series.id, { ...series, values: normalizeSeriesValues(series, categories, index) }]));
    const options = (scope.options ?? {}) as Record<string, unknown>;
    const geometry = scope.geometry;
    const order = geometry.type === 'bar' ? (geometry.derived as { order?: string[] }).order : undefined;
    const visibleCategories = new Set(order ?? geometry.axes.flatMap(axis => axis.ticks.filter(tick => tick.labelId && /(?:^|[:/])category:/.test(tick.labelId)).map(tick => String(tick.at))));
    // A pie merges its smallest slices by default, so it names them like an authored topN does.
    const defaultPieCut = geometry.type === 'pie' && categories.length - DEFAULT_TOP_N.n >= DEFAULT_REST_MIN;
    const topN = (options.topN ?? (defaultPieCut ? DEFAULT_TOP_N : undefined)) as { n?: number; rest?: boolean; threshold?: number } | undefined;
    const topNCut = typeof topN?.n === 'number' && topN.n > 0 && (categories.length > topN.n || typeof topN.threshold === 'number' && topN.threshold > 0) && !options.window && !options.viewDomain;
    return { categories, seriesById, geometry, data, options, visibleCategories, topNCut,
      plottedPoints: new Set((geometry.type === 'scatter' ? (geometry.marks as { points?: { id: string }[] }).points ?? [] : []).map(point => point.id)),
      capApplied: geometry.type === 'scatter' && geometry.warnings.some(warning => warning.code === 'labels-auto-off'),
      requestedValues: new Set(labels.filter(label => ['point', 'segment', 'insidePie', 'outsidePie'].includes(label.kind)).map(label => valueKey(label.owner))),
      drawnSeries: new Set(labels.filter(label => label.kind === 'series' && !label.hidden).map(label => label.owner.seriesId)),
      drawnCategories: new Set(labels.filter(label => label.kind === 'category' && !label.hidden).map(label => label.owner.categoryId)),
      keptCategories: new Set(visibleCategories.size ? visibleCategories : labels.map(label => label.owner.categoryId)),
    };
  };
  const contexts = new Map<string, ReturnType<typeof buildContext>>();
  for (const record of records) {
    const prefix = record.target.panel ? `${record.target.panel}/` : '';
    let context = contexts.get(prefix);
    if (!context) { context = buildContext(prefix); contexts.set(prefix, context); }
    const { categories, seriesById, options } = context;
    const settings = options.labels;
    const disabled = (kind: string) => {
      const setting = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>)[kind] : undefined;
      return settings === false || setting === false || Array.isArray(setting) && setting.length === 0;
    };
    const owner = record.target.owner;
    if (context.geometry.type === 'scatter' && owner.pointId !== undefined && !context.plottedPoints.has(owner.pointId)) continue;
    if ((options.window || options.viewDomain) && owner.categoryId !== undefined && context.visibleCategories.size && !context.visibleCategories.has(owner.categoryId)) continue;
    context.keptCategories.add(owner.categoryId);
    const series = owner.seriesId === undefined ? undefined : seriesById.get(owner.seriesId);
    const categoryIndex = categories.findIndex(category => category.id === owner.categoryId);
    const cell = series?.values[categoryIndex];
    const cellLabel = typeof cell === 'object' && cell !== null && 'label' in cell ? cell.label : undefined;
    const only = typeof options.seriesLabels === 'object' && options.seriesLabels !== null
      ? (options.seriesLabels as { only?: string[] }).only : undefined;
    const excludedSeries = only !== undefined && owner.seriesId !== undefined && !only.includes(owner.seriesId);
    const excludedValues = excludedSeries && context.geometry.type === 'line';
    // A histogram's open last bin prints its count even when the other counts are off.
    const openBin = (context.geometry.derived as { binning?: { openAbove?: number; edges: number[] } } | undefined)?.binning;
    const hasValueRequest = context.requestedValues.has(valueKey(owner)) || (context.geometry.type === 'histogram' && openBin?.openAbove !== undefined
      && owner.categoryId === JSON.stringify(['bin', openBin.edges.at(-2), openBin.edges.at(-1)]));
    const valueKind = context.geometry.type !== 'line' && typeof options.variant === 'string' && options.variant.startsWith('stacked') ? 'segment' : 'point';
    // A selection explains an absent request only for a value still in the plot; viewport exclusions were skipped above.
    const selectiveValues = typeof options.valueLabels === 'string' && options.valueLabels !== 'all';
    if (!hasValueRequest && owner.categoryId !== undefined && record.value.state === 'value'
      && (disabled(valueKind) || cellLabel === false || excludedValues || selectiveValues)) {
      const reason = cellLabel === false ? 'cell-label-disabled' : excludedValues ? 'seriesLabels.only'
        : disabled(valueKind) ? 'disabled' : `valueLabels:${options.valueLabels}`;
      const value = typeof cellLabel === 'string' ? cellLabel : interactionValueText(record.value, input.request.locale?.language);
      add(`${prefix}${valueKind}:${owner.seriesId ?? ''}:${owner.categoryId}`, `${record.label} ${value}`, reason, owner, valueKind, value);
    }
    if (context.geometry.type === 'scatter' && owner.pointId !== undefined && !hasValueRequest
      && (disabled('point') || context.capApplied)) {
      add(`${prefix}point:${owner.pointId}`, record.label, disabled('point') ? 'disabled' : 'maxPointLabels', owner, 'category');
    }
    const seriesSetting = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>).series : undefined;
    if (owner.seriesId !== undefined && record.seriesLabel !== undefined
      && (disabled('series') || options.seriesLabels === 'none' || excludedSeries || Array.isArray(seriesSetting) && !seriesSetting.includes('series'))
      && !context.drawnSeries.has(owner.seriesId)) {
      add(`${prefix}series:${owner.seriesId}`, record.seriesLabel, disabled('series') ? 'disabled' : 'seriesLabels', { seriesId: owner.seriesId }, 'series');
    }
    if (disabled('category') && owner.categoryId !== undefined && record.categoryLabel !== undefined
      && !context.drawnCategories.has(owner.categoryId)) {
      add(`${prefix}category:${owner.categoryId}`, record.categoryLabel, 'disabled', { categoryId: owner.categoryId }, 'category');
    }
    // Members are source identities of the actual Others aggregate, not a second topN calculation.
    if (context.topNCut && owner.categoryId !== undefined && !categories.some(category => category.id === owner.categoryId)) for (const member of record.members ?? []) {
      const category = categories.find(category => category.id === member.categoryId);
      if (category) add(`${prefix}category:${category.id}`, category.label ?? category.id, 'topN', { categoryId: category.id }, 'category');
    }
  }
  // Without an Others mark there is no aggregate record, so use the final kept identities.
  for (const [prefix, context] of contexts) if (context.topNCut && (context.options.topN as { rest?: boolean } | undefined)?.rest === false) {
    for (const category of context.categories) if (!context.keptCategories.has(category.id)) {
      add(`${prefix}category:${category.id}`, category.label ?? category.id, 'topN', { categoryId: category.id }, 'category');
    }
  }
  for (const [prefix, context] of contexts) {
    const { options, geometry } = context;
    const settings = typeof options.labels === 'object' && options.labels !== null ? options.labels as Record<string, unknown> : undefined;
    if (options.grandTotalLabels === false || options.labels === false || settings?.grandTotal === false) {
      const totals = (geometry.derived as { stackTotals?: Record<string, number>; totals?: Record<string, number> }).stackTotals
        ?? (geometry.derived as { totals?: Record<string, number> }).totals ?? {};
      if (['column', 'bar', 'combo'].includes(geometry.type)) for (const [id, raw] of Object.entries(totals)) {
        if (!Number.isFinite(raw) || geometry.labels.some(label => label.id === `grandTotal:${id}`)) continue;
        const category = context.categories.find(category => category.id === id);
        const value = interactionValueText({ kind: 'number', state: 'value', raw, derived: 'number',
          ...(typeof options.unit === 'string' ? { unit: options.unit } : {}), ...(typeof options.format === 'string' ? { format: options.format } : {}) }, input.request.locale?.language);
        add(`${prefix}grandTotal:${id}`, `${category?.label ?? id} ${value}`, 'disabled', { categoryId: id }, 'grandTotal', value);
      }
    }
    if (geometry.type === 'sparkline') {
      const names = (context.data as unknown as { labels?: string[] }).labels;
      if (options.endLabels === 'none' && names?.length) for (const [end, index] of [['first', 0], ['last', names.length - 1]] as const) {
        add(`${prefix}spark:label:${end}`, names[index]!, 'endLabels:none', {}, 'category');
      }
      if (options.valueLabel === 'none') {
        const last = records.filter(record => (record.target.panel ? `${record.target.panel}/` : '') === prefix && record.value.state === 'value').at(-1);
        if (last) {
          const value = interactionValueText(last.value, input.request.locale?.language);
          add(`${prefix}spark:last`, `${last.label} ${value}`, 'valueLabel:none', last.target.owner, 'point', value);
        }
      }
    }
  }
}

/** One chart's reading, from its accepted layout. */
export function chartReading(input: ChartReadingInput): ChartReading {
  const { records, note } = recordsFor(input);
  const title = (input.request.options as Record<string, unknown>).title;
  const byData = dataOrder(input.request.data, input.geometry.labels);
  const omissions = labelOmissions(input.geometry, input.request.options, input.request.data);
  unrequestedLabelOmissions(input, records ?? [], omissions);
  const dropped = input.geometry.labels.filter((label) => label.hidden !== undefined).sort((a, b) => byData(a.id, b.id));
  const labelsDroppedBy: Record<string, number> = {};
  for (const label of dropped) {
    const reason = label.noted ? 'note' : label.hidden!;
    labelsDroppedBy[reason] = (labelsDroppedBy[reason] ?? 0) + 1;
  }
  const series = [...new Set((records ?? []).flatMap((record) => (record.seriesLabel === undefined ? [] : [record.seriesLabel])))];
  const rounding = (input.geometry.derived as { roundingAdjustments?: RoundingAdjustment[] } | undefined)?.roundingAdjustments;
  const source = input.geometry.frame.source;
  const fittedSource = input.geometry.scene.find(node => node.id === input.geometry.frame.sourceNodeId && node.t === 'text');
  const sourceDrawn = source && (fittedSource?.t === 'text' && fittedSource.opacity !== 0
    && fittedSource.lines.join(' ').replace(/\s+/g, ' ').trim() === source.replace(/\s+/g, ' ').trim()
    || readableLabelDestination(input.geometry)('frame:source', source, {}, 'source'));
  return {
    name: input.name,
    type: input.type,
    counts: (input.geometry.a11y.counts ?? []).map(count => ({ ...count })),
    title: typeof title === 'string' && title.trim() !== '' ? title : null,
    size: { width: input.geometry.size.width, height: input.geometry.size.height },
    mode: input.geometry.mode ?? 'full',
    titleLines: input.geometry.frame.titleLines ?? 0,
    series,
    labelsPlaced: input.geometry.labels.length - dropped.length,
    labelsTruncated: cutLabels(input.geometry),
    labelsDropped: dropped.length,
    labelsDroppedBy,
    omissions: [...omissions.sort((a, b) => byData(a.labelId, b.labelId)),
      ...((input.geometry.derived as { omissions?: ChartReading['omissions'] }).omissions ?? []),
      ...(source && !sourceDrawn ? [{ labelId: 'frame:source', text: source, reason: fittedSource ? 'truncated' : 'not-drawn', destination: 'frame.source' }] : [])],
    derived: derivedNumbers(input.claims),
    ...((input.geometry.derived as GridDerived).metricStack ? { metricStack: { readouts: (input.geometry.derived as GridDerived).metricStack!.readouts } } : {}),
    claims: explainClaims(input.claims),
    values: valuesSummary(records, note),
    notes: chartNotes(input.geometry),
    ...(rounding ? { rounding: rounding.map((adjustment) => ({ ...adjustment })) } : {}),
  };
}
