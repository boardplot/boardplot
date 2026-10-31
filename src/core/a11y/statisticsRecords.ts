import { chartString } from '../strings/a11y-statisticsRecords';
import type { BoxData, BoxDerived, BoxMarks } from '../charts/box/types';
import type { CohortDerived, CohortMarks, CohortCellMark, CohortRowDerived } from '../charts/cohort/types';
import type { HistogramData, HistogramDerived, HistogramMarks } from '../charts/histogram/types';
import type { ScatterMarks } from '../charts/scatter/layout';
import type { ChoroplethData, ChoroplethMarks } from '../charts/choropleth/types';
import type { GeoOverlay, GeoOverlayMark } from '../charts/choropleth/overlayTypes';
import type { TilemapMarks } from '../charts/tilemap/types';
import type { ScatterData } from '../types/data';
import type { OwnerRef } from '../types/cell';
import { normalizeCell, normalizeScenario } from '../normalize/shared';
import { cellRecordValue, derivedPercent, makeRecord, numericValue, statedValue, textValue, withoutResidue, type RecordContext } from './recordsShared';
import { DERIVED_PERCENT_FORMAT, displayedValueText } from './valueText';
import { intervalText } from '../format';
import type { InteractionRecord, InteractionValue } from './types';
import { pushAll } from '../arrays';
import { withUnit as joinUnit } from '../unitJoin';

const field = (key: string, label: string, value: InteractionValue) => ({ key, label, value });
const numberField = (key: string, raw: number | null | undefined, unit?: string, format?: string) =>
  field(key, key, numericValue(raw, unit, format));

export function statisticsRecords(ctx: RecordContext): InteractionRecord[] | undefined {
  switch (ctx.request.type) {
    case 'scatter': return scatterRecords(ctx);
    case 'box': return boxRecords(ctx);
    case 'histogram': return histogramRecords(ctx);
    case 'cohort': return cohortRecords(ctx);
    case 'choropleth': case 'tilemap': return mapRecords(ctx);
    default: return undefined;
  }
}

function scatterRecords(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as ScatterData;
  const marks = ctx.geometry.marks as unknown as ScatterMarks;
  const byId = new Map(marks.points.map(point => [point.id, point]));
  const { unit, format } = ctx.request.options;
  return data.points.map(point => {
    const mark = byId.get(point.id);
    const x = cellRecordValue(normalizeCell(point.x, `points[${point.id}].x`), unit, format);
    const y = cellRecordValue(normalizeCell(point.y, `points[${point.id}].y`), unit, format);
    const fields = [field('x', 'x', x), field('y', 'y', y)];
    if (point.size !== undefined) fields.push(numberField('size', point.size));
    if (point.group !== undefined) fields.push(field('group', chartString(ctx.request.options, 'group'), textValue(point.group)));
    return makeRecord(ctx, { pointId: point.id }, y, {
      label: point.label ?? point.id, fields,
      ...(point.scenario ? { scenario: normalizeScenario(point.scenario, `points[${point.id}].scenario`) } : {}),
      ...(mark ? { anchor: { x: mark.cx, y: mark.cy } } : {}),
      // A dot of a dense cloud is drawn in its colour's shared path, which owns no point.
      ...(mark?.nodeId?.startsWith('mark:dense:') ? { nodeIds: [mark.nodeId] } : {}),
    });
  });
}

/** Value and duplicate occurrence identify observations without depending on input order. */
function observations(values: readonly number[], owner: OwnerRef = {}): { owner: OwnerRef; value: number }[] {
  const seen = new Map<number, number>();
  return [...values].sort((a, b) => a - b).map(value => {
    const occurrence = seen.get(value) ?? 0;
    seen.set(value, occurrence + 1);
    return { owner: { ...owner, pointId: JSON.stringify(['observation', value, occurrence]) }, value };
  });
}

/**
 * A statistic the engine computed (an interpolated quartile, the IQR, a
 * fence) without the residue of binary arithmetic: 186.82500000000002 reads
 * 186.825. A value that equals an observation is authored and stays exact.
 */
