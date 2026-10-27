/**
 * A running (partial) period says "to date" on its own value (combo, column, bar, line, variance), so a part-week
 * total never reads as a miss against a full-week plan; the hatch then needs no key,
 * and the plan's end value sits centred under its marker at every width.
 */
import { describe, expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { measure } from '../src/index';

const geometry = (width: number, labels?: unknown, last: unknown = 50): any => (measure({
  type: 'combo',
  data: {
    categories: [{ id: 'a', label: 'W1' }, { id: 'b', label: 'W2' }, { id: 'c', label: 'W3' }, { id: 'd', label: 'W4', partial: true }],
    series: [
      { id: 'orders', label: 'Orders', values: [100, 110, 120, last] },
      { id: 'plan', label: 'Plan', kind: 'line', values: [90, 95, 100, 105] },
    ],
  },
  options: { title: 'Orders beat plan', legend: 'bottom', size: { width }, ...(labels ? { labels } : {}) },
} as never) as any).geometry;

const nodes = (g: any): any[] => {
  const out: any[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.t === 'string') out.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) walk(value);
  };
  walk(g.scene);
  return out;
};

describe('combo partial column', () => {
  it('says "to date" on the running total, keys no hatch, seats the plan end under its marker and prints an 11 px card key', () => {
    const g = geometry(320);
    const all = nodes(g);
    const total = all.find(node => node.id === 'label:grandTotal:d');
    const words = all.find(node => node.id === 'label:grandTotal:d:body');
    expect(total.lines).toEqual(['50']);
    expect(words.lines).toEqual(['to date']);
    expect(words.font.size).toBeLessThan(total.font.size);
    const keys = all.filter(node => node.part === 'legendLabel');
    expect(keys.map(node => node.lines.join(' '))).toEqual(['Orders', 'Plan']);
    expect(keys.map(node => node.font.size)).toEqual([11, 11]);
    const marker = all.find(node => node.id === 'marker:plan:d');
    const end = g.labels.find((label: any) => label.id === 'point:plan:d');
    expect(Math.abs(end.rect.x + end.rect.w / 2 - marker.cx)).toBeLessThan(0.5);
    expect(end.rect.y).toBeGreaterThan(marker.cy);
  });
  it('keeps the hatch key wherever a running total does not print its words', () => {
    const keys = (g: any) => nodes(g).filter(node => node.part === 'legendLabel').map(node => node.lines.join(' '));
    // The total composes no text: an empty cell label, or total content without the value.
    expect(keys(geometry(320, undefined, { number: 50, label: '' }))).toContain('W4 to date');
    expect(keys(geometry(320, { grandTotal: ['series'] }))).toContain('W4 to date');
    // The total loses its seat on a crowded card: the layout brings the key back.
    const lane = getFixtures('combo').find((fixture: any) => fixture.id === 'weekly-events-lane') as any;
    const g = (measure({ type: 'combo', data: lane.data, options: { ...lane.options, size: { width: 320 } }, annotations: lane.annotations } as never) as any).geometry;
    expect(keys(g).some((key: string) => key.endsWith('to date'))).toBe(true);
  });
  // A second running week with only a plan value drew a hollow marker that nothing explained.
  it('keeps the hatch key when a running category has no column to carry the words', () => {
    const g = (measure({ type: 'combo', data: {
      categories: [{ id: 'a', label: 'W1' }, { id: 'b', label: 'W2' }, { id: 'c', label: 'W3', partial: true }, { id: 'd', label: 'W4', partial: true }],
      series: [{ id: 'orders', label: 'Orders', values: [100, 110, null, 50] }, { id: 'plan', label: 'Plan', kind: 'line', values: [90, 95, 100, 105] }],
    }, options: { title: 'Orders beat plan', legend: 'bottom', size: { width: 720 } } } as never) as any).geometry;
    expect(nodes(g).filter(node => node.part === 'legendLabel').map(node => node.lines.join(' '))).toContain('W3, W4 to date');
  });
  // A running last week without a column pushed the plan end under its marker, away from its main seat.
  it('keeps the main end seat when the running category has no column', () => {
    const end = (g: any) => g.labels.find((label: any) => label.id === 'point:plan:d');
    expect(end(geometry(320, undefined, null)).slot).toBe('right');
  });
});

