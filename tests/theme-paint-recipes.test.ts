import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { repaintGeometry } from '../src/core/repaintGeometry';
import { resolvePaint } from '../src/core/svg/paint';
import { getFixtures } from '../src/fixtures';
import { listCharts } from '../src/core/registry';
import { groundTextPaint, paintColor, paintTokenColor, resolveTheme } from '../src/core/theme';
import { compositeColor, contrastRatio } from '../src/core/color';
import { marksOnBands } from '../src/core/markVisibility';
import { markLostOnBandWarnings, refreshPaintWarnings } from '../src/core/paintWarnings';
import type { Paint, SceneNode } from '../src/core/types/scene';

const dark = resolveTheme('standard-dark');

// This covers composite adapters as well as direct chart layouts. A cached
// light scene must retain enough information to reproduce a fresh dark scene.
describe('repaints all demo fixtures without changing layout or derived values', () => {
  const visibleScene = (scene: SceneNode[]) => scene.map(node => Object.fromEntries(
    Object.entries(node).filter(([key]) => !['separation', 'owner', 'display'].includes(key))
      .map(([key, value]) => [key, ['ink', 'fill', 'stroke'].includes(key) && value
        ? resolvePaint(value as Paint, dark) : value]),
  ));
  for (const definition of listCharts()) {
    it(definition.type, () => {
      for (const fixture of getFixtures(definition.type).filter(f => f.kind === 'example')) {
        const request = { type: definition.type, data: fixture.data, options: fixture.options, annotations: fixture.annotations };
        const source = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'standard' }));
        const target = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'standard-dark' }));
        expect(source.refused, fixture.id).toEqual(target.refused);
        if (source.refused || target.refused) continue;
        const repainted = repaintGeometry(source, dark, request.options as { palette?: string });
        expect(visibleScene(repainted.scene), fixture.id).toEqual(visibleScene(target.scene));
        expect(repainted.warnings, fixture.id).toEqual(target.warnings);
        expect(repainted.derived).toBe(source.derived);
        expect(repainted.labels).toBe(source.labels);
      }
    });
  }
});

// A light authored line over a shaded band refused the whole chart; it must draw darker, warn, and keep the warning true after a repaint.
it('draws a low-contrast authored line over a shaded band and warns', () => {
  const request = {
    type: 'line',
    data: {
      categories: ['Q1', 'Q2', 'Q3', 'Q4'].map(id => ({ id, label: id })),
      series: [{ id: 'brown', label: 'Brown', fill: '#D8C3A5', values: [4, 6, 5, 7] }],
    },
    options: { annotations: [{ kind: 'band' as const, from: 'Q2', to: 'Q3' }] },
  };
  const geometry = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'standard' }));
  const target = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'standard-dark' }));
  if (geometry.refused || target.refused) throw new Error('refused');
  expect(geometry.warnings.filter(w => w.code === 'line-band-authored-contrast')).toHaveLength(1);
  const light = resolveTheme('standard');
  const strokes = geometry.scene.flatMap(node => node.t === 'path' && node.owner?.seriesId === 'brown' && node.stroke ? [resolvePaint(node.stroke, light)] : [])
    .filter(css => css.toLowerCase() !== light.color.background.toLowerCase()); // the halo
  expect(strokes).toHaveLength(1);
  expect(Math.min(contrastRatio(strokes[0]!, light.color.background), contrastRatio(strokes[0]!, light.color.others))).toBeGreaterThanOrEqual(3.1);
  expect(repaintGeometry(geometry, dark, {}).warnings).toEqual(target.warnings);
  // Under highlightMode 'fade' the warning named the faded paint as the authored colour.
  const faded = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'standard', data: { ...request.data, series: [...request.data.series, { id: 'blue', label: 'Blue', values: [5, 7, 6, 8] }] },
    options: { ...request.options, highlight: ['blue'], highlightMode: 'fade' as const } }));
  if (faded.refused) throw new Error('refused');
  expect(faded.warnings.find(w => w.code === 'line-band-authored-contrast' && w.message.includes("'brown'"))?.message).toContain('colour #D8C3A5, faded to');
});

