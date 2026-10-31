import { stringFields } from '../../strings';
/**
 * Standard bar phase 1, frame and scale: the legend and the frame, then the
 * category band, the plot rect, the value scale with its break, the row band
 * and the value-label policy.
 */

import { BAND_PAD } from '../../annotateParts';
import { axisTitleAllowed, planValueAxisTitle, tickRowTitleEnd, valueAxisTitleText, valueAxisUnit } from '../../axis';
import { authoredNotes, cappedItems, frameTextOptions, normalizeLegendOption, plotHeightAfter, solveFrame, type FrameInput, type FrameResult, type LegendItemInput, authoredFootnoteCount } from '../../frame';
import type { Rect } from '../../geometry';
import { dedupeLegendKeys, scenarioLegendKeys } from '../../label/legendFidelity';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { gutterBudget, stepDownFont } from '../../label/rowFit';
import { rowLabelBand } from '../../label/rowLabels';
import { categoryCutLint } from '../../label/categoryRow';
import { partialAxisWords, partialFootnotes, partialLegendKeys, partialPattern, saysToDate } from '../../partialPeriod';
import { axisBreakInvalid } from '../../axisBreakInvalid';
import { axisBreakHeightOrderWarning } from '../../axisBreakOrder';
import { breakStyleRefusal, stackBreakReversesOrder } from '../band/breakOrder';
import { bandScale, brokenLinearScale, invalidLinearBreakReason, linearScale, niceDomain, type LinearBreak } from '../../scale';
import { resolveSize } from '../../normalize/shared';
import { COLLECT_IDENTITIES } from '../../seriesIdentity';
import { defaultMeasurer, type FontSpec } from '../../text';
import { canvasMargin, panelTypeClass, emphasisWeight, resolveTheme, strokeToken, dashToken, themeForWidth } from '../../theme';
import type { BarOptions, LegendOptions } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import { groupedOffsets } from '../band/groups';
import { netLineName } from '../band/stacks';
import { referenceMarkerKey } from '../band/ticks';
import { compactValueLabelFont, compactValueTextSize, groupedValueLabelPolicy, INSIDE_MIN_H } from '../band/labels';
import { partialNamedOnValues, textFor } from './domain';
import { labelOn } from '../labelOn';
import { bandSteps, EXACT_DOMAIN, NO_NAME_COLUMN, cagrInset, CAGR_INSET_ROOM, CAGR_ROOM, CAT_BAND_GAP, CAT_MAX_LINES, CUT_NOTES, fixedBarRow, LABEL_GAP, RIGHT_ROOM, type BarArea, type BarDomain } from './model';
import type { BarLegendPaints } from './paints';
import { signPaint } from '../band/sign';
import { referenceLabelText, SHARE_ROW_SWATCH } from './labels';
import { textScaleOf } from '../../typeFloors';
import { disclosureNote, disclosuresShown } from '../../notes';
import { HARD_MINIMUM } from '../../sizing';
import { maxOf, pushAll } from '../../arrays';

