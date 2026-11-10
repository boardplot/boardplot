// @vitest-environment jsdom
// React 18's JSX runtime copies props with for…in, which drops symbol keys. React 19 can pass the
// props object on as it is, so this file copies the props the React 18 way for every element.
import { vi } from 'vitest';
const { copyLikeReact18 } = vi.hoisted(() => ({ copyLikeReact18: async (path: string) => {
  const actual = await vi.importActual<Record<string, (...args: unknown[]) => unknown>>(path);
  const strip = (fn: (...args: unknown[]) => unknown) => (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
    const copy: Record<string, unknown> = {};
    for (const key in props) copy[key] = props[key];
    return fn(type, copy, ...rest);
  };
  return { ...actual, ...(actual.jsx ? { jsx: strip(actual.jsx), jsxs: strip(actual.jsxs!) } : {}), ...(actual.jsxDEV ? { jsxDEV: strip(actual.jsxDEV) } : {}) };
} }));
vi.mock('react/jsx-runtime', () => copyLikeReact18('react/jsx-runtime'));
vi.mock('react/jsx-dev-runtime', () => copyLikeReact18('react/jsx-dev-runtime'));

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import '../src/core/charts';
import { DimSwitchChart } from '../src/react/DimSwitchChart';
import { exampleData } from '../src/core/charts/dimswitch/example';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Under React 18 the footer's printed notes and the dimswitch's engine notes rode on symbol props that never arrived:
// a dimswitch with a partial period never called onWarnings, and its partial note was nowhere.
it('reports the warnings of a dimswitch with a partial period under React 18 prop copying', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const long = 'This note is long enough to wrap onto a second line of the footer at this card width.';
  let codes: string[] | undefined;
  await act(async () => root.render(<DimSwitchChart data={exampleData} variant="by-measure" depth={2} target="report" columnHeads={false} size={{ width: 640, height: 600 }}
    footnotes={[long, `${long} Two.`, `${long} Three.`]} onWarnings={(warnings) => { codes = warnings.map((warning) => warning.code); }} />));
  for (let i = 0; i < 50 && host.querySelector('[data-bp-loading]'); i++) await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
  expect(codes).toContain('dimswitch-partial-note-off-frame');
  expect(host.querySelector('.bp-notes')?.textContent).toContain('Week 2 to date');
  act(() => root.unmount()); host.remove();
});
