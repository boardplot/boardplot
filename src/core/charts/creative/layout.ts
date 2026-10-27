import { chartString } from '../../strings/creative';
import { canvasMargin, emphasisWeight } from '../../theme';
import type { Rect } from '../../geometry';
import { formatAutomaticPercent, valueSetFormatter } from '../../format';
import { formatDate } from '../../dateFormat';
import { parseISODate } from '../../isoDate';
import { nonzeroDecimals } from '../../formatPrecision';
import { frameTextOptions, solveFrame } from '../../frame';
import { assertEmbeddedImage } from '../../image';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, solveLabels, type LabelRequest } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize, resolveSubtitle } from '../../normalize/shared';
import { rowDrivenHeight } from '../../rowCanvas';
import { resolveSizing } from '../../sizing';
import { defaultMeasurer, wrapText, type FontSpec, type TextMeasurer } from '../../text';
import {
  strokeToken,
  resolveTheme,
  themeForWidth,
  resolveSemanticPaletteTheme,
  semanticPalettePaint,
} from '../../theme';
import type { BaseOptions, RenderTarget } from '../../types/options';
import type { OwnerRef } from '../../types/cell';
import type { Geometry, SceneNode, LintWarning, PaintToken, TextRole, TypographyRole } from '../../types/scene';
import type { ChartSizing } from '../../types/sizing';
import type { Theme } from '../../types/theme';
import { emitSparklineMarks, plotSparkline, sparklineDomain, sparkStyle, type SparklineStyle } from '../sparkline/layout';
import { deriveCreativeFatigue, type CreativeFatigue } from './fatigue';
import type { CreativeData, CreativeOptions } from './types';
import { composedTextRole } from '../../textRole';
import { pushAll } from '../../arrays';
import { withUnit } from '../../unitJoin';

/**
 * Below 640 px the card stacks: a media thumbnail beside
 * the name and facts, then the table, the notes and the trends at full width.
 */
export const creativeSizing: ChartSizing = { aspect: 'content', minWidth: 320, minHeight: 270, fit: 'content' };
const STACKED_BELOW = 640;
export const creativeMetrics = [
  ['ctr', 'CTR', '%'], ['cpa', 'CPA', 'currency'], ['roas', 'ROAS', '×'],
  ['hookRate', 'Hook rate', '%'], ['holdRate', 'Hold rate', '%'], ['frequency', 'Frequency', '×'],
] as const;
/** Which way is better per metric: 1 higher, -1 lower, 0 neither (frequency is context, not a goal). */
const BETTER = { ctr: 1, cpa: -1, roas: 1, hookRate: 1, holdRate: 1, frequency: 0 } as const;
/** `deltas`: the printed "vs median" change per metric, for the claims. */
export interface CreativeDerived { fatigue: CreativeFatigue; deltas?: { key: string; value: number | null; accountMedian: number | null; pct: number | null; text: string }[] }
export interface CreativeMarks { media: Rect; metrics: Record<string, Rect> }


/**
 * A metric value with its unit. `peers` are the values it prints beside (the
 * creative's and the account median of one metric): one precision for the
 * pair, lifted so no nonzero value reads 0. A missing value reads n/a.
 */
function creativeValue(value: number | null, unit: string, peers: (number | null)[] = [value], target?: RenderTarget, options: CreativeOptions = {}): string {
  if (value === null) return chartString(options, 'notApplicable');
  if (unit === '%') return formatAutomaticPercent(value, nonzeroDecimals(value, 1), false, options.locale?.language);
  const number = valueSetFormatter(peers.filter((peer): peer is number => peer !== null), options.locale?.language, false, unit, target)(value);
  return withUnit(number, unit, false, options.locale?.language);
}

/** The creative's change against its account median, in whole percent, and whether that is better. */
function creativeDelta(key: keyof typeof BETTER, metric: { value: number | null; accountMedian: number | null }, options: CreativeOptions = {}) {
  const { value, accountMedian: median } = metric;
  if (value === null || median === null || !(median > 0)) return { pct: null, text: chartString(options, 'notApplicable'), tone: 'neutral' as const };
  const pct = 100 * (value - median) / median;
  const text = formatAutomaticPercent(pct, nonzeroDecimals(pct, 0), true, options.locale?.language);
  const tone = BETTER[key] === 0 || pct === 0 ? 'neutral' as const : Math.sign(pct) === BETTER[key] ? 'good' as const : 'bad' as const;
  return { pct, text, tone };
}

