import { isMetricStackData } from './metricStack';
import { metricStackDataSchema, metricStackOptionsSchema } from './metricStackSchema';
export { metricStackDataSchema } from './metricStackSchema';
import * as z from 'zod';
import { ownedDocumentCopy } from '../../doc/docExpand';
import { getChartSchemas } from '../../registry';
import { GRID_MAX_TRACKS } from './limits';
import {
  addDuplicateIdIssues,
  baseOptionsSchema,
  refusedBaseOptions,
} from '../../schema/shared';
import {
  normalizeGridData,
  type ExplicitGridData,
  type GridLayoutOptions,
  type RepeatGridData,
} from './normalize';
export * from './normalize';

const panelSchema = z
  .strictObject({
    id: z.string().min(1).describe('Stable panel identifier.'),
    type: z.string().min(1).describe('Registered chart type rendered in this panel.'),
    title: z.string().min(1).optional().describe('Short heading in the fixed slot above the panel.'),
    caption: z.string().min(1).optional().describe('Secondary line below the panel title.'),
    data: z.unknown().describe('Data accepted by the registered panel chart type.'),
    options: z.record(z.string().describe('Option name accepted by the child chart type.'), z.unknown().describe('Value validated by the child chart options schema.')).optional().describe('Options forwarded to the child chart; inherited grid options follow the composition rules.'),
    annotations: z
      .array(z.unknown().describe('Annotation validated against the child chart type.'))
      .optional()
      .describe(
        'Chart-panel annotations, folded into the child options verbatim; validated against the child chart type\'s own options schema (issues at this authored path). Composition panels (text/legend) take none.',
      ),
    row: z.number().int().nonnegative().max(GRID_MAX_TRACKS - 1).optional().describe('Zero-based authored row track; omitted, panels fill the rows left to right in array order.'),
    column: z.number().int().nonnegative().max(GRID_MAX_TRACKS - 1).optional().describe('Zero-based authored column track; omitted, panels fill the rows left to right in array order.'),
    span: z
      .strictObject({
        rows: z.number().int().positive().max(GRID_MAX_TRACKS).optional().describe('Number of row tracks occupied by the panel.'),
        columns: z.number().int().positive().max(GRID_MAX_TRACKS).optional().describe('Number of column tracks occupied by the panel.'),
      })
      .optional()
      .describe('Number of authored row/column tracks occupied by this panel.'),
    align: z
      .strictObject({
        horizontal: z.enum(['stretch', 'start', 'center', 'end']).optional().describe('Horizontal placement inside the spanned cell.'),
        vertical: z.enum(['stretch', 'start', 'center', 'end']).optional().describe('Vertical placement inside the spanned cell.'),
        width: z.number().positive().optional().describe('Width cap in pixels for a horizontally non-stretched panel.'),
        height: z.number().positive().optional().describe('Height cap in pixels for a vertically non-stretched panel.'),
      })
      .optional()
      .describe('Alignment inside the spanned cell; width/height cap non-stretch panels.'),
  })
  .superRefine((panel, ctx) => addPanelDataIssues(panel.type, panel.data, ctx, ['data']))
  .describe('One explicitly authored grid panel.');

/**
 * Text and legend panels have no registered chart definition, so their data
 * is validated here — for explicit panels via panelSchema, for repeat
 * templates via the grid wrapper schema after slice expansion.
 */
export function addPanelDataIssues(
  type: string,
  data: unknown,
  ctx: z.RefinementCtx,
  prefix: readonly PropertyKey[],
): void {
  const schema =
    type === 'text' ? textPanelDataSchema : type === 'legend' ? legendPanelDataSchema : undefined;
  if (!schema) return;
  const result = schema.safeParse(data);
  if (result.success) return;
  result.error.issues.forEach((issue) =>
    ctx.addIssue({ code: 'custom', path: [...prefix, ...issue.path], message: issue.message }),
  );
}

