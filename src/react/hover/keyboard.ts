/**
 * Keyboard reading of a drawn chart: the order the arrow keys step through
 * its records, and the selection a focused record opens. It lives in the
 * hover engine chunk and runs on the first keyboard focus, never at mount.
 */

import type { InteractionRecord } from '../../core/a11y/types';
import type { ResolvedChartRequest } from '../../core/request';
import { withSmallValues } from '../../core/formatPrecision';
import { minOf } from '../../core/arrays';
import type { RenderGeometry } from '../prepared';
import { bandTypes, categorySiblings, hoverViewport, type HoverModel, type HoverSelection, type HoverView } from './engine';
import { hundredPercentComposition, labelCardContent, sharedLabelCardContent, type CompositionOptions } from './labelCard';

/** Matrix charts read row by row: a row is a series, its cells run along the categories. */
const MATRIX_TYPES: ReadonlySet<string> = new Set(['heatmap', 'cohort', 'status']);
/** Category charts whose arrows follow the drawn records, and the screen axis their categories run along. */
const CATEGORY_AXIS: Readonly<Record<string, 'x' | 'y'>> = { column: 'x', line: 'x', combo: 'x', slope: 'x', bar: 'y', dot: 'y', butterfly: 'y' };
/** Positions closer than this (px) count as the same drawn position. */
const SAME_POSITION = 0.5;
/** Hierarchical charts list their records in tree order already: parent group, then its members. */
const TREE_TYPES: ReadonlySet<string> = new Set(['treemap', 'diagram', 'sankey']);

/**
 * The records the arrow keys reach, in reading order. Per panel, in panel
 * order:
 * - category charts: category by category, each category's series in legend order;
 * - matrix charts (heatmap, cohort, status): row by row;
 * - scatter: by x, then y;
 * - hierarchical charts and every other chart: the order the records list them.
 * Annotations (events, value lines) follow the data records. A record with
 * no card (a diagram node that prints all it carries) is skipped, as the pointer skips it,
 * unless `activation` is set: a host with `onRecordClick` can still activate it.
 */
export function keyboardOrder(model: HoverModel, request: ResolvedChartRequest, geometry: RenderGeometry, activation = false): InteractionRecord[] {
  const records = activation ? model.records : model.records.filter(record => record.cardFields?.length !== 0);
  const data = records.filter(record => record.target.owner.annotationId === undefined);
  const annotations = records.filter(record => record.target.owner.annotationId !== undefined);
  const panels = new Map<string | undefined, InteractionRecord[]>();
  for (const record of data) {
    const group = panels.get(record.target.panel);
    if (group) group.push(record); else panels.set(record.target.panel, [record]);
  }
  const ordered = [...panels].flatMap(([panel, group]) => {
    const type = (panel === undefined ? undefined : model.placement?.panels?.find(entry => entry.panel === panel)?.type) ?? request.type;
    return panelOrder(group, type, panel === undefined ? request.data : undefined, geometry);
  });
  return [...ordered, ...annotations];
}

function panelOrder(records: InteractionRecord[], type: string, data: unknown, geometry: RenderGeometry): InteractionRecord[] {
  const index = new Map(records.map((record, position) => [record, position]));
  const byIndex = (a: InteractionRecord, b: InteractionRecord) => index.get(a)! - index.get(b)!;
  if (TREE_TYPES.has(type)) return records;
  // Matrix geometry also orders synthetic rows and the cohort-size column.
  if (MATRIX_TYPES.has(type)) return [...records].sort((a, b) =>
    (centre(a)?.y ?? 0) - (centre(b)?.y ?? 0) || (centre(a)?.x ?? 0) - (centre(b)?.x ?? 0) || byIndex(a, b));
  if (records.every(record => record.target.owner.pointId !== undefined)) {
    const coordinate = (record: InteractionRecord, key: 'x' | 'y') => {
      const raw = record.fields.find(field => field.key === key)?.value.raw;
      return typeof raw === 'number' ? raw : Number.POSITIVE_INFINITY;
    };
    return [...records].sort((a, b) => coordinate(a, 'x') - coordinate(b, 'x') || coordinate(a, 'y') - coordinate(b, 'y') || byIndex(a, b));
  }
  if (!records.every(record => record.target.owner.categoryId !== undefined)) return records;
  // A drawn category axis reads in drawn order, so a sorted chart starts where the eye does.
  const axis = CATEGORY_AXIS[type];
  const drawn = new Map<string, number>();
  for (const record of axis === undefined ? [] : records) {
    const at = centre(record)?.[axis!];
    const id = String(record.target.owner.categoryId);
    if (at !== undefined) drawn.set(id, Math.min(drawn.get(id) ?? Infinity, at));
  }
  const source = sourceIds(data, 'categories');
  const ids = [...new Set(records.map(record => String(record.target.owner.categoryId)))];
  const categories = rank(records.map(record => record.target.owner.categoryId!), ids.length && ids.every(id => drawn.has(id))
    ? [...ids].sort((a, b) => drawn.get(a)! - drawn.get(b)! || source.indexOf(a) - source.indexOf(b)) : source);
  const legend = geometry.legend?.items.map(item => String(item.id));
  const series = rank(records.flatMap(record => record.target.owner.seriesId ?? []).map(String), legend?.length ? legend : sourceIds(data, 'series'));
  const category = (record: InteractionRecord) => categories.get(record.target.owner.categoryId!)!;
  const seriesOf = (record: InteractionRecord) => record.target.owner.seriesId === undefined ? -1 : series.get(String(record.target.owner.seriesId))!;
  return [...records].sort((a, b) => category(a) - category(b) || seriesOf(a) - seriesOf(b) || byIndex(a, b));
}

