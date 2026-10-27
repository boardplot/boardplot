/**
 * Cohort grids. These cohort tables are arbitrary-metric heat
 * tables on the `table` type: pinned core columns, a period axis, a closing
 * aggregation row and, where several metrics share the cohorts, metric
 * blocks separated by a spacer track. The retention-specific `cohort` type
 * is a different exhibit and stays as it is.
 *
 * The numbers are synthetic and derived here, never pasted: twelve monthly
 * 2025 cohorts, their sizes, and the share of each still active after M
 * months. Every closing figure is computed from those two arrays, so a
 * reader can check the weighted average against the cells above it.
 */

import {
  COHORT_LABEL,
  COHORT_MONTHS as MONTHS,
  COHORT_PERIODS as PERIODS,
  COHORT_RETAINED as RETAINED,
  COHORT_SIZE as SIZE,
  cohortActive,
  cohortCalendar as calendar,
  cohortRelative as relative,
  cohortSum as sum,
} from '../cohortSample';
import type { Fixture } from '../../registry';
import type { TableCell, TableColumn, TableData, TableOptions, TableRow } from '../../types/table';

/** Average order value the cumulative revenue per subscriber is built from. */
const AOV = 101.5;
/** The empty track between two metric blocks. */
const BLOCK_SPACER = 16;

const TOTAL_SIZE = sum(SIZE);

/** Weighted by cohort size, which is what an average of rates means here. */
function weightedAverage(read: (cohort: number, column: number) => number | null, column: number): number | null {
  const pairs = SIZE.map((size, cohort) => [size, read(cohort, column)] as const)
    .filter((pair): pair is readonly [number, number] => pair[1] !== null);
  if (pairs.length === 0) return null;
  return Math.round(sum(pairs.map(([size, value]) => size * value)) / sum(pairs.map(([size]) => size)));
}

/** Subscribers still active in a calendar month, summed over every cohort; the same whole counts column/cohort-layers stacks. */
function activeBase(column: number): number {
  return sum(SIZE.map((_, cohort) => cohortActive(cohort, column) ?? 0));
}

function periodColumns(ids: readonly string[], labels: readonly string[], width?: number): TableColumn[] {
  return ids.map((id, index) => ({
    id,
    kind: 'value' as const,
    label: labels[index]!,
    format: '1,234',
    ...(width === undefined ? {} : { width }),
  }));
}

function cohortRows(
  ids: readonly string[],
  read: (cohort: number, column: number) => number | null,
  labels: readonly string[] = COHORT_LABEL,
  sizes: readonly number[] = SIZE,
): TableRow[] {
  return labels.map((label, cohort) => {
    const cells: Record<string, TableCell> = { size: sizes[cohort]! };
    ids.forEach((id, column) => {
      const value = read(cohort, column);
      if (value !== null) cells[id] = value;
    });
    return { id: `c${cohort}`, label, cells };
  });
}

function closingRow(label: string, ids: readonly string[], values: readonly (number | null)[], size?: number): TableRow {
  const cells: Record<string, TableCell> = size === undefined ? {} : { size };
  ids.forEach((id, index) => {
    const value = values[index];
    if (value !== null && value !== undefined) cells[id] = value;
  });
  return { id: 'closer', label, role: 'total', totalPolicy: 'source', cells };
}

// 126: the closing label keeps the 15 px total face under table.fixedType.
const CORE_COLUMNS: TableColumn[] = [
  { id: 'label', kind: 'rowLabel', label: 'Cohort', width: 126 },
  { id: 'size', kind: 'value', label: 'Size', format: '1,234', align: 'right', width: 80 },
];

/** Options every cohort grid shares: the matrix pitch, the cohort chart's dash in unobserved cells, pinned core. */
const GRID_OPTIONS: Partial<TableOptions> = {
  density: 'cohort',
  stickyLabels: 2,
  totalPosition: 'bottom',
};

const RELATIVE_IDS = Array.from({ length: PERIODS }, (_, month) => `m${month}`);
const RELATIVE_HEADS = Array.from({ length: PERIODS }, (_, month) => `M${month}`);

