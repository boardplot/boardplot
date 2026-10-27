/**
 * The render pool: a few child processes that each run
 * the engine (src/worker.ts). Every render, measure and PNG call runs in one
 * of them. A job past the deadline gets a clear error at once; its child is
 * killed through its own handle, and its slot stays busy until the child has
 * exited, then a fresh child takes the slot. The server kills only children
 * it spawned. A job that waits in the queue longer than one deadline is
 * answered server-busy, so no call waits more than about two deadlines.
 */
import { fork, type ChildProcess } from 'node:child_process';
import type { ToolResult } from './engine';
import type { Job } from './worker';

interface Pending {
  job: Job;
  resolve(result: ToolResult): void;
  /** Answers server-busy when no child took the job within one deadline. */
  wait: NodeJS.Timeout;
}

interface Slot {
  child: ChildProcess;
  ready: boolean;
  /** The job this child runs, or the kill this slot waits out. */
  busy: boolean;
  current?: { id: number; resolve(result: ToolResult): void; timer: NodeJS.Timeout };
}

/** A tool result in the CLI error shape, for a failure the pool answers itself. */
export function failure(code: string, message: string, suggest: string): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `Boardplot refused the call.\n${code}: ${message} ${suggest}` }],
    structuredContent: { ok: false, errors: [{ code, path: '', message, suggest }], warnings: [] },
  };
}

export interface PoolOptions {
  /** The built worker entry (dist/worker.mjs). */
  entry: string;
  size: number;
  deadlineMs: number;
  /** Jobs that may wait for a free child; more are refused as busy. */
  queueLimit?: number;
  log?: (line: string) => void;
}

export class RenderPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Pending[] = [];
  private nextId = 1;
  private closed = false;

  constructor(private readonly options: PoolOptions) {
    for (let index = 0; index < options.size; index++) this.slots.push(this.spawn());
  }

  /** Process IDs of the live children, for the local deadline check. */
  pids(): number[] {
    return this.slots.flatMap((slot) => (slot.child.pid === undefined ? [] : [slot.child.pid]));
  }

  run(job: Job): Promise<ToolResult> {
    if (this.closed) return Promise.resolve(failure('server-closing', 'the server is shutting down', 'Call again in a moment.'));
    if (this.queue.length >= (this.options.queueLimit ?? 16)) {
      return Promise.resolve(failure('server-busy', 'the server is busy with other charts', 'Call again in a few seconds.'));
    }
    return new Promise((resolve) => {
      const pending: Pending = {
        job, resolve,
        wait: setTimeout(() => {
          const index = this.queue.indexOf(pending);
          if (index < 0) return;
          this.queue.splice(index, 1);
          resolve(failure('server-busy', `no render process was free within ${this.options.deadlineMs / 1000} s`, 'Call again in a few seconds.'));
        }, this.options.deadlineMs),
      };
      this.queue.push(pending);
      this.pump();
    });
  }

  /** Stop every child this pool spawned, through its handle. */
  close(): void {
    this.closed = true;
    for (const pending of this.queue.splice(0)) clearTimeout(pending.wait);
    for (const slot of this.slots) slot.child.kill('SIGKILL');
  }

  private spawn(): Slot {
    const child = fork(this.options.entry, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] });
    const slot: Slot = { child, ready: false, busy: false };
    child.on('message', (message: { ready?: true; id?: number; result?: ToolResult; error?: string }) => {
      if (message.ready) {
        slot.ready = true;
        this.pump();
        return;
      }
      const current = slot.current;
      if (!current || current.id !== message.id) return;
      clearTimeout(current.timer);
      slot.current = undefined;
      slot.busy = false;
      current.resolve(message.result ?? failure('internal-error', message.error ?? 'the render failed', 'Report the call that caused it.'));
      this.pump();
    });
    child.on('exit', (code, signal) => {
      const current = slot.current;
      if (current) {
        clearTimeout(current.timer);
        current.resolve(failure('internal-error', `the render process stopped (${signal ?? `exit ${code}`})`, 'Call again; report the call if it repeats.'));
      }
      if (this.closed) return;
      // The slot was busy with this child until now; a fresh child takes it.
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots[index] = this.spawn();
    });
    return slot;
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (!this.queue.length) return;
      if (!slot.ready || slot.busy) continue;
      const pending = this.queue.shift()!;
      clearTimeout(pending.wait);
      const id = this.nextId++;
      slot.busy = true;
      const timer = setTimeout(() => this.expire(slot, id), this.options.deadlineMs);
      slot.current = { id, resolve: pending.resolve, timer };
      slot.child.send({ id, job: pending.job });
    }
  }

  /** The deadline passed: answer now, kill the child, keep its slot busy until it has exited. */
  private expire(slot: Slot, id: number): void {
    const current = slot.current;
    if (!current || current.id !== id) return;
    slot.current = undefined;
    const seconds = this.options.deadlineMs / 1000;
    current.resolve(failure('render-timeout', `the chart took longer than ${seconds} s and was stopped`,
      'Aggregate the rows, draw fewer marks, or use a smaller frame, then call again.'));
    this.options.log?.(`render child ${slot.child.pid} killed at the ${seconds} s deadline`);
    slot.child.kill('SIGKILL');
  }
}
