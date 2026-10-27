import type { NamedColumnState } from '../../schema/namedColumns';
import type { TilePackId } from '../../geo/tiles';
import type { Direction } from '../../types/cell';
import type { BaseOptionsFor } from '../../types/options';
import type { Paint } from '../../types/scene';
import type { GeoOverlay, GeoOverlayMark, GeoOverlayToneNames } from '../choropleth/overlayTypes';

export interface TilemapDatum {
  id: string;
  value: number | null;
  state?: NamedColumnState;
}

export interface TilemapData {
  pack: TilePackId;
  regions: TilemapDatum[];
  overlays?: GeoOverlay[];
}

export type TilemapScale =
  | { kind: 'sequential' }
  | {
      kind: 'diverging';
      midpoint: number;
      /**
       * Which side of the midpoint is favorable. A diverging map is a
       * judgment (the good/bad pair), not an accent ramp, so the poles
       * come from color.good/color.bad and the author may flip them for
       * measures whose high side is unfavorable (inflation, churn, cost).
       * Default 'higherIsBetter' — same vocabulary as series.direction.
       */
      polarity?: Direction;
    };

export interface TilemapOptions extends BaseOptionsFor<'tilemap'> {
  scale?: TilemapScale;
  classes?: 3 | 4 | 5 | 6 | 7;
  /** Four ascending thresholds in source units define five classes, as on cohort. */
  steps?: [number, number, number, number];
  /** Print each tile's value under its code. Unset: only when every value fits its tile. */
  regionValues?: boolean;
  /** What each overlay tone marks, for its key entry, e.g. { warn: 'Behind plan' }. */
  overlayTones?: GeoOverlayToneNames;
  /** The measure the overlay glyphs show, for their own key entry, e.g. 'Activation progress, %'. */
  overlayMeasure?: string;
}

interface TilemapRegionMark {
  id: string;
  /** The region's name in its tile pack ("Kazakhstan" for KZ). */
  name: string;
  nodeId: string;
  rect: { x: number; y: number; w: number; h: number };
  value: number | null;
  state: 'value' | 'no-data' | 'not-in-data' | NamedColumnState;
  fill: Paint;
}

export interface TilemapMarks {
  regions: TilemapRegionMark[];
  overlays?: GeoOverlayMark[];
}

export interface TilemapDerived {
  domain: { min: number | null; max: number | null; midpoint: number | null; polarity: Direction | null };
  legendRange: { min: number | null; max: number | null };
  /** All regions without a numeric value, including unlisted regions. */
  noDataCount: number;
  unlistedCount: number;
  overlayDescriptions?: string[];
  tileSize: number;
  tileGap: number;
  gridFrame: { x: number; y: number; w: number; h: number };
  pack: {
    id: TilePackId;
    layoutAuthor: string;
    layoutVersion: string;
    memberDate: string;
    adjacencyExceptionCount: number;
    attribution: string;
  };
}
