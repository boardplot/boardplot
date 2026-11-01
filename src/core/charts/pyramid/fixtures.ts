/** Population-pyramid fixtures. Two examples, one torture case. */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { PyramidData, PyramidOptions } from './types';

/**
 * Germany, 2023, rounded to thousands. Eighteen five-year bands plus an open
 * 85+ — the canonical shape, and the one that makes the ordering inversion
 * visible: authored ascending, drawn youngest-at-the-bottom.
 */
/** 17 closed bands (0-4 … 80-84); the open 85+ is the 18th. */
const DE_MALE = [
  1875, 1980, 2010, 2115, 2450, 2570, 2610, 2665, 2915, 3350, 3290, 2905, 2540, 2450, 2250, 1720,
  1180,
];
const DE_FEMALE = [
  1780, 1880, 1905, 1990, 2255, 2380, 2455, 2545, 2810, 3255, 3225, 2895, 2560, 2530, 2400, 1950,
  1520,
];
const DE_OPEN: [number, number] = [690, 1520];

/** Consulting-relevant: tenure in two-year bands, read as shares of the firm. */
const TENURE_WOMEN = [420, 355, 268, 196, 132, 84, 47, 26];
const TENURE_MEN = [388, 341, 289, 241, 205, 168, 131, 96];

/**
 * 22 bands, one of them empty in both groups, an open top band carrying ~12%
 * of the population, one group roughly 10x the other, and band labels long
 * enough to fight the centre column.
 */
const TORTURE_BANDS = Array.from({ length: 21 }, (_, i) => ({
  id: `b${i}`,
  from: i * 3,
  to: (i + 1) * 3,
  label: `${i * 3} to ${(i + 1) * 3 - 1}`,
}));
const TORTURE_MAJOR = [
  4200, 4050, 3900, 3700, 3500, 3300, 3100, 2900, 0, 2500, 2300, 2100, 1900, 1700, 1500, 1300,
  1100, 900, 700, 500, 300,
];
const TORTURE_MINOR = [
  420, 405, 390, 370, 350, 330, 310, 290, 0, 250, 230, 210, 190, 170, 150, 130, 110, 90, 70, 50, 30,
];

export const fixtures: Fixture<PyramidData, PyramidOptions>[] = [
  {
    id: 'germany-age-structure',
    // Measured off the shipped arrays, not asserted from memory: ranked by
    // band total, 45–49 is 6,605 and 50–54 is 6,515, ahead of 55–59 at 5,800.
    // The real German boomer bulge is 55–64, but not in THESE numbers, so the
    // title names 45–54: the title follows the data.
    title: 'A barrel, not a pyramid: the 45–54 cohorts are the widest rows',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'a85', seriesId: 'm' } },
    data: {
      bands: [
        ...Array.from({ length: 17 }, (_, i) => ({
          id: `a${i * 5}`,
          from: i * 5,
          to: i * 5 + 5,
          label: `${i * 5}–${i * 5 + 4}`,
        })),
        { id: 'a85', from: 85, label: '85+' },
      ],
      groups: [
        { id: 'm', label: 'Men', values: [...DE_MALE, DE_OPEN[0]] },
        { id: 'f', label: 'Women', values: [...DE_FEMALE, DE_OPEN[1]] },
      ],
    },
    options: {
      // 18 rows need the height: at the 540px default the row band is ~14px
      // and the solver drops eight value labels to collisions. A fixture that
      // ships hidden numbers is a fixture that teaches the wrong canvas.
      size: { width: 960, height: 539 },
      title: 'A mature European age structure, by sex',
      subtitle: { measure: 'Population', period: '2023' },
      unit: 'thousands',
      // NOT an official series, and the source does not claim to be one: the
      // arrays are invented. A fixture is a worked example an agent copies, so
      // a named source it cannot reproduce is the same defect as a title its
      // data contradicts.
      source: 'Stylised five-year age profile — illustrative, not an official statistical series',
    },
  },
  {
    id: 'workforce-tenure-gender',
    title: 'Women outnumber men below four years of tenure and are outnumbered above ten',
    kind: 'example',
    data: {
      bands: Array.from({ length: 8 }, (_, i) => ({
        id: `t${i * 2}`,
        from: i * 2,
        to: i * 2 + 2,
        label: `${i * 2}–${i * 2 + 2} yrs`,
      })),
      groups: [
        { id: 'w', label: 'Women', values: TENURE_WOMEN },
        { id: 'm', label: 'Men', values: TENURE_MEN },
      ],
    },
    options: {
      basis: 'shareOfTotal',
      title: 'Women form a smaller share of the long-tenure workforce',
      subtitle: { measure: 'Headcount', period: 'FY25' },
      source: 'HR extract, all offices',
    },
  },
  {
    id: 'torture-pyramid-degenerate',
    title: '22 bands, one empty in both groups, a 10:1 group imbalance and an open top band',
    kind: 'torture',
    data: {
      bands: [
        ...TORTURE_BANDS,
        { id: 'b21', from: 63, label: '63 and above' },
      ],
      groups: [
        {
          id: 'major',
          label: 'Framework agreements',
          values: [...TORTURE_MAJOR, 5900],
        },
        {
          id: 'minor',
          label: 'Single-project engagements',
          values: [...TORTURE_MINOR, 590],
        },
      ],
    },
    options: {
      // 22 rows. The shared 55-character stem heads the chart in the subtitle,
      // and each row names its interval alone. Every label places at this
      // size, which is the point: the torture is the geometry, not a page of
      // dropped text.
      size: { width: 1260, height: 653 },
      title: 'Contract cohorts, torture case',
      subtitle: { measure: 'Contracts by years since first contract signature' },
    },
  },
];

fixtures.push({
  id: 'dated-population-comparison',
  title: 'Growth within the same age band across two observation dates',
  kind: 'example',
  data: {
    bands: [
      { id: 'young', from: 0, to: 20, label: '0 to 19' },
      { id: 'adult', from: 20, to: 40, label: '20 to 39' },
      { id: 'older', from: 40, to: 60, label: '40 to 59' },
    ],
    groups: [
      { id: 'before', label: 'FY21', date: '2021-12-31', values: [100, 120, 80] },
      { id: 'after', label: 'FY23', date: '2023-12-31', values: [144, 150, 100] },
    ],
  },
  options: {
    size: { width: 1000, height: 500 },
    // The one fixture that shows the band convention note.
    methodNote: true,
    title: 'Residents aged under 20 grew 20% a year',
    subtitle: { measure: 'Residents by age band', period: 'FY21 to FY23' },
    source: 'Illustrative town population snapshots',
    annotations: [
      { id: 'growth', kind: 'cagr', from: { categoryId: 'young', seriesId: 'before' }, to: { categoryId: 'young', seriesId: 'after' } },
      { id: 'gap', kind: 'diff', mode: 'absolute', from: { categoryId: 'adult', seriesId: 'before' }, to: { categoryId: 'adult', seriesId: 'after' } },
    ],
  },
});

const dated = fixtures[fixtures.length - 1]!;
fixtures.push({
  ...dated,
  id: 'dated-share-difference',
  title: 'Each snapshot is its own 100%, and a difference between shares is measured in percentage points',
  options: {
    ...dated.options!, basis: 'shareOfTotal',
    title: 'The age-20-to-39 share fell by 1.9 percentage points',
    annotations: [{ id: 'gap', kind: 'diff', mode: 'absolute', from: { categoryId: 'adult', seriesId: 'before' }, to: { categoryId: 'adult', seriesId: 'after' }, text: 'FY21 to FY23: ${value}' }],
  },
});

registerFixtures('pyramid', fixtures);
