import { chartString } from '../../strings/waterfall';
import { chartPalette, chartTheme } from '../chartEnv';
import { breakStyleRefusal } from '../band/breakOrder';
import { localeStrings } from '../../strings/waterfall';
import { structureCount } from '../../structureCounts';
import { distinguishSeries } from '../../seriesIdentity';
/**
 * Waterfall / bridge — the flagship. Vertical build-up/-down.
 * The library computes ALL running levels and subtotal/total heights;
 * caller-supplied check values are verified, never trusted.
 */

import { highlightPaintWarnings } from '../../paintWarnings';
import type { PaintWarningRule } from '../../types/scene';
import type { AnchorResolution } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { formatterFromExample, seriesRasterFormatter, signedFormatterFromExample } from '../../formatSpec';
import { boxGap, type Rect } from '../../geometry';
import { createOccupiedIndex } from '../../label/occupied';
import { labelsToNodes } from '../../label/emit';
import {
  isDateNumericTickSequence,
  type TickBandDerived,
} from '../../label/tickRow';
import { haloOverpaintedInsideLabels, withSegmentSeams } from '../../markVisibility';
import {
  labelCtx,
  PRIORITY,
  SERIES_VALUE_GAP,
  solveLabels,
  type LabelRequest,
  type SlotCandidate,
  type SolveCtx,
} from '../../label/solver';
import { accessibleTitle, NormalizeError, normalizeCell, normalizeScenario, resolveHighlight, resolveSize } from '../../normalize/shared';
import {
  bandScale,
  brokenLinearScale,
  crossesLinearBreak,
  invalidLinearBreakReason,
  linearScale,
  niceDomain,
  type LinearBreak,
} from '../../scale';
import { applyValueAxisTitleInk, axisTitleAllowed, planValueAxisTitle, valueAxisTitleBand, valueAxisTitleRequest, barBreakCut, straightBreakGlyph } from '../../axis';
import { axisBreakInvalid } from '../../axisBreakInvalid';
import { axisBreakHeightOrderWarning, breakReversesOrder, type BreakBar } from '../../axisBreakOrder';
import { valueLineExtent } from '../../valueLineDomain';
import { formatAutomaticNumber as plainNumber } from '../../format';
import { authoredDecimals } from '../../formatPrecision';
import { authoredNotes, frameTextOptions, legendRequired, normalizeLegendOption, solveFrame, fixedPlotChrome, type LegendItemInput, plotHeightAfter } from '../../frame';
import { defaultMeasurer, type FontSpec } from '../../text';
import { categoryLineAlign, categoryRowTop, hangingLabelReserve, planCategoryRow, rotatedClaimRect, rotatedLeftOverhang } from '../../label/categoryRow';
import {
  canvasMargin,
  effectiveFill,
  markRolePaint,
  paintColor,
  panelTypeClass,
  seriesPaint as themeSeriesPaint,
  signedFillPaint,
  emphasisWeight,
  dashToken,
  strokeToken,
  secondaryType,
} from '../../theme';
import type { AnchorRef } from '../../types/annotations';
import { cellMeta, cellValue, isPctCell, type Direction, type Id } from '../../types/cell';
import type { WaterfallData, WaterfallItem } from '../../types/data';
import type { WaterfallOptions } from '../../types/options';
import { HEIGHT_STRUCTURE } from '../../types/sizing';
import type { Theme } from '../../types/theme';
import type {
  Geometry,
  LintWarning,
  Paint,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import { stackSegmentCandidates } from '../../label/slots';
import { digitSeat, digitSeatEdge, segmentTooShort, STACK_ROOM } from '../band/labels';
import { fitText, lineBox } from '../../label/fitText';
import { fitColumn, GUTTER_MAX_SHARE, stepDownFont } from '../../label/rowFit';
import { composedTextRole } from '../../textRole';
import { scenarioLegendKeys } from '../../label/legendFidelity';
import { textScaleOf } from '../../typeFloors';
import { disclosureNote } from '../../notes';
import { bandSizing, NATURAL_BAND_STEP } from '../../sizing';
import { floorValueLabel, printedValueLabel, valueLabelPlotFloor } from './bandFloor';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface WaterfallMarks {
  bars: { id: Id; rect: Rect; segments: { id: Id; rect: Rect; nodeId: Id }[] }[];
  connectors: { from: Id; to: Id; nodeId: Id }[];
}

/**
 * Where each total came from. The OPENING total of a build-up is an AUTHORED
 * input (`items[0].value`); every later total is the running sum of the deltas
 * since the last anchor. Before this existed both shapes were emitted as
 * `kind:'derived', op:'waterfall-total@1', inputs: []` — byte-for-byte
 * identical records for a number someone typed and a number the engine summed,
 * on the flagship type. That is the authored-versus-derived distinction the
 * annotation records already make; the waterfall total had no way to make it
 * because the layout never told it which was which.
 */
export type TotalBasis =
  | { authored: true; ref: string }
  | { authored: false; inputs: { ref: Id; value: number }[] };

export interface WaterfallDerived {
  /** `balance` is set on a subtotal drawn from the baseline (`toBaseline`): the running level that carries on past its block sum. */
  levels: Record<Id, { start: number; end: number; min?: number; max?: number; balance?: number }>;
  totals: Record<Id, number>;
  /** One entry per key of `totals` — the operands the receipt has to carry. */
  totalBasis: Record<Id, TotalBasis>;
  /**
   * The tick band receipt. Vertical only: the horizontal transpose turns
   * category labels into a left label column, so it strips this.
   */
  tickBand?: TickBandDerived;
}

interface NormItem {
  id: Id;
  label: string;
  type: 'delta' | 'subtotal' | 'total';
  date?: string;
  toBaseline: boolean;
  checkValue: number | null;
  segments: ({ id: Id; label?: string; value: number; colorRole?: string; scenario?: string; fill?: string } & ValueCellText)[];
  authoredSegments: boolean;
  scenario?: string;
  direction?: Direction;
  /** The item value cell's own format, label and priority, for the value printed over the step or on the total. */
  valueMeta?: ValueCellText;
}

/** A value cell's format, label override ("${value}" or false) and label priority, which the waterfall honours. */
interface ValueCellText { format?: string; valueLabel?: string | false; priority?: number }

function cellText(meta: { format?: string; label?: string | false; priority?: number } | null | undefined): ValueCellText {
  return {
    ...(meta?.format !== undefined ? { format: meta.format } : {}),
    ...(meta?.label !== undefined ? { valueLabel: meta.label } : {}),
    ...(meta?.priority !== undefined ? { priority: meta.priority } : {}),
  };
}

/**
 * How far a bridge connector stops short of each bar corner, in DEVICE units.
 * A flush connector reads as part of the bar outline.
 */
const BRIDGE_END_GAP = 1;

/**
 * Pull both ends of every bridge connector `BRIDGE_END_GAP` along its own
 * direction.
 *
 * This is a separate pass, applied to FINAL coordinates, and that placement is
 * the whole point. A gap baked into the endpoints where they are built would
 * land before `variant: 'horizontal'` transposes the scene. The transpose maps
 * y to x with a flip and an anisotropic scale, so such a gap delivers well
 * under 1 device unit (about 0.4) on a horizontal waterfall instead of 1px.
 * An offset expressed in device units is applied per orientation AFTER
 * transposition.
 *
 * The vertical path is bit-identical, not merely close: a vertical bridge is
 * axis-aligned with dx > 0, so len === dx exactly, ux === 1 and uy === 0 in
 * IEEE-754, and `(bx + bw) + 1 * 1` equals `bx + bw + 1` bit for bit.
 */
function insetBridgeEnds(scene: readonly SceneNode[]): SceneNode[] {
  return scene.map((node) => {
    if (node.t !== 'line' || node.part !== 'connector') return node;
    const dx = node.x2 - node.x1;
    const dy = node.y2 - node.y1;
    const length = Math.hypot(dx, dy);
    // A band gap narrower than the two air gaps together would invert the
    // segment. Not reachable in the shipped population (the smallest gap
    // anywhere is 15.21 units) but it is reachable at roughly 46 rows.
    if (length <= 2 * BRIDGE_END_GAP + 1e-9) return node;
    const ux = (dx / length) * BRIDGE_END_GAP;
    const uy = (dy / length) * BRIDGE_END_GAP;
    return { ...node, x1: node.x1 + ux, y1: node.y1 + uy, x2: node.x2 - ux, y2: node.y2 - uy };
  });
}

/**
 * A sliver of a mixed-sign step that cannot hold its value
 * prints outside the column, on the side away from its sibling sub-bars:
 * level with the sliver, then just over it, then just under it, each with a
 * hairline leader from the sliver's outer edge that the solver draws once the
 * seat is off level. A middle sub-bar has siblings on both sides and takes
 * the right, then the left.
 */
function mixedSliverSeats(rect: Rect, tsize: { width: number; height: number }, k: number, n: number,
  sides: ('right' | 'left')[] = k === n - 1 ? ['right'] : k === 0 ? ['left'] : ['right', 'left'],
  extraRows = false,
): SlotCandidate[] {
  // An off-level seat stands a leader's run out from the column, so the leader has room to show.
  const levels = [
    { name: 'Level', top: rect.y + rect.h / 2 - tsize.height / 2, gap: SLIVER_SEAT_GAP },
    { name: 'Over', top: rect.y - tsize.height - SLIVER_SEAT_GAP, gap: SLIVER_LEADER_GAP },
    { name: 'Under', top: rect.y + rect.h + SLIVER_SEAT_GAP, gap: SLIVER_LEADER_GAP },
    ...(extraRows ? [2, 3].flatMap(row => [
      { name: `Over${row}`, top: rect.y - row * (tsize.height + SLIVER_SEAT_GAP), gap: SLIVER_LEADER_GAP },
      { name: `Under${row}`, top: rect.y + rect.h + (row - 1) * (tsize.height + SLIVER_SEAT_GAP) + SLIVER_SEAT_GAP, gap: SLIVER_LEADER_GAP },
    ]) : []),
  ];
  return sides.flatMap((side, s) => levels.map((level, l): SlotCandidate => {
    const edge = side === 'right' ? rect.x + rect.w : rect.x;
    return {
      slot: `sliver${side === 'right' ? 'Right' : 'Left'}${level.name}`,
      rect: { x: side === 'right' ? edge + level.gap : edge - level.gap - tsize.width, y: level.top, w: tsize.width, h: tsize.height },
      penalty: s * levels.length + l,
      leaderFrom: { x: edge, y: rect.y + rect.h / 2 },
    };
  }));
}

/** Air between a sliver and its value outside the column. */
const SLIVER_SEAT_GAP = 4;
/** An off-level value's distance from the column: past the leader gutter, so the hairline shows. */
const SLIVER_LEADER_GAP = 10;

export function layoutWaterfall(
  data: WaterfallData,
  options: WaterfallOptions = {},
): Geometry<WaterfallMarks, WaterfallDerived> {
  if (options.variant === 'horizontal') return layoutHorizontalWaterfall(data, options);
  // The annotate pass reports how much vertical headroom was missing to give
  // every CAGR drop leg its minimum length (without it the end leg turns into
  // a stub on closing-heavy bridges). One deterministic
  // re-run with the annotation band widened by exactly that deficit; charts
  // without a deficit return their first pass byte-identically.
  // withBridgeGap sits HERE and not inside layoutWaterfallWithPad on purpose:
  // the horizontal path calls that helper too, and applying the gap there would
  // bake it in before the transpose — the exact defect this pass exists to fix,
  // and it would then be applied twice.
  const withBridgeGap = (
    geometry: Geometry<WaterfallMarks, WaterfallDerived>,
  ): Geometry<WaterfallMarks, WaterfallDerived> => ({
    ...geometry,
    scene: insetBridgeEnds(geometry.scene),
  });
  // The cagr band starts at 12 px and grows in 6 px steps while an
  // annotation label finds no seat (up to 60 px: a broken axis keeps less
  // headroom over the top bar) or a leg is short (up to 30 px). A band that
  // grew takes 4 px more, so the label does not touch the key. A label
  // nothing seats gets the 30 px band. A leg still short widens by its
  // deficit.
  let pad = 0;
  let pass = layoutWaterfallWithPad(data, options, pad, true, undefined, !options.annotations?.length);
  const cagr = (options.annotations ?? []).some((a) => a.kind === 'cagr');
  const unseated = (geometry: Geometry<WaterfallMarks, WaterfallDerived>) =>
    geometry.labels.some((label) => label.id.startsWith('annotation:') && label.hidden === 'collision');
  while (cagr && pad < 48 && (unseated(pass.geometry) || (pad < 18 && pass.annotationLegDeficit > 0))) {
    pad += 6;
    pass = layoutWaterfallWithPad(data, options, pad, true, undefined, false);
  }
  if (pad > 0) {
    pad = unseated(pass.geometry) ? 18 : pad + 4;
    pass = layoutWaterfallWithPad(data, options, pad, true, undefined, false);
  }
  // A leg short by half a pixel or less reads as full length (as on column); another round
  // would add 3 px of band and could push a fixed card under its plot floor.
  for (let i = 0; i < 3 && pass.annotationLegDeficit > 0.5; i++) {
    pad += Math.ceil(pass.annotationLegDeficit) + 2;
    pass = layoutWaterfallWithPad(data, options, pad, true, undefined, false);
  }
  // A note or callout the seat cascade could not seat falls to the free-space scan, which
  // draws no leader when it lands over its step. On a broken axis the bars stand 12 px
  // under the key, too close for the far seats that lead back to the step. The band
  // grows in 6 px steps until they open; a chart that gains no seat keeps its first pass.
  const freeSeated = (geometry: Geometry<WaterfallMarks, WaterfallDerived>) =>
    geometry.labels.some((label) => label.id.startsWith('annotation:') && label.slot === 'freeSpot');
  // A grown pass is kept only if every note stays drawn and it raises no new warning: the
  // shorter plot can hide a note that the first pass drew.
  const noteHidden = (geometry: Geometry<WaterfallMarks, WaterfallDerived>) =>
    geometry.labels.some((label) => label.id.startsWith('annotation:') && label.hidden);
  if (!cagr && freeSeated(pass.geometry)) {
    const warned = pass.geometry.warnings?.length ?? 0;
    for (let grown = 6; grown <= 48; grown += 6) {
      const next = layoutWaterfallWithPad(data, options, grown, true, undefined, false);
      if (!freeSeated(next.geometry) && !noteHidden(next.geometry) && (next.geometry.warnings?.length ?? 0) <= warned) { pass = next; break; }
    }
  }
  // First settle the annotation band with the original break. A moved break
  // must not change the band search and falsely raise a fixed card's floor.
  if (pass.unsafeBreak) {
    pass = pass.repairBreak!();
    // The repaired break can lift the bars into the band the growth label had, which would
    // send the label to the note at 320 px. The band grows again for
    // the repaired bridge, by the same 6 px steps, before the label gives up its seat.
    if (cagr && unseated(pass.geometry)) {
      let repairPad = pad;
      let repaired = pass;
      while (repairPad < 48 && unseated(repaired.geometry)) {
        repairPad += 6;
        repaired = layoutWaterfallWithPad(data, options, repairPad, true, undefined, true);
      }
      if (!unseated(repaired.geometry)) {
        const settled = layoutWaterfallWithPad(data, options, repairPad + 4, true, undefined, true);
        pass = unseated(settled.geometry) ? repaired : settled;
      }
    }
  }
  return withBridgeGap(pass.geometry);
}

function layoutHorizontalWaterfall(
  data: WaterfallData,
  options: WaterfallOptions,
): Geometry<WaterfallMarks, WaterfallDerived> {
  const authoredAnnotations = options.annotations ?? [];
  const verticalOptions: WaterfallOptions = {
    ...options,
    variant: 'vertical',
    annotations: [],
  };
  // No annotations in this pass, so no leg deficit and no second pass.
  const source = layoutWaterfallWithPad(data, verticalOptions, 0, false).geometry;
  const plot = source.plot;
  const theme = chartTheme(options);
  const measure = options.measure ?? defaultMeasurer;
  // The names read in a left column, so each takes up to 40% of the
  // plot's width at the axis font, then a second line, instead of carrying the
  // vertical row's 45° cut.
  const nameFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const nameBudget = plot.w * 0.4 - 20;
  const categoryLabels = source.labels.filter((label) => label.kind === 'category');
  // under a render target a name wraps only where its row has the
  // height of two lines, may widen the column to the gutter share, and the
  // column takes its one type step as a whole.
  const barCenters = source.marks.bars.map((bar) => bar.rect.x + bar.rect.w / 2).sort((a, b) => a - b);
  const rowPitch = barCenters.length > 1 ? ((barCenters[1]! - barCenters[0]!) * plot.h) / plot.w : plot.h;
  const nameLines = rowPitch >= 2 * lineBox(nameFont) + 2 ? 2 : 1;
  const nameColumn = fitColumn(categoryLabels.map((label) => ({
    text: label.title ?? label.text, font: nameFont, maxWidth: nameBudget, maxLines: nameLines,
    wider: plot.w * GUTTER_MAX_SHARE - 20, shrink: stepDownFont(theme, nameFont, 'axis', options.target, textScaleOf(options)), target: options.target, textScale: textScaleOf(options), typeRole: 'axis' as const,
  })), measure);
  const names = new Map(categoryLabels.map((label, index) => [label.id, nameColumn[index]!] as const));
  // The vertical row thins its names where the columns crowd (catPlan.keep); a row form gives each
  // name its own row, so every name prints.
  const categoryLabelWidth = Math.max(
    0,
    // Every name the column prints, including one the vertical row lost to its rotation.
    maxOf(source.labels
      .filter((label) => label.kind === 'category')
      .map((label) => names.get(label.id)!.w)),
  );
  const valueLabelWidth = Math.max(
    0,
    maxOf(source.labels
      .filter(
        (label) =>
          (label.kind === 'segment' || label.kind === 'total') &&
          !label.hidden,
      )
      .map((label) => label.rect.w)),
  );
  const leftReserve = Math.min(plot.w * GUTTER_MAX_SHARE, Math.max(48, categoryLabelWidth + 20));
  const rightReserve = Math.min(plot.w * 0.18, Math.max(32, valueLabelWidth + 20));
  const horizontalPlot: Rect = {
    x: plot.x + leftReserve,
    y: plot.y,
    w: Math.max(80, plot.w - leftReserve - rightReserve),
    h: plot.h,
  };
  const transformPoint = (x: number, y: number) => ({
    x:
      horizontalPlot.x +
      ((plot.y + plot.h - y) / plot.h) * horizontalPlot.w,
    y:
      horizontalPlot.y +
      ((x - plot.x) / plot.w) * horizontalPlot.h,
  });
  const transformRect = (rect: Rect): Rect => {
    const a = transformPoint(rect.x, rect.y);
    const b = transformPoint(rect.x + rect.w, rect.y + rect.h);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  };
  const transformRectKeepSize = (rect: Rect): Rect => {
    const center = transformPoint(rect.x + rect.w / 2, rect.y + rect.h / 2);
    return { x: center.x - rect.w / 2, y: center.y - rect.h / 2, w: rect.w, h: rect.h };
  };
  const slotMap: Record<string, string> = {
    outsideTop: 'outsideRight',
    outsideTopShifted: 'outsideRightShifted',
    outsideBottom: 'outsideLeft',
    outsideBottomShifted: 'outsideLeftShifted',
    below: 'left',
    belowShifted: 'leftShifted',
    outsideRight: 'below',
    outsideLeft: 'above',
  };
  const mapSlot = (slot: string): string => slotMap[slot] ?? slot;
  const protectedNodeIds = new Set<Id>();
  Object.values(source.frame).forEach((value) => {
    if (typeof value === 'string') protectedNodeIds.add(value);
    else if (Array.isArray(value)) value.forEach((id) => protectedNodeIds.add(id));
  });
  source.legend?.items.forEach((item) => {
    protectedNodeIds.add(item.swatchNodeId);
    protectedNodeIds.add(item.labelId);
  });
  // Vertical labels are solved again below; only transform the retained marks and frame.
  const generatedLabelNodeIds = new Set(
    source.labels.flatMap((label) => [
      `label:${label.id}`,
      `leader:${label.id}`,
      `swatch:${label.id}`,
    ]),
  );
  const scene = source.scene.filter((node) => !generatedLabelNodeIds.has(node.id)).map((node): SceneNode => {
    // Every frame node (a wrapped subtitle's second line included) stays where the frame put it.
    if (protectedNodeIds.has(node.id) || node.id.startsWith('frame:')) return node;
    if (node.t === 'rect') return { ...node, rect: transformRect(node.rect) };
    if (node.t === 'line') {
      const from = transformPoint(node.x1, node.y1);
      const to = transformPoint(node.x2, node.y2);
      return { ...node, x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    }
    // Annotations are suppressed above, generated labels are removed, and
    // frame/legend nodes are protected. Waterfall marks and break glyphs
    // contain only rectangles and lines. Fail if a future mark changes that.
    throw new Error(`horizontal waterfall cannot transpose unexpected '${node.t}' node '${node.id}'`);
  });
  const marks: WaterfallMarks = {
    bars: source.marks.bars.map((bar) => ({
      ...bar,
      rect: transformRect(bar.rect),
      segments: bar.segments.map((segment) => ({
        ...segment,
        rect: transformRect(segment.rect),
      })),
    })),
    connectors: source.marks.connectors.map((connector) => ({ ...connector })),
  };
  const axes = source.axes.map((axis) => ({
    ...axis,
    axis: axis.axis === 'x' ? ('y' as const) : ('x' as const),
    ticks: axis.ticks.map((tick) => ({
      ...tick,
      pos:
        axis.axis === 'x'
          ? transformPoint(tick.pos, plot.y).y
          : transformPoint(plot.x, tick.pos).x,
    })),
  }));
  const nonLabelOccupied = source.debug.occupied
    .filter((entry) => entry.kind !== 'label')
    .map((entry) =>
      entry.kind === 'frame' || entry.kind === 'legend'
        ? entry
        : { ...entry, rect: transformRect(entry.rect) },
    );
  const occupied = createOccupiedIndex(horizontalPlot);
  nonLabelOccupied.forEach((entry) =>
    occupied.claim(entry.rect, entry.kind, entry.owner, entry.part),
  );
  const barById = new Map(marks.bars.map((bar) => [bar.id, bar]));
  const highlights = new Set(resolveHighlight(options.highlight));
  const fontForLabel = (label: PlacedLabel): FontSpec => label.kind === 'category'
    ? names.get(label.id)?.font ?? nameFont
    : { family: theme.type.family, ...theme.type.label,
      // A highlighted step's value is bold at the label size, as the totals are (the vertical bridge's strongFont).
      ...(label.kind === 'total' || (label.id.startsWith('sum:') && highlights.has(label.owner.categoryId ?? '')) ? { weight: emphasisWeight(theme) } : { size: Math.min(theme.type.label.size, secondaryType(theme).size) }) };
  const labelRequests: LabelRequest[] = source.labels.map((label) => {
    const name = label.kind === 'category' ? names.get(label.id)! : undefined;
    const textSize = measure(label.text, fontForLabel(label));
    const transformed = { ...transformRectKeepSize(label.rect), w: name?.w ?? textSize.width, h: name?.h ?? textSize.height };
    const bar = label.owner.categoryId
      ? barById.get(label.owner.categoryId)
      : undefined;
    const rowCenter = bar
      ? bar.rect.y + bar.rect.h / 2
      : transformed.y + transformed.h / 2;
    const categoryRect: Rect = {
      x: horizontalPlot.x - transformed.w - 8,
      y: rowCenter - transformed.h / 2,
      w: transformed.w,
      h: transformed.h,
    };
    const outsideRight: Rect = {
      x: (bar ? bar.rect.x + bar.rect.w : transformed.x + transformed.w) + 8,
      y: rowCenter - transformed.h / 2,
      w: transformed.w,
      h: transformed.h,
    };
    const insideCenter: Rect = {
      x: bar
        ? bar.rect.x + bar.rect.w / 2 - transformed.w / 2
        : transformed.x,
      y: rowCenter - transformed.h / 2,
      w: transformed.w,
      h: transformed.h,
    };
    const outsideLeft: Rect = {
      x: (bar ? bar.rect.x : transformed.x) - transformed.w - 8,
      y: rowCenter - transformed.h / 2,
      w: transformed.w,
      h: transformed.h,
    };
    const candidates: SlotCandidate[] =
      label.kind === 'category'
        ? [{ slot: 'left', rect: categoryRect, penalty: 0 }]
        : [
            { slot: 'outsideRight', rect: outsideRight, penalty: 0 },
            // A value sits inside only with 4 px per side; wider, it would cross the bar's edge.
            ...(!bar || transformed.w + 8 <= bar.rect.w ? [{ slot: 'insideCenter' as const, rect: insideCenter, penalty: 1, needsBacking: true }] : []),
            { slot: 'outsideLeft', rect: outsideLeft, penalty: 2 },
          ];
    const authoredPin = options.labelPlacements?.[label.id];
    return {
      id: label.id,
      kind: label.kind,
      owner: label.owner,
      text: name ? label.title ?? label.text : label.text,
      lines: name ? name.lines : label.lines,
      ...(name?.title !== undefined ? { title: name.title } : !name && label.title !== undefined ? { title: label.title } : {}),
      font: fontForLabel(label),
      priority: label.priority,
      ...(authoredPin ? { pinnedSlot: mapSlot(authoredPin) } : {}),
      candidates,
      ...(label.hidden === 'redundant' && label.kind !== 'category' ? { redundant: true } : {}),
      ...(label.swatch ? { swatch: label.swatch } : {}),
    };
  });
  const horizontalPins = Object.fromEntries(
    Object.entries(options.labelPlacements ?? {}).map(([id, slot]) => [id, mapSlot(slot)]),
  );
  const solved = solveLabels(labelRequests, occupied, labelCtx(theme, source.size, options, {
    focus: undefined,
    pins: horizontalPins,
    measure,
    plot: horizontalPlot,
    labelPad: 2,
  }));
  const labels = solved.placed;
  // The sign bridge's value ink outside the bar, as vertically.
  if (isSignBridge(theme, options)) {
    for (const label of labels) {
      const id = label.id.startsWith('sum:') ? label.id.slice('sum:'.length) : undefined;
      const level = id === undefined ? undefined : source.derived.levels[id];
      const tone = level ? stepTone(level.end - level.start, data.items.find((it) => it.id === id)?.direction) : 'neutral';
      if (tone !== 'neutral' && label.slot !== 'insideCenter') label.ink = { token: tone };
    }
  }
  pushAll(scene, labelsToNodes(theme, labels, fontForLabel, scene));
  const annotationWarning: LintWarning[] =
    authoredAnnotations.length === 0
      ? []
      : [
          {
            code: 'horizontal-annotations-unsupported',
            severity: 'warn',
            message: `horizontal waterfall does not support ${[...new Set(authoredAnnotations.map((annotation) => `'${annotation.kind}'`))].join(', ')}; annotations suppressed`,
            suggest: 'remove the annotation or use variant:vertical',
          },
        ];
  // The vertical helper's tick-band receipt does not survive the transpose:
  // its category labels become the left label column. A receipt describing
  // a band this orientation never draws would be a false claim, so it is
  // stripped, not forwarded.
  const { tickBand: _verticalTickBand, ...horizontalDerived } = source.derived;
  // A horizontal bridge is a row form. Its narrowest canvas holds the name column, a bar
  // run of 80 px (the plot floor above) and the value reserve, beside the chrome around the plot.
  // The column counts each name uncut (a cut name is a defect), and it may take at most
  // GUTTER_MAX_SHARE of the plot. A name too wide for one line takes two, and its row the height
  // of two lines: each row needs its name lines and the solver's pad, so the automatic height
  // grows until no name collides with its neighbour.
  const uncutWidth = (label: PlacedLabel, lines: number): number => {
    const font = names.get(label.id)!.font;
    const cut = (width: number) => fitText(label.title ?? label.text, font, width, lines, measure, { target: options.target, textScale: textScaleOf(options), typeRole: 'axis' }).title !== undefined;
    let [lo, hi] = [0, 600];
    if (cut(hi)) return hi;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (cut(mid)) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  const oneLine = Math.max(0, maxOf(categoryLabels.map((label) => uncutWidth(label, 1))));
  const twoLines = oneLine + 20 > plot.w * GUTTER_MAX_SHARE;
  // The narrowest canvas sets its names on two lines; a wider one may keep them on one.
  const nameNeed = Math.max(0, maxOf(categoryLabels.map((label) => uncutWidth(label, 2))));
  const minPlotW = Math.max(Math.max(48, nameNeed + 20) + 80 + Math.max(32, valueLabelWidth + 20), (nameNeed + 20) / GUTTER_MAX_SHARE);
  // The row pitch is the band step turned on its side (rowPitch above), so the plot height scales with it.
  const rowsNeed = ((twoLines ? 2 : 1) * lineBox(nameFont) + 2) * (barCenters.length > 1 ? plot.w / (barCenters[1]! - barCenters[0]!) : 1) + 1;
  const measured = bandSizing('waterfall', source.size, plot.w, NATURAL_BAND_STEP, minPlotW);
  if (source.sizing?.[HEIGHT_STRUCTURE]) measured[HEIGHT_STRUCTURE] = true;
  return {
    ...source,
    sizing: { ...measured, minHeight: Math.max(measured.minHeight, Math.ceil(source.size.height - plot.h + rowsNeed)) },
    derived: horizontalDerived,
    plot: horizontalPlot,
    // Applied here, after transformPoint has produced final device coordinates
    // and after the label solve has pushed its nodes, so the gap is 1 device
    // unit measured on screen in this orientation too.
    scene: insetBridgeEnds(scene),
    labels,
    axes,
    annotations: [],
    marks,
    a11y: {
      ...source.a11y,
      desc: source.a11y.desc.replace(chartString(options, 'waterfallChart'), chartString(options, 'horizontalWaterfall')),
    },
    warnings: [
      ...source.warnings.filter((warning) => warning.code !== 'label-hidden'),
      ...solved.warnings,
      ...annotationWarning,
    ],
    debug: {
      occupied: occupied.snapshot(),
      decisions: solved.decisions,
    },
  };
}

/** Cap height of lining digits as a share of the font size (Helvetica, Inter: 0.72). */
const DIGIT_CAP = 0.72;

/** Two significant digits, rounded down: 1,284.6 -> 1,200. */
function floorTwoDigits(value: number): number {
  const unit = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.floor(value / unit + 1e-9) * unit;
}

/**
 * A step under this share of the axis top draws as a sliver on a whole axis.
 * Set from the fixture bridges: the bridges that read better broken have a
 * median step of at most 0.125 of the top (pvm 0.065-0.087, two-case 0.051,
 * sign-bridge 0.125); the ones that read well whole have 0.161 or more
 * (repeated-segment-key 0.161, cost-bridge 0.167, single-delta 0.200).
 */
const SLIVER_STEP = 0.15;

/**
 * The break requested by `valueAxis.break: 'auto'` when its smallest total is at
 * least twice the span of the running level, every level is positive and the
 * median step would be a sliver on a whole axis (SLIVER_STEP).
 * `to` sits a quarter span under the lowest level; `from` keeps the stub under
 * the break at most 0.4 of the visible span, so the steps get over half the plot.
 */
function automaticBreak(
  allItems: readonly NormItem[],
  levels: WaterfallDerived['levels'],
  totals: WaterfallDerived['totals'],
  line: { lo: number; hi: number } | null,
): LinearBreak | undefined {
  const deltas = allItems.filter((it) => it.type === 'delta');
  const totalValues = allItems.filter((it) => it.type !== 'delta').map((it) => totals[it.id]!);
  if (deltas.length === 0 || totalValues.length === 0) return undefined;
  const deltaLevels = deltas.flatMap((it) => {
    const level = levels[it.id]!;
    return [level.start, level.end, level.min ?? level.start, level.max ?? level.end];
  });
  const running = [...deltaLevels, ...totalValues];
  const runLo = minOf(running);
  const runHi = maxOf(running);
  const span = runHi - runLo;
  const totalMin = minOf(totalValues);
  const steps = deltas.map((it) => Math.abs(levels[it.id]!.end - levels[it.id]!.start)).sort((a, b) => a - b);
  const medianStep = steps[Math.floor(steps.length / 2)]!;
  if (!(runLo > 0) || !(span > 0) || !(totalMin >= 2 * span) || !(medianStep < SLIVER_STEP * runHi)) return undefined;
  const to = floorTwoDigits(runLo - span / 4);
  const from = floorTwoDigits(Math.min(totalMin * 0.05, (runHi - to) * 0.4));
  const axisBreak = { from, to };
  const drawn = [...deltaLevels, ...(line ? [line.lo, line.hi] : [])];
  return invalidLinearBreakReason([0, runHi], axisBreak, drawn) ? undefined : axisBreak;
}

function layoutWaterfallWithPad(
  data: WaterfallData,
  options: WaterfallOptions,
  extraAnnPad: number,
  /** False when the horizontal layout transposes this one: its names read in a left column, not in a row under the plot. */
  categoryRow = true,
  automaticOverride?: LinearBreak,
  enforceBreakOrder = true,
): { geometry: Geometry<WaterfallMarks, WaterfallDerived>; annotationLegDeficit: number; unsafeBreak?: boolean;
  repairBreak?: () => { geometry: Geometry<WaterfallMarks, WaterfallDerived>; annotationLegDeficit: number; unsafeBreak?: boolean } } {
  const fmtPlain = (value: number, settings: Parameters<typeof plainNumber>[1] = {}) => plainNumber(value, { locale: options.locale?.language, ...settings });
  const warnings: LintWarning[] = [];
  const theme = chartTheme(options);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const highlights = new Set(resolveHighlight(options.highlight));
  // Sign colouring: totals in color.total, each step in its
  // sign's fill with its signed label in the sign's ink, on dotted meta
  // connectors. A theme names it once for every bridge, the pvm included.
  const signBridge = isSignBridge(theme, options);
  const signSteps = stepsBySign(theme, options);
  const connectorStroke: Paint = { token: signBridge ? 'inkMeta' : 'leader' };
  const connectorDash = dashToken(theme, signBridge ? 'dotted' : 'reference');
  const stepTones = new Map<Id, 'good' | 'bad' | 'neutral'>();
  // A warm red or orange accent on a bridge step reads as a loss, whatever
  // the sign of the step.
  const paintWarningRules: PaintWarningRule[] = highlights.size > 0 ? [{ kind: 'highlight-reads-as-loss', chart: 'waterfall', before: warnings.length }] : [];
  if (paintWarningRules.length) warnings.push(...highlightPaintWarnings(theme, 'waterfall'));
  const build = options.build ?? 'up';

  // ---- normalize ----
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    throw new NormalizeError('empty-data', 'items', 'waterfall requires at least one item');
  }
  // A multi-case bridge normalises each case's values as items '<item>:<case>'
  // whose one segment is the case; `items` keeps one per step for the band,
  // the names and the ids.
  const cases = data.cases ?? [];
  if (cases.length > 0 && options.variant === 'horizontal') {
    throw new NormalizeError('waterfall-cases-horizontal', 'options.variant', 'a bridge with cases draws vertically: its cases stand side by side in each step', "drop variant: 'horizontal', or draw one bridge per case");
  }
  // A case bar's id is '<item>:<case>'. With no colon in a case id the case
  // is what follows the last colon, so no two bars share an id: item 'a' in
  // case 'b:c' and item 'a:b' in case 'c' would both be 'a:b:c'.
  const colonCase = cases.findIndex((c) => c.id.includes(':'));
  if (colonCase >= 0) {
    throw new NormalizeError('waterfall-case-id-colon', `cases[${colonCase}].id`, `case id '${cases[colonCase]!.id}' holds ':', which joins an item id to its case id in the bars, levels and claims ('<item>:<case>'), so two bars could share one id`, 'give the case an id without a colon', undefined, ['data', 'cases', colonCase, 'id']);
  }
  const caseItems = cases.map((c, k) => data.items.map((raw, i) => caseItem(raw, i, c.id, k)));
  const items = cases.length > 0 ? data.items.map((raw, i) => ({ ...caseItems[0]![i]!, id: raw.id })) : data.items.map(normalizeItem);
  const allItems = cases.length > 0 ? caseItems.flat() : items;
  // Emphasis matches item ids only; pvm lands here with its bridge items.
  for (const id of highlights) {
    if (items.some((it) => it.id === id)) continue;
    warnings.push({
      code: 'highlight-unknown-id',
      severity: 'warn',
      message: `highlight '${id}' names no bar of this bridge and emphasises nothing`,
      suggest: `highlight one of the bar ids: ${items.map((it) => it.id).join(', ')}`,
      field: ['options', 'highlight'],
    });
  }
  // An authored example controls precision. Otherwise the bridge shares
  // one precision across its values and segments.
  const authoredValues = allItems.flatMap((it) => [it.checkValue, ...it.segments.map((seg) => seg.value)]);
  const { fmt, fmtSigned } = seriesRasterFormatter(options.format, authoredValues, options.locale?.language, options.unit, options.target);
  // A check value is an authored number the bridge does not draw: the bar
  // draws the sum. Off by more than the summed numbers' own rounding allows
  // (half a unit of the finest decimal place THEY are written to, once per
  // summand) it is a mismatch. Off by less it is still a second number, and an
  // integer input can be an exact count, so it is disclosed: an info message
  // and a reading note name both. Only the numbers this check adds up count, so
  // a precise step elsewhere does not tighten it. Both print at that precision
  // (or the check value's own, when finer), so they never read alike, and a
  // mismatch never reads "10.254231 ≠ 10.25". Returns undefined when they agree.
  const checkValueNotes: string[] = [];
  const checkAgainstSum = (supplied: number, computed: number, summed: number[]) => {
    const gap = Math.abs(supplied - computed);
    // Safe integers compare exactly, but only when every summand and every partial sum is one:
    // a fraction added to an integer near 1e15 rounds away in the float sum. Otherwise allow the summands' binary rounding.
    let partial = 0;
    const exact = Number.isSafeInteger(supplied) && summed.every((value) => Number.isSafeInteger(value) && Number.isSafeInteger(partial += value));
    const noise = exact ? 0 : sumRoundoff(summed);
    if (gap <= noise) return undefined;
    const decimals = Math.max(0, maxOf(summed.map(authoredDecimals)));
    // A diagnostic prints at its inputs' own precision, past the four-decimal cap, so two different numbers never read alike.
    const shown = Math.max(decimals, authoredDecimals(supplied));
    const printed: [string, string] = [fmtPlain(supplied, { decimals: shown, automatic: false }), fmtPlain(computed, { decimals: shown, automatic: false })];
    return { printed, withinRounding: gap <= summed.length * 0.5 * 10 ** -decimals + noise };
  };
  const discloseRoundedCheck = (it: NormItem, k: number | undefined, printed: [string, string], what: 'checkTotalNote' | 'checkSegmentsNote') => {
    const name = k === undefined ? it.label : `${it.label} (${cases[k]!.label ?? cases[k]!.id})`;
    warnings.push({
      code: 'check-value-rounded',
      severity: 'info',
      message: `${it.type} '${it.id}': supplied ${printed[0]} differs from the computed ${printed[1]} by less than its inputs' rounding; the computed ${printed[1]} is drawn and a note names both`,
      owner: { categoryId: it.id },
    });
    checkValueNotes.push(disclosureNote(chartString(options, what, { v1: name, v2: printed[1], v3: printed[0] })));
  };

  // Segment ids are series identities: one canonical label/color assignment
  // is reused by every item and by the legend.
  const segmentCatalog = new Map<
    string,
    { id: Id; label?: string; colorRole?: string; scenario?: string; slot: number }
  >();
  for (const it of items) {
    if (!it.authoredSegments) continue;
    for (const seg of it.segments) {
      const known = segmentCatalog.get(seg.id);
      if (!known) {
        segmentCatalog.set(seg.id, {
          id: seg.id,
          label: seg.label,
          colorRole: seg.colorRole,
          scenario: seg.scenario,
          slot: segmentCatalog.size,
        });
        continue;
      }
      const conflicts = [
        known.label && seg.label && known.label !== seg.label ? `label '${seg.label}'` : null,
        known.colorRole && seg.colorRole && known.colorRole !== seg.colorRole
          ? `colorRole '${seg.colorRole}'`
          : null,
      ].filter((v): v is string => v !== null);
      if (conflicts.length > 0) {
        warnings.push({
          code: 'segment-identity-mismatch',
          severity: 'warn',
          message: `segment '${seg.id}' reuses ${conflicts.join(' and ')}; first authored identity wins`,
          owner: { categoryId: it.id, segmentId: seg.id },
        });
      }
      if (!known.label && seg.label) known.label = seg.label;
      if (!known.colorRole && seg.colorRole) known.colorRole = seg.colorRole;
      if (!known.scenario && seg.scenario) known.scenario = seg.scenario;
    }
  }

  const fixedKeys: LegendItemInput[] = [];
  if (items.some(it => it.type !== 'delta' && !it.authoredSegments)) fixedKeys.push({ id: '__keyTotal', label: chartString(options, 'total'), paint: { token: 'total' } });
  const segmentPaints = new Map(distinguishSeries([
    ...fixedKeys,
    ...[...segmentCatalog.values()].map(identity => ({
      id: identity.id, label: identity.label ?? identity.id, paint: rawIdentityPaint(identity), pattern: scenarioPattern(identity.scenario),
    })),
  ], new Set([...fixedKeys.map(key => key.id), ...[...segmentCatalog.values()].filter(identity => identity.colorRole).map(identity => identity.id)]),
  Array.from({ length: theme.color.series.length }, (_, i) => themeSeriesPaint(i, paletteRamp ? options.palette : undefined)), theme)
    .map(identity => [identity.id, identity.paint]));
  // A segment colour within 2:1 of the total's reads as a small total. On a vertical bridge it
  // takes a light tint of the first segment colour that stands apart from the total instead (B2B #5E99C5, B2C its 60% tint).
  // The choice reads the theme, so each plain segment keeps it as a segment-apart recipe that a repaint resolves again.
  if (categoryRow) {
    const plainIds = [...segmentCatalog.values()].filter((identity) => !identity.colorRole && segmentPaints.has(identity.id)).map((identity) => identity.id);
    const plain = plainIds.map((id) => segmentPaints.get(id)!);
    const others = [...segmentPaints].filter(([id]) => !plainIds.includes(id)).map(([, paint]) => paint);
    plainIds.forEach((id, index) => {
      const own = plain[index]!;
      const paint: Paint = { token: 'token' in own ? own.token : 'neutral', theme: { kind: 'segment-apart', plain, others, index } };
      paintColor(theme, paint);
      segmentPaints.set(id, paint);
    });
  }

  // ---- derive: running levels ----
  const connectors = data.connectors ?? [];
  const hiddenAfter = new Set(connectors.filter((c) => c.hidden).map((c) => c.from));
  const connectorInto = new Map(connectors.filter((c) => !c.hidden).map((c) => [c.to, c]));
  // Two or more cases (data.cases) run one bridge each over the same steps;
  // their levels key by '<item>:<case>'.
  const bridges = cases.length > 0 ? caseItems.map(deriveBridge) : [deriveBridge(items)];
  const levels: WaterfallDerived['levels'] = bridges.reduce<WaterfallDerived['levels']>((all, bridge) => Object.assign(all, bridge.levels), emptyIdRecord());
  const totals: WaterfallDerived['totals'] = bridges.reduce<WaterfallDerived['totals']>((all, bridge) => Object.assign(all, bridge.totals), emptyIdRecord());
  const totalBasis: WaterfallDerived['totalBasis'] = bridges.reduce<WaterfallDerived['totalBasis']>((all, bridge, k) =>
    Object.assign(all, Object.fromEntries(Object.entries(bridge.totalBasis).map(([id, basis]) => [id, basis.authored && cases.length > 0
      ? { authored: true as const, ref: `${data.items[caseItems[k]!.findIndex((it) => it.id === id)]!.id}.values.${k}` }
      : basis]))), emptyIdRecord());
  const derivedTotalSegments = new Map(bridges.flatMap((bridge) => [...bridge.derivedTotalSegments]));
  const anchorLevel = bridges[0]!.anchorLevel;

  /** The running levels of one bridge: an item's start and end, totals, their receipts. `k` is the case. */
  function deriveBridge(items: NormItem[], k?: number) {
    const levels: WaterfallDerived['levels'] = emptyIdRecord();
    const totals: WaterfallDerived['totals'] = emptyIdRecord();
    const totalBasis: WaterfallDerived['totalBasis'] = emptyIdRecord();
    const derivedTotalSegments = new Map<Id, NormItem['segments']>();

    /** Exit level of an item through an anchor ('sum' | segmentId). */
    const anchorLevel = (itemId: Id, anchor?: 'sum' | Id): number | null => {
      const it = items.find((x) => x.id === itemId);
      const lvl = levels[itemId];
      if (!it || !lvl) return null;
      if (!anchor || anchor === 'sum') return it.type === 'delta' ? lvl.end : lvl.balance ?? totals[itemId]!;
      let cum = lvl.start;
      for (const seg of it.segments) {
        cum += seg.value;
        if (seg.id === anchor) return cum;
      }
      warnings.push({
        code: 'unknown-anchor',
        severity: 'warn',
        message: `connector anchor '${anchor}' is not a segment of '${itemId}' — using sum`,
        owner: { categoryId: itemId },
      });
      return it.type === 'delta' ? lvl.end : lvl.balance ?? totals[itemId]!;
    };

    /** Where an item's authored value sits: `value`, or a case's slot in `values`. */
    const valueRef = (index: number) => (k === undefined ? `${data.items[index]!.id}.value` : `${data.items[index]!.id}.values.${k}`);
    /**
     * An opening total without a value, solved backward: the next total that has
     * a value, minus the plain deltas between them. Null when anything in
     * between moves the running sum another way (a connector, a hidden
     * connector, a delta to the baseline) or no later total has a value.
     */
    const backwardOpenings = new Map<Id, { value: number; inputs: { ref: Id; value: number }[] }>();
    function backwardOpening(open: NormItem): number | null {
      const deltas: number[] = [];
      const inputs: { ref: Id; value: number }[] = [];
      if (hiddenAfter.has(open.id)) return null;
      for (const next of items.slice(items.indexOf(open) + 1)) {
        if (connectorInto.has(next.id)) return null;
        if (next.type !== 'delta') {
          if (next.checkValue === null) return null;
          const value = compensatedSum([next.checkValue, ...deltas.map((delta) => -delta)]);
          backwardOpenings.set(open.id, { value, inputs: [{ ref: valueRef(items.indexOf(next)), value: next.checkValue }, ...inputs] });
          return value;
        }
        if (next.toBaseline || hiddenAfter.has(next.id)) return null;
        const sum = compensatedSum(next.segments.map((seg) => seg.value));
        pushAll(deltas, next.segments.map((seg) => seg.value));
        inputs.push({ ref: next.id, value: -sum });
      }
      return null;
    }

    let running = 0;
    /** The operands of `running` since its last anchor: the level is their compensated sum, so it draws the exact sum. */
    let operands: number[] = [];
    /** The authored numbers `running` adds up, for the rounding a check value is allowed. */
    let summed: number[] = [];
    const summedAt: Record<Id, number[]> = emptyIdRecord();
    let started = false;
    /**
     * The operand list whose sum IS `running`, maintained under the same four
     * events that move `running` (re-anchor, total, delta, hidden connector), so
     * a total's receipt can name what the engine actually added up. Invariant:
     * `sum(contributions.map(c => c.value)) === running`, asserted below.
     */
    let contributions: { ref: Id; value: number }[] = [];
    /** The deltas since the last baseline: what a subtotal drawn `toBaseline` adds up. */
    let block: { ref: Id; value: number }[] = [];
    let compositionEligible = true;
    let hasSegmentedDelta = false;
    // Each series keeps its raw steps, so its total and the segment sum use the
    // same compensated sum as the running level.
    let composition = new Map<Id, number[]>();
    for (const it of items) {
      // Re-anchored connector into this item: continue from the anchor level
      // instead of the previous running sum, so everything
      // after the anchor is recomputed.
      const inbound = connectorInto.get(it.id);
      if (inbound && levels[inbound.from]) {
        const lvl = anchorLevel(inbound.from, inbound.anchor);
        if (lvl !== null) {
          running = lvl;
          operands = [lvl];
          summed = summedAt[inbound.from] ?? summed;
          contributions = [
            { ref: `level:${inbound.from}${inbound.anchor ? `:${inbound.anchor}` : ''}`, value: lvl },
          ];
        }
        // A scalar connector anchor cannot recover the series composition of
        // its new starting level truthfully.
        compositionEligible = false;
        hasSegmentedDelta = false;
        composition = new Map();
        block = [];
      }
      if (it.type === 'total' || it.type === 'subtotal') {
        // A leading total opens the bridge at its authored value. Without one it
        // is derived backward from the next total that has a value, when only
        // plain deltas lie between them; otherwise the chart is refused, since
        // an opening of zero would draw every level after it wrong.
        const wasStarted = started;
        const opening = wasStarted ? null : it.checkValue ?? backwardOpening(it);
        if (!wasStarted && opening === null) {
          const index = items.indexOf(it);
          warnings.push({
            code: 'waterfall-opening-missing',
            severity: 'error',
            message: `${it.type} '${it.id}' opens the bridge without a value and cannot be derived backward: no later total with a value follows across plain deltas only`,
            suggest: `Give '${it.id}' its value, or give the closing total its value so the opening is derived backward.`,
            field: k === undefined ? ['data', 'items', index, 'value'] : ['data', 'items', index, 'values', k],
            owner: { categoryId: it.id },
          });
        }
        // A subtotal with toBaseline prints the deltas since the last baseline; the running balance carries on.
        const blockSum = it.type === 'subtotal' && it.toBaseline && wasStarted;
        const value = blockSum ? compensatedSum(block.map((c) => c.value)) : wasStarted ? running : (opening ?? 0);
        if (!started) {
          running = value;
          // A backward opening is the next total's authored value less plain deltas.
          summed = [it.checkValue ?? backwardOpenings.get(it.id)?.inputs[0]!.value ?? 0];
        }
        levels[it.id] = blockSum ? { start: 0, end: value, balance: running } : { start: 0, end: value };
        totals[it.id] = value;
        // An opening total anchors the chart at a number the DOCUMENT supplied.
        // Nothing was summed, so nothing can be re-summed, and calling it derived
        // would be a claim the engine cannot support.
        const derivedOpening = wasStarted ? undefined : backwardOpenings.get(it.id);
        totalBasis[it.id] = blockSum
          ? { authored: false, inputs: block.map((c) => ({ ...c })) }
          : wasStarted
          ? { authored: false, inputs: contributions.map((c) => ({ ...c })) }
          : derivedOpening
            ? { authored: false, inputs: derivedOpening.inputs }
            : { authored: true, ref: `${it.id}.value` };
        // Collapse the span: the next total's receipt reads "this total, plus the
        // deltas since" rather than replaying the whole chart.
        if (!blockSum) {
          contributions = [{ ref: it.id, value }];
          operands = [value];
        }
        const totalCheck = started && it.checkValue !== null ? checkAgainstSum(it.checkValue, value, blockSum ? block.map((c) => c.value) : summed) : undefined;
        if (totalCheck?.withinRounding) discloseRoundedCheck(it, k, totalCheck.printed, 'checkTotalNote');
        const totalMismatch = totalCheck && !totalCheck.withinRounding ? totalCheck.printed : undefined;
        if (totalMismatch) {
          warnings.push({
            code: 'derived-mismatch',
            severity: 'warn',
            message: `${it.type} '${it.id}': supplied ${totalMismatch[0]} ≠ computed ${totalMismatch[1]} — computed wins`,
            owner: { categoryId: it.id },
          });
        }
        if (it.type === 'total' || blockSum) block = [];
        if (!wasStarted && Math.abs(value) > 1e-9) compositionEligible = false;
        if (it.type === 'total' && wasStarted && compositionEligible && hasSegmentedDelta) {
          const seriesTotals = [...segmentCatalog.values()].map((identity) => ({
            id: identity.id,
            label: identity.label,
            value: compensatedSum(composition.get(identity.id) ?? []),
            colorRole: identity.colorRole,
            scenario: identity.scenario,
          }));
          // The segments add up the drawn series totals, so the check does not depend on the step
          // order; the total itself sums in step order, so they may differ by the float rounding of
          // the summands (0.25 at 2e15), never by an absolute 1e-9.
          const segmentSum = compensatedSum(seriesTotals.map((seg) => seg.value));
          if (Math.abs(segmentSum - value) <= sumRoundoff([...composition.values()].flat())) {
            const totalSegments = seriesTotals.filter((seg) => Math.abs(seg.value) > 1e-9);
            if (totalSegments.length > 0) derivedTotalSegments.set(it.id, totalSegments);
          }
        }
      } else {
        const segmentValues = it.segments.map((seg) => seg.value);
        const sum = compensatedSum(segmentValues);
        const sumCheck = it.authoredSegments && it.checkValue !== null ? checkAgainstSum(it.checkValue, sum, segmentValues) : undefined;
        if (sumCheck?.withinRounding) discloseRoundedCheck(it, k, sumCheck.printed, 'checkSegmentsNote');
        const sumMismatch = sumCheck && !sumCheck.withinRounding ? sumCheck.printed : undefined;
        if (sumMismatch) {
          warnings.push({
            code: 'derived-mismatch',
            severity: 'warn',
            message: `delta '${it.id}': supplied ${sumMismatch[0]} != segment sum ${sumMismatch[1]}; computed wins`,
            owner: { categoryId: it.id },
          });
        }
        if (it.toBaseline) {
          compositionEligible = true;
          hasSegmentedDelta = false;
          composition = new Map();
        }
        const start = it.toBaseline ? 0 : running;
        operands = [...(it.toBaseline ? [] : operands), ...segmentValues];
        const end = compensatedSum(operands);
        levels[it.id] = { start, end };
        running = end;
        summed = [...(it.toBaseline ? [] : summed), ...segmentValues];
        if (it.toBaseline) {
          contributions = [];
          block = [];
        }
        contributions.push({ ref: it.id, value: sum });
        block.push({ ref: it.id, value: sum });
        if (it.authoredSegments && compositionEligible) {
          hasSegmentedDelta = true;
          for (const seg of it.segments) {
            composition.set(seg.id, [...(composition.get(seg.id) ?? []), seg.value]);
          }
        } else {
          compositionEligible = false;
        }
      }
      started = true;
      summedAt[it.id] = summed;
      if (hiddenAfter.has(it.id)) {
        running = 0;
        operands = [];
        summed = [];
        started = false;
        contributions = [];
        block = [];
        compositionEligible = true;
        hasSegmentedDelta = false;
        composition = new Map();
      }
    }
    return { levels, totals, totalBasis, derivedTotalSegments, anchorLevel };
  }

  // The running level only exposes an item's start and mathematical sum.
  // Preserve the complete segment traversal separately: mixed signs can pass
  // beyond both endpoints, and that painted truth must drive the domain.
  const traversalExtrema: Record<Id, { min: number; max: number }> = emptyIdRecord();
  const markPatterns = new Set<LegendItemInput['pattern']>();
  const segmentsFor = (it: NormItem): NormItem['segments'] => derivedTotalSegments.get(it.id) ??
    (it.type === 'delta' ? it.segments : [{ ...it.segments[0]!, value: totals[it.id]! }]);
  for (const it of allItems) {
    let cursor = levels[it.id]!.start;
    let min = cursor;
    let max = cursor;
    for (const segment of segmentsFor(it)) {
      markPatterns.add(scenarioPattern(segment.scenario ?? it.scenario));
      cursor += segment.value;
      min = Math.min(min, cursor);
      max = Math.max(max, cursor);
    }
    traversalExtrema[it.id] = { min, max };
    const level = levels[it.id]!;
    if (min < Math.min(level.start, level.end) || max > Math.max(level.start, level.end)) {
      level.min = min;
      level.max = max;
    }
  }

  const preparedWarnings = warnings.slice();
  // Preserve the author's request when a safety repair rebuilds without a break.
  const recommendBreak = options.valueAxis?.break === undefined || options.valueAxis.break === false;
  return drawBridge(options, automaticOverride, enforceBreakOrder);

  // Break repairs reuse the normalized items, running levels, segments and paints.
  function drawBridge(options: WaterfallOptions, automaticOverride?: LinearBreak, enforceBreakOrder = true): ReturnType<typeof layoutWaterfallWithPad> {
  const warnings = preparedWarnings.slice();
  // ---- scales & frame ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const legendItems: LegendItemInput[] = [...segmentCatalog.values()].map((identity) => ({
    id: identity.id,
    label: identity.label ?? identity.id,
    paint: identityPaint(identity),
    pattern: scenarioPattern(identity.scenario),
  }));
  // Each case keys its own colour: the bars of a step stand side by side, and only the key says which is which.
  pushAll(legendItems, cases.map((c, k) => ({ id: c.id, label: c.label ?? c.id, paint: casePaint(k) })));
  // A key that names segment colours also names the plain step colour where
  // steps draw in it. Totals and highlighted steps get no entry: the category
  // row names a total and emphasis is never a key entry.
  const plain = (it: NormItem) => !derivedTotalSegments.has(it.id) && !it.authoredSegments && !it.segments.some((seg) => seg.fill || segmentCatalog.has(seg.id));
  const keyed = legendItems.length > 0;
  // a lower-is-better step paints a rise bad, which its signed label
  // does not say, so the bridge names its tones as a sign-coloured column
  // does; legend 'none' drops that key and warns.
  const inverted = cases.length === 0 && (signBridge || signSteps) &&
    items.some((it) => plain(it) && it.type === 'delta' && it.direction === 'lowerIsBetter' && Boolean(it.checkValue) && !highlights.has(it.id));
  if ((keyed || inverted) && cases.length === 0) {
    const steps = items.filter((it) => plain(it) && it.type === 'delta' && !highlights.has(it.id));
    if (signBridge || signSteps) {
      // sign-coloured steps keep column's words, "Increase (better)".
      const words = localeStrings(options.locale?.language);
      const keys = new Map<string, LegendItemInput>();
      for (const increase of [true, false]) {
        const word = increase ? 'Increase' : 'Decrease';
        for (const it of steps) {
          const value = it.segments.reduce((sum, seg) => sum + seg.value, 0);
          const tone = stepTone(value, it.direction);
          if (tone === 'neutral' || (value > 0) !== increase) continue;
          const meaning = tone === 'good' ? options.strings?.better ?? words.better : options.strings?.worse ?? words.worse;
          keys.set(`${word}:${tone}`, { id: `__key${word}:${tone}`, label: `${chartString(options, increase ? 'increase' : 'decrease')} (${meaning})`, paint: tonePaint(tone) });
        }
      }
      legendItems.push(...keys.values());
    } else if (steps.length > 0) {
      legendItems.push({ id: '__keyStep', label: chartString(options, 'change'), paint: paletteRamp ? themeSeriesPaint(0, options.palette) : { token: 'neutralMark' } });
    }
  }
  const scenarioKeys = scenarioLegendKeys({
    markPatterns,
    keyPatterns: legendItems.map((item) => item.pattern),
    paint: { token: 'neutralMark' },
    strings: options.strings,
  });
  legendItems.push(...scenarioKeys);
  // Every item names a segment colour or a scenario hatch that no bar label
  // names, so a waterfall that paints one keeps its key. A grid panel leaves
  // the key to the grid legend, which collects it.
  const required = keyed || scenarioKeys.length > 0;
  if (inverted && !required && options.legend === 'none') {
    warnings.push({ code: 'legend-suppressed-encoding', severity: 'warn', message: "legend: 'none' hides the key naming the inverted lower-is-better colours", suggest: "drop legend: 'none'" });
  }
  const legendOpts = required && panelTypeClass(options) === undefined
    ? legendRequired(options.legend, warnings, 'waterfall', theme, cases.length > 0 ? 'its case colours are named nowhere else' : 'its segment colours and scenario hatches are named nowhere else')
    : normalizeLegendOption(options.legend, inverted && panelTypeClass(options) === undefined ? { position: 'top' } : undefined);
  if (legendOpts?.order) {
    const rank = new Map(legendOpts.order.map((id, i) => [id, i]));
    legendItems.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }
  // every bridge keeps the whole axis unless a break is requested.
  const breakOption = options.valueAxis?.break;
  const requestedBreak = typeof breakOption === 'object' ? breakOption : undefined;
  const autoBreak = breakOption === 'auto'
    ? automaticOverride ?? automaticBreak(allItems, levels, totals, valueLineExtent(options.annotations))
    : undefined;
  const axisBreak = requestedBreak ?? autoBreak;
  // A broken value axis is disclosed on the exhibit itself. The
  // note is decided from the request; an invalid break refuses the chart
  // below, so the note never ships without the break.
  const breakNote = axisBreak
    ? disclosureNote(chartString(options, 'axisBreakNote', { v1: fmtPlain(axisBreak.from), v2: fmtPlain(axisBreak.to) }))
    : undefined;
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      footnotes: [...authoredNotes(options), ...checkValueNotes, ...(breakNote ? [breakNote] : [])],
      ...(legendOpts && legendItems.length > 0
        ? { legend: { options: legendOpts, items: legendItems } }
        : {}),
      theme,
      measure,
    },
    occupied,
  );

  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  // The band only depends on the frame's x-extent, so it can be built before
  // the plot: category labels are wrapped and measured up front, and when
  // adjacent wrapped labels are wider than the band step the axis reserves a
  // second tier row that the belowShifted candidates stagger into.
  // On a vertical bridge a bar that is too narrow for
  // its widest segment value (with 2 px each side) widens, up to 74% of its column, so the value
  // reads inside its segment instead of in the note. Only an unset bandFraction moves.
  const segmentValueWidth = categoryRow && options.bandFraction === undefined && options.labels !== false && cases.length === 0
    ? Math.max(0, maxOf(items.filter((it) => it.authoredSegments && !(it.segments.some((seg) => seg.value > 0) && it.segments.some((seg) => seg.value < 0)))
      .flatMap((it) => it.segments.map((seg) => measure(it.type === 'delta' ? fmtSigned(seg.value) : fmt(seg.value), { family: theme.type.family, ...theme.type.label }).width + 4))))
    : 0;
  const fractionFor = (w: number) => {
    const base = options.bandFraction ?? 0.62;
    if (segmentValueWidth === 0) return base;
    // The step does not depend on the fraction: inner and outer padding trade off one for one.
    const step = w / (items.length + 0.1);
    return Math.min(0.74, Math.max(base, segmentValueWidth / step));
  };
  const bandFor = (x0: number, w: number) =>
    bandScale(items.length, [x0, x0 + w], {
      paddingInner: 1 - fractionFor(w),
      paddingOuter: (1 - fractionFor(w)) / 2 + 0.05,
    });
  let plotLeft = frameResult.plot.x;
  let plotWidth = frameResult.plot.w;
  let band = bandFor(plotLeft, plotWidth);
  // Date/numeric ticks are one line on one row; prose wraps to two
  // and may stagger into the second tier row when adjacent labels crowd.
  const dateNumericTicks = isDateNumericTickSequence(items.map((it) => it.label));
  // One cascade decides the whole row (wrap, font step, uniform
  // stride for dates, 45° for prose); no name is hidden by a local sweep.
  const planRowAt = (b: typeof band, widths?: number[]) =>
    planCategoryRow({
      labels: items.map((it) => it.label),
      centers: items.map((_, i) => b.center(i)),
      step: b.step,
      ...(widths ? { widths } : {}),
      fonts: [tickFont, { family: theme.type.family, ...theme.type.footnote }],
      measure,
      plotHeight: frameResult.plot.h,
      target: options.target, textScale: textScaleOf(options),
      range: b.range, spreadBeforeRotate: categoryRow,
    });
  // The upright spread before the 45° step lives in planCategoryRow.
  // A horizontal bridge draws no row, so it skips the spread.
  const planRow = (b: typeof band) => planRowAt(b);
  let catPlan = planRow(band);
  // A rotated first name hangs left of its bar; the plot yields that much.
  const catOverhang = categoryRow ? rotatedLeftOverhang(catPlan, items.map((_, i) => band.center(i)), 4) : 0;
  if (catOverhang > 0) {
    plotLeft += catOverhang;
    plotWidth -= catOverhang;
    band = bandFor(plotLeft, plotWidth);
    catPlan = planRow(band);
  }
  const catInfos = catPlan.infos;
  const catFont = catPlan.font;
  const catRowH = catPlan.rowHeight;
  const catTickMaxLines = catPlan.maxLines;
  const CAT_TIER_GAP = 4;
  const catStaggerExtra = catPlan.rowHeight - catTickMaxLines * catFont.size * (catFont.lineHeight ?? 1.2);
  // A horizontal bridge reads its names in a left column: no row under the plot.
  const catBandH = categoryRow ? catPlan.rowHeight + 8 : 0;
  // The row's findings (a rotation, a font step) describe a row a horizontal bridge never draws.
  if (categoryRow) pushAll(warnings, catPlan.warnings);
  // spanning annotations (cagr) need arm headroom above the tallest bar
  // 12 px for the arms; the second pass adds what the arms still lack.
  const annPad = (options.annotations ?? []).some((a) => a.kind === 'cagr') ? 12 + extraAnnPad : extraAnnPad;
  const axisTitle = categoryRow && axisTitleAllowed(options.labels) ? planValueAxisTitle(options.axisTitles?.primary, theme, measure, plotWidth) : undefined;
  const axisTitleBand = valueAxisTitleBand(axisTitle, theme, measure, annPad);
  const plot: Rect = {
    x: plotLeft,
    y: frameResult.plot.y + 8 + annPad + axisTitleBand,
    w: plotWidth,
    h: plotHeightAfter(frameResult, size.height, frameResult.plot.h - catBandH - 8 - annPad - axisTitleBand),
  };

  const lineExtent = valueLineExtent(options.annotations); // a drawn value line is part of the stated range
  let lo = Math.min(0, lineExtent?.lo ?? 0), hi = Math.max(0, lineExtent?.hi ?? 0);
  for (const it of allItems) {
    const traversal = traversalExtrema[it.id]!;
    lo = Math.min(lo, traversal.min);
    hi = Math.max(hi, traversal.max);
  }
  // Headroom is RELATIVE on both sides (pure-negative: 8% of |lo|); `|| -lo`
  // catches denormal underflow, Math.min keeps the span representable, `|| 1`
  // is only the all-zero convention.
  const negativeHeadroom = -lo * 0.08 || -lo;
  // A horizontal bridge prints its values in a reserve right of the plot, so
  // the plot keeps no headroom for them.
  const headroomHi =
    hi > 0 ? hi * (categoryRow ? 1.08 : 1) : lo < 0 ? Math.min(negativeHeadroom, Number.MAX_VALUE + lo) : 0;
  // Mixed-sign domains snap BOTH edges, so the raw-mark envelope can drop to
  // 0.70 while each side clears the 0.15 cap. The ink-envelope gate measures
  // marks PLUS value labels, and the label band over the extreme bars is what
  // carries the shapes the snap leaves wide. Capping the SUM here instead
  // would crush the label air over small-magnitude extremes and lose top
  // value labels, which trades a label for geometry.
  let [dLo, dHi] = niceDomain(lo, headroomHi || 1, 5, {
    dataExtent: [lo, hi],
    maxWasteFraction: 0.15,
  });
  // An opt-in straight break on the value axis. Only total bars
  // may cross the omitted span; every delta must lie fully on one side of it,
  // or the chart would show a step at a scale its neighbours do not share.
  let activeBreak: LinearBreak | undefined;
  if (autoBreak) {
    activeBreak = autoBreak;
    // Headroom over the visible span, not over the whole base.
    dHi = hi + (hi - autoBreak.to) * 0.08;
  } else if (requestedBreak) {
    const deltaItems = allItems.filter((it) => it.type === 'delta');
    const deltaLevels = deltaItems.flatMap((it) => [traversalExtrema[it.id]!.min, traversalExtrema[it.id]!.max]);
    const straddling = deltaItems.find((it) =>
      crossesLinearBreak(traversalExtrema[it.id]!.min, traversalExtrema[it.id]!.max, requestedBreak),
    );
    const reason = breakStyleRefusal(requestedBreak)
      ?? (straddling
          ? `delta '${straddling.label}' spans the omitted range ${requestedBreak.from} to ${requestedBreak.to}`
          : invalidLinearBreakReason([dLo, dHi], requestedBreak, deltaLevels));
    if (reason) {
      warnings.push(axisBreakInvalid('waterfall', reason));
    } else {
      activeBreak = { from: requestedBreak.from, to: requestedBreak.to };
      // The break exists to show the steps at a readable scale; a rounded
      // top past the last level would spend that scale on empty air, and the
      // bridge prints no value ticks to round for.
      // The tighter top applies only over a break below the top level: above it, it would cut the data.
      if (hi > 0 && headroomHi > requestedBreak.to) dHi = hi > requestedBreak.to ? Math.min(headroomHi, hi + (hi - requestedBreak.to) * 0.08) : headroomHi;
    }
  } else if (recommendBreak) {
    // Boardplot advisory rule: every step occupies less than 10% of the smallest
    // total. Use the largest step, so a rounding adjustment cannot trigger it.
    // A mixed-sign step uses its full drawn span rather than its cancelling net.
    const deltaItems = allItems.filter((it) => it.type === 'delta');
    const deltaMax = Math.max(0, maxOf(deltaItems.map((it) => traversalExtrema[it.id]!.max - traversalExtrema[it.id]!.min)));
    const totalMin = minOf(allItems.filter((it) => it.type !== 'delta').map((it) => totals[it.id]!));
    const deltaLevelMin = minOf(deltaItems.map((it) => traversalExtrema[it.id]!.min));
    const ratio = totalMin / deltaMax;
    if (Number.isFinite(ratio) && totalMin > 0 && deltaMax > 0 && deltaLevelMin > 0 && ratio > 10) {
      warnings.push({
        code: 'waterfall-base-dominates',
        severity: 'info',
        message: `the smallest total is ${fmtPlain(ratio, { decimals: 2 })} times the largest step (above 10); consider a value-axis break to make the steps easier to compare`,
        suggest: "set valueAxis: { break: 'auto' } to request a break where the running levels and total lengths allow it",
      });
    }
  }
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  // Type steps: a value inside a stacked segment takes the secondary step (12 px from 720 px, 11 px below).
  const segmentFont: FontSpec = { ...labelFont, size: Math.min(labelFont.size, secondaryType(theme).size) };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  // The category row reads under the lowest bar and the value hanging
  // under it (a falling step or a negative total), so the plot makes that
  // room; a bar's name never hops above the baseline.
  const hangingEnd = Math.min(0, minOf(allItems.map((it) =>
    (it.type === 'delta' ? levels[it.id]!.end - levels[it.id]!.start : totals[it.id]!) < 0 ? traversalExtrema[it.id]!.min : 0)));
  const hangingRoom = options.labels === false || !categoryRow ? 0 : measure('0', strongFont).height + 4;
  const hangingReserve = hangingLabelReserve(plot.h, [dLo, dHi], hangingEnd, hangingRoom);
  // These category steps finish before the height-dependent rotation step.
  if (categoryRow && !options.annotations?.some(a => a.kind === 'cagr')
    && ['fit', 'wrap', 'font-down'].includes(catPlan.step)) {
    fixedPlotChrome(frameResult, catBandH + 8 + axisTitleBand);
  }
  plot.h = plotHeightAfter(frameResult, size.height, plot.h - hangingReserve);
  const y = activeBreak
    ? brokenLinearScale([dLo, dHi], [plot.y + plot.h, plot.y], activeBreak)
    : linearScale([dLo, dHi], [plot.y + plot.h, plot.y]);
  let unsafeBreak = false;
  if (activeBreak) {
    const steps: BreakBar[] = allItems.filter(it => it.type === 'delta').flatMap(it => {
      const level = levels[it.id]!;
      const traversal = traversalExtrema[it.id]!;
      let start = level.start;
      const segments = segmentsFor(it).map(segment => {
        const end = start + segment.value;
        const span = { value: Math.abs(segment.value), start, end };
        start = end;
        return span;
      });
      const mixed = segments.some(s => s.end > s.start) && segments.some(s => s.end < s.start);
      // A mixed step's full height belongs to its gross segment span, not its net change.
      const value = mixed ? traversal.max - traversal.min : Math.abs(level.end - level.start);
      return [{ value, start: traversal.min, end: traversal.max }, ...segments];
    });
    const totalBars = allItems.filter(it => it.type !== 'delta').map(it => {
      const traversal = traversalExtrema[it.id]!;
      const value = Math.abs(totals[it.id]!);
      return { value, start: traversal.min, end: traversal.max };
    });
    unsafeBreak = breakReversesOrder(y, totalBars, steps);
    if (enforceBreakOrder && unsafeBreak) {
      if (autoBreak) {
        const maxStepInk = maxOf(steps.map(step => Math.abs(step.end - step.start)));
        const totalMin = minOf(totalBars.map(total => total.value));
        const pixelsPerUnit = Math.abs(y(dHi) - y(autoBreak.to)) / (dHi - autoBreak.to);
        const margin = Math.max(1 / pixelsPerUnit, maxStepInk * 0.01);
        const moved = { from: autoBreak.from, to: floorTwoDigits(totalMin + autoBreak.from - maxStepInk - margin) };
        const drawn = [...allItems.flatMap(it => [traversalExtrema[it.id]!.min, traversalExtrema[it.id]!.max]),
          ...(() => { const line = valueLineExtent(options.annotations); return line ? [line.lo, line.hi] : []; })()];
        if (!invalidLinearBreakReason([dLo, dHi], moved, drawn)) {
          return drawBridge(options, moved);
        }
      }
      // Rebuild the whole frame so the rejected break leaves no disclosure.
      const result = drawBridge({ ...options, valueAxis: { ...options.valueAxis, break: false } });
      if (requestedBreak) result.geometry.warnings.push(axisBreakHeightOrderWarning());
      return result;
    }
  }
  const y0 = y(0);
  // A date row stays at the plot's bottom band; prose reads under the
  // lowest bar and the value hanging under the lowest falling one.
  const catRowY = (dateNumericTicks
    ? plot.y + plot.h + hangingReserve
    : categoryRowTop(y, minOf(allItems.map((it) => traversalExtrema[it.id]!.min)), hangingEnd, hangingRoom)) + 6;

  // ---- marks ----
  const nodes: SceneNode[] = [...frameResult.nodes];
  const marks: WaterfallMarks = { bars: [], connectors: [] };
  const labelRequests: LabelRequest[] = axisTitle
    ? [valueAxisTitleRequest(axisTitle, { x: plot.x, y: frameResult.plot.y + 4 }, 'start', 'axis:y:title')]
    : [];

  // baseline (thin solid, always)
  const baselineId = 'axis:baseline';
  nodes.push({
    t: 'line',
    id: baselineId,
    x1: plot.x,
    y1: y0,
    x2: plot.x + plot.w,
    y2: y0,
    stroke: { token: 'axis' },
    width: strokeToken(theme, 'rule'),
    owner: {},
    part: 'baseline',
  });
  occupied.claim({ x: plot.x, y: y0 - 1, w: plot.w, h: 2 }, 'axis', {});

  // The largest segment the bridge labels: segment priorities scale to it.
  const segMaxAbs = Math.max(1e-9, maxOf(allItems.filter((it) => it.authoredSegments || derivedTotalSegments.has(it.id))
    .flatMap((it) => segmentsFor(it).map((seg) => Math.abs(seg.value)))));
  // A multi-case bridge splits each step's band among its cases, 2 px apart.
  const CASE_GAP = 2;
  const CASE_LABEL_SHIFT = (SERIES_VALUE_GAP - CASE_GAP) / 2;
  const boldValueIds = new Set<string>();
  // Values with an authored label string: no value row thins them as density.
  const authoredValueIds = new Set<string>();
  const caseW = cases.length > 0 ? (band.bandwidth - CASE_GAP * (cases.length - 1)) / cases.length : 0;
  if (cases.length === 0) items.forEach((it, i) => drawStep(it, i, band.position(i), band.bandwidth));
  else items.forEach((_, i) => cases.forEach((__, k) => drawStep(caseItems[k]![i]!, i, band.position(i) + k * (caseW + CASE_GAP), caseW, k)));

  /** One bar of the bridge: a step, or one case's bar within it, with its labels and connector. */
  function drawStep(it: NormItem, i: number, bx: number, bw: number, caseIndex?: number): void {
    const lvl = levels[it.id]!;
    const isTotal = it.type !== 'delta';
    // The step this bar stands in; under cases `it` is the case's own '<item>:<case>'.
    const cat = items[i]!;
    const caseId = caseIndex === undefined ? undefined : cases[caseIndex]!.id;
    const stepOwner = caseId === undefined ? { categoryId: it.id } : { categoryId: cat.id, seriesId: caseId };
    const paintOf = (seg: NormItem['segments'][number]): Paint =>
      caseIndex === undefined ? segmentPaint(it, seg) : seg.fill ? { css: seg.fill } : casePaint(caseIndex);

    // Composition-complete final totals retain the segment identities; all
    // other totals stay single because their breakdown is not derivable.
    const stackedTotal = derivedTotalSegments.get(it.id);
    const drawSegments = segmentsFor(it);
    const segmentedMark = it.authoredSegments || stackedTotal !== undefined;

    const traversal = traversalExtrema[it.id]!;
    let cumScan = lvl.start;
    const segSpans = drawSegments.map((seg) => {
      const sStart = cumScan;
      const sEnd = cumScan + seg.value;
      cumScan = sEnd;
      return { seg, sStart, sEnd };
    });
    const yTop = y(traversal.max);
    const yBot = y(traversal.min);
    const barRect: Rect = { x: bx, y: yTop, w: bw, h: Math.max(yBot - yTop, 0.5) };

    const segRects: WaterfallMarks['bars'][number]['segments'] = [];
    // A step whose segments change sign draws them in sequence, side by side
    // across the band, each from where the one before it ended. Stacked in one
    // column, the up block would overpaint the down block, and the part still
    // showing would print a number no input has.
    const mixed = it.type === 'delta' && segSpans.some((s) => s.seg.value > 0) && segSpans.some((s) => s.seg.value < 0);
    // The 2 px gap shrinks on a narrow band so every segment keeps at least
    // 1 px (or an equal share of the band when even that does not fit).
    const n = segSpans.length;
    const gap = mixed && n > 1 ? Math.min(2, Math.max(0, (bw - n) / (n - 1))) : 0;
    const subW = mixed ? (bw - gap * (n - 1)) / n : bw;
    // Draw larger pixel extents first so every traversal stays visible when
    // same-sign segments stack (the later, smaller rect paints on top).
    const drawOrder = segSpans
      .map((s, k) => ({ ...s, k, extent: Math.abs(y(s.sStart) - y(s.sEnd)) }))
      .sort((a, b) => b.extent - a.extent || a.k - b.k);
    drawOrder.forEach(({ seg, sStart, sEnd, k }) => {
      const sy = y(Math.max(sStart, sEnd));
      const sh = Math.max(Math.abs(y(sStart) - y(sEnd)), 0.5);
      const rect: Rect = { x: mixed ? bx + k * (subW + gap) : bx, y: sy, w: subW, h: sh };
      const nodeId = `mark:${cat.id}:${seg.id}`;
      const paint = paintOf(seg);
      const pattern = scenarioPattern(seg.scenario ?? it.scenario);
      const segOwner = caseId === undefined ? { categoryId: it.id, segmentId: segmentedMark ? seg.id : undefined } : stepOwner;
      // A segment cell's own format and label override are honoured.
      const segFmt = seg.format ? { fmt: formatterFromExample(seg.format, options.locale?.language), fmtSigned: signedFormatterFromExample(seg.format, options.locale?.language) } : { fmt, fmtSigned };
      const segBase = isTotal || stackedTotal ? segFmt.fmt(seg.value) : segFmt.fmtSigned(seg.value);
      const segText = typeof seg.valueLabel === 'string' ? seg.valueLabel.replace(/\$\{value\}/g, segBase) : segBase;
      const segDisplay = { value: segText };
      const breakMeta = activeBreak ? y.break : undefined;
      if (activeBreak && breakMeta && crossesLinearBreak(sStart, sEnd, activeBreak)) {
        // A total crossing the omitted span (deltas were refused above) is one
        // rect with the page-colour break cut across it, so its edge stays
        // whole in every theme. An outlined total is hollow and would not show
        // the cut: it is drawn in two pieces with the two-stroke glyph between.
        const topPx = y(Math.max(sStart, sEnd));
        const bottomPx = y(Math.min(sStart, sEnd));
        let glyph;
        if (pattern === 'outline') {
          const lower: Rect = { x: bx, y: breakMeta.position + 2, w: bw, h: Math.max(bottomPx - breakMeta.position - 2, 0.5) };
          const upper: Rect = { x: bx, y: topPx, w: bw, h: Math.max(breakMeta.position - 2 - topPx, 0.5) };
          nodes.push(
            { t: 'rect', id: nodeId, rect: lower, fill: paint, pattern, owner: segOwner, part: 'segment', display: segDisplay },
            { t: 'rect', id: `${nodeId}:beyondBreak`, rect: upper, fill: paint, pattern, owner: segOwner, part: 'segmentBeyondBreak' },
          );
          glyph = straightBreakGlyph(theme, { x: bx + bw / 2, y: breakMeta.position }, `${nodeId}:break`, segOwner, { token: 'axis' }, 'barBreak');
        } else {
          const whole: Rect = { x: bx, y: topPx, w: bw, h: bottomPx - topPx };
          nodes.push({ t: 'rect', id: nodeId, rect: whole, fill: paint, pattern, owner: segOwner, part: 'segment', display: segDisplay });
          glyph = barBreakCut(whole, 'y', breakMeta.position, `${nodeId}:break`, segOwner);
        }
        nodes.push(...glyph.nodes);
        occupied.claim(glyph.rect, 'axis', segOwner, 'barBreak');
      } else {
        nodes.push({
          t: 'rect',
          id: nodeId,
          rect,
          fill: paint,
          pattern,
          owner: segOwner,
          part: 'segment',
          display: segDisplay,
        });
      }
      segRects.push({ id: seg.id, rect, nodeId });
      // A mixed step's sub-bars stand side by side, so each
      // is claimed as its own segment's mark; a sibling then blocks the label.
      if (mixed && caseId === undefined) occupied.claim(rect, 'mark', { categoryId: it.id, segmentId: seg.id });

      // Segment labels share the standard sliver gate; the total label stays.
      if (segmentedMark) {
        const text = segText;
        const tsize = measure(text, segmentFont);
        // Inside with 4 px per side, else beside the segment on the side away from the
        // step before (the connector arrives on the left), else dropped.
        const fits = tsize.height + 2 <= sh && tsize.width + 8 <= subW;
        // An outside value reads as its own segment's only when it sits nearer that segment than
        // the next mark to the right: the next case's bar or the next step's column. Else it drops
        // to the note, smallest first. The gap is measured in both directions: a value below the
        // next column's floating bar still reads as its own. The last column has no mark to its right.
        const nextCase = caseIndex !== undefined && caseIndex < cases.length - 1;
        const nextItem = nextCase ? caseItems[caseIndex + 1]![i] : i < items.length - 1 ? (caseIndex !== undefined ? caseItems[0]![i + 1] : items[i + 1]) : undefined;
        const nextSpan = nextItem && traversalExtrema[nextItem.id];
        const nextRect = nextSpan && { x: nextCase ? bx + bw + CASE_GAP : band.position(i + 1), y: y(nextSpan.max), w: bw, h: y(nextSpan.min) - y(nextSpan.max) };
        const stacked = stackSegmentCandidates(rect, tsize, fits, effectiveFill(paintColor(theme, paint), pattern, theme), { tightLast: true, insidePaint: paint, insidePattern: pattern })
          .filter((candidate) => !candidate.slot.startsWith('outside')
            || (candidate.slot.startsWith('outsideRight') && (!nextRect || boxGap(candidate.rect, rect) < boxGap(candidate.rect, nextRect))));
        // On a vertical bridge a value whose line box
        // is taller than its segment still reads inside when its digits do: the segment holds the
        // digits' cap height with 1 px air above and below, and the text with 2 px each side. The line box's
        // leading then reaches past the segment edge, which carries no ink.
        const glyphFits = categoryRow && !mixed && !fits && !stacked.some((candidate) => candidate.slot.startsWith('inside'))
          && segmentFont.size * DIGIT_CAP + 2 <= sh && tsize.width + 4 <= subW
          // The seat centres the digits, so a comma's tail needs its height again on the other side.
          && digitSeat(rect, text, tsize, segmentFont.size * DIGIT_CAP, segmentFont.size,
            Math.max(2, digitSeatEdge(theme, pattern)) + (text.includes(',') ? segmentFont.size * 0.2 : 0)) !== undefined;
        const glyphSeat: SlotCandidate[] = glyphFits
          ? [{
            slot: 'insideTight', penalty: 1, pad: 0,
            rect: { x: rect.x + rect.w / 2 - tsize.width / 2, y: rect.y + rect.h / 2 - tsize.height / 2, w: tsize.width, h: tsize.height },
            insideFill: effectiveFill(paintColor(theme, paint), pattern, theme), insidePaint: paint, insidePattern: pattern,
          }]
          : [];
        // A whole-axis stack can hold the digits while their line boxes overlap.
        // Use the measured cap height for this numeric seat. labelsToNodes centres
        // the same ink bounds. Keep clear of the seam and retain every other seat
        // when the digits themselves do not fit. Font size and scale stay intact.
        // Where every line box fits, the seat is the last inside one: a value whose
        // line box touches the baseline or a neighbour still prints its digits.
        const digits = categoryRow && !activeBreak && !mixed
          ? digitSeat(rect, text, tsize, measure.capHeight?.(segmentFont), segmentFont.size, digitSeatEdge(theme, pattern)) : undefined;
        const inkFits = digits !== undefined;
        const wholeAxisInkFits = inkFits && drawOrder.at(-1)!.extent < tsize.height + 2;
        const inkSeat: SlotCandidate[] = digits ? [{
          slot: wholeAxisInkFits ? 'insideTight' : 'insideDigits', penalty: wholeAxisInkFits ? 0 : 1.5, pad: 0, rect: digits,
          insideFill: effectiveFill(paintColor(theme, paint), pattern, theme), insidePaint: paint, insidePattern: pattern,
        }] : [];
        // The sliver gate drops a value only when no inside seat above holds it: a segment
        // shorter than the line box plus the stack room still holds its digits.
        const sliver = !(fits || glyphFits || inkFits)
          && segmentTooShort(options.labelDensity ?? 'smart', sh, tsize.height, options.labelPlacements?.[`segment:${it.id}:${seg.id}`], STACK_ROOM);
        // An unbroken bridge keeps its small segment values on the chart. A leader
        // ties an outside value to the segment even when a total stands beside it.
        const wholeAxisSliver = categoryRow && !activeBreak && !mixed && !fits;
        labelRequests.push({
          id: `segment:${it.id}:${seg.id}`,
          kind: 'segment',
          ...(drawSegments.length === 1 && typeof seg.valueLabel !== 'string' ? { printedIn: `${isTotal ? 'total' : 'sum'}:${it.id}` } : {}),
          owner: { categoryId: it.id, segmentId: seg.id },
          text,
          lines: [text],
          font: segmentFont,
          typeRole: 'secondary' as const,
          // The smallest |value| drops first, across the chart; the priority scales |value| to the
          // chart's largest, so large values do not tie.
          priority: seg.priority ?? PRIORITY.interior + (99 * Math.abs(seg.value)) / segMaxAbs,
          redundant: sliver || seg.valueLabel === false,
          ...(typeof seg.valueLabel !== 'string' ? { noLeader: true } : {}),
          // The value reads as its own sub-bar's; a seat nearer another mark takes a leader.
          ...(mixed || wholeAxisSliver ? { anchor: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } } : {}),
          ...(wholeAxisSliver ? { leaderClear: 'includingPins' as const } : {}),
          candidates: typeof seg.valueLabel !== 'string'
            ? [...inkSeat, ...glyphSeat, ...stacked].filter(candidate => candidate.insideFill !== undefined)
            : mixed && !fits ? [...mixedSliverSeats(rect, tsize, k, n), ...stacked]
              : [...inkSeat, ...glyphSeat, ...stacked, ...(wholeAxisSliver ? mixedSliverSeats(rect, tsize, k, n, ['left', 'right'], true) : [])],
        });
      }
    });
    // marks index keeps input order regardless of draw order
    const inputIndex = new Map(drawSegments.map((s, k) => [s.id, k]));
    segRects.sort((a, b) => (inputIndex.get(a.id) ?? 0) - (inputIndex.get(b.id) ?? 0));
    // A mixed step claims its sub-bars one by one above; the gap between them is air.
    if (!(mixed && caseId === undefined)) occupied.claim(barRect, 'mark', stepOwner);
    marks.bars.push({ id: it.id, rect: barRect, segments: segRects });

    // connector to next item (explicit connectors handled after the loop)
    // A case's line to its next bar would cross the other case's bar: case bars draw none.
    // A subtotal drawn from the baseline stands apart from the balance: the line skips over it.
    const apart = (item: NormItem) => levels[item.id]?.balance !== undefined;
    const nextIndex = items.findIndex((item, n) => n > i && !apart(item));
    if (caseIndex === undefined && !apart(it) && nextIndex > 0 && !hiddenAfter.has(it.id) && !connectorInto.has(items[nextIndex]!.id)) {
      const next = items[nextIndex]!;
      const level = it.type === 'delta' ? lvl.end : totals[it.id]!;
      const cy = y(level);
      const nodeId = `connector:${it.id}:${next.id}`;
      nodes.push({
        t: 'line',
        id: nodeId,
        // TRUE corners. The air gap is applied by insetBridgeEnds() on final
        // coordinates, once per orientation — see its doc comment.
        x1: bx + bw,
        y1: cy,
        x2: band.position(nextIndex),
        y2: cy,
        stroke: connectorStroke,
        width: strokeToken(theme, 'rule'),
        dash: connectorDash,
        lineCap: signBridge ? 'round' : 'butt',
        owner: { categoryId: it.id },
        part: 'connector',
      });
      // Claimed with an EMPTY owner: no label may legally sit on a dashed
      // rule — an outside sliver label the solver parked at the bar's end
      // level had the connector striking through its digits. The empty owner
      // blocks the connector's own category too; its labels belong on the
      // bar, not on the bridge line.
      occupied.claim(connectorClaim(bx + bw, band.position(nextIndex), cy), 'mark', {}, 'connector');
      marks.connectors.push({ from: it.id, to: next.id, nodeId });
    }

    // ---- item value label ----
    const itemValue = isTotal ? totals[it.id]! : lvl.end - lvl.start;
    // A mixed-sign step's own value is the net of its parts, and says so.
    // The item value cell's own format and label override are honoured.
    const valueMeta = { ...(drawSegments.length === 1 ? drawSegments[0] : {}), ...it.valueMeta };
    const own = valueMeta?.format ? { fmt: formatterFromExample(valueMeta.format, options.locale?.language), fmtSigned: signedFormatterFromExample(valueMeta.format, options.locale?.language) } : { fmt, fmtSigned };
    const itemBase = isTotal ? own.fmt(itemValue) : mixed ? `net ${own.fmtSigned(itemValue)}` : own.fmtSigned(itemValue);
    const text = typeof valueMeta?.valueLabel === 'string' ? valueMeta.valueLabel.replace(/\$\{value\}/g, itemBase) : itemBase;
    if (!isTotal) stepTones.set(it.id, stepTone(itemValue, it.direction));
    // A highlighted step's value is bold, as the totals are.
    const boldStep = !isTotal && categoryRow && highlights.has(cat.id);
    if (boldStep) boldValueIds.add(`sum:${it.id}`);
    if (typeof valueMeta?.valueLabel === 'string') authoredValueIds.add(isTotal ? `total:${it.id}` : `sum:${it.id}`);
    const font = isTotal || boldStep ? strongFont : labelFont;
    const tsize = measure(text, font);
    // Mirror below the bar for negative values — totals included.
    const negative = itemValue < 0;
    const outsideY = negative ? yBot + 4 : yTop - tsize.height - 4;
    const endpoint = i === 0 || i === items.length - 1;
    // The paint the label would sit on is the bar's own (a total's color.total,
    // a highlighted total's focus), so its contrast ink matches it.
    const insidePaint: Paint = stackedTotal
      ? paintOf(drawSegments[drawSegments.length - 1]!)
      : paintOf(it.segments[0]!);
    const insidePattern = scenarioPattern(stackedTotal
      ? drawSegments[drawSegments.length - 1]!.scenario ?? it.scenario
      : it.scenario ?? (it.segments.length === 1 ? it.segments[0]!.scenario : undefined));
    labelRequests.push({
      id: isTotal ? `total:${it.id}` : `sum:${it.id}`,
      kind: isTotal ? 'total' : 'segment',
      // A one-part value names its segment back, so a pinned segment placed first takes the value; an authored text keeps its seat.
      ...(drawSegments.length === 1 && typeof drawSegments[0]!.valueLabel !== 'string' && typeof valueMeta?.valueLabel !== 'string'
        ? { printedIn: `segment:${it.id}:${drawSegments[0]!.id}` } : {}),
      owner: stepOwner,
      ...(mixed ? { role: composedTextRole(text) } : {}),
      text,
      lines: [text],
      font,
      priority: valueMeta?.priority ??
        (isTotal ? PRIORITY.total : endpoint ? PRIORITY.endpoint : PRIORITY.extreme) +
        (highlights.has(cat.id) ? PRIORITY.highlightBonus : 0),
      ...(valueMeta?.valueLabel === false ? { redundant: true } : {}),
      // An authored value passes the density gate, as on column and bar.
      ...(typeof valueMeta?.valueLabel === 'string' ? { keepWhenDense: true as const } : {}),
      candidates: [
        {
          slot: negative ? 'outsideBottom' : 'outsideTop',
          rect: { x: caseIndex === undefined ? bx + bw / 2 - tsize.width / 2
            // The outer cases' totals stand the series value gap apart over the 2 px case gap, or two equal totals read as one number.
            : caseIndex === 0 ? bx + bw - tsize.width - (isTotal ? CASE_LABEL_SHIFT : 0) : caseIndex === cases.length - 1 ? bx + (isTotal ? CASE_LABEL_SHIFT : 0) : bx + bw / 2 - tsize.width / 2,
          y: outsideY, w: tsize.width, h: tsize.height },
          penalty: 0,
        },
        // Where the shifted seat is blocked, an outer case's total keeps the seat at its bar's inner edge.
        ...(isTotal && caseIndex !== undefined && (caseIndex === 0 || caseIndex === cases.length - 1) ? [{
          slot: negative ? 'outsideBottom' as const : 'outsideTop' as const,
          rect: { x: caseIndex === 0 ? bx + bw - tsize.width : bx, y: outsideY, w: tsize.width, h: tsize.height },
          penalty: 1,
        }] : []),
        ...(tsize.height + 4 <= barRect.h && tsize.width + 4 <= bw ? [{
          slot: 'insideEnd' as const,
          rect: {
            x: bx + bw / 2 - tsize.width / 2,
            y: negative ? yBot - tsize.height - 2 : yTop + 2,
            w: tsize.width,
            h: tsize.height,
          },
          penalty: 2,
          insidePaint,
          insidePattern,
          insideFill: effectiveFill(paintColor(theme, insidePaint), insidePattern, theme),
        }] : []),
        // Full mode prints the start and end totals. When the centred seats collide with
        // the neighbouring bar, the end total hangs outward from its bar's outer edge.
        ...(isTotal && endpoint && caseIndex === undefined && items.length > 1 ? [{
          slot: negative ? 'outsideBottom' as const : 'outsideTop' as const,
          rect: { x: i === 0 ? bx + bw - tsize.width : bx, y: outsideY, w: tsize.width, h: tsize.height },
          penalty: 3,
        }] : []),
      ],
    });

    // ---- category label: once per step ----
    if (caseIndex !== undefined && caseIndex > 0) return;
    const catInfo = catInfos[i]!;
    // Every label centres on its bar; a date row is ONE
    // row at the axis band, never per-bar depths and never the stagger tier.
    const catX = catPlan.x(i);
    const catY = catRowY;
    const rotated = catPlan.rotation !== 0;
    labelRequests.push({
      id: `category:${cat.id}`,
      kind: 'category',
      owner: { categoryId: cat.id },
      text: cat.label,
      lines: catInfo.lines,
      ...categoryLineAlign(catPlan, i),
      ...(catInfo.title !== undefined ? { title: catInfo.title } : {}),
      font: catFont,
      priority: PRIORITY.endpoint,
      // A stride-hidden date label is the row's decision (one info lint), not a loss.
      redundant: !catPlan.keep[i],
      // A rotated claim is the small square at the anchor. At the 12 px type size of
      // the W-L width class its top sits within the 2 px pad of the baseline claim, and every
      // rotated name would be hidden; the square itself stays clear of it.
      ...(rotated ? { rotate: -45, pad: 0 } : {}),
      candidates: rotated
        ? [
            {
              slot: 'below',
              rect: rotatedClaimRect(caseIndex === undefined ? bx + bw / 2 : band.center(i), catY + 2, catInfo.h, catY - 6),
              penalty: 0,
            },
          ]
        : [
            {
              slot: 'below',
              rect: { x: catX, y: catY, w: catInfo.w, h: catInfo.h },
              penalty: 0,
            },
            // Second tier: lets a name yield to a value label that still
            // reaches the row. Prose only.
            ...(dateNumericTicks
              ? []
              : [
                  {
                    slot: 'belowShifted',
                    rect: { x: catX, y: catY + catRowH + CAT_TIER_GAP, w: catInfo.w, h: catInfo.h },
                    penalty: 1,
                  },
                ]),
          ],
    });
  }

  // ---- explicit connectors (anchored / non-adjacent pairs) ----
  for (const c of connectors) {
    if (c.hidden) continue;
    const fromIdx = items.findIndex((x) => x.id === c.from);
    const toIdx = items.findIndex((x) => x.id === c.to);
    if (fromIdx < 0 || toIdx < 0) {
      warnings.push({
        code: 'unknown-connector-endpoint',
        severity: 'warn',
        message: `connector ${c.from}→${c.to}: unknown item id — skipped`,
      });
      continue;
    }
    const level = anchorLevel(c.from, c.anchor);
    if (level === null) continue;
    const cy = y(level);
    const nodeId = `connector:${c.from}:${c.to}`;
    if (nodes.some((n) => n.id === nodeId)) continue; // already drawn as default
    const x1 = band.position(fromIdx) + band.bandwidth;
    const x2 = band.position(toIdx);
    nodes.push({
      t: 'line',
      id: nodeId,
      // True corners, same as the default connector; insetBridgeEnds() adds
      // the air gap after any transpose.
      x1: Math.min(x1, x2),
      y1: cy,
      x2: Math.max(x1, x2),
      y2: cy,
      stroke: connectorStroke,
      width: strokeToken(theme, 'rule'),
      dash: connectorDash,
        lineCap: signBridge ? 'round' : 'butt',
      owner: { categoryId: c.from },
      part: 'connector',
    });
    // Same empty-owner claim as the default connectors above.
    occupied.claim(connectorClaim(x1, x2, cy), 'mark', {}, 'connector');
    marks.connectors.push({ from: c.from, to: c.to, nodeId });
  }

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 2,
  });
  const rowValues = labelRequests.filter(request => /^(sum|total):/.test(request.id) && !authoredValueIds.has(request.id));
  solveCtx.valueRows = [...new Set(rowValues.map(request => `${request.kind}:${request.owner.seriesId ?? ''}`))].map(role => ({
      ids: rowValues.filter(request => `${request.kind}:${request.owner.seriesId ?? ''}` === role).map(request => request.id),
      alternate: true,
    }));
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  applyValueAxisTitleInk(solved.placed);
  pushAll(warnings, solved.warnings);
  // A step's value beside its bar reads in its sign's ink; one inside a fill
  // keeps the contrast ink the solver chose for it.
  if (signBridge) {
    for (const label of solved.placed) {
      const tone = label.id.startsWith('sum:') ? stepTones.get(label.id.slice('sum:'.length)) : undefined;
      if (tone && tone !== 'neutral' && label.slot !== 'insideEnd') label.ink = { token: tone };
    }
  }

  // ---- annotations ----
  const totalsOrder = items.filter((it) => it.type !== 'delta');
  const resolve = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    // Under cases an anchor names its case: { categoryId, seriesId: '<case>' }.
    const k = cases.findIndex((c) => c.id === (norm as { seriesId?: Id }).seriesId);
    if (cases.length > 0 && k < 0) return null;
    const step = items.find((x) => x.id === norm.categoryId);
    if (!step) return null;
    const i = items.indexOf(step);
    const it = k < 0 ? step : caseItems[k]![i]!;
    const lvl = levels[it.id]!;
    const edge = norm.edge ?? 'total';
    const value = edge === 'start' ? lvl.start : it.type === 'delta' ? lvl.end : totals[it.id]!;
    const anchorLevel =
      edge === 'start' ? lvl.start : edge === 'end' ? lvl.end : Math.max(lvl.start, lvl.end);
    return {
      x: k < 0 ? band.center(i) : band.position(i) + k * (caseW + CASE_GAP) + caseW / 2,
      y: y(anchorLevel),
      value,
      date: it.date,
      label: it.label,
      owner: k < 0 ? { categoryId: it.id } : { categoryId: step.id, seriesId: cases[k]!.id },
    };
  };
  const annotations = options.annotations ?? [];
  const annPlot: Rect = {
    x: plot.x,
    y: plot.y - annPad,
    w: plot.w,
    h: plot.h + annPad,
  };
  const sourceValues = annotations.some(annotation => annotation.kind === 'valueLine')
    ? data.items.flatMap(item => item.values ?? (item.segments?.length ? item.segments.map(segment => segment.value) : [item.value ?? null]))
      .filter(value => value !== null) : [];
  const annResult = runAnnotatePass({
    annotations,
    resolve,
    defaultSpan:
      totalsOrder.length >= 2
        ? { from: totalsOrder[0]!.id, to: totalsOrder[totalsOrder.length - 1]!.id }
        : items.length >= 2
          ? { from: items[0]!.id, to: items[items.length - 1]!.id }
          : undefined,
    occupied,
    plot: annPlot,
    theme,
    measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    valueLinePercentLevels: options.unit === '%' || sourceValues.length > 0 && sourceValues.every(isPctCell),
    solveCtx,
    yScale: y,
    annotationBandReserved: true,
  });
  pushAll(warnings, annResult.warnings);

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  // On a mixed-sign segment stack the up and down segments share a top edge
  // and the later one paints over the earlier: the `−33` label's ink was
  // decided against sky (8.45:1) and lands on navy (2.40:1 standard, below AA
  // in 6/6 presets). Halo it against the page instead — the same device its
  // sibling label already gets for carrying a leader — and re-decide the ink
  // against the page, because `inkInverse === background` in all six presets
  // and a halo alone is a no-op on the two dark ones (see markVisibility.ts).
  haloOverpaintedInsideLabels(nodes, allLabels, theme);
  pushAll(nodes, annResult.nodes);
  pushAll(
    nodes,
    labelsToNodes(theme, allLabels, (l) =>
      // A category label is drawn at the font its row was measured at.
      l.kind === 'total' || boldValueIds.has(l.id) ? strongFont : l.kind === 'segment' ? segmentFont : l.kind === 'category' ? catFont : l.kind === 'annotation' || l.kind === 'valueLine' ? { ...labelFont, weight: emphasisWeight(theme) } : labelFont, nodes,
    ),
  );

  const first = items[0]!;
  const last = items[items.length - 1]!;
  const stepsDesc = (bridge: NormItem[]) => bridge
    .map((it) =>
      it.type === 'delta'
        ? `${it.label} ${labelRequests.find(label => label.id === `sum:${it.id}`)?.text ?? fmtSigned(levels[it.id]!.end - levels[it.id]!.start)}`
        : `${it.label} ${labelRequests.find(label => label.id === `total:${it.id}`)?.text ?? fmt(totals[it.id]!)}`,
    )
    .join(', ');
  const a11yDesc = cases.length > 0
    ? chartString(options, 'waterfallCasesDesc', { v1: cases.length, v2: cases.map((c, k) => `${c.label ?? c.id}: ${stepsDesc(caseItems[k]!)}`).join('. ') })
    : stepsDesc(items);

  // The narrowest plot in which the printed step values still read (bandFloor.ts).
  // Category names do not set it: they wrap, step down and rotate (the row cascade), so the room a
  // rotated first name takes left of the plot is not chrome either: it comes and goes with the
  // rotation, and counting it would make the floor jump between widths.
  // In full mode a step value hidden for a collision goes to the note and sets no floor.
  // A total counts unless its blocked value is owed to the note. A hidden name is the
  // registry's check on the finished chart (namesMustPrint): a probe at a short first height
  // hides names that the grown chart prints.
  const full = options.mode !== 'compact';
  const valueLabels = new Map(solved.placed.map((label) => [label.id, label]));
  const minPlotW = valueLabelPlotFloor(plot.w, marks.bars.map((bar, k) => ({
    bar: bar.rect,
    group: String(cases.length > 0 ? Math.floor(k / cases.length) : k),
    labels: [valueLabels.has(`sum:${bar.id}`) ? floorValueLabel(valueLabels.get(`sum:${bar.id}`), full) : printedValueLabel(valueLabels.get(`total:${bar.id}`))].flatMap((rect) => rect ?? []),
  })), !full);
  const geometry: Geometry<WaterfallMarks, WaterfallDerived> = {
    type: 'waterfall',
    size,
    sizing: {
      ...bandSizing('waterfall', size, plot.w + catOverhang, band.step, minPlotW),
      ...(nodes.some(node => node.part === 'barBreak') ? { [HEIGHT_STRUCTURE]: true } : {}),
    },
    plot,
    scene: withSegmentSeams(nodes, theme),
    labels: allLabels,
    axes: [
      {
        axis: 'x',
        baselineNodeId: baselineId,
        ticks: items.map((it, i) => ({
          at: it.id,
          pos: band.center(i),
          labelId: `category:${it.id}`,
        })),
      },
    ],
    annotations: annResult.placed,
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: {
      levels,
      totals,
      totalBasis,
      tickBand: {
        reserved: catBandH,
        measuredLines: catTickMaxLines,
        lineHeight: catFont.size * 1.2,
        extra: catStaggerExtra,
        dateNumeric: dateNumericTicks,
        position: 'below' as const,
      },
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'waterfallTitle', { v1: first.label, v2: last.label })),
      counts: [...(cases.length ? [structureCount('cases', cases.length, undefined, options)] : [])],
      desc: chartString(options, 'waterfallDesc', { v1: build === 'down' ? chartString(options, 'buildDownClause') : '', v2: a11yDesc }),
    },
    ...(paintWarningRules.length ? { paintWarningRules } : {}),
    warnings,
    debug: { occupied: occupied.snapshot(), decisions: [...solved.decisions, ...annResult.decisions] },
  };
  return { geometry, annotationLegDeficit: annResult.legDeficit, unsafeBreak,
    ...(unsafeBreak && !enforceBreakOrder ? { repairBreak: () => drawBridge(options) } : {}) };
  }

  // ---- helpers ----

  function normalizeItem(raw: WaterfallItem, i: number): NormItem {
    if (!raw?.id) throw new NormalizeError('missing-id', `items[${i}]`, 'item requires an id');
    const type = raw.type ?? 'delta';
    const path = `items[${raw.id}]`;
    const checkCell = raw.value !== undefined ? normalizeCell(raw.value, `${path}.value`) : null;
    const checkValue = checkCell === null ? null : cellValue(checkCell);
    let segments: NormItem['segments'];
    if (type !== 'delta') {
      if (raw.segments?.some(segment => cellMeta(segment.value)?.format)) warnings.push({
        code: 'format-ignored', severity: 'warn', owner: { categoryId: raw.id },
        message: `item '${raw.id}': a total derives its segments; an authored segment format cannot apply`,
        suggest: 'set the total format on value.format, or format its contributing delta segments',
      });
      segments = [{ id: '__total', value: 0 }]; // rect computed from level
    } else if (raw.segments && raw.segments.length > 0) {
      segments = raw.segments.map((s, k) => {
        const cell = normalizeCell(s.value, `${path}.segments[${k}].value`);
        const v = cellValue(cell);
        if (v === null) throw new NormalizeError('missing-value', `${path}.segments[${k}]`, 'segment needs a numeric value');
        const meta = cellMeta(cell);
        return {
          id: s.id ?? `s${k}`,
          label: s.label,
          value: v,
          colorRole: s.colorRole,
          scenario: normalizeScenario(s.scenario ?? meta?.scenario, `${path}.segments[${k}].scenario`),
          fill: meta?.fill,
          ...cellText(meta),
        };
      });
    } else {
      if (checkValue === null) {
        throw new NormalizeError('missing-value', path, `delta item needs a value or segments`);
      }
      const meta = checkCell === null ? null : cellMeta(checkCell);
      segments = [
        {
          id: '__value',
          value: checkValue,
          scenario: normalizeScenario(raw.scenario ?? meta?.scenario, `${path}.scenario`),
          fill: meta?.fill,
          ...cellText(meta),
        },
      ];
    }
    return {
      id: raw.id,
      label: raw.label ?? raw.id,
      type,
      date: raw.date,
      toBaseline: raw.toBaseline ?? false,
      checkValue,
      ...(checkCell === null ? {} : { valueMeta: cellText(cellMeta(checkCell)) }),
      segments,
      authoredSegments: type === 'delta' && Boolean(raw.segments?.length),
      scenario: normalizeScenario(raw.scenario, `${path}.scenario`),
      direction: raw.direction,
    };
  }

  function caseItem(raw: WaterfallItem, i: number, caseId: Id, k: number): NormItem {
    const norm = normalizeItem({ ...raw, id: `${raw.id}:${caseId}`, value: raw.values?.[k], values: undefined }, i);
    return { ...norm, label: raw.label ?? raw.id, segments: norm.segments.map((seg) => ({ ...seg, id: caseId })) };
  }

  /** A case's bars take its series colour, as grouped columns do; sign reads from the step and its signed label. */
  function casePaint(k: number): Paint {
    return themeSeriesPaint(k, paletteRamp ? options.palette : undefined);
  }

  function segmentPaint(it: NormItem, seg: NormItem['segments'][number]): Paint {
    if (seg.fill) return { css: seg.fill };
    const identity = segmentCatalog.get(seg.id);
    if (identity) return identityPaint(identity);
    if (signBridge && it.type === 'delta') return tonePaint(stepTone(seg.value, it.direction));
    if (highlights.has(it.id)) return { token: 'focus' };
    // Totals keep color.total under 'sign' too: a dark theme caps its large
    // fills there, and ink is its light text colour. The token falls
    // back to ink when a theme leaves total unset.
    if (it.type !== 'delta') return { token: 'total' };
    if (signSteps) return tonePaint(stepTone(seg.value, it.direction));
    return paletteRamp ? themeSeriesPaint(0, options.palette) : { token: 'neutralMark' };
  }

  function identityPaint(identity: { id: Id; colorRole?: string; slot: number }): Paint {
    return segmentPaints.get(identity.id) ?? rawIdentityPaint(identity);
  }

  function rawIdentityPaint(identity: { colorRole?: string; slot: number }): Paint {
    return identity.colorRole
      ? markRolePaint(identity.colorRole, true)
      : themeSeriesPaint(identity.slot, paletteRamp ? options.palette : undefined);
  }

  function scenarioPattern(scenario?: string): 'hatch45' | 'outline' | undefined {
    return scenario === 'FC' ? 'hatch45' : scenario === 'PL' ? 'outline' : undefined;
  }
}

