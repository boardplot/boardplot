// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { TableChart } from '../src/react/charts/table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = {
  columns: [{ id: 'name', kind: 'rowLabel' as const, label: 'Name' }, { id: 'v', kind: 'value' as const, label: 'Value' }],
  rows: [{ id: 'Group', label: 'Group', rung: 1, children: [{ id: 'Detail', label: 'Detail', rung: 1000, cells: { v: 12 } }] }],
};

function levels(size?: { width: number }): string[] {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  act(() => root.render(<TableChart data={data} {...(size ? { size } : {})} />));
  const found = [...host.querySelectorAll<HTMLElement>('[role="row"]')].map((row) => row.style.getPropertyValue('--bp-level')).filter(Boolean);
  act(() => root.unmount());
  host.remove();
  return found;
}

// The grid read the raw rung for its padding, so a rung the drawing gave way on still pushed the label out of the frame.
it('indents the grid at the rung the drawing gives way to', () => {
  expect(levels({ width: 960 })).toEqual(['1', '109']);
});

// A grid with no known width has no frame to fit, so it keeps the authored rung.
it('keeps the authored rung where the width is unknown', () => {
  expect(levels()).toEqual(['1', '1000']);
});
