// @vitest-environment jsdom
/**
 * Accessibility verification on the rendered chart components.
 *
 * Named axe rules cover DOM semantics for every demo fixture. Browser geometry,
 * contrast and keyboard behavior require the dedicated checks below and browser QA.
 */
import axe from 'axe-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { fillReadabilityWarnings } from '../src/core/themeRules';
import { resolveTheme, themes } from '../src/core/theme';
import { listCharts } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { BoardplotChart } from '../src/react/spec';
import { settle } from './helpers/spec-chunks';
import { loadHoverEngine } from '../src/react/useHover';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
});

type RenderInput = { type: string; data: unknown; options?: object; size?: { width: number; height: number } };

async function render(spec: RenderInput) {
  root ??= createRoot(host);
  await act(async () => {
    root!.render(<BoardplotChart spec={{ type: spec.type, data: spec.data, options: { ...spec.options, size: spec.size } }} hover />);
    await loadHoverEngine();
  });
  // The spec entry links validation and the chart's engine on demand.
  await settle(host);
}

describe('current contrast check per theme', () => {
  it.each(Object.keys(themes))('%s keeps fill separation on the existing theme validator', (name) => {
    expect(fillReadabilityWarnings(resolveTheme(name))).toEqual([]);
  });
});

// jsdom does not supply rendered geometry. Color contrast, target size and
// visual focus require browser QA; theme contrast is checked above.
const AXE_RULES = [
  'aria-allowed-attr', 'aria-command-name', 'aria-conditional-attr',
  'aria-hidden-focus', 'aria-input-field-name', 'aria-meter-name',
  'aria-progressbar-name', 'aria-prohibited-attr', 'aria-required-attr',
  'aria-required-children', 'aria-required-parent', 'aria-roles',
  'aria-toggle-field-name', 'aria-tooltip-name', 'aria-valid-attr-value',
  'aria-valid-attr', 'button-name', 'duplicate-id-aria', 'image-alt',
  'label', 'link-name', 'list', 'listitem', 'nested-interactive',
  'role-img-alt', 'summary-name', 'svg-img-alt', 'table-fake-caption',
  'td-has-header', 'td-headers-attr', 'th-has-data-cells',
] as const;
const demoCases = listCharts().flatMap(({ type }) => getFixtures(type)
  .filter(fixture => fixture.tags.includes('demo'))
  .map(fixture => ({ name: `${type}/${fixture.id}`, type, fixture })));

describe('named axe checks on every demo fixture', () => {
  it.each(demoCases)('$name has accessible names and DOM semantics', async ({ type, fixture }) => {
    await render({ type, data: fixture.data, options: fixture.options,
      size: fixture.options?.size ?? { width: 800, height: 450 } });
    const result = await axe.run(host, { runOnly: { type: 'rule', values: [...AXE_RULES] } });
    expect(result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
  });
});

// axe flagged every table that scrolls sideways: the scroller took no keyboard focus, so a keyboard reader could not reach its cut columns.
it('gives an overflowing table scroller keyboard focus and a name', async () => {
  const fixture = getFixtures('table').find(f => f.id === 'management-report')!;
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2100);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  await render({ type: 'table', data: fixture.data, options: fixture.options, size: { width: 600, height: 800 } });
  const scroller = host.querySelector('.bp-scroll')!;
  expect(scroller.getAttribute('tabindex')).toBe('0');
  expect(scroller.getAttribute('aria-label')).toBeTruthy();
});
