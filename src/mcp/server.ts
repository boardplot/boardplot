#!/usr/bin/env node
/**
 * boardplot MCP server: hand-rolled stdio JSON-RPC with no dependency.
 * Six tools call the same verb functions as the CLI, so the
 * same JSON comes out of both doors.
 *
 * Start: `boardplot-mcp` (bin) or `node dist/mcp/server.js`.
 * Protocol: initialize, tools/list, tools/call, ping; it asks a client that
 * declares roots for roots/list, which bounds rowsFile.
 *
 * The stdio line reader supports a bounded request/response lifecycle.
 * Use `@modelcontextprotocol/sdk` if the server adds resources, prompts,
 * sampling, progress, cancellation, elicitation or a non-stdio transport.
 * The current implementation keeps the offline plugin dependency tree small.
 */

import { linkStoryLayer } from '../core/storyLayer';
import { linkAnnotateEngine } from '../core/annotateEngine';
import { linkThemeShapeRules } from '../core/themeShapeRules';
import { registerAllGeoPacks } from '../core/geo/packs';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allFixtures } from '../fixtures';
import { sanitizeObjectPrototype } from '../core/doc/docExpand';
import { API_VERSION, BOARDPLOT_VERSION } from '../version';
import { InputError, rejectedInput, runVerb, type VerbResult } from '../cli/result';
import { assertSpecObject } from '../cli/spec';
import { list } from '../cli/list';
import { describe } from '../cli/describe';
import { fixtures } from '../cli/fixtures';
import { render } from '../cli/render';
import { loadRasterFonts } from '../cli/resvg';
import { measure } from '../cli/measure';
import { feedback } from '../telemetry/feedback';
import { hostFromClient } from '../telemetry/event';
import { mcpNotice, mcpReporter } from '../telemetry/send';
import { fontTablesSummary, requestedFontTables } from '../cli/activeFontTables';
import { readJsonPointer } from '../core/diagnostics/jsonPatch';
import { canonicalJson, sha256 } from '../core/claims';
import { resolveTheme } from '../core/theme';
import type { ThemeRef } from '../core/types/theme';
import {
  DEFAULT_PROTOCOL_VERSION,
  MCP_LIMITS,
  SUPPORTED_PROTOCOL_VERSIONS,
  toolDefinitions,
  toolInputs,
  type InputSchema,
  type ToolDefinition,
} from './tools';

// Linked by value, so this entry resolves a patched theme and lays out
// annotations synchronously (see core/deferred), and draws every geo pack.
linkThemeShapeRules();
linkAnnotateEngine();
linkStoryLayer();
registerAllGeoPacks();

// Keep the fixture catalogue present when this server is bundled separately from the CLI entry.
allFixtures();

export * from './tools';

interface RpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

/**
 * Answer `initialize` with a revision this server implements: echo the client's
 * request when it is on the list, otherwise offer our own newest.
 *
 * `supported` is a parameter so a test can inject a list where the echo
 * branch and the fallback branch return different strings.
 */
export function negotiateProtocolVersion(
  requested: unknown,
  supported: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS,
): string {
  const fallback = supported[supported.length - 1]!;
  return typeof requested === 'string' && supported.includes(requested) ? requested : fallback;
}

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  /** The JSON body as text, the same object as structuredContent. */
  text: string;
  content: McpContent[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

let cachedTools: ToolDefinition[] | undefined;
let cachedInputs: ReturnType<typeof toolInputs> | undefined;
let checkedCliVersion = false;
let cliVersionNotice: string | undefined;
/** Usage counts of this session; sends only after the user turned them on (docs/TELEMETRY.md). */
const usage = mcpReporter();
/** The client's name folded into a host category, from initialize. */
let clientHost: ReturnType<typeof hostFromClient> = 'other';
let telemetryNoticeChecked = false;

/** The command that runs the CLI of this install, so the user's answer needs no download. */
function cliCommand(): string {
  // argv[1] is the server entry (dist/mcp/server.js); import.meta.url can be a shared chunk.
  try {
    const cli = join(dirname(dirname(realpathSync(process.argv[1] ?? ''))), 'cli', 'index.js');
    if (existsSync(cli)) return `node "${cli}"`;
  } catch { /* fall back to the package */ }
  return 'npx boardplot';
}

/** Ignore build metadata; a stable release is newer than its prerelease. */
function newerVersion(candidate: string, current: string): boolean {
  const parseVersion = (version: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let index = 1; index <= 3; index++) {
    if (Number(a[index]) !== Number(b[index])) return Number(a[index]) > Number(b[index]);
  }
  if (a[4] === b[4]) return false;
  if (!a[4] || !b[4]) return !a[4];
  const left = a[4].split('.');
  const right = b[4].split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index];
    const y = right[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return y === undefined;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    return nx && ny ? Number(x) > Number(y) : nx !== ny ? !nx : x > y;
  }
  return false;
}

