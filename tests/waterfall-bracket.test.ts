import './helpers/link-core';
import { expect, it } from 'vitest';

import { claimsForChart } from '../src/core/claims';
import { layoutWaterfall } from '../src/core/charts/waterfall/layout';
import { recomputeClaim } from './helpers/recompute';

const data = {
  items: [
    { id: 'a', label: 'Start', type: 'total' as const, value: 100 },
    { id: 'b', label: 'Volume', value: 64 },
    { id: 'c', label: 'Price', value: 38 },
    { id: 'd', label: 'Mix', value: -21 },
    { id: 'e', label: 'Materials', value: -47 },
    { id: 'f', label: 'End', type: 'total' as const },
  ],
};

// A bracket that prints a number the reader cannot reproduce would be a wrong number on the page:
// the printed sum must equal the steps it spans, and a span with a total must be refused.
it('a bracket over bridge steps prints their sum, and refuses a span that holds a total', () => {
  const geometry = layoutWaterfall(data, {
    annotations: [
      { kind: 'bracket', from: 'b', to: 'd', label: 'Commercial' },
      { kind: 'bracket', from: 'e', to: 'f' },
    ],
  } as never);
  const bracket = geometry.annotations.find((annotation) => annotation.id === 'bracket-1')!;
  expect(bracket.computedText).toBe('Commercial +81');
  const claim = claimsForChart('waterfall', geometry as never).find((c) => c.op === 'sum@1')!;
  expect(recomputeClaim(claim).status).toBe('reproduced');
  expect(claim.output.raw).toBe(81);
  expect(geometry.annotations.some((annotation) => annotation.id === 'bracket-2')).toBe(false);
  expect(geometry.warnings.map((warning) => warning.code)).toContain('bracket-span-total');
});
