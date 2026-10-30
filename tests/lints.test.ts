import { getFixtures } from '../src/fixtures';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { main } from '../src/cli/main';
import { render } from '../src/cli/render';
import { listCharts } from '../src/core/registry';
import {
  lintCodes,
  runDocLints,
  type LintChart,
  type LintCode,
  type LintDocument,
} from '../src/core/lint';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function chart(overrides: Partial<LintChart> = {}): LintChart {
  return {
    name: 'test',
    type: 'line',
    data: {
      categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      series: [{ id: 'actual', label: 'Actual', values: [10, 20] }],
    },
    options: { title: 'Growth accelerates in the second period' },
    ...overrides,
  };
}

function hasCode(code: LintCode, doc: LintDocument): boolean {
  return runDocLints(doc).some((warning) => warning.code === code);
}

function cliTriggerChart(code: LintCode): LintChart {
  const oneCategory = [{ id: 'fy26', label: 'FY26' }];
  const options = { title: 'Performance improves materially' };
  switch (code) {
    case 'partial-period-pairing':
      return chart({ data: { categories: oneCategory, series: [{ id: 'a', label: '2026 YTD', values: [10] }, { id: 'b', label: 'FY 2025', values: [12] }] } });
    case 'basis-change':
      return chart({ data: { categories: oneCategory, series: [{ id: 'a', label: 'Adjusted EBITDA', values: [10] }] } });
    case 'non-additive-stack':
      return chart({ type: 'column', data: { categories: oneCategory, series: [{ id: 'a', label: 'Margin %', values: [10] }] }, options: { ...options, variant: 'stacked' } });
    case 'duplicate-category-labels':
      return chart({ data: { categories: [{ id: 'a', label: 'North' }, { id: 'b', label: 'North' }], series: [{ id: 'a', values: [10, 12] }] } });
    case 'spurious-precision':
      return chart({ data: { categories: oneCategory, series: [{ id: 'a', values: [1234] }] }, options: { ...options, format: '1,234.567' } });
    case 'missing-message-title':
      return chart({ options: {} });
    case 'series-overload':
      return chart({ data: { categories: [{ id: 'a' }, { id: 'b' }], series: Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, values: [index + 1, index + 2] })) } });
    case 'integrated-stacked-variance-overload':
      return chart({
        type: 'column',
        data: {
          categories: Array.from({ length: 7 }, (_, index) => ({ id: `p${index}` })),
          series: [
            { id: 'core', values: Array(7).fill(10) },
            { id: 'growth', values: Array(7).fill(5) },
            { id: 'py', role: 'reference', scenario: 'PY', values: Array(7).fill(14) },
          ],
        },
        options: { ...options, variant: 'stacked' },
      });
    case 'pie-too-many-slices':
      return chart({ type: 'pie', options: { topN: { n: 7, rest: false } }, data: { categories: Array.from({ length: 7 }, (_, index) => ({ id: `c${index}`, label: `Slice ${index}` })), series: [{ id: 'share', values: Array(7).fill(1) }] } });
    case 'legend-redundant':
      return chart({ options: { ...options, legend: 'bottom' } });
    case 'unlabeled-units':
      return chart({ data: { categories: oneCategory, series: [{ id: 'a', values: [1000] }] } });
    case 'scenario-unexplained':
      return chart({ data: { categories: oneCategory, series: [{ id: 'plan', scenario: 'PL', values: [10] }] } });
    case 'series-unexplained':
      return chart({ type: 'column', options: { ...options, legend: 'none' }, data: { categories: oneCategory, series: [{ id: 'a', label: 'Gross', values: [10] }, { id: 'b', label: 'Net', values: [8] }] } });
  }
}

