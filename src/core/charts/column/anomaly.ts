import { chartString } from '../../strings/column';
import { localeStrings } from '../../strings/column';
import { stringFields } from '../../strings';
import type { StringsSpec } from '../../types/options';
import type { Theme } from '../../types/theme';
import { dashToken, strokeToken } from '../../theme';
import { structureCount, type StructureCount } from '../../structureCounts';
/**
 * The column anomaly rule (options.anomaly): its refusals, the model the
 * marks and labels read, and the corridor bounds the value axis can show.
 * Everything after `columnAnomalyModel` reads the model; nothing recomputes
 * a score.
 */

import { spread1DResult } from '../../collide';
import type { LegendItemInput } from '../../frame';
import { formatAutomaticNumber } from '../../format';
import { rectContains, round2, type Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import type { LabelRequest } from '../../label/solver';
import { composedTextRole } from '../../textRole';
import type { FontSpec, TextMeasurer } from '../../text';
import { NormalizeError } from '../../normalize/shared';
import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { LintWarning, Paint, SceneNode } from '../../types/scene';
import type { NormSer } from './model';
import type { AnomalyDerived, AnomalyFlag, AnomalySpec } from './types';
import { maxOf, minOf } from '../../arrays';

/**
 * Median, Excel/MEDIAN convention, stated because an undeclared quantile
 * method is exactly the class of silent lie this product refuses: sort
 * ascending; odd count → middle value; even count → mean of the two middle.
 */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Consistency constant for MAD → σ under normality (the standard modified z-score constant). */
const MAD_SIGMA = 1.4826;

/**
 * Smallest sample the modified z-score is evaluated on. JUDGEMENT, stated as
 * one: below 8 points the median and the MAD are dominated by the very points
 * under test, and no reader would defend the word "outlier" from that base.
 */
const ANOMALY_MIN_N = 8;

export interface AnomalyModel extends AnomalyDerived {
  counts: StructureCount[];
  /** categoryId → flag, for O(1) lookup during the mark passes. */
  flagByCategory: Map<Id, AnomalyFlag>;
}

/**
 * anomaly / signColor preconditions (fail closed, before any geometry). They
 * run before sort/topN reshape the series the rule is about.
 */
export function refuseColumnEncodings(
  requestedVariant: 'grouped' | 'stacked' | 'stacked100',
  signColor: boolean,
  anomalySpec: AnomalySpec | undefined,
  dataSeries: NormSer[],
): void {
  if (signColor && (requestedVariant !== 'grouped' || dataSeries.length !== 1)) {
    // A stacked segment painted by sign is not a truthful encoding (the
    // segment's sign does not describe the stack it sits in), and silently
    // ignoring the option would leave the agent reporting a sign-coloured
    // exhibit that is not one.
    throw new NormalizeError(
      'sign-color-unsupported',
      'options.signColor',
      `signColor requires variant 'grouped' with exactly one data-role series; got variant '${requestedVariant}' with ${dataSeries.length} data-role series`,
      "drop signColor, or split the stack into one column chart per measure",
    );
  }
  if (anomalySpec) {
    if (dataSeries.length !== 1) {
      throw new NormalizeError(
        'anomaly-single-series',
        'options.anomaly',
        `anomaly needs exactly one data-role series; got ${dataSeries.length} — a robust score across two different measures is meaningless`,
        'chart one measure per exhibit, or pre-compute the deviation upstream',
      );
    }
    if (requestedVariant === 'stacked100') {
      throw new NormalizeError(
        'anomaly-composition-conflict',
        'options.anomaly',
        'anomaly is undefined on a 100% composition axis: percent shares have no deviation baseline',
        "use variant 'grouped' on the absolute values",
      );
    }
    refuseAnomalySpec(anomalySpec);
  }
}

/** The rule's own parameters: k above zero, or at least one finite, ordered bound. Column, line and combo. */
export function refuseAnomalySpec(anomalySpec: AnomalySpec): void {
  {
    if (anomalySpec.method === 'mad') {
      const k = anomalySpec.k ?? 3.5;
      if (!Number.isFinite(k) || k <= 0) {
        throw new NormalizeError(
          'anomaly-k-invalid',
          'options.anomaly.k',
          `anomaly.k must be a finite number greater than 0; got ${String(anomalySpec.k)}`,
        );
      }
    } else {
      const { low, high } = anomalySpec;
      if (low === undefined && high === undefined) {
        throw new NormalizeError(
          'anomaly-threshold-empty',
          'options.anomaly',
          "anomaly method 'threshold' needs at least one of low/high — a rule with no bound flags nothing and states nothing",
        );
      }
      if (low !== undefined && high !== undefined && low > high) {
        throw new NormalizeError(
          'anomaly-threshold-inverted',
          'options.anomaly',
          `anomaly threshold low (${low}) is above high (${high})`,
        );
      }
      if ((low !== undefined && !Number.isFinite(low)) || (high !== undefined && !Number.isFinite(high))) {
        throw new NormalizeError(
          'anomaly-threshold-inverted',
          'options.anomaly',
          'anomaly threshold bounds must be finite numbers',
        );
      }
    }
  }
}

/** The flag test and its sentence: MAD modified z against k, or authored bounds. */
function anomalyRule(
  anomalySpec: AnomalySpec,
  present: { categoryId: Id; value: number }[],
  statFmt: (v: number) => string,
  plainFmt: (v: number) => string,
  warnings: LintWarning[],
  words: ReturnType<typeof localeStrings>,
  locale?: string,
): AnomalyDerived & { counts: StructureCount[] } {
  const values = present.map((p) => p.value);
  const n = values.length;
  const flags: AnomalyFlag[] = [];
  let usable = true;
  let median: number | null = null;
  let centre: number | null = null;
  let mad: number | null = null;
  let scale: number | null = null;
  let corridor: { low: number | null; high: number | null } | null = null;
  let k: number | null = null;
  let baseline: 'zero' | 'median' | 'authored' = 'authored';
  let rule: string;
  let counts: StructureCount[];

  if (anomalySpec.method === 'mad') {
    k = anomalySpec.k ?? 3.5;
    baseline = anomalySpec.baseline ?? 'zero';
    if (n < ANOMALY_MIN_N) {
      usable = false;
      warnings.push({
        code: 'anomaly-sample-too-small',
        severity: 'warn',
        message: `anomaly rule not evaluated: ${n} non-null value(s), below the declared floor of ${ANOMALY_MIN_N} — median and MAD would be dominated by the points under test`,
        suggest: `supply at least ${ANOMALY_MIN_N} periods, or use method 'threshold' with explicit bounds`,
      });
      counts = [structureCount('periods', n, `${n} of the`), structureCount('periods', ANOMALY_MIN_N, undefined, { locale: { language: locale } })];
      rule = stringFields(words.anomalySmallSample, { count: n, minimum: ANOMALY_MIN_N }, locale);
    } else {
      const dataMedian = medianOf(values);
      mad = medianOf(values.map((v) => Math.abs(v - dataMedian)));
      // The centre of the JUDGEMENT is the baseline; the SPREAD is always
      // measured around the actual median. 'zero' says the input already is
      // a deviation, so the rule asks how far from zero, not from typical.
      // These are TWO numbers and they get TWO fields. Publishing the
      // baseline under the name `median` would make the receipt state a
      // falsehood by default — no centre m exists for which (m = 0, MAD = 4.5)
      // satisfies MAD = median|xi − m| on the flagship fixture — and it would
      // hide the location entirely, so a levels series and the same series
      // rebased to deviations would read alike while flagging 12/12 and 0/12
      // respectively.
      median = dataMedian;
      centre = baseline === 'zero' ? 0 : dataMedian;
      if (mad === 0) {
        // Undefined score. Substituting mean ± σ here would make one option
        // name mean two different tests — the definition of a silent lie.
        usable = false;
        scale = null;
        warnings.push({
          code: 'anomaly-mad-zero',
          severity: 'warn',
          message: `anomaly rule not evaluated: MAD is 0 (more than half of the ${n} values are identical), so the modified z-score has no denominator`,
          suggest: "more than half the values are identical — use method 'threshold' with explicit bounds",
        });
        counts = [structureCount('periods', n, undefined, { locale: { language: locale } })];
        rule = stringFields(words.anomalyZeroMad, { count: n }, locale);
      } else {
        scale = MAD_SIGMA * mad;
        const judgementCentre = centre;
        const corridorLow = judgementCentre - k * scale;
        const corridorHigh = judgementCentre + k * scale;
        corridor = { low: corridorLow, high: corridorHigh };
        for (const p of present) {
          const score = (p.value - judgementCentre) / scale;
          if (Math.abs(score) > k) flags.push({ categoryId: p.categoryId, value: p.value, score });
        }
        // Reconstructable from its own face: the sentence states the centre
        // the corridor is built around AND the median the spread is measured
        // around. Stating only the spread let two series with opposite
        // verdicts print the same sentence. k and the 1.4826 factor stay on
        // plainFmt — they are DIMENSIONLESS.
        counts = [structureCount('observations', n, `n = ${n}`)];
        rule = stringFields(words.anomalyMadRule, {
          k: plainFmt(k), factor: plainFmt(MAD_SIGMA), mad: statFmt(mad),
          centre: stringFields(baseline === 'zero' ? words.anomalyCentreZero : words.anomalyCentreMedian, { median: statFmt(dataMedian) }),
          low: statFmt(corridorLow), high: statFmt(corridorHigh), count: n,
        });
      }
    }
  } else {
    const low = anomalySpec.low;
    const high = anomalySpec.high;
    corridor = { low: low ?? null, high: high ?? null };
    for (const p of present) {
      if ((low !== undefined && p.value < low) || (high !== undefined && p.value > high)) {
        flags.push({ categoryId: p.categoryId, value: p.value, score: null });
      }
    }
    counts = [structureCount('observations', n, `n = ${n}`)];
    rule = stringFields(words.anomalyThresholdRule, {
      bounds: low !== undefined && high !== undefined ? stringFields(words.outsideBounds, { low: statFmt(low), high: statFmt(high) })
        : stringFields(low !== undefined ? words.belowBound : words.aboveBound, { value: statFmt(low ?? high!) }),
      count: n,
    });
  }
  return { counts, method: anomalySpec.method, baseline, k, median, centre, mad, scale, corridor, n, usable, rule, flags };
}

/** A flag count that says nothing, and flags the printed labels cannot explain. */
function anomalyFlagWarnings(
  present: { categoryId: Id; value: number }[],
  usable: boolean,
  flags: AnomalyFlag[],
  fmt: (v: number) => string,
  warnings: LintWarning[],
): void {
  const n = present.length;
  if (usable && n > 0 && flags.length === n) {
    warnings.push({
      code: 'anomaly-all-flagged',
      severity: 'warn',
      message: `every one of the ${n} periods is flagged`,
      suggest: 'a rule that flags everything describes nothing — check the baseline or raise k',
    });
  } else if (usable && n > 0 && flags.length * 2 > n) {
    // Exact equality was the whole guard, so 11 of 12 — which describes
    // nothing just as surely — went out with no warn-severity signal at all.
    // A MAJORITY is the principled cut: once more than half the periods are
    // "exceptional", the word has stopped meaning anything, whatever the
    // exact count. This runs on the integer counts, not on a rounded share.
    warnings.push({
      code: 'anomaly-most-flagged',
      severity: 'warn',
      message: `${flags.length} of the ${n} periods are flagged — a majority`,
      suggest:
        "a rule that flags most periods is describing the baseline, not the exceptions — check anomaly.baseline (the default 'zero' reads the input as a deviation, so a levels series flags almost everything) or raise k",
    });
  }
  // A DISCLOSURE, not a decision: the flag test (anomalyRule) runs at full float
  // precision and stays there. But the exhibit prints ROUNDED labels, so two
  // periods can carry the same printed number with only one of them flagged,
  // beside a corridor bound printed to that same figure. The reader cannot
  // see why, and nothing recorded that there was anything to see.
  if (usable && flags.length > 0 && flags.length < n) {
    const flaggedIds = new Set(flags.map((f) => f.categoryId));
    const byLabel = new Map<string, { flagged: number[]; clear: number[] }>();
    for (const p of present) {
      const key = fmt(p.value);
      if (!byLabel.has(key)) byLabel.set(key, { flagged: [], clear: [] });
      byLabel.get(key)![flaggedIds.has(p.categoryId) ? 'flagged' : 'clear'].push(p.value);
    }
    const ties = [...byLabel.entries()].filter(
      ([, side]) => side.flagged.length > 0 && side.clear.length > 0,
    );
    if (ties.length > 0) {
      warnings.push({
        code: 'anomaly-flag-label-tie',
        severity: 'warn',
        message: `the flag decision separates periods whose PRINTED labels are identical: ${ties
          .map(
            ([label, side]) =>
              `"${label}" is flagged at ${side.flagged.join(', ')} and clear at ${side.clear.join(', ')}`,
          )
          .join('; ')} — the rule ran on the unrounded values, the exhibit shows the rounded ones`,
        suggest:
          'raise the label precision with options.format so the two numbers read differently, or use method \'threshold\' with a bound that does not fall between them',
      });
    }
  }
}

/**
 * The anomaly model. Computed from the values the chart will actually plot,
 * so the rule and the marks cannot disagree. `values` are the values the rule
 * was computed from, kept for the offscale disclosure.
 */
export function columnAnomalyModel(
  anomalySpec: AnomalySpec,
  cats: Category[],
  series: NormSer,
  absOf: (s: NormSer, ci: number) => number | null,
  fmt: (v: number) => string,
  statFmt: (v: number) => string,
  locale: string | undefined,
  warnings: LintWarning[],
  strings?: StringsSpec,
): { anomaly: AnomalyModel; values: number[] } {
  const present: { categoryId: Id; value: number }[] = [];
  cats.forEach((c, ci) => {
    const v = absOf(series, ci);
    if (v !== null && Number.isFinite(v)) present.push({ categoryId: c.id, value: v });
  });
  return anomalyModel(anomalySpec, present, fmt, statFmt, locale, warnings, strings);
}

/**
 * The anomaly model over the (period, value) pairs a chart plots: the rule,
 * its flags, its warnings and the receipt. Column, line and combo.
 */
export function anomalyModel(
  anomalySpec: AnomalySpec,
  present: { categoryId: Id; value: number }[],
  fmt: (v: number) => string,
  statFmt: (v: number) => string,
  locale: string | undefined,
  warnings: LintWarning[],
  strings?: StringsSpec,
): { anomaly: AnomalyModel; values: number[] } {
  // k and the 1.4826 factor are DIMENSIONLESS: running them through `fmt`
  // would print "€3.5m" for a threshold on a currency-formatted chart.
  // Only the data-unit numbers (median, MAD, scale, corridor) take `fmt`,
  // which is exactly what makes the sentence match the axis digit for digit.
  // Exactly as many decimals as the number needs, up to four: 3.5 must not
  // print as "4" and 1.4826 must not print as "1.48" — a rounded consistency
  // constant is a different constant.
  const plainFmt = (v: number) => {
    let decimals = 4;
    for (let d = 0; d <= 4; d++) {
      const shifted = v * 10 ** d;
      if (Math.abs(shifted - Math.round(shifted)) < 1e-9) {
        decimals = d;
        break;
      }
    }
    return formatAutomaticNumber(v, { locale, decimals });
  };
  const values = present.map((p) => p.value);
  const ruled = anomalyRule(anomalySpec, present, statFmt, plainFmt, warnings, { ...localeStrings(locale), ...strings }, locale);
  anomalyFlagWarnings(present, ruled.usable, ruled.flags, fmt, warnings);
  const anomaly: AnomalyModel = {
    ...ruled,
    // An authored label NAMES the rule, it does not replace the derivation:
    // a caption that says "2σ rule" over a MAD corridor would be exactly the
    // silent lie the receipt exists to prevent, so the maths always follows.
    rule: anomalySpec.label ? `${anomalySpec.label} — ${ruled.rule}` : ruled.rule,
    flagByCategory: new Map(ruled.flags.map((f) => [f.categoryId, f] as const)),
  };
  // THE RECEIPT. `derived` is not surfaced by the CLI or the MCP server, so
  // this info warning is the only channel through which the driving agent
  // can quote the rule back to the human. It fires on every anomaly render,
  // degenerate ones included, and says so.
  warnings.push({
    code: 'anomaly-method',
    severity: 'info',
    message:
      `anomaly method '${anomaly.method}', baseline '${anomaly.baseline}', ` +
      // k is DIMENSIONLESS — a cut point on |modified z|, not a quantity in
      // the data's unit. Running it through `fmt` printed "k €4" for the
      // 3.5 the engine actually applied and drew: a unit on a unitless
      // constant, and a different cut point disclosed to the agent than to
      // the human on the page. `plainFmt` is what the rule sentence uses.
      `k ${anomaly.k === null ? 'n/a' : plainFmt(anomaly.k)}, ` +
      `centre ${anomaly.centre === null ? 'n/a' : statFmt(anomaly.centre)}, ` +
      `median ${anomaly.median === null ? 'n/a' : statFmt(anomaly.median)}, ` +
      `MAD ${anomaly.mad === null ? 'n/a' : statFmt(anomaly.mad)}, ` +
      `scale ${anomaly.scale === null ? 'n/a' : statFmt(anomaly.scale)}, ` +
      `n ${anomaly.n}, usable ${anomaly.usable}, flagged ${anomaly.flags.length} — ${anomaly.rule}`,
  });
  return { anomaly, values };
}

/**
 * Which corridor bounds the value axis reaches, the info warning for the
 * others, and the on-exhibit clause that names them.
 *
 * A corridor bound is drawn only where the value axis already reaches it.
 * It deliberately does NOT stretch the domain: with a clean sample the MAD
 * corridor sits near m ± 3.5σ while the data reaches ~±2.2σ, so honouring it
 * would inflate the domain by more than half and shrink every column to pay
 * for a rule nothing touches — past the waste bound. A bound the data never approaches is
 * not drawn, and an info warning says so; the NUMBER is still printed, in the
 * rule sentence and in the anomaly-method receipt, so nothing is suppressed
 * without a trace. On any chart that actually flags something the bound on
 * the flagged side lies inside the data extent by construction, so the
 * corridor that matters is always drawn.
 */
export function anomalyCorridor(
  anomaly: AnomalyModel | undefined,
  anomalyValues: number[],
  dLo: number,
  dHi: number,
  statFmt: (v: number) => string,
  warnings: LintWarning[],
  strings?: StringsSpec,
): { corridorShown: { low: boolean; high: boolean }; corridorNote: string } {
  const corridorShown: { low: boolean; high: boolean } = { low: false, high: false };
  /**
   * The on-exhibit trace for a suppressed corridor rule.
   * a suppression leaves a mark where the reader would look, and the reader
   * looks at the exhibit — a CLI info line is invisible in the SVG or PNG a
   * reader is handed. This clause is appended to the rendered rule sentence
   * and to a11y.desc, so the page itself says which bound is not drawn.
   */
  const words = { ...localeStrings(), ...strings };
  let corridorNote = '';
  if (anomaly?.usable && anomaly.corridor) {
    const inDomain = (bound: number | null): boolean =>
      bound !== null && Number.isFinite(bound) && bound >= dLo && bound <= dHi;
    corridorShown.low = inDomain(anomaly.corridor.low);
    corridorShown.high = inDomain(anomaly.corridor.high);
    const offscale: number[] = [];
    const missing: string[] = [];
    if (anomaly.corridor.low !== null && !corridorShown.low) {
      offscale.push(anomaly.corridor.low);
      missing.push(stringFields(words.lowerBound, { value: statFmt(anomaly.corridor.low) }));
    }
    if (anomaly.corridor.high !== null && !corridorShown.high) {
      offscale.push(anomaly.corridor.high);
      missing.push(stringFields(words.upperBound, { value: statFmt(anomaly.corridor.high) }));
    }
    if (offscale.length > 0) {
      // A blanket claim such as "no period comes near it" can be false — a bound
      // of −10.7 over data reaching −8 is 75% approached — so the sentence
      // explaining a suppression states the MEASURED approach instead of
      // asserting a comfortable one.
      const approach = (bound: number): string => {
        const reach = bound < 0 ? minOf(anomalyValues) : maxOf(anomalyValues);
        if (bound === 0 || !Number.isFinite(bound)) return `the data reaches ${statFmt(reach)}`;
        const ratio = reach / bound;
        // A negative ratio means the nearest value sits on the OTHER side of
        // zero from the bound, so "x% of the way to it" would be nonsense —
        // 975 is not ">99% of the way" to −77.8.
        if (ratio <= 0) return `the data reaches ${statFmt(reach)} and never moves toward it`;
        const pct = ratio * 100;
        // Rounded ONLY for the sentence; nothing forks on the rounded value.
        return `the data reaches ${statFmt(reach)}, ${pct >= 99.5 ? '>99' : Math.round(pct)}% of the way to it`;
      };
      warnings.push({
        code: 'anomaly-corridor-offscale',
        severity: 'info',
        message:
          `${
            offscale.length === 2
              ? `both corridor bounds (${statFmt(offscale[0]!)}, ${statFmt(offscale[1]!)}) lie`
              : `the corridor bound at ${statFmt(offscale[0]!)} lies`
          } outside the plotted value range, so ${offscale.length === 2 ? 'neither rule is' : 'that rule is not'} drawn — ` +
          offscale.map((bound) => approach(bound)).join('; ') +
          `. The bounds stay stated in the rule sentence ON the exhibit, which names the undrawn one, and in the anomaly-method receipt`,
      });
      corridorNote = stringFields(words.undrawnBounds, { bounds: missing.join(` ${words.and} `) });
    }
  }
  return { corridorShown, corridorNote };
}

/** The model without its lookup map: the record `derived.anomaly` carries. */
export function anomalyReceipt({ flagByCategory: _lookup, counts: _counts, ...receipt }: AnomalyModel): AnomalyDerived {
  return receipt;
}

/**
 * Paint for every piece of anomaly furniture — the corridor rules and the
 * outside flag marker.
 *
 * Under the standard palette the warn token is an olive that no column fill
 * comes near, because good/bad are green/red: the hue alone separates "this
 * period is bad" from "this is the rule". Under colorblindSafe the pair
 * becomes blue/olive, and `theme.color.colorblind.bad` (#A48228) sits at
 * 1.37:1 against warnColor (#8F6A00) — so in the ONE mode that exists for
 * colour-vision-deficient readers the two unrelated meanings collapsed into
 * the same colour. The furniture takes ink there instead, which the dash
 * pattern and the end labels already distinguish from the axis.
 */
export function columnCorridorPaint(colorblindSafe: boolean | undefined): Paint {
  return colorblindSafe ? { token: 'ink' } : { token: 'warn' };
}

/** One rule the anomaly furniture draws: a corridor bound or the median baseline, with the number it carries. */
interface AnomalyRuleLine {
  id: Id;
  value: number;
  dash: number[];
  lineCap?: 'round';
  width: number;
  paint: Paint;
  label: string;
}

/** The corridor bounds the value axis reaches and, under baseline 'median', the median. Column, line and combo. */
export function anomalyRuleLines(
  theme: Theme,
  anomaly: AnomalyModel,
  corridorShown: { low: boolean; high: boolean },
  statFmt: (v: number) => string,
  corridorPaint: Paint,
  strings?: StringsSpec,
): AnomalyRuleLine[] {
  const rules: AnomalyRuleLine[] = [];
  if (!anomaly.corridor) return rules;
  if (corridorShown.low && anomaly.corridor.low !== null) {
    rules.push({ id: 'anomaly:corridor:low', value: anomaly.corridor.low, dash: dashToken(theme, 'reference'), width: strokeToken(theme, 'rule'), paint: corridorPaint, label: statFmt(anomaly.corridor.low) });
  }
  if (corridorShown.high && anomaly.corridor.high !== null) {
    rules.push({ id: 'anomaly:corridor:high', value: anomaly.corridor.high, dash: dashToken(theme, 'reference'), width: strokeToken(theme, 'rule'), paint: corridorPaint, label: statFmt(anomaly.corridor.high) });
  }
  if (anomaly.baseline === 'median' && anomaly.centre !== null && anomaly.usable) {
    // NAMED, not just numbered: this rule sits parallel to the solid zero
    // baseline, often within ~25px of it, and two unlabelled dark rules
    // leave the reader guessing which is which.
    rules.push({ id: 'anomaly:baseline', value: anomaly.centre, dash: dashToken(theme, 'dotted'), lineCap: 'round' as const, width: strokeToken(theme, 'rule'), paint: { token: 'axis' }, label: stringFields(strings?.median ?? localeStrings().median, { value: statFmt(anomaly.centre) }) });
  }
  return rules;
}

/**
 * The legend keys for the flag marker, the corridor and the median rule,
 * drawn as the marks are: a marker and dashed lines in the furniture's own
 * paint. Column, line and combo.
 */
export function anomalyLegendItems(
  theme: Theme,
  anomaly: AnomalyModel | undefined,
  corridorShown: { low: boolean; high: boolean },
  statFmt: (v: number) => string,
  corridorPaint: Paint,
  strings?: StringsSpec,
  language?: string,
): LegendItemInput[] {
  if (!anomaly?.usable) return [];
  const words = { ...localeStrings(), ...strings };
  return [
    ...(anomaly.flags.length > 0
      ? [{ id: 'anomaly:flag', label: stringFields(words.flagged, { count: anomaly.flags.length, total: anomaly.n }, language), paint: corridorPaint, key: 'triangle' as const }]
      : []),
    ...(corridorShown.low || corridorShown.high
      ? [{
          id: 'anomaly:corridor',
          label: anomaly.method === 'mad' ? stringFields(words.corridor, { value: anomaly.k! }, language) : words.corridorBounds,
          paint: corridorPaint,
          key: 'line' as const,
          width: strokeToken(theme, 'rule'),
          dash: dashToken(theme, 'reference'),
        }]
      : []),
    ...(anomaly.baseline === 'median' && anomaly.centre !== null
      ? [{ id: 'anomaly:baseline', label: stringFields(words.median, { value: statFmt(anomaly.centre) }), paint: { token: 'axis' } as Paint, key: 'line' as const, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'dotted'), lineCap: 'round' as const }]
      : []),
  ];
}

