import * as z from 'zod';
import { NormalizeError } from '../../normalize/shared';
import { normalizeMetricStack } from './metricStack';

const id = z.string().min(1);
const range = z.strictObject({
  from: id.describe('First category id, inclusive.'),
  to: id.describe('Last category id, inclusive.'),
  label: id.describe('Display label for this period or comparison window.'),
});
const fields = z.array(id.describe('Source measure id.')).min(1);
export const metricStackDataSchema = z.strictObject({
  categories: z.array(z.strictObject({
    id: id.describe('Unique category id in display order.'),
    label: id.describe('Category label drawn once below the last panel.'),
    partial: z.boolean().optional().describe('Period still running. Draw count so far provisionally; scoped outcomes are n/a.'),
  })).min(1).describe('One category axis shared by every metric-stack panel.'),
  measures: z.array(z.strictObject({
    id: id.describe('Unique source measure id.'),
    label: id.describe('Source measure label; also the stacked-column legend label.'),
    values: z.array(z.number().nonnegative().finite().nullable()).min(1).describe('Source counts, one per category. Null means unavailable.'),
  })).min(1).describe('Raw source counts stored once. Rates and readouts are computed from these counts.'),
  panels: z.array(z.strictObject({
    id: id.describe('Unique panel id; state scopes use this id.'),
    type: z.enum(['column', 'line']).describe('Columns, stacked columns for a multi-measure sum, or a line with points.'),
    title: id.describe('Measure name in the shared left readout gutter.'),
    unit: id.describe('Measure unit in the readout gutter.'),
    measure: z.union([
      z.strictObject({ sum: fields.describe('Measures added for each category. Columns stack the inputs in order.') }),
      z.strictObject({ numerator: fields.describe('Measures summed for the rate numerator.'), denominator: id.describe('Source measure for the rate denominator; the result is a percentage. The stack is a conversion chain, so a rate is always a share of a count; draw a cost per unit or another currency ratio as kpi cards or grid column or line panels.') }),
    ]).describe('Engine-computed panel measure.'),
    readout: z.union([z.literal('change'), z.strictObject({ base: id.describe('Base measure for the remaining-per-100 chain.') })]).describe('change compares grid windows; base computes a volume-weighted mature rate and remaining-per-100 span.'),
    emphasis: z.boolean().optional().describe('Use the theme accent. At most one panel may be emphasised.'),
    divisor: z.number().positive().optional().describe('Display divisor for sum marks and their change span, for example 1000. The headline percent is unitless.'),
    decimals: z.number().int().min(0).max(6).optional().describe('Decimal places of the marks and the change span. Default 0 for counts and 1 for rates.'),
  })).min(2).max(5).describe('Two to five panels in top-down reading order.'),
  states: z.strictObject({
    maturing: z.strictObject({
      from: id.describe('First maturing category, inclusive.'),
      to: id.describe('Last maturing category, inclusive.'),
      panels: fields.describe('Contiguous panel ids affected by maturing outcomes.'),
      label: id.optional().describe('Band caption, once. Default Not yet mature.'),
      footnote: id.optional().describe('Explanation printed once in the shared footnotes.'),
    }).optional().describe('Right-censored categories and their panel scope. One continuous band.'),
    partial: z.strictObject({
      panels: fields.describe('Panels with no available partial-period outcome; those cells display n/a.'),
      footnote: id.optional().describe('Shared partial-period note; default uses the category labels.'),
    }).optional().describe('Scope of unavailable outcomes in categories marked partial.'),
  }).optional().describe('Category states declared once, with explicit panel scopes.'),
  windows: z.strictObject({ grain: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional().describe('Average unit. Omitted: infer month from YYYY-MM, week from W01 or YYYY-W01, quarter from Q1 or YYYY-Q1, year from YYYY; otherwise category. All category ids must match. Week and quarter letters are case-insensitive.'), base: range.describe('Base comparison window.'), compare: range.describe('Comparison window.') }).optional().describe('Mature comparison windows for change readouts.'),
  periods: z.array(range).min(1).optional().describe('Optional period row, covering every category once in order. Comparison windows are bold; without windows, mature periods are bold.'),
}).superRefine((data, ctx) => {
  if (ctx.issues.length) return;
  try { normalizeMetricStack(data); }
  catch (error) {
    if (!(error instanceof NormalizeError)) throw error;
    ctx.addIssue({ code: 'custom', path: error.segments?.slice(1), message: error.message });
  }
}).describe('Metric stack: shared categories and source measures, top-down panels with computed readouts. Use options.stack.');

export const metricStackOptionsSchema = z.strictObject({
  heights: z.array(z.number().positive()).min(2).max(5).optional().describe('Plot heights in layout pixels, one per panel in top-down order. Use rows for proportional heights instead.'),
}).describe('Select metric-stack mode of sharedAxis category. Top-down panels, independent zero scales, one axis, one gutter and shared states.');
