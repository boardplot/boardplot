/**
 * The `boardplot/geo/de-states` entry: opt-in registration for the 'de-states'
 * geo pack. Nothing else imports this file (./index reads the generated data),
 * so the call stays in dist/geo/de-states.js, which package.json lists as
 * side-effectful. A second importer would move it into a shared chunk, and a
 * host bundler drops a bare import of a chunk: getGeoPack('de-states') would then
 * throw for a pack the consumer did import.
 *
 * The re-export is annotated as GeoPack on purpose: the generated const is
 * unannotated, and letting its literal type escape into dist/geo/de-states.d.ts
 * costs a six-figure declaration file for a pack that only ever satisfies
 * the GeoPack contract.
 */

import type { GeoPack } from '../types';
import { registerGeoPack } from './registry';
import { DE_STATES_PACK as BAKED } from './de-states.generated';

const DE_STATES_PACK: GeoPack = BAKED;

registerGeoPack(DE_STATES_PACK);

export { DE_STATES_PACK };