describe('honesty lints', () => {
  // Prevents bar-row lints from claiming that fixed rows stretch or that their reserved canvas space is an error.
  it('describes the fixed row pitch of a bar chart on a tall canvas', () => {
    const spec = { type: 'bar', data: { categories: ['North', 'South', 'West'], series: [{ id: 's', label: 'Accounts', values: [4, 7, 3] }] },
      options: { title: 'Regional accounts grew', unit: 'count', size: { width: 480, height: 520 },
        theme: { preset: 'boardroom', overrides: { space: { barRow: { thickness: 12, pitch: 24 } } } } } };
    const body = render({ spec, return: ['svg'] }).body as { warnings: { code: string; message: string }[] };
    expect(body.warnings.find(w => w.code === 'height-off-ladder:row-driven')!.message).not.toContain('stretches');
    expect(body.warnings.filter(w => w.code === 'dead-band')).toEqual([]);
  });
  it('partial-period-pairing triggers for unlike periods and clears with a footnote', () => {
    const data = {
      categories: [{ id: 'metric' }],
      series: [
        { id: 'current', label: '2026 YTD', values: [50] },
        { id: 'prior', label: 'FY 2025', values: [80] },
      ],
    };
    expect(hasCode('partial-period-pairing', { charts: [chart({ data })] })).toBe(true);
    expect(
      hasCode('partial-period-pairing', {
        charts: [chart({ data, options: { title: 'Current run-rate trails prior year', footnotes: ['YTD annualized'] } })],
      }),
    ).toBe(false);
  });

  it('basis-change triggers on a changed basis and clears with a footnote', () => {
    const data = {
      categories: [{ id: 'fy26' }],
      series: [{ id: 'ebitda', label: 'Adjusted EBITDA', values: [42] }],
    };
    expect(hasCode('basis-change', { charts: [chart({ data })] })).toBe(true);
    expect(
      hasCode('basis-change', {
        charts: [chart({ data, options: { title: 'Underlying EBITDA expands', footnotes: ['Adjusted for one-offs'] } })],
      }),
    ).toBe(false);
  });

  it('non-additive-stack triggers only for non-additive labels in stacked columns or bars', () => {
    const data = {
      categories: [{ id: 'a' }],
      series: [{ id: 'margin', label: 'EBIT margin %', values: [20] }],
    };
    expect(
      hasCode('non-additive-stack', {
        charts: [chart({ type: 'column', data, options: { title: 'Margin expands', variant: 'stacked' } })],
      }),
    ).toBe(true);
    expect(
      hasCode('non-additive-stack', {
        charts: [chart({ type: 'column', data, options: { title: 'Margin expands', variant: 'grouped' } })],
      }),
    ).toBe(false);
    // a margin in money stacks; only a series stated in percent does not.
    const money = { categories: [{ id: 'a' }], series: [{ id: 'product', label: 'Product margin', values: [20] }] };
    expect(hasCode('non-additive-stack', { charts: [chart({ type: 'column', data: money, options: { title: 'Margin expands', variant: 'stacked', unit: '$m' } })] })).toBe(false);
  });

  // valueAxis.percent on a line of fractions drew a 100% stacked area without a word.
  it('warns that valueAxis.percent stacks a line into a 100% area and names the percent-formatted line', () => {
    const warnings = (options: object) => (render({ spec: { type: 'line', data: { categories: ['a', 'b'], series: [{ id: 's1', values: [0.2, 0.3] }, { id: 's2', values: [0.4, 0.5] }] },
      options: { title: 'Shares rise', valueAxis: { percent: true }, ...options } } }).body as { warnings: { code: string; suggest?: string }[] }).warnings.filter((w) => w.code === 'percent-axis-stacks-area');
    expect(warnings({})[0]?.suggest).toContain("valueKind: 'fraction'");
    expect(warnings({ variant: 'stacked100-area' })).toEqual([]);
  });

  it('non-additive-stack trusts declared shares of one whole up to 100 and names the option', () => {
    const stack = (values: [number, number]) => ({
      categories: [{ id: 'a' }, { id: 'b' }],
      series: [{ id: 'web', label: 'Web share %', values: [55, values[0]] }, { id: 'app', label: 'App share %', values: [30, values[1]] }],
    });
    const lint = (data: unknown, extra: Record<string, unknown>) => runDocLints({ charts: [chart({ type: 'column', data, options: { title: 'Web leads', variant: 'stacked', ...extra } } as never)] })
      .filter((warning) => warning.code === 'non-additive-stack');
    expect(lint(stack([60, 25]), { sharesOfOneWhole: true })).toEqual([]);
    const over = lint(stack([70, 60]), { sharesOfOneWhole: true });
    expect(over).toHaveLength(1);
    expect(over[0]!.message).toContain("more than 100 in 'b'");
    const undeclared = lint(stack([60, 25]), {});
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]!.message).toContain('sharesOfOneWhole');
    // A declared stack is held to 100 whatever its names and units.
    const plain = { categories: [{ id: 'a' }], series: [{ id: 'web', label: 'Web', values: [70] }, { id: 'app', label: 'App', values: [60] }] };
    expect(lint(plain, { sharesOfOneWhole: true })).toHaveLength(1);
    // A keyed list reads only its own categories: A is 50, not 60 + 50.
    const keyed = {
      categories: [{ id: 'a' }, { id: 'b' }],
      series: [
        { id: 'web', label: 'Web share %', values: [{ categoryId: 'b', value: 60 }] },
        { id: 'app', label: 'App share %', values: [{ categoryId: 'a', value: 50 }, { categoryId: 'b', value: 30 }] },
      ],
    };
    expect(lint(keyed, { sharesOfOneWhole: true })).toEqual([]);
    // { pct } cells state a series in percent as its name or unit would.
    const pctCells = { categories: [{ id: 'a' }], series: [{ id: 'web', label: 'Web', values: [{ pct: 55 }] }, { id: 'app', label: 'App', values: [{ pct: 30 }] }] };
    expect(lint(pctCells, {})).toHaveLength(1);
    expect(lint(pctCells, { sharesOfOneWhole: true })).toEqual([]);
    // On a variant that stacks nothing the declaration would do nothing, so it is refused.
    const grouped = render({ spec: { type: 'column', data: stack([60, 25]), options: { title: 'Web leads', sharesOfOneWhole: true } } });
    expect(grouped.exit).toBe(1);
    expect((grouped.body as { errors: unknown[] }).errors[0]).toMatchObject({ path: '/options/sharesOfOneWhole', fix: [{ op: 'remove', path: '/options/sharesOfOneWhole' }] });
  });

  it('duplicate-category-labels triggers on identical display labels and clears on unique labels', () => {
    const duplicate = {
      categories: [{ id: 'a', label: 'North' }, { id: 'b', label: 'North' }],
      series: [{ id: 'sales', values: [10, 20] }],
    };
    const unique = {
      ...duplicate,
      categories: [{ id: 'a', label: 'North' }, { id: 'b', label: 'South' }],
    };
    expect(hasCode('duplicate-category-labels', { charts: [chart({ data: duplicate })] })).toBe(true);
    expect(hasCode('duplicate-category-labels', { charts: [chart({ data: unique })] })).toBe(false);
    // Blank labels thin the row on purpose; they are not copies of each other.
    const thinned = {
      categories: [{ id: 'a', label: 'Jan' }, { id: 'b', label: '' }, { id: 'c', label: ' ' }, { id: 'd', label: '' }],
      series: [{ id: 'sales', values: [10, 20, 30, 40] }],
    };
    expect(hasCode('duplicate-category-labels', { charts: [chart({ data: thinned })] })).toBe(false);
    // A month name that comes back in another year names another date, not a copy.
    const monthNames = {
      categories: [{ id: 'a', label: 'Jan', date: '2024-01-01' }, { id: 'b', label: 'Jan', date: '2025-01-01' }],
      series: [{ id: 'sales', values: [10, 20] }],
    };
    expect(hasCode('duplicate-category-labels', { charts: [chart({ data: monthNames })] })).toBe(false);
    const sameDate = { ...monthNames, categories: monthNames.categories.map((category) => ({ ...category, date: '2024-01-01' })) };
    expect(hasCode('duplicate-category-labels', { charts: [chart({ data: sameDate })] })).toBe(true);
    // The stride message counts names, so a blank label is not a name it dropped.
    const categories = Array.from({ length: 40 }, (_, i) => ({ id: String(i), label: i % 2 === 0 ? `Category ${i}` : '' }));
    const strided = render({ spec: { type: 'column', data: { categories, series: [{ id: 's', values: categories.map(() => 12) }] }, options: { theme: 'standard', size: { width: 500, height: 300 } } } });
    const stride = (strided.body as { warnings: { code: string; message: string }[] }).warnings.find((warning) => warning.code === 'category-stride');
    expect(stride?.message).toMatch(/ of 20 names drawn/);
  });

  // A sparse timeline must keep its latest name and report the earlier name lost to a collision.
  it('keeps the latest named period when two sparse timeline names collide', () => {
    const categories = Array.from({ length: 12 }, (_, i) => ({
      id: String(i), date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      label: i === 10 ? 'Previous review' : i === 11 ? 'Final review' : '',
      ...(i === 11 ? { footnote: 1 } : {}),
    }));
    const result = render({ spec: {
      type: 'line', data: { categories, series: [{ id: 'output', values: categories.map((_, i) => 100 + i) }] },
      options: { target: 'report', theme: 'standard', size: { width: 640, height: 480 }, title: 'Output rises through the final review', seriesLabels: 'none', valueLabels: 'none', footnotes: ['The last day includes the final review.'] },
    } });
    expect(result.exit).toBe(0);
    const warnings = (result.body as { warnings: { code: string; message: string }[] }).warnings;
    expect(warnings.filter(warning => warning.code === 'category-stride').map(warning => warning.message)).toEqual([
      "category labels: 1 of 2 names drawn, 'Previous review' collide with a neighbouring name",
    ]);
  });

  it('spurious-precision triggers for 3 decimals on large values and clears at useful precision', () => {
    const data = {
      categories: [{ id: 'fy26' }],
      series: [{ id: 'sales', values: [1234] }],
    };
    expect(
      hasCode('spurious-precision', {
        charts: [chart({ data, options: { title: 'Sales expand', format: '1,234.567' } })],
      }),
    ).toBe(true);
    expect(
      hasCode('spurious-precision', {
        charts: [chart({ data, options: { title: 'Sales expand', format: '1,234.5' } })],
      }),
    ).toBe(false);
  });
});