// a plain stack series next to an authored highlight took a near-identical blue and the two segments read as one.
it('a plain stack series skips a palette step that is not apart from an authored colour in its stack', () => {
  const geo = layoutResolvedRequest(resolveChartRequest({ type: 'column', theme: 'standard', data: { categories: [{ id: 'q1' }, { id: 'q2' }], series: [
    { id: 'a', label: 'Core', values: [40, 42] }, { id: 'b', label: 'New', colorRole: 'highlight', values: [10, 14] }, { id: 'c', label: 'Other', values: [20, 18] },
  ] }, options: { title: 'Core grows', variant: 'stacked100' } } as never));
  if (geo.refused) throw new Error('refused');
  const fill = (id: string) => resolvePaint((geo.scene.find(n => n.id === `mark:${id}:q1`) as { fill: Paint }).fill, resolveTheme('standard'));
  expect(fill('a')).not.toBe('#075A8E');
  expect(geo.warnings.map(w => w.code)).not.toContain('series-adjacent-similar');
});

// A five-part 100% stack in the default theme warned that the theme's own stack ramp was too close.
it('holds a theme stack ramp to the ordered step, not the categorical floors', () => {
  const series = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, label: id, values: [30 - 5 * i, 32 - 5 * i] }));
  const geo = layoutResolvedRequest(resolveChartRequest({ type: 'column', theme: 'boardroom', data: { categories: [{ id: 'q1' }, { id: 'q2' }], series },
    options: { title: 'Share', variant: 'stacked100' } } as never));
  if (geo.refused) throw new Error('refused');
  expect(geo.warnings.map(w => w.code)).not.toContain('series-adjacent-similar');
});

// an Others segment inside a band drew in the band's own fill and vanished without a word.
// The presets give Others its own step now, so the case is an author-set Others equal to the band.
it('warns when a mark has the fill of the band behind it, and keeps the fill', () => {
  const geo = layoutResolvedRequest(resolveChartRequest({ type: 'column', theme: { preset: 'standard', overrides: { color: { othersMark: '#EDF0F3' } } }, data: { categories: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }], series: [
    { id: 'a', label: 'Core', values: [40, 42, 45] }, { id: 'o', label: 'Other', colorRole: 'others', values: [20, 18, 16] },
  ] }, options: { title: 'Core grows', variant: 'stacked' }, annotations: [{ kind: 'band', from: 'm2', to: 'm3', label: 'Campaign' }] } as never));
  if (geo.refused) throw new Error('refused');
  expect(geo.warnings.filter(w => w.code === 'mark-lost-on-band').map(w => w.owner?.seriesId)).toEqual(['o']);
});

// Visible stripes and outlines must prevent false band warnings, while invisible patterns must still warn after a theme change.
it('judges the visible stripes and outlines of marks on a band', () => {
  const theme = resolveTheme('standard');
  type Rect = Extract<SceneNode, { t: 'rect' }>;
  const band: Rect = { t: 'rect', id: 'band', part: 'band', owner: { annotationId: 'band' }, rect: { x: 0, y: 0, w: 100, h: 100 }, fill: { token: 'background' } };
  const mark: Rect = { t: 'rect', id: 'mark:s:a', part: 'bar', owner: { seriesId: 's', categoryId: 'a' }, rect: { x: 10, y: 10, w: 20, h: 30 },
    fill: { token: 'background' }, separation: { fill: { token: 'background' }, backing: { token: 'background' } } };
  const cases: [Partial<Rect>, boolean][] = [
    [{ pattern: 'hatch45', hatchGround: band.fill, hatchEdge: false }, false],
    [{ pattern: 'hatch45', fill: { css: theme.color.background }, hatchGround: band.fill, hatchEdge: false }, true],
    [{ pattern: 'crosshatch', fill: { css: theme.color.background }, hatchGround: band.fill, hatchEdge: false }, true],
    [{ stroke: { token: 'ink' }, strokeWidth: 1 }, false],
    [{ stroke: { token: 'ink' }, strokeWidth: 0 }, true],
    [{ pattern: 'hollow', fill: { token: 'ink' } }, false],
    [{ pattern: 'hollow' }, true],
  ];
  for (const [paints, lost] of cases) {
    const pairs = marksOnBands([band, { ...mark, ...paints }]);
    expect(markLostOnBandWarnings(theme, pairs), JSON.stringify(paints)).toHaveLength(lost ? 1 : 0);
  }
  // Identical base fills with different patterns must not collapse to the first mark's warning decision.
  const mixed = marksOnBands([band, { ...mark, pattern: 'hatch45', hatchGround: band.fill, hatchEdge: false }, { ...mark, id: 'mark:s:b' }]);
  expect(markLostOnBandWarnings(theme, mixed)).toHaveLength(1);
  const pairs = marksOnBands([band, { ...mark, ...cases[1]![0] }]);
  const rules = [{ kind: 'mark-lost-on-band' as const, pairs, before: 0 }];
  const inkHatch = { ...theme, pattern: { ...theme.pattern, hatchColor: 'ink' as const } };
  expect(refreshPaintWarnings(markLostOnBandWarnings(theme, pairs), rules, inkHatch)).toEqual([]);
});

