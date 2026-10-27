/**
 * A number the engine changed, or one that is incomplete, says so on the
 * chart itself, since its engine note does not print by default.
 */
import { describe, expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { resolveTable } from '../src/core/charts/table';
import { getChart } from '../src/core/registry';
import type { Fixture } from '../src/core/registry';
import type { TableData } from '../src/core/types/table';
import { renderGolden } from './golden/render';
import { saysToDate } from '../src/core/partialPeriod';
import { render } from '../src/cli/render';

const texts = (type: string, data: unknown, options: Record<string, unknown>): string[] => {
  const svg = renderGolden(getChart(type)! as never, { id: 'probe', data, options } as Fixture, 'authored').output;
  return [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));
};

describe('value integrity on the chart', () => {
  // A styled KPI eyebrow must keep a metric's authored case, including names such as eTest and YoY.
  it('keeps authored metric names under the house eyebrow style', () => {
    const fixture = getFixtures('kpi').find((item) => item.id === 'house-eyebrow')!;
    const data = { ...(fixture.data as object), label: 'eTest YoY' };
    expect(texts('kpi', data, fixture.options as Record<string, unknown>)).toContain('eTest YoY');
  });

  // A restating total that equals the sum of the siblings it can see read as complete when one sibling is missing.
  it('a total that equals a partial sibling sum prints marked partial, with or without disclosures', () => {
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', format: '0' }],
      rows: [{ id: 'a', cells: { v: 10 } }, { id: 'b', cells: {} }, { id: 'total', role: 'total', cells: { v: 10 } }],
    };
    for (const options of [{}, { notes: { show: ['note', 'disclosure'] as const } }]) {
      const total = resolveTable(data, options as never).table.rows.find((row) => row.id === 'total')!;
      expect(total.cells.v!.displayed).toBe('10 (partial)');
    }
  });

  // A series rebase100 could not index was left out with nothing on the chart saying so.
  it('a series left out by rebase100 is named in the key, unless its disclosure prints', () => {
    const data = {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }],
      series: [{ id: 'a', label: 'Alpha', values: [null, 12, 13] }, { id: 'b', label: 'Beta', values: [20, 21, 22] }],
    };
    const options = { variant: 'stacked-area', rebase100: true };
    expect(texts('line', data, options)).toContain('Alpha not shown: missing base at Q1');
    expect(texts('line', data, { ...options, notes: { show: ['note', 'disclosure'] } }).filter((text) => text.startsWith('Alpha not shown'))).toEqual(['Alpha not shown: missing base at Q1.']);
  });

  // A plain line with no index base was left out with only a warning.
  it('a plain line series left out by rebase100 is named in the key', () => {
    const data = {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }],
      series: [{ id: 'a', label: 'Alpha', values: [0, 12, 13] }, { id: 'b', label: 'Beta', values: [20, 21, 22] }],
    };
    expect(texts('line', data, { rebase100: true })).toContain('Alpha not shown: zero base at Q1');
  });

  // At the compact plot floor the series' own filled key entry came back as if it were drawn.
  it('compact mode keeps the left-out series key entry, never a filled one', () => {
    const data = {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }],
      series: [{ id: 'a', label: 'Alpha', values: [null, 12, 13] }, { id: 'b', label: 'Beta', values: [20, 21, 22] }],
    };
    const shown = texts('line', data, { variant: 'stacked-area', rebase100: true, mode: 'compact', legend: 'top', size: { width: 320, height: 180 } });
    expect(shown).not.toContain('Alpha');
    expect(shown).toContain('Alpha not shown: missing base at Q1');
  });

  // A column too thin to draw had a note but no key entry: one rule (the drawn width) names both.
  it('a mekko column too thin to draw is named in the key', () => {
    const data = {
      categories: [{ id: 'n', label: 'North' }, { id: 's', label: 'South' }, { id: 't', label: 'Tiny' }],
      series: [{ id: 'a', label: 'A', values: [600, 500, 0.0001] }, { id: 'b', label: 'B', values: [400, 500, 0.0001] }],
    };
    expect(texts('mekko', data, {})).toContain('Not drawn (total 0 or too thin): Tiny');
  });

  // A point with no x or y was dropped with only a warning.
  it('scatter names points with no x or y in the key', () => {
    const data = { points: [{ id: 'p', label: 'P', x: 1, y: 2 }, { id: 'q', label: 'Q', x: 3, y: 4 }, { id: 'g', label: 'Ghost', x: 5, y: null }] };
    expect(texts('scatter', data, {})).toContain('1 point with no x or y not drawn: Ghost');
  });

  // A bar row for a running period drew hatched with no word, where a column says "to date".
  it('a bar chart running period says "to date" on its value', () => {
    const data = { categories: [{ id: 'w1', label: 'W1' }, { id: 'w2', label: 'W2' }, { id: 'w3', label: 'W3', partial: true }], series: [{ id: 's', label: 'Orders', values: [3, 4, 2] }] };
    expect(texts('bar', data, {})).toEqual(expect.arrayContaining(['W3', '2', 'to date']));
  });

  // A negative stage drawn at zero printed "0", a value the data does not hold.
  it('a funnel stage drawn at zero prints its true value', () => {
    const data = { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], series: [{ id: 's', label: 'Deals', values: [100, 40, -5] }] };
    expect(texts('funnel', data, {})).toContain('−5');
  });

  // An unkeyed running period read as a full one, and a label that already said so got the words twice.
  it('a running period without a key says "to date" once, on a line under its axis name', () => {
    const series = [{ id: 's', label: 'Orders', values: [3, 4, 2] }];
    const cats = (last: string) => [{ id: 'w1', label: 'W1' }, { id: 'w2', label: 'W2' }, { id: 'w3', label: last, partial: true }];
    const shown = texts('line', { categories: cats('W3'), series }, {});
    expect(shown).toContain('W3');
    expect(shown).toContain('to date');
    const already = texts('line', { categories: cats('W3 to date'), series }, {});
    expect(already).toContain('W3 to date');
    expect(already.filter((text) => /to date/i.test(text))).toHaveLength(1);
  });

  // A two-line partial-period label thinned the whole axis: the second line must cost no name.
  it('the "to date" line drops no axis name the row draws without it', () => {
    const categories = Array.from({ length: 13 }, (_, i) => ({ id: `w${i + 27}`, label: `W${i + 27}` }));
    const series = [{ id: 's', label: 'Orders', values: categories.map((_, i) => 10 + i) }];
    const names = (partial: boolean) => texts('column', { categories: categories.map((c, i) => (partial && i === 12 ? { ...c, partial: true } : c)), series }, { size: { width: 480 } })
      .filter((text) => /^W\d+$/.test(text));
    expect(names(true)).toEqual(names(false));
  });

  // Mixed-case and English words under another locale already say it: a second cue repeated them.
  it('saysToDate reads any case and the English words under any locale', () => {
    expect(saysToDate('Sep To Date', 'to date')).toBe(true);
    expect(saysToDate('Sep to date', 'bis heute')).toBe(true);
    expect(saysToDate('Sep MTD', 'to date')).toBe(true);
    expect(saysToDate('Sep', 'bis heute')).toBe(false);
  });

  // A centered funnel printed "0%" cumulative beside a stage whose data value is negative.
  it('a funnel stage drawn at zero has no cumulative conversion', () => {
    const data = { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], series: [{ id: 's', label: 'Deals', values: [100, 40, -5] }] };
    const shown = texts('funnel', data, { variant: 'centered', totalCvr: 'column' });
    expect(shown).toContain('40%');
    expect(shown).not.toContain('0%');
  });

  // A bn-scale total restating a partial sum differs from it by float noise, not by a real gap.
  it('a bn-scale total that restates a partial sum prints marked partial', () => {
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', format: '0' }],
      rows: [{ id: 'a', cells: { v: 1234567890.12 } }, { id: 'b', cells: { v: 9876543210.98 } }, { id: 'c', cells: {} }, { id: 'total', role: 'total', cells: { v: 11111111101.1 } }],
    };
    const total = resolveTable(data, {} as never).table.rows.find((row) => row.id === 'total')!;
    expect(total.cells.v!.displayed).toMatch(/\(partial\)$/);
  });

  // "n.m. (+9)" in a percent chart read as +9 %, while it is an absolute change in the measure's unit.
  it('a suppressed percent change prints its absolute change with its unit', () => {
    const data = {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [{ id: 'ac', label: 'AC', values: [14, 7] }, { id: 'py', label: 'PY', role: 'reference', scenario: 'PY', values: [10, 0] }],
    };
    expect(texts('variance', data, { variant: 'relative', variance: { of: 'ac', vs: 'py' }, unit: '€k' })).toContain('n.m. (+€7k)');
    // The relative chart's own unit '%' names the change, not the measure: the absolute change prints bare.
    expect(texts('variance', data, { variant: 'relative', variance: { of: 'ac', vs: 'py' }, unit: '%' })).toContain('n.m. (+7)');
  });

  // With footnotes off no value carries a marker, so a numbered engine state note pointed at nothing.
  it('metric stack: footnotes off leaves no numbered engine note without its mark', () => {
    const definition = getChart('grid')!;
    const fixture = getFixtures('grid').find((f) => f.id === 'metric-stack-steps')!;
    const data = structuredClone(fixture.data) as { states?: { partial?: { footnote?: string }; maturing?: { footnote?: string } } };
    delete data.states?.partial?.footnote;
    delete data.states?.maturing?.footnote;
    const options = { ...definition.defaults, ...fixture.options, footnotes: false, notes: { show: ['note', 'disclosure'] } };
    const geometry = definition.layout(definition.normalize!(data), options as never) as { frame?: { noteList?: { text: string; ref?: number }[] } };
    expect(geometry.frame?.noteList?.filter((note) => note.ref !== undefined) ?? []).toEqual([]);
  });
});