/** Flag marker half-width, height and gap to its mark, in px. */
const ANOMALY_FLAG_HALF = 4;
export const ANOMALY_FLAG_H = 6;
export const ANOMALY_FLAG_GAP = 4;

/**
 * One flag marker: a triangle from `base` to `tip` at `cx`, claimed under a
 * FOREIGN owner so the flagged value's own label cannot place through it.
 * Column, line and combo.
 */
export function emitAnomalyFlag(
  nodes: SceneNode[],
  claims: OccupiedIndex,
  at: { cx: number; base: number; tip: number },
  paint: Paint,
  owner: { seriesId: Id; categoryId: Id },
  display: string,
): Id {
  const { cx, base, tip } = at;
  const half = ANOMALY_FLAG_HALF;
  const markerNodeId = `anomaly:flag:${owner.categoryId}`;
  nodes.push({
    t: 'path',
    id: markerNodeId,
    d: `M ${round2(cx - half)} ${round2(base)} L ${round2(cx + half)} ${round2(base)} L ${round2(cx)} ${round2(tip)} Z`,
    fill: paint,
    owner,
    part: 'anomalyFlag',
    display: { value: display, state: 'flagged' },
  });
  // Same escape as the range whiskers ('__range:…') and the stack connectors.
  claims.claim(
    { x: cx - half - 1, y: Math.min(base, tip) - 1, w: half * 2 + 2, h: Math.abs(tip - base) + 2 },
    'mark',
    { seriesId: '__anomalyFlag', categoryId: owner.categoryId },
    'anomalyFlag',
  );
  return markerNodeId;
}