// Alpha series fills must choose label ink against the visible colour, including on a paint-only repaint.
it('reads inside labels on translucent series fills', () => {
  const request = { type: 'column', data: { categories: [{ id: 'a' }], series: [{ id: 's', fill: 'rgba(0,0,0,0.04)', values: [100] }] }, options: { size: { width: 480, height: 300 }, labelPlacements: { 'point:s:a': 'insideEnd' }, legend: 'none' } };
  const source = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'standard' } as never));
  if (source.refused) throw new Error('refused');
  for (const preset of ['standard', 'standard-dark']) {
    const theme = resolveTheme(preset);
    const geometry = repaintGeometry(source, theme, {});
    const text = geometry.scene.find(n => n.t === 'text' && n.owner?.seriesId === 's' && n.id === 'label:point:s:a') as Extract<SceneNode, { t: 'text' }> | undefined;
    expect(text).toBeDefined();
    const ground = compositeColor('rgba(0,0,0,0.04)', theme.color.background);
    expect(contrastRatio(resolvePaint(text!.ink, theme), ground)).toBeGreaterThanOrEqual(4.5);
  }
});

// Scene paints are caller data: a recipe edited in place must not keep the ink cached for its old ground.
it('re-picks a ground-text ink after its recipe is edited in place', () => {
  const theme = resolveTheme('standard');
  const ground: { css: string } = { css: '#eeeeee' };
  const ink = groundTextPaint({ token: 'ink' }, ground);
  expect(contrastRatio(paintColor(theme, ink), '#eeeeee')).toBeGreaterThanOrEqual(4.5);
  ground.css = '#000000';
  expect(paintColor(theme, ink)).toBe(paintColor(theme, structuredClone(ink)));
  expect(contrastRatio(paintColor(theme, ink), '#000000')).toBeGreaterThanOrEqual(4.5);
});

