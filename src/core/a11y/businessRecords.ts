import { chartString } from '../strings/a11y-businessRecords';
import type { WaterfallMarks, WaterfallDerived } from '../charts/waterfall/layout';
import type { KpiMarks, KpiDerived } from '../charts/kpi/layout';
import type { BulletMarks, BulletDerived } from '../charts/bullet/layout';
import { SPARKLINE_RING_RADIUS, kpiSparkSeries, lastObservedIndex, sparklinePointId, type SparklineMarks, type SparklineDerived } from '../charts/sparkline/layout';
import type { FunnelMarks, FunnelDerived } from '../charts/funnel/layout';
import type { PieMarks, PieDerived } from '../charts/pie/layout';
import type { MekkoMarks, MekkoDerived } from '../charts/mekko/layout';
import { mekkoStackingMode, poolMekkoCell } from '../charts/topN';
import type { ParetoMarks, ParetoData, ParetoDerived } from '../charts/pareto/layout';
import type { PvmData, PvmDerived } from '../charts/pvm/types';
import type { PyramidMarks } from '../charts/pyramid/layout';
import type { PyramidData, PyramidDerived } from '../charts/pyramid/types';
import type { WaffleDerived, WaffleMarks } from '../charts/waffle/types';
import type { TreemapDerived, TreemapMarks } from '../charts/treemap/types';
import type { SankeyDerived, SankeyMarks } from '../charts/sankey/types';
import type { LikertMarks, LikertData, LikertDerived, LikertOptions } from '../charts/likert/layout';
import { normalizeCategory, normalizeCell, normalizeSeriesValues } from '../normalize/shared';
import type { MekkoOptions } from '../types/options';
import type { ChartData, WaterfallData, KpiData, BulletData, SparklineData } from '../types/data';
import type { Geometry } from '../types/scene';
import { cellValue, isPctCell, type OwnerRef } from '../types/cell';
import { cellRecordValue, derivedPercent, derivedValue, makeRecord, numericValue, textValue, type RecordContext } from './recordsShared';
import type { InteractionRecord, InteractionValue } from './types';
import { detailRecordFields } from './details';

const unavailable = (reason: string): InteractionValue => ({ kind: 'number', raw: null, state: 'unavailable', reason });
const field = (key: string, label: string, value: InteractionValue) => ({ key, label, value });
// The base prints as the values it sums print: their unit and format.
const share = (value: InteractionValue, denominator: number | undefined, percent: number | undefined) => ({
  numerator: value, denominator: derivedValue(denominator, value.unit, value.format), percent: derivedPercent(percent),
});
const geometry = <M extends object, D extends object>(ctx: RecordContext) => ctx.geometry as unknown as Geometry<M, D>;
const number = (ctx: RecordContext, value: number | undefined) => numericValue(value, ctx.request.options.unit, ctx.request.options.format);
/** A sum or level the engine derived, in the chart's unit and format. */
const derived = (ctx: RecordContext, value: number | undefined) => derivedValue(value, ctx.request.options.unit, ctx.request.options.format);

/** Follow the same ownership changes as running levels, without recomputing values. */
function waterfallMembership(data: WaterfallData, derived: WaterfallDerived): Map<string, OwnerRef[]> {
  const totals = new Map<string, OwnerRef[]>();
  const levels = new Map<string, { end: OwnerRef[]; anchors: Map<string, OwnerRef[]> }>();
  const hiddenAfter = new Set(data.connectors?.filter(connector => connector.hidden).map(connector => connector.from));
  const inbound = new Map(data.connectors?.filter(connector => !connector.hidden).map(connector => [connector.to, connector]));
  let running: OwnerRef[] = [];
  /** The steps since the last baseline: what a subtotal drawn `toBaseline` adds up. */
  let block: OwnerRef[] = [];
  for (const item of data.items) {
    const connector = inbound.get(item.id);
    const origin = connector && levels.get(connector.from);
    if (origin) {
      running = origin.anchors.get(connector!.anchor ?? 'sum') ?? origin.end;
      block = [];
    }
    const anchors = new Map<string, OwnerRef[]>();
    const basis = derived.totalBasis[item.id];
    if (basis) {
      if (derived.levels[item.id]?.balance !== undefined) {
        totals.set(item.id, block);
        block = [];
      } else {
        running = basis.authored ? [{ categoryId: item.id }] : running;
        totals.set(item.id, running);
        if (item.type === 'total') block = [];
      }
      // The total's normalized placeholder has zero value; named anchors on
      // totals fall back to the total unless they explicitly name __total.
      anchors.set('__total', []);
    } else {
      if (item.toBaseline) {
        running = [];
        block = [];
      }
      if (item.segments?.length) {
        for (const segment of item.segments) {
          running = [...running, { categoryId: item.id, segmentId: segment.id }];
          block = [...block, { categoryId: item.id, segmentId: segment.id }];
          anchors.set(segment.id, running);
        }
      } else {
        running = [...running, { categoryId: item.id }];
        block = [...block, { categoryId: item.id }];
        anchors.set('__value', running);
      }
    }
    anchors.set('sum', running);
    levels.set(item.id, { end: running, anchors });
    if (hiddenAfter.has(item.id)) {
      running = [];
      block = [];
    }
  }
  return new Map([...totals].map(([id, members]) => [id, members.filter((member, index) =>
    members.findIndex(other => other.categoryId === member.categoryId && other.segmentId === member.segmentId) === index)]));
}

