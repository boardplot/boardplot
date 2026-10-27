/** Likert fixtures. Three examples, one torture case. */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { LikertData, LikertOptions } from './layout';

const FIVE_POINT = [
  { id: 'sd', label: 'Strongly disagree' },
  { id: 'd', label: 'Disagree' },
  { id: 'n', label: 'Neither agree nor disagree', role: 'neutral' as const },
  { id: 'a', label: 'Agree' },
  { id: 'sa', label: 'Strongly agree' },
];

const SEVEN_POINT = [
  { id: 'vhigh', label: 'Very high effort' },
  { id: 'high', label: 'High effort' },
  { id: 'shigh', label: 'Somewhat high effort' },
  { id: 'mid', label: 'Neither high nor low', role: 'neutral' as const },
  { id: 'slow', label: 'Somewhat low effort' },
  { id: 'low', label: 'Low effort' },
  { id: 'vlow', label: 'Very low effort' },
];

/**
 * These fixtures render at the DEFAULT size on purpose — a Likert is read at
 * whatever size the deck gives it, and the default-configuration render is the
 * one that has to be honest. Every share is still on the exhibit: the a11y
 * description names all four side totals and the net for every statement, and
 * the omissions are the thin end of thin segments.
 */
export const fixtures: Fixture<LikertData, LikertOptions>[] = [
  {
    id: 'employee-engagement-5pt',
    // The nets are
    // +75.56 +48.89 +46.67 +15.56 −1.11 −28.89 −41.11 — three are negative,
    // and the borderline row, 'I can grow my career here' at −1, is the one a
    // reader's eye goes to first. This string is the
    // agent-facing surface (`boardplot describe likert --json` → fixtures[].title,
    // and the catalog card), i.e. exactly what gets copied into a deck
    // caption.
    title: 'Three of seven statements are net-negative; the centre line is the midpoint of the neutral segment',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'purpose', seriesId: 'likert:n:neg' } },
    data: {
      scale: FIVE_POINT,
      items: [
        { id: 'purpose', label: 'I understand how my work supports our strategy', values: [20, 40, 100, 410, 330] },
        { id: 'manager', label: 'My manager gives me useful feedback', values: [50, 110, 140, 380, 220] },
        { id: 'tools', label: 'I have the tools I need to do my job well', values: [90, 230, 120, 330, 130] },
        { id: 'workload', label: 'My workload is sustainable', values: [190, 310, 160, 220, 20] },
        { id: 'growth', label: 'I can grow my career here', values: [130, 220, 210, 280, 60] },
        { id: 'speed', label: 'Decisions here are made quickly enough', values: [250, 320, 130, 170, 30] },
        { id: 'recommend', label: 'I would recommend this company as a place to work', values: [60, 100, 160, 370, 210] },
      ],
    },
    options: {
      // At slide width the two longest statement names do not fit the left
      // column, and a survey item without its name is a lost label. The a4
      // page places every name and every segment value.
      size: 'a4',
      values: 'counts',
      neutral: 'split',
      summary: 'net',
      sortBy: 'net',
      // A share too narrow for its segment is listed under the chart, so every value prints.
      labelDensity: 'full',
      notes: { show: ['note', 'disclosure'] },
      title: 'Engagement survey — agreement by statement',
      subtitle: {
        measure: 'Share of responses',
        period: 'FY25 pulse',
        // The convention is on the exhibit, not only in the a11y text: the
        // centre line is NOT the agree/disagree boundary under a split neutral.
        scenarios: ['Neutral split across the centre line'],
      },
      legend: 'bottom',
      source: 'Employee pulse survey, n = 900 per statement',
      // The subtitle states the split and the source the base, so neither prints twice.
      requiredNotes: { neutral: false, base: false },
    },
  },
  {
    id: 'manager-review-4pt',
    title: 'Forced-choice four-point scale: the centre line IS the boundary, and no neutral is declared',
    kind: 'example',
    data: {
      scale: [
        { id: 'never', label: 'Never' },
        { id: 'rarely', label: 'Rarely' },
        { id: 'often', label: 'Often' },
        { id: 'always', label: 'Always' },
      ],
      items: [
        { id: 'clarity', label: 'Sets clear expectations', values: [11, 34, 96, 63] },
        { id: 'feedback', label: 'Gives feedback in time to act on it', values: [24, 58, 82, 40] },
        { id: 'blockers', label: 'Removes blockers I raise', values: [18, 41, 87, 58] },
        { id: 'credit', label: 'Gives credit where it is due', values: [9, 22, 74, 99] },
        { id: 'development', label: 'Makes time for my development', values: [37, 66, 71, 30] },
      ],
    },
    options: {
      values: 'counts',
      summary: 'net',
      sortBy: 'net',
      // The one fixture that shows the likert method notes; it prints the disclosures too.
      methodNote: true,
      // A share too narrow for its segment is listed under the chart, so every value prints.
      labelDensity: 'full',
      title: 'Manager behaviours — forced-choice scale',
      subtitle: { measure: 'Share of responses', period: 'FY25 review cycle' },
      legend: 'bottom',
      source: 'Upward feedback, n = 204 per behaviour',
    },
  },
  {
    id: 'customer-effort-7pt',
    title: 'Seven-point effort scale with the neutral excluded — the bars no longer sum to the base, and say so',
    kind: 'example',
    data: {
      scale: SEVEN_POINT,
      items: [
        { id: 'signup', label: 'Opening an account', values: [12, 28, 54, 96, 148, 212, 164] },
        { id: 'billing', label: 'Changing a billing plan', values: [64, 118, 156, 132, 118, 90, 36] },
        { id: 'support', label: 'Getting an answer from support', values: [96, 174, 168, 104, 92, 58, 22] },
        { id: 'cancel', label: 'Cancelling a subscription', values: [148, 196, 142, 88, 68, 44, 28] },
        { id: 'renewal', label: 'Renewing at the end of a term', values: [22, 46, 82, 118, 172, 186, 88] },
      ],
    },
    options: {
      // a4 for the same reason as the engagement fixture above: zero hidden
      // labels.
      size: 'a4',
      values: 'counts',
      neutral: 'exclude',
      summary: 'net',
      sortBy: 'net',
      // A share too narrow for its segment is listed under the chart, so every value prints.
      labelDensity: 'full',
      notes: { show: ['note', 'disclosure'] },
      title: 'Customer effort by journey step',
      subtitle: {
        measure: 'Share of responses',
        period: 'Q3',
        scenarios: ['Neutral excluded — bars do not sum to the base'],
      },
      legend: 'bottom',
      source: 'Post-interaction survey',
    },
  },
  {
    id: 'torture-likert-degenerate',
    title: 'Degenerate rows: a base of 7, a single-option row, a 99.6 percent row, a 40% neutral, and bases 7 to 1,204',
    kind: 'torture',
    data: {
      scale: FIVE_POINT,
      items: [
        {
          id: 'unanimous',
          label:
            'Every respondent picked the same option, so this statement carries no distribution to read at all — an extremely long statement label that has to survive the category band',
          values: [0, 0, 0, 0, 100],
          n: 1204,
        },
        {
          id: 'tiny',
          label:
            'Seven people answered this statement, which makes each of them worth more than fourteen percentage points',
          values: [14.3, 14.3, 14.3, 28.6, 28.6],
          n: 7,
        },
        {
          id: 'drifting',
          label:
            'The authored percentages sum to 99.6, which is inside the rounding tolerance and is disclosed rather than silently rescaled',
          values: [10.2, 19.9, 30.1, 25.2, 14.2],
          n: 310,
        },
        {
          id: 'undecided',
          label: 'Two in five respondents sat exactly on the fence, and half of that block falls on each side of the centre line',
          values: [10, 15, 40, 25, 10],
          n: 95,
        },
      ],
    },
    options: {
      values: 'percent',
      neutral: 'split',
      summary: 'net',
      title: 'Torture: degenerate Likert rows',
      subtitle: {
        measure: 'Share of responses',
        period: 'Synthetic',
        scenarios: ['Neutral split across the centre line'],
      },
      legend: 'bottom',
      source: 'Synthetic torture data',
    },
  },
];