describe('mechanical lints', () => {
  it('missing-message-title triggers for absent or generic titles and clears for an action title', () => {
    expect(hasCode('missing-message-title', { charts: [chart({ options: {} })] })).toBe(true);
    expect(hasCode('missing-message-title', { charts: [chart({ options: { title: 'Line chart' } })] })).toBe(true);
    expect(hasCode('missing-message-title', { charts: [chart()] })).toBe(false);
  });

  it('series-overload triggers above 6 data series and ignores reference roles', () => {
    const makeSeries = (count: number) => Array.from({ length: count }, (_, index) => ({
      id: `s${index}`,
      label: `Series ${index}`,
      values: [index, index + 1],
    }));
    const data = { categories: [{ id: 'a' }, { id: 'b' }], series: makeSeries(7) };
    const withReference = { ...data, series: [...makeSeries(6), { id: 'ref', role: 'reference', values: [1, 2] }] };
    expect(hasCode('series-overload', { charts: [chart({ data })] })).toBe(true);
    expect(hasCode('series-overload', { charts: [chart({ data: withReference })] })).toBe(false);
    // A bump chart ranks a whole field under its own 12-entity limit; the 6-line limit warned on every showcase bump.
    expect(hasCode('series-overload', { charts: [chart({ data, options: { title: 'A overtakes B', variant: 'bump' } })] })).toBe(false);
  });

  // An event's title line carries the whole event as its title; the cut check called every event label shortened.
  it('label-truncated leaves event labels alone, which the lane and the key never cut', () => {
    const fixture = getFixtures('line').find((f) => f.id === 'era-event-markers')!;
    const body = render({ spec: { type: 'line', data: fixture.data, options: fixture.options, annotations: fixture.annotations }, return: ['svg'] }).body as
      { warnings: { code: string }[]; notes: { text: string }[] };
    expect(body.warnings.map((w) => w.code)).not.toContain('label-truncated');
    expect(body.notes.map((note) => note.text).join(' ')).not.toContain('shortened labels');
  });

  // sizes multi-panel waffle headlines at 22/18 px; the 28 px hero floor warned on every such waffle.
  it('type-below-native-min holds multi-panel waffle headlines to the panel floor', () => {
    const codes = (type: string, id: string, options: object = {}) => {
      const fixture = getFixtures(type).find((f) => f.id === id)!;
      return (render({ spec: { type, data: fixture.data, options: { ...fixture.options, ...options } }, return: ['svg'] }).body as { warnings: { code: string }[] }).warnings.map((w) => w.code);
    };
    expect(codes('waffle', 'share-squares')).not.toContain('type-below-native-min');
    expect(codes('grid', 'kpi-and-waffle')).not.toContain('type-below-native-min');
  });

  it('integrated stacked variance advises at more than 6 periods or 4 components', () => {
    const makeChart = (
      periodCount: number,
      componentCount: number,
      optionOverrides: Record<string, unknown> = {},
      referenceCount = 1,
    ) =>
      chart({
        type: 'column',
        data: {
          categories: Array.from({ length: periodCount }, (_, index) => ({ id: `p${index}` })),
          series: [
            ...Array.from({ length: componentCount }, (_, index) => ({
              id: `s${index}`,
              values: Array(periodCount).fill(index + 1),
            })),
            ...Array.from({ length: referenceCount }, (_, index) => ({
              id: `py${index}`,
              role: 'reference',
              scenario: 'PY',
              values: Array(periodCount).fill(componentCount + index),
            })),
          ],
        },
        options: {
          title: 'Current mix remains ahead of prior year',
          variant: 'stacked',
          ...optionOverrides,
        },
      });

    expect(hasCode('integrated-stacked-variance-overload', { charts: [makeChart(6, 4)] })).toBe(false);
    for (const overloaded of [makeChart(7, 4), makeChart(6, 5)]) {
      const finding = runDocLints({ charts: [overloaded] }).find(
        (warning) => warning.code === 'integrated-stacked-variance-overload',
      );
      expect(finding).toMatchObject({ severity: 'info' });
      expect(finding?.suggest).toContain('dual-tier');
    }
    expect(hasCode('integrated-stacked-variance-overload', { charts: [makeChart(7, 5, { variant: 'grouped' })] })).toBe(false);
    expect(hasCode('integrated-stacked-variance-overload', { charts: [makeChart(7, 5, { valueAxis: { percent: true } })] })).toBe(false);
    expect(hasCode('integrated-stacked-variance-overload', { charts: [makeChart(7, 5, { labels: { annotation: false } })] })).toBe(false);
    expect(hasCode('integrated-stacked-variance-overload', { charts: [makeChart(7, 5, {}, 2)] })).toBe(false);
  });

  it("pie-too-many-slices triggers above 6 slices without 'Others' and clears with it", () => {
    const categories = Array.from({ length: 7 }, (_, index) => ({ id: `c${index}`, label: `Slice ${index}` }));
    const pie = (items: typeof categories) => chart({
      type: 'pie',
      options: { topN: { n: 7, rest: false } },
      data: { categories: items, series: [{ id: 'share', values: items.map(() => 1) }] },
    });
    expect(hasCode('pie-too-many-slices', { charts: [pie(categories)] })).toBe(true);
    expect(
      hasCode('pie-too-many-slices', {
        charts: [pie([...categories.slice(0, 6), { id: 'others', label: 'Others' }])],
      }),
    ).toBe(false);
  });

  it('legend-redundant keeps the one-series warning and reports explicit line double naming as info', () => {
    const single = runDocLints({
      charts: [chart({ options: { title: 'Sales expand', legend: 'bottom' } })],
    }).find((warning) => warning.code === 'legend-redundant');
    expect(single?.severity).toBe('warn');
    const data = {
      categories: [{ id: 'a' }, { id: 'b' }],
      series: [{ id: 'a', values: [1, 2] }, { id: 'b', values: [2, 3] }],
    };
    const doubled = runDocLints({
      charts: [chart({ data, options: { title: 'Sales expand', legend: 'bottom' } })],
    }).filter((warning) => warning.code === 'legend-redundant');
    expect(doubled).toHaveLength(1);
    expect(doubled[0]?.severity).toBe('info');
    expect(hasCode('legend-redundant', { charts: [chart({ data, options: { title: 'Sales expand' } })] })).toBe(false);
  });

  it('legend-redundant follows authored line name-content settings', () => {
    const data = {
      categories: [{ id: 'a' }, { id: 'b' }],
      series: [{ id: 'a', values: [1, 2] }, { id: 'b', values: [2, 3] }],
    };
    const emits = (options: Record<string, unknown>) =>
      hasCode('legend-redundant', { charts: [chart({ data, options: { title: 'Sales expand', ...options } })] });
    expect(emits({ legend: { position: 'top' }, seriesLabels: 'inline', valueLabels: 'none' })).toBe(true);
    expect(emits({ legend: 'top', seriesLabels: 'key', valueLabels: 'all' })).toBe(false);
    expect(emits({ legend: 'top', seriesLabels: 'key', valueLabels: 'all', labels: { point: ['series'] } })).toBe(true);
    expect(emits({ legend: 'top', seriesLabels: 'none', valueLabels: 'none' })).toBe(false);
    expect(emits({ legend: 'top', labels: false })).toBe(false);
    expect(emits({ legend: 'top', labels: { series: ['absolute'] } })).toBe(false);

    const withReference = {
      ...data,
      series: [...data.series, { id: 'plan', role: 'reference', values: [2, 3] }],
    };
    expect(
      hasCode('legend-redundant', {
        charts: [chart({ data: withReference, options: { title: 'Sales expand', legend: 'top' } })],
      }),
    ).toBe(false);

    const invalidRebase = {
      ...data,
      series: [{ id: 'zero', values: [0, 2] }, { id: 'ok', values: [1, 3] }],
    };
    expect(
      hasCode('legend-redundant', {
        charts: [chart({ data: invalidRebase, options: { title: 'Sales expand', legend: 'top', rebase100: true } })],
      }),
    ).toBe(false);
  });

  it('unlabeled-units triggers document-wide and clears when any format or unit is declared', () => {
    const data = {
      categories: [{ id: 'fy26' }],
      series: [{ id: 'sales', values: [1000] }],
    };
    expect(hasCode('unlabeled-units', { charts: [chart({ data })] })).toBe(true);
    expect(
      hasCode('unlabeled-units', {
        charts: [chart({ data, options: { title: 'Sales expand', unit: 'EUR m' } })],
      }),
    ).toBe(false);
  });

  it('unlabeled-units counts a unit named by a size-key label or an axis title', () => {
    const points = [{ id: 'a', x: 3, y: 12, size: 4000 }, { id: 'b', x: 7, y: 8, size: 1500 }];
    const bubbles = (options: Record<string, unknown>) =>
      hasCode('unlabeled-units', { charts: [chart({ type: 'scatter', data: { points }, options: { title: 'Alpha leads on size', ...options } })] });
    expect(bubbles({})).toBe(true);
    expect(bubbles({ sizeLegend: { label: 'Revenue' } })).toBe(true);
    expect(bubbles({ sizeLegend: { label: 'Revenue, €m' } })).toBe(false);
    expect(bubbles({ axisTitles: { y: 'Margin, %' } })).toBe(false);
    const data = { categories: [{ id: 'fy26' }], series: [{ id: 'sales', values: [1000] }] };
    expect(hasCode('unlabeled-units', { charts: [chart({ data, options: { title: 'Sales expand', axisTitles: { primary: 'Sales, units' } } })] })).toBe(false);
  });

  it('a unit no text carries prints as the unit line, so unit-not-shown has nothing left to report', () => {
    const rendered = (options: Record<string, unknown>) => render({ spec: {
      type: 'column', data: { categories: ['2024', '2025'], series: [{ id: 'revenue', label: 'Revenue', values: [120, 135] }] },
      options: { title: 'Revenue grew 12.5 percent', unit: '$m', ...options },
    }, return: ['svg'] }).body as { warnings: { code: string }[]; svg: string };
    const codes = (options: Record<string, unknown>) => rendered(options).warnings.map((warning) => warning.code);
    expect(codes({})).not.toContain('unit-not-shown');
    expect(rendered({}).svg).toMatch(/<tspan font-weight="700">Revenue<\/tspan><tspan>.in \$m<\/tspan>/);
    expect(codes({ subtitle: { measure: 'Revenue' } })).not.toContain('unit-not-shown');
    expect(codes({ unitShown: true })).not.toContain('unit-not-shown');
    // A relative variance prints its differences in % on purpose.
    const relative = getFixtures('variance').filter((fixture) =>
      (fixture.options as { variant?: string; unit?: string } | undefined)?.variant === 'relative' && (fixture.options as { unit?: string }).unit);
    expect(relative.length).toBeGreaterThan(0);
    for (const fixture of relative) {
      // A plain-string subtitle takes no unit line, so nothing else prints the base's unit.
      const body = render({ spec: { type: 'variance', data: fixture.data, options: { ...(fixture.options as object), subtitle: 'Against plan' } }, return: ['svg'] }).body as { warnings: { code: string }[] };
      expect(body.warnings.map((warning) => warning.code), fixture.id).not.toContain('unit-not-shown');
      // Without a subtitle the unit line stays off too: the relative variant prints %, not the base's unit.
      const { subtitle: _subtitle, ...bare } = fixture.options as Record<string, unknown>;
      const plain = render({ spec: { type: 'variance', data: fixture.data, options: bare }, return: ['svg'] }).body as { warnings: { code: string }[] };
      expect(plain.warnings.map((warning) => warning.code), fixture.id).not.toContain('unit-not-shown');
    }
  });

  // a tick step over an axis break left one side with only its end tick (0 under a 150-750 break at step 200).
  it('tick-step-ignored warns when a step leaves one side of an axis break only its end tick', () => {
    const fixture = getFixtures('column').find((f) => f.id === 'shared-absolute-outlier')!;
    const codes = (step: number) => (render({ spec: { type: 'column', data: fixture.data,
      options: { ...fixture.options, valueAxis: { ...fixture.options!.valueAxis, tickStep: step } } }, return: ['svg'] }).body as { warnings: { code: string }[] }).warnings.map((w) => w.code);
    expect(codes(100)).not.toContain('tick-step-ignored');
    expect(codes(200)).toContain('tick-step-ignored');
    // the rejected step still set the extent, so values 1 and 2 drew a 0 to 10 axis with a 3 to 5 break.
    const small = render({ spec: { type: 'column', data: { categories: ['a', 'b'], series: [{ id: 's', values: [1, 2] }] },
      options: { title: 't', valueAxis: { show: true, tickStep: 10, break: { from: 3, to: 5 } } } }, return: ['svg'] }).body as { svg: string; warnings: { code: string }[] };
    expect(small.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['tick-step-ignored', 'axis-break-invalid']));
    expect(small.svg).toBeDefined();
    expect(small.svg).not.toContain('>10<');
  });

  it('unit-in-format warns with a remove fix when the format already prints the unit', () => {
    const findings = (options: Record<string, unknown>) => (render({ spec: {
      type: 'line', data: { categories: ['Jan', 'Feb'], series: [{ id: 'revenue', label: 'Revenue', values: [2100, 2456] }] },
      options: { title: 'Revenue reached $2,456', ...options },
    } }).body as { warnings: { code: string; fix?: unknown }[] }).warnings.filter((warning) => warning.code === 'unit-in-format');
    expect(findings({ unit: 'USD', format: '$1,234' })).toEqual([expect.objectContaining({ severity: 'warn', fix: [{ op: 'remove', path: '/options/unit' }] })]);
    expect(findings({ unit: '€m', format: '€1.2m' })).toHaveLength(1);
    expect(findings({ unit: 'k orders', format: '1,234' })).toEqual([]);
    expect(findings({ unit: '%', format: '1.1%' })).toEqual([]);
    for (const [unit, format] of [['USD', 'US$1,234'], ['EUR', '€1.2m'], ['GBP', '£1.2m']]) {
      expect(findings({ unit, format }), `${unit} ${format}`).toEqual([expect.objectContaining({ fix: [{ op: 'remove', path: '/options/unit' }] })]);
    }
    // Another currency is a conflict, not a repeat: no remove fix may turn a euro chart into a dollar chart.
    expect(findings({ unit: 'EUR', format: '$1,234' })).toEqual([]);
  });

  it('unit-format-conflict warns without a fix when the unit names another currency than the format', () => {
    const findings = (options: Record<string, unknown>) => (render({ spec: {
      type: 'line', data: { categories: ['Jan', 'Feb'], series: [{ id: 'revenue', label: 'Revenue', values: [2100, 2456] }] },
      options: { title: 'Revenue reached 2,456', ...options },
    } }).body as { warnings: { code: string; message: string; fix?: unknown }[] }).warnings.filter((warning) => warning.code.startsWith('unit-'));
    for (const [unit, format] of [['EUR', '$1,234'], ['USD', '€1.2m'], ['GBP', 'US$1,234'], ['EUR m', '£1.2m'], ['JPY', 'CN¥1,234']]) {
      const found = findings({ unit, format });
      expect(found.map((warning) => warning.code), `${unit} ${format}`).toContain('unit-format-conflict');
      expect(found.some((warning) => warning.code === 'unit-in-format' || warning.fix !== undefined), `${unit} ${format}`).toBe(false);
      const conflict = found.find((warning) => warning.code === 'unit-format-conflict')!;
      expect(conflict.message).toContain(unit);
      expect(conflict.message).toContain(format);
    }
  });

  it('scenario-unexplained is info when FC/PL has no legend or footnote and clears when explained', () => {
    const data = {
      categories: [{ id: 'fy26' }],
      series: [{ id: 'plan', scenario: 'PL', values: [42] }],
    };
    const triggered = runDocLints({ charts: [chart({ data })] }).find((warning) => warning.code === 'scenario-unexplained');
    expect(triggered?.severity).toBe('info');
    expect(
      hasCode('scenario-unexplained', {
        charts: [chart({ data, options: { title: 'Plan sets a higher bar', footnotes: ['PL = approved plan'] } })],
      }),
    ).toBe(false);
  });

  it('series-unexplained fires on multi-series bars without a legend and clears with one', () => {
    const data = {
      categories: [{ id: 'q1' }, { id: 'q2' }],
      series: [
        { id: 'a', label: 'Gross', values: [10, 12] },
        { id: 'b', label: 'Net', values: [8, 9] },
      ],
    };
    const fired = runDocLints({ charts: [chart({ type: 'column', data, options: { legend: 'none' } })] }).find((w) => w.code === 'series-unexplained');
    expect(fired?.severity).toBe('warn');
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'column', data, options: { title: 'Net tracks gross', legend: 'top' } })] })).toBe(false);
    const theme = { preset: 'boardroom', overrides: { legend: { auto: true } } };
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'column', data, options: { theme } })] })).toBe(false);
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'column', data, options: { theme, legend: 'none' } })] })).toBe(true);
    // two series hatched as FC differ by fill alone; the shared hatch names neither.
    const hatched = { categories: [{ id: 'q1' }], series: [{ id: 'hw', label: 'Hardware', scenario: 'FC', values: [10] }, { id: 'sw', label: 'Software', scenario: 'FC', values: [8] }] };
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'column', data: hatched, options: { title: 'Forecast grows', variant: 'stacked', legend: 'none' } })] })).toBe(true);
    expect(
      hasCode('series-unexplained', {
        charts: [chart({ type: 'column', data, options: { title: 'Net tracks gross', legend: 'none', subtitle: 'Gross vs net revenue, EUR m' } })],
      }),
    ).toBe(true);
    expect(
      hasCode('series-unexplained', {
        charts: [chart({ type: 'column', data, options: { title: 'Net tracks gross', legend: 'none', footnotes: ['dark = gross, light = net'] } })],
      }),
    ).toBe(true);
  });

  it("series-unexplained knows valueLabels 'all' keeps the names and stripped content falls back to the key row", () => {
    const data = {
      categories: [{ id: 'q1' }, { id: 'q2' }],
      series: [
        { id: 'a', label: 'DACH', values: [10, 12] },
        { id: 'b', label: 'APAC', values: [8, 9] },
      ],
    };
    // 'all' maps to valueLabels 'all' and keeps the end names
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'line', data, options: { title: 'APAC closes the gap', valueLabels: 'all' } })] })).toBe(false);
    // a series-kind content array without the 'series' token drops the names, and the key row names them instead
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'line', data, options: { title: 'APAC closes the gap', labels: { series: ['absolute'] } } })] })).toBe(false);
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'line', data, options: { title: 'APAC closes the gap', labels: { series: ['absolute'] }, legend: 'none' } })] })).toBe(true);
  });

  it("series-unexplained keys combo endpoint names to the 'point' label kind", () => {
    const comboData = {
      categories: [{ id: 'q1' }, { id: 'q2' }],
      series: [
        { id: 'rev', label: 'Revenue', kind: 'column', values: [10, 12] },
        { id: 'gm', label: 'Gross margin', kind: 'line', values: [3, 4] },
        { id: 'nm', label: 'Net margin', kind: 'line', values: [2, 3] },
      ],
    };
    // labels.point:false strips combo endpoint names → unreadable → fires
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'combo', data: comboData, options: { legend: 'none', title: 'Margins hold', labels: { point: false } } })] })).toBe(true);
    // the default end label is the value, so the lines stay unnamed → fires
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'combo', data: comboData, options: { legend: 'none', title: 'Margins hold' } })] })).toBe(true);
    // names requested on 'point' identify the lines; labels.series:false is a no-op for combo → silent
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'combo', data: comboData, options: { legend: 'none', title: 'Margins hold', labels: { point: ['series', 'absolute'], series: false } } })] })).toBe(false);
  });

  it('series-unexplained covers PY references and respects subtitle notation', () => {
    const pyRef = {
      categories: [{ id: 'q1' }],
      series: [
        { id: 'act', label: 'Actual', values: [10] },
        { id: 'py', label: 'PY', role: 'reference', scenario: 'PY', values: [12] },
      ],
    };
    // PY is not scenario-unexplained's beat — a bare PY tick must warn here
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'column', data: pyRef })] })).toBe(true);
    // …but the notation subtitle naming the code is identification
    expect(
      hasCode('series-unexplained', {
        charts: [chart({ type: 'column', data: pyRef, options: { title: 'Ahead of last year', subtitle: { measure: 'Revenue', scenarios: ['AC', 'PY'] } } })],
      }),
    ).toBe(false);
    // 'AC' must match as a word, not inside 'across'
    expect(
      hasCode('series-unexplained', {
        charts: [chart({ type: 'column', data: { ...pyRef, series: [pyRef.series[0], { ...pyRef.series[1], scenario: 'AC' }] }, options: { title: 'T', subtitle: 'across regions' } })],
      }),
    ).toBe(true);
    // canonical notation pair: AC/PL data series, subtitle carries the codes → no warning
    const acPl = {
      categories: [{ id: 'q1' }],
      series: [
        { id: 'ac', label: 'Revenue AC', scenario: 'AC', values: [10] },
        { id: 'pl', label: 'Revenue PL', scenario: 'PL', values: [12] },
      ],
    };
    expect(
      hasCode('series-unexplained', {
        charts: [chart({ type: 'column', data: acPl, options: { title: 'Above plan', subtitle: { measure: 'Revenue', scenarios: ['AC', 'PL'] } } })],
      }),
    ).toBe(false);
  });

  it('series-unexplained respects direct labeling: default line endpoints clear it, seriesLabels none does not', () => {
    const data = {
      categories: [{ id: 'q1' }, { id: 'q2' }],
      series: [
        { id: 'a', label: 'DACH', values: [10, 12] },
        { id: 'b', label: 'APAC', values: [8, 9] },
      ],
    };
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'line', data })] })).toBe(false);
    expect(
      hasCode('series-unexplained', {
        charts: [chart({ type: 'line', data, options: { title: 'APAC closes the gap', seriesLabels: 'inline', valueLabels: 'none' } })],
      }),
    ).toBe(false);
    expect(
      hasCode('series-unexplained', {
        charts: [chart({
          type: 'line',
          data,
          options: { title: 'APAC closes the gap', valueLabels: 'all', labels: { point: ['series'] } },
        })],
      }),
    ).toBe(false);
    // Without names the key row names the series, unless the legend is turned off.
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'line', data, options: { title: 'APAC closes the gap', seriesLabels: 'none', valueLabels: 'none', legend: 'none' } })] })).toBe(true);
    const withNullOnly = {
      ...data,
      series: [
        { id: 'visible', label: 'Visible', values: [1, 2] },
        { id: 'empty-a', label: 'Empty A', values: [null, null] },
        { id: 'empty-b', label: 'Empty B', values: [null, null] },
      ],
    };
    expect(
      hasCode('series-unexplained', {
        charts: [chart({ type: 'line', data: withNullOnly, options: { title: 'Visible series rises' } })],
      }),
    ).toBe(false);
    // combo: a line-kind series is named when the author asks for names on
    // 'point'; a single unlabeled bar series is carried by the title
    const comboData = {
      categories: [{ id: 'q1' }, { id: 'q2' }],
      series: [
        { id: 'rev', label: 'Revenue', kind: 'column', values: [10, 12] },
        { id: 'margin', label: 'Margin', kind: 'line', values: [3, 4] },
      ],
    };
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'combo', data: comboData, options: { labels: { point: ['series', 'absolute'] } } })] })).toBe(false);
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'combo', data: comboData })] })).toBe(false);
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'combo', data: comboData, options: { legend: 'none' } })] })).toBe(true);
  });

  it('treats a grid legend as the shared series and scenario explanation', () => {
    const panelData = {
      categories: [{ id: 'q1', label: 'Q1' }],
      series: [
        { id: 'gross', label: 'Gross', values: [10] },
        { id: 'net', label: 'Net', values: [8] },
        { id: 'plan', label: 'Plan', scenario: 'PL', values: [9] },
      ],
    };
    const document = (legend?: unknown): LintDocument => ({
      charts: [
        {
          name: 'exhibit',
          type: 'grid',
          data: {
            panels: [
              {
                id: 'revenue',
                type: 'column',
                data: panelData,
                options: { legend: 'none' },
              },
            ],
          },
          options: { title: 'Net converges on gross', ...(legend !== undefined ? { legend } : {}) },
        },
      ],
    });

    expect(hasCode('series-unexplained', document())).toBe(true);
    expect(hasCode('scenario-unexplained', document())).toBe(true);
    // 'none' cannot hide keys no label names; the grid keeps its legend.
    expect(hasCode('series-unexplained', document('none'))).toBe(false);
    expect(hasCode('scenario-unexplained', document('none'))).toBe(false);
    const suggestion = runDocLints(document()).find((warning) => warning.code === 'series-unexplained');
    expect(suggestion?.suggest).toContain('grid options');

    for (const legend of ['top', { position: 'top' }]) {
      expect(hasCode('series-unexplained', document(legend))).toBe(false);
      expect(hasCode('scenario-unexplained', document(legend))).toBe(false);
    }

    const repeat: LintDocument = {
      charts: [
        {
          name: 'repeat',
          type: 'grid',
          data: {
            repeat: { dimension: 'region', values: ['EU'] },
            template: {
              type: 'column',
              data: { bySlice: { EU: panelData } },
            },
          },
          options: { title: 'Shared regional explanation', legend: 'top' },
        },
      ],
    };
    expect(hasCode('series-unexplained', repeat)).toBe(false);
    expect(hasCode('scenario-unexplained', repeat)).toBe(false);
  });

  it('series-unexplained flags a bare reference marker but leaves scenario-coded references to scenario-unexplained', () => {
    const bareRef = {
      categories: [{ id: 'q1' }],
      series: [
        { id: 'act', label: 'Actual', values: [10] },
        { id: 'ref', label: 'Target', role: 'reference', values: [12] },
      ],
    };
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'column', data: bareRef })] })).toBe(true);
    const scenarioRef = {
      categories: [{ id: 'q1' }],
      series: [
        { id: 'act', label: 'Actual', values: [10] },
        { id: 'ref', label: 'Plan', role: 'reference', scenario: 'PL', values: [12] },
      ],
    };
    expect(hasCode('series-unexplained', { charts: [chart({ type: 'column', data: scenarioRef })] })).toBe(false);
    expect(hasCode('scenario-unexplained', { charts: [chart({ type: 'column', data: scenarioRef })] })).toBe(true);
  });

  it('does not describe a selected palette as inapplicable on semantic panels', () => {
    const tablePanel = (palette?: string) => ({
      id: 'detail',
      type: 'table',
      data: {},
      options: palette === undefined ? {} : { palette },
    });
    const document = (panelPalette?: string): LintDocument => ({
      charts: [{
        name: 'exhibit',
        type: 'grid',
        data: { panels: [tablePanel(panelPalette)] },
        options: { title: 'Detail uses semantic table encodings', palette: 'atlantic' },
      }],
    });

    expect(runDocLints(document())).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'palette-inapplicable' })]),
    );
    expect(runDocLints(document('atlantic'))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'palette-inapplicable' })]),
    );
  });
});

