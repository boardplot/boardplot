/**
 * Shared zod schemas. Types, runtime validation, and the
 * published JSON Schema all derive from these definitions.
 */

import { categoryLabelsSchema } from './categoryLabels';
import { TEXT_SCALE_RANGE, TEXT_SIZE_RANGE, toLayoutPx } from '../target';
import { SIZE_PRESETS } from '../types/options';
import { formatExampleProblem } from '../formatSpec';
// A direct namespace import lets bundlers drop unused Zod APIs and locales.
// The named `z` namespace alias keeps those exports in the browser bundle.
import * as z from 'zod';
import { ownedDocumentCopy } from '../doc/docExpand';
import {
  MAGNITUDE_CEILING,
  canonicalLanguage,
  magnitudeMessage,
  NormalizeError,
  resolveCanvasOptions,
  resolveSize,
} from '../normalize/shared';
import { parseFormatExample, specUnitKind } from '../formatSpec';
import { isIconName, listIcons } from '../icons';
import { SIDE_KEY_REFUSED } from './refusals';
import { LEGEND_DRAWS, LEGEND_REFUSED, OPTION_CAPABILITY, legendDrawsNothing, valueAxisOnly, valueAxisRefusal } from './capability';
import {
  LEGEND_DRAWS_REASONS, LEGEND_REFUSED_REASONS, OPTION_REASONS, TRANSPOSE_REFUSED, VALUE_AXIS_ONLY_REASONS, notImplemented, valueAxisReason,
} from './capabilityReasons';
// The tables live without zod so the React entries can read them (capability.ts).
export { OPTION_CAPABILITY, VALUE_AXIS_CAPABILITY, valueAxisOnly } from './capability';
import { parseISODate } from '../isoDate';
import { parseTimeText } from '../isoTime';
import { levenshtein } from '../spelling';
import type { BaseOptions } from '../types/options';
import { emptyIdRecord } from '../idRecords';

const annotationIconNames = listIcons();
const annotationIconSchema = z
  .string()
  .superRefine((name, ctx) => {
    if (!isIconName(name)) {
      ctx.addIssue({
        code: 'custom',
        message: `unknown annotation icon '${name}' — valid icons: ${annotationIconNames.join(', ')}`,
      });
    }
  })
  .describe('Registered icon name for a note or callout glyph; mutually exclusive with status.');
z.globalRegistry.add(annotationIconSchema, { enum: annotationIconNames, description: annotationIconSchema.description });

export const idSchema = z.string().min(1).describe('Nonempty stable identifier used to match data, labels and annotation anchors.');

// z.record skips an own `__proto__` key, so the key crosses the parse under a stand-in.
const PROTO_KEY_STAND_IN = '__proto__\u200b';

/**
 * A record keyed by data ids (category, series, column, slice). Every id is a
 * key, `__proto__` included, and the parsed record has no prototype: an id
 * such as `constructor` that the record lacks reads as absent, not as the
 * inherited function.
 */
export function idRecord<V extends z.ZodType>(key: z.ZodString, value: V) {
  return z.preprocess((raw, ctx) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Object.hasOwn(raw, '__proto__') || Object.hasOwn(raw, PROTO_KEY_STAND_IN)) return raw;
    const renamed: Record<string, unknown> = emptyIdRecord();
    for (const [name, item] of Object.entries(raw)) {
      if (name !== '__proto__') { renamed[name] = item; continue; }
      // Checked here, so an issue names the key as authored and not the stand-in.
      const checked = value.safeParse(item);
      if (checked.success) renamed[PROTO_KEY_STAND_IN] = item;
      else for (const issue of checked.error.issues) ctx.addIssue({ ...issue, path: ['__proto__', ...issue.path] } as z.core.$ZodRawIssue);
    }
    return renamed;
  }, z.record(key, value)).transform((parsed) => {
    // z.record built a fresh object: drop its prototype in place, and copy only to put a stand-in back.
    if (!Object.hasOwn(parsed, PROTO_KEY_STAND_IN)) return Object.setPrototypeOf(parsed, null) as Record<string, z.output<V>>;
    const record: Record<string, z.output<V>> = emptyIdRecord();
    for (const [name, item] of Object.entries(parsed)) record[name === PROTO_KEY_STAND_IN ? '__proto__' : name] = item;
    return record;
  // A preprocess reads as optional input; the record stays required unless the caller adds .optional().
  }).nonoptional();
}

/**
 * A category date on a chart that spaces its axis by time. parseISODate reads
 * yyyy-mm-dd only; any other spelling passed here and then dropped the time
 * axis for every category without a word.
 */
export const categoryDateSchema = z.string().refine((date) => parseISODate(date) !== null, { message: 'a category date is an ISO date, yyyy-mm-dd, such as 2024-01-31' });
/** A category whose period is still running. */
export const partialCategorySchema = z.boolean().optional().describe('Period still running, such as the current week. Bars and segments on it are hatched and line markers on it are hollow; marks keep their positions. A drawn key names the running category once as "<label> to date". With no such key, the frame adds that note.');

/**
 * A category: an id string, or an object with id, label, date, the type's
 * own `fields`, footnote and `after`, in that key order. A type passes
 * `label` or `footnote` only where its wording differs.
 */
export function categorySchemaOf(spec: {
  /** The id shorthand refuses an empty string. */
  nonEmpty?: boolean;
  label?: z.ZodType;
  date: z.ZodType;
  fields?: z.ZodRawShape;
  footnote?: z.ZodType;
  after?: z.ZodRawShape;
}) {
  return z.union([
    spec.nonEmpty ? z.string().min(1) : z.string(),
    z.strictObject({
      id: idSchema.describe("Category identity used to match keyed values and annotation anchors."),
      label: spec.label ?? z.string().optional().describe("Displayed category name; defaults to the category id and supports line breaks. A date id or `date` without a label prints a short date such as '4 Sep'."),
      date: spec.date,
      ...spec.fields,
      footnote: spec.footnote ?? z.number().int().optional().describe("1-based reference into options.footnotes. The number is drawn beside this category label as the reference mark, and the note it points at keeps that number; a reference to no note draws nothing and warns, and notes the engine derives print unnumbered."),
      ...spec.after,
    }),
  ]);
}

/**
 * A theme colour role (`ColorRole` in types/cell.ts). The pattern is the same
 * set the SVG paint check accepts for these names, so a spec that validates
 * also renders (an unknown name fails validation, not the render). `series-N` names a ramp step,
 * 1-based: `series-2` is `color.series[1]`. N has at most 15 digits, so it
 * stays a safe integer; a longer one would become Infinity in the resolver.
 */
export const comparisonDirectionSchema = z.enum(['higherIsBetter', 'lowerIsBetter', 'neutral']);

const COLOR_ROLE_PATTERN =
  /^(?:good|bad|warn|neutral|neutralLight|highlight|total|others|series-[1-9]\d{0,14}|status-[A-Za-z0-9][A-Za-z0-9_-]*)$/;
const COLOR_ROLE_VALUES =
  'One of good, bad, warn, neutral, neutralLight, highlight, total, others; series-N for step N of the theme ramp, 1-based (series-2 is color.series[1]); or status-<key> for a theme status colour. A hex colour goes in fill.';

/** `colorRole` field with a type-specific lead sentence and the shared value list. */
export function colorRoleField(lead: string) {
  return z
    .string()
    .regex(COLOR_ROLE_PATTERN, {
      message:
        'colorRole must be a theme colour role: good, bad, warn, neutral, neutralLight, highlight, total, others, series-N (1-based ramp step, series-2 is color.series[1]) or status-<key>; put a hex colour in fill',
    })
    .optional()
    .describe(`${lead} ${COLOR_ROLE_VALUES}`);
}

/**
 * Source identity fields, shared by interaction targets and the label focus.
 * Declaration order follows `OwnerRef`; the empty owner is meaningful for a
 * domain scope, so the nonempty requirement lives on the consumer, not here.
 */
const ownerSchema = z.strictObject({
  seriesId: idSchema.optional().describe('Source series identity.'),
  categoryId: idSchema.optional().describe('Source category identity.'),
  segmentId: idSchema.optional().describe('Source segment identity.'),
  pointId: idSchema.optional().describe('Source point identity.'),
  valueLineId: idSchema.optional().describe('Source value-line identity.'),
  annotationId: idSchema.optional().describe('Source annotation identity.'),
  rowId: idSchema.optional().describe('Source table row identity.'),
  colId: idSchema.optional().describe('Source table column identity.'),
}).describe('Source identity fields; an empty owner addresses the whole domain scope.');

type IdEntry = string | { id: string; issuePath?: readonly PropertyKey[] };

export function addDuplicateIdIssues(
  ctx: z.RefinementCtx,
  entries: readonly IdEntry[],
  pathPrefix: readonly PropertyKey[],
  label: { name: string; keys: string },
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const id = typeof entry === 'string' ? entry : entry.id;
    if (seen.has(id)) {
      const issuePath =
        typeof entry === 'string'
          ? [...pathPrefix, index]
          : [...pathPrefix, ...(entry.issuePath ?? [index, 'id'])];
      ctx.addIssue({
        code: 'custom',
        path: issuePath,
        message: `duplicate ${label.name} id '${id}' — ids key ${label.keys}, so each needs its own`,
      });
    }
    seen.add(id);
  });
}

/**
 * The identity checks of a category/series chart: unique category ids,
 * unique series ids, then one keyed value per category in each series.
 * `between` runs the chart's own series checks after the category and
 * series id checks and before the point checks.
 */
export function addCategorySeriesIdIssues(
  ctx: z.RefinementCtx,
  data: { categories: readonly IdEntry[]; series: readonly { id: string; values: readonly unknown[] }[] },
  between?: () => void,
): void {
  addDuplicateIdIssues(ctx, data.categories, ['categories'], {
    name: 'category',
    keys: 'category values and scene identities',
  });
  addDuplicateIdIssues(ctx, data.series, ['series'], {
    name: 'series',
    keys: 'values, legends and scene identities',
  });
  between?.();
  data.series.forEach((series, seriesIndex) => {
    const points = series.values.flatMap((value, valueIndex) =>
      typeof value === 'object' && value !== null && 'categoryId' in value
        ? [{ id: String(value.categoryId), issuePath: [seriesIndex, 'values', valueIndex, 'categoryId'] }]
        : [],
    );
    addDuplicateIdIssues(ctx, points, ['series'], {
      name: 'point',
      keys: `one category value in series '${series.id}'`,
    });
  });
}

/** The identity checks of a map: unique region ids and unique overlay ids. */
export function addGeoIdIssues(
  data: { regions: readonly IdEntry[]; overlays?: readonly IdEntry[] },
  ctx: z.RefinementCtx,
): void {
  addDuplicateIdIssues(ctx, data.regions, ['regions'], {
    name: 'region',
    keys: 'map values, marks and labels',
  });
  addDuplicateIdIssues(ctx, data.overlays ?? [], ['overlays'], {
    name: 'overlay',
    keys: 'overlay glyphs, labels and scene identities',
  });
}

/**
 * Registry normalize contract: schema-parse but surface failures as
 * NormalizeError {code, path, message, suggest} instead of raw ZodError.
 */
/**
 * safeParse that names environmental interference instead of crashing bare:
 * zod assembles its output on ordinary objects, and a NON-WRITABLE inherited
 * property whose name the document legitimately authors makes that assignment
 * throw from inside the parse. The document may be fine; the runtime is not —
 * say so.
 */
export function diagnosedSafeParse<T>(
  schema: z.ZodType<T>,
  value: unknown,
): ReturnType<z.ZodType<T>['safeParse']> {
  try {
    return schema.safeParse(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `the JavaScript environment defines a conflicting property on Object.prototype and parsing cannot proceed (${error.message}) — run the CLI in a clean Node process`,
      );
    }
    throw error;
  }
}

/**
 * The guarded document parse boundary: the raw value is deep-copied onto
 * null-prototype objects first, so inherited keys can neither satisfy nor
 * fail the schema, then parsed with the environment diagnosis above. Zod's
 * output keeps its normal prototypes — consumers see ordinary objects.
 */
export function parseOwned<T>(
  schema: z.ZodType<T>,
  raw: unknown,
): ReturnType<z.ZodType<T>['safeParse']> {
  return diagnosedSafeParse(schema, ownedDocumentCopy(raw));
}

export function parseData<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = parseOwned(schema, raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.join('.') || '(root)';
  // resolve the offending value: a "12%" string in a value slot gets the
  // pct-cell guidance instead of a bare zod "Invalid input"
  let node: unknown = raw;
  for (const seg of issue?.path ?? []) {
    if (node == null || typeof node !== 'object') break;
    node = (node as Record<string | number, unknown>)[seg as string | number];
  }
  const isPctString = typeof node === 'string' && /^[+\-\s]*[\d.,]+\s*%$/.test(node);
  if (issue?.message.startsWith('range-inverted:')) {
    const rangePath = issue.path
      .slice(0, -1)
      .reduce<string>(
        (joined, segment) =>
          typeof segment === 'number'
            ? `${joined}[${segment}]`
            : joined
              ? `${joined}.${String(segment)}`
              : String(segment),
        '',
      );
    throw new NormalizeError(
      'range-inverted',
      rangePath,
      issue.message,
      'swap low/high or correct the source interval',
    );
  }
  const suggest =
    isPctString || JSON.stringify(raw)?.includes('"percentage"') === true
      ? "use 'pct' for percent cells (50.5 means 50.5%)"
      : undefined;
  throw new NormalizeError('invalid-data', path, issue?.message ?? 'invalid data', suggest);
}

/**
 * A number format-by-example. A spreadsheet code ("#,##0") or a text without
 * a number is refused as invalid-format with the example to write.
 */
