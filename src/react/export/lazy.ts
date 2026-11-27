import type { ExportInput, ExportOk, ExportResult } from './types';

type Engine = ReturnType<typeof import('./engine').linkedEngine>;
let engine: Promise<Engine> | undefined;
let ready: Engine | undefined;
/** The export engine, loaded once, at the first export call; a failed download is tried again at the next call. */
const loaded = () => engine ??= import('./engine').then((module) => ready = module.linkedEngine(), (error: unknown) => { engine = undefined; throw error; });

/**
 * Runs one export on the engine. Once it has loaded, the engine reads the input at the call, as before. The first call
 * keeps its own copy of the spec while the engine loads, so a page that changes its spec right after the call still
 * exports the chart it asked for. A failed download answers `invalid`, as any other failed export does.
 */
function run<T>(input: ExportInput, call: (engine: Engine, input: ExportInput) => Promise<T>, failed: (result: ExportResult) => T): Promise<T> {
  if (ready) return call(ready, input);
  let owned = input;
  try { owned = { ...input, spec: structuredClone(input.spec) }; } catch { owned = { ...input }; }
  return loaded().then((linked) => call(linked, owned),
    (error: unknown) => failed({ ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }));
}

export function exportSvg(input: ExportInput): Promise<ExportResult> {
  return run(input, (linked, owned) => linked.exportSvg(owned), (result) => result);
}
export function exportCsv(input: ExportInput): Promise<ExportResult> {
  return run(input, (linked, owned) => linked.exportCsv(owned), (result) => result);
}
export function exportPng(input: ExportInput, scale: number): Promise<ExportResult> {
  return run(input, (linked, owned) => linked.exportPng(owned, scale), (result) => result);
}
/** The PNG and the SVG it was painted from, from one layout. */
export function renderPng(input: ExportInput, scale: number): Promise<{ png: ExportResult; svg?: ExportOk }> {
  return run(input, (linked, owned) => linked.renderPng(owned, scale), (png) => ({ png }));
}
