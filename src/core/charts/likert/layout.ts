import { chartString } from '../../strings/likert';
import { methodNote, disclosureNote, keepShownNotes } from '../../notes';
import { structureCount } from '../../structureCounts';
/**
 * Likert diverging survey (registry type 'likert') — a diverging
 * stacked bar centred on the neutral midpoint.
 *
 * This module DERIVES; it draws nothing. Every pixel comes from `layoutBar`
 * called with constructed input: one stacked series per emitted response
 * segment, signed so the disagree side grows left of zero, and a per-cell
 * `label` override carrying the POSITIVE display share so the sign flip never
 * reaches the reader. There is no geometry arithmetic below.
 *
 * What this type refuses on purpose:
 *   - guessing whether the numbers are counts or percentages: `values` is
 *     required, because a 5-point scale of counts 20/20/20/20/20 also sums to
 *     100 and the guess would be a silent lie;
 *   - authored negative numbers: the sign is an internal encoding of WHICH
 *     SIDE a response option sits on, never a datum;
 *   - an undeclared midpoint on an odd scale: which option is neutral decides
 *     where the centre line goes, and the engine may not decide it;
 *   - a magnitude value axis: its ticks would print negative percentages, and
 *     nobody has −40% agreement;
 *   - a net score that is only nearly the net score (see
 *     `likert-summary-ambiguous`).
 *
 * The `'split'` convention — half the neutral share on each side — is the one
 * established for diverging stacked Likert charts in the statistics
 * literature (Journal of Statistical Software 57(5), 2014). Under it the visible zero rule is the
 * MIDPOINT OF THE NEUTRAL SEGMENT, not the boundary between agreement and
 * disagreement; the exhibit says so in a footnote and in the a11y description
 * rather than leaving the reader to assume the other reading.
 */

import { BRACKET_CLEAR, likertAnnotationPass, type BracketHolder } from './annotations';
import { normalizeLegendOption } from '../../frame';
import { refreshPaintWarnings, resolvePaintWarnings } from '../../paintWarnings';
import { PALETTE_NORMAL_FLOOR } from '../../themeRules';
import { formatAutomaticNumber } from '../../format';
import { formatterFromExample, formatWithSpec, parseFormatExample, roundedNumber, withChartMarks } from '../../formatSpec';
import { shareDrift } from '../../dataGaps';
import { accessibleTitle, NormalizeError, resolveSize } from '../../normalize/shared';
import {
  canvasMargin,
  colorblindPaint,
  libraryPatch,
  paintColor,
  panelTypeClass,
  resolveSemanticPaletteTheme,
  resolveTheme,
  semanticPalettePaint,
  signedFillPaint,
  themeForWidth,
} from '../../theme';
import type { Cell, Id } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { BaseOptions, BaseOptionsFor, LegendOptions } from '../../types/options';
import type { Geometry, LintWarning, Paint, PaintWarningRule, PlacedLabel } from '../../types/scene';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import { labelsToNodes } from '../../label/emit';
import { PRIORITY } from '../../label/solver';
import type { Theme, ThemeRef } from '../../types/theme';
import { layoutBar, type BarDerived, type BarMarks } from '../bar/layout';
import { DEFER_ADJACENT, EXACT_DOMAIN, NO_NAME_COLUMN, RIGHT_ROOM, TOTAL_COLUMN } from '../bar/model';
import { authoredNotes, withAuthoredFootnotes } from '../../frame';
import { repaintSeparation } from '../../markVisibility';
import { heightOmitted, rowSizing } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { BAND_PAD } from '../../annotateParts';
import { wrapText } from '../../text';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

/** One rung of the response scale, ordered most-negative -> most-positive. */
export interface LikertScaleOption {
  id: Id;
  label?: string;
  /**
   * The midpoint of an ODD scale. Exactly one option must carry it and it must
   * sit in the middle position; an even scale must not carry it at all.
   */
  role?: 'neutral';
}

/** Keyed response form: `{ optionId, value }` per declared scale option. */
export interface LikertResponse {
  optionId: Id;
  value: number | null;
}

export interface LikertItem {
  id: Id;
  label?: string;
  /** ISO observation date for comparisons across survey waves. */
  date?: string;
  /**
   * Positional (one entry per scale option, in scale order) or keyed. Counts
   * or percentages according to `options.values` — never sniffed.
   */
  values: (number | null)[] | LikertResponse[];
  /** Reported sample size. Required for percent input to be auditable. */
  n?: number;
}

export interface LikertData {
  scale: LikertScaleOption[];
  items: LikertItem[];
}

export type LikertNeutralMode = 'split' | 'positive' | 'negative' | 'exclude';

/**
 * Statement names and ordinary legend keys use the resolved label size.
 * Automatic keys keep the shared footnote size; methodology remains visible in compact mode.
 * `sort` and `topN` are OMITTED, and the omission is real: the schema
 * (`likert/index.ts`) rejects both, so the declaration follows the runtime
 * rather than the reverse (the react-surface check enforces this).
 * Statement order is `sortBy`, and a Likert has no meaningful "other
 * statement" to aggregate a tail into. The layout still lints both codes for
 * callers who reach `layoutLikert` directly, past the schema.
 */
export interface LikertOptions extends Omit<BaseOptionsFor<'likert'>, 'sort' | 'topN'> {
  /** `never`, not absent: an omitted key is STRIPPED by the schema, not refused. */
  sort?: never;
  topN?: never;
  /** REQUIRED. Counts-vs-percent is declared, never inferred from a row sum. */
  values: 'counts' | 'percent';
  /** Default 'split'. */
  neutral?: LikertNeutralMode;
  /** Default 'net'. */
  summary?: 'net' | 'none';
  /** Default 'sheet'. */
  sortBy?: 'sheet' | 'net';
  /**
   * Default false. true adds the method notes (forced-choice centre line, net
   * definition, sort order). The neutral treatment and the base print
   * regardless, unless `requiredNotes` turns them off.
   */
  methodNote?: boolean;
  /**
   * Default both true. false drops the note on the neutral treatment or on the
   * base, for an exhibit whose own title, subtitle, source or footnote already
   * states it. The engine never reads the authored text to decide this.
   */
  requiredNotes?: { neutral?: boolean; base?: boolean };
}

export interface LikertDerived {
  /**
   * Responses each statement's shares are computed over. Counts input: the sum
   * of the counts of the DECLARED scale options. Percent input: the declared
   * `n`. A percent statement with no `n` is ABSENT from this record — the
   * chart is drawable but its base is unknown, and 0 would be wrong.
   */
  base: Record<Id, number>;
  /** itemId -> optionId -> share in percent, full precision. */
  shares: Record<Id, Record<Id, number>>;
  /**
   * itemId -> optionId -> the response COUNT the share was computed from.
   * Present only for counts input: percent input carries no counts, and
   * multiplying a share back by n would hand a receipt an operand it derived
   * from the very number it is meant to check.
   */
  counts?: Record<Id, Record<Id, number>>;
  /** Sum of the shares strictly on the disagree side; excludes the neutral. */
  pctNegative: Record<Id, number>;
  /** The neutral option's share; 0 on an even scale. */
  pctNeutral: Record<Id, number>;
  /** Sum of the shares strictly on the agree side; excludes the neutral. */
  pctPositive: Record<Id, number>;
  /** pctPositive − pctNegative, in percentage points. */
  net: Record<Id, number>;
  /** Share of the most-positive option. */
  topBox: Record<Id, number>;
  /** Share of the most-negative option. */
  bottomBox: Record<Id, number>;
  /** 'none' on an even (forced-choice) scale, where there is no neutral. */
  neutralMode: LikertNeutralMode | 'none';
  /** Final statement order, top to bottom. */
  order: Id[];
}

export type LikertMarks = BarMarks;

const DEFAULT_SHARE_FORMAT = '0%';
/** Rounding is for READING; every comparison below runs on raw shares. */
const SHARE_EPS = 1e-9;
/** Percent input may drift by this much from 100 before it is refused. */
const PERCENT_TOLERANCE = 0.5;
/** Below this many responses a percentage is noise, not a measurement. */
const SMALL_BASE = 30;
/** max/min base above this ratio ⇒ the rows are not directly comparable. */
const BASE_SPREAD = 1.2;
/** At this canvas width and below, each statement sits above its bar. */
const STACKED_MAX_WIDTH = 480;
/** The bar's share of its row (40 px on a 75 px pitch). */
const BAND_FRACTION = 0.53;
/** Statement box to the top of its bar. */
const STATEMENT_GAP = 3;
/** The least air between a bar and the next statement. */
const ROW_GAP_MIN = 10;
/** The centre tick of a stacked row reaches this far past the bar. */
const TICK_OVERHANG = 3.5;