function buildLegend(domain: BarDomain, paints: BarLegendPaints, warnings: LintWarning[]): FrameInput['legend'] {
  const { options, cats, dataSeries, refSeries, referenceStyle, uniformScenario } = domain;
  // The sign colour is an encoding, so it brings its own legend, and dropping
  // that legend is disclosed, as on column.
  const signColor = options.signColor === true;
  // A drawn reference (a PY tick, a plan dot) is an encoding too: it brings its key, in its shape.
  // A grid panel leaves its key to the grid legend, which collects it.
  const referenceDrawn = domain.variant !== 'stacked100' && panelTypeClass(options) === undefined &&
    refSeries.some((s) => s.cells.some((cell) => cell.v !== null));
  if ((signColor || referenceDrawn) && options.legend === 'none') {
    warnings.push({
      code: 'legend-suppressed-encoding',
      severity: 'warn',
      message: `legend: 'none' suppressed the only key naming this exhibit's encodings (${signColor ? 'sign colour' : 'the reference mark'}), so the reader is left to infer them`,
      suggest: `drop legend: 'none', or drop ${signColor ? 'signColor' : 'the reference series'}`,
    });
  }
  // The net line's ticks stand one per row with no line to label at an end: the key names them.
  const netLineKeyed = domain.netLineOn && panelTypeClass(options) === undefined;
  const l = options.legend ?? (signColor || referenceDrawn || netLineKeyed ? 'top' : undefined);
  if (!l || l === 'none' || l === 'auto') return undefined;
  const legendOptions: LegendOptions = normalizeLegendOption(l);
  // A sign-coloured series gets the two keys it paints, each naming its polarity in words.
  const seriesItems: LegendItemInput[] = signColor
    ? dataSeries.flatMap((s) => [true, false].map((above) => ({
        id: `${s.id}:${above ? 'above' : 'below'}`,
        label: stringFields(above ? options.strings!.aboveZero! : options.strings!.belowZero!, { series: s.label, meaning: above === (s.direction !== 'lowerIsBetter') ? options.strings!.better! : options.strings!.worse! }),
        paint: signPaint(s, above ? 1 : -1, options.colorblindSafe),
      })))
    : dataSeries.map((s) => {
        // A series whose every drawn bar looks the same is keyed in that look, hatch included.
        const looks = s.cells.flatMap((cell, ci) => (cell.v === null ? [] : [paints.cell(s, cats[ci]!, cell.meta, cell.v)]));
        const first = looks[0];
        if (first && looks.every((look) => look.pattern === first.pattern && look.outline === first.outline &&
          paints.css(look.paint, look.pattern) === paints.css(first.paint, first.pattern))) {
          return { id: s.id, label: s.label, paint: first.paint, pattern: first.pattern };
        }
        if (uniformScenario.size > 0) {
          return { id: s.id, label: s.label, paint: paints.identity(s) };
        }
        const { paint, pattern } = paints.scenario(s, '', null);
        return { id: s.id, label: s.label, paint, pattern };
      });
  /**
   * Every pattern the CELLS will paint. The series keys above call
   * `barPaint(s, '', null)` — no category, no cell meta — so a per-cell
   * `scenario: 'FC'` is invisible to them, and `uniformScenario`
   * drops the pattern outright because the series identity is what the key
   * must carry. Both are right for the SERIES key and both leave the hatch
   * unnamed, so the scenario gets a key of its own, from the same predicate
   * the marks use over the same cells the emit guards admit (non-null, in
   * both the grouped and the stacked branch).
   */
  const paintedCellPatterns = dataSeries.flatMap((s) =>
    s.cells.flatMap((cell, ci) =>
      cell.v === null ? [] : [paints.scenario(s, cats[ci]?.id ?? '', cell.meta).pattern],
    ),
  );
  // A plan row drawn in its series fills with a heavy ink outline (a
  // uniform PL row) is the plan notation too, keyed in that treatment.
  const planOutlined = dataSeries.some((s) => s.cells.some((cell, ci) =>
    cell.v !== null && paints.scenario(s, cats[ci]?.id ?? '', cell.meta).outline === true));
  const partialHatchPainted = dataSeries.some((s) =>
    s.cells.some((cell, ci) => {
      if (cell.v === null || !cats[ci]?.partial) return false;
      const { pattern, outline } = paints.scenario(s, cats[ci]!.id, cell.meta);
      return partialPattern(cats[ci], pattern, outline) !== pattern;
    }),
  );
  let items: LegendItemInput[] = [
    ...seriesItems,
    // In the subtitle's order, AC PY PL FC: the plan row before the forecast hatch.
    ...(domain.variant !== 'stacked100'
      ? refSeries.map((s) => ({
          id: s.id,
          label: s.label,
          paint: paints.reference(),
          // The key draws the reference as the bar crosses it: a vertical tick, a dashed rule, a ringed dot.
          key: referenceStyle === 'tick' ? ('tick' as const) : ('line' as const),
          ...(referenceStyle === 'line' ? { dash: dashToken(domain.theme, 'dotted'), lineCap: 'round' as const, width: strokeToken(domain.theme, 'rule') } : {}),
          ...(referenceStyle === 'tick' ? { width: domain.referenceTick.width } : {}),
          ...(referenceStyle === 'marker' ? referenceMarkerKey(domain.theme, paints.reference()) : {}),
        }))
      : []),
    ...(domain.netLineOn ? [{
      id: '__netLine',
      label: netLineName(dataSeries, domain.netLineSeries, domain.stacks, options.strings),
      paint: { token: 'markInk' } as const,
      key: 'tick' as const,
      width: strokeToken(domain.theme, 'data'),
    }] : []),
    ...(planOutlined ? [{ id: '__scenarioPLRow', label: options.strings!.plan!, paint: { token: 'background' } as const, stroke: { token: 'ink' } as const, width: domain.theme.pattern.outlineStrokeWidth }] : []),
    ...scenarioLegendKeys({
      markPatterns: paintedCellPatterns,
      keyPatterns: seriesItems.map((item) => item.pattern),
      paint: { token: 'neutralMark' }, strings: domain.options.strings,
    }),
    ...partialLegendKeys(partialHatchPainted && !partialNamedOnValues(domain), options.strings, cats),
  ];
  /**
   * Two keys a reader cannot tell apart are one key that wasted the width of
   * two. `likert` reaches this legend through `layoutBar` with its split
   * neutral emitted as TWO series — one response option, two segments
   * meeting at the centre line — so a five-point scale printed six keys, two
   * of them the same grey under the same name. Collapsing on rendered
   * appearance AND label leaves palette-exhausted same-colour series (which
   * carry different names) untouched.
   */
  const deduped = dedupeLegendKeys(items, (item) => paints.css(item.paint, item.pattern));
  items = deduped.items;
  if (legendOptions.order) {
    const rank = new Map(legendOptions.order.map((id, i) => [id, i]));
    items = [...items].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return { options: legendOptions, items };
}

/** The frame (title, subtitle, legend, source measured FIRST); claims into its own index. */
export function solveBarFrame(domain: BarDomain, paints: BarLegendPaints, warnings: LintWarning[]): { frame: FrameResult; claims: OccupiedIndex } {
  const { options, theme, size, measure, cats } = domain;
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const legend = buildLegend(domain, paints, warnings);
  const frame = solveFrame(
    {
      size,
      margin: { ...canvasMargin(theme, size.width), ...options.margin },
      ...frameTextOptions(options),
      footnotes: [...partialFootnotes(cats, options.strings, legend?.items.some(item => item.id === '__partial') || partialNamedOnValues(domain)),
        ...(domain.variant === 'stacked' && domain.incompleteRows.size ? [disclosureNote(stringFields(options.strings!.incompleteStacks!, {
          categories: cappedItems(cats.filter(c => domain.incompleteRows.has(c.id)).map(c => c.label ?? c.id), options).join(', '),
        }))] : []),
        ...(domain.variant === 'stacked100' && cats.some(c => c.total100 === undefined && domain.incompleteRows.has(c.id))
          ? [disclosureNote(stringFields(options.strings!.knownPartsShares!, {
            categories: cappedItems(cats.filter(c => c.total100 === undefined && domain.incompleteRows.has(c.id)).map(c => c.label ?? c.id), options).join(', '),
          }))] : []),
        ...authoredNotes(options), ...((options as { [CUT_NOTES]?: string[] })[CUT_NOTES] ?? []), ...domain.shareNotes],
      legend,
      theme,
      measure,
    },
    claims,
  );
  return { frame, claims };
}

/** The least a standard bar reserves above its value-axis row in the plot band: its top annotation strip (barPlotArea). */
const MIN_ANNOTATION_STRIP = 8;
/** The smallest plot the frame hands a chart (plotHeightAfter). */
const MIN_PLOT_BAND = 10;

/**
 * A lower bound on the height a standard bar takes above and below its rows, from the frame alone: the
 * title, subtitle, source and authored notes, with no key and none of the bar's own notes. Those can
 * only add height, so the bar's real chrome is never below this. It costs one frame, not a bar layout.
 */
export function barChromeFloor(options: BarOptions): number {
  const size = resolveSize(options.size);
  const theme = themeForWidth(resolveTheme(options.theme), size.width);
  const frame = solveFrame({
    size,
    margin: { ...canvasMargin(theme, size.width), ...options.margin },
    ...frameTextOptions(options),
    [COLLECT_IDENTITIES]: undefined,
    footnotes: authoredNotes(options),
    theme,
    measure: options.measure ?? defaultMeasurer,
  }, createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height }));
  return size.height - Math.max(MIN_PLOT_BAND, frame.plot.h - MIN_ANNOTATION_STRIP);
}

