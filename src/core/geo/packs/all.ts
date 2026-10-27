/**
 * The `boardplot/geo` entry: registers all six packs. Nothing else
 * imports this file, so the call stays in dist/geo/index.js, which
 * package.json lists as side-effectful. A registration inside `./index` would
 * sit in a shared chunk, and a host bundler drops a bare import of a chunk.
 */

import { registerAllGeoPacks } from './index';

registerAllGeoPacks();

export {
  DACH_PACK,
  DE_STATES_PACK,
  EU27_PACK,
  EUROPE_PACK,
  US_STATES_PACK,
  WORLD_PACK,
  GeoPackNotRegisteredError,
  geoRegistryInstanceCount,
  getGeoPack,
  listGeoPacks,
  registerGeoPack,
  registeredGeoPackIds,
} from './index';
