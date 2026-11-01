/**
 * Price/volume/mix local contract. Local, like `bar/types.ts`:
 * `PvmData` carries a per-item two-period shape no other chart shares, so it
 * does not belong in the cross-chart `types/data.ts`.
 */

import type { Id } from '../../types/cell';
import type { BaseOptionsFor } from '../../types/options';

interface PvmPeriod {
  /** Units sold. Never negative: a negative volume has no price reading. */
  qty: number;
  /** Revenue for those units. Authored, because revenue is what is bridged. */
  revenue: number;
}

export interface PvmItem {
  id: Id;
  label?: string;
  prior: PvmPeriod;
  current: PvmPeriod;
}

export interface PvmData {
  /** Authored names for the bridge's opening and closing totals. */
  priorLabel?: string;
  currentLabel?: string;
  items: PvmItem[];
  /** ISO date of the shared base period, used by growth annotations. */
  priorDate?: string;
  /** ISO date of the shared comparison period. Effects are not time steps. */
  currentDate?: string;
  /**
   * The COMMON unit every item's `qty` is counted in ('licences', 'cases',
   * 'seats'). Not decoration: the Volume/Mix boundary is a function of it —
   * count one item in cases of 12 instead of units and the Volume and Mix bars
   * move while their sum, price, new and lost do not. Undeclared is allowed
   * but warns (`pvm-quantity-unit-undeclared`), and the exhibit then discloses
   * the dependence without being able to name the unit.
   */
  quantityUnit?: string;
}

/** The ids a bridge can emit. Stable — claims name them. */
export type PvmEffectId =
  | 'volume'
  | 'mix'
  | 'volume-mix'
  | 'price'
  | 'price-laspeyres'
  | 'joint'
  | 'new'
  | 'lost';

export interface PvmOptions extends BaseOptionsFor<'pvm'> {
  /**
   * Where the price x volume interaction term is booked. 'in-price' evaluates
   * price at CURRENT volumes and absorbs the interaction; 'separate' splits it
   * into a Laspeyres price bar plus an explicit joint bar.
   */
  interaction?: 'in-price' | 'separate';
  /**
   * 'split' (default) draws Volume and Mix as two bars; that boundary depends
   * on the unit each item's quantity is counted in, which `methodNote: true`
   * states. 'combined' draws one `Volume & mix` bar, and the whole
   * decomposition is then invariant to the counting unit.
   */
  volumeMix?: 'split' | 'combined';
  /**
   * Default false. true adds the short convention to the one footer line. The
   * coverage part of that line prints regardless while items enter or leave
   * the book. The long notes are in `derived`; they join the notes list when
   * `notes` is set.
   */
  methodNote?: boolean;
  /**
   * Default true. Prints the net change from the opening to the closing total,
   * absolute and in percent, in its sign colour above the closing column.
   * false leaves the closing column with its value only.
   */
  netChange?: boolean;
}

export interface PvmEffect {
  id: PvmEffectId;
  label: string;
  value: number;
}

/** Per-item attribution. Every column sums exactly to its effect total. */
export interface PvmContribution {
  id: Id;
  bucket: 'common' | 'new' | 'lost';
  price: number;
  priceLaspeyres: number;
  joint: number;
  volume: number;
  mix: number;
  new: number;
  lost: number;
}

export interface PvmDerived {
  priorRevenue: number;
  currentRevenue: number;
  delta: number;
  /** Emitted effects in drawn order. */
  effects: PvmEffect[];
  /** Same values keyed by id, for callers that do not want to scan. */
  effectValues: Record<string, number>;
  interaction: 'in-price' | 'separate';
  volumeMix: 'split' | 'combined';
  /** The declared common counting unit, or null when the author did not declare one. */
  quantityUnit: string | null;
  /** Share of PRIOR revenue carried by the common items — what P/V/M speak for. */
  commonPriorShare: number;
  /** Share of CURRENT revenue carried by the common items. */
  commonCurrentShare: number;
  /** Volume + Mix. Unit-invariant even when the two bars separately are not. */
  volumeMixCombined: number;
  common: Id[];
  new: Id[];
  lost: Id[];
  /** Prior average price over COMMON items only. */
  pbar0: number;
  Q0: number;
  Q1: number;
  /** delta - sum(effects). Full precision; the displayed rounding is not the receipt. */
  residual: number;
  relativeResidual: number;
  /** Effect ids that carry no items at all and therefore draw no bar. */
  omittedEffects: PvmEffectId[];
  contributions: PvmContribution[];
  /** The convention as printed, or null when the note was suppressed. */
  methodNote: string | null;
  /** The unit-basis note as printed; null in 'combined' mode or with the method notes off. */
  unitBasisNote: string | null;
  /** The common-base coverage note as printed; null at full coverage with the method notes off. */
  coverageNote: string | null;
}
