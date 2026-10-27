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
});