/** Segment ids in the order a composed total stacks them: first appearance across the bridge. */
function segmentOrder(data: WaterfallData): string[] {
  return [...new Set(data.items.flatMap(item => item.segments?.map(segment => segment.id) ?? []))];
}

function waterfall(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as WaterfallData;
  const geo = geometry<WaterfallMarks, WaterfallDerived>(ctx);
  if (data.cases?.length) return waterfallCases(ctx, data, geo);
  const membership = waterfallMembership(data, geo.derived);
  const order = segmentOrder(data);
  const segmentValue = (member: OwnerRef) => cellValue(normalizeCell(data.items.find(item => item.id === member.categoryId)?.segments?.find(part => part.id === member.segmentId)?.value, 'value')) ?? 0;
  return geo.marks.bars.flatMap(bar => {
    const item = data.items.find(item => item.id === bar.id)!;
    const basis = geo.derived.totalBasis[bar.id];
    return bar.segments.map(segment => {
      const source = item.segments?.find(source => source.id === segment.id);
      const total = geo.derived.totals[bar.id];
      const members = membership.get(bar.id) ?? [];
      const segmentedTotal = total !== undefined && segment.id !== '__value' && segment.id !== '__total';
      const operands = members.filter(member => member.segmentId === segment.id);
      const segmentTotal = operands.reduce((sum, member) => sum + segmentValue(member), 0);
      const value = segmentedTotal ? (operands.length ? derived(ctx, segmentTotal) : unavailable('Segment operands not retained')) : total === undefined
        ? cellRecordValue(normalizeCell(source?.value ?? item.value, 'value'), ctx.request.options.unit, ctx.request.options.format)
        : derived(ctx, total);
      return makeRecord(ctx, { categoryId: bar.id, ...(source || segmentedTotal ? { segmentId: segment.id } : {}) }, value, {
        label: source?.label ?? item.label ?? item.id, anchor: segment.rect,
        scenario: source?.scenario ?? item.scenario,
        ...(basis && !basis.authored ? { members: segmentedTotal ? operands : members } : {}),
        fields: segmentSpan(ctx, geo.derived.levels[bar.id]?.start, source ? item.segments!.map(part => ({ id: part.id, value: cellValue(normalizeCell(part.value, 'value')) ?? 0 }))
          : segmentedTotal ? order.filter(id => bar.segments.some(part => part.id === id))
            .map(id => ({ id, value: members.filter(member => member.segmentId === id).reduce((sum, member) => sum + segmentValue(member), 0) })) : undefined,
        segment.id, geo.derived.levels[bar.id]?.end),
      });
    });
  });
}

/**
 * Start and End of one mark: a segment's own, where the bar stacks
 * `parts` from `start` in their order, else the whole bar's.
 */
function segmentSpan(ctx: RecordContext, start: number | undefined, parts: { id: string; value: number }[] | undefined, id: string, end: number | undefined) {
  const index = parts?.findIndex(part => part.id === id) ?? -1;
  if (parts && index >= 0 && start !== undefined) {
    const from = parts.slice(0, index).reduce((sum, part) => sum + part.value, start);
    start = from;
    end = from + parts[index]!.value;
  }
  return [field('start', chartString(ctx.request.options, 'start'), derived(ctx, start)), field('end', chartString(ctx.request.options, 'end'), derived(ctx, end))];
}

