/**
 * Whether the parts of a stack add to a total. A module of
 * its own, with no imports, so the React hover records that read it link
 * nothing else of the data-gap rules.
 */

const NON_ADDITIVE = /%|\b(?:share|margin|rate)\b|\bper\s+/i;
const PERCENT = /%|\bpercent\b|^\s*pp\s*$/i;

/**
 * A series stated in percent (its name, its own or the chart's
 * unit, or `{ pct }` cells) is a share of its own whole, so it does not add
 * to another. A name like "Product margin" adds when its unit is money or a
 * count.
 */
export function statedInPercent(label: string, unit: string, pctCells = false): boolean {
  return pctCells || PERCENT.test(label) || PERCENT.test(unit) || (unit === '' && NON_ADDITIVE.test(label));
}

/** One stacked part as the additivity rule reads it. */
interface StackPart {
  label: string;
  unit?: string;
  /** Some cell of the series is a `{ pct }` cell. */
  pctCells?: boolean;
}

/**
 * a stack has a total only when its parts add: one part, no
 * part stated in percent, or parts the author declared shares of one whole.
 */
export function stackAdds(parts: readonly StackPart[], chartUnit: string | undefined, sharesOfOneWhole: boolean | undefined): boolean {
  return parts.length <= 1 || sharesOfOneWhole === true
    || !parts.some((part) => statedInPercent(part.label, part.unit ?? chartUnit ?? '', part.pctCells));
}

/** What an anchor on a stack whose parts do not add says instead of a total. */
export const NO_STACK_TOTAL = 'the stack has no total: its parts are percents of different wholes';

/** What a mean over such a stack says instead of a number. */
export const NO_STACK_MEAN = 'the stack has no sums to average: its parts are percents of different wholes';

/** The fix a value-less anchor names: the category annotations and the attainment band. */
export const VALUELESS_ANCHOR_FIX = 'anchor it on one series ({ categoryId, seriesId }), or set sharesOfOneWhole when every series is a share of the same whole';

/** The fix both warnings name. */
export const SHARES_OF_ONE_WHOLE_FIX = 'set sharesOfOneWhole: true when every series is a share of the same whole, or scope it to one series';
