import { chartString } from '../../strings/variance';
import { breakUnsupported, chartTheme } from '../chartEnv';
import { bandFloorSizing } from '../waterfall/bandFloor';
import { structureCount } from '../../structureCounts';
/**
 * Variance / deviation chart — the variance tier computed
 * from a ChartData that carries a reference-role series. The LIBRARY derives
 * AC, REF, ΔABS and Δ% per category (never trusted from the caller):
 *
 *   AC   = options.variance.of === 'total' ? Σ data-role series : that series
 *   REF  = the `vs` reference series value
 *   ΔABS = AC − REF
 *   Δ%   = 100·(AC − REF)/|REF|, suppressed + 'ref-nonpositive' when REF ≤ 0
 *
 * mode 'absolute'   → Δ columns on the zero baseline, good/bad fills, EVERY
 *                     bar labeled with a forced sign (mirrored below for
 *                     negatives);
 * mode 'relative'   → Δ% pins/lollipops (thin stem + circle head), authored precision
 *                     labels outside beyond the head;
 * mode 'integrated' → AC columns (neutral unless the actual's series sets a
 *                     fill or colorRole) with a solid good/bad variance cap
 *                     spanning REF↔AC at the bar end,
 *                     the AC value inside the column top, the signed Δ
 *                     outside its cap.
 *
 * Tier name auto-generates as 'Δ' + refScenario ('ΔPY', 'ΔPL%') and doubles
 * as the default title. Semantic tone = sign × direction of the measured
 * series ('lowerIsBetter' inverts); colorblindSafe swaps to
 * theme.color.colorblind.
 */

