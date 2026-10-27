/**
 * The funnel's derived numbers, one derivation for the rows and the centered
 * layout. A missing value stays missing: it draws no segment, its
 * stage has no total (the missing glyph prints instead) and no conversion
 * touches that stage. Treating it as 0 would print a stage of 0 and a "↓ 0%"
 * conversion nobody measured. A negative value draws as 0, its stage label
 * prints the data's total, and no conversion touches that stage.
 */

import { chartString } from '../../strings/funnel';
import { warnMissingValue } from '../../dataGaps';
import { normalizeSeriesValues } from '../../normalize/shared';
import { cellValue, type Id } from '../../types/cell';
import type { Category, Series } from '../../types/data';
import type { LintWarning } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { FunnelDerived } from './layout';
import { disclosureNote } from '../../notes';

interface FunnelNumbers extends Pick<FunnelDerived, 'stageTotals' | 'conversions' | 'worstDrop'> {
  /** values[si][ci]; null where the author left the cell empty. */
  values: (number | null)[][];
  /** Per stage, the sum of the values present: bar geometry only, never printed. */
  known: number[];
  /** Steps out of a stage whose total is zero: no rate exists. */
  undefinedSteps: { fromId: Id; toId: Id }[];
  /** How many negative values were drawn as 0. */
  clamped: number;
  /** Per stage, the total the label prints: the data's own sum, a negative value included; null where a value is missing. */
  shownTotals: Record<Id, number | null>;
  /** Per stage, whether it holds a value below zero (drawn at 0): no rate is measured to or from it, cumulative ones included. */
  clampedStages: boolean[];
}

/** The footnote a clamped value needs, so a 0 never hides a negative input. */
export function clampedNote(clamped: number, options?: import('../../types/options').BaseOptions): string[] {
  return clamped === 0 ? [] : [disclosureNote(chartString(options, 'clampedFunnelNote', { v1: clamped, v2: clamped === 1 ? 'value' : 'values' }))];
}

export function deriveFunnel(
  plotted: Series[],
  stages: Category[],
  fmt: (v: number) => string,
  warnings: LintWarning[],
): FunnelNumbers {
  let clamped = 0;
  const raw: (number | null)[][] = plotted.map(() => []);
  const values = plotted.map((s, si) =>
    normalizeSeriesValues(s as Series & { values: unknown }, stages, si).map((cell, ci) => {
      const v = cellValue(cell);
      raw[si]![ci] = v;
      const owner = { seriesId: s.id, categoryId: stages[ci]!.id };
      if (v === null) {
        warnMissingValue(warnings, `series '${s.id}' at stage '${stages[ci]!.id}'`, owner,
          'no segment, no stage total and no conversion to or from that stage');
        return null;
      }
      if (v < 0) {
        warnings.push({
          code: 'negative-value',
          severity: 'warn',
          message: `series '${s.id}' at stage '${stages[ci]!.id}': negative value ${v} clamped to 0`,
          owner,
        });
        clamped++;
        return 0;
      }
      return v;
    }),
  );
  const stageTotals: Record<Id, number | null> = {};
  const shownTotals: Record<Id, number | null> = {};
  // A stage holding a value below zero: the label prints the data's total, and no conversion is measured to or from it.
  const clampedStage = stages.map((_c, ci) => raw.some((row) => (row[ci] ?? 0) < 0));
  const known = stages.map((c, ci) => {
    const cells = values.map((row) => row[ci] ?? null);
    const sum = cells.reduce<number>((a, v) => a + (v ?? 0), 0);
    stageTotals[c.id] = cells.includes(null) ? null : sum;
    shownTotals[c.id] = cells.includes(null) ? null : raw.reduce((a, row) => a + row[ci]!, 0);
    return sum;
  });
  const conversions: FunnelDerived['conversions'] = [];
  const undefinedSteps: FunnelNumbers['undefinedSteps'] = [];
  for (let ci = 0; ci < stages.length - 1; ci++) {
    const from = stages[ci]!;
    const to = stages[ci + 1]!;
    const fromTotal = stageTotals[from.id] ?? null;
    const toTotal = stageTotals[to.id] ?? null;
    if (fromTotal === null || toTotal === null || clampedStage[ci] || clampedStage[ci + 1]) continue;
    if (toTotal > fromTotal) {
      warnings.push({
        code: 'funnel-stage-increased',
        severity: 'warn',
        message: `stage total increased from '${from.id}' (${fmt(fromTotal)}) to '${to.id}' (${fmt(toTotal)}) — conversion is not shown as a percentage`,
        owner: { categoryId: from.id },
      });
    }
    if (fromTotal <= 0) {
      warnings.push({
        code: 'conversion-undefined',
        severity: 'warn',
        message: `stage '${from.id}' has zero total — conversion to '${to.id}' is undefined`,
        owner: { categoryId: from.id },
      });
      undefinedSteps.push({ fromId: from.id, toId: to.id });
      continue;
    }
    conversions.push({ fromId: from.id, toId: to.id, rate: toTotal / fromTotal });
  }
  let worstDrop: FunnelDerived['worstDrop'];
  for (const c of conversions) {
    if (c.rate <= 1 && (!worstDrop || c.rate < worstDrop.rate)) worstDrop = c;
  }
  return { values, known, stageTotals, shownTotals, clampedStages: clampedStage, conversions, undefinedSteps, clamped, ...(worstDrop ? { worstDrop } : {}) };
}

/** What a stage with no known total prints: the theme's missing glyph, as the table and variance chart do. */
export function missingGlyph(theme: Theme): string {
  return theme.table?.glyphs?.missing ?? '\u2013';
}