function isoDate(iso: string): Date {
  return parseISODate(iso) ?? new Date(Date.parse(iso));
}

/** One date in reader form: "1 Sep 2026". */
function readerDate(iso: string, options: CreativeOptions): string {
  return formatDate(isoDate(iso), chartString(options, 'datePatternFull'), options.locale?.language);
}

/** A date range printed once and short: "1–3 Sep 2026", "28 Aug – 3 Sep 2026". */
function readerSpan(from: string, to: string, options: CreativeOptions): string {
  if (from === to) return readerDate(from, options);
  const a = isoDate(from), b = isoDate(to), language = options.locale?.language;
  const end = readerDate(to, options);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${readerDate(from, options)} – ${end}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${formatDate(a, chartString(options, 'datePatternDayMonth'), language)} – ${end}`;
  return `${formatDate(a, chartString(options, 'datePatternDay'), language)}–${end}`;
}

interface TextSpec {
  font: FontSpec;
  owner?: OwnerRef;
  align?: 'start' | 'end' | 'middle';
  ink?: PaintToken;
  role?: TextRole;
  typeRole: TypographyRole;
}
interface Placed { h: number; w: number }

function textBuilder(requests: LabelRequest[], inks: Map<string, PaintToken>, measure: TextMeasurer) {
  return (id: string, text: string, box: { x: number; y: number; w: number }, spec: TextSpec): Placed => {
    const wrapped = wrapText(text, spec.font, box.w, 12, measure);
    if (wrapped.truncated) throw new NormalizeError('creative-text-overflow', id, 'Creative text does not fit; shorten it or increase the canvas width.');
    const h = wrapped.lines.length * spec.font.size * (spec.font.lineHeight ?? 1.2);
    const w = Math.min(box.w, Math.max(...wrapped.lines.map(line => measure(line, spec.font).width)) + 1);
    const x = spec.align === 'end' ? box.x + box.w - w : spec.align === 'middle' ? box.x + (box.w - w) / 2 : box.x;
    requests.push({ id, kind: 'item', owner: spec.owner ?? {}, text, lines: wrapped.lines, font: spec.font, priority: 700, typeRole: spec.typeRole,
      candidates: [{ slot: 'cell', rect: { x, y: box.y, w, h }, penalty: 0 }],
      ...(spec.align && spec.align !== 'start' ? { align: spec.align } : {}), ...(spec.role ? { role: spec.role } : {}) });
    if (spec.ink) inks.set(id, spec.ink);
    return { h, w };
  };
}
type AddText = ReturnType<typeof textBuilder>;

/** The card's type, from the theme's roles at this width and target: body values in the label size, context in the footnote size. */
function cardFonts(theme: Theme, wideTarget: boolean) {
  const family = theme.type.family;
  const label: FontSpec = { family, ...theme.type.label };
  const note: FontSpec = { family, ...theme.type.footnote };
  const strong = emphasisWeight(theme);
  // The wide card prints its facts and trend heads in the label size
  // (13 px at 720-960 px); the stacked card keeps one step less.
  const step = wideTarget ? label.size : Math.max(note.size, label.size - 1);
  return {
    row: label, note, strong,
    name: { ...label, size: label.size + 1, weight: strong },
    facts: { ...label, size: step },
    trendHead: { ...label, size: step, weight: strong },
    delta: { ...label, weight: strong },
    noteStrong: { ...note, weight: strong },
  };
}
type CardFonts = ReturnType<typeof cardFonts>;
const roleOf = (font: FontSpec, fonts: CardFonts): TypographyRole => (font.size === fonts.note.size ? 'footnote' : 'label');

function mediaBox(data: CreativeData, plot: Rect, stacked: boolean): Rect {
  const [aw, ah] = data.media.aspect.split(':').map(Number) as [number, number];
  if (stacked) {
    const scale = Math.min(64 / aw, 80 / ah);
    return { x: plot.x, y: plot.y, w: aw * scale, h: ah * scale };
  }
  // 170 px at a 720 canvas, 210 px at 960; a tall 9:16 creative stays under 300 px.
  const width = Math.max(120, Math.min(240, plot.w / 6 + 59.3));
  const height = Math.round(Math.min(300, width * ah / aw));
  return { x: plot.x, y: plot.y, w: height * aw / ah, h: height };
}

function mediaNodes(data: CreativeData, rect: Rect, nodes: SceneNode[], add: AddText, fonts: CardFonts, options: CreativeOptions): void {
  if (data.media.kind === 'placeholder') {
    nodes.push({ t: 'rect', id: 'creative:media', rect, fill: { token: 'grid' }, owner: { pointId: data.id }, part: 'media' });
    // Centred in the well, both ways: what is missing, then the authored aspect.
    const lineH = fonts.note.size * (fonts.note.lineHeight ?? 1.2);
    const top = rect.y + (rect.h - 2 * lineH - 2) / 2;
    const spec = { font: fonts.note, align: 'middle' as const, ink: 'inkMuted' as const, owner: { pointId: data.id }, typeRole: 'footnote' as const };
    add('creative:placeholder', chartString(options, 'noMedia'), { x: rect.x + 2, y: top, w: rect.w - 4 }, spec);
    add('creative:placeholder-aspect', `(${data.media.aspect})`, { x: rect.x + 2, y: top + lineH + 2, w: rect.w - 4 }, spec);
  } else {
    const src = data.media.kind === 'image' ? data.media.src : data.media.poster;
    assertEmbeddedImage(src);
    nodes.push({ t: 'image', id: 'creative:media', rect, src, alt: data.media.alt, owner: { pointId: data.id }, part: 'media' });
  }
}

/** The caption a real medium keeps (a video is drawn from its poster); a placeholder says it in the well. */
function mediaCaption(data: CreativeData, options: CreativeOptions): string | undefined {
  return data.media.kind === 'video' ? chartString(options, 'videoPreview') : data.media.kind === 'image' ? chartString(options, 'creativeImage') : undefined;
}

/** Air from a row's text box to its rule, and from the rule to the next row. */
const ROW_RULE_GAP = 3;

function metricRows(theme: Theme, data: CreativeData, box: { x: number; y: number; w: number }, add: AddText, nodes: SceneNode[], fonts: CardFonts, stacked: boolean, options: CreativeOptions, target?: RenderTarget): { end: number; marks: Record<string, Rect> } {
  const marks: Record<string, Rect> = {};
  const labelW = box.w * 0.3 - 4;
  // Right edges of the number columns: half way, three quarters (stacked) or 78 % (wide), the end.
  const valueRight = box.x + box.w * 0.5;
  const medianRight = box.x + box.w * (stacked ? 0.75 : 0.78);
  const deltaRight = box.x + box.w;
  const column = (left: number, right: number) => ({ x: left, w: right - left });
  const valueCol = column(box.x + box.w * 0.3, valueRight);
  const medianCol = column(valueRight + 8, medianRight);
  const deltaCol = column(medianRight + 8, deltaRight);
  const head = { font: fonts.note, ink: 'inkMuted' as const, typeRole: 'footnote' as const };
  const headH = Math.max(
    add('creative:metric-heading', chartString(options, 'metric'), { ...box, w: labelW }, head).h,
    add('creative:value-heading', chartString(options, 'creativeColumn'), { ...valueCol, y: box.y }, { ...head, align: 'end' }).h,
    add('creative:median-heading', chartString(options, 'accountMedianColumn'), { ...column(valueRight + 10, medianRight), y: box.y }, { ...head, align: 'end' }).h,
    add('creative:delta-heading', chartString(options, 'vsMedianColumn'), { ...column(medianRight + 10, deltaRight), y: box.y }, { ...head, align: 'end' }).h,
  );
  const ruleY = box.y + headH + 2;
  nodes.push({ t: 'line', id: 'creative:header-rule', x1: box.x, x2: box.x + box.w, y1: ruleY, y2: ruleY, stroke: { token: 'inkMuted' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'rowRule' });
  const basePitch = Math.round(fonts.row.size * (stacked ? 1.7 : 1.86));
  let y = ruleY + (stacked ? 4 : 6);
  let end = y;
  for (const [key, label, suffix] of creativeMetrics) {
    const unit = suffix === 'currency' ? data.facts.currency : suffix;
    const owner = { seriesId: key, categoryId: data.id };
    const metric = data.metrics[key];
    const pair = [metric.value, metric.accountMedian];
    const value = creativeValue(metric.value, unit, pair, target, options);
    const median = creativeValue(metric.accountMedian, unit, pair, target, options);
    const delta = creativeDelta(key, metric, options);
    const line: SceneNode = { t: 'line', id: `creative:row:${key}`, x1: box.x, x2: box.x + box.w, y1: y, y2: y, stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), owner, part: 'metric', display: { value, state: metric.value === null ? 'missing' : 'value' } };
    nodes.push(line);
    const body = { font: fonts.row, owner, typeRole: 'label' as const };
    const name = key === 'frequency' ? chartString(options, 'creativeFrequency') : key === 'hookRate' ? chartString(options, 'creativeHookRate') : key === 'holdRate' ? chartString(options, 'creativeHoldRate') : label;
    const textH = Math.max(
      add(`creative:metric:${key}`, name, { ...box, y, w: labelW }, body).h,
      add(`creative:value:${key}`, value, { ...valueCol, y }, { ...body, align: 'end', role: composedTextRole(value) }).h,
      add(`creative:median:${key}`, median, { ...medianCol, y }, { ...body, align: 'end', ink: 'inkMuted', role: composedTextRole(median) }).h,
      add(`creative:delta:${key}`, delta.text, { ...deltaCol, y }, { ...body, font: delta.tone === 'neutral' ? fonts.row : fonts.delta, align: 'end',
        ink: delta.tone === 'good' ? 'good' : delta.tone === 'bad' ? 'bad' : 'inkMuted', role: composedTextRole(delta.text) }).h,
    );
    const pitch = Math.max(basePitch, Math.ceil(textH + 2 * ROW_RULE_GAP));
    line.y1 = line.y2 = y + textH + ROW_RULE_GAP;
    marks[key] = { x: box.x, y, w: box.w, h: textH + ROW_RULE_GAP };
    end = line.y1 + 1;
    y += pitch;
  }
  return { end, marks };
}

/** The note under the table: the period both columns cover (once), the median basis and the colour key. */
function comparisonText(data: CreativeData, options: CreativeOptions): string {
  const { startDate, endDate, population } = data.comparison;
  const own = readerSpan(data.facts.launchDate, data.facts.endDate ?? data.facts.asOf, options);
  const medians = readerSpan(startDate, endDate, options);
  const period = own === medians ? chartString(options, 'bothColumns', { v1: own }) : chartString(options, 'splitColumns', { v1: own, v2: medians });
  const tones = creativeMetrics.map(([key]) => creativeDelta(key, data.metrics[key], options).tone);
  const cpaJudged = creativeDelta('cpa', data.metrics.cpa, options).tone !== 'neutral';
  let key = '';
  // The key says which deltas are coloured, never which colour: the
  // theme names no colour and a repaint may change it.
  const better = tones.includes('good');
  const worse = tones.includes('bad');
  if (better || worse) {
    key = chartString(options, better && worse ? 'keyBoth' : better ? 'keyBetter' : 'keyWorse');
    key += cpaJudged ? ` (${chartString(options, 'lowerCpaBetter')}).` : '.';
  }
  return [period, chartString(options, 'medianBasis', { v1: population.replace(/\.$/, '') }), key].filter(Boolean).join(' ');
}

/** The fatigue lines a reader needs. Without a rule that is one line; the author's instruction goes to the warnings. */
function fatigueText(fatigue: CreativeFatigue, options: CreativeOptions): string[] {
  const rule = fatigue.rule;
  if (!rule) return [chartString(options, 'fatigueNotAssessed')];
  const status = fatigue.status === 'flagged' ? chartString(options, 'fatigueRuleMet') : fatigue.status === 'clear' ? chartString(options, 'fatigueRuleNotMet') : chartString(options, 'fatigueUnavailable', { v1: chartString(options, ({ 'no-rule': 'fatigueNoRule', 'missing-data': 'fatigueMissingData', 'insufficient-data': 'fatigueInsufficientData', 'zero-baseline': 'fatigueZeroBaseline' } as const)[fatigue.reason!]) });
  return [status,
    chartString(options, 'fatigueWindows', { v1: rule.metric.toUpperCase(), v2: rule.baseline.startDate, v3: rule.baseline.endDate, v4: rule.current.startDate, v5: rule.current.endDate }),
    chartString(options, 'fatigueSample', { v1: fatigue.baseline.inputs.length, v2: fatigue.current.inputs.length, v3: rule.minObservations, v4: chartString(options, rule.missingData === 'unavailable' ? 'missingUnavailable' : 'missingExclude') }),
    chartString(options, 'fatigueThreshold', { v1: rule.direction === 'higherIsBetter' ? chartString(options, 'fallCapital') : chartString(options, 'riseCapital'), v2: formatAutomaticPercent(rule.thresholdPct, 1, false, options.locale?.language), v3: fatigue.changePct === null ? chartString(options, 'changeUnavailable') : chartString(options, 'observedChange', { v1: formatAutomaticPercent(fatigue.changePct, 1, true, options.locale?.language) }) })];
}

/** The authored definitions, one sentence per line. */
function definitionLines(definitions: string | undefined): string[] {
  const text = definitions?.trim();
  return text ? text.split(/(?<=[.!?])\s+(?=\S)/) : [];
}

/** The daily rows, with one empty day bridging each gap in the calendar. */
function trendRows(data: CreativeData) {
  return data.observations.flatMap((row, index) => {
    const prior = data.observations[index - 1];
    return prior && Date.parse(row.date) - Date.parse(prior.date) > 86400000
      ? [{ date: new Date(Date.parse(prior.date) + 86400000).toISOString().slice(0, 10), spend: null, cpa: null, ctr: null }, row] : [row];
  });
}

const TREND_KEYS = ['spend', 'cpa', 'ctr'] as const;
function trendTitle(data: CreativeData, key: (typeof TREND_KEYS)[number], options: CreativeOptions): string {
  return `${key === 'spend' ? chartString(options, 'spendTitle') : key.toUpperCase()}, ${key === 'ctr' ? '%' : data.facts.currency}`;
}

/** The trend strip: a heading, then three panels with a title, the spark and its first and last value. Returns its bottom. */
function trends(data: CreativeData, box: { x: number; y: number; w: number }, theme: Theme, add: AddText, nodes: SceneNode[], fonts: CardFonts, measure: TextMeasurer, stacked: boolean, sparkH: number, palette?: string, options: CreativeOptions = {}): { end: number; sparks: Rect } {
  const rows = trendRows(data);
  const lineH = (font: FontSpec) => font.size * (font.lineHeight ?? 1.2);
  let y = box.y;
  if (rows.length) {
    const heading = chartString(options, 'dailyHeading', { v1: readerSpan(rows[0]!.date, rows[rows.length - 1]!.date, options) });
    const head = add('creative:trends', heading, box, { font: fonts.trendHead, typeRole: roleOf(fonts.trendHead, fonts) });
    const sub = chartString(options, 'ownScale');
    const subW = measure(sub, fonts.note).width + 1;
    // The scale note follows the heading on its line, on the heading's baseline; it takes the next line when they do not fit.
    if (head.w + 6 + subW <= box.w) {
      add('creative:trends-scale', sub, { x: box.x + head.w + 6, y: y + (fonts.trendHead.size - fonts.note.size) * 0.88, w: subW }, { font: fonts.note, ink: 'inkMuted', typeRole: 'footnote' });
      y += head.h;
    } else {
      y += head.h;
      y += add('creative:trends-scale', sub, { ...box, y }, { font: fonts.note, ink: 'inkMuted', typeRole: 'footnote' }).h;
    }
  } else {
    y += add('creative:trends', chartString(options, 'noDailyObservations'), box, { font: fonts.trendHead, typeRole: roleOf(fonts.trendHead, fonts) }).h;
  }
  const titleY = y + (stacked ? 5 : 7);
  const pitch = box.w / 3;
  const titleH = Math.max(...TREND_KEYS.map(key => wrapText(trendTitle(data, key, options), fonts.note, pitch - 12, 12, measure).lines.length * lineH(fonts.note)));
  const sparkTop = titleY + titleH + (stacked ? 3 : 6);
  const style: SparklineStyle = sparkStyle(theme, { padding: 3, dotRadius: stacked ? 2.5 : 3 });
  const dotR = stacked ? 1.8 : 2.2;
  const labelY = sparkTop + sparkH + 2 * style.padding + 2;
  let end = labelY;
  for (const [index, key] of TREND_KEYS.entries()) {
    const panelX = box.x + index * pitch;
    const values = rows.map(row => row[key]);
    add(`creative:trend-title:${key}`, trendTitle(data, key, options), { x: panelX, y: titleY, w: pitch - 12 }, { font: fonts.note, ink: 'inkMuted', typeRole: 'footnote' });
    const cell = { x: panelX + 1, y: sparkTop, w: pitch * 0.72 + 2 * style.padding, h: sparkH + 2 * style.padding };
    const plot = plotSparkline({ box: cell, values, shape: 'line', domain: sparklineDomain([values], 'line'), style });
    // Preserve calendar spacing without allocating a row for every absent date.
    if (rows.length > 1) {
      const start = Date.parse(rows[0]!.date), span = Date.parse(rows[rows.length - 1]!.date) - start;
      const x0 = plot.xAt(0), width = plot.xAt(rows.length - 1) - x0;
      const positions = new Map(rows.map((row, i) => [plot.xAt(i), x0 + width * (Date.parse(row.date) - start) / span]));
      plot.runs = plot.runs.map(run => run.map(point => ({ ...point, x: positions.get(point.x)! })));
      if (plot.last) plot.last.x = positions.get(plot.last.x)!;
      // The gap rings follow the calendar too, on their remapped bridges.
      plot.gaps = plot.gaps.map((gap) => {
        const x = positions.get(gap.x) ?? gap.x;
        if (!gap.bridge) return { ...gap, x };
        const [a, b] = gap.bridge.map((point) => ({ ...point, x: positions.get(point.x) ?? point.x })) as [{ x: number; y: number }, { x: number; y: number }];
        return { ...gap, x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x), bridge: [a, b] };
      });
    }
    const owner = { seriesId: `daily:${key}`, categoryId: data.id };
    pushAll(nodes, emitSparklineMarks({ plot, shape: 'line', theme, palette, style, nodeId: suffix => `creative:trend:${key}:${suffix}`, owner, partPrefix: 'kpi',
      // No authored focus on a creative card: the last day leads in series 1.
      lastPaint: semanticPalettePaint(theme, palette, 'sequential') }));
    // Every day is a dot (n is small on a review card); the last keeps its larger mark.
    const points = plot.runs.flat();
    points.forEach((point, i) => {
      if (plot.last && point.x === plot.last.x && point.y === plot.last.y) return;
      nodes.push({ t: 'circle', id: `creative:trend:${key}:point:${i}`, cx: point.x, cy: point.y, r: dotR, fill: semanticPalettePaint(theme, palette, 'spark'), owner, part: 'sparkDot' });
    });
    // The first and the last daily value under their points, so a reader sees the size of the change, not only its shape.
    const observed = values.flatMap((value, i) => (value === null ? [] : [{ value, i }]));
    if (observed.length) {
      const format = valueSetFormatter(observed.map(o => o.value), options.locale?.language, false, key === 'ctr' ? '%' : data.facts.currency, options.target);
      const first = points[0]!, last = plot.last!;
      const lastText = format(last.value), lastW = measure(lastText, fonts.noteStrong).width + 1;
      const lastSpec = { font: fonts.noteStrong, owner: { seriesId: 'daily' }, align: 'end' as const, role: 'value' as const, typeRole: 'footnote' as const };
      end = Math.max(end, labelY + add(`creative:trend-last:${key}`, lastText, { x: last.x - lastW, y: labelY, w: lastW }, lastSpec).h);
      const firstText = format(observed[0]!.value), firstW = measure(firstText, fonts.note).width + 1;
      if (observed.length > 1 && first.x + firstW + 6 <= last.x - lastW) {
        add(`creative:trend-first:${key}`, firstText, { x: first.x, y: labelY, w: firstW }, { font: fonts.note, owner: { seriesId: 'daily' }, ink: 'inkMuted', role: 'value', typeRole: 'footnote' });
      }
    }
    if (values.every(value => value === null)) add(`creative:trend-empty:${key}`, chartString(options, 'unavailable'), { x: panelX, y: sparkTop + 4, w: pitch - 12 }, { font: fonts.note, ink: 'inkMuted', typeRole: 'footnote' });
  }
  return { end, sparks: { x: box.x, y: sparkTop, w: box.w, h: sparkH + 2 * style.padding } };
}

export function layoutCreative(data: CreativeData, options: CreativeOptions & Pick<BaseOptions, 'measure'> = {}): Geometry<CreativeMarks, CreativeDerived> {
  const measure = options.measure ?? defaultMeasurer;
  const size = resolveSize(options.size ?? { width: 960, height: 700 });
  const stacked = size.width < STACKED_BELOW;
  const warnings: LintWarning[] = [];
  const theme = themeForWidth(resolveSemanticPaletteTheme(resolveTheme(options.theme), options.palette, warnings), size.width);
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const fatigue = deriveCreativeFatigue(data);
  const fatigueLines = fatigueText(fatigue, options);
  if (!fatigue.rule) warnings.push({ code: 'creative-fatigue-no-rule', severity: 'info', field: ['data', 'fatigueRule'],
    message: 'No fatigue rule: the card prints "Fatigue: not assessed".',
    suggest: 'Supply data.fatigueRule with a metric, two windows, a threshold, minimum observations and a missing-data rule.' });
  const comparison = comparisonText(data, options);
  // The source's own definitions of its metrics; the card never writes them.
  const definitions = definitionLines(data.definitions);
  // Under `footnotes: false` the method lines leave the card with the source
  // and stay readable in frame.notes; the status line stays.
  // The registry hands `footnotes: false` on as `footnotesOff` (frame.ts).
  const notesOff = options.footnotes === false || (options as { footnotesOff?: boolean }).footnotesOff === true;
  // The wide form's sides follow the shared margin by width (24 below 840 px, 28 from 840), not a literal 28.
  const sides = canvasMargin(theme, size.width);
  const margin = stacked ? { top: 16, right: 16, bottom: 16, left: 16 } : { top: 24, right: sides.right, bottom: 24, left: sides.left };
  const frame = solveFrame({ size, margin, cardGaps: true,
    ...frameTextOptions(options), ...(notesOff ? { footnotes: [comparison, ...(data.definitions?.trim() ? [data.definitions.trim()] : []), ...fatigueLines.slice(1)] } : {}),
    subtitle: resolveSubtitle(options.subtitle), theme, measure }, occupied);
  const { plot } = frame;
  const nodes: SceneNode[] = [...frame.nodes];
  const requests: LabelRequest[] = [];
  const inks = new Map<string, PaintToken>();
  const fonts = cardFonts(theme, !stacked);
  const add = textBuilder(requests, inks, measure);
  const muted = (font: FontSpec) => ({ font, ink: 'inkMuted' as const, typeRole: roleOf(font, fonts) });

  const media = mediaBox(data, plot, stacked);
  mediaNodes(data, media, nodes, add, fonts, options);
  occupied.claim(media, 'mark', { pointId: data.id }, 'media');
  const caption = mediaCaption(data, options);
  const info = stacked
    ? { x: media.x + media.w + 12, y: plot.y, w: plot.x + plot.w - media.x - media.w - 12 }
    : (() => { const gap = 28 + 4 * Math.max(0, Math.min(1, (plot.w - 664) / 240)); const x = media.x + media.w + gap; return { x, y: plot.y, w: plot.x + plot.w - x }; })();

  let y = info.y;
  y += add('creative:name', data.facts.name, info, { font: fonts.name, typeRole: 'label' }).h + 3;
  const facts = data.facts.endDate === null
    ? chartString(options, 'factsLive', { v1: data.facts.format, v2: readerDate(data.facts.launchDate, options) })
    : chartString(options, 'factsEnded', { v1: data.facts.format, v2: readerSpan(data.facts.launchDate, data.facts.endDate, options) });
  y += add('creative:facts', facts, { ...info, y }, muted(fonts.facts)).h + 2;
  const spend = chartString(options, 'factsSpend', { v1: creativeValue(data.facts.spendToDate, data.facts.currency, undefined, options.target, options), v2: readerDate(data.facts.asOf, options) });
  // A spend line too long for the column breaks at its dot, not inside the date.
  const spendParts = measure(spend, fonts.facts).width > info.w ? spend.split(' · ') : [spend];
  spendParts.forEach((part, i) => {
    y += add(i === 0 ? 'creative:facts-spend' : `creative:facts-spend:${i}`, i < spendParts.length - 1 ? `${part} ·` : part, { ...info, y }, muted(fonts.facts)).h + (i < spendParts.length - 1 ? 2 : 0);
  });
  if (stacked && caption) { y += 2; y += add('creative:media-caption', caption, { ...info, y }, muted(fonts.note)).h; }

  const table = stacked ? { x: plot.x, y: Math.max(y, media.y + media.h) + 16, w: plot.w } : { x: info.x, y: y + 14, w: info.w };
  const metrics = metricRows(theme, data, table, add, nodes, fonts, stacked, options, options.target);

  // The notes: the left column under the media on a wide card, under the table when stacked.
  let notesY: number;
  const notesBox = stacked ? { x: plot.x, w: plot.w } : { x: plot.x, w: media.w };
  if (stacked) notesY = metrics.end + 14;
  else {
    notesY = media.y + media.h + 18;
    if (caption) notesY += add('creative:media-caption', caption, { ...notesBox, y: media.y + media.h + 8 }, muted(fonts.note)).h + 8;
  }
  const noteLines: [string, string][] = notesOff ? [] : [['creative:comparison', comparison], ...definitions.map((text, i): [string, string] => [i === 0 ? 'creative:definitions' : `creative:definitions:${i}`, text])];
  for (const [id, text] of noteLines) notesY += add(id, text, { ...notesBox, y: notesY }, muted(fonts.note)).h + 2;
  // With a rule, its verdict and method stand under the trends on a wide card (the left column is narrow); the one "not assessed" line stays with the notes.
  const fatigueUnderTrends = !stacked && fatigue.rule !== undefined;
  const fatigueBlock = (box: { x: number; w: number }, top: number): number => {
    for (const [index, text] of (notesOff ? fatigueLines.slice(0, 1) : fatigueLines).entries()) {
      // With a rule, its verdict leads in the strong weight; the method lines follow as notes.
      const strong = index === 0 && fatigue.rule !== undefined;
      top += add(`creative:fatigue:${index}`, text, { ...box, y: top }, { ...(strong ? { font: fonts.noteStrong, typeRole: 'footnote' as const } : muted(fonts.note)), owner: { seriesId: 'fatigue', categoryId: data.id } }).h + 2;
    }
    return top;
  };
  if (!fatigueUnderTrends) notesY = fatigueBlock(notesBox, notesY);

  const sparkH = stacked ? (size.width >= 460 ? 28 : 24) : 38;
  const trendBox = stacked ? { x: plot.x, y: notesY + 12, w: plot.w } : { x: info.x, y: metrics.end + 16, w: info.w };
  const strip = trends(data, trendBox, theme, add, nodes, fonts, measure, stacked, sparkH, options.palette, options);
  const stripEnd = fatigueUnderTrends ? fatigueBlock(trendBox, strip.end + 12) - 2 : strip.end;
  const contentEnd = Math.max(stripEnd, stacked ? 0 : notesY - 2);
  const requiredHeight = contentEnd + (size.height - plot.y - plot.h);
  // An unsized card takes the height of its content; an explicitly too-small canvas is refused by the shared fit layer.
  const grow = rowDrivenHeight({ options, width: size.width, height: size.height, chromeH: 0, rowsH: Math.ceil(requiredHeight) });
  if (grow !== undefined) return layoutCreative(data, { ...options, size: { ...size, height: grow } });
  const solved = solveLabels(requests, occupied, labelCtx(theme, size, {}, {
    measure,
    plot,
    labelPad: LABEL_PAD,
  }));
  occupied.claim(strip.sparks, 'mark', { seriesId: 'daily' }, 'trends');
  const labelNodes = labelsToNodes(theme, solved.placed, label => requests.find(request => request.id === label.id)!.font);
  for (const node of labelNodes) {
    const token = node.t === 'text' ? inks.get(node.id.slice('label:'.length)) : undefined;
    if (token && node.t === 'text') node.ink = { token };
  }
  pushAll(nodes, labelNodes);
  return { type: 'creative', size, sizing: resolveSizing(creativeSizing, size, { minHeight: requiredHeight, naturalHeight: requiredHeight }),
    plot, scene: nodes, labels: solved.placed, axes: [], annotations: [], frame: frame.frame,
    marks: { media, metrics: metrics.marks }, derived: { fatigue, deltas: creativeMetrics.map(([key]) => ({ key, ...data.metrics[key], ...creativeDelta(key, data.metrics[key], options) })) },
    a11y: { title: accessibleTitle(options.title, data.facts.name), desc: chartString(options, 'creativeDesc', { v1: data.media.alt, v2: fatigueLines.join(' ') }) },
    warnings: [...warnings, ...(frame.frame.warnings ?? []), ...solved.warnings], debug: { occupied: occupied.snapshot(), decisions: solved.decisions } };
}

/** The pad the solver keeps between two labels on the card. */
const LABEL_PAD = 1;
