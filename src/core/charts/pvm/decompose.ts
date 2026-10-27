import { formatAutomaticPercent } from '../../format';
import { chartString } from '../../strings/pvm';
/**
 * The price/volume/mix decomposition. This module is the product:
 * the picture is a waterfall the host engine already draws, but a wrong
 * decomposition is invisible to a reader because every bar still adds up.
 *
 * CONVENTION (fixed, and printed on the exhibit as the method note):
 *
 *   Partition by quantity presence:
 *     common = q0 > 0 && q1 > 0     lost = q0 > 0 && q1 === 0
 *     new    = q0 === 0 && q1 > 0
 *
 *   Over COMMON only - polluting p0bar with new/lost items breaks the identity:
 *     p0i = r0i/q0i   p1i = r1i/q1i   Q0 = SUM q0i   Q1 = SUM q1i
 *     p0bar = SUM r0i / Q0            s0i = q0i / Q0
 *
 *     Price  = SUM (p1i - p0i) * q1i          price at CURRENT volumes
 *     Volume = (Q1 - Q0) * p0bar              volume at PRIOR average price
 *     Mix    = SUM (q1i - Q1*s0i) * (p0i - p0bar)
 *     New    = SUM r1i over new               Lost = - SUM r0i over lost
 *
 * IDENTITY  Price + Volume + Mix + New + Lost = dR, exactly. Proof:
 *   SUM s0i*p0i = SUM (q0i/Q0)*(r0i/q0i) = p0bar and SUM s0i = 1, so
 *   Mix    = SUM p0i*q1i - Q1*p0bar,
 *   Volume = Q1*p0bar - SUM r0i,
 *   hence Volume + Mix = SUM p0i*(q1i - q0i), and
 *   Price  = SUM r1i - SUM p0i*q1i = dR_common - SUM p0i*(q1i - q0i).
 *   The three therefore telescope to dR_common; New and Lost carry the rest.
 *
 * WHY THIS CONVENTION. Every PVM split has to book the price x volume
 * interaction SOMEWHERE. This one books it into Price (price read at current
 * volumes) and says so, rather than parking it in an uninterpretable residual.
 * `interaction: 'separate'` splits it instead, exactly:
 *   Price_Laspeyres = SUM (p1i - p0i)*q0i
 *   Joint           = SUM (p1i - p0i)*(q1i - q0i)      and  P_L + Joint = Price
 *
 * A mix effect that depends on item ORDER is the classic PVM trap. Nothing
 * here does: every term is a sum over items, so the arithmetic is invariant to
 * the order of `items`.
 *
 * UNIT INVARIANCE - the second trap, and the one this module had to be
 * repaired for. Rescale ONE item's quantities by k in both periods (count it
 * in cases of 12 instead of units) and its revenue is untouched, so:
 *   - p0i, p1i scale by 1/k, hence Price = SUM (p1i-p0i)*q1i is UNCHANGED;
 *   - New and Lost are revenue sums, so they are UNCHANGED;
 *   - but Q0, Q1, p0bar and s0i all move, so Volume and Mix BOTH MOVE.
 * Their SUM does not: Volume + Mix = SUM p0i*(q1i - q0i), and each term
 * p0i*qi is a pure revenue-at-prior-price quantity, invariant under k.
 *
 * So the Volume/Mix BOUNDARY - and only that boundary - is a fact about the
 * unit each item is counted in, not about the business. The aggregate Q = SUM
 * qi is only meaningful when the quantities are commensurable, which is a
 * precondition this contract cannot verify. Two consequences, both shipped:
 *   1. `volumeMix: 'combined'` draws ONE `Volume & mix` bar and the whole
 *      decomposition is then unit-invariant, provably (tests/pvm.test.ts
 *      rescales an item by 12 and pins every effect unchanged);
 *   2. `volumeMix: 'split'` (the default) discloses the dependence ON THE
 *      EXHIBIT as its own footnote, names the declared `quantityUnit`, and
 *      warns `pvm-quantity-unit-undeclared` when no unit was declared.
 *
 * COVERAGE. Price/Volume/Mix are computed over COMMON items only, so when
 * most of the book churns they describe a sliver while looking like a full
 * explanation. `derived.commonPriorShare` / `commonCurrentShare` carry the
 * fraction, it is printed as its own footnote, and a base below
 * PVM_THIN_COMMON_SHARE warns `pvm-thin-common-base`.
 *
 * FX / multi-currency is deliberately NOT approximated here: it needs
 * currency-level data this contract does not carry.
 */

import { NormalizeError } from '../../normalize/shared';
import type { Id } from '../../types/cell';
import type {
  PvmContribution,
  PvmData,
  PvmDerived,
  PvmEffect,
  PvmEffectId,
  PvmItem,
} from './types';

