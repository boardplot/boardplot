/**
 * Table fixtures. Each one shows a common table archetype. All names and
 * numbers are invented.
 */

import { registerFixtures } from '../../../fixtures/registry';
import { cohortFixtures } from './cohortFixtures';
import type { Fixture } from '../../registry';
import type { Calc, TableCell, TableData, TableOptions, TableRow } from '../../types/table';

const MANAGEMENT_VALUE_COLUMNS = [
  'mtdLy',
  'mtdAc',
  'laLy',
  'laBilled',
  'laBooked',
  'laRenew',
  'laUsage',
  'laPipe',
  'laPlan',
  'ycLy',
  'ycAc',
  'ycPlan',
  'fpLy',
  'fpPace',
  'fpPlan',
  'foLy',
  'foOut',
] as const;

type ManagementValue = number | null | { state: 'na' } | undefined;

function managementLeaf(id: string, label: string, values: readonly ManagementValue[]): TableRow {
  if (values.length !== MANAGEMENT_VALUE_COLUMNS.length) {
    throw new Error(`${id}: expected ${MANAGEMENT_VALUE_COLUMNS.length} management-report values`);
  }
  const cells: Record<string, TableCell> = {};
  MANAGEMENT_VALUE_COLUMNS.forEach((columnId, index) => {
    const value = values[index];
    if (value !== undefined) cells[columnId] = value;
  });
  return { id, label, cells };
}

// Invented demo figures of a software company, in $k, in the order of
// MANAGEMENT_VALUE_COLUMNS. Add-ons has no outlook (missing), Appliances
// marks it not applicable, and Other sits on a zero base (n.m.).
const MANAGEMENT_LEAF_VALUES = {
  euDach: [180, 152, 360, 150, 70, 45, 20, 18, 310, 2300, 1820, 1790, 4300, 3690, 3650, 4300, 3720],
  euNordics: [62, 58, 128, 61, 30, 18, 9, 6, 135, 760, 742, 790, 1540, 1505, 1600, 1540, 1530],
  europeUk: [88, 97, 220, 96, 41, 27, 12, 14, 186, 1300, 1124, 1100, 2500, 2280, 2240, 2500, 2300],
  cloudAmericas: [71, 64, 152, 70, 33, 22, 10, 9, 165, 905, 862, 960, 1830, 1745, 1940, 1830, 1770],
  subsOnprem: [46, 31, 95, 33, 18, 12, 6, 4, 92, 580, 470, 560, 1160, 950, 1120, 1160, 1010],
  subsAddons: [23, 29, 47, 28, 9, 6, 3, 5, 49, 270, 318, 290, 560, 640, 590, 560, undefined],
  svcConsulting: [54, 41, 110, 42, 25, 14, 8, 10, 118, 650, 602, 690, 1310, 1215, 1380, 1310, 1240],
  svcTraining: [12, 16, 26, 15, 5, 3, 2, 2, 28, 150, 171, 160, 305, 342, 320, 305, 350],
  hwAppliances: [33, 21, 64, 25, 12, 6, 2, 3, 70, 400, 355, 420, 790, 700, 840, 790, { state: 'na' }],
  hwDevices: [19, 5, 38, 9, 4, 2, 1, 0, 40, 230, 198, 240, 450, 395, 480, 450, 410],
  unallocOther: [0, 6, 0, 3, 2, 1, 1, 0, 0, 0, 8, 0, 0, 15, 0, 0, 15],
} satisfies Record<string, readonly ManagementValue[]>;

/** The two variants differ only in number format: 'de' reads `1.234,5`. */
type ManagementLanguage = 'en' | 'de';

function managementRows(): TableRow[] {
  const values = MANAGEMENT_LEAF_VALUES;
  const leaves = {
    euDach: managementLeaf('eu-dach', 'DACH', values.euDach),
    euNordics: managementLeaf('eu-nordics', 'Nordics', values.euNordics),
    europeUk: managementLeaf('europe-uk', 'UK', values.europeUk),
    cloudAmericas: managementLeaf('cloud-americas', 'Americas', values.cloudAmericas),
    subsOnprem: managementLeaf('subs-onprem', 'On-premises', values.subsOnprem),
    subsAddons: managementLeaf('subs-addons', 'Add-ons', values.subsAddons),
    svcConsulting: managementLeaf('svc-consulting', 'Consulting', values.svcConsulting),
    svcTraining: managementLeaf('svc-training', 'Training', values.svcTraining),
    hwAppliances: managementLeaf('hw-appliances', 'Appliances', values.hwAppliances),
    hwDevices: managementLeaf('hw-devices', 'Devices', values.hwDevices),
    unallocOther: managementLeaf('unalloc-other', 'Other', values.unallocOther),
  };
  const leafRows = Object.values(leaves);
  const totalCells = Object.fromEntries(
    MANAGEMENT_VALUE_COLUMNS.map((columnId) => [
      columnId,
      leafRows.reduce((sum, row) => {
        const cell = row.cells?.[columnId];
        if (typeof cell === 'number') return sum + cell;
        return typeof cell === 'object' && cell !== null && typeof cell.v === 'number' ? sum + cell.v : sum;
      }, 0),
    ]),
  ) as Record<string, TableCell>;

  return [
    {
      id: 'seg-subscriptions',
      label: 'Subscriptions',
      children: [
        {
          id: 'subs-cloud',
          label: 'Cloud',
          children: [
            {
              id: 'cloud-europe',
              label: 'Europe',
              children: [
                {
                  id: 'europe-eu',
                  label: 'EU',
                  children: [leaves.euDach, leaves.euNordics],
                },
                leaves.europeUk,
              ],
            },
            leaves.cloudAmericas,
          ],
        },
        leaves.subsOnprem,
        leaves.subsAddons,
      ],
    },
    {
      id: 'seg-services',
      label: 'Services',
      children: [leaves.svcConsulting, leaves.svcTraining],
    },
    {
      id: 'seg-hardware',
      label: 'Hardware',
      children: [leaves.hwAppliances, leaves.hwDevices],
    },
    {
      id: 'seg-unallocated',
      label: 'Unallocated',
      children: [leaves.unallocOther],
    },
    {
      id: 'total',
      label: 'Total',
      role: 'total',
      totalPolicy: 'validate',
      cells: totalCells,
    },
  ];
}

function forecastSum(): Calc {
  return {
    op: 'add',
    a: { ref: 'laBilled' },
    b: {
      op: 'add',
      a: { ref: 'laBooked' },
      b: {
        op: 'add',
        a: { ref: 'laRenew' },
        b: { op: 'add', a: { ref: 'laUsage' }, b: { ref: 'laPipe' } },
      },
    },
  };
}

function forecastVariance(reference: 'laLy' | 'laPlan'): Calc {
  return {
    op: 'mul',
    a: {
      op: 'div',
      a: { op: 'sub', a: forecastSum(), b: { ref: reference } },
      b: { ref: reference },
    },
    b: { lit: 100 },
  };
}

const MANAGEMENT_GROUP_COLUMNS = {
  mtd: ['mtdLy', 'mtdAc', 'mtdYoY'],
  forecast: ['laLy', 'laFc', 'laBilled', 'laBooked', 'laRenew', 'laUsage', 'laPipe', 'laYoY', 'laPlan', 'laVsPlan'],
  ytdClosed: ['ycLy', 'ycAc', 'ycYoY', 'ycPlan', 'ycVsPlan'],
  fullYearPace: ['fpLy', 'fpPace', 'fpPlan', 'fpDelta', 'fpVsOut'],
  fullYearOutlook: ['foLy', 'foOut'],
} as const;

function managementReportFixture(language: ManagementLanguage): Fixture<TableData, TableOptions> {
  const english = language === 'en';
  const groupedFormat = english ? '1,234' : '1.234';
  const accountingFormat = english ? '(1,234)' : '(1.234)';
  return {
    id: english ? 'management-report' : 'management-report-de',
    title: english
      ? 'Monthly revenue report with expandable hierarchy and forecast detail'
      : 'Monthly revenue report with expandable hierarchy and forecast detail, German number format',
    kind: 'example',
    data: {
      columnGroups: [
        // The period each block covers rides in the heading's note, not in
        // the heading: "MONTH-TO-DATE · Jul 1-15" is how a management
        // table reads, the name tracked and uppercase, the qualifier beside it.
        { id: 'g-mtd', label: 'Month-to-Date', note: 'Jul 1–15', columns: [...MANAGEMENT_GROUP_COLUMNS.mtd] },
        { id: 'g-forecast', label: 'July Forecast', note: 'full month', columns: [...MANAGEMENT_GROUP_COLUMNS.forecast] },
        { id: 'g-ytdc', label: 'YTD Closed', note: 'Jan–Jun', columns: [...MANAGEMENT_GROUP_COLUMNS.ytdClosed] },
        { id: 'g-pace', label: 'Full Year', note: 'pace', columns: [...MANAGEMENT_GROUP_COLUMNS.fullYearPace] },
        {
          id: 'g-outlook',
          label: 'Full Year',
          note: 'outlook',
          columns: [...MANAGEMENT_GROUP_COLUMNS.fullYearOutlook],
          // The FY block sits on the band, set off from the months beside it.
          band: true,
        },
      ],
      columnToggles: [
        {
          id: 'forecast-detail',
          label: 'Forecast detail',
          columns: ['laBilled', 'laBooked', 'laRenew', 'laUsage', 'laPipe'],
        },
        { id: 'mtd-band', label: 'Month-to-Date', columns: [...MANAGEMENT_GROUP_COLUMNS.mtd], defaultVisible: true },
        { id: 'ytd-closed-band', label: 'YTD Closed', columns: [...MANAGEMENT_GROUP_COLUMNS.ytdClosed], defaultVisible: true },
        { id: 'full-year-pace-band', label: 'Full Year Pace', columns: [...MANAGEMENT_GROUP_COLUMNS.fullYearPace], defaultVisible: true },
        {
          id: 'full-year-outlook-band',
          label: 'Full Year Outlook',
          columns: [...MANAGEMENT_GROUP_COLUMNS.fullYearOutlook],
          defaultVisible: true,
        },
      ],
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Segment' },
        { id: 'mtdLy', kind: 'value', label: 'Prior year', format: groupedFormat, width: 106 },
        { id: 'mtdAc', kind: 'value', label: 'Actual', format: groupedFormat, width: 76 },
        {
          id: 'mtdYoY',
          kind: 'computed',
          label: 'YoY',
          calc: { op: 'percentDelta', a: 'mtdAc', b: 'mtdLy' },
          polarity: 'higherIsBetter',
          materiality: { pct: 0.5 },
          format: '+1%',
          width: 66,
        },
        { id: 'laLy', kind: 'value', label: 'Prior year', format: groupedFormat, width: 106 },
        { id: 'laFc', kind: 'computed', label: 'Forecast', calc: forecastSum(), format: groupedFormat, width: 96 },
        // The forecast inputs share one authored width, so the detail block
        // opens as an even run of columns.
        { id: 'laBilled', kind: 'value', label: 'Billed', format: groupedFormat, width: 92 },
        { id: 'laBooked', kind: 'value', label: 'Booked', format: groupedFormat, width: 92 },
        { id: 'laRenew', kind: 'value', label: 'Renewals', format: groupedFormat, width: 92 },
        { id: 'laUsage', kind: 'value', label: 'Usage', format: groupedFormat, width: 92 },
        { id: 'laPipe', kind: 'value', label: 'Pipeline', format: groupedFormat, width: 92 },
        {
          id: 'laYoY',
          kind: 'computed',
          label: 'YoY',
          calc: forecastVariance('laLy'),
          polarity: 'higherIsBetter',
          format: '+1%',
          width: 66,
        },
        { id: 'laPlan', kind: 'value', label: 'Plan', format: groupedFormat, width: 76 },
        {
          id: 'laVsPlan',
          kind: 'computed',
          label: 'vs Plan',
          calc: forecastVariance('laPlan'),
          polarity: 'higherIsBetter',
          materiality: { pct: 0.5 },
          format: '+1%',
          width: 80,
        },
        { id: 'ycLy', kind: 'value', label: 'Prior year', format: groupedFormat, width: 106 },
        { id: 'ycAc', kind: 'value', label: 'Actual', width: 76 },
        {
          id: 'ycYoY',
          kind: 'computed',
          label: 'YoY',
          calc: { op: 'percentDelta', a: 'ycAc', b: 'ycLy' },
          format: '+1%',
          width: 66,
        },
        { id: 'ycPlan', kind: 'value', label: 'Plan', format: groupedFormat, width: 76 },
        {
          id: 'ycVsPlan',
          kind: 'computed',
          label: 'vs Plan',
          calc: { op: 'percentDelta', a: 'ycAc', b: 'ycPlan' },
          polarity: 'higherIsBetter',
          materiality: { pct: 0.5 },
          format: '+1%',
          width: 80,
        },
        { id: 'fpLy', kind: 'value', label: 'Prior year', format: groupedFormat, width: 106 },
        { id: 'fpPace', kind: 'value', label: 'Pace', format: groupedFormat, width: 76 },
        { id: 'fpPlan', kind: 'value', label: 'Plan', format: groupedFormat, width: 76 },
        {
          id: 'fpDelta',
          kind: 'computed',
          label: 'Δ Plan',
          calc: { op: 'sub', a: { ref: 'fpPace' }, b: { ref: 'fpPlan' } },
          polarity: 'higherIsBetter',
          format: accountingFormat,
          width: 72,
        },
        {
          id: 'fpVsOut',
          // A percent authored per leaf and summed by the default aggregate
          // would put the sum of the children's percentages on the Total
          // row. Computed from the pace and the outlook, every parent
          // derives its own ratio from its summed operands.
          kind: 'computed',
          label: 'vs Outlook',
          calc: { op: 'percentDelta', a: 'fpPace', b: 'foOut' },
          format: english ? '+1.1%' : '+1,1%',
          polarity: 'higherIsBetter',
          materiality: { pct: 0.5 },
          width: english ? 138 : 154,
        },
        { id: 'foLy', kind: 'value', label: 'Prior year', format: groupedFormat, width: 106 },
        { id: 'foOut', kind: 'value', label: 'Outlook', format: groupedFormat, nulls: 'skip', width: english ? 132 : 148 },
      ],
      rows: managementRows(),
      levelNouns: [
        { one: 'segment', other: 'segments' },
        { one: 'product', other: 'products' },
        { one: 'region', other: 'regions' },
        { one: 'area', other: 'areas' },
        { one: 'market', other: 'markets' },
      ],
    },
    options: {
      // A revenue report nests segments inside segments and reads its
      // hierarchy off the ladder grounds, so it takes `hierarchy` and names
      // the total position it would have from `steering`.
      variant: 'hierarchy',
      totalPosition: 'top',
      // A management report reads its segments as rung-1 Groups
      // and their lines as rung-2 Lines, so a line
      // with children measures as its siblings.
      levelOffset: 1,
      // One heat lane, on the variance with the broadest closed base, capped
      // at ±20 points so one outlier cannot claim the whole ramp.
      encodings: { ycYoY: { type: 'heat', cap: { pct: 20 }, alpha: 0.18 } },
      density: 'compact',
      locale: english
        ? { decimal: '.', thousands: ',', minusGlyph: '−' }
        : { language: 'de', decimal: ',', thousands: '.', minusGlyph: '−' },
      // Report columns keep authored widths, so a sort, a top-N fold or a
      // hidden block never moves a head; the label track takes the rest.
      // The height follows the rows, so no bare canvas sits above the source.
      size: { width: 2100 },
      anchorWash: true,
      expansion: { depth: 1, collapsed: ['seg-unallocated'] },
      // A message-free reference exhibit: it demonstrates depth and column
      // count, not a finding, so the title names what it demonstrates.
      title: 'Monthly revenue report — full depth and column set',
      // The German variant shows the locale with its own currency.
      subtitle: english ? 'in $k · As of 15 July 2026' : 'in €k · As of 15 July 2026',
      source: 'Boardplot demo data',
    },
  };
}

/**
 * The management report cut to two blocks for a README-width card: GitHub
 * shows a README image at about 830 px, and the full 2,100 px report would
 * print its figures at 5 px there. The year-to-date prior year stays as a
 * calc operand behind a toggle, so its YoY still derives from the data.
 */
function managementCompactFixture(): Fixture<TableData, TableOptions> {
  const full = managementReportFixture('en');
  const shown = new Set<string>(['label', ...MANAGEMENT_GROUP_COLUMNS.mtd, ...MANAGEMENT_GROUP_COLUMNS.ytdClosed]);
  return {
    id: 'management-report-compact',
    title: 'Monthly revenue report at README width: month-to-date and closed year-to-date',
    kind: 'example',
    data: {
      ...full.data,
      columnGroups: full.data.columnGroups!.filter((group) => group.id === 'g-mtd' || group.id === 'g-ytdc'),
      columnToggles: [{ id: 'ytd-prior-year', label: 'YTD Closed prior year', columns: ['ycLy'] }],
      columns: full.data.columns.filter((column) => shown.has(column.id)),
    },
    options: {
      ...full.options,
      size: { width: 800 },
      title: 'Revenue is 12% below last year, and Hardware halved this month',
    },
  };
}

