/**
 * A spark names its ends with `labels`, one per value: three values under
 * ['Jan', 'Feb'] would print "Feb" under the third point.
 * The schema refuses such labels for the CLI and BoardplotChart; the layout
 * raises the same code, path and remove patch as an error lint, so the
 * per-type React entry, which does not link the schema, refuses them too.
 * Without zod, so only the kpi entry carries it.
 */
import type { LintWarning } from '../../types/scene';

/** What is wrong with a spark's labels, or undefined when each value has one. */
export function sparkLabelsProblem(spark: { values: readonly unknown[]; labels?: readonly unknown[] } | undefined): string | undefined {
  const labels = spark?.labels;
  if (!spark || labels === undefined) return undefined;
  if (labels.length !== spark.values.length) {
    return `spark.labels has ${labels.length} label${labels.length === 1 ? '' : 's'} for ${spark.values.length} value${spark.values.length === 1 ? '' : 's'}; the card prints the last label under the last value, so give one label per value, or drop labels`;
  }
  const empty = labels.findIndex((label) => typeof label !== 'string' || label.trim() === '');
  return empty < 0 ? undefined : `spark.labels[${empty}] is empty; give every value its period name, or drop labels`;
}

/** The refusal the kpi layout raises, in the CLI's code, path and patch. */
export function sparkLabelsRefusal(spark: Parameters<typeof sparkLabelsProblem>[0]): LintWarning[] {
  const message = sparkLabelsProblem(spark);
  return message === undefined ? [] : [{
    code: 'invalid-data', severity: 'error', message,
    field: ['data', 'spark', 'labels'], fix: [{ op: 'remove', path: '/data/spark/labels' }],
  }];
}
