import { chartString } from '../../strings/gantt';
/**
 * Gantt phase 2: the scale in, scene nodes out. Background layers
 * (elapsed era, row tint, weekends, shade items, row rules), the calendar
 * header and grid, then every row's cadence markers and items, in paint
 * order. Everything the phase claims goes into an OccupiedIndex of its own.
 */

import { contrastRatio, tint } from '../../color';
import { formatDate } from '../../dateFormat';
import type { Rect } from '../../geometry';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { separationStroke } from '../../markVisibility';
import type { FontSpec } from '../../text';
import { strokeToken, markRolePaint, markRoleToken, paintColor, semanticPalettePaint, surfaceFloorPaint } from '../../theme';
import type { Id, OwnerRef } from '../../types/cell';
import type { LintWarning, Paint, PlacedAnnotation, SceneNode } from '../../types/scene';
import { dateFromDay, dayNum, floorTo, nextOf, type Unit } from './calendar';
import { fmtPathNumber as f2 } from '../../curve';
import { GANTT_ROW_PITCH } from './domain';
import type { GanttMarks } from './layout';
import { laneTop, type GanttBand, type GanttBody, type GanttDomain, type GanttEnv, type GanttPaints, type ItemPlace, type NormItem, type NormRow, type RowPlace } from './model';

/** Phase 2 output. */
export interface GanttMarkGeometry {
  /** In paint order, after the frame's own nodes. */
  nodes: SceneNode[];
  /** The phase's own index: every rect it claimed, in claim order. */
  claims: OccupiedIndex;
  marks: GanttMarks;
  rows: RowPlace[];
  /** The elapsed-era band, when it is drawn. */
  elapsed: PlacedAnnotation[];
  /** The period names the calendar head prints; the today and event rules pass them with a gap. */
  headNames: Rect[];
}

interface MarkCtx {
  env: GanttEnv;
  band: GanttBand;
  body: GanttBody;
  paints: GanttPaints;
  nodes: SceneNode[];
  claims: OccupiedIndex;
  headNames: Rect[];
  rows: readonly NormRow[];
  warnings: LintWarning[];
}

type RowMarks = GanttMarks['rows'][number];

function itemDates(item: NormItem): { start: string; end: string } {
  return { start: formatDate(dateFromDay(item.startDay), 'yyyy-MM-dd'),
    end: formatDate(dateFromDay(item.endDay - 1), 'yyyy-MM-dd') };
}

export function fmtDay(env: GanttEnv, day: number): string {
  return formatDate(dateFromDay(day), 'd MMM yyyy', env.lang);
}

function displayForItem(env: GanttEnv, item: NormItem): string {
  return item.kind === 'milestone'
    ? fmtDay(env, item.startDay)
    : `${fmtDay(env, item.startDay)} – ${fmtDay(env, Math.max(item.startDay, item.endDay - 1))}`;
}

export function ganttPaints(env: GanttEnv, rows: NormRow[]): GanttPaints {
  const { options, theme, surface, highlights } = env;
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const paletteActive = options.palette !== undefined && theme.color.palettes?.[options.palette] !== undefined;
  const item = (it: NormItem): Paint => {
    // A milestone is a point: its role stays as authored.
    if (it.colorRole) return it.kind === 'milestone' ? { token: markRoleToken(it.colorRole) } : markRolePaint(it.colorRole, true);
    if (it.kind === 'shade') return { token: 'others' };
    if (highlights.has(it.id) || highlights.has(it.rowId)) {
      if (!paletteActive) return { token: 'focus' };
      return semanticPalettePaint(theme, options.palette, 'focus');
    }
    // The status square beside the row is painted the same (labels.ts).
    if (it.tone) return markRolePaint(it.tone, true);
    if (it.kind === 'milestone') {
      if (!paletteActive) return { token: 'status-gantt-cadence' };
      return semanticPalettePaint(theme, options.palette, 'highlight');
    }
    // A chevron is a bar in another shape: its colour means what a bar's does.
    const workstream = rowById.get(it.rowId)?.indent === 0;
    if (!paletteActive) return { token: workstream ? 'status-gantt-workstream' : 'status-gantt-detail' };
    return semanticPalettePaint(theme, options.palette, workstream ? 'neutral' : 'neutralLight');
  };
  /**
   * MARK VISIBILITY (src/core/markVisibility.ts): what a row's marks are
   * actually painted ON. The alternate-row tint is `others` washed by
   * `surface.rowTint` (a full-strength zebra equalled a shade item's fill —
   * see backgroundLayers), so on a tinted row the backing is that resolved
   * mix. Marks on an untinted row sit on the page.
   */
  const tinted = (rowId: Id): boolean => {
    const i = rowIndex.get(rowId);
    return !!options.rowTint && i !== undefined && i % 2 === 1;
  };
  return {
    item,
    css: (p: Paint): string => paintColor(theme, p),
    rowBacking: (rowId) => (tinted(rowId) ? tint(theme.color.others, surface.rowTint, theme.color.background) : theme.color.background),
    rowBackingPaint: (rowId) => (tinted(rowId) ? { token: 'others', tint: surface.rowTint } : { token: 'background' }),
  };
}