interface NormItem {
  id: Id;
  label: string;
  /** Per scale option, aligned to `scale`. */
  counts: number[];
  /** Per scale option, in percent, full precision. */
  shares: number[];
  /** Undefined ⇒ not auditable (percent input without n). */
  base?: number;
  index: number;
}

export function layoutLikert(
  data: LikertData,
  options?: LikertOptions,
): Geometry<LikertMarks, LikertDerived> {
  const trimNumber = (value: number) => formatAutomaticNumber(value, { decimals: Number.isInteger(value) ? 0 : 1, locale: options?.locale?.language });
  const opts = options ?? ({} as LikertOptions);
  const warnings: LintWarning[] = [];

  if (!data || !Array.isArray(data.scale) || !Array.isArray(data.items) || data.items.length === 0) {
    throw new NormalizeError(
      'empty-data',
      'data',
      'likert requires an ordered scale and at least one item',
    );
  }

  // ---- unknown keys, on BOTH paths ---------------------------------------
  // `likert/index.ts` puts `.strict()` on every data node, and the comment
  // there explains why: a dropped `dontKnow`, `na` or `neutral` key leaves
  // responses out of the DENOMINATOR, so every printed share becomes a share
  // of a population the author did not intend. But that schema only runs on
  // the CLI/normalize path. `createChartComponent` calls `def.layout(data,
  // opts)` directly with no parse, so a React consumer got `base 100` for a
  // document declaring 200 responses, silently, with `warnings: []`.
  //
  // The schema is not the place to fix that: it is shared by 28 chart types
  // and tolerating unknown data keys is a decision for all of them.
  // Every OTHER degenerate-input guard in this package lives in the
  // layout precisely so it holds on both paths; this one now does too. The
  // `.strict()` schema stays as the outer layer — a document is refused before
  // it reaches the engine on the CLI path, and refused by the engine on the
  // React one.
  assertNoUnknownKeys(data, 'data', ['scale', 'items']);
  data.scale.forEach((option, i) => {
    assertNoUnknownKeys(option, `data.scale[${i}]`, ['id', 'label', 'role']);
  });
  data.items.forEach((item, i) => {
    assertNoUnknownKeys(item, `data.items[${i}]`, ['id', 'label', 'date', 'values', 'n']);
    if (Array.isArray(item?.values)) {
      item.values.forEach((entry, j) => {
        if (entry !== null && typeof entry === 'object') {
          assertNoUnknownKeys(entry, `data.items[${i}].values[${j}]`, ['optionId', 'value']);
        }
      });
    }
  });

  // ---- the scale: length, identity, and where the midpoint is -------------
  const scale = data.scale;
  if (scale.length < 3) {
    throw new NormalizeError(
      'likert-scale-too-short',
      'data.scale',
      `a Likert scale needs at least 3 options (got ${scale.length}); two options is a bar chart, not a distribution around a midpoint`,
      'declare the full response scale, or use a bar chart for a two-way split',
    );
  }
  if (scale.length > 7) {
    warnings.push({
      code: 'likert-scale-too-long',
      severity: 'warn',
      message: `${scale.length} response options: past seven the segments are too thin to read and the extremes stop being distinguishable`,
      suggest: 'collapse adjacent options, or report the scale as a table',
    });
  }
  const seenOption = new Set<Id>();
  scale.forEach((option, i) => {
    if (!option || typeof option !== 'object' || !option.id) {
      throw new NormalizeError('missing-id', `data.scale[${i}]`, 'each scale option requires an id');
    }
    if (seenOption.has(option.id)) {
      throw new NormalizeError(
        'likert-duplicate-option',
        `data.scale[${i}].id`,
        `duplicate scale option '${option.id}'; the shares of one option would be split across two segments`,
      );
    }
    seenOption.add(option.id);
  });

  const declaredNeutral = scale
    .map((option, i) => ({ option, i }))
    .filter((entry) => entry.option.role === 'neutral');
  const oddScale = scale.length % 2 === 1;
  const middleIndex = (scale.length - 1) / 2;
  if (declaredNeutral.length > 1) {
    throw new NormalizeError(
      'likert-neutral-multiple',
      'data.scale',
      `${declaredNeutral.length} options carry role 'neutral' (${declaredNeutral
        .map((entry) => `'${entry.option.id}'`)
        .join(', ')}); a scale has exactly one midpoint`,
      'keep the role on the middle option only',
    );
  }
  if (!oddScale && declaredNeutral.length === 1) {
    throw new NormalizeError(
      'likert-neutral-on-even-scale',
      'data.scale',
      `option '${declaredNeutral[0]!.option.id}' carries role 'neutral' on a ${scale.length}-point scale; an even scale has no middle position, its boundary sits between options ${scale.length / 2} and ${scale.length / 2 + 1}`,
      'remove the role — a forced-choice scale needs no neutral declaration',
    );
  }
  if (oddScale && declaredNeutral.length === 0) {
    throw new NormalizeError(
      'likert-neutral-undeclared',
      'data.scale',
      `a ${scale.length}-point scale has a middle option and none is declared; which option is neutral decides where the centre line goes and the engine may not decide it`,
      `add role: 'neutral' to '${scale[middleIndex]!.id}'`,
    );
  }
  if (oddScale && declaredNeutral[0]!.i !== middleIndex) {
    throw new NormalizeError(
      'likert-neutral-misplaced',
      'data.scale',
      `option '${declaredNeutral[0]!.option.id}' is declared neutral at position ${declaredNeutral[0]!.i + 1} of ${scale.length}; the midpoint of an ordered scale is position ${middleIndex + 1}`,
      'reorder the scale most-negative to most-positive, or move the role to the middle option',
    );
  }

  const neutralIndex = oddScale ? middleIndex : -1;
  // Indices of the two sides, in SCALE order (most-negative first).
  const negativeIndices = oddScale
    ? scale.map((_, i) => i).filter((i) => i < neutralIndex)
    : scale.map((_, i) => i).filter((i) => i < scale.length / 2);
  const positiveIndices = oddScale
    ? scale.map((_, i) => i).filter((i) => i > neutralIndex)
    : scale.map((_, i) => i).filter((i) => i >= scale.length / 2);

  // ---- the input mode: declared, never sniffed ---------------------------
  if (opts.values !== 'counts' && opts.values !== 'percent') {
    throw new NormalizeError(
      'likert-values-mode-required',
      'options.values',
      `options.values is required and must be 'counts' or 'percent' (got ${JSON.stringify(opts.values)})`,
      "a 5-point row of counts 20/20/20/20/20 also sums to 100, so the mode cannot be inferred from the data",
    );
  }
  const percentInput = opts.values === 'percent';

  const requestedNeutralMode = opts.neutral ?? 'split';
  const neutralMode: LikertNeutralMode | 'none' = oddScale ? requestedNeutralMode : 'none';
  // Only an AUTHORED non-default mode is worth reporting: `defaults` puts
  // 'split' on every likert document, so warning on it would scold every
  // forced-choice chart for a key its author never wrote.
  if (!oddScale && opts.neutral !== undefined && opts.neutral !== 'split') {
    warnings.push({
      code: 'likert-neutral-mode-moot',
      severity: 'info',
      message: `options.neutral: '${opts.neutral}' has nothing to act on — a ${scale.length}-point scale carries no neutral option`,
      suggest: 'remove options.neutral on a forced-choice scale',
    });
  }

  const summary = opts.summary ?? 'net';
  if (summary === 'net' && (neutralMode === 'positive' || neutralMode === 'negative')) {
    throw new NormalizeError(
      'likert-summary-ambiguous',
      'options.summary',
      `summary: 'net' with neutral: '${neutralMode}' would print the signed sum of the stack, which is the net score ${neutralMode === 'positive' ? 'plus' : 'minus'} the whole neutral share — a number that is nearly the net score is worse than none`,
      "use neutral: 'split' or neutral: 'exclude' with summary: 'net', or set summary: 'none'",
    );
  }

  // ---- items: values aligned to the scale, then shares --------------------
  const seenItem = new Set<Id>();
  const items: NormItem[] = data.items.map((item, index) => {
    const path = `data.items[${index}]`;
    if (!item || typeof item !== 'object' || !item.id) {
      throw new NormalizeError('missing-id', path, 'each likert item requires an id');
    }
    if (seenItem.has(item.id)) {
      throw new NormalizeError(
        'likert-duplicate-item',
        `${path}.id`,
        `duplicate item id '${item.id}'`,
      );
    }
    seenItem.add(item.id);
    const raw = alignToScale(item, scale, path);
    raw.forEach((value, i) => {
      const where = `${path}.values[${i}] ('${scale[i]!.id}')`;
      if (value === null || value === undefined) {
        throw new NormalizeError(
          'likert-missing-value',
          where,
          `statement '${item.id}' has no value for option '${scale[i]!.id}'; a missing response category is not zero, and treating it as zero would shrink the base`,
          'state 0 if the option was offered and nobody chose it, or drop the option from the scale',
        );
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new NormalizeError(
          'likert-nonfinite-value',
          where,
          `statement '${item.id}' has a non-finite value (${String(value)}) for option '${scale[i]!.id}'`,
          'supply a finite count or percentage',
        );
      }
      if (value < 0) {
        throw new NormalizeError(
          'likert-negative-value',
          where,
          `statement '${item.id}' has a negative value (${value}) for option '${scale[i]!.id}'; the sign in a diverging Likert encodes WHICH SIDE an option sits on and is derived from the scale, never authored`,
          'supply the response count or percentage as a non-negative number',
        );
      }
    });
    const counts = raw as number[];
    const sum = counts.reduce((a, b) => a + b, 0);

    if (percentInput) {
      if (Math.abs(sum - 100) > PERCENT_TOLERANCE + SHARE_EPS) {
        throw new NormalizeError(
          'likert-base-mismatch',
          `${path}.values`,
          `statement '${item.id}' is declared as percentages but sums to ${trimNumber(sum)}, outside 100 ± ${PERCENT_TOLERANCE}; rescaling it silently would publish a distribution nobody measured`,
          'correct the input, or supply counts and let the shares be derived',
        );
      }
      // Verbatim: the authored percentages ARE the shares. Renormalising the
      // ±0.5 drift away would be the silent rescale this branch just refused.
      // And because the shares were AUTHORED rather than divided out of
      // counts, there is no per-option numerator anywhere in this row — which
      // is why `derived.counts` is absent for percent input and why the
      // receipt emits no per-option share claim for it (see the note below).
      const shares = counts.slice();
      if (item.n === undefined) {
        warnings.push({
          code: 'likert-base-missing',
          severity: 'warn',
          message: `statement '${item.id}' supplies percentages with no n — the chart is drawable but the shares cannot be audited and their precision cannot be judged`,
          suggest: 'add n (the number of responses the percentages were computed over)',
        });
        return { id: item.id, label: item.label ?? item.id, counts, shares, index };
      }
      if (!Number.isFinite(item.n) || item.n <= 0) {
        throw new NormalizeError(
          'likert-empty-item',
          `${path}.n`,
          `statement '${item.id}' declares n = ${String(item.n)}; a base of zero makes every share 0/0`,
        );
      }
      return { id: item.id, label: item.label ?? item.id, counts, shares, base: item.n, index };
    }

    if (!(sum > 0)) {
      throw new NormalizeError(
        'likert-empty-item',
        `${path}.values`,
        `statement '${item.id}' has no responses (the declared options sum to ${sum}); every share would be 0/0`,
        'drop the statement, or state the responses it actually received',
      );
    }
    if (item.n !== undefined && Math.abs(item.n - sum) > SHARE_EPS) {
      warnings.push({
        code: 'likert-base-declared-mismatch',
        severity: 'warn',
        message: `statement '${item.id}' declares n = ${trimNumber(item.n)} but its counts sum to ${trimNumber(sum)}; the base used is the sum of the DECLARED scale options, and the difference is ${trimNumber(item.n - sum)} responses this chart cannot place`,
        suggest:
          "declare the missing responses as a scale option — which forces the decision about which side they sit on — rather than as an n the segments do not add up to",
      });
    }
    return {
      id: item.id,
      label: item.label ?? item.id,
      counts,
      shares: counts.map((c) => (c / sum) * 100),
      base: sum,
      index,
    };
  });

  // ---- derived numbers ----------------------------------------------------
  const shareOf = (item: NormItem, i: number) => item.shares[i]!;
  const sideSum = (item: NormItem, indices: number[]) =>
    indices.reduce((a, i) => a + shareOf(item, i), 0);

  const base: Record<Id, number> = emptyIdRecord();
  const shares: Record<Id, Record<Id, number>> = emptyIdRecord();
  const counts: Record<Id, Record<Id, number>> = emptyIdRecord();
  const pctNegative: Record<Id, number> = emptyIdRecord();
  const pctNeutral: Record<Id, number> = emptyIdRecord();
  const pctPositive: Record<Id, number> = emptyIdRecord();
  const net: Record<Id, number> = emptyIdRecord();
  const topBox: Record<Id, number> = emptyIdRecord();
  const bottomBox: Record<Id, number> = emptyIdRecord();
  for (const item of items) {
    if (item.base !== undefined) base[item.id] = item.base;
    shares[item.id] = Object.fromEntries(scale.map((option, i) => [option.id, shareOf(item, i)]));
    if (!percentInput) {
      counts[item.id] = Object.fromEntries(scale.map((option, i) => [option.id, item.counts[i]!]));
    }
    pctNegative[item.id] = sideSum(item, negativeIndices);
    pctPositive[item.id] = sideSum(item, positiveIndices);
    pctNeutral[item.id] = oddScale ? shareOf(item, neutralIndex) : 0;
    // The NET SCORE, always: agree minus disagree, the neutral on neither
    // side. Under 'split' and 'exclude' the stack's signed sum equals this by
    // construction; under 'positive'/'negative' it does not, which is why
    // those modes refuse `summary: 'net'` above.
    net[item.id] = pctPositive[item.id]! - pctNegative[item.id]!;
    topBox[item.id] = shareOf(item, scale.length - 1);
    bottomBox[item.id] = shareOf(item, 0);
  }

  // ---- lints on the derived distribution ---------------------------------
  const shareSpec = withChartMarks(parseFormatExample(opts.format ?? DEFAULT_SHARE_FORMAT), opts.locale?.language);
  if (!opts.format) shareSpec.locale = opts.locale?.language;
  const shareFmt = (value: number) => formatWithSpec(value, shareSpec);
  for (const item of items) {
    if (item.base !== undefined && item.base < SMALL_BASE) {
      warnings.push({
        code: 'likert-small-base',
        severity: 'warn',
        message: `statement '${item.label}' has n = ${trimNumber(item.base)}: on a base that small one response moves the share by ${trimNumber(100 / item.base)} points, so the percentages are noise rather than a measurement`,
        suggest: 'report the counts for this statement, or pool it with another',
      });
    }
    if (item.shares.some((share) => share >= 100 - SHARE_EPS)) {
      const winner = scale[item.shares.findIndex((share) => share >= 100 - SHARE_EPS)]!;
      warnings.push({
        code: 'likert-single-option',
        severity: 'info',
        message: `statement '${item.label}' put 100% of its responses in '${winner.label ?? winner.id}': the row carries no distribution to read`,
      });
    }
    // Display rounding is NOT corrected to sum to 100: a printed number must
    // equal the data it came from. The drift is disclosed instead.
    const printedSum = shareDrift(item.shares.map((share) => roundedNumber(share, shareSpec)));
    if (printedSum !== null) {
      warnings.push({
        code: 'likert-rounding-drift',
        severity: 'info',
        message: `statement '${item.label}': the printed shares sum to ${trimNumber(printedSum)}, not 100 — rounding, not an error in the data; no segment is adjusted to close the gap`,
      });
    }
  }
  // A SUPPRESSED RECEIPT IS STILL DISCLOSED. Percent input carries no
  // per-option response count, so `claimsForChart` emits no `share@1` claim
  // for these rows: the numerator would have to be computed back out of the
  // share it is meant to check, which is an identity that validates whatever
  // the author typed. Saying nothing here would leave an author who supplied
  // `n` believing the per-option shares are audited when they are not.
  if (percentInput) {
    warnings.push({
      code: 'likert-percent-no-share-receipt',
      severity: 'info',
      message:
        'the shares were authored, not counted, so no per-option share claim is emitted: a receipt whose numerator is recomputed from the share it audits can never fail. The net score is still on the receipt and each base is on the exhibit',
      suggest:
        'supply counts (values: \'counts\') and let the shares be derived — then every printed share carries the count and the base it came from',
    });
  }

  const knownBases = items.map((item) => item.base).filter((b): b is number => b !== undefined);
  if (knownBases.length > 1) {
    const hi = maxOf(knownBases);
    const lo = minOf(knownBases);
    if (lo > 0 && hi / lo > BASE_SPREAD) {
      warnings.push({
        code: 'likert-base-varies',
        severity: 'info',
        message: `the bases range from ${trimNumber(lo)} to ${trimNumber(hi)} responses (${trimNumber(hi / lo)}x): the rows are shares of different populations and are not directly comparable`,
        suggest: 'state the per-statement n, or restrict the chart to statements with a common base',
      });
    }
  }
  if (neutralMode === 'exclude') {
    const excluded = items
      .map((item) => `${item.label} ${shareFmt(pctNeutral[item.id]!)}`)
      .join('; ');
    warnings.push({
      code: 'likert-neutral-excluded',
      severity: 'warn',
      message: `neutral: 'exclude' drops '${scale[neutralIndex]!.label ?? scale[neutralIndex]!.id}' from every bar, so the bars no longer sum to the base — excluded share per statement: ${excluded}`,
      suggest: "use neutral: 'split' to keep the whole distribution in the ink",
    });
  }

  if ((opts as BaseOptions).sort !== undefined) {
    warnings.push({
      code: 'likert-sort-ignored',
      severity: 'info',
      message: "options.sort is ignored on a likert — statement order is decided by options.sortBy ('sheet' or 'net')",
    });
  }
  if ((opts as BaseOptions).topN !== undefined) {
    warnings.push({
      code: 'likert-topn-unsupported',
      severity: 'info',
      message:
        'options.topN is ignored on a likert — a rest bucket would average statements that were asked separately, and there is no meaningful "other statement"',
      suggest: 'select the statements upstream',
    });
  }

  // ---- order --------------------------------------------------------------
  const sortBy = opts.sortBy ?? 'sheet';
  const ordered =
    sortBy === 'net'
      ? [...items].sort((a, b) => net[b.id]! - net[a.id]! || a.index - b.index)
      : items;
  const order: Id[] = ordered.map((item) => item.id);

  // ---- constructed bar input: derived numbers only, no geometry -----------
  const theme = resolveSemanticPaletteTheme(
    themeForWidth(resolveTheme(opts.theme), panelTypeClass(opts) ?? resolveSize(opts.size).width),
    opts.palette,
    warnings,
  );
  const paintWarningRules: PaintWarningRule[] = [];
  const ramp = divergingRamp(
    scale.length,
    negativeIndices,
    positiveIndices,
    neutralIndex,
    theme,
    scale,
    warnings,
    semanticPalettePaint(theme, opts.palette, 'neutralMark'),
    paintWarningRules,
  );

  const seriesIdOf = (i: number, half?: 'neg' | 'pos') =>
    half ? `likert:${scale[i]!.id}:${half}` : `likert:${scale[i]!.id}`;
  const labelOf = (i: number) => scale[i]!.label ?? scale[i]!.id;

  // ---- what the two sides are CALLED, derived from the declared scale -----
  // "Likert" is a shape, not a subject. Fixed agreement vocabulary would print
  // over whatever scale it is given: on `customer-effort-7pt`, whose options
  // run 'Very high effort' … 'Very low effort', the footnote would read "share
  // on the agree side minus share on the disagree side" and the accessible
  // description "Opening an account: 73% agree". Nobody agrees with opening an
  // account, and the sign of the headline changes meaning with it — "+60"
  // would read as net agreement when it means net-low-effort.
  //
  // So the words come from the data. An agreement scale keeps the agreement
  // words, because that is what its own labels say; every other scale is named
  // by its declared poles, which is the only vocabulary the author supplied.
  const AGREEMENT = /\bdisagree|\bagree/i;
  const isAgreementScale =
    AGREEMENT.test(labelOf(0)) && AGREEMENT.test(labelOf(scale.length - 1));
  const sideWords = isAgreementScale
    ? {
        negative: chartString(opts, 'disagreeLower'),
        positive: chartString(opts, 'agreeLower'),
        negativeSide: chartString(opts, 'disagreeSide'),
        positiveSide: chartString(opts, 'agreeSide'),
        boundary: chartString(opts, 'agreementBoundary'),
      }
    : {
        negative: chartString(opts, 'onNamedSide', { v1: labelOf(0) }),
        positive: chartString(opts, 'onNamedSide', { v1: labelOf(scale.length - 1) }),
        negativeSide: chartString(opts, 'namedSide', { v1: labelOf(0) }),
        positiveSide: chartString(opts, 'namedSide', { v1: labelOf(scale.length - 1) }),
        boundary: chartString(opts, 'twoSidesBoundary'),
      };

  interface Emission {
    id: Id;
    label: string;
    fill: string;
    /** Share -> the signed number the stack takes. */
    value: (item: NormItem) => number;
    /** Share -> the text the reader sees, or false for a suppressed label. */
    text: (item: NormItem) => string | false;
  }

  const share = (i: number) => (item: NormItem) => shareOf(item, i);
  const printed = (i: number) => (item: NormItem) => {
    const value = shareOf(item, i);
    // A zero share paints a zero-width rect; a "0%" beside it would be text
    // about ink that is not there.
    return roundedNumber(value, shareSpec) === 0 ? (false as const) : shareFmt(value);
  };

  const negativeEmissions: Emission[] = [];
  const positiveEmissions: Emission[] = [];

  // INNERMOST FIRST on both sides: layoutBar stacks each side outward from
  // zero in series order, so the FIRST negative series sits adjacent to the
  // centre line. Emitting the scale in its natural order would therefore put
  // 'strongly disagree' INSIDE 'disagree' — the extreme option must end up
  // outermost, so each side is emitted from the centre out.
  if (oddScale && (neutralMode === 'split' || neutralMode === 'negative')) {
    negativeEmissions.push({
      id: seriesIdOf(neutralIndex, neutralMode === 'split' ? 'neg' : undefined),
      label: labelOf(neutralIndex),
      fill: ramp[neutralIndex]!.css,
      value: (item) => -shareOf(item, neutralIndex) / (neutralMode === 'split' ? 2 : 1),
      // Under 'split' the positive half carries the option's label.
      text: neutralMode === 'split' ? () => false : printed(neutralIndex),
    });
  }
  for (const i of [...negativeIndices].reverse()) {
    negativeEmissions.push({
      id: seriesIdOf(i),
      label: labelOf(i),
      fill: ramp[i]!.css,
      value: (item) => -shareOf(item, i),
      text: printed(i),
    });
  }
  if (oddScale && (neutralMode === 'split' || neutralMode === 'positive')) {
    positiveEmissions.push({
      id: seriesIdOf(neutralIndex, neutralMode === 'split' ? 'pos' : undefined),
      label: labelOf(neutralIndex),
      fill: ramp[neutralIndex]!.css,
      value: (item) => shareOf(item, neutralIndex) / (neutralMode === 'split' ? 2 : 1),
      // Under 'split' the option is one segment drawn as two halves. This half
      // carries its FULL share, and bar centres it on both halves together,
      // across the centre line (`halves` below), so the number names the
      // option's whole block. On one half it would name a block half its size, and
      // "20%" on each half is a share no respondent gave. The centre rule stays
      // behind the bars; the footnote lists the shares only when one did not
      // fit.
      text: printed(neutralIndex),
    });
  }
  for (const i of positiveIndices) {
    positiveEmissions.push({
      id: seriesIdOf(i),
      label: labelOf(i),
      fill: ramp[i]!.css,
      value: share(i) as (item: NormItem) => number,
      text: printed(i),
    });
  }
  const emissions = [...negativeEmissions, ...positiveEmissions];

  const barData: ChartData = {
    categories: ordered.map((item) => ({ id: item.id, label: item.label })),
    series: emissions.map((emission) => ({
      id: emission.id,
      label: emission.label,
      fill: emission.fill,
      values: ordered.map((item) => {
        const text = emission.text(item);
        return {
          number: emission.value(item),
          ...(text === false ? { label: false as const } : { label: text }),
        } as Cell;
      }),
    })),
  } as ChartData;

  const measure = opts.measure ?? defaultMeasurer;
  // Legend reading order is SCALE order (most negative -> most positive), not
  // the emission order the geometry needs.
  const legendOrder: Id[] = [
    ...negativeIndices.map((i) => seriesIdOf(i)),
    ...(oddScale && neutralMode !== 'exclude'
      ? neutralMode === 'split'
        ? [seriesIdOf(neutralIndex, 'neg'), seriesIdOf(neutralIndex, 'pos')]
        : [seriesIdOf(neutralIndex)]
      : []),
    ...positiveIndices.map((i) => seriesIdOf(i)),
  ];
  /**
   * The split neutral is ONE response option drawn as two stack segments that
   * meet at the centre line, and `layoutBar` builds one legend entry per data
   * series, which would print SIX keys for a five-point scale, the middle two
   * identical in fill and in label. `dedupeLegendKeys` collapses keys that
   * agree in rendered appearance AND label, so the two neutral halves arrive
   * as one key and the legend counts the scale correctly.
   */
  const legend = resolveLegend(opts.legend, legendOrder, warnings);

  // The net column is the stack's SIGNED SUM, which equals the net score only
  // under 'split' and 'exclude' — the two modes `summary: 'net'` allows.
  const netExample = `+${(opts.format ?? DEFAULT_SHARE_FORMAT).replace(/%/g, '')}`;
  // The printed net names its unit: a difference of two shares is in
  // percentage points, and a bare "+75" reads as a count.
  // The unit prints once, in the column head "Net, pp".
  const netLabelExample = netExample;

  const halves = oddScale && neutralMode === 'split'
    ? { neg: seriesIdOf(neutralIndex, 'neg'), pos: seriesIdOf(neutralIndex, 'pos') }
    : undefined;
  // Comparison brackets take a room right of the plot; the first
  // layout measures how wide, and every later one reserves it.
  const comparing = (opts.annotations ?? []).some((annotation) => annotation.kind === 'cagr' || annotation.kind === 'diff');
  let rightRoom = comparing ? 0 : undefined;
  const brackets: BracketHolder = {};
  const canvas = resolveSize(opts.size);
  // On a card (480 px and less) each statement takes its own line
  // above its bar, so the bar uses the full content width. A side column
  // left the bars a strip (118 px of 400) and refused 320 px. A theme with
  // fixed bar rows keeps its own pitch, and a grid panel its own layout.
  const fixedRows = theme.space.barRow !== undefined;
  // Authored bar fractions keep the name column: their row gap may be too small for statements above.
  const stacked = canvas.width <= STACKED_MAX_WIDTH && !fixedRows && opts.bandFraction === undefined && panelTypeClass(opts) === undefined;
  // Bars take about half the row (40 px on a 75 px pitch); the rest
  // is air between the statements. An authored bandFraction wins.
  const defaultFraction = fixedRows ? undefined : BAND_FRACTION;
  const statementFont = { family: theme.type.family, ...theme.type.label };
  const statementLineH = statementFont.size * (statementFont.lineHeight ?? 1.2);
  const margin = { ...canvasMargin(theme, canvas.width), ...opts.margin };
  const statementW = Math.max(40, canvas.width - margin.left - margin.right);
  const statements = stacked
    ? ordered.map((item) => wrapText(item.label, statementFont, statementW, 8, measure).lines)
    : [];
  const statementH = statements.length ? maxOf(statements.map((lines) => lines.length)) * statementLineH : 0;
  const headH = summary === 'net' ? measure(chartString(opts, 'netPp'), statementFont).height + 4 : 0;
  interface Rows { bandFraction?: number; bandPad?: number }
  // One short line says that shares on narrow segments are not printed,
  // rather than a list of them or nothing.
  let narrowNote = false;
  const layoutWith = (rows: Rows) => {
    const footnotes = [...authoredNotes(opts), ...methodNotes(),
      ...(narrowNote ? [disclosureNote(chartString(opts, 'narrowSharesNotPrinted'))] : [])];

    // Only the author's own notes keep a number; the rest are derived.
    const barOptions = withAuthoredFootnotes({
      ...likertBarOptions(opts, theme.type.label.size),
      variant: 'stacked' as const,
      // Every response share is a share of the same respondents.
      sharesOfOneWhole: true,
      grandTotalLabels: summary === 'net',
      format: netLabelExample,
      // The stack values are DERIVED float shares; their decimals are noise,
      // not authored precision. The example above declares the display
      // precision (whole points), so bar's exhibit raster must not read one
      // from the values — "+75", never "+75.06".
      rasterFromValues: false,
      valueAxis: { ...(opts.valueAxis ?? {}), show: false },
      ...(legend ? { legend } : { legend: 'none' as const }),
      ...(halves ? { halves } : {}),
      ...(opts.bandFraction === undefined && rows.bandFraction !== undefined ? { bandFraction: rows.bandFraction } : {}),
      // Stacked statements are drawn here, above the bars; bar keeps no name column.
      ...(stacked ? { labels: { ...(typeof opts.labels === 'object' ? opts.labels : {}), category: false } } : {}),
    }, footnotes, opts.footnotes);

    const drawn = layoutBar(barData, {
      ...barOptions,
      // Stacked statements are drawn by likert, so bar keeps no name column.
      ...(stacked ? { [NO_NAME_COLUMN]: true } : {}),
      // No value axis is drawn, so the bars fill the row (the data extent, not round ticks).
      [EXACT_DOMAIN]: true,
      // The adjacent-colour check runs once, from the rebound rules, on the layout kept.
      [DEFER_ADJACENT]: true,
      ...(rightRoom !== undefined ? { [RIGHT_ROOM]: rightRoom } : {}),
      // The nets stand in their column (netColumn), not at the bars' ends.
      ...(summary === 'net' && !comparing ? { [TOTAL_COLUMN]: canvas.width - margin.right } : {}),
      ...(rows.bandPad ? { [BAND_PAD]: rows.bandPad } : {}),
    } as never,
      likertAnnotationPass(data, shares, net, opts.format, brackets)) as Geometry<BarMarks, BarDerived>;
    // The bar layout owes a hidden sliver's share to its generic note. Here a
    // share too narrow to print stays unlabelled: its length and colour show
    // it, and every side total and net is in the description (no prose list).
    for (const label of drawn.labels) if (label.kind === 'segment' && label.hidden === 'density') delete label.owed;
    return drawn;
  };
  /**
   * The row band for stacked statements. Each row is: the statement, a gap,
   * the bar; the first row's statement and the net column head sit in a pad
   * above the band. Solved from the plot height of a first layout.
   */
  const stackedRows = (plotH: number): Rows => {
    const n = ordered.length;
    const bar = Math.ceil(statementLineH + 8);
    let pad = 0;
    let step = plotH / n;
    for (let i = 0; i < 4; i++) {
      step = Math.max(1, (plotH - pad) / n);
      pad = Math.max(0, Math.ceil(statementH + STATEMENT_GAP + headH - (step - bar) / 2));
    }
    const thickness = Math.min(bar, step * 0.6);
    return { bandFraction: Math.min(0.9, thickness / step), bandPad: pad };
  };
  let rows: Rows = { bandFraction: defaultFraction };
  let geo = layoutWith(rows);
  if (stacked) {
    rows = stackedRows(geo.plot.h);
    geo = layoutWith(rows);
  }
  const reach = brackets.need?.().right ?? 0;
  if (comparing && reach > 0) {
    rightRoom = Math.ceil(reach + BRACKET_CLEAR);
    geo = layoutWith(rows);
  }
  // The note takes footer room, so the layout runs again with it. Whether a
  // share fits its segment depends on the bar width, which the note does not
  // change. On a pinned height the note gives way when only it would make the
  // card refuse (a 720 x 405 compact card drew without it before).
  if (geo.labels.some((label) => label.kind === 'segment' && label.hidden === 'density')) {
    const before = { geo, rows };
    const minimumH = (g: typeof geo, r: Rows) => stacked
      ? g.size.height - g.plot.h - (r.bandPad ?? 0) + ordered.length * (statementH + STATEMENT_GAP + Math.ceil(statementLineH + 4) + ROW_GAP_MIN) + headH
      : g.sizing?.minHeight ?? 0;
    narrowNote = true;
    if (stacked) rows = stackedRows(layoutWith({ bandFraction: defaultFraction }).plot.h);
    geo = layoutWith(rows);
    const pinnedH = !heightOmitted(opts.size) && (opts as TargetSizeOptions)[TARGET_SIZE]?.fixed.height !== false;
    if (pinnedH && minimumH(geo, rows) > canvas.height + 0.5 && minimumH(before.geo, before.rows) <= canvas.height + 0.5) {
      narrowNote = false;
      ({ geo, rows } = before);
    }
  }
  // Likert passes each formatted share as the segment's label text, so the label
  // prints the value it names (bar reads a plain authored label as a name only).
  for (const label of geo.labels) {
    if (label.kind !== 'segment' || label.printsFor?.length !== 0) continue;
    label.printsFor = halves && label.owner.seriesId === halves.pos
      ? [label.owner, { seriesId: halves.neg, categoryId: label.owner.categoryId }] : [label.owner];
  }
  const reboundPaintWarningRules = restoreLikertPaints(geo, ramp, scale, seriesIdOf, paintWarningRules, theme);
  const statementTop = stacked ? stackStatements(geo, theme, statements, statementFont, statementLineH, margin.left, measure) : undefined;
  // Comparison brackets stand right of the bars, so the nets stay left of them.
  if (summary === 'net') netColumn(geo, theme, measure, opts, comparing ? -Infinity : canvas.width - margin.right, statementTop);
  // Stacked rows are measured here: bar measured bars without names. A row
  // holds its statement, the gap, a bar that holds a share, and air.
  const chromeH = geo.size.height - geo.plot.h - (rows.bandPad ?? 0);
  const rowsOf = (bar: number, air: number) => ordered.length * (statementH + STATEMENT_GAP + bar + air) + headH;
  // Bar's own row floors are taken at the thin band this layout asked for, so they do not apply.
  const stackedMin = stacked ? chromeH + rowsOf(Math.ceil(statementLineH + 4), ROW_GAP_MIN) : 0;
  const stackedNatural = stacked ? Math.max(stackedMin, chromeH + rowsOf(Math.ceil(statementLineH + 8), 2 * ROW_GAP_MIN + 4)) : 0;

  return {
    ...geo,
    type: 'likert',
    ...(geo.sizing ? { sizing: rowSizing('likert', geo.size, {
      chromeH: 0,
      // Rounded to 0.01 px: the float noise of a band step broke the natural-height round trip.
      minimumRowsH: round2(stacked ? stackedMin : geo.sizing.minHeight),
      naturalRowsH: round2(stacked ? stackedNatural : geo.sizing.naturalHeight),
      minWidth: geo.sizing.measuredMinWidth,
      naturalWidth: geo.sizing.naturalWidth,
    }) } : {}),
    derived: {
      base,
      shares,
      ...(percentInput ? {} : { counts }),
      pctNegative,
      pctNeutral,
      pctPositive,
      net,
      topBox,
      bottomBox,
      neutralMode,
      order,
    },
    a11y: {
      title: accessibleTitle(opts.title, chartString(opts, 'likertTitle', { v1: items.length, v2: scale.length })),
      counts: [structureCount('statements', items.length, chartString(opts, 'statementsCount', { v1: items.length, v2: items.length === 1 ? '' : 's' })), structureCount('scale-points', scale.length, chartString(opts, 'scalePointsCount', { v1: scale.length }))],
      desc: describe(),
    },
    // Resolved from the rebound rules, so a fresh render warns as a repaint in its theme does.
    warnings: refreshPaintWarnings([...geo.warnings, ...warnings], reboundPaintWarningRules, theme),
    paintWarningRules: reboundPaintWarningRules,
  };

  // -- helpers that need the closure ---------------------------------------

  function methodNotes(): string[] {
    // Footer rule: each method note carries the one-line form the frame
    // prints under notes.show ['note', 'method'].
    const notes: string[] = [];
    const neutralLabel = oddScale ? labelOf(neutralIndex) : '';
    const short = (side: string) => side.replace(/^the /, '');
    // The author turns a required note off where the exhibit's own
    // text already states it; the engine does not read that text.
    const neutralNote = opts.requiredNotes?.neutral !== false;
    const baseNote = opts.requiredNotes?.base !== false;
    if (!neutralNote) {
      // The author states the neutral treatment elsewhere on the exhibit.
    } else if (neutralMode === 'split') {
      notes.push(methodNote(
        chartString(opts, 'likertNeutralFull', { v1: neutralLabel, v2: sideWords.boundary }) +
          chartString(opts, 'neutralShareOnce'),
        chartString(opts, 'likertNeutralBrief', { v1: neutralLabel }),
      ));
    } else if (neutralMode === 'positive' || neutralMode === 'negative') {
      const side = neutralMode === 'positive' ? sideWords.positiveSide : sideWords.negativeSide;
      notes.push(methodNote(
        chartString(opts, 'likertNeutralSideFull', { v1: neutralLabel, v2: side, v3: sideWords.boundary }),
        chartString(opts, 'likertNeutralSideBrief', { v1: neutralLabel, v2: side }),
      ));
    } else if (neutralMode === 'exclude') {
      notes.push(disclosureNote(
        chartString(opts, 'likertNeutralExcluded', { v1: neutralLabel, v2: items
          .map((item) => `${item.label} ${shareFmt(pctNeutral[item.id]!)}`)
          .join('; ') }),
      ));
    } else if (opts.methodNote === true) {
      notes.push(methodNote(
        chartString(opts, 'forcedChoiceFull', { v1: scale.length }),
        chartString(opts, 'forcedChoiceBrief', { v1: scale.length }),
      ));
    }
    if (baseNote) notes.push(
      knownBases.length === 0
        ? methodNote(chartString(opts, 'authoredSharesFull'), chartString(opts, 'authoredSharesBrief'))
        : knownBases.length === items.length && maxOf(knownBases) === minOf(knownBases)
          ? methodNote(chartString(opts, 'likertBaseFull', { v1: trimNumber(knownBases[0]!) }),
            chartString(opts, 'likertBaseBrief', { v1: trimNumber(knownBases[0]!) }))
          : methodNote(chartString(opts, 'likertBasesFull', { v1: trimNumber(minOf(knownBases)), v2: trimNumber(maxOf(knownBases)) }),
            chartString(opts, 'likertBasesBrief', { v1: trimNumber(minOf(knownBases)), v2: trimNumber(maxOf(knownBases)) })),
    );
    // The neutral treatment and the base change how the bars read and
    // print unless requiredNotes turns them off, and so does the net column: a signed figure
    // right of a bar reads as a change over time unless the chart says what
    // it is. The sort order is a method note.
    if (summary === 'net') {
      notes.push(methodNote(
        isAgreementScale ? chartString(opts, 'likertNetShort') : chartString(opts, 'likertNetFull', { v1: sideWords.positiveSide, v2: sideWords.negativeSide }),
        isAgreementScale ? chartString(opts, 'likertNetBrief') : chartString(opts, 'likertNetNamedBrief', { v1: short(sideWords.positiveSide), v2: short(sideWords.negativeSide) }),
      ));
    }
    if (sortBy === 'net' && opts.methodNote === true) notes.push(methodNote(chartString(opts, 'sortedNetFull'), chartString(opts, 'sortedNetBrief')));
    return notes;
  }

  function describe(): string {
    const lead = chartString(opts, 'likertDescStart', { v1: items.length, v2: items.length === 1 ? '' : 's', v3: scale.length, v4: labelOf(0), v5: labelOf(scale.length - 1) });
    const convention =
      neutralMode === 'split'
        ? chartString(opts, 'likertSplitDesc', { v1: labelOf(neutralIndex), v2: sideWords.boundary })
        : neutralMode === 'exclude'
          ? chartString(opts, 'likertExcludeDesc', { v1: labelOf(neutralIndex) })
          : neutralMode === 'none'
            ? chartString(opts, 'likertForcedDesc')
            : chartString(opts, 'likertSideDesc', { v1: labelOf(neutralIndex), v2: neutralMode === 'positive' ? sideWords.positiveSide : sideWords.negativeSide });
    const rows = ordered
      .map((item) => {
        const baseText = item.base === undefined ? chartString(opts, 'baseNotStated') : `n ${trimNumber(item.base)}`;
        return chartString(opts, 'likertResponseDesc', { v1: item.label, v2: shareFmt(pctNegative[item.id]!), v3: sideWords.negative, v4: shareFmt(pctNeutral[item.id]!), v5: shareFmt(pctPositive[item.id]!), v6: sideWords.positive, v7: signedText(net[item.id]!), v8: baseText });
      })
      .join('. ');
    // The page keeps the short note, so the reading names
    // every share the bars do not print, by scale point and statement.
    const hidden = new Set(geo.labels.filter((label) => label.kind === 'segment' && label.hidden === 'density')
      .map((label) => `${label.owner.categoryId}\u0000${String(label.owner.seriesId).replace(/^likert:/, '').replace(/:(neg|pos)$/, '')}`));
    const unprinted = ordered.flatMap((item) => scale.flatMap((option, i) => hidden.has(`${item.id}\u0000${option.id}`)
      ? [`${labelOf(i)}, ${item.label} ${shareFmt(shares[item.id]![option.id]!)}`] : []));
    const tail = unprinted.length > 0 ? ` ${chartString(opts, 'sharesNotPrinted')}: ${unprinted.join('; ')}.` : '';
    return `${lead}${convention} ${rows}.${tail}`;
  }

  function signedText(value: number): string {
    return formatterFromExample(netExample, options?.locale?.language)(value);
  }
}

