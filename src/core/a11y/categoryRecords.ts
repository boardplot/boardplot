import { chartString } from '../strings/a11y-categoryRecords';
import type { BarDerived } from '../charts/bar/layout';
import type { ColumnDerived } from '../charts/column/layout';
import type { LineDerived } from '../charts/line/layout';
import type { SlopeDerived } from '../charts/slope/layout';
import { stackAdds } from '../stackAdds';
import { calendarNames } from '../calendarLabels';
import { rectCenter } from '../geometry';
import { normalizeCategory, normalizeScenario, normalizeSeriesValues } from '../normalize/shared';
import { cellMeta, cellValue, isPctCell, type Cell, type RangeCell, type Scenario } from '../types/cell';
import type { Category, ChartData, HeatmapSeries, Series, SlopeSeries } from '../types/data';
import { categoryMarks, type CellMark } from './categoryMarks';
import { detailRecordFields } from './details';
import { compareValues, unavailableValue } from './comparison';
import { cellRecordValue, derivedPercent, derivedValue, makeRecord, numericValue, statedValue, textValue, withoutResidue, type RecordContext } from './recordsShared';
import type { InteractionRecord, InteractionValue } from './types';
import { chartWording } from '../strings';
import { pushAll } from '../arrays';

interface Matrix {
  categories: Category[];
  series: (Series & { cells: Cell[] })[];
  shown: Set<string>;
  categoryIndex: Map<string, number>;
  displayedIndex: Map<string, number>;
  seriesIndex: Map<string, Matrix['series'][number]>;
  restValues: Map<string, number>;
}

function valueFor(ctx: RecordContext, matrix: Matrix, series: Matrix['series'][number], categoryId: string): InteractionValue {
  const index = matrix.categoryIndex.get(categoryId) ?? -1;
  if (index >= 0) return cellRecordValue(series.cells[index]!, series.unit ?? ctx.request.options.unit, series.format ?? ctx.request.options.format);
  const aggregate = categoryId === '__others' || categoryId === '__rest'
    || (ctx.request.type === 'column' && Boolean(ctx.request.options.topN) && /^_*others$/.test(categoryId));
  if (!aggregate) return unavailableValue('No source category for this mark');
  const sum = matrix.restValues.get(series.id) ?? 0;
  return derivedValue(sum, series.unit ?? ctx.request.options.unit, series.format ?? ctx.request.options.format);
}

function comparisons(ctx: RecordContext, matrix: Matrix, source: Matrix['series'][number], sourceScenario: Scenario | undefined, categoryId: string, value: InteractionValue): InteractionRecord['comparisons'] {
  if (sourceScenario && sourceScenario !== 'AC') return [];
  const index = matrix.categoryIndex.get(categoryId);
  const refs = matrix.series.flatMap(series => {
    const scenario = normalizeScenario((index === undefined ? undefined : cellMeta(series.cells[index]!)?.scenario) ?? series.scenario, 'scenario');
    return series.id !== source.id && scenario && scenario !== 'AC' ? [{ series, scenario }] : [];
  });
  const variant = (ctx.request.options as { variant?: string }).variant;
  const stacked = ctx.request.type === 'combo' ? !source.kind || source.kind === 'column'
    : ['stacked', 'stacked100', 'stacked-area', 'stacked100-area'].includes(variant ?? '');
  const stackedComponent = stacked &&
    matrix.series.filter(series => series.role !== 'reference' &&
      (ctx.request.type !== 'combo' || !series.kind || series.kind === 'column')).length > 1;
  return refs.map(({ series: reference, scenario }) => {
    const duplicates = refs.filter(candidate => candidate.scenario === scenario);
    const reason = duplicates.length > 1 ? 'More than one series has this comparison scenario'
      : (reference.axis ?? 'primary') !== (source.axis ?? 'primary') ? 'Comparison uses a different axis'
      : stackedComponent && reference.role === 'reference' ? 'A stacked component has no per-component comparison reference' : undefined;
    return {
      ...compareValues(value, valueFor(ctx, matrix, reference, categoryId), reference.label ?? reference.id, scenario, reason),
      target: { ...ctx.scope, owner: { seriesId: reference.id, categoryId } },
    };
  });
}

