import { describe, expect, it } from 'vitest';
import { NormalizeError } from '../../src/core/normalize/shared';
import { MINUS } from '../../src/core/format';
import { exampleSpec, formatNonzeroWithSpec, formatterFromExample, formatWithSpec, parseFormatExample, seriesRasterFormatter, setFormatPlan, unitOfSpec } from '../../src/core/formatSpec';

describe('parseFormatExample', () => {
  it('"+1,234" → forced sign, comma grouping', () => {
    const spec = parseFormatExample('+1,234');
    expect(spec.signed).toBe(true);
    expect(spec.thousandsSep).toBe(',');
    expect(spec.decimals).toBe(0);
  });

  it('"20.5%" → percent with decimal', () => {
    const spec = parseFormatExample('20.5%');
    expect(spec.suffix).toBe('%');
    expect(spec.decimals).toBe(1);
  });

  it('"1.5" single separator with non-3 digits → decimal', () => {
    const spec = parseFormatExample('1.5');
    expect(spec.decimals).toBe(1);
    expect(spec.thousandsSep).toBe('');
  });

  it('"1.234.567" repeated separator → grouping', () => {
    const spec = parseFormatExample('1.234.567');
    expect(spec.thousandsSep).toBe('.');
    expect(spec.decimals).toBe(0);
  });

  it('"USD 1,234" currency word prefix', () => {
    const spec = parseFormatExample('USD 1,234');
    expect(spec.prefix).toBe('USD ');
  });

  it('"-USD 1,234" negative marker does not leak into prefix', () => {
    const spec = parseFormatExample('-USD 1,234');
    expect(spec.prefix).toBe('USD ');
    expect(spec.negative).toBe('minus');
  });

  it("Swiss prime grouping \"1'234\"", () => {
    const spec = parseFormatExample("1'234");
    expect(spec.thousandsSep).toBe("'");
  });

  it('rejects examples with unsupported decimal precision', () => {
    expect(() => parseFormatExample(`1.${'0'.repeat(21)}`)).toThrow(
      /decimals must be an integer between 0 and 20/,
    );
  });

  it('rejects examples with no numeric body', () => {
    expect(() => parseFormatExample('garbage')).toThrow(/invalid-format-example/);
    expect(() => formatterFromExample('abc', undefined)).toThrow(/invalid-format-example/);
    expect(() => parseFormatExample('   ')).toThrow(/invalid-format-example/);
  });

  it('refuses a bad example with a NormalizeError that carries a code and a fix', () => {
    for (const bad of ['garbage', '0.0,"M"']) {
      try {
        parseFormatExample(bad);
        throw new Error('expected a throw');
      } catch (error) {
        expect(error).toBeInstanceOf(NormalizeError);
        expect((error as NormalizeError).code).toBe('invalid-format');
        expect((error as NormalizeError).suggest).toMatch(/example number/);
      }
    }
  });
});

