import type { StringsSpec } from '../../types/options';
/**
 * Combo phase 1: options and data in, the series by role, the
 * formats per scale group, the column stacks and both value domains out.
 * Nothing here knows a pixel.
 */

import { cellFields, normalizeCategorySeries } from '../categorySeries';
import { breakUnsupported, chartPalette, chartTheme } from '../chartEnv';
import { defaultMeasurer } from '../../text';
import { tickFormatter } from '../../axis';
import { formatAutomaticPercent, formatShare } from '../../format';
import { roundingUnavailable, sumConsistentShares, type RoundingAdjustment } from '../../shareRounding';
import { comboValueLabels, FIRST_END_BELOW_TOTALS } from './endpoints';
import { unitConflict, unitConflictRefusal } from '../../schema/units';
import { formatStatWithSpec, formatterFromExample, memoFormatterFromExample, percentRasterFormatter, seriesRasterFormatter } from '../../formatSpec';
import { averageMarkerLine, averageMarkerScope, averageOfUnaddedSums, warnIncompleteStacks } from '../band/stacks';
import { anomalyCorridor, anomalyModel, refuseAnomalySpec } from '../column/anomaly';
import type { LineAnomaly } from '../line/model';
import {
  NormalizeError,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { applyAxisBounds, linearScale, niceDomain } from '../../scale';
import type { Annotation } from '../../types/annotations';
import { type Id } from '../../types/cell';
import { stackAdds } from '../../stackAdds';
import type { Category, ChartData } from '../../types/data';
import type { AxisRuler, ComboOptions, LineInterpolation } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { valueLineExtent, type ValueLineExtent } from '../../valueLineDomain';
import { applyCategoryViewport, liveWindowOptions, viewportMeanSpan } from '../../viewport';
import type { ComboDomain, ComboEnv, NormSer } from './model';
import { disclosuresShown } from '../../notes';
import { maxOf } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';
import { checkPointBudget, COMBO_LIMIT } from '../../itemBudget';

/** Resolve the options once: theme, palette, size, measurer and highlights. */
export function resolveComboEnv(options: ComboOptions, warnings: LintWarning[]): ComboEnv {
  breakUnsupported('combo', options, warnings);
  const theme = chartTheme(options);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  return {
    theme,
    palette: paletteRamp ? options.palette : undefined,
    size: resolveSize(options.size),
    byExample: memoFormatterFromExample(),
    measure: options.measure ?? defaultMeasurer,
    highlights: new Set(resolveHighlight(options.highlight)),
    density: options.labelDensity ?? 'smart',
  };
}

/** A null breaks a line by default, as on line. */
function normalizeComboData(data: ChartData): { cats: Category[]; seriesNorm: NormSer[] } {
  const { cats, series } = normalizeCategorySeries('combo', data, (s, cells): NormSer => ({
    id: s.id,
    label: s.label ?? s.id,
    role: s.role ?? 'data',
    kind: s.kind ?? 'column',
    axis: s.axis ?? 'primary',
    scenario: normalizeScenario(s.scenario as string | undefined, `series[${s.id}].scenario`),
    colorRole: s.colorRole,
    fill: s.fill,
    format: s.format,
    unit: s.unit,
    lineStyle: s.lineStyle,
    marker: s.marker,
    smooth: s.smooth,
    interpolateGaps: s.interpolateGaps ?? false,
    vals: cells.map((cell, ci) => cellFields(cell, `series[${s.id}].values[${ci}]`)),
  }));
  return { cats, seriesNorm: series };
}

/**
 * The right-hand axis. The percent ruler is a RELABELLING of the primary
 * domain, not a second scale. `acknowledge` and `ruler` make opposite claims
 * about what the right-hand axis means, so both together resolve to neither
 * — picking one silently would change the chart's analytical statement.
 * The secondary axis is gated (explicit acknowledge; always lint-warned),
 * and column-kind series cannot leave the shared stack scale.
 */
function comboAxisGate(options: ComboOptions, seriesNorm: readonly NormSer[], columns: NormSer[], lines: NormSer[], warnings: LintWarning[]) {
  const secOpt = options.secondaryAxis as
    | { acknowledge?: true; ruler?: AxisRuler; domain?: [number, number]; format?: string; show?: boolean }
    | undefined;
  const rulerRequested = secOpt?.ruler;
  let acknowledged = secOpt?.acknowledge === true;
  let ruler: { total: number; intervals: number } | undefined;
  if (rulerRequested && acknowledged) {
    acknowledged = false;
    warnings.push({
      code: 'combo-ruler-conflict',
      severity: 'error',
      message:
        'secondaryAxis.acknowledge (an independent second scale) and secondaryAxis.ruler ' +
        '(a relabelling of the primary scale) contradict each other — both refused',
      suggest: 'choose one: acknowledge for genuinely independent units, ruler for a share of a total',
    });
  } else if (rulerRequested) {
    if (!Number.isFinite(rulerRequested.total) || rulerRequested.total <= 0) {
      warnings.push({
        code: 'combo-ruler-total-invalid',
        severity: 'error',
        message: `secondaryAxis.ruler.total must be positive and finite (got ${String(rulerRequested.total)}) — ruler not drawn`,
        suggest: 'pass the grand total the percentages refer to',
      });
    } else {
      ruler = { total: rulerRequested.total, intervals: Math.max(1, Math.round(rulerRequested.ticks ?? 5)) };
    }
  }
  for (const s of columns) {
    if (s.axis === 'secondary') {
      s.axis = 'primary';
      warnings.push({
        code: 'dual-axis',
        severity: 'warn',
        message: `column series '${s.id}' cannot use the secondary axis — treated as primary`,
        owner: { seriesId: s.id },
      });
    }
  }
  const secondaryRequested = lines.filter((s) => s.axis === 'secondary');
  let secondaryActive = false;
  if (secondaryRequested.length > 0) {
    if (!acknowledged) {
      // The refusal: the CLI, MCP, React and the library layout (isRefused)
      // all refuse on it. The series move to the primary scale only so the
      // refused layout still completes; no path draws it.
      for (const s of secondaryRequested) s.axis = 'primary';
      const ids = secondaryRequested.map((s) => `'${s.id}'`).join(', ');
      warnings.push({
        code: 'dual-axis',
        severity: 'error',
        message:
          `series ${ids} ${secondaryRequested.length === 1 ? 'requests' : 'request'} the secondary axis ` +
          'without options.secondaryAxis.acknowledge — a dual-axis chart is refused unless acknowledged',
        suggest:
          'for genuinely independent units, set options.secondaryAxis = { acknowledge: true }; ' +
          `for a share of a total, remove axis: 'secondary' from ${ids} and set options.secondaryAxis.ruler`,
        field: ['data', 'series', seriesNorm.indexOf(secondaryRequested[0]!), 'axis'],
      });
    } else {
      secondaryActive = true;
      warnings.push({
        code: 'dual-axis',
        severity: 'warn',
        message: `secondary axis in use — dual-axis charts invite misreading; ${secOpt?.domain ? 'the secondary scale follows its authored domain' : 'tick rows are synced to the primary axis'}`,
      });
    }
  }
  return { secOpt, ruler, secondaryRequested, secondaryActive };
}

/** Whether a combo draws a second value scale (the chart ID combo.dual-axis): the axis gate's own decision. */
export function comboDrawsSecondaryAxis(data: ChartData, options: ComboOptions): boolean {
  const series = (data.series ?? []).filter((s) => (s.role ?? 'data') !== 'reference')
    .map((s) => ({ ...s, kind: s.kind ?? 'column' }) as unknown as NormSer);
  return comboAxisGate(options, series, series.filter((s) => s.kind === 'column'), series.filter((s) => s.kind !== 'column'), []).secondaryActive;
}

/** A line or area on the primary scale that does not print every value (valueLabels short of 'all', or point labels off). */
function primaryLinesUnlabelled(options: ComboOptions, lines: readonly NormSer[], secondaryActive: boolean): boolean {
  const onPrimary = lines.some((s) => !(secondaryActive && s.axis === 'secondary'));
  const pointsOff = typeof options.labels === 'object' && options.labels?.point === false;
  return onPrimary && (pointsOff || comboValueLabels(options) !== 'all');
}

/**
 * The series drawn against one scale declare one unit. The
 * primary scale carries options.unit, else the first unit a series on it
 * declares; an acknowledged secondary axis its own. The first series that
 * declares another is refused with its path and the fix combo supports.
 */
function comboUnitConflicts(options: ComboOptions, seriesNorm: NormSer[], dataSeries: NormSer[], secondaryActive: boolean, warnings: LintWarning[]): void {
  const scales = [
    { series: dataSeries.filter((s) => !secondaryActive || s.axis !== 'secondary'), unit: options.unit, name: 'the primary axis', secondary: false },
    { series: secondaryActive ? dataSeries.filter((s) => s.axis === 'secondary') : [], unit: undefined, name: 'the secondary axis', secondary: true },
  ];
  for (const scale of scales) {
    const conflict = unitConflict(scale.series, scale.unit);
    if (!conflict) continue;
    const s = scale.series[conflict.index]!;
    warnings.push(unitConflictRefusal(conflict, s.id, seriesNorm.indexOf(s), scale.name, s.kind === 'column' || scale.secondary
      ? `give the ${scale.secondary ? 'secondary' : 'column'} series one unit, or show the measure in its own chart`
      : `move series '${s.id}' to the secondary axis (axis: 'secondary', secondaryAxis: { acknowledge: true }) and title it in axisTitles.secondary`, scale.unit));
  }
}

/** 1/2/2.5/3/5/10 ladder step, local to the
 *  secondary-axis tick sync — core niceStep lacks the 2.5 mantissa. */
function ladderStepUp(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 3, 5, 10]) {
    if (m * base >= raw - base * 1e-9) return m * base;
  }
  return 10 * base;
}