const formatField = (withFix: boolean) => z.string().superRefine((value, ctx) => {
  const problem = formatExampleProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem.message, params: { code: 'invalid-format', ...(withFix ? { replaceWith: problem.replacement } : {}) } });
});
export const formatExample = formatField(true);
/**
 * The same check for a field whose context narrows what it takes (an
 * annotation's format, a CAGR or share percent): no replacement is proposed,
 * because a plain example may still be refused there.
 */
export const contextFormatExample = formatField(false);

/** Numeric fraction input uses the existing percentage-cell path. */
export const valueKindSchema = z.literal('fraction').optional()
  .describe('Multiply numbers by 100 into pct cells; explicit pct cells stay in percent units.');

/** The chart-level default for the series `valueKind`. */
export const dataValueKindSchema = valueKindSchema.describe('Default valueKind for all series.');

/** The percent convention every format-by-example follows. */
const PERCENT_FORMAT_UNITS = 'A % example expects values in percent units: 3.53 prints 3.53%, a fraction 0.0353 prints 0.04%.';

/** Every magnitude word parseFormatExample reads (formatSpec.ts MAGNITUDE_SUFFIXES). */
export const MAGNITUDE_WORDS_DOC = "A magnitude after the number divides the raw value: k, thousand, Tsd., Tausend (10³); m, M, mn, mm, million(s), Mio., Million(en) (10⁶); b, B, bn, billion(s), Mrd., Milliarde(n), milliard(s) (10⁹); T glued to the number, tn, trillion(s), Bio., Billionen (10¹²). A value of 1000 or more in a scale rolls up and one that would print as 0 rolls down, in the example's spelling; a German or French chart prints its own words (Mrd., Bio.; Md, Bn).";

/**
 * A scenario field: the codes normalizeScenario accepts lead every field's
 * description, in its first clause, so even compact describe rows show them. The parse keeps the
 * string: codes and aliases match in any case.
 */
export const scenarioField = (meaning: string) =>
  z.string().optional().describe(`AC, PY, PL, FC (or ACT, BUD, FCST).${meaning ? ` ${meaning}` : ''}`);

export const cellMetaSchema = {
  fill: z.string().optional().describe('Authored cell fill colour; overrides the inherited series fill where supported.'),
  format: formatExample.optional().describe('Format-by-example for this value, overriding the series or chart format.'),
  label: z.union([
    z.string().describe('Authored value label; ${value} inserts the formatted value. On a slope it replaces only the value part of the end label and keeps the series name. On a line or combo it draws at that point whatever valueLabels asks of the rest, and replaces the series end label when the point is the series end.'),
    z.literal(false).describe('Suppress the cell label while retaining its value and mark, including the series end label when the cell is the series end.'),
  ]).optional().describe('Cell label override; omission uses the chart label policy.'),
  priority: z.number().optional().describe('Authored label priority used when the solver must choose which labels fit.'),
  scenario: scenarioField('Cell scenario overriding its series.'),
  footnote: z.number().int().optional().describe('Footnote reference kept in the interaction record for this cell; it draws no marker. The reference that draws one is categories[].footnote.'),
};

/** Cell: bare number, null, or exactly one of number/pct/date. */
/**
 * One dead-simple magnitude rule: every
 * numeric cell stays within ±1e15 — a thousand trillion, comfortably above
 * any business series in any unit. Charts are for numbers a reader can
 * reason about; beyond this, the honest fix is rescaling the unit, and the
 * refusal says so. It also keeps every span the scale pipeline computes
 * ~292 orders of magnitude away from Number.MAX_VALUE overflow,
 * closing that door for every contract-valid document.
 */
export { MAGNITUDE_CEILING };
export const boundedNumber = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (Math.abs(value) > MAGNITUDE_CEILING) {
      ctx.addIssue({ code: 'custom', message: magnitudeMessage(value) });
    }
  }).describe('Finite numeric value with absolute magnitude at most 1e15; rescale larger values into a larger unit.');

export const cellSchema = z.union([
  boundedNumber,
  z.null().describe('Missing observation; never interpreted as a numeric zero.'),
  z.strictObject({ number: boundedNumber.describe('Value in the declared series or chart unit.'), ...cellMetaSchema }).describe('Numeric cell with optional per-cell formatting and labels.'),
  z.strictObject({ pct: boundedNumber.describe('Percentage points: 50.5 means 50.5%, not a fractional 0.505.'), ...cellMetaSchema }).describe('Percentage cell with optional per-cell formatting and labels.'),
  z.strictObject({ date: z.string().describe('Date text intended as ISO 8601; this shared schema checks its string type only.') }).describe('Date cell expressed as ISO 8601 text.'),
]).describe('A numeric shorthand, missing value, numeric cell, percentage cell or date cell.');

/** The most details one cell carries, and the longest detail text: a hover card is a few lines, not a record dump. */
export const DETAIL_LIMITS = { fields: 20, text: 200 } as const;

/**
 * Extra facts of one cell that only its hover card and keyboard reading show.
 * Values are data: a number prints through its detailFields format, a text
 * prints as plain text (never markup or a link), null prints as missing.
 */
export const cellDetailsSchema = z.preprocess((raw, ctx) => {
  // A parsed record skips an own `__proto__` key, so it would pass and then vanish from the card.
  if (raw !== null && typeof raw === 'object' && Object.hasOwn(raw, '__proto__')) {
    ctx.addIssue({ code: 'custom', input: raw, message: "'__proto__' cannot name a detail; choose another key" });
  }
  return raw;
}, z.record(
  z.string().min(1).max(64).describe('Detail key; options.detailFields names its label and format.'),
  z.union([
    boundedNumber.describe('Number, printed through the detailFields format of its key.'),
    z.string().max(DETAIL_LIMITS.text).describe(`Text up to ${DETAIL_LIMITS.text} characters, printed as plain text.`),
    z.null().describe('Missing detail, printed as no observation.'),
  ]),
).refine(details => Object.keys(details).length <= DETAIL_LIMITS.fields, { message: `a cell carries at most ${DETAIL_LIMITS.fields} details` }))
  .describe('Extra facts for this value that the chart does not draw: the hover card and the keyboard reading list them after the value, labelled and formatted by options.detailFields. The static SVG draws the same picture with or without them.');

/** The cell of a type that reads details into its hover record (OPTION_CAPABILITY.detailFields). */
export const detailCellSchema = z.union([
  boundedNumber,
  z.null().describe('Missing observation; never interpreted as a numeric zero. It carries no details.'),
  z.strictObject({ number: boundedNumber.describe('Value in the declared series or chart unit.'), ...cellMetaSchema, details: cellDetailsSchema.optional() }).describe('Numeric cell with optional per-cell formatting, labels and hover details.'),
  z.strictObject({ pct: boundedNumber.describe('Percentage points: 50.5 means 50.5%, not a fractional 0.505.'), ...cellMetaSchema, details: cellDetailsSchema.optional() }).describe('Percentage cell with optional per-cell formatting, labels and hover details.'),
  z.strictObject({ date: z.string().describe('Date text intended as ISO 8601; this shared schema checks its string type only.') }).describe('Date cell expressed as ISO 8601 text.'),
]).describe('A numeric shorthand, missing value, numeric cell, percentage cell or date cell.');

/** Label, format and order of the cell details keys. */
export const detailFieldsSchema = z.array(z.strictObject({
  key: z.string().min(1).max(64).describe('The details key in the cells.'),
  label: z.string().trim().min(1).max(80).optional().describe('Label on the hover card; default the key.'),
  format: formatExample.optional().describe('Format-by-example for number details of this key, such as 1,234 or 0.0%.'),
  unit: z.string().min(1).max(16).optional().describe('Unit joined to number details of this key as the marks join it, such as EUR.'),
}).describe('One details key: its label, format and unit.')).max(DETAIL_LIMITS.fields).superRefine((fields, ctx) => {
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    if (seen.has(field.key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: `detailFields repeats key '${field.key}'` });
    seen.add(field.key);
  });
});

const subtitleSchema = z.union([
  z.string().describe('Measure text shorthand; normalized to an object with this measure.'),
  z.object({
    company: z.string().optional().describe('Company or scope text before the measure.'),
    measure: z.string().describe('Measure named by the subtitle; options.unit supplies its unit.'),
    period: z.string().optional().describe('Reporting period text after the measure.'),
    scenarios: z.array(z.string().describe('Scenario text to append, such as AC or FC; arbitrary authored strings are accepted.')).optional().describe('Scenario captions in authored order, printed as their own segment joined with "vs": "… · 6 Jul to 4 Oct · AC vs PL".'),
  }).describe('Structured subtitle with measure and optional company, period and scenarios.'),
]).describe('Visible measure subtitle, authored as text or structured fields.');

const MIN_CANVAS_WIDTH = 100;
/**
 * The lowest height floor a type declares (sparkline 24). At 80 the schema
 * refused what the layouts accept and `measure` reports: a 120 x 28 compact
 * bullet, a 28 px KPI card. Each layout still refuses below its own floor.
 */
const MIN_CANVAS_HEIGHT = 24;
const MIN_PLOT_SIZE = 10;

export function addCanvasBoundsIssues(
  options: Pick<BaseOptions, 'size' | 'margin' | 'canvas' | 'target'>,
  ctx: z.RefinementCtx,
): void {
  if (options.size !== undefined && !sizeSchema.safeParse(options.size).success) return;
  const size = resolveSize(options.size, options.target);
  const margin = resolveCanvasOptions(options).margin ?? {};
  const path = options.canvas?.margin === undefined ? ['margin'] : ['canvas', 'margin'];
  if (size.width - (margin.left ?? 0) - (margin.right ?? 0) < MIN_PLOT_SIZE) {
    ctx.addIssue({
      code: 'custom',
      path,
      message: `left and right margins must leave at least ${MIN_PLOT_SIZE}px of plot width`,
    });
  }
  if (size.height - (margin.top ?? 0) - (margin.bottom ?? 0) < MIN_PLOT_SIZE) {
    ctx.addIssue({
      code: 'custom',
      path,
      message: `top and bottom margins must leave at least ${MIN_PLOT_SIZE}px of plot height`,
    });
  }
}

export const renderTargetSchema = z.enum(['report', 'dashboard', 'slide', 'print'])
  .describe('Reading context. Default report.');

const textScaleSchema = z.number().min(TEXT_SCALE_RANGE.min).max(TEXT_SCALE_RANGE.max)
  .describe('Text scale; 1 (default) keeps the target sizes, 1.25 sets every text 25 % larger, from 0.5 to 2.5. It scales the width-class size; textSize gives equal text across charts. A factor under 1 stops each text at the target floor.');

const textSizeSchema = z.number().min(TEXT_SIZE_RANGE.min).max(TEXT_SIZE_RANGE.max)
  .describe('Primary label size in layout px, 6 to 32, the same at every width; other text keeps its ratio. Not with textScale.');

export const sizeSchema = z.union([
  z.enum(Object.keys(SIZE_PRESETS) as [keyof typeof SIZE_PRESETS, ...(keyof typeof SIZE_PRESETS)[]])
    .describe('Geometry preset; does not select a target. Existing pixel dimensions stay unchanged. A4 content presets are 267 by 180 mm and 180 by 267 mm.'),
  z.object({
    width: z.number().finite().positive().describe('Canvas width in the stated unit; at least 100 layout px after conversion.'),
    height: z.number().finite().positive().optional().describe('Canvas height in the stated unit; at least 24 layout px after conversion. Omitted, height stays automatic.'),
    unit: z.enum(['px', 'pt', 'mm']).optional().describe('Dimension unit. Default px. One pt is 96/72 layout px; one mm is 96/25.4 layout px.'),
  }).superRefine((size, ctx) => {
    for (const [side, minimum] of [['width', MIN_CANVAS_WIDTH], ['height', MIN_CANVAS_HEIGHT]] as const) {
      const value = size[side];
      if (value !== undefined && !Number.isFinite(toLayoutPx(value, size.unit))) {
        ctx.addIssue({ code: 'custom', path: [side], message: `${side} must remain finite after unit conversion` });
      } else if (value !== undefined && toLayoutPx(value, size.unit) < minimum) {
        ctx.addIssue({ code: 'custom', path: [side], message: `${side} must be at least ${minimum} layout px after unit conversion` });
      }
    }
  }).describe('Explicit dimensions. Width fixes width; an explicit height fixes height.'),
]).describe('Frame or geometry preset. Omission uses the target default and its automatic or fixed constraints.');

/**
 * The event fields the lane reads (column, combo, line). The pass-through
 * annotation object keeps them as extra fields, so their shape is checked
 * here: exactly one of `at` and `date`, ISO dates, a period that ends after
 * it starts, and the enumerations spelled out.
 */
/** Column and combo: a badge is gantt's event placement, and the lane would ignore it. */
export function refuseBadgeEvents(options: { annotations?: readonly unknown[] }, ctx: z.RefinementCtx): void {
  (options.annotations ?? []).forEach((annotation, index) => {
    const event = annotation as { kind?: unknown; labelPlacement?: unknown };
    if (event.kind === 'event' && event.labelPlacement === 'badge') {
      ctx.addIssue({ code: 'custom', path: ['annotations', index, 'labelPlacement'], message: 'badge is a gantt event placement', params: { refused: true } });
    }
  });
}

