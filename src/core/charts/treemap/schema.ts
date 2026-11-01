/** Treemap data and options schemas, without the chart engine. */

import * as z from 'zod';
import { addDuplicateIdIssues, baseOptionsSchema, colorRoleField, idSchema, refusedBaseOptions } from '../../schema/shared';
import type { TreemapData, TreemapOptions } from './types';
import { TREEMAP_AREA_ERROR_LIMIT, TREEMAP_CIRCLE_MAX_ITEMS } from './geometry';

const groupSchema = z.strictObject({
  id: idSchema.describe('Group identity that items name in `group`.'),
  label: z.string().optional().describe('Group name in the legend; defaults to the id.'),
  colorRole: colorRoleField('Theme color role of every cell in this group. Absent, the group takes its rank step on color.treemap (else color.stack, else the first series colour stepped toward the page), or its palette hue when options.palette is set.'),
  fill: z.string().optional().describe('Authored fill of every cell in this group.'),
});

const itemSchema = z.strictObject({
  id: idSchema.describe('Item identity, one cell.'),
  label: z.string().optional().describe('Name printed on the cell, or beside it with a leader when the cell is too small; defaults to the id.'),
  group: idSchema.optional().describe('Id of the group this item belongs to. Leave it out on every item for a one-level treemap.'),
  value: z.number().describe('Value of the item, above 0. The cell area is proportional to it. Zero, negative and missing values are refused.'),
});

export const treemapDataSchema = z
  .strictObject({
    groups: z.array(groupSchema).optional().describe('Groups in source order. Each group is one colour and one contiguous region; by default the groups share one colour family, the first drawn group strongest (the largest under the default order). Left out, the groups come from the items in first-seen order.'),
    items: z.array(itemSchema).min(1).describe('Items, one cell each. Items of one group sit next to each other.'),
  })
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.items, ['items'], { name: 'item', keys: 'cells and scene identities' });
    if (data.groups) addDuplicateIdIssues(ctx, data.groups, ['groups'], { name: 'group', keys: 'regions, legend entries and scene identities' });
  }) as unknown as z.ZodType<TreemapData>;

export const treemapOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('treemap')).safeExtend({
  variant: z.enum(['rect', 'circle']).optional().describe(
    `'rect' (default) draws squarified rectangles with exact areas. 'circle' draws a Voronoi treemap clipped to a circle: convex cells whose areas converge to their values; the largest relative area error is in derived.maxAreaError, and above ${TREEMAP_AREA_ERROR_LIMIT * 100}% the chart warns treemap-area-error. 'circle' takes at most ${TREEMAP_CIRCLE_MAX_ITEMS} items (the layout time grows with the square of the count) and refuses more: use 'rect', or group small items into Other.`,
  ),
  order: z.enum(['value', 'sheet']).optional().describe(
    "'value' (default) places the largest group first and, inside each group, the largest item first: top left on 'rect', clockwise from 12 o'clock on 'circle'. 'sheet' keeps the source order.",
  ),
  cellValue: z.enum(['value', 'share', 'value-share']).optional().describe(
    "Name and bold value print together, inside the cell or on a circle leader. A pair that does not fit goes to the complete list. 'value' (default), 'share' of the grand total, or 'value-share' as \"3,080 (17%)\". A percent format applies to cell shares; group totals stay in value units.",
  ),
  total: z.union([z.boolean(), z.string()]).optional().describe(
    "Total callout at the lower right, no larger than the title. true prints the formatted grand total with the unit; a string prints itself, with '{value}' replaced by the formatted total. Off by default: the title usually states the total.",
  ),
}) as unknown as z.ZodType<TreemapOptions>;