/** Snap synced secondary ticks to the grid (no 0.30000000000000004 labels). */
function roundTick(v: number): number {
  return Number(v.toFixed(10));
}

/** Mean over all primary-axis line values (valueLine default for line-only combos). */
export function primaryLineMean(
  plans: { s: { axis: string; vals: { v: number | null }[] }; pts: unknown[] }[],
  secondaryActive: boolean,
): number | undefined {
  let sum = 0;
  let n = 0;
  for (const p of plans) {
    if (secondaryActive && p.s.axis === 'secondary') continue;
    for (const val of p.s.vals) {
      if (val.v === null) continue;
      sum += val.v;
      n++;
    }
  }
  return n > 0 ? sum / n : undefined;
}

function comboStacks(cats: Category[], columnSeries: NormSer[]) {
  const stackTotals: Record<Id, number> = emptyIdRecord();
  const posTop: number[] = [];
  const negBot: number[] = [];
  const anyByCat: boolean[] = [];
  let lo = 0;
  let hi = 0;
  cats.forEach((c, ci) => {
    let p = 0;
    let n = 0;
    for (const s of columnSeries) {
      const v = s.vals[ci]!.v;
      if (v === null) continue;
      if (v >= 0) p += v;
      else n += v;
    }
    posTop[ci] = p;
    negBot[ci] = n;
    anyByCat[ci] = columnSeries.some((s) => s.vals[ci]!.v !== null);
    // Exact: the total label and the description round once, at print time.
    if (columnSeries.length > 0) stackTotals[c.id] = p + n;
    lo = Math.min(lo, n);
    hi = Math.max(hi, p);
  });
  return { stackTotals, posTop, negBot, anyByCat, lo, hi };
}

/**
 * The value lines a combo draws on one axis, as an extent. The chart has two
 * value axes and a line names the one it sits on (default primary). A
 * secondary line is drawn only once that axis is acknowledged, so it counts
 * only then.
 */
function axisValueLines(
  annotations: readonly Annotation[] | undefined,
  axis: 'primary' | 'secondary',
): ValueLineExtent | null {
  return valueLineExtent(annotations, axis);
}

type Gate = ReturnType<typeof comboAxisGate>;

/**
 * The primary domain (zero always included; label headroom) and its ticks.
 * Bounding the primary snap can change the primary tick COUNT; the secondary
 * lattice re-derives from that count by design (count sync), staying
 * step-minimal on its 1/2/2.5/5/10 ladder — the secondary domain itself is
 * deliberately NOT waste-bounded (count sync makes 15% unachievable in
 * general).
 * Mixed-sign domains snap BOTH edges, so the raw-mark envelope can drop to
 * 0.70 while each side clears the 0.15 cap. The ink-envelope gate measures
 * marks PLUS value labels, and the label band over the extreme bars is what
 * carries the shapes the snap leaves wide. Capping the SUM here would crush
 * the label air over small-magnitude extremes and lose a top value label to
 * all-candidates-collide: a label traded for geometry. That the defaults plus
 * labels satisfy the 0.80 floor is measured, not assumed.
 */
