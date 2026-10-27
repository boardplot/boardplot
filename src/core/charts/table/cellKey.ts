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
