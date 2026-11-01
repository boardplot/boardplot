import { chartString } from '../../strings/slope';
/**
 * Slope `variant: 'diverging'`: one panel
 * per group, the positive answer share as an area up from a shared zero line,
 * the negative share as an area down from it, both labelled as positive
 * numbers. Each area's outer edge is a slope from period 1 (open marker) to
 * period 2 (filled marker). All panels share one value scale, so every zero
 * line in a row sits at the same height and equal shares draw equal heights.
 */

import { chartTheme } from '../chartEnv';
import { fitText } from '../../label/fitText';
import { formatAuthoredPercent, formatAutomaticNumber, numberRange, seriesValueFormatter } from '../../format';
import { differenceExample, formatterFromExample, signedFormatterFromExample } from '../../formatSpec';
import { autoDecimals } from '../../formatPrecision';
import { cleanDiff, cleanFloat, type Rect } from '../../geometry';
import { createOccupiedIndex } from '../../label/occupied';
import { labelsToNodes } from '../../label/emit';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import { accessibleTitle, NormalizeError, normalizeCategory, normalizeSeriesValues, resolveSize } from '../../normalize/shared';
import { authoredFootnoteCount, authoredNotes, frameTextOptions, plotHeightAfter, solveFrame } from '../../frame';
import { defaultMeasurer, type FontSpec } from '../../text';
import { colorblindPaint, emphasisWeight, strokeToken, canvasMargin, resolveSemanticPaletteTheme } from '../../theme';
import { cellMeta, cellValue, isPctCell, type Id } from '../../types/cell';
import type { Category, ChartData, SlopeSeries as DivergingSeries } from '../../types/data';
import type { SlopeOptions } from '../../types/options';
import type { Geometry, LintWarning, Paint, SceneNode } from '../../types/scene';
import { markedLabel } from '../../footnoteMark';
import { structureCount } from '../../structureCounts';
import { resolveSizing } from '../../sizing';
import { SLOPE_SIZING } from './slopeSizing';
import type { SlopeDerived, SlopeMarks } from './layout';
import { disclosureNote } from '../../notes';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

/** Per group, period 1 then period 2. */
export interface DivergingGroup {
  positive: [number, number];
  negative: [number, number];
  net: [number, number];
  netChange: number;
  /** 100 minus both shares: the respondents who chose neither answer. */
  neither: [number, number];
  n?: [number, number];
  lowBase: boolean;
}

export interface DivergingPanelMark {
  seriesId: Id;
  /** The panel's whole cell, head to footer. */
  rect: Rect;
  zeroY: number;
  x0: number;
  x1: number;
  positiveY: [number, number];
  negativeY: [number, number];
}

const MAX_GROUPS = 12;
const MAX_PER_ROW = 8;
// 88 px keeps two columns at 320 px under the 16 px card margins (80 gives three).
const MIN_PANEL_W = 88;
const PANEL_GAP = 16;
const ROW_GAP = 14;
const MIN_BAND = 60;
/**
 * Px per point an unsized chart is drawn at: the canvas width over this, held
 * between NATURAL_SCALE_MIN and NATURAL_SCALE_MAX (1.5 at 960, 1.15 on a card).
 */
const NATURAL_SCALE_WIDTH = 640;
const NATURAL_SCALE_MIN = 1.15;
const NATURAL_SCALE_MAX = 1.5;
const DOT_R = 3.5;
/** Space between the area swatches and the period key in the key row. */
const KEY_GAP = 22;
/** The least space there, the gap between the two area swatches. */
const KEY_GAP_MIN = 12;
/** The period key's run between its dots, and the shortest it gets on a narrow card. */
const KEY_RUN = 24;
const KEY_RUN_MIN = 14;
/** Least space between two neighbouring panel heads. */
const HEAD_CLEAR = 6;
const DEFAULT_MIN_BASE = 30;