fixtures.push({
  ...fixtures[0]!,
  kind: 'torture', id: 'employee-engagement-compact',
  title: 'Employee engagement in compact framing with sample bases and neutral-share disclosures',
  // Compact is a smaller frame, not only a smaller type size; the
  // Net definition, the method lines and the source stay on it.
  options: { ...fixtures[0]!.options!, mode: 'compact', size: { width: 640, height: 647 } },
  // The band fit seats every value here; the 5pt fixture's hidden segment is redundant at this size.
});

for (const neutral of ['positive', 'negative'] as const) {
  fixtures.push({
    id: `service-survey-neutral-${neutral}`,
    title: `Service survey with neutral responses on the ${neutral} side`,
    kind: 'example',
    data: {
      scale: FIVE_POINT,
      items: [
        { id: 'speed', label: 'Fast response', n: 100, values: [10, 15, 20, 30, 25] },
        { id: 'clarity', label: 'Clear advice', n: 100, values: [5, 10, 15, 40, 30] },
      ],
    },
    options: {
      values: 'percent', neutral, summary: 'none', sortBy: 'sheet',
      title: 'Service survey responses',
      subtitle: { measure: 'Share of responses', scenarios: [`Neutral responses placed on the ${neutral} side`] },
      unit: '%', legend: 'bottom',
      source: 'Illustrative service survey, n = 100 per statement',
    },
  });
}