/**
 * The nets print as one right-aligned column under the head
 * "Net, pp", so a signed figure is not read as a change over time. The bar
 * layout sets each net at its bar's end; the column takes the rightmost of
 * those edges, which lies right of every bar.
 */
function netColumn(geo: Geometry<BarMarks, BarDerived>, theme: Theme, measure: TextMeasurer, options: LikertOptions, contentRight: number, statementTop?: number): void {
  const nets = geo.labels.filter((label) => label.kind === 'grandTotal' && !label.hidden);
  if (nets.length === 0) return;
  // The column stands at the content edge, apart from the bars.
  const right = Math.max(contentRight, maxOf(nets.map((label) => label.rect.x + label.rect.w)));
  for (const label of nets) {
    const dx = right - (label.rect.x + label.rect.w);
    label.rect = { ...label.rect, x: label.rect.x + dx };
    const node = geo.scene.find((n) => n.id === `label:${label.id}`);
    if (node?.t === 'text') node.x += dx;
  }
  const text = chartString(options, 'netPp');
  const font = { family: theme.type.family, ...theme.type.label };
  const size = measure(text, font);
  const top = statementTop ?? minOf(geo.marks.rows.flatMap((row) => row.bars.map((bar) => bar.rect.y)));
  // The head is a column title, quieter than the bold nets under it.
  const head: PlacedLabel = {
    id: 'likert:netHead', kind: 'series', owner: {}, text, lines: [text], slot: 'columnHead', slots: ['columnHead'], pinned: false, priority: PRIORITY.endpoint,
    ink: { token: 'inkMuted' }, rect: { x: right - size.width, y: top - 4 - size.height, w: size.width, h: size.height },
  };
  geo.labels.push(head);
  geo.scene.push(...labelsToNodes(theme, [head], () => font));
}