/** The widest outside-end label on each side, measured BEFORE the scale so the headroom fits them. */
function outsideLabelWidths(domain: BarDomain, labelFont: FontSpec, strongFont: FontSpec): { maxPosW: number; maxNegW: number } {
  const { options, measure, variant, cats, dataSeries, totalFmt, totals } = domain;
  let maxPosW = 0;
  let maxNegW = 0;
  if (variant === 'grouped' && labelOn(options, 'point')) {
    // Measured as drawn (pointFont, bar/labels.ts): the label face, in the emphasis weight when several series share a row or the value is highlighted.
    const boldFont: FontSpec = { ...labelFont, weight: strongFont.weight };
    cats.forEach((_, ci) => {
      dataSeries.forEach((s) => {
        const cell = s.cells[ci]!;
        if (cell.v === null) return;
        const text = textFor(domain, cell.v, cell, undefined, s);
        if (!text) return;
        const w = measure(text, dataSeries.length > 1 || domain.highlights.has(cats[ci]!.id) || domain.highlights.has(s.id) ? boldFont : labelFont).width;
        if (cell.v >= 0) maxPosW = Math.max(maxPosW, w);
        else maxNegW = Math.max(maxNegW, w);
      });
    });
  }
  if (domain.grandTotalsOn) {
    cats.forEach((_, ci) => {
      maxPosW = Math.max(maxPosW, measure(totalFmt(totals[ci]!), strongFont).width);
    });
  }

  // A 100 % bar's share row (bar/labels.ts) takes the room past the
  // bar's end; shares under 8 % are the ones that land there.
  if (variant === 'stacked100' && labelOn(options, 'segment')) {
    const rowW = cats.map((_, ci) => dataSeries.reduce((w, s, si) => {
      const cell = s.cells[ci]!;
      const share = cell.v === null ? null : domain.shares[ci]?.[si];
      if (share == null || share <= 0 || share >= 8) return w;
      const text = textFor(domain, cell.v!, cell, share, s, cats[ci]!.id);
      return text ? w + measure(text, labelFont).width + SHARE_ROW_SWATCH + 6 : w;
    }, 0));
    maxPosW = Math.max(maxPosW, maxOf(rowW));
  }
  // A reference value prints after the bar's own value on its row (bar/labels.ts referenceLabels).
  if (variant !== 'stacked100' && labelOn(options, 'tick')) {
    const tickFont: FontSpec = { family: domain.theme.type.family, ...domain.theme.type.axis };
    const refW = Math.max(0, maxOf(domain.refSeries.flatMap((s) => s.cells.map((cell) => {
      const text = cell.v === null ? null : referenceLabelText(domain, s, cell.v, cell);
      return text ? measure(text, tickFont).width : 0;
    }))));
    if (refW > 0) maxPosW += 10 + refW;
  }
  return { maxPosW, maxNegW };
}

