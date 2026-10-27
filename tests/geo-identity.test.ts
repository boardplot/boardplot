import { requireGeometry } from '../src/core/sizing';
import { describe, expect, test } from 'vitest';

import { fixtures as choroplethFixtures } from '../src/core/charts/choropleth/fixtures';
import { layoutChoropleth } from '../src/core/charts/choropleth/layout';
import { layoutTilemap as rawTilemapLayout } from '../src/core/charts/tilemap/layout';
import { buildGeoRegionIdIndex, resolveGeoRegionId, type GeoIdentifiableRegion } from '../src/core/geo/resolveRegionId';
import { getGeoPack, listGeoPacks } from '../src/core/geo/packs';
import { EU27_TILE_PACK, EUROPE_TILE_PACK, US_STATES_TILE_PACK, WORLD_TILE_PACK } from '../src/core/geo/tiles';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import { geoOverlayLegend } from '../src/core/charts/choropleth/overlays';
import type { GeoOverlay } from '../src/core/charts/choropleth/overlayTypes';
import { render } from '../src/cli/render';
import { runVerb } from '../src/cli/result';
import { callTool } from '../src/mcp/server';

const layoutTilemap = (...args: Parameters<typeof rawTilemapLayout>) => requireGeometry(rawTilemapLayout(...args));

/**
 * geo identity and visibility.
 *
 * 'J' is POSTAL for Jamaica, Jordan AND Japan. Three resolvers with three
 * different tie-breaks meant the same document named a different country on
 * each surface. a value handed to a polygonless micro-state drew an empty
 * path at realistic map load while `noDataCount` reported it as having data.
 */

const theme = resolveTheme(undefined);

// Reordering a pie must not swap category paints while its shared key keeps the first pie's mapping.
test('overlay pies and their key share one paint per label and reject tone conflicts', () => {
  const shares = [{ label: 'Passed', value: 80 }, { label: 'Failed', value: 20 }];
  const overlays: GeoOverlay[] = ['DE', 'FR'].map((region, i) => ({ id: `o${i}`, label: `Overlay ${i}`, at: { region }, glyph: { kind: 'pie', shares: i ? [...shares].reverse() : shares } }));
  const publicResult = () => {
    const spec = { type: 'tilemap', data: { pack: 'eu27', regions: [{ id: 'DE', value: 10 }, { id: 'FR', value: 20 }], overlays }, options: { size: { width: 1000, height: 800 } } };
    const input = { spec, return: ['svg', 'reading'] };
    const cli = runVerb(() => render(input)).body;
    const mcp = callTool('boardplot_render', input).structuredContent;
    expect(mcp.svg).toBe(cli.svg);
    expect(JSON.stringify(mcp.errors)).toBe(JSON.stringify(cli.errors));
    expect(mcp.reading).toEqual(cli.reading);
    return cli;
  };
  const check = () => {
    const g = layoutTilemap({ pack: 'eu27', regions: [{ id: 'DE', value: 10 }, { id: 'FR', value: 20 }], overlays }, { size: { width: 1000, height: 800 } });
    const legend = geoOverlayLegend(overlays).items;
    overlays.forEach((o) => {
      if (o.glyph.kind !== 'pie') return;
      o.glyph.shares.forEach((s, i) => {
        const node = g.scene.find((n) => n.id === `overlay:glyph:${o.id}:${i}`);
        expect(node && 'fill' in node ? node.fill : undefined).toEqual(legend.find((item) => item.label === s.label)?.paint);
      });
    });
  };
  check();
  expect(publicResult().ok).toBe(true);
  for (const o of overlays) if (o.glyph.kind === 'pie') o.glyph.shares = o.glyph.shares.map((s) => ({ ...s, tone: s.label === 'Passed' ? 'good' : 'bad' }));
  check();
  if (overlays[1]!.glyph.kind === 'pie') overlays[1]!.glyph.shares[0]!.tone = 'good';
  expect(() => check()).toThrow(/pie share 'Failed' uses both 'bad' and 'good'/);
  expect(publicResult()).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: 'overlay-share-tone-conflict' })] });
});

