/** Cohort-specific consulting exhibit tables. The legacy heatmap adapter stays
 * untouched; this surface owns its explicit label/size/month tracks. */

import { chartString } from '../../strings/cohort';
import { liftOrFallback, missesSize, tightSpacingWarning } from '../tableFit';
import { chartTheme } from '../chartEnv';
import { authoredNotes, frameRendersUnit, frameTextOptions, legendOff, solveFrame, subtitleUnitClause, textCarriesCohortUnit, UNIT_LINE, withAuthoredFootnotes } from '../../frame';
import { formatExactNumber, formatAutomaticNumber, smallRateDecimals, numberRange } from '../../format';
import { roundHalfUp, typicalDecimals } from '../../formatPrecision';
import { numberFormat } from '../../numberFormatCache';
import { formatterFromExample } from '../../formatSpec';
import type { Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize, resolveSubtitle } from '../../normalize/shared';
import {
  paintColor,
  resolveSemanticPaletteTheme,
  resolveTheme,
  semanticPalettePaint,
  emphasisWeight,
  tableEmphasis,
  strokeToken,
  canvasMargin,
  spaceTokens,
  secondaryFont,
} from '../../theme';
import { staticFrame } from '../../footer';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { Geometry, LegendGeometry, LintWarning, Paint, SceneNode } from '../../types/scene';
import { deriveRetention, missingCohortRate } from './retention';
import { cohortFormula, cohortMeasure } from './wording';
import type {
  CohortCellMark,
  CohortData,
  CohortDerived,
  CohortMarks,
  CohortOptions,
  CohortSizeMark,
} from './types';
import { emphasisInk } from '../../markVisibility';
import { fieldHeadFont, fieldHeadText, headInk, headRule, totalGround, totalRule } from '../table/headFace';
import { tableRuleInk } from '../table/statement';
import { rowDrivenHeight } from '../../rowCanvas';
import { heightOmitted, rowSizing, SIZE_TOLERANCE, VERIFY_ADVICE } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { disclosureNote } from '../../notes';
import { fitColumn, fittedLabel, gutterBudget, stepDownFont } from '../../label/rowFit';
import type { FittedText } from '../../label/fitText';
import { textScaleOf } from '../../typeFloors';
import { maxOf, minOf, pushAll } from '../../arrays';

const LABEL_TRACK = 118;
const SIZE_TRACK = 96;
const ROW_H = 28;
/** The line under the average row that names each average's base. */
const BASE_LINE_H = 16;
const HEADER_H = 28;
const LEGEND_H = 18;
const BIN_TINTS = [0.94, 0.8, 0.58, 0.3, 0] as const;
/** The tight retry (refuse-less): which air shrinks, the tracks' and the rows'. */
const TIGHT_SPACING = Symbol('cohortTightSpacing');
/** How a rate that rounds to 0 prints: full digits (default), the plain rounded text, or one scientific digit. */
const COHORT_LIFT = Symbol('cohortZeroLift');
/** Regular tracks before the row names fit the narrower frame. */
const REGULAR_WIDTH = Symbol('cohortRegularWidth');
/** The compact form (phones): the size header, column ranges and average bases take two lines where one is too wide. */
const STACKED_TEXT = Symbol('cohortStackedText');
/** Periods the compact form leaves out for room; a note names them. */
const HIDDEN_PERIODS = Symbol('cohortHiddenPeriods');
/** A canvas tall enough that no row or note of the compact form misses it: the column search reads the width alone. */
const PROBE_HEIGHT = 4000;
type ExhibitOptions = CohortOptions & { [TIGHT_SPACING]?: { columns: boolean; rows: boolean; names?: boolean }; [COHORT_LIFT]?: 'none' | 'compact';
  [STACKED_TEXT]?: boolean; [HIDDEN_PERIODS]?: number[] };

interface ExhibitRow {
  id: Id;
  label: string;
  base: number;
  retention: (number | null)[];
  observedPeriods: number;
  kind: 'cohort' | 'total';
}

export function layoutCohortExhibit(
  sourceData: CohortData,
  options: CohortOptions,
): ReturnType<typeof buildExhibit> {
  if (options.format || (options as ExhibitOptions)[COHORT_LIFT] !== undefined) return layoutCohortExhibitOnce(sourceData, options);
  // A lifted rate ("0.0000000001") is wider than the plain "0.0". Where that costs a refusal, a squeeze, tight spacing
  // or a hidden label the plain text does not cost, the rate prints one scientific digit; where that does too, the plain text.
  return liftOrFallback((mode) => layoutCohortExhibitOnce(sourceData, mode === 'full' ? options : { ...options, [COHORT_LIFT]: mode } as ExhibitOptions),
    (lifted, plain) => costsWidth(lifted, plain, options));
}

/** Whether `lifted` misses its frame, is squeezed below its natural width or warns where `plain` does not. */
function costsWidth(lifted: ReturnType<typeof buildExhibit>, plain: ReturnType<typeof buildExhibit>, options: CohortOptions): boolean {
  const open = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed;
  const fixedWidth = open?.width !== false && options.size !== undefined;
  const misses = (geometry: ReturnType<typeof buildExhibit>) => geometry.sizing !== undefined
    && ((open?.width !== false && geometry.size.width + 0.5 < geometry.sizing.minWidth)
      || (open?.height !== false && !heightOmitted(options.size) && geometry.size.height + 0.5 < geometry.sizing.minHeight));
  const squeezed = (geometry: ReturnType<typeof buildExhibit>) => fixedWidth && geometry.size.width + 0.5 < (geometry.sizing?.naturalWidth ?? 0);
  if (misses(plain)) return false;
  if (misses(lifted) || (squeezed(lifted) && !squeezed(plain))) return true;
  const before = new Set(plain.warnings.map((warning) => warning.code));
  return lifted.warnings.some((warning) => !before.has(warning.code));
}