describe('ruleset and CLI integration', () => {
  it('render emits all typed lint codes in JSON and keeps exit code zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'boardplot-lints-'));
    tempDirs.push(dir);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    for (const code of lintCodes) {
      const path = join(dir, `${code}.json`);
      writeFileSync(path, JSON.stringify({ version: 1, charts: [{ ...cliTriggerChart(code), name: code }] }));
      expect(main(['render', path]), code).toBe(0);
      const envelope = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
        ok: boolean;
        warnings: { code: string }[];
      };
      expect(envelope.ok, code).toBe(true);
      expect(envelope.warnings.map((warning) => warning.code), code).toContain(code);
    }
  });
});

const EXPECTED_FIXTURE_FINDINGS: Record<string, LintCode[]> = {
  // Input-only lints cannot see the axis-title keys. Render lints use their drawn geometry.
  'combo/revenue-units-dual-axis-anatomy': ['series-unexplained'],
  'combo/theme-dual-axis-anatomy': ['series-unexplained'],
  // Notation subtitles naming every scenario code
  // (e.g. " · AC vs FC") satisfy scenario-unexplained; 'Other'/'Others'
  // any-case satisfies the pie exception
  'funnel/sliver-segments': ['unlabeled-units'],
  'funnel/single-stage': ['missing-message-title', 'unlabeled-units'],
  // Host owns the visible heading; the reporting advice remains available.
  'line/era-event-markers': ['unlabeled-units'],
  // The host card owns the heading and the notes.
  // Cohort fixtures with partial names explicitly hide the legend.
  // Keep the unnamed-series warning as well as the overload advice.
  'line/cohort-curves': ['series-overload'],
  'line/cohort-curves-line-end': ['series-overload', 'series-unexplained'],
  'line/cohort-curves-gutter': ['series-overload', 'series-unexplained'],
  // Both codes are FALSE POSITIVES on a fan, recorded here rather than
  // silenced. Both lints read the DOC and
  // know nothing about `options.fan`, so they count band-bound series as
  // drawn lines (the lint trusts the
  // options, the renderer draws something else):
  //  · series-overload on fan-torture counts 9 "data series" where the layout
  //    draws ONE line and four washes; "show the top series" would delete the
  //    uncertainty that is the exhibit.
  //  · legend-redundant (info) says "the authored legend repeats series names
  //    requested by direct line labels". On a fan it does not: the bound
  //    series are never named on the page, and the extra legend keys are the
  //    BAND labels, which nothing else on the exhibit says.
  // A fan-aware fix belongs in the shared lint.
  'line/fan-retrospective': ['legend-redundant'],
  'line/fan-torture': ['series-overload', 'legend-redundant'],
  'line/revenue-forecast-fan': ['legend-redundant'],
  // A kpi card's label and figure are its message: no missing-message-title.
  'kpi/value-only': ['unlabeled-units'],
  'kpi/spark-nulls': ['unlabeled-units'],
  'kpi/mode-both': ['scenario-unexplained'],
  // The compact bullet, 120 x 28, is hosted inside someone else's card, and
  // that card carries the message.
  'bullet/compact-120': ['missing-message-title'],
  'pie/ten-tiny-slices': ['pie-too-many-slices'],
  'table/steering-monthly': ['scenario-unexplained'],
};

