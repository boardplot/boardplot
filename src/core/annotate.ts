import { localeStrings } from './strings';
import { chartString } from './strings/annotate';
import type { StringsSpec } from './types/options';
import { emphasisWeight, strokeToken, dashToken } from './theme';
/**
 * Annotation pass (pipeline stage 6): annotations are
 * anchored to data ids, compute their own values, format through the format
 * module, and are placed against the SAME OccupiedIndex as labels — the
 * `liftArm` strategy raises arms until they clear everything (columns);
 * `shiftCapsule` steps the arm outward on horizontal value axes (bars).
 * Labels attach via the solver with kind 'annotation'.
 *
 * v1 implements: cagr, diff (relative/absolute/reversed), callout, note,
 * valueLine, indicator100, delta, band. Events are not placed here: column,
 * combo and line draw them in the event lane (core/eventLane), gantt draws
 * its own. Charts provide an anchor resolver; the pass is orientation-aware
 * but chart-agnostic.
 */

import type { RenderTarget } from './types/options';
import { cagr, formatAutomaticNumber, formatAutomaticPercent, PERCENTAGE_POINTS } from './format';
import { differenceExample, exampleSpec, formatStatWithSpec, formatWithSpec, formatterFromExample, neededDecimals, parseFormatExample, roundedNumber, specUnitKind, withChartMarks } from './formatSpec';
import { autoDecimals, roundHalfUp, roundsToZero, typicalDecimals } from './formatPrecision';
import { yearSpan, yearSpanFromLabels } from './periodYears';

export { yearSpan } from './periodYears';
import { rectsOverlap, unionRect, type Point, type Rect } from './geometry';
import { compileIcon, type IconName } from './icons';
import type { OccupiedIndex } from './label/occupied';
import { leaderTerminus, PRIORITY, solveLabels, type LabelRequest, type SlotCandidate, type SolveCtx } from './label/solver';
import { leaderPath } from './svgPath';
import { arrowSeats, finishCalloutHeads, leadersOffAnchorValues, type CalloutHeadPlan } from './annotateCallout';
import { composedTextRole, computedTextRole } from './textRole';
import { drawCagrArm, drawDiffArm, trimAnnotationGuides, type ArmDrawPass } from './annotateArms';
import type { ComparisonLayout } from './annotateLinks';
import type { GapBracketFrame, GapBracketPlan } from './annotateGapBracket';
import { wrapText, type FontSpec, type TextMeasurer } from './text';
import { defaultAnnotationId, type AnchorRef, type Annotation } from './types/annotations';
import type { Id, OwnerRef } from './types/cell';
import {
  buildExtendedEraBandCandidates,
  isCeilingClaim,
  placeEraBand,
  placeTargetBand,
  placeValueLineTargets,
  valueLineStroke,
  valueMapper,
  categorySpanRect,
  type EraBandPlan,
} from './annotateTargets';
import { valueLineHasTargetExtras, type CategoryBand } from './annotateFields';
import type {
  AnnotationDerivation,
  LintWarning,
  PlaceDecision,
  PlacedAnnotation,
  PlacedLabel,
  SceneNode,
} from './types/scene';
import type { Theme } from './types/theme';
import { indicator100LabelRect, lineLabelGutterLines, namedLineText, pruneOrphanAnnotationArms } from './annotateParts';
import { SHARES_OF_ONE_WHOLE_FIX, valuelessFix } from './stackAdds';
import { maxOf, pushAll } from './arrays';


type CalloutGlyph =
  | { kind: 'icon'; name: IconName }
  | { kind: 'status'; status: 'good' | 'bad' | 'warn' | 'info' };

interface CalloutGlyphPlacement {
  groupRect: Rect;
  labelRect: Rect;
  chipCenter: Point;
  /** Where the chip's leader ends: the anchor, or the edge of a mark's box nearest the chip. */
  anchor: Point;
}

interface CalloutGlyphPlan {
  glyph: CalloutGlyph;
  nodeIds: Id[];
  meaning: string;
  radius: number;
  text: string;
  owner: OwnerRef;
  anchor: Point;
  placements: Map<string, CalloutGlyphPlacement>;
}

/** What a chart knows about an anchor: position + the value at it. */
export interface AnchorResolution {
  /** Band center (columns) or level position. */
  x: number;
  /** Pixel y of the anchored level (top of bar / segment edge / point). */
  y: number;
  value: number;
  /** Value of the running level for diff and CAGR when the mark's value is a step amount. */
  comparisonValue?: number;
  /** The absolute value in the point label's format, which can use another precision. */
  pointValueText?: string;
  /** Format of the single series this anchor reads. */
  format?: string;
  /**
   * Set where the anchor has a seat but no honest value (a stack
   * whose parts do not add). `value` is then not printed or computed with:
   * an annotation that needs it is not drawn and warns with this reason.
   */
  noValue?: string;
  date?: string;
  /** The anchored category's label; a CAGR reads its period from it when no date is given. */
  label?: string;
  /**
   * The one series the anchor reads, on a chart with several. A CAGR names
   * it in its label and runs its arm from that series' own segment or point,
   * so it never reads as the growth of the total.
   */
  series?: { id: Id; label: string };
  owner: OwnerRef;
  /**
   * Anchor sits on a line-series point (not a bar top). CAGR arms between
   * two line anchors draw as floating stubs + right arrowhead instead of
   * full drop legs — full legs over a line read as a plot frame.
   * Bar/column/waterfall anchors keep drop legs.
   */
  lineAnchored?: boolean;
  /**
   * The anchor is the first drawn point of a line series that starts after
   * the first category. Its own line runs only to the right, so a callout
   * over or under it may also end at the point, as one at index 0 can.
   */
  lineStart?: boolean;
  /** Optional attachment on the same mark, clear of its value label. Used only by callouts and notes. */
  calloutPoint?: Point;
  /**
   * The text the anchored mark already prints, and the mark's box: a heatmap
   * cell with its value inside it. A callout or note whose `${value}` would
   * print that same text drops it, and sits and leads from the box's edge.
   */
  printed?: { text: string; box: Rect };
  /**
   * The anchored mark's box, such as a scatter bubble's. A callout or note
   * rings it and leads from its edge, so neither the text nor the leader
   * lies across the mark.
   */
  markBox?: Rect;
  /** Measured value boundary when a shaped mark's interior is the label anchor. */
  comparisonPoint?: Point;
  /**
   * The anchored row's vertical extent. A margin bracket ends at its middle,
   * and a bracket between two anchors in one row spans it.
   */
  row?: {
    y: number;
    h: number;
    /**
     * Where the row's grid ends on the right (a heatmap row). A callout or
     * note on such a cell sits on its own row beside the grid; a seat off
     * the row leads back to the cell.
     */
    end?: number;
  };
}

export interface AnnotatePassInput {
  target?: RenderTarget;
  annotations: Annotation[];
  resolve(ref: AnchorRef): AnchorResolution | null;
  /** Chart-specific cause and valid ids for an unresolved anchor. */
  anchorError?(ref: AnchorRef): string;
  /** Chart labels that must compete with annotation labels in the same solve. */
  labelRequests?: LabelRequest[];
  /** Value labels already placed by the chart, including values carried by series names. */
  printedLabels?: readonly PlacedLabel[];
  /**
   * Scoped-mean resolver for valueLine seriesId/from/to: the CHART
   * measures the mean from its own plotted cells and reports which series
   * and span it read, so the receipt stays derivable. Charts that do not
   * measure scoped means simply omit it; a scoped request then warns
   * instead of silently falling back to the whole-series mean.
   */
  meanValueFor?(scope: { seriesId?: Id; from?: Id; to?: Id }):
    /** `format` is the measured series' own format, absent where the plot is not in its units. */
    | { value: number; seriesId: Id; from?: Id; to?: Id; format?: string }
    | { error: string };
  /** First/last defaults for cagr. */
  defaultSpan?: { from: AnchorRef; to: AnchorRef };
  /**
   * A bridge's bracket span: the drawn x range of the steps `from` to `to` (inclusive), their
   * signed sum and the y of the one row every bracket stands in. A refusal names its cause.
   */
  resolveSpan?: (from: Id, to: Id) =>
    | { left: number; right: number; y: number; sum: number; steps: { id: Id; value: number }[] }
    | { code: string; error: string };
  /** The exact years between two readings of a time axis (zoneYearSpan); a CAGR uses them instead of dates or labels. */
  elapsedYears?: (from: AnchorResolution, to: AnchorResolution) => number | undefined;
  occupied: OccupiedIndex;
  plot: Rect;
  /** Heatmap callout rows and the measured side budget, inside the frame margins. */
  gridCallouts?: { rows: ReadonlyMap<Id, Rect>; widths?: ReadonlyMap<Id, number>; bounds: Rect; grid: Rect; sideLimit: number };
  /** Wide combo value-line labels use a row above the plot. */
  valueLineRows?: ReadonlyMap<Id, Rect>;
  /**
   * The top of the CAGR arms' lanes. A line puts its header rows inside
   * `plot` and the value-axis title in the row over them; a claim that ends
   * above this line stands in no anchor's lane. Counting the title would send the
   * arm up over it and off the canvas. Absent, a label above `plot` counts:
   * a slope's column heads stand in its lanes.
   */
  laneCeiling?: number;
  /**
   * The growth bracket's label sits
   * on the bracket's horizontal run, centred, and the run breaks around it
   * (lines behind text); the arrow stops 4 px over the end anchor's label.
   * Column and combo set it; others keep the label over the run.
   */
  cagrLabelOnArm?: boolean;
  theme: Theme;
  /**
   * The weight the text of an arrow callout and the body under a headline prints
   * in, for a chart whose `theme` is the emphasis-weight theme (`emphasisLabelTheme`):
   * those two print plain while every other callout prints bold. Absent, `theme.type.label.weight`.
   */
  plainLabelWeight?: number;
  measure: TextMeasurer;
  format?: string; // chart-level format-by-example
  /** Derived differences may have another unit, such as percentage points. */
  differenceFormat?: string;
  /** The chart's language (options.locale.language) for numbers printed without a format. */
  locale?: string;
  strings?: StringsSpec;
  /**
   * The anchored values are percent levels (authored { pct } cells, no
   * format): values print with '%' and their differences in percentage points.
   */
  percentLevels?: boolean;
  /** The value-line scale is percent; other annotations may use source amounts. */
  valueLinePercentLevels?: boolean;
  /** The value-line axis keeps its percent or percentage-point unit under an authored format. */
  valueLineUnit?: '%' | 'pp';
  /** Combo's secondary value-line scale has its own unit. */
  secondaryPercentLevels?: boolean;
  /** An authored format shared by the secondary scale's series. */
  secondaryFormat?: string;
  solveCtx: SolveCtx;
  /**
   * Value-axis orientation for CAGR/diff furniture. Default vertical keeps
   * liftArm (drop legs, horizontal run). Horizontal uses shiftCapsule
   * (side legs, vertical run) for bar charts.
   */
  valueAxis?: 'vertical' | 'horizontal';
  /**
   * Grouped bars: a CAGR arm stands close beside the
   * longest bar with its two-line label inside the arm, and a difference
   * between two bars of one category runs in the shorter bar's row from the
   * longer bar's end, its number led by `gapWord` on a white plate.
   */
  barInset?: { gapWord: string };
  /** Separate or mirrored axes: connect both marks without encoding distance as a difference. */
  comparisonLayout?: ComparisonLayout;
  /**
   * Rows of dots along one value axis (dot): a delta against another row's
   * mark prints "vs <row>" and sits between the two marks on its own row.
   */
  deltaAcrossRows?: boolean;
  /** Value axis mapping for valueLine. */
  yScale?: (v: number) => number;
  /** Horizontal value axis (bar, bullet). Used when yScale is absent. */
  xScale?: (v: number) => number;
  /** Category ids in display order, for attainment cells. */
  categoryIds?: Id[];
  /**
   * Acknowledged-secondary-axis mapping, for `valueLine.axis: 'secondary'`
   * (combo passes its y2). Absent everywhere else, which makes the option a
   * WARNED refusal rather than a silent no-op.
   */
  ySecondaryScale?: (v: number) => number;
  meanValue?: number;
  /** Why meanValue is absent where data was plotted (a stack whose parts do not add). */
  meanMissing?: string;
  /**
   * Under a window or zoom: the periods a mean covers when the plot draws
   * fewer of them ("Jan 25–Dec 26", viewportMeanSpan), which its label names.
   */
  meanSpan?(scope: { from?: Id; to?: Id }): string | undefined;
  /** Category outer edges for inclusive background bands. */
  resolveCategoryBand?: (categoryId: Id) => CategoryBand | null;
  /** On a continuous axis: the slot of one drawn period, for a band from and to the same x. */
  resolvePeriodSlot?: (categoryId: Id) => CategoryBand | null;
  /** Visible plot area when `plot` includes annotation headroom. */
  bandPlot?: Rect;
  /**
   * The chart reserved vertical headroom for annotations (waterfall's
   * annPad): CAGR arms may lift toward their minimum-leg floor inside it,
   * re-checked against the occupied index. Without the flag, arm geometry is
   * byte-identical to the pre-minimum behavior and shortfalls are only
   * reported via legDeficit.
   */
  annotationBandReserved?: boolean;
  /** Optional chart-specific maximum for automatic callout/note leaders, in text widths. */
  calloutLeaderWidths?: number;
  /**
   * Bar rows: the row pitch, in px. A callout or note whose one-line seats
   * are blocked first wraps beside its bar (up to three lines). No seat may
   * lie more than one pitch from the anchor, so the text stays on its own
   * row or the next one. With no such seat it goes to the notes list.
   */
  calloutRowPitch?: number;
  /**
   * A callout's leader is claimed, and a seat whose leader crosses a label
   * set before it is passed over. Scatter solves its callouts before the
   * point names, on an open plot, so crowded callouts go to the note.
   */
  calloutLeaderClear?: boolean;
  /**
   * Categories the author marked `partial: true`. A CAGR with a
   * partial endpoint is suppressed; a diff or delta on one draws with a
   * `partial-period-comparison` warning.
   */
  partialCategories?: ReadonlySet<Id>;
  /** The margin a delta or diff between two series at the last category stands in as a gap bracket (line). */
  gapBracket?: GapBracketFrame;
  /** Fixed y-coordinate ceiling above which era band labels cannot sit unless BAND_PAD increases. */
  bandCeiling?: number;
  /** Fixed header/ceiling rects that do not shift down when BAND_PAD increases. */
  ceilingRects?: readonly Rect[];
}

