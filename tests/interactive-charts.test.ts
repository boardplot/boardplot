import { requireGeometry } from '../src/core/sizing';
import { getFixtures } from '../src/fixtures';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error jsdom is a test runtime dependency without bundled declarations.
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { main } from '../src/cli/main';
import { claimsForChart } from '../src/core/claims';
import { getChartDefinition, listCharts } from '../src/core/registry';
import { baseOptionsSchema } from '../src/core/schema/shared';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import type { Geometry, SceneNode } from '../src/core/types/scene';
import type { Theme } from '../src/core/types/theme';
import type { ThemeRef } from '../src/core/types/theme';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function layoutFixture(type: string, fixtureId?: string) {
  const definition = getChartDefinition(type);
  if (!definition) throw new Error(`missing chart ${type}`);
  const fixture = fixtureId
    ? getFixtures(definition.type).find((candidate) => candidate.id === fixtureId)
    : getFixtures(definition.type)[0];
  if (!fixture) throw new Error(`missing fixture ${type}/${fixtureId ?? '(first)'}`);
  const options = {
    ...definition.defaults,
    ...(fixture.options ?? {}),
    ...(fixture.annotations ? { annotations: fixture.annotations } : {}),
  };
  const first = definition.layout(fixture.data, options as never);
  // Report type outgrows some fixed fixture frames; those take their content height.
  const width = (options as { size?: { width?: number } }).size?.width;
  const laid = first.refused && width !== undefined ? { ...options, size: { width } } : options;
  return {
    definition,
    fixture,
    options: laid,
    geometry: requireGeometry(laid === options ? first : definition.layout(fixture.data, laid as never)),
  };
}

function interactiveSvg(type: string, fixtureId?: string): string {
  const laid = layoutFixture(type, fixtureId);
  return renderSvg(
    laid.geometry,
    resolveTheme((laid.options as { theme?: ThemeRef }).theme),
    {
      interactive: true,
      claims: claimsForChart(type, laid.geometry as never),
    },
  );
}

function domFor(svg: string, runScripts = false): JSDOM {
  return new JSDOM(`<body>${svg}</body>`, {
    pretendToBeVisual: true,
    ...(runScripts ? { runScripts: 'dangerously' as const } : {}),
  });
}

function captureConsole(): string[] {
  const output: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...values) => output.push(values.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...values) => output.push(values.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...values) => output.push(values.join(' ')));
  return output;
}

function elementList<T extends Element = Element>(nodes: unknown): T[] {
  return Array.from(nodes as Iterable<T>);
}