function addEventIssues(event: Record<string, unknown>, ctx: z.RefinementCtx, timeX = false): void {
  const has = (key: string) => Object.hasOwn(event, key) && event[key] !== undefined;
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (typeof event.label !== 'string' || event.label.trim() === '') issue('label', 'an event needs a label, the title it prints');
  if (has('at') === has('date')) issue(has('at') ? 'date' : 'at', "an event takes exactly one of 'at' (a category id) and 'date' (an ISO date)");
  for (const key of ['date', 'end'] as const) {
    const epoch = timeX && typeof event[key] === 'number' && Number.isFinite(event[key]);
    if (has(key) && !epoch && (typeof event[key] !== 'string' || (parseISODate(event[key] as string) === null && parseTimeText(event[key] as string) === null))) issue(key, `event ${key} must be an ISO date, yyyy-mm-dd, or on a continuous time axis an ISO date-time such as 2026-10-25T03:00${timeX ? ' or epoch milliseconds' : ''}`);
  }
  if (has('end') && !has('date')) issue('end', "an event 'end' needs its 'date'; a category-anchored period ends with 'to'");
  if (has('to') && !has('at')) issue('to', "an event 'to' needs its 'at'; a dated period ends with 'end'");
  if (has('to') && typeof event.to !== 'string' && !(timeX && typeof event.to === 'number' && Number.isFinite(event.to))) issue('to', "event 'to' is a category id");
  // Date-times compare by instant in the layout, which knows the zone.
  if (typeof event.date === 'string' && typeof event.end === 'string' && parseISODate(event.date) && parseISODate(event.end) && event.end < event.date) issue('end', 'an event period ends on or after its date');
  if (has('detail') && typeof event.detail !== 'string' && !(Array.isArray(event.detail) && event.detail.every((line) => typeof line === 'string'))) {
    issue('detail', 'event detail is a string or an array of strings');
  }
  if (has('items')) {
    const items = event.items;
    const ok = Array.isArray(items) && items.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item)
      && Object.keys(item as object).every((key) => key === 'label' || key === 'detail')
      && typeof (item as { label?: unknown }).label === 'string' && (item as { label: string }).label.trim() !== ''
      && ((item as { detail?: unknown }).detail === undefined || typeof (item as { detail: unknown }).detail === 'string'
        || (Array.isArray((item as { detail: unknown }).detail) && ((item as { detail: unknown[] }).detail).every((line) => typeof line === 'string'))));
    if (!ok) issue('items', 'event items is a list of { label, detail? } and takes no other key (the allowed keys are label and detail): the further changes on this date, each with a title and an optional detail (a string or an array of strings)');
  }
  if (has('group') && typeof event.group !== 'string') issue('group', 'event group is the id of a group in options.events.groups');
  if (has('tone') && !['neutral', 'bad', 'good'].includes(event.tone as string)) issue('tone', "event tone must be 'neutral', 'bad' or 'good'");
  if (has('placement') && event.placement !== 'auto' && event.placement !== 'key') issue('placement', "event placement must be 'auto' or 'key'");
}

/**
 * An annotation's `format` prints the number it computes, so the example must
 * parse and fit that number: a rate is a percent, an absolute difference is
 * in the values' unit. A kind that computes no number has nothing to format.
 */
function addAnnotationFormatIssues(annotation: { kind: string; format?: string }, ctx: z.RefinementCtx): void {
  const issue = (message: string, refused = false) => ctx.addIssue({ code: 'custom', path: ['format'], message, ...(refused ? { params: { refused: true } } : {}) });
  if (annotation.kind === 'event' || annotation.kind === 'indicator100') {
    issue(`${annotation.kind} computes no number, so format has nothing to print; drop it`, true);
    return;
  }
  // A format that does not parse gets one finding, the syntax one; its
  // context is judged only once it parses.
  const problem = formatExampleProblem(annotation.format!);
  if (problem) {
    ctx.addIssue({ code: 'custom', path: ['format'], message: problem.message, params: { code: 'invalid-format' } });
    return;
  }
  let unit: ReturnType<typeof specUnitKind>;
  try {
    unit = specUnitKind(parseFormatExample(annotation.format!));
  } catch (error) {
    issue(`format ${JSON.stringify(annotation.format)} is no format example (${error instanceof Error ? error.message : String(error)}); write one such as +0.0% or 1,234.5`);
    return;
  }
  const mode = Object.hasOwn(annotation, 'mode') ? (annotation as { mode?: unknown }).mode : undefined;
  const rate = annotation.kind === 'cagr' || (annotation.kind === 'diff' && mode !== 'absolute');
  if (rate && unit !== 'percent') {
    issue(`${annotation.kind === 'cagr' ? 'a cagr' : 'a relative diff'} prints a percent, so its format is a percent example such as +0.0% or +0.00%`);
  }
  if (annotation.kind === 'diff' && mode === 'absolute' && unit === 'percent') {
    issue("an absolute diff prints the difference in the values' unit; a difference of two percent levels is in percentage points, written +1.0pp");
  }
}

/** `options.events`: the event lane and its key (column, combo, line). */
export const eventOptionsSchema = z
  .strictObject({
    placement: z.enum(['auto', 'key']).optional().describe("auto uses lane then key, key uses key only. 'auto' (default) sets events in the lane above the plot where they fit and numbers the rest into the key below it; 'key' draws every event as a numbered marker with its entry in the key. Under footnotes: false there is no key: those events are left off and listed in the footnotes-off lint.").meta({ default: 'auto' }),
    rows: z.number().int().min(0).max(2).optional().describe('Lane rows for event blocks. Default by canvas width: 1 under 1080px, 2 from 1080px. 0 draws numbered markers only. A row gives way while the plot band left under the lane would keep less than 40% of the canvas height.').meta({ 'x-boardplot-defaultDependsOn': ['size'] }),
    groups: z
      .array(
        z.strictObject({
          id: idSchema.describe('Group id that events name in their group field.'),
          label: z.string().min(1).describe('Kind label printed in the block header and the key, such as Out of stock.'),
          tone: z.enum(['neutral', 'bad', 'good']).optional().describe('Colour of the glyph, the marker ring and the period bar; default neutral. An event tone overrides it.').meta({ default: 'neutral' }),
          glyph: z.enum(['dot', 'triangle', 'diamond', 'square']).optional().describe('Shape that marks the kind without colour; default by group order: dot, triangle, diamond, square.'),
        }),
      )
      .optional()
      .superRefine((groups, ctx) => {
        const seen = new Set<string>();
        groups?.forEach((group, index) => {
          if (seen.has(group.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `duplicate event group id '${group.id}'` });
          seen.add(group.id);
        });
      })
      .describe('Kinds of events, authored once: label, tone and glyph.'),
    keyTitle: z.string().min(1).optional().describe('Heading printed over the event key.'),
  })
  .describe('Event lane and key. Events are annotations of kind event with at or date, an optional end or to for a period, group, detail, priority and, on column, combo and line charts only, items (more changes on the same date). Gantt events take one label and refuse items.');

/** A callout's headline and arrow: text and a flag, on a callout only, and no arrow beside a glyph chip that leads already. */
function addCalloutHeadIssues(annotation: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const field of ['headline', 'arrow'] as const) {
    if (!Object.hasOwn(annotation, field)) continue;
    const given = annotation[field];
    if (annotation.kind !== 'callout') {
      ctx.addIssue({ code: 'custom', path: [field], message: `${field} belongs to a callout; a ${String(annotation.kind)} draws none` });
    } else if (field === 'headline' ? typeof given !== 'string' || given.trim() === '' : typeof given !== 'boolean') {
      ctx.addIssue({ code: 'custom', path: [field], message: field === 'headline' ? "a callout headline is non-empty text, such as '${value}'" : 'a callout arrow is true or false' });
    }
  }
  if (annotation.kind === 'callout' && annotation.arrow === true && (annotation.icon !== undefined || annotation.status !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['arrow'], message: 'a callout with an icon or status leads from its chip, so the arrow would draw nothing; drop arrow or the glyph' });
  }
}

/**
 * The fields each kind reads beyond the shared ones (Annotation in
 * types/annotations.ts; describe --full lists the same). A key outside them
 * would be dropped without a trace, so a typo such as 'form' for 'from'
 * would print another number.
 */
const ANNOTATION_FIELDS: Record<string, readonly string[]> = {
  diff: ['from', 'to', 'mode', 'placement', 'caption'],
  cagr: ['from', 'to', 'suffix', 'period', 'shape'],
  delta: ['at', 'vs', 'placement', 'caption'],
  abs: ['at'],
  note: ['at', 'icon', 'status'],
  callout: ['at', 'preferSide', 'headline', 'arrow', 'icon', 'status'],
  valueLine: ['value', 'valueKind', 'seriesId', 'from', 'to', 'label', 'side', 'axis', 'tolerance', 'attainment'],
  indicator100: ['side'],
  event: ['at', 'date', 'to', 'end', 'label', 'detail', 'items', 'group', 'tone', 'placement', 'labelPlacement'],
  band: ['from', 'to', 'label', 'tone', 'style', 'divider', 'low', 'high', 'value', 'seriesId', 'scenario', 'direction'],
};
/** Every kind takes these, or refuses them with a message of its own (text, glyphs, the callout head). */
const SHARED_ANNOTATION_FIELDS = ['kind', 'id', 'text', 'format', 'priority', 'icon', 'status', 'headline', 'arrow'];
/** The anchor fields of each kind; all are required but a cagr's, which default to the ends, and an event's, which may take a date (addEventIssues). */
const ANCHOR_FIELDS: Record<string, readonly string[]> = { diff: ['from', 'to'], cagr: ['from', 'to'], delta: ['at', 'vs'], abs: ['at'], note: ['at'], callout: ['at'], event: ['at'] };
const ANCHOR_SHAPE = "a category id such as 'c1', { categoryId, seriesId? }, { pointId } on scatter, or { valueLineId }";
/** The keys an object anchor takes (AnchorRef in types/annotations.ts). */
const ANCHOR_KEYS = ['categoryId', 'seriesId', 'segmentId', 'edge', 'pointId', 'valueLineId'];

function isAnchorRef(value: unknown, timeX = false): boolean {
  if (typeof value === 'string') return value !== '';
  if (timeX && typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && ['categoryId', 'pointId', 'valueLineId'].some((key) => typeof (value as Record<string, unknown>)[key] === 'string'
      || (timeX && key === 'categoryId' && typeof (value as Record<string, unknown>)[key] === 'number' && Number.isFinite((value as Record<string, unknown>)[key])));
}

/** The field a key misspells: same letters in another order, or one edit away, ignoring case. */
function misspelledField(key: string, fields: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  const letters = (word: string) => [...word].sort().join('');
  return fields.find((field) => {
    const candidate = field.toLowerCase();
    return letters(candidate) === letters(lower) || levenshtein(candidate, lower) <= 1;
  });
}

/** Unknown keys, missing or malformed anchors, and a valueLine value that is no number. */
function addAnnotationFieldIssues(annotation: Record<string, unknown>, ctx: z.RefinementCtx, timeX = false): void {
  const kind = String(annotation.kind);
  const fields = ANNOTATION_FIELDS[kind] ?? [];
  for (const key of Object.keys(annotation)) {
    if (SHARED_ANNOTATION_FIELDS.includes(key) || fields.includes(key)) continue;
    const near = misspelledField(key, [...fields, ...SHARED_ANNOTATION_FIELDS]);
    ctx.addIssue({
      code: 'custom',
      path: [key],
      message: near
        ? `unknown ${kind} field '${key}' — try: ${near}`
        : `unknown ${kind} field '${key}'; a ${kind} takes ${[...fields, 'id', ...(kind === 'valueLine' || kind === 'indicator100' ? [] : ['text']), 'format', 'priority'].join(', ')}`,
      params: near ? { renameTo: near } : { refused: true },
    });
  }
  for (const field of ANCHOR_FIELDS[kind] ?? []) {
    const value = annotation[field];
    if (value === undefined) {
      if (kind !== 'cagr' && kind !== 'event') ctx.addIssue({ code: 'custom', path: [field], message: `a ${kind} needs '${field}', the anchor it points at: ${ANCHOR_SHAPE}` });
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).some((key) => !ANCHOR_KEYS.includes(key))) {
      // A misspelt seriesId fell back to the category's first series and printed another number.
      for (const key of Object.keys(value).filter((name) => !ANCHOR_KEYS.includes(name))) {
        const near = misspelledField(key, ANCHOR_KEYS);
        ctx.addIssue({
          code: 'custom',
          path: [field, key],
          message: near ? `unknown anchor field '${key}' — try: ${near}` : `unknown anchor field '${key}'; an anchor takes ${ANCHOR_KEYS.join(', ')}`,
          params: near ? { renameTo: near } : { refused: true },
        });
      }
    } else if (!isAnchorRef(value, timeX) && !(field === 'vs' && typeof value === 'number' && Number.isFinite(value))) {
      ctx.addIssue({ code: 'custom', path: [field], message: `'${field}' is an anchor: ${ANCHOR_SHAPE}${timeX ? ', or epoch milliseconds on a time axis' : ''}${field === 'vs' ? ', or a number' : ''}` });
    }
  }
  if (kind === 'valueLine' && Object.hasOwn(annotation, 'value') && annotation.value !== 'mean'
    && !(typeof annotation.value === 'number' && Number.isFinite(annotation.value))) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: "a valueLine value is a finite number or 'mean'" });
  }
}

