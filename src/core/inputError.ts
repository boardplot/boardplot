/**
 * An input refused before any layout runs: a spec that is not an object, or
 * rows that do not map. The CLI and MCP report it as a finding; the browser
 * rows helper throws it to the caller.
 */
import type { DocumentFinding } from './doc/diagnostics';

/** An input the verb rejects before or instead of doing its work. */
export class InputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Partial<DocumentFinding> = {},
  ) {
    super(message);
    this.name = 'InputError';
  }
}

/** A spec arrives as an object. A string is the most common agent mistake, so it gets its own code. */
export function assertSpecObject(spec: unknown): void {
  if (typeof spec === 'string') {
    throw new InputError('spec-must-be-object', 'pass the spec as a JSON object, not a string', {
      path: '/spec',
      expected: { types: ['object'] },
      suggest: 'Send the parsed spec object in spec, without JSON.stringify.',
    });
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new InputError('spec-must-be-object', 'pass the spec as a JSON object', {
      path: '/spec',
      expected: { types: ['object'] },
      suggest: 'Send an object with type and data, or an envelope with version and charts.',
    });
  }
}
