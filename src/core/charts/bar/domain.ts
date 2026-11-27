import { applyAxisBounds } from '../../scale';
import { shownSeries } from '../../hiddenSeries';
import { cleanSum } from '../../geometry';
import { percentCellsOnly, percentLevels } from '../../annotatePass';
/**
 * Standard bar phase 1, domain: the options resolved once, the series
 * normalised, sorted and cut to topN, the plotted values, stacks and shares,
 * the averages and the net line, the annotation split, and the value extent.
 */

import { restDetailsWarning } from '../topN';
import type { applyBarTopN } from './rowOptions';
import { normalizeCategorySeries } from '../categorySeries';
import { chartPalette } from '../chartEnv';
import { valueLineNeedsSharedPass } from '../../annotateFields';
import { valueLineExtent } from '../../valueLineDomain';
import { formatAutomaticPercent, formatShare, shareText } from '../../format';
import { currentSmallValues, formatScopeKey, shareSetDecimals } from '../../formatPrecision';
import { formatStatWithSpec, formatterFromExample, parseFormatExample, seriesRasterFormatter, shareFormatExample, withChartMarks } from '../../formatSpec';
import { PRIORITY } from '../../label/solver';
import {
  NormalizeError,
  normalizeCategory,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
  ranksCategories,
} from '../../normalize/shared';
import { resolveCellRange, type DataRange } from '../../rangeRules';
import { defaultMeasurer, isCachedTextMeasurer } from '../../text';
import { requestMemo } from '../../layoutPlan';
import { barPaints, barSeriesScenario } from './paints';
import { colorRolePaints, strokeToken, panelTypeClass, rampSlots, resolveTheme, themeForWidth, typeWidthClass } from '../../theme';
import type { Annotation } from '../../types/annotations';
import { cellMeta, cellValue, isPctCell, type CellMeta, type Id, type Scenario } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { BarOptions } from '../../types/options';
import { labelOn } from '../labelOn';
import { chosenValueIndices } from '../band/valueSelection';
import { partialKeyForced, runningPeriodIds, saysToDate } from '../../partialPeriod';
import { chartString } from '../../strings';
import type { LintWarning, ShownTexts } from '../../types/scene';
import { accumulateStack, averageMarkerId, averageMarkerLine, averageMarkerMean, averageMarkerScope as averageMarkerScopeOf, averageOfUnaddedSums, averageOfWholeShares, grandTotalRequested, compositionBasis, mixedSignsWarning, overfullShareSum, overfullWarning, plottedMean, printsValue, sortSegments, stackTotalFormatter, warnIncompleteStacks, warnShareFormatIgnored, withoutShareMean } from '../band/stacks';
import { isIncomplete, warnShareRoundingDrift } from '../../dataGaps';
import { roundingUnavailable, shareRoundingNotes, sumConsistentShares, type RoundingAdjustment } from '../../shareRounding';
import { NO_STACK_MEAN, stackAdds } from '../../stackAdds';
import { scenarioFillPattern, scenarioPartners } from '../../scenarioPairs';
import { OTHERS_ID, SHOWN_SLOT, type BarDomain, type NormCat, type NormSeries } from './model';
import { disclosuresShown } from '../../notes';
import { isRecord } from '../../lint/shared';
import { cappedItems } from '../../frame';
import { dataSeriesUnitRefusal } from '../../schema/units';

// The data, paint and format decisions read these options. Legend placement, notes added
// by a fitting pass and canvas height belong to the frame of the current trial.
type BarInput = BarOptions & { rasterFromValues?: boolean; shareLabels?: { format?: string } };
const domainFields = [
  'variant', 'sort', 'topN', 'unit', 'format', 'rasterFromValues', 'locale', 'strings',
  'theme', 'palette', 'highlight', 'signColor', 'colorblindSafe', 'connectors', 'referenceStyle',
  'referenceTick', 'annotations', 'averageMarker', 'netLine', 'grandTotalLabels', 'labels',
  'notes', 'shareLabels', 'sharesOfOneWhole', 'rounding', 'valueAxis', 'measure',
] as const satisfies readonly (keyof BarInput)[];
type DomainOptions = Pick<BarInput, typeof domainFields[number]>;

/** The label text of a bar or segment: the display value with the cell's `${value}` override; null when the cell hides it. */
/**
 * The running categories whose bar value prints the to-date words under it
 * ("31.2" over "to date"), as on combo and column: a single grouped series'
 * value or a stack's total. A stack with segment values, a 100% stack, a
 * negative value and a name that says "to date" keep the hatch key (or,
 * with no key, the words on the name).
 */
