import { afterEach, describe, expect, it, vi } from 'vitest';

const lineSpec = (first: number) => ({ type: 'line', data: { categories: ['Q1', 'Q2', 'Q3'], series: [{ id: 'revenue', label: 'Revenue', values: [first, 12, 15] }] } });

afterEach(() => { vi.doUnmock('../src/react/export/engine'); vi.resetModules(); });

describe('the first export call', () => {
  // A page that sets its next spec right after it starts an export must still get the chart it asked for.
  it('exports the spec as it was at the call while the engine loads', async () => {
    vi.resetModules();
    const { exportCsv } = await import('../src/react/export/lazy');
    const spec = lineSpec(10);
    const first = exportCsv({ spec });
    spec.data = lineSpec(100).data;
    const second = exportCsv({ spec });
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && a.artifact.text).toContain('10');
    expect(a.ok && a.artifact.text).not.toContain('100');
    expect(b.ok && b.artifact.text).toContain('100');
  });

  // A failed download of the engine chunk must reach the caller's `result.ok` check, not reject the promise.
  it('answers invalid when the engine chunk fails to load, and loads it at the next call', async () => {
    vi.resetModules();
    vi.doMock('../src/react/export/engine', () => { throw new Error('chunk failed'); });
    const { exportSvg } = await import('../src/react/export/lazy');
    const failed = await exportSvg({ spec: lineSpec(10) });
    expect(failed).toMatchObject({ ok: false, code: 'invalid' });
    vi.doUnmock('../src/react/export/engine');
    expect((await exportSvg({ spec: lineSpec(10) })).ok).toBe(true);
  });
});
