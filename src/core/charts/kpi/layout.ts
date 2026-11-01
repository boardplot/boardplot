import { chartString } from '../../strings/kpi';
import { chipPaints } from '../table/chips';
import { eyebrowFont, figureRole } from '../cardRoles';
import { structureCount } from '../../structureCounts';
/**
 * KPI card. Composite card: muted label, big formatted value,
 * library-computed delta pill (never trusted from the caller), and a
 * shape-only sparkline across the card bottom.
 *
 * Scene part vocabulary: 'spark' (line/area/column), 'sparkDot' (final
 * point on line/area) + last-value label via the solver.
 */

import { fitText, lineBox } from '../../label/fitText';
import { fittedLabel, stepDownFont } from '../../label/rowFit';
import type { Rect } from '../../geometry';
import { formatAutomaticPercent, MINUS, valueSetFormatter } from '../../format';
import { differenceExample, formatNonzeroWithSpec, localized, parseFormatExample, sameScale, specUnitKind } from '../../formatSpec';
import { frameTextOptions, solveFrame, textCarriesUnit, unitPrinted } from '../../frame';
import { withUnit } from '../../unitJoin';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SlotCandidate, type SolveCtx } from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  normalizeScenario,
  resolveSize,
  resolveSubtitle,
} from '../../normalize/shared';
import { arrowHeadPath } from '../../svgPath';
import { chartSizing, resolveSizing } from '../../sizing';
import { rowDrivenHeight } from '../../rowCanvas';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import {
  resolveSemanticPaletteTheme,
  resolveSurface,
  panelTypeClass,
  resolveTheme,
  emphasisWeight,
} from '../../theme';
import { cellMeta, type Id } from '../../types/cell';
import type { KpiData } from '../../types/data';
import { cardSize, emitKpiSpark, kpiSparkPeriodRowHeight, kpiSparkSeries, lastObservedIndex, lastObservedLabel, lastObservedPriority } from '../sparkline/layout';
import { bandFor } from '../../bandSelect';
import { sparkLabelsRefusal } from './sparkLabels';
import type { KpiOptions, LabelKind } from '../../types/options';
import type { Geometry, LintWarning, PlacedLabel, SceneNode } from '../../types/scene';
import { KPI_HOST_TEXT, KPI_VALUE_SIZE, readerFloorPx, textScaleOf } from '../../typeFloors';
import { DEFAULT_TARGET, kpiHeroSizesPx, scaleTextPx, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { composedTextRole } from '../../textRole';
import { planSteering, type SteeringPlan } from './steering';
import { maxOf, pushAll } from '../../arrays';

export interface KpiMarks {
  /** Scene node of the big value (label-emitted text node). */
  valueNodeId: Id;
  deltaNodeId?: Id;
  comparisonNodeIds?: Id[];
  attainmentNodeId?: Id;
  sparkNodeId?: Id;
}

interface KpiComparisonDerived {
  source: 'delta' | 'compare';
  value: number;
  vs: number;
  label: string;
  mode: 'absolute' | 'relative' | 'both';
  deltaAbs: number;
  deltaPct: number | null;
  tone: 'good' | 'bad' | 'neutral';
  state: 'value' | 'ref-nonpositive' | 'sign-change';
  displayed: string;
  nodeId?: Id;
}

type ChangeMode = 'absolute' | 'relative' | 'both';

/**
 * The mode one change prints in. A relative change needs a positive
 * reference and a value on the same side of zero: off zero or a negative
 * reference, or across a sign change, it is no measure of the gap (-42.5
 * against +18.2 read "-333.5%"), so the absolute change stands in with a
 * warning, whatever the mode. Unset, a percent measure compares in points
 * only: two percents on one line ("-2.4% (-2.4pp)") leave the reader to
 * pick one, and a relative change of a rate ("+22.6%" for 3.1% to 3.8%)
 * hides the points that move.
 */
function changeMode(
  value: number,
  vs: number,
  authored: ChangeMode | undefined,
  fallback: ChangeMode,
  percentMeasure: boolean,
): { mode: ChangeMode; refused?: 'ref-nonpositive' | 'sign-change' } {
  const wanted = authored ?? (percentMeasure ? 'absolute' : fallback);
  if (wanted === 'absolute') return { mode: wanted };
  if (vs <= 0) return { mode: 'absolute', refused: 'ref-nonpositive' };
  if (value < 0) return { mode: 'absolute', refused: 'sign-change' };
  return { mode: wanted };
}

interface KpiAttainmentDerived {
  value: number;
  vs: number;
  label: string;
  pct: number | null;
  tone: 'good' | 'bad' | 'warn' | 'neutral';
  state: 'value' | 'ref-nonpositive';
  displayed: string;
  nodeId?: Id;
}

export interface KpiDerived {
  deltaAbs?: number;
  deltaPct?: number;
  tone?: 'good' | 'bad' | 'neutral';
  comparisons?: KpiComparisonDerived[];
  attainment?: KpiAttainmentDerived;
  /** The band that holds the main value (`bands`): its tone colours the main value only. */
  band?: { tone: 'good' | 'warn' | 'bad' | 'neutral'; label?: string };
}

/**
 * Card-bottom share reserved for the sparkline (~30% of card height). The
 * compact card gives it a fifth instead: at 120 px the difference between a
 * third and a fifth is the note and the chip row, and a trend
 * shape reads at 24 px.
 */
const SPARK_SHARE = { regular: 0.3, compact: 0.2 } as const;
/** The height a trend shape reads at, under any period names. */
const SPARK_MIN_TREND = 24;
/**
 * The two card widths. A dashboard that puts nine cards in a row
 * asks for the compact one: 280 instead of 360 wide, with the same content —
 * the value, its note, one row of compare chips and the spark under them.
 * The heights are the first pass only: an unsized card then takes the height
 * of its content.
 */
const KPI_SIZE = { regular: { width: 360, height: 144 }, compact: { width: 280, height: 120 } } as const;
/** Air between the value and the authored note under it. */
const NOTE_GAP = 2;
/** Default solver clearance for the card label and value. */
const KPI_LABEL_PAD = 2;
/** Gap between the delta caret triangle and the delta text. */
const CARET_GAP = 4;
/** Shared table-system chip anatomy. */
const CHIP_PAD_X = 8;
const CHIP_H = 18;
const CHIP_GAP = 6;
const CHIP_ROW_GAP = 4;
/** Text-to-edge air of a chip: 3.5 px is what a 9 px chip has in 18. */
const CHIP_PAD_Y = 3.5;
/**
 * How a row of comparisons is spaced. A chip has its pad inside the
 * fill and the gap between fills; a text comparison has no fill, so it keeps
 * the distance between two chips' texts as its gap and the row reads with the
 * same rhythm. `h` absent means the measured line of the text.
 */
interface RowAnatomy { padX: number; gap: number; h?: number }
const CHIP_ANATOMY: RowAnatomy = { padX: CHIP_PAD_X, gap: CHIP_GAP, h: CHIP_H };
const TEXT_ANATOMY: RowAnatomy = { padX: 0, gap: 2 * CHIP_PAD_X + CHIP_GAP };
/**
 * Clear space between the big value and the row under it. The value's line
 * box ends where the delta or chip row begins; without the gap, a face with a
 * deep descent (1.3 em ascent plus descent) draws its glyphs into the pill.
 */
const VALUE_ROW_GAP = 4;
/** In a slot of fixed height: the figure size as a share of the canvas height, and the delta size as a share of the figure. */
const SLOT_FIGURE_SHARE = 0.25;
const SLOT_DELTA_SHARE = 0.3;

interface ComparisonVisual {
  id: Id;
  text: string;
  body: string;
  label: string;
  caretDir?: 'up' | 'down';
  derived: KpiComparisonDerived;
}

export function layoutKpi(authored: KpiData, options: KpiOptions = {}): Geometry<KpiMarks, KpiDerived> {
  // An empty optional list reads as an absent one (the schema says the same).
  const data: KpiData = authored?.compare?.length === 0 ? { ...authored, compare: undefined } : authored;
  // What the schema refuses, refused here for the React entry.
  const warnings: LintWarning[] = sparkLabelsRefusal(data.spark);
  // Card exemption: kpi is a card, not a canvas — no
  // themeForWidth here; a 260-wide card keeps the canonical column.
  const theme = resolveSemanticPaletteTheme(resolveTheme(options.theme), options.palette, warnings);
  const compact = options.density === 'compact';
  const carets = theme.marks?.kpiCaret !== false;
  const sparkShare = SPARK_SHARE[compact ? 'compact' : 'regular'];
  // The trend keeps its 24 px under the period names: the names took their
  // row out of the floor and left a compact card's line 2 px to move in.
  const sparkFloor = SPARK_MIN_TREND + ((data.spark?.labels?.length ?? 0) > 0 ? kpiSparkPeriodRowHeight(theme) : 0);
  const requestedSize = resolveSize(cardSize(options, KPI_SIZE[compact ? 'compact' : 'regular']));
  const target = options.target ?? DEFAULT_TARGET;
  const size = panelTypeClass(options) === undefined
    ? { ...requestedSize, width: Math.min(requestedSize.width, 420) } : requestedSize;
  const measure = options.measure ?? defaultMeasurer;

  // ---- normalize ----
  if (!data || typeof data.label !== 'string' || data.label.length === 0) {
    throw new NormalizeError('missing-label', 'label', 'kpi requires a label');
  }
  if (typeof data.value !== 'number' || !Number.isFinite(data.value)) {
    throw new NormalizeError('invalid-number', 'value', 'kpi requires a finite numeric value');
  }
  if (data.delta && data.compare) {
    throw new NormalizeError('conflicting-options', 'compare', 'kpi accepts either delta or compare, not both');
  }
  if (data.compare && (data.compare.length < 1 || data.compare.length > 2)) {
    throw new NormalizeError('invalid-count', 'compare', 'kpi compare requires one or two entries');
  }
  const value = data.value;
  const valueBand = data.bands?.length ? bandFor(value, data.bands) : undefined;
  const deltaScenario = normalizeScenario(data.delta?.scenario, 'delta.scenario', 'compare[].label');

  // The card's one figure never prints a nonzero value as 0: an
  // authored example keeps its style and lifts its decimals for as long as
  // the value would read 0; without one, the value and the reference it is
  // measured against share one precision (valueSetDecimals), lifted the same
  // way, so 0.042 against 0.04 reads "0.04 vs 0.04" and never "0.0 vs 0.0".
  // Only a printed number joins that set: a scenario names the reference
  // ("vs PY") and compare prints its label, so neither reference may lift
  // the hero from "6" to "6.0". The changes take their precision from the
  // changes themselves (1.4 prints "+1.4" beside a hero of 100).
  const example = data.format ?? options.format;
  const spec = example ? localized(parseFormatExample(example), options.locale?.language) : undefined;
  const referencePrinted = data.delta !== undefined && deltaScenario === undefined && typeof data.delta.vs === 'number';
  const printed = [value, ...(referencePrinted ? [data.delta!.vs as number] : [])];
  const changes = data.delta
    ? [value - Number(data.delta.vs)]
    : (data.compare ?? []).map((comparison) => value - Number(comparison.vs));
  const fmt = spec
    ? (v: number) => formatNonzeroWithSpec(v, spec)
    : valueSetFormatter(printed, options.locale?.language, false, options.unit, options.target);
  const percentMeasure = spec !== undefined && specUnitKind(spec) === 'percent';
  // The absolute change of a percent measure is in percentage points.
  const diffSpec = example ? localized(parseFormatExample(differenceExample(example)), options.locale?.language) : undefined;
  const fmtDiff = diffSpec
    ? (v: number) => formatNonzeroWithSpec(v, diffSpec)
    : valueSetFormatter(changes, options.locale?.language, false, options.unit, options.target);
  const fmtSigned = diffSpec
    ? (v: number) => formatNonzeroWithSpec(v, { ...diffSpec, signed: true })
    : valueSetFormatter(changes, options.locale?.language, true, options.unit, options.target);
  const fmtPct = (p: number, signed: boolean) => {
    const r1 = Math.round(p * 10) / 10;
    return formatAutomaticPercent(p, Number.isInteger(r1) ? 0 : 1, signed, options.locale?.language);
  };

  // ---- derive: the delta is computed by the LIBRARY, never trusted ----
  const derived: KpiDerived = {};
  if (valueBand) derived.band = { tone: valueBand.tone ?? 'neutral', ...(valueBand.label ? { label: valueBand.label } : {}) };
  const comparisonVisuals: ComparisonVisual[] = [];
  let deltaText: string | undefined;
  /** The signed figure before " vs …": the delta breaks there when it wraps. */
  let deltaBody: string | undefined;
  /** Direction of the SVG caret left of the delta text — no glyph in text. */
  let caretDir: 'up' | 'down' | undefined;
  let a11yDelta = '';
  if (data.delta) {
    const vs = data.delta.vs;
    if (typeof vs !== 'number' || !Number.isFinite(vs)) {
      throw new NormalizeError('invalid-number', 'delta.vs', 'delta.vs must be a finite number');
    }
    const direction = data.delta.direction ?? 'higherIsBetter';
    const { mode, refused } = changeMode(value, vs, data.delta.mode, 'relative', percentMeasure);
    const deltaAbs = value - vs;
    derived.deltaAbs = deltaAbs;
    if (refused) {
      warnings.push({
        code: refused,
        severity: 'warn',
        message: refused === 'sign-change'
          ? 'value and delta.vs have opposite signs — relative delta suppressed, absolute shown'
          : `delta.vs is ${vs === 0 ? '0' : 'negative'} — relative delta suppressed, absolute shown`,
        suggest: "mode: 'absolute'",
      });
    }
    if (vs > 0 && value >= 0) derived.deltaPct = (deltaAbs / vs) * 100;
    derived.tone =
      deltaAbs === 0 || direction === 'neutral'
        ? 'neutral'
        : (deltaAbs > 0) === (direction === 'higherIsBetter')
          ? 'good'
          : 'bad';

    // A theme may drop the leading caret: the signed figure and its
    // tone already say the direction.
    caretDir = !carets || deltaAbs === 0 ? undefined : deltaAbs > 0 ? 'up' : 'down';
    const pct = derived.deltaPct;
    const body =
      mode === 'relative'
        ? fmtPct(pct!, true)
        : mode === 'both'
          ? `${fmtPct(pct!, true)} (${fmtSigned(deltaAbs)})`
          : fmtSigned(deltaAbs);
    // A delta always names what it is measured against: the scenario, or
    // else the reference value itself.
    const suffix = ` vs ${deltaScenario ?? fmt(vs)}`;
    deltaText = `${body}${suffix}`;
    deltaBody = body;

    const word = chartString(options, deltaAbs > 0 ? 'up' : deltaAbs < 0 ? 'down' : 'unchanged');
    const magnitude =
      mode === 'relative'
        ? fmtPct(Math.abs(pct!), false)
        : mode === 'both'
          ? `${fmtPct(Math.abs(pct!), false)} (${fmtDiff(Math.abs(deltaAbs))})`
          : fmtDiff(Math.abs(deltaAbs));
    a11yDelta = deltaAbs === 0 ? `, ${word}${suffix}` : `, ${word} ${magnitude}${suffix}`;

    derived.comparisons = [{
      source: 'delta',
      value,
      vs,
      label: suffix.trim(),
      mode,
      deltaAbs,
      deltaPct: derived.deltaPct ?? null,
      tone: derived.tone,
      state: refused ?? 'value',
      displayed: deltaText,
    }];
    if (direction === 'lowerIsBetter') deltaText += chartString(options, 'lowerBetterHint');
  }

  if (data.compare) {
    derived.comparisons = data.compare.map((comparison, index) => {
      if (typeof comparison.vs !== 'number' || !Number.isFinite(comparison.vs)) {
        throw new NormalizeError('invalid-number', `compare[${index}].vs`, 'comparison reference must be finite');
      }
      if (typeof comparison.label !== 'string' || comparison.label.trim().length === 0) {
        throw new NormalizeError('missing-label', `compare[${index}].label`, 'comparison label must be nonblank');
      }
      const label = comparison.label.trim();
      const { mode, refused } = changeMode(value, comparison.vs, comparison.mode, 'both', percentMeasure);
      const deltaAbs = value - comparison.vs;
      const deltaPct = comparison.vs > 0 && value >= 0 ? (deltaAbs / comparison.vs) * 100 : null;
      const direction = comparison.direction ?? 'higherIsBetter';
      const tone = deltaAbs === 0 || direction === 'neutral'
        ? 'neutral'
        : (deltaAbs > 0) === (direction === 'higherIsBetter')
          ? 'good'
          : 'bad';

      if (refused) {
        warnings.push({
          code: refused,
          severity: 'warn',
          message: refused === 'sign-change'
            ? `value and compare[${index}].vs have opposite signs — relative delta suppressed, absolute shown`
            : `compare[${index}].vs is nonpositive — relative delta suppressed, absolute shown`,
          owner: { seriesId: `compare-${index}` },
        });
      }

      const body = mode === 'relative'
        ? fmtPct(deltaPct!, true)
        : mode === 'both'
          ? `${fmtPct(deltaPct!, true)} (${fmtSigned(deltaAbs)})`
          : fmtSigned(deltaAbs);
      // The first comparison of a lower-is-better measure says so.
      const firstLower = direction === 'lowerIsBetter'
        && data.compare!.findIndex((entry) => entry.direction === 'lowerIsBetter') === index;
      const displayed = `${body} ${label}`;
      const record: KpiComparisonDerived = {
        source: 'compare',
        value,
        vs: comparison.vs,
        label,
        mode,
        deltaAbs,
        deltaPct,
        tone,
        state: refused ?? 'value',
        displayed,
      };
      comparisonVisuals.push({
        id: `compare-${index}`,
        text: `${displayed}${firstLower ? chartString(options, 'lowerBetterHint') : ''}`,
        body,
        label,
        caretDir: !carets || deltaAbs === 0 ? undefined : deltaAbs > 0 ? 'up' : 'down',
        derived: record,
      });
      return record;
    });

    const first = derived.comparisons[0]!;
    derived.deltaAbs = first.deltaAbs;
    if (first.deltaPct !== null) derived.deltaPct = first.deltaPct;
    derived.tone = first.tone;
    a11yDelta = derived.comparisons.map((comparison) => `, ${comparison.displayed}`).join('');
  }

  if (data.attainment) {
    const attainment = data.attainment;
    if (typeof attainment.vs !== 'number' || !Number.isFinite(attainment.vs)) {
      throw new NormalizeError('invalid-number', 'attainment.vs', 'attainment reference must be finite');
    }
    if (typeof attainment.label !== 'string' || attainment.label.trim().length === 0) {
      throw new NormalizeError('missing-label', 'attainment.label', 'attainment label must be nonblank');
    }
    const label = attainment.label.trim();
    const suppressed = attainment.vs <= 0;
    const pct = suppressed ? null : (value / attainment.vs) * 100;
    if (suppressed) {
      warnings.push({
        code: 'ref-nonpositive',
        severity: 'warn',
        message: 'attainment.vs is nonpositive — attainment is not meaningful',
        owner: { seriesId: 'attainment' },
      });
    }
    derived.attainment = {
      value,
      vs: attainment.vs,
      label,
      pct,
      // Omitted, the tone is that of the comparison against the same reference:
      // the attainment states the same shortfall or lead.
      tone: attainment.tone ?? (suppressed ? undefined : derived.comparisons?.find((comparison) => comparison.vs === attainment.vs)?.tone) ?? 'neutral',
      state: suppressed ? 'ref-nonpositive' : 'value',
      displayed: `${suppressed ? 'n.m.' : pct! > 999 ? '>999%' : pct! < -999 ? `<${MINUS}999%` : fmtPct(pct!, false)} ${label}`,
    };
  }

  // ---- frame (compact 12px default margins; if options.title is set the
  // card label moves into the subtitle position) ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  // Kpi is a CARD (aspect class 'card'), exempt from the width classes that
  // key the canvasMargin token: a 260px tile under 28px side margins would
  // spend 21% of its width on air.
  const margin = { top: 12, right: 12, bottom: 12, left: 12, ...options.margin };
  const subtitle = options.title
    ? (resolveSubtitle(options.subtitle) ?? { measure: data.label })
    : resolveSubtitle(options.subtitle);
  const frameTheme = options.title && subtitle?.measure === data.label
    ? { ...theme, type: { ...theme.type, subtitle: { ...theme.type.subtitle, size: Math.max(scaleTextPx(13, textScaleOf(options)), theme.type.subtitle.size) } } }
    : theme;
  const frameResult = solveFrame(
    {
      size,
      margin,
      // Cards keep compact gaps at every width; see FrameInput.cardGaps.
      cardGaps: true,
      ...frameTextOptions(options),
      subtitle,
      theme: frameTheme,
      measure,
    },
    occupied,
  );
  const plot = frameResult.plot;
  const nodes: SceneNode[] = [...frameResult.nodes];

  // ---- label-kind gates ----
  const kindOn = (kind: LabelKind): boolean => {
    const l = options.labels;
    // labels: false takes the comparisons off; the main number and the card name stay.
    if (l === false) return kind === 'total' || kind === 'category';
    const v = l?.[kind];
    return v === undefined ? true : v !== false;
  };

  // ---- marks: sparkline reserves the card bottom and claims occupied ----
  const requests: LabelRequest[] = [];
  const sparkSeries = kpiSparkSeries(data.spark);
  const sparkVals = sparkSeries.values;
  warnings.push(...sparkScaleRefusal(value, sparkVals));
  const sparkDrawable = data.spark !== undefined && sparkVals.some((v) => v !== null);
  let sparkRect: Rect | undefined;
  let sparkNodeId: Id | undefined;
  if (sparkDrawable) {
    const sparkH = sparkHeight(size.height, plot.h, sparkShare, sparkFloor);
    sparkRect = { x: plot.x, y: plot.y + plot.h - sparkH, w: plot.w, h: sparkH };
    // labels=false and labels.point=false also gate the spark endpoint. The
    // gate wins over an authored cell label, and a suppressed label reserves no
    // endpoint column, so the marks keep the full plot width. The last observed
    // cell also carries its authored priority: it decides whether 'minimal'
    // density keeps the endpoint, so it cannot be flattened to the endpoint band.
    const endpointLabel = kindOn('point') ? lastObservedLabel(sparkSeries.cells) : false;
    const endpointPriority = kindOn('point') ? lastObservedPriority(sparkSeries.cells) : undefined;
    // The last observed cell may carry its own format example ('1,234'), which
    // overrides the card format for the endpoint label only.
    const endpointIndex = lastObservedIndex(sparkVals);
    const endpointFormat = endpointIndex === undefined ? undefined : cellMeta(sparkSeries.cells[endpointIndex]!)?.format;
    sparkNodeId = emitKpiSpark(nodes, sparkRect, data.spark!.kind, sparkVals, theme, options.palette, fmt, measure, requests, endpointLabel, endpointPriority, endpointFormat,
      { heroText: fmt(value), locale: options.locale?.language, ...(data.spark!.labels ? { periods: data.spark!.labels } : {}) });
    occupied.claim(sparkRect, 'mark', { seriesId: 'spark' });
  }
  const contentBottom = sparkRect ? sparkRect.y - 4 : plot.y + plot.h;

  // ---- label requests ----
  const textScale = textScaleOf(options);
  const labelFont: FontSpec = eyebrowFont(theme, textScale);
  let deltaFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  // The chip rides the footnote step (9 at the canonical width the card keeps).
  // A chip carries a value, so it keeps the label floor.
  const chipSize = Math.max(theme.type.footnote.size, readerFloorPx(target, 'label', textScale));
  const chipFont: FontSpec = { family: theme.type.family, size: chipSize, weight: theme.type.label.weight, lineHeight: 1.2 };
  // The chip grows with its text.
  const chipH = Math.max(CHIP_H, Math.ceil(measure('0', chipFont).height + 2 * CHIP_PAD_Y));
  // text comparisons, the attainment among them, are drawn the way
  // the delta is, in its font before any shrink (a card carries delta or
  // compare, never both).
  const textComparisons = options.comparisons === 'text';
  const compareFont = textComparisons ? deltaFont : chipFont;
  const compareAnatomy = textComparisons ? TEXT_ANATOMY : { ...CHIP_ANATOMY, h: chipH };
  // The KPI figure role; absent, the value keeps type.family at 700.
  const figure = figureRole(theme);
  const surface = resolveSurface(theme);
  const chipInk = (tone: 'good' | 'bad' | 'warn') => chipPaints(theme, tone).ink;

  // card label (top-left, muted) — replaced by the subtitle when title is set
  let valueY = plot.y;
  if (!options.title && kindOn('category')) {
    // Wrap to two lines, one type step down, then cut with a <title>.
    const eyebrow = data.label;
    const fitted = fitText(eyebrow, labelFont, plot.w, 2, measure, { shrink: stepDownFont(theme, labelFont, 'label', target, textScale), target, textScale, typeRole: 'label' });
    const lsize = { width: fitted.w, height: measure(fitted.lines[0] ?? '', fitted.font).height + (fitted.lines.length - 1) * lineBox(fitted.font) };
    requests.push({
      id: 'category:label',
      kind: 'category',
      owner: { categoryId: 'kpi' },
      text: eyebrow,
      ...fittedLabel(fitted, labelFont),
      font: labelFont,
      priority: PRIORITY.total,
      candidates: [
        { slot: 'topLeft', rect: { x: plot.x, y: plot.y, w: lsize.width, h: lsize.height }, penalty: 0 },
      ],
    });
    valueY = plot.y + lsize.height + 2;
  }

  const showComparisonChips = comparisonVisuals.length > 0 && kindOn('point');
  const showAttainmentChip = derived.attainment !== undefined && kindOn('point');
  // The caret scales with the delta font; a fixed slot that grows the delta
  // sizes it again (fillSlot below).
  const naturalDeltaSize = deltaFont.size;
  const caretOf = (font: FontSpec) => {
    const size = font.size * 0.35;
    const w = 2 * size * Math.sin(0.15 * Math.PI); // triangle base width
    const gap = CARET_GAP * Math.max(1, font.size / naturalDeltaSize);
    return { size, w, h: size * Math.cos(0.15 * Math.PI) /* tip-to-base height */, pad: caretDir !== undefined ? w + gap : 0 };
  };
  let { size: caretSize, w: caretW, h: caretH, pad: caretPad } = caretOf(deltaFont);
  const showDelta = deltaText !== undefined && kindOn('point');
  const compareCaretSize = compareFont.size * 0.35;
  const compareCaretW = 2 * compareCaretSize * Math.sin(0.15 * Math.PI);
  const compareCaretH = compareCaretSize * Math.cos(0.15 * Math.PI);
  // Chips keep their whole text. A row that does not fit stacks, and a
  // chip wider than the card wraps inside a taller chip. Text comparisons and
  // a text attainment follow the same plan without the fill.
  const comparisonItems = showComparisonChips ? comparisonVisuals.map((visual) => ({
    text: visual.text, caretPad: visual.caretDir ? compareCaretW + CARET_GAP : 0,
  })) : [];
  const packed = planChips([...comparisonItems, ...(showAttainmentChip ? [{ text: derived.attainment!.displayed, caretPad: 0 }] : [])], compareFont, plot.w, measure, compareAnatomy);
  const packAttainment = showComparisonChips && showAttainmentChip && packed.naturalWidth <= plot.w;
  const comparisonBlock = packAttainment ? packed : planChips(comparisonItems, compareFont, plot.w, measure, compareAnatomy);
  const attainmentBlock = packAttainment
    ? { slots: [packed.slots[comparisonItems.length]!], height: 0, naturalWidth: 0 }
    : planChips(showAttainmentChip ? [{ text: derived.attainment!.displayed, caretPad: 0 }] : [], compareFont, plot.w, measure, compareAnatomy);
  const comparisonRowH = comparisonBlock.height;
  const attainmentRowH = attainmentBlock.height;
  const attainmentGap = !packAttainment && showAttainmentChip && (showDelta || showComparisonChips) ? CHIP_ROW_GAP : 0;
  const valueGap = showDelta || showComparisonChips || showAttainmentChip ? VALUE_ROW_GAP : 0;
  // the unit prints beside the value when nothing else on the card or
  // around it prints it: the subtitle, the host (unitShown), the label, the
  // note, the title, the value's own format, or the grid text around a panel.
  const unit = options.unit?.trim();
  // Only text the card draws counts: the frame's title and subtitle, the
  // label when it prints (no title, labels on), the note, the value itself.
  const around = [
    ...frameResult.nodes.flatMap((node) => (node.t === 'text' ? node.lines : [])),
    ...(!options.title && kindOn('category') ? [data.label] : []),
    data.note?.trim(), fmt(value), ...((options as { [KPI_HOST_TEXT]?: string[] })[KPI_HOST_TEXT] ?? []),
  ];
  const unitBeside = unit && !unitPrinted({ subtitle, unit, unitShown: options.unitShown })
    && !around.some((text) => typeof text === 'string' && textCarriesUnit(text, unit)) ? unit : undefined;
  const valueText = withUnit(fmt(value), unitBeside);
  // The hero follows the M title of its target, never under the target's hero minimum.
  const hero = kpiHeroSizesPx(target, theme.type.title.size, textScale);
  const sharedFigure = (options as KpiOptions & { [KPI_VALUE_SIZE]?: number })?.[KPI_VALUE_SIZE];
  let baseSize = sharedFigure ?? hero.preferred;
  const minimumValue = measure(valueText, { family: figure.family, size: hero.minimum, weight: figure.weight, lineHeight: 1.2 });
  const minimumValueH = minimumValue.height;
  // The delta steps down to the label floor and no further.
  const deltaFloor = readerFloorPx(target, 'label', textScale);
  // A delta wider than the card wraps onto two lines at a space, never cut. The
  // floor stays one line: the second line only asks for room (natural height),
  // and a band too short for it keeps one line, which the solver hides with a
  // warning. A delta that needs three lines keeps one, too.
  const deltaSuffix = deltaBody === undefined ? '' : deltaText!.slice(deltaBody.length).trim();
  const wrapDelta = (font: FontSpec, width: number) => !showDelta || measure(deltaText!, font).width <= width ? []
    : measure(deltaBody!, font).width <= width && measure(deltaSuffix, font).width <= width ? [deltaBody!, deltaSuffix]
      : wrapWhole(deltaText!, font, width, measure);
  const deltaWrapped = wrapDelta(deltaFont, Math.max(4, plot.w - caretPad));
  const deltaOneLine = deltaText === undefined ? [] : [deltaText];
  let deltaLines = deltaWrapped.length === 2 ? deltaWrapped : deltaOneLine;
  const deltaBlock = (font: FontSpec, lines = deltaLines) => ({
    w: Math.max(...lines.map((line) => measure(line, font).width)),
    h: measure(lines[0]!, font).height + (lines.length - 1) * lineBox(font),
  });
  const minimumDeltaH = showDelta ? deltaBlock({ ...deltaFont, size: Math.min(deltaFloor, deltaFont.size) }, deltaOneLine).h : 0;
  const comparisonH = valueGap + comparisonRowH + attainmentRowH + attainmentGap;
  // The authored caption under the value: the basis or the scope
  // the number is true of. It is the host's sentence, wrapped and never cut,
  // and the card reserves its box before anything else is fitted.
  let noteFont: FontSpec = { family: theme.type.family, ...theme.type.footnote };
  const noteBlock = (font: FontSpec) => {
    const lines = data.note === undefined ? [] : wrapWhole(data.note.trim(), font, plot.w, measure);
    return { lines, h: lines.length === 0 ? 0 : NOTE_GAP + measure(lines[0]!, font).height + (lines.length - 1) * lineBox(font) };
  };
  let { lines: noteLines, h: noteBlockH } = noteBlock(noteFont);
  // The steering form (steering.ts): a standalone regular card with named
  // comparisons or an attainment, no delta, no spark, and no authored
  // comparisons style. A grid panel (it carries the host text) keeps chips.
  const hostPanel = (options as { [KPI_HOST_TEXT]?: string[] })[KPI_HOST_TEXT] !== undefined;
  const fixedSlot = theme.marks?.kpiSlotFill !== false && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === true && !hostPanel && sharedFigure === undefined
    && !sparkDrawable && comparisonVisuals.length === 0 && data.attainment === undefined;
  let steer: SteeringPlan | undefined = options.comparisons === undefined && !hostPanel && !compact && !sparkDrawable
    && data.delta === undefined && kindOn('point') && (comparisonVisuals.length > 0 || derived.attainment !== undefined)
    ? planSteering({
      plot, top: valueY, titleSize: theme.type.title.size, family: theme.type.family,
      regularWeight: theme.type.label.weight ?? 400, boldWeight: figure.weight,
      figure, heroMinimum: hero.minimum, heroBase: baseSize, labelFloor: deltaFloor,
      footnote: { family: theme.type.family, ...theme.type.footnote },
      ...(kindOn('total') ? { valueText } : {}),
      noteLines, noteFont,
      comparisons: comparisonVisuals.map((visual) => {
        const firstLower = visual.text.length > visual.derived.displayed.length ? visual.text.slice(visual.derived.displayed.length) : '';
        return {
          id: visual.id, body: visual.body, lead: visual.body.split(' (')[0]!, label: `${visual.label}${firstLower}`,
          ...(visual.caretDir ? { caretDir: visual.caretDir } : {}), tone: visual.derived.tone,
        };
      }),
      ...(derived.attainment ? { attainment: {
        pct: derived.attainment.pct, figure: derived.attainment.displayed.slice(0, -derived.attainment.label.length - 1),
        label: derived.attainment.label, tone: derived.attainment.tone,
      } } : {}),
      measure, trackTint: surface.chipTint,
    })
    : undefined;
  const steerChrome = cardChromeHeight(size.height, plot.y, margin.bottom, frameResult.nodes);
  const steerHeight = steer ? Math.ceil(steerChrome + (valueY - plot.y) + steer.contentHeight) : 0;
  if (steer) {
    const grow = rowDrivenHeight({ options, width: size.width, height: size.height, chromeH: 0, rowsH: steerHeight });
    if (grow !== undefined) return layoutKpi(data, { ...options, size: { width: size.width, height: grow } });
    // An authored height under the content keeps the chip card, which fits
    // tighter; a height the host may still grow (the first pass of a sized
    // render) keeps the form and asks for its height through the sizing.
    if (size.height < steerHeight - 0.5 && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height !== false) steer = undefined;
  }
  let minHeight: number;
  let naturalHeight: number;
  let valueFont: FontSpec;
  const fittedComparisons: { visual: ComparisonVisual; rect: Rect; caretPad: number }[] = [];
  let fittedAttainment: { lines: string[]; rect: Rect } | undefined;
  if (steer) {
    minHeight = steerHeight;
    naturalHeight = steerHeight;
    valueFont = steer.valueFont;
    if (steer.valueRect && kindOn('total')) {
      requests.push({
        id: 'total:value', kind: 'total', owner: { categoryId: 'kpi' }, text: valueText, lines: [valueText], font: valueFont,
        typeRole: 'kpiValue', priority: PRIORITY.grandTotal, candidates: [{ slot: 'main', rect: steer.valueRect, penalty: 0 }],
      });
    }
    if (steer.noteRect) {
      requests.push({
        id: 'note:kpi', kind: 'category', role: 'note', typeRole: 'footnote', pad: 0, owner: { categoryId: 'kpi' },
        text: data.note!.trim(), lines: noteLines, font: noteFont, priority: PRIORITY.total,
        candidates: [{ slot: 'belowValue', rect: steer.noteRect, penalty: 0 }],
      });
    }
    pushAll(requests, steer.requests);
    pushAll(nodes, steer.marks);
    for (const mark of steer.marks) {
      if (mark.t === 'rect') occupied.claim(mark.rect, 'mark', mark.owner, mark.part);
    }
  } else {
  const minimumContentH = valueY - plot.y + minimumValueH + noteBlockH + minimumDeltaH + comparisonH + (sparkDrawable ? 4 : 0);
  const chromeHeight = cardChromeHeight(size.height, plot.y, margin.bottom, frameResult.nodes);
  minHeight = minimumCardHeight(chromeHeight, minimumContentH, sparkDrawable, sparkShare, sparkFloor);
  const naturalValueH = fitValueText(valueText, baseSize, hero.minimum, figure, plot.w, Infinity, measure).vsize.height;
  const naturalWith = (lines: string[]) => minimumCardHeight(chromeHeight,
    minimumContentH - minimumValueH - minimumDeltaH + naturalValueH + (showDelta ? deltaBlock(deltaFont, lines).h : 0),
    sparkDrawable, sparkShare, sparkFloor);
  // The second delta line asks for room only where the card can have it: a
  // height the host may still grow, or a given height that already holds it.
  // A grid row of cards takes their natural height as its floor, so asking
  // more on a pinned canvas would refuse where one line drew before.
  const wrappedNatural = naturalWith(deltaLines);
  naturalHeight = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false || size.height >= wrappedNatural - 0.5
    ? wrappedNatural : naturalWith(deltaOneLine);
  // A card its host did not size takes the height of its content.
  const grow = rowDrivenHeight({ options, width: size.width, height: size.height, chromeH: 0, rowsH: naturalHeight });
  if (grow !== undefined) return layoutKpi(data, { ...options, size: { width: size.width, height: grow } });
  // A standalone card in a slot of fixed height (a given height or a size
  // preset) fills the slot: the figure grows to a quarter of the canvas
  // height and the delta to 30% of the figure, never under their
  // natural sizes, and the block of value, note and delta sits in the middle
  // of the free height. The natural size above keeps the natural fonts. A
  // grid panel keeps the shared figure size of its row, and the forms with a
  // spark, compare chips or an attainment keep their card layout.
  const fillSlot = fixedSlot && kindOn('total');
  if (fillSlot) {
    const wanted = Math.max(baseSize, Math.round(size.height * SLOT_FIGURE_SHARE));
    baseSize = fitValueText(valueText, wanted, baseSize, figure, plot.w, Infinity, measure).valueFont.size;
    const slotDelta = Math.round(baseSize * SLOT_DELTA_SHARE * 2) / 2;
    if (showDelta && slotDelta > deltaFont.size) {
      deltaFont = { ...deltaFont, size: slotDelta };
      ({ size: caretSize, w: caretW, h: caretH, pad: caretPad } = caretOf(deltaFont));
      const wrapped = wrapDelta(deltaFont, Math.max(4, plot.w - caretPad));
      deltaLines = wrapped.length === 2 ? wrapped : deltaOneLine;
    }
    // The note keeps half the size of the slot delta, so it still reads
    // under the large figure.
    const slotNote = Math.round(baseSize * SLOT_DELTA_SHARE) / 2;
    if (noteLines.length > 0 && slotNote > noteFont.size) {
      noteFont = { ...noteFont, size: slotNote };
      ({ lines: noteLines, h: noteBlockH } = noteBlock(noteFont));
    }
  }
  const deltaBandH = contentBottom - valueY - minimumValueH - noteBlockH - comparisonH;
  const stepDelta = (font: FontSpec) => {
    while (showDelta && font.size > deltaFloor && deltaBlock(font).h > deltaBandH) font = { ...font, size: font.size - 0.5 };
    return font;
  };
  const wrappedFont = stepDelta(deltaFont);
  if (deltaLines.length === 2 && deltaBlock(wrappedFont).h > deltaBandH) deltaLines = deltaOneLine;
  deltaFont = deltaLines.length === 2 ? wrappedFont : stepDelta(deltaFont);
  const deltaRowH = showDelta ? deltaBlock(deltaFont).h : 0;
  const valueBottom = contentBottom - deltaRowH - comparisonH - noteBlockH;

  const fitted = fitValueText(valueText, baseSize, hero.minimum, figure, plot.w, valueBottom - valueY, measure);
  valueFont = fitted.valueFont;
  const vsize = fitted.vsize;
  const blockH = vsize.height + noteBlockH + (showDelta ? valueGap + deltaRowH : 0);
  const slotOffset = fillSlot ? Math.max(0, (contentBottom - valueY - blockH) / 2) : 0;
  const valueRect: Rect = { x: plot.x, y: valueY + slotOffset, w: vsize.width, h: vsize.height };
  const noteRect: Rect | undefined = noteLines.length === 0 ? undefined : {
    x: plot.x,
    y: valueRect.y + valueRect.h + NOTE_GAP,
    w: plot.w,
    h: noteBlockH - NOTE_GAP,
  };
  const rowTop = valueRect.y + valueRect.h + noteBlockH + valueGap;
  const comparisonRowY = showComparisonChips ? rowTop : undefined;
  const attainmentRowY = showAttainmentChip ? packAttainment ? rowTop : rowTop + deltaRowH + comparisonRowH + attainmentGap : undefined;
  if (kindOn('total')) {
    requests.push({
      id: 'total:value',
      kind: 'total',
      owner: { categoryId: 'kpi' },
      text: valueText,
      lines: [valueText],
      font: valueFont,
      typeRole: 'kpiValue',
      priority: PRIORITY.grandTotal,
      candidates: [{ slot: 'main', rect: valueRect, penalty: 0 }],
    });
  }

  // Legacy delta follows the value in its own measured row.
  // The SVG caret sits left of the text with a 4px gap, so the pill
  // rect the solver claims is caretPad wider than the text alone; the text
  // rect shrinks back after solving (caret emission below).
  if (deltaText !== undefined && kindOn('point')) {
    const dsize = deltaBlock(deltaFont);
    const pillW = dsize.w + caretPad;
    const candidates: SlotCandidate[] = [{
      slot: 'belowValue',
      rect: { x: plot.x, y: rowTop, w: pillW, h: dsize.h },
      penalty: 0,
    }];
    requests.push({
      id: 'point:delta',
      claimId: 'kpi:delta:0',
      kind: 'point',
      role: composedTextRole(deltaText),
      typeRole: 'label',
      pad: 0,
      owner: { categoryId: 'kpi', segmentId: 'delta' },
      text: deltaText,
      lines: deltaLines,
      font: deltaFont,
      priority: PRIORITY.endpoint,
      candidates,
    });
  }

  if (showComparisonChips && comparisonRowY !== undefined) {
    comparisonVisuals.forEach((visual, index) => {
      const slot = comparisonBlock.slots[index]!;
      const rect = { x: plot.x + slot.x, y: comparisonRowY + slot.y, w: slot.w, h: slot.h };
      fittedComparisons.push({ visual, rect, caretPad: slot.caretPad });
      requests.push({
        id: `point:compare:${index}`,
        claimId: `kpi:delta:${index}`,
        kind: 'point',
        role: composedTextRole(visual.text),
        typeRole: 'label',
        pad: 0,
        owner: { categoryId: 'kpi', seriesId: visual.id, segmentId: visual.id },
        text: visual.text,
        lines: slot.lines,
        font: compareFont,
        priority: PRIORITY.endpoint,
        candidates: [{ slot: 'comparisonRow', rect, penalty: 0 }],
      });
    });
  }

  if (showAttainmentChip && attainmentRowY !== undefined) {
    const slot = attainmentBlock.slots[0]!;
    const rect = { x: plot.x + slot.x, y: attainmentRowY + slot.y, w: slot.w, h: slot.h };
    fittedAttainment = { lines: slot.lines, rect };
    requests.push({
      id: 'point:attainment',
      claimId: 'kpi:attainment',
      kind: 'point',
      role: composedTextRole(derived.attainment!.displayed),
      typeRole: 'label',
      pad: 0,
      owner: { categoryId: 'kpi', seriesId: 'attainment', segmentId: 'attainment' },
      text: derived.attainment!.displayed,
      lines: slot.lines,
      font: compareFont,
      priority: PRIORITY.endpoint,
      candidates: [{ slot: 'attainmentRow', rect, penalty: 0 }],
    });
  }

  // The authored note is a label like every other text on the card: it goes
  // through the solver with the rect the layout reserved for it, so the
  // placement engine knows the text is there. A raw node appended after the
  // solve is the one thing the contract does not allow a renderer to do.
  if (noteRect !== undefined) {
    requests.push({
      id: 'note:kpi',
      kind: 'category',
      role: 'note',
      typeRole: 'footnote',
      pad: 0,
      owner: { categoryId: 'kpi' },
      text: data.note!.trim(),
      lines: noteLines,
      font: noteFont,
      priority: PRIORITY.total,
      candidates: [{ slot: 'belowValue', rect: noteRect, penalty: 0 }],
    });
  }

  }

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: KPI_LABEL_PAD,
  });
  const solved = solveLabels(requests, occupied, solveCtx);
  // The delta is the card's comparison: losing it is a warning, not an info
  // line. The values note still names it.
  for (const warning of solved.warnings) {
    if (warning.code !== 'label-hidden' || warning.owner?.segmentId !== 'delta') continue;
    warning.severity = 'warn';
    warning.suggest = "widen the card (fewer grid columns or a wider canvas), or set delta.mode 'relative' for a shorter delta";
  }
  pushAll(warnings, solved.warnings);

  // tone/muted inks (the solver defaults to plain ink; the card recolors)
  for (const l of solved.placed) {
    if (l.hidden) continue;
    if (l.id === 'note:kpi') l.ink = { token: 'inkMuted' };
    if (l.id === 'category:label') l.ink = { token: theme.type.eyebrow?.ink ?? 'inkMuted' };
    if (l.id === 'total:value' && derived.band && derived.band.tone !== 'neutral') l.ink = { token: derived.band.tone };
    if (l.id === 'point:delta' && derived.tone) {
      l.ink = derived.tone === 'neutral' ? { token: data.delta?.direction === 'neutral' ? 'ink' : 'inkMuted' } : { token: derived.tone };
    }
    if (l.id.startsWith('point:compare:')) {
      const index = Number(l.id.slice('point:compare:'.length));
      const tone = derived.comparisons?.[index]?.tone ?? 'neutral';
      // On the background a text comparison takes the delta's plain tone;
      // on a tinted chip the tone is mixed toward the ink to hold contrast.
      l.ink = tone === 'neutral' ? { token: data.compare?.[index]?.direction === 'neutral' ? 'ink' : 'inkMuted' } : textComparisons || steer ? { token: tone } : chipInk(tone);
    }
    if (l.id === 'point:attainment') {
      const tone = derived.attainment?.tone ?? 'neutral';
      l.ink = tone === 'neutral' ? { token: steer ? 'ink' : 'inkMuted' } : textComparisons || steer ? { token: tone } : chipInk(tone);
    }
    if (steer?.muted.has(l.id)) l.ink = { token: 'inkMuted' };
  }

  // SVG caret instead of a ▲/▼ text glyph: a small filled triangle
  // (part 'caret') at the pill's left edge, same ink as the delta text,
  // vertically centered on the text's cap height: the rect centre where emission centred the cap
  // band there (labelsToNodes), else text y + ascent × 0.5.
  // The label rect then shrinks back to text-only so the text renders right
  // of the caret while the solver's claim still covers the whole pill.
  const deltaPlaced = solved.placed.find((l) => l.id === 'point:delta');
  if (deltaPlaced && !deltaPlaced.hidden && caretDir !== undefined && deltaText !== undefined) {
    const pill = deltaPlaced.rect;
    const capCy = deltaPlaced.lines.length === 1 && deltaPlaced.capHeight !== undefined
      ? pill.y + pill.h / 2
      : pill.y + measure(deltaText, deltaFont).ascent * 0.5;
    const tip = {
      x: pill.x + caretW / 2,
      y: caretDir === 'up' ? capCy - caretH / 2 : capCy + caretH / 2,
    };
    nodes.push({
      t: 'path',
      id: 'mark:delta:caret',
      d: arrowHeadPath(tip, caretDir === 'up' ? -Math.PI / 2 : Math.PI / 2, caretSize),
      fill: deltaPlaced.ink,
      owner: { categoryId: 'kpi', segmentId: 'delta' },
      part: 'caret',
    });
    deltaPlaced.rect = { x: pill.x + caretPad, y: pill.y, w: pill.w - caretPad, h: pill.h };
  }

  for (let index = 0; index < fittedComparisons.length; index++) {
    const fitted = fittedComparisons[index]!;
    const placed = solved.placed.find((label) => label.id === `point:compare:${index}`);
    if (!placed || placed.hidden) continue;
    const pill = placed.rect;
    const owner = placed.owner;
    // A text comparison has no fill: the pill is the text and its caret.
    if (!textComparisons) {
      nodes.push({
        t: 'rect',
        id: `mark:compare:${index}:chip`,
        rect: pill,
        fill: chipPaints(theme, fitted.visual.derived.tone, options.palette).fill,
        radius: surface.chipRadius,
        owner,
        part: 'kpiChip',
      });
      occupied.claim(pill, 'mark', owner, 'kpiChip');
    }

    if (fitted.visual.caretDir) {
      // The chip centres its caret on the chip row; a text comparison centres
      // it on the cap height of its first line, as the delta does.
      const capCy = !textComparisons
        ? pill.y + chipH / 2
        : placed.lines.length === 1 && placed.capHeight !== undefined
          ? pill.y + pill.h / 2
          : pill.y + measure(placed.lines[0] ?? '', compareFont).ascent * 0.5;
      const tip = {
        x: pill.x + compareAnatomy.padX + compareCaretW / 2,
        y: fitted.visual.caretDir === 'up' ? capCy - compareCaretH / 2 : capCy + compareCaretH / 2,
      };
      nodes.push({
        t: 'path',
        id: `mark:compare:${index}:caret`,
        d: arrowHeadPath(
          tip,
          fitted.visual.caretDir === 'up' ? -Math.PI / 2 : Math.PI / 2,
          compareCaretSize,
        ),
        fill: placed.ink,
        owner,
        part: 'caret',
      });
    }
    placed.rect = chipTextRect(pill, placed.lines, fitted.caretPad, compareFont, measure, compareAnatomy);
  }

  if (fittedAttainment) {
    const placed = solved.placed.find((label) => label.id === 'point:attainment');
    if (placed && !placed.hidden) {
      const pill = placed.rect;
      const owner = placed.owner;
      if (!textComparisons) {
        nodes.push({
          t: 'rect',
          id: 'mark:attainment:chip',
          rect: pill,
          fill: chipPaints(theme, derived.attainment!.tone, options.palette).fill,
          radius: surface.chipRadius,
          owner,
          part: 'kpiChip',
        });
        occupied.claim(pill, 'mark', owner, 'kpiChip');
      }
      placed.rect = chipTextRect(pill, fittedAttainment.lines, 0, compareFont, measure, compareAnatomy);
    }
  }

  // ---- emit ----
  const allLabels: PlacedLabel[] = solved.placed;
  const emittedLabels = labelsToNodes(theme, allLabels, (l) =>
    steer?.fonts.get(l.id) ?? (l.id === 'total:value'
      ? valueFont
      : l.id === 'point:delta'
        ? deltaFont
        : l.id === 'spark:last' || l.id.startsWith('spark:period:')
          ? { family: theme.type.family, ...theme.type.axis }
          : l.id.startsWith('point:compare:') || l.id === 'point:attainment'
          ? compareFont
          : l.id === 'note:kpi'
          ? noteFont
          : labelFont),
  ).map((node): SceneNode => {
    // A steering comparison prints its leading figure bold (the percent).
    const lead = node.t === 'text' && node.id.startsWith('label:') ? steer?.leads.get(node.id.slice('label:'.length)) : undefined;
    if (lead !== undefined && node.t === 'text' && node.lines.length === 1 && node.lines[0]!.startsWith(lead)) {
      const rest = node.lines[0]!.slice(lead.length);
      const comparison = derived.comparisons?.[Number(node.id.slice('label:point:compare:'.length))];
      return { ...node, runs: [{ text: lead, weight: emphasisWeight(theme) }, ...(rest ? [{ text: rest }] : [])],
        ...(comparison ? { display: { value: comparison.displayed } } : {}) };
    }
    // The note keeps its own part name: the solver names a node after the
    // label kind, and a card's caption is not the card's category label.
    if (node.id === 'label:note:kpi') return { ...node, part: 'kpiNote' };
    if (node.id === 'label:total:value') return { ...node, display: { value: valueText } };
    // The visible endpoint label carries the text the reader sees (formatted /
    // custom / ellipsized); a hidden or suppressed endpoint emits no node.
    if (node.id === 'label:spark:last' && node.t === 'text') return { ...node, display: { value: node.lines.join(' ') } };
    // The spark's first and last period read as axis text, not as figures.
    if (node.id.startsWith('label:spark:period:') && node.t === 'text') return { ...node, ink: { token: 'inkMuted' }, part: 'kpiSparkPeriod' };
    if (node.id === 'label:point:delta' && deltaText !== undefined) {
      return { ...node, display: { value: deltaText } };
    }
    if (node.id.startsWith('label:point:compare:')) {
      const index = Number(node.id.slice('label:point:compare:'.length));
      const comparison = derived.comparisons?.[index];
      return comparison === undefined ? node : { ...node, display: { value: comparison.displayed } };
    }
    if (node.id === 'label:point:attainment' && derived.attainment) {
      return {
        ...node,
        display:
          derived.attainment.state === 'ref-nonpositive'
            ? { state: derived.attainment.displayed }
            : { value: derived.attainment.displayed },
      };
    }
    return node;
  });
  pushAll(nodes, emittedLabels);

  const valueLabel = allLabels.find((l) => l.id === 'total:value');
  const deltaLabel = allLabels.find((l) => l.id === 'point:delta');
  const comparisonLabels = comparisonVisuals.map((_, index) =>
    allLabels.find((label) => label.id === `point:compare:${index}`),
  );
  const attainmentLabel = allLabels.find((label) => label.id === 'point:attainment');
  if (data.delta && derived.comparisons?.[0]) derived.comparisons[0].nodeId = deltaLabel?.nodeId;
  if (data.compare) {
    for (let index = 0; index < data.compare.length; index++) {
      if (derived.comparisons?.[index]) derived.comparisons[index]!.nodeId = comparisonLabels[index]?.nodeId;
    }
  }
  if (derived.attainment) derived.attainment.nodeId = attainmentLabel?.nodeId;
  const marks: KpiMarks = {
    valueNodeId: valueLabel?.nodeId ?? 'label:total:value',
    deltaNodeId: deltaLabel?.nodeId ?? comparisonLabels[0]?.nodeId,
    comparisonNodeIds: data.compare
      ? comparisonLabels.flatMap((label) => (label?.nodeId ? [label.nodeId] : []))
      : undefined,
    attainmentNodeId: attainmentLabel?.nodeId,
    sparkNodeId,
  };

  // The endpoint is only "visible" when the solver actually placed it: a
  // hidden (density) or suppressed (labels off) label describes a trend over
  // N periods without claiming an endpoint the reader cannot see.
  const sparkEndpoint = allLabels.find((label) => label.id === 'spark:last');
  const sparkPhrase = sparkDrawable
    ? chartString(options, 'kpiSparkDesc', { v1: sparkVals.length, v2: sparkEndpoint && !sparkEndpoint.hidden ? chartString(options, 'endingAt', { v1: sparkEndpoint.text }) : '' })
    : '';
  const attainmentPhrase = derived.attainment
    ? derived.attainment.state === 'ref-nonpositive'
      ? chartString(options, 'attainmentNonpositive', { v1: derived.attainment.label })
      : `, ${derived.attainment.displayed}`
    : '';

  return {
    type: 'kpi',
    size,
    sizing: resolveSizing({ ...chartSizing('kpi', options), minWidth: 0 }, size, {
      minWidth: size.width - plot.w + minimumValue.width,
      minHeight,
      // A chip row wider than the default card asks for the width it needs.
      naturalWidth: Math.min(420, Math.max(KPI_SIZE[compact ? 'compact' : 'regular'].width,
        Math.ceil(margin.left + margin.right + comparisonBlock.naturalWidth))),
      naturalHeight,
    }),
    plot,
    scene: nodes,
    labels: allLabels,
    axes: [],
    annotations: [],
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived,
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'kpiTitle', { v1: data.label })),
      counts: [...(sparkDrawable ? [structureCount('periods', sparkVals.length, undefined, options)] : [])],
      desc: `${data.label} ${valueText}${derived.band?.label ? `, ${derived.band.label}` : ''}${a11yDelta}${attainmentPhrase}${sparkPhrase}${noteLines.length === 0 ? '' : `. ${data.note!.trim()}`}.`,
    },
    warnings,
    debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
}