function shareFor(ctx: RecordContext, matrix: Matrix, mark: CellMark, value: InteractionValue): InteractionRecord['share'] {
  const options = ctx.request.options as typeof ctx.request.options & { variant?: string };
  const variants = ['stacked', 'stacked100', 'stacked100-area', 'stacked-area'];
  if (!variants.includes(options.variant ?? '') && !options.valueAxis?.percent && ctx.request.type !== 'combo') return undefined;
  // A missing observation is no part of the whole.
  if (value.state === 'missing') return undefined;
  const source = matrix.seriesIndex.get(mark.seriesId)!;
  if (source.role === 'reference' || (ctx.request.type === 'combo' && source.kind !== undefined && source.kind !== 'column')) return undefined;
  const ci = matrix.categoryIndex.get(mark.categoryId) ?? -1;
  const parts = matrix.series.filter(series => series.role !== 'reference' && (ctx.request.type !== 'combo' || !series.kind || series.kind === 'column'));
  // Percents of different wholes have no total, so no share of one.
  if (['column', 'bar', 'combo'].includes(ctx.request.type) && !stackAdds(
    parts.map(series => ({ label: series.label ?? series.id, unit: series.unit, pctCells: series.cells.some(cell => cell !== null && isPctCell(cell)) })),
    ctx.request.options.unit, (ctx.request.options as { sharesOfOneWhole?: boolean }).sharesOfOneWhole)) return undefined;
  const category = matrix.categories[ci];
  const directShare = ci >= 0 && isPctCell(source.cells[ci]!);
  // One plotted series IS its category, and "100 % of the value you are
  // pointing at" is arithmetic, not a fact. It is a fact again as
  // soon as the basis comes from somewhere else: an authored `total100`, or
  // a cell that already states a percentage.
  if (parts.length < 2 && category?.total100 === undefined && !directShare) return undefined;
  const values = parts.map(series => valueFor(ctx, matrix, series, mark.categoryId));
  const hasNegative = values.some(part => typeof part.raw === 'number' && part.raw < 0);
  // The base prints as the values it sums print: their unit and format.
  const like = directShare ? ctx.request.options : value;
  const denominator = derivedValue(category?.total100 ?? values.reduce((sum, part, index) => sum +
    (ci >= 0 && isPctCell(parts[index]!.cells[ci]!) ? 0 : typeof part.raw === 'number' ? part.raw : 0), 0), like.unit, like.format);
  const existing = ctx.request.type === 'bar' ? (ctx.geometry.derived as unknown as BarDerived).shares?.[mark.categoryId]?.[mark.seriesId]
    : ctx.request.type === 'column' ? (ctx.geometry.derived as unknown as ColumnDerived).percents?.[mark.categoryId]?.[mark.seriesId] : undefined;
  if (directShare && existing !== undefined) return {
    numerator: value, denominator: numericValue(100, '%'), percent: numericValue(existing, '%'),
  };
  const percent = hasNegative ? unavailableValue('A signed composition has no share of a nonnegative total', '%')
    : (denominator.raw as number) <= 0 ? unavailableValue('Share requires a positive total', '%')
    : value.state !== 'value' ? unavailableValue('The observation is unavailable', '%')
    : directShare ? numericValue(value.raw as number, '%')
    : derivedPercent(existing ?? (value.raw as number) / (denominator.raw as number) * 100);
  // The record states the share the data supports: this value, the category
  // total in the data's own unit, and the percent the chart draws. What a
  // 100 % chart leaves unprinted is a question for the card, not for the
  // fact.
  return { numerator: value, denominator, percent };
}

