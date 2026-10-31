import { assertEmbeddedImage } from '../core/image';
import { ENGINE_REV } from '../core/engine';
import { NormalizeError } from '../core/normalize/shared';
/**
 * React fold over a Geometry scene. Renders exactly what the
 * layout computed — no measuring, no repositioning, no chart knowledge.
 */

import { useContext, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import { hatchPatternId, hatchTile, isHatchPattern, POINTER_TRANSPARENT_PARTS } from '../core/svgPath';
import type { ScenePaint } from './scenePaint';
import { resolvePaint } from '../core/svg/paint';
import { BoardplotThemeContext } from './themeContext';
import { useScopedId } from './idPrefix';
import { strokeToken, hatchGapFactor, hatchPaint, hatchStrokeWidthFor, PLAN_MUTED_PAINT, solidMutedPlan } from '../core/theme';
import { haloPaint } from '../core/haloPaint';
import { numericVariant, textRole } from '../core/textRole';
import { sceneAttributes } from './sceneAttributes';
import type { Id } from '../core/types/cell';
import type { HatchLook, HatchPattern, Paint, SceneNode } from '../core/types/scene';
import type { RenderGeometry } from './prepared';
import type { Theme } from '../core/types/theme';

interface SceneRendererProps {
  geometry: RenderGeometry;
  theme: Theme;
  /** Shrink to the parent width, or keep intrinsic size. */
  responsive?: boolean;
  style?: CSSProperties;
  onElementClick?: (node: SceneNode) => void;
  /** Called with the series id when the reader clicks a series' line or area, its name label or its legend entry. */
  onSeriesClick?: (seriesId: Id) => void;
  /** Makes the keyboard stops of the scene (an event's marker or title line) focusable: set while hover opens a card on focus. */
  focusStops?: boolean;
}

/** Marks that answer a series click. Name labels and legend labels are also keyboard buttons; the rest are pointer-only, so one series adds no tab stop per point. */
const SERIES_POINTER_PARTS: ReadonlySet<string> = new Set(['line', 'lineCasing', 'area', 'marker', 'labelSwatch', 'swatch']);
const SERIES_KEY_PARTS: ReadonlySet<string> = new Set(['series', 'legendLabel']);

const TEXT_ASCENT = 0.88;

/** Inherited host text properties the layout did not measure with. */
const TEXT_RESETS: CSSProperties = {
  textTransform: 'none', letterSpacing: 'normal', wordSpacing: 'normal', fontStyle: 'normal', fontVariant: 'normal',
};
const NON_FINITE_PATH = /NaN|Infinity/;

function invalidGeometry(detail: string): never {
  throw new NormalizeError('invalid-geometry', '', `invalid React geometry ${detail}`,
    'Check the options and the data for a value that is not a finite number, such as an axis bound or a size written as text.');
}

function assertNumber(
  label: string,
  value: unknown,
  minimum?: number,
  optional = false,
  maximum?: number,
): void {
  if (optional && value === undefined) return;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum) ||
    (maximum !== undefined && value > maximum)
  ) {
    invalidGeometry(`numeric ${label} '${String(value)}'`);
  }
}

