import { DocumentSchemaError, type DocumentEnvelope } from './document';
import { atPath } from '../diagnostics/describe';

/** Public error returned when a React spec or its host settings fail validation. */
export class BoardplotSpecError extends DocumentSchemaError {
  constructor(public readonly errors: DocumentEnvelope['errors']) {
    super(errors);
    this.name = 'BoardplotSpecError';
    this.message = errors.map(issue => {
      // The public diagnostic retains all union branches. The display lists their collected types.
      const expected = issue.expected?.types ? { ...issue.expected, alternatives: undefined }
        : issue.expected ?? { condition: issue.message };
      const replacement = issue.fix?.find((operation): operation is Extract<typeof operation, { value: unknown }> =>
        operation.op === 'replace');
      const fix = replacement ? `Replace ${replacement.path || '(root)'} with ${JSON.stringify(replacement.value)}.`
        : issue.suggest ?? 'Change this value to match the expected shape.';
      return [
        (issue.path ? atPath(issue, issue.message) : `(root): ${issue.message}`).replace(/\s+/g, ' '),
        `Expected: ${JSON.stringify(expected)}`,
        `Fix: ${fix.replace(/\s+/g, ' ')}`,
      ].join('\n');
    }).join('\n\n');
  }
}
