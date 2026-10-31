/**
 * An engine fix touches only the member it changes. A spec with variant and
 * title that refuses for an unplaced diagram label gets a fix; applied as an
 * RFC 6902 patch, the fix must keep variant and title. A design advice's fix,
 * applied the same way, must clear the advice and keep the chart drawing.
 */
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';

type Op = { op: 'add' | 'replace' | 'test' | 'remove'; path: string; value?: unknown };

/** RFC 6902 on plain objects: add and replace set a member, replace needs it to exist. */
function applyPatch(doc: any, patch: readonly Op[]): any {
  const out = structuredClone(doc);
  for (const { op, path, value } of patch) {
    if (op === 'test') continue;
    const keys = path.slice(1).split('/').map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'));
    const parent = keys.slice(0, -1).reduce((node, key) => node[key], out);
    const last = keys.at(-1)!;
    if (op === 'replace' && !(last in parent)) throw new Error(`replace on a missing member: ${path}`);
    if (Array.isArray(parent) && last === '-') parent.push(structuredClone(value));
    else if (op === 'remove') delete parent[last];
    else parent[last] = structuredClone(value);
  }
  return out;
}

const fixture = () => {
  const { data, options } = getFixtures('diagram').find((entry) => entry.id === 'org-structure')!;
  return structuredClone({ type: 'diagram', data, options }) as any;
};

describe('engine fix patches', () => {
  // A rejected bound must explain the drawn domain and offer a patch that clears the warning on every value-axis family.
  it('repairs min and max bounds that would clip plotted values', () => {
    for (const type of ['bar', 'column', 'line', 'combo', 'dot', 'box', 'variance', 'slope', 'mekko', 'scatter', 'bullet', 'histogram', 'pareto']) {
      const fixture = getFixtures(type)[0]!;
      for (const bound of ['min', 'max'] as const) {
        const spec = structuredClone({ type, data: fixture.data, options: {
          ...fixture.options, ...(type === 'bullet' ? { sharedScale: true } : {}),
          size: { width: 960 }, valueAxis: { [bound]: bound === 'min' ? 1e9 : -1e9 },
        } });
        const first = render({ spec, format: 'svg' }).body as any;
        const code = `value-axis-${bound}-ignored`;
        const warning = first.warnings?.find((item: any) => item.code === code);
        expect(warning, `${type}.${bound}`).toMatchObject({ severity: 'warn', fix: [
          { op: 'replace', path: `/options/valueAxis/${bound}`, value: expect.any(Number) },
        ] });
        const fixed = render({ spec: applyPatch(spec, warning.fix), format: 'svg' }).body as any;
        expect(fixed.ok, `${type}.${bound}`).toBe(true);
        expect(fixed.warnings.map((item: any) => item.code), `${type}.${bound}`).not.toContain(code);
      }
    }
  });

  it('keeps variant and title when the fix for an unplaced diagram label is applied', () => {
    const spec = fixture();
    spec.options.size = { width: 330, height: 200 };
    const refused = render({ spec, format: 'svg' }).body as any;
    const unplaced = refused.errors.find((error: any) => error.code === 'diagram-node-label-unplaced');
    expect(unplaced.fix).toEqual([{ op: 'replace', path: '/options/size', value: expect.objectContaining({ width: 330 }) }]);

    const fixed = applyPatch(spec, unplaced.fix);
    expect(fixed.options).toMatchObject({ variant: spec.options.variant, title: spec.options.title });
    // The fixed size gets past the label refusal.
    const again = render({ spec: fixed, format: 'svg' }).body as any;
    expect(again.ok).toBe(true);
  });
});

