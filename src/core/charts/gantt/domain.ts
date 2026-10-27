/**
 * Gantt phase 1: options and data in, the rows, the calendar domain,
 * today, the event markers and the milestone label plan out. Nothing here
 * knows a pixel beyond measured text.
 */

import { chartTheme } from '../chartEnv';
import { formatDate, parseISODate } from '../../dateFormat';
import { NormalizeError, resolveHighlight, resolveSize } from '../../normalize/shared';
import { compareText, defaultMeasurer } from '../../text';
import { resolveSemanticPaletteTheme, resolveSurface, emphasisWeight } from '../../theme';
import type { Id } from '../../types/cell';
import type { GanttCell, GanttData, GanttItem } from '../../types/data';
import type { LabelKind } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import { TIERS, boundariesOf, ceilTo, dateFromDay, dayNum, floorTo } from './calendar';
import type { GanttGranularity, GanttOptions } from './layout';
import type {
  GanttDomain,
  GanttEnv,
  GanttEvent,
  GanttEventAnnotation,
  MilestoneLabel,
  MilestonePlan,
  NormItem,
  NormRow,
} from './model';
import { maxOf, minOf, pushAll } from '../../arrays';

const ITEM_KINDS: GanttItem['kind'][] = ['bar', 'milestone', 'chevron', 'bracket', 'shade', 'rule'];
export const MAX_COLS = 3;

/** Resolve the options once: theme, surface, size, measurer, highlights and fonts. */
export function resolveGanttEnv(options: GanttOptions, warnings: LintWarning[]): GanttEnv {
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const tick = { family: theme.type.family, ...theme.type.axis };
  return {
    options,
    theme,
    surface: resolveSurface(theme),
    size: resolveSize(options.size),
    lang: options.locale?.language,
    measure: options.measure ?? defaultMeasurer,
    highlights: new Set(resolveHighlight(options.highlight)),
    labelOn: (kind: LabelKind): boolean => {
      if (options.labels === false) return kind === 'activity';
      const content = options.labels?.[kind];
      return content !== false && (kind !== 'item' || !Array.isArray(content) || content.length > 0);
    },
    fonts: {
      tick,
      headerMajor: { ...tick },
      label: { family: theme.type.family, ...theme.type.label },
      strong: { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) },
    },
  };
}

const parseDay = (s: string, path: string): number => {
  const d = parseISODate(s);
  if (!d) throw new NormalizeError('invalid-date', path, `invalid ISO date '${s}'`);
  return dayNum(d);
};

