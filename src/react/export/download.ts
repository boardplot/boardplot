import type { ExportFailed, ExportFormat, ExportResult, ExportUnsupported } from './types';

function unsupported(format: ExportFormat): ExportUnsupported {
  return { ok: false, code: 'unsupported', format, message: 'Downloads need a browser document.' };
}

function failed(error: unknown): ExportFailed {
  return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) };
}

/** Ask the browser to download a finished artifact and return the result. */
export function downloadArtifact(result: ExportResult): ExportResult {
  if (!result.ok) return result;
  const { artifact } = result;
  if (typeof document === 'undefined' || !document.body) return unsupported(artifact.format);
  try {
    const link = document.createElement('a');
    const blob = new Blob([new Uint8Array(artifact.bytes)], { type: artifact.mediaType });
    const url = URL.createObjectURL(blob);
    try {
      link.href = url;
      link.download = artifact.filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
    } finally {
      link.remove();
      // The browser reads the Blob URL after the click handler returns.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return result;
  } catch (error) {
    return failed(error);
  }
}

export async function downloadExport(format: ExportFormat, run: () => Promise<ExportResult>): Promise<ExportResult> {
  if (typeof document === 'undefined') return unsupported(format);
  try {
    return downloadArtifact(await run());
  } catch (error) {
    return failed(error);
  }
}
