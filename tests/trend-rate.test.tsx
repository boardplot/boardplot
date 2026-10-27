import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { formatterFromExample } from '../src/core/formatSpec';
import { renderSvg } from '../src/core/svg/renderSvg';
import { getFixtures } from '../src/fixtures';
import { LineChart } from '../src/react/charts/line';
import { ScatterChart } from '../src/react/charts/scatter';

const slopes = [0.004, 0.04, 0.4, 4, 28.429, 1234.5, -0.4];
const faces = ['0.0040', '0.040', '0.40', '4.0', '28.4', '1,235', '−0.40'];
const types = ['line', 'area', 'scatter'] as const;
type Kind = typeof types[number];
const size = { width: 1000, height: 600 };

function draw(kind: Kind, rates: number[], format?: string, base = 100, extra: object = {}, dates?: string[]) {
  const values = rates.map(rate => Array.from({ length: 6 }, (_, i) => base + rate * i));
  const categories = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, ...(dates ? { date: dates[i] } : {}) }));
  const data = kind === 'scatter'
    ? { points: values.flatMap((ys, group) => ys.map((y, x) => ({ id: `p${group}-${x}`, x, y, group: `g${group}` }))) }
    : { categories, series: values.map((ys, i) => ({ id: `s${i}`, label: `Series ${i}`, values: ys })) };
  const options = { size, legend: 'bottom' as const,
    ...(kind === 'scatter' ? { trend: { groups: 'each' as const }, axisFormat: { y: format } } : { trend: true, variant: kind, format }), ...extra };
  const request = resolveChartRequest({ type: kind === 'scatter' ? 'scatter' : 'line', data, options } as never);
  const geometry = requireGeometry(layoutResolvedRequest(request));
  const svg = renderSvg(geometry, request.theme);
  const react = renderToStaticMarkup(kind === 'scatter'
    ? <ScatterChart data={data as never} {...options as object} deferLayout={false} />
    : <LineChart data={data as never} {...options as object} deferLayout={false} />);
  return { svg, react, geometry };
}

function check(kind: Kind, rate: number, face: string, format?: string, base = 100) {
  const output = draw(kind, [rate], format, base);
  const expected = kind === 'scatter' ? `slope ${face}` : `${rate > 0 ? '+' : ''}${face} per period`;
  for (const rendered of [output.svg, output.react]) {
    const keys = (rendered.match(/<text\b[^>]*data-part="legendLabel"[\s\S]*?<\/text>/g) ?? []).join('').replace(/<[^>]*>/g, '');
    expect(keys.includes(expected), `${kind}: ${format ?? 'none'}, ${rate}: ${expected}`).toBe(true);
  }
  return output;
}

// Prevents axis precision from adding needless digits or hiding a small rate, while keeping comparable rates consistent.
it('prints rates at their own precision in SVG and React', () => {
  for (const kind of types) {
    slopes.forEach((rate, i) => check(kind, rate, faces[i]!));
    const output = draw(kind, [0.4, 0.04, 4, 1234.5]);
    for (const face of ['0.40', '0.040', '4.0', '1,235']) {
      for (const rendered of [output.svg, output.react]) expect(rendered).toContain(kind === 'scatter' ? `slope ${face}` : `+${face} per period`);
    }
  }
});

// Prevents a small neighbouring rate from adding unsupported digits to a larger rate.
it('keeps each rate within its own precision across a mixed-size band', () => {
  for (const kind of types) {
    const output = draw(kind, [0.4, 0.0016], '1.0%', 0);
    for (const rendered of [output.svg, output.react]) {
      for (const face of ['0.40pp', '0.0016pp']) expect(rendered).toContain(kind === 'scatter' ? `slope ${face}` : `+${face} per period`);
      expect(rendered).not.toContain('0.4000pp');
    }
    expect(draw(kind, [0.4, 0.0016], '1.0%', 0).svg).toBe(output.svg);
  }
});