/**
 * Each statement on its own line(s) above its bar, from the content
 * edge, and the centre line as one tick per row so it never crosses a
 * statement. Returns the top of the first statement.
 */
function stackStatements(
  geo: Geometry<BarMarks, BarDerived>,
  theme: Theme,
  statements: string[][],
  font: FontSpec,
  lineH: number,
  left: number,
  measure: TextMeasurer,
): number {
  const order = geo.derived.order;
  const labels: PlacedLabel[] = [];
  let firstTop = Infinity;
  const ticks: string[] = [];
  const baseline = geo.scene.find((node) => node.id === 'axis:baseline');
  const x = baseline?.t === 'line' ? baseline.x1 : undefined;
  geo.marks.rows.forEach((row) => {
    const index = order.indexOf(row.id);
    const lines = statements[index];
    if (!lines || lines.length === 0) return;
    const h = lines.length * lineH;
    const y = row.rect.y - STATEMENT_GAP - h;
    firstTop = Math.min(firstTop, y);
    labels.push({
      id: `category:${row.id}`, kind: 'category', owner: { categoryId: row.id }, text: lines.join(' '), lines,
      rect: { x: left, y, w: Math.max(...lines.map((line) => measure(line, font).width)), h },
      slot: 'above', slots: ['above'], pinned: false, priority: PRIORITY.endpoint, ink: { token: 'ink' }, typeRole: 'label',
    });
    if (x !== undefined) ticks.push(`M${round2(x)} ${round2(row.rect.y - TICK_OVERHANG)}V${round2(row.rect.y + row.rect.h + TICK_OVERHANG)}`);
  });
  if (baseline?.t === 'line' && ticks.length) {
    const at = geo.scene.indexOf(baseline);
    geo.scene[at] = { t: 'path', id: baseline.id, d: ticks.join(''), stroke: baseline.stroke, width: baseline.width, owner: baseline.owner, part: baseline.part };
  }
  pushAll(geo.labels, labels);
  pushAll(geo.scene, labelsToNodes(theme, labels, () => font));
  return Number.isFinite(firstTop) ? firstTop : minOf(geo.marks.rows.map((row) => row.rect.y));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Restore the response paints and their warning sources after the bar layout. */
function restoreLikertPaints(
  geo: Geometry<BarMarks, BarDerived>,
  ramp: readonly { css: string; paint: Paint }[],
  scale: readonly LikertScaleOption[],
  seriesIdOf: (index: number, half?: 'neg' | 'pos') => Id,
  paintWarningRules: readonly PaintWarningRule[],
  theme: Theme,
): PaintWarningRule[] {
  const symbolicByCss = new Map(ramp.map((entry) => [entry.css.toUpperCase(), entry.paint]));
  const symbolicBySeries = new Map(scale.flatMap((_, index) =>
    [seriesIdOf(index), seriesIdOf(index, 'neg'), seriesIdOf(index, 'pos')].map(id => [id, ramp[index]!.paint] as const)));
  const symbolic = (paint: Paint | undefined, seriesId?: Id): Paint | undefined => {
    if (!paint) return paint;
    if ('css' in paint) return (seriesId ? symbolicBySeries.get(seriesId) : undefined) ?? symbolicByCss.get(paint.css.toUpperCase()) ?? paint;
    if (paint.theme?.kind === 'contrast-ink') return { ...paint, theme: { ...paint.theme, fill: symbolic(paint.theme.fill, seriesId)! } };
    return paint;
  };
  for (const label of geo.labels) label.ink = symbolic(label.ink, label.owner.seriesId)!;
  geo.scene = geo.scene.map((node) => {
    if (node.t === 'rect') {
      const rebound = { ...node, fill: symbolic(node.fill, node.owner.seriesId)!, ...(node.stroke ? { stroke: symbolic(node.stroke, node.owner.seriesId) } : {}) };
      // Likert shares use labels or the disclosure, never a segment frame.
      if (node.part === 'segment') {
        delete rebound.separation;
        delete rebound.stroke;
        delete rebound.strokeWidth;
        return rebound;
      }
      // The separation rule follows the fill, so a repaint under a new theme recomputes the edge from it.
      return node.separation ? repaintSeparation({ ...rebound, separation: { ...node.separation, fill: symbolic(node.separation.fill, node.owner.seriesId)! } }, theme) : rebound;
    }
    if (node.t === 'line') return { ...node, stroke: symbolic(node.stroke, node.owner.seriesId)! };
    if (node.t === 'path') {
      return {
        ...node,
        ...(node.fill ? { fill: symbolic(node.fill, node.owner.seriesId) } : {}),
        ...(node.stroke ? { stroke: symbolic(node.stroke, node.owner.seriesId) } : {}),
      };
    }
    if (node.t === 'circle') {
      return { ...node, fill: symbolic(node.fill, node.owner.seriesId)!, ...(node.stroke ? { stroke: symbolic(node.stroke, node.owner.seriesId) } : {}) };
    }
    if (node.t === 'image') return node;
    return { ...node, ink: symbolic(node.ink, node.owner.seriesId)! };
  });

  return [
    ...(geo.paintWarningRules ?? []).map(rule => rule.kind === 'series-adjacent-similar'
      ? { ...rule, samples: rule.samples.map(sample => ({ ...sample, paint: symbolic(sample.paint, sample.seriesId)! })) }
      : rule),
    ...paintWarningRules.map(rule => ({ ...rule, before: rule.before + geo.warnings.filter(warning => warning.code !== 'series-adjacent-similar').length })),
  ];
}

/** The bar delegate measures statement names and ordinary keys with its axis role. */
function statementLabelTheme(ref: ThemeRef | undefined, size: number): ThemeRef {
  const selected = typeof ref === 'string' ? { preset: ref } : ref ?? { preset: resolveTheme().name };
  const type = selected.overrides?.type;
  const authored = selected.overrides ?? {};
  return {
    ...selected,
    overrides: libraryPatch({
      ...selected.overrides,
      type: {
        ...type,
        axis: { ...type?.axis, size },
        scale: { ...type?.scale, S: { ...type?.scale?.S, axis: size }, L: { ...type?.scale?.L, axis: size } },
      },
    }, authored),
  };
}

/**
 * Positional or keyed values, resolved against the declared scale. Both forms
 * must cover every declared option: the base is the sum of the DECLARED
 * options, so a silently absent one shrinks the denominator.
 */
function alignToScale(
  item: LikertItem,
  scale: LikertScaleOption[],
  path: string,
): (number | null)[] {
  const values = item.values;
  if (!Array.isArray(values)) {
    throw new NormalizeError(
      'likert-values-arity',
      `${path}.values`,
      `statement '${item.id}' has no values array`,
    );
  }
  const keyed = values.length > 0 && typeof values[0] === 'object' && values[0] !== null;
  if (!keyed) {
    if (values.length !== scale.length) {
      throw new NormalizeError(
        'likert-values-arity',
        `${path}.values`,
        `statement '${item.id}' supplies ${values.length} values for a ${scale.length}-point scale; positional values are matched to the scale by position, so the mismatch cannot be resolved`,
        `supply ${scale.length} values, or use the { optionId, value } form`,
      );
    }
    return values as (number | null)[];
  }
  const byOption = new Map<Id, number | null>();
  (values as LikertResponse[]).forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || !('optionId' in entry)) {
      throw new NormalizeError(
        'likert-values-arity',
        `${path}.values[${i}]`,
        `statement '${item.id}' mixes positional and keyed values`,
        'use one form for the whole item',
      );
    }
    if (!scale.some((option) => option.id === entry.optionId)) {
      throw new NormalizeError(
        'likert-unknown-option',
        `${path}.values[${i}].optionId`,
        `statement '${item.id}' answers option '${entry.optionId}', which is not on the declared scale`,
        scale.map((option) => option.id).join(', '),
      );
    }
    if (byOption.has(entry.optionId)) {
      throw new NormalizeError(
        'likert-duplicate-option',
        `${path}.values[${i}].optionId`,
        `statement '${item.id}' answers option '${entry.optionId}' twice`,
      );
    }
    byOption.set(entry.optionId, entry.value);
  });
  return scale.map((option) => (byOption.has(option.id) ? byOption.get(option.id)! : null));
}