function primaryDomain(options: ComboOptions, gate: Gate, extent: { lo: number; hi: number; dataHi: number }, fmt: (v: number) => string, warnings: LintWarning[]) {
  const { lo, hi, dataHi } = extent;
  const { ruler } = gate;
  const va = options.valueAxis ?? {};
  const lo2 = lo < 0 ? lo * 1.08 : 0;
  let hi2 = hi > 0 ? hi * 1.08 : 0;
  if (lo2 === 0 && hi2 === 0) hi2 = 1;
  let [dLo, dHi] = niceDomain(lo2, hi2, 5, { dataExtent: [lo, hi], maxWasteFraction: 0.15 });
  // user min/max may never clip data
  [dLo, dHi] = applyAxisBounds([dLo, dHi], [Math.min(lo, 0), Math.max(hi, 0)], va, warnings);
  // The ruler's whole point is that the top tick row IS 100% of ruler.total,
  // so the domain is pinned to it rather than niced. Data still may never be
  // clipped: if it exceeds the declared total the ladder simply continues past
  // 100% and says so, instead of the top row quietly meaning something else.
  if (ruler) {
    dLo = Math.min(0, lo);
    dHi = Math.max(ruler.total, hi);
    if (dataHi > ruler.total) {
      warnings.push({
        code: 'combo-ruler-total-exceeded',
        severity: 'warn',
        message: `plotted values reach ${fmt(dataHi)}, above the declared ruler total ${fmt(ruler.total)} — the percent ladder continues past 100%`,
        suggest: 'pass the true grand total as secondaryAxis.ruler.total',
      });
    }
  }
  // Ticks depend only on the domain, so sync before any pixel work.
  let pticks = linearScale([dLo, dHi], [0, 1]).ticks(5);
  if (pticks.length < 2) pticks = [dLo, dHi];
  // With a ruler the percent ladder drives the rows, not the count values:
  // the reader's ladder is 0/20/…/100%, and the left-hand count ticks land
  // wherever that puts them (generally not round — truthful, and the reason
  // the primary axis stays off by default).
  if (ruler) {
    pticks = Array.from({ length: ruler.intervals + 1 }, (_, i) =>
      roundTick(dLo + ((dHi - dLo) * i) / ruler.intervals),
    );
  } else if (gate.secondaryActive && (va.min !== undefined || va.max !== undefined) && !(options as { [SECONDARY_FULL_DOMAIN]?: unknown })[SECONDARY_FULL_DOMAIN]
    && (pticks[0] !== dLo || pticks[pticks.length - 1] !== dHi)) {
    // A second scale reads off the same rows, so they run the whole scale: an authored
    // bound between two ticks moves the rows, it is not left above them. A Pareto total
    // is not a bound the reader asked to see; its round ticks stay.
    const step = pinnedStep(dLo, dHi, pticks.length - 1);
    pticks = Array.from({ length: Math.round((dHi - dLo) / step) + 1 }, (_, i) => Number((dLo + step * i).toPrecision(12)));
  }
  return { dLo, dHi, pticks };
}

/** The step of a pinned range: a ladder step that divides it, in the count nearest `rows`, more rows on a tie; else an even division. */
function pinnedStep(lo: number, hi: number, rows: number): number {
  const even = (hi - lo) / rows || 1;
  const steps = ladderSteps(even / 2, even * 2, PRIMARY_MANTISSAS)
    .filter((step) => Math.abs((hi - lo) / step - Math.round((hi - lo) / step)) < 1e-9);
  return steps.reduce<number | undefined>((best, step) => {
    if (best === undefined) return step;
    const off = Math.abs((hi - lo) / step - rows);
    const bestOff = Math.abs((hi - lo) / best - rows);
    return off < bestOff - 1e-9 || (Math.abs(off - bestOff) <= 1e-9 && step < best) ? step : best;
  }, undefined) ?? even;
}

/**
 * The secondary domain, its tick COUNT synced to the primary, and the
 * right-hand ticks: one descriptor for both the acknowledged secondary scale
 * and the ruler, so both reserve and claim through the same emit.
 */