/**
 * M0 is 100 in every cohort row, so it takes no ground and whispers: the
 * heat rule is authored on M1 and names the months after it, and the M0
 * column itself is muted.
 */
const SHADED = RELATIVE_IDS.slice(1);

/** The since-acquisition axis with M0 unshaded and in the muted ink. */
function sinceAcquisitionColumns(): TableColumn[] {
  return periodColumns(RELATIVE_IDS, RELATIVE_HEADS, 72)
    .map((column, index) => (index === 0 ? { ...column, emphasis: 'muted' as const } : column));
}

export const cohortFixtures: Fixture<TableData, TableOptions>[] = [];

cohortFixtures.push({
  id: 'cohort-heat-relative',
  title: 'Cohort retention on the since-acquisition axis, five-step ink ramp',
  kind: 'example',
  data: {
    columns: [...CORE_COLUMNS, ...sinceAcquisitionColumns()],
    rows: [
      ...cohortRows(RELATIVE_IDS, relative),
      closingRow('Weighted avg', RELATIVE_IDS, RELATIVE_IDS.map((_, column) => weightedAverage(relative, column)), TOTAL_SIZE),
    ],
  },
  options: {
    ...GRID_OPTIONS,
    encodings: {
      m1: { type: 'heat', steps: 5, scale: 'column', columns: SHADED },
    },
    size: { width: 1180, height: 570 },
    title: 'Each 2025 cohort retains better than the one before',
    subtitle: '% of new subscribers still active M months after acquisition · M0 = 100 unshaded · – = not yet observed',
    source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025',
  },
});

// a dark theme quiets the ramp's top band. The full ink glares as a
// cell on a dark ground, so color.heatTop takes the ink at 78 % and
// color.heatTopInk prints its figures in the dark ground.
const relativeCohorts = cohortFixtures.find((fixture) => fixture.id === 'cohort-heat-relative')!;
cohortFixtures.push({
  ...relativeCohorts,
  id: 'cohort-heat-dark-top',
  title: 'Cohort retention in a dark theme, the top band at 78 % ink under dark figures',
  tags: ['feature:options'],
  options: {
    ...relativeCohorts.options,
    theme: { preset: 'standard-dark', overrides: { color: { heatTop: '#C1C6CB', heatTopInk: '#0E1A26' } } },
  },
});

cohortFixtures.push({
  id: 'cohort-heat-calendar',
  title: 'The same cohorts on calendar time, closing on the active base',
  kind: 'example',
  data: {
    columns: [
      // 132 and not 120: "Sum · active base" is the longest
      // closing label, and Boardplot draws the label a step larger at this
      // width class.
      { ...CORE_COLUMNS[0]!, width: 132 },
      CORE_COLUMNS[1]!,
      // report month headers need 83 px in both gallery themes.
      ...periodColumns(RELATIVE_IDS, COHORT_LABEL, 83),
    ],
    rows: [
      // Each row's first month is its 100 anchor: it stays out of the ramp,
      // as M0 does on the relative grid, so the retained shares take the
      // shades.
      ...cohortRows(RELATIVE_IDS, calendar).map((row, cohort) => ({
        ...row, cells: { ...row.cells, [RELATIVE_IDS[cohort]!]: { v: 100, heat: false as const } },
      })),
      closingRow('Sum · active base', RELATIVE_IDS, RELATIVE_IDS.map((_, column) => activeBase(column))),
    ],
  },
  options: {
    ...GRID_OPTIONS,
    encodings: {
      m0: { type: 'heat', steps: 5, scale: 'column', columns: RELATIVE_IDS },
    },
    size: { width: 1378, height: 586 },
    title: 'The same cohorts on calendar time',
    subtitle: '% still active by calendar month · each row starts at 100, unshaded, in its acquisition month · bottom row: subscribers still active',
    source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025',
  },
});

