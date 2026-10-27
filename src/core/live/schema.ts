import * as z from 'zod';

/**
 * Published schema for the live window options. The line layout reads them
 * for line and area charts.
 */
export const liveWindowOptionsSchema = z
  .strictObject({
    last: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Keep the last n categories of the ordered series.'),
    decimate: z
      .enum(['minmax', 'none'])
      .optional()
      .describe("Display decimation; 'minmax' keeps each series' original min and max category in a bucket and never synthesizes values; 'none' draws every point. Omitted, a plain line or area (stacked too) with more than 2,000 evenly spaced categories and four per pixel of width samples by 'minmax' at two buckets per pixel."),
    maxPoints: z
      .number()
      .int()
      .min(4)
      .optional()
      .describe("Intended category budget for decimation 'minmax'; at least 4. Window ends always survive. Each series keeps its own original extrema, so the displayed document can exceed this budget."),
  })
  .describe('Live display window and opt-in display decimation for ordered time-series data.');

/**
 * The window on a banded chart (column, combo): the last n periods. Each
 * period draws in its own band, so min-max decimation, which drops periods
 * and closes the bands up, is refused there.
 */
const DECIMATION_REFUSED = "a column or combo draws every period in its own band, so decimation would drop columns and close up the bands between the rest; keep window.last, or narrow the periods with viewDomain";
export const bandWindowOptionsSchema = z
  .strictObject({
    last: liveWindowOptionsSchema.shape.last,
    decimate: z.never({ error: DECIMATION_REFUSED }).optional().describe('Refused on banded charts: decimation would drop columns.'),
    maxPoints: z.never({ error: DECIMATION_REFUSED }).optional().describe('Refused on banded charts, with decimate.'),
  })
  .describe("Display window for ordered periods: keep the last n categories. Means, the average marker and anomaly rules keep every source period, the subtitle says how many periods show, and a mean's Ø label names the periods it covers, 'Ø 40.4 (Jan 25–Dec 26)'.");
