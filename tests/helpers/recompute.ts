/**
 * THE RECEIPT GATE.
 *
 * A claim record is a receipt. The only property that makes it one is this:
 * a reader who holds nothing but the record can apply the NAMED op to the
 * NAMED operands and land on the NAMED output. Everything else — verify
 * re-running the layout, hashes over the source — proves the artifact was not
 * edited. It does not prove the number follows from anything.
 *
 * Three failure modes this module exists to name, all of them found shipping:
 *
 *  - EMPTY: `kind:'derived', inputs: []`. Nothing in the record can contradict
 *    the number, so `verify` reporting "full claim records match" is reporting
 *    that it compared a value to itself.
 *  - IDENTITY: the operands are derived from the output (`pareto-vital-few@1`
 *    listed `vitalFew.map(...)` and output `vitalFew.length`). It cannot fail
 *    for any input, which is the same thing as not being checked.
 *  - MISLEADING: the op names only the ROOT of a calc tree. `mul(div(gp,rev),100)`
 *    recorded as `op:'mul@1', inputs:[gp,rev]` invites the reader to compute
 *    5.02e19 against a chart that says 35.0% — a missing receipt is a gap, this
 *    one is an accusation of tampering against a correct exhibit.
 *
 * So: every claim whose `kind` is a DERIVATION (`derived` | `aggregate` |
 * `reconciliation` | `rounding`) must reproduce here. A value that cannot be
 * reproduced from manifest-resident operands is not a derivation and must not
 * be labelled one — it is `observed` (measured off the source sample, which the
 * manifest binds by `sourceSha256`, not by copy) or `authored` (a number the
 * document typed). Those two kinds carry no arithmetic promise and `verify`
 * counts them separately, so nothing is reported as checked that was not.
 */

import { roundHalfUp } from '../../src/core/formatPrecision';
import { cagr } from '../../src/core/format';
import { olsFit, type OlsFit } from '../../src/core/ols';
import type { ClaimRecordV1 } from '../../src/core/claims';

/** Kinds that promise "this follows from the operands in this record". */
export const DERIVATION_KINDS = ['derived', 'aggregate', 'reconciliation', 'rounding'] as const;

export type ReceiptVerdict =
  | { status: 'reproduced'; expected: number | null }
  | { status: 'mismatch'; expected: number | null; recorded: number | null }
  | { status: 'no-operands'; reason: string }
  | { status: 'unknown-op'; reason: string }
  | { status: 'not-a-derivation'; reason: string };

/** Two decimals, the engine's own rounding helper semantics. */
const round2 = (v: number): number => Math.round(v * 100) / 100;

type Operands = { ref: string; value: number | null; state?: string }[];

/**
 * Each entry answers exactly one question: given these operands, what number
 * does this op produce? A `null` return means "the operands do not determine an
 * answer" (a missing value), which is only legal when `output.raw` is null too.
 */