export interface AnnotatePassResult {
  nodes: SceneNode[];
  placed: PlacedAnnotation[];
  labels: PlacedLabel[];
  decisions: PlaceDecision[];
  warnings: LintWarning[];
  /**
   * How many pixels of vertical headroom were MISSING to give every CAGR
   * drop leg its minimum length (0 when all legs fit). The label floor wins
   * inside a fixed band, so a caller that reserves the band (waterfall's
   * annPad) can re-run its layout once with the band widened by exactly
   * this deficit — only stub cases pay; every other chart is byte-identical.
   */
  legDeficit: number;
  /** Pixels of top plot headroom needed for era band labels that could not fit without headroom (0 when all fit). */
  bandNeed: number;
  /** Pixels the right margin lacks for the gap brackets beside the labels at the line ends (0 when they fit). */
  gapBracketNeed: number;
  /** Annotations whose bracket number found no seat: a second pass refuses them the bracket (GapBracketFrame.refused). */
  gapBracketHidden: Id[];
}



/**
 * Human-readable anchor ref for claim receipts. Object refs would otherwise
 * stringify as `from:[object Object]` on ordinary prototypes and throw a
 * TypeError on the null-prototype documents every CLI entry produces
 * (ownedDocumentCopy). A receipt must name the anchor it read, so the parts
 * print in declaration order, joined by '/'.
 */
function anchorRefLabel(ref: AnchorRef): string {
  if (typeof ref === 'string') return ref;
  const parts: string[] = [];
  for (const key of ['categoryId', 'seriesId', 'segmentId', 'edge', 'pointId', 'valueLineId'] as const) {
    const value = (ref as Record<string, unknown>)[key];
    // Each part prints as key=value so distinct refs can never share a
    // label: without the key, {categoryId:'a',seriesId:'b'} and
    // {categoryId:'a',segmentId:'b'} both read 'a/b'; without the escaping,
    // an id containing '/' forges the join. '%' escapes first so the
    // escaping itself stays reversible.
    if (typeof value === 'string') {
      parts.push(`${key}=${escapeRefPart(value)}`);
    }
  }
  return parts.join('/');
}

/** The receipt-ref escaping ('%' first so it stays reversible) — one rule for
 *  anchor refs and the scoped-mean refs alike. */
function escapeRefPart(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('/', '%2F');
}

/**
 * Callout and note prose reads as a note. Delta and abs print a
 * number, unless an authored `text` replaced it.
 */
function calloutRole(kind: 'callout' | 'note' | 'delta' | 'abs', text: string, computed: string): 'value' | 'note' {
  return kind === 'callout' || kind === 'note' ? 'note' : computedTextRole(text, computed);
}

function calloutAttachment(at: AnchorResolution, kind: string, glyph?: CalloutGlyphPlan): AnchorResolution {
  if ((kind !== 'callout' && kind !== 'note') || !at.calloutPoint) return at;
  if (glyph) glyph.anchor = at.calloutPoint;
  return { ...at, ...at.calloutPoint };
}

function comparisonAnchor(anchor: AnchorResolution | null): AnchorResolution | null {
  return anchor ? { ...anchor, ...anchor.comparisonPoint, value: anchor.comparisonValue ?? anchor.value } : null;
}

/**
 * What one run of the pass shares across its annotations: the formatters,
 * the callout glyphs waiting for their placed label, and the counters (node
 * ids, the CAGR leg deficit).
 */
interface AnnotateRun {
  fmt: (v: number) => string;
  /** A derived statistic (a mean) prints one decimal step past the raster, so it never rounds to another number than it is. */
  statFmt: (v: number) => string;
  fmtSigned: (v: number) => string;
  /** True where a difference prints as zero under `fmtSigned`. */
  printsZero: (v: number) => boolean;
  calloutGlyphPlans: Map<Id, CalloutGlyphPlan>;
  /** Callouts with a headline or an arrow, finished after the solve. */
  calloutHeads: Map<Id, CalloutHeadPlan>;
  gapBrackets: GapBracketPlan[];
  eraBands: EraBandPlan[];
  seq: number;
  legDeficit: number;
}

/**
 * One annotation's view of the pass. It is both the arm-drawing pass
 * (annotateArms.ts) and the target context (annotateTargets.ts), plus the
 * annotation's id and the run. Every placement appends to its outputs in
 * order and claims into `input.occupied` as it goes, because a later
 * annotation's arm lifts clear of the earlier ones.
 */
interface AnnotationScope extends ArmDrawPass {
  id: Id;
  warnings: LintWarning[];
  bandSpans: { id: Id; rect: Rect }[];
  eraBands: EraBandPlan[];
  run: AnnotateRun;
}

/**
 * The annotation pass, in three steps: set up the run (formatters), place each annotation in authored order (`placeAnnotation`,
 * one function per kind: nodes, claims and label requests), then solve the
 * labels and settle what depends on them (`finishAnnotatePass`).
 */
export function runAnnotatePass(input: AnnotatePassInput): AnnotatePassResult {
  // The schema refuses a stray anchor; one that gets past it (null, a number)
  // resolves to nothing instead of reaching a chart resolver's `in` operator.
  const resolveAnchor = input.resolve;
  const resolveCategoryBand = input.resolveCategoryBand;
  const anchorErrors: string[] = [];
  input = { ...input, ...(resolveCategoryBand ? { resolveCategoryBand: (id: Id) => {
    const result = resolveCategoryBand(id);
    if (!result) anchorErrors.push(`unknown category '${id}'; valid category ids: ${(input.categoryIds ?? []).join(', ')}`);
    return result;
  } } : {}), resolve: (ref) => {
    const valid = typeof ref === 'string' || (typeof ref === 'object' && ref !== null);
    const result = valid ? resolveAnchor(ref) : null;
    if (!result && valid) {
      const categoryId = typeof ref === 'string' ? ref : 'categoryId' in ref ? ref.categoryId : undefined;
      if (input.anchorError) anchorErrors.push(input.anchorError(ref));
      else if (categoryId !== undefined && input.categoryIds && !input.categoryIds.includes(categoryId)) {
        anchorErrors.push(`unknown category '${categoryId}'; valid category ids: ${input.categoryIds.join(', ')}`);
      }
    }
    return result;
  } };
  const nodes: SceneNode[] = [];
  const placed: PlacedAnnotation[] = [];
  const labelRequests: LabelRequest[] = [];
  const warnings: LintWarning[] = [];
  // Without a format a number prints the way variance and kpi print it: the
  // business default precision (autoDecimals) in the chart's language.
  const { locale } = input;
  const percent = input.format ? specUnitKind(parseFormatExample(input.format)) === 'percent' : input.percentLevels === true;
  const plain = (suffix: string, signed: boolean) => (v: number) =>
    formatAutomaticNumber(v, { locale, decimals: autoDecimals(v), suffix, signed });
  const fmt = input.format ? formatterFromExample(input.format, locale) : plain(percent ? '%' : '', false);
  // Absolute differences keep the value unit unless the chart supplies a
  // derived unit; the difference of two percent levels is in points.
  const differenceFormat = input.differenceFormat ?? (input.format ? differenceExample(input.format) : undefined);
  // '+' once and never on a value that prints as zero.
  const differenceSpec = differenceFormat ? { ...exampleSpec(differenceFormat, locale), signed: true } : undefined;
  const run: AnnotateRun = {
    fmt,
    statFmt: input.format ? (v: number) => formatStatWithSpec(v, exampleSpec(input.format!, locale)) : fmt,
    fmtSigned: differenceSpec ? (v: number) => formatWithSpec(v, differenceSpec) : plain(percent ? PERCENTAGE_POINTS : '', true),
    printsZero: differenceSpec ? (v: number) => roundedNumber(v, differenceSpec) === 0 : (v: number) => roundsToZero(v, autoDecimals(v)),
    calloutGlyphPlans: new Map(),
    calloutHeads: new Map(),
    gapBrackets: [],
    eraBands: [],
    seq: 0,
    legDeficit: 0,
  };
  const bandSpans: { id: Id; rect: Rect }[] = [];
  input.annotations.forEach((ann, n) => {
    const id = defaultAnnotationId(ann, n);
    anchorErrors.length = 0;
    const warningStart = warnings.length;
    // An annotation's own `format` example prints its number, signed where it
    // prints a difference or a rate. The copy shares the run's glyph map; the
    // counters are written through `nid` and `addLegDeficit`, which hold `run`.
    const secondaryLine = ann.kind === 'valueLine' && ann.axis === 'secondary';
    const referenceFormat = secondaryLine ? input.secondaryFormat : input.format;
    const anchorFormat = 'at' in ann && ann.at !== undefined ? input.resolve(ann.at)?.format
      : ann.kind === 'diff' ? (input.resolve(ann.to)?.format ?? input.resolve(ann.from)?.format)
        : ann.kind === 'valueLine' ? secondaryLine ? input.secondaryFormat : seriesMeanFormat(input, ann) : undefined;
    const example = ann.format ?? anchorFormat;
    const own = example === undefined ? undefined : exampleSpec(example, locale);
    const signed = own ? { ...exampleSpec(ann.format ?? differenceExample(example!), locale), signed: true } : undefined;
    const referencePercent = ann.kind === 'valueLine'
      ? (secondaryLine ? input.secondaryPercentLevels : input.valueLinePercentLevels) ?? percent : percent;
    const referenceUnit = ann.kind === 'valueLine' ? input.valueLineUnit : undefined;
    const baseRun = referenceUnit
      ? { ...run, fmt: referenceFormat
        ? (v: number) => formatWithSpec(v, { ...exampleSpec(referenceFormat, locale), prefix: '', suffix: referenceUnit })
        : plain(referenceUnit, false) }
      : ann.kind === 'valueLine' && !referenceFormat && (secondaryLine || referencePercent !== percent)
      ? { ...run, fmt: plain(referencePercent ? '%' : '', false) } : run;
    const fmtRun: AnnotateRun = own
      ? {
          ...baseRun,
          fmt: referenceUnit ? (v: number) => formatWithSpec(v, { ...own, prefix: '', suffix: referenceUnit }) : formatterFromExample(example!, input.locale),
          fmtSigned: (v: number) => formatWithSpec(v, signed!),
          printsZero: (v: number) => roundedNumber(v, signed!) === 0,
        }
      // Change a typed reference's precision only when its current format rounds the value.
      : ann.kind === 'valueLine' && typeof ann.value === 'number' && !id.startsWith('averageMarker') && !referenceFormat
        ? { ...baseRun, fmt: (v: number) => Number(roundHalfUp(Math.abs(v), autoDecimals(v))) === Math.abs(v)
          ? baseRun.fmt(v)
          : formatAutomaticNumber(v, { locale, decimals: Math.max(autoDecimals(v), neededDecimals(v)), suffix: referenceUnit ?? (referencePercent ? '%' : '') }) }
        : baseRun;
    // An authored annotation format wins; otherwise the format the line's number prints in, one step finer.
    const statExample = ann.format ? undefined : example ?? referenceFormat;
    const statFmt = statExample
      ? (v: number) => formatStatWithSpec(v, referenceUnit ? { ...exampleSpec(statExample, locale), prefix: '', suffix: referenceUnit } : exampleSpec(statExample, locale))
      : fmtRun.fmt;
    const scope: AnnotationScope = {
      input,
      nodes,
      labelRequests,
      placed,
      warnings,
      bandSpans,
      eraBands: run.eraBands,
      run: { ...fmtRun, statFmt },
      id,
      nid: (part: string) => `ann:${id}:${part}:${run.seq++}`,
      priority: ann.priority ?? (ann.kind === 'diff' ? PRIORITY.grandTotal : undefined),
      addLegDeficit: (pixels) => {
        run.legDeficit = Math.max(run.legDeficit, pixels);
      },
    };
    // The scope owns the log; a comparison hook reached through the arm
    // drawers can only append to it, owned by the annotation it is drawing.
    scope.warn = (code, message, suggest) => warn(scope, code, message, suggest);
    placeAnnotation(scope, ann);
    if (anchorErrors.length) for (const warning of warnings.slice(warningStart)) {
      if (warning.code === 'bad-anchor') warning.message += `: ${[...new Set(anchorErrors)].join('; ')}`;
    }
  });
  return finishAnnotatePass(input, run, nodes, placed, labelRequests, warnings);
}