/** A bridge with cases: one record per case bar, owned by its step and its case. */
function waterfallCases(ctx: RecordContext, data: WaterfallData, geo: Geometry<WaterfallMarks, WaterfallDerived>): InteractionRecord[] {
  const cases = data.cases!;
  return data.items.flatMap((item) => cases.flatMap((c, k) => {
    const key = `${item.id}:${c.id}`;
    const bar = geo.marks.bars.find((candidate) => candidate.id === key);
    if (!bar) return [];
    const total = geo.derived.totals[key];
    const cell = normalizeCell(item.values?.[k], 'value');
    // An authored total is the source cell, not a derivation, as on a bridge without cases.
    const value = total === undefined || geo.derived.totalBasis[key]?.authored
      ? cellRecordValue(cell, ctx.request.options.unit, ctx.request.options.format)
      : derived(ctx, total);
    // The bar draws the cell's scenario first, so the record names it too.
    const scenario = (typeof cell === 'object' && cell !== null && 'scenario' in cell ? cell.scenario : undefined) ?? item.scenario;
    return [makeRecord(ctx, { categoryId: item.id, seriesId: c.id }, value, {
      label: `${item.label ?? item.id}, ${c.label ?? c.id}`, anchor: bar.rect, scenario,
      fields: [field('start', chartString(ctx.request.options, 'start'), derived(ctx, geo.derived.levels[key]?.start)),
        field('end', chartString(ctx.request.options, 'end'), derived(ctx, geo.derived.levels[key]?.end))],
    })];
  }));
}

function kpi(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as KpiData;
  const geo = geometry<KpiMarks, KpiDerived>(ctx);
  const value = numericValue(data.value, ctx.request.options.unit, data.format ?? ctx.request.options.format);
  const nodeIds = [geo.marks.valueNodeId, ...(geo.marks.comparisonNodeIds ?? []), geo.marks.deltaNodeId,
    geo.marks.attainmentNodeId].filter((id): id is string => Boolean(id));
  const comparisons = (geo.derived.comparisons ?? []).map(comparison => ({
    label: comparison.label,
    ...(comparison.source === 'delta' ? { scenario: data.delta?.scenario } : {}),
    current: value, reference: numericValue(comparison.vs, value.unit, value.format),
    delta: numericValue(comparison.deltaAbs, value.unit, value.format),
    percent: comparison.deltaPct === null ? unavailable('Reference is nonpositive') : derivedPercent(comparison.deltaPct),
  }));
  const attainment = geo.derived.attainment;
  const card = makeRecord(ctx, { categoryId: 'kpi' }, value, {
    label: data.label, nodeIds, comparisons,
    fields: [...(geo.derived.band?.label ? [field('band', chartString(ctx.request.options, 'band'), textValue(geo.derived.band.label))] : []),
      ...(attainment ? [field('target', attainment.label, numericValue(attainment.vs, value.unit, value.format)),
        field('attainment', chartString(ctx.request.options, 'attainment'), attainment.pct === null ? unavailable(chartString(ctx.request.options, 'referenceNonpositive')) : derivedPercent(attainment.pct))] : [])],
  });
  // The spark's last value is a second quantity on the card. Where the card
  // prints it, it has its own record under the label's owner, so its label,
  // hover and description read one number.
  if (!data.spark || !geo.scene.some(node => node.id === 'label:spark:last')) return [card];
  const { cells, values } = kpiSparkSeries(data.spark);
  const index = lastObservedIndex(values)!;
  const dot = geo.scene.find(node => node.id === 'mark:spark:dot' || node.id === 'mark:sparkColLast');
  return [card, makeRecord(ctx, { seriesId: 'spark', segmentId: 'sparkLast' }, cellRecordValue(cells[index]!, value.unit, value.format), {
    label: `${data.label}, ${data.spark.labels?.[index] ?? chartString(ctx.request.options, 'latest')}`, nodeIds: dot ? [dot.id] : [],
  })];
}

/**
 * One record per observed point. A sparkline draws no markers, so
 * the anchor is a small box around the point: the hover card opens beside
 * the place on the line the reader is pointing at.
 */