cohortFixtures.push({
  id: 'cohort-heat-diverging',
  title: 'Points above and below the column average, Moss over Rust',
  kind: 'example',
  data: {
    columns: [...CORE_COLUMNS, ...sinceAcquisitionColumns()],
    rows: [
      ...cohortRows(RELATIVE_IDS, relative),
      // The row its siblings close on, and the centre of the scale: a band is
      // the distance from the figure printed under it.
      closingRow('Weighted avg', RELATIVE_IDS, RELATIVE_IDS.map((_, column) => weightedAverage(relative, column)), TOTAL_SIZE),
    ],
  },
  options: {
    ...GRID_OPTIONS,
    encodings: {
      m1: { type: 'heat', steps: 3, scale: 'diverging', bins: [1, 4], center: 'total', columns: SHADED },
    },
    size: { width: 1180, height: 574 },
    title: 'Where retention is won and lost',
    subtitle: 'Points above or below the weighted average in the bottom row',
    source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025',
  },
});

/**
 * The share of a cohort lost in its first month, 100 minus its M1: lower is
 * better, so the traffic light below reads it the other way round.
 */
const firstMonthChurn = (cohort: number): number | null => {
  const kept = relative(cohort, 1);
  return kept === null ? null : 100 - kept;
};

/**
 * `scale: 'status'`: the diverging grid as a traffic light. Each cell is
 * judged against the weighted average printed under it: within 5 % of it
 * amber, farther above green, farther below red. The first-month churn
 * column reads lower is better, so there green sits below the average.
 */
cohortFixtures.push({
  id: 'cohort-heat-status',
  title: 'Each cohort green, amber or red against the weighted average',
  kind: 'example',
  data: {
    columns: [
      ...CORE_COLUMNS,
      { id: 'churn', kind: 'value', label: 'M1 churn', format: '1,234', width: 96, polarity: 'lowerIsBetter' },
      ...sinceAcquisitionColumns(),
    ],
    rows: [
      ...cohortRows(RELATIVE_IDS, relative).map((row, cohort) => {
        const churn = firstMonthChurn(cohort);
        return churn === null ? row : { ...row, cells: { ...row.cells, churn } };
      }),
      // The closing churn is the same weighted average: 100 minus the closing M1.
      closingRow('Weighted avg', ['churn', ...RELATIVE_IDS], [
        100 - weightedAverage(relative, 1)!,
        ...RELATIVE_IDS.map((_, column) => weightedAverage(relative, column)),
      ], TOTAL_SIZE),
    ],
  },
  options: {
    ...GRID_OPTIONS,
    encodings: {
      churn: { type: 'heat', scale: 'status', center: 'total' },
      m1: { type: 'heat', scale: 'status', center: 'total', columns: SHADED },
    },
    size: { width: 1200, height: 612 },
    title: 'The later cohorts keep more of their subscribers',
    subtitle: '% still active M months after acquisition · green above, red below the weighted average in the bottom row, amber within 5 % of it',
    source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025',
  },
});

cohortFixtures.push({
  id: 'cohort-heat-absolute',
  title: 'One scale for the whole grid: bins at 30, 40, 50 and 60 points',
  kind: 'example',
  data: {
    columns: [...CORE_COLUMNS, ...sinceAcquisitionColumns()],
    rows: [
      ...cohortRows(RELATIVE_IDS, relative),
      closingRow('Weighted avg', RELATIVE_IDS, RELATIVE_IDS.map((_, column) => weightedAverage(relative, column)), TOTAL_SIZE),
    ],
  },
  options: {
    ...GRID_OPTIONS,
    encodings: {
      m1: { type: 'heat', scale: 'absolute', bins: [30, 40, 50, 60], columns: SHADED },
    },
    size: { width: 1180, height: 574 },
    title: 'The same grid read on one absolute scale',
    subtitle: '% of new subscribers still active · every column on one scale, so a late month is visibly lighter than an early one',
    source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025',
  },
});

// ---- metric blocks: core columns once, three metrics over the same months ----

