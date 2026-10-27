import { chartNotes, engineNoteMeta } from '../notes';
import { textRole } from '../textRole';
import { dropWarnings } from '../paintWarnings';
import type { OwnerRef } from '../types/cell';
import type { Geometry, PlacedLabel, SceneNode } from '../types/scene';

const words = (text: string) => text.replace(/\s+/g, ' ').trim();
const ownerKey = (owner: OwnerRef) => JSON.stringify([owner.seriesId, owner.categoryId, owner.segmentId, owner.pointId, owner.valueLineId, owner.annotationId, owner.rowId, owner.colId]);

/** Only a whole token counts: 1 is not 11, -1 or 1.5. */
export function containsText(hay: string, needle: string): boolean {
  for (let at = needle ? hay.indexOf(needle) : -1; at >= 0; at = hay.indexOf(needle, at + 1)) {
    if (!/[\p{L}\p{N}.,+\-−]$/u.test(hay.slice(0, at)) && !/^([\p{L}\p{N}]|[.,]\p{N})/u.test(hay.slice(at + needle.length))) return true;
  }
  return false;
}

/** Resolve a second home from actual printed text, including keys, cells, notes and callouts. */
export function readableLabelDestination(geo: Geometry<object, object>): (id: string, text: string, owner?: OwnerRef, kind?: string, qualifiedText?: string) => string | undefined {
  type Text = Extract<SceneNode, { t: 'text' }>;
  let index: { nodes: Map<string, Text>; text: Map<string, string>; owner: Map<string, string>; labels: Map<string, PlacedLabel>; painted: Map<string, PlacedLabel>; exact: Map<string, Text[]>; owners: Map<string, Text[]>; notes: Text[] } | undefined;
  const prepare = () => {
    if (index) return index;
    index = { nodes: new Map(), text: new Map(), owner: new Map(), labels: new Map(geo.labels.map(label => [label.id, label])), painted: new Map(), exact: new Map(), owners: new Map(), notes: [] };
    const append = (map: Map<string, Text[]>, key: string, node: Text) => { const list = map.get(key); if (list) list.push(node); else map.set(key, [node]); };
    for (const node of geo.scene) if (node.t === 'text' && node.opacity !== 0 && words(node.lines.join(' '))) {
      index.nodes.set(node.id, node);
    }
    for (const node of index.nodes.values()) {
      const body = index.nodes.get(`${node.id}:body`);
      const printed = body ? { ...node, lines: [...node.lines, ...body.lines] } : node;
      const text = words(printed.lines.join(' '));
      const owner = ownerKey(node.origin?.owner ?? node.owner);
      index.text.set(node.id, text);
      index.owner.set(node.id, owner);
      append(index.exact, text, printed);
      append(index.owners, owner, printed);
      if (textRole(node) === 'note' || textRole(node) === 'source') index.notes.push(printed);
    }
    for (const label of geo.labels) if (!label.hidden) {
      const node = index.nodes.get(label.nodeId ?? `label:${label.id}`);
      if (node) {
        index.painted.set(node.id, label);
        if (index.nodes.has(`${node.id}:body`)) index.painted.set(`${node.id}:body`, label);
        for (const owner of label.printsFor ?? []) append(index.owners, ownerKey(owner), node);
      }
    }
    return index;
  };
  return (id, text, owner = {}, kind, qualifiedText = text) => {
    const { nodes, text: printedText, owner: nodeOwners, labels, painted, exact, owners, notes } = prepare();
    const normalized = words(text);
    const label = labels.get(id);
    const scope = (geo.marks as { panels?: unknown }).panels ? omissionScope(geo, undefined, id) : undefined;
    const local = scope?.id ?? id;
    const prefix = id.slice(0, id.length - local.length);
    if (label?.printedIn) {
      const hostId = prefix + label.printedIn;
      const host = labels.get(hostId);
      const node = nodes.get(host?.nodeId ?? `label:${hostId}`) ?? nodes.get(hostId);
      const printed = node ? printedText.get(node.id)! : '';
      if (node && (containsText(printed, words(host?.text ?? text)) || containsText(printed, normalized))) return `label:${hostId}`;
    }
    const named = kind === 'series' || kind === 'category' || kind === 'restSeries' || kind === 'source';
    const numeric = ['point', 'segment', 'total', 'grandTotal', 'insidePie', 'outsidePie', 'growth'].includes(kind ?? '') && label?.role !== 'category' && label?.printsFor?.length !== 0;
    const own = ownerKey(owner);
    const scoped = (node: Text) => !prefix || node.id.startsWith(prefix) || node.origin?.panels.some(panel => prefix.startsWith(`${panel}/`));
    const sameOwner = (node: Text) => Object.keys(owner).length > 0 && nodeOwners.get(node.id) === own;
    const sameQuantity = (node: Text) => !numeric || textRole(node) === 'value' && (painted.get(node.id)?.kind === kind
      || label?.claimId !== undefined && painted.get(node.id)?.claimId === label.claimId || owner.rowId !== undefined && owner.colId !== undefined);
    const match = (exact.get(normalized) ?? []).find(node => scoped(node) && (sameOwner(node) && sameQuantity(node) || named && !['value', 'axis'].includes(textRole(node))));
    if (match) return `scene:${match.id}`;
    // An explicit printsFor owner is stronger than the host's own semantic owner.
    const shared = Object.keys(owner).length ? owners.get(own)?.find(node => scoped(node) && containsText(printedText.get(node.id)!, normalized) && (sameOwner(node) ? named : true)) : undefined;
    if (shared) return `scene:${shared.id}`;
    const geometry = scope?.geometry ?? geo;
    if (geometry.type === 'line' && owner.seriesId && owner.categoryId) {
      const endpoint = (geometry.derived as { endpoints?: Record<string, { categoryId: string }> }).endpoints?.[owner.seriesId];
      const value = endpoint?.categoryId === owner.categoryId
        ? (owners.get(ownerKey({ seriesId: owner.seriesId })) ?? []).find(node => scoped(node) && node.part === 'legendValue' && printedText.get(node.id) === normalized) : undefined;
      if (value) return `scene:${value.id}`;
    }
    // Qualified note text names the owner too; a bare repeated number cannot identify a note item.
    const noteText = words(qualifiedText);
    const note = /\p{L}/u.test(noteText) || kind === 'source' ? notes.find(node => scoped(node) && containsText(printedText.get(node.id)!, noteText)) : undefined;
    return note ? `scene:${note.id}` : undefined;
  };
}