function sparkline(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as SparklineData;
  const geo = geometry<SparklineMarks, SparklineDerived>(ctx);
  const cells = data.values.map((cell, index) => normalizeCell(cell, `values[${index}]`));
  // A missing value is a gap ring on the line, and it answers
  // the hover too, with its name and no value.
  const gaps = geo.scene.flatMap((node) => (node.t === 'circle' && node.part === 'sparkGap' ? [node] : [])).map((node) => {
    const index = Number(node.id.slice(node.id.lastIndexOf(':') + 1));
    const label = data.labels?.[index];
    return { id: sparklinePointId(index), index, x: node.cx, y: node.cy, ...(label === undefined ? {} : { label }) };
  });
  return [...geo.marks.points, ...gaps].sort((a, b) => a.index - b.index).map((point) => {
    const value = cellRecordValue(cells[point.index]!, ctx.request.options.unit, ctx.request.options.format);
    // The identity is the position and the label rides beside it:
    // a series that repeats a label has one record per point, and the card
    // still prints the month the reader is pointing at.
    return makeRecord(ctx, { categoryId: point.id }, value, {
      label: point.label ?? point.id,
      ...(point.label === undefined ? {} : { categoryLabel: point.label }),
      anchor: { x: point.x - SPARKLINE_RING_RADIUS, y: point.y - SPARKLINE_RING_RADIUS, w: 2 * SPARKLINE_RING_RADIUS, h: 2 * SPARKLINE_RING_RADIUS },
      fields: [field('position', chartString(ctx.request.options, 'position'), numericValue(point.index + 1))],
    });
  });
}

function bullet(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as BulletData;
  const geo = geometry<BulletMarks, BulletDerived>(ctx);
  return geo.marks.rows.map(mark => {
    const row = data.rows.find(row => row.id === mark.id)!;
    const value = cellRecordValue(normalizeCell(row.value, 'value'), ctx.request.options.unit, ctx.request.options.format);
    const target = cellRecordValue(normalizeCell(row.target, 'target'), value.unit, value.format);
    // The card names the target in the strings.target word.
    const word = ctx.request.options.strings?.target ?? 'target';
    const name = word[0]!.toUpperCase() + word.slice(1);
    return makeRecord(ctx, { categoryId: row.id }, value, {
      label: row.label ?? row.id, anchor: mark.rect,
      fields: [field('target', name, target)],
      comparisons: [{ label: name, current: value, reference: target,
        delta: typeof value.raw === 'number' && typeof target.raw === 'number' ? numericValue(value.raw - target.raw, value.unit, value.format) : unavailable('Value or target missing'),
        percent: typeof value.raw === 'number' && typeof target.raw === 'number' && target.raw > 0
          ? derivedPercent((value.raw - target.raw) / target.raw * 100) : unavailable('Positive reference and value required') }],
    });
  });
}

function seriesSource(ctx: RecordContext) {
  const data = ctx.request.data as ChartData;
  const categories = data.categories.map(normalizeCategory);
  const series = data.series.map((series, index) => ({ ...series, values: normalizeSeriesValues(series, categories, index) }));
  const cell = (categoryId: string, seriesId: string) => {
    const source = series.find(series => series.id === seriesId);
    return cellRecordValue(source?.values[categories.findIndex(category => category.id === categoryId)] ?? null,
      source?.unit ?? ctx.request.options.unit, source?.format ?? ctx.request.options.format);
  };
  const isPercent = (categoryId: string, seriesId: string) => isPctCell(series.find(series => series.id === seriesId)?.values[categories.findIndex(category => category.id === categoryId)] ?? null);
  const details = (categoryId: string, seriesId: string) => detailRecordFields(ctx.request.options,
    series.find(series => series.id === seriesId)?.values[categories.findIndex(category => category.id === categoryId)]);
  return { categories, series, cell, isPercent, details };
}

function funnel(ctx: RecordContext): InteractionRecord[] {
  const source = seriesSource(ctx);
  const geo = geometry<FunnelMarks, FunnelDerived>(ctx);
  return geo.marks.rows.flatMap(row => row.segments.map(segment => {
    const value = source.cell(row.categoryId, segment.id);
    const conversion = geo.derived.conversions.find(conversion => conversion.toId === row.categoryId);
    return makeRecord(ctx, { categoryId: row.categoryId, seriesId: segment.id }, value, {
      label: source.categories.find(category => category.id === row.categoryId)?.label ?? row.categoryId,
      anchor: segment.rect, scenario: source.series.find(series => series.id === segment.id)?.scenario,
      fields: [field('stageTotal', chartString(ctx.request.options, 'stageTotal'), derived(ctx, geo.derived.stageTotals[row.categoryId] ?? undefined)),
        field('conversion', chartString(ctx.request.options, 'stageConversion'), conversion ? derivedPercent(conversion.rate * 100) : unavailable(chartString(ctx.request.options, 'noPrecedingStage'))),
        ...source.details(row.categoryId, segment.id)],
    });
  }));
}