/**
 * The page-like surfaces a bar may lie on: the alternate-row tint and the
 * elapsed band. A bar's fill separates from them and from the page by itself
 * (surfaceFloorPaint), so no status bar needs an outline.
 */
export function barSurfaces(env: GanttEnv): Paint[] {
  return [
    ...(env.options.rowTint ? [{ token: 'others', tint: env.surface.rowTint } as Paint] : []),
    ...(env.options.elapsed !== false ? [{ token: 'focus', tint: env.surface.elapsedTint } as Paint] : []),
  ];
}

/** A filled mark with the separation outline it needs against its row backing. */
function separatedFill(ctx: MarkCtx, authored: Paint, rowId: Id) {
  const { theme } = ctx.env;
  const fill = surfaceFloorPaint(authored, barSurfaces(ctx.env));
  const fallback = { stroke: fill, strokeWidth: theme.pattern.outlineStrokeWidth };
  // A fill outlined on a tinted row is outlined on every row, so the outline
  // never reads as a second kind of bar (fixture dense-14-rows).
  const tinted: Paint = { token: 'others', tint: ctx.env.surface.rowTint };
  const alternateBackings = ctx.env.options.rowTint ? [tinted] : [];
  const css = ctx.paints.css(fill);
  const backing = [ctx.paints.rowBackingPaint(rowId), ...alternateBackings].map((paint) => ctx.paints.css(paint))
    .reduce((nearest, candidate) => (contrastRatio(css, candidate) < contrastRatio(css, nearest) ? candidate : nearest));
  // The row tint and the elapsed band are surfaces, not fills: a bar on them is held to the page
  // floor, so every status bar separates by its fill alone and none draws an outline.
  const sep = separationStroke(css, backing, theme, true) ?? fallback;
  return {
    fill,
    // A pale bar's timing is in no text, so its 3:1 edge must clear every surface it lies on.
    separation: { fill, backing: ctx.paints.rowBackingPaint(rowId), ...(alternateBackings.length ? { alternateBackings } : {}), fallback, surface: true as const, grounds: barSurfaces(ctx.env) },
    stroke: sep.stroke,
    strokeWidth: sep.strokeWidth,
  };
}

/**
 * Elapsed era, alternate-row tint, weekend bands, full-row shade items and the
 * row rules: behind the grid and the marks, never claimed.
 */