// The bullet bar was a mid grey with a white box round it on dark bands: it paints in the mark ink, keeps an
// outline only where it misses 3:1 on a band it lies on, draws the target in the data stroke, and bolds names and values.
it('paints the bullet bar in the mark ink and outlines it only below 3:1 on the bands under it', () => {
  const five = [{ to: 10 }, { to: 20 }, { to: 30 }, { to: 40 }, { to: 50 }];
  const request = {
    type: 'bullet',
    data: { rows: [
      { id: 'four', label: 'Four bands', value: 32, target: 35, bands: [{ to: 10, label: 'Poor' }, { to: 20, label: 'Fair' }, { to: 30, label: 'Good' }, { to: 40, label: 'Leading' }] },
      { id: 'five', label: 'Five bands', value: 32, target: 35, bands: five },
      { id: 'light', label: 'Light end only', value: 8, target: 9, bands: five, direction: 'lowerIsBetter' as const },
    ] },
    options: { sharedScale: true, footnotes: ['Bands run from dark (poor) to light (good).'] },
  };
  const geometry = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'boardroom' }));
  if (geometry.refused) throw new Error('refused');
  const theme = resolveTheme('boardroom');
  const node = (id: string) => geometry.scene.find(n => n.id === id)!;
  const bar = (id: string) => node(`bar:${id}`) as Extract<SceneNode, { t: 'rect' }>;
  expect(resolvePaint(bar('four').fill, theme)).toBe(paintColor(theme, { token: 'markInk' }));
  expect(bar('four').stroke).toBeUndefined();
  expect(bar('five').stroke).toBeUndefined();
  expect(bar('light').stroke).toBeUndefined();
  // The full band fill steps the five bands 0.12 apart: the darkest misses 3:1 under the bar.
  const full = layoutResolvedRequest(resolveChartRequest({ ...request, theme: { preset: 'boardroom', overrides: { marks: { bulletBandFill: 'full' } } } }));
  if (full.refused) throw new Error('refused');
  expect((full.scene.find(n => n.id === 'bar:five') as Extract<SceneNode, { t: 'rect' }>).stroke).toBeDefined();
  expect((node('target:four') as Extract<SceneNode, { t: 'line' }>).width).toBe(2);
  const weight = (id: string) => (node(id) as Extract<SceneNode, { t: 'text' }>).font.weight;
  expect(weight('label:category:four')).toBe(600);
  expect(weight('label:point:four')).toBe(700);
});

// The site's hero chart drew a light box round every pale segment on a dark page only, which read as a selection.
it('draws no outline round a pale segment on a dark page unless marks.contrastEdge is true', () => {
  const fixture = getFixtures('column').find(f => f.id === 'integrated-stacked-variance')!;
  const outlined = (contrastEdge?: boolean) => {
    const theme = contrastEdge ? { preset: 'standard-dark', overrides: { marks: { contrastEdge } } } : 'standard-dark';
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data: fixture.data, options: fixture.options, annotations: fixture.annotations, theme }));
    if (geometry.refused) throw new Error('refused');
    return geometry.scene.filter(node => node.t === 'rect' && node.part === 'segment' && (node.strokeWidth ?? 0) > 0).length;
  };
  expect(outlined()).toBe(0);
  expect(outlined(true)).toBeGreaterThan(0);
});

// The grid's own swatch pass re-judged a themed child panel's key swatches in the grid's theme and dropped their hairlines.
it('keeps a themed grid panel swatch hairline decided in the panel theme', () => {
  const funnel = getFixtures('funnel').find(f => f.id === 'lead-funnel')!;
  const theme = { preset: 'standard-dark', overrides: { marks: { contrastEdge: true } } };
  const data = { ...funnel.data, series: (funnel.data as { series: object[] }).series.map(series => ({ ...series, fill: '#203040' })) };
  const panel = { id: 'p', type: 'funnel', data, options: { ...funnel.options, theme } };
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'grid', data: { panels: [panel] }, options: {}, theme: 'standard' }));
  if (geometry.refused) throw new Error('refused');
  const swatches = geometry.scene.filter(node => node.t === 'rect' && node.part === 'labelSwatch');
  expect(swatches.some(node => node.t === 'rect' && (node.strokeWidth ?? 0) > 0)).toBe(true);
});

// A faded Others area lost its dark-page outline and drew at 1.24:1 on the page.
it('keeps a faded Others area at the page floor on a dark page', () => {
  const request = {
    type: 'line',
    data: {
      categories: ['Q1', 'Q2', 'Q3'].map(id => ({ id, label: id })),
      series: [{ id: 'a', label: 'Alpha', values: [60, 50, 60] }, { id: 'o', label: 'Other', colorRole: 'others', values: [40, 50, 40] }],
    },
    options: { variant: 'stacked100-area', highlight: ['a'], highlightMode: 'fade' },
  };
  const geometry = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'standard-dark' }));
  if (geometry.refused) throw new Error('refused');
  const fills = geometry.scene.filter(node => node.t === 'path' && node.owner?.seriesId === 'o' && node.fill)
    .map(node => paintColor(dark, (node as { fill: Paint }).fill));
  expect(fills.length).toBeGreaterThan(0);
  for (const css of fills) expect(contrastRatio(css, dark.color.background)).toBeGreaterThanOrEqual(1.4);
});

