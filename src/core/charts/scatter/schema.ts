/** Scatter data and options schemas, without the chart engine. */

import * as z from 'zod';
import { formatExample } from '../../schema/shared';
import { scenarioField } from '../../schema/shared';
import {
  colorRoleField,
  addDuplicateIdIssues,
  baseOptionsSchema,
  cellSchema,
  idSchema,
  refusedBaseOptions,
  valueAxisSchema,
  narrowValueAxis,
} from '../../schema/shared';
import type { ScatterData } from '../../types/data';
import type { ScatterStrategyOptions } from './types';

export * from './types';

const markerSchema = z.enum(['circle', 'square', 'triangle', 'diamond', 'none']);

const pointSchema = z.strictObject({
  id: idSchema.describe("Unique point identity used by labels, annotations and interaction records."),
  group: idSchema.optional().describe("Group id controlling shared legend identity and styling."),
  label: z.string().optional().describe("Displayed point name. If no point has an authored label, each point defaults to its id. If any point has an authored label, including an empty string, points with omitted labels stay unnamed on the plot and in omission notes. Their ids remain in interaction and data records."),
  x: cellSchema.describe("Horizontal coordinate in the x-axis units."),
  y: cellSchema.describe("Vertical coordinate in the y-axis units."),
  size: z.number().optional().describe("Bubble magnitude; proportional to area by default, or diameter when sizeBy requests it."),
  fill: z.string().optional().describe("Explicit CSS fill for this point, overriding group paint."),
  marker: markerSchema.optional().describe("Point symbol overriding its group marker."),
  scenario: scenarioField('Scenario controlling the point paint convention.'),
  count: z
    .number()
    .finite()
    .nonnegative()
    .optional()
    .describe("Observations behind this point. options.minCount filters on this field and refuses when it is absent."),
});

const groupSchema = z.strictObject({
  id: idSchema.describe("Group identity referenced by point.group."),
  label: z.string().optional().describe("Displayed group name in the legend; defaults to the group id."),
  colorRole: colorRoleField("Theme color role shared by points in this group."),
  marker: markerSchema.optional().describe("Default marker shape for points in this group."),
});

export const scatterDataSchema = z
  .strictObject({
    points: z.array(pointSchema).min(1).describe("Observations with x/y coordinates and optional bubble sizes. Rows: x,y; optional size,label,group."),
    groups: z.array(groupSchema).optional().describe("Named point groups supplying shared legend and styling information."),
  })
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.points, ['points'], {
      name: 'point',
      keys: 'coordinates, labels and scene identities',
    });
    addDuplicateIdIssues(ctx, data.groups ?? [], ['groups'], {
      name: 'group',
      keys: 'point membership, legends and scene identities',
    });
  }) as unknown as z.ZodType<ScatterData>;

/**
 * A cut point is declared, never inferred: a number, or a statistic named on
 * the exhibit. `{ stat: 'median' }` and `{ stat: 'mean' }` are the only two,
 * and both are unweighted — a size-weighted threshold needs declared weight
 * semantics, so it is refused rather than guessed at.
 */
const quadrantThresholdSchema = z.union([
  z.number().finite(),
  z.object({ stat: z.enum(['median', 'mean']).describe("Unweighted statistic of plotted coordinates used as the declared cut point.") }),
]);

/**
 * Strategy matrix (2x2). `x` and `y` are REQUIRED — there is deliberately no
 * `quadrants: true`. Where the dividers go decides which unit is a star and
 * which is a dog, so a schema that accepted a bare enable would be inviting the
 * engine to invent the most consequential number on the page.
 */