// Prevents a rate from naming its scale in another spelling family than the ticks, or with an English false friend.
it('keeps the authored word family for each rate magnitude', () => {
  for (const kind of types) for (const language of ['en', 'en-US', 'de', 'de-DE', 'de-CH', 'fr']) {
    const german = language.startsWith('de');
    // A French reader takes "bn" for "billion" (10¹²): English abbreviations print the French short forms.
    const french = language === 'fr';
    const options = { locale: { language, decimal: german ? ',' : '.', thousands: german ? '.' : ',' } };
    const output = draw(kind, [1234.5, 1_234_500, 1_234_500_000], german ? '1,0 Mio.' : '1.0 mn', 0, options);
    const faces = german ? ['1,2 Tsd.', '1,2 Mio.', '1,2 Mrd.'] : french ? ['1.2 k', '1.2 M', '1.2 Md'] : ['1.2 k', '1.2 mn', '1.2 bn'];
    for (const rendered of [output.svg, output.react]) for (const face of faces) expect(rendered).toContain(kind === 'scatter' ? `${german ? 'Steigung' : 'slope'} ${face}` : `+${face} ${german ? 'pro Periode' : 'per period'}`);
    expect(formatterFromExample(german ? '1,0 Mio.' : '1.0 mn', language)(1e9)).toBe(`${new Intl.NumberFormat(language, { minimumFractionDigits: 1 }).format(1)}${german ? ' Mrd.' : french ? ' Md' : ' bn'}`);
  }
  // A rate at a magnitude word's own scale prints the authored word, as the ticks do.
  check('line', 1_234_500, '1.2 mn', '1.0 mn', 0);
});

// Prevents a rate of 999,960 from printing "1.000,0 Tsd." and 0.00099996 from leaving the fixed band of 0.001.
it('chooses the rate magnitude and notation after rounding', () => {
  const german = { locale: { language: 'de', decimal: ',' as const, thousands: '.' as const } };
  for (const kind of types) {
    const output = draw(kind, [999_960], '1,0 Mio.', 0, german);
    for (const rendered of [output.svg, output.react]) expect(rendered).toContain(kind === 'scatter' ? 'Steigung 1,0 Mio.' : '+1,0 Mio. pro Periode');
    check(kind, 0.00099996, '0.0010', undefined, 0);
    check(kind, 999.96, '1.0 k', '1.0 mn', 0);
  }
});

// Prevents German accessible text from ending a value with two periods ("1,3 Mio..").
it('ends a sentence once after a magnitude abbreviation', () => {
  const output = draw('line', [100_000, 300_000], '1,0 Mio.', 1_000_000, { locale: { language: 'de', decimal: ',', thousands: '.' } });
  for (const rendered of [output.svg, output.react]) {
    expect(rendered).toMatch(/<desc[^>]*>[^<]*Mio\./);
    expect(rendered).not.toContain('Mio..');
  }
});

// Prevents a rate that rounds across a precision boundary from keeping the smaller band's decimals.
it('chooses each rate precision band after rounding', () => {
  for (const kind of types) for (const [rate, face] of [[99.96, '100'], [0.996, '1.0'], [0.09996, '0.10'], [-99.96, '−100'], [-0.996, '−1.0']] as const) {
    check(kind, rate, face, undefined, 0);
  }
});

// Prevents a rate from inheriting an axis magnitude that turns it into zero or a bound.
it('chooses the magnitude from the rate, including k, M and B', () => {
  for (const kind of types) {
    for (const format of ['1,234k', '1.0M']) {
      const compact = [...faces.slice(0, 4), format === '1,234k' ? '28' : '28.4', '1.2k', faces[6]!];
      slopes.forEach((rate, i) => check(kind, rate, compact[i]!, format, 1_000_000));
    }
    check(kind, 7, '7.0', '1,234k', 50_000);
    check(kind, 1_234_500, '1.2M', '1.0M', 1_000_000);
    check(kind, 1_234_500_000, '1.2B', '1.0M', 1_000_000);
  }
});

// Prevents a percent-axis slope from claiming relative percent growth instead of a change in percentage points.
it('prints percent rates as percentage points in all three charts', () => {
  const percent = ['0.0040', '0.040', '0.40', '4.0', '28.4', '1,234.5', '−0.40'];
  for (const kind of types) slopes.forEach((rate, i) => check(kind, rate, `${percent[i]}pp`, '1.0%', 40));
});