/**
 * The anomaly rules across the plot, each with its number in the margin at
 * `labelX`, which the chart reserves for it (anomalyRuleReserve). A rule with
 * no number attached is an encoding the reader cannot decode, and the value
 * axis is often off. Column, line and combo.
 */
export function drawAnomalyRules(theme: Theme, input: {
  rules: AnomalyRuleLine[];
  statFmt: (v: number) => string;
  plot: Rect;
  y: (v: number) => number;
  labelX: number;
  font: FontSpec;
  measure: TextMeasurer;
  nodes: SceneNode[];
  claims: OccupiedIndex;
}): void {
  const { plot, y, labelX, font, measure, nodes, claims, statFmt } = input;
  const measured = input.rules.map(rule => measure(rule.label, font));
  const spread = spread1DResult(input.rules.map((rule, i) => ({ desired: y(rule.value), size: measured[i]!.height })), [plot.y, plot.y + plot.h], 4).positions;
  for (const [i, { id, value, dash, width, paint, label, lineCap }] of input.rules.entries()) {
    const ry = y(value);
    nodes.push({
      t: 'line', id, x1: plot.x, y1: ry, x2: plot.x + plot.w, y2: ry, stroke: paint, width, dash, lineCap,
      owner: {}, part: 'anomalyCorridor', display: { value: statFmt(value), state: 'corridor' },
    });
    claims.claim({ x: plot.x, y: ry - 1, w: plot.w, h: 2 }, 'annotation', { annotationId: id }, 'referenceLine');
    const labelTop = spread[i]! - measured[i]!.height / 2;
    if (Math.abs(spread[i]! - ry) > 1) {
      nodes.push({ t: 'path', id: `${id}:leader`, d: `M${plot.x + plot.w} ${ry}L${labelX - 1} ${spread[i]!}`,
        stroke: paint, width: strokeToken(theme, 'rule'), owner: { annotationId: id }, part: 'leader' });
    }
    nodes.push({
      t: 'text', id: `${id}:label`, x: labelX, y: labelTop,
      lines: [label], align: 'start', typeRole: 'label', font, ink: paint,
      owner: {}, part: 'anomalyCorridor', role: composedTextRole(label),
      display: { value: statFmt(value), state: 'corridor' },
    });
    claims.claim(
      { x: labelX, y: labelTop, w: measured[i]!.width, h: measured[i]!.height },
      'annotation',
      { annotationId: `${id}:label` },
    );
  }
}