/** Relative tolerance of the reconciliation self-audit. */
export const PVM_RESIDUAL_TOLERANCE = 1e-9;

/**
 * Below this share of prior-period revenue, the common base is too thin for
 * price/volume/mix to be read as an explanation of the whole change.
 */
const PVM_THIN_COMMON_SHARE = 0.5;

export const PVM_METHOD_NOTE_IN_PRICE =
  chartString(undefined, 'pvmMethodNoteInPrice');

// For `interaction: 'separate'`, and deliberately no longer than the in-price
// note: the frame wraps a footnote to the content width, so a longer
// sentence takes more footnote lines. tests/pvm.test.ts pins that both notes fit.
export const PVM_METHOD_NOTE_SEPARATE =
  chartString(undefined, 'pvmMethodNoteSeparate');

// `volumeMix: 'combined'`. There is no volume/mix boundary to describe here,
// because there is no volume/mix boundary — that is the whole point of the
// mode, and it is why this variant needs no unit-basis footnote.
export const PVM_METHOD_NOTE_COMBINED =
  chartString(undefined, 'pvmMethodNoteCombined');

export const PVM_METHOD_NOTE_COMBINED_SEPARATE =
  chartString(undefined, 'pvmMethodNoteCombinedSeparate');

/**
 * The unit-basis disclosure. Printed on every SPLIT exhibit, because the
 * Volume/Mix boundary is not invariant to the unit each item is counted in and
 * a reader who is not told that will read two bars as facts about the business.
 */
export function pvmUnitBasisNote(quantityUnit: string | undefined, options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>): string {
  // With no declared unit the note says so, rather than leave "as supplied" to the reader.
  const basis = quantityUnit ? chartString(options, 'countedQuantities', { v1: quantityUnit }) : chartString(options, 'noCommonUnit');
  return (
    chartString(options, 'pvmSplitNote', { v1: basis }) +
    chartString(options, 'pvmSplitInvariant')
  );
}

/** The coverage disclosure: what fraction of the book price/volume/mix speak for. */
export function pvmCoverageNote(
  commonCount: number,
  priorShare: number,
  currentShare: number,
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>,
): string {
  const pct = (v: number) => formatAutomaticPercent(v * 100, 1, false, options?.locale?.language);
  const items = commonCount === 1 ? chartString(options, 'oneItem') : chartString(options, 'itemsCount', { v1: commonCount });
  return (
    chartString(options, 'pvmCoverageHead', { v1: items }) +
    chartString(options, 'pvmCoverageShares', { v1: pct(priorShare), v2: pct(currentShare) })
  );
}

/**
 * The reconciliation self-audit, exported so the guard itself can be proven to
 * fire. Returns the signed residual; throws when the bridge does not close.
 * A bridge that does not reconcile is not drawn.
 */
export function assertReconciles(
  delta: number,
  effects: readonly { id: string; value: number }[],
): number {
  let sum = 0;
  let absSum = 0;
  for (const effect of effects) {
    sum += effect.value;
    absSum += Math.abs(effect.value);
  }
  const residual = delta - sum;
  const scale = Math.max(1, Math.abs(delta), absSum);
  if (!Number.isFinite(residual) || Math.abs(residual) > PVM_RESIDUAL_TOLERANCE * scale) {
    throw new NormalizeError(
      'pvm-residual',
      'items',
      `decomposition does not reconcile: total change ${delta} vs. effects summing to ${sum} ` +
        `(residual ${residual}, tolerance ${PVM_RESIDUAL_TOLERANCE * scale})`,
      'this is an engine defect, not an input problem — report the dataset',
    );
  }
  return residual;
}

interface PvmDecomposeResult {
  derived: PvmDerived;
  /** Non-fatal disclosures the layout turns into lint warnings. */
  notes: { code: string; severity: 'info' | 'warn'; message: string; suggest?: string }[];
}

