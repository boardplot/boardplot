import { chartString } from '../../strings/bartable';
/**
 * Share cascade (bartable `cascade`): the numbers behind the drawing. Each
 * panel splits its total, so a row starts at the sum of the rows above it and
 * its share is its value over the panel total. The growth column compares the
 * first panel with the last. Pure, so a test can hold the arithmetic.
 */

import { cagr, formatAutomaticNumber, formatAutomaticPercent, printedShare, shareSetFormatter } from '../../format';
import { NormalizeError } from '../../normalize/shared';
import { yearSpanFromLabels } from '../../periodYears';
import { roundingUnavailable, sumConsistentShares, type RoundingAdjustment } from '../../shareRounding';
import type { LintWarning } from '../../types/scene';
import type { BarTableGrowth } from './types';

interface CascadePanelInput {
  id: string;
  label: string;
  /** One value per row, display order; nonnegative and complete. */
  values: readonly number[];
}

interface CascadePanel {
  starts: number[];
  total: number;
  /** Row value over the panel total, in %. */
  shares: number[];
  shareTexts: string[];
  /** The combined share of the bracketed rows, in %, and its text. */
  combined?: { value: number; text: string };
}

interface CascadeResult {
  panels: CascadePanel[];
  growth?: { head: string; values: (number | null)[]; texts: string[] };
  adjustments: RoundingAdjustment[];
  warnings: LintWarning[];
}

export function deriveCascade(
  rows: readonly { id: string; label: string }[],
  panels: readonly CascadePanelInput[],
  opts: { combined?: readonly number[]; growth?: BarTableGrowth; sumConsistent?: boolean; locale?: string; lift?: 'full' | 'none' | 'compact' },
): CascadeResult {
  const { locale } = opts;
  const base = panels.map((panel) => {
    const starts: number[] = [];
    let at = 0;
    for (const value of panel.values) { starts.push(at); at += value; }
    if (!(at > 0)) {
      throw new NormalizeError('bartable-cascade-zero-total', `data.panels[${panels.indexOf(panel)}]`,
        `cascade splits each panel's total, and panel '${panel.id}' sums to zero`, 'give the panel nonzero values or drop it');
    }
    return { starts, total: at, shares: panel.values.map((value) => (value / at) * 100) };
  });
  // One precision for every share column, so the columns read alike.
  const { decimals, format } = shareSetFormatter(base.flatMap((panel) => panel.shares), locale);
  // sum-consistent: each panel's shares print so they add up to 100%.
  const rounded = base.map((panel) => (opts.sumConsistent ? sumConsistentShares(panel.shares, locale, undefined, decimals) : null));
  const adjustments: RoundingAdjustment[] = [];
  const warnings: LintWarning[] = [];
  rounded.forEach((own, p) => { if (own?.warning) warnings.push(roundingUnavailable(panels[p]!.label, own.warning)); });
  // What each share prints as, and the number it prints: the bracket and the share change read these.
  const printed = base.map((panel, p) => panel.shares.map((share, r) => {
    const own = rounded[p];
    if (!own) return { text: format(share), value: printedShare(share, decimals) };
    if (own.moved[r]) adjustments.push({ whole: panels[p]!.label, part: rows[r]!.label, share: Math.round(share * 1e4) / 1e4, nearest: format(share), printed: own.texts[r]! });
    return { text: own.texts[r]!, value: own.values[r]! };
  }));
  const result: CascadeResult = {
    panels: base.map((panel, p) => {
      const combined = opts.combined && opts.combined.length > 0
        ? (opts.sumConsistent
          ? opts.combined.reduce((sum, r) => sum + printed[p]![r]!.value, 0)
          : opts.combined.reduce((sum, r) => sum + panel.shares[r]!, 0))
        : undefined;
      return {
        ...panel,
        shareTexts: printed[p]!.map((entry) => entry.text),
        ...(combined === undefined ? {} : { combined: { value: combined, text: formatAutomaticPercent(combined, decimals, false, locale) } }),
      };
    }),
    adjustments,
    warnings,
  };

  const growth = opts.growth;
  // The layout picks how a growth figure that rounds to 0 prints (layoutBarTable).
  const automatic = opts.lift === 'none' ? false : opts.lift === 'compact' ? 'compact' : true;
  if (growth && panels.length >= 2) {
    const first = panels[0]!;
    const last = panels[panels.length - 1]!;
    const span = `${first.label}–${last.label}`;
    if (growth.measure === 'cagr') {
      const years = growth.years ?? yearSpanFromLabels(first.label, last.label);
      if (years === null || !(years > 0)) {
        throw new NormalizeError('bartable-cascade-growth-years', 'options.cascade.growth.years',
          `a CAGR needs the years from '${first.label}' to '${last.label}', and the panel labels name no year`,
          'label the panels with years ("2019", "FY24") or set cascade.growth.years');
      }
      const values = [...first.values.map((value, r) => cagr(value, last.values[r]!, years)), cagr(base[0]!.total, base[base.length - 1]!.total, years)];
      result.growth = {
        head: growth.label ?? `${span} CAGR, %`,
        values,
        texts: values.map((value) => (value === null ? '–' : formatAutomaticNumber(value, { decimals: 1, locale, automatic }))),
      };
    } else {
      const lastPrinted = printed[printed.length - 1]!;
      // The Total row's share is 100% in every panel: it has no change to print.
      const values: (number | null)[] = [...printed[0]!.map((entry, r) => Number((lastPrinted[r]!.value - entry.value).toFixed(decimals))), null];
      result.growth = {
        head: growth.label ?? chartString({ locale: { language: locale } }, 'shareChangeSpan', { v1: span }),
        values,
        texts: values.map((value) => (value === null ? '' : formatAutomaticNumber(value, { decimals, signed: true, locale, automatic }))),
      };
    }
  }
  return result;
}