function layoutCohortExhibitOnce(
  sourceData: CohortData,
  options: CohortOptions,
): ReturnType<typeof buildExhibit> {
  const warnings: LintWarning[] = [];
  const data = options.excludeCurrentPeriod ? withoutCurrentPeriod(sourceData) : sourceData;
  const basis = options.basis ?? 'cohort';
  const totals = options.total ?? 'weighted';
  const result = deriveRetention(data, { basis, averages: false });
  pushAll(warnings, result.warnings);
  const derived = result.derived;
  const available = Array.from({ length: derived.periodCount }, (_, index) => index);
  const visible = normalizeVisiblePeriods(options.visiblePeriods, available, warnings);
  // An authored period the exhibit does not show would tint nothing, silently.
  if (options.designatedPeriod !== undefined && options.variant === 'pure' && !visible.includes(options.designatedPeriod)) {
    warnings.push({
      code: 'designated-period-out-of-range',
      severity: 'warn',
      message: `designatedPeriod ${options.designatedPeriod} is not one of the ${visible.length} periods the exhibit shows; no column is emphasised`,
      suggest: 'pick a zero-based period index the exhibit shows',
    });
  }
  const total = totals === 'weighted' ? deriveExhibitTotal(derived) : undefined;
  const outputDerived: CohortDerived = {
    ...derived,
    visiblePeriods: visible,
    ...(total ? { total } : {}),
    ...(options.excludeCurrentPeriod ? { excludedCurrentPeriod: true } : {}),
  };
  const removed = sourceData.cohorts[sourceData.cohorts.length - 1]!;
  const exclusion = options.excludeCurrentPeriod
    ? disclosureNote(/^de(?:-|$)/i.test(options.locale?.language ?? '')
      ? `Ausgeschlossen: laufende Periode. Kohorte ${removed.label ?? removed.id}; letzte Beobachtung jeder früheren Kohorte.`
      : `Excluded: running period. Cohort ${removed.label ?? removed.id}; last observation of each earlier cohort.`)
    : undefined;
  const full = buildExhibit(data, outputDerived, visible, options, [...warnings], exclusion);
  // Refuse-less: track air is a preference. Where the regular tracks miss a fixed
  // width, the tracks shrink to their text plus a 4 px gap; where they miss a fixed height, the rows
  // shrink to their text plus 6 px (3 px clear of the rules). The tight table draws only if it hides no
  // label; else the refusal stands. The warning names the size that keeps regular spacing.
  const misses = missesSize(full, options);
  const { width: missesWidth, height: missesHeight } = misses;
  if (options.belowMinimum === 'refuse' || !full.sizing || !(missesWidth || missesHeight)) return full;
  const tightWith = (names: boolean) => buildExhibit(data, outputDerived, visible, { ...options, [TIGHT_SPACING]: { columns: missesWidth, rows: missesHeight, names } }, [...warnings], exclusion);
  let tight = tightWith(false);
  // One step tighter, only where the tight table still misses the width by no more than the 8 px it saves:
  // the name track keeps a 4 px gap, as every other track does. It counts only when it hides no label.
  if (missesWidth && tight.sizing && tight.size.width + 0.5 < tight.sizing.minWidth && tight.sizing.minWidth - tight.size.width <= 8) {
    const tighter = tightWith(true);
    if (!tighter.labels.some((label) => label.hidden === 'collision')) tight = tighter;
  }
  const hides = (geometry: ExhibitGeometry) => geometry.labels.some((label) => label.hidden === 'collision');
  // The compact form, for a phone card where the tight table still misses the width or hides a label:
  // secondary text takes two lines, then the period-0 column goes where every rate in it is 100 by
  // construction, then the latest periods go. A note names each column left out. An authored
  // `visiblePeriods` list is the author's choice: the compact form keeps every period in it but that anchor.
  const compactForm = missesWidth && options.mode === 'compact' && (hides(tight) || missesSize(tight, options).width);
  if (compactForm) {
    // The columns are chosen on the width alone: a pinned height that the compact table misses is
    // a size refusal that names that height, not a reason to leave out more periods.
    const at = (periods: number[], widthOnly = false) => {
      const hidden = visible.filter((period) => !periods.includes(period));
      const leftOut = hidden.filter((period) => period !== 0);
      return buildExhibit(data, { ...outputDerived, visiblePeriods: periods, ...(leftOut.length > 0 ? { periodsLeftOut: leftOut } : {}) }, periods, {
        ...options, [TIGHT_SPACING]: { columns: true, rows: missesHeight, names: true }, [STACKED_TEXT]: true,
        ...(widthOnly ? { size: { width: full.size.width, height: Math.max(full.size.height, PROBE_HEIGHT) } } : {}),
        ...(hidden.length > 0 ? { [HIDDEN_PERIODS]: hidden } : {}),
      }, [...warnings], exclusion);
    };
    const draws = (geometry: ExhibitGeometry) => !hides(geometry) && !missesSize(geometry, options).width;
    let columns = visible;
    // The period-0 column prints 100 in every row by construction, so leaving it out loses no number.
    const anchorFull = visible[0] === 0 && visible.length > 1 && derived.cohorts.every((row) => row.observedPeriods === 0 || row.retention[0] === 1);
    let fits = draws(at(visible, true));
    if (!fits && anchorFull) {
      columns = visible.slice(1);
      fits = draws(at(columns, true));
    }
    if (!fits && options.visiblePeriods === undefined) {
      const candidates = columns;
      // The earliest periods compare the most cohorts at one age; a designated column stays in.
      const kept = (count: number) => {
        const first = candidates.slice(0, count);
        const designated = options.variant === 'pure' ? options.designatedPeriod : undefined;
        return designated === undefined || first.includes(designated) || !candidates.includes(designated)
          ? first : [...first.slice(0, count - 1), designated];
      };
      let low = 0;
      let high = candidates.length;
      while (high - low > 1) {
        const count = Math.floor((low + high) / 2);
        if (draws(at(kept(count), true))) low = count; else high = count;
      }
      // Where no count draws, the refusal names the size of the smallest compact table.
      columns = kept(Math.max(1, low));
    }
    tight = at(columns);
    // Labels lost to a height that the compact table misses: a pinned height gets the size refusal
    // that names it, a height the chart takes is laid out again at the compact table's natural height.
    if (hides(tight) && (missesSize(tight, options).height || (tight.sizing?.naturalHeight ?? 0) > tight.size.height + SIZE_TOLERANCE)) return tight;
  }
  if (hides(tight)) return full;
  if (compactForm) {
    // The compact form's full table is a full-mode layout, in a theme the compact call does not
    // carry, so no size from here would hold: the advice names the call that measures it.
    const hidden = visible.filter((period) => !(tight.derived.visiblePeriods ?? visible).includes(period));
    tight.warnings.push({ code: 'table-tight-spacing', severity: 'warn',
      message: `Cell air and column gaps were reduced${hidden.length > 0 ? `, and ${hidden.length} period column${hidden.length === 1 ? ' was' : 's were'} left out,` : ''} to fit the cohort table.`,
      suggest: "Measure the spec with mode 'full' for the size that draws the whole table at regular spacing.",
      field: ['options', 'size'] });
    return tight;
  }
  // Only measure verifies advice with layouts. Render reuses the measured
  // tracks and accounts for the type and margin steps at the wider frame.
  const verify = (options as { [VERIFY_ADVICE]?: boolean })[VERIFY_ADVICE] === true;
  let repair = full;
  for (let pass = 0; verify && pass < 6 && repair.sizing; pass++) {
    const size = { width: Math.ceil(Math.max(repair.size.width, repair.sizing.minWidth)),
      height: Math.ceil(Math.max(repair.size.height, repair.sizing.minHeight)) };
    if (size.width === repair.size.width && size.height === repair.size.height) break;
    repair = buildExhibit(data, outputDerived, visible, { ...options, size }, [], exclusion);
  }
  const warning = tightSpacingWarning(misses, { width: 'cell air and column gaps', height: 'row air' }, 'the cohort table', 'regular',
    verify ? { ...repair, sizing: repair.sizing! } : estimatedRegularSize(full, options), options);
  if (!verify) warning.message = warning.message.replace('regular spacing needs', 'the estimated size for regular spacing is')
    + ' Use measure for the verified size.';
  tight.warnings.push(warning);
  return tight;
}

/** The already measured tracks, enlarged for any type or margin breakpoint the repair crosses. */
function estimatedRegularSize(full: ExhibitGeometry, options: CohortOptions) {
  const theme = chartTheme(options);
  const chrome = full.size.width - full.plot.w;
  const content = full[REGULAR_WIDTH];
  let width = Math.ceil(Math.max(full.size.width, full.sizing!.minWidth, content + chrome));
  let scale = 1;
  // Width can cross S/M/L and margin steps; this is arithmetic, never a layout.
  for (let pass = 0; pass < 4; pass++) {
    const wider = chartTheme({ ...options, size: { width } });
    scale = Math.max(scale, ...(['label', 'axis', 'title', 'subtitle', 'footnote'] as const)
      .map(role => wider.type[role].size / theme.type[role].size));
    const margin = options.margin?.left === undefined
      ? canvasMargin(wider, width).left - canvasMargin(theme, full.size.width).left : 0;
    const next = Math.ceil(Math.max(width, content * scale + chrome + margin));
    if (next === width) break;
    width = next;
  }
  const height = Math.ceil(Math.max(full.size.height, full.sizing!.minHeight) * scale);
  return { size: { width, height }, sizing: { minWidth: width, minHeight: height } };
}

function deriveExhibitTotal(derived: CohortDerived): { base: number; retention: (number | null)[] } {
  const base = derived.cohorts.reduce((sum, row) => sum + row.base, 0);
  const retention = Array.from({ length: derived.periodCount }, (_, period) => {
    if (derived.cohorts.some(row => missingCohortRate(row, period, derived.basis))) return null;
    let numerator = 0;
    let denominator = 0;
    for (const row of derived.cohorts) {
      if (period >= row.observedPeriods || row.retention[period] === null) continue;
      const rowDenominator =
        derived.basis === 'cohort' || period === 0 ? row.base : row.active[period - 1]!;
      if (rowDenominator === 0) continue;
      const rowNumerator = row.active[period]!;
      numerator += rowNumerator;
      denominator += rowDenominator;
    }
    return denominator === 0 ? null : numerator / denominator;
  });
  return { base, retention };
}

function withoutCurrentPeriod(data: CohortData): CohortData {
  if (!Array.isArray(data.cohorts) || data.cohorts.length <= 2) {
    throw new NormalizeError(
      'cohort-current-period-exclusion-empty',
      'options.excludeCurrentPeriod',
      'excluding the running month would leave fewer than two completed cohorts',
      'keep the current month or supply at least three cohorts',
    );
  }
  return {
    ...data,
    cohorts: data.cohorts.slice(0, -1).map((cohort) => ({
      ...cohort,
      active: cohort.active.slice(0, -1),
    })),
  };
}