// An inside actual label wider than its variance column read across the neighbouring columns.
it('keeps variance actual labels within their own column or reports their omission', () => {
  const data = {
    categories: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, label: `C${i}` })),
    series: [{ id: 'ac', label: 'AC', values: Array.from({ length: 12 }, (_, i) => 10000 + i * 123) },
      { id: 'py', role: 'reference' as const, scenario: 'PY' as const, values: Array.from({ length: 12 }, () => 9000) }],
  };
  const geometry = getChart('variance')!.layout(data, {
    variant: 'integrated', variance: { of: 'ac', vs: 'py' }, format: '1,000', size: { width: 480 },
  }) as any;
  for (const label of geometry.labels.filter((label: any) => label.kind === 'total' && !label.hidden)) {
    const bar = geometry.marks.bars.find((bar: any) => bar.categoryId === label.owner.categoryId);
    expect(label.rect.x).toBeGreaterThanOrEqual(bar.rect.x);
    expect(label.rect.x + label.rect.w).toBeLessThanOrEqual(bar.rect.x + bar.rect.w);
  }
  // A missing seat must use the existing omission warning.
  expect(geometry.warnings.map((warning: any) => warning.code)).toContain('values-in-note');
});

// A last value with a key of names could take a shifted seat two rows away from its point.
it('keeps last line values next to their own point', () => {
  const geometry = getChart('line')!.layout({
    categories: ['a', 'b', 'c'].map(id => ({ id })),
    series: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: `Series ${i}`,
      values: [20 + i * 10, 50 + i * 10, { number: 100 + i, label: '${value}' }] })),
  }, { seriesLabels: 'key', size: { width: 680 } }) as any;
  for (const label of geometry.labels.filter((label: any) => label.kind === 'point' && !label.hidden)) {
    const point = geometry.marks.series.find((series: any) => series.seriesId === label.owner.seriesId).points.at(-1);
    const gap = Math.max(label.rect.y - point.y, point.y - label.rect.y - label.rect.h, 0);
    expect(gap, label.id).toBeLessThanOrEqual(label.rect.h);
  }
});

