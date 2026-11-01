import { chartString as boxString } from '../../strings/box';
import { chartTheme } from '../chartEnv';
import { labelOn as chartLabelOn } from '../labelOn';
import { splitNumberMarks } from '../../numberMarks';

/** Box wording; the Tukey fence factor (1.5) in it takes the chart's explicit decimal mark (numberMarks.ts). */
function chartString(...args: Parameters<typeof boxString>): string {
  const text = boxString(...args);
  const options = args[0];
  const language = typeof options?.locale === 'string' ? options.locale : options?.locale?.language;
  const marks = language === undefined ? undefined : splitNumberMarks(language).marks;
  return marks ? text.replace(/\b1[.,]5(?= ?×)/g, `1${marks.decimal}5`) : text;
}
import { bandSizing, NATURAL_BAND_STEP } from '../../sizing';
import { structureCount } from '../../structureCounts';
/**
 * Box — distribution comparison from RAW OBSERVATIONS.
 *
 * Groups run top->down as rows, values left->right, deliberately modelled on
 * bar's football-field skeleton (band scale over rows, wrapped row-label band,
 * a floating rect per row, a mid tick, a value axis, labels through the
 * solver). A box plot needs four things football-field does not have —
 * whiskers with caps, individually drawn outliers, an outlier-inclusive
 * domain, and a per-group n — and every one of them must exist BEFORE
 * `solveLabels` runs so the solver can avoid it. That is why this is its own
 * layout function and not a post-pass over `layoutBar`: nodes appended after
 * the solve would silently void the no-overlap guarantee.
 *
 * `n` is mandatory furniture. Comparing a box of n=4 against a box of n=4,000
 * without that number is the single most common box plot deception, so every
 * row carries its sample size and, when a statistic was suppressed, the reason
 * in the same breath.
 */

import { rowLabelBand } from '../../label/rowLabels';
import { fittedLabel, gutterBudget, stepDownFont } from '../../label/rowFit';
import { applyValueAxisTitleInk, layoutValueAxis, straightBreakGlyph, planValueAxisTitle, valueAxisTitleRequest } from '../../axis';
import { formatAutomaticNumber, numberRange, seriesValueFormatter } from '../../format';
import { formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { rowLabelX, type Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SlotCandidate, type SolveCtx } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveHighlight, resolveSize } from '../../normalize/shared';
import { applyAxisBounds, bandScale, brokenLinearScale, crossesLinearBreak, invalidLinearBreakReason, linearScale, niceDomain, type LinearBreak } from '../../scale';
import { axisBreakInvalid } from '../../axisBreakInvalid';
import { breakStyleRefusal } from '../band/breakOrder';
import { authoredNotes, frameTextOptions, solveFrame, plotHeightAfter, authoredFootnoteCount, fixedPlotChrome } from '../../frame';
import { defaultMeasurer, type FontSpec } from '../../text';
import { strokeToken, canvasMargin, focusColor, paintColor, resolveSemanticPaletteTheme, semanticPalettePaint } from '../../theme';
import type { LabelKind } from '../../types/options';
import type { Geometry, LintWarning, SceneNode } from '../../types/scene';
import { pickInk } from '../../color';
import {
  BEYOND_ARE_OUTLIERS,
  METHOD_BY_RULE,
  distinctWithCounts,
  summarizeGroup,
} from './summary';
import type {
  BoxData,
  BoxDerived,
  BoxGroupDerived,
  BoxMarks,
  BoxOptions,
  BoxRowMark,
  WhiskerRule,
} from './types';
import { autoDecimals } from '../../formatPrecision';
import { annotateBox } from './annotations';
import { composedTextRole } from '../../textRole';
import { textScaleOf } from '../../typeFloors';
import { DEFAULT_TARGET } from '../../target';
import { asColumnHeads, columnHeadFont, fitHead, HEAD_PREFIX, headRequest } from '../bullet/columnHead';
import { disclosureNote } from '../../notes';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

const LABEL_GAP = 5;
const CAT_BAND_GAP = 10;
const N_BAND_GAP = 12;
/** Point radius; also the horizontal inset that keeps a domain-edge dot inside the plot. */
const POINT_R = 2.5;
/** Whisker cap height as a fraction of the box height. */
const CAP_FRACTION = 0.55;
const OUTLIER_FLOOD_SHARE = 0.1;
/**
 * Vertical pitch between dodge lanes. Two circles one lane apart are tangent
 * plus a hair, so a lane assignment that succeeds is a guarantee of separation,
 * not a hope.
 */
const LANE_PITCH = POINT_R * 2 + 0.5;
/** The fewest touching beyond-whisker dots drawn as one counted group. */
const GROUP_MIN = 3;
/** Beyond-whisker dots closer than this past tangency read as touching. */
const GROUP_GAP = 3;

/** Space between the value axis and a comparison bracket. */
const BRACKET_CLEAR = 8;

/** A beyond-whisker value parks at the plot edge when its gap to every other mark exceeds this share of the data span. */
const PARK_SHARE = 0.25;
/** Space between a median label and its own box. */
const MEDIAN_OFFSET = 1;
/** Clear space between a median label and the box of the row above. */
const MEDIAN_CLEAR = 10;
/** Distance from the end of the value scale (the break mark) to the parked value. */
const PARK_GAP = 17;
/** Width of the two-stroke break mark at the end of the value scale. */
const BREAK_W = 8;

/** The shortest value run a row of boxes reads on, as a horizontal bridge's bar run. */
const MIN_VALUE_RUN = 80;

/**
 * The authored value-axis break, or undefined when it cannot be drawn (the chart then draws unbroken).
 * The omitted span must hold no drawn value, and no box or whisker may run across it,
 * because a cut through a box or whisker misstates the spread the chart shows.
 */
function boxAxisBreak(
  requested: unknown,
  domain: [number, number],
  drawnValues: readonly number[],
  rows: readonly BoxGroupDerived[],
  axisShown: boolean,
  warnings: LintWarning[],
): LinearBreak | undefined {
  if (!requested || typeof requested !== 'object') return undefined;
  const asked = requested as LinearBreak;
  const spans = rows.flatMap((row) =>
    row.state === 'box' || row.state === 'median-only' ? [[row.whiskerLow!, row.q1!], [row.q1!, row.q3!], [row.q3!, row.whiskerHigh!]] : []);
  const reason = breakStyleRefusal(asked)
    ?? (axisShown ? undefined : 'a hidden value axis draws no break mark')
    ?? invalidLinearBreakReason(domain, asked, drawnValues)
    ?? (spans.some(([a, b]) => crossesLinearBreak(a!, b!, asked)) ? 'a box or whisker runs across the omitted span' : undefined);
  if (reason === undefined) return { from: asked.from, to: asked.to };
  const refused = axisBreakInvalid('box', reason);
  warnings.push({ ...refused, severity: 'warn', message: `${refused.message}; the chart is drawn without the break` });
  return undefined;
}

/**
 * `bracketRoom` is the width the second pass keeps between the plot and the n column for comparison brackets.
 * `wrapLead` puts a bracket's named span on its own line over the figure.
 */