function assertRect(
  label: string,
  rect: { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined,
): void {
  if (!rect || typeof rect !== 'object') invalidGeometry(label);
  assertNumber(`${label}.x`, rect.x);
  assertNumber(`${label}.y`, rect.y);
  assertNumber(`${label}.w`, rect.w, 0);
  assertNumber(`${label}.h`, rect.h, 0);
}

/** Reject malformed third-party geometry before React writes partial SVG markup. */
function assertRenderableGeometry(geometry: RenderGeometry): void {
  if (!geometry || typeof geometry !== 'object') invalidGeometry('root');
  assertNumber('size.width', geometry.size?.width, 0);
  assertNumber('size.height', geometry.size?.height, 0);
  if (!Array.isArray(geometry.scene)) invalidGeometry('scene');
  if (
    !geometry.a11y ||
    typeof geometry.a11y.title !== 'string' ||
    typeof geometry.a11y.desc !== 'string'
  ) {
    invalidGeometry('a11y title/description');
  }
  const ids = new Set<string>();
  for (const node of geometry.scene) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || node.id.length === 0) {
      invalidGeometry('scene node id');
    }
    if (ids.has(node.id)) invalidGeometry(`duplicate node id '${node.id}'`);
    ids.add(node.id);
    assertNumber(`${node.id}.opacity`, node.opacity, 0, true, 1);
    assertNumber(`${node.id}.tx`, node.tx, undefined, true);
    assertNumber(`${node.id}.ty`, node.ty, undefined, true);
    switch (node.t) {
      case 'image':
        assertRect(`${node.id}.rect`, node.rect);
        assertEmbeddedImage(node.src);
        break;
      case 'rect':
        assertRect(`${node.id}.rect`, node.rect);
        assertNumber(`${node.id}.strokeWidth`, node.strokeWidth, 0, true);
        assertNumber(`${node.id}.radius`, node.radius, 0, true);
        break;
      case 'line':
        assertNumber(`${node.id}.x1`, node.x1);
        assertNumber(`${node.id}.y1`, node.y1);
        assertNumber(`${node.id}.x2`, node.x2);
        assertNumber(`${node.id}.y2`, node.y2);
        assertNumber(`${node.id}.width`, node.width, 0);
        node.dash?.forEach((value, index) => assertNumber(`${node.id}.dash.${index}`, value, 0));
        break;
      case 'path':
        if (typeof node.d !== 'string' || NON_FINITE_PATH.test(node.d)) {
          invalidGeometry(`path ${node.id}.d`);
        }
        assertNumber(`${node.id}.width`, node.width, 0, true);
        node.dash?.forEach((value, index) => assertNumber(`${node.id}.dash.${index}`, value, 0));
        break;
      case 'circle':
        assertNumber(`${node.id}.cx`, node.cx);
        assertNumber(`${node.id}.cy`, node.cy);
        assertNumber(`${node.id}.r`, node.r, 0);
        break;
      case 'text':
        assertNumber(`${node.id}.x`, node.x);
        assertNumber(`${node.id}.y`, node.y);
        if (!Array.isArray(node.lines) || node.lines.some((line) => typeof line !== 'string')) {
          invalidGeometry(`text lines ${node.id}`);
        }
        if (node.runs !== undefined) {
          // Mirror of the canonical SVG path's runtime guard: run values are
          // untyped at this public boundary and weight lands in an attribute.
          if (!Array.isArray(node.runs) || node.runs.length === 0) {
            invalidGeometry(`text runs ${node.id}`);
          }
          // Iteration visits sparse holes as undefined, so they fail the text check.
          for (const candidate of node.runs as unknown[]) {
            const { text, weight } = typeof candidate === 'object' && candidate !== null
              ? candidate as { text?: unknown; weight?: unknown } : {};
            if (typeof text !== 'string' || (weight !== undefined &&
                (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 1000))) {
              invalidGeometry(`text runs ${node.id}`);
            }
          }
          if (node.lines.length !== 1 || node.lines[0] !== node.runs.map((run) => run.text).join('')) {
            invalidGeometry(`text runs ${node.id} — single line, lines[0] = concatenated runs`);
          }
        }
        assertNumber(`${node.id}.font.size`, node.font?.size, 0);
        assertNumber(`${node.id}.font.weight`, node.font?.weight, 0);
        assertNumber(`${node.id}.font.lineHeight`, node.font?.lineHeight, 0, true);
        assertNumber(`${node.id}.font.letterSpacing`, node.font?.letterSpacing, undefined, true);
        if (node.backing) assertRect(`${node.id}.backing`, node.backing);
        break;
      default:
        invalidGeometry(`node type '${String((node as { t?: unknown }).t)}'`);
    }
  }
}

function resolvedHatch(fill: Paint, theme: Theme, scope: string, paint: ScenePaint, ground?: Paint, look?: HatchLook, kind: HatchPattern = 'hatch45') {
  const stroke = paint(hatchPaint(fill, theme, ground, look));
  const background = paint(ground ?? { token: 'background' });
  const { hatchAngle } = theme.pattern;
  const width = hatchStrokeWidthFor(theme, look);
  const gap = theme.pattern.hatchGap * hatchGapFactor(look);
  return { id: `${scope}-${hatchPatternId(stroke, background, hatchAngle, gap, width)}${kind === 'hatch45' ? '' : `-${kind}`}`, stroke, background, gap, width, kind };
}

/**
 * Hatch defs present in a scene. Exported so the opt-in hybrid frame emits the
 * identical defs for its SVG runs: a patterned node never moves to Canvas, so
 * the pattern it refers to must exist exactly once in the hybrid document too.
 */