const BLOCK_PERIODS = [1, 2, 3, 6];
const BLOCK_IDS = {
  retention: BLOCK_PERIODS.map((month) => `r${month}`),
  revenue: BLOCK_PERIODS.map((month) => `v${month}`),
  active: BLOCK_PERIODS.map((month) => `a${month}`),
};

const blockRetention = (cohort: number, index: number): number | null => relative(cohort, BLOCK_PERIODS[index]!);
const blockRevenue = (cohort: number, index: number): number | null => {
  const month = BLOCK_PERIODS[index]!;
  const row = RETAINED[cohort]!;
  if (month >= row.length) return null;
  return Math.round((AOV * sum(row.slice(0, month + 1))) / 100);
};
const blockActive = (cohort: number, index: number): number | null => {
  const value = blockRetention(cohort, index);
  return value === null ? null : Math.round((SIZE[cohort]! * value) / 100);
};

function blockColumns(ids: readonly string[], width: number): TableColumn[] {
  return ids.map((id, index) => ({
    // The unit sits in the block's own group note, never in every cell: a
    // money format here would hoist one "$" onto the whole table, including
    // the retention block.
    id, kind: 'value' as const, label: `M${BLOCK_PERIODS[index]}`, format: '1,234', width,
  }));
}

function blockCells(cohort: number): Record<string, TableCell> {
  const cells: Record<string, TableCell> = { size: SIZE[cohort]! };
  const add = (ids: readonly string[], read: (cohort: number, index: number) => number | null): void => {
    ids.forEach((id, index) => {
      const value = read(cohort, index);
      if (value !== null) cells[id] = value;
    });
  };
  add(BLOCK_IDS.retention, blockRetention);
  add(BLOCK_IDS.revenue, blockRevenue);
  add(BLOCK_IDS.active, blockActive);
  return cells;
}

function blockCloser(): TableRow {
  const cells: Record<string, TableCell> = { size: TOTAL_SIZE };
  BLOCK_IDS.retention.forEach((id, index) => {
    const value = weightedAverage(blockRetention, index);
    if (value !== null) cells[id] = value;
  });
  BLOCK_IDS.revenue.forEach((id, index) => {
    const value = weightedAverage(blockRevenue, index);
    if (value !== null) cells[id] = value;
  });
  BLOCK_IDS.active.forEach((id, index) => {
    const values = SIZE.map((_, cohort) => blockActive(cohort, index)).filter((value): value is number => value !== null);
    if (values.length > 0) cells[id] = sum(values);
  });
  return { id: 'closer', label: 'All cohorts', role: 'total', totalPolicy: 'source', cells };
}

cohortFixtures.push({
  id: 'cohort-heat-blocks',
  title: 'Core columns once, three metric blocks over the same months',
  kind: 'example',
  data: {
    columns: [
      ...CORE_COLUMNS,
      ...blockColumns(BLOCK_IDS.retention, 64),
      ...blockColumns(BLOCK_IDS.revenue, 72),
      ...blockColumns(BLOCK_IDS.active, 72),
    ],
    columnGroups: [
      { id: 'retention', label: 'Retention', note: '% of cohort', columns: BLOCK_IDS.retention, spacer: BLOCK_SPACER },
      { id: 'revenue', label: 'Revenue per subscriber', note: '$ cumulative', columns: BLOCK_IDS.revenue, spacer: BLOCK_SPACER },
      { id: 'active', label: 'Active subscribers', note: '#', columns: BLOCK_IDS.active, spacer: BLOCK_SPACER },
    ],
    rows: [
      ...COHORT_LABEL.map((label, cohort) => ({ id: `c${cohort}`, label, cells: blockCells(cohort) })),
      blockCloser(),
    ],
  },
  options: {
    ...GRID_OPTIONS,
    encodings: {
      r1: { type: 'heat', steps: 5, scale: 'column', columns: BLOCK_IDS.retention },
      v1: { type: 'heat', steps: 5, scale: 'column', columns: BLOCK_IDS.revenue },
      a1: { type: 'heat', steps: 5, scale: 'column', columns: BLOCK_IDS.active },
    },
    size: { width: 1120, height: 599 },
    title: 'Three metrics, one set of cohorts',
    subtitle: 'Cohort and Size once, then each metric over the same months · each block takes its own ramp and its own closing rule',
    source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025',
  },
});

