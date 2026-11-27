import { ENGINE_REV } from '../core/engine';
import { drawnRequest } from '../core/drawnRequest';
import type { InteractionRecord } from '../core/a11y/types';
import type { Theme, ThemeRef } from '../core/types/theme';
import type { ResolvedChartRequest } from '../core/request';
import { defaultMeasurer } from '../core/text';
import type { Geometry, LayoutResult, Paint, RefusedLayout, SceneNode } from '../core/types/scene';
import type { OverlayInputs } from './hover/placement';
import { chartRefusals, refusalFindings, type RefusalFinding } from '../core/schema/refusals';
import { footerFrame, type FooterFrame } from './footerFrame';
import type { PreparedRows } from './rowsStore';
import { canonicalJson, fnv64 } from './canonicalJson';
import { matrixInk, preparedResult } from './preparedInput';

export { canonicalJson, fnv64, preparedResult };

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
  /** The value matrices of the scene's labels, each listed once; a label holds its index (see `sharedMatrices`). Read the scene through `preparedResult`. */
  matrices?: Paint[][];
  /** The data `prepareChart` mapped from `rows`: the chart draws it until the rows chunk loads. */
  rows?: PreparedRows;
  /** The keys of the pages that show this chart in their first frame, see `preparedInputKey`. */
  inputKeys?: string[];
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

export function assertPreparedRequest(header: PreparedHeader, request: ResolvedChartRequest): void {
  if (header.engineRev !== ENGINE_REV) {
    throw new Error(`Prepared chart engine revision ${header.engineRev} does not match ${ENGINE_REV}.`);
  }
  if (header.requestKey !== requestRenderKey(request)) {
    throw new Error('Prepared chart does not match the resolved request.');
  }
}

export function prepareChartRender(request: ResolvedChartRequest, layout: LayoutResult): PreparedChart {
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
  if (layout.refused) return JSON.parse(canonicalJson({ kind: 'svg', engineRev: ENGINE_REV, requestKey, result })) as PreparedChart;
  const { scene, matrices } = sharedMatrices(layout.scene);
  return JSON.parse(canonicalJson({ kind: 'svg', engineRev: ENGINE_REV, requestKey, result: { ...result, scene }, ...(matrices.length ? { matrices } : {}) })) as PreparedChart;
}

/**
 * Every value of a heatmap or cohort matrix carries the matrix's fills (the contrast-ink recipe's `matrix`), one list
 * shared by all of them. JSON would copy it into each label. The prepared chart lists each matrix once and a label holds its index.
 */
function sharedMatrices(scene: SceneNode[]): { scene: SceneNode[]; matrices: Paint[][] } {
  const matrices: Paint[][] = [];
  return { matrices, scene: scene.map((node) => {
    const ink = matrixInk(node);
    if (!ink) return node;
    const matrix = ink.theme.matrix as Paint[];
    const index = matrices.includes(matrix) ? matrices.indexOf(matrix) : matrices.push(matrix) - 1;
    return { ...node, ink: { ...ink, theme: { ...ink.theme, matrix: index } } } as unknown as SceneNode;
  }) };
}

function refusalsOf(layout: Geometry): { refusals?: RefusalFinding[] } {
  const refusals = refusalFindings(chartRefusals(layout.warnings));
  return refusals.length ? { refusals } : {};
}
