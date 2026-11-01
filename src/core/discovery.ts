import { readingCountsSchema, readingMetricStackSchema } from './schema/reading';
/** Schema-backed discovery for CLI, MCP and docs. Never imported by browser chart cores. */
import * as z from 'zod';
import { getFixtures } from '../fixtures';
import { BARE_CHART_NAME, NAME_RULE } from './doc/document';
import { getChartDefinition } from './registry';
import { schemaReference, type SchemaFieldReference } from './schema/reference';
import { ANNOTATION_KIND_PURPOSES, type AnnotationKind } from './types/annotations';
import { fieldLine, firstClause, optionFields, PRESET_THEME_NAMES, sharedOptionFields, shortSummaryFor, useCasesFor, chartIds, chartIdOf, compactDesignCard, designCardFor } from './catalog';
import { themeFieldReference } from './themeFields';
import { themes } from './theme';

/** A bare chart's `name` as describe shows it: it sits beside data and options, in neither. Kept here, off the browser bundle. */
const BARE_NAME_FIELD = {
  path: 'name',
  type: 'string',
  default: BARE_CHART_NAME,
  description: `Output file name and chart identity of a bare chart: ${NAME_RULE}. A taken file name gets -2; an existing file is never replaced.`,
};

interface AnnotationAnchor {
  field: string;
  type: 'AnchorRef' | 'AnchorRef | number' | 'categoryId';
  required: boolean;
}

/** A field only some layouts read names the chart types that read it. */
type OptionalField = string | { meaning: string; types: readonly string[] };

/**
 * The kind-specific optional fields. The annotation schema accepts them as
 * extra fields and the annotation pass validates them, so the option tables
 * do not list them; describe does, per kind and chart type. A field limited
 * to `types` is listed only for those types: elsewhere the layout does not
 * supply what it needs and it draws nothing.
 */
/** The types that draw events in the event lane; gantt draws its own event rules. */
const LANE_TYPES = ['column', 'combo', 'line'] as const;

/** The gap bracket fields of delta and diff (annotateGapBracket.ts). */
const GAP_BRACKET_FIELDS: Record<string, OptionalField> = {
  placement: {
    meaning: "auto | label | bracket, default auto. With both ends on two different series at the last category, bracket draws the gap bracket in the right margin: an open ring on each end point, a dashed guide from each ring to the margin, a bracket with an arrowhead toward the measured end, and the gap as a large number beside it; the end values sit just over and under their guides. auto draws the bracket where gapFill washes the same two series and the label elsewhere. label keeps the label at the anchor. bracket on other anchors, or on stacked variants (stacked-area, stacked100-area), warns gap-bracket-unavailable and keeps the label.",
    types: ['line'],
  },
  caption: {
    meaning: 'string. A short line under the bracket number that says what it measures, right-aligned in muted ink. Only a gap bracket prints it; elsewhere it warns gap-caption-ignored.',
    types: ['line'],
  },
};

