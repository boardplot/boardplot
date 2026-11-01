// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { GridChart } from '../src/react/charts/grid';
import { computeMetricStack } from '../src/core/charts/grid/metricStack';
import { metricStackFixtures } from '../src/core/charts/grid/metricStackFixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const categories = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map(label => ({ id: label.toLowerCase(), label }));
const data = {
  categories,
  measures: [
    { id: 'started', label: 'Started', values: [800, 1000, 1100, 900, 950, 1020] },
    { id: 'finished', label: 'Finished', values: [160, 170, 121, 150, 140, 160] },
  ],
  panels: [
    { id: 'volume', type: 'column', title: 'Started', unit: 'cases per month', measure: { sum: ['started'] }, readout: 'change' },
    { id: 'rate', type: 'line', title: 'Completion', unit: '% of started cases', measure: { numerator: ['finished'], denominator: 'started' }, readout: 'change' },
  ],
  windows: { base: { from: 'jan', to: 'feb', label: 'Jan–Feb' }, compare: { from: 'may', to: 'jun', label: 'May–Jun' } },
};
const body = (options: object) => render({ spec: { type: 'grid', data, options: { stack: {}, title: 'Starts rise', ...options } } }).body as { ok: boolean; errors?: { code: string; fix?: unknown[] }[] };

it('draws a metric stack on a 320 px card with each readout above its panel', () => {
  expect(body({ size: { width: 320 } }).ok).toBe(true);
  const svg = render({ spec: { type: 'grid', data, options: { stack: {}, title: 'Starts rise', size: { width: 320 } } }, return: ['svg'] }).body as { svg: string };
  expect(svg.svg).toContain('Starts rise');
  expect(svg.svg).toContain('cases per month');
});

it('refuses a plot height under its floor with a coded fix, in React as in the CLI', async () => {
  const options = { stack: { heights: [40, 40] }, size: { width: 900 } };
  expect(body(options).errors?.[0]).toMatchObject({ code: 'metric-stack-spacing', fix: [{ op: 'replace', path: '/options/stack/heights/0' }] });
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(createElement(GridChart as never, { data, ...options })));
  await act(async () => { await new Promise(done => setTimeout(done, 50)); });
  expect(host.querySelector('[data-bp-refused]')?.getAttribute('data-bp-refused')).toBe('metric-stack-spacing');
  act(() => root.unmount());
});

it('prints a change span in the unit of its marks, with the divide step in its claims', () => {
  const panel = { ...data.panels[0]!, divisor: 1000, decimals: 1 };
  const readout = computeMetricStack({ ...data, panels: [panel, data.panels[1]!] } as never).panels[0]!.readout;
  // Jan–Feb averages 900, May–Jun 985: the bars read 0.9 and 1.0 thousand, so the span does too.
  expect(readout.spanText).toBe('0.9 → 1.0');
  const claim = (key: string) => readout.claims.find(c => c.id === `stack:volume:${key}`)!;
  expect(claim('before:scaled')).toMatchObject({ op: 'ratio@1', inputs: [{ value: 900 }, { ref: 'divisor', value: 1000 }], output: { raw: 0.9 } });
  expect(claim('after')).toMatchObject({ op: 'round-decimals@1', inputs: [{ ref: 'stack:volume:after:scaled' }, { value: 1 }], output: { raw: 1, displayed: '1.0' } });
});

// Guards the 320 px refusal ("needs at least 448px") and an engine note added for the thinning.
it('thins values and names to every second category plus the latest value where a card is too narrow, and writes no note', () => {
  const months = Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, label: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'][i]! }));
  const thin = {
    categories: months,
    measures: [
      { id: 'started', label: 'Started', values: months.map((_, i) => 100 + i * 7) },
      { id: 'finished', label: 'Finished', values: months.map((_, i) => i === 12 ? null : i === 11 ? 12 : 13 - i) },
    ],
    panels: [
      { id: 'volume', type: 'column', title: 'Started', unit: 'cases', measure: { sum: ['started'] }, readout: 'change' },
      { id: 'rate', type: 'line', title: 'Completion', unit: '%', measure: { numerator: ['finished'], denominator: 'started' }, readout: 'change' },
    ],
    windows: { base: { from: 'm0', to: 'm2', label: 'Q1' }, compare: { from: 'm6', to: 'm8', label: 'Q3' } },
  };
  const svgAt = (width: number) => (render({ spec: { type: 'grid', data: thin, options: { stack: {}, size: { width } } }, return: ['svg'] }).body as { svg: string }).svg;
  const shown = (svg: string, panel: string) => months.filter(m => svg.includes(`data-id="label:${panel}:value:${m.id}"`)).map(m => m.id);
  const wide = svgAt(480);
  expect(shown(wide, 'volume')).toHaveLength(13);
  const narrow = svgAt(320);
  // Counted back from the latest category. The rate's latest value (m11) always shows;
  // its neighbour m10 yields because the steep last segment crosses its slot. n/a stays at m12.
  expect(shown(narrow, 'volume')).toEqual(['m0', 'm2', 'm4', 'm6', 'm8', 'm10', 'm12']);
  expect(shown(narrow, 'rate')).toEqual(['m0', 'm2', 'm4', 'm6', 'm8', 'm11', 'm12']);
  expect(narrow.match(/data-part="categoryTick"/g)).toHaveLength(6);
  expect(narrow).not.toMatch(/every second/i);
});

