/**
 * Hosted Boardplot MCP server, prototype. Streamable HTTP at /mcp,
 * stateless: a fresh server per request answers both the 2026-07-28 protocol
 * and the 2025-era initialize handshake. It binds to localhost only.
 *
 * Start: node dist/index.mjs (PORT, default 3001).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { localhostHostValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createBoardplotServer } from './mcp';
import { RenderPool } from './render';
import { checkFallbackThemes } from './brand';
import { LIMITS } from './limits';

declare const __BOARDPLOT_ENGINE__: { version: string } | undefined;
const VERSION = typeof __BOARDPLOT_ENGINE__ === 'object' ? __BOARDPLOT_ENGINE__.version : 'dev';

const log = (line: string) => process.stderr.write(`boardplot-server: ${line}\n`);
const debug = process.env.BOARDPLOT_DEBUG === '1';

const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/** A browser host on this machine (the ext-apps basic host) calls cross-origin; nothing else may. */
function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (!LOCAL_ORIGIN.test(origin)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Origin not allowed');
    return false;
  }
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] ?? 'content-type, accept, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name');
  res.setHeader('access-control-expose-headers', 'mcp-session-id, mcp-protocol-version');
  return true;
}

/**
 * Chart responses carry customer data: no cache may store them, errors
 * included. The SDK writes its own cache-control on streamed
 * answers, so writeHead is wrapped to keep no-store.
 */
function noStore(res: ServerResponse): void {
  res.setHeader('cache-control', 'no-store');
  const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
  res.writeHead = ((...args: unknown[]) => {
    const headers = args[args.length - 1];
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cache-control') (headers as Record<string, unknown>)[key] = 'no-store';
    }
    return writeHead(...args);
  }) as typeof res.writeHead;
}

/** The body as text, or 'too-large' past the 1 MiB limit (chunked bodies included). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMITS.bodyBytes) {
        req.pause();
        resolve('too-large');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('request aborted')));
  });
}

/** Method and protocol version of a request, for the local debug log; no content. */
function describeMessage(message: unknown): string {
  const record = (message ?? {}) as { method?: string; params?: { protocolVersion?: string; _meta?: Record<string, unknown> } };
  const version = record.params?.protocolVersion ?? record.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? 'none';
  return `${record.method ?? 'response'} protocol=${String(version)}`;
}

export function startServer(port: number, entry = fileURLToPath(new URL('./worker.mjs', import.meta.url))) {
  // A brand that fails a colour floor falls back to these presets, so they must pass every floor.
  checkFallbackThemes();
  const pool = new RenderPool({ entry, size: LIMITS.workers, deadlineMs: LIMITS.deadlineMs, log });
  const handler = createMcpHandler(() => createBoardplotServer(pool, VERSION), { onerror: (error) => log(`mcp error: ${error.message}`) });
  const mcp = toNodeHandler(handler, { maxRequestBodySize: LIMITS.bodyBytes, onerror: (error) => log(`adapter error: ${error.message}`) });
  const validateHost = localhostHostValidation();
  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (path !== '/mcp') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    noStore(res);
    if (!validateHost(req, res) || !cors(req, res)) return;
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST') {
      void mcp(req, res);
      return;
    }
    void readBody(req).then((body) => {
      if (body === 'too-large') {
        res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({
          jsonrpc: '2.0', id: null,
          error: { code: -32600, message: `request body over ${LIMITS.bodyBytes} bytes; aggregate the data before you call again` },
        }));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }
      if (debug) log(`request ${describeMessage(parsed)}`);
      void mcp(req, res, parsed);
    }, (error: Error) => {
      // A broken or aborted body ends this request only; the server keeps running.
      log(`request body failed: ${error.message}`);
      if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request body could not be read' } }));
      else res.destroy();
    });
  });
  http.listen(port, '127.0.0.1', () => log(`listening on http://127.0.0.1:${port}/mcp (pid ${process.pid}, render children ${pool.pids().join(', ')})`));
  const stop = () => {
    pool.close();
    http.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return { http, pool };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    startServer(Number(process.env.PORT ?? 3001));
  } catch (error) {
    log(`refused to start: ${(error as Error).message}`);
    process.exit(1);
  }
}
