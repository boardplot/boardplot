import { linkStaticFooter } from '../../core/staticFooter';
import { claimsForChart, type ClaimRecordV1 } from '../../core/claims/browser';
import { resolveTargetTheme } from '../../core/theme';
import { textScaleOf, textSizeOf } from '../../core/typeFloors';
import { INTERACTIVE_LAYOUT } from '../../core/footer';
import { canonicalJson } from '../../core/claims/canonical';
import { buildManifest, type ManifestV1 } from '../../core/claims/manifest';
import { interactionRecords } from '../../core/a11y/records';
import type { InteractionRecord } from '../../core/a11y/types';
import {
  layoutResolvedRequest,
  type ChartRequest,
  type ResolvedChartRequest,
} from '../../core/request';
import { chartRefusals, isRefused, isSizeDependentRefusal } from '../../core/schema/refusals';
import { resolveTargetSize } from '../../core/target';
import type { Geometry, RefusedLayout } from '../../core/types/scene';
import { resolveThemeRequest } from '../themeRequest';
import { parseChartSpec, requestChartTypes } from '../parseChartSpec';
import { loadChartTypes } from '../loadChartTypes';
import { sha256Hex } from './hash';
import { authoredLocale } from '../../core/numberMarks';
import type { ArtifactBytesReceipt, ExportFailed, ExportInput, ExportUnsupported } from './types';
import type { DrawnChart } from '../exportLink';

/** Set by `useExport` when a chart holds the handle: what that chart drew. */
export const DRAWN: unique symbol = Symbol('drawn') as never;
export type DrawnExportInput = ExportInput & { [DRAWN]?: DrawnChart };

interface PreparedExport {
  name: string;
  request: ChartRequest;
  resolved: ResolvedChartRequest;
  geometry: Geometry;
  records: InteractionRecord[];
  claims: ClaimRecordV1[];
}


function fileStem(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return safe || 'chart';
}

export function exportFilename(name: string, extension: string): string {
  return `${fileStem(name)}.${extension}`;
}

async function resolveCallerRequest(input: ExportInput): Promise<ChartRequest & { name: string }> {
  if (input.spec !== undefined) {
    const parsed = await parseChartSpec(input.spec, input.chart);
    const request = input.request
      ? {
          ...parsed.request,
          ...input.request,
          data: input.request.data ?? parsed.request.data,
          options: { ...parsed.request.options, ...input.request.options },
          annotations: input.request.annotations ?? parsed.request.annotations,
        }
      : parsed.request;
    return { ...request, name: parsed.name };
  }
  if (input.request) {
    return { ...input.request, name: input.chart ?? input.request.scope?.chart ?? input.request.type };
  }
  throw new Error('useExport needs spec or request');
}

function sourceEnvelope(request: ChartRequest): { type: string; data: unknown; options: unknown } {
  return { type: request.type, data: request.data, options: request.options ?? {} };
}

/** Keep the serializable effective options used by this frame, including inherited context. */
function effectiveRequest(request: ChartRequest, resolved: ResolvedChartRequest): ChartRequest {
  const { measure: _measure, ...options } = resolved.options;
  // The source keeps the locale as written: the marks tag is internal (numberMarks.ts).
  const locale = authoredLocale(options.locale);
  if (locale === undefined) delete options.locale;
  else options.locale = locale;
  if (canonicalJson(resolveTargetTheme(options.theme, resolved.target, textScaleOf(options), textSizeOf(options))) !== canonicalJson(resolved.theme)) {
    const ref = options.theme;
    options.theme = { preset: typeof ref === 'string' ? ref : ref?.preset ?? 'boardroom', overrides: resolved.theme };
  }
  return { ...request, options };
}

function layoutFrame(request: ChartRequest, context: ExportInput['context']): PreparedExport['geometry'] | ExportFailed {
  linkStaticFooter();
  const resolved = resolveThemeRequest(request, context ?? {});
  const geometry = layoutResolvedRequest(resolved);
  return isRefused(geometry) ? refusal(geometry) : geometry as Geometry;
}

/** Export refuses what render refuses: a size refusal or an error lint. */
function refusal(geometry: Pick<RefusedLayout, 'type' | 'warnings'>): ExportFailed {
  return {
    ok: false,
    code: 'refused',
    message: chartRefusals(geometry.warnings)[0]?.message ?? `Layout refused '${geometry.type}'.`,
    warnings: geometry.warnings,
  };
}

