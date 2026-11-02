import { expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';

// A key named at 'right' or 'left' was refused on every type. It must draw beside the plot when the
// width holds it, and stay in the row above the plot, with a warning, when the width does not.
const spec = (legend: unknown, width: number) => ({
  type: 'column',
  data: { categories: [{ id: 'a', label: 'FY25' }, { id: 'b', label: 'FY26' }], series: [
    { id: 'one', label: 'Subscriptions', values: [10, 12] }, { id: 'two', label: 'Professional services', values: [7, 8] }] },
  options: { title: 'Subscriptions lead', legend, size: { width, height: 400 } },
});
const drawn = (legend: unknown, width: number) => {
  const result = render({ spec: spec(legend, width), return: ['svg'] }) as unknown as { body: { ok: boolean; warnings: { code: string }[]; svg: string } };
  expect(result.body.ok).toBe(true);
  return result.body;
};
const keyX = (svg: string) => Number(/data-part="legendLabel"[^>]* x="([\d.]+)"/.exec(svg)?.[1]);

it('draws a named side key beside the plot, and keeps the row above the plot on a narrow chart', () => {
  const codes = (legend: unknown, width: number) => drawn(legend, width).warnings.map(w => w.code);
  expect(codes('right', 900)).toContain('legend-beside-plot');
  expect(codes({ position: 'left' }, 900)).toContain('legend-beside-plot');
  expect(codes('right', 360)).toContain('legend-side-fallback');
  expect(keyX(drawn('left', 900).svg)).toBeLessThan(keyX(drawn('right', 900).svg));
});
