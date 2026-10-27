import { exportCsv } from './csv';
import { rasterizerFor, renderPng } from './png';
import { exportSvg } from './svg';
import type { ExportInput, ExportOk, ExportResult } from './types';

function clipboardError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type });
}

/** Everything up to the clipboard call runs synchronously, so a caller that has not awaited yet writes inside the user's gesture. */
async function writeClipboard(items: Record<string, Blob | Promise<Blob>> | string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return { ok: false, error: 'Clipboard is not available in this environment.' };
    }
    if (typeof items === 'string') {
      await navigator.clipboard.writeText(items);
      return { ok: true };
    }
    if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard.write !== 'function') {
      return { ok: false, error: 'ClipboardItem is not available in this browser.' };
    }
    await navigator.clipboard.write([new ClipboardItem(items)]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: clipboardError(error) };
  }
}

function withClipboard(result: ExportResult, clipboard: ExportOk['clipboard']): ExportResult {
  if (!result.ok) return result;
  return { ...result, clipboard };
}

/**
 * The clipboard write starts before the first await, with the PNG as a
 * pending blob: Safari refuses a write that begins after the gesture's task
 * has ended, and the old order rendered first and wrote after.
 */
export async function copyImage(input: ExportInput, scale = 2): Promise<ExportResult> {
  const rendered = renderPng(input, scale);
  const written = rasterizerFor(input) === undefined ? undefined : (() => {
    const blob = rendered.then(({ png }) => png.ok ? blobFromBytes(png.artifact.bytes, 'image/png') : Promise.reject(new Error(png.message)));
    blob.catch(() => {});
    return writeClipboard({ 'image/png': blob });
  })();
  const { png, svg } = await rendered;
  if (png.ok) return withClipboard(png, await written);
  await written;
  if (png.code !== 'unsupported') return png;
  // The SVG the failed raster was painted from; without a rasterizer nothing was laid out yet.
  const fallback = svg ?? await exportSvg(input);
  if (!fallback.ok) return fallback;
  return withClipboard(fallback, await writeClipboard({ 'image/svg+xml': blobFromBytes(fallback.artifact.bytes, 'image/svg+xml') }));
}

export async function copyData(input: ExportInput): Promise<ExportResult> {
  const csv = await exportCsv(input);
  if (!csv.ok) return csv;
  return withClipboard(csv, await writeClipboard(csv.artifact.text ?? ''));
}