/**
 * The diverging bad -> neutral -> good tone ramp. The disagree side is the
 * theme's bad fill; the agree side is its colour-blind good fill
 * (color.colorblind.goodFill, else color.colorblind.good), a blue in every
 * preset. Red against green folds the two sides into one beige for a
 * red-green colour-blind reader; red against blue keeps them apart.
 * Theme tokens tinted toward
 * the theme background, exactly as heatmap builds its value ramp; the mapping
 * keeps its bad/good extremes fixed because sign semantics are declared, not
 * ramped. The compatible neutral centre may take the
 * selected palette's base identity. Each step toward the centre lightens.
 *
 * READ THE ARGUMENT: `tint(color, amount, background)` is
 * `mixColors(color, background, 1 - amount)` (src/core/color.ts:66), so
 * `amount` IS THE AMOUNT OF BACKGROUND — it keeps (1 - amount) of `color`,
 * which is what scatter/marks.ts (quadrantTint) spells out and what heatmap's ladder
 * assumes when it runs 0.85 (palest) -> 0.24 -> the bare token (strongest,
 * heatmap/layout.ts:181-186). The extreme takes amount 0 — the token itself —
 * and each step toward the centre adds background. Passing a STRENGTH here
 * would invert the ramp and paint the two options a Likert exists to show
 * in the exact page colour.
 *
 * `RAMP_MAX_TINT` is the innermost step and the floor of the ladder, the same
 * role pie's `RAMP_MAX_TINT = 0.82` plays (pie/layout.ts:246): a cap that
 * keeps the palest step off the page colour. 0.40 keeps 60% of the token,
 * strong enough that the mildest option reads apart from the pale neutral
 * (NEUTRAL_WASH) and from the mildest option of the other side.
 *
 * VISIBILITY IS NOT ASSUMED, IT IS MEASURED. Every step is checked against the
 * background at the repo's own bar for a categorical fill —
 * `seriesBackgroundFloor` in themeValidate.ts:207, 3:1 on a dark surface and
 * 1.4:1 on a light one — and any step under it is pulled back toward the token
 * until it clears. If even the bare token cannot clear it, the theme itself is
 * at fault (themeValidate raises `semantic-invisible` for exactly this) and
 * the exhibit says so rather than painting an invisible mark in silence.
 */
