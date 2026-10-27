import * as z from 'zod';
import { cellDetailsSchema, cellMetaSchema } from './schema/shared';

// DataRange and the range-bearing cells are declared in ./types/cell — a
// `declare module` augmentation here survives into the declaration bundle as an
// inert ambient module whose relative specifier resolves to nothing. `range` is
// declared on RangeNumberCell/RangePctCell, not on the shared CellMeta: the
// shared cellSchema is a strictObject that rejects it.
export * from './rangeRules';

const rangeSchema = z
  .object({
    low: z.number().finite().describe('Lower interval endpoint in the cell unit; must not exceed high.'),
    high: z.number().finite().describe('Upper interval endpoint in the cell unit; must be at least low.'),
    mid: z.number().finite().optional().describe('Optional middle marker in the cell unit; range resolution warns and omits it when outside low and high.'),
  })
  .strict()
  .superRefine((range, ctx) => {
    if (range.low > range.high) {
      ctx.addIssue({
        code: 'custom',
        path: ['low'],
        message: 'range-inverted: low must be less than or equal to high',
      });
    }
  })
  .describe('Optional per-item low/high range in the same units as the cell value.');

export const rangeCellSchema = z.union([
  z.number().finite().describe('Numeric cell shorthand without a range.'),
  z.null().describe('Missing observation; not a zero or an interval.'),
  z.strictObject({
    number: z.number().finite().describe('Observed value in the series or chart unit.'),
    ...cellMetaSchema,
    details: cellDetailsSchema.optional(),
    range: rangeSchema.optional().describe('Optional low/high interval in the same unit as number.'),
  }).describe('Numeric cell with optional interval and per-cell presentation overrides.'),
  z.strictObject({
    pct: z.number().finite().describe('Percentage points: 50.5 means 50.5%.'),
    ...cellMetaSchema,
    details: cellDetailsSchema.optional(),
    range: rangeSchema.optional().describe('Optional low/high interval expressed in percentage points, like pct.'),
  }).describe('Percentage cell with optional interval and per-cell presentation overrides.'),
  z.strictObject({ date: z.string().describe('Date text intended as ISO 8601; this schema accepts a string without validating the date.') }).describe('Date cell; this branch does not accept a range.'),
]).describe('Cell accepted by range-capable chart families; only numeric and percentage objects can carry a range.');
