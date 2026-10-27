/**
 * The `boardplot/geo/dach` entry: opt-in registration for the 'dach'
 * geo pack. Nothing else imports this file (./index reads the generated data),
 * so the call stays in dist/geo/dach.js, which package.json lists as
 * side-effectful. A second importer would move it into a shared chunk, and a
 * host bundler drops a bare import of a chunk: getGeoPack('dach') would then
 * throw for a pack the consumer did import.
 *
 * The re-export is annotated as GeoPack on purpose: the generated const is
 * unannotated, and letting its literal type escape into dist/geo/dach.d.ts
 * costs a six-figure declaration file for a pack that only ever satisfies
 * the GeoPack contract.
 */

import type { GeoPack } from '../types';
import { registerGeoPack } from './registry';
import { DACH_PACK as BAKED } from './dach.generated';

const DACH_PACK: GeoPack = BAKED;

registerGeoPack(DACH_PACK);

export { DACH_PACK };