export function layoutDivergingSlope(
  data: ChartData,
  options: SlopeOptions = {},
): Geometry<SlopeMarks, SlopeDerived> {
  const warnings: LintWarning[] = [];
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const opt = options.diverging ?? {};
  const language = options.locale?.language;
  // An authored chart format holds every panel to one scale and one decimal count (exampleSpec).
  let chartFormat: ((v: number) => string) | undefined;
  const fmtVal = (v: number, isPct: boolean, example = options.format): string =>
    example && example === options.format ? (chartFormat ??= formatterFromExample(example, language, undefined, panels.flatMap((p) => [...p.g.positive, ...p.g.negative])))(v)
    : example ? formatterFromExample(example, options.locale?.language)(v)
      : isPct ? formatAuthoredPercent(v, language) : formatAutomaticNumber(v, { locale: language, decimals: autoDecimals(v) });

  // ---- normalize ----
  if (!data || !Array.isArray(data.categories) || data.categories.length < 2) {
    throw new NormalizeError('empty-data', 'categories', "slope variant 'diverging' requires two categories (periods)");
  }
  if (data.categories.length > 2) {
    throw new NormalizeError(
      'slope-diverging-too-many-periods',
      'categories',
      `slope variant 'diverging' compares exactly two periods, got ${data.categories.length}: an area between three or more survey waves suggests a path between them`,
      "keep the first and last period here; draw a trend over more waves with type 'line', or one wave's full answer scale with type 'likert'",
    );
  }
  const cats: Category[] = data.categories.map((c, i) => normalizeCategory(c as never, i));
  const [c0, c1] = [cats[0]!, cats[1]!];
  const p1 = c0.label ?? c0.id;
  const p2 = c1.label ?? c1.id;
  const minBase = opt.minBase ?? DEFAULT_MIN_BASE;

  interface Norm { s: DivergingSeries; label: string; g: DivergingGroup; isPct: boolean; formats: { positive: (string | undefined)[]; negative: (string | undefined)[] } }
  const groups: Norm[] = [];
  (data.series as DivergingSeries[]).forEach((s, si) => {
    if (!s?.id) throw new NormalizeError('missing-id', `series[${si}]`, 'series requires an id');
    if (s.role === 'reference') return;
    if (!Array.isArray(s.negative)) {
      throw new NormalizeError(
        'slope-diverging-missing-negative',
        `series[${s.id}].negative`,
        `series '${s.id}' has no negative share: variant 'diverging' draws values as the positive share and negative as the negative share`,
        `add "negative": [<period 1>, <period 2>] to series '${s.id}', as positive numbers`,
      );
    }
    const pos = normalizeSeriesValues(s, cats, si);
    const neg = normalizeSeriesValues({ ...s, values: s.negative }, cats, si);
    const pv = pos.map(cellValue);
    const nv = neg.map(cellValue);
    if ([...pv, ...nv].some((v) => v === null)) {
      warnings.push({
        code: 'slope-missing-endpoint',
        severity: 'warn',
        message: `series '${s.id}': a share is missing in one period — the group is not drawn`,
        owner: { seriesId: s.id },
      });
      return;
    }
    if ([...pv, ...nv].some((v) => v! < 0)) {
      throw new NormalizeError(
        'slope-diverging-negative-value',
        `series[${s.id}]`,
        `series '${s.id}' has a share below zero: both shares are counts of respondents, so the negative share is drawn downward but given as a positive number`,
        'give every share as a positive number, for example 12 rather than -12',
      );
    }
    const positive: [number, number] = [pv[0]!, pv[1]!];
    const negative: [number, number] = [nv[0]!, nv[1]!];
    const net: [number, number] = [cleanDiff(positive[0], negative[0]), cleanDiff(positive[1], negative[1])];
    const n = s.n === undefined ? undefined : (typeof s.n === 'number' ? [s.n, s.n] : [s.n[0]!, s.n[s.n.length - 1]!]) as [number, number];
    groups.push({
      s,
      label: s.label ?? s.id,
      isPct: isPctCell(pos[1]!),
      formats: { positive: pos.map((c) => cellMeta(c)?.format), negative: neg.map((c) => cellMeta(c)?.format) },
      g: {
        positive,
        negative,
        net,
        netChange: cleanDiff(net[1], net[0]),
        neither: [cleanFloat(100 - positive[0] - negative[0], 100), cleanFloat(100 - positive[1] - negative[1], 100)],
        ...(n ? { n } : {}),
        lowBase: n !== undefined && Math.min(...n) < minBase,
      },
    });
  });
  if (groups.length === 0) throw new NormalizeError('empty-data', 'series', "slope variant 'diverging' requires at least one group with both shares in both periods");
  if (groups.length > MAX_GROUPS) {
    throw new NormalizeError(
      'slope-diverging-too-many-groups',
      'series',
      `slope variant 'diverging' draws one panel per group and reads up to ${MAX_GROUPS} groups, got ${groups.length}`,
      "group the series further, or draw the net score per group with type 'likert' (sortBy 'net')",
    );
  }
  for (const { s, g } of groups) {
    if (g.neither.some((v) => v < -0.5)) {
      warnings.push({
        code: 'slope-diverging-over-100',
        severity: 'warn',
        message: `series '${s.id}': the positive and negative shares add to more than 100 in one period`,
        suggest: 'give both shares in percent of the same respondents',
        owner: { seriesId: s.id },
      });
    }
  }

  // ---- order ----
  const sort = opt.sort ?? 'positive';
  const order = groups.map((x, i) => ({ x, i }));
  if (sort !== 'data') {
    const key = (x: Norm) => (sort === 'net' ? x.g.net[1] : x.g.positive[1]);
    order.sort((a, b) => key(b.x) - key(a.x) || a.i - b.i);
  }
  const panels = order.map((o) => o.x);
  // Net and net change are differences of two shares, so a percent format prints them in percentage points.
  const signed = options.format
    ? signedFormatterFromExample(differenceExample(options.format), language, undefined, panels.flatMap((p) => [...p.g.positive, ...p.g.negative]))
    : (v: number): string => formatAutomaticNumber(v, { locale: language, signed: true, decimals: autoDecimals(v) });

  // ---- notes ----
  const posName = opt.labels?.positive ?? chartString(options, 'positiveName');
  const negName = opt.labels?.negative ?? chartString(options, 'negativeName');
  const showNet = opt.net ?? true;
  const notes: string[] = [...authoredNotes(options)];
  // The note shows when any group and period leaves a rest; its range covers every group and period, zeros included.
  const neitherAll = panels.flatMap((p) => p.g.neither).map((v) => Math.max(0, v));
  if ((opt.neutralNote ?? true) && neitherAll.some((v) => v > 0.5)) {
    const lo = minOf(neitherAll);
    const hi = maxOf(neitherAll);
    const restFmt = options.format ? (v: number) => fmtVal(v, false) : seriesValueFormatter([lo, hi], language);
    const span = lo === hi ? restFmt(lo) : numberRange(restFmt(lo), restFmt(hi));
    notes.push(disclosureNote(chartString(options, 'slopeResponseRest', { v1: posName, v2: negName, v3: span })));
  }
  const low = panels.filter((p) => p.g.lowBase);
  if (low.length > 0) {
    notes.push(disclosureNote(chartString(options, 'slopeBaseNote', { v1: minBase, v2: low.map((p) => `${p.label}: n = ${p.g.n![0]} / ${p.g.n![1]}`).join('; ') })));
  }

  // ---- frame ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  if (options.legend !== undefined) {
    warnings.push({ code: 'slope-diverging-legend-ignored', severity: 'info', message: "variant 'diverging' keys its areas and periods in its own key row; legend is ignored", suggest: 'remove legend' });
  }
  if ((options.annotations ?? []).length > 0) {
    warnings.push({ code: 'slope-diverging-annotations-ignored', severity: 'warn', message: "variant 'diverging' draws no annotations; they are ignored", suggest: 'remove annotations, or state the point in the title' });
  }
  const frameResult = solveFrame({ size, margin, ...frameTextOptions(options), footnotes: notes, theme, measure }, occupied);
  const nodes: SceneNode[] = [...frameResult.nodes];

  // ---- fonts and paints ----
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  // Panel heads and the net row carry the emphasis weight.
  const headFont: FontSpec = { ...labelFont, weight: emphasisWeight(theme) };
  const netFont: FontSpec = headFont;
  const lineH = labelFont.size * (labelFont.lineHeight ?? 1.2);
  const textH = measure('0', labelFont).height;
  // Better takes the colour-blind good, as the likert agree side does: red
  // against blue stays apart for a red-green colour-blind reader.
  const posSolid = colorblindPaint('good', true);
  const posFill: Paint = { ...posSolid, tint: 0.62 };
  const negFill: Paint = { token: 'badFill', tint: 0.62 };
  const posEdge: Paint = colorblindPaint('good');
  const negEdge: Paint = { token: 'bad' };
  const keyInk: Paint = { token: 'markInk' };

  const labelRequests: LabelRequest[] = [];
  const fontById = new Map<string, FontSpec>();
  const fixed = (id: string, kind: LabelRequest['kind'], owner: LabelRequest['owner'], lines: string[], font: FontSpec, rects: Rect[], priority: number, middle = true, role?: LabelRequest['role'], runs?: LabelRequest['runs']): void => {
    fontById.set(id, font);
    labelRequests.push({
      id, kind, owner, text: lines.join(' '), lines, font, priority,
      ...(role ? { role } : {}),
      ...(runs ? { runs } : {}),
      ...(middle ? { align: 'middle' as const } : {}),
      candidates: rects.map((rect, k) => ({ slot: `seat${k}`, rect, penalty: k })),
    });
  };

  // ---- key row, left-aligned: the two area swatches,
  // then "P1 ○—● P2"; the period key takes a second row when one is too narrow.
  // With the net row on, the net definition follows on the period key's row,
  // or on a row of its own when it does not fit there. It keys the bare
  // numbers under every panel, so it stays on the page.
  const plot0 = frameResult.plot;
  const keyRowH = textH + 10;
  const w1 = measure(p1, labelFont).width;
  const w2 = measure(p2, labelFont).width;
  const sw = 10;
  const posW = measure(posName, labelFont).width;
  const negW = measure(negName, labelFont).width;
  const swatchesW = sw + 4 + posW + 12 + sw + 4 + negW;
  const periodW = (run: number): number => w1 + 6 + DOT_R * 2 + run + DOT_R * 2 + 6 + w2;
  // A narrow card keeps the three items on one row: the period key comes as
  // close as the swatches stand to each other, and its run shortens to KEY_RUN_MIN, before
  // the period key takes a row of its own.
  const tightRun = Math.min(KEY_RUN, plot0.w - swatchesW - KEY_GAP_MIN - periodW(0));
  const tight = swatchesW + KEY_GAP + periodW(KEY_RUN) > plot0.w && tightRun >= KEY_RUN_MIN;
  const keyRun = tight ? tightRun : KEY_RUN;
  const areasW = swatchesW + (tight ? KEY_GAP_MIN : KEY_GAP);
  const keyW = periodW(keyRun);
  const keyWraps = areasW + keyW > plot0.w + 1e-6;
  const netName = chartString(options, 'slopeNetName');
  const netRest = chartString(options, 'slopeNetKey', { v1: posName, v2: negName, v3: p2, v4: p1 });
  const netNameW = measure(netName, headFont).width;
  const netKeyW = netNameW + measure(netRest, labelFont).width;
  const periodEnd = (keyWraps ? 0 : areasW) + keyW;
  const netInline = showNet && periodEnd + KEY_GAP + netKeyW <= plot0.w + 1e-6;
  // A definition wider than the plot wraps in full, however long the period
  // names are; the name keeps its weight on the first line.
  const netWrapW = plot0.w - (netNameW - measure(netName, labelFont).width);
  const netLines = !showNet || netInline || netKeyW <= plot0.w + 1e-6
    ? [`${netName}${netRest}`]
    : fitText(`${netName}${netRest}`, labelFont, netWrapW, 2 * Math.ceil(netKeyW / Math.max(netWrapW, 1)) + 1, measure).lines;
  // The net row's wrapped lines sit at the text pitch, not the key-row pitch,
  // with room for the label padding between them.
  const netPitch = Math.max(lineH, textH + 3);
  const keyH = keyRowH * ((keyWraps ? 2 : 1) + (showNet && !netInline ? 1 : 0)) + (netInline ? 0 : (netLines.length - 1) * netPitch);
  const keyCy = plot0.y + textH / 2;
  {
    let x = plot0.x;
    for (const [name, fill, w] of [[posName, posFill, posW], [negName, negFill, negW]] as const) {
      nodes.push({ t: 'rect', id: `legend:area:${name}`, rect: { x, y: keyCy - sw / 2, w: sw, h: sw }, fill, owner: {}, part: 'legendKey' });
      fixed(`series:${name}`, 'series', {}, [name], labelFont, [{ x: x + sw + 4, y: keyCy - textH / 2, w, h: textH }], PRIORITY.reference, false);
      x += sw + 4 + w + 12;
    }
  }
  const keyX = keyWraps ? plot0.x : plot0.x + areasW;
  const periodCy = keyWraps ? keyCy + keyRowH : keyCy;
  const k0 = keyX + w1 + 6 + DOT_R;
  const k1 = k0 + DOT_R + keyRun + DOT_R;
  fixed('legend:period:0', 'category', { categoryId: c0.id }, [p1], labelFont, [{ x: keyX, y: periodCy - textH / 2, w: w1, h: textH }], PRIORITY.reference, false);
  fixed('legend:period:1', 'category', { categoryId: c1.id }, [p2], labelFont, [{ x: k1 + DOT_R + 6, y: periodCy - textH / 2, w: w2, h: textH }], PRIORITY.reference, false);
  nodes.push(
    { t: 'line', id: 'legend:period:run', x1: k0, y1: periodCy, x2: k1, y2: periodCy, stroke: keyInk, width: strokeToken(theme, 'data'), owner: {}, part: 'legendKey' },
    { t: 'circle', id: 'legend:period:open', cx: k0, cy: periodCy, r: DOT_R, fill: { token: 'background' }, stroke: keyInk, strokeWidth: strokeToken(theme, 'mark'), owner: { categoryId: c0.id }, part: 'legendKey' },
    { t: 'circle', id: 'legend:period:filled', cx: k1, cy: periodCy, r: DOT_R, fill: keyInk, owner: { categoryId: c1.id }, part: 'legendKey' },
  );
  occupied.claim({ x: k0 - DOT_R, y: periodCy - DOT_R, w: k1 - k0 + 2 * DOT_R, h: 2 * DOT_R }, 'mark', {});
  if (showNet) {
    const netX = netInline ? plot0.x + periodEnd + KEY_GAP : plot0.x;
    netLines.forEach((text, li) => {
      const cy = netInline ? periodCy : periodCy + keyRowH + li * netPitch;
      const first = li === 0 && text.startsWith(netName);
      const w = first ? netNameW + measure(text.slice(netName.length), labelFont).width : measure(text, labelFont).width;
      const runs = first ? [{ text: netName, weight: headFont.weight }, { text: text.slice(netName.length) }] : undefined;
      fixed(`legend:net:${li}`, 'series', {}, [text], labelFont, [{ x: netX, y: cy - textH / 2, w, h: textH }], PRIORITY.reference, false, undefined, runs);
    });
  }

  // ---- panel grid ----
  const gridY = plot0.y + keyH;
  const gridH = plotHeightAfter(frameResult, size.height, plot0.h - keyH);
  const count = panels.length;
  let cols = Math.max(1, Math.min(count, MAX_PER_ROW, Math.floor((plot0.w + PANEL_GAP) / (MIN_PANEL_W + PANEL_GAP))));
  const rows = Math.ceil(count / cols);
  cols = Math.ceil(count / rows);
  const pw = (plot0.w - (cols - 1) * PANEL_GAP) / cols;
  // Each group's shares take one precision (seriesValueFormatter), not one per value.
  const groupFmts = new Map<Norm, (v: number) => string>();
  const valueText = (v: number, p: Norm, side: 'positive' | 'negative', e: number) => {
    const example = p.formats[side][e] ?? p.s.format ?? options.format;
    if (example || p.isPct) return fmtVal(v, p.isPct, example);
    let fmt = groupFmts.get(p);
    if (!fmt) groupFmts.set(p, fmt = seriesValueFormatter([...p.g.positive, ...p.g.negative], language));
    return fmt(v);
  };
  const valueW = maxOf(panels.flatMap((p) => (['positive', 'negative'] as const).flatMap((side) => p.g[side].map((v, e) => measure(valueText(v, p, side, e), labelFont).width))));
  const inset = Math.min(pw / 4, Math.max(6, valueW / 2 + 2));
  const heads = panels.map((p) => {
    const suffix = markedLabel('', p.s.footnote, p.s.id, { count: authoredFootnoteCount(options), warnings });
    // The name is fitted first and the mark appended, so a wrap never strands "2)" on a line of its own.
    // A head may reach into the gap beside its panel, keeping HEAD_CLEAR px from the next head.
    const fit = fitText(p.label, headFont, pw + PANEL_GAP - HEAD_CLEAR - measure(suffix, headFont).width, 3, measure);
    if (!suffix) return fit;
    const lines = [...fit.lines.slice(0, -1), `${fit.lines[fit.lines.length - 1]}${suffix}`];
    return { ...fit, lines, w: Math.max(...lines.map((l) => measure(l, fit.font).width)) };
  });
  const headLines = maxOf(heads.map((h) => h.lines.length));
  const headH = headLines * headFont.size * (headFont.lineHeight ?? 1.2);
  const hasN = panels.some((p) => p.g.n !== undefined);
  const footerLines = (showNet ? 1 : 0) + (hasN ? 1 : 0);
  const footerPitch = lineH + 2;
  const footerH = footerLines * footerPitch + (footerLines > 0 ? 4 : 0);
  // One px-per-point scale k for every panel; each row reserves only its own
  // largest positive and negative share.
  const rowExt = Array.from({ length: rows }, (_, r) => {
    const members = panels.slice(r * cols, (r + 1) * cols);
    return { pos: maxOf(members.map((p) => Math.max(...p.g.positive))), neg: maxOf(members.map((p) => Math.max(...p.g.negative))) };
  });
  const sumExt = Math.max(rowExt.reduce((a, e) => a + e.pos + e.neg, 0), 1e-9);
  const bandOffset = headH + 4 + textH + 6;
  const rowFixed = bandOffset + textH + 6 + footerH;
  const k = Math.max((gridH - (rows - 1) * ROW_GAP - rows * rowFixed) / sumExt, 1e-9);
  const maxPos = maxOf(panels.map((p) => Math.max(...p.g.positive)));
  const maxNeg = maxOf(panels.map((p) => Math.max(...p.g.negative)));
  // A row band of MIN_BAND px over the full extent is the smallest scale that reads.
  const kMin = MIN_BAND / Math.max(maxPos + maxNeg, 1e-9);
  const kNatural = Math.min(NATURAL_SCALE_MAX, Math.max(NATURAL_SCALE_MIN, size.width / NATURAL_SCALE_WIDTH));
  // Every height but the bands is fixed by the width, so the minimum and the
  // natural height follow from the scale directly. The 1e-6 drops float
  // noise, so a second pass at the natural height lands on the same height.
  const minHeight = Math.ceil(size.height + (frameResult.deficit ?? 0) + (kMin - k) * sumExt - 1e-6);
  const naturalHeight = Math.ceil(size.height + (frameResult.deficit ?? 0) + (kNatural - k) * sumExt - 1e-6);
  if (k < kMin) {
    frameResult.frame.plotMinHeight = Math.max(frameResult.frame.plotMinHeight ?? 0, minHeight);
  }
  const rowTop: number[] = [];
  const rowHs: number[] = [];
  rowExt.reduce((y, e) => {
    const h = rowFixed + k * (e.pos + e.neg);
    rowTop.push(y);
    rowHs.push(h);
    return y + h + ROW_GAP;
  }, gridY);

  const marks: SlopeMarks = { series: [], panels: [] };
  const fmtN = (v: number) => Math.round(v * 100) / 100;
  const poly = (pts: [number, number][]): string => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmtN(x)} ${fmtN(y)}`).join('') + 'Z';
  const line = (pts: [number, number][]): string => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmtN(x)} ${fmtN(y)}`).join('');

  panels.forEach((p, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const px = plot0.x + col * (pw + PANEL_GAP);
    const rowY = rowTop[row]!;
    const rowH = rowHs[row]!;
    const zeroY = rowY + bandOffset + rowExt[row]!.pos * k;
    const x0 = px + inset;
    const x1 = px + pw - inset;
    const id = p.s.id;
    // The negative share is its own series to hover and read: own owner, own record.
    const nid = `${id}:negative`;
    const yP: [number, number] = [zeroY - p.g.positive[0] * k, zeroY - p.g.positive[1] * k];
    const yN: [number, number] = [zeroY + p.g.negative[0] * k, zeroY + p.g.negative[1] * k];
    const hatch = p.g.lowBase ? { pattern: 'hatch45' as const } : {};
    nodes.push(
      { t: 'path', id: `area:${id}:positive`, d: poly([[x0, zeroY], [x0, yP[0]], [x1, yP[1]], [x1, zeroY]]), fill: p.g.lowBase ? posSolid : posFill, ...hatch, owner: { seriesId: id }, part: 'area' },
      { t: 'path', id: `area:${id}:negative`, d: poly([[x0, zeroY], [x0, yN[0]], [x1, yN[1]], [x1, zeroY]]), fill: p.g.lowBase ? { token: 'badFill' } : negFill, ...hatch, owner: { seriesId: nid }, part: 'area' },
      { t: 'line', id: `zero:${id}`, x1: x0, y1: zeroY, x2: x1, y2: zeroY, stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: { seriesId: id }, part: 'zeroLine' },
      { t: 'path', id: `mark:${id}`, d: line([[x0, yP[0]], [x1, yP[1]]]), stroke: posEdge, width: strokeToken(theme, 'data'), owner: { seriesId: id }, part: 'slope' },
      { t: 'path', id: `mark:${id}:negative`, d: line([[x0, yN[0]], [x1, yN[1]]]), stroke: negEdge, width: strokeToken(theme, 'data'), owner: { seriesId: nid }, part: 'slope' },
    );
    const sides = [
      { side: 'positive' as const, ys: yP, vals: p.g.positive, edge: posEdge, sid: id },
      { side: 'negative' as const, ys: yN, vals: p.g.negative, edge: negEdge, sid: nid },
    ];
    for (const { side, ys, vals, edge, sid } of sides) {
      [0, 1].forEach((e) => {
        const cx = e === 0 ? x0 : x1;
        const cy = ys[e]!;
        const cat = e === 0 ? c0 : c1;
        const text = valueText(vals[e]!, p, side, e);
        nodes.push({
          t: 'circle', id: `dot:${id}:${side}:${cat.id}`, cx, cy, r: DOT_R,
          fill: e === 0 ? { token: 'background' } : edge,
          ...(e === 0 ? { stroke: edge, strokeWidth: strokeToken(theme, 'mark') } : {}),
          owner: { seriesId: sid, categoryId: cat.id }, part: 'endpointDot', display: { value: text },
        });
        occupied.claim({ x: cx - DOT_R, y: cy - DOT_R, w: 2 * DOT_R, h: 2 * DOT_R }, 'mark', { seriesId: sid, categoryId: cat.id });
        const w = measure(text, labelFont).width;
        const above = { x: cx - w / 2, y: cy - DOT_R - 3 - textH, w, h: textH };
        const below = { x: cx - w / 2, y: cy + DOT_R + 3, w, h: textH };
        const beside = { x: e === 0 ? cx - DOT_R - 3 - w : cx + DOT_R + 3, y: cy - textH / 2, w, h: textH };
        fixed(`point:${id}:${side}:${cat.id}`, 'point', { seriesId: sid, categoryId: cat.id }, [text], labelFont,
          side === 'positive' ? [above, beside] : [below, beside], PRIORITY.endpoint);
      });
    }
    // head, top-aligned over the panel
    const head = heads[i]!;
    const hh = head.lines.length * headFont.size * (headFont.lineHeight ?? 1.2);
    fixed(`category:${id}`, 'category', { seriesId: id }, head.lines, head.font, [{ x: px + pw / 2 - head.w / 2, y: rowY, w: head.w, h: hh }], PRIORITY.reference);
    // footer: net score and base
    let fy = rowY + rowH - footerH + 4;
    if (showNet) {
      // The key row defines the net score once, so each panel prints the numbers only.
      const text = `${signed(p.g.net[1])} (${signed(p.g.netChange)})`;
      const w = measure(text, netFont).width;
      fixed(`total:${id}:net`, 'total', { seriesId: id }, [text], netFont, [{ x: px + pw / 2 - w / 2, y: fy, w, h: textH }], PRIORITY.total, true, 'note');
      fy += footerPitch;
    }
    if (p.g.n) {
      const text = `n = ${formatAutomaticNumber(p.g.n[1], { locale: language, decimals: 0 })}`;
      const w = measure(text, labelFont).width;
      fixed(`total:${id}:base`, 'total', { seriesId: id }, [text], labelFont, [{ x: px + pw / 2 - w / 2, y: fy, w, h: textH }], PRIORITY.total, true, 'note');
    }
    marks.series.push({ seriesId: id, lineNodeId: `mark:${id}`, from: { x: x0, y: yP[0] }, to: { x: x1, y: yP[1] } });
    marks.series.push({ seriesId: nid, lineNodeId: `mark:${id}:negative`, from: { x: x0, y: yN[0] }, to: { x: x1, y: yN[1] } });
    marks.panels!.push({ seriesId: id, rect: { x: px, y: rowY, w: pw, h: rowH }, zeroY, x0, x1, positiveY: yP, negativeY: yN });
  });

  // ---- solve and emit ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    focus: undefined,
    measure,
    plot: plot0,
    labelPad: 1,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);
  pushAll(nodes, labelsToNodes(theme, solved.placed, (l) => fontById.get(l.id) ?? labelFont));

  // ---- derived and a11y ----
  const changes: SlopeDerived['changes'] = emptyIdRecord();
  for (const p of panels) {
    const abs = cleanDiff(p.g.positive[1], p.g.positive[0]);
    changes[p.s.id] = { abs, pct: p.g.positive[0] !== 0 ? cleanFloat((abs / p.g.positive[0]) * 100) : null };
  }
  const rising = panels.filter((p) => p.g.netChange > 0).length;
  const best = [...panels].sort((a, b) => b.g.net[1] - a.g.net[1])[0]!;
  const desc = chartString(options, 'divergingSlopeDesc', { v1: panels.length, v2: posName, v3: negName, v4: p1, v5: p2 })
    + chartString(options, 'slopeNetRiseDesc', { v1: rising, v2: p2, v3: best.label, v4: signed(best.g.net[1]) })
    + (low.length > 0 ? chartString(options, 'slopeLowBaseDesc', { v1: low.map((p) => p.label).join(', ') }) : '');

  return {
    type: 'slope',
    size,
    plot: plot0,
    scene: nodes,
    labels: solved.placed,
    axes: [],
    annotations: [],
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: {
      changes,
      diverging: {
        order: panels.map((p) => p.s.id),
        groups: Object.fromEntries(panels.map((p) => [p.s.id, p.g])),
      },
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'divergingSlopeTitle', { v1: panels.length, v2: p1, v3: p2 })),
      counts: [structureCount('series', panels.length, undefined, options)],
      desc,
    },
    warnings,
    sizing: resolveSizing(SLOPE_SIZING, size, { minHeight, naturalHeight }),
    debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
}