function rightAxis(
  options: ComboOptions,
  gate: Gate,
  raw: { lo: number; hi: number },
  primary: { dLo: number; dHi: number; pticks: number[] },
  secondarySpec: ReturnType<typeof seriesRasterFormatter>,
  /** A secondary lattice chosen beside the primary (dual-axis anatomy, zero alignment), taken as is. */
  fixed?: { step: number; start: number },
) {
  const { secOpt, ruler, secondaryActive, secondaryRequested } = gate;
  const { pticks } = primary;
  const nTicks = pticks.length;
  const lang = options.locale?.language;
  let secondaryDomain: [number, number] | undefined;
  let secStep = 1;
  if (secondaryActive && secOpt?.domain) {
    // Pinned secondary domain: the author declares the
    // scale's meaning (0–100% of a total) and data may only WIDEN it. The
    // rows divide the pin at a ladder step, the one whose count is nearest
    // the primary's, more rows on a tie: 0/25/50/75/100, never 0/33/67/100.
    const lo = Math.min(secOpt.domain[0], raw.lo);
    const hi = Math.max(secOpt.domain[1], raw.hi);
    secStep = pinnedStep(lo, hi, nTicks - 1);
    secondaryDomain = [roundTick(lo), roundTick(hi)];
  } else if (secondaryActive && fixed !== undefined) {
    secStep = fixed.step;
    secondaryDomain = [roundTick(fixed.start), roundTick(fixed.start + fixed.step * (nTicks - 1))];
  } else if (secondaryActive) {
    let step2 = ladderStepUp((raw.hi - raw.lo) / (nTicks - 1) || 1);
    let s0 = Math.floor(raw.lo / step2 + 1e-9) * step2;
    for (let i = 0; i < 12 && s0 + step2 * (nTicks - 1) < raw.hi - step2 * 1e-9; i++) {
      step2 = ladderStepUp(step2 * 1.2);
      s0 = Math.floor(raw.lo / step2 + 1e-9) * step2;
    }
    secStep = step2;
    secondaryDomain = [roundTick(s0), roundTick(s0 + step2 * (nTicks - 1))];
  }
  const secFmtSrc = secondaryRequested.find((s) => s.format)?.format;
  // The acknowledged right axis can carry its own format-by-example (ticks only — data labels keep series
  // and scale formats). Without any explicit format, an all-percent secondary
  // group ('%' unit or pct cells) prints percent ticks instead of naked counts
  // — a reader cannot know "0 / 1 / 2" means percent otherwise.
  const secAxisFmtSrc = secondaryActive ? secOpt?.format : undefined;
  const secondaryAllPct =
    !secAxisFmtSrc &&
    !secFmtSrc &&
    secondaryRequested.length > 0 &&
    secondaryRequested.every((s) => s.unit === '%' || s.vals.every((val) => val.v === null || val.isPct)) &&
    secondaryRequested.some((s) => s.unit === '%' || s.vals.some((val) => val.isPct));
  if (secondaryDomain) {
    const rows = Math.round((secondaryDomain[1] - secondaryDomain[0]) / secStep);
    const secTickValues = Array.from({ length: rows + 1 }, (_, i) => roundTick(secondaryDomain![0] + secStep * i));
    // Tick precision rasters over the TICK SET (see axis.ts tickFormatter):
    // an integer secondary ladder reads "20", not "20.0", even when the
    // secondary DATA labels carry a decimal. One decimal count for the whole
    // percent ladder, like the ruler: "0% / 1.5% / 3%" never mixes "0%" with
    // "1.5%" and "3.0%" at different precisions.
    const pctDecimals = secondaryAllPct
      ? Math.max(0, ...secTickValues.map((tv) => {
          for (let d = 0; d <= 3; d++) {
            if (Math.abs(tv - Number(tv.toFixed(d))) < 1e-9) return d;
          }
          return 3;
        }))
      : 0;
    const secTickFmt = secAxisFmtSrc
      ? formatterFromExample(secAxisFmtSrc, options.locale?.language)
      : secFmtSrc
        ? formatterFromExample(secFmtSrc, options.locale?.language)
        : secondaryAllPct
          ? (tv: number) => formatAutomaticPercent(tv, pctDecimals, false, lang)
          : tickFormatter(secondarySpec.spec, secTickValues);
    // `secondaryAxis.show: false` keeps the scale and draws no tick column.
    if (secOpt?.show === false) return { secFmtSrc, secondaryDomain, rightTicks: [] };
    return { secFmtSrc, secondaryDomain, rightTicks: secTickValues.map((tv) => ({ at: tv, text: secTickFmt(tv) })) };
  }
  if (ruler) {
    const pct = pticks.map((t) => roundTick((t / ruler.total) * 100));
    // One decimal count for the whole column — a ladder that prints "0%",
    // "33.3%", "100%" mixes precisions inside a single column of numbers.
    const decimals = pct.some((p) => Math.abs(p - Math.round(p)) > 1e-9) ? 1 : 0;
    return { secFmtSrc, secondaryDomain, rightTicks: pct.map((p) => ({ at: p, text: formatAutomaticPercent(p, decimals, false, lang) })) };
  }
  return { secFmtSrc, secondaryDomain, rightTicks: [] };
}

/** Steps a scale may take, per decade: the primary keeps the plain ladder, the secondary adds 1.5, 3, 4, 6 and 8. */
const PRIMARY_MANTISSAS = [1, 2, 2.5, 5];
const SECONDARY_MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
/** Air, as a share of the plot height, the line keeps above every column it passes. */
const LINE_CLEARANCE = 0.03;

function ladderSteps(lo: number, hi: number, mantissas: readonly number[]): number[] {
  const out: number[] = [];
  for (let exp = Math.floor(Math.log10(lo)) - 1; exp <= Math.ceil(Math.log10(hi)) + 1; exp++) {
    for (const m of mantissas) {
      const step = roundTick(m * Math.pow(10, exp));
      if (step >= lo - 1e-9 && step <= hi + 1e-9) out.push(step);
    }
  }
  return out;
}

/**
 * The scales of the dual-axis anatomy. Both start at zero and
 * share one interval count, so every gridline is shared, and the maxima are
 * chosen so the line runs above the columns: at each of its points and where
 * it crosses a column edge, it keeps LINE_CLEARANCE of the plot over the
 * column top. Among the pairs that do, the one whose columns fill most of
 * the plot wins, then the one whose line does, then fewer intervals. The
 * search keeps columns at least a third of the plot. The line keeps at least five
 * eighths. Undefined when a value is negative or no pair keeps the line
 * above; the synced default scales stay then.
 */
function dualAxisScales(input: {
  columnTops: readonly number[];
  columnBottoms: readonly number[];
  primaryHi: number;
  lines: readonly (number | null)[][];
  secondaryHi: number;
  bandFraction: number;
  clearance?: number;
}): { pticks: number[]; secondaryStep: number } | undefined {
  const { columnTops, primaryHi, lines, secondaryHi } = input;
  if (input.columnBottoms.some((v) => v < 0) || lines.some((row) => row.some((v) => v !== null && v < 0))) return undefined;
  if (!(primaryHi > 0) || !(secondaryHi > 0)) return undefined;
  const half = input.bandFraction / 2;
  let best: { n: number; p: number; s: number; fill: number; lineFill: number } | undefined;
  for (const n of [3, 4, 5, 6]) {
    for (const p of ladderSteps(primaryHi / n, (primaryHi * 3) / n, PRIMARY_MANTISSAS)) {
      for (const s of ladderSteps((secondaryHi * 1.01) / n, (secondaryHi * 1.6) / n, SECONDARY_MANTISSAS)) {
        const colAt = (ci: number): number => (columnTops[ci] ?? 0) / (n * p);
        const lineAt = (v: number): number => v / (n * s);
        const clears = lines.every((row) => row.every((v, ci) => {
          if (v === null) return true;
          if (lineAt(v) - colAt(ci) < (input.clearance ?? LINE_CLEARANCE)) return false;
          // Where the segment to a neighbour crosses this column's edge.
          for (const next of [ci - 1, ci + 1]) {
            const w = row[next];
            if (w === undefined || w === null) continue;
            const atEdge = lineAt(v) + (lineAt(w) - lineAt(v)) * half;
            if (atEdge - colAt(ci) < (input.clearance ?? LINE_CLEARANCE)) return false;
          }
          return true;
        }));
        if (!clears) continue;
        const fill = maxOf(columnTops) / (n * p);
        const lineFill = secondaryHi / (n * s);
        if (!best || fill > best.fill + 1e-9 || (Math.abs(fill - best.fill) <= 1e-9 && (lineFill > best.lineFill + 1e-9
          || (Math.abs(lineFill - best.lineFill) <= 1e-9 && n < best.n)))) {
          best = { n, p, s, fill, lineFill };
        }
      }
    }
  }
  if (!best) return undefined;
  const { n, p, s } = best;
  return { pticks: Array.from({ length: n + 1 }, (_, i) => roundTick(i * p)), secondaryStep: s };
}