export const fixtures: Fixture<TableData, TableOptions>[] = [
  {
    // Management steering, the flagship: "where are we off plan and how
    // badly", trusted derived numbers, ofWhich truth.
    id: 'steering-monthly',
    title: 'Management steering: actual vs plan with validated group total',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { rowId: 'group', colId: 'dPlan' } },
    data: {
      columnGroups: [{ id: 'fy26', label: 'FY26 YTD', columns: ['actual', 'plan', 'dPlan'] }],
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Business unit' },
        { id: 'actual', kind: 'value', label: 'Actual', format: '$1.1m', scenario: 'AC' },
        { id: 'plan', kind: 'value', label: 'Plan', format: '$1.1m', scenario: 'PL' },
        {
          id: 'dPlan',
          kind: 'computed',
          label: 'Δ Plan',
          calc: { op: 'percentDelta', a: 'actual', b: 'plan' },
          polarity: 'higherIsBetter',
          format: '+1.1%',
          materiality: { pct: 0.5 },
        },
        { id: 'status', kind: 'status', label: 'Status' },
        { id: 'readout', kind: 'text', label: 'Readout' },
      ],
      rows: [
        {
          id: 'group',
          label: 'Group',
          role: 'total',
          totalPolicy: 'validate',
          cells: { actual: 128.4e6, plan: 121.0e6 },
          children: [
            {
              id: 'de',
              label: 'Germany',
              cells: {
                actual: 61.2e6,
                plan: 58.0e6,
                status: 'on-track',
                readout: 'Price carry-over compensating soft volumes',
              },
            },
            {
              id: 'fr',
              label: 'France',
              cells: {
                actual: 24.1e6,
                plan: 27.5e6,
                status: 'off-track',
                readout: 'Retail delisting hit; recovery plan in week 3',
              },
            },
            {
              id: 'uk',
              label: 'United Kingdom',
              cells: {
                actual: 30.6e6,
                plan: 24.5e6,
                status: 'on-track',
                readout: 'Marketplace launch ahead of plan',
              },
            },
            {
              id: 'rest',
              label: 'Rest of Europe',
              cells: { actual: 12.5e6, plan: 11.0e6, status: 'at-risk', readout: 'FX headwind building' },
            },
            {
              id: 'digital',
              label: 'of which digital',
              relation: 'ofWhich',
              cells: { actual: 41.3e6, plan: 36.0e6 },
            },
          ],
        },
      ],
    },
    options: {
      variant: 'steering',
      density: 'regular',
      totalPosition: 'top',
      expansion: { depth: 'all' },
      title: 'France is the one red cell in an on-plan quarter',
      subtitle: { measure: 'Revenue by business unit', period: 'FY26 YTD Mar' },
      source: 'Illustrative group controlling; the group row is validated against its children',
      encodings: { dPlan: 'polarityBadge' },
    },
  },
  {
    id: 'steering-executive-report',
    title: 'Executive KPI table: monthly values with verified MoM, YoY and YTD',
    kind: 'example',
    data: {
      columnGroups: [
        { id: 'months', label: 'FY26 months', columns: ['jan', 'feb', 'mar'] },
      ],
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'KPI' },
        { id: 'jan', kind: 'value', label: 'Jan', format: '$1.1m', scenario: 'AC' },
        { id: 'feb', kind: 'value', label: 'Feb', format: '$1.1m', scenario: 'AC' },
        { id: 'mar', kind: 'value', label: 'Mar', format: '$1.1m', scenario: 'AC' },
        {
          id: 'ytd',
          kind: 'computed',
          label: 'YTD',
          format: '$1.1m',
          calc: { op: 'add', a: { op: 'add', a: { ref: 'jan' }, b: { ref: 'feb' } }, b: { ref: 'mar' } },
        },
        { id: 'fy', kind: 'value', label: 'FY', format: '$1.1m', aggregate: 'source' },
        { id: 'plan', kind: 'value', label: 'Plan', format: '$1.1m', scenario: 'PL', aggregate: 'source' },
        {
          id: 'vsPlan',
          kind: 'computed',
          label: 'vs Plan',
          calc: { op: 'percentDelta', a: 'fy', b: 'plan' },
          polarity: 'higherIsBetter',
          format: '+1.1%',
        },
      ],
      rows: [
        {
          id: 'revenue',
          label: 'Revenue',
          cells: { jan: 10e6, feb: 12e6, mar: 11e6, fy: 40e6, plan: 38e6 },
          children: [
            {
              id: 'revenue-mom',
              label: 'MoM',
              relation: 'displayOnly',
              format: '+1.1%',
              polarity: 'higherIsBetter',
              calc: {
                op: 'percentDelta',
                a: { row: 'revenue' },
                b: { row: 'revenue', previous: true },
              },
            },
            {
              id: 'revenue-yoy',
              label: 'YoY',
              relation: 'displayOnly',
              format: '+1.1%',
              polarity: 'higherIsBetter',
              calc: {
                op: 'percentDelta',
                a: { row: 'revenue' },
                b: { row: 'revenue-py' },
              },
            },
            {
              // The prior year is context: it has no plan to be measured
              // against, so its plan and vs-plan cells stay empty.
              id: 'revenue-py',
              label: 'Prior year',
              relation: 'displayOnly',
              missing: 'blank',
              cells: { jan: 8e6, feb: 12e6, mar: 10e6, fy: 36e6 },
            },
          ],
        },
      ],
    },
    options: {
      variant: 'steering',
      density: 'compact',
      stickyLabels: true,
      expansion: { depth: 'all' },
      title: 'Full-year revenue forecast is 5.3% ahead of plan',
      subtitle: { measure: 'Group revenue', period: 'FY26 YTD Mar' },
      source: 'Synthetic executive-table fixture; MoM, YoY and YTD are calculated from the monthly source values',
      footnotes: ['Jan–Mar and YTD show actuals. FY is the full-year forecast; Plan is the full-year plan. AC = actual; PL = plan. Full-year figures are authored, not extrapolated from YTD.'],
    },
  },
  {
    id: 'department-steering-mini',
    title: 'Department steering mini-table: share bars and cost variances',
    kind: 'example',
    data: {
      columnGroups: [
        { id: 'cost', label: 'FY26 YTD', columns: ['actual', 'py', 'plan'] },
        { id: 'performance', label: 'Performance', columns: ['share', 'yoy', 'vsPlan'] },
      ],
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Department' },
        { id: 'actual', kind: 'value', label: 'AC', format: '$1k', aggregate: 'none' },
        { id: 'py', kind: 'value', label: 'PY', format: '$1k', aggregate: 'none' },
        { id: 'plan', kind: 'value', label: 'PL', format: '$1k', aggregate: 'none' },
        {
          id: 'share',
          kind: 'computed',
          label: 'Share',
          calc: { op: 'share', of: 'actual' },
          format: '1.1%',
        },
        {
          id: 'yoy',
          kind: 'computed',
          label: 'YoY',
          calc: { op: 'percentDelta', a: 'actual', b: 'py' },
          polarity: 'lowerIsBetter',
          format: '+1.1%',
        },
        {
          id: 'vsPlan',
          kind: 'computed',
          label: 'vs Plan',
          calc: { op: 'percentDelta', a: 'actual', b: 'plan' },
          polarity: 'lowerIsBetter',
          format: '+1.1%',
        },
      ],
      rows: [
        { id: 'operations', label: 'Operations', cells: { actual: 420_000, py: 440_000, plan: 410_000 } },
        {
          id: 'account-mgmt',
          label: 'Account management',
          cells: { actual: 475_000, py: 410_000, plan: 430_000, vsPlan: { tone: 'bad' } },
        },
        { id: 'technology', label: 'Technology', cells: { actual: 305_000, py: 315_000, plan: 325_000 } },
        {
          id: 'unassigned',
          label: 'Unassigned',
          relation: 'displayOnly',
          cells: { actual: null, py: null, plan: null },
        },
      ],
    },
    options: {
      variant: 'steering',
      size: { width: 648, height: 310 },
      density: 'compact',
      title: 'Account management is 10% over plan',
      subtitle: {
        measure: 'Department operating cost',
        period: 'FY26 YTD Jun',
        scenarios: ['AC', 'PY', 'PL'],
      },
      unit: '$k',
      source: 'Illustrative department cost ledger; Unassigned has not reported',
      encodings: { share: 'inCellBar' },
      highlight: 'account-mgmt',
    },
  },
  {
    // Scorecard: one row per entity carries a number, a state chip
    // and a one-line note. `wrap: true` on the note keeps the longest note
    // from setting the table's width floor, so the exhibit fits a slide.
    id: 'table-scorecard',
    title: 'Scorecard: one row per initiative with a value, a state chip and a wrapping note',
    kind: 'example',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Initiative' },
        { id: 'impact', kind: 'value', label: 'Impact', format: '$1.1m' },
        { id: 'state', kind: 'status', label: 'State' },
        { id: 'note', kind: 'text', label: 'Where it stands', wrap: true },
      ],
      rows: [
        {
          id: 'garden-cafe',
          label: 'Garden café pilot',
          cells: {
            impact: 4.2e6,
            state: 'on-track',
            note: 'Two of three stores have opened a café and the third opens in week 40, which releases the remaining budget',
          },
        },
        {
          id: 'price-architecture',
          label: 'Price architecture',
          cells: {
            // An explicit judgment tone on a figure: the run rate of an
            // at-risk initiative reads in the warn ink beside its chip.
            impact: { v: 1.8e6, tone: 'warn' },
            state: 'at-risk',
            note: 'List price approved, promo grid still open with the two largest accounts',
          },
        },
        {
          id: 'loyalty-card',
          label: 'Loyalty card',
          cells: {
            impact: -0.6e6,
            state: 'off-track',
            note: 'Sign-ups below plan since June and the welcome offer has not been tested',
          },
        },
        {
          id: 'supply',
          label: 'Supply reliability',
          cells: { impact: 2.4e6, state: 'done', note: 'Second source qualified' },
        },
      ],
    },
    options: {
      variant: 'hierarchy',
      size: { width: 720, height: 372 },
      title: 'Two of four initiatives need a decision this month',
      subtitle: { measure: 'Initiative scorecard', period: 'FY26 YTD' },
      source: 'Illustrative portfolio review; impact is the full-year run rate',
    },
  },
  {
    // Host wording on the five status keys, as a quiet mark: `labels` prints
    // each key as the host's own state, and `mark: 'square'` draws a small
    // tone square before ink text instead of a filled chip.
    id: 'table-status-square',
    title: 'Status column with host labels and the square mark',
    kind: 'example',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Ad set' },
        { id: 'spend', kind: 'value', label: 'Spend', format: '$1.1k' },
        {
          id: 'delivery',
          kind: 'status',
          label: 'Delivery',
          mark: 'square',
          labels: { 'on-track': 'Active', pending: 'Learning', 'at-risk': 'Learning limited', 'off-track': 'Rejected' },
        },
      ],
      rows: [
        { id: 'prospecting', label: 'Prospecting', cells: { spend: 4200, delivery: 'on-track' } },
        { id: 'retargeting', label: 'Retargeting', cells: { spend: 1800, delivery: 'pending' } },
        { id: 'lookalike', label: 'Lookalike', cells: { spend: 900, delivery: 'at-risk' } },
        { id: 'catalog', label: 'Catalog', cells: { spend: 300, delivery: 'off-track' } },
      ],
    },
    options: {
      size: { width: 560, height: 232 },
      title: 'Two of four ad sets are still learning',
      source: 'Illustrative delivery states',
    },
  },
  {
    // Competitor benchmark — flat, share + AST margin
    // (ratio-of-sums proof lives in the derive total row).
    id: 'benchmark-competitors',
    title: 'Benchmark: revenue share and margin with derived total',
    kind: 'example',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Company' },
        { id: 'revenue', kind: 'value', label: 'Revenue', format: '$1.2bn' },
        { id: 'gp', kind: 'value', label: 'Gross profit', format: '$1.2bn' },
        {
          id: 'share',
          kind: 'computed',
          label: 'Share',
          calc: { op: 'share', of: 'revenue' },
          format: '1.1%',
        },
        {
          id: 'margin',
          kind: 'computed',
          label: 'GP margin',
          calc: { op: 'mul', a: { op: 'div', a: { ref: 'gp' }, b: { ref: 'revenue' } }, b: { lit: 100 } },
          format: '1.1%',
        },
      ],
      rows: [
        {
          id: 'market',
          label: 'Market',
          role: 'total',
          children: [
            { id: 'alpha', label: 'Alpha Retail', cells: { revenue: 4.21e9, gp: 1.6e9 } },
            { id: 'beta', label: 'Beta Commerce', cells: { revenue: 3.48e9, gp: 1.1e9 } },
            { id: 'gamma', label: 'Gamma Group', cells: { revenue: 2.12e9, gp: 0.9e9 } },
            { id: 'delta', label: 'Delta Markets', cells: { revenue: 1.4e9, gp: 0.3e9 } },
            { id: 'eps', label: 'Epsilon Home', cells: { revenue: 0.77e9, gp: 0.3e9 } },
          ],
        },
      ],
    },
    options: {
      variant: 'benchmark',
      size: { width: 616, height: 405 },
      title: 'Two players hold 64% of the market',
      subtitle: { measure: 'European home retail', period: 'FY25' },
      source: 'Illustrative peer set; the market margin is a ratio of sums, not an average',
    },
  },
  {
    // Receipts / change log — dates + text, zero numeric machinery.
    id: 'receipts-changelog',
    title: 'Receipts: dated change log with old → new values',
    kind: 'example',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Change' },
        { id: 'date', kind: 'date', label: 'Date', format: '30 Sep 2026' },
        { id: 'scope', kind: 'text', label: 'Scope' },
        { id: 'change', kind: 'text', label: 'Old → new' },
        { id: 'status', kind: 'status', label: 'Status' },
      ],
      rows: [
        {
          id: 'c1',
          label: 'Budget rebalance DE→FR',
          cells: { date: '2026-05-12', scope: 'Search', change: '$120k → $90k', status: 'done' },
        },
        {
          id: 'c2',
          label: 'tCPA raise UK',
          cells: { date: '2026-06-02', scope: 'Automated campaign', change: '$38 → $45', status: 'done' },
        },
        {
          id: 'c3',
          label: 'Creative refresh wave 2',
          cells: { date: '2026-06-24', scope: 'Social', change: '14 → 22 assets', status: 'pending' },
        },
        {
          id: 'c4',
          label: 'Landing page test',
          cells: { date: '2026-07-08', scope: 'Onsite', change: null, status: 'at-risk' },
        },
      ],
    },
    options: {
      variant: 'receipts',
      size: { width: 644, height: 405 },
      title: 'Every account change since May, receipted',
      subtitle: { measure: 'Change log', period: 'May–Jul 2026' },
      source: 'Illustrative account change log; one row per approved change',
    },
  },
  {
    // Yearly pivot with inline annotations (composite cells).
    id: 'pivot-with-notes',
    title: 'Yearly pivot: metric rows with inline annotation cells',
    kind: 'example',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Metric' },
        { id: 'y24', kind: 'value', label: '2024', format: '1,234' },
        { id: 'y25', kind: 'value', label: '2025', format: '1,234' },
        { id: 'y26', kind: 'value', label: '2026', format: '1,234' },
      ],
      rows: [
        {
          id: 'sessions',
          label: 'Sessions (k)',
          cells: { y24: 8420, y25: 9105, y26: { v: 4480, note: '(H1 only)' } },
        },
        {
          id: 'cvr',
          label: 'Conversion (bps)',
          cells: { y24: 210, y25: 236, y26: { v: 244, tone: 'good' } },
        },
        {
          id: 'branded',
          label: 'Branded search share',
          cells: { y24: 61, y25: 52, y26: { v: 44, note: '(−51% vs peak)', tone: 'bad' } },
        },
      ],
    },
    options: {
      variant: 'hierarchy',
      size: { width: 474, height: 405 },
      title: 'The organic engine is slowing while conversion holds',
      subtitle: { measure: 'Demand health', period: '2024–2026' },
      source: 'Illustrative web analytics extract; 2026 covers H1 only',
    },
  },
  {
    // Torture case: cohort right-censoring — flat, no total row
    // (summing retention percentages gives an invalid total; a cohort table
    // has none). Nulls render '—' and tell the truth.
    id: 'cohort-retention',
    title: 'Torture: cohort table with right-censored cells',
    kind: 'torture',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Cohort' },
        { id: 'm1', kind: 'value', label: 'M1', format: '1%' },
        { id: 'm3', kind: 'value', label: 'M3', format: '1%' },
        { id: 'm6', kind: 'value', label: 'M6', format: '1%' },
        { id: 'm12', kind: 'value', label: 'M12', format: '1%' },
      ],
      rows: [
        { id: 'q1-25', label: 'Q1 2025', cells: { m1: 68, m3: 47, m6: 39, m12: 31 } },
        { id: 'q3-25', label: 'Q3 2025', cells: { m1: 71, m3: 49, m6: 41, m12: null } },
        { id: 'q1-26', label: 'Q1 2026', cells: { m1: 74, m3: 52, m6: null, m12: null } },
      ],
    },
    options: {
      size: { width: 361, height: 405 },
      title: 'Younger cohorts retain better — where data exists',
      subtitle: { measure: 'Subscriber retention', period: 'Cohorts 2025–2026' },
    },
  },
  {
    // Torture: nulls policy on aggregation — propagate makes the parent '—'
    // (no silent partial sums), skip sums what exists + auto 'partial'
    // footnote. Absolute values, so aggregation is legitimate.
    id: 'nulls-policy',
    title: 'Torture: missing child values under propagate vs skip',
    kind: 'torture',
    tags: ['demo', 'regression', 'missing-values'],
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Region' },
        { id: 'q1', kind: 'value', label: 'Q1', format: '$1.1m' },
        { id: 'q2', kind: 'value', label: 'Q2 (propagate)', format: '$1.1m' },
        { id: 'q3', kind: 'value', label: 'Q3 (skip)', format: '$1.1m', nulls: 'skip' },
      ],
      rows: [
        {
          id: 'emea',
          label: 'EMEA',
          role: 'total',
          children: [
            { id: 'de', label: 'Germany', cells: { q1: 10.2e6, q2: 11.0e6, q3: 11.4e6 } },
            { id: 'fr', label: 'France', cells: { q1: 6.1e6, q2: { v: null }, q3: null } },
            { id: 'uk', label: 'United Kingdom', cells: { q1: 7.4e6, q2: 7.9e6, q3: 8.1e6 } },
          ],
        },
      ],
    },
    options: {
      size: { width: 513, height: 405 },
      title: 'France has not reported Q2 — the total says so',
      subtitle: { measure: 'Revenue', period: 'FY26' },
      totalPosition: 'bottom',
    },
  },
  {
    // Region × month performance matrix. Each month owns its
    // range so the heat remains comparable down the column.
    id: 'heat-region-month-grid',
    title: 'Heat table: region × month grid across six numeric columns',
    kind: 'example',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Region' },
        { id: 'jan', kind: 'value', label: 'Jan', format: '+1.1%', aggregate: 'none' },
        { id: 'feb', kind: 'value', label: 'Feb', format: '+1.1%', aggregate: 'none' },
        { id: 'mar', kind: 'value', label: 'Mar', format: '+1.1%', aggregate: 'none' },
        { id: 'apr', kind: 'value', label: 'Apr', format: '+1.1%', aggregate: 'none' },
        { id: 'may', kind: 'value', label: 'May', format: '+1.1%', aggregate: 'none' },
        { id: 'jun', kind: 'value', label: 'Jun', format: '+1.1%', aggregate: 'none' },
      ],
      rows: [
        { id: 'north', label: 'North', cells: { jan: -3.2, feb: -1.1, mar: 0.8, apr: 2.4, may: 4.1, jun: 5.8 } },
        { id: 'south', label: 'South', cells: { jan: 1.6, feb: 2.8, mar: 3.4, apr: 1.2, may: -0.6, jun: -2.1 } },
        { id: 'east', label: 'East', cells: { jan: 5.2, feb: 4.4, mar: 2.1, apr: -0.8, may: -2.4, jun: -4.7 } },
        { id: 'west', label: 'West', cells: { jan: -0.4, feb: 0.3, mar: 1.7, apr: 3.8, may: 5.6, jun: 7.2 } },
      ],
    },
    options: {
      // The height the four rows take at this width in every theme, so no
      // blank canvas stands below the grid.
      size: { width: 537, height: 311 },
      title: 'Momentum rotated from East to West during H1',
      subtitle: { measure: 'Revenue growth vs prior year', period: 'Jan–Jun 2026' },
      source: 'Illustrative regional growth series; each month is scaled within its own column',
      encodings: { jan: 'heat', feb: 'heat', mar: 'heat', apr: 'heat', may: 'heat', jun: 'heat' },
    },
  },
  {
    // Creative-fatigue diagnostic. Raw early/recent metrics
    // stay auditable; the signed computed deltas carry adaptive arrows.
    id: 'fatigue-cell-encodings',
    title: 'Fatigue diagnostic: spend bars and arrows on three signed Δ% columns',
    kind: 'example',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Creative' },
        { id: 'spend', kind: 'value', label: 'Spend', format: '$1k', aggregate: 'none' },
        { id: 'ctrEarly', kind: 'value', label: 'CTR early', format: '1.1%', aggregate: 'none' },
        { id: 'ctrRecent', kind: 'value', label: 'CTR recent', format: '1.1%', aggregate: 'none' },
        { id: 'cvrEarly', kind: 'value', label: 'CVR early', format: '1.1%', aggregate: 'none' },
        { id: 'cvrRecent', kind: 'value', label: 'CVR recent', format: '1.1%', aggregate: 'none' },
        { id: 'cpaEarly', kind: 'value', label: 'CPA early', format: '$1.1', aggregate: 'none' },
        { id: 'cpaRecent', kind: 'value', label: 'CPA recent', format: '$1.1', aggregate: 'none' },
        {
          id: 'dCtr',
          kind: 'computed',
          label: 'Δ CTR',
          calc: { op: 'percentDelta', a: 'ctrRecent', b: 'ctrEarly' },
          polarity: 'higherIsBetter',
          format: '+1.1%',
        },
        {
          id: 'dCvr',
          kind: 'computed',
          label: 'Δ CVR',
          calc: { op: 'percentDelta', a: 'cvrRecent', b: 'cvrEarly' },
          polarity: 'higherIsBetter',
          format: '+1.1%',
        },
        {
          id: 'dCpa',
          kind: 'computed',
          label: 'Δ CPA',
          calc: { op: 'percentDelta', a: 'cpaRecent', b: 'cpaEarly' },
          polarity: 'lowerIsBetter',
          format: '+1.1%',
        },
      ],
      rows: [
        { id: 'planting', label: 'Planting guide', cells: { spend: 124000, ctrEarly: 1.8, ctrRecent: 1.1, cvrEarly: 3.2, cvrRecent: 2.1, cpaEarly: 42, cpaRecent: 71 } },
        { id: 'lawn', label: 'Lawn care tips', cells: { spend: 96000, ctrEarly: 1.4, ctrRecent: 1.5, cvrEarly: 2.8, cvrRecent: 2.9, cpaEarly: 55, cpaRecent: 52 } },
        { id: 'advice', label: 'Expert advice', cells: { spend: 51000, ctrEarly: 1.2, ctrRecent: 1.21, cvrEarly: 2.1, cvrRecent: 2.0, cpaEarly: 61, cpaRecent: 64 } },
        { id: 'tour', label: 'Store tour', cells: { spend: 0, ctrEarly: 0.9, ctrRecent: 0.7, cvrEarly: 1.8, cvrRecent: 1.4, cpaEarly: 73, cpaRecent: 88 } },
      ],
    },
    options: {
      // The height the four rows, the arrow key and its note take at this
      // width in every theme, so no blank canvas stands under them.
      size: { width: 1394, height: 397 },
      title: 'Planting guide is wearing out; lawn care tips still scale',
      subtitle: { measure: 'Online ad results by creative', period: 'First vs latest 7 active days' },
      source: 'Illustrative ad reporting; first and latest seven active days per creative',
      encodings: { spend: 'inCellBar', dCtr: 'arrow', dCvr: 'arrow', dCpa: 'arrow' },
    },
  },
  {
    // A percent change can still angle its arrow against the column's largest
    // change (scale: 'relative'); the key then says so.
    id: 'arrow-relative-percent',
    title: 'Arrows on a percent change, angled against the largest change',
    kind: 'torture',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Region' },
        { id: 'early', kind: 'value', label: 'H1', format: '1.1%', aggregate: 'none' },
        { id: 'late', kind: 'value', label: 'H2', format: '1.1%', aggregate: 'none' },
        { id: 'change', kind: 'computed', label: 'Δ', calc: { op: 'percentDelta', a: 'late', b: 'early' }, polarity: 'higherIsBetter', format: '+1.1%' },
      ],
      rows: [
        { id: 'north', label: 'North', cells: { early: 2.0, late: 2.1 } },
        { id: 'south', label: 'South', cells: { early: 2.4, late: 2.2 } },
        { id: 'west', label: 'West', cells: { early: 1.8, late: 1.86 } },
      ],
    },
    options: {
      title: 'Small changes still read as rises and falls',
      encodings: { change: { type: 'arrow', scale: 'relative' } },
    },
  },
  {
    // Compact KPI time series. The table keeps the source
    // columns visible next to the derived sparkline column.
    id: 'kpi-trend-sparkline',
    title: 'KPI trend: sparkline with the source columns kept visible',
    kind: 'torture',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'KPI' },
        { id: 'm1', kind: 'value', label: 'Jan', format: '1.1', aggregate: 'none' },
        { id: 'm2', kind: 'value', label: 'Feb', format: '1.1', aggregate: 'none' },
        { id: 'm3', kind: 'value', label: 'Mar', format: '1.1', aggregate: 'none' },
        { id: 'm4', kind: 'value', label: 'Apr', format: '1.1', aggregate: 'none' },
        { id: 'm5', kind: 'value', label: 'May', format: '1.1', aggregate: 'none' },
        { id: 'm6', kind: 'value', label: 'Jun', format: '1.1', aggregate: 'none' },
        {
          id: 'trend',
          kind: 'encoding',
          label: 'Trend',
          encoding: { type: 'sparkline', sourceColumns: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] },
        },
      ],
      rows: [
        { id: 'revenue', label: 'Revenue index', cells: { m1: 82, m2: 89, m3: 91, m4: null, m5: 104, m6: 112 } },
        { id: 'margin', label: 'Gross margin', cells: { m1: 31, m2: 31, m3: 31, m4: 31, m5: 31, m6: 31 } },
        { id: 'nps', label: 'NPS', cells: { m1: 44, m2: null, m3: 48, m4: 51, m5: null, m6: 55 } },
        { id: 'pending', label: 'Pipeline data pending', cells: { m1: null, m2: null, m3: null, m4: null, m5: null, m6: null } },
      ],
    },
    options: {
      size: { width: 644, height: 405 },
      title: 'Revenue accelerated through June; pipeline is not yet reported',
      subtitle: { measure: 'Six-month KPI readout', period: 'Jan–Jun 2026' },
    },
  },
  {
    id: 'sparkline-line-column',
    title: 'Line and column sparklines share one y-domain per column; last values labelled',
    kind: 'torture',
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'KPI' },
        { id: 'm1', kind: 'value', label: 'Q1', format: '1', aggregate: 'none' },
        { id: 'm2', kind: 'value', label: 'Q2', format: '1', aggregate: 'none' },
        { id: 'm3', kind: 'value', label: 'Q3', format: '1', aggregate: 'none' },
        { id: 'm4', kind: 'value', label: 'Q4', format: '1', aggregate: 'none' },
        {
          id: 'trend',
          kind: 'encoding',
          label: 'Trend',
          encoding: { type: 'sparkline', kind: 'line', sourceColumns: ['m1', 'm2', 'm3', 'm4'] },
        },
        {
          id: 'volume',
          kind: 'encoding',
          label: 'Volume',
          encoding: { type: 'sparkline', kind: 'column', sourceColumns: ['m1', 'm2', 'm3', 'm4'] },
        },
      ],
      rows: [
        { id: 'alpha', label: 'Alpha', cells: { m1: 8, m2: 10, m3: null, m4: 12 } },
        { id: 'beta', label: 'Beta', cells: { m1: 40, m2: 48, m3: 52, m4: 60 } },
        { id: 'empty', label: 'Unreported', cells: { m1: null, m2: null, m3: null, m4: null } },
      ],
    },
    options: {
      size: { width: 640, height: 280 },
      title: 'Alpha stays small against the shared scale; Q3 is unreported',
    },
  },
  managementReportFixture('en'),
  managementReportFixture('de'),
  managementCompactFixture(),
];

