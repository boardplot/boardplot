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
