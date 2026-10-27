/**
 * The weekly sample the event lane fixtures share (column, combo, line):
 * thirteen weeks W27–W39 2026 with ISO dates, the last week partial, and
 * dated events in named groups: stock-outs with their duration and launches
 * with revenue in the first 30 days. One copy, so the three chart types
 * state the same facts.
 *
 * The numbers and the product names are invented.
 */

import type { Annotation, EventGroup } from '../types/annotations';

const WEEK_STARTS = ['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10',
  '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
const WEEK_DAYS = ['29 Jun', '6 Jul', '13 Jul', '20 Jul', '27 Jul', '3 Aug', '10 Aug', '17 Aug', '24 Aug', '31 Aug', '7 Sep', '14 Sep', '21 Sep'];

/** W27–W39 2026; `withDay` adds the week's first day under the week number. */
export function weeklyEventCategories(withDay: boolean) {
  return WEEK_STARTS.map((date, i) => ({
    id: `w${27 + i}`,
    label: withDay ? `W${27 + i}\n${WEEK_DAYS[i]}` : `W${27 + i}`,
    date,
    ...(i === WEEK_STARTS.length - 1 ? { partial: true } : {}),
  }));
}

/** Online revenue, $k; W39 is four days in. */
export const WEEKLY_REVENUE = [62.1, 55.4, 51.2, 52.9, 54.3, 60.8, 57.0, 56.7, 61.5, 64.2, 70.4, 68.9, 31.2];
/** The same weeks a year earlier, $k. */
export const WEEKLY_REVENUE_PY = [58.0, 57.6, 56.1, 56.9, 57.8, 59.2, 58.6, 58.1, 59.9, 60.7, 61.8, 61.2, 60.4];
/** Conversion rate, %, and the same weeks a year earlier. */
export const WEEKLY_CONVERSION = [2.41, 2.12, 1.98, 2.05, 2.1, 2.36, 2.22, 2.19, 2.31, 2.44, 2.62, 2.58, 2.55];
export const WEEKLY_CONVERSION_PY = [2.3, 2.28, 2.33, 2.29, 2.31, 2.35, 2.32, 2.3, 2.36, 2.38, 2.4, 2.37, 2.39];

export const EVENT_GROUPS: EventGroup[] = [
  { id: 'stockout', label: 'Out of stock', tone: 'bad', glyph: 'triangle' },
  { id: 'launch', label: 'Launch', tone: 'good', glyph: 'dot' },
];

/** The two sample groups plus a price change and a promotion, neutral, told apart by glyph. */
export const EVENT_GROUPS_ALL: EventGroup[] = [
  ...EVENT_GROUPS,
  { id: 'price', label: 'Price change', tone: 'neutral', glyph: 'diamond' },
  { id: 'promo', label: 'Promotion', tone: 'neutral', glyph: 'square' },
];

/** Seven events: three stock-outs with their periods, four launches; the long ones carry a priority. */
export const WEEKLY_EVENTS: Annotation[] = [
  { kind: 'event', id: 'oos-runner', date: '2026-06-29', end: '2026-08-05', group: 'stockout', label: '2 top products',
    detail: ['Trail Runner Pro (2 sizes), Summit Jacket', '24–38 days out · ~$5.1k at risk'], priority: 10 },
  { kind: 'event', id: 'oos-bottle', date: '2026-07-06', end: '2026-07-29', group: 'stockout', label: 'Aqua Bottle 750', detail: '24 days out · ~$2.1k at risk' },
  { kind: 'event', id: 'launch-socks', date: '2026-07-06', group: 'launch', label: 'Nordic Wool Socks', detail: '$4.1k in first 30 days' },
  { kind: 'event', id: 'launch-cap', date: '2026-08-03', group: 'launch', label: 'Breeze Cap', detail: '$1.6k in first 30 days' },
  { kind: 'event', id: 'oos-tote', date: '2026-08-10', end: '2026-09-20', group: 'stockout', label: 'Canvas Tote Large', detail: '42 days out · ~$2.0k at risk', priority: 10 },
  { kind: 'event', id: 'launch-fleece', date: '2026-08-26', group: 'launch', label: 'Alpine Fleece', detail: '$0.9k in first 30 days' },
  { kind: 'event', id: 'launch-shell', date: '2026-09-07', group: 'launch', label: 'Harbor Rain Shell', detail: 'Newsletter feature on day 1',
    // Two more changes on the same date: the lane draws "+2", the hover card and the records list all three.
    items: [{ label: 'Home-page banner for the first two weeks', detail: 'Front page and the weekly email' }, { label: 'Daily ad budget +10%' }] },
];

/** Two more for the key-only charts: a price change and a promotion. */
export const WEEKLY_EVENTS_MORE: Annotation[] = [
  { kind: 'event', id: 'price-socks', date: '2026-07-20', group: 'price', label: 'Wool range −10%', detail: 'Nordic Wool Socks and two related items' },
  { kind: 'event', id: 'promo-autumn', date: '2026-09-14', end: '2026-09-20', group: 'promo', label: 'Autumn weekend sale', detail: 'Newsletter and paid social' },
];
