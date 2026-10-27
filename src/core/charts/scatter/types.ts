import type { ScatterOptions } from '../../types/options';

/** 'none' leaves the zone without a wash: a grid cell keeps its caption and the grid rules. */
export type StrategyZoneTone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'none';

/** Where a zone's label goes: captioned in the plot (default), keyed in the legend row with its fill, or both. */
type StrategyZoneLabelAt = 'plot' | 'key' | 'both';

export interface StrategyZoneCell {
  id: string;
  column: number;
  row: number;
  label?: string;
  tone?: StrategyZoneTone;
  labelAt?: StrategyZoneLabelAt;
  a11y?: string;
}

export interface StrategyZoneGrid {
  x: number[];
  y: number[];
  cells?: StrategyZoneCell[];
  xLabels?: string[];
  yLabels?: string[];
}

export interface StrategyZoneRegion {
  id: string;
  points: { x: number; y: number }[];
  smooth?: boolean;
  label?: string;
  tone?: StrategyZoneTone;
  labelAt?: StrategyZoneLabelAt;
  a11y?: string;
}

export type StrategyZones =
  | { grid: StrategyZoneGrid; regions?: never }
  | { regions: StrategyZoneRegion[]; grid?: never };

export type ScatterStrategyOptions = ScatterOptions & {
  zones?: StrategyZones;
};

export interface StrategyZoneMark {
  id: string;
  kind: 'cell' | 'region';
  /** Absent for a grid cell with tone 'none', which draws no fill. */
  nodeId?: string;
  labelId?: string;
  description: string;
}

export interface StrategyZonesDerived {
  kind: 'grid' | 'regions';
  descriptions: string[];
  cellCount?: number;
  regionCount?: number;
}
