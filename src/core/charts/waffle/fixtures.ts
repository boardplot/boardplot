/** Waffle fixtures. Invented data; each example uses a different option. */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { ChartData } from '../../types/data';
import type { WaffleOptions } from './types';

export const fixtures: Fixture<ChartData, WaffleOptions>[] = [
  {
    id: 'single-share',
    title: 'One panel: 30% of customers, a label, a headline and a 10 by 10 grid',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'high-spend', seriesId: 'share' } },
    data: {
      categories: [{ id: 'high-spend', label: 'Share of high-spending customers out of all customers' }],
      series: [{ id: 'share', label: 'High spenders', values: [30] }],
    },
    options: { title: 'Three in ten customers are high spenders', headline: 'value', source: 'Illustrative data', size: { width: 480, height: 480 } },
  },
  {
    id: 'two-panels',
    title: 'Two panels with labels of different lengths: grids and headlines keep one baseline',
    kind: 'example',
    data: {
      categories: [
        { id: 'urban', label: 'Share of high-spending customers out of all customers in the urban region' },
        { id: 'rural', label: 'Share of repeat buyers' },
      ],
      series: [{ id: 'share', label: 'Share', values: [30, 64] }],
    },
    options: { title: 'Repeat buyers are twice as common as high spenders', source: 'Illustrative data' },
  },
  {
    id: 'stacked-segments',
    title: 'One panel with three segments: whole-cell rounding, values beside the grid, 13 empty cells and a subtotal bracket',
    kind: 'example',
    data: {
      categories: [{ id: 'orders', label: 'Orders by delivery speed, % of all orders' }],
      series: [
        { id: 'same-day', label: 'Same day', values: [41.3] },
        { id: 'next-day', label: 'Next day', values: [27.4] },
        // Grey for the slow part: blue reads as within a day, and the key keeps its order.
        { id: 'later', label: 'Later', colorRole: 'series-4', values: [18.3] },
      ],
    },
    options: {
      title: 'Two in three orders arrive within a day', source: 'Illustrative data', format: '0.0%', variant: 'cells',
      subtotal: { series: ['same-day', 'next-day'], label: 'within a day' }, strings: { others: 'Rest of orders' },
      // The 10 by 10 grid prints no cell note by itself; the footnote names the whole once.
      footnotes: ['1 square = 1% of orders'],
    },
  },
  {
    id: 'fraction-input',
    title: 'Fractions of 1 under valueKind fraction, on a wide 5 by 20 grid',
    kind: 'example',
    data: {
      valueKind: 'fraction',
      categories: [{ id: 'a', label: 'Customers who bought twice' }, { id: 'b', label: 'Customers who bought three times' }],
      series: [{ id: 'share', label: 'Share', values: [0.27, 0.64] }],
    },
    options: { title: 'Fractions draw like percents', grid: { rows: 5, columns: 20 }, source: 'Illustrative data', size: { width: 960 } },
  },
  {
    id: 'top-fill-no-headline',
    title: 'Fill from the top on a coarse 4 by 5 grid, no headline',
    kind: 'example',
    data: {
      categories: [{ id: 'sold', label: 'Seats sold' }, { id: 'booked', label: 'Seats booked' }],
      series: [{ id: 'share', label: 'Share', values: [45, 80] }],
    },
    options: { title: 'Each cell is 5% of the seats', grid: { rows: 4, columns: 5 }, fillFrom: 'top', headline: 'none', cellNote: 'none', source: 'Illustrative data' },
  },
  {
    id: 'coarse-grid-cell-note',
    title: 'A 4 by 5 grid: one cell is 5%, and the note says so in the host wording',
    kind: 'example',
    data: {
      categories: [{ id: 'sold', label: 'Seats sold' }, { id: 'booked', label: 'Seats booked' }],
      series: [{ id: 'share', label: 'Share', values: [45, 80] }],
    },
    options: { title: 'Four in five seats are booked', grid: { rows: 4, columns: 5 }, cellNote: 'auto', strings: { cellNote: 'Each cell is {value}', source: 'Data' }, locale: { language: 'de' }, source: 'Illustrative data' },
  },
  {
    id: 'seven-panels-narrow',
    title: 'Torture: seven panels near the minimum cell size, a missing value, a value under half a cell and a full panel',
    kind: 'torture',
    data: {
      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ id: day.toLowerCase(), label: day })),
      series: [{ id: 'share', label: 'Share', values: [12, 38, null, 0.4, 100, 57.5, 66] }],
    },
    options: { title: 'Share of orders by weekday', source: 'Illustrative data', size: { width: 900 } },
  },
  {
    id: 'share-squares',
    title: 'Square mode: five shares as solid squares in pale 100% squares, one dashed reference, two captioned groups',
    kind: 'example',
    data: {
      categories: [
        { id: 'headcount', label: 'Headcount' },
        { id: 'revenue', label: 'Revenue' },
        { id: 'profit', label: 'Operating profit' },
        { id: 'launches', label: 'New product launches' },
        { id: 'patents', label: 'Patent filings' },
      ],
      series: [{ id: 'share', label: 'North region share', colorRole: 'neutral', values: [6, 31, 54, 47, 22] }],
    },
    options: {
      title: 'North earns more than its size today. Will it keep the lead?',
      subtitle: { measure: 'North region share of company total', company: '' },
      unit: '%',
      variant: 'square',
      reference: { categoryId: 'headcount', label: 'Headcount 6%' },
      panelGroups: [
        { id: 'today', panels: ['revenue', 'profit'], label: 'Today, North carries the business', colorRole: 'series-1' },
        { id: 'tomorrow', panels: ['launches', 'patents'], label: 'Staying ahead needs more launches and patents', colorRole: 'series-2' },
      ],
      source: 'Illustrative data',
      size: { width: 960 },
    },
  },
  {
    id: 'share-squares-arrows',
    title: 'Square mode with arrows on: three panels, a number reference with its label, arrows in the gaps at the outline height',
    kind: 'example',
    data: {
      categories: [{ id: 'stores', label: 'Store count' }, { id: 'sales', label: 'Sales' }, { id: 'online', label: 'Online orders' }],
      series: [{ id: 'share', label: 'Share', values: [12, 35, 58] }],
    },
    options: {
      title: 'Each step outgrows the store count',
      variant: 'square',
      arrows: true,
      reference: { value: 20, label: 'Target 20%' },
      source: 'Illustrative data',
      size: { width: 720 },
    },
  },
  {
    id: 'over-100',
    title: 'Refusal example: the values of one panel add up to more than 100',
    kind: 'torture',
    refuses: { code: 'waffle-over-100' },
    data: {
      categories: [{ id: 'a', label: 'Over the whole' }],
      series: [{ id: 'one', values: [70] }, { id: 'two', values: [45] }],
    },
    options: { source: 'Illustrative data' },
  },
];

registerFixtures('waffle', fixtures);
