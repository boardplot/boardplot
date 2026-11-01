/**
 * Internationalisation: locale-driven numbers and dates through the shared
 * helpers, the built-in wording block (Others, Total, Source, legend count) with
 * caller overrides, and the documented meaning of categoryAxis.dateTicks plus
 * locale.weekStartsOn.
 */
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { getChartDefinition } from '../src/core/registry';
import { requireGeometry } from '../src/core/sizing';
import { dateTickKeep, formatDate } from '../src/core/dateFormat';
import { resolveChartRequest } from '../src/core/request';
import { chartString as funnelString } from '../src/core/strings/funnel';
import { chartString as layoutString } from '../src/core/strings/createChartComponent';

const pieFixture = () => getFixtures('pie').find((fixture) => fixture.id === 'streaming-genre-share')!;

function layout(type: string, fixture: { data: unknown; options?: unknown }, extra: Record<string, unknown> = {}) {
  const def = getChartDefinition(type)!;
  return requireGeometry(def.layout(def.normalize(fixture.data) as never, {
    ...def.defaults,
    ...(fixture.options ?? {}),
    ...extra,
  } as never));
}

function texts(geo: { scene: readonly unknown[] }): string {
  return geo.scene
    .filter((node): node is { t: string; lines: string[] } => (node as { t?: string }).t === 'text')
    .map((node) => node.lines.join(' '))
    .join(' | ');
}

describe('locale numbers and dates', () => {

  it('formats month names and numeric dates for de and en', () => {
    const date = new Date(Date.UTC(2026, 4, 15));
    expect(formatDate(date, 'd MMMM yyyy')).toBe('15 May 2026');
    expect(formatDate(date, 'd MMMM yyyy', 'de')).toBe('15 Mai 2026');
    expect(formatDate(date, 'dd.MM.yyyy')).toBe('15.05.2026');
    expect(formatDate(date, 'dd.MM.yyyy', 'de-DE')).toBe('15.05.2026');
  });
});

describe('built-in wording block', () => {
  it('inherits provider strings and lets an explicit chart option win per key', () => {
    const fixture = pieFixture();
    const inherited = resolveChartRequest(
      { type: 'pie', data: fixture.data, options: {} },
      { strings: { others: 'Andere', total: 'Summe' } },
    );
    expect(inherited.options.strings).toEqual({ others: 'Andere', total: 'Summe' });
    const overridden = resolveChartRequest(
      { type: 'pie', data: fixture.data, options: { strings: { others: 'Sonstige' } } },
      { strings: { others: 'Andere', legendCount: '{count} Reihen' } },
    );
    expect(overridden.options.strings).toEqual({ others: 'Sonstige', legendCount: '{count} Reihen' });
  });

  it('names the Others bucket from strings and still lets topN.restLabel win', () => {
    const fixture = pieFixture();
    const fromStrings = texts(layout('pie', fixture, { topN: { n: 3 }, strings: { others: 'Sonstige' } }));
    expect(fromStrings).toContain('Sonstige');
    expect(fromStrings).not.toContain('Others');
    const fromOption = texts(layout('pie', fixture, {
      topN: { n: 3, restLabel: 'Uebrige' },
      strings: { others: 'Sonstige' },
    }));
    expect(fromOption).toContain('Uebrige');
    expect(fromOption).not.toContain('Sonstige');
  });

  it('writes the source line with the requested word', () => {
    const fixture = pieFixture();
    expect(texts(layout('pie', fixture))).toContain('Source: Brevinth label analytics, FY25');
    expect(texts(layout('pie', fixture, { strings: { source: 'Quelle' } })))
      .toContain('Quelle: Brevinth label analytics, FY25');
  });
});

describe('default reader wording', () => {
  // The default notes read as plain sentences: no interval notation, no "Others includes", no capitals for emphasis, no "CVR" jargon.
  it('words the pyramid method note, the sankey Other note, the funnel heads and the hover hint in plain words', () => {
    const pyramid = getFixtures('pyramid').find((fixture) => fixture.id === 'dated-population-comparison')!;
    const method = texts(layout('pyramid', pyramid, { methodNote: true, shareOfTotal: true }));
    expect(method).not.toMatch(/\[from, to\)|equally wide|BOTH/);
    expect(method).toContain('The youngest band is at the bottom.');
    const sankey = getFixtures('sankey').find((fixture) => fixture.id === 'channel-journeys')!;
    expect(texts(layout('sankey', sankey))).toContain('Others (Channel): Display 9, Affiliates 7');
    for (const locale of [undefined, 'de']) {
      const options = { locale: locale as 'de' | undefined };
      expect(funnelString(options, 'stepCvr') + funnelString(options, 'totalCvr')).not.toContain('CVR');
    }
    expect(layoutString({}, 'hoverMoreListed')).toContain('tap or hover');
  });
});

