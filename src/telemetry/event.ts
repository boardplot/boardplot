/**
 * Builds the usage event of one CLI call or MCP tool call. It reads only the
 * chart type names, the top-level option key names and the warning and error
 * codes; data, text, values and paths never reach it. Each name passes an
 * allow list or pattern, else it is dropped or sent as "other".
 */
import { platform } from 'node:os';
import * as z from 'zod';
import { canonicalChartType, getChartSchemas } from '../core/registry';
import { API_VERSION } from '../version';
import { CODE_PATTERN, COMMANDS, OPTION_KEY_PATTERN, usageEventSchema, type UsageEvent } from './schema';

type Host = UsageEvent['host'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The top-level option keys a type's options schema declares, cached per type. */
const declaredKeys = new Map<string, Set<string>>();

function optionKeysOf(type: string): Set<string> {
  let keys = declaredKeys.get(type);
  if (keys) return keys;
  keys = new Set();
  try {
    const schema = getChartSchemas(type)?.optionsSchema;
    const json = schema ? z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) : undefined;
    const collect = (node: unknown): void => {
      if (!isRecord(node)) return;
      if (isRecord(node.properties)) for (const key of Object.keys(node.properties)) keys!.add(key);
      for (const branch of ['anyOf', 'oneOf', 'allOf'] as const) if (Array.isArray(node[branch])) node[branch].forEach(collect);
    };
    collect(json);
  } catch {
    // A schema the converter cannot read sends no option keys for its type.
  }
  declaredKeys.set(type, keys);
  return keys;
}

/** The charts of a bare spec or of an envelope `{ version, charts }`. */
function chartsOf(spec: unknown): Record<string, unknown>[] {
  if (!isRecord(spec)) return [];
  if (Array.isArray(spec.charts)) return spec.charts.filter(isRecord).slice(0, 20);
  return [spec];
}

function codesOf(body: Record<string, unknown>): string[] {
  const codes = new Set<string>();
  const take = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) if (isRecord(entry) && typeof entry.code === 'string' && CODE_PATTERN.test(entry.code)) codes.add(entry.code);
  };
  take(body.errors);
  take(body.warnings);
  if (Array.isArray(body.charts)) for (const chart of body.charts) if (isRecord(chart)) { take(chart.errors); take(chart.warnings); }
  return [...codes].sort().slice(0, 32);
}

export function osFamily(): UsageEvent['os'] {
  const os = platform();
  return os === 'darwin' || os === 'linux' || os === 'win32' ? os : 'other';
}

export function nodeMajor(): number {
  return Number(process.versions.node.split('.')[0]) || 0;
}

/** The release version without the build identity a packaged build adds. */
export function releaseVersion(): string {
  return API_VERSION;
}

/** The agent that started the CLI, from the variables those agents set. */
export function hostFromEnv(env: Record<string, string | undefined> = process.env): Host {
  if (env.CLAUDECODE) return 'claude-code';
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX) return 'codex';
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return 'cursor';
  if (env.GEMINI_CLI) return 'gemini';
  if (env.TERM_PROGRAM === 'vscode') return 'vscode';
  return 'none';
}

/** The MCP client's `clientInfo.name`, folded into a category; the name itself is never sent. */
export function hostFromClient(name: unknown): Host {
  if (typeof name !== 'string') return 'other';
  const lower = name.toLowerCase();
  if (lower.includes('claude-code') || lower.includes('claude code')) return 'claude-code';
  if (lower.includes('claude')) return 'claude-app';
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('cursor')) return 'cursor';
  if (lower.includes('visual studio code') || lower.includes('vscode') || lower.includes('copilot')) return 'vscode';
  if (lower.includes('gemini')) return 'gemini';
  return 'other';
}

export interface UsageInput {
  surface: UsageEvent['surface'];
  command: string;
  /** The spec of a render or measure call. */
  spec?: unknown;
  /** The type a describe or fixtures call named. */
  type?: unknown;
  /** The render format asked for; svg when a render names none. */
  format?: unknown;
  body: Record<string, unknown>;
  host: Host;
  install: string;
}

/** The event, or undefined when the call is not one of the counted commands. */
export function usageEvent(input: UsageInput): UsageEvent | undefined {
  const command = input.command.replace(/^boardplot_/, '');
  if (!(COMMANDS as readonly string[]).includes(command) || command === 'feedback') return undefined;
  const types = new Set<string>();
  const optionKeys = new Set<string>();
  const named = typeof input.type === 'string' ? [input.type] : [];
  for (const chart of chartsOf(input.spec)) {
    if (typeof chart.type === 'string') named.push(chart.type);
    const type = typeof chart.type === 'string' ? canonicalChartType(chart.type) : undefined;
    if (type && isRecord(chart.options)) {
      const declared = optionKeysOf(type);
      for (const key of Object.keys(chart.options)) if (declared.has(key) && OPTION_KEY_PATTERN.test(key)) optionKeys.add(key);
    }
  }
  for (const name of named) types.add(name === 'theme' ? 'theme' : canonicalChartType(name) ?? 'other');
  const event = {
    v: 1 as const,
    install: input.install,
    version: releaseVersion(),
    surface: input.surface,
    command: command as UsageEvent['command'],
    types: [...types].sort().slice(0, 20),
    optionKeys: [...optionKeys].sort().slice(0, 64),
    codes: codesOf(input.body),
    ok: input.body.ok === true,
    format: command !== 'render' ? 'none' as const : input.format === 'png' ? 'png' as const : 'svg' as const,
    host: input.host,
    os: osFamily(),
    node: nodeMajor(),
  };
  // The strict schema is the last gate: an event that fails it is not sent.
  const parsed = usageEventSchema.safeParse(event);
  return parsed.success ? parsed.data : undefined;
}
