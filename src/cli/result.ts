/**
 * What every verb returns: one JSON body, an exit code and, for PNG renders,
 * the image bytes. The CLI prints the body; the MCP server returns the same
 * body as structured content and the images as image blocks.
 */
import { completeDiagnostic, type DocumentFinding } from '../core/doc/diagnostics';
import type { LintWarning } from '../core/types/scene';
import { ENGINE_REV } from '../core/engine';
import { InputError } from '../core/inputError';

export interface VerbResult {
  exit: 0 | 1 | 2;
  body: Record<string, unknown>;
  images?: Buffer[];
}

/** Errors per response; the rest are counted in one closing entry. */
const MAX_ERRORS = 10;

export { InputError };

/**
 * A tool Boardplot runs failed for a reason outside the input, such as the
 * browser that draws a PNG: exit 2 like an internal error, but with its own
 * code, the cause in the message and a way out.
 */
export class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: { path: string; suggest: string },
  ) {
    super(message);
    this.name = 'ToolFailure';
  }
}

/** Sort errors by path and keep the first MAX_ERRORS. */
function finalizeErrors(errors: readonly DocumentFinding[]): DocumentFinding[] {
  const sorted = errors
    .map((error, index) => ({ error, index }))
    .sort((left, right) => {
      const a = left.error.path ?? '';
      const b = right.error.path ?? '';
      return a < b ? -1 : a > b ? 1 : left.index - right.index;
    })
    .map(({ error }) => error);
  if (sorted.length <= MAX_ERRORS) return sorted;
  const rest = sorted.length - MAX_ERRORS;
  return [...sorted.slice(0, MAX_ERRORS), { code: 'more-errors', message: `${rest} more; fix the above first` }];
}

/** Every body names the engine revision that produced it. */
export function ok(body: Record<string, unknown>, images?: Buffer[]): VerbResult {
  return { exit: 0, body: { ok: true, ...body, engineRev: ENGINE_REV }, ...(images?.length ? { images } : {}) };
}

export function rejected(errors: readonly DocumentFinding[], warnings: readonly LintWarning[] = []): VerbResult {
  return { exit: 1, body: { ok: false, errors: finalizeErrors(errors), warnings: [...warnings], engineRev: ENGINE_REV } };
}

/** One rejected input as a complete finding. */
export function rejectedInput(error: InputError, input?: unknown): VerbResult {
  const suggest = error.details.suggest;
  return rejected([completeDiagnostic({
    code: error.code,
    message: error.message,
    ...error.details,
    ...(suggest ? { suggest } : {}),
  }, input, [], error.details.docs ?? 'docs/manual.md#the-spec')]);
}

/** An engine failure the caller cannot fix by changing the input. */
function internalError(error: unknown): VerbResult {
  const raw = error instanceof Error ? error.message : String(error);
  // A strict-assignment TypeError means a non-removable foreign
  // Object.prototype member broke an object assembly somewhere below;
  // diagnose the environment instead of echoing the mechanism.
  const message = error instanceof TypeError && /read only property/.test(raw)
    ? `the JavaScript environment defines a conflicting non-removable property on Object.prototype and processing cannot proceed (${raw}); run the CLI in a clean Node process`
    : raw;
  return {
    exit: 2,
    body: { ok: false, errors: [{ code: 'internal-error', message, path: '' }], warnings: [], engineRev: ENGINE_REV },
  };
}

/** Run a verb and turn its exceptions into the one JSON shape. */
export function runVerb(work: () => VerbResult): VerbResult {
  try {
    return work();
  } catch (error) {
    if (error instanceof InputError) return rejectedInput(error);
    if (error instanceof ToolFailure) {
      return {
        exit: 2,
        body: { ok: false, errors: [{ code: error.code, message: error.message, ...error.details }], warnings: [], engineRev: ENGINE_REV },
      };
    }
    return internalError(error);
  }
}