/** A mean scoped with `seriesId` is anchored to that series and prints in its format. */
function seriesMeanFormat(input: AnnotatePassInput, ann: Extract<Annotation, { kind: 'valueLine' }>): string | undefined {
  if (ann.seriesId === undefined || (ann.value !== undefined && ann.value !== 'mean')) return undefined;
  const mean = input.meanValueFor?.({ seriesId: ann.seriesId, from: ann.from, to: ann.to });
  return mean && !('error' in mean) ? mean.format : undefined;
}

function placeAnnotation(s: AnnotationScope, ann: Annotation): void {
  switch (ann.kind) {
    case 'cagr':
      return placeCagr(s, ann);
    case 'diff':
      return placeDiff(s, ann);
    case 'bracket':
      return placeBracket(s, ann);
    case 'callout':
    case 'note':
      return placeNote(s, ann);
    case 'delta':
      return placeDelta(s, ann);
    case 'valueLine':
      return placeValueLine(s, ann);
    case 'indicator100':
      return placeIndicator100(s, ann);
    case 'abs':
      return placeAbs(s, ann);
    case 'band':
      if (!placeTargetBand(s, ann)) placeEraBand(s, ann);
      return;
    case 'event':
      // Drawn by the event lane (column, combo, line) or by gantt itself.
      return;
  }
}

/** The labels of the anchors that sit on a partial category, in anchor order. */
function partialAnchors(s: AnnotationScope, ...anchors: (AnchorResolution | null)[]): string[] {
  const partial = s.input.partialCategories;
  return anchors.flatMap((anchor) => {
    const categoryId = anchor?.owner.categoryId;
    return categoryId !== undefined && partial?.has(categoryId) ? [`'${anchor!.label ?? categoryId}'`] : [];
  });
}

/** A derived comparison that uses a partial period still draws, and says so. */
function warnPartialComparison(s: AnnotationScope, kind: string, partial: string[]): void {
  if (partial.length === 0) return;
  warn(
    s,
    'partial-period-comparison',
    `${kind} '${s.id}' compares ${partial.join(' and ')}, a partial period, as if it were complete`,
    'compare aligned periods (month to date against the same days last year), or say in the title that the period is still running',
  );
}

function warn(s: AnnotationScope, code: string, message: string, suggest?: string): void {
  s.warnings.push({
    code,
    severity: 'warn',
    message,
    owner: { annotationId: s.id },
    ...(suggest === undefined ? {} : { suggest }),
  });
}

/**
 * an anchor with a seat and no value (a stack whose parts do not add)
 * prints no number and computes none, so the annotation that needs one is
 * not drawn. True when it was dropped.
 */
function valueless(s: AnnotationScope, kind: string, anchors: readonly (AnchorResolution | null | undefined)[]): boolean {
  const reason = anchors.find((anchor) => anchor?.noValue !== undefined)?.noValue;
  if (reason === undefined) return false;
  warn(s, 'bad-anchor', `${kind} '${s.id}': ${reason}, so it prints no value there`, valuelessFix(reason));
  return true;
}

/**
 * An authored `text` may still be drawn — callers legitimately re-word a
 * label — but it must never pass itself off as the engine's own number.
 *
 * If `ann.text ?? computed` short-circuited the computation, the authored
 * string would be stored in the field literally named `computedText`, and
 * nothing downstream could tell the two apart. A waterfall whose
 * engine-computed CAGR is +5.6% p.a. would render "+15.0% p.a." with zero
 * warnings and pass verification with exit 0 — a wrong number the product
 * certified as correct, which is worse than any wrong chart.
 *
 * The contract is: compute ALWAYS, draw what was asked
 * for, warn when the two disagree, and keep the computed value on the
 * annotation so the claim record carries the truth and states the
 * divergence instead of blessing it.
 */
function authored(
  s: AnnotationScope,
  kind: string,
  computed: string,
  text: string | undefined,
  value = computed,
): { text: string; computed: string } {
  if (text === undefined || text.trim() === computed.trim()) return { text: computed, computed };
  // `${value}` is a live field: the engine's number in the author's words, so
  // the drawn text is what the record claims and nothing is overridden.
  if (text.includes('${value}')) {
    const live = text.replace(/\$\{value\}/g, value);
    return { text: live, computed: live };
  }
  s.warnings.push({
    code: 'annotation-authored-override',
    severity: 'warn',
    message: `${kind} '${s.id}': authored text ${JSON.stringify(text)} is displayed instead of the computed value ${JSON.stringify(computed)}`,
    owner: { annotationId: s.id },
    suggest: `drop "text" to publish the computed value, write \${value} where the number goes, or keep it and the claim record marks this annotation as an authored override`,
  });
  return { text, computed };
}

function placeCagr(s: AnnotationScope, ann: Extract<Annotation, { kind: 'cagr' }>): void {
  const { input, id } = s;
  const fromRef = ann.from ?? input.defaultSpan?.from;
  const toRef = ann.to ?? input.defaultSpan?.to;
  if (!fromRef || !toRef) return warn(s, 'cagr-no-span', 'cagr needs from/to or a default span');
  const a = comparisonAnchor(input.resolve(fromRef));
  const b = comparisonAnchor(input.resolve(toRef));
  if (!a || !b) return warn(s, 'bad-anchor', `cagr '${id}': unresolvable anchor`);
  if (valueless(s, 'cagr', [a, b])) return;
  // An annual rate over a running period annualises a part-year as a year.
  const partial = partialAnchors(s, a, b);
  if (partial.length > 0) {
    return warn(
      s,
      'cagr-partial-period',
      `cagr '${id}': ${partial.join(' and ')} is a partial period, so an annual rate to it is not measured — CAGR omitted`,
      'anchor the CAGR on complete periods, or compare like-for-like periods with a diff',
    );
  }
  // Annual growth requires a measured period; total growth uses diff.
  // Compound growth starts from a positive value, on every axis: a sign-flipped rate from a loss reads
  // as growth to a reader who does not know that convention.
  if (!(a.value > 0)) {
    return warn(s, 'cagr-undefined', chartString({ locale: input.locale, strings: input.strings }, 'cagrStartNotPositive', { v1: id }),
      `use {kind:'diff', mode:'absolute'} to report the change across the span, or a labelled note for a loss-reduction figure`);
  }
  const elapsed = input.elapsedYears?.(a, b);
  let years = elapsed ?? yearSpan(a.date ?? a.owner.categoryId, b.date ?? b.owner.categoryId);
  if (years === null) {
    // No dates: a label that names a year ("FY24", "2025", "Q1 2024")
    // carries the period too. Read it, and say so.
    const inferred = yearSpanFromLabels(a.label, b.label);
    if (inferred !== null) {
      years = inferred;
      s.warnings.push({
        code: 'cagr-span-from-labels',
        severity: 'info',
        message: `cagr '${id}': period of ${formatYears(inferred)} read from the labels '${a.label}' and '${b.label}'`,
      });
    }
  }
  if (years === null) {
    return warn(
      s,
      'cagr-no-dates',
      `cagr '${id}': anchors carry no usable ISO date (YYYY-MM-DD) and their labels name no year — no per-annum rate can be computed`,
      `give the anchored categories/items a "date" of the form YYYY-MM-DD or a label with a year such as "FY24", or use {kind:'diff', mode:'relative'} to report total growth across the span`,
    );
  }
  if (years <= 0) {
    return warn(s, 'cagr-zero-span', `cagr '${id}': anchor dates span zero or negative time`);
  }
  if (years < 1) {
    warn(
      s,
      'cagr-short-span',
      `cagr '${id}': the anchors span ${formatYears(years)}, under one year, so the per-annum rate extrapolates a shorter period`,
      `use {kind:'diff', mode:'relative'} to report the growth across the span itself`,
    );
  }
  const rate = cagr(a.value, b.value, years);
  if (rate === null || !Number.isFinite(rate)) return warn(s, 'cagr-undefined', `cagr '${id}': ${rate === null ? 'the end value is below zero' : 'the span is too short for a finite annual rate'}`);
  const suffix = ann.suffix ?? 'p.a.';
  const rateText = `${ann.format ? s.run.fmtSigned(rate) : formatAutomaticPercent(rate, Math.max(1, typicalDecimals([rate])), true, input.locale)} ${suffix}`.trim();
  // A rate read off one series of several says whose it is. Its
  // period leads when asked for, and by default when the chart carries
  // several CAGRs, so nested brackets are told apart by their text.
  // An arrow's ends show its span, so its oval keeps to the rate.
  const periodOn = ann.period ?? (input.comparisonLayout?.namesSpan === true || (ann.shape !== 'arrow' && input.annotations.filter((other) => other.kind === 'cagr').length > 1));
  const lead = spanLead(s, a, b, periodOn);
  const label = authored(s, 'cagr', !lead ? rateText : `${lead} ${rateText}`, ann.text, rateText);
  // The computed text keeps its parts, so a bar can set the series name over the rate.
  const parts = lead && label.text === `${lead} ${rateText}` ? { lead, value: rateText } : undefined;
  drawCagrArm(s, a, b, label.text, id, label.computed, {
    basis: 'derived',
    op: 'annotation-cagr@1',
    // All three operands, because all three are needed: the two endpoint
    // values AND the span they are annualised over. A CAGR receipt
    // without the year span is not checkable — the same two endpoints
    // give a different rate over a different period.
    inputs: [
      { ref: `from:${anchorRefLabel(fromRef)}`, value: a.value },
      { ref: `to:${anchorRefLabel(toRef)}`, value: b.value },
      { ref: 'years', value: years, state: `${a.date ?? a.label} → ${b.date ?? b.label}` },
    ],
    raw: rate,
  }, parts, ann.shape);
}

/**
 * What a comparison's text leads with: the series it reads and, when
 * asked for and the two ends name different periods, the period.
 */
function spanLead(s: AnnotationScope, a: AnchorResolution, b: AnchorResolution, periodOn: boolean, colon = false): string {
  const names = [...new Set([a.series?.label, b.series?.label].filter((name) => name !== undefined))];
  const named = names.length === 2
    ? chartString({ locale: s.input.locale, strings: s.input.strings }, 'seriesSpan', { v1: names[0], v2: names[1] })
    : names[0] ?? '';
  const period = periodOn && a.label && b.label && a.label !== b.label ? `${a.label}–${b.label}` : '';
  const lead = [named, period].filter(Boolean).join(' ');
  return lead && (period || colon) ? `${lead}:` : lead;
}

/** Bracket ticks hang this far down from the bracket's run. */
const BRACKET_TICK = 5;

function placeBracket(s: AnnotationScope, ann: Extract<Annotation, { kind: 'bracket' }>): void {
  const { input, id } = s;
  if (!input.resolveSpan) return warn(s, 'unsupported', `bracket '${id}': this chart has no steps to add up`);
  const span = input.resolveSpan(ann.from, ann.to);
  if ('error' in span) return warn(s, span.code, `bracket '${id}': ${span.error}`);
  const sumText = s.run.fmtSigned(span.sum);
  const composed = ann.label ? `${ann.label} ${sumText}` : sumText;
  const label = authored(s, 'bracket', composed, ann.text, sumText);
  const lineId = s.nid('bracket');
  const { left, right, y } = span;
  s.nodes.push({
    t: 'path', id: lineId,
    d: `M${left} ${y + BRACKET_TICK}L${left} ${y}L${right} ${y}L${right} ${y + BRACKET_TICK}`,
    stroke: { token: 'ink' }, width: strokeToken(input.theme, 'rule'), owner: { annotationId: id }, part: 'bracket',
  });
  input.occupied.claim({ x: left - 1, y: y - 1, w: right - left + 2, h: BRACKET_TICK + 2 }, 'annotation', { annotationId: id }, 'bracket');
  const font = { family: input.theme.type.family, ...input.theme.type.label };
  const size = input.measure(label.text, font);
  s.labelRequests.push({
    id: `annotation:${id}`,
    kind: 'annotation',
    role: computedTextRole(label.text, label.computed),
    owner: { annotationId: id },
    text: label.text,
    lines: [label.text],
    typeRole: 'label', font,
    priority: ann.priority ?? PRIORITY.valueLine,
    candidates: [{ slot: 'aboveBracket', rect: { x: (left + right - size.width) / 2, y: y - 3 - size.height, w: size.width, h: size.height }, penalty: 0 }],
  });
  s.placed.push({
    id, kind: 'bracket', computedText: label.computed, nodeIds: [lineId], labelId: `annotation:${id}`,
    derivation: {
      basis: 'derived', op: 'sum@1',
      inputs: span.steps.map((step) => ({ ref: step.id, value: step.value })),
      raw: span.sum,
    },
  });
}

