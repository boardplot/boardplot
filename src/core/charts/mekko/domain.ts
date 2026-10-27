/**
 * Mekko phase 1: options and data in, categories in their final
 * order, the plotted series, the stacks, the column weights and the value
 * domain out. Nothing here knows a pixel.
 */

import { compositionBasis, mixedSignsWarning, overfullShareSum, overfullWarning } from '../band/stacks';
import { mekkoAmount, poolMekkoAmounts, restLabel, restSum, topNCut } from '../topN';
import { cellFields, normalizeCategorySeries } from '../categorySeries';
import { breakUnsupported, chartPalette, chartTheme } from '../chartEnv';
import { defaultMeasurer } from '../../text';
import { formatAuthoredPercent, formatAutomaticNumber, formatShare, shareSetFormatter } from '../../format';
import { formatterFromExample, parseFormatExample, specUnitKind } from '../../formatSpec';
import { round2 } from '../../geometry';
import { isIncomplete } from '../../dataGaps';
import { roundWholes } from '../../shareRounding';
import {
  NormalizeError,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { applyAxisBounds, niceDomain } from '../../scale';
import { type Id } from '../../types/cell';
import type { Category, ChartData } from '../../types/data';
import type { MekkoOptions } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import { valueLineExtent } from '../../valueLineDomain';
import type { MekkoDomain, MekkoEnv, NormSer } from './model';
import { maxOf, minOf, pushAll } from '../../arrays';

/** Resolve the options once: theme, palette, size, measurer and the number formats. */
export function resolveMekkoEnv(options: MekkoOptions, warnings: LintWarning[]): MekkoEnv {
  breakUnsupported('mekko', options, warnings);
  const theme = chartTheme(options);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  // Business default: whole numbers get 0 decimals; small non-integers keep
  // one, so a 0.4 sliver never prints as "0". (waterfall's autoDecimals)
  const autoDecimals = (v: number) => (Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : 1);
  const lang = options.locale?.language;
  const plainFmt = (v: number) => formatAutomaticNumber(v, { locale: lang, decimals: autoDecimals(v) });
  const percentExample = options.format && specUnitKind(parseFormatExample(options.format)) === 'percent';
  const sharesOnly = percentExample && ((options.variant ?? 'stacked100') === 'stacked100' || options.valueAxis?.percent);
  return {
    options,
    theme,
    palette: paletteRamp ? options.palette : undefined,
    size: resolveSize(options.size),
    measure: options.measure ?? defaultMeasurer,
    fmt: options.format && !sharesOnly ? formatterFromExample(options.format, lang) : plainFmt,
    widthFmt: plainFmt,
    pctFmt: percentExample ? formatterFromExample(options.format!, lang) : (p: number) => formatShare(p, lang),
    authoredPctFmt: percentExample ? formatterFromExample(options.format!, lang) : (p: number) => formatAuthoredPercent(p, lang),
    highlights: new Set(resolveHighlight(options.highlight)),
    density: options.labelDensity ?? 'smart',
    va: options.valueAxis ?? {},
  };
}

function normalizeMekkoData(data: ChartData): { cats: Category[]; seriesNorm: NormSer[] } {
  const { cats, series } = normalizeCategorySeries('mekko', data, (s, cells): NormSer => ({
    id: s.id,
    label: s.label ?? s.id,
    role: s.role ?? 'data',
    scenario: normalizeScenario(s.scenario as string | undefined, `series[${s.id}].scenario`),
    colorRole: s.colorRole,
    fill: s.fill,
    format: s.format,
    ...(s.unit === undefined ? {} : { unit: s.unit }),
    vals: cells.map((cell, ci) => cellFields(cell, `series[${s.id}].values[${ci}]`)),
  }));
  return { cats, seriesNorm: series };
}

/** The public variant names the internal stacking mode. */
const VARIANT_MODE = { stacked100: 'percent', stacked: 'unit', bar: 'bar' } as const satisfies Record<string, MekkoDomain['mode']>;

/** The mode, the width series and the plotted data series, each refusal said out loud. */
function mekkoSeriesRoles(options: MekkoOptions, seriesNorm: NormSer[], warnings: LintWarning[]) {
  let mode: MekkoDomain['mode'] = VARIANT_MODE[options.variant ?? 'stacked100'];
  if (options.valueAxis?.percent && mode === 'unit') mode = 'percent';
  let widthSer: NormSer | null = null;
  if (options.widthSeriesId) {
    widthSer = seriesNorm.find((s) => s.id === options.widthSeriesId) ?? null;
    if (!widthSer) {
      warnings.push({
        code: 'unknown-width-series',
        severity: 'warn',
        message: `widthSeriesId '${options.widthSeriesId}' not found — using category totals`,
      });
    }
  }
  const refSeries = seriesNorm.filter((s) => s.role === 'reference' && s !== widthSer);
  if (refSeries.length > 0) {
    warnings.push({
      code: 'reference-ignored',
      severity: 'info',
      message: `mekko does not plot reference series (${refSeries.map((s) => s.id).join(', ')})`,
    });
  }
  let series = seriesNorm.filter((s) => s.role !== 'reference' && s !== widthSer);
  if (series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'mekko requires at least one data-role series');
  }
  if (mode === 'bar' && series.length > 1) {
    warnings.push({
      code: 'bar-mekko-extra-series',
      severity: 'warn',
      message: `bar-mekko plots a single data series — using '${series[0]!.id}', ignoring ${series
        .slice(1)
        .map((s) => s.id)
        .join(', ')}`,
    });
    series = series.slice(0, 1);
  }
  if (mode === 'bar' && !widthSer) {
    warnings.push({
      code: 'bar-mekko-no-width-series',
      severity: 'info',
      message: 'bar-mekko without widthSeriesId — columns get equal widths',
    });
  }
  return { mode, widthSer, series };
}