function cellFacts(ctx: RecordContext, cell: RangeCell | undefined, category: Category | undefined, unit?: string): InteractionRecord['fields'] {
  const fields: InteractionRecord['fields'] = [];
  if (category?.date) fields.push({ key: 'date', label: chartString(ctx.request.options, 'date'), value: textValue(category.date, 'date') });
  if (cell && typeof cell === 'object' && 'range' in cell && cell.range) {
    for (const key of ['low', 'high', 'mid'] as const) if (cell.range[key] !== undefined) {
      fields.push({ key, label: key, value: numericValue(cell.range[key], unit) });
    }
  }
  const footnote = cell ? cellMeta(cell)?.footnote ?? category?.footnote : category?.footnote;
  if (footnote !== undefined) fields.push({ key: 'footnote', label: chartString(ctx.request.options, 'footnote'), value: numericValue(footnote) });
  fields.push(...detailRecordFields(ctx.request.options, cell));
  return fields;
}

function categoryRecord(ctx: RecordContext, matrix: Matrix, mark: CellMark): InteractionRecord {
  const series = matrix.seriesIndex.get(mark.seriesId)!;
  const ci = matrix.categoryIndex.get(mark.categoryId) ?? -1;
  const category = matrix.categories[ci];
  const found = valueFor(ctx, matrix, series, mark.categoryId);
  // A stacked area draws a missing part as zero (the chart's note says so); the card says it too.
  const variant = (ctx.request.options as { variant?: string }).variant;
  const cellState = ctx.request.type === 'heatmap' && found.state === 'missing' ? (series as HeatmapSeries).states?.[ci] : undefined;
  const value = cellState ? statedValue(found, cellState, ctx.request.options)
    : found.state === 'missing' && ctx.request.type === 'line' && (variant === 'stacked-area' || variant === 'stacked100-area')
      ? { ...found, reason: 'No observation; drawn as 0 in the stack' } : found;
  const scenario = normalizeScenario(cellMeta(series.cells[ci]!)?.scenario ?? series.scenario, 'scenario');
  const othersLabel = (ctx.request.options as { topN?: { restLabel?: string }; strings?: { others?: string } }).topN?.restLabel
    ?? (ctx.request.options as { strings?: { others?: string } }).strings?.others
    ?? 'Others';
  const record = makeRecord(ctx, { categoryId: mark.categoryId, seriesId: mark.seriesId }, value, {
    label: `${category?.label ?? othersLabel} / ${series.label ?? series.id}`,
    categoryLabel: category?.label ?? othersLabel, seriesLabel: series.label ?? series.id,
    nodeIds: mark.nodeIds, anchor: mark.anchor, scenario, fields: cellFacts(ctx, series.cells[ci], category, value.unit),
    comparisons: comparisons(ctx, matrix, series, scenario, mark.categoryId, value),
    ...(ci < 0 ? { members: matrix.categories.filter(item => !matrix.shown.has(item.id)).map(item => ({ categoryId: item.id, seriesId: series.id })) } : {}),
  });
  const share = shareFor(ctx, matrix, mark, value);
  if (share) record.share = share;
  const bump = ctx.request.type === 'line' ? (ctx.geometry.derived as unknown as LineDerived).bump : undefined;
  const rankIndex = matrix.displayedIndex.get(mark.categoryId) ?? -1;
  if (bump?.ranks[series.id]?.[rankIndex] != null) record.rank = { value: bump.ranks[series.id]![rankIndex]!, of: bump.participants[mark.categoryId]!, policy: 'competition', direction: bump.direction === 'higherIsBetter' ? 'desc' : 'asc' };
  const sort = ctx.request.options.sort?.categories;
  if (ctx.request.type === 'bar' && (sort === 'asc' || sort === 'desc')) {
    const order = (ctx.geometry.derived as unknown as BarDerived).order;
    record.rank = { value: order.indexOf(mark.categoryId) + 1, of: order.length, policy: 'display-order', direction: sort };
  }
  return record;
}

/**
 * The slope fold draws one 'Other' line for the series it summed. That line
 * has no source series, so it gets its records here: at each end the summed
 * value the engine derived, the line's own share of the endpoint total, and
 * the folded series as its members.
 */
