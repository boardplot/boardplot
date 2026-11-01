/** Likert data and options schemas, without the chart engine. */

import * as z from 'zod';
import { addDuplicateIdIssues, baseOptionsSchema, idSchema, refusedBaseOptions } from '../../schema/shared';
import type { LikertData, LikertOptions } from './layout';

// `.strict()` everywhere on this data path, deliberately. Elsewhere in the
// repo an unknown key on `data` is silently accepted (`data.items[].colour`
// passes with zero warnings). Here a
// dropped `dontKnow`, `na` or `neutral` key would silently leave responses out
// of the DENOMINATOR, and every printed share would be a share of a population
// the author did not intend. "Don't know" belongs on the scale, which forces
// the author to decide which side it sits on; the engine must never decide it.
const scaleOptionSchema = z
  .object({
    id: idSchema.describe("Response-option identity used by keyed statement values."),
    label: z.string().optional().describe("Displayed response-option name; defaults to its id."),
    role: z
      .literal('neutral')
      .optional()
      .describe(
        'The midpoint of an ODD scale. Exactly one option carries it, in the middle position; an even scale must not carry it at all.',
      ),
  })
  .strict();

const responseSchema = z
  .object({
    optionId: idSchema.describe("Declared scale-option id receiving this response value."),
    value: z.union([z.number().finite(), z.null()]).describe("Count or percentage according to options.values; null is refused during layout because a missing response category cannot be treated as zero."),
  })
  .strict();

const itemSchema = z
  .object({
    id: idSchema.describe("Unique survey-statement identity."),
    label: z.string().optional().describe("Displayed survey statement; defaults to its id."),
    date: z.string().optional().describe("ISO observation date for dated survey-wave comparisons; statement order does not supply a period."),
    values: z
      .union([
        z.array(z.union([z.number().finite(), z.null()])).min(1),
        z.array(responseSchema).min(1),
      ])
      .describe(
        'Counts or percentages per DECLARED scale option, positional or keyed. Which of the two is declared by options.values and is never inferred.',
      ),
    n: z
      .number()
      .finite()
      .optional()
      .describe('Responses the row was computed over. Required for percent input to be auditable.'),
  })
  .strict();

export const likertDataSchema = z
  .object({
    scale: z
      .array(scaleOptionSchema)
      .min(1)
      .describe(
        'Response options ordered most-negative to most-positive. Fewer than three is refused AT LAYOUT with likert-scale-too-short, so the author gets the domain reason rather than a schema arity message.',
      ),
    items: z.array(itemSchema).min(1).describe("Survey statements and their response distributions, displayed in input order unless sorting is requested."),
  })
  .strict()
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.scale, ['scale'], {
      name: 'scale option',
      keys: 'response positions and derived shares',
    });
    addDuplicateIdIssues(ctx, data.items, ['items'], {
      name: 'item',
      keys: 'response distributions and scene identities',
    });
    data.items.forEach((item, itemIndex) => {
      const responses = item.values.flatMap((value, valueIndex) =>
        typeof value === 'object' && value !== null && 'optionId' in value
          ? [{ id: value.optionId, issuePath: [itemIndex, 'values', valueIndex, 'optionId'] }]
          : [],
      );
      addDuplicateIdIssues(ctx, responses, ['items'], {
        name: 'response',
        keys: `one scale option in item '${item.id}'`,
      });
    });
  }) as unknown as z.ZodType<LikertData>;

export const likertOptionsSchema = baseOptionsSchema
  .safeExtend(refusedBaseOptions('likert'))
  .safeExtend({
    // Refused with z.never rather than omitted: a zod object strips unknown
    // keys, so an omitted key parses away silently and leaves the published
    // schema.
    sort: z
      .never({
        error:
          "'sort' is not accepted on a likert: the response scale is an ORDERED axis (strongly disagree … strongly agree) and reordering it destroys the diverging baseline the chart is read from — order the questions in the data instead",
      })
      .optional()
      .describe('Refused: the response scale is an ordered axis, not a rankable list.'),
    topN: z
      .never({
        error:
          "'topN' is not accepted on a likert: dropping response categories into a rest bucket breaks the base every share is computed against — use 'neutral: \"exclude\"' to drop the midpoint (which warns that the bars no longer sum to the base)",
      })
      .optional()
      .describe('Refused: a rest bucket would break the base the shares are computed against.'),
    values: z
      .enum(['counts', 'percent'])
      .describe(
        'REQUIRED. A 5-point row of counts 20/20/20/20/20 also sums to 100, so counts-vs-percent cannot be sniffed from the data.',
      ),
    neutral: z
      .enum(['split', 'positive', 'negative', 'exclude'])
      .optional()
      .describe(
        "Where the midpoint's share goes. Default 'split' (half each side, the published convention for diverging Likert charts); 'exclude' drops it and warns that the bars no longer sum to the base.",
      ),
    summary: z
      .enum(['net', 'none'])
      .optional()
      .describe(
        "Net column (% agree − % disagree). Default 'net'; refused with neutral 'positive'/'negative', where the signed stack sum is not the net score.",
      ),
    base: z
      .enum(['column', 'none'])
      .optional()
      .describe(
        "The base n of each statement as a right-aligned grey column right of the net, under the head 'n'. Default 'column' when the counts or an item's n give a base; percent input without n has none. One base shared by every statement prints once in the head ('n = 900'). The column stays off below 576 px canvas width.",
      ),
    sortBy: z
      .enum(['sheet', 'net'])
      .optional()
      .describe("Statement order. Default 'sheet'; 'net' sorts descending with ties broken by input order."),
    methodNote: z
      .boolean()
      .optional()
      .describe(
        'Default false. true adds the method footnotes: the forced-choice centre line, the definition of the net column and the sort order. The neutral treatment and the base of the shares are required for interpretation and print regardless, unless requiredNotes turns them off.',
      ),
    requiredNotes: z
      .object({
        neutral: z.boolean().optional().describe("Default true. false drops the note on the neutral treatment; set it when the title or subtitle already states it ('Neutral split across the centre line')."),
        base: z.boolean().optional().describe("Default true. false drops the note on the base of the shares; set it when the source or a footnote already states it ('n = 882 per statement')."),
      })
      .strict()
      .optional()
      .describe('The two notes a reader needs to read the shares print by default. Turn one off only when the exhibit\'s own text already says it.'),
  }).describe('Statement names and ordinary legend keys use label size. Automatic keys retain footnote size; compact framing retains source, sample bases and required methodology.') as unknown as z.ZodType<LikertOptions>;
