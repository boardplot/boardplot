/** Pyramid data and options schemas, without the chart engine. */

import * as z from 'zod';
import {
  colorRoleField,
  addDuplicateIdIssues,
  baseOptionsSchema,
  idSchema,
  refusedBaseOptions,
} from '../../schema/shared';
import { REFUSED_OPTIONS } from './refusals';
import type { PyramidData, PyramidOptions } from './types';

const valueSchema = z.union([z.number(), z.null()]);

// `.strict()` on both data objects is the whole point. Elsewhere in the repo
// an unknown key on `data` is silently accepted (`data.items[].colour` passes
// with zero warnings). A silently dropped
// `to` or `from` here would defeat the band validation this type exists for:
// the author would believe they declared a five-year grid and the engine would
// draw an open band with no complaint.
const bandSchema = z
  .object({
    id: idSchema.describe("Unique ordered-band identity used by keyed group values."),
    from: z.number().describe('Inclusive lower bound.'),
    to: z
      .number()
      .optional()
      .describe(
        'EXCLUSIVE upper bound; contiguity is bands[i].to === bands[i+1].from. Omit on the LAST band only, to declare it open-ended.',
      ),
    label: z.string().optional().describe("Authored band caption; omission derives a caption from its bounds."),
  })
  .strict();

// The value union is `number | null` and nothing else, matching PyramidGroup
// exactly. Widening it to `cellSchema` (so that an authored `{ pct }` reaches
// the layout and is refused with 'pyramid-percent-input' rather than a generic
// zod 'invalid-data') would make the runtime accept seven cell-meta keys the
// declared type does not mention, which the type-runtime drift check refuses:
// declarations follow the runtime, and a runtime that accepts more than it
// declares is the defect, not the declaration. Precedent: pareto.
const groupSchema = z
  .object({
    id: idSchema.describe("Group identity for one side of the population pyramid."),
    label: z.string().optional().describe("Displayed group name; defaults to its id."),
    date: z.string().optional().describe("ISO observation date for dated group comparisons. CAGR needs a positive date interval; age-band bounds do not supply time."),
    values: z
      .union([
        z.array(valueSchema),
        z.array(z.object({ bandId: idSchema.describe("Band id identifying this group value independently of array position."), value: valueSchema.describe("Raw count or amount for the band; percentages are derived. Null is refused during layout.") }).strict()),
      ])
      .describe(
        'Counts or amounts, one per band. Shares are DERIVED: a percent cell, a null, a negative or a non-finite value is refused with its own error code.',
      ),
    colorRole: colorRoleField("Theme color role for this group of pyramid bars."),
  })
  .strict();

export const pyramidDataSchema = z
  .object({
    bands: z.array(bandSchema).min(1).describe("Contiguous ordered bands, each with inclusive lower and exclusive upper bounds; only the last may be open-ended."),
    groups: z.array(groupSchema).length(2).describe("Exactly two groups displayed on opposite sides using the same scale."),
  })
  .strict()
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.bands, ['bands'], {
      name: 'band',
      keys: 'ordered positions, values and scene identities',
    });
    addDuplicateIdIssues(ctx, data.groups, ['groups'], {
      name: 'group',
      keys: 'mirrored values, legends and scene identities',
    });
    data.groups.forEach((group, groupIndex) => {
      const values = group.values.flatMap((value, valueIndex) =>
        typeof value === 'object' && value !== null && 'bandId' in value
          ? [{ id: value.bandId, issuePath: [groupIndex, 'values', valueIndex, 'bandId'] }]
          : [],
      );
      addDuplicateIdIssues(ctx, values, ['groups'], {
        name: 'band value',
        keys: `one band in group '${group.id}'`,
      });
    });
  }) as unknown as z.ZodType<PyramidData>;

const pyramidOptionsObject = baseOptionsSchema.safeExtend(refusedBaseOptions('pyramid')).safeExtend({
  // `sort` and `topN` are declared `never`, not omitted: an omitted key is not
  // in the published shape at all, so the (type, key) census would not see it.
  // `never` publishes the refusal as `{ "not": {} }`. The raw preprocess below
  // still owns `sort`'s wording, because it sees the raw object and can name
  // `sortBy` too.
  sort: z
    .never({
      error: `${REFUSED_OPTIONS.sortBy.code}: options.sort ${REFUSED_OPTIONS.sortBy.why} — ${REFUSED_OPTIONS.sortBy.fix}`,
    })
    .optional()
    .describe('Refused: band order is the ordered axis a pyramid is read from.'),
  topN: z
    .never({
      error:
        "'topN' is not accepted on a pyramid: the bands are a contiguous ordered axis, and folding the tail into a rest bucket leaves a hole in it — widen the bands in the data instead",
    })
    .optional()
    .describe('Refused: bands are a contiguous ordered axis; a rest bucket leaves a hole in it.'),
  basis: z
    .enum(['count', 'shareOfTotal'])
    .optional()
    .describe(
      "Default 'count'. 'shareOfTotal' divides by the grand total across BOTH groups and all bands — never per group, which would hide the group-size imbalance a pyramid is read for.",
    ),
  methodNote: z
    .boolean()
    .optional()
    .describe(
      'Default false. true adds the method footnote stating the band convention: [from, to), youngest at the bottom, equal widths. An open-ended top band and the share base are required for interpretation and print regardless.',
    ),
});

/**
 * Options this type refuses, checked on the RAW object before the parse.
 *
 * Omitting them from the schema would not refuse them. A zod object STRIPS
 * unknown keys, so the CLI would parse `sortBy`/`sort`/`sharedScale` away
 * before `layoutPyramid` runs, print a generic `unknown-option` warn, and
 * return ok:true with exit 0.
 *
 * `layoutPyramid` also throws `pyramid-sort-unsupported` /
 * `pyramid-shared-scale-required` for direct and React callers, and that is
 * where the codes live. This preprocess is the schema-path twin: it fails the
 * parse, so the CLI reports `invalid-options` at the offending key and exits
 * non-zero. `sortBy` and `sharedScale` stay out of the object shape because
 * they are not shared-base keys at all — publishing them would advertise two
 * options this type never had, which the react-surface check refuses. `sort`
 * and `topN` ARE shared-base keys, so they are declared `never` in the shape
 * above: that publishes the refusal a caller can read instead of
 * hiding the pair from the census.
 */
const REFUSED_KEYS = [
  ['sortBy', REFUSED_OPTIONS.sortBy],
  ['sort', REFUSED_OPTIONS.sortBy],
  ['sharedScale', REFUSED_OPTIONS.sharedScale],
] as const;

export const pyramidOptionsSchema = z.preprocess((raw, ctx) => {
  if (raw && typeof raw === 'object') {
    for (const [key, refusal] of REFUSED_KEYS) {
      if (key in (raw as Record<string, unknown>)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${refusal.code}: options.${key} ${refusal.why} — ${refusal.fix}`,
          // The key is refused, so the diagnostic carries the remove patch the React entry prints too.
          params: { refused: true },
        });
      }
    }
  }
  return raw;
}, pyramidOptionsObject) as unknown as z.ZodType<PyramidOptions>;
