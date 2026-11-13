import type { ClaimRecordV1 } from '../claims/browser';
import type { ResolvedChartRequest } from '../request';
import { textRole } from '../textRole';
import type { AnchorRef, Annotation } from '../types/annotations';
import { cellMeta, cellValue, isDateCell, isPctCell, type Cell, type OwnerRef } from '../types/cell';
import type { Geometry, PlacedAnnotation, SceneNode, ShownMark, ShownTexts } from '../types/scene';
import type { InteractionRecord, InteractionScope, InteractionTarget, InteractionValue } from './types';
import { DERIVED_PERCENT_FORMAT, percentExample } from './valueText';
import type { NamedColumnState } from '../schema/namedColumns';
import { chartString } from '../strings/a11y-statisticsRecords';
import type { BaseOptions } from '../types/options';

export interface RecordContext {
  request: ResolvedChartRequest;
  geometry: Geometry;
  scope: InteractionScope;
  claims: readonly ClaimRecordV1[];
  nodeIdsByOwner?: Map<string, string[]>;
  claimsByNode?: Map<string, string[]>;
}

function ownerKey(owner: OwnerRef): string {
  return JSON.stringify(Object.keys(owner).sort().map(key => [key, owner[key as keyof OwnerRef]]));
}

export function targetId(target: InteractionTarget): string {
  return JSON.stringify([target.chart, target.panel ?? null, ownerKey(target.owner)]);
}

export function numericValue(raw: number | null | undefined, unit?: string, format?: string): InteractionValue {
  return {
    kind: 'number', raw: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
    state: raw == null ? 'missing' : Number.isFinite(raw) ? 'value' : 'nm',
    ...(unit === undefined ? {} : { unit }), ...(format === undefined ? {} : { format }),
    ...(raw == null ? { reason: 'No observation' } : Number.isFinite(raw) ? {} : { reason: 'Non-finite value' }),
  };
}

/**
 * A number the engine derived from the data (a sum, a running level, a share
 * base, a swing) as a record value, in the unit and format of the values it
 * came from and without the residue of binary arithmetic: 112.3 + 80.5 + 57.4
 * reads 250.2, never 250.20000000000002. Fifteen significant digits leave
 * every decimal a reader can type unchanged. Authored values do not pass
 * through here; they stay exact.
 */
export function withoutResidue(raw: number): number {
  return Number.isFinite(raw) && !Number.isInteger(raw) ? Number(raw.toPrecision(15)) : raw;
}
export function derivedValue(raw: number | null | undefined, unit?: string, format?: string): InteractionValue {
  return { ...numericValue(typeof raw === 'number' ? withoutResidue(raw) : raw, unit, format), derived: 'number' };
}

/**
 * A percentage the engine derived (a share, a conversion, an attainment, a
 * change, a cumulative share, a retention) as a record value. The ratio
 * stays exact; the record names the share format, so the hover card and the
 * accessible table print "44.76%", never "44.761904761904766%". A retention
 * the records keep as a fraction prints as its percentage.
 */
export function derivedPercent(raw: number | null | undefined, unit: '%' | 'fraction' = '%'): InteractionValue {
  return { ...numericValue(raw, unit, DERIVED_PERCENT_FORMAT), derived: 'percent' };
}

export function textValue(raw: string | null | undefined, kind: 'text' | 'date' = 'text'): InteractionValue {
  return { kind, raw: raw ?? null, state: raw == null ? 'missing' : 'value',
    ...(raw == null ? { reason: 'No observation' } : {}) };
}

/** A value with no number because its row says why: withheld, not meaningful or not applicable. */
export function statedValue(value: InteractionValue, state: NamedColumnState, options: Pick<BaseOptions, 'locale' | 'strings'>): InteractionValue {
  return { ...value, raw: null, state,
    reason: chartString(options, state === 'suppressed' ? 'valueWithheld' : state === 'nm' ? 'notMeaningful' : 'notApplicableName') };
}

export function cellRecordValue(cell: Cell, unit?: string, format?: string): InteractionValue {
  if (isDateCell(cell)) return textValue(cell.date, 'date');
  return numericValue(cellValue(cell), isPctCell(cell) ? '%' : unit, cellMeta(cell)?.format ?? format);
}

export function ownerContains(owner: OwnerRef, required: OwnerRef): boolean {
  const keys = Object.keys(required) as (keyof OwnerRef)[];
  for (const key of keys) if (required[key] !== owner[key]) return false;
  return keys.length > 0;
}

