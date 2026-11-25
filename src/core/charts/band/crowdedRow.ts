import type { Rect } from '../../geometry';
import { shownNoteKinds } from '../../notes';
import type { BaseOptions, LabelDensity } from '../../types/options';
import type { EventOptions } from '../../types/annotations';
import type { RowPeak } from '../../label/solver';

export const KEEP_PANEL_LABEL_SELECTION = Symbol('keepPanelLabelSelection');

/** A disclosure can refit the plot. Authored moves and late annotations can claim seats after the value pass. */
export function canTryRowPeak(options: Pick<BaseOptions, 'notes' | 'annotations' | 'labelOffsets'> & { methodNote?: boolean; events?: EventOptions; [KEEP_PANEL_LABEL_SELECTION]?: true }): boolean {
  return !shownNoteKinds(options)?.includes('disclosure') && !options.events?.groups?.length && !(KEEP_PANEL_LABEL_SELECTION in options)
    && !options.labelOffsets && !options.annotations?.some(annotation => annotation.kind !== 'valueLine');
}

/** Add the tallest eligible column to the solver only when the usual rhythm drops it. */
export function planCrowdedRow(
  values: readonly (number | null | undefined)[],
  plot: Rect,
  kept: (index: number) => boolean,
  protectedAt: (index: number) => boolean,
  idAt: (index: number) => string,
  density: LabelDensity | undefined,
): { index: number; seat: RowPeak } | undefined {
  let index = -1;
  let highest = 0;
  let keepsHighest = false;
  for (let ci = 0; ci < values.length; ci++) {
    const value = values[ci];
    if (value != null && Number.isFinite(value) && value > 0 && value >= highest) {
      keepsHighest = kept(ci) || (value === highest && keepsHighest);
      index = ci;
      highest = value;
    }
  }
  if (index < 0 || keepsHighest || protectedAt(index)) return;
  // Minimal density leaves dropped values out of the note. Keep their seats.
  const neighbours = density === 'minimal' ? [] : [index - 1, index + 1]
    .filter(ci => ci >= 0 && ci < values.length && kept(ci) && !protectedAt(ci))
    .map(idAt);
  return { index, seat: { plot, neighbours } };
}
