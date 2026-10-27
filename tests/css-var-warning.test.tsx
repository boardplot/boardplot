// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { ColumnChart } from '../src/react/charts/column';
import { TableChart } from '../src/react/charts/table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A developer who writes var(--brand, …) expects the chart to follow the page; it paints the fallback, so it must say so.
it('warns once per page variable that the chart paints its fallback, in the CLI and in React', () => {
  const brand = 'var(--brand, #1f4e79)';
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', fill: brand, values: [4] }, { id: 't', fill: brand, values: [3] }] };
  const overrides = { color: { ink: 'var(--ink, #111111)' } };
  const named = (warnings: { code: string; message: string; suggest?: string }[]) =>
    warnings.filter(warning => warning.code === 'css-var-fallback-used').map(warning => warning.message);

  const body = render({ spec: { type: 'column', data, options: { title: 'Brand', theme: { preset: 'standard', overrides } } } }).body as {
    warnings: { code: string; message: string; suggest?: string; path?: string }[];
  };
  expect(named(body.warnings)).toEqual([
    'Boardplot does not read var(--ink); it paints the fallback #111111.',
    'Boardplot does not read var(--brand); it paints the fallback #1f4e79 in 2 fields.',
  ]);
  expect(body.warnings.find(warning => warning.code === 'css-var-fallback-used')).toMatchObject({
    path: '/options/theme/overrides/color/ink', suggest: expect.stringContaining("getComputedStyle(element).getPropertyValue('--ink')"),
  });
  const plain = render({ spec: { type: 'column', data: { ...data, series: [{ id: 's', fill: '#1f4e79', values: [4] }] }, options: { title: 'Brand' } } }).body;
  expect(named(plain.warnings as never)).toEqual([]);

  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const chart = vi.fn(), table = vi.fn();
  const fixture = getFixtures('table')[0]!;
  act(() => root.render(<BoardplotTheme theme={{ preset: 'standard', overrides }}>
    <ColumnChart data={data} size={{ width: 480, height: 270 }} onWarnings={chart} />
    <TableChart data={fixture.data} {...fixture.options} size={{ width: 720 }} onWarnings={table} />
  </BoardplotTheme>));
  expect(named(chart.mock.calls.at(-1)![0])).toEqual(named(body.warnings));
  expect(named(table.mock.calls.at(-1)![0])).toEqual(['Boardplot does not read var(--ink); it paints the fallback #111111.']);
  act(() => root.unmount());
  host.remove();
});