describe('categoryAxis.dateTicks', () => {
  // Thinned day ticks must keep their month and the year of each surviving tick.
  it('keeps the month in every day tick on a narrow date axis', () => {
    const days = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i * 2)).toISOString().slice(0, 10));
    const geo = layout('line', { data: {
      categories: days.map((id) => ({ id, date: id })),
      series: [{ id: 'v', label: 'Visits', values: days.map((_, i) => 1000 + i) }],
    } }, { size: { width: 360, height: 320 } });
    const ticks = geo.scene.filter(node => node.t === 'text' && node.id.startsWith('label:category:'));
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) if (tick.t === 'text') expect(tick.lines.join(' ')).toMatch(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
    const dates = Array.from({ length: 20 }, (_, i) => `${2000 + i}-07-04`);
    for (const type of ['column', 'line']) {
      const sparse = layout(type, { data: {
        categories: dates.map(id => ({ id, date: id })),
        series: [{ id: 'v', label: 'Count', values: dates.map((_, i) => 10 + i) }],
      } }, { size: { width: 360, height: 320 } });
      const days = sparse.scene.flatMap(node => node.t === 'text' && node.id.startsWith('label:category:')
        ? [node.owner.categoryId!.slice(0, 4)] : []);
      const years = sparse.scene.flatMap(node => node.t === 'text' && node.id.startsWith('label:category-year:') ? node.lines : []);
      expect(years, type).toEqual(days);
      expect(years, type).toContain('2019');
    }
  });

  const data = {
    categories: [
      { id: 'q1-24', label: 'Q1 24', date: '2024-03-31' },
      { id: 'q2-24', label: 'Q2 24', date: '2024-06-30' },
      { id: 'q3-24', label: 'Q3 24', date: '2024-09-30' },
      { id: 'q4-24', label: 'Q4 24', date: '2024-12-31' },
      { id: 'q1-25', label: 'Q1 25', date: '2025-03-31' },
      { id: 'q2-25', label: 'Q2 25', date: '2025-06-30' },
    ],
    series: [{ id: 'revenue', label: 'Revenue', values: [10, 12, 14, 16, 18, 20] }],
  };

  it('labels the first category of each calendar interval, then the latest period', () => {
    const yearly = texts(layout('line', { data, options: {} }, { categoryAxis: { dateTicks: 'years' } }));
    expect(yearly).toContain('Q1 24');
    expect(yearly).toContain('Q1 25');
    expect(yearly).toContain('Q2 25');
    expect(yearly).not.toContain('Q2 24');
    const monthly = texts(layout('line', { data, options: {} }, { categoryAxis: { dateTicks: 'months' } }));
    expect(monthly).toContain('Q2 24');
    expect(monthly).toContain('Q2 25');
  });

  // A default two-year daily row printed day numbers that drift from month to month ("3 2 1 31 30").
  it.each(['line', 'column', 'combo'])('names months on a default %s day row that steps past four weeks', (type) => {
    const days = Array.from({ length: 730 }, (_, i) => new Date(Date.UTC(2024, 9, 25 + i)).toISOString().slice(0, 10));
    const daily = { categories: days.map((date) => ({ id: date, date })), series: [{ id: 'sessions', label: 'Sessions', values: days.map((_, i) => 1000 + (i % 7) * 100) }] };
    const row = `| ${texts(layout(type, { data: daily, options: {} }))} |`;
    expect(row).toContain('| Jan 2025 |');
    expect(row).not.toMatch(/\| ([1-9]|[12]\d|3[01]) \|/);
    // Days named by their ISO ids alone take the same month row, with no warning about an option nobody set.
    const byId = layout(type, { data: { ...daily, categories: days.map((id) => ({ id })) }, options: {} });
    expect(`| ${texts(byId)} |`).toContain('| Jan 2025 |');
    expect(byId.warnings.map((warning) => warning.code)).not.toContain('date-ticks-unsupported');
  });

  // Passes reuse the last month row; ids that hold spaces and newlines must not make two lists share it.
  it('keeps the month rows of two category lists apart', () => {
    const days = Array.from({ length: 730 }, (_, i) => new Date(Date.UTC(2024, 9, 25 + i)).toISOString().slice(0, 10));
    const a = days.map((date, i) => ({ id: `c${i}`, date }));
    const b = [{ id: `c0 ${days[0]}\nc1`, date: days[1]! }, ...a.slice(2)];
    const data = (categories: typeof a) => ({ categories, series: [{ id: 'v', label: 'Value', values: categories.map((_, i) => 1000 + (i % 7) * 100) }] });
    const alone = texts(layout('column', { data: data(b) }));
    layout('column', { data: data(a) });
    expect(texts(layout('column', { data: data(b) }))).toBe(alone);
  });

  it('refuses the combination when a category carries no ISO date', () => {
    const undated = { ...data, categories: data.categories.map((category, index) => index === 1
      ? { id: category.id, label: category.label }
      : category) };
    const geo = layout('line', { data: undated, options: {} }, { categoryAxis: { dateTicks: 'years' } });
    expect(geo.warnings.some((warning) => warning.code === 'date-ticks-unsupported')).toBe(true);
    expect(texts(geo)).toContain('Q2 24');
  });

  it('reports weekStartsOn when the interval cannot use it', () => {
    const geo = layout('line', { data, options: {} }, {
      categoryAxis: { dateTicks: 'quarters' },
      locale: { weekStartsOn: 0 },
    });
    expect(geo.warnings.some((warning) => warning.code === 'week-start-ignored')).toBe(true);
  });

  it('moves the week boundary with weekStartsOn', () => {
    const dates = ['2024-03-02', '2024-03-03', '2024-03-04'];
    expect(dateTickKeep(dates, 'weeks', 1)).toEqual([true, false, true]);
    expect(dateTickKeep(dates, 'weeks', 0)).toEqual([true, true, false]);
    expect(dateTickKeep(dates, 'months')).toEqual([true, false, false]);
    expect(dateTickKeep(dates, 'quarters')).toEqual([true, false, false]);
    expect(dateTickKeep(['2024-03-02', undefined], 'years')).toBeNull();
  });
});

