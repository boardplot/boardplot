import type { InteractionRecord } from '../../core/a11y/types';
import { bytesReceiptFor, exportDocument, exportFilename, isPrepared, prepareExport } from './frame';
import { utf8Bytes } from './hash';
import type { ExportInput, ExportResult } from './types';

function csvCell(value: string): string {
  // Spreadsheet formula prefixes are text unless the entire cell is a plain number.
  const numeric = value.trim() === value && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
  if (/^[=+\-@\t\n\r]/.test(value) && !numeric) value = `'${value}`;
  if (/[",;\t\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function rawCell(record: InteractionRecord): string {
  if (record.value.state !== 'value' || record.value.raw === null) return '';
  return String(record.value.raw);
}

/** Source-line records as CSV. Suppressed and non-value states omit raw. */
function recordsToCsv(records: readonly InteractionRecord[]): string {
  const header = ['id', 'label', 'kind', 'raw', 'state', 'unit', 'displayed'];
  const lines = records.map((record) =>
    [
      record.id,
      record.label,
      record.value.kind,
      rawCell(record),
      record.value.state,
      record.value.unit ?? '',
      record.value.displayed ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return `${[header.join(','), ...lines].join('\n')}\n`;
}

export async function exportCsv(input: ExportInput): Promise<ExportResult> {
  const prepared = await prepareExport(input);
  if (!isPrepared(prepared)) return prepared;
  const text = recordsToCsv(prepared.records);
  const filename = exportFilename(prepared.name, 'csv');
  const bytes = utf8Bytes(text);
  return {
    ok: true,
    artifact: { format: 'csv', bytes, text, mediaType: 'text/csv', filename },
    document: exportDocument(prepared),
    receipt: await bytesReceiptFor(filename, bytes, 'text/csv'),
  };
}