/**
 * Refuse a key this type does not understand, naming it and where it sits.
 *
 * A Likert denominator is the sum of the DECLARED options, so an undeclared
 * response bucket is not a harmless extra field: it is responses the chart
 * would silently drop out of the base. "Don't know" belongs ON the scale,
 * which forces the author to decide which side it sits on — the engine must
 * never decide it, and must never quietly discard it either.
 */
function assertNoUnknownKeys(node: unknown, path: string, allowed: string[]): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const unknown = Object.keys(node as Record<string, unknown>).filter(
    (key) => !allowed.includes(key),
  );
  if (unknown.length === 0) return;
  throw new NormalizeError(
    'likert-unknown-key',
    path,
    `${path} carries ${unknown.map((key) => `'${key}'`).join(', ')}, which this chart type does not read; an undeclared response bucket would be dropped out of the denominator and every printed share would be a share of a population you did not intend`,
    `declare it as a scale option — which forces the decision about which side it sits on — or remove it. Known keys: ${allowed.join(', ')}`,
  );
}

const RAMP_MAX_TINT = 0.4;
/** The neutral's wash: paler than any coloured option, still held to the mark floor. */
const NEUTRAL_WASH = 0.78;
/**
 * The contrast one option keeps from its neighbour toward the extreme. The
 * shipped themes clear it (1.56:1 in standard-dark); a bad fill near the
 * dark-card floor would fold Disagree into Strongly disagree at 1.12:1.
 */