// With no outline round a fill, a pale fill is the page: each recipe holds its own light-page floor too.
const light = resolveTheme('standard');

it('keeps the palest pie slice at the page floor on a light page', () => {
  const fixture = getFixtures('pie').find(f => f.id === 'ten-tiny-slices')!;
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'pie', data: fixture.data, options: fixture.options, theme: 'standard' }));
  if (geometry.refused) throw new Error('refused');
  const slices = geometry.scene.filter(node => node.t === 'path' && node.part === 'slice' && node.fill && !node.pattern);
  expect(slices.length).toBeGreaterThan(0);
  for (const node of slices) expect(contrastRatio(paintColor(light, (node as { fill: Paint }).fill), light.color.background)).toBeGreaterThanOrEqual(1.4);
});

it('keeps a faded Others area at the page floor on a light page', () => {
  const request = {
    type: 'line',
    data: {
      categories: ['Q1', 'Q2', 'Q3'].map(id => ({ id, label: id })),
      series: [{ id: 'a', label: 'Alpha', values: [60, 50, 60] }, { id: 'o', label: 'Other', colorRole: 'others', values: [40, 50, 40] }],
    },
    options: { variant: 'stacked100-area', highlight: ['a'], highlightMode: 'fade' },
  };
  const geometry = layoutResolvedRequest(resolveChartRequest({ ...request, theme: 'standard' }));
  if (geometry.refused) throw new Error('refused');
  const fills = geometry.scene.filter(node => node.t === 'path' && node.owner?.seriesId === 'o' && node.fill)
    .map(node => paintColor(light, (node as { fill: Paint }).fill));
  expect(fills.length).toBeGreaterThan(0);
  for (const css of fills) expect(contrastRatio(css, light.color.background)).toBeGreaterThanOrEqual(1.4);
});

it('gives the Others mark and the rest mark a colour that reads against a light page without an outline', () => {
  expect(contrastRatio(paintTokenColor(light, 'othersMark'), light.color.background)).toBeGreaterThanOrEqual(1.4);
  expect(contrastRatio(paintTokenColor(light, 'rest'), light.color.background)).toBeGreaterThanOrEqual(1.4);
});

// A highlighted funnel row stands on a tint; its pale "open" segment and key swatch were lost in it.
it('keeps a hairline on a funnel segment and key swatch that read under 1.4:1 on the highlighted row', () => {
  const fixture = getFixtures('funnel').find(f => f.id === 'lead-funnel')!;
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'funnel', data: fixture.data, options: fixture.options, theme: 'notation-dark' }));
  if (geometry.refused) throw new Error('refused');
  const width = (id: string) => (geometry.scene.find(node => node.id === id) as { strokeWidth?: number } | undefined)?.strokeWidth;
  expect(width('mark:offer:open')).toBeGreaterThan(0);
  expect(width('swatch:segment:offer:open')).toBeGreaterThan(0);
});

// The second measure of a stacked metric panel washed toward the page and drew at 1.31:1 on notation-dark, with no outline.
it('keeps a stacked metric panel measure at the page floor on notation-dark', () => {
  const fixture = getFixtures('grid').find(f => f.id === 'metric-stack-volume')!;
  const theme = resolveTheme('notation-dark');
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'grid', data: fixture.data, options: fixture.options, theme: 'notation-dark' }));
  if (geometry.refused) throw new Error('refused');
  const bars = geometry.scene.filter(node => node.t === 'rect' && node.part === 'segment' && String(node.id).startsWith('completed:bar:') && node.fill && !node.pattern);
  expect(bars.length).toBeGreaterThan(0);
  for (const node of bars) expect(contrastRatio(paintColor(theme, (node as { fill: Paint }).fill), theme.color.background)).toBeGreaterThanOrEqual(1.4);
});

