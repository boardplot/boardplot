import { renderSvg } from '../../core/svg/renderSvg';
import { exportDocument, exportFilename, isPrepared, prepareExport, idScopeFor, receiptFor } from './frame';
import { utf8Bytes } from './hash';
import { withPageFonts } from './fonts';
import type { ExportInput, ExportResult } from './types';

export async function exportSvg(input: ExportInput): Promise<ExportResult> {
  return svgArtifact(await prepareExport(input), input.embedFonts);
}

/** The SVG of one prepared layout; PNG export paints this same text instead of laying out again. */
export async function svgArtifact(prepared: Awaited<ReturnType<typeof prepareExport>>, embedFonts = true): Promise<ExportResult> {
  if (!isPrepared(prepared)) return prepared;
  const idScope = await idScopeFor(prepared);
  // A file opened elsewhere draws the page's web fonts only from a copy inside it.
  const canonical = renderSvg(prepared.geometry, prepared.resolved.theme, { idScope });
  const text = embedFonts === false ? canonical : await withPageFonts(canonical, prepared.resolved.theme.type.family);
  const filename = exportFilename(prepared.name, 'svg');
  const bytes = utf8Bytes(text);
  return {
    ok: true,
    artifact: { format: 'svg', bytes, text, mediaType: 'image/svg+xml', filename },
    document: exportDocument(prepared),
    receipt: await receiptFor(prepared, filename, text),
  };
}