/** The static layout of a drawn request; a size refusal stays a layout, so the export can retry at another frame. */
function layoutDrawn(request: ResolvedChartRequest): Geometry | RefusedLayout | ExportFailed {
  linkStaticFooter();
  const geometry = layoutResolvedRequest(request);
  if (geometry.refused === true) return geometry as RefusedLayout;
  return isRefused(geometry) ? refusal(geometry) : geometry as Geometry;
}

function isSizeRefusal(layout: Geometry | RefusedLayout | ExportFailed): layout is RefusedLayout {
  return !('ok' in layout) && layout.refused === true;
}

/** The request at a frame in layout px; a frame without a height leaves the height to the chart. */
function atFrame(request: ResolvedChartRequest, frame: { width: number; height?: number }): ResolvedChartRequest {
  const { sizePx, fixed } = resolveTargetSize(request.target, frame);
  return { ...request, size: sizePx, fixed, options: { ...request.options, size: frame } };
}

/** Settings the frame and the provider decide; a compiled chart's document takes them from what drew. */
const FRAME_KEYS = ['theme', 'locale', 'target', 'size', 'textScale', 'textSize', 'strings'] as const;

/** The authored request of a compiled chart (DimSwitch), with the frame and provider settings of the drawn one. */
function sourceDocument(source: NonNullable<DrawnChart['source']>, effective: ChartRequest): ChartRequest {
  const drawn = (effective.options ?? {}) as Record<string, unknown>;
  const frame = Object.fromEntries(FRAME_KEYS.filter((key) => drawn[key] !== undefined).map((key) => [key, drawn[key]]));
  return { type: source.type, data: source.data, options: { ...source.options, ...frame } };
}

/**
 * A chart that holds the handle: its export lays out the request the screen
 * resolved (theme, provider, units, font metrics and reader state already in
 * it) as a static chart, at the frame the screen drew. It refuses only what
 * the screen would refuse at that frame.
 */
async function prepareDrawn(input: ExportInput, drawn: DrawnChart): Promise<PreparedExport | ExportFailed> {
  // This entry links no chart core: load the chart's own and, for a grid, its panels'.
  await loadChartTypes(requestChartTypes(drawn.request.type, drawn.data), { schemas: false, cores: true });
  // A live chart lays out its notes as a button; the export prints them.
  const { [INTERACTIVE_LAYOUT]: _interactive, ...options } = drawn.request.options as
    ResolvedChartRequest['options'] & { [INTERACTIVE_LAYOUT]?: boolean };
  let request: ResolvedChartRequest = { ...drawn.request, options };
  if (drawn.frame) request = atFrame(request, drawn.frame);
  let layout = layoutDrawn(request);
  // A chart refused for width alone scrolls on screen (a wide table, a
  // cohort): the export takes the width it scrolls at.
  if (isSizeRefusal(layout) && layout.sizing.minWidth > layout.size.width && chartRefusals(layout.warnings).every(isSizeDependentRefusal)) {
    request = atFrame(request, { width: Math.ceil(layout.sizing.minWidth), ...(request.fixed.height ? { height: layout.size.height } : {}) });
    layout = layoutDrawn(request);
  }
  // A chart drawn at a pinned height keeps it; where the notes the SVG prints
  // need more room than the notes button on screen, the export takes the
  // height they need at the same width.
  if (isSizeRefusal(layout) && drawn.pinnedHeight && layout.warnings.some((warning) => warning.code === 'size-below-floor')) {
    request = atFrame(request, { width: layout.size.width });
    layout = layoutDrawn(request);
  }
  if (isSizeRefusal(layout)) return refusal(layout);
  if ('ok' in layout) return layout;
  const claims = claimsForChart(request.type, layout);
  const effective = effectiveRequest({ type: request.type, data: drawn.data }, request);
  return {
    name: input.chart ?? request.scope.chart,
    request: drawn.source ? sourceDocument(drawn.source, effective) : effective,
    resolved: request,
    geometry: layout,
    records: interactionRecords({ request, geometry: layout, scope: request.scope, claims }),
    claims,
  };
}

/**
 * A component's `size: 'container'` has no frame outside the page: the
 * export takes the frame the component draws before it measures, its
 * `fallbackSize` or the default size.
 */
function exportFrame(request: ChartRequest): ChartRequest {
  // A request from a live chart must run static layout again for export.
  const { [INTERACTIVE_LAYOUT]: _interactive, ...staticOptions } = request.options as
    (NonNullable<ChartRequest['options']> & { [INTERACTIVE_LAYOUT]?: boolean }) ?? {};
  request = { ...request, options: staticOptions };
  const options = request.options as { size?: unknown; fit?: unknown; fallbackSize?: ChartRequest['size'] } | undefined;
  if ((request.size as unknown) !== 'container' && options?.size !== 'container') return request;
  const { size: _size, fit: _fit, fallbackSize, ...rest } = options ?? {};
  return { ...request, size: fallbackSize, options: rest };
}