export const textPanelDataSchema = z
  .strictObject({
    title: z.string().min(1).optional().describe('Heading within the text panel.'),
    body: z.string().min(1).optional().describe('Main prose within the text panel.'),
    bullets: z.array(z.string().min(1).describe('One bullet item.')).min(1).optional().describe('Ordered bullet items within the text panel.'),
    tone: z
      .enum(['message', 'muted'])
      .optional()
      .describe('message paints the title with theme ink and body with inkMuted; muted uses inkMuted for every line.'),
  })
  .refine((data) => data.title !== undefined || data.body !== undefined || data.bullets !== undefined, {
    message: 'text panel requires at least one of title, body, or bullets',
  }).describe('Authored text panel with at least one heading, body or bullet list.');

export const legendPanelDataSchema = z.strictObject({
  from: z.array(z.string().min(1).describe('Id of a source chart panel.')).min(1).optional().describe('Panel ids whose legend entries are collected; omission uses the grid chart panels.'),
}).describe('Composition panel collecting legends from chart panels.');

const explicitGridSchema = z.strictObject({
  panels: z.array(panelSchema).min(1).describe('Panels in deterministic reading order.'),
}).describe('Grid with explicitly authored panels.');

const repeatTemplateSchema = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .optional()
      .describe('Panel id template; defaults to the slice value and may contain the dimension placeholder.'),
    type: z.string().min(1).describe('Registered chart type repeated for every slice.'),
    title: z.string().min(1).optional().describe('Panel title template; may contain the dimension placeholder.'),
    caption: z.string().min(1).optional().describe('Panel caption template; may contain the dimension placeholder.'),
    data: z
      .union([
        z
          .strictObject({
            bySlice: z
              .record(z.string().describe('Exact repeat value used as the lookup key.'), z.unknown().describe('Data for one slice, validated by the template chart type.'))
              .describe('Exact slice lookup; every repeat value must have one chart-data entry.'),
          })
          .describe('Facet data keyed by repeat value.'),
        z
          .strictObject({
            categories: z
              .array(z.unknown().describe('Category row copied or sliced into each panel.'))
              .min(1)
              .describe('Source categories; category facets keep one id per panel.'),
            series: z
              .array(z.unknown().describe('Series row copied or sliced into each panel.'))
              .min(1)
              .describe('Source series; series facets keep one plotted id per panel and copy reference series onto every panel.'),
          })
          .describe('One chart document sliced by repeat.facet into panels.'),
      ])
      .describe('bySlice lookup, or one chart document when repeat.facet is series or category.'),
    options: z.record(z.string().describe('Option name accepted by the child chart type.'), z.unknown().describe('Value validated by the child chart options schema.')).optional().describe('Options forwarded to the child chart; inherited grid options follow the composition rules.'),
    annotations: z
      .array(z.unknown().describe('Annotation validated against the child chart type.'))
      .optional()
      .describe(
        'Template annotations, placeholder-substituted per slice and validated against the child chart type\'s own options schema (issues at template.annotations).',
      ),
  })
  .describe('Chart specification expanded once per repeat value.');