function backgroundLayers(ctx: MarkCtx, domain: GanttDomain): { elapsed: PlacedAnnotation[]; shades: Map<Id, { nodeId: Id; rect: Rect }> } {
  const { env, band, body, nodes } = ctx;
  const { options, surface } = env;
  const { rows, todayDay, d0Day } = domain;
  const { rowsTop, rowsBottom } = band;
  const { x, bodyX, bodyW } = body;
  const elapsed: PlacedAnnotation[] = [];
  // Alternate-row tint (decorative, not claimed). Washed through the theme's
  // `surface.rowTint` knob — the SAME recipe the table chart's zebra uses —
  // because at full token strength the zebra was the identical hex as a
  // `shade` item, and a summary band on a tinted row kept only its separation
  // outline (fill on fill, contrast 1.00:1 in every preset). Washing the decorative layer, not the mark,
  // follows the heatmap highlight-wash precedent, and the theme knob keeps
  // "alternate row" meaning one strength across chart types.
  if (options.rowTint) {
    rows.forEach((r, i) => {
      if (i % 2 !== 1) return;
      nodes.push({
        t: 'rect',
        id: `rowTint:${r.id}`,
        rect: { x: body.inner.x, y: band.rowY[i]!, w: bodyX + bodyW - body.inner.x, h: band.stacked ? band.rowY[i + 1]! - band.rowY[i]! : band.rowHs[i]! },
        fill: { token: 'others', tint: surface.rowTint },
        owner: { categoryId: r.id },
        part: 'rowTint',
      });
    });
  }
  // The elapsed wash lies over the row tint, so the past reads on every row.
  if (todayDay !== null && options.elapsed !== false) {
    const nodeId = 'ann:elapsed:band';
    nodes.push({
      t: 'rect',
      id: nodeId,
      rect: { x: bodyX, y: rowsTop, w: Math.max(1, x(todayDay + 0.5) - bodyX), h: rowsBottom - rowsTop },
      // A wash over the elapsed era: the focus, falling back to the highlight.
      fill: { token: 'focus', tint: surface.elapsedTint },
      owner: { annotationId: 'elapsed' },
      part: 'elapsedEra',
    });
    elapsed.push({ id: 'elapsed', kind: 'band', computedText: chartString(env.options, 'elapsed'), nodeIds: [nodeId] });
  }
  // Weekend bands (week granularity only; counted from the Monday on or before the span start, which a data span need not be). Same wash as
  // the zebra: a full-strength weekend band is the same hex as a `shade` item
  // crossing it, which would hide the item.
  if (options.weekends && domain.granularity === 'weeks') {
    let wk = 0;
    for (let saturday = dayNum(floorTo('week', dateFromDay(d0Day))) + 5; saturday < body.dayTo; saturday += 7) {
      const day = Math.max(saturday, body.dayFrom);
      const to = Math.min(saturday + 2, body.dayTo);
      if (to <= day) continue;
      nodes.push({
        t: 'rect',
        id: `weekend:${wk++}`,
        rect: { x: x(day), y: rowsTop, w: x(to) - x(day), h: rowsBottom - rowsTop },
        fill: { token: 'others', tint: surface.rowTint },
        owner: {},
        part: 'weekend',
      });
    }
  }
  // A shade is a band inside its row: from the bracket-arm line, under a rule
  // across its full extent, to 4 px above the row's foot, so it never runs
  // into the row below or the frame's bottom edge. It is a ground, drawn
  // quieter than the items on it: no outline and a rule in the axis ink. In
  // the mark ink, with a mark outline, the band would read as a labelled box and
  // take the name of the bracket drawn on it ("Board cadence H1" over the
  // whole year); the bracket is the one mark-ink line in the row.
  // The rule also keeps a band visible where its fill sits near the backing.
  const shades = new Map<Id, { nodeId: Id; rect: Rect }>();
  rows.forEach((r, i) => {
    for (const it of r.items) {
      if (it.kind !== 'shade') continue;
      const top = (band.stacked ? laneTop(band, rows, i) : band.rowY[i]!) + 1.5;
      const rect: Rect = { x: x(it.startDay), y: top, w: Math.max(x(it.endDay) - x(it.startDay), 1), h: Math.max(1, band.rowHs[i]! - 5.5) };
      const nodeId = `mark:${r.id}:${it.id}`;
      nodes.push({
        t: 'rect',
        id: nodeId,
        rect,
        fill: ctx.paints.item(it),
        owner: { categoryId: r.id, segmentId: it.id },
        part: 'shade',
        display: { value: displayForItem(env, it) },
      });
      nodes.push({ t: 'line', id: `${nodeId}:rule`, x1: rect.x, y1: top, x2: rect.x + rect.w, y2: top, stroke: { token: 'axis' }, width: strokeToken(env.theme, 'hair'), owner: { categoryId: r.id, segmentId: it.id }, part: 'shadeRule' });
      shades.set(it.id, { nodeId, rect });
    }
  });
  for (let i = 1; i <= rows.length; i++) {
    const y = band.rowY[i]!;
    nodes.push({ t: 'line', id: `rowRule:${i}`, x1: body.inner.x, y1: y, x2: bodyX + bodyW, y2: y, stroke: { token: 'grid' }, width: strokeToken(env.theme, 'hair'), owner: {}, part: 'rowRule' });
  }
  return { elapsed, shades };
}

