/** Sankey fixtures. Invented data for invented companies. */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { SankeyData, SankeyLink, SankeyOptions } from './types';

const journeys: SankeyData = {
  links: [
    { source: 'search', target: 'product', value: 420 },
    { source: 'search', target: 'home', value: 180 },
    { source: 'search', target: 'offer', value: 60 },
    { source: 'social', target: 'home', value: 260 },
    { source: 'social', target: 'offer', value: 140 },
    { source: 'email', target: 'product', value: 140 },
    { source: 'email', target: 'offer', value: 90 },
    { source: 'partners', target: 'product', value: 70 },
    { source: 'display', target: 'home', value: 9 },
    { source: 'affiliates', target: 'offer', value: 7 },
    { source: 'product', target: 'purchase', value: 205 },
    { source: 'product', target: 'exit', value: 425 },
    { source: 'home', target: 'purchase', value: 64 },
    { source: 'home', target: 'exit', value: 385 },
    { source: 'offer', target: 'purchase', value: 96 },
    { source: 'offer', target: 'exit', value: 201 },
  ],
  nodes: [
    { id: 'search', label: 'Search' }, { id: 'social', label: 'Social' }, { id: 'email', label: 'Email' },
    { id: 'partners', label: 'Partners' }, { id: 'display', label: 'Display' }, { id: 'affiliates', label: 'Affiliates' },
    { id: 'product', label: 'Product page' }, { id: 'home', label: 'Home page' }, { id: 'offer', label: 'Offer page' },
    { id: 'purchase', label: 'Purchase' }, { id: 'exit', label: 'Left the site' },
  ],
  stages: [{ id: 'channel', label: 'Channel' }, { id: 'page', label: 'Landing page' }, { id: 'outcome', label: 'Outcome' }],
};

const budget: SankeyData = {
  links: [
    { source: 'budget', target: 'engineering', value: 41 },
    { source: 'budget', target: 'sales', value: 23 },
    { source: 'budget', target: 'marketing', value: 14 },
    { source: 'budget', target: 'operations', value: 12 },
    { source: 'budget', target: 'admin', value: 6 },
    { source: 'engineering', target: 'staff', value: 31 },
    { source: 'engineering', target: 'cloud', value: 10 },
    { source: 'sales', target: 'staff', value: 17 },
    { source: 'sales', target: 'travel', value: 6 },
    { source: 'marketing', target: 'media', value: 11 },
    { source: 'marketing', target: 'staff', value: 3 },
    { source: 'operations', target: 'staff', value: 7 },
    { source: 'operations', target: 'facilities', value: 5 },
    { source: 'admin', target: 'staff', value: 4 },
    { source: 'admin', target: 'facilities', value: 2 },
  ],
  nodes: [
    { id: 'budget', label: 'Operating budget' }, { id: 'engineering', label: 'Engineering' }, { id: 'sales', label: 'Sales' },
    { id: 'marketing', label: 'Marketing' }, { id: 'operations', label: 'Operations' }, { id: 'admin', label: 'Administration' },
    { id: 'staff', label: 'Staff' }, { id: 'cloud', label: 'Cloud services' }, { id: 'travel', label: 'Travel' },
    { id: 'media', label: 'Paid media' }, { id: 'facilities', label: 'Facilities' },
  ],
};

const segments = ['gold', 'silver', 'bronze', 'lapsed'] as const;
/** Customers per segment pair, month to month: rows of a transition table with the next month joined on. */
const moves: Record<string, number[][]> = {
  'jan>feb': [[820, 90, 20, 10], [70, 1240, 150, 60], [15, 110, 1580, 240], [5, 30, 120, 2100]],
  'feb>mar': [[790, 100, 15, 5], [95, 1210, 140, 25], [20, 140, 1440, 270], [10, 60, 155, 2185]],
  'mar>apr': [[815, 80, 15, 5], [90, 1250, 140, 30], [25, 130, 1470, 125], [5, 45, 210, 2225]],
};
const migration: SankeyData = {
  links: Object.entries(moves).flatMap(([pair, matrix]) => {
    const [sourceStage, targetStage] = pair.split('>') as [string, string];
    return matrix.flatMap((row, i) => row.map((value, j): SankeyLink => ({ source: segments[i]!, sourceStage, target: segments[j]!, targetStage, value })));
  }),
  nodes: [{ id: 'gold', label: 'Gold' }, { id: 'silver', label: 'Silver' }, { id: 'bronze', label: 'Bronze' }, { id: 'lapsed', label: 'Lapsed' }],
  stages: [{ id: 'jan', label: 'January' }, { id: 'feb', label: 'February' }, { id: 'mar', label: 'March' }, { id: 'apr', label: 'April' }],
};