describe('formatterFromExample round-trips', () => {
  // Prevents an outside currency prefix from making a positive value look negative.
  it('reads accounting examples with a currency before the parentheses', () => {
    for (const [example, positive] of [['$(1,234)', '$500'], ['$ (1,234)', '$ 500'], ['€(1.234)', '€500'], ['USD (1,234)', 'USD 500'], ['($1,234)', '$500']]) {
      const f = formatterFromExample(example!, undefined);
      expect(f(500), example).toBe(positive);
      expect(f(-500), example).toBe(`(${positive})`);
      expect(f(0), example).not.toMatch(/[()]/);
      expect(f(-0.01), example).not.toMatch(/[()]/);
    }
  });

  // Prevents an outside currency or percent suffix from putting positive values in parentheses.
  it('reads accounting examples with a unit after the parentheses', () => {
    for (const [example, positive] of [['(1.234) €', '500 €'], ['(1,234)$', '500$'], ['(1,234)%', '500%'], ['(1,234) kg', '500 kg'], ['(1,234 kg)', '500 kg']]) {
      const f = formatterFromExample(example!, undefined);
      expect(f(500), example).toBe(positive);
      expect(f(-500), example).toBe(`(${positive})`);
      expect(f(0), example).not.toMatch(/[()]/);
    }
  });

  // Prevents accounting parentheses from hiding a magnitude word and changing the number's scale.
  it('reads accounting examples with magnitude words inside or outside the parentheses', () => {
    for (const example of ['$(1.2M)', '$(1.2)M', '(1.2M) €', '(1.2) Mio. €']) {
      const f = formatterFromExample(example, undefined);
      const positive = example.startsWith('$') ? '$5.0M' : example.includes('Mio.') ? '5.0 Mio. €' : '5.0M €';
      expect(f(5_000_000), example).toBe(positive);
      expect(f(-5_000_000), example).toBe(`(${positive})`);
    }
  });

  // Prevents a note or a unit in parentheses, which drew on main, from being refused or read as accounting.
  it('keeps notes and units in parentheses as literal text', () => {
    for (const [example, positive, negative] of [['(n=1,234)', '(n=500)', '−(n=500)'], ['(note: 1,234)', '(note: 500)', '−(note: 500)'],
      ['1,234 (kg)', '500 (kg)', '−500 (kg)'], ['$1,234 (USD)', '$500 (USD)', '−$500 (USD)'], ['12.5% (YoY)', '500.0% (YoY)', '−500.0% (YoY)'],
      ['1,234 (2020 USD)', '500 (2020 USD)', '−500 (2020 USD)'], ['1,234 (95% CI)', '500 (95% CI)', '−500 (95% CI)']]) {
      const f = formatterFromExample(example!, undefined);
      expect(f(500), example).toBe(positive);
      expect(f(-500), example).toBe(negative);
    }
  });

  // Prevents broken parentheses from silently printing a false negative sign.
  it('refuses parentheses that do not give one clear accounting example', () => {
    for (const example of ['(1,234', '1,234)', '((1,234))', '(1,234) (kg)', '(1,234) 567']) {
      expect(() => formatterFromExample(example, undefined), example).toThrow(/invalid-format-example/);
    }
  });

  // A literal-# rank ("#1") grouped column values ("#7,969") while the KPI card printed "#7969".
  it('keeps a literal-# rank ungrouped', () => {
    expect(formatterFromExample('#1', undefined)(7969)).toBe('#7969');
  });

  it('German style', () => {
    const f = formatterFromExample('1.000,00', undefined);
    expect(f(1234567.891)).toBe('1.234.567,89');
    expect(f(-42)).toBe(`${MINUS}42,00`);
  });

  it('dollar millions', () => {
    const f = formatterFromExample('$1.2M', undefined);
    expect(f(3456789)).toBe('$3.5M');
  });

  it('parens negatives', () => {
    const f = formatterFromExample('(1,234)', undefined);
    expect(f(-9876)).toBe('(9,876)');
    expect(f(9876)).toBe('9,876');
  });

  it('forced plus', () => {
    const f = formatterFromExample('+20%', undefined);
    expect(f(12)).toBe('+12%');
    expect(f(-12)).toBe(`${MINUS}12%`);
    expect(formatterFromExample('+1', undefined)(0.01)).toBe('0');
    expect(formatterFromExample('+1', undefined)(-0.01)).toBe('0');
  });

  it('billions with prefix', () => {
    const f = formatterFromExample('$1.2bn', undefined);
    expect(f(5600000000)).toBe('$5.6bn');
  });

  it('never renders -0', () => {
    const f = formatterFromExample('1.0', undefined);
    expect(f(-0.01)).toBe('0.0');
  });
});

