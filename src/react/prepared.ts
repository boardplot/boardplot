import { ENGINE_REV } from '../core/engine';
import { drawnRequest } from '../core/drawnRequest';
import type { InteractionRecord } from '../core/a11y/types';
import type { Theme, ThemeRef } from '../core/types/theme';
import type { ResolvedChartRequest } from '../core/request';
import { defaultMeasurer } from '../core/text';
import type { Geometry, LayoutResult, RefusedLayout } from '../core/types/scene';
import type { OverlayInputs } from './hover/placement';
import { chartRefusals, refusalFindings, type RefusalFinding } from '../core/schema/refusals';
import { footerFrame, type FooterFrame } from './footerFrame';
import type { PreparedRows } from './rowsStore';

export interface PreparedHeader {
  engineRev: number;
  requestKey: string;
  /** React container sizing input; absent for an explicit frame. */
  fit?: 'fill' | 'content';
  /**
   * The resolved theme, present when the request patched one. A per-type
   * entry fetches the checks a patched theme runs; with this it hydrates the
   * snapshot while they load instead of drawing the busy placeholder.
   */
  theme?: Theme;
}

export type RenderGeometry = Pick<Geometry, 'type' | 'size' | 'scene' | 'legend' | 'a11y' | 'sizing' | 'mode' | 'presentation' | 'story'> & {
  refused?: false;
  /** Canonical findings survive server preparation. Host observations never enter this value. */
  warnings?: Geometry['warnings'];
  /** Axis mapping lets hydration attach zoom without another layout. */
  axes?: Geometry['axes'];
  /** Why the chart is refused, as the CLI prints it; the component draws the error card. */
  refusals?: RefusalFinding[];
  /** The footer fields of the frame, so the component draws the notes as HTML (footer rule). */
  frame?: FooterFrame;
};

export function isFullGeometry(result: RenderGeometry): result is Geometry {
  return 'marks' in result && 'derived' in result && 'debug' in result;
}

export interface PreparedChart extends PreparedHeader {
  kind: 'svg';
  result: RenderGeometry | RefusedLayout;
  records?: InteractionRecord[];
  /** Safe placement inputs for interactive attachment without layout. */
  overlay?: OverlayInputs;
  paintThemes?: Array<{ prefix: string; theme: ThemeRef }>;
  /** The data `prepareChart` mapped from `rows`: the chart draws it until the rows chunk loads. */
  rows?: PreparedRows;
}

/** Sorted JSON also rejects values that would silently change during transport. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint' ||
        (typeof item === 'number' && !Number.isFinite(item))) {
      throw new Error('Prepared charts require JSON-safe request and render values.');
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]]));
    }
    return item;
  });
}

/** Opaque 64-bit FNV-1a over UTF-8, not a receipt or authentication mechanism. */
export function requestRenderKey(request: ResolvedChartRequest): string {
  if (request.fontMetrics !== defaultMeasurer ||
      (request.options.measure !== undefined && request.options.measure !== defaultMeasurer)) {
    throw new Error('Prepared charts do not support custom font metric functions.');
  }
  const { measure: _measure, ...options } = request.options;
  const json = canonicalJson({
    type: request.type, target: request.target, fixed: request.fixed, data: request.data, options, annotations: request.annotations,
    theme: request.theme, locale: request.locale, scope: request.scope, size: request.size,
  });
  return `render:${fnv64(json)}`;
}

/** 64-bit FNV-1a over the UTF-8 bytes, as 16 hex digits. */
export function fnv64(json: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(json)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function assertPreparedRequest(header: PreparedHeader, request: ResolvedChartRequest): void {
  if (header.engineRev !== ENGINE_REV) {
    throw new Error(`Prepared chart engine revision ${header.engineRev} does not match ${ENGINE_REV}.`);
  }
  if (header.requestKey !== requestRenderKey(request)) {
    throw new Error('Prepared chart does not match the resolved request.');
  }
}

export function prepareChartRender(request: ResolvedChartRequest, layout: LayoutResult): PreparedChart {
  if (request.options.debug) throw new Error('Prepared charts do not support debug output.');
  const requestKey = requestRenderKey(request);
  if (layout.type !== drawnRequest(request, layout).type) throw new Error('Prepared chart layout type does not match the request.');
  const result = layout.refused ? {
    refused: true, type: layout.type, title: layout.title, size: layout.size,
    sizing: layout.sizing, warnings: layout.warnings,
  } : {
    type: layout.type, size: layout.size, scene: layout.scene, legend: layout.legend, a11y: layout.a11y,
    sizing: layout.sizing, mode: layout.mode, axes: layout.axes,
    presentation: layout.presentation, warnings: layout.warnings,
    ...(layout.story ? { story: layout.story } : {}),
    ...(footerFrame(layout.frame) ? { frame: footerFrame(layout.frame) } : {}),
    ...refusalsOf(layout),
  };
  return JSON.parse(canonicalJson({ kind: 'svg', engineRev: ENGINE_REV, requestKey, result })) as PreparedChart;
}

function refusalsOf(layout: Geometry): { refusals?: RefusalFinding[] } {
  const refusals = refusalFindings(chartRefusals(layout.warnings));
  return refusals.length ? { refusals } : {};
}
