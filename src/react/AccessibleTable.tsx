import { chartString } from '../core/strings/AccessibleTable';
import { useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import { useScopedId } from './idPrefix';
import type { A11yDataTable, A11yTablePlacement } from '../core/a11y/accessibility';

/**
 * The spec-derived accessible data table. Every string comes from the
 * existing interaction records, so a unit, a missing state or a withheld value
 * reads the way the rest of the surface reads it. Nothing is recomputed here.
 */

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  fontSize: 'inherit',
  inlineSize: '100%',
};

function captionOf(table: A11yDataTable): ReactElement | undefined {
  return table.rows.length === 0 ? undefined : <caption>{table.caption}</caption>;
}

function headerRow(table: A11yDataTable): ReactElement | undefined {
  if (table.columns.length === 0) return undefined;
  return (
    <tr>
      <th scope="col">{chartString({ locale: { language: table.locale } }, 'category')}</th>
      {table.columns.map((column) => (
        <th key={column.key} scope="col">
          {column.unit === undefined ? column.label : `${column.label} (${column.unit})`}
        </th>
      ))}
    </tr>
  );
}

function bodyRows(table: A11yDataTable): ReactElement[] {
  return table.rows.map((row) => (
    <tr key={row.id}>
      <th scope="row" data-bp-level={row.level} style={{ paddingInlineStart: 8 + row.level * 12, textAlign: 'start' }}>
        {row.header}
      </th>
      {row.cells.map((cell, index) => (
        <td key={table.columns[index]?.key ?? index} data-bp-no-record={cell === null ? '' : undefined}>
          {cell === null ? '' : cell.text}
        </td>
      ))}
    </tr>
  ));
}

function toggleTableKey(event: KeyboardEvent<HTMLButtonElement>, toggle: () => void): void {
  event.stopPropagation();
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggle();
}

function TableSurface({ table }: { table: A11yDataTable }): ReactElement {
  const head = headerRow(table);
  return (
    <table data-bp-a11y-table="" style={tableStyle}>
      {captionOf(table)}
      {head && <thead>{head}</thead>}
      <tbody>{bodyRows(table)}</tbody>
    </table>
  );
}

export function AccessibleTable({ table, mode }: { table: A11yDataTable; mode: A11yTablePlacement }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const id = useScopedId();
  if (table.rows.length === 0) return null;
  if (mode === 'below') return <div data-bp-a11y-table-below="" style={{ marginBlockStart: 8 }}><TableSurface table={table} /></div>;
  if (mode === 'toggle') {
    return (
      <div data-bp-a11y-table-toggle="">
        <button type="button" aria-expanded={open} aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => toggleTableKey(event, () => setOpen((value) => !value))}>
          {chartString({ locale: { language: table.locale } }, open ? 'hideDataTable' : 'showDataTable')}
        </button>
        <div id={id} hidden={!open}>
          {open && <TableSurface table={table} />}
        </div>
      </div>
    );
  }
  return <div style={visuallyHidden}><TableSurface table={table} /></div>;
}