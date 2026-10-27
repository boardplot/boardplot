import type { Scenario } from '../types/cell';
import type { InteractionComparison, InteractionValue } from './types';
import { derivedPercent, derivedValue } from './recordsShared';
import { parseFormatExample, specUnitKind } from '../formatSpec';

function isPercentLevel(value: InteractionValue): boolean {
  if (value.unit !== undefined) return value.unit === '%';
  return value.format !== undefined && specUnitKind(parseFormatExample(value.format)) === 'percent';
}

export function unavailableValue(reason: string, unit?: string): InteractionValue {
  return { kind: 'number', raw: null, state: 'unavailable', reason, ...(unit === undefined ? {} : { unit }) };
}

/** Relative changes use a positive base, as the existing variance contract does. */
export function compareValues(
  current: InteractionValue, reference: InteractionValue, label: string, scenario?: Scenario,
  incompatible?: string,
): InteractionComparison {
  const reason = incompatible ?? (current.unit !== reference.unit ? 'Incompatible units' : undefined)
    ?? (current.state !== 'value' || reference.state !== 'value' ? 'A comparison operand is unavailable' : undefined)
    ?? (typeof current.raw !== 'number' || typeof reference.raw !== 'number' ? 'Comparison requires numeric values' : undefined);
  const deltaUnit = isPercentLevel(current) && isPercentLevel(reference) ? 'pp' : current.unit;
  const delta = reason ? unavailableValue(reason, deltaUnit) : derivedValue((current.raw as number) - (reference.raw as number), deltaUnit, current.format);
  const percent = reason ? unavailableValue(reason, '%') : (reference.raw as number) <= 0
    ? unavailableValue('Relative change requires a positive reference', '%')
    : derivedPercent((delta.raw as number) / (reference.raw as number) * 100);
  return { label, ...(scenario ? { scenario } : {}), current, reference, delta, percent };
}
