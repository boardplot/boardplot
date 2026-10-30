/**
 * Column phase 1, domain: the options resolved once, the series normalised,
 * sorted and cut to topN, the variant and its options, the plotted values,
 * stacks and totals, the anomaly rule, the value domain and the axis break.
 */

import { restDetailsWarning, restLabel, restSum, topNCut } from '../topN';
import { cellFields, normalizeCategorySeries } from '../categorySeries';
import { chartPalette } from '../chartEnv';
import { breakStyleRefusal } from '../band/breakOrder';
import { cagr, formatAuthoredPercent, formatAutomaticPercent, formatShare, shareSetFormatter } from '../../format';
import { formatStatWithSpec, formatterFromExample, formatWithSpec, parseFormatExample, roundedNumber, seriesRasterFormatter, withChartMarks } from '../../formatSpec';
import { yearSpan, yearSpanFromLabels } from '../../periodYears';
import { PRIORITY } from '../../label/solver';
import {
  NormalizeError,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { resolveCellRange, type DataRange } from '../../rangeRules';
import { axisBreakInvalid } from '../../axisBreakInvalid';
import { applyAxisBounds, invalidLinearBreakReason, niceDomain, type LinearBreak } from '../../scale';
import { defaultMeasurer } from '../../text';
import { canvasMargin, headingWeight, labelsOffKeepsNames, panelTypeClass, resolveTheme, themeForWidth } from '../../theme';
import { measureValueAxisWidth } from '../../axis';
import { percentLevels } from '../../annotatePass';
import type { Annotation } from '../../types/annotations';
import { type Direction, type Id, type Scenario } from '../../types/cell';
import type { Category, ChartData } from '../../types/data';
import type { LabelContent, LabelKind, RenderTarget, ValueAxisOptions } from '../../types/options';
import type { LintWarning, PlacedAnnotation } from '../../types/scene';
import { valueLineExtent, type ValueLineExtent } from '../../valueLineDomain';
import { applyCategoryViewport, liveWindowOptions, viewportMeanSpan } from '../../viewport';
import { VALUE_LINE_RESERVE } from '../../annotateParts';
import { accumulateStack, averageMarkerLine, averageOfUnaddedSums, averageOfWholeShares, grandTotalRequested, compositionBasis, mixedSignsWarning, overfullShareSum, overfullWarning, plottedMean, sortSegments, stackTotalFormatter, warnIncompleteStacks } from '../band/stacks';
import { NO_STACK_MEAN, stackAdds } from '../../stackAdds';
import { isIncomplete, warnShareRoundingDrift } from '../../dataGaps';
import { roundingUnavailable, sumConsistentShares, type RoundingAdjustment } from '../../shareRounding';
import { chosenValueIndices } from '../band/valueSelection';
import { partialKeyForced, saysToDate, toDateFits } from '../../partialPeriod';
import { chartString } from '../../strings';
import { anomalyCorridor, columnAnomalyModel, refuseColumnEncodings, type AnomalyModel } from './anomaly';
import type { ColumnDomain, ColumnEnv, ColumnVariant, ComputedTotal, IntegratedValue, NormSer } from './model';
import { PANEL_KEYED } from './model';
import type { AnomalyColumnOptions } from './types';
import { currentSmallValues } from '../../formatPrecision';
import { disclosuresShown } from '../../notes';
import { maxOf } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

/** What the options resolve to once: theme, palette, size, measurer, formatters. */
function resolveColumnEnv(options: AnomalyColumnOptions, warnings: LintWarning[]): ColumnEnv {
  const size = resolveSize(options.size);
  const theme = themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? size.width);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  return {
    options,
    theme,
    palette: paletteRamp ? options.palette : undefined,
    size,
    measure: options.measure ?? defaultMeasurer,
    pctFmt: options.shareLabels?.format ? formatterFromExample(options.shareLabels.format, options.locale?.language) : (p: number) => formatShare(p, options.locale?.language),
    authoredPctFmt: (p: number) => formatAuthoredPercent(p, options.locale?.language),
    highlights: new Set(resolveHighlight(options.highlight)),
    density: options.labelDensity ?? 'smart',
  };
}

/** The label-kind gate: false, true, or the authored content. */
export function kindSetting(options: AnomalyColumnOptions, kind: LabelKind): boolean | LabelContent {
  const l = options.labels;
  if (l === false) return kind === 'category' && labelsOffKeepsNames(options);
  const v = l?.[kind];
  return v === undefined ? true : v;
}

/**
 * Whether the key names the integrated PY reference, so its
 * tick prints the value alone ("82", not "82 PY") and the columns may widen.
 * The key is the chart's own legend, or the grid's (PANEL_KEYED).
 */
export function pyTickKeyed(domain: Pick<ColumnDomain, 'options' | 'pyRef'>, legend: { items: { id: Id }[] } | undefined): boolean {
  const ref = domain.pyRef;
  if (!ref || kindSetting(domain.options, 'tick') !== true) return false;
  return legend?.items.some((item) => item.id === ref.id) === true ||
    (domain.options as { [PANEL_KEYED]?: boolean })[PANEL_KEYED] === true;
}

export function contentOf(options: AnomalyColumnOptions, kind: LabelKind, dflt: LabelContent): LabelContent | null {
  const s = kindSetting(options, kind);
  if (s === false) return null;
  return Array.isArray(s) ? s : dflt;
}

/**
 * The running categories whose value prints the to-date words under it
 * ("31.2" over "to date"), as on combo: a single grouped series' value or a
 * stack's total. A stack with segment values, a 100% stack, a mixed-sign
 * stack, a value under a negative column and a name that says "to date"
 * keep the hatch key (or, with no key, the axis words).
 */
export function toDateOnValues(domain: ColumnDomain): Set<Id> {
  const ids = new Set<Id>();
  const { options, cats, dataSeries, variant } = domain;
  if (partialKeyForced(options) || !cats.some((c) => c.partial === true)) return ids;
  const words = options.strings?.toDate ?? chartString(options, 'toDate');
  if (!toDateFits(words, domain.theme, domain.measure, domain.size.width / Math.max(1, cats.length))) return ids;
  const grouped = variant === 'grouped';
  const segments = dataSeries.length > 1 && contentOf(options, 'segment', ['absolute']) !== null;
  const content = grouped ? contentOf(options, 'point', ['absolute']) : domain.gtContent;
  if (dataSeries.length === 0 || variant === 'stacked100' || (grouped ? dataSeries.length > 1 : segments) || !content?.includes('absolute')) return ids;
  const only = dataSeries[0]!;
  const picked = grouped && options.valueLabels !== undefined ? chosenValueIndices(options.valueLabels, cats.map((_, ci) => only.vals[ci]?.v ?? null)) : undefined;
  cats.forEach((c, ci) => {
    if (c.partial !== true || saysToDate(c.label ?? c.id, words) || domain.mixedSignCats.has(c.id)) return;
    if (grouped ? only.vals[ci]?.v === null || only.vals[ci]?.v === undefined : !domain.stacks[ci]!.hasValue) return;
    // A value under a negative column stands at the category row: the words would push its name off.
    if (grouped ? only.vals[ci]!.v! < 0 : !(domain.posTopP[ci]! > 0 || domain.negBotP[ci]! === 0)) return;
    if (picked && !picked.has(ci) && typeof only.vals[ci]?.labelOverride !== 'string') return;
    const populated = dataSeries.filter((s) => s.vals[ci]?.v !== null && s.vals[ci]?.v !== undefined);
    const override = populated.length === 1 ? populated[0]!.vals[ci]!.labelOverride : undefined;
    if (override === false || (typeof override === 'string' && override.trim() === '')) return;
    ids.add(c.id);
  });
  return ids;
}

/** Every drawn running category carries the to-date words on its value: no hatch key, note or axis words. */
export function partialNamedOnValues(domain: ColumnDomain): boolean {
  const named = toDateOnValues(domain);
  return named.size > 0 && domain.cats.every((c, ci) => c.partial !== true || named.has(c.id)
    || (domain.variant === 'grouped' ? domain.dataSeries.every((s) => s.vals[ci]?.v === null || s.vals[ci]?.v === undefined) : !domain.stacks[ci]!.hasValue));
}

