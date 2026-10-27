import { boundsOf, type Rect } from '../../core/geometry';
import { linePath } from '../../core/svgPath';
import { ownerContains } from '../../core/a11y/recordsShared';
import { interactionTokens } from '../../core/a11y/theme';
import type { InteractionRecord } from '../../core/a11y/types';
import type { OccupiedRect, Paint, SceneNode } from '../../core/types/scene';
import { tint } from '../../core/color';
import type { Theme } from '../../core/types/theme';

/** A series key: a legend entry or name label a point record lists so the pointer reaches it there. */
export const KEY_PARTS: ReadonlySet<string> = new Set(['series', 'legendLabel', 'swatch', 'labelSwatch']);

/** A node that is the record's mark: a point record's series key is where the pointer finds it, not where it is drawn. */
function markNode(record: InteractionRecord, node: SceneNode): boolean {
  return record.nodeIds.includes(node.id) && !(record.anchor && !('w' in record.anchor) && KEY_PARTS.has(node.part ?? ''));
}

/** Mark bounds come from layout, including paths whose numeric vertices are not individual nodes. */
export function recordBounds(record: InteractionRecord, scene: readonly SceneNode[], occupied: readonly OccupiedRect[]): Rect | undefined {
  if (record.anchor && 'w' in record.anchor) return record.anchor;
  const nodes = scene.filter(node => markNode(record, node));
  const boxes = nodes.flatMap(node => {
    const bounds = (node.t === 'rect' || node.t === 'image') ? node.rect : node.t === 'circle'
      ? { x: node.cx - node.r, y: node.cy - node.r, w: node.r * 2, h: node.r * 2 }
      : node.t === 'line' ? { x: Math.min(node.x1, node.x2), y: Math.min(node.y1, node.y2), w: Math.abs(node.x2 - node.x1), h: Math.abs(node.y2 - node.y1) } : undefined;
    if (record.anchor && !bounds) return [];
    return bounds ? [{ ...bounds, x: bounds.x + (node.tx ?? 0), y: bounds.y + (node.ty ?? 0) }]
      : occupied.filter(item => item.kind === 'mark' && ownerContains(item.owner, node.owner)).map(item => item.rect);
  });
  return boxes.length ? boundsOf(boxes) : record.anchor ? { ...record.anchor, w: 0, h: 0 } : undefined;
}

const OUTLINE = 'interaction:outline:';

function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}

function outline(node: SceneNode, theme: Theme): SceneNode | undefined {
  const width = interactionTokens(theme).outlineWidth;
  const common = { id: `${OUTLINE}${node.id}`, owner: node.owner, origin: node.origin,
    part: 'interaction-outline', tx: node.tx, ty: node.ty };
  // The outline marks the shared canvas, so it carries the scene's own ink
  // token. `theme` here can be a panel's card theme, whose dark ink would
  // disappear against a light root canvas.
  if (node.t === 'rect' || node.t === 'image') {
    const { x, y, w, h } = node.rect;
    return { ...common, t: 'path', d: linePath([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]) + 'Z',
      stroke: { token: 'ink' }, width };
  }
  if (node.t === 'line') return { ...node, ...common, stroke: { token: 'ink' }, width };
  if (node.t === 'path') return { ...node, ...common, fill: undefined, pattern: undefined, stroke: { token: 'ink' }, width };
  if (node.t === 'circle') return { ...common, t: 'path', d: circlePath(node.cx, node.cy, node.r), stroke: { token: 'ink' }, width };
  return undefined;
}

/** An icon or badge on a diagram node belongs to the node's outline, not one of its own; a column ribbon stays lit, not outlined. */
const DECORATIONS = new Set(['diagramIcon', 'diagramBadge', 'ribbon', 'ribbonEdge']);

/** Outline every node of the active records; a shared series path gets a vertex ring instead. */
function outlines(scene: readonly SceneNode[], records: readonly InteractionRecord[], active: readonly InteractionRecord[], theme: Theme): SceneNode[] {
  const result: SceneNode[] = [];
  const activeIds = new Set(active.map(record => record.id));
  const done = new Set<string>();
  for (const record of active) {
    // A missing value has no point to ring: a ring would read as a value of zero.
    const point = record.anchor && !('w' in record.anchor) && record.value.state !== 'missing' ? record.anchor : undefined;
    let outlined = false;
    for (const node of scene) if (markNode(record, node) && !done.has(node.id) && !DECORATIONS.has(node.part ?? '')) {
      const sharedPath = node.t === 'path' && records.some(other => !activeIds.has(other.id) && other.nodeIds.includes(node.id));
      if (point && sharedPath) continue;
      const border = outline(node, theme);
      if (border) { result.push(border); done.add(node.id); outlined = true; }
    }
    if (point && !outlined) result.push({ t: 'path', id: `interaction:vertex:${record.id}`, owner: record.target.owner,
      part: 'interaction-outline', d: circlePath(point.x, point.y, theme.space.labelPad),
      // The scene's ink token, as the outlines above: `theme` can be a panel's card theme.
      stroke: { token: 'ink' }, width: interactionTokens(theme).outlineWidth });
  }
  return result;
}