export function layoutBox(data: BoxData, options: BoxOptions = {}, bracketRoom = 0, wrapLead = false): Geometry<BoxMarks, BoxDerived> {
  const warnings: LintWarning[] = [];
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const authoredFmt = options.format ? formatterFromExample(options.format, options.locale?.language) : undefined;
  const labelsOff = options.labels === false;
  const labelOn = (kind: LabelKind): boolean => chartLabelOn(options, kind);
  const highlights = new Set(resolveHighlight(options.highlight));

  if (!data || !Array.isArray(data.groups) || data.groups.length === 0) {
    throw new NormalizeError('empty-data', 'groups', 'box requires at least one group', 'add groups[].observations');
  }
  if (data.groups.every((group) => (group.observations?.length ?? 0) === 0)) {
    throw new NormalizeError(
      'empty-data',
      'groups[].observations',
      'every group is empty — a box plot cannot be drawn from zero observations',
      'supply raw observations for at least one group',
    );
  }

  const whiskerRule: WhiskerRule = options.whiskers ?? 'tukey';
  const showOutliers = options.showOutliers ?? true;
  const showObservations = options.showObservations ?? 'small-n';
  const methodNote = options.methodNote === true;

  // ---- derived, computed here and never trusted from input ----------------
  const summaries = data.groups.map((group) =>
    summarizeGroup({
      id: group.id,
      label: group.label ?? group.id,
      observations: group.observations,
      whiskers: whiskerRule,
    }),
  );

  const sortOrder = options.sort?.categories ?? 'sheet';
  const order = summaries.map((_, index) => index);
  if (sortOrder === 'reverse') order.reverse();
  else if (sortOrder === 'asc' || sortOrder === 'desc') {
    const direction = sortOrder === 'asc' ? 1 : -1;
    order.sort((a, b) => {
      const am = summaries[a]!.median;
      const bm = summaries[b]!.median;
      // A group with no median has no position on the value axis; it sorts to
      // the end in sheet order rather than pretending to rank.
      if (am === null && bm === null) return a - b;
      if (am === null) return 1;
      if (bm === null) return -1;
      return (am - bm) * direction || a - b;
    });
  }
  const rows = order.map((index) => summaries[index]!);
  const printed = [
    ...data.groups.flatMap((group) => group.observations ?? []),
    ...rows.flatMap((row) => [row.min, row.q1, row.median, row.q3, row.max, row.whiskerLow, row.whiskerHigh]),
  ];
  // From a million the chart takes the engine scale bar takes, chosen once
  // from its largest value: labels and ticks print 2.78B, not 2,778,700,000.
  // Its precision comes from the values that print (statistics, drawn
  // outliers and small-n points), so 160 raw observations do not lift every
  // label to "2.7787B". An authored format keeps its digits.
  const labelled = rows.flatMap((row, index) => [
    row.min, row.q1, row.median, row.q3, row.max, row.whiskerLow, row.whiskerHigh,
    ...(showOutliers ? row.beyondWhiskers : []),
    ...(row.state === 'points' && showObservations === 'small-n' ? data.groups[order[index]!]!.observations ?? [] : []),
  ]);
  const engine = authoredFmt || options.target === undefined || !labelled.some((value) => value != null && Math.abs(value) >= 1e6)
    ? undefined : seriesRasterFormatter(undefined, labelled, options.locale?.language, options.unit, options.target);
  const scaled = engine?.spec.autoMagnitude ? engine : undefined;
  const axisFmt = authoredFmt ?? scaled?.fmt ?? ((value: number) =>
    formatAutomaticNumber(value, { locale: options.locale?.language, decimals: autoDecimals(value) }));
  // The statistic and point labels are one series: one precision for them all (seriesValueFormatter), not one per value.
  const fmt = authoredFmt ?? scaled?.fmt ?? seriesValueFormatter(printed, options.locale?.language);

  // ---- the median COLUMN gets ONE decimal convention ------------------------
  // The default formatter decides decimals per value, which printed 107 / 97.6
  // / 87.5 / 133 / 97.5 down a single column — ragged precision that reads as
  // sloppiness and invites "why is that one rounder?". Alignment is exact:
  // decide once, from the whole column, and give every median the same number
  // of decimals. An authored `format` already
  // fixes the decimals, so it is left alone.
  const fmtMedian = authoredFmt || scaled
    ? fmt
    : seriesValueFormatter(rows.map((row) => row.median), options.locale?.language, options.unit, options.target);

  // ---- lints ---------------------------------------------------------------
  if (whiskerRule === 'minmax' && options.showOutliers !== undefined) {
    warnings.push({
      code: 'box-outliers-ignored',
      severity: 'info',
      message: "whiskers 'minmax' reaches every observation, so showOutliers has nothing to separate",
      suggest: "use whiskers 'tukey' or 'p10p90' if outliers should be drawn individually",
    });
  }
  // How many real observations `showOutliers: false` takes out of the ink AND
  // out of the axis domain. Computed here so the count can be PRINTED, not just
  // warned about: a lint lives in the JSON, and the reader holding the slide
  // never sees the JSON.
  const withheldBeyond: Record<string, number> = emptyIdRecord();
  let withheldTotal = 0;
  if (whiskerRule !== 'minmax' && !showOutliers) {
    for (const row of rows) {
      if (row.beyondWhiskers.length > 0) {
        withheldBeyond[row.id] = row.beyondWhiskers.length;
        withheldTotal += row.beyondWhiskers.length;
      }
    }
  }
  // Only warn when something was actually withheld. Firing on withheldTotal === 0
  // reports the removal of nothing, and a warning an author cannot act on is the
  // noise that gets every warning muted.
  if (whiskerRule !== 'minmax' && !showOutliers && withheldTotal > 0) {
    warnings.push({
      code: 'box-outliers-hidden',
      severity: 'warn',
      message: `showOutliers is off while the whiskers still stop at the ${
        whiskerRule === 'tukey' ? 'fence-bounded extremes' : 'deciles'
      } — ${withheldTotal} observation${withheldTotal === 1 ? '' : 's'} (${
        chartString(options, ({ tukey: 'boxBeyondNountukey', minmax: 'boxBeyondNounminmax', p10p90: 'boxBeyondNounp10p90' } as const)[whiskerRule])
      }) are neither drawn nor allowed to stretch the value axis`,
      suggest: "show them, or use whiskers 'minmax' so the whiskers reach every observation",
    });
  }
  if (labelsOff) {
    warnings.push({
      code: 'box-n-hidden',
      severity: 'warn',
      message:
        'labels are off, so no row states its sample size — a box of n=4 next to a box of n=4,000 reads as an equal comparison',
      suggest: 'keep labels on; suppressing value labels alone does not suppress n',
    });
  }
  if (options.legend) {
    warnings.push({
      code: 'box-legend-ignored',
      severity: 'warn',
      message: 'box directly labels every row; the requested legend was ignored',
      suggest: 'remove legend — the method note explains the box, whiskers, and dots',
    });
  }
  if (options.valueAxis?.break && typeof options.valueAxis.break !== 'object') {
    warnings.push({
      code: 'axis-break-unsupported',
      severity: 'warn',
      message: "box draws only a valueAxis.break with from and to; 'auto' was ignored",
    });
  }
  const ignored = (
    [
      ['topN', options.topN],
      ['transpose', options.transpose],
      ['bandFraction', options.bandFraction],
      ['secondaryAxis', options.secondaryAxis],
      // The value axis is a plain linear read of the observations; the knobs
      // below would each change what the spread MEANS, so they are refused
      // out loud rather than silently ignored.
      ['valueAxis.tickStep', options.valueAxis?.tickStep],
      ['valueAxis.includeZero', options.valueAxis?.includeZero],
      ['valueAxis.percent', options.valueAxis?.percent],
      ['valueAxis.reverse', options.valueAxis?.reverse],
    ] as const
  )
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
  if (ignored.length > 0) {
    warnings.push({
      code: 'box-option-ignored',
      severity: 'warn',
      message: `box ignores ${ignored.join(', ')}`,
      suggest: 'row height is derived from the label furniture it must fit; the value axis is a plain linear read of the observations',
    });
  }
  for (const row of rows) {
    if (row.state === 'empty') {
      warnings.push({
        code: 'box-empty-group',
        severity: 'warn',
        message: `group '${row.id}' has no observations; the row is kept and marked n = 0 rather than dropped`,
        owner: { categoryId: row.id },
        suggest: 'remove the group or supply its observations',
      });
    } else if (row.state === 'points') {
      warnings.push({
        code: 'box-small-n',
        severity: 'warn',
        message: `group '${row.id}' has n = ${row.n}; quartiles from fewer than 5 observations would be invented, so the observations are drawn instead`,
        owner: { categoryId: row.id },
        suggest: 'collect more observations, or read the row as individual values',
      });
    } else if (row.state === 'median-only') {
      warnings.push({
        code: 'box-zero-iqr',
        severity: 'info',
        message: `group '${row.id}' has IQR = 0; no rect is drawn because a sliver reads as "narrow", not as "zero"`,
        owner: { categoryId: row.id },
      });
    }
    // Only the Tukey rule makes a claim about how many points SHOULD fall
    // outside; p10p90 puts a fifth of any sample outside by construction, so
    // flagging that would be noise, not a finding.
    if (whiskerRule === 'tukey' && row.n > 0 && row.beyondWhiskers.length > OUTLIER_FLOOD_SHARE * row.n) {
      warnings.push({
        code: 'box-outlier-flood',
        severity: 'info',
        message: `group '${row.id}' marks ${row.beyondWhiskers.length} of ${row.n} observations as outliers; the rule does not fit this distribution`,
        owner: { categoryId: row.id },
        suggest: "use whiskers 'p10p90', or show the shape with a histogram",
      });
    }
  }

  // ---- what each row actually draws ---------------------------------------
  const drawnBeyond = rows.map((row) =>
    showOutliers && row.beyondWhiskers.length > 0 ? distinctWithCounts(row.beyondWhiskers) : [],
  );
  const drawnObservations = rows.map((row, index) =>
    row.state === 'points' && showObservations === 'small-n'
      ? distinctWithCounts(data.groups[order[index]!]!.observations)
      : [],
  );

  const drawnValues: number[] = [];
  rows.forEach((row, index) => {
    if (row.state === 'box' || row.state === 'median-only') {
      drawnValues.push(row.whiskerLow!, row.whiskerHigh!, row.q1!, row.q3!, row.median!);
    }
    for (const point of drawnBeyond[index]!) drawnValues.push(point.value);
    for (const point of drawnObservations[index]!) drawnValues.push(point.value);
  });
  if (drawnValues.length === 0) {
    throw new NormalizeError(
      'empty-data',
      'groups[].observations',
      'no group draws anything: every group is empty or suppressed',
      "show small-n observations (showObservations: 'small-n') or supply larger samples",
    );
  }

  // EDGE PARK: one value beyond the whiskers that lies far
  // past every other drawn mark would set the axis alone and squeeze the boxes
  // the exhibit compares. Its value is parked at the plot edge behind a break
  // mark and printed under it, so the box and whisker scale keeps its width.
  // Only a beyond-whisker value is parked (never a box, whisker or small-n
  // dot), only one distinct value, and only where no authored axis maximum or
  // break, hidden axis or comparison bracket asks for the plain linear read.
  let parked: number | undefined;
  const beyondValues = drawnBeyond.flatMap((points) => points.map((point) => point.value));
  if (options.valueAxis?.show !== false && options.valueAxis?.max === undefined && typeof options.valueAxis?.break !== 'object' && !options.annotations?.length && beyondValues.length > 0) {
    const top = maxOf(beyondValues);
    const neededOnScale = rows.some((row, index) =>
      ((row.state === 'box' || row.state === 'median-only') &&
        [row.whiskerLow, row.whiskerHigh, row.q1, row.q3, row.median].includes(top)) ||
      drawnObservations[index]!.some((point) => point.value === top));
    const rest = drawnValues.filter((value) => value !== top);
    const lo = Math.min(minOf(drawnValues), options.valueAxis?.min ?? Infinity);
    if (!neededOnScale && rest.length > 0 && top - lo > 0 && top - maxOf(rest) > PARK_SHARE * (top - lo)) parked = top;
  }
  const domainValues = parked === undefined ? drawnValues : drawnValues.filter((value) => value !== parked);
  let rawLo = minOf(domainValues);
  let rawHi = maxOf(domainValues);
  [rawLo, rawHi] = applyAxisBounds([rawLo, rawHi], [rawLo, rawHi], options.valueAxis, warnings);
  if (rawLo === rawHi) {
    const pad = Math.max(1, Math.abs(rawLo) * 0.1);
    rawLo -= pad;
    rawHi += pad;
  }

  // ---- frame ---------------------------------------------------------------
  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  // Two dot encodings can appear in one exhibit — hollow outliers and filled
  // small-n observations. An encoding a reader has to guess at is a defect
  // so the note names the second one whenever it is drawn.
  const drawsObservations =
    showObservations === 'small-n' && rows.some((row) => row.state === 'points');
  // Kept as SEPARATE footnotes rather than one concatenated sentence: each is a
  // distinct disclosure and a reader should be able to find one without reading
  // the others. The Tukey rule is what a reader assumes, so stating it is
  // a method note; any other whisker rule changes what whiskers and dots mean
  // and prints regardless, as does the second dot encoding. The note describes
  // the ink ACTUALLY on the page: with showOutliers off there are no dots.
  // The default Tukey rule prints its one line, as the other
  // rules print theirs; the full method note stays behind methodNote.
  const highlighted = rows.filter((row) => highlights.has(row.id) && row.state === 'box').map((row) => row.label);
  // Each line names an encoding on the chart, so each stays in the frame (disclosure).
  const methodNotes = [
    ...(methodNote || whiskerRule !== 'tukey'
      ? [chartString(options, ({ tukey: showOutliers ? 'boxTukeyPoints' : 'boxTukeyNoPoints', minmax: showOutliers ? 'boxMinmaxPoints' : 'boxMinmaxNoPoints', p10p90: showOutliers ? 'boxP10P90Points' : 'boxP10P90NoPoints' } as const)[whiskerRule])]
      : [showOutliers ? chartString(options, 'boxBriefPoints') : chartString(options, 'boxBriefNoPoints')]),
    // The filled box is the highlight, and the chart says so.
    ...(highlighted.length > 0 ? [chartString(options, 'boxHighlight', { v1: highlighted.join(', ') })] : []),
    ...(drawsObservations
      ? [chartString(options, 'boxSmallSample')]
      : []),
  ].map(disclosureNote);
  // THE CENSORSHIP TRACE. `showOutliers: false` removes real
  // observations from the ink AND from the axis domain; without this line the
  // printed exhibit shows a tighter distribution than the data holds and the
  // reader has no way to know. It is NOT gated on `methodNote`: turning off a
  // method statement must not also turn off a disclosure that data is missing.
  const withheldNote =
    withheldTotal > 0
      ? disclosureNote(chartString(options, 'boxWithheldNote', { v1: withheldTotal, v2: withheldTotal === 1 ? '' : 's', v3: chartString(options, ({ tukey: 'boxBeyondNountukey', minmax: 'boxBeyondNounminmax', p10p90: 'boxBeyondNounp10p90' } as const)[whiskerRule]), v4: withheldTotal === 1 ? 'is' : 'are', v5: withheldTotal === 1 ? 'is' : 'are' }))
      : undefined;
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frameResult = solveFrame(
    {
      size,
      margin: { ...canvasMargin(theme, size.width), ...options.margin },
      ...frameTextOptions(options),
      footnotes: [
        ...authoredNotes(options),
        ...methodNotes,
        ...(withheldNote ? [withheldNote] : []),
      ],
      theme,
      measure,
    },
    occupied,
  );
  const plot0 = frameResult.plot;

  const axisShown = options.valueAxis?.show !== false;
  // The value-axis title under the tick row, as on bar; drawn only when authored.
  const axisTitle = axisShown && labelOn('axisTitle')
    ? planValueAxisTitle(options.axisTitles?.primary, theme, measure, plot0.w)
    : undefined;
  const axisH = axisShown ? measure('0', tickFont).height + 8 + (axisTitle ? axisTitle.height + 2 : 0) : 0;
  const valueLabelH = measure('0', labelFont).height;
  // The median label sits above its box by default, so the first row needs the
  // same clearance the band gap gives every other row:
  // labels drive layout, they do not get dropped when layout forgot them.
  const topPad = labelOn('point') ? valueLabelH + 4 : 0;
  fixedPlotChrome(frameResult, topPad + axisH);
  const availH = plotHeightAfter(frameResult, size.height, plot0.h - topPad - axisH);
  const lineH = tickFont.size * 1.2;

  const nText = (row: BoxGroupDerived): string => {
    const n = `n = ${formatAutomaticNumber(row.n, { locale: options.locale?.language, decimals: 0 })}`;
    // Suppression gets its trace at the exact spot the reader looks for the
    // sample size, not only in a footnote at the bottom of the canvas.
    const withheld = withheldBeyond[row.id];
    const hidden = withheld ? chartString(options, 'boxHiddenCount', { v1: withheld }) : '';
    if (row.state === 'empty') return chartString(options, 'boxEmptyN', { v1: n });
    if (row.state === 'points') {
      return showObservations === 'small-n'
        ? chartString(options, 'boxPointsN', { v1: n })
        : chartString(options, 'boxSmallN', { v1: n });
    }
    if (row.state === 'median-only') return `${n} · IQR = 0${hidden}`;
    return `${n}${hidden}`;
  };
  const nTexts = rows.map(nText);
  // At card widths an n with a qualifier ("n = 3 · too few for a box") takes two lines
  // where one would leave the value run under MIN_VALUE_RUN and the rows hold two lines.
  const nSplit = nTexts.map((text) => {
    const at = text.indexOf(' · ');
    return at < 0 ? [text] : [text.slice(0, at), text.slice(at + 3)];
  });
  const nWidth = (lines: readonly string[]) => Math.max(...lines.map((line) => measure(line, tickFont).width));
  let nLines = nTexts.map((text) => [text]);
  let nBandTotal = labelsOff ? 0 : maxOf(nTexts.map((text) => measure(text, tickFont).width)) + N_BAND_GAP;

  // the n column gave way to the name column; the name column may take 30%.
  const catCap = Math.max(24, plot0.w * 0.3);
  // N UNDER THE NAME. The n of a row is a second, muted line
  // under its name, so it sits next to the row it counts and the far-right
  // column's width goes to the plot. A qualifier ("n = 3 · too few for a box")
  // takes its own line there; an n that still does not fit the name column
  // keeps the right-hand column.
  const nFont: FontSpec = { family: theme.type.family, ...theme.type.footnote };
  const nLineH = nFont.size * (nFont.lineHeight ?? 1.2);
  const underLines = nTexts.map((text, index) => (measure(text, nFont).width <= catCap ? [text] : nSplit[index]!));
  const underW = Math.max(0, maxOf(underLines.flat().map((line) => measure(line, nFont).width)));
  const catBand = rowLabelBand(rows, tickFont, catCap, availH / rows.length >= 30 ? 2 : 1, lineH, measure, {
    wider: gutterBudget(24, plot0.w),
    shrink: stepDownFont(theme, tickFont, 'axis', options.target, textScaleOf(options)),
    target: options.target, textScale: textScaleOf(options),
    typeRole: 'axis',
    footnoteRefs: { count: authoredFootnoteCount(options), warnings },
  });
  const catLines = catBand.labels;
  // A frame too short for a name and its n on two lines keeps n in the right-hand column.
  const underFits = catLines.every((label, index) => label.h + underLines[index]!.length * nLineH + 2 <= availH / rows.length);
  const nUnder = !labelsOff && labelOn('category') && underW <= catCap && underFits;
  if (nUnder) {
    nLines = underLines;
    nBandTotal = 0;
  }
  const underH = (index: number) => (nUnder ? nLines[index]!.length * nLineH : 0);
  // Under a new target every row keeps the line box of its name and
  // its n, and with boxValues 'all' the gap the value lines above and under
  // the box want at the band's padding cap, so a short frame grows or
  // refuses instead of hiding them. The cap lets that gap take 80% of a row:
  // the larger type would otherwise need far taller rows.
  const paddingCap = 0.8;
  if (labelOn('category') || !labelsOff) {
    const statsNeed = options.boxValues === 'all' && labelOn('point') ? (2 * valueLabelH + 10) / paddingCap : 0;
    const rowsNeed = rows.length * Math.max(statsNeed, Math.max(lineH, maxOf((labelOn('category') ? catLines.map((label, index) => label.h + underH(index)) : []))) + 2);
    const rawH = plot0.h - topPad - axisH;
    frameResult.frame.plotMinHeight = Math.max(frameResult.frame.plotMinHeight ?? 0, size.height + (frameResult.deficit ?? 0) - rawH + rowsNeed);
  }
  const catBandW = labelOn('category') ? Math.max(catBand.width, nUnder ? underW : 0) : 0;
  const catBandTotal = labelOn('category') ? catBandW + CAT_BAND_GAP : 0;
  // The rows grow to hold the second line of a wrapped n.
  const nWraps = !nUnder && !labelsOff && nSplit.some((lines) => lines.length > 1);
  const nFloorTotal = nWraps ? maxOf(nSplit.map(nWidth)) + N_BAND_GAP : nBandTotal;
  if (nWraps && plot0.w - catBandTotal - nBandTotal - bracketRoom < MIN_VALUE_RUN) {
    nLines = nSplit;
    nBandTotal = nFloorTotal;
    const rawH = plot0.h - topPad - axisH;
    frameResult.frame.plotMinHeight = Math.max(frameResult.frame.plotMinHeight ?? 0, size.height + (frameResult.deficit ?? 0) - rawH + rows.length * (2 * lineH + 4));
  }
  // The parked value takes the room of its label at the plot's right end.
  // It reads in the tick row, as a tick: the axis format.
  const parkLabel = parked === undefined ? '' : axisFmt(parked);
  const parkRoom = parked === undefined ? 0 : PARK_GAP + Math.max(POINT_R, measure(parkLabel, tickFont).width / 2);

  // DENSE ROWS. A row too low to hold its median over the box (label height + 19 px) would push
  // the median to a whisker end or beside a dot, where it reads as that mark's value. Such rows print
  // every median right-aligned in one column beside n, under the head Median.
  const denseRows = availH / rows.length < valueLabelH + MEDIAN_OFFSET + MEDIAN_CLEAR + 8;
  const medianRows = rows.filter((row) => row.median !== null && row.state !== 'points');
  // The column shows only where the value run keeps MIN_VALUE_RUN beside it; a narrower frame keeps
  // the seats by the box, so no size that drew before refuses.
  const medianWanted = denseRows && labelOn('point') && options.boxValues !== 'all' && medianRows.length > 0;
  const headFont = columnHeadFont(theme, options.target ?? DEFAULT_TARGET, textScaleOf(options));
  const medianBodyW = medianWanted ? maxOf(medianRows.map((row) => measure(fmtMedian(row.median!), labelFont).width)) : 0;
  const medianHeadFit = medianWanted ? fitHead('Median', headFont, medianBodyW, measure, { target: options.target ?? DEFAULT_TARGET, textScale: textScaleOf(options) }) : undefined;
  const medianColW = medianHeadFit ? Math.max(medianHeadFit.w, medianBodyW) + N_BAND_GAP : 0;
  const medianCol = medianWanted && plot0.w - catBandTotal - nBandTotal - medianColW - bracketRoom - parkRoom >= MIN_VALUE_RUN;
  const medianHead = medianCol ? medianHeadFit : undefined;
  const medianColRight = plot0.x + plot0.w - nBandTotal;
  const medianColTotal = medianCol ? medianColW : 0;
  nBandTotal += medianColTotal;

  // A box chart is a row form. Its narrowest canvas holds the name column, the n column,
  // the bracket room and a value run of 80 px, beside the chrome around the plot.
  const sizingFor = (room: number) => bandSizing('box', size, plot0.w, NATURAL_BAND_STEP, catBandTotal + nFloorTotal + room + parkRoom + MIN_VALUE_RUN);

  const plot: Rect = {
    x: plot0.x + catBandTotal,
    y: plot0.y + topPad,
    w: Math.max(20, plot0.w - catBandTotal - nBandTotal - bracketRoom),
    h: availH,
  };
  const [dLo, dHi] = niceDomain(rawLo, rawHi, 5, {
    dataExtent: [rawLo, rawHi],
    // Two-sided domain: the SUM of both wastes is bounded by the 0.80
    // envelope floor (1 − 0.80); per-side stays at the 0.15 headroom cap.
    maxWasteFraction: 0.15,
    maxTotalWasteFraction: 0.2,
    preserveDataSideOfZero: true,
  });
  // The scale range is inset by the point radius so a dot sitting exactly on
  // the domain edge is still painted inside the plot rect.
  // A parked value keeps its strip inside the plot rect, right of the value scale.
  const scaleEnd = plot.x + plot.w - parkRoom;
  const range: [number, number] = [plot.x + POINT_R, scaleEnd - (parked === undefined ? POINT_R : 0)];
  const activeBreak = boxAxisBreak(options.valueAxis?.break, [dLo, dHi], drawnValues, rows, options.valueAxis?.show !== false, warnings);
  const x = activeBreak ? brokenLinearScale([dLo, dHi], range, activeBreak) : linearScale([dLo, dHi], range);
  const parkX = scaleEnd + PARK_GAP;
  /** Painted x of a dot: the parked value sits in its strip, every other value on the scale. */
  const xp = (value: number): number => (parked !== undefined && value === parked ? parkX : x(value));

  // Row height is DERIVED from the furniture it must carry, which is the one
  // structural deviation from football-field's authored `bandFraction`: the
  // median value label needs guaranteed clearance above every box.
  const step = plot.h / rows.length;
  // 'all' prints a line of statistics under each box, so the gap also holds that line.
  const allValues = options.boxValues === 'all' && labelOn('point');
  // A median label sits 1 px over its own box and keeps MEDIAN_CLEAR px to the box above,
  // so it reads as its own box's figure.
  const wantedGap = labelOn('point') ? valueLabelH + (MEDIAN_OFFSET + MEDIAN_CLEAR) + (allValues ? valueLabelH + 4 : 0) : Math.max(6, step * 0.3);
  const paddingInner = Math.min(paddingCap, Math.max(0.18, wantedGap / Math.max(step, 1)));
  const band = bandScale(rows.length, [plot.y, plot.y + plot.h], {
    paddingInner,
    paddingOuter: paddingInner / 2,
  });

  const nodes: SceneNode[] = [...frameResult.nodes];
  const axes: Geometry['axes'] = [];
  if (axisShown) {
    const axis = layoutValueAxis(
      {
        scale: x,
        plot,
        orient: 'x',
        // A value run under 320 px reads three figures, not five.
        ...(scaleEnd - plot.x < 320 ? { tickCount: 3 } : {}),
        gridlines: options.valueAxis?.gridlines ?? false,
        format: axisFmt,
        ...(scaled ? { formatSpec: scaled.spec } : {}),
        theme,
        measure,
        canvasWidth: size.width,
      },
      occupied,
    );
    if (parked === undefined) nodes.push(...axis.nodes);
    else {
      // The parked value prints its own figure on the tick row; a scale tick
      // whose figure would touch it gives way (its gridline stays).
      const parkSize = measure(parkLabel, tickFont);
      const parkRect: Rect = { x: parkX - parkSize.width / 2, y: plot.y + plot.h + 6, w: parkSize.width, h: parkSize.height };
      const dropped = new Set<string>();
      for (const node of axis.nodes) {
        if (node.t !== 'text' || node.part !== 'tick') continue;
        const w = Math.max(...node.lines.map((line) => measure(line, tickFont).width));
        if (node.x < parkRect.x + parkRect.w + 6 && node.x + w > parkRect.x - 6) dropped.add(node.id);
      }
      nodes.push(...axis.nodes.filter((node) => !dropped.has(node.id)));
      for (const tick of axis.axis.ticks) if (tick.labelId && dropped.has(tick.labelId)) tick.labelId = undefined;
      nodes.push({
        t: 'text', id: 'axis:x:tick:parked', x: parkRect.x, y: parkRect.y, lines: [parkLabel],
        align: 'start', font: tickFont, ink: { token: 'inkMuted' }, owner: {}, part: 'tick', typeRole: 'axis',
      });
      occupied.claim(parkRect, 'axis', {});
      // The break mark where the value scale ends, as an authored axis break draws it.
      const glyph = straightBreakGlyph(theme, { x: scaleEnd + BREAK_W / 2, y: plot.y + plot.h }, 'axis:x:break', {}, { token: 'axis' });
      nodes.push(...glyph.nodes);
      occupied.claim(glyph.rect, 'axis', {}, 'axisBreak');
      axis.axis.break = { rect: glyph.rect, style: 'straight', nodeIds: glyph.nodeIds };
    }
    axes.push(axis.axis);
  }

  // ---- marks: every one claims BEFORE the solver runs ----------------------
  const marks: BoxMarks = { rows: [] };
  const labelRequests: LabelRequest[] = [];
  const firstMedianRow = rows.findIndex((row) => row.median !== null && row.state !== 'points');
  // 20 px boxes on cards, 22 px at 720, 24 px from 900.
  const boxH = Math.min(band.bandwidth, size.width >= 900 ? 24 : size.width >= 640 ? 22 : 20);
  const capH = Math.max(4, boxH * CAP_FRACTION);
  /**
   * DODGE LANES (the fix for the fused tail chain).
   *
   * One mark per distinct value is not enough at tail density: 12 distinct
   * deciles inside 40px of axis drew 5px circles 3.6px apart, which fuses into
   * a chain that reads as a decorative spring rather than as twelve
   * observations. Points therefore get a VERTICAL lane when their painted
   * circles would overlap horizontally. The value is encoded on x alone, so a
   * vertical offset moves no dot away from its value — this is a dot-density
   * (beeswarm) column, not jitter, and it stays deterministic.
   *
   * Lanes alternate around the row centre (0, +1, -1, +2, ...) and are bounded
   * by the row band, so a dodged point can never leave its lane or collide with
   * a neighbouring row.
   */
  const maxLane = Math.max(0, Math.floor((band.bandwidth / 2 - POINT_R) / LANE_PITCH));
  const laneOffset = (lane: number): number =>
    (lane % 2 === 1 ? 1 : -1) * Math.ceil(lane / 2) * LANE_PITCH;
  /** Assign each point (ascending in painted x) the lowest non-colliding lane. */
  const assignLanes = (xs: number[]): { lanes: number[]; collided: number } => {
    const lastX: number[] = [];
    const lanes: number[] = [];
    let collided = 0;
    for (const cx of xs) {
      let chosen = -1;
      for (let lane = 0; lane <= maxLane; lane += 1) {
        if (lastX[lane] === undefined || cx - lastX[lane]! >= POINT_R * 2) {
          chosen = lane;
          break;
        }
      }
      if (chosen === -1) {
        // The band cannot hold this density. Take the lane with the most room
        // and COUNT it — an unavoidable overlap is still reported, never
        // silently painted as if it were fine.
        chosen = 0;
        for (let lane = 1; lane <= maxLane; lane += 1) {
          if (lastX[lane]! < lastX[chosen]!) chosen = lane;
        }
        collided += 1;
      }
      lastX[chosen] = cx;
      lanes.push(chosen);
    }
    return { lanes, collided };
  };
  let dodgedPoints = 0;
  let totalPoints = 0;
  // Quartile labels sit inside the boxes only where every box has room for
  // both, so all rows read the same way; otherwise all go under their boxes.
  const quartileFits = (row: (typeof rows)[number], stat: 'q1' | 'q3'): boolean => {
    const value = row[stat];
    if (value === null || row.median === null) return true;
    const width = measure(fmt(value), labelFont).width;
    return stat === 'q1' ? x(value) + 3 + width < x(row.median) - 3 : x(value) - 3 - width > x(row.median) + 3;
  };
  const quartilesInside = rows.every((row) => row.state !== 'box' || (quartileFits(row, 'q1') && quartileFits(row, 'q3')));
  let unresolvedCollisions = 0;

  rows.forEach((row, index) => {
    const rowCenter = band.center(index);
    const rowY = rowCenter - boxH / 2;
    const owner = { categoryId: row.id };
    const rowRect: Rect = { x: plot.x, y: band.position(index), w: plot.w, h: band.bandwidth };
    const mark: BoxRowMark = {
      id: row.id,
      state: row.state,
      rect: rowRect,
      whiskerNodeIds: [],
      beyondNodeIds: [],
      observationNodeIds: [],
    };
    const isHighlighted = highlights.has(row.id);
    const boxFill = semanticPalettePaint(
      theme,
      options.palette,
      isHighlighted ? 'focus' : 'neutralLight',
    );
    const pointFill = semanticPalettePaint(
      theme,
      options.palette,
      isHighlighted ? 'focus' : 'neutralMark',
    );
    // EMPHASIS MUST NOT INVERT. The highlighted row is the row the exhibit is
    // about, and its box is filled with the dark highlight token — on which the
    // `ink` median tick all but disappears (contrast 2.3:1 on the default
    // theme). The tick is the single most important mark on the row, so it
    // takes whichever ink token actually reads on the fill it sits on. Token
    // choice only, driven by the theme's own colours — no hex in chart code.
    const medianOnFill = row.state === 'box' ? (isHighlighted ? focusColor(theme) : theme.color.neutralLight) : theme.color.background;
    const medianToken: 'ink' | 'inkInverse' =
      pickInk(medianOnFill, theme.color.ink, theme.color.inkInverse) === theme.color.ink ? 'ink' : 'inkInverse';
    const display = { state: row.state };

    if (row.state === 'box' || row.state === 'median-only') {
      const xLow = x(row.whiskerLow!);
      const xHigh = x(row.whiskerHigh!);
      const xQ1 = x(row.q1!);
      const xQ3 = x(row.q3!);

      if (xLow < xQ1) {
        const id = `box:whiskerLow:${row.id}`;
        nodes.push({
          t: 'line',
          id,
          x1: xLow,
          y1: rowCenter,
          x2: xQ1,
          y2: rowCenter,
          stroke: { token: 'neutralMark' },
          width: strokeToken(theme, 'rule'),
          owner,
          part: 'boxWhisker',
          display: { ...display, value: fmt(row.whiskerLow!) },
        });
        occupied.claim({ x: xLow, y: rowCenter - 0.5, w: xQ1 - xLow, h: 1 }, 'mark', owner, 'boxWhisker');
        const capId = `box:capLow:${row.id}`;
        nodes.push({
          t: 'line',
          id: capId,
          x1: xLow,
          y1: rowCenter - capH / 2,
          x2: xLow,
          y2: rowCenter + capH / 2,
          stroke: { token: 'neutralMark' },
          width: strokeToken(theme, 'rule'),
          owner,
          part: 'boxWhiskerCap',
          display: { ...display, value: fmt(row.whiskerLow!) },
        });
        occupied.claim(
          { x: xLow - 0.5, y: rowCenter - capH / 2, w: 1, h: capH },
          'mark',
          owner,
          'boxWhiskerCap',
        );
        mark.whiskerNodeIds.push(id, capId);
      }
      if (xHigh > xQ3) {
        const id = `box:whiskerHigh:${row.id}`;
        nodes.push({
          t: 'line',
          id,
          x1: xQ3,
          y1: rowCenter,
          x2: xHigh,
          y2: rowCenter,
          stroke: { token: 'neutralMark' },
          width: strokeToken(theme, 'rule'),
          owner,
          part: 'boxWhisker',
          display: { ...display, value: fmt(row.whiskerHigh!) },
        });
        occupied.claim({ x: xQ3, y: rowCenter - 0.5, w: xHigh - xQ3, h: 1 }, 'mark', owner, 'boxWhisker');
        const capId = `box:capHigh:${row.id}`;
        nodes.push({
          t: 'line',
          id: capId,
          x1: xHigh,
          y1: rowCenter - capH / 2,
          x2: xHigh,
          y2: rowCenter + capH / 2,
          stroke: { token: 'neutralMark' },
          width: strokeToken(theme, 'rule'),
          owner,
          part: 'boxWhiskerCap',
          display: { ...display, value: fmt(row.whiskerHigh!) },
        });
        occupied.claim(
          { x: xHigh - 0.5, y: rowCenter - capH / 2, w: 1, h: capH },
          'mark',
          owner,
          'boxWhiskerCap',
        );
        mark.whiskerNodeIds.push(id, capId);
      }

      if (row.state === 'box') {
        const id = `box:rect:${row.id}`;
        const rect: Rect = { x: xQ1, y: rowY, w: xQ3 - xQ1, h: boxH };
        nodes.push({
          t: 'rect',
          id,
          rect,
          fill: boxFill,
          // A highlighted box takes its fill as its outline.
          stroke: isHighlighted ? boxFill : { token: 'neutralMark' },
          strokeWidth: strokeToken(theme, 'mark'),
          owner,
          part: 'boxRect',
          display: { ...display, value: numberRange(fmt(row.q1!), fmt(row.q3!)) },
        });
        occupied.claim(rect, 'mark', owner, 'boxRect');
        mark.boxNodeId = id;
      }

      // The median tick paints AFTER the rect: furniture that must stay
      // readable sits above mark fills.
      const medianId = `box:median:${row.id}`;
      const medianX = x(row.median!);
      nodes.push({
        t: 'line',
        id: medianId,
        x1: medianX,
        y1: rowY,
        x2: medianX,
        y2: rowY + boxH,
        stroke: { token: medianToken, theme: { kind: 'contrast-ink', fill: row.state === 'box' ? boxFill : { token: 'background' } } },
        width: strokeToken(theme, 'mark'),
        owner,
        part: 'boxMedian',
        display: { ...display, value: fmtMedian(row.median!) },
      });
      occupied.claim(
        { x: medianX - 0.75, y: rowY, w: 1.5, h: boxH },
        'mark',
        owner,
        'boxMedian',
      );
      mark.medianNodeId = medianId;
    }

    // Observations and beyond-whisker values share the row's horizontal line,
    // so they are dodged TOGETHER — lanes assigned across both sets, ascending
    // in x, or two encodings would happily land on top of each other.
    const sortedPoints = [
      ...drawnObservations[index]!.map((point, k) => ({ point, k, kind: 'obs' as const })),
      ...drawnBeyond[index]!.map((point, k) => ({ point, k, kind: 'beyond' as const })),
    ].sort((a, b) => a.point.value - b.point.value || (a.kind === 'obs' ? -1 : 1));
    // Three or more beyond-whisker dots that touch are one group: a
    // ring over their span with its exact count, so none is lost in a blob.
    const groups: (typeof sortedPoints)[] = [];
    let run: typeof sortedPoints = [];
    const closeRun = () => { if (run.length >= GROUP_MIN) groups.push(run); run = []; };
    for (const entry of sortedPoints) {
      const last = run.at(-1);
      if (entry.kind === 'beyond' && last && xp(entry.point.value) - xp(last.point.value) < 2 * POINT_R + GROUP_GAP) run.push(entry);
      else { closeRun(); if (entry.kind === 'beyond') run = [entry]; }
    }
    closeRun();
    const grouped = new Set(groups.flat());
    const rowPoints = sortedPoints.filter((entry) => !grouped.has(entry));
    for (const [g, members] of groups.entries()) {
      const left = xp(members[0]!.point.value) - POINT_R;
      const right = xp(members.at(-1)!.point.value) + POINT_R;
      const count = members.reduce((sum, entry) => sum + entry.point.count, 0);
      const id = `box:group:${row.id}:${g}`;
      const rect: Rect = { x: left, y: rowCenter - POINT_R, w: right - left, h: 2 * POINT_R };
      nodes.push({
        t: 'rect', id, rect, radius: 0, fill: { token: 'background' }, stroke: pointFill, strokeWidth: strokeToken(theme, 'mark'), owner, part: 'boxBeyondGroup',
        display: { ...display, value: chartString(options, 'boxValuesSpan', { v1: count, v2: fmt(members[0]!.point.value), v3: fmt(members.at(-1)!.point.value) }) },
      });
      occupied.claim(rect, 'mark', owner, 'boxBeyond');
      mark.beyondNodeIds.push(id);
      const text = chartString(options, 'boxValuesCount', { v1: count });
      const size = measure(text, labelFont);
      const cx = (left + right) / 2;
      // The count sits on the row, on the outer side of its group (below the
      // median it is the far end of the row), else over or under the ring.
      const low = members[0]!.point.value < (row.median ?? 0);
      const sideXs = sortedPoints.filter((entry) => (entry.point.value < (row.median ?? 0)) === low).map((entry) => xp(entry.point.value));
      const outer = low ? Math.min(left, minOf(sideXs.map((dx) => dx - POINT_R))) - 4 - size.width : Math.max(right, maxOf(sideXs.map((dx) => dx + POINT_R))) + 4;
      labelRequests.push({
        id: `group:${row.id}:${g}`, kind: 'point', role: composedTextRole(text), owner, text, lines: [text], font: labelFont,
        priority: PRIORITY.interior,
        candidates: [
          { slot: 'besideGroup', rect: { x: outer, y: rowCenter - size.height / 2, w: size.width, h: size.height }, penalty: 0 },
          { slot: 'belowGroup', rect: { x: cx - size.width / 2, y: rect.y + rect.h + 2, w: size.width, h: size.height }, penalty: 1 },
          { slot: 'aboveGroup', rect: { x: cx - size.width / 2, y: rect.y - 2 - size.height, w: size.width, h: size.height }, penalty: 2 },
        ],
      });
    }
    const { lanes, collided } = assignLanes(rowPoints.map((entry) => xp(entry.point.value)));
    unresolvedCollisions += collided;
    // The painted extent of this row's dots, kept so the median label's own
    // candidates can be placed CLEAR of them (see the label requests below).
    const painted = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const members of groups) {
      painted.minX = Math.min(painted.minX, xp(members[0]!.point.value) - POINT_R);
      painted.maxX = Math.max(painted.maxX, xp(members.at(-1)!.point.value) + POINT_R);
      painted.minY = Math.min(painted.minY, rowCenter - POINT_R);
      painted.maxY = Math.max(painted.maxY, rowCenter + POINT_R);
    }

    rowPoints.forEach((entry, i) => {
      const { point, k, kind } = entry;
      const cx = xp(point.value);
      const cy = rowCenter + laneOffset(lanes[i]!);
      totalPoints += 1;
      if (lanes[i]! > 0) dodgedPoints += 1;
      painted.minX = Math.min(painted.minX, cx - POINT_R);
      painted.maxX = Math.max(painted.maxX, cx + POINT_R);
      painted.minY = Math.min(painted.minY, cy - POINT_R);
      painted.maxY = Math.max(painted.maxY, cy + POINT_R);
      const id = kind === 'obs' ? `box:obs:${row.id}:${k}` : `box:beyond:${row.id}:${k}`;
      const value = point.count > 1 ? `${fmt(point.value)} (×${point.count})` : fmt(point.value);
      nodes.push(
        kind === 'obs'
          ? {
              t: 'circle',
              id,
              cx,
              cy,
              r: POINT_R,
              fill: pointFill,
              owner,
              part: 'boxObservation',
              display: { ...display, value },
            }
          : {
              t: 'circle',
              id,
              cx,
              cy,
              r: POINT_R,
              fill: { token: 'background' },
              stroke: pointFill, strokeWidth: strokeToken(theme, 'mark'),
              owner,
              part: 'boxBeyond',
              display: { ...display, value },
            },
      );
      occupied.claim(
        { x: cx - POINT_R, y: cy - POINT_R, w: POINT_R * 2, h: POINT_R * 2 },
        'mark',
        owner,
        kind === 'obs' ? 'boxObservation' : 'boxBeyond',
      );
      if (kind === 'obs') mark.observationNodeIds.push(id);
      else mark.beyondNodeIds.push(id);
      // A group too small for a box prints each observation's value,
      // since there is no box or median to read it from.
      if (kind === 'obs' && row.state === 'points' && labelOn('point')) {
        const size = measure(value, labelFont);
        const at = (y: number) => ({ x: cx - size.width / 2, y, w: size.width, h: size.height });
        labelRequests.push({
          id: `obs:${row.id}:${k}`, kind: 'point', role: composedTextRole(value), owner, text: value, lines: [value],
          font: labelFont, priority: PRIORITY.interior,
          candidates: [
            { slot: 'aboveDot', rect: at(cy - POINT_R - 2 - size.height), penalty: 0 },
            { slot: 'belowDot', rect: at(cy + POINT_R + 2), penalty: 1 },
          ],
        });
      }
    });

    marks.rows.push(mark);

    // Q1 and Q3 inside the box by its edges, the whisker ends beyond
    // the caps, each on the row; under the box where the row has no room.
    if (allValues && row.state === 'box') {
      const medianX = x(row.median!);
      const stats = [['q1', row.q1, -1], ['q3', row.q3, 1], ['whiskerLow', row.whiskerLow, -1], ['whiskerHigh', row.whiskerHigh, 1]] as const;
      for (const [stat, value, outward] of stats) {
        if (value === null || (stat.startsWith('whisker') && value === (stat === 'whiskerLow' ? row.q1 : row.q3))) continue;
        const text = fmt(value);
        const size = measure(text, labelFont);
        const statX = x(value);
        const under = rowY + boxH + 4;
        const onRow = rowCenter - size.height / 2;
        const inside = stat === 'q1' ? statX + 3 : statX - 3 - size.width;
        const insideFits = quartilesInside && (stat === 'q1' ? inside + size.width < medianX - 3 : inside > medianX + 3);
        const candidates: SlotCandidate[] = [
          ...(stat.startsWith('q') && insideFits
            ? [{ slot: 'insideBox', rect: { x: inside, y: onRow, w: size.width, h: size.height }, penalty: 0, insideFill: paintColor(theme, boxFill), insidePaint: boxFill }]
            : []),
          // Beyond the cap only where no dot of the row lies, since the
          // solver lets a label sit on its own row's small marks.
          ...(() => {
            const beyond = outward < 0 ? statX - 4 - size.width : statX + 4;
            const clear = !sortedPoints.some((entry) => {
              const dotX = xp(entry.point.value);
              return dotX + POINT_R + 2 > beyond && dotX - POINT_R - 2 < beyond + size.width;
            });
            return stat.startsWith('whisker') && clear
              ? [{ slot: 'beyondCap', rect: { x: beyond, y: onRow, w: size.width, h: size.height }, penalty: 0 }]
              : [];
          })(),
          { slot: 'under', rect: { x: statX - size.width / 2, y: under, w: size.width, h: size.height }, penalty: 1 },
          { slot: 'underOutward', rect: { x: outward < 0 ? statX - size.width : statX, y: under, w: size.width, h: size.height }, penalty: 2 },
        ];
        labelRequests.push({
          id: `stat:${row.id}:${stat}`, kind: 'point', role: composedTextRole(text), owner, text, lines: [text], font: labelFont,
          priority: PRIORITY.interior, candidates,
        });
      }
    }

    // ---- label requests (still before solveLabels) -------------------------
    if (labelOn('category')) {
      const label = catLines[index]!;
      labelRequests.push({
        id: `category:${row.id}`,
        kind: 'category',
        owner,
        text: row.label,
        ...fittedLabel(label, tickFont),
        font: tickFont,
        // The n line under the name touches the name's line box by design.
        ...(nUnder ? { pad: 0 } : {}),
        priority: PRIORITY.endpoint,
        candidates: [
          {
            slot: 'left',
            rect: {
              x: rowLabelX(plot0.x, catBandW, label.w, options.rowLabels?.align ?? 'left'),
              // With n under the name, the name and its n centre on the row as one block.
              y: rowCenter - (label.h + underH(index)) / 2,
              w: label.w,
              h: label.h,
            },
            penalty: 0,
          },
        ],
      });
    }

    if (nUnder) {
      // n is mandatory furniture: under its row name, priority in the
      // required band so a hidden n is a warn, never a quiet omission.
      const text = nTexts[index]!;
      const lines = nLines[index]!;
      const width = Math.max(...lines.map((line) => measure(line, nFont).width));
      const label = catLines[index]!;
      const align = options.rowLabels?.align ?? 'left';
      labelRequests.push({
        id: `boxN:${row.id}`,
        kind: 'annotation', role: composedTextRole(text, 'note'),
        owner,
        text,
        lines,
        ...(align === 'right' ? { align: 'end' as const } : {}),
        font: nFont, typeRole: 'footnote',
        pad: 0,
        priority: PRIORITY.valueLine,
        candidates: [
          {
            slot: 'underName',
            rect: {
              x: rowLabelX(plot0.x, catBandW, width, align),
              y: rowCenter - (label.h + underH(index)) / 2 + label.h,
              w: width,
              h: underH(index),
            },
            penalty: 0,
          },
        ],
      });
    } else if (!labelsOff) {
      // n is mandatory furniture: its own reserved column, priority in the
      // required band so a hidden n is a warn, never a quiet omission.
      const text = nTexts[index]!;
      const lines = nLines[index]!;
      const textSize = lines.length === 1 ? measure(text, tickFont) : { width: nWidth(lines), height: lines.length * lineH };
      labelRequests.push({
        id: `boxN:${row.id}`,
        kind: 'annotation', role: composedTextRole(text, 'note'),
        owner,
        text,
        lines,
        ...(lines.length > 1 ? { align: 'end' as const } : {}),
        // Dense rows touch line box to line box, as the median column beside them does.
        ...(denseRows ? { pad: 0 } : {}),
        font: tickFont,
        priority: PRIORITY.valueLine,
        candidates: [
          {
            slot: 'rowEnd',
            rect: {
              // Right-aligned on the canvas edge: a ragged right margin on a
              // furniture column reads as drift.
              x: plot0.x + plot0.w - textSize.width,
              y: rowCenter - textSize.height / 2,
              w: textSize.width,
              h: textSize.height,
            },
            penalty: 0,
          },
        ],
      });
    }

    if (labelOn('point') && row.median !== null && row.state !== 'points') {
      // The first figure names the statistic, as a first tick names its unit:
      // a bare number above a box reads as anything from a mean to a total.
      const text = `${index === firstMedianRow && !medianCol ? 'Median ' : ''}${fmtMedian(row.median)}`;
      const textSize = measure(text, labelFont);
      const medianX = x(row.median);
      // EVERY candidate clears this row's OWN dots.
      // The shared solver lets a label sit on a mark owned by the same row —
      // legitimate for a wide rect, fatal for a 5px circle, which a digit
      // erases completely. `outsideHigh` was anchored at the whisker end, which
      // is exactly where the beyond-whisker dots begin, so the label routinely
      // landed on top of the very observations it was next to. The solver
      // cannot fix that for me; the candidate rects can, so they do.
      const hasPoints = painted.maxX > -Infinity;
      const clearHigh = Math.max(row.whiskerHigh === null ? medianX : x(row.whiskerHigh), hasPoints ? painted.maxX : -Infinity);
      const clearLow = Math.min(row.whiskerLow === null ? medianX : x(row.whiskerLow), hasPoints ? painted.minX : Infinity);
      const clearTop = Math.min(rowY, hasPoints ? painted.minY : Infinity);
      const clearBottom = Math.max(rowY + boxH, hasPoints ? painted.maxY : -Infinity);
      labelRequests.push({
        id: `median:${row.id}`,
        kind: 'point', role: composedTextRole(text),
        owner,
        text,
        lines: [text],
        font: labelFont,
        priority: PRIORITY.endpoint,
        ...(medianCol ? { pad: 0 } : {}),
        candidates: medianCol ? [{
          slot: 'medianColumn',
          rect: { x: medianColRight - textSize.width, y: rowCenter - textSize.height / 2, w: textSize.width, h: textSize.height },
          penalty: 0,
        }] : [
          {
            slot: 'aboveMedian',
            rect: {
              x: medianX - textSize.width / 2,
              y: clearTop - textSize.height - MEDIAN_OFFSET,
              w: textSize.width,
              h: textSize.height,
            },
            penalty: 0,
          },
          {
            slot: 'belowMedian',
            rect: {
              x: medianX - textSize.width / 2,
              y: clearBottom + 3,
              w: textSize.width,
              h: textSize.height,
            },
            penalty: 1,
          },
          {
            slot: 'outsideHigh',
            rect: {
              x: clearHigh + LABEL_GAP,
              y: rowCenter - textSize.height / 2,
              w: textSize.width,
              h: textSize.height,
            },
            penalty: 2,
          },
          {
            slot: 'outsideLow',
            rect: {
              x: clearLow - LABEL_GAP - textSize.width,
              y: rowCenter - textSize.height / 2,
              w: textSize.width,
              h: textSize.height,
            },
            penalty: 3,
          },
        ],
      });
    }
  });

  if (medianHead) {
    const headH = measure('0', headFont).height;
    labelRequests.push(headRequest('median', 0, medianHead, medianColRight, plot.y - headH - 2, headH, false));
  }
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 2,
  });
  if (axisTitle) {
    labelRequests.push(valueAxisTitleRequest(axisTitle, { x: plot.x + plot.w, y: plot.y + plot.h + 6 + measure('0', tickFont).height + 2 }, 'end', 'axis:x:title'));
  }
  solveCtx.valueRows = ['median', 'q1', 'q3', 'whiskerLow', 'whiskerHigh'].map(stat => ({
    ids: labelRequests.filter(request => stat === 'median' ? request.id.startsWith('median:')
      : request.id.startsWith('stat:') && request.id.endsWith(`:${stat}`)).map(request => request.id),
  }));
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  applyValueAxisTitleInk(solved.placed);
  // The n under a row name is muted furniture, as the tick figures are.
  for (const label of solved.placed) if (nUnder && label.id.startsWith('boxN:') || label.id.startsWith(HEAD_PREFIX)) label.ink = { token: 'inkMuted' };
  pushAll(warnings, solved.warnings);
  const labelNodes = labelsToNodes(theme, solved.placed, (label) => (label.kind === 'point' ? labelFont : label.id.startsWith(HEAD_PREFIX) ? headFont : nUnder && label.id.startsWith('boxN:') ? nFont : tickFont));
  asColumnHeads(labelNodes);
  pushAll(nodes, labelNodes);

  // A dodge that ran out of band is the one case where two dots still touch.
  // Severity follows the label solver's own convention (`label-hidden` is warn
  // for a required label, info otherwise): NOTHING is removed here — every
  // point is still painted, and a saturated band reads as density, which is
  // true. So this is a legibility disclosure, not a hidden-data suppression. The count
  // is given so an agent can act on it rather than guess.
  if (unresolvedCollisions > 0) {
    warnings.push({
      code: 'box-points-dense',
      severity: 'info',
      message: `${unresolvedCollisions} of ${totalPoints} point marks could not be given a clear lane within the row band; they are painted but touch, so individual values cannot be counted off the exhibit`,
      suggest: 'give the exhibit more height, show fewer groups, or use a histogram for the shape',
    });
  }

  const derived: BoxDerived = {
    method: METHOD_BY_RULE[whiskerRule],
    whiskerRule,
    beyondMeaning: chartString(options, ({ tukey: 'boxBeyondMeaningtukey', minmax: 'boxBeyondMeaningminmax', p10p90: 'boxBeyondMeaningp10p90' } as const)[whiskerRule]),
    beyondAreOutliers: BEYOND_ARE_OUTLIERS[whiskerRule],
    withheldBeyond,
    groupOrder: rows.map((row) => row.id),
    groups: rows,
  };

  return annotateBox({
    type: 'box',
    size,
    sizing: sizingFor(bracketRoom),
    plot,
    scene: nodes,
    labels: solved.placed,
    axes: [
      {
        axis: 'y',
        ticks: rows.map((row, index) => ({
          at: row.id,
          pos: band.center(index),
          labelId: labelOn('category') ? `category:${row.id}` : undefined,
        })),
      },
      ...axes,
    ],
    annotations: [],
    frame: frameResult.frame,
    marks,
    derived,
    a11y: {
      titleCounts: [structureCount('groups', rows.length, undefined, options)],
      title: accessibleTitle(options.title, chartString(options, 'boxTitle', { v1: rows.length })),
      counts: [...rows.flatMap(row => row.state === 'empty' ? [] : [
          structureCount('observations', row.n, `n = ${row.n}`),
          ...(row.state !== 'points' && row.beyondWhiskers.length ? [structureCount('observations', row.beyondWhiskers.length, `${row.beyondWhiskers.length} ${chartString(options, ({ tukey: 'boxBeyondNountukey', minmax: 'boxBeyondNounminmax', p10p90: 'boxBeyondNounp10p90' } as const)[whiskerRule])}`)] : []),
        ]),
        ...(withheldTotal > 0 ? [structureCount('observations', withheldTotal, chartString(options, 'boxWithheldCount', { v1: withheldTotal }))] : [])],
      desc:
        chartString(options, 'boxDescStart', { v1: METHOD_BY_RULE[whiskerRule] }) +
        rows.map((row) => describeRow(row, fmt, fmtMedian, whiskerRule, options)).join(' ') +
        chartString(options, 'boxRuleDesc', { v1: whiskerRule, v2: chartString(options, ({ tukey: 'boxBeyondMeaningtukey', minmax: 'boxBeyondMeaningminmax', p10p90: 'boxBeyondMeaningp10p90' } as const)[whiskerRule]) }) +
        (withheldTotal > 0
          ? chartString(options, 'boxWithheldDesc', { v1: withheldTotal })
          : ''),
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: solved.decisions,
    },
  }, data, options, {
    occupied, theme, measure, solveCtx, xScale: x,
    bracketRight: plot.x + plot.w + BRACKET_CLEAR,
    wrapLead,
    // The floor holds the brackets at their narrowest: wrapped where they can wrap.
    bracketFloor: (reach) => sizingFor(reach + BRACKET_CLEAR),
    // A bracket that reaches into the n column takes its width from the plot, once.
    relayout: bracketRoom > 0 ? undefined : (reach) => {
      const free = plot0.x + plot0.w - nBandTotal - (plot.x + plot.w + BRACKET_CLEAR);
      if (reach <= free) return undefined;
      // Where the bracket on one line would leave the value run under MIN_VALUE_RUN,
      // its named span takes its own line ("Median FY21–FY23:" / "+20.0% p.a.").
      if (!wrapLead && plot0.w - catBandTotal - nBandTotal - reach - BRACKET_CLEAR < MIN_VALUE_RUN) return layoutBox(data, options, 0, true);
      return layoutBox(data, options, reach + BRACKET_CLEAR, wrapLead);
    },
  });
}

