import { chartString } from '../../strings/treemap';
/**
 * Treemap. Every item is one cell whose area is proportional to its value;
 * items of one group share one hue and form one region. Two shapes:
 *
 * - 'rect' (default): squarified rectangles, groups first, then the items
 *   inside each group rectangle. Areas are exact.
 * - 'circle': a Voronoi treemap clipped to a circle, groups first, then the
 *   items inside each group region (geometry.ts). Areas converge to their
 *   targets; the largest relative error is published and warned above 5%.
 *
 * A large cell prints its name and bold value together. A small circle cell
 * keeps its value inside when it fits and moves its name beside the circle.
 * A rectangle that cannot hold the pair sends it to the disclosure list.
 * The legend lists the groups with their totals, largest first.
 */

import { chartPalette } from '../chartEnv';
import { structureCount } from '../../structureCounts';
import { authoredNotes, fixedPlotChrome, frameTextOptions, hiddenNoteWith, markNotedLabels, normalizeLegendOption, NOTED_LABELS, solveFrame, type LegendItemInput } from '../../frame';
import { shareSetFormatter } from '../../format';
import { formatterFromExample, parseFormatExample, seriesRasterFormatter } from '../../formatSpec';
import { withUnit } from '../../unitJoin';
import { round2, type Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize } from '../../normalize/shared';
import { atHardMinimum, HARD_COMPACT_PLOT, CARD_HEIGHT_MEMO, type CardHeightMemo, chartSizing, resolveSizing } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { spread1DResult, warnSpreadOverflow } from '../../collide';
import { defaultMeasurer, graphemes, wrapText, type FontSpec, type TextMeasurer } from '../../text';
import { contrastInkPaint, emphasisWeight, strokeToken, canvasMargin, markRolePaint, paintColor, panelTypeClass, resolveTheme, seriesPaint, themeForWidth } from '../../theme';
import type { Id } from '../../types/cell';
import type { Geometry, LintWarning, Paint, SceneNode } from '../../types/scene';
import { figureRole } from '../cardRoles';
import { composedTextRole } from '../../textRole';
import {
  circlePolygon, polygonArea, polygonCentroid, seedSites, squarify, TREEMAP_AREA_ERROR_LIMIT, TREEMAP_CIRCLE_MAX_ITEMS, voronoiTreemap,
  type Polygon, type Pt,
} from './geometry';
import type { TreemapData, TreemapDerived, TreemapGroupDerived, TreemapItemDerived, TreemapMarks, TreemapOptions } from './types';
import { maxOf, minOf, pushAll } from '../../arrays';

/** An unpinned treemap's plot is about this plus a third of the width tall (440 px at 960, 360 at 720). */
const CONTENT_BASE = 120;
/** An unpinned rectangle treemap grows its plot up to this many content sides while that names more cells. */
const RECT_GROW_MAX = 1.6;
/** Cells of at least this share of the total are worth a taller unpinned rectangle treemap to name. */
const NAMED_SHARE = 0.015;
/** Air between the circle and an outside label column: the leader's elbow and its short last leg. */
const LEADER_GAP = 11;
/** The elbow of a circle leader, this far outside the circle. */
const ELBOW_OUT = 3;
/** Circle cells under this share of the total are named in the note, not on leaders. */
const CIRCLE_NOTE_SHARE = 0.005;
/** The marker at the start of a circle leader, inside its cell. */
const LEADER_DOT_R = 1.6;
/** The line height of a circle's leader columns (11 px lines at 10 px). */
const LEADER_LINE_HEIGHT = 1.1;
/** Inward margin a label keeps from its cell edge. */
const CELL_PAD = 3;
/** A rectangle within this share of a square may lay its squarified row along either side. */
const NEAR_SQUARE = 0.05;
/** Group and item borders, in the page colour. */



interface Group { id: Id; label: string; total: number; paint: Paint; items: Item[] }
interface Item { id: Id; label: string; group?: Id; value: number; index: number }

/** The text plan of one cell: what goes inside, and whether its name goes outside. */
interface CellText {
  /** `oneLine`: name and value side by side, for a wide, shallow cell. */
  inside?: { nameLines: string[]; value: boolean; w: number; h: number; at: Pt; oneLine?: true; stepped?: true };
  /** `oneLine`: name and bold value on one line, for a column too long for two-line pairs. */
  outside?: { nameLines: string[]; w: number; h: number; side: 'left' | 'right'; anchor: Pt; oneLine?: true };
  /** The name, with the value, goes to the note line ('rect'). */
  noted?: true;
}

/** The lead for the note of unnamed cells, per variant. The registry puts it over the locale fill. */
export function treemapDefaultStrings(options: TreemapOptions): Record<string, string> {
  return { hiddenLabels: chartString(options, (options.variant ?? 'rect') === 'circle' ? 'treemapCircleHiddenLead' : 'treemapRectHiddenLead') };
}

/** The label size of one fit step, set on the options of the stepped pass. */
const FIT_STEP = Symbol('treemapFitStep');
/** What a pass left unsolved: names not printed, words broken with a hyphen, and the circle's diameter. */
const FIT_SCORE = new WeakMap<object, { hidden: number; broken: number; side: number; base: number; wanted: number }>();
/** The smallest step a label takes: the secondary step. */
const FIT_FLOOR = 11;
/** At most this many extra passes, one per 1 px step. */
const FIT_PASSES = 3;

/**
 * Type steps. The labels of one tier step down
 * 1 px at a time, to 11 px at least, when the step prints a name the base
 * size cannot, breaks fewer words, or gives a circle that is smaller than its
 * content side more room. Rectangles step all their cells as one tier; a
 * circle steps its leader columns only, and its cells keep the base size.
 */
export function layoutTreemap(data: TreemapData, options: TreemapOptions = {}): Geometry<TreemapMarks, TreemapDerived> {
  // The sizing passes of one request lay out the same data at the same width: the step the first
  // pass chose stands for the others, which then lay out once (the speed budget at 320 px).
  const scope = (options as TreemapOptions & { [CARD_HEIGHT_MEMO]?: CardHeightMemo })[CARD_HEIGHT_MEMO];
  const memo = scope?.active ? searchMemo(scope) : new Map<string, unknown>();
  const memoKey = `fit|${options.variant ?? 'rect'}|${resolveSize(options.size, options.target).width}|${(options as { textScale?: number }).textScale ?? 1}`;
  const known = memo.get(memoKey) as number | undefined;
  if (known !== undefined) return layoutTreemapAt(data, known > 0 ? { ...options, [FIT_STEP]: known } as TreemapOptions : options, memo);
  let best = layoutTreemapAt(data, options, memo);
  const first = FIT_SCORE.get(best);
  if (!first) return best;
  let chosen = 0;
  let score = first;
  for (let px = first.base - 1, pass = 0; px >= FIT_FLOOR && pass < FIT_PASSES; px--, pass++) {
    if (score.hidden === 0 && score.broken === 0 && score.side >= score.wanted) break;
    const next = layoutTreemapAt(data, { ...options, [FIT_STEP]: px } as TreemapOptions, memo);
    const got = FIT_SCORE.get(next)!;
    const better = got.hidden < score.hidden
      || got.hidden === score.hidden && got.broken < score.broken
      || got.hidden === score.hidden && got.broken === score.broken && score.side < score.wanted && got.side >= score.side + 4;
    if (!better) break;
    best = next;
    score = got;
    chosen = px;
  }
  memo.set(memoKey, chosen);
  return best;
}

