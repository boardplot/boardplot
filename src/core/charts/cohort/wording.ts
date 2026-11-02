import { chartString } from '../../strings/cohort';
import type { LintWarning } from '../../types/scene';
import type { CohortOptions } from './types';

export function cohortBasisWarnings(options: CohortOptions): LintWarning[] {
  const basis = options.basis ?? 'cohort';
  const otherBasis = basis === 'cohort' ? 'previous' : 'cohort';
  // Only explicit English or German basis phrases are compared with the denominator.
  const contrary = basis === 'cohort'
    ? /\b(?:(?:previous|prior|preceding)[\s-]+(?:period|month|week|quarter|year)|period[\s-]+(?:over|to)[\s-]+period|vor(?:periode|monat|woche|quartal|jahr))\b/i
    : /\b(?:(?:original|initial)[\s-]+cohort|cohort[\s-]+(?:base|size)|of[\s-]+(?:the[\s-]+)?cohort|period[\s-]*0|kohorten(?:basis|größe)|periode[\s-]*0)\b/i;
  const denominator = basis === 'cohort' ? 'the cohort base (period 0)' : 'the previous period\'s active count';
  const captions = [
    { text: options.unit, field: ['unit'] },
    { text: options.strings?.cohortMeasure, field: ['strings', 'cohortMeasure'] },
  ];
  return captions.filter(({ text }) => text !== undefined && contrary.test(text)).map(({ text, field }) => ({
    code: 'cohort-basis-caption-mismatch',
    severity: 'warn',
    field: ['options', ...field],
    message: `options.${field.join('.')} '${text}' names basis '${otherBasis}'. options.basis '${basis}' divides active counts by ${denominator}.`,
    suggest: `correct options.${field.join('.')} to name ${denominator}, or set options.basis to '${otherBasis}' if the authored caption is correct`,
  }));
}

export function cohortMeasure(options: CohortOptions): string {
  return options.strings?.cohortMeasure?.trim() || chartString(options, 'measure');
}

export function cohortFormula(options: CohortOptions, basis: 'cohort' | 'previous'): string {
  const authored = options.strings?.cohortFormula?.trim();
  const formula = authored || chartString(options, 'formula', { measure: cohortMeasure(options), basis: chartString(options, basis === 'cohort' ? 'baseFormula' : 'previousFormula') });
  return /[.!?]$/.test(formula) ? formula : `${formula}.`;
}