const steering = fixtures.find((fixture) => fixture.id === 'steering-monthly')!;
fixtures.push({
  ...steering,
  id: 'status-review-relaxed',
  kind: 'example',
  title: 'Status review with more space between business units',
  options: { ...steering.options, variant: 'status', density: 'relaxed',
    subtitle: { measure: 'Revenue by business unit', period: 'FY26 YTD Mar', scenarios: ['AC', 'PL'] } },
});
// textScale: a denser table; each face stops at the report floor.
const scorecard = fixtures.find((fixture) => fixture.id === 'table-scorecard')!;
fixtures.push({
  ...scorecard,
  id: 'text-scale-small',
  title: 'textScale 0.85 sets the table faces smaller, each stopping at the report floor',
  kind: 'torture',
  options: { ...scorecard.options, textScale: 0.85 },
});

const cashMovementData: TableData = {
  columns: [
    {
      id: "month",
      kind: "rowLabel",
      label: "Month"
    },
    {
      id: "cash",
      kind: "value",
      label: "Net cash (CHF)"
    }
  ],
  rows: [
    {
      id: "jan",
      label: "Jan",
      cells: {
        cash: 1250
      }
    },
    {
      id: "feb",
      label: "Feb",
      cells: {
        cash: -875
      }
    },
    {
      id: "mar",
      label: "Mar",
      cells: {
        cash: 1600
      }
    }
  ]
};

fixtures.push(
  {
    id: "shared-swiss-cash-movement",
    title: "Cash movements with swiss number grouping",
    kind: "example",
    tags: [
      "shared-options",
      "host"
    ],
    data: cashMovementData,
    options: {
      title: "March cash inflow exceeds the February outflow",
      subtitle: {
        measure: "Monthly net cash movement",
        period: "Q1 2026"
      },
      locale: {
        language: "en-CH",
        decimal: ".",
        thousands: "’"
      },
      source: "Illustrative treasury data",
      unit: "CHF"
    }
  },
  {
    id: "shared-spaced-cash-movement",
    title: "Cash movements with spaced number grouping",
    kind: "torture",
    tags: [
      "shared-options",
      "host"
    ],
    data: cashMovementData,
    options: {
      title: "March cash inflow exceeds the February outflow",
      subtitle: {
        measure: "Monthly net cash movement",
        period: "Q1 2026"
      },
      locale: {
        language: "fr",
        decimal: ".",
        thousands: " "
      },
      source: "Illustrative treasury data",
      unit: "CHF"
    }
  },
  {
    // The theme sets figures on numeric roles only; row labels, title
    // and source never carry a figure setting.
    id: 'proportional-figures',
    title: 'Theme with proportional figures on numbers',
    kind: 'example',
    tags: ['theme'],
    data: { ...cashMovementData, columns: [cashMovementData.columns[0]!, { ...cashMovementData.columns[1]!, label: 'Net cash ($)' }] },
    options: {
      title: 'March cash inflow exceeds the February outflow',
      subtitle: { measure: 'Monthly net cash movement', period: 'Q1 2026' },
      source: 'Illustrative treasury data',
      unit: '$',
      theme: { preset: 'boardroom', overrides: { type: { numeric: 'proportional' } } },
    },
  },
);

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Initiative' },
      { id: 'impact', kind: 'value', label: 'Impact', format: '$1.1m' },
      { id: 'state', kind: 'status', label: 'State' },
      { id: 'note', kind: 'text', label: 'Where it stands', wrap: true },
    ],
    rows: [
      {
        id: 'retail-media',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
        cells: {
          impact: 4200000,
          state: 'on-track',
          note: 'Two of three retailers are live and the third signs in week 40, which releases the remaining budget',
        },
      },
      {
        id: 'price-architecture',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
        cells: {
          impact: 1800000,
          state: 'at-risk',
          note: 'List price approved, promo grid still open with the two largest accounts',
        },
      },
      {
        id: 'dtc-subscription',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
        cells: {
          impact: -600000,
          state: 'off-track',
          note: 'Churn above plan since June and the win-back offer has not been tested',
        },
      },
      {
        id: 'supply',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
        cells: { impact: 2400000, state: 'done', note: 'Second source qualified' },
      },
    ],
  },
  options: {
    variant: 'hierarchy',
    size: { width: 1440, height: 900 },
    title: 'Long names read whole at a generous size',
    subtitle: { measure: 'Initiative scorecard', period: 'FY26 YTD' },
    source: 'Illustrative portfolio review; impact is the full-year run rate',
  },
});

fixtures.push({
  id: 'steering-kpi-rows',
  title: 'KPI rows with their own units: revenue in $M, new customers as a count, CAC in $, across month columns',
  kind: 'example',
  tags: ['demo', 'row-format'],
  data: {
    columnGroups: [{ id: 'months', label: '2026 months', columns: ['jan', 'feb', 'mar', 'apr', 'may', 'jun'] }],
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'KPI' },
      { id: 'jan', kind: 'value', label: 'Jan 26', scenario: 'AC' },
      { id: 'feb', kind: 'value', label: 'Feb 26', scenario: 'AC' },
      { id: 'mar', kind: 'value', label: 'Mar 26', scenario: 'AC' },
      { id: 'apr', kind: 'value', label: 'Apr 26', scenario: 'AC' },
      { id: 'may', kind: 'value', label: 'May 26', scenario: 'AC' },
      { id: 'jun', kind: 'value', label: 'Jun 26', scenario: 'AC' },
      // The year to date is the six months shown.
      { id: 'ytd', kind: 'value', label: '2026 YTD', subLabel: 'Jan to Jun', aggregate: 'source' },
      { id: 'yoy', kind: 'value', label: 'YoY', format: '+1.1%', polarity: 'higherIsBetter' },
    ],
    rows: [
      {
        id: 'revenue',
        label: 'Revenue',
        role: 'section',
        children: [
          {
            id: 'net-revenue',
            label: 'Net revenue',
            format: '$1.2m',
            cells: { jan: 6100000, feb: 6400000, mar: 6600000, apr: 6300000, may: 6900000, jun: 7200000, ytd: 39500000, yoy: 9.8 },
            children: [
              {
                id: 'net-revenue-mom',
                label: 'MoM %',
                relation: 'displayOnly',
                inline: true,
                inlineGroup: 'mom',
                format: '+1.1%',
                polarity: 'higherIsBetter',
                calc: { op: 'percentDelta', a: { row: 'net-revenue' }, b: { row: 'net-revenue', previous: true } },
              },
            ],
          },
        ],
      },
      {
        id: 'acquisition',
        label: 'Acquisition',
        role: 'section',
        children: [
          {
            id: 'new-customers',
            label: 'New customers',
            format: '1,234',
            cells: { jan: 12400, feb: 11800, mar: 12900, apr: 12100, may: 13600, jun: 14200, ytd: 77000, yoy: 4.5 },
          },
          {
            id: 'spend',
            label: 'Marketing spend',
            format: '$1.2m',
            cells: { jan: 1100000, feb: 1150000, mar: 1090000, apr: 1200000, may: 1240000, jun: 1310000, ytd: 7090000, yoy: 6.1 },
          },
          {
            id: 'cac',
            label: 'CAC',
            format: '$1,234',
            // A cost per customer: lower is better in every change it prints.
            polarity: 'lowerIsBetter',
            cells: { jan: 89, feb: 97, mar: 84, apr: 99, may: 91, jun: 92, ytd: 92, yoy: -4.2 },
            children: [
              {
                id: 'cac-mom',
                label: 'MoM %',
                relation: 'displayOnly',
                inline: true,
                inlineGroup: 'mom',
                format: '+1.1%',
                polarity: 'lowerIsBetter',
                calc: { op: 'percentDelta', a: { row: 'cac' }, b: { row: 'cac', previous: true } },
              },
            ],
          },
          {
            // A share KPI: its YoY is a difference of two percent levels, so
            // that one cell names points over the column's percent.
            id: 'first-order-share',
            label: 'First-order share',
            format: '1.2%',
            cells: { jan: 31.9, feb: 32.4, mar: 33.1, apr: 33.5, may: 34.0, jun: 34.6, ytd: 33.3, yoy: { v: 2.7, format: '+1.1pp' } },
          },
        ],
      },
    ],
  },
  options: {
    variant: 'steering',
    density: 'compact',
    stickyLabels: true,
    expansion: { depth: 'all' },
    // The width pays for the MoM lines inside the cell: a signed change
    // claims width in its parent's column. The height pays for the KPI rows
    // under a section heading, which take the ladder's top rung (the heading
    // does not count as a level), and for the first-order share row, whose
    // YoY cell prints points.
    size: { width: 1059, height: 509 },
    title: 'CAC held near $90 while revenue grew 18% over the half year',
    subtitle: { measure: 'Monthly KPIs', period: 'Jan to Jun 2026' },
    source: 'Illustrative steering fixture; every row names its own unit through its format',
  },
});

/**
 * A monthly KPI board: twelve months and their average, two sections, and a
 * value line plus a change line in every KPI row. Each section row opens a
 * new block: air above it, a label one step above the row labels, and never
 * shorter than the two-line KPI rows under it.
 */
const KPI_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
function monthlyKpi(id: string, label: string, format: string, values: number[], polarity: 'higherIsBetter' | 'lowerIsBetter' = 'higherIsBetter'): TableRow {
  const cells: Record<string, TableCell> = Object.fromEntries(KPI_MONTHS.map((month, index) => [month, values[index]!]));
  cells.avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    id, label, format, polarity, cells,
    children: [{
      id: `${id}-mom`, label: 'MoM %', relation: 'displayOnly', inline: true, inlineGroup: 'mom', format: '+1.1%', polarity,
      calc: { op: 'percentDelta', a: { row: id }, b: { row: id, previous: true } },
    }],
  };
}
// Invented monthly inputs; order value, conversion, ROAS and cost per order derive from them.
const KPI_REVENUE = [3.8, 3.6, 4.1, 4.3, 4.5, 4.2, 4.6, 4.9, 4.7, 5.1, 5.8, 6.3].map((v) => v * 1e6);
const KPI_ORDERS = [17600, 17000, 18800, 19500, 20300, 19400, 20800, 22000, 21400, 22800, 26200, 29000];
const KPI_SESSIONS = [800, 780, 810, 820, 840, 820, 840, 860, 850, 870, 930, 980].map((v) => v * 1000);
const KPI_SPEND = [0.75, 0.72, 0.84, 0.88, 0.94, 0.88, 0.98, 1.05, 1.0, 1.1, 1.36, 1.52].map((v) => v * 1e6);
fixtures.push({
  id: 'monthly-kpi-sections',
  title: 'Monthly KPI board: two sections over twelve months and their average, a change line under every value',
  kind: 'example',
  tags: ['demo', 'row-format'],
  data: {
    columnGroups: [{ id: 'months', label: '2026', columns: [...KPI_MONTHS] }],
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'KPI' },
      ...KPI_MONTHS.map((month) => ({ id: month, kind: 'value' as const, label: month[0]!.toUpperCase() + month.slice(1) })),
      { id: 'avg', kind: 'value', label: '12M avg', aggregate: 'source' },
    ],
    rows: [
      { id: 'sales', label: 'Sales', role: 'section', children: [
        monthlyKpi('revenue', 'Revenue', '$1.2m', KPI_REVENUE),
        monthlyKpi('orders', 'Orders', '1,234', KPI_ORDERS),
        monthlyKpi('aov', 'Avg order value', '$1.2', KPI_REVENUE.map((revenue, i) => revenue / KPI_ORDERS[i]!)),
        monthlyKpi('conversion', 'Conversion rate', '1.2%', KPI_ORDERS.map((orders, i) => (orders / KPI_SESSIONS[i]!) * 100)),
        monthlyKpi('returns', 'Return rate', '1.2%', [8.0, 7.8, 7.6, 7.9, 7.4, 7.5, 7.2, 7.3, 7.4, 7.0, 8.5, 9.0], 'lowerIsBetter'),
      ] },
      { id: 'ads', label: 'Advertising', role: 'section', children: [
        monthlyKpi('spend', 'Ad spend', '$1.2m', KPI_SPEND),
        monthlyKpi('roas', 'ROAS', '1.2x', KPI_REVENUE.map((revenue, i) => revenue / KPI_SPEND[i]!)),
        monthlyKpi('cpa', 'Cost per order', '$1.2', KPI_SPEND.map((spend, i) => spend / KPI_ORDERS[i]!), 'lowerIsBetter'),
        monthlyKpi('ctr', 'Click-through rate', '1.2%', [1.4, 1.4, 1.5, 1.5, 1.5, 1.4, 1.5, 1.6, 1.5, 1.6, 1.7, 1.8]),
      ] },
    ],
  },
  options: {
    variant: 'steering',
    expansion: { depth: 'all' },
    title: 'Revenue rose every quarter while ROAS drifted down',
    subtitle: { measure: 'Monthly KPIs', period: 'Jan to Dec 2026' },
    source: 'Illustrative KPI board',
  },
});

