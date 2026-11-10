/**
 * The six MCP tools. Each declares a title, a description
 * written for a new colleague, an input schema, an output schema and the
 * behaviour annotations. The corresponding CLI verbs do the work.
 */
import * as z from 'zod';
import '../core/charts';
import { listCharts } from '../core/registry';
import { TARGETS } from '../cli/size';
import { readingSchema } from '../core/schema/reading';
import { FEEDBACK_CATEGORIES, SUMMARY_MAX } from '../telemetry/schema';

export interface InputSchema {
  type: 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string';
  description?: string;
  properties?: Record<string, InputSchema>;
  required?: readonly string[];
  enum?: readonly unknown[];
  pattern?: string;
  items?: InputSchema;
  additionalProperties?: boolean | InputSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
  destructiveHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
}

/**
 * The protocol revisions this server implements, oldest first. 2025-06-18
 * added tool titles, output schemas and structured content, which every tool
 * here returns; the server declares no optional capability beyond tools.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-06-18', '2025-11-25'] as const;
export const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1]!;
export const ABSOLUTE_OUT_DIR_PATTERN =
  process.platform === 'win32' ? '^(?:[A-Za-z]:[\\\\/]|\\\\\\\\)' : '^/';

/** input bound: one JSON-RPC line. */
export const MCP_LIMITS = {
  maxJsonLineBytes: 10 * 1024 * 1024,
} as const;

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

const finding = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    severity: { type: 'string', enum: ['advice', 'info', 'warn', 'error'] },
    path: { type: 'string', description: 'JSON pointer into the spec or the tool arguments.' },
    displayPath: { type: 'string', description: 'The source row and column, for a row finding.' },
    message: { type: 'string' },
    expected: { type: 'object' },
    received: {},
    fix: { type: 'array', description: 'JSON Patch for the input at path, when the engine can propose one.' },
    suggest: { type: 'string' },
    docs: { type: 'string' },
  },
  required: ['code', 'message'],
};

const findings = { type: 'array', items: finding };

/** Every tool result carries ok, engineRev and version; a rejected call carries errors and warnings. */
function output(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ok: { type: 'boolean' }, engineRev: { type: 'number' },
      version: { type: 'string', description: 'The build this server runs, exactly as boardplot --version prints it.' },
      errors: findings, warnings: findings,
      fontTables: { type: 'object', description: 'Custom font metrics, when configured.', properties: { families: { type: 'array', items: { type: 'string' } }, faces: { type: 'integer' } } },
      ...properties,
    },
    required: ['ok'],
  };
}

const spec = z.looseObject({}).describe('One chart: { name?, type, data, options?, annotations?, theme? }. Several charts: { version: 1, charts: [...] }. name sets chart identity and file name, default chart.');

/** An absolute path; the JSON Schema keeps the pattern text as written. */
const absolutePath = (description: string) =>
  z.string().regex(new RegExp(ABSOLUTE_OUT_DIR_PATTERN)).meta({ pattern: ABSOLUTE_OUT_DIR_PATTERN, description });