/** The value-axis break, validated against every value the exhibit renders. */
function barAxisBreak(domain: BarDomain, dLo: number, dHi: number, warnings: LintWarning[]): LinearBreak | undefined {
  const requestedBreak = domain.options.valueAxis?.break;
  if (!requestedBreak) return undefined;
  const reason = breakStyleRefusal(requestedBreak) ?? invalidLinearBreakReason([dLo, dHi], requestedBreak, domain.rendered);
  if (reason) {
    warnings.push(axisBreakInvalid('bar', reason));
    return undefined;
  }
  return { from: requestedBreak.from, to: requestedBreak.to };
}

/**
 * The plot rect (top annotation strip, left category band, bottom value
 * axis), the value scale with headroom so outside-end labels live inside the
 * plot, the row band, and the value-label policy.
 */
export function barPlotArea(domain: BarDomain, frame: FrameResult, warnings: LintWarning[]): BarArea {
  // The value-axis title takes the tick row where it fits there, and its own
  // row only when it does not. The row changes the plot's height, not its x.
  const shared: LintWarning[] = [];
  const area = barPlotAreaWith(domain, frame, shared, false);
  if (area) {
    pushAll(warnings, shared);
    return area;
  }
  return barPlotAreaWith(domain, frame, warnings, true)!;
}