const RAMP_APART = 1.5;

function divergingRamp(
  length: number,
  negativeIndices: number[],
  positiveIndices: number[],
  neutralIndex: number,
  theme: Theme,
  scale: LikertScaleOption[],
  warnings: LintWarning[],
  neutralPaint: Paint,
  paintWarningRules: PaintWarningRule[],
): { css: string; paint: Paint }[] {
  const rule: Extract<PaintWarningRule, { kind: 'likert-ramp-invisible' }> = {
    kind: 'likert-ramp-invisible', before: warnings.length, options: [],
  };
  // Steps from the extreme: each one keeps RAMP_APART more contrast from the
  // token than the one before, so the floor cannot fold two options into one.
  const visible = (paint: Paint, amount: number, optionIndex: number, fromExtreme = 0, darkApartFrom?: Paint[]): { css: string; paint: Paint } => {
    rule.options.push({ label: scale[optionIndex]!.label ?? scale[optionIndex]!.id, paint, amount });
    const recipe = {
      kind: 'visible-tint' as const, base: paint, amount, floor: 'mark' as const,
      ...(fromExtreme > 0 ? { apart: RAMP_APART ** fromExtreme } : {}),
      ...(darkApartFrom?.length ? { darkApartFrom: { paint: darkApartFrom, distance: PALETTE_NORMAL_FLOOR } } : {}),
    };
    const resolvedPaint: Paint = amount === 0 ? paint
      : { token: 'token' in paint ? paint.token : 'neutral', theme: recipe };
    return { css: paintColor(theme, resolvedPaint), paint: resolvedPaint };
  };

  // `amount` is the amount of BACKGROUND: 0 at the extreme, RAMP_MAX_TINT at
  // the option nearest the centre. `rank` counts outward from the centre.
  const wash = (rank: number, steps: number) =>
    steps <= 1 ? 0 : RAMP_MAX_TINT * (1 - rank / (steps - 1));
  const out = new Array<{ css: string; paint: Paint }>(length);
  negativeIndices.forEach((i, k) => {
    // k = 0 is the most negative option, which is the outermost segment.
    out[i] = visible(signedFillPaint('bad'), wash(negativeIndices.length - 1 - k, negativeIndices.length), i, k);
  });
  positiveIndices.forEach((i, k) => {
    out[i] = visible(colorblindPaint('good', true), wash(k, positiveIndices.length), i, positiveIndices.length - 1 - k);
  });
  if (neutralIndex >= 0) {
    // The centre is the quietest tone on the chart: a grey washed further than
    // the mildest coloured option, so the sides read as colour and the centre
    // as a pale grey. On a dark page the mark floor stops every wash at about
    // the same lightness, so the grey steps back toward its token until it sits
    // a palette step from both neighbours.
    const neighbours = [out[negativeIndices.at(-1) ?? -1], out[positiveIndices[0] ?? -1]].flatMap((entry) => entry ? [entry.paint] : []);
    out[neutralIndex] = visible(neutralPaint, NEUTRAL_WASH, neutralIndex, 0, neighbours);
  }

  paintWarningRules.push(rule);
  warnings.push(...resolvePaintWarnings(theme, [rule]));
  return out;
}