/**
 * Categories reorder in place (sort, topN), so the per-index helpers read the
 * current category list: they are usable before AND after the reorder.
 */
interface ValueState {
  mode: MekkoDomain['mode'];
  cats: Category[];
  series: NormSer[];
  widthSer: NormSer | null;
  nm: Set<Id>;
  na: Set<Id>;
}

function valueFns(st: ValueState) {
  const invalidAt = (ci: number): boolean =>
    st.mode === 'percent' && (st.nm.has(st.cats[ci]!.id) || st.na.has(st.cats[ci]!.id));
  const basisAt = (ci: number): number => {
    const c = st.cats[ci]!;
    if (c.total100 !== undefined) return c.total100;
    return st.series.reduce((a, s) => {
      const val = s.vals[ci]!;
      return a + (val.isPct || val.v === null ? 0 : val.v);
    }, 0);
  };
  /** Absolute value (percent cells converted through the basis in percent mode). */
  const absAt = (s: NormSer, ci: number): number | null => {
    const val = s.vals[ci]!;
    return mekkoAmount(val, val.isPct && st.mode === 'percent' ? basisAt(ci) : 0, st.mode === 'percent');
  };
  /** Value in plotted units (percent share in percent mode, absolute otherwise). */
  const plottedAt = (s: NormSer, ci: number): number | null => {
    const val = s.vals[ci]!;
    if (val.v === null) return null;
    if (st.mode !== 'percent') return val.v;
    if (invalidAt(ci)) return 0;
    if (val.isPct) return val.v;
    const b = basisAt(ci);
    return b > 0 ? (val.v / b) * 100 : 0;
  };
  /** Column width weight: widthSeries value or absolute category total. */
  const weightAt = (ci: number): number => {
    if (st.widthSer) {
      const v = st.widthSer.vals[ci]?.v;
      return v === null || v === undefined ? 0 : Math.max(0, v);
    }
    if (st.mode === 'bar') return 1; // no width series: equal columns
    return Math.max(0, st.series.reduce((a, s) => a + (absAt(s, ci) ?? 0), 0));
  };
  return { invalidAt, basisAt, absAt, plottedAt, weightAt };
}