function computedValue(value: number | null, observed: ReadonlySet<number>): number | null {
  return value === null || observed.has(value) ? value : withoutResidue(value);
}

/** "70.75 to 79.25 EUR k": both ends as the card prints a value, the unit once. */
function spanValue(low: number | null, high: number | null, unit?: string, format?: string, locale?: string): InteractionValue {
  if (low === null || high === null) return numericValue(null);
  const bare = (raw: number) => displayedValueText(numericValue(raw, undefined, format), locale);
  return textValue(chartString({ locale: { language: locale } }, 'spanText', { v1: bare(low), v2: displayedValueText(numericValue(high, unit, format), locale) }));
}

/**
 * A box's card: the median, the quartiles, the whiskers and n, in
 * the chart's words. The observations stay members for data tables; the
 * fences, the state and the method are the method note's business.
 */
function boxRecords(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as BoxData;
  const marks = ctx.geometry.marks as unknown as BoxMarks;
  const derived = ctx.geometry.derived as unknown as BoxDerived;
  const { unit, format } = ctx.request.options;
  const locale = ctx.request.locale?.language;
  return derived.groups.map(group => {
    const mark = marks.rows.find(row => row.id === group.id);
    const input = data.groups.find(row => row.id === group.id);
    const members = observations(input?.observations ?? [], { categoryId: group.id });
    // Quartiles and the median can be an observation and then stay exact;
    // whiskers are observations.
    const observed = new Set(input?.observations ?? []);
    const stat = (key: 'median' | 'q1' | 'q3' | 'whiskerLow' | 'whiskerHigh') => computedValue(group[key], observed);
    return makeRecord(ctx, { categoryId: group.id }, numericValue(stat('median'), unit, format), {
      label: group.label, valueLabel: chartString(ctx.request.options, 'medianName'), ...(mark ? { anchor: mark.rect } : {}),
      fields: [field('quartiles', chartString(ctx.request.options, 'quartiles'), spanValue(stat('q1'), stat('q3'), unit, format, locale)),
        field('whiskers', chartString(ctx.request.options, 'whiskers'), spanValue(stat('whiskerLow'), stat('whiskerHigh'), unit, format, locale)),
        field('n', 'n', numericValue(group.n)),
        ...members.map(item => numberField(item.owner.pointId!, item.value, unit, format))],
      members: members.map(item => item.owner),
    });
  });
}

/**
 * A histogram bin's card: "7 to under 8 days", "29 orders", its
 * share of the sample. The edges print as the chart prints them; the last
 * bin says it includes its upper edge. The count takes the frequency axis's
 * noun, "observations" without one.
 */
