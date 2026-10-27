/**
 * The MACHINE surface must not be more confident than the human one: a
 * severity the engine computes correctly must survive the serialisation
 * boundary.
 *
 * A lint the layout declares `severity:'error'` printed with the same ⚠
 * as an ignored-option nag, `validate` called the document "valid", and
 * both `validate` and `render` exited 0 and wrote the SVG.
 *
 * Every assertion here is written so that reverting the fix turns it red.
 *
 * There is no per-fixture sweep here: re-running validate and render for every
 * registered fixture restates one property. The property itself is what matters, so
 * keeps it as named documents from three layout families.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { main } from '../src/cli/main';
import { isRefused, layoutResolvedRequest, resolveChartRequest } from '../src/index';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'boardplot-machine-verdict-'));
  dirs.push(d);
  return d;
}

function runCli(args: string[]): { code: number; log: string; err: string } {
  const log: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...v) => log.push(v.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...v) => err.push(v.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...v) => err.push(v.join(' ')));
  const code = main(args);
  vi.restoreAllMocks();
  return { code, log: log.join('\n'), err: err.join('\n') };
}

interface Envelope {
  ok: boolean;
  errors: { code: string; message: string; path?: string; suggest?: string }[];
  warnings: { code: string; severity: string; message: string; suggest?: string }[];
}

function runJson(args: string[]): { code: number; envelope: Envelope } {
  const r = runCli([...args]);
  return { code: r.code, envelope: JSON.parse(r.log) as Envelope };
}

describe('a severity:error lint is a refusal, not a nag', () => {
  const comboDoc = {
    version: 1,
    charts: [
      {
        name: 'revenue-units',
        type: 'combo',
        data: {
          categories: [
            { id: '2023', label: '2023' },
            { id: '2024', label: '2024' },
          ],
          series: [
            { id: 'revenue', label: 'Revenue', values: [323, 429] },
            { id: 'units', label: 'Units sold', kind: 'line', axis: 'secondary', values: [44.1, 48.3] },
          ],
        },
      },
    ],
  };

  it('render refuses the document instead of calling it valid', () => {
    const dir = tdir();
    const docPath = join(dir, 'doc.json');
    writeFileSync(docPath, JSON.stringify(comboDoc));

    const { code, envelope } = runJson(['render', docPath]);
    expect(code).toBe(1);
    expect(envelope.ok).toBe(false);
    const refusal = envelope.errors.find((e) => e.code === 'dual-axis');
    expect(refusal, JSON.stringify(envelope)).toBeDefined();
    expect(refusal!.path).toBe('/charts/0/data/series/1/axis');
    expect(refusal!.suggest).toContain('acknowledge');
    // and it is not ALSO a warning — one severity, one place
    expect(envelope.warnings.some((w) => w.code === 'dual-axis')).toBe(false);
  });

  // The library layout drew this chart on one scale while the CLI refused it.
  it('the library layout refuses an unacknowledged secondary axis with the code and message the CLI prints', () => {
    const dir = tdir();
    const docPath = join(dir, 'doc.json');
    writeFileSync(docPath, JSON.stringify(comboDoc));
    const cli = runJson(['render', docPath]).envelope.errors.find((e) => e.code === 'dual-axis')!;
    const { name: _name, ...chart } = comboDoc.charts[0]!;
    const layout = layoutResolvedRequest(resolveChartRequest(chart as never));
    expect(isRefused(layout)).toBe(true);
    const refusal = layout.warnings.find((w) => w.severity === 'error')!;
    // The CLI names the chart in front of the engine's message.
    expect({ code: refusal.code, message: `chart 'revenue-units': ${refusal.message}`, suggest: refusal.suggest })
      .toEqual({ code: cli.code, message: cli.message, suggest: cli.suggest });
    expect(refusal.message).toContain("'units'");
    expect(refusal.message).toContain('options.secondaryAxis.acknowledge');
    expect(refusal.suggest).toContain('secondaryAxis.ruler');
    // The ruler repair the fix names draws: the series leaves the secondary axis, the ruler relabels the primary.
    const [revenue, units] = chart.data.series;
    const { axis: _axis, ...unitsOnPrimary } = units!;
    const ruled = layoutResolvedRequest(resolveChartRequest({ ...chart,
      data: { ...chart.data, series: [revenue!, unitsOnPrimary] },
      options: { secondaryAxis: { ruler: { of: 'primary', total: 500 } } } } as never));
    expect(isRefused(ruled), JSON.stringify(ruled.warnings)).toBe(false);
  });

  it('render writes no SVG for a refused chart', () => {
    const dir = tdir();
    const docPath = join(dir, 'doc.json');
    writeFileSync(docPath, JSON.stringify(comboDoc));
    const svg = join(dir, 'chart.svg');

    const r = runCli(['render', docPath, '-o', svg]);
    expect(r.code).toBe(1);
    expect(existsSync(svg)).toBe(false);
  });

  it('acknowledging the second axis renders exactly as before — the gate is the refusal, not the chart', () => {
    const dir = tdir();
    const docPath = join(dir, 'doc.json');
    writeFileSync(
      docPath,
      JSON.stringify({
        ...comboDoc,
        charts: [{ ...comboDoc.charts[0], options: { secondaryAxis: { acknowledge: true } } }],
      }),
    );
    const out = join(dir, 'out');
    const { code, envelope } = runJson(['render', docPath, '-o', out]);
    expect(code).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(existsSync(join(out, 'revenue-units.svg'))).toBe(true);
    // the acknowledged chart still NAGS — that one really is a warning
    expect(envelope.warnings.some((w) => w.code === 'dual-axis' && w.severity === 'warn')).toBe(true);
  });

  // Hand-built documents cover error lints that shipped fixtures do not reach.
  // Every severity:'error' lint must refuse, regardless of chart family.
  it.each([
    {
      code: 'target-unknown-series',
      doc: {
        version: 1,
        charts: [
          {
            name: 'arr',
            type: 'line',
            data: {
              categories: [{ id: 'q1' }, { id: 'q2' }],
              series: [{ id: 'arr', label: 'ARR', values: [10, 12] }],
            },
            options: { targets: [{ seriesId: 'ghost', at: 'q2', value: 15 }] },
          },
        ],
      },
    },
    {
      code: 'status-unknown-state',
      doc: {
        version: 1,
        charts: [
          {
            name: 'raid',
            type: 'status',
            data: {
              rows: [{ id: 'r1', label: 'Workstream 1' }],
              columns: [{ id: 'c1', label: 'Q1' }],
              cells: [{ row: 'r1', col: 'c1', state: 'nonexistent' }],
            },
            options: { states: [{ id: 'green', label: 'On track', tone: 'good' }] },
          },
        ],
      },
    },
  ])('$code (a different layout family) refuses too', ({ code, doc }) => {
    const dir = tdir();
    const docPath = join(dir, 'doc.json');
    writeFileSync(docPath, JSON.stringify(doc));
    const svg = join(dir, 'chart.svg');

    const validate = runJson(['render', docPath]);
    expect(validate.code, JSON.stringify(validate.envelope)).toBe(1);
    expect(validate.envelope.errors.some((e) => e.code === code)).toBe(true);
    expect(validate.envelope.warnings.some((w) => w.code === code)).toBe(false);
    expect(runJson(['render', docPath, '-o', svg]).code).toBe(1);
    expect(existsSync(svg)).toBe(false);
  });
});