// Prevents a spelled-out magnitude word from leaving the value unscaled: "512.0 million" for 512.
it('reads spelled-out magnitude words as their abbreviation', () => {
  for (const [example, locale, abbreviation] of [['1.0 million', 'en', '1.0 mn'], ['1.0 thousand', 'en', '1.0k'], ['1.0 billion', 'en', '1.0 bn'],
    ['1,0 Millionen', 'de', '1,0 Mio.'], ['1,0 Tausend', 'de', '1,0 Tsd.'], ['1,0 Milliarden', 'de', '1,0 Mrd.']] as const) {
    expect(parseFormatExample(example).magnitude).toBe(parseFormatExample(abbreviation).magnitude);
    for (const value of [512, 2_500_000, 3e9]) expect(formatterFromExample(example, locale)(value)).not.toMatch(/^[\d.,\s]{5,}/);
  }
  expect(formatterFromExample('1.0 million', 'en')(2_500_000)).toBe('2.5 million');
  expect(formatterFromExample('1,0 Millionen', 'de')(2_500_000)).toBe('2,5 Millionen');
  expect(formatterFromExample('1 Million', 'de')(1_000_000)).toBe('1 Million');
  // A compound ('million-dollar') is a unit, not a scale.
  expect(formatterFromExample('1 million-dollar deals', 'en')(500)).toBe('500 million-dollar deals');
  // A unit in words names its scale as its abbreviation does: no engine "B" on top of "€ million".
  expect(seriesRasterFormatter(undefined, [2.79e9], 'en', '€ million', 'report').fmt(2.79e9)).toBe('2,790,000,000');
});

// Prevents one axis from showing "$500.0 mn" beside "$1.0 billion": every scale keeps the authored spelling family.
it('keeps the authored magnitude word family at every scale', () => {
  expect(formatterFromExample('$1.0 mn', 'en')(1e9)).toBe('$1.0 bn');
  expect(formatterFromExample('$1.0 Mn', 'en')(1e9)).toBe('$1.0 Bn');
  expect(formatterFromExample('1.0 million', 'en')(1e9)).toBe('1.0 billion');
  expect(formatterFromExample('1.0M', 'en')(1e9)).toBe('1.0B');
  expect(formatterFromExample('1,0 Mio', 'de')(2e9)).toBe('2,0 Mrd');
  expect(formatterFromExample('1,0 Mio.', 'en')(2e9)).toBe('2.0 Mrd.');
});

// Prevents an English word with another meaning in the chart's language: "billion" is 10¹² in French and German.
it('never rolls to an English false friend in another language', () => {
  expect(formatterFromExample('1,0 Mio.', 'fr')(1e9)).toBe('1,0 Mrd.');
  expect(formatterFromExample('1.0 million', 'fr')(1e9)).toBe('1,0 milliard');
  expect(formatterFromExample('1,0 million', 'de')(2e9)).toBe('2,0 Milliarden');
});

// Prevents a 10¹² example from leaving the value unscaled: "$2,500,000,000,000.0 trillion" for 2.5 trillion.
it('scales 10¹² magnitude words and rolls every family to its own 10¹² word', () => {
  for (const [example, locale, text] of [
    ['$1.0 trillion', 'en', '$2.5 trillion'], ['1.0 tn', 'en', '2.5 tn'], ['1.0T', 'en', '2.5T'], ['$1.0 bn', 'en', '$2.5 tn'],
    ['1.0 billion', 'en', '2.5 trillion'], ['1.0B', 'en', '2.5T'], ['1,0 Bio.', 'de', '2,5 Bio.'], ['1,0 Mrd.', 'de', '2,5 Bio.'],
    ['1,0 Billionen', 'de', '2,5 Billionen'], ['1,0 Billion', 'de', '2,5 Billionen'], ['1,0 billion', 'fr', '2,5 billions'], ['1,0 milliard', 'fr', '2,5 billions'],
  ] as const) expect(formatterFromExample(example, locale)(2.5e12), example).toBe(text);
  // French "milliard" is 10⁹ and German "Billion" 10¹²: a value prints its scale's local word, never the English reading.
  expect(formatterFromExample('1,0 milliard', 'fr')(2.5e9)).toBe('2,5 milliards');
  expect(formatterFromExample('1,0 billion', 'fr')(1.5e12)).toBe('1,5 billion');
  expect(formatterFromExample('1,0 Billion', 'de')(2.5e9)).toBe('2,5 Milliarden');
  // SI spaces a unit: "1.5 T" stays tesla.
  expect(formatterFromExample('1.5 T', 'en')(3)).toBe('3.0 T');
});

