/**
 * Scatter value lines and the vertical domain.
 *
 * An authored value line is part of the range the exhibit states, so the
 * domain is sized to contain it, the way a strategy region's vertices are. Two
 * authored settings can still leave a line outside the drawn axis: a clamp,
 * which `refuseClampedValueLines` in clamp.ts refuses, and `valueAxis.min` or
 * `valueAxis.max`, which this module refuses. A zoom (`viewDomain`) leaves a
 * line outside its window out of the picture, as it leaves out the points.
 */

import { NormalizeError } from '../../normalize/shared';
import { defaultAnnotationId, type Annotation } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { LintWarning } from '../../types/scene';

/** A value line the annotation pass draws, with the value it draws it at. */
export interface DrawnValueLine {
  index: number;
  id: Id;
  value: number;
  isMean: boolean;
}

/**
 * The value lines the annotation pass draws on a scatter. It mirrors the
 * pass's own refusals in annotate.ts: a secondary-axis line, a scoped mean
 * (a scatter measures no scoped means), an authored value scoped by seriesId,
 * and an authored value with from/to but no tolerance or attainment all draw
 * nothing. With tolerance or attainment, from/to still draws the central line,
 * so that line is checked like any other.
 */
export function drawnValueLines(annotations: readonly Annotation[] | undefined, meanY: number): DrawnValueLine[] {
  const lines: DrawnValueLine[] = [];
  (annotations ?? []).forEach((ann, index) => {
    if (ann.kind !== 'valueLine' || ann.axis === 'secondary') return;
    const spanned = ann.from !== undefined || ann.to !== undefined;
    const isMean = ann.value === 'mean' || ann.value === undefined;
    if (isMean && (ann.seriesId !== undefined || spanned)) return;
    if (!isMean && ann.seriesId !== undefined) return;
    if (!isMean && spanned && ann.tolerance === undefined && ann.attainment === undefined) return;
    const value = isMean ? meanY : (ann.value as number);
    if (!Number.isFinite(value)) return;
    lines.push({ index, id: defaultAnnotationId(ann, index), value, isMean });
  });
  return lines;
}

/** The vertical domain seed widened to every drawn line, like a region vertex. */
export function withValueLines(lines: readonly DrawnValueLine[], lo: number, hi: number): [number, number] {
  return lines.reduce<[number, number]>(([a, b], line) => [Math.min(a, line.value), Math.max(b, line.value)], [lo, hi]);
}

/**
 * Refuse a value line that an authored `valueAxis.min` or `valueAxis.max` puts
 * outside the drawn axis. Those bounds set the axis end, and the engine does
 * not move an authored bound to fit a line.
 */
export function refuseValueLinesOutsideAxis(
  lines: readonly DrawnValueLine[],
  domain: [number, number],
  bounds: { min?: number; max?: number },
  format: (value: number) => string,
): void {
  for (const line of lines) {
    const bound = line.value > domain[1] ? 'max' : line.value < domain[0] ? 'min' : undefined;
    if (!bound || bounds[bound] === undefined) continue;
    const what = line.isMean ? `the mean of the plotted points (${format(line.value)})` : format(line.value);
    throw new NormalizeError(
      'value-line-outside-axis',
      `annotations[${line.index}]`,
      `valueLine '${line.id}' sits at ${what}, ${bound === 'max' ? 'above' : 'below'} the vertical axis, which valueAxis.${bound} ends at ${format(domain[bound === 'max' ? 1 : 0])}, so the line would be drawn outside the plot`,
      `move valueAxis.${bound} past ${format(line.value)}, or drop valueAxis.${bound} and let the axis extend to the line`,
      undefined,
      ['annotations', line.index],
    );
  }
}

/**
 * The annotations to draw under a zoom. A value line outside the vertical
 * window is left out, the way a point outside it is, and a warning names it.
 * Every annotation keeps the id it had in the full list, so dropping one does
 * not renumber the default ids of the others.
 */
export function valueLinesInView(
  annotations: readonly Annotation[] | undefined,
  lines: readonly DrawnValueLine[],
  window: [number, number] | undefined,
  warnings: LintWarning[],
  format: (value: number) => string,
): Annotation[] {
  const all = annotations ?? [];
  if (!window) return [...all];
  const outside = new Set(
    lines.filter((line) => line.value < window[0] || line.value > window[1]).map((line) => line.index),
  );
  if (outside.size === 0) return [...all];
  for (const line of lines) {
    if (!outside.has(line.index)) continue;
    warnings.push({
      code: 'value-line-outside-view',
      severity: 'warn',
      message: `valueLine '${line.id}' at ${format(line.value)} lies outside the vertical viewDomain ${format(window[0])} to ${format(window[1])}, so it is not drawn`,
      suggest: 'widen viewDomain.y to include the line, or drop viewDomain to show the whole range',
    });
  }
  return all
    .map((ann, index) => ({ ...ann, id: defaultAnnotationId(ann, index) }) as Annotation)
    .filter((_, index) => !outside.has(index));
}
