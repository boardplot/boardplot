import type { TilePack, TilePackId } from './types';
import { EU27_TILE_PACK } from './eu27.generated';
import { EUROPE_TILE_PACK } from './europe.generated';
import { US_STATES_TILE_PACK } from './us-states.generated';
import { WORLD_TILE_PACK } from './world.generated';

const TILE_PACKS: Record<TilePackId, TilePack> = {
  eu27: EU27_TILE_PACK,
  europe: EUROPE_TILE_PACK,
  world: WORLD_TILE_PACK,
  'us-states': US_STATES_TILE_PACK,
};

export { EU27_TILE_PACK, EUROPE_TILE_PACK, US_STATES_TILE_PACK, WORLD_TILE_PACK };

export function getTilePack(id: TilePackId): TilePack {
  return TILE_PACKS[id];
}

export * from './types';