const existingAnnotationSchema = (timeX = false) => z
  .object({
    kind: z.enum(['diff', 'cagr', 'delta', 'abs', 'note', 'callout', 'valueLine', 'indicator100', 'event']).describe('Annotation operation; its anchors and additional fields are checked by the chart annotation pass.'),
    id: z.string().optional().describe('Stable annotation identity; omission generates an id from kind and authored order.'),
    text: z.string().optional().describe("Authored annotation text; refused on valueLine, which prints label, and on indicator100. ${value} prints the computed number in it: a cagr's rate with its suffix, a diff's change, a delta's difference, the anchored value of an abs, note or callout; a note or callout on a mark that prints the same number leaves it to the mark and reports annotation-value-on-mark. Without ${value}, text on a cagr, diff, delta or abs replaces the number, warns annotation-authored-override and the claim record marks the override."),
    format: z.string().optional().describe("Number format: annotation > anchored series > chart. Diff uses to, then from. CAGR and relative/reversed diff need a percent example; value differences use pp for percent levels. Refused on event and indicator100."),
    priority: z.number().optional().describe('Annotation label priority during collision resolution.'),
    icon: annotationIconSchema.optional().describe('Registered icon for note or callout annotations; cannot be combined with status.'),
    status: z.enum(['good', 'bad', 'warn', 'info']).optional().describe('Semantic status glyph for a note or callout; cannot be combined with icon.'),
    shape: z.enum(['bracket', 'arrow']).optional().describe("A cagr's form: 'bracket', the default, runs over the marks, and 'arrow' is one straight arrow with the rate in an oval on it."),
  })
  .catchall(z.unknown().describe('Kind-specific annotation field, such as at, from or to; the annotation pass validates anchors and other requirements.'))
  .superRefine((annotation, ctx) => {
    addAnnotationFieldIssues(annotation as Record<string, unknown>, ctx, timeX);
    if (annotation.icon && annotation.status) {
      ctx.addIssue({
        code: 'custom',
        path: ['icon'],
        message: 'annotation icon and status are mutually exclusive glyph slots',
      });
    }
    if (
      (annotation.icon || annotation.status) &&
      annotation.kind !== 'callout' &&
      annotation.kind !== 'note'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [annotation.icon ? 'icon' : 'status'],
        message: 'annotation glyphs are supported only on callout and note annotations',
      });
    }
    // Every mode outside relative/reversed would fall into the absolute
    // branch, so mode:'pctOf100' on a stacked100 column would render the raw
    // value difference where the author asked for percentage points — a
    // confident wrong number, worse than a silent no-op. The annotate pass resolves anchors to ABSOLUTE
    // values by design (an 'abs' on a stacked100 segment must report the
    // value, not the share), so it has no share basis to divide by; until a
    // share-aware resolver exists the value is refused, not advertised.
    if (annotation.kind === 'diff') {
      // Object.hasOwn, not a plain read: the parse output is an ordinary
      // object, so an absent `mode` would answer from a polluted prototype
      // chain and refuse a clean annotation off environment data.
      const mode = Object.hasOwn(annotation, 'mode')
        ? (annotation as { mode?: unknown }).mode
        : undefined;
      if (mode !== undefined && mode !== 'relative' && mode !== 'absolute' && mode !== 'reversed') {
        ctx.addIssue({
          code: 'custom',
          path: ['mode'],
          message:
            mode === 'pctOf100'
              ? "diff mode 'pctOf100' is not implemented — annotation anchors resolve to absolute values, so the engine cannot derive share percentage points; use mode:'absolute' for the raw difference, or author the shares as data if the reader needs points of 100%"
              : `unknown diff mode '${String(mode)}' — expected 'relative', 'absolute' or 'reversed'`,
        });
      }
    }
    if (annotation.kind === 'event') addEventIssues(annotation as Record<string, unknown>, ctx, timeX);
    if (annotation.kind === 'delta' || annotation.kind === 'diff') {
      const { placement, caption } = annotation as { placement?: unknown; caption?: unknown };
      if (Object.hasOwn(annotation, 'placement') && placement !== 'auto' && placement !== 'label' && placement !== 'bracket') {
        ctx.addIssue({ code: 'custom', path: ['placement'], message: `${annotation.kind} placement is 'auto', 'label' or 'bracket'` });
      }
      if (Object.hasOwn(annotation, 'caption') && (typeof caption !== 'string' || caption.trim() === '')) {
        ctx.addIssue({ code: 'custom', path: ['caption'], message: `${annotation.kind} caption is a non-empty string` });
      }
    }
    // A valueLine prints its label and an indicator100 a fixed 100%; text on either is refused.
    if ((annotation.kind === 'valueLine' || annotation.kind === 'indicator100') && Object.hasOwn(annotation, 'text')) {
      const rename = annotation.kind === 'valueLine' && !Object.hasOwn(annotation, 'label');
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: annotation.kind === 'valueLine'
          ? `a valueLine prints label, not text; ${rename ? "rename 'text' to 'label'" : "drop 'text', label is set"}`
          : "an indicator100 prints a fixed '100%' and no authored text; drop 'text'",
        params: rename ? { renameTo: 'label' } : { refused: true },
      });
    }
    addCalloutHeadIssues(annotation as Record<string, unknown>, ctx);
    if (annotation.format !== undefined) addAnnotationFormatIssues(annotation, ctx);
    if (annotation.kind === 'cagr' && Object.hasOwn(annotation, 'period') && typeof (annotation as { period?: unknown }).period !== 'boolean') {
      ctx.addIssue({ code: 'custom', path: ['period'], message: 'cagr period is true or false' });
    }
    if (annotation.kind === 'valueLine') {
      if (Object.hasOwn(annotation, 'valueKind') && (annotation.valueKind !== 'fraction' || typeof annotation.value !== 'number')) {
        ctx.addIssue({ code: 'custom', path: ['valueKind'], message: "valueLine valueKind 'fraction' needs a numeric value" });
      }
      const rec = annotation as {
        tolerance?: unknown;
        attainment?: unknown;
        axis?: unknown;
      };
      if (Object.hasOwn(annotation, 'tolerance')) {
        const tolerance = rec.tolerance;
        const okNumber = typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance > 0;
        const okPair =
          typeof tolerance === 'object' &&
          tolerance !== null &&
          typeof (tolerance as { low?: unknown }).low === 'number' &&
          typeof (tolerance as { high?: unknown }).high === 'number' &&
          Number.isFinite((tolerance as { low: number }).low) &&
          Number.isFinite((tolerance as { high: number }).high) &&
          (tolerance as { low: number }).low !== (tolerance as { high: number }).high;
        if (!okNumber && !okPair) {
          ctx.addIssue({
            code: 'custom',
            path: ['tolerance'],
            message:
              "valueLine tolerance is a positive finite number (±) or {low, high} with unequal finite bounds",
          });
        }
      }
      if (Object.hasOwn(annotation, 'attainment')) {
        const attainment = rec.attainment;
        const okFlag = attainment === true || attainment === false;
        const okObj =
          typeof attainment === 'object' &&
          attainment !== null &&
          !Array.isArray(attainment);
        if (!okFlag && !okObj) {
          ctx.addIssue({
            code: 'custom',
            path: ['attainment'],
            message: "valueLine attainment is true or { seriesId?, direction? }",
          });
        }
      }
      if (rec.axis === 'secondary' && (Object.hasOwn(annotation, 'tolerance') || Object.hasOwn(annotation, 'attainment'))) {
        ctx.addIssue({
          code: 'custom',
          path: ['axis'],
          message: 'tolerance and attainment are primary-axis only',
        });
      }
    }
  }).describe('Data-bound annotation. Additional kind-specific fields, including required anchors, are checked by the annotation pass.'); // remaining kind-specific fields checked at runtime by the annotate pass

const bandAnnotationSchema = (timeX = false) => z
  .object({
    kind: z.literal('band').describe('Era band spanning inclusive category ids, or a value-axis plan corridor, tolerance band or attainment fill.'),
    id: z.string().optional().describe('Stable band annotation identity; omission generates an id from kind and authored order.'),
    text: z.string().optional().describe('Shared annotation text override; band captions use label.'),
    format: formatExample.optional().describe('Shared annotation value format; the band caption itself is authored text.'),
    priority: z.number().optional().describe('Band label priority during collision resolution.'),
    from: (timeX ? z.union([idSchema, z.number().finite()]) : idSchema).optional().describe('First category included in the band; required for era shade/bracket, optional clip for value-axis bands.' + (timeX ? ' A time axis also takes epoch milliseconds.' : '')),
    to: (timeX ? z.union([idSchema, z.number().finite()]) : idSchema).optional().describe('Last category included in the band; required for era shade/bracket, optional clip for value-axis bands.' + (timeX ? ' A time axis also takes epoch milliseconds.' : '')),
    label: z.string().optional().describe('Optional period or corridor label.'),
    tone: z
      .enum(['neutral', 'muted'])
      .optional()
      .describe('Semantic era-band tone; both use the theme others tint. Refused on corridor, tolerance and attainment.'),
    style: z
      .enum(['shade', 'bracket', 'corridor', 'tolerance', 'attainment'])
      .optional()
      .describe("Band presentation; 'shade' is the default category tint, 'bracket' is a double-headed period arrow, 'corridor' is a plan value band, 'tolerance' is an authored value range, 'attainment' shades actual versus plan."),
    divider: z
      .union([
        z.literal(false).describe('Do not draw category-span edge dividers.'),
        z.enum(['start', 'end', 'both']).describe('Draw a divider at the selected category-span edges.'),
      ])
      .optional()
      .describe('Optional dashed divider at one or both bracket-band edges; other band styles refuse this field.'),
    low: z.number().finite().optional().describe('Lower value-axis bound for corridor and tolerance bands.'),
    high: z.number().finite().optional().describe('Upper value-axis bound for corridor and tolerance bands.'),
    value: z.number().finite().optional().describe('Plan value for attainment shading; actuals are resolved per category.'),
    seriesId: idSchema.optional().describe('Series whose actuals are shaded for attainment; omission uses the category total.'),
    scenario: z.enum(['AC', 'PY', 'PL', 'FC']).optional().describe('Scenario notation for a plan corridor; default PL.'),
    direction: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe('Whether exceeding the plan is favorable for attainment shading; default higherIsBetter.'),
  })
  // Loose, so the refinement sees a misspelt key instead of zod dropping it.
  .catchall(z.unknown())
  .superRefine((band, ctx) => {
    addAnnotationFieldIssues(band as Record<string, unknown>, ctx, timeX);
    const style = band.style ?? 'shade';
    const target = style === 'corridor' || style === 'tolerance' || style === 'attainment';
    if (!target) {
      if (band.from === undefined) {
        ctx.addIssue({ code: 'custom', path: ['from'], message: 'era band needs inclusive category from and to' });
      }
      if (band.to === undefined) {
        ctx.addIssue({ code: 'custom', path: ['to'], message: 'era band needs inclusive category from and to' });
      }
      if (band.low !== undefined || band.high !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['low'],
          message: "low/high belong to style 'corridor' or 'tolerance', not era shade/bracket",
        });
      }
      if (band.value !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: "value belongs to style 'attainment', not era shade/bracket",
        });
      }
      if (band.seriesId !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['seriesId'],
          message: "seriesId belongs to style 'attainment'",
        });
      }
      if (band.scenario !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenario'],
          message: "scenario belongs to style 'corridor'",
        });
      }
      return;
    }
    if ((band.from === undefined) !== (band.to === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [band.from === undefined ? 'from' : 'to'],
        message: "a category span needs both 'from' and 'to' (inclusive, like era band)",
      });
    }
    if (band.divider) {
      ctx.addIssue({
        code: 'custom',
        path: ['divider'],
        message: 'divider applies only to bracket era bands',
      });
    }
    if (band.tone !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['tone'],
        message: 'tone applies to era bands; corridor, tolerance and attainment use scenario or good/bad tokens',
      });
    }
    if (style !== 'attainment' && band.seriesId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['seriesId'],
        message: "seriesId belongs to style 'attainment'",
      });
    }
    if (style !== 'corridor' && band.scenario !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['scenario'],
        message: "scenario belongs to style 'corridor'",
      });
    }
    if (style === 'attainment' && (band.low !== undefined || band.high !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['low'],
        message: "attainment uses 'value' as the plan, not low/high",
      });
    }
    if (style !== 'attainment' && band.value !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: "value belongs to style 'attainment'",
      });
    }
    if (style === 'corridor' || style === 'tolerance') {
      if (band.low === undefined || band.high === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [band.low === undefined ? 'low' : 'high'],
          message: `${style} needs finite 'low' and 'high' on the value axis`,
        });
      } else if (band.low === band.high) {
        ctx.addIssue({
          code: 'custom',
          path: ['high'],
          message: `${style} low and high must differ`,
        });
      }
    }
    if (style === 'attainment' && band.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: "attainment needs a finite plan 'value'",
      });
    }
  })
  .describe('Unclaimed background era band, plan corridor, tolerance band or attainment fill.');

export const annotationSchema = z.union([existingAnnotationSchema(), bandAnnotationSchema()]).describe('Data-bound annotation or category-span band; supported kinds depend on the selected chart type.');

/** A line's time x anchors accept the same epoch numbers as data.x. */
export const timeAnnotationSchema = z.union([existingAnnotationSchema(true), bandAnnotationSchema(true)]).describe('Data-bound annotation on a time axis; x anchors accept ISO strings or epoch milliseconds.');

export function annotationArraySchema<T extends z.ZodType>(itemSchema: T) {
  return z.array(itemSchema).superRefine((annotations, ctx) => {
    const firstPosition = new Map<string, number>();
    annotations.forEach((annotation, index) => {
      if (
        typeof annotation !== 'object' ||
        annotation === null ||
        !('id' in annotation) ||
        typeof annotation.id !== 'string'
      ) {
        return;
      }
      const first = firstPosition.get(annotation.id);
      if (first !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `duplicate annotation id '${annotation.id}' at positions ${first} and ${index} — explicit ids key annotation labels and scene identities`,
        });
        return;
      }
      firstPosition.set(annotation.id, index);
    });
  }).describe('Annotations in authored order; explicit ids must be unique within this array.');
}

