import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { choroplethOptionsSchema } from '../src/core/charts/choropleth/schema';

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

describe('choropleth lookup keys', () => {
  const regions = [{ id: 'DE-BY', value: 80 }, { id: 'DE-NW', value: 70 }, { id: 'DE-BE', value: 60 }, { id: 'DE-HH', value: 50 }, { id: 'DE-HB', value: 40 }, { id: 'DE-SL', value: 30 }, { id: 'DE-TH', value: 20 }, { id: 'DE-ST', value: 10 }];
  const draw = (options: object) => requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'choropleth', data: { pack: 'de-states', regions }, options: { title: 'States', valueTable: 'side', size: { width: 960, height: 540 }, ...options } })));
  const rows = (geometry: ReturnType<typeof draw>) => geometry.labels.filter((label) => label.id.startsWith('value-table-code:')).sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y).map((label) => label.text);
  // A hidden row must keep the top group ranked on all regions, and warn once that its map code has no name.
  it('keeps the map whole and warns once', () => {
    const all = draw({});
    const hidden = draw({ rowVisibility: { 'DE-BY': false } });
    expect(rows(hidden)).toEqual(rows(all).slice(1));
    expect((hidden.marks as { regions: { id: string; value: number | null }[] }).regions.find((region) => region.id === 'DE-BY')?.value).toBe(80);
    expect(hidden.warnings.filter((warning) => warning.code === 'choropleth-lookup-partial')).toHaveLength(1);
  });
  // A warning must say what happened: an unknown id hides nothing, and a rename reaches the map with no table.
  it('tells an unknown hidden id and a rename without a table the truth', () => {
    expect(draw({ rowVisibility: { nope: false } }).warnings.map((warning) => warning.code)).not.toContain('choropleth-lookup-partial');
    const renamed = draw({ valueTable: false, rowOverrides: { 'DE-BE': { label: 'Capital' } } });
    expect(renamed.warnings.map((warning) => warning.code)).not.toContain('generated-id-unknown');
    expect((renamed.marks as { regions: { id: string; name: string }[] }).regions.find((region) => region.id === 'DE-BE')?.name).toBe('Capital');
  });
  // Swatch and code print no head, so these fields would be accepted and do nothing.
  it.each([['code', 'label'], ['code', 'headAlign'], ['swatch', 'label'], ['swatch', 'headAlign']])('refuses %s.%s', (id, field) => {
    const parsed = choroplethOptionsSchema.safeParse({ columnOverrides: { [id]: { [field]: field === 'label' ? 'Name' : 'left' } } });
    expect(parsed.success).toBe(false);
  });
  // The lookup and the map must print one name for a renamed region.
  it('renames a region in the lookup and on the map', () => {
    const geometry = draw({ rowOverrides: { 'DE-BE': { label: 'Capital' } }, labels: 'all' });
    const texts = geometry.labels.filter((label) => !label.hidden && label.owner.categoryId === 'DE-BE').map((label) => label.text);
    expect(texts.filter((text) => text.includes('Capital')).length).toBeGreaterThanOrEqual(2);
    expect(texts.filter((text) => text === 'BE')).toEqual([]);
  });
  it('moves a named row to the top and warns on an unknown id', () => {
    const geometry = draw({ rowOrder: ['DE-ST', 'nope'] });
    expect(rows(geometry)[0]).toBe(rows(draw({})).at(-1));
    expect(rows(geometry)).toHaveLength(8);
    expect(geometry.warnings.map((warning) => warning.code)).toContain('generated-id-unknown');
  });
  it('drops the unit caption with the value column', () => {
    const geometry = draw({ unit: '$bn', columnVisibility: { value: false } });
    expect(geometry.labels.filter((label) => label.id.startsWith('value-table-value:') || label.id.startsWith('value-table-unit:'))).toEqual([]);
    expect(geometry.warnings.filter((warning) => warning.code === 'choropleth-lookup-partial')).toHaveLength(1);
  });
});