function placeDiff(s: AnnotationScope, ann: Extract<Annotation, { kind: 'diff' }>): void {
  const { input, id } = s;
  const a = comparisonAnchor(input.resolve(ann.from));
  const b = comparisonAnchor(input.resolve(ann.to));
  if (!a || !b) return warn(s, 'bad-anchor', `diff '${id}': unresolvable anchor`);
  if (valueless(s, 'diff', [a, b])) return;
  warnPartialComparison(s, 'diff', partialAnchors(s, a, b));
  const mode = ann.mode ?? 'relative';
  // Backstop for direct layout() callers — the annotation schema
  // refuses these upstream. 'pctOf100' would fall through to the
  // absolute branch and draw the raw difference as if it were
  // percentage points; anchors resolve to absolute values, so there is
  // no share basis here to divide by.
  if (mode !== 'relative' && mode !== 'reversed' && mode !== 'absolute') {
    return warn(
      s,
      'diff-mode-unimplemented',
      `diff '${id}': mode '${String(mode)}' is not implemented — nothing is drawn`,
      mode === 'pctOf100'
        ? "use mode:'absolute' for the raw difference, or author the shares as data if the reader needs points of 100%"
        : "use 'relative', 'absolute' or 'reversed'",
    );
  }
  let computed: string;
  let derivation: AnnotationDerivation;
  if (mode === 'relative' || mode === 'reversed') {
    const [base, tip] = mode === 'reversed' ? [b, a] : [a, b];
    if (base.value === 0) return warn(s, 'ref-zero', `diff '${id}': zero base`);
    // Divide by |base|, not base. `tip/base - 1` inverts the sign on a
    // negative base: -100 -> +50 (a rise) renders "−150%" and paints
    // bad, and -100 -> -200 (a loss that doubled) renders "+100%" and
    // paints neutral. The magnitude is unchanged for a positive base;
    // for a negative one the sign tracks the direction the value
    // actually moved, which is what the arrow already draws.
    const pct = ((tip.value - base.value) / Math.abs(base.value)) * 100;
    // One number takes its own precision below 1 (typicalDecimals): +0.0004%, not <+1%.
    computed = ann.format ? s.run.fmtSigned(pct) : formatAutomaticPercent(pct, typicalDecimals([pct]), true, input.locale);
    // base FIRST, tip second — the order is the receipt. Recorded in the
    // resolved order, not the authored one, so a `reversed` diff is
    // checkable without knowing which mode produced it.
    derivation = {
      basis: 'derived',
      op: 'annotation-diff-relative@1',
      inputs: [
        { ref: `base:${anchorRefLabel(mode === 'reversed' ? ann.to : ann.from)}`, value: base.value },
        { ref: `tip:${anchorRefLabel(mode === 'reversed' ? ann.from : ann.to)}`, value: tip.value },
      ],
      raw: pct,
    };
    if (base.value < 0) {
      warn(
        s,
        'diff-negative-base',
        `diff '${id}': percent change off a negative base (${base.value}) is measured against its magnitude, so the sign follows the direction of the change`,
        `use mode:'absolute' if the reader needs the raw difference instead of a ratio to a negative reference`,
      );
    }
  } else {
    computed = s.run.fmtSigned(b.value - a.value);
    derivation = {
      basis: 'derived',
      op: 'annotation-diff-absolute@1',
      inputs: [
        { ref: `from:${anchorRefLabel(ann.from)}`, value: a.value },
        { ref: `to:${anchorRefLabel(ann.to)}`, value: b.value },
      ],
      raw: b.value - a.value,
    };
  }
  if (gapPlacement(s, ann, a, b)) {
    const text = mode !== 'absolute' ? computed : gapNumber(s, ann, a, b, b.value - a.value, computed);
    // The spine runs base to tip, the way the value reads: a reversed diff swaps the ends.
    const [tail, head] = mode === 'reversed' ? [b, a] : [a, b];
    return drawGapBracket(s, ann, tail, head, authored(s, 'diff', text, ann.text, text), derivation);
  }
  // A difference drawn away from its marks names the series and period it measures.
  const lead = input.comparisonLayout?.namesSpan ? spanLead(s, a, b, true, true) : '';
  // Grouped bars: a difference inside one category reads "gap +103", the word regular and the number bold.
  const gapWord = input.barInset && !lead && ann.text === undefined && a.owner.categoryId !== undefined &&
    a.owner.categoryId === b.owner.categoryId && a.owner.seriesId !== b.owner.seriesId ? input.barInset.gapWord : '';
  // The word is furniture: the record keeps the number alone as the computed text.
  const label = gapWord ? { text: `${gapWord}\u00A0${computed}`, computed } : authored(s, 'diff', lead ? `${lead} ${computed}` : computed, ann.text, computed);
  drawDiffArm(s, a, b, label.text, id, label.computed, derivation, gapWord ? { lead: gapWord, value: computed } : undefined);
}

function placeNote(s: AnnotationScope, ann: Extract<Annotation, { kind: 'callout' | 'note' }>): void {
  const found = s.input.resolve(ann.at);
  if (!found) return warn(s, 'bad-anchor', `${ann.kind} '${s.id}': unresolvable anchor`);
  if ([ann.text, ann.kind === 'callout' ? ann.headline : undefined].some((text) => text?.includes('${value}')) && valueless(s, ann.kind, [found])) return;
  const value = s.run.fmt(found.value);
  // A mark that prints this value already says the number: the note keeps its
  // words, and the token goes with the colon or dash that led into it.
  const repeats = found.printed?.text === value && (ann.text ?? '').includes('${value}');
  const at = repeats ? found : { ...found, printed: undefined };
  const text = repeats
    ? ann.text!.replace(/[\s:\u2013\u2014-]*\$\{value\}/g, '').replace(/[ \t]{2,}/g, ' ').trim()
    : (ann.text ?? '').replace(/\$\{value\}/g, value);
  const glyph = calloutGlyphOf(s, ann);
  if (repeats) {
    s.warnings.push({
      code: 'annotation-value-on-mark',
      severity: 'info',
      message: `${ann.kind} '${s.id}': the mark already prints ${value}, so \${value} and the words that led into it are left out of the text`,
      owner: { annotationId: s.id },
      suggest: 'keep it, as the number stands at the mark, or drop ${value} from the text to set the wording yourself',
    });
  }
  if (repeats && !text && !glyph) return;
  // A headline is the first line, over the text: "${value}" over the words.
  const headline = ann.kind === 'callout' && ann.headline !== undefined ? ann.headline.replace(/\$\{value\}/g, value) : undefined;
  const placedGlyph = glyph ? planCalloutGlyph(s, at, glyph, text) : undefined;
  // Prose. The `${value}` token is substituted from the engine, but the
  // sentence built around it is the author's, so the record carries the
  // anchor value it was substituted from and claims nothing more.
  const lines = headline === undefined ? text : `${headline}\n${text}`;
  calloutLabel(s, ann, at, lines, ann.kind, undefined, lines, {
    basis: 'authored',
    op: `annotation-${ann.kind}@1`,
    inputs: [{ ref: `at:${anchorRefLabel(ann.at)}`, value: at.noValue === undefined ? at.value : null, state: 'anchor' }],
    raw: null,
  }, placedGlyph);
}

function placeDelta(s: AnnotationScope, ann: Extract<Annotation, { kind: 'delta' }>): void {
  const { input, id } = s;
  const at = input.resolve(ann.at);
  if (!at) return warn(s, 'bad-anchor', `delta '${id}': unresolvable anchor`);
  const vsAnchor = typeof ann.vs === 'number' ? null : input.resolve(ann.vs);
  // Against a literal the delta reads the mark's own value. Against another anchor both ends read the running level, as diff does, so the two stay in one unit.
  const vsValue = typeof ann.vs === 'number' ? ann.vs : (vsAnchor ? (vsAnchor.comparisonValue ?? vsAnchor.value) : null);
  if (vsValue === null) return warn(s, 'bad-anchor', `delta '${id}': unresolvable vs`);
  if (valueless(s, 'delta', [at, vsAnchor])) return;
  warnPartialComparison(s, 'delta', partialAnchors(s, at, vsAnchor));
  const atValue = vsAnchor ? (at.comparisonValue ?? at.value) : at.value;
  const d = atValue - vsValue;
  const computed = s.run.fmtSigned(d);
  // A difference that prints as zero has no direction to judge.
  const tone = s.run.printsZero(d) ? undefined : d > 0 ? 'good' : 'bad';
  // On a chart that asks for it, a delta against another row's mark
  // names that row and sits on its own row between the two marks.
  const acrossRows = input.deltaAcrossRows === true && vsAnchor !== null &&
    vsAnchor.owner.categoryId !== undefined && vsAnchor.owner.categoryId !== at.owner.categoryId;
  const derivation: AnnotationDerivation = {
    basis: 'derived',
    op: 'annotation-delta@1',
    inputs: [
      { ref: `at:${anchorRefLabel(ann.at)}`, value: atValue },
      { ref: typeof ann.vs === 'number' ? 'vs:literal' : `vs:${anchorRefLabel(ann.vs)}`, value: vsValue },
    ],
    raw: d,
  };
  if (gapPlacement(s, ann, at, vsAnchor)) {
    const text = gapNumber(s, ann, vsAnchor!, at, d, computed);
    return drawGapBracket(s, ann, vsAnchor!, at, authored(s, 'delta', text, ann.text, text), derivation);
  }
  const label = authored(s, 'delta', acrossRows && vsAnchor.label ? `${computed} vs ${vsAnchor.label}` : computed, ann.text, computed);
  const seat = acrossRows ? { ...at, x: (at.x + vsAnchor.x) / 2 } : at;
  calloutLabel(s, ann, seat, label.text, 'delta', tone, label.computed, derivation);
}

/**
 * A delta or diff between two series at the last category stands as a gap
 * bracket where the chart offers one. An explicit 'bracket' the anchors or the
 * chart cannot honour says so and keeps the label; a caption without a
 * bracket says it is not printed.
 */
function gapPlacement(s: AnnotationScope, ann: Extract<Annotation, { kind: 'delta' | 'diff' }>, a: AnchorResolution, b: AnchorResolution | null): boolean {
  const refused = s.input.gapBracket?.refused?.includes(s.id) === true;
  const applies = !refused && s.input.gapBracket?.engine.applies(s.input.gapBracket, ann, a, b) === true;
  if (refused) {
    warn(s, 'gap-bracket-unavailable', `${ann.kind} '${s.id}': the gap bracket's number found no free seat in the right margin; the label stays at the anchor`,
      'give the chart more height or width, or set placement: \'label\'');
  } else if (!applies && ann.placement === 'bracket') {
    const why = s.input.gapBracket?.unavailable;
    warn(s, 'gap-bracket-unavailable', why
      ? `${ann.kind} '${s.id}': placement 'bracket' is unavailable because ${why}; the label stays at the anchor`
      : `${ann.kind} '${s.id}': placement 'bracket' needs two different series at the last category of a line chart; the label stays at the anchor`,
      why ? "drop placement, or use variant 'line' or 'area'" : "anchor both ends at the last category with a seriesId each, or drop placement");
  }
  if (!applies && ann.caption !== undefined) {
    warn(s, 'gap-caption-ignored', `${ann.kind} '${s.id}': caption prints only under a gap bracket, so it is not drawn`, 'drop caption, or anchor the annotation so it draws a gap bracket');
  }
  return applies;
}

/**
 * Beside printed end values the bracket number prints at their decimals and
 * unit (a percent level gives points), so "25.6" and "19.2" read "+6.4". An
 * authored format wins; without end values the run's rounding stays.
 */
function gapNumber(s: AnnotationScope, ann: Extract<Annotation, { kind: 'delta' | 'diff' }>, tail: AnchorResolution, head: AnchorResolution, raw: number, computed: string): string {
  if (ann.format) return computed;
  const printed = [tail, head].map((end) => s.input.labelRequests?.find((request) => request.kind === 'point' && !request.redundant &&
    request.owner.seriesId === end.owner.seriesId && request.owner.categoryId === end.owner.categoryId)?.text);
  if (printed.some((text) => text === undefined)) return computed;
  try {
    const [first, second] = printed.map((text) => parseFormatExample(differenceExample(text!)));
    return formatWithSpec(raw, withChartMarks({ ...(second!.decimals > first!.decimals ? second! : first!), signed: true }, s.input.locale));
  } catch {
    return computed;
  }
}

function drawGapBracket(
  s: AnnotationScope, ann: Extract<Annotation, { kind: 'delta' | 'diff' }>, tail: AnchorResolution, head: AnchorResolution,
  label: { text: string; computed: string }, derivation: AnnotationDerivation,
): void {
  s.run.gapBrackets.push(s.input.gapBracket!.engine.plan(s, s.input.gapBracket!, tail, head, label.text, label.computed, ann.caption, s.id, ann.kind, derivation));
}

