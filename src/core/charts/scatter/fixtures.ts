/**
 * Scatter fixtures — examples
 * (price-vs-quality brand scatter with every point labeled; sector bubble
 * portfolio with legend + quadrant zero lines); torture set covers 40-point
 * label thinning, tight clusters forcing the spiral outward, 350 points
 * auto-disabling labels, negative x/y quadrants with scenario markers, and
 * mixed zero/missing bubble sizes. Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { ScatterData } from '../../types/data';
import type { ScatterStrategyOptions } from './types';

/** Deterministic pseudo-scatter (no RNG): lattice-hash coordinates. */
function generated(n: number, prefix: string): ScatterData {
  return {
    points: Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i + 1}`,
      label: `U${i + 1}`,
      x: ((i * 37) % 101) + (i % 7) / 10,
      y: ((i * 53) % 97) + (i % 5) / 10,
    })),
  };
}

export const fixtures: Fixture<ScatterData, ScatterStrategyOptions>[] = [
  {
    id: 'price-quality-brands',
    title: 'Brand scatter: price vs perceived quality, every point labeled',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { pointId: 'a' } },
    data: {
      groups: [
        { id: 'value', label: 'Value brands' },
        { id: 'premium', label: 'Premium brands' },
      ],
      points: [
        { id: 'a', group: 'value', label: 'Brand A', x: 3.2, y: 2.1 },
        { id: 'b', group: 'value', label: 'Brand B', x: 4.2, y: 3.6 },
        { id: 'c', group: 'value', label: 'Brand C', x: 4.8, y: 3.2 },
        { id: 'd', group: 'value', label: 'Brand D', x: 5.0, y: 4.0 },
        { id: 'e', group: 'value', label: 'Brand E', x: 5.5, y: 3.8 },
        { id: 'f', group: 'value', label: 'Brand F', x: 6.2, y: 4.4 },
        { id: 'g', group: 'premium', label: 'Brand G', x: 6.8, y: 5.2 },
        { id: 'h', group: 'premium', label: 'Brand H', x: 7.0, y: 5.6 },
        { id: 'i', group: 'premium', label: 'Brand I', x: 7.4, y: 6.1 },
        { id: 'j', group: 'premium', label: 'Brand J', x: 8.4, y: 7.2 },
      ],
    },
    options: {
      title: 'Price tracks quality across value and premium brands',
      subtitle: {
        company: 'Apparel market',
        measure: 'Price index vs perceived quality',
        period: '2026 brand tracker',
      },
      unit: 'index 0–10',
      axisTitles: { x: 'Price index', y: 'Perceived quality' },
      source: 'Illustrative brand tracker, 10 invented brands',
      legend: 'bottom',
      // One point is selected, through color.focus; the groups keep the
      // series ramp instead of one of them taking the accent.
      highlight: 'j',
    },
  },
  {
    id: 'price-volume-trend',
    title: 'Scatter with a least-squares trend line; the key prints its slope and r²',
    kind: 'example',
    data: {
      points: [
        { id: 'alpine', label: 'Alpine', x: 82, y: 148 },
        { id: 'brava', label: 'Brava', x: 88, y: 131 },
        { id: 'corsa', label: 'Corsa', x: 91, y: 139 },
        { id: 'dolomit', label: 'Dolomit', x: 95, y: 118 },
        { id: 'etna', label: 'Etna', x: 98, y: 112 },
        { id: 'fjord', label: 'Fjord', x: 100, y: 104 },
        { id: 'garda', label: 'Garda', x: 103, y: 109 },
        { id: 'hekla', label: 'Hekla', x: 106, y: 92 },
        { id: 'ischia', label: 'Ischia', x: 110, y: 88 },
        { id: 'juist', label: 'Juist', x: 114, y: 79 },
        { id: 'karst', label: 'Karst', x: 118, y: 83 },
        { id: 'lago', label: 'Lago', x: 124, y: 66 },
      ],
    },
    options: {
      title: 'Higher price goes with lower volume in this panel',
      subtitle: { company: 'Brevinth Beverages', measure: 'Price index vs volume index', period: 'FY26' },
      axisTitles: { x: 'Price index (market = 100)', y: 'Volume index (market = 100)' },
      trend: { label: 'Linear trend' },
      source: 'Illustrative SKU panel, 12 SKUs',
    },
  },
  {
    id: 'price-quality-trend-by-tier',
    title: 'One least-squares trend line per group, each in its group colour',
    kind: 'example',
    data: {
      groups: [
        { id: 'value', label: 'Value brands' },
        { id: 'premium', label: 'Premium brands' },
      ],
      points: [
        { id: 'a', group: 'value', label: 'Brand A', x: 3.2, y: 2.1 },
        { id: 'b', group: 'value', label: 'Brand B', x: 4.2, y: 3.6 },
        { id: 'c', group: 'value', label: 'Brand C', x: 4.8, y: 3.2 },
        { id: 'd', group: 'value', label: 'Brand D', x: 5.0, y: 4.0 },
        { id: 'e', group: 'value', label: 'Brand E', x: 5.5, y: 3.8 },
        { id: 'f', group: 'value', label: 'Brand F', x: 6.2, y: 4.4 },
        { id: 'g', group: 'premium', label: 'Brand G', x: 6.8, y: 5.2 },
        { id: 'h', group: 'premium', label: 'Brand H', x: 7.0, y: 5.6 },
        { id: 'i', group: 'premium', label: 'Brand I', x: 7.4, y: 6.1 },
        { id: 'j', group: 'premium', label: 'Brand J', x: 8.4, y: 7.2 },
      ],
    },
    options: {
      title: 'Among premium brands each price point buys more perceived quality',
      subtitle: { company: 'Apparel market', measure: 'Price index vs perceived quality', period: '2026 brand tracker' },
      unit: 'index 0–10',
      axisTitles: { x: 'Price index', y: 'Perceived quality' },
      trend: { groups: 'each' },
      legend: 'bottom',
      source: 'Illustrative brand tracker, 10 invented brands',
    },
  },
  {
    id: 'portfolio-bubbles',
    title: 'Bubble portfolio: ROC vs revenue CAGR, bubble = revenue, sector groups',
    kind: 'example',
    data: {
      groups: [
        { id: 'energy', label: 'Energy' },
        { id: 'mining', label: 'Mining' },
        { id: 'logistics', label: 'Logistics', colorRole: 'others' },
      ],
      points: [
        { id: 'nordpower', group: 'energy', label: 'NordPower', x: 6, y: 12, size: 8.4 },
        { id: 'marenholt', group: 'energy', label: 'Marenholt Energy', x: 9, y: 14, size: 5.2 },
        { id: 'solvaren', group: 'energy', label: 'Solvaren', x: 18, y: 16, size: 2.1 },
        { id: 'voltstream', group: 'energy', label: 'VoltStream', x: 12, y: 9, size: 3.8 },
        { id: 'ferrox', group: 'mining', label: 'Ferrox', x: 2, y: 7, size: 6.5 },
        { id: 'cuprico', group: 'mining', label: 'CupriCo', x: -3, y: 4, size: 4.9 },
        { id: 'boreal', group: 'mining', label: 'Boreal Mining', x: 4, y: 11, size: 3.2 },
        { id: 'transarc', group: 'logistics', label: 'TransArc', x: -6, y: -2, size: 7.8 },
        { id: 'carrier-a', group: 'logistics', label: 'Carrier A', x: -1, y: 1, size: 6.1 },
        { id: 'portnexus', group: 'logistics', label: 'PortNexus', x: 3, y: 3, size: 2.7 },
        { id: 'swifthaul', group: 'logistics', label: 'SwiftHaul', x: 8, y: 5, size: 1.9 },
        { id: 'railbridge', group: 'logistics', label: 'RailBridge', x: -4, y: 2, size: 3.4 },
        { id: 'aerofreight', group: 'logistics', label: 'AeroFreight', x: 14, y: 7, size: 1.2 },
      ],
    },
    options: {
      title: 'Energy carries the portfolio: growth and returns concentrate in three assets',
      subtitle: {
        company: 'Brevinth Holdings',
        measure: 'Return on capital vs 3Y revenue CAGR',
        period: 'FY23–FY26',
      },
      unit: '%',
      axisTitles: { x: '3Y revenue CAGR, %', y: 'Return on capital, %' },
      // Each bubble prints its revenue pool: inside where it fits, else beside.
      labels: { value: true },
      source: 'Brevinth portfolio review',
      sizeLegend: { label: 'Revenue pool, $bn' },
      // Keys sit in the row above the plot.
      legend: 'top',
      highlight: 'solvaren',
      // 4:3, the catalogue's card shape: at 16:9 the bottom-left corner has
      // no seat for the TransArc callout and none for AeroFreight's value.
      // 800 wide with the key above the plot, so AeroFreight keeps its label.
      size: { width: 800, height: 600 },
    },
    annotations: [
      { kind: 'valueLine', value: 'mean', side: 'left' },
      { kind: 'callout', at: 'transarc', text: 'Divestment candidate', preferSide: 'below' },
    ],
  },
  {
    id: 'dense-40-thinning',
    title: 'Torture: 40 points — labels thin via collision, none overlap',
    kind: 'torture',
    data: generated(40, 'p'),
    options: {
      title: 'Forty points keep an overlap-free label set',
      subtitle: { measure: 'Synthetic lattice', period: 'n = 40' },
      unit: 'units',
      axisTitles: { x: 'Position across, units', y: 'Position up, units' },
    },
  },
  {
    id: 'cluster-spiral',
    title: 'Torture: three tight clusters force the label spiral outward',
    kind: 'torture',
    data: {
      points: [
        { id: 'a1', label: 'Alpha One', x: 10, y: 10 },
        { id: 'a2', label: 'Alpha Two', x: 10.2, y: 10.1 },
        { id: 'a3', label: 'Alpha Three', x: 9.8, y: 9.9 },
        { id: 'a4', label: 'Alpha Four', x: 10.1, y: 9.8 },
        { id: 'b1', label: 'Beta One', x: 50, y: 48 },
        { id: 'b2', label: 'Beta Two', x: 50.3, y: 48.2 },
        { id: 'b3', label: 'Beta Three', x: 49.7, y: 47.9 },
        { id: 'b4', label: 'Beta Four', x: 50.1, y: 48.4 },
        { id: 'c1', label: 'Gamma One', x: 88, y: 82 },
        { id: 'c2', label: 'Gamma Two', x: 88.2, y: 82.3 },
        { id: 'c3', label: 'Gamma Three', x: 87.8, y: 81.8 },
        { id: 'c4', label: 'Gamma Four', x: 88.1, y: 82.1 },
      ],
    },
    options: {
      title: 'Clustered points spiral their labels apart',
      subtitle: { measure: 'Cluster stress test' },
      unit: 'units',
      axisTitles: { x: 'Load, units', y: 'Stress, units' },
    },
  },
  {
    id: 'auto-off-350',
    title: 'Torture: 350 points auto-disable all point labels',
    kind: 'torture',
    data: generated(350, 'q'),
    options: {
      title: 'Beyond 300 points the labeler switches itself off',
      subtitle: { measure: 'Synthetic lattice', period: 'n = 350' },
      unit: 'units',
      axisTitles: { x: 'Position across, units', y: 'Position up, units' },
    },
  },
  {
    // Above 5,000 points the plain dots of each group draw as one path; the highlighted point keeps its own mark and ring.
    id: 'dense-paths-6000',
    title: 'Torture: 6,000 points in two groups draw as one path per group',
    kind: 'torture',
    data: {
      points: Array.from({ length: 6000 }, (_, i) => ({
        id: `d${i + 1}`,
        label: `U${i + 1}`,
        x: Math.round((((i * 37) % 101) + (i % 7) / 10 + (i % 13) / 13) * 10) / 10,
        y: Math.round((((i * 53) % 97) + (i % 5) / 10 + (i % 11) / 11) * 10) / 10,
        group: i % 4 === 0 ? 'Trial' : 'Paid',
      })),
    },
    options: {
      title: 'Six thousand accounts, one path per group',
      unit: 'units',
      axisTitles: { x: 'Seats, units', y: 'Usage, units' },
      highlight: ['d42'],
    },
  },
  {
    id: 'negative-quadrants',
    title: 'Torture: all four quadrants, scenario hollow markers, marker shapes',
    kind: 'torture',
    data: {
      groups: [
        { id: 'run', label: 'Run rate', marker: 'circle' },
        { id: 'plan', label: 'Plan cases', colorRole: 'neutral', marker: 'square' },
        { id: 'exit', label: 'Exit cases', colorRole: 'bad', marker: 'triangle' },
      ],
      points: [
        { id: 'q1a', group: 'run', label: 'Core DE', x: 12, y: 8 },
        { id: 'q1b', group: 'run', label: 'Core FR', x: 6, y: 14 },
        { id: 'q2a', group: 'plan', label: 'Launch PL', x: -8, y: 11, scenario: 'PL' },
        { id: 'q2b', group: 'plan', label: 'Launch RO', x: -14, y: 5, scenario: 'FC' },
        { id: 'q3a', group: 'exit', label: 'Legacy UK', x: -11, y: -7 },
        { id: 'q3b', group: 'exit', label: 'Legacy IT', x: -5, y: -12, scenario: 'PY' },
        { id: 'q4a', group: 'run', label: 'Turnaround ES', x: 9, y: -4, marker: 'diamond' },
        { id: 'q4b', group: 'exit', label: 'Wind-down AT', x: 15, y: -9 },
        { id: 'origin', label: 'Group Ø', x: 0.5, y: 0.5 },
      ],
    },
    options: {
      title: 'Quadrant view separates run-rate, launch, and exit clusters',
      subtitle: { measure: 'EBIT margin vs growth', period: 'FY26', scenarios: ['AC', 'PL', 'FC'] },
      unit: '%',
      axisTitles: { x: 'Revenue growth, %', y: 'EBIT margin, %' },
      legend: 'bottom',
    },
  },
  {
    id: 'bubble-size-edge-cases',
    title: 'Torture: diameter sizing with zero, missing, and invalid sizes',
    kind: 'torture',
    data: {
      points: [
        { id: 'big', label: 'Anchor asset', x: 20, y: 30, size: 100 },
        { id: 'mid', label: 'Mid asset', x: 40, y: 55, size: 36 },
        { id: 'zero', label: 'Zero size', x: 60, y: 20, size: 0 },
        { id: 'missing', label: 'No size', x: 70, y: 60 },
        { id: 'negative', label: 'Bad size', x: 30, y: 70, size: -5 },
        { id: 'ghost', label: 'Label only', x: 55, y: 40, marker: 'none' },
        { id: 'tiny', label: 'Tiny', x: 25, y: 12, size: 1 },
      ],
    },
    options: {
      sizeBy: 'diameter',
      title: 'Degenerate bubble sizes stay visible and overlap-free',
      subtitle: { measure: 'Size edge cases' },
      unit: 'units',
      axisTitles: { x: 'Coverage, units', y: 'Score, units' },
      sizeLegend: { label: 'Size, units' },
    },
  },
  {
    id: 'zoom-preserves-bubble-size', title: 'Zoom retains source means and bubble sizing', kind: 'torture', tags: ['interaction'],
    data: { points: [20,30,40,50,95].map((y, i) => ({ id: `p${i}`, label: `P${i}`, x: i, y, size: i + 1 })) },
    options: { title: 'Zoom retains source means and bubble sizing', viewDomain: { x: [0.9,3.1], y: [28,52] },
      axisTitles: { x: 'Period index', y: 'Score, points' }, sizeLegend: { label: 'Size, units' } },
  },
  {
    // Two flagships earn ten times the median store, and plotting them
    // honestly squeezes the other eleven into the bottom sixth of the frame.
    // The clamp caps the axis at 25,000 and draws those two at the edge as open
    // markers; three pop-up sites with too few transactions to compare leave
    // through minCount. Both footnotes are counted by the engine, and both
    // flagships keep their real revenue in the point records and the receipt.
    id: 'scatter-clamped',
    title: 'Outliers clipped at the axis edge, thin sites dropped by count',
    kind: 'example',
    data: {
      points: [
        { id: 'north-station', label: 'North Station', x: 1280, y: 41200, count: 612 },
        { id: 'airport', label: 'Airport', x: 1140, y: 33800, count: 540 },
        { id: 'central-station', label: 'Central Station', x: 980, y: 22400, count: 470 },
        { id: 'west-mall', label: 'West Mall', x: 860, y: 18600, count: 410 },
        { id: 'old-town', label: 'Old Town', x: 760, y: 16900, count: 355 },
        { id: 'university', label: 'University', x: 720, y: 12400, count: 318 },
        { id: 'retail-park', label: 'Retail Park', x: 620, y: 11200, count: 286 },
        { id: 'north-suburb', label: 'North Suburb', x: 540, y: 9800, count: 244 },
        { id: 'east-suburb', label: 'East Suburb', x: 505, y: 8700, count: 219 },
        { id: 'harbour', label: 'Harbour', x: 470, y: 7900, count: 190 },
        { id: 'business-park', label: 'Business Park', x: 390, y: 6900, count: 171 },
        { id: 'village', label: 'Village', x: 360, y: 5600, count: 132 },
        { id: 'outlet', label: 'Outlet', x: 300, y: 4600, count: 118 },
        { id: 'fair-popup', label: 'Fair Pop-up', x: 210, y: 3100, count: 41 },
        { id: 'expo-popup', label: 'Expo Pop-up', x: 180, y: 2600, count: 33 },
        { id: 'kiosk-pilot', label: 'Kiosk Pilot', x: 150, y: 1900, count: 22 },
      ],
    },
    options: {
      title: 'Two flagship stores earn above the plotted range',
      subtitle: { measure: 'Revenue per week' },
      unit: '$',
      axisTitles: { x: 'Visitors per week', y: 'Revenue per week' },
      valueAxis: { clamp: { max: 25000 } },
      minCount: 50,
      source: 'Illustrative data',
    },
  },
];

/**
 * Torture lattice for the quadrant preset: 38 long-labelled units on a
 * deterministic hash lattice plus one exactly coincident pair. Point u1 lands
 * on x = 5, the smallest plotted x and exactly where the torture fixture puts
 * its x cut point: every unit is therefore on the cut point or right of it, and
 * the on-threshold tie rule decides the whole exhibit.
 */
function quadrantTorture(): ScatterData {
  const names = [
    'Holding Company Alpha',
    'Industrial Company Beta',
    'Logistics Company Gamma',
    'Chemicals Company Delta',
    'Retail Company Epsilon',
    'Materials Company Zeta',
    'Shipping Company Eta',
  ];
  const points = Array.from({ length: 38 }, (_, i) => ({
    id: `u${i + 1}`,
    label: `${names[i % names.length]} ${i + 1}`,
    x: ((i * 37) % 101) + (i % 7) / 10 + 5,
    y: ((i * 53) % 97) / 2 + (i % 5) / 10,
  }));
  points.push({ id: 'twin-a', label: 'Coincident Holdings A', x: 53, y: 24 });
  points.push({ id: 'twin-b', label: 'Coincident Holdings B', x: 53, y: 24 });
  return { points };
}

fixtures.push(
  {
    id: 'growth-share-matrix',
    title: 'Strategy matrix: growth-share with declared cut points at 1.0x share and 8% growth',
    kind: 'example',
    data: {
      points: [
        { id: 'cloud', label: 'Cloud Services', x: 1.6, y: 22, size: 410 },
        { id: 'industrial', label: 'Industrial Systems', x: 1.2, y: 9, size: 540 },
        { id: 'payments', label: 'Payments', x: 0.6, y: 17, size: 150 },
        { id: 'retail', label: 'Nordic Retail', x: 2.4, y: 3, size: 820 },
        { id: 'hardware', label: 'Legacy Hardware', x: 0.35, y: 1, size: 260 },
      ],
    },
    options: {
      // The header and footer grow the furniture band past the 0.60 plot
      // floor at the standard height; the a4 ratio (1.41) restores it.
      size: { width: 778, height: 552 },
      // The one fixture that shows the quadrant and axis method notes.
      methodNote: true,
      title: 'Two stars and one question mark; the cash cow leads on revenue',
      subtitle: {
        company: 'Brevinth Holdings',
        measure: 'Relative market share vs market growth',
        period: 'FY26 plan',
      },
      unit: 'x share / % growth',
      // The orientation note prints unnumbered, so the x title carries no "1)" either.
      axisTitles: { x: 'Relative market share (×)', y: 'Market growth, %' },
      sizeLegend: { label: 'FY26 revenue, $m' },
      source: 'Group strategy review; bubble area = FY26 revenue in $m',
      // The 1970 growth-share drawing mirrors the share axis (high share on the LEFT).
      // Boardplot refuses reversed axes here, so the boxes sit mirror-image to
      // the textbook picture while the CLASSIFICATION is identical — quadrant
      // membership is scale-invariant. Said out loud rather than left for the
      // reader to trip over.
      footnotes: [
        'Share increases to the right, so Stars sit top-right; the classic growth-share drawing mirrors this axis. Membership is unaffected — only the picture is mirrored.',
      ],
      quadrants: {
        x: 1,
        y: 8,
        labels: {
          tl: 'Question marks',
          tr: 'Stars',
          bl: 'Dogs',
          br: 'Cash cows',
        },
        tint: 'alternating',
        captionPlacement: 'corner',
        // short axis names give the one-line method note.
        axisNames: { x: 'share', y: 'growth' },
      },
    },
  },
  {
    id: 'risk-impact-likelihood',
    title: 'Strategy matrix: 12 risks split at the median of both ratings (even n)',
    kind: 'example',
    data: {
      points: [
        { id: 'r01', label: 'FX exposure', x: 4, y: 3 },
        { id: 'r02', label: 'Key-supplier default', x: 2, y: 5 },
        { id: 'r03', label: 'Cyber intrusion', x: 3, y: 5 },
        { id: 'r04', label: 'Talent attrition', x: 5, y: 2 },
        { id: 'r05', label: 'Regulatory change', x: 3, y: 4 },
        { id: 'r06', label: 'Plant outage', x: 1, y: 5 },
        { id: 'r07', label: 'Price war', x: 4, y: 4 },
        { id: 'r08', label: 'IT migration slip', x: 5, y: 1 },
        { id: 'r09', label: 'Litigation', x: 1, y: 3 },
        { id: 'r10', label: 'Energy cost spike', x: 2, y: 2 },
        { id: 'r11', label: 'Reputation event', x: 2, y: 4 },
        { id: 'r12', label: 'Logistics delay', x: 4, y: 1 },
      ],
    },
    options: {
      // The a4 ratio for the same furniture growth as growth-share-matrix above.
      size: { width: 720, height: 511 },
      title: 'Three risks are both likely and severe — they own the next board slot',
      subtitle: {
        company: 'Brevinth Holdings',
        measure: 'Likelihood vs impact, 1–5 rating',
        period: 'Q3 risk review',
      },
      unit: 'rating',
      // The quadrant names imply the axes; the titles state them.
      axisTitles: { x: 'Likelihood, rating 1–5', y: 'Impact, rating 1–5' },
      source: 'Risk register, 12 entries assessed by the risk committee',
      quadrants: {
        x: { stat: 'median' },
        y: { stat: 'median' },
        labels: {
          tl: 'Severe but unlikely',
          tr: 'Act now',
          bl: 'Monitor',
          br: 'Likely but tolerable',
        },
      },
    },
  },
  {
    id: 'torture-quadrant-degenerate',
    title: 'Torture: cut point off-domain collapses the 2x2 to a 1x2, one box holds everything',
    kind: 'torture',
    data: quadrantTorture(),
    options: {
      title: 'A cut point outside the plotted range is a 1x2, and the exhibit says so',
      subtitle: { measure: 'Synthetic lattice', period: 'n = 40' },
      unit: 'units',
      axisTitles: { x: 'Position across, units', y: 'Position up, units' },
      quadrants: {
        x: 5,
        y: 400,
        labels: {
          tl: 'Above both cuts, left',
          tr: 'Above both cuts, right',
          bl: 'Below the growth cut, left',
          br: 'Below the growth cut, right',
        },
      },
    },
  },
  {
    id: 'portfolio-nine-box',
    title: 'Nine-box portfolio: authored 3×3 cells with axis-band labels',
    kind: 'example',
    data: {
      groups: [
        { id: 'core', label: 'Core businesses' },
        { id: 'selective', label: 'Selective bets' },
      ],
      points: [
        { id: 'alpha', group: 'core', label: 'Alpha', x: 8.2, y: 8.5, size: 92 },
        { id: 'bravo', group: 'core', label: 'Bravo', x: 6.8, y: 7.4, size: 64 },
        { id: 'charlie', group: 'selective', label: 'Charlie', x: 4.7, y: 6.2, size: 52 },
        { id: 'delta', group: 'selective', label: 'Delta', x: 7.2, y: 3.8, size: 40 },
        { id: 'echo', group: 'selective', label: 'Echo', x: 2.1, y: 2.7, size: 34 },
      ],
    },
    options: {
      size: 'slide-16x9',
      title: 'Alpha and Bravo merit investment; Echo should be divested',
      subtitle: {
        measure: 'Business strength × market attractiveness',
        period: 'FY26 portfolio review',
      },
      unit: 'score 0–10; bubble area = revenue',
      axisTitles: { x: 'Business strength, score 0–10', y: 'Market attractiveness, score 0–10' },
      sizeLegend: { label: 'Revenue' },
      source: 'Illustrative nine-box portfolio',
      legend: 'bottom',
      highlight: 'alpha',
      zones: {
        grid: {
          x: [3.33, 6.67],
          y: [3.33, 6.67],
          xLabels: ['Low strength', 'Medium strength', 'High strength'],
          yLabels: ['Low attractiveness', 'Medium attractiveness', 'High attractiveness'],
          cells: [
            { id: 'll', column: 0, row: 0, label: 'Divest', tone: 'bad' },
            { id: 'ml', column: 1, row: 0, label: 'Harvest', tone: 'warn' },
            { id: 'hl', column: 2, row: 0, label: 'Protect', tone: 'neutral' },
            { id: 'lm', column: 0, row: 1, label: 'Harvest', tone: 'warn' },
            { id: 'mm', column: 1, row: 1, label: 'Protect', tone: 'neutral' },
            { id: 'hm', column: 2, row: 1, label: 'Invest', tone: 'good' },
            { id: 'lh', column: 0, row: 2, label: 'Protect', tone: 'neutral' },
            { id: 'mh', column: 1, row: 2, label: 'Invest', tone: 'good' },
            { id: 'hh', column: 2, row: 2, label: 'Invest', tone: 'good' },
          ],
        },
      },
    },
  },
  {
    id: 'competitive-position',
    title: 'Competitive-position map with smooth authored strategic contours',
    kind: 'example',
    data: {
      groups: [
        { id: 'focus', label: 'Focus company', colorRole: 'highlight' },
        { id: 'peer', label: 'Peers' },
      ],
      points: [
        { id: 'brevinth', group: 'focus', label: 'Brevinth', x: 7.8, y: 7.2, size: 70 },
        { id: 'atlas', group: 'peer', label: 'Atlas', x: 6.2, y: 5.9, size: 54 },
        { id: 'northstar', group: 'peer', label: 'Northstar', x: 4.5, y: 6.8, size: 46 },
        { id: 'orion', group: 'peer', label: 'Orion', x: 5.1, y: 3.7, size: 38 },
        { id: 'kepler', group: 'peer', label: 'Kepler', x: 2.8, y: 4.4, size: 30 },
      ],
    },
    options: {
      size: 'slide-16x9',
      title: 'Competitive position by differentiation and delivery reach',
      subtitle: { measure: 'Relative differentiation × delivery reach' },
      unit: 'score 0–10; bubble area = indexed scale',
      axisTitles: { x: 'Relative differentiation, score 0–10', y: 'Delivery reach, score 0–10' },
      sizeLegend: { label: 'Indexed scale' },
      source: 'Illustrative competitor assessment',
      legend: 'bottom',
      highlight: 'brevinth',
      zones: {
        regions: [
          {
            id: 'advantaged',
            label: 'Advantaged',
            tone: 'good',
            smooth: true,
            points: [
              { x: 5.8, y: 5.6 },
              { x: 7.4, y: 5.2 },
              { x: 9.1, y: 6.4 },
              { x: 8.8, y: 9.0 },
              { x: 6.3, y: 8.8 },
            ],
          },
          {
            id: 'contested',
            label: 'Contested',
            tone: 'warn',
            smooth: true,
            points: [
              { x: 3.2, y: 3.0 },
              { x: 6.2, y: 2.8 },
              { x: 7.0, y: 5.3 },
              { x: 5.4, y: 6.6 },
              { x: 3.0, y: 5.4 },
            ],
          },
        ],
      },
    },
  },
);

fixtures.push({
  id: 'legend-edge-bubbles',
  title: 'Bubble labels at the plot edge under the sector key row',
  kind: 'example',
  data: {
    groups: [{ id: 'industrial', label: 'Industrial assets' }, { id: 'services', label: 'Service assets' }],
    points: [
      { id: 'north', label: 'North', group: 'industrial', x: 9, y: 20, size: 8 },
      { id: 'east', label: 'East', group: 'services', x: 10, y: 12, size: 6 },
      { id: 'south', label: 'South', group: 'industrial', x: 8, y: 2, size: 5 },
      { id: 'west', label: 'West', group: 'services', x: 1, y: 9, size: 7 },
    ],
  },
  options: {
    title: 'North leads portfolio growth',
    source: 'Illustrative assets; bubble area shows revenue',
    axisTitles: { x: 'Return on capital, %', y: 'Revenue growth, %' },
    sizeLegend: { label: 'Revenue' },
    unit: '%',
    // The sector key sits in the row above the plot.
    legend: 'top',
    size: { width: 480, height: 360 },
  },
});

fixtures.push(
  {
    id: 'option-mean-quadrants',
    title: 'Portfolio positions relative to the mean',
    kind: 'torture',
    tags: ['feature:options'],
    data: {
      points: [
        { id: 'a', label: 'A', x: 2, y: 7, size: 4 },
        { id: 'b', label: 'B', x: 4, y: 3, size: 6 },
        { id: 'c', label: 'C', x: 7, y: 8, size: 8 },
        { id: 'd', label: 'D', x: 8, y: 2, size: 10 },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Portfolio positions relative to the mean',
      source: 'Illustrative data. Cuts use unweighted means; bubble diameter represents size.',
      axisTitles: { x: 'Scale', y: 'Return' },
      sizeLegend: { label: 'Size' },
      sizeBy: 'diameter',
      quadrants: {
        x: { stat: 'mean' },
        y: { stat: 'mean' },
        tint: 'none',
        captionPlacement: 'centre',
        labels: { tl: 'High return', tr: 'High scale', bl: 'Small scale', br: 'Low return' },
      },
    },
  },
  {
    id: 'option-info-grid',
    title: 'An information zone marks the review area',
    kind: 'torture',
    tags: ['feature:options'],
    data: {
      points: [
        { id: 'a', label: 'A', x: 2, y: 7, size: 4 },
        { id: 'b', label: 'B', x: 4, y: 3, size: 6 },
        { id: 'c', label: 'C', x: 7, y: 8, size: 8 },
        { id: 'd', label: 'D', x: 8, y: 2, size: 10 },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'An information zone marks the review area',
      source: 'Illustrative data',
      axisTitles: { x: 'Scale', y: 'Return' },
      sizeLegend: { label: 'Size' },
      zones: {
        grid: { x: [5], y: [5], cells: [{ id: 'review', column: 1, row: 1, tone: 'info', label: 'Review' }] },
      },
    },
  },
  {
    id: 'option-region-tones',
    title: 'Three regions distinguish operating conditions',
    kind: 'torture',
    tags: ['feature:options'],
    data: {
      points: [
        // A and D sit on region borders on purpose; their labels name the region they count to.
        { id: 'a', label: 'A (Baseline)', x: 2, y: 7, size: 4 },
        { id: 'b', label: 'B', x: 4, y: 3, size: 6 },
        { id: 'c', label: 'C', x: 7, y: 8, size: 8 },
        { id: 'd', label: 'D (Review)', x: 8, y: 2, size: 10 },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Three regions distinguish operating conditions',
      source: 'Illustrative data',
      axisTitles: { x: 'Scale', y: 'Return' },
      sizeLegend: { label: 'Size' },
      zones: {
        regions: [
          {
            id: 'neutral',
            label: 'Baseline',
            tone: 'neutral',
            points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 10 }, { x: 0, y: 10 }],
          },
          {
            id: 'bad',
            label: 'Risk',
            tone: 'bad',
            points: [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 3, y: 10 }],
          },
          {
            id: 'info',
            label: 'Review',
            tone: 'info',
            points: [{ x: 6, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 10 }, { x: 6, y: 10 }],
          },
        ],
      },
    },
  },
);

// A dashboard slot 380px wide: 240px of height keeps a readable plot band.
fixtures.push({
  id: 'scatter-compact-380',
  title: 'Scatter in a 380px dashboard column',
  kind: 'example',
  data: {
    points: [
      { id: 'a', label: 'A', x: 12, y: 3.1 }, { id: 'b', label: 'B', x: 19, y: 4.4 },
      { id: 'c', label: 'C', x: 24, y: 4.1 }, { id: 'd', label: 'D', x: 31, y: 6.2 },
      { id: 'e', label: 'E', x: 38, y: 5.8 }, { id: 'f', label: 'F', x: 44, y: 7.9 },
    ],
  },
  options: {
    title: 'Bigger accounts convert better',
    axisTitles: { x: 'Accounts', y: 'Conversion rate' },
    size: { width: 380, height: 241 },
  },
});

// belowMinimum: the default draws a compact chart in a short or narrow slot; 'refuse' keeps the refusal there.
const slot = fixtures.find((fixture) => fixture.id === 'scatter-compact-380')!;
fixtures.push(
  { ...slot, kind: 'torture', id: 'scatter-below-minimum-refuse', title: 'belowMinimum refuse on a canvas at the minimum', tags: ['coverage'], options: { ...slot.options, belowMinimum: 'refuse', size: { width: 480, height: 360 } } },
);

// Coverage: both axes capped in the long form, and a floor in the short form.
const clamped = fixtures.find((fixture) => fixture.id === 'scatter-clamped')!;
fixtures.push(
  {
    ...clamped,
    id: 'scatter-clamped-both-axes',
    title: 'Both axes bounded through clamp.x and clamp.y',
    tags: ['coverage'],
    options: {
      ...clamped.options,
      valueAxis: { clamp: { x: { min: 250, max: 1000 }, y: { min: 5000, max: 25000 } } },
      size: { width: 960, height: 540 },
      title: 'Two flagship stores sit beyond both caps, the outlet below the revenue floor',
    },
  },
  {
    ...clamped,
    id: 'scatter-clamped-floor',
    title: 'A floor and a cap on the vertical axis through clamp.min and clamp.max',
    tags: ['coverage'],
    options: {
      ...clamped.options,
      valueAxis: { clamp: { min: 5000, max: 25000 } },
      title: 'Two flagship stores earn above the plotted range, the outlet below it',
    },
  },
);

// Coverage: the sizes the bubble key shows, chosen by the author.
const bubbles = fixtures.find((fixture) => fixture.id === 'portfolio-bubbles')!;
fixtures.push({
  ...bubbles,
  id: 'portfolio-bubbles-key-values',
  title: 'A bubble size key showing the authored sizes 8 and 2',
  tags: ['coverage'],
  options: { ...bubbles.options, sizeLegend: { label: 'Revenue pool, $bn', values: [8, 2] } },
});

// Coverage: accessible descriptions on strategy-grid cells and polygon regions.
const geMatrix = fixtures.find((fixture) => fixture.id === 'portfolio-nine-box')!;
const geZones = geMatrix.options!.zones!;
const competitive = fixtures.find((fixture) => fixture.id === 'competitive-position')!;
const competitiveZones = competitive.options!.zones!;
fixtures.push(
  {
    ...geMatrix,
    id: 'portfolio-nine-box-described',
    title: 'Strategy-grid cells that carry an accessible description',
    tags: ['coverage'],
    options: {
      ...geMatrix.options,
      zones: {
        grid: {
          ...geZones.grid!,
          cells: geZones.grid!.cells!.map((cell) => ({ ...cell, a11y: `${cell.label}: ${geZones.grid!.xLabels![cell.column]}, ${geZones.grid!.yLabels![cell.row]}` })),
        },
      },
    },
  },
  {
    ...competitive,
    id: 'competitive-position-described',
    title: 'Polygon regions that carry an accessible description',
    tags: ['coverage'],
    options: {
      ...competitive.options,
      zones: {
        regions: competitiveZones.regions!.map((region) => ({ ...region, a11y: `${region.label} region of the competitive map` })),
      },
    },
  },
);

// Coverage: the label solver considers at most 20 of the 40 points.
const lattice = fixtures.find((fixture) => fixture.id === 'dense-40-thinning')!;
fixtures.push({
  ...lattice,
  id: 'dense-40-first-twenty-labels',
  title: 'At most 20 of the 40 point labels considered by the solver',
  tags: ['coverage'],
  // The title says what the chart draws; no canvas note says it.
  options: { ...lattice.options, maxPointLabels: 20, title: 'Past 20 points the solver draws no point labels' },
});

// valueAxis.log. Score against cost spans 0.45 to 95 dollars, so the
// cost axis is log10 and ends on 0.4 and 100; the zone cut at $8 and the
// highlight rings map through it. Synthetic models and vendors.
fixtures.push(
  {
    id: 'score-vs-cost-log',
    title: 'Score vs. cost per task on a log cost axis, with vendor groups and zones',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      groups: [
        { id: 'v1', label: 'Vendor 1', colorRole: 'series-1' },
        { id: 'v2', label: 'Vendor 2', colorRole: 'series-2' },
        { id: 'v3', label: 'Vendor 3', colorRole: 'series-3' },
        { id: 'v4', label: 'Vendor 4', colorRole: 'series-4' },
      ],
      points: [
        { id: 'a-high', label: 'Model A (high)', group: 'v1', x: 12, y: 88 },
        { id: 'a-low', label: 'Model A (low)', group: 'v1', x: 4.5, y: 76 },
        { id: 'b-high', label: 'Model B (high)', group: 'v1', x: 38, y: 91 },
        { id: 'b-mini', label: 'Model B (mini)', group: 'v1', x: 0.9, y: 55 },
        { id: 'c-high', label: 'Model C (high)', group: 'v2', x: 2.2, y: 81 },
        { id: 'c-med', label: 'Model C (medium)', group: 'v2', x: 1.3, y: 72 },
        { id: 'd', label: 'Model D', group: 'v2', x: 0.45, y: 48 },
        { id: 'd-high', label: 'Model D (high)', group: 'v2', x: 6.5, y: 79 },
        { id: 'e-high', label: 'Model E (high)', group: 'v3', x: 95, y: 93 },
        { id: 'e-low', label: 'Model E (low)', group: 'v3', x: 22, y: 84 },
        { id: 'f', label: 'Model F', group: 'v3', x: 3.1, y: 62 },
        { id: 'f-fast', label: 'Model F (fast)', group: 'v3', x: 0.6, y: 41 },
        { id: 'g', label: 'Model G', group: 'v4', x: 1.8, y: 58 },
        { id: 'g-high', label: 'Model G (high)', group: 'v4', x: 9.5, y: 70 },
        { id: 'h', label: 'Model H', group: 'v4', x: 0.8, y: 35 },
        { id: 'h-high', label: 'Model H (high)', group: 'v4', x: 55, y: 74 },
      ],
    },
    options: {
      title: 'Score vs. cost per task',
      subtitle: '16 models from 4 vendors, synthetic benchmark',
      axisTitles: { x: 'Cost per task, log scale', y: 'Score, %' },
      // The cost ticks carry their dollar sign (axisFormat).
      axisFormat: { x: '$0.00' },
      valueAxis: { log: 'x' },
      viewDomain: { y: [0, 100] },
      legend: 'top',
      highlight: ['d', 'b-mini', 'c-med', 'c-high', 'a-high', 'b-high', 'e-high'],
      zones: {
        grid: {
          x: [8],
          y: [50],
          xLabels: ['Under $8', '$8 and more'],
          yLabels: ['Under 50%', '50% and more'],
          cells: [
            { id: 'attractive', column: 0, row: 1, label: 'Most attractive quadrant', tone: 'good' },
            { id: 'unattractive', column: 1, row: 0, label: 'Least attractive quadrant', tone: 'neutral' },
            { id: 'costly', column: 1, row: 1, label: 'Strong but costly', tone: 'neutral' },
            { id: 'weak', column: 0, row: 0, label: 'Cheap but weak', tone: 'neutral' },
          ],
        },
      },
      footnotes: ['Ringed points: no other model scores higher at a lower cost.'],
      source: 'Synthetic data, invented models and vendors',
      size: { width: 960, height: 540 },
    },
  },
  {
    id: 'log-both-stores-revenue',
    title: 'Both axes on a log scale, with median quadrants',
    kind: 'example',
    tags: ['coverage'],
    data: {
      points: [
        { id: 'a', label: 'Company A', x: 1.2, y: 1.5 },
        { id: 'b', label: 'Company B', x: 3, y: 4 },
        { id: 'c', label: 'Company C', x: 7, y: 9 },
        { id: 'd', label: 'Company D', x: 15, y: 20 },
        { id: 'e', label: 'Company E', x: 40, y: 48 },
        { id: 'f', label: 'Company F', x: 90, y: 70 },
        { id: 'g', label: 'Company G', x: 160, y: 180 },
        { id: 'h', label: 'Company H', x: 350, y: 320 },
        { id: 'i', label: 'Company I', x: 600, y: 610 },
        { id: 'j', label: 'Company J', x: 800, y: 900 },
      ],
    },
    options: {
      title: 'Revenue grows with the store count over three decades',
      axisTitles: { x: 'Stores, log scale', y: 'Revenue, $m, log scale' },
      valueAxis: { log: 'both' },
      quadrants: { x: { stat: 'median' }, y: { stat: 'median' } },
      source: 'Synthetic data',
      size: { width: 720, height: 405 },
    },
  },
  {
    id: 'log-y-under-a-decade',
    title: 'A log vertical axis over less than one decade, with a trend and a value line',
    kind: 'example',
    tags: ['coverage'],
    data: {
      points: Array.from({ length: 10 }, (_, i) => ({ id: `w${i + 1}`, label: `Week ${i + 1}`, x: i + 1, y: [22, 26, 25, 31, 36, 41, 44, 52, 61, 78][i]! })),
    },
    options: {
      title: 'Order value more than tripled in ten weeks',
      axisTitles: { x: 'Week', y: 'Average order value, $, log scale' },
      valueAxis: { log: 'y' },
      trend: { label: 'Linear trend' },
      source: 'Synthetic data',
      size: { width: 720, height: 405 },
    },
    annotations: [{ kind: 'valueLine', value: 50, label: 'Target 50' }],
  },
);
// A public benchmark's score-vs-cost chart, synthetic names only. The
// engine picks the Pareto points (Model D to Model E (high), seven of 16);
// each axis prints its own unit; the good cell is keyed in the legend row and
// the side cells carry no wash.
fixtures.push({
  id: 'score-vs-cost-frontier',
  title: 'Score vs cost with a Pareto line, per-axis tick units and a keyed quadrant',
  kind: 'example',
  data: {
    groups: [
      { id: 'v1', label: 'Vendor 1', colorRole: 'series-1' },
      { id: 'v2', label: 'Vendor 2', colorRole: 'series-2' },
      { id: 'v3', label: 'Vendor 3', colorRole: 'series-3' },
      { id: 'v4', label: 'Vendor 4', colorRole: 'series-4' },
    ],
    points: [
      { id: 'a-high', group: 'v1', label: 'Model A (high)', x: 11, y: 88 },
      { id: 'a-low', group: 'v1', label: 'Model A (low)', x: 6.6, y: 76 },
      { id: 'b-high', group: 'v1', label: 'Model B (high)', x: 17, y: 91 },
      { id: 'b-mini', group: 'v1', label: 'Model B (mini)', x: 2.2, y: 55 },
      { id: 'c-high', group: 'v2', label: 'Model C (high)', x: 5, y: 81 },
      { id: 'c-med', group: 'v2', label: 'Model C (medium)', x: 3.4, y: 72 },
      { id: 'd', group: 'v2', label: 'Model D', x: 1, y: 48 },
      { id: 'd-high', group: 'v2', label: 'Model D (high)', x: 7.4, y: 79 },
      { id: 'e-high', group: 'v3', label: 'Model E (high)', x: 19.5, y: 93 },
      { id: 'e-low', group: 'v3', label: 'Model E (low)', x: 13, y: 84 },
      { id: 'f', group: 'v3', label: 'Model F', x: 5.8, y: 62 },
      { id: 'f-fast', group: 'v3', label: 'Model F (fast)', x: 1.8, y: 30 },
      { id: 'g', group: 'v4', label: 'Model G', x: 4.2, y: 58 },
      { id: 'g-high', group: 'v4', label: 'Model G (high)', x: 10, y: 70 },
      { id: 'h', group: 'v4', label: 'Model H', x: 2.6, y: 35 },
      { id: 'h-high', group: 'v4', label: 'Model H (high)', x: 15, y: 74 },
    ],
  },
  options: {
    title: 'Score vs. cost per task',
    subtitle: '16 models from 4 vendors, synthetic benchmark',
    axisTitles: { x: 'Cost per task', y: 'Score' },
    axisFormat: { x: '$0.0', y: '0%' },
    viewDomain: { x: [0, 20], y: [0, 100] },
    legend: 'top',
    frontier: { x: 'min', y: 'max', extend: true },
    zones: {
      grid: {
        // Both cuts sit on a tick ($10, 50%), so the ticks name them.
        x: [10],
        y: [50],
        cells: [
          { id: 'attractive', column: 0, row: 1, label: 'Most attractive quadrant', tone: 'good', labelAt: 'key' },
          { id: 'unattractive', column: 1, row: 0, label: 'Least attractive quadrant', tone: 'neutral' },
          { id: 'weak', column: 0, row: 0, tone: 'none' },
          { id: 'costly', column: 1, row: 1, tone: 'none' },
        ],
      },
    },
    source: 'Synthetic data, invented models and vendors',
  },
});

// Coverage: a frontier toward the other corner (higher x, lower y
// better) and a grid cell captioned in the plot and keyed in the legend.
fixtures.push({
  id: 'coverage-error-frontier',
  title: 'Pareto line toward higher coverage and lower error, with a cell captioned and keyed',
  kind: 'example',
  tags: ['coverage'],
  data: {
    points: [
      { id: 'a', label: 'Rule A', x: 62, y: 1.2 },
      { id: 'b', label: 'Rule B', x: 70, y: 1.8 },
      { id: 'c', label: 'Rule C', x: 74, y: 1.4 },
      { id: 'd', label: 'Rule D', x: 81, y: 2.6 },
      { id: 'e', label: 'Rule E', x: 85, y: 2.2 },
      { id: 'f', label: 'Rule F', x: 88, y: 3.4 },
      { id: 'g', label: 'Rule G', x: 92, y: 4.1 },
      { id: 'h', label: 'Rule H', x: 95, y: 5.8 },
    ],
  },
  options: {
    title: 'Coverage vs error rate for eight screening rules',
    axisTitles: { x: 'Coverage', y: 'Error rate' },
    axisFormat: { x: '0%', y: '0.0%' },
    frontier: { x: 'max', y: 'min', label: 'Best trade-off' },
    zones: {
      grid: {
        x: [80],
        y: [3],
        cells: [
          { id: 'target', column: 1, row: 0, label: 'Target zone', tone: 'good', labelAt: 'both' },
          { id: 'narrow', column: 0, row: 0, tone: 'none' },
          { id: 'noisy-narrow', column: 0, row: 1, tone: 'none' },
          { id: 'noisy', column: 1, row: 1, tone: 'none' },
        ],
      },
    },
    source: 'Synthetic data, invented rules',
  },
});

// Coverage: regions keyed in the legend row, one also captioned, and
// one drawn as an outline without a wash.
fixtures.push({
  ...competitive,
  id: 'competitive-position-keyed',
  title: 'Polygon regions keyed in the legend row, captioned in the plot, or outlined without a wash',
  tags: ['coverage'],
  options: {
    ...competitive.options,
    zones: {
      regions: [
        { ...competitiveZones.regions![0]!, labelAt: 'key' },
        { ...competitiveZones.regions![1]!, labelAt: 'both' },
        {
          id: 'watch',
          label: 'Watch list',
          tone: 'none',
          points: [{ x: 3.8, y: 7.2 }, { x: 5.2, y: 7.2 }, { x: 5.2, y: 8.6 }, { x: 3.8, y: 8.6 }],
        },
      ],
    },
  },
});

// every point symbol, set on a group and on a point.
fixtures.push({
  id: 'store-format-markers',
  title: 'Five store formats, one marker each, a label-only peer median',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    groups: [
      { id: 'flagship', label: 'Flagship', marker: 'circle' },
      { id: 'mall', label: 'Mall', marker: 'square' },
      { id: 'outlet', label: 'Outlet', marker: 'triangle' },
      { id: 'online', label: 'Online', marker: 'diamond' },
      { id: 'peers', label: 'Peers', marker: 'none' },
    ],
    points: [
      { id: 'berlin', group: 'flagship', label: 'Berlin', x: 8, y: 14, marker: 'circle' },
      { id: 'paris', group: 'flagship', label: 'Paris', x: 6, y: 12 },
      { id: 'lyon', group: 'mall', label: 'Lyon', x: 3, y: 9, marker: 'square' },
      { id: 'hamburg', group: 'mall', label: 'Hamburg', x: 1, y: 7 },
      { id: 'outlet-north', group: 'outlet', label: 'Outlet North', x: -2, y: 5, marker: 'triangle' },
      { id: 'outlet-south', group: 'outlet', label: 'Outlet South', x: -4, y: 2 },
      { id: 'web-de', group: 'online', label: 'Web DE', x: 12, y: 6, marker: 'diamond' },
      { id: 'web-fr', group: 'online', label: 'Web FR', x: 10, y: 4 },
      { id: 'peer-median', group: 'peers', label: 'Peer median', x: 4, y: 10, marker: 'none' },
    ],
  },
  options: {
    title: 'Flagships earn the margin, online the growth, outlets neither',
    subtitle: { measure: 'EBIT margin vs sales growth by store', period: 'FY26' },
    unit: '%',
    axisTitles: { x: 'Sales growth, %', y: 'EBIT margin, %' },
    legend: 'bottom',
    source: 'Synthetic store data',
  },
});

fixtures.push({
  id: 'selected-labels-only', title: 'Only selected points carry visible names', kind: 'torture',
  data: { points: Array.from({ length: 30 }, (_, i) => ({
    id: `record-${i}`, x: 20 + i * 2, y: 30 + (i * 13) % 37,
    ...(i % 10 === 0 ? { label: `Candidate ${i / 10 + 1}` } : {}),
  })) },
  options: { title: 'Three candidates are selected for review', size: { width: 720, height: 500 } },
});

fixtures.push({
  id: 'callouts-in-notes', title: 'Crowded callouts name their note destination', kind: 'torture',
  data: { points: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, label: `Point ${i + 1}`, x: 50 + i % 2, y: 50 + i % 2 })) },
  options: { title: 'Candidates need a review before the next step', size: { width: 500, height: 440 } },
  annotations: Array.from({ length: 6 }, (_, i) => ({ id: `ap${i}`, kind: 'callout', at: { pointId: `p${i}` },
    text: `Candidate ${i + 1} needs a detailed review before the next step`,
  })),
});

// Story stepper: an intro step and five focus steps over one
// bubble matrix. Invented data; the panel finds the empty top-left corner.
fixtures.push({
  id: 'story-use-case-matrix', title: 'Story stepper: an intro and five focus steps over a bubble matrix', kind: 'example',
  data: {
    groups: [
      { id: 'finance', label: 'Finance' },
      { id: 'service', label: 'Customer service' },
      { id: 'supply', label: 'Supply chain' },
      { id: 'it', label: 'IT' },
    ],
    points: [
      { id: 'demand-forecast', group: 'supply', label: 'Demand forecasting assistant', x: 5.4, y: 9.3, size: 6.5 },
      { id: 'code-review', group: 'it', label: 'Code review assistant', x: 9.0, y: 5.6, size: 7.0 },
      { id: 'invoice-matching', group: 'finance', label: 'Invoice matching agent', x: 7.4, y: 5.9, size: 2.0 },
      { id: 'ticket-triage', group: 'service', label: 'Ticket triage assistant', x: 8.6, y: 4.5, size: 3.8 },
      { id: 'reply-drafting', group: 'service', label: 'Reply drafting assistant', x: 4.2, y: 4.3, size: 2.1 },
      { id: 'contract-review', group: 'finance', label: 'Contract clause review', x: 5.2, y: 3.6, size: 1.2 },
      { id: 'onboarding-guide', group: 'service', label: 'Customer onboarding guide', x: 6.2, y: 4.4, size: 2.6 },
      { id: 'route-planning', group: 'supply', label: 'Route planning agent', x: 7.0, y: 2.9, size: 4.9 },
      { id: 'returns-handling', group: 'service', label: 'Returns handling assistant', x: 5.8, y: 2.5, size: 1.9 },
      { id: 'stock-alerts', group: 'supply', label: 'Stock level alerts', x: 5.4, y: 1.8, size: 0.9 },
      { id: 'expense-audit', group: 'finance', label: 'Expense audit agent', x: 3.4, y: 2.4, size: 1.6 },
      { id: 'shift-scheduling', group: 'supply', label: 'Shift scheduling solution', x: 2.1, y: 1.3, size: 1.3 },
      { id: 'access-requests', group: 'it', label: 'Access request processing', x: 3.8, y: 0.5, size: 0.8 },
      { id: 'log-summaries', group: 'it', label: 'Log summary assistant', x: 8.2, y: 0.6, size: 0.6 },
      { id: 'payment-reminders', group: 'finance', label: 'Payment reminder agent', x: 1.4, y: 1.6, size: 1.4 },
    ],
  },
  options: {
    title: 'The use cases to start with combine high value and low build effort.',
    subtitle: 'Matrix of automation use cases',
    strings: { storyStep: 'Step {step} of {count}' },
    axisTitles: { x: 'Ease of implementation', y: 'Value impact of use case' },
    qualitativeAxes: true,
    legend: 'top',
    sizeLegend: { label: 'Bubble size: cost savings, % of cost base' },
    source: 'Illustrative data',
    size: { width: 960, height: 720 },
    story: {
      steps: [
        { id: 'intro', title: 'Cost savings of 20–30% are within reach', body: 'Teams reach them when they start with use cases that are valuable and easy to build. Use Next to see five of them.' },
        { id: 'onboarding', title: 'Customer onboarding guide', body: 'Guides new customers through setup in their own words, cuts first-week tickets and shortens the time to first value.', highlight: 'onboarding-guide' },
        { id: 'forecast', title: 'Demand forecasting assistant', body: 'Combines order history and promotions into weekly forecasts. The highest value of all cases, but it needs clean sales data first.', highlight: 'demand-forecast' },
        { id: 'code-review', title: 'Code review assistant', body: 'Checks every change against team rules before a person reviews it. Easy to start and the largest saving on the matrix.', highlight: 'code-review' },
        { id: 'routes', title: 'Route planning agent', body: 'Re-plans delivery routes when orders or traffic change during the day.', highlight: 'route-planning' },
        { id: 'invoices', title: 'Invoice matching agent', body: 'Matches invoices to orders and receipts and sends only the exceptions to a person.', highlight: 'invoice-matching' },
      ],
    },
  },
});

registerFixtures('scatter', fixtures);