type LabelOptions = { labels?: unknown; labelDensity?: string; valueLabels?: string; seriesLabels?: unknown; labelPlacements?: Record<string, unknown> };

/** Read a panel's effective choices, rather than applying the grid's choices to every panel. */
export function omissionScope(geo: Geometry<object, object>, options: LabelOptions | undefined, id: string, data?: unknown): { geometry: Geometry<object, object>; options: LabelOptions | undefined; id: string; data: unknown } {
  const panels = (geo.marks as { panels?: { id: string; chart?: { geometry: Geometry<object, object>; options: LabelOptions } }[] }).panels;
  const panel = panels?.find(panel => id.startsWith(`${panel.id}/`) && panel.chart);
  const sourcePanel = (data as { panels?: { id: string; data: unknown }[] } | undefined)?.panels?.find(source => source.id === panel?.id);
  return panel?.chart ? omissionScope(panel.chart.geometry, panel.chart.options, id.slice(panel.id.length + 1), sourcePanel?.data) : { geometry: geo, options, id, data };
}

/** Author choices may drop automatic labels, but an explicit label request still has to print. */
function intentionalOmission(geo: Geometry<object, object>, options: LabelOptions | undefined, data: unknown, omission: LabelOmission, labelFor: (id: string) => PlacedLabel | undefined): boolean {
  const scope = omissionScope(geo, options, omission.labelId, data);
  const settings = typeof scope.options?.labels === 'object' && scope.options.labels !== null
    ? scope.options.labels as Record<string, unknown> : undefined;
  if (scope.options?.labelDensity !== 'minimal' && scope.options?.labels !== false && !Object.values(settings ?? {}).includes(false)) return false;
  const label = labelFor(omission.labelId);
  const kind = label?.kind ?? scope.id.split(':')[0]!;
  const setting = settings?.[kind];
  if (scope.options?.labelDensity !== 'minimal' && scope.options?.labels !== false && setting !== false && settings?.restSeries !== false) return false;
  if (setting === true || Array.isArray(setting) && setting.length > 0 || scope.options?.labelPlacements?.[scope.id] !== undefined) return false;
  if ((kind === 'point' || kind === 'segment') && scope.options?.valueLabels !== undefined && scope.options.valueLabels !== 'none') return false;
  if ((kind === 'series' || kind === 'restSeries') && scope.options?.seriesLabels !== undefined && scope.options.seriesLabels !== 'none') return false;
  if (kind === 'annotation' || kind === 'axisTitle' || kind === 'valueLine') return false;
  if (scope.options?.labels === false || setting === false) return true;
  const series = (scope.data as { series?: { id: string; colorRole?: string }[] } | undefined)?.series;
  if (settings?.restSeries === false && series?.some(series => series.id === label?.owner.seriesId && series.colorRole === 'others')) return true;
  return scope.options?.labelDensity === 'minimal' && (label?.hidden === 'density' || omission.reason === 'density');
}

