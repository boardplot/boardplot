/**
 * The four tools and the chart view resource. One fresh
 * McpServer per HTTP request: the server keeps no session and no state.
 */
import * as z from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { AppsSupport, ToolResult } from './engine';
import type { RenderPool } from './render';
import { cleanPresets, SERIES_LIMIT } from './brand';
import { LIMITS } from './limits';
import { readFileSync } from 'node:fs';

export const VIEW_URI = 'ui://boardplot/chart-v1.html';

declare const __VIEW_HTML__: string | undefined;
let viewHtml: string | undefined;
/** The built view (build.mjs inlines it; a test run from source reads dist/view.html). */
function view(): string {
  viewHtml ??= typeof __VIEW_HTML__ === 'string' ? __VIEW_HTML__ : readFileSync(new URL('../dist/view.html', import.meta.url), 'utf8');
  return viewHtml;
}

/** All four tools only compute: they write nothing and reach nothing outside. */
export const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).describe('A hex colour, #RRGGBB.');

const brand = z.strictObject({
  preset: z.string().optional().describe('Base preset; default boardroom.'),
  background: color.optional(), text: color.optional(), muted: color.optional(),
  accent: color.optional().describe('Brand or primary colour; also the first series colour when series is absent.'),
  good: color.optional(), bad: color.optional(),
  // Shallow on purpose: a long list of bad values must give one short error from the server, not one schema issue per element.
  series: z.union([z.array(z.unknown()).max(SERIES_LIMIT), z.record(z.string(), z.unknown())]).optional().describe(`Series colours (#RRGGBB) in order, or by series name; at most ${SERIES_LIMIT}.`),
  font: z.strictObject({ family: z.string() }).optional().describe('Font family. A family without an engine metric table draws in a fallback font; the reading warns font-not-measured.'),
});

const frame = z.strictObject({
  width: z.number().min(120).max(4000), height: z.number().min(80).max(4000),
}).describe('Frame in CSS px; default 720 × 405.');

const columns = z.strictObject({
  category: z.string().optional(), series: z.string().optional(), value: z.string().optional(),
  categoryLabel: z.string().optional(), seriesLabel: z.string().optional(), unit: z.string().optional(),
  date: z.string().optional(), state: z.string().optional(), label: z.string().optional(),
  type: z.string().optional().describe('Waterfall item type column: delta (default), subtotal or total.'),
  x: z.string().optional(), y: z.string().optional(), size: z.string().optional(), group: z.string().optional(),
  valueKind: z.enum(['number', 'percent', 'fraction']).optional(),
}).describe('Source column of each role. Category charts: category, value, optional series (one series named after the value column when absent). Maps: category, value. Waterfall: label, value, optional type. Scatter: x, y, optional size, label, group.');

/** The flat ChartInput: no top-level oneOf, the server checks the combination. */
const scheme = z.enum(['light', 'dark']).optional().describe('The colour scheme to draw; an explicit theme draws the same in both. Default light.');

const chartInput = {
  spec: z.looseObject({}).optional().describe('A full Boardplot spec { type, data, options }, or a template whose data rows or csv refill.'),
  // Shallow on purpose (see series): the server checks each row's shape and answers one short error.
  rows: z.array(z.unknown()).max(LIMITS.rows).optional().describe(`Table rows, one object per row; at most ${LIMITS.rows}. Needs type (or spec) and columns.`),
  csv: z.string().max(LIMITS.bodyBytes).optional().describe('CSV text with a header row. Needs type (or spec) and columns. Not with rows.'),
  csvFormat: z.strictObject({ delimiter: z.enum([',', ';', '\t']).optional(), decimal: z.enum(['.', ',']).optional() }).optional()
    .describe('Delimiter and decimal mark; detected when absent.'),
  type: z.string().optional().describe('Chart type or alias, such as column, bar, line, waterfall (bridge), mekko, variance.'),
  columns: columns.optional(),
  options: z.looseObject({}).optional().describe('Chart options as in a spec: title, unit, variant, source and the rest.'),
  theme: z.union([z.string(), brand]).optional().describe(`A preset name (${cleanPresets().join(', ')}) or a brand.`),
  frame: frame.optional(),
  target: z.enum(['report', 'dashboard', 'slide']).optional().describe('Reading context; default report.'),
};

