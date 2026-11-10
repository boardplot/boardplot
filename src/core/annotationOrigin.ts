/**
 * Where the author wrote an annotation: `['annotations', i]` or `['options', 'annotations', i]`. Each authored entry
 * carries it under this symbol, so a refusal points at the authored entry after the registry drops kinds a chart does
 * not draw. A symbol key never reaches JSON output. It is a registered symbol, so the React layer compares it without
 * loading the annotation types.
 */
export const ANNOTATION_ORIGIN: unique symbol = Symbol.for('boardplot.annotationOrigin') as never;

export const annotationOriginOf = (entry: unknown): (string | number)[] | undefined => entry !== null && typeof entry === 'object'
  ? (entry as { [ANNOTATION_ORIGIN]?: (string | number)[] })[ANNOTATION_ORIGIN] : undefined;

/**
 * Each entry of an authored annotation list, copied with its origin. An entry that already carries one keeps it:
 * the reader that saw the authored spec (the React spec path) recorded where the author wrote it.
 */
export function withAnnotationOrigins<T>(list: readonly T[], at: readonly ('annotations' | 'options')[]): T[] {
  return list.map((entry, index) => entry !== null && typeof entry === 'object' && !annotationOriginOf(entry) ? { ...entry, [ANNOTATION_ORIGIN]: [...at, index] } : entry);
}
