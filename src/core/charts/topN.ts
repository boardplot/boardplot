/** The topN cut of bar, column, butterfly, pie and mekko: one ranking, one rest name, one rest sum. */

import type { StringsSpec } from '../types/options';

interface TopN { n: number; restLabel?: string; showRestCount?: boolean }

/**
 * Rank by size, largest first, authored order breaking ties; the first n
 * stay. With a threshold (bar only), a kept index under it goes too, but the
 * largest always stays. Both lists keep authored order.
 */
export function topNCut(sizes: readonly number[], n: number, threshold?: number): { kept: number[]; dropped: number[] } {
  const ranked = sizes.map((_, i) => i).sort((a, b) => sizes[b]! - sizes[a]! || a - b);
  const keep = new Set(ranked.slice(0, n));
  if (threshold !== undefined) {
    for (const i of [...keep]) if (sizes[i]! < threshold) keep.delete(i);
    if (keep.size === 0 && ranked.length > 0) keep.add(ranked[0]!);
  }
  const all = sizes.map((_, i) => i);
  return { kept: all.filter((i) => keep.has(i)), dropped: all.filter((i) => !keep.has(i)) };
}

/** The rest bucket's name: the authored restLabel, else strings.others, else 'Others'; with the count when asked. */
export function restLabel(topN: TopN, strings: StringsSpec | undefined, count: number): string {
  return (topN.restLabel ?? strings?.others ?? 'Others') + (topN.showRestCount ? ` (${count})` : '');
}

/** The sum of the folded values; null when every folded value is null (no data is not zero). */
export function restSum(values: readonly (number | null)[]): number | null {
  const nums = values.filter((x): x is number => x !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

/** A mekko cell as an amount: in percent mode a percent cell converts through its category basis. */
export function mekkoAmount(cell: { v: number | null; isPct: boolean }, basis: number, percent: boolean): number | null {
  if (cell.v === null) return null;
  return cell.isPct && percent ? basis > 0 ? cell.v * basis / 100 : null : cell.v;
}

/**
 * The mekko Others sum, shared by the drawing and its reading: convert each
 * cell before adding. It lives here, not in mekko/, so the reading does not
 * link the mekko engine into the react/spec first load.
 */
export function poolMekkoAmounts(cells: readonly { v: number | null; isPct: boolean; basis: number }[], percent: boolean): number | null {
  const amounts = cells.map((cell) => mekkoAmount(cell, cell.basis, percent));
  return amounts.some((value) => value === null) ? null : restSum(amounts);
}

/**
 * The mekko Others cell. A rate (a bar height over a width series, or a percent
 * cell whose column width comes from elsewhere) does not add: Others is the
 * mean weighted by column width, which keeps the drawn area of the folded
 * columns. Without a width series a stacked column is as wide as its sum, so
 * its cells are amounts.
 */
export function poolMekkoCell(
  cells: readonly { v: number | null; isPct: boolean; basis: number; weight: number }[],
  mode: 'percent' | 'unit' | 'bar',
  widthSeries: boolean,
): { v: number | null; isPct: boolean } {
  const allPct = cells.every((cell) => cell.isPct);
  const isPct = allPct && (mode === 'bar' || (mode === 'unit' && widthSeries));
  if (!isPct && !(mode === 'bar' && widthSeries)) return { v: poolMekkoAmounts(cells, mode === 'percent'), isPct: false };
  if (cells.some((cell) => cell.v === null)) return { v: null, isPct };
  const weight = cells.reduce((sum, cell) => sum + cell.weight, 0);
  const weighted = (cell: { v: number | null; weight: number }) => cell.v! * (weight > 0 ? cell.weight : 1);
  return { v: cells.reduce((sum, cell) => sum + weighted(cell), 0) / (weight > 0 ? weight : cells.length), isPct };
}
