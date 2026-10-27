/**
 * Retention derivation and shape validation. Pure: counts in, fractions out,
 * no geometry, no theme, no host engine.
 *
 * STATISTICAL CONTRACT (verbatim, because two different numbers are both
 * called "retention" and mixing them in one exhibit is a lie):
 *
 *  - basis 'cohort' (default) — BASE-RELATIVE:
 *      r(c,t) = active(c,t) / active(c,0)
 *    the classic retention curve; every cell is comparable down a column.
 *  - basis 'previous' — PERIOD-OVER-PERIOD SURVIVAL:
 *      r(c,t) = active(c,t) / active(c,t-1), with r(c,0) = 1
 *    it answers what fraction of last period's survivors stayed, which is a
 *    different question, and the two must never appear in one exhibit.
 *  - averages 'weighted' — the column average is
 *      sum_c active(c,t) / sum_c denominator(c,t)
 *    over the cohorts that HAVE an observation at t, with the denominator taken
 *    on the SAME basis as the cells (base for 'cohort', active(c,t-1) for
 *    'previous'). It is never the mean of the percentages — that is Simpson's
 *    trap — and never taken over cohorts that do not reach t.
 *  - Cells are carried as fractions at full precision. Displayed rounding is
 *    never the receipt: `derived` keeps the unrounded ratio and both counts.
 */

import { NormalizeError } from '../../normalize/shared';
import type { LintWarning } from '../../types/scene';
import type {
  CohortAverageDerived,
  CohortBasis,
  CohortData,
  CohortDerived,
  CohortRowDerived,
} from './types';

interface RetentionResult {
  derived: CohortDerived;
  warnings: LintWarning[];
  /** Cohorts whose tail is n.m., as "<cohort> from period k" phrases. */
  notMeaningful: string[];
  /** Period indices where the weighted average has no support set at all. */
  unsupportedAveragePeriods: number[];
}

interface RetentionInput {
  basis: CohortBasis;
  averages: false | 'weighted';
}

/** Synthetic row id for the weighted-average row; never a cohort id. */
export const AVERAGE_ROW_ID = 'weighted-average';

