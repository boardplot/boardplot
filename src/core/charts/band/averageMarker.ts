import { localeStrings } from '../../strings';
import type { Annotation } from '../../types/annotations';
import type { Id } from '../../types/cell';

/**
 * The average marker as the valueLine it draws, "Ø <mean>", under an id no
 * other annotation holds. Column, bar, dot and combo add it to their list.
 */
export function averageMarkerLine(
  annotations: readonly { id?: Id }[],
  value: number,
  statFmt: (v: number) => string,
  /** The periods it covers where a window or zoom draws fewer (viewportMeanSpan). */
  span?: string,
  average = localeStrings().average,
): Extract<Annotation, { kind: 'valueLine' }> {
  return { kind: 'valueLine', id: averageMarkerId(annotations), value, label: averageMarkerText(value, statFmt, span, average) };
}

/** The generated marker's id: 'averageMarker', or the next free 'averageMarker-n' when an authored annotation holds it. */
export function averageMarkerId(annotations: readonly { id?: Id }[]): Id {
  let id = 'averageMarker';
  let suffix = 2;
  while (annotations.some((annotation) => annotation.id === id)) id = `averageMarker-${suffix++}`;
  return id;
}

/** The average marker's label: "Ø 42.1", and the periods it covers where the plot draws fewer. */
function averageMarkerText(value: number, statFmt: (v: number) => string, span?: string, average = localeStrings().average): string {
  return `${average} ${statFmt(value)}${span ? ` (${span})` : ''}`;
}

/** The series an average marker takes in, or undefined when it is off. */
export function averageMarkerScope(option: boolean | { scope?: 'all' | Id[] } | undefined): 'all' | Id[] | undefined {
  if (option === undefined || option === false) return undefined;
  return typeof option === 'object' ? option.scope ?? 'all' : 'all';
}
