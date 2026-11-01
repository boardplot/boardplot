import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';

// On a wide slot a map or tile grid bound by the canvas height must not spend a key row of that
// height: an unnamed key stands beside it, and legend 'top' brings the row back.
describe('map key beside the map on a wide slot', () => {
  for (const [type, id] of [['choropleth', 'us-margin-wide-slot'], ['tilemap', 'us-state-tile-grid-wide-slot']] as const) {
    it(`${type}: the unnamed key stands right of the map, legend 'top' keeps the row`, () => {
      const fixture = getFixtures(type).find((item) => item.id === id)!;
      const keyX = (legend?: 'top') => {
        const request = { type, data: fixture.data, options: { ...fixture.options, ...(legend ? { legend } : {}) } };
        const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest(request as never)));
        return { x: geo.legend!.rect.x / geo.size.width };
      };
      const beside = keyX();
      const row = keyX('top');
      expect(beside.x).toBeGreaterThan(0.5);
      expect(row.x).toBeLessThan(0.5);
    });
  }
});

// A key column the layout chose beside the tiles must not refuse a canvas that draws with the key row:
// the larger tiles kept overlay glyphs that hide the codes, and the short canvas then had no smaller lattice.
describe('tile map key column on a short canvas with overlays', () => {
  it('draws with the key row where the column would leave the codes hidden', () => {
    const codes = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');
    const tones = ['good', 'bad', 'warn', 'neutral', 'info'] as const;
    const request = {
      type: 'tilemap',
      data: {
        pack: 'eu27',
        regions: codes.map((id, i) => (i % 9 === 0 ? { id, value: null, state: 'suppressed' } : i % 11 === 0 ? { id, value: null } : { id, value: i * 0.7 })),
        overlays: tones.map((tone, i) => ({ id: `o${i}`, at: { region: codes[i] }, glyph: { kind: 'status', status: tone === 'info' ? 'warn' : tone }, label: `Overlay ${tone}` })),
      },
      options: { title: 'Value by region', subtitle: { measure: 'Value by region', period: 'FY26' }, unit: '%', source: 'Invented data', classes: 7, scale: { kind: 'sequential' }, size: { width: 600, height: 328 }, overlayTones: { good: 'Ahead', bad: 'Behind', warn: 'At risk', neutral: 'Not started', info: 'Other' } },
    };
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest(request as never)));
    expect(geo.legend!.rect.x / geo.size.width).toBeLessThan(0.5);
  });
});