/**
 * The spark is in the card's unit. A last value 1000 times or more
 * off the card's value is in another scale: the card's format printed a spark
 * in millions beside a card in euros as "€0.00B", with no warning. No
 * conversion is guessed from the gap; the author gives the values again.
 */
function sparkScaleRefusal(value: number, spark: readonly (number | null)[]): LintWarning[] {
  const index = lastObservedIndex(spark);
  if (index === undefined || sameScale([value], [spark[index]])) return [];
  return [{
    code: 'spark-scale-mismatch', severity: 'error',
    message: `the spark ends at ${spark[index]} and the card's value is ${value}, 1000 times or more apart, so one of them is in another unit`,
    suggest: "give the spark values in the card's unit",
    field: ['data', 'spark', 'values'],
  }];
}

/** Read the measured footer before solveFrame's minimum plot-height clamp. */
function cardChromeHeight(height: number, plotTop: number, bottomMargin: number, nodes: readonly SceneNode[]): number {
  const footerTops = nodes.flatMap((node) => node.t === 'text' && (node.part === 'source' || node.part === 'footnote') ? [node.y] : []);
  const footerTop = Math.min(height - bottomMargin, ...footerTops);
  // solveFrame's cardGaps mode keeps an 8px gap above this measured footer.
  return plotTop + height - footerTop + (footerTops.length > 0 ? 8 : 0);
}

