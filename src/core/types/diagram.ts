import type { Point, Rect, Size } from '../geometry';
import type { IconName } from '../icons';
import type { BaseOptionsFor, RefusedOptionKeys } from './options';

export const DIAGRAM_VARIANTS = [
  'hierarchy',
  'issue-tree',
  'linear-process',
  'customer-journey',
  'circular-process',
  'strategy-house',
  'roadmap',
  'architecture',
] as const;

export type DiagramVariant = (typeof DIAGRAM_VARIANTS)[number];

export type DiagramNodeKind =
  | 'entity'
  | 'issue'
  | 'driver'
  | 'step'
  | 'painPoint'
  | 'vision'
  | 'objective'
  | 'initiative'
  | 'enabler'
  | 'foundation'
  | 'milestone'
  | 'callout';

export type DiagramVisualRole =
  | 'primary'
  | 'accent'
  | 'secondary'
  | 'muted'
  | 'good'
  | 'bad'
  | 'warn'
  | 'category';

export interface DiagramFractionPoint {
  x: number;
  y: number;
}

export interface DiagramNodeSize {
  width: number;
  height: number;
}

export type DiagramShape =
  | { kind: 'rectangle' }
  | { kind: 'roundedRect'; radius?: number }
  | { kind: 'circle' }
  | { kind: 'pill' }
  | { kind: 'chevron'; tip?: number }
  | { kind: 'text' }
  | { kind: 'icon'; name: IconName }
  | { kind: 'roof'; apex?: number; eaveInset?: number };

export type DiagramPortLocation =
  | { side: 'top' | 'right' | 'bottom' | 'left'; offset?: number }
  | { perimeter: number };

export interface DiagramPort {
  id: string;
  at: DiagramPortLocation;
  intent?: 'in' | 'out' | 'bidi';
  capacity?: number;
}

export interface DiagramBadge {
  text: string;
  role?: DiagramVisualRole;
  paletteKey?: string;
}

export interface DiagramNode {
  id: string;
  kind: DiagramNodeKind;
  shape: DiagramShape;
  label: string;
  secondaryLabel?: string;
  caption?: string;
  icon?: IconName;
  badge?: DiagramBadge;
  role?: DiagramVisualRole;
  paletteKey?: string;
  minSize?: DiagramNodeSize;
  size?: DiagramNodeSize;
  position?: DiagramFractionPoint;
  ports?: DiagramPort[];
  groupId?: string;
  laneId?: string;
  order?: number;
  /** Architecture: a named cross-axis track. Nodes in one track line up across zones or lanes. */
  track?: string;
  /** Architecture: a wide band across a lane, or a full-height rail in a zone. */
  span?: 'full';
}

export interface DiagramEndpoint {
  nodeId: string;
  portId?: string;
}

export interface DiagramEdge {
  id: string;
  source: DiagramEndpoint;
  target: DiagramEndpoint;
  routing?: 'straight' | 'elbow' | 'orthogonal' | 'curved';
  arrowStart?: boolean;
  arrowEnd?: boolean;
  dash?: 'solid' | 'dashed' | 'dotted';
  weight?: 'hairline' | 'normal' | 'strong';
  role?: DiagramVisualRole;
  paletteKey?: string;
  label?: string;
  waypoints?: DiagramFractionPoint[];
  /** Architecture: a return edge does not set the node order. Default forward. */
  flow?: 'forward' | 'return';
}

export interface DiagramGroup {
  id: string;
  title: string;
  padding?: number;
  order?: number;
  role?: DiagramVisualRole;
  paletteKey?: string;
}

export interface DiagramLane {
  id: string;
  label?: string;
  orientation: 'horizontal' | 'vertical';
  order?: number;
  role?: DiagramVisualRole;
  paletteKey?: string;
}

/** Architecture: one shared label for edges that cross one gutter. */
export interface DiagramChannel {
  id: string;
  edgeIds: string[];
  label: string;
}

/** One key entry: what the fill of the nodes in `role` (and `paletteKey`) means. */
/**
 * One key entry: what a node fill means (role), or what a line style means
 * (line), drawn as the style the edges use.
 */
export type DiagramKeyEntry =
  | { role: DiagramVisualRole; paletteKey?: string; label: string; line?: undefined }
  | { line: 'solid' | 'dashed' | 'dotted'; label: string; role?: undefined; paletteKey?: undefined };