function layoutTreemapAt(data: TreemapData, options: TreemapOptions, memo: Map<string, unknown>): Geometry<TreemapMarks, TreemapDerived> {
  const fitPx = (options as { [FIT_STEP]?: number })[FIT_STEP];
  const warnings: LintWarning[] = [];
  const size = resolveSize(options.size, options.target);
  const theme = themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? size.width);
  const palette = chartPalette(theme, options.palette, warnings);
  const measure = options.measure ?? defaultMeasurer;
  const shape = options.variant ?? 'rect';
  // A direct call without the registry's locale fill gets the same lead (treemapDefaultStrings).
  if (options.strings?.hiddenLabels === undefined) options = { ...options, strings: { ...options.strings, ...treemapDefaultStrings(options) } };
  const byValue = (options.order ?? 'value') === 'value';
  const locale = options.locale?.language;

  // ---- normalize: items, groups, positive values ----
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    throw new NormalizeError('empty-data', 'items', 'treemap requires at least one item');
  }
  if (shape === 'circle' && data.items.length > TREEMAP_CIRCLE_MAX_ITEMS) {
    throw new NormalizeError('treemap-circle-too-many-items', 'options.variant',
      `a circle treemap draws at most ${TREEMAP_CIRCLE_MAX_ITEMS} items, and this one has ${data.items.length}; its layout time grows with the square of the item count`,
      "Use variant 'rect', or group small items into Other.", undefined, ['options', 'variant']);
  }
  const grouped = data.items.some((item) => item.group !== undefined) || (data.groups?.length ?? 0) > 0;
  const items: Item[] = data.items.map((item, index) => {
    if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value <= 0) {
      throw new NormalizeError('treemap-value-not-positive', `items[${item.id}].value`,
        `treemap value ${String(item.value)} for '${item.id}' is not above 0; a cell area is its value`,
        'Leave the item out, or send a value above 0. Use a bar chart for zero or negative values.', undefined, ['data', 'items', index, 'value']);
    }
    if (grouped && item.group === undefined) {
      throw new NormalizeError('treemap-group-missing', `items[${item.id}].group`, `item '${item.id}' names no group, while other items or data.groups do`,
        'Give every item a group, or leave groups out on every item for a one-level treemap.', undefined, ['data', 'items', index, 'group']);
    }
    return { id: item.id, label: item.label ?? item.id, ...(item.group !== undefined ? { group: item.group } : {}), value: item.value, index };
  });
  const groupSpecs = data.groups ?? [...new Set(items.flatMap((item) => (item.group !== undefined ? [item.group] : [])))].map((id) => ({ id }));
  const known = new Set(groupSpecs.map((g) => g.id));
  items.forEach((item) => {
    if (item.group !== undefined && !known.has(item.group)) {
      throw new NormalizeError('treemap-unknown-group', `items[${item.id}].group`, `item '${item.id}' names group '${item.group}', which data.groups does not list`,
        `Add { id: '${item.group}' } to data.groups, or correct the group id.`, undefined, ['data', 'items', item.index, 'group']);
    }
  });
  const sortItems = (list: Item[]): Item[] => (byValue ? [...list].sort((a, b) => b.value - a.value || a.index - b.index) : list);
  let groups: Group[] = (grouped ? groupSpecs : [{ id: '' }]).flatMap((spec, gi) => {
    const own = sortItems(items.filter((item) => (grouped ? item.group === spec.id : true)));
    if (own.length === 0) {
      warnings.push({ code: 'treemap-empty-group', severity: 'info', message: `group '${spec.id}' has no items, so it draws nothing`, owner: { seriesId: spec.id } });
      return [];
    }
    const g = spec as { id: Id; label?: string; colorRole?: string; fill?: string };
    return [{ id: g.id, label: g.label ?? g.id, total: own.reduce((sum, item) => sum + item.value, 0), items: own, paint: { css: '' } as Paint, gi }];
  }).map(({ gi: _gi, ...g }) => g);
  if (byValue) groups = groups.map((g, i) => ({ g, i })).sort((a, b) => b.g.total - a.g.total || a.i - b.i).map(({ g }) => g);
  // Palette steps follow the drawn order: the largest group takes the first, strongest hue.
  groups.forEach((g, gi) => {
    const spec = groupSpecs.find((s) => s.id === g.id) as { colorRole?: string; fill?: string } | undefined;
    g.paint = spec?.fill ? { css: spec.fill } : spec?.colorRole ? markRolePaint(spec.colorRole, true) : seriesPaint(gi, palette ? options.palette : undefined);
  });
  const ordered = groups.flatMap((g) => g.items);
  const total = groups.reduce((sum, g) => sum + g.total, 0);

  // ---- formats: one precision for the values, one for the shares ----
  const cellValue = options.cellValue ?? 'value';
  const percentExample = options.format && cellValue !== 'value' && parseFormatExample(options.format).suffix.includes('%') ? options.format : undefined;
  const valueExample = percentExample ? undefined : options.format;
  const numberFormat = seriesRasterFormatter(valueExample, ordered.map(item => item.value), locale, options.unit, options.target);
  // A fractional tail keeps its digits without adding .0 to whole-valued cells.
  if (!valueExample && numberFormat.spec.magnitude === 'none' && ordered.every(item => item.value < 1 || Number.isInteger(item.value))) {
    numberFormat.spec.wholeFrom = 1;
  }
  const fmt = numberFormat.fmt;
  const shareFmt = percentExample ? formatterFromExample(percentExample, locale) : shareSetFormatter(ordered.map(item => item.value / total * 100), locale).format;
  const valueText = (item: Item): string => {
    const share = shareFmt((item.value / total) * 100);
    return cellValue === 'share' ? share : cellValue === 'value-share' ? `${fmt(item.value)} (${share})` : fmt(item.value);
  };

  // ---- frame: the key lists the groups with their totals ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const legendItems: LegendItemInput[] = groups.map((g) => ({ id: g.id, label: g.label, paint: g.paint, value: fmt(g.total) }));
  const legendOptions = grouped && groups.length > 1 && options.legend !== 'none'
    ? normalizeLegendOption(options.legend === 'auto' ? undefined : options.legend, { position: 'top' })
    : undefined;
  // The complete list of the names too small to print, on the page: neither
  // notes.maxListed nor the registry's move of its own line to the description takes it off.
  const hiddenNote = hiddenNoteWith({ ...options, notes: { ...options.notes, maxListed: 'all' } }, []);
  const frame = solveFrame({
    size, margin, ...frameTextOptions(options), footnotes: hiddenNote.line.length === 0 ? authoredNotes(options) : [...hiddenNote.footnotes, ...hiddenNote.line], theme, measure,
    ...(legendOptions ? { legend: { options: legendOptions, items: legendItems } } : {}),
  }, occupied);
  fixedPlotChrome(frame);
  const plot = frame.plot;

  // ---- fonts ----
  const nameFont: FontSpec = { family: theme.type.family, ...theme.type.label, ...(shape === 'rect' && fitPx ? { size: fitPx } : {}) };
  const valueFont: FontSpec = { ...nameFont, weight: emphasisWeight(theme) };
  const lineH = measure('0', nameFont).height;
  // The leader columns of a circle: their own tier, which the fit step can set a step smaller.
  // The columns set their lines at LEADER_LINE_HEIGHT, and a cell holds its name at the stepped size before
  // the name goes out to a column.
  const outFont: FontSpec = shape === 'circle'
    ? { ...nameFont, ...(fitPx ? { size: fitPx } : {}), lineHeight: LEADER_LINE_HEIGHT } : nameFont;
  const outValueFont: FontSpec = { ...outFont, weight: valueFont.weight };
  const outLineH = measure('0', outFont).height;
  const cellStepFont: FontSpec | undefined = shape === 'circle' && fitPx ? { ...nameFont, size: fitPx } : undefined;
  const cellStepValueFont: FontSpec | undefined = cellStepFont ? { ...cellStepFont, weight: valueFont.weight } : undefined;
  const cellStepLineH = cellStepFont ? measure('0', cellStepFont).height : lineH;
  const textW = (lines: string[], font: FontSpec): number => Math.max(0, ...lines.map((line) => measure(line, font).width));

  // ---- total callout, beside the final circle or below the rectangles ----
  const totalText = options.total === undefined || options.total === false ? undefined
    : options.total === true ? withUnit(fmt(total), options.unit) : options.total.replace(/\{value\}/g, fmt(total));
  const figure = figureRole(theme);
  const totalFont: FontSpec = { family: figure.family, size: theme.type.title.size, weight: figure.weight, lineHeight: 1.2 };
  const totalH = totalText ? measure(totalText, totalFont).height : 0;
  const totalW = totalText ? measure(totalText, totalFont).width : 0;
  const totalCorner = (c: Pt, r: number): Rect => {
    const dy = Math.max(0, r - totalH);
    return {
      x: c.x + Math.sqrt((r + 8) ** 2 - dy ** 2), y: c.y + r - totalH,
      w: totalW, h: totalH,
    };
  };
  const totalFitsBesideCircle = (c: Pt, r: number): boolean => totalCorner(c, r).x + totalW <= plot.x + plot.w;
  // A circle with a key prints its total at the right end of the key's last row, in key type:
  // "Total ~$18 billion" with the value in bold. Without room there it takes its own row above the circle.
  const keyNodes = frame.nodes.flatMap((node) => (node.t === 'text' && (node.part === 'legendLabel' || node.part === 'legendValue') ? [node] : []));
  const keyTotal = ((): { node: SceneNode; reserve: number } | undefined => {
    if (shape !== 'circle' || !totalText || keyNodes.length === 0) return undefined;
    const rowY = maxOf(keyNodes.map((node) => node.y));
    const row = keyNodes.filter((node) => Math.abs(node.y - rowY) < 0.5);
    const template = row.find((node) => node.part === 'legendLabel') ?? row[0]!;
    const font = template.font;
    const bold = { ...font, weight: emphasisWeight(theme) };
    const lead = `${chartString(options, 'total')} `;
    const w = measure(lead, font).width + measure(totalText, bold).width;
    const h = measure('0', font).height;
    const right = plot.x + plot.w;
    const onRow = right - maxOf(row.map((node) => node.x + measure(node.lines.join(' '), node.font).width)) >= w + 16;
    const text = `${lead}${totalText}`;
    // The key claims its whole row, so the total is drawn here rather than seated by the label solver.
    if (!onRow) occupied.claim({ x: right - w, y: plot.y, w, h }, 'legend', {});
    return {
      node: {
        ...template, id: 'label:total:all', x: right, y: onRow ? rowY : plot.y, lines: [text], runs: [{ text: lead }, { text: totalText, weight: bold.weight }],
        // A total is a number: it keeps the ink while the key names beside it are muted.
        align: 'end', ink: { token: 'ink' }, owner: {}, part: 'grandTotal', typeRole: 'label', role: composedTextRole(text),
      },
      reserve: onRow ? 0 : h + 8,
    };
  })();
  const reserveTop = keyTotal?.reserve ?? 0;

  // ---- geometry: unit Voronoi once (it scales), rectangles per region ----
  const unit = shape === 'circle' ? (() => {
    // The unit Voronoi depends on the data and the order only; the sizing passes reuse it.
    const key = `unit|${byValue}`;
    const memo = searchMemo(data);
    const known = memo.get(key) as ReturnType<typeof circleUnitCells> | undefined;
    if (known) return known;
    const made = circleUnitCells(groups, total, byValue);
    memo.set(key, made);
    return made;
  })() : undefined;
  // A rectangle layout returns the text plan it measured its cells with (`plan`), so callers need not plan again.
  const cellsIn = (region: Rect): { cells: Polygon[]; groupPolys: Polygon[]; c?: Pt; r?: number; plan?: CellText[] } => {
    if (unit) {
      const r = Math.max(1, Math.min(region.w, region.h) / 2);
      const c = { x: region.x + region.w / 2, y: region.y + region.h / 2 };
      const map = (poly: Polygon): Polygon => poly.map((p) => ({ x: c.x + r * p.x, y: c.y + r * p.y }));
      return { cells: unit.cells.map(map), groupPolys: unit.groups.map(map), c, r };
    }
    const rects = (nearSquare: number) => {
      const groupRects = squarify(groups.map((g) => g.total), region, nearSquare);
      const cells = groups.flatMap((g, gi) => squarify(g.items.map((i) => i.value), groupRects[gi]!, nearSquare).map(rectPoly));
      return { cells, groupPolys: groupRects.map(rectPoly) };
    };
    // A near-square rectangle can lay its last row either way. When the usual
    // way leaves a name to the note that the other way prints, the other way
    // stands (a 1 px wider plot turned Gaming 290 into a strip too thin for it).
    const usual = rects(0);
    const usualPlan = planText(usual.cells);
    const before = usualPlan.filter((t) => t.noted).length;
    if (before === 0) return { ...usual, plan: usualPlan };
    const other = rects(NEAR_SQUARE);
    const otherPlan = planText(other.cells);
    return otherPlan.filter((t) => t.noted).length < before ? { ...other, plan: otherPlan } : { ...usual, plan: usualPlan };
  };

  // ---- text plan of every cell inside a region ----
  // A pair already named in the list stays there on the next measured pass.
  const notedNames = (options as { [NOTED_LABELS]?: ReadonlySet<Id> })[NOTED_LABELS];
  // An outside name wraps at spaces to a column a fifth of the plot wide, never with an ellipsis.
  // The column is never narrower than the longest word of any name, which it holds anyway.
  const longestWord = Math.max(0, maxOf(ordered.flatMap((item) => item.label.split(/\s+/).map((word) => measure(word, outFont).width))));
  const columnW = Math.max(56, Math.min(150, Math.max(plot.w * 0.2, longestWord)));
  const columnLines = (label: string): string[] => {
    const wrapped = wrapText(label, outFont, columnW, 4, measure);
    if (!wrapped.truncated) return wrapped.lines;
    const widest = Math.max(...label.split(/\s+/).map((word) => measure(word, outFont).width));
    return wrapText(label, outFont, Math.max(columnW, widest), 8, measure).lines;
  };
  const flatSide = { left: false, right: false };
  const planText = (cells: Polygon[], c?: Pt): CellText[] => ordered.map((item, k) => {
    const poly = cells[k]!;
    const value = valueText(item);
    const valueW = measure(value, valueFont).width;
    const at = polygonCentroid(poly);
    const span = chordAt(poly, at.y) - 2 * CELL_PAD;
    const seat = (w: number, h: number): Pt | undefined => seatIn(poly, at, w, h);
    const owed = notedNames?.has(`name:${item.id}`) === true || shape === 'rect' && notedNames?.has(`item:${item.id}`) === true;
    // A narrower wrap suits a tall or pointed cell: try the full chord, then narrower steps.
    // A circle cell then tries the stepped size before its name goes out to a column.
    for (const [font, fontLineH, fontValueW, stepped] of [[nameFont, lineH, valueW, false], ...(cellStepFont ? [[cellStepFont, cellStepLineH, measure(value, cellStepValueFont!).width, true]] : [])] as [FontSpec, number, number, boolean][]) {
      for (const share of owed ? [] : [1, 0.85, 0.7, 0.6, 0.5, 0.4]) {
        if (span <= 0) continue;
        const wrapped = wrapText(item.label, font, span * share, 3, measure);
        // Rectangles allow one marked word break before the complete pair goes to the note.
        if (wrapped.truncated && shape === 'circle') continue;
        const lines = wrapped.truncated ? wrapCellName(item.label, font, span * share, measure) : wrapped.lines;
        if (!lines || textW(lines, font) > span * share) continue;
        const w = Math.max(textW(lines, font), fontValueW);
        const h = fontLineH * (lines.length + 1);
        const p = seat(w, h);
        if (p) return { inside: { nameLines: lines, value: true, w, h, at: p, ...(stepped ? { stepped: true as const } : {}) } };
      }
    }
    const lineW = measure(`${item.label} `, nameFont).width + valueW;
    const lineAt = owed ? undefined : seat(lineW, lineH);
    if (lineAt) return { inside: { nameLines: [item.label], value: true, w: lineW, h: lineH, at: lineAt, oneLine: true } };
    // A circle cell too small for its pair names it on a leader, name and value together;
    // a sliver under half a percent goes to the note, so the columns stay short.
    if (shape === 'rect' || !c || item.value / total < CIRCLE_NOTE_SHARE) return { noted: true };
    const side: 'left' | 'right' = at.x < c.x ? 'left' : 'right';
    const outValueW = measure(value, outValueFont).width;
    if (flatSide[side]) return { outside: { nameLines: [item.label], side, anchor: at, w: measure(`${item.label} `, outFont).width + outValueW, h: outLineH, oneLine: true } };
    const nameLines = columnLines(item.label);
    return { outside: { nameLines, side, anchor: at, w: Math.max(textW(nameLines, outFont), outValueW), h: outLineH * (nameLines.length + 1) } };
  });

  const need = (list: CellText[], side: 'left' | 'right'): number => {
    const w = Math.max(0, maxOf(list.flatMap((t) => (t.outside?.side === side ? [t.outside.w] : []))));
    return w > 0 ? w + LEADER_GAP : 0;
  };
  /** The outside column of a side as a stack: its height with two-line pairs. */
  const stackOf = (list: CellText[], side: 'left' | 'right'): number =>
    list.flatMap((t) => (t.outside?.side === side ? [t.outside] : [])).reduce((sum, out) => sum + out.h + 4, -4);
  // An unpinned chart takes the plot its content wants:
  // the circle or the rectangles about CONTENT_BASE + width / 3 tall, the circle no wider
  // than its leader columns leave, and the columns' two-line pairs in full.
  const automatic = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && panelTypeClass(options) === undefined;
  const contentSide = Math.round(CONTENT_BASE + size.width / 3);
  let wantPlotH = 0;
  // Fit searches live within this request. The unit geometry alone can outlive it.
  const memoBase = [round2(plot.w), round2(reserveTop), nameFont.family, nameFont.size, valueFont.weight, valueFont.size, outFont.size, [...(notedNames ?? [])].sort().join(','),
    options.cellValue ?? '', options.format ?? '', options.unit ?? '', locale ?? ''].join('|');
  // Unpinned, the canvas grows to the columns' height, so the width floor counts their narrow form.
  let wideGutter: { left: number; right: number } | undefined;

  let gutter = { left: 0, right: 0 };
  let region: Rect = plot;
  let laid: ReturnType<typeof cellsIn> = { cells: [], groupPolys: [] };
  let texts: CellText[] = [];
  if (shape === 'circle') {
    // The largest circle whose leader columns fit beside it: a column that overflows the
    // height sets its pairs on one line, which widens it, so each size is tried in full.
    const room = (h: number): number => Math.max(20, h - reserveTop);
    /**
     * A column too tall for its room first sets on one line each pair that is no wider
     * there than the column's widest two-line pair, which keeps the column as narrow.
     */
    const mixed = { left: false, right: false };
    const mix = (plan: CellText[]): CellText[] => plan.map((t, k) => {
      const out = t.outside;
      if (!out || out.oneLine || !mixed[out.side]) return t;
      const columnW = Math.max(0, maxOf(plan.flatMap((o) => (o.outside?.side === out.side && !o.outside.oneLine ? [o.outside.w] : []))));
      const item = ordered[k]!;
      const lineW = measure(`${item.label} `, outFont).width + measure(valueText(item), outValueFont).width;
      return lineW <= columnW ? { outside: { ...out, nameLines: [item.label], w: lineW, h: outLineH, oneLine: true } } : t;
    });
    const fit = (d: number, columnRoom: number) => {
      flatSide.left = flatSide.right = mixed.left = mixed.right = false;
      const probe: Rect = { x: plot.x, y: plot.y + reserveTop, w: d, h: d };
      const cellsAt = cellsIn(probe);
      let plan = planText(cellsAt.cells, cellsAt.c);
      for (const side of ['left', 'right'] as const) mixed[side] = stackOf(plan, side) > columnRoom;
      plan = mix(plan);
      let flattened = false;
      for (const side of ['left', 'right'] as const) {
        if (stackOf(plan, side) <= columnRoom) continue;
        flatSide[side] = flattened = true;
      }
      if (flattened) plan = mix(planText(cellsAt.cells, cellsAt.c));
      return { d, cellsAt, plan, gutter: { left: need(plan, 'left'), right: need(plan, 'right') }, flat: { ...flatSide }, mixed: { ...mixed } };
    };
    // Bisection to 2 px: a larger circle never needs narrower columns.
    const search = (dMax: number, columnRoom: number) => {
      const memoKey = `c|${memoBase}|${round2(dMax)}|${Number.isFinite(columnRoom) ? round2(columnRoom) : 'inf'}`;
      const known = memo.get(memoKey) as ReturnType<typeof fit> | undefined;
      if (known) return known;
      const found = searchOnce(dMax, columnRoom);
      memo.set(memoKey, found);
      return found;
    };
    const searchOnce = (dMax: number, columnRoom: number) => {
      const fits = (r: ReturnType<typeof fit>): boolean => r.d + r.gutter.left + r.gutter.right <= plot.w;
      const top = fit(Math.max(20, dMax), columnRoom);
      if (fits(top) || top.d <= 20) return top;
      let lo = fit(20, columnRoom);
      if (!fits(lo)) return lo;
      let hi = top.d;
      while (hi - lo.d > 2) {
        const mid = fit(Math.floor((lo.d + hi) / 2), columnRoom);
        if (fits(mid)) lo = mid; else hi = mid.d;
      }
      return lo;
    };
    let wide: ReturnType<typeof search> | undefined;
    if (automatic) {
      // The circle the width allows, up to the content side; the plot grows to hold it and its columns.
      wide = search(Math.min(plot.w, contentSide), Number.POSITIVE_INFINITY);
      const stacks = Math.max(stackOf(wide.plan, 'left'), stackOf(wide.plan, 'right'), 0);
      wantPlotH = reserveTop + Math.max(wide.d, stacks) + (totalText && !keyTotal ? totalH + 8 : 0);
      wideGutter = wide.gutter;
    }
    // Centre the circle, then let the columns hug it on either side.
    let h = plot.h;
    if (totalText && !keyTotal && !totalFitsBesideCircle({ x: plot.x + plot.w / 2, y: plot.y + h / 2 }, Math.min(plot.w, h) / 2)) h = Math.max(20, h - totalH - 8);
    h = room(h);
    // Once the canvas holds the circle the width allows and its columns, that circle stands.
    // A canvas that is about to grow to it (the plot floor above) takes it at once.
    const best = wide && (wantPlotH > plot.h || wide.d <= h && Math.max(stackOf(wide.plan, 'left'), stackOf(wide.plan, 'right')) <= plot.h - reserveTop)
      ? wide : search(Math.min(plot.w, h), plot.h - reserveTop);
    flatSide.left = best.flat.left;
    flatSide.right = best.flat.right;
    mixed.left = best.mixed.left;
    mixed.right = best.mixed.right;
    gutter = best.gutter;
    const d = best.d;
    const free = plot.w - d - gutter.left - gutter.right;
    region = { x: plot.x + gutter.left + Math.max(0, free) / 2, y: plot.y + reserveTop + (h - d) / 2, w: d, h: d };
    laid = cellsIn(region);
    // The plan of the chosen size, moved from its probe to the final circle (cells only translate).
    const dx = laid.c!.x - best.cellsAt.c!.x;
    const dy = laid.c!.y - best.cellsAt.c!.y;
    texts = best.plan.map((t) => ({
      ...t,
      ...(t.inside ? { inside: { ...t.inside, at: { x: t.inside.at.x + dx, y: t.inside.at.y + dy } } } : {}),
      ...(t.outside ? { outside: { ...t.outside, anchor: { x: t.outside.anchor.x + dx, y: t.outside.anchor.y + dy } } } : {}),
    }));
  } else if (automatic) {
    // The lowest plot, from the content side up to RECT_GROW_MAX times it, that names the most
    // cells of at least NAMED_SHARE of the total; smaller cells may go to the note.
    const notedAt = (h: number): number => {
      const memoKey = `r|${memoBase}|${h}`;
      const known = memo.get(memoKey) as number | undefined;
      if (known !== undefined) return known;
      const n = cellsIn({ x: plot.x, y: plot.y, w: plot.w, h }).plan!
        .filter((t, k) => t.noted && ordered[k]!.value / total >= NAMED_SHARE).length;
      memo.set(memoKey, n);
      return n;
    };
    // Bisection to 4 px for the lowest plot that names as many as the tallest one.
    let bestH = contentSide;
    if (notedAt(bestH) > 0) {
      let hi = Math.ceil(contentSide * RECT_GROW_MAX);
      const fewest = notedAt(hi);
      let lo = contentSide;
      while (hi - lo > 4) {
        const mid = Math.round((lo + hi) / 2);
        if (notedAt(mid) <= fewest) hi = mid; else lo = mid;
      }
      bestH = hi;
    }
    wantPlotH = bestH + (totalText ? totalH + 8 : 0);
  }
  if (wantPlotH > plot.h) {
    frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0, Math.ceil(size.height + (frame.deficit ?? 0) + wantPlotH - plot.h));
  }
  // Rectangles name a cell inside or in the note, never outside: one layout under the total's row.
  if (shape === 'rect') {
    region = { x: plot.x, y: plot.y, w: plot.w, h: Math.max(20, plot.h - (totalText ? totalH + 8 : 0)) };
    laid = cellsIn(region);
    texts = laid.plan!;
  }
  const { cells, groupPolys } = laid;

  // ---- area check: drawn against target ----
  const regionArea = cells.reduce((sum, poly) => sum + polygonArea(poly), 0);
  const itemsDerived: TreemapItemDerived[] = ordered.map((item, k) => {
    const target = (item.value / total) * regionArea;
    const drawn = polygonArea(cells[k]!);
    return {
      id: item.id, ...(item.group !== undefined ? { group: item.group } : {}), label: item.label, value: item.value,
      share: round6((item.value / total) * 100), areaError: target > 0 ? round6(drawn / target - 1) : 0,
    };
  });
  const maxAreaError = Math.max(0, maxOf(itemsDerived.map((i) => Math.abs(i.areaError))));
  if (maxAreaError > TREEMAP_AREA_ERROR_LIMIT) {
    const worst = itemsDerived.reduce((a, b) => (Math.abs(b.areaError) > Math.abs(a.areaError) ? b : a));
    warnings.push({
      code: 'treemap-area-error', severity: 'warn',
      message: `cell '${worst.label}' is ${Math.round(Math.abs(worst.areaError) * 1000) / 10}% off its value in area, over the ${TREEMAP_AREA_ERROR_LIMIT * 100}% limit of the circle layout`,
      owner: { categoryId: worst.id }, suggest: "use variant: 'rect' for exact areas; the printed values stay exact",
    });
  }

  // ---- marks: item cells, then group borders over them ----
  const nodes: SceneNode[] = [...frame.nodes];
  const marks: TreemapMarks = { cells: [], groups: [] };
  const ownerOf = (item: Item) => ({ ...(item.group !== undefined ? { seriesId: item.group } : {}), categoryId: item.id });
  const groupOf = new Map(ordered.map((item) => [item.id, groups.find((g) => g.items.includes(item))!] as const));
  ordered.forEach((item, k) => {
    const nodeId = `mark:cell:${item.id}`;
    nodes.push({
      t: 'path', id: nodeId, d: pathOf(cells[k]!), fill: groupOf.get(item.id)!.paint,
      stroke: { token: 'background' }, width: strokeToken(theme, 'hair'), owner: ownerOf(item), part: 'treemapCell',
      display: { value: valueText(item) },
    });
    marks.cells.push({ id: item.id, ...(item.group !== undefined ? { group: item.group } : {}), nodeId });
  });
  groups.forEach((g, gi) => {
    if (!grouped || groups.length < 2) {
      marks.groups.push({ id: g.id });
      return;
    }
    const nodeId = `mark:group:${g.id}`;
    // A 2 px group outline over 0.75 px cell borders: the group regions read before the cells.
    nodes.push({ t: 'path', id: nodeId, d: pathOf(groupPolys[gi]!), stroke: { token: 'background' }, width: strokeToken(theme, 'data'), owner: { seriesId: g.id }, part: 'treemapGroup' });
    marks.groups.push({ id: g.id, nodeId });
  });

  // ---- outside columns: spread per side, leaders from the cell ----
  const requests: LabelRequest[] = [];
  const valueLines = new Map<Id, number>();
  const oneLine = new Map<Id, { text: string; weight?: number }[]>();
  // The column labels a fit step set smaller than the cells' labels.
  const outIds = new Set<Id>();
  // The cell labels a fit step set at the stepped size.
  const steppedIds = new Set<Id>();
  // A leader runs level from a dot in its cell to an elbow just outside the circle, then a short
  // leg to its label. Each column is in the order of its anchors, so no two leaders cross.
  const leaders = new Map<Id, { from: Pt; via: Pt; side: 'left' | 'right'; fill: Paint }>();
  const columnX = { left: region.x - LEADER_GAP, right: region.x + region.w + LEADER_GAP };
  // A level run must not cross a name printed in another cell or run along another leader: from the
  // centroid, step up and down the cell to the first height whose run to the elbow is clear.
  const printed = texts.flatMap((t) => (t.inside ? [{ x: t.inside.at.x - t.inside.w / 2 - 4, y: t.inside.at.y - t.inside.h / 2 - 5, w: t.inside.w + 8, h: t.inside.h + 10 }] : []));
  const clear = (y: number, x0: number, x1: number): boolean => !printed.some((r) => y >= r.y && y <= r.y + r.h && Math.max(x0, x1) >= r.x && Math.min(x0, x1) <= r.x + r.w);
  texts.forEach((t, k) => {
    const out = t.outside;
    if (!out) return;
    const elbow = out.side === 'left' ? region.x - ELBOW_OUT : region.x + region.w + ELBOW_OUT;
    const run = (): void => { printed.push({ x: Math.min(out.anchor.x, elbow), y: out.anchor.y - 6, w: Math.abs(elbow - out.anchor.x), h: 12 }); };
    if (clear(out.anchor.y, out.anchor.x, elbow)) return run();
    const poly = cells[k]!;
    const ys = poly.map((p) => p.y);
    const [top, bottom] = [minOf(ys) + CELL_PAD, maxOf(ys) - CELL_PAD];
    for (let step = 1; step * 2 <= bottom - top; step++) {
      for (const y of [out.anchor.y - step * 2, out.anchor.y + step * 2]) {
        if (y < top || y > bottom) continue;
        const [xl, xr] = chordRange(poly, y);
        const x = (xl + xr) / 2;
        if (!clear(y, x, elbow)) continue;
        out.anchor = { x, y };
        return run();
      }
    }
    run();
  });
  for (const side of ['left', 'right'] as const) {
    const list = ordered.map((item, k) => ({ item, out: texts[k]!.outside })).filter((e) => e.out?.side === side)
      .sort((a, b) => a.out!.anchor.y - b.out!.anchor.y || a.item.index - b.item.index);
    if (list.length === 0) continue;
    const spread = spread1DResult(list.map((e) => ({ desired: e.out!.anchor.y, size: e.out!.h })), [plot.y + reserveTop, plot.y + plot.h], 4);
    warnSpreadOverflow(warnings, spread.fits, `the ${side} column of outside names exceeds the plot height; names stay bounded but overlap. A taller chart or fewer small items fixes it`);
    list.forEach((e, k) => {
      const out = e.out!;
      const x = side === 'left' ? columnX.left - out.w : columnX.right;
      const id = `item:${e.item.id}`;
      const lines = out.oneLine ? [`${e.item.label} ${valueText(e.item)}`] : [...out.nameLines, valueText(e.item)];
      if (out.oneLine) oneLine.set(id, [{ text: `${e.item.label} ` }, { text: valueText(e.item), weight: valueFont.weight }]);
      else valueLines.set(id, out.nameLines.length);
      if (outFont !== nameFont) outIds.add(id);
      const elbow = side === 'left' ? region.x - ELBOW_OUT : region.x + region.w + ELBOW_OUT;
      leaders.set(id, { from: out.anchor, via: { x: elbow, y: out.anchor.y }, side, fill: groupOf.get(e.item.id)!.paint });
      requests.push({
        id, kind: 'item', owner: ownerOf(e.item), text: lines.join(' '), lines, font: outFont, priority: PRIORITY.interior + round2(e.item.value / total * 100),
        candidates: [{ slot: 'outside', rect: { x, y: spread.positions[k]! - out.h / 2, w: out.w, h: out.h }, penalty: 0, outsidePlot: true, pad: 0 }],
      });
    });
  }

  // ---- names a rectangle cannot hold: owed to the note line, with the value ----
  ordered.forEach((item, k) => {
    if (!texts[k]!.noted) return;
    const text = `${item.label} ${valueText(item)}`;
    requests.push({
      id: `item:${item.id}`, kind: 'item', owner: ownerOf(item), text, lines: [text], font: nameFont,
      priority: PRIORITY.interior, redundant: true, suppressedAs: 'density', candidates: [],
    });
  });

  // ---- inside labels: name, then the value in bold, on the cell's own fill ----
  ordered.forEach((item, k) => {
    const inside = texts[k]!.inside;
    if (!inside) return;
    const fill = groupOf.get(item.id)!.paint;
    const lines = inside.oneLine ? [`${item.label} ${valueText(item)}`] : [...inside.nameLines, valueText(item)];
    const id = inside.nameLines.length > 0 ? `item:${item.id}` : `value:${item.id}`;
    if (inside.oneLine) oneLine.set(id, [{ text: `${item.label} ` }, { text: valueText(item), weight: valueFont.weight }]);
    else valueLines.set(id, inside.nameLines.length);
    if (inside.stepped) steppedIds.add(id);
    requests.push({
      id, kind: inside.nameLines.length > 0 ? 'item' : 'point', owner: ownerOf(item), text: `${item.label} ${valueText(item)}`, lines, font: inside.stepped ? cellStepFont! : nameFont,
      keepWhenDense: item.value / total >= 0.02 ? true : undefined,
      priority: PRIORITY.interior + round2(item.value / total * 100), align: 'middle',
      candidates: [{ slot: 'inside', rect: { x: inside.at.x - inside.w / 2, y: inside.at.y - inside.h / 2, w: inside.w, h: inside.h }, penalty: 0, pad: 0, insideFill: paintColor(theme, fill), insidePaint: fill }],
    });
  });

  // ---- total callout from the final mark bounds ----
  if (keyTotal) nodes.push(keyTotal.node);
  else if (totalText) {
    const rect = laid.c && laid.r
      ? totalFitsBesideCircle(laid.c, laid.r) ? totalCorner(laid.c, laid.r) : {
        x: Math.max(plot.x, Math.min(plot.x + plot.w - totalW, laid.c.x - totalW / 2)),
        y: laid.c.y + laid.r + 8, w: totalW, h: totalH,
      }
      : { x: plot.x + plot.w - totalW, y: plot.y + plot.h - totalH, w: totalW, h: totalH };
    requests.push({
      id: 'total:all', kind: 'grandTotal', owner: {}, text: totalText, lines: [totalText], font: totalFont, priority: PRIORITY.grandTotal,
      candidates: [{ slot: 'corner', rect, penalty: 0, outsidePlot: true }],
    });
  }

  // ---- solve, then leaders, alignment and the bold value line ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 2,
  });
  const solved = solveLabels(requests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);
  for (const label of solved.placed) {
    const leader = leaders.get(label.id);
    if (label.hidden || label.slot !== 'outside' || !leader) continue;
    const { from, via } = leader;
    const left = leader.side === 'left';
    const end = { x: left ? label.rect.x + label.rect.w + 3 : label.rect.x - 3, y: label.rect.y + label.rect.h / 2 };
    label.leader = { d: `M${round2(from.x)} ${round2(from.y)}L${round2(via.x)} ${round2(via.y)}L${round2(end.x)} ${round2(end.y)}`, curved: false };
  }
  const labelNodes = labelsToNodes(theme, solved.placed, (label) => (label.kind === 'grandTotal' ? totalFont : outIds.has(label.id) ? outFont : steppedIds.has(label.id) ? cellStepFont! : nameFont)).flatMap((node): SceneNode[] => {
    if (node.t !== 'text' || !node.id.startsWith('label:')) return [node];
    const id = node.id.slice('label:'.length);
    const label = solved.placed.find((l) => l.id === id)!;
    // The left column is set flush against the circle, the right column flush from it.
    const toCircle = label.slot === 'outside' && leaders.get(id)?.side === 'left';
    const x = label.align === 'middle' ? label.rect.x + label.rect.w / 2 : toCircle ? label.rect.x + label.rect.w : label.rect.x;
    const align = label.align === 'middle' ? 'middle' : toCircle ? 'end' : 'start';
    const head = valueLines.get(id);
    if (label.kind === 'grandTotal') return [{ ...node, x: label.rect.x + label.rect.w, align: 'end', typeRole: 'label', role: composedTextRole(label.text) }];
    const runs = oneLine.get(id);
    if (runs) return [{ ...node, x, align, runs }];
    if (head === undefined) return [{ ...node, x, align }];
    const out = outIds.has(id);
    const stepped = steppedIds.has(id);
    const valueNode: SceneNode = {
      ...node, id: `${node.id}:body`, x, align, y: label.rect.y + head * (out ? outLineH : stepped ? cellStepLineH : lineH), lines: [label.lines[head]!], font: out ? outValueFont : stepped ? cellStepValueFont! : valueFont, role: 'value',
    };
    if (head === 0) return [{ ...valueNode, id: node.id, y: node.y }];
    return [{ ...node, x, align, y: label.rect.y, lines: label.lines.slice(0, head), role: 'category' }, valueNode];
  });
  pushAll(nodes, labelNodes);
  for (const label of solved.placed) {
    const leader = leaders.get(label.id);
    if (label.hidden || label.slot !== 'outside' || !leader) continue;
    nodes.push({
      t: 'circle', id: `leader:${label.id}:dot`, cx: round2(leader.from.x), cy: round2(leader.from.y), r: LEADER_DOT_R,
      fill: contrastInkPaint(leader.fill), owner: label.owner, part: 'leaderDot',
    });
  }
  // Supply the chart's group/item order and the final complete omission text to the shared list.
  const order = new Map(ordered.map((item, index) => [item.id, index]));
  solved.placed.sort((a, b) => (order.get(a.owner.categoryId ?? '') ?? ordered.length) - (order.get(b.owner.categoryId ?? '') ?? ordered.length));
  for (const label of solved.placed) {
    if ((!label.hidden && !hiddenNote.ids.has(label.id)) || !label.owner.categoryId) continue;
    const item = ordered.find(item => item.id === label.owner.categoryId)!;
    const valueDrawn = solved.placed.some(other => other.id === `value:${item.id}` && !other.hidden);
    label.noteText = label.kind === 'item' && valueDrawn ? item.label : `${item.label} ${valueText(item)}`;
  }
  marks.cells.forEach((mark) => {
    mark.labelNodeId = solved.placed.find((l) => l.owner.categoryId === mark.id && !l.hidden)?.nodeId;
  });

  // ---- derived, a11y, sizing ----
  const groupsDerived: TreemapGroupDerived[] = groups.map((g) => ({ id: g.id, label: g.label, total: round6(g.total), share: round6((g.total / total) * 100) }));
  const unitIterations = unit?.iterations;
  const nGroups = grouped ? groups.length : 0;
  const desc = chartString(options, 'treemapDesc', { v1: shape === 'circle' ? chartString(options, 'circular') : chartString(options, 'rectangular'), v2: ordered.length, v3: nGroups > 0 ? chartString(options, 'groupsClause', { v1: nGroups }) : '', v4: fmt(total) }) +
    (nGroups > 0
      ? groups.map((g) => `${g.label} ${fmt(g.total)} (${shareFmt((g.total / total) * 100)}): ${g.items.map((i) => `${i.label} ${fmt(i.value)}`).join(', ')}.`).join(' ')
      : `${ordered.map((i) => `${i.label} ${fmt(i.value)}`).join(', ')}.`);
  // A circle between two leader columns still reads at 96 px (the 320 px card at 13 px type); rectangles need 160.
  const minSide = shape === 'circle' ? 88 : atHardMinimum(options) ? HARD_COMPACT_PLOT : 160;
  const geometry: Geometry<TreemapMarks, TreemapDerived> = {
    type: 'treemap', size,
    sizing: resolveSizing({ ...chartSizing('treemap'), compactFloor: undefined, minWidth: 0, minHeight: 0 }, size, {
      minWidth: size.width - plot.w + Math.min(gutter.left + gutter.right, wideGutter ? wideGutter.left + wideGutter.right : Number.POSITIVE_INFINITY) + minSide,
      minHeight: size.height - plot.h + minSide,
    }),
    plot, scene: nodes, labels: solved.placed, axes: [], annotations: [], legend: frame.legend, frame: frame.frame, marks,
    derived: {
      variant: shape, total: round6(total), groups: groupsDerived, items: itemsDerived, maxAreaError: round6(maxAreaError),
      ...(unitIterations ? { iterations: unitIterations } : {}),
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'treemapTitle', { v1: ordered.length, v2: fmt(total) })),
      counts: [structureCount('cells', ordered.length, undefined, options), ...(nGroups > 0 ? [structureCount('groups', nGroups, undefined, options)] : [])],
      desc,
    },
    warnings, debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
  markNotedLabels(geometry, hiddenNote.ids, { strings: options.strings });
  FIT_SCORE.set(geometry, {
    hidden: solved.placed.filter((l) => l.hidden && l.kind !== 'grandTotal').length,
    broken: texts.filter((t) => t.inside?.nameLines.some((line) => line.endsWith('-'))).length,
    side: shape === 'circle' ? region.w : 0, wanted: shape === 'circle' ? Math.min(plot.w, contentSide) : 0, base: theme.type.label.size,
  });
  return geometry;
}

