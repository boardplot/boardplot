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

// A line chart whose end names do not fit draws the engine's end-name key beside the plot: an authored
// 'left' must keep that key on the left, not move it to the right.
it('keeps an authored left key on the left of a line chart whose end names do not fit', () => {
  const cats = ['2020', '2021', '2022', '2023'].map(id => ({ id, label: id }));
  const names = ['Recurring subscription revenue', 'Professional services revenue', 'Hardware and licence revenue'];
  const lineSpec = (legend: string) => ({
    type: 'line',
    data: { categories: cats, series: names.map((label, i) => ({ id: `s${i}`, label, values: [10 + i, 14 + i, 13 + 2 * i, 18 + i] })) },
    options: { title: 'Subscriptions lead', seriesLabels: 'end', legend, size: { width: 720, height: 420 } },
  });
  const at = (legend: string) => {
    const result = render({ spec: lineSpec(legend), return: ['svg'] }) as unknown as { body: { ok: boolean; warnings: { code: string }[]; svg: string } };
    expect(result.body.ok).toBe(true);
    return { codes: result.body.warnings.map(w => w.code), x: keyX(result.body.svg) };
  };
  const left = at('left');
  expect(left.codes).toContain('line-end-label-key');
  expect(left.x).toBeLessThan(at('right').x);
});
