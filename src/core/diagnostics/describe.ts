import { toJsonPointer, type JsonPatchOperation } from './jsonPatch.js';

/** Where a finding points, as a reader writes it: its display path, else its JSON Pointer in dots. */
function findingWhere(finding: { path?: string; displayPath?: string }): string {
  if (finding.displayPath) return finding.displayPath;
  const path = finding.path ?? '';
  return path.startsWith('/') ? path.slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~')).join('.') : path;
}

/**
 * A schema message that names the field it is about, so a reader who sees only
 * the message ("Invalid input: expected string, received object") still knows
 * which field to change. The root has no path to name.
 */
export function atPath(finding: { path?: string; displayPath?: string }, message: string): string {
  const where = findingWhere(finding);
  return where === '' || message.startsWith(`${where}: `) ? message : `${where}: ${message}`;
}

/** The message without the path `atPath` put in front, for a view that prints the path beside it. */
export function messageText(finding: { path?: string; displayPath?: string; message: string }): string {
  const where = findingWhere(finding);
  return where !== '' && finding.message.startsWith(`${where}: `) ? finding.message.slice(where.length + 2) : finding.message;
}

export function expectedTypes(issue: unknown): string[] {
  if (!issue || typeof issue !== 'object') return [];
  const value = issue as { expected?: unknown; errors?: unknown };
  const expected = typeof value.expected === 'string' ? [value.expected] : [];
  if (Array.isArray(value.errors)) {
    for (const branch of value.errors) {
      for (const nested of Array.isArray(branch) ? branch : [branch]) {
        expected.push(...expectedTypes(nested));
      }
    }
  }
  return [...new Set(expected)];
}

export function receivedDescription(value: unknown, found = true) {
  if (!found) return { type: 'missing' };
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (value !== null && typeof value === 'object') return { type: 'object', keys: Object.keys(value) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { type: 'number', value: String(value), nonFinite: true };
  return { type: value === null ? 'null' : typeof value, value };
}

function readValue(input: unknown, segments: readonly PropertyKey[]) {
  let value = input;
  for (const key of segments) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) {
      return { found: false, value: undefined };
    }
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return { found: true, value };
}

export interface DiagnosticExpected {
  types?: string[];
  values?: unknown[];
  minimum?: unknown;
  maximum?: unknown;
  inclusive?: boolean;
  exact?: boolean;
  format?: string;
  pattern?: string;
  divisor?: number;
  alternatives?: DiagnosticExpected[][];
  condition?: string;
}

export interface DiagnosticMetadata {
  path: string;
  displayPath?: string;
  expected: DiagnosticExpected;
  received: ReturnType<typeof receivedDescription>;
  fix?: JsonPatchOperation[];
  docs: string;
}

type Issue = {
  code?: string; message?: string; path?: PropertyKey[]; expected?: unknown;
  /**
   * A schema's own refusal of the key at `path` sets `refused: true` and gets the remove patch a `never` key gets;
   * `renameTo` names the key the value belongs under, and the patch renames it in its object.
   */
  params?: { refused?: boolean; renameTo?: string; code?: string; replaceWith?: string };
  errors?: unknown; values?: unknown[]; origin?: string; minimum?: unknown;
  maximum?: unknown; inclusive?: boolean; exact?: boolean; format?: string;
  pattern?: string; divisor?: number;
};

function describeExpected(issue: Issue): DiagnosticExpected {
  const expected: DiagnosticExpected = {};
  const types = expectedTypes(issue);
  if (types.length) expected.types = types;
  if (Array.isArray(issue.values)) expected.values = issue.values;
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    if (issue.origin) expected.types = [issue.origin];
    if (issue.minimum !== undefined) expected.minimum = issue.minimum;
    if (issue.maximum !== undefined) expected.maximum = issue.maximum;
    if (issue.inclusive !== undefined) expected.inclusive = issue.inclusive;
    if (issue.exact !== undefined) expected.exact = issue.exact;
  }
  if (issue.code === 'invalid_format') {
    expected.types = ['string'];
    if (issue.format) expected.format = issue.format;
    if (issue.pattern) expected.pattern = issue.pattern;
  }
  if (issue.code === 'not_multiple_of' && issue.divisor !== undefined) expected.divisor = issue.divisor;
  if (Array.isArray(issue.errors)) {
    expected.alternatives = issue.errors.map(branch => (Array.isArray(branch) ? branch : [branch])
      .map(nested => describeExpected(nested as Issue)));
  }
  if (!Object.keys(expected).length) expected.condition = issue.message ?? 'Schema constraint failed';
  return expected;
}

interface DiagnosticContext {
  code: string;
  message: string;
  path: string;
  docs: string;
  displayPath?: string;
  suggest?: string;
  allowFix?: boolean;
}

function diagnosticFields(
  input: unknown, segments: readonly PropertyKey[],
  context: { expected: DiagnosticExpected; docs: string; displayPath?: string },
) {
  const actual = readValue(input, segments);
  return {
    expected: context.expected,
    received: receivedDescription(actual.value, actual.found),
    docs: context.docs,
    ...(context.displayPath !== undefined ? { displayPath: context.displayPath } : {}),
  };
}