import { PARTIAL_KEY, partialAxisWords, partialFootnotes, partialIds, partialKeyForced, partialLegendKeys, partialPattern, saysToDate, toDateFits, toDateFont, toDateLabel, toDateRoom } from '../../partialPeriod';
import { highlightPaintWarnings } from '../../paintWarnings';
import { warnMissingValue } from '../../dataGaps';
import type { PaintWarningRule } from '../../types/scene';
import type { AnchorResolution } from '../../annotate';
import { percentLevels, runAnnotatePass } from '../../annotatePass';
import { hiddenValueLineReserve, VALUE_LINE_RESERVE } from '../../annotateParts';
import { defaultNumberDecimals, formatAutomaticNumber, formatAutomaticPercent, PERCENTAGE_POINTS, seriesValueFormatter } from '../../format';
import { exampleSpec, formatterFromExample, formatWithSpec, parseFormatExample, roundedNumber, signedFormatterFromExample, specUnitKind } from '../../formatSpec';
import { boxGap, cleanDiff, cleanFloat, cleanSum, type Rect } from '../../geometry';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { DEFAULT_TARGET, resolveTargetSize, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { labelsToNodes } from '../../label/emit';
import { categoryLineAlign, planCategoryRow, rotatedClaimRect, rotatedLeftOverhang, yearRowRequests } from '../../label/categoryRow';
import {
  isDateNumericTickSequence,
  type TickBandDerived,
} from '../../label/tickRow';
import {
  labelCtx,
  PRIORITY,
  SERIES_VALUE_GAP,
  solveLabels,
  type LabelRequest,
  type SlotCandidate,
  type SolveCtx,
  type SolveResult,
} from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  normalizeCategory,
  normalizeScenario,
  normalizeSeriesValues,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { applyAxisBounds, bandScale, linearScale, niceDomain } from '../../scale';
import { valueLineExtent } from '../../valueLineDomain';
import { applyValueAxisTitleInk, layoutValueAxis, measureValueAxisWidth, planValueAxisTitle, valueAxisTitleBand, valueAxisTitleRequest } from '../../axis';
import { PLOT_FLOOR_RECT } from '../../sizing';
import { authoredNotes, frameTextOptions, legendOff, legendRequired, normalizeLegendOption, solveFrame, fixedPlotChrome, plotHeightAfter, authoredFootnoteCount, withAuthoredFootnotes, type LegendItemInput } from '../../frame';
import { defaultMeasurer, type FontSpec } from '../../text';
import {
  labelsOffKeepsNames,
  canvasMargin,
  colorblindPaint,
  seriesTextPaint,
  effectiveFill,
  hatchGroundPaint,
  markRolePaint,
  mutedMarkPaint,
  paintColor,
  panelTypeClass,
  resolveSemanticPaletteTheme,
  semanticPalettePaint,
  signedFillPaint,
  emphasisLabelTheme,
  emphasisWeight,
  strokeToken,
} from '../../theme';
import type { AnchorRef } from '../../types/annotations';
import { cellMeta, cellValue, isPctCell, type Direction, type Id, type Scenario } from '../../types/cell';
import type { Category, ChartData } from '../../types/data';
import type { LabelKind, LegendOptions, VarianceOptions } from '../../types/options';
import type {
  AxisGeometry,
  Geometry,
  LintWarning,
  Paint,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import { autoDecimals, currentSmallValues, roundHalfUp, roundsToZero, valueSetDecimals } from '../../formatPrecision';
import { isSingleVarianceTier, isVarianceTier } from '../../grid/varianceTiers';
import { relativePointCandidates } from './pointLabels';
import { categoryLabelsAndMarks } from '../../footnoteMark';
import { withUnit } from '../../unitJoin';
import { textScaleOf } from '../../typeFloors';
import { disclosureNote } from '../../notes';
import { maxOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface VarianceMarks {
  /** absolute: plain Δ bars; integrated: AC bars with `cap` carrying REF↔AC. */
  bars: {
    categoryId: Id;
    rect: Rect;
    nodeId: Id;
    cap?: { rect: Rect; nodeId: Id };
  }[];
  /** relative: pin/lollipop per category (suppressed categories absent). */
  pins: { categoryId: Id; rect: Rect; stemNodeId: Id; headNodeId: Id }[];
}

export interface VarianceDerived {
  ac: Record<Id, number | null>;
  ref: Record<Id, number | null>;
  deltaAbs: Record<Id, number | null>;
  /** null where REF ≤ 0 (suppressed) or a value is missing. */
  deltaPct: Record<Id, number | null>;
  /** Auto tier name: 'Δ' + refScenario, '%' appended in relative mode. */
  tierName: string;
  /** The tick band: absent only when the category tick row is not rendered. */
  tickBand?: TickBandDerived;
}

interface NormVal {
  v: number | null;
  isPct: boolean;
  fill?: string;
  scenario?: Scenario;
  labelOverride?: string | false;
  format?: string;
  priority?: number;
}

interface NormSer {
  id: Id;
  label: string;
  role: 'data' | 'reference';
  scenario?: Scenario;
  format?: string;
  unit?: string;
  fill?: string;
  colorRole?: string;
  direction: Direction;
  vals: NormVal[];
}

/**
 * Pin geometry: a data-weight stem and a head
 * that reads at slot scale, a step heavier on the wide cards (720 px up).
 */
const pinGeometry = (theme: Parameters<typeof strokeToken>[0], width: number): { r: number; stem: number } => width >= 720
  ? { r: 5, stem: strokeToken(theme, 'data') * 1.25 }
  : { r: 4.5, stem: strokeToken(theme, 'data') };

/** Internal option: px of one more value row over (above) or under (below) the columns, set by the second pass. */
const LIFT_ROW = Symbol('liftRow');

export function layoutVariance(
  data: ChartData,
  options: VarianceOptions = {} as VarianceOptions,
): Geometry<VarianceMarks, VarianceDerived> {
  const warnings: LintWarning[] = [];
  breakUnsupported('variance', options, warnings);
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  // Business default: whole numbers get 0 decimals; small non-integers keep
  // one, so a 0.4 sliver never prints as "0". (waterfall's autoDecimals)
  const highlights = new Set(resolveHighlight(options.highlight));
  // A warm red or orange accent on a signed variance reads as a loss.
  const paintWarningRules: PaintWarningRule[] = highlights.size > 0 ? [{ kind: 'highlight-reads-as-loss', chart: 'variance', before: warnings.length }] : [];
  if (paintWarningRules.length) warnings.push(...highlightPaintWarnings(theme, 'variance'));
  const density = options.labelDensity ?? 'smart';

  // ---- normalize ----
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'variance requires at least one category');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'variance requires at least one series');
  }
  const spec = options.variance;
  if (!spec || !spec.vs) {
    throw new NormalizeError(
      'missing-variance',
      'options.variance',
      "variance requires options.variance { vs }",
      "e.g. { vs: 'py' }",
    );
  }
  const mode = options.variant ?? 'absolute';
  const cats: Category[] = data.categories.map((c, i) => normalizeCategory(c as never, i));
  const seriesNorm: NormSer[] = data.series.map((s, si) => {
    if (!s?.id) throw new NormalizeError('missing-id', `series[${si}]`, 'series requires an id');
    const cells = normalizeSeriesValues(s, cats, si);
    const vals: NormVal[] = cells.map((cell, ci) => {
      const meta = cellMeta(cell);
      return {
        v: cellValue(cell),
        isPct: isPctCell(cell),
        fill: meta?.fill,
        scenario: normalizeScenario(
          meta?.scenario as string | undefined,
          `series[${s.id}].values[${ci}].scenario`,
        ),
        labelOverride: meta?.label,
        format: meta?.format,
        priority: meta?.priority,
      };
    });
    return {
      id: s.id,
      label: s.label ?? s.id,
      role: s.role ?? 'data',
      scenario: normalizeScenario(s.scenario as string | undefined, `series[${s.id}].scenario`),
      format: s.format,
      unit: s.unit,
      fill: s.fill,
      colorRole: s.colorRole,
      direction: s.direction ?? 'higherIsBetter',
      vals,
    };
  });
  const dataSeries = seriesNorm.filter((s) => s.role !== 'reference');
  if (dataSeries.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'variance requires at least one data-role series');
  }
  const refSeries = seriesNorm.find((s) => s.id === spec.vs);
  if (!refSeries) {
    throw new NormalizeError(
      'unknown-series',
      'options.variance.vs',
      `variance.vs '${spec.vs}' not found in data.series`,
      seriesNorm.map((s) => s.id).join(', '),
    );
  }
  if (refSeries.role !== 'reference') {
    warnings.push({
      code: 'vs-not-reference',
      severity: 'warn',
      message: `variance.vs '${spec.vs}' should have role: 'reference'`,
      owner: { seriesId: spec.vs },
      suggest: "set role: 'reference' on the comparison series",
    });
  }
  const of = spec.of ?? 'total';
  let ofSeries: NormSer | null = null;
  if (of !== 'total') {
    ofSeries = dataSeries.find((s) => s.id === of) ?? null;
    if (!ofSeries) {
      throw new NormalizeError(
        'unknown-series',
        'options.variance.of',
        `variance.of '${of}' is not a data-role series`,
        ['total', ...dataSeries.map((s) => s.id)].join(', '),
      );
    }
  }

  // ---- derive: AC, REF, ΔABS, Δ% (library-computed, never trusted) ----
  const refScenario = refSeries.scenario;
  // A scenario word in the key or a note is the code alone
  // (AC, PY, PL, FC). A reference series without a scenario keeps its label.
  const refWord = refScenario ?? refSeries.label;
  const tierName = `Δ${refWord}${mode === 'relative' ? '%' : ''}`;
  const direction: Direction = ofSeries
    ? ofSeries.direction
    : dataSeries.every((s) => s.direction === 'lowerIsBetter')
      ? 'lowerIsBetter'
      : 'higherIsBetter';

  const nmCats = new Set<Id>();
  const integratedExtreme: Id[] = [];
  const acArr: (number | null)[] = [];
  const refArr: (number | null)[] = [];
  const dAbsArr: (number | null)[] = [];
  const dPctArr: (number | null)[] = [];
  cats.forEach((c, ci) => {
    let ac: number | null;
    if (ofSeries) {
      ac = ofSeries.vals[ci]!.v;
    } else {
      const present = dataSeries.filter((s) => s.vals[ci]!.v !== null);
      ac = present.length !== dataSeries.length ? null : cleanSum(present.map((s) => s.vals[ci]!.v!));
    }
    // A blank part leaves the category without a total, so nothing is drawn for it.
    if (ac === null) {
      const blank = (ofSeries ? [ofSeries] : dataSeries).filter((s) => s.vals[ci]!.v === null).map((s) => `'${s.id}'`);
      warnMissingValue(warnings, `series ${blank.join(' and ')} at '${c.id}'`, { categoryId: c.id },
        options.missingMark === 'dash' ? 'the category is drawn as an en dash' : 'the category is not drawn');
    }
    const ref = refSeries.vals[ci]!.v;
    acArr[ci] = ac;
    refArr[ci] = ref;
    dAbsArr[ci] = ac === null || ref === null ? null : cleanDiff(ac, ref);
    if (ac === null || ref === null) {
      dPctArr[ci] = null;
    } else if (ref <= 0) {
      dPctArr[ci] = null;
      nmCats.add(c.id);
      warnings.push({
        code: 'ref-nonpositive',
        severity: 'warn',
        message: `category '${c.id}': reference ${ref} ≤ 0 — Δ% suppressed, category marked n.m.`,
        owner: { categoryId: c.id },
      });
    } else {
      dPctArr[ci] = cleanFloat((100 * dAbsArr[ci]!) / Math.abs(ref));
    }
  });
  const derived: VarianceDerived = {
    ac: emptyIdRecord(),
    ref: emptyIdRecord(),
    deltaAbs: emptyIdRecord(),
    deltaPct: emptyIdRecord(),
    tierName,
  };
  cats.forEach((c, ci) => {
    derived.ac[c.id] = acArr[ci] === null ? null : cleanFloat(acArr[ci]!);
    derived.ref[c.id] = refArr[ci] === null ? null : cleanFloat(refArr[ci]!);
    derived.deltaAbs[c.id] = dAbsArr[ci]!;
    derived.deltaPct[c.id] = dPctArr[ci]!;
  });

  /** Plotted Δ per category: Δ% in relative mode, ΔABS otherwise. */
  const deltaOf = (ci: number): number | null => (mode === 'relative' ? dPctArr[ci]! : dAbsArr[ci]!);

  // A cell or series format belongs to the measured side only when it is
  // one series. A sum of several series uses the chart format.
  const measuredSeries = ofSeries ?? (dataSeries.length === 1 ? dataSeries[0] : undefined);
  const percentData = options.unit === '%' || percentLevels([...(ofSeries ? [ofSeries] : dataSeries), refSeries], options.format, options.unit);
  const percentDifferences = mode === 'absolute' && percentData;
  const integratedPercent = mode === 'integrated' && percentData;
  const formats = cats.map((_, ci) => measuredSeries?.vals[ci]?.format ?? measuredSeries?.format ?? options.format);
  const percentSpecs = formats.map(example => {
    if (!example) return undefined;
    // The chart locale sets the separators, as on every other value (exampleSpec).
    const spec = exampleSpec(example, options.locale?.language);
    if (spec.magnitude !== 'none' || spec.prefix || (spec.suffix && specUnitKind(spec) !== 'percent')) {
      if (mode === 'relative') warnings.push({ code: 'format-ignored', severity: 'warn',
        message: `format '${example}' cannot format a relative variance; use a percent example such as '+1.0%'` });
      return undefined;
    }
    return { ...spec, signed: true, suffix: spec.suffix || '%' };
  });
  // One decimal count for the series (shared helper), so "+3.0%" stands beside "+2.6%", not "+3%".
  // To a tenth, half away from zero as the formatter rounds: Math.round takes -1.25 to -1.2.
  const tenths = (p: number): number => Math.sign(p) * Number(roundHalfUp(Math.abs(p), 1));
  const pctDecimals = valueSetDecimals(dPctArr.flatMap((p) => (p === null || !Number.isFinite(p) ? [] : [tenths(p)])));
  const pctSigned = (p: number, ci = 0): string => {
    const spec = percentSpecs[ci];
    if (spec) return formatWithSpec(p, spec);
    return formatAutomaticPercent(tenths(p), pctDecimals, true, options.locale?.language);
  };
  const absoluteFormat = (ci: number): string | undefined => {
    const example = formats[ci];
    return mode === 'relative' && example && specUnitKind(parseFormatExample(example)) === 'percent' ? undefined : example;
  };
  // An authored format holds the bars and the deltas to one scale and one decimal count (exampleSpec).
  const printed = [...acArr, ...dAbsArr];
  const fmt = options.format
    ? formatterFromExample(options.format, options.locale?.language, undefined, printed)
    : (v: number) => formatAutomaticNumber(v, { locale: options.locale?.language, decimals: autoDecimals(v) });
  // The AC values and the signed deltas are two series: each takes one precision (seriesValueFormatter).
  const acFmt = seriesValueFormatter(acArr, options.locale?.language);
  const deltaFmt = seriesValueFormatter(dAbsArr, options.locale?.language);
  const chartPlain = options.format ? formatterFromExample(options.format, options.locale?.language, options.unit, printed) : undefined;
  const chartSigned = options.format ? signedFormatterFromExample(options.format, options.locale?.language, options.unit, printed) : undefined;
  const absolute = (v: number, ci: number, signed = false): string => {
    const example = absoluteFormat(ci);
    if (percentDifferences || integratedPercent) {
      const suffix = percentDifferences || signed ? PERCENTAGE_POINTS : '%';
      return example
        ? formatWithSpec(v, { ...exampleSpec(example, options.locale?.language), prefix: '', suffix, signed })
        : withUnit((signed ? deltaFmt : acFmt)(v, signed), suffix);
    }
    if (!example) return (signed ? deltaFmt : acFmt)(v, signed);
    if (example === options.format) return (signed ? chartSigned : chartPlain)!(v);
    return (signed ? signedFormatterFromExample : formatterFromExample)(example, options.locale?.language, options.unit)(v);
  };

  // ---- tones & paints (semantic; colorblindSafe swaps to alternates) ----
  const cbSafe = options.colorblindSafe === true;
  // A Δ that prints as zero at its label's precision is neutral:
  // "-0.02%" shown as "0%" is no loss. The precision is the label's own,
  // read from the number: a digit in a unit affix cannot hide it.
  const absoluteSpecs = formats.map((_, ci) => absoluteFormat(ci) ? parseFormatExample(absoluteFormat(ci)!) : undefined);
  // An automatic delta prints zero only under smallValues 'zero' at the deltas' shared precision; the other modes print a bound or digits.
  const deltaDecimals = valueSetDecimals(dAbsArr.filter((d): d is number => d !== null && Number.isFinite(d)));
  const deltaPrintsZero = (d: number): boolean => currentSmallValues() === 'zero' && roundsToZero(d, defaultNumberDecimals(d, deltaDecimals));
  const shownZero = (d: number, ci: number): boolean =>
    mode === 'relative' ? (percentSpecs[ci] ? roundedNumber(d, percentSpecs[ci]) === 0 : tenths(d) === 0)
      : absoluteSpecs[ci] ? roundedNumber(d, absoluteSpecs[ci]) === 0 : deltaPrintsZero(d);
  const toneOf = (d: number, ci = 0): 'good' | 'bad' | 'neutral' =>
    d === 0 || shownZero(d, ci) ? 'neutral' : (d > 0) === (direction === 'higherIsBetter') ? 'good' : 'bad';
  // A bar or cap is a large fill and takes the signed fill role (`fill`),
  // which falls back to good / bad; a pin keeps good / bad.
  const tonePaint = (tone: 'good' | 'bad' | 'neutral', cellFill?: string, fill = false): Paint => {
    if (cellFill) return { css: cellFill };
    if (tone === 'neutral') return semanticPalettePaint(theme, options.palette, 'neutralMark');
    if (cbSafe) return colorblindPaint(tone, fill);
    return fill ? signedFillPaint(tone) : { token: tone };
  };
  /** The colour of a bar or cap fill, for its inside label. */
  const toneCss = (tone: 'good' | 'bad' | 'neutral', cellFill?: string): string =>
    cellFill ?? (tone === 'neutral' ? paintColor(theme, { token: 'neutralMark' }) : paintColor(theme, tonePaint(tone, undefined, true)));
  /**
   * Complete periods use solid caps, even against a forecast reference.
   * A partial category adds its hatch separately to both the actual and cap.
   * The cap keys stay solid; the partial-period key explains that hatch.
   */
  const capPattern: 'hatch45' | undefined = undefined;
  /**
   * A cap that ends past the actual's edge is the shortfall: the stretch of
   * the reference the actual does not fill. It draws as an outline, so the
   * solid shape ends at the actual. A theme with `surface.shortfallCap:
   * 'solid'` fills it. A cap over the column (a beat) stays solid.
   */
  const capIsShortfall = (ci: number): boolean => {
    const ac = acArr[ci], ref = refArr[ci];
    return theme.surface?.shortfallCap !== 'solid' && ac !== null && ac !== undefined && ref !== null && ref !== undefined
      && (ac >= 0 ? ref > ac : ref < ac);
  };
  /**
   * The integrated actual column's paint, in column's order (paints.ts): the
   * cell fill, then the measured series' fill or colorRole, then the neutral.
   * The key swatch takes the series level, so it matches the columns.
   */
  const actualPaint = (cellFill?: string): Paint =>
    cellFill ? { css: cellFill }
      : measuredSeries?.fill ? { css: measuredSeries.fill }
        : measuredSeries?.colorRole ? markRolePaint(measuredSeries.colorRole, true)
          : semanticPalettePaint(theme, options.palette, 'neutralMark');
  /** Cell meta of the measured side (fill/label/priority overrides). */
  const measuredVal = (ci: number): NormVal =>
    ofSeries ? ofSeries.vals[ci]! : dataSeries[0]!.vals[ci]!;

  // ---- label-kind gates ----
  const kindShown = (kind: LabelKind): boolean => {
    const l = options.labels;
    if (l === false) return kind === 'category' && labelsOffKeepsNames(options);
    return l?.[kind] !== false;
  };

  const partialCats = cats.filter((c, ci) => c.partial === true &&
    (mode === 'integrated' ? acArr[ci] !== null : deltaOf(ci) !== null));
  // A running category's variance says so under its value, as combo's total does: the value
  // over the bar, pin or cap. A value under its mark or none at all keeps the hatch key.
  const toDate = options.strings?.toDate ?? chartString(options, 'toDate');
  const toDateIds = new Set<Id>(partialKeyForced(options) || !kindShown('point') || !toDateFits(toDate, theme, measure, size.width / Math.max(1, cats.length)) ? []
    : partialCats.filter((c) => {
      const ci = cats.indexOf(c);
      const override = measuredVal(ci).labelOverride;
      if (saysToDate(c.label ?? c.id, toDate)) return false;
      if (mode === 'integrated') return refArr[ci] !== null && dAbsArr[ci] !== null && dAbsArr[ci] !== 0 && acArr[ci]! >= 0;
      return override !== false && !(typeof override === 'string' && override.trim() === '') && (mode === 'relative' ? dPctArr[ci] ?? -1 : dAbsArr[ci] ?? -1) >= 0;
    }).map((c) => c.id));
  const partialNamed = toDateIds.size > 0 && partialCats.every((c) => toDateIds.has(c.id));

  // ---- key (integrated only) ----
  // The integrated form paints what no mark names: the AC column and a
  // solid cap in the good or bad tone. The key names
  // them, so the one cap colour a chart uses is never a guess: the cap is the
  // stretch between AC and the reference. On a beat it is AC above the
  // reference; on a miss it is the shortfall, drawn above AC up to the
  // reference, which is why AC's value then sits under it inside the column.
  // The other modes print a signed number on every bar and pin,
  // which says the same.
  let legendInput: { options: LegendOptions; items: LegendItemInput[] } | undefined;
  if (mode === 'integrated') {
    const items: LegendItemInput[] = [{
      id: ofSeries?.id ?? 'total',
      label: ofSeries?.label ?? (dataSeries.length === 1 ? dataSeries[0]!.label : options.strings?.total ?? 'Total'),
      paint: actualPaint(),
    }];
    // the key names each cap the same way at every
    // width. The actual's value reads at the column foot, so no key clause
    // has to say where a cap stands past the actual's end.
    // The categories whose cap is on one side of its reference in one tone.
    const capsOf = (above: boolean, tone: 'good' | 'bad' | 'neutral'): number[] =>
      cats.flatMap((_, ci) => dAbsArr[ci] !== null && dAbsArr[ci]! !== 0 && dAbsArr[ci]! > 0 === above && toneOf(dAbsArr[ci]!, ci) === tone ? [ci] : []);
    for (const above of [true, false]) {
      // A cap that prints as zero is neutral and, as in the other
      // modes, not keyed: one label per side, never a neutral twin.
      const tones = new Set(dAbsArr.flatMap((d, ci) => d !== null && d > 0 === above ? [toneOf(d, ci)] : []));
      tones.delete('neutral');
      for (const tone of tones) {
        items.push({
          id: `cap:${above ? 'above' : 'below'}${tones.size > 1 ? `:${tone}` : ''}`,
          label: above ? chartString(options, 'aboveReference', { v1: refWord }) : chartString(options, 'belowReference', { v1: refWord }),
          paint: tonePaint(tone, undefined, true),
          ...(capPattern ? { pattern: capPattern } : {}),
          ...(capsOf(above, tone).every(capIsShortfall) ? { hollow: true } : {}),
        });
      }
    }
    // A cap that prints as zero takes the muted tint, which no mark names.
    if (cats.some((_, ci) => { const d = dAbsArr[ci]!; return acArr[ci] !== null && refArr[ci] !== null && d !== null && d !== 0 && toneOf(d, ci) === 'neutral'; })) {
      items.push({ id: 'cap:neutral', label: chartString(options, 'withinRounding', { v1: refWord }), paint: mutedMarkPaint(), ...(capsOf(true, 'neutral').concat(capsOf(false, 'neutral')).every(capIsShortfall) ? { hollow: true } : {}) });
    }
    items.push(...partialLegendKeys(partialCats.length > 0 && !partialNamed, options.strings));
    // A grid panel leaves its key to the grid legend, which collects it, and
    // `legend: 'none'` drops it for a host that draws its own.
    const legendOptions = panelTypeClass(options) === undefined && options.legend !== 'none'
      ? legendRequired(options.legend, warnings, 'variance', theme, 'the cap colours say whether AC lies above or below the reference')
      : normalizeLegendOption(options.legend);
    if (legendOptions) legendInput = { options: legendOptions, items };
    else if (panelTypeClass(options) === undefined && options.legend === 'none') legendOff(warnings, 'variance', items.map((item) => item.label));
  } else {
    // Green and red carry better and worse, which the sign
    // alone does not say once lower is better. The key names only the tones
    // drawn: every key entry names a mark on the chart (grid.tiers).
    // For a cost measure it says that lower is the better side.
    const lower = direction === 'lowerIsBetter';
    const drawn = new Set(cats.flatMap((_, ci) => { const d = deltaOf(ci); return d === null ? [] : [toneOf(d, ci)]; }));
    const items: LegendItemInput[] = (['good', 'bad'] as const).filter((tone) => drawn.has(tone)).map((tone) => ({
      id: `tone:${tone}`,
      label: chartString(options, 'varianceTone', { v1: tone === 'good' ? chartString(options, 'betterCapital') : chartString(options, 'worseCapital'), v2: refWord, v3: lower ? ` (${tone === 'good' ? chartString(options, 'lower') : chartString(options, 'higher')})` : '' }),
      paint: tonePaint(tone, undefined, mode === 'absolute'),
      ...(mode === 'relative' ? { key: 'marker' as const } : {}),
    }));
    if (mode === 'absolute') items.push(...partialLegendKeys(partialCats.length > 0 && !partialNamed, options.strings));
    const legendOptions = items.length === 0 ? undefined : panelTypeClass(options) === undefined && options.legend !== 'none'
      ? legendRequired(options.legend, warnings, 'variance', theme, 'the colours say better or worse than the reference')
      : normalizeLegendOption(options.legend);
    if (legendOptions) legendInput = { options: legendOptions, items };
    else if (panelTypeClass(options) === undefined && options.legend === 'none') legendOff(warnings, 'variance', items.map((item) => item.label));
  }

  // ---- frame ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  margin.right = Math.max(margin.right, (options as { [VALUE_LINE_RESERVE]?: number })[VALUE_LINE_RESERVE] ?? 0);
  // An n.m. category prints its absolute change beside the
  // marker, in the measure's own unit, which a percent chart names nowhere
  // else. One note says what n.m. means and names that unit once.
  const nmShown = mode === 'relative' && nmCats.size > 0 && options.footnotes !== false;
  const nmNote = disclosureNote(chartString(options, 'varianceNmNote', { v1: refWord, v2: options.unit ? chartString(options, 'inUnitClause2', { v1: options.unit }) : '' }));
  const partialNotes = partialFootnotes(partialCats, options.strings, partialNamed);
  const frameOptions = partialNotes.length || nmShown
    ? withAuthoredFootnotes(options, [...partialNotes, ...authoredNotes(options), ...(nmShown ? [nmNote] : [])], options.footnotes)
    : options;
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(frameOptions),
      legend: legendInput,
      // Relative variance sets its key beside a wrapped subtitle's last line.
      ...(mode === 'relative' ? { keyBesideWrappedSubtitle: true } : {}),
      // Relative variance plots percent: the unit the frame names is '%', not the money unit.
      ...(mode === 'relative' && options.unit !== undefined ? { unit: '%' } : {}),
      title: options.title ?? tierName, // tier name is the default title
      theme,
      measure,
    },
    occupied,
  );

  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const labelH = measure('0', labelFont).height;
  // The value-axis title in the head band, as on column; drawn only when authored.
  const axisTitle = options.valueAxis?.show && kindShown('axisTitle')
    ? planValueAxisTitle(options.axisTitles?.primary, theme, measure, frameResult.plot.w)
    : undefined;
  // Forced outside labels above AND below need fixed headroom on both sides.
  // A growth bracket spans the bars from above: with the key row
  // in the head band it needs its own air over the tallest label, as the
  // waterfall reserves it.
  const bracketPad = legendInput && (options.annotations ?? []).some((annotation) => annotation.kind === 'cagr') ? 30 : 0;
  // A running value's to-date words stand under it: the headroom holds the second line too.
  const wordsH = toDateIds.size > 0 ? measure(toDate, toDateFont(theme)).height : 0;
  // A larger variance that found no seat over its neighbours gets one more value row (second pass).
  const liftRow = (options as { [LIFT_ROW]?: { above: number; below: number } })[LIFT_ROW];
  const topPad = 8 + valueAxisTitleBand(axisTitle, theme, measure) + labelH + wordsH + 4 + bracketPad + (liftRow?.above ?? 0);
  // an integrated chart with nothing under zero prints no
  // label below its columns; its name row starts at the baseline.
  const nothingBelowZero = mode === 'integrated' && cats.every((_, ci) => (acArr[ci] ?? 0) >= 0 && (refArr[ci] ?? 0) >= 0);
  const bottomPad = (nothingBelowZero ? 0 : labelH + 4) + (liftRow?.below ?? 0);

  // ---- domain (zero always included; user min/max may never clip data) ----
  // Computed BEFORE the plot rect: the tick-band reserve must measure its
  // label wraps against the band step, and
  // the step needs the axis reserve, which needs the domain. Data, the
  // authored bounds and the value lines — nothing here reads plot geometry.
  const lineExtent = valueLineExtent(options.annotations); // a drawn value line is part of the stated range
  let lo = Math.min(0, lineExtent?.lo ?? 0), hi = Math.max(0, lineExtent?.hi ?? 0);
  cats.forEach((_, ci) => {
    if (mode === 'integrated') {
      const ac = acArr[ci]!;
      const ref = refArr[ci]!;
      if (ac !== null) {
        lo = Math.min(lo, ac);
        hi = Math.max(hi, ac);
      }
      if (ac !== null && ref !== null) {
        lo = Math.min(lo, ref);
        hi = Math.max(hi, ref);
      }
    } else {
      const d = deltaOf(ci);
      if (d !== null) {
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
    }
  });
  let lo2 = lo < 0 ? lo * 1.08 : 0;
  let hi2 = hi > 0 ? hi * 1.08 : 0;
  if (lo2 === 0 && hi2 === 0) hi2 = 1;
  // lo/hi start at 0, so the extent carries the structural baseline; the bound
  // keeps snap overshoot from manufacturing dead plot bands beyond the label
  // headroom (the domain-economy invariant).
  // Mixed-sign domains snap BOTH edges, so the raw-mark envelope can drop to
  // 0.70 while each side clears the 0.15 cap. The ink-envelope gate measures
  // marks PLUS value labels, and the label band over the extreme bars is what
  // carries the shapes the snap leaves wide. Capping the SUM here instead would
  // crush the label air over small-magnitude extremes, so a top value label
  // could collide everywhere and be lost: "never lose a label" traded for
  // geometry. That the defaults plus labels satisfy the 0.80 floor is MEASURED,
  // not assumed: tests/invariants.test.ts runs spaceDocLints over the fixtures.
  const va = options.valueAxis ?? {};
  // with no value axis nothing reads a tick, so the scale
  // spans the data exactly and the pads above and below hold the value
  // labels. Nice ticks only add empty bands under the lowest label. An
  // annotation over the bars (a growth bracket, a callout) keeps the
  // snapped headroom it is placed in.
  const exactDomain = !va.show && (options.annotations ?? []).every((annotation) => annotation.kind === 'valueLine');
  let [dLo, dHi] = !exactDomain
    ? niceDomain(lo2, hi2, 5, {
      dataExtent: [lo, hi],
      maxWasteFraction: 0.15,
    })
    : lo === 0 && hi === 0 ? [0, 1] : [lo, hi];
  [dLo, dHi] = applyAxisBounds([dLo, dHi], [Math.min(lo, 0), Math.max(hi, 0)], va, warnings);

  const axisFmt = mode === 'relative' ? (v: number) => formatAutomaticPercent(v, 0, false, options.locale?.language)
    : percentDifferences || integratedPercent ? (v: number) => options.format
      ? formatWithSpec(v, { ...exampleSpec(options.format, options.locale?.language), prefix: '', suffix: percentDifferences ? PERCENTAGE_POINTS : '%' })
      : formatAutomaticNumber(v, { locale: options.locale?.language, decimals: autoDecimals(v), suffix: percentDifferences ? PERCENTAGE_POINTS : '%' }) : fmt;
  const axisReserve = va.show ? measureValueAxisWidth([dLo, dHi], axisFmt, theme, measure) : 0;
  let plotX0 = frameResult.plot.x + axisReserve;
  let plotW0 = va.show ? Math.max(10, frameResult.plot.w - axisReserve) : frameResult.plot.w;
  // integrated columns take 60 % of the band, so the cap
  // and the foot label read as one column with air on both sides.
  const bandFraction = options.bandFraction ?? (mode === 'relative' ? 0.55 : mode === 'integrated' ? 0.6 : 0.7);
  const totalWidth = integratedPercent && options.bandFraction === undefined && kindShown('total')
    ? maxOf(acArr.flatMap((value, ci) => value === null ? [] : [measure(absolute(value, ci), strongFont).width + 4])) : 0;
  const bandFor = (x0: number, w: number) => {
    // Keep the percent unit inside its column; the 0.1 outer step leaves the category centres unchanged.
    const fraction = totalWidth > 0 && w > 0 ? Math.max(bandFraction, Math.min(0.95, totalWidth / (w / (cats.length + 0.1)))) : bandFraction;
    return bandScale(cats.length, [x0, x0 + w], {
      paddingInner: 1 - fraction,
      paddingOuter: (1 - fraction) / 2 + 0.05,
    });
  };
  let band = bandFor(plotX0, plotW0);

  // Date/numeric ticks are one line on one row; prose wraps to two
  // and may stagger, so a crowded prose axis reserves its second tier.
  const dateNumericTicks = isDateNumericTickSequence(cats.map((c) => c.label ?? c.id));
  const planRow = (b: typeof band) =>
    planCategoryRow({
      ...categoryLabelsAndMarks(cats, { count: authoredFootnoteCount(options), warnings }, partialAxisWords(options.strings, options, legendInput?.items.some((item) => item.id === '__partial') || partialNamed)),
      centers: cats.map((_, ci) => b.center(ci)),
      step: b.step,
      fonts: [tickFont, { family: theme.type.family, ...theme.type.footnote }],
      measure,
      plotHeight: frameResult.plot.h,
      target: options.target, textScale: textScaleOf(options),
    });
  let catPlan = planRow(band);
  const catOverhang = rotatedLeftOverhang(catPlan, cats.map((_, ci) => band.center(ci)), 4);
  if (catOverhang > 0) {
    plotX0 += catOverhang;
    plotW0 -= catOverhang;
    band = bandFor(plotX0, plotW0);
    catPlan = planRow(band);
  }
  const catInfos = catPlan.infos;
  const catFont = catPlan.font;
  const catTickMaxLines = catPlan.maxLines;
  const showCatTickRow = kindShown('category') && cats.length > 0;
  if (showCatTickRow) pushAll(warnings, catPlan.warnings);
  // A name that reads beside the zero line needs
  // no row under the plot. The row is reserved only where the names do not
  // fit between the zero line and the plot edge on the side they take.
  const besideZeroFits = (): boolean => {
    if (mode === 'integrated' || catPlan.rotation !== 0) return false;
    const h0 = frameResult.plot.h - topPad - bottomPad;
    const span = dHi - dLo;
    if (!(h0 > 0) || !(span > 0)) return false;
    const need = catPlan.rowHeight + 4;
    const below = (h0 * -Math.min(0, dLo)) / span + bottomPad;
    const above = (h0 * Math.max(0, dHi)) / span + topPad;
    const deltas = cats.map((_, ci) => deltaOf(ci));
    const gains = deltas.some((d) => d === null || d >= 0);
    const losses = deltas.some((d) => d !== null && d < 0);
    return (!gains || below >= need) && (!losses || above >= need);
  };
  const catBandH = showCatTickRow && !besideZeroFits() ? catPlan.rowHeight + 8 : 0;
  // In relative mode the pins, their values and the month names
  // share the plot floor, so the label rows count as plot, not as chrome.
  const floorTakesLabels = mode === 'relative';
  if (!showCatTickRow || ['fit', 'wrap', 'font-down'].includes(catPlan.step)) {
    fixedPlotChrome(frameResult, floorTakesLabels ? 0 : catBandH + topPad + bottomPad);
  }
  const plot: Rect = {
    x: frameResult.plot.x,
    y: frameResult.plot.y + topPad,
    w: frameResult.plot.w,
    h: plotHeightAfter(frameResult, size.height, frameResult.plot.h - catBandH - topPad - bottomPad),
  };

  // ---- value axis (optional; reserve measured above, shrinks plot) ----
  const nodes: SceneNode[] = [...frameResult.nodes];
  const axes: AxisGeometry[] = [];
  if (va.show) {
    plot.x += axisReserve;
    plot.w = Math.max(10, plot.w - axisReserve);
  }
  const y = linearScale([dLo, dHi], [plot.y + plot.h, plot.y]);
  const y0 = y(0);
  if (va.show) {
    const axisResult = layoutValueAxis(
      {
        scale: y,
        plot,
        orient: 'y',
        gridlines: va.gridlines ?? false,
        format: axisFmt,
        // A tier is a short strip: about three ticks read there (0, 5, 10%), not a ladder.
        ...(isVarianceTier(options) ? { tickCount: 3 } : {}),
        theme,
        measure,
      },
      occupied,
    );
    nodes.push(...axisResult.nodes);
    axes.push(axisResult.axis);
  }

  // baseline (thin solid, always) — spans the band range ± half a gap,
  // not the full plot width, so it never overhangs the right label reserve
  const halfGap = (band.step - band.bandwidth) / 2;
  const baselineX1 = band.position(0) - halfGap;
  const baselineX2 = band.position(cats.length - 1) + band.bandwidth + halfGap;
  const baselineId = 'axis:baseline';
  nodes.push({
    t: 'line',
    id: baselineId,
    x1: baselineX1,
    y1: y0,
    x2: baselineX2,
    y2: y0,
    stroke: { token: 'axis' },
    width: strokeToken(theme, 'rule'),
    owner: {},
    part: 'baseline',
  });
  occupied.claim({ x: baselineX1, y: y0 - 1, w: baselineX2 - baselineX1, h: 2 }, 'axis', {});

  // ---- marks + label requests ----
  const marks: VarianceMarks = { bars: [], pins: [] };
  const pinInk = new Map<string, Paint>();
  const pin = pinGeometry(theme, size.width);
  const labelRequests: LabelRequest[] = axisTitle
    ? [valueAxisTitleRequest(axisTitle, { x: frameResult.plot.x, y: frameResult.plot.y + 4 }, 'start', 'axis:y:title')]
    : [];
  /** Pixel y of the anchor end (away from baseline) per category, for annotations. */
  const anchorTopY: (number | null)[] = [];
  /** Visual bottom (pixel) per category for category-label placement. */
  const visBottomY: number[] = [];
  /** Integrated mode: the pixel span (top, bottom) of each column's marks, for the value seat clear of its neighbours. */
  const markSpanY: ({ top: number; bottom: number } | null)[] = [];

  /**
   * The glyph a missing prior leaves behind. Without it a category
   * whose reference is absent draws nothing at all, and an empty slot on a
   * variance chart reads as a zero difference. `missingMark: 'dash'` prints
   * an en dash at the baseline instead; 'n.m.' stays what it always was, the
   * narrower case of a reference that exists and is not positive.
   * an integrated column with no reference takes the dash where the
   * cap would sit, beyond the actual's edge (`edgeY`, below it when the
   * actual is negative), drawn after the column so the column never hides it.
   */
  const missingDash = (categoryId: Id, cx: number, edgeY = y0, below = false): void => {
    if (options.missingMark !== 'dash') return;
    const font = { family: theme.type.family, ...theme.type.label };
    // The theme's missing glyph where it sets one, so a table and a variance
    // chart print the same mark.
    const glyph = theme.table?.glyphs?.missing ?? '\u2013';
    const size = measure(glyph, font);
    const rect: Rect = { x: cx - size.width / 2, y: below ? edgeY + 6 : edgeY - size.height - 6, w: size.width, h: size.height };
    nodes.push({
      t: 'text',
      id: `missing:${categoryId}`,
      x: cx,
      y: rect.y,
      lines: [glyph],
      align: 'middle',
      font,
      ink: { token: 'inkMuted' },
      owner: { categoryId },
      part: 'nmMarker',
      typeRole: 'label',
      display: { state: 'missing' },
    });
    occupied.claim(rect, 'label', { categoryId });
  };

  cats.forEach((c, ci) => {
    const bx = band.position(ci);
    const bw = band.bandwidth;
    const cx = band.center(ci);
    const owner = { categoryId: c.id };
    const mv = measuredVal(ci);
    const pattern = partialPattern(c, undefined);
    const partialFill = (fill: Paint) => pattern
      ? { pattern, hatchGround: hatchGroundPaint(fill) }
      : {};
    const hl = highlights.has(c.id);
    anchorTopY[ci] = null;
    visBottomY[ci] = y0;

    if (mode === 'relative') {
      const d = dPctArr[ci]!;
      if (d === null) {
        // ref ≤ 0: suppression must leave a visible trace, not a hole —
        // 'n.m.' at the baseline says WHY the pin is absent (missing data
        // stays blank; only not-meaningful gets the glyph)
        if (nmCats.has(c.id)) {
          const font = { family: theme.type.family, ...theme.type.label };
          // The absolute change names its unit, so in a percent chart "+9" never reads as +9%.
          const change = absolute(dAbsArr[ci]!, ci, true);
          // A percent unit names the relative change, not the source measure: the change then prints bare.
          const sourceUnit = options.unit === '%' || options.unit === 'pp' ? undefined : options.unit;
          const text = `n.m. (${absoluteFormat(ci) ? change : withUnit(change, sourceUnit, false, options.locale?.language)})`;
          // Centred on its category, kept inside the plot. A text wider than the plot breaks after "n.m.".
          const whole = measure(text, font);
          const split = whole.width > plot.w ? text.indexOf(' ') : -1;
          const lines = split > 0 ? [text.slice(0, split), text.slice(split + 1)] : [text];
          const size = { width: Math.max(...lines.map((line) => measure(line, font).width)), height: whole.height * lines.length };
          const nx = Math.max(plot.x + size.width / 2, Math.min(cx, plot.x + plot.w - size.width / 2));
          const rect: Rect = { x: nx - size.width / 2, y: y0 - size.height - 6, w: size.width, h: size.height };
          nodes.push({
            t: 'text',
            id: `nm:${c.id}`,
            x: nx,
            y: rect.y,
            lines,
            align: 'middle',
            font,
            ink: { token: 'inkMuted' },
            owner,
            typeRole: 'label',
            part: 'nmMarker',
            display: { state: 'n.m.' },
          });
          occupied.claim(rect, 'label', owner);
        } else {
          missingDash(c.id, cx);
        }
        return;
      }
      const tone = toneOf(d, ci);
      const paint = tonePaint(tone, mv.fill);
      const yv = y(d);
      const stemId = `mark:stem:${c.id}`;
      nodes.push({
        t: 'line',
        id: stemId,
        x1: cx,
        y1: y0,
        x2: cx,
        y2: yv,
        stroke: paint,
        width: pin.stem,
        owner,
        part: 'stem',
      });
      const headId = `mark:head:${c.id}`;
      nodes.push({
        t: 'circle',
        id: headId,
        cx,
        cy: yv,
        r: pin.r,
        fill: c.partial ? { token: 'background' } : paint,
        ...(c.partial ? { stroke: paint } : {}),
        owner,
        part: 'head',
        display: { value: pctSigned(d, ci) },
      });
      const pinRect: Rect = {
        x: cx - pin.r,
        y: Math.min(yv - pin.r, y0),
        w: pin.r * 2,
        h: Math.max(Math.abs(yv - y0) + pin.r, pin.r * 2),
      };
      occupied.claim({ x: cx - 1, y: Math.min(y0, yv), w: 2, h: Math.abs(yv - y0) || 1 }, 'mark', owner);
      occupied.claim({ x: cx - pin.r, y: yv - pin.r, w: pin.r * 2, h: pin.r * 2 }, 'mark', owner);
      marks.pins.push({ categoryId: c.id, rect: pinRect, stemNodeId: stemId, headNodeId: headId });
      anchorTopY[ci] = yv;
      visBottomY[ci] = Math.max(y0, yv + pin.r);

      if (!kindShown('point')) return;
      let text = pctSigned(d, ci);
      if (typeof mv.labelOverride === 'string') text = mv.labelOverride.replace(/\$\{value\}/g, text);
      if (mv.labelOverride === false) return;
      // The growth value prints bold in its pin's tone; a neutral pin keeps the ink.
      const words = toDateIds.has(c.id) ? toDateLabel(text, strongFont, toDate, theme, measure) : undefined;
      const tsize = words?.size ?? measure(text, strongFont);
      // seriesTextPaint darkens the tone only where it reads under 4.5:1 as text.
      if (tone !== 'neutral') pinInk.set(`point:${c.id}`, seriesTextPaint(paint));
      labelRequests.push({
        id: `point:${c.id}`,
        claimId: `var:${mode === 'relative' ? 'pct' : 'abs'}:${c.id}`,
        claimText: mode === 'relative' ? pctSigned(d, ci) : absolute(d, ci, true),
        kind: 'point',
        owner,
        valueRow: true,
        text,
        lines: words?.lines ?? [text],
        ...words?.request,
        font: strongFont,
        priority:
          (mv.priority ?? PRIORITY.endpoint + Math.min(99, Math.abs(d))) +
          (hl ? PRIORITY.highlightBonus : 0),
        candidates: relativePointCandidates(cx, yv, y0, tsize, d < 0, pin.r, isVarianceTier(options), !isVarianceTier(options) || isSingleVarianceTier(options)),
      });
      return;
    }

    if (mode === 'absolute') {
      const d = dAbsArr[ci]!;
      if (d === null) {
        missingDash(c.id, cx);
        return;
      }
      const tone = toneOf(d, ci);
      const yv = y(d);
      const rect: Rect = {
        x: bx,
        y: Math.min(yv, y0),
        w: bw,
        h: Math.max(Math.abs(yv - y0), 0.5),
      };
      const nodeId = `mark:delta:${c.id}`;
      nodes.push({
        t: 'rect',
        id: nodeId,
        rect,
        fill: tonePaint(tone, mv.fill, true),
        ...partialFill(tonePaint(tone, mv.fill, true)),
        owner,
        part: 'bar',
        display: { value: absolute(d, ci, true) },
      });
      occupied.claim(rect, 'mark', owner);
      marks.bars.push({ categoryId: c.id, rect, nodeId });
      anchorTopY[ci] = yv;
      visBottomY[ci] = Math.max(y0, yv);

      if (!kindShown('point')) return;
      let text = absolute(d, ci, true);
      if (typeof mv.labelOverride === 'string') text = mv.labelOverride.replace(/\$\{value\}/g, text);
      if (mv.labelOverride === false) return;
      const words = toDateIds.has(c.id) ? toDateLabel(text, labelFont, toDate, theme, measure) : undefined;
      const tsize = words?.size ?? measure(text, labelFont);
      labelRequests.push({
        id: `point:${c.id}`,
        claimId: `var:abs:${c.id}`,
        claimText: absolute(d, ci, true),
        kind: 'point',
        owner,
        valueRow: true,
        text,
        lines: words?.lines ?? [text],
        ...words?.request,
        font: labelFont,
        // EVERY bar labeled: endpoint band keeps them through density=minimal
        priority:
          (mv.priority ?? PRIORITY.endpoint + Math.min(99, Math.abs(d))) +
          (hl ? PRIORITY.highlightBonus : 0),
        // The muted words never sit inside the fill.
        candidates: deltaBarCandidates(rect, tsize, d < 0, toneCss(tone, mv.fill)).filter(candidate => !words || !candidate.insideFill).map(candidate => ({ ...candidate, ...(pattern && candidate.insideFill ? { insidePattern: pattern, insideFill: effectiveFill(toneCss(tone, mv.fill), pattern, theme) } : {}), insidePaint: mv.fill ? { css: mv.fill } : tone === 'neutral' ? { token: 'neutralMark' as const } : tonePaint(tone, undefined, true) })),
      });
      return;
    }

    // ---- integrated: AC column + variance cap spanning REF↔AC ----
    const ac = acArr[ci]!;
    if (ac === null) {
      missingDash(c.id, cx);
      return;
    }
    const ref = refArr[ci]!;
    const d = dAbsArr[ci]!;
    // The notation rules flag integrated overlays as hard to read once the Δ dominates
    // the level or AC/REF straddle zero — recommend the two-tier form then
    if (
      ref !== null &&
      d !== null &&
      (Math.abs(d) / Math.max(Math.abs(ac), Math.abs(ref), 1e-9) > 2 / 3 || ac >= 0 !== ref >= 0)
    ) {
      integratedExtreme.push(c.id);
    }
    const acTop = y(Math.max(0, ac));
    const acBot = y(Math.min(0, ac));
    const barRect: Rect = { x: bx, y: acTop, w: bw, h: Math.max(acBot - acTop, 0.5) };
    const nodeId = `mark:ac:${c.id}`;
    nodes.push({
      t: 'rect',
      id: nodeId,
      rect: barRect,
      fill: actualPaint(mv.fill),
      ...partialFill(actualPaint(mv.fill)),
      owner,
      part: 'bar',
      display: { value: absolute(ac, ci) },
    });
    occupied.claim(barRect, 'mark', owner);
    if (ref === null) missingDash(c.id, cx, ac >= 0 ? acTop : acBot, ac < 0);
    const bar: VarianceMarks['bars'][number] = { categoryId: c.id, rect: barRect, nodeId };

    let visHiVal = Math.max(0, ac);
    let visLoVal = Math.min(0, ac);
    let capRect: Rect | null = null;
    let capTone: 'good' | 'bad' | 'neutral' = 'neutral';
    if (ref !== null && d !== null && d !== 0) {
      capTone = toneOf(d, ci);
      const capHiVal = Math.max(ac, ref);
      const capLoVal = Math.min(ac, ref);
      visHiVal = Math.max(visHiVal, capHiVal);
      visLoVal = Math.min(visLoVal, capLoVal);
      const capY = y(capHiVal);
      capRect = { x: bx, y: capY, w: bw, h: Math.max(y(capLoVal) - capY, 0.5) };
      const capId = `mark:cap:${c.id}`;
      nodes.push({
        t: 'rect',
        id: capId,
        rect: capRect,
        // A cap that prints as zero is neutral. In the actual's own
        // neutral it extended the column, and a shortfall read as reaching the
        // reference; the muted tint keeps the actual's top edge.
        fill: capTone === 'neutral' ? mutedMarkPaint() : tonePaint(capTone, undefined, true),
        ...(capIsShortfall(ci)
          ? { pattern: 'hollow' as const }
          : { pattern: capPattern, ...partialFill(capTone === 'neutral' ? mutedMarkPaint() : tonePaint(capTone, undefined, true)) }),
        owner,
        part: 'cap',
        display: { value: absolute(d, ci, true) },
      });
      occupied.claim(capRect, 'mark', owner);
      bar.cap = { rect: capRect, nodeId: capId };
    }
    marks.bars.push(bar);
    const visHiY = y(visHiVal);
    const visLoY = y(visLoVal);
    anchorTopY[ci] = ac >= 0 ? visHiY : visLoY;
    markSpanY[ci] = { top: Math.min(visHiY, visLoY, y0), bottom: Math.max(visHiY, visLoY, y0) };
    visBottomY[ci] = Math.max(y0, visLoY);

    // AC total label AT the AC edge (the notation rule says the bold
    // number must read as the column's value — anchored to the envelope it
    // appeared to label the REF top whenever |Δ| pushed the cap beyond AC)
    if (kindShown('total')) {
      const text = absolute(ac, ci);
      const tsize = measure(text, strongFont);
      const above = ac >= 0;
      const acEdgeY = above ? acTop : acBot;
      // The label anchors to the actual edge, including when the cap covers
      // that edge.
      const insideCap = capRect !== null && ref !== null && (above ? ref < ac : ref > ac);
      const insidePaint = insideCap
        ? capTone === 'neutral' ? mutedMarkPaint() : tonePaint(capTone, undefined, true)
        : actualPaint(mv.fill);
      // A thin cap cannot hold the label on one paint. Use the side slot at
      // the actual edge instead of putting the label at the reference.
      const insideHeight = insideCap ? Math.min(barRect.h, capRect!.h) : Math.abs(y0 - acEdgeY);
      const candidates: LabelRequest['candidates'] = [];
      // Every actual value reads at one place,
      // the column's foot, on the actual's own paint. The grey stretch at the
      // foot ends where a cap inside the column starts (a beat drawn below
      // the actual's edge). The edge and side slots stay as fallbacks for a
      // column too short to hold the label.
      const footEdgeVal = ref === null || d === null || d === 0 ? ac : above ? Math.max(0, Math.min(ac, ref)) : Math.min(0, Math.max(ac, ref));
      const footH = Math.abs(y0 - y(footEdgeVal));
      const foot = footH >= tsize.height + 8;
      if (foot) {
        const footPaint = actualPaint(mv.fill);
        candidates.push({
          slot: above ? 'insideBase' : 'insideBaseBelow',
          rect: {
            x: cx - tsize.width / 2,
            y: above ? y0 - tsize.height - 4 : y0 + 4,
            w: tsize.width,
            h: tsize.height,
          },
          penalty: 0,
          insideFill: paintColor(theme, footPaint),
          insidePaint: footPaint,
          ...(pattern ? { insidePattern: pattern, insideFill: effectiveFill(paintColor(theme, footPaint), pattern, theme) } : {}),
        });
      }
      const fallback = foot ? 1 : 0;
      if (insideHeight >= tsize.height + 8) {
        candidates.push({
          slot: above ? 'insideEnd' : 'insideEndBelow',
          rect: {
            x: cx - tsize.width / 2,
            y: above ? acEdgeY + 4 : acEdgeY - tsize.height - 4,
            w: tsize.width,
            h: tsize.height,
          },
          penalty: fallback,
          insideFill: paintColor(theme, insidePaint),
          insidePaint,
          ...(pattern ? { insidePattern: pattern, insideFill: effectiveFill(paintColor(theme, insidePaint), pattern, theme) } : {}),
        });
      }
      // A column too short to hold it: level with the actual's edge, left of
      // the column, where no Δ prints.
      candidates.push({
        slot: 'leftOfAcEdge',
        rect: { x: bx - 4 - tsize.width, y: acEdgeY - tsize.height / 2, w: tsize.width, h: tsize.height },
        penalty: 1 + fallback,
      });
      labelRequests.push({
        id: `total:${c.id}`,
        kind: 'total',
        owner,
        text,
        lines: [text],
        font: strongFont,
        priority: PRIORITY.total + (hl ? PRIORITY.highlightBonus : 0),
        candidates: candidates.filter(candidate => candidate.rect.x >= bx && candidate.rect.x + candidate.rect.w <= bx + bw),
      });
    }

    // Notation rule: the Δ reads outside its cap, in the
    // direction of the value (above a column over zero), signed, in the text
    // ink; the colour stays on the cap. One position, tall cap or thin.
    if (capRect && d !== null && kindShown('point')) {
      const text = absolute(d, ci, true);
      const words = toDateIds.has(c.id) ? toDateLabel(text, labelFont, toDate, theme, measure) : undefined;
      const tsize = words?.size ?? measure(text, labelFont);
      const above = ac >= 0;
      const outerY = above ? capRect.y : capRect.y + capRect.h;
      labelRequests.push({
        id: `point:${c.id}`,
        claimId: `var:abs:${c.id}`,
        claimText: absolute(d, ci, true),
        kind: 'point',
        owner,
        valueRow: true,
        text,
        lines: words?.lines ?? [text],
        ...words?.request,
        font: labelFont,
        priority:
          PRIORITY.interior + Math.min(99, Math.abs(d)) + (hl ? PRIORITY.highlightBonus : 0),
        candidates: [0, 1].map((row) => ({
          slot: row === 0 ? (above ? 'aboveCap' : 'belowCap') : (above ? 'aboveCapShifted' : 'belowCapShifted'),
          rect: {
            x: cx - tsize.width / 2,
            y: above ? outerY - (row + 1) * (tsize.height + 4) : outerY + 4 + row * (tsize.height + 4),
            w: tsize.width,
            h: tsize.height,
          },
          penalty: row,
        })),
      });
    }
  });

  // A value wider than its column runs over its neighbours: their columns
  // and their values. Where those block both seats over the cap, a value may
  // rise clear of them (below them for a value under the baseline): clear of
  // the columns, clear of the neighbours' values, or one row higher, on a
  // leader to its own cap. solveVarianceLabels offers these seats only to a
  // value that ranks among the values the chart can hold.
  const pointRequests = new Map(labelRequests.filter(request => request.kind === 'point').map(request => [request.id, request]));
  const liftSeats = (request: LabelRequest): SlotCandidate[] => {
    const ci = cats.findIndex(c => request.id === `point:${c.id}`);
    const shifted = request.candidates[1];
    if (mode !== 'integrated' || ci < 0 || !shifted) return [];
    const above = shifted.slot === 'aboveCapShifted';
    const { x, w, h } = shifted.rect;
    const near = (from: number, to: number, gap: number) => from < x + w + gap && to > x - gap;
    const marks: number[] = [];
    const values: number[] = [];
    markSpanY.forEach((span, ni) => {
      if (!span) return;
      if (near(band.position(ni), band.position(ni) + band.bandwidth, 2)) marks.push(above ? span.top : span.bottom);
      const seat = ni === ci ? undefined : pointRequests.get(`point:${cats[ni]!.id}`)?.candidates[0]?.rect;
      if (seat && near(seat.x, seat.x + seat.w, SERIES_VALUE_GAP)) values.push(above ? seat.y : seat.y + seat.h);
    });
    if (marks.length === 0) return [];
    const step = h + 4;
    const clearOf = (edges: number[]) => above ? Math.min(...edges) - step : Math.max(...edges) + 4;
    const overValues = clearOf([...marks, ...values]);
    const rows = [clearOf(marks), overValues, overValues + (above ? -step : step)];
    const naturalY = request.candidates[0]!.rect.y;
    return [...new Set(rows)]
      .filter(y => above ? y < shifted.rect.y - 0.5 : y > shifted.rect.y + 0.5)
      .sort((p, q) => above ? q - p : p - q)
      .map((y, row) => ({
        slot: above ? 'aboveNeighbours' : 'belowNeighbours',
        rect: { ...shifted.rect, y },
        penalty: 2 + row,
        reach: Math.abs(y - naturalY) + 1,
      }));
  };

  if (integratedExtreme.length > 0) {
    warnings.push({
      code: 'integrated-delta-extreme',
      severity: 'warn',
      message: `integrated variance is hard to read when |Δ| dominates the level or AC/REF straddle zero (${integratedExtreme.join(', ')}) — prefer an AC tier plus an absolute-Δ tier (grid sharedAxis:'category')`,
    });
  }

  // ---- category labels ----
  let catLabelsShown = false;
  if (showCatTickRow) {
    catLabelsShown = true;
    const catX = catPlan.x;
    // The date/numeric tick row is ONE row inside the reserved band —
    // below the outside-label headroom, never at per-bar depths.
    const tickRowY = plot.y + plot.h + bottomPad + 6;
    // Prose names read in one row too, under the lowest variance and
    // the label hanging under it (bottomPad reserves that label), and never
    // hop above the baseline beside a positive variance's label.
    const proseRowY = maxOf(visBottomY.map((bottom) => (bottom > y0 ? bottom + labelH + 4 : y0))) + 6;
    const keep = catPlan.keep;
    const rotated = catPlan.rotation !== 0;
    // Integrated names have one fixed row. Seat the running-period words in
    // their planned row below it, so their width cannot hide a neighbouring name.
    const separateUnder = mode === 'integrated' && !rotated && catPlan.underRow !== undefined;
    if (separateUnder) {
      pushAll(labelRequests, yearRowRequests({ ...catPlan, yearRow: undefined }, dateNumericTicks ? tickRowY : proseRowY));
    }
    cats.forEach((c, ci) => {
      // A running period's "to date" line rides under its name in every slot the name may take.
      const under = separateUnder ? undefined : catPlan.underRow?.items.find((item) => item.index === ci);
      const named = catInfos[ci]!;
      const info = under ? { ...named, lines: [...named.lines, under.text], w: Math.max(named.w, under.w), h: named.h + under.h } : named;
      const nameX = under ? catX(ci) + named.w / 2 - info.w / 2 : catX(ci);
      const catY = dateNumericTicks ? tickRowY : proseRowY;
      // A name reads beside the zero line, on the side its variance leaves
      // free: under the line for a gain, over it for a loss. At the plot's
      // foot it could stand up to 155 px from a bar above zero.
      const d = deltaOf(ci);
      const besideY = d !== null && d < 0 ? y0 - 4 - info.h : y0 + 4;
      labelRequests.push({
        id: `category:${c.id}`,
        kind: 'category',
        owner: { categoryId: c.id },
        text: c.label ?? c.id,
        lines: info.lines,
        ...categoryLineAlign(catPlan, ci),
        ...(info.title !== undefined ? { title: info.title } : {}),
        font: catFont,
        priority: PRIORITY.endpoint,
        // A stride-hidden date label is the row's decision (one info lint), not a loss.
        redundant: !keep[ci],
        ...(rotated ? { rotate: -45, pad: 0 } : {}),
        candidates: rotated
          ? [
              {
                slot: 'below',
                rect: rotatedClaimRect(band.center(ci), catY + 2, info.h, catY - 6),
                penalty: 0,
              },
            ]
          : [
              ...(mode === 'integrated' ? [] : [{ slot: 'besideZero', rect: { x: nameX, y: besideY, w: info.w, h: info.h }, penalty: 0 }]),
              {
                slot: 'below',
                rect: { x: nameX, y: catY, w: info.w, h: info.h },
                penalty: 0,
              },
              ...(dateNumericTicks
                ? []
                : [{ slot: 'belowShifted', rect: { x: nameX, y: catY + labelH + 4, w: info.w, h: info.h }, penalty: 1 }]),
            ],
      });
    });
  }

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    density,
    measure,
    plot,
    labelPad: 2,
  });
  const solved: SolveResult & { stranded?: LabelRequest[] } = mode === 'integrated'
    ? solveVarianceLabels(labelRequests, occupied, solveCtx, liftSeats)
    : solveLabels(labelRequests, occupied, solveCtx);
  // The plot holds one value row over the tallest column. When a larger
  // variance still finds no seat while a smaller one keeps its value (the seat
  // over its neighbours runs into the key or the subtitle), a fixed-height
  // canvas lays out again with one more value row on that side. It is kept only when it seats more of these values and the
  // canvas still meets the chart's size floor.
  // An automatic height grows the canvas for a hidden value instead (sizing.ts), and keeps the names it grew for.
  const fixedHeight = ((options as TargetSizeOptions)[TARGET_SIZE] ?? resolveTargetSize(options.target ?? DEFAULT_TARGET, options.size)).fixed.height;
  const stranded = solved.stranded ?? [];
  if (fixedHeight && stranded.length > 0 && !(LIFT_ROW in options)) {
    const row = labelH + 4;
    const above = stranded.some(request => request.candidates[1]?.slot === 'aboveCapShifted');
    const below = stranded.some(request => request.candidates[1]?.slot !== 'aboveCapShifted');
    const lifted = layoutVariance(data, { ...options, [LIFT_ROW]: { above: above ? row : 0, below: below ? row : 0 } } as VarianceOptions);
    const ids = new Set(stranded.map(request => request.id));
    const nowSeated = lifted.labels.filter(label => ids.has(label.id) && label.hidden === undefined).length;
    // The row must not raise the chart's size floor past the canvas: a chart that draws keeps drawing.
    const fits = (lifted.frame.plotMinHeight ?? 0) <= size.height
      && (lifted.sizing === undefined || (lifted.sizing.minWidth <= size.width && lifted.sizing.minHeight <= size.height));
    if (nowSeated > 0 && fits) return lifted;
  }
  // A running period keeps a cue: a to-date value without a seat brings the hatch key back.
  // Words wider than twice the drawn band (a small bandFraction) would float over their mark: the key names the period.
  if (toDateIds.size > 0 && (!toDateFits(toDate, theme, measure, toDateRoom(band.bandwidth))
    || solved.placed.some((l) => l.kind === 'point' && l.hidden !== undefined && toDateIds.has(l.owner.categoryId ?? '')))) {
    return layoutVariance(data, { ...options, [PARTIAL_KEY]: true } as VarianceOptions);
  }
  applyValueAxisTitleInk(solved.placed);
  for (const l of solved.placed) { const ink = pinInk.get(l.id); if (ink) l.ink = ink; }
  pushAll(warnings, solved.warnings);

  // ---- annotations: {categoryId} → variance bar top, value = Δ (or Δ%) ----
  const catIndex = new Map(cats.map((c, i) => [c.id, i] as const));
  const resolveAnchor = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    const ci = catIndex.get(norm.categoryId);
    if (ci === undefined) return null;
    const c = cats[ci]!;
    const value = deltaOf(ci);
    const top = anchorTopY[ci] ?? null;
    if (value === null || top === null) return null;
    return {
      x: band.center(ci),
      y: norm.edge === 'start' ? y0 : top,
      value,
      date: c.date, label: c.label,
      owner: { categoryId: c.id },
    };
  };
  const plottedValues = (mode === 'integrated' ? acArr : cats.map((_, ci) => deltaOf(ci))).filter((v): v is number => v !== null);
  const meanValue =
    plottedValues.length > 0
      ? plottedValues.reduce((a, b) => a + b, 0) / plottedValues.length
      : undefined;
  // An absolute chart plots differences of percent levels: those are points, not percent.
  const valueLinePercentLevels = (!percentDifferences && options.unit === '%') || mode === 'relative'
    || integratedPercent;
  const annResult = runAnnotatePass({
    annotations: options.annotations ?? [],
    resolve: resolveAnchor,
    defaultSpan:
      cats.length >= 2 ? { from: cats[0]!.id, to: cats[cats.length - 1]!.id } : undefined,
    occupied,
    plot,
    // Annotation labels draw bold (see labelsToNodes below), so the pass measures them bold.
    theme: emphasisLabelTheme(theme),
    plainLabelWeight: theme.type.label.weight,
    measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    valueLinePercentLevels,
    valueLineUnit: percentDifferences ? PERCENTAGE_POINTS : integratedPercent ? '%' : undefined,
    solveCtx,
    yScale: y,
    meanValue,
    partialCategories: partialIds(cats),
  });
  // A wider percent reference keeps its full text and the gap from plotted values.
  // Use the same one-pass gutter reserve as column and line when no clear seat remains.
  if ((valueLinePercentLevels || percentDifferences) && mode !== 'relative' && !(VALUE_LINE_RESERVE in options)) {
    const labels = annResult.labels.map(label => label.kind === 'valueLine' && !label.hidden
      && solved.placed.some(other => !other.hidden && boxGap(label.rect, other.rect) < SERIES_VALUE_GAP)
      ? { ...label, hidden: 'collision' as const } : label);
    const references = labels.filter(label => label.kind === 'valueLine');
    // Distant references can wrap in the gutter without taking the columns' label space.
    const separate = integratedPercent && references.every((label, i) => references.every((other, j) => i === j
      || Math.abs(label.rect.y - other.rect.y) >= 2 * Math.max(label.rect.h, other.rect.h) + SERIES_VALUE_GAP));
    const reserve = separate && references.some(label => label.hidden === 'collision')
      ? maxOf(references.map(label => hiddenValueLineReserve([{ ...label, hidden: 'collision' }], text => measure(text, strongFont).width, size.width)))
      : hiddenValueLineReserve(labels, text => measure(text, strongFont).width, size.width);
    if (reserve > 0) return layoutVariance(data, { ...options, [VALUE_LINE_RESERVE]: reserve } as VarianceOptions);
  }
  pushAll(warnings, annResult.warnings);

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  pushAll(nodes, annResult.nodes);
  pushAll(nodes, labelsToNodes(theme, allLabels, (l) =>
      l.kind === 'total' || (l.kind === 'point' && mode === 'relative')
        ? strongFont
        : l.kind === 'category'
          ? catFont
          : l.kind === 'annotation' || l.kind === 'valueLine'
            ? { ...labelFont, weight: emphasisWeight(theme) }
            : labelFont,
    ));

  axes.unshift({
    axis: 'x',
    baselineNodeId: baselineId,
    ticks: cats.map((c, i) => ({
      at: c.id,
      pos: band.center(i),
      labelId: catLabelsShown ? `category:${c.id}` : undefined,
    })),
  });

  const modeName =
    mode === 'absolute' ? chartString(options, 'absoluteVariance') : mode === 'relative' ? chartString(options, 'relativeVariance') : chartString(options, 'integratedVariance');
  const deltaText = (ci: number): string => {
    const d = deltaOf(ci);
    if (d === null) return 'n/a';
    return mode === 'relative' ? pctSigned(d, ci) : absolute(d, ci, true);
  };
  const a11yDesc =
    chartString(options, 'varianceDesc', { v1: tierName, v2: modeName, v3: refSeries.label, v4: cats.length }) +
    `${direction === 'lowerIsBetter' ? chartString(options, 'lowerBetterClause') : ''}. ` +
    cats.map((c, ci) => `${c.label ?? c.id} ${deltaText(ci)}`).join(', ') +
    '.';

  // The narrowest plot in which the printed values still read (waterfall/bandFloor.ts).
  const sizing = bandFloorSizing('variance', size, plot, allLabels, [...marks.bars, ...marks.pins].map((mark) => ({
    bar: mark.rect, labelIds: [`total:${mark.categoryId}`, `point:${mark.categoryId}`],
  })), options);
  // The to-date words never raise the floor: below it the hatch key names the period.
  if (toDateIds.size > 0 && (sizing.minWidth > size.width || sizing.minHeight > size.height)) {
    return layoutVariance(data, { ...options, [PARTIAL_KEY]: true } as VarianceOptions);
  }
  return {
    type: 'variance',
    size,
    sizing,
    plot,
    ...(floorTakesLabels ? { [PLOT_FLOOR_RECT]: frameResult.plot } : {}),
    scene: nodes,
    labels: allLabels,
    axes,
    annotations: annResult.placed,
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: {
      ...derived,
      ...(showCatTickRow
        ? {
            tickBand: {
              reserved: catBandH,
              measuredLines: catTickMaxLines,
              lineHeight: catFont.size * 1.2,
              extra: catPlan.rowHeight - catTickMaxLines * catFont.size * 1.2,
              dateNumeric: dateNumericTicks,
              position: 'below' as const,
            },
          }
        : {}),
    },
    a11y: {
      title: accessibleTitle(options.title, `${tierName}: ${modeName} vs ${refSeries.label}`),
      counts: [structureCount('categories', cats.length, undefined, options)],
      desc: a11yDesc,
    },
    ...(paintWarningRules.length ? { paintWarningRules } : {}),
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annResult.decisions],
    },
  };

  // ---- candidate generators ----

  /** Absolute Δ bars: forced-sign label outside the bar end, mirrored below
   *  for negatives; shifted, then inside the bar end as last resort. */
  function deltaBarCandidates(
    rect: Rect,
    tsize: { width: number; height: number },
    negative: boolean,
    insideFill: string,
  ): SlotCandidate[] {
    const cx = rect.x + rect.w / 2;
    const yTop = rect.y;
    const yBot = rect.y + rect.h;
    const w = tsize.width;
    const h = tsize.height;
    if (!negative) {
      return [
        { slot: 'outsideTop', rect: { x: cx - w / 2, y: yTop - h - 4, w, h }, penalty: 0 },
        {
          slot: 'outsideTopShifted',
          rect: { x: cx - w / 2, y: yTop - 2 * h - 8, w, h },
          penalty: 1,
        },
        { slot: 'insideEnd', rect: { x: cx - w / 2, y: yTop + 2, w, h }, penalty: 2, insideFill },
      ];
    }
    return [
      { slot: 'outsideBottom', rect: { x: cx - w / 2, y: yBot + 4, w, h }, penalty: 0 },
      {
        slot: 'outsideBottomShifted',
        rect: { x: cx - w / 2, y: yBot + h + 8, w, h },
        penalty: 1,
      },
      { slot: 'insideEnd', rect: { x: cx - w / 2, y: yBot - h - 2, w, h }, penalty: 2, insideFill },
    ];
  }
}

