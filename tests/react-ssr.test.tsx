import { useLayoutEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { ColumnChart } from '../src/react/charts/column';
import { TableChart } from '../src/react/charts/table';

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
