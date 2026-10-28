/**
 * Gantt fixtures: examples (realistic program / launch plans) + torture set
 * (single-day span, multi-year span, dense rows, anchored chains, same-day
 * milestone clusters). Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { GanttData } from '../../types/data';
import type { GanttOptions } from './layout';

export const fixtures: Fixture<GanttData, GanttOptions>[] = [
  {
    id: 'status-gantt',
    title: 'Status Gantt (hierarchy, elapsed era, events, and cadence swimlanes)',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'interviews', segmentId: 'interviews-span' } },
    data: {
      rows: [
        {
          id: 'interviews',
          label: 'External interviews',
          items: [
            { id: 'interviews-span', kind: 'bracket', start: '2026-04-06', end: '2026-05-15' },
          ],
        },
        {
          id: 'interview-prep',
          label: 'Preparation and outreach',
          indent: 1,
          items: [
            { id: 'prep-bar', kind: 'bar', start: '2026-04-06', end: '2026-04-17', label: 'Prepare' },
          ],
        },
        {
          id: 'interview-exec',
          label: 'Execution and synthesis',
          indent: 1,
          items: [
            { id: 'exec-bar', kind: 'bar', start: '2026-04-20', end: '2026-05-15', label: 'Interview wave' },
            { id: 'readout', kind: 'milestone', start: '2026-05-15', label: 'Read-out' },
          ],
        },
        {
          id: 'workshops',
          label: 'Management workshops',
          items: [
            // A workshop takes the theme's special schedule colour.
            {
              id: 'workshop-bar', kind: 'bar', start: '2026-04-27', end: '2026-05-29', label: 'Align target state',
              colorRole: 'status-gantt-special', colorLabel: 'Workshop',
            },
          ],
        },
        {
          id: 'operating-model',
          label: 'Operating model',
          items: [
            { id: 'model-bar', kind: 'chevron', start: '2026-05-04', end: '2026-06-12', label: 'Design' },
          ],
        },
        {
          id: 'decision-package',
          label: 'Decision package',
          indent: 1,
          items: [
            { id: 'decision-bar', kind: 'bar', start: '2026-05-25', end: '2026-06-12', label: 'Draft' },
            { id: 'decision-gate', kind: 'milestone', start: '2026-06-12', label: 'Decision' },
          ],
        },
        {
          id: 'roadmap',
          label: 'Implementation roadmap',
          items: [
            { id: 'roadmap-bar', kind: 'bar', start: '2026-06-01', end: '2026-06-26', label: 'Mobilize' },
          ],
        },
        {
          id: 'benefits',
          label: 'Benefits case',
          indent: 1,
          items: [
            { id: 'benefits-bar', kind: 'bar', start: '2026-05-18', end: '2026-06-19', label: 'Validate' },
          ],
        },
        {
          id: 'team-cadence',
          label: 'Project team',
          kind: 'cadence',
          marker: 'diamond',
          // Both diamond cadences take the one cadence colour, keyed as a
          // recurring event; a second diamond colour would mean nothing a row
          // name does not already say.
          events: [
            { id: 'team-1', date: '2026-04-10' },
            { id: 'team-2', date: '2026-04-17' },
            { id: 'team-3', date: '2026-04-24' },
            { id: 'team-4', date: '2026-05-01' },
            { id: 'team-5', date: '2026-05-08' },
            { id: 'team-6', date: '2026-05-15' },
            { id: 'team-7', date: '2026-05-22' },
            { id: 'team-8', date: '2026-05-29' },
            { id: 'team-9', date: '2026-06-05' },
            { id: 'team-10', date: '2026-06-12' },
            { id: 'team-11', date: '2026-06-19' },
          ],
        },
        {
          id: 'update-cadence',
          label: 'Sponsor update calls',
          kind: 'cadence',
          marker: 'triangle',
          colorRole: 'neutral',
          events: [
            { id: 'update-1', date: '2026-04-17' },
            { id: 'update-2', date: '2026-05-01' },
            { id: 'update-3', date: '2026-05-15' },
            { id: 'update-4', date: '2026-05-29' },
            { id: 'update-5', date: '2026-06-12' },
          ],
        },
        {
          id: 'steerco-cadence',
          label: 'Steering committee',
          kind: 'cadence',
          marker: 'diamond',
          events: [
            { id: 'steerco-1', date: '2026-04-24' },
            { id: 'steerco-2', date: '2026-05-22' },
            { id: 'steerco-3', date: '2026-06-19' },
          ],
        },
      ],
    },
    options: {
      title: 'Status: Core decisions remain on track for the June mobilization',
      subtitle: { company: 'Example Co', measure: 'Program status', period: 'April–June 2026' },
      source: 'Illustrative PMO schedule',
      today: '2026-05-13',
      // At slide height one inline bar caption loses its slot, and at 720 two
      // inline captions run past their bars. The full a4 page (1052 px: same
      // type steps, more days per label) keeps every label of the curated
      // gantt set shown.
      size: 'a4',
    },
    annotations: [
      { id: 'sc-1', kind: 'event', at: 'steerco-1', label: '1. Steering committee' },
      { id: 'sc-2', kind: 'event', at: 'steerco-2', label: '2. Steering committee' },
      { id: 'sc-3', kind: 'event', at: 'steerco-3', label: '3. Steering committee' },
    ],
  },
  {
    id: 'transformation-program',
    title: '12-month transformation program (owner and status columns, bars in their status colour, shared milestones, cadence band, today line)',
    kind: 'example',
    data: {
      rows: [
        {
          id: 'diag',
          label: 'Diagnostic',
          cols: ['Operations', { text: 'Done', tone: 'good' }],
          items: [
            { id: 'diag-base', kind: 'bar', start: '2026-01-05', end: '2026-03-13', label: 'Baseline' },
            { id: 'sc1', kind: 'milestone', start: '2026-02-23', label: 'SC1', scope: 'shared' },
          ],
        },
        {
          id: 'diag-int',
          label: 'Interviews',
          indent: 1,
          items: [
            { id: 'interviews', kind: 'bar', start: '2026-01-19', end: '2026-02-27' },
          ],
        },
        {
          id: 'design',
          label: 'Concept design',
          cols: ['Design', { text: 'In progress', tone: 'neutral' }],
          items: [
            { id: 'design-bar', kind: 'bar', start: '2026-03-02', end: '2026-06-26' },
            { id: 'sc2', kind: 'milestone', start: '2026-06-29', label: 'SC2', scope: 'shared' },
          ],
        },
        {
          id: 'pilots',
          label: 'Pilots',
          indent: 1,
          cols: ['Delivery', { text: 'At risk', tone: 'warn' }],
          items: [
            { id: 'wave1', kind: 'bar', start: '2026-05-04', end: '2026-08-28', label: 'Wave 1' },
            { id: 'wave2', kind: 'chevron', start: '2026-09-01', end: '2026-10-30', label: 'Wave 2' },
          ],
        },
        {
          id: 'rollout',
          label: 'Rollout',
          cols: ['Team', { text: 'Delayed', tone: 'bad' }],
          items: [
            { id: 'rollout-chev', kind: 'chevron', start: '2026-09-07', end: '2026-12-18' },
          ],
        },
        {
          id: 'gov',
          label: 'Governance',
          items: [
            { id: 'gov-shade', kind: 'shade', start: '2026-01-05', end: '2026-06-26' },
            { id: 'gov-h1', kind: 'bracket', start: '2026-01-05', end: '2026-06-26', label: 'Board cadence H1' },
            { id: 'end', kind: 'milestone', start: '2026-12-21', label: 'Project end' },
          ],
        },
      ],
    },
    options: {
      title: 'Rollout decision moves to September after pilot read-out',
      subtitle: { company: 'Acme Corp', measure: 'Transformation program', period: 'FY26' },
      source: 'PMO plan of record, June 2026',
      today: '2026-07-03',
      rowTint: true,
      colHeaders: ['Owner', 'Status'],
    },
  },
  {
    id: 'product-launch',
    title: 'Product launch plan (anchored items, week scale, weekends)',
    kind: 'example',
    data: {
      rows: [
        {
          id: 'prep',
          label: 'Preparation',
          cols: ['PM'],
          items: [
            { id: 'prep-scope', kind: 'bar', start: '2026-04-06', end: '2026-04-17', label: 'Scoping' },
          ],
        },
        {
          id: 'build',
          label: 'Build',
          cols: ['Eng'],
          items: [
            {
              id: 'build-dev', kind: 'bar', start: '2026-04-20', end: '2026-05-22', label: 'Build',
              anchor: { toItemId: 'prep-scope', edge: 'end', offsetDays: 2 },
            },
          ],
        },
        {
          id: 'test',
          label: 'Test & QA',
          cols: ['QA'],
          items: [
            {
              id: 'test-qa', kind: 'bar', start: '2026-05-25', end: '2026-06-12', label: 'QA cycles',
              anchor: { toItemId: 'build-dev', edge: 'end', offsetDays: 2 },
            },
          ],
        },
        {
          id: 'launch',
          label: 'Launch',
          cols: ['GTM'],
          items: [
            {
              id: 'launch-go', kind: 'milestone', start: '2026-06-15', label: 'Go live',
              anchor: { toItemId: 'test-qa', edge: 'end', offsetDays: 2 },
            },
            {
              id: 'hypercare', kind: 'chevron', start: '2026-06-17', end: '2026-07-03', label: 'Hypercare', colorRole: 'neutralLight', colorLabel: 'After go-live',
              anchor: { toItemId: 'launch-go', edge: 'end', offsetDays: 1 },
            },
          ],
        },
      ],
    },
    options: {
      title: 'Go-live lands mid-June with two weeks of hypercare',
      subtitle: { measure: 'Launch plan', period: 'Q2 2026' },
      // the PM, Eng, QA and GTM column names who owns each phase.
      colHeaders: ['Owner'],
      source: 'Illustrative launch plan; each phase is anchored to the one before it',
      today: '2026-05-06',
      weekends: true,
    },
  },
  {
    id: 'single-day',
    title: 'Torture: single-day span pads to a whole week',
    kind: 'torture',
    data: {
      rows: [
        {
          id: 'kickoff',
          label: 'Kickoff',
          items: [
            { id: 'k-bar', kind: 'bar', start: '2026-03-04', label: 'Workshop' },
            { id: 'k-ms', kind: 'milestone', start: '2026-03-04', label: 'Start' },
          ],
        },
      ],
    },
    options: { title: 'One day still renders a readable week scale' },
  },
  {
    id: 'two-year-span',
    title: 'Torture: 26-month span uses years + quarters headers',
    kind: 'torture',
    data: {
      rows: [
        {
          id: 'phase-a',
          label: 'Phase A',
          items: [
            { id: 'a-bar', kind: 'bar', start: '2025-02-10', end: '2025-11-28', label: 'Foundation' },
          ],
        },
        {
          id: 'phase-b',
          label: 'Phase B',
          items: [
            { id: 'b-shade', kind: 'shade', start: '2025-09-01', end: '2026-08-31' },
            { id: 'b-bar', kind: 'bar', start: '2025-10-06', end: '2026-07-31', label: 'Scale-up' },
            { id: 'b-ms', kind: 'milestone', start: '2026-08-14', label: 'Gate' },
          ],
        },
        {
          id: 'phase-c',
          label: 'Phase C',
          items: [
            { id: 'c-bracket', kind: 'bracket', start: '2026-06-01', end: '2027-03-31', label: 'Value capture' },
            { id: 'c-chev', kind: 'chevron', start: '2026-09-01', end: '2027-03-31', label: 'Run-rate' },
          ],
        },
      ],
    },
    options: { title: 'Quarter cells stay labeled across three calendar years', today: '2026-04-15' },
  },
  {
    id: 'dense-14-rows',
    title: 'Torture: 14 rows at month scale stay overlap-free',
    kind: 'torture',
    data: {
      rows: Array.from({ length: 14 }, (_, i) => {
        const startMonth = (i % 5) + 1;
        const endMonth = Math.min(startMonth + 1 + (i % 3), 6);
        const mm = (m: number) => String(m).padStart(2, '0');
        return {
          id: `t${i + 1}`,
          label: i % 3 === 0 ? `Workstream ${i + 1}` : `Task ${i + 1} with a longer name`,
          indent: i % 3 === 0 ? 0 : 1,
          cols: i % 3 === 0 ? [`Own${i + 1}`] : [],
          items: [
            {
              id: `t${i + 1}-bar`,
              kind: 'bar' as const,
              start: `2026-${mm(startMonth)}-05`,
              end: `2026-${mm(endMonth)}-20`,
              label: `D${i + 1}`,
            },
            ...(i % 4 === 2
              ? [{ id: `t${i + 1}-ms`, kind: 'milestone' as const, start: `2026-${mm(endMonth)}-25` }]
              : []),
          ],
        };
      }),
    },
    options: { title: 'Fourteen dense rows', today: '2026-03-18', rowTint: true },
  },
  {
    id: 'anchored-chain',
    title: 'Torture: anchor chain declared in reverse order',
    kind: 'torture',
    data: {
      rows: [
        {
          id: 'c5',
          label: 'Step 5',
          items: [
            {
              id: 's5', kind: 'chevron', start: '2026-01-01', end: '2026-01-09', label: 'Ship',
              anchor: { toItemId: 's4', edge: 'end', offsetDays: 2 },
            },
          ],
        },
        {
          id: 'c4',
          label: 'Step 4',
          items: [
            {
              id: 's4', kind: 'bar', start: '2026-01-01', end: '2026-01-12',
              anchor: { toItemId: 's3', edge: 'end' },
            },
          ],
        },
        {
          id: 'c3',
          label: 'Step 3',
          items: [
            {
              id: 's3', kind: 'bar', start: '2026-01-01', end: '2026-01-14',
              anchor: { toItemId: 's2', edge: 'end', offsetDays: 3 },
            },
          ],
        },
        {
          id: 'c2',
          label: 'Step 2',
          items: [
            {
              id: 's2', kind: 'bar', start: '2026-01-01', end: '2026-01-09',
              anchor: { toItemId: 's1', edge: 'end' },
            },
          ],
        },
        {
          id: 'c1',
          label: 'Step 1',
          items: [{ id: 's1', kind: 'bar', start: '2026-01-05', end: '2026-01-16', label: 'Root' }],
        },
      ],
    },
    options: { title: 'Chain resolves topologically regardless of authoring order', weekends: true },
  },
  {
    id: 'milestone-cluster',
    title: 'Torture: same-day milestone cluster spreads its labels',
    kind: 'torture',
    data: {
      rows: [
        {
          id: 'r1',
          label: 'Approvals',
          items: [{ id: 'ga', kind: 'milestone', start: '2026-02-11', label: 'Gate A' }],
        },
        {
          id: 'r2',
          label: 'Reviews',
          items: [
            { id: 'gb', kind: 'milestone', start: '2026-02-11', label: 'Gate B' },
            { id: 'gc', kind: 'milestone', start: '2026-02-11', label: 'Gate C' },
            { id: 'gd', kind: 'milestone', start: '2026-02-11', label: 'Gate D' },
          ],
        },
        {
          id: 'r3',
          label: 'Delivery',
          items: [
            { id: 'del', kind: 'bar', start: '2026-02-02', end: '2026-02-27', label: 'Sprint' },
            { id: 'ge', kind: 'milestone', start: '2026-02-11', label: 'Gate E' },
          ],
        },
      ],
    },
    options: { title: 'Five gates on one day keep readable labels' },
  },
  {
    id: 'right-edge-milestone-row',
    title: 'Regression: last row with only a right-edge milestone keeps its activity label centered',
    kind: 'torture',
    data: {
      rows: [
        {
          id: 'delivery',
          label: 'Delivery window',
          items: [{ id: 'delivery-bar', kind: 'bar', start: '2026-08-03', end: '2026-09-18' }],
        },
        {
          id: 'governance-edge',
          label: 'Governance',
          items: [{ id: 'edge-gate', kind: 'milestone', start: '2026-09-25' }],
        },
      ],
    },
    options: { title: 'Governance remains aligned when its only mark is the final gate', rowTint: true },
  },
  {
    id: 'workstream-status-plan',
    // Status bars resolve through good, warn or neutral, never the accent.
    title: 'Workstream status plan (weekly view, owners, due dates, and semantic status)',
    kind: 'example',
    data: {
      rows: [
        {
          id: 'diagnostic',
          label: 'Diagnostic',
          cols: ['QA team', '07 Aug'],
          items: [
            { id: 'diagnostic-status', kind: 'bar', start: '2026-08-03', end: '2026-08-07', label: 'Done', colorRole: 'neutral' },
          ],
        },
        {
          id: 'target-state',
          label: 'Target state',
          cols: ['Design', '21 Aug'],
          items: [
            { id: 'target-status', kind: 'bar', start: '2026-08-10', end: '2026-08-21', label: 'Done', colorRole: 'neutral' },
          ],
        },
        {
          id: 'business-case',
          label: 'Business case',
          cols: ['Finance', '04 Sep'],
          items: [
            { id: 'case-status', kind: 'bar', start: '2026-08-17', end: '2026-09-04', label: 'On track', colorRole: 'good' },
          ],
        },
        {
          id: 'operating-model',
          label: 'Operating model',
          cols: ['Platform', '11 Sep'],
          items: [
            { id: 'model-status', kind: 'bar', start: '2026-08-24', end: '2026-09-11', label: 'At risk', colorRole: 'warn' },
          ],
        },
        {
          id: 'mobilization',
          label: 'Mobilization',
          cols: ['Delivery', '18 Sep'],
          items: [
            { id: 'mobilization-status', kind: 'chevron', start: '2026-09-07', end: '2026-09-18', label: 'On track', colorRole: 'good' },
          ],
        },
      ],
    },
    options: {
      title: 'Operating-model decisions are the only workstream at risk',
      subtitle: { company: 'Example Co', measure: 'Workstream status', period: 'August–September 2026' },
      source: 'Illustrative PMO status plan',
      colHeaders: ['Owner', 'Due date'],
      today: '2026-08-31',
      elapsed: false,
      rowTint: true,
      weekends: true,
    },
  },
  {
    id: 'metadata-column-headers',
    title: 'Three delivery rows with owner and due-date headers',
    kind: 'example',
    data: {
      rows: [
        { id: 'scope', label: 'Confirm scope', cols: ['Product', '14 Aug'], items: [
          { id: 'scope-work', kind: 'bar', start: '2026-08-03', end: '2026-08-14', colorRole: 'highlight' },
        ] },
        { id: 'pilot', label: 'Run pilot', cols: ['Operations', '28 Aug'], items: [
          { id: 'pilot-work', kind: 'bar', start: '2026-08-17', end: '2026-08-28', colorRole: 'highlight' },
        ] },
        { id: 'launch', label: 'Launch', cols: ['Delivery', '11 Sep'], items: [
          { id: 'launch-work', kind: 'bar', start: '2026-08-31', end: '2026-09-11', colorRole: 'highlight' },
        ] },
      ],
    },
    options: {
      title: 'Delivery work moves from scope through pilot to launch',
      colHeaders: ['Owner', 'Due date'], rowTint: true,
      source: 'Illustrative delivery plan',
    },
  },
  // Status timeline example: every name, date and figure is invented for this fixture.
  {
    id: 'status-timeline',
    title: 'Status timeline (row sublabels, status-coloured spans, change events)',
    kind: 'example',
    data: {
      rows: [
        {
          id: 'tag',
          label: 'Browser tag, shop pages',
          sublabel: 'page view, landing view',
          items: [
            { id: 'tag-before', kind: 'rule', start: '2026-03-02', end: '2026-03-09', label: 'fired on every visit' },
            { id: 'tag-broken', kind: 'chevron', start: '2026-03-10', end: '2026-03-31', label: '−60% landing views per click; 1 in 4 visitors consent', colorRole: 'bad', colorLabel: 'broken' },
          ],
        },
        {
          id: 'purchase',
          label: 'Browser purchase event',
          sublabel: 'sent with the server API',
          items: [
            { id: 'purchase-before', kind: 'rule', start: '2026-03-02', end: '2026-03-17', label: 'c. 64% / 52% of orders' },
            { id: 'purchase-broken', kind: 'chevron', start: '2026-03-18', end: '2026-03-31', label: 'Near zero', colorRole: 'bad', colorLabel: 'broken' },
          ],
        },
        {
          id: 'checkout',
          label: 'Checkout event stream',
          sublabel: 'payment events per order',
          items: [
            { id: 'checkout-before', kind: 'rule', start: '2026-03-02', end: '2026-03-09', label: 'c. 99%' },
            { id: 'checkout-step1', kind: 'bar', start: '2026-03-10', end: '2026-03-17', label: 'c. 91%', colorRole: 'warn', colorLabel: 'degraded' },
            { id: 'checkout-step2', kind: 'bar', start: '2026-03-18', end: '2026-03-23', label: 'c. 82%', colorRole: 'warn', colorLabel: 'degraded' },
            { id: 'checkout-broken', kind: 'chevron', start: '2026-03-24', end: '2026-03-31', label: 'c. 70%', colorRole: 'bad', colorLabel: 'broken' },
          ],
        },
        {
          id: 'attribution',
          label: 'Attribution model',
          sublabel: 'orders with a web touchpoint',
          items: [
            { id: 'attribution-before', kind: 'rule', start: '2026-03-02', end: '2026-03-17', label: '71–76%' },
            { id: 'attribution-degraded', kind: 'chevron', start: '2026-03-18', end: '2026-03-31', label: '48–55%', colorRole: 'warn', colorLabel: 'degraded' },
          ],
        },
        {
          id: 'server',
          label: 'Server event feed',
          sublabel: 'via the tag gateway',
          items: [
            { id: 'server-intact', kind: 'chevron', start: '2026-03-02', end: '2026-03-31', label: 'Unchanged: all event types daily; purchases = 92% of web orders', colorRole: 'good', colorLabel: 'intact' },
          ],
        },
        {
          id: 'orders',
          label: 'Orders',
          sublabel: 'web shop, two regions',
          items: [
            { id: 'orders-intact', kind: 'chevron', start: '2026-03-02', end: '2026-03-31', label: 'No break: region A 210–240, region B 60–75 web orders per day', colorRole: 'good', colorLabel: 'intact' },
          ],
        },
      ],
    },
    options: {
      title: 'Three changes since 10 March: browser and checkout events stay broken, the server feed is intact',
      subtitle: 'Status as of 31 March; arrow: still open',
      legend: 'bottom',
      source: 'Illustrative data',
      size: { width: 1000 },
    },
    annotations: [
      { id: 'change-1', kind: 'event', at: 'tag-broken', label: '1', labelPlacement: 'badge' },
      { id: 'change-2', kind: 'event', at: 'purchase-broken', label: '2', labelPlacement: 'badge' },
      { id: 'change-3', kind: 'event', at: 'checkout-broken', label: '3', labelPlacement: 'badge' },
    ],
  },
];

// Long names at a generous size read whole. The rendered SVG has no
// ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    rows: [
      {
        id: 'diag',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
        cols: ['Operations', 'Done'],
        items: [
          {
            id: 'diag-base',
            kind: 'bar',
            start: '2026-01-05',
            end: '2026-03-13',
            label: 'Baseline',
          },
          { id: 'sc1', kind: 'milestone', start: '2026-03-16', label: 'SC1' },
        ],
      },
      {
        id: 'diag-int',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
        indent: 1,
        items: [
          {
            id: 'interviews',
            kind: 'bar',
            start: '2026-01-19',
            end: '2026-02-27',
            colorRole: 'neutralLight',
          },
        ],
      },
      {
        id: 'design',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
        cols: ['Design', 'In progress'],
        items: [
          { id: 'design-bar', kind: 'bar', start: '2026-03-02', end: '2026-06-26' },
          { id: 'sc2', kind: 'milestone', start: '2026-06-29', label: 'SC2' },
        ],
      },
      {
        id: 'pilots',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
        indent: 1,
        items: [
          {
            id: 'wave1',
            kind: 'bar',
            start: '2026-05-04',
            end: '2026-08-28',
            label: 'Wave 1',
            colorRole: 'neutralLight',
          },
          { id: 'wave2', kind: 'chevron', start: '2026-09-01', end: '2026-10-30', label: 'Wave 2' },
        ],
      },
      {
        id: 'rollout',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
        cols: ['Team', 'Open'],
        items: [
          {
            id: 'rollout-chev',
            kind: 'chevron',
            start: '2026-09-07',
            end: '2026-12-18',
            colorRole: 'highlight',
          },
        ],
      },
      {
        id: 'gov',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
        items: [
          { id: 'gov-shade', kind: 'shade', start: '2026-01-05', end: '2026-06-26' },
          {
            id: 'gov-h1',
            kind: 'bracket',
            start: '2026-01-05',
            end: '2026-06-26',
            label: 'Board cadence H1',
          },
          { id: 'end', kind: 'milestone', start: '2026-12-21', label: 'Project end' },
        ],
      },
    ],
  },
  options: {
    title: 'Long names read whole at a generous size',
    subtitle: { company: 'Acme Corp', measure: 'Transformation program', period: 'FY26' },
    source: 'PMO plan of record, June 2026',
    today: '2026-07-03',
    rowTint: true,
    size: { width: 1440, height: 900 },
  },
});

fixtures.push({
  "id": "item-labels-off",
  "title": "Rows and status remain when item labels are off",
  "kind": "torture",
  "data": {
    "rows": [
      {
        "id": "r",
        "label": "Assembly",
        "cols": [
          {
            "text": "Ready",
            "tone": "good"
          }
        ],
        "items": [
          {
            "id": "i",
            "kind": "bar",
            "label": "Build",
            "start": "2027-01-04",
            "end": "2027-01-20"
          }
        ]
      }
    ]
  },
  "options": {
    "title": false,
    "labels": false,
    "colHeaders": [
      "Status"
    ]
  }
});

fixtures.push({
  id: 'five-nearby-milestones', title: 'Five nearby milestones retain their names', kind: 'torture',
  data: { rows: [{ id: 'delivery', label: 'Delivery', items: Array.from({ length: 5 }, (_, i) => ({
    id: `gate-${i + 1}`, kind: 'milestone' as const, start: `2026-04-${String(6 + i).padStart(2, '0')}`, label: `Gate ${i + 1}`,
  })) }] },
  options: { title: 'Five gates cover the delivery week', labels: { item: ['category'] }, size: { width: 800 } },
});
fixtures.push({
  id: 'item-date-content', title: 'Item dates selected without names', kind: 'example',
  data: { rows: [
    { id: 'build', label: 'Build', items: [{ id: 'build-span', kind: 'bar', label: 'Build window', start: '2026-04-06', end: '2026-04-10' }] },
    { id: 'review', label: 'Review', items: [{ id: 'review-gate', kind: 'milestone', label: 'Review gate', start: '2026-04-13' }] },
  ] },
  options: { title: 'Build finishes before the review gate', labels: { item: ['value'] }, size: { width: 900 } },
});
// 3 rows of 6 nearby milestones at 900 px. Every lane leader keeps off
// every label, the bar names included.
const day2026 = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
const denseRow = (id: string, label: string, barStart: number, first: number, names: string[]) => ({ id, label, items: [
  { id: `${id}-bar`, kind: 'bar' as const, label, start: day2026(barStart), end: day2026(barStart + 81) },
  ...names.map((name, i) => ({ id: `${id}-${i + 1}`, kind: 'milestone' as const, label: name, start: day2026(first + 7 * i) })),
] });
fixtures.push({
  id: 'dense-milestone-leaders', title: 'Leaders of eighteen nearby milestones cross no label', kind: 'torture',
  data: { rows: [
    denseRow('plan', 'Plan', 5, 14, ['Kickoff review', 'Scope signed', 'Budget gate', 'Design freeze', 'Vendor choice', 'Plan approved']),
    denseRow('build', 'Build', 12, 16, ['First sprint', 'Alpha drop', 'API ready', 'Beta drop', 'Code freeze', 'Release candidate']),
    denseRow('rollout', 'Rollout', 19, 19, ['Pilot start', 'Pilot review', 'Wave one', 'Wave two', 'Wave three', 'Handover']),
  ] },
  options: { title: 'Invented programme with dense milestones', size: { width: 900 } },
});
// the milestone lane makes every row taller than its 40 px pitch.
// The bars and the chevron keep the bar height of that pitch, centred in
// their rows, and a name with no room on its bar takes the room above it.
fixtures.push({
  id: 'milestone-lane-tall-rows', title: 'Bars keep their height in rows a milestone lane makes tall', kind: 'example',
  data: { rows: [
    { id: 'discovery', label: 'Discovery', items: [
      { id: 'discovery-bar', kind: 'chevron', label: 'Discovery', start: day2026(5), end: day2026(40) },
      ...['Brief', 'Interviews', 'Synthesis', 'Readout'].map((name, i) => ({ id: `discovery-${i + 1}`, kind: 'milestone' as const, label: name, start: day2026(9 + 6 * i) })),
    ] },
    { id: 'design', label: 'Design', items: [
      { id: 'design-bar', kind: 'bar', label: 'Design', start: day2026(30), end: day2026(75) },
      ...['Concepts', 'Prototype', 'Usability test', 'Sign-off'].map((name, i) => ({ id: `design-${i + 1}`, kind: 'milestone' as const, label: name, start: day2026(31 + 6 * i) })),
    ] },
    { id: 'delivery', label: 'Delivery', items: [{ id: 'delivery-bar', kind: 'bar', label: 'Delivery', start: day2026(70), end: day2026(130) }] },
  ] },
  options: { title: 'Design signs off before delivery starts', subtitle: 'Invented product programme, 2026', size: { width: 900 } },
});
fixtures.push({
  "id": "adjacent-milestone-bands",
  "title": "Neighbouring rows keep their milestone labels",
  "kind": "torture",
  "data": {
    "rows": [
      {
        "id": "a",
        "label": "Data platform",
        "items": [
          {"id": "a-bar", "kind": "bar", "label": "Data platform", "start": "2026-01-05", "end": "2026-09-30"},
          {"id": "a1", "kind": "milestone", "label": "Schema agreed", "start": "2026-02-10"},
          {"id": "a2", "kind": "milestone", "label": "First load", "start": "2026-03-20"},
          {"id": "a3", "kind": "milestone", "label": "Backfill done", "start": "2026-05-04"},
          {"id": "a4", "kind": "milestone", "label": "Go-live", "start": "2026-06-15"}
        ]
      },
      {
        "id": "b",
        "label": "Reporting",
        "items": [
          {"id": "b-bar", "kind": "bar", "label": "Reporting", "start": "2026-02-01", "end": "2026-10-31"},
          {"id": "b1", "kind": "milestone", "label": "KPI list frozen", "start": "2026-02-20"},
          {"id": "b2", "kind": "milestone", "label": "Mock-ups signed", "start": "2026-03-30"},
          {"id": "b3", "kind": "milestone", "label": "Pilot dashboard", "start": "2026-05-12"},
          {"id": "b4", "kind": "milestone", "label": "Rollout", "start": "2026-06-25"}
        ]
      },
      {
        "id": "c",
        "label": "Training",
        "items": [{"id": "c-bar", "kind": "bar", "label": "Training", "start": "2026-06-01", "end": "2026-11-30"}]
      }
    ]
  },
  "options": {"title": "Data programme runs to November", "source": "Invented data", "size": {"width": 900}}
});

registerFixtures('gantt', fixtures);
