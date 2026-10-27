// @vitest-environment jsdom
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { BoardplotChart } from '../src/react/spec';
import { mount, settle } from './helpers/spec-chunks';
import { boardplotSpecSettingsSchema } from '../src/core/schema/spec';
import fixture from './fixtures/spec-error-host.json';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const present = (selector: string) => host.querySelector(selector) !== null;

it('renders the diagnostic card with path, expected, received, suggest and docs, then recovers', async () => {
  const settings = boardplotSpecSettingsSchema.parse(fixture.settings);
  root = await mount(<BoardplotChart spec={fixture.spec} {...settings} />, host);
  const card = host.querySelector('[role="alert"]')!;
  const entry = card.querySelector('[data-bp-error-path="/charts/0/data/series/0/values/0"]')!;
  expect(entry === null).toBe(false);
  for (const field of ['Expected', 'Received', 'Docs']) expect(card.querySelector('[data-bp-finding]')?.textContent).toContain(field);
  expect(present('svg, table, [data-bp-refused]')).toBe(false);
  const valid = structuredClone(fixture.spec);
  valid.charts[0]!.data.series[0]!.values = [24] as never;
  await act(async () => { root!.render(<BoardplotChart spec={valid} {...settings} />); });
  await settle(host);
  expect(present('svg')).toBe(true);
  expect(present('[role="alert"]')).toBe(false);
});

it('renders only the reader card in production and draws the busy frame on the server', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  // The spec entry links no validation, so one server pass cannot know the
  // spec is invalid. It draws the busy placeholder and the card follows in
  // the browser; a host that needs the diagnostic server-side validates with
  // parseChartSpec from boardplot/react/prepare.
  const html = renderToString(<BoardplotChart spec={fixture.spec} />);
  expect(html).toContain('data-bp-loading');
  expect(html).not.toContain('data-bp-spec-error');
  root = await mount(<BoardplotChart spec={fixture.spec} />, host);
  expect(host.innerHTML).toContain('data-bp-spec-error');
  expect(host.innerHTML).toContain('/charts/0/data/series/0/values/0');
  expect(host.textContent).not.toMatch(/Received|Expected|\/charts\/0/);
  expect(present('[role="status"]')).toBe(true);
  expect(present('details')).toBe(false);
});

it('points into the bare spec the caller sent, not into a wrapping envelope', async () => {
  const bare = { type: 'column', data: fixture.spec.charts[0]!.data, options: fixture.spec.charts[0]!.options };
  root = await mount(<BoardplotChart spec={bare} />, host);
  const entry = host.querySelector('[data-bp-error-path]')!;
  expect(entry.getAttribute('data-bp-error-path')).toBe('/data/series/0/values/0');
  const data = { categories: ['Week 1'], series: [{ id: 'orders', values: [24] }] };
  await act(async () => { root!.render(<BoardplotChart spec={{ type: 'column', data, options: { ...bare.options, labelDensity: 'sparse' } }} />); });
  await settle(host);
  expect(Array.from(host.querySelectorAll('[data-bp-error-path]')).map(node => node.getAttribute('data-bp-error-path')))
    .toContain('/options/labelDensity');
});

// A text-only console capture printed the findings array as [Object].
it('logs a readable line naming the code and path before the findings', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const bare = { type: 'column', data: fixture.spec.charts[0]!.data, options: fixture.spec.charts[0]!.options };
  root = await mount(<BoardplotChart spec={bare} />, host);
  const call = error.mock.calls.find(([first]) => typeof first === 'string' && first.startsWith('Boardplot spec-error: '))!;
  const code = host.querySelector('[data-bp-error-code]')!.getAttribute('data-bp-error-code')!;
  expect(call[0]).toContain(`${code} at /data/series/0/values/0: `);
  expect(Array.isArray(call[1])).toBe(true);
});

it('uses provider tokens, reports invalid settings and passes unexpected errors through', async () => {
  root = await mount(<BoardplotTheme theme="standard-dark">
    <BoardplotChart spec={fixture.spec} size={'bad' as never} />
  </BoardplotTheme>, host);
  const card = host.querySelector<HTMLElement>('[data-bp-spec-error]')!;
  expect(card.textContent).toContain('/size');
  expect(card.style.background).toBe('rgb(14, 26, 38)');
  // Validation is loaded by now, so the browser pass parses in the same
  // render and an error that is not a spec diagnostic reaches the host.
  const unexpected = new Error('Unexpected renderer failure');
  const bad = new Proxy({}, { ownKeys: () => { throw unexpected; } });
  expect(() => act(() => { root!.render(<BoardplotChart spec={bad} />); })).toThrow(unexpected);
});

it('keeps schema defaults absent and accepts the hover setting', () => {
  expect(boardplotSpecSettingsSchema.parse({})).toEqual({});
  for (const hover of [true, false, { card: false }, { highlight: false }]) expect(boardplotSpecSettingsSchema.parse({ hover })).toEqual({ hover });
  expect(boardplotSpecSettingsSchema.safeParse({ hover: 'yes' }).success).toBe(false);
});