/** Rows as data, shared by render and measure. */
const rowArguments = {
  rows: z.array(z.looseObject({})).optional()
    .describe('Inline records for one chart, without a document wrapper. Use rows or rowsFile, never both. One row per category/series pair, waterfall item, scatter point, Sankey link, map region, table row, or histogram/box observation. Keep data.pack for maps and data.columns for tables. Requires columns except for tables.'),
  rowsFile: absolutePath('Read records directly from a local file of at most 10 MB: .json holds an array of objects, .csv/.tsv/.txt has a header row. Use rowsFile or rows, never both, with one chart and no document wrapper. Requires columns except for tables. Keep data.pack for maps and data.columns for tables. Allowed folders: client roots, server working directory, temp folder, or BOARDPLOT_ROWS_ROOTS. Semicolon-separated files are detected and accept decimal-comma values.').optional(),
  columns: z.strictObject({
    category: z.string().optional().describe('Source column containing category, map region or box group IDs.'),
    series: z.string().optional().describe('Source column containing series IDs.'),
    value: z.string().optional().describe('Source column containing numeric values.'),
    categoryLabel: z.string().optional().describe('Source column containing display names for categories or box groups.'),
    seriesLabel: z.string().optional().describe('Source column containing display names for series.'),
    unit: z.string().optional().describe('Source column containing series units.'),
    date: z.string().optional().describe('Source column containing category or observation dates.'),
    state: z.string().optional().describe('Source column holding na, nm or suppressed for a null cell.'),
    label: z.string().optional().describe('Source column containing waterfall, scatter or table row labels.'),
    type: z.string().optional().describe('Source column holding waterfall item types: delta, subtotal or total. Missing values use delta.'),
    x: z.string().optional().describe('Source column containing scatter x values.'),
    y: z.string().optional().describe('Source column containing scatter y values.'),
    size: z.string().optional().describe('Source column containing bubble sizes.'),
    group: z.string().optional().describe('Source column containing scatter groups for the legend.'),
    source: z.string().optional().describe('Source column containing Sankey source IDs.'),
    target: z.string().optional().describe('Source column containing Sankey target IDs.'),
    sourceStage: z.string().optional().describe('Source column containing Sankey source stages.'),
    targetStage: z.string().optional().describe('Source column containing Sankey target stages.'),
    id: z.string().optional().describe('Source column containing table row IDs. Default: row-1, row-2, ... .'),
    valueKind: z.enum(['number', 'percent', 'fraction']).default('number')
      .describe('Conversion for value or scatter x/y, never size: number, percent (50 means 50%), or fraction (0.5 means 50%). Table, histogram, box and Sankey require number.'),
  }).optional().describe('Map roles to source field names, for example {"category":"region","series":"product","value":"revenue"}. Required roles: category charts category/series/value, maps category/value, waterfall label/value, scatter x/y, Sankey source/target/value, histogram value, box category/value. Table roles are optional: data.columns declares each value, text, status or date column, which reads the source field matching its id. Waterfall items and scatter points get IDs row-1, row-2, ... . Missing or non-numeric histogram and box observations are refused.'),
};

/** What the reading, and measure, report about the rows a chart was drawn from. */
const rowsRead = readingSchema.properties.data;

const size = { type: 'object', description: 'The layout size in px.', properties: { width: { type: 'number' }, height: { type: 'number' } } };
/** The resolved target and natural output size beside the layout size: one shape for render and measure. */
const presented = {
  target: { type: 'string', enum: [...TARGETS] },
  naturalSize: { type: 'object', description: 'The natural output size: pt for slide and print, else px.', properties: { width: { type: 'number' }, height: { type: 'number' }, unit: { type: 'string', enum: ['px', 'pt'] } } },
  minDisplayWidth: { type: 'number', description: 'The narrowest display width in CSS px that keeps text at its floor.' },
};
/** The optional target argument, shared by render and measure. */
const target = z.enum(TARGETS).optional()
  .describe('Reading context: report (default), dashboard, slide or print. Overrides spec options.target.');
/** The notes list of a drawn chart (footer rule). */
const notesList = readingSchema.properties.notes;
const drawn = {
  size, ...presented, svg: { type: 'string' }, notes: notesList,
  reading: readingSchema,
};
const measured = {
  size: { ...size, description: 'The layout size in px. The height is the height the chart draws: a pinned frame taller than the chart reports only the part the chart uses.' },
  ...presented,
  minWidth: { type: 'number' }, minHeight: { type: 'number' },
  minHeightAtWidth: { type: 'number', description: 'The height needed at the measured width, using minWidth if the requested width is smaller. minHeight also holds at minWidth and can be taller.' },
  naturalWidth: { type: 'number' }, naturalHeight: { type: 'number' },
  comfortableWidth: { type: 'number' }, comfortableHeight: { type: 'number' },
  compactFloor: { type: 'object', description: 'The smallest size the type still draws at, in compact mode, when it has one.' },
  fit: { type: 'string', enum: ['fill', 'content'] }, mode: { type: 'string' },
  titleLines: { type: ['number', 'null'] },
  refused: { type: ['object', 'null'], description: 'null when the requested size fits, otherwise { code, message, required?, suggest? }. required is a verified { width, height } when available. A size refusal can accompany ok true.' },
};