function placeAbs(s: AnnotationScope, ann: Extract<Annotation, { kind: 'abs' }>): void {
  const at = s.input.resolve(ann.at);
  if (!at) return warn(s, 'bad-anchor', `abs '${s.id}': unresolvable anchor`);
  if (valueless(s, 'abs', [at])) return;
  const computed = s.run.fmt(at.value);
  // `abs` restates the anchor's own plotted value. There is no arithmetic
  // to check — recording it as a derivation would be an identity, which
  // is the same thing as not checking it — so it is `observed`: a value
  // READ from the data the manifest binds by sourceSha256.
  const label = authored(s, 'abs', computed, ann.text);
  calloutLabel(s, ann, at, label.text, 'abs', undefined, label.computed, {
    basis: 'observed',
    op: 'annotation-abs@1',
    inputs: [{ ref: `at:${anchorRefLabel(ann.at)}`, value: at.value, state: 'anchor' }],
    raw: at.value,
  });
}

/**
 * The value a valueLine draws at: an authored number, the plotted mean, or a
 * scoped mean the chart measures. Undefined after a warning when the request
 * cannot be honoured.
 */
function valueLineMean(
  s: AnnotationScope,
  ann: Extract<Annotation, { kind: 'valueLine' }>,
): { v: number; scopedMean?: { value: number; seriesId: Id; from?: Id; to?: Id } } | undefined {
  const { input, id } = s;
  const onSecondary = ann.axis === 'secondary';
  if (onSecondary && !input.ySecondaryScale) {
    warn(
      s,
      'valueline-axis-unsupported',
      `valueLine '${id}': axis 'secondary' needs an acknowledged secondary axis (a combo series on axis 'secondary' ` +
        'with options.secondaryAxis.acknowledge) — this chart has none',
    );
    return undefined;
  }
  if (onSecondary && (ann.value === 'mean' || ann.value === undefined)) {
    warn(
      s,
      'valueline-axis-unsupported',
      `valueLine '${id}': 'mean' is measured on the primary scale — give a numeric value for a secondary-axis line`,
    );
    return undefined;
  }
  const authoredValue = ann.value !== 'mean' && ann.value !== undefined;
  const clipSpan = valueLineHasTargetExtras(ann);
  if (authoredValue && ann.seriesId !== undefined) {
    warn(
      s,
      'valueline-scope-authored-value',
      `valueLine '${id}': seriesId scopes a MEASURED mean, but an authored value ${String(ann.value)} was also given — drop the value (the engine computes it) or drop seriesId (put a series on attainment if needed)`,
    );
    return undefined;
  }
  if (authoredValue && (ann.from !== undefined || ann.to !== undefined) && !clipSpan) {
    warn(
      s,
      'valueline-scope-authored-value',
      `valueLine '${id}': from/to scope a MEASURED mean, but an authored value ${String(ann.value)} was also given — drop the value, drop the span, or keep from/to only as a tolerance/attainment clip`,
    );
    return undefined;
  }
  const scoped =
    !authoredValue &&
    (ann.seriesId !== undefined || ann.from !== undefined || ann.to !== undefined);
  let scopedMean: { value: number; seriesId: Id; from?: Id; to?: Id } | undefined;
  if (scoped) {
    if ((ann.from === undefined) !== (ann.to === undefined)) {
      warn(
        s,
        'valueline-scope-invalid',
        `valueLine '${id}': a category span needs both 'from' and 'to' (inclusive, like band)`,
      );
      return undefined;
    }
    if (!input.meanValueFor) {
      warn(
        s,
        'valueline-scope-unsupported',
        `valueLine '${id}': this chart does not measure scoped means — seriesId/from/to are supported on line charts`,
      );
      return undefined;
    }
    const resolved = input.meanValueFor({ seriesId: ann.seriesId, from: ann.from, to: ann.to });
    if ('error' in resolved) {
      warn(s, 'valueline-scope-invalid', `valueLine '${id}': ${resolved.error}`);
      return undefined;
    }
    scopedMean = resolved;
  }
  const v = scopedMean
    ? scopedMean.value
    : ann.value === 'mean' || ann.value === undefined
      ? input.meanValue
      : ann.value;
  if (v === undefined) {
    if (input.meanMissing !== undefined) warn(s, 'no-mean', `valueLine '${id}': ${input.meanMissing}`, SHARES_OF_ONE_WHOLE_FIX);
    else warn(s, 'no-mean', `valueLine '${id}': no mean available`);
    return undefined;
  }
  return { v, scopedMean };
}

/**
 * The x-band the value-axis tick labels occupy left of the plot, read from
 * their own claims, or undefined when the chart draws none (a hidden axis,
 * pareto's default). The annotate pass needs no chart-specific knowledge of
 * where the column sits: the axis furniture already said it. Only rects that
 * end at or before the plot edge count, so the axis line and the category
 * strip never widen the band.
 */
function valueAxisTickColumn(occupied: OccupiedIndex, plotX: number): [number, number] | undefined {
  let left = Infinity;
  let right = -Infinity;
  for (const claim of occupied.snapshot()) {
    if (claim.kind !== 'axis') continue;
    const r = claim.rect;
    if (r.w <= 0 || r.h <= 0 || r.x + r.w > plotX + 0.5) continue;
    left = Math.min(left, r.x);
    right = Math.max(right, r.x + r.w);
  }
  return right > left ? [left, right] : undefined;
}

/** Air between a reference line and a label set above or below it: the 3 px floor. */
const LINE_LABEL_GAP = 3;

/** Px between the seats along a line, between its right end and its start; at most LINE_SEAT_MAX steps, so a very wide export stays cheap. */
const LINE_SEAT_STEP = 16;
const LINE_SEAT_MAX = 96;

/** Air a right value line label keeps from another owner's label, so "Average 92.3" beside a "91" never reads as one string. */
const LINE_LABEL_AIR = 12;

/**
 * Seats for a right-side valueLine label on a vertical value axis. The label
 * reads on its line inside the plot: above it at the right end, below it,
 * then at the start, then at even steps along the line from right to left.
 * A side gutter takes plot width from every mark, so it is the last resort:
 * the seat after the right tick column, wrapped into two lines before
 * it widens (lineLabelGutterLines). A chart whose first pass hid the label
 * reserves exactly that gutter (hiddenValueLineReserve) and lays out again.
 */
function rightLineSeats(
  input: AnnotatePassInput,
  text: string,
  font: FontSpec,
  size: { width: number; height: number },
  y: number,
  rightSeat: number,
): SlotCandidate[] {
  const { plot } = input;
  const above = y - size.height - LINE_LABEL_GAP;
  const below = y + LINE_LABEL_GAP;
  const seat = (slot: string, x: number, top: number, penalty: number): SlotCandidate =>
    ({ slot, rect: { x, y: top, w: size.width, h: size.height }, penalty });
  const end = plot.x + plot.w - size.width;
  const start = plot.x + 4;
  const steps = Math.min(LINE_SEAT_MAX, Math.ceil((end - start) / LINE_SEAT_STEP));
  const along = steps > 1 ? Array.from({ length: steps - 1 }, (_, i) => end - ((i + 1) * (end - start)) / steps) : [];
  const lines = lineLabelGutterLines(text, (t) => input.measure(t, font).width);
  const wrappedW = Math.max(...lines.map((line) => input.measure(line, font).width));
  const wrappedH = size.height * lines.length;
  return [
    // One penalty for every seat on the line: the order below is the
    // preference, and a seat that crowds another owner's label
    // (LINE_LABEL_AIR) waits behind the clear ones.
    seat('insideEnd', end, above, 0),
    seat('insideEndLow', end, below, 0),
    seat('insideStart', start, above, 0),
    seat('insideStartLow', start, below, 0),
    ...along.flatMap((x, i) => [seat(`insideAlong${i + 1}`, x, above, 0), seat(`insideAlong${i + 1}Low`, x, below, 0)]),
    seat('lineEnd', rightSeat, y - size.height / 2, 100),
    seat('lineEndShifted', rightSeat, above, 101),
    seat('lineEndLow', rightSeat, below, 102),
    ...(lines.length > 1
      ? [{ slot: 'lineEndWrapped', rect: { x: rightSeat, y: y - wrappedH / 2, w: wrappedW, h: wrappedH }, penalty: 103, lines }]
      : []),
  ];
}

/** The valueLine's label request, at the line end (or above the line on a horizontal value axis). Returns the text, '' for none. */
function valueLineLabel(
  s: AnnotationScope,
  ann: Extract<Annotation, { kind: 'valueLine' }>,
  v: number,
  y: number,
  axis: 'x' | 'y',
): string {
  const { input, id } = s;
  const span = input.meanSpan?.({ from: ann.from, to: ann.to });
  const isMean = ann.value === 'mean' || ann.value === undefined;
  const valueText = (isMean ? s.run.statFmt : s.run.fmt)(v);
  const labelText =
    ann.label === false ? '' : ann.label !== undefined ? namedLineText(ann.label, valueText, v, id)
      : (isMean ? `${input.strings?.average ?? localeStrings(input.locale).average} ${valueText}${span ? ` (${span})` : ''}` : valueText);
  if (!labelText) return labelText;
  const font = { family: input.theme.type.family, ...input.theme.type.label };
  const row = input.valueLineRows?.get(id);
  if (row) {
    const rowFont = { ...font, weight: emphasisWeight(input.theme) };
    const lines = wrapText(labelText, rowFont, row.w, Math.max(1, labelText.length), input.measure).lines;
    s.labelRequests.push({ id: `valueLine:${id}`, kind: 'valueLine', role: composedTextRole(labelText), owner: { annotationId: id },
      text: labelText, lines, typeRole: 'label', font: rowFont, fontStep: rowFont, priority: ann.priority ?? PRIORITY.reference,
      candidates: [{ slot: 'aboveLineRow', rect: { ...row, w: Math.max(...lines.map(line => input.measure(line, rowFont).width)) }, penalty: 0, outsidePlot: true }] });
    return labelText;
  }
  const size = input.measure(labelText, font);
  const side = ann.side ?? 'right';
  // A left-side label lives in the canvas MARGIN, which is the right home
  // for the charts that reserve air for it before the frame solves
  // (combo/layout.ts, left valueLine reserve; pareto through combo) — and
  // which is the value-axis TICK-LABEL column for every caller with no
  // reserve (bar, bullet, butterfly, dot, scatter, and mean-derived labels
  // whose text is unknown at frame time). A margin slot that lands the
  // label's left edge inside that column would sit on the ticks a few
  // pixels even off a tick value, and on a line sitting exactly on a tick
  // value the tick's own claim would block the slot and the label vanish.
  // When the margin slot would fall inside the tick column, the candidates
  // start at the plot's left edge instead, which is right of the ticks,
  // and step above and below the line there; the margin stays as the last
  // resort so a label is still drawn rather than lost. Charts whose margin
  // already clears the ticks keep the margin slot first and are unchanged.
  const marginX = Math.max(0, input.plot.x - size.width - 4);
  const tickColumn = valueAxisTickColumn(input.occupied, input.plot.x);
  // Any overlap of the label's span with the tick column counts, not only its
  // left edge: a wide label can start left of the ticks and still cover them.
  const marginInTickColumn =
    tickColumn !== undefined && marginX < tickColumn[1] + 0.5 && marginX + size.width > tickColumn[0] - 0.5;
  // A label wider than the margin would be clamped onto the canvas edge and
  // struck through by its own line; it takes the inside slots as well.
  const marginTooNarrow = input.plot.x - size.width - 4 < 0;
  // A right value axis already claims its tick column. A gutter seat keeps
  // after that column (rightLineSeats).
  const plotRight = input.plot.x + input.plot.w;
  const rightTicks = input.occupied.snapshot().filter(claim => claim.kind === 'axis' && claim.rect.w > 0 && claim.rect.h > 0 && claim.rect.x >= plotRight - 0.5);
  const rightSeat = Math.max(plotRight, maxOf(rightTicks.map(claim => claim.rect.x + claim.rect.w))) + 4;
  const x = marginInTickColumn || marginTooNarrow ? input.plot.x + 4 : marginX;
  const candidates =
    axis === 'x'
      ? [
          {
            slot: 'aboveLine',
            rect: {
              x: y - size.width / 2,
              y: input.plot.y - size.height - 6,
              w: size.width,
              h: size.height,
            },
            penalty: 0,
          },
          {
            slot: 'aboveLineLeft',
            rect: {
              x: y - size.width - 4,
              y: input.plot.y - size.height - 6,
              w: size.width,
              h: size.height,
            },
            penalty: 1,
          },
        ]
      : side === 'right'
        ? rightLineSeats(input, labelText, font, size, y, rightSeat)
        : [
          // Inside the plot the centred slot would sit on the label's own
          // dashed line (the solver ignores the annotation's own claims), so
          // a relocated left label takes the slots above and below the line.
          ...(x === marginX
            ? [{ slot: 'lineEnd', rect: { x, y: y - size.height / 2, w: size.width, h: size.height }, penalty: 0 }]
            : []),
          { slot: 'lineEndShifted', rect: { x, y: y - size.height - LINE_LABEL_GAP, w: size.width, h: size.height }, penalty: 1 },
          { slot: 'lineEndLow', rect: { x, y: y + LINE_LABEL_GAP, w: size.width, h: size.height }, penalty: 2 },
          ...(x !== marginX
            ? [{ slot: 'lineEndMargin', rect: { x: marginX, y: y - size.height / 2, w: size.width, h: size.height }, penalty: 3 }]
            : []),
          // A left label whose start is taken by the data steps to the line's right end, above or below it.
          { slot: 'insideEnd', rect: { x: input.plot.x + input.plot.w - size.width, y: y - size.height - LINE_LABEL_GAP, w: size.width, h: size.height }, penalty: 4 },
          { slot: 'insideEndLow', rect: { x: input.plot.x + input.plot.w - size.width, y: y + LINE_LABEL_GAP, w: size.width, h: size.height }, penalty: 5 },
        ];
  // Last resort before the label is lost: the same seats 1 px nearer the line.
  const tight = axis === 'x' ? [] : candidates.flatMap((c) => Math.abs(c.rect.y + c.rect.h - (y - LINE_LABEL_GAP)) < 1e-6 || Math.abs(c.rect.y - (y + LINE_LABEL_GAP)) < 1e-6
    ? [{ ...c, slot: `${c.slot}Tight`, rect: { ...c.rect, y: c.rect.y + (c.rect.y > y ? -1 : 1) }, penalty: c.penalty + 10 }]
    : []);
  s.labelRequests.push({
    id: `valueLine:${id}`,
    kind: 'valueLine',
    role: composedTextRole(labelText),
    owner: { annotationId: id },
    text: labelText,
    lines: [labelText],
    typeRole: 'label', font,
    priority: ann.priority ?? PRIORITY.reference,
    ...(axis === 'y' && side === 'right' ? { labelGap: LINE_LABEL_AIR } : {}),
    candidates: [...candidates, ...tight],
  });
  return labelText;
}

