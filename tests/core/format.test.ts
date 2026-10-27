import { describe, expect, it } from 'vitest';
import {
  MINUS,
  NOT_AVAILABLE,
  NOT_MEANINGFUL,
  cagr,
  formatNumber,
  formatPercent,
  nonFiniteGlyph,
} from '../../src/core/format';
import { formatterFromExample } from '../../src/core/formatSpec';

describe('formatNumber', () => {
  it('formats with thousands separators', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('keeps locale and precision independent across successive charts', () => {
    for (const locale of ['en-US', 'de-DE', 'hi-IN', 'en-US']) {
      for (const decimals of [0, 2, 20]) {
        expect(formatNumber(1234567, { locale, decimals })).toBe(
          (1234567).toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
        );
      }
    }
  });

  it('uses a true minus sign', () => {
    expect(formatNumber(-12)).toBe(`${MINUS}12`);
  });

  it('does not render -0', () => {
    expect(formatNumber(-0.001, { decimals: 0 })).toBe('0');
  });

  it('collapses magnitudes in auto mode', () => {
    expect(formatNumber(1200, { magnitude: 'auto' })).toBe('1.2k');
    expect(formatNumber(3400000, { magnitude: 'auto' })).toBe('3.4M');
    expect(formatNumber(5600000000, { magnitude: 'auto' })).toBe('5.6B');
    expect(formatNumber(999, { magnitude: 'auto' })).toBe('999');
    expect(formatNumber(999_500, { magnitude: 'auto' })).toBe('1.0M');
    expect(formatNumber(999_999_999, { magnitude: 'auto' })).toBe('1.0B');
  });

  it('fixed magnitude', () => {
    expect(formatNumber(1500000, { magnitude: 'm', decimals: 1 })).toBe('1.5M');
  });

  it('signed mode shows plus', () => {
    expect(formatNumber(3, { signed: true })).toBe('+3');
    expect(formatNumber(-3, { signed: true })).toBe(`${MINUS}3`);
    expect(formatNumber(0.01, { decimals: 0, signed: true })).toBe('0');
    expect(formatNumber(-0.01, { decimals: 0, signed: true })).toBe('0');
  });

  it.each([-1, 1.5, 21, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid decimals %s with one stable error',
    (decimals) => {
      expect(() => formatNumber(1, { decimals })).toThrow(
        /decimals must be an integer between 0 and 20/,
      );
    },
  );

  it('prefix and suffix', () => {
    expect(formatNumber(42, { prefix: '$', suffix: 'bn' })).toBe('$42bn');
  });

  // An empty string is not "no number", it is no TEXT: the label vanished with
  // nothing saying why. These assert the honest
  // outcome positively — a specific visible glyph, per value class.
  it('renders a visible state glyph for a non-finite, never nothing', () => {
    expect(formatNumber(NaN)).toBe(NOT_AVAILABLE);
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe(NOT_MEANINGFUL);
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe(NOT_MEANINGFUL);
    for (const value of [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatNumber(value).length).toBeGreaterThan(0);
    }
  });

  it('emits the state glyph bare — a non-value carries no unit and no sign', () => {
    // '∞%' and '$Infinity' both shipped: a suffix is a unit claim and a
    // parenthesis is a sign claim, and neither is true of a non-value.
    expect(formatNumber(Number.POSITIVE_INFINITY, { suffix: '%' })).toBe(NOT_MEANINGFUL);
    expect(formatNumber(Number.POSITIVE_INFINITY, { prefix: '$', magnitude: 'bn' })).toBe(
      NOT_MEANINGFUL,
    );
    expect(formatNumber(Number.NEGATIVE_INFINITY, { signed: true })).toBe(NOT_MEANINGFUL);
    expect(formatNumber(Number.NEGATIVE_INFINITY)).not.toContain(MINUS);
  });

  it('null and undefined still render as empty — only NUMBERS get a glyph', () => {
    expect(formatNumber(null as never)).toBe('');
    expect(formatNumber(undefined as never)).toBe('');
  });
});

describe('non-finite containment across BOTH formatting engines', () => {
  // One rounding path. Two spellings of infinity ('∞' from
  // formatNumber, 'Infinity' from formatWithSpec, one of them currency-prefixed
  // as '$Infinity.M') was that rule already broken. This pins both engines to
  // one answer. It does NOT harmonise rounding.
  const cases: Array<[string, number, string]> = [
    ['NaN', NaN, NOT_AVAILABLE],
    ['+Infinity', Number.POSITIVE_INFINITY, NOT_MEANINGFUL],
    ['-Infinity', Number.NEGATIVE_INFINITY, NOT_MEANINGFUL],
  ];
  const examples = ['88%', '$1.2M', '(1,234)', '+20.5%', '1.000,00', "1'234", '1 234 €'];

  it.each(cases)('%s renders as the same glyph in both engines', (_name, value, glyph) => {
    expect(nonFiniteGlyph(value)).toBe(glyph);
    expect(formatNumber(value)).toBe(glyph);
    expect(formatPercent(value)).toBe(glyph);
    for (const example of examples) {
      expect(formatterFromExample(example, undefined)(value)).toBe(glyph);
    }
  });
});

describe('formatPercent', () => {
  it('appends %', () => {
    expect(formatPercent(37)).toBe('37%');
    expect(formatPercent(-2.5, 1)).toBe(`${MINUS}2.5%`);
  });
});

describe('cagr', () => {
  it('computes compound growth', () => {
    // 100 -> 121 over 2 periods = 10%
    expect(cagr(100, 121, 2)).toBeCloseTo(10);
  });

  it('null on sign change or zero base', () => {
    expect(cagr(0, 10, 2)).toBeNull();
    expect(cagr(10, -5, 2)).toBeNull();
    expect(cagr(10, 5, 0)).toBeNull();
  });
});
