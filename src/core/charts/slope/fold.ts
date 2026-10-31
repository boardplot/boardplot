import { chartString } from '../../strings/slope';
/**
 * `options.foldBelowShare`: the small end of a slope becomes one 'Other' line.
 *
 * THE SPELLING IS A SHARE, NOT A PERCENT. `0.05` folds every series that stays
 * under 5% of the endpoint total at BOTH ends. `5` is refused, because the two
 * readings differ by a factor of 100 and the wrong one folds either everything
 * or nothing while still drawing a chart the caller would publish. Pareto's
 * `threshold` is spelled in percent (80) and is the reason this option carries
 * the word `share` in its name.
 *
 * The range check lives here rather than in the zod schema on purpose: a zod
 * bound answers "Too big: expected number to be <1" with no repair, while the
 * refusal below carries the JSON Patch that turns 5 into 0.05.
 *
 * What the engine computes and records: the member ids, the summed value at
 * each end, the Other line's own share at each end, and one sentence naming
 * what was folded and how many series. Nothing here is authored text.
 */

import { receivedDescription } from '../../diagnostics/describe';
import { cleanFloat, round2 } from '../../geometry';
import { formatAutomaticPercent } from '../../format';
import type { Id, Scenario } from '../../types/cell';
import type { LintWarning } from '../../types/scene';
import { disclosureNote } from '../../notes';

/** One endpoint of a slope series. */
export interface EndVal {
  v: number | null;
  isPct: boolean;
  labelOverride?: string | false;
  format?: string;
  priority?: number;
}

/** A slope series after normalization: two endpoints and its paint identity. */
export interface NormSer {
  id: Id;
  label: string;
  scenario?: Scenario;
  /** A series may declare its own unit; the fold refuses to add across them. */
  unit?: string;
  format?: string;
  colorRole?: string;
  fill?: string;
  a: EndVal; // first category endpoint
  b: EndVal; // last category endpoint
}

/** The engine's record of a fold, published as `derived.folded`. */
export interface SlopeFoldRecord {
  /** The threshold as authored: 0.05 means 5 percent. */
  share: number;
  /** Id of the line the engine drew for the folded series. */
  otherId: Id;
  /** Folded series, in authored order. */
  memberIds: Id[];
  /** Sum of the folded values at the first and at the last category. */
  values: { from: number; to: number };
  /** The Other line's own share of each endpoint total, four decimals. */
  shares: { from: number; to: number };
  /** Endpoint totals the shares were measured against. */
  totals: { from: number; to: number };
  /** The sentence the footnote and the accessible description carry. */
  note: string;
}

interface SlopeFold {
  /** Plotted series after folding; the Other line is last. */
  plotted: NormSer[];
  /** Every series the legend and the unnamed-series check see. */
  listed: NormSer[];
  /** Legend key wording: 'Other (7 series below 5%)'. */
  legendLabel: string;
  record: SlopeFoldRecord;
}

const FOLD_FIELD = ['options', 'foldBelowShare'] as const;
const FOLD_POINTER = '/options/foldBelowShare';

/** Shares are read at four decimals: 0.2250 is a quarter percent apart from 0.2254. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The cutoff as the footnote, the legend and the description state it. It has
 * to be the cutoff that actually selected the members: rounding to one decimal
 * turns 0.05678 into "5.7%" and 0.00001 into "0%", and a note that says series
 * below 0 percent were folded states a threshold nothing was measured against.
 * The decimals are the fewest that still print the authored number.
 */
function sharePercentText(share: number, language?: string): string {
  const percent = share * 100;
  // The tolerance is relative, not absolute: an absolute one calls 0.0000001%
  // equal to zero and the note then states a cutoff of 0 while the members
  // were selected against a positive one.
  const close = (value: number): boolean =>
    Math.abs(value - percent) <= Math.abs(percent) * 1e-9;
  let decimals = 0;
  while (decimals < 12 && !close(Number(percent.toFixed(decimals)))) decimals++;
  return formatAutomaticPercent(Number(percent.toFixed(decimals)), decimals, false, language);
}

/**
 * The refusal for a value that is not a share. Returns null when the option is
 * absent or inside (0, 1). A percent spelling under 100 gets the patch that
 * divides it by 100; 0, a negative number and a non-finite number get the
 * sentence alone, because no single edit states what the caller meant.
 */
/** The one repair every mixed fold has: keep them apart, or make them alike. */
const RAISE_OR_SEPARATE = 'Raise foldBelowShare so they stay apart, or give the folded series the same kind.';

/** The smallest percentage `sharePercentText` can still print, at twelve decimals. */
const SMALLEST_STATED_PERCENT = 1e-12;

