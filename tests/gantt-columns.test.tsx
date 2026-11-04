// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';
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
  expect(narrow.warnings.map((warning) => warning.code)).toContain('generated-column-width-floored');
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

// A value past the 90 px cell cap chose the stacked form at every width, so its width and order did nothing.
it('draws the table form for a long value with an authored width or order wherever it fits', () => {
  const long = { rows: data.rows.map((row) => ({ ...row, cols: ['A rather long owner name here'] })) };
  const form = (options: object, width: number) => { const body = render({ spec: { type: 'gantt', data: long, options: { title: 'Plan', size: { width }, ...options } } }).body as { ok: boolean; warnings: { code: string }[] }; expect(body.ok).toBe(true); return body.warnings.map((warning) => warning.code); };
  for (const keys of [{ columnOverrides: { meta0: { width: 260 } } }, { columnOrder: ['plot', 'meta'] }]) {
    expect(form(keys, 960)).not.toContain('option-ignored');
    expect(form(keys, 320)).toContain('option-ignored');
  }
});

const longData = { rows: [
  { id: 'scope', label: 'Scope', cols: ['A rather long owner name here', 'Done'], items: [{ id: 'a', kind: 'bar', start: '2026-01-12', end: '2026-02-27' }] },
  { id: 'build', label: 'Build', cols: ['Another quite long owner name', 'On track'], items: [{ id: 'b', kind: 'bar', start: '2026-02-16', end: '2026-05-15' }] },
] };
const fixture = (id: string) => getFixtures('gantt').find((candidate) => candidate.id === id)!;
const drawSpec = (specData: unknown, options: object) => render({ spec: { type: 'gantt', data: specData, options }, return: ['svg'] }).body as { ok: boolean; svg: string; warnings: { code: string; message: string }[] };

// A name width chose the table form, where the 90 px cap cut the Owner column out of the chart.
it('keeps every metadata column under a name-only setting', () => {
  for (const name of [{ width: 150 }, { align: 'right' }, { headAlign: 'right' }]) for (const width of [960, 720, 560]) {
    const { svg, warnings } = drawSpec(longData, { title: 'Plan', colHeaders: ['Owner', 'Status'], columnOverrides: { name }, size: { width } });
    expect(svg).toContain('>A rather long owner name here');
    expect(warnings.map((warning) => warning.code)).not.toContain('values-in-note');
  }
});

// A name alignment chose a table with an 80 px timeline, which sent bar labels to the note.
it('keeps the stacked form where the table form would hide a label', () => {
  const { data: specData, options } = fixture('transformation-program');
  const plain = drawSpec(specData, { ...options, size: { width: 480 } });
  const aligned = drawSpec(specData, { ...options, columnOverrides: { name: { align: 'right' } }, size: { width: 480 } });
  const strip = (svg: string) => svg.replace(/bp-[a-z]+-[0-9a-f]{10}/g, 'id');
  expect(strip(aligned.svg)).toBe(strip(plain.svg));
  expect(aligned.warnings.map((warning) => warning.code)).toContain('option-ignored');
});

// A wide name width took the timeline that held the bar labels on a chart that draws the table anyway.
it('caps a wide name width at the widest one that hides no label', () => {
  const { data: specData, options } = fixture('workstream-status-plan');
  const plain = drawSpec(specData, { ...options, size: { width: 960 } });
  const wide = drawSpec(specData, { ...options, columnOverrides: { name: { width: 5000 } }, size: { width: 960 } });
  expect(wide.warnings.map((warning) => warning.code)).toContain('generated-column-width-capped');
  expect(wide.warnings.filter((warning) => warning.code === 'label-hidden').length).toBeLessThanOrEqual(plain.warnings.filter((warning) => warning.code === 'label-hidden').length);
});

// A narrow name width wrapped the names until the rows missed a height the chart without it fits.
it('gives way to the narrowest fitting name width on a fixed height, and keeps wrapped names in open height', () => {
  const { data: specData, options } = fixture('status-gantt');
  const narrow = drawSpec(specData, { ...options, columnOverrides: { name: { width: 90 } }, size: { width: 960, height: 500 } });
  expect(narrow.ok).toBe(true);
  const floored = narrow.warnings.find((warning) => warning.code === 'generated-column-width-floored');
  expect(floored?.message).toContain('would not fit this height');
  const open = drawSpec(specData, { ...options, columnOverrides: { name: { width: 90 } }, size: { width: 960 } });
  expect(open.warnings.find((warning) => warning.code === 'generated-column-width-floored')?.message ?? '').not.toContain('would not fit this height');
});