function slopeOtherRecords(ctx: RecordContext, marks: readonly CellMark[], categories: readonly Category[]): InteractionRecord[] {
  const folded = ctx.request.type === 'slope' ? (ctx.geometry.derived as unknown as SlopeDerived).folded : undefined;
  if (!folded) return [];
  const options = ctx.request.options;
  const seriesLabel = chartWording(options, 'others', 'Other');
  const ends = [{ category: categories[0], value: folded.values.from, share: folded.shares.from },
    { category: categories[categories.length - 1], value: folded.values.to, share: folded.shares.to }];
  return marks.filter(mark => mark.seriesId === folded.otherId).flatMap(mark => {
    const end = ends.find(entry => entry.category?.id === mark.categoryId);
    if (!end?.category) return [];
    return [makeRecord(ctx, { categoryId: mark.categoryId, seriesId: mark.seriesId }, numericValue(end.value, options.unit, options.format), {
      label: `${end.category.label} / ${seriesLabel}`, categoryLabel: end.category.label, seriesLabel,
      nodeIds: mark.nodeIds, anchor: mark.anchor,
      fields: [{ key: 'share', label: chartString(ctx.request.options, 'shareOfTotal'), value: derivedPercent(end.share * 100) }],
      members: folded.memberIds.map(seriesId => ({ seriesId, categoryId: mark.categoryId })),
    })];
  });
}

/**
 * Where a missing observation inside a series sits: at its category's
 * position (another series' mark there, its axis tick, or the step between
 * the series' drawn neighbours), and across it halfway between those
 * neighbours, the middle of a line's gap. The pointer finds the gap there, so
 * a series with no other mark in the category still opens a card that says
 * the value is missing.
 */
function gapAnchor(ctx: RecordContext, marks: readonly CellMark[], matrix: Matrix, seriesId: string, categoryId: string): InteractionRecord['anchor'] {
  const along = ctx.request.type === 'bar' ? 'y' : 'x';
  const across = along === 'x' ? 'y' : 'x';
  const index = matrix.categoryIndex.get(categoryId)!;
  const center = (mark: CellMark) => mark.anchor && rectCenter({ w: 0, h: 0, ...mark.anchor });
  let before: { index: number; at: { x: number; y: number } } | undefined;
  let after: typeof before;
  let beside: { x: number; y: number } | undefined;
  for (const mark of marks) {
    const at = center(mark);
    const own = matrix.categoryIndex.get(mark.categoryId);
    if (!at || own === undefined) continue;
    if (own === index) beside ??= at;
    if (mark.seriesId !== seriesId) continue;
    if (own < index && (!before || own > before.index)) before = { index: own, at };
    if (own > index && (!after || own < after.index)) after = { index: own, at };
  }
  const tick = ctx.geometry.axes.find(axis => axis.axis === along)?.ticks.find(entry => String(entry.at) === categoryId);
  // A column category with no value in any series keeps its slot: the card sits at its tick, on the baseline.
  const baseline = ctx.request.type === 'column' && !beside ? ctx.geometry.scene.find(node => node.t === 'line' && node.part === 'baseline') : undefined;
  if (tick && baseline?.t === 'line') return { x: tick.pos, y: baseline.y1 };
  // A series that has not started or has ended has no gap there: its card would lead with a value nobody drew.
  if (!before || !after) return undefined;
  const position = beside?.[along] ?? tick?.pos
    ?? before.at[along] + (after.at[along] - before.at[along]) * (index - before.index) / (after.index - before.index);
  const at = (before.at[across] + after.at[across]) / 2;
  return along === 'x' ? { x: position, y: at } : { x: at, y: position };
}