/** One header tier: its cells, and one date format for the whole tier. */
function headerRow(
  ctx: MarkCtx,
  domain: GanttDomain,
  tierRow: { kindTag: 'major' | 'minor'; unit: Unit; starts: Date[]; y: number; font: FontSpec; fmts: string[]; ink: Paint; startDay?: boolean },
): void {
  const { kindTag, unit, starts, y, font, fmts, ink, startDay } = tierRow;
  const { d0Day, d1Day } = domain;
  const { x } = ctx.body;
  const { headerRowH } = ctx.band;
  const lang = ctx.env.lang;
  const cells = starts.map((s, i): Rect => {
    const a = Math.max(dayNum(s), ctx.body.dayFrom);
    const b = Math.min(i + 1 < starts.length ? dayNum(starts[i + 1]!) : ctx.body.dayTo, ctx.body.dayTo);
    return { x: x(a), y, w: x(b) - x(a), h: headerRowH };
  });
  // Header cell strings repeat across the vote and the emit loop; measure is
  // a caller-supplied callback of unknown cost, so cache per string.
  const sizeCache = new Map<string, { width: number; height: number }>();
  const sized = (text: string) => {
    let entry = sizeCache.get(text);
    if (!entry) {
      entry = ctx.env.measure(text, font);
      sizeCache.set(text, entry);
    }
    return entry;
  };
  const fits = (text: string, i: number) => sized(text).width + 6 <= cells[i]!.w;
  // ONE format per row, decided on the FULL cells. Per-cell picking printed
  // "Jan F Mar Apr M Jun …": Feb's 28-day cell and May's wide glyphs each
  // missed the 'MMM' fit by a hair while their neighbors passed, so two
  // months truncated alone — a visual distinction with no data behind it
  // (the choropleth vocabulary rule, same reasoning). Domain-clipped edge
  // cells don't get a vote — a chart starting Jan 20 must not force every
  // month down to one letter — but when the whole span is shorter than one
  // unit and NO cell is full, the clipped cells ARE the row and vote
  // instead (an unguarded every() would be vacuously true and elect the
  // WIDEST format for the narrowest cells).
  const isFull = (i: number) =>
    dayNum(starts[i]!) >= d0Day &&
    (i + 1 < starts.length ? dayNum(starts[i + 1]!) : dayNum(nextOf(unit, starts[i]!))) <= d1Day;
  const voters = starts.map((_, i) => i).filter(isFull);
  const electorate = voters.length > 0 ? voters : starts.map((_, i) => i);
  const rowFmtIndex = fmts.findIndex((f) =>
    electorate.every((i) => fits(formatDate(starts[i]!, f, lang), i)),
  );
  // A cell the row format misses — a clipped edge cell, or any cell when
  // even the narrowest format failed the vote — degrades DOWN the remaining
  // ladder: a one-month sliver of Q1 reading "Q1" beside full "Q1 2026"
  // cells is a visible partial cell. Full cells fit the row format by
  // construction, so uniformity among them is untouched. FLOOR: a cell
  // narrower than the shortest format's ink (a ~6px edge sliver) stays
  // empty — its rect and grid stroke still mark the period, and printing
  // ink wider than the cell would bleed into the neighbour cell; a
  // sub-glyph sliver cannot hold any label.
  // A year row is the exception: its shorter format ('yy') is a whole-row
  // fallback, so a clipped edge year never prints "27" beside "2026".
  const fromFmt = rowFmtIndex === -1 ? fmts.length - 1 : rowFmtIndex;
  const cellFmts = fmts.slice(fromFmt, unit === 'year' ? fromFmt + 1 : undefined);
  // A start-day cell names the day it starts on, a clipped first cell the chart's first day, flush left.
  // A name may take `span` cells: its neighbours stay blank.
  const nameOf = (i: number, span: number): string | undefined => {
    const named = startDay ? dateFromDay(Math.max(dayNum(starts[i]!), d0Day)) : starts[i]!;
    return cellFmts.map((f) => formatDate(named, f, lang)).find((candidate) => sized(candidate).width + 6 <= span * cells[i]!.w);
  };
  // A minor tier whose cells hold no name prints every k-th cell, k the least that holds one.
  let stride = 1;
  if (kindTag === 'minor') while (stride < starts.length && !starts.some((_, i) => i % stride === 0 && nameOf(i, stride) !== undefined)) stride++;
  let printed = false;
  const spill: SceneNode[] = [];
  starts.forEach((_, i) => {
    const cell = cells[i]!;
    ctx.nodes.push({ t: 'rect', id: `header:${kindTag}:${i}`, rect: cell, fill: { token: 'background' }, stroke: { token: 'grid' }, strokeWidth: strokeToken(ctx.env.theme, 'hair'), owner: {}, part: 'headerCell' });
    const text = i % stride === 0 ? nameOf(i, stride) : undefined;
    if (text !== undefined) {
      printed = true;
      const { width: tw, height: th } = sized(text);
      // A spanning name stays inside the tier.
      const at = startDay ? cell.x + 6 : cell.x + cell.w / 2 - tw / 2;
      const name = { x: stride > 1 ? Math.max(cells[0]!.x, Math.min(at, cells[cells.length - 1]!.x + cells[cells.length - 1]!.w - tw)) : at, y: cell.y + (headerRowH - th) / 2, w: tw, h: th };
      ctx.headNames.push(name);
      // A name that spans cells lies over the next ones, so it paints after them.
      (stride > 1 ? spill : ctx.nodes).push({ t: 'text', typeRole: 'axis', id: `header:${kindTag}:${i}:text`, x: name.x, y: name.y, lines: [text], align: 'start', font, ink, owner: {}, part: 'scale' });
    }
  });
  ctx.nodes.push(...spill);
  if (kindTag === 'major' && !printed) {
    ctx.warnings.push({
      code: 'gantt-calendar-unlabelled',
      severity: 'warn',
      message: `the calendar head's ${unit} row has no date: its cells are too narrow for any label`,
      suggest: 'widen the chart or shorten the span',
    });
  }
}