// ---- long history: three years of cohorts on a sampled axis ----

/** The months a long history samples, so 36 cohorts fit one card. */
const SAMPLED = [1, 2, 3, 6, 12, 18, 24, 30];
const SAMPLED_IDS = SAMPLED.map((month) => `s${month}`);
const SAMPLED_COHORTS = 36;

/** A typical decay: a flatter curve for each newer cohort. */
function sampledCohorts(): { label: string; size: number; values: Map<number, number> }[] {
  return Array.from({ length: SAMPLED_COHORTS }, (_, cohort) => {
    const age = SAMPLED_COHORTS - 1 - cohort;
    const first = 55 + cohort * 0.42;
    const decay = 0.5 - cohort * 0.002;
    const values = new Map<number, number>();
    for (const month of SAMPLED) {
      if (month <= age) values.set(month, Math.round(first * month ** -decay));
    }
    return {
      label: `${MONTHS[cohort % 12]} ${2023 + Math.floor(cohort / 12)}`,
      size: 780 + cohort * 31 + ((cohort * 37) % 50),
      values,
    };
  });
}

const SAMPLED_ROWS = sampledCohorts();
const sampledRead = (cohort: number, index: number): number | null =>
  SAMPLED_ROWS[cohort]!.values.get(SAMPLED[index]!) ?? null;

function sampledWeighted(index: number): number | null {
  const pairs = SAMPLED_ROWS.map((row) => [row.size, row.values.get(SAMPLED[index]!) ?? null] as const)
    .filter((pair): pair is readonly [number, number] => pair[1] !== null);
  if (pairs.length === 0) return null;
  return Math.round(sum(pairs.map(([size, value]) => size * value)) / sum(pairs.map(([size]) => size)));
}

/** The air before each January cohort of a long history, so each year reads as a block. */
const YEAR_SPACER = 6;

cohortFixtures.push({
  id: 'cohort-heat-sampled',
  title: 'Thirty-six cohorts on a sampled month axis, 20 px rows, 6 px before each January',
  kind: 'example',
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Cohort', width: 114 },
      { id: 'size', kind: 'value', label: 'Size', format: '1,234', align: 'right', width: 68 },
      // A head after a skipped stretch says how far it jumps, so the evenly
      // spaced columns do not read as consecutive months.
      // sampled report headers and values need 62 px.
      ...periodColumns(SAMPLED_IDS, SAMPLED.map((month) => `M${month}`), 62).map((column, index) => {
        const gap = index === 0 ? 1 : SAMPLED[index]! - SAMPLED[index - 1]!;
        return gap > 1 ? { ...column, subLabel: `+${gap} mo` } : column;
      }),
    ],
    rows: [
      ...cohortRows(
        SAMPLED_IDS,
        sampledRead,
        SAMPLED_ROWS.map((row) => row.label),
        SAMPLED_ROWS.map((row) => row.size),
      ).map((row, cohort) => (cohort > 0 && cohort % 12 === 0 ? { ...row, spacer: YEAR_SPACER } : row)),
      closingRow(
        'Weighted avg',
        SAMPLED_IDS,
        SAMPLED_IDS.map((_, index) => sampledWeighted(index)),
        sum(SAMPLED_ROWS.map((row) => row.size)),
      ),
    ],
  },
  options: {
    ...GRID_OPTIONS,
    density: 'cohort-small',
    encodings: {
      // A floor under the column ramp: a column whose values span less than
      // 20 points takes the lighter bands only.
      s1: { type: 'heat', steps: 5, scale: 'column', span: 20, columns: SAMPLED_IDS },
    },
    size: { width: 782, height: 1040 },
    title: 'Three years of cohorts on a sampled axis',
    subtitle: '% still active at selected months since acquisition · 36 monthly cohorts · a column spanning under 20 points stays light',
    source: 'Synthetic long-history cohort set',
  },
});