/**
 * Solve the labels, then keep a larger variance from losing its value to a
 * smaller one. The chart holds k values (the values the solve drew). A value
 * among the k largest that found no seat is offered its seats clear of the
 * neighbouring columns and values (`lift`), against everything already placed.
 * Only those few values solve again; the drawn labels do not move.
 */
function solveVarianceLabels(requests: LabelRequest[], occupied: OccupiedIndex, ctx: SolveCtx, lift: (request: LabelRequest) => SlotCandidate[]): SolveResult & { stranded: LabelRequest[] } {
  const solved = solveLabels(requests, occupied, ctx);
  const points = solved.placed.filter(label => label.kind === 'point');
  const shown = points.filter(label => label.hidden === undefined).length;
  const crowded = new Set(points.filter(label => label.hidden === 'collision').map(label => label.id));
  if (crowded.size === 0) return { ...solved, stranded: [] };
  const ranked = requests.filter(request => request.kind === 'point' && !request.redundant)
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rescue = ranked.slice(0, shown).filter(request => crowded.has(request.id)).flatMap(request => {
    const seats = lift(request);
    return seats.length > 0 ? [{ ...request, candidates: [...request.candidates, ...seats] }] : [];
  });
  if (rescue.length === 0) return { ...solved, stranded: [] };
  const repair = solveLabels(rescue, occupied, ctx);
  const seated = new Map(repair.placed.filter(label => label.hidden === undefined).map(label => [label.id, label]));
  const stranded = rescue.filter(request => !seated.has(request.id));
  if (seated.size === 0) return { ...solved, stranded };
  const decided = new Map(repair.decisions.map(decision => [decision.labelId, decision]));
  return {
    ...solved,
    stranded,
    placed: solved.placed.map(label => seated.get(label.id) ?? label),
    decisions: solved.decisions.map(decision => seated.has(decision.labelId) ? decided.get(decision.labelId) ?? decision : decision),
    warnings: solved.warnings.filter(warning => warning.code !== 'label-hidden' || ![...seated.keys()].some(id => warning.message.startsWith(`label '${id}' `))),
  };
}