/** Category sort (live reorder, by width weight), then topN: the n largest, the rest as 'Others' last. */
function reorderCategories(
  st: ValueState,
  seriesNorm: NormSer[],
  options: MekkoOptions,
  weightAt: (ci: number) => number,
  basisAt: (ci: number) => number,
): Id | null {
  const applyOrder = (order: number[]): void => {
    st.cats = order.map((i) => st.cats[i]!);
    for (const s of seriesNorm) s.vals = order.map((i) => s.vals[i]!);
  };
  const catSort = options.sort?.categories;
  if (catSort && catSort !== 'sheet') {
    const order = st.cats.map((_, i) => i);
    if (catSort === 'reverse') order.reverse();
    else {
      const dir = catSort === 'asc' ? 1 : -1;
      order.sort((a, b) => (weightAt(a) - weightAt(b)) * dir || a - b);
    }
    applyOrder(order);
  }
  const topN = options.topN;
  if (!topN || topN.n <= 0 || st.cats.length <= topN.n) return null;
  const { kept: keptIdx, dropped: dropIdx } = topNCut(st.cats.map((_, i) => weightAt(i)), topN.n);
  if (topN.rest === false || dropIdx.length === 0) {
    applyOrder(keptIdx);
    return null;
  }
  let othersId = 'others';
  while (st.cats.some((c) => c.id === othersId)) othersId = `_${othersId}`;
  const bases = dropIdx.map(basisAt);
  const othersVals = seriesNorm.map((s) => s === st.widthSer
    ? restSum(dropIdx.map((i) => s.vals[i]!.v))
    : poolMekkoAmounts(dropIdx.map((i, k) => ({ ...s.vals[i]!, basis: bases[k]! })), st.mode === 'percent'));
  const total100 = st.mode === 'percent' && dropIdx.some((i) => st.cats[i]!.total100 !== undefined)
    ? bases.reduce((sum, basis) => sum + basis, 0) : undefined;
  applyOrder(keptIdx);
  st.cats = [...st.cats, { id: othersId, label: restLabel(topN, options.strings, dropIdx.length), ...(total100 === undefined ? {} : { total100 }) }];
  seriesNorm.forEach((s, k) => {
    s.vals = [...s.vals, { v: othersVals[k]!, isPct: false }];
  });
  return othersId;
}

/** Percent mode: a column with a negative part is n.m., one with no positive basis n/a. */
function percentValidity(st: ValueState, warnings: LintWarning[]): void {
  if (st.mode !== 'percent') return;
  st.cats.forEach((c, ci) => {
    const values = st.series.map((series) => series.vals[ci]!);
    const { nm, na } = compositionBasis(values, c.total100);
    if (nm) {
      st.nm.add(c.id);
      return;
    }
    if (na) {
      st.na.add(c.id);
      warnings.push({
        code: 'percent-basis-nonpositive',
        severity: 'warn',
        message: `category '${c.id}': non-positive 100% basis — nothing to compose, category marked n/a`,
        owner: { categoryId: c.id },
      });
    }
  });
  if (st.nm.size > 0) warnings.push(mixedSignsWarning([...st.nm], st.cats.length));
  // A column past 100% is no composition either: it draws as n.m., as a signed one does.
  const overfull = st.cats.flatMap((c, ci) => {
    if (st.nm.has(c.id) || st.na.has(c.id)) return [];
    const values = st.series.map((series) => series.vals[ci]!);
    const sum = overfullShareSum(values, compositionBasis(values, c.total100).basis);
    return sum === undefined ? [] : [{ id: c.id, sum }];
  });
  for (const row of overfull) st.nm.add(row.id);
  if (overfull.length > 0) warnings.push(overfullWarning(overfull, st.nm.size + st.na.size === st.cats.length, "give every part as a share of the same whole, or use variant 'bar' for shares that overlap"));
}