/**
 * The level ladder itself: one section, a total at the top, and a KPI that
 * runs four levels deep, so every step of size, weight, indent and ground is
 * visible in one exhibit.
 */
fixtures.push({
  id: 'table-level-ladder',
  title: 'Four levels of one KPI, two body sizes and a compact value block',
  kind: 'example',
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Revenue line' },
      { id: 'py', kind: 'value', label: '2025', format: '1,234' },
      { id: 'ac', kind: 'value', label: '2026', format: '1,234' },
      {
        id: 'yoy',
        kind: 'computed',
        label: 'YoY',
        calc: { op: 'percentDelta', a: 'ac', b: 'py' },
        format: '+1.1%',
        polarity: 'higherIsBetter',
      },
    ],
    rows: [
      { id: 'group-total', label: 'Group', role: 'total', totalPolicy: 'source', cells: { py: 5270, ac: 5688 } },
      // A section is a heading, not a parent: the rows under it keep their
      // own levels, so the ladder below starts at level 0.
      { id: 'section-recurring', label: 'Recurring', role: 'section' },
      {
        id: 'subscriptions',
        label: 'Subscriptions',
        children: [
          {
            id: 'subs-direct',
            label: 'Direct',
            children: [
              {
                id: 'subs-direct-eu',
                label: 'Europe',
                children: [
                  { id: 'subs-direct-eu-de', label: 'Germany', cells: { py: 1840, ac: 2120 } },
                  { id: 'subs-direct-eu-fr', label: 'France', cells: { py: 960, ac: 1015 } },
                ],
              },
              { id: 'subs-direct-uk', label: 'United Kingdom', cells: { py: 1240, ac: 1180 } },
            ],
          },
          { id: 'subs-retail', label: 'Retail', cells: { py: 820, ac: 905 } },
        ],
      },
      { id: 'services', label: 'Services', cells: { py: 410, ac: 468 } },
    ],
    levelNouns: [
      { one: 'stream', other: 'streams' },
      { one: 'channel', other: 'channels' },
      { one: 'route', other: 'routes' },
      { one: 'region', other: 'regions' },
      { one: 'market', other: 'markets' },
    ],
  },
  options: {
    // The default fills the frame. Value tracks grow by at most 1.25;
    // the label track takes the remaining width.
    variant: 'hierarchy',
    maxGrowth: 1.25,
    totalPosition: 'top',
    expansion: { depth: 'all' },
    size: { width: 760, height: 476 },
    title: 'Subscriptions carry the growth; Germany alone adds 280',
    subtitle: { measure: 'Recurring revenue', period: 'FY26' },
    unit: '$k',
    source: 'Illustrative ladder fixture',
  },
});

/**
 * Steering table with inline change lines: the monthly KPI board of an invented chain of garden
 * centres with stores and a web shop, with the change lines printed inside the
 * cell instead of as rows of their own. Every KPI prints its month-on-month
 * and year-on-year line under its value; every sub-KPI prints its share of
 * the KPI above it; a host's Changes control hides a whole group of lines at
 * once through `inlineVisibility`.
 *
 * The numbers are synthetic: one base and one seasonal shape per line, one
 * shape set per year, and arithmetic over them for everything else.
 * AOV, the cost per web order and spend to revenue are computed from the
 * lines above them, so the board reconciles with itself.
 */
const V2_MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** 2026 is nine months in, so every shape runs to September and three columns stay open. */
const V2_OPEN_MONTHS = 3;
const V2_SHAPE_26 = {
  base: [1, 0.97, 0.99, 1.06, 1, 1.02, 1.04, 1.09, 1.14],
  newCustomer: [1, 0.94, 0.97, 1.09, 0.98, 1, 1.02, 1.1, 1.17],
  orders: [1, 0.98, 0.99, 1.04, 0.99, 1, 1.01, 1.05, 1.09],
  spend: [1, 1.02, 1.05, 1.03, 1.08, 1.12, 1.15, 1.2, 1.26],
  sessions: [1, 0.99, 1.01, 1.05, 1.02, 1.04, 1.07, 1.12, 1.18],
  mix: [1, 1.01, 1, 1.02, 1.03, 1.02, 1.04, 1.05, 1.06],
} as const;
const V2_SHAPE_25 = {
  base: [1, 0.95, 1, 1.03, 0.98, 1, 1.05, 1.12, 1.18, 0.93, 0.88, 0.9],
  newCustomer: [1, 0.93, 0.99, 1.05, 0.96, 0.99, 1.03, 1.14, 1.2, 0.91, 0.86, 0.88],
  orders: [1, 0.96, 1.01, 1.02, 0.99, 1.01, 1.04, 1.1, 1.15, 0.94, 0.9, 0.92],
  spend: [1, 1.01, 1.03, 1, 1.04, 1.06, 1.1, 1.14, 1.18, 0.96, 0.92, 0.95],
  sessions: [1, 0.97, 1.02, 1.04, 1, 1.02, 1.06, 1.11, 1.16, 0.95, 0.9, 0.93],
  mix: [1, 0.99, 1, 1.01, 1, 1.01, 1.02, 1.03, 1.04, 1.02, 1.01, 1.03],
} as const;
/** One shape for the year before last; it is only the base of the 2025 year-on-year line. */
const V2_SHAPE_24 = [1, 0.98, 0.96, 1.01, 1, 0.97, 1.06, 1.1, 1.15, 0.95, 0.9, 0.92] as const;

/** Round to a decimal step; a negative count rounds to thousands. */
function v2Round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function v2Series(base: number, shape: readonly number[], decimals: number): number[] {
  return shape.map((factor) => v2Round(base * factor, decimals));
}

const v2Sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const v2Add = (a: readonly number[], b: readonly number[]): number[] => a.map((value, index) => value + b[index]!);
const v2Ratio = (a: readonly number[], b: readonly number[], decimals: number, scale = 1): number[] =>
  a.map((value, index) => v2Round((scale * value) / b[index]!, decimals));
/** Three series of one line: the year in progress, the year before, and the one before that. */
interface V2Line {
  y26: number[];
  y25: number[];
  y24: number[];
}

function v2Line(base26: number, base25: number, base24: number, shape: keyof typeof V2_SHAPE_26, decimals: number): V2Line {
  return {
    y26: v2Series(base26, V2_SHAPE_26[shape], decimals),
    y25: v2Series(base25, V2_SHAPE_25[shape], decimals),
    y24: v2Series(base24, V2_SHAPE_24, decimals),
  };
}

const v2Combine = (a: V2Line, b: V2Line): V2Line =>
  ({ y26: v2Add(a.y26, b.y26), y25: v2Add(a.y25, b.y25), y24: v2Add(a.y24, b.y24) });
const v2Derive = (a: V2Line, b: V2Line, decimals: number, scale = 1): V2Line => ({
  y26: v2Ratio(a.y26, b.y26, decimals, scale),
  y25: v2Ratio(a.y25, b.y25, decimals, scale),
  y24: v2Ratio(a.y24, b.y24, decimals, scale),
});

const V2_REVENUE_NC = v2Line(1_200_000, 1_075_000, 985_000, 'newCustomer', -3);
const V2_REVENUE_EC = v2Line(5_780_000, 5_002_000, 4_660_000, 'base', -3);
const V2_ORDERS_NC = v2Line(12_000, 11_200, 10_600, 'newCustomer', -1);
const V2_ORDERS_EC = v2Line(68_000, 61_000, 58_000, 'orders', -1);
const V2_SPEND_SOCIAL = v2Line(700_000, 610_000, 548_000, 'spend', -3);
const V2_SPEND_SEARCH = v2Line(500_000, 410_000, 384_000, 'base', -3);
const V2_SESSIONS_PAID = v2Line(1_080_000, 960_000, 861_000, 'sessions', -3);
const V2_SESSIONS_ORGANIC = v2Line(1_320_000, 1_220_000, 1_170_000, 'base', -3);
const V2_MIX_SUB = v2Line(62, 58.5, 56.2, 'mix', 1);
const V2_MIX_OTP: V2Line = {
  y26: V2_MIX_SUB.y26.map((share) => v2Round(100 - share, 1)),
  y25: V2_MIX_SUB.y25.map((share) => v2Round(100 - share, 1)),
  y24: V2_MIX_SUB.y24.map((share) => v2Round(100 - share, 1)),
};

const V2_REVENUE = v2Combine(V2_REVENUE_NC, V2_REVENUE_EC);
const V2_ORDERS = v2Combine(V2_ORDERS_NC, V2_ORDERS_EC);
const V2_SPEND = v2Combine(V2_SPEND_SOCIAL, V2_SPEND_SEARCH);
const V2_SESSIONS = v2Combine(V2_SESSIONS_PAID, V2_SESSIONS_ORGANIC);
const V2_AOV = v2Derive(V2_REVENUE, V2_ORDERS, 2);
const V2_CAC = v2Derive(V2_SPEND, V2_ORDERS_NC, 0);
const V2_CSR = v2Derive(V2_SPEND, V2_REVENUE, 1, 100);

interface V2Row {
  id: string;
  label: string;
  line: V2Line;
  format: string;
  /**
   * Which direction is favourable for this KPI's CHANGE. It stays off the
   * level: a CAC of $100 is neither good nor bad, a CAC that rose is bad.
   */
  changePolarity?: 'higherIsBetter' | 'lowerIsBetter';
  /** A sum line totals its months; a ratio line is handed its own totals. */
  totals?: { ytd: number; fy: number; priorYtd: number; priorFy: number };
  /** The unit beside the KPI name, at every scale the reader picks. */
  unit?: string;
  /** What the block columns do to the months: 'sum' on a level, 'avg' on a rate. */
  blockNote?: string;
}

const V2_MONTHS_26 = V2_SHAPE_26.base.length;

/** The totals of a line that adds up: the nine months, the twelve before them, the twelve before those. */
function v2SumTotals(line: V2Line): NonNullable<V2Row['totals']> {
  return {
    ytd: v2Sum(line.y26), fy: v2Sum(line.y25),
    priorYtd: v2Sum(line.y25.slice(0, V2_MONTHS_26)), priorFy: v2Sum(line.y24),
  };
}

/** The totals of a ratio: the ratio of the sums, never the sum of the ratios. */
function v2RatioTotals(numerator: V2Line, denominator: V2Line, decimals: number, scale = 1): NonNullable<V2Row['totals']> {
  const at = (a: readonly number[], b: readonly number[], count?: number): number =>
    v2Round((scale * v2Sum(a.slice(0, count))) / v2Sum(b.slice(0, count)), decimals);
  return {
    ytd: at(numerator.y26, denominator.y26), fy: at(numerator.y25, denominator.y25),
    priorYtd: at(numerator.y25, denominator.y25, V2_MONTHS_26), priorFy: at(numerator.y24, denominator.y24),
  };
}

/** The average of a share line across its months, which is what its total means. */
function v2MeanTotals(line: V2Line): NonNullable<V2Row['totals']> {
  const mean = (values: readonly number[], count = values.length): number =>
    v2Round(v2Sum(values.slice(0, count)) / count, 1);
  return {
    ytd: mean(line.y26), fy: mean(line.y25),
    priorYtd: mean(line.y25, V2_MONTHS_26), priorFy: mean(line.y24),
  };
}

/**
 * One row's cells across the board: nine 2026 months, three the year has not
 * reached, the YTD, twelve 2025 months and the 2025 total.
 */
function v2Cells(row: V2Row, blockNote?: string): Record<string, TableCell> {
  const totals = row.totals ?? v2SumTotals(row.line);
  const cells: Record<string, TableCell> = {};
  row.line.y26.forEach((value, index) => { cells[`m${index + 1}`] = value; });
  // The months the year has not reached are open, empty on the band.
  for (let open = 0; open < V2_OPEN_MONTHS; open += 1) {
    cells[`m${V2_MONTHS_26 + open + 1}`] = { state: 'open' };
  }
  // A KPI's block figure says what it did to the months, on a line of its
  // own under the figure: a level is summed, a rate averaged. It
  // sits in the slot the month-on-month line leaves free, because a
  // year-to-date figure has no month before it. A sub-KPI's block cell
  // prints its share there and carries no note.
  cells.ytd = blockNote === undefined ? totals.ytd : { v: totals.ytd, note: blockNote };
  row.line.y25.forEach((value, index) => { cells[`p${index + 1}`] = value; });
  cells.fy = blockNote === undefined ? totals.fy : { v: totals.fy, note: blockNote };
  return cells;
}

/** A KPI kept in percent: its changes are differences in points, never relative changes of a rate. */
const v2Percent = (row: V2Row): boolean => row.format.endsWith('%');

/** The year-on-year line's own cells: each drawn period against the same period a year earlier. */
function v2YoyCells(row: V2Row): Record<string, TableCell> {
  const totals = row.totals ?? v2SumTotals(row.line);
  // A rate changes by points (17.2 % to 17.8 % is +0.6 pp); a level by percent.
  const change = v2Percent(row)
    ? (now: number, before: number) => v2Round(now - before, 1)
    : (now: number, before: number) => v2Round((100 * (now - before)) / Math.abs(before), 1);
  const yoy = (now: readonly number[], before: readonly number[]) => now.map((value, index) => change(value, before[index]!));
  const cells: Record<string, TableCell> = {};
  yoy(row.line.y26, row.line.y25.slice(0, V2_MONTHS_26)).forEach((value, index) => { cells[`m${index + 1}`] = value; });
  for (let open = 0; open < V2_OPEN_MONTHS; open += 1) {
    cells[`m${V2_MONTHS_26 + open + 1}`] = { state: 'open' };
  }
  cells.ytd = change(totals.ytd, totals.priorYtd);
  yoy(row.line.y25, row.line.y24).forEach((value, index) => { cells[`p${index + 1}`] = value; });
  cells.fy = change(totals.fy, totals.priorFy);
  return cells;
}

/** A KPI line with its two change lines inside the cell, and its sub-KPIs under it. */
function v2Kpi(row: V2Row, children: TableRow[] = []): TableRow {
  return {
    id: row.id,
    label: row.label,
    format: row.format,
    ...(row.unit === undefined ? {} : { unitAffix: row.unit }),
    // A KPI with sub-KPIs takes their sum; one without carries its own cells.
    ...(children.length > 0
      ? {}
      : { cells: v2Cells(row, row.blockNote ?? (row.totals === undefined ? 'sum' : 'avg')) }),
    children: [
      {
        id: `${row.id}-mom`, label: 'MoM', relation: 'displayOnly', inline: true, inlineGroup: 'mom',
        format: v2Percent(row) ? '+1.1pp' : '+1.1%', polarity: row.changePolarity ?? 'higherIsBetter',
        calc: { op: v2Percent(row) ? 'delta' : 'percentDelta', a: { row: row.id }, b: { row: row.id, previous: true } },
      },
      {
        id: `${row.id}-yoy`, label: 'YoY', relation: 'displayOnly', inline: true, inlineGroup: 'yoy',
        format: v2Percent(row) ? '+1.1pp' : '+1.1%', cells: v2YoyCells(row),
      },
      ...children,
    ],
  };
}

/** A sub-KPI with its share of the KPI above it, printed on its own line in the cell. */
function v2Sub(row: V2Row, parentId: string, shareLabel: string): TableRow {
  return {
    id: row.id,
    label: row.label,
    format: row.format,
    cells: v2Cells(row),
    children: [{
      id: `${row.id}-share`, label: shareLabel, relation: 'displayOnly', inline: true, inlineGroup: 'share',
      format: '1.1%',
      // `op: 'share'` is the share of the COLUMN's leaf total, which on a
      // board of eight unrelated sections means nothing; this is the share of
      // the parent, and the record carries both operands.
      calc: { op: 'mul', a: { op: 'div', a: { ref: { row: row.id } }, b: { ref: { row: parentId } } }, b: { lit: 100 } },
    }],
  };
}

const V2_MONEY = '$1.2m';
const V2_COUNT = '1,234';

