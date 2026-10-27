/**
 * every finding a model can receive is actionable.
 *
 * Ten typical authoring mistakes go through the document boundary. Each
 * finding has to name the field it is about (a JSON pointer into the document
 * the caller sent), what was expected or what arrived, one imperative sentence
 * that fixes it, and a reference page that exists. None of them may print an
 * unexplained internal rule id — the model cannot look one up.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { main } from '../src/cli/main';
import type { DiagnosticMetadata } from '../src/core/diagnostics/describe';

type Finding = DiagnosticMetadata & { code: string; message: string; suggest?: string };
interface Envelope { ok: boolean; errors: Finding[]; warnings: Finding[] }

const RULE_ID = /\bN\d+\.\d+\b/;
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function baseChart(): Record<string, unknown> {
  return {
    name: 'c',
    type: 'column',
    data: {
      categories: ['2023', '2024', '2025'],
      series: [{ id: 'revenue', label: 'Revenue', values: [120, 135, 151] }],
    },
    options: { title: 'Revenue grew 12 percent', unit: '$m' },
  };
}

function findings(chart: unknown, extra: Record<string, unknown> = {}): Envelope {
  const directory = mkdtempSync(join(tmpdir(), 'boardplot-diagnostic-'));
  directories.push(directory);
  const path = join(directory, 'doc.json');
  writeFileSync(path, JSON.stringify({ version: 1, charts: [chart], ...extra }));
  const output: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  main(['render', path]);
  log.mockRestore(); error.mockRestore(); warn.mockRestore();
  return JSON.parse(output.join('\n')) as Envelope;
}

/**
 * A pointer has to land in the document the caller sent. A pointer at a field
 * that is missing names the place it belongs, so its parent has to resolve.
 */
function resolves(document: unknown, pointer: string): boolean {
  const walk = (segments: string[]): boolean => {
  let value: unknown = document;
  for (const raw of segments) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) { value = value[Number(key)]; continue; }
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return true;
  };
  const segments = pointer.split('/').slice(1);
  return walk(segments) || (segments.length > 0 && walk(segments.slice(0, -1)));
}

const cases: [name: string, code: string, chart: () => unknown][] = [
  ['wrong enum', 'invalid-options', () => {
    const chart = baseChart();
    (chart.options as Record<string, unknown>).labelDensity = 'sparse';
    return chart;
  }],
  ['missing required field', 'invalid-data', () => {
    const chart = baseChart();
    delete (chart.data as Record<string, unknown>).series;
    return chart;
  }],
  ['string where a number belongs', 'invalid-data', () => {
    const chart = baseChart();
    (chart.data as { series: { values: unknown[] }[] }).series[0]!.values[1] = 'many';
    return chart;
  }],
  ['unknown option', 'unknown-option', () => {
    const chart = baseChart();
    (chart.options as Record<string, unknown>).labelStyle = 'bold';
    return chart;
  }],
  ['canvas below the floor', 'size-below-floor', () => {
    const chart = baseChart();
    (chart.options as Record<string, unknown>).size = { width: 200, height: 120 };
    return chart;
  }],
  ['log axis on a type that refuses it', 'invalid-options', () => {
    const chart = baseChart();
    (chart.options as Record<string, unknown>).valueAxis = { log: true };
    return chart;
  }],
  ['series shorter than the categories', 'length-mismatch', () => {
    const chart = baseChart();
    (chart.data as { series: { values: unknown[] }[] }).series[0]!.values = [120];
    return chart;
  }],
  ['two series with the same id', 'invalid-data', () => {
    const chart = baseChart();
    (chart.data as { series: unknown[] }).series.push({ id: 'revenue', label: 'Again', values: [1, 2, 3] });
    return chart;
  }],
  ['a chart form Boardplot draws differently', 'unknown-type', () => ({ ...baseChart(), type: 'tornado' })],
];

describe('every finding names a field, a fix and a page that exists', () => {
  // Prevents a key-position schema fix from promising that the repaired tilemap fits a pinned height.
  it('does not offer a size-blind patch for a refused side key', () => {
    const envelope = findings({ name: 'c', type: 'tilemap', data: { pack: 'eu27', regions: [{ id: 'AT', value: 12 }] },
      options: { title: 'Regional demand', legend: 'right', size: { width: 400, height: 300 } } });
    const warning = envelope.errors.find(w => w.code === 'invalid-options')!;
    expect(warning).toBeDefined();
    expect(warning.suggest).toBeTruthy();
    expect(warning.fix).toBeUndefined();
  });
  it.each(cases)('%s', (_name, code, build) => {
    const chart = build();
    const document = { version: 1, charts: [chart] };
    const envelope = findings(chart);
    const all = [...envelope.errors, ...envelope.warnings];
    const finding = all.find((entry) => entry.code === code);
    expect(finding, `no ${code} in ${all.map((entry) => entry.code).join(', ') || 'nothing'}`).toBeDefined();

    expect(finding!.path, 'JSON pointer').toMatch(/^\/charts\/0(\/|$)/);
    expect(resolves(document, finding!.path), `pointer ${finding!.path} resolves`).toBe(true);
    expect(finding!.expected ?? finding!.received, 'expected or received').toBeDefined();
    expect(finding!.suggest, 'one sentence that fixes it').toMatch(/^\S.*[.?]$/);
    expect(finding!.message).not.toMatch(RULE_ID);
    expect(finding!.suggest).not.toMatch(RULE_ID);
  });

  it('a theme whose colours do not separate is rejected with the same shape', () => {
    const directory = mkdtempSync(join(tmpdir(), 'boardplot-diagnostic-theme-'));
    directories.push(directory);
    const path = join(directory, 'doc.json');
    const { name: _name, ...chart } = baseChart();
    writeFileSync(path, JSON.stringify({ ...chart, theme: { preset: 'standard', overrides: { color: { ink: '#fdfdfd' } } } }));
    const output: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
    expect(main(['render', path])).toBe(1);
    log.mockRestore();
    const envelope = JSON.parse(output.join('\n')) as Envelope;
    const contrast = envelope.errors.find((finding) => finding.code === 'contrast-ink');
    expect(contrast, JSON.stringify(envelope.errors)).toMatchObject({ path: '/theme', docs: 'docs/reference/theme.md#theme' });
    expect(contrast!.expected ?? contrast!.received).toBeDefined();
    expect(contrast!.suggest).toMatch(/\S/);
    for (const finding of [...envelope.errors, ...envelope.warnings]) {
      expect(finding.message).not.toMatch(RULE_ID);
      if (finding.suggest) expect(finding.suggest).not.toMatch(RULE_ID);
    }
  });
});
