/**
 * What `BoardplotChart` renders from, published by the modules that carry it.
 *
 * The spec entry links spec validation and the table renderer with dynamic
 * `import()`s, so zod and the diagnostics stay out of `react/spec`'s initial
 * load. A module graph that ALREADY holds them — a server that imported
 * `boardplot/react/prepare`, a page that imported
 * `boardplot/react/table` — needs no round trip: BoardplotChart reads
 * them here and renders in the same pass, as it did before the split. The 31
 * chart types need no entry here: the chart registry is the handover for
 * their engines, and its schema index the handover for their schemas.
 *
 * This is a fast path only. Each publisher is a module side effect, and when
 * a bundler drops one, BoardplotChart still resolves the same values off the
 * module it loaded.
 */

import type { ComponentType } from 'react';
import type { TableChartProps } from './TableChart';

export interface SpecValidator {
  beginSpecParse: typeof import('./specValidation').beginSpecParse;
  specSettings: typeof import('./specValidation').specSettings;
  BoardplotSpecError: typeof import('../core/doc/specError').BoardplotSpecError;
}

let validator: SpecValidator | undefined;
let tableChart: ComponentType<TableChartProps> | undefined;
const waiting = new Set<() => void>();

/**
 * Redraws every chart waiting for a publication. `BoardplotChart` subscribes
 * here as well as to its own loads, so a table renderer that another page
 * imports reaches a chart that is sitting on a stale error card.
 */
export function onHandover(redraw: () => void): () => void {
  waiting.add(redraw);
  return () => { waiting.delete(redraw); };
}

function notify(): void {
  for (const redraw of [...waiting]) redraw();
}

/** Called by `./specValidation` at module scope. The first copy wins. */
export function publishSpecValidator(published: SpecValidator): void {
  if (validator) return;
  validator = published;
  notify();
}

/** The validator this graph already has, or undefined while its chunk loads. */
export function loadedSpecValidator(): SpecValidator | undefined {
  return validator;
}

/** Called by `./TableChart` at module scope. The first copy wins. */
export function publishTableChart(published: ComponentType<TableChartProps>): void {
  if (tableChart) return;
  tableChart = published;
  notify();
}

/** The table renderer this graph already has, or undefined while its chunk loads. */
export function loadedTableChart(): ComponentType<TableChartProps> | undefined {
  return tableChart;
}