const repeatGridSchema = z
  .strictObject({
    repeat: z
      .strictObject({
        dimension: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/)
          .describe('Placeholder name; use it as $dimension in template strings.'),
        values: z.array(z.string().min(1).describe('Unique facet value used for lookup and placeholder substitution.')).min(1).describe('Ordered facet values to bind.'),
        facet: z
          .enum(['series', 'category'])
          .optional()
          .describe('Slice template.data into one panel per series or category id. Omission keeps the conservative bySlice lookup.'),
      })
      .describe('Conservative v0 facet repeat declaration.'),
    template: repeatTemplateSchema,
    message: textPanelDataSchema
      .optional()
      .describe('Highlighted commentary panel appended after the faceted charts. Title uses theme ink; body and bullets use inkMuted.'),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    const by = input.repeat.facet;
    const source = input.template.data;
    if (by && isBySliceData(source)) {
      ctx.addIssue({
        code: 'custom',
        path: ['template', 'data'],
        message: `repeat.facet '${by}' needs template.data.categories and template.data.series, not bySlice`,
      });
      return;
    }
    input.repeat.values.forEach((value, index) => {
      if (seen.has(value)) {
        ctx.addIssue({ code: 'custom', path: ['repeat', 'values', index], message: `duplicate repeat value '${value}'` });
      }
      seen.add(value);
      // z.record's parsed copy cannot carry an own '__proto__' key — plain
      // assignment would rewire the prototype instead — so the slice vanishes
      // between schema and layout even when the author genuinely owns it.
      // Refuse the name honestly instead of claiming the slice is missing.
      if (value === '__proto__') {
        ctx.addIssue({
          code: 'custom',
          path: ['repeat', 'values', index],
          message: `repeat value '__proto__' is reserved (object prototype key) — rename the slice`,
        });
        return;
      }
      if (by) {
        addFacetValueIssues(ctx, by, source, value, index);
        return;
      }
      // Object.hasOwn, not `in`: a slice key like 'toString' or 'constructor'
      // answers `in` via the prototype chain and would validate as present
      if (!isBySliceData(source) || !Object.hasOwn(source.bySlice, value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['template', 'data', 'bySlice', value],
          message: `missing data slice for repeat value '${value}'`,
        });
      }
    });
  })
  .describe('Facet shorthand expanded to explicit panels before layout.');

function isBySliceData(data: unknown): data is { bySlice: Record<string, unknown> } {
  return data !== null && typeof data === 'object' && Object.hasOwn(data, 'bySlice');
}

function addFacetValueIssues(
  ctx: z.RefinementCtx,
  by: 'series' | 'category',
  source: unknown,
  value: string,
  index: number,
): void {
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.hasOwn(source, 'bySlice')) {
    ctx.addIssue({
      code: 'custom',
      path: ['template', 'data'],
      message: `repeat.facet '${by}' needs template.data.categories and template.data.series, not bySlice`,
    });
    return;
  }
  const list = by === 'series'
    ? (source as { series?: unknown }).series
    : (source as { categories?: unknown }).categories;
  if (!Array.isArray(list)) {
    ctx.addIssue({
      code: 'custom',
      path: ['template', 'data', by],
      message: `repeat.facet '${by}' needs template.data.${by}`,
    });
    return;
  }
  const match = list.find((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry) && (entry as { id?: unknown }).id === value) as
    | { id?: unknown; role?: unknown }
    | undefined;
  if (!match) {
    ctx.addIssue({
      code: 'custom',
      path: ['repeat', 'values', index],
      message: `missing ${by} '${value}' in template.data`,
    });
    return;
  }
  if (by === 'series' && match.role === 'reference') {
    ctx.addIssue({
      code: 'custom',
      path: ['repeat', 'values', index],
      message: `reference series '${value}' cannot be a series facet — pick a plotted series`,
    });
  }
}

const baseGridDataSchema = z
  .union([explicitGridSchema, repeatGridSchema, metricStackDataSchema])
  .describe('Grid data: explicit panels, bySlice repeat, repeat.facet small multiples, or metric stacks with shared measures and categories.');