function normalizeVisiblePeriods(
  requested: number[] | undefined,
  available: number[],
  warnings: LintWarning[],
): number[] {
  if (requested === undefined) return available;
  const allowed = new Set(available);
  const seen = new Set<number>();
  const visible: number[] = [];
  const ignored: number[] = [];
  for (const index of requested) {
    if (!allowed.has(index) || seen.has(index)) {
      ignored.push(index);
      continue;
    }
    seen.add(index);
    visible.push(index);
  }
  visible.sort((a, b) => a - b);
  if (ignored.length > 0) {
    warnings.push({
      code: 'cohort-period-filter-ignored',
      severity: 'warn',
      message: `visiblePeriods ignored duplicate or unavailable indices: ${ignored.join(', ')}`,
      suggest: `choose unique indices between 0 and ${available.length - 1}`,
    });
  }
  if (visible.length === 0) {
    throw new NormalizeError(
      'cohort-period-filter-empty',
      'options.visiblePeriods',
      'visiblePeriods hides every available period',
      `choose at least one index between 0 and ${available.length - 1}`,
    );
  }
  return visible;
}

type ExhibitGeometry = Geometry<CohortMarks, CohortDerived> & { [REGULAR_WIDTH]: number };

function exhibitRows(data: CohortData, derived: CohortDerived, options: CohortOptions): ExhibitRow[] {
  const rows: ExhibitRow[] = derived.cohorts.map((row, index) => ({
    id: row.id,
    label: data.cohorts[index]!.label ?? data.cohorts[index]!.id,
    base: row.base,
    retention: row.retention,
    observedPeriods: row.observedPeriods,
    kind: 'cohort',
  }));
  if (derived.total) {
    const usedIds = new Set(rows.map(row => row.id));
    let totalId = 'cohort-total';
    while (usedIds.has(totalId)) totalId = `_${totalId}`;
    rows.push({
      id: totalId,
      label: chartString(options, 'total'),
      base: derived.total.base,
      retention: derived.total.retention,
      observedPeriods: derived.periodCount,
      kind: 'total',
    });
  }
  return rows;
}

/**
 * The rate formatter of an exhibit. An authored format is one spec for every
 * cell. Automatic precision keeps the existing whole-exhibit 0/1 default.
 * Only a rate that would print as zero gets extra decimals.
 */
function retentionFormatter(options: CohortOptions, rows: readonly ExhibitRow[], compact?: (text: string) => boolean): (retention: number, period: number) => string {
  const suffix = options.showPercentSign ? '%' : '';
  if (options.format) {
    const format = formatterFromExample(options.format, options.locale?.language, undefined, rows.flatMap((row) => row.retention.map((value) => value == null ? null : value * 100)));
    return (retention) => `${format(retention * 100)}${suffix}`;
  }
  // One decimal count for the whole exhibit: a rate that needs
  // its tenth gives every cell one, so "64.0" never stands beside "51".
  const whole = (value: number) => Number((value * 100).toFixed(1)) % 1 === 0;
  const decimals = rows.some((row) => row.retention.some((value, period) =>
    period > 0 && period < row.observedPeriods && value !== null && value !== undefined && (!whole(value) || smallRateDecimals(value * 100) > 0))) ? 1 : 0;
  // A period whose rates all sit below 1 takes its own precision (typicalDecimals): 0.001 and 0.039 stay apart, not "<0.1".
  const own = new Map<number, number>();
  const decimalsAt = (period: number) => own.get(period) ?? own.set(period, Math.max(decimals, typicalDecimals(rows.flatMap((row) => {
    const value = row.retention[period];
    return period < row.observedPeriods && value !== null && value !== undefined ? [value * 100] : [];
  })))).get(period)!;
  const lift = (options as ExhibitOptions)[COHORT_LIFT];
  return (retention, period) => {
    const percent = retention * 100;
    const decimals = decimalsAt(period);
    const text = formatAutomaticNumber(percent, { locale: options.locale?.language, decimals, automatic: lift !== 'none' });
    // A fixed width must still draw the nonzero rate when its decimal string cannot fit.
    const zeroed = lift !== 'none' && percent !== 0 && Number(roundHalfUp(Math.abs(percent), decimals)) === 0;
    return `${zeroed && (lift === 'compact' || compact?.(text + suffix))
      ? numberFormat(options.locale?.language ?? 'en-US', { notation: 'scientific', maximumSignificantDigits: 1 }).format(percent)
      : text}${suffix}`;
  };
}

function exhibitTracks(rows: ExhibitRow[], visible: number[], data: CohortData, options: ExhibitOptions, font: FontSpec, measure: TextMeasurer, format = retentionFormatter(options, rows), stackFont = font, head?: { font: FontSpec; text: string }) {
  const tight = options[TIGHT_SPACING]?.columns === true;
  // Tight tracks keep 4 px of air; the compact form keeps the 6 px gap between value labels.
  const air = options[STACKED_TEXT] ? 6 : 4;
  // The compact form measures a wrapping text by its wider line, in the font it draws it in.
  const width = (text: string, wrapFont = stackFont) => options[STACKED_TEXT] ? maxOf(twoLines(text, wrapFont, measure).map((line) => measure(line, wrapFont).width)) : measure(text, font).width;
  const label = Math.max(tight ? 0 : LABEL_TRACK, maxOf(rows.map((row) => measure(row.label, font).width + (tight ? 4 : 12))));
  // The size head prints in the field-head face; it is measured in both faces, so a theme switch keeps the track.
  const sizeHead = Math.max(width(options.cohortSizeLabel ?? chartString(options, 'cohortSize'), font),
    head ? (options[STACKED_TEXT] ? width(head.text, head.font) : measure(head.text, head.font).width) : 0);
  const size = Math.max(tight ? 0 : SIZE_TRACK, sizeHead + (tight ? air : 18),
    maxOf(rows.map((row) => measure(formatAutomaticNumber(row.base, { locale: options.locale?.language, ...{ decimals: 0 } }), font).width + (tight ? air : 18))));
  const values = rows.flatMap((row) => visible.flatMap((period) => {
    const value = row.retention[period];
    return period >= row.observedPeriods || value === null || value === undefined ? [] : [format(value, period)];
  }));
  // Normal labels resolve to 56–72px. Authored formats or fonts may need more.
  const support = visible.flatMap(period => {
    const observed = rows.filter(row => row.kind !== 'total' && period < row.observedPeriods);
    const rates = observed.flatMap(row => row.retention[period] == null ? [] : [row.retention[period]!]);
    return [
      ...(rows.some(row => row.kind === 'total') && options.basis !== 'previous'
        ? [chartString(options, 'baseValue', { value: formatAutomaticNumber(observed.reduce((sum, row) => sum + row.base, 0), { locale: options.locale?.language, decimals: 0 }) })] : []),
      ...(options.variant === 'stepped' && (options.formatScope ?? 'column') === 'column'
        ? rates.length ? [numberRange(format(minOf(rates), period), format(maxOf(rates), period))] : [] : []),
    ];
  });
  const month = Math.max(tight ? 0 : 56, maxOf([...visible.map((period) => periodName(data.periodLabel, period, options.locale?.language)), ...values]
    .map((text) => measure(text, font).width + (tight ? air : 16))), maxOf(support.map((text) => width(text) + (tight ? air : 16))));
  return { label, size, month };
}

function pureEmphasis(options: CohortOptions, period: number, value: number): boolean {
  return options.threshold !== false && period !== 0 && value * 100 > (options.threshold ?? 60);
}

/**
 * The anchor and blank-cell convention is a method note. The weighting
 * is required, and so is the formula under basis 'previous', which changes
 * what every rate means.
 */