/** A label kept in the reading when the final scene does not print it. */
export interface LabelOmission {
  labelId: string;
  text: string;
  reason: string;
  destination: string;
}

/** Full text from the accepted scene, including text outside the label solver. */
export function cutLabels(geo: Geometry<object, object>): { labelId: string; text: string; displayed: string }[] {
  let labels: Map<string, PlacedLabel> | undefined;
  const cuts = new Map<string, { labelId: string; text: string; displayed: string }>();
  for (const node of geo.scene) {
    if (node.t !== 'text' || node.opacity === 0 || !node.title || node.part === 'storyTitle' || node.part === 'storyBody') continue;
    // An event's title line carries the whole event as its title, not a cut: the lane and the key never cut event text.
    if (node.focusStop || node.part === 'eventKey') continue;
    const displayed = node.lines.join(' ');
    if (words(displayed) === words(node.title)) continue;
    labels ??= new Map(geo.labels.map(label => [label.nodeId ?? `label:${label.id}`, label]));
    const label = labels.get(node.id);
    const labelId = label?.id ?? node.id;
    cuts.set(labelId, { labelId, text: node.title, displayed });
  }
  for (const step of geo.story?.steps ?? []) for (const field of ['title', 'body'] as const) {
    const text = step[field];
    if (!text) continue;
    const displayed = step.nodes.filter(node => node.t === 'text' && node.part === (field === 'title' ? 'storyTitle' : 'storyBody'))
      .flatMap(node => node.t === 'text' ? node.lines : []).join(' ');
    if (words(displayed) !== words(text)) {
      const labelId = `story:${step.id}:${field}`;
      cuts.set(labelId, { labelId, text, displayed });
    }
  }
  return [...cuts.values()];
}

/** Resolve a tick's authored name, following the same panel prefix as its axis. */
function axisLabelText(data: unknown, at: string | number, labelId: string): string {
  if (typeof data !== 'object' || data === null) return String(at);
  const source = data as Record<string, unknown>;
  if (Array.isArray(source.panels)) {
    const panel = source.panels.find(panel => typeof panel?.id === 'string' && labelId.startsWith(`${panel.id}/`));
    if (panel) return axisLabelText(panel.data, at, labelId.slice(panel.id.length + 1));
  }
  const keys = /(?:^|[:/])category:/.test(labelId) ? ['categories', 'columns'] : ['series', 'rows'];
  for (const key of keys) {
    const list = source[key];
    if (!Array.isArray(list)) continue;
    const item = list.find(item => (typeof item === 'object' && item !== null ? item.id : item) === at);
    if (item !== undefined) return typeof item === 'object' && item !== null ? String(item.label ?? at) : String(item);
  }
  return String(at);
}