function ScenePatternDefs({
  geometry,
  theme,
  scope,
  paint,
}: {
  geometry: RenderGeometry;
  theme: Theme;
  scope: string;
  paint: ScenePaint;
}): ReactElement | null {
  const patterns = new Map<string, { stroke: string; background: string; gap: number; width: number; kind: HatchPattern }>();
  for (const node of geometry.scene) {
    if ((node.t === 'rect' || node.t === 'path') && isHatchPattern(node.pattern) && node.fill) {
      const pattern = resolvedHatch(node.fill, theme, scope, paint, node.t === 'rect' ? node.hatchGround : undefined, node.hatch, node.pattern);
      patterns.set(pattern.id, pattern);
    }
  }
  if (patterns.size === 0) return null;
  // The same pre-rotated tile as the SVG serializer: no patternTransform.
  const tileOf = (pattern: { gap: number; width: number; kind: HatchPattern }) => hatchTile(pattern.gap, pattern.width, pattern.kind);
  return (
    <defs>
      {[...patterns.entries()].map(([id, pattern]) => (
        <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={tileOf(pattern).size} height={tileOf(pattern).size}>
          <rect width={tileOf(pattern).size} height={tileOf(pattern).size} fill={pattern.background} />
          {/* Stroke only, as the SVG serializer writes it. */}
          <path d={tileOf(pattern).d} fill="none" stroke={pattern.stroke} strokeWidth={tileOf(pattern).strokeWidth} />
        </pattern>
      ))}
    </defs>
  );
}

function renderedPathFill(node: Extract<SceneNode, { t: 'path' }>, theme: Theme, scope: string, paint: ScenePaint): string {
  if (!node.fill) return 'none';
  return isHatchPattern(node.pattern)
    ? `url(#${resolvedHatch(node.fill, theme, scope, paint, undefined, node.hatch, node.pattern).id})` : paint(node.fill);
}

export function SceneRenderer({
  geometry,
  theme,
  responsive = true,
  style,
  onElementClick,
  onSeriesClick,
  focusStops,
}: SceneRendererProps): ReactElement {
  const provider = useContext(BoardplotThemeContext);
  const patternScope = useScopedId();
  assertRenderableGeometry(geometry);
  const { size, presentation } = geometry;
  const natural = presentation?.naturalSize;
  const width = natural?.unit === 'pt' ? `${natural.width}pt` : size.width;
  const height = natural?.unit === 'pt' ? `${natural.height}pt` : size.height;
  const legendItems = new Map(geometry.legend?.items.flatMap(item => [[item.swatchNodeId, item.id], [item.labelId, item.id]] as [string, string][]) ?? []);
  const { paint, background, style: variables } = provider?.scenePaint(geometry, theme) ?? { paint: (source: Paint) => resolvePaint(source, theme), background: theme.color.background, style: {} };

  return (
    <svg
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      data-bp-engine={ENGINE_REV}
      data-bp-chart={geometry.type}
      data-bp-instance={patternScope}
      data-bp-card={geometry.type === 'kpi' || geometry.type === 'bullet' ? geometry.type : undefined}
      data-bp-sizing={geometry.sizing ? JSON.stringify(geometry.sizing) : undefined}
      data-bp-mode={geometry.mode}
      aria-label={geometry.a11y.title}
      aria-describedby={`${patternScope}-desc`}
      width={width}
      height={height}
      direction="ltr"
      style={responsive
        ? { maxWidth: '100%', height: 'auto', display: 'block', ...TEXT_RESETS, ...variables, ...style }
        : { display: 'block', ...TEXT_RESETS, ...variables, ...style }}
      fontFamily={theme.type.family}
    >
      {geometry.a11y.includeTitle === true && <title>{geometry.a11y.title}</title>}
      <desc id={`${patternScope}-desc`}>{geometry.a11y.desc}</desc>
      <ScenePatternDefs geometry={geometry} theme={theme} scope={patternScope} paint={paint} />
      <rect x={0} y={0} width={size.width} height={size.height} fill={background} />
      {geometry.scene.map((node) =>
        node.tx || node.ty ? (
          <g key={node.id} transform={`translate(${node.tx ?? 0},${node.ty ?? 0})`}>
            <Node node={node} theme={theme} paint={paint} patternScope={patternScope} onClick={onElementClick} onSeriesClick={onSeriesClick} legendItem={legendItems.get(node.id)} focusStops={focusStops} />
          </g>
        ) : (
          <Node key={node.id} node={node} theme={theme} paint={paint} patternScope={patternScope} onClick={onElementClick} onSeriesClick={onSeriesClick} legendItem={legendItems.get(node.id)} focusStops={focusStops} />
        ),
      )}
    </svg>
  );
}