const OPS: Record<string, (inputs: Operands) => number | null> = {
  // --- table -----------------------------------------------------------------
  // A `sum` aggregate is an n-ary fold over its own children, so it needs no
  // expression; every OTHER table receipt is a calc TREE and arrives here as a
  // canonical expression string (see evalExpression below), not as one of these
  // entries. Naming `mul@1` here would re-open the exact trap: the root
  // operator applied to the leaf operands is not the calculation.
  'round-decimals@1': (i) => binary(i, (value, decimals) => Math.sign(value) * Number(roundHalfUp(Math.abs(value), decimals))),
  'sum@1': (i) => reduceSum(i),
  'mean@1': (i) => i.length && i.every(input => input.value !== null)
    ? i.reduce((sum, input) => sum + input.value! / i.length, 0) : null,
  'creative-fatigue@1': (i) => {
    const [current, baseline, direction, threshold] = i.map(input => input.value);
    if (i.length !== 4 || current == null || baseline == null || baseline <= 0 || threshold == null || (direction !== -1 && direction !== 1)) return null;
    return 100 * (current - baseline) / baseline * direction >= threshold ? 1 : 0;
  },
  // Largest-remainder display reconciliation: the exact share, rounded UP to
  // the next display unit. The unit is the second operand — without it the
  // adjustment is unfalsifiable, which is how it shipped.
  'share-reconcile@1': (i) =>
    binary(i, (exact, unit) => (unit === 0 ? null : Math.floor(exact / unit) * unit + unit)),
  // share@1 is the ONE op shared across likert and pyramid, and it is the op
  // that carries both operands. Same rule in both:
  // numerator first, denominator second, result in percentage POINTS.
  'share@1': (i) => binary(i, (a, b) => (b === 0 ? null : (100 * a) / b)),
  // The honesty footnote's number: how much of a parent/children disagreement
  // is an artefact of ROUNDING rather than a real difference.
  //   displayGap = printed parent − Σ printed children
  //   rawGap     = raw parent     − Σ raw children
  //   gap        = displayGap − rawGap   (rawGap suppressed when it is float
  //                                       noise from magnitude math)
  // It shipped stamped `kind:'rounding'` with only the children's raw values in
  // the record — no parent, no printed values, no definition here. `verify`
  // said so and failed correct tables. The operands now include the printed
  // numbers, so this is arithmetic over recorded values and needs no formatter:
  // parent raw, parent displayed, then each child raw, child displayed.
  'rounding-gap@1': (i) => {
    if (i.length < 4 || i.length % 2 !== 0) return null;
    const parentRaw = i[0]!.value;
    const parentShown = i[1]!.value;
    if (parentRaw === null || parentShown === null) return null;
    let rawSum = 0;
    let shownSum = 0;
    for (let k = 2; k < i.length; k += 2) {
      const raw = i[k]!.value;
      const shown = i[k + 1]!.value;
      if (raw === null || shown === null) return null;
      rawSum += raw;
      shownSum += shown;
    }
    const rawGap = parentRaw - rawSum;
    const noise = 1e-9 * Math.max(1, Math.abs(parentRaw), Math.abs(rawSum));
    const displayGap = parentShown - shownSum;
    return Math.abs(rawGap) > noise ? displayGap - rawGap : displayGap;
  },
  'ratio@1': (i) => binary(i, (a, b) => (b === 0 ? null : a / b)),

  // --- kpi -----------------------------------------------------------------
  // The REFUSAL is part of the op, not a tolerance around it. A percentage
  // change off a non-positive reference is not meaningful, so kpi suppresses it
  // and files `state:'ref-nonpositive', raw:null`. Encoding that here keeps the
  // suppression fail-capable: a claim that suppressed when it should not have,
  // or produced a number when it should have refused, still comes out as a
  // mismatch. Excusing null outputs generically would have made it invisible.
  'difference@1': (i) => binary(i, (a, b) => a - b),
  'percentDelta@1': (i) => binary(i, (a, b) => (b <= 0 ? null : (100 * (a - b)) / Math.abs(b))),
  'percentOf@1': (i) => binary(i, (a, b) => (b <= 0 ? null : (100 * a) / b)),

  // --- per-type ------------------------------------------------------------
  'cohort-retention@1': (i) => binary(i, (a, b) => (b === 0 ? null : a / b)),
  'cohort-average@1': (i) => {
    // sum(numerators) / sum(denominators) over the support pairs.
    if (i.length === 0 || i.length % 2 !== 0) return null;
    let num = 0;
    let den = 0;
    for (let k = 0; k < i.length; k += 2) {
      const a = i[k]!.value;
      const b = i[k + 1]!.value;
      if (a === null || b === null) return null;
      num += a;
      den += b;
    }
    return den === 0 ? null : num / den;
  },
  'pareto-cumshare@1': (i) => binary(i, (a, b) => (b === 0 ? null : (100 * a) / b)),
  // "These n causes together reach X% of the total": all n values, then the
  // total, and the share is the sum of the first over the last.
  'pareto-vital-few-share@1': (i) => {
    if (i.length < 2) return null;
    const total = i[i.length - 1]!.value;
    const part = reduceSum(i.slice(0, -1));
    return part === null || total === null || total === 0 ? null : (100 * part) / total;
  },
  'likert-net@1': (i) => binary(i, (a, b) => a - b),
  'variance-delta@1': (i) => binary(i, (a, b) => round2(a - b)),
  // Same refusal as kpi, same reason, and the layout warns `ref-nonpositive`
  // and marks the category n.m. when it fires.
  'variance-delta-pct@1': (i) =>
    binary(i, (a, b) => (b <= 0 ? null : round2((100 * (a - b)) / Math.abs(b)))),
  'funnel-conversion@1': (i) => binary(i, (a, b) => (a === 0 ? null : b / a)),
  'waterfall-total@1': (i) => reduceSum(i),
  'pvm-effect@1': (i) => reduceSum(i),
  'pvm-reconciliation@1': (i) => {
    // residual = delta − Σ effects. `delta` is the first operand by contract.
    if (i.length < 1) return null;
    const delta = i[0]!.value;
    if (delta === null) return null;
    let sum = 0;
    for (const effect of i.slice(1)) {
      if (effect.value === null) return null;
      sum += effect.value;
    }
    return delta - sum;
  },

  // --- annotations ---------------------------------------------------------
  // The most quotable numbers in the product. `+5.6% p.a.` is the one a presenter
  // says out loud; it must carry a raw value and its inputs.
  // The engine's own CAGR (format.ts `cagr`), signed convention included: a
  // second formula here disagreed on every negative base.
  'annotation-cagr@1': (i) => {
    const [from, to, years] = [i[0]?.value, i[1]?.value, i[2]?.value];
    return from == null || to == null || years == null ? null : cagr(from, to, years);
  },
  'annotation-diff-relative@1': (i) =>
    binary(i, (base, tip) => (base === 0 ? null : ((tip - base) / Math.abs(base)) * 100)),
  'annotation-diff-absolute@1': (i) => binary(i, (a, b) => b - a),
  'annotation-delta@1': (i) => binary(i, (at, vs) => at - vs),
  'annotation-abs@1': (i) => (i.length === 1 ? i[0]!.value : null),

  // --- scatter trend ------------------------------------------------------
  // Operands: n, x̄, ȳ, Σ(x−x̄)², Σ(y−ȳ)², Σ(x−x̄)(y−ȳ), in that order; the fit
  // follows from them. @1 took raw sums, which lose all variance at large offsets.
  'ols-slope@2': (i) => olsOf(i)?.slope ?? null,
  'ols-intercept@2': (i) => olsOf(i)?.intercept ?? null,
  'ols-r2@2': (i) => olsOf(i)?.r2 ?? null,
};

