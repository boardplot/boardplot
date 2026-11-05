/**
 * Names that stand upright at the reader floor size must not rotate. A full slide drew eight
 * category names turned 45° (column, variance) or -90° (pareto) and cut to a few letters,
 * because one long word or one hyphenated name was wider than its slot at the base size,
 * although every name fits on up to three lines one size down.
 */
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';

const slide = { format: 'svg', target: 'slide', width: '888pt', height: '396pt' } as const;
const warnings = (spec: unknown) => ((render({ spec, ...slide }).body as any).warnings as { code: string }[]).map((warning) => warning.code);
const labels = ['Income from equity-accounted firms', 'Reimbursable freight charges', 'Decommissioning and utilities', 'Depreciation of tangible assets',
  'Reimbursements for purchased goods', 'Net revenue retention, enterprise', 'Miscellaneous operating expenditures', 'Customer acquisition cost'];
const id = (label: string) => label.toLowerCase().replace(/\W+/g, '-');

describe('category names step to the floor size before they rotate', () => {
  it('a column row with one word wider than its slot stays upright', () => {
    const codes = warnings({
      type: 'column',
      data: { categories: labels.map((label) => ({ id: id(label), label })), series: [{ id: 'a', label: 'Plan', values: labels.map((_, i) => 10 + i) }] },
      options: { title: 'Revenue by unit' },
    });
    expect(codes).toContain('category-font-stepped');
    expect(codes).not.toContain('category-labels-rotated');
  });

  it('a pareto row breaks a hyphenated name after the hyphen instead of turning every name', () => {
    const names = ['General and administrative costs', 'Reimbursements and utilities', 'Maintenance and repair work', 'Subcontracting logistics abroad',
      'Miscellaneous operating expenditures', 'Brightmoor-Stonehaven', 'Northvale-Westfield (Rhineside)', 'Change in net working capital'];
    const codes = warnings({
      type: 'pareto',
      data: { items: names.map((label, i) => ({ id: id(label), label, value: 700 - 20 * i })) },
      options: { title: 'Causes by volume', unit: 'cases', categoryLabels: 'axis' },
    });
    expect(codes).not.toContain('category-labels-rotated');
    expect(codes).not.toContain('plot-under-floor');
  });

  // Hyphen wrapping once turned a numbered row ("Stage-one 1" to "Stage-one 9", every other name drawn) into nine two-line names.
  it('a numbered row keeps its stride', () => {
    const codes = warnings({
      type: 'column',
      data: { categories: Array.from({ length: 9 }, (_, i) => ({ id: `c${i + 1}`, label: `Production-ready ${i + 1}` })), series: [{ id: 'a', label: 'Plan', values: [20, 25, 30, 35, 40, 45, 50, 55, 60] }] },
      options: { title: 'Production stages' },
    });
    expect(codes).toContain('category-stride');
  });
});