function Node({
  node,
  theme,
  patternScope,
  paint,
  onClick,
  onSeriesClick,
  legendItem,
  focusStops,
}: {
  node: SceneNode;
  theme: Theme;
  patternScope: string;
  paint: ScenePaint;
  onClick?: (node: SceneNode) => void;
  onSeriesClick?: (seriesId: Id) => void;
  legendItem?: string;
  focusStops?: boolean;
}): ReactElement | null {
  const background = paint({ token: 'background' });
  const common = { ...sceneAttributes(node, legendItem), ...nodeInteraction(node, onClick, onSeriesClick, focusStops),
    ...(POINTER_TRANSPARENT_PARTS.has(node.part) ? { pointerEvents: 'none' as const } : {}) };

  switch (node.t) {
    case 'image':
      return <image {...common} x={node.rect.x} y={node.rect.y} width={node.rect.w} height={node.rect.h}
        href={node.src} preserveAspectRatio="xMidYMid meet" role="img" aria-label={node.alt}><title>{node.alt}</title></image>;
    case 'rect': {
      const { rect } = node;
      // A theme's solid, muted plan look draws the outline notation without its outline.
      const mutedPlan = node.pattern === 'outline' && solidMutedPlan(theme);
      const hatched = isHatchPattern(node.pattern), outlined = (node.pattern === 'outline' && !mutedPlan) || node.pattern === 'hollow';
      // A status cell's hatch fills its box without an edge (hatchEdge: false).
      const stroke = (hatched && node.hatchEdge !== false) || outlined ? node.fill : hatched || mutedPlan ? undefined : node.stroke;
      return (
        <rect
          {...common}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          rx={node.radius}
          fill={isHatchPattern(node.pattern) ? `url(#${resolvedHatch(node.fill, theme, patternScope, paint, node.hatchGround, node.hatch, node.pattern).id})` : outlined ? background : paint(mutedPlan ? PLAN_MUTED_PAINT : node.fill)}
          stroke={stroke ? paint(stroke) : undefined}
          strokeWidth={hatched ? strokeToken(theme, 'hair') : outlined ? theme.pattern.outlineStrokeWidth : stroke ? (node.strokeWidth ?? strokeToken(theme, 'mark')) : undefined}
          {...(node.title !== undefined && common.role === undefined ? { role: 'img', 'aria-label': node.title } : {})}
        >{node.title !== undefined && <title>{node.title}</title>}</rect>
      );
    }
    case 'line':
      return (
        <line
          {...common}
          x1={node.x1}
          y1={node.y1}
          x2={node.x2}
          y2={node.y2}
          stroke={paint(node.stroke)}
          strokeWidth={node.width}
          strokeDasharray={node.dash?.join(' ')}
          strokeLinecap={node.lineCap}
        />
      );
    case 'path':
      return (
        <path
          {...common}
          d={node.d}
          fill={renderedPathFill(node, theme, patternScope, paint)}
          stroke={node.stroke ? paint(node.stroke) : undefined}
          strokeWidth={node.stroke ? (node.width ?? strokeToken(theme, 'rule')) : undefined}
          strokeDasharray={node.dash?.join(' ')}
          strokeLinecap={node.lineCap}
          strokeLinejoin="round"
        />
      );
    case 'circle':
      return (
        <circle
          {...common}
          cx={node.cx}
          cy={node.cy}
          r={node.r}
          fill={paint(node.fill)}
          stroke={node.stroke ? paint(node.stroke) : undefined}
          // A ring carries its own weight. Without this the
          // sparkline's last-point ring drew at SVG's own 1 px default here
          // while the serialized SVG drew the 1.5 the spec asks for.
          strokeWidth={node.stroke ? (node.strokeWidth ?? strokeToken(theme, 'mark')) : undefined}
        >{node.title !== undefined && <title>{node.title}</title>}</circle>
      );
    case 'text': {
      const lineH = node.font.size * (node.font.lineHeight ?? 1.2);
      const letterSpacing = node.font.letterSpacing ?? 0;
      const x = node.x + (node.align === 'end' ? letterSpacing : node.align === 'middle' ? letterSpacing / 2 : 0);
      const baselineY = node.y + node.font.size * TEXT_ASCENT;
      // Same shape as the SVG serializer: the <text> element itself
      // carries data-id, data-part and data-bp-role, the backing is a sibling
      // that fades with the label and still takes the label's click.
      const role = textRole(node);
      const figures = numericVariant(role, theme);
      const placed = {
        x,
        y: baselineY,
        transform: node.rotate ? `rotate(${node.rotate} ${x} ${baselineY})` : undefined,
        textAnchor: node.align === 'middle' ? 'middle' : node.align === 'end' ? 'end' : 'start',
        fontFamily: node.font.family !== theme.type.family ? node.font.family : undefined,
        fontSize: node.font.size,
        fontWeight: node.font.weight,
        ...(node.font.style === undefined ? {} : { fontStyle: node.font.style }),
        letterSpacing: letterSpacing || undefined,
      } as const;
      const style = figures ? { fontVariantNumeric: figures } : undefined;
      const spans = node.runs
        ? // Styled runs (single line): no per-tspan x — the font engine
          // owns the intra-line advance (see SceneNode.runs).
          node.runs.map((run, i) => (
            <tspan
              key={i}
              fontWeight={
                run.weight !== undefined && run.weight !== node.font.weight
                  ? run.weight
                  : undefined
              }
            >
              {run.text}
            </tspan>
          ))
        : node.lines.map((line, i) => (
            <tspan key={i} x={x} dy={i === 0 ? 0 : lineH}>
              {line}
            </tspan>
          ));
      // The halo is a stroked copy under the label, as in the SVG serializer
      //: paint-order on one element is lost in Office and LibreOffice.
      const halo = node.halo ? paint(haloPaint(node.ink, theme)) : undefined;
      return (
        <>
          {node.backing && (
            <rect
              x={node.backing.x}
              y={node.backing.y}
              width={node.backing.w}
              height={node.backing.h}
              fill={background}
              opacity={node.opacity === undefined ? 0.92 : 0.92 * node.opacity}
              onClick={common.onClick}
            />
          )}
          {halo && (
            <text aria-hidden="true" opacity={node.opacity} onClick={common.onClick} {...placed}
              fill={halo} stroke={halo} strokeWidth={2.5} strokeLinejoin="round" style={style}>
              {spans}
            </text>
          )}
          <text {...common} data-bp-role={role} {...placed} fill={paint(node.ink)} style={style}>
            {node.title && <title>{node.title}</title>}
            {spans}
          </text>
        </>
      );
    }
    default:
      return null;
  }
}