/** The margin the rule numbers take right of the plot: the widest and 8 px of air. */
export function anomalyRuleReserve(rules: AnomalyRuleLine[], font: FontSpec, measure: TextMeasurer): number {
  return rules.length === 0 ? 0 : Math.max(...rules.map((rule) => measure(rule.label, font).width)) + 8;
}

/**
 * The anomaly furniture over a line (line and combo): column's rules with
 * their numbers in the margin, and a flag marker beyond each flagged point,
 * above a point over the corridor and below one under it.
 */
export function lineAnomalyFurniture(theme: Theme, input: {
  strings?: StringsSpec;
  anomaly: AnomalyModel;
  corridorShown: { low: boolean; high: boolean };
  statFmt: (v: number) => string;
  fmt: (v: number) => string;
  corridorPaint: Paint;
  plot: Rect;
  y: (v: number) => number;
  labelX: number;
  seriesId: Id;
  /** The drawn points of the flagged series, by category. */
  points: { categoryId: Id; x: number; y: number }[];
  font: FontSpec;
  measure: TextMeasurer;
  nodes: SceneNode[];
  claims: OccupiedIndex;
}): Map<Id, { cx: number; tip: number; up: boolean; py: number }> {
  const { anomaly, plot } = input;
  drawAnomalyRules(theme, { ...input, rules: anomalyRuleLines(theme, anomaly, input.corridorShown, input.statFmt, input.corridorPaint, input.strings) });
  const flags = new Map<Id, { cx: number; tip: number; up: boolean; py: number }>();
  const pointAt = new Map(input.points.map((point) => [point.categoryId, point] as const));
  // A point marker is about 3.5 px in radius; the flag keeps the column's gap beyond it.
  const clear = 3.5 + ANOMALY_FLAG_GAP;
  for (const flag of anomaly.flags) {
    const point = pointAt.get(flag.categoryId);
    if (!point) continue;
    const high = anomaly.corridor?.high;
    let up = flag.score !== null ? flag.score > 0 : high !== null && high !== undefined && flag.value > high;
    // Whatever the engine adds must fit: a flag that would leave the plot turns to the other side.
    if (up && point.y - clear - ANOMALY_FLAG_H < plot.y) up = false;
    else if (!up && point.y + clear + ANOMALY_FLAG_H > plot.y + plot.h) up = true;
    const base = up ? point.y - clear : point.y + clear;
    const tip = up ? base - ANOMALY_FLAG_H : base + ANOMALY_FLAG_H;
    emitAnomalyFlag(input.nodes, input.claims, { cx: point.x, base, tip },
      input.corridorPaint, { seriesId: input.seriesId, categoryId: flag.categoryId }, input.fmt(flag.value));
    flags.set(flag.categoryId, { cx: point.x, tip, up, py: point.y });
  }
  return flags;
}