function placeValueLine(s: AnnotationScope, ann: Extract<Annotation, { kind: 'valueLine' }>): void {
  const { input, id } = s;
  const mapper = valueMapper(input);
  if (!mapper) return warn(s, 'unsupported', `valueLine '${id}': chart has no value scale`);
  const mean = valueLineMean(s, ann);
  if (!mean) return;
  const { v, scopedMean } = mean;
  const onSecondary = ann.axis === 'secondary';
  const axis = onSecondary ? 'y' : mapper.axis;
  const y = onSecondary ? input.ySecondaryScale!(v) : mapper.scale(v);
  const lineId = s.nid('line');
  const from = scopedMean?.from === undefined ? undefined : input.resolveCategoryBand?.(scopedMean.from);
  const to = scopedMean?.to === undefined ? undefined : input.resolveCategoryBand?.(scopedMean.to);
  const span = from && to ? categorySpanRect(from, to, input.plot) : input.plot;
  s.nodes.push({
    t: 'line',
    id: lineId,
    ...valueLineStroke(span, y, axis),
    stroke: { token: 'ink' },
    width: strokeToken(input.theme, 'rule'),
    dash: dashToken(input.theme, 'reference'),
    owner: { annotationId: id },
    part: 'valueLine',
  });
  input.occupied.claim(
    axis === 'y'
      ? { x: span.x, y: y - 1, w: span.w, h: 2 }
      : { x: y - 1, y: span.y, w: 2, h: span.h },
    'annotation',
    { annotationId: id },
    'referenceLine',
  );
  const labelText = valueLineLabel(span === input.plot ? s : { ...s, input: { ...input, plot: span } }, ann, v, y, axis);
  const meanLine = ann.value === 'mean' || ann.value === undefined;
  s.placed.push({
    id,
    kind: 'valueLine',
    computedText: labelText || '',
    valueText: (meanLine ? s.run.statFmt : s.run.fmt)(v),
    nodeIds: [lineId],
    labelId: labelText ? `valueLine:${id}` : undefined,
    // A mean is MEASURED over the plotted series (the observations are the
    // source rows, bound by sourceSha256, not copied into the record); an
    // explicit `value:` is a number the document typed. Two different
    // things that draw the identical dashed line, so the record has to
    // say which one it is.
    derivation: {
      basis: meanLine ? 'observed' : 'authored',
      op: meanLine ? 'annotation-mean@1' : 'annotation-valueLine@1',
      // A scoped mean names WHAT it measured (series + inclusive span,
      // escaped like every anchor ref); the whole-plot mean keeps its
      // original ref so existing receipts stay byte-identical.
      inputs: meanLine
        ? [
            {
              ref: scopedMean
                ? `series=${escapeRefPart(scopedMean.seriesId)}${scopedMean.from !== undefined ? `/from=${escapeRefPart(scopedMean.from)}/to=${escapeRefPart(scopedMean.to!)}` : ''}`
                : 'plotted.values',
              value: null,
              state: 'mean',
            },
          ]
        : [{ ref: `${id}.value`, value: v, state: 'authored' }],
      raw: v,
    },
  });
  placeValueLineTargets(s, ann, v);
}

function placeIndicator100(s: AnnotationScope, ann: Extract<Annotation, { kind: 'indicator100' }>): void {
  const { input, id } = s;
  if (!input.yScale) return warn(s, 'unsupported', `indicator100 '${id}': no value scale`);
  const y = input.yScale(100);
  const side = ann.side ?? 'left';
  const x = side === 'left' ? input.plot.x - 6 : input.plot.x + input.plot.w + 6;
  const lineId = s.nid('mark');
  s.nodes.push({
    t: 'line', id: lineId, x1: x - 4, y1: y, x2: x + 4, y2: y,
    stroke: { token: 'ink' }, width: strokeToken(input.theme, 'rule'), owner: { annotationId: id }, part: 'indicator100',
  });
  const font = { family: input.theme.type.family, ...input.theme.type.axis };
  const text = '100%';
  const size = input.measure(text, font);
  s.labelRequests.push({
    id: `indicator100:${id}`,
    kind: 'percentIndicator',
    owner: { annotationId: id },
    text,
    lines: [text],
    typeRole: 'label', font,
    priority: ann.priority ?? PRIORITY.valueLine,
    candidates: [
      {
        slot: side,
        rect: indicator100LabelRect(input.plot, y, size, side),
        penalty: 0,
      },
    ],
  });
  s.placed.push({
    id,
    kind: 'indicator100',
    computedText: text,
    nodeIds: [lineId],
    labelId: `indicator100:${id}`,
    // A fixed 100% reference. Nothing was derived and nothing was
    // measured — the constant is the annotation.
    derivation: { basis: 'authored', op: 'annotation-indicator100@1', inputs: [{ ref: 'reference', value: 100, state: 'constant' }], raw: 100 },
  });
}

