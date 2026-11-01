import { applyAxisBounds } from '../../scale';
import { percentCellsOnly, percentLevels } from '../../annotatePass';
/**
 * Standard bar phase 1, domain: the options resolved once, the series
 * normalised, sorted and cut to topN, the plotted values, stacks and shares,
 * the averages and the net line, the annotation split, and the value extent.
 */

import { restDetailsWarning, restLabel, restSum, topNCut } from '../topN';
import { normalizeCategorySeries } from '../categorySeries';
import { chartPalette } from '../chartEnv';
import { valueLineHasTargetExtras } from '../../annotateFields';
import { formatAutomaticPercent, formatShare } from '../../format';
import { formatStatWithSpec, formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { PRIORITY } from '../../label/solver';
import {
  NormalizeError,
  normalizeCategory,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { resolveCellRange, type DataRange } from '../../rangeRules';
import { defaultMeasurer } from '../../text';
import { colorRolePaints, strokeToken, panelTypeClass, rampSlots, resolveTheme, themeForWidth } from '../../theme';
import type { Annotation } from '../../types/annotations';
import { cellMeta, cellValue, isPctCell, type CellMeta, type Id, type Scenario } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { BarOptions } from '../../types/options';
import { labelOn } from '../labelOn';
import { chosenValueIndices } from '../band/valueSelection';
import { partialKeyForced, saysToDate } from '../../partialPeriod';
import { chartString } from '../../strings';
import type { LintWarning, Paint } from '../../types/scene';
import { accumulateStack, averageMarkerLine, averageOfUnaddedSums, averageOfWholeShares, grandTotalRequested, compositionBasis, mixedSignsWarning, overfullShareSum, overfullWarning, plottedMean, sortSegments, stackTotalFormatter, warnIncompleteStacks } from '../band/stacks';
import { isIncomplete, warnShareRoundingDrift } from '../../dataGaps';
import { roundingUnavailable, shareRoundingNotes, sumConsistentShares, type RoundingAdjustment } from '../../shareRounding';
import { NO_STACK_MEAN, stackAdds } from '../../stackAdds';
import { scenarioPartners, seriesScenarioRole } from '../../scenarioPairs';
import { OTHERS_ID, type BarDomain, type NormCat, type NormSeries } from './model';
import { disclosuresShown } from '../../notes';
import { cappedItems } from '../../frame';

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
  const { options, cats, dataSeries, variant } = domain;
  if (partialKeyForced(options) || !cats.some((c) => c.partial === true)) return ids;
  const words = options.strings?.toDate ?? chartString(options, 'toDate');
  const grouped = variant === 'grouped';
  const segments = dataSeries.length > 1 && labelOn(options, 'segment');
  if (dataSeries.length === 0 || variant === 'stacked100' || (grouped ? dataSeries.length > 1 || !labelOn(options, 'point') : segments || !domain.grandTotalsOn)) return ids;
  const only = dataSeries[0]!;
  const picked = grouped && options.valueLabels !== undefined ? chosenValueIndices(options.valueLabels, cats.map((_, ci) => only.cells[ci]?.v ?? null)) : undefined;
  cats.forEach((c, ci) => {
    if (c.partial !== true || saysToDate(c.label ?? c.id, words) || domain.nmRows[ci] || domain.naRows[ci] || domain.incompleteRows.has(c.id)) return;
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
  return named.size > 0 && domain.cats.every((c, ci) => c.partial !== true || named.has(c.id)
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
    ? (s && categoryId !== undefined ? domain.shareTexts.get(`${categoryId}\0${s.id}`) : undefined) ?? formatShare(pctVal, domain.options.locale?.language)
    : meta?.format
      ? formatterFromExample(meta.format, domain.options.locale?.language)(v)
      // A percent cell, and a Rest built from percent cells, keep their '%', as on column.
      : (cell.isPct && !s?.format ? domain.valueSpec.fmtPercent : s ? domain.valueSpec.forSeries(s) : domain.fmt)(v);
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
  options: BarOptions,
  rawCats: ReturnType<typeof normalizeCategory>[],
  normSeries: NormSeries[],
  dataSeries: NormSeries[],
  warnings: LintWarning[],
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
  if (options.topN) {
    const t = options.topN;
    const { kept: keptOrder, dropped } = topNCut(cats.map((_, i) => Math.abs(totalOf(i))), Math.max(1, t.n), t.threshold);
    if (dropped.length > 0) {
      if (t.rest ?? true) {
        if (normSeries.some((series) => dropped.some((i) => series.cells[i]!.range))) {
          warnings.push({
            code: 'range-topn-omitted',
            severity: 'warn',
            message: 'topN Others aggregates values but not ranges; dropped-item ranges were omitted',
            suggest: 'set topN.rest to false or pre-aggregate a defensible range upstream',
          });
        }
        for (const s of normSeries) {
          const isPct = dropped.every(i => s.cells[i]!.v === null || s.cells[i]!.isPct);
          s.cells = [...keptOrder.map((i) => s.cells[i]!), { v: restSum(dropped.map((i) => s.cells[i]!.v)), ...(isPct ? { isPct: true } : {}), meta: null }];
        }
        cats = [...keptOrder.map((i) => cats[i]!), { id: OTHERS_ID, label: restLabel(t, options.strings, dropped.length) }];
      } else {
        for (const s of normSeries) s.cells = keptOrder.map((i) => s.cells[i]!);
        cats = keptOrder.map((i) => cats[i]!);
      }
    }
  }
  return cats;
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
  const totals = cats.map((_, ci) => dataSeries.reduce((a, s) => a + (s.cells[ci]!.v ?? 0), 0));
  const nmRows: boolean[] = cats.map(() => false);
  const naRows: boolean[] = cats.map(() => false);
  const overfull: { id: Id; sum: number }[] = [];
  const composition = cats.map((cat, ci) => compositionBasis(dataSeries.map((s) => s.cells[ci]!), cat.total100));
  const basisByCat = composition.map((c) => (variant === 'stacked100' ? c.basis : 1));
  const shares: number[][] = cats.map((cat, ci) => {
    if (variant !== 'stacked100') return [];
    if (composition[ci]!.nm) {
      nmRows[ci] = true;
      return dataSeries.map(() => 0);
    }
    const basis = basisByCat[ci]!;
    if (composition[ci]!.na) {
      warnings.push({
        code: 'total100-nonpositive',
        severity: 'warn',
        message: `category '${cat.id}': non-positive 100% basis — nothing to compose, row marked n/a`,
        owner: { categoryId: cat.id },
      });
      naRows[ci] = true;
      return dataSeries.map(() => 0);
    }
    const cells = dataSeries.map((s) => s.cells[ci]!);
    const sum = overfullShareSum(cells, basis);
    if (sum !== undefined) {
      overfull.push({ id: cat.id, sum });
      return dataSeries.map(() => 0);
    }
    // A { pct } cell (also a valueKind 'fraction' value) states its share
    // directly and is outside the basis, as on column; a row of pct cells
    // only has basis 0 and must not divide by it.
    return cells.map((cell) => {
      if (cell.isPct) return cell.v ?? 0;
      return basis > 0 ? ((cell.v ?? 0) / basis) * 100 : 0;
    });
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

/** The net line, with the warnings for the cases it cannot draw. */
function barNetLine(
  options: BarOptions,
  variant: BarDomain['variant'],
  dataSeries: NormSeries[],
  warnings: LintWarning[],
): Pick<BarDomain, 'netLineOn' | 'netLineSeries'> {
  const netLineRequested = options.netLine !== undefined && options.netLine !== false;
  const netLineSeriesId =
    typeof options.netLine === 'object' ? options.netLine.seriesId : undefined;
  const netLineSeries = netLineSeriesId
    ? dataSeries.find((series) => series.id === netLineSeriesId)
    : undefined;
  let netLineOn = netLineRequested && variant !== 'grouped';
  if (netLineRequested && variant === 'grouped') {
    warnings.push({
      code: 'net-line-ignored',
      severity: 'warn',
      message: 'netLine applies only to stacked and stacked100 bar charts; ignored for grouped',
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
  return { netLineOn, netLineSeries };
}

/**
 * The annotations, split: vertical valueLines and indicator100 are drawn by
 * bar itself (the shared pass draws them horizontally for columns); the rest
 * go to the shared annotation pass. The average marker joins as a valueLine,
 * and stacked100 gets its indicator100 by default.
 */
function barAnnotations(
  options: BarOptions,
  variant: BarDomain['variant'],
  averageMarkerValue: number | undefined,
  statFmt: (v: number) => string,
): Pick<BarDomain, 'localAnns' | 'passAnns'> {
  const annotationInput: Annotation[] = [...(options.annotations ?? [])];
  if (averageMarkerValue !== undefined) annotationInput.push(averageMarkerLine(annotationInput, averageMarkerValue, statFmt, undefined, options.strings?.average));
  const annotationsAll: Annotation[] = annotationInput.map((a, n) => ({ ...a, id: a.id ?? `${a.kind}-${n + 1}` }));
  const localAnns = annotationsAll.filter((a) => a.kind === 'indicator100' || (a.kind === 'valueLine' && !valueLineHasTargetExtras(a)));
  const passAnns = annotationsAll.filter((a) => !localAnns.includes(a));
  // Endpoint-band priority: engine furniture informs (never warns) when
  // squeezed out, and yields to authored labels — see line's auto-add.
  if (variant === 'stacked100' && labelOn(options, 'percentIndicator') && !localAnns.some((a) => a.kind === 'indicator100')) {
    localAnns.push({ kind: 'indicator100', id: 'indicator100-auto', priority: PRIORITY.endpoint });
  }
  return { localAnns, passAnns };
}

/**
 * The value-space extent, and every value the exhibit renders in draw order
 * (the axis-break check needs both). stacked100: refs have no honest position
 * on a composition axis, so they neither stretch the domain nor render
 * (mirrors column; warned once).
 */
function barValueExtent(
  domain: Pick<BarDomain, 'options' | 'variant' | 'cats' | 'dataSeries' | 'refSeries' | 'plotVal' | 'plotRange' | 'stacks' | 'rowEnds' | 'localAnns' | 'meanValue'>,
  warnings: LintWarning[],
): Pick<BarDomain, 'lo' | 'hi' | 'rendered'> {
  const { options, variant, cats, dataSeries, refSeries, plotVal, plotRange, stacks, meanValue } = domain;
  const rendered: number[] = [];
  let lo = 0;
  let hi = 0;
  for (const e of domain.rowEnds) {
    lo = Math.min(lo, e.neg);
    hi = Math.max(hi, e.pos);
  }
  cats.forEach((_, ci) => {
    const stack = stacks[ci]!;
    dataSeries.forEach((_, si) => {
      const value = plotVal(ci, si);
      if (value === null) return;
      const start = variant === 'grouped' ? 0 : stack.segments[si]!.start;
      const range = plotRange(ci, si);
      rendered.push(variant === 'grouped' ? value : stack.segments[si]!.end);
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
  [lo, hi] = applyAxisBounds([lo, hi], [lo, hi], options.valueAxis, warnings);
  return { lo, hi, rendered };
}

/** Phase 1: data and options in, the plotted values and the value extent out. */
export function resolveBarDomain(data: ChartData, options: BarOptions, warnings: LintWarning[]): BarDomain {
  const size = resolveSize(options.size);
  const theme = themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? size.width);
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
  const connectorScope =
    typeof options.connectors === 'object' ? (options.connectors.scope ?? 'all') : 'all';
  const { rawCats, normSeries } = normalizeBarSeries(data, warnings);
  const dataSeries = sortSegments(normSeries.filter((s) => s.role === 'data'), options.sort?.segments, (s) => s.cells.reduce((sum, cell) => sum + (cell.v ?? 0), 0));
  const refSeries = normSeries.filter((s) => s.role === 'reference');
  if (dataSeries.length === 0) {
    throw new NormalizeError('no-data-series', 'series', 'bar requires at least one data-role series');
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
    (options as { rasterFromValues?: boolean }).rasterFromValues === false;
  const valueSpec = seriesRasterFormatter(options.format, hostDeclaresPrecision
      ? []
      : normSeries.flatMap((s) =>
          s.cells.flatMap((cell) => [cell.v, cell.range?.low, cell.range?.high, cell.range?.mid]),
        ), options.locale?.language, options.unit, options.target, undefined, variant !== 'grouped');
  // Derived statistics (the Ø average marker/line) keep their own precision
  // inside the exhibit's style — an integer-rastered bar still prints its
  // mean as "Ø 14.9", never "Ø 15" (see formatStatWithSpec; column twin).
  const statSpec = !options.format && (variant === 'stacked100' || options.unit === '%' || percentLevels(dataSeries.map(series => ({ vals: series.cells }))))
    ? { ...valueSpec.spec, suffix: '%' } : valueSpec.spec;
  const statFmt = (v: number) => formatStatWithSpec(v, statSpec);
  if (variant === 'stacked100' && dataSeries.length === 1) {
    warnings.push({
      code: 'stacked100-single-series',
      severity: 'warn',
      message:
        "a 100% composition of a single series is always 100% — use variant:'stacked' or 'grouped' to show the level",
    });
  }
  const cats = orderBarCategories(options, rawCats, normSeries, dataSeries, warnings);
  const lostDetails = cats.some((c) => c.id === OTHERS_ID) ? restDetailsWarning(data, new Set(cats.map((c) => c.id))) : undefined;
  if (lostDetails) warnings.push(lostDetails);
  const uniformScenario = new Map<Id, Scenario>();
  if (variant !== 'grouped' && dataSeries.length > 1) {
    cats.forEach((cat, ci) => {
      const scenarios = dataSeries
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
  const roles = colorRolePaints(dataSeries);
  // A scenario series takes the colour of its actual (scenarioPairs). A series whose cells all
  // carry one scenario counts as that scenario. Grouped bars pair in authored order, so sorting the
  // segments never re-pairs a plan. A stack keeps its stack colours: only a plan pairs.
  const stacked = variant !== 'grouped';
  const ownPaint = (x: NormSeries): boolean => !!x.fill || !!x.colorRole || highlights.has(x.id);
  const scenarioPartner = stacked
    ? scenarioPartners(dataSeries, (x) => x.scenario, ownPaint, true)
    : scenarioPartners(normSeries.filter((x) => x.role === 'data'), (x) => seriesScenarioRole(x.scenario, x.cells.filter((c) => c.v !== null).map((c) => c.meta?.scenario)), ownPaint, false);
  // A paired scenario series of grouped bars takes no ramp step of its own. One with its own
  // paint keeps it, so it stays in the deal and the plain series step past its colour.
  const dealt = dataSeries.filter((s) => stacked || ownPaint(s) || !scenarioPartner.has(s.id));
  const slots = rampSlots(theme, dealt.map((s): Paint | undefined =>
    s.fill ? { css: s.fill } : s.colorRole ? roles.get(s.id)! : highlights.has(s.id) ? { token: 'focus' } : undefined,
  ), paletteRamp ? options.palette : undefined, { labels: dealt.map((s) => s.label), warnings });
  dealt.forEach((s, i) => (s.slot = slots[i]!));
  dataSeries.forEach((s) => { const partner = scenarioPartner.get(s.id); if (partner && !dealt.includes(s)) s.slot = partner.slot; });
  const basis = barBasis(variant, cats, dataSeries, warnings);
  // TWIN of column's `meanValue`. NOT coalesced to 0: with no plotted value
  // there is no mean, and a valueLine drawn at 0 would state a number the
  // data does not support (the shared annotate pass fails this closed with
  // 'no-mean'; bar's local valueLine mirrors it).
  // a stack of percents of different wholes has no total to print,
  // anchor on or average.
  const addsOver = (series: NormSeries[]) => (variant !== 'stacked' && variant !== 'stacked100') || stackAdds(series, options.unit, options.sharesOfOneWhole);
  const partsAdd = addsOver(dataSeries);
  const meanValue = partsAdd ? plottedMean('all', variant !== 'grouped', cats.length, dataSeries, (_, si, ci) => basis.plotVal(ci, si)) : undefined;
  const averageMarkerScope =
    typeof options.averageMarker === 'object' ? options.averageMarker.scope : 'all';
  const averageMarkerRequested = options.averageMarker !== undefined && options.averageMarker !== false &&
    !averageOfWholeShares(variant, averageMarkerScope, warnings) &&
    !averageOfUnaddedSums(addsOver(averageMarkerScope === 'all' ? dataSeries : dataSeries.filter((s) => averageMarkerScope.includes(s.id))), warnings);
  const averageMarkerValue = averageMarkerRequested
    ? plottedMean(averageMarkerScope, variant !== 'grouped', cats.length, dataSeries, (_, si, ci) => basis.plotVal(ci, si))
    : undefined;
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
  // Computed shares only: an authored total100 is the author's whole.
  const wholes = sharesOn ? cats.flatMap((c, ci) =>
    basis.nmRows[ci] || basis.naRows[ci] || basis.incompleteRows.has(c.id) || c.total100 !== undefined
      ? []
      : [{ c, parts: dataSeries.flatMap((s, si) => (s.cells[ci]!.v === null ? [] : [{ s, share: basis.shares[ci]![si]! }])) }]) : [];
  // rounding 'sum-consistent' (the default): each complete bar's shares print so they add up to 100%.
  const shareTexts = new Map<string, string>();
  const roundingAdjustments: RoundingAdjustment[] = [];
  if (options.rounding !== 'nearest') {
    for (const { c, parts } of wholes) {
      const rounded = sumConsistentShares(parts.map((part) => part.share), options.locale?.language);
      if (rounded?.warning) warnings.push(roundingUnavailable(c.label, rounded.warning));
      else if (rounded) parts.forEach((part, index) => {
        shareTexts.set(`${c.id}\0${part.s.id}`, rounded.texts[index]!);
        if (rounded.moved[index]) roundingAdjustments.push({ whole: c.label, part: part.s.label, share: Math.round(part.share * 1e4) / 1e4,
          nearest: formatShare(part.share, options.locale?.language), printed: rounded.texts[index]! });
      });
    }
  } else if (sharesOn) {
    warnShareRoundingDrift(warnings, wholes.map(({ c, parts }) => ({ name: c.label, shares: parts.map((part) => part.share) })));
  }
  // sharesOfOneWhole: a bar whose authored parts miss 100 prints shares of its own total; direct percents print as authored.
  const rescaled = options.sharesOfOneWhole === true
    ? wholes.filter(({ c, parts }) => !dataSeries.some((s) => s.cells[cats.indexOf(c)]!.isPct) && Math.abs(parts.reduce((sum, part) => sum + part.s.cells[cats.indexOf(c)]!.v!, 0) - 100) > 0.05).map(({ c }) => c.label) : [];
  const shareNotes = shareRoundingNotes(options, roundingAdjustments, cappedItems(rescaled, options));
  const domain = {
    options, theme, palette: paletteRamp ? options.palette : undefined, size,
    measure: options.measure ?? defaultMeasurer, highlights, variant, shareTexts, roundingAdjustments, shareNotes,
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
    cats, dataSeries, refSeries, valueSpec, fmt: valueSpec.fmt, totalFmt: stackTotalFormatter(variant, valueSpec.spec, valueSpec.fmt), statFmt, uniformScenario, scenarioPartner,
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
    restRecedes: dataSeries.length === 1 && cats.some((cat, ci) => highlights.has(cat.id) && (dataSeries[0]!.cells[ci]!.v ?? 0) !== 0),
    ...basis, meanValue,
    ...barNetLine(options, variant, dataSeries, warnings),
    ...barAnnotations(options, variant, averageMarkerValue, statFmt),
  };
  return { ...domain, ...barValueExtent(domain, warnings) };
}
