import { withPhysicalSize } from '../../core/pngPhysicalSize';
import type { ExportInput, PngRasterizer } from './types';

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
