// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { GanttChart } from '../src/react/charts/gantt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = { rows: [
  { id: 'scope', label: 'Scope', cols: ['Ana', 'Not started'], items: [{ id: 'a', kind: 'bar', start: '2026-01-12', end: '2026-02-27' }] },
  { id: 'build', label: 'Build', cols: ['Ben', 'Not started'], items: [{ id: 'b', kind: 'bar', start: '2026-02-16', end: '2026-05-15' }] },
] };
const draw = (options: object, width = 960) => render({ spec: { type: 'gantt', data, options: { title: 'Plan', size: { width }, ...options } }, return: ['svg'] }).body as { ok: boolean; svg: string; warnings: { code: string; message: string }[] };
const codes = (options: object, width?: number) => draw(options, width).warnings.map((warning) => warning.code);

// An id with no column did nothing and said nothing, so a typo looked like a broken option.
it('warns with the id list when an id names no column', () => {
  const { warnings } = draw({ columnOverrides: { meta2: { width: 90 } }, columnOrder: ['label'] });
  const wrong = warnings.filter((warning) => warning.code === 'generated-id-unknown');
  expect(wrong).toHaveLength(2);
  expect(wrong[0]!.message).toContain('name, meta0, meta1, meta2');
  expect(wrong[1]!.message).toContain('meta, plot');
});

// An authored width must never refuse the chart or cut a value.
it('floors and caps authored widths with a warning and keeps every value', () => {
  const narrow = draw({ columnOverrides: { name: { width: 2 }, meta0: { width: 2 } } });
  expect(narrow.ok).toBe(true);
  expect(narrow.svg).toContain('Ana');
  expect(narrow.warnings.map((warning) => warning.code)).toContain('generated-column-width-floor');
  const wide = draw({ columnOverrides: { name: { width: 5000 }, meta0: { width: 5000 } } });
  expect(wide.ok).toBe(true);
  expect(wide.svg).toContain('Ana');
  expect(wide.warnings.map((warning) => warning.code)).toContain('generated-column-width-capped');
});

// The stacked form has no columns: a silent no-op there would read as a broken width.
it('warns on a width and an order the stacked form cannot read, and still prints the label', () => {
  const overrides = { columnOverrides: { meta0: { width: 90, label: 'Lead' } }, columnOrder: ['plot', 'meta'] };
  expect(codes(overrides, 320).filter((code) => code === 'option-ignored')).toHaveLength(2);
  expect(draw(overrides, 320).svg).toContain('Lead');
  expect(codes({ columnOverrides: { meta0: { label: 'Lead' } } }, 320)).not.toContain('option-ignored');
});

// label beats colHeaders per column; a positional merge could shift another column's head.
it('prints an override label in place of its colHeaders entry only', () => {
  const { svg } = draw({ colHeaders: ['Owner'], columnOverrides: { meta0: { label: 'Lead' }, name: { label: 'Workstream' } } });
  expect(svg).toContain('Lead');
  expect(svg).toContain('Workstream');
  expect(svg).not.toContain('Owner');
});

// React takes its own entry to the layout; the on-screen chart must match the exported document.
it('draws the column settings in React as in the CLI', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const options = { title: 'Plan', size: { width: 960 }, columnOverrides: { meta0: { label: 'Lead' } }, columnOrder: ['plot', 'meta'] };
  await act(async () => { root.render(createElement(GanttChart as never, { data, ...options })); });
  await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
  expect(host.querySelector('svg')!.textContent).toContain('Lead');
  await act(async () => { root.unmount(); });
  host.remove();
});
