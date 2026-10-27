/**
 * The render target and physical units on the CLI and MCP
 * surfaces. One test per behaviour.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { main } from '../src/cli/main';
import { callTool } from '../src/mcp/server';
import { withSize } from '../src/cli/size';
import { fixtures } from '../src/cli/fixtures';
import { toLayoutPx } from '../src/core/target';
import type { DocChart } from '../src/core/doc/document';
import { getChart } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { rectsOverlap } from '../src/core/geometry';
import type { Geometry } from '../src/core/types/scene';

const SPEC = {
  type: 'column',
  data: {
    categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
    series: [{ id: 'rev', label: 'Revenue', values: [84, 91] }],
  },
  options: { title: 'Revenue rose in Q2' },
};

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function specFile(spec: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'boardplot-target-cli-'));
  dirs.push(dir);
  const path = join(dir, 'spec.json');
  writeFileSync(path, JSON.stringify(spec));
  return path;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cli(args: string[]): any {
  const log: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...value) => log.push(value.join(' ')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  main(args);
  vi.restoreAllMocks();
  return JSON.parse(log[0]!);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mcp(name: string, args: unknown): any {
  const { version: _version, ...body } = callTool(name, args).structuredContent as Record<string, unknown>;
  return body;
}

describe('render target on the CLI and MCP', () => {
  it('puts a --target flag into the id scope', () => {
    const scope = (svg: string) => /id="bp-desc-([0-9a-f]+)"/.exec(svg)?.[1];
    const plain = specFile(SPEC);
    const base = scope(cli(['render', plain, '--return', 'svg']).svg);
    expect(base).toBeDefined();
    expect(scope(cli(['render', plain, '--target', 'dashboard', '--return', 'svg']).svg)).not.toBe(base);
  });

  it('takes --target on render and measure: the flag beats options.target, which beats report', () => {
    const plain = specFile(SPEC);
    const dashboard = specFile({ ...SPEC, options: { ...SPEC.options, target: 'dashboard' } });
    for (const verb of ['render', 'measure']) {
      expect(cli([verb, plain]).target, verb).toBe('report');
      expect(cli([verb, dashboard]).target, verb).toBe('dashboard');
      expect(cli([verb, dashboard, '--target', 'slide']).target, verb).toBe('slide');
      expect(cli([verb, plain, '--target', 'projector']).errors[0], verb).toMatchObject({ code: 'invalid-argument', path: '/target' });
    }
    // A target with a fixed default frame draws at that frame.
    expect(cli(['render', plain, '--target', 'slide'])).toMatchObject({
      size: { width: 1184, height: 528 }, naturalSize: { width: 888, height: 396, unit: 'pt' },
    });
  });

  it('reads --width and --height as px when bare and as pt or mm with a suffix', () => {
    const file = specFile(SPEC);
    const pt = cli(['render', file, '--target', 'slide', '--width', '660pt', '--height', '360pt']);
    expect(pt).toMatchObject({ ok: true, size: { width: 880, height: 480 }, naturalSize: { width: 660, height: 360, unit: 'pt' } });
    expect(cli(['render', file, '--target', 'slide', '--width', '880', '--height', '480px']).size).toEqual(pt.size);
    expect(cli(['render', file, '--target', 'print', '--width', '180mm']).size.width).toBeCloseTo(180 / 25.4 * 96, 9);
    expect(cli(['measure', file, '--width', '660pt']).size.width).toBe(880);
    expect(cli(['render', file, '--width', 'pt']).errors[0]).toMatchObject({ code: 'invalid-argument', path: '/width' });
  });

  it('answers MCP render and measure as the CLI does, with target, layout size and natural output size', () => {
    const spec = { ...SPEC, options: { ...SPEC.options, size: { width: 660, height: 360, unit: 'pt' } } };
    const file = specFile(spec);
    const rendered = mcp('boardplot_render', { spec, target: 'slide', return: ['svg', 'reading'] });
    expect(rendered).toMatchObject({ ok: true, target: 'slide', size: { width: 880, height: 480 }, naturalSize: { width: 660, height: 360, unit: 'pt' } });
    expect(rendered.minDisplayWidth).toBeGreaterThan(0);
    expect(rendered).toEqual(cli(['render', file, '--target', 'slide', '--return', 'svg,reading']));
    const measured = mcp('boardplot_measure', { spec, target: 'slide', width: 880 });
    expect(measured).toMatchObject({ ok: true, target: 'slide', size: { width: 880 } });
    expect(measured).toEqual(cli(['measure', file, '--target', 'slide', '--width', '880']));
    // Numeric MCP sizes stay px; a unit string is refused, pt goes in options.size.
    expect(mcp('boardplot_render', { spec: SPEC, width: '660pt' }).errors[0]).toMatchObject({ code: 'invalid-argument', path: '/width' });
  });

  it('keeps pt in a size refusal fix and never patches px into a size marked pt', () => {
    const spec = { ...SPEC, options: { ...SPEC.options, size: { width: 150, height: 100, unit: 'pt' } } };
    const refused = mcp('boardplot_render', { spec });
    expect(refused.errors[0]).toMatchObject({
      code: 'size-below-floor', path: '/options/size',
      fix: [{ op: 'replace', path: '/options/size', value: { width: 210, height: 135, unit: 'pt' } }],
    });
    const fixed = mcp('boardplot_render', { spec: { ...spec, options: { ...spec.options, size: refused.errors[0].fix[0].value } } });
    expect(fixed.ok).toBe(true);
    // A pt argument is repaired in pt.
    expect(cli(['render', specFile(SPEC), '--width', '100pt']).errors[0]).toMatchObject({ path: '/width', fix: [{ op: 'replace', path: '/width', value: '210pt' }] });
    // A px argument over a pt size writes the whole size in px; a pt one keeps the authored pt side.
    const chart = { name: 'chart', ...spec } as DocChart;
    expect(withSize(chart, { value: 800, unit: 'px' }, undefined).options!.size).toEqual({ width: 800, height: toLayoutPx(100, 'pt') });
    expect(withSize(chart, { value: 600, unit: 'pt' }, undefined).options!.size).toEqual({ width: 600, height: 100, unit: 'pt' });
  });

  // Prevents a width argument over a size preset from keeping the preset's height off the size ladder.
  it('keeps the shape of a size preset when a width argument changes the width', () => {
    const source = getFixtures('column').find(item => item.id === 'integrated-stacked-variance')!;
    const spec = { type: 'column', data: source.data, options: source.options, annotations: source.annotations };
    expect(source.options).toMatchObject({ size: 'slide-4x3' });
    const rendered = mcp('boardplot_render', { spec, width: 840 });
    expect(rendered).toMatchObject({ ok: true, size: { width: 840, height: 632 } });
    expect(rendered.warnings.map((warning: { code: string }) => warning.code)).not.toContain('height-off-ladder');
    expect(rendered).toEqual(cli(['render', specFile(spec), '--width', '840']));
    // A refusal fix for the width argument also names the height the preset's shape lacks there.
    const small = { type: 'column', data: { categories: ['Q1', 'Q2'], series: [{ id: 'revenue', label: 'Revenue', values: [84, 91] }] },
      options: { title: 'Revenue rose in Q2', size: 'slide-16x9' } };
    const refused = mcp('boardplot_render', { spec: small, width: 240 });
    const fix = Object.fromEntries(refused.errors[0].fix.map((operation: { path: string; value: number }) => [operation.path.slice(1), operation.value]));
    expect(fix).toMatchObject({ width: 280 });
    expect(mcp('boardplot_render', { spec: small, ...fix }).ok).toBe(true);
  });

  it('draws a width in mm whose px value sits a fraction above a floor measured at that width', () => {
    // 84.67 mm is 320.0126 px; the choropleth measures its floor at the received width.
    const map = (fixtures({ type: 'choropleth', id: 'us-margin-by-state' }).body.fixtures as { spec: { options: object } }[])[0]!.spec;
    expect(mcp('boardplot_render', { spec: { ...map, options: { ...map.options, size: { width: 84.67, unit: 'mm' } } } }).ok).toBe(true);
  });
});

// Prevents authored Likert bar fractions from covering statements or giving CLI and MCP different card sizes.
it.each([0.8, 1])('keeps Likert statements clear at bandFraction %s through CLI and MCP', (bandFraction) => {
  const source = getFixtures('likert').find(item => item.id === 'engagement-options')!;
  const options = { ...source.options, bandFraction, size: { width: 400 } };
  const result = getChart('likert')!.layout(source.data as never, options as never) as Geometry;
  expect(result.refused).toBeUndefined();
  const names = result.labels.filter(label => label.kind === 'category' && !label.hidden);
  expect(names).toHaveLength((source.data as { items: unknown[] }).items.length);
  const marks = result.debug.occupied.filter(item => item.kind === 'mark');
  expect(names.filter(label => marks.some(mark => rectsOverlap(label.rect, mark.rect))).map(label => label.id)).toEqual([]);
  const spec = { type: 'likert', data: source.data, options };
  const rendered = cli(['render', specFile(spec), '--return', 'svg,reading']);
  expect(rendered).toMatchObject({ ok: true, size: result.size });
  expect(mcp('boardplot_render', { spec, return: ['svg', 'reading'] })).toEqual(rendered);
});
