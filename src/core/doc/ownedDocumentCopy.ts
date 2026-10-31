import { NormalizeError } from '../normalize/shared';

function owned(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) {
    throw new NormalizeError('circular-reference', 'chart', 'an object in the chart holds a reference to itself; a chart takes plain JSON',
      'Remove the reference, for example by building the options as a new object.');
  }
  ancestors.add(value);
  let copy: unknown;
  if (Array.isArray(value)) copy = value.map((entry) => owned(entry, ancestors));
  else {
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) record[key] = owned((value as Record<string, unknown>)[key], ancestors);
    copy = record;
  }
  ancestors.delete(value);
  return copy;
}

/**
 * Deep-copy a JSON document onto null-prototype objects so inherited keys
 * cannot cross into layout or validation code. An object may appear twice, but
 * one that holds itself is refused: copying it would overflow the stack.
 */
export function ownedDocumentCopy<T>(value: T): T {
  return owned(value, new Set()) as T;
}