/** The drawn centre of a record's mark, or undefined for a record that draws none. */
function centre(record: InteractionRecord): { x: number; y: number } | undefined {
  const anchor = record.anchor;
  if (!anchor) return undefined;
  return 'w' in anchor ? { x: anchor.x + anchor.w / 2, y: anchor.y + anchor.h / 2 } : { x: anchor.x, y: anchor.y };
}

/**
 * The record an arrow, Home or End reaches from `index` of the reading order. Arrows follow the
 * drawn records of the panel; the record reached lies in the pressed direction, or the key stays.
 * - category charts: along the category axis, the next drawn position (the same series there
 *   first); across it, the nearest record of the same category at the same position, so Up on a
 *   stacked column reaches the segment drawn above and on a line the line drawn above;
 * - heatmap, cohort, status: the nearest cell in the same drawn row or column;
 * - scatter: Left/Right the next drawn x (the nearest y there), Up/Down the next point at the
 *   same x, else the nearest point in that half-plane.
 * Records at one position are read in turn first. A record without a drawn mark keeps list
 * access, and the first or last record of a panel leads on to the next panel or annotation.
 */
export function keyboardStep(records: readonly InteractionRecord[], index: number, key: string,
  model: HoverModel, request: ResolvedChartRequest): number {
  if (key === 'Home') return 0;
  if (key === 'End') return records.length - 1;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  const current = records[index];
  if (!current || current.target.owner.annotationId !== undefined) return index + step;
  const { panel, owner } = current.target;
  const type = (panel === undefined ? undefined : model.placement?.panels?.find(entry => entry.panel === panel)?.type) ?? request.type;
  const categoryAxis = owner.categoryId !== undefined ? CATEGORY_AXIS[type] : undefined;
  const matrix = MATRIX_TYPES.has(type);
  if (categoryAxis === undefined && !matrix && type !== 'scatter') return index + step;
  const at = centre(current);
  const inPanel = (record: InteractionRecord | undefined) => record !== undefined && record.target.panel === panel && record.target.owner.annotationId === undefined;
  const adjacent = records[index + step];
  if (!at || (inPanel(adjacent) && !centre(adjacent!))) return index + step;
  const axis = key === 'ArrowLeft' || key === 'ArrowRight' ? 'x' : 'y';
  const cross = axis === 'x' ? 'y' : 'x';
  const members: { at: number; c: { x: number; y: number }; record: InteractionRecord }[] = [];
  let first = -1;
  let last = -1;
  for (let position = 0; position < records.length; position++) {
    const record = records[position]!;
    if (!inPanel(record)) continue;
    if (first < 0) first = position;
    last = position;
    const c = centre(record);
    if (c) members.push({ at: position, c, record });
  }
  // Records drawn at one position are read in turn before the arrow leaves it.
  const together = members.filter(m => m.c.x === at.x && m.c.y === at.y);
  const mine = together.findIndex(m => m.at === index);
  if (together[mine + step]) return together[mine + step]!.at;
  const ahead = (m: { c: { x: number; y: number } }) => (m.c[axis] - at[axis]) * step;
  const nearest = (pool: typeof members, score: (m: (typeof members)[number]) => number) =>
    pool.reduce<(typeof members)[number] | undefined>((best, m) => best === undefined || score(m) < score(best) ? m : best, undefined);
  let next: (typeof members)[number] | undefined;
  const forward = members.filter(m => ahead(m) > 0 && !together.includes(m));
  if (categoryAxis === axis || (axis === 'x' && type === 'scatter')) {
    // The next drawn position along the axis; there, the same series, else the nearest across.
    const gap = minOf(forward.map(ahead));
    const there = forward.filter(m => ahead(m) - gap < SAME_POSITION);
    next = (categoryAxis === axis ? nearest(there.filter(m => m.record.target.owner.seriesId === owner.seriesId), ahead) : undefined)
      ?? nearest(there, m => Math.abs(m.c[cross] - at[cross]));
  } else if (categoryAxis !== undefined) {
    next = nearest(forward.filter(m => m.record.target.owner.categoryId === owner.categoryId
      && Math.abs(m.c[categoryAxis] - at[categoryAxis]) < SAME_POSITION), ahead);
  } else if (matrix) {
    next = nearest(forward.filter(m => Math.abs(m.c[cross] - at[cross]) < SAME_POSITION), ahead);
  } else {
    next = nearest(forward.filter(m => Math.abs(m.c[cross] - at[cross]) < SAME_POSITION), ahead)
      ?? nearest(forward, m => (m.c.x - at.x) ** 2 + (m.c.y - at.y) ** 2);
  }
  if (next) return next.at;
  // The panel's ends lead on, so the next panel and the annotations stay reachable.
  return index === (step > 0 ? last : first) ? index + step : index;
}

