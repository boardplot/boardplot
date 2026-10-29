import { chartString } from './strings/eventLane';
/**
 * The event lane (column, combo, line): dated events set in a band between
 * the header and the plot, each a block of group and date, title and detail,
 * with a thin pole down to the data. An event that does not fit keeps a
 * numbered marker on its pole and an entry in the event key, which the frame
 * draws above the footnotes. Periods draw a thin bar in the lane.
 *
 * Pure and chart-agnostic: `settleEventLane` reads the annotations against
 * the categories, measures and packs the blocks and sizes the lane and the
 * key with the chart's own frame and plot functions, and `emitEventLane`
 * draws what was packed once the data is on the canvas. Both load with the
 * annotation engine (core/annotateEngine); layouts reach them through
 * core/annotatePass, so a chart without an event never fetches this module.
 *
 * The engine prints the authored strings, the authored date as `d MMM` and
 * the marker numbers; it composes nothing else. A pole never appears without
 * its text or its number: an event whose text the solver hides loses its
 * pole with it. Design basis: newspaper chart style guides (event labels in a band
 * with thin rules, thin period bars, numbered key on narrow screens), numbered
 * comments in chart notation, web chart tools (ranges behind, lines above).
 */

import type { InteractionEvent } from './a11y/types';
import { formatDate } from './dateFormat';
import { eventReading } from './eventReading';
import { recordPartNeed } from './footer';
import { wrapFootnote, type FrameBand, type FrameResult, type LegendItemInput } from './frame';
import type { Rect, Size } from './geometry';
import { parseISODate } from './isoDate';
import { parseTimeText } from './isoTime';
import type { OccupiedIndex } from './label/occupied';
import { PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from './label/solver';
import { NormalizeError } from './normalize/shared';
import { wrapText, type FontSpec, type TextMeasurer } from './text';
import { colorblindPaint, microType, typeWidthClass, emphasisWeight, strokeToken, dashToken } from './theme';
import { defaultAnnotationId, type Annotation, type EventGlyph, type EventOptions, type EventTone } from './types/annotations';
import type { Id, OwnerRef } from './types/cell';
import type { LintWarning, Paint, PlacedAnnotation, PlacedLabel, SceneNode } from './types/scene';
import type { Theme } from './types/theme';
import { maxOf, minOf, pushAll } from './arrays';

type EventAnnotation = Extract<Annotation, { kind: 'event' }>;

/** An event resolved against the categories; the chart supplies x later. */
interface LaneEvent {
  id: Id;
  order: number;
  ci: number;
  /** Time position in category units: category index plus the fraction of its period. */
  pos: number;
  date?: string;
  group?: string;
  /** The group's glyph, or a dot for an ungrouped event with a tone. */
  glyph?: EventGlyph;
  paint: Paint;
  title: string;
  detail: string[];
  /** Further changes on this date: the lane and the key draw a "+N" after the title, the reading lists them. */
  more: number;
  /** The event in full, for the SVG title and description, the records and the hover card. */
  reading: InteractionEvent;
  priority: number;
  placement: 'auto' | 'key' | 'inline';
  /** A period in category units; `open` when it runs past the last category. */
  period?: { from: number; to: number; open: boolean };
}

const GLYPHS: EventGlyph[] = ['dot', 'triangle', 'diamond', 'square'];
const DAY_MS = 864e5;

const byTime = (a: LaneEvent, b: LaneEvent) => a.pos - b.pos || a.order - b.order;

/** The title as the lane and the key set it: with a compact +N when more changes share the date. */
const shownTitle = (ev: LaneEvent) => (ev.more > 0 ? `${ev.title} +${ev.more}` : ev.title);
/** The one line a key or a marker request holds for an event. */
const plainTitle = (ev: LaneEvent) => shownTitle(ev).replace(/\n/g, ' ');
const detailLines = (detail: string | string[] | undefined): string[] => (detail === undefined ? [] : Array.isArray(detail) ? detail : [detail]);

/** The events of an annotation list, placed on the categories; everything else stays with the annotation pass. */
function resolveEvents(input: {
  annotations: readonly Annotation[];
  categories: readonly { id: Id; label?: string; date?: string }[];
  events?: EventOptions;
  language?: string;
  colorblindSafe?: boolean;
  /** Line charts honour `labelPlacement: 'inline'`. */
  inline: boolean;
  scale?: LaneScale;
  warnings: LintWarning[];
}): LaneEvent[] {
  const { categories: cats, warnings } = input;
  const n = cats.length;
  const catIndex = new Map(cats.map((c, i) => [c.id, i] as const));
  const days = cats.map((c) => (c.date ? parseISODate(c.date) : null));
  const dated = n > 0 && days.every((d) => d !== null);
  const dayOf = (d: Date) => Math.round(d.getTime() / DAY_MS);
  const catDays = dated ? days.map((d) => dayOf(d!)) : [];
  const spanEnd = dated ? catDays[n - 1]! + (n > 1 ? catDays[n - 1]! - catDays[n - 2]! : 1) : 0;
  /** Category position of a day, or null outside the span. */
  const posOfDay = (day: number): number | null => {
    if (day < catDays[0]! || day >= spanEnd) return null;
    let ci = 0;
    for (let i = 0; i < n; i++) if (catDays[i]! <= day) ci = i;
    const next = ci < n - 1 ? catDays[ci + 1]! : spanEnd;
    return ci + (day - catDays[ci]!) / Math.max(1, next - catDays[ci]!);
  };
  const groups = new Map((input.events?.groups ?? []).map((g, i) => [g.id, { ...g, glyph: g.glyph ?? GLYPHS[i % GLYPHS.length]! }] as const));
  const paintOf = (tone: EventTone): Paint =>
    tone === 'neutral' ? { token: 'inkMuted' } : input.colorblindSafe ? colorblindPaint(tone) : { token: tone };
  const out: LaneEvent[] = [];
  input.annotations.forEach((annotation, index) => {
    if (annotation.kind !== 'event') return;
    const ann = annotation as EventAnnotation;
    const id = defaultAnnotationId(ann, index);
    const warn = (code: string, message: string, suggest?: string) =>
      warnings.push({ code, severity: 'warn', message, owner: { annotationId: id }, ...(suggest ? { suggest } : {}) });
    let pos: number;
    let date: string | undefined;
    let when: Pick<InteractionEvent, 'date' | 'dateText' | 'place'>;
    let period: LaneEvent['period'];
    if (ann.date !== undefined && input.scale) {
      // A continuous axis: the position is the x value itself, between readings or on one.
      const scale = input.scale;
      const x = scale.read(ann.date, `options.annotations[${index}].date`, false);
      if (x < scale.lo || x > scale.hi) {
        warn('event-out-of-range', `event '${id}' at ${ann.date} lies outside the chart's x range — not drawn`);
        return;
      }
      pos = x;
      date = scale.short(x);
      when = { date: ann.date, dateText: scale.full(x) };
      if (ann.end !== undefined) {
        const end = scale.read(ann.end, `options.annotations[${index}].end`, true);
        if (end < x) warn('bad-anchor', `event '${id}': its end lies before its date — drawn without its period`);
        else period = { from: x, to: Math.min(scale.hi, end), open: end > scale.hi };
      }
    } else if (ann.date !== undefined) {
      if (!dated) {
        throw new NormalizeError('event-date-unresolvable', `options.annotations[${index}].date`,
          `event '${id}' has a date, but not every category carries an ISO date to place it by`,
          "give each category an ISO 'date', or anchor the event to a category with 'at'");
      }
      const parsed = parseISODate(ann.date);
      if (!parsed && parseTimeText(ann.date)) {
        throw new NormalizeError('event-time-needs-x-axis', `options.annotations[${index}].date`,
          `event '${id}' gives a time of day, and the categories are days, so the time has no place`,
          "give the day only (yyyy-mm-dd), or draw the readings on a continuous axis: data.x with options.xAxis: { type: 'time' }");
      }
      const at = parsed ? posOfDay(dayOf(parsed)) : null;
      if (at === null) {
        warn('event-out-of-range', `event '${id}' on ${ann.date} lies outside the chart's categories — not drawn`);
        return;
      }
      pos = at;
      date = formatDate(parsed!, 'd MMM', input.language);
      when = { date: ann.date, dateText: formatDate(parsed!, 'd MMM yyyy', input.language) };
      const end = ann.end ? parseISODate(ann.end) : null;
      if (end) {
        const endDay = dayOf(end) + 1;
        period = { from: pos, to: Math.min(n, posOfDay(endDay) ?? n), open: endDay > spanEnd };
      }
    } else {
      const catId = typeof ann.at === 'string' ? ann.at : ann.at && 'categoryId' in ann.at ? ann.at.categoryId : undefined;
      const ci = catId === undefined ? undefined : catIndex.get(catId);
      if (ci === undefined) {
        warn('bad-anchor', `event '${id}': unresolvable category`);
        return;
      }
      pos = ci;
      const place = cats[ci]!.label ?? catId!;
      when = { place: place.replace(/\n/g, ' ') };
      if (ann.to !== undefined) {
        const to = catIndex.get(ann.to);
        if (to === undefined || to < ci) warn('bad-anchor', `event '${id}': 'to' names no category at or after '${catId}' — drawn without its period`);
        else period = { from: ci, to: to + 1, open: false };
      }
    }
    const group = ann.group === undefined ? undefined : groups.get(ann.group);
    if (ann.group !== undefined && !group) {
      warn('event-group-unknown', `event '${id}' names group '${ann.group}', which options.events.groups does not declare — drawn without a kind`,
        `declare { id: '${ann.group}', label } in options.events.groups`);
    }
    const tone = ann.tone ?? group?.tone ?? 'neutral';
    const items = [{ label: ann.label, detail: ann.detail }, ...(ann.items ?? [])]
      .map((item) => ({ title: item.label.replace(/\n/g, ' '), detail: detailLines(item.detail) }));
    out.push({
      id,
      order: index,
      ci: input.scale ? pos : Math.floor(pos),
      pos,
      ...(date ? { date } : {}),
      ...(group ? { group: group.label } : {}),
      // An ungrouped event with a tone still shows it: a dot in the tone.
      ...(group ? { glyph: group.glyph } : tone !== 'neutral' ? { glyph: 'dot' as const } : {}),
      paint: paintOf(tone),
      title: ann.label,
      detail: detailLines(ann.detail),
      more: ann.items?.length ?? 0,
      reading: { ...when!, ...(group ? { group: group.label } : {}), items },
      priority: ann.priority ?? 0,
      placement: input.inline && ann.labelPlacement === 'inline' ? 'inline' : ann.placement ?? input.events?.placement ?? 'auto',
      ...(period ? { period } : {}),
    });
  });
  return out;
}

/** One numbered entry of the event key, in time order. */
interface EventKeyEntry {
  /** The event's annotation id, the owner of its nodes. */
  id: Id;
  n: number;
  paint: Paint;
  glyph?: EventGlyph;
  /** The authored date, formatted. */
  date?: string;
  group?: string;
  title: string;
  detail?: string;
  /** The event in full, the `<title>` of its title line. */
  reading: string;
}

interface EventKeyInput {
  entries: EventKeyEntry[];
  /** The compact form: entries packed into as many columns as shorten the key. */
  dense?: boolean;
  title?: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The shape that tells an event kind apart without colour; `s` scales it with the type. */
function eventGlyphNode(glyph: EventGlyph, cx: number, cy: number, s: number, paint: Paint, id: Id, owner: OwnerRef, part: string): SceneNode {
  if (glyph === 'dot') return { t: 'circle', id, cx: r2(cx), cy: r2(cy), r: r2(3.1 * s), fill: paint, owner, part };
  const pts = glyph === 'triangle'
    ? [[-3.6, -2.6], [3.6, -2.6], [0, 3.4]]
    : glyph === 'diamond' ? [[0, -3.8], [3.8, 0], [0, 3.8], [-3.8, 0]] : [[-3, -3], [3, -3], [3, 3], [-3, 3]];
  const d = `${pts.map(([dx, dy], i) => `${i === 0 ? 'M' : 'L'}${r2(cx + dx! * s)} ${r2(cy + dy! * s)}`).join('')}Z`;
  return { t: 'path', id, d, fill: paint, owner, part };
}

/** The numbered ring of an event marker; the number is drawn by the caller. */
function eventRingNode(theme: Theme, cx: number, cy: number, r: number, paint: Paint, id: Id, owner: OwnerRef, part: string, title?: string, focusStop?: true): SceneNode {
  return { t: 'circle', id, cx: r2(cx), cy: r2(cy), r: r2(r), fill: { token: 'background' }, stroke: paint, strokeWidth: strokeToken(theme, 'mark'), ...(title ? { title } : {}), ...(focusStop ? { focusStop } : {}), owner, part };
}

/** Air between two event markers side by side, past their ring strokes. */
const MARKER_GAP = 5;

/** Type of the event lane and key: header and detail in the footnote role, titles in the axis role, numbers in micro. */
function eventFonts(theme: Theme) {
  const family = theme.type.family;
  const note: FontSpec = { family, ...theme.type.footnote };
  const title: FontSpec = { family, ...theme.type.axis, weight: emphasisWeight(theme) };
  const num: FontSpec = { ...microType(theme) };
  return {
    note,
    noteBold: { ...note },
    title,
    num,
    noteLH: note.size * (note.lineHeight ?? 1.3),
    titleLH: title.size * (title.lineHeight ?? 1.2),
    glyphS: note.size / 9,
    ringR: num.size * 0.8125,
  };
}

/** The renderers' ascent fraction: a text node's y is the top of its line box, the baseline sits this far below. */
const EVENT_TEXT_ASCENT = 0.88;
const KEY_COL_MIN = 380;
const KEY_COL_GAP = 28;
/** The compact key tries up to this many columns, none narrower than this. */
const KEY_PACK_MAX = 6;
const KEY_PACK_COL_MIN = 150;
const KEY_ENTRY_GAP = 4;

/**
 * The event key: numbered entries in time order, one or two columns (two
 * when the content width holds two of 380px). Each column aligns its own
 * dates right and its own kind labels; the title and the detail run as one
 * flow with a hanging indent. Nothing is cut.
 */
function keyBand(key: EventKeyInput, x0: number, width: number, theme: Theme, measure: TextMeasurer) {
  const f = eventFonts(theme);
  const n = key.entries.length;
  // Two columns when the width holds two of 380px, or when every entry fits
  // one line of a half column (a titles-only key on a narrow canvas).
  const half = (width - KEY_COL_GAP) / 2;
  const oneLine = (e: EventKeyEntry) => 2 * f.ringR + 5 + (e.date ? measure(e.date, f.note).width + 8 : 0)
    + (e.group ? measure(e.group, f.noteBold).width + 11 * f.glyphS + 8 : 0) + measure(e.title, f.title).width
    + (e.detail ? 6 + measure(e.detail, f.note).width : 0);
  const firstH = Math.max(f.titleLH, 2 * f.ringR + 1);
  const titleH = key.title ? f.noteLH + 2 : 0;
  const build = (cols: number) => {
    const colW = (width - (cols - 1) * KEY_COL_GAP) / cols;
    const perCol = Math.ceil(n / cols);
    const columns = Array.from({ length: cols }, (_, c) => {
      const entries = key.entries.slice(c * perCol, (c + 1) * perCol);
      const dateW = Math.max(0, maxOf(entries.map((e) => (e.date ? measure(e.date, f.note).width : 0))));
      const groupW = Math.max(0, maxOf(entries.map((e) => (e.group ? measure(e.group, f.noteBold).width + (e.glyph ? 11 * f.glyphS : 0) : 0))));
      const dateX = 2 * f.ringR + 5;
      const groupX = dateX + (dateW > 0 ? dateW + 8 : 0);
      const textX = groupX + (groupW > 0 ? groupW + 8 : 0);
      const textW = Math.max(40, colW - textX);
      let y = 0;
      const rows = entries.map((e) => {
        const titleW = measure(e.title, f.title).width;
        const titleLines = titleW <= textW ? [e.title] : wrapFootnote(e.title, f.title, textW, measure);
        let first = '';
        let rest = e.detail ?? '';
        if (rest && titleLines.length === 1) {
          const words = rest.split(' ');
          const room = textW - titleW - 6;
          let k = 0;
          while (k < words.length && measure(words.slice(0, k + 1).join(' '), f.note).width <= room) k++;
          // No single-word widow on the next line: it takes two words at least.
          if (k === words.length - 1 && k > 1) k--;
          // A break prefers the authored separator, which the break replaces.
          const dot = k < words.length ? words.slice(0, k + 1).lastIndexOf('·') : -1;
          const cut = dot > 0 ? dot : k;
          first = words.slice(0, cut).join(' ');
          rest = words.slice(words[cut] === '·' ? cut + 1 : cut).join(' ');
        }
        const restLines = rest ? wrapFootnote(rest, f.note, textW, measure) : [];
        const h = firstH + (titleLines.length - 1) * f.titleLH + restLines.length * f.noteLH;
        const row = { e, y, titleW, titleLines, first, restLines, h };
        y += h + KEY_ENTRY_GAP;
        return row;
      });
      return { rows, dateX, dateW, groupX, textX, h: Math.max(0, y - KEY_ENTRY_GAP) };
    });
    return { cols, colW, columns, h: titleH + Math.max(...columns.map((column) => column.h)) };
  };
  // The compact key packs its entries into as few lines as the width allows: the column count
  // with the lowest key, where every title still sets in two lines at most. Else one or two columns.
  const packed = key.dense
    ? Array.from({ length: Math.min(n, KEY_PACK_MAX) }, (_, i) => build(i + 1))
      .filter((layout) => layout.colW >= KEY_PACK_COL_MIN && layout.columns.every((column) => column.rows.every((row) => row.titleLines.length <= 2)))
      .reduce<ReturnType<typeof build> | undefined>((best, layout) => (best === undefined || layout.h < best.h ? layout : best), undefined)
    : undefined;
  const { colW, columns, h } = packed ?? build(n > 1 && (width >= 2 * KEY_COL_MIN + KEY_COL_GAP || key.entries.every((e) => oneLine(e) <= half)) ? 2 : 1);
  const draw = (top: number, nid: (part: string) => Id): SceneNode[] => {
    const nodes: SceneNode[] = [];
    const text = (x: number, y: number, lines: string[], font: FontSpec, ink: Paint, owner: OwnerRef, align: 'start' | 'middle' | 'end' = 'start', role: 'note' | 'value' = 'note', title?: string) =>
      nodes.push({ t: 'text', id: nid('eventKey'), x: r2(x), y: r2(y), lines, align, typeRole: font === f.num ? 'micro' : font === f.title ? 'axis' : 'footnote', font, ink, ...(title ? { title } : {}), owner, part: 'eventKey', role });
    if (key.title) text(x0, top, [key.title], f.noteBold, { token: 'inkMuted' }, {});
    columns.forEach((column, c) => {
      const cx0 = x0 + c * (colW + KEY_COL_GAP);
      for (const row of column.rows) {
        const owner = { annotationId: row.e.id };
        const rowTop = top + titleH + row.y;
        const titleTop = rowTop + (firstH - f.titleLH) / 2;
        const base = titleTop + f.title.size * EVENT_TEXT_ASCENT;
        const at = (font: FontSpec) => base - font.size * EVENT_TEXT_ASCENT;
        const midY = base - 0.35 * f.title.size;
        nodes.push(eventRingNode(theme, cx0 + f.ringR, midY, f.ringR, row.e.paint, nid('eventKey'), owner, 'eventKey'));
        text(cx0 + f.ringR, midY - 0.53 * f.num.size, [String(row.e.n)], f.num, { token: 'ink' }, owner, 'middle', 'value');
        if (row.e.date) text(cx0 + column.dateX + column.dateW, at(f.note), [row.e.date], f.note, { token: 'inkMuted' }, owner, 'end');
        if (row.e.group) {
          let gx = cx0 + column.groupX;
          if (row.e.glyph) {
            nodes.push(eventGlyphNode(row.e.glyph, gx + 3.6 * f.glyphS, base - 0.35 * f.note.size, f.glyphS, row.e.paint, nid('eventKey'), owner, 'eventKey'));
            gx += 11 * f.glyphS;
          }
          text(gx, at(f.noteBold), [row.e.group], f.noteBold, { token: 'inkMuted' }, owner);
        }
        text(cx0 + column.textX, titleTop, row.titleLines, f.title, { token: 'ink' }, owner, 'start', 'note', row.e.reading);
        if (row.first) text(cx0 + column.textX + row.titleW + 6, at(f.note), [row.first], f.note, { token: 'inkMuted' }, owner);
        if (row.restLines.length) {
          text(cx0 + column.textX, rowTop + firstH + (row.titleLines.length - 1) * f.titleLH, row.restLines, f.note, { token: 'inkMuted' }, owner);
        }
      }
    });
    return nodes;
  };
  return { h, draw };
}

/** The event key as a frame band, with the key-row entries its marks need when the key does not name them. */
function eventKeyBand(key: EventKeyInput, theme: Theme, measure: TextMeasurer, legend: LegendItemInput[] = [], yields = false): FrameBand {
  return { layout: (x, width) => keyBand(key, x, width, theme, measure), ...(legend.length > 0 ? { legend, ...(yields ? { legendYieldsToSeries: true } : {}) } : {}) };
}

/**
 * One row above the plot says what each event colour and each
 * period bracket means, with or without the key's detail lines: a ring in
 * the kind's colour, as the markers are drawn, and the bracket as a bar.
 */
function eventLegendItems(events: readonly LaneEvent[], language?: string): LegendItemInput[] {
  const items: LegendItemInput[] = [];
  const seen = new Set<string>();
  for (const ev of [...events].sort(byTime)) {
    if (!ev.group) continue;
    if (!seen.has(ev.group)) {
      seen.add(ev.group);
      items.push({ id: `__event:${ev.group}`, label: ev.group, paint: { token: 'background' }, stroke: ev.paint, key: 'marker' });
    }
    if (ev.period && !seen.has(`${ev.group}:period`)) {
      seen.add(`${ev.group}:period`);
      items.push({ id: `__eventPeriod:${ev.group}`, label: chartString({ locale: { language } }, 'eventPeriod', { v1: ev.group }), paint: ev.paint, key: 'bracket', width: 2 });
    }
  }
  return items;
}

type Fonts = ReturnType<typeof eventFonts>;

/** A measured block: header (glyph, group, date), title lines, detail lines. */
interface Block {
  ev: LaneEvent;
  w: number;
  h: number;
  headerW: number;
  /** Room for the glyph before the title when there is no header to carry it. */
  lead: number;
  title: string[];
  titleW: number;
  detail: string[];
  detailW: number;
}

/** Holds the words of a bracketed group together through a wrap; measured as a space. */
const JOIN = '\u2060';

/**
 * Greedy wrap, then the narrowest width that keeps the same line count:
 * lines of even length. A bracketed group such as "(2 sizes)" stays on one
 * line when it fits one.
 */
function balancedWrap(text: string, font: FontSpec, maxW: number, maxLines: number, measure: TextMeasurer) {
  const joined = text.replace(/\([^()]*\)/g, (group) => (measure(group, font).width <= maxW ? group.replace(/ /g, JOIN) : group));
  const spaced: TextMeasurer = (t, f) => measure(t.replaceAll(JOIN, ' '), f);
  const wrap = (w: number) => {
    const r = wrapText(joined, font, w, maxLines, spaced);
    return { ...r, lines: r.lines.map((line) => line.replaceAll(JOIN, ' ')) };
  };
  const first = wrap(maxW);
  if (first.truncated || first.lines.length < 2) return first;
  let lo = 0;
  let hi = maxW;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    const r = wrap(mid);
    if (!r.truncated && r.lines.length === first.lines.length) hi = mid;
    else lo = mid;
  }
  return wrap(hi);
}

const width = (lines: string[], font: FontSpec, measure: TextMeasurer) => Math.max(0, ...lines.map((l) => measure(l, font).width));

/** The header runs: the group, then the date. */
function headerRuns(ev: LaneEvent): { text: string; weight?: number }[] {
  const runs: { text: string; weight?: number }[] = [];
  if (ev.group) runs.push({ text: ev.group });
  if (ev.date) runs.push({ text: ev.group ? ` · ${ev.date}` : ev.date });
  return runs;
}

function measureHeader(ev: LaneEvent, f: Fonts, measure: TextMeasurer): number {
  const runs = headerRuns(ev);
  if (runs.length === 0) return 0;
  return (ev.glyph ? 11 * f.glyphS : 0) + runs.reduce((w, r) => w + measure(r.text, r.weight ? f.noteBold : f.note).width, 0);
}

/** Title at most two lines, detail at most three, both never cut; null when the block cannot be set inline. */
function measureBlock(ev: LaneEvent, maxW: number, f: Fonts, measure: TextMeasurer): Block | null {
  const title: string[] = [];
  for (const line of shownTitle(ev).split('\n')) {
    const r = balancedWrap(line, f.title, maxW, 2 - title.length, measure);
    if (r.truncated) return null;
    title.push(...r.lines);
  }
  const detail: string[] = [];
  for (const line of ev.detail) {
    const r = balancedWrap(line, f.note, maxW, 3 - detail.length, measure);
    if (r.truncated) return null;
    detail.push(...r.lines);
  }
  const headerW = measureHeader(ev, f, measure);
  const lead = headerW === 0 && ev.glyph ? 11 * f.glyphS : 0;
  const titleW = width(title, f.title, measure) + lead;
  const detailW = width(detail, f.note, measure);
  return {
    ev, headerW, lead, title, titleW, detail, detailW,
    w: Math.ceil(Math.max(headerW, titleW, detailW)),
    h: (headerW > 0 ? f.noteLH : 0) + title.length * f.titleLH + detail.length * f.noteLH,
  };
}

/**
 * A continuous x axis (line xAxis): an event's date and end read as x
 * values, the visible range, and the texts of an x. The lane then keeps the
 * x itself as an event's position, and the axis maps it to pixels.
 */
export interface LaneScale {
  /** The x of a date or end text; an end that names a day only ends with that day. Refuses text it cannot read. */
  read: (text: string, path: string, end: boolean) => number;
  lo: number;
  hi: number;
  /** The header date of an event block and the key. */
  short: (x: number) => string;
  /** The full time, for the reading. */
  full: (x: number) => string;
}

/** Where the chart puts its categories: pole x per category and x of a time position. */
interface LaneAxis {
  /** Pole x of a position: a category index, or on a continuous axis an x value. */
  x: (ci: number) => number;
  step: number;
  plot: Rect;
  /** A continuous axis: positions are x values, and `x` places them exactly. */
  continuous?: boolean;
}

function xAt(axis: LaneAxis, pos: number, count: number): number {
  const ci = Math.min(count - 1, Math.max(0, Math.floor(pos)));
  const x = axis.continuous ? axis.x(pos) : axis.x(ci) + (pos - ci - 0.5) * axis.step;
  return Math.min(axis.plot.x + axis.plot.w, Math.max(axis.plot.x, x));
}

/** Text starts this far from its pole. */
const TEXT_GAP = 4;
/** Horizontal air between blocks in one row. */
const GUTTER = 14;
const ROW_GAP = 6;
const TRACK = 6;

interface Placed { block: Block; row: number; side: 'right' | 'left' }

interface LanePlan {
  events: LaneEvent[];
  count: number;
  rows: number;
  rowH: number;
  placed: Placed[];
  /** Numbered markers with key entries, in time order. */
  keyed: LaneEvent[];
  /** Under `footnotes: false`: the events that needed the key, left off the canvas. */
  keyOff: LaneEvent[];
  inline: Block[];
  trackOf: Map<Id, number>;
  tracks: number;
  height: number;
  fonts: Fonts;
}

function extent(p: { block: Block; side: 'right' | 'left' }, x: number): [number, number] {
  return p.side === 'right' ? [x - 1, x + TEXT_GAP + p.block.w] : [x - TEXT_GAP - p.block.w, x + 1];
}

/**
 * Pack blocks by priority, then time: rows nearest the plot first, right of
 * the pole, then left. A block stays inside its bounds, keeps a gutter to its
 * row, its pole crosses no block below it, and it covers no pole above it.
 * A second event on a category, and every block that fits nowhere, goes to
 * the key. With no key (`footnotes: false`) such an event is left off: a
 * numbered marker would point at a key that is not there.
 */
function planLane(events: LaneEvent[], axis: LaneAxis, count: number, rows: number, bounds: [number, number], f: Fonts, measure: TextMeasurer, noKey = false): LanePlan {
  const maxW = Math.min(230, axis.plot.w / 3.6);
  const placed: Placed[] = [];
  const keyed: LaneEvent[] = [];
  const inline: Block[] = [];
  const poleAt = new Set<number>();
  const order = [...events].sort((a, b) => b.priority - a.priority || byTime(a, b));
  const clashes = (others: Placed[], { block, row, side }: Placed): boolean => {
    const x = axis.x(block.ev.ci);
    const [x0, x1] = extent({ block, side }, x);
    if (x0 < bounds[0] || x1 > bounds[1]) return true;
    return others.some((p) => {
      const px = axis.x(p.block.ev.ci);
      const [p0, p1] = extent(p, px);
      if (p.row === row) return x0 < p1 + GUTTER && x1 + GUTTER > p0;
      if (p.row > row) return px > x0 - 6 && px < x1 + 6;
      return x > p0 - 6 && x < p1 + 6;
    });
  };
  const slot = (others: Placed[], block: Block): Placed | undefined => {
    for (let row = 0; row < rows; row++) {
      for (const side of ['right', 'left'] as const) if (!clashes(others, { block, row, side })) return { block, row, side };
    }
    return undefined;
  };
  for (const ev of order) {
    const block = ev.placement === 'key' || (ev.placement === 'auto' && (rows === 0 || poleAt.has(ev.ci))) ? null : measureBlock(ev, maxW, f, measure);
    if (block && ev.placement === 'inline') {
      inline.push(block);
      continue;
    }
    let spot = block ? slot(placed, block) : undefined;
    // A block that fits nowhere may fit once one placed block turns to the other side of its pole.
    // ponytail: one turn only; a full search over sides would find more fits at a combinatorial cost.
    for (const [i, p] of placed.entries()) {
      if (!block || spot) break;
      const turned: Placed = { ...p, side: p.side === 'right' ? 'left' : 'right' };
      const others = placed.filter((_, j) => j !== i);
      if (clashes(others, turned)) continue;
      spot = slot([...others, turned], block);
      if (spot) placed[i] = turned;
    }
    if (spot) {
      placed.push(spot);
      poleAt.add(ev.ci);
    } else keyed.push(ev);
  }
  keyed.sort(byTime);
  const keyOff = noKey ? keyed.splice(0) : [];
  const drawn = noKey ? events.filter((ev) => !keyOff.includes(ev)) : events;
  // Period bars: stacked tracks, earliest first, a new track where one overlaps.
  const trackEnds: number[] = [];
  const trackOf = new Map<Id, number>();
  for (const ev of [...drawn].filter((e) => e.period).sort(byTime)) {
    const x0 = xAt(axis, ev.period!.from, count);
    let t = trackEnds.findIndex((end) => end + 3 < x0);
    if (t < 0) t = trackEnds.push(0) - 1;
    trackEnds[t] = xAt(axis, ev.period!.to, count);
    trackOf.set(ev.id, t);
  }
  const usedRows = placed.length ? maxOf(placed.map((p) => p.row)) + 1 : 0;
  const rowH = Math.max(0, maxOf(placed.map((p) => p.block.h)));
  const tracks = trackEnds.length;
  const markers = keyed.length > 0;
  const height = usedRows * (rowH + ROW_GAP) + (tracks ? tracks * TRACK + 2 : 0) + (markers ? 2 * f.ringR + 5 : 0);
  return { events: drawn, count, rows: usedRows, rowH, placed, keyed, keyOff, inline, trackOf, tracks, height: height > 0 ? height + 2 : 0, fonts: f };
}

/** The key entries: the numbered events in time order. */
function keyInput(plan: LanePlan, form: { detail: boolean; group: boolean; dates: boolean; dense: boolean }, title?: string): EventKeyInput | undefined {
  const { detail, group, dates, dense } = form;
  if (plan.keyed.length === 0) return undefined;
  return {
    entries: plan.keyed.map((ev, i) => ({
      id: ev.id,
      n: i + 1,
      paint: ev.paint,
      ...(dates && ev.date ? { date: ev.date } : {}),
      ...(group && ev.group ? { group: ev.group, ...(ev.glyph ? { glyph: ev.glyph } : {}) } : {}),
      title: plainTitle(ev),
      reading: eventReading(ev.reading),
      ...(detail && ev.detail.length ? { detail: ev.detail.join(' · ') } : {}),
    })),
    ...(dense ? { dense } : {}),
    ...(title ? { title } : {}),
  };
}

/** The plot band left under the lane keeps at least this share of the canvas height, or a lane row gives way. */
const LANE_PLOT_FLOOR = 0.4;
/** A plot under this height is a strip: the lane gives up its text blocks, then the key its dates (the compact plot floor of core/sizing). */
const COMPACT_PLOT_FLOOR = 80;
/** The floor a frame band with a key is held to (the demoted floor: legend or notes of two lines and more). */
const KEY_BAND_FLOOR = 0.5;

export interface SettledLane<F, A> {
  framed: F;
  area: A;
  lane?: { plan: LanePlan; top: number };
}

/**
 * Size the lane and the key with the chart's own frame and plot functions.
 * The first frame and plot give the category positions; the key changes the
 * frame height only, so the positions hold in every later pass. Rows follow
 * the width class unless authored; a row gives way while the plot band left
 * under the lane keeps less than 40% of the canvas height (0 rows draws
 * markers only), and while a key pushes the frame band under the key-band
 * floor the key drops its detail, then its kind labels. Compact mode draws
 * markers and a titles-only key.
 */
export interface LaneSettleInput<F, A> {
  annotations: readonly Annotation[];
  categories: readonly { id: Id; date?: string }[];
  events?: EventOptions;
  language?: string;
  colorblindSafe?: boolean;
  /** Line charts honour `labelPlacement: 'inline'`. */
  inline: boolean;
  /** `footnotes: false`: no event key, and the events that needed it are left off. */
  footnotesOff?: boolean;
  /** A continuous x axis; its axis function then sets `continuous`. */
  scale?: LaneScale;
  theme: Theme;
  measure: TextMeasurer;
  size: Size;
  compact: boolean;
  solve: (key: FrameBand | undefined, warnings: LintWarning[]) => F;
  area: (framed: F, warnings: LintWarning[]) => A;
  axis: (area: A) => LaneAxis;
  warnings: LintWarning[];
}

export function settleEventLane<F extends { frame: FrameResult }, A>(input: LaneSettleInput<F, A>): SettledLane<F, A> {
  const s = { ...input, events: resolveEvents(input), count: input.categories.length, options: input.events };
  if (s.events.length === 0) {
    const framed = s.solve(undefined, s.warnings);
    return { framed, area: s.area(framed, s.warnings) };
  }
  const f = eventFonts(s.theme);
  const firstWarnings: LintWarning[] = [];
  const first = s.solve(undefined, firstWarnings);
  const axis = s.axis(s.area(first, []));
  const band = first.frame.plot;
  const bounds: [number, number] = [Math.max(band.x, axis.plot.x - 20), Math.min(band.x + band.w, axis.plot.x + axis.plot.w + 20)];
  // The compact form: one row of numbered markers, a key of "n date title" packed into few lines.
  const lean = s.compact;
  let rows: number = s.compact ? 0 : s.options?.rows ?? { S: 1, M: 1, L: 2 }[typeWidthClass(s.size.width)];
  let detail = !s.compact;
  let group = !s.compact;
  let dates = true;
  let plan: LanePlan;
  let framed = first;
  let frameWarnings: LintWarning[];
  const dropped: string[] = [];
  const compacted: string[] = [];
  // The plot band the full key leaves, measured before the key drops a part.
  let fullBand: number | undefined;
  for (;;) {
    plan = planLane(s.events, axis, s.count, rows, bounds, f, s.measure, s.footnotesOff === true);
    const key = keyInput(plan, { detail, group, dates, dense: lean }, s.options?.keyTitle);
    frameWarnings = key ? [] : firstWarnings;
    // The key row explains the event colours and brackets whether or not the key keeps its detail lines.
    framed = key ? s.solve(eventKeyBand(key, s.theme, s.measure, group ? [] : eventLegendItems(plan.keyed, s.language), lean), frameWarnings) : first;
    const bandH = framed.frame.plot.h;
    if (plan.rows > 0 && bandH - plan.height < LANE_PLOT_FLOOR * s.size.height) {
      rows = plan.rows - 1;
      continue;
    }
    if (key && bandH < KEY_BAND_FLOOR * s.size.height) {
      const drop = detail && key.entries.some((entry) => entry.detail) ? 'detail lines'
        : group && key.entries.some((entry) => entry.group) ? 'kind labels' : undefined;
      if (drop) {
        fullBand ??= bandH;
        if (drop === 'detail lines') detail = false;
        else group = false;
        dropped.push(drop);
        continue;
      }
    }
    // The compact form may not leave the plot under its floor: its key then shortens to "n title". Full mode keeps its own ladder
    // (rows, detail, kind labels): its size floor is measured with the full lane, and a pinned canvas that lacks room draws compact.
    const shiftedOf = (): F => (plan.height > 0
      ? { ...framed, frame: { ...framed.frame, plot: { ...framed.frame.plot, y: framed.frame.plot.y + plan.height, h: framed.frame.plot.h - plan.height } } }
      : framed);
    if (s.axis(s.area(shiftedOf(), [])).plot.h < COMPACT_PLOT_FLOOR) {
      if (key && dates && key.entries.some((entry) => entry.date)) {
        dates = false;
        compacted.push('dates');
        continue;
      }
    }
    break;
  }
  if (compacted.length) {
    s.warnings.push({
      code: 'event-lane-compact',
      severity: 'info',
      message: `the compact event key left out its ${compacted.join(' and ')}: with them the plot would fall under ${COMPACT_PLOT_FLOOR}px. Every event stays whole in the SVG title and description, the interaction records and the hover card`,
      suggest: 'draw the chart taller, or set fewer events',
    });
  }
  if (dropped.length) {
    s.warnings.push({
      code: 'event-key-detail-omitted',
      severity: 'info',
      message: `the event key left out its ${dropped.join(' and ')}: with them the plot band fell under ${KEY_BAND_FLOOR * 100}% of the canvas height. The full date, title and detail of every event stay in the SVG title and description, the interaction records and the hover card`,
      suggest: 'draw the chart taller, or set fewer events',
    });
  }
  if (plan.keyOff.length) {
    // Listed where the frame lists the notes it left off, in the one footnotes-off lint.
    const left = plan.keyOff.map((ev) => [ev.date, plainTitle(ev), ...ev.detail].filter(Boolean).join(' · ')).join(' | ');
    const off = frameWarnings.find((warning) => warning.code === 'footnotes-off');
    if (off) off.message = `${off.message} | ${left}`;
    else frameWarnings.push({ code: 'footnotes-off', severity: 'info', message: `footnotes: false left these notes off: ${left}` });
  }
  pushAll(s.warnings, frameWarnings);
  const top = framed.frame.plot.y;
  const shifted: F = plan.height > 0
    ? { ...framed, frame: { ...framed.frame, plot: { ...framed.frame.plot, y: top + plan.height, h: framed.frame.plot.h - plan.height } } }
    : framed;
  // An automatic height grows to the canvas whose plot band holds the full key at its floor; the frame around the band keeps its height.
  if (fullBand !== undefined) recordPartNeed(framed.frame.frame, Math.ceil((s.size.height - fullBand) / (1 - KEY_BAND_FLOOR) - 1e-6));
  return { framed: shifted, area: s.area(shifted, s.warnings), lane: { plan, top } };
}

export interface EmittedLane {
  /** Drawn on top of the chart. */
  nodes: SceneNode[];
  /** Line charts: the dotted rules, drawn behind the marks and above the gridlines. */
  behind: SceneNode[];
  labels: PlacedLabel[];
  placed: PlacedAnnotation[];
  warnings: LintWarning[];
}

/**
 * Draw the packed lane once the data, its labels and the other annotations
 * are on the canvas. Poles stop 3px above the first mark or label below the
 * lane ('stop': column, combo, area) or run on as dotted hairlines behind the
 * data to the baseline ('through': line). Every line of text and every
 * marker number is a label request with one fixed slot; an event whose text
 * or number is hidden draws neither its pole nor its marker.
 */
export function emitEventLane(theme: Theme, input: {
  plan: LanePlan;
  top: number;
  axis: LaneAxis;
  mode: 'stop' | 'through';
  baseline: number;
  occupied: OccupiedIndex;
  solveCtx: SolveCtx;
}): EmittedLane {
  const { plan, top, axis, occupied } = input;
  const f = plan.fonts;
  const laneBottom = top + plan.height;
  const rowTop = (row: number) => top + (plan.rows - 1 - row) * (plan.rowH + ROW_GAP);
  const tracksTop = top + plan.rows * (plan.rowH + ROW_GAP);
  const stripY = tracksTop + (plan.tracks ? plan.tracks * TRACK + 2 : 0) + f.ringR + 1;
  // Where a pole stops: 3px above the first mark or label under the lane.
  const stopAt = (x: number): number => {
    if (input.mode === 'through') return laneBottom;
    const hits = occupied.hitsWhich({ x: x - 1, y: laneBottom, w: 2, h: Math.max(0, input.baseline - laneBottom) })
      .filter((o) => o.kind === 'mark' || o.kind === 'label');
    return Math.min(input.baseline, minOf(hits.map((o) => o.rect.y))) - 3;
  };
  const requests: LabelRequest[] = [];
  const fixed = (id: string, evId: Id, text: string, lines: string[], font: FontSpec, rect: Rect, slot: string, role: 'note' | 'value' = 'note') =>
    requests.push({ id, kind: 'annotation', owner: { annotationId: evId }, text, lines, typeRole: font === f.num ? 'micro' : font === f.title ? 'axis' : 'footnote', font, priority: PRIORITY.valueLine, pad: 0, candidates: [{ slot, rect, penalty: 0 }], role });
  for (const p of plan.placed) {
    const slot = `lane-${p.row}-${p.side}`;
    for (const line of blockLines(p.block, axis.x(p.block.ev.ci), rowTop(p.row), p.side, f)) {
      fixed(line.id, p.block.ev.id, line.text, line.lines, line.font, line.rect, slot);
    }
  }
  // The keyed events' markers: side by side on their category's pole.
  const number = new Map(plan.keyed.map((ev, i) => [ev.id, i + 1] as const));
  const byCat = new Map<number, LaneEvent[]>();
  for (const ev of plan.keyed) byCat.set(ev.ci, [...(byCat.get(ev.ci) ?? []), ev]);
  const markerAt = new Map<Id, number>();
  for (const [ci, list] of byCat) {
    list.forEach((ev, k) => {
      // Markers of one category stand apart by a clear gap, never ring on ring.
      const cx = axis.x(ci) + (k - (list.length - 1) / 2) * (2 * f.ringR + MARKER_GAP);
      markerAt.set(ev.id, cx);
      const text = String(number.get(ev.id));
      const w = input.solveCtx.measure(text, f.num).width;
      fixed(`event:${ev.id}`, ev.id, `${text} — ${plainTitle(ev)}`, [text], f.num,
        { x: cx - w / 2, y: stripY - f.ringR + 1.5, w, h: 2 * f.ringR - 3 }, 'marker', 'value');
    });
  }
  // Inline blocks (line): beside the rule inside the plot, on a halo; one request per block.
  for (const block of plan.inline) {
    const x = axis.x(block.ev.ci);
    const candidates: LabelRequest['candidates'] = [];
    [0.28, 0.5, 0.72].forEach((fraction, row) => {
      const y = axis.plot.y + axis.plot.h * fraction - block.h / 2;
      for (const side of ['right', 'left'] as const) {
        const rect = { x: side === 'right' ? x + TEXT_GAP : x - TEXT_GAP - block.w, y, w: block.w, h: block.h };
        if (rect.x >= axis.plot.x && rect.x + rect.w <= axis.plot.x + axis.plot.w) {
          candidates.push({ slot: `inline-${side}-${row}`, rect, penalty: row + (side === 'left' ? 0.5 : 0), needsBacking: true });
        }
      }
    });
    requests.push({ id: `event:${block.ev.id}`, kind: 'annotation', owner: { annotationId: block.ev.id }, text: shownTitle(block.ev),
      lines: [...block.title, ...block.detail], typeRole: 'axis', font: f.title, priority: PRIORITY.valueLine, candidates, role: 'note' });
  }
  const solved = solveLabels(requests, occupied, input.solveCtx);
  const labelById = new Map(solved.placed.map((l) => [l.id, l] as const));
  const shown = (id: string) => { const l = labelById.get(id); return l !== undefined && l.hidden === undefined; };

  const nodes: SceneNode[] = [];
  const behind: SceneNode[] = [];
  const nodeIds = new Map<Id, Id[]>();
  // Every event in full, on the title line and on the marker; and where its mark is, for the hover card.
  const readingOf = new Map(plan.events.map((ev) => [ev.id, eventReading(ev.reading)] as const));
  const anchorOf = new Map<Id, Rect>();
  const anchorAdd = (evId: Id, rect: Rect) => {
    const known = anchorOf.get(evId);
    anchorOf.set(evId, known ? { x: Math.min(known.x, rect.x), y: Math.min(known.y, rect.y), w: Math.max(known.x + known.w, rect.x + rect.w) - Math.min(known.x, rect.x), h: Math.max(known.y + known.h, rect.y + rect.h) - Math.min(known.y, rect.y) } : rect);
  };
  const own = (evId: Id, node: SceneNode, back = false) => {
    (back ? behind : nodes).push(node);
    nodeIds.set(evId, [...(nodeIds.get(evId) ?? []), node.id]);
  };
  const pole = (ev: LaneEvent, x: number, y1: number) => {
    const owner = { annotationId: ev.id };
    const y2 = stopAt(x);
    if (y2 > y1) {
      own(ev.id, { t: 'line', id: `ann:${ev.id}:pole`, x1: x, y1, x2: x, y2, stroke: { token: 'leader' }, width: strokeToken(theme, 'rule'), owner, part: 'eventPole' });
      occupied.claim({ x: x - 1, y: y1, w: 2, h: y2 - y1 }, 'annotation', owner, 'eventPole');
    }
    if (input.mode === 'through' && input.baseline > laneBottom) {
      own(ev.id, { t: 'line', id: `ann:${ev.id}:rule`, x1: x, y1: laneBottom, x2: x, y2: input.baseline, stroke: { token: 'leader' }, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'dotted'), lineCap: 'round' as const, owner, part: 'eventRule' }, true);
    }
  };
  const text = (evId: Id, id: string, line: BlockLine, halo: boolean) => {
    const owner = { annotationId: evId };
    // The glyph leads its line, header or title, on either side of the pole.
    const gs = line.glyph ? 11 * f.glyphS : 0;
    if (line.glyph) {
      own(evId, eventGlyphNode(line.glyph.glyph!, line.rect.x + 3.6 * f.glyphS, line.rect.y + line.font.size * (EVENT_TEXT_ASCENT - 0.35), f.glyphS, line.glyph.paint, `ann:${evId}:glyph`, owner, 'eventGlyph'));
    }
    const ev = line.header;
    anchorAdd(evId, line.rect);
    if (!ev) {
      // The title line speaks for the whole event: its full reading, and the one keyboard stop of the block.
      const whole = line.id === `event:${evId}` ? { title: readingOf.get(evId)!, focusStop: true as const } : {};
      own(evId, { t: 'text', id, x: line.align === 'start' ? line.x + gs : line.x, y: line.rect.y, lines: line.lines, align: line.align, typeRole: line.font === f.title ? 'axis' : 'footnote', font: line.font, ink: line.ink, ...whole, ...(halo ? { halo } : {}), owner, part: 'annotation', role: 'note' });
      return;
    }
    const runs = headerRuns(ev);
    own(evId, { t: 'text', id, x: line.align === 'start' ? line.x + gs : line.x, y: line.rect.y, lines: [runs.map((r) => r.text).join('')], runs,
      align: line.align, typeRole: 'footnote', font: f.note, ink: line.ink, ...(halo ? { halo } : {}), owner, part: 'annotation', role: 'note' });
  };

  // Blocks in the lane: poles first, then the lines the solver kept.
  const polesAt = new Set<number>();
  for (const p of plan.placed) {
    const ev = p.block.ev;
    if (!shown(`event:${ev.id}`)) continue;
    polesAt.add(ev.ci);
    const x = axis.x(ev.ci);
    pole(ev, x, rowTop(p.row) + 1);
    for (const line of blockLines(p.block, x, rowTop(p.row), p.side, f)) {
      const label = labelById.get(line.id)!;
      if (label.hidden) continue;
      label.nodeId = `label:${line.id}`;
      text(ev.id, label.nodeId, line, false);
    }
  }
  // Markers: one pole per category, unless a block already drew it. Rings set
  // side by side flank the pole, so a tie under them, centre to centre, carries
  // them onto it; the pole leaves from the tie's midpoint, the category x.
  for (const [ci, list] of byCat) {
    const visible = list.filter((ev) => shown(`event:${ev.id}`));
    if (visible.length === 0) continue;
    const x = axis.x(ci);
    const tieY = stripY + f.ringR;
    const centres = visible.map((ev) => markerAt.get(ev.id)!);
    const [x0, x1] = [Math.min(x, minOf(centres)), Math.max(x, maxOf(centres))];
    if (x1 - x0 > 0.5) {
      const owner = { annotationId: visible[0]!.id };
      own(visible[0]!.id, { t: 'line', id: `ann:${visible[0]!.id}:tie`, x1: x0, y1: tieY, x2: x1, y2: tieY, stroke: { token: 'leader' }, width: strokeToken(theme, 'rule'), owner, part: 'eventPole' });
      occupied.claim({ x: x0, y: tieY - 1, w: x1 - x0, h: 2 }, 'annotation', owner, 'eventPole');
    }
    if (!polesAt.has(ci)) pole(visible[0]!, x, tieY);
    for (const ev of visible) {
      const cx = markerAt.get(ev.id)!;
      const owner = { annotationId: ev.id };
      own(ev.id, eventRingNode(theme, cx, stripY, f.ringR, ev.paint, `ann:${ev.id}:marker`, owner, 'eventMarker', readingOf.get(ev.id), true));
      anchorAdd(ev.id, { x: cx - f.ringR, y: stripY - f.ringR, w: 2 * f.ringR, h: 2 * f.ringR });
      occupied.claim({ x: cx - f.ringR, y: stripY - f.ringR, w: 2 * f.ringR, h: 2 * f.ringR }, 'annotation', owner, 'eventMarker');
      const label = labelById.get(`event:${ev.id}`)!;
      label.nodeId = `label:${label.id}`;
      own(ev.id, { t: 'text', id: label.nodeId, x: cx, y: stripY - 0.53 * f.num.size, lines: label.lines, align: 'middle', typeRole: 'micro', font: f.num, ink: { token: 'ink' }, owner, part: 'annotation', role: 'value' });
    }
  }
  // Inline blocks: drawn from their one placed label, on the side of its slot.
  for (const block of plan.inline) {
    const ev = block.ev;
    const label = labelById.get(`event:${ev.id}`)!;
    if (label.hidden) continue;
    const side = label.slot.includes('left') ? 'left' : 'right';
    const x = axis.x(ev.ci);
    pole(ev, x, laneBottom);
    for (const line of blockLines(block, x, label.rect.y, side, f)) {
      const id = line.id === label.id ? `label:${label.id}` : `label:${line.id}`;
      if (line.id === label.id) label.nodeId = id;
      text(ev.id, id, line, true);
    }
  }
  // Period bars: 2px in the tone, a small tick at each end the chart shows.
  for (const ev of plan.events) {
    const t = plan.trackOf.get(ev.id);
    if (t === undefined) continue;
    const owner = { annotationId: ev.id };
    const y = tracksTop + t * TRACK + 3;
    const x0 = xAt(axis, ev.period!.from, plan.count);
    const x1 = xAt(axis, ev.period!.to, plan.count);
    own(ev.id, { t: 'line', id: `ann:${ev.id}:period`, x1: x0, y1: y, x2: x1, y2: y, stroke: ev.paint, width: strokeToken(theme, 'rule'), owner, part: 'eventPeriod' });
    own(ev.id, { t: 'line', id: `ann:${ev.id}:period:start`, x1: x0, y1: y - 3, x2: x0, y2: y + 3, stroke: ev.paint, width: strokeToken(theme, 'rule'), owner, part: 'eventPeriod' });
    if (!ev.period!.open) own(ev.id, { t: 'line', id: `ann:${ev.id}:period:end`, x1: x1, y1: y - 3, x2: x1, y2: y + 3, stroke: ev.paint, width: strokeToken(theme, 'rule'), owner, part: 'eventPeriod' });
    occupied.claim({ x: x0, y: y - 3, w: Math.max(1, x1 - x0), h: 6 }, 'annotation', owner, 'eventPeriod');
  }
  const placed: PlacedAnnotation[] = [...plan.events].sort(byTime).map((ev) => {
    const n = number.get(ev.id);
    return {
      id: ev.id,
      kind: 'event',
      computedText: n === undefined ? shownTitle(ev) : `${n} — ${plainTitle(ev)}`,
      nodeIds: nodeIds.get(ev.id) ?? [],
      event: { ...ev.reading, ...(anchorOf.has(ev.id) ? { anchor: anchorOf.get(ev.id)! } : {}) },
      labelId: `event:${ev.id}`,
      derivation: { basis: 'authored', op: 'annotation-event@1', inputs: [], raw: null },
    };
  });
  return { nodes, behind, labels: solved.placed, placed, warnings: solved.warnings };
}