/**
 * Whether steps take their sign's colour (theme `marks.bridge`). A host that
 * adapts this layout may ask for 'sign' where the theme leaves the field
 * unset: the pvm bridge does, since its effects have no colour of their own
 * and a gain drawn grey beside a total in the accent reads as nothing.
 */
function isSignBridge(theme: Theme, options: WaterfallOptions): boolean {
  const bridge = theme.marks?.bridge ?? (options as { bridgeDefault?: 'sign' }).bridgeDefault;
  return bridge === 'sign' && options.signColor !== false;
}

/**
 * whether a plain step takes its verdict's fill. `signColor` decides;
 * unset, a theme's `marks.bridge` does, and without one every step does
 * unless the spec names a palette, which identifies the bridge (as on pvm).
 */
function stepsBySign(theme: Theme, options: WaterfallOptions): boolean {
  const bridge = theme.marks?.bridge ?? (options as { bridgeDefault?: 'sign' }).bridgeDefault;
  return options.signColor ?? (bridge === undefined ? options.palette === undefined : bridge === 'sign');
}

/** A step's verdict, as column's signColor: its sign times the item's direction; zero judges nothing. */
function stepTone(value: number, direction?: Direction): 'good' | 'bad' | 'neutral' {
  return value === 0 ? 'neutral' : (value > 0) === (direction !== 'lowerIsBetter') ? 'good' : 'bad';
}

