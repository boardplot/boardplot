import { useLayoutEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { ColumnChart } from '../src/react/charts/column';
import { TableChart } from '../src/react/charts/table';
import { DimSwitchChart } from '../src/react/charts/dimswitch';

vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useLayoutEffect: vi.fn(react.useLayoutEffect) };
});

// Calling a layout effect on the server warns in React 18, including through chart footers and table controls.
it('renders SVG and HTML container charts on the server without layout effects', () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const fixture = getFixtures('table').find(candidate => candidate.id === 'steering-monthly')!;
  const html = renderToStaticMarkup(<>
    <ColumnChart data={data} size="container" fallbackSize="dashboard" source="Example source" />
    <TableChart data={fixture.data} {...fixture.options} size="container" fallbackSize={{ width: 960, height: 540 }} hover />
  </>);
  expect(html).toContain('data-bp-chart="column"');
  expect(html).toContain('data-bp-footer');
  expect(html).toContain('bp-table-grid');
  expect(useLayoutEffect).not.toHaveBeenCalled();
});

// A React column with hover sets the capped-note wording itself, and that key made the column keep its dropped names while the same chart without hover drew bars.
it('draws a narrow column with hover as bars, as it does without hover', () => {
  const names = Array.from({ length: 20 }, (_, i) => `Sector number ${i + 1} of the survey`);
  const data = { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
  const drawn = (hover: boolean) => renderToStaticMarkup(<ColumnChart data={data} title="Margin by sector" unit="%" size={{ width: 320 }} hover={hover} />).match(/data-bp-chart="(\w+)"/)![1];
  expect(drawn(false)).toBe('bar');
  expect(drawn(true)).toBe('bar');
});

// Invalid size and theme props must not crash a server-rendered page.
it('renders refusal diagnostics for invalid sizes and themes on the server', () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const fixture = getFixtures('table').find(candidate => candidate.id === 'steering-monthly')!;
  const theme = renderToStaticMarkup(<ColumnChart data={data} theme="nope" className="host" style={{ margin: 4 }} />);
  expect(theme).toContain('<div class="host" style="margin:4px">');
  expect(theme).toContain('unknown-theme');
  expect(theme).toContain('standard-dark');
  expect(renderToStaticMarkup(<ColumnChart data={data} size={'huge' as never} />)).toContain('invalid-size');
  expect(renderToStaticMarkup(<ColumnChart data={data} size={{ width: '480' } as never} />)).toContain('invalid-size');
  expect(renderToStaticMarkup(<ColumnChart data={data} size="container" fallbackSize={'huge' as never} />)).toContain('invalid-size');
  expect(renderToStaticMarkup(<TableChart data={fixture.data} theme="nope" />)).toContain('unknown-theme');
  expect(renderToStaticMarkup(<TableChart data={fixture.data} size={'huge' as never} />)).toContain('invalid-size');
  const dimswitch = getFixtures('dimswitch').find(candidate => candidate.id === 'by-measure')!;
  expect(renderToStaticMarkup(<DimSwitchChart data={dimswitch.data as never} theme="nope" />)).toContain('unknown-theme');
  expect(renderToStaticMarkup(<DimSwitchChart data={dimswitch.data as never} size={'huge' as never} />)).toContain('invalid-size');
});

// Host props and numeric widths must reach the chart without being refused as options.
it('renders per-type host props, numeric sizes and SVG backgrounds', () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const chart = (props: Partial<Pick<Parameters<typeof ColumnChart>[0], 'size' | 'fallbackSize' | 'background' | 'hover' | 'className' | 'style'>> = {}) => renderToStaticMarkup(<ColumnChart size={600} {...props} data={data} />);
  const normal = chart();
  expect(normal).toMatch(/viewBox="0 0 600 [\d.]+"/);
  expect(normal).toBe(chart({ size: { width: 600 } }));
  expect(normal).toBe(chart({ background: 'theme' }));
  const wrapped = chart({ className: 'host', style: { margin: 4 } });
  expect(wrapped).toBe(`<div class="host" style="margin:4px">${normal}</div>`);
  expect(wrapped).not.toContain('unknown-option');
  const canvas = normal.match(/<rect x="0" y="0" width="600" height="[^"]+" fill="[^"]+"><\/rect>/)?.[0];
  expect(canvas).toBeDefined();
  expect(chart({ background: 'transparent' })).toBe(normal.replace(canvas!, ''));
  const hover = chart({ hover: true });
  const hoverCanvas = hover.match(/<rect x="0" y="0" width="600" height="[^"]+" fill="[^"]+"><\/rect>/)?.[0];
  expect(hoverCanvas).toBeDefined();
  expect(chart({ hover: true, background: 'transparent' })).toBe(hover.replace(hoverCanvas!, ''));
  const invalid = chart({ background: 'white' as never });
  expect(invalid).toContain('invalid-option');
  expect(invalid).toContain('options.background');
  expect(invalid).toContain('Use background theme, or transparent to leave the canvas out.');
  expect(chart({ size: 'container', fallbackSize: 800 })).toBe(chart({ size: 'container', fallbackSize: { width: 800 } }));

  const fixture = getFixtures('table').find(candidate => candidate.id === 'steering-monthly')!;
  const table = renderToStaticMarkup(<TableChart data={fixture.data} {...fixture.options} size={800} className="table-host" />);
  expect(table).toContain('<div class="table-host">');
  expect(table).toContain('bp-table-grid');
  expect(table).not.toContain('unknown-option');
  expect(table).toBe(renderToStaticMarkup(<TableChart data={fixture.data} {...fixture.options} size={{ width: 800 }} className="table-host" />));
  expect(renderToStaticMarkup(<TableChart data={fixture.data} {...({ background: 'transparent' } as object)} />)).toContain('unknown-option');
  const dimswitch = getFixtures('dimswitch').find(candidate => candidate.id === 'by-measure')!;
  const dimswitchMarkup = renderToStaticMarkup(<DimSwitchChart data={dimswitch.data as never} {...dimswitch.options} size={800} className="dim-host" />);
  expect(dimswitchMarkup).toContain('<div class="dim-host">');
  expect(dimswitchMarkup).toContain('bp-table-grid');
  expect(dimswitchMarkup).toBe(renderToStaticMarkup(<DimSwitchChart data={dimswitch.data as never} {...dimswitch.options} size={{ width: 800 }} className="dim-host" />));
});
