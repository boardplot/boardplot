import { labelOn } from '../labelOn';
import type { BulletOptions } from '../../types/options';
import type { ShownTexts } from '../../types/scene';

/** A number column of a bullet row. */
export type BulletColumn = 'actual' | 'target' | 'gap' | 'share' | 'delta';

/**
 * The record values a printed bullet column fills, with the text it prints
 * (ShownTexts), as the row's record names them (a11y/businessRecords.ts,
 * bullet): the column the record leads with is `value`, the target is
 * `field:target`, and a gap or delta is the comparison's change while the
 * row compares its value with its target (`cmp0.delta`), else a field of its
 * own column, as the share is. A slot the record does not have takes nothing.
 */
export function bulletColumnShows(options: BulletOptions, anyValue: boolean, anyTarget: boolean): (column: BulletColumn, text: string) => ShownTexts {
  const pointOn = labelOn(options, 'point');
  const noteOn = labelOn(options, 'annotation');
  const drawn: BulletColumn[] = options.sharedScale === 'percentOfTarget'
    ? [...(pointOn ? ['actual', 'share'] as const : []), ...(noteOn ? ['delta'] as const : [])]
    : [...(pointOn && anyValue ? ['actual'] as const : []), ...(noteOn && anyTarget ? ['target', 'gap'] as const : [])];
  const removed = (id: BulletColumn) => drawn.includes(id) && options.columnVisibility?.[id] === false;
  // With the actual column gone, the record leads with the first number the row still prints.
  const leads: BulletColumn = removed('actual')
    ? (['target', 'gap', 'share', 'delta'] as const).find((id) => drawn.includes(id) && !removed(id)) ?? 'actual'
    : 'actual';
  return (column, text) => ({
    ...(column === leads ? { value: text } : {}),
    ...(column === 'target' ? { 'field:target': text }
      : column === 'gap' || column === 'delta' ? { 'cmp0.delta': text, [`field:${column}`]: text }
        : column === 'share' ? { 'field:share': text } : {}),
  });
}
