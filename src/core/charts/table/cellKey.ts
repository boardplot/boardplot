// The row length prefix makes the key one-to-one: ('a:b', 'c') and ('a', 'b:c') differ.
export const tableCellKey = (rowId: string, colId: string): string =>
  `${rowId.length}:${rowId}:${colId}`;

const ESCAPED = /[%:]/;
const scenePart = (id: string): string =>
  ESCAPED.test(id) ? id.replaceAll('%', '%25').replaceAll(':', '%3A') : id;
export const tableCellNodeId = (part: string, rowId: string, colId: string, lineId?: string): string =>
  lineId === undefined
    ? `${part}:${scenePart(rowId)}:${scenePart(colId)}`
    : `${part}:${scenePart(rowId)}:${scenePart(colId)}:${scenePart(lineId)}`;

/** Float noise from magnitude math (bn-scale): a gap this small between two figures is no disagreement. */
export const floatNoise = (a: number, b: number): number => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Whether a computed cell record's number is the figure its cell prints: a calc or a total, a share after the
 * rounding adjustment, or the sum of the children where the author's total in the cell matches it. A rounding
 * gap and an unaudited total print no number of their own.
 */
export function printsInCell(record: { kind: string; op: string; raw: number | null }, cellRaw: unknown): boolean {
  switch (record.kind) {
    case 'calc':
    case 'aggregate':
      return true;
    case 'rounding-adjustment':
      return record.op === 'share-reconcile';
    case 'reconciliation':
      return record.raw !== null && typeof cellRaw === 'number' && Math.abs(record.raw - cellRaw) <= floatNoise(record.raw, cellRaw);
    default:
      return false;
  }
}