/** Check once without awaiting it. A missing, broken or slow CLI leaves tool calls alone. */
function checkCliVersion(): void {
  if (checkedCliVersion) return;
  checkedCliVersion = true;
  try {
    execFile('boardplot', ['--version'], { timeout: 1000, maxBuffer: 256, windowsHide: true }, (error, stdout) => {
      if (error) return;
      const version = stdout.trim();
      if (newerVersion(version, BOARDPLOT_VERSION)) {
        cliVersionNotice = `MCP engine ${BOARDPLOT_VERSION} is older than boardplot ${version} on PATH. Update the Boardplot plugin or the package that starts boardplot-mcp to ${version}, then restart the MCP server.`;
      }
    });
  } catch { /* Version discovery never blocks a tool call. */ }
}

/**
 * The restart hint for a server whose code on disk changed under it: an update
 * replaced its own package in place (npm, the local marketplace), or the host
 * installed another plugin build beside it (a plugin cache keeps one folder per
 * version, `<cache>/<version>/runtime`). Such a server keeps answering with the
 * engine it loaded at start until the host restarts it. The hint names the build
 * a restart loads, by its build identity, so an update that keeps the API
 * version (a local install between releases) is named too.
 */
export function pluginUpdateNotice(serverEntry: string, running: { build: string; api: string } = { build: BOARDPLOT_VERSION, api: API_VERSION }): string | undefined {
  const readJson = (path: string): Record<string, unknown> | undefined => {
    try {
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
      return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
  };
  const apiVersionAt = (root: string): string | undefined => {
    const manifest = readJson(join(root, 'package.json'));
    return manifest?.name === 'boardplot' && typeof manifest.version === 'string' ? manifest.version : undefined;
  };
  // A packaged build names itself exactly in dist/build-identity.json. A server run from source has only the API version.
  const packaged = running.build !== running.api;
  const buildAt = (root: string): string | undefined => {
    const identity = packaged ? readJson(join(root, 'dist', 'build-identity.json'))?.version : undefined;
    return typeof identity === 'string' ? identity : apiVersionAt(root);
  };
  const realOrSame = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  // dist/mcp/server.js, or a link to it such as ~/.local/bin/boardplot-mcp. A host that removed
  // the server's own folder on update leaves the path as it was started.
  const packageRoot = dirname(dirname(dirname(realOrSame(serverEntry))));
  const hint = (version: string, where: string) => `Boardplot ${version} is installed at ${where}, but this MCP server still runs ${running.build}. Restart the MCP server, or the app that started it, to load ${version}.`;
  const own = apiVersionAt(packageRoot);
  if (own !== undefined) {
    const identity = packaged ? readJson(join(packageRoot, 'dist', 'build-identity.json'))?.version : undefined;
    const onDisk = typeof identity === 'string' ? identity : own;
    if (onDisk !== (typeof identity === 'string' ? running.build : running.api)) return hint(onDisk, packageRoot);
  }
  if (basename(packageRoot) !== 'runtime') return undefined;
  const pluginRoot = dirname(packageRoot);
  const cacheDir = dirname(pluginRoot);
  // The host's record of the folder it loads: Claude Code keeps installPath in
  // plugins/installed_plugins.json beside plugins/cache/<marketplace>/<plugin>/<version>.
  // A folder the record no longer names is an old copy, whatever its version.
  const records = readJson(join(dirname(dirname(dirname(cacheDir))), 'installed_plugins.json'))?.plugins;
  const recorded = Object.values(records ?? {}).flat().flatMap((entry: unknown) => {
    const path = (entry as { installPath?: unknown } | null)?.installPath;
    if (typeof path !== 'string') return [];
    const root = realOrSame(path);
    return dirname(root) === cacheDir ? [root] : [];
  });
  if (recorded.length > 0) {
    if (recorded.includes(pluginRoot)) return undefined;
    for (const root of recorded) {
      const build = buildAt(join(root, 'runtime'));
      if (build !== undefined && build !== running.build) return hint(build, join(root, 'runtime'));
    }
    return undefined;
  }
  // Codex keeps no install record. Without one, a sibling with a newer API version, or another
  // build installed after the server's own folder, is what a restart loads.
  const installedAt = (root: string): number => {
    try {
      return statSync(root).mtimeMs;
    } catch {
      return -Infinity;
    }
  };
  const ownAt = installedAt(pluginRoot);
  let newest: { api: string; build: string; root: string; at: number } | undefined;
  try {
    for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === basename(pluginRoot)) continue;
      const root = join(cacheDir, entry.name, 'runtime');
      const api = apiVersionAt(root);
      const build = api === undefined ? undefined : buildAt(root);
      if (api === undefined || build === undefined || build === running.build) continue;
      const at = installedAt(join(cacheDir, entry.name));
      const later = newerVersion(api, running.api) || (api === running.api && at > ownAt);
      if (later && (!newest || newerVersion(api, newest.api) || (api === newest.api && at > newest.at))) newest = { api, build, root, at };
    }
  } catch {
    return undefined;
  }
  return newest && hint(newest.build, newest.root);
}

