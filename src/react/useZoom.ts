/**
 * The `zoom` prop of a line or area chart: Ctrl or Cmd with the wheel, or a
 * trackpad pinch, zooms around the pointer; the plain wheel scrolls the page.
 * With the chart focused, + (or =) and - zoom around the centre, 0 returns to the opening view,
 * and Shift+Left and Shift+Right pan by half the range. The hook holds the
 * range and gives the chart the spec that draws it (core/zoom.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Rect } from '../core/geometry';
import {
  drawnGrain, panBy, readZoomRange, wantedGrain, zoomAxis, zoomBy, zoomChange, zoomSpec,
  type ZoomChange, type ZoomSettings, type ZoomSpec,
} from '../core/zoom';

export type { ZoomAggregate, ZoomChange, ZoomGrain, ZoomGrainUnit, ZoomReason } from '../core/zoom';

export interface ZoomProps extends ZoomSettings {
  /** The visible range, for a host that holds it: gestures then only call `onZoom`. */
  range?: [string | number, string | number];
  /** Called after each zoom or pan, at most once a frame; a host sends finer data for a grain finer than the drawn one. */
  onZoom?: (change: ZoomChange) => void;
}

/** The language of a locale given as a tag ('de') or as `{ language }`. */
export const languageOf = (locale: unknown): string | undefined =>
  typeof locale === 'string' ? locale : (locale as { language?: string } | undefined)?.language;

/** `zoom` on a chart: true, or the settings. */
export type ZoomOption = boolean | ZoomProps;

/** One wheel notch (100 px of delta) zooms by about 22%. */
const WHEEL_RATE = 0.002;
const LINE_PX = 16;

interface Drawn { plot: Rect; width: number }

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function useZoom(input: { type: string; data: unknown; annotations: unknown[] | undefined; options: Record<string, unknown>; zoom: ZoomOption | undefined; width: number | undefined;
  /** The provider's strings and language, which the bucket notes follow. */
  inherited?: { strings?: Record<string, unknown>; language?: string } }) {
  const settings: ZoomProps | undefined = input.zoom === true ? {} : input.zoom || undefined;
  // The annotations prop replaces options.annotations in the request, so the zoom reads and filters that list.
  const spec = useMemo(() => ({ type: input.type, data: input.data,
    options: input.annotations === undefined ? input.options : { ...input.options, annotations: input.annotations } }) as ZoomSpec, [input.type, input.data, input.annotations, input.options]);
  const axis = useMemo(() => (settings ? zoomAxis(spec) : undefined), [settings !== undefined, spec]);
  const [own, setOwn] = useState<[number, number] | null>(null);
  const controlled = settings?.range;
  const range = useMemo(() => {
    if (!axis) return undefined;
    const held = controlled ?? own;
    // A new document keeps the range; it is fitted to the new readings.
    return held ? readZoomRange(axis, held) : axis.start;
  }, [axis, controlled?.[0], controlled?.[1], own?.[0], own?.[1]]);
  const drawnAt = useRef<Drawn | undefined>(undefined);
  // The grain reads the box width, not the drawn plot: the grain changes the plot, which would change the grain.
  const plotWidth = (input.width ?? 600) * 0.85;
  const aggregate = JSON.stringify(settings?.aggregate ?? null), grains = settings?.grains?.join() ?? '';
  const view = useMemo(() => {
    if (!axis || !range || !settings) return undefined;
    const wanted = wantedGrain(axis, range, plotWidth, settings);
    const drawn = drawnGrain(axis, wanted, settings);
    const language = languageOf(input.options.locale) ?? input.inherited?.language;
    return { wanted, drawn, spec: zoomSpec(spec, axis, range, drawn, settings, language, input.inherited?.strings) };
  }, [axis, range, spec, plotWidth, aggregate, grains, input.inherited?.strings, input.inherited?.language]);

  // The latest values for the listeners, which are added once per element.
  const latest = useRef({ axis, range, settings, view, plotWidth });
  latest.current = { axis, range, settings, view, plotWidth };
  const frame = useRef<{ factor: number; at: number; reason: 'wheel' } | null>(null);
  const apply = useCallback((next: [number, number], reason: ZoomChange['reason']) => {
    const { axis: a, range: r, settings: s, plotWidth: w } = latest.current;
    if (!a || !r || !s || (next[0] === r[0] && next[1] === r[1])) return;
    if (!s.range) setOwn(next[0] === a.start[0] && next[1] === a.start[1] ? null : next);
    const wanted = wantedGrain(a, next, w, s);
    s.onZoom?.(zoomChange(a, next, wanted, drawnGrain(a, wanted, s), reason));
  }, []);

  const [element, setElement] = useState<HTMLElement | null>(null);
  const active = axis !== undefined;
  useEffect(() => {
    if (!element || !active) return undefined;
    /** The share of the plot left of a client x. */
    const shareAt = (clientX: number) => {
      const svg = element.querySelector('svg');
      const drawn = drawnAt.current;
      if (!svg || !drawn) return 0.5;
      const box = svg.getBoundingClientRect();
      const x = ((clientX - box.left) / box.width) * drawn.width;
      return (x - drawn.plot.x) / drawn.plot.w;
    };
    const onWheel = (event: WheelEvent) => {
      // The plain wheel scrolls the page; a pinch arrives as a wheel with ctrlKey.
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? 800 : 1);
      const pending = frame.current;
      frame.current = { factor: (pending?.factor ?? 1) * Math.exp(delta * WHEEL_RATE), at: shareAt(event.clientX), reason: 'wheel' };
      if (pending) return;
      requestAnimationFrame(() => {
        const step = frame.current;
        frame.current = null;
        const { axis: a, range: r, settings: s } = latest.current;
        if (step && a && r) apply(zoomBy(a, r, step.factor, step.at, s?.onZoom !== undefined), step.reason);
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || editable(event.target)) return;
      const { axis: a, range: r, settings: s } = latest.current;
      if (!a || !r) return;
      const finer = s?.onZoom !== undefined;
      let next: [number, number] | undefined;
      if (event.key === '+' || event.key === '=') next = zoomBy(a, r, 0.5, 0.5, finer);
      else if (event.key === '-' || event.key === '_') next = zoomBy(a, r, 2, 0.5, finer);
      else if (event.key === '0') next = a.start;
      else if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) next = panBy(a, r, event.key === 'ArrowLeft' ? -1 : 1);
      if (!next) return;
      // Before the record keys: Shift+Left and Shift+Right would step records.
      event.preventDefault();
      event.stopPropagation();
      apply(next, event.key === '0' ? 'reset' : event.shiftKey && event.key.startsWith('Arrow') ? 'pan' : 'keyboard');
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('keydown', onKey, true);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('keydown', onKey, true);
    };
  }, [element, active, apply]);

  return {
    /** Whether the chart zooms: the prop is set and the x is a time, date or number axis. */
    active,
    /** Whether the drawn spec differs from the props: a prepared layout then no longer matches it. */
    derived: view !== undefined && view.spec !== spec,
    data: view?.spec.data ?? input.data,
    options: (view?.spec.options ?? input.options) as Record<string, unknown>,
    annotations: view ? view.spec.options?.annotations as unknown[] | undefined : input.annotations,
    /** The element that takes the wheel and the keys. */
    attach: setElement,
    /** The drawn plot, for the pointer's place on the axis. */
    seen: (geometry: { plot: Rect; size: { width: number } } | undefined) => {
      if (geometry?.plot) drawnAt.current = { plot: geometry.plot, width: geometry.size.width };
    },
  };
}
