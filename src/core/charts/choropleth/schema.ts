import { geoRegionSchema } from '../../schema/geoRegion';
import * as z from 'zod';
import {
  addCanvasBoundsIssues,
  addGeoIdIssues,
  baseOptionsSchema,
  idSchema,
  refusedBaseOptions,
} from '../../schema/shared';
import { isIconName, listIcons } from '../../icons';
import { COLORBLIND_WITHOUT_PAIR_REFUSED, highlightRefused, LEGEND_NONE_REFUSED, regionValuesWithoutLabelsRefused } from './geoRefusals';
import type { ChoroplethData, ChoroplethOptions } from './types';
import type { GeoOverlay } from './overlayTypes';

const overlayToneSchema = z.enum(['good', 'bad', 'warn', 'neutral', 'info']).describe('Semantic glyph tone resolved through the theme.');
const overlayAtSchema = z.union([
  z.strictObject({ region: idSchema.describe('Region id whose pack anchor positions the overlay.') }).describe('Anchor at a named region.'),
  z.strictObject({
    lon: z.number().finite().min(-180).max(180).describe('Longitude in degrees, west negative and east positive.'),
    lat: z.number().finite().min(-90).max(90).describe('Latitude in degrees, south negative and north positive.'),
  }).describe('Anchor at longitude and latitude coordinates.'),
]).describe('Geographic anchor for an overlay.');
const pieShareSchema = z.strictObject({
  label: z.string().min(1).describe('Readable name for this overlay or pie share.'),
  value: z.number().finite().nonnegative().describe('Nonnegative share amount; slices divide by the positive sum of all shares.'),
  tone: overlayToneSchema.optional(),
}).describe('One labeled slice in an overlay pie.');
const overlayGlyphSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('pie').describe('Draw a small part-to-whole pie.'),
      shares: z.array(pieShareSchema).min(2).describe('At least two labeled shares with a positive combined amount.'),
    })
    .superRefine((glyph, ctx) => {
      if (glyph.shares.reduce((sum, share) => sum + share.value, 0) <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['shares'],
          message: 'overlay pie shares must have a positive total',
        });
      }
    }).describe('Overlay pie with a positive total.'),
  z.strictObject({
    kind: z.literal('harvey').describe('Draw a fractionally filled Harvey ball.'),
    value: z.number().finite().min(0).max(1).describe('Filled fraction from 0, empty, to 1, full.'),
    tone: overlayToneSchema.optional(),
  }).describe('Fractional Harvey-ball overlay.'),
  z.strictObject({
    kind: z.literal('status').describe('Draw a semantic status glyph.'),
    status: z.enum(['good', 'bad', 'warn', 'neutral']).describe('Status judgment shown by the glyph.'),
  }).describe('Semantic status overlay.'),
  z.strictObject({
    kind: z.literal('icon').describe('Draw a named built-in icon.'),
    name: z.string().superRefine((name, ctx) => {
      if (!isIconName(name)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown icon '${name}' — valid icons: ${listIcons().join(', ')}`,
        });
      }
    }).describe(`Name from the built-in icon catalogue: ${listIcons().join(' ')}.`),
    tone: overlayToneSchema.optional(),
  }).describe('Built-in icon overlay.'),
  z.strictObject({
    kind: z.literal('marker').describe('Draw a geometric location marker.'),
    shape: z.enum(['circle', 'square', 'diamond']).optional().describe('Marker outline; defaults to circle.'),
    tone: overlayToneSchema.optional(),
  }).describe('Geometric location marker.'),
]).describe('Overlay glyph and the data needed to draw it.');

export const overlayTonesSchema = z
  .strictObject(Object.fromEntries((['good', 'bad', 'warn', 'neutral', 'info'] as const).map((tone) =>
    [tone, z.string().trim().min(1).optional().describe(`What the ${tone} tone marks on this map.`)])))
  .optional()
  .describe("The key words for each overlay tone, e.g. { warn: 'Behind plan' }. The overlay key shows a toned glyph among plain ones, each status and each pie share; direct labels name every overlay, so plain glyphs get no entry. A toned entry without a name prints the tone word and warns.");

export const overlayMeasureSchema = z.string().trim().min(1).optional()
  .describe("The measure the overlay glyphs show, e.g. 'Activation progress, %'. The overlay key prints it as a heading without a category swatch, apart from the colour key; Harvey-ball overlays without it warn geo-overlay-measure-unnamed.");

export const geoOverlaySchema = z.strictObject({
  id: idSchema.describe('Stable overlay identifier, unique within the exhibit.'),
  at: overlayAtSchema.describe('Region or longitude/latitude anchor for the overlay.'),
  glyph: overlayGlyphSchema.describe('Overlay mark and its semantic data.'),
  label: z.string().min(1).describe('Readable name for this overlay or pie share.'),
  size: z.enum(['sm', 'md', 'lg']).optional().describe('Glyph size tier; defaults to md.'),
  a11y: z.string().min(1).optional().describe('Authored accessible description for the overlay.'),
}).describe('One identified geographic overlay with a label.') as unknown as z.ZodType<GeoOverlay>;

const baseChoroplethDataSchema = z
  .object({
    pack: z.enum(['de-states', 'eu27', 'dach', 'europe', 'world', 'us-states']).describe("Built-in boundary pack that supplies region shapes and identifiers. 'europe' holds the EU27, CH, NO, IS, GB, the Balkan states, UA, BY, MD and the small states, without RU and TR; it follows the EU view, shows Crimea as part of Ukraine and shows Cyprus whole. 'world' also shows Crimea as part of Ukraine and keeps Natural Earth's de facto view elsewhere; it also holds small places such as HK, MO, GI, AD, LI, MC, SM and VA as markers."),
    regions: z
      .array(geoRegionSchema)
      .min(1).describe('Observed regions keyed by pack id; omitted pack members are not in the data and draw plain background.'),
    overlays: z.array(geoOverlaySchema).optional().describe('Named glyphs and labels placed at geographic anchors.'),
  })
  .strict().describe('Region values and optional geographic overlays.') as unknown as z.ZodType<ChoroplethData>;

/** The color scale of both map types; the tilemap key has no midpoint label. */
export const geoScaleSchema = (midpointLabel: boolean) => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sequential').describe('Encode ordered magnitudes with one color ramp.') }).strict().describe('Sequential magnitude scale.'),
  z
    .object({
      kind: z.literal('diverging').describe('Encode values on favorable and unfavorable sides of a midpoint, on one span both ways: the farther side sets full strength.'),
      midpoint: z.number().finite().describe('Neutral dividing value in the same source units as region values.'),
      ...(midpointLabel ? { midpointLabel: z.string().trim().min(1).optional().describe('Explanation appended to the formatted midpoint in the key.') } : {}),
      polarity: z
        .enum(['higherIsBetter', 'lowerIsBetter'])
        .optional()
        .describe(
          'Which side of the midpoint is favorable; the diverging poles paint good/bad accordingly. Default higherIsBetter.',
        ),
    })
    .strict().describe('Diverging scale with an explicit neutral midpoint.'),
]).describe('Color scale for the region measure.');

/** colorblindSafe swaps the good/bad poles of a diverging scale; a sequential ramp has none to swap. */
export function addGeoColorblindIssue(options: { colorblindSafe?: boolean; scale?: { kind: string } }, ctx: z.RefinementCtx): void {
  if (options.colorblindSafe !== true || options.scale?.kind === 'diverging') return;
  ctx.addIssue({
    code: 'custom',
    path: ['colorblindSafe'],
    // The key is refused, so the diagnostic carries the remove fix.
    params: { refused: true },
    message: COLORBLIND_WITHOUT_PAIR_REFUSED,
  });
}

/**
 * A map's key names what its colours measure, so it cannot be hidden: legend
 * 'none' is refused with the remove fix.
 */
export function addGeoLegendNoneIssue(options: { legend?: unknown }, ctx: z.RefinementCtx): void {
  if (options.legend !== 'none') return;
  ctx.addIssue({
    code: 'custom',
    path: ['legend'],
    params: { refused: true },
    message: LEGEND_NONE_REFUSED,
  });
}

/** A map region has no emphasis state: the colour is the value. */
export const geoHighlightRefused = (type: string) => z
  .never({ error: highlightRefused(type) })
  .optional()
  .describe(`Refused on '${type}': a region's colour is its value, so an emphasis colour would read as data.`);

export const geoStepsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine((steps) => steps.every((step, i) => i === 0 || step > steps[i - 1]!), 'steps must ascend')
  .optional().describe('Four ascending thresholds in source units, as on cohort, defining five colour classes. A value on a threshold enters the higher class. The first and last classes are open-ended. Omit to keep the continuous ramp or equal-interval classes. Use a format that prints each threshold exactly.');

export function addGeoStepsIssue(options: { steps?: number[]; classes?: number }, ctx: z.RefinementCtx): void {
  if (options.steps && options.classes !== undefined && options.classes !== 5) {
    ctx.addIssue({ code: 'custom', path: ['classes'], message: 'four steps define five classes; remove classes or set it to 5' });
  }
}

export const choroplethOptionsSchema = z
  .object({
    ...baseOptionsSchema.shape,
    ...refusedBaseOptions('choropleth'),
    highlight: geoHighlightRefused('choropleth'),
    topN: z
      .strictObject({
        n: z.number().int().positive().describe('How many regions with the largest absolute values the automatic labels name.'),
      })
      .optional()
      .describe("On the world pack, the automatic labels name the n regions with the largest absolute values, plus the large countries (default 12). The other packs label every region, and labels 'all' or 'none' decide for themselves, so there topN changes nothing."),
    scale: geoScaleSchema(true).optional().describe('Sequential magnitude or diverging midpoint color scale.'),
    classes: z.number().int().min(3).max(7).optional().describe('Number of equal-interval color classes, from 3 through 7. Explicit steps define five classes instead.'),
    steps: geoStepsSchema,
    labels: z.union([z.enum(['auto', 'all', 'none']).describe('Automatic selection, all regions, or no region labels.'), z.literal(false).describe("The same as 'none', kept for the shared labels: false.")]).optional().describe("Region-label selection policy; placement still respects available space. false is the same as 'none'."),
    regionValues: z.boolean().optional().describe("Print each labelled region's value after its code, e.g. 'DE 2.2%', through the same placement and fit tiers as the code. Default true when the map labels at most 10 regions, else false. Needs region labels, so labels 'none' or false refuse it."),
    labelRegions: z.array(idSchema.describe('Pack region id requested for labeling.')).optional().describe('Explicit region ids to label, retained by the small-region filter.'),
    microStateMarkers: z.boolean().optional().describe("Draw a dot for a micro-state the data lists without a value (null); one with a value is always drawn. Default off on the world pack, the only pack whose micro-states have no outline; on the other packs it would change nothing and is refused."),
    smallRegionArea: z.number().min(0).max(1).optional().describe('Area fraction below which automatic labels move to Small members. Default 0.001; 0 disables. Explicit label requests are retained.'),
    overlayTones: overlayTonesSchema,
    overlayMeasure: overlayMeasureSchema,
    keyTitle: z.string().trim().min(1).optional().describe("Title of the colour key, naming what the colours measure. Default 'Measure, unit' from subtitle.measure and unit, else the unit alone; set it when the subtitle is drawn elsewhere."),
    valueTable: z.union([z.enum(['auto', 'side', 'below']), z.literal(false)]).optional().describe("The table of every region with its class swatch, code and value; the top values print bold and the map then prints codes only. 'auto' (default): beside the map when the map keeps most of the row, else under it; off above 20 regions, without numeric values, or when a pinned canvas is too short for it. 'side' or 'below' forces the place; false leaves it off."),
    methodNote: z.boolean().optional().describe("Default false. true adds the method footnote on which regions the automatic label policy names. The world pack's endorsement disclaimer stays on the source line and prints once. The inset scale note is required for interpretation and prints regardless."),
  })
  .superRefine(addCanvasBoundsIssues)
  .superRefine(addGeoColorblindIssue)
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
  }).describe("Map framing, color scale and region-label policies. The titled colour key and the Small members block sit together in the row above the map, and the map rises under that row where no region lies; legend 'bottom' puts them under the map. legend 'right' is refused (a side column takes the map's width), and so is 'none' (the key names what the colours measure).") as unknown as z.ZodType<ChoroplethOptions>;

export const choroplethDataSchema = baseChoroplethDataSchema.superRefine(addGeoIdIssues);
