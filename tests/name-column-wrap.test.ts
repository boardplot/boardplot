/**
 * A long name must not take the room its chart needs. A bar's name column keeps the
 * narrowest width that holds each name in two lines, not the whole widened budget, and a
 * pie reserves its two label columns for names already wrapped. Before, half a slide drew a
 * bar chart that dropped 17 of 48 values to a note, and a pie of 40 px with six names missing.
 */
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';

const half = { format: 'svg', target: 'slide', width: '432pt', height: '396pt' } as const;
const reading = (spec: unknown) => (render({ spec, ...half }).body as any).reading;

describe('long names wrap before they take room', () => {
  it('a bar name column keeps room for every value of five stacked series', () => {
    const names = ['Customer acquisition cost', 'Outsourced logistics overseas', 'Net revenue retention, enterprise', 'Other operating income',
      'Rebilled freight charges', 'Telecommunications, domestic', 'Selling and distribution overheads', 'Depreciation of tangible assets'];
    const series = [['Subscription revenue, monthly plans', [9.212, 9.039, 8.76, 8.168, 7.975, 8.891, 8.377, 8.131]],
      ['Other domestic services', [16.05, 15.81, 15.91, 14.34, 14.53, 15.63, 15.23, 15.14]],
      ['Professional services, fixed price', [12.15, 11.69, 10.56, 10.97, 10.94, 10.73, 10.12, 10.98]],
      ['Hardware and spare parts sales', [12.24, 12.21, 11.85, 10.93, 11.26, 11.69, 11.44, 11.13]],
      ['Managed services and support', [15.35, 14.93, 15.22, 14.91, 13.89, 13.09, 13.51, 13.47]]] as const;
    const read = reading({
      type: 'bar',
      data: {
        categories: names.map((label) => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label })),
        series: series.map(([label, values]) => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label, values })),
      },
      options: { title: 'Ranking of units', unit: '%', variant: 'stacked', textScale: 0.86 },
    });
    expect(read.labelsDropped).toBe(0);
    expect(read.labelsPlaced).toBe(48);
  });

  it('a pie with eight long names labels every slice in two columns', () => {
    const names = ['Depreciation of fixed assets', 'Rebilled freight and haulage', 'Expenses for purchased goods', 'Other operating expense items',
      'Northern coast and harbour region', 'Net revenue retention, enterprise', 'Highland and central plains', 'Other operating income items',
      'Riverside and western valleys', 'Other comprehensive income items', 'General and administrative costs', 'Research and development expenses'];
    const values = [329.9, 311.8, 340.8, 362.6, 344.4, 379.1, 387.7, 422.4, 457.7, 428.7, 475.8, 467.5];
    const read = reading({
      type: 'pie',
      data: {
        categories: names.map((label) => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label })),
        series: [{ id: 'amount', label: 'Amount', values }],
      },
      options: { title: 'Share of total', unit: 'USD m' },
    });
    expect(read.labelsDropped).toBe(0);
    expect(read.labelsPlaced).toBe(8);
  });
});
