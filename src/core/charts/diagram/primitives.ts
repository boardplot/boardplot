import { compileIcon } from '../../icons';
import { boundsOf, inflate, type Point, type Rect } from '../../geometry';
import { resolveSurface, strokeToken, dashToken, contrastInkPaint, markRolePaint, paintColor, seriesPaint as themeSeriesPaint } from '../../theme';
import type { OwnerRef } from '../../types/cell';
import type {
  DiagramNode,
  DiagramVisualRole,
  ResolvedDiagramNode,
} from '../../types/diagram';
import type { Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { diagramSceneId } from './ids';

export const q = (value: number): number => Math.round(value * 2) / 2;
export const qPoint = (point: Point): Point => ({ x: q(point.x), y: q(point.y) });
export const qRect = (rect: Rect): Rect => ({
  x: q(rect.x),
  y: q(rect.y),
  w: q(rect.w),
  h: q(rect.h),
});

export const nodeOwner = (id: string): OwnerRef => ({ pointId: id });
export const edgeOwner = (id: string): OwnerRef => ({ segmentId: id });
export const groupOwner = (id: string): OwnerRef => ({ seriesId: id });
export const laneOwner = (id: string): OwnerRef => ({ categoryId: id });

export interface DiagramPalette {
  paint(role: DiagramVisualRole | undefined, paletteKey?: string): Paint;
  css(role: DiagramVisualRole | undefined, paletteKey?: string): string;
  /** A lane header's fill: the calm phase fill unless the lane's colour means something. */
  lane(role: DiagramVisualRole | undefined, paletteKey?: string): Paint;
  /** The paint of a filled shape, a node, a lane header or a badge: good, bad and warn take their fill twins. */
  fill(role: DiagramVisualRole | undefined, paletteKey?: string): Paint;
}

export function createDiagramPalette(
  theme: Theme,
  keys: readonly string[],
  paletteName?: string,
  sharedKeys: ReadonlySet<string> = new Set(),
  // Edge-only category keys rank after every node, group and lane key, so adding one never recolours those.
  trailingKeys: readonly string[] = [],
): DiagramPalette {
  const sorted = [...new Set(keys)].sort();
  const trailing = [...new Set(trailingKeys)].filter((key) => !sorted.includes(key)).sort();
  const ranks = new Map([...sorted, ...trailing].map((key, index) => [key, index]));
  const resolveDiagramPaint = (
    role: DiagramVisualRole | undefined,
    paletteKey?: string,
  ): Paint => {
    switch (role ?? 'primary') {
      case 'accent':
        // The accent node or edge is larger than a point: it takes the focus,
        // which falls back to the highlight.
        return { token: 'focus' };
      case 'secondary':
        return { token: 'neutralLight' };
      case 'muted':
        return { token: 'neutralLight', tint: 0.55 };
      case 'good':
        return { token: 'good' };
      case 'bad':
        return { token: 'bad' };
      case 'warn':
        return { token: 'warn' };
      case 'category':
        return themeSeriesPaint(ranks.get(paletteKey ?? '') ?? 0, paletteName);
      case 'primary':
      default:
        return paletteName === undefined ? { token: 'series-1' } : themeSeriesPaint(0, paletteName);
    }
  };
  const css = (role: DiagramVisualRole | undefined, paletteKey?: string): string => {
    return paintColor(theme, resolveDiagramPaint(role, paletteKey));
  };
  // Phases in a row are one sequence, so their chevrons take one fill: the
  // primary washed toward the card, dark ink on it in light and light ink in
  // dark. A lane keeps a colour of its own only when it means
  // something: a judgement role, or a category colour a node, a group or the
  // key shares with it. Five category colours sorted by key would name nothing.
  const primary = resolveDiagramPaint('primary');
  const phase: Paint = {
    token: 'token' in primary ? primary.token : 'series-1',
    theme: { kind: 'visible-tint', base: primary, amount: 0.8, floor: 1.3, roundStep: true },
  };
  // A node, a lane header and a badge are fills, so a judgment role takes its
  // fill twin; an edge and a group frame keep the tone.
  const fill = (role: DiagramVisualRole | undefined, paletteKey?: string): Paint =>
    role === 'good' || role === 'bad' || role === 'warn' ? markRolePaint(role, true) : resolveDiagramPaint(role, paletteKey);
  const lane = (role: DiagramVisualRole | undefined, paletteKey?: string): Paint =>
    (role ?? 'primary') === 'primary' || (role === 'category' && !sharedKeys.has(paletteKey ?? ''))
      ? phase
      : fill(role, paletteKey);
  return { paint: resolveDiagramPaint, css, lane, fill };
}

/** The structural roles a theme's `marks.nodeFill: 'panel'` draws on the background. */
const PANEL_ROLES: ReadonlySet<string> = new Set(['primary', 'secondary', 'muted']);

export function nodeFillPaint(node: DiagramNode, palette: DiagramPalette, theme?: Theme): Paint {
  // A text node draws on the background, so its label takes the ink for the background.
  if (node.shape.kind === 'text') return { token: 'background' };
  if (node.kind === 'painPoint' && node.role === undefined) return { token: 'neutralLight' };
  // Only the accent node is filled when the theme draws the others on the panel.
  if (theme?.marks?.nodeFill === 'panel' && PANEL_ROLES.has(node.role ?? 'primary')) return { token: 'background' };
  return palette.fill(node.role, node.paletteKey);
}

export function nodeFillCss(
  node: DiagramNode,
  palette: DiagramPalette,
  theme: Theme,
): string {
  return paintColor(theme, nodeFillPaint(node, palette, theme));
}

/**
 * The ring of a node and a group frame: the theme's
 * `marks.nodeStroke` and `marks.nodeStrokeWidth`, else `axis` (`grid` on a
 * muted role) at 1 px.
 */
function nodeRing(theme: Theme, role: DiagramVisualRole | undefined): { stroke: Paint; width: number } {
  return {
    stroke: { token: theme.marks?.nodeStroke ?? (role === 'muted' ? 'grid' : 'axis') },
    width: theme.marks?.nodeStrokeWidth ?? strokeToken(theme, 'hair'),
  };
}

export function measuredNodeSize(
  node: DiagramNode,
  textWidth: number,
  lineHeight: number,
  u: number,
): { width: number; height: number } {
  const iconReserve = node.icon || node.shape.kind === 'icon' ? 4.5 * u : 0;
  const secondary = node.secondaryLabel ? 2 * lineHeight + u : 0;
  const base = {
    width: Math.max(10 * u, textWidth + 4 * u, iconReserve + 4 * u),
    height: Math.max(7 * u, lineHeight + secondary + iconReserve + 3 * u),
  };
  const lower = node.minSize
    ? {
        width: Math.max(base.width, node.minSize.width),
        height: Math.max(base.height, node.minSize.height),
      }
    : base;
  return node.size
    ? { width: Math.max(node.size.width, lower.width), height: Math.max(node.size.height, lower.height) }
    : lower;
}

/**
 * The corner radius of a rounded node that authors none: the theme's
 * `marks.nodeRadius` when set, else `surface.chipRadius`.
 */
function nodeRadius(theme: Theme): number {
  return theme.marks?.nodeRadius ?? resolveSurface(theme).chipRadius;
}

export function nodeShapeScene(
  node: DiagramNode,
  resolved: ResolvedDiagramNode,
  palette: DiagramPalette,
  theme: Theme,
  /** The compact org chart: an inline icon box, and no ring unless the theme names one. */
  org?: { iconBox?: Rect; ring: boolean; ringPaint?: { stroke: Paint; width: number }; fill?: Paint; plainShape?: boolean; d?: string },
): SceneNode[] {
  const { rect } = resolved;
  const owner = nodeOwner(node.id);
  const fill = org?.fill ?? nodeFillPaint(node, palette, theme);
  const ring = org?.ringPaint ?? nodeRing(theme, node.role);
  const bare = org !== undefined && !org.ring && !org.ringPaint;
  const stroke = bare ? undefined : ring.stroke;
  const ringWidth = bare ? undefined : ring.width;
  const id = diagramSceneId('node', node.id);
  const out: SceneNode[] = [];
  const common = {
    id,
    owner,
    part: 'diagramNode',
    display: { value: node.label, state: node.kind },
  };

  switch (node.shape.kind) {
    case 'circle': {
      out.push({
        t: 'circle',
        ...common,
        cx: q(rect.x + rect.w / 2),
        cy: q(rect.y + rect.h / 2),
        r: q(Math.min(rect.w, rect.h) / 2),
        fill,
        stroke,
        strokeWidth: ringWidth,
      });
      break;
    }
    case 'pill':
      out.push({ t: 'rect', ...common, rect, fill, stroke, strokeWidth: ringWidth, radius: q(rect.h / 2) });
      break;
    case 'roundedRect':
      if (node.kind === 'painPoint' && node.role === undefined && !org?.plainShape) {
        const radius = q(node.shape.radius ?? nodeRadius(theme));
        out.push({
          t: 'path',
          ...common,
          d: roundedRectPath(rect, radius),
          fill,
          stroke,
          width: ringWidth,
          dash: dashToken(theme, 'reference'),
        });
        out.push({
          t: 'line',
          id: diagramSceneId('node', node.id, 'accent'),
          x1: q(rect.x),
          y1: q(rect.y + radius),
          x2: q(rect.x),
          y2: q(rect.y + rect.h - radius),
          stroke: { token: 'bad' },
          width: strokeToken(theme, 'mark'),
          lineCap: 'round',
          owner,
          part: 'diagramPainAccent',
        });
      } else {
        out.push({
          t: 'rect',
          ...common,
          rect,
          fill,
          stroke,
          strokeWidth: ringWidth,
          radius: q(node.shape.radius ?? nodeRadius(theme)),
        });
      }
      break;
    case 'chevron': {
      const tip = q(Math.min(rect.w * (node.shape.tip ?? 0.16), rect.h));
      out.push({
        t: 'path',
        ...common,
        d: org?.d ?? chevronPath(rect, tip),
        fill,
        stroke,
        width: ringWidth,
      });
      break;
    }
    case 'roof': {
      const apex = node.shape.apex ?? 0.5;
      const inset = node.shape.eaveInset ?? 0;
      out.push({
        t: 'path',
        ...common,
        d:
          `M${q(rect.x + inset * rect.w)} ${q(rect.y + rect.h)}` +
          `L${q(rect.x + apex * rect.w)} ${q(rect.y)}` +
          `L${q(rect.x + rect.w - inset * rect.w)} ${q(rect.y + rect.h)}Z`,
        fill,
        stroke,
        width: ringWidth,
      });
      break;
    }
    case 'text':
      out.push({
        t: 'rect',
        ...common,
        rect,
        fill: { token: 'background' },
        owner,
        part: 'diagramTextReserve',
      });
      break;
    case 'icon':
    case 'rectangle':
    default:
      out.push({ t: 'rect', ...common, rect, fill, stroke, strokeWidth: ringWidth });
  }

  const icon = node.icon ?? (node.shape.kind === 'icon' ? node.shape.name : undefined);
  if (icon) {
    const lineHeight = theme.type.label.size * (theme.type.label.lineHeight ?? 1.2);
    const centredCircle = node.kind === 'step' && node.shape.kind === 'circle';
    const size = q(
      Math.min(
        Math.max(1, rect.w - 4 * theme.space.labelPad),
        centredCircle ? rect.h * 0.62 : rect.h * 0.42,
        2.5 * lineHeight,
      ),
    );
    const box: Rect = org?.iconBox ? qRect(org.iconBox) : {
      x: q(rect.x + (rect.w - size) / 2),
      y: q(
        centredCircle
          ? rect.y + (rect.h - size) / 2
          : rect.y + theme.space.labelPad,
      ),
      w: size,
      h: size,
    };
    const width = strokeToken(theme, 'rule');
    const iconInk = contrastInkPaint(fill);
    compileIcon(icon, box).forEach((primitive, index) => {
      const primitiveId = diagramSceneId('icon', node.id, String(index));
      if (primitive.kind === 'circle') {
        out.push({
          t: 'circle',
          id: primitiveId,
          cx: primitive.cx,
          cy: primitive.cy,
          r: primitive.r,
          fill,
          stroke: iconInk, strokeWidth: strokeToken(theme, 'rule'),
          owner,
          part: 'diagramIcon',
        });
      } else {
        out.push({
          t: 'path',
          id: primitiveId,
          d: primitive.d,
          stroke: iconInk,
          width,
          lineCap: 'round',
          owner,
          part: 'diagramIcon',
        });
      }
    });
  }
  return out;
}

function roundedRectPath(rect: Rect, radius: number): string {
  const r = q(Math.min(radius, rect.w / 2, rect.h / 2));
  return (
    `M${q(rect.x + r)} ${q(rect.y)}` +
    `L${q(rect.x + rect.w - r)} ${q(rect.y)}` +
    `Q${q(rect.x + rect.w)} ${q(rect.y)} ${q(rect.x + rect.w)} ${q(rect.y + r)}` +
    `L${q(rect.x + rect.w)} ${q(rect.y + rect.h - r)}` +
    `Q${q(rect.x + rect.w)} ${q(rect.y + rect.h)} ${q(rect.x + rect.w - r)} ${q(rect.y + rect.h)}` +
    `L${q(rect.x + r)} ${q(rect.y + rect.h)}` +
    `Q${q(rect.x)} ${q(rect.y + rect.h)} ${q(rect.x)} ${q(rect.y + rect.h - r)}` +
    `L${q(rect.x)} ${q(rect.y + r)}` +
    `Q${q(rect.x)} ${q(rect.y)} ${q(rect.x + r)} ${q(rect.y)}Z`
  );
}

/** A chevron pointing right, or left on the return row of a serpentine journey. */
export function chevronPath(rect: Rect, tip: number, leftward = false): string {
  const notch = Math.min(tip * 0.7, rect.w / 5);
  const x = (dx: number) => q(leftward ? rect.x + rect.w - dx : rect.x + dx);
  return (
    `M${x(0)} ${q(rect.y)}` +
    `L${x(rect.w - tip)} ${q(rect.y)}` +
    `L${x(rect.w)} ${q(rect.y + rect.h / 2)}` +
    `L${x(rect.w - tip)} ${q(rect.y + rect.h)}` +
    `L${x(0)} ${q(rect.y + rect.h)}` +
    `L${x(notch)} ${q(rect.y + rect.h / 2)}Z`
  );
}

export function polylinePath(points: readonly Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${q(point.x)} ${q(point.y)}`).join('');
}

export function pointBounds(points: readonly Point[]): Rect {
  return boundsOf(points.map((point) => ({ x: point.x, y: point.y, w: 0, h: 0 })));
}

export function segmentBounds(from: Point, to: Point, strokeWidth: number): Rect {
  return inflate(
    {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.abs(to.x - from.x),
      h: Math.abs(to.y - from.y),
    },
    strokeWidth / 2,
  );
}

export function pathBounds(points: readonly Point[], strokeWidth = 0): Rect {
  return inflate(pointBounds(points), strokeWidth / 2);
}
