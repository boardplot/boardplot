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
    const ids = Array.from({ length: 16 }, (_, index) => `m${index + 1}`);
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
