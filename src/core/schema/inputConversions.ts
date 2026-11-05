import type * as z from 'zod';
import { diagnosedSafeParse } from './shared';
import { readJsonPointer, toJsonPointer } from '../diagnostics/jsonPatch';
import { caseInsensitiveValue, inputConversion, replaceInputValue } from '../inputConversion';
import type { LintWarning } from '../types/scene';
import { schemaNodeAtPath } from './nodes';

/** Plain decimal literals only, with at most fifteen significant digits. */
function plainNumber(text: string): number | undefined {
  const literal = text.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(literal)) return undefined;
  // A three-digit group after a short integer can be a thousands separator.
  if (/^-?[1-9]\d{0,2}\.\d{3}$/.test(literal)) return undefined;
  const digits = literal.split(/[eE]/)[0]!.replace(/[-.]/g, '').replace(/^0+/, '');
  if (digits.length > 15) return undefined;
  const value = Number(literal);
  return Number.isFinite(value) && (value !== 0 || !/[1-9]/.test(digits)) ? value : undefined;
}

/** Union leaves retain every allowed scalar at a failed position. */
function leaves(issues: readonly z.core.$ZodIssue[], prefix: readonly PropertyKey[] = []): z.core.$ZodIssue[] {
  return issues.flatMap(issue => issue.code === 'invalid_union' && issue.errors.length
    ? issue.errors.flatMap(branch => leaves(branch, [...prefix, ...issue.path]))
    : [{ ...issue, path: [...prefix, ...issue.path] } as z.core.$ZodIssue]);
}

/** Successful input takes the original parse path; conversions retry refused fields only. */
export function parseWithInputConversions<T>(
  schema: z.ZodType<T>, input: unknown, base: readonly (string | number)[], enumsOnly = false,
) {
  const original = diagnosedSafeParse(schema, input);
  let result = original;
  const warnings: LintWarning[] = [];
  let converted = input;
  for (let pass = 0; !result.success && pass < 2; pass++) {
    let changed = false;
    const candidates = new Map<string, { path: (string | number)[]; from: unknown; values: unknown[] }>();
    for (const issue of leaves(result.error.issues)) {
      const path = issue.path.map(key => typeof key === 'number' ? key : String(key));
      const pointer = toJsonPointer(path);
      const found = readJsonPointer(converted, pointer);
      if (!found.found) continue;
      const from = found.value;
      let to: unknown;
      // Enum record keys are values of the key schema, not option names.
      if (issue.code === 'unrecognized_keys' && from !== null && typeof from === 'object' && !Array.isArray(from)) {
        const allowed = schemaNodeAtPath(schema, path).flatMap(node => node.propertyNames?.enum ?? []);
        const renames = issue.keys.flatMap(key => {
          const name = caseInsensitiveValue(key, allowed) ?? (path.at(-1) === 'scenarioStyle' && /^ly$/i.test(key) && allowed.includes('PY') ? 'PY' : undefined);
          return name === undefined ? [] : [{ key, name }];
        });
        for (const { key, name } of renames) {
          if (Object.hasOwn(from, name) || renames.filter(rename => rename.name === name).length !== 1) continue;
          const current = readJsonPointer(converted, pointer);
          const record = { ...((current.found ? current.value : from) as Record<string, unknown>) };
          const value = record[key];
          delete record[key];
          Object.defineProperty(record, name, { value, enumerable: true, writable: true, configurable: true });
          converted = replaceInputValue(converted, path, record);
          const warning = inputConversion([...base, ...path, key], key, name);
          warning.fix = [{ op: 'remove', path: toJsonPointer([...base, ...path, key]) }, { op: 'add', path: toJsonPointer([...base, ...path, name]), value }];
          warnings.push(warning);
          changed = true;
        }
      }
      if (!enumsOnly && issue.code === 'invalid_type') {
        if (typeof from === 'string' && issue.expected === 'number') to = plainNumber(from);
        if (typeof from === 'string' && issue.expected === 'boolean' && /^(true|false)$/i.test(from)) to = from.toLowerCase() === 'true';
        if (issue.expected === 'string' && typeof from === 'number' && Number.isFinite(from)
          && base[0] === 'data' && path.at(-1) === 'id') to = String(from);
      }
      if (issue.code === 'invalid_value') {
        to = caseInsensitiveValue(from, issue.values);
        if (!enumsOnly && typeof from === 'string' && /^(true|false)$/i.test(from) && issue.values.includes(from.toLowerCase() === 'true')) to = from.toLowerCase() === 'true';
        if (typeof from === 'string' && /^ly$/i.test(from) && path.at(-1) === 'scenario' && issue.values.includes('PY')) to = 'PY';
      }
      if (issue.code === 'invalid_union' && issue.errors.length === 0) to = caseInsensitiveValue(from, (issue as { options?: unknown[] }).options ?? []);
      if (issue.code === 'custom' && issue.params?.scenarioAlias === true && typeof from === 'string' && /^ly$/i.test(from)) to = 'PY';
      if (to === undefined) continue;
      const candidate = candidates.get(pointer) ?? { path, from, values: [] };
      if (!candidate.values.includes(to)) candidate.values.push(to);
      candidates.set(pointer, candidate);
    }
    for (const { path, from, values } of candidates.values()) {
      if (values.length !== 1) continue;
      converted = replaceInputValue(converted, path, values[0]);
      warnings.push(inputConversion([...base, ...path], from, values[0]));
      changed = true;
    }
    if (!changed) break;
    result = diagnosedSafeParse(schema, converted);
  }
  return result.success ? { result, input: converted, warnings } : { result: original, input, warnings: [] };
}