// Prevents a letter a German or French reader takes for another scale: "B" for Billion (10¹²), "T" for Tausend.
it('prints the local short form for B and T on a German or French chart', () => {
  expect(formatterFromExample('1,0M', 'de')(2.5e6)).toBe('2,5M');
  expect(formatterFromExample('1,0M', 'de')(2.5e9)).toBe('2,5 Mrd.');
  expect(formatterFromExample('1,0B', 'de')(2.5e12)).toBe('2,5 Bio.');
  expect(formatterFromExample('1,0M', 'fr')(2.5e9)).toBe('2,5 Md');
  expect(formatterFromExample('$1.0 mn', 'de')(2.5e9)).toBe('$2,5 Mrd.');
  expect(formatterFromExample('1,0 bn', 'fr')(2.5e12)).toBe('2,5 Bn');
});

// Prevents a nonzero value from printing as zero under an authored scale: "$0.0 trillion" for one billion.
it('rolls a value that would print as 0 down its word family', () => {
  expect(formatterFromExample('$1.0 trillion', 'en')(1e9)).toBe('$1.0 billion');
  expect(formatterFromExample('1.0 mn', 'en')(1000)).toBe('1.0 k');
  expect(formatterFromExample('1,0 Mio.', 'de')(1000)).toBe('1,0 Tsd.');
  expect(formatterFromExample('1.0 mn', 'en')(0.4)).toBe('0.4');
  // A held scale (grouped digits) keeps its letter and lifts its decimals.
  expect(formatterFromExample('1,234k', 'en')(4)).toBe('0.004k');
  expect(formatterFromExample('$1.0 trillion', 'en')(0)).toBe('$0.0 trillion');
  // An unscaled example has nothing to roll down to; a delta or accessible value lifts its decimals.
  expect(formatNonzeroWithSpec(0.004, exampleSpec('$1.0', 'en'))).toBe('$0.004');
});

// Prevents an engine or table letter a German or French reader takes for another scale: "B" for Billion (10¹²).
it('prints no bare B or T on a German or French chart without an authored word', () => {
  expect(seriesRasterFormatter(undefined, [2.5e9], 'de', undefined, 'report').fmt(2.5e9)).toBe('2,5 Mrd.');
  expect(seriesRasterFormatter(undefined, [2.5e9], 'fr', undefined, 'report').fmt(2.5e9)).toBe('2,5 Md');
  expect(seriesRasterFormatter(undefined, [2.5e9], 'en', undefined, 'report').fmt(2.5e9)).toBe('2.5B');
  // One German axis reads "500 Mio." under "1,0 Mrd.", not "500M".
  expect(seriesRasterFormatter(undefined, [2.5e9, 5e8], 'de', undefined, 'report').fmt(5e8)).toBe('500 Mio.');
  // A table header unit keeps the short form's space: "$ Mio.", not "$Mio.".
  expect(unitOfSpec({ ...parseFormatExample('$1.0M'), magnitudeWord: undefined, locale: 'de' })).toBe('$ Mio.');
  expect(formatWithSpec(2.5e9, { ...parseFormatExample('1,0 Mio.'), locale: 'de' })).toBe('2,5 Mrd.');
});

// Prevents digits of a unit name from being read as the number: "CO500 (1.2)" under "CO2 (1.2)".
it('keeps digits inside a unit name as text', () => {
  expect(formatterFromExample('CO2 (1.2)', 'en')(500)).toBe('CO2 500.0');
  expect(formatterFromExample('CO2 (1.2)', 'en')(-500)).toBe('(CO2 500.0)');
  expect(formatterFromExample('H2O 12', 'en')(5)).toBe('H2O 5');
  expect(formatterFromExample('$1bn (2020 USD)', 'en')(3e9)).toBe('$3bn (2020 USD)');
  expect(formatterFromExample('EUR1bn (2020 USD)', 'en')(3e9)).toBe('EUR3bn (2020 USD)');
  expect(formatterFromExample('EUR1.2 (2020 USD)', 'en')(500)).toBe('EUR500.0 (2020 USD)');
  expect(formatterFromExample('PM2.5 1.2', 'en')(500)).toBe('PM2.5 500.0');
  expect(formatterFromExample('1kg / 100m²', 'en')(500)).toBe('500kg / 100m²');
  expect(formatterFromExample('$1M in 2020 prices', 'en')(5e6)).toBe('$5M in 2020 prices');
});

