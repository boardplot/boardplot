import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useIsomorphicLayoutEffect as useLayoutEffect } from './useIsomorphicLayoutEffect';
import { resolveSize } from '../core/normalize/shared';
import { DEFAULT_TARGET } from '../core/target';
import { BoardplotThemeContext } from './themeContext';
import { watchPrint } from './printLayout';
import type { BaseOptions, RenderTarget } from '../core/types/options';

export interface ContainerSizeOptions {
  size?: BaseOptions['size'] | 'container';
  fit?: 'fill' | 'content';
  fallbackSize?: BaseOptions['size'];
}

/**
 * Internal, not a host option: a chart cannot lay out until it knows how
 * tall its frame is, but a table only needs to know how wide it is. A table
 * host is usually a card with no height of its own, and waiting for one left
 * every filling table at its natural width.
 */
interface ContainerSizeInput extends ContainerSizeOptions {
  target?: RenderTarget;
  needsHeight?: boolean;
  /** The height a filling chart takes at a width when its host gives it none. */
  hostlessHeight?: (width: number, fallbackHeight: number) => number;
}

interface Measurement {
  wrapper: HTMLElement;
  fit: 'fill' | 'content';
  width: number;
  /** The host's own height, 0 when it has none (its height is its content). */
  host: number;
  /** What the wrapper draws beside the chart: the data-table toggle or table. */
  extras: number;
  /** Print only: the height the chart takes on the printed page, which a new layout must not pass (printLayout.ts). */
  printed?: number;
}

const noSubscription = () => () => {};

/** The drawn chart: its SVG and the HTML footer, which takes the place of the footer the layout drew (footer rule). */
function chartHeight(content: Element | null): number | undefined {
  const svg = content?.querySelector('svg[data-bp-chart]');
  return svg ? svg.getBoundingClientRect().height + (content!.querySelector('[data-bp-footer]')?.getBoundingClientRect().height ?? 0) : undefined;
}

/** What the wrapper draws below the chart: the data-table toggle or table; undefined while no chart is drawn. */
function extrasOf(content: Element | null): number | undefined {
  const chart = chartHeight(content);
  return chart !== undefined ? Math.max(0, content!.getBoundingClientRect().height - chart) : undefined;
}

/** The wrapper's content box, as the ResizeObserver reports it. */
function contentWidth(wrapper: HTMLElement): number {
  const style = getComputedStyle(wrapper);
  const sides = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const;
  return wrapper.getBoundingClientRect().width - sides.reduce((sum, side) => sum + (parseFloat(style[side]) || 0), 0);
}

/** The wrapper of a filling chart takes the host's height when the host has one. */
const FILL_STYLE: CSSProperties = { height: '100%' };
/**
 * An empty float at `height: 100%` is as tall as the host makes the wrapper,
 * and 0 when the host's height is auto; it has no width, so it moves nothing.
 */
export const PROBE_STYLE: CSSProperties = { float: 'left', width: 0, height: '100%' };

/**
 * Measures what the host gives, never what the chart draws. The width is the
 * wrapper's, which a block takes from its parent whatever it holds; the height
 * is the probe's. Measuring the parent's content box took the chart's own
 * height back as its frame: a heading or the data-table toggle beside the
 * chart then grew it on every frame, and a refusal placeholder's 23 px stuck
 * after the parent widened. A host without a height of its own gets the
 * height the chart type's aspect gives at the measured width, and only a width
 * change lays it out again; a host with a height gives it minus the data-table
 * toggle or table drawn below the chart.
 */