function normalizeColumnData(data: ChartData, warnings: LintWarning[]): { cats: Category[]; seriesNorm: NormSer[] } {
  const { cats, series } = normalizeCategorySeries('column', data, (s, cells, cats): NormSer => ({
    id: s.id,
    label: s.label ?? s.id,
    role: s.role ?? 'data',
    scenario: normalizeScenario(s.scenario as string | undefined, `series[${s.id}].scenario`),
    direction: s.direction ?? 'higherIsBetter',
    colorRole: s.colorRole,
    fill: s.fill,
    format: s.format,
    unit: s.unit,
    vals: cells.map((cell, ci) => ({
      ...cellFields(cell, `series[${s.id}].values[${ci}]`),
      range: resolveCellRange(cell, `series[${s.id}].values[${ci}]`, warnings, { seriesId: s.id, categoryId: cats[ci]?.id }),
    })),
  }));
  return { cats, seriesNorm: series };
}

/**
 * Sort (live reorder), then topN: keep the n largest categories and
 * aggregate the rest into 'Others' (always last). Reorders `seriesNorm`'s
 * values in place.
 */
function orderColumnCategories(
  options: AnomalyColumnOptions,
  categories: Category[],
  seriesNorm: NormSer[],
  series: NormSer[],
  warnings: LintWarning[],
): { cats: Category[]; dataSeries: NormSer[]; othersId: Id | null } {
  let cats = categories;
  let dataSeries = series;
  const anomalySpec = options.anomaly;
  dataSeries = sortSegments(dataSeries, options.sort?.segments, (s) => s.vals.reduce((a, x) => a + (x.v ?? 0), 0));
  const catTotal = (ci: number) => dataSeries.reduce((a, s) => a + (s.vals[ci]!.v ?? 0), 0);
  const applyOrder = (order: number[]): void => {
    cats = order.map((i) => cats[i]!);
    for (const s of seriesNorm) s.vals = order.map((i) => s.vals[i]!);
  };
  const catSort = options.sort?.categories;
  if (catSort && catSort !== 'sheet') {
    const order = cats.map((_, i) => i);
    if (catSort === 'reverse') order.reverse();
    else {
      const dir = catSort === 'asc' ? 1 : -1;
      order.sort((a, b) => (catTotal(a) - catTotal(b)) * dir || a - b);
    }
    applyOrder(order);
  }

  let othersId: Id | null = null;
  const topN = anomalySpec ? undefined : options.topN;
  if (anomalySpec && options.topN && options.topN.n > 0 && cats.length > options.topN.n) {
    // The rule is a statement about the series as given. An 'Others' bucket
    // has no score, and dropping categories silently changes the population
    // the median and MAD are computed from — so topN is the option that goes.
    warnings.push({
      code: 'anomaly-topn-ignored',
      severity: 'warn',
      message: `topN ignored: an anomaly rule is computed over every period, and an aggregated '${options.topN.restLabel ?? options.strings?.others ?? 'Others'}' bucket has no score`,
      suggest: 'drop options.topN, or drop options.anomaly and rank instead of flag',
    });
  }
  if (topN && topN.n > 0 && cats.length > topN.n) {
    const { kept: keptIdx, dropped: dropIdx } = topNCut(cats.map((_, i) => Math.abs(catTotal(i))), topN.n);
    if (topN.rest === false || dropIdx.length === 0) {
      applyOrder(keptIdx);
    } else {
      if (seriesNorm.some((series) => dropIdx.some((i) => series.vals[i]!.range))) {
        warnings.push({
          code: 'range-topn-omitted',
          severity: 'warn',
          message: 'topN Others aggregates values but not ranges; dropped-item ranges were omitted',
          suggest: 'set topN.rest to false or pre-aggregate a defensible range upstream',
        });
      }
      othersId = 'others';
      while (cats.some((c) => c.id === othersId)) othersId = `_${othersId}`;
      const othersVals = seriesNorm.map((s) => restSum(dropIdx.map((i) => s.vals[i]!.v)));
      applyOrder(keptIdx);
      cats = [...cats, { id: othersId, label: restLabel(topN, options.strings, dropIdx.length) }];
      seriesNorm.forEach((s, k) => {
        s.vals = [...s.vals, { v: othersVals[k]!, isPct: false }];
      });
    }
  }
  return { cats, dataSeries, othersId };
}

/** The integrated PY reference and the categories whose stack carries one scenario. */
function columnScenarios(
  options: AnomalyColumnOptions,
  variant: ColumnVariant,
  cats: Category[],
  dataSeries: NormSer[],
  refSeries: NormSer[],
  warnings: LintWarning[],
): { pyRef: NormSer | undefined; uniformScenario: Map<Id, Scenario> } {
  const stackedLike = variant !== 'grouped';
  const refStyle = options.referenceStyle ?? 'tick';
  const labelGateOpen = (kind: 'annotation' | 'grandTotal' | 'tick'): boolean =>
    options.labels !== false && options.labels?.[kind] !== false;
  const pyReferences = refSeries.filter((series) => series.scenario === 'PY');
  const integrable =
    variant === 'stacked' &&
    refStyle === 'tick' &&
    options.grandTotalLabels !== false &&
    labelGateOpen('grandTotal') &&
    labelGateOpen('annotation') &&
    labelGateOpen('tick');
  const pyRef = integrable && pyReferences.length === 1 ? pyReferences[0] : undefined;
  if (integrable && pyReferences.length > 1) {
    warnings.push({
      code: 'integrated-variance-reference-ambiguous',
      severity: 'warn',
      message: 'integrated stacked variance needs exactly one PY reference; multiple PY references keep the legacy ticks without growth labels',
      suggest: 'Keep one PY reference series or use an explicit scaled variance tier.',
    });
  }
  const uniformScenario = new Map<Id, Scenario>();
  if (stackedLike && dataSeries.length > 1) {
    cats.forEach((cat, ci) => {
      const scenarios = dataSeries
        .filter((s) => s.vals[ci]!.v !== null)
        .map((s) => s.vals[ci]!.scenario ?? s.scenario);
      const scenario = scenarios[0];
      if (scenario !== undefined && scenarios.every((candidate) => candidate === scenario)) {
        uniformScenario.set(cat.id, scenario);
      }
    });
  }
  if (variant === 'stacked100' && dataSeries.length === 1) {
    warnings.push({
      code: 'stacked100-single-series',
      severity: 'warn',
      message:
        "a 100% composition of a single series is always 100% — use variant:'stacked' or 'grouped' to show the level",
    });
  }
  return { pyRef, uniformScenario };
}

type ColumnLines = Pick<
  ColumnDomain,
  'connectorsOn' | 'connectorDashed' | 'connectorSeries' | 'netLineOn' | 'netLineSeries' | 'netLineSteps'
>;

