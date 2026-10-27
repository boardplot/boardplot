/**
 * Edits address the original JSON document, before schema defaults. A finding
 * proposes test and replace for a value, add for a value the spec does not
 * set yet, or remove for a field the spec does not take (RFC 6902).
 */
export type JsonPatchOperation =
  | { op: 'test' | 'replace' | 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string };
type JsonPointerResult = { found: true; value: unknown } | { found: false };

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function toJsonPointer(segments: readonly (string | number)[]): string {
  return segments.map(segment => '/' + String(segment).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

export function parseJsonPointer(pointer: string): string[] {
  if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) {
    throw new Error('Invalid JSON pointer');
  }
  if (pointer === '') return [];
  return pointer.slice(1).split('/').map(segment => {
    if (/~(?:[^01]|$)/.test(segment)) throw new Error('Invalid JSON pointer escape');
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

function readSegments(root: unknown, segments: readonly string[]): JsonPointerResult {
  let value = root;
  for (const segment of segments) {
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(segment)) {
      throw new Error(`Invalid JSON array index: ${segment}`);
    }
    if (value === null || typeof value !== 'object' || !own(value, segment)) return { found: false };
    value = (value as Record<string, unknown>)[segment];
  }
  return { found: true, value };
}

export function readJsonPointer(root: unknown, pointer: string): JsonPointerResult {
  return readSegments(root, parseJsonPointer(pointer));
}

/**
 * RFC 6902 replace needs its target to exist. A replace aimed at a default the
 * spec never wrote becomes an add at the deepest member the spec does have,
 * carrying the missing parents: replace /options/bump/focus on a spec without
 * options.bump becomes add /options/bump with { focus }.
 */
export function addWhereAbsent(document: unknown, patch: readonly JsonPatchOperation[]): JsonPatchOperation[] {
  return patch.map(operation => {
    if (operation.op !== 'replace' || readJsonPointer(document, operation.path).found) return operation;
    const segments = parseJsonPointer(operation.path);
    let depth = segments.length - 1;
    while (depth > 0 && !readSegments(document, segments.slice(0, depth)).found) depth -= 1;
    const value = segments.slice(depth + 1).reduceRight<unknown>((child, key) => ({ [key]: child }), operation.value);
    return { op: 'add', path: toJsonPointer(segments.slice(0, depth + 1)), value };
  });
}

/**
 * Whether RFC 6902 can apply the patch to the document, in order: each
 * target's parent exists, an array takes `-` or an index in range, and
 * replace, remove and test find their member.
 */
export function patchApplies(document: unknown, patch: readonly JsonPatchOperation[]): boolean {
  const copy = structuredClone(document);
  for (const operation of patch) {
    let parent: unknown;
    let last: string;
    try {
      const segments = parseJsonPointer(operation.path);
      if (!segments.length) return false;
      last = segments.at(-1)!;
      const found = readSegments(copy, segments.slice(0, -1));
      if (!found.found) return false;
      parent = found.value;
    } catch {
      return false;
    }
    if (parent === null || typeof parent !== 'object') return false;
    const value = 'value' in operation ? structuredClone(operation.value) : undefined;
    if (Array.isArray(parent)) {
      if (operation.op === 'add' && last === '-') {
        parent.push(value);
        continue;
      }
      if (!/^(0|[1-9][0-9]*)$/.test(last)) return false;
      const index = Number(last);
      if (index > parent.length || (operation.op !== 'add' && index === parent.length)) return false;
      if (operation.op === 'add') parent.splice(index, 0, value);
      else if (operation.op === 'remove') parent.splice(index, 1);
      else if (operation.op === 'replace') parent[index] = value;
      continue;
    }
    const record = parent as Record<string, unknown>;
    if (operation.op !== 'add' && !own(record, last)) return false;
    if (operation.op === 'remove') delete record[last];
    else if (operation.op !== 'test') record[last] = value;
  }
  return true;
}