/**
 * The canonical-expression evaluator — the half of this module a third-party
 * consumer would have to write, written here so the repo's own gate is held to
 * the same standard as a stranger holding only the manifest.
 *
 * Grammar (emitted by table/resolve.ts `evalCalc`):
 *   expr   := op '(' expr (',' expr)* ')' | '$' digits | number | '<' state '>' | '?'
 * `$n` resolves to `inputs[n].value`. `<state>` and `?` are UNRESOLVED operands:
 * the calculation had nothing to work with, so the expression evaluates to null
 * and the record must say `output.raw: null`.
 */
const EXPR_OPS: Record<string, (args: (number | null)[]) => number | null> = {
  abs: ([a]) => (a === null || a === undefined ? null : Math.abs(a)),
  add: ([a, b]) => (a === null || b === null || a === undefined || b === undefined ? null : a + b),
  sub: ([a, b]) => (a === null || b === null || a === undefined || b === undefined ? null : a - b),
  mul: ([a, b]) => (a === null || b === null || a === undefined || b === undefined ? null : a * b),
  div: ([a, b]) =>
    a === null || b === null || a === undefined || b === undefined || b === 0 ? null : a / b,
  delta: ([a, b]) => (a === null || b === null || a === undefined || b === undefined ? null : a - b),
  // Same refusal as kpi and variance: no percent change off a nonpositive base.
  percentDelta: ([a, b]) =>
    a === null || b === null || a === undefined || b === undefined || b <= 0
      ? null
      : (100 * (a - b)) / b,
  share: ([a, b]) =>
    a === null || b === null || a === undefined || b === undefined || b === 0 ? null : (100 * a) / b,
  ref: ([a]) => a ?? null,
  lit: ([a]) => a ?? null,
};