fixtures.push({
  id: 'steering-table-v2',
  title: 'Monthly KPIs with the change lines inside the cell, 2026 YTD after nine months',
  kind: 'example',
  tags: ['demo', 'inline-rows'],
  data: {
    columnGroups: [
      { id: 'fy26', label: '2026 months', columns: V2_MONTH_LABELS.map((_, index) => `m${index + 1}`) },
      // Each block column is a group of its own: `previous: true` reads the
      // preceding member of the same group, so a total sharing a group with
      // the months would print a month-on-month change against December.
      { id: 'fy26-ytd', label: '2026 YTD', columns: ['ytd'], band: true },
      { id: 'fy25', label: '2025 months', columns: V2_MONTH_LABELS.map((_, index) => `p${index + 1}`) },
      { id: 'fy25-total', label: '2025', columns: ['fy'], band: true },
    ],
    columnToggles: [
      { id: 'fy26', label: '2026', columns: V2_MONTH_LABELS.map((_, index) => `m${index + 1}`), defaultVisible: true },
      { id: 'fy25', label: '2025', columns: V2_MONTH_LABELS.map((_, index) => `p${index + 1}`), defaultVisible: false },
    ],
    columns: [
      // No authored width: a section heading spans the table, so the track
      // is what the KPI labels and their lines need.
      { id: 'label', kind: 'rowLabel', label: 'KPI' },
      // The first open month names the open block once in its head.
      ...V2_MONTH_LABELS.map((month, index) => ({
        // The group head names the year, so a month head is the month
        // alone and the three open months take narrow tracks.
        id: `m${index + 1}`, kind: 'value' as const, label: month,
        ...(index === V2_MONTHS_26 ? { subLabel: 'open' } : {}),
      })),
      { id: 'ytd', kind: 'value', label: 'YTD', noteLine: true },
      ...V2_MONTH_LABELS.map((month, index) => ({ id: `p${index + 1}`, kind: 'value' as const, label: month })),
      { id: 'fy', kind: 'value', label: 'Total', noteLine: true },
    ],
    rows: [
      { id: 'sec-revenue', label: 'Revenue', role: 'section', children: [
        v2Kpi({ id: 'revenue', label: 'Revenue (net)', line: V2_REVENUE, format: V2_MONEY, unit: '$M', totals: v2SumTotals(V2_REVENUE) }, [
          v2Sub({ id: 'revenue-nc', label: 'Web shop', line: V2_REVENUE_NC, format: V2_MONEY }, 'revenue', 'Share of revenue'),
          v2Sub({ id: 'revenue-ec', label: 'Stores', line: V2_REVENUE_EC, format: V2_MONEY }, 'revenue', 'Share of revenue'),
        ]),
      ] },
      { id: 'sec-orders', label: 'Orders', role: 'section', children: [
        v2Kpi({ id: 'orders', label: 'Orders', line: V2_ORDERS, format: V2_COUNT, unit: '# orders', totals: v2SumTotals(V2_ORDERS) }, [
          v2Sub({ id: 'orders-nc', label: 'Web shop', line: V2_ORDERS_NC, format: V2_COUNT }, 'orders', 'Share of orders'),
          v2Sub({ id: 'orders-ec', label: 'Stores', line: V2_ORDERS_EC, format: V2_COUNT }, 'orders', 'Share of orders'),
        ]),
      ] },
      { id: 'sec-aov', label: 'AOV', role: 'section', children: [
        v2Kpi({ id: 'aov', label: 'AOV', line: V2_AOV, format: '$1.23', totals: v2RatioTotals(V2_REVENUE, V2_ORDERS, 2) }),
      ] },
      { id: 'sec-spend', label: 'Marketing spend', role: 'section', children: [
        v2Kpi({ id: 'spend', label: 'Marketing spend', line: V2_SPEND, format: V2_MONEY, unit: '$M', totals: v2SumTotals(V2_SPEND) }, [
          v2Sub({ id: 'spend-social', label: 'Online ads', line: V2_SPEND_SOCIAL, format: V2_MONEY }, 'spend', 'Share of spend'),
          v2Sub({ id: 'spend-search', label: 'Print and radio', line: V2_SPEND_SEARCH, format: V2_MONEY }, 'spend', 'Share of spend'),
        ]),
      ] },
      { id: 'sec-cac', label: 'Cost per web order', role: 'section', children: [
        v2Kpi({ id: 'cac', label: 'Cost per web order', line: V2_CAC, format: '$1,234', changePolarity: 'lowerIsBetter',
          totals: v2RatioTotals(V2_SPEND, V2_ORDERS_NC, 0) }),
      ] },
      { id: 'sec-csr', label: 'Spend to revenue', role: 'section', children: [
        v2Kpi({ id: 'csr', label: 'Spend to revenue', line: V2_CSR, format: '1.1%', changePolarity: 'lowerIsBetter',
          totals: v2RatioTotals(V2_SPEND, V2_REVENUE, 1, 100) }),
      ] },
      { id: 'sec-traffic', label: 'Traffic', role: 'section', children: [
        v2Kpi({ id: 'sessions', label: 'Sessions', line: V2_SESSIONS, format: '1.2m', totals: v2SumTotals(V2_SESSIONS) }, [
          v2Sub({ id: 'sessions-paid', label: 'Paid', line: V2_SESSIONS_PAID, format: '1.2m' }, 'sessions', 'Share of sessions'),
          v2Sub({ id: 'sessions-organic', label: 'Organic', line: V2_SESSIONS_ORGANIC, format: '1.2m' }, 'sessions', 'Share of sessions'),
        ]),
      ] },
      { id: 'sec-mix', label: 'Web order mix', role: 'section', children: [
        v2Kpi({ id: 'mix-sub', label: 'Home delivery', line: V2_MIX_SUB, format: '1.1%', totals: v2MeanTotals(V2_MIX_SUB) }),
        v2Kpi({ id: 'mix-otp', label: 'Store pickup', line: V2_MIX_OTP, format: '1.1%', totals: v2MeanTotals(V2_MIX_OTP) }),
      ] },
    ],
    levelNouns: [
      { one: 'section', other: 'sections' },
      { one: 'KPI', other: 'KPIs' },
      { one: 'sub-KPI', other: 'sub-KPIs' },
    ],
  },
  options: {
    variant: 'steering',
    stickyLabels: true,
    expansion: { depth: 'all' },
    inlineVisibility: { mom: true, yoy: true, share: true },
    // The height pays for the KPI rows on the ladder's top rung (a section
    // heading does not count as a level) and for the note that names the
    // measures where lower is better. The width pays for the unit every KPI
    // names beside its label and for the YTD column's "2026 YTD" heading.
    size: { width: 1490, height: 1707 },
    title: 'Revenue grew through the nine months while spend grew faster and the cost per web order rose with it',
    subtitle: { measure: 'Monthly KPIs', period: 'Jan to Sep 2026', scenarios: ['AC', 'PY'] },
    source: 'Illustrative steering fixture; every figure is synthetic',
    // The first month-on-month change has no month before it and prints the
    // missing glyph, not n/a (`table.noPrevious`).
    theme: { preset: 'boardroom', overrides: { table: { noPrevious: 'missing' } } },
  },
});

/**
 * The band a forced magnitude changes. Every value here scales past
 * 1,000 in thousands, which is where `formatWithSpec` without the lock would
 * roll the scale up on its own and print "2.4M" in a column the author put in thousands.
 * The lock holds the scale, so the unit hoists once and the four numbers are
 * read against each other instead of against four different letters.
 */
fixtures.push({
  id: 'magnitude-forced',
  title: 'Every money figure in thousands, and the unit on the text that already carries it',
  kind: 'example',
  tags: ['demo', 'regression'],
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Channel' },
      { id: 'q1', kind: 'value', label: 'Q1' },
      { id: 'q2', kind: 'value', label: 'Q2' },
      // The one column that names its own format: its unit rides in the
      // header affix, where the reader meets the column.
      { id: 'plan', kind: 'value', label: 'Plan', format: '$1,234k' },
    ],
    rows: [
      // The rows name their own formats; they share one unit under the
      // forced thousand, so it prints once in each column head.
      {
        id: 'paid',
        label: 'Paid media',
        format: '$1.2m',
        children: [
          { id: 'search', label: 'Search', format: '$1.2m', cells: { q1: 2_430_000, q2: 2_610_000, plan: 5_100_000 } },
          { id: 'social', label: 'Social', format: '$1.2m', cells: { q1: 1_180_000, q2: 940_000, plan: 2_000_000 } },
        ],
      },
      { id: 'affiliate', label: 'Affiliate', format: '$1.2m', cells: { q1: 386_000, q2: 412_000, plan: 800_000 } },
      { id: 'retail', label: 'Retail media', format: '$1.2m', cells: { q1: 74_500, q2: 91_200, plan: 180_000 } },
    ],
  },
  options: {
    magnitude: 'thousand',
    size: { width: 520, height: 312 },
    title: 'In Q1 and Q2, search spends about 30 times what retail media does',
    source: 'Illustrative media plan in thousands of euros',
  },
});

/**
 * A band on the columns themselves. The fiscal-year-to-date pair
 * sits at the end of the month group, and a column group of its own there
 * would split the toggle that covers the whole fiscal year, so the ground
 * is authored on the two columns and the first of the run takes the
 * hairline.
 */
fixtures.push({
  id: 'column-band',
  title: 'A banded pair inside one column group, with the toggle still covering the year',
  kind: 'example',
  data: {
    columnGroups: [
      { id: 'fy26', label: 'FY26', columns: ['apr', 'may', 'jun', 'ytdAc', 'ytdPl'] },
      { id: 'fy25', label: 'FY25', columns: ['pyApr', 'pyMay', 'pyJun'] },
    ],
    columnToggles: [{ id: 'py', label: 'FY25', columns: ['pyApr', 'pyMay', 'pyJun'], defaultVisible: false }],
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Market' },
      { id: 'apr', kind: 'value', label: 'Apr', format: '1,234' },
      { id: 'may', kind: 'value', label: 'May', format: '1,234' },
      { id: 'jun', kind: 'value', label: 'Jun', format: '1,234' },
      { id: 'ytdAc', kind: 'value', label: 'YTD', format: '1,234', band: true },
      { id: 'ytdPl', kind: 'value', label: 'YTD plan', format: '1,234', band: true },
      { id: 'pyApr', kind: 'value', label: 'Apr', format: '1,234' },
      { id: 'pyMay', kind: 'value', label: 'May', format: '1,234' },
      { id: 'pyJun', kind: 'value', label: 'Jun', format: '1,234' },
    ],
    rows: [
      {
        id: 'total',
        label: 'Group',
        role: 'total',
        children: [
          {
            id: 'de',
            label: 'Germany',
            cells: { apr: 4120, may: 4380, jun: 4510, ytdAc: 13010, ytdPl: 12600, pyApr: 3980, pyMay: 4010, pyJun: 4190 },
          },
          {
            id: 'uk',
            label: 'United Kingdom',
            cells: { apr: 3240, may: 3110, jun: 3460, ytdAc: 9810, ytdPl: 10200, pyApr: 3150, pyMay: 3220, pyJun: 3080 },
          },
          {
            id: 'nl',
            label: 'Netherlands',
            cells: { apr: 1180, may: 1240, jun: 1190, ytdAc: 3610, ytdPl: 3500, pyApr: 1090, pyMay: 1120, pyJun: 1160 },
          },
        ],
      },
    ],
  },
  options: {
    variant: 'steering',
    size: { width: 640, height: 325 },
    title: 'Germany is ahead of its year-to-date plan, the United Kingdom behind',
    subtitle: { measure: 'Revenue', period: 'FY26 Apr to Jun' },
    unit: '$k',
    source: 'Illustrative steering block; the year-to-date pair is banded, not grouped',
  },
});

/**
 * The totals-only step of a depth control: `expansion.rootsHidden`
 * hides every level-0 data row with its subtree, and the total and the
 * section headings stay. `depthToExpansion(table, 0)` is what a host passes
 * to reach this state; one step up shows the markets.
 */
fixtures.push({
  id: 'totals-only',
  title: 'Depth 0: the total alone, with the markets one step away',
  kind: 'torture',
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Market' },
      { id: 'ac', kind: 'value', label: 'Actuals', format: '1,234' },
      { id: 'pl', kind: 'value', label: 'Plan', format: '1,234' },
    ],
    rows: [
      { id: 'total', label: 'Group', role: 'total', cells: { ac: 26430, pl: 26300 } },
      { id: 'de', label: 'Germany', cells: { ac: 13010, pl: 12600 } },
      { id: 'uk', label: 'United Kingdom', cells: { ac: 9810, pl: 10200 } },
      { id: 'nl', label: 'Netherlands', cells: { ac: 3610, pl: 3500 } },
    ],
  },
  options: {
    variant: 'steering',
    expansion: { rootsHidden: true },
    size: { width: 420, height: 233 },
    title: 'The group is 130 above plan for the year to date',
    subtitle: { measure: 'Revenue', period: 'FY26 YTD' },
    unit: '$k',
    source: 'Illustrative steering block; the markets sit one depth step below the total',
  },
});

/**
 * The totals step as a depth value: `expansion.depth: 'totals'` folds every
 * parent and hides the level-0 data rows, so the regions and their markets
 * give way to the group total. A depth control writes this one key.
 */
fixtures.push({
  id: 'totals-step',
  title: "Depth 'totals': the group total alone over two regions with markets",
  kind: 'torture',
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Region' },
      { id: 'ac', kind: 'value', label: 'Actuals', format: '1,234' },
      { id: 'pl', kind: 'value', label: 'Plan', format: '1,234' },
    ],
    rows: [
      { id: 'total', label: 'Group', role: 'total', cells: { ac: 26430, pl: 26300 } },
      { id: 'emea', label: 'EMEA', cells: { ac: 16620, pl: 16100 }, children: [
        { id: 'de', label: 'Germany', cells: { ac: 13010, pl: 12600 } },
        { id: 'nl', label: 'Netherlands', cells: { ac: 3610, pl: 3500 } },
      ] },
      { id: 'uk', label: 'United Kingdom', cells: { ac: 9810, pl: 10200 } },
    ],
  },
  options: {
    variant: 'steering',
    expansion: { depth: 'totals' },
    size: { width: 420 },
    title: 'The group is 130 above plan for the year to date',
    subtitle: { measure: 'Revenue', period: 'FY26 YTD' },
    unit: '$k',
    source: 'Illustrative steering block; the regions sit one depth step below the total',
  },
});

/**
 * two parents and one leaf on the top rung. The leaf sits on the
 * same ground as its siblings, so the rung reads as one.
 */
fixtures.push({
  id: 'mixed-top-level-rows',
  title: 'A leaf among parents on the top rung keeps their ground',
  kind: 'torture',
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Channel' },
      { id: 'py', kind: 'value', label: '2025', format: '1,234' },
      { id: 'ac', kind: 'value', label: '2026', format: '1,234' },
    ],
    rows: [
      {
        id: 'retail',
        label: 'Retail',
        children: [
          { id: 'retail-stores', label: 'Stores', cells: { py: 1420, ac: 1510 } },
          { id: 'retail-outlets', label: 'Outlets', cells: { py: 380, ac: 355 } },
        ],
      },
      {
        id: 'online',
        label: 'Online',
        children: [
          { id: 'online-shop', label: 'Own shop', cells: { py: 960, ac: 1125 } },
          { id: 'online-market', label: 'Marketplaces', cells: { py: 410, ac: 470 } },
        ],
      },
      { id: 'wholesale', label: 'Wholesale', cells: { py: 640, ac: 610 } },
      { id: 'total', label: 'All channels', role: 'total', cells: { py: 3810, ac: 4070 } },
    ],
  },
  options: {
    expansion: { depth: 'all' },
    title: 'Online grows while wholesale slips',
    subtitle: { measure: 'Net sales', period: 'FY26' },
    unit: '$k',
    source: 'Synthetic channel table',
  },
});

/**
 * `levelOffset`: a board whose top rows are regions, not KPI
 * lines, steps every row one rung down, so the regions read at 11/15 on the
 * group weight and their markets one rung under that. The total takes no
 * offset: it restates the regions and is not a rung, so it keeps its own
 * size, weight and air at the head of the board.
 */
fixtures.push({
  id: 'steering-level-offset',
  title: 'Regions one rung down under levelOffset, the total on its own step',
  kind: 'example',
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Market' },
      { id: 'ac', kind: 'value', label: 'Actuals', format: '1,234' },
      { id: 'pl', kind: 'value', label: 'Plan', format: '1,234' },
      {
        id: 'vsPl',
        kind: 'computed',
        label: 'vs plan',
        calc: { op: 'percentDelta', a: 'ac', b: 'pl' },
        format: '+1.1%',
        polarity: 'higherIsBetter',
      },
    ],
    rows: [
      { id: 'total', label: 'Group', role: 'total', totalPolicy: 'source', cells: { ac: 31850, pl: 31780 } },
      {
        id: 'europe',
        label: 'Europe',
        children: [
          { id: 'de', label: 'Germany', cells: { ac: 13010, pl: 12600 } },
          { id: 'fr', label: 'France', cells: { ac: 4180, pl: 4300 } },
          { id: 'nl', label: 'Netherlands', cells: { ac: 3610, pl: 3500 } },
        ],
      },
      {
        id: 'ukie',
        label: 'UK and Ireland',
        children: [
          { id: 'uk', label: 'United Kingdom', cells: { ac: 9810, pl: 10200 } },
          { id: 'ie', label: 'Ireland', cells: { ac: 1240, pl: 1180 } },
        ],
      },
    ],
  },
  options: {
    variant: 'steering',
    levelOffset: 1,
    expansion: { depth: 'all' },
    size: { width: 520, height: 434 },
    title: 'Europe carries the group 70 above plan; the UK is 390 short',
    subtitle: { measure: 'Revenue', period: 'FY26 YTD' },
    source: 'Illustrative steering block; the regions sit one rung down, the total does not move',
  },
});

// A weekly KPI table with authored tracks and heads. Eight week columns of 66,
// a 220 px KPI column, a 128 px block column and a 74 px change column, with
// the last track taking the slack so the rules reach the frame edge; the
// ISO week under each week start; the chevron on the sorted column alone.
fixtures.push({
  id: 'steering-week-grain',
  title: 'Week grain: fixed tracks, ISO weeks under the dates, chevron on the sorted column',
  kind: 'example',
  tags: ['demo'],
  data: {
    columnGroups: [
      { id: 'weeks', label: 'FY26 weeks', columns: ['w38', 'w39', 'w40', 'w41', 'w42', 'w43', 'w44', 'w45'] },
      { id: 'block', label: 'Last 8 weeks', columns: ['avg', 'wow'] },
    ],
    // report date headers and the average header fit these authored tracks.
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'KPI', width: 220 },
      { id: 'w38', kind: 'value', label: '15 Sep', subLabel: 'W38', format: '1,234', width: 82 },
      { id: 'w39', kind: 'value', label: '22 Sep', subLabel: 'W39', format: '1,234', width: 82 },
      { id: 'w40', kind: 'value', label: '29 Sep', subLabel: 'W40', format: '1,234', width: 82 },
      { id: 'w41', kind: 'value', label: '6 Oct', subLabel: 'W41', format: '1,234', width: 82 },
      { id: 'w42', kind: 'value', label: '13 Oct', subLabel: 'W42', format: '1,234', width: 82 },
      { id: 'w43', kind: 'value', label: '20 Oct', subLabel: 'W43', format: '1,234', width: 82 },
      { id: 'w44', kind: 'value', label: '27 Oct', subLabel: 'W44', format: '1,234', width: 82 },
      { id: 'w45', kind: 'value', label: '3 Nov', subLabel: 'W45', format: '1,234', width: 82 },
      { id: 'avg', kind: 'value', label: '8-week average', format: '1,234', width: 170, band: true },
      {
        id: 'wow',
        kind: 'computed',
        label: 'WoW',
        calc: { op: 'percentDelta', a: 'w45', b: 'w44' },
        polarity: 'higherIsBetter',
        format: '+1.1%',
        width: 74,
        band: true,
      },
    ],
    rows: [
      { id: 'sessions', label: 'Sessions', cells: { w38: 41200, w39: 42600, w40: 41800, w41: 44100, w42: 45300, w43: 44700, w44: 46200, w45: 47500, avg: 44175 } },
      { id: 'orders', label: 'Orders', cells: { w38: 2140, w39: 2210, w40: 2180, w41: 2320, w42: 2360, w43: 2290, w44: 2410, w45: 2455, avg: 2296 } },
      { id: 'newCustomers', label: 'New customers', cells: { w38: 860, w39: 905, w40: 880, w41: 940, w42: 960, w43: 915, w44: 985, w45: 1010, avg: 932 } },
    ],
  },
  options: {
    variant: 'steering',
    lastTrackFlex: true,
    sortIndicator: 'sorted',
    size: { width: 1187, height: 370 },
    title: 'Weekly orders hold their climb into November',
    subtitle: { measure: 'Weekly demand', period: 'W38 to W45 FY26' },
    source: 'Illustrative weekly steering board; the block column averages the eight weeks shown',
  },
});

/**
 * `rowExtent: 'frame'`: three markets and their total in a card
 * wider than the table. The total's ground, the rules and the highlighted
 * row run to the frame edge instead of stopping where the last column
 * ends, and through the card's right margin, which insets the columns only.
 */