/** Totals, stack extents, weights and shares per column. */
function mekkoStacks(st: ValueState, fns: ReturnType<typeof valueFns>, warnings: LintWarning[]) {
  const { plottedAt, absAt } = fns;
  const columnTotals: Record<Id, number> = {};
  const posTop: number[] = [];
  const negBot: number[] = [];
  const anyByCat: boolean[] = [];
  const weights: number[] = [];
  st.cats.forEach((c, ci) => {
    let pos = 0;
    let neg = 0;
    let any = false;
    for (const s of st.series) {
      const v = plottedAt(s, ci);
      if (v === null) continue;
      any = true;
      if (v >= 0) pos += v;
      else neg += v;
    }
    posTop[ci] = pos;
    negBot[ci] = neg;
    anyByCat[ci] = any;
    columnTotals[c.id] = round2(st.series.reduce((a, s) => a + (absAt(s, ci) ?? 0), 0));
    weights[ci] = fns.weightAt(ci);
  });
  // A column of shares only (valueKind 'fraction', { pct } cells, no total100)
  // gives no amount: it has no total to print and no size to set its width.
  const unknownTotals = new Set(st.cats.filter((_, ci) =>
    st.series.some((s) => s.vals[ci]!.v !== null) && st.series.every((s) => absAt(s, ci) === null)).map((c) => c.id));
  if (unknownTotals.size > 0 && !st.widthSer) {
    // Widths set by some columns' amounts would draw the others at width 0: every column takes the same width.
    weights.fill(1);
    warnings.push({
      code: 'mekko-widths-need-amounts',
      severity: 'warn',
      message: `a mekko's column widths need absolute column totals, and ${unknownTotals.size === st.cats.length ? 'every column gives' : `${[...unknownTotals].join(', ')} give`} shares only: the columns draw at equal widths, and a column of shares prints no total`,
      suggest: 'give the values as amounts, or set widthSeriesId to the id of a series of column sizes',
    });
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    warnings.push({
      code: 'zero-weight-total',
      severity: 'warn',
      message: 'all column weights are zero — columns get equal widths',
    });
  }
  const shares: Record<Id, Record<Id, number>> = {};
  st.cats.forEach((c, ci) => {
    const row: Record<Id, number> = {};
    const totalAbs = columnTotals[c.id]!;
    for (const s of st.series) {
      if (st.mode === 'percent') {
        const p = plottedAt(s, ci);
        if (p !== null) row[s.id] = round2(p);
      } else if (st.mode === 'bar') {
        if (s.vals[ci]!.v !== null) row[s.id] = 100;
      } else {
        const a = absAt(s, ci);
        if (a !== null) row[s.id] = totalAbs !== 0 ? round2((a / totalAbs) * 100) : 0;
      }
    }
    shares[c.id] = row;
  });
  return { columnTotals, unknownTotals, posTop, negBot, anyByCat, weights, totalWeight, shares };
}