export function foldShareRefusal(share: number | undefined): LintWarning | null {
  if (share === undefined) return null;
  // A threshold the note cannot state is refused rather than printed as zero:
  // a footnote saying "below 0.000000000000%" names a cutoff nothing was
  // measured against, and no number of decimals fixes that for every input.
  if (Number.isFinite(share) && share > 0 && share * 100 < SMALLEST_STATED_PERCENT) {
    return {
      code: 'fold-share-out-of-range',
      severity: 'error',
      message: `foldBelowShare ${share} is too small to state as a percentage, so no footnote could name the cutoff`,
      suggest: 'Write a larger share, such as 0.05 for 5 percent.',
      field: FOLD_FIELD,
      expected: { types: ['number'], minimum: SMALLEST_STATED_PERCENT / 100, maximum: 1, inclusive: false },
      received: { type: 'number', value: share },
    };
  }
  if (Number.isFinite(share) && share > 0 && share < 1) return null;
  // Divide without rounding first: round2(99.999) is 100, and 100/100 is 1,
  // which this same check refuses. toPrecision clears the float noise of the
  // division (1.1/100), and the bound is re-checked, so the patch it proposes
  // always validates. Where it cannot, the sentence stands alone.
  const divided = Number.isFinite(share) && share >= 1 && share < 100
    ? Number((share / 100).toPrecision(12))
    : null;
  const asShare = divided !== null && divided > 0 && divided < 1 ? divided : null;
  return {
    code: 'fold-share-out-of-range',
    severity: 'error',
    // One reading, not two. Saying that 5 "reads as 500 percent" and then
    // proposing 0.05 "for 5 percent" puts two numbers in front of the caller
    // and leaves it to guess which one the engine means.
    message:
      `foldBelowShare is a share of the endpoint total between 0 and 1, and ${share} is not one` +
      (asShare !== null ? `. Written as a percentage, ${share} percent is ${asShare}` : ''),
    suggest:
      asShare !== null
        ? `Write ${asShare} for ${share} percent.`
        : 'Write a number above 0 and below 1, such as 0.05 for 5 percent.',
    field: FOLD_FIELD,
    expected: {
      types: ['number'],
      minimum: 0,
      maximum: 1,
      inclusive: false,
      condition: 'a share of the endpoint total, such as 0.05 for 5 percent',
    },
    received: receivedDescription(share),
    ...(asShare !== null
      ? { fix: [{ op: 'replace' as const, path: FOLD_POINTER, value: asShare }] }
      : {}),
  };
}

function endpointTotal(series: readonly NormSer[], end: 'a' | 'b'): number {
  return series.reduce((sum, s) => sum + (s[end].v ?? 0), 0);
}

/** A share of a total only reads as a share when nothing is negative. */
function negativeMember(series: readonly NormSer[]): NormSer | undefined {
  return series.find((s) => (s.a.v ?? 0) < 0 || (s.b.v ?? 0) < 0);
}

function otherLineId(taken: readonly NormSer[]): Id {
  let id: Id = 'other';
  while (taken.some((s) => s.id === id)) id = `_${id}`;
  return id;
}

function foldNote(
  members: readonly NormSer[],
  values: { from: number; to: number },
  pct: { from: boolean; to: boolean },
  ctx: FoldContext,
  share: number,
): string {
  const percent = sharePercentText(share, ctx.language);
  return disclosureNote(
    chartString({ locale: { language: ctx.language } }, 'slopeFoldHead', { v1: ctx.othersLabel, v2: members.length, v3: percent }) +
    // The note names what it folded, not only how many.
    `(${members.map((member) => member.label).join(', ')}), ` +
    chartString({ locale: { language: ctx.language } }, 'slopeFoldSum', { v1: ctx.format(values.from, pct.from), v2: ctx.categories.from }) +
    chartString({ locale: { language: ctx.language } }, 'slopeFoldEnd', { v1: ctx.format(values.to, pct.to), v2: ctx.categories.to })
  );
}

interface FoldContext {
  /** Name of the folded line. `strings.others` wins over the built-in word. */
  othersLabel: string;
  /**
   * The chart's own unit. A series without one is measured in it, so the fold
   * compares `series.unit ?? chartUnit`, the reading the rest of the engine
   * already uses (`core/a11y/categoryRecords.ts:24`).
   */
  chartUnit?: string;
  /** Series the author emphasized; they keep their own name whatever their share. */
  highlights: ReadonlySet<Id>;
  /**
   * Endpoint value formatter of the calling layout. The flag is the endpoint's
   * own percent semantics: the note has to read the way the label reads.
   */
  format: (value: number, isPct: boolean) => string;
  categories: { from: string; to: string };
  language?: string;
  warnings: LintWarning[];
}

/**
 * Fold every plotted series that stays under `share` of its endpoint total at
 * both ends. Returns null when nothing is folded, and says in a warning why.
 *
 * Both ends decide together: a series that crosses the share at one end is a
 * series whose movement is the point of the exhibit, and a fold that hid it
 * would answer a question about the small end by deleting the answer.
 */