const column = (last: unknown, options: Record<string, unknown> = {}): any => (measure({
  type: 'column',
  data: {
    categories: [{ id: 'a', label: 'W1' }, { id: 'b', label: 'W2' }, { id: 'c', label: 'W3' }, { id: 'd', label: 'W4', partial: true }],
    series: [{ id: 'orders', label: 'Orders', values: [100, 110, 120, last] }],
  },
  options: { title: 'Orders', size: { width: 320 }, ...options },
} as never) as any).geometry;

describe('column partial column', () => {
  // A part-week value without words reads as a drop; a negative one must not push its name off the row.
  it('says "to date" on the running value instead of the axis name, and keeps the axis words under a negative value', () => {
    const words = (g: any) => nodes(g).filter(node => node.id === 'label:point:orders:d:body').map(node => node.lines.join(' '));
    const names = (g: any) => g.labels.filter((label: any) => label.kind === 'category' && !label.hidden).map((label: any) => label.lines.join(' '));
    expect(words(column(50))).toEqual(['to date']);
    expect(names(column(50))).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(words(column(-50))).toEqual([]);
    expect(names(column(-50))).toEqual(expect.arrayContaining(['W4', 'to date']));
  });
});

describe('bar partial row', () => {
  // A part-week bar without words reads as a drop.
  it('says "to date" on the running value instead of the row name', () => {
    const g = (measure({
      type: 'bar',
      data: {
        categories: [{ id: 'a', label: 'W1' }, { id: 'b', label: 'W2' }, { id: 'c', label: 'W3' }, { id: 'd', label: 'W4', partial: true }],
        series: [{ id: 'orders', label: 'Orders', values: [100, 110, 120, 50] }],
      },
      options: { title: 'Orders', size: { width: 320 } },
    } as never) as any).geometry;
    expect(nodes(g).filter(node => node.id === 'label:point:orders:d:body').map(node => node.lines.join(' '))).toEqual(['to date']);
    expect(g.labels.filter((label: any) => label.kind === 'category').map((label: any) => label.lines.join(' '))).toEqual(['W1', 'W2', 'W3', 'W4']);
  });
});