fixtures.push({
  id: 'dated-survey-comparison',
  title: 'Agree share grows 20% annually, while Disagree falls 10 percentage points',
  kind: 'example',
  data: {
    scale: FIVE_POINT,
    items: [
      { id: 'before', label: 'FY21', date: '2021-12-31', values: [100, 100, 100, 100, 100] },
      { id: 'after', label: 'FY23', date: '2023-12-31', values: [50, 50, 150, 144, 106] },
    ],
  },
  options: {
    values: 'counts', neutral: 'split', summary: 'net', format: '0%',
    size: { width: 1000, height: 500 },
    title: 'The Agree response grows 20% a year',
    subtitle: { measure: 'Share of survey responses', period: 'FY21 to FY23' },
    unit: '%', legend: 'bottom', source: 'Illustrative survey waves, 500 responses each',
    annotations: [
      { id: 'growth', kind: 'cagr', from: { categoryId: 'before', seriesId: 'a' }, to: { categoryId: 'after', seriesId: 'a' } },
      { id: 'gap', kind: 'diff', mode: 'absolute', from: { categoryId: 'before', seriesId: 'd' }, to: { categoryId: 'after', seriesId: 'd' } },
    ],
  },
});

// Long names at a generous size read whole. The rendered SVG has no
// ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    scale: [
      { id: 'never', label: 'Never' },
      { id: 'rarely', label: 'Rarely' },
      { id: 'often', label: 'Often' },
      { id: 'always', label: 'Always' },
    ],
    items: [
      {
        id: 'clarity',
        label: 'Sets clear expectations, even when the quarter is busy and the team is short-staffed',
        values: [11, 34, 96, 63],
      },
      {
        id: 'feedback',
        label: 'Gives feedback in time to act on it, even when the quarter is busy and the team is short-staffed',
        values: [24, 58, 82, 40],
      },
      {
        id: 'blockers',
        label: 'Removes blockers I raise, even when the quarter is busy and the team is short-staffed',
        values: [18, 41, 87, 58],
      },
      {
        id: 'credit',
        label: 'Gives credit where it is due, even when the quarter is busy and the team is short-staffed',
        values: [9, 22, 74, 99],
      },
      {
        id: 'development',
        label: 'Makes time for my development, even when the quarter is busy and the team is short-staffed',
        values: [37, 66, 71, 30],
      },
    ],
  },
  options: {
    values: 'counts',
    summary: 'net',
    sortBy: 'net',
    title: 'Long names read whole at a generous size',
    subtitle: { measure: 'Share of responses', period: 'FY25 review cycle' },
    legend: 'bottom',
    source: 'Upward feedback, n = 204 per behaviour',
    size: { width: 1440, height: 900 },
  },
});

// The shared options likert supports: left row labels, bar thickness, a highlight, explicit label kinds.
const engagement = fixtures.find((fixture) => fixture.id === 'employee-engagement-5pt')!;
fixtures.push({
  ...engagement,
  id: 'engagement-options',
  title: 'The engagement survey with left row labels, thicker bars, one highlighted statement and explicit label kinds',
  tags: ['coverage'],
  options: {
    ...engagement.options!,
    // No named palette: a repainted likert keeps the light theme's steps.
    rowLabels: { align: 'left' },
    bandFraction: 0.8,
    highlight: 'tools',
    labels: { category: true, segment: true },
  },
});

// Footer rule: the author's note and the engine's
// one-line method notes in the frame, the long method texts and the
// disclosure in the notes list behind "+N notes".
fixtures.push({
  ...engagement,
  kind: 'torture', id: 'engagement-notes-pinned',
  title: 'The engagement survey with its net and base pinned as one-line method notes under the author note',
  tags: ['coverage'],
  options: {
    ...engagement.options!,
    footnotes: ['Pulse survey of all permanent staff, invented data.'],
    notes: { placement: 'frame', show: ['note', 'method'], maxLines: 5 },
  },
});
// A dashboard export draws 'info' as the report rule; React draws one line and the
// "Notes and sources" button. A share too narrow to print has no prose list.
fixtures.push({
  ...engagement,
  kind: 'torture', id: 'engagement-dashboard-notes',
  title: 'The engagement survey on a dashboard with its notes in the info panel',
  tags: ['coverage'],
  options: {
    ...engagement.options!,
    target: 'dashboard',
    size: { width: 960 },
    notes: { placement: 'info' },
  },
});

registerFixtures('likert', fixtures);