describe('root key fixes', () => {
  const chart = { type: 'column', data: { categories: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], series: [{ id: 'rev', label: 'Revenue', values: [12, 19] }] } };

  // A chart sent beside a root version got remove patches for its type and data, and a root title got a remove that dropped it unseen.
  it('applies to a drawing chart that keeps its data, title and unit', () => {
    for (const [spec, kept] of [
      [{ version: 1, ...chart, options: { title: 'Revenue' } }, { title: 'Revenue' }],
      [{ ...chart, title: 'Revenue', unit: 'EUR m' }, { title: 'Revenue', unit: 'EUR m' }],
      [{ ...chart, options: { unit: 'EUR m' }, title: 'Revenue' }, { title: 'Revenue', unit: 'EUR m' }],
    ] as const) {
      const refused = render({ spec, format: 'svg' }).body as any;
      expect(refused.ok).toBe(false);
      const fixed = applyPatch(spec, refused.errors.flatMap((error: any) => error.fix));
      expect(fixed).toMatchObject({ type: 'column', data: chart.data, options: kept });
      expect(render({ spec: fixed, format: 'svg' }).body).toMatchObject({ ok: true });
    }
  });

  // A bare chart with a stray key that is no option name got a move into options, and the fixed chart was refused with no fix.
  it('draws a bare chart after a stray key that no option takes is removed', () => {
    for (const extra of [{ $schema: 'https://boardplot.com/schema/v1/boardplot-doc.json' }, { foo: 1 }, { width: 600 }, { colors: ['#fff'] }, { format: { value: { decimals: 1 } } }, { description: 'd' }, { notes: ['n'] }, { locale: 'de' }, { 'a/b': 1 }, { title: 'Revenue', foo: 1 }]) {
      const spec = { ...chart, ...extra };
      const refused = render({ spec, format: 'svg' }).body as any;
      expect(refused.ok).toBe(false);
      const fixed = applyPatch(spec, refused.errors.flatMap((error: any) => error.fix));
      expect(render({ spec: fixed, format: 'svg' }).body).toMatchObject({ ok: true });
    }
  });

  // A stray root key beside charts got a move into a root options that an envelope does not have; the fixed document was refused.
  it('draws an envelope after its stray root key is removed', () => {
    for (const extra of [{ title: 'Revenue' }, { unit: 'EUR m' }, { foo: 1 }, { type: 'column' }]) {
      const spec = { version: 1, charts: [{ name: 'a', ...chart }], ...extra };
      const refused = render({ spec, format: 'svg' }).body as any;
      expect(refused.ok).toBe(false);
      const fixed = applyPatch(spec, refused.errors.flatMap((error: any) => error.fix));
      expect(render({ spec: fixed, format: 'svg' }).body).toMatchObject({ ok: true });
    }
  });
});

const fixtureSpec = (type: string, id: string) => {
  const { data, options, annotations } = getFixtures(type).find((entry) => entry.id === id)!;
  return structuredClone({ type, data, options, ...(annotations ? { annotations } : {}) }) as any;
};

/** Render, apply the one advice's fix, render again at the same width: the chart draws and the advice is gone. */
function applyAdvice(spec: any, code: string, width?: number) {
  const first = render({ spec, ...(width ? { width } : {}) }).body as any;
  const advice = first.warnings.find((warning: any) => warning.code === code);
  expect(advice, code).toMatchObject({ severity: 'advice', docs: expect.stringContaining(`#${code}`) });
  const again = render({ spec: applyPatch(spec, advice.fix), ...(width ? { width } : {}) }).body as any;
  expect(again.ok, code).toBe(true);
  expect(again.warnings.map((warning: any) => warning.code)).not.toContain(code);
}

