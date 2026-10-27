/**
 * The Pareto's automatic tail fold. It lives outside charts/ so the
 * item budget (itemBudget.ts) can count the folded columns without linking
 * the layout into a bundle that only checks specs.
 */

/** A cause below this share of the total is tail, not a finding. */
export const TAIL_SHARE_PCT = 2;
/** A tail longer than this crowds the axis; shorter tails stay as columns. */
const TAIL_MAX_ITEMS = 12;

/**
 * How many causes keep their own column when the tail is crowded, or
 * `undefined` when nothing is folded. The tail is the trailing run of causes
 * each carrying less than `TAIL_SHARE_PCT` of the total; it is folded only
 * when it is longer than `TAIL_MAX_ITEMS` and at least one cause stays out of
 * it, so a flat distribution is never reduced to a single Rest column.
 */
export function crowdedTailCut(ranked: readonly { value: number }[]): number | undefined {
  const total = ranked.reduce((sum, r) => sum + r.value, 0);
  if (!(total > 0)) return undefined;
  const limit = (total * TAIL_SHARE_PCT) / 100;
  let cut = ranked.length;
  while (cut > 0 && ranked[cut - 1]!.value < limit) cut -= 1;
  return ranked.length - cut > TAIL_MAX_ITEMS && cut > 0 ? cut : undefined;
}

