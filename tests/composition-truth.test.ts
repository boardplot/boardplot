import { interactionRecords } from '../src/core/a11y/records';
import type { BarTableData } from '../src/core/charts/bartable/types';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { getFixtures } from '../src/fixtures';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getChart } from '../src/core/registry';
import type { ChartData } from '../src/core/types/data';
import type { Geometry } from '../src/core/types/scene';
import { noteTexts } from './helpers/notes';

type CompositionType = 'column' | 'bar' | 'line' | 'mekko';

const MIXED: ChartData = {
  categories: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  series: [
    { id: 's1', label: 'S1', values: [60, 40] },
    { id: 's2', label: 'S2', values: [-20, 60] },
  ],
};

const COMPOSITION_OPTIONS: Record<CompositionType, Record<string, unknown>> = {
  column: { variant: 'stacked100' },
  bar: { variant: 'stacked100' },
  line: { variant: 'stacked100-area' },
  mekko: { variant: 'stacked100' },
};

function layoutComposition(
  type: CompositionType,
  data: ChartData,
  extra: Record<string, unknown> = {},
): Geometry {
  const definition = getChart(type)!;
  return requireGeometry(definition.layout(data, {
    ...definition.defaults,
    ...COMPOSITION_OPTIONS[type],
    ...extra,
  }));
}

function stateNodes(geometry: Geometry): Extract<Geometry['scene'][number], { t: 'text' }>[] {
  return geometry.scene.filter(
    (node): node is Extract<Geometry['scene'][number], { t: 'text' }> =>
      node.t === 'text' && node.part === 'nmMarker',
  );
}

function percentageValues(text: string): number[] {
  return [...text.matchAll(/([−-]?\d+(?:[.,]\d+)?)%/g)].map((match) =>
    Number(match[1]!.replace('−', '-').replace(',', '.')),
  );
}

function numericLeaves(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numericLeaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numericLeaves);
  return [];
}

function expectSharesInRange(geometry: Geometry, context: string): void {
  for (const label of geometry.labels.filter((candidate) => !candidate.hidden)) {
    for (const value of percentageValues(label.text)) {
      expect(value, `${context}: visible label '${label.id}' = ${label.text}`).toBeGreaterThanOrEqual(0);
      expect(value, `${context}: visible label '${label.id}' = ${label.text}`).toBeLessThanOrEqual(100);
    }
  }
  for (const node of geometry.scene) {
    const display = node.display?.value;
    if (typeof display !== 'string') continue;
    for (const value of percentageValues(display)) {
      expect(value, `${context}: visible mark '${node.id}' = ${display}`).toBeGreaterThanOrEqual(0);
      expect(value, `${context}: visible mark '${node.id}' = ${display}`).toBeLessThanOrEqual(100);
    }
  }
  const derived = geometry.derived as {
    percents?: unknown;
    shares?: unknown;
    endpoints?: Record<string, { value: number }>;
  };
  for (const [name, value] of [
    ['percents', derived.percents],
    ['shares', derived.shares],
  ] as const) {
    for (const share of numericLeaves(value)) {
      expect(share, `${context}: derived.${name}`).toBeGreaterThanOrEqual(0);
      expect(share, `${context}: derived.${name}`).toBeLessThanOrEqual(100);
    }
  }
  for (const endpoint of Object.values(derived.endpoints ?? {})) {
    expect(endpoint.value, `${context}: derived.endpoints`).toBeGreaterThanOrEqual(0);
    expect(endpoint.value, `${context}: derived.endpoints`).toBeLessThanOrEqual(100);
  }
}

function isComposition(type: CompositionType, options: Record<string, unknown>): boolean {
  if (type === 'column' || type === 'bar') return options.variant === 'stacked100';
  if (type === 'line') {
    const valueAxis = options.valueAxis as { percent?: boolean } | undefined;
    return options.variant === 'stacked100-area' || valueAxis?.percent === true;
  }
  return (options.variant ?? 'stacked100') === 'stacked100';
}