/**
 * Dashed/dotted line ink is the engine's scenario
 * channel for PROJECTED data (AC→FC transitions, FC/PL series). An authored
 * `lineStyle` that dashes an ACTUAL series makes the exhibit claim a forecast
 * that is not one, a break of the scenario grammar worse than any layout
 * defect. Reference context lines are exempt: the engine draws them in its
 * own dash and they carry no scenario claim.
 * Data dashes also mark provisional metric-stack values. That mode
 * owns its scoped states and dash geometry; it does not accept lineStyle.
 */
export function addProjectedDashIssues(
  ctx: z.RefinementCtx,
  series: { id: string; lineStyle?: string; scenario?: string; role?: string }[],
  basePath: (string | number)[] = ['series'],
): void {
  series.forEach((entry, index) => {
    if (entry.lineStyle !== 'dashed' && entry.lineStyle !== 'dotted') return;
    if (entry.scenario === 'FC' || entry.scenario === 'PL') return;
    if (entry.role === 'reference') return;
    ctx.addIssue({
      code: 'custom',
      path: [...basePath, index, 'lineStyle'],
      message: `series '${entry.id}': lineStyle '${entry.lineStyle}' on actual data claims forecast status — dashed/dotted ink marks projected data only; declare scenario 'FC' or 'PL' if the series is projected, use role 'reference' for a context line, or drop lineStyle and let color carry identity`,
    });
  });
}

export const derivedRatioTierSchema = z
  .object({
    id: idSchema.describe('Stable id for the derived ratio tier.'),
    label: z.string().min(1).describe('Quiet caption explaining what the ratio badges measure.'),
    numeratorSeriesId: idSchema.describe('Series used as the computed ratio numerator.'),
    denominatorSeriesId: idSchema.describe('Series used as the computed ratio denominator.'),
    at: z.array(idSchema).min(1).describe('Selected category ids that receive a computed ratio trace.'),
    format: formatExample
      .min(1)
      .optional()
      .describe("Format-by-example for computed percentage points, e.g. '1.2pp' or '88%'."),
    direction: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe('Whether an increase in the computed ratio is favourable; controls semantic treatment where supported.'),
  })
  .strict()
  .describe(
    'Below-axis ratio tier computed from normalized chart series cells; authored ratio values are not accepted.',
  );

const marginSchema = z.object({
  top: z.number().finite().nonnegative().optional().describe('Top outer margin in pixels; omission uses chart or theme defaults.'),
  right: z.number().finite().nonnegative().optional().describe('Right outer margin in pixels; omission uses chart or theme defaults.'),
  bottom: z.number().finite().nonnegative().optional().describe('Bottom outer margin in pixels; omission uses chart or theme defaults.'),
  left: z.number().finite().nonnegative().optional().describe('Left outer margin in pixels; omission uses chart or theme defaults.'),
}).describe('Optional per-side outer margins in pixels, applied before chart furniture reserves space.');

/**
 * `axisTitles` on a type with one value axis and no theme-derived title (box,
 * mekko, variance, bullet): drawn only when authored and the axis is drawn.
 */
export function primaryAxisTitleSchema(where: string) {
  return z.strictObject({
    primary: z.string().trim().min(1).optional().describe("'Measure, unit' title of the value axis, e.g. 'Margin, %'."),
  }).optional().describe(`Title of the value axis when it is drawn: ${where}. Drawn only when authored.`);
}

/**
 * The shared value-axis object, named so a chart schema can extend it with its
 * own fields instead of redeclaring the shared ones. `scatter` does exactly
 * that for `clamp`; every other type keeps this object unchanged.
 */
export const valueAxisSchema = z
  .object({
    show: z.boolean().optional().describe('Draw the value axis with its ticks. Default: shown unless every value is labelled; true keeps it beside the labels, false hides it.'),
    min: z.number().optional().describe('Requested lower domain bound; chart data can widen it to avoid clipping values.'),
    max: z.number().optional().describe('Requested upper domain bound; chart data can widen it to avoid clipping values.'),
    tickStep: z.number().positive().optional().describe('Requested positive tick step. Line and column draw their ticks at the step and snap the domain out to it, never cutting data; box ignores it with a warning, and every other type refuses it because it picks a readable step from the data.'),
    includeZero: z.boolean().optional().describe('Include zero in the value domain; zero-based marks can require it even when false.'),
    percent: z.boolean().optional().describe('Request the chart percent-axis or percentage presentation where supported; meanings and support follow the chart-specific schema.'),
    log: z.union([z.boolean(), z.enum(['x', 'y', 'both'])]).optional().describe("Scatter only: a log10 scale on the horizontal axis ('x'), the vertical axis ('y', also true) or both. Ticks print plain numbers in the chart format at both ends and at 1, 2 and 5 of each decade (3, 4, 6 and 8 too under one decade), down to the decades alone where labels would touch, and the domain ends on the nearest round number past the data, never on a decade the data does not reach. Every value on a log axis must be above zero: a point, cut point, zone, value line, clamp or view bound at or below zero is refused with its path. Every other type refuses the key."),
    reverse: z.boolean().optional().describe('Reverse the value-axis direction on line and scatter; box ignores it with a warning, and every other type refuses it.'),
    gridlines: z.boolean().optional().describe('Show value-axis gridlines where supported; default false.'),
    break: z.union([z.literal('auto'), z.literal(false), z
      .object({
        from: z.number().describe('Lower value bounding the omitted domain span.'),
        to: z.number().describe('Upper value bounding the omitted domain span.'),
        style: z.enum(['straight']).optional().describe("Break glyph style: 'straight'."),
      })
      .superRefine((v, ctx) => {
        if (!(v.from < v.to)) {
          ctx.addIssue({ code: 'custom', message: 'break requires from < to' });
        }
      })
      .describe(
        'Straight value-axis break; the omitted span collapses to a fixed 12px gap when valid.',
      )])
      .describe("No break by default or with false. Waterfall and pvm alone accept 'auto' to choose a safe break; pvm defaults to 'auto' when its smaller total exceeds 10 times its largest step or its running levels span under 20% of the larger total; { from, to, style? } sets the omitted span. A valid straight break uses a fixed 12px gap and discloses the omitted range. Totals and levels stay visibly longer than smaller steps or segments and no shorter than equal ones. Unsafe automatic breaks move down when valid; unsafe authored breaks are ignored with a warning. An unbroken positive bridge gets an info hint when its smallest total divided by its largest step exceeds 10.")
      .optional(),
  });

/**
 * A key beside the plot takes the plot's width, so 'right' is
 * refused wherever a spec places a key. 'top' comes first in each enum: the
 * schema diagnostic patches a refused value to the nearest allowed one, and
 * on a tie that is the first.
 */
export function sideKeyError(issue: { input?: unknown }): string | undefined {
  const input = issue.input as { position?: unknown } | string | undefined;
  // The union hands in the whole option, the position enum the position alone.
  const side = input === 'right' || (typeof input === 'object' && input !== null && input.position === 'right');
  return side ? SIDE_KEY_REFUSED : undefined;
}

/** Where a key sits: one row above the plot, or one below it. */
export const keyPositionSchema = z.enum(['top', 'bottom'], { error: sideKeyError }).describe("Key position: 'top', one row above the plot, or 'bottom'. A key beside the plot ('right') is refused.");

/** A legend option in the shape every type shares, with the side key refused by name. */
function keyOptionSchema<const V extends readonly [string, ...string[]]>(values: V) {
  return z.union([
    z.enum(values).describe('Suppress keys, select explicit placement, or let visible series names determine whether automatic keys are needed.'),
    z.object({
      position: keyPositionSchema,
      order: z.array(idSchema).optional().describe('Legend item ids in the requested order; unspecified items follow.'),
    }).describe('Explicit legend placement and optional item order.'),
  ], { error: sideKeyError });
}