export function toDateOnValues(domain: BarDomain): Set<Id> {
  const ids = new Set<Id>();
  const { options, cats, dataSeries, variant, running } = domain;
  if (partialKeyForced(options) || running.size === 0) return ids;
  const words = options.strings?.toDate ?? chartString(options, 'toDate');
  const grouped = variant === 'grouped';
  const segments = dataSeries.length > 1 && labelOn(options, 'segment');
  if (dataSeries.length === 0 || variant === 'stacked100' || (grouped ? dataSeries.length > 1 || !labelOn(options, 'point') : segments || !domain.grandTotalsOn)) return ids;
  const only = dataSeries[0]!;
  const picked = grouped && options.valueLabels !== undefined ? chosenValueIndices(options.valueLabels, cats.map((_, ci) => only.cells[ci]?.v ?? null)) : undefined;
  cats.forEach((c, ci) => {
    if (!running.has(c.id) || saysToDate(c.label ?? c.id, words) || domain.nmRows[ci] || domain.naRows[ci] || domain.incompleteRows.has(c.id)) return;
    const values = dataSeries.map((s) => s.cells[ci]?.v ?? null).filter((v): v is number => v !== null);
    if (values.length === 0 || values.some((v) => v < 0)) return;
    const meta = values.length === 1 ? dataSeries.find((s) => (s.cells[ci]?.v ?? null) !== null)!.cells[ci]!.meta : null;
    if (grouped && picked && !picked.has(ci) && typeof meta?.label !== 'string') return;
    if (meta?.label === false || (typeof meta?.label === 'string' && meta.label.trim() === '')) return;
    ids.add(c.id);
  });
  return ids;
}

/** Every drawn running category carries the to-date words on its value: no hatch key, note or name words. */
export function partialNamedOnValues(domain: BarDomain): boolean {
  const named = toDateOnValues(domain);
  return named.size > 0 && domain.cats.every((c, ci) => !domain.running.has(c.id) || named.has(c.id)
    || domain.dataSeries.every((s) => (s.cells[ci]?.v ?? null) === null));
}

/** A cell as the label texts read it: its metadata and the normalised percent flag. */
export type BarTextCell = { meta: CellMeta | null; isPct?: boolean };

export function textFor(domain: BarDomain, v: number, cell: BarTextCell, pctVal?: number, s?: NormSeries, categoryId?: string): string | null {
  const { meta } = cell;
  if (meta?.label === false) return null;
  const base = displayFor(domain, v, cell, pctVal, s, categoryId);
  return typeof meta?.label === 'string' ? meta.label.replace(/\$\{value\}/g, base) : base;
}

/** A share prints its sum-consistent text where rounding set one (`categoryId` and `s` name it). */
export function displayFor(domain: BarDomain, v: number, cell: BarTextCell, pctVal?: number, s?: NormSeries, categoryId?: string): string {
  const { meta } = cell;
  return pctVal !== undefined
    ? (s && categoryId !== undefined ? domain.shareTexts.get(`${categoryId}\0${s.id}`) : undefined) ?? domain.pctFmt(pctVal)
    : meta?.format
      ? formatterFromExample(meta.format, domain.options.locale?.language)(v)
      // A percent cell, and a Rest built from percent cells, keep their '%', as on column.
      : (cell.isPct && !s?.format ? domain.valueSpec.fmtPercent : s ? domain.valueSpec.forSeries(s) : domain.fmt)(v);
}

/** The record slot a bar's value fills: 'value', or the slot a host names (SHOWN_SLOT). */
export function valueSlot(domain: Pick<BarDomain, 'options'>): string {
  return (domain.options as { [SHOWN_SLOT]?: string })[SHOWN_SLOT] ?? 'value';
}

/**
 * A label's text and the record value it prints, from one displayFor call:
 * `text` as textFor makes it, `base` the value text itself, and `shows` its
 * ShownTexts (the value, or on a 100 % bar (`pctVal`) its share). No `shows`
 * where the label prints no value: `label: false` (`text` null), or an
 * authored text without `${value}`.
 */
export function labelTextsFor(domain: BarDomain, v: number, cell: BarTextCell, pctVal?: number, s?: NormSeries, categoryId?: string): { text: string | null; base?: string; shows?: ShownTexts } {
  const label = cell.meta?.label;
  if (label === false) return { text: null };
  const base = displayFor(domain, v, cell, pctVal, s, categoryId);
  return {
    text: typeof label === 'string' ? label.replace(/\$\{value\}/g, base) : base,
    base,
    ...(typeof label === 'string' && !printsValue(label) ? {} : { shows: { [pctVal === undefined ? valueSlot(domain) : 'share.percent']: base } }),
  };
}

export function valueLineValue(a: Annotation & { kind: 'valueLine' }, meanValue: number | undefined): number | undefined {
  return a.value === undefined || a.value === 'mean' ? meanValue : a.value;
}

function normalizeBarSeries(data: ChartData, warnings: LintWarning[]): { rawCats: ReturnType<typeof normalizeCategory>[]; normSeries: NormSeries[] } {
  const { cats, series } = normalizeCategorySeries('bar', data, (s, authored, rawCats): NormSeries => ({
    id: s.id,
    label: s.label ?? s.id,
    scenario: normalizeScenario(s.scenario, `series[${s.id}].scenario`),
    direction: s.direction,
    role: s.role ?? 'data',
    colorRole: s.colorRole,
    fill: s.fill, format: s.format, unit: s.unit,
    slot: 0,
    cells: authored.map((c, ci) => ({
      v: cellValue(c),
      ...(isPctCell(c) ? { isPct: true } : {}),
      meta: cellMeta(c),
      range: resolveCellRange(c, `series[${s.id}].values[${ci}]`, warnings, { seriesId: s.id, categoryId: rawCats[ci]?.id }),
    })),
    ...(authored.some(isPctCell) ? { pctCells: true } : {}),
  }));
  return { rawCats: cats, normSeries: series };
}

