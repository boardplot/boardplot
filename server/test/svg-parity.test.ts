import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import '../../src/core/charts';
import { main } from '../../src/cli/main';
import { connect, startBuilt } from './helpers';

const spec = {
  type: 'column',
  data: { categories: ['North', 'South', 'East', 'West'], series: [{ id: 'revenue', label: 'Revenue', values: [42, 37.5, 51, 28] }] },
  options: { title: 'Revenue by region', unit: 'EUR m' },
};

let server: Awaited<ReturnType<typeof startBuilt>>;
beforeAll(async () => { server = await startBuilt(); });
afterAll(async () => { await server.stop(); });

// The hosted chart must be the same chart the CLI draws, so the server may not drift from the engine it bundles.
it('boardplot_chart returns the same SVG bytes as boardplot render', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'boardplot-server-parity-'));
  try {
    const path = join(directory, 'spec.json');
    writeFileSync(path, JSON.stringify(spec));
    const out: string[] = []; const quiet = [vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); }), vi.spyOn(console, 'error').mockImplementation(() => {})];
    const code = main(['render', path, '--target', 'report', '--width', '720', '--height', '405', '-o', join(directory, 'chart.svg')]);
    quiet.forEach((spy) => spy.mockRestore());
    expect(code, out.join('\n')).toBe(0);
    const cli = readFileSync(join(directory, 'chart.svg'), 'utf8');

    const client = await connect(server.url, true);
    const result = await client.callTool({ name: 'boardplot_chart', arguments: { spec } });
    await client.close();
    expect(result.isError).not.toBe(true);
    const payload = (result._meta as { boardplot: { svgLight: string } }).boardplot;
    expect(payload.svgLight).toBe(cli);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