function sparkHeight(canvasHeight: number, plotHeight: number, share: number, floor: number): number {
  return Math.max(floor, Math.min(Math.round(canvasHeight * share), Math.floor(plotHeight * 0.5)));
}

/** Keep the existing spark share while fitting the measured minimum text rows. */
function minimumCardHeight(chromeHeight: number, contentHeight: number, spark: boolean, share: number, floor: number): number {
  let height = Math.ceil(chromeHeight + contentHeight);
  while (spark && height - chromeHeight - sparkHeight(height, height - chromeHeight, share, floor) < contentHeight) height++;
  return height;
}

interface ChipSlot {
  /** Offsets from the block's left edge and top. */
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  caretPad: number;
}

/**
 * Lay out a block of comparison chips without cutting a word of them
 * (the label names the baseline). One row when the chips fit side by
 * side; otherwise one chip per row, and a chip wider than the card wraps its
 * text inside a taller chip. `naturalWidth` is the one-row width.
 */
function planChips(
  items: readonly { text: string; caretPad: number }[],
  font: FontSpec,
  width: number,
  measure: TextMeasurer,
  anatomy: RowAnatomy,
): { slots: ChipSlot[]; height: number; naturalWidth: number } {
  if (items.length === 0) return { slots: [], height: 0, naturalWidth: 0 };
  const { padX, gap } = anatomy;
  const rowH = (text: string) => anatomy.h ?? measure(text, font).height;
  const natural = items.map((item) => measure(item.text, font).width + 2 * padX + item.caretPad);
  const naturalWidth = natural.reduce((sum, w) => sum + w, 0) + gap * (items.length - 1);
  if (naturalWidth <= width) {
    let x = 0;
    const slots = items.map((item, index) => {
      const slot = { x, y: 0, w: natural[index]!, h: rowH(item.text), lines: [item.text], caretPad: item.caretPad };
      x += natural[index]! + gap;
      return slot;
    });
    return { slots, height: maxOf(slots.map((slot) => slot.h)), naturalWidth };
  }
  let y = 0;
  const slots = items.map((item, index) => {
    const fits = natural[index]! <= width;
    const lines = fits ? [item.text] : wrapWhole(item.text, font, Math.max(4, width - 2 * padX - item.caretPad), measure);
    const h = rowH(lines[0]!) + (lines.length - 1) * lineBox(font);
    const slot = { x: 0, y, w: fits ? natural[index]! : width, h, lines, caretPad: item.caretPad };
    y += h + CHIP_ROW_GAP;
    return slot;
  });
  return { slots, height: y - CHIP_ROW_GAP, naturalWidth };
}

