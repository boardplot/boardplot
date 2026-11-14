import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { defaultSetSpec, statisticFormatter } from '../src/core/formatSpec';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';

const columnLabels = (format: string, values: number[]): string[] => {
  const request = resolveChartRequest({ type: 'column', data: {
    categories: values.map((_, index) => ({ id: String(index) })), series: [{ id: 's', values }],
  }, options: { format, valueLabels: 'all', size: { width: 960 } } } as never);
  return requireGeometry(layoutResolvedRequest(request)).labels.filter((label) => label.kind === 'point' && !label.hidden).map((label) => label.text).sort();
};

describe('default number sets', () => {
  // A unit-only format states affixes and a scale word only: without the set, its decimals came from stand-in examples ("$8.40000M").
  it('fills the decimals of a unit-only format by the rule', () => {
    expect(columnLabels('$', [15_060_000, 14_800_000, 17_670_000, 16_330_000])).toEqual(['$14.8M', '$15.1M', '$16.3M', '$17.7M']);
    expect(columnLabels('$M', [8_400_000, 950_000, 900])).toEqual(['$0.0009M', '$0.95M', '$8.4M']);
    expect(columnLabels('%', [12.5, 8, 4.25, 30])).toEqual(['12.5%', '30.0%', '4.3%', '8.0%']);
  });

  // A head that names a scale word the cells do not all share would print "840k" as 0.84 million.
  it('moves a scale word into the table head only when every cell prints it', () => {
    const request = resolveChartRequest({ type: 'table', data: {
      columns: [{ id: 'name', kind: 'rowLabel', label: 'Region' }, { id: 'a', kind: 'value', label: 'Revenue' }, { id: 'b', kind: 'value', label: 'Cost' }],
      rows: [[2_500_000, 2_500_000], [1_200_000, 1_800_000], [840_000, 1_200_000]].map(([a, b], index) => ({ id: String(index), label: `R${index}`, cells: { a, b } })),
    }, options: {} } as never);
    const texts = [...renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme).matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)]
      .map((match) => match[1]!.replace(/<[^>]*>/g, ''));
    expect(texts).toEqual(['REGION', 'REVENUE', 'COST (M)', 'R0', '2.5M', '2.5', 'R1', '1.2M', '1.8', 'R2', '840k', '1.2']);
  });

  // An average printed without the scale words of its values would read "9,500" beside "12.8k".
  it('gives a statistic the scale-word decision of its values', () => {
    expect(statisticFormatter([9500], defaultSetSpec([12_800, 48_200], 'en'))(9500)).toBe('9.5k');
    expect(statisticFormatter([9500], defaultSetSpec([9500], 'en'))(9500)).toBe('9,500');
  });

  // A pie built its set without the chart's unit, so a unit text such as "kg" got scale words: "41,2k" beside "kg".
  it('gives a pie set the unit of its chart', () => {
    const request = resolveChartRequest({ type: 'pie', data: {
      categories: ['n', 's', 'e', 'w'].map((id) => ({ id, label: id.toUpperCase() })), series: [{ id: 'mass', values: [41_200, 33_800, 9_800, 0.0000031] }],
    }, options: { unit: 'kg', size: { width: 960 } } } as never);
    const texts = requireGeometry(layoutResolvedRequest(request)).labels.filter((label) => label.kind === 'outsidePie').map((label) => label.text);
    expect(texts).toEqual(['N 41,200 · 48.6%', 'S 33,800 · 39.9%', 'E 9,800 · 11.6%', 'W 0.0000031 · <0.1%']);
  });
});