/** BaseOptions minus `measure` (excluded from JSON Schema per spec). */
export const baseOptionsSchema = z.object({
  target: renderTargetSchema.optional(),
  textScale: textScaleSchema.optional(),
  textSize: textSizeSchema.optional(),
  a11y: z.strictObject({
    title: z.boolean().optional().describe('Emit an SVG title element for hover text; default false. Accessible naming remains available.'),
    description: z.string().min(1).optional().describe('Accessible description of the chart, in place of the generated one, in the SVG desc element and the React chart. Omitted: the description comes from the chart.'),
    table: z.enum(['hidden', 'toggle', 'below']).optional().describe("Record-derived accessible data table rendered by the React chart components: 'hidden' keeps it available to assistive technology only, 'toggle' adds a disclosure control, 'below' renders it visibly under the chart. BoardplotChart includes it in the server output; a per-type component adds it after mount. Omitted: no table. The SVG is unchanged."),
  }).optional().describe('Accessible presentation options; visible chart title is controlled separately by title.'),
  mode: z.enum(['full', 'compact']).optional().describe('Presentation framing. Omitted: full at or above the chart minimum width, compact below it where the type draws there. Compact keeps the title at the theme smallest title size. Some chart-specific schemas use a different mode vocabulary.'),
  belowMinimum: z.enum(['compact', 'refuse']).optional().describe("What a canvas below the chart minimum gets, on either axis, for the types with a compact floor: `measure` and `boardplot_describe` list it as `compactFloor`. 'compact' (default) draws the tight chart down to the floor: minimal labels, tight spacing, a smaller key, the whole title wrapped, and the subtitle dropped when the plot would be under 80 px. 'refuse' refuses below the minimum. On a canvas with a pinned size, a full-mode refusal for lack of room also falls back to compact under 'compact', and the chart is refused only when compact does not fit either. Types without a compact floor always refuse below their minimum, and every refusal names the minimum it needs.").meta({ default: 'compact' }),
  size: sizeSchema.optional().describe('Frame or preset. Defaults: report 720x405 px and dashboard 480x270 px automatic; slide 1184x528 px and print 267x180 mm fixed. Below minimum refuses with a verified size.'),
  // Embed claim (--embed-width twin). Strict: an `embed:{}` with no
  // width would arm nothing — a silent no-op option — and unknown
  // keys inside must refuse loudly rather than strip.
  embed: z.strictObject({ width: z.number().positive().describe('Expected display width in CSS pixels, used to assess effective text size after scaling.') }).optional().describe('Declared host display width for readability checks; does not change chart geometry.'),
  margin: marginSchema.optional().describe('Outer canvas margins in pixels; omitted sides use chart or theme defaults. canvas.margin overrides supplied sides.'),
  canvas: z.strictObject({ margin: marginSchema.optional().describe('Per-side outer margins overriding margin, then chart or theme defaults.') }).optional().describe('Canvas framing overrides applied before chart furniture is laid out.'),
  title: z.union([
    z.string().describe('Visible chart title text.'),
    z.literal(false).describe('Suppress the visible title while retaining the accessible chart name.'),
  ]).optional().describe('Visible title override; omission retains the chart-specific title behaviour.'),
  subtitle: subtitleSchema.optional().describe('Measure subtitle below the title; strings expand to the measure field.'),
  unit: z.string().optional().describe("Chart unit, composed into the subtitle where supported; individual series may declare their own units. A unit prints as text after the number, so unit 'USD' reads 2,456 USD. For a currency sign, set format instead, such as '$1,234'; a unit the format already prints warns unit-in-format, and a unit that names another currency than the format's sign warns unit-format-conflict."),
  unitShown: z.boolean().optional().describe('True when the host prints the unit beside the chart: no unit line, no unit beside a kpi value; line end labels, a table head and the legend check treat the unit as shown. Number formatting does not change. Default false.'),
  source: z.string().optional().describe('Source credit rendered in the chart frame.'),
  footnotes: z.union([
    z.array(z.string().describe('Authored footnote text.')).describe('Footnotes in authored order; compact framing leaves optional notes off the canvas, keeps them in the accessible description and lists them in the info lint compact-notes-omitted.'),
    z.literal(false).describe('No notes in the frame: authored notes, method notes, event keys and the "+N notes" pointer are left off. Disclosures that notes.show prints (rounding, partial periods, unlabelled values), the source line and a required map credit stay; leave source out for no source line. For a host that carries the notes in its own frame; the info lint footnotes-off lists what was left off and the render result lists every note in notes.'),
  ]).optional().describe('Footnotes in authored order; the frame prints them within notes.maxLines and the rest go to the notes list. false leaves notes and the pointer off the frame; disclosures that notes.show prints, the source line and a required map credit stay.'),
  notes: z.object({
    maxListed: z.union([
      z.number().int().min(0).describe('Most items a note line names; the rest are counted. 0 names none and only counts them.'),
      z.literal('all').describe('Name every item.'),
    ]).optional().describe("Items a note line names before it counts the rest, such as \"Not labelled on the chart: ... and 236 more\". Default: every note line names as many items as fit two footer lines, at most 8, reference lines and line end values first, then the rest in data order, and ends with \"and N more\"; when no name fits, it counts. 'all' names every item. 0 names none and only counts them, \"18 of 36 values\". All items stay in the reading and the hover records.").meta({ default: 8 }),
    placement: z.enum(['frame', 'info', 'list']).optional().describe("Where the notes go. 'frame' prints notes in the frame within maxLines and the rest in the notes list; 'list' prints only the source line, a required map credit and the pointer; 'info' is the React \"Notes and sources\" button with one visible line of source and required credit (an SVG or PNG draws it as 'frame'). Default by target: dashboard 'info', slide 'list', report and print 'frame'."),
    maxLines: z.number().int().min(1).optional().describe('Visible lines of notes and source line in the frame; a required map credit and a disclosure do not count. Notes that do not fit go to the notes list and the pointer counts them. Default report and dashboard 3 (2 under 720 px wide), slide 2, print 3.'),
    show: z.array(z.enum(['note', 'method', 'disclosure', 'ranks'])).optional().describe("The kinds of note the frame prints. Default ['note'], the authored footnotes, within maxLines; an authored note a mark points at always prints. 'method' adds the one-line short form of the method notes the engine writes (likert net, pvm split). 'disclosure' adds the engine's notes on how to read the chart (a key, a data change, 'Not labelled on the chart: ...'), outside maxLines; then a chart may also key its marks to them, such as rank numbers under the columns. 'ranks' prints only the rank key: rank numbers under the columns where the names fit neither upright nor rotated, with the note that names them, and no other disclosure. Engine notes print nowhere under the chart by default; every note stays in the notes list of the render result and in its warnings."),
    pointer: z.boolean().optional().describe('Default true: when the notes list holds notes of the kinds notes.show prints that the frame does not print, the source line ends with "+N notes".').meta({ default: true }),
  }).strict().optional().describe('Notes; the footer rule: where the notes under the chart go, how many lines they take, and the note lines for what the drawing leaves out.'),
  // any registered theme name (presets + registerTheme customs); existence
  // is checked at resolve time with a helpful error
  theme: z
    .union([
      z.string().min(1).describe('Registered theme name; existence is checked when resolving the theme.'),
      z.object({
        preset: z.string().min(1).describe('Registered base theme whose tokens are overridden.'),
        overrides: z.record(z.string(), z.unknown().describe('Theme token override value; validated by theme resolution.')).optional().describe('Partial theme token tree merged with the named preset.'),
      }).describe('Named theme with explicit token overrides.'),
    ])
    .optional().describe('Theme preset or preset with overrides; request context may supply it, otherwise resolution uses boardroom.'),
  locale: z
    .object({
      language: z.string().min(2).max(35)
        .refine((tag) => canonicalLanguage(tag) !== null, { message: 'not a BCP 47 language tag; use a tag such as "de" or "de-DE"' })
        .optional().describe('BCP 47 language tag. Changes words only, such as notes and month names. It never changes the decimal or grouping marks; they come only from locale.decimal and locale.thousands. E.g. "de"; "de_DE" is read as "de-DE"; "en-US" puts the month first (Sep 4).'),
      decimal: z.enum(['.', ',']).optional().describe("Decimal mark of every number the chart prints. Default '.'. The language does not change it."),
      thousands: z.enum([',', '.', '’', ' ']).optional().describe("Grouping mark of every number the chart prints. Default ',', or '.' with decimal ','. The language does not change it. A value equal to the decimal mark uses that fallback."),
      minusGlyph: z.enum(['−', '-']).optional().describe('Minus glyph for locale-derived table formats; default Unicode minus.'),
      weekStartsOn: z.union([
        z.literal(0).describe('Sunday as the requested first weekday.'),
        z.literal(1).describe('Monday as the requested first weekday.'),
      ]).optional().describe('First weekday for week-granularity date ticks; default Monday. Line date ticks read this field, other layouts ignore it and report it.'),
    })
    .optional().describe('Language and number marks. decimal and thousands set the marks of every number, as in a spreadsheet (default 1,234.5); a format example gives only the shape. language changes words only, never the marks.'),
  strings: z
    .object({
      newItems: z.string().min(1).optional().describe('PVM entry-bar name; default New items.'),
      lostItems: z.string().min(1).optional().describe('PVM exit-bar name; default Lost items.'),
      cohortMeasure: z.string().trim().min(1).optional().describe('Cohort measure name for notes, keys and accessible descriptions; default Retention. Use Cumulative conversion for converted counts divided by cohort base.'),
      cohortFormula: z.string().trim().min(1).optional().describe('Complete cohort formula sentence for method notes and accessible descriptions. Wording only: rates still use the count and denominator selected by basis.'),
      others: z.string().min(1).optional().describe('Name of the aggregated rest bucket; default Others, and an explicit topN.restLabel still wins.'),
      total: z.string().min(1).optional().describe('Label of a computed total row; default Total.'),
      source: z.string().min(1).optional().describe('Word introducing the authored source credit; default Source.'),
      notApplicable: z.string().optional().describe('Not applicable text; n/a, German k. A.'),
      legendCount: z.string().optional().describe("Legend disclosure wording; '{count}' becomes \"2 of 4\". Default depends on the legend subject."),
      partial: z.string().min(1).optional().describe('Word after the labels of partial categories in the column, bar, line and combo footnote, also the hatch key label; default Partial; a named key uses toDate.'),
      better: z.string().optional().describe("Meaning of a better sign-coloured value."),
      worse: z.string().optional().describe("Meaning of a worse sign-coloured value."),
      positiveTotal: z.string().optional().describe("Name of a mixed-sign stack positive boundary."),
      rangeMidNote: z.string().optional().describe("Range method note."),
      sensitivityNote: z.string().optional().describe("Tornado method note."),
      hatchedBaseNote: z.string().optional().describe("Tornado base mismatch note."),
      missingSwingNote: z.string().optional().describe("Tornado missing output note; {drivers} is replaced."),
      rankOmitted: z.string().optional().describe("Focused bump note."),
      noRank: z.string().optional().describe("A missing bump rank."),
      rankMethod: z.string().optional().describe("Bump method note; {direction}, {format}, and {ring} are replaced."),
      higherBetter: z.string().optional().describe("Direction of a bump rank."),
      lowerBetter: z.string().optional().describe("Direction of a bump rank."),
      rankFormat: z.string().optional().describe("Format clause in the bump method note."),
      rankRing: z.string().optional().describe("Tie clause in the bump method note."),
      nearZeroNote: z.string().optional().describe("Note for folded zero line ends."),
      flagged: z.string().optional().describe("Anomaly marker key."),
      corridor: z.string().optional().describe("Anomaly rule key."),
      corridorBounds: z.string().optional().describe("Authored anomaly bounds key."),
      median: z.string().optional().describe("Anomaly median rule label and key."),
      anomalySmallSample: z.string().optional().describe("Small-sample anomaly sentence."),
      anomalyZeroMad: z.string().optional().describe("Zero-MAD anomaly sentence."),
      anomalyMadRule: z.string().optional().describe("MAD anomaly sentence; preserves the full calculation."),
      anomalyCentreZero: z.string().optional().describe("Zero-centred anomaly rule clause."),
      anomalyCentreMedian: z.string().optional().describe("Median-centred anomaly rule clause."),
      anomalyThresholdRule: z.string().optional().describe("Threshold anomaly sentence."),
      outsideBounds: z.string().optional().describe("Two-sided threshold clause."),
      belowBound: z.string().optional().describe("Lower threshold clause."),
      aboveBound: z.string().optional().describe("Upper threshold clause."),
      lowerBound: z.string().optional().describe("Off-scale lower corridor bound."),
      upperBound: z.string().optional().describe("Off-scale upper corridor bound."),
      undrawnBounds: z.string().optional().describe("Off-scale corridor note."),
      hiddenLabels: z.string().optional().describe("Heading of the note for hidden chart labels."),
      noteOne: z.string().optional().describe("Pointer to one hidden note."),
      noteMany: z.string().optional().describe("Pointer to hidden notes."),
      notesAndSources: z.string().optional().describe("React notes panel label."),
      close: z.string().optional().describe("React notes panel Close control. English Close; German Schließen."),
      mapCredit: z.string().optional().describe("Word before a map credit in the React notes panel."),
      gapBetween: z.string().optional().describe("Key for a gap between two lines."),
      aboveSeries: z.string().optional().describe("Positive line gap key."),
      belowSeries: z.string().optional().describe("Negative line gap key."),
      average: z.string().min(1).optional().describe("Name before a computed mean; English Average, German Ø."),
      valueLineRange: z.string().min(1, 'valueLineRange must not be empty; use {v1} and {v2} for the formatted bounds').optional().describe("Tolerance-band bounds; {v1} and {v2} are the formatted bounds."),
      toDate: z.string().min(1).optional().describe("Text after a running category name in its key or note."),
      forecast: z.string().min(1).optional().describe("Key for the forecast pattern."),
      plan: z.string().min(1).optional().describe("Key for the plan outline."),
      forecastHeader: z.string().min(1).optional().describe("Header at the actual-to-forecast boundary. Keeps the scenario code by default."),
      net: z.string().min(1).optional().describe("Name before a net total."),
      incomplete: z.string().min(1).optional().describe("Marker on an incomplete stack total; prints under notes.show 'disclosure'."),
      range: z.string().min(1).optional().describe("Key for a range whisker."),
      valuesNotOnColumns: z.string().min(1).optional().describe("Note heading for omitted column values."),
      valuesNotBesideMarks: z.string().min(1).optional().describe("Note heading for omitted combo values."),
      partialTotals: z.string().min(1).optional().describe("Incomplete total note; {partial} is the marker."),
      knownPartsTotals: z.string().min(1).optional().describe("Incomplete total note where the marker does not print. Column and combo only; a bar stack uses incompleteStacks."),
      without: z.string().min(1).optional().describe("Word before missing stack parts."),
      and: z.string().min(1).optional().describe("Word joining missing stack parts."),
      aboveZero: z.string().min(1).optional().describe("Positive sign key; {series} and {meaning} are replaced."),
      belowZero: z.string().min(1).optional().describe("Negative sign key; {series} and {meaning} are replaced."),
      declaredBounds: z.string().min(1).optional().describe("Key for an authored uncertainty bound."),
      tied: z.string().min(1).optional().describe("Label of a shared rank."),
      tiedSymbol: z.string().min(1).optional().describe("Symbol before a displaced shared-rank label."),
      currentValue: z.string().min(1).optional().describe("Football-field spine; {value} is replaced."),
      baseCase: z.string().min(1).optional().describe("Tornado spine; {value} is replaced."),
      swingOutsideBase: z.string().min(1).optional().describe("Tornado hatch key."),
      fanGap: z.string().min(1).optional().describe("Missing uncertainty note; {categories} is replaced."),
      mixedShares: z.string().min(1).optional().describe("Mixed-sign share note; {categories} is replaced."),
      heatBelow: z.string().min(1).optional().describe("Key label of the bad side of a table's traffic-light heat lane (scale 'status'); default Below average, or Below total under center 'total'."),
      heatAround: z.string().min(1).optional().describe("Key label of the warn band of a table's traffic-light heat lane; default Around average, or Around total."),
      heatAbove: z.string().min(1).optional().describe("Key label of the good side of a table's traffic-light heat lane; default Above average, or Above total."),
      bandKey: z.array(z.string().trim().min(1)).min(2).max(5).optional().describe('Words of the bullet worse-to-better band key, worst first, one for each band (2 to 5). A list of another length than the bands keeps the built-in words (Worse ... Better; German with locale.language de).'),
      moreListed: z.string().trim().min(1).optional().describe("Last item of a capped note line; '{count}' is the number left out. Default 'and {count} more'; a React chart with hover on reads 'and {count} more (hover shows each value)' unless this is set."),
      cellNote: z.string().trim().min(1).optional().describe("Waffle note that names the share of one cell; '{value}' becomes the percent, such as 5%. Default 'One cell = {value}'."),
      storyBack: z.string().min(1).optional().describe("Story Back button; default '‹ Back'."),
      storyNext: z.string().min(1).optional().describe("Story Next button; default 'Next ›'."),
      storyCounter: z.string().min(1).optional().describe("Story counter, unpadded '{step}' and '{count}'; default '{step} / {count}'."),
      storyStep: z.string().min(1).optional().describe("Live region position with unpadded '{step}' and '{count}'; default 'Step {step} of {count}' (EN), 'Schritt {step} von {count}' (DE)."),
      axisLow: z.string().min(1).optional().describe("Scatter qualitative axis low end; default 'Lower'."),
      axisHigh: z.string().min(1).optional().describe("Scatter qualitative axis high end; default 'Higher'."),
      target: z.string().trim().min(1).optional().describe('Word for the bullet comparison value in every phrase the bullet composes (vs target, of target, the keys, the hover card), such as plan; default target.'),
      actualColumn: z.string().trim().min(1).optional().describe("Head of the bullet column with the actual values; default Actual (German Ist)."),
      shareColumn: z.string().trim().min(1).optional().describe("Head of the bullet percent-of-target column; '{v1}' is the comparison word. Default '% of {v1}'."),
      deltaColumn: z.string().trim().min(1).optional().describe("Head of the bullet difference column on percent-of-target rows; '{v1}' is the comparison word. Default 'vs {v1}'."),
      targetColumn: z.string().trim().min(1).optional().describe("Head of the bullet target column; default Target (German Ziel). The strings.target word heads it when this is not set."),
      gapColumn: z.string().trim().min(1).optional().describe("Head of the bullet gap column; '{v1}' is the comparison word. Default 'Gap to {v1}'."),
      gapBelow: z.string().trim().min(1).optional().describe("Line under a bullet gap that lies below the comparison value; '{v1}' is the comparison word. Default 'below {v1}'."),
      gapAbove: z.string().trim().min(1).optional().describe("Line under a bullet gap that lies above the comparison value; '{v1}' is the comparison word. Default 'above {v1}'."),
      gapOn: z.string().trim().min(1).optional().describe("Line under a bullet gap of zero; '{v1}' is the comparison word. Default 'on {v1}'."),
      nearZeroChange: z.string().optional().describe('Table n.m. change note.'),
      mixedCoverage: z.string().optional().describe('Table n.m. note for a change between totals of different rows.'),
      hiddenPeriods: z.string().optional().describe('Dimswitch note for periods left out; {periods} is replaced.'),
      share: z.string().min(1).optional().describe('Cascade share-column heading.'),
      histogramBins: z.string().min(1).optional().describe('Histogram binning disclosure; {count}, {about}, {width}, {from}, {to} are replaced.'),
      histogramAbout: z.string().optional().describe('Histogram approximation word, including its trailing space.'),
      histogramMethod: z.string().min(1).optional().describe('Histogram method note; {count}, {width}, {from}, {rule}, {rounding}, {smallSample} are replaced.'),
      histogramRuleCount: z.string().min(1).optional().describe('Histogram authored bin-count rule name.'),
      histogramRuleWidth: z.string().min(1).optional().describe('Histogram authored bin-width rule name.'),
      histogramSnapped: z.string().min(1).optional().describe('Histogram rounded bin-width rule; {rule} is replaced.'),
      histogramRounded: z.string().optional().describe('Histogram rounded-number clause, including its separator.'),
      histogramSmallSample: z.string().optional().describe('Histogram small-sample clause, including its separator.'),
      // required stack disclosures and rebase suppression.
      missingStack: z.string().min(1).optional().describe('StackedArea source-null note; {categories} is replaced.'),
      incompleteStacks: z.string().min(1).optional().describe('Incomplete bar stack note (bar only; column and combo use knownPartsTotals); {categories} is replaced.'),
      knownPartsShares: z.string().min(1).optional().describe('Incomplete 100% stack note without total100; {categories} is replaced.'),
      rebaseZero: z.string().min(1).optional().describe('Line or stacked-area series left out by rebase100 for a zero or negative base; {series} and {period} are replaced.'),
      rebaseMissing: z.string().min(1).optional().describe('Line or stacked-area series left out by rebase100 for a missing base; {series} and {period} are replaced.'),
    })
    .strict()
    .optional()
    .describe('Wording of built-in labels. These are the labels the renderer composes itself: author chart text stays unchanged and an explicit option still wins per label; host-level wording comes from the theme provider.'),
  format: formatExample.optional().describe(`Chart-level format-by-example, such as 1,234.5 or 1.2pp. A currency sign comes from here: '$1,234' prints $2,456. Its decimals are preserved; series and cell formats can override it. Without a format, precision follows the data. ${MAGNITUDE_WORDS_DOC} ${PERCENT_FORMAT_UNITS} A separator followed by exactly three digits after a nonzero integer part is a thousands mark: 1.000 groups thousands with a dot and prints decimals with a comma; write 0.000 for three decimals.`),
  detailFields: detailFieldsSchema.optional().describe("Label, format, unit and order of the cell details keys, the extra facts a value's hover card lists after it: [{ key: 'deals', label: 'Deals', format: '1,234' }]. Declared keys print first, in this order; a details key it does not declare prints after them, labelled with its key. Default: every key, labelled with itself."),
  smallValues: z.enum(['bound', 'zero', 'scientific', 'p-value']).optional().describe("How an automatic number format prints a nonzero value below its last shown digit. Without a format, each table column and chart series takes one precision from its largest value: two significant digits below 1, at most 4 decimals. bound (default): the bound, <0.01 at two decimals, >−0.01 below zero, <1 for whole numbers; a signed change label keeps its sign, <+0.01; below 0.0001 a value prints in scientific form instead. zero: spreadsheet style, the format's own 0.00. scientific: two significant digits and a power of ten, 1.2 × 10⁻⁹. p-value: every value from 0 to 1 prints as APA 7 writes a p-value, three decimals without the leading zero, .042, and <.001 below; larger values keep the rule above. A format the author sets prints as set."),
  palette: z
    .string()
    .min(1)
    .optional()
    .describe('Named identity ramp from theme color.palettes; every chart family takes its data ink from it, while good, bad and highlight stay the theme colours.'),
  labelDensity: z.enum(['full', 'smart', 'minimal']).optional().describe("Label selection policy, default smart. full: every value label competes for a slot, and a segment value that does not fit its segment moves outside on a leader. smart: as full, but a stacked column or combo segment value prints inside its segment or not at all (where one is wider than its column, the stacked column values step down a size, to the floor; still too wide, none prints), and a segment value drops when the segment is shorter than the label height plus 4 px padding (the label width on a horizontal bar); mekko also drops segment values in columns narrower than 24 px. A labelPlacements pin keeps its label. minimal: keeps only the chart's essential labels (totals, endpoints, highlights). Collision suppression applies at every level."),
  labels: z.union([
    z.literal(false).describe('Suppress optional data labels for chart types supporting this option.'),
    z.record(z.string(), z.union([
      z.boolean().describe('Enable or suppress this label kind.'),
      z.array(z.string().describe('Requested label content, such as absolute, percent, category or series; supported values depend on the chart.')).describe('Ordered content parts for this label kind.'),
    ]).describe('Visibility or requested content for the named label kind.')).describe('Per-kind label settings, keyed by label kind.'),
  ]).optional().describe("Label visibility and content overrides; omission uses the selected chart policy. Unsupported chart types refuse this shared option. false turns optional labels off. An object maps a label kind (category, series, segment, point, total, grandTotal, insidePie, outsidePie, percentIndicator, restSeries, tick, axisTitle, valueLine, annotation, growth, activity, item; each chart reads its own, and a kind it does not read is refused) to true, false or content parts from absolute, percent, category and series. Another part is dropped with a warning; value draws as absolute. On a stacked column with one PY reference series, { growth: false } drops the growth arrows over the totals (↑ 6.1%) and keeps the PY ticks and their labels; { percentIndicator: false } drops the 100% marker of a 100% chart. On bar, box, column, combo, dot, line, Mekko, slope and variance, false keeps category names; { category: false } hides them. On bullet, butterfly, funnel, heatmap, pyramid and status, false keeps the row, column and stage names; on kpi it keeps the main number and the card name. Grid panels can leave category names to the grid. On a line, series false turns the series names off and point sets what each printed value shows, so { point: ['category', 'absolute'] } prints 08-16 44.7 at the point. On a stacked column or combo, { segment: ['absolute', 'percent'] } prints each segment value over its share of the stack; a stack with a negative or missing part prints the value alone and warns. restSeries sets the values of a stacked column, bar or area series whose colorRole is others: absent, they print everywhere except the dashboard target, where the hover card and the note line carry them; true prints them, false hides and notes them on every target."),
  categoryLabels: categoryLabelsSchema,
  labelPlacements: z.record(z.string(), z.string().describe('Requested solver slot id, such as insideCenter.')).optional().describe('Authored placement pins keyed by label id; the solver checks each requested slot. On a line, a pinned end label removes the legend step of the end-label ladder. The slots a label can take depend on the chart and its data; a wrong slot warns unknown-slot and lists the valid and free slots of that render.'),
  legend: keyOptionSchema(['top', 'bottom', 'none', 'auto'])
    .optional()
    .describe(
      "A key without a named position sits in one row above the plot, flush with it, under the subtitle; more items wrap to further rows and move the plot down. 'bottom' puts the row under the plot. 'right' is refused: a key beside the plot takes the plot's width. 'auto' adds keys when visible labels do not name every drawn series. A displayed subtitle measure or unit can name one primary series, matching the complete phrase without case sensitivity. Required explanatory keys remain, except the keys of a table, heatmap, cohort and variance, which 'none' drops for a host that draws its own. Automatic keys use footnote type in the top row. Explicit settings override theme.legend.auto, which defaults to false. Multi-series column, bar, combo, dot and scatter charts add a key when direct names are missing. A series key explains its scenario styling. Grids keep a required key under 'none' when direct names are incomplete.",
    ),
  valueAxis: valueAxisSchema
    .optional().describe('Value-axis display and domain settings; each chart schema narrows the supported fields.'),
  categoryAxis: z
    .object({
      crossesBetween: z.boolean().optional().describe('Line-chart category placement: default true centres categories in bands; false places the end categories at the plot edges.'),
      dateTicks: z.enum(['years', 'quarters', 'months', 'weeks', 'days']).optional().describe("Line-chart date tick interval. A short tick under the plot marks the first category of each calendar interval. 'years', 'quarters' and 'months' name those ticks on the calendar: quarters read Jan, Apr, Jul, Oct. A row too narrow for every name keeps a larger round step counted from January (years 2, 5, 10, 20, 25, 50 or 100, so every tenth year from 1980; quarters 2, 4, 8, 20 or 40; months 2, 3, 6, 12, 24, 60 or 120), at most eight names. The latest period is always named; if it collides with the tick before it, that tick drops. 'weeks' and 'days' count equal steps back from the latest period (weeks 2, 4, 13, 26 or 52; days 2, 7, 14 or 28) and name it too. 'years' names the year alone ('Jan 1980' reads 1980) where the label carries it. 'months' over day dates the engine labels names the month ('1 Apr 2025' reads Apr 2025, then May, Jun). A monthly series through July 2026 with 'years' reads 1980, 1990, 2000, 2010, 2020, Jul 2026. Without dateTicks, column, stacked column, line, area and combo pick tick months by the same calendar rule for rows of months and quarters (step 3: Jan, Apr, Jul, Oct; step 6: Jan, Jul; step 12: Jan; plus the latest period) and count back from the latest period for days and weeks, so side-by-side panels with the same categories show the same months. A line or area day row that would step past 28 days names months as 'months' does. Categories without an ISO date leave the option unused and report date-ticks-unsupported."),
    })
    .optional().describe('Category-axis settings implemented by line charts; other shared-base charts refuse this option.'),
  secondaryAxis: z.object({ acknowledge: z.literal(true).describe('Explicitly acknowledge that the chart uses an independent second value scale.') }).optional().describe('Opt in to a second value scale on supported charts; combo adds chart-specific secondary-axis options.'),
  scaleGroup: z.object({
    // x shares nothing: no type reads back or pins its x domain, so it is refused.
    x: z
      .never({ error: "'scaleGroup.x' is not implemented — only the value scale is shared, through scaleGroup.y; no chart type pins its x domain. Drop x" })
      .optional()
      .describe('Refused: no chart type shares an x scale. Share the value scale with scaleGroup.y.'),
    y: z.string().optional().describe('Shared value-scale group id for compatible grid panels, charts of one envelope or separately mounted cards; members of the same group use a combined domain.'),
    id: z.string().optional().describe('Stable member id inside the scale group declared on the host ScaleGroup; reordering or removing cards does not change which member this chart is.'),
  }).optional().describe('Scale-group identities for panel composition. Charts of one envelope that name the same y group draw on one domain, and a chart that cannot join (another unit, no numeric y scale) refuses the request. A chart alone in its group, or a single chart, keeps its own scale for the host to share. x is refused: no chart type shares an x scale.'),
  rowLabels: z
    .object({
      align: z
        .enum(['left', 'right'])
        .optional()
        .describe(
          "Row-label alignment on a horizontal category axis; defaults to 'left' (one shared left edge), and to 'right' on a dot chart. 'right' pushes each label block against the plot.",
        ),
    })
    .optional()
    .describe('Row-label alignment for the horizontal families (bar, bullet, box, dot, likert).'),
  sort: z
    .object({
      categories: z.enum(['sheet', 'asc', 'desc', 'reverse']).optional().describe('Category order: sheet preserves authored order, reverse reverses it, asc and desc use the chart category ranking value.'),
      segments: z.enum(['sheet', 'asc', 'desc', 'reverse']).optional().describe('Segment order: sheet preserves authored order, reverse reverses it, asc and desc use the chart segment ranking value.'),
    })
    .optional().describe('Sorting requests for charts that support them; omitted settings preserve the chart default ordering.'),
  topN: z
    .object({
      n: z.number().int().positive().describe('Maximum number of individually retained categories after chart-specific ranking.'),
      rest: z.boolean().optional().describe('Aggregate remaining categories into a rest bucket by default; false omits them where supported. On a bar mekko the rest bucket is the width-weighted mean of its rates. Pareto retains the bucket to preserve its population.'),
      restLabel: z.string().optional().describe('Authored rest-bucket name; ordinary charts default to Others and Pareto to Rest.'),
      showRestCount: z.boolean().optional().describe('Append the number of aggregated categories; ordinary charts default to false, while Pareto always discloses the count.'),
      threshold: z.number().optional().describe('Bar-chart minimum absolute category total after the rank cut; not a universal Top-N threshold. Pareto warns that it ignores this field.'),
    })
    .optional().describe('Chart-specific Top-N selection and rest aggregation; omission retains all categories. On a choropleth world map, topN.n picks the n regions it labels, largest absolute value first; other maps label every region.'),
  // No registered layout implements this. Accepting it on the shared base
  // would let every type answer `ok:true` to `transpose: true` and draw the
  // identical chart.
  // `z.never` refuses it out loud instead — the same call the `break.style`
  // enum above makes: never advertise a value the runtime rejects 100% of the
  // time. Orientation here is a chart TYPE, so the message names the type.
  transpose: z
    .never({ error: TRANSPOSE_REFUSED })
    .optional()
    .describe("Refused on every type: orientation is chosen by picking the chart type ('bar' vs 'column')."),
  bandFraction: z.number().gt(0).lte(1).optional().describe('Fraction of a category band occupied by its mark, greater than zero and at most one; default is chart-specific, commonly 0.7.'),
  highlight: z.union([idSchema, z.array(idSchema).describe('Data ids to highlight together.')]).optional().describe('One or more data ids selected for chart-specific visual emphasis. Selected marks take color.focus, and color.highlight on a theme that sets no focus. On a single-series bar, column or dot chart the named categories take it and every other mark steps back to color.neutralLight, the rest role. A series fill or colorRole outranks both colours; scenario marks keep their pattern and signColor its good/bad colours, and unhighlighted scenario marks keep their scenario colour. A highlight with no visible mark (null, or a zero bar or column) recedes nothing. On a line the named series take it at 2.6px and the others step through muted tints toward ink, with a swatch on each end label. On an unstacked area with several series the first named series is the one that is filled.'),
  story: z
    .strictObject({
      steps: z.array(z.strictObject({
        id: z.string().min(1).describe('Step id, as the React step prop names it.'),
        title: z.string().min(1).describe('Panel title.'),
        body: z.string().optional().describe('Panel text.'),
        highlight: z.union([idSchema, z.array(idSchema)]).optional().describe('Data ids the step brings forward, as in highlight; the other marks fade. Omitted: an intro.'),
      })).min(1).describe('Steps in order.'),
      step: z.string().min(1).optional().describe('Step static output draws; default the first.'),
    })
    .optional()
    .describe("Guided steps over one chart. Each step fades the marks it does not name and shows a panel with its title and body. React needs withStory from boardplot/react/story."),
  focus: z
    .strictObject({
      owner: ownerSchema
        .refine((owner) => Object.values(owner).some((value) => value !== undefined), {
          message: 'A focus owner needs at least one source identity.',
        })
        .describe('Source owner to emphasise. A label is selected when its own owner carries every key named here with the same value, so a seriesId alone selects that series and a seriesId+categoryId pair selects one point.'),
    })
    .nullable()
    .optional()
    .describe('Active source focus: labels whose owner the focus selects sort ahead in the solve order, because the focus adds a 250-point bonus to the label\'s sort key on top of its authored priority. The bonus can carry a focused label past a higher authored band, which is the point: a focused series or category wins contested label space. Layout only — totals, shares, scales and claims are unchanged, and a focused label still loses to the density gate, to an owned pin and to a collision. Omit the key (or set null) for byte-identical layout; null clears an inherited focus explicitly. On a grid, set it on the panel options that own the focus; sibling panels are separate layouts and never see it.'),
  hatchStrength: z.number()
    .min(0, { error: 'hatchStrength runs from 0 to 100; set 0 for the faintest hatch that still reads, 100 for the theme\'s recipe' })
    .max(100, { error: 'hatchStrength runs from 0 to 100; set 100 for the theme\'s recipe, lower for a lighter hatch' })
    .optional()
    .describe("How strongly forecast, partial-period and no-data hatches draw, 0 to 100; 100 is the theme's recipe. Lower values fade the stripes toward their ground and, on a line or area forecast, spread them up to 2.5 times the theme's gap. The fade stops at a floor: where the hatch is the only cue (a forecast column or bar, a partial period, a no-data cell) the stripes keep 3:1 on their ground and their spacing; on a line or area forecast, where the dashed line, the divider and the key already mark the forecast, they keep 2:1. A status cell lays its stripes on its own tone: there 60 is the theme's recipe at 3:1, 100 deepens the stripes to 4.5:1 on the same ground, and lower values fade them only as far as the cell stays apart from a cell with no status. Default 60 on a line or area forecast and a status cell, 100 elsewhere. The key swatch draws the same hatch."),
  colorblindSafe: z.boolean().optional().describe("Paint the semantic good/bad pair from theme.color.colorblind, a pair told apart without red and green: signed bars and columns, variance bars, status cells, heatmap valence cells, table tones, heat grounds, in-cell bars and badges, and the poles of a diverging choropleth or tilemap scale. Other types refuse this option. Use palette for categorical colours."),
  rounding: z.enum(['nearest', 'sum-consistent']).optional().describe("How computed shares print. nearest rounds each share separately. sum-consistent uses largest remainders to total 100%. For equal remainders, when the sum must go up, round up the smaller share first; when the sum must go down, take the step from the larger share first. Equal-size ties use the first input index. reading.rounding lists changes. Use format: 1.0% for one decimal. Mekko cell, series and chart share formats set the precision. Bar, column and combo stacks default to sum-consistent for each complete stack; a column's shares keep the chart's one share precision or shareLabels.format. Incompatible precisions or more than 13 decimals warn and keep the requested formats without sum-consistent rounding."),
  animate: z.boolean().optional().describe('Reserved motion flag; registered charts currently refuse it because the engine emits static geometry.'),
  interactive: z
    .boolean()
    .optional()
    .describe('Emit data-bp-* semantics for dependency-free web interactivity; static output is unchanged by default.'),
  debug: z.boolean().optional().describe('Reserved layout debug flag; registered charts refuse it.'),
  annotations: annotationArraySchema(annotationSchema).optional().describe('Data-bound annotations in authored order; explicit ids must be unique and each chart advertises its supported kinds.'),
}).superRefine(addCanvasBoundsIssues).describe('Shared JSON chart options; selected chart schemas narrow unsupported fields and add chart-specific settings.');

