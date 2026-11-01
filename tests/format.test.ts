import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { tickFormatter } from '../src/core/axis';
import { compositeColor } from '../src/core/color';
import { layoutScatter } from '../src/core/charts/scatter/layout';
import { logSpecFormat } from '../src/core/charts/scatter/logAxis';
import { formatAutomaticNumber as formatAutomaticNumberSync, formatNumber } from '../src/core/format';
import { shareSetDecimals } from '../src/core/formatPrecision';
import { shareSetFormatter } from '../src/core/format';
import { defaultFormatSpec, formatWithSpec, parseFormatExample, sameUnit, seriesRasterFormatter, unscaledFormatLint } from '../src/core/formatSpec';
import { niceDomain } from '../src/core/scale';
import type { SceneNode } from '../src/core/types/scene';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';
import { LineChart } from '../src/react/charts/line';
import { TableChart } from '../src/react/charts/table';
import { prepareChart } from '../src/react/prepare';

// Prevents the shared accounting format from giving a false sign on any SVG or React number surface.
it('keeps accounting signs in labels, axes, tables, keys, annotations and accessible descriptions', async () => {
  const data = { categories: ['a', 'b', 'c'].map(id => ({ id })), series: [{ id: 's', label: 'Series', values: [500, 0, -500] }] };
  const options = { format: '$(1,234)', trend: true, valueLabels: 'all', seriesLabels: 'none', valueAxis: { show: true, tickStep: 500 },
    legend: 'bottom', size: { width: 1000, height: 600 }, annotations: [{ kind: 'valueLine', value: 500, label: 'Plan', format: '$(1,234)' }] };
  const request = resolveChartRequest({ type: 'line', data, options } as never);
  const geometry = requireGeometry(layoutResolvedRequest(request));
  const svg = renderSvg(geometry, request.theme);
  const prepared = await prepareChart({ type: 'line', data, options } as never);
  const react = renderToStaticMarkup(createElement(LineChart, { data, ...options, prepared } as never));
  const texts = (output: string, part: string) => [...output.matchAll(new RegExp(`<text\\b[^>]*data-part="${part}"[^>]*>([\\s\\S]*?)<\\/text>`, 'g'))]
    .map(match => match[1]!.replace(/<[^>]*>/g, ''));
  for (const output of [svg, react]) {
    expect(texts(output, 'point')).toContain('$500');
    expect(texts(output, 'point')).toContain('($500)');
    expect(texts(output, 'tick')).toContain('$500');
    expect(texts(output, 'tick')).toContain('($500)');
    expect(texts(output, 'legendLabel').join(' ')).toContain('($500) per period');
    expect(output).toContain('Plan $500');
    const desc = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(output)?.[1];
    expect(desc).toContain('$500');
    expect(desc).toContain('($500)');
    expect(output).not.toContain('$(500)');
  }
  expect(renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme)).toBe(svg);

  const tableData = { columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'v', kind: 'value', label: 'Value', format: '$(1,234)' }],
    rows: [{ id: 'positive', label: 'Positive', cells: { v: 500 } }, { id: 'negative', label: 'Negative', cells: { v: -500 } }] };
  const tableRequest = resolveChartRequest({ type: 'table', data: tableData, options: { size: { width: 600 } } } as never);
  const tableSvg = renderSvg(requireGeometry(layoutResolvedRequest(tableRequest)), tableRequest.theme);
  const tablePrepared = await prepareChart({ type: 'table', data: tableData, options: { size: { width: 600 } } } as never);
  const tableReact = renderToStaticMarkup(createElement(TableChart, { data: tableData, size: { width: 600 }, prepared: tablePrepared } as never));
  for (const output of [tableSvg, tableReact]) {
    expect(output).not.toContain('$(500)');
    expect(output).not.toContain('$()');
    expect(output).toContain('>500<');
    expect(output).toContain('(500)');
  }
  expect(renderSvg(requireGeometry(layoutResolvedRequest(tableRequest)), tableRequest.theme)).toBe(tableSvg);
});

describe('number formatting', () => {
  it('prints distinct ticks above 100 and readable ticks near 0.001', () => {
    const ticks = [100, 100.5, 101];
    expect(ticks.map(tickFormatter(defaultFormatSpec(), ticks))).toEqual(['100.0', '100.5', '101.0']);
    const tiny = [0, 0.001, 0.002];
    expect(tiny.map(tickFormatter(defaultFormatSpec(), tiny))).toEqual(['0.000', '0.001', '0.002']);
    expect(seriesRasterFormatter(undefined, [0.0012, 0.0034]).fmt(0.0012)).toBe('0.0012');
  });

  // Prevents a zero tick that reads as a long decimal beside scientific ticks: "0.0000000000000" under "4.0 × 10⁻¹³".
  it('prints the zero tick as 0 beside ticks in scientific notation', () => {
    const ticks = [0, 1e-13, 2e-13, 3e-13, 4e-13];
    const texts = ticks.map(tickFormatter(defaultFormatSpec(), ticks));
    expect(texts[0]).toBe('0');
    expect(texts.slice(1).every((text) => text.includes('×'))).toBe(true);
  });

  it('signs a derived delta once and never a rounded zero', () => {
    expect(seriesRasterFormatter('+1.0', [18.2]).fmtSigned(18.2)).toBe('+18.2');
    expect(seriesRasterFormatter('1', [1, 3]).fmtSigned(0.2)).toBe('0');
  });

  it('reads leading-zero, leading-separator and unit-with-digit examples', () => {
    expect(formatWithSpec(0.125, parseFormatExample('$0.125'))).toBe('$0.125');
    expect(formatWithSpec(0.5, parseFormatExample('.5'))).toBe('0.5');
    expect(formatWithSpec(3.25, parseFormatExample('CO2 1.2'))).toBe('CO2 3.3');
    expect(parseFormatExample('EUR1.2').prefix).toBe('EUR');
  });

  it('keeps a fixed magnitude instead of rolling it', () => {
    expect(formatNumber(5e6, { magnitude: 'k' })).toBe('5,000k');
  });

  it('snaps a nice domain without float residue', () => {
    expect(niceDomain(0.6, 1.1, 5)).toEqual([0.6, 1.1]);
  });
});