/** Series connectors and the net line, with the warnings for the cases they cannot draw. */
function columnLines(
  options: AnomalyColumnOptions,
  stackedLike: boolean,
  dataSeries: NormSer[],
  warnings: LintWarning[],
  basesGiven = false,
): ColumnLines {
  const connectorsOn = options.connectors !== undefined && options.connectors !== false;
  if (connectorsOn && !stackedLike) {
    warnings.push({
      code: 'connectors-ignored',
      severity: 'warn',
      message: 'connectors apply only to stacked and stacked100 column charts; ignored for grouped',
    });
  }
  const connectorDashed =
    typeof options.connectors === 'object' && options.connectors.style === 'dashed';
  const connectorScope =
    typeof options.connectors === 'object' ? (options.connectors.scope ?? 'all') : 'all';
  const connectorSeries =
    connectorScope === 'all' ? null : new Set<Id>(connectorScope);
  const netLineRequested = options.netLine !== undefined && options.netLine !== false;
  const netLineSeriesId =
    typeof options.netLine === 'object' ? options.netLine.seriesId : undefined;
  const netLineSteps =
    typeof options.netLine === 'object' ? (options.netLine.connectors ?? true) : true;
  const netLineSeries = netLineSeriesId
    ? dataSeries.find((series) => series.id === netLineSeriesId)
    : undefined;
  let netLineOn = netLineRequested && stackedLike;
  // Every stack of a 100 % chart nets to 100 %, so a net line there
  // draws one tick row along the top edge that says nothing. A seriesId
  // traces a share boundary and keeps its meaning; total100 bases leave
  // columns short of 100 %, so the line keeps its meaning there too.
  if (netLineOn && options.variant === 'stacked100' && !netLineSeriesId && !basesGiven) {
    netLineOn = false;
    warnings.push({
      code: 'net-line-ignored',
      severity: 'warn',
      message: 'netLine on stacked100 marks the 100% edge every column reaches; ignored',
      suggest: 'remove netLine, or name the series whose share boundary it traces with netLine.seriesId',
      field: ['options', 'netLine'],
      fix: [{ op: 'remove', path: '/options/netLine' }],
    });
  }
  if (netLineRequested && !stackedLike) {
    warnings.push({
      code: 'net-line-ignored',
      severity: 'warn',
      message: 'netLine applies only to stacked and stacked100 column charts; ignored for grouped',
    });
  }
  if (options.shareLabels !== undefined && !stackedLike) {
    warnings.push({
      code: 'share-labels-ignored',
      severity: 'warn',
      message: 'shareLabels applies only to stacked and stacked100 column charts, whose columns are wholes; ignored for grouped',
      suggest: "use variant 'stacked' to print each segment's share of its column",
    });
  }
  if (options.seriesLabels !== undefined && !stackedLike) {
    warnings.push({
      code: 'series-labels-ignored',
      severity: 'warn',
      message: 'seriesLabels applies only to stacked and stacked100 column charts; ignored for grouped',
      suggest: 'use a legend to name grouped series',
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
      series.vals.flatMap((value) => (value.v === null ? [] : [value.v])),
    );
    const hasPositive = values.some((value) => value > 0);
    const hasNegative = values.some((value) => value < 0);
    // The default line traces the positive top, or the negative bottom when
    // nothing is positive, so a single-signed default is always the outer edge.
    const outermost = netLineSeries
      ? dataSeries.at(-1)?.id === netLineSeries.id
      : hasPositive !== hasNegative;
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
  return { connectorsOn, connectorDashed, connectorSeries, netLineOn, netLineSeries, netLineSteps };
}

/**
 * A total column (categories[].role 'total') whose cells are all null takes
 * the base-weighted share of each series over the other columns: the share of
 * all respondents, Σ base·share / Σ base, never the mean of the group shares.
 * The bases are the columns' total100. A percent cell is the share as
 * authored; a count cell's share is count / total100. Without a base on every
 * group the column stays empty, and a series with no value in some group
 * keeps an empty total cell; both say why.
 */
function weightedTotal(cats: Category[], dataSeries: NormSer[], warnings: LintWarning[]): ComputedTotal | undefined {
  const ti = cats.findIndex((c) => c.role === 'total');
  if (ti < 0 || dataSeries.some((s) => s.vals[ti]!.v !== null)) return undefined;
  const total = cats[ti]!;
  const name = (c: Category) => c.label ?? c.id;
  const groups = cats.flatMap((_, ci) => (ci === ti ? [] : [ci]));
  const base = (ci: number) => cats[ci]!.total100;
  if (groups.length === 0 || groups.some((ci) => !(base(ci)! > 0))) {
    warnings.push({
      code: 'total-not-computed',
      severity: 'warn',
      message: `the total column '${name(total)}' has no values, and not every other column carries a total100 base to weight it by`,
      suggest: 'give each group its respondent base in categories[].total100, or author the total values',
    });
    return undefined;
  }
  const n = groups.reduce((a, ci) => a + base(ci)!, 0);
  const values: Record<Id, number> = emptyIdRecord();
  for (const s of dataSeries) {
    const missing = groups.filter((ci) => s.vals[ci]!.v === null);
    if (missing.length > 0) {
      warnings.push({
        code: 'total-not-computed',
        severity: 'warn',
        message: `'${name(total)}' has no value for '${s.label}': no observation in ${missing.map((ci) => `'${name(cats[ci]!)}'`).join(', ')}`,
        owner: { seriesId: s.id, categoryId: total.id },
        suggest: 'author the missing group values, or the total value itself',
      });
      continue;
    }
    const share = (ci: number) => (s.vals[ci]!.isPct ? s.vals[ci]!.v! : (s.vals[ci]!.v! / base(ci)!) * 100);
    const v = groups.reduce((a, ci) => a + base(ci)! * share(ci), 0) / n;
    s.vals[ti] = { ...s.vals[ti]!, v, isPct: true };
    values[s.id] = v;
  }
  if (Object.keys(values).length === 0) return undefined;
  cats[ti] = { ...total, total100: n };
  warnings.push({
    code: 'total-weighted',
    severity: 'info',
    message: `'${name(total)}' is the base-weighted share of all ${n} in ${groups.length} columns, not the mean of their shares`,
  });
  return { categoryId: total.id, total100: n, values };
}

/** More ribbon series than this cross into spaghetti. */
const RIBBON_CROWDED = 6;

/** Whether ribbons draw and in which stack order, with the warnings for the cases they cannot draw. */
function columnRibbons(
  options: AnomalyColumnOptions,
  variant: ColumnVariant,
  stackedLike: boolean,
  dataSeries: NormSer[],
  warnings: LintWarning[],
): { ribbonsOn: boolean; ribbonRank: boolean } {
  const requested = options.ribbons !== undefined && options.ribbons !== false;
  if (!requested) return { ribbonsOn: false, ribbonRank: false };
  if (!stackedLike) {
    warnings.push({
      code: 'ribbons-ignored',
      severity: 'warn',
      message: 'ribbons apply only to stacked and stacked100 column charts; ignored for grouped',
      suggest: "use variant 'stacked'",
    });
    return { ribbonsOn: false, ribbonRank: false };
  }
  // A 100% stack is usually an answer scale or a fixed list of parts, whose
  // order is the reading; an absolute stack of players is ranked by size.
  const order = (typeof options.ribbons === 'object' ? options.ribbons.order : undefined) ?? (variant === 'stacked100' ? 'sheet' : 'rank');
  // Fixed-order ribbons never cross, so only ranked ones crowd.
  if (order === 'rank' && dataSeries.length > RIBBON_CROWDED) {
    warnings.push({
      code: 'ribbon-crowded',
      severity: 'warn',
      message: `${dataSeries.length} series draw ribbons; above ${RIBBON_CROWDED} their crossings become hard to follow`,
      suggest: `keep the ${RIBBON_CROWDED} largest series and fold the rest into one Others series upstream, or drop ribbons`,
    });
  }
  return { ribbonsOn: true, ribbonRank: order === 'rank' };
}

type ColumnBasis = Pick<
  ColumnDomain,
  'nmCats100' | 'naCats100' | 'mixedSignCats' | 'incompleteCats' | 'emptyCats' | 'plottedOf' | 'rangeOf' | 'absOf' | 'shareOf' | 'stacks' | 'stackTotals' | 'percents'
>;

/**
 * The percent basis, the plotted values and the totals.
 *
 * stacked100 fail-closed rule (notation rule: a composition share requires
 * nonnegative components): ANY negative component invalidates its whole
 * category — segments, share labels, and the total are suppressed and the
 * category renders 'n.m.'; an all-zero basis has nothing to compose → 'n/a'.
 */
function columnBasis(
  variant: ColumnVariant,
  cats: Category[],
  dataSeries: NormSer[],
  warnings: LintWarning[],
  ranked = false,
): ColumnBasis {
  const nmCats100 = new Set<Id>();
  const naCats100 = new Set<Id>();
  const mixedSignCats = new Set<Id>();
  // The whole a segment is a share of: the 100% basis on stacked100, and on
  // stacked the basis a segment label's percent part reads against.
  const basisByCat: number[] = cats.map((c, ci) => {
    if (variant === 'grouped') return 0;
    const { basis, nm, na } = compositionBasis(dataSeries.map((s) => s.vals[ci]!), c.total100);
    if (nm) {
      (variant === 'stacked100' ? nmCats100 : mixedSignCats).add(c.id);
      return 0;
    }
    if (basis <= 0 && (variant === 'stacked' || !na)) return 0;
    if (basis <= 0) {
      naCats100.add(c.id);
      warnings.push({
        code: 'percent-basis-nonpositive',
        severity: 'warn',
        message: `category '${c.id}': non-positive 100% basis — nothing to compose, category marked n/a`,
        owner: { categoryId: c.id },
      });
      return 0;
    }
    return basis;
  });
  if (nmCats100.size > 0) warnings.push(mixedSignsWarning([...nmCats100], cats.length));
  // A column past 100% is no composition either: it draws as n.m., as a signed one does.
  const overfull = variant !== 'stacked100' ? [] : cats.flatMap((c, ci) => {
    if (nmCats100.has(c.id) || naCats100.has(c.id)) return [];
    const sum = overfullShareSum(dataSeries.map((s) => s.vals[ci]!), basisByCat[ci]!);
    return sum === undefined ? [] : [{ id: c.id, sum }];
  });
  for (const row of overfull) nmCats100.add(row.id);
  if (overfull.length > 0) warnings.push(overfullWarning(overfull, nmCats100.size + naCats100.size === cats.length, "give every part as a share of the same whole, or use variant 'grouped' for shares that overlap, such as answers to a multi-select question"));
  const plottedOf = (s: NormSer, ci: number): number | null => {
    const val = s.vals[ci]!;
    if (val.v === null) return null;
    if (variant !== 'stacked100') return val.v;
    if (nmCats100.has(cats[ci]!.id)) return 0;
    if (val.isPct) return val.v;
    const b = basisByCat[ci]!;
    return b > 0 ? (val.v / b) * 100 : 0;
  };
  const rangeOf = (s: NormSer, ci: number): DataRange | undefined => {
    const val = s.vals[ci]!;
    if (!val.range) return undefined;
    if (variant !== 'stacked100' || val.isPct) return val.range;
    const basis = basisByCat[ci]!;
    if (basis <= 0) return undefined;
    const scale = (value: number) => (value / basis) * 100;
    return {
      low: scale(val.range.low),
      high: scale(val.range.high),
      ...(val.range.mid === undefined ? {} : { mid: scale(val.range.mid) }),
    };
  };
  const absOf = (s: NormSer, ci: number): number | null => {
    const val = s.vals[ci]!;
    if (val.v === null) return null;
    if (!val.isPct) return val.v;
    if (variant !== 'stacked100') return val.v;
    const b = basisByCat[ci]!;
    return b > 0 ? (val.v * b) / 100 : null;
  };
  const stacks = cats.map((_, ci) =>
    accumulateStack(dataSeries.map((series) => plottedOf(series, ci)), ranked),
  );
  // Exact, never rounded here: the total labels, the description, the diff
  // and cagr anchors and the ref-zero test all read these, and the exhibit's
  // raster formatter rounds once at print time (as bar does). Rounding to two
  // decimals first printed 0.014 → 0.02 as "+100%" and took 0.004 for zero.
  const stackTotals: Record<Id, number> = emptyIdRecord();
  cats.forEach((c, ci) => {
    stackTotals[c.id] = dataSeries.reduce((a, s) => a + (absOf(s, ci) ?? 0), 0);
  });
  let percents: Record<Id, Record<Id, number>> | undefined;
  if (variant === 'stacked100') {
    percents = emptyIdRecord();
    cats.forEach((c, ci) => {
      const row: Record<Id, number> = emptyIdRecord();
      for (const s of dataSeries) {
        const p = plottedOf(s, ci);
        if (p !== null) row[s.id] = p;
      }
      percents![c.id] = row;
    });
  }
  // A stack with a missing part has no known whole: its total, and on a
  // 100% stack its shares, would describe the known parts only. A category
  // with no part at all is empty, not partial.
  const emptyCats = new Set(variant === 'grouped' ? [] : cats
    .filter((_, ci) => dataSeries.every((s) => s.vals[ci]!.v === null))
    .map((c) => c.id));
  const incompleteCats = new Set(variant === 'grouped' ? [] : cats
    .filter((c, ci) => !emptyCats.has(c.id) && isIncomplete(dataSeries.map((s) => s.vals[ci]!.v)))
    .map((c) => c.id));
  const shareOf = (s: NormSer, ci: number): number | null => {
    const c = cats[ci]!;
    if (basisByCat[ci]! <= 0 || (incompleteCats.has(c.id) && c.total100 === undefined)) return null;
    if (variant === 'stacked100') return plottedOf(s, ci);
    const val = s.vals[ci]!;
    return val.v === null || val.isPct ? null : (val.v / basisByCat[ci]!) * 100;
  };
  return { nmCats100, naCats100, mixedSignCats, incompleteCats, emptyCats, plottedOf, rangeOf, absOf, shareOf, stacks, stackTotals, percents };
}

/** The growth of each stack total against the one PY reference. */
function integratedVarianceValues(
  pyRef: NormSer,
  cats: Category[],
  dataSeries: NormSer[],
  stackTotals: Record<Id, number>,
  stacks: ColumnDomain['stacks'],
  roundedForDisplay: (value: number) => number,
  warnings: LintWarning[],
  locale: string | undefined,
): Map<Id, IntegratedValue> {
  const growthSpec = parseFormatExample('88.8%');
  const growthFormatter = formatterFromExample('88.8%', locale);
  const integratedDirection: Direction = dataSeries.every(
    (series) => series.direction === 'lowerIsBetter',
  )
    ? 'lowerIsBetter'
    : 'higherIsBetter';
  const pyGrowth = new Map<Id, IntegratedValue>();
  // A running period against a full prior one is not a like-for-like growth
  // figure: it still prints, and the warning names it.
  const partial = cats.filter((category, ci) => category.partial === true && stacks[ci]!.hasValue && pyRef.vals[ci]!.v !== null);
  if (partial.length > 0) {
    warnings.push({
      code: 'partial-period-comparison',
      severity: 'warn',
      message: `the growth against '${pyRef.label}' of ${partial.map((c) => `'${c.label ?? c.id}'`).join(', ')} compares a partial period as if it were complete`,
      owner: { seriesId: pyRef.id },
      suggest: 'give the reference the same partial span (month to date against the same days last year), or say in the title that the period is still running',
    });
  }
  cats.forEach((category, ci) => {
    const reference = pyRef.vals[ci]!.v;
    if (!stacks[ci]!.hasValue || reference === null) return;
    const current = stackTotals[category.id]!;
    const displayedCurrent = roundedForDisplay(current);
    const displayedReference = roundedForDisplay(reference);
    // ROUND FOR DISPLAY, NEVER FOR DECISION (as the tornado in bar/layout.ts).
    // The growth figure is computed from the RAW totals, which the receipt this
    // panel publishes records as its operands, so a reader recomputing
    // annotation-diff-relative@1 over them gets the recorded output: 118.8 →
    // 164.4 is +38.4%, where the rounded 164 / 119 would give +37.8%.
    // The VALUE, its SIGN, and therefore the arrow and the tone are all cut on
    // the raw totals; only the printed magnitude is rounded. Where that makes
    // the printed growth disagree with what the reader gets by dividing the
    // two printed totals, the disagreement is DISCLOSED below rather than
    // manufactured away — the same trade the tornado ordering makes.
    // The suppression guard stays on the DISPLAYED reference on purpose: that
    // is not an arithmetic decision but a fail-closed display one —
    // a denominator that prints as 0 or negative is one the reader cannot use,
    // whatever the raw number behind it was.
    const growthPct =
      displayedReference > 0 && reference > 0 ? (current / reference - 1) * 100 : null;
    const displayedGrowthPct =
      growthPct === null ? null : roundedNumber(growthPct, growthSpec);
    const tone: 'good' | 'bad' | 'neutral' =
      growthPct === null || growthPct === 0
        ? 'neutral'
        : (growthPct > 0) === (integratedDirection === 'higherIsBetter')
          ? 'good'
          : 'bad';
    const text =
      growthPct === null || displayedGrowthPct === null
        ? 'n.m.'
        // A signed figure ("+6.1%"), no arrow; the tone carries the verdict.
        : `${growthPct > 0 ? '+' : growthPct < 0 ? '−' : ''}${growthFormatter(Math.abs(displayedGrowthPct))}`;
    pyGrowth.set(category.id, {
      categoryId: category.id,
      referenceSeriesId: pyRef.id,
      current,
      reference,
      displayedCurrent,
      displayedReference,
      growthPct,
      displayedGrowthPct,
      tone,
      text,
    });
    if (displayedReference <= 0) {
      warnings.push({
        code: 'ref-nonpositive',
        severity: 'warn',
        message: `category '${category.id}': displayed PY reference ${displayedReference} ≤ 0 — growth suppressed and marked n.m.`,
        owner: { categoryId: category.id, seriesId: pyRef.id },
      });
    }
    // the growth is now cut on the raw totals, so a reader who divides
    // the two totals the panel PRINTS can land on a different percentage.
    // That gap is a fact about the rounding, not an error — and it is
    // disclosed rather than left for the reader to discover by arithmetic.
    if (displayedGrowthPct !== null && displayedReference > 0) {
      const fromPrintedTotals = roundedNumber(
        (displayedCurrent / displayedReference - 1) * 100,
        growthSpec,
      );
      if (fromPrintedTotals !== displayedGrowthPct) {
        warnings.push({
          code: 'integrated-growth-rounding-gap',
          severity: 'info',
          message: `category '${category.id}': growth ${growthFormatter(displayedGrowthPct)} is computed from the unrounded totals; dividing the printed ${displayedCurrent} by the printed ${displayedReference} gives ${growthFormatter(fromPrintedTotals)}`,
          owner: { categoryId: category.id, seriesId: pyRef.id },
        });
      }
    }
  });
  return pyGrowth;
}

/**
 * The domain (includeZero forced true; reference values must be visible;
 * a drawn value line is part of the stated range), and every value the
 * exhibit renders, in draw order, for the break check.
 */
function columnValueDomain(
  va: ValueAxisOptions,
  variant: ColumnVariant,
  cats: Category[],
  dataSeries: NormSer[],
  refSeries: NormSer[],
  plottedOf: ColumnDomain['plottedOf'],
  rangeOf: ColumnDomain['rangeOf'],
  stacks: ColumnDomain['stacks'],
  lineExtent: ValueLineExtent | null,
  warnings: LintWarning[],
): { posTopP: number[]; negBotP: number[]; dLo: number; dHi: number; stepTicks?: number[]; rendered: number[] } {
  const stackedLike = variant !== 'grouped';
  const rendered: number[] = [];
  const posTopP: number[] = [];
  const negBotP: number[] = [];
  // The extent carries the structural baseline (0) and every drawn value line:
  // an authored bound only WIDENS the domain here (see valueLineDomain.ts), so
  // seeding the line makes it visible instead of refusing it.
  let lo = Math.min(0, lineExtent?.lo ?? 0);
  let hi = Math.max(0, lineExtent?.hi ?? 0);
  cats.forEach((_, ci) => {
    const stack = stacks[ci]!;
    let p = stackedLike ? stack.positive : 0;
    let n = stackedLike ? stack.negative : 0;
    for (let si = 0; si < dataSeries.length; si++) {
      const s = dataSeries[si]!;
      const v = plottedOf(s, ci);
      if (v === null) continue;
      const start = stackedLike ? stack.segments[si]!.start : 0;
      const range = rangeOf(s, ci);
      rendered.push(stackedLike ? stack.segments[si]!.end : v);
      if (range) {
        lo = Math.min(lo, start + range.low, start + range.high);
        hi = Math.max(hi, start + range.low, start + range.high);
        rendered.push(start + range.low, start + range.high);
        if (range.mid !== undefined) rendered.push(start + range.mid);
      }
      if (!stackedLike) {
        p = Math.max(p, v);
        n = Math.min(n, v);
      }
    }
    posTopP[ci] = p;
    negBotP[ci] = n;
    lo = Math.min(lo, n);
    hi = Math.max(hi, p);
  });
  // A 100% composition axis carries shares, not absolutes: reference values
  // have no honest position there (a random plan would land at plan/total %),
  // so refs neither stretch the domain nor render — warned once below.
  if (variant !== 'stacked100') {
    for (const s of refSeries) {
      cats.forEach((_, ci) => {
        const v = plottedOf(s, ci);
        if (v === null) return;
        rendered.push(v);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      });
    }
  } else {
    if (refSeries.some((s) => s.vals.some((val) => val.v !== null))) {
      warnings.push({
        code: 'reference-unsupported-stacked100',
        severity: 'warn',
        message:
          'reference series omitted: a 100% axis shows composition, not level — show plan/PY targets on the absolute companion chart',
      });
    }
  }
  let dLo: number;
  let dHi: number;
  if (variant === 'stacked100') {
    dLo = Math.min(0, lo);
    dHi = Math.max(100, hi);
  } else {
    let lo2 = lo < 0 ? lo * 1.08 : 0; // label headroom below negatives
    let hi2 = hi > 0 ? hi * 1.08 : 0; // label headroom above positives
    if (lo2 === 0 && hi2 === 0) hi2 = 1;
    // lo/hi start at 0, so the extent already carries the structural baseline;
    // the bound keeps snap overshoot from manufacturing dead plot bands the
    // hidden-by-default axis never explains (domain-economy invariant).
    // Mixed-sign domains snap BOTH edges, so the raw-mark envelope can drop to
    // 0.70 while each side clears the 0.15 cap. The ink-envelope gate measures
    // marks PLUS value labels, and the label band over the extreme bars is what
    // carries the shapes the snap leaves wide. Capping the SUM here instead
    // would crush the label air over small-magnitude extremes and cost their
    // value labels (never lose a label) for geometry.
    [dLo, dHi] = niceDomain(lo2, hi2, 5, {
      dataExtent: [lo, hi],
      maxWasteFraction: 0.15,
    });
  }
  // user min/max may never clip data
  [dLo, dHi] = applyAxisBounds([dLo, dHi], [Math.min(lo, 0), Math.max(hi, 0)], va, warnings);
  // An authored tick step sets the tick rhythm, as on line: the domain snaps
  // out to the step, so no value is cut; more than 20 intervals are ignored.
  const step = va.tickStep;
  if (step !== undefined && step > 0) {
    const from = Math.floor(dLo / step + 1e-9);
    const to = Math.ceil(dHi / step - 1e-9);
    if (to - from >= 1 && to - from <= 20) {
      const stepTicks = Array.from({ length: to - from + 1 }, (_, i) => Number(((from + i) * step).toFixed(10)));
      return { posTopP, negBotP, dLo: stepTicks[0]!, dHi: stepTicks.at(-1)!, stepTicks, rendered };
    }
    warnings.push({
      code: 'tick-step-ignored', severity: 'warn',
      message: `valueAxis.tickStep ${step} would draw ${to - from} intervals over the value domain; the nice ticks are drawn instead`,
      suggest: 'pick a step that gives 1 to 20 intervals',
    });
  }
  return { posTopP, negBotP, dLo, dHi, rendered };
}

/** The value-axis break, validated against every value the exhibit renders. */
function columnAxisBreak(
  options: AnomalyColumnOptions,
  anomaly: AnomalyModel | undefined,
  renderedBreakValues: number[],
  meanValue: number | undefined,
  averageMark: number | undefined,
  corridorShown: ColumnDomain['corridorShown'],
  dLo: number,
  dHi: number,
  warnings: LintWarning[],
): LinearBreak | undefined {
  const va = options.valueAxis ?? {};
  // What drew each value that is not data, so a refusal names its cause.
  const drawnBy = new Map<number, string>();
  const add = (value: number, cause: string) => {
    renderedBreakValues.push(value);
    if (!drawnBy.has(value)) drawnBy.set(value, cause);
  };
  for (const annotation of options.annotations ?? []) {
    if (annotation.kind === 'valueLine') {
      const value = annotation.value === undefined || annotation.value === 'mean' ? meanValue : annotation.value;
      if (value !== undefined) add(value, typeof annotation.value === 'number' ? 'the valueLine annotation' : 'the valueLine annotation (its default value is the mean)');
    } else if (annotation.kind === 'indicator100') {
      add(100, 'the indicator100 annotation');
    }
  }
  if (averageMark !== undefined) add(averageMark, 'options.averageMarker');
  if (corridorShown.low && anomaly?.corridor?.low != null) add(anomaly.corridor.low, 'the options.anomaly corridor');
  if (corridorShown.high && anomaly?.corridor?.high != null) add(anomaly.corridor.high, 'the options.anomaly corridor');
  if (va.break && anomaly) {
    // A corridor read across a broken axis is not readable honestly: the two
    // sides of the break carry different pixel-per-unit, so "how far outside"
    // stops being a distance. The corridor is the feature; the break goes.
    warnings.push({
      code: 'anomaly-axis-break-ignored',
      severity: 'warn',
      message: 'valueAxis.break dropped: a deviation corridor cannot be read across a broken value axis',
      suggest: 'drop valueAxis.break, or drop options.anomaly and keep the break',
    });
  } else if (va.break) {
    const reason = breakStyleRefusal(va.break) ?? invalidLinearBreakReason([dLo, dHi], va.break, renderedBreakValues, (value) => drawnBy.get(value));
    if (reason) warnings.push(axisBreakInvalid('column', reason));
    else return { from: va.break.from, to: va.break.to };
  }
  return undefined;
}

/** The annotation list: the authored ones, the average marker, indicator100 default-on for stacked100. */
function columnAnnotationList(
  options: AnomalyColumnOptions,
  variant: ColumnVariant,
  averageMark: number | undefined,
  statFmt: (v: number) => string,
  span: string | undefined,
): Annotation[] {
  let annList: Annotation[] = options.annotations ?? [];
  if (averageMark !== undefined) {
    // The label sits above the line at the plot's left edge, so the plot keeps
    // the full width instead of a right gutter for the label.
    // When the data leave it no seat there, the re-run that reserves the right
    // margin (VALUE_LINE_RESERVE) seats it at the line's right end.
    const side = (options as { [VALUE_LINE_RESERVE]?: number })[VALUE_LINE_RESERVE] ? 'right' : 'left';
    annList = [...annList, { ...averageMarkerLine(annList, averageMark, statFmt, span, options.strings?.average), side }];
  }
  // A drawn value axis prints 100 % already; a second 100 % beside it is a stray tick.
  if (
    variant === 'stacked100' &&
    kindSetting(options, 'percentIndicator') !== false &&
    options.valueAxis?.show !== true &&
    !annList.some((a) => a.kind === 'indicator100')
  ) {
    // Sentinel id + endpoint-band priority: engine furniture is identifiable
    // in geometry output and informs (never warns) when squeezed out — see
    // line's auto-add.
    annList = [
      ...annList,
      { kind: 'indicator100', side: 'right', id: 'indicator100-auto', priority: PRIORITY.endpoint },
    ];
  }
  return annList;
}

/** Phase 1: data and options in, the plotted values and the value domain out. */
export function resolveColumnDomain(data: ChartData, options: AnomalyColumnOptions, warnings: LintWarning[]): ColumnDomain {
  const env = resolveColumnEnv(options, warnings);
  const normalized = normalizeColumnData(data, warnings);
  const { seriesNorm } = normalized;
  // Exhibit-wide format raster: style from the example, ONE
  // precision for every value label, decided over the plotted values — "53"
  // never sits beside "52.2", and an all-integer series never carries
  // an example's dead ".0".
  // valueAxis.percent converts to stacked100.
  const variant: ColumnVariant = options.valueAxis?.percent ? 'stacked100' : (options.variant ?? 'grouped');
  // Stacked series share one precision: a stack reads as one set ("12.0" over "10.0").
  const valueSpec = rasterFormatter(options.format, seriesNorm.map((s) => [s.id, s.vals.map((val) => val.v), s.vals.map((val) => val.range ? [val.range.low, val.range.high, val.range.mid] : null)]), options.locale?.language, options.unit, options.target, variant !== 'grouped');
  const fmt = valueSpec.fmt;
  // Derived statistics (medians, MADs, corridor bounds, averages) keep their
  // own precision inside the exhibit's style: an integer-rastered chart still
  // prints its mean as "Ø 27.5", never "Ø 28" (see formatStatWithSpec).
  const statFmt = (v: number) => formatStatWithSpec(v, valueSpec.spec);
  const plotted = seriesNorm.filter((s) => s.role !== 'reference');
  const refSeries = seriesNorm.filter((s) => s.role === 'reference');
  if (plotted.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'column requires at least one data-role series');
  }
  // The variant is resolved before sort/topN because the refusals must fire first.
  const signColor = options.signColor === true;
  refuseColumnEncodings(variant, signColor, options.anomaly, plotted);
  // Read before topN: the Others cell is a sum, never a typed percent cell.
  const pctLevels = percentLevels(plotted);
  const { cats, dataSeries, othersId } = orderColumnCategories(options, normalized.cats, seriesNorm, plotted, warnings);
  const lostDetails = othersId === null ? undefined : restDetailsWarning(data, new Set(cats.map((c) => c.id)));
  if (lostDetails) warnings.push(lostDetails);
  const stackedLike = variant !== 'grouped';
  const { pyRef, uniformScenario } = columnScenarios(options, variant, cats, dataSeries, refSeries, warnings);
  const lines = columnLines(options, stackedLike, dataSeries, warnings, cats.some((cat) => cat.total100 !== undefined));
  const va = options.valueAxis ?? {};
  // A window or zoom draws some periods; the anomaly rule, the mean and the
  // average marker below keep every source period, as on line and combo.
  const viewportOn = options.window !== undefined || options.viewDomain !== undefined;
  if (viewportOn) refuseUnorderedViewport(options, othersId);
  const ribbons = columnRibbons(options, variant, stackedLike, dataSeries, warnings);
  const computedTotal = variant === 'stacked100' ? weightedTotal(cats, dataSeries, warnings) : undefined;
  const ranked = ribbons.ribbonsOn && ribbons.ribbonRank;
  const source = columnBasis(variant, cats, dataSeries, viewportOn ? [] : warnings, ranked);
  let anomaly: AnomalyModel | undefined;
  let anomalyValues: number[] = [];
  if (options.anomaly) {
    ({ anomaly, values: anomalyValues } = columnAnomalyModel(options.anomaly, cats, dataSeries[0]!, source.absOf, fmt, statFmt, options.locale?.language, warnings, options.strings));
  }
  // a stack of percents of different wholes has no total to print,
  // anchor on or average.
  const addsOver = (series: NormSer[]) => !stackedLike
    || stackAdds(series.map((s) => ({ label: s.label, unit: s.unit, pctCells: s.vals.some((val) => val.isPct) })), options.unit, options.sharesOfOneWhole);
  const partsAdd = addsOver(dataSeries);
  const meanValue = partsAdd ? plottedMean('all', stackedLike, cats.length, dataSeries, (series, _, ci) => source.plottedOf(series, ci)) : undefined;
  const averageMarkerScope =
    typeof options.averageMarker === 'object' ? options.averageMarker.scope : 'all';
  const averageMarkerRequested = options.averageMarker !== undefined && options.averageMarker !== false &&
    !averageOfWholeShares(variant, averageMarkerScope, warnings) &&
    !averageOfUnaddedSums(addsOver(averageMarkerScope === 'all' ? dataSeries : dataSeries.filter((s) => averageMarkerScope.includes(s.id))), warnings);
  const averageMark = averageMarkerRequested
    ? plottedMean(averageMarkerScope, stackedLike, cats.length, dataSeries, (series, _, ci) => source.plottedOf(series, ci))
    : undefined;
  if (averageMarkerRequested && averageMark === undefined) {
    warnings.push({
      code: 'average-marker-empty',
      severity: 'warn',
      message: 'averageMarker scope has no plotted values; marker omitted',
    });
  }
  const population = viewportOn
    ? applyCategoryViewport({ domain: options.viewDomain, window: options.window, categories: cats, series: seriesNorm,
      plotted: [], basis: [], targets: [], annotations: options.annotations })
    : undefined;
  if (population) options = liveWindowOptions({ ...options, annotations: population.annotations }, population.sampling);
  const meanSpan = viewportMeanSpan(population);
  const basis = population ? columnBasis(variant, cats, dataSeries, warnings, ranked) : source;
  // The reconciliation face of the exhibit raster: the reader-facing rounding
  // IS valueSpec.spec, so display math re-derives through the same spec.
  const pyGrowth = pyRef
    ? integratedVarianceValues(pyRef, cats, dataSeries, basis.stackTotals, basis.stacks, (value) => roundedNumber(value, valueSpec.spec), warnings, options.locale?.language)
    : new Map<Id, IntegratedValue>();
  // A drawn value line is part of the stated range (valueLineDomain.ts).
  const lineExtent = valueLineExtent(options.annotations);
  const { rendered, ...extent } = columnValueDomain(va, variant, cats, dataSeries, refSeries, basis.plottedOf, basis.rangeOf, basis.stacks, lineExtent, warnings);
  const corridor = anomalyCorridor(anomaly, anomalyValues, extent.dLo, extent.dHi, statFmt, warnings, options.strings);
  // No total on a 100 % stack unless authored, and none on grouped
  // columns, where the bars stand side by side and add to nothing.
  const grandTotalsRequested = grandTotalRequested(options.grandTotalLabels, variant, warnings, partsAdd);
  const gtContent = grandTotalsRequested ? contentOf(options, 'grandTotal', ['absolute']) : null;
  if (options.grandTotalLabels === true && options.labels === false && grandTotalsRequested) {
    warnings.push({
      code: 'grand-total-labels-off',
      severity: 'warn',
      message: 'grandTotalLabels is true, but labels: false turns the grand totals off. Use a labels setting that leaves grand totals on: omit labels, or set labels to an object that does not set grandTotal to false.',
      suggest: 'Omit labels, or set labels.grandTotal to true and turn other label kinds off by name.',
    });
  }
  const sharesOn = variant === 'stacked100' && contentOf(options, 'segment', ['percent'])?.includes('percent') === true;
  warnIncompleteStacks(variant, cats, basis.incompleteCats, gtContent !== null, sharesOn, 'columns', warnings, disclosuresShown(options));
  // Every computed share the chart prints takes one precision.
  const shareSet = shareSetFormatter(cats.flatMap((_, ci) => dataSeries.flatMap((s) =>
    s.vals[ci]!.isPct ? [] : basis.shareOf(s, ci) ?? [])), options.locale?.language);
  // Computed shares only: an authored percent or total100 is the author's number.
  const wholes = sharesOn ? cats.flatMap((c, ci) =>
    basis.nmCats100.has(c.id) || basis.naCats100.has(c.id) || basis.incompleteCats.has(c.id) ||
    c.total100 !== undefined || dataSeries.some((s) => s.vals[ci]!.isPct)
      ? []
      : [{ c, parts: dataSeries.flatMap((s) => { const share = basis.plottedOf(s, ci); return share === null ? [] : [{ s, share }]; }) }]) : [];
  // rounding 'sum-consistent' (the default): each complete stack's shares print so they add up to 100%,
  // at the chart's one share precision (or shareLabels.format's).
  const shareTexts = new Map<string, string>();
  const roundingAdjustments: RoundingAdjustment[] = [];
  if (options.rounding !== 'nearest') {
    const spec = options.shareLabels?.format ? parseFormatExample(options.shareLabels.format) : undefined;
    for (const { c, parts } of wholes) {
      const rounded = sumConsistentShares(parts.map((part) => part.share), options.locale?.language, spec && withChartMarks(spec, options.locale?.language), shareSet.decimals);
      if (rounded?.warning) warnings.push(roundingUnavailable(c.label ?? c.id, rounded.warning));
      else if (rounded) parts.forEach((part, index) => {
        shareTexts.set(shareKey(c.id, part.s.id), rounded.texts[index]!);
        if (rounded.moved[index]) roundingAdjustments.push({ whole: c.label ?? c.id, part: part.s.label, share: Math.round(part.share * 1e4) / 1e4,
          nearest: spec ? formatWithSpec(part.share, withChartMarks(spec, options.locale?.language)) : shareSet.format(part.share), printed: rounded.texts[index]! });
      });
    }
  } else if (sharesOn) {
    warnShareRoundingDrift(warnings, wholes.map(({ c, parts }) => ({ name: c.label ?? c.id, shares: parts.map((part) => part.share), decimals: shareSet.decimals })));
  }
  let activeBreak = columnAxisBreak(options, anomaly, rendered, meanValue, averageMark, corridor.corridorShown, extent.dLo, extent.dHi, warnings);
  // An authored step keeps its rhythm across a break only while each side keeps an inner tick, not its end tick alone.
  let { stepTicks, ...span } = extent;
  const checked = activeBreak;
  const stepAcross = !stepTicks || !checked
    || (stepTicks.filter((v) => v < checked.from).length >= 2 && stepTicks.filter((v) => v > checked.to).length >= 2);
  if (!stepAcross) {
    warnings.push({
      code: 'tick-step-ignored', severity: 'warn',
      message: `valueAxis.tickStep ${va.tickStep} leaves one side of the axis break with only its end tick; the break's own ticks are drawn instead`,
      suggest: 'pick a smaller tickStep, or drop the axis break',
      field: ['options', 'valueAxis', 'tickStep'],
    });
    // The rejected step sets no extent either: the nice extent is taken again and the break checked against it.
    // A break excludes the anomaly corridor, so the corridor does not move. Its warnings were given above.
    const { tickStep: _rejected, ...nice } = va;
    const { rendered: niceRendered, ...niceExtent } = columnValueDomain(nice, variant, cats, dataSeries, refSeries, basis.plottedOf, basis.rangeOf, basis.stacks, lineExtent, []);
    ({ stepTicks, ...span } = niceExtent);
    // A break that only the step's extent held is dropped with a warn: the chart drew with it before, so it does not refuse now.
    const checks: LintWarning[] = [];
    activeBreak = columnAxisBreak(options, anomaly, niceRendered, meanValue, averageMark, corridor.corridorShown, span.dLo, span.dHi, checks);
    warnings.push(...checks.map((warning) => warning.code === 'axis-break-invalid'
      ? { ...warning, severity: 'warn' as const, message: `${warning.message}; the chart is drawn without the break` } : warning));
  }
  return {
    // The shares print at the chart's one precision ("9%" beside "50%"), unless shareLabels.format sets one.
    ...env, ...(options.shareLabels?.format ? {} : { pctFmt: shareSet.format }), shareTexts, roundingAdjustments, options, cats, seriesNorm, dataSeries, refSeries, othersId, valueSpec, fmt, totalFmt: stackTotalFormatter(variant, valueSpec.spec, fmt), statFmt, variant,
    refStyle: options.referenceStyle ?? 'tick', signColor, pyRef, pyGrowth,
    uniformScenario, pctLevels, ...lines, ...ribbons, computedTotal, va, ...basis, anomaly, ...span, ...(stepTicks && stepAcross ? { stepTicks } : {}), meanValue, averageMark, meanSpan, ...corridor,
    activeBreak,
    gtContent,
    partsAdd,
    ...(partsAdd ? {} : { meanMissing: NO_STACK_MEAN }),
    annList: columnAnnotationList(options, variant, averageMark, !options.format && (variant === 'stacked100' || options.unit === '%' || pctLevels)
      ? (v: number) => formatStatWithSpec(v, { ...valueSpec.spec, suffix: '%' }) : statFmt, meanSpan()),
    seriesCagr: stackedLike ? seriesCagrs(options, cats, dataSeries, basis.absOf, warnings) : new Map(),
  };
}

/**
 * Series CAGR: each series named at the
 * right edge carries its compound annual growth over the span, and each rate
 * gets the claim record an annotation CAGR gets, so verify can recompute it.
 */
function seriesCagrs(
  options: AnomalyColumnOptions,
  cats: Category[],
  dataSeries: NormSer[],
  absOf: (s: NormSer, ci: number) => number | null,
  warnings: LintWarning[],
): Map<Id, { text: string; placed: PlacedAnnotation }> {
  const out = new Map<Id, { text: string; placed: PlacedAnnotation }>();
  const asked = options.seriesLabels?.cagr;
  if (!asked) return out;
  const span = asked === true ? {} : asked;
  const warn = (code: string, message: string, suggest: string) => warnings.push({ code, severity: 'warn', message, suggest });
  const fi = span.from === undefined ? 0 : cats.findIndex((c) => c.id === span.from);
  const ti = span.to === undefined ? cats.length - 1 : cats.findIndex((c) => c.id === span.to);
  if (fi < 0 || ti < 0) {
    warn('series-cagr-no-span', `seriesLabels.cagr names a category that is not in the data: '${fi < 0 ? span.from : span.to}'; no series CAGR is printed`, 'use category ids for from and to');
    return out;
  }
  const from = cats[fi]!;
  const to = cats[ti]!;
  const years = yearSpan(from.date, to.date) ?? yearSpanFromLabels(from.label, to.label);
  if (from.partial || to.partial || years === null || years <= 0) {
    warn(
      'series-cagr-no-span',
      `seriesLabels.cagr from '${from.label ?? from.id}' to '${to.label ?? to.id}' ${from.partial || to.partial ? 'ends on a partial period' : 'spans no measured years'}; no series CAGR is printed`,
      'give the categories ISO dates or year-bearing labels, and anchor the span on complete periods',
    );
    return out;
  }
  const spec = typeof span === 'object' && span.format !== undefined ? withChartMarks({ ...parseFormatExample(span.format), signed: true }, options.locale?.language) : undefined;
  const only = options.seriesLabels?.only === undefined ? undefined : new Set(options.seriesLabels.only);
  for (const s of dataSeries) {
    if (only && !only.has(s.id)) continue;
    const a = absOf(s, fi);
    const b = absOf(s, ti);
    const rate = a === null || b === null ? null : cagr(a, b, years);
    if (rate === null) {
      warn('series-cagr-undefined', `'${s.label}' has no CAGR from '${from.label ?? from.id}' to '${to.label ?? to.id}': a missing value, a start at or below zero or a negative end; its name prints alone`, 'label the growth of this series in the text, or leave it out of seriesLabels.only');
      continue;
    }
    // A span narrower than the chart names its period, as a CAGR annotation's label does.
    const period = fi !== 0 || ti !== cats.length - 1 ? ` ${from.label ?? from.id}–${to.label ?? to.id}:` : '';
    const text = `${s.label}${period} ${spec ? formatWithSpec(rate, spec) : formatAutomaticPercent(rate, 1, true, options.locale?.language)} p.a.`;
    const ref = (end: string, category: Category) => `${end}:categoryId=${category.id}/seriesId=${s.id}`;
    out.set(s.id, {
      text,
      placed: {
        id: `seriesCagr:${s.id}`,
        kind: 'cagr',
        computedText: text,
        nodeIds: [],
        labelId: `seriesEdge:${s.id}`,
        derivation: {
          basis: 'derived',
          op: 'annotation-cagr@1',
          inputs: [
            { ref: ref('from', from), value: a },
            { ref: ref('to', to), value: b },
            { ref: 'years', value: years, state: `${from.date ?? from.label ?? from.id} → ${to.date ?? to.label ?? to.id}` },
          ],
          raw: rate,
        },
      },
    });
  }
  return out;
}

/**
 * A window keeps the last periods and a zoom a span of them; both need the
 * periods in their own order, which a category sort or a topN bucket breaks.
 */
function refuseUnorderedViewport(options: AnomalyColumnOptions, othersId: Id | null): void {
  const sorted = options.sort?.categories !== undefined && options.sort.categories !== 'sheet';
  if (!sorted && othersId === null && !options.topN) return;
  const field = options.window !== undefined ? 'options.window' : 'options.viewDomain';
  throw new NormalizeError(
    'viewport-unordered',
    field,
    `${field.slice('options.'.length)} keeps a span of periods in their own order; ${sorted ? `sort.categories '${options.sort!.categories}'` : 'topN'} reorders or folds the categories`,
    `drop ${sorted ? 'sort.categories' : 'topN'}, or drop ${field.slice('options.'.length)}`,
  );
}

type RasterFormatter = ReturnType<typeof seriesRasterFormatter>;
const rasterFormatters = new Map<string, RasterFormatter>();

/** A formatter's texts, kept per value: a chart prints the same few values in every pass. */
function remembered(format: (value: number) => string): (value: number) => string {
  const texts = new Map<number, string>();
  return (value) => {
    let text = texts.get(value);
    if (text === undefined) texts.set(value, text = format(value));
    return text;
  };
}

/**
 * The exhibit formatter for one set of inputs, shared by every layout pass
 * of the same chart. The sizing search lays a column chart out many times
 * (more than a hundred passes at a 320 px card), and each pass formatted
 * the same values again. The texts depend on these inputs only.
 */
function rasterFormatter(example: string | undefined, seriesValues: [string, (number | null)[], unknown[]][], locale: string | undefined, unit: string | undefined, target: RenderTarget | undefined, shared: boolean): RasterFormatter {
  // Keyed by each series' id, values and range ends, not the flat list: a series' own precision reads all of them.
  const key = JSON.stringify([example, locale, unit, target, currentSmallValues(), seriesValues, shared]);
  const known = rasterFormatters.get(key);
  if (known) return known;
  const made = seriesRasterFormatter(example, seriesValues.flatMap(([, values]) => values), locale, unit, target, undefined, shared);
  const bySeries = new Map<string, (value: number) => string>();
  const formatter: RasterFormatter = {
    ...made,
    fmt: remembered(made.fmt),
    fmtSigned: remembered(made.fmtSigned),
    fmtPercent: remembered(made.fmtPercent),
    forSeries: (series, cellFormat) => {
      // Keyed by series too: an unstacked series takes its own precision.
      const seriesKey = JSON.stringify([(series as { id?: string }).id, series.format, series.unit, cellFormat]);
      let format = bySeries.get(seriesKey);
      if (!format) bySeries.set(seriesKey, format = remembered(made.forSeries(series, cellFormat)));
      return format;
    },
  };
  if (rasterFormatters.size >= 64) rasterFormatters.clear();
  rasterFormatters.set(key, formatter);
  return formatter;
}

/** Gap between the edge column and the names beside it. */
export const RIGHT_EDGE_GAP = 8;

/**
 * An edge series name of a 100% stack prints at the theme's heading weight.
 * A plain stacked chart keeps its names regular.
 */
export function edgeNameFont<F extends { weight?: number | string }>(labelFont: F, domain: Pick<ColumnDomain, 'theme' | 'variant'>): F {
  return domain.variant === 'stacked100' ? { ...labelFont, weight: headingWeight(domain.theme) } : labelFont;
}

/**
 * The stacked series that carry a name at the right edge of the last column
 * or the left edge of the first, in stack order. Empty unless
 * `seriesLabels` asked for them and the chart is stacked: a grouped chart has
 * no single edge to name. Where the names replace the key
 * (`edgeNamesReplaceKey`) but do not fit, they are off and the key names the series.
 */
export function rightEdgeSeriesLabels(domain: ColumnDomain): { id: Id; label: string }[] {
  return edgePlan(domain).names;
}

/**
 * Whether the key leaves out the series the edge names: a chart that draws
 * a key and names every series at the edge keys only what the names do not
 * explain, such as a forecast hatch.
 * A grid panel leaves its key to the grid; a subset of names keeps the
 * whole key, and so does a chart with no key position of its own.
 */
export function edgeNamesReplaceKey(domain: ColumnDomain): boolean {
  return edgePlan(domain).replaceKey;
}

/** Internal: the key keeps every series although the edge names them, because a name lost its seat. */
export const KEY_EDGE_SERIES = Symbol('keyEdgeSeries');

interface EdgePlan { names: { id: Id; label: string }[]; replaceKey: boolean }
const edgePlans = new WeakMap<ColumnDomain, EdgePlan>();

function edgePlan(domain: ColumnDomain): EdgePlan {
  let plan = edgePlans.get(domain);
  if (!plan) edgePlans.set(domain, plan = planEdgeNames(domain));
  return plan;
}

function planEdgeNames(domain: ColumnDomain): EdgePlan {
  const { options } = domain;
  const authored = options.seriesLabels;
  if (authored === undefined || domain.variant === 'grouped') return { names: [], replaceKey: false };
  const only = authored.only === undefined ? undefined : new Set(authored.only);
  // With seriesLabels.cagr the printed name carries the series' rate.
  const names = domain.dataSeries.filter((series) => only === undefined || only.has(series.id))
    .map((series) => ({ id: series.id, label: domain.seriesCagr.get(series.id)?.text ?? series.label }));
  const keyed = options.legend !== undefined && options.legend !== 'none' &&
    panelTypeClass(options) === undefined && (options as { [KEY_EDGE_SERIES]?: true })[KEY_EDGE_SERIES] !== true;
  if (!keyed || names.length === 0 || names.length < domain.dataSeries.length) return { names, replaceKey: false };
  // The names take their room from the columns. They stand where that room
  // is at most one column step; on a narrower card the key names the series.
  const { theme, measure, size } = domain;
  const labelFont = edgeNameFont({ family: theme.type.family, ...theme.type.label }, domain);
  const gutter = maxOf(names.map((series) => measure(series.label, labelFont).width)) + RIGHT_EDGE_GAP;
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const axis = domain.va.show ? measureValueAxisWidth([domain.dLo, domain.dHi], domain.fmt, theme, measure, 5, domain.valueSpec.spec, domain.stepTicks) : 0;
  const step = (size.width - margin.left - margin.right - axis) / Math.max(1, domain.cats.length);
  return gutter <= step ? { names, replaceKey: true } : { names: [], replaceKey: false };
}

/** The key of a share printed under rounding 'sum-consistent'. */
export function shareKey(categoryId: string, seriesId: string): string {
  return `${categoryId}\0${seriesId}`;
}

/** A segment's printed share: its sum-consistent text, else the chart's share format. */
export function shareTextOf(domain: Pick<ColumnDomain, 'shareTexts' | 'pctFmt' | 'authoredPctFmt'>, categoryId: string, seriesId: string, pct: number, authored: boolean): string {
  return authored ? domain.authoredPctFmt(pct) : domain.shareTexts.get(shareKey(categoryId, seriesId)) ?? domain.pctFmt(pct);
}
