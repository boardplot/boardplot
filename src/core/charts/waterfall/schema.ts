/** Waterfall data and options schemas, without the chart engine. */

import * as z from 'zod';
import { scenarioField } from '../../schema/shared';
import {
  baseOptionsSchema,
  cellSchema,
  colorRoleField,
  idSchema,
  refusedBaseOptions,
  primaryAxisTitleSchema,
} from '../../schema/shared';
import type { WaterfallData } from '../../types/data';
import type { WaterfallOptions } from '../../types/options';

const segmentSchema = z.object({
  id: idSchema.refine((id) => id !== '__total' && id !== '__value', "'__total' and '__value' name the engine's own bar segments; give this segment another id").describe("Segment identity within its waterfall item; also names connector anchors."),
  label: z.string().optional().describe("Displayed segment name; defaults to its id."),
  value: cellSchema.describe("Signed contribution of this segment to its item."),
  colorRole: colorRoleField("Theme color role for this segment."),
  scenario: scenarioField('Scenario controlling this segment paint convention.'),
}).passthrough();

const itemSchema = z.object({
  id: idSchema.describe("Unique bridge-item identity used by connectors and annotations."),
  label: z.string().optional().describe("Displayed bridge-item name; defaults to its id."),
  type: z.enum(['delta', 'subtotal', 'total']).optional().describe("Delta contribution by default; subtotal and total show accumulated levels."),
  value: cellSchema.optional().describe("Signed delta contribution, or an optional check value for a subtotal or total. A check value off the running sum by more than its inputs' rounding warns derived-mismatch, and the sum is drawn. A check value off by less is disclosed: the sum is drawn, the info check-value-rounded names both numbers, and a disclosure note names them where notes.show lists 'disclosure'. An opening total without a value is derived backward from the next total that has one across plain deltas, and refused otherwise."),
  segments: z.array(segmentSchema).min(1).optional().describe("Named signed contributions composing this item instead of a single value."),
  date: z.string().optional().describe("ISO 8601 date associated with this bridge item."),
  scenario: scenarioField('Scenario for this bridge item and its default segment styling.'),
  direction: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe("Under 'lowerIsBetter' a rise paints bad and a fall good (options.signColor)."),
  toBaseline: z.boolean().optional().describe("Start this delta at zero and reset the accumulated contribution list. A subtotal draws the sum of the deltas since the last total or baseline subtotal, from zero; the running level carries on."),
  values: z.array(cellSchema).optional().describe("With data.cases: one value per case, in case order, in place of value — the signed delta of each case, or a total's opening or check value."),
}).passthrough();

// The keys each data level actually reads. Everything else is REFUSED by the
// superRefine below rather than silently stripped: a stripped `data.format`
// would pass validation and drop the currency from every rendered label, and
// an option must never be a silent no-op.
// `.passthrough()` on the objects above is what lets the refine SEE unknown
// keys — a plain z.object strips them before any refinement runs.
const DATA_KEYS = new Set(['items', 'connectors', 'cases']);

const ITEM_KEYS = new Set([
  'id', 'label', 'type', 'value', 'segments', 'date', 'scenario', 'direction', 'toBaseline', 'values',
]);

const SEGMENT_KEYS = new Set(['id', 'label', 'value', 'colorRole', 'scenario']);

const CONNECTOR_KEYS = new Set(['from', 'to', 'anchor', 'hidden']);

function refuseUnknownKeys(
  ctx: z.RefinementCtx,
  value: object,
  known: Set<string>,
  path: (string | number)[],
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (known.has(key)) continue;
    const isOption = WATERFALL_OPTION_KEYS.has(key);
    ctx.addIssue({
      code: 'custom',
      path: [...path, key],
      message: isOption
        ? `'${key}' is a chart option, not waterfall data — move it to options.${key}`
        : `unknown key '${key}' ${where} — known keys: ${[...known].join(', ')}`,
    });
  }
}

/** A bridge with cases takes one value per case on every item, and nothing that belongs to one bridge. */
function refuseCaseMismatch(ctx: z.RefinementCtx, data: WaterfallData): void {
  const cases = data.cases;
  if (!cases) {
    data.items.forEach((item, index) => {
      if (item.values !== undefined) ctx.addIssue({ code: 'custom', path: ['items', index, 'values'], message: `item '${item.id}' gives values, one per case, but data.cases names no cases — use value, or declare data.cases` });
    });
    return;
  }
  const seen = new Set<string>();
  cases.forEach((c, index) => {
    if (seen.has(c.id)) ctx.addIssue({ code: 'custom', path: ['cases', index, 'id'], message: `duplicate case id '${c.id}'` });
    seen.add(c.id);
  });
  if (data.connectors !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['connectors'], message: "a bridge with cases draws no connectors: a line to a case's next bar would cross the other case's bar — drop data.connectors" });
  }
  data.items.forEach((item, index) => {
    if (item.value !== undefined || item.segments !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['items', index, item.value !== undefined ? 'value' : 'segments'], message: `item '${item.id}': with data.cases each item gives values, one per case, and no ${item.value !== undefined ? 'value' : 'segments'}` });
    }
    const needed = (item.type ?? 'delta') === 'delta';
    if (item.values === undefined ? needed : item.values.length !== cases.length) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'values'], message: `item '${item.id}' needs ${cases.length} values, one per case (${cases.map((c) => c.id).join(', ')})${needed ? '' : ', or none on a total that sums the steps before it'}` });
    }
  });
}