function normalizeRows(data: GanttData, warnings: LintWarning[]): { rows: NormRow[]; itemById: Map<Id, NormItem> } {
  if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
    throw new NormalizeError('empty-data', 'rows', 'gantt requires at least one row');
  }
  const rowIds = new Set<Id>();
  const markIds = new Set<Id>();
  const itemById = new Map<Id, NormItem>();
  const rows: NormRow[] = data.rows.map((raw, ri) => {
    if (!raw?.id) throw new NormalizeError('missing-id', `rows[${ri}]`, 'row requires an id');
    if (rowIds.has(raw.id)) {
      throw new NormalizeError('duplicate-id', `rows[${raw.id}]`, `duplicate row id '${raw.id}'`);
    }
    rowIds.add(raw.id);
    let cols = (raw.cols ?? []).map((cell) => (typeof cell === 'string' ? { text: cell } : cell));
    if (cols.length > MAX_COLS) {
      warnings.push({
        code: 'gantt-cols-truncated',
        severity: 'warn',
        message: `row '${raw.id}': ${cols.length} cols supplied — only ${MAX_COLS} rendered`,
        owner: { categoryId: raw.id },
      });
      cols = cols.slice(0, MAX_COLS);
    }
    const items = (raw.kind === 'cadence' ? [] : raw.items).map((it, ii): NormItem => {
      const path = `rows[${raw.id}].items[${ii}]`;
      if (!it?.id) throw new NormalizeError('missing-id', path, 'item requires an id');
      if (markIds.has(it.id)) {
        throw new NormalizeError('duplicate-id', path, `duplicate item id '${it.id}'`);
      }
      if (!ITEM_KINDS.includes(it.kind)) {
        throw new NormalizeError(
          'invalid-kind', path,
          `unknown item kind '${String(it.kind)}'`, ITEM_KINDS.join(', '),
        );
      }
      const startDay = parseDay(it.start, `${path}.start`);
      const endIncl = it.end !== undefined ? parseDay(it.end, `${path}.end`) : startDay;
      if (endIncl < startDay) {
        throw new NormalizeError('invalid-range', path, `end '${it.end}' precedes start '${it.start}'`);
      }
      const norm: NormItem = {
        id: it.id,
        rowId: raw.id,
        kind: it.kind,
        startDay,
        endDay: endIncl + 1,
        label: it.label,
        colorRole: it.colorRole,
        colorLabel: it.colorLabel,
        shared: it.kind === 'milestone' && it.scope === 'shared',
        anchor: it.anchor
          ? { toItemId: it.anchor.toItemId, edge: it.anchor.edge, offsetDays: it.anchor.offsetDays ?? 0 }
          : undefined,
        path,
      };
      markIds.add(it.id);
      itemById.set(it.id, norm);
      return norm;
    });
    const cadence =
      raw.kind === 'cadence'
        ? {
            events: raw.events.map((event, ei) => {
              const path = `rows[${raw.id}].events[${ei}]`;
              if (markIds.has(event.id)) {
                throw new NormalizeError('duplicate-id', path, `duplicate cadence event id '${event.id}'`);
              }
              markIds.add(event.id);
              return { id: event.id, day: parseDay(event.date, `${path}.date`) };
            }),
            marker: raw.marker ?? 'diamond',
            colorRole: raw.colorRole,
          }
        : undefined;
    const sublabel = raw.sublabel?.trim().split(/\s+/).join(' ');
    return {
      id: raw.id,
      label: raw.label ?? raw.id,
      ...(sublabel ? { sublabel } : {}),
      kind: raw.kind ?? 'task',
      indent: Math.max(0, raw.indent ?? 0),
      cols,
      items: items.filter((it) => !it.shared),
      cadence,
    };
  });
  // A bar or chevron takes its row's status tone, the colour of the
  // status square beside it, so the status column keys the bars. A row
  // without a status takes the status of the row it is indented under.
  const parents: { indent: number; tone?: GanttCell['tone'] }[] = [];
  for (const row of rows) {
    while (parents.length > 0 && parents[parents.length - 1]!.indent >= row.indent) parents.pop();
    const tone = row.cols.find((cell) => cell.tone)?.tone ?? parents[parents.length - 1]?.tone;
    parents.push({ indent: row.indent, tone });
    for (const it of row.items) if (tone && (it.kind === 'bar' || it.kind === 'chevron')) it.tone = tone;
  }
  // Milestones that affect several activities get one row of their own below them.
  const shared = [...itemById.values()].filter((it) => it.shared);
  if (shared.length > 0) rows.push({ id: '', label: '', kind: 'task', indent: 0, cols: [], items: shared, shared: true });
  return { rows, itemById };
}