/**
 * Sort (live property, deterministic tie-break by sheet index), then topN
 * with an 'Others' row. Reorders the series cells in place.
 */
function orderBarCategories(
  options: DomainOptions,
  rawCats: ReturnType<typeof normalizeCategory>[],
  normSeries: NormSeries[],
  dataSeries: NormSeries[],
  warnings: LintWarning[],
  topN?: typeof applyBarTopN,
): NormCat[] {
  let cats: NormCat[] = rawCats.map((c) => ({
    id: c.id,
    label: c.label ?? c.id,
    date: c.date,
    total100: c.total100,
    gapAfter: c.gapAfter,
    breakAfter: c.breakAfter,
    ...(c.partial === true ? { partial: true } : {}),
    ...(c.footnote !== undefined ? { footnote: c.footnote } : {}),
    ...((c as { calendar?: NormCat['calendar'] }).calendar ? { calendar: (c as { calendar?: NormCat['calendar'] }).calendar } : {}),
  }));
  const totalOf = (ci: number) => dataSeries.reduce((a, s) => a + (s.cells[ci]!.v ?? 0), 0);
  const catSort = options.sort?.categories ?? 'sheet';
  if (catSort !== 'sheet') {
    const idx = cats.map((_, i) => i);
    const tot = cats.map((_, i) => totalOf(i));
    if (catSort === 'asc') idx.sort((a, b) => tot[a]! - tot[b]! || a - b);
    else if (catSort === 'desc') idx.sort((a, b) => tot[b]! - tot[a]! || a - b);
    else idx.reverse();
    cats = idx.map((i) => cats[i]!);
    for (const s of normSeries) s.cells = idx.map((i) => s.cells[i]!);
  }
  return options.topN && topN ? topN(options.topN, options.strings, cats, normSeries, totalOf, warnings) : cats;
}

type BarBasis = Pick<BarDomain, 'totals' | 'nmRows' | 'naRows' | 'incompleteRows' | 'shares' | 'plotVal' | 'plotRange' | 'stacks' | 'rowEnds'>;

/**
 * Totals, stacked100 shares and row extents.
 *
 * stacked100 fail-closed rule (notation rule: a composition share requires
 * nonnegative components): ANY negative component invalidates the row →
 * 'n.m.'; an all-zero basis has nothing to compose → 'n/a'. Suppressed
 * rows lose segments, share labels, and the total.
 */
function barBasis(variant: BarDomain['variant'], cats: NormCat[], dataSeries: NormSeries[], warnings: LintWarning[]): BarBasis {
  const totals = cats.map((_, ci) => cleanSum(dataSeries.map((s) => s.cells[ci]!.v ?? 0)));
  const nmRows: boolean[] = cats.map(() => false);
  const naRows: boolean[] = cats.map(() => false);
  const overfull: { id: Id; sum: number }[] = [];
  const basisByCat: number[] = [];
  const shares: number[][] = cats.map((cat, ci) => {
    if (variant !== 'stacked100') return [];
    const cells = dataSeries.map((s) => s.cells[ci]!);
    const { basis, nm, na } = compositionBasis(cells, cat.total100);
    basisByCat[ci] = basis;
    if (nm) {
      nmRows[ci] = true;
    } else if (na) {
      warnings.push({
        code: 'total100-nonpositive',
        severity: 'warn',
        message: `category '${cat.id}': non-positive 100% basis — nothing to compose, row marked n/a`,
        owner: { categoryId: cat.id },
      });
      naRows[ci] = true;
    } else {
      const sum = overfullShareSum(cells, basis);
      // A percent cell states its own share, even when the row has no absolute basis.
      if (sum === undefined) return cells.map((cell) =>
        cell.isPct ? cell.v ?? 0 : basis > 0 ? ((cell.v ?? 0) / basis) * 100 : 0);
      overfull.push({ id: cat.id, sum });
    }
    return cells.map(() => 0);
  });
  if (variant === 'stacked100' && nmRows.some(Boolean)) {
    warnings.push(mixedSignsWarning(cats.filter((_, ci) => nmRows[ci]).map((c) => c.id), cats.length));
  }
  // A row past 100% is no composition either: it draws as n.m., as a signed row does.
  for (const row of overfull) nmRows[cats.findIndex((c) => c.id === row.id)] = true;
  if (overfull.length > 0) warnings.push(overfullWarning(overfull, nmRows.every((nm, ci) => nm || naRows[ci]), "give every part as a share of the same whole, or use variant 'grouped' for shares that overlap, such as answers to a multi-select question"));
  const plotVal = (ci: number, si: number): number | null => {
    const v = dataSeries[si]!.cells[ci]!.v;
    if (v === null) return null;
    return variant === 'stacked100' ? shares[ci]![si]! : v;
  };
  const stacks = cats.map((_, ci) =>
    accumulateStack(dataSeries.map((_, si) => plotVal(ci, si))),
  );
  const plotRange = (ci: number, si: number): DataRange | undefined => {
    const range = dataSeries[si]!.cells[ci]!.range;
    if (!range) return undefined;
    if (variant !== 'stacked100' || dataSeries[si]!.cells[ci]!.isPct) return range;
    const basis = basisByCat[ci]!;
    if (basis <= 0) return undefined;
    const scale = (value: number) => (value / basis) * 100;
    return {
      low: scale(range.low),
      high: scale(range.high),
      ...(range.mid === undefined ? {} : { mid: scale(range.mid) }),
    };
  };
  const rowEnds = cats.map((_, ci) => {
    if (variant !== 'grouped') {
      const stack = stacks[ci]!;
      return { pos: stack.positive, neg: stack.negative };
    }
    let pos = 0;
    let neg = 0;
    dataSeries.forEach((_, si) => {
      const v = plotVal(ci, si);
      if (v === null) return;
      pos = Math.max(pos, v);
      neg = Math.min(neg, v);
    });
    return { pos, neg };
  });
  // A stack with a missing part has no known whole, as on column. A row
  // with no part at all is empty, not partial: it reads n/a on the baseline.
  const empty = (ci: number) => dataSeries.every((s) => s.cells[ci]!.v === null);
  if (variant !== 'grouped') cats.forEach((_, ci) => { if (empty(ci)) naRows[ci] = true; });
  const incompleteRows = new Set(variant === 'grouped' ? [] : cats
    .filter((_, ci) => !empty(ci) && isIncomplete(dataSeries.map((s) => s.cells[ci]!.v)))
    .map((c) => c.id));
  return { totals, nmRows, naRows, incompleteRows, shares, plotVal, plotRange, stacks, rowEnds };
}