it('keeps authored hover values exact, including ones that look like float residue', async () => {
  const { interactionValueText } = await import('../src/core/a11y/valueText');
  const value = (raw: number) => interactionValueText({ kind: 'number', raw, state: 'value' });
  expect(value(0.1234567890123456)).toBe('0.1234567890123456');
  expect(value(1000000000000001)).toBe('1,000,000,000,000,001');
});

it('reads a raw value with its unit as the marks place it, without the magnitude its cells hoist', async () => {
  const { interactionValueText } = await import('../src/core/a11y/valueText');
  expect(interactionValueText({ kind: 'number', raw: 950000, unit: 'k', scaledUnit: true, state: 'value' })).toBe('950,000');
  expect(interactionValueText({ kind: 'number', raw: 2470000, unit: '$', state: 'value' })).toBe('$2,470,000');
  // A physical unit has no magnitude: "m²" stays whole.
  expect(interactionValueText({ kind: 'number', raw: 1234, unit: 'm²', state: 'value' })).toBe('1,234 m²');
  expect(interactionValueText({ kind: 'number', raw: 950000, unit: 'EURk', scaledUnit: true, state: 'value' })).not.toMatch(/k/);
  // The accessible table names no "(k)" over raw cells, and no one row's unit over a column of several.
  await import('../src/core/charts');
  const { interactionRecords } = await import('../src/core/a11y/records');
  const { accessibleDataTable } = await import('../src/core/a11y/accessibility');
  const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
  const { requireGeometry } = await import('../src/core/sizing');
  const request = resolveChartRequest({ type: 'table', data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Row' },
    { id: 'v', kind: 'value', label: 'Value', format: '1,234k' }, { id: 'a', kind: 'value', label: 'Area', format: '1,234 m²' }],
  rows: [{ id: 'r', label: 'r', cells: { v: 950000, a: 1234 } }] }, options: { title: 'Units' } } as never);
  const table = accessibleDataTable(interactionRecords({ request, geometry: requireGeometry(layoutResolvedRequest(request)), scope: request.scope, claims: [] }));
  expect(table.columns.map((column) => column.unit)).toEqual([undefined]);
  expect(table.rows.map((row) => row.cells[0]!.text)).toEqual(['950,000', '1,234 m²']);
  // A 10¹² scale hoisted in the reader's language (' Bio.', ' Bn') is dropped too: "2 500 000 000 000Bn" read 10¹² times the value.
  for (const language of ['de', 'fr']) {
    const trillions = resolveChartRequest({ type: 'table', data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Row' }, { id: 'v', kind: 'value', label: 'Value', format: '1.0T' }],
      rows: [{ id: 'r', label: 'r', cells: { v: 2.5e12 } }] }, options: { title: 'Trillions', locale: { language } } } as never);
    const text = accessibleDataTable(interactionRecords({ request: trillions, geometry: requireGeometry(layoutResolvedRequest(trillions)), scope: trillions.scope, claims: [] })).rows[0]!.cells[0]!.text;
    expect(text, language).not.toMatch(/Bio|Bn|T/);
  }
  // A literal suffix scales nothing: '1,234 EURk' reads its raw figure with the whole unit.
  const literal = resolveChartRequest({ type: 'table', data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Row' }, { id: 'v', kind: 'value', label: 'Value', format: '1,234 EURk' }],
    rows: [{ id: 'r', label: 'r', cells: { v: 1234 } }] }, options: { title: 'Literal' } } as never);
  const literalTable = accessibleDataTable(interactionRecords({ request: literal, geometry: requireGeometry(layoutResolvedRequest(literal)), scope: literal.scope, claims: [] }));
  expect(literalTable.rows[0]!.cells[0]!.text).toMatch(/EURk/);
  // A magnitude options.magnitude adds is hoisted too: the raw value drops it.
  for (const [magnitude, raw] of [['thousand', 950000], ['million', 2470000]] as const) {
    const forced = resolveChartRequest({ type: 'table', data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Row' }, { id: 'v', kind: 'value', label: 'Value', format: '$1,234' }, { id: 'n', kind: 'value', label: 'Count', format: '1,234' }],
      rows: [{ id: 'r', label: 'r', cells: { v: raw, n: 5 } }] }, options: { title: 'Forced', magnitude } } as never);
    const forcedTable = accessibleDataTable(interactionRecords({ request: forced, geometry: requireGeometry(layoutResolvedRequest(forced)), scope: forced.scope, claims: [] }));
    expect(forcedTable.rows[0]!.cells[0]!.text).not.toMatch(/[kM]$/);
  }
  // Cells that print their own magnitude ("1.0B" in an 'M' column) name no magnitude in the unit.
  const rolled = resolveChartRequest({ type: 'table', data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Row' }, { id: 'v', kind: 'value', label: 'Spend' }],
    rows: [{ id: 'a', label: 'a', cells: { v: 950000000 } }, { id: 'b', label: 'b', cells: { v: 999960000 } }] }, options: { unit: '$', target: 'report' } } as never);
  const rolledTable = accessibleDataTable(interactionRecords({ request: rolled, geometry: requireGeometry(layoutResolvedRequest(rolled)), scope: rolled.scope, claims: [] }));
  expect(rolledTable.columns.map((column) => column.unit)).toEqual(['$', '$']);
  // A range column keeps its unit.
  const ranges = resolveChartRequest({ type: 'bartable', data: { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', label: 'S' }],
    panels: [{ id: 'p', label: 'Cost', unit: 'USD', values: { s: [100] }, ends: [{ low: 110, high: 160 }] }] }, options: { title: 'Ranges' } } as never);
  const rangeTable = accessibleDataTable(interactionRecords({ request: ranges, geometry: requireGeometry(layoutResolvedRequest(ranges)), scope: ranges.scope, claims: [] }));
  expect(rangeTable.columns.map((column) => column.unit)).toContain('USD');
});