/** Span, granularity and the padded calendar domain; then today, validated against it. */
function ganttCalendar(items: NormItem[], cadenceDays: number[], options: GanttOptions, warnings: LintWarning[]) {
  let minDay = Infinity;
  let maxDay = -Infinity;
  for (const it of items) {
    minDay = Math.min(minDay, it.startDay);
    maxDay = Math.max(maxDay, it.endDay);
  }
  for (const day of cadenceDays) {
    minDay = Math.min(minDay, day);
    maxDay = Math.max(maxDay, day + 1);
  }
  const spanDays = maxDay - minDay;
  const granularity: GanttGranularity = spanDays > 548 ? 'quarters' : spanDays >= 90 ? 'months' : 'weeks';
  const tier = TIERS[granularity];
  const d0Day = dayNum(floorTo(tier.minor, dateFromDay(minDay)));
  const d1Day = dayNum(ceilTo(tier.minor, dateFromDay(maxDay)));

  if (options.weekends && granularity !== 'weeks') {
    warnings.push({
      code: 'weekends-ignored',
      severity: 'info',
      message: `weekends shading only renders at week granularity (span is ${granularity})`,
    });
  }

  let todayDay: number | null = null;
  if (options.today !== undefined) {
    const td = parseISODate(options.today);
    if (!td) throw new NormalizeError('invalid-date', 'options.today', `invalid ISO date '${options.today}'`);
    const dn = dayNum(td);
    if (dn < d0Day || dn >= d1Day) {
      warnings.push({
        code: 'today-out-of-range',
        severity: 'info',
        message: `today '${options.today}' lies outside the chart span — line suppressed`,
      });
    } else {
      todayDay = dn;
    }
  }
  if (options.elapsed === true && todayDay === null) {
    warnings.push({
      code: 'elapsed-without-today',
      severity: 'info',
      message: 'elapsed shading requires a visible options.today boundary — tint suppressed',
    });
  }
  return { granularity, tier, d0Day, d1Day, todayDay };
}

/** Authored event markers: a date or a schedule item id, inside the chart span. */
function resolveGanttEvents(
  options: GanttOptions,
  anchorDayById: Map<Id, number>,
  span: { d0Day: number; d1Day: number },
  warnings: LintWarning[],
): GanttEvent[] {
  const authoredEvents = (options.annotations ?? []).filter(
    (annotation): annotation is GanttEventAnnotation => annotation.kind === 'event',
  );
  const eventIds = new Set<Id>();
  const events: GanttEvent[] = [];
  authoredEvents.forEach((annotation, i) => {
    const id = annotation.id ?? `event-${i + 1}`;
    if (eventIds.has(id) || id === 'today' || id === 'elapsed') {
      throw new NormalizeError('duplicate-id', `options.annotations[${i}]`, `duplicate event id '${id}'`);
    }
    eventIds.add(id);
    const at =
      typeof annotation.at === 'string'
        ? annotation.at
        : annotation.at && 'categoryId' in annotation.at
          ? annotation.at.categoryId
          : null;
    const date = at === null ? null : parseISODate(at);
    const ruleDay = date ? dayNum(date) : at === null ? null : (anchorDayById.get(at) ?? null);
    if (ruleDay === null) {
      warnings.push({
        code: 'bad-anchor',
        severity: 'warn',
        message: `event '${id}': expected an ISO date or schedule item id anchor`,
        owner: { annotationId: id },
      });
      return;
    }
    const day = Math.floor(ruleDay);
    if (day < span.d0Day || day >= span.d1Day) {
      warnings.push({
        code: 'event-out-of-range',
        severity: 'info',
        message: `event '${id}' at '${at}' lies outside the chart span — marker suppressed`,
        owner: { annotationId: id },
      });
      return;
    }
    events.push({
      id,
      day,
      ruleDay,
      label: annotation.label,
      tone: annotation.tone,
      priority: annotation.priority,
      annotation,
    });
  });
  return events;
}

/** A gantt row's natural pitch, in px: a milestone cluster can only make a row taller. */
export const GANTT_ROW_PITCH = 40;

function requiredClusterRowHeight(groups: readonly (readonly { rowIndex: number; size: { height: number } }[])[]): number {
  return Math.max(GANTT_ROW_PITCH, maxOf(groups.map((group) => {
    const minRow = minOf(group.map((entry) => entry.rowIndex));
    const maxRow = maxOf(group.map((entry) => entry.rowIndex));
    const labelExtent = group.reduce((sum, entry) => sum + entry.size.height, 0) + (group.length - 1) * 3;
    return labelExtent / (maxRow - minRow + 1);
  })));
}