export const quadrantOptionsSchema = z
  .object({
    // Declared `.optional()` so a MISSING cut point reaches the refinement
    // below and gets the message that names both accepted forms. Required-key
    // zod reports a bare "Invalid input", which tells an author nothing about
    // the one decision this preset exists to make explicit.
    x: quadrantThresholdSchema
      .optional()
      .describe("Vertical cut point (REQUIRED): a number, or { stat: 'median' | 'mean' } over the plotted x values."),
    y: quadrantThresholdSchema
      .optional()
      .describe("Horizontal cut point (REQUIRED): a number, or { stat: 'median' | 'mean' } over the plotted y values."),
    labels: z
      .object({
        tl: z.string().optional().describe("Caption for the upper-left quadrant."),
        tr: z.string().optional().describe("Caption for the upper-right quadrant."),
        bl: z.string().optional().describe("Caption for the lower-left quadrant."),
        br: z.string().optional().describe("Caption for the lower-right quadrant."),
      })
      .optional()
      .describe('Box captions; each rendered caption carries its own box count.'),
    tint: z
      .enum(['none', 'alternating'])
      .optional()
      .describe(
        "Neutral checkerboard wash only; good/bad quadrant coloring is not offered because the engine cannot know axis polarity. Use options.highlight for emphasis.",
      ),
    captionPlacement: z.enum(['corner', 'centre']).optional().describe("Place quadrant captions in their corner or centre."),
    axisNames: z
      .object({
        x: z.string().min(1).optional().describe("Short name of the horizontal axis, e.g. 'share'."),
        y: z.string().min(1).optional().describe("Short name of the vertical axis, e.g. 'growth'."),
      })
      .optional()
      .describe("Short axis names for the method note (methodNote: true). With both names and two declared cut points the note is one line: 'Cuts: share at 1 and growth at 8; a point on a cut counts right and above.' Otherwise the full cut-point sentence prints."),
  })
  .superRefine((quadrants, ctx) => {
    for (const axis of ['x', 'y'] as const) {
      if (quadrants[axis] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [axis],
          message: `quadrants.${axis} is required: declare the cut point as a number (e.g. { ${axis}: 1 }) or as a statistic over the plotted points (e.g. { ${axis}: { stat: 'median' } }) — the engine never guesses a cut point, because a guessed threshold silently re-sorts the whole portfolio`,
        });
      }
    }
  });

const zoneToneSchema = z.enum(['neutral', 'good', 'bad', 'warn', 'info', 'none']);
const zoneLabelAtSchema = z
  .enum(['plot', 'key', 'both'])
  .optional()
  .describe("Where the label goes: plot (default) captions it inside the zone, key puts it in the legend row with the zone's fill as its swatch, both does both. key and both need a label and a tone other than none.");

const zonePointSchema = z.strictObject({
  x: z.number().finite().describe("Polygon vertex x coordinate in data units."),
  y: z.number().finite().describe("Polygon vertex y coordinate in data units."),
});

const zoneCellSchema = z.strictObject({
  id: idSchema.describe("Unique identity for this strategy-grid cell."),
  column: z.number().int().nonnegative().describe("Zero-based horizontal interval index, increasing from left to right."),
  row: z.number().int().nonnegative().describe("Zero-based vertical interval index in increasing y-value order."),
  label: z.string().min(1).optional().describe("Visible caption for this strategy-grid cell."),
  tone: zoneToneSchema.optional().describe("Authored semantic fill tone for this cell; none draws no fill and keeps the caption and grid rules. Unauthored cells take the neutral wash."),
  labelAt: zoneLabelAtSchema,
  a11y: z.string().min(1).optional().describe("Accessible description of this cell classification."),
});