/** What `describe` returns: the chart contract, or the theme contract for type theme. */
const described = {
  type: { type: 'string' }, summary: { type: 'string' },
  reading: { type: 'object', description: 'detail full: output field schemas for the chart reading.' },
  useCases: { type: 'array', items: { type: 'string' } },
  design: { type: 'object', description: 'The design card: message, use, notWhen and rules; compact prints two rules, detail full and path design all, each marked engine (render returns it as advice) or describe (judgment).' },
  ids: { type: 'array', items: { type: 'string' }, description: 'Chart IDs type.variant; absent for a one-form type, whose ID is the type.' },
  aliases: { type: 'array', items: { type: 'string' } },
  notFor: { type: 'string', description: 'detail full: a data shape the type cannot draw, when there is one.' },
  densities: { type: 'object', description: 'detail full: per density value, the options it refuses when they ask for content, and the no-op forms it accepts.' },
  example: { type: ['object', 'null'] },
  data: { type: ['object', 'array'] }, options: { type: ['object', 'array'] },
  sharedOptions: { type: 'string', description: 'Compact detail: additional accepted shared option names and an exact path lookup example.' },
  cell: { type: 'string', description: 'Value-cell definition when the contract uses cell.' },
  anchor: { type: 'string', description: 'Anchor definition for the annotations this type supports.' },
  notAccepted: { type: 'array', items: { type: 'string' }, description: 'Options this type refuses after ignored settings have been removed.' },
  ignored: { type: 'array', items: { type: 'string' }, description: 'Options or option values this type ignores with an option-ignored warning and a remove patch. Present in compact and full detail.' },
  sizing: { type: 'object' },
  annotations: { type: ['object', 'array'] }, fixtures: { type: ['object', 'array'] },
  moreFixtures: { type: 'number', description: 'Fixtures left out of the compact list.' },
  presets: { type: 'array', items: { type: 'string' } }, tokens: { type: ['object', 'array'] },
  errorCodes: { type: 'object' },
  part: { type: 'string', enum: ['data', 'options', 'spec', 'design'], description: "The section returned by path or schema. spec identifies the bare chart's name field. design identifies the design guidance." },
  path: { type: 'string', description: 'path: the field as the contract spells it.' },
  fields: { type: 'array', items: { type: 'object' }, description: 'path: the field and every field below it, in full rows.' },
  refused: { type: 'string', description: 'path: why this type refuses the field.' },
  schema: { type: 'object', description: 'schema: the JSON Schema of the data or options, in input form.' },
};

/** Every chart type and every alias `boardplot_list` advertises, as `describe` accepts them. */
function chartTypes(): string[] {
  return listCharts().flatMap((chart) => [chart.type, ...chart.aliases]).sort();
}