const SEARCH_MEMO = new WeakMap<object, Map<string, unknown>>();
/**
 * Fit searches use the active request scope. Unit geometry uses the data object,
 * since it depends only on the data and order, not on the request's size or text.
 */
function searchMemo(owner: object): Map<string, unknown> {
  let memo = SEARCH_MEMO.get(owner);
  if (!memo) SEARCH_MEMO.set(owner, memo = new Map());
  return memo;
}

/** Keep space breaks first; allow one hyphenated word with at least three letters on each side. */
function wrapCellName(text: string, font: FontSpec, width: number, measure: TextMeasurer): string[] | undefined {
  const words = text.split(/\s+/).filter(Boolean);
  let broken = false;
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi]!;
    if (measure(word, font).width <= width) continue;
    if (broken || !/^\p{L}[\p{L}\p{M}]*$/u.test(word)) return undefined;
    const chars = graphemes(word);
    let split = 0;
    for (let i = chars.length - 3; i >= 3; i--) {
      if (measure(`${chars.slice(0, i).join('')}-`, font).width <= width
        && measure(chars.slice(i).join(''), font).width <= width) {
        split = i;
        break;
      }
    }
    if (!split) return undefined;
    words[wi] = `${chars.slice(0, split).join('')}-\n${chars.slice(split).join('')}`;
    broken = true;
  }
  const wrapped = wrapText(words.join(' '), font, width, 3, measure);
  return wrapped.truncated ? undefined : wrapped.lines;
}

