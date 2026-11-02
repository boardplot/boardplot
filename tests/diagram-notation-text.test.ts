import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';

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
