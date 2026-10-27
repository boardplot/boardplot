import { chartString } from '../../strings/cohort';
import type { CohortOptions } from './types';

export function cohortMeasure(options: CohortOptions): string {
  return options.strings?.cohortMeasure?.trim() || chartString(options, 'measure');
}

export function cohortFormula(options: CohortOptions, basis: 'cohort' | 'previous'): string {
  const authored = options.strings?.cohortFormula?.trim();
  const formula = authored || chartString(options, 'formula', { measure: cohortMeasure(options), basis: chartString(options, basis === 'cohort' ? 'baseFormula' : 'previousFormula') });
  return /[.!?]$/.test(formula) ? formula : `${formula}.`;
}