function describeRow(
  row: BoxGroupDerived,
  fmt: (value: number) => string,
  fmtMedian: (value: number) => string,
  rule: WhiskerRule,
  options: BoxOptions,
): string {
  if (row.state === 'empty') return chartString(options, 'emptyBoxRow', { v1: row.label });
  if (row.state === 'points') {
    return chartString(options, 'pointsBoxRow', { v1: row.label, v2: row.n, v3: fmt(row.min!), v4: fmt(row.max!), v5: fmtMedian(row.median!) });
  }
  // The noun follows the RULE. Under p10p90 these are the outer deciles, and
  // reading them out as "outliers" would tell a screen-reader user the sample
  // has outliers when it has none.
  const beyond =
    row.beyondWhiskers.length === 0 ? '' : `, ${row.beyondWhiskers.length} ${chartString(options, ({ tukey: 'boxBeyondNountukey', minmax: 'boxBeyondNounminmax', p10p90: 'boxBeyondNounp10p90' } as const)[rule])}`;
  if (row.state === 'median-only') {
    return chartString(options, 'medianBoxRow', { v1: row.label, v2: row.n, v3: fmtMedian(row.median!), v4: beyond });
  }
  return chartString(options, 'fullBoxRow', { v1: row.label, v2: row.n, v3: fmt(row.q1!), v4: fmtMedian(row.median!), v5: fmt(row.q3!), v6: fmt(row.whiskerLow!), v7: fmt(row.whiskerHigh!), v8: beyond });
}

