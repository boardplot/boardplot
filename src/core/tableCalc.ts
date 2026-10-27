import type { Calc } from './types/table';

/**
 * True when the calc keeps the scale of the value columns it reads, so a
 * document-level format-by-example still describes the result. Multiplicative
 * algebra changes the dimension; share/percentDelta leave money entirely.
 */
export function calcPreservesScale(calc: Calc): boolean {
  if ('ref' in calc || 'lit' in calc) return true;
  switch (calc.op) {
    case 'abs':
      return calcPreservesScale(calc.of);
    case 'add':
    case 'sub':
      return calcPreservesScale(calc.a) && calcPreservesScale(calc.b);
    case 'delta':
      return true;
    case 'mul':
    case 'div':
    case 'percentDelta':
    case 'share':
      return false;
  }
}