const ANNOTATION_OPTIONAL: Partial<Record<AnnotationKind, Record<string, OptionalField>>> = {
  diff: { mode: "relative | absolute | reversed, default relative. relative prints the percent change from 'from' to 'to', reversed the change from 'to' to 'from', absolute the value difference.", ...GAP_BRACKET_FIELDS },
  delta: GAP_BRACKET_FIELDS,
  cagr: {
    suffix: "string, default 'p.a.'. Text after the rate.",
    period: "boolean. Print the period before the rate from the anchors' category labels, '2014–2019: +5.8% p.a.'. Default true when the chart carries two or more CAGRs, so nested brackets are told apart by their text, false otherwise. An arrow's ends show its span, so an arrow prints the rate alone unless period is true.",
    shape: "bracket | arrow, default bracket. arrow draws one straight arrow over the marks with the rate in an oval on it, lifted until it clears them. Where no straight line clears the chart, the span is too short for the oval, a stack's inner layer is the anchor or the chart lays comparisons out itself, it draws the bracket and warns cagr-arrow-no-room.",
  },
  callout: {
    preferSide: 'left | right | above | below. Side the solver tries first; the label keeps a leader when it moves.',
    headline: 'string. A bold first line over the text, which then prints in plain type; ${value} in it prints the anchored value from the data. Example: "headline": "${value}", "text": "Peak in handheld-loom demand" prints 153 in bold over the words.',
    arrow: 'boolean, default false. A thin arrow from the text to the anchored point; the first line sits level with the point, right or left of it, where there is room. Not with icon or status. Example: "arrow": true.',
  },
  valueLine: {
    value: "number | 'mean', default mean. A number draws the line there; mean has the engine compute it.",
    valueKind: "'fraction'. Multiply a numeric value and its tolerance by 100 before layout: 0.35 draws at 35%. Independent of data.valueKind. Omit it for values already in percent points; not valid with mean.",
    seriesId: { meaning: 'string. Series whose mean is measured.', types: ['line'] },
    label: 'string | false. Name plus value; ${value} sets its position. A number already in the name is kept once. false hides it.',
    side: {
      meaning: 'left | right, default right. Side of the plot the label sits on.',
      types: ['column', 'combo', 'line', 'mekko', 'pvm', 'scatter', 'variance', 'waterfall'],
    },
    axis: { meaning: 'primary | secondary, default primary. Scale of value; secondary needs an acknowledged secondary axis.', types: ['combo'] },
    tolerance: {
      meaning: 'number | { low, high }. A number shades that distance on both sides of the line; low and high shade an authored corridor.',
      types: ['bar', 'bullet', 'column', 'combo', 'line', 'mekko', 'pvm', 'scatter', 'slope', 'variance', 'waterfall'],
    },
    attainment: { meaning: 'boolean | { seriesId, direction }. Shades each category between its actual and the line.', types: ['bar', 'bullet', 'column', 'line'] },
  },
  bracket: { label: 'string. Name printed before the sum, "Commercial +81". Without it the bracket prints the sum alone.' },
  indicator100: { side: 'left | right, default left. Side of the plot the 100% mark sits on.' },
  event: {
    date: { meaning: "ISO date yyyy-mm-dd, in place of at: the event sits at the last category whose date is on or before it, and the block header and the key print it as d MMM. Every category needs an ISO date; a date outside the categories warns event-out-of-range.", types: LANE_TYPES },
    end: { meaning: 'ISO date, with date: the event is a period, drawn as a thin bar to the end of that day.', types: LANE_TYPES },
    to: { meaning: 'Category id, with at: the event is a period to the end of that category.', types: LANE_TYPES },
    group: { meaning: 'Id of a group in options.events.groups, which gives the kind label, tone and glyph.', types: LANE_TYPES },
    detail: { meaning: 'string | string[]. Authored lines under the title, at most three in the lane; nothing is cut, a longer block moves to the key.', types: LANE_TYPES },
    items: { meaning: "{ label, detail? }[]. More changes on the same date, after this event's own label and detail. The lane and the key draw a compact +N after the title; the hover card, the SVG title and description, and the interaction records list every item in full.", types: LANE_TYPES },
    placement: { meaning: "auto | key, default options.events.placement. key numbers this event into the key below the plot.", types: LANE_TYPES },
    tone: 'neutral | bad | good, default the group tone, else neutral. Column, combo and line paint the glyph, the marker ring and the period bar in it; gantt paints a bad rule.',
    labelPlacement: { meaning: 'top | inline | badge, default top. inline (line) sets the block beside its rule inside the plot. badge (gantt) draws the label, at most 3 characters, in a filled circle at the top of its rule; badge events never go to the numbered key.', types: ['line', 'gantt'] },
  },
};

/** The optional fields of one annotation kind that this chart type reads. */
function optionalFields(kind: AnnotationKind, type: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, field] of Object.entries(ANNOTATION_OPTIONAL[kind] ?? {})) {
    if (typeof field === 'string') fields[name] = field;
    else if (field.types.includes(type)) fields[name] = field.meaning;
  }
  return fields;
}

