import type { ManifestV1 } from '../../core/claims/manifest';
import type { ChartRequest } from '../../core/request';
import type { BoardplotThemeOptions } from '../themeContext';
import type { LintWarning } from '../../core/types/scene';

export type ExportFormat = 'svg' | 'png' | 'csv';

export interface ExportArtifact {
  format: ExportFormat;
  bytes: Uint8Array;
  /** Present for svg and csv. */
  text?: string;
  mediaType: string;
  filename: string;
}

export interface ExportOk {
  ok: true;
  artifact: ExportArtifact;
  /** Effective source document, including provider settings. */
  document: unknown;
  /** Sidecar Manifest v1 for SVG; other formats cover artifact bytes only. */
  receipt: ManifestV1 | ArtifactBytesReceipt;
  clipboard?: { ok: true } | { ok: false; error: string };
}

export interface ArtifactBytesReceipt {
  kind: 'export-sidecar';
  artifact: string;
  artifactSha256: string;
  byteLength: number;
  mimeType: string;
  coverage: 'artifact-bytes-only';
}

export interface ExportUnsupported {
  ok: false;
  code: 'unsupported';
  format: ExportFormat;
  message: string;
}

export interface ExportFailed {
  ok: false;
  code: 'refused' | 'invalid';
  message: string;
  warnings?: LintWarning[];
}

export type ExportResult = ExportOk | ExportUnsupported | ExportFailed;

/**
 * Optional PNG raster of canonical SVG bytes. Not a screenshot of the live chart.
 * The export replaces any pHYs with 96 dpi times `scale`, as the CLI writes it.
 */
export type PngRasterizer = (
  svg: string,
  size: { width: number; height: number },
  scale: number,
) => Promise<Uint8Array>;

export interface ExportInput {
  spec?: unknown;
  chart?: string;
  request?: ChartRequest;
  context?: BoardplotThemeOptions;
  rasterizePng?: PngRasterizer;
  /**
   * Copy the page's web fonts the SVG text draws with into the SVG as data:
   * font faces (default true). False writes the canonical SVG, for a host
   * that inlines it in a page that loads the font; the PNG embeds them anyway.
   */
  embedFonts?: boolean;
}