export function useContainerSize({ size, fit = 'fill', fallbackSize, target, needsHeight = true, hostlessHeight }: ContainerSizeInput) {
  const [wrapper, wrapperRef] = useState<HTMLDivElement | null>(null);
  const [measurement, setMeasurement] = useState<Measurement>();
  const shown = useRef(measurement);
  shown.current = measurement;
  // Set by the print listener with the printed box, in the same render (printLayout.ts).
  const [printing, setPrinting] = useState(false);
  const container = size === 'container';
  const provider = useContext(BoardplotThemeContext);
  const resolvedTarget = target ?? provider?.target ?? DEFAULT_TARGET;
  const fallback = resolveSize(container ? fallbackSize : size, resolvedTarget);
  const probed = container && fit === 'fill' && needsHeight;
  // The content element changes when a refusal swaps for the chart; the
  // observer follows it after every commit (the effect without a list below).
  const follow = useRef<() => void>(undefined);

  useEffect(() => {
    if (!container || !wrapper || typeof ResizeObserver === 'undefined') return;
    let active = true;
    let frame: number | undefined;
    let content: Element | null = null;
    let width = 0;
    let host = 0;
    let seen = '';
    const probe = probed ? wrapper.querySelector<HTMLElement>(':scope > [data-bp-probe]') : null;
    const settle = (previous: Measurement | undefined, next: Omit<Measurement, 'wrapper' | 'fit'>) =>
      previous?.wrapper === wrapper && previous.fit === fit && previous.width === next.width &&
        previous.host === next.host && previous.extras === next.extras && previous.printed === next.printed ? previous : { wrapper, fit, ...next };
    const observer = new ResizeObserver(entries => {
      if (!active) return;
      let moved = false;
      for (const entry of entries) {
        if (entry.target === wrapper) width = entry.contentRect.width;
        else if (entry.target === probe) host = entry.contentRect.height;
        else moved = true;
      }
      if (!Number.isFinite(width) || width <= 0) return;
      // Only the content moving (the table toggled) or a new host box asks again.
      if (!moved && seen === `${width} ${host}`) return;
      seen = `${width} ${host}`;
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (!active) return;
        // The chart's own height is taken out again, so what is left does not
        // depend on the layout and a new layout cannot move it.
        // Read here, not in the state update: React may run an update again in a later render, after a commit has
        // changed the page, and a read there lays out the page once per chart.
        const next = { width, host: Number.isFinite(host) && host > 0 ? host : 0 };
        const extras = extrasOf(content);
        setMeasurement(previous => settle(previous, { ...next, extras: extras ?? previous?.extras ?? 0 }));
      });
    });
    // Print (printLayout.ts): no frame runs before the browser takes the printed page, so the box is read in the
    // print listener itself, where the browser has already counted the pages. The chart keeps the height it has on
    // the printed page, the host's or its own drawing's scaled to the printed width: a taller chart would push the
    // page's end past the last page and lose it. A chart the print does not show (width 0) keeps its layout. At
    // the end the chart takes back the box it had before print: the page still holds the printed layout then, and a
    // host whose height follows its content would hand the printed height back to the screen.
    let screen: Measurement | undefined | null = null;
    const unwatch = watchPrint(phase => {
      if (phase === 'after') {
        const back = screen;
        screen = null;
        return () => {
          setPrinting(false);
          if (back) setMeasurement(back);
        };
      }
      const width = phase === 'print' ? contentWidth(wrapper) : 0;
      if (!(width > 0)) return () => setPrinting(true);
      // The observer follows the content of a filling chart only; print reads a content-fit chart's too.
      const drawn = wrapper.lastElementChild === probe ? null : wrapper.lastElementChild;
      const next = { width, host: probe ? probe.getBoundingClientRect().height : 0, extras: extrasOf(content) ?? shown.current?.extras ?? 0,
        // A chart that never drew (a hidden tab the print shows) keeps the height of its placeholder.
        printed: chartHeight(drawn) ?? (drawn?.getBoundingClientRect().height || undefined) };
      if (screen === null) screen = shown.current;
      return () => {
        setPrinting(true);
        setMeasurement(previous => settle(previous, next));
      };
    });
    follow.current = () => {
      const current = probe ? wrapper.lastElementChild : null;
      if (current === content) return;
      if (content) observer.unobserve(content);
      content = current === probe ? null : current;
      if (content) observer.observe(content);
    };
    observer.observe(wrapper, { box: 'content-box' });
    if (probe) observer.observe(probe, { box: 'content-box' });
    follow.current();
    return () => {
      active = false;
      unwatch();
      setPrinting(false);
      follow.current = undefined;
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [container, wrapper, fit, probed]);
  useEffect(() => follow.current?.());

  const ready = container && measurement?.wrapper === wrapper && measurement?.fit === fit;
  // A container chart mounted fresh on the client waits the frame its container takes to report a width, so it is
  // laid out once, at that width, and never shows a drawing or a refusal at the fallback size first. A host's
  // fallbackSize, a server render and its hydration draw at once. A container that reports no width (a hidden tab,
  // a host whose observer never fires) gets the fallback after a short wait.
  const client = useSyncExternalStore(noSubscription, () => true, () => false);
  const [freshMount] = useState(client);
  const [late, setLate] = useState(false);
  const seen = useRef(false);
  useLayoutEffect(() => {
    if (ready || fallbackSize !== undefined) seen.current = true;
  }, [ready, fallbackSize]);
  const waiting = container && !ready && freshMount && !late && !seen.current && fallbackSize === undefined
    && typeof ResizeObserver !== 'undefined';
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setLate(true), 100);
    return () => clearTimeout(timer);
  }, [waiting]);
  const width = ready ? measurement.width : fallback.width;
  // Print: a content-fit chart, which measures its own height, keeps the height it has on the printed page too and
  // fills it (`printFill`); a table needs no height.
  const printFill = ready && !probed && needsHeight && measurement.printed !== undefined;
  // A table needs no height and takes the fallback one; a filling chart takes
  // the host's height less the table below it, or its aspect at this width.
  const height = printFill ? measurement.printed! : !ready || !probed ? fallback.height
    : measurement.host > 0 ? Math.max(0, measurement.host - measurement.extras)
      : measurement.printed ?? (hostlessHeight ? hostlessHeight(width, fallback.height) : fallback.height);
  // Height floor: a host without a height hands the engine the width alone, so the
  // chart takes the engine's automatic height and plot floor (one rule, in core/sizing.ts).
  // In print it keeps the height it has on the printed page.
  const automatic = ready && probed && measurement.host <= 0 && measurement.printed === undefined;
  const resolvedSize = useMemo((): { width: number; height?: number } => (automatic ? { width } : { width, height }), [automatic, width, height]);
  return {
    wrapperRef,
    /** False on the server and during the matching first hydration render. */
    client,
    /** The wrapper's style, and whether it holds the probe (`PROBE_STYLE`, `data-bp-probe`) as its first child. */
    wrapperStyle: probed ? FILL_STYLE : undefined,
    probed,
    size: resolvedSize,
    /** The frame a server snapshot of this container was laid out at. */
    fallback,
    /** The host gives the chart its height (a fixed-height slot): the chart, its footer included, never grows past it. */
    pinnedHeight: ready && probed && measurement.host > 0,
    ready: !container || ready,
    /** The first width is still on its way (see `waiting` above): the chart draws the busy box. */
    waiting,
    /** The page is printing: a new layout renders at once, in the print listener's render (printLayout.ts). */
    printing,
    /** Print: a content-fit chart lays out to fill the height it has on the printed page. */
    printFill,
  };
}