it('cleans the computed box statistics in the hover record, even when one equals an observation', async () => {
  await import('../src/core/charts');
  const { interactionRecords } = await import('../src/core/a11y/records');
  const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
  const { requireGeometry } = await import('../src/core/sizing');
  const request = resolveChartRequest({
    type: 'box',
    data: { groups: [{ id: 'g', label: 'G', observations: [0, 0.1, 0.30000000000000004, 0.4, 0.5] }] },
    options: { title: 'Spread' },
  });
  const geometry = requireGeometry(layoutResolvedRequest(request));
  const [record] = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
  const text = (entry: typeof record, key: string) => entry!.fields!.find((f) => f.key === key)!.value.raw;
  // Quartiles that are observations stay exact; the card prints them as a span.
  expect(text(record, 'quartiles')).toBe('0.1 to 0.4');
  // An integer statistic has no residue and keeps every digit.
  const big = resolveChartRequest({ type: 'box', data: { groups: [{ id: 'g', label: 'G', observations: [0, 0, 1, 1000000000000001, 1000000000000001] }] }, options: { title: 'Big' } });
  const [bigRecord] = interactionRecords({ request: big, geometry: requireGeometry(layoutResolvedRequest(big)), scope: big.scope, claims: [] });
  expect(text(bigRecord, 'quartiles')).toBe('0 to 1,000,000,000,000,001');
});

it('reads a dimswitch ratio and a bartable share as computed figures, without float residue', async () => {
  await import('../src/core/charts');
  const { getFixtures } = await import('../src/fixtures');
  const { interactionRecords } = await import('../src/core/a11y/records');
  const { interactionValueText } = await import('../src/core/a11y/valueText');
  const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
  const { requireGeometry } = await import('../src/core/sizing');
  const read = (type: string, id: string) => {
    const fixture = getFixtures(type).find((entry) => entry.id === id)!;
    const request = resolveChartRequest({ type, data: fixture.data, options: fixture.options } as never);
    return interactionRecords({ request, geometry: requireGeometry(layoutResolvedRequest(request)), scope: request.scope, claims: [] })
      .map((record) => interactionValueText(record.value));
  };
  // 23.636363636363637 and 30.583756345177676 on main.
  expect(read('dimswitch', 'by-measure')).toContain('23.64%');
  expect(read('bartable', 'cascade-two-periods')).toContain('30.58%');
  // A metric-stack ratio and a weighted stacked100 Total read as computed figures too.
  expect(read('grid', 'metric-stack-volume').some((text) => /\d[.,]\d{9,}/.test(text))).toBe(false);
  expect(read('column', 'stacked100-survey-total-column').some((text) => /\d[.,]\d{9,}/.test(text))).toBe(false);
});

it('keeps authored likert percentages exact in the hover record', async () => {
  await import('../src/core/charts');
  const { getFixtures } = await import('../src/fixtures');
  const { interactionRecords } = await import('../src/core/a11y/records');
  const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
  const { requireGeometry } = await import('../src/core/sizing');
  const fixture = getFixtures('likert').find((f) => (f.options as { values?: string } | undefined)?.values === 'percent' && !(f.options as { format?: string }).format)!;
  const data = structuredClone(fixture.data) as { items: { values: number[] }[] };
  // Move 0.84 points between two answers: still 100 in all, now with an authored decimal.
  const row = data.items[0]!.values;
  const from = row.findIndex((v) => v > 1);
  const to = from === 0 ? 1 : 0;
  row[from] = row[from]! - 0.84;
  row[to] = row[to]! + 0.84;
  const authored = row[to]!;
  const request = resolveChartRequest({ type: 'likert', data, options: fixture.options });
  const records = interactionRecords({ request, geometry: requireGeometry(layoutResolvedRequest(request)), scope: request.scope, claims: [] });
  const shares = records.flatMap((r) => r.fields ?? []).filter((f) => f.key === 'share').map((f) => f.value.raw);
  expect(shares).toContain(authored);
});

describe('a figure never breaks across lines ', () => {
  it('groups a space-separated format with a no-break space and signs it with a true minus', () => {
    expect(formatWithSpec(-1234567, parseFormatExample('1 234'))).toBe('\u22121\u00a0234\u00a0567');
  });

  // An example from Intl fr-FR holds U+202F, which was read as text, so every value printed a stray "234,5" after it.
  it.each(['\u202f', '\u2009'])('reads a group space %j in a format example as a thousands separator', (space) => {
    expect(formatWithSpec(1234567, parseFormatExample(`1${space}234`))).toBe('1\u00a0234\u00a0567');
    expect(parseFormatExample(`1${space}234,5`)).toEqual(parseFormatExample('1\u00a0234,5'));
  });
});