/**
 * The value labels of the flagged series around its furniture: a value may
 * cross a corridor rule on a halo, as a column value crosses an average
 * marker, and a flagged point's value reads first beyond its flag marker.
 * Line and combo.
 */
export function seatFlaggedValues(
  requests: LabelRequest[],
  seriesId: Id,
  flags: ReadonlyMap<Id, { cx: number; tip: number; up: boolean; py: number }>,
  /** A combo's columns: where the flag seats lie on a column, the value may sit there on a backing. */
  columnFills: readonly Rect[] = [],
): void {
  for (const request of requests) {
    if (request.kind !== 'point' || request.owner.seriesId !== seriesId) continue;
    request.candidates = request.candidates.map((candidate) => ({ ...candidate, overRules: true }));
    const flag = flags.get(request.owner.categoryId!);
    const first = request.candidates[0];
    if (!flag || !first) continue;
    const { w, h } = first.rect;
    const seat = { slot: flag.up ? 'aboveFlag' : 'belowFlag', rect: { x: flag.cx - w / 2, y: flag.up ? flag.tip - h - 3 : flag.tip + 3, w, h }, penalty: -1, overRules: true };
    request.candidates.unshift(seat);
    // A flagged value is the one value the rule exists to show: where every
    // seat meets a column or a total, it takes the flag seat on the column,
    // on a backing and wholly inside one fill, as a combo line value does.
    const onColumn = (slot: string, rect: Rect, penalty: number) =>
      columnFills.some((fill) => rectContains(fill, rect, 1)) ? [{ slot, rect, penalty, overRules: true, needsBacking: true, overColumns: true }] : [];
    // The flag seat on a column, then the far side of the point on the
    // column there, beside the point and one row out, clear of the line.
    const x = flag.cx - w / 2;
    const side = flag.up ? 'belowPointOnColumn' : 'abovePointOnColumn';
    request.candidates.push(
      ...onColumn(`${seat.slot}OnColumn`, seat.rect, 20),
      ...onColumn(side, { x, y: flag.up ? flag.py + 5 : flag.py - h - 5, w, h }, 21),
      ...onColumn(`${side}Shifted`, { x, y: flag.up ? flag.py + h + 4 : flag.py - 2 * h - 4, w, h }, 22),
    );
  }
}

/** The anomaly rule and its flags, as column states them. Line and combo. */
export function anomalyA11y(domain: { options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>; anomaly?: { model: AnomalyModel; corridorNote: string }; fmt: (v: number) => string; cats: { id: Id; label?: string }[] }): string {
  const anomaly = domain.anomaly;
  if (!anomaly) return '';
  const { model } = anomaly;
  const name = (id: Id) => domain.cats.find((c) => c.id === id)?.label ?? id;
  return chartString(domain.options, 'anomalyRuleDesc', { v1: model.rule, v2: anomaly.corridorNote }) +
    (model.flags.length === 0 ? chartString(domain.options, 'noFlaggedPeriodClause') : chartString(domain.options, 'flaggedClause', { v1: model.flags.map((f) => `${name(f.categoryId)} ${domain.fmt(f.value)}`).join(', ') }));
}
