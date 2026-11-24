import * as z from 'zod';
import { NormalizeError } from '../../normalize/shared';
import { columnOrderOption, columnOverridesOption, columnVisibilityOption } from '../../schema/generatedColumnOptions';
import { categoryDateSchema } from '../../schema/shared';
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
    label: z.string().optional().describe('Category name below the last panel. Omit it to show the id. An empty string hides the axis name and uses the id in the hover card, reading and notes.'),
    date: categoryDateSchema.optional().describe('ISO 8601 category date, yyyy-mm-dd, kept as metadata on the metric stack.'),
    partial: z.boolean().optional().describe('Period still running. Draw count so far provisionally; scoped outcomes are n/a.'),
  })).min(1).describe('One category axis shared by every metric-stack panel.'),
  measures: z.array(z.strictObject({
    id: id.describe('Unique source measure id.'),
    label: id.describe('Source measure label; also the stacked-column legend label.'),
    values: z.array(z.number().nonnegative().finite().nullable()).min(1).describe('Source values, one per category: counts, or amounts such as spend. Null means unavailable.'),
  })).min(1).describe('Raw source values stored once. Rates, amounts per unit and readouts are computed from these values.'),
  panels: z.array(z.strictObject({
    id: id.describe('Unique panel id; state scopes use this id.'),
    type: z.enum(['column', 'line']).describe('Columns, stacked columns for a multi-measure sum, or a line with points.'),
    title: id.describe('Measure name in the shared readout gutter. The hover card names each value with it when the unit is a sign or code.'),
    unit: id.describe("Measure unit in the readout gutter. A unit in words names each value on the hover card ('Cases per month: 800'); a sign or code such as '$' or 'EUR k' stays on the number."),
    measure: z.union([
      z.strictObject({ sum: fields.describe('Measures added for each category. Columns stack the inputs in order.') }),
      z.strictObject({ numerator: fields.describe('Measures summed for the rate numerator.'), denominator: id.describe('Source measure for the rate denominator; the result is a percentage, a share of a count. For an amount per unit, such as cost per order, use ratio and per.') }),
      z.strictObject({ ratio: fields.describe('Measures added for the amount, such as spend.'), per: id.describe("Source measure of the units, such as orders. Each category's value is the sum of ratio divided by per, with no factor 100; it is n/a when an input is null or per is 0. A window divides the sum of ratio over its categories by the sum of per, never the mean of the category values: spend 100 and 300 on 10 and 20 orders is 13.33 per order. The change readout is the percent change of the two window values. One mark per category.") }),
    ]).describe('Engine-computed panel measure: a sum, a rate in percent, or an amount per unit.'),
    readout: z.union([z.literal('change'), z.strictObject({ base: id.describe('Base measure for the remaining-per-100 chain.') })]).describe('change compares grid windows; base computes a volume-weighted mature rate and remaining-per-100 span, for rate panels only.'),
    emphasis: z.boolean().optional().describe('Use the theme accent. At most one panel may be emphasised.'),
    divisor: z.number().positive().optional().describe('Display divisor for sum or per-unit marks and their change span, for example 1000. The headline percent is unitless.'),
    decimals: z.number().int().min(0).max(6).optional().describe('Decimal places of the marks and the change span. A panel with divisor and without decimals prints 0 for sums and amounts per unit and 1 for rates; a panel with neither prints by the default number rule.'),
    keyTitle: id.optional().describe("Caption over the key of a stacked panel, such as 'By plan', in muted small text. A panel without a key prints none."),
    segmentShares: z.boolean().optional().describe("true prints each segment's share of its column, in whole percent that add up to 100, inside the segment of the base and the focus columns of a stacked panel. It applies under options.stack.variant 'focus'; the focus column prints the shares of the key. A share that has no room in its segment is left out; the key still carries it. Without the focus look, or on a panel that stacks no measures, it does nothing and warns option-ignored. Absent: no segment labels."),
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
  variant: z.enum(['focus']).optional().describe("'focus': the value-first look. The compare window is the focus: each panel prints its focus value first, in the theme role type.display, then the change and the base value ('+86% from $272'), and a stacked panel keys each measure with its share of the focus value. The focus categories take the accent, the base window a dark neutral and the other categories a light neutral; a dashed line marks the base level in each panel. In React, hover and keyboard focus move the focus to one category. Needs data.windows and readout 'change' in every panel; a stack with readout { base } panels ignores it and warns option-ignored. Absent: today's look."),
  heights: z.array(z.number().positive()).min(2).max(5).optional().describe('Plot heights in layout pixels, one per panel in top-down order. Use rows for proportional heights instead.'),
  columnVisibility: columnVisibilityOption('grid').describe('False leaves a seat of the one gutter track out, with its height: unit, headline or span. The panel name stays. Hiding headline and span also drops the method line. The values stay in the marks.'),
  columnOverrides: columnOverridesOption('grid', ['width', 'align']),
  columnOrder: columnOrderOption('grid'),
}).describe('Select metric-stack mode of sharedAxis category. Top-down panels, independent zero scales, one axis, one gutter and shared states.');