/**
 * The net line, with the warnings for the cases it cannot draw. The warnings and the paints read the boundary
 * the author named among every series. A reader who hides series sees the line at the last visible series up to it.
 */
function barNetLine(
  options: DomainOptions,
  variant: BarDomain['variant'],
  dataSeries: NormSeries[],
  shown: NormSeries[],
  warnings: LintWarning[],
): Pick<BarDomain, 'netLineOn' | 'netLineSeries' | 'netKeyIndex'> {
  const netLineRequested = options.netLine !== undefined && options.netLine !== false;
  const netLineSeriesId =
    typeof options.netLine === 'object' ? options.netLine.seriesId : undefined;
  const netAt = netLineSeriesId ? dataSeries.findIndex((series) => series.id === netLineSeriesId) : -1;
  const netLineSeries = dataSeries[netAt];
  let netLineOn = netLineRequested && variant !== 'grouped';
  if (netLineRequested && variant === 'grouped') {
    warnings.push({
      code: 'net-line-ignored',
      severity: 'warn',
      message: 'netLine applies only to stacked and stacked100 bar charts; ignored for grouped',
      field: ['options', 'netLine'],
      fix: [{ op: 'remove', path: '/options/netLine' }],
    });
  }
  if (netLineOn && netLineSeriesId && !netLineSeries) {
    netLineOn = false;
    warnings.push({
      code: 'net-line-series-missing',
      severity: 'warn',
      message: `netLine seriesId '${netLineSeriesId}' is not a plotted data series; net line omitted`,
      owner: { seriesId: netLineSeriesId },
    });
  }
  if (netLineOn) {
    const values = dataSeries.flatMap((series) =>
      series.cells.flatMap((cell) => (cell.v === null ? [] : [cell.v])),
    );
    const hasPositive = values.some((value) => value > 0);
    const hasNegative = values.some((value) => value < 0);
    const outermost = netLineSeries
      ? dataSeries.at(-1)?.id === netLineSeries.id
      : hasPositive && !hasNegative;
    if (hasPositive !== hasNegative && outermost) {
      warnings.push({
        code: 'netline-redundant',
        severity: 'warn',
        message: 'netLine traces the visible outer edge of a single-signed stack and adds no information',
        ...(netLineSeries ? { owner: { seriesId: netLineSeries.id } } : {}),
        suggest: 'Pick an inner boundary series with netLine.seriesId, or drop netLine.',
      });
    }
  }
  const drawn = netLineSeries && shown[netLineSeries.lastVisibleIndex ?? netAt];
  return { netLineOn: netLineOn && (!netLineSeries || !!drawn), netLineSeries: drawn, netKeyIndex: netLineOn ? netAt : -1 };
}

/**
 * The annotations, split: vertical valueLines and indicator100 are drawn by
 * bar itself (the shared pass draws them horizontally for columns); the rest
 * go to the shared annotation pass. The average marker joins as a valueLine,
 * and stacked100 gets its indicator100 by default.
 */
function barAnnotations(
  options: DomainOptions,
  variant: BarDomain['variant'],
  averageMarkerValue: number | undefined,
  statFmt: (v: number) => string,
  averageSpan: string | undefined,
): Pick<BarDomain, 'localAnns' | 'passAnns' | 'averageMarkerId'> {
  const annotationInput: Annotation[] = [...(options.annotations ?? [])];
  if (averageMarkerValue !== undefined) annotationInput.push(averageMarkerLine(annotationInput, averageMarkerValue, statFmt, averageSpan, options.strings?.average));
  const annotationsAll: Annotation[] = annotationInput.map((a, n) => ({ ...a, id: a.id ?? `${a.kind}-${n + 1}` }));
  const localAnns = annotationsAll.filter((a) => a.kind === 'indicator100' || (a.kind === 'valueLine' && !valueLineNeedsSharedPass(a)));
  const passAnns = annotationsAll.filter((a) => !localAnns.includes(a));
  // Endpoint-band priority: engine furniture informs (never warns) when
  // squeezed out, and yields to authored labels — see line's auto-add.
  if (variant === 'stacked100' && labelOn(options, 'percentIndicator') && !localAnns.some((a) => a.kind === 'indicator100')) {
    localAnns.push({ kind: 'indicator100', id: 'indicator100-auto', priority: PRIORITY.endpoint });
  }
  return { localAnns, passAnns, ...(averageMarkerValue === undefined ? {} : { averageMarkerId: averageMarkerId(options.annotations ?? []) }) };
}

