import * as z from 'zod';
import { addCanvasBoundsIssues, baseOptionsSchema, idSchema, refusedBaseOptions } from '../../schema/shared';
import type { CreativeData, CreativeOptions } from './types';

const text = z.string().trim().min(1).describe('Nonempty authored text.');
const amount = z.number().finite().nonnegative().nullable().describe('Nonnegative observed amount; null means unavailable.');
const rate = z.number().finite().min(0).max(100).nullable().describe('Percentage points from 0 to 100; 1.5 means 1.5%, null means unavailable.');
const metric = (value: typeof amount | typeof rate) => z.strictObject({
  value: value.describe('Observed creative metric in the units named by its parent metric.'),
  accountMedian: value.describe('Authored account median for the comparison population, in the same units; null means unavailable.'),
}).describe('Observed creative metric alongside its authored account median.');
const mediaBase = {
  aspect: z.enum(['1:1', '4:5', '9:16']).describe('Authored media width-to-height ratio.'),
  alt: text.describe('Accessible description of the creative media.'),
};

export const creativeDataSchema: z.ZodType<CreativeData> = z.strictObject({
  id: idSchema.describe('Stable identifier for the creative.'),
  media: z.discriminatedUnion('kind', [
    z.strictObject({ ...mediaBase, kind: z.literal('placeholder').describe('Media has not been supplied.') }).describe('Media placeholder with an aspect ratio and description.'),
    z.strictObject({ ...mediaBase, kind: z.literal('image').describe('Authored image media.'), src: text.describe('Authored image source reference; this contract does not fetch media.') }).describe('Image source and accessible media metadata.'),
    z.strictObject({ ...mediaBase, kind: z.literal('video').describe('Authored video represented by its poster.'), poster: text.describe('Authored poster-image reference; this contract does not fetch or play video.') }).describe('Video poster and accessible media metadata.'),
  ]).describe('Embedded raster media or an explicit placeholder.'),
  facts: z.strictObject({
    name: text.describe('Creative name shown to the reader.'),
    format: text.describe('Authored format name, such as Video.'),
    currency: z.string().regex(/^[A-Z]{3}$/).describe('Three uppercase letters identifying the currency for spend and CPA.'),
    spendToDate: amount.describe('Cumulative spend through asOf in facts.currency; null means unavailable.'),
    launchDate: z.iso.date().describe('First reported runtime date in YYYY-MM-DD form.'),
    endDate: z.iso.date().nullable().describe('Final runtime date between launchDate and asOf; null means still live at asOf.'),
    asOf: z.iso.date().describe('Reporting cutoff date in YYYY-MM-DD form.'),
  }).describe('Creative identity, currency and reported runtime.'),
  comparison: z.strictObject({
    startDate: z.iso.date().describe('Comparison window start date in YYYY-MM-DD form.'),
    endDate: z.iso.date().describe('Comparison window end date, no earlier than startDate and no later than facts.asOf.'),
    population: text.describe('Authored definition of the creatives used for account medians.'),
  }).describe('Time window and population behind the authored account medians.'),
  definitions: text.optional().describe("The source's own definitions of its metrics, such as how hook rate and hold rate are measured; printed under the metric table as written."),
  metrics: z.strictObject({
    ctr: metric(rate).describe('Click-through rate in percentage points.'),
    cpa: metric(amount).describe('Cost per acquisition in facts.currency.'),
    roas: metric(amount).describe('Return on advertising spend as a multiple.'),
    hookRate: metric(rate).describe('Authored hook rate in percentage points; its measurement definition comes from the source.'),
    holdRate: metric(rate).describe('Authored hold rate in percentage points; its measurement definition comes from the source.'),
    frequency: metric(amount).describe('Average exposures per reached person.'),
  }).describe('Observed performance and account medians; no fatigue conclusion is inferred.'),
  fatigueRule: z.strictObject({
    metric: z.enum(['ctr', 'cpa']).describe('Daily metric used in both comparison windows.'),
    direction: z.enum(['higherIsBetter', 'lowerIsBetter']).describe('Authored favorable direction; a change against it is worsening.'),
    baseline: z.strictObject({ startDate: z.iso.date().describe('Inclusive baseline start.'), endDate: z.iso.date().describe('Inclusive baseline end.') }).describe('Earlier daily-mean window.'),
    current: z.strictObject({ startDate: z.iso.date().describe('Inclusive current start.'), endDate: z.iso.date().describe('Inclusive current end.') }).describe('Later daily-mean window, not overlapping baseline.'),
    minObservations: z.number().int().min(1).describe('Required nonmissing daily observations in EACH window.'),
    thresholdPct: z.number().finite().positive().describe('Minimum adverse percent change from the baseline daily mean that triggers the authored rule.'),
    missingData: z.enum(['unavailable', 'skip']).describe('Unavailable rejects nulls and missing calendar dates; skip excludes them, still requiring minObservations.'),
  }).optional().describe('Authored fatigue threshold: the card compares the daily means of two windows and marks a change past thresholdPct. It has no default.'),
  observations: z.array(z.strictObject({
    date: z.iso.date().describe('Observation date within the reported runtime, in YYYY-MM-DD form.'),
    spend: amount.describe('Daily spend in facts.currency; null means unavailable.'),
    cpa: amount.describe('Daily cost per acquisition in facts.currency; null means unavailable.'),
    ctr: rate.describe('Daily click-through rate in percentage points; null means unavailable.'),
  }).describe('One authored daily observation.')).describe('Daily observations in strictly ascending, unique date order.'),
}).superRefine((data, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const { launchDate, endDate, asOf } = data.facts;
  if (launchDate > asOf) issue(['facts', 'launchDate'], 'launchDate must not follow asOf');
  if (endDate !== null && (endDate < launchDate || endDate > asOf)) {
    issue(['facts', 'endDate'], 'endDate must lie between launchDate and asOf; null means live');
  }
  if (data.comparison.startDate > data.comparison.endDate || data.comparison.endDate > asOf) {
    issue(['comparison'], 'comparison dates must be ordered and end no later than asOf');
  }
  const rule = data.fatigueRule;
  if (rule) {
    for (const key of ['baseline', 'current'] as const) {
      const window = rule[key];
      if (window.startDate > window.endDate || window.startDate < launchDate || window.endDate > (endDate ?? asOf)) {
        issue(['fatigueRule', key], 'window must be ordered and within the reported runtime');
      }
    }
    if (rule.baseline.endDate >= rule.current.startDate) issue(['fatigueRule'], 'baseline must end before current starts');
  }
  data.observations.forEach((observation, index) => {
    if (observation.date < launchDate || observation.date > (endDate ?? asOf)) {
      issue(['observations', index, 'date'], 'observation must lie within the reported runtime');
    }
    if (index > 0 && observation.date <= data.observations[index - 1]!.date) {
      issue(['observations', index, 'date'], 'daily observations must be unique and ascending');
    }
  });
}).describe('Creative review card data (early alpha): observations and an optional authored fatigue threshold.');

export const creativeOptionsSchema: z.ZodType<CreativeOptions> = z.strictObject({
  ...refusedBaseOptions('creative'),
  target: baseOptionsSchema.shape.target, textScale: baseOptionsSchema.shape.textScale, textSize: baseOptionsSchema.shape.textSize,
  mode: baseOptionsSchema.shape.mode, interactive: baseOptionsSchema.shape.interactive, embed: baseOptionsSchema.shape.embed,
  palette: baseOptionsSchema.shape.palette, locale: baseOptionsSchema.shape.locale,
  title: baseOptionsSchema.shape.title, subtitle: baseOptionsSchema.shape.subtitle,
  source: baseOptionsSchema.shape.source, theme: baseOptionsSchema.shape.theme, size: baseOptionsSchema.shape.size,
  notes: baseOptionsSchema.shape.notes,
  footnotes: z.literal(false).optional().describe('false leaves the source line and the method lines (the account-median basis and the fatigue rule) off the card, for a host that shows them in its own frame; the texts stay in frame.source and frame.notes, and the fatigue status line stays on the card. No list of notes is taken.'),
}).superRefine(addCanvasBoundsIssues).describe('Creative exhibit metadata. Default canvas is 960 by 700 pixels.');