/** Leader-routed text callout near an anchor. */
function calloutLabel(
  s: AnnotationScope,
  ann: Annotation,
  anchor: AnchorResolution,
  text: string,
  kind: 'callout' | 'note' | 'delta' | 'abs',
  tone?: 'good' | 'bad',
  /** Drawn text vs claimed value. They differ only on an authored override. */
  computed = text,
  derivation?: AnnotationDerivation,
  glyph?: CalloutGlyphPlan,
): void {
  const { input, id: annId } = s;
  const at = calloutAttachment(anchor, kind, glyph);
  const head = kind === 'callout' ? (ann as { headline?: string; arrow?: boolean }) : {};
  const base = { family: input.theme.type.family, ...input.theme.type.label };
  // An arrow callout and the body under a headline print plain, whatever weight the other callouts print in.
  const font = (head.arrow === true && !glyph) || head.headline !== undefined ? { ...base, weight: input.plainLabelWeight ?? base.weight } : base;
  const rowWidth = input.gridCallouts?.rows.get(annId)?.w ?? input.gridCallouts?.widths?.get(annId);
  const headSourceLines = head.headline?.split('\n').length ?? 0;
  let headlineLines = 0;
  const lines = text.split('\n').flatMap((line, i) => {
    const face = i < headSourceLines ? { ...font, weight: emphasisWeight(input.theme) } : font;
    const wrapped = rowWidth === undefined ? [line]
      : wrapText(line, face, Math.max(1, rowWidth - (glyph ? glyph.radius * 2 + 7 : 0)), Math.max(1, line.length), input.measure).lines;
    if (i < headSourceLines) headlineLines += wrapped.length;
    return wrapped;
  });
  const w = Math.max(...lines.map((line, i) => input.measure(line, i < headlineLines ? { ...font, weight: emphasisWeight(input.theme) } : font).width));
  const lineH = input.measure('X', font).height;
  const h = lineH * lines.length;
  const gap = glyph ? glyph.radius + 7 : 8;
  const prefer = (ann as { preferSide?: string }).preferSide;
  // The seats ring the anchor point, or the box of a mark that prints its own
  // value, so the note never sits on that text. A leader starts at the box
  // edge nearest the note.
  const markBox = kind === 'callout' || kind === 'note' ? at.printed?.box ?? at.markBox : undefined;
  const box = markBox ?? { x: at.x, y: at.y, w: 0, h: 0 };
  const [left, top, right, bottom] = [box.x, box.y, box.x + box.w, box.y + box.h];
  // Beside a mark's box the note sits level with the mark's centre.
  const sideY = (kind === 'callout' || kind === 'note') && !at.printed && at.markBox ? top + box.h / 2 : at.y;
  const round = markBox !== undefined && !at.printed;
  const edgeToward = (r: Rect) => {
    // A bubble leads from its rim, toward the side of the note the
    // leader ends on, not from a corner of its box.
    if (round) {
      const [cx, cy, rad] = [left + box.w / 2, top + box.h / 2, box.w / 2];
      const tx = r.x >= cx ? r.x : r.x + r.w;
      const ty = r.y + r.h / 2;
      const len = Math.hypot(tx - cx, ty - cy) || 1;
      return { x: cx + ((tx - cx) / len) * rad, y: cy + ((ty - cy) / len) * rad };
    }
    return {
      x: Math.min(Math.max(r.x + r.w / 2, left), right),
      y: Math.min(Math.max(r.y + r.h / 2, top), bottom),
    };
  };
  // Another note on the same point leads to it, so a chip there would cover
  // that leader's end and the point: a shared point keeps every chip beside it.
  const samePoint = (ref: AnchorRef) => {
    const found = input.resolve(ref);
    return found !== null && Math.abs(found.x - anchor.x) < 0.5 && Math.abs(found.y - anchor.y) < 0.5;
  };
  const onPoint = glyph !== undefined && box.w === 0 && !input.annotations.some((other) => other !== ann &&
    ['callout', 'note', 'delta', 'abs'].includes(other.kind) && 'at' in other && other.at !== undefined && samePoint(other.at));
  const mk = (slot: string, x: number, y: number, penalty: number, leader = false) => {
    const labelRect = { x, y, w, h };
    if (glyph) {
      const chipOnRight = slot.startsWith('left');
      const chipCenter = {
        x: chipOnRight
          ? labelRect.x + labelRect.w + gap
          : labelRect.x - gap,
        y: labelRect.y + labelRect.h / 2,
      };
      const chipRect = {
        x: chipCenter.x - glyph.radius,
        y: chipCenter.y - glyph.radius,
        w: glyph.radius * 2,
        h: glyph.radius * 2,
      };
      const groupRect = unionRect(labelRect, chipRect);
      const anchor = edgeToward(chipRect);
      glyph.placements.set(slot, { groupRect, labelRect, chipCenter, anchor });
      return { slot, rect: groupRect, penalty, leaderLengthBound: Math.abs(chipCenter.x - anchor.x) + Math.abs(chipCenter.y - anchor.y) };
    }
    return { slot, rect: labelRect, penalty, ...(leader ? { leaderFrom: edgeToward(labelRect) } : {}) };
  };
  let all: SlotCandidate[] = [
    mk(
      'above',
      glyph ? at.x + gap : at.x - w / 2,
      top - h - gap,
      prefer === 'above' ? -1 : 0,
      glyph !== undefined,
    ),
    // Beside a point anchor a glyph's disc sits centred on the point
    // it stands for, and its text beside the disc; beside a box it keeps off it.
    mk('right', right + gap * (onPoint ? 1 : 2), sideY - h / 2, prefer === 'right' ? -1 : 1, true),
    mk('left', left - w - gap * (onPoint ? 1 : 2), sideY - h / 2, prefer === 'left' ? -1 : 2, true),
    mk(
      'below',
      glyph ? at.x + gap : at.x - w / 2,
      bottom + gap,
      prefer === 'below' ? -1 : 3,
      glyph !== undefined,
    ),
    // over or under the first point of a late-starting line, the
    // note may also end at the point, where its own line has not started. The centred seat
    // lost to the line's first climb, and the note moved to the side its author did not ask for.
    ...(at.lineStart && !glyph && !markBox ? [
      mk('aboveLeft', at.x - w - gap, top - h - gap, prefer === 'above' ? -0.5 : 0.5),
      mk('belowLeft', at.x - w - gap, bottom + gap, prefer === 'below' ? -0.5 : 3.05),
    ] : []),
    // Beside a mark's box, a line under or over its centre: the seat next to
    // the point's own name, which takes the centre (scatter bubbles).
    // These seats sit off the mark's rim, so they lead back to it.
    ...(sideY !== at.y ? [
      mk('rightLower', right + gap, sideY + h / 2 + gap / 2, 3.1, true),
      mk('rightUpper', right + gap, sideY - h * 1.5 - gap / 2, 3.2, true),
      mk('leftLower', left - w - gap, sideY + h / 2 + gap / 2, 3.3, true),
      mk('leftUpper', left - w - gap, sideY - h * 1.5 - gap / 2, 3.4, true),
    ] : []),
    // Beside the anchor, one step out from the slot below it, with no
    // leader: the arrow that took the column under the anchor (a funnel
    // diff's drop line) leaves exactly the space next to it, and a
    // label there is still adjacent to its own mark. Reached before the
    // escape ring, whose leader would bend around the drop line on its way
    // down to the band.
    mk('belowRight', right + gap, bottom + gap, 3.5),
    // escape ring: displaced diagonals with leaders, for crowded anchors
    mk('rightFar', right + gap * 5, top - h - gap * 3, 4, true),
    mk('leftFar', left - w - gap * 5, top - h - gap * 3, 5, true),
    mk('belowFar', right + gap * 4, bottom + h + gap * 3, 6, true),
    mk('aboveFar', left - w - gap * 4, bottom + h + gap * 3, 7, true),
  ].sort((a, b) => a.penalty - b.penalty);
  // Beside a row's bar the text wraps to the room left there, before any seat
  // away from the row. The one-line seats stay first when they fit.
  const reach = (kind === 'callout' || kind === 'note') && !glyph && head.arrow !== true && head.headline === undefined
    ? input.calloutRowPitch : undefined;
  if (reach !== undefined) {
    // The row's own labels (a bar's value or total) stand beside the anchor, so the text starts past them.
    const rowLabels = input.occupied.hitsWhich({ x: input.plot.x, y: sideY - 2, w: input.plot.w, h: 4 }).filter((claim) => claim.kind === 'label');
    const from = Math.max(right + gap * 2, ...rowLabels.filter((claim) => claim.rect.x >= right - 1).map((claim) => claim.rect.x + claim.rect.w + gap));
    const to = Math.min(left - gap * 2, ...rowLabels.filter((claim) => claim.rect.x + claim.rect.w <= left + 1).map((claim) => claim.rect.x - gap));
    const wrapBeside = (slot: string, room: number, penalty: number) => {
      if (room >= w || room < lineH * 4) return [];
      const pieces = lines.map((line) => wrapText(line, font, room, 3, input.measure));
      const wrapped = pieces.flatMap((piece) => piece.lines);
      if (pieces.some((piece) => piece.truncated) || wrapped.length < 2 || wrapped.length > 3) return [];
      const ww = Math.max(...wrapped.map((line) => input.measure(line, font).width));
      const rect = { x: slot === 'rightWrap' ? from : to - ww, y: sideY - (lineH * wrapped.length) / 2, w: ww, h: lineH * wrapped.length };
      return [{ slot, rect, penalty, lines: wrapped, leaderFrom: edgeToward(rect) }];
    };
    all = [...all, ...wrapBeside('rightWrap', input.plot.x + input.plot.w - from, 3.45), ...wrapBeside('leftWrap', to - input.plot.x, 3.46)]
      .sort((a, b) => a.penalty - b.penalty);
  }
  // A cell of a grid (a heatmap row): the note's seat is on the cell's own
  // row, beside the grid, first of all. Any other seat leaves the row, so it
  // leads back to the cell and never reads as the neighbour row's note.
  const gridRow = kind === 'callout' || kind === 'note' ? at.row : undefined;
  const onRow = (rect: Rect) => gridRow !== undefined && rect.y + rect.h / 2 >= gridRow.y && rect.y + rect.h / 2 <= gridRow.y + gridRow.h;
  if (gridRow?.end !== undefined) {
    all = [
      mk('rowEnd', gridRow.end + gap * 2, sideY - h / 2, -2, true),
      ...all.map((candidate) => (onRow(candidate.rect) || glyph ? candidate
        : { ...candidate, leaderFrom: candidate.leaderFrom ?? edgeToward(candidate.rect), leaderVertical: true })),
    ];
  }
  // Last resort: deterministic free-space scan — nearest unclaimed spot
  // in the plot, leader-routed. Retires the "callout can't place" class.
  const freeSize = glyph
    ? { w: glyph.radius * 2 + 7 + w, h: Math.max(glyph.radius * 2, h) }
    : { w, h };
  const free = findFreeSpot(input.occupied, input.plot, at, freeSize.w, freeSize.h);
  if (free) {
    // A free spot straight over or under its anchor (a pie
    // callout over its slice) leads from above or below.
    all.push({
      ...mk(
        'freeSpot',
        glyph ? free.x + glyph.radius * 2 + 7 : free.x,
        glyph ? free.y + (freeSize.h - h) / 2 : free.y,
        99,
        true,
      ),
      leaderVertical: true,
    });
  }
  // On a row chart a seat farther than one row from the anchor reads as the text of another row.
  if (reach !== undefined) {
    const limit = Math.max(reach, gap * 3);
    all = all.filter(({ rect }) => Math.max(rect.y - at.y, at.y - rect.y - rect.h, 0) <= limit);
  }
  // A note on a mark inside the plot (a scatter bubble) stays between the
  // plot's top and bottom, off the axis rows.
  if (at.markBox) {
    const { y: plotTop, h: plotH } = input.plot;
    all = all.filter(({ rect }) => rect.y >= plotTop && rect.y + rect.h <= plotTop + plotH);
  }
  // Off a box, a leader crosses no text already on the page: its run from the
  // edge to the note must be clear of every placed label.
  if (box.w > 0) {
    all = all.filter((candidate) => {
      // A glyph chip leads from its own edge to the box; text leads from the box.
      const placement = glyph?.placements.get(candidate.slot);
      const ends = placement
        ? [placement.chipCenter, placement.anchor]
        : candidate.leaderFrom ? [candidate.leaderFrom, leaderTerminus(candidate.rect, candidate.leaderFrom)] : undefined;
      if (!ends) return true;
      const [a, b] = ends as [Point, Point];
      const run = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      return !input.occupied.hitsWhich(run).some((claim) => claim.kind === 'label');
    });
  }
  // An arrow callout first tries the seats beside its point, level with it.
  const arrow = head.arrow === true && !glyph
    ? { anchor: { x: at.x, y: at.y }, nodeIds: [s.nid('arrow'), s.nid('arrowHead')], owner: { annotationId: annId } }
    : undefined;
  if (arrow) all = [...arrowSeats(arrow.anchor, w, h, lineH, prefer), ...all];
  if (arrow || head.headline !== undefined) s.run.calloutHeads.set(`annotation:${annId}`, { font, headline: head.headline !== undefined, headlineLines, headlineWeight: emphasisWeight(input.theme), ...(arrow ? { arrow } : {}) });
  if (input.gridCallouts && (kind === 'callout' || kind === 'note')) {
    const { rows, bounds, grid, sideLimit } = input.gridCallouts;
    const row = rows.get(annId);
    if (row) {
      all = [{ ...mk(row.y >= grid.y + grid.h ? 'belowRow' : 'aboveRow',
        Math.max(row.x + (glyph ? glyph.radius * 2 + 7 : 0), Math.min(at.x - w / 2, row.x + row.w - w)),
        row.y + (row.h - h) / 2, -4, true), outsidePlot: true, leaderVertical: true }];
    } else {
      all.push(mk('leftRow', grid.x - w - gap * 2, sideY - h / 2, -2, true));
      all = all.filter(({ rect }) => rect.x >= bounds.x && rect.x + rect.w <= bounds.x + bounds.w
        && rect.y >= bounds.y && rect.y + rect.h <= bounds.y + bounds.h
        && (rect.x + rect.w <= grid.x || rect.x >= grid.x + grid.w) && w + gap * 2 <= sideLimit);
      all = all.map(candidate => candidate.slot.startsWith(prefer ?? 'right') ? { ...candidate, penalty: -4 } : candidate);
      all.sort((a, b) => a.penalty - b.penalty);
    }
  }
  const owner = glyph
    ? { ...at.owner, annotationId: annId }
    : { annotationId: annId };
  s.labelRequests.push({
    id: `annotation:${annId}`,
    kind: 'annotation',
    owner,
    text,
    lines,
    typeRole: kind === 'note' || kind === 'callout' ? 'footnote' : 'label', font,
    // Authored priority reaches the solver: ann.priority is honoured, so
    // labelDensity:'minimal' keeps these labels at priority 1000 (the
    // AnnotationBase contract). Without one, the default band applies.
    priority: ann.priority ?? PRIORITY.extreme,
    maxLeaderLength: (kind === 'callout' || kind === 'note') && input.calloutLeaderWidths !== undefined
      ? input.calloutLeaderWidths * w : undefined,
    candidates: all, role: calloutRole(kind, text, computed),
    ...((kind === 'callout' || kind === 'note') && input.calloutLeaderClear ? { leaderClear: true } : {}),
    // On a grid, a seat nearer another row's cell than its own is
    // ambiguous, and takes a leader from its cell if nothing else is free.
    ...(gridRow?.end !== undefined ? { anchor: box } : {}),
  });
  if (glyph) s.run.calloutGlyphPlans.set(`annotation:${annId}`, glyph);
  s.placed.push({
    id: annId,
    kind,
    computedText: glyph ? `${glyph.meaning}: ${computed}` : computed,
    tone: tone ?? 'neutral',
    nodeIds: glyph?.nodeIds ?? arrow?.nodeIds ?? [],
    labelId: `annotation:${annId}`,
    ...(derivation ? { derivation } : {}),
  });
}

function calloutGlyphOf(s: AnnotationScope, annotation: Annotation): CalloutGlyph | undefined {
  const glyph = annotation as Annotation & {
    icon?: IconName;
    status?: 'good' | 'bad' | 'warn' | 'info';
  };
  if (glyph.icon && glyph.status) {
    warn(
      s,
      'annotation-glyph-conflict',
      `${annotation.kind} '${s.id}' declares both icon and status — no glyph was drawn`,
      'declare exactly one glyph slot',
    );
    return undefined;
  }
  if (glyph.icon) return { kind: 'icon', name: glyph.icon };
  if (glyph.status) return { kind: 'status', status: glyph.status };
  return undefined;
}

function planCalloutGlyph(
  s: AnnotationScope,
  at: AnchorResolution,
  glyph: CalloutGlyph,
  text: string,
): CalloutGlyphPlan {
  const radius = 11;
  const meaning =
    glyph.kind === 'icon'
      ? `${glyph.name} icon`
      : `${glyph.status} status`;
  const owner = { annotationId: s.id };
  const nodeIds = [s.nid('glyphChip')];
  if (glyph.kind === 'status') {
    nodeIds.push(s.nid('glyphStatus'));
  } else {
    for (const _ of compileIcon(glyph.name, { x: 0, y: 0, w: 16, h: 16 })) {
      nodeIds.push(s.nid('glyphIcon'));
    }
  }
  return {
    glyph,
    nodeIds,
    meaning,
    radius,
    text,
    owner,
    anchor: { x: at.x, y: at.y },
    placements: new Map(),
  };
}

/**
 * Solve the pass's labels, then what depends on where they landed: the
 * comparison links, the callout glyph chips, the orphaned indicator100 ticks
 * and the authored receipts.
 */