/** Category is the authored name; absolute/value is the resolved date or date range. */
export function ganttItemLabel(item: NormItem, env: GanttEnv): { text: string; missing: string[] } {
  const content = env.options.labels === false ? undefined : env.options.labels?.item;
  const parts = Array.isArray(content) ? content : item.kind === 'milestone' ? ['category', 'absolute'] : ['category'];
  const date = (day: number) => formatDate(dateFromDay(day), 'd MMM', env.lang);
  const missing: string[] = [];
  const texts = parts.map(part => {
    const text = part === 'category' ? item.label
      : part === 'absolute' || part === 'value' ? item.kind === 'milestone' || item.endDay - item.startDay === 1
        ? date(item.startDay) : `${date(item.startDay)} – ${date(item.endDay - 1)}`
      : undefined;
    if (!text?.trim() && Array.isArray(content)) missing.push(part);
    return text?.trim();
  });
  return { text: texts.filter(Boolean).join(' · '), missing };
}

/** Milestone label texts, measured first: clusters set the row height and lane labels the lane width. */
function planMilestones(rows: NormRow[], env: GanttEnv, d0Day: number, d1Day: number): MilestonePlan {
  const labels = env.labelOn('item')
    ? rows.flatMap((row, rowIndex) =>
        row.items
          .filter((item) => item.kind === 'milestone')
          .map((item) => {
            const text = ganttItemLabel(item, env).text;
            return { item, rowIndex, text, size: env.measure(text, env.fonts.label) };
          }).filter(entry => entry.text),
      )
    : [];
  // Nearby label spans share lanes too. Estimate timeline width before the frame is drawn.
  const labelW = Math.max(0, maxOf(labels.map(entry => entry.size.width)));
  const rowW = Math.max(0, maxOf(rows.map(row => env.measure(row.label, env.fonts.label).width)));
  const timelineW = Math.max(40, env.size.width - rowW - labelW - 100);
  const pixelsPerDay = timelineW / Math.max(1, d1Day - d0Day);
  const pending = new Set(labels.filter(entry => !entry.item.shared));
  const clusters: MilestoneLabel[][] = [];
  for (const first of pending) {
    pending.delete(first);
    const group = [first];
    for (let i = 0; i < group.length; i++) {
      const current = group[i]!;
      for (const candidate of pending) {
        if (Math.abs(current.rowIndex - candidate.rowIndex) > 1) continue;
        const gap = Math.abs(current.item.startDay - candidate.item.startDay) * pixelsPerDay;
        if (gap > Math.max(current.size.width, candidate.size.width) + 14) continue;
        pending.delete(candidate);
        group.push(candidate);
      }
    }
    if (group.length > 1) clusters.push(group.sort((a, b) =>
      a.rowIndex - b.rowIndex || a.item.startDay - b.item.startDay || compareText(a.item.id, b.item.id)));
  }
  const laneIds = new Set(clusters.flatMap((group) => group.map((entry) => entry.item.id)));
  rows.forEach((row) => {
    if (row.items.length < 2 || row.shared) return;
    row.items.forEach((item) => {
      if (item.kind === 'milestone') laneIds.add(item.id);
    });
  });
  return {
    byId: new Map(labels.map((entry) => [entry.item.id, entry])),
    clusters,
    laneIds,
    laneLabelW: Math.max(0, maxOf(labels.filter((entry) => laneIds.has(entry.item.id)).map((entry) => entry.size.width))),
    clusterRowH: requiredClusterRowHeight(clusters),
    flagPitch: new Map(),
  };
}

