/**
 * A chart another chart draws for it (a grid panel, the column chart of a
 * histogram) refuses with pointer segments relative to its own input. These
 * helpers move them into the spec the author wrote, or drop them: a pointer is
 * right or absent. They run only when a refusal is thrown.
 */
import { parseJsonPointer, toJsonPointer } from '../diagnostics/jsonPatch';
import { annotationRef } from '../types/annotations';
import { NormalizeError } from './shared';

type Segments = readonly (string | number)[];

const container = (value: unknown): 'array' | 'record' | undefined =>
  Array.isArray(value) ? 'array' : value !== null && typeof value === 'object' ? 'record' : undefined;
const own = (value: unknown, key: string | number) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * Whether `inner` and `outer` hold the same field at `path`: the same kind of
 * container at every step, and at the end the same JSON value, or no value in
 * either. An index into a list that the inner chart got as a keyed record, or a
 * value the outer chart changed on the way, is not the same field.
 */
export function sameField(inner: unknown, outer: unknown, path: Segments): boolean {
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    const kind = container(inner);
    if (kind === undefined || kind !== container(outer)) return false;
    const inInner = own(inner, key);
    if (inInner !== own(outer, key)) return false;
    if (!inInner) return index === path.length - 1;
    inner = (inner as Record<string, unknown>)[key];
    outer = (outer as Record<string, unknown>)[key];
  }
  return JSON.stringify(inner) === JSON.stringify(outer);
}

/**
 * Moves a refusal's pointer, and the paths of its fix, with `rebase`. Where
 * `rebase` gives no field the refusal carries none (`[]`, so no reader falls
 * back to the display path), and a fix with a path that does not move is dropped.
 */
export function rebaseRefusal(error: NormalizeError, rebase: (segments: Segments) => Segments | undefined): void {
  error.segments = (error.segments?.length ? rebase(error.segments) : undefined) ?? [];
  if (!error.fix) return;
  const moved = error.fix.map(operation => {
    const segments = rebase(parseJsonPointer(operation.path));
    return segments && segments.length > 0 ? { ...operation, path: toJsonPointer(segments) } : undefined;
  });
  error.fix = moved.every(operation => operation !== undefined) ? moved : undefined;
}

/**
 * The layout a host draws through another chart type with data it derives
 * (pareto through combo, histogram through column). A refusal there names an
 * option of the host only where the host passed that option on unchanged.
 * A field of the derived data has no place in the host's spec: no pointer.
 */
export function hostedLayout<T>(hostOptions: object, innerOptions: object, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof NormalizeError) {
      rebaseRefusal(error, segments => {
        const [head, ...rest] = segments;
        // An annotation pointer starts with the origin the request gave the authored entry. It holds where the host
        // passed that entry on unchanged; the inner chart's list can be shorter or hold entries the host added.
        const origin = head === 'annotations' ? 2 : head === 'options' && rest[0] === 'annotations' ? 3 : 0;
        if (origin) {
          const key = JSON.stringify(segments.slice(0, origin));
          const entry = (from: object) => ((from as { annotations?: unknown[] }).annotations ?? [])
            .find((annotation, index) => JSON.stringify(annotationRef(annotation, index).segments) === key);
          const inner = entry(innerOptions), host = entry(hostOptions);
          return inner !== undefined && host !== undefined && sameField(inner, host, segments.slice(origin)) ? segments : undefined;
        }
        if (head === 'options') return sameField(innerOptions, hostOptions, rest) ? segments : undefined;
        return undefined;
      });
    }
    throw error;
  }
}