function finishAnnotatePass(
  input: AnnotatePassInput,
  run: AnnotateRun,
  nodes: SceneNode[],
  placed: PlacedAnnotation[],
  labelRequests: LabelRequest[],
  warnings: LintWarning[],
): AnnotatePassResult {
  // Authored annotations outrank optional labels: the density gate passes
  // them, unless the author set a priority, which the gate honours.
  const ranked = new Set(input.annotations.flatMap((annotation, index) => annotation.priority === undefined ? [] : [defaultAnnotationId(annotation, index)]));
  for (const request of labelRequests) if (!ranked.has(request.owner.annotationId ?? '')) request.keepWhenDense ??= true;
  const requests = [...labelRequests, ...(input.labelRequests ?? [])];
  // Emit the font used to measure each annotation, including axis-sized band labels.
  // Only a pass that receives the chart's target emits the measured font; most chart types pass none.
  if (input.target) for (const request of requests) request.fontStep ??= request.font;
  const { solved, bandNeed } = settleEraBands(input, run, requests);
  suppressRepeatedPointValues(input, solved);
  if (input.comparisonLayout) pushAll(nodes, input.comparisonLayout.emit(solved.placed));
  input.gapBracket?.engine.finish(run.gapBrackets, solved.placed);
  input.annotations.forEach((annotation, index) => {
    if (annotation.kind !== 'callout' || !annotation.preferSide) return;
    const id = defaultAnnotationId(annotation, index);
    const label = solved.placed.find((entry) => entry.id === `annotation:${id}` && !entry.hidden);
    const anchor = input.resolve(annotation.at);
    if (!label || !anchor) return;
    // Named seats retain their side; free-space seats use the final rectangle.
    const dx = label.rect.x + label.rect.w / 2 - anchor.x;
    const dy = label.rect.y + label.rect.h / 2 - anchor.y;
    const slot = String(label.slot);
    const side = ['left', 'right', 'above', 'below'].find((side) => slot.startsWith(side))
      ?? (slot === 'rowEnd' ? 'right'
        : label.rect.y + label.rect.h <= anchor.y ? 'above'
        : label.rect.y >= anchor.y ? 'below'
        : dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'above' : 'below');
    if (side !== annotation.preferSide) warnings.push({
      code: 'callout-side-changed', severity: 'info',
      message: `Callout '${id}' uses side '${side}' instead of preferSide '${annotation.preferSide}'.`,
      owner: { annotationId: id },
    });
  });
  for (const label of solved.placed) {
    const glyph = run.calloutGlyphPlans.get(label.id);
    if (!glyph) continue;
    const placement = glyph.placements.get(String(label.slot));
    if (!placement) continue;
    label.rect = placement.labelRect;
    if (label.hidden) {
      glyph.nodeIds.splice(0);
      continue;
    }
    label.leader = calloutGlyphLeader(
      placement.chipCenter,
      placement.anchor,
      glyph.radius,
    );
    const glyphNodes = calloutGlyphNodes(glyph, placement.chipCenter, input.theme);
    nodes.push(...glyphNodes);
    const chipRect = {
      x: placement.chipCenter.x - glyph.radius,
      y: placement.chipCenter.y - glyph.radius,
      w: glyph.radius * 2,
      h: glyph.radius * 2,
    };
    input.occupied.claim(chipRect, 'annotation', glyph.owner, 'calloutGlyph');
  }
  finishCalloutHeads(input.theme, solved.placed, run.calloutHeads, nodes, input.occupied);
  // The mark each callout's, note's, abs's or delta's leader runs from (a glyph chip's leader runs to it instead).
  const leaderAnchors = new Map<Id, OwnerRef>();
  input.annotations.forEach((annotation, index) => {
    if (annotation.kind !== 'callout' && annotation.kind !== 'note' && annotation.kind !== 'abs' && annotation.kind !== 'delta') return;
    const id = `annotation:${defaultAnnotationId(annotation, index)}`;
    const owner = run.calloutGlyphPlans.has(id) ? undefined : input.resolve(annotation.at)?.owner;
    if (owner) leaderAnchors.set(id, owner);
  });
  if (leaderAnchors.size > 0) leadersOffAnchorValues(solved.placed, leaderAnchors, input.occupied);
  trimAnnotationGuides(nodes, input.occupied);
  pruneOrphanAnnotationArms(nodes, placed, solved.placed);
  // `band` and `event` carry a span and a caption and no number at all. There
  // is nothing to derive and nothing to measure, so the record says `authored`
  // and stops — an HONEST absence. What it must never do is what every one of
  // these did before: ship `kind:'derived'` with `inputs: []`, which reads to
  // `verify` as a checked derivation and to a consumer as a receipt.
  for (const annotation of placed) {
    if (annotation.derivation) continue;
    annotation.derivation = {
      basis: 'authored',
      op: `annotation-${annotation.kind}@1`,
      inputs: [],
      raw: null,
    };
  }
  return {
    nodes,
    placed,
    labels: solved.placed,
    decisions: solved.decisions,
    warnings: [...warnings, ...solved.warnings],
    legDeficit: run.legDeficit,
    bandNeed,
    gapBracketNeed: Math.max(0, maxOf(run.gapBrackets.map((plan) => plan.need))),
    gapBracketHidden: run.gapBrackets
      .filter((plan) => solved.placed.find((label) => label.id === plan.annotation.labelId)?.hidden)
      .map((plan) => plan.annotation.id),
  };
}

/** Keep an absolute endpoint value only where no visible mark label already prints it. */
function suppressRepeatedPointValues(input: AnnotatePassInput, solved: ReturnType<typeof solveLabels>): void {
  if (!input.annotations.some(annotation => annotation.kind === 'abs')) return;
  const labels = [...(input.printedLabels ?? []), ...solved.placed];
  input.annotations.forEach((annotation, index) => {
    if (annotation.kind !== 'abs') return;
    const id = defaultAnnotationId(annotation, index);
    const value = solved.placed.find(label => label.owner.annotationId === id);
    const at = input.resolve(annotation.at);
    if (!value || !at) return;
    const texts = annotation.text === undefined && at.pointValueText ? [value.text, at.pointValueText] : [value.text];
    const samePoint = (owner: OwnerRef) => owner.categoryId === at.owner.categoryId && owner.seriesId === at.owner.seriesId;
    const printed = labels.find(label => !label.hidden && (
      (['point', 'total', 'grandTotal'].includes(label.kind) && samePoint(label.owner) && texts.includes(label.text))
      || (label.printsFor?.some(samePoint) && texts.some(text => label.text.endsWith(` ${text}`)))
    ));
    if (!printed) return;
    value.hidden = 'redundant';
    value.printedIn = printed.id;
    delete value.leader;
    const decision = solved.decisions.find(entry => entry.labelId === value.id);
    if (decision) { decision.chose = 'hidden'; decision.reason = `printed in label '${printed.id}'`; }
    solved.warnings = solved.warnings.filter(warning => warning.code !== 'label-hidden' || warning.owner?.annotationId !== id);
  });
}

function settleEraBands(
  input: AnnotatePassInput,
  run: AnnotateRun,
  requests: LabelRequest[],
): { solved: ReturnType<typeof solveLabels>; bandNeed: number } {
  if (run.eraBands.length === 0) {
    return { solved: solveLabels(requests, input.occupied, input.solveCtx), bandNeed: 0 };
  }
  for (const plan of run.eraBands) {
    const req = requests.find((r) => r.id === plan.labelId);
    if (!req) continue;
    req.candidates = buildExtendedEraBandCandidates(plan, input, false);
  }
  const solved = solveLabels(requests, input.occupied, input.solveCtx);
  const stillHidden = run.eraBands.filter((plan) => solved.placed.find((l) => l.id === plan.labelId)?.hidden);
  if (stillHidden.length === 0) {
    return { solved, bandNeed: 0 };
  }
  const bounds = input.solveCtx.canvas ?? input.solveCtx.plot;
  const bandLabelIds = new Set(run.eraBands.map((p) => p.labelId));
  const bandAnnotationIds = new Set(run.eraBands.map((p) => p.annotationId));
  let bandNeed = 0;
  for (const plan of stillHidden) {
    const estimateCandidates = buildExtendedEraBandCandidates(plan, input, true);
    const size = input.measure(plan.text || 'X', plan.font);
    const minBracketRoom =
      plan.style === 'bracket' && (plan.bracketY ?? 0) > plan.bandPlot.y
        ? Math.ceil(size.height + 9 - (plan.bandPlot.y - input.plot.y))
        : 0;
    let planNeed = Infinity;
    for (const cand of estimateCandidates) {
      if (cand.rect.x < bounds.x || cand.rect.x + cand.rect.w > bounds.x + bounds.w) continue;
      if (cand.rect.y + cand.rect.h > bounds.y + bounds.h) continue;
      const hits = input.occupied.hitsWhich(cand.rect, 2).filter(
        (o) => !(o.kind === 'annotation' && o.owner.annotationId === plan.annotationId)
          && !(o.kind === 'label' && o.owner.annotationId !== undefined && bandAnnotationIds.has(o.owner.annotationId)),
      );
      const plotHits = hits.filter((o) => !isCeilingClaim(o, input.ceilingRects));
      let hitsPlotLabel = false;
      const ceilingLabels: Rect[] = [];
      for (const l of solved.placed) {
        if (l.hidden || bandLabelIds.has(l.id)) continue;
        if (!rectsOverlap(cand.rect, l.rect, 2)) continue;
        if (input.ceilingRects?.some((r) => rectsOverlap(l.rect, r, 1))) {
          ceilingLabels.push(l.rect);
        } else {
          hitsPlotLabel = true;
          break;
        }
      }
      if (plotHits.length > 0 || hitsPlotLabel) continue;
      let ceilingBottom = input.bandCeiling ?? bounds.y;
      for (const o of hits) {
        ceilingBottom = Math.max(ceilingBottom, o.rect.y + o.rect.h + 2);
      }
      for (const r of ceilingLabels) {
        ceilingBottom = Math.max(ceilingBottom, r.y + r.h + 2);
      }
      if (input.ceilingRects) {
        for (const r of input.ceilingRects) {
          if (cand.rect.x < r.x + r.w + 2 && cand.rect.x + cand.rect.w > r.x - 2) {
            ceilingBottom = Math.max(ceilingBottom, r.y + r.h + 2);
          }
        }
      }
      const needAboveBracket =
        plan.style === 'bracket' && cand.rect.y < plan.bandPlot.y - 7 ? minBracketRoom : 0;
      const need = Math.max(needAboveBracket, Math.ceil(ceilingBottom - cand.rect.y));
      if (need > 0 && need < planNeed) {
        planNeed = need;
      }
    }
    if (Number.isFinite(planNeed)) {
      bandNeed = Math.max(bandNeed, planNeed);
    }
  }
  return { solved, bandNeed };
}

function calloutGlyphLeader(
  chipCenter: Point,
  anchor: Point,
  radius: number,
): PlacedLabel['leader'] {
  const vx = anchor.x - chipCenter.x;
  const vy = anchor.y - chipCenter.y;
  const distance = Math.hypot(vx, vy);
  if (distance <= radius) return undefined;
  const start = {
    x: chipCenter.x + vx / distance * radius,
    y: chipCenter.y + vy / distance * radius,
  };
  const d = leaderPath(start, anchor);
  return { d, curved: d.includes('C') };
}

function calloutGlyphNodes(
  plan: CalloutGlyphPlan,
  center: Point,
  _theme: Theme,
): SceneNode[] {
  const tone = plan.glyph.kind === 'status' ? plan.glyph.status : 'info';
  const paint = { token: tone === 'info' ? 'highlight' : tone } as const;
  const description = `${plan.meaning}: ${plan.text}`;
  const nodes: SceneNode[] = [{
    t: 'circle',
    id: plan.nodeIds[0]!,
    cx: center.x,
    cy: center.y,
    r: plan.radius,
    fill: { token: 'background' },
    stroke: paint, strokeWidth: strokeToken(_theme, 'mark'),
    owner: plan.owner,
    part: 'calloutGlyph',
    display: { state: description },
  }];
  if (plan.glyph.kind === 'status') {
    nodes.push({
      t: 'circle',
      id: plan.nodeIds[1]!,
      cx: center.x,
      cy: center.y,
      r: plan.radius * 0.45,
      fill: paint,
      owner: plan.owner,
      part: 'calloutGlyph',
      display: { state: description },
    });
    return nodes;
  }
  const iconInset = 3;
  const iconRect = {
    x: center.x - plan.radius + iconInset,
    y: center.y - plan.radius + iconInset,
    w: plan.radius * 2 - iconInset * 2,
    h: plan.radius * 2 - iconInset * 2,
  };
  compileIcon(plan.glyph.name, iconRect).forEach((primitive, index) => {
    const id = plan.nodeIds[index + 1]!;
    nodes.push(
      primitive.kind === 'path'
        ? {
            t: 'path',
            id,
            d: primitive.d,
            stroke: paint,
            width: strokeToken(_theme, 'rule'),
            owner: plan.owner,
            part: 'calloutGlyph',
            display: { state: description },
          }
        : {
            t: 'circle',
            id,
            cx: primitive.cx,
            cy: primitive.cy,
            r: primitive.r,
            fill: { token: 'background' },
            stroke: paint, strokeWidth: strokeToken(_theme, 'mark'),
            owner: plan.owner,
            part: 'calloutGlyph',
            display: { state: description },
          },
    );
  });
  return nodes;
}


/**
 * Deterministic nearest-free-rect scan: spiral over a coarse grid from the
 * anchor outward, return the first spot where a w×h rect fits fully inside
 * the plot without hitting any claim. Null when the plot is truly packed.
 */
function findFreeSpot(
  occupied: OccupiedIndex,
  plot: Rect,
  at: { x: number; y: number },
  w: number,
  h: number,
): { x: number; y: number } | null {
  const STEP = 22;
  const candidates: { x: number; y: number; d2: number }[] = [];
  for (let gx = plot.x + 4; gx + w <= plot.x + plot.w - 4; gx += STEP) {
    for (let gy = plot.y + 4; gy + h <= plot.y + plot.h - 4; gy += STEP) {
      const cx = gx + w / 2;
      const cy = gy + h / 2;
      candidates.push({ x: gx, y: gy, d2: (cx - at.x) ** 2 + (cy - at.y) ** 2 });
    }
  }
  candidates.sort((a, b) => a.d2 - b.d2 || a.x - b.x || a.y - b.y);
  for (const c of candidates.slice(0, 400)) {
    if (!occupied.hits({ x: c.x, y: c.y, w, h }, 3)) return { x: c.x, y: c.y };
  }
  return null;
}

function formatYears(years: number): string {
  return Number.isInteger(years) ? `${years} year${years === 1 ? '' : 's'}` : `${years >= 0.01 ? years.toFixed(2) : years.toPrecision(2)} years`;
}