fixtures.push({
  id: 'row-extent-frame',
  title: 'Rows that reach the frame edge in a card wider than the table',
  kind: 'example',
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Market' },
      { id: 'ac', kind: 'value', label: 'Actuals', format: '1,234' },
      { id: 'pl', kind: 'value', label: 'Plan', format: '1,234' },
      {
        id: 'vsPl',
        kind: 'computed',
        label: 'vs plan',
        calc: { op: 'percentDelta', a: 'ac', b: 'pl' },
        format: '+1.1%',
        polarity: 'higherIsBetter',
      },
    ],
    rows: [
      { id: 'total', label: 'Group', role: 'total', totalPolicy: 'source', cells: { ac: 26430, pl: 26300 } },
      { id: 'de', label: 'Germany', cells: { ac: 13010, pl: 12600 } },
      { id: 'uk', label: 'United Kingdom', cells: { ac: 9810, pl: 10200 } },
      { id: 'nl', label: 'Netherlands', cells: { ac: 3610, pl: 3500 } },
    ],
  },
  options: {
    variant: 'steering',
    rowExtent: 'frame',
    highlight: 'uk',
    canvas: { margin: { right: 16 } },
    size: { width: 640, height: 294 },
    title: 'The United Kingdom is the one market behind plan',
    subtitle: { measure: 'Revenue', period: 'FY26 YTD' },
    unit: '$k',
    source: 'Illustrative steering block; the rows run to the card edge, the columns keep their widths',
  },
});

/**
 * `columnGroups[].heading: false`: the months are a group because
 * the month-on-month line reads the previous member of its group, and the
 * year-to-date column is a group of its own so that it has no month before
 * it and carries a band. Neither group needs a heading over columns that
 * already say what they are, so the head is one row; the band, the divider
 * and the calculations stay.
 */
fixtures.push({
  id: 'column-groups-no-heading',
  title: 'Column groups that keep their meaning and draw no heading',
  kind: 'example',
  data: {
    columnGroups: [
      { id: 'months', label: 'months', columns: ['jul', 'aug', 'sep'], heading: false },
      { id: 'ytd', label: 'FY26 YTD', columns: ['ytd'], band: true, heading: false },
    ],
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'KPI' },
      { id: 'jul', kind: 'value', label: 'Jul', format: '1,234' },
      { id: 'aug', kind: 'value', label: 'Aug', format: '1,234' },
      { id: 'sep', kind: 'value', label: 'Sep', format: '1,234' },
      { id: 'ytd', kind: 'value', label: 'FY26 YTD', format: '1,234' },
    ],
    rows: [
      {
        id: 'orders', label: 'Orders', cells: { jul: 2140, aug: 2210, sep: 2320, ytd: 6670 },
        children: [{
          id: 'orders-mom', label: 'MoM', relation: 'displayOnly', inline: true, inlineGroup: 'mom',
          format: '+1.1%', polarity: 'higherIsBetter',
          calc: { op: 'percentDelta', a: { row: 'orders' }, b: { row: 'orders', previous: true } },
        }],
      },
      {
        id: 'customers', label: 'New customers', cells: { jul: 860, aug: 905, sep: 880, ytd: 2645 },
        children: [{
          id: 'customers-mom', label: 'MoM', relation: 'displayOnly', inline: true, inlineGroup: 'mom',
          format: '+1.1%', polarity: 'higherIsBetter',
          calc: { op: 'percentDelta', a: { row: 'customers' }, b: { row: 'customers', previous: true } },
        }],
      },
    ],
  },
  options: {
    variant: 'steering',
    size: { width: 560, height: 302 },
    title: 'Orders grew every month of the quarter; new customers dipped in September',
    subtitle: { measure: 'Monthly demand', period: 'FY26 Q1' },
    source: 'Illustrative steering block; the groups carry the month-on-month reading and the band, not a heading',
  },
});

/**
 * `rows[].missing`: the year-on-year line has no value in the
 * year-to-date block, where the table prints its "sum" in the slot the
 * month-on-month line leaves free. That empty slot says nothing and stays
 * blank, while the month the returns feed has not delivered keeps its
 * dash: a table-wide `nulls: 'blank'` would have emptied both.
 */
fixtures.push({
  id: 'row-missing-blank',
  title: 'A change line that stays blank where it has no value, and a real gap that prints n/a',
  kind: 'example',
  data: {
    columnGroups: [
      { id: 'months', label: 'FY26 months', columns: ['jul', 'aug', 'sep'] },
      { id: 'ytd', label: 'FY26 YTD', columns: ['ytd'], band: true },
    ],
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'KPI' },
      // No column format: each KPI and each change line carries its own.
      { id: 'jul', kind: 'value', label: 'Jul' },
      { id: 'aug', kind: 'value', label: 'Aug' },
      { id: 'sep', kind: 'value', label: 'Sep' },
      { id: 'ytd', kind: 'value', label: 'YTD', noteLine: true },
    ],
    rows: [
      {
        id: 'sessions', label: 'Sessions', format: '1,234', cells: { jul: 41200, aug: 42600, sep: 44100, ytd: { v: 127900, note: 'sum' } },
        children: [
          {
            id: 'sessions-mom', label: 'MoM', relation: 'displayOnly', inline: true, inlineGroup: 'mom',
            format: '+1.1%', polarity: 'higherIsBetter',
            calc: { op: 'percentDelta', a: { row: 'sessions' }, b: { row: 'sessions', previous: true } },
          },
          {
            id: 'sessions-yoy', label: 'YoY', relation: 'displayOnly', inline: true, inlineGroup: 'yoy',
            format: '+1.1%', missing: 'blank', cells: { jul: 6.2, aug: 5.8, sep: 7.1, ytd: { missing: 'blank' } },
          },
        ],
      },
      {
        id: 'orders', label: 'Orders', format: '1,234', cells: { jul: 2140, aug: 2210, sep: 2320, ytd: { v: 6670, note: 'sum' } },
        children: [
          {
            id: 'orders-mom', label: 'MoM', relation: 'displayOnly', inline: true, inlineGroup: 'mom',
            format: '+1.1%', polarity: 'higherIsBetter',
            calc: { op: 'percentDelta', a: { row: 'orders' }, b: { row: 'orders', previous: true } },
          },
          {
            id: 'orders-yoy', label: 'YoY', relation: 'displayOnly', inline: true, inlineGroup: 'yoy',
            format: '+1.1%', missing: 'blank', cells: { jul: 4.4, aug: 3.9, sep: 5.2 },
          },
        ],
      },
      // The returns feed has not delivered September: a real gap, and it
      // prints the n/a word.
      { id: 'returns', label: 'Returns', format: '1,234', cells: { jul: 96, aug: 104, sep: null, ytd: { v: 200, note: 'sum' } } },
    ],
  },
  options: {
    variant: 'steering',
    size: { width: 560, height: 416 },
    title: 'Sessions and orders grew every month; September returns are not in yet',
    subtitle: { measure: 'Monthly demand', period: 'FY26 Q1' },
    source: 'Illustrative steering block; the year-on-year line is blank where it has no value, the missing month prints n/a',
  },
});

/**
 * Table conventions a theme sets: a head without tracking and one
 * line box, a section face in the tertiary ink, fixed type, the missing
 * glyph where the first month has no previous one, ofWhich rows in the text
 * colour, two open months on the band ground, and an April year-on-year
 * lane where the market that opened this year stays out of the heat. The
 * change column's note takes the month-on-month slot, as on a steering board.
 */
const CONVENTION_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun'] as const;
const conventionCells = (values: number[], aprPy: number): Record<string, number | { state: 'open' }> => ({
  ...Object.fromEntries(CONVENTION_MONTHS.map((id, index) => [id, index < values.length ? values[index]! : { state: 'open' as const }])),
  aprPy,
});

fixtures.push({
  id: 'steering-theme-conventions',
  title: 'Theme table conventions with two open months and a heat-free cell',
  kind: 'example',
  tags: ['theme', 'inline-rows'],
  data: {
    columnGroups: [{ id: 'h1', label: 'H1 months', columns: [...CONVENTION_MONTHS] }],
    columnToggles: [{ id: 'py', label: 'Prior year', columns: ['aprPy'], defaultVisible: false }],
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'KPI' },
      ...CONVENTION_MONTHS.map((id) => ({
        id, kind: 'value' as const, label: id[0]!.toUpperCase() + id.slice(1), format: '1.1',
        ...(id === 'may' ? { subLabel: 'open' } : {}),
      })),
      { id: 'aprPy', kind: 'value', label: 'Apr PY', scenario: 'PY', format: '1.1' },
      {
        id: 'yoy', kind: 'computed', label: 'Apr YoY', format: '+1.1%', polarity: 'higherIsBetter', noteLine: true,
        calc: { op: 'percentDelta', a: 'apr', b: 'aprPy' },
      },
    ],
    rows: [
      { id: 'sec-revenue', label: 'Revenue', role: 'section', children: [
        {
          // The change column has no month before it; its note takes the slot.
          id: 'revenue', label: 'Revenue', unitAffix: '$M', cells: { yoy: { note: 'vs Apr 25' } },
          children: [
            {
              id: 'revenue-mom', label: 'MoM', relation: 'displayOnly', inline: true, inlineGroup: 'mom',
              format: '+1.1%', polarity: 'higherIsBetter',
              calc: { op: 'percentDelta', a: { row: 'revenue' }, b: { row: 'revenue', previous: true } },
            },
            { id: 'revenue-north', label: 'North', cells: conventionCells([4.1, 4.3, 4.2, 4.6], 4.26) },
            // Flat on the year at its precision: "0.0%" takes no tone.
            { id: 'revenue-south', label: 'South', cells: conventionCells([2.8, 2.9, 3.1, 3.0], 3.0006) },
            {
              id: 'revenue-east', label: 'East (opened in March)',
              cells: { ...conventionCells([0, 0, 0.4, 0.9], 0.45), yoy: { heat: false } },
            },
            { id: 'revenue-subs', label: 'of which subscriptions', relation: 'ofWhich', cells: conventionCells([3.9, 4.0, 4.3, 4.5], 4.28) },
          ],
        },
      ] },
      { id: 'sec-orders', label: 'Orders', role: 'section', children: [
        { id: 'orders', label: 'Orders', unitAffix: 'k', cells: conventionCells([61.2, 63.4, 66.1, 68.9], 71.17) },
      ] },
    ],
  },
  options: {
    variant: 'steering',
    expansion: { depth: 'all' },
    encodings: { yoy: 'heat' },
    size: { width: 820, height: 511 },
    theme: {
      preset: 'standard',
      overrides: {
        color: { inkMeta: '#6F706F' },
        table: {
          head: { size: 10.5, weight: 600, tracking: 0 },
          section: { size: 11, weight: 500, lineHeight: 14 / 11, tracking: 0.14, ink: 'inkMeta', spaceBefore: 12, rule: 'hair' },
          fixedType: true,
          noPrevious: 'missing',
          ofWhich: 'ink',
          glyphs: { missing: '\u2013', suppressed: '\u2013' },
        },
      },
    },
    title: 'Revenue grew every closed month; May and June are still open',
    subtitle: { measure: 'Monthly revenue and orders', period: 'H1 FY26' },
    source: 'Illustrative steering block; the new market stays out of the year-on-year heat',
  },
});

/**
 * `table.head.case: 'asis'`: a weekly board whose heads carry their
 * own case ("Apr 25", "L10W avg"). The heads print as authored on the SVG
 * and in the grid, and the tracks measure that text; the section row keeps
 * its tracked capitals.
 */
fixtures.push({
  id: 'table-head-authored-case',
  title: 'Column heads in their authored case',
  kind: 'example',
  tags: ['theme'],
  data: {
    columns: [
      { id: 'kpi', kind: 'rowLabel', label: 'KPI' },
      { id: 'apr', kind: 'value', label: 'Apr 25', format: '1,234' },
      { id: 'avg', kind: 'value', label: 'L10W avg', format: '1,234' },
      { id: 'wow', kind: 'computed', label: 'vs L10W', format: '+1.0%', polarity: 'higherIsBetter', calc: { op: 'percentDelta', a: 'apr', b: 'avg' } },
    ],
    rows: [
      { id: 'sec', label: 'Acquisition', role: 'section', children: [
        { id: 'orders', label: 'New orders', cells: { apr: 4_210, avg: 3_980 } },
        { id: 'sessions', label: 'Paid sessions', cells: { apr: 118_400, avg: 121_900 } },
      ] },
    ],
  },
  options: {
    expansion: { depth: 'all' },
    theme: { preset: 'standard', overrides: { table: { head: { case: 'asis' } } } },
    title: 'New orders ran 5.8% above their ten-week average',
    subtitle: { measure: 'Weekly acquisition', period: 'week of 21 Apr 2025' },
    source: 'Illustrative weekly board',
  },
});

/**
 * `table.endRule: 'none'` and `table.closeRule: 'grid'`: a market block in
 * a host card under `rowExtent: 'frame'`. The rows reach the card edge,
 * and that edge closes them, so the table draws no end hairline of its own,
 * and the rule under the last row takes the row-hairline ink. With both
 * rules at their defaults the two lines read as a box around the table.
 */
fixtures.push({
  id: 'table-frame-open-end',
  title: 'Rows that end on the card edge, with no end hairline and a light close',
  kind: 'example',
  tags: ['theme'],
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Market' },
      { id: 'ac', kind: 'value', label: 'Actuals', format: '1,234' },
      { id: 'pl', kind: 'value', label: 'Plan', format: '1,234' },
      {
        id: 'vsPl',
        kind: 'computed',
        label: 'vs plan',
        calc: { op: 'percentDelta', a: 'ac', b: 'pl' },
        format: '+1.1%',
        polarity: 'higherIsBetter',
      },
    ],
    rows: [
      { id: 'total', label: 'Group', role: 'total', totalPolicy: 'source', cells: { ac: 26430, pl: 26300 } },
      { id: 'de', label: 'Germany', cells: { ac: 13010, pl: 12600 } },
      { id: 'uk', label: 'United Kingdom', cells: { ac: 9810, pl: 10200 } },
      { id: 'nl', label: 'Netherlands', cells: { ac: 3610, pl: 3500 } },
    ],
  },
  options: {
    variant: 'steering',
    rowExtent: 'frame',
    canvas: { margin: { right: 16 } },
    size: { width: 640, height: 294 },
    theme: { preset: 'standard', overrides: { table: { endRule: 'none', closeRule: 'grid' } } },
    title: 'The United Kingdom is the one market behind plan',
    subtitle: { measure: 'Revenue', period: 'FY26 YTD' },
    unit: '$k',
    source: 'Illustrative steering block; the card edge closes the rows',
  },
});

/**
 * `columnGroups[].hoverSeries: 'all'`: a steering block whose months form
 * one group and whose "FY27 YTD" column shares a group with the five fiscal
 * years before it, which a column toggle keeps hidden. The table draws the
 * three months and the one block column; the sparkline hover card of a
 * "FY27 YTD" cell draws all six fiscal years. Neither group draws a heading.
 */
fixtures.push({
  id: 'steering-hover-history',
  title: 'A year-to-date block whose hover card draws the fiscal years the table hides',
  kind: 'example',
  tags: ['interaction'],
  data: {
    columnGroups: [
      { id: 'months', label: 'months', columns: ['jul', 'aug', 'sep'], heading: false },
      {
        id: 'years',
        label: 'fiscal years',
        columns: ['fy22', 'fy23', 'fy24', 'fy25', 'fy26', 'fy27'],
        band: true,
        heading: false,
        hoverSeries: 'all',
      },
    ],
    columnToggles: [
      { id: 'history', label: 'Prior years', columns: ['fy22', 'fy23', 'fy24', 'fy25', 'fy26'], defaultVisible: false },
    ],
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'KPI' },
      { id: 'jul', kind: 'value', label: 'Jul', format: '1,234' },
      { id: 'aug', kind: 'value', label: 'Aug', format: '1,234' },
      { id: 'sep', kind: 'value', label: 'Sep', format: '1,234' },
      { id: 'fy22', kind: 'value', label: 'FY22 YTD', format: '1,234' },
      { id: 'fy23', kind: 'value', label: 'FY23 YTD', format: '1,234' },
      { id: 'fy24', kind: 'value', label: 'FY24 YTD', format: '1,234' },
      { id: 'fy25', kind: 'value', label: 'FY25 YTD', format: '1,234' },
      { id: 'fy26', kind: 'value', label: 'FY26 YTD', format: '1,234' },
      { id: 'fy27', kind: 'value', label: 'FY27 YTD', format: '1,234' },
    ],
    rows: [
      {
        id: 'revenue',
        label: 'Revenue',
        cells: { jul: 4210, aug: 4380, sep: 4520, fy22: 8120, fy23: 9450, fy24: 10380, fy25: 11240, fy26: 12060, fy27: 13110 },
      },
      {
        id: 'margin',
        label: 'Gross margin',
        cells: { jul: 3070, aug: 3180, sep: 3310, fy22: 5770, fy23: 6800, fy24: 7580, fy25: 8210, fy26: 8800, fy27: 9560 },
      },
      {
        id: 'spend',
        label: 'Marketing spend',
        cells: { jul: 1260, aug: 1340, sep: 1310, fy22: 2980, fy23: 3350, fy24: 3520, fy25: 3640, fy26: 3700, fy27: 3910 },
      },
    ],
  },
  options: {
    variant: 'steering',
    size: { width: 560, height: 273 },
    title: 'Revenue rose in every month of the quarter',
    subtitle: { measure: 'Steering KPIs', period: 'FY27 Q1' },
    unit: '$k',
    source: 'Illustrative steering block; the prior fiscal years sit behind a column toggle and feed the hover card',
  },
});

/**
 * `groupRule: 'span'`, `groupAlign: 'left'` and `rows[].spacer`: two metric
 * blocks over four monthly cohorts. Each block heading starts at its first
 * column and its hairline runs under all three months, and the January cohort
 * stands off the year before it by 6 px with no rule in the gap.
 */
fixtures.push({
  id: 'group-span-row-spacer',
  title: 'Block headings over their whole span and a gap before the new year',
  kind: 'example',
  data: {
    columnGroups: [
      { id: 'retention', label: 'Retention', columns: ['r1', 'r2', 'r3'] },
      { id: 'orders', label: 'Orders per customer', columns: ['o1', 'o2', 'o3'] },
    ],
    columns: [
      { id: 'cohort', kind: 'rowLabel', label: 'Cohort' },
      { id: 'r1', kind: 'value', label: 'M1', format: '1%' },
      { id: 'r2', kind: 'value', label: 'M2', format: '1%' },
      { id: 'r3', kind: 'value', label: 'M3', format: '1%' },
      { id: 'o1', kind: 'value', label: 'M1', format: '1.2' },
      { id: 'o2', kind: 'value', label: 'M2', format: '1.2' },
      { id: 'o3', kind: 'value', label: 'M3', format: '1.2' },
    ],
    rows: [
      { id: 'nov', label: 'Nov 24', cells: { r1: 62, r2: 55, r3: 51, o1: 1.12, o2: 1.31, o3: 1.48 } },
      { id: 'dec', label: 'Dec 24', cells: { r1: 60, r2: 54, r3: 49, o1: 1.1, o2: 1.28, o3: 1.44 } },
      { id: 'jan', label: 'Jan 25', spacer: 6, cells: { r1: 65, r2: 58, r3: 53, o1: 1.15, o2: 1.36, o3: 1.52 } },
      { id: 'feb', label: 'Feb 25', cells: { r1: 64, r2: 57, r3: null, o1: 1.14, o2: 1.34, o3: null } },
    ],
  },
  options: {
    groupRule: 'span',
    groupAlign: 'left',
    nulls: 'blank',
    size: { width: 640, height: 324 },
    title: 'The January cohort retains best and orders most',
    subtitle: { measure: 'Retention and orders per customer', period: 'months after acquisition' },
    source: 'Illustrative cohorts; each block heading spans its months, the new year stands off by 6 px',
  },
});

