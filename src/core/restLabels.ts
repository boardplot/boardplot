import type { RenderTarget } from './types/options';

/**
 * A Rest series (colorRole 'others') of a stacked column, stacked bar or
 * stacked area prints no value label on the dashboard target: its value
 * stays in the hover card and in the note line. `labels.restSeries` sets it
 * on every target: false hides and notes the values, true prints them.
 */
export function restValuesHidden(
  options: { target?: RenderTarget; labels?: false | Record<string, unknown> },
  colorRole: string | undefined,
): boolean {
  if (colorRole !== 'others') return false;
  const own = options.labels === false ? undefined : options.labels?.restSeries;
  return typeof own === 'boolean' ? !own : options.target === 'dashboard';
}

/** The request fields that hide the value and owe it to the note line (class 2). */
export function restValueHiding(noteText: string): { redundant: true; suppressedAs: 'density'; owed: true; noteText: string } {
  return { redundant: true, suppressedAs: 'density', owed: true, noteText };
}
