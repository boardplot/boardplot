/**
 * Continuous x axis fixtures (data.x with options.xAxis), all invented data:
 * 5-minute readings over the 2026-10-25 change from summer time in Berlin,
 * uneven sensor readings with a missing stretch, and a plain-number x.
 */

import type { Fixture } from '../../registry';
import type { LineChartData } from '../../types/data';
import type { LineOptions } from './types';

type LineFixture = Fixture<LineChartData, LineOptions>;

const dailyFixture: LineFixture = {
  id: 'x-time-daily',
  title: 'Whole-day readings use day ticks at every width',
  kind: 'example',
  tags: ['coverage'],
  data: {
    x: ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'],
    series: [{ id: 'units', label: 'Units', values: [120, 135, 128, 142] }],
  },
  options: {
    title: 'Units rose over four days',
    xAxis: { type: 'time' },
    source: 'Invented readings',
    annotations: [{ kind: 'event', at: '2026-03-03', label: 'Trial starts' }],
  },
};

const MINUTE = 60_000;
/** Berlin leaves summer time at 01:00 UTC on 25 Oct 2026. */
const BERLIN_CHANGE = Date.parse('2026-10-25T01:00:00Z');
/** The Berlin wall time of an instant, without an offset: the repeated hour gives the same text twice. */
const berlinWall = (t: number) => new Date(t + (t < BERLIN_CHANGE ? 120 : 60) * MINUTE).toISOString().slice(0, 16);

const dstStart = Date.parse('2026-10-23T22:00:00Z');
const dstTimes = Array.from({ length: 589 }, (_, i) => dstStart + i * 5 * MINUTE);
const hours = (t: number) => (t - dstStart) / 3_600_000;
const round2 = (v: number) => Math.round(v * 100) / 100;

const berlinDstFixture: LineFixture = {
  id: 'x-time-berlin-dst',
  title: '5-minute readings over two days in Berlin, across the change from summer time (continuous time axis)',
  kind: 'example',
  tags: ['coverage'],
  data: {
    x: dstTimes.map(berlinWall),
    series: [
      { id: 'hall', label: 'Hall', values: dstTimes.map((t, i) => round2(21 + 1.6 * Math.sin(((hours(t) - 8) / 24) * 2 * Math.PI) + 0.06 * Math.sin(i * 0.9))) },
      { id: 'yard', label: 'Yard', values: dstTimes.map((t, i) => round2(18.5 + 2.4 * Math.sin(((hours(t) - 10) / 24) * 2 * Math.PI) + 0.08 * Math.cos(i * 0.7))) },
    ],
  },
  options: {
    title: 'The hall stays near 21 °C while the yard swings by 5 °C',
    unit: '°C',
    xAxis: { type: 'time', zone: 'Europe/Berlin' },
    notes: { show: ['disclosure'] },
    source: 'Invented sensor data',
  },
  annotations: [{ kind: 'event', date: '2026-10-25T03:00', label: 'Clocks go back' }],
};

/** Minutes after 06:00 UTC of each reading: uneven gaps, a stretch with no pump reading. */
const sensorMinutes = [0, 4, 9, 11, 19, 33, 38, 52, 61, 64, 80, 97, 103, 118, 126, 149, 151, 170, 188, 194, 221, 236, 240, 262, 287, 291, 310, 334, 338, 359];
const sensorFixture: LineFixture = {
  id: 'x-time-uneven-sensors',
  title: 'Uneven readings keep their spacing; a missing reading breaks the line (continuous time axis)',
  kind: 'example',
  tags: ['coverage'],
  data: {
    x: sensorMinutes.map((m) => new Date(Date.parse('2026-03-03T06:00:00Z') + m * MINUTE).toISOString()),
    series: [
      { id: 'inlet', label: 'Inlet', values: sensorMinutes.map((m) => round2(2.1 + m / 240 + 0.15 * Math.sin(m / 17))) },
      { id: 'pump', label: 'Pump', values: sensorMinutes.map((m) => (m > 140 && m < 200 ? null : round2(3.4 + m / 400 + 0.2 * Math.cos(m / 23)))) },
    ],
  },
  options: {
    title: 'Inlet pressure rose steadily through the morning',
    unit: 'bar',
    xAxis: { type: 'time', zone: 'America/New_York' },
    trend: { label: 'Linear trend' },
    source: 'Invented sensor data',
  },
  annotations: [{ kind: 'band', from: '2026-03-03T08:10:00Z', to: '2026-03-03T09:35:00Z', label: 'Pump offline' }],
};

const trailKm = [0, 0.8, 2.1, 3.4, 5, 7.2, 8.1, 10.6, 12.3, 15, 16.4, 19.8, 21.1, 24.5, 26, 29.3, 31.7, 34.2, 37.9, 42.2];
const trailFixture: LineFixture = {
  id: 'x-number-trail',
  title: 'Elevation by distance on a plain-number x (continuous number axis)',
  kind: 'example',
  tags: ['coverage'],
  data: {
    x: trailKm,
    series: [{ id: 'elevation', label: 'Elevation', values: [412, 436, 489, 530, 612, 701, 688, 742, 815, 903, 880, 951, 1012, 968, 904, 876, 812, 744, 652, 590] }],
  },
  options: {
    title: 'The trail climbs 600 m to its high point at 21 km',
    unit: 'meters',
    xAxis: { type: 'number', title: 'Distance, km', unit: 'km' },
    source: 'Invented route data',
  },
};

// Weekly orders whose last week has three days so far: data.partial marks it, so the drop reads as a running week.
const weeks = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const partialWeekFixture: LineFixture = {
  id: 'x-time-partial-week',
  title: 'Weekly orders with the running week marked by data.partial (continuous time axis)',
  kind: 'example',
  tags: ['coverage'],
  data: {
    x: weeks,
    partial: ['2026-10-19'],
    series: [{ id: 'orders', label: 'Orders', values: [1240, 1310, 1285, 1350, 1402, 1388, 1455, 1430, 1498, 1520, 1544, 655] }],
  },
  options: {
    title: 'Orders grew every month; the week of 19 Oct has three days so far',
    unit: 'orders',
    xAxis: { type: 'time', zone: 'Europe/Berlin' },
    source: 'Invented shop data',
  },
};

const rangeEdgesFixture: LineFixture = {
  id: 'x-time-range-edges',
  title: 'A daily line continues to both range edges between readings',
  kind: 'example',
  tags: ['coverage'],
  data: {
    x: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'],
    series: [{ id: 'probe', label: 'Probe', values: [18, 24, 20, 30, 26, 32, 28] }],
  },
  options: {
    title: 'Daily readings continue to both range edges',
    unit: 'units',
    xAxis: { type: 'time', zone: 'UTC', min: '2026-01-01T12:00:00Z', max: '2026-01-06T12:00:00Z' },
    interpolate: 'monotone',
    source: 'Invented readings',
  },
};

export const continuousLineFixtures: LineFixture[] = [dailyFixture, berlinDstFixture, sensorFixture, trailFixture, partialWeekFixture, rangeEdgesFixture];
