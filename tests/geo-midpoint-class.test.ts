/**
 * A region on the diverging midpoint must not take a side: CZ at 0 % of plan
 * painted green under '0% to under +5%' reads as better than plan.
 */
import { describe, expect, it } from 'vitest';
import { buildGeoScale } from '../src/core/charts/geoScale';
import { resolveTheme } from '../src/core/theme';

const values = [-12, -9, -6, -3, 0, 3, 6, 9, 12, -12, -9, -6, -3, 0, 3, 6, 9, 12];
const scale = (classes: 4 | 5) => buildGeoScale(values, {
  scale: { kind: 'diverging', midpoint: 0 }, classes, format: '+1%',
}, (value) => `${value}%`, false, resolveTheme(), { token: 'neutral' });

describe('diverging classes and the midpoint', () => {
  it('an odd class count mirrors its breaks, so the centre class holds the midpoint in grey', () => {
    const odd = scale(5);
    expect(odd.edges).toEqual([-12, -10, -5, 5, 10, 12]);
    expect(odd.paint(0)).toEqual(odd.legend.find((item) => item.id === 'class-3')!.paint);
    expect(odd.paint(0)).not.toEqual(odd.paint(6));
  });

  it('an even class count paints a value on the midpoint break grey and keys it', () => {
    const even = scale(4);
    expect(even.edges).toContain(0);
    const entry = even.legend.find((item) => item.id === 'midpoint')!;
    expect(entry.label).toBe('0%');
    expect(even.paint(0)).toEqual(entry.paint);
    expect(even.paint(3)).not.toEqual(entry.paint);
    expect(even.legend.map((item) => item.label)).toContain('Over 0% to under 5%');
  });

  it('mirrored breaks near a large midpoint keep every class a width', () => {
    const big = Array.from({ length: 11 }, (_, i) => 1e15 - 10 + 2 * i);
    const edges = buildGeoScale(big, { scale: { kind: 'diverging', midpoint: 1e15 }, classes: 5, format: '1' },
      String, false, resolveTheme(), { token: 'neutral' }).edges!;
    expect(edges.every((edge, i) => i === 0 || edge > edges[i - 1]!)).toBe(true);
  });
});

// Regions the data never names drew the darkest outline on the page and carried automatic codes, and
// a dark theme's land could match the lowest class: the land must stay quiet, unlabelled and apart.
describe('regions the data never names', () => {
  it('draw as quiet land like their key swatch, without codes, apart from the lowest class in a dark theme', async () => {
    await import('../src/core/charts');
    await import('../src/core/geo/packs');
    const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
    const { paintColor } = await import('../src/core/theme');
    const { palettePerceptualDistance } = await import('../src/core/themeRules');
    const regions = [['DE', 10], ['FR', 20], ['AT', 30], ['IT', 40], ['ES', 50]].map(([id, value]) => ({ id, value }));
    const layout = (theme: string) => layoutResolvedRequest(resolveChartRequest({
      type: 'choropleth', data: { pack: 'eu27', regions }, options: { title: 'Sales by market', classes: 5 }, theme,
    } as never)) as unknown as { scene: { id: string; fill?: unknown; stroke?: unknown }[]; labels: { owner: { categoryId?: string }; hidden?: boolean }[] };
    const light = layout('standard');
    const land = light.scene.find((node) => node.id === 'region:PT')!;
    const swatch = light.scene.find((node) => node.id === 'legend-swatch:not-in-data')!;
    expect(land.fill).toEqual(swatch.fill);
    expect(swatch.stroke).toBeUndefined();
    expect(land.stroke).toEqual({ token: 'background' });
    expect(light.labels.filter((label) => !label.hidden).map((label) => label.owner.categoryId).filter((id) => id === 'PT' || id === 'PL')).toEqual([]);
    const dark = resolveTheme('notation-dark');
    const lowest = light.scene.find((node) => node.id === 'region:DE')!;
    expect(palettePerceptualDistance(paintColor(dark, land.fill as never), paintColor(dark, lowest.fill as never))).toBeGreaterThanOrEqual(6);
  });

  // An EU map of five countries must not claim "top 27 by value": only the world pack ranks its labels.
  it('leave the method note without a ranking claim on a pack that labels what the data lists', async () => {
    await import('../src/core/charts');
    await import('../src/core/geo/packs');
    const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
    const regions = [['DE', 10], ['FR', 20], ['AT', 30], ['IT', 40], ['ES', 50]].map(([id, value]) => ({ id, value }));
    const layout = layoutResolvedRequest(resolveChartRequest({
      type: 'choropleth', data: { pack: 'eu27', regions }, options: { title: 'Sales by market', methodNote: true },
    } as never));
    expect(JSON.stringify(layout)).not.toContain('by value');
  });
});