/** Anchor requirements come from Annotation and the shared annotation pass, whose schema permits extra fields. */
function describeAnnotation(kind: AnnotationKind, type: string) {
  let anchors: AnnotationAnchor[] = [];
  let requiredFields: string[] = [];
  let notes: string[] = [];
  switch (kind) {
    case 'diff':
    case 'cagr':
      anchors = ['from', 'to'].map(field => ({ field, type: 'AnchorRef', required: kind === 'diff' }));
      notes = kind === 'diff'
        ? ['Mode defaults to relative. Relative and reversed changes need a nonzero base; negative bases use its absolute magnitude and emit a warning. Absolute mode reports the raw value difference. A hidden label removes its arm.']
        : ['Omitted endpoints span the first to the last category, or the first to the last total on a waterfall. Resolved endpoints need a positive date interval from ISO dates or year-bearing labels and a positive start value; an end of zero reads -100%, and a start at or below zero or a negative end omits the rate and warns cagr-undefined. On a continuous time axis the years are the exact span between the two readings. An anchor on one series of several (seriesId, or a line category, which reads the first drawn series) names that series in the label, "Product B +10.1% p.a.", and the arm runs from that series\' segment or point. In text, ${value} prints the rate with its suffix, so "CAGR 2014–2019: ${value}" keeps the computed number.'];
      break;
    case 'delta':
      anchors = [{ field: 'at', type: 'AnchorRef', required: true }, { field: 'vs', type: 'AnchorRef | number', required: true }];
      break;
    case 'bracket':
      anchors = ['from', 'to'].map(field => ({ field, type: 'categoryId', required: true }));
      notes = ['from and to are step ids, inclusive. The engine adds the steps up and prints the signed sum; every step in the span must be a delta, so a span that holds a total is refused with bracket-span-total. A step the bridge cannot add (an open start) refuses it with bracket-span-no-value. Brackets stand in one row above the steps. Vertical bridges only.'];
      break;
    case 'abs':
    case 'note':
    case 'callout':
      anchors = [{ field: 'at', type: 'AnchorRef', required: true }];
      if (kind === 'note' || kind === 'callout') requiredFields = ['text'];
      break;
    case 'event':
      if (type === 'gantt') {
        anchors = [{ field: 'at', type: 'AnchorRef', required: true }];
        notes = ['An ISO date or a schedule item id positions the rule. Above three events the labels move to numbered footnotes.'];
      } else {
        anchors = [{ field: 'at', type: 'categoryId', required: false }];
        notes = [
          "Exactly one of at (a category id) and date (an ISO date) places the event; end or to makes it a period. The event lane above the plot sets a block of group and date, title and detail with a thin pole to the data; an event that does not fit, a second event on one category and every event under options.events.placement 'key' get a numbered marker and an entry in the key below the plot, numbered in time order; under footnotes: false they are left off and listed in the footnotes-off lint. The full date, title and detail of every event stay in the SVG title and description, the interaction records and the hover card, whether or not the lane or the key prints the detail. In compact mode the lane is one row of numbered markers and the key packs \"n date title\" into as few lines as the width allows; where the plot would still fall under 80px the key keeps \"n title\" and the info lint event-lane-compact says so. options.events.rows sets the lane rows (default by canvas width: 1 under 1080px, 2 from 1080px); a row gives way while the plot band left under the lane would keep less than 40% of the canvas height.",
        ];
      }
      requiredFields = ['label'];
      break;
    case 'band':
      anchors = ['from', 'to'].map(field => ({ field, type: 'categoryId', required: false }));
      notes = ['Era shade/bracket needs inclusive category IDs. Corridor and tolerance use finite low/high on the value scale, with optional from/to as a category clip. Attainment needs a plan value and shades each resolved actual; missing cells are skipped. Divider applies only to bracket bands. Scenario AC/PY/PL/FC paints a plan corridor (default PL).'];
      break;
    case 'valueLine':
      anchors = ['from', 'to'].map(field => ({ field, type: 'categoryId', required: false }));
      notes = ['No anchor is required. Value defaults to mean. Scoped means are line-only: seriesId and paired from/to compute a primary-axis mean and limit its stroke to those bands; other types refuse scope fields for a mean. Numeric values cannot use scope fields except as a category clip with tolerance or attainment. A secondary-axis line needs an acknowledged secondary scale and an explicit numeric value. Optional tolerance shades a value-axis band; optional attainment fills between the line and resolved actuals.'];
      break;
    case 'indicator100':
      notes = ['No anchor is required. The chart needs a value scale that can represent 100.'];
      break;
  }
  if (kind === 'diff' && type === 'line') notes.push('Diff labels precede point and end labels. Same-category arms attach there; anchored strokes do not displace them.');
  if (kind === 'diff' && type === 'dot') notes.push('The arm follows the horizontal value axis and clears the connector.');
  if (['diff', 'cagr', 'delta', 'abs', 'note', 'callout'].includes(kind) && ['line', 'bar', 'column', 'combo'].includes(type)) {
    notes.push(`Drawn reference series accept anchors.${type === 'line' ? ' Bad anchors report the cause and valid ids.' : ''}`);
  }
  return { kind, use: ANNOTATION_KIND_PURPOSES[kind], anchors,
    requiredFields: [...anchors.filter(anchor => anchor.required).map(anchor => anchor.field), ...requiredFields],
    optional: optionalFields(kind, type), notes };
}