export function deriveRetention(data: CohortData, input: RetentionInput): RetentionResult {
  const warnings: LintWarning[] = [];
  const cohorts = data?.cohorts;
  if (Array.isArray(cohorts) && cohorts.length === 0) throw new NormalizeError('empty-data', 'cohorts', 'cohort requires at least one cohort');
  if (!Array.isArray(cohorts) || cohorts.length < 2) {
    throw new NormalizeError(
      'cohort-too-few',
      'cohorts',
      `a cohort triangle compares cohorts; ${Array.isArray(cohorts) ? cohorts.length : 0} supplied`,
      "supply at least two cohorts, or plot the single cohort with chart type 'line'",
    );
  }

  const labelOf = (index: number): string => {
    const cohort = cohorts[index]!;
    return cohort.label ?? cohort.id;
  };

  // Row identity has to survive into node ids, so a collision is structural,
  // not cosmetic: two cohorts sharing an id would emit one cell twice.
  const seen = new Set<string>();
  cohorts.forEach((cohort, index) => {
    if (cohort.id === AVERAGE_ROW_ID) {
      throw new NormalizeError(
        'cohort-duplicate-id',
        `cohorts[${index}].id`,
        `cohort id '${AVERAGE_ROW_ID}' is reserved for the computed average row`,
        'rename the cohort',
      );
    }
    if (seen.has(cohort.id)) {
      throw new NormalizeError(
        'cohort-duplicate-id',
        `cohorts[${index}].id`,
        `duplicate cohort id '${cohort.id}'`,
        'give every cohort a unique id',
      );
    }
    seen.add(cohort.id);
  });

  // ---- per-cohort shape ----
  const observed: number[] = [];
  cohorts.forEach((cohort, index) => {
    const path = `cohorts[${index}].active`;
    const active = cohort.active;
    // A number that IS there but is not a count is not refused as if it were
    // absent: a revenue triangle (12.5, 1_250_000.50) or a negative entry gets
    // a refusal that names the value and the reason, and says what to do.
    if (Array.isArray(active)) {
      active.forEach((value, t) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        if (value < 0) {
          throw new NormalizeError(
            'cohort-negative-count',
            `${path}[${t}]`,
            `cohort '${labelOf(index)}' has ${value} active at period ${t}; a cohort count cannot be negative`,
            'correct the count, or plot the net change with chart type \'bar\'',
          );
        }
        if (!Number.isInteger(value)) {
          throw new NormalizeError(
            'cohort-fractional-count',
            `${path}[${t}]`,
            `cohort '${labelOf(index)}' has ${value} active at period ${t}; this triangle plots COUNTS of members, and the base it prints in every row label ('n = ...') would have to round that`,
            'round to whole members, or scale revenue/FTE retention to whole units before plotting',
          );
        }
      });
    }
    if (!Array.isArray(active) || active.length === 0 || !isCount(active[0])) {
      throw new NormalizeError(
        'cohort-zero-base',
        `${path}[0]`,
        `cohort '${labelOf(index)}' has no observation at period 0, so its base is unknown and every retention rate is undefined`,
        'supply the cohort base as active[0], or drop the cohort',
      );
    }
    if (active[0] === 0) {
      throw new NormalizeError(
        'cohort-zero-base',
        `${path}[0]`,
        `cohort '${labelOf(index)}' has a base of 0 — retention is undefined (division by zero)`,
        'drop the cohort or merge it into the neighbouring one',
      );
    }
    if (cohort.size !== undefined && cohort.size !== active[0]) {
      throw new NormalizeError(
        'cohort-base-mismatch',
        `cohorts[${index}].size`,
        `cohort '${labelOf(index)}' declares size ${cohort.size} but active[0] is ${active[0]}; the engine cannot reconcile two bases`,
        'remove size, or correct it to match the period-0 count',
      );
    }
    // Keep the TypeScript path strict too; only explicit null means missing.
    for (let t = 1; t < active.length; t++) {
      if (active[t] !== null && !isCount(active[t])) {
        throw new NormalizeError(
          'cohort-gap',
          `${path}[${t}]`,
          `cohort '${labelOf(index)}' skips period ${t}; a cohort cannot miss a period it has lived through`,
          'supply the count for that period, or truncate the cohort before it',
        );
      }
    }
    observed.push(active.length);
  });

  // ---- staircase: an older cohort cannot have been observed for less time ----
  for (let i = 1; i < observed.length; i++) {
    if (observed[i]! > observed[i - 1]!) {
      throw new NormalizeError(
        'cohort-shape-invalid',
        `cohorts[${i}].active`,
        `cohort '${labelOf(i)}' has ${observed[i]} observations but the older cohort '${labelOf(i - 1)}' has only ${observed[i - 1]}; that is not a triangle`,
        'order cohorts chronologically, oldest first, and truncate each at the periods it has actually reached',
      );
    }
  }

  const periodCount = observed[0]!;
  const basis = input.basis;

  // ---- retention ----
  const notMeaningful: string[] = [];
  const aboveBase: string[] = [];
  const rows: CohortRowDerived[] = cohorts.map((cohort, index) => {
    const active = cohort.active.slice();
    const base = active[0]!;
    const retention: (number | null)[] = [];
    let nmFrom: number | null = null;
    for (let t = 0; t < active.length; t++) {
      if (t > 0 && active[t]! > base) {
        aboveBase.push(`'${labelOf(index)}' at period ${t} (${active[t]} of ${base})`);
      }
      if (basis === 'cohort') {
        retention.push(active[t] === null ? null : active[t]! / base);
        continue;
      }
      if (t === 0) {
        retention.push(1);
        continue;
      }
      const previous = active[t - 1];
      if (previous === 0 || nmFrom !== null) {
        // 0/0 is not 0%. Once a period has no survivors, nothing after it is
        // measurable either, so the whole tail is n.m.
        if (nmFrom === null) nmFrom = t;
        retention.push(null);
        continue;
      }
      retention.push(active[t] === null || previous === null ? null : active[t]! / previous!);
    }
    if (nmFrom !== null) notMeaningful.push(`'${labelOf(index)}' from period ${nmFrom}`);
    return { id: cohort.id, base, active, retention, observedPeriods: active.length };
  });

  for (const phrase of aboveBase) {
    warnings.push({
      code: 'cohort-above-base',
      severity: 'warn',
      message: `cohort ${phrase} is above its own base — expansion or resurrection is real, but the colour ramp is pinned at 100%, so that cell reads at full ink and its excess is only in the number`,
      suggest: 'say so in the title, or split re-activations into their own exhibit',
    });
  }
  if (notMeaningful.length > 0) {
    warnings.push({
      code: 'cohort-nm-cells',
      severity: 'warn',
      message: `period-over-period survival is not meaningful once a period has no survivors: ${notMeaningful.join(', ')} — those cells are blank, never 0%`,
      suggest: "use basis 'cohort' to keep those cohorts measurable against their base",
    });
  }

  // ---- weighted averages ----
  let averages: CohortAverageDerived[] | undefined;
  const unsupportedAveragePeriods: number[] = [];
  if (input.averages === 'weighted') {
    averages = [];
    for (let t = 0; t < periodCount; t++) {
      let numerator = 0;
      let denominator = 0;
      const contributors: string[] = [];
      for (const row of rows) {
        if (t >= row.observedPeriods) continue;
        // THE SUPPORT SET IS EXACTLY THE SET OF DRAWN CELLS. A cell that is
        // blank on the exhibit — n.m. under basis 'previous', where the
        // previous period had no survivors and every later cell of that cohort
        // is unmeasurable — must not vote in the average printed beneath it.
        // Counting it publishes a percentage for a period whose only evidence
        // the reader was told not to read. (Simpson's trap one level down: the
        // mean of percentages is gone, but the denominator still held cells
        // that are not on the page.)
        if (row.retention[t] === null) continue;
        const den = basis === 'cohort' ? row.base : t === 0 ? row.base : row.active[t - 1]!;
        if (den === 0) continue;
        const num = basis === 'cohort' ? row.active[t]! : t === 0 ? row.base : row.active[t]!;
        numerator += num;
        denominator += den;
        contributors.push(row.id);
      }
      const support = contributors.length;
      const missing = rows.some(row => missingCohortRate(row, t, basis));
      // No support set, no average. 0 would be a number; this is the absence of
      // one, and it renders blank exactly like the cells it has none of.
      if (support === 0) unsupportedAveragePeriods.push(t);
      averages.push({
        value: missing || support === 0 || denominator === 0 ? null : numerator / denominator,
        support,
        contributors,
      });
    }
    if (unsupportedAveragePeriods.length > 0) {
      warnings.push({
        code: 'cohort-average-unsupported',
        severity: 'warn',
        message: `no cohort has a readable cell at period ${unsupportedAveragePeriods.join(', ')}, so the weighted average there is blank, not 0% — an empty support set has no average`,
        suggest: 'trim the exhibit to the periods a cohort actually reports, or use basis \'cohort\' so those cohorts stay measurable against their base',
      });
    }
    // A period whose average is withheld for a missing count rests on no cohorts.
    const drawn = averages.filter((_, t) => !rows.some(row => missingCohortRate(row, t, basis)));
    if (new Set(drawn.map((a) => a.support)).size > 1) {
      warnings.push({
        code: 'cohort-average-unequal-support',
        severity: 'warn',
        message: `the weighted average rests on ${averages[0]!.support} cohorts at period 0 and ${averages[periodCount - 1]!.support} at period ${periodCount - 1} — the support set shrinks to the right, as it always does in a triangle`,
        suggest: 'read the averages against the per-column cohort count, or trim the exhibit to the periods every cohort has reached',
      });
    }
  }

  let maxRetention = 0;
  for (const row of rows) {
    for (const r of row.retention) if (r !== null && r > maxRetention) maxRetention = r;
  }

  return {
    // `averages` is absent, not undefined, when off: a dangling key in the
    // derived output reads as "there is an average and it is unknown".
    derived: { basis, periodCount, cohorts: rows, ...(averages ? { averages } : {}), maxRetention },
    warnings,
    notMeaningful,
    unsupportedAveragePeriods,
  };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * A rate with no value because its own count, or (basis 'previous') the count
 * before it, is null. A zero-denominator tail keeps its not-meaningful state.
 */
export function missingCohortRate(row: CohortRowDerived, period: number, basis: CohortBasis): boolean {
  return row.retention[period] === null
    && (basis !== 'previous' || !row.active.slice(0, period).includes(0))
    && (row.active[period] === null || (basis === 'previous' && period > 0 && row.active[period - 1] === null));
}