export interface DiagramData {
  nodes: DiagramNode[];
  edges?: DiagramEdge[];
  groups?: DiagramGroup[];
  lanes?: DiagramLane[];
  /** Names what a node fill means; drawn as the diagram key. */
  key?: DiagramKeyEntry[];
  /** Architecture: one shared label for edges in one gutter. */
  channels?: DiagramChannel[];
}

type DiagramCommonOptionKeys =
  | 'locale'
  | 'target'
  | 'textScale'
  | 'textSize'
  | 'a11y'
  | 'size'
  | 'mode'
  | 'embed'
  | 'margin'
  | 'canvas'
  | 'title'
  | 'subtitle'
  | 'source'
  | 'footnotes'
  | 'notes'
  | 'theme'
  | 'palette'
  // 'interactive' is consumed by the shared render layer's interactive
  // context, not by diagram layout, so accepting it is functional, not inert.
  | 'interactive'
  // 'measure' is the TS-only measurement injection every other layout reads
  // (`options.measure ?? defaultMeasurer`); diagram reads it too, and it is
  // excluded from the JSON Schema like the other charts' key of the same name.
  | 'measure'
  | 'transpose'
  | RefusedOptionKeys<'diagram'>;

export type DiagramCommonOptions = Pick<BaseOptionsFor<'diagram'>, DiagramCommonOptionKeys>;

export type DiagramOptions = DiagramCommonOptions &
  (
    | { variant: 'hierarchy' }
    | { variant: 'issue-tree' }
    | { variant: 'linear-process' }
    | { variant: 'customer-journey'; flow?: 'columns' | 'serpentine' }
    | { variant: 'circular-process' }
    | { variant: 'strategy-house' }
    | { variant: 'roadmap' }
    | { variant: 'architecture'; flow?: 'columns' | 'lanes' }
  );

export interface ResolvedDiagramPort {
  nodeId: string;
  portId: string;
  automatic: boolean;
  point: Point;
  normal: Point;
  intent: 'in' | 'out' | 'bidi';
  capacity?: number;
  used: number;
}

export interface ResolvedDiagramNode {
  id: string;
  kind: DiagramNodeKind;
  shape: DiagramShape;
  rect: Rect;
  contentRect: Rect;
  ports: ResolvedDiagramPort[];
  labelIds: string[];
  sceneNodeIds: string[];
  badgeBox?: Rect;
  captionBox?: Rect;
  /** The node's secondary text prints as lines of its outside label. */
  secondaryPrinted?: boolean;
}

export interface ResolvedDiagramEndpoint {
  nodeId: string;
  portId: string;
  point: Point;
  escapePoint: Point;
}

export interface DiagramPolylineRoute {
  kind: 'polyline';
  points: Point[];
  segments: Array<{ from: Point; to: Point }>;
  bounds: Rect;
}

export interface DiagramPathRoute {
  kind: 'path';
  d: string;
  controlPoints: Point[];
  bounds: Rect;
}

export interface ResolvedDiagramEdge {
  id: string;
  source: ResolvedDiagramEndpoint;
  target: ResolvedDiagramEndpoint;
  requestedRouting: 'straight' | 'elbow' | 'orthogonal' | 'curved';
  actualRouting: 'straight' | 'elbow' | 'orthogonal' | 'curved';
  route: DiagramPolylineRoute | DiagramPathRoute;
  labelBox?: Rect;
  bends: number;
  crossings: number;
  sceneNodeIds: string[];
}

export interface ResolvedDiagramGroup {
  id: string;
  bounds: Rect;
  titleBox: Rect;
  memberNodeIds: string[];
  sceneNodeIds: string[];
}

export interface ResolvedDiagramLane {
  id: string;
  bounds: Rect;
  headerBox?: Rect;
  memberNodeIds: string[];
  sceneNodeIds: string[];
}

export interface DiagramMarks {
  nodes: ResolvedDiagramNode[];
  edges: ResolvedDiagramEdge[];
  groups: ResolvedDiagramGroup[];
  lanes: ResolvedDiagramLane[];
}

export interface DiagramDerived {
  variant: DiagramVariant;
  readingOrder: string[];
  syntheticEdgeIds: string[];
  degradedEdgeIds: string[];
  minimumRequiredSize?: Size;
  clearance: number;
  trajectory?: Point[];
}