describe('no nonzero value prints as 0 ', () => {
  // Automatic significant-digit preferences must not turn a finite nonzero number into zero.
  it('uses the nonzero fallback after automatic significant-digit rounding', async () => {
    const { formatAutomaticNumber } = await import('../src/core/format');
    expect(formatAutomaticNumber(1e-25, { significantDigits: 2 })).toBe('1.0\u00a0×\u00a010⁻²⁵');
    expect(formatWithSpec(-1e-25, { ...defaultFormatSpec(), significantDigits: 2 })).toBe('−1.0\u00a0×\u00a010⁻²⁵');
    expect(formatAutomaticNumber(Number.MIN_VALUE, { magnitude: 'm', significantDigits: 2 })).toBe('5E-330M');
    expect(formatWithSpec(-Number.MIN_VALUE, { ...defaultFormatSpec(), magnitude: 'm', significantDigits: 2 })).toBe('−5E-330M');
    expect(formatNumber(1e-25, { significantDigits: 2 })).toBe(`0.${'0'.repeat(20)}`);
    expect(formatWithSpec(1e-25, { ...parseFormatExample('1.2'), significantDigits: 2 })).toBe(`0.${'0'.repeat(20)}`);
  });

  // Automatic labels must show nonzero values without changing their neighbours or authored formats.
  it('lifts only an automatic value that rounds to zero in charts and tables', async () => {
    const { resolveTable } = await import('../src/core/charts/table/resolve');
    expect([0.0004, -0.0004, 1, 0].map(value => formatNumber(value))).toEqual(['0.0004', '−0.0004', '1', '0']);
    expect([0.0004, 1].map(value => formatWithSpec(value, defaultFormatSpec()))).toEqual(['<1', '1']);
    expect(formatNumber(0.0004, { decimals: 0 })).toBe('0');
    expect(formatNumber(0.0004, { magnitude: 'm' })).toBe('0.0M');
    expect(formatWithSpec(0.038, parseFormatExample('$1,234'))).toBe('$0');
    const data = {
      columns: [{ id: 'label', kind: 'rowLabel' as const, label: 'Item' }, { id: 'v', kind: 'value' as const, label: 'Value' }],
      rows: [1_234_567, 12_345, -12_345, 0].map((value, index) => ({ id: String(index), label: String(index), cells: { v: value } })),
    };
    const displayed = (result: ReturnType<typeof resolveTable>) => result.table.rows.map(row => row.cells.v!.displayed);
    expect(displayed(resolveTable(data))).toEqual(['1.2', '<0.1', '>−0.1', '0.0']);
    expect(displayed(resolveTable({ ...data, columns: [data.columns[0]!, { id: 'v', kind: 'value', label: 'Value', format: '1.2M' }] }))).toEqual(['1.2', '0.0', '0.0', '0.0']);
    expect(displayed(resolveTable(data, { unit: 'M units' }))).toEqual(['1.2', '0.0', '0.0', '0.0']);
    const tiny = seriesRasterFormatter(undefined, [1, 1e-25, -Number.MIN_VALUE]);
    expect(tiny.fmt(1)).toBe('1');
    expect(tiny.fmt(1e-25)).toBe('<1');
    expect(tiny.fmt(-Number.MIN_VALUE)).toBe('>−1');
    const { resolveDimSwitch } = await import('../src/core/charts/dimswitch/core');
    const { exampleData } = await import('../src/core/charts/dimswitch/example');
    const dim = structuredClone(exampleData);
    dim.measures.push({ id: 'small', label: 'Small', value: 0.0004 });
    const smallRows = resolveDimSwitch(dim).table.rows.filter(row => row.label === 'Small');
    expect(smallRows.length).toBeGreaterThan(0);
    expect(smallRows.every(row => row.cells.range?.displayed === '0.0004')).toBe(true);
    const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
    const narrow = layoutResolvedRequest(resolveChartRequest({ type: 'cohort', data: { periodLabel: 'Month', cohorts: [
      { id: 'a', active: [1e12, 1, 1, 1, 1, 1] }, { id: 'b', active: [1e12, 1, 1, 1, 1] },
    ] }, options: { variant: 'pure', total: false, title: 'Observed rates (%)', size: { width: 545 } } }));
    expect(narrow.refused).not.toBe(true);
    if (!narrow.refused) {
      const rates = narrow.scene.filter(node => node.t === 'text' && node.id.startsWith('label:cohort-cell:'));
      expect(rates).toHaveLength(11);
      expect(rates.filter(node => node.t === 'text' && node.lines.join(' ') === '1E-10')).toHaveLength(9);
    }
  });

  it('prints the shares of one whole at one precision, whole unless a share would read 0', () => {
    expect(shareSetDecimals([8.4, 91.6])).toBe(0);
    expect(shareSetDecimals([0.3, 99.7])).toBe(1);
    // never more than one decimal; a share under 0.05 % reads "<0.1%".
    expect(shareSetDecimals([0.04, 0, 99.96])).toBe(1);
    expect(shareSetDecimals([3e-10, 8.6901497573, 91.3])).toBe(1);
    const { format } = shareSetFormatter([3e-10, 8.6901497573, 91.3]);
    expect([3e-10, 8.6901497573, 91.3].map(format)).toEqual(['<0.1%', '8.7%', '91.3%']);
  });

  it('rasters a bridge of steps near 1e-13 at the decimals it needs ', () => {
    const { fmt } = seriesRasterFormatter('0.0000000000000', [0, -1e-13, -2e-13, -1e-13 + -2e-13]);
    expect([-1e-13, -2e-13, -1e-13 + -2e-13].map(fmt)).toEqual(['\u22120.0000000000001', '\u22120.0000000000002', '\u22120.0000000000003']);
  });
});

