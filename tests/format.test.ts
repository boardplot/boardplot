import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { tickFormatter } from '../src/core/axis';
import { compositeColor } from '../src/core/color';
import { layoutScatter } from '../src/core/charts/scatter/layout';
import { logSpecFormat } from '../src/core/charts/scatter/logAxis';
import { formatAutomaticNumber as formatAutomaticNumberSync, formatNumber } from '../src/core/format';
import { shareSetDecimals, withSmallValues, zeroLifts } from '../src/core/formatPrecision';
import { shareSetFormatter } from '../src/core/format';
import { compileNumberFormat, defaultFormatSpec, formatExampleProblem, formatterFromExample, formatWithSpec, parseFormatExample, readFormatExamples, roundedNumber, sameUnit, seriesRasterFormatter, signedFormatterFromExample, unitMagnitude, unscaledFormatLint } from '../src/core/formatSpec';
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
import { render } from '../src/cli/render';

describe('ordinary number examples', () => {
  it('compiled table formats preserve small-value modes and lift counts on reused values', () => {
    for (const spec of [defaultFormatSpec(), parseFormatExample('$1.2M'), parseFormatExample('+20.5%'), parseFormatExample('(1,234)')]) {
      const compiled = compileNumberFormat(spec);
      for (const mode of ['bound', 'zero', 'scientific', 'p-value', 'bound'] as const) withSmallValues(mode, () => {
        for (const value of [0.0004, -0.0004, 0, -0, 1_234_567, Infinity, NaN, 0.0004]) {
          const before = zeroLifts.count;
          const expected = formatWithSpec(value, spec);
          const lifts = zeroLifts.count - before;
          const compiledBefore = zeroLifts.count;
          expect(compiled(value)).toBe(expected);
          expect(zeroLifts.count - compiledBefore).toBe(lifts);
        }
      });
    }
    const mutable = defaultFormatSpec();
    formatWithSpec(12.345, mutable);
    mutable.decimals = 2;
    expect(formatWithSpec(12.345, mutable)).toBe('12.35');
  });

  const column = (format: string, values: number[]) => {
    const request = resolveChartRequest({ type: 'column', data: {
      categories: values.map((_, index) => ({ id: String(index) })), series: [{ id: 's', values }],
    }, options: { format, valueLabels: 'all', size: { width: 960 } } } as never);
    return { request, texts: requireGeometry(layoutResolvedRequest(request)).labels.filter(label => label.kind === 'point' && !label.hidden).map(label => label.text) };
  };

  // Prevents currency scale words from naming thousands or millions while the cells print base units.
  it('scales spaced currency magnitudes and currency affixes while keeping physical units literal', () => {
    for (const [example, expected] of [['$1.2 k', '$1.2 k'], ['€1.2 m', '€0.0 m'], ['CHF 1.2 m', 'CHF 0.0 m'],
      ['USD 5 b', 'USD 0 b'], ['1.2 k USD', '1.2 k USD']]) {
      expect(formatWithSpec(1200, parseFormatExample(example!, true))).toBe(expected);
    }
    expect(formatterFromExample('$1.2 k', undefined)(1_300_000)).toBe('$1.3 M');
    for (const [example, positive, negative] of [['USDm 1.2', 'USDm 1.2', '−USDm 0.2'], ['1.2 €m', '1.2 €m', '−0.2 €m'],
      ['CHF m 1.2', 'CHF m 1.2', '−CHF m 0.2'], ['Mio. CHF 1.2', 'Mio. CHF 1.2', '−Mio. CHF 0.2']]) {
      const fmt = formatterFromExample(example!, undefined);
      expect(fmt(1_234_567)).toBe(positive);
      expect(fmt(-234_567)).toBe(negative);
      expect(unscaledFormatLint({ format: example }, { values: [1_234_567] })).toEqual([]);
    }
    for (const [example, expected] of [['12 m/s', '1200 m/s'], ['50 B', '1200 B'], ['$5 m/s', '$1200 m/s']]) {
      expect(formatWithSpec(1200, parseFormatExample(example!))).toBe(expected);
    }
    // Prevents currency rates and units with extra text from being divided by a magnitude.
    for (const unit of ['USD/m', 'USD/m²', 'USD m²', 'USD (m)', 'USDm2']) {
      expect(formatterFromExample(`1.2 ${unit}`, undefined)(2_500_000)).toBe(`2,500,000.0 ${unit}`);
    }
    // Keeps a standalone magnitude after a tail currency consistent across currency codes.
    for (const currency of ['EUR', 'SEK']) {
      expect(formatterFromExample(`1.2 ${currency} m`, undefined)(2_500_000)).toBe(`2.5 ${currency} m`);
    }
    const table = (format: string) => {
      const request = resolveChartRequest({ type: 'table', data: { columns: [{ id: 'name', kind: 'rowLabel', label: 'Region' },
        { id: 'v', kind: 'value', label: 'Value', format }], rows: [1234, -567, 89].map((v, index) => ({ id: String(index), label: String(index), cells: { v } })) },
      options: { title: 'Values' } } as never);
      return [...renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme).matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map(match => match[1]!.replace(/<[^>]*>/g, ''));
    };
    expect(table('$1.2 k')).toEqual(table('$1.2k'));
    expect(table('$1.2 k')).toContain('VALUE ($k)');
    expect(table('$1.2 k')).toContain('−0.6');
  });

  // Prevents spreadsheet placeholders from leaking into labels or silently changing their divisor and negative style.
  it('translates spreadsheet codes and reports the example used by the request', () => {
    for (const [code, expected] of [['#,##0', '1,235'], ['#,##0.0', '1,234.6'], ['$#,##0', '$1,235'],
      ['#,##0;(#,##0)', '(1,235)'], ['+0.0%;(0.0%)', '(1,234.6%)'], ['0.0,,"M"', '1.2M'], ['#,##0,', '1,235k']]) {
      const value = code!.includes(',,') ? 1_234_567 : code === '#,##0,' ? 1_234_567 : code!.includes(';') ? -1234.56 : 1234.56;
      expect(formatterFromExample(code!, undefined)(value), code).toBe(expected);
    }
    const result = column('#,##0;(#,##0)', [1234, -567]);
    expect(result.texts).toEqual(expect.arrayContaining(['1,234', '(567)']));
    expect(result.request.inputWarnings).toContainEqual(expect.objectContaining({ code: 'format-spreadsheet-code', severity: 'warn',
      message: "format '#,##0;(#,##0)' is a spreadsheet number code, so the chart prints it as the example '(1,234)'", field: ['options', 'format'] }));
    const signed = formatterFromExample('+0.0%;(0.0%)', undefined);
    expect([1.2, -1.2, 0].map(signed)).toEqual(['+1.2%', '(1.2%)', '0.0%']);
    for (const code of ['0.0,"M"', '0.0"M"', '0.0"unfinished']) expect(() => parseFormatExample(code)).toThrow(/invalid-format/);
    expect(parseFormatExample('0.000"kg"')).toMatchObject({ decimals: 3, thousandsSep: '', magnitude: 'none', suffix: 'kg' });
    expect(formatterFromExample('[$€-407]#,##0.00', undefined)(1234.5)).toBe('€1,234.50');
    expect(formatterFromExample('#,##0 "EUR"', undefined)(1234)).toBe('1,234 EUR');
    expect(formatterFromExample('0.00E+00', undefined)(1_234_567)).toBe('1.23E+06');
    for (const example of ['1.2 "kg"', '1.2 [kg]', '12 "b"', '#1', 'Rank #1']) expect(() => parseFormatExample(example)).not.toThrow();
    const rewritten = readFormatExamples({ series: [{ format: '#,##0', values: [{ number: 12, format: '#,##0' }] }] }, { format: '#,##0' });
    expect(rewritten.warnings.filter(warning => warning.code === 'format-spreadsheet-code')).toHaveLength(1);
    // Prevents zero-only decimal examples from being mistaken for spreadsheet comma scales.
    for (const [example, small, grouped] of [['0,00', '1,20', '1.234,50'], ['0,0 €', '1,2 €', '1.234,5 €'],
      ['0,000', '1,200', '1.234,500'], ['0.0', '1.2', '1,234.5'], ['0.00', '1.20', '1,234.50'],
      ['00', '1', '1,235'], ['000', '1', '1,235'], ['0,0%', '1,2%', '1.234,5%'], ['0,00 %', '1,20 %', '1.234,50 %']]) {
      expect([1.2, 1234.5].map(formatterFromExample(example!, undefined)), example).toEqual([small, grouped]);
    }
  });

  // Prevents an accessor's later format reading from losing its warning when shared objects are visited once.
  it('keeps ambiguous-format warnings from a shared accessor after the rewrite pass', () => {
    let reads = 0;
    const series = { get format() { return ++reads === 1 ? '1.2' : '1.234'; }, values: [0.512, 1200] };
    const result = readFormatExamples({ series: [series, series] }, {});
    expect(result.warnings).toEqual([expect.objectContaining({
      code: 'format-reads-as-group',
      message: "format '1.234' reads as a thousands group on this chart, so 0.512 prints 1",
    })]);
  });

  // Prevents bracketed units from disappearing while spreadsheet colours still warn and do not print.
  it('keeps bracketed units and drops spreadsheet colour tokens with a warning', () => {
    expect(formatterFromExample('0.0 [kWh]', undefined)(1234.5)).toBe('1,234.5 [kWh]');
    expect(formatterFromExample('0.0 [%]', undefined)(12.3)).toBe('12.3 [%]');
    const result = column('0.0 [Red]', [1234.5]);
    expect(result.texts).toEqual(['1,234.5']);
    expect(result.request.inputWarnings).toContainEqual(expect.objectContaining({ code: 'format-spreadsheet-code', severity: 'warn' }));
  });

  // Prevents literal comma suffixes from scaling values and literal asterisks from disappearing.
  it('keeps literal comma suffixes and asterisks in zero-only examples', () => {
    expect(formatterFromExample('0, EUR', undefined)(1234.5)).toBe('1.235 EUR');
    expect(formatterFromExample('0,- €', undefined)(1234.5)).toBe('1.235- €');
    expect(formatterFromExample('0*x', undefined)(1234.5)).toBe('1,235*x');
  });

  // Prevents a unit-only format from forcing the stand-in's decimals onto data at another precision.
  it('chooses unit-only precision from the original values of each field', () => {
    for (const [format, values, texts] of [['$M', [1_200_000, 5_000_000, 7_000_000], ['$1.2M', '$5.0M', '$7.0M']],
      ['€bn', [1_200_000_000, 5_000_000_000], ['€1.2bn', '€5.0bn']], ['%', [12, 5, 7], ['12%', '5%', '7%']],
      ['x', [1.2, 5, 7], ['1.2x', '5.0x', '7.0x']]] as const) {
      const result = column(format, [...values]);
      expect(result.texts).toEqual(expect.arrayContaining([...texts]));
      expect(result.request.inputWarnings?.filter(warning => warning.code.startsWith('format-')) ?? []).toEqual([]);
    }
    const own = readFormatExamples({ series: [{ format: '%', values: [1, 2] }, { format: '%', values: [{ number: 1.25 }, 2] }] }, {});
    expect(own.data.series.map(series => parseFormatExample(series.format).decimals)).toEqual([0, 2]);
    const table = readFormatExamples({ columns: [{ id: 'v', format: '$M' }, { id: 'computed', format: '%' }], rows: [
      { cells: { v: 1_200_000 }, children: [{ cells: { v: { v: 5_000_000 } } }] },
    ] }, {});
    expect(table.data.columns.map(col => parseFormatExample(col.format).decimals)).toEqual([1, 1]);
    expect(parseFormatExample('$M').decimals).toBe(1);
    expect(parseFormatExample('$').decimals).toBe(0);
    for (const example of ['Revenue', 'm', 'M', 'abc']) expect(() => parseFormatExample(example)).toThrow(/at least one digit/);
  });

  // Prevents a currency-affix scale with significant figures from rolling to billions while the affix still says millions.
  it('keeps the currency-affix scale under significant figures', () => {
    expect(column('USDm @@@', [1.25e9, 9.8e8, 4.5e8]).texts.sort()).toEqual(['USDm 1,250', 'USDm 450', 'USDm 980']);
    expect(formatterFromExample('@@@ €m', undefined)(1e9)).toBe('1,000 €m');
  });

  // Prevents an exponent example from swallowing the digit of a unit name before the number.
  it('keeps unit-name digits before a scientific example', () => {
    expect(formatterFromExample('CO2 1.2E+06', undefined)(2_500_000)).toBe('CO2 2.5E+06');
  });

  // Prevents a unit-only format from printing a small nonzero value as 0.
  it('gives unit-only formats two significant digits for the smallest value', () => {
    expect(column('x', [0.00123, 2.5]).texts).toEqual(['0.0012x', '2.5000x']);
  });

  // Prevents literal direction signs and trailing minuses from giving positive or zero values a negative label.
  it('prints direction signs, plus-minus and trailing minus by value', () => {
    for (const example of ['▲1.2%', '▼1.2%']) expect([1.2, -0.5, 0].map(formatterFromExample(example, undefined))).toEqual(['▲1.2%', '▼0.5%', '0.0%']);
    expect([1.2, -0.5, 0].map(formatterFromExample('↑ 1.2%', undefined))).toEqual(['↑ 1.2%', '↓ 0.5%', '0.0%']);
    expect([1.2, -0.5, 0].map(formatterFromExample('1.2% △', undefined))).toEqual(['1.2% △', '0.5% ▽', '0.0%']);
    expect(signedFormatterFromExample('▲$1.2M', undefined)(-400_000)).toBe('▼$0.4M');
    expect(seriesRasterFormatter('▲1.2%', [1.2]).fmtSigned(1.2)).toBe('▲1.2%');
    expect([1.2, -0.8, 0].map(formatterFromExample('±1.2%', undefined))).toEqual(['+1.2%', '−0.8%', '0.0%']);
    expect([1_234_567, -234_567, 0].map(formatterFromExample('1,234-', undefined))).toEqual(['1,234,567', '234,567-', '0']);
    expect(formatterFromExample('+1,234 EUR−', undefined)(12)).toBe('+12 EUR');
    expect(formatterFromExample('1,234 EUR−', undefined)(-12)).toBe('12 EUR−');
    expect(formatterFromExample('(1,234)-', undefined)(-12)).toBe('(12)');
    // Keeps direction glyphs inside a unit or prefix in their authored position as literal text.
    expect([0, 1.2, 1234.5, -50].map(formatterFromExample('1.2 ↑ pts', undefined)))
      .toEqual(['0.0 ↑ pts', '1.2 ↑ pts', '1,234.5 ↑ pts', '−50.0 ↑ pts']);
    expect([1.2, -0.5].map(formatterFromExample('Gain ↑ 1.2', undefined))).toEqual(['Gain ↑ 1.2', '−Gain ↑ 0.5']);
    expect([1.2, -0.5].map(formatterFromExample('(▲1.2)', undefined))).toEqual(['▲1.2', '(▲0.5)']);
    // Prevents an end glyph from removing an identical literal glyph inside the unit.
    expect([1.2, -0.5, 0].map(formatterFromExample('1.2 ↑ pts ↑', undefined))).toEqual(['1.2 ↑ pts ↑', '0.5 ↑ pts ↓', '0.0 ↑ pts']);
    // Keeps direction glyphs at the ends of an example tied to the value's sign.
    for (const [example, expected] of [['1.2% ▲', ['1.2% ▲', '0.5% ▼', '0.0%']],
      ['▲ 1.2', ['▲ 1.2', '▼ 0.5', '0.0']], ['1.2 ▲', ['1.2 ▲', '0.5 ▼', '0.0']]] as const) {
      expect([1.2, -0.5, 0].map(formatterFromExample(example, undefined))).toEqual(expected);
    }
    const request = resolveChartRequest({ type: 'table', data: { columns: [{ id: 'n', kind: 'rowLabel', label: 'Item' },
      { id: 'v', kind: 'value', label: 'Value', format: '$1.2k-' }], rows: [{ id: 'a', label: 'A', cells: { v: -1200 } }] }, options: {} } as never);
    const svg = renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme);
    expect(svg).toContain('VALUE ($k)');
    expect(svg).toContain('>1.2-<');
  });

  // Prevents fixed ordinal suffixes and literal exponents from printing the wrong rank or numeric scale.
  it('prints English ordinals and scientific mantissas and exponents by value', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 0, -1, 1.6].map(formatterFromExample('1st', undefined)))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th', '0th', '−1st', '2nd']);
    expect(formatterFromExample('21ST place', 'de')(22)).toBe('22ND place');
    const values = [1_200_000, 2_500_000, 800_000, 1_960_000, 9_960_000, 0.0034, 0, -0.0034];
    expect(values.map(formatterFromExample('1.2E+06', undefined))).toEqual(['1.2E+06', '2.5E+06', '8.0E+05', '2.0E+06', '1.0E+07', '3.4E-03', '0.0E+00', '−3.4E-03']);
    expect(values.map(value => roundedNumber(value, parseFormatExample('1.2E+06')))).toEqual([1_200_000, 2_500_000, 800_000, 2_000_000, 10_000_000, 0.0034, 0, -0.0034]);
    expect(formatterFromExample('USD1.2e6', undefined)(0.0034)).toBe('USD3.4e-3');
    expect(formatterFromExample('1.234E+06', undefined)(1_234_567)).toBe('1.235E+06');
    expect(column('1.2E+06', [1_200_000, 800_000]).texts).toEqual(expect.arrayContaining(['1.2E+06', '8.0E+05']));
    for (const format of ['1st', '1.2E+06']) expect(unscaledFormatLint({ format }, { values: [1_200_000] })).toEqual([]);
  });

  // Prevents a signed waterfall step example from putting a plus on level totals.
  it('prints signed waterfall steps and unsigned totals', () => {
    const request = resolveChartRequest({ type: 'waterfall', data: { items: [
      { id: 'start', label: 'Start', type: 'total', value: 1200 }, { id: 'step', label: 'Step', value: 200 }, { id: 'end', label: 'End', type: 'total' },
    ] }, options: { format: '+$1,234' } } as never);
    const texts = requireGeometry(layoutResolvedRequest(request)).labels.filter(label => !label.hidden).map(label => label.text);
    expect(texts).toEqual(expect.arrayContaining(['$1,200', '+$200', '$1,400']));
    expect(texts).not.toContain('+$1,200');
  });

  // Prevents direction glyphs on waterfall totals, including negative totals with a cell format.
  it('keeps direction glyphs on waterfall steps and off level totals', () => {
    const request = resolveChartRequest({ type: 'waterfall', data: { items: [
      { id: 'start', label: 'Start', type: 'total', value: -1200 }, { id: 'step', label: 'Step', value: 200 },
      { id: 'end', label: 'End', type: 'total', value: { number: -1000, format: '▲$1,234' } },
    ] }, options: { format: '▲$1,234' } } as never);
    const texts = requireGeometry(layoutResolvedRequest(request)).labels.filter(label => !label.hidden).map(label => label.text);
    expect(texts).toEqual(expect.arrayContaining(['−$1,200', '▲$200', '−$1,000']));
    expect(texts.filter(text => /[▲▼]/.test(text))).toEqual(['▲$200']);
  });

  // Prevents accepted grouping mark spellings from being refused or changing the chart's decimal mark.
  it('accepts the typed apostrophe and narrow no-break space as locale grouping marks', () => {
    for (const [thousands, expected] of [["'", "1'234.5"], ['\u202f', '1\u00a0234.5']]) {
      const request = resolveChartRequest({ type: 'column', data: { categories: ['a'], series: [{ id: 's', values: [1234.5] }] },
        options: { format: '1,234.5', locale: { thousands } } } as never);
      expect(requireGeometry(layoutResolvedRequest(request)).labels.map(label => label.text)).toContain(expected);
    }
  });
});

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