export function decomposePvm(
  data: PvmData,
  interaction: 'in-price' | 'separate',
  volumeMix: 'split' | 'combined' = 'split',
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>,
): PvmDecomposeResult {
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    throw new NormalizeError('empty-data', 'items', 'pvm requires at least one item', 'add one item with prior and current { qty, revenue }');
  }

  const items = data.items;
  const notes: PvmDecomposeResult['notes'] = [];
  const negativePrice: Id[] = [];

  for (const item of items) {
    for (const period of ['prior', 'current'] as const) {
      const point = item[period];
      if (!point || !Number.isFinite(point.qty) || !Number.isFinite(point.revenue)) {
        throw new NormalizeError(
          'pvm-non-finite',
          `items[${item.id}].${period}`,
          `item '${item.id}' has a non-finite ${period} qty or revenue — a bridge cannot be drawn from it`,
          'supply finite numbers for qty and revenue in both periods',
        );
      }
      if (point.qty < 0) {
        throw new NormalizeError(
          'pvm-negative-quantity',
          `items[${item.id}].${period}.qty`,
          `item '${item.id}' has ${period} qty ${point.qty} — a negative volume has no price interpretation`,
          'net returns and credits into the period before authoring the bridge',
        );
      }
      if (point.qty === 0 && point.revenue !== 0) {
        throw new NormalizeError(
          'pvm-price-undefined',
          `items[${item.id}].${period}`,
          `item '${item.id}' has ${period} qty 0 with revenue ${point.revenue} — price cannot be derived`,
          'give the item its units, or move the amount to an item that carries volume',
        );
      }
      if (point.revenue < 0 && point.qty > 0) negativePrice.push(item.id);
    }
  }

  const common: PvmItem[] = [];
  const fresh: PvmItem[] = [];
  const lost: PvmItem[] = [];
  for (const item of items) {
    const q0 = item.prior.qty;
    const q1 = item.current.qty;
    if (q0 > 0 && q1 > 0) common.push(item);
    else if (q0 > 0) lost.push(item);
    else if (q1 > 0) fresh.push(item);
    // q0 === 0 && q1 === 0: revenue is 0 in both periods (guarded above), so
    // the item contributes nothing to any effect and to no bucket.
  }

  let Q0 = 0;
  let Q1 = 0;
  let commonR0 = 0;
  for (const item of common) {
    Q0 += item.prior.qty;
    Q1 += item.current.qty;
    commonR0 += item.prior.revenue;
  }

  if (common.length === 0 || Q0 === 0) {
    throw new NormalizeError(
      'pvm-no-common-base',
      'items',
      common.length === 0
        ? 'no item carries volume in BOTH periods — the prior average price p0 is undefined, so volume and mix cannot be separated'
        : `the ${common.length} common items carry prior qty 0 in total — the prior average price p0 is undefined`,
      "chart the new-versus-lost split as a plain 'waterfall' instead",
    );
  }

  const pbar0 = commonR0 / Q0;

  let price = 0;
  let priceLaspeyres = 0;
  let joint = 0;
  let volume = 0;
  let mix = 0;
  const contributions: PvmContribution[] = [];

  for (const item of common) {
    const q0 = item.prior.qty;
    const q1 = item.current.qty;
    const p0 = item.prior.revenue / q0;
    const p1 = item.current.revenue / q1;
    const dp = p1 - p0;
    const itemPrice = dp * q1;
    const itemPriceL = dp * q0;
    const itemJoint = dp * (q1 - q0);
    const itemVolume = (q1 - q0) * pbar0;
    const itemMix = (q1 - (Q1 * q0) / Q0) * (p0 - pbar0);
    price += itemPrice;
    priceLaspeyres += itemPriceL;
    joint += itemJoint;
    volume += itemVolume;
    mix += itemMix;
    contributions.push({
      id: item.id,
      bucket: 'common',
      price: itemPrice,
      priceLaspeyres: itemPriceL,
      joint: itemJoint,
      volume: itemVolume,
      mix: itemMix,
      new: 0,
      lost: 0,
    });
  }

  let newRevenue = 0;
  for (const item of fresh) {
    newRevenue += item.current.revenue;
    contributions.push({
      id: item.id,
      bucket: 'new',
      price: 0,
      priceLaspeyres: 0,
      joint: 0,
      volume: 0,
      mix: 0,
      new: item.current.revenue,
      lost: 0,
    });
  }

  let lostRevenue = 0;
  for (const item of lost) {
    lostRevenue -= item.prior.revenue;
    contributions.push({
      id: item.id,
      bucket: 'lost',
      price: 0,
      priceLaspeyres: 0,
      joint: 0,
      volume: 0,
      mix: 0,
      new: 0,
      lost: -item.prior.revenue,
    });
  }

  // Endpoints are computed from the SAME inputs the effects are computed from;
  // no caller-supplied total is trusted anywhere in this module.
  let priorRevenue = 0;
  let currentRevenue = 0;
  for (const item of items) {
    priorRevenue += item.prior.revenue;
    currentRevenue += item.current.revenue;
  }
  const delta = currentRevenue - priorRevenue;

  const effects: PvmEffect[] = [];
  const pushEffect = (id: PvmEffectId, value: number) =>
    effects.push({ id, label: chartString(options, ({volume: 'pvmEffectVolume', mix: 'pvmEffectMix', 'volume-mix': 'pvmEffectVolumeMix', price: 'pvmEffectPrice', 'price-laspeyres': 'pvmEffectPriceLaspeyres', joint: 'pvmEffectJoint', new: 'newItems', lost: 'lostItems'} as const)[id]), value });

  if (volumeMix === 'combined') {
    // Volume + Mix = SUM p0i*(q1i - q0i): every term is revenue-at-prior-price,
    // so this single bar is invariant to the unit each item is counted in.
    pushEffect('volume-mix', volume + mix);
  } else {
    pushEffect('volume', volume);
    pushEffect('mix', mix);
  }
  if (interaction === 'separate') {
    pushEffect('price-laspeyres', priceLaspeyres);
    pushEffect('joint', joint);
  } else {
    pushEffect('price', price);
  }
  // Empty buckets draw nothing rather than a fake zero bar; the omission is
  // recorded in `derived.omittedEffects` so it stays readable.
  const omittedEffects: PvmEffectId[] = [];
  if (fresh.length > 0) pushEffect('new', newRevenue);
  else omittedEffects.push('new');
  if (lost.length > 0) pushEffect('lost', lostRevenue);
  else omittedEffects.push('lost');

  const residual = assertReconciles(delta, effects);
  const scale = Math.max(1, Math.abs(delta), effects.reduce((a, e) => a + Math.abs(e.value), 0));

  if (negativePrice.length > 0) {
    notes.push({
      code: 'pvm-negative-price',
      severity: 'warn',
      message: `negative revenue at positive quantity on ${dedupe(negativePrice).join(', ')} — the decomposition stays exact, but mix reads against an implied negative price`,
      suggest: 'net credits and returns into the item they belong to before bridging',
    });
  }
  if (delta === 0) {
    notes.push({
      code: 'pvm-zero-net',
      severity: 'info',
      message: `revenue is unchanged at ${currentRevenue}; the effects below are large and offsetting, which is the message`,
    });
  }

  // ---- coverage: what fraction of the book price/volume/mix actually speak for
  let commonR1 = 0;
  for (const item of common) commonR1 += item.current.revenue;
  const commonPriorShare = priorRevenue === 0 ? 1 : commonR0 / priorRevenue;
  const commonCurrentShare = currentRevenue === 0 ? 1 : commonR1 / currentRevenue;
  const thinShare = Math.min(commonPriorShare, commonCurrentShare);
  if (thinShare < PVM_THIN_COMMON_SHARE) {
    notes.push({
      code: 'pvm-thin-common-base',
      severity: 'warn',
      message:
        `price, volume and mix are computed over the ${common.length} item(s) present in both periods, which carry only ` +
        `${(commonPriorShare * 100).toFixed(1)}% of prior and ${(commonCurrentShare * 100).toFixed(1)}% of current revenue — ` +
        'most of this change is churn, and the P/V/M bars explain a sliver of it',
      suggest:
        'say so in the message title, or bridge the new/lost split on its own with a plain waterfall',
    });
  }

  // ---- unit basis: the Volume/Mix boundary is not unit-invariant (see header)
  const quantityUnit = typeof data.quantityUnit === 'string' && data.quantityUnit.trim() !== ''
    ? data.quantityUnit.trim()
    : undefined;
  if (volumeMix === 'split' && quantityUnit === undefined) {
    notes.push({
      code: 'pvm-quantity-unit-undeclared',
      severity: 'warn',
      message:
        'data.quantityUnit is not declared, so the exhibit cannot name the unit the volume/mix split rests on — ' +
        'counting the same business in cases rather than units moves the Volume and Mix bars (their sum, and price, new and lost, do not move)',
      suggest:
        "declare data.quantityUnit (e.g. 'licences'), or set options.volumeMix: 'combined' for a decomposition that is unit-invariant",
    });
  }

  const effectValues: Record<string, number> = {};
  for (const effect of effects) effectValues[effect.id] = effect.value;

  return {
    derived: {
      priorRevenue,
      currentRevenue,
      delta,
      effects,
      effectValues,
      interaction,
      volumeMix,
      quantityUnit: quantityUnit ?? null,
      commonPriorShare,
      commonCurrentShare,
      volumeMixCombined: volume + mix,
      common: common.map((item) => item.id),
      new: fresh.map((item) => item.id),
      lost: lost.map((item) => item.id),
      pbar0,
      Q0,
      Q1,
      residual,
      relativeResidual: residual / scale,
      omittedEffects,
      contributions,
      methodNote: null,
      unitBasisNote: null,
      coverageNote: null,
    },
    notes,
  };
}

function dedupe(ids: readonly Id[]): Id[] {
  return [...new Set(ids)];
}
