import type { NamedColumnState } from '../../schema/namedColumns';
import type { Direction } from '../../types/cell';
import type { BaseOptionsFor } from '../../types/options';
import type { Paint } from '../../types/scene';
import type { GeoBoundaryClass, GeoPackId, GeoWorldview } from '../../geo/types';
import type { GeoOverlay, GeoOverlayMark, GeoOverlayToneNames } from './overlayTypes';

export * from './overlayTypes';

export interface ChoroplethDatum {
  id: string;
  value: number | null;
  state?: NamedColumnState;
}

export interface ChoroplethData {
  pack: GeoPackId;
  regions: ChoroplethDatum[];
  overlays?: GeoOverlay[];
}

export type ChoroplethScale =
  | { kind: 'sequential' }
  | {
      kind: 'diverging';
      midpoint: number;
      /** Text appended to the formatted midpoint in the explanatory key. */
      midpointLabel?: string;
      /**
       * Which side of the midpoint is favorable. A diverging map is a
       * judgment (the good/bad pair), not an accent ramp, so the poles
       * come from color.good/color.bad and the author may flip them for
       * measures whose high side is unfavorable (inflation, churn, cost).
       * Default 'higherIsBetter' — same vocabulary as series.direction.
       */
      polarity?: Direction;
    };

export type ChoroplethLabelPolicy = 'auto' | 'all' | 'none';

export type ChoroplethOptions = Omit<BaseOptionsFor<'choropleth'>, 'labels'> & {
  scale?: ChoroplethScale;
  classes?: 3 | 4 | 5 | 6 | 7;
  /** Four ascending thresholds in source units define five classes, as on cohort. */
  steps?: [number, number, number, number];
  /** false is the same as 'none'. */
  labels?: ChoroplethLabelPolicy | false;
  /** Print each labelled region's value after its code. Default true when the map labels at most 10 regions; refused with labels 'none' or false. */
  regionValues?: boolean;
  labelRegions?: string[];
  microStateMarkers?: boolean;
  /** Projected region area / projected map bounds area. Default 0.001 for automatic labels; 0 disables. */
  smallRegionArea?: number;
  /**
   * The table of every region with its class swatch, code and value. 'auto'
   * (default): beside the map when the map keeps most of the row, else under
   * it; off above VALUE_TABLE_MAX_ROWS (20) regions, without values, or when
   * the canvas height cannot hold it. 'side' and 'below' force a place; false
   * leaves it off.
   */
  valueTable?: 'auto' | 'side' | 'below' | false;
  /** Default false. true adds the label-policy note; the pack's disclaimer stays on the source line and the inset scale note prints regardless. */
  methodNote?: boolean;
  /** Title of the colour key; default 'Measure, unit' from subtitle.measure and unit, else the unit. */
  keyTitle?: string;
  /** What each overlay tone marks, for its key entry, e.g. { warn: 'Behind plan' }. */
  overlayTones?: GeoOverlayToneNames;
  /** The measure the overlay glyphs show, as a key heading without a swatch, e.g. 'Activation progress, %'. */
  overlayMeasure?: string;
};

interface ChoroplethRegionMark {
  id: string;
  /** The region's name in its pack ("Brandenburg" for DE-BB). */
  name: string;
  pathNodeId: string;
  hatchNodeId?: string;
  value: number | null;
  state: 'value' | 'no-data' | 'not-in-data' | NamedColumnState;
  fill: Paint;
}

interface ChoroplethBoundaryMark {
  id: string;
  pathNodeId: string;
  geometryClass: GeoBoundaryClass;
  stroke: Paint;
  dash: number[];
}

export interface ChoroplethMarks {
  regions: ChoroplethRegionMark[];
  boundaries: ChoroplethBoundaryMark[];
  overlays?: GeoOverlayMark[];
}

export interface ChoroplethDerived {
  domain: { min: number | null; max: number | null; midpoint: number | null; polarity: Direction | null };
  legendRange: { min: number | null; max: number | null };
  /** Class edges from min to max when the scale is classed (round breaks or explicit steps). */
  classEdges?: number[];
  /** All regions without a numeric value, including unlisted regions. */
  noDataCount: number;
  unlistedCount: number;
  overlayDescriptions?: string[];
  mapFrame: { x: number; y: number; w: number; h: number };
  pack: {
    id: GeoPackId;
    hash: string;
    packRev: number;
    worldview: GeoWorldview;
    attribution: string;
  };
}