describe('composition warning taxonomy', () => {
  // Hiding optional values must leave a range chart's comparator named; only labels.valueLine hides that name.
  it('keeps the football-field comparator name when value labels are off', () => {
    const chart = getChart('bar')!;
    const data = { categories: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
      series: [{ id: 's', values: [{ number: 40, range: { low: 30, high: 50 } }, { number: 50, range: { low: 40, high: 60 } }] }] };
    const options = { variant: 'football-field', currentValue: { value: 42, label: 'Current price 42' }, size: { width: 900 } };
    const geometry = requireGeometry(chart.layout(data, { ...options, labels: false }));
    expect(geometry.labels.find(label => label.id === 'valueLine:currentValue')?.text).toBe('Current price 42');
    expect(geometry.labels.filter(label => label.kind === 'point' && !label.hidden)).toEqual([]);
    const hidden = requireGeometry(chart.layout(data, { ...options, labels: { valueLine: false } }));
    expect(hidden.labels.some(label => label.id === 'valueLine:currentValue')).toBe(false);
  });

  it('uses stacked100-mixed-signs with warn severity on all four surfaces', () => {
    const taxonomy = (['column', 'bar', 'line', 'mekko'] as const).map((type) => {
      const geometry = layoutComposition(type, MIXED, { labels: false });
      return geometry.warnings
        .filter((warning) => warning.code === 'stacked100-mixed-signs')
        .map(({ code, severity }) => ({ code, severity }));
    });

    expect(taxonomy).toEqual([
      [{ code: 'stacked100-mixed-signs', severity: 'warn' }],
      [{ code: 'stacked100-mixed-signs', severity: 'warn' }],
      [{ code: 'stacked100-mixed-signs', severity: 'warn' }],
      [{ code: 'stacked100-mixed-signs', severity: 'warn' }],
    ]);
  });

  it('escalates to error when every category is mixed-sign invalid', () => {
    const allInvalid: ChartData = {
      categories: [{ id: 'a', label: 'A' }],
      series: [
        { id: 'gain', label: 'Gain', values: [10] },
        { id: 'loss', label: 'Loss', values: [-2] },
      ],
    };
    for (const type of ['line', 'mekko'] as const) {
      const warning = layoutComposition(type, allInvalid).warnings.find(
        (candidate) => candidate.code === 'stacked100-mixed-signs',
      );
      expect(warning?.severity, type).toBe('error');
    }
  });
});