function pie(ctx: RecordContext): InteractionRecord[] {
  const source = seriesSource(ctx);
  const geo = geometry<PieMarks, PieDerived>(ctx);
  const series = source.series[0]!;
  const shown = new Set(geo.marks.slices.map(slice => slice.categoryId));
  return geo.marks.slices.map(slice => {
    const category = source.categories.find(category => category.id === slice.categoryId);
    const value = category ? source.cell(slice.categoryId, series.id) : derivedValue(slice.value, series.unit ?? ctx.request.options.unit, series.format ?? ctx.request.options.format);
    return makeRecord(ctx, { categoryId: slice.categoryId }, value, {
      label: category?.label ?? ctx.request.options.topN?.restLabel ?? ctx.request.options.strings?.others ?? 'Others', nodeIds: [slice.nodeId], scenario: series.scenario,
      fields: category ? source.details(slice.categoryId, series.id) : [],
      share: share(value, geo.marks.slices.reduce((sum, slice) => sum + slice.value, 0), slice.value / geo.marks.slices.reduce((sum, slice) => sum + slice.value, 0) * 100),
      ...(!category ? { members: source.categories.filter(category => !shown.has(category.id)).map(category => ({ categoryId: category.id, seriesId: series.id })) } : {}),
    });
  });
}

function mekkoShare(value: InteractionValue, total100: number | undefined, values: { value: InteractionValue; isPct: boolean }[], mode: string, isPct: boolean): NonNullable<InteractionRecord['share']> {
  const basis = total100 ?? values.reduce((sum, item) => sum + (!item.isPct && typeof item.value.raw === 'number' ? item.value.raw : 0), 0);
  if (mode === 'percent' && isPct) return {
    numerator: value, denominator: numericValue(100, '%'), percent: numericValue(typeof value.raw === 'number' ? value.raw : null, '%'),
  };
  const total = mode === 'percent' ? basis : values.reduce((sum, item) => sum + (typeof item.value.raw === 'number' ? item.value.raw : 0), 0);
  return { numerator: value, denominator: derivedValue(total, value.unit, value.format), percent:
    typeof value.raw === 'number' && total !== 0 ? derivedPercent(mode === 'bar' ? 100 : value.raw / total * 100) : unavailable('Nonzero composition basis required') };
}

function mekko(ctx: RecordContext): InteractionRecord[] {
  const source = seriesSource(ctx);
  const geo = geometry<MekkoMarks, MekkoDerived>(ctx);
  const options = ctx.request.options as MekkoOptions;
  const activeSeries = source.series.filter(series => series.role !== 'reference' && series.id !== options.widthSeriesId);
  const mode = mekkoStackingMode(options, activeSeries.length);
  const shown = new Set(geo.marks.columns.map(column => column.categoryId));
  const pooledCategories = source.categories.filter(category => !shown.has(category.id));
  const bases = pooledCategories.map(category => category.total100 ?? activeSeries.reduce((sum, series) => {
    const raw = source.cell(category.id, series.id).raw;
    return sum + (!source.isPercent(category.id, series.id) && typeof raw === 'number' ? raw : 0);
  }, 0));
  // The drawing's weights where a fold takes a mean: the width series, else equal columns.
  const widthSeries = source.series.some(series => series.id === options.widthSeriesId);
  const pooledWeights = pooledCategories.map(category => {
    const raw = widthSeries ? source.cell(category.id, options.widthSeriesId!).raw : 1;
    return typeof raw === 'number' ? Math.max(0, raw) : 0;
  });
  const pooledCells = new Map(activeSeries.map(series => [series.id, poolMekkoCell(pooledCategories.map((category, i) => {
    const raw = source.cell(category.id, series.id).raw;
    return { v: typeof raw === 'number' ? raw : null, isPct: source.isPercent(category.id, series.id), basis: bases[i]!, weight: pooledWeights[i]! };
  }), mode, widthSeries)]));
  const pooled = new Map([...pooledCells].map(([id, cell]) => [id, cell.v]));
  const pooledBasis = mode === 'percent' && pooledCategories.some(category => category.total100 !== undefined)
    ? bases.reduce((sum, basis) => sum + basis, 0) : undefined;
  return geo.marks.columns.flatMap(column => column.segments.map(segment => {
    const category = source.categories.find(category => category.id === column.categoryId);
    const members = pooledCategories.map(category => ({ categoryId: category.id, seriesId: segment.seriesId }));
    const series = source.series.find(series => series.id === segment.seriesId);
    const value = category ? source.cell(column.categoryId, segment.seriesId) : derivedValue(pooled.get(segment.seriesId), pooledCells.get(segment.seriesId)?.isPct ? '%' : series?.unit ?? ctx.request.options.unit, series?.format ?? ctx.request.options.format);
    const columnLabel = category?.label ?? ctx.request.options.topN?.restLabel ?? ctx.request.options.strings?.others ?? 'Others';
    const seriesLabel = series?.label ?? segment.seriesId;
    // The cell's card names its column and its series.
    return makeRecord(ctx, { categoryId: column.categoryId, seriesId: segment.seriesId }, value, {
      label: `${columnLabel} / ${seriesLabel}`, categoryLabel: columnLabel, seriesLabel,
      ...(!category ? { members } : {}), fields: category ? source.details(column.categoryId, segment.seriesId) : [],
      anchor: segment.rect, scenario: source.series.find(series => series.id === segment.seriesId)?.scenario,
      share: !category && [...pooled.values()].some(v => v === null)
        ? { numerator: value, denominator: unavailable('Incomplete composition'), percent: unavailable('Incomplete composition') }
        : mekkoShare(value, category ? category.total100 : pooledBasis, activeSeries.map(series => ({ value: category ? source.cell(column.categoryId, series.id) : numericValue(pooled.get(series.id)), isPct: Boolean(category && source.isPercent(column.categoryId, segment.seriesId)) })), mode, Boolean(category && source.isPercent(column.categoryId, segment.seriesId))),
    });
  }));
}