/**
 * Every alias that names more than one region, sorted. The bake gate in
 * `scripts/build-geo-packs.mjs` is a separate JS reimplementation of the same
 * rule, so the two are kept honest by asserting the SAME declared ledger.
 */
function ambiguousAliases(regions: readonly GeoIdentifiableRegion[]): { alias: string; claimants: readonly string[] }[] {
  return [...buildGeoRegionIdIndex(regions).ambiguous.entries()]
    .map(([alias, claimants]) => ({ alias, claimants }))
    .sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
}

/**
 * The identity ledger, mirroring DECLARED_AMBIGUOUS_ALIASES in
 * scripts/build-geo-packs.mjs. The bake refuses an undeclared collision; this
 * pins the same statement about the packs that actually shipped, and runs in
 * every `vitest` (the bake needs ~100MB of pinned source archives).
 */
const DECLARED_AMBIGUOUS_ALIASES: Record<string, Record<string, string[]>> = {
  world: { J: ['JM', 'JO', 'JP'] },
};

function ledgerFor(packId: string): { alias: string; claimants: string[] }[] {
  return Object.entries(DECLARED_AMBIGUOUS_ALIASES[packId] ?? {})
    .map(([alias, claimants]) => ({ alias, claimants }))
    .sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
}

function pathsByNodeId(geometry: { scene: readonly unknown[] }): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of geometry.scene as Record<string, unknown>[]) {
    if (typeof node.id === 'string' && typeof node.d === 'string') out.set(node.id, node.d);
  }
  return out;
}