describe('an example is read as its author wrote it', () => {
  it('scales by mn, Mio. and Mrd., and keeps a letter-digit unit a unit', () => {
    const print = (example: string, value: number) => formatWithSpec(value, parseFormatExample(example));
    expect(print('\u20ac1.2mn', 182400000)).toBe('\u20ac182.4M');
    expect(print('1,2 Mio. \u20ac', 182400000)).toBe('182,4M \u20ac');
    expect(print('1,2 Mrd. \u20ac', 182400000000)).toBe('182,4B \u20ac');
    expect(print('1 Tsd.', 12345)).toBe('12k');
    expect(print('1,234 m2', 12)).toBe('12 m2');
    expect(print('1.2 km', 12.5)).toBe('12.5 km');
    expect(sameUnit('\u20ac Mio.', '\u20acm')).toBe(true);
  });

  // A spaced single letter is SI unit text ("12 m/s", "50 B"), but it scaled as millions and bytes lost their unit; the warning's fix also dropped the space.
  it('keeps a spaced single letter a unit and keeps the space in the warning fix', () => {
    const print = (example: string, value: number) => formatWithSpec(value, parseFormatExample(example));
    expect(print('12 m/s', 7)).toBe('7 m/s');
    expect(print('50 B', 512)).toBe('512 B');
    expect(print('1.2m', 2400000)).toBe('2.4M');
    expect(print('1.2 Mio.', 2400000)).toBe('2.4M');
    const [warning] = unscaledFormatLint({ format: '12 m/s' }, { series: [{ values: [3.2, 3.4] }] });
    expect(warning?.code).toBe('format-hides-values');
    expect(warning?.message).toContain("'12 m/s'");
    expect(warning?.suggest).toMatch(/'1\.1\d* m\/s'/);
  });

  it('keeps every decimal a chart-level example claims', () => {
    expect(seriesRasterFormatter('1.0000', [1.0851, 1.0853, 1.0849]).fmt(1.0851)).toBe('1.0851');
    expect(seriesRasterFormatter('47.0', [45, 47]).fmt(47)).toBe('47.0');
    // The exemption from 100 up yields to the example's own decimals, as series[].format already did.
    const index = seriesRasterFormatter('1.0000', [100.0101, 100.0202]);
    expect([100.0101, 100.0202].map(index.fmt)).toEqual(['100.0101', '100.0202']);
    expect([100.0101, 100.0202].map(index.forSeries({ format: '1.0000' }))).toEqual(['100.0101', '100.0202']);
    expect([519.01, 518.81].map(seriesRasterFormatter('1,234', [519.01, 518.81]).fmt)).toEqual(['519', '519']);
    // Past nine decimals the example's claim outranks the float-noise margin.
    expect([1.0000000001, 1.0000000002].map(seriesRasterFormatter('1.0000000000', [1.0000000001, 1.0000000002]).fmt)).toEqual(['1.0000000001', '1.0000000002']);
  });

  it('raises tick decimals until every tick reads apart', () => {
    const rates = [1.0849, 1.085, 1.0851, 1.0852, 1.0853, 1.0854, 1.0855];
    expect(rates.map(tickFormatter(parseFormatExample('1.0000'), rates))).toEqual(['1.0849', '1.0850', '1.0851', '1.0852', '1.0853', '1.0854', '1.0855']);
    const index = [100.01, 100.015, 100.02, 100.025, 100.03];
    expect(index.map(tickFormatter(defaultFormatSpec(), index))).toEqual(['100.010', '100.015', '100.020', '100.025', '100.030']);
  });

  it('prints an unformatted scatter axis at one precision, every tick apart', () => {
    const ticks = (geometry: { scene: SceneNode[] }, axis: 'x' | 'y') =>
      geometry.scene.flatMap((node) => (node.t === 'text' && node.part === 'tick' && node.id.startsWith(`axis:${axis}:tick:`) ? [node.lines[0]] : []));
    const one = layoutScatter({ points: [{ id: 'p', label: 'P', x: 1, y: 2 }] }, { size: { width: 600, height: 400 } });
    expect(ticks(one, 'x')).toEqual(['0.95', '1.00', '1.05']);
    expect(ticks(one, 'y')).toEqual(['1.90', '1.95', '2.00', '2.05', '2.10']);
    const close = layoutScatter(
      { points: [{ id: 'p', label: 'P', x: 1.001, y: 2.002 }, { id: 'q', label: 'Q', x: 1.002, y: 2.004 }] },
      { size: { width: 600, height: 400 } },
    );
    // A plain dot scatter's axis ends on its ticks.
    expect(ticks(close, 'y')).toEqual(['2.0015', '2.0020', '2.0025', '2.0030', '2.0035', '2.0040', '2.0045']);
  });

  // Prevents eleven-digit ticks ("2,000,000,000") on an unformatted scatter while a bar on the same page prints 2.0B.
  it('scales an unformatted scatter axis of millions and billions, each log tick at its own scale', () => {
    const ticks = (geometry: { scene: SceneNode[] }, axis: 'x' | 'y') =>
      geometry.scene.flatMap((node) => (node.t === 'text' && node.part === 'tick' && node.id.startsWith(`axis:${axis}:tick:`) ? [node.lines[0]] : []));
    const points = [{ id: 'a', label: 'A', x: 68e6, y: 12e6 }, { id: 'b', label: 'B', x: 970e6, y: 1.73e9 }, { id: 'c', label: 'C', x: 370e6, y: 600e6 }];
    const log = layoutScatter({ points }, { target: 'slide', size: { width: 1184, height: 528 }, valueAxis: { log: 'both' } });
    expect(ticks(log, 'y')).toEqual(expect.arrayContaining(['10M', '500M', '1.0B', '2.0B']));
    expect(ticks(log, 'x')).toEqual(expect.arrayContaining(['100M', '1.0B']));
    // One scale down a linear axis, the scale of its largest tick: 1.0B, never 1,000M.
    expect(ticks(layoutScatter({ points }, { target: 'slide', size: { width: 1184, height: 528 } }), 'x').at(-1)).toBe('1.0B');
    const de = layoutScatter({ points }, { target: 'slide', size: { width: 1184, height: 528 }, valueAxis: { log: 'both' }, locale: { language: 'de-DE' } });
    expect(ticks(de, 'y')).toEqual(expect.arrayContaining(['500 Mio.', '1,0 Mrd.']));
    // An authored format keeps its digits.
    expect(ticks(layoutScatter({ points }, { target: 'slide', size: { width: 1184, height: 528 }, format: '1,000' }), 'y')).toContain('1,000,000,000');
    // A log axis from fractions to millions prints each small tick at its value: 0.00005, not a capped 0.0001.
    const wide = layoutScatter({ points: [{ id: 'a', label: 'A', x: 1e-6, y: 1e-6 }, { id: 'b', label: 'B', x: 1, y: 1 }, { id: 'c', label: 'C', x: 2e6, y: 2e6 }] },
      { target: 'slide', size: { width: 1184, height: 528 }, valueAxis: { log: 'both' } });
    expect(ticks(wide, 'y')).toContain('0.00001');
    // A y value label prints at the axis scale: "b 2M", not "b 2,000,000".
    const valued = layoutScatter({ points: [{ id: 'a', label: 'a', x: 1e6, y: 1e6 }, { id: 'b', label: 'b', x: 2e6, y: 2e6 }] }, { target: 'slide', size: { width: 1184, height: 528 }, labels: { value: true } });
    expect(valued.scene.some((node) => node.t === 'text' && node.lines.join(' ') === 'b 2M')).toBe(true);
    const engine = seriesRasterFormatter(undefined, [1e-6, 1, 2e6], 'en', undefined, 'slide').spec;
    expect([5e-5, 1e-4].map(logSpecFormat(engine, [1e-6, 2e6]))).toEqual(['0.00005', '0.0001']);
  });

  it('distinguishes thousands grouping from three decimal places', () => {
    expect(parseFormatExample('1.000')).toMatchObject({ thousandsSep: '.', decimalSep: ',', decimals: 0 });
    expect(parseFormatExample('0.000')).toMatchObject({ thousandsSep: '', decimalSep: '.', decimals: 3 });
  });
});

