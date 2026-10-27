import { afterAll, beforeAll, expect, it } from 'vitest';
import { connect, startBuilt } from './helpers';

let server: Awaited<ReturnType<typeof startBuilt>>;
beforeAll(async () => { server = await startBuilt(); });
afterAll(async () => { await server.stop(); });

// Hosts show titles and use the four hints to decide on confirmations, and the view tool must stay out of the model's list.
it('every tool has a title and the four annotations, and boardplot_view is app-only', async () => {
  const client = await connect(server.url, true);
  const { tools } = await client.listTools();
  await client.close();
  expect(tools.map((tool) => tool.name).sort()).toEqual(['boardplot_chart', 'boardplot_describe', 'boardplot_export', 'boardplot_view']);
  for (const tool of tools) {
    expect(tool.title, tool.name).toBeTruthy();
    expect(tool.annotations, tool.name).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  }
  const ui = (name: string) => (tools.find((tool) => tool.name === name)?._meta as { ui?: { visibility?: string[]; resourceUri?: string } } | undefined)?.ui;
  expect(ui('boardplot_view')).toEqual({ visibility: ['app'] });
  expect(ui('boardplot_chart')).toEqual({ resourceUri: 'ui://boardplot/chart-v1.html', visibility: ['model', 'app'] });
});
