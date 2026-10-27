/**
 * The link between a drawn chart and `useExport()` from `boardplot/react/export`:
 * `<ColumnChart exporter={handle} />` hands the handle what the chart drew,
 * so an export lays out the request the screen resolved, at the frame it drew.
 * The chart components import only this module, never the export code.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { ResolvedChartRequest } from '../core/request';
import type { StorySpec } from '../core/types/options';

/** What a chart drew: the request it resolved for the screen and the frame the export lays it out in. */
export interface DrawnChart {
  /** The resolved request of the drawing on screen, reader state included (story step, folds, visible columns). */
  request: ResolvedChartRequest;
  /** The authored data the request was resolved from: the exported document carries it. */
  data: unknown;
  /** The frame in layout px; without it the export keeps the request's own frame. No height leaves it to the chart. */
  frame?: { width: number; height?: number };
  /** The chart pinned its height on screen; without it the export takes the height its notes need. */
  pinnedHeight: boolean;
  /** The authored request the exported document carries when `request` was compiled from another type (DimSwitch), with the reader's view in it. */
  source?: { type: string; data: unknown; options: Record<string, unknown> };
}

/** One registry key for every copy of this module on a page. */
export const EXPORT_LINK: unique symbol = Symbol.for('boardplot.exportLink') as never;

/** The `exporter` prop: the object `useExport()` returns. */
export interface ExportLink {
  readonly [EXPORT_LINK]: (owner: object, drawn: DrawnChart | undefined) => void;
}

/**
 * Reports `drawn` to the exporter after each commit, and withdraws it when
 * the chart unmounts or stops drawing. A render React drops never reaches it.
 */
export function useExportLink(exporter: ExportLink | undefined, drawn: DrawnChart | undefined): void {
  const owner = useRef({}).current;
  useEffect(() => {
    if (!exporter) return undefined;
    exporter[EXPORT_LINK](owner, drawn);
    return () => exporter[EXPORT_LINK](owner, undefined);
  }, [exporter, drawn, owner]);
}

/**
 * A chart component's snapshot: the request its drawing on screen resolved,
 * `undefined` while it shows a refusal, the busy box or an older drawing.
 * `reframe` (a container chart, a chart drawn wider in its scroll box) takes
 * the drawn width, and the drawn height only where it is pinned. The story
 * step the reader moved to becomes the static step.
 */
export function useChartExport(exporter: ExportLink | undefined, request: ResolvedChartRequest | undefined, data: unknown,
  size: { width: number; height: number } | undefined, reframe: boolean, pinnedHeight: boolean, storyStep: string | undefined): void {
  const drawn = useMemo((): DrawnChart | undefined => {
    if (!exporter || !request || !size) return undefined;
    const story = (request.options as { story?: StorySpec }).story;
    const stepped = storyStep !== undefined && story?.steps.some((step) => step.id === storyStep)
      ? { ...request, options: { ...request.options, story: { ...story, step: storyStep } } } : request;
    return { request: stepped, data, pinnedHeight, ...(reframe ? { frame: { width: size.width, ...(pinnedHeight ? { height: size.height } : {}) } } : {}) };
  }, [exporter, request, data, size?.width, size?.height, reframe, pinnedHeight, storyStep]);
  useExportLink(exporter, drawn);
}