const refinedGridSchema = baseGridDataSchema.superRefine((data, ctx) => {
  // zod 4 runs this refine even when the base union failed, as long as its
  // issues are continuable (a stray text-panel key, a missing bySlice slice).
  // Those issues already refuse the document, and normalizeGridData would
  // throw re-parsing it — straight out of safeParse — so stand down and let
  // them stand. ctx.issues carries the base parse's issues at this point.
  if (ctx.issues.length > 0 || isMetricStackData(data)) return;
  // Object.hasOwn, not `in`: with a polluted Object.prototype.panels a repeat
  // doc answers `in` as explicit, which silently skips child forwarding or
  // throws off normalized.panels — both break safeParse's contract.
  const explicit = Object.hasOwn(data, 'panels');
  // zod itself checks required keys with `key in input`, so a prototype
  // gadget can satisfy the explicit branch for a document that owns neither
  // key — and when the gadget is non-writable, zod's output owns neither
  // either, leaving no branch to stand on. Refuse instead of guessing. The
  // exported gridDataSchema also refuses this state pre-parse (the pipe stage
  // below); this post-parse twin keeps refinedGridSchema safe standalone.
  if (!explicit && !Object.hasOwn(data, 'repeat')) {
    ctx.addIssue({
      code: 'custom',
      path: ['panels'],
      message: "grid data must own 'panels' or 'repeat' — inherited properties do not count",
    });
    return;
  }
  const normalized = normalizeGridData(data);
  const repeat = explicit ? undefined : (data as RepeatGridData);
  const facetBy = repeat?.repeat.facet;
  const panels = normalized.panels.map((panel, panelIndex) => ({
    id: panel.id,
    issuePath: explicit
      ? ['panels', panelIndex, 'id']
      : panel.id === 'message' && panel.type === 'text'
        ? ['message']
        : ['repeat', 'values', Math.min(panelIndex, (repeat?.repeat.values.length ?? 1) - 1)],
  }));
  addDuplicateIdIssues(ctx, panels, [], {
    name: 'panel',
    keys: 'panel layout and scene identities',
  });

  // Every child-schema refusal forwards, and it forwards the child's issue
  // OBJECT, not a custom copy of its message: the layout path hands panel.data
  // to the child layout unparsed, so refusals that exist only in the child's
  // dataSchema (magnitude bounds, shape errors) have no later enforcement
  // point, and the CLI's flattenIssues/enrichment read `code`/`errors` off the
  // issue itself — a custom wrapper would strip the union structure they need.
  normalized.panels.forEach((panel, panelIndex) => {
    const prefix: PropertyKey[] = explicit
      ? ['panels', panelIndex, 'data']
      : panel.id === 'message' && panel.type === 'text'
        ? ['message']
        : facetBy
          ? ['template', 'data']
          : ['template', 'data', 'bySlice', (data as RepeatGridData).repeat.values[panelIndex]!];
    // text/legend panels have no registered chart, so repeat-expanded slices
    // are validated here; explicit panels get the same check in panelSchema
    if (!explicit) addPanelDataIssues(panel.type, panel.data, ctx, prefix);
    const definition = getChartSchemas(panel.type);
    if (!definition) return;
    const dataSchema = definition.type === 'grid' && panel.options && Object.hasOwn(panel.options, 'stack')
      ? metricStackDataSchema : definition.dataSchema;
    const result = dataSchema.safeParse(panel.data);
    if (result.success) return;
    result.error.issues.forEach((issue) => {
      ctx.addIssue({
        ...issue,
        path: [...prefix, ...issue.path],
      } as z.core.$ZodRawIssue);
    });
  });

  // Panel OPTIONS parse against the child's optionsSchema, the authority
  // standalone validate reads, so a composed `transpose: true` meets the same
  // capability sentence it meets standalone instead of ok:true. Repeat grids judge every
  // NORMALIZED panel, the object the layout consumes, so placeholder
  // substitution and the injected scaleGroup pair are already applied; the
  // per-slice repeats of one template issue dedupe onto the authored path.
  if (explicit) {
    (data as ExplicitGridData).panels.forEach((panel, panelIndex) => {
      forwardPanelOptionIssues(ctx, panel.type, panel.options, ['panels', panelIndex, 'options']);
      forwardPanelAnnotationIssues(ctx, panel.type, panel, ['panels', panelIndex, 'annotations']);
    });
  } else {
    const seen = new Set<string>();
    normalized.panels.forEach((panel) => {
      forwardPanelOptionIssues(ctx, panel.type, panel.options, ['template', 'options'], seen);
      forwardPanelAnnotationIssues(ctx, panel.type, panel, ['template', 'annotations'], seen);
    });
  }
});

