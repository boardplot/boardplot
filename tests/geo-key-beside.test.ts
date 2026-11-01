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
