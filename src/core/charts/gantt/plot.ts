import { chartString } from '../../strings/gantt';
/**
 * Gantt phase 1, second half: the frame, the vertical band (marker
 * strip, two header tiers, rows) and the horizontal body (left label band,
 * metadata columns, timeline scale, milestone lane). The frame is solved
 * here, before the scale, because the plot rect comes out of it.
 */

import { spread1DResult } from '../../collide';
import { frameTextOptions, hiddenNoteWith, normalizeLegendOption, solveFrame, type FrameInput, type FrameResult, type LegendItemInput, numberedFootnotesWith } from '../../frame';
import { SWATCH_RESERVE } from '../../label/emit';
import { separationStroke } from '../../markVisibility';
import { fitText } from '../../label/fitText';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import type { FontSpec, TextMeasurer } from '../../text';
import { strokeToken, canvasMargin, surfaceFloorPaint } from '../../theme';
import type { RenderTarget } from '../../types/options';
import type { Id } from '../../types/cell';
import type { GanttCell } from '../../types/data';
import type { LintWarning, Paint } from '../../types/scene';
import { GANTT_ROW_PITCH, MAX_COLS } from './domain';
import { barSurfaces, cadenceRowPaint, milestonePaints } from './marks';
import { badgeStrip } from './events';
import { laneTop, NO_LANE, ROW_TEXT_PITCH, RULE_LABEL_GAP, type GanttBand, type GanttBody, type GanttDomain, type GanttEnv, type GanttPaints, type MetadataColumns, type NormItem, type NormRow, type RowLabel } from './model';
import { maxOf, minOf } from '../../arrays';

/** The palest tint a wash swatch in the key takes, so a 12 px swatch reads as filled. */
const KEY_WASH_TINT = 0.8;

const INDENT_PX = 12;
/** A stacked row's lane pitch: its bars are 18 px at the default band fraction. */
const STACKED_LANE_PITCH = 30;
/** A stacked row's name line: its text and this much air (a 46 px row of name and bar). */
const STACKED_NAME_AIR = 2;
/** The narrowest stacked lane a fixed height may squeeze a row to (layout.ts minimumRowsH). */
export const STACKED_LANE_FLOOR = 22;
/** The stacked form is chosen when the table form leaves the timeline less than this share of the plot. */
const STACKED_TIMELINE_SHARE = 0.5;

/** One metadata cell on a stacked name line: the drawn line carries the separator ("Operations ·"). */
interface StackedCell { k: number; text: string; tone?: GanttCell['tone']; line: string; w: number }

/** A row's cells on its stacked name line, in column order, with their drawn widths. */
export function stackedCells(env: GanttEnv, row: NormRow): StackedCell[] {
  const cells = row.cols.slice(0, MAX_COLS).map((cell, k) => ({ k, ...cell })).filter((cell) => cell.text);
  return cells.map((cell, i) => {
    const line = i < cells.length - 1 ? `${cell.text} ·` : cell.text;
    return { ...cell, line, w: (cell.tone ? SWATCH_RESERVE : 0) + env.measure(line, env.fonts.label).width };
  });
}

/** The stacked column-header line: the headers of displayed columns, in order, with their drawn widths. */
function stackedHeaders(env: GanttEnv, rows: readonly NormRow[]): { k: number; text: string; line: string; w: number }[] {
  const count = Math.min(MAX_COLS, Math.max(0, maxOf(rows.map((row) => row.cols.length))));
  const headers = Array.from({ length: count }, (_, k) => ({ k, text: env.options.colHeaders?.[k]?.trim() ?? '' }))
    .filter((header) => header.text && rows.some((row) => row.cols[header.k]?.text));
  return headers.map((header, i) => {
    const line = i < headers.length - 1 ? `${header.text} ·` : header.text;
    return { ...header, line, w: env.measure(line, env.fonts.headerMajor).width };
  });
}

/** Gap between a stacked row's name and its cells, and between two cells. */
export function stackedGap(env: GanttEnv): { name: number; cell: number } {
  return { name: 12, cell: env.measure(' ', env.fonts.label).width };
}

/**
 * The stacked form: on the report targets, when the table form would drop a
 * metadata column or leave the timeline less than half the plot, and every
 * row's name and cells fit on one line across the plot. Returns the widest
 * name line, or undefined for the table form.
 */
