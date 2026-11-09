import { STRUCTURE_COUNT_KINDS } from '../structureCounts';

/** Shared by full describe and the render response schema. */
export const readingCountsSchema = {
  type: 'array',
  description: 'Structural counts from the layout. text is the exact phrase in the accessible description. Empty when the description has no count phrase.',
  items: {
    type: 'object',
    required: ['what', 'n', 'text'],
    additionalProperties: false,
    properties: {
      what: { type: 'string', enum: STRUCTURE_COUNT_KINDS },
      n: { type: 'integer', minimum: 0 },
      text: { type: 'string' },
    },
  },
} as const;

/** Grid-only readout details. All operands come from the accepted geometry. */
export const readingMetricStackSchema = {
  type: 'object',
  description: 'Metric stacks only: readouts with method, grain, category windows, rounded headline and span values, and claims carrying source and intermediate operands.',
  properties: { readouts: { type: 'array', items: { type: 'object', required: ['panelId', 'method', 'grain'], properties: {
    panelId: { type: 'string' }, method: { type: 'string', enum: ['average-change', 'rounded-rate-change', 'weighted-rate'] },
    grain: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year', 'category'], description: 'Category grain from windows.grain or explicit category ids; category when neither identifies a time grain.' },
    categoryIds: { type: 'object' }, headline: { type: ['number', 'null'] }, before: { type: ['number', 'null'] }, after: { type: ['number', 'null'] },
    headlineText: { type: 'string' }, spanText: { type: 'string' }, claims: { type: 'array', items: { type: 'object' }, description: 'Each claim has op, inputs (ref, value), and output (raw, state, displayed).' },
  } } } },
} as const;

/** The reading beside a rendered chart, also exposed by full describe. */
export const readingSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Chart identity and output file name.' },
    type: { type: 'string', description: 'Canonical chart type.' },
    title: { type: ['string', 'null'], description: 'Authored title, or null when absent or hidden.' },
    size: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, description: 'Drawn size in layout pixels.' },
    mode: { type: 'string', enum: ['full', 'compact'] },
    titleLines: { type: 'integer', description: 'Number of drawn title lines, zero without a title.' },
    series: { type: 'array', items: { type: 'string' }, description: 'Series labels in record order.' },
    counts: readingCountsSchema,
    labelsPlaced: { type: 'integer', description: 'Number of labels drawn.' },
    labelsTruncated: {
      type: 'array', description: 'Labels whose displayed text is shorter than the authored text.',
      items: { type: 'object', properties: { labelId: { type: 'string' }, text: { type: 'string' }, displayed: { type: 'string' } } },
    },
    labelsDropped: { type: 'integer', description: 'Number of labels omitted by layout. Inspect omissions for their meaning and destination.' },
    labelsDroppedBy: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Dropped-label counts by reason. Redundant labels repeat information already shown.' },
    omissions: {
      type: 'array', description: 'Hidden text and values, with the reason and any alternate destination.',
      items: { type: 'object', properties: { labelId: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' }, destination: { type: 'string' } } },
    },
    derived: {
      type: 'array', description: 'Computed values with operation, state, displayed text and visibility. Missing or withheld values have value null.',
      items: { type: 'object', properties: {
        claimId: { type: 'string' }, op: { type: 'string' }, operation: { type: 'string' }, value: { type: ['number', 'null'] },
        state: { type: 'string' }, displayed: { type: 'string' }, visible: { type: 'boolean' }, drawn: { type: 'boolean' },
        noteLocation: { type: 'string' }, inputs: { type: 'array', items: { type: 'object' } },
      } },
    },
    claims: { type: 'object', description: 'Counts of derived, observed and authored claims, with states and a text summary.' },
    values: { type: 'object', description: 'Value counts by state and kind, including suppressed and unavailable values, with a text summary.' },
    metricStack: readingMetricStackSchema,
    data: { type: 'object', description: 'With rows or rowsFile: row count, source, unused columns, suppressed cells and SHA-256 of file bytes or canonical inline JSON.' },
    notes: {
      type: 'array', description: 'Notes in display order. inFrame says whether the chart prints the note. short is the one-line form for a method note or credit.',
      items: { type: 'object', properties: {
        n: { type: 'number' }, kind: { type: 'string', enum: ['source', 'credit', 'note', 'method', 'disclosure'] },
        text: { type: 'string' }, short: { type: 'string' }, ref: { type: 'number' }, inFrame: { type: 'boolean' },
        links: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, href: { type: 'string' } } } },
      } },
    },
    rounding: { type: 'array', items: { type: 'object' }, description: 'For sum-consistent Mekko or pie shares: each adjusted share with whole, part, nearest rounding and printed value.' },
  },
} as const;
