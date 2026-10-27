import type { StickyLabels } from '../../types/table';

/** What `stickyLabels` asks for, with every default filled in. `on` is false where nothing pins. */
interface StickySettings {
  on: boolean;
  head: 'table' | 'page' | false;
  columns: number;
  top: number;
  sections: boolean;
}

/** `true` and a number keep the 0.27 meaning: the head pins in the table's scroll box and `columns` leading columns pin. */
export function stickySettings(value: StickyLabels | undefined): StickySettings {
  if (value === undefined || value === false) return { on: false, head: false, columns: 0, top: 0, sections: false };
  if (typeof value === 'object') {
    const head = value.head === undefined ? 'table' : value.head;
    const columns = Math.max(0, Math.floor(value.columns ?? 1));
    const sections = value.sections === true;
    return { on: columns > 0 || head !== false || sections, head, columns, top: head === 'page' ? Math.max(0, value.top ?? 0) : 0, sections };
  }
  const columns = value === true ? 1 : Math.max(0, Math.floor(value));
  return { on: columns > 0, head: 'table', columns, top: 0, sections: false };
}
