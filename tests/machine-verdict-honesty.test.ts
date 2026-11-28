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

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { main } from '../src/cli/main';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { requireGeometry } from '../src/core/sizing';

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

describe('combo secondary axes', () => {
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

  // Retiring the consent flag must leave old charts byte-identical to charts that omit it.
  it('draws the same SVG with the retired flag and warns how to remove it', () => {
    const dir = tdir();
    const docPath = join(dir, 'doc.json');
    const svg = join(dir, 'chart.svg');
    writeFileSync(docPath, JSON.stringify(comboDoc));

    const args = ['render', docPath, '--format', 'svg', '--out', svg, '--overwrite'];
    const normal = runJson(args);
    expect(normal.code).toBe(0);
    expect(normal.envelope.ok).toBe(true);
    expect(normal.envelope.warnings.filter(w => w.code === 'dual-axis')).toMatchObject([{ severity: 'warn' }]);
    const original = readFileSync(svg, 'utf8');

    writeFileSync(docPath, JSON.stringify({
      ...comboDoc,
      charts: [{ ...comboDoc.charts[0], options: { secondaryAxis: { acknowledge: true } } }],
    }));
    const legacy = runJson(args);
    expect(legacy.code).toBe(0);
    expect(legacy.envelope.ok).toBe(true);
    expect(legacy.envelope.warnings.filter(w => w.code === 'option-deprecated')).toMatchObject([{
      severity: 'warn', fix: [{ op: 'remove', path: '/charts/0/options/secondaryAxis/acknowledge' }],
    }]);
    expect(readFileSync(svg, 'utf8')).toBe(original);
  });

  // A percentage ruler must keep its meaning when a series asks for a second scale.
  it('draws the ruler and keeps all series on the primary scale with one warning', () => {
    const { name: _name, ...chart } = comboDoc.charts[0]!;
    const draw = (axis: 'primary' | 'secondary') => requireGeometry(layoutResolvedRequest(resolveChartRequest({
      ...chart,
      data: { ...chart.data, series: chart.data.series.map(series => ({ ...series, axis })) },
      options: { secondaryAxis: { ruler: { of: 'primary', total: 500 } } },
    } as never)));
    const ruled = draw('secondary');
    const primary = draw('primary');
    expect(ruled.axes).toEqual(primary.axes);
    expect(ruled.scene).toEqual(primary.scene);
    expect(ruled.scene.some(node => node.t === 'text' && node.lines.includes('100%'))).toBe(true);
    expect(ruled.warnings.filter(w => w.code === 'secondary-axis-ignored' || w.code === 'dual-axis')).toMatchObject([{
      code: 'secondary-axis-ignored', severity: 'warn', message: expect.stringContaining("keeps 'revenue', 'units' on the primary scale"),
    }]);
  });
});

describe('an error-severity lint refuses the chart', () => {
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