function pareto(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as ParetoData;
  const geo = geometry<ParetoMarks, ParetoDerived>(ctx);
  // An item's value is authored; the rest bucket's is a sum, and so is an
  // authored rest that a folded tail joined, even when every folded value is zero.
  const summed = (id: string) => {
    const item = data.items.find(item => item.id === id);
    return !item || (item.rest === true && (geo.derived.restBucket?.memberIds.length ?? 0) > 0);
  };
  const details = (id: string) => {
    const item = data.items.find(item => item.id === id);
    return { label: item?.label ?? item?.id ?? geo.derived.restBucket?.label ?? id,
      ...(summed(id) ? { members: geo.derived.restBucket?.memberIds.map(categoryId => ({ categoryId })) } : {}) };
  };
  const records = geo.marks.columns.flatMap(column => column.segments.map(segment => {
    const value = (summed(column.categoryId) ? derived : number)(ctx, geo.derived.values[column.categoryId]);
    return makeRecord(ctx, { categoryId: column.categoryId, seriesId: segment.seriesId }, value, {
      ...details(column.categoryId), anchor: segment.rect,
      share: share(value, geo.derived.total, geo.derived.total > 0 ? (geo.derived.values[column.categoryId]! / geo.derived.total) * 100 : undefined),
      fields: [field('cumulative', chartString(ctx.request.options, 'cumulativeShare'), derivedPercent(geo.derived.cumulativeShare[column.categoryId]))],
    });
  }));
  return [...records, ...geo.marks.lines.flatMap(line => line.points.map(point => makeRecord(ctx,
    { categoryId: point.categoryId, seriesId: line.seriesId }, derivedPercent(geo.derived.cumulativeShare[point.categoryId]), {
      ...details(point.categoryId), anchor: { x: point.x, y: point.y }, nodeIds: point.markerNodeId ? [point.markerNodeId] : [line.nodeId],
      fields: [field('cumulative', chartString(ctx.request.options, 'cumulativeAmount'), derived(ctx, geo.derived.cumulative[point.categoryId]))],
    })))];
}

function pvm(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as PvmData;
  const geo = geometry<WaterfallMarks, PvmDerived>(ctx);
  return geo.marks.bars.map(bar => {
    const effect = geo.derived.effects.find(effect => effect.id === bar.id);
    const value = bar.id === 'prior' ? geo.derived.priorRevenue : bar.id === 'current' ? geo.derived.currentRevenue : effect?.value;
    const ids = effect ? (effect.id === 'new' ? geo.derived.new : effect.id === 'lost' ? geo.derived.lost : geo.derived.common) : data.items.map(item => item.id);
    return makeRecord(ctx, { categoryId: bar.id }, derived(ctx, value), {
      label: effect?.label ?? bar.id, anchor: bar.rect, members: ids.map(categoryId => ({ categoryId })),
    });
  });
}

