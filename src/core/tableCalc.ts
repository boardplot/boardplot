import type { Calc, TableColumn } from './types/table';

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

/**
 * True when running the calc on a difference of two columns gives the difference of
 * running it on each column: refs, literals, sums, differences and scaling by a literal.
 * A ratio, a product of two cells, abs, percentDelta and share are not, so a delta
 * column takes their change from the row's own cells, not from the changed inputs.
 */
export function calcIsLinear(calc: Calc): boolean {
  if ('ref' in calc || 'lit' in calc) return true;
  switch (calc.op) {
    case 'add':
    case 'sub':
      return calcIsLinear(calc.a) && calcIsLinear(calc.b);
    case 'mul':
      return ('lit' in calc.a && calcIsLinear(calc.b)) || ('lit' in calc.b && calcIsLinear(calc.a));
    case 'div':
      return 'lit' in calc.b && calcIsLinear(calc.a);
    case 'delta':
      return true;
    case 'abs':
    case 'percentDelta':
    case 'share':
      return false;
  }
}

/**
 * Calcs the engine itself produces in percentage POINTS — the
 * only computed columns whose scale is guaranteed by construction.
 */
export function calcYieldsPoints(calc: Calc): boolean {
  return 'op' in calc && (calc.op === 'share' || calc.op === 'percentDelta');
}

/**
 * Whether a column prints in a format of its own, so a data row's format does
 * not reach it: an authored `format`, or a percent change or share, which is
 * points whatever its row prints in. Every reader that asks "does the column
 * have its own format?" (resolve, fitFormats, the accessible table) asks this.
 */
export function columnOwnsFormat(col: TableColumn): boolean {
  return ('format' in col && col.format !== undefined) || (col.kind === 'computed' && calcYieldsPoints(col.calc));
}
