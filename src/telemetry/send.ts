/**
 * Sends usage events and approved feedback to the collector, and shows the
 * one-time notices. Nothing here runs unless telemetryState() says so: a build
 * without an endpoint, an off switch, CI or no stored yes all return early.
 * Sending never delays or fails a CLI call or a tool call.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { usageEvent, type UsageInput } from './event';
import type { FeedbackReport, UsageEvent } from './schema';
import { currentInstall, deliveryFile, queueFile, telemetryState, writeChoice, type TelemetryState } from './state';

const TIMEOUT_MS = 3000;
/** One CLI sender at most per minute; the events of the calls between wait in the queue. */
const FLUSH_INTERVAL_MS = 60_000;
const BATCH = 50;

/** Posts one JSON body and prints `{ status, body }`; status 0 when the network failed. */
const POST = `const [url, body, wait] = process.argv.slice(1);
fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(Number(wait)) })
  .then(async (r) => { process.stdout.write(JSON.stringify({ status: r.status, body: await r.text() })); })
  .catch(() => process.stdout.write(JSON.stringify({ status: 0 })));`;

/**
 * The CLI's detached sender: it takes the whole queue by renaming it (a second
 * sender finds nothing), posts it in batches, records the answer and deletes it.
 */
const FLUSH = `const fs = require('node:fs');
const [queue, url, delivery, wait] = process.argv.slice(1);
const taken = queue + '.' + process.pid + '.sending';
(async () => {
  try { fs.renameSync(queue, taken); } catch { return; }
  try {
    const events = fs.readFileSync(taken, 'utf8').split('\\n').filter(Boolean).map((line) => JSON.parse(line));
    let status = 204;
    for (let at = 0; at < events.length; at += ${BATCH}) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: events.slice(at, at + ${BATCH}) }), signal: AbortSignal.timeout(Number(wait)) }).catch(() => ({ status: 0 }));
      if (r.status !== 204) status = r.status;
    }
    fs.writeFileSync(delivery, JSON.stringify({ day: new Date().toISOString().slice(0, 10), events: events.length, status }) + '\\n');
  } catch {} finally { fs.rmSync(taken, { force: true }); }
})();`;

export const NOTICE = 'Boardplot can send usage counts to its maintainers: chart types, option names, warning and error codes, OS and Node version, with a random install ID that changes each month. Never chart data, text, values or paths. It is off until you turn it on with `boardplot telemetry on`. Details: https://github.com/boardplot/boardplot/blob/main/docs/TELEMETRY.md';

