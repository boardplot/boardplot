/**
 * `rounding: 'sum-consistent'`: the computed shares of one whole
 * printed so they add up to 100%. Its own module, so only the types that
 * implement the option (mekko, pie) carry it.
 */
import { formatPercent, shareText } from './format';
import { engineNote } from './notes';
import { chartString } from './strings/shareRounding';
import { roundHalfUp, shareSetDecimals } from './formatPrecision';
import { formatWithSpec, withChartMarks, type NumberFormatSpec } from './formatSpec';
import type { BaseOptions } from './types/options';
import type { LintWarning } from './types/scene';

// Percent-point noise below one tenth of the finest safe display step (1e-13).
const SHARE_EQUALITY_TOLERANCE = 1e-14;

/** The warning when `rounding: 'sum-consistent'` cannot hold for one whole. */
export function roundingUnavailable(whole: string, reason: string): LintWarning {
  return {
    code: 'share-rounding-unavailable', severity: 'warn',
    message: `Sum-consistent rounding was not applied to '${whole}': ${reason}. Shares keep their requested formats.`,
    suggest: 'use a common share precision of at most 13 decimals',
  };
}

/** One printed share that `rounding: 'sum-consistent'` moved off its nearest rounding. */
export interface RoundingAdjustment {
  whole: string;
  part: string;
  /** The share in percent, unrounded. */
  share: number;
  /** What the share prints as on its own. */
  nearest: string;
  /** What it prints as, so the whole's shares add up to 100%. */
  printed: string;
}

/**
 * The one hidden method note for a chart whose printed shares were moved to add up
 * to 100%, or whose stacks take their shares of their own total because the authored
 * parts miss 100 (`rescaled` names those stacks). It prints nowhere under the chart
 * by default and joins the notes list.
 */
export function shareRoundingNotes(
  options: Pick<BaseOptions, 'locale' | 'strings'>,
  adjustments: readonly RoundingAdjustment[],
  rescaled: readonly string[] = [],
): string[] {
  const sentences = [
    ...(adjustments.length > 0 ? [chartString(options, 'shareRoundingMoved')] : []),
    ...(rescaled.length > 0 ? [chartString(options, 'shareRoundingRescaled', { v1: rescaled.join(', ') })] : []),
  ];
  return sentences.length > 0 ? [engineNote(sentences.join(' '), 'method')] : [];
}

/**
 * Shares of one whole printed so they add up to 100% (the largest-remainder
 * rule). Every share prints at the finest precision
 * any of them needs, and the gap closes one step at a time on the shares
 * that rounding moved furthest; no share moves a whole step from its value.
 * Null when a share is negative or the shares do not sum to 100.
 * `decimalsOverride` sets one precision across several wholes (a chart-wide share column).
 * Precision above the safe integer limit keeps the shares unchanged and returns a warning.
 */
export function sumConsistentShares(shares: readonly number[], locale?: string, format?: NumberFormatSpec, decimalsOverride?: number): { values: number[]; texts: string[]; moved: boolean[]; warning?: string } | null {
  if (shares.length === 0 || shares.some((share) => !(share >= 0) || !Number.isFinite(share))) return null;
  if (Math.abs(shares.reduce((sum, share) => sum + share, 0) - 100) > 1e-6) return null;
  // One precision for the whole the one its shares print at unrounded.
  const decimals = format?.decimals ?? decimalsOverride ?? shareSetDecimals(shares);
  if (!Number.isSafeInteger(100 * 10 ** decimals)) return {
    values: [...shares],
    texts: shares.map(share => format ? formatWithSpec(share, format) : formatPercent(share, decimals, false, locale)),
    moved: shares.map(() => false),
    warning: `${decimals} decimals exceed the safe limit of 13`,
  };
  const unit = 10 ** decimals;
  const scaled = shares.map((share) => share * unit);
  const nearest = shares.map((share) => Math.round(Number(roundHalfUp(share, decimals)) * unit));
  const steps = [...nearest];
  let gap = 100 * unit - steps.reduce((sum, step) => sum + step, 0);
  while (gap !== 0) {
    const up = gap > 0;
    let pick = -1;
    for (let index = 0; index < steps.length; index++) {
      const room = up ? steps[index]! < Math.ceil(scaled[index]! - 1e-9) : steps[index]! > Math.floor(scaled[index]! + 1e-9);
      if (!room) continue;
      const cost = scaled[index]! - steps[index]!;
      const prior = pick < 0 ? 0 : scaled[pick]! - steps[pick]!;
      const tied = pick >= 0 && Math.abs(cost - prior) < 1e-9;
      if (pick < 0 || (!tied && (up ? cost > prior : cost < prior)) || (tied && (up ? shares[index]! < shares[pick]! : shares[index]! > shares[pick]!))) pick = index;
    }
    if (pick < 0) return null;
    steps[pick] = steps[pick]! + (up ? 1 : -1);
    gap += up ? -1 : 1;
  }
  return {
    values: steps.map(step => step / unit),
    // A nonzero share that rounds to 0 counts as 0 in the sum and prints "<0.1%", never "0.0%".
    texts: steps.map((step, index) => format ? formatWithSpec(step / unit, format)
      : step === 0 && shares[index]! > 0 ? shareText(shares[index]!, decimals, locale) : formatPercent(step / unit, decimals, false, locale)),
    moved: steps.map((step, index) => step !== nearest[index]),
  };
}