/** The ids of a source list (`data.categories`, `data.series`): plain strings or objects with an id. */
function sourceIds(data: unknown, key: 'categories' | 'series'): string[] {
  const list = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap(entry => typeof entry === 'string' ? [entry]
    : entry && typeof entry === 'object' && 'id' in entry ? [String((entry as { id: unknown }).id)] : []);
}

/** Rank by the source order; an id the source does not list (an Others bucket) follows in the order the records first name it. */
function rank(ids: readonly string[], source: readonly string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const id of source) if (!ranks.has(id)) ranks.set(id, ranks.size);
  for (const id of ids) if (!ranks.has(id)) ranks.set(id, ranks.size);
  return ranks;
}

/** The records a focused record opens: itself first, then its category's other series, as the pointer opens them. */
export function keyboardTargets(model: HoverModel, request: ResolvedChartRequest, record: InteractionRecord): InteractionRecord[] {
  if (record.target.owner.annotationId !== undefined) return [record];
  const panel = record.target.panel === undefined ? undefined : model.placement?.panels?.find(entry => entry.panel === record.target.panel);
  const type = panel?.type ?? request.type;
  const records = model.records.filter(entry => entry.cardFields?.length !== 0);
  return [record, ...categorySiblings(records, record, bandTypes[type] !== undefined, type === 'line')];
}

/** The selection of a keyboard-focused record: measured once on the chart host, with no pointer, so the card sits beside the mark. */
export function keyboardSelection(model: HoverModel, request: ResolvedChartRequest, host: HTMLElement, view: HoverView,
  selection: HoverSelection, record: InteractionRecord): HoverSelection {
  const measurement = selection.measurement?.host === host ? selection.measurement
    : { host, size: view.size, viewport: hoverViewport(host, view.size) };
  measurement.pointer = undefined;
  const ids = keyboardTargets(model, request, record).map(entry => entry.id);
  return { ids, measurement, position: { viewport: measurement.viewport && { ...measurement.viewport, pointer: undefined },
    panel: view.panel, previousSide: view.card?.side } };
}

/**
 * What a screen reader hears for a focused record: the card's reading of the
 * records it opens. A card that leaves out what the mark prints (`cardFields`)
 * is read in full here: the reader cannot see the printed label.
 */
export function keyboardReading(model: HoverModel, request: ResolvedChartRequest, record: InteractionRecord): string {
  const active = keyboardTargets(model, request, record);
  const panel = record.target.panel === undefined ? undefined : model.placement?.panels?.find(entry => entry.panel === record.target.panel);
  const options = { hundredPercent: hundredPercentComposition(panel?.type ?? request.type,
    panel ? panel.composition : request.options as CompositionOptions) };
  const locale = request.locale?.language;
  return withSmallValues(request.options.smallValues, () => active.length > 1
    ? sharedLabelCardContent(active, locale, options).accessibleText
    : labelCardContent({ ...record, cardFields: undefined }, locale, options).accessibleText);
}
