import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { defaultMeasurer } from '../src/core/text';
import { clippedTextWarnings } from '../src/core/textClip';
import type { Geometry } from '../src/core/types/scene';
// @ts-expect-error The census script is plain JavaScript.
import { censusCase } from '../scripts/number-census.mjs';

const svgOf = (spec: unknown): string => (render({ spec, format: 'svg', return: ['svg'] }).body as { svg: string }).svg;
const descOf = (svg: string) => /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(svg)?.[1] ?? '';

describe('the description states the drawn numbers', () => {
  // The description reformatted the raw value and said "0%, 1%" where the labels read "6%, 54%".
  for (const type of ['bar', 'column', 'dot']) {
    it(`${type}: one series reads its labels, not the raw values`, () => {
      const svg = svgOf({ type, data: {
        categories: [{ id: 'a', label: 'North' }, { id: 'b', label: 'South' }],
        series: [{ id: 's', label: 'Churn rate', values: [{ number: 0.06, label: '6%' }, { number: 0.54, label: '54%' }] }],
      }, options: { title: 'Churn by region' } });
      expect(descOf(svg)).toMatch(/North 6%[,;] South 54%/);
    });
  }
});

describe('drawn text stays on the canvas', () => {
  // A bold extreme label was seated at its regular width and ran 5 px past the right edge.
  it('column: the bold extreme label fits at its drawn width', () => {
    const fixture = getFixtures('column').find((f) => f.id === 'anomaly-torture')!;
    const data = structuredClone(fixture.data) as { series: { values: unknown[] }[] };
    for (const s of data.series) s.values = s.values.map((v) => (typeof v === 'number' ? v * 1234.567 : v));
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options: { ...fixture.options, size: { width: 360 } }, annotations: fixture.annotations } as never)) as Geometry;
    const label = geometry.scene.find((n) => n.t === 'text' && n.id.includes('extreme'));
    expect(label?.t).toBe('text');
    if (label?.t !== 'text') return;
    expect(label.x + defaultMeasurer(label.lines[0]!, label.font).width).toBeLessThanOrEqual(geometry.size.width);
    expect(geometry.warnings.map((w) => w.code)).not.toContain('text-clipped');
  });

  // A text past the edge was cut off with no warning at all.
  it('a text past the edge warns text-clipped', () => {
    const font = { family: 'Helvetica', size: 12 };
    const geometry = { size: { width: 200, height: 100 }, scene: [{ t: 'text', id: 'label:end', x: 150, y: 40, lines: ['Northern region'], font, align: 'start' }] } as unknown as Geometry;
    const [warning] = clippedTextWarnings(geometry, defaultMeasurer);
    expect(warning?.code).toBe('text-clipped');
    expect(warning?.message).toContain("'Northern region' (label:end");
  });
});

describe('currency signs print where the locale puts them', () => {
  // Mekko joined "$" after the figure as if it were a word unit: "10,000 $" in English.
  const mekko = (language: string) => svgOf({ type: 'mekko', data: {
    categories: [{ id: 'a', label: 'North' }],
    series: [{ id: 'web', label: 'Web', unit: '$', values: [6000] }, { id: 'store', label: 'Store', unit: '$', values: [4000] }],
  }, options: { title: 'Revenue', variant: 'stacked100', locale: { language } } });
  it('English puts $ before the figure, German after it', () => {
    expect(mekko('en')).toContain('$10,000');
    expect(mekko('de')).toMatch(/>10,000\s\$</);
  });
});

describe('text read back from the SVG matches the drawn text', () => {
  const textOf = (svg: string, id: string) => {
    const node = new RegExp(`<text data-id="${id}"[^>]*>([\\s\\S]*?)</text>`).exec(svg)?.[1] ?? '';
    return node.replace(/<[^>]*>/g, '');
  };
  // A wrapped title read back from the SVG joined its two lines as "reopenedat".
  it('a wrapped line break keeps a space and does not move the lines', () => {
    const svg = svgOf({ type: 'column', data: { categories: ['A', 'B'], series: [{ id: 's', label: 'Sales', values: [4, 5] }] },
      options: { title: 'Total orders rose every single week after the store reopened at 15:00 UTC in late October, website first and then the app', size: { width: 760 } } });
    expect(textOf(svg, 'frame:title:0')).toContain('reopened at 15:00');
    expect(svg).toMatch(/<tspan x="24" dy="0"> <\/tspan><tspan x="24" dy="25">at 15:00/);
  });

  // A cut label kept its full text in a <title> inside <text>, so read-back text ran the full and the cut text together.
  it('the hover title of a cut label sits on its group, not inside the text', () => {
    const fixture = getFixtures('dot').find((f) => f.id === 'long-labels-lollipop')!;
    const svg = svgOf({ type: 'dot', data: fixture.data, options: fixture.options, annotations: fixture.annotations });
    expect(svg).not.toMatch(/<text\b[^>]*><title>/);
    expect(svg).toMatch(/<g role="img" aria-label="[^"]+"><title>[^<]+<\/title>(<rect[^>]*\/>)?<text\b/);
  });
});

describe('number census', () => {
  // The census scaled "$k" box statistics by 1,000 twice and flagged correct medians as wrong-scale.
  it('reads $k box statistics once', () => {
    const fixture = structuredClone(getFixtures('box').find((f) => f.id === 'salary-bands-p10p90')!) as { options: { unit: string } };
    fixture.options.unit = '$k';
    const { findings } = censusCase('box', fixture, 720, 'en') as { findings: { class: string }[] };
    expect(findings.filter((f) => f.class === 'wrong-scale')).toEqual([]);
  });
});
