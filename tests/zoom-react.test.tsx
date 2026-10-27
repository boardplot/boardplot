// @vitest-environment jsdom
/**
 * The zoom prop on a prepared chart: the zoomed view is a new request, so the client lays it out.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { LineChart } from '../src/react/charts/line';
import { prepareChart } from '../src/react/prepare';
import { BoardplotTheme } from '../src/react/BoardplotTheme';

const DAY = 86_400_000;
const x = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * DAY).toISOString().slice(0, 10));
const data = { x, series: [{ id: 'units', label: 'Units', values: x.map(() => 1) }] };
const options = { xAxis: { type: 'time' as const } };

describe('zoom on a prepared chart', () => {
  // The server prepared the whole range; the weekly view must draw, not throw "does not match".
  it('lays out the bucketed view on the client', async () => {
    const prepared = await prepareChart({ type: 'line', data, options: { ...options, size: { width: 700, height: 400 } } });
    const html = renderToStaticMarkup(<LineChart data={data} {...options} size={{ width: 700, height: 400 }} prepared={prepared} zoom={{ aggregate: 'sum' }} />);
    expect(html).toContain('Weekly sums');
  });

  // A reset after a resize matches neither the zoomed view nor the server's size: the client keeps laying out.
  it('does not attach the prepared layout again after a zoom', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const prepared = await prepareChart({ type: 'line', data, options: { ...options, size: { width: 700, height: 400 } } });
    const root = createRoot(document.createElement('div'));
    const draw = (width: number, range?: [string, string]) => act(() => root.render(
      <LineChart data={data} {...options} size={{ width, height: 400 }} deferLayout={false} prepared={prepared} zoom={{ range }} />));
    await draw(700, ['2025-03-01', '2025-06-01']);
    await draw(800, ['2025-03-01', '2025-06-01']);
    await expect(draw(800)).resolves.toBeUndefined();
    act(() => root.unmount());
  });

  // A provider's locale may be a plain tag: the bucket note must follow it.
  it('writes the bucket note in the provider language', () => {
    const html = renderToStaticMarkup(<BoardplotTheme locale="de"><LineChart data={data} {...options} size={{ width: 700, height: 400 }} deferLayout={false} zoom={{ aggregate: 'sum' }} /></BoardplotTheme>);
    expect(html).toContain('Wöchentliche Summen');
  });
});