/** Calendar header (two tiers) and the grid verticals: solid at major boundaries, dotted at minor ones. */
function calendarGrid(ctx: MarkCtx, domain: GanttDomain): void {
  const { band, body, nodes, env } = ctx;
  const { tier, majorStarts, minorStarts, d0Day, d1Day } = domain;
  const { x, bodyX, bodyW } = body;
  const { rowsTop, rowsBottom, headerTop } = band;
  headerRow(ctx, domain, { kindTag: 'major', unit: tier.major, starts: majorStarts, y: headerTop, font: env.fonts.headerMajor, fmts: tier.majorFmts, ink: { token: 'ink' } });
  headerRow(ctx, domain, { kindTag: 'minor', unit: tier.minor, starts: minorStarts, y: headerTop + band.headerRowH, font: env.fonts.tick, fmts: tier.minorFmts, ink: { token: 'inkMuted' }, startDay: tier.minorFmts[0] === 'd' });
  ctx.claims.claim({ x: bodyX, y: headerTop, w: bodyW, h: band.headerH }, 'axis', {});
  const majorDays = new Set(majorStarts.map(dayNum));
  const gridLine = (id: string, d: number, dash?: number[]): SceneNode =>
    ({ t: 'line', id, x1: x(d), y1: rowsTop, x2: x(d), y2: rowsBottom, stroke: { token: 'grid' }, width: strokeToken(env.theme, 'rule'), ...(dash ? { dash } : {}), owner: {}, part: 'grid' });
  let gseq = 0;
  for (const s of majorStarts) {
    const d = dayNum(s);
    if (d <= d0Day || d >= d1Day) continue;
    nodes.push(gridLine(`grid:major:${gseq++}`, d));
  }
  gseq = 0;
  for (const s of minorStarts) {
    const d = dayNum(s);
    if (d <= d0Day || d >= d1Day || majorDays.has(d)) continue;
    nodes.push(gridLine(`grid:minor:${gseq++}`, d, [2, 3]));
  }
  // domain edges close the body frame
  ([body.dayFrom, body.dayTo] as const).forEach((d, i) => nodes.push(gridLine(`grid:edge:${i}`, d)));
}

