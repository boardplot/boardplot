import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

/**
 * Print lays every chart out again for its printed box. Measured in Chrome (page.pdf, 2026-10): `beforeprint` still
 * sees the screen layout. The `print` media query then turns true with the page laid out for paper and its pages
 * already counted: a DOM change made in that listener reaches the printed page, but content it adds past the last
 * page is cut. No animation frame and no ResizeObserver callback runs before the snapshot, so each chart reads its
 * printed box in that listener, and all of them render in one `flushSync`. `afterprint` and the query turning false
 * put the screen layouts back in the same way, before the next frame paints.
 */
export type PrintPhase = 'before' | 'print' | 'after';
type Measure = (phase: PrintPhase) => (() => void) | undefined;

const measures = new Set<Measure>();
const listeners = new Set<() => void>();
let printing = false;
let detach: (() => void) | undefined;

function relayout(phase: PrintPhase) {
  const next = phase !== 'after';
  // Every box is read before any chart renders, so the page is laid out once.
  const updates = [...measures].map(measure => measure(phase));
  flushSync(() => {
    if (printing !== next) {
      printing = next;
      for (const listener of listeners) listener();
    }
    for (const update of updates) update?.();
  });
}

function attach() {
  if (detach || typeof window === 'undefined') return;
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('print') : undefined;
  const before = () => relayout('before');
  const after = () => relayout('after');
  const change = (event: MediaQueryListEvent) => relayout(event.matches ? 'print' : 'after');
  window.addEventListener('beforeprint', before);
  window.addEventListener('afterprint', after);
  media?.addEventListener?.('change', change);
  detach = () => {
    window.removeEventListener('beforeprint', before);
    window.removeEventListener('afterprint', after);
    media?.removeEventListener?.('change', change);
    detach = undefined;
  };
}

function release() {
  if (measures.size > 0 || listeners.size > 0) return;
  detach?.();
  // The last chart left while printing: the next chart starts on screen.
  printing = false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  attach();
  return () => {
    listeners.delete(listener);
    release();
  };
}

/** True from `beforeprint` (or the print media query) to `afterprint`: a chart lays out at once, never in the background. */
export function usePrinting(): boolean {
  return useSyncExternalStore(subscribe, () => printing, () => false);
}

/**
 * Calls `measure` in each print phase: `before` (screen layout), `print` (printed layout, pages counted) and `after`.
 * It reads its box and returns the state update for it, which runs in the one synchronous render of every chart on
 * the page. The returned function stops the calls.
 */
export function watchPrint(measure: Measure): () => void {
  measures.add(measure);
  attach();
  return () => {
    measures.delete(measure);
    release();
  };
}