function nodeInteraction(node: SceneNode, onElementClick?: (node: SceneNode) => void, onSeriesClick?: (seriesId: Id) => void, focusStops?: boolean) {
  const seriesId = node.owner.seriesId;
  const seriesPart = !onElementClick && onSeriesClick !== undefined && seriesId !== undefined
    && (SERIES_POINTER_PARTS.has(node.part) || SERIES_KEY_PARTS.has(node.part));
  const onClick = onElementClick ? () => onElementClick(node) : seriesPart ? () => onSeriesClick(seriesId) : undefined;
  // A series click on a line, area, marker or swatch is pointer-only: one series adds no tab stop per point.
  const keyboard = onClick !== undefined && !(seriesPart && SERIES_POINTER_PARTS.has(node.part));
  // An event's marker or title line: a stop that opens the event's hover card on focus. It is named by its full reading.
  const stop = focusStops === true && !keyboard && (node.t === 'circle' || node.t === 'text') && node.focusStop === true;
  return {
    opacity: node.opacity,
    'data-id': node.id,
    'data-part': node.part,
    ...(onClick && !keyboard ? { style: { cursor: 'pointer' } } : {}),
    onClick,
    onKeyDown: keyboard
      ? (event: KeyboardEvent<SVGElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onClick();
        }
      : undefined,
    ...(stop ? { 'data-bp-stop': '' } : {}),
    tabIndex: keyboard || stop ? 0 : undefined,
    role: keyboard ? 'button' : stop ? 'img' : undefined,
    'aria-label': stop && (node.t === 'circle' || node.t === 'text') ? node.title : keyboard ? (seriesPart ? (node.t === 'text' ? node.lines.join(' ') : seriesId) : [node.part, node.display?.value].filter(Boolean).join(': ') || node.id) : undefined,
  };
}