/** One record per panel and segment: the value in percent and the whole cells drawn for it. */
function waffle(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as ChartData;
  const geo = geometry<WaffleMarks, WaffleDerived>(ctx);
  const many = geo.derived.panels[0]?.segments.length !== 1;
  // Square mode draws no cells; its reading only repeats the share, so it gets no cells field.
  const square = (ctx.request.options as { variant?: string }).variant === 'square';
  return geo.derived.panels.flatMap((panel, index) => panel.segments.map(segment => {
    const mark = geo.marks.panels[index]!;
    const node = mark.segments.find(item => item.seriesId === segment.seriesId)?.nodeId;
    const series = data.series.find(item => item.id === segment.seriesId);
    return makeRecord(ctx, { categoryId: panel.categoryId, seriesId: segment.seriesId }, numericValue(segment.value, '%', series?.format ?? ctx.request.options.format), {
      label: many ? `${panel.label} / ${series?.label ?? segment.seriesId}` : panel.label, anchor: mark.rect, ...(node ? { nodeIds: [node] } : {}),
      fields: square ? [] : [field('cells', chartString(ctx.request.options, 'cells'), textValue(segment.reading))],
    });
  }));
}

/** One record per cell: its value, its share of the grand total, and its group. */
function treemap(ctx: RecordContext): InteractionRecord[] {
  const geo = geometry<TreemapMarks, TreemapDerived>(ctx);
  const groups = new Map(geo.derived.groups.map(group => [group.id, group.label]));
  return geo.derived.items.map(item => {
    const value = number(ctx, item.value);
    const group = item.group === undefined ? undefined : groups.get(item.group);
    const nodeId = geo.marks.cells.find(cell => cell.id === item.id)?.nodeId;
    return makeRecord(ctx, { ...(item.group !== undefined ? { seriesId: item.group } : {}), categoryId: item.id }, value, {
      label: item.label, ...(nodeId ? { nodeIds: [nodeId] } : {}), share: share(value, geo.derived.total, item.share),
      ...(group !== undefined ? { fields: [field('group', chartString(ctx.request.options, 'group'), textValue(group))] } : {}),
    });
  });
}

/**
 * Sankey: column by column, top down, each node and then its outgoing links in
 * drawn order. A node gives its value, share of its column, inflow and outflow
 * (they differ where flow leaks or joins), its stage and an Other node's members;
 * a link gives its value and its share of the source's outflow and the target's inflow.
 */
function sankey(chart: RecordContext): InteractionRecord[] {
  const geo = geometry<SankeyMarks, SankeyDerived>(chart);
  // A percent format that the chart applies to the shares leaves the flow values unformatted.
  const ctx = geo.derived.formatsShares
    ? { ...chart, request: { ...chart.request, options: { ...chart.request.options, format: undefined } } } as RecordContext : chart;
  const options = ctx.request.options;
  const nodes = new Map(geo.derived.nodes.map(node => [node.key, node]));
  const rank = new Map(geo.derived.nodes.map((node, index) => [node.key, index]));
  const stageLabel = (column: number) => geo.derived.stages[column]?.label;
  const name = (key: string) => {
    const node = nodes.get(key)!;
    const stage = node.stage !== undefined ? stageLabel(node.column) : undefined;
    return stage !== undefined ? `${node.label} (${stage})` : node.label;
  };
  const percent = (value: number) => derivedPercent(value);
  return geo.derived.nodes.flatMap(node => {
    const mark = geo.marks.nodes.find(entry => entry.key === node.key);
    const value = number(ctx, node.value);
    const stage = node.stage !== undefined ? stageLabel(node.column) : undefined;
    const record = makeRecord(ctx, { categoryId: node.key }, value, {
      label: node.label, ...(mark ? { nodeIds: [mark.nodeId], anchor: mark.rect } : {}),
      share: share(value, geo.derived.stages[node.column]?.total, node.share),
      fields: [
        ...(stage !== undefined ? [field('stage', chartString(options, 'stage'), textValue(stage))] : []),
        ...(node.in > 0 && node.out > 0 && node.in !== node.out ? [
          field('inflow', chartString(options, 'inflow'), derived(ctx, node.in)),
          field('outflow', chartString(options, 'outflow'), derived(ctx, node.out)),
        ] : []),
        ...(node.members ? [field('includes', chartString(options, 'includes'), textValue(node.members.map(member => member.label).join(', ')))] : []),
      ],
    });
    const outgoing = geo.derived.links.filter(link => link.source === node.key)
      .sort((a, b) => rank.get(a.target)! - rank.get(b.target)!);
    return [record, ...outgoing.map(link => {
      const linkMark = geo.marks.links.find(entry => entry.key === link.key);
      return makeRecord(ctx, { segmentId: link.key }, number(ctx, link.value), {
        label: `${name(link.source)} → ${name(link.target)}`, ...(linkMark ? { nodeIds: [linkMark.nodeId], anchor: linkMark.at } : {}),
        fields: [
          field('shareOfSource', chartString(options, 'shareOfSource'), percent(link.shareOfSource)),
          field('shareOfTarget', chartString(options, 'shareOfTarget'), percent(link.shareOfTarget)),
        ],
      });
    })];
  });
}