// A highlighted grouped bar stands on a row tint; its Others bar read 1.25:1 against it with no outline.
it('keeps a hairline on an Others bar that reads under 1.4:1 on its highlighted row', () => {
  const request = {
    type: 'bar',
    data: {
      categories: ['a', 'b'].map(id => ({ id, label: id })),
      series: [{ id: 'main', label: 'Main', values: [40, 30] }, { id: 'other', label: 'Other', colorRole: 'others', values: [20, 10] }],
    },
    options: { variant: 'grouped', highlight: ['a'] },
    theme: 'standard',
  };
  const geometry = layoutResolvedRequest(resolveChartRequest(request as never));
  if (geometry.refused) throw new Error('refused');
  const bar = geometry.scene.find(node => node.t === 'rect' && node.owner?.seriesId === 'other' && node.owner?.categoryId === 'a') as { strokeWidth?: number } | undefined;
  expect(bar?.strokeWidth).toBeGreaterThan(0);
});

it('keeps the outline of a Plan stack on a highlighted category', () => {
  // The ground hairline slot once replaced any ink stroke, so highlighting a Plan category dropped its outline (width 1.5 to 0).
  const request = {
    type: 'column',
    data: {
      categories: ['a', 'b'].map(id => ({ id, label: id })),
      series: [{ id: 's1', label: 'One', values: [{ number: 5, scenario: 'PL' }, { number: 6 }] }, { id: 's2', label: 'Two', values: [{ number: 3, scenario: 'PL' }, { number: 4 }] }],
    },
    options: { variant: 'stacked', highlight: 'a' },
    theme: 'standard',
  };
  const geometry = layoutResolvedRequest(resolveChartRequest(request as never));
  if (geometry.refused) throw new Error('refused');
  const plan = geometry.scene.find(node => node.t === 'rect' && node.owner?.seriesId === 's1' && node.owner?.categoryId === 'a') as { strokeWidth?: number } | undefined;
  expect(plan?.strokeWidth).toBe(resolveChartRequest(request as never).theme.pattern.outlineStrokeWidth);
});

// Two series with one colour role drew in one grey, so the reader could tell them apart only by their order.
it('draws series that share a colour role in distinct steps of that colour', () => {
  for (const type of ['bar', 'column'] as const) {
    for (const theme of ['standard', 'standard-dark']) {
      const geo = layoutResolvedRequest(resolveChartRequest({ type, theme, data: { categories: [{ id: 'n' }, { id: 's' }], series: [
        { id: 'plan', label: 'Plan', colorRole: 'neutral', values: [40, 30] },
        { id: 'py', label: 'Prior year', colorRole: 'neutral', values: [35, 32] },
        { id: 'ac', label: 'Actual', values: [42, 28] },
      ] }, options: { title: 'Actual beats plan', variant: 'grouped' } } as never));
      if (geo.refused) throw new Error('refused');
      const fill = (id: string) => resolvePaint((geo.scene.find(n => n.id === (type === 'bar' ? `mark:n:${id}` : `mark:${id}:n`)) as { fill: Paint }).fill, resolveTheme(theme));
      expect(fill('plan'), `${type} ${theme}`).not.toBe(fill('py'));
      expect(geo.warnings.map(w => w.code), `${type} ${theme}`).not.toContain('series-indistinguishable');
    }
    // A plain series must skip the step colour a role series draws, not the role's full colour.
    const stepped = layoutResolvedRequest(resolveChartRequest({ type, theme: { preset: 'standard', overrides: { color: { series: ['#075A8E', '#55BEF7', '#99a0a8', '#838CDA'] } } },
      data: { categories: [{ id: 'n' }, { id: 's' }], series: [
        { id: 'plan', label: 'Plan', colorRole: 'neutral', values: [40, 30] },
        { id: 'py', label: 'Prior year', colorRole: 'neutral', values: [35, 32] },
        { id: 'ac', label: 'Actual', values: [42, 28] },
      ] }, options: { title: 'Actual beats plan', variant: 'grouped' } } as never));
    if (stepped.refused) throw new Error('refused');
    expect(stepped.warnings.map(w => w.code), `${type} custom series`).not.toContain('series-indistinguishable');
  }
});