/**
 * A milestone's diamond. MARK VISIBILITY (src/core/markVisibility.ts): a
 * milestone lands INSIDE whatever bar, chevron or shade already covers its
 * day, so the page is the wrong backing for it — and `status.gantt-cadence` is
 * the IDENTICAL hex to `status.gantt-workstream` in standard, standard-dark and
 * glass (1.00:1) and 1.19-1.55:1 in notation and notation-dark, i.e. below
 * the floor in each of them. A milestone then vanishes while a leader still
 * runs to its label. Measure against
 * the item actually beneath it.
 */
export function milestonePaints(env: GanttEnv, paints: GanttPaints, r: NormRow, it: NormItem) {
  const { theme } = env;
  const milestonePaint = paints.item(it);
  const milestoneBacking = r.items
    .filter(
      (other) =>
        other !== it &&
        other.kind !== 'milestone' &&
        other.startDay <= it.startDay &&
        other.endDay >= it.startDay + 1,
    )
    .map((other) => paints.item(other))
    .pop();
  const fallback = { stroke: milestonePaint, strokeWidth: theme.pattern.outlineStrokeWidth };
  const milestoneStroke = separationStroke(
    paints.css(milestonePaint),
    milestoneBacking ? paints.css(milestoneBacking) : theme.color.background,
    theme,
  ) ?? fallback;
  return { paint: milestonePaint, backing: milestoneBacking, fallback, stroke: milestoneStroke };
}

function milestoneMark(ctx: MarkCtx, r: NormRow, place: ItemPlace, cy: number, id: string): SceneNode {
  const { it, cx, rr } = place;
  const d = `M${f2(cx)} ${f2(cy - rr)}L${f2(cx + rr)} ${f2(cy)}L${f2(cx)} ${f2(cy + rr)}L${f2(cx - rr)} ${f2(cy)}Z`;
  const { paint: milestonePaint, backing: milestoneBacking, fallback, stroke: milestoneStroke } = milestonePaints(ctx.env, ctx.paints, r, it);
  return {
    t: 'path',
    id,
    d,
    fill: milestonePaint,
    separation: { fill: milestonePaint, backing: milestoneBacking ?? { token: 'background' }, fallback },
    stroke: milestoneStroke.stroke,
    width: milestoneStroke.strokeWidth,
    owner: place.owner,
    part: 'milestone',
    display: { value: displayForItem(ctx.env, it) },
  };
}

/** A cadence row's marker paint, before an event's own highlight: its role, the focus when the row is highlighted, else the cadence colour, washed. */
export function cadenceRowPaint(env: GanttEnv, r: NormRow): Paint {
  const role = r.cadence?.colorRole;
  return { token: role ? markRoleToken(role) : env.highlights.has(r.id) ? 'focus' : 'status-gantt-cadence', tint: 0.4 };
}

