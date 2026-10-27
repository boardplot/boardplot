import { literalColor } from './colorLiteral';

const TRANSPARENT_TABLE_FILLS = new Set([
  'table.grounds.subtotal', 'table.grounds.total',
  'table.grounds.good', 'table.grounds.goodStrong', 'table.grounds.warn', 'table.grounds.bad',
  'table.bar.fill', 'table.bar.muted',
]);

/** These table paints accept transparent as no fill, without an opaque RGB value. */
export function isTransparentTableFill(path: string, value: string): boolean {
  return literalColor(value)?.toLowerCase() === 'transparent' && TRANSPARENT_TABLE_FILLS.has(path);
}
