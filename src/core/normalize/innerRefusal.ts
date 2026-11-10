/**
 * A chart another chart draws for it (a grid panel, the column chart of a
 * histogram) refuses with pointer segments relative to its own input. These
 * helpers move them into the spec the author wrote, or drop them: a pointer is
 * right or absent. They run only when a refusal is thrown.
 */
import { parseJsonPointer, toJsonPointer } from '../diagnostics/jsonPatch';
import { annotationRef } from '../types/annotations';
import { NormalizeError } from './shared';
import type { LintWarning } from '../types/scene';

type Segments = readonly (string | number)[];
export type Rebase = (segments: Segments) => Segments | undefined;

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
export function rebaseRefusal(error: NormalizeError, rebase: Rebase): void {
  error.segments = (error.segments?.length ? rebase(error.segments) : undefined) ?? [];
  if (error.fix) error.fix = rebaseFix(error.fix, rebase);
}

type Fix = NonNullable<NormalizeError['fix']>;

/** Every operation of the fix moved, or no fix. */
function rebaseFix(fix: Fix, rebase: Rebase): Fix | undefined {
  const moved = fix.map(operation => {
    const segments = rebase(parseJsonPointer(operation.path));
    return segments && segments.length > 0 ? { ...operation, path: toJsonPointer(segments) } : undefined;
  });
  return moved.every(operation => operation !== undefined) ? moved : undefined;
}

/** The same move for a warning a host or a grid passes on: a field or a fix that does not move is dropped. */
export function rebaseWarning(warning: LintWarning, rebase: Rebase): LintWarning {
  if (!warning.field && !warning.fix) return warning;
  const { field, fix, ...rest } = warning;
  const movedField = field?.length ? rebase(field) : undefined;
  const movedFix = fix && rebaseFix(fix, rebase);
  return { ...rest, ...(movedField?.length ? { field: movedField } : {}), ...(movedFix ? { fix: movedFix } : {}) };
}

/**
 * The layout a host draws through another chart type with data it derives
 * (pareto through combo, histogram through column). A refusal there names an
 * option of the host only where the host passed that option on unchanged.
 * A field of the derived data has no place in the host's spec: no pointer.
 */
export function hostedLayout<T>(hostOptions: object, innerOptions: object, run: () => T): T {
  const rebase: Rebase = segments => {
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
  };
  let result: T;
  try {
    result = run();
  } catch (error) {
    if (error instanceof NormalizeError) rebaseRefusal(error, rebase);
    throw error;
  }
  // The inner chart's warnings follow the same rule. The host draws the inner chart at its own size.
  const geometry = result as { scene?: unknown; warnings?: LintWarning[] } | null;
  const warnings = geometry?.scene ? geometry.warnings : undefined;
  if (!Array.isArray(warnings) || !warnings.some(warning => warning.field || warning.fix)) return result;
  const hosted: Rebase = segments => segments[0] === 'options' && segments[1] === 'size' ? segments : rebase(segments);
  return { ...result, warnings: warnings.map(warning => rebaseWarning(warning, hosted)) };
}