// Prevents diverging slope net scores and changes from ignoring the chart format in labels and accessible descriptions.
it('formats diverging slope net scores and changes with options.format', () => {
  const data = { categories: ['Before', 'After'], series: [
    { id: 'rise', label: 'Rise', values: [42, 55], negative: [22, 15] },
    { id: 'fall', label: 'Fall', values: [36, 20], negative: [14, 30] },
    { id: 'flat', label: 'Flat', values: [20, 30], negative: [20, 30] },
  ] };
  for (const [format, language, decimal] of [['1.0', 'en', '.'], ['+1.0', 'en', '.'], ['1,0', 'de', ',']] as const) {
    const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'slope', data,
      options: { variant: 'diverging', format, locale: { language, decimal }, size: { width: 960 } },
    } as never)));
    const net = geometry.labels.filter(label => !label.hidden && label.id.endsWith(':net')).map(label => label.text).sort();
    expect(net).toEqual([`+40${decimal}0 (+20${decimal}0)`, `−10${decimal}0 (−32${decimal}0)`, `0${decimal}0 (0${decimal}0)`].sort());
    expect(geometry.a11y.desc).toContain(`Rise +40${decimal}0`);
  }
});

// Prevents a percent format from printing the difference of two shares (net, net change) as a percent; it is percentage points.
it('prints diverging slope net scores in percentage points under a percent format', () => {
  const data = { categories: ['Before', 'After'], series: [{ id: 'rise', label: 'Rise', values: [42, 55], negative: [22, 15] }] };
  const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'slope', data,
    options: { variant: 'diverging', format: '0.0%', size: { width: 960 } },
  } as never)));
  const net = geometry.labels.filter(label => !label.hidden && label.id.endsWith(':net')).map(label => label.text);
  expect(net).toEqual(['+40.0pp (+20.0pp)']);
  expect(geometry.a11y.desc).toContain('Rise +40.0pp');
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
  // A physical unit stays literal; a currency affix drops its scale when reading the raw value.
  for (const [format, expected] of [['1,234 EUR/kg', '1,234 EUR/kg'], ['1,234 EURk', '1,234 EUR']]) {
    const literal = resolveChartRequest({ type: 'table', data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Row' }, { id: 'v', kind: 'value', label: 'Value', format }],
      rows: [{ id: 'r', label: 'r', cells: { v: 1234 } }] }, options: { title: 'Units' } } as never);
    const literalTable = accessibleDataTable(interactionRecords({ request: literal, geometry: requireGeometry(layoutResolvedRequest(literal)), scope: literal.scope, claims: [] }));
    expect(literalTable.rows[0]!.cells[0]!.text).toBe(expected);
  }
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
  // Quartiles that are observations stay exact; the card prints them as a span at the chart's label precision.
  expect(text(record, 'quartiles')).toBe('0.10 to 0.40');
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
    // One magnitude would hide the two middle figures, so each unformatted row prints at its own scale.
    expect(displayed(resolveTable(data))).toEqual(['1.2M', '12,345', '−12,345', '0.0']);
    expect(displayed(resolveTable({ ...data, columns: [data.columns[0]!, { id: 'v', kind: 'value', label: 'Value', format: '1.2M' }] }))).toEqual(['1.2', '0.0', '0.0', '0.0']);
    // A unit that names a scale states the data's scale as authored: the figures print whole, with no second magnitude.
    expect(displayed(resolveTable(data, { unit: 'M units' }))).toEqual(['1,234,567', '12,345', '−12,345', '0']);
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

  // A format below the chart printed a nonzero value as 0 without a warning, and a guess at what the engine prints warned where it printed no zero: the chart's own records decide.
  it('warns where an authored format prints a nonzero value as zero, and only there', () => {
    const categories = [{ id: 'a', label: 'North' }, { id: 'b', label: 'South' }];
    const column = (series: unknown[], options: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({ type: 'column', data: { categories, series, ...data }, options });
    const table = (columns: unknown[], rows: unknown[], options: Record<string, unknown> = {}) => ({ type: 'table', data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Region' }, ...columns], rows }, options });
    const bartable = (format: string, values: number[]) => ({ type: 'bartable', data: { categories: [{ id: 'a', label: 'North' }], series: [{ id: 's', label: 'Sales' }],
      panels: [{ id: 'p', label: 'Sales', values: { s: [1] } }], columns: [{ id: 'x', label: 'Stores', format, values }] } });
    const repeat = (values: string[]) => ({ type: 'grid', data: { repeat: { facet: 'series', dimension: 'channel', values }, template: { type: 'column', options: { format: '1,234' },
      data: { categories, series: [{ id: 'web', label: 'Web', values: [0.042, 12] }, { id: 'store', label: 'Store', values: [5, 9] }] } } } });
    // Each case: the spec, then the patch path of each format-hides-values warning (null: a warning with no patch).
    const cases: [string, unknown, (string | null)[]][] = [
      ['series format', column([{ id: 's', label: 'S', format: '1,234', values: [0.042, 12] }]), ['/data/series/0/format']],
      ['keyed value', column([{ id: 's', label: 'S', format: '1,234', values: [{ categoryId: 'a', value: 0.042 }, { categoryId: 'b', value: 12 }] }]), ['/data/series/0/format']],
      ['own value format under the chart format', column([{ id: 's', label: 'S', values: [{ number: 0.042, format: '12' }, 3] }], { format: '12' }), ['/data/series/0/values/0/format']],
      ['own value format that shows the value', column([{ id: 's', label: 'S', format: '1,234', values: [{ number: 0.042, format: '0.123' }, 12] }]), []],
      ['scaled format that prints a nonzero figure', column([{ id: 's', label: 'S', format: '1.2k', values: [20, 1000] }]), []],
      ['percent format over fractions', column([{ id: 's', label: 'S', format: '12%', values: [0.2, 2] }], {}, { valueKind: 'fraction' }), []],
      ['bar table column', bartable('1,234', [0.042]), ['/data/columns/0/format']],
      ['bar table column at the decimal limit', bartable('0.00000000000000000000', [1e-21]), [null]],
      ['table column and cell', table([{ id: 'rev', kind: 'value', label: 'Revenue', format: '1,234' }],
        [{ id: 'all', label: 'All', cells: { rev: 12 }, children: [{ id: 'north', label: 'North', cells: { rev: 0.042 } }, { id: 'south', label: 'South', cells: { rev: { v: 0.03, format: '1.2' } } }] }]),
      ['/data/rows/0/children/1/cells/rev/format', '/data/columns/1/format']],
      ['suppressed table cell', table([{ id: 'rev', kind: 'value', label: 'Revenue', format: '1,234' }], [{ id: 'r', label: 'R', cells: { rev: { v: 0.042, state: 'suppressed' } } }]), []],
      ['table magnitude', table([{ id: 'rev', kind: 'value', label: 'Revenue', format: '1,234k' }], [{ id: 'r', label: 'R', cells: { rev: 42 } }], { magnitude: 'thousand' }), []],
      ['inline row with its own format', table([{ id: 'rev', kind: 'value', label: 'Revenue', format: '1,234' }],
        [{ id: 'r', label: 'R', cells: { rev: 1 }, children: [{ id: 'm', label: 'M', inline: true, relation: 'displayOnly', format: '0.0000', cells: { rev: 0.042 } }] }]), []],
      ['grid panel', { type: 'grid', data: { panels: [{ id: 'sales', type: 'column', options: { format: '1,234' }, data: { categories, series: [{ id: 's', label: 'Sales', values: [0.042, 12] }] } }] } },
        ['/data/panels/0/options/format']],
      ['repeat template', repeat(['web', 'store']), ['/data/template/options/format']],
      ['repeat template, series not drawn', repeat(['store']), []],
    ];
    for (const [name, spec, paths] of cases) {
      const body = render({ spec, return: ['reading'] } as never).body as { errors?: unknown[]; warnings: { code: string; fix?: { path: string }[] }[] };
      expect([name, body.errors ?? [], body.warnings.filter((warning) => warning.code === 'format-hides-values').map((warning) => warning.fix?.[0]?.path ?? null)])
        .toEqual([name, [], paths]);
    }
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

  // A unit with a scale word and a noun ("k visits") printed 260,000 as "260k", which read 1,000 times too large beside it.
  it('adds no automatic magnitude under a unit that names a scale before a noun', () => {
    for (const unit of ['k visits', 'million tonnes', 'Mio. Besucher', 'K users', 'M users', 'Milliarde Besuche', 'mn users']) {
      expect(seriesRasterFormatter(undefined, [260_000, 1_011_000], 'en', unit, 'slide').fmt(260_000)).toBe('260,000');
    }
    expect(unitMagnitude('Milliarde Besuche')).toBe(unitMagnitude('Milliarden Besuche'));
    expect(seriesRasterFormatter(undefined, [260_000, 1_011_000], 'en', 'minutes', 'slide').fmt(1_011_000)).toBe('1.01M');
    // A physical unit, a rate or a word that is no scale names no scale: no whole-number rule from 100 up.
    for (const unit of ['mm Hg', 'mm rain', 'm per second', 'm / s', 'k / visit', 'k visits per day', 'constructor calls', 'toString count']) {
      expect(unitMagnitude(unit), unit).toBeUndefined();
    }
    // A format example with a scale word before a noun now divides by that scale (main printed "125,000.0 M entry").
    expect(formatterFromExample('1.2 M entry', 'en')(125_000)).toBe('0.1 M entry');
    const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'column',
      data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 'p', label: 'Pressure', values: [125.5, 98.2] }] },
      options: { unit: 'mm Hg', labels: { value: true }, size: { width: 480, height: 320 } } })));
    expect(geometry.labels.some((label) => !label.hidden && label.text === '125.5')).toBe(true);
  });

  // "$1.2M" fixes one decimal, so $4.27M printed $4.3M and no example gave 42.7, 4.27 and 0.430 together: one @ per figure fixes the figures, not the decimals.
  it('prints a fixed count of significant figures for an @ example, rolls up at 1000 and keeps ticks plain', () => {
    const print = formatterFromExample('$@@@M', undefined);
    expect([42_700_000, 4_270_000, 430_000, 999_600, 999_960_000, 0, -4_270_000].map(print))
      .toEqual(['$42.7M', '$4.27M', '$0.430M', '$1.00M', '$1.00B', '$0.00M', '\u2212$4.27M']);
    expect(formatterFromExample('@@@%', undefined)(9.996)).toBe('10.0%');
    expect(formatterFromExample('+@@k', 'de')(1234)).toBe('+1,2k');
    expect(formatterFromExample('$1.2M', undefined)(4_270_000)).toBe('$4.3M');
    const ticks = tickFormatter(parseFormatExample('$@@@M'), [0, 1e7, 2e7]);
    expect([0, 1e7, 2e7].map(ticks)).toEqual(['$0M', '$10M', '$20M']);
    expect(formatExampleProblem('@@.@%')).toMatchObject({ replacement: '@@@%' });
    expect(formatExampleProblem('@@@@@@@@@@@@@@@@')?.replacement).toBe('@'.repeat(15));
    expect(formatExampleProblem('$@@@M')).toBeUndefined();
  });

  // Prevents maps from refusing exact thresholds that need more decimals than an @ example's fallback.
  it('accepts exact significant-figure map thresholds and refuses thresholds the format rounds', async () => {
    await import('../src/core/geo/packs');
    const regions = ['DE-BW', 'DE-BY', 'DE-BE', 'DE-BB', 'DE-HB', 'DE-HH']
      .map((id, index) => ({ id, value: [0.00043, 0.00427, 0.0427, 0.427, 4.27, 42.7][index]! }));
    const render = (steps: number[]) => {
      const request = resolveChartRequest({ type: 'choropleth', data: { pack: 'de-states', regions },
        options: { format: '@@@%', steps } } as never);
      return renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme);
    };
    const svg = render([0.00427, 0.0427, 0.427, 4.27]);
    expect(svg).toContain('0.00427%');
    expect(() => render([0.004271, 0.0427, 0.427, 4.27])).toThrow('the format rounds an explicit threshold');
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

// A Proxy can return another format example than its stored field, and a cached reading must not round the number on that gap.
it('reads a proxied column format example from the value the Proxy returns', async () => {
  const column = new Proxy({ id: 'v', kind: 'value', format: '1,234' }, { get: (target, key, receiver) => key === 'format' ? '1.234' : Reflect.get(target, key, receiver) });
  const data = { columns: [{ id: 'label', kind: 'rowLabel' }, column], rows: [{ id: 'a', label: 'Orders', cells: { v: 0.512 } }] };
  const prepared = JSON.stringify(await prepareChart({ type: 'table', data, options: { size: { width: 600 } } } as never));
  expect(prepared).toContain('"displayed":"0.512"');
});

describe('a unit that names a scale takes no second one', () => {
  const drawnTexts = (type: string, data: unknown, options: object) => {
    const request = resolveChartRequest({ type, data, options } as never);
    return [...renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme).matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map(match => match[1]!.replace(/<[^>]*>/g, ''));
  };
  const scaled = (texts: string[]) => texts.filter(text => /\d(?:\.\d+)?\s?[MB]\b/.test(text));
  const stack = { categories: ['FY23', 'FY24', 'FY25', 'FY26'], series: [{ id: 'a', label: 'Hardware', values: [46_000_000, 45_000_000, 42_000_000, 40_000_000] },
    { id: 'b', label: 'Software', values: [20_000_000, 26_000_000, 33_000_000, 41_000_000] }, { id: 'c', label: 'Services', values: [18_000_000, 20_000_000, 22_000_000, 24_000_000] }] };

  // The compact stack totals of a narrow card printed "105.0M" under "in $m": millions of millions.
  it('prints compact column totals whole under a scale unit', () => {
    const texts = drawnTexts('column', stack, { variant: 'stacked', unit: '$m', mode: 'compact', subtitle: { measure: 'Revenue' }, size: { width: 320 } });
    expect(texts.some(text => /^\d{2,3},\d{3},\d{3}$/.test(text))).toBe(true);
    expect(scaled(texts)).toEqual([]);
  });

  // A grid printed "$m" over panels that named no unit, and the panels printed "20M" under it.
  it('gives a grid scale unit to the panels that name none', () => {
    const panel = (id: string) => ({ id, type: 'column', title: id, data: { categories: ['FY24', 'FY25'], series: [{ id: 'rev', label: 'Revenue', values: [20_000_000, 44_000_000] }] } });
    const texts = drawnTexts('grid', { panels: [panel('North'), panel('South')] }, { unit: '$m', columns: 2, sharedAxis: 'none', size: { width: 720 } });
    expect(texts).toContain('20,000,000');
    expect(scaled(texts)).toEqual([]);
  });

  // Kpi panels printed the inherited "$m" beside their labels, so the grid dropped its own unit line and a table panel beside them showed no unit.
  it('keeps the grid unit line when kpi panels take its scale unit', () => {
    const table = { columns: [{ id: 'label', kind: 'rowLabel', label: 'Region' }, { id: 'fy25', kind: 'value', label: 'FY25' }], rows: [{ id: 'north', label: 'North', cells: { fy25: 8.5 } }] };
    const texts = drawnTexts('grid', { panels: [{ id: 'k', type: 'kpi', data: { label: 'Orders', value: 120 }, options: { title: 'Orders' } },
      { id: 't', type: 'table', data: table, options: { title: 'By region' } }] }, { title: 'Revenue', unit: '$m', columns: 2, size: { width: 720 } });
    expect(texts).toContain('$m');
    expect(texts.filter(text => text.includes('in $m'))).toEqual([]);
  });

  // A table panel under the grid's "$m" printed 8,540,000 as "8.5" with "(M)" in its head: millions of millions.
  it('prints a table panel whole under the grid scale unit', () => {
    const table = { columns: [{ id: 'label', kind: 'rowLabel', label: 'Region' }, { id: 'fy25', kind: 'value', label: 'FY25' }],
      rows: [{ id: 'north', label: 'North', cells: { fy25: 8_540_000 } }, { id: 'south', label: 'South', cells: { fy25: 1_160_000 } }] };
    const texts = drawnTexts('grid', { panels: [{ id: 'k1', type: 'kpi', data: { label: 'Orders', value: 120 } }, { id: 'k2', type: 'kpi', data: { label: 'Revenue', value: 20_500_000 } },
      { id: 't', type: 'table', data: table }] }, { title: 'Revenue', unit: '$m', columns: 3, size: { width: 900 } });
    expect(texts).toEqual(expect.arrayContaining(['8,540,000', '1,160,000', '$m']));
    expect(texts.filter(text => /\(M\)|\d[MB]\b/.test(text))).toEqual([]);
  });

  // A panel whose series named "%" took the grid's "$m" and was refused with unit-conflict.
  it('leaves a panel that names a unit in its data to that unit', () => {
    const panel = { id: 'rate', type: 'column', data: { categories: ['A'], series: [{ id: 's', unit: '%', values: [25] }] } };
    const result = render({ spec: { type: 'grid', data: { panels: [panel] }, options: { unit: '$m', sharedAxis: 'none', sharedScale: false, size: { width: 960, height: 600 } } }, return: [] } as never);
    expect((result.body as { errors?: { code: string }[] }).errors).toEqual([]);
  });

  // A combo line that named no unit beside a "$m" column printed "24M": the unit check reads it in "$m", the formatter did not.
  it('reads a unit-less combo series in the unit its group names', () => {
    const data = { categories: ['Q1'], series: [{ id: 'revenue', unit: '$m', values: [12_000_000] }, { id: 'cost', kind: 'line', values: [24_000_000] }] };
    const texts = drawnTexts('combo', data, { axisTitles: { primary: 'Amount ($m)' }, valueAxis: { show: true, min: 0, max: 30_000_000, tickStep: 5_000_000 }, size: { width: 960, height: 600 } });
    expect(texts).toContain('24,000,000');
    expect(scaled(texts)).toEqual([]);
  });

  // A combo secondary line without a unit printed "12M" under the subtitle's "in $m".
  it('holds a unit-less combo secondary line to the chart scale unit', () => {
    const data = { categories: ['Q1', 'Q2'], series: [{ id: 'rev', label: 'Revenue', values: [30_000_000, 54_000_000] }, { id: 'cost', label: 'Cost', kind: 'line', axis: 'secondary', values: [12_000_000, 14_000_000] }] };
    const texts = drawnTexts('combo', data, { unit: '$m', secondaryAxis: { acknowledge: true }, subtitle: { measure: 'Revenue and cost' }, size: { width: 480 } });
    expect(texts).toContain('12,000,000');
    expect(scaled(texts)).toEqual([]);
  });
});

// Under a comma decimal mark the record lost the drawn text: "1.180M" read as 1.18M and "0,042" as 42, so the hover printed the source number.
it('keeps the drawn text on the record under the chart number marks', async () => {
  const { interactionRecords } = await import('../src/core/a11y/records');
  const displayed = (type: string, series: unknown[]) => {
    const request = resolveChartRequest({ type, data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series }, options: { target: 'report', locale: { decimal: ',', thousands: '.' } } } as never);
    return interactionRecords({ request, geometry: requireGeometry(layoutResolvedRequest(request)), scope: request.scope, claims: [] }).map((record) => record.value.displayed);
  };
  expect(displayed('funnel', [{ id: 'x', label: 'X', values: [1180000000, 590000000] }, { id: 'y', label: 'Y', values: [590000000, 290000000] }])).toContain('1.180M');
  expect(displayed('bar', [{ id: 's', label: 'S', format: '0,042', values: [1234.5, 0.042] }])).toContain('0,042');
});