describe('scene semantics and static compatibility', () => {
  it('keeps static output unchanged when interaction is false', () => {
    for (const type of ['column', 'grid']) {
      const laid = layoutFixture(type);
      const theme = resolveTheme((laid.options as { theme?: ThemeRef }).theme);
      const baseline = renderSvg(laid.geometry, theme);
      const claims = claimsForChart(type, laid.geometry as never);
      expect(renderSvg(laid.geometry, theme, { interactive: false, claims }), type).toBe(baseline);
      expect(baseline, type).not.toContain('data-bp-interactive');
    }
  });

  it('publishes the opt-in through every chart schema', () => {
    expect(baseOptionsSchema.safeParse({ interactive: true }).success).toBe(true);
    expect(baseOptionsSchema.safeParse({ interactive: 'yes' }).success).toBe(false);
    for (const { type } of listCharts()) {
      const definition = getChartDefinition(type)!;
      const fixture = getFixtures(type)[0]!;
      expect(
        definition.optionsSchema.safeParse({ ...fixture.options, interactive: true }).success,
        type,
      ).toBe(true);
    }
  });

  it('serializes only layout-owned display truth and gives every family a semantic mark', () => {
    for (const { type } of listCharts()) {
      const laid = layoutFixture(type);
      const displayNodes = laid.geometry.scene.filter((node) => node.display);
      expect(displayNodes.length, `${type}: display nodes`).toBeGreaterThan(0);
      const dom = domFor(interactiveSvg(type));
      const svg = dom.window.document.querySelector('svg')!;
      expect(svg.getAttribute('role'), type).toBe('graphics-document document');
      const renderedNodes = elementList(svg.querySelectorAll('[data-id]'));
      for (const node of laid.geometry.scene) {
        const element = renderedNodes.find(
          (candidate) => candidate.getAttribute('data-id') === node.id,
        );
        if (!element) continue;
        expect(element.getAttribute('data-bp-value'), `${type}/${node.id}/value`).toBe(
          node.display?.value ?? null,
        );
        expect(element.getAttribute('data-bp-state'), `${type}/${node.id}/state`).toBe(
          node.display?.state ?? null,
        );
      }
      expect(svg.querySelector('[data-bp-mark]'), type).not.toBeNull();
    }
  }, 10_000);

  it('carries formatted range truth through scene nodes and interactive SVG attributes', () => {
    const rangeData = {
      categories: [{ id: 'method', label: 'Method' }],
      series: [
        {
          id: 'estimate',
          values: [
            {
              number: 51.25,
              range: { low: 41.25, high: 60.75, mid: 52.5 },
            },
          ],
        },
      ],
    };
    // The authored one-decimal format also controls the range display.
    const expectedRangeDisplay = new Map([
      ['range:estimate:method:low', '€41.3'],
      ['range:estimate:method:high', '€60.8'],
      ['range:estimate:method:mid', '€52.5'],
    ]);

    for (const type of ['bar', 'column', 'dot']) {
      // A dot range draws its mid tick beside the method note only.
      const geometry = requireGeometry(getChartDefinition(type)!.layout(
        rangeData,
        { format: '€0.0', methodNote: true } as never,
      ));
      for (const [id, value] of expectedRangeDisplay) {
        expect(
          geometry.scene.find((node) => node.id === id)?.display?.value,
          `${type}/${id}`,
        ).toBe(value);
      }
    }

    const stacked = requireGeometry(getChartDefinition('bar')!.layout(
      {
        categories: [{ id: 'method', label: 'Method' }],
        series: [
          { id: 'base', values: [10] },
          {
            id: 'estimate',
            values: [
              {
                number: 5.25,
                range: { low: 4.25, high: 6.75, mid: 5.5 },
              },
            ],
          },
        ],
      },
      { variant: 'stacked', format: '€0.0' } as never,
    ));
    // The authored one-decimal format also controls stacked offsets.
    expect(
      stacked.scene.find((node) => node.id === 'range:estimate:method:low')
        ?.display?.value,
    ).toBe('€14.3');
    expect(
      stacked.scene.find((node) => node.id === 'range:estimate:method:high')
        ?.display?.value,
    ).toBe('€16.8');
    expect(
      stacked.scene.find((node) => node.id === 'range:estimate:method:mid')
        ?.display?.value,
    ).toBe('€15.5');

    const football = requireGeometry(getChartDefinition('bar')!.layout(
      rangeData,
      { variant: 'football-field', format: '€0.0', methodNote: true } as never,
    ));
    // Football-field uses the same authored number format.
    expect(
      football.scene.find((node) => node.id === 'footballRange:estimate:method')
        ?.display?.value,
    ).toBe('€51.3');
    expect(
      football.scene.find((node) => node.id === 'range:estimate:method:mid')
        ?.display?.value,
    ).toBe('€52.5');

    const document = domFor(
      renderSvg(football, resolveTheme(), { interactive: true }),
    ).window.document;
    expect(
      document
        .querySelector('[data-id="footballRange:estimate:method"]')
        ?.getAttribute('data-bp-value'),
    ).toBe('€51.3');
    expect(
      document
        .querySelector('[data-id="range:estimate:method:mid"]')
        ?.getAttribute('data-bp-value'),
    ).toBe('€52.5');
  });

  it('keeps exact grid-panel values, distinct bullet truth, and explicit state/no-data semantics', () => {
    const grid = domFor(interactiveSvg('grid', 'facet-regions')).window.document;
    const expectedGrid = new Map([
      ['amer/mark:rev:fy23', '30'],
      ['amer/mark:rev:fy24', '34'],
      ['amer/mark:rev:fy25', '39'],
      ['emea/mark:rev:fy23', '38'],
      ['emea/mark:rev:fy24', '41'],
      ['emea/mark:rev:fy25', '48'],
      ['apac/mark:rev:fy23', '46'],
      ['apac/mark:rev:fy24', '48'],
      ['apac/mark:rev:fy25', '57'],
      ['latam/mark:rev:fy23', '54'],
      ['latam/mark:rev:fy24', '55'],
      ['latam/mark:rev:fy25', '66'],
    ]);
    for (const [id, value] of expectedGrid) {
      const node = elementList(grid.querySelectorAll('[data-id]')).find(
        (candidate) => candidate.getAttribute('data-id') === id,
      );
      expect(node?.getAttribute('data-bp-value'), id).toBe(value);
    }

    // exec-kpi-panel draws on the percent-of-target scale, with
    // one shared target line; this fixture keeps a target tick per row.
    const bullet = domFor(interactiveSvg('bullet', 'four-band-neutral-ladder')).window.document;
    expect(bullet.querySelector('[data-id="bar:coverage"]')?.getAttribute('data-bp-value')).toBe('78%');
    expect(bullet.querySelector('[data-id="target:coverage"]')?.getAttribute('data-bp-value')).toBe('85%');
    expect(bullet.querySelectorAll('[data-id^="band:coverage:"]').length).toBe(4);
    for (const band of bullet.querySelectorAll('[data-id^="band:coverage:"]')) {
      expect(band.hasAttribute('data-bp-value')).toBe(false);
      expect(band.hasAttribute('data-bp-mark')).toBe(false);
    }

    const status = domFor(interactiveSvg('status')).window.document;
    expect(
      elementList(status.querySelectorAll('[data-bp-state]')).some(
        (node) => (node.getAttribute('data-bp-state') ?? '').length > 1,
      ),
    ).toBe(true);
    const choropleth = domFor(interactiveSvg('choropleth', 'all-null')).window.document;
    expect(choropleth.querySelector('[data-bp-state="Value missing"]')).not.toBeNull();
    const tilemap = domFor(interactiveSvg('tilemap', 'eu27-equal-tiles')).window.document;
    expect(tilemap.querySelector('[data-bp-value="82.0"]')).not.toBeNull();
    expect(tilemap.querySelector('[data-bp-state="Value missing"]')).not.toBeNull();
  });

  it('classifies KPI comparisons off nonpositive references as values and omits intentionally blank table controls', () => {
    // A nonpositive reference refuses the relative change; the chip shows the
    // absolute change, a value.
    const kpi = layoutFixture('kpi', 'dual-compare-ref-nonpositive');
    const comparisons = kpi.geometry.scene.filter((node) =>
      node.id.startsWith('label:point:compare:'),
    );
    expect(comparisons.length).toBeGreaterThan(0);
    for (const node of comparisons) {
      expect(node.display?.value, node.id).toMatch(/^\+\d/);
      expect(node.display?.state, node.id).toBeUndefined();
    }

    const table = getChartDefinition('table')!;
    for (const fixture of getFixtures(table.type)) {
      const laid = layoutFixture('table', fixture.id);
      for (const node of laid.geometry.scene.filter((candidate) => candidate.display)) {
        expect(node.display?.value, `${fixture.id}/${node.id}/value`).not.toBe('');
        expect(node.display?.state, `${fixture.id}/${node.id}/state`).not.toBe('');
      }
    }
  });

  it('uses neutral claim linkage without asserting verification', () => {
    const laid = layoutFixture('kpi', 'dual-compare');
    const claims = claimsForChart('kpi', laid.geometry as never);
    const linked = claims.filter((claim) => claim.nodeId);
    const svgText = renderSvg(laid.geometry, resolveTheme(), {
      interactive: true,
      claims: linked.map((claim) => ({ id: `stale-${claim.id}`, nodeId: claim.nodeId })),
    });
    const document = domFor(svgText).window.document;
    expect(document.querySelectorAll('[data-bp-claim-linked]')).toHaveLength(linked.length);
    expect(document.querySelector('[data-bp-claim]')).toBeNull();
    expect(svgText).not.toMatch(/verified/i);
  });
});