// Ownership is enforced on the RAW input, ahead of the parse: zod's
// required-key presence test reads `key in input`, so a branch key visible
// only through a polluted prototype chain would let the parse consume — with
// a writable gadget even materialize — inherited data as document content.
// The pipe stage refuses that before zod reads anything. Its price would be
// the published input schema (a pipe serializes io:'input' as the empty {}),
// which the .meta() call pays back: toJSONSchema emits the attached metadata,
// byte-identical to the refined schema's own serialization. The metadata is
// draft-2020-12 shaped and wins over a caller's `target` option; every
// repository caller publishes with the defaults.
const publishedGridSchema = (() => {
  // This serialization itself assigns 'panels'/'repeat' keys onto fresh
  // objects, so under a non-writable prototype gadget it throws — at module
  // import, ahead of any CLI envelope. Degrade to publishing without the
  // metadata instead of crashing: in that state the pipe guard still refuses
  // every gadget document.
  try {
    return z.toJSONSchema(refinedGridSchema, { io: 'input' }) as z.core.GlobalMeta;
  } catch {
    return undefined;
  }
})();
const pipedGridSchema = z
  .unknown()
  .superRefine((raw, ctx) => {
    if (raw === null || typeof raw !== 'object') return;
    // Panel/template ANNOTATIONS get the same pre-parse ownership test as
    // the branch keys below: zod's optional-key read materializes an
    // inherited `annotations` gadget into the parse OUTPUT as an own key, so
    // the post-parse sweep would judge environment data as authored. Refuse it
    // out loud instead.
    const ownAnnotationsIssue = (holder: unknown, path: PropertyKey[]): void => {
      if (holder === null || typeof holder !== 'object') return;
      if ('annotations' in holder && !Object.hasOwn(holder, 'annotations')) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: "panel annotations must be own properties — inherited properties do not count",
        });
      }
    };
    if (Object.hasOwn(raw, 'panels')) {
      const panels = (raw as { panels: unknown }).panels;
      if (Array.isArray(panels)) {
        panels.forEach((panel, index) => ownAnnotationsIssue(panel, ['panels', index, 'annotations']));
      }
    }
    if (Object.hasOwn(raw, 'template')) {
      ownAnnotationsIssue((raw as { template: unknown }).template, ['template', 'annotations']);
    }
    if (Object.hasOwn(raw, 'panels') || Object.hasOwn(raw, 'repeat')) return;
    if ('panels' in raw || 'repeat' in raw) {
      ctx.addIssue({
        code: 'custom',
        path: ['panels'],
        message: "grid data must own 'panels' or 'repeat' — inherited properties do not count",
      });
    }
  })
  .pipe(refinedGridSchema);
export const gridDataSchema = publishedGridSchema
  ? pipedGridSchema.meta(publishedGridSchema)
  : pipedGridSchema;

/**
 * A panel margin judgment the grid overrides: addCanvasBoundsIssues sizes the
 * check to the standalone DEFAULT canvas, but layoutAuthoredChild always hands
 * the panel its slot size, so the standalone bound is not the panel's truth.
 * Dropped from the schema forwarding here; the CLI sweep judges stripped
 * KEYS only and never re-judges option values.
 */
export function isPanelSlotSizedIssue(issue: { path: PropertyKey[]; message: string }): boolean {
  const margin = issue.path[0] === 'margin' ||
    (issue.path[0] === 'canvas' && issue.path[1] === 'margin');
  return margin && issue.message.includes('must leave at least');
}