// ---- the large grid: sixty cohorts, sixty months ----

const LARGE_N = 60;

/** The 60 x 60 triangle of the large grid, derived from a decay curve per cohort. */
function largeCohorts(): { label: string; size: number; values: number[] }[] {
  return Array.from({ length: LARGE_N }, (_, cohort) => {
    const age = LARGE_N - 1 - cohort;
    const first = 52 + cohort * 0.25;
    const decay = 0.48 - cohort * 0.001;
    const values = Array.from({ length: age + 1 }, (_, month) =>
      month === 0 ? 100 : Math.max(1, Math.round(first * month ** -decay)));
    return {
      label: `${MONTHS[cohort % 12]} ${2021 + Math.floor(cohort / 12)}`,
      size: 2500 + cohort * 180 + ((cohort * 37) % 400),
      values,
    };
  });
}

const LARGE = largeCohorts();
const LARGE_IDS = Array.from({ length: LARGE_N }, (_, month) => `m${month}`);
const LARGE_HEADS = Array.from({ length: LARGE_N }, (_, month) => `M${month}`);
const largeRead = (cohort: number, month: number): number | null => LARGE[cohort]!.values[month] ?? null;

function largeWeighted(column: number): number | null {
  const pairs = LARGE.map((row) => [row.size, row.values[column] ?? null] as const)
    .filter((pair): pair is readonly [number, number] => pair[1] !== null);
  if (pairs.length === 0) return null;
  return Math.round(sum(pairs.map(([size, value]) => size * value)) / sum(pairs.map(([size]) => size)));
}

function largeData(): TableData {
  return {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Cohort', width: 120 },
      { id: 'size', kind: 'value', label: 'Size', format: '1,234', align: 'right', width: 80 },
      ...periodColumns(LARGE_IDS, LARGE_HEADS)
        .map((column, index) => (index === 0 ? { ...column, emphasis: 'muted' as const } : column)),
    ],
    rows: [
      ...cohortRows(LARGE_IDS, largeRead, LARGE.map((row) => row.label), LARGE.map((row) => row.size)),
      closingRow(
        'Weighted avg',
        LARGE_IDS,
        LARGE_IDS.map((_, column) => largeWeighted(column)),
        sum(LARGE.map((row) => row.size)),
      ),
    ],
  };
}

const LARGE_HEAT = {
  m1: { type: 'heat' as const, steps: 5, scale: 'column' as const, columns: LARGE_IDS.slice(1) },
};

cohortFixtures.push({
  id: 'cohort-heat-large',
  title: 'Sixty cohorts, sixty months, two pinned core columns',
  kind: 'torture',
  data: largeData(),
  options: {
    ...GRID_OPTIONS,
    density: 'cohort-small',
    encodings: LARGE_HEAT,
    // The width holds the sixty month heads at the 9.5 px head floor.
    size: { width: 2424, height: 1555 },
    title: 'Sixty cohorts, sixty months',
    subtitle: '% of new subscribers still active M months after acquisition · Jan 2021 to Dec 2025 · Cohort and Size stay put while the months scroll',
    source: 'Synthetic long-history cohort set',
  },
});

cohortFixtures.push({
  id: 'cohort-heat-large-heat-only',
  title: 'The same sixty by sixty with the figures off, grounds alone',
  kind: 'torture',
  data: largeData(),
  options: {
    ...GRID_OPTIONS,
    density: 'cohort-small',
    figures: false,
    encodings: LARGE_HEAT,
    // 1180, not 1160: the per-column heat note takes one footnote line.
    size: { width: 2424, height: 1435 },
    title: 'Sixty cohorts, sixty months, heat only',
    subtitle: 'The grounds carry the reading and the cells shrink to the narrowest lane their heads allow · the heads keep their labels and the numbers stay in the accessible table',
    source: 'Synthetic long-history cohort set',
  },
});
