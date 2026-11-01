/** Zod-free tilemap chart registration. */

import type { ChartCore } from '../../registry';
import { layoutTilemap } from './layout';
import { TILEMAP_SIZING } from './sizing';
import type {
  TilemapData,
  TilemapDerived,
  TilemapMarks,
  TilemapOptions,
} from './types';

export const tilemapCore: ChartCore<
  TilemapData,
  TilemapOptions,
  TilemapMarks,
  TilemapDerived
> = {
  type: 'tilemap',
  sizing: TILEMAP_SIZING,
  title: 'Tile-grid map',
  summary: 'Equal-size region tiles with explicit scale, no-data trace, and solver-placed abbreviation tiers',
  layout: layoutTilemap,
  defaults: { scale: { kind: 'sequential' } },
  annotationKinds: []
};