describe('one region-identity resolver', () => {

  test('a canonical region id can never be shadowed by another region alias', () => {
    const index = buildGeoRegionIdIndex([
      { id: 'AA', aliases: [] },
      { id: 'BB', aliases: ['AA'] },
    ]);
    expect(resolveGeoRegionId(index, 'AA')).toEqual({ kind: 'resolved', id: 'AA' });
    expect(index.ambiguous.size).toBe(0);
  });

  test('resolution does not depend on region order', () => {
    const regions = [
      { id: 'JM', aliases: ['J', 'JAM'] },
      { id: 'JO', aliases: ['J', 'JOR'] },
      { id: 'JP', aliases: ['J', 'JPN'] },
    ];
    const forward = buildGeoRegionIdIndex(regions);
    const backward = buildGeoRegionIdIndex([...regions].reverse());
    for (const id of ['J', 'JAM', 'JOR', 'JPN', 'JM', 'JO', 'JP']) {
      expect(resolveGeoRegionId(forward, id)).toEqual(resolveGeoRegionId(backward, id));
    }
  });

  test("every shipped pack's collisions are exactly the declared ledger", () => {
    for (const pack of listGeoPacks()) {
      expect(ambiguousAliases(pack.regions)).toEqual(ledgerFor(pack.id));
      const canonical = new Set(pack.regions.map((region) => region.id));
      const shadowing = pack.regions.flatMap((region) =>
        region.aliases.filter((alias) => canonical.has(alias)),
      );
      expect(shadowing).toEqual([]);
    }
    for (const pack of [EU27_TILE_PACK, EUROPE_TILE_PACK, WORLD_TILE_PACK, US_STATES_TILE_PACK]) {
      expect(ambiguousAliases(pack.regions)).toEqual(ledgerFor(pack.id));
    }
  });

  test("'J' resolves to the same nothing on both surfaces, out loud", () => {
    const one = (id: string) => ({ pack: 'world' as const, regions: [{ id, value: 42 }] });
    const sha = (svg: string) => svg.length + ':' + svg.slice(0, 64);

    const choropleth = layoutChoropleth(one('J'));
    const tilemap = layoutTilemap(one('J'));
    for (const geometry of [choropleth, tilemap]) {
      const ambiguity = geometry.warnings.find((w) => w.code === 'geo-ambiguous-region-id');
      expect(ambiguity?.severity).toBe('warn');
      expect(ambiguity?.message).toContain('JM, JO, JP');
      expect(ambiguity?.suggest).toContain('JM, JO, JP');
    }

    // Neither surface may paint a claimant. Byte comparison, because the whole
    // defect was that the bytes silently equalled a specific country's.
    const svg = (geometry: unknown) => sha(renderSvg(geometry as never, theme));
    for (const claimant of ['JM', 'JO', 'JP']) {
      expect(svg(choropleth)).not.toBe(svg(layoutChoropleth(one(claimant))));
      expect(svg(tilemap)).not.toBe(svg(layoutTilemap(one(claimant))));
    }
  });

  test('unambiguous aliases still resolve, identically on both surfaces', () => {
    const choropleth = layoutChoropleth({ pack: 'world', regions: [{ id: 'JPN', value: 42 }] });
    const tilemap = layoutTilemap({ pack: 'world', regions: [{ id: 'JPN', value: 42 }] });
    expect(choropleth.marks.regions.find((mark) => mark.id === 'JP')?.value).toBe(42);
    expect(tilemap.marks.regions.find((mark) => mark.id === 'JP')?.value).toBe(42);
    expect(choropleth.warnings.some((w) => w.code === 'geo-ambiguous-region-id')).toBe(false);
    expect(tilemap.warnings.some((w) => w.code === 'geo-ambiguous-region-id')).toBe(false);
  });

  test('an unmappable id still claims its regions: the duplicate guard survives', () => {
    // Refusing to MAP a value may not also switch off the duplicate check.
    // Both surfaces previously threw here (each having silently picked a claimant);
    // an ambiguity branch that returns early would accept all of these.
    const world = (regions: { id: string; value: number }[]) => ({ pack: 'world' as const, regions });
    const cases: [string, { id: string; value: number }[]][] = [
      ['the same ambiguous id twice', [{ id: 'J', value: 1 }, { id: 'J', value: 2 }]],
      ['a claimant then the ambiguous id', [{ id: 'JP', value: 1 }, { id: 'J', value: 2 }]],
      ['the ambiguous id then a claimant', [{ id: 'J', value: 1 }, { id: 'JP', value: 2 }]],
      ['the ambiguous id then a different claimant', [{ id: 'J', value: 1 }, { id: 'JM', value: 2 }]],
    ];
    const codeOf = (run: () => unknown): string => {
      try {
        run();
      } catch (error) {
        return (error as { code?: string }).code ?? 'no-code';
      }
      return 'no-error';
    };
    for (const [what, regions] of cases) {
      expect(codeOf(() => layoutChoropleth(world(regions))), `choropleth: ${what}`)
        .toBe('duplicate-id');
      expect(codeOf(() => layoutTilemap(world(regions))), `tilemap: ${what}`)
        .toBe('duplicate-id');
    }
    // …and the guard still discriminates: distinct regions are not duplicates,
    // however many ambiguous spellings the document also carries.
    expect(() =>
      layoutChoropleth(world([{ id: 'JP', value: 1 }, { id: 'JM', value: 2 }, { id: 'JO', value: 3 }])),
    ).not.toThrow();
    expect(() => layoutChoropleth(world([{ id: 'J', value: 1 }]))).not.toThrow();
  });

  test('an ambiguous labelRegions entry fails closed rather than labelling a guess', () => {
    expect(() =>
      layoutChoropleth({ pack: 'world', regions: [{ id: 'JP', value: 1 }] }, {
        labelRegions: ['J'],
      }),
    ).toThrow(/ambiguous/);
  });
});