describe('line and mekko fail closed visibly', () => {
  // A bar mekko's heights are rates, so a folded Others column printed 12.5% and 18.9% as a false 31.4.
  it('folds bar mekko rates into their width-weighted mean', () => {
    const draw = (values: unknown[], widthSeriesId?: string) => {
      const request = resolveChartRequest({ type: 'mekko', data: {
        categories: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
        series: [{ id: 'size', role: 'reference', values: [40, 90, 60, 20] }, { id: 'rate', values }],
      }, options: { variant: 'bar', topN: { n: 2, rest: true }, ...(widthSeriesId ? { widthSeriesId } : {}), size: { width: 960, height: 540 } } } as never);
      const geometry = requireGeometry(layoutResolvedRequest(request));
      const record = interactionRecords({ request, geometry, scope: request.scope, claims: [] }).find((r) => r.target.owner?.categoryId === 'others')!;
      return { geometry, record, total: geometry.labels.find((label) => label.id === 'total:others')?.text };
    };
    const rates = [{ pct: 10 }, { pct: 3 }, { pct: 6 }, { pct: 20 }];
    const weighted = draw(rates, 'size');
    expect(weighted.total).toBe('13%');
    expect(weighted.geometry.a11y.desc).toContain('Others 13%');
    expect(weighted.record.value.unit).toBe('%');
    expect(weighted.record.value.raw).toBeCloseTo(40 / 3);
    expect(draw([10, 3, 6, 20], 'size').record.value.raw).toBeCloseTo(40 / 3);
    // Without a width series the columns are equal, and plain heights stay amounts.
    expect(draw(rates).record.value.raw).toBe(13);
    expect(draw([10, 3, 6, 20]).record.value.raw).toBe(26);
    // A stacked column without a width series is as wide as its sum: a fold keeps the summed width.
    const stacked = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'mekko', data: {
      categories: ['a', 'b', 'c'].map((id) => ({ id })),
      series: [{ id: 's1', values: [{ pct: 80 }, { pct: 20 }, { pct: 10 }] }, { id: 's2', values: [{ pct: 20 }, { pct: 80 }, { pct: 90 }] }],
    }, options: { variant: 'stacked', topN: { n: 1, rest: true }, size: { width: 960, height: 540 } } } as never)));
    expect(stacked.derived).toMatchObject({ columnTotals: { others: 200 } });
  });

  // Mekko Others must convert percent cells to amounts and keep the present width values when one width is missing.
  it('pools equivalent Mekko amounts, percents and fractions through their category bases', () => {
    const bases = [5000, 1000, 100];
    const amounts = [[2500, 200, 80], [2500, 800, 20]];
    const draw = (kind: 'amount' | 'percent' | 'fraction', missing = false) => {
      const data = {
        categories: ['large', 'medium', 'small'].map((id, i) => ({ id, ...(kind === 'amount' ? {} : { total100: bases[i] }) })),
        series: amounts.map((values, si) => ({ id: `s${si}`, ...(kind === 'fraction' ? { valueKind: 'fraction' } : {}), values: values.map((v, ci) => missing && si === 0 && ci === 1 ? null : kind === 'amount' ? v : kind === 'percent' ? { pct: v / bases[ci]! * 100 } : v / bases[ci]!) })),
      };
      const request = resolveChartRequest({ type: 'mekko', data, options: { topN: { n: 1, rest: true }, size: { width: 960, height: 540 } } } as never);
      const geometry = requireGeometry(layoutResolvedRequest(request));
      const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] }).filter((r) => r.target.owner?.categoryId === 'others');
      return { geometry, records };
    };
    const absolute = draw('amount');
    expect(absolute.geometry.derived).toMatchObject({ columnTotals: { large: 5000, others: 1100 }, shares: { others: { s0: 25.45, s1: 74.55 } } });
    for (const kind of ['percent', 'fraction'] as const) {
      const { geometry: g, records } = draw(kind);
      expect(g.derived).toEqual(absolute.geometry.derived);
      expect(g.marks).toEqual(absolute.geometry.marks);
      expect(g.a11y.desc).toBe(absolute.geometry.a11y.desc);
      expect(records.map((r) => ({ value: r.value, share: r.share }))).toEqual(absolute.records.map((r) => ({ value: r.value, share: r.share })));
      expect(records.find((r) => r.target.owner?.seriesId === 's0')?.value.raw).toBe(280);
      const incomplete = draw(kind, true);
      expect(incomplete.geometry.warnings.some((w) => w.code === 'incomplete-composition')).toBe(true);
      expect(incomplete.records.every((r) => r.share?.percent.raw === null)).toBe(true);
    }

    for (const missingData of [false, true]) {
      const geometry = layoutComposition('mekko', {
        categories: ['big', 'm1', 'm2', 'm3'].map((id) => ({ id })),
        series: [
          { id: 'a', values: [50, 40, missingData ? null : 20, 30] },
          { id: 'b', values: [50, 60, 50, 70] },
          { id: 'w', values: [1000, 100, null, 100] },
        ],
      }, { widthSeriesId: 'w', topN: { n: 1, rest: true }, size: { width: 800, height: 500 } });
      const segments = geometry.scene.filter((n) => n.part === 'segment' && n.owner.categoryId === 'others' && n.id.startsWith('mark:'));
      expect(geometry.derived).toMatchObject({
        widths: { others: expect.closeTo(geometry.plot.w / 6, 2) },
        columnTotals: { others: missingData ? 180 : 270 },
        shares: { others: missingData ? { b: 100 } : { a: 33.33, b: 66.67 } },
      });
      expect(segments.map((n) => n.owner.seriesId).sort()).toEqual(missingData ? ['b'] : ['a', 'b']);
      for (const segment of segments) expect(segment).toMatchObject({ t: 'rect', rect: { w: expect.closeTo(geometry.plot.w / 6, 2) } });
      expect(geometry.warnings.some((w) => w.code === 'zero-weight-column')).toBe(false);
      expect(geometry.warnings.some((w) => w.code === 'incomplete-composition')).toBe(missingData);
    }
  });

  it('suppresses the invalid stacked100-area category and leaves one claimed n.m. trace', () => {
    const geometry = layoutComposition('line', MIXED, { valueLabels: 'all' }) as Geometry & {
      marks: { series: { points: { categoryId: string }[] }[] };
    };

    expect(stateNodes(geometry).map((node) => [node.owner.categoryId, node.lines])).toEqual([
      ['a', ['n.m.']],
    ]);
    expect(
      geometry.marks.series.flatMap((series) => series.points).some((point) => point.categoryId === 'a'),
    ).toBe(false);
    expect(
      geometry.labels.some(
        (label) => label.owner.categoryId === 'a' && percentageValues(label.text).length > 0,
      ),
    ).toBe(false);
    expect(geometry.a11y.desc).toContain('A (n.m.)');
    expectSharesInRange(geometry, 'line mixed repro');
  });

  it('suppresses the invalid percent-mekko column, total, and derived shares', () => {
    const geometry = layoutComposition('mekko', MIXED) as Geometry & {
      marks: { columns: { categoryId: string; segments: unknown[] }[] };
      derived: { shares: Record<string, Record<string, number>> };
    };

    expect(stateNodes(geometry).map((node) => [node.owner.categoryId, node.lines])).toEqual([
      ['a', ['n.m.']],
    ]);
    expect(geometry.marks.columns.find((column) => column.categoryId === 'a')?.segments).toEqual([]);
    expect(geometry.labels.some((label) => label.id === 'total:a')).toBe(false);
    expect(geometry.derived.shares.a).toEqual({ s1: 0, s2: 0 });
    expect(geometry.a11y.desc).toContain('A (n.m.)');
    expectSharesInRange(geometry, 'mekko mixed repro');
  });

  it('marks all-zero categories n/a instead of presenting a composition', () => {
    const zero: ChartData = {
      categories: [
        { id: 'ok', label: 'OK' },
        { id: 'zero', label: 'Zero' },
      ],
      series: [
        { id: 's1', label: 'S1', values: [60, 0] },
        { id: 's2', label: 'S2', values: [40, 0] },
      ],
    };
    for (const type of ['line', 'mekko'] as const) {
      const geometry = layoutComposition(type, zero, { labels: false });
      expect(geometry.warnings.map((warning) => warning.code), type).toContain(
        'percent-basis-nonpositive',
      );
      // A mekko column as wide as its zero total has no place for a glyph;
      // zero-weight-column says it is suppressed.
      expect(stateNodes(geometry).map((node) => [node.owner.categoryId, node.lines]), type).toEqual(
        type === 'mekko' ? [] : [['zero', ['n/a']]],
      );
      if (type === 'mekko') expect(geometry.warnings.map((warning) => warning.code)).toContain('zero-weight-column');
      expectSharesInRange(geometry, `${type} zero basis`);
    }
  });

  it('keeps positive direct-share cells valid and fails negative direct shares closed', () => {
    const positivePct: ChartData = {
      categories: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      series: [
        { id: 's1', label: 'S1', values: [{ pct: 40 }, { pct: 30 }] },
        { id: 's2', label: 'S2', values: [{ pct: 60 }, { pct: 70 }] },
      ],
    };
    const negativePct: ChartData = {
      categories: [{ id: 'a', label: 'A' }],
      series: [
        { id: 's1', label: 'S1', values: [{ pct: 120 }] },
        { id: 's2', label: 'S2', values: [{ pct: -20 }] },
      ],
    };

    for (const type of ['line', 'mekko'] as const) {
      const positive = layoutComposition(type, positivePct, { valueLabels: 'all' });
      expect(stateNodes(positive), `${type}: positive direct shares`).toEqual([]);
      expectSharesInRange(positive, `${type} positive direct shares`);

      const negative = layoutComposition(type, negativePct, { valueLabels: 'all' });
      expect(negative.warnings.map((warning) => warning.code), type).toContain(
        'stacked100-mixed-signs',
      );
      expect(stateNodes(negative).map((node) => node.lines), type).toEqual([['n.m.']]);
      expectSharesInRange(negative, `${type} negative direct shares`);
    }
  });
});