function stackedLineWidth(env: GanttEnv, domain: GanttDomain, plotW: number): number | undefined {
  const { options, fonts, measure } = env;
  const rows = domain.rows.filter((row) => !row.shared);
  const fontOf = (r: NormRow): FontSpec => (r.indent === 0 ? fonts.strong : fonts.label);
  const gap = stackedGap(env);
  // The sublabel follows the name on its name line, after the name gap.
  const nameW = (r: NormRow) => Math.min(r.indent, 6) * INDENT_PX + measure(r.label.trim().split(/\s+/).join(' '), fontOf(r)).width
    + (r.sublabel ? gap.name + measure(r.sublabel, fonts.label).width : 0);
  const lineW = Math.max(0, maxOf(rows.map((row) => {
    const cells = stackedCells(env, row);
    return nameW(row) + (cells.length ? gap.name + cells.reduce((sum, cell) => sum + cell.w, 0) + (cells.length - 1) * gap.cell : 0);
  })), stackedHeaders(env, domain.rows).reduce((sum, header) => sum + header.w, 0));
  if (lineW > plotW) return undefined;
  const colCap = options.mode === 'compact' ? 30 : 90;
  const columns = planMetadataColumns(domain.rows, options.colHeaders, 0, colCap, 0, 0, fonts.label, fonts.headerMajor, measure, options.target);
  const count = Math.min(MAX_COLS, Math.max(0, maxOf(domain.rows.map((row) => row.cols.length))));
  const tableTimeline = plotW - Math.max(0, maxOf(rows.map(nameW))) - 12
    - columns.colWs.reduce((sum, width) => sum + width, 0) - (columns.colWs.length ? 4 : 0);
  return columns.colWs.length < count || tableTimeline < STACKED_TIMELINE_SHARE * plotW ? lineW : undefined;
}

/**
 * The colour key: when bars and chevrons differ in colour, one entry per
 * colour, named by the first colorLabel its items declare; a bar in the
 * outline's own colour is named Workstream or Task. A colour nobody
 * names gets no entry and an info lint; under legend 'none' no key is drawn.
 */
