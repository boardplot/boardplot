/**
 * Histogram — binning contract, refusals, and the disclosures that keep a
 * chosen bin width from passing as a fact of the data.
 *
 * Degenerate cases live here rather than in `fixtures.ts`: a fixture that
 * throws would break the invariant sweep, which layouts every registered
 * fixture automatically.
 */

import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import {
  MAX_BINS,
  computeBinning,
  countPerBin,
  freedmanDiaconisWidth,
  sturgesWidth,
} from '../src/core/charts/histogram/binning';
import { fixtures } from '../src/core/charts/histogram/fixtures';
import { layoutHistogram } from '../src/core/charts/histogram/layout';
import type {
  HistogramDerived,
  HistogramMarks,
  HistogramOptions,
} from '../src/core/charts/histogram/types';
import type { Geometry, SceneNode } from '../src/core/types/scene';
import { NormalizeError } from '../src/core/normalize/shared';
import { getChart, getChartDefinition } from '../src/core/registry';
import { requireGeometry } from '../src/core/sizing';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { iqr, quantileType7, sortAscending } from '../src/core/stats';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import { measure } from '../src/index';
import { claimsForChart } from '../src/core/claims';

const SLIDE: HistogramOptions = { size: { width: 960, height: 540 } };
/** Engine notes (the sample base, the binning rule, the hidden-count list) print under a chart only when the author asks. */
const SHOW_NOTES = { notes: { show: ['note', 'disclosure', 'method'] } } as const satisfies HistogramOptions;
const codes = (geometry: { warnings: { code: string }[] }): string[] =>
  geometry.warnings.map((warning) => warning.code);

/** Deterministic ramp: 0, 1, ..., n-1 scaled — no randomness anywhere. */
const ramp = (n: number, step = 1, from = 0): number[] =>
  Array.from({ length: n }, (_, index) => from + index * step);

