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

/**
 * Whether a computed cell record's number is the figure its cell prints: a calc or a total, a share after the
 * rounding adjustment (the cell prints the adjusted amount), or the sum of the children where the author's total
 * prints as that sum in the cell's own format. A rounding gap and an unaudited total print no number of their own.
 */
export function printsInCell(record: { kind: string; op: string; printedInCell?: true }): boolean {
  switch (record.kind) {
    case 'calc':
    case 'aggregate':
      return true;
    case 'rounding-adjustment':
      return record.op === 'share-reconcile';
    case 'reconciliation':
      return record.printedInCell === true;
    default:
      return false;
  }
}