// Issues forward as the child's issue OBJECT under a prefixed path; the CLI's
// flattenIssues reads `code`/`errors` off the issue itself, and a custom copy
// would strip the union structure it needs. Composition panels ('text',
// 'legend') have no registered chart and are skipped like their data is.
function forwardPanelOptionIssues(
  ctx: z.RefinementCtx,
  type: string,
  options: Record<string, unknown> | undefined,
  prefix: PropertyKey[],
  seen?: Set<string>,
): void {
  const definition = getChartSchemas(type);
  if (!definition) return;
  // ownedDocumentCopy: this parse must judge the AUTHORED keys only — an
  // ordinary object (or {} fallback) would answer absent keys from a
  // polluted prototype chain and refuse or accept off environment data.
  const result = definition.optionsSchema.safeParse(ownedDocumentCopy(options ?? {}));
  if (result.success) return;
  result.error.issues.forEach((issue) => {
    if (isPanelSlotSizedIssue(issue)) return;
    if (seen) {
      const key = `${issue.path.join('.')}|${issue.message}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    ctx.addIssue({
      ...issue,
      path: [...prefix, ...issue.path],
    } as z.core.$ZodRawIssue);
  });
}

/**
 * Panel ANNOTATIONS parse against the CHILD's optionsSchema — the same
 * authority the options forwarding reads — because the layout folds
 * `panel.annotations` into the child's options verbatim, and a chart may
 * narrow the shared annotation schema for itself (line refuses a bad event
 * `labelPlacement`; the generic schema would wave it through). The parse judges the MERGED object the child actually receives
 * (options + annotations, panel.annotations winning like the layout fold),
 * and forwards only the issues under 'annotations', remapped to the AUTHORED
 * path (panels.n.annotations…) — everything else is the options forwarding's
 * report. Without it, a panel authoring `annotations[0].mode:'pctOf100'`
 * would validate ok:true while the standalone twin refuses it.
 */
function forwardPanelAnnotationIssues(
  ctx: z.RefinementCtx,
  type: string,
  panel: { options?: Record<string, unknown>; annotations?: unknown[] },
  prefix: PropertyKey[],
  seen?: Set<string>,
): void {
  // Object.hasOwn, not a plain read: zod's parse output is an ordinary
  // object, so an absent key would otherwise answer from a polluted
  // prototype chain and this sweep would judge environment data as authored
  // (the 'toString' precedent in the options sweep).
  if (!Object.hasOwn(panel, 'annotations') || panel.annotations === undefined) return;
  const annotations = panel.annotations;
  const definition = getChartSchemas(type);
  if (!definition) {
    // Composition panels (text/legend) render no annotation pass at all, so
    // an authored array would be a silent no-op — refused, unlike
    // their OPTIONS, which the CLI sweep demotes to a warning.
    ctx.addIssue({
      code: 'custom',
      path: [...prefix],
      message: `'${type}' composition panels take no annotations — anchor them on a chart panel instead`,
    });
    return;
  }
  const merged = ownedDocumentCopy({ ...(panel.options ?? {}), annotations });
  const parsed = definition.optionsSchema.safeParse(merged);
  if (parsed.success) return;
  const result = {
    error: {
      issues: parsed.error.issues
        .filter((issue) => issue.path[0] === 'annotations')
        .map((issue) => ({ ...issue, path: issue.path.slice(1) })),
    },
  };
  if (result.error.issues.length === 0) return;
  result.error.issues.forEach((issue) => {
    if (seen) {
      const key = `${prefix.join('.')}.${issue.path.join('.')}|${issue.message}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    ctx.addIssue({
      ...issue,
      path: [...prefix, ...issue.path],
    } as z.core.$ZodRawIssue);
  });
}

const gapSchema = z.union([
  z.number().nonnegative().describe('Uniform gap in layout pixels between adjacent tracks.'),
  z.array(z.number().nonnegative().describe('Gap in layout pixels between this pair of adjacent tracks.')).describe('Ordered gaps, exactly one fewer than the number of tracks.'),
]).describe('A uniform gap or one gap for each adjacent pair of tracks.');
const trackScopeSchema = z.enum(['row', 'column', 'all']).describe('Apply alignment within each row, within each column, or across all panels.');

export const gridOptionsSchema = baseOptionsSchema
  .safeExtend(refusedBaseOptions('grid'))
  .safeExtend({
    stack: metricStackOptionsSchema.optional(),
    columns: z
      .union([z.number().int().positive().max(GRID_MAX_TRACKS), z.array(z.number().positive()).min(1).max(GRID_MAX_TRACKS)])
      .optional()
      .describe('Legacy facet column count, or authored positive column-track weights. At most 50 rows and columns.'),
    rows: z
      .array(z.number().positive())
      .min(1)
      .max(GRID_MAX_TRACKS)
      .optional()
      .describe('Positive row weights override content fitting. Omitted: content-fit rows use their natural height; other rows share the rest. Without columns, the row count sets placement. With category sharing, rows[i] follows panels[i] in bottom-up order; metric stacks use top-down order.'),
    gutters: z
      .strictObject({
        rows: gapSchema.optional().describe('Vertical spacing between row tracks in layout pixels.'),
        columns: gapSchema.optional().describe('Horizontal spacing between column tracks in layout pixels.'),
      })
      .optional()
      .describe('Uniform or per-gap row/column gutters in pixels.'),
    anchors: z
      .strictObject({
        plotEdges: trackScopeSchema.optional().describe('Align panel plot left and right edges within column or all groups. row is accepted but ignored: side-by-side plots do not share x edges.'),
        baselines: trackScopeSchema.optional().describe('Scope for aligning panel numeric baselines vertically.'),
        categories: trackScopeSchema.optional().describe('column and all align plot x edges and category ticks with authored column centers. row is accepted but ignored: side-by-side plots do not share x edges.'),
      })
      .optional()
      .describe('Opt-in shared plot edges, baselines, and category columns by row, column, or all panels.'),
    alignmentRules: z
      .array(
        z.strictObject({
          id: z.string().min(1).describe('Unique guide identifier within this grid.'),
          orientation: z.enum(['horizontal', 'vertical']).describe('Guide direction; baseline anchors require horizontal, plot-edge and category anchors require vertical.'),
          at: z.strictObject({
            panelId: z.string().min(1).describe('Existing panel that supplies the guide coordinate.'),
            anchor: z.enum(['plotLeft', 'plotRight', 'baseline', 'category']).describe('Panel plot edge, numeric baseline, or x-axis category tick used to position the guide.'),
            categoryId: z.string().min(1).optional().describe('Existing x-axis category id; required for a category anchor.'),
          }).describe('Panel anchor that fixes the guide coordinate.'),
          fromPanelId: z.string().min(1).optional().describe('Panel whose top or left slot edge starts the guide; omission uses the grid content edge.'),
          toPanelId: z.string().min(1).optional().describe('Panel whose bottom or right slot edge ends the guide; omission uses the grid content edge.'),
        }).describe('One hairline guide positioned by an existing panel anchor.'),
      )
      .optional()
      .describe('Authored hairline guides bound to a panel plot edge, baseline, or category tick.'),
    sharedAxis: z
      .enum(['category', 'none'])
      .optional()
      .describe('Metric stacks imply category and use top-down order with independent scales. Otherwise default: category only for exactly one column panel plus one or more variance panels (no integrated variance); none otherwise. none honours columns and array order. category uses one column in bottom-up order with the category-axis owner at the bottom; it warns if columns or panelOrder are overridden. These column/variance tiers use 4:1 plot heights unless authored tracks or a shared y scale apply.'),
    sharedScale: z
      .boolean()
      .optional()
      .describe(
        "Default: panels share one y scale in every sharedAxis mode only with evidence that they show one measure: every numeric panel names the same non-empty unit and format, the grid names a unit, or the panels come from repeat or a scaleGroup. Without that evidence each panel keeps its own scale, also when all panels are the same chart type. Set true to share panels without a unit, false for independent panel domains. Metric stacks always use independent zero scales and refuse true.",
      ),
    panelOrder: z
      .enum(['sheet', 'lastDesc', 'lastAsc', 'totalDesc', 'totalAsc'])
      .optional()
      .describe(
        "Facet panel order: 'sheet' keeps the authored array (default), 'last*' ranks by each panel's final value, 'total*' by its sum. Panels with no measurable value stay last in both directions.",
      ),
    reflow: z
      .boolean()
      .optional()
      .describe(
        "Facets only: a grid of more panels than a numeric columns count, on a card under 480 px, takes columns as a maximum. Where a panel drops category names for room, it draws with fewer columns, down to two, at the largest count that prints every name and that an authored height seats. Default true; false keeps the authored count.",
      ),
  }) as unknown as z.ZodType<GridLayoutOptions>;