/**
 * A dual axis with a negative value shares its zero row: the secondary step
 * comes off the ladder so both zeros sit on one gridline, and the primary
 * gains rows below or above zero when the secondary needs them. Among the
 * steps, the fewest rows win, then the smaller step. Undefined when the
 * primary has no zero tick or an even step to extend.
 */
function zeroAlignedAxes(
  primary: { dLo: number; dHi: number; pticks: number[] },
  secondary: { lo: number; hi: number },
): { primary: { dLo: number; dHi: number; pticks: number[] }; secondary: { step: number; start: number } } | undefined {
  const { pticks } = primary;
  const n = pticks.length;
  const zero = pticks.findIndex((t) => Math.abs(t) < 1e-9);
  const p = n > 1 ? pticks[1]! - pticks[0]! : 0;
  if (zero < 0 || !(p > 0) || pticks.some((t, i) => Math.abs(t - pticks[0]! - i * p) > p * 1e-6)) return undefined;
  const range = secondary.hi - secondary.lo;
  if (!(range > 0)) return undefined;
  let best: { below: number; above: number; step: number } | undefined;
  for (const step of ladderSteps(range / (n + 1), (range * 4) / Math.max(1, n - 1), [1, 2, 2.5, 5])) {
    const below = Math.max(zero, Math.ceil(-secondary.lo / step - 1e-9));
    const above = Math.max(n - 1 - zero, Math.ceil(secondary.hi / step - 1e-9));
    if (!best || below + above < best.below + best.above) best = { below, above, step };
  }
  if (!best) return undefined;
  const { below, above, step } = best;
  const ticks = Array.from({ length: below + above + 1 }, (_, i) => roundTick((i - below) * p));
  return {
    primary: { dLo: Math.min(primary.dLo, ticks[0]!), dHi: Math.max(primary.dHi, ticks[ticks.length - 1]!), pticks: ticks },
    secondary: { step, start: roundTick(-below * step) },
  };
}

/**
 * Whether a combo draws the dual-axis anatomy: an acknowledged
 * secondary scale the author did not pin, and the option or, without it,
 * the theme switch. A pinned secondary domain (pareto's 0-100 %) keeps the
 * plain dual axis.
 */
export function dualAxisAnatomy(options: ComboOptions, secondaryActive: boolean, theme: Theme | undefined): boolean {
  const pinned = (options.secondaryAxis as { domain?: unknown } | undefined)?.domain !== undefined;
  if (!secondaryActive || pinned) return false;
  return options.dualAxis?.anatomy ?? theme?.valueAxis?.dualAxis === true;
}

/**
 * The average marker, as on column: the mean of the column stacks over every
 * source category, each stack the sum of the columns in scope, drawn as a
 * dashed Ø rule on the primary axis. A line in the scope is left out and
 * named: its values sit on their own scale more often than not.
 */
function averageMarkerMean(
  options: ComboOptions, cats: Category[], columns: NormSer[], lines: NormSer[], warnings: LintWarning[],
  adds: (columns: NormSer[]) => boolean,
): number | undefined {
  const scope = averageMarkerScope(options.averageMarker);
  if (scope === undefined) return undefined;
  const lineIds = scope === 'all' ? [] : scope.filter((id) => lines.some((s) => s.id === id));
  if (lineIds.length > 0) {
    warnings.push({
      code: 'average-marker-scope',
      severity: 'warn',
      message: `averageMarker on a combo averages its column stacks; the line${lineIds.length === 1 ? '' : 's'} ${lineIds.map((id) => `'${id}'`).join(', ')} ${lineIds.length === 1 ? 'is' : 'are'} left out`,
      suggest: 'scope the marker to column series; a valueLine annotation draws a line at any value',
    });
  }
  const selected = columns.filter((s) => scope === 'all' || scope.includes(s.id));
  if (averageOfUnaddedSums(adds(selected), warnings)) return undefined;
  const stacks = cats.flatMap((_, ci) => {
    const values = selected.flatMap((s) => (s.vals[ci]?.v == null ? [] : [s.vals[ci]!.v!]));
    return values.length > 0 ? [values.reduce((sum, v) => sum + v, 0)] : [];
  });
  if (stacks.length === 0) {
    warnings.push({ code: 'average-marker-empty', severity: 'warn', message: 'averageMarker scope has no plotted values; marker omitted' });
    return undefined;
  }
  return stacks.reduce((sum, v) => sum + v, 0) / stacks.length;
}

/**
 * options.anomaly on a combo: column's rule over its one line series, on that
 * line's own scale and format.
 */
function comboAnomalyModel(
  spec: NonNullable<ComboOptions['anomaly']>, cats: Category[], lines: NormSer[],
  secondary: ReturnType<typeof seriesRasterFormatter>, primary: ReturnType<typeof seriesRasterFormatter>,
  pctFmt: (v: number) => string, locale: string | undefined, warnings: LintWarning[], strings?: StringsSpec,
) {
  const lineSeries = lines.filter((s) => s.kind === 'line');
  if (lineSeries.length !== 1) {
    throw new NormalizeError(
      'anomaly-single-series',
      'options.anomaly',
      `anomaly on a combo judges its one line series; got ${lineSeries.length} — a robust score across two different measures is meaningless`,
      "give exactly one series kind 'line', or chart the measure on its own line chart",
    );
  }
  refuseAnomalySpec(spec);
  const series = lineSeries[0]!;
  const onSecondary = series.axis === 'secondary' && secondary !== primary;
  const raster = onSecondary ? secondary : primary;
  const isPct = series.vals.some((val) => val.isPct);
  const fmt = isPct ? pctFmt : raster.fmt;
  // Rule statistics keep two decimals of a percent; the raster could round a MAD of 0.1% to nothing.
  const statFmt = isPct ? (v: number) => formatAutomaticPercent(v, 2, false, locale) : (v: number) => formatStatWithSpec(v, raster.spec);
  const present = cats.flatMap((c, ci) => {
    const value = series.vals[ci]?.v;
    return value === null || value === undefined || !Number.isFinite(value) ? [] : [{ categoryId: c.id, value }];
  });
  return { ...anomalyModel(spec, present, fmt, statFmt, locale, warnings, strings), seriesId: series.id, statFmt, onSecondary };
}

