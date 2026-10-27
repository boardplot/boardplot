import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli/main';
import { DocumentSchemaError } from '../src/core/doc/document';
import { parseChartSpec, BoardplotSpecError } from '../src/react/prepare';
import { specSettings } from '../src/react/parseChartSpec';
import { getFixtures } from '../src/fixtures';

const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function cliValidate(document: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'boardplot-spec-errors-'));
  directories.push(directory);
  const source = join(directory, 'document.json');
  writeFileSync(source, JSON.stringify(document));
  const output: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...values) => output.push(values.join(' ')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const code = main(['render', source]);
  vi.restoreAllMocks();
  return { code, envelope: JSON.parse(output.join('\n')) as { errors: unknown[] } };
}

const invalidData = {
  version: 1,
  charts: [{
    name: 'volume',
    type: 'column',
    data: { categories: ['A'], series: [{ id: 's', values: ['12'] }] },
  }],
};

async function captured(action: () => unknown): Promise<BoardplotSpecError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(BoardplotSpecError);
    return error as BoardplotSpecError;
  }
  throw new Error('Expected BoardplotSpecError');
}

describe('structured spec errors', () => {
  it('publishes CLI-equivalent invalid-data diagnostics without copying their objects', async () => {
    const cli = cliValidate(invalidData);
    const error = await captured(() => parseChartSpec(invalidData));

    expect(cli.code).toBe(1);
    expect(error.name).toBe('BoardplotSpecError');
    expect(error).toBeInstanceOf(DocumentSchemaError);
    expect(error.errors).toBe(error.envelopeErrors);
    expect(error.errors[0]).toBe(error.envelopeErrors[0]);
    expect(error.errors).toEqual(cli.envelope.errors);
    expect(error.message).toContain('/charts/0/data/series/0/values/0');
    expect(error.message).toContain('Expected:');
    expect(error.message).toContain('Fix: Replace /charts/0/data/series/0/values/0 with 12.');
    expect(error.message).not.toContain('alternatives');
    expect(error.errors[0]).toMatchObject({
      code: 'invalid-data',
      path: '/charts/0/data/series/0/values/0',
      expected: expect.any(Object),
      suggest: expect.any(String),
      fix: expect.any(Array),
    });
  });

  it('uses the public error for invalid host settings and chart selection', async () => {
    const host = await captured(() => specSettings({ size: 'wrong' as never }));
    expect(host.errors[0]).toMatchObject({
      code: 'invalid-react-options',
      path: '/size',
      expected: expect.any(Object),
    });

    const document = { version: 1, charts: [
      { ...invalidData.charts[0], name: 'West', data: { categories: ['A'], series: [{ id: 's', values: [12] }] } },
      { ...invalidData.charts[0], name: 'East', data: { categories: ['A'], series: [{ id: 's', values: [13] }] } },
    ] };
    const required = await captured(() => parseChartSpec(document));
    expect(required.errors[0]).toMatchObject({
      code: 'chart-selection-required',
      path: '/chart',
      expected: { values: ['West', 'East'] },
      suggest: 'Pass chart with one of the expanded chart names.',
    });
    const missing = await captured(() => parseChartSpec(document, 'North'));
    expect(missing.errors[0]).toMatchObject({ code: 'chart-not-found', path: '/chart' });
  });

  it('refuses text on a valueLine with the patch that renames it to label', async () => {
    const chart = (annotation: Record<string, unknown>) => ({
      type: 'column',
      data: { categories: ['A', 'B'], series: [{ id: 's', values: [12, 14] }] },
      annotations: [annotation],
    });
    const valueLine = await captured(() => parseChartSpec(chart({ kind: 'valueLine', value: 13, text: 'Target' })));
    expect(valueLine.errors[0]).toMatchObject({
      code: 'invalid-annotation',
      path: '/annotations/0/text',
      message: expect.stringContaining("'label'"),
      fix: [
        { op: 'test', path: '/annotations/0', value: { kind: 'valueLine', value: 13, text: 'Target' } },
        { op: 'replace', path: '/annotations/0', value: { kind: 'valueLine', value: 13, label: 'Target' } },
      ],
    });
    const both = await captured(() => parseChartSpec(chart({ kind: 'valueLine', value: 13, text: 'Target', label: 'Plan' })));
    expect(both.errors[0]).toMatchObject({ path: '/annotations/0/text', fix: [{ op: 'remove', path: '/annotations/0/text' }] });
    const indicator = await captured(() => parseChartSpec(chart({ kind: 'indicator100', text: 'Full' })));
    expect(indicator.errors[0]).toMatchObject({ path: '/annotations/0/text', fix: [{ op: 'remove', path: '/annotations/0/text' }] });
  });

  it('carries the object shape and the way out of a refused key into React as the CLI prints them', async () => {
    const chart = (type: string, data: unknown, options: object) => ({ version: 1, charts: [{ name: 'c', type, data, options }] });
    const waterfall = chart('waterfall', getFixtures('waterfall')[0]!.data, { valueAxis: { break: true } });
    const slope = chart('slope', getFixtures('slope')[0]!.data, { valueAxis: { reverse: true } });
    for (const document of [waterfall, slope]) {
      expect((await captured(() => parseChartSpec(document))).errors).toEqual(cliValidate(document).envelope.errors);
    }
    expect((await captured(() => parseChartSpec(waterfall))).message).toContain('required from (number), to (number); optional style (\'straight\'); break requires from < to');
    expect((await captured(() => parseChartSpec(slope))).errors[0]).toMatchObject({ suggest: expect.stringContaining("options.variant 'bump'") });
  });

  it('does not mutate inputs and preserves unexpected internal errors', async () => {
    const before = JSON.stringify(invalidData);
    await captured(() => parseChartSpec(invalidData));
    expect(JSON.stringify(invalidData)).toBe(before);

    const unexpected = new Error('unexpected');
    const hostile = new Proxy({}, { ownKeys: () => { throw unexpected; } });
    await expect(parseChartSpec(hostile)).rejects.toBe(unexpected);
  });
});