/**
 * The Voronoi layout in the unit circle: group regions clockwise from 12
 * o'clock, then the items inside each region. Sorted, the largest item of a
 * group faces the circle centre and the next ones alternate to either side,
 * so the smallest items sit at the rim, next to their outside names.
 */
function circleUnitCells(groups: Group[], total: number, byValue: boolean): { cells: Polygon[]; groups: Polygon[]; iterations: { groups: number; items: number } } {
  const circle = circlePolygon(0, 0, 1);
  const shares = groups.map((g) => g.total / total);
  const top = voronoiTreemap(circle, shares, seedSites(circle, shares));
  let itemIterations = 0;
  const cells = groups.flatMap((g, gi) => {
    const region = top.cells[gi]!;
    const own = g.items.map((i) => i.value / g.total);
    let seeds = seedSites(region, own);
    if (byValue && own.length > 2) {
      // Around the circle: … 4 2 0 1 3 …, with item 0 centred on the direction to the circle centre.
      const order = [...own.keys()].sort((a, b) => (a % 2 === 0 ? -a : a) - (b % 2 === 0 ? -b : b));
      const c = polygonCentroid(region);
      const inward = Math.atan2(-c.x, c.y);
      const before = order.slice(0, order.indexOf(0)).reduce((sum, i) => sum + own[i]!, 0) + own[0]! / 2;
      const placed = seedSites(region, order.map((i) => own[i]!), inward - before * 2 * Math.PI);
      seeds = own.map((_, i) => placed[order.indexOf(i)]!);
    }
    const level = voronoiTreemap(region, own, seeds);
    itemIterations = Math.max(itemIterations, level.iterations);
    return level.cells;
  });
  return { cells, groups: top.cells, iterations: { groups: top.iterations, items: itemIterations } };
}