/** Internal: the second run of a combo whose default-hidden value axis left a column total without a seat. */
export const TOTALS_AXIS = Symbol('boardplot.comboTotalsAxis');
/** Pareto's 100% maps to the grand total, including a non-tick domain end. */
export const SECONDARY_FULL_DOMAIN = Symbol('boardplot.secondaryFullDomain');
/** Measured column-label clearance, as a share of the drawn scale height. */
export const LINE_BAND_CLEARANCE = Symbol('boardplot.lineBandClearance');

/** The authored secondary range maps to these primary values, even when a reference widens either scale. */
export function secondaryPrimaryRange(options: ComboOptions, secondary: readonly [number, number], fallback: readonly number[]): [number, number] {
  const mapped = (options as { [SECONDARY_FULL_DOMAIN]?: readonly [number, number] })[SECONDARY_FULL_DOMAIN];
  const authored = (options.secondaryAxis as { domain?: [number, number] } | undefined)?.domain;
  if (!mapped || !authored) return [fallback[0]!, fallback[fallback.length - 1]!];
  const scale = linearScale(authored, [mapped[0], mapped[1]]);
  return [scale(secondary[0]), scale(secondary[1])];
}

/** Phase 1: data in, the series by role, their formats, the stacks and both domains out. */
/** Below this band step (px) the columns keep 0.7 of their band: thin columns crowd their values. */
const OPEN_BAND_MIN_STEP = 40;

/**
 * The share of a category band its columns take. A combo's columns take 0.55 of their band
 * (76.8 of 138.7 px at 960, 26.6 of 48 at 320), so the line reads over the gaps. Where the band
 * is narrower than 40 px (twelve months at 320 px) the columns keep 0.7: at 0.55 a line value
 * loses its seat. A Pareto keeps 0.7. The step is estimated from the canvas width.
 */
export function comboBandFraction(options: ComboOptions, count: number): number {
  if (options.bandFraction !== undefined) return options.bandFraction;
  const pareto = (options as { [FIRST_END_BELOW_TOTALS]?: boolean })[FIRST_END_BELOW_TOTALS] === true;
  if (pareto) return 0.7;
  const width = resolveSize(options.size, options.target).width;
  return (width - 64) / Math.max(1, count) >= OPEN_BAND_MIN_STEP ? 0.55 : 0.7;
}