function matchesAnchor(owner: OwnerRef, anchor: AnchorRef | { annotationId: string }): boolean {
  if (typeof anchor === 'string') return [owner.categoryId, owner.pointId, owner.rowId].includes(anchor);
  const { edge: _edge, ...keys } = anchor as OwnerRef & { edge?: string };
  return ownerContains(owner, keys);
}

function annotationMatches(owner: OwnerRef, annotation: Annotation): boolean {
  if ('at' in annotation) return annotation.at !== undefined && matchesAnchor(owner, annotation.at);
  if ('from' in annotation && annotation.from && matchesAnchor(owner, annotation.from)) return true;
  return 'to' in annotation && Boolean(annotation.to && matchesAnchor(owner, annotation.to));
}

function indexNodes(ctx: RecordContext): Map<string, string[]> {
  if (ctx.nodeIdsByOwner) return ctx.nodeIdsByOwner;
  const index = new Map<string, string[]>();
  for (const node of ctx.geometry.scene) {
    if (node.t === 'text') continue;
    const keys = Object.keys(node.owner) as (keyof OwnerRef)[];
    for (let mask = 1; mask < 2 ** keys.length; mask++) {
      const subset: OwnerRef = {};
      for (let i = 0; i < keys.length; i++) if (mask & 2 ** i) subset[keys[i]!] = node.owner[keys[i]!];
      const key = ownerKey(subset);
      const matches = index.get(key);
      if (matches) matches.push(node.id); else index.set(key, [node.id]);
    }
  }
  ctx.nodeIdsByOwner = index;
  return index;
}

/** A format the author set (chart, series or cell); a derived percent's share format is the engine's. */
const authoredFormat = (value: InteractionValue): boolean => value.format !== undefined && value.derived !== 'percent';

/**
 * Each record value takes the text the layout states for it (ShownTexts): the
 * text a drawn node prints for the value, else, under an authored format, the
 * text its label would print (a label the solver dropped, the value's own mark
 * where no label is drawn, or `geometry.marks.shown` where the value has no node). The layout names the value; nothing here
 * reads a number out of a text. A value without such a text keeps none.
 */
export function withShownTexts(records: InteractionRecord[], geometry: Geometry): InteractionRecord[] {
  const drawn = new Map<string, Record<string, string>>();
  const undrawn = new Map<string, Record<string, string>>();
  const add = (index: Map<string, Record<string, string>>, owner: OwnerRef, shows: ShownTexts) => {
    const key = ownerKey(owner);
    const into = index.get(key) ?? {};
    for (const [slot, text] of Object.entries(shows)) into[slot] ??= text;
    index.set(key, into);
  };
  for (const label of geometry.labels) if (label.hidden !== undefined && label.shows) add(undrawn, label.owner, label.shows);
  for (const mark of (geometry.marks as { shown?: readonly ShownMark[] } | undefined)?.shown ?? []) add(mark.drawn ? drawn : undrawn, mark.owner, mark.shows);
  for (const node of geometry.scene) {
    const shows = node.display?.shows;
    if (!shows) continue;
    if (node.t === 'text') { if (node.opacity !== 0) add(drawn, node.owner, shows); } else add(undrawn, node.owner, shows);
  }
  if (drawn.size === 0 && undrawn.size === 0) return records;
  for (const record of records) {
    const key = ownerKey(record.target.owner);
    const own = drawn.get(key);
    const would = undrawn.get(key);
    if (!own && !would) continue;
    const shown = (slot: string, value: InteractionValue): InteractionValue => {
      if (value.kind !== 'number' || value.state !== 'value' || value.displayed !== undefined) return value;
      const text = own?.[slot] ?? (authoredFormat(value) ? would?.[slot] : undefined);
      return text === undefined ? value : { ...value, displayed: text };
    };
    record.value = shown('value', record.value);
    record.fields = record.fields.map(field => ({ ...field, value: shown(`field:${field.key}`, field.value) }));
    if (record.share) record.share = { ...record.share, percent: shown('share.percent', record.share.percent) };
    record.comparisons = record.comparisons.map((comparison, index) => ({ ...comparison,
      delta: shown(`cmp${index}.delta`, comparison.delta), percent: shown(`cmp${index}.percent`, comparison.percent) }));
  }
  return records;
}

