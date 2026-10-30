// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { BoardplotChart } from '../src/react/spec';
import { ScaleGroup, useScaleGroupPlan } from '../src/react/ScaleGroup';
import { settle } from './helpers/spec-chunks';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const data = (...values: number[]) => ({ categories: [{ id: 'q1' }, { id: 'q2' }], series: [{ id: 'share', values }] });
const members = [{ id: 'eu', type: 'column', data: data(30, 60) }, { id: 'us', type: 'column', data: data(40, 80) }];
const host = document.createElement('div');
const root = createRoot(host);
afterEach(() => { act(() => { root.unmount(); }); });

// No chart core is linked in this file. BoardplotChart fetched its chunk after ScaleGroup planned,
// so the group refused every member for good and each chart kept its own scale, unwarned.
it('plans again when a member chart type arrives in its own chunk', async () => {
  let refused: string[] = [];
  function Receipt() {
    refused = (useScaleGroupPlan('fy25')?.refusals ?? []).map((refusal) => refusal.code);
    return null;
  }
  await act(async () => {
    root.render(
      <ScaleGroup group="fy25" members={members}>
        {members.map((member) => (
          <BoardplotChart key={member.id} spec={{ type: member.type, data: member.data, options: { size: { width: 520, height: 340 }, scaleGroup: { y: 'fy25', id: member.id } } }} />
        ))}
        <Receipt />
      </ScaleGroup>,
    );
  });
  expect(refused).toContain('scale-group-unknown-type');
  await settle(host);
  expect(refused).toEqual([]);
  const tallest = host.innerHTML.split('</svg>').slice(0, -1).map((svg) =>
    Math.max(...[...svg.matchAll(/<rect[^>]*data-part="bar"[^>]*>/g)].map((bar) => Number(/height="([\d.]+)"/.exec(bar[0])![1]))));
  expect(tallest[0]! / 60).toBeCloseTo(tallest[1]! / 80, 2);
});