export async function prepareExport(input: ExportInput): Promise<PreparedExport | ExportFailed | ExportUnsupported> {
  // An invalid request (a size preset, a theme, data the schema refuses)
  // answers `invalid`; it rejected the whole promise before.
  try {
    const drawn = (input as DrawnExportInput)[DRAWN];
    if (drawn) return await prepareDrawn(input, drawn);
    const { name, ...named } = await resolveCallerRequest(input);
    const sourceRequest = exportFrame(named);
    // Validate the final chart payload, including overrides of a parsed spec.
    // Export names can contain characters that bare-spec names refuse.
    // The measurer is a TypeScript callback, outside the shared JSON schema.
    const { measure: _measure, ...authored } = sourceRequest.options ?? {};
    await parseChartSpec({
      name: 'chart', type: sourceRequest.type, data: sourceRequest.data,
      options: {
        ...authored,
        ...(sourceRequest.theme === undefined ? {} : { theme: sourceRequest.theme }),
        ...(sourceRequest.locale === undefined ? {} : { locale: typeof sourceRequest.locale === 'string' ? { language: sourceRequest.locale } : sourceRequest.locale }),
        ...(sourceRequest.target === undefined ? {} : { target: sourceRequest.target }),
        ...(sourceRequest.textScale === undefined ? {} : { textScale: sourceRequest.textScale }),
        ...(sourceRequest.textSize === undefined ? {} : { textSize: sourceRequest.textSize }),
        ...(sourceRequest.size === undefined ? {} : { size: sourceRequest.size }),
      },
      ...(sourceRequest.annotations === undefined ? {} : { annotations: sourceRequest.annotations }),
    });
    // This entry links no chart core: load the chart's own and, for a grid, its panels'.
    await loadChartTypes(requestChartTypes(sourceRequest.type, sourceRequest.data), { schemas: false, cores: true });
    const first = layoutFrame(sourceRequest, input.context);
    if ('ok' in first) return first;
    const resolved = resolveThemeRequest(sourceRequest, input.context ?? {});
    const claims = claimsForChart(resolved.type, first);
    return {
      name,
      request: effectiveRequest(sourceRequest, resolved),
      resolved,
      geometry: first,
      records: interactionRecords({ request: resolved, geometry: first, scope: resolved.scope, claims }),
      claims,
    };
  } catch (error) {
    return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) };
  }
}

export function exportDocument(prepared: PreparedExport): unknown {
  const request = prepared.request;
  return {
    version: 1,
    charts: [{
      name: prepared.name,
      type: request.type,
      data: request.data,
      ...(request.options === undefined ? {} : { options: request.options }),
      ...(request.annotations === undefined ? {} : { annotations: request.annotations }),
    }],
  };
}

/** The receipt's source hash. */
async function sourceSha256(prepared: PreparedExport): Promise<string> {
  return sha256Hex(canonicalJson(sourceEnvelope(prepared.request)));
}

/**
 * Id scope for an exported SVG: a hash of the exported document, which holds
 * everything that shapes the drawing (source, annotations, the effective theme
 * and size). Two different exports inlined into one page never share an id,
 * and re-exporting from the document reproduces the same bytes.
 */
export async function idScopeFor(prepared: PreparedExport): Promise<string> {
  return (await sha256Hex(canonicalJson(exportDocument(prepared)))).slice(0, 10);
}

export async function receiptFor(
  prepared: PreparedExport,
  filename: string,
  bytes: Uint8Array | string,
): Promise<ManifestV1> {
  const resolved = prepared.resolved;
  return buildManifest([{
    chart: prepared.name,
    type: resolved.type,
    artifact: filename,
    artifactSha256: await sha256Hex(bytes),
    sourceSha256: await sourceSha256(prepared),
    themeSha256: await sha256Hex(canonicalJson(resolved.theme)),
    claims: prepared.claims,
  }]);
}

/** Non-SVG formats get a receipt over their bytes only. */
export async function bytesReceiptFor(filename: string, bytes: Uint8Array, mimeType: string): Promise<ArtifactBytesReceipt> {
  return {
    kind: 'export-sidecar',
    artifact: filename,
    artifactSha256: await sha256Hex(bytes),
    byteLength: bytes.length,
    mimeType,
    coverage: 'artifact-bytes-only',
  };
}

export function isPrepared(value: PreparedExport | ExportFailed | ExportUnsupported): value is PreparedExport {
  return !('ok' in value);
}