/** Phase 1: data in, the categories, series, stacks, weights and the value domain out. */
export function resolveMekkoDomain(data: ChartData, env: MekkoEnv, warnings: LintWarning[]): MekkoDomain {
  const { options, va } = env;
  const { cats, seriesNorm } = normalizeMekkoData(data);
  const st: ValueState = { ...mekkoSeriesRoles(options, seriesNorm, warnings), cats, nm: new Set(), na: new Set() };
  const fns = valueFns(st);
  const allCats = st.cats;
  const othersId = reorderCategories(st, seriesNorm, options, fns.weightAt, fns.basisAt);
  const othersMembers = othersId === null ? [] : allCats.filter((c) => !st.cats.some((kept) => kept.id === c.id)).map((c) => c.label ?? c.id);
  percentValidity(st, warnings);

  // Per-category segment order (top→bottom). Series order is the default:
  // a mekko compares one competitor across markets, and a
  // per-column re-sort makes the highlighted competitor jump between rows.
  // Sorting stays an option. An 'others' series pins to the bottom.
  const isOthersSeries = (s: NormSer): boolean => s.colorRole === 'others' || s.id.toLowerCase() === 'others';
  const segSort = options.sort?.segments ?? 'sheet';
  // A percent stack's top edge is always 100%, so a ridge on the top series
  // is a flat line. With no authored segment sort, the ridge series stacks at
  // the baseline and the others follow upward in series order, an 'others'
  // series last: the ridge then steps with the share.
  const ridgeAt = st.mode === 'percent' && options.sort?.segments === undefined && options.ridge !== undefined
    ? st.series.findIndex((s) => s.id === options.ridge) : -1;
  const rest = st.series.map((_, si) => si).filter((si) => si !== ridgeAt);
  const ridgeOrder = [ridgeAt, ...rest.filter((si) => !isOthersSeries(st.series[si]!)), ...rest.filter((si) => isOthersSeries(st.series[si]!))].reverse();
  const order: number[][] = st.cats.map((_, ci) => {
    if (ridgeAt >= 0) return [...ridgeOrder];
    const idx = st.series.map((_, si) => si);
    let ordered: number[];
    if (segSort === 'sheet') ordered = idx;
    else if (segSort === 'reverse') ordered = [...idx].reverse();
    else {
      const dir = segSort === 'asc' ? 1 : -1;
      ordered = [...idx].sort((a, b) => {
        const va = fns.plottedAt(st.series[a]!, ci) ?? 0;
        const vb = fns.plottedAt(st.series[b]!, ci) ?? 0;
        return (vb - va) * dir || a - b;
      });
    }
    return [...ordered.filter((si) => !isOthersSeries(st.series[si]!)),
            ...ordered.filter((si) => isOthersSeries(st.series[si]!))];
  });
  const stacks = mekkoStacks(st, fns, warnings);
  // A column with a missing part has no known whole: its total, and its
  // shares, would describe the known parts only. Bar mode has one part.
  const incomplete = new Set(st.mode === 'bar' ? [] : st.cats
    .filter((_, ci) => isIncomplete(st.series.map((s) => s.vals[ci]!.v)))
    .map((c) => c.id));
  // A percent column of authored shares with no amount beside them (no
  // total100, no number cell) has no known whole: its total is unknown, not 0.
  const wholeUnknown = new Set(st.mode !== 'percent' ? [] : st.cats
    .filter((c, ci) => {
      const { basis, nm, direct } = compositionBasis(st.series.map((s) => s.vals[ci]!), c.total100);
      return direct && !nm && basis <= 0;
    })
    .map((c) => c.id));

  // rounding 'sum-consistent': the computed shares of each complete column
  // print so they add up to 100%. Authored percents and total100 are the author's.
  const rounded = options.rounding === 'sum-consistent' && st.mode !== 'bar'
    ? roundWholes(st.cats.flatMap((c, ci) => {
      if (fns.invalidAt(ci) || incomplete.has(c.id) || c.total100 !== undefined || st.series.some((s) => s.vals[ci]!.isPct)) return [];
      const total = st.series.reduce((sum, s) => sum + (fns.absAt(s, ci) ?? 0), 0);
      const parts = st.series.flatMap((s) => {
        const share = st.mode === 'percent' ? fns.plottedAt(s, ci) : total !== 0 && fns.absAt(s, ci) !== null ? (fns.absAt(s, ci)! / total) * 100 : null;
        const example = s.vals[ci]!.format ?? s.format;
        return share === null ? [] : [{ id: s.id, name: s.label, share, ...(example ? { format: parseFormatExample(example) } : {}) }];
      });
      return [{ id: c.id, name: c.label ?? c.id, parts }];
    }), options.locale?.language, options.format && specUnitKind(parseFormatExample(options.format)) === 'percent' ? parseFormatExample(options.format) : undefined)
    : undefined;
  if (rounded) pushAll(warnings, rounded.warnings);

  let dLo: number;
  let dHi: number;
  // A drawn value line is part of the stated range (valueLineDomain.ts): it
  // seeds the extent, and an authored bound only WIDENS the domain below, so
  // the line is always visible rather than refused. That holds in percent mode
  // too, whose axis is 0..100 only until the data or a line reaches past it.
  const lineExtent = valueLineExtent(options.annotations);
  const loAll = Math.min(0, lineExtent?.lo ?? 0, minOf(stacks.negBot));
  const hiAll = Math.max(0, lineExtent?.hi ?? 0, maxOf(stacks.posTop));
  if (st.mode === 'percent') {
    dLo = Math.min(0, loAll);
    dHi = Math.max(100, hiAll);
  } else {
    const lo2 = loAll < 0 ? loAll * 1.08 : 0; // label headroom below negatives
    let hi2 = hiAll > 0 ? hiAll * 1.08 : 0; // label headroom above positives
    if (lo2 === 0 && hi2 === 0) hi2 = 1;
    // stack extents carry the structural zero; bound snap overshoot on both
    // edges (the domain-economy invariant)
    [dLo, dHi] = niceDomain(lo2, hi2, 5, { dataExtent: [loAll, hiAll], maxWasteFraction: 0.15 });
    // A bar mekko draws no value axis by default, so no tick asks for a nice
    // bound: the domain ends at the data, and the value labels take their
    // own room above and below the plot (a nice bound can leave a dead band
    // of over 19%).
    if (st.mode === 'bar' && va.show !== true) [dLo, dHi] = loAll === 0 && hiAll === 0 ? [0, 1] : [loAll, hiAll];
  }
  [dLo, dHi] = applyAxisBounds([dLo, dHi], [Math.min(loAll, 0), Math.max(hiAll, 0)], va, warnings);

  // valueLine 'mean' is the WIDTH-WEIGHTED mean of the plotted totals
  const plottedTotal = (ci: number) => stacks.posTop[ci]! + stacks.negBot[ci]!;
  const valid = st.cats.map((_, ci) => !fns.invalidAt(ci));
  const meanWeight = st.cats.reduce((sum, _, ci) => sum + (valid[ci] ? stacks.weights[ci]! : 0), 0);
  const validCount = valid.filter(Boolean).length;
  const meanValue =
    validCount > 0
      ? meanWeight > 0
        ? st.cats.reduce((a, _, ci) => a + (valid[ci] ? stacks.weights[ci]! * plottedTotal(ci) : 0), 0) / meanWeight
        : st.cats.reduce((a, _, ci) => a + (valid[ci] ? plottedTotal(ci) : 0), 0) / validCount
      : undefined;
  return {
    mode: st.mode,
    cats: st.cats,
    series: st.series,
    widthSer: st.widthSer,
    othersId,
    othersMembers,
    nm: st.nm,
    na: st.na,
    incomplete,
    wholeUnknown,
    order,
    ...stacks,
    dLo,
    dHi,
    meanValue,
    validCount,
    plottedAt: fns.plottedAt,
    absAt: fns.absAt,
    invalidAt: fns.invalidAt,
    shareTexts: rounded?.texts ?? (options.format && specUnitKind(parseFormatExample(options.format)) === 'percent'
      ? new Map() : oneColumnPrecision(st, fns, incomplete, options.locale?.language)),
    ...(rounded ? { roundingAdjustments: rounded.adjustments } : {}),
  };
}