const DESCRIPTIONS = {
  describe: 'Lists Boardplot chart types with their variants, or returns the data roles, options, limits and one example for one chart type.',
  chart: 'Renders a chart from rows, CSV text or a Boardplot spec and shows it in an interactive view. Returns a short text reading: chart type, rows used, the numbers the chart computes (when it computes any), labels, fit, and warnings.',
  export: 'Returns a chart as SVG, or as a PNG at exactly twice the size. Reports whether the chart fits the frame and the size it needs, and any rows or colours it changed or left out.',
  view: 'Returns the drawing data for the Boardplot chart view at a given frame size. The chart view calls it; it is not offered to the model.',
};

/** Whether this request's client renders MCP Apps views; unknown on a 2025-era stateless request. */
function appsSupport(server: McpServer): AppsSupport {
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities) return undefined;
  return getUiCapability(capabilities)?.mimeTypes?.includes(RESOURCE_MIME_TYPE) === true;
}

type Result = ToolResult & Record<string, unknown>;

export function createBoardplotServer(pool: RenderPool, version: string): McpServer {
  const server = new McpServer({ name: 'boardplot', title: 'Boardplot', version }, { capabilities: { tools: {}, resources: {} } });

  server.registerTool('boardplot_describe', {
    title: 'Describe chart types',
    description: DESCRIPTIONS.describe,
    inputSchema: z.strictObject({
      type: z.string().optional().describe('A chart type or alias; omit for the catalog.'),
      variant: z.string().optional().describe('One variant of the type, such as stacked.'),
    }),
    annotations: ANNOTATIONS,
  }, async (input) => (await pool.run({ op: 'describe', input })) as Result);

  registerAppTool(server, 'boardplot_chart', {
    title: 'Render chart',
    description: DESCRIPTIONS.chart,
    inputSchema: z.strictObject(chartInput),
    annotations: ANNOTATIONS,
    _meta: { ui: { resourceUri: VIEW_URI, visibility: ['model', 'app'] } },
  }, async (input) => (await pool.run({ op: 'chart', input: input as never, apps: appsSupport(server) })) as Result);

  server.registerTool('boardplot_export', {
    title: 'Export chart',
    description: DESCRIPTIONS.export,
    inputSchema: z.strictObject({ ...chartInput, format: z.enum(['svg', 'png']).describe('svg, or png at exactly 2×.'), scheme }),
    annotations: ANNOTATIONS,
  }, async (input) => (await pool.run({ op: 'export', input: input as never })) as Result);

  // App only and without a view of its own: the host keeps it out of the model's tool list.
  server.registerTool('boardplot_view', {
    title: 'Chart view data',
    description: DESCRIPTIONS.view,
    inputSchema: z.strictObject({
      ...chartInput,
      revision: z.string().optional().describe('The revision of the chart the view shows.'),
      seq: z.number().int().min(0).describe('Rises with each view request; the view drops older answers.'),
      scheme,
    }),
    annotations: ANNOTATIONS,
    _meta: { ui: { visibility: ['app'] } },
  }, async (input) => (await pool.run({ op: 'view', input: input as never })) as Result);

  registerAppResource(server, 'Boardplot chart view', VIEW_URI, {
    description: 'Interactive Boardplot chart: hover, theme swap, re-layout and Download PNG.',
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, permissions: { clipboardWrite: {} }, prefersBorder: false } },
  }, async () => ({
    contents: [{
      uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: view(),
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, permissions: { clipboardWrite: {} }, prefersBorder: false } },
    }],
  }));

  return server;
}
