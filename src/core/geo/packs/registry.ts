/**
 * Geo pack registry. Packs register themselves; nothing here reaches a
 * `*.generated.ts` file, so importing this module costs no map geometry.
 * A pack becomes available only through its own module (`./world` and
 * friends) or through the all-packs barrel `./index`.
 */

import { NormalizeError } from '../../normalize/shared';
import type { GeoPack, GeoPackId } from '../types';

// Declaration order of GeoPackId. listGeoPacks() must not depend on which
// packs happen to be registered or on import order — determinism.
const PACK_ORDER: readonly GeoPackId[] = ['de-states', 'eu27', 'dach', 'europe', 'world', 'us-states'];

const registered = new Map<GeoPackId, GeoPack>();

/**
 * Cross-instance diagnostic ledger — NOT the store.
 *
 * `registered` above is module-level, so two copies of boardplot in one
 * dependency tree (an app plus a component library that depends on it —
 * ordinary npm duplication) get two independent maps. The consumer then adds
 * `import 'boardplot/geo/world'`, it registers into copy B, the
 * choropleth they render resolves copy A, and the old error told them to add
 * the import they had already added — forever, with no way to tell "you forgot
 * it" from "your import landed in another instance".
 *
 * This ledger makes the two cases distinguishable. It records, on a
 * process-global symbol shared by every copy, which pack ids were registered
 * ANYWHERE and how many registry instances loaded. It never serves a pack: a
 * pack registered into another instance is still not available here, and
 * handing one over would be the silent substitution the contract forbids. It
 * only lets the message name the real fault.
 */
interface GeoRegistryLedger {
  instances: number;
  registeredAnywhere: Set<string>;
}
const LEDGER_KEY = Symbol.for('boardplot.geo-pack-registry.diagnostics.v1');
const globalScope = globalThis as unknown as Record<symbol, GeoRegistryLedger | undefined>;
const ledger: GeoRegistryLedger = (globalScope[LEDGER_KEY] ??= {
  instances: 0,
  registeredAnywhere: new Set<string>(),
});
ledger.instances += 1;

/**
 * Thrown by {@link getGeoPack}. Carries a `code` so the CLI/MCP envelope names
 * this fault instead of folding it into the generic `layout-error` fallback
 * (`src/cli/main.ts`), and a `pack` so a caller can act on it programmatically.
 * It is a NormalizeError, so a React chart draws it as a refusal card.
 */
export class GeoPackNotRegisteredError extends NormalizeError {
  readonly pack: string;
  readonly registered: string[];
  readonly duplicateInstall: boolean;

  constructor(options: {
    message: string;
    code: string;
    pack: string;
    registered: string[];
    duplicateInstall: boolean;
  }) {
    super(options.code, '', options.message);
    this.name = 'GeoPackNotRegisteredError';
    this.pack = options.pack;
    this.registered = options.registered;
    this.duplicateInstall = options.duplicateInstall;
  }
}

export function registerGeoPack(pack: GeoPack): void {
  registered.set(pack.id, pack);
  ledger.registeredAnywhere.add(pack.id);
}

export function registeredGeoPackIds(): GeoPackId[] {
  return PACK_ORDER.filter((id) => registered.has(id));
}

export function listGeoPacks(): GeoPack[] {
  return registeredGeoPackIds().map((id) => registered.get(id)!);
}

/** How many copies of this module are live in the process (1 in a healthy install). */
export function geoRegistryInstanceCount(): number {
  return ledger.instances;
}

/**
 * The caller is an AI agent that never sees a terminal, so a missing pack
 * fails loudly with the one line that fixes it. Never `undefined`, never an
 * empty pack, never a substituted one — a silently wrong map is worse than
 * no map.
 */
export function getGeoPack(id: GeoPackId): GeoPack {
  const pack = registered.get(id);
  if (pack) return pack;
  const have = registeredGeoPackIds();
  const haveText = have.length > 0 ? have.join(', ') : '(none)';

  if (!PACK_ORDER.includes(id)) {
    throw new GeoPackNotRegisteredError({
      message:
        `unknown geo pack '${String(id)}'. Available pack ids: ${PACK_ORDER.join(', ')}. ` +
        `Registered right now: ${haveText}.`,
      code: 'unknown-geo-pack',
      pack: String(id),
      registered: have,
      duplicateInstall: false,
    });
  }

  // Registered somewhere in this process, but not in THIS module instance, AND
  // more than one instance exists: the import landed in a second copy of
  // boardplot. Repeating the "add the import" advice here would be
  // unfalsifiable. The instance count is part of the condition on purpose — in
  // a healthy single-copy process this branch can never fire, so the ordinary
  // "you forgot the import" message is never displaced by a stale ledger.
  if (ledger.instances > 1 && ledger.registeredAnywhere.has(id)) {
    throw new GeoPackNotRegisteredError({
      message:
        `geo pack '${id}' WAS registered, but into a different copy of boardplot — ` +
        `${ledger.instances} copies of the geo registry are loaded in this process, and the ` +
        `chart being rendered resolves a copy that has ${haveText}. Adding ` +
        `\`import 'boardplot/geo/${id}';\` again will not help. Fix: de-duplicate ` +
        `boardplot so exactly one copy is installed — one version in the lockfile ` +
        `(\`npm dedupe\`, or match the version your component library depends on), or your ` +
        `bundler's dedupe (Vite \`resolve.dedupe: ['boardplot']\`, webpack ` +
        `\`resolve.alias\`).`,
      code: 'geo-pack-duplicate-install',
      pack: id,
      registered: have,
      duplicateInstall: true,
    });
  }

  throw new GeoPackNotRegisteredError({
    message:
      `geo pack '${id}' is not registered. Fix: add \`import 'boardplot/geo/${id}';\` ` +
      `once at your entry point (or \`import 'boardplot/geo';\` for all packs). ` +
      `Registered packs: ${haveText}.`,
    code: 'geo-pack-not-registered',
    pack: id,
    registered: have,
    duplicateInstall: false,
  });
}