function histogramRecords(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as HistogramData;
  const marks = ctx.geometry.marks as unknown as HistogramMarks;
  const derived = ctx.geometry.derived as unknown as HistogramDerived;
  const { unit, format } = ctx.request.options;
  const noun = (ctx.request.options as { axisTitles?: { y?: string } }).axisTitles?.y?.trim().toLowerCase() || chartString(ctx.request.options, 'observationsLower');
  const observationsByBin = new Map<number, ReturnType<typeof observations>>();
  for (const item of observations(data.observations)) {
    const firstHigher = derived.binning.edges.slice(1, -1).findIndex(edge => item.value < edge);
    const index = firstHigher < 0 ? derived.counts.length - 1 : firstHigher;
    const members = observationsByBin.get(index) ?? [];
    members.push(item);
    observationsByBin.set(index, members);
  }
  // The bin labels the chart prints, "1–2" or "−2 – 0": their two edge texts.
  const dash = derived.binLabels.some(label => label.includes(' – ')) ? ' – ' : '–';
  return marks.bins.map(bin => {
    const members = observationsByBin.get(bin.index) ?? [];
    const last = bin.index === derived.counts.length - 1;
    const [low, high] = derived.binLabels[bin.index]?.split(dash) ?? [];
    const edge = (text: string | undefined, raw: number, withUnit: boolean) => text
      ? (withUnit && /^[\d\s.,'\u2212+-]+$/.test(text) && unit ? joinUnit(text, unit, false, ctx.request.locale?.language) : text)
      : displayedValueText(numericValue(raw, withUnit ? unit : undefined, format), ctx.request.locale?.language);
    // "1 order", not "1 orders": an English plural noun drops its s for one.
    const counted = bin.count === 1 && noun.endsWith('s') ? noun.slice(0, -1) : noun;
    return makeRecord(ctx, { categoryId: JSON.stringify(['bin', bin.lo, bin.hi]) }, numericValue(bin.count, counted), {
      // One bin per whole value names that value, "3 days", not "2.5 to under 3.5".
      // The open last bin reads "1,600 or more", its upper edge is only the largest observation.
      label: last && derived.binning.openAbove !== undefined
        ? chartString(ctx.request.options, 'intervalAtLeast', { v1: edge(undefined, derived.binning.perValue ? Math.ceil(derived.binning.openAbove) : bin.lo, true) })
        : derived.binning.perValue ? edge(derived.binLabels[bin.index], (bin.lo + bin.hi) / 2, true)
        : intervalText(edge(low, bin.lo, false), edge(high, bin.hi, true), last, ctx.request.options), anchor: bin.rect,
      annotations: makeRecord(ctx, { categoryId: bin.id }, numericValue(bin.count)).annotations,
      nodeIds: bin.nodeId ? [bin.nodeId] : [], members: members.map(item => item.owner),
      fields: members.map(item => numberField(item.owner.pointId!, item.value, unit, format)),
      share: { numerator: numericValue(bin.count, noun), denominator: numericValue(derived.n, noun),
        percent: derivedPercent(derived.n > 0 ? bin.count / derived.n * 100 : null) },
    });
  });
}

function retentionValue(value: number | null, observed: boolean, options: RecordContext['request']['options']): InteractionValue {
  if (value !== null) return derivedPercent(value, 'fraction');
  return { kind: 'number', raw: null, unit: 'fraction', format: DERIVED_PERCENT_FORMAT, derived: 'percent', state: observed ? 'nm' : 'missing',
    reason: observed ? chartString(options, 'retentionNotMeaningful') : chartString(options, 'periodObservationMissing') };
}

// Same rule as missingCohortRate in charts/cohort/retention.ts, kept here so
// react/spec does not link the cohort engine before it draws.
function missingCohortRate(row: CohortRowDerived, period: number, basis: CohortDerived['basis']): boolean {
  return row.retention[period] === null
    && (basis !== 'previous' || !row.active.slice(0, period).includes(0))
    && (row.active[period] === null || (basis === 'previous' && period > 0 && row.active[period - 1] === null));
}

function denominator(row: CohortRowDerived, period: number, derived: CohortDerived): number | null | undefined {
  return derived.basis === 'cohort' || period === 0 ? row.base : row.active[period - 1];
}

function cohortCell(ctx: RecordContext, mark: CohortCellMark, derived: CohortDerived, displayed?: string): InteractionRecord {
  const row = derived.cohorts.find(item => item.id === mark.rowId);
  const period = mark.periodIndex;
  const aggregate = mark.kind !== 'cohort';
  const missing = aggregate ? derived.cohorts.some(item => missingCohortRate(item, period, derived.basis))
    : !!row && missingCohortRate(row, period, derived.basis);
  const contributors = aggregate ? derived.cohorts.filter(item => period < item.observedPeriods &&
    item.retention[period] != null && (denominator(item, period, derived) ?? 0) > 0) : [];
  const numerator = aggregate ? contributors.reduce((sum, item) => sum + item.active[period]!, 0) : row?.active[period];
  const den = aggregate ? contributors.reduce((sum, item) => sum + denominator(item, period, derived)!, 0) :
    row && period < row.observedPeriods ? denominator(row, period, derived) : undefined;
  const observed = aggregate ? contributors.length > 0 : !!row && period < row.observedPeriods;
  const value = retentionValue(mark.retention, observed && !missing, ctx.request.options);
  // Retention is stored as a fraction. Read its displayed percentage from
  // the cell, rather than formatting the fraction through a second raster.
  if (displayed?.includes('%')) value.displayed = displayed;
  const owner = { seriesId: mark.rowId, categoryId: mark.periodId };
  return makeRecord(ctx, owner, value, {
    label: `${mark.rowLabel} / ${mark.periodLabel}`,
    anchor: mark.rect,
    fields: [numberField('period', period), numberField('active', observed && !(aggregate && missing) ? numerator : null, 'count'),
      numberField('denominator', observed && !(aggregate && missing) ? den : null, 'count'), numberField('base', row?.base ?? (aggregate && !missing ?
        contributors.reduce((sum, item) => sum + item.base, 0) : undefined), 'count'),
      field('basis', chartString(ctx.request.options, 'basis'), textValue(derived.basis)), ...(aggregate ? [numberField('support', contributors.length)] : [])],
    ...(aggregate ? { members: contributors.map(item => ({ seriesId: item.id, categoryId: mark.periodId })) } : {}),
  });
}

function cohortRecords(ctx: RecordContext): InteractionRecord[] {
  const marks = ctx.geometry.marks as unknown as CohortMarks;
  const derived = ctx.geometry.derived as unknown as CohortDerived;
  const displayed = new Map(ctx.geometry.scene.map(node => [node.id, node.display?.value]));
  const cells = marks.cells.map(mark => cohortCell(ctx, mark, derived, displayed.get(mark.nodeId)));
  const sizes = (marks.sizeCells ?? []).map(mark => makeRecord(ctx,
    { seriesId: mark.rowId, categoryId: 'cohort-size' }, numericValue(mark.value, 'count'), {
      label: chartString(ctx.request.options, 'cohortSizeLabel', { v1: mark.rowLabel }), anchor: mark.rect,
      ...(mark.kind === 'total' ? { members: derived.cohorts.map(row => ({ seriesId: row.id, categoryId: 'cohort-size' })) } : {}),
    }));
  return [...cells, ...sizes];
}

function overlayRecord(ctx: RecordContext, input: GeoOverlay, mark: GeoOverlayMark): InteractionRecord {
  const fields: InteractionRecord['fields'] = [];
  if ('lon' in input.at) fields.push(numberField('longitude', input.at.lon, 'degrees'), numberField('latitude', input.at.lat, 'degrees'));
  else fields.push(field('region', chartString(ctx.request.options, 'region'), textValue(input.at.region)));
  const glyph = input.glyph;
  let value = textValue(input.label);
  if (glyph.kind === 'harvey') value = numericValue(glyph.value, 'fraction');
  if (glyph.kind === 'status') value = textValue(glyph.status);
  if (glyph.kind === 'pie') pushAll(fields, glyph.shares.map(share => numberField(`share:${share.label}`, share.value)));
  return makeRecord(ctx, { categoryId: `overlay:${input.id}` }, value, {
    label: input.label, anchor: mark.anchor, fields,
  });
}

function mapRecords(ctx: RecordContext): InteractionRecord[] {
  const data = ctx.request.data as ChoroplethData;
  const marks = ctx.geometry.marks as unknown as ChoroplethMarks | TilemapMarks;
  const { unit, format } = ctx.request.options;
  const records = marks.regions.map(mark => {
    const plain = numericValue(mark.value, unit, format);
    const value = mark.state === 'suppressed' || mark.state === 'nm' || mark.state === 'na' ? statedValue(plain, mark.state, ctx.request.options) : plain;
    return makeRecord(ctx, { categoryId: mark.id }, value, {
      // The region's name, never its code.
      label: mark.name, ...('rect' in mark ? { anchor: mark.rect } : {}),
    });
  });
  for (const mark of marks.overlays ?? []) {
    const input = data.overlays?.find(item => item.id === mark.id);
    if (input) records.push(overlayRecord(ctx, input, mark));
  }
  return records;
}