describe('provider locale reaches chart layout', () => {
  const data = { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    series: [{ id: 'value', label: 'Value', values: [12.5, 1234.5] }] };
  // The language changes words only: an inherited German language must not switch the marks, and the inherited marks reach authored examples too.
  it.each(['column', 'bar', 'line', 'dot'])('%s keeps the default marks under an inherited language and takes inherited marks', (type) => {
    const request = resolveChartRequest({ type, data, options: { size: { width: 1000, height: 550 } } }, { locale: 'de-DE' });
    const geo = requireGeometry(getChartDefinition(type)!.layout(request.data as never, request.options as never));
    expect(texts(geo)).toContain('1,234.5');
    expect(texts(geo)).not.toContain('1.234,5');
    const explicit = resolveChartRequest({ type, data, options: { format: '1,234.5', size: { width: 1000, height: 550 } } }, { locale: { language: 'de-DE', decimal: ',' } });
    expect(texts(requireGeometry(getChartDefinition(type)!.layout(explicit.data as never, explicit.options as never))))
      .toContain('1.234,5');
  });
  // Explicit marks reach charts outside the table family: an axis tick or value label from an English example must not keep its point.
  it('prints axis ticks and value labels with explicit locale marks', () => {
    const geo = layout('line', { data: { ...data, series: [{ ...data.series[0]!, values: [1.5, 2.25] }] }, options: { format: '1.25', locale: { decimal: ',' } } });
    expect(texts(geo)).toMatch(/\d,\d/);
    expect(texts(geo)).not.toMatch(/\d\.\d/);
  });
  it('keeps the default marks for unauthored table numbers under a language', () => {
    const request = resolveChartRequest({ type: 'table', data: {
      columns: [{ id: 'name', kind: 'rowLabel', label: 'Name' }, { id: 'value', kind: 'value', label: 'Value' }],
      rows: [{ id: 'a', label: 'A', cells: { value: 12.5 } }],
    }, options: {} }, { locale: 'de-DE' });
    const table = getChartDefinition('table')!.layout(request.data as never, request.options as never) as any;
    expect(JSON.stringify(table)).toContain('12.5');
    expect(JSON.stringify(table)).not.toContain('12,5');
  });
});

// Cohort defaults must use German words without changing authored labels or number separators.
it('uses German wording in cohort heatmaps and exhibit tables', () => {
  const data = { cohorts: [
    { id: 'a', label: 'Authored Alpha', active: [1000, 600, 400] },
    { id: 'b', label: 'Authored Beta', active: [800, 400] },
    { id: 'c', label: 'Authored Gamma', active: [500] },
  ] };
  for (const variant of ['heatmap', 'pure', 'stepped']) {
    const geo = layout('cohort', { data }, { variant, locale: { language: 'de' },
      size: { width: 1000, height: 800 }, averages: 'weighted', total: 'weighted', methodNote: true,
      notes: { show: ['note', 'method', 'disclosure'], placement: 'frame' } });
    const words = texts(geo);
    expect(words).toContain('Authored Alpha');
    expect(words).toContain('Periode 0');
    expect(words).not.toMatch(/Retention|Cohort size|Weighted average|Period [0-9]|Low|High|blank|cohorts/);
    expect(words).not.toContain('1.000');
    expect(geo.a11y.desc).not.toMatch(/Cohort |cohorts|Weighted average|not reached/);
  }
});
