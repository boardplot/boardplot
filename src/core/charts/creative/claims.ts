import type { ClaimRecordV1 } from '../../claims/browser';
import { formatAutomaticNumber, formatAutomaticPercent } from '../../format';
import type { Geometry } from '../../types/scene';
import type { CreativeDerived } from './layout';

/** The printed "vs median" changes: creative value against its account median. */
function deltaClaims(geometry: Geometry<object, object>): ClaimRecordV1[] {
  return ((geometry.derived as CreativeDerived).deltas ?? []).flatMap(({ key, value, accountMedian, pct, text }) => {
    if (pct === null) return [];
    const nodeId = `label:creative:delta:${key}`;
    const node = geometry.scene.find(item => item.id === nodeId);
    return [{ id: `creative:delta:${key}`, kind: 'derived' as const, op: 'percentDelta@1',
      inputs: [{ ref: `metrics.${key}.value`, value }, { ref: `metrics.${key}.accountMedian`, value: accountMedian }],
      output: { raw: pct, state: 'value' as const, displayed: node?.t === 'text' ? node.lines.join(' ') : text }, nodeId: node ? nodeId : undefined }];
  });
}

export function creativeClaims(geometry: Geometry<object, object>): ClaimRecordV1[] {
  const fatigue = (geometry.derived as CreativeDerived).fatigue;
  const claims: ClaimRecordV1[] = deltaClaims(geometry);
  if (!fatigue.rule) return claims;
  for (const key of ['baseline', 'current'] as const) {
    const window = fatigue[key];
    if (window.mean !== null) claims.push({ id: `creative:fatigue:${key}`, kind: 'aggregate', op: 'mean@1',
      inputs: window.inputs, output: { raw: window.mean, state: 'value', displayed: formatAutomaticNumber(window.mean, { decimals: 2 }) } });
  }
  if (fatigue.changePct !== null) {
    const inputs = [{ ref: 'current-daily-mean', value: fatigue.current.mean }, { ref: 'baseline-daily-mean', value: fatigue.baseline.mean }];
    claims.push({ id: 'creative:fatigue:change', kind: 'derived', op: 'percentDelta@1', inputs,
      output: { raw: fatigue.changePct, state: 'value', displayed: formatAutomaticPercent(fatigue.changePct, 1, true) } });
    const nodeId = 'label:creative:fatigue:0';
    const node = geometry.scene.find(node => node.id === nodeId);
    claims.push({ id: 'creative:fatigue:flag', kind: 'derived', op: 'creative-fatigue@1',
      inputs: [...inputs, { ref: 'adverse-direction', value: fatigue.rule.direction === 'higherIsBetter' ? -1 : 1 }, { ref: 'thresholdPct', value: fatigue.rule.thresholdPct }],
      output: { raw: fatigue.status === 'flagged' ? 1 : 0, state: fatigue.status, displayed: node?.t === 'text' ? node.lines.join(' ') : '' }, nodeId: node ? nodeId : undefined });
  }
  return claims;
}
