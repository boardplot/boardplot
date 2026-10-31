/**
 * Histogram — the distribution of ONE measure, as a thin semantic adapter over
 * the column engine.
 *
 * Why an adapter and not an engine: a histogram over equal-width bins IS a
 * column chart with contiguous bars. `layoutColumn(..., { bandFraction: 1 })`
 * produces exactly-touching bars and solves their values. This adapter
 * replaces the category row with measured bin-edge ticks. A copy of the column layout to gain
 * contiguity would drift apart from the original.
 *
 * The gap between bars is COSMETIC in a column chart and would be a lie here:
 * equal-width bins tile the number line with no space between them, so
 * `bandFraction` defaults to 1 and a caller who narrows it is narrowing ink,
 * never meaning.
 *
 * What this file owns, and what makes the exhibit honest:
 *
 * - The binning is DECLARED. A histogram of the same observations with a
 * different bin count tells a different story, and the reader cannot see
 * the choice unless the exhibit prints it. The method note names the rule
 * (Freedman-Diaconis / Sturges / an authored count or width), the width,
 * the interval convention and n. Turning it off warns.
 * - The vertical encoding is DECLARED. Bar height is a count of observations,
 * while the subtitle and the bin labels speak in the measure's own unit;
 * the method note's first clause says so, because nothing else on the
 * canvas can.
 * - The rule is warned about when the sample is too small for it to mean
 * anything: Freedman-Diaconis and Sturges are asymptotic, and at n = 12 the
 * shape on the page is mostly an artifact of the rule.
 * - Nothing is withheld silently. Bin labels thinned by the solver, count
 * labels that cannot fit, and a frequency axis suppressed because
 * its ticks would read "2.5 observations" each leave a trace.
 *
 * The histogram contract is validated in FULL before delegating, so no column
 * normalize error ("column requires at least one category") can ever reach an
 * agent that authored `observations`.
 */

import { chartString } from '../../strings/histogram';
import { defaultNumberDecimals, MINUS, formatAutomaticNumber, shareSetFormatter } from '../../format';
import { MAX_FORMAT_DECIMALS, nonzeroDecimals } from '../../formatPrecision';
import {
  MAGNITUDE_DIVISOR,
  exampleSpec,
  defaultFormatSpec,
  formatWithSpec,
  formatterFromExample,
  parseFormatExample,
  roundedNumber,
  withChartMarks,
  type NumberFormatSpec,
} from '../../formatSpec';
import { defaultMeasurer, type FontSpec } from '../../text';
import { resolveTheme, themeForWidth, panelTypeClass, strokeToken } from '../../theme';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, solveLabels, PRIORITY, SERIES_VALUE_GAP, type LabelRequest } from '../../label/solver';
import { labelsToNodes } from '../../label/emit';
import { NormalizeError, resolveSize } from '../../normalize/shared';
import { iqr as interquartileRange, quantileType7, sortAscending } from '../../stats';
import type { ChartData } from '../../types/data';
import type { Annotation } from '../../types/annotations';
import type { ColumnOptions } from '../../types/options';
import type { Geometry, LintWarning } from '../../types/scene';
import { layoutColumn } from '../column/layout';
import { TILED_BANDS } from '../column/plot';
import { axisTitleAllowed } from '../../axis';
import { localeStrings, stringFields } from '../../strings';
import { AUTO_LEGEND, isAutomaticLegend } from '../../legendPolicy';
import { authoredNotes, frameTextOptions, withAuthoredFootnotes } from '../../frame';
import { disclosureNote } from '../../notes';
import { assertCountsCoverSample, computeBinning, countPerBin, round12 } from './binning';
import type {
  HistogramBinMark,
  HistogramData,
  HistogramDerived,
  HistogramMarks,
  HistogramOptions,
} from './types';
import { maxOf, pushAll } from '../../arrays';

/** Past this many bins, empty bins stay blank in sparse distributions. */
const POINT_LABEL_MAX_BINS = 12;
/**
 * Below this many observations, Freedman-Diaconis and Sturges are both
 * extrapolations: both are asymptotic rules, and the conventional floor at
 * which a sample is described as a distribution rather than as points is 30.
 */
const SMALL_SAMPLE_N = 30;
/** Fewer observations than this and there is no distribution to describe. */
const MIN_N = 4;

/** Synthetic, stable, documented category ids: bin0 .. bin{k-1}. */
const binId = (index: number): string => `bin${index}`;

function validateObservations(data: HistogramData): number[] {
  if (!data || !Array.isArray(data.observations)) {
    throw new NormalizeError(
      'empty-data',
      'observations',
      'histogram requires data.observations: an array of raw numeric observations',
      'pass { "observations": [12, 18, 21, ...] }',
    );
  }
  const observations = data.observations;
  for (let i = 0; i < observations.length; i++) {
    const value = observations[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new NormalizeError(
        'non-finite-observation',
        `observations[${i}]`,
        `observations[${i}] is ${String(value)}; a histogram bins finite numbers only`,
        'remove null/NaN/Infinity observations before charting, or state the missing count in a footnote',
      );
    }
  }
  if (observations.length === 0) throw new NormalizeError('empty-data', 'observations', 'histogram requires observations');
  if (observations.length < MIN_N) {
    throw new NormalizeError(
      'histogram-too-few',
      'observations',
      `${observations.length} observations cannot show a distribution; a histogram needs at least ${MIN_N}`,
      "use chart type 'dot' to plot the values themselves, or 'table' to list them",
    );
  }
  return observations;
}

