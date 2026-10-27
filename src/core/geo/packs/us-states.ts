/**
 * The `boardplot/geo/us-states` entry: opt-in registration for the 'us-states'
 * geo pack. Nothing else imports this file (./index reads the generated data),
 * so the call stays in dist/geo/us-states.js, which package.json lists as
 * side-effectful. A second importer would move it into a shared chunk, and a
 * host bundler drops a bare import of a chunk: getGeoPack('us-states') would then
 * throw for a pack the consumer did import.
 *
 * The re-export is annotated as GeoPack on purpose: the generated const is
 * unannotated, and letting its literal type escape into dist/geo/us-states.d.ts
 * costs a six-figure declaration file for a pack that only ever satisfies
 * the GeoPack contract.
 */

import type { GeoPack } from '../types';
import { registerGeoPack } from './registry';
import { US_STATES_PACK as BAKED } from './us-states.generated';

const US_STATES_PACK: GeoPack = BAKED;

registerGeoPack(US_STATES_PACK);

export { US_STATES_PACK };
