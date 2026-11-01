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
