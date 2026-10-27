/**
 * The presets in one language.
 *
 * The tables share one language: one level ladder, 1 px rules, two grounds,
 * outline marks. A preset does not pick a whole look, because the look is
 * the library's. A preset sets what it MEANS, and that is four decisions:
 *
 * - `benchmark` ranks named competitors, so the first column is the subject
 *   and carries the header's weight, and no group band competes with it.
 * - `status` prints states, and a state chip is square, not a pill: the
 *   chips round only where they are counts.
 * - `receipts` is a dated log, so its dates sit under each other on the
 *   right, the way the figures do. Its figures are the theme's tabular ones,
 *   as every table's are — a receipts table needs no second face for them.
 * - `steering` opens with the total, every other preset closes with it, and
 *   its KPI rows take no ground: a KPI board draws its rows on the
 *   panel, the block columns carry the band, and the total, where there is
 *   one, carries the emphasis. The ladder grounds belong to a report that
 *   nests departments inside departments, not to a list of KPIs.
 *
 * Everything else — the ladder, the rules, the grounds, the marks, the heat
 * lane — is the same on all five presets.
 */

import type { ColumnEmphasis, TableVariant } from '../../types/table';

interface PresetLanguage {
  /** Where the total sits when the author names no position. */
  totalPosition: 'top' | 'bottom';
  /** Emphasis the row-label column takes when the author names none. */
  labelEmphasis?: ColumnEmphasis;
  /** Group rows at level 1 and deeper carry the band ground. */
  groupBand: boolean;
  /** Status chips are square instead of pills. */
  squareChips: boolean;
  /** Date columns align right, under each other. */
  datesRight: boolean;
}

const PLAIN: PresetLanguage = {
  totalPosition: 'bottom',
  groupBand: true,
  squareChips: false,
  datesRight: false,
};

const LANGUAGE: Record<TableVariant, PresetLanguage> = {
  hierarchy: PLAIN,
  steering: { ...PLAIN, totalPosition: 'top', groupBand: false },
  benchmark: { ...PLAIN, labelEmphasis: 'strong', groupBand: false },
  status: { ...PLAIN, squareChips: true },
  receipts: { ...PLAIN, datesRight: true },
};

/** What a variant means, with 'hierarchy' as the default. */
export function presetLanguage(variant: TableVariant | undefined): PresetLanguage {
  return LANGUAGE[variant ?? 'hierarchy'];
}
