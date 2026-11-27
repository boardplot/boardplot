import type { LintWarning } from '../types/scene';

/** Findings of a name row that cannot print its names whole: the cue to turn a bridge horizontal. */
export const CROWDED_NAMES: ReadonlySet<string> = new Set(['category-labels-rotated', 'category-labels-truncated', 'category-stride']);

/** The names a rotated row cut, and where the reader finds them whole. */
export function categoryCutLint(names: readonly string[], noted: boolean, where = 'on the rotated axis'): LintWarning {
  return {
    code: 'category-labels-truncated',
    severity: noted ? 'info' : 'warn',
    message: `${names.length === 1 ? 'one category label is' : `${names.length} category labels are`} cut ${where}: ${names.map((name) => `'${name}'`).join(', ')}` +
      (noted ? '; the full name is in the notes list' : '; the full name is in the SVG title only'),
    suggest: 'shorten the name, widen the canvas, or use a bar chart to keep names upright',
    detail: { cut: [...names] },
  };
}
