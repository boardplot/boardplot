/** The MCP surface: six tools over the same verb functions as the CLI. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ABSOLUTE_OUT_DIR_PATTERN,
  DEFAULT_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  callTool,
  pluginUpdateNotice,
  tools,
  type ToolDefinition,
} from '../src/mcp/server';
import { API_VERSION, BOARDPLOT_VERSION } from '../src/version';
import { ENGINE_REV } from '../src/core/engine';
import { themes } from '../src/core/theme';
import { listCharts } from '../src/core/registry';
import { ADOPTED_THEME_LIMIT, adoptedThemeCount } from '../src/core/themeStore';
import { availableRasterizer, pngSize } from '../src/cli/raster';
import { render } from '../src/cli/render';
import { buildFontTables, loadFontReader, serializeFontTables } from '../src/cli/fontTables';

interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_SERVER = join(ROOT, 'src/mcp/server.ts');
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function runEnvelope(lines: string[], cwd: string): RpcResponse[] {
  const run = spawnSync(TSX, [MCP_SERVER], {
    cwd,
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
  });
  expect(run.error).toBeUndefined();
  expect(run.signal).toBeNull();
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe('');
  return run.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RpcResponse);
}

const SPEC = {
  type: 'column',
  data: { categories: [{ id: 'a' }, { id: 'b' }], series: [{ id: 's', values: [1, 2] }] },
  options: { title: 'Volumes doubled', labels: false },
};
const ENVELOPE = { version: 1, charts: [{ name: 't', ...SPEC }] };

function body(result: ReturnType<typeof callTool>): Record<string, any> {
  expect(JSON.parse(result.text)).toEqual(result.structuredContent);
  return result.structuredContent as Record<string, any>;
}

describe('boardplot MCP server', () => {
  // A stale MCP engine must name the newer CLI once, without waiting for the CLI to answer.
  it('checks the CLI once in the background and reports a newer version once per process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'boardplot-mcp-newer-'));
    dirs.push(dir);
    const command = join(dir, 'boardplot');
    const checked = join(dir, 'checked');
    const release = join(dir, 'release');
    writeFileSync(command, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(checked)}, process.argv.slice(2).join(' ') + '\\n');\nconst timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) { clearInterval(timer); console.log('99.0.0'); } }, 10);\n`);
    chmodSync(command, 0o755);
    const child = spawn(TSX, [MCP_SERVER], { cwd: ROOT, env: { ...process.env, PATH: `${dir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` }, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    const replies = new Map<number, (reply: RpcResponse) => void>();
    let next = 0;
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    lines.on('line', (line) => {
      const reply = JSON.parse(line) as RpcResponse;
      replies.get(Number(reply.id))?.(reply);
      replies.delete(Number(reply.id));
    });
    const request = (method: string, params?: unknown): Promise<RpcResponse> => new Promise((done) => {
      const id = ++next;
      replies.set(id, done);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    const renderCall = () => request('tools/call', { name: 'boardplot_render', arguments: { spec: SPEC } });
    const notices = (reply: RpcResponse) => (reply.result!.content as { type: string; text?: string }[]).filter((part) => part.type === 'text').slice(1);
    try {
      await request('initialize', { protocolVersion: DEFAULT_PROTOCOL_VERSION });
      await vi.waitFor(() => expect(existsSync(checked)).toBe(true), { timeout: 5000, interval: 20 });
      const first = await renderCall();
      expect((first.result!.structuredContent as any).ok).toBe(true);
      expect(existsSync(release)).toBe(false); // A render finishes while the version command still waits.
      writeFileSync(release, '');
      let notice: RpcResponse | undefined;
      await vi.waitFor(async () => {
        const reply = await renderCall();
        if (notices(reply).length) notice = reply;
        expect(notice).toBeDefined();
      }, { timeout: 3000, interval: 20 });
      expect(notices(notice!)).toEqual([{ type: 'text', text: expect.stringContaining(`MCP engine ${BOARDPLOT_VERSION}`) }]);
      expect(notices(notice!)[0]!.text).toContain('99.0.0');
      expect(notices(notice!)[0]!.text).toContain('restart');
      expect(notices(await renderCall())).toEqual([]);
      expect(readFileSync(checked, 'utf8')).toBe('--version\n');
      expect(stderr).toBe('');
    } finally {
      child.kill();
      lines.close();
      await new Promise<void>((done) => child.once('close', () => done()));
    }
  });

  // After a plugin update the running server kept answering as the old version: the host installs the new plugin in a
  // folder beside the old one, or replaces the package in place, and the server never said it needed a restart.
  it('names a newer plugin on disk and asks for a restart', () => {
    const cache = mkdtempSync(join(tmpdir(), 'boardplot-mcp-plugin-cache-'));
    dirs.push(cache);
    const install = (folder: string, version: string, build?: string) => {
      const runtime = join(cache, folder, 'runtime');
      mkdirSync(join(runtime, 'dist', 'mcp'), { recursive: true });
      writeFileSync(join(runtime, 'dist', 'mcp', 'server.js'), '');
      writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: 'boardplot', version }));
      if (build) writeFileSync(join(runtime, 'dist', 'build-identity.json'), JSON.stringify({ version: build }));
      return join(runtime, 'dist', 'mcp', 'server.js');
    };
    const running = { build: '0.50.1-engine.1.git.gaaaa', api: '0.50.1' };
    const entry = install('0.50.1-claude.aaaa', '0.50.1', running.build);
    install('0.49.0-claude.cccc', '0.49.0');
    expect(pluginUpdateNotice(entry, running)).toBeUndefined();
    install('0.52.3-claude.bbbb', '0.52.3');
    expect(pluginUpdateNotice(entry, running)).toMatch(/^Boardplot 0\.52\.3 is installed at .*0\.52\.3-claude\.bbbb.*still runs 0\.50\.1-engine.*Restart the MCP server/);
    // An update in place: the server's own folder now holds another build.
    const inPlace = install('only', '0.52.3', '0.52.3-engine.2.git.gbbbb');
    expect(pluginUpdateNotice(inPlace, running)).toContain('Boardplot 0.52.3-engine.2.git.gbbbb is installed');
  });

  // A local install between releases keeps the API version and gets a new content-hashed plugin folder; the hint
  // stayed silent. An older folder left in the cache must not ask for a restart.
  it('names another build of the same version that a restart loads, and ignores older folders', () => {
    const plugins = mkdtempSync(join(tmpdir(), 'boardplot-mcp-plugins-'));
    dirs.push(plugins);
    const cache = join(plugins, 'cache', 'market', 'boardplot');
    const install = (folder: string, build: string, at: number) => {
      const runtime = join(cache, folder, 'runtime');
      mkdirSync(join(runtime, 'dist', 'mcp'), { recursive: true });
      writeFileSync(join(runtime, 'dist', 'mcp', 'server.js'), '');
      writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: 'boardplot', version: '0.52.3' }));
      writeFileSync(join(runtime, 'dist', 'build-identity.json'), JSON.stringify({ version: build }));
      utimesSync(join(cache, folder), at, at);
      return join(runtime, 'dist', 'mcp', 'server.js');
    };
    const running = { build: '0.52.3-engine.2.git.gbbbb', api: '0.52.3' };
    install('0.52.3-claude.aaaa', '0.52.3-engine.1.git.gaaaa', 1_000);
    const entry = install('0.52.3-claude.bbbb', running.build, 2_000);
    // No host record: the older folder is a leftover.
    expect(pluginUpdateNotice(entry, running)).toBeUndefined();
    install('0.52.3-claude.cccc', '0.52.3-engine.3.git.gcccc', 3_000);
    expect(pluginUpdateNotice(entry, running)).toMatch(/^Boardplot 0\.52\.3-engine\.3\.git\.gcccc is installed at .*0\.52\.3-claude\.cccc.*Restart the MCP server/);
    // The host's record decides: it still names the running folder, or it names the older build.
    const record = (folder: string) => writeFileSync(join(plugins, 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'boardplot@market': [{ scope: 'user', installPath: join(cache, folder) }] } }));
    record('0.52.3-claude.bbbb');
    expect(pluginUpdateNotice(entry, running)).toBeUndefined();
    record('0.52.3-claude.aaaa');
    expect(pluginUpdateNotice(entry, running)).toContain('Boardplot 0.52.3-engine.1.git.gaaaa is installed');
  });

  it('reports the shared package version during initialization', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'boardplot-mcp-version-test-'));
    dirs.push(cwd);
    const [response] = runEnvelope(
      [
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: DEFAULT_PROTOCOL_VERSION },
        }),
      ],
      cwd,
    );
    expect(response?.result?.serverInfo).toEqual({
      name: 'boardplot',
      version: BOARDPLOT_VERSION,
    });
  });

  it('names the build in every tool result, as boardplot --version prints it', () => {
    const column = body(callTool('boardplot_describe', { type: 'column' })).example;
    for (const [name, args] of [
      ['boardplot_list', {}], ['boardplot_describe', { type: 'column' }], ['boardplot_render', { spec: column }],
      ['boardplot_measure', { spec: column }], ['boardplot_fixtures', { type: 'pie' }], ['boardplot_render', { spec: { type: 'radar', data: {} } }],
    ] as const) {
      const result = body(callTool(name, args));
      expect(result.version, name).toBe(BOARDPLOT_VERSION);
      expect(result.engineRev, name).toBe(ENGINE_REV);
    }
    expect(body(callTool('boardplot_list', {})).engine).toBe(API_VERSION);
  });

  it('publishes the native absolute-path grammar for output directories', () => {
    const pattern = new RegExp(ABSOLUTE_OUT_DIR_PATTERN);
    if (process.platform === 'win32') {
      expect(pattern.test('C:\\charts')).toBe(true);
      expect(pattern.test('/tmp/charts')).toBe(false);
    } else {
      expect(pattern.test('/tmp/charts')).toBe(true);
      expect(pattern.test('C:\\charts')).toBe(false);
    }
    const renderTool = tools().find((tool) => tool.name === 'boardplot_render')!;
    expect(renderTool.inputSchema.properties?.outDir?.pattern).toBe(ABSOLUTE_OUT_DIR_PATTERN);
  });

  it('lists exactly six tools, each with a title, an output schema and the annotations', () => {
    const [, listed] = runEnvelope([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    ], ROOT);
    const listedTools = (listed!.result!.tools as ToolDefinition[]);
    expect(listedTools.map((tool) => tool.name)).toEqual([
      'boardplot_list', 'boardplot_describe', 'boardplot_render', 'boardplot_measure', 'boardplot_fixtures', 'boardplot_feedback',
    ]);
    for (const tool of listedTools) {
      expect(tool.title, tool.name).toMatch(/\S/);
      expect(tool.outputSchema, tool.name).toMatchObject({ type: 'object' });
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: tool.name !== 'boardplot_render', idempotentHint: tool.name !== 'boardplot_render', openWorldHint: false,
      });
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
    expect(listedTools.find((tool) => tool.name === 'boardplot_render')!.annotations.destructiveHint).toBe(true);
    const describeTool = listedTools.find((tool) => tool.name === 'boardplot_describe')!;
    const accepted = describeTool.inputSchema.properties?.type?.enum as string[];
    expect(accepted).toHaveLength(listCharts().length + 1 + listCharts().reduce((count, chart) => count + chart.aliases.length, 0));
    for (const name of ['theme', 'waterfall', 'bridge', 'doughnut', 'bubble']) expect(accepted).toContain(name);
  });

  // Typed clients need the returned reading fields and active fonts to inspect the chart without guessing hidden output keys.
  it('declares every key a tool returns in its output schema', async () => {
    const definitions = new Map(tools().map((tool) => [tool.name, tool.outputSchema.properties as Record<string, any>]));
    await loadFontReader();
    const cwd = mkdtempSync(join(tmpdir(), 'boardplot-mcp-output-schema-'));
    dirs.push(cwd);
    const fontFile = join(cwd, 'fonts.json');
    writeFileSync(fontFile, serializeFontTables(buildFontTables(join(ROOT, 'tests/fixtures/fonts')).tables));
    const example = (callTool('boardplot_describe', { type: 'waterfall' }).structuredContent as { example: object }).example;
    const column = (callTool('boardplot_describe', { type: 'column' }).structuredContent as { example: object }).example;
    const calls: [string, unknown][] = [
      ['boardplot_list', {}], ['boardplot_fixtures', {}], ['boardplot_fixtures', { type: 'waterfall' }],
      ['boardplot_describe', { type: 'theme' }], ['boardplot_describe', { type: 'theme', detail: 'full' }],
      ...listCharts().flatMap((chart): [string, unknown][] => [['boardplot_describe', { type: chart.type }], ['boardplot_describe', { type: chart.type, detail: 'full' }]]),
      ['boardplot_render', { spec: example, return: ['svg', 'reading'] }], ['boardplot_render', { spec: { version: 1, charts: [{ name: 'a', ...example }] } }],
      ['boardplot_render', { spec: { type: 'radar', data: {} } }],
      ['boardplot_measure', { spec: column }], ['boardplot_measure', { spec: { version: 1, charts: [{ name: 'a', ...example }] } }],
    ];
    const previousFonts = process.env.BOARDPLOT_FONT_TABLES;
    process.env.BOARDPLOT_FONT_TABLES = fontFile;
    try {
      const undeclared = calls.flatMap(([name, args]) => {
        const body = callTool(name, args).structuredContent as Record<string, any>;
        const declared = definitions.get(name)!;
        const missing = Object.keys(body).filter((key) => !(key in declared)).map((key) => `${name}.${key}`);
        const readings = body.charts ? body.charts.map((chart: any) => chart.reading) : [body.reading];
        if (name === 'boardplot_render') for (const reading of readings) {
          for (const key of Object.keys(reading ?? {})) {
            if (!(key in declared.reading.properties)) missing.push(`${name}.reading.${key}`);
          }
        }
        expect(body.fontTables).toMatchObject({ families: expect.any(Array), faces: expect.any(Number) });
        if (declared.fontTables) {
          for (const key of Object.keys(body.fontTables)) {
            if (!(key in declared.fontTables.properties)) missing.push(`${name}.fontTables.${key}`);
          }
        }
        return missing;
      });
      expect([...new Set(undeclared)]).toEqual([]);
    } finally {
      if (previousFonts === undefined) delete process.env.BOARDPLOT_FONT_TABLES;
      else process.env.BOARDPLOT_FONT_TABLES = previousFonts;
    }
  });

  it('rejects malformed envelopes without killing the spawned server', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'boardplot-mcp-envelope-test-'));
    dirs.push(cwd);
    const responses = runEnvelope(
      ['null', JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping' })],
      cwd,
    );
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: expect.stringContaining('Invalid Request') },
    });
    expect(responses[1]).toEqual({ jsonrpc: '2.0', id: 99, result: {} });
  });

  it('does not dispatch notification-shaped tool calls', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'boardplot-mcp-notification-test-'));
    dirs.push(cwd);
    const before = readdirSync(cwd);
    const responses = runEnvelope(
      [
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'boardplot_render', arguments: { spec: SPEC, outDir: join(cwd, 'notification-output') } },
        }),
        JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping' }),
      ],
      cwd,
    );
    expect(responses).toEqual([{ jsonrpc: '2.0', id: 99, result: {} }]);
    expect(readdirSync(cwd)).toEqual(before);
  });

  it('makes every declared required key and additionalProperties false load-bearing', () => {
    const validByTool: Record<string, Record<string, unknown>> = {
      boardplot_list: {},
      boardplot_describe: { type: 'column' },
      boardplot_render: { spec: SPEC },
      boardplot_measure: { spec: SPEC },
      boardplot_fixtures: {},
      boardplot_feedback: { category: 'bug', summary: 'Labels vanish at narrow widths.' },
    };
    for (const tool of tools()) {
      const valid = validByTool[tool.name]!;
      for (const required of tool.inputSchema.required ?? []) {
        const args = { ...valid };
        delete args[required];
        const response = callTool(tool.name, args);
        expect(response.isError, `${tool.name}.${required}`).toBe(true);
        expect(body(response).errors[0], `${tool.name}.${required}`).toMatchObject({
          code: 'invalid-argument', path: `/${required}`, received: { type: 'missing' },
        });
      }
      const response = callTool(tool.name, { ...valid, unexpected: true });
      expect(response.isError, `${tool.name}.unexpected`).toBe(true);
      expect(body(response).errors[0], `${tool.name}.unexpected`).toMatchObject({
        code: 'invalid-argument', path: '/unexpected', fix: [{ op: 'remove', path: '/unexpected' }],
      });
      expect(callTool(tool.name, valid).isError, tool.name).toBeUndefined();
    }
  });

  // A spec serialized by an MCP host must render or measure while invalid strings keep their refusal.
  it('parses an object spec from a JSON string for render and measure', () => {
    const drawn = body(callTool('boardplot_render', { spec: SPEC }));
    expect(drawn.ok).toBe(true);
    expect(drawn.size).toEqual({ width: expect.any(Number), height: expect.any(Number) });
    expect(drawn.reading.series).toEqual(['s']);
    expect(drawn.svg).toBeUndefined();

    for (const name of ['boardplot_render', 'boardplot_measure']) {
      const parsed = body(callTool(name, { spec: JSON.stringify(SPEC) }));
      expect(parsed.ok).toBe(true);
      expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: 'spec-parsed-from-string', severity: 'info', fix: [{ op: 'replace', path: '/spec', value: SPEC }] }));
      for (const spec of ['not json', '[]', 'null', '5', 'true', '"text"']) {
        const refused = callTool(name, { spec });
        expect(refused.isError).toBe(true);
        expect(body(refused).errors[0]).toMatchObject({ code: 'spec-must-be-object', message: 'pass the spec as a JSON object, not a string' });
      }
    }
  });

  // Explicit SVG requests need the drawing, while omitted format and file output retain their response contract.
  it('returns an explicit SVG format and folds enum arguments without applying listing defaults', () => {
    const ordinary = body(callTool('boardplot_render', { spec: SPEC }));
    expect(ordinary.svg).toBeUndefined();
    expect(ordinary.warnings.some((warning: any) => warning.code === 'svg-returned')).toBe(false);
    const explicit = body(callTool('boardplot_render', { spec: SPEC, format: 'svg' }));
    expect(explicit.svg).toContain('<svg');
    expect(explicit.reading).toEqual(ordinary.reading);
    expect(explicit.warnings).toContainEqual(expect.objectContaining({ code: 'svg-returned', severity: 'info' }));
    const cased = body(callTool('boardplot_render', { spec: SPEC, format: 'SVG', target: 'Report', background: 'Transparent', return: ['SVG', 'Reading'] }));
    expect(cased.ok).toBe(true);
    expect(cased.svg).toContain('<svg');
    expect(cased.warnings.filter((warning: any) => warning.code === 'input-converted').map((warning: any) => warning.path)).toEqual(['/format', '/target', '/background', '/return/0', '/return/1']);
    expect(cased.warnings.some((warning: any) => warning.code === 'svg-returned')).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'boardplot-svg-output-'));
    dirs.push(dir);
    const saved = body(callTool('boardplot_render', { spec: SPEC, format: 'svg', outDir: dir }));
    expect(saved.ok).toBe(true);
    expect(saved.svg).toBeUndefined();
    expect(saved.outputs).toHaveLength(1);
    expect(saved.warnings.some((warning: any) => warning.code === 'svg-returned')).toBe(false);
    expect(body(callTool('boardplot_describe', { type: 'Column' })).type).toBe('column');
    expect(body(callTool('boardplot_fixtures', { type: 'CoLumn' })).fixtures.length).toBeGreaterThan(0);
  });

  it('returns an invalid enum in the 2.5 shape, fix included, pointing into the bare spec', () => {
    const result = callTool('boardplot_render', { spec: { ...SPEC, options: { ...SPEC.options, labelDensity: 'sparse' } } });
    expect(result.isError).toBe(true);
    const [error] = body(result).errors;
    expect(error).toMatchObject({
      code: 'invalid-options',
      path: '/options/labelDensity',
      message: 'options.labelDensity: labelDensity accepts one of full, smart, minimal',
      expected: { values: ['full', 'smart', 'minimal'] },
      received: { type: 'string', value: 'sparse' },
      fix: [
        { op: 'test', path: '/options/labelDensity', value: 'sparse' },
        { op: 'replace', path: '/options/labelDensity', value: 'smart' },
      ],
      docs: 'docs/reference/column.md#options',
    });
    expect(error.suggest).toMatch(/\.$/);
  });

  it('writes files only into outDir, and answers an envelope per chart', () => {
    const out = mkdtempSync(join(tmpdir(), 'boardplot-mcp-test-'));
    dirs.push(out);
    const bare = body(callTool('boardplot_render', { spec: SPEC, outDir: out, return: ['svg', 'reading'] }));
    expect(bare.outputs).toEqual([join(out, 'chart.svg')]);
    expect(readFileSync(join(out, 'chart.svg'), 'utf8')).toBe(bare.svg);
    const batch = body(callTool('boardplot_render', { spec: ENVELOPE, outDir: out, return: ['svg'] }));
    expect(batch.charts).toHaveLength(1);
    expect(batch.charts[0]).toMatchObject({ name: 't', svg: bare.svg });
    expect(batch.charts[0].reading).toBeUndefined();
    expect(readdirSync(out).sort()).toEqual(['chart.svg', 't.svg']);
  });

  it('never replaces a file already in outDir: the new chart gets a suffix', () => {
    const out = mkdtempSync(join(tmpdir(), 'boardplot-mcp-keep-'));
    dirs.push(out);
    writeFileSync(join(out, 'chart.svg'), 'the user\'s own file');
    writeFileSync(join(out, 'CHART-2.svg'), 'another one');
    const drawn = body(callTool('boardplot_render', { spec: SPEC, outDir: out, return: ['svg'] }));
    expect(drawn.outputs).toEqual([join(out, 'chart-3.svg')]);
    expect(readFileSync(join(out, 'chart.svg'), 'utf8')).toBe('the user\'s own file');
    expect(readFileSync(join(out, 'CHART-2.svg'), 'utf8')).toBe('another one');
    expect(readFileSync(join(out, 'chart-3.svg'), 'utf8')).toBe(drawn.svg);
  });

  // An agent must not create or replace files outside the allowed folders through outDir, also not through a symlinked folder.
  it('writes outDir only under the client roots, the working directory, the temp folder and BOARDPLOT_ROWS_ROOTS', () => {
    const outside = mkdtempSync(join(tmpdir(), 'boardplot-mcp-out-'));
    dirs.push(outside);
    const temp = join(outside, 'tmp');
    mkdirSync(temp);
    const victim = join(outside, 'victim.svg');
    writeFileSync(victim, 'the user\'s own file');
    symlinkSync(outside, join(temp, 'linked'));
    const env = { TMPDIR: process.env.TMPDIR, BOARDPLOT_ROWS_ROOTS: process.env.BOARDPLOT_ROWS_ROOTS };
    try {
      process.env.TMPDIR = temp;
      delete process.env.BOARDPLOT_ROWS_ROOTS;
      for (const outDir of [victim, join(temp, 'linked', 'victim.svg'), join(outside, 'new')]) {
        expect(body(callTool('boardplot_render', { spec: SPEC, outDir, overwrite: true })).errors[0]).toMatchObject({ code: 'out-outside-roots', path: '/outDir' });
      }
      expect([readFileSync(victim, 'utf8'), existsSync(join(outside, 'new'))]).toEqual(['the user\'s own file', false]);
      expect(body(callTool('boardplot_render', { spec: SPEC, outDir: join(temp, 'charts') })).outputs).toEqual([join(temp, 'charts', 'chart.svg')]);
    } finally {
      for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('render returns the reading of the drawn chart, and an alias reads the same numbers', () => {
    const waterfall = body(callTool('boardplot_fixtures', { type: 'waterfall' })).fixtures[0].spec;
    const { reading } = body(callTool('boardplot_render', { spec: waterfall }));
    expect(reading.derived.length).toBeGreaterThan(0);
    expect(reading.derived.every((entry: { value: number | null; state: string }) =>
      entry.state === 'value' ? typeof entry.value === 'number' : entry.value === null)).toBe(true);
    expect(reading.labelsPlaced + reading.labelsDropped).toBeGreaterThan(0);
    const aliased = body(callTool('boardplot_render', { spec: { ...waterfall, type: 'bridge' } })).reading;
    expect(aliased.type).toBe('waterfall');
    expect(aliased.derived).toEqual(reading.derived);
  });

  it('draws rows from a local CSV file, a share written as a fraction printing as percent, and reads back their count and hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'boardplot-mcp-rows-'));
    dirs.push(dir);
    const csv = 'region,channel,share\nNorth,Online,0.505\nNorth,Retail,0.495\n';
    writeFileSync(join(dir, 'share.csv'), csv);
    const result = body(callTool('boardplot_render', {
      spec: { type: 'column', options: { title: 'Online holds half of North' } },
      rowsFile: join(dir, 'share.csv'),
      columns: { category: 'region', series: 'channel', value: 'share', valueKind: 'fraction' },
      return: ['svg', 'reading'],
    }));
    expect([result.svg.includes('>50.5%<'), result.reading.data]).toEqual([true, expect.objectContaining({ rows: 2, sha256: createHash('sha256').update(csv).digest('hex') })]);
  });

  // An agent must not read cells from any local file (credentials) through rowsFile, also not through a symlink.
  it('reads rowsFile only under the client roots, the working directory, the temp folder and BOARDPLOT_ROWS_ROOTS', () => {
    const outside = mkdtempSync(join(tmpdir(), 'boardplot-mcp-outside-'));
    dirs.push(outside);
    const temp = join(outside, 'tmp');
    mkdirSync(temp);
    writeFileSync(join(outside, 'creds.csv'), 'User,Access key ID,Secret access key,Password\nalice,FAKEAKIDALICE,FAKESECRET,FAKEPASS\n');
    symlinkSync(join(outside, 'creds.csv'), join(temp, 'creds.csv'));
    const columns = { category: 'Secret access key', series: 'Password', value: 'Access key ID' };
    const env = { TMPDIR: process.env.TMPDIR, BOARDPLOT_ROWS_ROOTS: process.env.BOARDPLOT_ROWS_ROOTS };
    const draw = (rowsFile: string) => body(callTool('boardplot_render', { spec: { type: 'column' }, rowsFile, columns }));
    try {
      process.env.TMPDIR = temp;
      delete process.env.BOARDPLOT_ROWS_ROOTS;
      for (const path of [join(outside, 'creds.csv'), join(temp, 'creds.csv')]) {
        const refused = draw(path);
        expect(refused.errors[0]).toMatchObject({ code: 'rows-outside-roots', path: '/rowsFile', suggest: expect.stringContaining('BOARDPLOT_ROWS_ROOTS') });
        expect(JSON.stringify(refused)).not.toContain('FAKEAKIDALICE');
      }
      process.env.BOARDPLOT_ROWS_ROOTS = outside;
      expect(draw(join(outside, 'creds.csv')).errors[0].code).not.toBe('rows-outside-roots');
      delete process.env.BOARDPLOT_ROWS_ROOTS;
      // Over stdio, a client that declares roots is asked for them, and a file under one is read.
      const lines = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: DEFAULT_PROTOCOL_VERSION, capabilities: { roots: {} } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'boardplot-roots-1', result: { roots: [{ uri: pathToFileURL(outside).href }] } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'boardplot_render', arguments: { spec: { type: 'column' }, rowsFile: join(outside, 'creds.csv'), columns } } },
      ].map((line) => JSON.stringify(line));
      const [, ask, call] = runEnvelope(lines, temp) as unknown as [RpcResponse, { method: string }, RpcResponse];
      expect(ask.method).toBe('roots/list');
      expect((call.result!.structuredContent as { errors: { code: string }[] }).errors[0]!.code).not.toBe('rows-outside-roots');
    } finally {
      for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  // A root the client just revoked must not admit a rowsFile while the server waits for the new roots.
  it('waits for the roots refresh after roots/list_changed, so a revoked root refuses', () => {
    const outside = mkdtempSync(join(tmpdir(), 'boardplot-mcp-revoked-'));
    dirs.push(outside);
    const temp = join(outside, 'tmp');
    mkdirSync(temp);
    writeFileSync(join(outside, 'creds.csv'), 'User,Access key ID,Secret access key,Password\nalice,FAKEAKIDALICE,FAKESECRET,FAKEPASS\n');
    const env = { TMPDIR: process.env.TMPDIR, BOARDPLOT_ROWS_ROOTS: process.env.BOARDPLOT_ROWS_ROOTS };
    try {
      process.env.TMPDIR = temp;
      delete process.env.BOARDPLOT_ROWS_ROOTS;
      const lines = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: DEFAULT_PROTOCOL_VERSION, capabilities: { roots: { listChanged: true } } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'boardplot-roots-1', result: { roots: [{ uri: pathToFileURL(outside).href }] } },
        { jsonrpc: '2.0', method: 'notifications/roots/list_changed' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'boardplot_render', arguments: { spec: { type: 'column' }, rowsFile: join(outside, 'creds.csv'), columns: { category: 'Secret access key', series: 'Password', value: 'Access key ID' } } } },
        { jsonrpc: '2.0', id: 'boardplot-roots-2', result: { roots: [] } },
      ].map((line) => JSON.stringify(line));
      const responses = runEnvelope(lines, temp);
      const call = responses.find((response) => response.id === 2)!;
      expect((call.result!.structuredContent as { errors: { code: string }[] }).errors[0]!.code).toBe('rows-outside-roots');
    } finally {
      for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('counts only numeric records as plain numbers, and keeps the value notes short', () => {
    const status = body(callTool('boardplot_fixtures', { type: 'status', kind: 'all' })).fixtures[0].spec;
    const { reading } = body(callTool('boardplot_render', { spec: status }));
    expect(reading.values.total).toBeGreaterThan(100);
    expect(reading.values.byKind).toEqual({ text: reading.values.total });
    expect(reading.values.numbers).toBe(0);
    expect(reading.values.summary[0]).toContain('0 of them a plain number');
    expect(reading.values.withoutNumber.length).toBeLessThanOrEqual(10);
  });

  it.skipIf(!availableRasterizer())('returns a PNG as an image block next to the JSON', () => {
    const out = mkdtempSync(join(tmpdir(), 'boardplot-mcp-png-'));
    dirs.push(out);
    const result = callTool('boardplot_render', { spec: SPEC, format: 'png', scale: 1, outDir: out });
    expect(result.isError).toBeUndefined();
    const images = result.content.filter((part) => part.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    const bytes = readFileSync(join(out, 'chart.png'));
    expect(Buffer.from((images[0] as { data: string }).data, 'base64').equals(bytes)).toBe(true);
    expect(pngSize(bytes)).toEqual(body(result).size);
    expect(body(result).svg).toBeUndefined();
  }, 60_000);

  it('names a width argument, not /options/size, when that argument makes the chart too small', () => {
    const [error] = body(callTool('boardplot_render', { spec: SPEC, width: 100 })).errors;
    expect(error).toMatchObject({ code: 'size-below-floor', path: '/width', fix: [{ op: 'replace', path: '/width', value: 120 }] });
    expect(body(callTool('boardplot_render', { spec: SPEC, width: 120 })).ok).toBe(true);
  });

  it('carries the warnings of a full theme object into the render result', () => {
    const theme = { ...structuredClone(themes.standard), name: 'probe-highlight', color: { ...themes.standard!.color, series: ['#FEFEFE', '#336699', '#663399'] } };
    const drawn = body(callTool('boardplot_render', { spec: { ...SPEC, theme } }));
    expect(drawn.ok).toBe(true);
    expect(drawn.warnings).toContainEqual(expect.objectContaining({ code: 'series-invisible', path: '/theme' }));
  });

  it('reports the lints of one theme once per session, chart warnings every time, and a changed theme again', () => {
    const stacked = { ...SPEC, data: { ...SPEC.data, series: [{ id: 's', label: 'Share %', values: [1, 2] }, { id: 't', label: 'Rate %', values: [3, 2] }] }, options: { ...SPEC.options, variant: 'stacked' } };
    const theme = { ...structuredClone(themes.standard), name: 'probe-once', color: { ...themes.standard!.color, series: ['#FDFDFD', '#336699', '#663399'] } };
    const codes = (spec: unknown) => (body(callTool('boardplot_render', { spec })).warnings as { code: string; path: string }[])
      .map((warning) => `${warning.path.endsWith('/theme') ? 'theme' : 'chart'}:${warning.code}`);
    const first = codes({ ...stacked, theme });
    expect(first).toContain('theme:series-invisible');
    expect(first).toContain('chart:non-additive-stack');
    const second = codes({ ...stacked, theme: structuredClone(theme) });
    expect(second.filter((code) => code.startsWith('theme:'))).toEqual([]);
    expect(second).toContain('chart:non-additive-stack');
    expect(codes({ ...stacked, theme: { ...theme, name: 'probe-once-2' } })).toContain('theme:series-invisible');
    // The same theme with its keys in another order, and placed on a chart of an envelope, is the same theme.
    const reordered = Object.fromEntries(Object.entries(theme).reverse());
    expect(codes({ ...stacked, theme: reordered }).filter((code) => code.startsWith('theme:'))).toEqual([]);
    const enveloped = { version: 1, charts: [{ name: 'c', ...stacked, options: { ...stacked.options, theme } }] };
    expect(codes(enveloped).filter((code) => code.startsWith('theme:'))).toEqual([]);
    // The CLI verb keeps every lint on every call.
    for (let call = 0; call < 2; call++) {
      expect((render({ spec: { ...stacked, theme } }).body as { warnings: { path: string }[] }).warnings.some((warning) => warning.path === '/theme')).toBe(true);
    }
  });

  // The once-per-session rule for design advice hid a chart's own empty band from every chart after the first.
  it('returns a chart-specific advice with every chart that has it', () => {
    for (const id of ['row-scale-ragged-zero', 'attainment-shading']) {
      const spec = body(callTool('boardplot_fixtures', { type: 'bullet', id })).fixtures[0].spec;
      expect(body(callTool('boardplot_render', { spec })).warnings.map((warning: { code: string }) => warning.code), id).toContain('dead-band');
    }
  });

  it('keeps list and describe theme byte-identical after rendering custom themes, and bounds what it keeps', () => {
    const listBefore = callTool('boardplot_list', {}).text;
    const themeBefore = callTool('boardplot_describe', { type: 'theme' }).text;
    for (let index = 0; index < ADOPTED_THEME_LIMIT + 6; index++) {
      const theme = { ...structuredClone(themes.standard), name: `tenant-${index}`, color: { ...themes.standard!.color, highlight: `#10${String(index).padStart(2, '0')}9E` } };
      expect(body(callTool('boardplot_render', { spec: { ...SPEC, theme } })).ok).toBe(true);
    }
    expect(callTool('boardplot_list', {}).text).toBe(listBefore);
    expect(callTool('boardplot_describe', { type: 'theme' }).text).toBe(themeBefore);
    expect(adoptedThemeCount()).toBeLessThanOrEqual(ADOPTED_THEME_LIMIT);
  });

  it('asks for the type when two types share a fixture id', () => {
    const shared = body(callTool('boardplot_fixtures', { id: 'topn-others' }));
    expect(shared.errors[0]).toMatchObject({ code: 'ambiguous-fixture', path: '/type', expected: { values: ['bar', 'mekko'] } });
    expect(body(callTool('boardplot_fixtures', { id: 'topn-others', type: 'mekko' })).fixtures).toHaveLength(1);
  });

  it('measures a spec and names the pixels a refused size needs', () => {
    const measured = body(callTool('boardplot_measure', { spec: SPEC, width: 800 }));
    expect(measured).toMatchObject({ ok: true, fit: 'fill', refused: null, titleLines: 1 });
    expect(measured.naturalWidth).toBeGreaterThanOrEqual(measured.minWidth);
    const small = body(callTool('boardplot_measure', { spec: { ...SPEC, options: { ...SPEC.options, size: { width: 100, height: 120 } } } }));
    // Below the full floor the chart falls back to compact, so the refusal names the compact size: the 120 px a column's bars need.
    expect(small.refused).toMatchObject({ code: 'size-below-floor', required: { width: 120 } });
  });

  it('describes an alias that boardplot_list advertises, as the CLI does', () => {
    for (const [alias, type] of [['bridge', 'waterfall'], ['doughnut', 'pie'], ['bubble', 'scatter']]) {
      const described = callTool('boardplot_describe', { type: alias! });
      expect(described.isError, alias).toBeUndefined();
      expect(described.text).toBe(callTool('boardplot_describe', { type: type! }).text);
    }
  });

  it('describes a type compactly and the theme contract on request', () => {
    const column = callTool('boardplot_describe', { type: 'column' });
    expect(column.text.length).toBeLessThan(15_000);
    expect(body(column)).toMatchObject({ ok: true, type: 'column', ids: ['column.grouped', 'column.stacked', 'column.stacked100'] });
    expect(body(column).options.variant).toContain('"grouped" | "stacked" | "stacked100"');
    const theme = body(callTool('boardplot_describe', { type: 'theme' }));
    expect(theme.presets).toContain('notation');
    expect(theme.tokens['color.highlight']).toMatch(/^string, required/);
    expect(body(callTool('boardplot_describe', { type: 'theme', detail: 'full' })).tokens[0]).toMatchObject({ path: 'name' });
  });

  it('returns example fixtures by default, pages at 25 and finds one fixture by id', () => {
    const page = body(callTool('boardplot_fixtures', {}));
    expect(page.fixtures).toHaveLength(25);
    expect(page.fixtures.every((fixture: { kind: string }) => fixture.kind === 'example')).toBe(true);
    expect(page.nextCursor).toBe('25');
    expect(page.note).toContain('narrow with type or kind');
    const next = body(callTool('boardplot_fixtures', { cursor: page.nextCursor }));
    expect(next.fixtures[0].id).not.toBe(page.fixtures[0].id);
    const torture = body(callTool('boardplot_fixtures', { type: 'column', kind: 'torture' }));
    expect(torture.fixtures.every((fixture: { kind: string }) => fixture.kind === 'torture')).toBe(true);
    const one = body(callTool('boardplot_fixtures', { id: torture.fixtures[0].id }));
    expect(one.fixtures).toHaveLength(1);
    expect(Object.keys(one.fixtures[0].spec)).not.toContain('name');
    expect(body(callTool('boardplot_render', { spec: one.fixtures[0].spec })).ok).toBe(true);
  });
  it('reports a rejected spec as a failed call, with errors and warnings', () => {
    const bad = callTool('boardplot_render', { spec: { type: 'column', data: {} } });
    expect(bad.isError).toBe(true);
    expect(Object.keys(body(bad))).toEqual(['ok', 'errors', 'warnings', 'engineRev', 'version']);
    expect(body(bad).ok).toBe(false);
    const good = callTool('boardplot_render', { spec: SPEC });
    expect(body(good).ok).toBe(true);
    expect(good.isError).toBeUndefined();
  });

  it('leaves no temp workspace behind, including when the call fails', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'boardplot-mcp-tmp-test-'));
    dirs.push(scratch);
    const original = process.env.TMPDIR;
    try {
      process.env.TMPDIR = scratch;
      callTool('boardplot_render', { spec: SPEC });
      callTool('boardplot_render', { spec: '{ not json at all' });
      callTool('boardplot_measure', { spec: SPEC });
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = original;
    }
  });
  it('advertises only protocol revisions it implements', () => {
    expect([...SUPPORTED_PROTOCOL_VERSIONS]).toEqual(['2024-11-05', '2025-06-18', '2025-11-25']);
    expect(DEFAULT_PROTOCOL_VERSION).toBe('2025-11-25');
    // Unsupported revisions fall back to the server's own version.
    const responses = runEnvelope(
      [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2999-01-01' } }),
        JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: 42 } }),
        JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'initialize' }),
      ],
      ROOT,
    );
    // A supported request is echoed; anything else falls back to the server's own.
    expect(responses.map((response) => response.result?.protocolVersion)).toEqual([
      '2024-11-05',
      '2025-11-25',
      '2025-11-25',
      '2025-11-25',
    ]);
  });
  it('answers malformed tools/call params instead of guessing a tool name', () => {
    const responses = runEnvelope(
      [
        // the lifecycle gate answers first — tool methods before
        // initialize get -32002, whatever their params look like.
        JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: {} }),
        JSON.stringify({ jsonrpc: '2.0', id: 90, method: 'tools/list' }),
        JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'initialize', params: { protocolVersion: '2024-11-05' } }),
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: null }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: { evil: 1 } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} }),
        JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'ping' }),
      ],
      ROOT,
    );
    expect(responses.map((response) => [response.id, response.error?.code])).toEqual([
      [0, -32002],
      [90, -32002],
      [99, undefined],
      [1, -32602],
      [2, -32602],
      [3, -32602],
      [4, -32601], // a notification method carrying an id is a malformed request, not silence
      [5, undefined],
    ]);
  });
  it('refuses an oversized request line before parsing it ', () => {
    const oversized = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: { pad: 'x'.repeat(10 * 1024 * 1024) },
    });
    const responses = runEnvelope(
      [
        JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '2024-11-05' } }),
        oversized,
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
      ],
      ROOT,
    );
    expect(responses.map((response) => [response.id, response.error?.code])).toEqual([
      [9, undefined],
      [null, -32600],
      [2, undefined],
    ]);
  });
  // The server loaded the 1.9 MB font reader at start, before a client had asked for any PNG.
  it.skipIf(!availableRasterizer())('loads the raster fonts on the first call that draws a PNG, not at start', () => {
    const hook = `data:text/javascript,${encodeURIComponent("import { registerHooks } from 'node:module'; registerHooks({ resolve(specifier, context, next) { if (specifier === 'fontkit') process.stderr.write('fontkit loaded\\n'); return next(specifier, context); } });")}`;
    const out = mkdtempSync(join(tmpdir(), 'boardplot-mcp-lazy-'));
    dirs.push(out);
    const session = (args: Record<string, unknown>) => spawnSync(process.execPath, ['--import', hook, '--import', 'tsx', MCP_SERVER], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 60_000,
      input: `${[
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'boardplot_render', arguments: { spec: SPEC, ...args } } },
      ].map((line) => JSON.stringify(line)).join('\n')}\n`,
    });
    const svg = session({});
    expect(svg.stdout).toContain('"ok":true');
    expect(svg.stderr).not.toContain('fontkit loaded');
    const png = session({ format: 'png', scale: 1, outDir: out });
    expect(png.stderr).toContain('fontkit loaded');
    expect(png.stdout).toContain('"type":"image"');
  }, 120_000);

  // A line with no newline was held whole until it ended, so a client could grow the server's memory without bound.
  it('refuses an oversized line while it is read and drops its rest', async () => {
    const child = spawn(TSX, [MCP_SERVER], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const replies: RpcResponse[] = [];
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => replies.push(JSON.parse(line) as RpcResponse));
    try {
      child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"');
      child.stdin.write(Buffer.alloc(11 * 1024 * 1024, 0x61));
      // The answer comes before the line ends.
      await vi.waitFor(() => expect(replies.map((reply) => reply.error?.code)).toEqual([-32600]), { timeout: 10_000, interval: 20 });
      child.stdin.write(`${'b'.repeat(1024)}"}}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
      // The rest of the refused line is dropped, not parsed as a new line.
      await vi.waitFor(() => expect(replies.map((reply) => [reply.id, reply.error?.code])).toEqual([[null, -32600], [2, undefined]]), { timeout: 10_000, interval: 20 });
    } finally {
      child.kill();
      lines.close();
      await new Promise<void>((done) => child.once('close', () => done()));
    }
  });
});
