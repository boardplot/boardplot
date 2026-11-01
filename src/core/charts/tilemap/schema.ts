import { geoRegionSchema } from '../../schema/geoRegion';
import * as z from 'zod';
import { addGeoIdIssues, baseOptionsSchema, refusedBaseOptions } from '../../schema/shared';
import { addGeoColorblindIssue, addGeoLegendNoneIssue, addGeoStepsIssue, geoStepsSchema, geoHighlightRefused, geoOverlaySchema, geoScaleSchema, overlayMeasureSchema, overlayTonesSchema } from '../choropleth/schema';
import { REGION_VALUES_WITHOUT_CODES_REFUSED } from '../choropleth/geoRefusals';
import type { TilemapData, TilemapOptions } from './types';

const baseTilemapDataSchema = z
  .object({
    pack: z.enum(['eu27', 'europe', 'world', 'us-states']).describe('Built-in equal-area tile layout; region ids must belong to this pack.'),
    regions: z
      .array(geoRegionSchema)
      .min(1).describe('Observed regions keyed by pack id; omitted pack members are not in the data and draw plain background. Zero regions is empty-data.'),
    overlays: z.array(geoOverlaySchema).optional().describe('Named glyphs and labels placed at geographic anchors.'),
  })
  .strict().describe('Region values and optional geographic overlays.') as unknown as z.ZodType<TilemapData>;

export const tilemapOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('tilemap')).safeExtend({
  highlight: geoHighlightRefused('tilemap'),
  scale: geoScaleSchema(false).optional().describe('Sequential magnitude or diverging midpoint color scale.'),
  classes: z.number().int().min(3).max(7).optional().describe('Number of equal-interval color classes, from 3 through 7. Explicit steps define five classes instead.'),
  steps: geoStepsSchema,
  overlayTones: overlayTonesSchema,
  overlayMeasure: overlayMeasureSchema,
  regionValues: z.boolean().optional().describe("Print each tile's value under its code, e.g. 'CA' over '52'. Unset prints the values when every value fits its tile and keeps the codes alone when one does not. true prints them where they fit: a tile too small for both keeps its code and the layout warns that its value shows on hover only. false prints codes only."),
}).superRefine(addGeoColorblindIssue).superRefine(addGeoLegendNoneIssue).superRefine(addGeoStepsIssue).superRefine((options, ctx) => {
  const labels = options.labels as false | { category?: boolean } | undefined;
  if (options.regionValues === true && (labels === false || labels?.category === false)) {
    ctx.addIssue({
      code: 'custom',
      path: ['regionValues'],
      params: { refused: true },
      message: REGION_VALUES_WITHOUT_CODES_REFUSED,
    });
  }
}).describe("Tile-map framing and region color scale. The colour key sits in the row above the tiles, or under them with legend 'bottom'. On a canvas with a set height where the tiles are bound by that height, an unnamed key stands in a column right of the tiles when that makes them clearly larger; legend 'top' keeps the row. legend 'right' is refused (a side column takes the grid's width), and so is 'none' (the key names what the colours measure).") as unknown as z.ZodType<TilemapOptions>;

export const tilemapDataSchema = baseTilemapDataSchema.superRefine(addGeoIdIssues);
