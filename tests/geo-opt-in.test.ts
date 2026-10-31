/**
 * Geo package entries must retain registration side effects and public exports.
 * Keep this file free of eager barrel imports so registry failures stay testable.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('package entry side effects', () => {
  it('package.json marks every geo registration module side-effectful', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    for (const id of ['dach', 'de-states', 'eu27', 'us-states', 'world']) {
      expect(pkg.sideEffects, id).toContain(`**/geo/packs/${id}.ts`);
      // The dist twin: the SOURCE glob is what a consumer bundling from
      // src sees, the DIST path is what an installed consumer sees, and a fix
      // to one of them is half a fix.
      expect(pkg.sideEffects, id).toContain(`dist/geo/${id}.js`);
      expect(pkg.exports[`./geo/${id}`], id).toBeDefined();
    }
    // The SOURCE all-packs barrel must NOT be marked: src/core/geo/index.ts
    // does `export * from './packs'`, so marking it would drag all five baked
    // packs into every consumer of the geo barrel — including tilemap's.
    expect(pkg.sideEffects).not.toContain('**/geo/packs/index.ts');
    // The DIST all-packs entry is a different artifact with a different job:
    // `dist/geo/index.js` IS the published `boardplot/geo` subpath, whose
    // entire purpose is to register all five, and nothing reaches it except an
    // explicit import of that subpath. The previous `dist/geo/*.js` glob
    // covered it by accident while the comment above claimed the opposite;
    // both halves are now stated on purpose.
    expect(pkg.sideEffects).toContain('dist/geo/index.js');
    expect(pkg.sideEffects).not.toContain('dist/geo/*.js');
    // No shared chunk is side-effectful: the glob kept the whole catalogue in
    // every host bundle that imported one helper from the root. Charts register
    // through a call (src/react/chartEntry.ts, src/index.ts) and a pack
    // registers in its own entry file, which nothing else imports.
    expect(pkg.sideEffects).not.toContain('dist/chunk-*.js');
  });
});

/**
 * The duplicate-install diagnostic lives on a process-global symbol so that two
 * COPIES of boardplot can see each other. vi.resetModules() gives a fresh
 * module instance but keeps globalThis, which is precisely what makes the
 * duplicate case reproducible here — and precisely why a test that wants the
 * single-copy message has to start from a clean ledger.
 */
const LEDGER_KEY = Symbol.for('boardplot.geo-pack-registry.diagnostics.v1');
function freshGeoRegistryProcess(): void {
  delete (globalThis as Record<symbol, unknown>)[LEDGER_KEY];
  vi.resetModules();
}

describe('geo pack registry', () => {
  it('registering one pack leaves the others missing — no substitution', async () => {
    vi.resetModules();
    await import('../src/core/geo/packs/dach');
    const { getGeoPack, registeredGeoPackIds } = await import('../src/core/geo/packs/registry');
    expect(registeredGeoPackIds()).toEqual(['dach']);
    expect(getGeoPack('dach').id).toBe('dach');
    expect(() => getGeoPack('world')).toThrow(/Registered packs: dach\./);
  });

  it('the charts barrel registers every type and no pack', async () => {
    freshGeoRegistryProcess();
    await import('../src/core/charts');
    const { listGeoPacks } = await import('../src/core/geo/packs/registry');
    const { listCharts } = await import('../src/core/registry');
    expect(listGeoPacks()).toEqual([]);
    expect(listCharts().length).toBeGreaterThanOrEqual(26);
  });

  it('the throw carries a code and a pack, not just prose', async () => {
    freshGeoRegistryProcess();
    const { getGeoPack, GeoPackNotRegisteredError } = await import('../src/core/geo/packs/registry');
    // src/cli/main.ts falls back to code 'layout-error' for anything a layout
    // throws, so without a code of its own this failure is indistinguishable
    // from any other layout fault in the CLI/MCP envelope.
    let thrown: (Error & { code?: string; pack?: string; duplicateInstall?: boolean }) | undefined;
    try {
      getGeoPack('world');
    } catch (error) {
      thrown = error as typeof thrown;
    }
    expect(thrown).toBeInstanceOf(GeoPackNotRegisteredError);
    expect(thrown!.code).toBe('geo-pack-not-registered');
    expect(thrown!.pack).toBe('world');
    expect(thrown!.duplicateInstall).toBe(false);

    let unknown: (Error & { code?: string; pack?: string }) | undefined;
    try {
      getGeoPack('atlantis' as never);
    } catch (error) {
      unknown = error as typeof unknown;
    }
    expect(unknown!.code).toBe('unknown-geo-pack');
    expect(unknown!.pack).toBe('atlantis');
  });

  it('a pack registered into ANOTHER copy of the package is named as such', async () => {
    // Ordinary npm duplication — an app plus a component library that also
    // depends on boardplot — splits this module-level Map in two. The
    // consumer adds `import 'boardplot/geo/world'`, it registers into copy
    // B, the choropleth resolves copy A, and the old message told them to add
    // the import they had already added, forever, with no way to tell "you
    // forgot it" from "it landed elsewhere". Two module instances sharing one
    // process is exactly what vi.resetModules() reproduces.
    freshGeoRegistryProcess();
    await import('../src/core/geo/packs/dach'); // copy A registers 'dach'
    vi.resetModules();
    const { getGeoPack, geoRegistryInstanceCount, registeredGeoPackIds } = await import(
      '../src/core/geo/packs/registry'
    ); // copy B: its own empty Map
    expect(registeredGeoPackIds(), 'copy B must not see copy A registrations').toEqual([]);
    expect(geoRegistryInstanceCount()).toBeGreaterThan(1);

    let thrown: (Error & { code?: string; pack?: string; duplicateInstall?: boolean }) | undefined;
    try {
      getGeoPack('dach');
    } catch (error) {
      thrown = error as typeof thrown;
    }
    expect(thrown!.code).toBe('geo-pack-duplicate-install');
    expect(thrown!.duplicateInstall).toBe(true);
    expect(thrown!.message).toContain('into a different copy of boardplot');
    expect(thrown!.message).toContain('will not help');
    expect(thrown!.message).toMatch(/de-duplicate/);
    // a Next.js server/client layer split looks the same and de-duplicating does not cure it
    expect(thrown!.message).toContain("same 'use client' module as the chart");
    // and it must NOT repeat the advice the consumer already followed
    expect(thrown!.message).not.toMatch(/Fix: add `import 'boardplot\/geo\/dach';`/);
  });

  it('the all-packs barrel keeps its full surface', async () => {
    vi.resetModules();
    const packs = await import('../src/core/geo/packs');
    expect(packs.listGeoPacks().map((pack) => pack.id)).toEqual([
      'de-states',
      'eu27',
      'dach',
      'europe',
      'world',
      'us-states',
    ]);
    expect(packs.getGeoPack('world')).toBe(packs.WORLD_PACK);
    expect(packs.getGeoPack('us-states')).toBe(packs.US_STATES_PACK);
    expect(packs.getGeoPack('dach')).toBe(packs.DACH_PACK);
    expect(packs.getGeoPack('eu27')).toBe(packs.EU27_PACK);
    expect(packs.getGeoPack('de-states')).toBe(packs.DE_STATES_PACK);
  });
});
