/**
 * All geo packs — the compatibility surface. Importing this module registers
 * every pack, which is what the demo and the test suite rely on; the CLI
 * and the MCP server call `registerAllGeoPacks()`, which no bundler drops.
 *
 * It reads the generated data, not the `./<id>` modules: those are the
 * `boardplot/geo/<id>` entry files, and a second importer would move
 * their registration out of the entry file into a shared chunk.
 *
 * This file itself is NOT listed in package.json "sideEffects": marking it
 * side-effectful would drag all six baked packs into every consumer that
 * imports a name from it.
 */

import type { GeoPack } from '../types';
import { registerGeoPack } from './registry';
import { DACH_PACK as DACH } from './dach.generated';
import { DE_STATES_PACK as DE_STATES } from './de-states.generated';
import { EU27_PACK as EU27 } from './eu27.generated';
import { EUROPE_PACK as EUROPE } from './europe.generated';
import { US_STATES_PACK as US_STATES } from './us-states.generated';
import { WORLD_PACK as WORLD } from './world.generated';

// Annotated as GeoPack for the reason ./dach.ts gives.
export const DACH_PACK: GeoPack = DACH;
export const DE_STATES_PACK: GeoPack = DE_STATES;
export const EU27_PACK: GeoPack = EU27;
export const EUROPE_PACK: GeoPack = EUROPE;
export const US_STATES_PACK: GeoPack = US_STATES;
export const WORLD_PACK: GeoPack = WORLD;

export function registerAllGeoPacks(): void {
  for (const pack of [DE_STATES_PACK, EU27_PACK, DACH_PACK, EUROPE_PACK, WORLD_PACK, US_STATES_PACK]) registerGeoPack(pack);
}

registerAllGeoPacks();

export {
  GeoPackNotRegisteredError,
  geoRegistryInstanceCount,
  getGeoPack,
  listGeoPacks,
  registerGeoPack,
  registeredGeoPackIds,
} from './registry';