/** Phase 1: data in, the rows, the calendar domain, today, events and the milestone plan out. */
/** Bars and chevrons whose spans overlap, per row: they paint one merged block. */
function overlappingBars(row: NormRow): [NormItem, NormItem][] {
  const spans = row.items.filter((it) => it.kind === 'bar' || it.kind === 'chevron')
    .sort((a, b) => a.startDay - b.startDay);
  const pairs: [NormItem, NormItem][] = [];
  spans.forEach((a, i) => {
    for (const b of spans.slice(i + 1)) if (b.startDay < a.endDay) pairs.push([a, b]);
  });
  return pairs;
}

function overlapWarnings(rows: NormRow[]): LintWarning[] {
  return rows.flatMap((row) => overlappingBars(row).map(([a, b]): LintWarning => ({
    code: 'gantt-items-overlap',
    severity: 'warn',
    message: `row '${row.id}': items '${a.id}' and '${b.id}' overlap in time and share one lane; the later bar is drawn over the earlier one`,
    owner: { categoryId: row.id, segmentId: b.id },
    suggest: 'put overlapping items on rows of their own',
  })));
}

export function resolveGanttDomain(data: GanttData, env: GanttEnv, warnings: LintWarning[]): GanttDomain {
  const { rows, itemById } = normalizeRows(data, warnings);
  const allItems = rows.flatMap((r) => r.items);
  const allCadenceDays = rows.flatMap((r) => r.cadence?.events.map((event) => event.day) ?? []);
  if (allItems.length === 0 && allCadenceDays.length === 0) {
    throw new NormalizeError('empty-data', 'rows', 'gantt requires at least one item or cadence date');
  }
  // Anchor resolution, topological; an anchored item keeps its duration.
  const anchorState = new Map<Id, 1 | 2>();
  const resolveAnchor = (it: NormItem): void => {
    const st = anchorState.get(it.id);
    if (st === 2) return;
    if (st === 1) {
      throw new NormalizeError('anchor-cycle', it.path, `anchor cycle involving item '${it.id}'`);
    }
    anchorState.set(it.id, 1);
    if (it.anchor) {
      const target = itemById.get(it.anchor.toItemId);
      if (!target) {
        throw new NormalizeError(
          'unknown-anchor', it.path,
          `anchor target '${it.anchor.toItemId}' not found`,
        );
      }
      resolveAnchor(target);
      const edgeDay = it.anchor.edge === 'start' ? target.startDay : target.endDay;
      const duration = it.endDay - it.startDay;
      it.startDay = edgeDay + it.anchor.offsetDays;
      it.endDay = it.startDay + duration;
    }
    anchorState.set(it.id, 2);
  };
  for (const it of allItems) resolveAnchor(it);
  pushAll(warnings, overlapWarnings(rows));
  // An anchor's rule position: a span's start edge, a point marker's middle.
  const anchorDayById = new Map<Id, number>();
  for (const item of allItems) anchorDayById.set(item.id, item.startDay + (item.kind === 'milestone' ? 0.5 : 0));
  for (const row of rows) {
    for (const event of row.cadence?.events ?? []) anchorDayById.set(event.id, event.day + 0.5);
  }
  const calendar = ganttCalendar(allItems, allCadenceDays, env.options, warnings);
  const events = resolveGanttEvents(env.options, anchorDayById, calendar, warnings);
  return {
    rows,
    ...calendar,
    majorStarts: boundariesOf(calendar.tier.major, calendar.d0Day, calendar.d1Day),
    minorStarts: boundariesOf(calendar.tier.minor, calendar.d0Day, calendar.d1Day),
    events,
    eventBadgeMode: events.length > 3,
    // Above three events the labels move to numbered footnotes.
    eventFootnotes: events.length > 3 ? events.map((event) => event.label) : [],
    itemLabelNotes: env.labelOn('item') ? rows.flatMap(row => row.items.flatMap(item =>
      ganttItemLabel(item, env).missing.map(part => `${item.id} (${row.label}): requested ${part} label is empty.`))) : [],
    milestones: planMilestones(rows, env, calendar.d0Day, calendar.d1Day),
  };
}
