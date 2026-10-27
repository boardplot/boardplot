import type { SceneNode } from '../core/types/scene';

/** Public DOM hooks depend on source ownership, never drawn order or coordinates. */
export function sceneAttributes(node: SceneNode, legendItem?: string): Record<string, string | undefined> {
  const owner = node.origin?.owner ?? node.owner;
  const fields = Object.entries(owner).filter(([, value]) => value !== undefined).sort();
  const identity = fields.length === 2 && owner.seriesId !== undefined && owner.categoryId !== undefined
    ? `${encodeURIComponent(owner.seriesId)}:${encodeURIComponent(owner.categoryId)}`
    : fields.map(([field, value]) => `${field}=${encodeURIComponent(value)}`).join('&');
  const legend = node.origin?.legendItem ?? legendItem;
  return {
    'data-bp-owner': fields.length ? JSON.stringify(Object.fromEntries(fields)) : undefined,
    'data-bp-panel': node.origin?.panels.map(encodeURIComponent).join('/'),
    'data-bp-label': node.t === 'text' ? identity || node.part : undefined,
    'data-bp-mark': node.t !== 'text' && !legend ? identity || undefined : undefined,
    'data-bp-legend-item': legend,
    'data-bp-card': node.part === 'diagramNode' || node.part === 'interaction-card' ? identity : undefined,
  };
}