/**
 * `fitFormats`: a steering block at the week grain, its six week
 * tracks authored at 44 px. The revenue row is written for the month grain,
 * two decimals in $M, and "$2.47M" does not fit the week track, so the row
 * drops a decimal and every week reads "$2.5M". The orders and conversion
 * rows keep their own formats: a column format would print them in $M.
 */
const FIT_WEEKS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'] as const;
const fitCells = (values: number[]): Record<string, number> =>
  Object.fromEntries(FIT_WEEKS.map((id, index) => [id, values[index]!]));
fixtures.push({
  id: 'fit-formats-narrow-tracks',
  title: 'Weekly revenue drops a decimal to fit 44 px tracks, the other rows keep their units',
  kind: 'example',
  data: {
    columns: [
      { id: 'kpi', kind: 'rowLabel', label: 'KPI', width: 150 },
      ...FIT_WEEKS.map((id, index) => ({ id, kind: 'value' as const, label: `W${index + 36}`, width: 44 })),
    ],
    rows: [
      { id: 'revenue', label: 'Revenue', format: '$1.23M', cells: fitCells([2_470_000, 2_630_000, 2_520_000, 2_580_000, 2_710_000, 2_660_000]) },
      { id: 'orders', label: 'Orders', format: '1,234', cells: fitCells([18_400, 19_150, 18_900, 19_020, 20_110, 19_760]) },
      { id: 'cvr', label: 'Conversion', format: '1.23%', cells: fitCells([2.31, 2.36, 2.29, 2.33, 2.41, 2.38]) },
    ],
  },
  options: {
    variant: 'steering',
    fitFormats: true,
    cellPadX: 6,
    size: { width: 640, height: 260 },
    title: 'Revenue passed $2.7M in week 40',
    subtitle: { measure: 'Weekly steering', period: 'W36 to W41' },
    source: 'Illustrative weeks; the revenue row is written as $1.23M and fitted to its 44 px tracks',
  },
});

/**
 * `outlineMarks: false`, the head air of `theme.table` and the
 * label ladder `labelIndent` measures from the row edge: regions
 * over markets drawn without the outline mark, for a board whose Depth
 * control folds the tree and needs no glyph to say so. The theme sets the
 * head cells to 10 px above and 8 px under the text and the group row to 8
 * and 4, as CSS writes `padding: 10px 10px 8px`.
 */
fixtures.push({
  id: 'outline-marks-off',
  title: 'A region tree without outline marks, its head air from the theme',
  kind: 'example',
  tags: ['theme'],
  data: {
    columnGroups: [
      { id: 'ytd', label: 'Year to date', columns: ['ac', 'py'] },
      { id: 'fy', label: 'Full year', columns: ['fc'], band: true },
    ],
    columns: [
      { id: 'name', kind: 'rowLabel', label: 'Region' },
      { id: 'ac', kind: 'value', label: 'Actual', format: '1,234' },
      { id: 'py', kind: 'value', label: 'Prior year', format: '1,234' },
      { id: 'fc', kind: 'value', label: 'Forecast', format: '1,234' },
    ],
    rows: [
      { id: 'total', label: 'Total', role: 'total', totalPolicy: 'source', cells: { ac: 12_010, py: 11_020, fc: 24_800 } },
      {
        id: 'eu', label: 'Europe', totalPolicy: 'source', cells: { ac: 7_210, py: 6_540, fc: 14_900 },
        children: [
          { id: 'de', label: 'Germany', cells: { ac: 4_120, py: 3_760, fc: 8_500 } },
          { id: 'fr', label: 'France', cells: { ac: 3_090, py: 2_780, fc: 6_400 } },
        ],
      },
      {
        id: 'apac', label: 'Asia Pacific', totalPolicy: 'source', cells: { ac: 4_800, py: 4_480, fc: 9_900 },
        children: [
          { id: 'au', label: 'Australia', cells: { ac: 3_010, py: 2_860, fc: 6_200 } },
          { id: 'jp', label: 'Japan', cells: { ac: 1_790, py: 1_620, fc: 3_700 } },
        ],
      },
    ],
  },
  options: {
    totalPosition: 'top',
    outlineMarks: false,
    // The ladder measured from the row edge: with
    // 6 px of cell air the Total starts at 24, a region at 40, a market at 56.
    cellPadX: 6,
    labelIndent: { base: 24 },
    theme: { preset: 'standard', overrides: { table: { headPad: { top: 10, bottom: 8 }, groupPad: { top: 8, bottom: 4 } } } },
    size: { width: 640, height: 410 },
    title: 'Europe carries three fifths of the year so far',
    subtitle: { measure: 'Revenue', period: 'FY26' },
    unit: '$k',
    source: 'Illustrative regions; the tree is drawn without outline marks',
  },
});

/**
 * `maxGrowth`: a channel table whose columns are all measured. In
 * the React grid under `fit: 'fill'` each value column grows to at most 1.4
 * times its width however wide the card, and the room left stays to the
 * right; the SVG never grows a track past its natural width, so it draws
 * the natural tracks.
 */
fixtures.push({
  id: 'max-growth-capped',
  title: 'A channel table whose columns grow at most 1.4 times when it fills a card',
  kind: 'torture',
  data: {
    columns: [
      { id: 'channel', kind: 'rowLabel', label: 'Channel' },
      { id: 'spend', kind: 'value', label: 'Spend', format: '$1,234k' },
      { id: 'orders', kind: 'value', label: 'Orders', format: '1,234' },
      { id: 'costPerOrder', kind: 'computed', label: 'Cost per order', calc: { op: 'div', a: { ref: 'spend' }, b: { ref: 'orders' } }, format: '$1' },
    ],
    rows: [
      { id: 'total', label: 'All channels', role: 'total', totalPolicy: 'source', cells: { spend: 875_000, orders: 12_160 } },
      { id: 'social', label: 'Social', cells: { spend: 412_000, orders: 5_210 } },
      { id: 'search', label: 'Search', cells: { spend: 365_000, orders: 5_830 } },
      { id: 'video', label: 'Video', cells: { spend: 98_000, orders: 1_120 } },
    ],
  },
  options: {
    totalPosition: 'bottom',
    maxGrowth: 1.4,
    size: { width: 640, height: 294 },
    title: 'Search acquires at the lowest cost per order',
    subtitle: { measure: 'Paid channels', period: 'September 2026' },
    source: 'Illustrative channels; in a filling React grid each value column grows at most 1.4 times',
  },
});

/**
 * A house rule colour: the axis ink is a quiet grey, the head,
 * total and close rules keep a firm teal through `color.rule`.
 */
fixtures.push({
  ...fixtures.find((entry) => entry.id === 'max-growth-capped')!,
  id: 'house-rule-colour',
  kind: 'example',
  tags: [],
  hover: undefined,
  title: 'Head, total and close rules in the theme rule colour while the axis ink stays grey',
  options: {
    ...fixtures.find((entry) => entry.id === 'max-growth-capped')!.options,
    theme: { preset: 'standard', overrides: { color: { axis: '#8A949E', rule: '#0C3D3D' } } },
  },
});

// Coverage: a heat lane on an absolute variance that saturates at 500 and tints the total too.
fixtures.push({
  id: 'heat-absolute-cap',
  title: 'A heat lane on an absolute plan variance, saturating at 500, the total tinted as well',
  kind: 'example',
  tags: ['coverage'],
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Market' },
      { id: 'ac', kind: 'value', label: 'Actuals', format: '1,234' },
      { id: 'pl', kind: 'value', label: 'Plan', format: '1,234' },
      { id: 'dPl', kind: 'computed', label: 'vs plan', calc: { op: 'sub', a: { ref: 'ac' }, b: { ref: 'pl' } }, format: '+1,234', polarity: 'higherIsBetter' },
    ],
    rows: [
      { id: 'total', label: 'Group', role: 'total', totalPolicy: 'source', cells: { ac: 26430, pl: 26300 } },
      { id: 'de', label: 'Germany', cells: { ac: 13010, pl: 12600 } },
      { id: 'uk', label: 'United Kingdom', cells: { ac: 9810, pl: 10200 } },
      { id: 'nl', label: 'Netherlands', cells: { ac: 3610, pl: 3500 } },
    ],
  },
  options: {
    variant: 'steering',
    encodings: { dPl: { type: 'heat', cap: { abs: 500 }, excludeTotals: false } },
    size: { width: 520, height: 319 },
    title: 'Germany is 410 ahead of plan, the United Kingdom 390 behind',
    subtitle: { measure: 'Revenue', period: 'FY26 YTD' },
    unit: '$k',
    source: 'Illustrative steering block; the tint saturates at a variance of 500',
  },
});

// Coverage: a host that switched the prior-year toggle on.
const columnBand = fixtures.find((entry) => entry.id === 'column-band')!;
fixtures.push({
  ...columnBand,
  id: 'column-band-prior-year-shown',
  title: 'The prior-year months a host toggled on through columnVisibility',
  tags: ['coverage'],
  options: { ...columnBand.options, columnVisibility: { py: true }, size: { width: 900, height: 309 } },
});

// Coverage: one parent opened over a collapsed depth, rungs 24 px apart.
const levelLadder = fixtures.find((entry) => entry.id === 'table-level-ladder')!;
fixtures.push({
  ...levelLadder,
  id: 'level-ladder-one-open',
  title: 'Only Subscriptions opened over a collapsed tree, each rung indented 24 px',
  tags: ['coverage'],
  options: {
    ...levelLadder.options,
    size: { width: 760, height: 430 },
    expansion: { depth: 0, expanded: ['subscriptions'] },
    // The default base is the cell air (12) plus 24.
    labelIndent: { base: 36, step: 24 },
    title: "Subscriptions add 360 of the group's 418 growth",
  },
});

// a parent the reader cannot fold, and a status chip on each section heading.
fixtures.push(
  {
    id: 'unfoldable-parent',
    title: 'Core stays open at depth 0 because it is foldable: false; New ventures folds',
    kind: 'example',
    tags: ['coverage'],
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Business' },
        { id: 'ac', kind: 'value', label: '2026', format: '1,234' },
      ],
      rows: [
        { id: 'core', label: 'Core', foldable: false, children: [
          { id: 'core-retail', label: 'Retail', cells: { ac: 2140 } },
          { id: 'core-trade', label: 'Trade', cells: { ac: 1310 } },
        ] },
        { id: 'ventures', label: 'New ventures', children: [
          { id: 'ventures-app', label: 'App', cells: { ac: 220 } },
          { id: 'ventures-rental', label: 'Rental', cells: { ac: 95 } },
        ] },
      ],
    },
    options: {
      expansion: { depth: 0 },
      title: 'Core carries 3,450 of the 3,765',
      source: 'Illustrative data',
    },
  },
  {
    id: 'sections-with-badges',
    title: 'Three section headings with a warn, a good and a neutral status chip, at a narrow width',
    kind: 'example',
    tags: ['coverage'],
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'KPI' },
        { id: 'ac', kind: 'value', label: 'Actual', format: '1,234' },
        { id: 'pl', kind: 'value', label: 'Plan', format: '1,234' },
      ],
      rows: [
        { id: 'sec-growth', label: 'Growth from first and returning orders', role: 'section', badge: { text: 'At risk', tone: 'warn' }, children: [
          { id: 'first-orders', label: 'First orders', cells: { ac: 1240, pl: 1400 } },
          { id: 'repeat-orders', label: 'Repeat orders', cells: { ac: 3120, pl: 3000 } },
        ] },
        { id: 'sec-cost', label: 'Cost', role: 'section', badge: { text: 'On track', tone: 'good' }, children: [
          { id: 'cost-order', label: 'Cost per order', cells: { ac: 12, pl: 13 } },
        ] },
        { id: 'sec-service', label: 'Service', role: 'section', badge: { text: 'Not reviewed' }, children: [
          { id: 'tickets', label: 'Tickets', cells: { ac: 410, pl: 400 } },
        ] },
      ],
    },
    options: {
      size: { width: 342, height: 390 },
      title: 'First orders trail plan',
      source: 'Illustrative data',
    },
  },
  {
    // a frame narrower than the natural table squeezes the label track below what the
    // hints need: "Core · 2 lines" still fits, "New ventures" keeps its count as "· 2…".
    id: 'collapsed-hint-narrow',
    title: 'A squeezed label column: one hint whole, one cut to its count, none running into the figures',
    kind: 'example',
    tags: ['coverage'],
    data: {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Business' },
        { id: 'ac', kind: 'value', label: '2026', format: '1,234' },
      ],
      rows: [
        { id: 'core', label: 'Core', children: [
          { id: 'core-retail', label: 'Retail', cells: { ac: 2140 } },
          { id: 'core-trade', label: 'Trade', cells: { ac: 1310 } },
        ] },
        { id: 'ventures', label: 'New ventures', children: [
          { id: 'ventures-app', label: 'App', cells: { ac: 220 } },
          { id: 'ventures-rental', label: 'Rental', cells: { ac: 95 } },
        ] },
      ],
      levelNouns: [{ one: 'unit', other: 'units' }, { one: 'line', other: 'lines' }],
    },
    options: {
      expansion: { depth: 0 },
      size: { width: 300, height: 240 },
      title: 'Core carries 3,450 of the 3,765',
      source: 'Illustrative data',
    },
  },
  {
    id: 'badge-on-data-row',
    title: 'Refusal example: a status chip on a data row',
    kind: 'example',
    refuses: { code: 'invalid-data' },
    data: {
      columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'ac', kind: 'value' }],
      rows: [{ id: 'orders', badge: { text: 'At risk', tone: 'warn' }, cells: { ac: 1 } }],
    },
  },
);

// a wide table drawn at the width it is shown at, its text set larger
// through the theme's role sizes, never scaled down by the host. The table
// reference recipe prints the same spec.
const quarters = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'];
fixtures.push({
  id: 'wide-at-destination-width',
  title: 'Nine columns at the 1,050 px column they are shown in, with larger body text',
  kind: 'example',
  data: {
    columns: [
      { id: 'region', kind: 'rowLabel', label: 'Sales region', width: 210 },
      ...quarters.map((label, index) => ({ id: `q${index + 1}`, kind: 'value' as const, label, format: '1,234', width: 98 })),
    ],
    rows: [
      { id: 'north', label: 'North', cells: { q1: 1200, q2: 1305, q3: 1310, q4: 1415, q5: 1420, q6: 1425, q7: 1530, q8: 1535 } },
      { id: 'central', label: 'Central', cells: { q1: 1650, q2: 1655, q3: 1660, q4: 1665, q5: 1770, q6: 1775, q7: 1780, q8: 1785 } },
      { id: 'south', label: 'South', cells: { q1: 1880, q2: 1985, q3: 1990, q4: 1995, q5: 2040, q6: 2125, q7: 2130, q8: 2135 } },
      { id: 'west-coast', label: 'West coast', cells: { q1: 2190, q2: 2195, q3: 2280, q4: 2285, q5: 2290, q6: 2395, q7: 2400, q8: 2405 } },
      { id: 'east-coast', label: 'East coast', cells: { q1: 2440, q2: 2525, q3: 2530, q4: 2535, q5: 2620, q6: 2625, q7: 2630, q8: 2715 } },
      { id: 'islands', label: 'Islands', cells: { q1: 2750, q2: 2755, q3: 2760, q4: 2845, q5: 2870, q6: 2875, q7: 2960, q8: 2965 } },
    ],
  },
  options: {
    title: 'Every region sold more in 2026 than a year before',
    subtitle: { measure: 'Units sold', period: 'Q1 2025 to Q4 2026' },
    source: 'Synthetic data for an invented retailer',
    size: { width: 1050 },
    embed: { width: 1050 },
    theme: { preset: 'boardroom', overrides: { type: { label: { size: 13 }, axis: { size: 12 } } } },
  },
});

// a forecast column in strong weight, both sparkline kinds, a bad
// section chip, an explicit neutral tone and every explicit cell state.
fixtures.push({
  id: 'regional-scorecard-states',
  title: 'A strong forecast column, line and column sparklines, a bad section chip and every non-value cell state',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    columns: [
      { id: 'region', kind: 'rowLabel', label: 'Region' },
      { id: 'q1', kind: 'value', label: 'Q1', format: '1', aggregate: 'none' },
      { id: 'q2', kind: 'value', label: 'Q2', format: '1', aggregate: 'none' },
      { id: 'q3', kind: 'value', label: 'Q3', format: '1', aggregate: 'none' },
      { id: 'q4', kind: 'value', label: 'Q4', format: '1', aggregate: 'none', scenario: 'FC', emphasis: 'strong' },
      { id: 'trend', kind: 'encoding', label: 'Trend', encoding: { type: 'sparkline', kind: 'line', sourceColumns: ['q1', 'q2', 'q3', 'q4'] } },
      { id: 'volume', kind: 'encoding', label: 'Volume', encoding: { type: 'sparkline', kind: 'column', sourceColumns: ['q1', 'q2', 'q3', 'q4'] } },
    ],
    rows: [
      { id: 'north', label: 'North', role: 'section', badge: { text: 'Off plan', tone: 'bad' } },
      { id: 'nordics', parentId: 'north', label: 'Nordics', cells: { q1: 42, q2: 38, q3: 35, q4: 33 } },
      { id: 'baltics', parentId: 'north', label: 'Baltics', cells: { q1: 12, q2: 13, q3: { state: 'na' }, q4: 14 } },
      { id: 'south', label: 'South', role: 'section', badge: { text: 'Not reviewed', tone: 'neutral' } },
      { id: 'iberia', parentId: 'south', label: 'Iberia', cells: { q1: { state: 'nm' }, q2: { v: 41, tone: 'neutral' }, q3: 44, q4: 47 } },
      { id: 'italy', parentId: 'south', label: 'Italy', cells: { q1: 28, q2: { state: 'suppressed' }, q3: 31, q4: { state: 'open' } } },
    ],
  },
  options: {
    title: 'North slides every quarter; the south grows where it reports',
    subtitle: { measure: 'Orders, thousands', period: 'FY26', scenarios: ['AC', 'FC'] },
    source: 'Synthetic regional orders',
  },
});

fixtures.push(...cohortFixtures);

fixtures.push({
  id: 'mixed-units', title: 'Money, counts and rates keep their own units', kind: 'torture',
  data: {
    columns: [
      { id: 'name', kind: 'rowLabel', label: 'Group' },
      { id: 'amount', kind: 'value', label: 'Amount', format: '$1.0' },
      { id: 'count', kind: 'value', label: 'Count', format: '1' },
      { id: 'rate', kind: 'value', label: 'Rate', format: '1.0%' },
    ],
    rows: [{ id: 'a', label: 'A', cells: { amount: 12, count: 3, rate: 15 } }],
  }, options: { title: 'Three measures', subtitle: 'Money, counts and rates' },
});

// a rate column whose points all sit below 1.5 declares its scale, so it does not warn percent-scale-suspect.
fixtures.push({
  id: 'percent-points-declared', title: 'Low conversion rates declared in points', kind: 'example',
  data: {
    columns: [
      { id: 'channel', kind: 'rowLabel', label: 'Channel' },
      { id: 'cvr', kind: 'value', label: 'Conversion rate', format: '1.23%', percentScale: 'points' },
    ],
    rows: [
      { id: 'search', label: 'Search', cells: { cvr: 1.24 } },
      { id: 'social', label: 'Social', cells: { cvr: 0.61 } },
      { id: 'email', label: 'Email', cells: { cvr: 1.42 } },
    ],
  },
  options: { title: 'Email converts best at 1.42%' },
});

