import { labelsOffKeepsNames } from '../theme';
import type { BaseOptions, LabelKind } from '../types/options';

/**
 * Whether a label kind shows. `labels: false` takes the values off; the
 * `names` kinds stay where the chart keeps its names.
 */
export function labelOn(options: Pick<BaseOptions, 'labels'>, kind: LabelKind, names: readonly LabelKind[] = ['category']): boolean {
  if (options.labels === false) return names.includes(kind) && labelsOffKeepsNames(options);
  return options.labels?.[kind] !== false;
}

/** Whether value-line labels print. `labels.valueLine: false` takes them off; `labels: false` keeps them, as before. */
export function valueLineLabelsOn(options: Pick<BaseOptions, 'labels'>): boolean {
  return options.labels === false || options.labels?.valueLine !== false;
}