/**
 * The computed shares of one column print at one precision, the
 * finest any of them needs, so APAC reads 27.7% beside 8.6% and not 28%, and
 * the hover card agrees. An authored percent is the author's number.
 */
function oneColumnPrecision(
  st: { mode: string; cats: { id: Id }[]; series: NormSer[] },
  fns: { invalidAt: (ci: number) => boolean; absAt: (s: NormSer, ci: number) => number | null; plottedAt: (s: NormSer, ci: number) => number | null },
  incomplete: ReadonlySet<Id>,
  locale: string | undefined,
): Map<string, string> {
  const texts = new Map<string, string>();
  if (st.mode === 'bar') return texts;
  st.cats.forEach((c, ci) => {
    if (fns.invalidAt(ci) || incomplete.has(c.id)) return;
    const total = st.series.reduce((sum, s) => sum + (fns.absAt(s, ci) ?? 0), 0);
    const shares = st.series.flatMap((s) => {
      if (s.vals[ci]!.isPct) return [];
      const share = st.mode === 'percent' ? fns.plottedAt(s, ci) : total !== 0 && fns.absAt(s, ci) !== null ? (fns.absAt(s, ci)! / total) * 100 : null;
      return share === null ? [] : [{ id: s.id, share }];
    });
    const set = shareSetFormatter(shares.map((entry) => entry.share), locale);
    for (const { id, share } of shares) texts.set(`${c.id}\0${id}`, set.format(share));
  });
  return texts;
}
