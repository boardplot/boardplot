import type { ClaimRecordV1 } from '../claims/browser';
import type { ResolvedChartRequest } from '../request';
import { textRole } from '../textRole';
import type { AnchorRef, Annotation } from '../types/annotations';
import { cellMeta, cellValue, isDateCell, isPctCell, type Cell, type OwnerRef } from '../types/cell';
import type { Geometry, PlacedAnnotation, SceneNode } from '../types/scene';
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
  valueTextByOwner?: Map<string, string>;
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

function matchesAnchor(owner: OwnerRef, anchor: AnchorRef): boolean {
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

/**
 * The value label the chart drew for an owner, by the owner's own keys: the
 * text node with the numeric role whose owner names the same category and
 * series (and point or row where the owner has one). A hidden label leaves
 * the record without one and the card falls back to the format.
 */
function indexValueTexts(ctx: RecordContext): Map<string, string> {
  if (ctx.valueTextByOwner) return ctx.valueTextByOwner;
  const index = new Map<string, string>();
  const seen = new Set<string>();
  for (const node of ctx.geometry.scene) {
    // The role the renderer resolves for the node: most value labels carry
    // none of their own and take it from their part.
    if (node.t !== 'text' || node.part === 'interaction-label' || textRole(node) !== 'value') continue;
    const key = ownerKey(node.owner);
    // Two numeric texts on one owner (a value and its account median on a
    // creative card) leave the record without a drawn label: the card then
    // prints the format path, never the wrong number.
    if (seen.has(key)) index.delete(key); else index.set(key, node.lines.join(' '));
    seen.add(key);
  }
  ctx.valueTextByOwner = index;
  return index;
}

/**
 * Whether a drawn label reads as the record's own number: its digits, sign,
 * magnitude letter and percent sign, taken as a number, land within half of
 * the label's last printed unit of the source value. A share label beside a
 * level ("44%" on a 6.1 % segment), a fraction drawn as a percent ("100" on
 * 1.0) or a label of another quantity stays off the record; the card then
 * prints the source number through the format.
 */
function readsAsValue(drawn: string, raw: number): boolean {
  let text = drawn.replace(/[\s\u00a0\u202f\u2009']/g, '');
  let sign = 1;
  if (/^\(.*\)$/.test(text)) { sign = -1; text = text.slice(1, -1); }
  if (/^[\u2212-]/.test(text)) { sign = -sign; text = text.slice(1); } else if (text.startsWith('+')) text = text.slice(1);
  text = text.replace(/^[$\u20ac\u00a3\u00a5]+/, '').replace(/%$/, '');
  const magnitude = /(tn|t|bn|b|mn|mm|m|k)$/i.exec(text);
  let scale = 1;
  if (magnitude) {
    const letter = magnitude[1]!.toLowerCase();
    scale = letter === 'k' ? 1e3 : letter === 'bn' || letter === 'b' ? 1e9 : letter === 'tn' || letter === 't' ? 1e12 : 1e6;
    text = text.slice(0, -magnitude[1]!.length);
  }
  if (!/^\d[\d.,]*$/.test(text)) return false;
  // Two separator kinds: the last one is the decimal mark. One kind: a
  // decimal mark when it appears once with one or two digits after it.
  const lastDot = text.lastIndexOf('.'); const lastComma = text.lastIndexOf(',');
  let decimalMark = '';
  if (lastDot >= 0 && lastComma >= 0) decimalMark = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? '.' : ',';
    const parts = text.split(mark);
    if (parts.length === 2 && parts[1]!.length > 0 && parts[1]!.length !== 3) decimalMark = mark;
    else if (mark === '.' && parts.length === 2) decimalMark = '.';
  }
  const grouping = decimalMark === '.' ? ',' : decimalMark === ',' ? '.' : /[.,]/;
  let normalized = text.split(grouping as string).join('');
  if (decimalMark === ',') normalized = normalized.replace(',', '.');
  const decimals = decimalMark ? (normalized.split('.')[1]?.length ?? 0) : 0;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return false;
  const tolerance = 0.5 * Math.pow(10, -decimals) * scale + 1e-9 * Math.max(1, Math.abs(raw));
  return Math.abs(sign * value * scale - raw) <= tolerance;
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
  const candidate = value.kind === 'number' && value.state === 'value' && value.displayed === undefined
    ? indexValueTexts(ctx).get(ownerKey(owner)) : undefined;
  const drawn = candidate !== undefined && typeof value.raw === 'number' && readsAsValue(candidate, value.raw) ? candidate : undefined;
  return {
    id: targetId(target), target, value: drawn === undefined ? value : { ...value, displayed: drawn },
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