function exhibitNotes(data: CohortData, derived: CohortDerived, options: CohortOptions, visible: readonly number[]): string[] {
  const methodNote = options.methodNote === true;
  const first = periodName(data.periodLabel, 0, options.locale?.language);
  const hidden = (options as ExhibitOptions)[HIDDEN_PERIODS] ?? [];
  const later = hidden.filter((period) => period !== 0);
  const formula = [
    ...(hidden.includes(0) ? [disclosureNote(chartString(options, 'anchorHidden', { period: first }))] : []),
    ...(later.length > 0 ? [disclosureNote(chartString(options, 'periodsHidden', { periods: periodRuns(data.periodLabel, later, options.locale?.language) }))] : []),
    ...(methodNote || derived.basis === 'previous' ? [cohortFormula(options, derived.basis)] : []),
    ...(derived.cohorts.some(row => visible.some(period => missingCohortRate(row, period, derived.basis))) ? [disclosureNote(chartString(options, 'missingExhibit'))] : []),
  ];
  const anchor = visible.includes(0);
  const basis = chartString(options, derived.basis === 'previous' ? 'previousBasis' : 'cohortBasis');
  if (options.variant !== 'stepped') return [
    ...formula,
    ...(methodNote ? [disclosureNote(chartString(options, 'emptyUnobserved', { anchor: anchor ? chartString(options, 'anchorClause', { period: first }) : '' }))] : []),
    // The bold rates are an encoding; the note names it.
    ...(exhibitRows(data, derived, options).some(row => row.kind !== 'total' && visible.some(period => {
      const value = row.retention[period];
      return period < row.observedPeriods && value != null && pureEmphasis(options, period, value);
    })) ? [disclosureNote(chartString(options, 'bold', { measure: cohortMeasure(options).toLocaleLowerCase(options.locale?.language ?? 'en'), threshold: formatExactNumber(typeof options.threshold === 'number' ? options.threshold : 60, options.locale?.language), after: anchor ? chartString(options, 'afterPeriod', { period: first }) : '' }))] : []),
    ...(derived.total ? [chartString(options, 'weightedTotal', { basis })] : []),
  ];
  const weighting = derived.total ? chartString(options, 'weightedObserved', { basis }) : '';
  if (!methodNote) return [...formula, ...(weighting ? [weighting] : [])];
  return [...formula, disclosureNote(chartString(options, 'steppedBlank', { anchor: anchor ? chartString(options, 'positiveAnchor', { period: first }) : '', weighting: weighting ? ` ${weighting}` : '' }))];
}