export function layoutHistogram(
  data: HistogramData,
  options: HistogramOptions = {},
): Geometry<HistogramMarks, HistogramDerived> {
  const warnings: LintWarning[] = [];
  const strings = { ...localeStrings(options.locale?.language), ...options.strings };
  const observations = validateObservations(data);
  const n = observations.length;
  const sorted = sortAscending(observations);
  const min = sorted[0]!;
  const max = sorted[n - 1]!;

  if (max === min) {
    throw new NormalizeError(
      'histogram-zero-range',
      'observations',
      `all ${n} observations equal ${min}; there is no distribution to bin`,
      "use chart type 'kpi' to state the single value",
    );
  }

  const q1 = quantileType7(sorted, 0.25);
  const median = quantileType7(sorted, 0.5);
  const q3 = quantileType7(sorted, 0.75);
  const spread = interquartileRange(sorted);
  // Computed here, never trusted: the mean is the only summary a caller could
  // plausibly have sent along, and it is exactly the one that must be re-derived.
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;

  const membership = computeBinning({
    sorted,
    min,
    max,
    interquartileRange: spread,
    bins: options.bins ?? 'auto',
    snap: options.binSnap ?? true,
  });
  const counts = countPerBin(sorted, membership.edges);
  assertCountsCoverSample(counts, n);
  const k = counts.length;
  // Count against exact edges first. Derived output and text keep the display precision.
  const binning = {
    ...membership,
    width: round12(membership.width),
    anchor: round12(membership.anchor),
    edges: membership.edges.map(round12),
    hFd: round12(membership.hFd),
    hSturges: round12(membership.hSturges),
    hAuto: round12(membership.hAuto),
  };

  // ---- options the histogram grammar refuses ----
  if (options.sort?.categories) {
    warnings.push({
      code: 'histogram-sort-ignored',
      severity: 'warn',
      message:
        'sort.categories is ignored: bins are ordered by value, and sorting them by height turns a distribution into a Pareto chart',
      suggest: "drop options.sort, or use chart type 'bar' with topN for a ranking",
    });
  }
  if (options.topN) {
    warnings.push({
      code: 'histogram-topn-ignored',
      severity: 'warn',
      message:
        'topN is ignored: dropping bins would delete real observations from both the ink and the axis and understate the spread',
      suggest: 'narrow the sample before charting, or set an explicit bins width',
    });
  }
  // The binning rule is a method note on request.
  const methodNote = options.methodNote === true;

  if (binning.requestedCount !== undefined && binning.requestedCount !== k) {
    warnings.push({
      code: 'histogram-bin-count-adjusted',
      severity: 'warn',
      message: `bins: ${binning.requestedCount} produced ${k} bins: the first edge is snapped to a multiple of the width (${binning.anchor}), so the last bin extends past the largest observation`,
      suggest: `pass bins: { width: ${binning.width}, anchor: ${min} } to pin exactly ${binning.requestedCount} bins`,
    });
  }

  if (n < SMALL_SAMPLE_N) {
    warnings.push({
      code: 'histogram-small-sample',
      severity: 'warn',
      message: `n = ${n}: Freedman-Diaconis and Sturges are asymptotic rules, so at this sample size the number of bins — and therefore the shape on the page — is largely an artifact of the rule, not of the data`,
      suggest: "show the observations themselves with chart type 'dot', or compare groups with 'box'",
    });
  }

  // ---- labels ----
  // ONE decimal policy for the whole edge column, and it is derived from the
  // BIN WIDTH rather than from each edge in turn. Per-value decimals would
  // print "1,000" beside "1,250.0" in the same axis; worse, a width of 0.04
  // formatted at the business default renders edges 0.00, 0.04, 0.08 as
  // "0.0", "0.0", "0.1" — three bins, two of them wearing the same name.
  // First question: at how many decimals does every edge print true to within
  // 1% of the bin width? Distinct names alone printed a width of 2.5 as
  // "0–3, 3–5, 5–8", bins that read 3, 2 and 3 wide. Within 1% a
  // width of 344.025 still prints "0–344" rather than "0.000–344.025"; the
  // method note below carries the exact width. Only when no printable
  // precision gets there does the loop fall back to: at how many decimals do
  // all k+1 edges still have distinct names? A cap of 6 decimals printed a
  // width of 5e-7 as four bins named "0.000002–0.000002".
  // One bin per whole value names the value under its bar, not the half-way edges.
  const perValue = binning.perValue;
  // From the exact minimum: the display-rounded anchor of 1e11 + 0.5 reads 1e11 + 1.
  const labelValues = perValue ? counts.map((_, index) => min + index) : binning.edges;
  const edgeDecimals = ((): number => {
    const tolerance = binning.width / 100;
    for (let decimals = 0; decimals <= MAX_FORMAT_DECIMALS; decimals++) {
      if (labelValues.every((edge) => Math.abs(Number(edge.toFixed(decimals)) - edge) <= tolerance)) return decimals;
    }
    for (let decimals = 0; decimals <= MAX_FORMAT_DECIMALS; decimals++) {
      const rendered = labelValues.map((edge) => formatAutomaticNumber(edge, { locale: options.locale?.language, decimals, automatic: false }));
      if (new Set(rendered).size === rendered.length) return decimals;
    }
    return MAX_FORMAT_DECIMALS;
  })();
  const edgeText = (value: number, automatic: boolean) => formatAutomaticNumber(value, { locale: options.locale?.language, decimals: defaultNumberDecimals(value, edgeDecimals, options.unit, options.target), automatic });
  // Distinct edges win over the automatic AUTO_MAX_DECIMALS cap, as on an axis (tickFormatter): 1e-11 bins near 1e-6 would all read "1.0 × 10⁻⁶".
  const automaticEdges = new Set(labelValues.map((edge) => edgeText(edge, true))).size === new Set(labelValues).size;
  const fmt = options.format
    ? formatterFromExample(options.format, options.locale?.language, options.unit)
    : (value: number) => edgeText(value, automaticEdges);
  const edgeLabels = labelValues.map((edge) => fmt(edge));

  /**
   * The measure's format as a SPEC, so the method note can re-derive it at a
   * different precision. The default branch reproduces the `fmt` above:
   * the chart locale's separators, no magnitude, no affixes. Without the
   * locale a German chart printed "0,0–0,5" bins and a note of "0.5".
   */
  // The note and the edges hold the example's scale ("0.0000005 Mio. from 1 Mio."); the precision search below keeps them nonzero.
  const measureSpec: NumberFormatSpec = options.format
    ? { ...exampleSpec(options.format, options.locale?.language, options.unit), nonzero: undefined }
    : { ...defaultFormatSpec(options.locale?.language), decimals: edgeDecimals };
  /**
   * The method note is the exhibit's receipt for its own binning: a reader
   * reconstructs every edge as `anchor + i x width`. At the display precision
   * of the EDGE COLUMN that receipt is false — a width of 332.5 prints "333",
   * and edges rebuilt from 333 miss every bin boundary on the page. So the
   * note gets its own precision: the fewest decimals at which the width AND
   * the first edge both round-trip to themselves under the caller's format
   * (magnitude included — `roundedNumber` is the value the reader SEES).
   * When no precision inside the cap round-trips, the note says the figures
   * are rounded rather than certifying a width nothing used.
   */
  const NOTE_MAX_DECIMALS = 6;
  // Per value, not one precision for both: an anchor of 0 printed "0.000"
  // because the width needed three decimals is false precision on a number
  // that has none.
  // A width no precision inside the cap round-trips (an unsnapped rule width,
  // 241.610692...) prints one decimal past the edges, and says it is rounded.
  // A width under the cap still prints nonzero (nonzeroDecimals): 5e-7
  // printed "4 bins of about 0.000000". The check runs on the figure the
  // reader sees, at the example's magnitude: a width of 0.5 under a "Mio."
  // example is 5e-7 on the page, and the raw 0.5 passed as nonzero while
  // the note printed "0.00M".
  const noteDecimalsFor = (value: number): number => {
    for (let decimals = 0; decimals <= NOTE_MAX_DECIMALS; decimals++) {
      if (roundedNumber(value, { ...measureSpec, decimals }) === value) return decimals;
    }
    return nonzeroDecimals(value / MAGNITUDE_DIVISOR[measureSpec.magnitude], Math.min(NOTE_MAX_DECIMALS, edgeDecimals + 1));
  };
  const noteSpecFor = (value: number): NumberFormatSpec => ({
    ...measureSpec,
    decimals: noteDecimalsFor(value),
  });
  const fmtNote = (value: number): string => formatWithSpec(value, noteSpecFor(value));
  const noteExact = [binning.width, binning.anchor].every(
    (value) => roundedNumber(value, noteSpecFor(value)) === value,
  );
  // A negative edge carries a minus of its own, so the range dash gets spaces
  // ("−100 – −80", not "−100–−80"), on every bin of the exhibit.
  const rangeDash = edgeLabels.some((text) => text.startsWith(MINUS)) ? ' – ' : '–';
  const binLabels = counts.map((_, index) => perValue ? edgeLabels[index]! : `${edgeLabels[index]}${rangeDash}${edgeLabels[index + 1]}`);
  const collapsedEdges = edgeLabels.filter(
    (text, index) => index > 0 && text === edgeLabels[index - 1],
  ).length;
  if (collapsedEdges > 0) {
    // Without an example the engine chose the precision itself, so the
    // suggestion names the data. The warning once blamed an options.format
    // nobody had set.
    const effect = `${collapsedEdges} bin edge(s) onto the name of their neighbour, so distinct bins carry identical labels; the bins themselves are unaffected`;
    warnings.push({
      code: 'histogram-edge-labels-collapsed',
      severity: 'info',
      ...(options.format !== undefined
        ? { message: `options.format rounds ${effect}`, suggest: `use a format-by-example carrying at least ${edgeDecimals} decimal(s), or a wider bins.width` }
        : { message: `the bin edges differ only past ${MAX_FORMAT_DECIMALS} decimals, which rounds ${effect}`, suggest: 'scale the observations to a larger unit, or set a wider bins.width' }),
    });
  }

  /**
   * The two axes of a histogram carry DIFFERENT QUANTITIES, so they cannot
   * share one formatter. `options.format` is a format-by-example for the
   * MEASURE — it is what prints the bin edges — and handing it to the column
   * delegate would print the frequency axis and the count labels in it too:
   * a bin holding 26 observations rendered "€26" is money the reader will add
   * up, and the exhibit would then carry a currency total it never computed.
   *
   * The counts inherit exactly one thing from the caller's example, the
   * GROUPING convention, so a German exhibit reads "1.200 observations"
   * rather than "1,200" — a comma a German reader takes for a decimal point.
   * Prefix, suffix, magnitude, sign policy and decimals are all unit claims a
   * count cannot make, and are dropped. When the example shows no grouping
   * separator the decimal separator implies it (',' decimal -> '.' grouping),
   * which for a plain "1234" lands on the engine default.
   */
  const countFormat = ((): string | undefined => {
    if (options.format === undefined) return undefined;
    const spec = parseFormatExample(options.format);
    const separator = spec.thousandsSep || (spec.decimalSep === ',' ? '.' : ',');
    return `1${separator}234`;
  })();

  // Every bin count prints; past twelve bins, where only a few bins
  // hold observations, the empty ones stay blank.
  const filled = counts.filter((count) => count > 0).length;
  // One bin per value names every bin, so an empty slot above its value reads as zero without a 0.
  const sparseLabels = perValue || (k > POINT_LABEL_MAX_BINS && filled <= POINT_LABEL_MAX_BINS);

  const shares = counts.map((count) => count / n * 100);
  const shareFormat = shareSetFormatter(shares, options.locale?.language);
  const shareDecimals = shareFormat.decimals;
  const frequencyFormat = options.valueAxis?.percent ? `0${shareDecimals > 0 ? defaultFormatSpec(options.locale?.language).decimalSep + '0'.repeat(shareDecimals) : ''}%` : countFormat;

  // The tallest bin, first of a tie: the one count that stays when the others give way.
  const peak = counts.indexOf(maxOf(counts));
  const countData = (peakOnly: boolean): ChartData => ({
    categories: counts.map((_, index) => ({ id: binId(index), label: binLabels[index]! })),
    series: [
      {
        id: 'count',
        ...(options.valueAxis?.percent ? { format: frequencyFormat } : {}),
        label: chartString(options, 'observations'),
        values: counts.map((count, index) => {
          const value = options.valueAxis?.percent ? count / n * 100 : count;
          return (sparseLabels && count === 0) || (peakOnly && index !== peak) ? { number: value, label: false }
            : options.valueAxis?.percent ? { number: value, label: shareFormat.format(value) } : value;
        }),
      },
    ],
  } as ChartData);
  let delegateData = countData(false);

  /**
   * Explicit passthrough, never a spread of the caller's options: a spread
   * would hand column keys the histogram grammar has already refused
   * (`sort`, `topN`, `annotations`) and they would take effect
   * behind the warning that says they did not.
   */
  const delegateOptions = (frequencyAxis: boolean, tail: Annotation[] = []): ColumnOptions => {
    // The sample base and bins stay visible even when the frequency axis is hidden.
    const captioned = frequencyAxis && options.valueAxis?.show !== false && axisTitleAllowed(options.labels);
    const notesOff = options.footnotes === false || (options as HistogramOptions & { footnotesOff?: boolean }).footnotesOff === true;
    // The method note states the binning; where it prints, the base keeps only n so the binning prints once.
    const methodPrinted = methodNote && !notesOff;
    const caption = [options.axisTitles?.y, sampleBase, methodPrinted ? undefined : binsText].filter(Boolean).join(' · ');
    // Without the axis, an authored frequency title leads the base note: the footer then says what a bar counts.
    // The default footer is one short line that keeps the edge
    // rule, 'Orders per 250 bin, lower edge included · n = 240'. The full binning text stays
    // where the width prints rounded (Boardplot bins are always equal width), and where
    // strings.histogramBins is authored: an authored setting always wins. The request fills
    // every string with its default, so 'authored' means it differs from the locale default.
    const title = frequencyAxis ? undefined : options.axisTitles?.y;
    const shortBins = binsExact && !binsAuthored;
    const baseNote = captioned ? [] : [disclosureNote(methodPrinted
      ? `${title ? `${title} · ` : ''}${sampleBase}.`
      : perValue && !binsAuthored
        ? `${title ? chartString(options, 'histogramPerValueTitled', { v1: title }) : chartString(options, 'histogramPerValue')} · ${sampleBase}.`
      : shortBins
        ? `${title
          ? chartString(options, 'histogramBinsShortTitled', { v1: title, v2: fmtNote(binning.width) })
          : chartString(options, 'histogramBinsShort', { v1: fmtNote(binning.width) })} · ${sampleBase}.`
        : `${title ? `${title} · ` : ''}${sampleBase} · ${binsText}.`)];
    return {
    ...frameTextOptions(options),
    ...(isAutomaticLegend(options) ? { [AUTO_LEGEND]: true } : {}),
    ...(options.size === undefined ? {} : { size: options.size }),
    ...(options.margin === undefined ? {} : { margin: options.margin }),
    // Only the author's own notes keep a number; the rest are derived.
    ...withAuthoredFootnotes({}, [...authoredNotes(options), ...baseNote, ...(methodPrinted ? [methodNoteText(false)] : [])], options.footnotes),
    ...(baseNote.length > 0 ? { footnotesOff: false } : {}),
    ...(tail.length > 0 ? { annotations: tail } : {}),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    ...(options.palette === undefined ? {} : { palette: options.palette }),
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    // NOT options.format — that formats the measure (the bin edges), and the
    // delegate's `format` reaches the COUNTS. See countFormat above.
    ...(frequencyFormat === undefined ? {} : { format: frequencyFormat }),
    // Every bin count matters: offer every seat before naming an undrawn bin.
    labelDensity: options.labelDensity ?? 'full',
    labels:
      options.labels === false
        ? false
        : { point: true, ...(options.labels ?? {}) },
    ...(options.labelPlacements === undefined ? {} : { labelPlacements: options.labelPlacements }),
    ...(options.highlight === undefined ? {} : { highlight: options.highlight }),
    ...(options.colorblindSafe === undefined ? {} : { colorblindSafe: options.colorblindSafe }),
    ...(options.interactive === undefined ? {} : { interactive: options.interactive }),
    ...(options.measure === undefined ? {} : { measure: options.measure }),
    // Column renders no value axis by default and bin labels thin out from
    // k = 9 on; a histogram whose counts are neither labelled nor scaled is
    // unreadable, so the frequency axis is on unless it would print
    // fractional observations.
    valueAxis: { ...(options.valueAxis ?? {}), percent: false, show: options.valueAxis?.show ?? frequencyAxis },
    // The frequency axis is the column's value axis, so its title is column's.
    ...(captioned ? { axisTitles: { primary: caption } } : options.axisTitles?.y === undefined || !frequencyAxis ? {} : { axisTitles: { primary: options.axisTitles.y } }),
    bandFraction: options.bandFraction ?? 1,
    [TILED_BANDS]: true,
    } as ColumnOptions;
  };

  function methodNoteText(withBase: boolean): string {
    let rule: string;
    if (binning.rule === 'auto') {
      const chosen = binning.hFd > 0 && binning.hFd <= binning.hSturges ? 'Freedman-Diaconis' : 'Sturges';
      rule = binning.snapped ? stringFields(strings.histogramSnapped, { rule: chosen }) : chosen;
    } else {
      rule = binning.rule === 'count' ? strings.histogramRuleCount : strings.histogramRuleWidth;
    }
    return `${withBase ? `${sampleBase} · ${binsText}. ` : ''}${stringFields(strings.histogramMethod, {
      count: k, width: fmtNote(binning.width), from: fmtNote(binning.anchor), rule,
      rounding: noteExact ? '' : strings.histogramRounded,
      smallSample: n < SMALL_SAMPLE_N ? strings.histogramSmallSample : '',
    })}`;
  }

  const sampleBase = `n = ${formatAutomaticNumber(n, { locale: options.locale?.language, decimals: 0 })}`;
  const binsExact = roundedNumber(binning.width, noteSpecFor(binning.width)) === binning.width;
  const binsAuthored = strings.histogramBins !== localeStrings(options.locale?.language).histogramBins;
  const binsText = perValue && !binsAuthored
    ? chartString(options, 'histogramPerValueRange', { v1: edgeLabels[0]!, v2: edgeLabels[k - 1]! })
    : stringFields(strings.histogramBins, {
    count: k, about: binsExact ? '' : strings.histogramAbout,
    width: fmtNote(binning.width), from: fmtNote(binning.edges[0]!), to: fmtNote(binning.edges[k]!),
  });
  const size = resolveSize(options.size);
  let columnOptions = delegateOptions(true);
  let column = layoutColumn(delegateData, columnOptions, true);
  const allValuesLabelled = (geometry: typeof column) => counts.every((count, index) => (perValue && count === 0) || geometry.labels.some((label) => label.kind === 'point' && label.owner.categoryId === binId(index) && !label.hidden));

  // An instrument, not a prediction: the tick values are read back off the
  // geometry the engine actually produced. Counts are whole numbers, and a
  // frequency axis reading 0 / 0.5 / 1 / 1.5 invites "one and a half
  // observations". When that happens the axis is suppressed and the counts are
  // printed on the bars instead — with a trace saying why.
  let frequencyAxisShown = options.valueAxis?.show !== false;
  const fractionalTicks = column.axes.some(
    (axis) =>
      axis.axis === 'y' && axis.ticks.some((tick) => typeof tick.at === 'number' && !Number.isInteger(tick.at)),
  );
  if (fractionalTicks && !options.valueAxis?.percent && options.valueAxis?.show === undefined) {
    const withoutAxisOptions: typeof columnOptions = {
      ...delegateOptions(false),
      labels: options.labels === false ? false : { point: true, ...(options.labels ?? {}) },
    };
    const withoutAxis = layoutColumn(delegateData, withoutAxisOptions, true);
    if (allValuesLabelled(withoutAxis)) {
      columnOptions = withoutAxisOptions;
      column = withoutAxis;
      frequencyAxisShown = false;
      warnings.push({
        code: 'histogram-frequency-axis-suppressed',
        severity: 'info',
        message: `the largest bin holds ${maxOf(counts)} observations, so the frequency axis grid would tick in fractions of an observation; the axis is suppressed${options.axisTitles?.y ? ', its title moves to the base note,' : ''} and every bin carries its own count instead`,
        suggest: 'set valueAxis.show: true to force the axis, fractional ticks and all',
      });
    }
  }
  // A bin that holds observations but stands under a pixel is
  // called out with its count, so the far tail is on the page, not only in n.
  const belowInk = (geometry: typeof column): number[] => {
    const bars = new Map(geometry.marks.bars.map((bar) => [bar.categoryId, bar]));
    return counts.flatMap((count, index) => (count > 0 && (bars.get(binId(index))?.rect.h ?? 1) < 1 ? [index] : []));
  };
  const tailBins = belowInk(column);
  let tail: Annotation[] = [];
  if (tailBins.length > 0 && options.labels !== false) {
    tail = tailBins.slice(0, 3).map((index): Annotation => ({
      kind: 'callout', id: `tail-${binId(index)}`, at: binId(index), preferSide: 'above',
      text: `${formatAutomaticNumber(counts[index]!, { locale: options.locale?.language, decimals: 0 })} in ${binLabels[index]}`,
    }));
    const withTail = frequencyAxisShown
      ? delegateOptions(true, tail)
      : { ...delegateOptions(false, tail), labels: options.labels === undefined ? { point: true } : { point: true, ...options.labels } };
    columnOptions = withTail;
    column = layoutColumn(delegateData, columnOptions, true);
  }

  // Try exact compact counts before the note; the frequency axis keeps whole counts.
  const drawnCounts = (geometry: typeof column) => geometry.labels.filter(label => label.kind === 'point' && !label.hidden).length;
  if (!options.valueAxis?.percent && column.labels.some(label => label.kind === 'point' && label.hidden === 'collision')) {
    const spec = countFormat ? withChartMarks(parseFormatExample(countFormat), options.locale?.language) : defaultFormatSpec(options.locale?.language);
    const compactData: ChartData = { ...delegateData, series: [{ ...delegateData.series[0]!, values: counts.map(count => {
      if (count < 1000 || !/[0-9]/.test(formatWithSpec(count, spec))) return sparseLabels && count === 0 ? { number: 0, label: false } : count;
      const magnitude = count >= 1e9 ? 'bn' : count >= 1e6 ? 'm' : 'k';
      const decimals = Math.max(0, String(count).replace(/0+$/, '').length - String(Math.trunc(count / MAGNITUDE_DIVISOR[magnitude])).length);
      // A zero integer part makes three fractional digits unambiguous to the format parser.
      const format = formatWithSpec(0, { ...spec, magnitude, decimals });
      return roundedNumber(count, parseFormatExample(format)) === count ? { number: count, format } : count;
    }) }] };
    const compact = layoutColumn(compactData, columnOptions, true);
    if (drawnCounts(compact) > drawnCounts(column)) column = compact;
  }

  if (options.valueAxis?.show === undefined && !allValuesLabelled(column) && !frequencyAxisShown) {
    columnOptions = delegateOptions(true, tail);
    column = layoutColumn(delegateData, columnOptions, true);
  }
  // Counts on every bar make the frequency axis a second copy, so it gives way even under an authored title.
  if (options.valueAxis?.show === undefined && !options.valueAxis?.percent && allValuesLabelled(column)) {
    const withoutAxisOptions = delegateOptions(false, tail);
    const withoutAxis = layoutColumn(delegateData, withoutAxisOptions, true);
    if (allValuesLabelled(withoutAxis)) { columnOptions = withoutAxisOptions; column = withoutAxis; frequencyAxisShown = false; }
  }
  /**
   * A count wider than its bin (with the gap two neighbouring values keep)
   * that lost its own seat at its bar (lifted onto a leader, hidden by a
   * neighbour, or moved to the note) no longer fits. Then the frequency
   * axis carries the scale, only the tallest bin keeps its count, empty
   * bins print nothing and the tail callouts go too. A count displaced on
   * a wide bin (by a tail callout, say) keeps its seating, and so does a
   * chart with at most twelve filled bins: its few counts and callouts are
   * the exhibit (a far outlier), and its empty bins already print nothing. An authored
   * labelDensity 'full' keeps every count on its seat or leader. A count the
   * density gate drops on purpose ('minimal') has not lost a seat. A hidden
   * axis keeps them too, since nothing else would carry the scale.
   */
  const NATURAL_SEATS: ReadonlySet<string> = new Set(['outsideTop', 'outsideBottom', 'insideEnd']);
  const bars = column.marks.bars;
  const binStep = bars.length > 1 ? Math.abs(bars[1]!.rect.x - bars[0]!.rect.x) : Infinity;
  const countsDisplaced = options.labels !== false && options.labels?.point !== false && options.labelDensity !== 'full'
    && options.valueAxis?.show !== false && filled > POINT_LABEL_MAX_BINS && column.labels.some((label) => label.kind === 'point' && label.hidden !== 'redundant' && label.hidden !== 'density'
      && counts[Number(label.owner.categoryId?.slice(3))]! > 0 && label.rect.w + SERIES_VALUE_GAP > binStep
      && (label.hidden !== undefined || label.leader !== undefined || !NATURAL_SEATS.has(label.slot)));
  if (countsDisplaced) {
    delegateData = countData(true);
    // One count is left: no density gate may drop it.
    columnOptions = { ...delegateOptions(true), labelDensity: 'full' };
    column = layoutColumn(delegateData, columnOptions, true);
    warnings.push({
      code: 'histogram-counts-peak-only',
      severity: 'info',
      message: `the bin counts do not fit over their ${k} bars, so only the tallest bin prints its count (${maxOf(counts)}) and the frequency axis carries the scale`,
      suggest: "use fewer bins or a wider canvas to print every count, or set labelDensity: 'full' to seat every count, on leaders where needed",
    });
  }
  frequencyAxisShown = column.axes.some((axis) => axis.axis === 'y');

  // Histogram ticks name boundaries, at one measured stride. Column still owns all count labels.
  const theme = themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? size.width);
  const measure = options.measure ?? defaultMeasurer;
  const font: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const categoryLabels = column.labels.filter((label) => label.kind === 'category');
  const y = column.plot.y + column.plot.h + 6;
  const removedIds = new Set(categoryLabels.map((label) => `label:${label.id}`));
  column.scene = column.scene.filter((node) => !removedIds.has(node.id));
  column.labels = column.labels.filter((label) => label.kind !== 'category');
  column.warnings = column.warnings.filter((warning) => warning.code !== 'category-stride');
  const axis = column.axes.find((axis) => axis.axis === 'x');
  const step = axis && k > 1 ? axis.ticks[1]!.pos - axis.ticks[0]!.pos : column.plot.w / k;
  const first = axis ? axis.ticks[0]!.pos - step / 2 : column.plot.x;
  const widths = edgeLabels.map((text) => measure(text, font).width);
  let stride = 1;
  // Edge numbers keep a word space and more between them.
  const EDGE_GAP = 16;
  const lastLabel = labelValues.length - 1;
  while (stride < lastLabel && edgeLabels.some((_, i) => i % stride === 0 && i + stride <= lastLabel && (widths[i]! + widths[i + stride]!) / 2 + EDGE_GAP > stride * step)) stride++;
  const requests: LabelRequest[] = [];
  const ticks = labelValues.map((value, i) => {
    // A value sits under its bar centre; an edge sits on the seam between two bars.
    const x = first + (perValue ? i + 0.5 : i) * step;
    const id = `${perValue ? 'value' : 'edge'}:${i}`;
    const labelled = options.labels !== false && options.labels?.category !== false && i % stride === 0;
    if (labelled) {
      const w = widths[i]!, h = font.size * (font.lineHeight ?? 1.2);
      // The first edge number starts at the plot edge and the last ends there; inner numbers and values centre on their position.
      const left = !perValue && i === 0 ? x : !perValue && i === k ? x - w : Math.max(0, Math.min(size.width - w, x - w / 2));
      requests.push({ id, kind: 'category', owner: { categoryId: binId(Math.min(i, k - 1)) }, text: edgeLabels[i]!, lines: [edgeLabels[i]!], font, typeRole: 'axis', priority: PRIORITY.reference, candidates: [{ slot: 'main', rect: { x: left, y, w, h }, penalty: 0 }] });
    }
    // A labelled edge gets the long tick, an unlabelled one the short tick. Values need none: the seams part the bars.
    if (!perValue) column.scene.push({ t: 'line', id: `edgeTick:${i}`, x1: x, y1: column.plot.y + column.plot.h, x2: x, y2: column.plot.y + column.plot.h + (labelled ? 5 : 3), stroke: { token: 'axis' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'tick' });
    return { at: value, pos: x, ...(labelled ? { labelId: id } : {}) };
  });
  if (axis) axis.ticks = ticks;
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  column.labels.filter((label) => !label.hidden).forEach((label) => occupied.claim(label.rect, 'label', label.owner));
  const solved = solveLabels(requests, occupied, labelCtx(theme, size, {}, {
    density: 'full',
    measure,
    plot: column.plot,
    labelPad: 2,
  }));
  // Edge numbers read as axis labels: muted ink, as column prints its value-axis ticks.
  for (const label of solved.placed) label.ink = { token: 'inkMuted' };
  pushAll(column.labels, solved.placed);
  pushAll(column.scene, labelsToNodes(theme, solved.placed, () => font));
  pushAll(warnings, solved.warnings);
  const binLabelsShown = solved.placed.filter((label) => !label.hidden && label.id !== `edge:${k}`).length;
  if (stride > 1) warnings.push({ code: 'histogram-bin-labels-thinned', severity: 'info', message: `${binLabelsShown} bin labels fit at an even stride of ${stride} bins${perValue ? '' : '; ticks mark every edge'}`, suggest: 'widen the canvas, or use fewer bins' });

  const barByCategory = new Map(column.marks.bars.map((bar) => [bar.categoryId, bar]));
  // Touching bins meet at a 1 px background seam, so each bar reads as its own bin.
  const seams: typeof column.scene = [];
  for (let i = 1; i < k; i++) {
    const a = barByCategory.get(binId(i - 1))?.rect, b = barByCategory.get(binId(i))?.rect;
    if (!a || !b || a.h <= 0 || b.h <= 0 || Math.abs(a.x + a.w - b.x) > 0.01) continue;
    seams.push({ t: 'line', id: `binSeam:${i}`, x1: b.x, y1: Math.max(a.y, b.y), x2: b.x, y2: Math.min(a.y + a.h, b.y + b.h), stroke: { token: 'background' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'segmentSeam' });
  }
  const lastBar = column.scene.reduce((last, node, index) => (node.part === 'bar' ? index : last), -1);
  if (lastBar >= 0) {
    const sceneAfter = column.scene.splice(lastBar + 1);
    pushAll(column.scene, seams);
    pushAll(column.scene, sceneAfter);
  }
  // A tail bin holding one observation against a mode holding four hundred is
  // a bar thinner than its own antialiasing. The count is real, it is in the
  // receipt and in the claims, and the reader cannot see it — so the exhibit
  // says so rather than letting the tail quietly disappear. It is an
  // info, not a warn: the geometry is correct, the canvas is what is short.
  const invisibleBins = counts.filter((count, index) => {
    const bar = barByCategory.get(binId(index));
    return count > 0 && bar !== undefined && bar.rect.h < 1;
  }).length;
  if (invisibleBins > 0) {
    warnings.push({
      code: 'histogram-tail-below-ink',
      severity: 'info',
      message: `${invisibleBins} bin(s) hold observations but stand less than one pixel tall against the tallest bin (${maxOf(counts)}); the counts are exact, the ink is not legible`,
      suggest: 'trim or split out the extreme tail, or render on a taller canvas',
    });
  }
  const bins: HistogramBinMark[] = counts.map((count, index) => {
    const bar = barByCategory.get(binId(index));
    return {
      index,
      id: binId(index),
      lo: binning.edges[index]!,
      hi: binning.edges[index + 1]!,
      count,
      rect: bar?.rect ?? { x: 0, y: 0, w: 0, h: 0 },
      ...(bar?.nodeId === undefined ? {} : { nodeId: bar.nodeId }),
    };
  });

  const derived: HistogramDerived = {
    n,
    min,
    max,
    mean,
    median,
    q1,
    q3,
    iqr: spread,
    binning,
    counts,
    binLabels,
    pointLabelsShown: column.labels.some((label) => label.kind === 'point' && !label.hidden),
    binLabelsShown,
    frequencyAxisShown,
  };

  // The shared note cannot recover bin names from the observation-only input.
  for (const label of column.labels) {
    if (label.kind !== 'point') continue;
    const index = counts.findIndex((_, i) => binId(i) === label.owner.categoryId);
    if (index >= 0) label.noteText = `${countFormat ? formatterFromExample(countFormat, options.locale?.language)(counts[index]!)
      : formatAutomaticNumber(counts[index]!, { locale: options.locale?.language, decimals: 0 })} (${binLabels[index]})`;
  }

  return {
    ...column,
    type: 'histogram',
    size,
    marks: { bars: column.marks.bars, bins },
    derived,
    warnings: [...warnings, ...column.warnings],
  };
}