/**
 * Wrap a comparison label without dropping a character (the label names
 * the baseline). Words wrap greedily with no line limit; a word wider
 * than the chip breaks between characters instead of taking an ellipsis.
 */
function wrapWhole(text: string, font: FontSpec, width: number, measure: TextMeasurer): string[] {
  const lines: string[] = [];
  let current = '';
  const fits = (candidate: string) => measure(candidate, font).width <= width;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = current ? `${current} ${word}` : word;
    if (fits(joined)) { current = joined; continue; }
    if (current) lines.push(current);
    current = '';
    for (const ch of Array.from(word)) {
      if (current && !fits(current + ch)) { lines.push(current); current = ''; }
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/** The text box inside a chip: after the pad and caret, first line centred on the chip row. */
function chipTextRect(
  pill: Rect, lines: readonly string[], caretPad: number, font: FontSpec, measure: TextMeasurer, anatomy: RowAnatomy,
): Rect {
  const first = measure(lines[0] ?? '', font);
  return {
    x: pill.x + anatomy.padX + caretPad,
    y: pill.y + ((anatomy.h ?? first.height) - first.height) / 2,
    w: Math.max(...lines.map((line) => measure(line, font).width)),
    h: first.height + (lines.length - 1) * lineBox(font),
  };
}

function fitValueText(
  valueText: string, baseSize: number, minimum: number, figure: { family: string; weight: number }, width: number, height: number,
  measure: TextMeasurer,
) {
  // The value keeps its title-derived size and fits down to the hero floor
  // of its target (kpiHeroSizesPx: a card's figure never prints at 9 px);
  // family and weight come from the figure role.
  let valueFont: FontSpec = { family: figure.family, size: baseSize, weight: figure.weight, lineHeight: 1.2 };
  let vsize = measure(valueText, valueFont);
  const availH = Math.max(10, height);
  const scale = Math.min(1, width / vsize.width, availH / vsize.height);
  if (scale < 1) {
    let s = Math.max(minimum, Math.floor(baseSize * scale * 2) / 2);
    valueFont = { ...valueFont, size: s };
    vsize = measure(valueText, valueFont);
    while (s > minimum && (vsize.width > width || vsize.height > availH)) {
      s -= 0.5;
      valueFont = { ...valueFont, size: s };
      vsize = measure(valueText, valueFont);
    }
  }
  return { valueFont, vsize };
}