describe('a value that cannot be drawn', () => {
  // 20 real economies plus the polygonless micro-states. The load matters: with
  // FEW regions the auto label policy makes every micro-state marker-eligible
  // and the defect hides. The first assertion below pins that condition.
  const ECONOMIES = [
    'US', 'CN', 'JP', 'DE', 'GB', 'FR', 'IN', 'IT', 'BR', 'CA',
    'RU', 'KR', 'AU', 'ES', 'MX', 'ID', 'NL', 'SA', 'TR', 'CH',
  ];
  const MICRO = [
    'SG', 'MT', 'MU', 'MV', 'KM', 'NR', 'TV', 'TO', 'WS', 'FO', 'GU', 'KI',
    'MH', 'MP', 'PF', 'PM', 'PN', 'PW', 'SH', 'ST', 'TC', 'GS', 'IO',
  ];

  test('every region carrying a value draws something, at realistic map load', () => {
    const geometry = layoutChoropleth({
      pack: 'world',
      regions: [...ECONOMIES, ...MICRO].map((id) => ({ id, value: 10 })),
    });
    const paths = pathsByNodeId(geometry);
    const pathOf = (id: string) =>
      paths.get(geometry.marks.regions.find((mark) => mark.id === id)?.pathNodeId ?? '') ?? '';

    // The probe proves itself first: two regions that unquestionably have
    // polygons must come back non-empty, or a zero below means nothing
    // (a probe that read a field that does not exist would report 0 for
    // everything, these included, and clear the defect).
    expect(pathOf('US').length).toBeGreaterThan(0);
    expect(pathOf('DE').length).toBeGreaterThan(0);

    // The condition the defect needs: more valued regions than the auto policy
    // labels, so the micro-states are NOT marker-eligible via a label. Without
    // this the test would pass vacuously on the pre-fix engine too.
    const labelled = new Set(
      geometry.labels
        .filter((label) => !label.hidden)
        .map((label) => label.owner.categoryId),
    );
    const unlabelledMicro = MICRO.filter((id) => !labelled.has(id));
    expect(unlabelledMicro.length).toBeGreaterThan(15);

    const invisible = geometry.marks.regions.filter(
      (mark) => mark.state === 'value' && pathOf(mark.id) === '',
    );
    expect(invisible.map((mark) => mark.id)).toEqual([]);

    // …and the diagnostic agrees with what the reader sees.
    // (an unlisted marker-only place leaves no mark, but still counts here)
    expect(geometry.derived.noDataCount).toBe(
      geometry.marks.regions.filter((mark) => mark.value === null).length +
        (getGeoPack('world').regions.length - geometry.marks.regions.length),
    );
    expect(geometry.derived.noDataCount).toBe(
      getGeoPack('world').regions.length - ECONOMIES.length - MICRO.length,
    );
  });

  test('microStateMarkers governs the LISTED-but-empty micro-states, and nothing else', () => {
    // Three populations, three different rules — the option may only move the
    // middle one. Drawing a dot for a region the document never mentions is ink
    // no datum backs; on main `microStateMarkers: true` drew zero of those and
    // it must keep drawing zero.
    const markerOnly = getGeoPack('world').regions
      .filter((region) => region.polygons.length === 0)
      .map((region) => region.id);
    const drawn = (
      regions: { id: string; value: number | null }[],
      options: Parameters<typeof layoutChoropleth>[1],
    ) => {
      const geometry = layoutChoropleth({ pack: 'world', regions }, options);
      const paths = pathsByNodeId(geometry);
      return geometry.marks.regions
        .filter((mark) => markerOnly.includes(mark.id) && (paths.get(mark.pathNodeId) ?? '') !== '')
        .map((mark) => mark.id);
    };
    const economies = ECONOMIES.map((id) => ({ id, value: 10 }));
    const valued = markerOnly.map((id) => ({ id, value: 7 }));
    const listedEmpty = markerOnly.map((id) => ({ id, value: null }));

    // 1. never mentioned: no dot, whatever the option says.
    expect(drawn(economies, { labels: 'none' })).toEqual([]);
    expect(drawn(economies, { labels: 'none', microStateMarkers: true })).toEqual([]);
    // 2. listed with a value: always drawn, option or no option.
    expect(drawn([...economies, ...valued], { labels: 'none' })).toEqual(markerOnly);
    expect(drawn([...economies, ...valued], { labels: 'none', microStateMarkers: true }))
      .toEqual(markerOnly);
    // 3. listed with no value: exactly what the option governs.
    expect(drawn([...economies, ...listedEmpty], { labels: 'none' })).toEqual([]);
    expect(drawn([...economies, ...listedEmpty], { labels: 'none', microStateMarkers: true }))
      .toEqual(markerOnly);
  });

  test('two markers never overlap in INK on the flagship world fixture', () => {
    // The no-overlap guarantee is about paint. The outline is centred on the
    // path, so a 0.65pt stroke pushes each disk 0.325pt past its radius: GU and
    // MP sit 6.446pt apart with radii summing to 6.180pt — geometrically clear,
    // and touching in ink. Measure the painted extent.
    const candidate = choroplethFixtures.find((item) => item.id === 'world-inflation')!;
    const geometry = layoutChoropleth(candidate.data, candidate.options);
    const markerOnly = new Set(
      getGeoPack('world').regions.filter((region) => region.polygons.length === 0).map((r) => r.id),
    );
    const nodesById = new Map(
      (geometry.scene as Record<string, unknown>[])
        .filter((node) => typeof node.id === 'string')
        .map((node) => [node.id as string, node]),
    );
    const disks = geometry.marks.regions.flatMap((mark) => {
      if (!markerOnly.has(mark.id)) return [];
      const node = nodesById.get(mark.pathNodeId) as { d?: string; width?: number } | undefined;
      const parsed = /^M(-?[\d.]+),(-?[\d.]+)A([\d.]+),([\d.]+)/.exec(node?.d ?? '');
      if (!parsed) return [];
      const r = Number(parsed[3]);
      return [{
        id: mark.id,
        cx: Number(parsed[1]) + r,
        cy: Number(parsed[2]),
        // half the stroke is painted outside the path
        painted: r + (node?.width ?? 0) / 2,
      }];
    });

    expect(disks).toHaveLength(markerOnly.size);
    expect(disks.every((disk) => disk.painted > 0)).toBe(true);

    const clashes: string[] = [];
    for (let i = 0; i < disks.length; i += 1) {
      for (let j = i + 1; j < disks.length; j += 1) {
        const a = disks[i]!;
        const b = disks[j]!;
        const gap = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        if (gap < a.painted + b.painted) {
          clashes.push(
            `${a.id}x${b.id} centres ${gap.toFixed(3)}pt < painted ${(a.painted + b.painted).toFixed(3)}pt`,
          );
        }
      }
    }
    expect(clashes).toEqual([]);
    // GU/MP is the tightest pair in the pack; keep it named so a future radius
    // change that eats the clearance says so here and not in a screenshot.
    const gu = disks.find((disk) => disk.id === 'GU')!;
    const mp = disks.find((disk) => disk.id === 'MP')!;
    expect(Math.hypot(gu.cx - mp.cx, gu.cy - mp.cy)).toBeGreaterThan(gu.painted + mp.painted);
  });

  test('tilemap has no ghost class: every tile is drawn', () => {
    const geometry = layoutTilemap({
      pack: 'world',
      regions: [...ECONOMIES, ...MICRO].map((id) => ({ id, value: 10 })),
    });
    // Tiles are rects with a mandatory size, which is why the twin has no ghost
    // class to fix. Assert that, don't assume it.
    expect(geometry.marks.regions).toHaveLength(getGeoPack('world').regions.length);
    const rects = new Map(
      (geometry.scene as Record<string, unknown>[])
        .filter((node) => node.t === 'rect' && typeof node.id === 'string')
        .map((node) => [node.id as string, node.rect as { w: number; h: number }]),
    );
    for (const mark of geometry.marks.regions) {
      const rect = rects.get(mark.nodeId);
      expect(rect?.w).toBeGreaterThan(0);
      expect(rect?.h).toBeGreaterThan(0);
    }
  });
});