/** The arguments of each tool. tools/list prints them as JSON Schema; tools/call checks them. */
export function toolInputs() {
  return {
    boardplot_list: z.strictObject({}),
    boardplot_describe: z.strictObject({
      type: z.enum([...chartTypes(), 'theme']).describe("Chart type or alias, such as bar or bridge. Use theme for presets and theme tokens."),
      detail: z.enum(['compact', 'full']).default('compact').describe('Use compact for a starter contract and shared option names, then path for one field. full adds complete descriptions of the own data and option fields, the reading schema and all fixture IDs. Shared options stay names; use path for one.'),
      path: z.string().optional().describe("One field and its children, such as options.title or data.series[].values. Prefix data. or options. to disambiguate. Use design for complete design guidance when the response includes design. Not with schema or type theme."),
      schema: z.enum(['data', 'options']).optional().describe('Return the JSON Schema for data or options instead of descriptive rows. Not with path or type theme.'),
    }),
    boardplot_render: z.strictObject({
      spec,
      format: z.enum(['svg', 'png']).default('svg').describe('Requested image format. PNG adds image content on success. With no usable rasterizer, PNG falls back to SVG with warnings. Other PNG export errors can fail the call. Explicit svg includes markup when return and outDir are omitted.'),
      target,
      width: z.number().positive().optional().describe('Canvas width in px; overrides options.size. For pt or mm, put { width, height, unit } in spec options.size instead.'),
      height: z.number().positive().optional().describe('Canvas height in px; overrides options.size.'),
      scale: z.number().positive().max(8).default(2).describe('PNG device pixels per layout unit.'),
      background: z.enum(['theme', 'transparent']).default('theme').describe("theme (default) draws the theme's canvas; transparent leaves it out. Halos keep the theme background colour, so place the result on a surface of that colour."),
      overwrite: z.boolean().optional().describe('Replace existing output files when true. Default false. Chart names within one call still get distinct files.'),
      outDir: absolutePath('Absolute directory for the files, each named after its chart (a bare spec\'s name, default chart), or for a spec with one chart an absolute file path ending in .png or .svg; without format, that extension sets it. A new path that ends in any other letters-only extension, such as .jpg or .pdf, is refused; end it with / to make a folder of that name. It must sit under a client root, the server working directory, the temp folder or a folder in BOARDPLOT_ROWS_ROOTS. By default an existing file is not replaced: a taken name gets a -N suffix, outputs lists the paths written, and an out-name-taken warning names the requested and the written path.').optional(),
      return: z.array(z.enum(['svg', 'reading'])).default(['reading']).describe('Response fields: reading (default) reports labels, omissions and computed values. Include svg for inline markup. PNG image content is separate.'),
      ...rowArguments,
    }),
    boardplot_measure: z.strictObject({
      spec,
      target,
      width: z.number().positive().optional().describe('Width in px to measure at. Height estimates use at least minWidth. Put pt or mm in spec options.size.'),
      ...rowArguments,
    }),
    boardplot_fixtures: z.strictObject({
      type: z.string().optional().describe('A chart type or alias.'),
      id: z.string().optional().describe('Fixture ID from describe or fixtures. Pair with type because IDs are unique within a type. Selecting an ID ignores kind.'),
      kind: z.enum(['example', 'torture', 'all']).default('example').describe('Listing filter: example for normal use, torture for stress cases, all for both. Ignored when id is supplied.'),
      cursor: z.string().optional().describe('nextCursor from the previous response. Repeat the same type and kind filters.'),
    }),
    boardplot_feedback: z.strictObject({
      category: z.enum(FEEDBACK_CATEGORIES),
      summary: z.string().describe(`One line, at most ${SUMMARY_MAX} characters, on what Boardplot did wrong. No client names, numbers, labels or paths.`),
      type: z.string().optional().describe('The chart type involved.'),
      codes: z.array(z.string()).optional().describe('Warning or error codes from the response, such as label-hidden.'),
      optionKeys: z.array(z.string()).optional().describe('Option names involved, such as valueAxis.'),
    }),
  };
}

/** The JSON Schema of one tool's arguments, without the empty object bags zod writes for an open object. */
function jsonInput(schema: z.ZodType): InputSchema {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  const tidy = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (isEmpty(record.additionalProperties)) {
      delete record.additionalProperties;
      if (isEmpty(record.properties)) delete record.properties;
    }
    Object.values(record).forEach(tidy);
  };
  tidy(json);
  return json as unknown as InputSchema;
}

function isEmpty(value: unknown): boolean {
  return value !== null && typeof value === 'object' && Object.keys(value).length === 0;
}

