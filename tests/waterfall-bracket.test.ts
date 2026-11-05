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

// Subtracting rounded levels loses a small step next to a large balance, so the bracket printed +0.00
// for steps worth +0.03: the sum must come from the step values.
it('a bracket next to a large balance still prints the sum of its steps', () => {
  const big = {
    items: [
      { id: 'a', label: 'Start', type: 'total' as const, value: 999999999999990 },
      { id: 'b', label: 'Gain', value: 0.01 },
      { id: 'c', label: 'Gain 2', value: 0.02 },
      { id: 'd', label: 'End', type: 'total' as const },
    ],
  };
  const geometry = layoutWaterfall(big, { format: '1,234.00', annotations: [{ kind: 'bracket', from: 'b', to: 'c', label: 'Two' }] } as never);
  expect(geometry.annotations.find((annotation) => annotation.id === 'bracket-1')!.computedText).toBe('Two +0.03');
});

// A JSON object anchor (null-prototype, as the CLI copies documents) passed the shared anchor check and
// crashed the layout when the error text interpolated it: it must give a diagnostic, never a crash.
it('a bracket with an object anchor is refused with a diagnostic', () => {
  const anchor = Object.assign(Object.create(null), { categoryId: 'b' });
  const geometry = layoutWaterfall(data, { annotations: [{ kind: 'bracket', from: anchor, to: 'c' }] } as never);
  expect(geometry.warnings.map((warning) => warning.code)).toContain('bad-anchor');
  expect(geometry.annotations.some((annotation) => annotation.kind === 'bracket')).toBe(false);
});

// When the solver hides the bracket's only label, the bare bracket path stayed on the chart with no
// name or sum: the bracket goes with its label.
it('a bracket whose label the solver hid leaves no bracket path', () => {
  const geometry = layoutWaterfall(data, {
    size: { width: 240, height: 300 },
    annotations: [{ kind: 'bracket', from: 'b', to: 'e', label: 'A very long bracket label that cannot possibly fit in a chart this narrow' }],
  } as never);
  const hidden = geometry.labels.find((label) => label.id === 'annotation:bracket-1')!;
  expect(hidden.hidden).toBeTruthy();
  expect(geometry.scene.some((node) => node.owner.annotationId === 'bracket-1')).toBe(false);
});