const zoneGridSchema = z
  .strictObject({
    x: z.array(z.number().finite()).min(1).describe("Strictly increasing x thresholds partitioning the plot into columns."),
    y: z.array(z.number().finite()).min(1).describe("Strictly increasing y thresholds partitioning the plot into rows."),
    cells: z.array(zoneCellSchema).optional().describe("Named cells receiving authored classification labels and tones."),
    xLabels: z.array(z.string().min(1)).optional().describe("Labels for the x intervals; provide one more label than x thresholds."),
    yLabels: z.array(z.string().min(1)).optional().describe("Labels for the y intervals; provide one more label than y thresholds."),
  })
  .superRefine((grid, ctx) => {
    for (const axis of ['x', 'y'] as const) {
      grid[axis].forEach((value, index) => {
        if (index > 0 && !(value > grid[axis][index - 1]!)) {
          ctx.addIssue({
            code: 'custom',
            path: [axis, index],
            message: `zones.grid.${axis} thresholds must be strictly increasing to partition the axis`,
          });
        }
      });
    }
    if (grid.xLabels && grid.xLabels.length !== grid.x.length + 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['xLabels'],
        message: `zones.grid.xLabels requires ${grid.x.length + 1} labels for ${grid.x.length} thresholds`,
      });
    }
    if (grid.yLabels && grid.yLabels.length !== grid.y.length + 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['yLabels'],
        message: `zones.grid.yLabels requires ${grid.y.length + 1} labels for ${grid.y.length} thresholds`,
      });
    }
    for (const [index, cell] of (grid.cells ?? []).entries()) {
      if (cell.column > grid.x.length || cell.row > grid.y.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index],
          message: `zone cell '${cell.id}' addresses row ${cell.row}, column ${cell.column}, outside the ${grid.y.length + 1}×${grid.x.length + 1} partition`,
        });
      }
    }
    const occupiedCells = new Set<string>();
    for (const [index, cell] of (grid.cells ?? []).entries()) {
      const position = `${cell.column}:${cell.row}`;
      if (occupiedCells.has(position)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index],
          message: `only one strategy-zone cell may address row ${cell.row}, column ${cell.column}`,
        });
      }
      occupiedCells.add(position);
    }
    addDuplicateIdIssues(ctx, grid.cells ?? [], ['cells'], {
      name: 'zone cell',
      keys: 'zone fills, labels and scene identities',
    });
  });

const zoneRegionSchema = z.strictObject({
  id: idSchema.describe("Unique identity for this polygon classification region."),
  points: z
    .array(zonePointSchema)
    .min(3, 'zone polygon requires at least 3 data-space points').describe("At least three ordered polygon vertices in data coordinates."),
  smooth: z.boolean().optional().describe("Smooth the boundary through the authored polygon vertices."),
  label: z.string().min(1).optional().describe("Visible caption for the polygon region."),
  tone: zoneToneSchema.optional().describe("Authored semantic fill tone for this region; none draws the outline only."),
  labelAt: zoneLabelAtSchema,
  a11y: z.string().min(1).optional().describe("Accessible description of this polygon classification."),
});

const zonesSchema = z.union([
  z.strictObject({ grid: zoneGridSchema.describe("Partition strategy zones with ordered x and y cut points.") }),
  z
    .strictObject({ regions: z.array(zoneRegionSchema).min(1).describe("Authored polygon regions used instead of a rectangular partition.") })
    .superRefine((zones, ctx) =>
      addDuplicateIdIssues(ctx, zones.regions, ['regions'], {
        name: 'zone region',
        keys: 'zone fills, labels and scene identities',
      }),
    ),
]);

/**
 * Outlier clamp. A clamp caps what the plot SHOWS; it never changes a
 * value. Points beyond a bound are drawn at that edge with an open marker and
 * counted in a derived footnote, and they keep their real coordinate in the
 * accessible description, the mark records and the claim receipt.
 *
 * `min` and `max` are the vertical axis, the one `valueAxis.min` and
 * `valueAxis.max` already address on this type; `x` and `y` name an axis, so a
 * scatter can cap both measures. Stating the vertical bound both ways is
 * refused rather than merged.
 */
const clampBoundSchema = z.strictObject({
  min: z.number().finite().optional().describe('Lower bound; points below it are drawn at the lower edge and counted in a footnote.'),
  max: z.number().finite().optional().describe('Upper bound; points above it are drawn at the upper edge and counted in a footnote.'),
});

export const scatterClampSchema = z
  .strictObject({
    min: z.number().finite().optional().describe('Lower bound of the vertical axis, the short form of clamp.y.min.'),
    max: z.number().finite().optional().describe('Upper bound of the vertical axis, the short form of clamp.y.max.'),
    x: clampBoundSchema.optional().describe('Bounds of the horizontal measure.'),
    y: clampBoundSchema.optional().describe('Bounds of the vertical measure, the long form of clamp.min and clamp.max.'),
  })
  .superRefine((clamp, ctx) => {
    const stated = [clamp.min, clamp.max, clamp.x?.min, clamp.x?.max, clamp.y?.min, clamp.y?.max];
    if (stated.every((bound) => bound === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message:
          "valueAxis.clamp states no bound: write the value the axis stops at, e.g. { max: 25000 } for the vertical axis or { x: { max: 100 } } for the horizontal one",
      });
    }
    if ((clamp.min !== undefined || clamp.max !== undefined) && clamp.y !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['y'],
        message:
          'valueAxis.clamp states the vertical bound twice: clamp.min and clamp.max are already the y axis, so keep either those or clamp.y',
      });
    }
  });

