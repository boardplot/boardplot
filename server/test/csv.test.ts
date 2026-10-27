import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../src/csv';
import { connect, startBuilt } from './helpers';

const csv = 'Region;Revenue\nNorth;1,5\nSouth;\nEast;2,25\n';

let server: Awaited<ReturnType<typeof startBuilt>>;
beforeAll(async () => { server = await startBuilt(); });
afterAll(async () => { await server.stop(); });

// European spreadsheets export decimal commas and empty cells; a misread mark or a zero-filled gap would draw wrong numbers.
it('reads decimal commas as numbers and keeps the missing value missing', async () => {
  const parsed = parseCsv(csv, {}, ['Revenue']);
  expect(parsed.delimiter).toBe(';');
  expect(parsed.decimal).toBe(',');
  expect(parsed.rows.map((row) => row.Revenue)).toEqual([1.5, null, 2.25]);

  const client = await connect(server.url, false);
  const result = await client.callTool({
    name: 'boardplot_export',
    arguments: { csv, type: 'column', columns: { category: 'Region', value: 'Revenue' }, format: 'svg' },
  });
  await client.close();
  expect(result.isError).not.toBe(true);
  const svg = (result.content as { type: string; text?: string }[]).map((block) => block.text ?? '').join('');
  expect(svg).toContain('1.5');
  expect(svg).toContain('2.25');
  expect(svg).not.toMatch(/>0<\/text>/);
});
