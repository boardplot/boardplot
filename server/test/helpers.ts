import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

interface Started {
  http: import('node:http').Server;
  pool: { close(): void };
}

/** Starts the built server (npm run build first) on a free localhost port. */
export async function startBuilt(): Promise<{ url: URL; stop: () => Promise<void> }> {
  const entry: string = '../dist/index.mjs';
  const { startServer } = (await import(entry)) as { startServer: (port: number) => Started };
  const started = startServer(0);
  await new Promise<void>((resolve) => (started.http.listening ? resolve() : started.http.once('listening', () => resolve())));
  const { port } = started.http.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    stop: async () => {
      started.pool.close();
      await new Promise<void>((resolve) => started.http.close(() => resolve()));
    },
  };
}

/** A client that negotiates the 2026-07-28 protocol; with apps it declares MCP Apps support. */
export async function connect(url: URL, apps: boolean): Promise<Client> {
  const capabilities = apps ? { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } : {};
  const client = new Client({ name: 'boardplot-server-test', version: '1' }, { capabilities, versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
}