describe('all registered fixtures', () => {
  it('has zero unexpected lint findings across every registered chart type', () => {
    const findings: Record<string, LintCode[]> = {};
    for (const { type } of listCharts()) {
      for (const fixture of getFixtures(type)) {
        const codes = runDocLints({
          charts: [{
            name: fixture.id,
            type,
            data: fixture.data,
            options: fixture.options as Record<string, unknown> | undefined,
            annotations: fixture.annotations,
          }],
        }).map((warning) => warning.code);
        if (codes.length > 0) findings[`${type}/${fixture.id}`] = codes;
      }
    }
    expect(findings).toEqual(EXPECTED_FIXTURE_FINDINGS);
  });
});


describe('optional lint source paths', () => {
  it('keeps explicit panel indexes and escapes repeat slice keys in nested grids', () => {
    const leaf = cliTriggerChart('duplicate-category-labels');
    const doc: LintDocument = { charts: [{
      type: 'grid',
      data: { panels: [null, {
        id: "panel/'~", type: 'grid', data: {
          repeat: { values: [null, "slice/'~"] },
          template: { type: 'grid', data: { bySlice: {
            "slice/'~": { panels: [false, leaf] },
          } } },
        },
      }] },
    }] };
    const warnings = runDocLints(doc, true);
    expect(warnings.find((warning) => warning.code === 'duplicate-category-labels')?.path)
      .toBe("/charts/0/data/panels/1/data/template/data/bySlice/slice~1'~0/panels/1");
    expect(warnings.find((warning) => warning.code === 'missing-message-title')?.path).toBe('/charts/0');
    expect(warnings.map(({ path: _path, ...warning }) => warning)).toEqual(runDocLints(doc));
    expect(runDocLints(doc).every((warning) => !('path' in warning))).toBe(true);
    expect(runDocLints(doc, false)).toEqual(runDocLints(doc));
  });

  it('points repeat warnings at the authored slice data', () => {
    const doc: LintDocument = { charts: [{ type: 'grid', data: {
      repeat: { values: ['a/b~c'] },
      template: { type: 'line', data: { bySlice: { 'a/b~c': cliTriggerChart('duplicate-category-labels').data } } },
    } }] };
    expect(runDocLints(doc, true).find((warning) => warning.code === 'duplicate-category-labels')?.path)
      .toBe('/charts/0/data/template/data/bySlice/a~1b~0c');
  });
});

// The details of a cell folded into Others left the hover card with no word to the author.
describe('details-topn-omitted', () => {
  const data = {
    categories: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }],
    series: [{ id: 's', values: [{ number: 20 }, { number: 10, details: { deals: 5 } }, { number: 5 }] }],
  };
  const warning = (type: string, topN: unknown) => (render({ spec: { type, data, options: { topN } } }).body.warnings as { code: string; message: string }[])
    .find(({ code }) => code === 'details-topn-omitted');

  it('names the details butterfly folds into Others', () => {
    const series = [data.series[0]!, { id: 't', values: [1, 2, 3] }];
    const { warnings } = render({ spec: { type: 'butterfly', data: { ...data, series }, options: { a: 's', b: 't', topN: { n: 1, rest: true } } } }).body as { warnings: { code: string; message: string }[] };
    expect(warnings.find(({ code }) => code === 'details-topn-omitted')?.message).toContain('details of Beta were dropped (deals)');
  });

  for (const type of ['pie', 'bar', 'column', 'mekko']) it(`names the details ${type} folds into Others`, () => {
    expect(warning(type, { n: 1, rest: true })?.message).toContain('details of Beta were dropped (deals)');
    expect(warning(type, { n: 2, rest: true })).toBeUndefined();
  });
});