function url(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}${path}`;
}

function remember(state: TelemetryState, event: UsageEvent): void {
  try {
    writeChoice(state.file, { ...state.stored, lastEvent: event });
  } catch {
    // An unwritable config folder only loses the copy `telemetry status` shows.
  }
}

function lockFile(state: TelemetryState): string {
  return join(dirname(state.file), 'telemetry-flush.lock');
}

/** Whether no sender started in the last minute; marks the start when so. */
function claimFlush(state: TelemetryState, now = Date.now()): boolean {
  const lock = lockFile(state);
  try {
    if (now - statSync(lock).mtimeMs < FLUSH_INTERVAL_MS) return false;
    utimesSync(lock, now / 1000, now / 1000);
  } catch {
    try { writeFileSync(lock, ''); } catch { return false; }
  }
  return true;
}

/**
 * The CLI's event: queued in the config folder, and posted by one detached
 * sender at most every minute, so the CLI exits at once and a run of many
 * calls starts few processes.
 */
export function recordCliUsage(input: Omit<UsageInput, 'surface' | 'install'>, state = telemetryState()): void {
  if (!state.enabled) return;
  const event = usageEvent({ ...input, surface: 'cli', install: currentInstall(state) });
  if (!event) return;
  try {
    appendFileSync(queueFile(state.file), `${JSON.stringify(event)}\n`);
  } catch {
    return;
  }
  remember(state, event);
  if (!claimFlush(state)) return;
  try {
    spawn(process.execPath, ['-e', FLUSH, queueFile(state.file), url(state.endpoint, '/v1/events'), deliveryFile(state.file), String(TIMEOUT_MS)], {
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
  } catch {
    // No child process: the events wait for the next call.
  }
}

/** The once-per-machine notice of an interactive CLI run, on stderr. */
export function cliNotice(state = telemetryState()): void {
  if (state.reason !== 'not-chosen' || state.file === '' || state.stored.noticeShown || !process.stderr.isTTY || !process.stdin.isTTY) return;
  process.stderr.write(`${NOTICE}\n`);
  try { writeChoice(state.file, { ...state.stored, noticeShown: true }); } catch { /* shown again next time */ }
}

/**
 * The MCP server's notice for the agent, once per machine; undefined when
 * there is nothing to say. `cli` is the command that runs this install's CLI,
 * so the user needs no download to answer.
 */
export function mcpNotice(cli: string, state = telemetryState()): string | undefined {
  if (state.reason !== 'not-chosen' || state.file === '' || state.stored.agentNoticeShown) return undefined;
  try { writeChoice(state.file, { ...state.stored, agentNoticeShown: true }); } catch { /* shown again next session */ }
  return `${NOTICE.replace('`boardplot telemetry on`', `\`${cli} telemetry on\``)} Tell the user this once, in your own words. Run the command only when the user asks you to.`;
}

/**
 * The MCP server's events: a long session batches them and posts in the
 * background, at most every 30 s or every 20 events, and once more when the
 * client closes the connection. Every call reads the choice again, so
 * `telemetry off` in a terminal stops a running server's next event.
 */
export function mcpReporter(): { record(input: Omit<UsageInput, 'surface' | 'install'>): void; flush(): void } {
  let queue: UsageEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const state = telemetryState();
    if (!queue.length || !state.enabled) {
      queue = [];
      return;
    }
    const events = queue;
    queue = [];
    remember(state, events[events.length - 1]!);
    fetch(url(state.endpoint, '/v1/events'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }), signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then((response) => {
      try { writeFileSync(deliveryFile(state.file), `${JSON.stringify({ day: new Date().toISOString().slice(0, 10), events: events.length, status: response.status })}\n`); } catch { /* status only */ }
    }, () => undefined);
  };
  return {
    record(input) {
      const state = telemetryState();
      if (!state.enabled) {
        queue = [];
        return;
      }
      const event = usageEvent({ ...input, surface: 'mcp', install: currentInstall(state) });
      if (!event) return;
      queue.push(event);
      if (queue.length >= 20) flush();
      else if (!timer) {
        timer = setTimeout(flush, 30_000);
        timer.unref?.();
      }
    },
    flush,
  };
}

function post(endpoint: string, path: string, body: unknown): { status: number; body?: string } {
  if (endpoint === '') return { status: -1 };
  const child = spawnSync(process.execPath, ['-e', POST, url(endpoint, path), JSON.stringify(body), String(TIMEOUT_MS * 2)], {
    encoding: 'utf8', timeout: TIMEOUT_MS * 3, windowsHide: true,
  });
  try {
    return JSON.parse(child.stdout) as { status: number; body?: string };
  } catch {
    return { status: 0 };
  }
}

/** `telemetry off` asks the collector to delete the rows of this month's install ID before the ID is gone. */
export function requestErasure(state: TelemetryState): void {
  if (state.endpoint === '' || !state.stored.install) return;
  post(state.endpoint, '/v1/forget', { install: state.stored.install });
}

export type FeedbackSend = { sent: true; id?: string } | { sent: false; reason: 'no-collector' | 'refused' | 'network' };

/** Posts one approved report and waits until the collector accepts it (a few seconds at most). */
export function sendFeedback(report: FeedbackReport, state = telemetryState()): FeedbackSend {
  const answer = post(state.endpoint, '/v1/feedback', { report });
  if (answer.status === -1) return { sent: false, reason: 'no-collector' };
  if (answer.status !== 201) return { sent: false, reason: answer.status === 0 ? 'network' : 'refused' };
  try {
    const id = (JSON.parse(answer.body ?? '{}') as { id?: unknown }).id;
    return { sent: true, ...(typeof id === 'string' ? { id } : {}) };
  } catch {
    return { sent: true };
  }
}