/** The anomaly rule of column, line and combo: 'mad' or authored 'threshold' bounds. */
export const anomalyOptionSchema = z
  .union([
    z.object({
      method: z.literal('mad').describe("Use median absolute deviation to derive the anomaly corridor."),
      k: z
        .number()
        .positive()
        .optional()
        .describe(
          'Flag threshold on the absolute modified z-score; default 3.5, the published threshold of the modified z-score method with the 1.4826 MAD scale. Do not pair it with a 3.0 rule of thumb from a different method.',
        ).meta({ default: 3.5 }),
      baseline: z
        .enum(['zero', 'median'])
        .optional()
        .describe(
          "Centre of the judgement. 'zero' (default) reads the input as an already-computed deviation (surprise vs consensus, net cash movement, residual); 'median' centres on the series' own median. The SPREAD is measured around the actual median in both cases, so derived.anomaly reports `centre` and `median` as separate fields — under 'zero' they differ, and a levels series hands to this rule will flag almost everything (anomaly-most-flagged).",
        ).meta({ default: 'zero' }),
      label: z
        .string()
        .optional()
        .describe(
          'Names the rule on the exhibit. It is prefixed to the derived sentence, never a replacement — the median, MAD, k and corridor always stay printed.',
        ),
    }),
    z.object({
      method: z.literal('threshold').describe("Use authored low/high bounds to flag anomalies."),
      low: z.number().optional().describe('Flag values strictly below this bound.'),
      high: z.number().optional().describe('Flag values strictly above this bound.'),
      label: z.string().optional().describe('Names the rule on the exhibit; the bounds stay printed.'),
    }),
  ]);