function tonePaint(tone: 'good' | 'bad' | 'neutral'): Paint {
  return tone === 'neutral' ? { token: 'neutralMark' } : signedFillPaint(tone);
}

/** The thin strip a bridge connector's ink occupies, for label dodging.
 *  Ends inset by `BRIDGE_END_GAP` to match insetBridgeEnds(): the claim must
 *  not assert ink in the air gap the renderer guarantees at each bar corner. */
function connectorClaim(xa: number, xb: number, cy: number): Rect {
  const x1 = Math.min(xa, xb) + BRIDGE_END_GAP;
  const x2 = Math.max(xa, xb) - BRIDGE_END_GAP;
  return {
    x: x1,
    y: cy - 1,
    w: Math.max(x2 - x1, 1),
    h: 2,
  };
}

/** Bound on the binary rounding of adding `values`: at most two additions per summand (segment and running sum). */
function sumRoundoff(values: readonly number[]): number {
  const roundoff = values.length * Number.EPSILON;
  return roundoff / (1 - roundoff) * values.reduce((sum, value) => sum + Math.abs(value), 0);
}

/**
 * Neumaier's compensated sum: the sum of `values` without the rounding a plain
 * running sum collects (999999999999990 plus forty 0.025 steps is 999999999999991).
 */
function compensatedSum(values: readonly number[]): number {
  let sum = 0;
  let carry = 0;
  for (const value of values) {
    const next = sum + value;
    carry += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return sum + carry;
}
