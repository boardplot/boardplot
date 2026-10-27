import type { IconName } from '../../icons';
import type { LegendItemInput } from '../../frame';
import type { Point } from '../../geometry';
import type { PlaceDecision, PlacedLabel, SceneNode, LintWarning } from '../../types/scene';

export type GeoOverlaySize = 'sm' | 'md' | 'lg';
export type GeoOverlayTone = 'good' | 'bad' | 'warn' | 'neutral' | 'info';
/** The key words for each overlay tone a map uses. */
export type GeoOverlayToneNames = Partial<Record<GeoOverlayTone, string>>;

export type GeoOverlayAnchor =
  | { region: string }
  | { lon: number; lat: number };

interface GeoOverlayPieShare {
  label: string;
  value: number;
  tone?: GeoOverlayTone;
}

export type GeoOverlayGlyph =
  | { kind: 'pie'; shares: GeoOverlayPieShare[] }
  | { kind: 'harvey'; value: number; tone?: GeoOverlayTone }
  | { kind: 'status'; status: Exclude<GeoOverlayTone, 'info'> }
  | { kind: 'icon'; name: IconName; tone?: GeoOverlayTone }
  | { kind: 'marker'; shape?: 'circle' | 'square' | 'diamond'; tone?: GeoOverlayTone };

export interface GeoOverlay {
  id: string;
  at: GeoOverlayAnchor;
  glyph: GeoOverlayGlyph;
  label: string;
  size?: GeoOverlaySize;
  a11y?: string;
}

export interface GeoOverlayMark {
  id: string;
  glyph: GeoOverlayGlyph['kind'];
  nodeIds: string[];
  labelId: string;
  anchor: Point;
  description: string;
}

export interface GeoOverlayRenderResult {
  nodes: SceneNode[];
  labels: PlacedLabel[];
  marks: GeoOverlayMark[];
  warnings: LintWarning[];
  decisions: PlaceDecision[];
  descriptions: string[];
}

export interface GeoOverlayLegendModel {
  items: LegendItemInput[];
  descriptions: string[];
  warnings: LintWarning[];
}
