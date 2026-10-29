/**
 * The rows chunk's store, without React: `react/prepare` and a React Server
 * Component import it beside the chunk itself. The chart components read it
 * through `./rowsInput`.
 */
import type { RowsReading } from '../rows';
import type { RowsPathMap } from '../core/rows';
import type { DocumentFinding } from '../core/doc/diagnostics';
import type { RefusalFinding } from '../core/schema/refusals';
import { canonicalJson, fnv64 } from './prepared';
import type { RowsModule } from './rowsModule';

/** What a `prepared` snapshot carries for rows: the data the server mapped and its reading. */
export interface PreparedRows {
  /** The type, template, rows and columns the data was mapped from (`rowsKey`). */
  key: string;
  data: unknown;
  reading: RowsReading;
}

/** A refused mapping as the CLI reports it: the InputError's code and message with its details, `path` a JSON Pointer such as `/rows/3/revenue`. */
export type RowsRefusal = DocumentFinding & { path: string };

/** The rows as mapped (`spec`, `reading`, `pathMap`), or as refused (`refusal`, and `refusals` for the chart card). */
export interface MappedRows {
  spec?: Record<string, unknown>;
  reading?: RowsReading;
  pathMap?: RowsPathMap;
  refusal?: RowsRefusal;
  refusals?: RefusalFinding[];
}

let held: RowsModule | undefined;
let failure: string | undefined;
let loading = false;
const waiting = new Set<() => void>();

function notify(): void {
  for (const redraw of [...waiting]) redraw();
}

export function subscribe(redraw: () => void): () => void {
  waiting.add(redraw);
  return () => { waiting.delete(redraw); };
}

/** Called by `./rowsModule` at module scope. The first copy wins. */
export function publishRowsModule(module: RowsModule): void {
  if (held) return;
  held = module;
  failure = undefined;
  notify();
}

/**
 * One load at a time. A rejected load is tried again on the next render, and
 * a failure redraws only when its message is new, so a chunk that is not
 * deployed settles on the failure card instead of retrying in a loop.
 *
 * It publishes the chunk's export rather than trusting the chunk's own
 * module-scope call: a host bundler that reads the chunk as side-effect-free
 * (Rolldown in a Vite 8 build) empties it, and an import that publishes
 * nothing would leave the chart on the busy placeholder.
 */
export function loadRowsModule(): void {
  if (held || loading) return;
  loading = true;
  const fail = (reason: unknown) => {
    loading = false;
    const message = reason instanceof Error ? reason.message : String(reason);
    if (failure === message) return;
    failure = message;
    notify();
  };
  void import('./rowsModule').then((module) => {
    loading = false;
    if (module.rowsModule) publishRowsModule(module.rowsModule);
    else fail(new Error('the rows chunk loaded without the rows transform'));
  }, fail);
}

export const loadedModule = () => held;
export const loadFailure = () => (held ? undefined : failure);

/** What the rows were mapped from: the chart type, the template data, the rows and the columns. */
export function rowsKey(spec: { type?: unknown; data?: unknown }, rows: unknown, columns: unknown): string {
  return `rows:${fnv64(canonicalJson({ type: spec.type, data: spec.data ?? null, rows: rows ?? null, columns: columns ?? null }))}`;
}