function buildExhibit(
  data: CohortData,
  derived: CohortDerived,
  visible: number[],
  options: ExhibitOptions,
  warnings: LintWarning[],
  exclusion?: string,
): ExhibitGeometry {
  const style = options.variant!;
  const scope = style === 'pure' ? 'classic' : options.formatScope ?? 'column';
  if (style === 'pure' && options.formatScope === 'column') {
    warnings.push({
      code: 'cohort-format-scope-ignored',
      severity: 'warn',
      message: "formatScope 'column' was ignored — Pure Exhibit uses the absolute threshold by design",
      suggest: "remove formatScope, or use variant 'stepped'",
    });
  }
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const size = resolveSize(options.size);
  const tightRows = options[TIGHT_SPACING]?.rows === true;
  const rowAir = tightRows ? 6 : 8;
  let rowH = Math.max(tightRows ? 0 : ROW_H, theme.type.label.size * (theme.type.label.lineHeight ?? 1.2) + rowAir);
  let headerRowH = Math.max(tightRows ? 0 : HEADER_H, theme.type.axis.size * (theme.type.axis.lineHeight ?? 1.2) + rowAir);
  const baseRowH = Math.max(BASE_LINE_H, theme.type.label.size * (theme.type.label.lineHeight ?? 1.2) + 4);
  const measure = options.measure ?? defaultMeasurer;
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { top: options.exhibitLabel ? 38 : 20, right: 16, bottom: 14, left: canvasMargin(theme, size.width).left, ...options.margin };
  const methodFootnotes = exhibitNotes(data, derived, options, visible);
  const authored = authoredNotes(options);
  const ownFootnotes = authored.filter(note => note !== exclusion);
  // The retained engine disclosure must not become an ordinary numbered note.
  const frameOptions = ownFootnotes.length === authored.length ? options
    : withAuthoredFootnotes(options, authored, ownFootnotes);
  const rowData = exhibitRows(data, derived, options).map((row) => style === 'stepped' && row.kind === 'total' ? { ...row, label: chartString(options, 'weightedAverage') } : row);
  const totalId = rowData.find(row => row.kind === 'total')?.id;
  let formatValue = retentionFormatter(options, rowData);
  const measureName = cohortMeasure(options);
  const unit = options.unit?.trim() || '%';
  const carriesUnit = (text: string) => textCarriesCohortUnit(text, unit);
  // Only structured fields state the unit: a "5%" in a message title or a
  // subtitle period does not tell the reader what the bare rates are.
  const subtitle = resolveSubtitle(options.subtitle);
  const measureHasUnit = subtitle !== undefined && carriesUnit(subtitle.measure);
  const authoredUnit = options.unit?.trim();
  // The render pipeline's unit line (UNIT_LINE) also states it.
  const subtitleUnit = measureHasUnit || (options as { [UNIT_LINE]?: string })[UNIT_LINE] !== undefined ||
    (subtitle !== undefined && !!authoredUnit && frameRendersUnit({ subtitle, unit: authoredUnit }));
  const footnotes = [...ownFootnotes, ...(exclusion ? [exclusion] : []), ...methodFootnotes];
  // A pinned static frame prints the notes above the source. The source rule then stands above the notes.
  const ruleOverNotes = staticFrame.pinned && options.source !== undefined && footnotes.length > 0;
  const frame = solveFrame(
    {
      size,
      margin,
      // A measure that already names the unit keeps it once ("Retention percent", not "… in %").
      ...frameTextOptions(measureHasUnit && options.unit !== undefined ? { ...frameOptions, unit: undefined } : frameOptions),
      footnotes,
      theme,
      measure,
    },
    occupied,
  );
  const nodes: SceneNode[] = [...frame.nodes];
  const requests: LabelRequest[] = [];
  const fontById = new Map<Id, FontSpec>();
  const labelInk = new Map<Id, Paint>();
  const cellPaints = new Map<Id, Paint>();
  const marks: CohortMarks = { cells: [], sizeCells: [] };
  // A subtitle cut by fitting may have lost its unit: read what the frame drew.
  const drawnSubtitle = frame.nodes.flatMap((node) => node.t === 'text' && node.id.startsWith('frame:subtitle') ? node.lines : []).join(' ');
  const needsUnit = options.unitShown !== true && !carriesUnit(formatValue(1, 0)) &&
    !(subtitleUnit && carriesUnit(drawnSubtitle));
  // The unit costs no line: it joins the key caption or the header's corner cell.
  const unitCaption = carriesUnit(measureName) ? measureName : `${measureName}${subtitleUnitClause(unit, measureName)}`;
  const totalGap = style === 'stepped' && derived.total ? 6 : 0;
  const trackFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: tableEmphasis(theme) };
  // Field heads (the corner and the size head) print in the table family's head face; period heads are values and keep theirs.
  const headFont = fieldHeadFont(theme);
  const sizeHead = { font: headFont, text: fieldHeadText(options.cohortSizeLabel ?? chartString(options, 'cohortSize'), theme) };
  // The compact form sets the column ranges and average bases in the secondary step (ticks and markers).
  const stackFont = secondaryFont(theme);
  let tracks = exhibitTracks(rowData, visible, data, options, trackFont, measure, formatValue, stackFont, sizeHead);
  const regularWidth = tracks.label + tracks.size + visible.length * tracks.month;
  const nameFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const rowNames = fitColumn(rowData.map(row => {
    const font = row.kind === 'total' ? { ...nameFont, weight: tableEmphasis(theme) } : nameFont;
    const cap = Math.max(24, frame.plot.w * 0.3 - 12);
    return { text: row.label, font, maxWidth: cap, maxLines: 2,
      wider: gutterBudget(cap, frame.plot.w, tracks.size + visible.length * tracks.month) - 12,
      shrink: stepDownFont(theme, font, 'label', options.target, textScaleOf(options)),
      target: options.target, textScale: textScaleOf(options), typeRole: 'label' as const };
  }), measure);
  const gap = options[TIGHT_SPACING]?.names === true ? 4 : 12;
  tracks.label = Math.max(measure(chartString(options, 'cohort'), nameFont).width + gap, measure(fieldHeadText(chartString(options, 'cohort'), theme), headFont).width + gap, maxOf(rowNames.map(name => name.w + gap)));
  rowH = Math.max(rowH, maxOf(rowNames.map(name => name.h + rowAir)));

  const fullWidth = tracks.label + tracks.size + visible.length * tracks.month;
  if (style === 'pure' && !options.format && frame.plot.w < fullWidth) {
    const rateWidth = tracks.month * Math.min(1, frame.plot.w / fullWidth) - 2;
    formatValue = retentionFormatter(options, rowData, text => measure(text, trackFont).width > rateWidth);
    const fitted = exhibitTracks(rowData, visible, data, options, trackFont, measure, formatValue, stackFont, sizeHead);
    tracks = { ...fitted, label: tracks.label };
  }

  const showSteppedLegend = style === 'stepped' && options.legend !== 'none';
  // Authored class boundaries for absolute fills.
  const steps = options.steps ?? DEFAULT_STEPS;
  // A measure that already names the unit gets no "(%)" after it.
  const caption = options.strings?.cohortMeasure
    ? `${measureName}${options.unit && !carriesUnit(measureName) ? ` (${options.unit})` : ''}`
    : options.unit ?? measureName;
  // The key caption takes the unit only when the key row still fits; otherwise the corner cell does.
  const keyFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const keyFits = (text: string) => measure(text, keyFont).width + 10 + steppedKeyText(scope, caption, steps, options.locale?.language).labels
    .reduce((width, label) => width + 16 + (label ? 4 + measure(label, keyFont).width : 0), 0) <= frame.plot.w;
  const keyUnit = !needsUnit || !showSteppedLegend ? undefined
    : scope === 'column' ? chartString(options, 'withinColumnUnit', { unit: unitCaption }) : carriesUnit(caption) ? undefined : unitCaption;
  const keyCaption = keyUnit !== undefined && keyFits(keyUnit) ? keyUnit : undefined;
  // A key that would cross the canvas edge takes more rows.
  const keyFlow = showSteppedLegend ? steppedKeyFlow(steppedKeyText(scope, caption, steps, options.locale?.language, keyCaption), keyFont, measure, size.width - frame.plot.x) : undefined;
  const legendOffset = keyFlow ? LEGEND_H + keyFlow.pitch * (keyFlow.rows - 1) + 10 : 0;
  const tableTop = frame.plot.y + legendOffset;
  const desiredWidth = tracks.label + tracks.size + visible.length * tracks.month;
  const scale = Math.min(1, frame.plot.w / desiredWidth);
  const labelW = tracks.label * scale;
  const sizeW = tracks.size * scale;
  const monthW = style === 'stepped' ? tracks.month * scale : (frame.plot.w - labelW - sizeW) / visible.length;
  const tableLeft = frame.plot.x;
  const sizeLeft = tableLeft + labelW;
  const monthLeft = sizeLeft + sizeW;
  const tableRight = monthLeft + visible.length * monthW;
  // Each weighted average prints the base it rests on, under it.
  const averageBases = derived.total && derived.basis !== 'previous'
    ? visible.map((period) => derived.cohorts.reduce((sum, row) => sum + (period < row.observedPeriods ? row.base : 0), 0))
    : undefined;
  // A column-normalised table prints each column's range under its
  // head, so "Low" and "High" have numbers.
  const columnRanges = scope === 'column'
    ? visible.map((period) => {
      const values = derived.cohorts.flatMap((row) => {
        const value = period < row.observedPeriods ? row.retention[period] : null;
        return value === null || value === undefined ? [] : [value];
      });
      return period === 0 || values.length === 0 ? undefined : { min: minOf(values), max: maxOf(values) };
    })
    : undefined;
  // The compact form: a header, range or base text wider than its column takes two lines.
  const axisFont: FontSpec = options[STACKED_TEXT] ? stackFont : { family: theme.type.family, ...theme.type.axis };
  const baseFont: FontSpec = options[STACKED_TEXT] ? stackFont : { family: theme.type.family, ...theme.type.label };
  const lineH = (font: FontSpec) => font.size * (font.lineHeight ?? 1.2);
  const wrapped = (text: string, font: FontSpec, room: number) => options[STACKED_TEXT] && measure(text, font).width > room ? twoLines(text, font, measure) : [text];
  const sizeHeader = sizeHead.text;
  const sizeHeaderFont: FontSpec = headFont;
  const sizeHeaderLines = wrapped(sizeHeader, sizeHeaderFont, sizeW - 4);
  const rangeLines = columnRanges?.map((range, column) => {
    if (!range) return [];
    const [low, high] = [formatValue(range.min, visible[column]!), formatValue(range.max, visible[column]!)];
    return wrapped(low === high ? low : numberRange(low, high), axisFont, monthW - 4);
  });
  const baseLines = averageBases?.map((base) => wrapped(chartString(options, 'baseValue', { value: formatAutomaticNumber(base, { locale: options.locale?.language, decimals: 0 }) }), baseFont, monthW - 4));
  const extraLines = (blocks: string[][] | undefined) => Math.max(0, maxOf((blocks ?? []).map((lines) => lines.length - 1)));
  headerRowH = Math.max(headerRowH, sizeHeaderLines.length * lineH(sizeHeaderFont) + rowAir);
  const baseLineH = averageBases ? baseRowH + extraLines(baseLines) * lineH(baseFont) : 0;
  const headerH = headerRowH + (columnRanges ? baseRowH + extraLines(rangeLines) * lineH(axisFont) : 0);
  const tableBottom = tableTop + headerH + rowData.length * rowH + totalGap + baseLineH;
  {
    const grow = rowDrivenHeight({
      options,
      width: size.width,
      height: size.height,
      chromeH: size.height - frame.plot.h + legendOffset,
      rowsH: tableBottom - tableTop + 6,
    });
    if (grow !== undefined) return buildExhibit(data, derived, visible, { ...options, size: { width: size.width, height: grow } }, warnings, exclusion);
  }
  // Cell values use the label step and headers the axis step. Headers and
  // cells use their role weight; totals and focus use emphasis.
  const headerFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const cellFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { ...cellFont, weight: emphasisWeight(theme) };
  const totalFont: FontSpec = { ...cellFont, weight: tableEmphasis(theme) };
  // The closing row sits on the table's total ground, framed by the total rules; heat cells keep their wash.
  const totalPaint: Paint = totalGround(theme, options.palette);
  const mutedInk: Paint = { token: 'inkMuted' };
  const background: Paint = { token: 'background' };
  const designated = options.designatedPeriod ?? 3;
  const binByPeriod = columnBins(derived, visible, scope, steps, totalId);

  // Rules are drawn over the cell fills: a cell that starts on a rule, or the
  // tinted M3 column, covered half of it, so a rule changed weight halfway
  // across the table.
  const rules: SceneNode[] = [];
  const addLine = (id: Id, x1: number, y1: number, x2: number, y2: number, width: number, stroke: Paint, part: string) => {
    rules.push({ t: 'line', id, x1, y1, x2, y2, stroke, width, owner: {}, part });
    occupied.claim({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)) }, 'axis', {}, part);
  };
  // One rule closes the head block, as on the table; none stands above it.
  const head = headRule(theme);
  addLine('cohort-header-bottom', tableLeft, tableTop + headerH, tableRight, tableTop + headerH, head.width, head.stroke, 'tableRule');

  const addLabel = (
    id: Id,
    text: string,
    rect: Rect,
    font: FontSpec,
    ink: Paint,
    owner: { seriesId?: Id; categoryId?: Id } = {},
    kind: LabelRequest['kind'] = 'point',
    insidePaint?: Paint,
    fitted?: FittedText,
    align?: 'middle' | 'end',
    claimId?: Id,
  ) => {
    requests.push({
      id,
      kind,
      ...(claimId ? { claimId } : {}),
      typeRole: kind === 'axisTitle' || id.startsWith('cohort-header-range:') ? 'axis' : 'label',
      owner,
      text,
      ...(owner.categoryId?.startsWith('t') && owner.seriesId ? {
        noteText: `${rowData.find(row => row.id === owner.seriesId)?.label ?? ''} ${text} (${periodName(data.periodLabel, Number(owner.categoryId.slice(1)), options.locale?.language)})`,
      } : {}),
      ...(fitted ? fittedLabel(fitted, font) : { lines: [text] }),
      ...(align ? { align } : {}),
      font,
      priority: kind === 'axisTitle' ? PRIORITY.endpoint : PRIORITY.interior,
      candidates: [{ slot: `${id}:fixed`, rect, penalty: 0, ...(insidePaint ? { insideFill: paintColor(theme, insidePaint), insidePaint } : {}) }],
    });
    fontById.set(id, font);
    labelInk.set(id, ink);
  };
  const measuredRect = (text: string, font: FontSpec, x: number, y: number, align: 'start' | 'middle' | 'end'): Rect => {
    const measured = measure(text, font);
    return {
      x: align === 'start' ? x : align === 'middle' ? x - measured.width / 2 : x - measured.width,
      y: y + (rowH - measured.height) / 2,
      w: measured.width,
      h: measured.height,
    };
  };
  // A wrapped text of the compact form: its lines centred on, or ending at, `x`, the block centred in `h` from `y`.
  const addBlock = (id: Id, lines: string[], font: FontSpec, x: number, y: number, h: number, align: 'middle' | 'end', ink: Paint,
    owner: { seriesId?: Id; categoryId?: Id }, kind: LabelRequest['kind']) => {
    const w = maxOf(lines.map((line) => measure(line, font).width));
    const blockH = lines.length === 1 ? measure(lines[0]!, font).height : lines.length * lineH(font);
    const rect = { x: align === 'middle' ? x - w / 2 : x - w, y: y + (h - blockH) / 2, w, h: blockH };
    addLabel(id, lines.join(' '), rect, font, ink, owner, kind, undefined,
      { lines, w, h: blockH, font, ...(font === stackFont ? { typeRole: 'secondary' as const } : {}) }, lines.length === 1 ? undefined : align);
  };

  const keyShowsUnit = showSteppedLegend && (keyCaption !== undefined || (scope === 'classic' && carriesUnit(caption)));
  // The size column's figures end this far inside it; the compact form keeps 4 px.
  const sizeEnd = sizeLeft + sizeW - (options[STACKED_TEXT] ? 4 : 18) * scale;
  // Pure tables and hidden keys name the unit in the corner cell, in the room left of the size header.
  const cornerRoom = sizeEnd - maxOf(sizeHeaderLines.map((line) => measure(line, headFont).width)) - 8 - tableLeft;
  const cornerTexts = [unitCaption, subtitleUnitClause(unit, '').trim(), unit];
  // A unit that fits nowhere keeps the default "Cohort"; the render pipeline's unit line then names it.
  const unitCorner = needsUnit && !keyShowsUnit ? cornerTexts.find((text) => text !== '' && measure(text, headerFont).width <= cornerRoom) : undefined;
  const corner = unitCorner ?? fieldHeadText(chartString(options, 'cohort'), theme);
  const cornerFont = unitCorner === undefined ? headFont : headerFont;
  const headPaint = headInk();
  addLabel('cohort-header-label', corner, measuredRect(corner, cornerFont, tableLeft, tableTop, 'start'), cornerFont, headPaint, {}, 'axisTitle');
  if (sizeHeaderLines.length > 1) addBlock('cohort-header-size', sizeHeaderLines, headFont, sizeEnd, tableTop, headerRowH, 'end', headPaint, {}, 'axisTitle');
  else addLabel('cohort-header-size', sizeHeader, measuredRect(sizeHeader, headFont, sizeEnd, tableTop, 'end'), headFont, headPaint, {}, 'axisTitle');
  visible.forEach((period, column) => {
    const text = periodName(data.periodLabel, period, options.locale?.language);
    const ink: Paint = style === 'pure' && period === designated ? emphasisInk(theme) : headPaint;
    addLabel(
      `cohort-header-period:${period}`,
      text,
      measuredRect(text, headerFont, monthLeft + (column + 0.5) * monthW, tableTop, 'middle'),
      headerFont,
      ink,
      {},
      'axisTitle',
    );
    const range = columnRanges?.[column];
    if (range && options[STACKED_TEXT]) {
      addBlock(`cohort-header-range:${period}`, rangeLines![column]!, axisFont, monthLeft + (column + 0.5) * monthW, tableTop + headerRowH - 4, headerH - headerRowH, 'middle', mutedInk, { categoryId: `t${period}` }, 'point');
    } else if (range) {
      const rangeFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
      const [low, high] = [formatValue(range.min, period), formatValue(range.max, period)];
      const rangeText = low === high ? low : numberRange(low, high);
      const measured = measure(rangeText, rangeFont);
      addLabel(`cohort-header-range:${period}`, rangeText,
        { x: monthLeft + (column + 0.5) * monthW - measured.width / 2, y: tableTop + headerRowH - 4 + (baseRowH - measured.height) / 2, w: measured.width, h: measured.height },
        rangeFont, mutedInk, { categoryId: `t${period}` }, 'point');
    }
  });

  rowData.forEach((row, rowIndex) => {
    const y = tableTop + headerH + rowIndex * rowH + (row.kind === 'total' ? totalGap : 0);
    const rowFont = row.kind === 'total' ? totalFont : cellFont;
    if (style === 'pure' && rowIndex > 0 && row.kind !== 'total') {
      addLine(`cohort-row-rule:${row.id}`, tableLeft, y, tableRight, y, theme.table?.ruleWidths?.row ?? strokeToken(theme, 'hair'), tableRuleInk(), 'rowRule');
    }
    if (row.kind === 'total') {
      const rule = totalRule(theme);
      nodes.push({ t: 'rect', id: `cohort-total-ground:${row.id}`, rect: { x: tableLeft, y, w: tableRight - tableLeft, h: rowH }, fill: totalPaint, owner: {}, part: 'cohortTotalGround' });
      addLine(`cohort-total-rule:${row.id}`, tableLeft, y - totalGap / 2, tableRight, y - totalGap / 2, rule.width, rule.stroke, 'totalRule');
      // The rule below sits on the edge of the base line's own row, so it claims no label room.
      rules.push({ t: 'line', id: `cohort-total-rule-below:${row.id}`, x1: tableLeft, y1: y + rowH, x2: tableRight, y2: y + rowH, stroke: rule.stroke, width: rule.width, owner: {}, part: 'totalRule' });
    }
    const rowGround: Paint = row.kind === 'total' ? totalPaint : background;
    addLabel(
      `cohort-row:${row.id}`,
      row.label,
      { x: tableLeft, y: y + (rowH - rowNames[rowIndex]!.h) / 2, w: rowNames[rowIndex]!.w, h: rowNames[rowIndex]!.h },
      rowFont,
      { token: 'ink' },
      { seriesId: row.id },
      'series',
      undefined,
      rowNames[rowIndex],
    );
    const sizeRect: Rect = { x: sizeLeft, y, w: sizeW, h: rowH };
    const sizeNodeId = `cohort-size:${row.id}`;
    nodes.push({ t: 'rect', id: sizeNodeId, rect: sizeRect, fill: rowGround, owner: { seriesId: row.id, categoryId: 'cohort-size' }, part: 'cohortSize', display: { value: formatAutomaticNumber(row.base, { locale: options.locale?.language, ...{ decimals: 0 } }) } });
    occupied.claim(sizeRect, 'mark', { seriesId: row.id, categoryId: 'cohort-size' }, 'cohortSize');
    (marks.sizeCells as CohortSizeMark[]).push({ rowId: row.id, rowLabel: row.label, value: row.base, rect: sizeRect, nodeId: sizeNodeId, kind: row.kind });
    const sizeText = formatAutomaticNumber(row.base, { locale: options.locale?.language, ...{ decimals: 0 } });
    addLabel(
      `cohort-size-label:${row.id}`,
      sizeText,
      measuredRect(sizeText, rowFont, sizeEnd, y, 'end'),
      rowFont,
      { token: 'ink' },
      { seriesId: row.id, categoryId: 'cohort-size' },
      'point',
      rowGround,
    );

    visible.forEach((period, column) => {
      const retention = period < row.observedPeriods ? row.retention[period] ?? null : null;
      const missing = row.kind === 'total'
        ? derived.cohorts.some(cohort => missingCohortRate(cohort, period, derived.basis))
        : missingCohortRate(derived.cohorts.find(cohort => cohort.id === row.id)!, period, derived.basis);
      const rect: Rect = {
        x: monthLeft + column * monthW,
        y,
        w: style === 'stepped' ? Math.max(0, monthW - 1) : monthW,
        h: style === 'stepped' ? rowH - 1 : rowH,
      };
      const nodeId = `cohort-cell:${row.id}:t${period}`;
      const bin = retention === null || period === 0
        ? null
        : binByPeriod.get(`${row.id}:${period}`) ?? classicBin(retention * 100, steps);
      const paint: Paint = retention === null || period === 0
        ? rowGround
        : style === 'pure'
          ? period === designated
            ? { token: 'focus', tint: 0.94 }
            : rowGround
          // Cell washes are larger than a point: tints of series 1.
          : semanticPalettePaint(theme, options.palette, 'sequential', BIN_TINTS[bin!]!);
      cellPaints.set(nodeId, paint);
      nodes.push({
        t: 'rect',
        id: nodeId,
        rect,
        fill: paint,
        owner: { seriesId: row.id, categoryId: `t${period}` },
        part: row.kind === 'total' ? 'cohortTotalCell' : 'cohortCell',
        display: retention === null ? { state: chartString(options, missing ? 'noObservation' : 'notReached') } : { value: formatValue(retention, period) },
      });
      occupied.claim(rect, 'mark', { seriesId: row.id, categoryId: `t${period}` }, row.kind === 'total' ? 'cohortTotalCell' : 'cohortCell');
      (marks.cells as CohortCellMark[]).push({
        rowId: row.id,
        periodId: `t${period}`,
        periodIndex: period,
        rowLabel: row.label,
        periodLabel: periodName(data.periodLabel, period, options.locale?.language),
        kind: row.kind === 'total' ? 'total' : 'cohort',
        rect,
        nodeId,
        retention,
      });
      if (retention === null && !missing) return;
      const text = missing ? '—' : formatValue(retention!, period);
      // Total rates follow the same threshold key as cohort rates.
      const highlighted = style === 'pure' && retention !== null && pureEmphasis(options, period, retention);
      const font = row.kind === 'total' && style !== 'pure' ? totalFont : highlighted ? strongFont : cellFont;
      const ink: Paint = period === 0
        ? mutedInk
        : highlighted
          // Judged on the cell's own wash, not the page.
          ? emphasisInk(theme, paint)
          : style === 'stepped' && (bin ?? 0) >= 3
            ? { token: 'inkInverse' }
            : { token: 'ink' };
      addLabel(
        `cohort-cell:${row.id}:t${period}`,
        text,
        measuredRect(text, font, rect.x + rect.w / 2, y, 'middle'),
        font,
        ink,
        { seriesId: row.id, categoryId: `t${period}` },
        row.kind === 'total' ? 'total' : 'point',
        paint,
        undefined,
        undefined,
        row.kind === 'total' ? undefined : `cohort:${row.id}:t${period}`,
      );
    });
  });

  if (averageBases) {
    const y = tableBottom - baseLineH;
    visible.forEach((period, column) => {
      if (options[STACKED_TEXT]) {
        addBlock(`cohort-average-base:t${period}`, baseLines![column]!, baseFont, monthLeft + (column + 0.5) * monthW, y, baseLineH, 'middle', mutedInk, { seriesId: totalId, categoryId: `t${period}` }, 'annotation');
        return;
      }
      const text = chartString(options, 'baseValue', { value: formatAutomaticNumber(averageBases[column]!, { locale: options.locale?.language, decimals: 0 }) });
      const measured = measure(text, baseFont);
      addLabel(`cohort-average-base:t${period}`, text,
        { x: monthLeft + (column + 0.5) * monthW - measured.width / 2, y: y + (baseLineH - measured.height) / 2, w: measured.width, h: measured.height },
        baseFont, mutedInk, { seriesId: totalId, categoryId: `t${period}` }, 'annotation');
    });
  }

  let legend: LegendGeometry | undefined;
  if (style === 'stepped' && !showSteppedLegend) {
    const key = steppedKeyText(scope, caption, steps, options.locale?.language);
    legendOff(warnings, 'cohort', [key.caption, ...key.labels.filter(Boolean)]);
  }
  if (showSteppedLegend) {
    legend = addSteppedLegend(nodes, requests, fontById, labelInk, occupied, { ...frame.plot, w: tableRight - tableLeft }, scope, caption, theme, options.palette, measure, steps, keyFlow!, options.locale?.language, keyCaption);
  }

  if (options.exhibitLabel) {
    // The label step, letter-spaced.
    const font: FontSpec = { family: theme.type.family, ...theme.type.label, letterSpacing: 2.2 };
    addLabel('cohort-exhibit-label', options.exhibitLabel, measuredRect(options.exhibitLabel, font, frame.plot.x, 12, 'start'), font, mutedInk, {}, 'axisTitle');
  }
  if (frame.frame.sourceNodeId) {
    const sourceNode = nodes.find((node) => node.id === frame.frame.sourceNodeId);
    const firstNote = ruleOverNotes ? nodes.find((node) => node.id === frame.frame.footnoteNodeIds?.[0]) : undefined;
    // Over the notes, the gaps of the automatic height (footGap + 1 to the note, footGap - 5 under the table)
    // where the frame has that room; otherwise 5 px over the note, as over a source line.
    const footGap = spaceTokens(theme, size.width).gapAxisFootnote;
    const contentBottom = tableBottom;
    const y = firstNote?.t === 'text' ? Math.max(firstNote.y - footGap - 1, Math.min(firstNote.y - 5, contentBottom + footGap - 5))
      : sourceNode?.t === 'text' ? sourceNode.y - 5 : undefined;
    if (sourceNode?.t === 'text' && y !== undefined) addLine('cohort-source-rule', frame.plot.x, y, tableRight, y, strokeToken(theme, 'hair'), { token: 'grid' }, 'sourceRule');
  }

  const solved = solveLabels(requests, occupied, labelCtx(theme, size, options, {
    focus: undefined,
    measure,
    plot: frame.plot,
    labelPad: 1,
  }));
  for (const label of solved.placed) {
    if (style === 'stepped' && label.id.startsWith('cohort-cell:')) continue;
    const ink = labelInk.get(label.id);
    if (ink) label.ink = ink;
  }
  pushAll(nodes, rules);
  pushAll(nodes, labelsToNodes(theme, solved.placed, (label) => fontById.get(label.id) ?? cellFont, nodes));
  pushAll(warnings, solved.warnings);
  // A missing row identity means the exhibit lost a data row, even if some
  // cells still fit. It must never ship as a successful partial table.
  for (const label of solved.placed) {
    if (label.id.startsWith('cohort-row:') && label.hidden === 'collision') {
      const warning = warnings.find(w => w.code === 'label-hidden' && w.owner?.seriesId === label.owner.seriesId);
      if (warning) warning.severity = 'error';
    }
  }

  return {
    type: 'cohort',
    [REGULAR_WIDTH]: regularWidth,
    size,
    sizing: rowSizing('cohort', size, {
      chromeH: size.height - frame.plot.h + legendOffset,
      minimumRowsH: headerH + rowData.length * Math.max(rowH, measure('0', cellFont).height) + totalGap + baseLineH + 6,
      naturalRowsH: tableBottom - tableTop + 6,
      minWidth: size.width - frame.plot.w + desiredWidth,
      naturalWidth: size.width - frame.plot.w + desiredWidth,
    }),
    plot: { x: tableLeft, y: tableTop, w: tableRight - tableLeft, h: Math.max(0, tableBottom - tableTop) },
    scene: nodes,
    labels: solved.placed,
    axes: [],
    annotations: [],
    ...(legend ? { legend } : {}),
    frame: frame.frame,
    marks,
    derived,
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'exhibitTitle', { measure: measureName.toLocaleLowerCase(options.locale?.language ?? 'en'), count: String(derived.cohorts.length) })),
      desc: chartString(options, 'exhibitDesc', { measure: measureName, periods: visible.map(period => periodName(data.periodLabel, period, options.locale?.language)).join(', '), formula: cohortFormula(options, derived.basis), anchor: visible.includes(0) ? chartString(options, 'exhibitDescAnchor') : '', missing: derived.cohorts.some(row => visible.some(period => missingCohortRate(row, period, derived.basis))) ? chartString(options, 'exhibitDescMissing') : '', total: derived.total ? chartString(options, 'exhibitDescTotal', { basis: chartString(options, derived.basis === 'previous' ? 'previousBasis' : 'cohortBasis') }) : '' }),
    },
    warnings,
    debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
}