export function planSlopeFold(
  plotted: readonly NormSer[],
  listed: readonly NormSer[],
  share: number,
  ctx: FoldContext,
): SlopeFold | null {
  const negative = negativeMember(plotted);
  const totals = { from: endpointTotal(plotted, 'a'), to: endpointTotal(plotted, 'b') };
  if (negative || totals.from <= 0 || totals.to <= 0) {
    ctx.warnings.push({
      code: 'fold-share-undefined',
      severity: 'warn',
      message: negative
        ? `foldBelowShare needs values at or above zero at both ends, and series '${negative.id}' is negative — nothing folded`
        : `foldBelowShare needs a positive total at both ends, and the endpoints sum to ${round2(totals.from)} and ${round2(totals.to)} — nothing folded`,
      suggest: 'Drop foldBelowShare on data that crosses zero, or plot the levels the shares are taken of.',
      field: FOLD_FIELD,
    });
    return null;
  }
  const candidates = plotted.filter(
    (s) => (s.a.v ?? 0) / totals.from < share && (s.b.v ?? 0) / totals.to < share,
  );
  const members = candidates.filter((s) => !ctx.highlights.has(s.id));
  const kept = candidates.length - members.length;
  if (kept > 0) {
    ctx.warnings.push({
      code: 'fold-keeps-highlight',
      severity: 'info',
      message: `${kept} highlighted or annotated ${kept === 1 ? 'series stays' : 'series stay'} under their own name although they are below ${sharePercentText(share, ctx.language)} of the endpoint total`,
      field: FOLD_FIELD,
    });
  }
  if (members.length < 2) {
    ctx.warnings.push({
      code: 'fold-below-two',
      severity: 'info',
      message: members.length === 1
        ? `one series is below ${sharePercentText(share, ctx.language)} of the endpoint total at both ends — nothing folded, because one line named '${ctx.othersLabel}' says less than the line it replaces`
        : `no series is below ${sharePercentText(share, ctx.language)} of the endpoint total at both ends — nothing folded`,
      suggest: 'Raise foldBelowShare, or leave it out and let every series keep its name.',
      field: FOLD_FIELD,
    });
    return null;
  }
  return buildFold(members, plotted, listed, totals, share, ctx);
}

function buildFold(
  members: readonly NormSer[],
  plotted: readonly NormSer[],
  listed: readonly NormSer[],
  totals: { from: number; to: number },
  share: number,
  ctx: FoldContext,
): SlopeFold {
  const memberIds = new Set(members.map((s) => s.id));
  const values = {
    from: members.reduce((sum, s) => sum + s.a.v!, 0),
    to: members.reduce((sum, s) => sum + s.b.v!, 0),
  };
  // A fold of forecast lines is still forecast. The renderer draws FC dashed
  // and hatches its legend key off `scenario`, so dropping it would present an
  // aggregate of forecasts as an actual line. A fold that mixes scenarios
  // claims neither, and says so rather than picking one quietly.
  const scenario = members.every((s) => s.scenario === members[0]!.scenario)
    ? members[0]!.scenario
    : undefined;
  if (scenario === undefined && members.some((s) => s.scenario !== undefined)) {
    ctx.warnings.push({
      code: 'fold-mixed-scenarios',
      severity: 'warn',
      message: `${ctx.othersLabel} mixes scenarios (${
        [...new Set(members.map((s) => s.scenario ?? 'none'))].sort().join(', ')
      }) and carries none.`,
      suggest: RAISE_OR_SEPARATE,
    });
  }
  const units = [...new Set(members.map((s) => s.unit ?? ctx.chartUnit ?? ''))];
  if (units.length > 1) {
    ctx.warnings.push({
      code: 'fold-mixed-units',
      severity: 'warn',
      message: `${ctx.othersLabel} adds different units (${units.map((unit) => unit || 'none').join(', ')}); the sum is in none.`,
      suggest: RAISE_OR_SEPARATE,
    });
  }
  for (const end of ['a', 'b'] as const) {
    const pct = members.filter((s) => s[end].isPct).length;
    if (pct > 0 && pct < members.length) {
      ctx.warnings.push({
        code: 'fold-mixed-units',
        severity: 'warn',
        message: `${ctx.othersLabel} sums ${pct} percentage and ${members.length - pct} plain endpoints at ${end === 'a' ? ctx.categories.from : ctx.categories.to}; shown as a plain number.`,
        suggest: RAISE_OR_SEPARATE,
      });
    }
  }
  const other: NormSer = {
    id: otherLineId(listed),
    label: ctx.othersLabel,
    ...(scenario !== undefined ? { scenario } : {}),
    a: { v: values.from, isPct: members.every((s) => s.a.isPct) },
    b: { v: values.to, isPct: members.every((s) => s.b.isPct) },
  };
  const note = foldNote(members, values, { from: other.a.isPct, to: other.b.isPct }, ctx, share);
  return {
    plotted: [...plotted.filter((s) => !memberIds.has(s.id)), other],
    listed: [...listed.filter((s) => !memberIds.has(s.id)), other],
    legendLabel: `${ctx.othersLabel} (${members.length} series below ${sharePercentText(share, ctx.language)})`,
    record: {
      share,
      otherId: other.id,
      memberIds: members.map((s) => s.id),
      values: { from: cleanFloat(values.from), to: cleanFloat(values.to) },
      shares: { from: round4(values.from / totals.from), to: round4(values.to / totals.to) },
      totals: { from: cleanFloat(totals.from), to: cleanFloat(totals.to) },
      note,
    },
  };
}
