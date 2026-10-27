/**
 * Sparkline fixtures: the shape at exhibit size with its end
 * labels, and the bare 176 by 36 mark a card or a table row hosts, with a
 * gap the line does not bridge.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { SparklineData } from '../../types/data';
import type { SparklineOptions } from '../../types/options';

export const fixtures: Fixture<SparklineData, SparklineOptions>[] = [
  {
    id: 'orders-nine-months',
    title: 'Nine months of orders, the last point ringed and valued, both ends named',
    kind: 'example',
    tags: ['interaction'],
    // A point is named by its position: p9 is September here, and
    // the label rides on the record.
    hover: { owner: { categoryId: 'p9' } },
    data: {
      values: [11.2, 11.6, 11.1, 12.0, 12.4, 12.1, 12.9, 13.4, 13.1],
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
    },
    options: {
      ring: 'last',
      endLabels: 'ends',
      valueLabel: 'last',
      format: '1.1',
      // No height: the line band grows with the width.
      size: { width: 520 },
      title: 'Orders climb into August and ease to 13.1k in September',
      subtitle: { measure: 'Orders per month', period: 'Jan to Sep FY26' },
      source: 'Illustrative demand data',
      unit: 'k orders',
    },
  },
  {
    id: 'bare-card-spark',
    title: 'The bare 176 by 36 mark: no ring, no labels, a gap the line does not bridge',
    kind: 'example',
    hostTitle: 'Weekly orders climb from 96 to 110 in eight weeks',
    data: {
      values: [96, 98, 101, null, 104, 103, 107, 110],
      labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
    },
    options: { ring: 'none', endLabels: 'none', valueLabel: 'none', title: false },
  },
];

// Coverage: a heavier stroke for a small tile.
const ordersSpark = fixtures.find((fixture) => fixture.id === 'orders-nine-months')!;
fixtures.push({
  ...ordersSpark,
  kind: 'torture', id: 'orders-heavy-stroke',
  title: 'A 2.5 px line instead of the default 1.5 px',
  tags: ['coverage'],
  options: { ...ordersSpark.options, stroke: 2.5, title: 'Orders rise into late summer and ease in September' },
});

// a dashed reference inside the domain and the end ring in a tone.
fixtures.push(
  {
    id: 'reference-above-data',
    title: 'A target above every point: the scale reaches up to the reference, the ring in warn',
    kind: 'example',
    tags: ['coverage'],
    hostTitle: 'The score climbs to 72 but stays under the 80 target',
    data: { values: [61, 63, 62, 66, 68, 67, 71, 72] },
    options: { reference: 80, ringTone: 'warn', title: false },
  },
  {
    id: 'reference-inside-data',
    title: 'A reference the line crosses twice, the ring in good',
    kind: 'example',
    tags: ['coverage'],
    data: {
      values: [4.2, 4.8, 5.3, 4.9, 4.4, 5.1, 5.6, 5.9],
      labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
    },
    options: {
      reference: 5,
      ringTone: 'good',
      endLabels: 'ends',
      valueLabel: 'last',
      format: '1.1',
      size: { width: 320, height: 171 },
      title: 'Weekly fill rate ends above the 5.0 line',
      source: 'Illustrative data',
    },
  },
  {
    id: 'reference-constant-values',
    title: 'A flat series under its reference: the line sits at the foot, the ring in bad',
    kind: 'example',
    tags: ['coverage'],
    hostTitle: 'The rate holds at 30, ten points under the 40 target',
    data: { values: [30, 30, 30, 30, 30, 30] },
    options: { reference: 40, ringTone: 'bad', title: false },
  },
  {
    id: 'reference-with-gaps',
    title: 'A reference under a series with two gaps, bridged and ringed',
    kind: 'example',
    tags: ['coverage'],
    hostTitle: 'Volume moves above the 20 line after the first week and ends at 25',
    data: { values: [18, 21, null, 24, 26, null, 27, 25] },
    options: { reference: 20, title: false },
  },
  {
    id: 'ring-tone-without-ring',
    title: 'Refusal example: a ring tone on a spark that draws no ring',
    kind: 'example',
    refuses: { code: 'invalid-options', path: 'options.ringTone' },
    data: { values: [3, 4, 5] },
    options: { ring: 'none', ringTone: 'good' },
  },
);

registerFixtures('sparkline', fixtures);
