import { INTERACTIVE_LAYOUT, LIVE_NOTE_SHOW } from '../core/footer';
import { shownNoteKinds } from '../core/notes';
import { linkStaticFooter } from '../core/staticFooter';
import { getChart } from '../core/registry';
import { chartSizing, hostlessHeight } from '../core/sizing';
import { layoutResolvedRequest, measureLayout, type ResolvedChartRequest } from '../core/request';
import type { LayoutResult } from '../core/types/scene';

export type ContainerFit = 'fill' | 'content';

export function containerFit(type: string, fit?: ContainerFit): ContainerFit {
  if (fit !== undefined && fit !== 'fill' && fit !== 'content') throw new Error('fit must be fill or content');
  return fit ?? (getChart(type)?.sizing ?? chartSizing(type)).fit;
}

/** The height a filling chart of this type takes at a width when its host gives it none. */
export function containerHostlessHeight(type: string, width: number, fallbackHeight: number): number {
  return hostlessHeight(getChart(type)?.sizing ?? chartSizing(type), width, fallbackHeight);
}

/** The same request with the height left to the chart, as `measure --width` and the CLI lay out a width alone. */
function withOpenHeight(request: ResolvedChartRequest): ResolvedChartRequest {
  return { ...request, fixed: { ...request.fixed, height: false }, options: { ...request.options, size: { width: request.size.width } } };
}

/**
 * Content fit lays out the box width alone, with the height left to the chart, as
 * `boardplot render --width` and `measure --width` do, and with the static footer: every note
 * the static image prints, in full. The chart's height is its content, so no line budget
 * protects a frame, and a reader of the live chart sees what a reader of its image sees
 * (ChartFooter draws these lines as HTML). It keeps the box width, as the CLI keeps the width
 * it is asked for: at the same width both surfaces draw the same plot at the same height.
 */
export function layoutContainerRequest(request: ResolvedChartRequest, fit?: ContainerFit) {
  if (fit === 'content') {
    linkStaticFooter();
    const open = withOpenHeight(request);
    return measuredRefusal(open, layoutResolvedRequest(open), fit);
  }
  // The note kinds the React footer prints reach the frame through a composing chart too (LIVE_NOTE_SHOW).
  const show = shownNoteKinds(request.options as Parameters<typeof shownNoteKinds>[0]);
  request = { ...request, options: { ...request.options, [INTERACTIVE_LAYOUT]: true, ...(show ? { [LIVE_NOTE_SHOW]: show } : {}) } as typeof request.options };
  return measuredRefusal(request, layoutResolvedRequest(request));
}

/** Fixed frames keep their verified compact floor; open heights use the full-form measurement. */
function measuredRefusal(request: ResolvedChartRequest, result: LayoutResult, fit?: ContainerFit): LayoutResult {
  return result.refused && (fit === 'content' || !request.fixed.height) ? measureLayout(request, result).refused! : result;
}
