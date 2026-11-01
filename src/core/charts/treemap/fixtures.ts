/** Treemap fixtures. Invented data: 19 items in 5 groups, one dominant group and a few tiny items. */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { TreemapData, TreemapOptions } from './types';

const areas: TreemapData = {
  groups: [
    { id: 'platforms', label: 'Platforms' },
    { id: 'commerce', label: 'Commerce' },
    { id: 'energy', label: 'Energy' },
    { id: 'health', label: 'Health' },
    { id: 'machines', label: 'Machines' },
  ],
  items: [
    { id: 'core-software', label: 'Core software', group: 'platforms', value: 7350 },
    { id: 'cloud-hosting', label: 'Cloud hosting', group: 'platforms', value: 1820 },
    { id: 'data-tools', label: 'Data tools and services', group: 'platforms', value: 1610 },
    { id: 'online-ads', label: 'Online ads', group: 'commerce', value: 3080 },
    { id: 'marketplaces', label: 'Marketplaces', group: 'commerce', value: 780 },
    { id: 'streaming', label: 'Streaming', group: 'commerce', value: 410 },
    { id: 'security', label: 'Security', group: 'commerce', value: 360 },
    { id: 'gaming', label: 'Gaming', group: 'commerce', value: 290 },
    { id: 'electric-fleets', label: 'Electric fleets', group: 'energy', value: 790 },
    { id: 'storage', label: 'Storage', group: 'energy', value: 102 },
    { id: 'small-reactors', label: 'Small reactors', group: 'energy', value: 36 },
    { id: 'hydrogen', label: 'Hydrogen', group: 'energy', value: 22 },
    { id: 'weight-care', label: 'Weight care', group: 'health', value: 612 },
    { id: 'lab-services', label: 'Lab services', group: 'health', value: 15 },
    { id: 'orbital', label: 'Orbital', group: 'machines', value: 398 },
    { id: 'automation', label: 'Automation', group: 'machines', value: 105 },
    { id: 'robotaxis', label: 'Robotaxis', group: 'machines', value: 49 },
    { id: 'air-taxis', label: 'Air taxis', group: 'machines', value: 14 },
    { id: 'prefab-housing', label: 'Prefab housing', group: 'machines', value: 0.4 },
  ],
};

const frame: TreemapOptions = {
  title: 'Core software and online ads made up more than half of the ~$18 billion growth',
  subtitle: { measure: 'Revenue growth, by business area', period: '2022–25' },
  unit: '$ million',
  source: 'Illustrative data',
};

export const fixtures: Fixture<TreemapData, TreemapOptions>[] = [
  {
    id: 'growth-rect',
    title: 'Squarified treemap: 19 items in 5 groups, exact areas, group key with totals, small names beside the region',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { seriesId: 'platforms', categoryId: 'core-software' } },
    data: areas,
    // The cells too small to name are listed under the chart, so no value is lost.
    options: { ...frame, notes: { show: ['note', 'disclosure'] }, size: { width: 960, height: 600 } },
  },
  {
    id: 'growth-circle',
    title: 'Circular Voronoi treemap of the same data: convex cells, leaders to both sides and a total callout',
    kind: 'example',
    data: areas,
    options: { ...frame, variant: 'circle', total: '~$18 billion', size: { width: 960, height: 760 } },
  },
  {
    id: 'growth-rect-group-hues',
    title: 'The same groups with one hue each: color.treemap set to the series colours',
    kind: 'example',
    tags: ['feature:theme'],
    data: areas,
    options: {
      ...frame,
      size: { width: 960, height: 600 },
      theme: { preset: 'boardroom', overrides: { color: { treemap: ['#12395E', '#5E99C5', '#B58629', '#72767C', '#6F69CC', '#587000', '#229B72', '#335B83'] } } },
    },
  },
  {
    id: 'one-level-shares',
    title: 'One level, no groups: one hue, value and share of the total on every cell',
    kind: 'example',
    data: {
      items: [
        { id: 'north', label: 'North', value: 412 },
        { id: 'south', label: 'South', value: 268 },
        { id: 'east', label: 'East', value: 190 },
        { id: 'west', label: 'West', value: 96 },
        { id: 'online', label: 'Online', value: 34 },
      ],
    },
    options: { title: 'North and South sell two thirds of all units', unit: 'k units', source: 'Illustrative data', cellValue: 'value-share' },
  },
  {
    id: 'source-order-shares-circle',
    title: 'Circle in source order with shares of the total and the key at the bottom',
    kind: 'example',
    data: {
      groups: [{ id: 'retail', label: 'Retail' }, { id: 'wholesale', label: 'Wholesale' }, { id: 'services', label: 'Services' }],
      items: [
        { id: 'stores', label: 'Stores', group: 'retail', value: 310 },
        { id: 'web-shop', label: 'Web shop', group: 'retail', value: 220 },
        { id: 'outlets', label: 'Outlets', group: 'retail', value: 40 },
        { id: 'distributors', label: 'Distributors', group: 'wholesale', value: 180 },
        { id: 'key-accounts', label: 'Key accounts', group: 'wholesale', value: 120 },
        { id: 'repairs', label: 'Repairs', group: 'services', value: 75 },
        { id: 'training', label: 'Training', group: 'services', value: 35 },
        { id: 'licences', label: 'Licences', group: 'services', value: 20 },
      ],
    },
    options: {
      title: 'Retail brings in more than half of the revenue', unit: '$m', source: 'Illustrative data',
      variant: 'circle', order: 'sheet', cellValue: 'share', legend: 'bottom', size: { width: 800, height: 520 },
    },
  },
  {
    id: 'zero-value',
    title: 'Refusal example: a zero value has no area',
    kind: 'torture',
    refuses: { code: 'treemap-value-not-positive' },
    data: { items: [{ id: 'a', value: 10 }, { id: 'b', value: 0 }] },
  },
];

registerFixtures('treemap', fixtures);