/**
 * The legend reads in scale order. The author chooses whether there is one and
 * where it sits; the ORDER is derived, because the series ids it would have to
 * name are an implementation detail of the sign encoding.
 */
function resolveLegend(
  requested: BaseOptions['legend'],
  order: Id[],
  warnings: LintWarning[],
): LegendOptions | undefined {
  // A LIKERT'S SERIES ARE ITS RESPONSE SCALE, SO THE KEY IS NOT DECORATION.
  //
  // The library default is no legend, which is right for a bar chart whose
  // series are named on the axis and wrong here: with no legend and no direct
  // option labels, a five-point scale renders as coloured blocks carrying
  // percentages and nothing anywhere on the canvas says which block is 'Agree'
  // and which is 'Strongly agree'. Every shipped fixture set `legend: 'bottom'`
  // by hand, which is what hid this in review — the shape an agent gets first
  // (`{ values: 'counts' }` and nothing else) was the one undecodable output.
  //
  // `legend: 'none'` still turns it off; this only changes the default.
  const resolved = (requested === 'auto' ? undefined : requested) ?? 'top';
  if (resolved === 'none') return undefined;
  requested = resolved;
  const asOptions: LegendOptions = { ...normalizeLegendOption(requested) };
  if (asOptions.order !== undefined) {
    warnings.push({
      code: 'likert-legend-order-derived',
      severity: 'info',
      message:
        'legend.order is replaced on a likert — the legend reads in scale order, and the series ids it would have to name encode the internal sign flip',
      suggest: 'reorder data.scale if the reading order is wrong',
    });
  }
  return { ...asOptions, order };
}

/** Keep Likert's reading order and typography when delegating to the bar engine. */
function likertBarOptions(options: LikertOptions, labelSize: number): BaseOptions {
  const {
    // `sort`/`topN` are not on LikertOptions, but a direct caller can still
    // hand them over past the schema — they are lint-and-drop here rather than
    // silently forwarded to a bar engine that would honour them and fight
    // `sortBy`.
    values: _values,
    neutral: _neutral,
    summary: _summary,
    sortBy: _sortBy,
    methodNote: _methodNote,
    format: _format,
    footnotes: _footnotes,
    legend: _legend,
    valueAxis: _valueAxis,
    ...rest
  } = options as LikertOptions & { sort?: unknown; topN?: unknown };
  const out = keepShownNotes(options, { ...rest }) as BaseOptions;
  delete out.sort;
  delete out.topN;
  return { ...out, theme: statementLabelTheme(options.theme, labelSize) };
}
