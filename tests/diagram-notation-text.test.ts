import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';

const notation = (id: string): string => {
  const { data, options } = getFixtures('diagram').find((entry) => entry.id === id)!;
  return (render({ spec: { type: 'diagram', data, options: { ...options, theme: 'notation' } } as any, format: 'svg', return: ['svg'] } as any).body as any).svg;
};
const texts = (svg: string, part: string): string[] =>
  [...svg.matchAll(new RegExp(`<text[^>]*data-part="${part}"[^>]*>(.*?)</text>`, 'g'))].map((match) => match[1]!.replace(/<[^>]+>/g, ''));

describe('diagram text under the notation unit', () => {
  // Notation's 4 px unit left no room for callout digits and group titles: the discs drew blank and the frames drew a gap with no title.
  it('draws callout digits and group titles', () => {
    expect(texts(notation('nested-service'), 'diagramBadge')).toEqual(['1', '2']);
    expect(texts(notation('journey-attribution'), 'diagramGroup')).toContain('Personal data');
    expect(texts(notation('portfolio-health-sampler'), 'diagramGroup')).toContain('On track');
  });
});

describe('diagram inset heading and columns', () => {
  const fixture = getFixtures('diagram').find((entry) => entry.id === 'inset-no-heading')!;
  const body = (inset: object) => render({ spec: { type: 'diagram', data: { ...(fixture.data as object), inset: { title: 'Service levels', rows: [{ label: 'Failed loads', value: '3' }], ...inset } }, options: fixture.options } as never, format: 'svg' } as never).body as any;
  // The title must leave the drawing and stay the accessible name.
  it('draws no title and keeps it as the accessible name', () => {
    const { svg } = body({ heading: false });
    expect(svg.replace(/<(title|desc)[^>]*>.*?<\/\1>/gs, '')).not.toContain('Service levels');
    expect(svg).toContain('Service levels');
  });
  // Right-aligned names must share one edge, also where the values differ in width.
  it('aligns the inset names to one edge', () => {
    const inset = { title: 'Service levels', rows: [{ label: 'Failed loads', value: '3' }, { label: 'Tables', value: '41 of 44' }], columnOverrides: { label: { align: 'right' } } };
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'diagram', data: { ...(fixture.data as object), inset }, options: { ...fixture.options, size: { width: 960 } } } as never)) as any;
    const rects = geometry.labels.filter((label: any) => /inset-label:row:\d+:label/.test(label.id)).map((label: any) => label.rect);
    expect(rects).toHaveLength(2);
    expect(Math.abs(rects[0].x + rects[0].w - rects[1].x - rects[1].w)).toBeLessThanOrEqual(1);
  });
  // The helper's warning says options; the inset lives in data, so a fix must point there.
  it('warns on a wrong column under data.inset', () => {
    const warning = body({ columnOverrides: { nope: { width: 90 } } }).warnings.find((item: any) => item.code === 'generated-id-unknown');
    expect(warning.path).toBe('/data/inset/columnOverrides/nope');
  });
});
