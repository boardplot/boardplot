import type { Fixture } from '../../registry';
import type { ChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';

export const groupedStacksFixture = {
  id: 'two-stacks-per-period',
  title: 'Two fiscal years grouped by quarter',
  kind: 'example',
  data: {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'].flatMap(group =>
      ['FY24', 'FY25'].map(label => ({ id: label + group.toLowerCase(), label, group }))),
    series: [
      { id: 'north', label: 'North', values: [40, 46, 44, 50, 48, 55, 52, 60] },
      { id: 'south', label: 'South', values: [30, 32, 31, 36, 33, 38, 35, 41] },
      { id: 'west', label: 'West', values: [20, 24, 22, 25, 21, 27, 24, 30] },
    ],
  },
  options: {
    variant: 'stacked', title: 'Revenue grew in every quarter of FY25 versus FY24', unit: '$k',
    grandTotalLabels: true, size: { width: 960, height: 540 }, source: 'Illustrative data',
  },
} satisfies Fixture<ChartData, ColumnOptions>;