function colorKey(env: GanttEnv, domain: GanttDomain, paints: GanttPaints, warnings: LintWarning[]): FrameInput['legend'] {
  const byColor = new Map<string, { paint: Paint; first: NormItem; ids: string[]; label?: string; authored?: true }>();
  for (const row of domain.rows) {
    for (const it of row.items) {
      if (it.kind !== 'bar' && it.kind !== 'chevron') continue;
      // A bar in its row's status colour is keyed by the status column.
      if (it.tone && !it.colorRole) continue;
      const paint = paints.item(it);
      const entry = byColor.get(paints.css(paint)) ?? { paint, first: it, ids: [] };
      if (it.colorLabel && !entry.authored) Object.assign(entry, { label: it.colorLabel, authored: true });
      const outline = !it.colorRole && !env.highlights.has(it.id) && !env.highlights.has(it.rowId);
      if (outline) entry.label ??= row.indent === 0 ? chartString(env.options, 'workstream') : chartString(env.options, 'task');
      entry.ids.push(it.id);
      byColor.set(paints.css(paint), entry);
    }
  }
  const entries = [...byColor.values()];
  const legend = env.options.legend;
  if (legend === 'none') return undefined;
  const encodings = encodingKey(env, domain, paints);
  const colourKeyed = entries.length >= 2 && entries.some((entry) => entry.label);
  if (!colourKeyed && encodings.length === 0) return undefined;
  for (const { first, label } of colourKeyed ? entries : []) {
    if (label) continue;
    warnings.push({
      code: 'gantt-color-unnamed',
      severity: 'info',
      message: `the colour of '${first.id}' differs from the other bars and no item of that colour declares a colorLabel, so the colour key cannot name it`,
      owner: { categoryId: first.rowId, segmentId: first.id },
      suggest: 'add colorLabel to one item of that colour, or give the item a named colour',
    });
  }
  // One name on two colours prints two key entries the reader cannot tell
  // apart, so the layout warns.
  const byLabel = new Map<string, string[]>();
  for (const { label, ids } of colourKeyed ? entries : []) if (label) byLabel.set(label, [...byLabel.get(label) ?? [], ...ids]);
  for (const [label, ids] of byLabel) {
    if (entries.filter((entry) => entry.label === label).length < 2) continue;
    warnings.push({
      code: 'gantt-color-label-duplicate',
      severity: 'warn',
      message: `colorLabel '${label}' names ${entries.filter((entry) => entry.label === label).length} different colours, so the colour key shows the same name more than once; items: ${ids.join(', ')}`,
      suggest: 'give items of one colour one colorLabel and a different colorLabel to each other colour, or give these items the same colorRole',
      field: ['data'],
    });
  }
  const options = normalizeLegendOption(legend === undefined || legend === 'auto' ? 'top' : legend);
  // legend.order names item ids: an entry ranks by the earliest of its items' ids there.
  const rank = new Map((options.order ?? []).map((id, i) => [id, i]));
  const rankOf = (ids: string[]) => Math.min(Number.MAX_SAFE_INTEGER, minOf(ids.map((id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER)));
  const outlineRank = (entry: { label?: string; authored?: true }) => (entry.authored ? 2 : entry.label === 'Workstream' ? 0 : 1);
  // A swatch carries the outline its bars take on a tinted row (marks.ts separatedFill).
  const outline = (paint: Paint) => (env.options.rowTint
    ? separationStroke(paints.css(paint), paints.css({ token: 'others', tint: env.surface.rowTint }), env.theme, true)?.stroke : undefined);
  return {
    options,
    items: [
      // legend.order first, then the outline's own colours (Workstream, Task), then the authored ones.
      ...(colourKeyed ? entries.filter((entry) => entry.label).sort((a, b) => rankOf(a.ids) - rankOf(b.ids) || outlineRank(a) - outlineRank(b))
        .map((entry) => {
          // The swatch takes its bars' fill, which separates without an outline (marks.ts barSurfaces).
          const paint = surfaceFloorPaint(entry.paint, barSurfaces(env));
          const stroke = outline(paint);
          // The swatch carries its bars' separation rule, so it takes their edge with them.
          const backing: Paint = env.options.rowTint ? { token: 'others', tint: env.surface.rowTint } : { token: 'background' };
          return { id: entry.first.id, label: entry.label!, paint, ...(stroke ? { stroke } : {}), separation: { fill: paint, backing, surface: true as const, grounds: barSurfaces(env) } };
        }) : []),
      ...encodings,
    ],
  };
}

/**
 * The encodings the chart itself draws, keyed above the plot:
 * the workstream and task colours of an outline without authored colour
 * names, the weekend and elapsed bands. Marks named where they stand (a
 * cadence row's markers, a labelled milestone) need no entry.
 */
function encodingKey(env: GanttEnv, domain: GanttDomain, paints: GanttPaints): LegendItemInput[] {
  const keyed: LegendItemInput[] = [];
  // Diamond cadence markers in one colour are keyed as recurring events; a
  // row name says which cadence each row is, and a triangle's row names it.
  const cadenceRows = domain.rows.filter((row) => row.cadence?.marker === 'diamond');
  const cadencePaints = cadenceRows.map((row) => cadenceRowPaint(env, row));
  if (cadencePaints.length > 0 && new Set(cadencePaints.map((paint) => paints.css(paint))).size === 1) {
    keyed.push({ id: 'key:cadence', label: chartString(env.options, 'recurringEvent'), paint: cadencePaints[0]!, key: 'diamond' });
  }
  // The key uses the exact fill and separating edge resolved for the mark.
  const items = domain.rows.flatMap((row) => row.items);
  for (const row of domain.rows) for (const it of row.items.filter(it => it.kind === 'milestone')) {
    const resolved = milestonePaints(env, paints, row, it);
    const baseId = resolved.backing && paints.css(resolved.stroke.stroke) !== paints.css(resolved.paint)
      ? 'key:milestone-on-bar' : 'key:milestone';
    const id = keyed.some(item => item.id === baseId) ? `${baseId}:${it.id}` : baseId;
    const label = baseId === 'key:milestone-on-bar' ? chartString(env.options, 'milestoneOnBar') : chartString(env.options, 'milestone');
    const same = keyed.find(item => item.label === label && paints.css(item.paint) === paints.css(resolved.paint) &&
      item.stroke && paints.css(item.stroke) === paints.css(resolved.stroke.stroke));
    if (same) continue;
    const existing = keyed.find(item => item.label === label);
    const distinctLabel = existing ? `${label}: ${it.label || row.label || it.id}` : label;
    keyed.push({ id, label: keyed.some(item => item.label === distinctLabel) ? `${distinctLabel} (${it.id})` : distinctLabel, paint: resolved.paint,
      stroke: resolved.stroke.stroke, width: resolved.stroke.strokeWidth, key: 'diamond',
      separation: { fill: resolved.paint, backing: resolved.backing ?? { token: 'background' }, fallback: resolved.fallback } });
  }
  const milestoneKeys = keyed.filter(item => item.id.startsWith('key:milestone'));
  if (milestoneKeys.length === 1) milestoneKeys[0]!.label = chartString(env.options, 'milestone');
  if (items.some((it) => it.kind === 'bracket' && !it.label)) {
    keyed.push({ id: 'key:bracket', label: chartString(env.options, 'overallSpan'), paint: { token: 'markInk' }, key: 'bracket', width: strokeToken(env.theme, 'rule') });
  }
  // A wash at its plot tint vanishes in a 12 px swatch and the key reads as empty: the swatch takes a stronger tint of the same hue.
  if (env.options.weekends && domain.granularity === 'weeks') {
    keyed.push({ id: 'key:weekend', label: chartString(env.options, 'weekend'), paint: { token: 'others', tint: Math.min(env.surface.rowTint, KEY_WASH_TINT) } });
  }
  if (domain.todayDay !== null && env.options.elapsed !== false) {
    keyed.push({ id: 'key:elapsed', label: chartString(env.options, 'elapsedToday'), paint: { token: 'focus', tint: Math.min(env.surface.elapsedTint, KEY_WASH_TINT) } });
  }
  return keyed;
}

/**
 * Stacked: whether a shared milestone's label has no seat beside its diamond
 * (another shared diamond, a today or event rule, or the timeline edge in the
 * way on both sides). Then the shared row gets a label line, as the other rows
 * have, so the label is printed there and not moved to a note.
 */
function sharedLabelsNeedLine(domain: GanttDomain, plot: { x: number; w: number }): boolean {
  const shared = domain.rows.find((row) => row.shared);
  if (!shared) return false;
  const x = (day: number) => plot.x + ((day - domain.d0Day) / (domain.d1Day - domain.d0Day)) * plot.w;
  const rr = 8;
  const blockers = [
    ...shared.items.map((item) => ({ x: x(item.startDay + 0.5), half: rr })),
    ...domain.events.map((event) => ({ x: x(event.ruleDay), half: 6 })),
    ...(domain.todayDay === null ? [] : [{ x: x(domain.todayDay + 0.5), half: 3 }]),
  ];
  // A seat needs the label solver's clearance to a blocker (3 px, as a seat
  // past a rule keeps); a seat closer than that is not free, because the
  // solver would hide the label placed there.
  const clear = 3;
  const free = (from: number, to: number) => from >= plot.x && to <= plot.x + plot.w
    && blockers.every((blocker) => blocker.x + blocker.half + clear <= from || blocker.x - blocker.half - clear >= to);
  return shared.items.some((item) => {
    const entry = domain.milestones.byId.get(item.id);
    if (!entry) return false;
    const cx = x(item.startDay + 0.5);
    return !free(cx + rr + 4, cx + rr + 4 + entry.size.width) && !free(cx - rr - 4 - entry.size.width, cx - rr - 4);
  });
}

/**
 * The frame (title, subtitle, source, footnotes and the colour key measured
 * FIRST; it claims into an index of its own), then the vertical band: marker
 * strip, header (2 tiers), rows.
 */
export function ganttFrame(
  env: GanttEnv,
  domain: GanttDomain,
  paints: GanttPaints,
  warnings: LintWarning[],
  milestoneKey: string[] = [],
  heightOpen = true,
  /** Key entries the frame lists but does not number (the key does not print). */
  listedKey: string[] = [],
  /** The milestone key prints as a numbered disclosure (notes.show lists 'disclosure'). */
  keyDisclosed = false,
): { frame: FrameResult; claims: OccupiedIndex; band: GanttBand } {
  const { size, theme, options, measure, fonts } = env;
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  // Compact framing can omit ordinary notes. Rebuild the shared disclosure
  // from its item metadata so every dropped task or milestone stays named.
  const hidden = hiddenNoteWith({ ...options, notes: { ...options.notes, maxListed: options.notes?.maxListed ?? 'all' } }, []);
  const numbered = numberedFootnotesWith(options, [...domain.eventFootnotes, ...milestoneKey]);
  const frame = solveFrame(
    {
      size,
      margin: { ...canvasMargin(theme, size.width), ...options.margin },
      ...frameTextOptions(options),
      // the event legend's entries are what its badges point at,
      // and they follow the author's own notes.
      footnotes: [...hidden.footnotes, ...hidden.line, ...domain.eventFootnotes, ...milestoneKey, ...listedKey, ...domain.itemLabelNotes],
      numberedFootnotes: numbered,
      numberedDisclosures: keyDisclosed ? milestoneKey.map((_, i) => numbered.length - milestoneKey.length + i + 1) : [],
      pointedNotes: [...frameTextOptions(options).pointedNotes ?? [], ...domain.eventFootnotes, ...milestoneKey],
      legend: colorKey(env, domain, paints, warnings),
      theme,
      measure,
    },
    claims,
  );
  const plot0 = frame.plot;
  const headerRowH = measure('Q1 2026', fonts.headerMajor).height + 6;
  const headerH = 2 * headerRowH;
  const markerLabelH = Math.max(measure(chartString(env.options, 'today'), fonts.strong).height, measure(chartString(env.options, 'eventName'), fonts.tick).height);
  const markerStrip =
    domain.events.length > 0
      ? Math.max(badgeStrip(env, domain), !domain.events.some((event) => !event.badge) ? 0 : domain.eventBadgeMode
        ? markerLabelH + 8
        : 2 * markerLabelH + 8)
      : domain.todayDay !== null
        ? markerLabelH + 6
        : 0;
  const headerTop = plot0.y + markerStrip;
  const lineW = stackedLineWidth(env, domain, plot0.w);
  // A fixed height keeps the table form when the stacked rows, at their floor, would not fit it.
  const stackedFloor = domain.rows.length * STACKED_LANE_FLOOR + domain.rows.filter((row) => !row.shared).length * (measure('Hg', fonts.strong).height + STACKED_NAME_AIR)
    + measure('Hg', fonts.headerMajor).height + 6;
  const stackedLineW = lineW !== undefined && (heightOpen || plot0.h - markerStrip - headerH >= stackedFloor) ? lineW : undefined;
  const stacked = stackedLineW !== undefined;
  const n = domain.rows.length;
  const sharedLine = stacked && sharedLabelsNeedLine(domain, plot0);
  const named = domain.rows.filter((row) => !row.shared || sharedLine).length;
  const nameLineH = stacked ? measure('Hg', fonts.strong).height + STACKED_NAME_AIR : 0;
  const colHeaderH = stacked && stackedHeaders(env, domain.rows).length > 0 ? measure('Hg', fonts.headerMajor).height + 6 : 0;
  const rowsTop = headerTop + headerH + colHeaderH;
  const bodyH = Math.max(10, plot0.y + plot0.h - rowsTop);
  // A milestone cluster can only make a lane taller.
  const lanePitch = stacked ? (domain.milestones.clusterRowH > GANTT_ROW_PITCH ? domain.milestones.clusterRowH : STACKED_LANE_PITCH) : domain.milestones.clusterRowH;
  // A row with stacked milestone flags takes the height its flags need; the others keep the common pitch.
  // A wrapped name with a sublabel can need more than the common pitch: that row grows.
  const textPitch = stacked ? undefined : (env.options as { [ROW_TEXT_PITCH]?: ReadonlyMap<string, number> })[ROW_TEXT_PITCH];
  const pitches = domain.rows.map((row) => Math.max(lanePitch, domain.milestones.flagPitch.get(row.id) ?? 0, textPitch?.get(row.id) ?? 0));
  const extra = pitches.reduce((sum, pitch) => sum + pitch - lanePitch, 0);
  // A short canvas squeezes every row by the same factor.
  const squeeze = Math.min(1, Math.max(6 * n, bodyH - named * nameLineH) / (n * lanePitch + extra));
  const rowH = extra > 0 ? lanePitch * squeeze : Math.min(lanePitch, Math.max(6, (bodyH - named * nameLineH) / n));
  const rowHs = extra > 0 ? pitches.map((pitch) => pitch * squeeze) : pitches.map(() => rowH);
  const rowY = [rowsTop];
  for (let i = 0; i < n; i++) rowY.push(stacked ? rowY[i]! + rowHs[i]! + (domain.rows[i]!.shared && !sharedLine ? 0 : nameLineH) : extra > 0 ? rowY[i]! + rowHs[i]! : rowsTop + (i + 1) * rowH);
  const band: GanttBand = {
    headerRowH, headerH, markerLabelH, markerStrip, headerTop, rowsTop, bodyH, rowH, rowHs, rowsBottom: stacked || extra > 0 ? rowY[n]! : rowsTop + rowH * n,
    rowY, stacked, nameLineH, sharedLine, colHeaderH, stackedLineW: stackedLineW ?? 0, naturalRowsH: n * lanePitch + extra + named * nameLineH,
  };
  return { frame, claims, band };
}

/** The narrowest complete two-line name; a word is never split or cut. The sublabel is one line in the label font. */
function completeRowName(row: NormRow, font: FontSpec, measure: TextMeasurer, subFont: FontSpec): RowLabel {
  const words = row.label.trim().split(/\s+/).filter(Boolean);
  let lines = [words.join(' ')];
  let width = measure(lines[0]!, font).width;
  for (let split = 1; split < words.length; split++) {
    const pair = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
    const needed = Math.max(...pair.map(line => measure(line, font).width));
    if (needed < width) { width = needed; lines = pair; }
  }
  return { lines, w: width, h: (lines.length - 1) * font.size * (font.lineHeight ?? 1.2) + font.size,
    indentPx: Math.min(row.indent, 6) * INDENT_PX, font, baseFont: font,
    ...(row.sublabel ? { sub: { text: row.sublabel, w: measure(row.sublabel, subFont).width, h: subFont.size } } : {}) };
}

function planMetadataColumns(
  rows: readonly NormRow[], headers: readonly string[] | undefined, startX: number,
  cap: number, headerY: number, headerH: number, font: FontSpec, headerFont: FontSpec,
  measure: TextMeasurer, target: RenderTarget | undefined,
): MetadataColumns {
  const count = Math.min(MAX_COLS, Math.max(0, maxOf(rows.map((row) => row.cols.length))));
  // One line per cell: place, then cut with the full text kept for <title>.
  const fitCell = (text: string, cellFont: FontSpec, reserve = 0) => {
    const fitted = fitText(text, cellFont, cap - reserve, 1, measure, { target, typeRole: cellFont === headerFont ? 'axis' : 'label' });
    return { text: fitted.lines[0] ?? '', ...(fitted.title ? { title: fitted.title } : {}) };
  };
  // A toned cell draws its marker before the text: the marker's width is reserved.
  const allTexts: MetadataColumns['colTexts'] = rows.map((row) => row.cols.slice(0, count).map((cell) =>
    cell.tone ? { ...fitCell(cell.text, font, SWATCH_RESERVE), tone: cell.tone } : fitCell(cell.text, font)));
  const allHeaders = Array.from({ length: count }, (_, index) => fitCell(headers?.[index] ?? '', headerFont));
  // A column shows its values in full, or it goes with its
  // header and the note line names each value (row) it held. A one-letter stub
  // with an ellipsis tells the reader nothing.
  const shown = allHeaders.flatMap((header, index) => (header.title === undefined && allTexts.every((row) => row[index]?.title === undefined) ? [index] : []));
  const colTexts = allTexts.map((row) => shown.flatMap((index) => (row[index] ? [row[index]!] : [])));
  const headerCells = shown.map((index) => allHeaders[index]!);
  const dropped: LabelRequest[] = rows.flatMap((row) => row.cols.slice(0, count).flatMap((cell, index) => (shown.includes(index) || !cell.text ? [] : [{
    id: `col:${row.id}:hidden${index}`, kind: 'activity' as const, typeRole: 'label' as const, owner: { categoryId: row.id }, text: cell.text, lines: [cell.text],
    font, priority: PRIORITY.extreme, redundant: true, suppressedAs: 'density' as const, owed: true, noteText: `${cell.text} (${row.label})`, candidates: [],
  }])));
  const headerTexts = headerCells.map((cell) => cell.text);
  const colWs = headerTexts.map((text, index) => Math.max(
    12, measure(text, headerFont).width,
    maxOf(colTexts.map((row) => row[index]?.text ? measure(row[index]!.text, font).width + (row[index]!.tone ? SWATCH_RESERVE : 0) : 0)),
  ) + 10);
  const colXs: number[] = [];
  const headerRequests: LabelRequest[] = [];
  let x = startX;
  headerTexts.forEach((text, index) => {
    colXs.push(x);
    if (text) {
      const size = measure(text, headerFont);
      headerRequests.push({
        id: 'colHeader:' + index, kind: 'activity', owner: {}, text, lines: [text],
        ...(headerCells[index]!.title ? { title: headerCells[index]!.title } : {}),
        font: headerFont, typeRole: 'axis', priority: PRIORITY.total,
        candidates: [{
          slot: 'columnHeader', penalty: 0,
          rect: { x, y: headerY + (headerH - size.height) / 2, w: size.width, h: size.height },
        }],
      });
    }
    x += colWs[index]!;
  });
  return { colTexts, colWs, colXs, headerRequests: [...headerRequests, ...dropped] };
}

/**
 * The stacked form's metadata: every cell in full on its row's name line
 * (labels.ts places them flush right), and one header line above the rows.
 */
function stackedColumns(env: GanttEnv, rows: readonly NormRow[], band: GanttBand, right: number): MetadataColumns {
  const headers = stackedHeaders(env, rows);
  return {
    colTexts: rows.map((row) => stackedCells(env, row).map((cell) => ({ text: cell.text, ...(cell.tone ? { tone: cell.tone } : {}) }))),
    colWs: [],
    colXs: [],
    headerRequests: headers.length === 0 ? [] : stackedHeaderRequests(env, headers, band, right),
  };
}

/** The stacked header line, flush right: one request per header, so each keeps its column's id. */
function stackedHeaderRequests(env: GanttEnv, headers: ReturnType<typeof stackedHeaders>, band: GanttBand, right: number): LabelRequest[] {
  const font = env.fonts.headerMajor;
  const gap = stackedGap(env).cell;
  let x = right;
  return [...headers].reverse().map((header) => {
    x -= header.w;
    const size = env.measure(header.line, font);
    const rect = { x, y: band.rowsTop - band.colHeaderH + (band.colHeaderH - size.height) / 2, w: header.w, h: size.height };
    x -= gap;
    return {
      id: 'colHeader:' + header.k, kind: 'activity' as const, owner: {}, text: header.text, lines: [header.line],
      font, typeRole: 'axis' as const, priority: PRIORITY.total,
      candidates: [{ slot: 'columnHeader', penalty: 0, rect }],
    };
  }).reverse();
}

/** Horizontal layout: row labels (indented) and up to three measured text columns, then the timeline. */
export function ganttBody(
  env: GanttEnv,
  domain: GanttDomain,
  frame: FrameResult,
  band: GanttBand,
  warnings: LintWarning[],
): GanttBody {
  const { fonts, measure } = env;
  const { rows, milestones, d0Day, d1Day } = domain;
  const plot0 = frame.plot;
  const colCap = env.options.mode === 'compact' ? 30 : 90;
  const planColumns = (startX: number) => planMetadataColumns(
    rows, env.options.colHeaders, startX, colCap, band.headerTop, band.headerH, fonts.label, fonts.headerMajor, measure, env.options.target,
  );
  const laneLabelW = milestones.laneLabelW;
  const measuredColumns = planColumns(0).colWs;
  const rowFontOf = (r: NormRow): FontSpec => (r.indent === 0 ? fonts.strong : fonts.label);
  const completeNames = rows.map(row => completeRowName(row, rowFontOf(row), measure, fonts.label));
  // The name band holds the wider of the name and its sublabel, which is never wrapped or cut.
  const bandW = (name: RowLabel) => name.indentPx + Math.max(name.w, name.sub?.w ?? 0);
  const minimumLabelBandW = Math.max(0, maxOf(completeNames.filter((_, i) => !rows[i]!.shared).map(bandW)));
  const minimumTimeline = 80;
  const laneReserve = laneLabelW && env.options.mode !== 'compact' ? 12 + laneLabelW : 0;
  const availableNames = plot0.w - 12 - measuredColumns.reduce((sum, width) => sum + width, 0)
    - (measuredColumns.length ? 4 : 0) - minimumTimeline - laneReserve;
  const naturalNames = Math.max(0, maxOf(rows.filter(row => !row.shared).map(row => Math.min(row.indent, 6) * INDENT_PX
    + Math.max(measure(row.label, rowFontOf(row)).width, row.sublabel ? measure(row.sublabel, fonts.label).width : 0))));
  const nameBudget = Math.max(minimumLabelBandW, Math.min(naturalNames, plot0.w * 0.3, availableNames));
  const rowLabels = band.stacked ? completeNames.map((name, i) => {
    const text = rows[i]!.label.trim().split(/\s+/).join(' ');
    return { ...name, lines: [text], w: measure(text, name.font).width, h: name.font.size };
  }) : completeNames.map((name, i) => {
    const text = rows[i]!.label.trim().split(/\s+/).join(' ');
    const width = measure(text, name.font).width;
    return width + name.indentPx <= nameBudget ? { ...name, lines: [text], w: width, h: name.font.size } : name;
  });
  const labelBandW = Math.max(0, maxOf(rowLabels.filter((_, i) => !rows[i]!.shared).map(bandW)));
  // Stacked: names and cells sit on the rows' name lines, and the timeline takes the full plot width.
  const columns = band.stacked ? stackedColumns(env, rows, band, plot0.x + plot0.w) : planColumns(plot0.x + labelBandW + 12);
  const colCount = columns.colWs.length;
  const bodyX = band.stacked ? plot0.x : plot0.x + labelBandW + 12 +
    columns.colWs.reduce((sum, width) => sum + width, 0) + (colCount > 0 ? 4 : 0);
  const availableBodyW = Math.max(40, plot0.x + plot0.w - bodyX);
  const laneGap = 12;
  const laneEnabled = !band.stacked && !(env.options as { [NO_LANE]?: true })[NO_LANE] && laneLabelW > 0 && env.options.mode !== 'compact' && availableBodyW >= 80 + laneGap + laneLabelW;
  if (laneLabelW > 0 && !laneEnabled && !band.stacked && !(env.options as { [NO_LANE]?: true })[NO_LANE]) {
    warnings.push({
      code: 'milestone-lane-overflow',
      severity: 'warn',
      message: 'milestone labels cannot reserve a shared leader lane at this canvas width',
      suggest: 'increase chart width or shorten milestone labels',
    });
  }
  const bodyW = Math.max(40, availableBodyW - (laneEnabled ? laneGap + laneLabelW : 0));
  const x = (day: number): number => bodyX + ((day - d0Day) / (d1Day - d0Day)) * bodyW;
  const ruleClaims = [
    ...domain.events.map((event) => ({ x: x(event.ruleDay), halfWidth: 4, gap: RULE_LABEL_GAP.eventRule })), // a slide seat keeps 7 px off an event rule
    ...(domain.todayDay === null ? [] : [{ x: x(domain.todayDay + 0.5), halfWidth: 1, gap: RULE_LABEL_GAP.todayLine }]),
  ].sort((a, b) => a.x - b.x);
  // Where each clustered milestone label centres in the lane: spread over its rows.
  const clusteredLabelY = new Map<Id, number>();
  for (const group of domain.milestones.clusters) {
    const minRow = minOf(group.map((entry) => entry.rowIndex));
    const maxRow = maxOf(group.map((entry) => entry.rowIndex));
    const spread = spread1DResult(
      group.map((entry) => ({
        desired: band.stacked ? laneTop(band, rows, entry.rowIndex) + 0.5 * band.rowHs[entry.rowIndex]! : band.rowY[entry.rowIndex]! + 0.5 * band.rowHs[entry.rowIndex]!,
        size: entry.size.height,
      })),
      band.stacked ? [laneTop(band, rows, minRow), laneTop(band, rows, maxRow) + band.rowHs[maxRow]!]
        : [band.rowY[minRow]!, band.rowY[maxRow + 1]!],
      3,
    );
    const centers = spread.positions;
    group.forEach((entry, index) => clusteredLabelY.set(entry.item.id, centers[index]!));
  }
  return {
    inner: plot0,
    plot: { x: bodyX, y: band.headerTop, w: bodyW, h: band.rowsBottom - band.headerTop },
    rowLabels,
    labelBandW: band.stacked ? 0 : labelBandW,
    minimumLabelBandW,
    columns,
    bodyX,
    bodyW,
    laneGap,
    laneEnabled,
    laneX: bodyX + bodyW + laneGap,
    x,
    ruleClaims,
    clusteredLabelY,
  };
}