/** Read the accepted geometry. This pass never changes labels, notes or layout. */
export function labelOmissions(geo: Geometry<object, object>, options?: { labels?: unknown }, data?: unknown): LabelOmission[] {
  const omissions: LabelOmission[] = [];
  const destinationOf = readableLabelDestination(geo);
  for (const cut of cutLabels(geo)) omissions.push({ labelId: cut.labelId, text: cut.text,
    reason: 'truncated', destination: destinationOf(cut.labelId, cut.text) ?? 'reading.omissions' });
  const labels = new Set<string>();
  for (const label of geo.labels) {
    labels.add(label.id);
    if (label.hidden === undefined) continue;
    omissions.push({ labelId: label.id, text: label.noteText ?? label.text,
      reason: label.noted ? 'note' : label.hidden,
      destination: destinationOf(label.id, label.text, label.owner, label.kind, label.noteText)
        ?? label.noteLocation ?? (label.printedIn ? `label:${label.printedIn}` : 'reading.omissions') });
  }
  // Some category planners omit off-stride requests before calling the solver.
  // Their axis ticks still name each requested label, including in a grid.
  let drawn: Set<string> | undefined;
  for (const axis of geo.axes) for (const tick of axis.ticks) {
    if (!tick.labelId || labels.has(tick.labelId)) continue;
    drawn ??= new Set(geo.scene.flatMap(node => node.t === 'text' && node.opacity !== 0
      && node.lines.some(line => line.trim() !== '') ? [node.id] : []));
    if (drawn.has(tick.labelId) || drawn.has(`label:${tick.labelId}`)) continue;
    labels.add(tick.labelId);
    const kind = /(?:^|[:/])category:/.test(tick.labelId) ? 'category' : 'series';
    const choice = omissionScope(geo, options, tick.labelId).options?.labels;
    const disabled = choice === false || typeof choice === 'object' && choice !== null
      && (choice as Record<string, unknown>)[kind] === false;
    const text = axisLabelText(data, tick.at, tick.labelId);
    omissions.push({ labelId: tick.labelId, text, reason: disabled ? 'disabled' : 'density', destination: destinationOf(tick.labelId, text, {}, kind) ?? 'reading.omissions' });
  }
  // Cell and slice planners can move values straight to a note, without a solver request.
  const named = new Set(omissions.map(omission => omission.text));
  for (const note of chartNotes(geo)) {
    const values = engineNoteMeta(note)?.values ?? [];
    values.forEach((text, index) => {
      if (named.has(text)) return;
      named.add(text);
      const labelId = `note:${note.n}:value:${index}`;
      omissions.push({ labelId, text, reason: 'note', destination: destinationOf(labelId, text) ?? `notes[${note.n - 1}]` });
    });
  }
  return omissions;
}

/** Report label loss once, after every layout and footer pass has finished. */
export function reportLabelOmissions(geo: Geometry<object, object>, options?: LabelOptions, data?: unknown): void {
  let placed: Map<string, PlacedLabel> | undefined;
  const labelFor = (id: string) => {
    placed ??= new Map(geo.labels.map(label => [label.id, label]));
    return placed.get(id);
  };
  let hidden = labelOmissions(geo, options, data).filter(omission => {
    if (omission.reason === 'truncated' || omission.reason === 'redundant' || omission.reason === 'disabled' || omission.destination.startsWith('scene:')) return false;
    return !intentionalOmission(geo, options, data, omission, labelFor);
  });
  if (hidden.some(omission => omission.destination.startsWith('label:'))) {
    const printed = new Set(geo.labels.filter(label => !label.hidden).map(label => `label:${label.id}`));
    hidden = hidden.filter(omission => !printed.has(omission.destination));
  }
  dropWarnings(geo, warning => warning.code !== 'label-hidden' || warning.severity === 'error');
  if (hidden.length === 0) return;
  geo.warnings.push({ code: 'label-hidden', severity: 'warn',
    message: `${hidden.length} label${hidden.length === 1 ? ' is' : 's are'} not drawn; reading.omissions names each label and its destination`,
    suggest: 'increase chart size to give labels more room',
    detail: { hidden: hidden.map(omission => omission.labelId) } });
}