/** The disk is read at most once in this many ms; the hint repeats on every response until a restart. */
const PLUGIN_CHECK_MS = 10_000;
let pluginChecked: { at: number; notice?: string } | undefined;

function currentPluginNotice(): string | undefined {
  const now = Date.now();
  if (pluginChecked === undefined || now - pluginChecked.at >= PLUGIN_CHECK_MS) {
    pluginChecked = { at: now, notice: process.argv[1] ? pluginUpdateNotice(process.argv[1]) : undefined };
  }
  return pluginChecked.notice;
}

/** The six tools, built once per process. */
export function tools(): ToolDefinition[] {
  cachedTools ??= toolDefinitions();
  return cachedTools;
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function describeValue(value: unknown): string {
  const type = valueType(value);
  if (type === 'number' || type === 'boolean' || type === 'null') return `${type} ${String(value)}`;
  const json = JSON.stringify(value);
  if (json === undefined) return type;
  return `${type} ${json.length > 82 ? `${json.slice(0, 78)}...` : json}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface ArgumentFailure {
  segments: (string | number)[];
  expected: Record<string, unknown>;
  received: unknown;
  message: string;
}

function pointer(segments: readonly (string | number)[]): string {
  return segments.map((segment) => `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

/** The declared JSON Schema node at a path of the arguments. */
function schemaAt(schema: InputSchema, segments: readonly (string | number)[]): InputSchema | undefined {
  let node: InputSchema | undefined = schema;
  for (const segment of segments) node = typeof segment === 'number' ? node?.items : node?.properties?.[segment];
  return node;
}

function valueAt(value: unknown, segments: readonly (string | number)[]): unknown {
  return segments.reduce<unknown>((node, segment) => (node as Record<string | number, unknown> | undefined)?.[segment], value);
}

/** The first zod issue of a tool's arguments, in the wording and shape the hand checks used. */
function argumentFailure(args: unknown, tool: ToolDefinition): ArgumentFailure | undefined {
  cachedInputs ??= toolInputs();
  const parsed = cachedInputs[tool.name as keyof typeof cachedInputs].safeParse(args);
  if (parsed.success) return undefined;
  const issue = parsed.error.issues[0]!;
  const segments = issue.path as (string | number)[];
  if (issue.code === 'unrecognized_keys') {
    const key = issue.keys[0]!;
    return {
      segments: [...segments, key], expected: { values: Object.keys(schemaAt(tool.inputSchema, segments)?.properties ?? {}) },
      received: valueAt(args, [...segments, key]), message: `'${key}' is not an argument of this tool`,
    };
  }
  const node = schemaAt(tool.inputSchema, segments);
  const received = valueAt(args, segments);
  if (received === undefined && segments.length) {
    return { segments, expected: { types: [node?.type ?? 'value'] }, received, message: `'${String(segments.at(-1))}' is required` };
  }
  if (issue.code === 'invalid_value' && node?.enum) {
    return { segments, expected: { values: [...node.enum] }, received, message: `expected one of ${node.enum.map((entry) => JSON.stringify(entry)).join(', ')}` };
  }
  if (issue.code === 'invalid_format' && node?.pattern) {
    return { segments, expected: { pattern: node.pattern }, received, message: 'expected an absolute path' };
  }
  if (issue.code === 'too_small') {
    return { segments, expected: { minimum: Number(issue.minimum), inclusive: false }, received, message: `expected a number above ${issue.minimum}` };
  }
  if (issue.code === 'too_big') {
    return { segments, expected: { maximum: Number(issue.maximum) }, received, message: `expected a number at most ${issue.maximum}` };
  }
  const type = node?.type ?? 'value';
  return { segments, expected: { types: [type] }, received, message: `expected ${type}, received ${describeValue(received)}` };
}

/** An argument failure in the 2.5 shape, pointing into the arguments object. */
function invalidArgument(failure: ArgumentFailure): VerbResult {
  const path = pointer(failure.segments);
  const unknown = failure.message.endsWith('is not an argument of this tool');
  return rejectedInput(new InputError('invalid-argument', `argument ${path || '(root)'}: ${failure.message}`, {
    path,
    expected: failure.expected,
    received: failure.received === undefined ? { type: 'missing' } : { type: valueType(failure.received), value: failure.received },
    suggest: unknown ? `Remove '${String(failure.segments.at(-1))}'.` : 'Send the argument in the type the tool declares.',
    ...(unknown ? { fix: [{ op: 'remove' as const, path }] } : {}),
  }));
}

function unknownTool(name: string): VerbResult {
  return rejectedInput(new InputError('unknown-tool', `unknown tool '${name}'`, {
    expected: { values: tools().map((tool) => tool.name) },
    suggest: 'Call one of the tools that tools/list returns.',
  }));
}

/** The folders the client named through MCP roots; empty until it answers roots/list. */
let clientRoots: string[] = [];
/** How long a tools/call waits for the client's roots/list answer before it reads without client roots. */
const ROOTS_TIMEOUT_MS = 5_000;

const realOrUndefined = (path: string): string | undefined => { try { return realpathSync(path); } catch { return undefined; } };

/**
 * The folders rowsFile may read from and outDir may write to over MCP: the
 * client's roots, the working directory (not a filesystem root, as some hosts
 * start servers in /), the temp folder and BOARDPLOT_ROWS_ROOTS. The CLI reads
 * and writes any path its operator names.
 */
function rowsRoots(): string[] {
  const cwd = process.cwd();
  const extra = (process.env.BOARDPLOT_ROWS_ROOTS ?? '').split(delimiter).filter(Boolean);
  const roots = [...clientRoots, ...(parse(cwd).root === cwd ? [] : [cwd]), tmpdir(), ...extra].map(realOrUndefined);
  return [...new Set(roots.filter((root): root is string => root !== undefined))];
}

const insideRoots = (real: string, roots: string[]): boolean =>
  roots.some((root) => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep));

function assertRowsFileInRoots(path: unknown): void {
  if (typeof path !== 'string') return;
  const real = realOrUndefined(path) ?? resolve(path);
  const roots = rowsRoots();
  if (insideRoots(real, roots)) return;
  throw new InputError('rows-outside-roots', `rowsFile ${path} is outside the folders this server reads rows from: ${roots.join(', ')}`, {
    path: '/rowsFile',
    suggest: `Move the file into one of those folders, or start the server with BOARDPLOT_ROWS_ROOTS set to its folder (several separated by '${delimiter}').`,
  });
}

/** A path not yet created resolves through its nearest existing folder, so a symlinked parent counts where it points. */
function resolvedTarget(path: string): string {
  const rest: string[] = [];
  for (let at = resolve(path); ; at = dirname(at)) {
    const real = realOrUndefined(at);
    if (real !== undefined) return join(real, ...rest.reverse());
    if (dirname(at) === at) return resolve(path);
    rest.push(basename(at));
  }
}

// An agent must not create or replace files outside the allowed folders through outDir.
function assertOutDirInRoots(path: unknown): void {
  if (typeof path !== 'string') return;
  const roots = rowsRoots();
  if (insideRoots(resolvedTarget(path), roots)) return;
  throw new InputError('out-outside-roots', `outDir ${path} is outside the folders this server writes to: ${roots.join(', ')}`, {
    path: '/outDir',
    suggest: `Write under one of those folders, or start the server with BOARDPLOT_ROWS_ROOTS set to the output folder (several separated by '${delimiter}').`,
  });
}

function runTool(name: string, args: Record<string, unknown>): VerbResult {
  if (name === 'boardplot_render' || name === 'boardplot_measure') assertRowsFileInRoots(args.rowsFile);
  if (name === 'boardplot_render') assertOutDirInRoots(args.outDir);
  switch (name) {
    case 'boardplot_list':
      return list();
    case 'boardplot_describe':
      return describe(args);
    case 'boardplot_fixtures':
      return fixtures(args);
    case 'boardplot_render':
      return render(args as { spec: unknown; return?: string[] });
    case 'boardplot_measure':
      return measure(args as { spec: unknown });
    case 'boardplot_feedback':
      return feedback({ ...args, surface: 'mcp' });
    default:
      return unknownTool(name);
  }
}

/**
 * The theme lints this server process has reported: per theme, a
 * short fingerprint of the resolved theme in canonical key order, and per
 * lint a short hash of its code, field and message. The oldest theme leaves
 * past THEME_LINT_MEMORY, so a long session holds a bounded set.
 */
const reportedThemeLints = new Map<string, Set<string>>();
const THEME_LINT_MEMORY = 256;

/** The theme a lint path points at, resolved where it names a preset, as a short canonical fingerprint. */
function themeFingerprint(spec: unknown, path: string): string {
  const found = readJsonPointer(spec, path);
  let theme: unknown = found.found ? found.value : null;
  if (typeof theme === 'string' || (isRecord(theme) && typeof theme.preset === 'string')) {
    try {
      theme = resolveTheme(theme as ThemeRef);
    } catch {
      // An unknown preset keeps its authored form; the render reported it.
    }
  }
  return sha256(canonicalJson(theme)).slice(0, 16);
}

/**
 * A long session re-renders one theme many times; its lints (path ending in
 * /theme) come back with the first call that carries them, not with every
 * call, wherever in the document the theme sits and in whatever key order.
 * A changed theme reports again. The CLI keeps every lint.
 */
function themeLintsOnce(spec: unknown, result: VerbResult): VerbResult {
  const body = result.body as { warnings?: { path?: string; displayPath?: string; code: string; message: string }[] };
  if (!Array.isArray(body.warnings)) return result;
  const warnings = body.warnings.filter((warning) => {
    const preference = warning.code === 'category-stride' || warning.code === 'furniture-budget';
    if (!preference && (typeof warning.path !== 'string' || !/(^|\/)theme$/.test(warning.path))) return true;
    const fingerprint = preference ? `layout:${sha256(canonicalJson(spec)).slice(0, 16)}` : themeFingerprint(spec, warning.path!);
    let seen = reportedThemeLints.get(fingerprint);
    if (seen === undefined) {
      seen = new Set();
      reportedThemeLints.set(fingerprint, seen);
      if (reportedThemeLints.size > THEME_LINT_MEMORY) reportedThemeLints.delete(reportedThemeLints.keys().next().value!);
    }
    // The message names the lint's own field; the document path is left out.
    const lint = sha256(`${warning.code}\0${warning.displayPath ?? ''}\0${warning.message}`).slice(0, 16);
    if (seen.has(lint)) return false;
    seen.add(lint);
    return true;
  });
  return warnings.length === body.warnings.length ? result : { ...result, body: { ...body, warnings } };
}

/** The design advice codes this server process has reported. */
const reportedAdvice = new Set<string>();

/**
 * Design advice (severity `advice`) comes once per code per session: an
 * author who has read a rule does not need it with every render. The CLI
 * keeps every advice.
 */
function adviceOnce(result: VerbResult): VerbResult {
  const body = result.body as { warnings?: { code: string; severity?: string }[] };
  if (!Array.isArray(body.warnings)) return result;
  const warnings = body.warnings.filter((warning) => {
    if (warning.severity !== 'advice') return true;
    if (reportedAdvice.has(warning.code)) return false;
    reportedAdvice.add(warning.code);
    return true;
  });
  return warnings.length === body.warnings.length ? result : { ...result, body: { ...body, warnings } };
}

function dispatch(name: string, args: unknown): VerbResult {
  const tool = tools().find((candidate) => candidate.name === name);
  if (!tool) return unknownTool(name);
  // A spec sent as a JSON string is the most common agent mistake; it gets its own code.
  if (isRecord(args) && typeof args.spec === 'string') return runVerb(() => { assertSpecObject(args.spec); return unknownTool(name); });
  const failure = argumentFailure(args, tool);
  if (failure) return invalidArgument(failure);
  const result = runVerb(() => runTool(name, args as Record<string, unknown>));
  // Usage counts never change a tool's answer.
  try {
    if (isRecord(args)) usage.record({ command: name, spec: args.spec, type: args.type, format: args.format, body: result.body, host: clientHost });
  } catch { /* no event */ }
  return isRecord(args) && Object.hasOwn(args, 'spec') ? adviceOnce(themeLintsOnce(args.spec, result)) : result;
}

/**
 * Run one tool: the JSON body as structured content and text, PNGs as image
 * blocks. Every body carries engineRev; the server adds `version`, the string
 * `boardplot --version` prints, so a host can tell a stale server from the CLI
 * beside it.
 */
export function callTool(name: string, args: unknown): ToolResult {
  const result = dispatch(name, args ?? {});
  // Host tables from BOARDPLOT_FONT_TABLES: every result says which families are measured from them.
  const fontTables = hostFontTables();
  const body = { ...result.body, version: BOARDPLOT_VERSION, ...(fontTables ? { fontTables } : {}) };
  const text = JSON.stringify(body);
  const content: McpContent[] = [{ type: 'text', text }];
  const pluginNotice = currentPluginNotice();
  if (pluginNotice) content.push({ type: 'text', text: pluginNotice });
  if (cliVersionNotice) {
    content.push({ type: 'text', text: cliVersionNotice });
    cliVersionNotice = undefined;
  }
  if (!telemetryNoticeChecked) {
    telemetryNoticeChecked = true;
    try {
      const notice = mcpNotice(cliCommand());
      if (notice) content.push({ type: 'text', text: notice });
    } catch { /* no notice */ }
  }
  for (const image of result.images ?? []) content.push({ type: 'image', data: image.toString('base64'), mimeType: 'image/png' });
  return { text, content, structuredContent: body, ...(result.exit === 0 ? {} : { isError: true }) };
}

function respond(id: RpcRequest['id'], result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result })}\n`);
}

function respondError(id: RpcRequest['id'], code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })}\n`);
}