function columnBins(derived: CohortDerived, visible: number[], scope: 'classic' | 'column', steps: readonly number[], totalId: string | undefined): Map<string, number> {
  const result = new Map<string, number>();
  for (const period of visible) {
    const values = derived.cohorts.flatMap((row) => {
      const value = period < row.observedPeriods ? row.retention[period] : null;
      return value === null || value === undefined ? [] : [{ rowId: row.id, value }];
    });
    if (period === 0) continue;
    if (scope === 'classic') {
      values.forEach(({ rowId, value }) => result.set(`${rowId}:${period}`, classicBin(value * 100, steps)));
      const total = derived.total?.retention[period];
      if (total !== null && total !== undefined) result.set(`${totalId}:${period}`, classicBin(total * 100, steps));
      continue;
    }
    const min = minOf(values.map(({ value }) => value));
    const max = maxOf(values.map(({ value }) => value));
    values.forEach(({ rowId, value }) => {
      const bin = values.length === 1 || max === min ? 2 : Math.min(4, Math.floor(((value - min) / (max - min)) * 5));
      result.set(`${rowId}:${period}`, bin);
    });
    const total = derived.total?.retention[period];
    if (total !== null && total !== undefined) {
      const bin = values.length === 1 || max === min
        ? 2
        : Math.max(0, Math.min(4, Math.floor(((total - min) / (max - min)) * 5)));
      result.set(`${totalId}:${period}`, bin);
    }
  }
  return result;
}