/**
 * The value-space extent, and every value the exhibit renders in draw order
 * (the axis-break check needs both). stacked100: refs have no honest position
 * on a composition axis, so they neither stretch the domain nor render
 * (mirrors column; warned once).
 */
function barValueExtent(
  domain: Pick<BarDomain, 'options' | 'variant' | 'refSeries' | 'localAnns' | 'passAnns' | 'meanValue'>,
  basis: BarBasis,
  warnings: LintWarning[],
): Pick<BarDomain, 'lo' | 'hi' | 'rendered'> {
  const { options, variant, refSeries, meanValue } = domain;
  const rendered: number[] = [];
  let lo = 0;
  let hi = 0;
  basis.stacks.forEach((stack, ci) => {
    const end = basis.rowEnds[ci]!;
    lo = Math.min(lo, end.neg);
    hi = Math.max(hi, end.pos);
    stack.segments.forEach((segment, si) => {
      if (!segment) return;
      const start = variant === 'grouped' ? 0 : segment.start;
      const range = basis.plotRange(ci, si);
      rendered.push(variant === 'grouped' ? segment.value : segment.end);
      if (range) {
        lo = Math.min(lo, start + range.low, start + range.high);
        hi = Math.max(hi, start + range.low, start + range.high);
        rendered.push(start + range.low, start + range.high);
        if (range.mid !== undefined) rendered.push(start + range.mid);
      }
    });
  });
  if (variant !== 'stacked100') {
    for (const rs of refSeries) {
      for (const c of rs.cells) {
        if (c.v === null) continue;
        rendered.push(c.v);
        lo = Math.min(lo, c.v);
        hi = Math.max(hi, c.v);
      }
    }
  } else if (refSeries.some((rs) => rs.cells.some((c) => c.v !== null))) {
    warnings.push({
      code: 'reference-unsupported-stacked100',
      severity: 'warn',
      message:
        'reference series omitted: a 100% axis shows composition, not level — show plan/PY targets on the absolute companion chart',
    });
  }
  for (const a of domain.localAnns) {
    if (a.kind === 'valueLine') {
      const v = valueLineValue(a, meanValue);
      if (v === undefined) continue;
      rendered.push(v);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    } else {
      rendered.push(100);
      hi = Math.max(hi, 100);
    }
  }
  // An axis break checks every authored target value, also of a line the shared pass then omits, as column does.
  for (const a of domain.passAnns) if (a.kind === 'valueLine' && typeof a.value === 'number' && Number.isFinite(a.value)) rendered.push(a.value);
  // A line the shared pass draws widens the axis as on column (valueLineDomain.ts).
  const passLines = valueLineExtent(domain.passAnns);
  if (passLines) {
    lo = Math.min(lo, passLines.lo);
    hi = Math.max(hi, passLines.hi);
  }
  [lo, hi] = applyAxisBounds([lo, hi], [lo, hi], options.valueAxis, warnings);
  return { lo, hi, rendered };
}

type PreparedBar = { domain: BarDomain; paints: ReturnType<typeof barPaints> };

export function prepareBar(data: ChartData, options: BarInput, warnings: LintWarning[], reuseData: boolean, topN?: typeof applyBarTopN): PreparedBar {
  const size = resolveSize(options.size);
  const widthClass = panelTypeClass(options) ?? typeWidthClass(size.width);
  const build = (out: LintWarning[]) => {
    const domain = resolveBarDomain(data, options, size, widthClass, out, topN);
    return { domain, paints: barPaints(domain, out) };
  };
  if (!reuseData || options.variant !== 'stacked' || !isCachedTextMeasurer(options.measure ?? defaultMeasurer)) return build(warnings);

  // Each sizing trial gets its current size and options. The immutable stacks, extents,
  // formatters and paints can serve other trials with the same inputs in this request.
  const key = JSON.stringify(['stacked-bar-data', widthClass, currentSmallValues(), formatScopeKey(options)]);
  type Entry = { options: DomainOptions; prepared: PreparedBar; warnings: LintWarning[] };
  const entries = requestMemo(data, key, (): Entry[] => []);
  const match = entries.find(entry => domainFields.every(field => entry.options[field] === options[field]));
  if (match) {
    for (const warning of match.warnings) warnings.push(warning);
    return { domain: { ...match.prepared.domain, options, size }, paints: match.prepared.paints };
  }
  const before = warnings.length;
  const prepared = build(warnings);
  entries.push({ options, prepared, warnings: warnings.slice(before) });
  return prepared;
}

