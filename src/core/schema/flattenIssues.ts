/**
 * Error-REPORTING helper, deliberately in its own module: `schema/shared.ts` is
 * imported by every chart definition, so anything living there ships in every
 * react entry bundle — this function cost 96 gzip bytes in `react/line`, which
 * had 4 bytes of headroom. Only the CLI/MCP surfaces and their tests need it.
 */

import * as z from 'zod';

/**
 * Flatten a ZodError's issues so a union never swallows the actionable one.
 *
 * Zod reports a failed `z.union` as ONE `invalid_union` issue whose message is
 * the literal string "Invalid input", with the real per-branch issues nested in
 * `errors`. Every option typed `boolean | { … }` — connectors, netLine,
 * averageMarker, anomaly, and more — is such a union, so an agent that sends a
 * bad field inside the object branch got "Invalid input" at the option's root
 * and no way to self-correct. Silence is the worst failure mode.
 *
 * The rule: when a union's branches produced issues with a non-empty path, those
 * matched the shape and failed on a named field, so they are what the caller
 * needs; the wrapper is dropped. When no branch got that far, a strict object
 * branch that failed only on extra keys still matched the shape (a category
 * `{ id, lable }` against `string | { id, label }`), so its unknown-key issue
 * is what the caller needs. Otherwise the input was the wrong shape entirely
 * and the wrapper's own issues are kept. A branch whose only failure is an
 * extra key matched best of all and is reported first.
 */
export function flattenIssues(issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] {
  const out: z.core.$ZodIssue[] = [];
  for (const issue of issues) {
    // A branch that failed on extra keys alone matched the shape: the extra key is the finding,
    // not a field another branch misses (for example `{ acknowledge, typo }` against a two-branch union).
    const extrasOnly = issue.code === 'invalid_union'
      ? issue.errors.find((branch) => branch.length > 0 && branch.every((inner) => inner.code === 'unrecognized_keys'))
      : undefined;
    if (extrasOnly) {
      for (const inner of extrasOnly) out.push({ ...inner, path: [...issue.path, ...inner.path] } as z.core.$ZodIssue);
      continue;
    }
    const nested = flattenIssues(issue.code === 'invalid_union' ? issue.errors.flat() : []);
    const withPath = nested.filter((inner) => inner.path.length > 0);
    const specific = (withPath.length > 0 ? withPath : nested.filter((inner) => inner.code === 'unrecognized_keys'))
      .filter((inner) => !missingIssue(inner));
    // Missing fields from every branch do not identify a matching shape. Keep
    // the union so the diagnostic can describe the accepted shapes once.
    if (specific.length === 0) {
      out.push(discriminatorIssue(issue));
      continue;
    }
    for (const inner of specific) {
      out.push({ ...inner, path: [...issue.path, ...inner.path] } as z.core.$ZodIssue);
    }
  }
  return out;
}

function missingIssue(issue: z.core.$ZodIssue): boolean {
  return issue.code === 'invalid_type' ? issue.message.endsWith('received undefined')
    : issue.code === 'invalid_union' && issue.errors.length > 0 && issue.errors.every(branch => branch.length > 0 && branch.every(missingIssue));
}

/**
 * Zod words a discriminated union with no matching branch "Invalid
 * discriminator value. Expected 'a' | 'b'": the field is only in the path.
 * The message names the field and its allowed values, for every such union.
 */
function discriminatorIssue(issue: z.core.$ZodIssue): z.core.$ZodIssue {
  const { discriminator, options } = issue as { discriminator?: unknown; options?: unknown };
  if (issue.code !== 'invalid_union' || typeof discriminator !== 'string' || !Array.isArray(options) || options.length === 0) return issue;
  return { ...issue, message: `${discriminator} must be one of ${options.map((option) => `'${String(option)}'`).join(', ')}` };
}