/** Every enumerated value an issue allows, its union branches included. */
export function allowedValues(issue: Issue): unknown[] {
  const values = Array.isArray(issue.values) ? [...issue.values] : [];
  if (Array.isArray(issue.errors)) {
    for (const branch of issue.errors) {
      for (const nested of Array.isArray(branch) ? branch : [branch]) values.push(...allowedValues(nested as Issue));
    }
  }
  return [...new Set(values)];
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length]!;
}

/** The allowed value closest to what was sent; the first one on a tie. */
function closestValue(received: string, values: readonly unknown[]): unknown {
  const target = received.toLowerCase();
  let best = values[0];
  let bestDistance = Infinity;
  for (const value of values) {
    const distance = editDistance(target, String(value).toLowerCase());
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

/** A candidate edit must still pass validation of the complete original document. */
export function schemaDiagnostic(issue: Issue, input: unknown, context: DiagnosticContext) {
  const actual = readValue(input, issue.path ?? []);
  const fix: JsonPatchOperation[] = [];
  const safeFixPath = (context.path === '' || context.path.startsWith('/'))
    && !/~(?:[^01]|$)/.test(context.path)
    && !context.path.split('/').slice(1).some(segment =>
      ['__proto__', 'prototype', 'constructor'].includes(segment.replace(/~1/g, '/').replace(/~0/g, '~')));
  if (context.allowFix && safeFixPath && expectedTypes(issue).includes('number') && actual.found && typeof actual.value === 'string'
    && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(actual.value)) {
    const number = Number(actual.value);
    if (Number.isFinite(number) && String(number) === actual.value && Math.abs(number) <= 1e15
      && (!Number.isInteger(number) || Number.isSafeInteger(number))) {
      fix.push({ op: 'test', path: context.path, value: actual.value },
        { op: 'replace', path: context.path, value: number });
    }
  }
  // A key refused at this position (published as `never`, refused by a
  // schema's own rule, or a retired key, both marking the issue `refused`) is fixed by removing it.
  const refusedKey = (issue.code === 'invalid_type' && issue.expected === 'never') || issue.params?.refused === true;
  if (!fix.length && context.allowFix && safeFixPath && context.path !== '' && actual.found && refusedKey) {
    fix.push({ op: 'remove', path: context.path });
  }
  // A key the schema renames moves its value under the new name: the patch replaces the owning object.
  const renameTo = issue.code === 'custom' ? issue.params?.renameTo : undefined;
  const key = issue.path?.at(-1);
  const owner = readValue(input, (issue.path ?? []).slice(0, -1)).value;
  if (!fix.length && context.allowFix && safeFixPath && context.path !== '' && actual.found && renameTo !== undefined
    && owner !== null && typeof owner === 'object' && !Array.isArray(owner) && !Object.hasOwn(owner, renameTo)) {
    const ownerPath = context.path.slice(0, context.path.lastIndexOf('/'));
    const renamed = Object.fromEntries(Object.entries(owner).map(([name, value]) => [name === key ? renameTo : name, value]));
    fix.push({ op: 'test', path: ownerPath, value: owner }, { op: 'replace', path: ownerPath, value: renamed });
  }
  // A schema rule that knows the value to write instead (a format example) names it.
  const replaceWith = issue.code === 'custom' ? issue.params?.replaceWith : undefined;
  if (!fix.length && context.allowFix && safeFixPath && actual.found && typeof actual.value === 'string' && replaceWith !== undefined) {
    fix.push({ op: 'test', path: context.path, value: actual.value }, { op: 'replace', path: context.path, value: replaceWith });
  }
  const values = allowedValues(issue);
  if (!fix.length && context.allowFix && safeFixPath && actual.found && typeof actual.value === 'string' && values.length) {
    // An enumerated field gets the nearest allowed value as its patch.
    fix.push({ op: 'test', path: context.path, value: actual.value },
      { op: 'replace', path: context.path, value: closestValue(actual.value, values) });
  }
  // A union of a value list and an object refuses an object whose one field
  // left its list, such as a key at { position: 'right' }: the patch
  // replaces that field with its nearest allowed value.
  if (!fix.length && context.allowFix && safeFixPath && actual.found && issue.code === 'invalid_union'
    && typeof actual.value === 'object' && actual.value !== null && Array.isArray(issue.errors)) {
    for (const branch of issue.errors) {
      const nested = Array.isArray(branch) && branch.length === 1 ? branch[0] as Issue : undefined;
      if (nested?.code !== 'invalid_value' || !nested.path?.length || !Array.isArray(nested.values)) continue;
      const field = readValue(actual.value, nested.path);
      if (!field.found || typeof field.value !== 'string') continue;
      const path = `${context.path}${toJsonPointer(nested.path.map(String))}`;
      fix.push({ op: 'test', path, value: field.value }, { op: 'replace', path, value: closestValue(field.value, nested.values) });
      break;
    }
  }
  return {
    code: (issue.code === 'custom' ? issue.params?.code : undefined) ?? context.code, message: atPath(context, context.message), path: context.path,
    ...diagnosticFields(input, issue.path ?? [], { expected: describeExpected(issue), docs: context.docs,
      ...(context.displayPath !== undefined ? { displayPath: context.displayPath } : {}) }),
    ...(fix.length ? { fix } : {}),
    ...(context.suggest !== undefined ? { suggest: context.suggest } : {}),
  };
}