function pyramid(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as PyramidData;
  const geo = geometry<PyramidMarks, PyramidDerived>(ctx);
  return [geo.marks.left, geo.marks.right].flatMap((marks, index) => marks.map(mark => {
    const groupId = geo.derived.groupIds[index]!;
    const value = number(ctx, geo.derived.values[mark.id]?.[groupId]);
    return makeRecord(ctx, { categoryId: mark.id, seriesId: groupId }, value, {
      label: data.bands.find(band => band.id === mark.id)?.label ?? mark.id, anchor: mark.rect,
      share: share(value, geo.derived.grandTotal, typeof value.raw === 'number' && geo.derived.grandTotal > 0 ? value.raw / geo.derived.grandTotal * 100 : undefined),
    });
  }));
}

/**
 * A response share: through the chart's own format when it declares one; an
 * authored percentage (values 'percent') exactly as authored; a share the
 * engine computed from counts as every derived percentage prints
 * (10.884353741496598 reads 10.88%).
 */
function shareValue(share: number | undefined, format: string | undefined, authored: boolean): InteractionValue {
  if (format !== undefined || authored || share === undefined) return numericValue(share, '%', format);
  return derivedPercent(share);
}

function likert(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as LikertData;
  const options = ctx.request.options as LikertOptions;
  const geo = geometry<LikertMarks, LikertDerived>(ctx);
  return geo.marks.rows.flatMap(row => row.bars.map(bar => {
    const option = data.scale.find(option => [ `likert:${option.id}`, `likert:${option.id}:neg`, `likert:${option.id}:pos` ].includes(bar.seriesId))!;
    const item = data.items.find(item => item.id === row.id)!;
    const index = data.scale.indexOf(option);
    const entry = item.values[index];
    const raw = typeof entry === 'object' && entry !== null
      ? (item.values as { optionId: string; value: number | null }[]).find(value => value.optionId === option.id)?.value : entry;
    const value = numericValue(raw, options.values === 'percent' ? '%' : ctx.request.options.unit);
    return makeRecord(ctx, { categoryId: row.id, seriesId: bar.seriesId }, value, {
      label: `${item.label ?? item.id} / ${option.label ?? option.id}`, anchor: bar.rect,
      fields: [field('share', chartString(ctx.request.options, 'responseShare'), shareValue(geo.derived.shares[row.id]?.[option.id], options.format, options.values === 'percent')),
        field('base', chartString(ctx.request.options, 'sampleSize'), row.id in geo.derived.base ? numericValue(geo.derived.base[row.id]) : unavailable(chartString(ctx.request.options, 'sampleSizeMissing')))],
    });
  }));
}

export function businessRecords(ctx: RecordContext): InteractionRecord[] | undefined {
  switch (ctx.request.type) {
    case 'waterfall': return waterfall(ctx);
    case 'kpi': return kpi(ctx);
    case 'bullet': return bullet(ctx);
    case 'sparkline': return sparkline(ctx);
    case 'funnel': return funnel(ctx);
    case 'pie': return pie(ctx);
    case 'mekko': return mekko(ctx);
    case 'pareto': return pareto(ctx);
    case 'pvm': return pvm(ctx);
    case 'pyramid': return pyramid(ctx);
    case 'waffle': return waffle(ctx);
    case 'treemap': return treemap(ctx);
    case 'sankey': return sankey(ctx);
    case 'likert': return likert(ctx);
    default: return undefined;
  }
}
