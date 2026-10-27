/**
 * The `boardplot/geo/eu27` entry: opt-in registration for the 'eu27'
 * geo pack. Nothing else imports this file (./index reads the generated data),
 * so the call stays in dist/geo/eu27.js, which package.json lists as
 * side-effectful. A second importer would move it into a shared chunk, and a
 * host bundler drops a bare import of a chunk: getGeoPack('eu27') would then
 * throw for a pack the consumer did import.
 *
 * The re-export is annotated as GeoPack on purpose: the generated const is
 * unannotated, and letting its literal type escape into dist/geo/eu27.d.ts
 * costs a six-figure declaration file for a pack that only ever satisfies
 * the GeoPack contract.
 */

import type { GeoPack } from '../types';
import { registerGeoPack } from './registry';
import { EU27_PACK as BAKED } from './eu27.generated';

const EU27_PACK: GeoPack = BAKED;

registerGeoPack(EU27_PACK);

export { EU27_PACK };
