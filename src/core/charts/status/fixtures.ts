/**
 * Status-matrix fixtures: a newspaper-style policy decision calendar, a consulting
 * RAG rollout board, and a patterned capability assessment. The generator
 * keeps authored-state references valid and sparse density within 20–80%.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { StatusData, StatusOptions, StatusState } from './layout';

const PERIOD_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CENTRAL_BANKS = Array.from({ length: 24 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return [`cb${number}`, `Central Bank ${number}`] as const;
});

const POLICY_COLUMNS = Array.from({ length: 60 }, (_, index) => {
  const year = 2021 + Math.floor(index / 12);
  const month = index % 12;
  return {
    id: `${year}-${String(month + 1).padStart(2, '0')}`,
    label: `${PERIOD_LABELS[month]} ${String(year).slice(2)}`,
  };
});

const POLICY_CELLS = CENTRAL_BANKS.flatMap(([row], rowIndex) => {
  const cadence = 1 + ((rowIndex * 7) % 3);
  return POLICY_COLUMNS.flatMap((column, columnIndex) => {
    if ((columnIndex + rowIndex * 2) % cadence !== 0) return [];
    const cycle = columnIndex + (rowIndex % 5) - Math.floor(rowIndex / 8);
    const state =
      cycle < 17
        ? (columnIndex + rowIndex) % 4 === 0
          ? 'hold'
          : 'hike'
        : cycle < 38
          ? (columnIndex + rowIndex) % 9 === 0
            ? 'hike'
            : 'hold'
          : (columnIndex + rowIndex) % 4 === 0
            ? 'hold'
            : 'cut';
    return [{ row, col: column.id, state }];
  });
});

const POLICY_STATES: StatusState[] = [
  // Status tones resolve through good, warn, bad or neutral, never the accent.
  { id: 'cut', label: 'Rate cut', tone: 'good' },
  { id: 'hold', label: 'Hold', tone: 'neutral' },
  { id: 'hike', label: 'Rate hike', tone: 'warn' },
];

export const fixtures: Fixture<StatusData, StatusOptions>[] = [
  {
    id: 'central-bank-decisions',
    title: 'Central-bank policy decisions: 24 entities × 60 monthly periods',
    kind: 'torture',
    data: {
      rows: CENTRAL_BANKS.map(([id, label]) => ({ id, label })),
      columns: POLICY_COLUMNS,
      cells: POLICY_CELLS,
    },
    options: {
      states: POLICY_STATES,
      size: { width: 1052, height: 890 },
      columnLabels: 'bottom',
      title: 'Most central banks moved from synchronized tightening to selective easing',
      subtitle: {
        measure: 'Policy rate decision by institution and month',
        period: '2021–2025',
      },
      source: 'Illustrative policy calendar; sparse months indicate no recorded decision',
    },
  },
  {
    id: 'programme-rollout-rag',
    title: 'Consulting programme rollout RAG board with sparse future gates',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { seriesId: 'pricing', categoryId: 'design' } },
    data: {
      rows: [
        { id: 'pricing', label: 'Pricing excellence' },
        { id: 'sales', label: 'CRM effectiveness' },
        { id: 'service', label: 'Service operating model' },
        { id: 'data', label: 'Data platform' },
        { id: 'erp', label: 'ERP harmonization' },
        { id: 'talent', label: 'Talent academy' },
        { id: 'sourcing', label: 'Strategic sourcing' },
        { id: 'footprint', label: 'Footprint optimization' },
      ],
      columns: [
        { id: 'design', label: 'Design' },
        { id: 'pilot', label: 'Pilot' },
        { id: 'wave-1', label: 'Wave 1' },
        { id: 'wave-2', label: 'Wave 2' },
        { id: 'scale', label: 'Scale' },
        { id: 'stabilize', label: 'Stabilize' },
      ],
      cells: [
        { row: 'pricing', col: 'design', state: 'green' },
        { row: 'pricing', col: 'pilot', state: 'green' },
        { row: 'pricing', col: 'wave-1', state: 'green' },
        { row: 'pricing', col: 'wave-2', state: 'amber' },
        { row: 'pricing', col: 'scale', state: 'amber' },
        { row: 'sales', col: 'design', state: 'green' },
        { row: 'sales', col: 'pilot', state: 'green' },
        { row: 'sales', col: 'wave-1', state: 'amber' },
        { row: 'sales', col: 'wave-2', state: 'red' },
        { row: 'service', col: 'design', state: 'green' },
        { row: 'service', col: 'pilot', state: 'amber' },
        { row: 'service', col: 'wave-1', state: 'amber' },
        { row: 'data', col: 'design', state: 'green' },
        { row: 'data', col: 'pilot', state: 'red' },
        { row: 'data', col: 'wave-1', state: 'red' },
        { row: 'erp', col: 'design', state: 'amber' },
        { row: 'erp', col: 'pilot', state: 'amber' },
        { row: 'talent', col: 'design', state: 'green' },
        { row: 'talent', col: 'pilot', state: 'green' },
        { row: 'talent', col: 'wave-1', state: 'green' },
        { row: 'talent', col: 'wave-2', state: 'green' },
        { row: 'talent', col: 'scale', state: 'amber' },
        { row: 'sourcing', col: 'design', state: 'green' },
        { row: 'sourcing', col: 'pilot', state: 'amber' },
        { row: 'sourcing', col: 'wave-1', state: 'red' },
        { row: 'footprint', col: 'design', state: 'amber' },
        { row: 'footprint', col: 'pilot', state: 'red' },
      ],
    },
    options: {
      states: [
        { id: 'green', label: 'On track', tone: 'good' },
        { id: 'amber', label: 'At risk', tone: 'warn', pattern: 'hatch45' },
        { id: 'red', label: 'Off track', tone: 'bad' },
      ],
      colorblindSafe: true,
      title: 'Data, footprint, and sourcing need intervention before Wave 2',
      subtitle: {
        company: 'Northstar Transformation',
        measure: 'Delivery confidence by programme and stage',
        period: 'June 2026',
      },
      source: 'Illustrative programme status, June 2026',
    },
  },
  {
    id: 'capability-assessment',
    title: 'Capability assessment with a patterned unverified state',
    kind: 'example',
    data: {
      rows: [
        { id: 'strategy', label: 'Digital strategy' },
        { id: 'product', label: 'Product management' },
        { id: 'data', label: 'Data & analytics' },
        { id: 'technology', label: 'Technology platform' },
        { id: 'talent', label: 'Talent & skills' },
        { id: 'governance', label: 'Governance' },
        { id: 'adoption', label: 'Business adoption' },
      ],
      columns: [
        { id: 'consumer', label: 'Consumer' },
        { id: 'industrial', label: 'Industrial' },
        { id: 'services', label: 'Services' },
        { id: 'ventures', label: 'Ventures' },
        { id: 'group', label: 'Group functions' },
      ],
      cells: [
        { row: 'strategy', col: 'consumer', state: 'leading' },
        { row: 'strategy', col: 'industrial', state: 'established' },
        { row: 'strategy', col: 'services', state: 'established' },
        { row: 'strategy', col: 'ventures', state: 'leading' },
        { row: 'strategy', col: 'group', state: 'developing' },
        { row: 'product', col: 'consumer', state: 'established' },
        { row: 'product', col: 'industrial', state: 'developing' },
        { row: 'product', col: 'services', state: 'established' },
        { row: 'product', col: 'ventures', state: 'leading' },
        { row: 'product', col: 'group', state: 'unverified' },
        { row: 'data', col: 'consumer', state: 'developing' },
        { row: 'data', col: 'industrial', state: 'developing' },
        { row: 'data', col: 'services', state: 'established' },
        { row: 'data', col: 'ventures', state: 'leading' },
        { row: 'data', col: 'group', state: 'unverified' },
        { row: 'technology', col: 'consumer', state: 'established' },
        { row: 'technology', col: 'industrial', state: 'established' },
        { row: 'technology', col: 'services', state: 'developing' },
        { row: 'technology', col: 'ventures', state: 'leading' },
        { row: 'technology', col: 'group', state: 'developing' },
        { row: 'talent', col: 'consumer', state: 'developing' },
        { row: 'talent', col: 'industrial', state: 'unverified' },
        { row: 'talent', col: 'services', state: 'developing' },
        { row: 'talent', col: 'ventures', state: 'established' },
        { row: 'talent', col: 'group', state: 'unverified' },
        { row: 'governance', col: 'consumer', state: 'developing' },
        { row: 'governance', col: 'industrial', state: 'developing' },
        { row: 'governance', col: 'services', state: 'developing' },
        { row: 'governance', col: 'ventures', state: 'established' },
        { row: 'governance', col: 'group', state: 'established' },
        { row: 'adoption', col: 'consumer', state: 'established' },
        { row: 'adoption', col: 'industrial', state: 'developing' },
        { row: 'adoption', col: 'services', state: 'unverified' },
        { row: 'adoption', col: 'ventures', state: 'leading' },
      ],
    },
    options: {
      states: [
        { id: 'leading', label: 'Leading', tone: 'good' },
        { id: 'established', label: 'Established', tone: { role: 'status-won' } },
        { id: 'developing', label: 'Developing', tone: 'neutral' },
        {
          id: 'unverified',
          label: 'Not independently verified',
          tone: 'warn',
          pattern: 'hatch45',
        },
      ],
      title: 'Ventures leads, while evidence gaps obscure group capability maturity',
      subtitle: {
        company: 'Brevinth Group',
        measure: 'Capability verdict by business unit',
        period: 'Q2 2026',
      },
      source: 'Leadership interviews and capability evidence review, June 2026',
    },
  },
];

for (const legend of ['none', 'right', 'bottom', 'top'] as const) {
  fixtures.push({
    id: `review-status-legend-${legend}`,
    title: legend === 'right'
      ? 'Refusal example: a state legend beside the grid, refused for the width it takes'
      : `Review status with ${legend === 'none' ? 'one explained state and no legend' : `a ${legend} legend`}`,
    kind: legend === 'right' ? 'example' : 'torture',
    // A key beside the plot is refused; this spec stays as the refusal example.
    ...(legend === 'right' ? { refuses: { code: 'invalid-options', path: 'options.legend' } } : {}),
    data: {
      rows: [{ id: 'pricing', label: 'Pricing' }, { id: 'service', label: 'Service' }],
      columns: [{ id: 'draft', label: 'Draft' }, { id: 'review', label: 'Review' }],
      cells: [
        { row: 'pricing', col: 'draft', state: 'reviewed' },
        { row: 'pricing', col: 'review', state: 'reviewed' },
        { row: 'service', col: 'draft', state: 'reviewed' },
        ...(legend === 'none' ? [] : [{ row: 'service', col: 'review', state: 'pending' }]),
      ],
    },
    options: {
      states: [
        { id: 'reviewed', label: 'Reviewed', tone: 'info' },
        { id: 'pending', label: 'Pending', tone: 'neutral' },
      ],
      legend, columnLabels: 'bottom',
      title: legend === 'none' ? 'Three review steps have recorded completion' : 'Pricing review is complete; service review remains open',
      subtitle: { measure: legend === 'none' ? 'Filled cells mean reviewed; blank cells have no recorded status' : 'Review progress by workstream and stage' },
      source: 'Illustrative review log',
    },
  });
}

// Long names at a generous size read whole. The rendered SVG has no
// ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    rows: [
      {
        id: 'strategy',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: 'product',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: 'data',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: 'technology',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
      {
        id: 'talent',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
      },
      {
        id: 'governance',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
      },
      {
        id: 'adoption',
        label: 'Corporate lending incl. syndicated, leveraged and sustainability-linked finance',
      },
    ],
    columns: [
      { id: 'consumer', label: 'Consumer' },
      { id: 'industrial', label: 'Industrial' },
      { id: 'services', label: 'Services' },
      { id: 'ventures', label: 'Ventures' },
      { id: 'group', label: 'Group functions' },
    ],
    cells: [
      { row: 'strategy', col: 'consumer', state: 'leading' },
      { row: 'strategy', col: 'industrial', state: 'established' },
      { row: 'strategy', col: 'services', state: 'established' },
      { row: 'strategy', col: 'ventures', state: 'leading' },
      { row: 'strategy', col: 'group', state: 'developing' },
      { row: 'product', col: 'consumer', state: 'established' },
      { row: 'product', col: 'industrial', state: 'developing' },
      { row: 'product', col: 'services', state: 'established' },
      { row: 'product', col: 'ventures', state: 'leading' },
      { row: 'product', col: 'group', state: 'unverified' },
      { row: 'data', col: 'consumer', state: 'developing' },
      { row: 'data', col: 'industrial', state: 'developing' },
      { row: 'data', col: 'services', state: 'established' },
      { row: 'data', col: 'ventures', state: 'leading' },
      { row: 'data', col: 'group', state: 'unverified' },
      { row: 'technology', col: 'consumer', state: 'established' },
      { row: 'technology', col: 'industrial', state: 'established' },
      { row: 'technology', col: 'services', state: 'developing' },
      { row: 'technology', col: 'ventures', state: 'leading' },
      { row: 'technology', col: 'group', state: 'developing' },
      { row: 'talent', col: 'consumer', state: 'developing' },
      { row: 'talent', col: 'industrial', state: 'unverified' },
      { row: 'talent', col: 'services', state: 'developing' },
      { row: 'talent', col: 'ventures', state: 'established' },
      { row: 'talent', col: 'group', state: 'unverified' },
      { row: 'governance', col: 'consumer', state: 'developing' },
      { row: 'governance', col: 'industrial', state: 'developing' },
      { row: 'governance', col: 'services', state: 'developing' },
      { row: 'governance', col: 'ventures', state: 'established' },
      { row: 'governance', col: 'group', state: 'established' },
      { row: 'adoption', col: 'consumer', state: 'established' },
      { row: 'adoption', col: 'industrial', state: 'developing' },
      { row: 'adoption', col: 'services', state: 'unverified' },
      { row: 'adoption', col: 'ventures', state: 'leading' },
    ],
  },
  options: {
    states: [
      { id: 'leading', label: 'Leading', tone: 'good' },
      { id: 'established', label: 'Established', tone: { role: 'status-won' } },
      { id: 'developing', label: 'Developing', tone: 'neutral' },
      { id: 'unverified', label: 'Not independently verified', tone: 'warn', pattern: 'hatch45' },
    ],
    title: 'Long names read whole at a generous size',
    subtitle: {
      company: 'Brevinth Group',
      measure: 'Capability verdict by business unit',
      period: 'Q2 2026',
    },
    source: 'Leadership interviews and capability evidence review, June 2026',
    size: { width: 1440, height: 900 },
  },
});

// A dark theme whose colorblind pair is its text ink and text red gives the
// large cells their own fill roles (color.colorblind.goodFill / badFill).
const rag = fixtures.find((fixture) => fixture.id === 'programme-rollout-rag')!;
fixtures.push({
  ...rag,
  kind: 'torture', id: 'programme-rollout-rag-dark-fills',
  title: 'RAG board on a dark theme with colorblind fill roles',
  tags: ['theme'],
  options: {
    ...rag.options!,
    states: rag.options!.states!,
    theme: {
      preset: 'standard-dark',
      // On track fills in a colour-safe blue, the healthy state, not a pale grey
      // that reads as a disabled cell.
      overrides: {
        color: { colorblind: { good: '#F0F0F5', bad: '#FF6362', goodFill: '#3F87DD', badFill: '#C8363B' } },
        // The column heads in the page's text ink, not the table family's muted head ink.
        table: { inks: { head: '#F4F7FA' } },
      },
    },
  },
});

// Every tone plain and hatched beside cells without a status: a
// hatched cell lies on its own tone, its key draws the same recipe, and the
// warn cell fills in the theme's warn fill, not its text amber.
const H2 = ['jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RAG_ROWS: [string, string, string[]][] = [
  ['finance', 'Finance transformation', ['g', 'g', 'a', 'g', 'g', 'g']],
  ['sales', 'Sales operations', ['a', 'r', 'a', 'a', 'g', '']],
  ['supply', 'Supply chain', ['r', 'r', 'a', 'r', 'a', 'a']],
  ['platform', 'IT platform', ['a', '', 'a', 'a', 'r', 'a']],
  ['people', 'People and culture', ['g', 'a', 'g', 'g', '', '']],
];
fixtures.push({
  id: 'rag-forecast-hatched',
  title: 'RAG board with each tone plain and hatched beside cells without a status',
  kind: 'torture',
  tags: ['theme'],
  data: {
    rows: RAG_ROWS.map(([id, label]) => ({ id, label })),
    columns: H2.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    // July to September are reported, October to December forecast.
    cells: RAG_ROWS.flatMap(([row, , states]) => states.flatMap((state, index) => state === ''
      ? []
      : [{ row, col: H2[index]!, state: `${state}${index >= 3 ? '-fc' : ''}` }])),
  },
  options: {
    states: [
      { id: 'g', label: 'On track', tone: 'good' },
      { id: 'a', label: 'At risk', tone: 'warn' },
      { id: 'r', label: 'Off track', tone: 'bad' },
      { id: 'g-fc', label: 'On track, forecast', tone: 'good', pattern: 'hatch45' },
      { id: 'a-fc', label: 'At risk, forecast', tone: 'warn', pattern: 'hatch45' },
      { id: 'r-fc', label: 'Off track, forecast', tone: 'bad', pattern: 'hatch45' },
    ],
    title: 'Supply chain and the IT platform stay at risk through the year end',
    subtitle: { measure: 'Workstream status by month, forecast hatched', period: 'H2 2026' },
    source: 'Illustrative programme status; a blank cell has no status yet',
  },
});

// The legend as a position object with an item order.
const legendBottom = fixtures.find((fixture) => fixture.id === 'review-status-legend-bottom')!;
fixtures.push({
  ...legendBottom,
  kind: 'torture', id: 'review-status-legend-object',
  title: 'Review status with the legend placed above through a position object',
  tags: ['coverage'],
  options: { ...legendBottom.options!, legend: { position: 'top' } },
});

fixtures.push({ id: 'status-with-values', title: 'State cells include their measured values', kind: 'torture', data: { rows: [{ id: 'team', label: 'Team' }], columns: [{ id: 'month', label: 'Month' }], cells: [{ row: 'team', col: 'month', state: 'ok', value: { number: 97.5, format: '1.0%' } }] }, options: { title: 'Attainment stays on plan', states: [{ id: 'ok', label: 'On plan', tone: 'good' }], size: { width: 600, height: 250 } } });

// The capability board with its good and neutral cells in their full colours
// (marks.statusFill 'full') instead of washed toward the page.
const capability = fixtures.find((fixture) => fixture.id === 'capability-assessment')!;
fixtures.push({
  ...capability,
  kind: 'torture', id: 'capability-assessment-full-fill',
  title: 'Capability board with good and neutral cells in their full colours',
  tags: ['theme'],
  options: { ...capability.options!, theme: { preset: 'standard', overrides: { marks: { statusFill: 'full' } } } },
});

registerFixtures('status', fixtures);