describe('the automatic number rule', () => {
  const texts = async (spec: object, prefix: string): Promise<string[]> => {
    const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
    const { requireGeometry } = await import('../src/core/sizing');
    const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest(spec as never)));
    return geometry.scene.filter((node): node is Extract<SceneNode, { t: 'text' }> => node.t === 'text' && node.id.startsWith(prefix)).map((node) => node.lines.join(' ')).filter((text) => !text.startsWith('Row '));
  };
  const table = (values: number[], options: object = {}) => ({ type: 'table', options, data: {
    columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'v', kind: 'value', label: 'Value' }],
    rows: values.map((v, i) => ({ id: `r${i}`, label: `Row ${i}`, cells: { v } })),
  } });
  const bar = (values: number[], options: object = {}) => ({ type: 'bar', options, data: {
    categories: values.map((_, i) => `C${i}`), series: [{ id: 's', label: 'S', values }],
  } });

  // A format example of 1.234 read as a thousands group printed 0.512 as 1, and a German group example must keep grouping.
  it('reads 1.234 by the chart: three decimals on small fractions, a group on large or whole values', async () => {
    const labels = async (values: number[], format: string) => (await texts(bar(values, { format }), 'label:')).filter((text) => /^\d/.test(text)).sort();
    expect(await labels([0.512, 1.25, 2.5], '1.234')).toEqual(['0.512', '1.250', '2.500']);
    expect(await labels([1200, 3400], '1.234')).toEqual(['1,200', '3,400']);
    // A text column named format holds words, and an object used twice reads the same in both places.
    const cell = { v: 0.512, format: '1.234' };
    expect(await texts({ type: 'table', data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'format', kind: 'text', label: 'Code' }, { id: 'a', kind: 'value', label: 'A' }, { id: 'b', kind: 'value', label: 'B' }],
      rows: [{ id: 'r0', label: 'Row', cells: { format: '1.234', a: cell, b: cell } }] } }, 'cell:')).toEqual(['Row', '1.234', '0.512', '0.512']);
    expect(resolveChartRequest(bar([0.512, 1200], { format: '1.234' }) as never).inputWarnings?.[0]).toMatchObject({ code: 'format-reads-as-group', message: expect.stringContaining('0.512 prints 1') });
  });

  // A column of small values printed two different values as one text (0.0123 and 0.0051 both as 0.01).
  it('gives a column one precision from its largest value, two significant digits below 1', async () => {
    expect(await texts(table([0.0123, 0.0341, 0.0051]), 'cell:')).toEqual(['0.012', '0.034', '0.005']);
  });

  // A tiny value printed long zeros (0.000000001) beside 0.04, in tables and chart labels.
  it('prints a value below the last shown digit as its bound', async () => {
    expect(await texts(table([0.042, 0.00031, 0.0000000012]), 'cell:')).toEqual(['0.042', '<0.001', '<0.001']);
    expect((await texts(bar([0.0123, 0.0341, 0.0000000012]), 'label:')).filter((text) => /^[<0-9]/.test(text)).sort()).toEqual(['0.012', '0.034', '<0.001']);
  });

  // A tiny value beside larger ones printed twenty zeros at full width; a true zero keeps the column format.
  it('keeps a true zero in the column format and a tiny value as <0.1 beside larger ones', async () => {
    expect(await texts(table([12.5, 3.41, 1.1e-20, 0]), 'cell:')).toEqual(['12.5', '3.4', '<0.1', '0.0']);
  });

  // The modes the AI sets must print a tiny value spreadsheet style or with a power of ten, and leave other values alone.
  it('prints a tiny value as zero or in scientific form under options.smallValues', async () => {
    expect(await texts(table([0.042, 0.0000000012], { smallValues: 'zero' }), 'cell:')).toEqual(['0.042', '0.000']);
    expect(await texts(table([0.042, 0.0000000012], { smallValues: 'scientific' }), 'cell:')).toEqual(['0.042', '1.2 × 10⁻⁹']);
  });

  // p-values must print as APA 7 writes them (.042, <.001), while values above 1 keep the automatic rule.
  it('prints values from 0 to 1 as APA p-values under options.smallValues p-value', async () => {
    expect(await texts(table([0.042, 0.5, 0.0004, 1], { smallValues: 'p-value' }), 'cell:')).toEqual(['.042', '.500', '<.001', '1.000']);
    expect(await texts(table([12.5, 0.0004], { smallValues: 'p-value' }), 'cell:')).toEqual(['12.5', '<.001']);
  });

  // One exhibit precision printed a series of 0.0341 as 0.03 because another series reached 0.5.
  it('gives each chart series below 1 its own precision', async () => {
    const labels = await texts({ type: 'bar', data: { categories: ['A'], series: [{ id: 'small', label: 'Small', values: [0.0341] }, { id: 'large', label: 'Large', values: [0.5] }] } }, 'label:');
    expect(labels.filter((text) => /^\d/.test(text)).sort()).toEqual(['0.034', '0.5']);
  });

  // A negative value under 'p-value' printed as a p-value ("−.500", ">−.001"), outside its 0 to 1 domain.
  it('keeps the automatic rule for values outside 0 to 1 under p-value', async () => {
    expect(await texts(table([-0.5, -0.0004, 0.042], { smallValues: 'p-value' }), 'cell:')).toEqual(['−0.50', '>−0.01', '.042']);
  });

  // An automatic format printed up to twenty decimals; one set entirely below 0.0001 printed one bound on every tick.
  it('prints at most four decimals, and a set below that floor in scientific form', async () => {
    const { formatAutomaticNumber } = await import('../src/core/format');
    expect(formatAutomaticNumber(0.123456, { decimals: 6 })).toBe('0.1235');
    expect(seriesRasterFormatter(undefined, [1e-13, 5e-13]).fmt(1e-13)).toBe('1.0 × 10⁻¹³');
  });

  // The four-decimal cap printed three axis ticks near 2.00001 all as 2.0000.
  it('lets axis ticks take more decimals than the cap when they need them to read apart', () => {
    const ticks = [2, 2.00001, 2.00002];
    expect(new Set(ticks.map(tickFormatter(defaultFormatSpec(), ticks))).size).toBe(3);
  });

  // A cached column formatter kept the first chart's mode: 'scientific' after 'zero' printed 0.000 in one process.
  it('prints each smallValues mode the same whichever mode rendered before it', async () => {
    const column = (smallValues: string) => ({ type: 'column', options: { smallValues }, data: { categories: ['A', 'B'], series: [{ id: 's', label: 'S', values: [0.042, 0.0000000012] }] } });
    const zeroFirst = [await texts(column('zero'), ''), await texts(column('scientific'), '')];
    const scientificFirst = [await texts(column('scientific'), ''), await texts(column('zero'), '')];
    expect(zeroFirst).toEqual([scientificFirst[1], scientificFirst[0]]);
    expect(zeroFirst[0]).not.toEqual(zeroFirst[1]);
  });

  // The column formatter cache left out range ends: a range 29.2–30.8 printed 29–31 after a chart with the same central values and range 29–31.
  it('prints a column range the same whichever chart with the same central values rendered before it', async () => {
    const column = (low: number, high: number) => ({ type: 'column', data: { categories: ['A', 'B'], series: [
      { id: 'a', label: 'A', values: [{ number: 30, range: { low, high } }, 32] }, { id: 'b', label: 'B', values: [40, 41] }] } });
    await texts(column(29, 31), '');
    expect((await texts(column(29.2, 30.8), '')).join(' ')).toMatch(/29\.2.30\.8/);
  });

  // A variance delta that printed "0.0" at the deltas' shared precision under smallValues 'zero' still took the gain colour.
  it('draws a variance delta that prints zero in the neutral tone', async () => {
    const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
    const { requireGeometry } = await import('../src/core/sizing');
    const fillOf = (smallValues: string) => requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'variance', options: { smallValues, variance: { vs: 'py' } }, data: {
      categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      series: [{ id: 'ac', label: 'AC', role: 'actual', values: [10.04, 13] }, { id: 'py', label: 'PY', role: 'reference', values: [10, 10] }] } } as never)))
      .scene.find((node) => node.id === 'mark:delta:a') as { fill?: { token?: string } };
    expect([fillOf('zero').fill?.token, fillOf('bound').fill?.token]).toEqual(['neutralMark', 'goodFill']);
  });

  // The column formatter cache keyed only the flat values: a chart split as [100, 100] + [1.2, 1.2] made a later single series print 1.2 as 1.
  it('prints a column series the same whichever chart with the same values rendered before it', async () => {
    const column = (series: { id: string; values: number[] }[]) => ({ type: 'column', data: { categories: ['A', 'B', 'C', 'D'].slice(0, series[0]!.values.length), series: series.map(s => ({ ...s, label: s.id })) } });
    await texts(column([{ id: 'a', values: [300, 300] }, { id: 'b', values: [1.7, 1.7] }]), 'label:');
    expect(await texts(column([{ id: 'a', values: [300, 300, 1.7, 1.7] }]), 'label:')).toContain('1.7');
  });

  // Slope and scatter labels took one exhibit precision or one per value: a series of 0.0341 beside one of 0.5 printed 0.03 and 0.50.
  it('gives each slope and scatter series its own precision', async () => {
    const slope = await texts({ type: 'slope', data: { categories: ['2024', '2025'], series: [{ id: 'a', values: [0.0341, 0.0212] }, { id: 'b', values: [0.5, 0.4] }] } }, 'label:');
    expect(slope.filter((text) => /0\./.test(text)).sort()).toEqual(['0.021 a', '0.4 b', 'a 0.034', 'b 0.5']);
    const scatter = await texts({ type: 'scatter', options: { labels: { value: true } }, data: { points: [{ id: 'p1', x: 1, y: 0.0341 }, { id: 'p2', x: 2, y: 0.02 }, { id: 'p3', x: 3, y: 0.5, group: 'g' }] } }, 'label:');
    expect(scatter.filter((text) => /\d/.test(text)).sort()).toEqual(['p1 0.034', 'p2 0.020', 'p3 0.5']);
  });

  // On a log y axis a group's shared precision printed a point plotted at 0.45 as "0.5".
  it('prints a log-axis scatter value at its own precision', async () => {
    const scatter = await texts({ type: 'scatter', options: { labels: { value: true }, valueAxis: { log: 'y' } }, data: { points: [{ id: 'p1', x: 1, y: 0.45 }, { id: 'p2', x: 2, y: 5 }] } }, 'label:');
    expect(scatter.filter((text) => /\d/.test(text)).sort()).toEqual(['p1 0.45', 'p2 5']);
  });

  // An integer-only series reused the combined raster of a decimal series and printed 100.00.
  it('prints an integer-only series whole beside a decimal series', async () => {
    const labels = await texts({ type: 'bar', data: { categories: ['A'], series: [{ id: 'whole', label: 'Whole', values: [100] }, { id: 'part', label: 'Part', values: [1.23] }] } }, 'label:');
    expect(labels.filter((text) => /^\d/.test(text)).sort()).toEqual(['1.23', '100']);
  });

  // Per-series precision printed "10" under "12.0" in one stack: series that share a stack read as one set.
  it('keeps one precision across the series of a stack', async () => {
    const labels = await texts({ type: 'column', data: { categories: ['A', 'B'], series: [{ id: 'p', label: 'P', values: [12, 13.5] }, { id: 'q', label: 'Q', values: [10, 11] }] }, options: { variant: 'stacked' } }, 'label:');
    expect(labels.filter((text) => /^1[01]/.test(text)).sort()).toEqual(['10.0', '11.0']);
  });

  // Per-series precision read no number from authored { number } cells and printed 1.2 and 1.4 as 1.
  it('reads authored number cells for a series precision', () => {
    const fmt = seriesRasterFormatter(undefined, [1.2, 1.4]).forSeries({ values: [{ number: 1.2 }, { number: 1.4 }] });
    expect([fmt(1.2), fmt(1.4)]).toEqual(['1.2', '1.4']);
  });

  // A signed change label below its last digit keeps its sign, as its neighbours do: the docs said "<0.1".
  it('keeps the sign on a signed bound in both engines', () => {
    expect(formatAutomaticNumberSync(0.04, { decimals: 1, signed: true })).toBe('<+0.1');
    expect(formatWithSpec(0.04, { ...defaultFormatSpec(), automatic: true, decimals: 1, signed: true })).toBe('<+0.1');
    expect(formatWithSpec(-0.04, { ...defaultFormatSpec(), automatic: true, decimals: 1, signed: true })).toBe('>−0.1');
  });

  // A format or colour string of 50,000 characters took 1 to 2 seconds in these three parsers (time grew with the square of the length), and a chart parses its format about 16 times per render.
  it('parses long malformed format and colour strings in linear time', () => {
    const n = 50_000;
    const cases: Array<[string, () => unknown]> = [
      ['trailing spaces', () => parseFormatExample('1' + ' '.repeat(n) + '1')],
      ['digits of a unit name', () => { try { parseFormatExample('(1)' + '0'.repeat(n) + '!'); } catch { /* the refusal is the expected result */ } }],
      ['alpha with no closing parenthesis', () => compositeColor('rgba(0,0,0,' + ' '.repeat(n) + 'x', '#ffffff')],
    ];
    const slow = cases.filter(([, run]) => {
      const start = performance.now();
      run();
      return performance.now() - start >= 250;
    }).map(([name]) => name);
    expect(slow).toEqual([]);
  });
});