export const scatterOptionsSchema = baseOptionsSchema
  .safeExtend(refusedBaseOptions('scatter'))
  .safeExtend({
    legend: baseOptionsSchema.shape.legend.describe("Key position. Multiple drawn groups get a key by default unless point labels name each group. 'none' hides the key; unnamed groups warn. Point names alone do not identify groups."),
    viewDomain: z.object({ x: z.tuple([z.number().finite(), z.number().finite()]).optional().describe('Exact horizontal viewport limits.'), y: z.tuple([z.number().finite(), z.number().finite()]).optional().describe('Exact vertical viewport limits.') }).optional().describe('Visible numeric domain. Source means, classifications and bubble sizing keep all observations.'),
    axisTitles: z
      .object({ x: z.string().min(1).optional().describe("Title identifying the horizontal measure and its units."), y: z.string().min(1).optional().describe("Title identifying the vertical measure and its units.") })
      .optional()
      .describe('Axis titles, e.g. { x: \'Price index\', y: \'Perceived quality\' }.'),
    axisFormat: z
      .strictObject({
        x: formatExample.min(1).optional().describe("Format-by-example for x values, such as '$0.0'."),
        y: formatExample.min(1).optional().describe("Format-by-example for y values, such as '0%'."),
      })
      .optional()
      .describe("Per-axis format-by-example, each falling back to format: { x: '$0', y: '0%' } prints the cost ticks as $2 and the score ticks as 60%. Tick labels, point values, hover values, zone, clamp and quadrant text and the accessible description use the format of the coordinate's axis; bubble sizes keep format."),
    valueAxis: narrowValueAxis('scatter', valueAxisSchema
      .safeExtend({
        clamp: scatterClampSchema.optional().describe('Cap one or both axes and draw the points beyond the cap at the edge as open markers, with a derived footnote counting them.'),
      }))
      .optional()
      .describe('Value-axis display and domain settings. min and max widen the vertical domain so nothing is cut off; clamp is the opposite and caps it on purpose.'),
    minCount: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe('Drop points whose points[].count is below this threshold, with a derived footnote counting them. Refused when the points carry no count.'),
    labels: z
      .union([
        z.literal(false).describe('Suppress the point names and values.'),
        z
          .object({
            value: z
              .boolean()
              .optional()
              .describe("true prints each point's value: the size on a bubble chart, y otherwise. It sits inside a bubble it fits with a contrasting ink, otherwise beside its point, and the name moves beside the bubble. Default false."),
          })
          .catchall(z.union([z.boolean(), z.array(z.string())]))
          .describe("Per-kind label settings: point is the point name (false hides it), value the point's value."),
      ])
      .optional()
      .describe("Point labels. Names print by default; labels.value adds each point's value. false turns both off."),
    sizeBy: z.enum(['area', 'diameter']).optional().describe("Map bubble magnitude to area by default, or to diameter."),
    maxPointLabels: z.number().int().positive().optional().describe("Maximum number of point labels considered by the label solver; defaults to 300."),
    quadrants: quadrantOptionsSchema.optional().describe("Two-by-two classification with explicitly declared axis cut points; cannot be combined with zones."),
    zones: zonesSchema.optional().describe("Authored grid or polygon classifications; cannot be combined with quadrants."),
    trend: z
      .union([
        z.boolean(),
        z.strictObject({
          groups: z
            .union([z.enum(['all', 'each']), z.array(idSchema).min(1)])
            .optional()
            .describe("Which points one fit runs over: all (default) for one line, each for one line per group in its colour, or a list of group ids for those groups."),
          label: z.string().min(1).optional().describe("Authored text at an end of the first trend line (the right end first, clear of the points), such as 'Linear trend'. It also names the line's key entry."),
        }),
      ])
      .optional()
      .describe(
        "Linear trend line: an ordinary least squares fit over the drawn points, dashed across the fitted x range only, under the points and clipped to the plot. Slope, intercept and r² go into the claim records (reading.derived); the key entry of each line prints its slope and r², and the plot prints no equation. A fit over fewer than 3 points or points that share one x is left out with trend-undefined. The fit is in the values on any scale, so on a log axis the line is drawn as the curve it makes there.",
      ),
    frontier: z
      .strictObject({
        x: z.enum(['min', 'max']).describe("Which x is better: min for lower (a cost), max for higher."),
        y: z.enum(['min', 'max']).describe("Which y is better: max for higher (a score), min for lower."),
        label: z.string().min(1).optional().describe("Key label of the line; default 'Pareto line'."),
        extend: z.boolean().optional().describe("Run the line a short way past its first and last point, in the direction of the end segments, clipped to the plot. Default false."),
        groups: z
          .union([z.literal('all'), z.array(idSchema).min(1)])
          .optional()
          .describe("Points the frontier runs over: all drawn points (default) or the drawn points of the listed groups, as one line."),
      })
      .optional()
      .describe(
        "Pareto line: the engine keeps every drawn point that no other point beats on both axes (at least as good on both and better on one; exact ties both stay) and draws a dotted ink line through them in x order, under the points. Keyed in the legend row with its dotted stroke; point labels keep off it and cross it only on a halo. geometry.derived.frontier lists the point ids. A frontier of one point draws no line and warns frontier-single-point; a listed group without drawn points warns frontier-group-empty.",
      ),
    sizeLegend: z
      .union([
        z.boolean(),
        z.strictObject({
          values: z.array(z.number().finite().positive()).min(1).max(3).optional().describe("Sizes the key circles show, largest drawn outermost; default round sizes from the data range: the largest in the data range and one half of it or less, none below the smallest bubble. Rings are drawn at the plot's scale and the key row grows to fit them; a ring is at most one eighth of the card height across. A size above the largest bubble is left out with size-legend-value-out-of-range, and with none left the key shows the defaults; a size below the smallest bubble is drawn at scale and named in an info."),
          label: z.string().min(1).optional().describe("Name of the size measure above the key, such as 'Revenue, €bn'."),
        }),
      ])
      .optional()
      .describe(
        "Bubble size key: nested circles sharing one bottom tangent, each value printed at the top of its circle, inside the plot in the first corner (bottom-right, top-right, bottom-left, top-left) that no bubble touches; with none free it sits bottom-right and warns size-legend-overlaps-points. Drawn by default whenever a point carries a positive size; false turns it off. Refused when no point carries a size. A key larger than the plot is not drawn and warns size-legend-no-room. Without label an info lint size-legend-unnamed asks for the measure's name. legend: 'none' also drops this key and warns legend-off; set legend to a value that shows it, or set sizeLegend: false to drop it on purpose.",
      ),
    qualitativeAxes: z
      .boolean()
      .optional()
      .describe(
        "Axes that read as directions, not scales: no tick numbers and no gridlines; each axis prints strings.axisLow ('Lower') and strings.axisHigh ('Higher') at its ends and its title in bold between two arrows, the y axis in a column left of the plot. Needs axisTitles. Positions keep their numeric scale.",
      ),
    methodNote: z
      .boolean()
      .optional()
      .describe(
        'Default false. true adds the method footnotes: axes that do not start at zero, and for quadrants the cut points with their source, the tie rule, the shading, units on a cut point, empty boxes and a divider that falls outside the range. Clipped and dropped points are required for interpretation and print regardless.',
      ),
  })
  .superRefine((options, ctx) => {
    if (options.quadrants && options.zones) {
      ctx.addIssue({
        code: 'custom',
        path: ['zones'],
        message: 'options.zones and options.quadrants are mutually exclusive — two competing classifications cannot share one scatter plot',
      });
    }
  }) as unknown as z.ZodType<ScatterStrategyOptions>;
