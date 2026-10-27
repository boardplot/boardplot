import { chartString } from '../../strings/bullet';
import { emphasisWeight, secondaryType, strokeToken } from '../../theme';
import { structureCount } from '../../structureCounts';
/**
 * Bullet rows on one scale in percent of target
 * (`sharedScale: 'percentOfTarget'`). Every row is its value as a share of its
 * own target (actual ÷ target), so rows of different units compare on one
 * axis. Three zones judge every row: more than 20 % off target, up to 20 %
 * off and on target or better. A lower-is-better row says so under its name
 * and draws the zones mirrored (on target or better up to 100 %, up to 20 %
 * off to 120 %). The zones are named once in a key above the rows; a target
 * line at 100 % crosses every row's band. Where the plot keeps about half of
 * the width, a row is its name with its target on the left, the band, and
 * three right-aligned columns: actual, share of target and the difference to
 * target in the judgment colour, headed on the key line. Narrower, a row
 * stacks: name, actual and share over a full-width band, target and
 * difference under it.
 */

import { straightBreakGlyph } from '../../axis';
import { formatAutomaticPercent } from '../../format';
import type { Rect, Size } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import type { OccupiedIndex } from '../../label/occupied';
import { fittedLabel, gutterBudget } from '../../label/rowFit';
import { rowLabelBand } from '../../label/rowLabels';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import { accessibleTitle } from '../../normalize/shared';
import { linearScale } from '../../scale';
import { heightOmitted, rowSizing } from '../../sizing';
import { DEFAULT_TARGET, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import type { FontSpec, TextMeasurer } from '../../text';
import { composedTextRole } from '../../textRole';
import { paintColor } from '../../theme';
import { contrastRatio } from '../../color';
import { REFERENCE_LABEL_CLEARANCE, separationStroke } from '../../markVisibility';
import { readerFloorPx, tableHeadFloorPx, textScaleOf } from '../../typeFloors';
import { plotHeightAfter, type FrameResult, type LegendItemInput } from '../../frame';
import type { CellMeta, ComparisonDirection, Id } from '../../types/cell';
import type { BulletOptions } from '../../types/options';
import type { Geometry, LintWarning, Paint, PlacedAnnotation, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { asColumnHeads, fitHead, headRequest } from './columnHead';
import type { BulletDerived, BulletMarks } from './layout';
import { maxOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

/** A normalized row, as layoutBullet hands it over. */
export interface TargetScaleRow {
  id: Id;
  label: string;
  value: number | null;
  meta: CellMeta | null;
  target: number | null;
  direction: ComparisonDirection;
}

/** the word every composed bullet phrase uses for the comparison value. */
export function targetWord(options: Pick<BulletOptions, 'locale' | 'strings'>): string {
  return chartString(options, 'target');
}

/**
 * The three shared zones, worst first, in percent of target: lower bound,
 * upper bound (null = the axis end), paint, key label (in the strings.target
 * word). A lower-is-better row mirrors them at 100 % (see zoneSpan). Rows of
 * one direction keep the key in shares; with a lower-is-better row the key
 * names the zones by their distance to target, which reads in both directions.
 */
const BANDS = (target: string, mirrored: boolean, options?: Pick<BulletOptions, 'locale' | 'strings'>): readonly { from: number; to: number | null; paint: Paint; label: string }[] => [
  // One key template: the share bounds alone; an authored belowTarget80 string still wins.
  { from: 0, to: 80, paint: { token: 'ink', tint: 0.873 }, label: mirrored ? chartString(options, 'offTargetOver20', { v1: target })
    : (options?.strings as Record<string, unknown> | undefined)?.belowTarget80 !== undefined
      ? chartString(options, 'belowTarget80', { v1: target }) : chartString(options, 'below80') },
  { from: 80, to: 100, paint: { token: 'ink', tint: 0.742 }, label: mirrored ? chartString(options, 'offTargetUpTo20', { v1: target }) : '80–100%' },
  // A signed ground, so it takes the fill role, which falls back to good.
  { from: 100, to: null, paint: { token: 'goodFill', tint: 0.68 },
    label: chartString(options, mirrored ? 'onTargetOrBetter' : 'atOrAboveTarget', { v1: target }) },
];
/**
 * The zones a card keys. A neutral row has no better side: it takes the two
 * distance zones only, so a card of neutral rows alone keys no on-target zone.
 * With a neutral or a lower-is-better row the key names zones by distance.
 */
function targetBands(directions: readonly ComparisonDirection[], target: string, options?: Pick<BulletOptions, 'locale' | 'strings'>): ReturnType<typeof BANDS> {
  const bands = BANDS(target, directions.some(direction => direction !== 'higherIsBetter'), options);
  return directions.every(direction => direction === 'neutral') ? bands.slice(0, 2) : bands;
}
/**
 * A zone's spans in a row: as keyed for a higher-is-better row, mirrored at
 * 100 % for a lower-is-better row, so its worst zone starts at 120 % and lies
 * past the axis end (not drawn; a share there takes the overshoot break). A
 * neutral row mirrors its two distance zones around 100 %: up to 20 % off
 * either way, more than 20 % off beyond; no zone marks it on target.
 */
function zoneSpans(band: { from: number; to: number | null }, direction: ComparisonDirection, hi: number): { from: number; to: number }[] {
  const spans = direction === 'lowerIsBetter' ? [{ from: band.to === null ? 0 : 200 - band.to, to: 200 - band.from }]
    : direction !== 'neutral' ? [{ from: band.from, to: band.to ?? hi }]
    : band.to === null ? [] : band.from === 0 ? [{ from: 0, to: band.to }, { from: 200 - band.to, to: hi }] : [{ from: band.from, to: 200 - band.from }];
  return spans.flatMap(span => {
    const to = Math.min(span.to, hi);
    return to > span.from ? [{ from: span.from, to }] : [];
  });
}
/**
 * The one scale runs 0 to 120 % for every card. A share beyond it is cut at
 * the axis end with a break mark and printed in full beside the row, so a
 * ratio of any size draws the same five ticks.
 */
const AXIS_MAX = 120;
/** The cut: a gap of 2 px either side of the break mark, this far inside the axis end. */
const OVERFLOW_BREAK_INSET = 8;
const AXIS_TICKS = [0, 50, 80, 100, 120] as const;
/** The least row pitch at the natural height. */
const TARGET_ROW_PITCH = 40;
/** Band and measure bar height beside the columns, and in a stacked row. */
const SIDE_BAND_H = 18;
const SIDE_BAR_H = 7;
const STACK_BAND_H = 14;
const STACK_BAR_H = 6;
/** How far the target line reaches past its band, above and below. */
const TARGET_REACH = 2;
/** Air between two rows at the natural pitch, and between the rows and the axis labels. */
const ROW_GAP = 12;
/** Stacked rows sit closer: the note under one band and the name over the next read as one row each (a 58 px pitch). */
const STACK_ROW_GAP = 5;
const AXIS_GAP = 4;
const LEFT_GAP = 10;
const RIGHT_GAP = 18;
const COLUMN_GAP = 16;
/** Stacked: from the actual to the share, and from the text lines to the band. */
const VALUE_GAP = 10;
const BAND_GAP = 4;
/**
 * A stacked row holds its text 3 px from the band, so the row pitch is
 * 58 px with 13 px notes; the target
 * line then ends flush with the band to keep its clearance to the text.
 */
const STACK_BAND_GAP = 3;
const LINE_GAP = 1;
/** Side by side, the plot keeps this share of the width: the label column wraps for it, and below the floor the rows stack. */
const SIDE_PLOT_SHARE = 0.5;
const SIDE_PLOT_FLOOR = 0.45;

/** Legend keys of the three bands, named once for every row. */
export function targetBandLegendItems(directions: readonly ComparisonDirection[], target: string, options?: Pick<BulletOptions, 'locale' | 'strings'>): LegendItemInput[] {
  return targetBands(directions, target, options).map((band, index) => ({
    id: `band:target-${index}`,
    label: band.label,
    paint: band.paint,
    key: 'box',
    stroke: band.paint,
  }));
}

/**
 * A row's value as a percent of its target (actual ÷ target) in every
 * direction, so the number says what the "% of target" head says; only the
 * zones and colours follow the direction. Undefined when the two cannot form one.
 */
export function percentOfTarget(row: Pick<TargetScaleRow, 'value' | 'target'>): number | undefined {
  if (row.value === null || row.target === null || row.value < 0 || row.target <= 0) return undefined;
  return (100 * row.value) / row.target;
}

export interface TargetScaleInput {
  rows: TargetScaleRow[];
  options: BulletOptions;
  theme: Theme;
  size: Size;
  measure: TextMeasurer;
  frame: FrameResult;
  occupied: OccupiedIndex;
  warnings: LintWarning[];
  highlights: ReadonlySet<Id>;
  labelOn: (kind: 'category' | 'point' | 'annotation') => boolean;
  valueText: (row: TargetScaleRow) => string | null;
  targetText: (row: TargetScaleRow) => string;
  /** The target note in the parts it wraps at: the target, then the lower-is-better hint. */
  targetParts: (row: TargetScaleRow) => string[];
  deltaText: (row: TargetScaleRow, delta: number) => string;
  /** The signed difference alone, under a column head that names the target. */
  deltaBody: (row: TargetScaleRow, delta: number) => string;
  deltaTone: (row: TargetScaleRow, delta: number) => 'good' | 'bad' | 'warn' | 'neutral';
  deltaVsTarget: Record<Id, number>;
  /** Lays the chart out again at a height, for an unsized card that needs its rows' height. */
  grow: (chromeH: number, rowsH: number) => Geometry<BulletMarks, BulletDerived> | undefined;
  paintWarningRules?: Geometry['paintWarningRules'];
}

export function layoutTargetScale(input: TargetScaleInput): Geometry<BulletMarks, BulletDerived> {
  const { rows, options, theme, size, measure, frame: frameResult, occupied, warnings, highlights, labelOn } = input;
  const plot0 = frameResult.plot;
  const locale = options.locale?.language;
  const target = targetWord(options);

  // ---- fonts ----
  // The target note and the delta are values: a render target keeps them at
  // the label floor. Column heads take the
  // table-head floor, axis ticks the axis floor.
  const renderTarget = options.target ?? DEFAULT_TARGET;
  const textScale = textScaleOf(options);
  const family = theme.type.family;
  const noteSize = Math.max(theme.type.footnote.size, readerFloorPx(renderTarget, 'label', textScale));
  const nameFont: FontSpec = { family, ...theme.type.label, weight: 600 };
  const valueFont: FontSpec = { family, ...theme.type.label };
  const shareFont: FontSpec = { family, ...theme.type.label, weight: emphasisWeight(theme) };
  const noteFont: FontSpec = { family, ...theme.type.footnote, size: noteSize };
  const deltaFont: FontSpec = { ...noteFont };
  // A column head names the values under it, so it keeps the 13 px label floor.
  const headerFont: FontSpec = { family, ...theme.type.footnote, size: Math.max(theme.type.footnote.size, tableHeadFloorPx(renderTarget, textScale), readerFloorPx(renderTarget, 'label', textScale)) };
  const tickFont: FontSpec = { family, ...theme.type.axis, size: Math.min(secondaryType(theme).size, Math.max(theme.type.footnote.size, readerFloorPx(renderTarget, 'secondary', textScale))) };
  const nameLineH = nameFont.size * 1.2;
  const noteLineH = noteFont.size * 1.2;
  const line1H = Math.max(measure('0', nameFont).height, measure('0', valueFont).height);
  const line2H = Math.max(measure('0', noteFont).height, measure('0', deltaFont).height);

  // ---- texts ----
  const shares = rows.map((row) => percentOfTarget(row));
  const shareText = (share: number) => share > 0 && share < 0.5 ? '<1%' : formatAutomaticPercent(share, 0, false, locale);
  const valueTexts = rows.map((row) => (labelOn('point') ? input.valueText(row) : null));
  // One share phrase: the column head says "% of target", each row its number.
  const shareTexts = shares.map((share) => (share === undefined || !labelOn('point') ? null : shareText(share)));
  const deltas = rows.map((row) => (labelOn('annotation') ? input.deltaVsTarget[row.id] : undefined));
  const deltaTexts = rows.map((row, index) => (deltas[index] === undefined ? null : input.deltaText(row, deltas[index]!)));
  const deltaBodies = rows.map((row, index) => (deltas[index] === undefined ? null : input.deltaBody(row, deltas[index]!)));
  const widest = (texts: (string | null)[], font: FontSpec) => Math.max(0, maxOf(texts.map(text => text ? measure(text, font).width : 0)));
  const valueW = widest(valueTexts, valueFont);
  const shareW = widest(shareTexts, shareFont);
  const deltaBodyW = widest(deltaBodies, deltaFont);
  const deltaW = widest(deltaTexts, deltaFont);

  // ---- side-by-side columns: actual, share, delta, each right-aligned under its head ----
  const headEnv = { target: renderTarget, textScale };
  const columns = [
    { key: 'actual', head: chartString(options, 'actualColumn'), w: valueW },
    { key: 'share', head: chartString(options, 'shareColumn', { v1: target }), w: shareW },
    { key: 'delta', head: chartString(options, 'deltaColumn', { v1: target }), w: deltaBodyW },
  ].filter((column) => column.w > 0).map((column) => {
    const fitted = fitHead(column.head, headerFont, column.w, measure, headEnv);
    return { ...column, fitted, w: Math.max(column.w, fitted.w) };
  });
  const rightW = columns.reduce((sum, column) => sum + column.w, 0) + COLUMN_GAP * Math.max(0, columns.length - 1);

  // ---- left column: name over target note ----
  const wider = { wider: gutterBudget(plot0.w * 0.3, plot0.w) };
  const parts = rows.map((row) => input.targetParts(row));
  const notesAt = (cap: number) => rows.map((row, index) => {
    const text = input.targetText(row);
    const w = measure(text, noteFont).width;
    // On a line of its own the hint drops its leading separator.
    const split = parts[index]!.map((part, at) => (at === 0 ? part : part.replace(/^\s*·\s*/, '')));
    // A note too wide for the column breaks after the target, before its hint.
    const lines = w <= cap || split.length < 2 || split.some((part) => measure(part, noteFont).width > cap) ? [text] : split;
    const fitted = lines.length === 1 && w > cap
      ? rowLabelBand([{ label: text }], noteFont, cap, 2, noteLineH, measure, { target: renderTarget, typeRole: 'label', wider: cap }).labels[0]!
      : { lines, w: Math.max(...lines.map((line) => measure(line, noteFont).width)), h: lines.length * noteLineH, font: noteFont };
    return { ...fitted, text };
  });
  const sideNamesAt = (cap: number, maxLines: number) => rowLabelBand(rows, nameFont, cap, maxLines, nameLineH, measure, { target: renderTarget, typeRole: 'axis', ...(maxLines === 1 ? wider : { wider: cap }) });
  const leftOf = (names: { width: number }, notes: { w: number }[]) => labelOn('category') ? Math.max(names.width, maxOf(notes.map((note) => note.w))) : 0;
  const sidePlotW = (leftW: number) => plot0.w - (leftW ? leftW + LEFT_GAP : 0) - (rightW ? rightW + RIGHT_GAP : 0);
  let sideNames = sideNamesAt(plot0.w * 0.3, 1);
  let sideNotes = notesAt(gutterBudget(plot0.w * 0.3, plot0.w));
  let sideLeft = leftOf(sideNames, sideNotes);
  if (labelOn('category') && sidePlotW(sideLeft) < SIDE_PLOT_SHARE * size.width) {
    // The label column gives up width to the plot and wraps, down to a sixth of the width, its longest name word or note part.
    const longestWord = Math.max(0, maxOf(rows.flatMap((row) => row.label.split(/\s+/).map((word) => measure(word, nameFont).width))),
      maxOf(parts.flatMap((split) => split.map((part, at) => measure(at === 0 ? part : part.replace(/^\s*·\s*/, ''), noteFont).width))));
    const cap = Math.max(size.width / 6, longestWord, sideLeft - (SIDE_PLOT_SHARE * size.width - sidePlotW(sideLeft)));
    if (cap < sideLeft) {
      sideNames = sideNamesAt(cap, 2);
      sideNotes = notesAt(cap);
      sideLeft = leftOf(sideNames, sideNotes);
    }
  }
  // Never an ellipsis beside the band: a name the column cuts wraps, and a name or note it still cuts stacks the rows.
  const cut = (labels: readonly { title?: string }[]) => labels.some((label) => label.title !== undefined);
  if (labelOn('category') && cut(sideNames.labels)) {
    sideNames = sideNamesAt(sideLeft || plot0.w * 0.3, Math.max(2, maxOf(rows.map((row) => row.label.split(/\s+/).length))));
    sideLeft = leftOf(sideNames, sideNotes);
  }
  const sideWhole = !(labelOn('category') && (cut(sideNames.labels) || cut(sideNotes)));
  const sideFits = sidePlotW(sideLeft) >= Math.max(80, SIDE_PLOT_FLOOR * size.width) && sideWhole;

  // ---- stacked rows: names share line 1 with the actual and the share ----
  const stackValuesW = valueW + (valueW && shareW ? VALUE_GAP : 0) + shareW;
  let namesAboveValues = false;
  let stackNames = sideNames;
  if (labelOn('category')) {
    let nameW = plot0.w - stackValuesW - (stackValuesW ? LEFT_GAP : 0);
    namesAboveValues = rows.some(row => row.label.split(/\s+/).some(word => measure(word, nameFont).width > nameW));
    if (namesAboveValues) nameW = plot0.w;
    const maxLines = Math.max(2, maxOf(rows.map(row => row.label.split(/\s+/).length)));
    stackNames = rowLabelBand(rows, nameFont, nameW, maxLines, nameLineH, measure, { target: renderTarget, typeRole: 'axis' });
  }
  const stackNotes = notesAt(plot0.w);
  const stackNameH = labelOn('category') ? Math.max(0, maxOf(stackNames.labels.map(name => name.h))) : 0;
  const stackValueOffset = namesAboveValues ? stackNameH + LINE_GAP : 0;
  const stackHeaderH = Math.max(stackValuesW > 0 ? stackValueOffset + line1H : 0, stackNameH, line1H);
  const stackNoteH = Math.max(line2H, maxOf((labelOn('category') ? stackNotes.map(note => note.h) : [])));
  const stackLeftW = labelOn('category') ? Math.max(0, maxOf(stackNotes.map(note => note.w))) : 0;
  const deltaSeparate = stackLeftW + RIGHT_GAP + deltaW > plot0.w;
  const stackBandTop = stackHeaderH + STACK_BAND_GAP;
  const stackNoteTop = stackBandTop + STACK_BAND_H + STACK_BAND_GAP;
  const stackBlockH = stackNoteTop + (labelOn('category') || deltaW ? stackNoteH + (deltaSeparate ? line2H + 2 : 0) : 0);

  // ---- side-by-side block: the band centred on a one-line name over a one-line note ----
  const sideBandCenter = labelOn('category') ? (nameLineH + LINE_GAP + noteLineH) / 2 : SIDE_BAND_H / 2 + TARGET_REACH;
  const sideBlockH = Math.max(sideBandCenter + SIDE_BAND_H / 2 + TARGET_REACH,
    maxOf((labelOn('category') ? rows.map((_, index) => sideNames.labels[index]!.h + LINE_GAP + sideNotes[index]!.h) : [])));

  const sideRowH = (index: number) => labelOn('category')
    ? Math.max(sideBandCenter + SIDE_BAND_H / 2 + TARGET_REACH, sideNames.labels[index]!.h + LINE_GAP + sideNotes[index]!.h) : sideBlockH;
  const sideRowsH = () => rows.reduce((sum, _, index) => sum + sideRowH(index), 0);
  const tickH = measure('0%', tickFont).height;
  const headerH = measure('0', headerFont).height;

  // ---- column heads: on the key line when they fit right of its entries, else a line of their own ----
  const legendRect = frameResult.legend?.rect;
  const legendRight = Math.max(-Infinity, maxOf(frameResult.nodes.filter((node) => node.t === 'text' && node.part === 'legendLabel')
    .map((node) => node.t === 'text' ? node.x + Math.max(...node.lines.map((line) => measure(line, node.font).width)) : -Infinity)));
  const legendLast = frameResult.nodes.filter((node) => node.t === 'text' && node.part === 'legendLabel').at(-1);
  const headsFor = (stacked: boolean) => stacked ? columns.filter((column) => column.key === 'share') : columns;
  const headsW = (stacked: boolean) => {
    const heads = headsFor(stacked);
    return stacked ? Math.max(0, maxOf(heads.map((column) => column.fitted.w))) : rightW;
  };
  const headsOnKey = (stacked: boolean) => legendRect !== undefined && legendLast !== undefined
    && legendRight + 2 * COLUMN_GAP <= plot0.x + plot0.w - headsW(stacked);
  const headLineH = (stacked: boolean) => headsFor(stacked).length > 0 && !headsOnKey(stacked) ? headerH + BAND_GAP : 0;

  const chromeFor = (stacked: boolean) => headLineH(stacked) + TARGET_REACH + AXIS_GAP + tickH;
  const availFor = (stacked: boolean) => plotHeightAfter(frameResult, size.height, plot0.h - chromeFor(stacked));
  // Too narrow for the columns, the rows stack. A fixed frame too short for
  // stacked rows keeps the columns while the plot keeps 80 px and no name is cut.
  const fixedHeight = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height ?? !heightOmitted(options.size);
  const stacked = !sideFits && !(fixedHeight && sideWhole && sidePlotW(sideLeft) >= 80
    && rows.length * stackBlockH > availFor(true) && sideRowsH() < rows.length * stackBlockH);
  const blockH = stacked ? stackBlockH : sideBlockH;
  const availH = availFor(stacked);
  const naturalPitch = Math.max(TARGET_ROW_PITCH, blockH + (stacked ? STACK_ROW_GAP : ROW_GAP));
  const span = (pitch: number) => (rows.length - 1) * pitch + blockH;
  // Each row's own height: a side-by-side row is as tall as its wrapped name and note.
  const rowHeights = rows.map((_, index) => stacked ? blockH : sideRowH(index));
  const minimumRowsH = rowHeights.reduce((sum, h) => sum + h, 0);
  // At the natural pitch every row starts on the same step; a pressed fixed
  // frame shrinks the step to the tallest row, then the air between the rows.
  const uniform = Math.min(naturalPitch, (availH - blockH) / Math.max(1, rows.length - 1));
  const rowTops: number[] = [];
  if (uniform >= blockH || rows.length === 1) rows.forEach((_, index) => rowTops.push(index * Math.max(blockH, uniform)));
  else {
    const gap = Math.max(0, (availH - minimumRowsH) / Math.max(1, rows.length - 1));
    rowHeights.reduce((top, h) => { rowTops.push(top); return top + h + gap; }, 0);
  }
  const rowsH = rowTops.at(-1)! + rowHeights.at(-1)!;
  const grown = input.grow(size.height - availH, span(naturalPitch));
  if (grown) return grown;
  const leftW = stacked ? stackLeftW : sideLeft;
  const rowsTop = plot0.y + headLineH(stacked) + (stacked ? 0 : TARGET_REACH);
  const plot: Rect = {
    x: stacked ? plot0.x : plot0.x + (leftW ? leftW + LEFT_GAP : 0),
    y: rowsTop,
    w: stacked ? plot0.w : Math.max(10, sidePlotW(leftW)),
    h: rowsH,
  };
  const bandH = stacked ? STACK_BAND_H : SIDE_BAND_H;
  const barH = stacked ? STACK_BAR_H : SIDE_BAR_H;
  const bandCenterAt = (index: number) => rowsTop + rowTops[index]! + (stacked ? stackBandTop + STACK_BAND_H / 2 : sideBandCenter);

  // ---- the one scale ----
  const hi = AXIS_MAX;
  const x = linearScale([0, hi], [plot.x, plot.x + plot.w]);
  const beyond = rows.filter((_, index) => (shares[index] ?? 0) > hi);
  if (beyond.length > 0) {
    warnings.push({
      code: 'bullet-share-beyond-scale',
      severity: 'info',
      message: `${beyond.map((row) => `'${row.id}'`).join(', ')} beyond ${hi}% of target: the bar is cut at the axis end and the share printed beside it`,
    });
  }
  const rowsBottom = rowsTop + rowsH;
  const nodes: SceneNode[] = [...frameResult.nodes];

  // ---- column heads ----
  const headRequests: LabelRequest[] = [];
  const heads = headsFor(stacked);
  if (heads.length > 0) {
    const onKey = headsOnKey(stacked);
    const legendFontH = legendLast?.t === 'text' ? measure('0', legendLast.font).height : headerH;
    const headY = onKey && legendLast?.t === 'text' ? legendLast.y + (legendFontH - headerH) / 2 : plot0.y;
    let right = plot0.x + plot0.w;
    const placed = stacked ? heads.map((column) => ({ column, right }))
      : [...heads].reverse().map((column) => { const at = { column, right }; right -= column.w + COLUMN_GAP; return at; }).reverse();
    placed.forEach(({ column, right: end }, order) => headRequests.push(headRequest(column.key, order, column.fitted, end, headY, headerH, onKey)));
  }

  // ---- bands and the target line, one seat per row ----
  const rowBandIds = new Map<Id, Id[]>(rows.map(row => [row.id, []]));
  const directions = rows.map(row => row.direction);
  targetBands(directions, target, options).forEach((band, index) => {
    const id = `band:target-${index}`;
    rows.forEach((row, ri) => {
      zoneSpans(band, row.direction, hi).forEach((span, part) => {
        const x0 = x(span.from);
        const rect = { x: x0, y: bandCenterAt(ri) - bandH / 2, w: Math.max(0.5, x(span.to) - x0), h: bandH };
        const bandId = part === 0 ? `${id}:${row.id}` : `${id}:${row.id}:${part}`;
        nodes.push({ t: 'rect', id: bandId, rect, fill: band.paint, owner: {}, part: 'band' });
        occupied.claim(rect, 'mark', {});
        rowBandIds.get(row.id)!.push(bandId);
      });
    });
  });
  const anyTarget = rows.some((row) => row.target !== null);
  const targetX = x(100);
  const targetStroke = strokeToken(theme, 'data');
  // Stacked rows hold their text STACK_BAND_GAP from the band: the target line reaches only as far
  // as keeps the reference clearance to the value above and the delta below.
  const targetReach = stacked ? Math.max(0, Math.min(TARGET_REACH, STACK_BAND_GAP - REFERENCE_LABEL_CLEARANCE)) : TARGET_REACH;
  if (anyTarget) {
    rows.forEach((row, index) => {
      const y1 = bandCenterAt(index) - bandH / 2 - targetReach;
      const y2 = bandCenterAt(index) + bandH / 2 + targetReach;
      nodes.push({
        t: 'line', id: index === 0 ? 'target:shared' : `target:shared:${row.id}`, x1: targetX, x2: targetX, y1, y2,
        stroke: { token: 'ink' }, width: targetStroke, owner: {}, part: 'target',
      });
      occupied.claim({ x: targetX - targetStroke, y: y1, w: 2 * targetStroke, h: y2 - y1 }, 'mark', {});
    });
  }

  // ---- axis labels: 0 % at the plot start, 120 % at its end, 100 % in ink ----
  const axisTicks: { at: number; pos: number; labelId: string }[] = [];
  const tickY = (stacked ? rowsBottom : bandCenterAt(rows.length - 1) + bandH / 2 + TARGET_REACH) + AXIS_GAP;
  const tickLabels = AXIS_TICKS.map((tick) => {
    const strong = tick === 100;
    const font: FontSpec = strong ? { ...tickFont, weight: emphasisWeight(theme) } : tickFont;
    const text = formatAutomaticPercent(tick, 0, false, locale);
    const w = measure(text, font).width;
    const left = tick === 0 ? x(0) : tick === hi ? x(hi) - w : x(tick) - w / 2;
    return { tick, strong, font, text, w, left: Math.min(Math.max(left, plot0.x), plot0.x + plot0.w - w) };
  });
  const clear = (label: (typeof tickLabels)[number], others: typeof tickLabels, gap: number) =>
    others.every((other) => label.left + label.w + gap <= other.left || other.left + other.w + gap <= label.left);
  // 100 % first, then the axis ends; the band edges (50, 80 %) print only together and only with a label's width of air.
  // A narrow axis moves the 100 % label up to a quarter of its width off its line, so 120 % still prints.
  {
    const full = tickLabels.find((entry) => entry.tick === 100)!;
    const end = tickLabels.find((entry) => entry.tick === hi)!;
    const overlap = full.left + full.w + 2 - end.left;
    if (overlap > 0 && overlap <= full.w / 4) full.left -= overlap;
  }
  const kept: typeof tickLabels = [];
  for (const label of tickLabels.filter((entry) => entry.tick === 100 || entry.tick === 0 || entry.tick === hi)) {
    if (clear(label, kept, 2)) kept.push(label);
  }
  const inner = tickLabels.filter((entry) => !kept.includes(entry) && entry.tick !== 0 && entry.tick !== hi && entry.tick !== 100);
  if (inner.every((label, index) => clear(label, [...kept, ...inner.filter((_, other) => other !== index)], label.w))) kept.push(...inner);
  tickLabels.filter((label) => kept.includes(label)).forEach((label, index) => {
    const id = `axis:x:tick:${index}`;
    nodes.push({
      t: 'text', id, x: label.left, y: tickY, lines: [label.text], align: 'start', font: label.font,
      ink: { token: label.strong ? 'ink' : 'inkMuted' }, owner: {}, part: 'tick', typeRole: 'secondary',
    });
    occupied.claim({ x: label.left, y: tickY, w: label.w, h: tickH }, 'axis', {});
    axisTicks.push({ at: label.tick, pos: x(label.tick), labelId: id });
  });

  // ---- rows ----
  const marks: BulletMarks = { rows: [] };
  const requests: LabelRequest[] = [];
  const placedAnnotations: PlacedAnnotation[] = [];
  const inks = new Map<string, Paint>();
  const fonts = new Map<string, FontSpec>();
  const columnRight = new Map<string, number>();
  for (const head of headRequests) {
    fonts.set(head.id, headerFont);
    inks.set(head.id, { token: 'inkMuted' });
    requests.push(head);
  }
  {
    let right = plot0.x + plot0.w;
    for (const column of [...columns].reverse()) {
      columnRight.set(column.key, right);
      right -= column.w + COLUMN_GAP;
    }
  }
  const measurePaint = (row: TargetScaleRow): Paint =>
    row.meta?.fill ? { css: row.meta.fill } : highlights.has(row.id) ? { token: 'focus' } : { token: 'markInk' };
  const request = (id: string, kind: LabelRequest['kind'], owner: { categoryId: Id }, text: string, font: FontSpec, rect: Rect, extra: Partial<LabelRequest> = {}): void => {
    fonts.set(id, font);
    requests.push({
      id, kind, owner, text, lines: [text], font, priority: PRIORITY.endpoint,
      candidates: [{ slot: kind === 'category' ? 'left' : 'rowEnd', rect, penalty: 0 }],
      ...extra,
    });
  };
  const bandPaints = targetBands(directions, target, options).map(band => band.paint);
  rows.forEach((row, index) => {
    const top = rowsTop + rowTops[index]!;
    const barCenter = bandCenterAt(index);
    // Side by side the values sit on the band line; stacked they share line 1 with the name.
    const valueCenter = stacked ? top + stackValueOffset + line1H / 2 : barCenter;
    const owner = { categoryId: row.id };
    const share = shares[index];
    const fill = measurePaint(row);
    const fillCss = paintColor(theme, fill);
    const backing = bandPaints.reduce((nearest, paint) => {
      const css = paintColor(theme, paint);
      return contrastRatio(fillCss, css) < contrastRatio(fillCss, nearest) ? css : nearest;
    }, theme.color.background);
    const barStyle = { fill, ...separationStroke(fillCss, backing, theme),
      separation: { fill, backing: { token: 'background' as const }, alternateBackings: bandPaints } };
    let barNodeId: Id | undefined;
    // 0 % of target draws no bar; its share label still says 0 %.
    if (share !== undefined && share > 0) {
      const y = barCenter - barH / 2;
      const display = { value: valueTexts[index] ?? input.valueText(row) ?? '' };
      barNodeId = `bar:${row.id}`;
      if (share <= hi) {
        const rect: Rect = { x: x(0), y, w: Math.max(0.5, x(share) - x(0)), h: barH };
        nodes.push({ t: 'rect', id: barNodeId, rect, ...barStyle, owner, part: 'bar', display });
        occupied.claim(rect, 'mark', owner);
      } else {
        // Beyond the scale: the bar runs to the axis end with a break mark in it.
        const end = x(hi);
        const cut = end - OVERFLOW_BREAK_INSET;
        const rect: Rect = { x: x(0), y, w: Math.max(0.5, cut - 2 - x(0)), h: barH };
        const tail: Rect = { x: cut + 2, y, w: end - cut - 2, h: barH };
        nodes.push({ t: 'rect', id: barNodeId, rect, ...barStyle, owner, part: 'bar', display });
        nodes.push({ t: 'rect', id: `${barNodeId}:beyond`, rect: tail, ...barStyle, owner, part: 'barBeyondBreak' });
        const glyph = straightBreakGlyph(theme, { x: cut, y: barCenter }, `${barNodeId}:break`, owner, { token: 'axis' }, 'barBreak');
        nodes.push(...glyph.nodes);
        occupied.claim(rect, 'mark', owner);
        occupied.claim(tail, 'mark', owner);
        occupied.claim(glyph.rect, 'axis', owner, 'barBreak');
      }
    } else if (share === undefined && row.value !== null) {
      warnings.push({
        code: 'bullet-target-share-undefined',
        severity: 'warn',
        message: `row '${row.id}': no share of target without a positive value and a positive target; no bar was drawn`,
        owner,
      });
    }
    const noteTop = stacked ? top + stackNoteTop : top + (labelOn('category') ? sideNames.labels[index]!.h : 0) + LINE_GAP;
    if (labelOn('category')) {
      const name = (stacked ? stackNames : sideNames).labels[index]!;
      request(`category:${row.id}`, 'category', owner, row.label, nameFont,
        { x: plot0.x, y: top, w: name.w, h: name.h },
        { ...fittedLabel(name, nameFont), priority: PRIORITY.endpoint + (highlights.has(row.id) ? PRIORITY.highlightBonus : 0) });
      const note = (stacked ? stackNotes : sideNotes)[index]!;
      request(`target:${row.id}`, 'annotation', owner, note.text, noteFont,
        { x: plot0.x, y: noteTop, w: note.w, h: note.h }, { ...fittedLabel(note as Parameters<typeof fittedLabel>[0], noteFont), role: 'note' });
      inks.set(`target:${row.id}`, { token: 'inkMuted' });
    }
    const shareRight = stacked ? plot0.x + plot0.w : columnRight.get('share');
    const valueText = valueTexts[index];
    if (valueText) {
      const size1 = measure(valueText, valueFont);
      const right = stacked ? plot0.x + plot0.w - (shareW ? shareW + VALUE_GAP : 0) : columnRight.get('actual')!;
      request(`point:${row.id}`, 'point', owner, valueText, valueFont,
        { x: right - size1.width, y: valueCenter - size1.height / 2, w: size1.width, h: size1.height });
    }
    const shareLabel = shareTexts[index];
    if (shareLabel && shareRight !== undefined) {
      const size2 = measure(shareLabel, shareFont);
      request(`share:${row.id}`, 'annotation', owner, shareLabel, shareFont,
        { x: shareRight - size2.width, y: valueCenter - size2.height / 2, w: size2.width, h: size2.height }, { role: 'value' });
      inks.set(`share:${row.id}`, { token: 'ink' });
    }
    const delta = deltas[index];
    const deltaLabel = stacked ? deltaTexts[index] : deltaBodies[index];
    if (deltaLabel && delta !== undefined) {
      const size3 = measure(deltaLabel, deltaFont);
      const labelId = `delta:${row.id}`;
      const tone = input.deltaTone(row, delta);
      const right = stacked ? plot0.x + plot0.w : columnRight.get('delta')!;
      const y = stacked ? noteTop + (deltaSeparate ? stackNoteH + 2 : 0) : valueCenter - size3.height / 2;
      request(labelId, 'annotation', owner, deltaLabel, deltaFont,
        { x: right - size3.width, y, w: size3.width, h: size3.height }, { role: composedTextRole(deltaLabel, 'note'), priority: PRIORITY.extreme });
      inks.set(labelId, { token: tone === 'neutral' ? 'ink' : tone });
      placedAnnotations.push({
        id: `delta-target:${row.id}`,
        kind: 'delta',
        computedText: deltaLabel,
        tone,
        nodeIds: [],
        labelId,
        derivation: {
          basis: 'derived',
          op: 'annotation-delta@1',
          inputs: [
            { ref: `${row.id}:value`, value: row.value },
            { ref: `${row.id}:target`, value: row.target },
          ],
          raw: delta,
        },
      });
    }
    marks.rows.push({
      id: row.id,
      bandNodeIds: rowBandIds.get(row.id)!,
      ...(barNodeId ? { barNodeId } : {}),
      ...(anyTarget && row.target !== null ? { targetNodeId: index > 0 ? `target:shared:${row.id}` : 'target:shared' } : {}),
      rect: { x: plot.x, y: top, w: plot.w, h: rowHeights[index]! },
    });
  });

  // ---- solve and emit ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 0,
  });
  const solved = solveLabels(requests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);
  for (const label of solved.placed) {
    const ink = inks.get(label.id);
    if (ink) label.ink = ink;
  }
  const labelNodes = labelsToNodes(theme, solved.placed, (label) => fonts.get(label.id) ?? nameFont);
  asColumnHeads(labelNodes);
  pushAll(nodes, labelNodes);

  const shareById: Record<Id, number> = emptyIdRecord();
  rows.forEach((row, index) => {
    const share = shares[index];
    if (share !== undefined) shareById[row.id] = Math.round(share * 100) / 100;
  });
  const describeRow = (row: TargetScaleRow, index: number): string => {
    const share = shares[index];
    const value = input.valueText(row) ?? 'n/a';
    const delta = input.deltaVsTarget[row.id];
    return `${row.label} ${value}` +
      (share === undefined ? '' : `, ${shareText(share)} ${chartString(options, 'ofTarget', { v1: target })}, ${input.targetText(row)}`) +
      (delta === undefined ? '' : ` (${input.deltaText(row, delta)}, ${chartString(options, ({good: 'toneGood', bad: 'toneBad', warn: 'toneWarn', neutral: 'toneNeutral'} as const)[input.deltaTone(row, delta)])})`);
  };

  return {
    type: 'bullet',
    ...(input.paintWarningRules?.length ? { paintWarningRules: input.paintWarningRules } : {}),
    size,
    sizing: rowSizing('bullet', size, {
      chromeH: size.height - availH,
      minimumRowsH,
      naturalRowsH: span(naturalPitch),
      // Stacked rows keep 160 px of band and their widest text line; side by side, 80 px of plot.
      minWidth: stacked ? size.width - plot.w + Math.max(160, stackLeftW, deltaW, stackValuesW) : size.width - plot.w + 80,
    }),
    plot,
    scene: nodes,
    labels: solved.placed,
    axes: [
      {
        axis: 'y',
        ticks: rows.map((row, index) => ({
          at: row.id,
          pos: rowsTop + rowTops[index]! + line1H / 2,
          labelId: labelOn('category') ? `category:${row.id}` : undefined,
        })),
      },
      { axis: 'x', ticks: axisTicks },
    ],
    annotations: placedAnnotations,
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: { deltaVsTarget: input.deltaVsTarget, percentOfTarget: shareById },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'bulletTargetTitle', { v1: rows.length, v2: target })),
      titleCounts: [structureCount('rows', rows.length, chartString(options, 'kpisCount', { v1: rows.length }))],
      counts: [structureCount('rows', rows.length, chartString(options, 'kpiRowsCount', { v1: rows.length }))],
      desc:
        chartString(options, 'bulletTargetDesc', { v1: rows.length, v2: target, v3: hi }) +
        // A card of neutral rows only draws no better side, so it has its own band text.
        (directions.every(direction => direction === 'neutral') ? chartString(options, 'bulletNeutralOnlyBandsDesc', { v1: target })
          // A card names only the zones it draws: the mirrored text needs rows of both better sides.
          : chartString(options, !directions.includes('lowerIsBetter') ? 'bulletBandsDesc' : directions.includes('higherIsBetter') ? 'bulletMirroredBandsDesc' : 'bulletLowerBandsDesc', { v1: target, v2: target }) +
            (directions.includes('neutral') ? chartString(options, 'bulletNeutralBandsDesc', { v1: target }) : '')) +
        `${rows.map(describeRow).join('; ')}.`,
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: solved.decisions,
    },
  };
}