/** One row: cadence markers, then its items in authored order: bar, chevron, milestone, bracket or shade. */
function rowMarks(ctx: MarkCtx, r: NormRow, i: number, shades: Map<Id, { nodeId: Id; rect: Rect }>, marks: GanttMarks): RowPlace {
  const { env, nodes, claims } = ctx;
  const { x } = ctx.body;
  const { rowH } = ctx.band;
  const rowY = ctx.band.stacked ? laneTop(ctx.band, ctx.rows, i) : ctx.band.rowY[i]!;
  const cy = rowY + ctx.band.rowHs[i]! / 2;
  // A row the milestone lane makes taller than its natural pitch keeps the
  // bar height of that pitch, centred in the row; a squeezed row
  // still scales its bars down.
  const barH = Math.min(rowH, GANTT_ROW_PITCH) * Math.min(0.9, Math.max(0.2, env.options.bandFraction ?? 0.6));
  const itemNodes: RowMarks['itemNodes'] = [];
  const cadenceNodes: RowMarks['cadenceNodes'] = [];
  const cadence = r.cadence;
  if (cadence) {
    const markerR = Math.max(3, Math.min(rowH * 0.22, 6));
    for (const event of cadence.events) {
      const cx = x(event.day + 0.5);
      const rect: Rect = { x: cx - markerR, y: cy - markerR, w: 2 * markerR, h: 2 * markerR };
      const nodeId = `cadence:${r.id}:${event.id}`;
      const owner: OwnerRef = { categoryId: r.id, segmentId: event.id };
      const d = cadence.marker === 'triangle'
        ? `M${f2(cx)} ${f2(cy - markerR)}L${f2(cx + markerR)} ${f2(cy + markerR)}` +
          `L${f2(cx - markerR)} ${f2(cy + markerR)}Z`
        : `M${f2(cx)} ${f2(cy - markerR)}L${f2(cx + markerR)} ${f2(cy)}` +
          `L${f2(cx)} ${f2(cy + markerR)}L${f2(cx - markerR)} ${f2(cy)}Z`;
      const fill: Paint = !cadence.colorRole && env.highlights.has(event.id) ? { token: 'focus', tint: 0.4 } : cadenceRowPaint(env, r);
      nodes.push({ t: 'path', id: nodeId, d, fill, owner, part: `cadence-${cadence.marker}`, display: { value: fmtDay(env, event.day) } });
      claims.claim(rect, 'mark', owner, 'cadence');
      cadenceNodes.push({ date: formatDate(dateFromDay(event.day), 'yyyy-MM-dd'), marker: cadence.marker, nodeId, rect });
    }
  }
  // Bars that meet or overlap in one lane would paint one block: a 1px
  // background edge keeps each bar its own (gantt-items-overlap warns).
  const spans = r.items.filter((it) => it.kind === 'bar' || it.kind === 'chevron');
  const touching = new Set(spans.filter((a) => spans.some((b) => b !== a && b.startDay <= a.endDay && a.startDay <= b.endDay)).map((a) => a.id));
  const items: ItemPlace[] = [];
  for (const it of r.items) {
    // A shared milestone keeps the identity of the row that authored it.
    const owner: OwnerRef = { categoryId: it.rowId, segmentId: it.id };
    const xs = x(it.startDay);
    const xe = x(it.endDay);
    const nodeId = `mark:${it.rowId}:${it.id}`;
    const place: ItemPlace = { it, owner, rect: { x: xs, y: cy - barH / 2, w: Math.max(xe - xs, 1), h: barH }, xs, xe, cx: 0, rr: 0, yT: 0, armH: 0 };
    items.push(place);
    const display = { value: displayForItem(env, it) };
    if (it.kind === 'shade') {
      place.rect = shades.get(it.id)!.rect;
      itemNodes.push({ ...itemDates(it), id: it.id, kind: it.kind, nodeId: shades.get(it.id)!.nodeId, rect: place.rect });
      continue;
    }
    if (it.kind === 'rule') {
      // A 2 px line on the bar box's bottom edge; hover and focus keep the whole box.
      const y = place.rect.y + place.rect.h - 1;
      nodes.push({ t: 'line', id: nodeId, x1: xs, y1: y, x2: xs + place.rect.w, y2: y, stroke: surfaceFloorPaint(markRolePaint('neutralLight', true), barSurfaces(ctx.env)), width: 2, owner, part: 'ganttRule', display });
    } else if (it.kind === 'bar') {
      const fill = surfaceFloorPaint(ctx.paints.item(it), barSurfaces(ctx.env));
      const seam = { stroke: { token: 'background' as const }, strokeWidth: strokeToken(env.theme, 'hair') };
      // Touching bars keep their page seam; the separation rule lets a pale one take its edge.
      const paint = touching.has(it.id)
        ? { fill, ...seam, separation: { fill, backing: ctx.paints.rowBackingPaint(r.id), fallback: seam, surface: true as const, grounds: barSurfaces(ctx.env) } }
        : separatedFill(ctx, ctx.paints.item(it), r.id);
      nodes.push({ t: 'rect', id: nodeId, rect: place.rect, ...paint, owner, part: 'bar', display });
    } else if (it.kind === 'chevron') {
      const { y: barY, w } = place.rect;
      const tip = Math.min(9, barH * 0.6, w);
      const d =
        `M${f2(xs)} ${f2(barY)}L${f2(xs + w - tip)} ${f2(barY)}L${f2(xs + w)} ${f2(cy)}` +
        `L${f2(xs + w - tip)} ${f2(barY + barH)}L${f2(xs)} ${f2(barY + barH)}Z`;
      const fill = surfaceFloorPaint(ctx.paints.item(it), barSurfaces(ctx.env));
      nodes.push({ t: 'path', id: nodeId, d, fill, separation: { fill, backing: ctx.paints.rowBackingPaint(r.id), surface: true, grounds: barSurfaces(ctx.env) }, owner, part: 'chevron', display });
    } else if (it.kind === 'milestone') {
      place.cx = x(it.startDay + 0.5);
      place.rr = Math.max(3, Math.min(rowH * 0.32, 8));
      place.rect = { x: place.cx - place.rr, y: cy - place.rr, w: 2 * place.rr, h: 2 * place.rr };
      nodes.push(milestoneMark(ctx, r, place, cy, nodeId));
    } else {
      // bracket: open square bracket spanning start→end at the row top, in ink
      const armH = (place.armH = Math.max(3, Math.min(6, rowH * 0.22)));
      const yT = (place.yT = rowY + 1.5);
      place.rect = { x: xs, y: yT, w: Math.max(xe - xs, 1), h: armH };
      const d = `M${f2(xs)} ${f2(yT + armH)}L${f2(xs)} ${f2(yT)}L${f2(xe)} ${f2(yT)}L${f2(xe)} ${f2(yT + armH)}`;
      nodes.push({ t: 'path', id: nodeId, d, stroke: { token: 'markInk' }, width: strokeToken(env.theme, 'rule'), owner, part: 'bracket', display });
    }
    claims.claim(place.rect, 'mark', owner);
    itemNodes.push({ ...itemDates(it), id: it.id, kind: it.kind, nodeId, rect: place.rect });
  }
  marks.rows.push({ id: r.id, y: ctx.band.rowY[i]!, h: ctx.band.stacked ? ctx.band.rowY[i + 1]! - ctx.band.rowY[i]! : ctx.band.rowHs[i]!, itemNodes, cadenceNodes });
  return { row: r, index: i, cy, items };
}

/** Phase 2: the band, body and paints in, every background, header, grid and row mark out. */
export function layoutGanttMarks(
  env: GanttEnv,
  domain: GanttDomain,
  band: GanttBand,
  body: GanttBody,
  paints: GanttPaints,
  warnings: LintWarning[],
): GanttMarkGeometry {
  const ctx: MarkCtx = {
    env,
    band,
    body,
    paints,
    nodes: [],
    claims: createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height }),
    headNames: [],
    rows: domain.rows,
    warnings,
  };
  const marks: GanttMarks = { rows: [], headerRect: { x: body.bodyX, y: band.headerTop, w: body.bodyW, h: band.headerH } };
  const { elapsed, shades } = backgroundLayers(ctx, domain);
  calendarGrid(ctx, domain);
  const rows = domain.rows.map((r, i) => rowMarks(ctx, r, i, shades, marks));
  return { nodes: ctx.nodes, claims: ctx.claims, marks, rows, elapsed, headNames: ctx.headNames };
}