function rectPoly(r: Rect): Polygon {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}

function pathOf(poly: Polygon): string {
  if (poly.length < 3) return '';
  return `M${poly.map((p) => `${round2(p.x)} ${round2(p.y)}`).join('L')}Z`;
}

/**
 * The centre nearest the centroid at which a w × h box lies inside a convex
 * cell, CELL_PAD from its edges: the centroid first, then a 9 × 9 grid over
 * the middle 64% of the cell's bounding box, nearest first.
 */
/** A convex cell's inward edge lines (unit normal and offset) and its box, once per cell: seatIn tests many boxes in it. */
interface PreparedCell { edges: number[]; x0: number; x1: number; y0: number; y1: number }
const PREPARED = new WeakMap<Polygon, PreparedCell>();
function prepared(poly: Polygon): PreparedCell {
  const known = PREPARED.get(poly);
  if (known) return known;
  let signed = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    signed += a.x * b.y - b.x * a.y;
  }
  const sign = signed >= 0 ? 1 : -1;
  const edges: number[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    // Clipping leaves near-duplicate vertices; their edges have no usable direction.
    if (len < 1e-6) continue;
    // Inside at margin m when nx * x + ny * y + c >= m.
    const nx = (-ey / len) * sign;
    const ny = (ex / len) * sign;
    edges.push(nx, ny, -(nx * a.x + ny * a.y));
  }
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const cell = { edges, x0: minOf(xs), x1: maxOf(xs), y0: minOf(ys), y1: maxOf(ys) };
  PREPARED.set(poly, cell);
  return cell;
}