// Prevents trend keys from losing a currency symbol, moving it or changing the chart's sign style.
it('keeps the currency symbol, position and sign style', () => {
  const whole = ['0.0040', '0.040', '0.40', '4.0', '28', '1,235', '−0.40'];
  for (const kind of types) for (const format of ['$1,234', '1,234 €', '($1,234)']) {
    slopes.forEach((rate, i) => {
      const unsigned = whole[i]!.replace('−', '');
      const body = format.includes('$') ? `$${unsigned}` : `${unsigned} €`;
      const face = rate < 0 ? (kind !== 'scatter' && format.startsWith('(') ? `(${body})` : `−${body}`) : body;
      check(kind, rate, face, format, 500);
    });
  }
});

// Prevents an authored precision from being discarded when it is useful, or from erasing a small rate when it is not.
it('honours explicit decimals only when they show at least two significant digits', () => {
  const examples = [
    ['0.000', ['0.0040', '0.040', '0.400', '4.000', '28.429', '1,234.500', '−0.400']],
    ['1.1', ['0.0040', '0.040', '0.40', '4.0', '28.4', '1,234.5', '−0.40']],
  ] as const;
  for (const kind of types) for (const [format, expected] of examples) slopes.forEach((rate, i) => check(kind, rate, expected[i]!, format, 10));
});

// Prevents global small-value settings from turning a real rate into zero or a bound, and keeps repeated SVG bytes identical.
it('keeps tiny nonzero rates numeric and deterministic', () => {
  for (const kind of types) for (const smallValues of ['bound', 'zero', 'p-value', 'scientific']) {
    const output = draw(kind, [4e-12, -4e-12], '1,234k', 0, { smallValues });
    for (const rendered of [output.svg, output.react]) {
      expect(rendered).toContain('4.0\u00a0×\u00a010⁻¹²');
      expect(rendered).toContain('−4.0\u00a0×\u00a010⁻¹²');
    }
    expect(draw(kind, [4e-12, -4e-12], '1,234k', 0, { smallValues }).svg).toBe(output.svg);
  }
  for (const kind of types) {
    const output = draw(kind, [4e-24, -4e-24], '$1,234', 0);
    for (const rendered of [output.svg, output.react]) {
      expect(rendered).toContain('$4.0\u00a0×\u00a010⁻²⁴');
      expect(rendered).toContain('−$4.0\u00a0×\u00a010⁻²⁴');
    }
  }
});

// Prevents a float-noise rate from printing 14 decimals and refusing a narrow chart that can be drawn.
it('prints a rate below four decimals in scientific form, so a near-zero trend keeps its key short', () => {
  const fixture = getFixtures('line').find(entry => entry.id === 'sparse-phases')!;
  const request = resolveChartRequest({ type: 'line', data: fixture.data, options: { ...fixture.options, trend: true, size: { width: 320, height: 205 } } } as never);
  const svg = renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme);
  expect(svg).toMatch(/per period/);
  expect(svg).toContain('\u00a0×\u00a010⁻');
});

// Prevents annual readings away from New Year from printing a quarterly or daily rate with the wrong value.
it('derives the reporting period and rate from date spacing on any day', () => {
  for (const kind of ['line', 'area'] as const) for (const day of ['06-30', '05-15', '12-31', '01-01']) {
    const dates = Array.from({ length: 6 }, (_, i) => `${2020 + i}-${day}`);
    const output = draw(kind, [28.429], undefined, 100, {}, dates);
    expect((output.geometry.derived as { trends: { slope: number; unit: string }[] }).trends[0]).toMatchObject({ slope: expect.closeTo(28.429, 9), unit: 'year' });
    for (const rendered of [output.svg, output.react]) expect(rendered).toContain('+28.4 per year');
  }
  for (const kind of ['line', 'area'] as const) {
    const dates = ['2020-02-29', '2021-02-28', '2022-02-28', '2023-02-28', '2024-02-29', '2025-02-28'];
    const output = draw(kind, [4], undefined, 100, {}, dates);
    expect((output.geometry.derived as { trends: { slope: number; unit: string }[] }).trends[0]).toMatchObject({ slope: 4, unit: 'year' });
    for (const rendered of [output.svg, output.react]) expect(rendered).toContain('+4.0 per year');
  }
});