export const waterfallDataSchema = z
  .object({
    items: z.array(itemSchema).min(1).describe("Ordered bridge items; order sets accumulation and positions. Rows: label,value; optional type (delta|subtotal|total)."),
    connectors: z
      .array(
        z.object({
          from: idSchema.describe("Source waterfall item id."),
          to: idSchema.describe("Destination waterfall item id."),
          anchor: z.union([z.literal('sum'), idSchema]).optional().describe("Connect at the item sum or a named segment boundary."),
          hidden: z.boolean().optional().describe("Hide this connector and start a new summation at the destination."),
        }).passthrough(),
      )
      .optional().describe("Authored connections between item levels; omission uses the default sequence."),
    cases: z
      .array(z.strictObject({
        id: idSchema.describe("Case identity without ':', which joins it to an item id ('<item>:<case>'); an annotation anchor names it as seriesId."),
        label: z.string().optional().describe('Displayed case name in the key; defaults to the id.'),
      }))
      .min(2)
      .max(3)
      .optional()
      .describe("Two or three cases of the same bridge side by side in each step (scenarios): each item gives values, one per case, and each case runs its own levels in its own colour, named in the key. Case bars draw no connectors, since a line to a case's next bar would cross the other case's bar; items take no value or segments, and data.connectors is refused. Under variant 'horizontal' each step's case bars stack in its row."),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    refuseUnknownKeys(ctx, data, DATA_KEYS, [], 'in waterfall data (it carries items, connectors and cases)');
    refuseCaseMismatch(ctx, data as unknown as WaterfallData);
    data.items.forEach((item, index) => {
      refuseUnknownKeys(ctx, item, ITEM_KEYS, ['items', index], `on waterfall item '${item.id}'`);
      (item.segments ?? []).forEach((segment, segmentIndex) => {
        refuseUnknownKeys(
          ctx,
          segment,
          SEGMENT_KEYS,
          ['items', index, 'segments', segmentIndex],
          `on segment '${segment.id}' of item '${item.id}'`,
        );
      });
    });
    (data.connectors ?? []).forEach((connector, index) => {
      refuseUnknownKeys(ctx, connector, CONNECTOR_KEYS, ['connectors', index], 'on waterfall connector');
    });
  })
  // Duplicate ids would silently overwrite the level map, and colon-composed
  // identities collide across items: item 'a:b' +
  // segment 'c' names the same scene node as item 'a' + segment 'b:c'.
  .superRefine((data, ctx) => {
    const seenItems = new Set<string>();
    const composedOwner = new Map<string, string>();
    data.items.forEach((item, index) => {
      if (seenItems.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: `duplicate waterfall item id '${item.id}' — ids key levels, connectors and scene identities, so each item needs its own`,
        });
      }
      seenItems.add(item.id);
      const seenSegments = new Set<string>();
      const composedKeys =
        item.segments && item.segments.length > 0
          ? item.segments.map((segment) => `${item.id}:${segment.id}`)
          : [`${item.id}:__value`];
      composedKeys.forEach((key) => {
        const owner = composedOwner.get(key);
        if (owner !== undefined && owner !== item.id) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'id'],
            message: `items '${owner}' and '${item.id}' compose the same scene identity '${key}' — ids join with ':' into scene node ids, so this pair is ambiguous`,
          });
        }
        composedOwner.set(key, item.id);
      });
      (item.segments ?? []).forEach((segment, segmentIndex) => {
        if (seenSegments.has(segment.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'segments', segmentIndex, 'id'],
            message: `duplicate segment id '${segment.id}' in item '${item.id}'`,
          });
        }
        seenSegments.add(segment.id);
      });
    });
  }) as unknown as z.ZodType<WaterfallData>;

const waterfallOptionsShape = baseOptionsSchema.safeExtend(refusedBaseOptions('waterfall')).safeExtend({
  legend: baseOptionsSchema.shape.legend.describe("Key position. Segment, case and scenario encodings keep their key because numeric bar labels do not name them. With these encodings, 'none' retains the key and reports waterfall-legend-required. A plain bridge keys its sign colours only when a lowerIsBetter step inverts them."),
  axisTitles: primaryAxisTitleSchema('above the vertical plot').describe('Authored primary value-axis title above the vertical plot, using column title styling. Waterfall draws no value ticks. Horizontal mode accepts this key but does not print it.'),
  variant: z.enum(['vertical', 'horizontal']).optional().describe("Vertical columns by default, or a horizontal bridge."),
  build: z.enum(['up', 'down']).optional().describe("Build label in the accessible description; defaults to up. Item types and signed values determine accumulation in both modes."),
  signColor: z.boolean().optional().describe("Paint each plain step good or bad by sign × item direction, as column's signColor; zero is neutral. Default true unless the theme sets marks.bridge or a palette is named; false paints steps neutral."),
});

export const waterfallOptionsSchema =
  waterfallOptionsShape as unknown as z.ZodType<WaterfallOptions>;

/** Option vocabulary, so a misplaced option key can name its correct home. */
const WATERFALL_OPTION_KEYS = new Set(Object.keys(waterfallOptionsShape.shape));
