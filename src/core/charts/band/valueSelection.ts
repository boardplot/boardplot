/**
 * `valueLabels` on column and bar, with the
 * choices and meaning line has. The chart prints the chosen values only. A
 * value it does not choose is unlabelled by the author's choice: it gets no
 * label request, so the note does not name it, and the value axis stays on
 * so the reader can still read it. A chosen value that finds no seat is
 * owed to the note, as every value is under labelDensity 'full'.
 */

import { NormalizeError } from '../../normalize/shared';
import type { ValueLabelMode } from '../../types/options';

/**
 * The indices a mode labels in one series, in category order: 'last', 'ends'
 * (first and last), 'extremes' (first, last, highest and lowest; a tie takes
 * the first), 'all' or 'none'. Missing values are never chosen; first and
 * last are the first and last drawn values.
 */
export function chosenValueIndices(mode: ValueLabelMode, values: readonly (number | null | undefined)[]): Set<number> {
  const drawn = values.flatMap((value, index) => (value === null || value === undefined || !Number.isFinite(value) ? [] : [index]));
  if (mode === 'none' || drawn.length === 0) return new Set();
  if (mode === 'all') return new Set(drawn);
  const first = drawn[0]!;
  const last = drawn[drawn.length - 1]!;
  if (mode === 'last') return new Set([last]);
  if (mode === 'ends') return new Set([first, last]);
  const high = drawn.reduce((best, index) => (values[index]! > values[best]! ? index : best));
  const low = drawn.reduce((best, index) => (values[index]! < values[best]! ? index : best));
  return new Set([first, last, high, low]);
}

type BandLabelOptions = {
  valueLabels?: ValueLabelMode;
  labelDensity?: 'full' | 'smart' | 'minimal';
  valueAxis?: { show?: boolean };
};

/**
 * The options a band chart lays out with when `valueLabels` is set.
 * valueLabels wins over labelDensity: every chosen value is offered on the
 * one-step rule, as under 'full', and no density gate drops it. Unless
 * valueAxis.show says otherwise, the value axis is drawn for every mode but
 * 'all', as on line: values left unlabelled stay readable. A stack has no
 * single value per category, so a stacked variant refuses every mode but
 * 'all', which asks for what it prints anyway.
 * Without valueLabels the options come back unchanged.
 */
export function withValueLabelDefaults<O extends BandLabelOptions>(options: O, type: 'column' | 'bar', variant: string | undefined): O {
  if (options.valueLabels === undefined) return options;
  if (variant !== undefined && variant !== 'grouped') {
    // 'all' asks for what every variant already prints, so it changes nothing there.
    if (options.valueLabels === 'all') return options;
    throw new NormalizeError(
      'value-labels-variant',
      'options.valueLabels',
      `valueLabels picks single values and applies to grouped ${type === 'column' ? 'columns' : 'bars'} only; variant '${variant}' has no single value per category`,
      `remove valueLabels and use labelDensity, or set variant 'grouped'`,
      [{ op: 'remove', path: '/options/valueLabels' }],
    );
  }
  return {
    ...options,
    labelDensity: 'full',
    ...(options.valueAxis?.show === undefined && options.valueLabels !== 'all' ? { valueAxis: { ...options.valueAxis, show: true } } : {}),
  };
}

/** Whether valueLabels picks some values only ('none', 'last', 'ends', 'extremes'): a pick is no scatter to drop as a whole. */
export function pickedValues(options: { valueLabels?: ValueLabelMode }): boolean {
  return options.valueLabels !== undefined && options.valueLabels !== 'all';
}