const DEFAULT_STEPS = [30, 40, 50, 60] as const;

function classicBin(percent: number, steps: readonly number[]): number {
  const index = steps.findIndex((step) => percent < step);
  return index === -1 ? steps.length : index;
}

/** The key's names for the five classic classes: "<30", "30 to <40" ... "60+". */
function stepLabels(steps: readonly number[], locale?: string): string[] {
  const fmt = (value: number) => {
    const [mantissa, exponent = '0'] = String(value).split('e');
    const decimals = Math.min(20, Math.max(0, (mantissa!.split('.')[1]?.length ?? 0) - Number(exponent)));
    return formatAutomaticNumber(value, { decimals, locale });
  };
  return [`<${fmt(steps[0]!)}`, ...steps.slice(0, -1).map((step, index) => `${fmt(step)} to <${fmt(steps[index + 1]!)}`), `${fmt(steps.at(-1)!)}+`];
}

function periodName(label: string | undefined, index: number, locale?: string): string {
  const initial = (label ?? '').trim().charAt(0).toUpperCase();
  return initial === '' ? chartString({ locale }, 'period', { period: String(index) }) : `${initial}${index}`;
}

/** Period names in runs: "M5–M7" for consecutive periods, runs joined by commas. */
function periodRuns(label: string | undefined, periods: readonly number[], locale?: string): string {
  const runs: [number, number][] = [];
  for (const period of [...periods].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && period === last[1] + 1) last[1] = period;
    else runs.push([period, period]);
  }
  return runs.map(([start, end]) => start === end ? periodName(label, start, locale)
    : numberRange(periodName(label, start, locale), periodName(label, end, locale))).join(', ');
}

