import type { CreativeData, CreativeFatigueRule } from './types';

interface CreativeWindow {
  inputs: { ref: string; value: number }[];
  mean: number | null;
  missing: boolean;
}
export interface CreativeFatigue {
  status: 'flagged' | 'clear' | 'unavailable';
  reason?: 'no-rule' | 'missing-data' | 'insufficient-data' | 'zero-baseline';
  baseline: CreativeWindow;
  current: CreativeWindow;
  changePct: number | null;
  adversePct: number | null;
  rule?: CreativeFatigueRule;
}

function windowValues(data: CreativeData, rule: CreativeFatigueRule, window: CreativeFatigueRule['baseline']): CreativeWindow {
  const rows = data.observations.filter(row => row.date >= window.startDate && row.date <= window.endDate);
  const inputs = rows.flatMap(row => row[rule.metric] === null ? [] : [{ ref: `observations:${row.date}:${rule.metric}`, value: row[rule.metric]! }]);
  const days = (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86400000 + 1;
  const mean = inputs.length ? inputs.reduce((sum, input) => sum + input.value / inputs.length, 0) : null;
  return { inputs, mean, missing: inputs.length !== days };
}

/** Percent change of unweighted daily means, not a weighted period CTR or CPA. */
export function deriveCreativeFatigue(data: CreativeData): CreativeFatigue {
  const empty: CreativeWindow = { inputs: [], mean: null, missing: true };
  const result: CreativeFatigue = { status: 'unavailable', reason: 'no-rule', baseline: empty, current: empty, changePct: null, adversePct: null };
  const rule = data.fatigueRule;
  if (!rule) return result;
  result.rule = rule;
  result.baseline = windowValues(data, rule, rule.baseline);
  result.current = windowValues(data, rule, rule.current);
  if (rule.missingData === 'unavailable' && (result.baseline.missing || result.current.missing)) result.reason = 'missing-data';
  else if (result.baseline.inputs.length < rule.minObservations || result.current.inputs.length < rule.minObservations) result.reason = 'insufficient-data';
  else if (result.baseline.mean === 0) result.reason = 'zero-baseline';
  else {
    result.changePct = 100 * (result.current.mean! - result.baseline.mean!) / result.baseline.mean!;
    result.adversePct = result.changePct * (rule.direction === 'higherIsBetter' ? -1 : 1);
    result.status = result.adversePct >= rule.thresholdPct ? 'flagged' : 'clear';
    delete result.reason;
  }
  return result;
}
