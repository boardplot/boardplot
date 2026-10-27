import { withPhysicalSize } from '../../core/pngPhysicalSize';
import { bytesReceiptFor, exportFilename, isPrepared, prepareExport } from './frame';
import { withPageFonts } from './fonts';
import { svgArtifact } from './svg';
import type { ExportInput, ExportOk, ExportResult, PngRasterizer } from './types';

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

function loadImage(url: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The canonical SVG could not be decoded for PNG.'));
    image.src = url;
  });
}

/** Rasterize canonical SVG through canvas. This is not a screenshot of the live chart. */
export async function rasterizeCanonicalSvg(
  svg: string,
  size: { width: number; height: number },
  scale: number,
): Promise<Uint8Array> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('PNG raster needs a browser canvas.');
  }
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG raster needs a 2d canvas context.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((next) => (next ? resolve(next) : reject(new Error('canvas.toBlob returned empty'))), 'image/png');
    });
    // 96 dpi times the scale, as the CLI writes it: canvas bytes carry none
    // or 96, and Office placed a scale-2 PNG at twice the chart's size.
    return withPhysicalSize(new Uint8Array(await png.arrayBuffer()), scale);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The rasterizer this call can use, decided without waiting, so a clipboard write can start in the user's gesture. */
export function rasterizerFor(input: ExportInput): PngRasterizer | undefined {
  if (input.rasterizePng) return input.rasterizePng;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return undefined;
  return rasterizeCanonicalSvg;
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