function barPlotAreaWith(domain: BarDomain, frame: FrameResult, warnings: LintWarning[], titleRow: boolean): BarArea | undefined {
  const { options, theme, size, measure, variant, cats, dataSeries, lo, hi } = domain;
  const plot0 = frame.plot;
  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const normalLabelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const compactRows = domain.incompleteRows.size > 0 && options.mode === 'compact' && (options as { [HARD_MINIMUM]?: boolean })[HARD_MINIMUM];
  const labelFont = compactRows ? compactValueLabelFont(normalLabelFont, theme.type.footnote, options.target, textScaleOf(options)) : normalLabelFont;
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const { maxPosW, maxNegW } = outsideLabelWidths(domain, labelFont, strongFont);
  const annPad = domain.localAnns.length > 0 ? 26 : 8;
  // The title of a drawn value axis sits in its tick row, or under it (barPlotArea).
  const axisTitle = options.valueAxis?.show && axisTitleAllowed(options.labels)
    ? planValueAxisTitle(valueAxisTitleText(theme, options.axisTitles?.primary, options,
      valueAxisUnit(options.unit, dataSeries, variant === 'stacked100')), theme, measure, plot0.w)
    : undefined;
  const tickRowH = measure('0', tickFont).height;
  const axisH = options.valueAxis?.show ? tickRowH + 8 + (axisTitle && titleRow ? axisTitle.height + 2 : 0) : 0;
  const availH = plotHeightAfter(frame, size.height, plot0.h - annPad - axisH);
  const lineH = tickFont.size * 1.2;
  // A fixed bar row sizes the names to its pitch, not to the canvas.
  const stepEst = theme.space.barRow?.pitch ?? availH / cats.length;
  // As many name lines as the row step holds, up to CAT_MAX_LINES, so a long name wraps before it is cut.
  const catMaxLines = Math.max(1, Math.min(CAT_MAX_LINES, Math.floor((stepEst - 4) / lineH)));
  const capW = Math.max(24, plot0.w * 0.28);
  const authored = authoredFootnoteCount(options);
  // A 100% bar that misses a part says so on its name where the note naming it does not print: its shares are of the known parts.
  const incompleteWord = options.strings!.incomplete!;
  const partialName = !disclosuresShown(options) && domain.incompleteRows.size > 0;
  // A running period no key names says "to date" on its name, as on a column chart's axis.
  const toDate = partialAxisWords(options.strings, options, frame.legend?.items.some((item) => item.id === '__partial') || partialNamedOnValues(domain));
  const named = (rows: typeof cats) => rows.map((cat) => {
    if (partialName && domain.incompleteRows.has(cat.id) && variant === 'stacked100' && cat.total100 === undefined) return { ...cat, label: `${cat.label} ${incompleteWord}`, suffix: incompleteWord };
    return toDate !== undefined && cat.partial === true && !saysToDate(cat.label ?? cat.id, toDate) ? { ...cat, label: `${cat.label ?? cat.id} ${toDate}`, suffix: toDate } : cat;
  });
  const band0 = (rows: typeof cats, refs: { count: number; warnings: LintWarning[] }) => rowLabelBand(named(rows), tickFont, capW, catMaxLines, lineH, measure, {
    wider: gutterBudget(24, plot0.w),
    target: options.target, textScale: textScaleOf(options), typeRole: 'axis',
    shrink: stepDownFont(theme, tickFont, 'axis', options.target, textScaleOf(options)),
    footnoteRefs: refs,
  });
  const noNameColumn = (options as { [NO_NAME_COLUMN]?: boolean })[NO_NAME_COLUMN] === true;
  let { labels: catLines, width: catBandW } = band0(cats, { count: authored, warnings });
  // The caller draws the names elsewhere: no column, no gap, no cut and no row height for them.
  if (noNameColumn) {
    catLines = catLines.map((label) => ({ ...label, h: 0 }));
    catBandW = 0;
  }
  // A name the band cuts takes the next note number after the author's
  // and prints whole in the notes (a grid panel leaves that to its grid).
  const cut = panelTypeClass(options) === undefined && !noNameColumn
    ? cats.flatMap((cat, i) => (catLines[i]!.title !== undefined && cat.footnote === undefined ? [i] : []))
    : [];
  // A cut name carries the mark only where its note prints (notes.show lists 'disclosure');
  // else it keeps its ellipsis and the full name stays in the notes list.
  const marked = disclosuresShown(options);
  const cutNotes = cut.map((i, k) => disclosureNote(`${marked ? `${authored + k + 1}) ` : ''}${cats[i]!.label ?? cats[i]!.id}.`));
  if (cut.length > 0 && !marked) warnings.push(categoryCutLint(cut.map((i) => cats[i]!.label ?? cats[i]!.id), true, 'in the row-name column'));
  if (cut.length > 0 && marked) {
    ({ labels: catLines, width: catBandW } = band0(cats.map((cat, i) => (cut.includes(i) ? { ...cat, footnote: authored + cut.indexOf(i) + 1 } : cat)), { count: authored + cut.length, warnings: [] }));
    warnings.push(categoryCutLint(cut.map((i) => cats[i]!.label ?? cats[i]!.id), true, 'in the row-name column'));
  }
  const gapAfter = cats.map((cat) => {
    const gap = cat.gapAfter === true ? 0.5 : typeof cat.gapAfter === 'number' ? Math.max(0, cat.gapAfter) : 0;
    // A category break needs a gap wide enough to carry its glyph.
    return cat.breakAfter ? Math.max(gap, 0.5) : gap;
  });
  // A horizontal segment has no seat for its value outside it (band/labels.ts),
  // so a bar that carries segment labels is at least their line box thick,
  // over the 14 px inside floor: a fixed row grows to it, and the natural row step
  // (segmentStep, read by the sizing) grows until the band's share of it does.
  // On a target the bar's natural thickness is the label's font size plus
  // 8 px, 4 px of air above and below. A pinned height keeps the line box as its floor.
  const segmentFloor = variant !== 'grouped' && labelOn(options, 'segment')
    ? Math.ceil(Math.max(INSIDE_MIN_H, measure('0', labelFont).height))
    : 0;
  const segmentBar = segmentFloor > 0 ? Math.max(segmentFloor, labelFont.size + 8) : segmentFloor;
  // An authored row (space.barRow) keeps the line box as its floor, as before.
  const fixedRow = fixedBarRow(theme, catLines.map((label) => label.h), segmentFloor, options.bandFraction);
  const fixedRowsH = fixedRow ? fixedRow.step * bandSteps(cats.length, gapAfter) : undefined;
  const inset = cagrInset(domain) && domain.passAnns.some((a) => a.kind === 'cagr');
  const nameGap = noNameColumn ? 0 : CAT_BAND_GAP;
  const plotW = plot0.w - catBandW - nameGap - ((options as { [RIGHT_ROOM]?: number })[RIGHT_ROOM] ?? (domain.passAnns.some((a) => a.kind === 'cagr') ? (inset ? CAGR_INSET_ROOM : CAGR_ROOM) : 0));
  const rawBandPad = (options as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
  const bandPad = rawBandPad > 0 ? Math.max(0, Math.min(rawBandPad, Math.floor(availH - 10))) : 0;
  const plot: Rect = {
    x: plot0.x + catBandW + nameGap,
    y: plot0.y + annPad + bandPad,
    w: Math.max(10, plotW),
    // Fixed rows never stretch; a shorter canvas (a grid panel) packs them.
    h: fixedRowsH === undefined ? availH - bandPad : Math.min(availH - bandPad, fixedRowsH),
  };
  // A theme's outside labels on grouped bars that cross zero
  // put the negative values right of the zero line, so the negative side
  // reserves room for its bars only. With no value axis drawn, the domain is
  // the extent plus the label room, not snapped to round ticks nobody sees.
  const outsideOnly = theme.marks?.barLabels === 'outside' && variant === 'grouped';
  const negativeLabelsAcross = outsideOnly && lo < 0 && hi > 0 && domain.localAnns.length === 0;
  // A 100 % bar with no axis and nothing printed past its end runs exactly to
  // 100 %, so the bars fill the plot.
  const fullBars = variant === 'stacked100' && maxPosW === 0 && lo >= 0 && !options.valueAxis?.show &&
    domain.localAnns.length === 0 && domain.passAnns.length === 0 &&
    // An authored label on a zero part prints in the share row past the bar's end.
    !dataSeries.some((s) => s.cells.some((cell) => cell.v === 0 && typeof cell.meta?.label === 'string'));
  const callerExact = (options as { [EXACT_DOMAIN]?: boolean })[EXACT_DOMAIN] === true && !options.valueAxis?.show;
  const exactDomain = (outsideOnly && !options.valueAxis?.show) || callerExact;
  const fP = Math.min(0.35, (Math.max(maxPosW, negativeLabelsAcross ? maxNegW : 0) + LABEL_GAP + 8) / plot.w);
  // An exact domain keeps no room left of the bars for labels that are not there.
  const fN = lo < 0 && !negativeLabelsAcross && !(callerExact && maxNegW === 0) ? Math.min(0.35, (maxNegW + LABEL_GAP + 8) / plot.w) : 0;
  const span = hi - lo || 1;
  const denom = Math.max(0.3, 1 - fP - fN);
  const hiExt = hi + (span * fP) / denom;
  const loExt = lo < 0 ? lo - (span * fN) / denom : 0;
  // The fP/fN reserves are occupied by outside-end labels, so the waste bound
  // measures snap overshoot beyond that intent, not beyond the raw data
  // (the domain-economy invariant).
  const [dLo, dHi] = fullBars ? [0, hi || 100] : exactDomain ? [loExt, hiExt || 1] : niceDomain(loExt, hiExt || 1, 5, {
    dataExtent: [loExt, hiExt || 1],
    maxWasteFraction: 0.15,
  });
  let activeBreak = barAxisBreak(domain, dLo, dHi, warnings);
  if (activeBreak && variant !== 'grouped' && stackBreakReversesOrder(brokenLinearScale([dLo, dHi], [plot.x, plot.x + plot.w], activeBreak), domain.stacks)) {
    warnings.push(axisBreakHeightOrderWarning());
    activeBreak = undefined;
  }
  const x = activeBreak
    ? brokenLinearScale([dLo, dHi], [plot.x, plot.x + plot.w], activeBreak)
    : linearScale([dLo, dHi], [plot.x, plot.x + plot.w]);
  const titleEnd = axisTitle && options.valueAxis?.show && !titleRow
    ? tickRowTitleEnd(axisTitle, { scale: x, plot, orient: 'x', gridlines: false, ...domain.axisFmt, theme, measure, canvasWidth: size.width }, plot0.x)
    : undefined;
  if (axisTitle && options.valueAxis?.show && !titleRow && titleEnd === undefined) return undefined;
  const bandFraction = options.bandFraction ?? fixedRow?.fraction ?? 0.7;
  const band = bandScale(cats.length, [plot.y, plot.y + plot.h], {
    paddingInner: 1 - bandFraction,
    paddingOuter: (1 - bandFraction) / 2,
    gapAfter,
  });
  // Value labels on bars thinner than a label line step down one
  // role for the whole chart, so neighbouring rows do not fight over slots.
  // When grouped bars are thinner than even a compact label, only the first
  // series carries value labels; the rest read from the axis. One decision
  // for the chart, announced once, instead of a scatter of survivors.
  const compactLabelFont = compactValueLabelFont(labelFont, theme.type.footnote, options.target, textScaleOf(options));
  const groupSlots = groupedOffsets(band.bandwidth, dataSeries.length);
  const policy = groupedValueLabelPolicy('horizontal', groupSlots[0]?.size ?? band.bandwidth, dataSeries.length, [], labelFont.size, compactLabelFont.size);
  const thinBars = variant === 'grouped' && policy.firstSeriesOnly;
  const compact = variant === 'grouped' && policy.compact;
  if (thinBars && labelOn(options, 'point')) {
    warnings.push({
      code: 'value-labels-first-series-only',
      severity: 'info',
      message: `bars are ${(groupSlots[0]?.size ?? 0).toFixed(1)}px thick, thinner than a value label; only '${dataSeries[0]!.label ?? dataSeries[0]!.id}' carries value labels${domain.highlights.size > 0 ? ', plus the highlighted values where they fit' : ''}`,
      suggest: 'give the chart more height, or fewer categories, to label every series',
    });
  }
  // An inset CAGR arm stands just right of the longest bar. When no axis is
  // drawn and every value prints inside its bar, nothing needs room past the
  // bar ends, so the domain stops at the longest value and the bars fill the
  // width up to the arm.
  let scale = x;
  if (inset && !options.valueAxis?.show && !activeBreak && lo >= 0 && hi > 0 && domain.refSeries.length === 0) {
    const exact = linearScale([0, hi], [plot.x, plot.x + plot.w]);
    const thick = groupSlots[0]?.size ?? band.bandwidth;
    const valueFont: FontSpec = { ...(compact ? compactLabelFont : labelFont), weight: emphasisWeight(theme) };
    const inside = !labelOn(options, 'point') || dataSeries.every((s) => s.cells.every((cell) => {
      if (cell.v === null) return true;
      const text = textFor(domain, cell.v, cell, undefined, s);
      if (!text) return true;
      const measured = measure(text, valueFont);
      const size = compact ? compactValueTextSize('horizontal', measured, valueFont.size) : measured;
      return size.width + 10 <= exact(cell.v) - exact(0) && size.height + 2 <= thick;
    }));
      if (inside) scale = exact;
  }
  const groupedH = variant === 'grouped' && labelOn(options, 'point')
    ? dataSeries.length * measure('0', labelFont).height + Math.max(0, dataSeries.length - 1) * 4 : 0;
  return {
    frame, tickFont, labelFont, strongFont,
    // Grouped value labels print in the emphasis weight, so a value inside a
    // bar end reads at a glance.
    pointFont: { ...(compact ? compactLabelFont : labelFont), ...(variant === 'grouped' && dataSeries.length > 1 ? { weight: emphasisWeight(theme) } : {}) }, compact, thinBars,
    availH, minWidth: size.width - plotW + 10, capW, catLines, cutNotes, catBandW, plot, axisTitle, activeBreak, x: scale, x0: scale(0), band, negativeLabelsAcross,
    ...(axisTitle ? { axisTitleAt: { x: titleEnd ?? plot.x + plot.w, y: plot.y + plot.h + 6 + (titleRow ? tickRowH + 2 : 0) } } : {}),
    ...(fixedRowsH === undefined ? {} : { fixedRowsH }),
    segmentStep: Math.ceil(Math.max(segmentBar, groupedH) / bandFraction),
    segmentMinStep: Math.ceil(Math.max(segmentFloor, groupedH) / bandFraction),
  };
}