// A phone card under the width that places every value threw metric-stack-spacing with no size to ask for.
it('refuses a 286 px phone card with the width that places every value, and draws at that width', () => {
  const fixture = metricStackFixtures.find(f => f.id === 'metric-stack-volume')!;
  const at = (width: number) => render({ spec: { type: 'grid', data: fixture.data, options: { ...fixture.options, size: { width } } } }).body as { ok: boolean; errors?: { code: string; fix?: { value: unknown }[] }[] };
  expect(at(300).ok).toBe(true);
  const refused = at(286).errors?.[0];
  expect(refused).toMatchObject({ code: 'size-below-floor', fix: [{ value: { width: 289 } }] });
  expect(at(289).ok).toBe(true);
});

it('rounds a rate span once, from the unrounded window rate, at the panel decimals', () => {
  // Jan–Feb: 149 of 10,000 is 1.49%; May–Jun: 12,345 of 100,000 is 12.345%.
  const rates = {
    categories: data.categories,
    measures: [
      { id: 'started', label: 'Started', values: [5000, 5000, 1000, 1000, 50000, 50000] },
      { id: 'finished', label: 'Finished', values: [70, 79, 10, 10, 6170, 6175] },
    ],
    panels: [data.panels[0]!, { ...data.panels[1]!, decimals: 0 }],
    windows: data.windows,
  };
  expect(computeMetricStack(rates as never).panels[1]!.readout.spanText).toBe('1% → 12%');
  const two = computeMetricStack({ ...rates, panels: [data.panels[0]!, { ...data.panels[1]!, decimals: 2 }] } as never).panels[1]!.readout;
  expect(two.spanText).toBe('1.49% → 12.35%');
  expect(two.claims.find(c => c.id === 'stack:rate:after')).toMatchObject({ op: 'round-decimals@1', inputs: [{ ref: 'stack:rate:compare:raw' }, { value: 2 }] });
});

// Guards a refusal at every width: a panel key whose measure labels are wider than the 320 px gutter cap used to be unbreakable.
it('wraps long panel-key labels to the key width instead of refusing', () => {
  const long = {
    ...data,
    measures: [
      { id: 'kept', label: 'Cases still retained after the full observation window', values: [500, 600, 640, 520, 560, 610] },
      { id: 'lost', label: 'Cases no longer retained after the full observation window', values: [300, 400, 460, 380, 390, 410] },
      data.measures[1]!,
    ],
    panels: [{ ...data.panels[0]!, measure: { sum: ['kept', 'lost'] } }, { ...data.panels[1]!, measure: { numerator: ['finished'], denominator: 'kept' } }],
  };
  const body = render({ spec: { type: 'grid', data: long, options: { stack: {}, size: { width: 900 } } }, return: ['svg'] }).body as { ok: boolean; svg?: string };
  expect(body.ok).toBe(true);
  expect(body.svg).not.toContain('…');
});

// Guards an ellipsis cut: a key label with one word wider than the key area lost its full name.
// The character break also lost the authored newline and split words a no-break space joins.
it('breaks a key word wider than its area between characters and keeps every character', () => {
  const word = 'Customersatisfactionsurveyparticipantfeedbackresponsecompletionrate';
  const compound = { ...data, measures: [{ id: 'kept', label: `Kept 12\u00A0k\n${word}`, values: [500, 600, 640, 520, 560, 610] }, { id: 'lost', label: 'Lost', values: [300, 400, 460, 380, 390, 410] }, data.measures[1]!],
    panels: [{ ...data.panels[0]!, measure: { sum: ['kept', 'lost'] } }, { ...data.panels[1]!, measure: { numerator: ['finished'], denominator: 'kept' } }] };
  const body = render({ spec: { type: 'grid', data: compound, options: { stack: {}, size: { width: 900 } } }, return: ['svg'] }).body as { ok: boolean; svg: string };
  expect(body.ok).toBe(true);
  expect(body.svg).not.toContain('…');
  const label = body.svg.match(/data-id="label:volume:key:kept:label"[^>]*>(.*?)<\/text>/)![1]!;
  const lines = [...label.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(m => m[1]).filter(line => line !== ' ');
  expect(lines[0]).toBe('Kept 12\u00A0k');
  const broken = lines.slice(1);
  expect(broken.length).toBeGreaterThan(1);
  // Each line the word breaks off ends with a hyphen; without them the lines spell the word.
  expect(broken.slice(0, -1).every(line => line!.endsWith('-'))).toBe(true);
  expect(broken.map(line => line!.replace(/-$/, '')).join('')).toBe(word);
});

// A provisional stacked column in a grey theme drew both segments' stripes on one grey (notation-dark #606060 and #5E5E5E); notation-dark has no golden.
it('keeps the stripes of a hatched stack a grey step apart in notation and notation-dark', async () => {
  const { getFixtures } = await import('../src/fixtures');
  const { palettePerceptualDistance } = await import('../src/core/themeRules');
  const fixture = getFixtures('grid').find(f => f.id === 'metric-stack-volume')!;
  for (const theme of ['notation', 'notation-dark']) {
    const { svg } = render({ spec: { type: 'grid', data: fixture.data, options: { ...fixture.options, theme, size: { width: 480 } } }, return: ['svg'] }).body as { svg: string };
    const stripes = [...new Set([...svg.matchAll(/<pattern [^>]*>.*?stroke="([^"]+)".*?<\/pattern>/g)].map(m => m[1]!))];
    const apart = Math.max(...stripes.flatMap(a => stripes.map(b => palettePerceptualDistance(a, b, 'normal'))));
    expect(apart, `${theme}: ${stripes.join(' ')}`).toBeGreaterThanOrEqual(24);
  }
});