type RequestGuard =
  | { ok: true; request: RpcRequest }
  | { ok: false; code: -32600; message: string };

function guardRequest(parsed: unknown): RequestGuard {
  if (Array.isArray(parsed)) {
    return {
      ok: false,
      code: -32600,
      message: `Invalid Request: batching is not supported at protocolVersion '${DEFAULT_PROTOCOL_VERSION}'`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      code: -32600,
      message: `Invalid Request: expected a JSON object, received ${describeValue(parsed)}`,
    };
  }
  if (parsed.jsonrpc !== '2.0') {
    return {
      ok: false,
      code: -32600,
      message: `Invalid Request: jsonrpc must be '2.0', received ${
        Object.prototype.hasOwnProperty.call(parsed, 'jsonrpc') ? describeValue(parsed.jsonrpc) : 'missing'
      }`,
    };
  }
  if (typeof parsed.method !== 'string') {
    return {
      ok: false,
      code: -32600,
      message: `Invalid Request: method must be a string, received ${
        Object.prototype.hasOwnProperty.call(parsed, 'method') ? describeValue(parsed.method) : 'missing'
      }`,
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(parsed, 'id') &&
    parsed.id !== null &&
    typeof parsed.id !== 'string' &&
    typeof parsed.id !== 'number'
  ) {
    return {
      ok: false,
      code: -32600,
      message: `Invalid Request: id must be a string, number, or null, received ${describeValue(parsed.id)}`,
    };
  }
  return { ok: true, request: parsed as unknown as RpcRequest };
}

/** The families measured from the tables `BOARDPLOT_FONT_TABLES` names; undefined when it is unset or unreadable. */
function hostFontTables(): { families: string[]; faces: number } | undefined {
  try {
    return fontTablesSummary(requestedFontTables());
  } catch {
    return undefined;
  }
}

export function startMcpServer(): void {
  checkCliVersion();
  // A table file that cannot be read stops the server: running on without it would measure with the wrong widths.
  try {
    requestedFontTables();
  } catch (error) {
    console.error(`boardplot-mcp: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  // Same runtime-ownership rule as the CLI's main(): verdicts and bytes must
  // not depend on foreign Object.prototype members.
  sanitizeObjectPrototype((message) => console.error(`⚠ ${message}`));
  const rl = createInterface({ input: process.stdin, terminal: false });
  // bound every input before parsing it. One JSON-RPC line carries at
  // most one document, and the largest legitimate documents are far below
  // this; anything bigger is a mistake or a resource soak.
  let initialized = false;
  let rootsSupported = false;
  let rootsRequests = 0;
  let rootsRequest: string | undefined;
  // A tools/call waits for the roots refresh in flight, so a root the client
  // just revoked never admits a rowsFile. No answer in time, an error answer
  // or a closed stdin clears the client roots.
  let rootsReady: Promise<void> = Promise.resolve();
  let settleRoots: ((roots: string[]) => void) | undefined;
  const requestRoots = () => {
    settleRoots?.([]);
    rootsRequest = `boardplot-roots-${++rootsRequests}`;
    rootsReady = new Promise((resolveRoots) => {
      const done = (roots: string[]) => {
        clearTimeout(timer);
        clientRoots = roots;
        settleRoots = undefined;
        resolveRoots();
      };
      const timer = setTimeout(() => done([]), ROOTS_TIMEOUT_MS);
      settleRoots = done;
    });
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: rootsRequest, method: 'roots/list' })}\n`);
  };
  rl.on('close', () => {
    settleRoots?.([]);
    try { usage.flush(); } catch { /* no event */ }
  });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    // Byte length, not character count: multi-byte UTF-8 would otherwise
    // slip past the cap by up to 4x.
    if (Buffer.byteLength(line, 'utf8') > MCP_LIMITS.maxJsonLineBytes) {
      return respondError(
        null,
        -32600,
        `request line exceeds ${MCP_LIMITS.maxJsonLineBytes} bytes; split the spec into smaller requests`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return respondError(null, -32700, 'parse error');
    }
    // The client's answer to a roots/list request; only the latest one counts.
    if (isRecord(parsed) && typeof parsed.id === 'string' && parsed.id.startsWith('boardplot-roots-') && !('method' in parsed)) {
      if (parsed.id !== rootsRequest) return;
      const roots = isRecord(parsed.result) && Array.isArray(parsed.result.roots) ? parsed.result.roots : [];
      settleRoots?.(roots.flatMap((root) => {
        try { return isRecord(root) && typeof root.uri === 'string' ? [fileURLToPath(root.uri)] : []; } catch { return []; }
      }));
      return;
    }
    const guarded = guardRequest(parsed);
    if (!guarded.ok) return respondError(null, guarded.code, guarded.message);
    const req = guarded.request;
    // A line with no `id` is a notification: no response, for every method.
    // A line that carries an `id` is a request and gets exactly one response —
    // including `notifications/*` sent with an id, which is a malformed request
    // and is answered -32601 rather than silently dropped.
    if (!('id' in req)) {
      if (rootsSupported && (req.method === 'notifications/initialized' || req.method === 'notifications/roots/list_changed')) requestRoots();
      return;
    }

    try {
      switch (req.method) {
        case 'initialize': {
          const params = isRecord(req.params) ? req.params : {};
          const protocolVersion = negotiateProtocolVersion(params.protocolVersion);
          initialized = true;
          rootsSupported = isRecord(params.capabilities) && isRecord(params.capabilities.roots);
          clientHost = hostFromClient(isRecord(params.clientInfo) ? params.clientInfo.name : undefined);
          return respond(req.id, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'boardplot', version: BOARDPLOT_VERSION, ...(hostFontTables() ? { fontTables: hostFontTables() } : {}) },
          });
        }
        case 'tools/list':
          // the MCP lifecycle starts with initialize; answering tool
          // methods before it hides handshake bugs in clients.
          if (!initialized) {
            return respondError(req.id, -32002, 'server not initialized — send initialize first');
          }
          return respond(req.id, { tools: tools() });
        case 'tools/call': {
          if (!initialized) {
            return respondError(req.id, -32002, 'server not initialized — send initialize first');
          }
          if (req.params !== undefined && !isRecord(req.params)) {
            return respondError(
              req.id,
              -32602,
              `Invalid params: tools/call params must be an object, received ${describeValue(req.params)}`,
            );
          }
          const params = isRecord(req.params) ? req.params : {};
          if (typeof params.name !== 'string') {
            return respondError(
              req.id,
              -32602,
              `Invalid params: tools/call params.name must be a string, received ${
                Object.prototype.hasOwnProperty.call(params, 'name') ? describeValue(params.name) : 'missing'
              }`,
            );
          }
          const name = params.name;
          const args = params.arguments ?? {};
          const answer = () => {
            const r = callTool(name, args);
            respond(req.id, {
              content: r.content,
              structuredContent: r.structuredContent,
              ...(r.isError ? { isError: true } : {}),
            });
          };
          if (!settleRoots) return answer();
          return void rootsReady.then(answer).catch((e: unknown) => respondError(req.id, -32603, e instanceof Error ? e.message : String(e)));
        }
        case 'ping':
          return respond(req.id, {});
        default:
          return respondError(req.id, -32601, `method '${req.method}' not found`);
      }
    } catch (e) {
      respondError(req.id, -32603, e instanceof Error ? e.message : String(e));
    }
  });
}

// direct execution (bin)
const invoked = process.argv[1];
if (invoked) {
  let direct = import.meta.url === pathToFileURL(invoked).href;
  if (!direct) {
    try {
      direct = import.meta.url === pathToFileURL(realpathSync(invoked)).href;
    } catch {
      /* not direct */
    }
  }
  // A render can draw a PNG; its raster faces load before the first request is read.
  if (direct) await loadRasterFonts().then(startMcpServer);
}