// Prevents an engine scale chosen before rounding: 999,999.7 beside billions printed "1,000.00k".
it('chooses an engine magnitude after rounding', () => {
  expect(seriesRasterFormatter(undefined, [2e9, 999_999.7], 'en', undefined, 'report').fmt(999_999.7)).toBe('1.00M');
});

describe('setFormatPlan', () => {
  const texts = (values: number[], options: Parameters<typeof setFormatPlan>[1] = {}) => {
    const plan = setFormatPlan([...values, null], { target: 'report', ...options });
    return values.map(plan.fmt).join(' · ');
  };

  // Prevents a label that steps down to its own magnitude: "590M" beside "1.18B" makes the reader convert units to compare two bars.
  it('prints a set at one magnitude, chosen by its largest value', () => {
    expect(texts([1.18e9, 5.9e8, 2.9e8, 1.4e8])).toBe('1.18B · 0.59B · 0.29B · 0.14B');
    expect(texts([-2.4e6, 1.1e6, -6e5, 3.2e6])).toBe('−2.4M · 1.1M · −0.6M · 3.2M');
    expect(texts([9.35e5, 1.505e6, 1.835e6, 2.385e6])).toBe('0.935M · 1.505M · 1.835M · 2.385M');
    expect(texts([5.9e9, 3e8, 5e8])).toBe('5.9B · 0.3B · 0.5B');
    expect(setFormatPlan([1.18e9, 1.4e8], { target: 'report' })).toMatchObject({ magnitude: 'bn', decimals: 2 });
    expect(texts([1.18e9, 5.9e8, 1.4e8], { locale: 'de' })).toBe('1,18 Mrd. · 0,59 Mrd. · 0,14 Mrd.');
  });

  // Prevents one decimal count per value: "9" beside "13.9" reads as a rounder number than its neighbours.
  it('prints a set at one decimal count, with a trailing zero only where a value needs the place', () => {
    expect(texts([13.9, 6.5, 9.7, 9])).toBe('13.9 · 6.5 · 9.7 · 9.0');
    expect(texts([5, 2, 1, 0.6])).toBe('5.0 · 2.0 · 1.0 · 0.6');
    expect(texts([5, 2, 1])).toBe('5 · 2 · 1');
    expect(texts([1.2e6, 0, 3.4e5])).toBe('1.20M · 0.00M · 0.34M');
    expect(texts([13.9, 6.5], { locale: 'de' })).toBe('13,9 · 6,5');
  });

  // Prevents a nonzero value that prints as 0: the set lifts its decimals up to the automatic cap, and past the cap the value prints its bound.
  it('lifts the set for a value that would print as zero', () => {
    expect(texts([12, 0.004])).toBe('12.000 · 0.004');
    expect(texts([1.2e6, 8e3])).toBe('1.200M · 0.008M');
    expect(texts([1.2e9, 3e4])).toBe('1.2B · <0.1B');
  });

  // Prevents the set rule from overriding what an author wrote: a chart, series or cell format keeps its own scale and decimals.
  it('keeps an authored format', () => {
    expect(texts([1.18e9, 5.9e8], { format: '1,234' })).toBe('1,180,000,000 · 590,000,000');
    const plan = setFormatPlan([1.18e9, 5.9e8], { target: 'report' });
    expect(plan.forSeries({ format: '1.2M' })(5.9e8)).toBe('590.0M');
    expect(plan.forSeries({}, '1,234')(5.9e8)).toBe('590,000,000');
  });

  // Prevents a share from borrowing the decimals of an amount: shares are a set of their own in percent points.
  it('prints a share set at its own decimal count', () => {
    expect(texts([9.7, 31.02, 71, 48, 13], { role: 'share' })).toBe('9.7% · 31.0% · 71.0% · 48.0% · 13.0%');
    expect(texts([31.02, 71, 48], { role: 'share' })).toBe('31% · 71% · 48%');
    expect(texts([31.02, 0.04], { role: 'share' })).toBe('31.02% · 0.04%');
  });
});
