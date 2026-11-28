import { optionShapeSchema } from '../../schema/shared';
import { geoRegionSchema } from '../../schema/geoRegion';
import * as z from 'zod';
import {
  addCanvasBoundsIssues,
  addGeoIdIssues,
  baseOptionsSchema,
  idSchema,
  refusedBaseOptions,
} from '../../schema/shared';
import { headlessColumnFields, regionValuesWithoutLabelsRefused } from './geoRefusals';
import type { ChoroplethData, ChoroplethOptions } from './types';
import { columnOverridesOption, columnVisibilityOption, rowOrderOption, rowOverridesOption, rowVisibilityOption } from '../../schema/generatedColumnOptions';
import { addGeoLegendNoneIssue, addGeoStepsIssue, geoHighlightRefused, geoOverlaySchema, geoScaleSchema, geoStepsSchema, overlayMeasureSchema, overlayTonesSchema } from './geoSchema';

export * from './geoSchema';

const baseChoroplethDataSchema = z
  .object({
    pack: z.enum(['de-states', 'eu27', 'dach', 'europe', 'world', 'us-states']).describe("Built-in boundary pack that supplies region shapes and identifiers. 'europe' holds the EU27, CH, NO, IS, GB, the Balkan states, UA, BY, MD and the small states, without RU and TR; it follows the EU view, shows Crimea as part of Ukraine and shows Cyprus whole. 'world' also shows Crimea as part of Ukraine and keeps Natural Earth's de facto view elsewhere; it also holds small places such as HK, MO, GI, AD, LI, MC, SM and VA as markers."),
    regions: z
      .array(geoRegionSchema)
      .min(1).describe('Observed regions keyed by pack id; omitted pack members are not in the data and draw plain background.'),
    overlays: z.array(geoOverlaySchema).optional().describe('Named glyphs and labels placed at geographic anchors.'),
  })
  .strict().describe('Region values and optional geographic overlays.') as unknown as z.ZodType<ChoroplethData>;

export const choroplethOptionsSchema = z
  .object({
    ...baseOptionsSchema.shape,
    ...refusedBaseOptions('choropleth'),
    highlight: geoHighlightRefused('choropleth'),
    topN: optionShapeSchema('topN', z
      .strictObject({
        n: z.number().int().positive().describe('How many regions with the largest absolute values the automatic labels name.'),
      }), z.number().int().positive())
      .optional()
      .describe("On the world pack, the automatic labels name the n regions with the largest absolute values, plus the large countries (default 12). The other packs label every region, and labels 'all' or 'none' decide for themselves, so there topN changes nothing. A positive integer n means { n }."),
    scale: geoScaleSchema(true).optional().describe('Sequential magnitude or diverging midpoint color scale.'),
    classes: z.number().int().min(3).max(7).optional().describe('Number of equal-interval color classes, from 3 through 7. Explicit steps define five classes instead.'),
    steps: geoStepsSchema,
    labels: z.union([z.enum(['auto', 'all', 'none']).describe('Automatic selection, all regions, or no region labels.'), z.literal(false).describe("The same as 'none', kept for the shared labels: false.")]).optional().describe("Region-label selection policy; placement still respects available space. false is the same as 'none'."),
    regionValues: z.boolean().optional().describe("Print each labelled region's value after its code, e.g. 'DE 2.2%', through the same placement and fit tiers as the code. Default true when no value table is drawn and the map labels at most 10 regions, or, off the world map, when the canvas is at least 560 px wide and gives each label at least 8000 square pixels; else false. A region whose label no longer fits is listed with its value. Needs region labels, so labels 'none' or false refuse it."),
    labelRegions: z.array(idSchema.describe('Pack region id requested for labeling. Exact spellings win, then ids and aliases match without regard to case.')).optional().describe('Explicit region ids to label, retained by the small-region filter.'),
    microStateMarkers: z.boolean().optional().describe("Draw a dot for a micro-state the data lists without a value (null); one with a value is always drawn. Default off on the world pack, the only pack whose micro-states have no outline; on the other packs it would change nothing and is refused."),
    smallRegionArea: z.number().min(0).max(1).optional().describe('Area fraction below which automatic labels move to Small members. Default 0.001; 0 disables. Explicit label requests are retained.'),
    overlayTones: overlayTonesSchema,
    overlayMeasure: overlayMeasureSchema,
    keyTitle: z.string().trim().min(1).optional().describe("Title of the colour key, naming what the colours measure. Default 'Measure, unit' from subtitle.measure and unit, else the unit alone; set it when the subtitle is drawn elsewhere."),
    valueTable: z.union([z.enum(['auto', 'side', 'below']), z.literal(false)]).optional().describe("The table of every region with its class swatch, code and value; the top values print bold and the map then prints codes only. 'auto' (default): beside the map when the map keeps most of the row, else under it; off above 20 regions, without numeric values, or when a pinned canvas is too short for it; an authored 'auto' that the region count turns off warns option-ignored. 'side' or 'below' forces the place; false leaves it off."),
    valueTableEmphasis: z.union([z.literal('top'), z.literal(false)]).optional().describe("'top' (default) sets the top values bold in the value table and on the map, with a rule under them. The top group is ranked on all regions. false sets no row and no map label bold."),
    columnVisibility: columnVisibilityOption('choropleth'),
    columnOverrides: columnOverridesOption('choropleth', ['width', 'align', 'headAlign', 'label']).superRefine((overrides, ctx) => {
      for (const { path, message } of headlessColumnFields(overrides)) ctx.addIssue({ code: 'custom', path, message });
    }).describe('Settings per generated column. Ids: swatch, code, value. Only value prints a head, so label and headAlign are refused on swatch and code.'),
    rowVisibility: rowVisibilityOption('choropleth'),
    rowOrder: rowOrderOption('choropleth'),
    rowOverrides: rowOverridesOption('choropleth'),
  })
  .superRefine(addCanvasBoundsIssues)
  .superRefine(addGeoLegendNoneIssue)
  .superRefine(addGeoStepsIssue)
  .superRefine((options, ctx) => {
    if (options.regionValues === true && (options.labels === 'none' || options.labels === false)) {
      ctx.addIssue({
        code: 'custom',
        path: ['regionValues'],
        message: regionValuesWithoutLabelsRefused(options.labels),
        params: { refused: true },
      });
    }
  }).describe("Map framing, color scale and region-label policies. The titled colour key and the Small members block sit together in the row above the map, and the map rises under that row where no region lies. On a canvas of a set height whose plot is at least 1.6 times wider than tall, where a column beside the map makes the map clearly larger and no value table is drawn, they stand in a column right of the map instead; legend 'top' keeps the row. legend 'bottom' puts them under the map. legend 'right' or 'left' puts them in a column beside the map. legend 'none' is refused (the key names what the colours measure).") as unknown as z.ZodType<ChoroplethOptions>;

export const choroplethDataSchema = baseChoroplethDataSchema.superRefine(addGeoIdIssues);

export { retiredSettings } from './retired';