/** One field in full detail: every fact the schema declares, with its whole description. */
interface FieldRow {
  path: string;
  type: string;
  required?: true;
  values?: unknown[];
  /** The values are one branch of the field; it also takes another shape of its type. */
  valuesOpen?: true;
  default?: unknown;
  /** The default has no one value: it follows these options, data paths, the theme or the size. */
  defaultDependsOn?: string[];
  description: string;
  branch?: string;
}

function childKeys(fields: readonly Pick<SchemaFieldReference, 'path'>[], prefix: string): Set<string> {
  return new Set(fields.filter((field) => field.path.startsWith(prefix)).map((field) => field.path.slice(prefix.length).split(/[.[]/)[0]!));
}

/**
 * The shared value cell (number, pct or date object) is described once in
 * boardplot_list. A field or array whose items are cells folds into one row;
 * returns the folded type, or undefined when the field is not a cell.
 */
export function cellType(fields: readonly Pick<SchemaFieldReference, 'path'>[], path: string): string | undefined {
  const isCell = (keys: Set<string>) => keys.has('number') && keys.has('pct') && keys.has('date');
  if (isCell(childKeys(fields, `${path}.`))) return 'cell';
  const items = childKeys(fields, `${path}[].`);
  if (!isCell(items)) return undefined;
  return items.has('categoryId') ? '(cell | { categoryId, value: cell })[]' : 'cell[]';
}

interface CompactField { field: SchemaFieldReference; type?: string; meaning: string }

type MergedField = SchemaFieldReference & { selects?: true };

/**
 * Schema alternatives repeat a path, such as `kind` on every branch of a
 * discriminated union. Each path becomes one row: its values are the union of
 * the branches' values, it is required only when every branch requires it,
 * and a description that differs per branch is kept per value. `selects`
 * marks a field whose value picks the branch.
 */
function mergeAlternatives(fields: readonly SchemaFieldReference[]): MergedField[] {
  const byPath = new Map<string, SchemaFieldReference[]>();
  for (const field of fields) {
    if (field.type === 'never') continue;
    const key = `${field.path}\0${field.branch ?? ''}`;
    const branches = byPath.get(key);
    if (branches) branches.push(field);
    else byPath.set(key, [field]);
  }
  return [...byPath.values()].map((branches) => {
    const [first] = branches as [SchemaFieldReference, ...SchemaFieldReference[]];
    if (branches.length === 1) return first;
    const descriptions = [...new Set(branches.map((branch) => branch.description))];
    const selects = descriptions.length > 1 && branches.every((branch) => branch.values?.length);
    const values = [...new Set(branches.flatMap((branch) => branch.values ?? []))];
    const withDefault = branches.find((branch) => Object.hasOwn(branch, 'default'));
    return {
      path: first.path,
      ...(first.branch ? { branch: first.branch } : {}),
      type: [...new Set(branches.flatMap((branch) => branch.type.split(' | ')))].join(' | '),
      required: branches.every((branch) => branch.required),
      description: selects
        ? branches.map((branch) => `${branch.values!.map(String).join(', ')}: ${branch.description}`).join(' ')
        : descriptions.join(' '),
      ...(values.length ? { values } : {}),
      ...(values.length && !branches.every((branch) => branch.values?.length && branch.valuesExhaustive !== false) ? { valuesExhaustive: false } : {}),
      ...(withDefault ? { default: withDefault.default, ...(withDefault.defaultInSchema ? { defaultInSchema: true as const } : {}) } : {}),
      ...(!withDefault && first.defaultDependsOn ? { defaultDependsOn: first.defaultDependsOn } : {}),
      ...(selects ? { selects: true as const } : {}),
    };
  });
}

/** A reserved field does nothing an author can use yet, a deprecated one has a successor; compact discovery leaves both out. */
function isReserved(field: Pick<SchemaFieldReference, 'description'>): boolean {
  return /^(Reserved|Deprecated)\b/.test(field.description);
}

/**
 * The fields discovery shows. A path repeated by schema alternatives is listed
 * once with the values of every branch, a cell folds into one row, and a subtree whose fields repeat an
 * earlier subtree is folded into one row that names the earlier path. Refused
 * (`never`) fields are not shown: a field that is not listed is not accepted.
 */
function compactFields(all: readonly SchemaFieldReference[]): CompactField[] {
  const fields = mergeAlternatives(all);
  const rows: CompactField[] = [];
  const folded: string[] = [];
  for (const field of fields) {
    if (isReserved(field)) continue;
    if (folded.some((prefix) => field.path.startsWith(`${prefix}.`) || field.path.startsWith(`${prefix}[]`))) continue;
    const declaredValues = field.description.match(/\bOne of .*/)?.[0];
    const meaning = field.selects ? 'Selects which fields this entry takes.'
      : firstClause(field.description) + (declaredValues ? ` ${declaredValues}` : '');
    const cell = cellType(fields, field.path);
    if (cell) {
      folded.push(field.path);
      rows.push({ field, type: cell, meaning });
      continue;
    }
    rows.push({ field, meaning });
  }
  return rows;
}

/**
 * Compact rows keyed by path: `type[, required][, one of ...][, default ...]. clause`.
 * A long row that repeats an earlier row word for word points at it instead.
 */
function fieldLines(fields: readonly SchemaFieldReference[], withRequired = false): Record<string, string> {
  const lines: Record<string, string> = {};
  const first = new Map<string, string>();
  const grouped = new Map<string, CompactField>();
  for (const row of compactFields(fields)) {
    const { branch, ...facts } = row.field;
    const tag = branch?.match(/branch (\d+)/g)?.map(value => value.slice(7)).join('/');
    const key = JSON.stringify([facts.path, facts.type, facts.required, facts.values, facts.valuesExhaustive, facts.default, row.type, row.meaning]);
    const earlier = grouped.get(key);
    if (earlier && tag) earlier.field.branch += `|${tag}`;
    else grouped.set(key, { ...row, field: { ...facts, ...(tag ? { branch: tag } : {}) } });
  }
  for (const row of grouped.values()) {
    const earlier = first.get(row.meaning);
    const reference = earlier && earlier !== row.field.path ? `See ${earlier}.` : undefined;
    const meaning = reference && reference.length < row.meaning.length ? reference : row.meaning;
    if (!earlier) first.set(row.meaning, row.field.path);
    // Short string-literal unions state the type and all allowed values once.
    const literal = !row.type && row.field.type === 'string' && !!row.field.values?.length && row.field.values.length <= 3 && row.field.valuesExhaustive !== false;
    const line = fieldLine(literal ? { ...row.field, values: undefined } : row.field, meaning, {
      required: withRequired && row.field.required,
      ...(literal ? { type: row.field.values!.map(value => JSON.stringify(value)).join(' | ') } : row.type ? { type: row.type } : {}),
    }).replace(/\. $/, '');
    const fact = row.field.branch ? `branch ${row.field.branch}: ${line}` : line;
    lines[row.field.path] = lines[row.field.path] ? `${lines[row.field.path]}; ${fact}` : fact;
  }
  return lines;
}

/** Full rows: every declared fact and the whole description, one row per path. */
export function fieldRows(fields: readonly SchemaFieldReference[], withRequired = false): FieldRow[] {
  return mergeAlternatives(fields).map((field) => ({
    path: field.path,
    ...(field.branch ? { branch: field.branch } : {}),
    type: field.type,
    ...(withRequired && field.required ? { required: true as const } : {}),
    ...(field.values ? { values: field.values } : {}),
    ...(field.values && field.valuesExhaustive === false ? { valuesOpen: true as const } : {}),
    ...(Object.hasOwn(field, 'default') ? { default: field.default } : {}),
    ...(field.defaultDependsOn ? { defaultDependsOn: field.defaultDependsOn } : {}),
    description: field.description,
  }));
}

const COMPACT_FIXTURES = 5;

/**
 * The option rows describe shows for one type: its own fields, plus every
 * shared field whose contract differs here (pie's topN default, mekko's mode,
 * choropleth's labels). Shared fields the type refuses (`never`) or lacks are
 * named in `notAccepted` instead, as are the keys other types take that this
 * one refuses by name. The annotation subtree is left to the
 * `annotations` section, which lists the kinds this type draws.
 */
function typeOptions(type: string): { own: SchemaFieldReference[]; notAccepted: string[] } {
  const base = new Map<string, SchemaFieldReference>();
  for (const field of sharedOptionFields()) if (!base.has(field.path)) base.set(field.path, field);
  const all = optionFields(type);
  const firstByPath = new Map<string, SchemaFieldReference>();
  for (const field of all) if (!firstByPath.has(field.path)) firstByPath.set(field.path, field);
  const contract = (field: SchemaFieldReference) => fieldLine(field, firstClause(field.description));
  const own = all.filter((field) => {
    const shared = base.get(field.path);
    if (!shared) return true;
    if (field.path === 'annotations' || field.path.startsWith('annotations[')) return false;
    return field.type !== 'never' && contract(field) !== contract(shared);
  });
  // valueAxis sub-keys are narrowed per type too (VALUE_AXIS_CAPABILITY), so
  // they are named here unless the whole object is refused.
  const advertised = [...base.values()].filter((field) =>
    (!/[.[]/.test(field.path) || /^valueAxis\.\w+$/.test(field.path)) && field.type !== 'never' && !isReserved(field));
  const refused = (path: string) => { const here = firstByPath.get(path); return !here || here.type === 'never'; };
  const notAccepted = advertised
    .filter((field) => refused(field.path) && !(field.path.startsWith('valueAxis.') && refused('valueAxis')))
    .map((field) => field.path);
  // Keys another type takes that this one refuses by name (slope's seriesLabels).
  const refusedOwn = [...firstByPath.values()].filter((field) => field.type === 'never' && !base.has(field.path) && !/[.[]/.test(field.path));
  return { own, notAccepted: [...notAccepted, ...refusedOwn.map((field) => field.path)] };
}

function fields(schema: z.ZodType, defaults?: unknown): SchemaFieldReference[] {
  return schemaReference(z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>, defaults);
}

/** The authoring contract for one chart type. Compact by default. */
export function describeType(type: string, detail: 'compact' | 'full' = 'compact') {
  const definition = getChartDefinition(type);
  if (!definition) throw new Error(`unknown chart type '${type}'`);
  const full = detail === 'full';
  const { own, notAccepted } = typeOptions(definition.type);
  const dataFields = fields(definition.dataSchema);
  const fixtures = getFixtures(definition.type);
  const shown = full ? fixtures : fixtures.filter((fixture) => fixture.kind === 'example').slice(0, COMPACT_FIXTURES);
  const sizing = definition.sizing!;
  const example = definition.discovery?.example;
  const ids = chartIds(definition.type);
  return {
    type: definition.type,
    summary: full ? definition.summary : shortSummaryFor(definition.type, definition.summary),
    ...(full ? { reading: { counts: readingCountsSchema, ...(definition.type === 'grid' ? { metricStack: readingMetricStackSchema } : {}) } } : {}),
    useCases: useCasesFor(definition.type, detail),
    ...(designCardFor(definition.type) ? { design: full ? structuredClone(designCardFor(definition.type)) : compactDesignCard(definition.type) } : {}),
    ...(ids.length ? { ids } : {}),
    ...(definition.aliases?.length ? { aliases: [...definition.aliases] } : {}),
    ...(full && definition.discovery?.notFor ? { notFor: definition.discovery.notFor } : {}),
    ...(full && definition.discovery?.densities ? { densities: structuredClone(definition.discovery.densities) } : {}),
    example: example ? { type: definition.type, ...structuredClone(example) } : null,
    data: full ? fieldRows(dataFields, true) : fieldLines(dataFields, true),
    options: full ? fieldRows(own, true) : fieldLines(own, true),
    sharedOptions: 'plus boardplot_list sharedOptions, which a path here replaces. … ends a cut row: describe its path for the rest',
    ...(notAccepted.length ? { notAccepted } : {}),
    sizing: {
      minWidth: sizing.minWidth,
      minHeight: sizing.minHeight,
      fit: sizing.fit,
      ...(definition.type === 'waffle' ? { contentFloor: 'Static floors are for one default panel. The renderer measures the floor from the grid, panel row, text and required key.' } : {}),
      ...(sizing.compactFloor ? { compactFloor: sizing.compactFloor } : {}),
      ...(['treemap', 'kpi', 'bullet', 'status'].includes(definition.type)
        ? { requirement: 'Static floors. Text, row count and label gutters can raise the measured size.' } : {}),
    },
    annotations: full
      ? definition.annotationKinds.map((kind) => {
        const described = describeAnnotation(kind, definition.type);
        return { kind, required: described.requiredFields, anchors: described.anchors, optional: described.optional, use: described.use, notes: described.notes };
      })
      : Object.fromEntries(definition.annotationKinds.map((kind) => [kind, describeAnnotation(kind, definition.type).requiredFields])),
    fixtures: full
      ? shown.map((fixture) => ({ id: fixture.id, chart: chartIdOf(definition.type, fixture.data, fixture.options), useCase: fixture.title, kind: fixture.kind }))
      : Object.fromEntries(shown.map((fixture) => [fixture.id, fixture.title])),
    ...(!full && fixtures.length > shown.length ? { moreFixtures: fixtures.length - shown.length } : {}),
  };
}

/** A field path without its array positions: `series[0].values` and `series[].values` read `series.values`. */
function pathKey(path: string): string {
  return path.replace(/\[\d*\]/g, '').replace(/^\.+|\.+$/g, '');
}

/**
 * One field of a type's contract, with every field below it: `valueAxis.break`
 * or `data.series[].values`. A leading `data.` or `options.` picks the half;
 * without one, options are searched first. A field the type refuses comes back
 * under `refused` with the reason. Null when the path names nothing.
 */
export function describeField(type: string, path: string) {
  const definition = getChartDefinition(type);
  if (!definition) throw new Error(`unknown chart type '${type}'`);
  // No type has a field named design: the path names the type's design card.
  if (path === 'design') {
    const card = designCardFor(definition.type);
    return card ? { type: definition.type, part: 'design' as const, path: 'design', design: structuredClone(card) } : null;
  }
  const [, part, rest] = /^(data|options)\.(.*)$/.exec(path) ?? [];
  const key = pathKey(rest ?? path);
  if (part !== 'data' && (key === 'annotations' || key.startsWith('annotations.'))) {
    const kinds = definition.annotationKinds.filter(kind => key === 'annotations' || key === `annotations.${kind}`);
    if (kinds.length) return { type: definition.type, part: 'options' as const, path: key,
      fields: fieldRows(optionFields(definition.type).filter(field => pathKey(field.path) === key || pathKey(field.path).startsWith(`${key}.`))),
      annotations: kinds.map(kind => describeAnnotation(kind, definition.type)) };
  }
  const halves = part === 'data' ? ['data'] as const : part === 'options' ? ['options'] as const : ['options', 'data'] as const;
  for (const half of halves) {
    const all = half === 'data' ? fields(definition.dataSchema) : optionFields(definition.type);
    const matches = all.filter((field) => pathKey(field.path) === key || pathKey(field.path).startsWith(`${key}.`));
    if (!matches.length) continue;
    const named = matches.find((field) => pathKey(field.path) === key)?.path ?? key;
    const refused = matches.find((field) => field.type === 'never' && pathKey(field.path) === key);
    if (refused) return { type: definition.type, part: half, path: named, refused: refused.description };
    return { type: definition.type, part: half, path: named, fields: fieldRows(matches, half === 'data') };
  }
  if (!part && key === 'name') return { type: definition.type, part: 'spec' as const, path: 'name', fields: [{ ...BARE_NAME_FIELD }] };
  return null;
}

/** The fields a missed path could have meant: the top-level names of both halves. */
export function topLevelFields(type: string): { data: string[]; options: string[] } {
  const definition = getChartDefinition(type)!;
  const top = (list: readonly SchemaFieldReference[]) => [...new Set(list.filter((field) => field.type !== 'never' && !/[.[]/.test(field.path)).map((field) => field.path))];
  return { data: top(fields(definition.dataSchema)), options: top(optionFields(definition.type)) };
}

/** Find an accepted nested field by its leaf name, with one runnable example. */
export function matchingFieldPaths(type: string, leaf: string) {
  const definition = getChartDefinition(type)!;
  const matches = (part: 'data' | 'options', all: SchemaFieldReference[]) => all
    .filter(field => field.type !== 'never' && field.path.split('.').at(-1)?.replace(/\[\]/g, '') === leaf)
    .map(field => `${part}.${field.path}`);
  return { paths: [...new Set([...matches('data', fields(definition.dataSchema)), ...matches('options', optionFields(definition.type))])],
    example: describeType(type).example };
}

/**
 * The JSON Schema of a type's data or options, as the validator reads them
 * (input form). zod leaves a plain options object open because its parse
 * strips an unknown key, but render refuses that key with unknown-option,
 * so the published schema closes every options object too.
 */
export function describeSchema(type: string, part: 'data' | 'options') {
  const definition = getChartDefinition(type);
  if (!definition) throw new Error(`unknown chart type '${type}'`);
  return {
    type: definition.type,
    part,
    schema: part === 'data'
      ? z.toJSONSchema(definition.dataSchema, { io: 'input' })
      : z.toJSONSchema(definition.optionsSchema, { io: 'input', override: ({ jsonSchema }) => {
        if (jsonSchema.type === 'object' && jsonSchema.properties && jsonSchema.additionalProperties === undefined) jsonSchema.additionalProperties = false;
      } }),
  };
}

/** Theme diagnostics a render can return, with the condition that raises each. */
const THEME_ERRORS: Record<string, string> = {
  'unknown-theme': 'the preset name is not registered',
  'invalid-theme': 'a token is unknown or has the wrong type',
  'invalid-theme-override': 'overrides produce a structurally invalid theme',
  'theme-name-reserved': 'a full theme object uses a preset name',
  'unparseable-color': 'a colour is unsupported; use hex, rgb(), hsl(), oklch() or var() with a literal fallback',
  'contrast-ink': 'ink on background is below 4.5:1',
  'contrast-ink-muted': 'inkMuted on background is below 3:1',
  'contrast-inside-label': 'a label inside a fill is below its contrast floor',
  'semantic-equals-background': 'good, bad or highlight equals the background',
  'good-bad-similar': 'good and bad are nearly identical',
  'family-outside-metric-class': 'warning: the leading family of a type stack is not Inter, Geist, Helvetica, Helvetica Neue, Arial or a metric clone, so text can render wider than measured; pass tables built by `boardplot fonts build`, see docs/FONTS.md',
};

/** A minimal brand theme: a preset plus the tokens a brand changes. */
const BRAND_THEME_EXAMPLE = {
  preset: 'standard',
  overrides: { color: { highlight: '#0B5CAD', series: ['#0B5CAD', '#5B8DB8', '#A9C1D9'] } },
};

/** The theme token contract (`describe theme`). Defaults are the `standard` preset's values. */
export function describeTheme(detail: 'compact' | 'full' = 'compact') {
  const tokenFields = themeFieldReference(themes.standard);
  return {
    type: 'theme',
    summary: 'The theme token contract. A spec takes theme as a preset name, as { preset, overrides } or as a full token object with its own name; defaults below are the standard preset.',
    presets: [...PRESET_THEME_NAMES],
    example: BRAND_THEME_EXAMPLE,
    tokens: detail === 'full' ? fieldRows(tokenFields, true) : fieldLines(tokenFields, true),
    errorCodes: { ...THEME_ERRORS },
  };
}