function seatIn(poly: Polygon, at: Pt, w: number, h: number): Pt | undefined {
  const cell = prepared(poly);
  const bw = cell.x1 - cell.x0;
  const bh = cell.y1 - cell.y0;
  // A box wider or taller than the cell's own box less its pads seats nowhere.
  if (w > bw - 2 * CELL_PAD || h > bh - 2 * CELL_PAD) return undefined;
  const { edges } = cell;
  const inside = (x: number, y: number): boolean => {
    for (let i = 0; i < edges.length; i += 3) if (edges[i]! * x + edges[i + 1]! * y + edges[i + 2]! < CELL_PAD) return false;
    return true;
  };
  const fits = (c: Pt): boolean => inside(c.x - w / 2, c.y - h / 2) && inside(c.x + w / 2, c.y - h / 2)
    && inside(c.x + w / 2, c.y + h / 2) && inside(c.x - w / 2, c.y + h / 2);
  if (fits(at)) return at;
  const steps = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
  const seats = steps.flatMap((i) => steps.map((j) => ({ x: at.x + i * 0.08 * bw, y: at.y + j * 0.08 * bh, d: (i * bw) ** 2 + (j * bh) ** 2 })))
    .sort((p, q) => p.d - q.d);
  const hit = seats.find((c) => fits(c));
  return hit ? { x: hit.x, y: hit.y } : undefined;
}

/** Width of a convex polygon along the horizontal line at `y`. */
function chordAt(poly: Polygon, y: number): number {
  const [left, right] = chordRange(poly, y);
  return right - left;
}

/** Left and right ends of a convex polygon along the horizontal line at `y`; [0, 0] off the polygon. */
function chordRange(poly: Polygon, y: number): [number, number] {
  const xs: number[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    if ((a.y <= y && b.y >= y) || (a.y >= y && b.y <= y)) {
      xs.push(a.y === b.y ? a.x : a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      if (a.y === b.y) xs.push(b.x);
    }
  }
  return xs.length < 2 ? [0, 0] : [minOf(xs), maxOf(xs)];
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
