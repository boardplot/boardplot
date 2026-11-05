import { describe, expect, it } from 'vitest';
import { render } from '../src/cli/render';

function drawn(spec: unknown) {
  const result = render({ spec, return: ['svg'] });
  const body = result.body as { svg?: string; warnings?: { code: string }[] };
  return { svg: body.svg ?? '', codes: (body.warnings ?? []).map((warning) => warning.code) };
}

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

  // A rung is a level, not a value: past the rows of the table it refused the chart, and at the largest integer the draw never ended.
  it('gives way on a table rung deeper than the rows', () => {
    const { svg, codes } = drawn({
      type: 'table',
      data: {
        columns: [{ id: 'name', kind: 'rowLabel', label: 'Name' }, { id: 'sales', kind: 'value', label: 'Sales' }],
        rows: [{ id: 'north', label: 'North', rung: Number.MAX_SAFE_INTEGER, cells: { sales: 1 } }, { id: 'south', label: 'South', cells: { sales: 2 } }],
      },
    });
    expect(svg).toContain('North');
    expect(codes).toContain('table-rung-capped');
  });

  // A month step past the last date a Date holds never reached the end of the range, so the tick list grew until the array length ran out.
  it('draws a time axis with a month step longer than any date', () => {
    const { svg, codes } = drawn({
      type: 'line',
      data: { x: ['2026-01-01', '2026-01-02', '2026-01-03'], series: [{ id: 'visits', label: 'Visits', values: [1, 2, 3] }] },
      options: { xAxis: { type: 'time', tickStep: { unit: 'month', step: Number.MAX_SAFE_INTEGER } } },
    });
    expect(svg).toContain('Visits');
    expect(codes).toContain('x-ticks-empty');
  });

  // An hour step longer than the range walked every day of that step, so a draw took 14 seconds and 3.8 GB.
  it('draws a time axis with an hour step longer than the range', () => {
    const { svg } = drawn({
      type: 'line',
      data: { x: ['2026-01-01', '2026-01-02', '2026-01-03'], series: [{ id: 'visits', label: 'Visits', values: [1, 2, 3] }] },
      options: { xAxis: { type: 'time', tickStep: { unit: 'hour', step: 1_000_000_000_000 } } },
    });
    expect(svg).toContain('Visits');
  });

  // An empty note had no lines, so its width was minus infinity, and the search for a free seat filled the heap until the process died.
  it('leaves out a heatmap callout with empty text', () => {
    const spec = (annotations: unknown[]) => ({
      type: 'heatmap',
      data: {
        categories: [{ id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }],
        series: [{ id: 'north', label: 'North', values: [1, 2] }, { id: 'south', label: 'South', values: [3, 4] }],
      },
      options: { annotations },
    });
    const { svg, codes } = drawn(spec([{ kind: 'callout', at: { categoryId: 'feb', seriesId: 'south' }, text: '' }]));
    expect(codes).toContain('annotation-empty');
    expect(svg).toContain('North');
    expect(svg).not.toContain('data-id="ann:');
  });
});
