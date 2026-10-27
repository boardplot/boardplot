/**
 * PVM fixtures. Quantities are counted in the declared `quantityUnit`; revenue
 * is in the declared display unit, and price is DERIVED from the pair — never
 * authored, so the endpoints always reconcile.
 *
 * Every message title here cites ONLY marks the reader can see: the effect bars
 * and the two endpoint columns. A title that names an item the exhibit never
 * shows, such as a product line, cannot be checked against the ink.
 * Item-level attribution lives in `derived.contributions`, not in the title.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { PvmData, PvmOptions } from './types';

// Magnitudes are chosen so that EVERY effect bar is legible, not just the two
// big ones. A bridge from 178,000 to 189,150 is a 6% swing on a
// full-height opening column and draws Volume at 0.54px and Mix at 3.48px.
// An example fixture is what a reader judges the family on, so a
// hairline there is a claim that the family cannot draw its own subject.
const productPortfolio: PvmData = {
  quantityUnit: 'licences',
  items: [
    { id: 'core', label: 'Core platform', prior: { qty: 1000, revenue: 24000 }, current: { qty: 1150, revenue: 31050 } },
    { id: 'analytics', label: 'Analytics add-on', prior: { qty: 600, revenue: 9000 }, current: { qty: 700, revenue: 11550 } },
    { id: 'support', label: 'Support plans', prior: { qty: 2000, revenue: 8000 }, current: { qty: 2400, revenue: 10080 } },
    { id: 'legacy', label: 'Legacy licences', prior: { qty: 250, revenue: 12000 }, current: { qty: 140, revenue: 6300 } },
    { id: 'assistants', label: 'Assistants', prior: { qty: 0, revenue: 0 }, current: { qty: 500, revenue: 7000 } },
    { id: 'appliance', label: 'On-prem appliance', prior: { qty: 60, revenue: 4200 }, current: { qty: 0, revenue: 0 } },
  ],
};

const regionPortfolio: PvmData = {
  quantityUnit: 'contracts',
  items: [
    { id: 'dach', label: 'DACH', prior: { qty: 1000, revenue: 20000 }, current: { qty: 1100, revenue: 25300 } },
    { id: 'nordics', label: 'Nordics', prior: { qty: 500, revenue: 6000 }, current: { qty: 560, revenue: 7560 } },
    { id: 'benelux', label: 'Benelux', prior: { qty: 400, revenue: 4000 }, current: { qty: 900, revenue: 10800 } },
    { id: 'iberia', label: 'Iberia', prior: { qty: 300, revenue: 7500 }, current: { qty: 120, revenue: 2640 } },
    { id: 'latam', label: 'LATAM', prior: { qty: 0, revenue: 0 }, current: { qty: 400, revenue: 6000 } },
    { id: 'cee', label: 'CEE', prior: { qty: 250, revenue: 4500 }, current: { qty: 0, revenue: 0 } },
  ],
};

export const fixtures: Fixture<PvmData, PvmOptions>[] = [
  {
    id: 'fy-revenue-bridge',
    title: 'FY24→FY25 product revenue bridge (six products, one new, one discontinued)',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'volume' } },
    data: productPortfolio,
    options: {
      // The method footer needs more than a slide height leaves over the 0.60
      // plot floor; a4 carries it.
      size: { width: 720, height: 511 },
      title: 'Revenue grew $8.8m: volume and new items added $14.4m, and adverse mix gave back $6.0m',
      subtitle: { company: 'Acme Software', measure: 'Product revenue', period: 'FY24 → FY25' },
      unit: '$k',
      source: 'Acme ERP order book; units and revenue per product, price derived',
      // A teaching bridge names its convention and counting unit. The effects
      // take their sign's colour, so the bridge sets no highlight.
      methodNote: true,
    },
  },
  {
    id: 'segment-pvm-interaction-split',
    title: 'Regional bridge with the price x volume interaction shown separately',
    kind: 'example',
    data: regionPortfolio,
    options: {
      // The method footer needs more than a slide height leaves over the 0.60
      // plot floor; a4 carries it.
      size: { width: 720, height: 511 },
      interaction: 'separate',
      title: 'Revenue grew $10.3m: price added $3.7m at prior-year volumes, plus $1.9m where price and volume moved together',
      subtitle: { company: 'Acme Software', measure: 'Revenue by region', period: 'FY24 → FY25' },
      unit: '$k',
      source: 'Acme ERP order book; units and revenue per region, price derived',
      // The note says what "Laspeyres" and the joint bar mean.
      methodNote: true,
    },
  },
  {
    id: 'mix-dominates-sign-flip',
    title:
      'Torture: mix and volume are near-equal opposites, one quantity falls three orders of magnitude, and a line carries negative revenue',
    kind: 'torture',
    data: {
      // Volume and Mix nearly cancel here, so the split between them
      // rests on the counting unit, and the teaching note names it. Every
      // line is counted in units shipped. The undeclared-unit guard
      // (pvm-quantity-unit-undeclared) is covered in tests/pvm.test.ts.
      quantityUnit: 'units shipped',
      items: [
        // Three orders of magnitude of quantity movement on the commodity line.
        { id: 'bulk', label: 'Bulk appliances', prior: { qty: 200000, revenue: 400000 }, current: { qty: 100, revenue: 205 } },
        { id: 'premium', label: 'Premium module', prior: { qty: 200, revenue: 60000 }, current: { qty: 1500, revenue: 390000 } },
        // Negative revenue at positive quantity: service credits carried as a
        // line item. The decomposition stays exact; mix reads oddly, and says so.
        { id: 'credits', label: 'Service credits', prior: { qty: 50, revenue: -2000 }, current: { qty: 40, revenue: -1680 } },
        { id: 'hardware', label: 'Retired hardware', prior: { qty: 300, revenue: 160000 }, current: { qty: 0, revenue: 0 } },
        { id: 'pilot', label: 'Pilot programme', prior: { qty: 0, revenue: 0 }, current: { qty: 25, revenue: 5000 } },
      ],
    },
    options: {
      // NO labelPlacements. The default order volume>mix>price>new>lost keeps
      // the running level above zero, and it is the OPTIMUM of all 120
      // orderings of this bridge (9 orders tie it): min effect bar 1.48px ·
      // effect ink 332.1px · 0 hidden value labels.
      //   the 30 orderings that cross zero, all of them:
      //     min effect bar 1.29px · effect ink 290.6px · 1-2 hidden labels
      //     (30/30 hide at least one)
      //   the 90 orderings that do not cross: 0 hidden labels, but effect ink
      //     ranges 193.7px-332.1px, so the default is at the top of that range.
      // The zero crossing costs ~13% of the effect ink and ~13% of the vertical
      // resolution of every bar. The below-baseline path belongs in a test, not
      // in a degraded shipped exhibit.
      title:
        'Revenue fell $224.5m: the volume effect took out $454.2m and lost items $160.0m, against a $444.8m mix gain',
      subtitle: { company: 'Acme Hardware', measure: 'Revenue', period: 'FY24 → FY25' },
      unit: '$k',
      source: 'Illustrative stress dataset',
      // The method footer needs more than a slide height leaves over the 0.60
      // plot floor; a4 carries it.
      size: { width: 720, height: 511 },
    },
  },
];

fixtures.push({
  ...fixtures[0]!,
  id: 'fy-revenue-combined-volume-mix',
  title: 'FY24 to FY25 revenue bridge with volume and mix combined',
  options: {
    ...fixtures[0]!.options!,
    volumeMix: 'combined',
    title: 'Revenue rises $8.8m; combined volume and mix adds $1.4m',
  },
});

fixtures.push({
  ...fixtures[0]!,
  id: 'dated-revenue-growth',
  title: 'Revenue grows 7.4% annually between two dated totals',
  data: { ...productPortfolio, priorDate: '2021-12-31', currentDate: '2023-12-31', priorLabel: 'FY21', currentLabel: 'FY23' },
  options: {
    ...fixtures[0]!.options!, size: { width: 1000, height: 562 },
    title: 'Revenue grows $8.8m, or 7.4% a year',
    subtitle: { measure: 'Product revenue', period: 'FY21 to FY23' },
    source: 'Illustrative product portfolio, quantities and revenue by period',
    annotations: [{ id: 'growth', kind: 'cagr', from: 'prior', to: 'current' }],
  },
});

// Coverage: the decomposition convention stated.
const revenueBridge = fixtures.find((fixture) => fixture.id === 'fy-revenue-bridge')!;
fixtures.push({
  ...revenueBridge,
  id: 'revenue-bridge-method-note',
  title: 'The revenue bridge with the method notes printed',
  tags: ['coverage'],
  options: {
    ...revenueBridge.options,
    methodNote: true,
    // The PNG font has no arrow glyph; the method note repeats the period.
    subtitle: { company: 'Acme Software', measure: 'Product revenue', period: 'FY24 to FY25' },
  },
});

// Footer rule: a slide keeps only the source line and
// the pointer, and the notes list holds the method notes for a backup slide.
fixtures.push({
  ...revenueBridge,
  id: 'revenue-bridge-notes-listed',
  title: 'The revenue bridge on a slide with its method notes in the notes list',
  tags: ['coverage'],
  options: {
    ...revenueBridge.options,
    methodNote: true,
    target: 'slide',
    subtitle: { company: 'Acme Software', measure: 'Product revenue', period: 'FY24 to FY25' },
    notes: { placement: 'list' },
  },
});

fixtures.push({
  id: 'named-periods-and-ranges', title: 'PVM names each period and entry or exit range', kind: 'torture',
  data: { priorLabel: 'Earlier period', currentLabel: 'Later period', quantityUnit: 'units', items: [
    { id: 'common', prior: { qty: 10, revenue: 10000 }, current: { qty: 12, revenue: 13200 } },
    { id: 'entry', prior: { qty: 0, revenue: 0 }, current: { qty: 4, revenue: 4800 } },
    { id: 'exit', prior: { qty: 3, revenue: 2400 }, current: { qty: 0, revenue: 0 } },
  ] },
  options: { title: 'Entry and exit bars reconcile a $5.6m revenue change', unit: '$k', strings: { newItems: 'Entries', lostItems: 'Exits' }, size: { width: 1000 } },
});
registerFixtures('pvm', fixtures);