describe('line partial point', () => {
  // A part-week point without words reads as a drop.
  it('says "to date" on a single line\'s running value instead of the axis name', () => {
    const g = (measure({
      type: 'line',
      data: {
        categories: [{ id: 'a', label: 'W1' }, { id: 'b', label: 'W2' }, { id: 'c', label: 'W3' }, { id: 'd', label: 'W4', partial: true }],
        series: [{ id: 'orders', label: 'Orders', values: [100, 110, 120, 50] }],
      },
      options: { title: 'Orders', size: { width: 320 } },
    } as never) as any).geometry;
    expect(nodes(g).filter(node => node.id === 'label:point:orders:d:body').map(node => node.lines.join(' '))).toEqual(['to date']);
    expect(nodes(g).some(node => node.t === 'text' && node.lines?.join(' ') === 'to date' && !String(node.id).startsWith('label:point'))).toBe(false);
  });
  // The extremes fallback dropped an interior running value after it had seated its words, leaving no cue.
  it('keeps the axis words when the extremes fallback drops the running value', () => {
    const g = (measure({
      type: 'line',
      data: {
        categories: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, label: `M${i}`, ...(i === 1 ? { partial: true } : {}) })),
        series: [{ id: 'orders', label: 'Orders', values: [72, 77, 72, 70, 15, 24] }],
      },
      options: { title: 'Orders', size: { width: 320 }, valueLabels: 'extremes' },
    } as never) as any).geometry;
    const words = nodes(g).filter(node => /to date$/.test(node.lines?.join(' ') ?? ''));
    expect(words.length).toBeGreaterThan(0);
  });
  // Readings a minute apart each planned their own words; all but one vanished without a warning.
  it('gives close running readings on a time axis one shared "to date" centred under them', () => {
    const x = Array.from({ length: 30 }, (_, i) => `2026-10-01T10:${String(i).padStart(2, '0')}`);
    const words = (partial: number[]) => {
      const result = measure({ type: 'line', data: { x, partial: partial.map((i) => x[i]), series: [{ id: 's', label: 'Load', values: x.map((_, i) => 50 + (i % 5)) }] },
        options: { title: 'Load', valueLabels: 'none', xAxis: { type: 'time', zone: 'UTC' }, size: { width: 720 } } } as never) as any;
      return { xs: nodes(result.geometry).filter((node) => node.t === 'text' && node.lines?.join(' ') === 'to date').map((node) => node.x),
        dropped: result.warnings.filter((w: any) => w.code === 'x-partial-words-dropped') };
    };
    const shared = words([10, 11, 12]);
    expect(shared.dropped).toEqual([]);
    expect(shared.xs).toHaveLength(1);
    expect(shared.xs[0]).toBeCloseTo(words([11]).xs[0], 6);
  });
  // A time axis has no category name: a PNG showed the running week only as a hollow marker.
  it('says "to date" for a running reading on a time axis, under the reading or in the key value', () => {
    const fixture = getFixtures('line').find(entry => entry.id === 'x-time-partial-week') as any;
    const texts = (width: number, more = {}) => nodes((measure({ type: 'line', data: fixture.data, options: { ...fixture.options, size: { width }, ...more } } as never) as any).geometry)
      .filter(node => node.t === 'text').map(node => `${node.id}=${node.lines.join(' ')}`);
    expect(texts(320)).toContain('label:xpartial:0=to date');
    expect(texts(720, { valueLabels: 'none' })).toContain('label:xpartial:0=to date');
    expect(texts(720).filter(text => text.endsWith('to date'))).toEqual(['frame:legendLabel:3=Orders 655 orders to date']);
  });
});

describe('variance partial period', () => {
  // Long to-date words under the last month must not hide that month and refuse a 320 px integrated variance chart.
  it.each(['projected', 'forecasted'])('seats %s below the month row at 320 px with the legend off', (toDate) => {
    const result = measure({
      type: 'variance', target: 'dashboard',
      theme: { preset: 'standard', overrides: { type: { axis: { size: 13 }, secondary: { size: 13 } } } },
      data: {
        categories: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((label, i) => ({ id: `2026-${String(i + 4).padStart(2, '0')}-01`, label, ...(i === 6 ? { partial: true } : {}) })),
        series: [
          { id: 'actual', label: 'Actual', direction: 'lowerIsBetter', values: [4820, 5130, 4675, 5390, 5010, 4760, 5240] },
          { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [5000, 5000, 5100, 5200, 5200, 5300, 5400] },
        ],
      },
      options: { variant: 'integrated', variance: { of: 'actual', vs: 'plan' }, format: '$1,234K', legend: 'none', strings: { toDate }, size: { width: 320, height: 320 } },
    } as never);
    expect(result.refused).toBeUndefined();
    const g = result.geometry!;
    const month = g.labels.find(label => label.id === 'category:2026-10-01')!;
    expect(month.hidden).toBeUndefined();
    const words = g.labels.find(label => label.lines.includes(toDate))!;
    expect(words.hidden).toBeUndefined();
    expect(words.rect.y).toBeGreaterThan(month.rect.y + month.rect.h);
  });

  // A part-month loss without words reads as a full-month miss; a loss under its bar keeps the key, so the period never loses its cue (the gain is the variance/partial-period golden).
  it('says "to date" on a running integrated loss and keeps the hatch key on a loss under its bar', () => {
    const g = (last: number, variant = 'integrated'): any => (measure({
      type: 'variance',
      data: {
        categories: [{ id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }, { id: 'mar', label: 'Mar', partial: true }],
        series: [{ id: 'actual', label: 'Actual', values: [120, 90, last] }, { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [100, 100, 40] }],
      },
      options: { variant, variance: { of: 'actual', vs: 'plan' }, title: 'March', size: { width: 400 } },
    } as never) as any).geometry;
    const keys = (geo: any) => nodes(geo).filter(node => node.part === 'legendLabel').map(node => node.lines.join(' '));
    expect(nodes(g(30)).filter(node => node.id === 'label:point:mar:body').map(node => node.lines.join(' '))).toEqual(['to date']);
    expect(keys(g(30, 'absolute')).some((key: string) => /partial|to date/i.test(key))).toBe(true);
  });
});