/** `text` on two lines, broken at the space or after the dash that leaves the narrower block; one line where it has no break. */
function twoLines(text: string, font: FontSpec, measure: TextMeasurer): string[] {
  let best = [text];
  let bestWidth = measure(text, font).width;
  for (let index = 1; index < text.length - 1; index++) {
    const char = text[index];
    if (char !== ' ' && char !== '–') continue;
    const lines = char === ' ' ? [text.slice(0, index), text.slice(index + 1)] : [text.slice(0, index + 1), text.slice(index + 1)];
    const lead = lines[0]!.trimEnd();
    const tail = lines[1]!.trimStart();
    if (lead === '' || tail === '') continue;
    const width = Math.max(measure(lead, font).width, measure(tail, font).width);
    if (width < bestWidth) { best = [lead, tail]; bestWidth = width; }
  }
  return best;
}

/** The stepped key's caption and bin labels, drawn by addSteppedLegend and named by legendOff. */
function steppedKeyText(scope: 'classic' | 'column', unit: string | undefined, steps: readonly number[], locale?: string, override?: string): { caption: string; labels: string[] } {
  return {
    labels: scope === 'column' ? [chartString({ locale }, 'low'), '', '', '', chartString({ locale }, 'high')] : stepLabels(steps, locale),
    // Column scope ranks each month against itself, so M3 "51" can shade
    // darker than M1 "64": the caption says so instead of the unit.
    caption: override ?? (scope === 'column' ? chartString({ locale }, 'withinColumn') : unit ?? chartString({ locale }, 'measure')),
  };
}

function addSteppedLegend(
  nodes: SceneNode[],
  requests: LabelRequest[],
  fontById: Map<Id, FontSpec>,
  labelInk: Map<Id, Paint>,
  occupied: ReturnType<typeof createOccupiedIndex>,
  plot: Rect,
  scope: 'classic' | 'column',
  unit: string | undefined,
  theme: ReturnType<typeof resolveTheme>,
  palette: string | undefined,
  measure: typeof defaultMeasurer,
  steps: readonly number[],
  flow: ReturnType<typeof steppedKeyFlow>,
  locale?: string,
  override?: string,
): LegendGeometry {
  const { labels, caption } = steppedKeyText(scope, unit, steps, locale, override);
  // The axis step.
  const font: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const captionW = measure(caption, font).width;
  // Rows above the table, flush left with it, as every key.
  let x = plot.x;
  let y = plot.y;
  const items: LegendGeometry['items'] = [];
  const add = (id: Id, text: string, rect: Rect) => {
    requests.push({ id, kind: 'scale', typeRole: 'axis', owner: {}, text, lines: [text], font, priority: PRIORITY.endpoint, candidates: [{ slot: `${id}:fixed`, rect, penalty: 0 }] });
    fontById.set(id, font);
    labelInk.set(id, { token: 'inkMuted' });
  };
  // Centred on the 12px swatch row like the item labels below; the fixed y+2
  // sat the caption a few px under 'Low' and 'High'.
  const captionH = measure(caption, font).height;
  add('cohort-legend-caption', caption, { x, y: y + (12 - captionH) / 2, w: captionW, h: captionH });
  x += captionW + 10;
  labels.forEach((label, index) => {
    if (flow.breaks.has(index)) [x, y] = [plot.x, y + flow.pitch];
    const swatchId = `cohort-legend-swatch:${index}`;
    const labelId = `cohort-legend-label:${index}`;
    const fill = semanticPalettePaint(theme, palette, 'sequential', BIN_TINTS[index]!);
    nodes.push({ t: 'rect', id: swatchId, rect: { x, y, w: 12, h: 12 }, fill, owner: { categoryId: `bin${index}` }, part: 'swatch' });
    occupied.claim({ x, y, w: 12, h: 12 }, 'legend', { categoryId: `bin${index}` }, 'swatch');
    x += 12;
    if (label) {
      const width = measure(label, font).width;
      const height = measure(label, font).height;
      // Center the label line box on the 12px swatch, so the key and its
      // label stay aligned within ±1px at any line height.
      add(labelId, label, { x: x + 4, y: y + (12 - height) / 2, w: width, h: height });
      x += 4 + width;
      items.push({ id: `bin${index}`, swatchNodeId: swatchId, labelId: `label:${labelId}` });
    }
    x += 4;
  });
  return { rect: { x: plot.x, y: plot.y, w: plot.w, h: LEGEND_H + flow.pitch * (flow.rows - 1) }, items };
}

/**
 * The stepped key's rows within `width`: one row while caption and bins fit,
 * else the caption alone on the first row and the bins below it, a new row
 * before each bin that would cross `width`. `breaks` holds the bins that
 * start a row; `pitch` is the row step, never less than the key's text.
 */
function steppedKeyFlow(text: { caption: string; labels: string[] }, font: FontSpec, measure: typeof defaultMeasurer, width: number) {
  const bins = text.labels.map((label) => 12 + (label ? 4 + measure(label, font).width : 0));
  const breaks = new Set<number>();
  const pitch = Math.max(LEGEND_H, measure(text.caption, font).height + 4);
  if (measure(text.caption, font).width + 10 + bins.reduce((sum, bin) => sum + bin + 4, 0) - 4 <= width) return { rows: 1, breaks, pitch };
  let x = 0;
  bins.forEach((bin, index) => {
    if (index === 0 || x + bin > width) {
      breaks.add(index);
      x = 0;
    }
    x += bin + 4;
  });
  return { rows: 1 + breaks.size, breaks, pitch };
}