export function categoryRecords(ctx: RecordContext): InteractionRecord[] | undefined {
  const marks = categoryMarks(ctx);
  if (!marks) return undefined;
  const data = ctx.request.data as ChartData;
  // The axis of a line, column or combo chart names an unlabelled date
  // category as its period ("Mar" over a "2025" year row); the record names
  // it with its year ("Mar 2025"), as a reader who sees one category needs.
  const periods = ['line', 'column', 'combo'].includes(ctx.request.type) ? calendarNames(data.categories, ctx.request.locale?.language) : undefined;
  const categories = data.categories.map((raw, index) => {
    const category = normalizeCategory(raw, index);
    return periods?.[index] === undefined ? category : { ...category, label: periods[index] };
  });
  // Slope 'diverging' draws each negative share as its own series (`<id>:negative`), so it reads its own values.
  const negName = (ctx.request.options as { diverging?: { labels?: { negative?: string } } }).diverging?.labels?.negative ?? 'Negative';
  const drawn = ctx.request.type === 'slope' && (ctx.request.options as { variant?: string }).variant === 'diverging'
    ? (data.series as SlopeSeries[]).flatMap((item): Series[] => item.role !== 'reference' && Array.isArray(item.negative)
      ? [item, { ...item, id: `${item.id}:negative`, label: `${item.label ?? item.id} (${negName})`, values: item.negative }] : [item])
    : data.series;
  const series = drawn.map((series, index) => ({ ...series, scenario: normalizeScenario(series.scenario, `series[${index}].scenario`), cells: normalizeSeriesValues(series, categories, index) }));
  // A Total column the engine weighted: its records carry the drawn shares and base.
  const computed = ctx.request.type === 'column' ? (ctx.geometry.derived as unknown as ColumnDerived).computedTotal : undefined;
  const ti = computed ? categories.findIndex(category => category.id === computed.categoryId) : -1;
  if (computed && ti >= 0) {
    categories[ti] = { ...categories[ti]!, total100: computed.total100 };
    for (const entry of series) if (computed.values[entry.id] !== undefined) entry.cells[ti] = { pct: computed.values[entry.id]! };
  }
  const shown = new Set(ctx.request.type === 'bar' ? (ctx.geometry.derived as unknown as BarDerived).order
    // A drawn column category with a value; derived.stackTotals does not list every one.
    : ctx.request.type === 'column' ? (ctx.geometry.axes.find(axis => axis.axis === 'x')?.ticks.map(tick => String(tick.at)) ?? []).filter(id => {
      const index = categories.findIndex(category => category.id === id);
      return index < 0 || series.some(entry => entry.role !== 'reference' && entry.cells[index] !== null);
    })
    : ctx.request.type === 'line' ? (ctx.geometry.axes.find(axis => axis.axis === 'x')?.ticks.map(tick => String(tick.at)) ?? []) : marks.map(mark => mark.categoryId));
  const matrix: Matrix = { categories, series, shown,
    displayedIndex: new Map([...shown].map((id, index) => [id, index])),
    categoryIndex: new Map(categories.map((category, index) => [category.id, index])),
    seriesIndex: new Map(series.map(series => [series.id, series])),
    restValues: new Map(series.map(series => [series.id, categories.reduce((total, category, index) => total + (shown.has(category.id) ? 0 : cellValue(series.cells[index]!) ?? 0), 0)])),
  };
  const records = marks.filter(mark => matrix.seriesIndex.has(mark.seriesId)).map(mark => categoryRecord(ctx, matrix, mark));
  pushAll(records, slopeOtherRecords(ctx, marks, categories));
  const marked = new Set(marks.map(mark => JSON.stringify([mark.seriesId, mark.categoryId])));
  // A column category every series leaves empty is not in `shown` (it has no value to total), but its slot is drawn.
  const slots = ctx.request.type === 'column' ? new Set(ctx.geometry.axes.find(axis => axis.axis === 'x')?.ticks.map(tick => String(tick.at)) ?? []) : shown;
  for (const series of matrix.series) if (series.role !== 'reference') for (const category of categories) {
    const index = matrix.categoryIndex.get(category.id)!;
    if (slots.has(category.id) && series.cells[index] === null && !marked.has(JSON.stringify([series.id, category.id]))) {
      records.push(categoryRecord(ctx, matrix, { seriesId: series.id, categoryId: category.id, nodeIds: [], anchor: gapAnchor(ctx, marks, matrix, series.id, category.id) }));
    }
  }
  // The weighted Total column is the engine's arithmetic: its figures read as computed, without float residue.
  if (computed && ti >= 0) return records.map(record => record.target.owner.categoryId === computed.categoryId && record.value.kind === 'number' && record.value.derived === undefined
    ? { ...record, value: { ...record.value, ...(typeof record.value.raw === 'number' ? { raw: withoutResidue(record.value.raw) } : {}), derived: 'number' as const } } : record);
  return records;
}