describe('to-date words over a thin column', () => {
  // Long words over a narrow bandFraction column floated off their mark, and the key, note and axis words were all dropped.
  it('keeps the key or axis words on column and combo when the words are wider than twice the drawn column', () => {
    const spec = (type: string): any => ({
      type,
      data: {
        categories: [{ id: 'a', label: 'W1' }, { id: 'b', label: 'W2', partial: true }],
        series: [{ id: 'orders', label: 'Orders', values: [100, 50] }, ...(type === 'combo' ? [{ id: 'plan', label: 'Plan', kind: 'line', values: [90, 95] }] : [])],
      },
      options: { title: 'Orders', size: { width: 320 }, bandFraction: 0.1, strings: { toDate: 'running through today' } },
    });
    for (const type of ['column', 'combo']) {
      const g = (measure(spec(type) as never) as any).geometry;
      expect(nodes(g).filter(node => String(node.id).endsWith(':b:body'))).toEqual([]);
      // The key on combo; the one-series column has no legend, so the axis words name the period.
      expect(nodes(g).some(node => /running through today$/.test(node.lines?.join(' ') ?? ''))).toBe(true);
    }
  });
});

describe('to-date words on a thin bar row', () => {
  // A value with its words stood two lines tall beside a bar a few pixels thick, and the key was dropped.
  it('keeps the row-name words when the value and words are taller than twice the drawn bar', () => {
    const g = (measure({
      type: 'bar',
      data: {
        categories: [{ id: 'a', label: 'W1' }, { id: 'b', label: 'W2', partial: true }],
        series: [{ id: 'orders', label: 'Orders', values: [100, 50] }],
      },
      options: { title: 'Orders', size: { width: 320, height: 400 }, bandFraction: 0.05 },
    } as never) as any).geometry;
    expect(nodes(g).filter(node => String(node.id).endsWith(':b:body'))).toEqual([]);
    expect(nodes(g).some(node => /to date$/.test(node.lines?.join(' ') ?? ''))).toBe(true);
  });
});

describe('to-date words over a thin variance band', () => {
  // Long words over a narrow bandFraction bar floated off their mark, and the Partial key was dropped.
  it('keeps the hatch key when the words are wider than twice the drawn band', () => {
    const g = (measure({
      type: 'variance',
      data: {
        categories: [{ id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }, { id: 'mar', label: 'Mar', partial: true }],
        series: [{ id: 'actual', label: 'Actual', values: [120, 90, 60] }, { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [100, 100, 40] }],
      },
      options: { variant: 'integrated', variance: { of: 'actual', vs: 'plan' }, title: 'March', size: { width: 400 }, bandFraction: 0.1, strings: { toDate: 'running through today' } },
    } as never) as any).geometry;
    expect(nodes(g).filter(node => node.id === 'label:point:mar:body')).toEqual([]);
    expect(nodes(g).some(node => node.part === 'legendLabel' && /^Partial$|running through today$/.test(node.lines.join(' ')))).toBe(true);
  });
});