// Scenario series took their rank colour, so a prior year listed first painted darker than the actual and the look changed with series order.
it.each(['column', 'bar'] as const)('paints scenario %s series from the actual, whatever the series order', (type) => {
  const series = {
    ac: { id: 'ac', label: 'Actual', scenario: 'AC' as const, values: [101, 108, null] },
    py: { id: 'py', label: 'Prior year', scenario: 'PY' as const, values: [90, 101, null] },
    pl: { id: 'pl', label: 'Plan', scenario: 'PL' as const, values: [104, 112, 120] },
    fc: { id: 'fc', label: 'Forecast', scenario: 'FC' as const, values: [null, null, 117] },
  };
  for (const theme of ['boardroom', 'standard', 'standard-dark', 'notation', 'notation-dark', 'capital', 'studio', 'glass']) {
    const resolved = resolveTheme(theme);
    const paints = (order: (keyof typeof series)[]) => {
      const geometry = layoutResolvedRequest(resolveChartRequest({
        type,
        theme,
        data: { categories: ['y1', 'y2', 'y3'].map(id => ({ id, label: id })), series: order.map(key => series[key]) },
        options: { variant: 'grouped' },
      }));
      if (geometry.refused) throw new Error('refused');
      // The cell's base colour, before its pattern: PL outlines it and FC hatches it.
      const paint = (id: string) => {
        const node = geometry.scene.find((n): n is Extract<SceneNode, { t: 'rect' }> => n.t === 'rect' && n.owner?.seriesId === id && !!n.owner.categoryId && !!n.fill);
        return node?.fill ? resolvePaint(node.fill, resolved) : undefined;
      };
      return { ac: paint('ac'), py: paint('py'), pl: paint('pl'), fc: paint('fc') };
    };
    const acFirst = paints(['ac', 'py', 'pl', 'fc']);
    expect(paints(['py', 'ac', 'pl', 'fc']), theme).toEqual(acFirst);
    // FC may lift off a dark page's floor, so only PL is held to the actual's exact colour.
    expect(acFirst.pl, theme).toBe(acFirst.ac);
    expect(acFirst.py, theme).not.toBe(acFirst.ac);
  }
});

// Pairing a scenario with its actual must never give two unpatterned columns one colour: an authored PY fill and a stacked PY segment stay apart.
it('keeps scenario columns apart from an authored fill and in a stack', () => {
  const resolved = resolveTheme('standard');
  const fills = (variant: 'grouped' | 'stacked', series: { id: string; label: string; scenario?: 'AC' | 'PY'; fill?: string; values: number[] }[]) => {
    const geometry = layoutResolvedRequest(resolveChartRequest({
      type: 'column', theme: 'standard',
      data: { categories: ['y1', 'y2'].map(id => ({ id, label: id })), series },
      options: { variant },
    }));
    if (geometry.refused) throw new Error('refused');
    return series.map(s => {
      const node = geometry.scene.find((n): n is Extract<SceneNode, { t: 'rect' }> => n.t === 'rect' && n.owner?.seriesId === s.id && !!n.owner.categoryId && !!n.fill);
      return node?.fill ? resolvePaint(node.fill, resolved) : undefined;
    });
  };
  const [ac, py] = fills('grouped', [{ id: 'ac', label: 'Actual', values: [3, 4] }, { id: 'py', label: 'Prior year', scenario: 'PY', fill: '#075A8E', values: [2, 3] }]);
  expect(ac).not.toBe(py);
  const stack = fills('stacked', [{ id: 'a', label: 'North', values: [3, 4] }, { id: 'b', label: 'South', values: [2, 2] }, { id: 'py', label: 'Prior year', scenario: 'PY', values: [1, 2] }]);
  expect(new Set(stack).size).toBe(3);
});
