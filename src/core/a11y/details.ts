import { isDateCell, type Cell } from '../types/cell';
import type { DetailField } from '../types/options';
import { numericValue, textValue } from './recordsShared';
import type { InteractionRecord } from './types';

/**
 * A cell's details as record fields, which the hover card and the keyboard
 * reading list after the record's own facts: the keys `detailFields`
 * declares first, in its order, then the cell's other keys in their own
 * order, labelled with the key. The record key is `detail:<key>`, so an
 * authored `date` never meets the card's own date field.
 */
export function detailRecordFields(options: { detailFields?: readonly DetailField[] }, cell: Cell | undefined): InteractionRecord['fields'] {
  const details = cell !== null && typeof cell === 'object' && !isDateCell(cell) ? cell.details : undefined;
  if (!details) return [];
  const declared = options.detailFields ?? [];
  const keys = [...declared.map(field => field.key).filter(key => Object.hasOwn(details, key)),
    ...Object.keys(details).filter(key => !declared.some(field => field.key === key))];
  return keys.map(key => {
    const field = declared.find(entry => entry.key === key);
    const raw = details[key];
    return { key: `detail:${key}`, label: field?.label ?? key,
      value: typeof raw === 'string' ? textValue(raw) : numericValue(raw, field?.unit, field?.format) };
  });
}
