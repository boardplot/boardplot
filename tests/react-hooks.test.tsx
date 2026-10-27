// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { resolveChartRequest, layoutResolvedRequest, type ChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';
import { SceneRenderer } from '../src/react/SceneRenderer';
import { stampFreeSha } from './golden/stamp';
import { prepareChartRender } from '../src/react/prepared';

function rendered(input: ChartRequest, prepared = false) {
  const request = resolveChartRequest(input);
  const geometry = requireGeometry(layoutResolvedRequest(request));
  const scene = prepared ? prepareChartRender(request, geometry).result : geometry;
  if (scene.refused) throw new Error('Expected accepted fixture');
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<SceneRenderer geometry={scene} theme={request.theme} />);
  return { element, geometry, request };
}

const input: ChartRequest = {
  type: 'column', size: { width: 800, height: 450 },
  data: { categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
    series: [{ id: 'orders', label: 'Orders', values: [42, 35] }] },
  options: { title: 'Orders by region', legend: 'bottom' },
};

function hooks(element: HTMLElement) {
  return Array.from(element.querySelectorAll('[data-id]')).map(node => Object.fromEntries(
    node.getAttributeNames().filter(name => name.startsWith('data-bp-')).map(name => [name, node.getAttribute(name)]),
  ));
}

describe('React testing hooks', () => {
  it('keeps semantic mark identity across reorder and separates labels from legend items', () => {
    const first = rendered(input).element;
    const reversed = rendered({ ...input, data: { categories: [{ id: 'south', label: 'South' }, { id: 'north', label: 'North' }],
      series: [{ id: 'orders', label: 'Orders', values: [35, 42] }] } }).element;
    for (const category of ['north', 'south']) {
      const selector = `[data-bp-mark="orders:${category}"][data-part="bar"]`;
      expect(JSON.parse(first.querySelector(selector)!.getAttribute('data-bp-owner')!)).toEqual({ categoryId: category, seriesId: 'orders' });
      expect(reversed.querySelector(selector)?.getAttribute('data-bp-owner')).toBe(first.querySelector(selector)?.getAttribute('data-bp-owner'));
    }
    expect(first.querySelector('[data-bp-label="orders:north"]')).not.toBeNull();
    const legend = first.querySelectorAll('[data-bp-legend-item="orders"]');
    expect(legend.length).toBe(2);
    expect(Array.from(legend).every(node => !node.hasAttribute('data-bp-mark'))).toBe(true);
    expect(first.querySelector('svg')?.getAttribute('data-bp-chart')).toBe('column');
    expect(hooks(rendered(input, true).element)).toEqual(hooks(first));
  });

  it('carries exact grid panel paths without changing canonical SVG', () => {
    const fixture = getFixtures('grid').find(item => item.id === 'facet-regions')!;
    const request = { type: 'grid', data: fixture.data, options: fixture.options, annotations: fixture.annotations };
    const { element, geometry, request: resolved } = rendered(request);
    const bars = Array.from(element.querySelectorAll('[data-bp-mark="rev:fy23"][data-part="bar"]'));
    expect(bars.map(node => node.getAttribute('data-bp-panel')).sort()).toEqual(['amer', 'apac', 'emea', 'latam']);
    expect(stampFreeSha(renderSvg(geometry, resolved.theme)))
      .toBe('f00aee2cfd26aacb3d3a7a9e45f507db3f324479af837eafa5abb052dd90e928');
    expect(hooks(rendered(request, true).element)).toEqual(hooks(element));
  });

  it('scopes authored grids and escapes punctuation without using DOM order', () => {
    const data = { panels: ['west/retail', 'west:retail'].map((id, column) => ({
      id, type: 'column', row: 0, column, data: input.data, options: { legend: 'bottom' },
    })) };
    const { element } = rendered({ type: 'grid', data, size: { width: 1200, height: 800 } });
    const marks = element.querySelectorAll('[data-bp-mark="orders:north"][data-part="bar"]');
    expect(Array.from(marks).map(node => node.getAttribute('data-bp-panel')).sort()).toEqual(['west%2Fretail', 'west%3Aretail']);
    expect(element.querySelectorAll('[data-bp-legend-item="orders"]').length).toBe(4);
  });

  it('exposes diagram card ownership and distinct chart instances', () => {
    const fixture = getFixtures('diagram').find(item => item.id === 'org-structure')!;
    const { element } = rendered({ type: 'diagram', data: fixture.data, options: fixture.options });
    expect(JSON.parse(element.querySelector('[data-bp-card="pointId=executive"]')!.getAttribute('data-bp-owner')!)).toEqual({ pointId: 'executive' });
    const { geometry, request } = rendered(input);
    element.innerHTML = renderToStaticMarkup(<><SceneRenderer geometry={geometry} theme={request.theme} />
      <SceneRenderer geometry={geometry} theme={request.theme} /></>);
    const scopes = Array.from(element.querySelectorAll('svg')).map(svg => svg.getAttribute('data-bp-instance'));
    expect(new Set(scopes).size).toBe(2);
  });
});