// Authored end names and an authored key must both draw, with a repair for their repeated names.
it('keeps authored stacked-area end names and key and offers a repair for the repeat', () => {
  const data = { categories: ['a', 'b', 'c'].map(id => ({ id })), series: [
    { id: 'a', label: 'Alpha', values: [30, 40, 50] }, { id: 'b', label: 'Beta', values: [20, 30, 40] },
  ] };
  const options = { variant: 'stacked-area', seriesLabels: 'end', legend: 'top', size: { width: 960 } };
  const geometry = getChart('line')!.layout(data, options) as any;
  expect(geometry.scene.filter((node: any) => node.part === 'legendLabel').map((node: any) => node.lines.join(' '))).toEqual(['Alpha', 'Beta']);
  expect(geometry.labels.filter((label: any) => label.kind === 'series' && !label.hidden).map((label: any) => label.text)).toEqual(['Alpha', 'Beta']);
  const shown = texts('line', data, options);
  expect(shown).toContain('50');
  expect(shown).toContain('40');
  const body = render({ spec: { type: 'line', data, options }, return: ['svg'] }).body as { warnings: { code: string; message: string; fix?: unknown[] }[] };
  const repeats = body.warnings.filter(warning => warning.code === 'legend-redundant');
  expect(repeats).toHaveLength(1);
  expect(repeats[0]!.message).toContain('options.legend');
  expect(repeats[0]!.message).toContain('options.seriesLabels');
  expect(repeats[0]!.fix).toEqual([{ op: 'remove', path: '/options/legend' }]);
  const repaired = getChart('line')!.layout(data, { ...options, legend: undefined }) as any;
  expect(repaired.legend).toBeUndefined();
});

// Automatic step numbers sorted by id while the steps drew in source order, so Review left of Deliver printed 2 and 1.
it('numbers linear-process steps in drawn order, with and without order', () => {
  const step = (id: string, order?: number) => ({ id, kind: 'step', shape: { kind: 'rectangle' }, label: id, ...(order === undefined ? {} : { order }) });
  for (const nodes of [[step('review'), step('deliver')], [step('review'), step('deliver', 10), step('archive')]]) {
    const geometry = getChart('diagram')!.layout({ nodes }, { variant: 'linear-process', size: { width: 800, height: 350 } }) as any;
    const badges = geometry.labels.filter((label: any) => label.id.startsWith('badge-label:')).sort((a: any, b: any) => a.rect.x - b.rect.x);
    expect(badges.map((label: any) => label.text)).toEqual(nodes.map((_, index) => String(index + 1)));
  }
});