describe('composition share invariant', () => {
  it('holds for every registered composition fixture', () => {
    let checked = 0;
    for (const type of ['column', 'bar', 'line', 'mekko'] as const) {
      const definition = getChart(type)!;
      for (const fixture of getFixtures(definition.type)) {
        const options = {
          ...definition.defaults,
          ...(fixture.options ?? {}),
          ...(fixture.annotations ? { annotations: fixture.annotations } : {}),
        };
        if (!isComposition(type, options)) continue;
        expectSharesInRange(
          requireGeometry(definition.layout(fixture.data, options)),
          `${type}/${fixture.id}`,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(12);
  });

});

describe('bartable Total row', () => {
  // An explicit rounding policy must disclose when there is no share calculation that can use it.
  it('warns when rounding nearest has no share calculation', () => {
    const bartable = getChart('bartable')!;
    const data = {
      categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [{ id: 's' }],
      panels: [{ id: 'p', values: { s: [1, 1, 1] } }],
    };
    const geometry = requireGeometry(bartable.layout(data, { rounding: 'nearest', size: { width: 900 } }));
    expect(geometry.warnings).toContainEqual(expect.objectContaining({
      code: 'bartable-rounding-ignored', severity: 'warn',
      message: expect.stringContaining('rounding'), suggest: expect.stringContaining('cascade'),
    }));
    const cascade = requireGeometry(bartable.layout(data, { variant: 'cascade', rounding: 'nearest', size: { width: 900 } }));
    expect(cascade.warnings.some(warning => warning.code === 'bartable-rounding-ignored')).toBe(false);
  });

  it('sums the number column and the ranges, and leaves a panel with a missing part open', () => {
    const bartable = getChart('bartable')!;
    const fixture = getFixtures('bartable').find((entry) => entry.id === 'impact-two-panels')!;
    const text = (geometry: Geometry, id: string) => geometry.labels.find((label) => label.id === id)?.text;
    const full = requireGeometry(bartable.layout(fixture.data, { ...bartable.defaults, ...fixture.options }));
    expect([text(full, 'total:n'), text(full, 'total:abs')]).toEqual(['256', '458\u2013766']);
    const gap = structuredClone(fixture.data);
    gap.panels[0].values.run[2] = null;
    const open = requireGeometry(bartable.layout(gap, { ...bartable.defaults, ...fixture.options }));
    expect([text(open, 'total:abs'), open.warnings.some((warning) => warning.code === 'incomplete-composition')]).toEqual(['\u2013', true]);
    const one = structuredClone(fixture.data);
    one.panels[0].ends = one.panels[0].ends.map((end: unknown, r: number) => (r === 0 ? end : null));
    // With one range the Total must not add Software's 140 (597), which its row does not print.
    expect(text(requireGeometry(bartable.layout(one, { ...bartable.defaults, ...fixture.options })), 'total:abs')).toBe('567\u2013617');
  });

  it('lists the rows the shared scale leaves as a sliver, with their parts, in one note ', () => {
    const bartable = getChart('bartable')!;
    const fixture = getFixtures('bartable').find((entry) => entry.id === 'null-and-long-labels')!;
    const geometry = requireGeometry(bartable.layout(fixture.data, { ...bartable.defaults, ...fixture.options }));
    // Footer rule: the note is in the notes list. One note of at most two lines per
    // shared scale, each listed row with its parts, and "and N more" for the rows past two lines.
    // The narrower Roles panel leaves Plant C a sliver there too, so that scale gets its own note.
    // Measured in the 11 px the footer draws, all three rows fit the two lines.
    const notes = noteTexts(geometry).filter((note) => note.startsWith('Too short to compare'));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('Plant A 2,400 (Energy 1,200, Labour 800, Freight 400)');
    expect(notes[0]).toContain('Plant C 1,900 (Energy 900, Labour 700, Freight 300)');
    expect(notes[0]).toContain('Plant D');
    expect(notes[0]).not.toMatch(/more\.$/);
    expect(notes[1]).toContain('Plant C 12 (Energy 2, Labour 9, Freight 1)');
  });

  it('gives every printed Total a record, an open Total included', () => {
    const fixture = getFixtures('bartable').find((entry) => entry.id === 'impact-two-panels')!;
    const totals = (data: BarTableData) => {
      const request = resolveChartRequest({ type: 'bartable', data, options: fixture.options });
      const geometry = requireGeometry(layoutResolvedRequest(request));
      return interactionRecords({ request, geometry, scope: request.scope, claims: [] })
        .filter((record) => record.categoryLabel === 'Total')
        .map((record) => [record.target.owner.colId, record.value.state, record.value.raw]);
    };
    const gap = structuredClone(fixture.data) as BarTableData;
    gap.panels[0]!.values.run![2] = null;
    // The Total row was drawn as text only: no mark, no record, no table row.
    expect([totals(fixture.data as BarTableData), totals(gap)]).toEqual([
      [['n', 'value', 256], ['abs', 'value', '458\u2013766']],
      [['n', 'value', 256], ['abs', 'missing', null]],
    ]);
  });
});

// A pareto tail joined to the authored rest printed its sum as the authored value ("Other 1.4000000000000000", "43" for an authored 30).
describe('pareto joined remainder record', () => {
  // Zero-valued folded causes must keep their membership and derived marker on the authored rest.
  it('records zero-valued causes folded into an authored rest', () => {
    const data = { items: [{ id: 'a', value: 10 }, { id: 'b', value: 0 }, { id: 'c', value: 0 }, { id: 'o', value: 5, rest: true }] };
    for (const n of [1, 3]) {
      const request = resolveChartRequest({ type: 'pareto', data, options: { topN: { n } } } as never);
      const geometry = requireGeometry(layoutResolvedRequest(request));
      const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
      const column = records.find(record => record.target.owner?.categoryId === 'o' && record.target.owner.seriesId === 'pareto:value')!;
      expect(column.value.raw).toBe(5);
      expect(column.value.derived).toBe(n === 1 ? 'number' : undefined);
      for (const record of records.filter(record => record.target.owner?.categoryId === 'o')) {
        expect(record.members).toEqual(n === 1 ? [{ categoryId: 'b' }, { categoryId: 'c' }] : undefined);
      }
    }
  });

  it('records the joined column as a sum with the folded members', () => {
    const request = resolveChartRequest({ type: 'pareto', data: { items: [{ id: 'a', value: 10 }, { id: 'b', value: 5 }, { id: 'c', value: 0.2 }, { id: 'd', value: 0.1 }, { id: 'o', label: 'Other', value: 1.1, rest: true }] }, options: { topN: { n: 2 } } } as never);
    const geometry = requireGeometry(layoutResolvedRequest(request));
    const column = interactionRecords({ request, geometry, scope: request.scope, claims: [] }).find((record) => record.target.owner?.categoryId === 'o' && record.target.owner.seriesId === 'pareto:value')!;
    expect(column.value).toMatchObject({ raw: 1.4, derived: 'number' });
    expect(column.members).toEqual([{ categoryId: 'c' }, { categoryId: 'd' }]);
  });
});