const sixStages: SankeyData = {
  links: [
    { source: 'leads', target: 'qualified', value: 900 }, { source: 'leads', target: 'dropped', value: 600 },
    { source: 'qualified', target: 'demo', value: 520 }, { source: 'qualified', target: 'dropped', value: 380 },
    { source: 'demo', target: 'proposal', value: 300 }, { source: 'demo', target: 'dropped', value: 220 },
    { source: 'proposal', target: 'negotiation', value: 180 }, { source: 'proposal', target: 'lost', value: 120 },
    { source: 'negotiation', target: 'won', value: 110 }, { source: 'negotiation', target: 'lost', value: 70 },
  ],
  nodes: [
    { id: 'leads', label: 'Leads' }, { id: 'qualified', label: 'Qualified' }, { id: 'demo', label: 'Demo' }, { id: 'proposal', label: 'Proposal' },
    { id: 'negotiation', label: 'Negotiation' }, { id: 'won', label: 'Won', colorRole: 'good' }, { id: 'lost', label: 'Lost' }, { id: 'dropped', label: 'Dropped out' },
  ],
};

const frame = (title: string): SankeyOptions => ({ title, source: 'Illustrative data' });

export const fixtures: Fixture<SankeyData, SankeyOptions>[] = [
  {
    id: 'channel-journeys',
    title: 'Channel to landing page to outcome: stage headers, two small channels folded into Others and listed in the note',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'search' } },
    data: journeys,
    options: { ...frame('Search brings the most visits that end in a purchase'), unit: 'k visits', notes: { show: ['note', 'disclosure'] }, size: { width: 960, height: 560 } },
  },
  {
    id: 'budget-departments',
    title: 'Budget to departments to cost types, links coloured by target',
    kind: 'example',
    data: budget,
    options: { ...frame('Staff costs take two thirds of the operating budget'), unit: '$m', linkColor: 'target', nodeValue: 'value-share' },
  },
  {
    id: 'segment-migration',
    title: 'Customers moving between segments month to month: stage-qualified nodes, one segment order in every month',
    kind: 'example',
    data: migration,
    options: { ...frame('Most customers stay in their segment from month to month'), unit: 'customers' },
  },
  {
    id: 'sales-stages',
    title: 'Six stages with drop-outs that skip columns as long links',
    kind: 'torture',
    data: sixStages,
    options: { ...frame('One lead in fourteen becomes a won deal') },
  },
  {
    id: 'long-names-phone',
    title: 'Long node names on a 280 px phone card: names wrap and break with a hyphen',
    kind: 'torture',
    data: {
      links: [
        { source: 'a', target: 'c', value: 300 }, { source: 'a', target: 'd', value: 120 },
        { source: 'b', target: 'c', value: 80 }, { source: 'b', target: 'd', value: 210 },
      ],
      nodes: [
        { id: 'a', label: 'Infrastructureinvestments' }, { id: 'b', label: 'Regional development programmes' },
        { id: 'c', label: 'Transport networks' }, { id: 'd', label: 'Telecommunications' },
      ],
    },
    options: { ...frame('Most investment goes to transport'), unit: '$m', size: { width: 280, height: 320 } },
  },
  {
    id: 'unbalanced-nodes',
    title: 'Nodes whose inflow and outflow differ, duplicate rows that add up and a zero row',
    kind: 'torture',
    data: {
      links: [
        { source: 'import', target: 'warehouse', value: 500 }, { source: 'local', target: 'warehouse', value: 200 },
        { source: 'warehouse', target: 'stores', value: 380 }, { source: 'warehouse', target: 'stores', value: 120 },
        { source: 'warehouse', target: 'online', value: 140 }, { source: 'local', target: 'online', value: 0 },
      ],
    },
    options: { ...frame('A tenth of the stock stays in the warehouse'), unit: 'pallets' },
  },
  {
    id: 'cycle-refused',
    title: 'Refusal example: links that loop back without stages',
    kind: 'torture',
    refuses: { code: 'sankey-cycle' },
    data: { links: [{ source: 'gold', target: 'silver', value: 10 }, { source: 'silver', target: 'gold', value: 4 }] },
  },
  {
    id: 'stage-backward-refused',
    title: 'Refusal example: a stage-qualified link that runs backward',
    kind: 'torture',
    refuses: { code: 'sankey-stage-backward' },
    data: {
      links: [{ source: 'gold', sourceStage: 'feb', target: 'silver', targetStage: 'jan', value: 10 }],
      stages: [{ id: 'jan' }, { id: 'feb' }],
    },
  },
];

registerFixtures('sankey', fixtures);
