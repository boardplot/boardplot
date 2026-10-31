// @ts-expect-error jsdom is a test dependency without bundled declarations.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import '../src/core/charts';
import { layoutColumn } from '../src/core/charts/column/layout';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';

const theme = resolveTheme();
const { window } = new JSDOM();

function parseFault(svg: string): string | undefined {
  const doc = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
  return doc.getElementsByTagName('parsererror')[0]?.textContent ?? undefined;
}

function column(label: string) {
  return layoutColumn(
    {
      categories: [{ id: 'q1', label }],
      series: [{ id: 's1', label: 'Revenue', values: [42] }],
    } as never,
    {} as never,
  );
}

describe('SVG XML contract', () => {

  it.each([
    ['NUL', '\u0000'],
    ['lone high surrogate', '\ud800'],
    ['lone low surrogate', '\udc00'],
  ])('refuses %s in drawn text', (_name, fault) => {
    expect(() => renderSvg(column(`A${fault}B`) as never, theme)).toThrow(/invalid XML character/);
  });

  it('round-trips legal markup and whitespace characters', () => {
    const label = `A & B < C > D " E ' F\tG\nH\rI`;
    const svg = renderSvg(column(label) as never, theme, { interactive: true });
    expect(parseFault(svg)).toBeUndefined();
    const doc = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('[data-bp-category-label]')?.getAttribute('data-bp-category-label')).toBe(label);
  });

  // A plain-JS caller who left out the theme got a TypeError about `color` that did not name the argument.
  it('names the theme when renderSvg is called without it', () => {
    expect(() => (renderSvg as (geometry: unknown) => string)({ width: 100, height: 100, nodes: [] })).toThrow('theme is required');
  });

  // LibreOffice paints an 8-digit hex fill opaque black, so a sankey flow became a black block.
  it('writes an alpha fill as a plain colour plus fill-opacity', () => {
    const fill = (css: string) => ({ css });
    const geometry = {
      ...column('Q1'),
      scene: [
        { t: 'rect', id: 'r', part: 'mark', rect: { x: 0, y: 0, w: 10, h: 10 }, fill: fill('#12395e59') },
        { t: 'path', id: 'p', part: 'mark', d: 'M0 0L10 10', fill: fill('#12395e80') },
        { t: 'circle', id: 'c', part: 'mark', cx: 5, cy: 5, r: 3, fill: fill('#1238') },
        { t: 'rect', id: 'o', part: 'mark', rect: { x: 0, y: 0, w: 10, h: 10 }, fill: fill('#12395eff') },
      ] as never,
    };
    const svg = renderSvg(geometry as never, theme);
    expect(svg).not.toMatch(/="#[0-9a-f]{8}"|="#1238"/i);
    expect(svg).toContain('fill="#12395e" fill-opacity="0.349"');
    expect(svg).toContain('fill="#12395e" fill-opacity="0.502"');
    expect(svg).toContain('fill="#123" fill-opacity="0.533"');
    expect(svg.match(/fill="#12395e"(?! fill-opacity)/g)).toHaveLength(1);
  });
});