describe('serializer security boundary', () => {
  it('rejects hostile colors/tokens/tints/numbers and escapes path data', () => {
    const laid = layoutFixture('column');
    const theme = resolveTheme();
    const payloads = [
      '#fff"/><script>globalThis.pwned=1</script><rect fill="#fff',
      'red" onload="globalThis.pwned=1',
      'url(javascript:alert(1))',
      'var(--host-color)',
      'red;stroke:url(#x)',
    ];
    for (const payload of payloads) {
      const geometry = structuredClone(laid.geometry) as Geometry;
      const mark = geometry.scene.find((node) => node.t === 'rect') as Extract<SceneNode, { t: 'rect' }>;
      mark.fill = { css: payload };
      expect(() => renderSvg(geometry, theme), payload).toThrow(/invalid SVG color/);
    }

    const badTheme = structuredClone(theme) as Theme;
    badTheme.color.background = 'white" onload="alert(1)';
    expect(() => renderSvg(laid.geometry, badTheme)).toThrow(/invalid SVG color/);

    const badToken = structuredClone(laid.geometry) as Geometry;
    (badToken.scene.find((node) => node.t === 'rect') as Extract<SceneNode, { t: 'rect' }>).fill = {
      token: 'ink" onclick="alert(1)',
    } as never;
    expect(() => renderSvg(badToken, theme)).toThrow(/invalid SVG paint token/);

    const badTint = structuredClone(laid.geometry) as Geometry;
    (badTint.scene.find((node) => node.t === 'rect') as Extract<SceneNode, { t: 'rect' }>).fill = {
      token: 'neutral',
      tint: 2,
    };
    expect(() => renderSvg(badTint, theme)).toThrow(/invalid SVG paint tint/);

    const badNumber = structuredClone(laid.geometry) as Geometry;
    (badNumber.scene.find((node) => node.t === 'rect') as Extract<SceneNode, { t: 'rect' }>).rect.x =
      Number.POSITIVE_INFINITY;
    expect(() => renderSvg(badNumber, theme)).toThrow(/invalid SVG numeric/);

    const pathGeometry = structuredClone(layoutFixture('line').geometry) as Geometry;
    const path = pathGeometry.scene.find((node) => node.t === 'path') as Extract<SceneNode, { t: 'path' }>;
    path.d = 'M0 0" onload="globalThis.pwned=1';
    const escaped = renderSvg(pathGeometry, theme);
    expect(escaped).toContain('&quot; onload=&quot;');
    const parsed = domFor(escaped).window.document;
    expect(parsed.querySelector('script')).toBeNull();
    expect(parsed.querySelector('[onload]')).toBeNull();
  });

  it('rejects a schema-valid hostile fill before raw SVG is written', () => {
    const directory = mkdtempSync(join(tmpdir(), 'boardplot-interactive-hostile-'));
    temporaryDirectories.push(directory);
    const docPath = join(directory, 'hostile.json');
    writeFileSync(
      docPath,
      JSON.stringify({
        version: 1,
        charts: [
          {
            name: 'hostile',
            type: 'column',
            data: {
              categories: [{ id: 'q1', label: 'Q1' }],
              series: [
                {
                  id: 'actual',
                  label: 'Actual',
                  fill: '#fff"/><script>globalThis.pwned=1</script><rect fill="#fff',
                  values: [10],
                },
              ],
            },
          },
        ],
      }),
    );
    captureConsole();
    expect(main(['render', docPath, '-o', join(directory, 'hostile.svg')])).toBe(1);
    expect(existsSync(join(directory, 'hostile.svg'))).toBe(false);
  });
});
