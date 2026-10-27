/**
 * Funnel fixtures: examples (real-looking pipeline data) + torture set
 * (zero-total stage, 8 dense stages, sliver outcome segments, single stage,
 * centered extreme drop, centered two-stage degenerate, long labels, and a
 * negative value exercising the clamp guard). Every fixture auto-enters the
 * invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { ChartData } from '../../types/data';
import type { FunnelOptions } from '../../types/options';

export const fixtures: Fixture<ChartData, FunnelOptions>[] = [
  {
    id: 'lead-funnel',
    title: 'Lead funnel Leads to Won with three outcome series',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'leads', seriesId: 'advanced' } },
    data: {
      categories: [
        { id: 'leads', label: 'Leads' },
        { id: 'mql', label: 'MQL' },
        { id: 'sql', label: 'SQL' },
        { id: 'offer', label: 'Offer' },
        { id: 'won', label: 'Won' },
      ],
      series: [
        {
          id: 'advanced',
          label: 'Advanced',
          // Advanced takes the theme's strongest ramp step and Still open its
          // light neutral.
          colorRole: 'series-1',
          values: [2100, 940, 410, 150, 150],
        },
        {
          id: 'open',
          label: 'Still open',
          colorRole: 'neutralLight',
          values: [1450, 610, 250, 90, 0],
        },
        {
          id: 'lost',
          label: 'Lost',
          colorRole: 'status-lost',
          values: [1250, 550, 280, 170, 0],
        },
      ],
    },
    options: {
      variant: 'rows',
      title: 'Deals die at the offer stage: only 37% of proposals close',
      subtitle: {
        company: 'NorthPeak Software',
        measure: 'Pipeline conversion',
        period: 'FY25 Q1–Q2',
      },
      unit: 'leads',
      source: 'CRM export, 30 Jun 2026',
      legend: 'bottom',
      // Five stages need the taller preset — at 405px the Offer lost-segment label has no honest home.
      size: 'slide-4x3',
      highlight: ['offer'],
    },
  },
  {
    id: 'signup-simple',
    title: 'Simple 3-stage single-series sign-up funnel',
    kind: 'example',
    data: {
      categories: [
        { id: 'visitors', label: 'Visitors' },
        { id: 'trial', label: 'Free trial' },
        { id: 'paid', label: 'Paid plan' },
      ],
      series: [
        { id: 'users', label: 'Users', values: [12500, 1900, 480] },
      ],
    },
    options: {
      title: 'Only 4% of visitors become paying customers',
      subtitle: { measure: 'Sign-up funnel', period: 'Jun 2026' },
      unit: 'users',
      source: 'Product analytics, June 2026',
    },
  },
  {
    id: 'zero-stage',
    title: 'Torture: zero-total stage (division guard) + negative clamp',
    kind: 'torture',
    data: {
      categories: [
        { id: 'inbound', label: 'Inbound' },
        { id: 'qualified', label: 'Qualified' },
        { id: 'proposal', label: 'Proposal' },
        { id: 'closed', label: 'Closed' },
      ],
      series: [
        { id: 'count', label: 'Count', values: [320, 0, 45, -5] },
      ],
    },
    options: { title: 'Zero stages must not divide by zero' },
  },
  {
    id: 'eight-stages-dense',
    title: 'Torture: 8 stages, verbose labels, sliver tail',
    kind: 'torture',
    data: {
      categories: [
        { id: 's1', label: 'Initial outreach and cold contact attempts' },
        { id: 's2', label: 'Responded to first touchpoint' },
        { id: 's3', label: 'Discovery call completed' },
        { id: 's4', label: 'Technical evaluation started' },
        { id: 's5', label: 'Budget holder engaged' },
        { id: 's6', label: 'Commercial proposal issued' },
        { id: 's7', label: 'Contract in legal review' },
        { id: 's8', label: 'Signed and countersigned' },
      ],
      series: [
        {
          id: 'adv',
          label: 'Advanced',
          colorRole: 'status-advanced',
          values: [6800, 5000, 3500, 2200, 1200, 450, 110, 120],
        },
        {
          id: 'lost',
          label: 'Lost',
          colorRole: 'status-lost',
          values: [2800, 2200, 1900, 1600, 1200, 850, 390, 0],
        },
      ],
    },
    options: {
      title: 'Dense 8-stage funnel exposes constrained label lanes',
      // The counts name their unit and source.
      subtitle: { measure: 'Deals by pipeline stage', period: 'FY25' },
      unit: 'deals',
      source: 'Illustrative CRM pipeline export',
      size: 'slide-4x3',
      labelDensity: 'smart',
      legend: 'bottom',
      worstDropCallout: true,
    },
  },
  {
    id: 'sliver-segments',
    title: 'Torture: sliver outcome segments force outside labels',
    kind: 'torture',
    data: {
      categories: [
        { id: 'q1', label: 'Enquiries' },
        { id: 'q2', label: 'Screened' },
        { id: 'q3', label: 'Shortlist' },
        { id: 'q4', label: 'Placed' },
      ],
      series: [
        {
          id: 'adv',
          label: 'Advanced',
          colorRole: 'status-advanced',
          values: [1180, 590, 290, 140],
        },
        { id: 'open', label: 'Open', colorRole: 'status-open', values: [8, 4, 2, 1] },
        { id: 'lost', label: 'Lost', colorRole: 'status-lost', values: [5, 2, 1, 0.6] },
        {
          id: 'pending',
          label: 'Pending',
          colorRole: 'status-pending',
          values: [3, 1, 1, 0.4],
        },
      ],
    },
    options: {
      title: 'Sliver outcomes expose truthful stage conversion',
      size: 'slide-4x3',
      legend: 'bottom',
      worstDropCallout: true,
    },
  },
  {
    id: 'lead-funnel-centered',
    title: 'Centered lead funnel with total CVR column',
    kind: 'example',
    data: {
      categories: [
        { id: 'new-leads', label: 'New Leads' },
        { id: 'contact', label: 'Contact' },
        { id: 'scheduled', label: 'Scheduled' },
        { id: 'completed', label: 'Completed' },
        { id: 'won', label: 'Won' },
        { id: 'active', label: 'Active' },
      ],
      series: [
        {
          id: 'count',
          label: 'Leads',
                    values: [3200, 2260, 1540, 980, 430, 310],
        },
      ],
    },
    options: {
      variant: 'centered',
      stageShade: 'darken',
      totalCvr: 'column',
      title: 'Only 10% of new leads become active customers',
      subtitle: {
        company: 'Vesper Care',
        measure: 'Lead-to-active funnel',
        period: 'FY26 YTD',
      },
      unit: 'leads',
      source: 'Illustrative CRM stage history, July 2026',
      size: 'slide-4x3',
    },
  },
  {
    id: 'funnel-centered-extreme-drop',
    title: 'Torture: centered 99% to 0.5% tail stays measurable',
    kind: 'torture',
    data: {
      categories: [
        { id: 'applications', label: 'Applications' },
        { id: 'qualified', label: 'Qualified' },
        { id: 'active', label: 'Active' },
      ],
      series: [
        {
          id: 'count',
          label: 'Leads',
                    values: [20000, 19800, 100],
        },
      ],
    },
    options: {
      variant: 'centered',
      totalCvr: 'column',
      title: 'The 0.5% tail remains honest and visibly labelled',
      unit: 'leads',
      size: 'slide-4x3',
    },
  },
  {
    id: 'funnel-centered-two-stage',
    title: 'Torture: centered two-stage degenerate',
    kind: 'torture',
    data: {
      categories: [
        { id: 'started', label: 'Started' },
        { id: 'finished', label: 'Finished' },
      ],
      series: [
        {
          id: 'count',
          label: 'People',
                    values: [1200, 420],
        },
      ],
    },
    options: {
      variant: 'centered',
      title: 'Two stages retain the classic centered silhouette',
      unit: 'people',
    },
  },
  {
    id: 'funnel-centered-lighten',
    title: 'Centered single-series funnel with a lightening stage ladder',
    kind: 'example',
    data: {
      categories: [{ id: 'started', label: 'Started' }, { id: 'qualified', label: 'Qualified' }, { id: 'completed', label: 'Completed' }],
      series: [{ id: 'count', label: 'Applications', values: [1200, 900, 600] }],
    },
    options: {
      variant: 'centered',
      stageShade: 'lighten',
      title: 'Half of applications reach completion',
      unit: 'applications',
      source: 'Illustrative application stages',
      size: { width: 720, height: 540 },
    },
  },
  {
    id: 'single-stage',
    title: 'Torture: single stage, no conversions, no auto note',
    kind: 'torture',
    data: {
      categories: [{ id: 'pipeline', label: 'Open pipeline' }],
      series: [
        { id: 'adv', label: 'Advanced', colorRole: 'status-advanced', values: [6400] },
        { id: 'open', label: 'Still open', colorRole: 'status-open', values: [3200] },
      ],
    },
  },
  {
    id: 'funnel-near-callout',
    title: 'Row callout beside its source stage',
    kind: 'example',
    data: {
      categories: [{ id: 'visitors', label: 'Visitors' }, { id: 'trial', label: 'Trial' }, { id: 'paid', label: 'Paid' }],
      series: [{ id: 'users', label: 'Users', values: [12000, 6000, 3000] }],
    },
    options: {
      title: 'Trial conversion is 50%',
      source: 'Illustrative conversion data',
      unit: 'users',
      size: 'slide-4x3',
      // The callout says what the chart does not: why the step matters.
      annotations: [{ id: 'trial-note', kind: 'callout', at: { categoryId: 'trial' }, text: 'Trial cut to 14 days in May', preferSide: 'right' }],
    },
  },
];

const naturalRowsExample = fixtures.find((fixture) => fixture.id === 'lead-funnel')!;
// The tiles sit near the height ladder (band at 1051, std at 493), tall
// enough for the step rates between the bars and still close to minimum rows.
// The compact tile is sized to the report type floor.
for (const [mode, width, height] of [['full', 1051, 292], ['compact', 493, 289]] as const) {
  fixtures.push({
    ...naturalRowsExample,
    id: `lead-funnel-${mode}`,
    title: `Torture: segment labels in a ${mode} funnel on a short tile`,
    kind: 'torture',
    options: { ...naturalRowsExample.options, mode, size: { width, height },
      canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } } },
    // At minimum row height every stage keeps its name and its bold
    // total. The segment values stand as keyed chips, and
    // the step conversions stand in their own column, so nothing is hidden.
  });
}

fixtures.push({
  ...fixtures[1]!,
  id: 'signup-centered-without-total-cvr',
  title: 'Centered sign-up funnel with stage conversion only',
  options: { ...fixtures[1]!.options!, variant: 'centered', totalCvr: 'none', stageShade: 'darken' },
});

fixtures.push(
  {
    id: 'stage-comparisons',
    title: 'Half of qualified applications reach completion',
    kind: 'example', tags: ['demo', 'annotation', 'diff', 'delta'],
    data: {
      categories: [{ id: 'started', label: 'Started' }, { id: 'qualified', label: 'Qualified' }, { id: 'completed', label: 'Completed' }],
      series: [{ id: 'applications', label: 'Applications', values: [1000, 800, 400] }],
    },
    options: {
      variant: 'rows', size: { width: 1000, height: 600 },
      title: 'Half of qualified applications reach completion', unit: 'applications',
      annotations: [
        { id: 'loss', kind: 'diff', from: 'qualified', to: 'completed' },
        { id: 'count-loss', kind: 'delta', at: 'completed', vs: 'qualified' },
      ],
      source: 'Illustrative application stages',
    },
  },
  {
    id: 'annual-cohort-retention',
    title: 'The cohort retains 81% after two years, a 10% annual decline',
    kind: 'example', tags: ['demo', 'annotation', 'cagr'],
    data: {
      categories: [
        { id: 'start', label: 'Start FY21', date: '2021-12-31' },
        { id: 'year1', label: 'End FY22', date: '2022-12-31' },
        { id: 'year2', label: 'End FY23', date: '2023-12-31' },
      ],
      series: [{ id: 'retained', label: 'Retained customers', values: [1000, 900, 810] }],
    },
    options: {
      variant: 'centered', size: { width: 1000, height: 562 },
      title: 'The cohort loses 10% per year', unit: 'customers',
      annotations: [{ id: 'annual-loss', kind: 'cagr', from: 'start', to: 'year2' }],
      source: 'Illustrative cohort followed over two years',
    },
  },
);

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      { id: 'visitors', label: 'Visitors from paid and organic search campaigns' },
      { id: 'trial', label: 'Free trial started with a verified work e-mail' },
      { id: 'paid', label: 'Paid plan after the first invoice was settled' },
    ],
    series: [{ id: 'users', label: 'Users', values: [12500, 1900, 480] }],
  },
  options: {
    title: 'Long names read whole at a generous size',
    subtitle: { measure: 'Sign-up funnel', period: 'Jun 2026' },
    unit: 'users',
    source: 'Product analytics, June 2026',
    size: { width: 1440, height: 900 },
  },
});

/**
 * Funnel fills from the ramp: the outcome split of the lead
 * funnel under marks.funnelFill 'ramp', the lost share in badFill at 45 %.
 */
fixtures.push({
  ...fixtures.find((entry) => entry.id === 'lead-funnel')!,
  id: 'ramp-outcomes',
  title: 'Outcome funnel filled from the series ramp, the lost share in badFill at 45 %',
  tags: [],
  hover: undefined,
  options: {
    ...fixtures.find((entry) => entry.id === 'lead-funnel')!.options,
    theme: { preset: 'standard', overrides: { marks: { funnelFill: 'ramp' } } },
  },
});

// The shared options the appendix names for funnel.
const signup = fixtures.find((fixture) => fixture.id === 'signup-simple')!;
fixtures.push({
  ...signup,
  id: 'signup-options',
  title: 'The sign-up funnel with an authored format, a named palette, narrower bands and explicit label kinds',
  kind: 'example',
  tags: ['coverage'],
  options: {
    ...signup.options,
    format: '1,234',
    palette: 'atlantic',
    bandFraction: 0.5,
    labels: { category: true, total: true, point: true },
    strings: { source: 'Data' },
  },
});

registerFixtures('funnel', fixtures);