/**
 * The hover highlight. Paint changes only: source nodes and canonical
 * geometry stay untouched. Every mark no active record owns dims, in every
 * panel and every series, the same way on every chart type: the
 * reader's eye goes to the hovered mark. A node the active records share with
 * others (a line's series path) keeps full opacity and gains an outline or a
 * vertex ring. Several active records (the members of one shared label) keep
 * all of their marks.
 */
export function highlightScene(
  scene: readonly SceneNode[], records: readonly InteractionRecord[], active: readonly InteractionRecord[], theme: Theme,
): SceneNode[] {
  if (active.length === 0) return [...scene];
  const activeIds = new Set(active.map(record => record.id));
  // Small multiples compare one series across panels: the pointed series keeps
  // its ink in every other panel too, without an outline there.
  const pointed = active[0]!.target;
  const twins = pointed.panel === undefined || pointed.owner.seriesId === undefined ? [] : records.filter(record =>
    record.target.chart === pointed.chart && record.target.panel !== undefined && record.target.panel !== pointed.panel
    && record.target.owner.seriesId === pointed.owner.seriesId);
  const activeNodes = new Set([...active, ...twins].flatMap(record => record.nodeIds));
  // An annotation (an event of the event lane, a value line) stays as drawn while a mark is hovered: it is a reference for the reader, not a mark to fade.
  const dimmed = new Set(records.filter(record => !activeIds.has(record.id) && record.target.owner.annotationId === undefined).flatMap(record => record.nodeIds));
  const dim = interactionTokens(theme).dim;
  // A value inside a dimmed mark picks its ink against the paler fill the
  // reader sees: white on a dark slice stayed white once the slice faded to
  // a pale blue. The text keeps full opacity.
  const paler = new Map<string, Paint>();
  for (const node of scene) {
    if (!dimmed.has(node.id) || activeNodes.has(node.id) || !('fill' in node) || !node.fill) continue;
    paler.set(`${panelOf(node)}|${ownerKey(node.owner)}|${JSON.stringify(node.fill)}`, dimmedPaint(node.fill, dim, theme));
  }
  const result = scene.map(node => {
    if (dimmed.has(node.id) && !activeNodes.has(node.id)) return { ...node, opacity: dim * (node.opacity ?? 1) };
    if (node.t !== 'text' || !('token' in node.ink) || node.ink.theme?.kind !== 'contrast-ink') return node;
    const fill = paler.get(`${panelOf(node)}|${ownerKey(node.owner)}|${JSON.stringify(node.ink.theme.fill)}`);
    return fill ? { ...node, ink: { ...node.ink, theme: { ...node.ink.theme, fill } } } : node;
  });
  // A diagram node's outline paints right above its own shape, so the icon,
  // label and badge the node carries stay on top of it; every other outline
  // paints above the whole scene.
  const borders = outlines(scene, records, active, theme);
  const shapes = new Set(scene.filter(node => node.part === 'diagramNode').map(node => node.id));
  const under = new Map(borders.filter(border => shapes.has(border.id.slice(OUTLINE.length))).map(border => [border.id.slice(OUTLINE.length), border]));
  return [...result.flatMap(node => under.has(node.id) ? [node, under.get(node.id)!] : [node]),
    ...borders.filter(border => !under.has(border.id.slice(OUTLINE.length)))];
}

/** The keyboard focus without the highlight: the active records' outlines over the scene as drawn, nothing dimmed. */
export function outlineScene(
  scene: readonly SceneNode[], records: readonly InteractionRecord[], active: readonly InteractionRecord[], theme: Theme,
): SceneNode[] {
  return [...scene, ...outlines(scene, records, active, theme)];
}

/** Grid panels reuse owner ids: a value's ink follows the mark of its own panel. */
function panelOf(node: SceneNode): string {
  return node.origin?.panels.join('/') ?? '';
}

function ownerKey(owner: SceneNode['owner']): string {
  return JSON.stringify([owner.seriesId, owner.categoryId, owner.segmentId, owner.pointId]);
}

/** A fill drawn at `opacity` over the page, as one paint. */
function dimmedPaint(fill: Paint, opacity: number, theme: Theme): Paint {
  if ('css' in fill) return { css: tint(fill.css, 1 - opacity, theme.color.background) };
  return { ...fill, tint: 1 - (1 - (fill.tint ?? 0)) * opacity };
}