function expectThrows(run: () => unknown, code: string): NormalizeError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code} to be thrown`).toBeInstanceOf(NormalizeError);
  const error = caught as NormalizeError;
  expect(error.code).toBe(code);
  return error;
}

describe('histogram binning arithmetic', () => {

  it('reproduces the NumPy widths for a pinned sample', () => {
    const sample = sortAscending(ramp(64, 1, 1));
    const n = sample.length;
    const range = sample[n - 1]! - sample[0]!;
    // Computed from the same primitives the implementation uses, never
    // hand-derived.
    expect(sturgesWidth(range, n)).toBeCloseTo(63 / (Math.log2(64) + 1), 12);
    expect(freedmanDiaconisWidth(iqr(sample), n)).toBeCloseTo(
      2 * iqr(sample) * Math.pow(64, -1 / 3),
      12,
    );
    const binning = computeBinning({
      sorted: sample,
      min: 1,
      max: 64,
      interquartileRange: iqr(sample),
      bins: 'auto',
      snap: false,
    });
    expect(binning.hAuto).toBe(Math.min(binning.hFd, binning.hSturges));
    expect(binning.snapped).toBe(false);
  });

  it('keeps the unsnapped width when snapping would leave fewer than three bins', () => {
    // A tight sample: the snapped width swallows the whole range.
    const sample = sortAscending([0, 1.2, 2.4, 3.6]);
    const snapped = computeBinning({
      sorted: sample,
      min: 0,
      max: 3.6,
      interquartileRange: iqr(sample),
      bins: 'auto',
      snap: true,
    });
    // The rule answers 1.2; the ladder would move it to 2, which leaves two
    // bins over the whole sample, so the rule wins and says so.
    expect(snapped.hAuto).toBeCloseTo(1.2, 12);
    expect(snapped.width).toBeCloseTo(1.2, 12);
    expect(snapped.snapped).toBe(false);
    expect(snapped.edges.length - 1).toBeGreaterThanOrEqual(3);
  });

  it('puts an observation exactly on an interior edge into the UPPER bin', () => {
    const edges = [0, 10, 20, 30];
    expect(countPerBin([0, 9.999, 10, 19.999, 20, 29.999], edges)).toEqual([2, 2, 2]);
    // The maximum lands in the last bin, which is closed at its upper edge.
    expect(countPerBin([0, 10, 20, 30], edges)).toEqual([1, 1, 2]);
  });

  it('assigns a boundary observation by the EDGES, not by floor((v - first)/h)', () => {
    // 0.3 / 0.1 is 2.9999999999999996 in binary floating point, so the
    // arithmetic shortcut drops the observation one bin down while the edge
    // comparison — the contract — keeps it in [0.3, 0.4).
    const binning = computeBinning({
      sorted: [0, 0.3, 0.5],
      min: 0,
      max: 0.5,
      interquartileRange: 0.3,
      bins: { width: 0.1, anchor: 0 },
      snap: false,
    });
    expect(binning.edges[3]).toBe(0.3);
    expect(Math.floor((0.3 - 0) / 0.1)).toBe(2);
    expect(countPerBin([0.3], binning.edges)).toEqual([0, 0, 0, 1, 0]);
  });

  it('reproduces a hand-computed count vector and covers the whole sample', () => {
    const sample = sortAscending([1, 1, 2, 3, 5, 5, 5, 8, 9, 13, 21]);
    const binning = computeBinning({
      sorted: sample,
      min: 1,
      max: 21,
      interquartileRange: iqr(sample),
      bins: { width: 5, anchor: 0 },
      snap: true,
    });
    expect(binning.edges).toEqual([0, 5, 10, 15, 20, 25]);
    // [0,5): 1,1,2,3 · [5,10): 5,5,5,8,9 · [10,15): 13 · [15,20): none · [20,25]: 21
    expect(countPerBin(sample, binning.edges)).toEqual([4, 5, 1, 0, 1]);
    expect(countPerBin(sample, binning.edges).reduce((a, b) => a + b, 0)).toBe(sample.length);
  });
  // Prevents a false spike: edges on the integers closed the last bin over 3 and 4 and drew 51 beside 24.
  it('gives whole numbers one bin per value, centred on it and named under the bar', () => {
    const observations = [0, 1, 2, 3, 4].flatMap((value, index) => Array.from({ length: [20, 25, 24, 25, 26][index]! }, () => value));
    for (const bins of ['auto', { width: 1 }] as const) {
      const geometry = layoutHistogram({ observations }, { bins });
      expect(geometry.derived.counts).toEqual([20, 25, 24, 25, 26]);
      expect(geometry.derived.binning.edges).toEqual([-0.5, 0.5, 1.5, 2.5, 3.5, 4.5]);
      expect(geometry.derived.binLabels).toEqual(['0', '1', '2', '3', '4']);
      const bars = geometry.marks.bins.map((bin) => bin.rect.x + bin.rect.w / 2);
      const names = geometry.labels.filter((label) => label.kind === 'category' && !label.hidden);
      expect(names.map((label) => label.text)).toEqual(['0', '1', '2', '3', '4']);
      names.forEach((label, index) => expect(label.rect.x + label.rect.w / 2).toBeCloseTo(bars[index]!, 0));
    }
    // Large whole numbers keep their exact names: the display-rounded anchor is a half off.
    const large = layoutHistogram({ observations: observations.map((value) => value + 100000000001) }, { bins: { width: 1 } });
    expect(large.derived.binLabels.map((label) => label.replace(/\D/g, ''))).toEqual(['100000000001', '100000000002', '100000000003', '100000000004', '100000000005']);
  });

  // Prevents fractional bins on whole numbers: bins: 20 over 1 to 13 drew width 0.6 with empty comb slots between the days.
  it('moves the fractional width of a bin count onto a whole number and warns with the width', () => {
    const days = [1, 2, 2, 3, 3, 3, 5, 8, 13];
    const perDay = layoutHistogram({ observations: days }, { bins: 20 });
    expect(perDay.derived.binning.edges).toEqual(Array.from({ length: 14 }, (_, i) => i + 0.5));
    expect(perDay.derived.binning.perValue).toBe(true);
    expect(perDay.warnings.find((w) => w.code === 'histogram-bin-width-whole')?.message).toContain('bins of 0.6');
    // 200 to 2352 over 5 bins gives 430.4; the whole width 431 keeps five bins and no value falls between two edges.
    const wide = layoutHistogram({ observations: [200, 300, 900, 1500, 2352] }, { bins: 5 });
    expect(wide.derived.binning.width).toBe(431);
    expect(wide.derived.counts).toEqual([2, 1, 0, 1, 1]);
    // A count that already gives a whole width, and fractional data, keep the exact count.
    expect(layoutHistogram({ observations: [0, 5, 7, 10] }, { bins: 5 }).derived.binning.edges).toEqual([0, 2, 4, 6, 8, 10]);
    expect(layoutHistogram({ observations: [0, 0.5, 0.75, 1] }, { bins: 5 }).derived.binning.width).toBe(0.2);
  });
});

describe('histogram open last bin', () => {
  // Prevents a miscounted tail: a value on openAbove belongs to the open bin, the bin before it stays [lo, openAbove).
  it('gathers every value from openAbove up into one open bin on the same grid', () => {
    const observations = [3, 12, 18, 22, 39, 40, 41, 90, 400];
    const geometry = layoutHistogram({ observations }, { bins: { width: 10, openAbove: 40 } });
    expect(geometry.derived.binning.edges).toEqual([0, 10, 20, 30, 40, 400]);
    expect(geometry.derived.counts).toEqual([1, 2, 1, 1, 4]);
    expect(geometry.derived.binLabels.at(-1)).toBe('≥ 40');
    const open = geometry.labels.find((label) => label.id === 'open');
    expect(open?.text).toBe('≥ 40 (max 400)');
    // Whole numbers at width 1 keep one centred bin per value below the open bin.
    const whole = layoutHistogram({ observations: [1, 2, 2, 3, 3, 3, 4, 9, 12] }, { bins: { width: 1, openAbove: 4 } });
    expect(whole.derived.binning.edges).toEqual([0.5, 1.5, 2.5, 3.5, 12]);
    expect(whole.derived.counts).toEqual([1, 2, 3, 3]);
  });

  // Prevents a silent squeeze: a long tail under 'auto' proposes an open bin that keeps the width and folds only the tail.
  it('proposes openAbove under auto for a long tail, and never for ties that would fold the sample', () => {
    const tail = [...ramp(980, 1), 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 9800, 9900, 9950, 9999];
    const warning = layoutHistogram({ observations: tail }, {}).warnings.find((item) => item.code === 'histogram-long-tail');
    const suggested = Number(/openAbove: (\d+)/.exec(warning?.suggest ?? '')?.[1]);
    expect(suggested).toBeGreaterThan(900);
    const auto = layoutHistogram({ observations: tail }, {});
    const fixed = layoutHistogram({ observations: tail }, { bins: { openAbove: suggested } });
    expect(fixed.derived.binning.width).toBe(auto.derived.binning.width);
    expect(fixed.derived.counts.at(-1)).toBe(tail.filter((value) => value >= suggested).length);
    const ties = [0, ...Array.from({ length: 981 }, () => 100), ...Array.from({ length: 18 }, () => 1000)];
    expect(codes(layoutHistogram({ observations: ties }, {}))).not.toContain('histogram-long-tail');
  });
});

describe('histogram refuses what it cannot draw honestly', () => {
  it('throws histogram-too-few below four observations', () => {
    const error = expectThrows(() => layoutHistogram({ observations: [1, 2, 3] }), 'histogram-too-few');
    expect(error.suggest).toContain('dot');
    expect(error.message).toContain('at least 4');
  });

  it('throws histogram-zero-range when every observation is identical', () => {
    const error = expectThrows(
      () => layoutHistogram({ observations: [7, 7, 7, 7, 7] }),
      'histogram-zero-range',
    );
    expect(error.message).toContain('all 5 observations equal 7');
    expect(error.suggest).toContain('kpi');
  });

  it('throws histogram-bin-explosion instead of drawing hairlines', () => {
    // A tight mass plus one observation four orders of magnitude out: the
    // Freedman-Diaconis width stays tied to the interquartile range while the
    // range is set by the outlier.
    const observations = [...ramp(400, 0.025), 100_000];
    const error = expectThrows(
      () => layoutHistogram({ observations }, { bins: 'auto' }),
      'histogram-bin-explosion',
    );
    expect(error.message).toMatch(/needs \d+ bins/);
    expect(error.message).toContain(String(MAX_BINS));
    expect(error.suggest).toContain('bins');
  });

  it('refuses an anchor above the data rather than dropping observations', () => {
    expectThrows(
      () => layoutHistogram({ observations: ramp(20, 1, 1) }, { bins: { width: 5, anchor: 4 } }),
      'histogram-anchor-above-data',
    );
  });

  it('rejects non-finite observations without reaching the column engine', () => {
    const error = expectThrows(
      () => layoutHistogram({ observations: [1, 2, Number.NaN, 4, 5] }),
      'non-finite-observation',
    );
    expect(error.path).toBe('observations[2]');
  });

  it('rejects a named binning rule and a null observation at the schema', () => {
    const definition = getChartDefinition('histogram')!;
    expect(() => definition.optionsSchema.parse({ bins: 'sturges' })).toThrow();
    expect(() => definition.normalize({ observations: [1, 2, 3, null] })).toThrow();
    expect(() => definition.normalize({ observations: [1, 2, 3, 4], counts: [1] })).toThrow();
    expect(definition.optionsSchema.parse({ bins: 12 })).toEqual({ bins: 12 });
  });
});

describe('histogram disclosures', () => {
  it('prints or names counts above twelve nonempty bins through public measure, unless labels are suppressed', () => {
    const data = { observations: Array.from({ length: 13 }, (_, i) => Array(100).fill(i + 0.5)).flat() };
    const options: HistogramOptions = {
      target: 'dashboard', title: false, bins: { width: 1, anchor: 0 },
      canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      size: { width: 320, height: 240 }, ...SHOW_NOTES,
    };
    const result = measure({ type: 'histogram', data, options });
    expect(result.geometry).toBeDefined();
    const counts = result.geometry!.labels.filter(label => label.kind === 'point' && !label.hidden);
    expect(counts).toHaveLength(13);
    expect(counts.every(label => label.text === '100')).toBe(true);
    expect(new Set(counts.map(label => label.owner.categoryId)).size).toBe(13);
    for (const labels of [false, { point: false }] as const) {
      const suppressed = measure({ type: 'histogram', data, options: { ...options, labels } });
      expect(suppressed.geometry).toBeDefined();
      expect(suppressed.geometry!.labels.filter(label => label.kind === 'point' && !label.hidden)).toHaveLength(0);
      expect(suppressed.geometry!.labels.some(label => label.kind === 'point' && label.noted)).toBe(false);
    }
    // Counts too wide for their bins must not float on leaders or fill a note: the tallest keeps its count and the axis carries the scale.
    const crowdedData = { observations: Array.from({ length: 17 }, (_, i) => Array(1234 + i).fill(i + 0.5)).flat() };
    const crowded = measure({ type: 'histogram', data: crowdedData, options: { ...options, size: { width: 320, height: 400 } } });
    expect(crowded.geometry).toBeDefined();
    const crowdedCounts = crowded.geometry!.labels.filter(label => label.kind === 'point' && !label.hidden);
    expect(crowdedCounts.map(label => [label.owner.categoryId, label.leader])).toEqual([['bin16', undefined]]);
    expect(crowded.geometry!.labels.some(label => label.kind === 'point' && label.noted)).toBe(false);
    expect((crowded.geometry!.derived as { frequencyAxisShown: boolean }).frequencyAxisShown).toBe(true);
    expect(crowded.geometry!.warnings.map(warning => warning.code)).toContain('histogram-counts-peak-only');
    // An authored 'full' density keeps every count, as before.
    const full = measure({ type: 'histogram', data: crowdedData, options: { ...options, size: { width: 320, height: 400 }, labelDensity: 'full' } });
    expect(full.geometry!.labels.filter(label => label.kind === 'point' && (label.noted || !label.hidden))).toHaveLength(17);
  });

  it('keeps every fitting count in a compact dashboard card', () => {
    const fixture = fixtures.find((candidate) => candidate.id === 'order-value-distribution')!;
    for (const width of [320, 400]) for (const height of [240, 300]) {
      const geometry = requireGeometry(getChart('histogram')!.layout(fixture.data, {
        ...fixture.options, target: 'dashboard', title: false, subtitle: undefined,
        canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } }, size: { width, height },
      }));
      expect(geometry.labels.filter(label => label.kind === 'point' && !label.hidden)).toHaveLength(10);
    }
    const equalData = { observations: Array.from({ length: 10 }, (_, i) => Array(1000).fill(i + 0.5)).flat() };
    const equal = requireGeometry(getChart('histogram')!.layout(equalData, {
      target: 'dashboard', title: false, bins: { width: 1, anchor: 0 }, canvas: { margin: 0 }, size: { width: 320, height: 400 },
    }));
    const equalCounts = equal.labels.filter(label => label.kind === 'point' && !label.hidden);
    expect(equalCounts).toHaveLength(10);
    expect(equalCounts.every(label => label.text === '1k')).toBe(true);
    expect(equal.warnings.some(warning => warning.code === 'value-labels-dropped-series')).toBe(false);
    for (const content of [['absolute', 'category'], ['absolute', 'series']] as const) {
      const composed = requireGeometry(getChart('histogram')!.layout(equalData, {
        target: 'dashboard', title: false, bins: { width: 1, anchor: 0 }, canvas: { margin: 0 }, size: { width: 320, height: 400 },
        labels: { point: [...content] },
      }));
      const points = composed.labels.filter(label => label.kind === 'point');
      expect(points).toHaveLength(10);
      expect(points.every(label => label.text.includes(content[1] === 'category' ? '–' : 'Observations'))).toBe(true);
    }
    for (const format of ['$1,234', '1.234 €']) {
      const exact = requireGeometry(getChart('histogram')!.layout({ observations: Array.from({ length: 10 }, (_, i) => Array(1234).fill(i + 0.5)).flat() }, {
        target: 'dashboard', title: false, bins: { width: 1, anchor: 0 }, canvas: { margin: 0 }, size: { width: 320, height: 400 }, format,
      }));
      // A format example gives only the shape: both print the default marks.
      const texts = ['1,234', '1.234k'];
      expect(exact.labels.filter(label => label.kind === 'point').every(label => texts.includes(label.text))).toBe(true);
    }
    for (const language of ['de-DE', 'fr-FR']) {
      const localized = requireGeometry(getChart('histogram')!.layout({ observations: Array.from({ length: 10 }, (_, i) => Array(1100).fill(i + 0.5)).flat() }, {
        target: 'dashboard', title: false, bins: { width: 1, anchor: 0 }, canvas: { margin: 0 }, size: { width: 320, height: 400 }, locale: { language },
      }));
      const points = localized.labels.filter(label => label.kind === 'point' && !label.hidden);
      expect(points).toHaveLength(10);
      // The language changes words only, never the marks.
      expect(points.every(label => label.text === '1.1k')).toBe(true);
    }
  });

  it('states n and the bin width on the chart, where a host without footnotes still shows them', () => {
    const fixture = fixtures.find((candidate) => candidate.id === 'order-value-distribution')!;
    const geometry = layoutHistogram(fixture.data, { ...fixture.options, footnotes: false, ...SHOW_NOTES });
    // Every bin is labelled, so the axis gives way and the authored title leads the required base note.
    // the short line keeps the bin width and the edge rule.
    expect(geometry.scene.filter((node) => node.part === 'footnote').map(node2text)).toEqual(['Orders per 250 bin, lower edge included · n = 240.']);
    // An authored strings.histogramBins wins over the short line, also after the request fills every default string.
    const viaRequest = (strings?: object) => requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'histogram', data: fixture.data, options: { ...fixture.options, footnotes: false, ...SHOW_NOTES, ...(strings ? { strings } : {}) } })))
      .scene.filter((node) => node.part === 'footnote').map(node2text);
    expect([viaRequest(), viaRequest({ histogramBins: '{count} bands of {width}' })]).toEqual([['Orders per 250 bin, lower edge included · n = 240.'], ['Orders · n = 240 · 10 bands of 250.']]);
    expect(geometry.scene.some((node) => node.id === 'label:axis:y:title')).toBe(false);
    for (const id of ['order-value-distribution', 'cycle-time-days']) {
      const noTitle = fixtures.find((candidate) => candidate.id === id)!;
      const withoutAxis = layoutHistogram(noTitle.data, { ...noTitle.options, axisTitles: undefined, footnotes: false, ...SHOW_NOTES, size: { width: 720, height: 405 } });
      // Whole days get one bin per value, so that line names the values instead of a width.
      expect(withoutAxis.scene.map(node2text).join(' ')).toMatch(/(Bins of [\d,.]+|per [\d,.]+ bin), lower edge included · n = \d+|One bin per value · n = \d+/);
    }
  });

  it('states the rule, the width, the interval convention and n in a footnote on request', () => {
    const geometry = layoutHistogram({ observations: ramp(120, 1, 1) }, { ...SLIDE, methodNote: true });
    const text = notes(geometry);
    expect(text).toContain('bins of');
    // One plain sentence carries the same facts.
    expect(text).toContain('includes its lower bound');
    // n prints once, in the restored caption or the method note when the axis is absent.
    expect(readerText(geometry).match(/n = 120/g)).toHaveLength(1);
    // The binning prints once: the method note carries it, so the base note leaves it out.
    expect(readerText(geometry).match(/bins of/g)).toHaveLength(1);
    // The note prints its numbers in the chart locale, as the bin labels do.
    const german = layoutHistogram({ observations: [0.1, 0.4, 0.6, 0.9, 1.2, 1.4] }, { ...SLIDE, bins: { width: 0.5, anchor: 0 }, methodNote: true, locale: { language: 'de-DE' } } as HistogramOptions);
    expect(notes(german)).toContain('Klassen mit Breite 0,5 ab 0');
  });

  it('keeps the sample base by default and says nothing about the opt-in method note ', () => {
    for (const options of [SLIDE, { ...SLIDE, methodNote: false }, { ...SLIDE, footnotes: false as const }]) {
      const geometry = layoutHistogram({ observations: ramp(120, 1, 1) }, options);
      expect(codes(geometry)).not.toContain('histogram-note-hidden');
      // The sample base is an engine note: by default it is in the notes list and off the canvas.
      expect(geometry.scene.map(node2text).join(' ')).not.toContain('n = 120');
      expect(geometry.frame.noteList?.find((note) => note.text.includes('n = 120'))).toMatchObject({ inFrame: false });
      // The no-title base stays visible with footnotes off, once the author opts in.
      expect(layoutHistogram({ observations: ramp(120, 1, 1) }, { ...options, ...SHOW_NOTES }).scene.map(node2text).join(' ')).toContain('n = 120');
    }
  });

  it('warns that the rule is an artifact of the rule at small n', () => {
    const small = layoutHistogram({ observations: ramp(12, 1, 1) }, { ...SLIDE, methodNote: true });
    expect(codes(small)).toContain('histogram-small-sample');
    expect(notes(small)).toContain(
      'artifact of the rule',
    );
    const large = layoutHistogram({ observations: ramp(120, 1, 1) }, SLIDE);
    expect(codes(large)).not.toContain('histogram-small-sample');
  });

  it('refuses sort and topN by name instead of warning that it ignores them ', () => {
    const refusal = (type: string, options: object) =>
      getChartDefinition(type)!.optionsSchema.safeParse(options).error?.issues[0]?.message ?? 'accepted';
    expect(refusal('histogram', { sort: { categories: 'desc' } })).toMatch(/^'sort' is not implemented by 'histogram' — /);
    expect(refusal('histogram', { topN: { n: 3 } })).toMatch(/^'topN' is not implemented by 'histogram' — /);
    expect(refusal('box', { topN: { n: 3 } })).toMatch(/^'topN' is not implemented by 'box' — /);
    expect(refusal('box', { bandFraction: 0.5 })).toMatch(/^'bandFraction' is not implemented by 'box' — /);
    expect(refusal('box', { legend: 'top' })).toMatch(/^'legend' is not implemented by 'box' — /);
  });

  it('prints an unsnapped rule width rounded, and says so ', () => {
    const fixture = fixtures.find((candidate) => candidate.id === 'order-value-distribution')!;
    const geometry = layoutHistogram(fixture.data, { ...fixture.options, binSnap: false, methodNote: true, ...SHOW_NOTES });
    // The base note, led by the authored axis title, keeps n; the method note states the binning once.
    const base = geometry.scene.filter((node) => node.part === 'footnote').map(node2text).join(' ');
    expect(base).toContain('Orders · n = 240.');
    expect(notes(geometry)).toMatch(/bins of \d[\d,]*\.\d from .*shown rounded/);
  });

  it('draws an authored bin count exactly, from the smallest to the largest observation ', () => {
    const observations = ramp(100, 1, 3.5);
    const geometry = layoutHistogram({ observations }, { ...SLIDE, bins: 7, methodNote: true });
    expect(geometry.warnings.some((entry) => entry.code === 'histogram-bin-count-adjusted')).toBe(false);
    expect(geometry.derived.counts).toHaveLength(7);
    const { edges } = geometry.derived.binning;
    expect([edges[0], edges.at(-1)]).toEqual([Math.min(...observations), Math.max(...observations)]);
    expect(geometry.derived.counts.reduce((sum, count) => sum + count, 0)).toBe(observations.length);
    expect(notes(geometry)).toContain('7 bins of');
  });

  it('discloses thinned bin labels instead of letting the axis go quiet', () => {
    const wide = layoutHistogram(fixtures[0]!.data, fixtures[0]!.options);
    expect(wide.derived.binLabelsShown).toBe(wide.derived.counts.length);
    expect(codes(wide)).not.toContain('histogram-bin-labels-thinned');

    const narrow = layoutHistogram(fixtures[0]!.data, {
      ...fixtures[0]!.options,
      size: { width: 320, height: 405 },
    });
    expect(narrow.derived.binLabelsShown).toBeLessThan(narrow.derived.counts.length);
    const warning = narrow.warnings.find((entry) => entry.code === 'histogram-bin-labels-thinned');
    expect(warning?.severity).toBe('info');
    expect(warning?.message).toContain('bin labels fit');
  });

  it('discloses a tail bin that is real in the counts and invisible in the ink', () => {
    const torture = fixtures.find((fixture) => fixture.id === 'bimodal-with-far-outlier')!;
    const geometry = layoutHistogram(torture.data, torture.options);
    const warning = geometry.warnings.find((entry) => entry.code === 'histogram-tail-below-ink');
    expect(warning?.severity).toBe('info');
    expect(geometry.derived.counts.at(-1)).toBe(1);
  });

  it('suppresses a frequency axis that would tick in fractions of an observation', () => {
    // Four observations spread over three bins: the tallest bar holds two, and
    // a nice axis over [0, 2] steps in halves.
    const geometry = layoutHistogram({ observations: [0, 1, 2, 3] }, SLIDE);
    expect(Math.max(...geometry.derived.counts)).toBeLessThanOrEqual(2);
    expect(codes(geometry)).toContain('histogram-frequency-axis-suppressed');
    expect(geometry.derived.frequencyAxisShown).toBe(false);
    expect(geometry.derived.pointLabelsShown).toBe(true);
    expect(geometry.axes.some((axis) => axis.axis === 'y')).toBe(false);
    // An author who asks for the axis anyway gets it, fractional ticks and all.
    const forced = layoutHistogram({ observations: [0, 1, 2, 3] }, { ...SLIDE, valueAxis: { show: true } });
    expect(codes(forced)).not.toContain('histogram-frequency-axis-suppressed');
    expect(forced.axes.some((axis) => axis.axis === 'y')).toBe(true);
  });

  it('gives every bin edge a distinct name whatever the magnitude', () => {
    // Width 0.04: the business default (one decimal) would print three
    // different edges as "0.0", "0.0", "0.1".
    const geometry = layoutHistogram({ observations: [0, 0.04, 0.08, 0.12, 0.16, 0.2] }, SLIDE);
    const edgeNames = geometry.derived.binLabels.flatMap((label) => label.split('–'));
    expect(new Set(edgeNames).size).toBe(geometry.derived.counts.length + 1);
    expect(codes(geometry)).not.toContain('histogram-edge-labels-collapsed');

    const coarse = layoutHistogram(
      { observations: [0, 0.04, 0.08, 0.12, 0.16, 0.2] },
      { ...SLIDE, format: '1' },
    );
    expect(codes(coarse)).toContain('histogram-edge-labels-collapsed');
  });

  it('prints a 2.5 width true to the width, and spaces the dash around negative edges ', () => {
    const quarter = layoutHistogram({ observations: [0, 1, 2.6, 3, 5.1, 6, 7.6, 9, 10] }, { ...SLIDE, bins: { width: 2.5 } });
    expect(quarter.derived.binLabels[0]).toBe('0.0–2.5');
    const signed = layoutHistogram({ observations: [-100, -50, -10, 0, 10, 50, 100, -3, -2, -1] }, SLIDE);
    expect(signed.derived.binLabels[0]).toMatch(/^−\d+ – −\d+$/);
  });
});

describe('histogram geometry and determinism', () => {
  it('draws contiguous bars: no bin is separated from its neighbour', () => {
    for (const fixture of fixtures) {
      const geometry = layoutHistogram(fixture.data, fixture.options);
      const bars = geometry.marks.bins;
      expect(bars.length).toBe(geometry.derived.counts.length);
      for (let index = 0; index + 1 < bars.length; index++) {
        // The open last bin stands a small gap apart.
        if (geometry.derived.binning.openAbove !== undefined && index + 2 === bars.length) {
          expect(bars[index + 1]!.rect.x - bars[index]!.rect.x - bars[index]!.rect.w).toBeGreaterThan(1);
          continue;
        }
        expect(
          bars[index]!.rect.x + bars[index]!.rect.w,
          `${fixture.id}: bin ${index} must touch bin ${index + 1}`,
        ).toBeCloseTo(bars[index + 1]!.rect.x, 9);
      }
    }
  });

  it('carries the bin interval and count on every mark', () => {
    const geometry = layoutHistogram(fixtures[0]!.data, fixtures[0]!.options);
    geometry.marks.bins.forEach((bin, index) => {
      expect(bin.lo).toBe(geometry.derived.binning.edges[index]);
      expect(bin.hi).toBe(geometry.derived.binning.edges[index + 1]);
      expect(bin.count).toBe(geometry.derived.counts[index]);
      expect(bin.nodeId).toBeDefined();
    });
    // Interaction contract: at least one display node and one mark node.
    expect(geometry.scene.some((node) => node.part === 'bar' && node.display !== undefined)).toBe(true);
  });

  it('applies a named palette to every distribution', () => {
    for (const fixture of fixtures) {
      const plain = layoutHistogram(fixture.data, fixture.options);
      const painted = layoutHistogram(fixture.data, { ...fixture.options, palette: 'atlantic' });
      expect(svg(painted), fixture.id).not.toBe(svg(plain));
      expect(codes(painted), fixture.id).not.toContain('palette-inapplicable');
      expect(codes(plain), fixture.id).not.toContain('palette-inapplicable');
    }
  });

  it('counts every observation, on every fixture', () => {
    for (const fixture of fixtures) {
      const geometry = layoutHistogram(fixture.data, fixture.options);
      const total = geometry.derived.counts.reduce((sum, count) => sum + count, 0);
      expect(total, fixture.id).toBe(fixture.data.observations.length);
      expect(geometry.derived.n, fixture.id).toBe(total);
    }
  });

  it('recomputes the summary statistics rather than trusting anything handed in', () => {
    const observations = [5, 1, 9, 3, 7, 2, 8, 4, 6, 10];
    const geometry = layoutHistogram({ observations }, SLIDE);
    const sorted = sortAscending(observations);
    expect(geometry.derived.min).toBe(1);
    expect(geometry.derived.max).toBe(10);
    expect(geometry.derived.mean).toBe(5.5);
    expect(geometry.derived.median).toBe(quantileType7(sorted, 0.5));
    expect(geometry.derived.q1).toBe(3.25);
    expect(geometry.derived.q3).toBe(7.75);
    expect(geometry.derived.iqr).toBe(4.5);
  });
});

describe('histogram: the two axes carry different quantities', () => {
  /** A EUR sample whose counts are large enough to be mistaken for money. */
  const money = ramp(200, 40, 1000);
  // Not whole numbers, so an authored count keeps its exact fractional width.
  const halfUnits = ramp(200, 40, 1000.5);

  it('never renders a count in the measure format', () => {
    const geometry = layoutHistogram({ observations: money }, { ...SLIDE, format: '€1.234', bins: 8 });
    const counts = geometry.derived.counts.map(String);
    const pointLabels = geometry.labels
      .filter((label) => label.kind === 'point' && label.hidden === undefined)
      .map((label) => label.text);
    expect(pointLabels.length).toBeGreaterThan(0);
    for (const text of pointLabels) {
      expect(text, 'a count wearing a currency reads as money').not.toContain('€');
      expect(counts).toContain(text);
    }
    // The bin edges — the MEASURE — keep the caller's format.
    expect(geometry.derived.binLabels[0]).toContain('€');
    // And no currency reaches the frequency axis either: read every text node
    // the reader gets, not the SVG as one string.
    const texts = [...svg(geometry).matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((match) =>
      match[1]!.replace(/<[^>]*>/g, ''),
    );
    const bearing = texts.filter((text) => text.includes('€'));
    expect(bearing.length).toBeGreaterThan(0);
    for (const text of bearing) {
      expect(text, 'only bin edges and the binning footer may carry the unit').toMatch(
        /–|n = \d|^€/,
      );
    }
  });

  it('gives the counts the grouping convention of the caller, never the unit', () => {
    const many = ramp(4000, 1, 0);
    const german = layoutHistogram({ observations: many }, { ...SLIDE, format: '1.234 €', bins: 2 });
    const label = german.labels.find((entry) => entry.kind === 'point')?.text ?? '';
    expect(label).toMatch(/^\d{1,3}\.\d{3}$/);
    expect(label).not.toContain('€');
    const anglo = layoutHistogram({ observations: many }, { ...SLIDE, format: '$1,234', bins: 2 });
    expect(anglo.labels.find((entry) => entry.kind === 'point')?.text ?? '').toMatch(
      /^\d{1,3},\d{3}$/,
    );
  });

  it('states a bin width the bin edges can actually be rebuilt from', () => {
    // width 497.5: at the edge column's precision the note must not say "498".
    const geometry = layoutHistogram({ observations: halfUnits }, { ...SLIDE, bins: 16, methodNote: true });
    const { width, anchor, edges } = geometry.derived.binning;
    expect(width).toBe(497.5);
    const note = notes(geometry);
    const statedWidth = /bins of ([\d,.]+) from ([\d,.]+)/.exec(note);
    expect(statedWidth, note).not.toBeNull();
    const unformat = (text: string): number => Number(text.replace(/,/g, ''));
    expect(unformat(statedWidth![1]!)).toBe(width);
    expect(unformat(statedWidth![2]!)).toBe(anchor);
    // The reader's reconstruction must land on the engine's own edges.
    const rebuilt = edges.map((_, index) =>
      Number((unformat(statedWidth![2]!) + index * unformat(statedWidth![1]!)).toPrecision(12)),
    );
    expect(rebuilt).toEqual(edges);
    expect(note).not.toContain('shown rounded');
  });

  it('says so when the width cannot be printed exactly, instead of certifying it', () => {
    const geometry = layoutHistogram({ observations: halfUnits }, { ...SLIDE, bins: 3, methodNote: true });
    const note = notes(geometry);
    expect(geometry.derived.binning.width).toBe(2653.33333333);
    // One decimal past the edges, not six digits of float.
    expect(note).toContain('bins of 2,653.3 from');
    expect(note).toContain('width and first edge shown rounded');
  });
});

describe('observations near 1e-6 keep readable edges and an honest note', () => {
  it('prints a 5e-7 bin width nonzero, names every bin apart and blames no format', () => {
    const observations = Array.from({ length: 50 }, (_, index) => 1e-6 + index * 3.7e-8);
    const geometry = layoutHistogram({ observations }, { ...SLIDE, unit: 'rate', methodNote: true } as HistogramOptions);
    expect(codes(geometry)).not.toContain('histogram-edge-labels-collapsed');
    const labels = geometry.derived.binLabels;
    expect(new Set(labels).size).toBe(labels.length);
    // Below the four-decimal floor the edges and the note print two significant digits and a power of ten.
    expect(labels[0]).toBe('1.0\u00a0×\u00a010⁻⁶–1.5\u00a0×\u00a010⁻⁶');
    expect(notes(geometry)).toContain('4 bins of 5.0\u00a0×\u00a010⁻⁷ from 1.0\u00a0×\u00a010⁻⁶ (');
  });

  // Edges that need more than four decimals must not all print one scientific label ("1.0 × 10⁻⁶") for 1e-11 bins.
  it('names bins apart past the four-decimal cap', () => {
    const geometry = layoutHistogram({ observations: [0.000001, 0.00000100001, 0.00000100002, 0.00000100003, 0.000001000035] }, { ...SLIDE, bins: { width: 1e-11 } } as HistogramOptions);
    const labels = geometry.derived.binLabels;
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toBe('0.00000100000–0.00000100001');
  });

  it('lifts the note precision on the figure the reader sees, at the example magnitude', () => {
    const observations = Array.from({ length: 50 }, (_, index) => 1000000 + index * 0.037);
    const geometry = layoutHistogram({ observations }, { ...SLIDE, format: '0.0000000 Mio.', methodNote: true } as HistogramOptions);
    expect(geometry.derived.binLabels[0]).toBe('1.0000000 Mio.–1.0000005 Mio.');
    expect(notes(geometry)).toContain('4 bins of 0.0000005 Mio. from 1 Mio. (');
  });
});

/** The reader's notes: the footnote lines plus the notes the frame moved to the notes list. */
function offFrameNotes(geometry: Geometry<HistogramMarks, HistogramDerived>): string[] {
  return (geometry.frame.noteList ?? []).filter((note) => !note.inFrame).map((note) => note.text);
}

function notes(geometry: Geometry<HistogramMarks, HistogramDerived>): string {
  return [...geometry.scene.filter((node) => node.part === 'footnote').map(node2text), ...offFrameNotes(geometry)].join(' ');
}

function readerText(geometry: Geometry<HistogramMarks, HistogramDerived>): string {
  return [...geometry.scene.map(node2text), ...offFrameNotes(geometry)].join(' ');
}

function node2text(node: SceneNode | undefined): string {
  return node && 'lines' in node ? node.lines.join(' ') : '';
}

/** renderSvg takes the erased Geometry; the chart's own marks/derived are narrower. */
function svg(geometry: Geometry<HistogramMarks, HistogramDerived>): string {
  return renderSvg(geometry as unknown as Geometry, resolveTheme(undefined));
}


describe('histogram boundaries and frequency', () => {
  it('places labelled boundaries at one stride, with a tick at every boundary', () => {
    const f = fixtures.find((f) => f.id === 'order-value-distribution')!;
    for (const bins of [1, 10]) {
      const g = layoutHistogram(f.data, { ...f.options, bins, size: { width: 400, height: 300 } });
      const axis = g.axes.find((axis) => axis.axis === 'x')!;
      expect(axis.ticks).toHaveLength(g.derived.counts.length + 1);
      const labelled = axis.ticks.flatMap((tick, i) => tick.labelId ? [i] : []);
      expect(new Set(labelled.slice(1).map((i, j) => i - labelled[j]!)).size).toBe(1);
      expect(axis.ticks[0]!.pos).toBeCloseTo(g.marks.bins[0]!.rect.x, 2);
      const narrowInk = layoutHistogram(f.data, { ...f.options, bins, bandFraction: 0.3, size: { width: 400, height: 300 } });
      narrowInk.axes.find((axis) => axis.axis === 'x')!.ticks.forEach((tick, i) => expect(tick.pos).toBeCloseTo(axis.ticks[i]!.pos, 8));
      for (const label of g.labels.filter((label) => label.id.startsWith('edge:') && !label.hidden)) {
        const node = g.scene.find((node) => node.id === `label:${label.id}`)!;
        expect(node.t === 'text' && node.x).toBe(label.rect.x);
      }
      // The first edge number starts at the plot edge and the last one ends there.
      const edge = (i: number) => g.labels.find((label) => label.id === `edge:${i}` && !label.hidden)!.rect;
      expect(edge(0).x).toBeCloseTo(axis.ticks[0]!.pos, 6);
      const last = edge(g.derived.counts.length);
      expect(last.x + last.w).toBeCloseTo(axis.ticks.at(-1)!.pos, 6);
    }
  });
  it('uses German binning and method text and accepts a public strings override', () => {
    const data = { observations: [0, 0.1, 0.4, 0.9, 1.1, 1.4] };
    const german = layoutHistogram(data, { ...SLIDE, locale: { language: 'de' }, bins: { width: 0.5, anchor: 0 }, methodNote: true, ...SHOW_NOTES });
    const germanNotes = notes(german);
    // The method note carries the binning, so the German base text prints without it (default: base only).
    const base = layoutHistogram(data, { ...SLIDE, locale: { language: 'de' }, bins: { width: 0.5, anchor: 0 }, ...SHOW_NOTES });
    expect(base.scene.filter((node) => node.part === 'footnote').map(node2text).join(' ')).toContain('Klassen der Breite 0,5, untere Grenze eingeschlossen · n = 6.');
    expect(germanNotes).toContain('angegebene Klassenbreite');
    expect(germanNotes).not.toContain('bins of');
    // The restored axis caption draws the public binning-text override.
    const custom = getChartDefinition('histogram')!.optionsSchema.parse({ ...SLIDE, bins: 2, valueAxis: { show: true }, strings: { histogramBins: '{count} bands of {width}: {from}–{to}' } });
    const g = getChart('histogram')!.layout(data, custom) as Geometry<HistogramMarks, HistogramDerived>;
    expect(node2text(g.scene.find((node) => node.id === 'label:axis:y:title'))).toContain('2 bands of 0.7: 0–1.4');
  });
  it('hides only the automatic frequency axis after every count has a drawn label', () => {
    const f = fixtures.find((f) => f.id === 'order-value-distribution')!;
    const automatic = layoutHistogram(f.data, { ...f.options, size: { width: 960, height: 540 } });
    // Complete count labels make the automatic axis give way, also under an authored title.
    expect(automatic.derived.frequencyAxisShown).toBe(false);
    expect(layoutHistogram(f.data, { ...f.options, axisTitles: undefined }).derived.frequencyAxisShown).toBe(false);
    expect(automatic.labels.filter((label) => label.kind === 'point' && !label.hidden)).toHaveLength(10);
    const authored = layoutHistogram(f.data, { ...f.options, valueAxis: { show: true } });
    expect(authored.axes.some((axis) => axis.axis === 'y')).toBe(true);
    const unlabelled = layoutHistogram(f.data, { ...f.options, labels: false });
    expect(unlabelled.axes.some((axis) => axis.axis === 'y')).toBe(true);
    for (const labels of [false, { point: false }] as const) {
      const small = layoutHistogram({ observations: [0, 1, 2, 3] }, { bins: 4, labels, ...SHOW_NOTES });
      expect(small.axes.some((axis) => axis.axis === 'y')).toBe(true);
      expect(small.derived.frequencyAxisShown).toBe(true);
      expect(small.derived.pointLabelsShown).toBe(false);
      expect(codes(small)).not.toContain('histogram-frequency-axis-suppressed');
      expect(small.scene.map(node2text).join(' ')).toContain('n = 4');
    }
  });
  it('encodes each bin share rather than normalizing each bin to 100%', () => {
    const g = layoutHistogram({ observations: [0, 1, 2, 3, 4, 5, 6, 9] }, { ...SLIDE, bins: { width: 5, anchor: 0 }, valueAxis: { percent: true, show: true } });
    expect(g.derived.counts).toEqual([5, 3]);
    expect(g.marks.bins[0]!.rect.h / g.marks.bins[1]!.rect.h).toBeCloseTo(5 / 3, 6);
    expect(g.labels.filter((label) => label.kind === 'point').map((label) => label.text)).toEqual(expect.arrayContaining(['63%', '38%']));
  });
});

// Decimal boundaries and large offsets must not move observations into the wrong bin.
it('keeps full-precision bin membership at decimal and timestamp offsets', () => {
  for (const [base, step] of [[0, 0.001], [1_000_000_000, 0.001], [1_792_454_400_000, 1]]) {
    const result = measure({ type: 'histogram', data: { observations: ramp(8, step, base) }, options: { bins: 4, size: { width: 1600, height: 900 } } });
    const geometry = result.geometry as unknown as Geometry<HistogramMarks, HistogramDerived>;
    expect(geometry.marks.bins.map(bin => bin.count)).toEqual([2, 2, 2, 2]);
    const sorted = ramp(8, step, base);
    const { edges } = computeBinning({ sorted, min: sorted[0]!, max: sorted[7]!, interquartileRange: iqr(sorted), bins: 4, snap: true });
    expect(edges.every((edge, i) => i === 0 || edge > edges[i - 1]!)).toBe(true);
  }
  expectThrows(() => layoutHistogram({ observations: [1, 2, 3, 4] }, { bins: {} as never }), 'histogram-bin-width-invalid');
  const decimalAnchor = measure({ type: 'histogram', data: { observations: [0.35, 0.4, 0.5, 0.6, 0.65] }, options: { ...SLIDE, bins: { width: 0.1 } } });
  expect((decimalAnchor.geometry as unknown as Geometry<HistogramMarks, HistogramDerived>).derived.counts).toEqual([1, 1, 1, 2]);
  for (const { observations, bins, counts, claimId, displayed } of [
    { observations: [0.07, 0.1, 0.2, 0.37, 0.5], bins: { width: 0.1, anchor: 0.07 }, counts: [2, 1, 0, 1, 1], claimId: 'histogram:bin:2', displayed: '[0.27, 0.37)' },
    { observations: [0.14, 0.15, 0.29, 0.3, 0.4], bins: { width: 0.05, anchor: 0.14 }, counts: [2, 0, 0, 2, 0, 1], claimId: 'histogram:bin:2', displayed: '[0.24, 0.29)' },
    { observations: [0.18, 1, 3, 4, 5.82], bins: 4, counts: [2, 0, 2, 1], claimId: 'histogram:bin:1', displayed: '[1.59, 3)' },
  ]) {
    const result = measure({ type: 'histogram', data: { observations }, options: { ...SLIDE, bins } });
    const geometry = result.geometry as unknown as Geometry<HistogramMarks, HistogramDerived>;
    const derived = geometry.derived;
    expect(derived.counts, JSON.stringify({ observations, bins })).toEqual(counts);
    const { width, anchor, edges, hFd, hSturges, hAuto } = derived.binning;
    for (const value of [width, anchor, ...edges, hFd, hSturges, hAuto]) expect(value).toBe(Number(value.toPrecision(12)));
    expect(claimsForChart('histogram', geometry).find(claim => claim.id === claimId)?.output.displayed).toBe(displayed);
  }
  expect(() => measure({ type: 'histogram', data: { observations: [1e15, 1e15, 1e15 + 0.125, 1e15 + 0.125] }, options: { bins: 4 } }))
    .toThrow(expect.objectContaining({ code: 'histogram-bin-range-invalid' }));
});