/** The average marker of bar, column, dot and combo: on, off, or scoped to some series. */
export const averageMarkerSchema = z
  .union([
    z.boolean(),
    z.object({
      scope: z
        .union([z.literal('all'), z.array(idSchema).min(1)])
        .describe("Series included in the computed average; defaults to 'all'."),
    }),
  ])
  .optional();

/**
 * `base` with every valueAxis sub-key `type` does not read refused by name.
 * refusedBaseOptions applies it to the shared object; a type that extends the
 * object itself (scatter's clamp) passes its own.
 */
export function narrowValueAxis<S extends z.ZodObject>(type: string, base: S) {
  const refusals: Record<string, z.ZodType> = {};
  for (const key of Object.keys(valueAxisSchema.shape)) {
    const why = valueAxisRefusal(type, key);
    if (why === undefined) continue;
    const suggest = valueAxisReason(type, key, why);
    refusals[key] = z
      .never({ error: notImplemented(`valueAxis.${key}`, type, suggest) })
      .optional()
      .describe(`Refused on '${type}': ${suggest}`);
  }
  // Only bridges implement automatic placement. Other break-capable charts keep
  // their existing false/object contract in schemas, discovery and React entries.
  if (valueAxisRefusal(type, 'break') === undefined && type !== 'waterfall' && type !== 'pvm') {
    const [, noBreak, authoredBreak] = valueAxisSchema.shape.break.unwrap().options;
    refusals.break = z.union([noBreak, authoredBreak]).optional()
      .describe('No break by default or with false. Set { from, to, style? } for a straight value-axis break; the omitted span collapses to a fixed 12px gap when valid. Automatic placement is supported only by waterfall and pvm.');
  }
  return Object.keys(refusals).length ? base.safeExtend(refusals) : base;
}

/** A shared-base key whose admission is decided per type by the table above. */
type CapabilityGatedKey = keyof typeof OPTION_CAPABILITY;

/**
 * The refusals `T` gets: every gated key whose `implementedBy` does not name it.
 *
 * Written as a mapped type rather than left to inference because the obvious
 * signature — returning `Record<string, …>` — puts an INDEX SIGNATURE on the
 * extended shape, and zod then infers every unrelated property of the chart's
 * own schema as `never`. It typechecked as a helper and silently destroyed
 * `bar.netLine` and `status.states`; the compiler caught it, which is the only
 * reason this is a comment and not an incident.
 */
type RefusedBaseOptions<T extends string> = {
  [K in CapabilityGatedKey as (typeof OPTION_CAPABILITY)[K] extends { unsupportedSeverity: 'warn' }
    ? never
    : T extends (typeof OPTION_CAPABILITY)[K]['implementedBy'][number]
      ? never
      : K]: z.ZodOptional<z.ZodNever>;
};

/**
 * The extend payload that refuses every shared-base key `type` does not
 * implement. Applied at each chart's own `optionsSchema` declaration, so the
 * refusal travels with the schema the CLI, the MCP tool description and
 * `z.toJSONSchema` all read.
 *
 * `z.never().optional()` rather than `.omit()`: a zod object STRIPS unknown
 * keys, so omitting a key accepts it silently and drops it (as it would on
 * `pareto.sort`, `likert.sort`, `likert.topN`, `pyramid.topN` and
 * `status.legend`). That is worse than the defect this table exists to remove
 * because the key then leaves the published schema and no census can see it.
 * `never` keeps the key visible, publishes it as `{ "not": {} }`, and answers
 * with a sentence naming where the option does work.
 */
export function refusedBaseOptions<T extends string>(type: T): RefusedBaseOptions<T> {
  const out: Record<string, z.ZodOptional<z.ZodNever>> = {};
  for (const [key, capability] of Object.entries(OPTION_CAPABILITY)) {
    if ((capability.implementedBy as readonly string[]).includes(type)) continue;
    if ('unsupportedSeverity' in capability && capability.unsupportedSeverity === 'warn') continue;
    const suggest = OPTION_REASONS[key as keyof typeof OPTION_REASONS];
    out[key] = z
      .never({ error: notImplemented(key, type, suggest) })
      .optional()
      .describe(`Refused on '${type}': ${suggest}`);
  }
  if (Object.hasOwn(LEGEND_DRAWS, type)) {
    const values = LEGEND_DRAWS[type]!;
    const why = LEGEND_DRAWS_REASONS[type]!;
    (out as Record<string, z.ZodType>).legend = baseOptionsSchema.shape.legend.unwrap()
      .superRefine((value, ctx) => {
        if (legendDrawsNothing(type, value)) {
          ctx.addIssue({ code: 'custom', message: `legend '${String(value)}' draws nothing on '${type}' — ${why}`, params: { refused: true } });
        }
      })
      .optional()
      .describe(`On '${type}' only ${values.map((value) => `'${value}'`).join(' and ')} or a position object draw a key: ${why}.`);
  }
  if (LEGEND_REFUSED.includes(type)) {
    out.legend = z
      .never({ error: notImplemented('legend', type, LEGEND_REFUSED_REASONS[type]!) })
      .optional()
      .describe(`Refused on '${type}': ${LEGEND_REFUSED_REASONS[type]}`);
  }
  const only = valueAxisOnly(type);
  const valueAxis = narrowValueAxis(type, valueAxisSchema);
  if (only?.keys.length === 0) {
    out.valueAxis = z
      .never({ error: notImplemented('valueAxis', type, VALUE_AXIS_ONLY_REASONS[type as keyof typeof VALUE_AXIS_ONLY_REASONS]) })
      .optional()
      .describe(`Refused on '${type}': ${VALUE_AXIS_ONLY_REASONS[type as keyof typeof VALUE_AXIS_ONLY_REASONS]}`);
  } else if (valueAxis !== valueAxisSchema) {
    (out as Record<string, z.ZodType>).valueAxis = valueAxis.optional().describe(baseOptionsSchema.shape.valueAxis.description!);
  }
  return out as RefusedBaseOptions<T>;
}

/** sharesOfOneWhole declares a stack; on any other variant it would do nothing, so it is refused. */
export function refuseUnstackedShares(options: { variant?: string; sharesOfOneWhole?: boolean }, ctx: z.RefinementCtx): void {
  if (options.sharesOfOneWhole === undefined || options.variant === 'stacked' || options.variant === 'stacked100') return;
  ctx.addIssue({
    code: 'custom',
    path: ['sharesOfOneWhole'],
    message: `sharesOfOneWhole declares the parts of a stack; variant '${options.variant ?? 'grouped'}' stacks nothing. Set variant 'stacked' or 'stacked100', or remove it`,
    params: { refused: true },
  });
}

/** Provider-only reader wording; never passed into chart layout. */
export const readerStringsSchema = z.object({
  refusalMessage: z.string().optional().describe('Reader heading for a size refusal. Legacy width and height templates remain available only in full diagnostics.'),
  refusalHint: z.string().optional().describe('Reader hint for a size refusal; EN and DE defaults.'),
  emptyMessage: z.string().optional().describe('Reader heading for empty data; EN and DE defaults.'),
  emptyHint: z.string().optional().describe('Reader hint for empty data; EN and DE defaults.'),
  failureMessage: z.string().optional().describe('Reader heading when a chart cannot be shown; EN and DE defaults.'),
  failureHint: z.string().optional().describe('Reader hint when a chart cannot be shown; EN and DE defaults.'),
  diagnosticDetails: z.string().optional().describe('Label for the developer details disclosure; default Details.'),
});