fixtures.push({
  id: 'hierarchy-kinds', title: 'Member, measure and split presentation', kind: 'example',
  data: { columns: [{id:'label',kind:'rowLabel',label:'Channel / measure',maxWidth:320}, {id:'value',kind:'value',label:'Actual'}], rows: [
    {id:'section',label:'Channels',kind:'section'},
    {id:'member',label:'Search',kind:'member',totalPolicy:'source',cells:{value:120}},
      {parentId:'member',id:'orders',label:'Orders',kind:'measure',scale:'count',relation:'displayOnly',cells:{value:120}},
      {parentId:'member',id:'spend',label:'Spend',kind:'measure',scale:'money',format:'$1.2',unitAffix:'$',relation:'displayOnly',cells:{value:4400}},
      {parentId:'member',id:'cost',label:'Cost per order',kind:'measure',scale:'perUnit',format:'$1.2',unitAffix:'$',relation:'displayOnly',cells:{value:36.67}},
      {parentId:'member',id:'rate',label:'Rate',kind:'measure',scale:'percent',format:'1.2%',relation:'displayOnly',cells:{value:2.5}},
      {parentId:'member',id:'new',label:'New customers',kind:'split',relation:'ofWhich',cells:{value:70}},
      {parentId:'orders',id:'search-a',label:'Search A',kind:'detail',relation:'displayOnly',cells:{value:80}},
  ]}, options:{title:'Search contributes 120 orders',variant:'steering',mountCollapsed:false},
});
// maxTextWidth caps how much the label text adds (150 px); the indent and the unit affix come on top, so the long label wraps while the track grows past 150.
fixtures.push({
  id: 'row-label-text-cap', title: 'A row-label text cap with an indent and a unit affix', kind: 'example',
  data: { columns: [{id:'label',kind:'rowLabel',label:'Channel / measure',maxTextWidth:150}, {id:'value',kind:'value',label:'Actual'}], rows: [
    {id:'member',label:'Branded search campaigns in the northern region',kind:'member',totalPolicy:'source',cells:{value:120}},
      {parentId:'member',id:'spend',label:'Spend on branded search campaigns in the northern region',kind:'measure',scale:'money',format:'$1.2',unitAffix:'$ per month',relation:'displayOnly',cells:{value:4400}},
      {parentId:'member',id:'orders',label:'Orders',kind:'measure',scale:'count',relation:'displayOnly',cells:{value:120}},
  ]}, options:{title:'Branded search spends $4,400 a month',variant:'steering',mountCollapsed:false},
});
// Campaign names with no spaces break after _ - / . and take two lines in a capped label track
// (rowLabelLines, default 2); a name longer than two lines keeps its distinguishing tail. Invented names.
fixtures.push({
  id: 'long-campaign-names', title: 'Campaign names that wrap after _ and - in a capped label track', kind: 'example',
  data: { columns: [
    {id:'name',kind:'rowLabel',label:'Campaign · ad set',maxWidth:240},
    {id:'spend',kind:'value',label:'Spend',format:'$1.1k',aggregate:'sum'},
    {id:'purchases',kind:'value',label:'Purchases',format:'1',aggregate:'sum'},
  ], rows: [
    {id:'north',label:'North'},
    {id:'n-auto',parentId:'north',label:'Garden-Tools_Spring-Sale_Northern_Region_Broad-Reach_Wave_Q4'},
    {id:'n-auto-1',parentId:'n-auto',label:'Garden-Tools_North_Broad-Reach_Group_v2.4',cells:{spend:28000,purchases:18}},
    {id:'n-auto-2',parentId:'n-auto',label:'Garden-Tools_North_Hobby-Mix_Gardeners-and-Cooks/Wider-Reach_v3.2',cells:{spend:24500,purchases:46}},
    {id:'n-re',parentId:'north',label:'Garden-Tools_Spring-Sale_Northern_Return-Visitors_14d',cells:{spend:38000,purchases:31}},
    {id:'n-q3',parentId:'north',label:'Garden-Tools_Spring-Sale_Northern_Region_Broad-Reach_Wave_Q3',cells:{spend:12500,purchases:52}},
  ]}, options:{title:'Four campaigns spend $103k in the north',source:'Invented campaign names'},
});
fixtures.push({
  id: 'contribution-margin-statement',
  title: 'Contribution margin with signed costs and driver rows',
  kind: 'example', tags: [],
  data: {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Statement', width: 260 },
      { id: 'prior', kind: 'value', label: 'Prior', format: '1,234', width: 100 },
      { id: 'current', kind: 'value', label: 'Current', format: '1,234', width: 100 },
    ],
    rows: [
      { id: 'income', label: 'Income', operator: '+', cells: { prior: 900, current: { v: 1000, tone: 'good', strong: true } } },
      { id: 'costs', label: 'Costs', kind: 'subtotal', sign: -1, children: [
        { id: 'delivery', label: 'Delivery', cells: { prior: 250, current: { v: 300, tone: 'warn' } } },
        { id: 'fees', label: 'Fees', cells: { prior: 100, current: { v: 120, tone: 'bad' } } },
        { id: 'rebate', label: 'Rebate', sign: -1, cells: { prior: 30, current: 40 } },
      ] },
      { id: 'margin', label: 'Contribution margin', kind: 'result', final: true,
        calc: { op: 'sub', a: { ref: { row: 'income' } }, b: { ref: { row: 'costs' } } } },
      { id: 'rate', label: 'Margin rate', kind: 'driver', format: '1.2%',
        calc: { op: 'mul', a: { lit: 100 }, b: { op: 'div', a: { op: 'sub', a: { ref: { row: 'income' } }, b: { ref: { row: 'costs' } } }, b: { ref: { row: 'income' } } } } },
    ],
  },
  options: { signs: 'operators', judgements: 'exceptions', title: 'Contribution margin', size: { width: 720, height: 440 } },
});
/** An authored P&L: signed costs, chained results (EBIT reads gross profit) and a closing rule. */
const pl = (drivers: boolean): TableData => ({
  columns: [
    { id: 'line', kind: 'rowLabel', label: '$k' },
    { id: 'fy25', kind: 'value', label: 'FY2025', format: '1,234' },
    { id: 'fy26', kind: 'value', label: 'FY2026', format: '1,234' },
    { id: 'chg', kind: 'computed', label: 'Change', calc: { op: 'delta', a: 'fy26', b: 'fy25' }, format: '+1,234' },
  ],
  rows: [
    { id: 'revenue', label: 'Revenue', kind: 'subtotal', children: [
      { id: 'product', label: 'Product sales', cells: { fy25: 8200, fy26: 9100 } },
      { id: 'services', label: 'Services', ...(drivers ? { operator: '+' as const } : {}), cells: { fy25: 1300, fy26: 1500 } },
    ] },
    // Drivers sit beside the line they explain, at the top level, and are never added.
    ...(drivers ? [
      { id: 'units', label: 'Units sold (k)', kind: 'driver' as const, cells: { fy25: 41, fy26: 45 } },
      { id: 'price', label: 'Price per unit', kind: 'driver' as const, operator: '×' as const, format: '1.2', cells: { fy25: 231.7, fy26: 235.6 } },
      { id: 'returns', label: 'Returns (k)', kind: 'driver' as const, operator: '−' as const, format: '1.2', cells: { fy25: 1.2, fy26: 1.1 } },
    ] : []),
    { id: 'cogs', label: 'Cost of sales', kind: 'subtotal', sign: -1, children: [
      { id: 'materials', label: 'Materials', cells: { fy25: 3900, fy26: 4300 } },
      { id: 'freight', label: 'Freight', cells: { fy25: 600, fy26: 700 } },
    ] },
    ...(drivers ? [{ id: 'unitcost', label: 'Cost per unit', kind: 'driver' as const, operator: '÷' as const, format: '1.2', cells: { fy25: 109.8, fy26: 111.1 } }] : []),
    { id: 'gp', label: 'Gross profit', kind: 'result', calc: { op: 'sub', a: { ref: { row: 'revenue' } }, b: { ref: { row: 'cogs' } } } },
    { id: 'opex', label: 'Operating expenses', kind: 'subtotal', sign: -1, children: [
      { id: 'staff', label: 'Staff', cells: { fy25: 2400, fy26: 2550 } },
      { id: 'marketing', label: 'Marketing', cells: { fy25: 900, fy26: 1150 } },
    ] },
    { id: 'ebit', label: 'EBIT', kind: 'result', final: true, ...(drivers ? { operator: '=' as const } : {}), calc: { op: 'sub', a: { ref: { row: 'gp' } }, b: { ref: { row: 'opex' } } } },
  ],
});
fixtures.push(
  { id: 'pl-statement', title: 'An authored P&L, signed', kind: 'example', tags: [], data: pl(false), options: { title: 'EBIT rises 200 to 1,900', signs: 'signed', judgements: 'all' } },
  { id: 'pl-statement-operators', title: 'The P&L with operators and drivers', kind: 'example', tags: [], data: pl(true), options: { title: 'EBIT rises 200 to 1,900', signs: 'operators' } },
  { id: 'pl-statement-plain', title: 'The P&L as supplied', kind: 'example', tags: [], data: pl(false), options: { title: 'EBIT rises 200 to 1,900', signs: 'plain' } },
);
// ---------- 0.28: value bands, sticky head and sections, driver tones ----------

/** Value bands on numeric cells: an explicit tone beats a band, a band beats the sign judgement, and missing, n/a and open cells stay unjudged. */
const HEALTH_BANDS = [
  { to: 50, tone: 'bad' as const, label: 'At risk' },
  { to: 75, tone: 'warn' as const, label: 'Watch' },
  { to: 100, tone: 'good' as const, label: 'Healthy' },
];
const DRIFT_BANDS = [
  { to: -2, tone: 'bad' as const, label: 'Falling' },
  { to: 2, tone: 'neutral' as const, label: 'Flat' },
  { to: 99, tone: 'good' as const, label: 'Rising' },
];
const healthCell = (value: number, drift: number): Record<string, TableCell> => ({
  score: { v: value, bands: HEALTH_BANDS },
  drift: { v: drift, bands: DRIFT_BANDS },
});
fixtures.push({
  id: 'value-bands',
  title: 'Value bands colour a numeric cell by the range its value is in',
  kind: 'example',
  tags: [],
  data: {
    columns: [
      { id: 'market', kind: 'rowLabel', label: 'Market' },
      { id: 'score', kind: 'value', label: 'Health score', format: '1' },
      { id: 'drift', kind: 'value', label: 'Drift (pts)', format: '+1.2' },
    ],
    rows: [
      { id: 'north', label: 'North', cells: healthCell(82, 4.1) },
      { id: 'east', label: 'East', cells: healthCell(61, 0.4) },
      { id: 'south', label: 'South', cells: healthCell(38, -3.5) },
      // The band edge belongs to the lower band: 75 is Watch.
      { id: 'west', label: 'West', cells: healthCell(75, -2) },
      // An explicit tone beats the bands.
      { id: 'centre', label: 'Centre (manual review)', cells: { score: { v: 90, bands: HEALTH_BANDS, tone: 'neutral' }, drift: { v: 0, bands: DRIFT_BANDS } } },
      // Missing, n/a and open cells stay unjudged.
      { id: 'islands', label: 'Islands', cells: { score: null, drift: { state: 'na', bands: DRIFT_BANDS } } },
      { id: 'harbour', label: 'Harbour', cells: { score: { state: 'open', bands: HEALTH_BANDS }, drift: { v: 1.5, bands: DRIFT_BANDS } } },
    ],
  },
  options: { title: 'One of seven markets is at risk', size: { width: 560 } },
});

/** A wide table with many rows under flat section headings, for the sticky head and section label. */
function stickyBoard(owned: boolean): TableData {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  const sections = ['Acquisition', 'Retention', 'Revenue'];
  const rows: TableRow[] = [];
  sections.forEach((name, sectionIndex) => {
    const leaves: TableRow[] = Array.from({ length: 8 }, (_, i) => {
      const monthly = months.map((_, m) => 90 + ((i * 7 + m * 13 + sectionIndex * 29) % 61));
      return {
        id: `s${sectionIndex}-r${i}`,
        label: `${name} line ${i + 1}`,
        cells: Object.fromEntries([['ytd', monthly.reduce((sum, v) => sum + v, 0)], ...monthly.map((v, m) => [`m${m}`, v])]),
      };
    });
    if (owned) rows.push({ id: `sec${sectionIndex}`, label: name, role: 'section', children: leaves });
    else rows.push({ id: `sec${sectionIndex}`, label: name, role: 'section' }, ...leaves);
  });
  return {
    columns: [
      { id: 'line', kind: 'rowLabel', label: 'Line' },
      { id: 'ytd', kind: 'value', label: 'Jan–Oct', format: '1,234' },
      ...months.map((month, m) => ({ id: `m${m}`, kind: 'value' as const, label: month, format: '1,234' })),
    ],
    rows,
  };
}
fixtures.push(
  {
    id: 'page-sticky-sections',
    title: 'The head pins to the page scroll 48 px down, and the active section label stays under it',
    kind: 'example',
    tags: [],
    data: stickyBoard(false),
    options: { title: 'Lines by section', stickyLabels: { head: 'page', columns: 2, top: 48, sections: true } },
  },
  {
    id: 'scroll-sticky-sections',
    title: 'The head and two columns pin inside the table scroll box, with the active section label under the head',
    kind: 'torture',
    tags: [],
    data: stickyBoard(true),
    options: { title: 'Lines by section', stickyLabels: { head: 'table', columns: 2, sections: true } },
  },
);

/** Driver rows under a parent show the tone their figure earns; a flat driver and a driver under a section keep the driver ink. */
const driverTonesData: TableData = {
    columns: [
      { id: 'line', kind: 'rowLabel', label: '$ per order' },
      { id: 'fy25', kind: 'value', label: 'FY2025', format: '1.2' },
      { id: 'fy26', kind: 'value', label: 'FY2026', format: '1.2' },
      { id: 'vs', kind: 'value', label: 'vs plan', format: '+1.2' },
    ],
    rows: [
      { id: 'sec', label: 'Drivers outside the statement', role: 'section', children: [
        { id: 'orders', label: 'Orders per month (k)', kind: 'driver', cells: { fy25: 41, fy26: 45, vs: { v: 1.5, tone: 'good' } } },
      ] },
      { id: 'margin', label: 'Contribution margin', kind: 'measure', cells: { fy25: 12.4, fy26: 13.1, vs: { v: 0.3, tone: 'good' } }, children: [
        { id: 'aov', label: 'Average order value', kind: 'driver', cells: { fy25: 52.4, fy26: 55.1, vs: { v: 1.2, tone: 'good' } } },
        { id: 'returns', label: 'Returns per order', kind: 'driver', cells: { fy25: 3.1, fy26: 3.6, vs: { v: 0.4, tone: 'bad' } } },
        { id: 'basket', label: 'Items per basket', kind: 'driver', cells: { fy25: 2.4, fy26: 2.4, vs: 0 } },
      ] },
      { id: 'fx', label: 'USD per 100 EUR', kind: 'driver', cells: { fy25: 108, fy26: 110, vs: { v: 2, tone: 'bad' } } },
    ],
  };
const driverTonesOptions = { title: 'Drivers under a line carry the judgement of their figures', size: { width: 560 } };
fixtures.push(
  { id: 'driver-tones-grouped', title: 'Drivers under a line show good and bad tones; a flat driver keeps the driver ink', kind: 'torture', tags: [], data: driverTonesData, options: { ...driverTonesOptions, driverTones: 'grouped' } },
  { id: 'driver-tones-always', title: 'Every driver shows its tones, the flat one too', kind: 'example', tags: [], data: driverTonesData, options: { ...driverTonesOptions, title: 'Every driver carries the judgement of its figures', driverTones: 'always' } },
  { id: 'driver-tones-never', title: 'Drivers keep the driver ink, as before 0.28', kind: 'torture', tags: [], data: driverTonesData, options: { ...driverTonesOptions, title: 'Drivers print in the driver ink only', driverTones: 'never' } },
  { id: 'sticky-columns-only', title: 'Two columns pin and the head does not', kind: 'torture', tags: [], data: stickyBoard(true), options: { title: 'Lines by section', stickyLabels: { head: false, columns: 2 } } },
);


/** A small P&L with a folded group, for the group ground, what folds a parent and the frame fill. */
const groupsData = (fit = false): TableData => ({
  columns: [
    { id: 'line', kind: 'rowLabel', label: '$k' },
    { id: 'fy25', kind: 'value', label: 'FY2025', format: '1,234', ...(fit ? { width: 84, fitFormat: false as const } : {}) },
    { id: 'fy26', kind: 'value', label: 'FY2026', format: '1,234', ...(fit ? { width: 84 } : {}) },
  ],
  rows: [
    { id: 'revenue', label: 'Revenue', ...(fit ? { fitFormat: false as const } : {}), cells: { fy25: 9500, fy26: 10600 }, children: [
      { id: 'product', label: 'Product sales', cells: { fy25: 8200, fy26: 9100 } },
      { id: 'services', label: 'Services', cells: { fy25: 1300, fy26: 1500 } },
    ] },
    { id: 'costs', label: 'Costs', cells: { fy25: 5200, fy26: 5600 }, children: [
      { id: 'materials', label: 'Materials', cells: { fy25: 3900, fy26: 4300 } },
      { id: 'staff', label: 'Staff', cells: { fy25: 1300, fy26: 1300 } },
    ] },
  ],
});
fixtures.push(
  { id: 'group-ground-expanded', title: 'Only the open group has the group ground; a folded group row looks like a normal row', kind: 'example', tags: [], data: groupsData(), options: { title: 'Revenue is folded and costs are open', groupGround: 'expanded', foldOn: 'toggle', expansion: { collapsed: ['revenue'] } } },
  { id: 'group-ground-always', title: 'The group ground stays on a folded group row, as before 0.28', kind: 'example', tags: [], data: groupsData(), options: { title: 'Revenue is folded and costs are open', groupGround: 'always', foldOn: 'row', expansion: { collapsed: ['revenue'] } } },
  { id: 'group-ground-none', title: 'No group ground at all', kind: 'example', tags: [], data: groupsData(), options: { title: 'Revenue is folded and costs are open', groupGround: 'none', expansion: { collapsed: ['revenue'] } } },
  { id: 'frame-fill-values', title: 'Under rowExtent frame the value tracks grow until every layer ends at the frame edge', kind: 'example', tags: [], data: groupsData(), options: { title: 'Rows and columns end together', rowExtent: 'frame', frameFill: 'values', size: { width: 720 } } },
  { id: 'frame-fill-none', title: 'The old frame: columns keep their widths and an empty stretch carries the rows to the edge', kind: 'example', tags: [], data: groupsData(true), options: { title: 'The rows run on past the columns', rowExtent: 'frame', frameFill: 'none', fitFormats: true, size: { width: 720 } } },
  { id: 'table-look-keys', title: 'A theme sets the quiet row rule, its width and the secondary ink; each open block opens on the rule ink', kind: 'example', tags: [], data: groupsData(), options: { title: 'Costs rose less than revenue', theme: { preset: 'boardroom', overrides: { table: { ruleInk: '#B9C7D6', ruleWidths: { row: 1 }, inks: { secondary: '#3A5F86' }, blockRule: 'rule' } } } } },
);

registerFixtures('table', fixtures);