/**
 * The printed shares of every whole under `rounding: 'sum-consistent'`, keyed
 * by `whole\0part`, and the ones moved off their nearest rounding.
 */
export function roundWholes(
  wholes: readonly { id: string; name: string; parts: readonly { id: string; name: string; share: number; format?: NumberFormatSpec }[] }[],
  locale?: string,
  format?: NumberFormatSpec,
  preserveDistinct = false,
): { texts: Map<string, string>; values: Map<string, number>; adjustments: RoundingAdjustment[]; warnings: LintWarning[] } {
  const texts = new Map<string, string>();
  const values = new Map<string, number>();
  const adjustments: RoundingAdjustment[] = [];
  const warnings: LintWarning[] = [];
  const unavailable = (whole: string, reason: string) => warnings.push(roundingUnavailable(whole, reason));
  for (const whole of wholes) {
    const formats = whole.parts.map(part => part.format ?? format).map(spec => spec && withChartMarks(spec, locale));
    const decimals = new Set(formats.flatMap(spec => spec ? [spec.decimals] : []));
    if (decimals.size > 1) {
      unavailable(whole.name, 'the authored share formats use different decimal counts');
      continue;
    }
    const common = formats.find(spec => spec !== undefined);
    const shares = whole.parts.map(part => part.share);
    let precision = common?.decimals ?? shareSetDecimals(shares);
    let rounded = sumConsistentShares(shares, locale, common, precision);
    // Keep the base output unless a safe precision preserves both ties and differences.
    if (preserveDistinct && !common && rounded && !rounded.warning) {
      for (let finer = precision; Number.isSafeInteger(100 * 10 ** finer); finer++) {
        const candidate = finer === precision ? rounded : sumConsistentShares(shares, locale, common, finer);
        if (!candidate || candidate.warning) continue;
        const unit = 10 ** finer;
        if (candidate.values.reduce((sum, value) => sum + Math.round(value * unit), 0) !== 100 * unit) continue;
        if (candidate.texts.some((text, index, texts) => texts.some((other, at) =>
          (other === text) !== (Math.abs(shares[at]! - shares[index]!) < SHARE_EQUALITY_TOLERANCE)))) continue;
        rounded = candidate;
        precision = finer;
        break;
      }
    }
    if (!rounded) continue;
    if (rounded.warning) unavailable(whole.name, rounded.warning);
    const fallback = (value: number) => formatPercent(value, precision, false, locale);
    whole.parts.forEach((part, index) => {
      const own = formats[index];
      const display = own ? (value: number) => formatWithSpec(value, own) : fallback;
      const printed = own || common ? display(rounded.values[index]!) : rounded.texts[index]!;
      texts.set(`${whole.id}\0${part.id}`, printed);
      values.set(`${whole.id}\0${part.id}`, rounded.values[index]!);
      if (rounded.moved[index]) {
        adjustments.push({ whole: whole.name, part: part.name, share: Math.round(part.share * 1e4) / 1e4, nearest: display(part.share), printed });
      }
    });
  }
  return { texts, values, adjustments, warnings };
}
