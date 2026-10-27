/**
 * The `boardplot/geo/europe` entry: opt-in registration for the 'europe'
 * geo pack. Nothing else imports this file (./index reads the generated data),
 * so the call stays in dist/geo/europe.js, which package.json lists as
 * side-effectful. A second importer would move it into a shared chunk, and a
 * host bundler drops a bare import of a chunk: getGeoPack('europe') would then
 * throw for a pack the consumer did import.
 *
 * The re-export is annotated as GeoPack on purpose: the generated const is
 * unannotated, and letting its literal type escape into dist/geo/europe.d.ts
 * costs a six-figure declaration file for a pack that only ever satisfies
 * the GeoPack contract.
 */

import type { GeoPack } from '../types';
import { registerGeoPack } from './registry';
import { EUROPE_PACK as BAKED } from './europe.generated';

const EUROPE_PACK: GeoPack = BAKED;

registerGeoPack(EUROPE_PACK);

export { EUROPE_PACK };
