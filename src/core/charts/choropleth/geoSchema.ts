import * as z from 'zod';
import { idSchema } from '../../schema/shared';
import { isIconName, listIcons } from '../../icons';
import { highlightRefused, LEGEND_NONE_REFUSED } from './geoRefusals';
import type { GeoOverlay } from './overlayTypes';

const overlayToneSchema = z.enum(['good', 'bad', 'warn', 'neutral', 'info']).describe('Semantic glyph tone resolved through the theme.');
const overlayAtSchema = z.union([
  z.strictObject({ region: idSchema.describe('Region id whose pack anchor positions the overlay. Exact spellings win, then ids and aliases match without regard to case.') }).describe('Anchor at a named region.'),
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
  .describe("The key words for each overlay tone, e.g. { warn: 'Behind plan' }. The overlay key shows a toned glyph among plain ones, each status and each pie share; beside keyed tones, plain Harvey balls take the overlayMeasure entry and other plain glyphs share one 'Other' entry. A toned entry without a name prints the tone word and warns.");

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