function resolveBarDomain(data: ChartData, options: DomainOptions, size: BarDomain['size'],
  widthClass: ReturnType<typeof typeWidthClass>, warnings: LintWarning[], topN?: typeof applyBarTopN): BarDomain {
  const theme = themeForWidth(resolveTheme(options.theme), widthClass);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const variant = (options.variant ?? 'grouped') as BarDomain['variant'];
  const connectorsOn = options.connectors !== undefined && options.connectors !== false;
  if (connectorsOn && variant === 'grouped') {
    warnings.push({
      code: 'connectors-ignored',
      severity: 'warn',
      message: 'connectors apply only to stacked and stacked100 bar charts; ignored for grouped',
    });
  }
  // A stack prints each part inside its segment and the total past its end: outside value labels have no part to move.
  if (theme.marks?.barLabels === 'outside' && (variant === 'stacked' || variant === 'stacked100')) {
    const overrides = isRecord(options.theme) && isRecord(options.theme.overrides) ? options.theme.overrides : undefined;
    const authored = isRecord(overrides?.marks) && overrides.marks.barLabels === 'outside';
    warnings.push({
      code: 'option-ignored', severity: authored ? 'warn' : 'info',
      field: authored ? ['options', 'theme', 'overrides', 'marks', 'barLabels'] : ['options', 'theme'],
      message: `marks.barLabels 'outside' has no effect on bar variant '${variant}' and is ignored. A stack prints each part inside its segment; only grouped bars move their values past the bar end.`,
      suggest: authored ? "Remove marks.barLabels, or use variant 'grouped' for values past the bar ends." : "Use variant 'grouped' for values past the bar ends.",
      ...(authored ? { fix: [{ op: 'remove' as const, path: '/options/theme/overrides/marks/barLabels' }] } : {}),
    });
  }
  const connectorScope =
    typeof options.connectors === 'object' ? (options.connectors.scope ?? 'all') : 'all';
  const { rawCats, normSeries } = normalizeBarSeries(data, warnings);
  // The colours, the legend and the formats read every plotted series. The bars, the totals and the category order read
  // the series a reader has not hidden (hiddenSeries.ts).
  const authored = normSeries.filter(ranksCategories);
  const keySeries = sortSegments(authored, options.sort?.segments, (s) => s.cells.reduce((sum, cell) => sum + (cell.v ?? 0), 0));
  const dataSeries = shownSeries(options, keySeries, true);
  const refSeries = normSeries.filter((s) => s.role === 'reference');
  if (keySeries.length === 0) {
    throw new NormalizeError('no-data-series', 'series', 'bar requires at least one data-role series', undefined, undefined, ['data', 'series']);
  }
  if (variant === 'grouped' || variant === 'stacked') {
    const refusal = dataSeriesUnitRefusal(normSeries, options.unit);
    if (refusal) warnings.push(refusal);
  }
  // Exhibit-wide format raster: bar is column's twin and formats through
  // the identical rule: style from the example, one precision from the
  // plotted values, range bounds included.
  //
  // `rasterFromValues: false` is a HOST-ONLY escape hatch (not in the public
  // schema): a host that hands bar ENGINE-DERIVED floats (likert's diverging
  // shares) declares its display precision through the format example
  // instead — the values carry float noise, not authored precision, and the
  // raster must not lift a whole-point net badge to "+75.06".
  const hostDeclaresPrecision =
    options.rasterFromValues === false;
  const valueSpec = seriesRasterFormatter(options.format, hostDeclaresPrecision
      ? []
      : normSeries.flatMap((s) =>
          s.cells.flatMap((cell) => [cell.v, cell.range?.low, cell.range?.high, cell.range?.mid]),
        ), options.locale?.language, options.unit);
  // Derived statistics (the Ø average marker/line) keep their own precision
  // inside the exhibit's style — an integer-rastered bar still prints its
  // mean as "Ø 14.9", never "Ø 15" (see formatStatWithSpec; column twin).
  // Under the default rule a percent mean is a statistic of the percent set.
  const statSpec = !options.format && (variant === 'stacked100' || options.unit === '%' || percentLevels(keySeries.map(series => ({ vals: series.cells }))))
    ? { ...valueSpec.percentSpec, suffix: '%' } : valueSpec.spec;
  const statFmt = (v: number) => formatStatWithSpec(v, statSpec);
  if (variant === 'stacked100' && keySeries.length === 1) {
    warnings.push({
      code: 'stacked100-single-series',
      severity: 'warn',
      message:
        "a 100% composition of a single series is always 100% — use variant:'stacked' or 'grouped' to show the level",
    });
  }
  const running = runningPeriodIds(rawCats, ci => keySeries.some(s => {
    const cell = s.cells[ci]!;
    return cell.v !== null && scenarioFillPattern(normalizeScenario(cell.meta?.scenario, `series[${s.id}].values[${ci}].scenario`) ?? s.scenario) === undefined;
  }));
  const cats = orderBarCategories(options, rawCats, normSeries, dataSeries, warnings, topN);
  const lostDetails = cats.some((c) => c.id === OTHERS_ID) ? restDetailsWarning(data, new Set(cats.map((c) => c.id))) : undefined;
  if (lostDetails) warnings.push(lostDetails);
  const uniformScenario = new Map<Id, Scenario>();
  if (variant !== 'grouped' && keySeries.length > 1) {
    cats.forEach((cat, ci) => {
      const scenarios = keySeries
        .filter((s) => s.cells[ci]!.v !== null)
        .map((s) => s.cells[ci]!.meta?.scenario ?? s.scenario);
      const scenario = scenarios[0];
      if (scenario !== undefined && scenarios.every((candidate) => candidate === scenario)) {
        uniformScenario.set(cat.id, scenario);
      }
    });
  }
  const highlights = new Set(resolveHighlight(options.highlight));
  // A series with its own paint keeps it; the ramp series skip a step that
  // paints the same colour, so no two series of one chart look alike.
  const roles = colorRolePaints(keySeries);
  for (const s of keySeries) {
    if (s.fill) s.ownPaint = { css: s.fill };
    else if (s.colorRole) s.ownPaint = roles.get(s.id);
    else if (highlights.has(s.id)) s.ownPaint = { token: 'focus' };
  }
  // A scenario series takes the colour of its actual (scenarioPairs). A series whose cells all
  // carry one scenario counts as that scenario. Grouped bars pair in authored order, so sorting the
  // segments never re-pairs a plan. A stack keeps its stack colours: only a plan pairs.
  const stacked = variant !== 'grouped';
  const scenarioPartner = scenarioPartners(stacked ? keySeries : authored, stacked ? (s) => s.scenario : barSeriesScenario, (s) => !!s.ownPaint, stacked);
  // A paired scenario series of grouped bars takes no ramp step of its own. One with its own
  // paint keeps it, so it stays in the deal and the plain series step past its colour.
  const dealt = stacked ? keySeries : keySeries.filter((s) => s.ownPaint || !scenarioPartner.has(s.id));
  const slots = rampSlots(theme, dealt.map((s) => s.ownPaint), paletteRamp ? options.palette : undefined, { labels: dealt.map((s) => s.label), warnings });
  dealt.forEach((s, i) => (s.slot = slots[i]!));
  const basis = barBasis(variant, cats, dataSeries, warnings);
  // While a reader hides a series, the shares keep the precision of every series, and an authored bound (a scale group's too) its range.
  const full = keySeries === dataSeries ? basis : barBasis(variant, cats, keySeries, []);
  // TWIN of column's `meanValue`. NOT coalesced to 0: with no plotted value
  // there is no mean, and a valueLine drawn at 0 would state a number the
  // data does not support (the shared annotate pass fails this closed with
  // 'no-mean'; bar's local valueLine mirrors it).
  // a stack of percents of different wholes has no total to print,
  // anchor on or average.
  const addsOver = (series: NormSeries[]) => (variant !== 'stacked' && variant !== 'stacked100') || stackAdds(series, options.unit, options.sharesOfOneWhole);
  const partsAdd = addsOver(dataSeries);
  const meanValue = partsAdd ? plottedMean('all', variant !== 'grouped', cats.length, dataSeries, (_, si, ci) => basis.plotVal(ci, si)) : undefined;
  if (variant === 'stacked100') options = withoutShareMean(options, meanValue, warnings);
  const averageMarkerScope = averageMarkerScopeOf(options.averageMarker) ?? 'all';
  const averageMarkerRequested = options.averageMarker !== undefined && options.averageMarker !== false &&
    !averageOfWholeShares(variant, averageMarkerScope, warnings) &&
    !averageOfUnaddedSums(addsOver(averageMarkerScope === 'all' ? dataSeries : dataSeries.filter((s) => averageMarkerScope.includes(s.id))), warnings);
  const averageRun = averageMarkerRequested
    ? averageMarkerMean(options.averageMarker, averageMarkerScope, cats, variant !== 'grouped', dataSeries, (_, si, ci) => basis.plotVal(ci, si), rawCats.map((c) => c.id))
    : undefined;
  const averageMarkerValue = averageRun?.mean;
  if (averageMarkerRequested && averageMarkerValue === undefined) {
    warnings.push({
      code: 'average-marker-empty',
      severity: 'warn',
      message: 'averageMarker scope has no plotted values; marker omitted',
    });
  }
  const grandTotalsRequested = grandTotalRequested(options.grandTotalLabels, variant, warnings, partsAdd);
  const grandTotalsOn = grandTotalsRequested && labelOn(options, 'grandTotal');
  if (options.grandTotalLabels === true && options.labels === false && grandTotalsRequested) {
    warnings.push({
      code: 'grand-total-labels-off',
      severity: 'warn',
      message: 'grandTotalLabels is true, but labels: false turns the grand totals off. Use a labels setting that leaves grand totals on: omit labels, or set labels to an object that does not set grandTotal to false.',
      suggest: 'Omit labels, or set labels.grandTotal to true and turn other label kinds off by name.',
    });
  }
  const sharesOn = variant === 'stacked100' && labelOn(options, 'segment');
  warnIncompleteStacks(variant, cats, basis.incompleteRows, grandTotalsOn, sharesOn, 'bars', warnings, disclosuresShown(options));
  warnShareFormatIgnored(variant, options.format, shareFormatExample(options), grandTotalsOn, warnings);
  // A complete row has one share per visible series, in series order. An authored total100 names its own whole.
  const wholes = sharesOn ? cats.flatMap((c, ci) =>
    basis.nmRows[ci] || basis.naRows[ci] || basis.incompleteRows.has(c.id) || c.total100 !== undefined
      ? [] : [{ c, ci, shares: basis.shares[ci]! }]) : [];
  const shareTexts = new Map<string, string>();
  const roundingAdjustments: RoundingAdjustment[] = [];
  const shareExample = shareFormatExample(options, keySeries);
  const shareSpec = shareExample ? withChartMarks(parseFormatExample(shareExample), options.locale?.language) : undefined;
  const pctFmt = shareExample ? formatterFromExample(shareExample, options.locale?.language) : (percent: number) => formatShare(percent, options.locale?.language);
  if (options.rounding === 'sum-consistent') {
    for (const { c, shares } of wholes) {
      const rounded = sumConsistentShares(shares, options.locale?.language, shareSpec);
      if (rounded?.warning) warnings.push(roundingUnavailable(c.label, rounded.warning));
      else if (rounded) dataSeries.forEach((s, si) => {
        const share = shares[si]!;
        shareTexts.set(`${c.id}\0${s.id}`, rounded.texts[si]!);
        if (rounded.moved[si]) roundingAdjustments.push({ whole: c.label, part: s.label, share: Math.round(share * 1e4) / 1e4,
          nearest: pctFmt(share), printed: rounded.texts[si]! });
      });
    }
  } else if (sharesOn) {
    const labelDecimals = new Map<Id, number>();
    if (!shareSpec) for (const { c, ci, shares } of wholes) {
      // Missing cells contribute zero to the full row, which cannot raise its precision.
      const decimals = shareSetDecimals(full.shares[ci]!);
      labelDecimals.set(c.id, decimals);
      dataSeries.forEach((s, si) => shareTexts.set(`${c.id}\0${s.id}`, shareText(shares[si]!, decimals, options.locale?.language)));
    }
    warnShareRoundingDrift(warnings, wholes.map(({ c, shares }) => ({ name: c.label, shares, decimals: shareSpec?.decimals ?? labelDecimals.get(c.id) })));
  }
  const rescaled = options.sharesOfOneWhole === true
    ? wholes.filter(({ ci }) => !dataSeries.some((s) => s.cells[ci]!.isPct) && Math.abs(dataSeries.reduce((sum, s) => sum + s.cells[ci]!.v!, 0) - 100) > 0.05).map(({ c }) => c.label) : [];
  const shareNotes = shareRoundingNotes(options, roundingAdjustments, cappedItems(rescaled, options));
  const domain = {
    options, theme, palette: paletteRamp ? options.palette : undefined, size,
    measure: options.measure ?? defaultMeasurer, highlights, variant, shareTexts, pctFmt, roundingAdjustments, shareNotes,
    referenceStyle: options.referenceStyle ?? 'tick', connectorsOn,
    referenceTick: {
      width: options.referenceTick?.width ?? strokeToken(theme, 'rule'),
      color: options.referenceTick?.color ?? 'ink',
    },
    connectorDashed: typeof options.connectors === 'object' && options.connectors.style === 'dashed',
    connectorSeries: connectorScope === 'all' ? null : new Set<Id>(connectorScope),
    // A 100 % stack has no total by default: every bar would end on the same
    // number. An authored `grandTotalLabels: true` keeps the absolute total.
    grandTotalsOn,
    partsAdd,
    ...(partsAdd ? {} : { meanMissing: NO_STACK_MEAN }),
    axisFmt: variant === 'stacked100' ? { format: (v: number) => formatAutomaticPercent(v, 0, false, options.locale?.language) }
      : percentCellsOnly(dataSeries.map((series) => ({ vals: series.cells.map((cell) => ({ ...cell, format: cell.meta?.format })), format: series.format })))
        ? { format: valueSpec.fmtPercent, formatSpec: valueSpec.percentSpec } : { format: valueSpec.fmt, formatSpec: valueSpec.spec },
    cats, running, dataSeries, keySeries, refSeries, valueSpec, fmt: valueSpec.fmt, totalFmt: stackTotalFormatter(variant, valueSpec.spec, valueSpec.fmt), statFmt, uniformScenario, scenarioPartner,
    /**
     * A category highlight on one series makes the named bars the
     * subject. They take `highlight` and every other bar steps back to
     * `neutralLight`, the rest role line context and box rows use (`others`
     * sits below the mark floor on every preset and would need an outline
     * that reads as PL). No row band then. With several series the colours
     * carry series identity, so the band stays the one highlight channel
     * there. A highlight without a body (null, or zero, drawn as a 0.5px
     * hairline) recedes nothing, or the chart would be all rest and no subject.
     */
    restRecedes: keySeries.length === 1 && cats.some((cat, ci) => highlights.has(cat.id) && (keySeries[0]!.cells[ci]!.v ?? 0) !== 0),
    ...basis, meanValue,
    ...barNetLine(options, variant, keySeries, dataSeries, warnings),
    ...barAnnotations(options, variant, averageMarkerValue, statFmt, averageRun?.span),
  };
  const axisBasis = full !== basis && (options.valueAxis?.min !== undefined || options.valueAxis?.max !== undefined) ? full : basis;
  return { ...domain, ...barValueExtent(domain, axisBasis, warnings) };
}