function claimIdsFor(ctx: RecordContext, nodeIds: string[]): string[] {
  if (!ctx.claimsByNode) {
    ctx.claimsByNode = new Map();
    for (const claim of ctx.claims) if (claim.nodeId) {
      const matches = ctx.claimsByNode.get(claim.nodeId);
      if (matches) matches.push(claim.id); else ctx.claimsByNode.set(claim.nodeId, [claim.id]);
    }
  }
  return [...new Set(nodeIds.flatMap(id => ctx.claimsByNode!.get(id) ?? []))];
}

/**
 * Whether the chart draws the annotation's whole text. The reader
 * has read it there, so the record does not hand it to every mark the
 * annotation anchors on; a hidden or cut label stays on the record.
 */
function printsInFull(ctx: RecordContext, placed: PlacedAnnotation | undefined, text: string): boolean {
  const nodeId = placed?.labelNodeId ?? (placed?.labelId === undefined ? undefined : `label:${placed.labelId}`);
  const node = nodeId === undefined ? undefined : ctx.geometry.scene.find(item => item.id === nodeId);
  const words = (value: string) => value.replace(/\s+/g, ' ').trim();
  return node?.t === 'text' && words(node.lines.join(' ')) === words(text);
}

export function makeRecord(
  ctx: RecordContext, owner: OwnerRef, value: InteractionValue,
  details: Partial<Omit<InteractionRecord, 'id' | 'target' | 'value'>> = {},
): InteractionRecord {
  const target = { ...ctx.scope, owner };
  const nodeIds = details.nodeIds ?? indexNodes(ctx).get(ownerKey(owner)) ?? [];
  const annotations = ctx.request.annotations.flatMap((annotation, index) => {
    if (!annotationMatches(owner, annotation)) return [];
    const id = annotation.id ?? `${annotation.kind}-${index + 1}`;
    const placed = ctx.geometry.annotations.find(item => item.id === id);
    const text = placed?.computedText ?? annotation.text ?? ('label' in annotation ? annotation.label || '' : '');
    return printsInFull(ctx, placed, text) ? [] : [{ id, text }];
  });
  return {
    id: targetId(target), target, value,
    label: Object.values(owner).join(' / '), fields: [], comparisons: [], annotations,
    claimIds: claimIdsFor(ctx, nodeIds),
    nodeIds, ...details,
  };
}

/** Text that is not a data label: its percentages say nothing about the exhibit's precision. */
const PROSE_ROLES: ReadonlySet<string> = new Set(['title', 'subtitle', 'source', 'note', 'axis']);

/**
 * The decimals the exhibit prints its percentages at: the most any drawn
 * data label with a % carries ("43.9%" is one, "44% advance" and "(45%)"
 * none); one where the chart draws no percentage. A card's share or
 * cumulative share prints at this precision, so it never reads 27.69 %
 * beside a cell that says 27.7 %.
 */
function exhibitPercentDecimals(scene: readonly SceneNode[]): number {
  let decimals: number | undefined;
  for (const node of scene) {
    if (node.t !== 'text' || node.part === 'interaction-label' || PROSE_ROLES.has(textRole(node))) continue;
    for (const match of node.lines.join(' ').matchAll(/\d(?:[.,](\d+))?[\s\u00a0\u202f]?%/g)) {
      decimals = Math.max(decimals ?? 0, match[1]?.length ?? 0);
    }
  }
  return decimals ?? 1;
}

/**
 * Every computed percentage (a comparison's too) and every share in the
 * records takes the exhibit's percent precision in place of the flat two
 * decimals.
 */
export function withExhibitPercentFormat(records: InteractionRecord[], scene: readonly SceneNode[]): InteractionRecord[] {
  const format = percentExample(exhibitPercentDecimals(scene));
  const derived = (value: InteractionValue): InteractionValue =>
    value.derived === 'percent' && value.format === DERIVED_PERCENT_FORMAT ? { ...value, format } : value;
  const share = (value: InteractionValue): InteractionValue =>
    value.unit === '%' && value.derived === undefined && value.format === undefined && value.state === 'value' ? { ...value, format } : derived(value);
  for (const record of records) {
    record.value = derived(record.value);
    record.fields = record.fields.map(entry => ({ ...entry, value: derived(entry.value) }));
    record.comparisons = record.comparisons.map(comparison => ({ ...comparison, percent: derived(comparison.percent) }));
    if (record.share) record.share = { ...record.share, percent: share(record.share.percent) };
  }
  return records;
}