/** True when `op` is a canonical calc expression rather than a bare op name. */
export function isExpression(op: string): boolean {
  return /^[A-Za-z]+\(/.test(op.replace(/@\d+$/, ''));
}

export function evalExpression(op: string, inputs: Operands): number | null {
  const source = op.replace(/@\d+$/, '');
  let at = 0;
  const fail = (): never => {
    throw new Error(`unparsable claim expression at ${at}: ${source}`);
  };
  const parse = (): number | null => {
    if (source[at] === '?') {
      at += 1;
      return null;
    }
    if (source[at] === '<') {
      const close = source.indexOf('>', at);
      if (close < 0) fail();
      at = close + 1;
      return null;
    }
    if (source[at] === '$') {
      at += 1;
      const start = at;
      while (at < source.length && /[0-9]/.test(source[at]!)) at += 1;
      if (at === start) fail();
      const index = Number(source.slice(start, at));
      const operand = inputs[index];
      if (!operand) fail();
      return operand!.value;
    }
    const name = /^[A-Za-z][A-Za-z0-9]*/.exec(source.slice(at));
    if (name && source[at + name[0].length] === '(') {
      at += name[0].length + 1;
      const args: (number | null)[] = [];
      for (;;) {
        args.push(parse());
        if (source[at] === ',') {
          at += 1;
          continue;
        }
        if (source[at] === ')') {
          at += 1;
          break;
        }
        fail();
      }
      const fn = EXPR_OPS[name[0]];
      if (!fn) fail();
      return fn!(args);
    }
    const literal = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(source.slice(at));
    if (!literal) fail();
    at += literal![0].length;
    return Number(literal![0]);
  };
  const value = parse();
  if (at !== source.length) fail();
  return value;
}

function olsOf(inputs: Operands): OlsFit | null {
  const v = inputs.map((input) => input.value);
  if (v.length !== 6 || v.some((value) => value === null)) return null;
  const [n, meanX, meanY, sxx, syy, sxy] = v as number[];
  return olsFit({ n: n!, meanX: meanX!, meanY: meanY!, sxx: sxx!, syy: syy!, sxy: sxy! });
}

function reduceSum(inputs: Operands): number | null {
  if (inputs.length === 0) return null;
  let total = 0;
  for (const input of inputs) {
    if (input.value === null) return null;
    total += input.value;
  }
  return total;
}

function binary(inputs: Operands, f: (a: number, b: number) => number | null): number | null {
  if (inputs.length !== 2) return null;
  const a = inputs[0]!.value;
  const b = inputs[1]!.value;
  if (a === null || b === null) return null;
  return f(a, b);
}

/**
 * Relative tolerance. Absolute equality is wrong here — the engine sums in a
 * different association order than a re-derivation does — but the tolerance is
 * RELATIVE to the magnitude and never widened per-op. 1e-9 relative is roughly
 * seven orders of magnitude tighter than any defect this gate is for; the
 * table `mul@1` case misses by eighteen orders of magnitude.
 */
export const RECEIPT_TOLERANCE = 1e-9;

/**
 * THE SCALE COMES FROM THE OPERANDS. NEVER FROM THE NUMBER 1.
 *
 * A scale of `Math.max(1, |expected|, |recorded|)` would make the tolerance
 * absolute for every value below one: a receipt recording 1e-13 where the
 * truth is 2e-13 — **wrong by 100%** — would be certified `reproduced`,
 * because 1e-13 is comfortably under 1e-9.
 *
 * This is a form of rounding before a decision, and a sharp one: a DECISION (reproduced /
 * mismatch) taken against an absolute epsilon makes the verdict depend on the unit of measure. The same true statement
 * about the same business — a margin expressed as 0.0000000002 rather than as
 * basis points — passes or fails depending on nothing but the units someone
 * chose. That is exactly what a receipt exists to rule out.
 *
 * What the tolerance is FOR is association order: the engine sums left-to-right
 * where a re-derivation may not, and that error is proportional to the
 * magnitude of the INTERMEDIATE TERMS, not of the result. A sum of values at
 * 1e13 carries representation error near 1e-3; the same sum at 1e-13 carries
 * error near 1e-29. So the operands set the scale, and when every magnitude in
 * sight is zero there is nothing to be relative to and equality must be exact.
 */
function closeEnough(
  expected: number,
  recorded: number,
  inputs: ClaimRecordV1['inputs'],
): boolean {
  let scale = Math.max(Math.abs(expected), Math.abs(recorded));
  for (const input of inputs) {
    const value = input.value;
    if (value !== null && Number.isFinite(value)) scale = Math.max(scale, Math.abs(value));
  }
  if (!(scale > 0)) return expected === recorded;
  return Math.abs(expected - recorded) <= RECEIPT_TOLERANCE * scale;
}

/**
 * The gate's single question, asked of one claim record.
 *
 * A claim whose kind is `observed` or `authored` makes no arithmetic promise,
 * so it is reported `not-a-derivation` and the gate lets it through — but the
 * gate ALSO asserts those kinds never carry an op that OPS knows, which is what
 * stops the two honest kinds from becoming a place to hide a broken derivation.
 */
export function recomputeClaim(claim: ClaimRecordV1): ReceiptVerdict {
  const derivation = (DERIVATION_KINDS as readonly string[]).includes(claim.kind);
  if (!derivation) {
    return { status: 'not-a-derivation', reason: `kind '${claim.kind}' promises no arithmetic` };
  }
  let expected: number | null;
  if (isExpression(claim.op)) {
    // A calc tree. The whole expression is the op, so there is nothing to look
    // up — evaluate it against the operands the record carries.
    try {
      expected = evalExpression(claim.op, claim.inputs);
    } catch (error) {
      return { status: 'unknown-op', reason: (error as Error).message };
    }
  } else {
    const op = OPS[claim.op];
    if (!op) {
      return {
        status: 'unknown-op',
        reason: `op '${claim.op}' has no definition over recorded operands — a reader cannot check it`,
      };
    }
    if (claim.inputs.length === 0) {
      return { status: 'no-operands', reason: `op '${claim.op}' recorded with inputs: []` };
    }
    if (claim.inputs.every((input) => input.value === null)) {
      return { status: 'no-operands', reason: `op '${claim.op}' recorded with every operand null` };
    }
    expected = op(claim.inputs);
  }
  const recorded = claim.output.raw;
  if (expected === null || recorded === null) {
    return expected === recorded
      ? { status: 'reproduced', expected }
      : { status: 'mismatch', expected, recorded };
  }
  return closeEnough(expected, recorded, claim.inputs)
    ? { status: 'reproduced', expected }
    : { status: 'mismatch', expected, recorded };
}
