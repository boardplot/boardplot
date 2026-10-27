import type { GridMarks } from '../../core/grid/layoutGrid';
import { rectContains, type Point, type Rect } from '../../core/geometry';
import { ownerContains } from '../../core/a11y/recordsShared';
import type { InteractionRecord } from '../../core/a11y/types';
import type { ResolvedChartRequest } from '../../core/request';
import { panelTypeClass, resolveTheme, type TypeWidthClass } from '../../core/theme';
import type { Geometry, OccupiedRect, SceneNode } from '../../core/types/scene';
import type { Theme, ThemeRef } from '../../core/types/theme';
import { compositionOptions, type CompositionOptions } from './labelCard';

export interface HoverViewport {
  /** Viewport inset by 8 CSS pixels, expressed in chart layout units. */
  boundary: Rect;
  pointer?: Point;
  /** CSS pixels per chart layout unit, including SVG letterboxing. */
  scale: number;
  /** Chart origin in the body portal's containing-block CSS pixels. */
  origin: Point;
}

interface PanelOverlayInput {
  /** Full path, matching InteractionTarget.panel. */
  panel: string;
  type: string;
  plot: Rect;
  width: number;
  typeClass?: TypeWidthClass;
  /**
   * What the panel's own options say about a 100 % composition, for the card
   * that words its share. Absent in a snapshot prepared before this field,
   * which reads as 'not a 100 % composition'.
   */
  composition?: CompositionOptions;
  /** Nearest explicit panel theme. Omitted panels inherit the current host theme. */
  theme?: ThemeRef;
}
export interface OverlayInputs {
  plot: Rect;
  occupied: OccupiedRect[];
  panels?: PanelOverlayInput[];
}

/** Match drawn labels by identity and panel, then use their layout-owned rectangles. */
export function activeLabelBounds(active: readonly InteractionRecord[], scene: readonly SceneNode[], occupied: readonly OccupiedRect[]): Rect[] {
  const labels = scene.filter(node => node.t === 'text' && active.some(record => {
    const panel = node.origin?.panels?.join('/');
    if (panel && record.target.panel !== panel && !record.target.panel?.endsWith(`/${panel}`)) return false;
    if (record.nodeIds.includes(node.id)) return true;
    return (['categoryId', 'pointId', 'rowId'] as const).every(key => record.target.owner[key] === undefined
      || record.target.owner[key] === node.owner[key])
      && (record.target.owner.categoryId !== undefined
        || ownerContains(record.target.owner, node.owner) || ownerContains(node.owner, record.target.owner));
  }));
  return occupied.filter(item => item.kind !== 'mark' && item.kind !== 'reserved' && labels.some(node => node.t === 'text'
    && ownerContains(item.owner, node.owner)
    && rectContains(item.rect, { x: node.x + (node.tx ?? 0), y: node.y + (node.ty ?? 0) + node.font.size / 2, w: 0, h: 0 }, 0))).map(item => item.rect);
}

function translated(rect: Rect, offset: { x: number; y: number }): Rect {
  return { ...rect, x: rect.x + offset.x, y: rect.y + offset.y };
}


/** Project only placement and theme fields; no source data, derived values or claims. */
export function overlayInputs(request: ResolvedChartRequest, geometry: Geometry): OverlayInputs {
  const panels: PanelOverlayInput[] = [];
  const visit = (parent: Geometry, path: string | undefined, offset: { x: number; y: number }, inheritedTheme?: ThemeRef): void => {
    if (parent.type !== 'grid') return;
    for (const panel of (parent.marks as unknown as GridMarks).panels) {
      const child = panel.chart;
      if (!child) continue;
      const fullPath = path ? `${path}/${panel.id}` : panel.id;
      const origin = { x: offset.x + child.offset.x, y: offset.y + child.offset.y };
      const theme = child.theme ?? inheritedTheme;
      const typeClass = panelTypeClass(child.options);
      const mode = compositionOptions(child.geometry.type, child.options);
      panels.push({ panel: fullPath, type: child.geometry.type,
        plot: translated(child.geometry.plot, origin),
        width: child.geometry.size.width, typeClass, composition: mode, theme });
      visit(child.geometry, fullPath, origin, theme);
    }
  };
  visit(geometry, request.scope.panel, { x: 0, y: 0 });
  return {
    plot: { ...geometry.plot },
    occupied: geometry.debug.occupied.map(item => ({ ...item, rect: { ...item.rect }, owner: { ...item.owner } })),
    ...(panels.length ? { panels } : {}),
  };
}

/** Resolve inherited paint at render time while retaining explicit panel overrides. */
export function panelOverlayTheme(panel: PanelOverlayInput, inherited: Theme): Theme {
  return panel.theme === undefined ? inherited : resolveTheme(panel.theme);
}

/** Deepest containing plot wins; ties follow the already ordered panel projection. */
export function panelAtPoint(panels: readonly PanelOverlayInput[], point: { x: number; y: number }): PanelOverlayInput | undefined {
  let selected: PanelOverlayInput | undefined;
  for (const panel of panels) {
    const { x, y, w, h } = panel.plot;
    if (point.x < x || point.x > x + w || point.y < y || point.y > y + h) continue;
    if (!selected || panel.panel.split('/').length > selected.panel.split('/').length) selected = panel;
  }
  return selected;
}
