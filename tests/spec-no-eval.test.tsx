// @vitest-environment jsdom
import { act } from 'react';
import { expect, it } from 'vitest';
import { BoardplotChart } from '../src/react/spec';
import { mount } from './helpers/spec-chunks';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// A page whose content security policy has no 'unsafe-eval' reports each `new Function` call, and zod makes them while it validates a spec unless it is told not to before its chunk loads.
it('draws a spec without a call to new Function', async () => {
  const made: string[] = [];
  const RealFunction = globalThis.Function;
  globalThis.Function = new Proxy(RealFunction, { construct(target, args) { made.push(String(args.at(-1))); return Reflect.construct(target, args); } });
  const host = document.createElement('div');
  document.body.append(host);
  try {
    const root = await mount(<BoardplotChart spec={{ type: 'column', data: { categories: ['North', 'South'], series: [{ id: 'sales', values: [120, 95] }] } }} />, host);
    expect(host.querySelector('svg[data-bp-chart="column"]')).not.toBeNull();
    await act(async () => { root.unmount(); });
  } finally {
    globalThis.Function = RealFunction;
    host.remove();
  }
  expect(made).toEqual([]);
});