export function toolDefinitions(): ToolDefinition[] {
  const inputs = toolInputs();
  return [
    {
      name: 'boardplot_list',
      title: 'List chart types',
      description: 'Find a supported chart type when you have not chosen one. Returns chart types, use cases, aliases, variants, minimum sizes, shared options and theme presets. Unsupported chart forms include alternatives where available. For a known type, use boardplot_describe directly.',
      inputSchema: jsonInput(inputs.boardplot_list),
      outputSchema: output({
        engine: { type: 'string' },
        types: { type: 'array', items: { type: 'object' } },
        sharedOptions: { type: 'object', additionalProperties: { type: 'string' } },
        cell: { type: 'string' }, anchor: { type: 'string' },
        themes: { type: 'object' },
        unsupported: { type: 'array', items: { type: 'object' } },
        forms: { type: 'object' }, limits: { type: 'object' },
      }),
      annotations: READ_ONLY,
    },
    {
      name: 'boardplot_describe',
      title: 'Describe one chart type',
      description: 'Learn a known chart type without a catalogue call. Compact detail returns a starter spec, data and option fields, shared option names, sizing and fixture IDs. Use path for one field or a description ending in …, which marks shortened text. A field lookup reports acceptance or refusal. Use full for complete descriptions of the own fields of the type. Type theme returns theme presets and tokens.',
      inputSchema: jsonInput(inputs.boardplot_describe),
      outputSchema: output(described),
      annotations: READ_ONLY,
    },
    {
      name: 'boardplot_render',
      title: 'Draw a chart',
      description: 'Draw charts from a supplied spec, with optional data from inline rows or a local file. Call directly when the spec is ready: rendering also validates input and returns ok false with actionable errors on failure. The default response includes a reading of labels, omissions and computed values. Request inline SVG, PNG image content or files through the output arguments. Inspect warnings, the reading and the actual output format before using the chart. Errors stop at ten, then more-errors. A fix is a JSON Patch for the spec or the arguments, as its path names; for a file row, edit the source cell that displayPath names. Repeated design advice appears once per server session. ok false means nothing was drawn; a warn warning needs a review; info and advice need no retry.',
      inputSchema: jsonInput(inputs.boardplot_render),
      outputSchema: output({
        ...drawn,
        charts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ...drawn, reading: { type: 'object', description: 'The top-level reading shape.' } } } },
        outputs: { type: 'array', items: { type: 'string' } },
      }),
      // overwrite can replace files; the default still allocates fresh names.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: 'boardplot_measure',
      title: 'Measure a chart without drawing',
      description: 'Find chart dimensions for a constrained container or after a size refusal. Returns minimum, natural and comfortable dimensions in pixels without an image. Keep the container at least minWidth wide, use minHeightAtWidth as the height floor and naturalHeight as the target height. Check refused even when ok is true. A refusal includes required dimensions when a fitting size was found.',
      inputSchema: jsonInput(inputs.boardplot_measure),
      outputSchema: output({
        ...measured,
        charts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ...measured } } },
        data: rowsRead,
      }),
      annotations: READ_ONLY,
    },
    {
      name: 'boardplot_fixtures',
      title: 'Runnable example specs',
      description: 'Find a runnable example for a chart or retrieve a known fixture. Replace its illustrative data and text while keeping the option structure. Scope listings by type to avoid unrelated examples. Listings return up to 25 fixtures per page with nextCursor when more remain. The default kind is example, while torture selects stress cases.',
      inputSchema: jsonInput(inputs.boardplot_fixtures),
      outputSchema: output({
        fixtures: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, type: { type: 'string' }, chart: { type: 'string', description: 'The chart ID the spec draws.' }, kind: { type: 'string' }, useCase: { type: 'string' }, spec: { type: 'object' } },
            required: ['id', 'type', 'chart', 'useCase', 'spec'],
          },
        },
        nextCursor: { type: 'string', description: 'Pass as cursor with the same filters to retrieve the next page. Absent on the last page.' }, note: { type: 'string' },
      }),
      annotations: READ_ONLY,
    },
    {
      name: 'boardplot_feedback',
      title: 'Draft a problem report',
      description: 'Draft a problem report when Boardplot fails, wrongly refuses valid input or draws a misleading chart. Returns version and system details, your summary and a prefilled GitHub issue URL. The tool sends nothing. Show the draft to the user, who decides whether to submit it.',
      inputSchema: jsonInput(inputs.boardplot_feedback),
      outputSchema: output({
        sent: { type: 'boolean' }, report: { type: 'object' }, issueUrl: { type: 'string' }, next: { type: 'string' },
      }),
      annotations: READ_ONLY,
    },
  ];
}