// Wrong or unworkable advice is the most frequent warning bug: each design rule's own fix must clear it.
describe('design advice fixes', () => {
  // An unsorted ranking: the sort fix must reorder the bars, not leave the advice standing.
  it('design-bar-sort', () => {
    const spec = fixtureSpec('bar', 'option-sign-color');
    delete spec.options.sort;
    applyAdvice(spec, 'design-bar-sort');
  });

  // Eighteen bars: the topN fix must fold the tail and still draw.
  it('design-bar-many', () => applyAdvice({
    type: 'bar',
    data: {
      categories: Array.from({ length: 18 }, (_, index) => ({ id: `c${index}`, label: `Market ${String.fromCharCode(65 + index)}` })),
      series: [{ id: 'revenue', label: 'Revenue', values: Array.from({ length: 18 }, (_, index) => 100 - index * 5) }],
    },
    options: { title: 'Market A leads revenue', unit: '€m' },
  }, 'design-bar-many'));

  // A legend over two plain lines: the end-label fix must still name both lines.
  it('design-line-direct-labels', () => applyAdvice(fixtureSpec('line', 'dense-20-categories-all-labels'), 'design-line-direct-labels'));

  // Every point of twenty periods labelled: dropping valueLabels must clear it.
  it('design-line-label-points', () => applyAdvice(fixtureSpec('line', 'dense-20-categories-all-labels'), 'design-line-label-points'));

  // A bridge that ends on a step: the appended total must draw as the closing bar.
  it('design-waterfall-closing-total', () => applyAdvice(fixtureSpec('waterfall', 'repeated-segment-key'), 'design-waterfall-closing-total'));

  // Rotated step names at 360 px: the horizontal bridge must draw at the same width.
  it('design-waterfall-horizontal', () => applyAdvice(fixtureSpec('waterfall', 'build-down'), 'design-waterfall-horizontal', 360));

  const markets = ['Austria', 'Belgium', 'Croatia', 'Denmark', 'Estonia', 'Finland'].map((label) => ({ id: label.toLowerCase(), label }));
  const codes = (spec: unknown) => (render({ spec }).body as any).warnings.map((warning: any) => warning.code);

  // A spec without options: an add below the missing /options cannot apply, so the fix must build the parent.
  it('applies a fix to a spec without options', () => applyAdvice({
    type: 'bar', data: { categories: markets, series: [{ id: 'sales', label: 'Sales', values: [12, 40, 7, 33, 21, 18] }] },
  }, 'design-bar-sort'));

  // Ascending bars, such as rows from an ORDER BY, are not largest first: they still get the desc sort.
  it('advises a sort for ascending bars', () => {
    expect(codes({ type: 'bar', data: { categories: markets, series: [{ id: 'sales', label: 'Sales', values: [7, 12, 18, 21, 33, 40] }] }, options: { title: 'Finland sells most' } }))
      .toContain('design-bar-sort');
  });

  // Folding dated bars into Others would rank months by value: ordered categories get no topN advice.
  it('gives dated bars no bar-many advice', () => {
    const months = Array.from({ length: 20 }, (_, index) => ({ id: `m${index}`, label: `Period ${String.fromCharCode(65 + index)}`, date: `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01` }));
    expect(codes({ type: 'bar', data: { categories: months, series: [{ id: 'orders', label: 'Orders', values: months.map((_, index) => 50 + (index * 7) % 13) }] }, options: { title: 'Orders hold steady' } }))
      .not.toContain('design-bar-many');
  });

  // An authored topN that keeps 20 bars still draws 20: the advice must judge the drawn bars and change only n.
  it('advises a smaller topN.n when the authored topN keeps too many bars', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, label: `Market ${String.fromCharCode(65 + index)}` }));
    const spec = { type: 'bar', data: { categories: many, series: [{ id: 'sales', label: 'Sales', values: many.map((_, index) => 100 - index * 4) }] },
      options: { title: 'Market A leads', topN: { n: 20, restLabel: 'All other' } } };
    const advice = (render({ spec }).body as any).warnings.find((warning: any) => warning.code === 'design-bar-many');
    expect(advice?.fix).toEqual([{ op: 'replace', path: '/options/topN/n', value: 10 }]);
    applyAdvice(spec, 'design-bar-many');
  });

  // Rows build data.items, so a patch on /data/items misses what the caller sent: the advice keeps its suggest and drops the fix.
  it('gives a rows-backed bridge no fix that targets generated items', () => {
    const body = render({
      spec: { type: 'waterfall', options: { title: 'Price lifts the margin' } },
      columns: { label: 'label', value: 'value', type: 'type' },
      rows: [{ label: 'Opening', value: 40, type: 'total' }, { label: 'Price', value: 7, type: 'delta' }, { label: 'Volume', value: -3, type: 'delta' }],
    }).body as any;
    const advice = body.warnings.find((warning: any) => warning.code === 'design-waterfall-closing-total');
    expect(advice.suggest).toContain('row');
    expect(advice.fix).toBeUndefined();
  });

  // A horizontal bridge drops annotations: a fix that raises a new warning is not advised.
  it('gives an annotated bridge no horizontal advice', () => {
    const spec = fixtureSpec('waterfall', 'build-down');
    spec.annotations = [{ kind: 'callout', at: 'ebit', text: 'EBIT holds' }];
    expect((render({ spec, width: 360 }).body as any).warnings.map((warning: any) => warning.code)).not.toContain('design-waterfall-horizontal');
  });

  // End names too long for the chart fall back to a key: the direct-label fix would not hold, so no advice.
  it('gives no direct-label advice where end names fall back to a key', () => {
    const names = ['Enterprise cloud infrastructure services', 'Consumer electronics and accessories', 'Professional services and consulting'];
    expect(codes({
      type: 'line',
      data: {
        categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((label) => ({ id: label.toLowerCase(), label })),
        series: names.map((label, index) => ({ id: `s${index}`, label, values: [10, 12, 14, 13, 15, 17].map((value) => value + index * 3) })),
      },
      options: { title: 'Cloud grows fastest', unit: '€m', legend: 'top', seriesLabels: 'key' },
    })).not.toContain('design-line-direct-labels');
  });

  // A zoom of 5 periods prints 5 values: the advice must count the drawn periods, not the 20 source periods.
  it('gives a zoomed line with every point labelled no label-points advice', () => {
    const periods = Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, label: `Week ${index + 1}` }));
    expect(codes({
      type: 'line',
      data: { categories: periods, series: [{ id: 'orders', label: 'Orders', values: periods.map((_, index) => 50 + (index * 7) % 13) }] },
      options: { title: 'Orders hold steady', valueLabels: 'all', viewDomain: { x: ['p15', 'p19'] } },
    })).not.toContain('design-line-label-points');
  });
});
