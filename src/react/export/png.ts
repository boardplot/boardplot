import { withPhysicalSize } from '../../core/pngPhysicalSize';
import { bytesReceiptFor, exportFilename, isPrepared, prepareExport } from './frame';
import { withPageFonts } from './fonts';
import { svgArtifact } from './svg';
import { rasterizerFor } from './raster';
import type { ExportInput, ExportOk, ExportResult } from './types';

const MAX_SCALE = 8;

function scaleError(scale: number): ExportResult | undefined {
  if (!Number.isFinite(scale) || scale <= 0 || scale > MAX_SCALE) {
    return {
      ok: false,
      code: 'invalid',
      message: `--scale needs a number between 0 and 8 (got '${String(scale)}')`,
    };
  }
  return undefined;
}

/** The PNG and the SVG it was painted from, from one layout. */
export async function renderPng(input: ExportInput, scale: number): Promise<{ png: ExportResult; svg?: ExportOk }> {
  const invalid = scaleError(scale);
  if (invalid) return { png: invalid };
  const rasterizer = rasterizerFor(input);
  if (!rasterizer) {
    return { png: {
      ok: false,
      code: 'unsupported',
      format: 'png',
      message:
        'PNG needs a browser canvas, or pass rasterizePng that paints the canonical SVG. This entry does not screenshot the live chart and does not load the CLI Chrome rasteriser.',
    } };
  }
  const prepared = await prepareExport(input);
  const svg = await svgArtifact(prepared, input.embedFonts);
  if (!svg.ok || !isPrepared(prepared)) return { png: svg };
  let bytes: Uint8Array;
  try {
    // A host rasterizer gets the same pHYs as the canvas and the CLI, so
    // every PNG places at the chart's natural size.
    // An SVG drawn through an image loads no font from the page: the copy it paints carries them.
    const painted = input.embedFonts === false ? await withPageFonts(svg.artifact.text!, prepared.resolved.theme.type.family) : svg.artifact.text!;
    bytes = withPhysicalSize(await rasterizer(painted, prepared.geometry.size, scale), scale);
  } catch (error) {
    return { png: {
      ok: false,
      code: 'unsupported',
      format: 'png',
      message: error instanceof Error ? error.message : String(error),
    }, svg };
  }
  const filename = exportFilename(prepared.name, 'png');
  return { png: {
    ok: true,
    artifact: { format: 'png', bytes, mediaType: 'image/png', filename },
    document: svg.document,
    receipt: await bytesReceiptFor(filename, bytes, 'image/png'),
  }, svg };
}

export async function exportPng(input: ExportInput, scale: number): Promise<ExportResult> {
  return (await renderPng(input, scale)).png;
}