interface BlockLine {
  id: string;
  text: string;
  lines: string[];
  font: FontSpec;
  ink: Paint;
  /** Where the text anchors: beside the pole. */
  x: number;
  align: 'start' | 'end';
  rect: Rect;
  /** Set on the header line, which draws the group and date runs. */
  header?: LaneEvent;
  /** The event whose glyph leads this line. */
  glyph?: LaneEvent;
}

/** A block's lines, stacked from its top on the pole side: header, title, detail. */
function blockLines(block: Block, pole: number, top: number, side: 'right' | 'left', f: Fonts): BlockLine[] {
  const x = side === 'right' ? pole + TEXT_GAP : pole - TEXT_GAP;
  const align = side === 'right' ? 'start' : 'end';
  const rect = (y: number, w: number, h: number): Rect => ({ x: side === 'right' ? x : x - w, y, w, h });
  const ev = block.ev;
  const out: BlockLine[] = [];
  let y = top;
  if (block.headerW > 0) {
    const header = headerRuns(ev).map((r) => r.text).join('');
    out.push({ id: `event:${ev.id}:header`, text: header, lines: [header], font: f.note, ink: { token: 'inkMuted' }, x, align, rect: rect(y, block.headerW, f.noteLH), header: ev, ...(ev.glyph ? { glyph: ev } : {}) });
    y += f.noteLH;
  }
  out.push({ id: `event:${ev.id}`, text: shownTitle(ev), lines: block.title, font: f.title, ink: { token: 'ink' }, x, align, rect: rect(y, block.titleW, block.title.length * f.titleLH), ...(block.lead ? { glyph: ev } : {}) });
  y += block.title.length * f.titleLH;
  if (block.detail.length) {
    out.push({ id: `event:${ev.id}:detail`, text: block.detail.join(' '), lines: block.detail, font: f.note, ink: { token: 'inkMuted' }, x, align, rect: rect(y, block.detailW, block.detail.length * f.noteLH) });
  }
  return out;
}
