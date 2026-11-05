import { describe, expect, it } from 'vitest';
import { render } from '../src/cli/render';

interface Warned { code: string; path?: string }

function drawn(spec: unknown, width?: number) {
  const result = render({ spec, ...(width === undefined ? {} : { width }), return: ['svg'] });
  const body = result.body as { svg?: string; warnings?: Warned[] };
  return { svg: body.svg ?? '', warnings: body.warnings ?? [], codes: (body.warnings ?? []).map((warning) => warning.code) };
}

const labelX = (svg: string, row: string) => Number(new RegExp(`data-id="cell:${row}:name"[^>]*? x="([0-9.]+)"`).exec(svg)?.[1]);

const rungTree = (rung: number) => ({
  type: 'table',
  data: {
    columns: [{ id: 'name', kind: 'rowLabel', label: 'Name' }, { id: 'v', kind: 'value', label: 'Value' }],
    rows: [{ id: 'Group', label: 'Group', rung: 1, children: [{ id: 'Detail', label: 'Detail', rung, cells: { v: 12 } }] }],
  },
});

const calloutCases = {
  column: { type: 'column', data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], series: [{ id: 's', label: 'Series', values: [1, 3, 2] }] } },
  heatmap: { type: 'heatmap', data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], series: [{ id: 's', label: 'Series', values: [1, 3, 2] }, { id: 't', label: 'Other', values: [2, 1, 3] }] } },
};

const timeLine = (from: string, to: string, unit: string, step: number) => ({
  type: 'line',
  data: { x: [from, to], series: [{ id: 's', label: 'Series', values: [1, 3] }] },
  options: { xAxis: { type: 'time', tickStep: { unit, step } } },
});

const marks = (svg: string, id: string) => (svg.match(new RegExp(`data-id="${id}`, 'g')) ?? []).length;

describe('a value in the spec does not set the length of a layout loop', () => {
  // An anchor offset that spreads a plan over 50,000 years made the calendar head hold millions of cells, and the draw never ended.
  it('draws a gantt with a very large anchor offset', () => {
    const { svg } = drawn({
      type: 'gantt',
      data: {
        rows: [
          { id: 'plan', label: 'Plan', items: [{ id: 'scope', kind: 'bar', start: '2026-04-06', end: '2026-04-17', label: 'Scope' }] },
          { id: 'build', label: 'Build', items: [{ id: 'dev', kind: 'bar', start: '2026-04-20', end: '2026-05-22', label: 'Dev', anchor: { toItemId: 'scope', edge: 'end', offsetDays: 20_000_000 } }] },
        ],
      },
    });
    expect(svg).toContain('Dev');
  });

  // A column width of a billion pixels gave way one pixel at a time, and the draw never ended.
  it('draws a table with very wide columns inside its frame', () => {
    const ids = Array.from({ length: 24 }, (_, index) => `m${index + 1}`);
    const { svg } = drawn({
      type: 'table',
      data: {
        columns: [
          { id: 'name', kind: 'rowLabel', label: 'Name' },
          ...ids.map((id) => ({ id, kind: 'value', label: id, width: 1_000_000_000 })),
        ],
        rows: [{ id: 'north', label: 'North', cells: Object.fromEntries(ids.map((id, index) => [id, index])) }],
      },
    });
    expect(svg).toContain('North');
  });

  // A rung is an authored level and needs no row at each step above it: a cap at the row count moved this child onto its parent.
  it('keeps a rung deeper than the rows where the frame holds it', () => {
    const { svg, codes } = drawn(rungTree(2), 960);
    expect(labelX(svg, 'Group')).toBe(56);
    expect(labelX(svg, 'Detail')).toBe(72);
    expect(codes).not.toContain('table-rung-capped');
  });

  // A rung past the frame refused the chart, and at the largest integer the refusal's own width search never ended.
  it.each([1000, Number.MAX_SAFE_INTEGER])('gives way on a tree rung of %d at a fixed width', (rung) => {
    const { svg, codes } = drawn(rungTree(rung), 960);
    expect(svg).toContain('Detail');
    expect(codes).toContain('table-rung-capped');
  });

  // A flat table has no indent, so its rung costs no width and nothing gives way.
  it('leaves a flat table at the largest rung alone', () => {
    const { svg, codes } = drawn({
      type: 'table',
      data: {
        columns: [{ id: 'name', kind: 'rowLabel', label: 'Name' }, { id: 'v', kind: 'value', label: 'Value' }],
        rows: [{ id: 'north', label: 'North', rung: Number.MAX_SAFE_INTEGER, cells: { v: 1 } }, { id: 'south', label: 'South', cells: { v: 2 } }],
      },
    }, 960);
    expect(svg).toContain('North');
    expect(codes).not.toContain('table-rung-capped');
  });

  // A month step past the last date a Date holds never reached the end of the range, so the tick list grew until the array length ran out.
  it('draws a time axis with a month step longer than any date', () => {
    const { svg, codes } = drawn(timeLine('2026-01-01', '2026-01-03', 'month', Number.MAX_SAFE_INTEGER));
    expect(svg).toContain('Series');
    expect(codes).toContain('x-ticks-empty');
  });

  // An hour step longer than the range walked every day of that step, so a draw took 14 seconds and 3.8 GB.
  it('draws a time axis with an hour step longer than the range', () => {
    const { svg } = drawn(timeLine('2026-01-01', '2026-01-03', 'hour', 1_000_000_000_000));
    expect(svg).toContain('Series');
  });

  // A step longer than a day ticks at each midnight, so a range of many thousand years walked every day and the draw never ended.
  it('draws a time axis whose hour step would tick more days than the plot has pixels', () => {
    const { svg, warnings } = drawn(timeLine('0001-01-01', '9999-12-31', 'hour', 1_000_000_000_000), 960);
    expect(svg).toContain('Series');
    expect(warnings.some((warning) => warning.path === '/options/xAxis/tickStep')).toBe(true);
    expect(marks(svg, 'axis:x:scale')).toBeLessThanOrEqual(960);
  });

  // The same step over a range the automatic ticks can name takes them, so the axis stays readable.
  it('gives the axis its automatic ticks where such a step gives way', () => {
    const { svg, codes } = drawn(timeLine('2000-01-01', '2100-01-01', 'hour', 1_000_000), 960);
    expect(codes).toContain('x-tick-step-ignored');
    expect(codes).not.toContain('x-ticks-empty');
    expect(svg).toContain('>2040<');
  });

  // No lines gave a note a width of minus infinity, so the heatmap's search for a free seat filled the heap, and the fix must not take the arrow with it.
  it.each(['column', 'heatmap'] as const)('keeps the arrow of an empty callout on a %s', (type) => {
    const at = { categoryId: 'b', seriesId: 's' };
    const withArrow = drawn({ ...calloutCases[type], options: { annotations: [{ id: 'probe', at, kind: 'callout', text: '', arrow: true }] } }, 960);
    expect(withArrow.svg).toContain('data-id="ann:probe:arrow');
    expect(withArrow.codes).toContain('annotation-empty');
    const noArrow = drawn({ ...calloutCases[type], options: { annotations: [{ id: 'probe', at, kind: 'callout', text: '' }] } }, 960);
    expect(noArrow.svg).toContain('data-id="leader:annotation:probe');
    expect(noArrow.codes).toContain('annotation-empty');
  });
});