export function resolveComboDomain(data: ChartData, options: ComboOptions, warnings: LintWarning[], theme?: Theme): ComboDomain {
  const { cats, seriesNorm } = normalizeComboData(data);
  const dataSeries = seriesNorm.filter((s) => s.role !== 'reference');
  const refs = seriesNorm.filter((s) => s.role === 'reference');
  if (dataSeries.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'combo requires at least one data-role series');
  }
  const columns = dataSeries.filter((s) => s.kind === 'column');
  const lines = dataSeries.filter((s) => s.kind !== 'column');
  const chartInterpolation = options.interpolate ?? 'linear';
  const gate = comboAxisGate(options, seriesNorm, columns, lines, warnings);
  const { secondaryActive } = gate;
  comboUnitConflicts(options, seriesNorm, dataSeries, secondaryActive, warnings);
  // Exhibit-wide format raster, one raster PER SCALE GROUP and
  // computed AFTER the axis gate above: an acknowledged secondary axis is a
  // different scale in a different unit, and its precision must not leak
  // into the primary labels (units sold at 48.3 do not turn revenue columns
  // into "323.0"). Demoted secondary series share the primary scale claim
  // and therefore its raster.
  // Percent cells are excluded: they carry a different unit, format through
  // pctFmt, and must not push decimals onto the numeric labels sharing the
  // scale (a 36.2% margin line does not turn €m columns into "55.0").
  // The unit rule reads each group's unit, as column reads options.unit:
  // the primary group options.unit, else the unit its series share; the
  // acknowledged secondary group the unit its series share.
  const rasterFor = (axis: 'primary' | 'secondary') => {
    const group = seriesNorm.filter((s) => (s.axis ?? 'primary') === axis);
    const units = new Set(group.map((s) => s.unit));
    // An authored format holds both axes' labels to one scale and one decimal count (exampleSpec).
    const printed = axis === 'primary' && options.format ? seriesNorm.filter((s) => !s.format) : group;
    const shared = units.size === 1 ? [...units][0] : undefined;
    return seriesRasterFormatter(axis === 'primary' ? options.format : undefined, printed.flatMap((s) => s.vals.filter((val) => !val.isPct).map((val) => val.v)),
      options.locale?.language, axis === 'primary' ? (options.unit ?? shared) : shared, options.target,
      axis === 'primary' ? (options as { defaultFormat?: string }).defaultFormat : undefined, columns.length > 1);
  };
  const valueSpec = rasterFor('primary');
  const fmt = valueSpec.fmt;
  const secondarySpec = secondaryActive ? rasterFor('secondary') : valueSpec;
  // Percent cells are their own scale group and raster over their own values:
  // an authored 36.2 prints "36.2%", never a flat "36%" beside a title that
  // states 36.2, as the numeric groups above work.
  const pctFmt = percentRasterFormatter(seriesNorm.flatMap((s) => s.vals.filter((val) => val.isPct).map((val) => val.v)), options.locale?.language);
  const sourceMean = options.viewDomain || options.window
    ? columns.length > 0 && cats.length > 0
      ? columns.reduce((sum, series) => sum + series.vals.reduce((n, value) => n + (value.v ?? 0), 0), 0) / cats.length
      : primaryLineMean(lines.map((s) => ({ s, pts: [] })), secondaryActive)
    : undefined;
  // the column stack has a total, and a mean, only when its parts add.
  const addsOver = (series: NormSer[]) => stackAdds(series.map((s) => ({ label: s.label, unit: s.unit, pctCells: s.vals.some((val) => val.isPct) })), options.unit, undefined);
  const columnsAdd = addsOver(columns);
  const averageMean = averageMarkerMean(options, cats, columns, lines, warnings, addsOver);
  // The anomaly rule reads every source period of the one line, before a window or zoom.
  const anomalyRun = options.anomaly
    ? comboAnomalyModel(options.anomaly, cats, lines, secondarySpec, valueSpec, pctFmt, options.locale?.language, warnings, options.strings)
    : undefined;
  const population = applyCategoryViewport({ domain: options.viewDomain, window: options.window, categories: cats, series: seriesNorm,
    plotted: [], basis: [], targets: [], annotations: options.annotations });
  checkPointBudget(cats.length, seriesNorm.length, COMBO_LIMIT, 'a combo chart');
  // A mean keeps every source period, and its label names them where the plot draws fewer.
  const meanSpan = viewportMeanSpan(population);
  const shown = population ? population.annotations : options.annotations;
  const marker = averageMean === undefined
    ? undefined
    : { ...averageMarkerLine(shown ?? [], averageMean, (v) => formatStatWithSpec(v, valueSpec.spec), meanSpan(), options.strings?.average), side: 'right' as const };
  const averageMarkerId = marker?.id;
  const annotations = marker ? [...(shown ?? []), marker] : shown;
  const effective = population
    ? liveWindowOptions({ ...options, annotations }, population.sampling)
    : marker ? { ...options, annotations } : options;

  // Stack totals (column part), then the primary and secondary extents.
  const { stackTotals, posTop, negBot, anyByCat, lo: stackLo, hi: stackHi } = comboStacks(cats, columns);
  const incompleteCats = new Set(cats.filter((_, ci) => anyByCat[ci] && columns.some(s => s.vals[ci]!.v === null)).map(c => c.id));
  if (columnsAdd) warnIncompleteStacks('stacked', cats, incompleteCats,
    options.labels !== false && options.labels?.grandTotal !== false, false, 'columns', warnings, disclosuresShown(options));
  // rounding 'sum-consistent' (the default): the segment shares of each whole stack (no negative
  // or missing part, an authored percent nowhere) print so they add up to 100%.
  const shareTexts = new Map<string, string>();
  const roundingAdjustments: RoundingAdjustment[] = [];
  if (options.rounding !== 'nearest' && columns.length > 1) cats.forEach((c, ci) => {
    if (!anyByCat[ci] || negBot[ci]! < 0 || !(posTop[ci]! > 0) || incompleteCats.has(c.id) || columns.some((s) => s.vals[ci]!.isPct)) return;
    const shares = columns.map((s) => (s.vals[ci]!.v! / posTop[ci]!) * 100);
    const rounded = sumConsistentShares(shares, options.locale?.language);
    if (rounded?.warning) warnings.push(roundingUnavailable(c.label ?? c.id, rounded.warning));
    else if (rounded) columns.forEach((s, si) => {
      shareTexts.set(`${c.id}\0${s.id}`, rounded.texts[si]!);
      if (rounded.moved[si]) roundingAdjustments.push({ whole: c.label ?? c.id, part: s.label, share: Math.round(shares[si]! * 1e4) / 1e4,
        nearest: formatShare(shares[si]!, options.locale?.language), printed: rounded.texts[si]! });
    });
  });
  let lo = stackLo, hi = stackHi;
  // A pinned secondary domain is the start and data only widen it (rightAxis), so a pinned minimum above zero stays.
  // A secondary area fills down to zero, so it keeps zero in the domain.
  const pinnedSecondary = secondaryActive && !lines.some((s) => s.axis === 'secondary' && s.kind === 'area') ? gate.secOpt?.domain : undefined;
  let sLoRaw = pinnedSecondary?.[0] ?? 0;
  let sHiRaw = pinnedSecondary?.[1] ?? 0;
  for (const s of [...lines, ...refs]) {
    const secondary = s.axis === 'secondary' && secondaryActive && s.role !== 'reference';
    for (const val of s.vals) {
      if (val.v === null) continue;
      if (secondary) {
        sLoRaw = Math.min(sLoRaw, val.v);
        sHiRaw = Math.max(sHiRaw, val.v);
      } else {
        lo = Math.min(lo, val.v);
        hi = Math.max(hi, val.v);
      }
    }
  }
  if (secondaryActive && sLoRaw === 0 && sHiRaw === 0) sHiRaw = 1;
  // A drawn value line is part of the stated range (valueLineDomain.ts), so it
  // seeds the axis it names. Both axes only ever WIDEN with an authored bound
  // (primaryDomain above, secOpt.domain and the ladder in rightAxis), so the
  // line is always visible rather than refused.
  const dataHi = hi; // the ruler warning speaks about plotted values, not value lines
  const primaryLine = axisValueLines(effective.annotations, 'primary');
  if (primaryLine) {
    lo = Math.min(lo, primaryLine.lo);
    hi = Math.max(hi, primaryLine.hi);
  }
  const secondaryLine = secondaryActive ? axisValueLines(effective.annotations, 'secondary') : null;
  if (secondaryLine) {
    sLoRaw = Math.min(sLoRaw, secondaryLine.lo);
    sHiRaw = Math.max(sHiRaw, secondaryLine.hi);
  }
  if ((options as { [SECONDARY_FULL_DOMAIN]?: readonly [number, number] })[SECONDARY_FULL_DOMAIN]) {
    const mapped = secondaryPrimaryRange(options, [sLoRaw, sHiRaw], [lo, hi]);
    lo = Math.min(lo, mapped[0]);
    hi = Math.max(hi, mapped[1]);
  }
  let primary = primaryDomain(effective, gate, { lo, hi, dataHi }, fmt, warnings);
  // the anatomy is drawn whole or not at all. Authored primary
  // bounds pin the scale its solver would choose, and a negative value keeps
  // a scale from starting at zero; either way the plain dual axis stays and
  // an info lint says why.
  const anatomyRequested = dualAxisAnatomy(options, secondaryActive, theme);
  const pinnedBy = [options.valueAxis?.min !== undefined ? 'valueAxis.min' : '', options.valueAxis?.max !== undefined ? 'valueAxis.max' : ''].filter(Boolean);
  const negative = lo < 0 || sLoRaw < 0;
  const anatomy = anatomyRequested && pinnedBy.length === 0 && !negative;
  if (anatomyRequested && !anatomy) {
    warnings.push({
      code: 'dual-axis-anatomy-off', severity: 'info',
      message: pinnedBy.length > 0
        ? `dual-axis anatomy not drawn: ${pinnedBy.join(' and ')} pin the primary scale the anatomy chooses`
        : 'dual-axis anatomy not drawn: a negative value keeps a scale from starting at zero',
      suggest: pinnedBy.length > 0 ? `drop ${pinnedBy.join(' and ')} to let the anatomy choose both scales` : 'the plain dual axis is drawn',
    });
  }
  const bandEligible = secondaryActive && columns.length > 0 && !gate.secOpt?.domain && pinnedBy.length === 0 && !negative
    && options.dualAxis?.anatomy !== false;
  const defaultPrimary = primary;
  const lineBandScaleInput = bandEligible
    ? {
      columnTops: posTop, columnBottoms: negBot, primaryHi: hi,
      lines: lines.filter((s) => s.axis === 'secondary').map((s) => s.vals.map((val) => val.v)),
      secondaryHi: sHiRaw, bandFraction: comboBandFraction(options, cats.length),
      clearance: (options as { [LINE_BAND_CLEARANCE]?: number })[LINE_BAND_CLEARANCE],
    }
    : undefined;
  const shared = lineBandScaleInput ? dualAxisScales(lineBandScaleInput) : undefined;
  if (shared) primary = { dLo: 0, dHi: shared.pticks[shared.pticks.length - 1]!, pticks: shared.pticks };
  // A negative value on either scale: the zeros share a gridline.
  const aligned = secondaryActive && !shared && !gate.secOpt?.domain && pinnedBy.length === 0 && negative
    ? zeroAlignedAxes(primary, { lo: sLoRaw, hi: sHiRaw })
    : undefined;
  if (aligned) primary = aligned.primary;
  const right = rightAxis(effective, gate, { lo: sLoRaw, hi: sHiRaw }, primary, secondarySpec,
    shared ? { step: shared.secondaryStep, start: 0 } : aligned?.secondary);
  const fmtSecondary = secondarySpec.fmt;
  const beforeCorridor = warnings.slice();
  const anomalyFor = (left: typeof primary, rightDomain: [number, number] | undefined, out: LintWarning[]): LineAnomaly | undefined => {
    const extent: [number, number] | undefined = anomalyRun?.onSecondary ? rightDomain : [left.dLo, left.dHi];
    return anomalyRun && extent && {
      model: anomalyRun.anomaly, seriesId: anomalyRun.seriesId, statFmt: anomalyRun.statFmt,
      ...anomalyCorridor(anomalyRun.anomaly, anomalyRun.values, extent[0], extent[1], anomalyRun.statFmt, out, options.strings),
    };
  };
  // The anatomy with every value labelled (each column value and each line
  // point) reads from its labels: neither tick column is drawn unless the
  // author asks for the axes, and a value without a seat brings both back
  // (TOTALS_AXIS).
  const everyValueLabelled = anatomy && shared !== undefined && columns.length > 0 && anomalyRun === undefined
    && comboValueLabels(options, true, cats.length) === 'all'
    && options.labels !== false && (options.labels === undefined || options.labels.grandTotal !== false)
    && (options as { [TOTALS_AXIS]?: true })[TOTALS_AXIS] !== true;
  const ticksFromLabels = everyValueLabelled && options.valueAxis?.show === undefined
    && (options.secondaryAxis as { show?: boolean } | undefined)?.show === undefined;
  const resolved: ComboDomain = {
    anomaly: anomalyFor(primary, right.secondaryDomain, warnings),
    options: effective,
    cats,
    data: dataSeries,
    columns,
    lines,
    refs,
    secondaryActive,
    secondaryTicksHidden: secondaryActive && ((options.secondaryAxis as { show?: boolean } | undefined)?.show === false || ticksFromLabels),
    ticksFromLabels,
    anatomy,
    lineBand: shared !== undefined,
    // Column totals already state the scale. An explicit axis still wins, and the axis comes
    // back when a total found no seat (TOTALS_AXIS): then the totals no longer state it.
    showPrimaryAxis: options.valueAxis?.show ?? (ticksFromLabels ? false : secondaryActive || options.labels === false
      || (options as { [TOTALS_AXIS]?: true })[TOTALS_AXIS] === true ||
      (columns.length > 0 && columnsAdd && (options.labels === undefined || options.labels.grandTotal !== false)
        ? false : primaryLinesUnlabelled(options, lines, secondaryActive))),
    interpolationFor: (series: NormSer): LineInterpolation =>
      series.smooth === true ? 'monotone' : series.smooth === false ? 'linear' : chartInterpolation,
    fmt,
    valueSpec: valueSpec.spec,
    pctFmt,
    // A secondary '%' series prints its '%' like the right axis does.
    scaleFmtOf: (s: NormSer) => (s.axis === 'secondary' && secondaryActive ? (s.unit === '%' ? secondarySpec.fmtPercent : fmtSecondary) : fmt),
    explicitFormatOf: (s, value) => value.format ?? s.format ?? (s.axis === 'secondary' && secondaryActive ? undefined : options.format),
    // Fallback is the SECONDARY scale group's raster, not the primary fmt: the
    // right axis is a different unit, and integer revenue must not strip the
    // decimal off a 48.3-units marker display (the per-scale raster).
    secFmt: right.secFmtSrc ? formatterFromExample(right.secFmtSrc, options.locale?.language) : fmtSecondary,
    sourceMean,
    meanSpan,
    averageMarkerId,
    stackTotals,
    shareTexts,
    roundingAdjustments,
    incompleteCats,
    columnsAdd,
    posTop,
    negBot,
    anyByCat,
    ...primary,
    secondaryDomain: right.secondaryDomain,
    rightTicks: ticksFromLabels ? [] : right.rightTicks,
  };
  if (lineBandScaleInput) resolved.withLineBandClearance = (clearance) => {
    const next = dualAxisScales({ ...lineBandScaleInput, clearance });
    if (shared?.secondaryStep === next?.secondaryStep && shared?.pticks.length === next?.pticks.length
      && !shared?.pticks.some((tick, i) => tick !== next!.pticks[i])) return undefined;
    const left = next ? { dLo: 0, dHi: next.pticks[next.pticks.length - 1]!, pticks: next.pticks } : defaultPrimary;
    const right = rightAxis(effective, gate, { lo: sLoRaw, hi: sHiRaw }, left, secondarySpec,
      next ? { step: next.secondaryStep, start: 0 } : undefined);
    const nextWarnings = [...beforeCorridor];
    // Without a pair that keeps the line above, the line crosses the columns
    // and the labels no longer stand in for the ticks.
    const axes = next || !resolved.ticksFromLabels ? {} : {
      ticksFromLabels: false, showPrimaryAxis: true,
      secondaryTicksHidden: (options.secondaryAxis as { show?: boolean } | undefined)?.show === false,
    };
    return { domain: { ...resolved, ...left, ...axes, lineBand: next !== undefined,
      secondaryDomain: right.secondaryDomain, rightTicks: next && resolved.ticksFromLabels ? [] : right.rightTicks,
      anomaly: anomalyFor(left, right.secondaryDomain, nextWarnings),
    }, warnings: nextWarnings };
  };
  return resolved;
}
