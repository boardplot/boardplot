/**
 * The six MCP tools. Each declares a title, a description
 * written for a new colleague, an input schema, an output schema and the
 * behaviour annotations. The CLI verbs of the same names do the work.
 */
import * as z from 'zod';
import '../core/charts';
import { listCharts } from '../core/registry';
import { TARGETS } from '../cli/size';
import { readingCountsSchema, readingMetricStackSchema } from '../core/schema/reading';
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
    path: { type: 'string', description: 'JSON pointer into the spec the caller sent.' },
    message: { type: 'string' },
    expected: { type: 'object' },
    received: {},
    fix: { type: 'array', description: 'JSON Patch operations that fix the finding, when the engine can propose one.' },
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
      errors: findings, warnings: findings, ...properties,
    },
    required: ['ok'],
  };
}

const spec = z.looseObject({}).describe('The chart spec as an object: { name?, type, data, options?, annotations?, theme? }, or an envelope { version: 1, charts: [...] } for several charts. name is the output file name and chart identity, default chart.');

/** An absolute path; the JSON Schema keeps the pattern text as written. */
const absolutePath = (description: string) =>
  z.string().regex(new RegExp(ABSOLUTE_OUT_DIR_PATTERN)).meta({ pattern: ABSOLUTE_OUT_DIR_PATTERN, description });

/** Rows as data, shared by render and measure. */
const rowArguments = {
  rows: z.array(z.looseObject({})).optional()
    .describe('A flat table that fills a bare spec. One row per category/series pair, waterfall item, scatter point, sankey link, map region, table row or histogram or box observation. Keep data.pack for maps and data.columns for tables. Needs columns, except for a table.'),
  rowsFile: absolutePath('Absolute path of a local .json (an array of row objects) or .csv file (a header row) of at most 2 MB, read in place of rows so the numbers never pass through you. It must sit under a client root, the server working directory, the temp folder or a folder in BOARDPLOT_ROWS_ROOTS. A CSV separated by semicolons is detected from its header, and its values read a decimal comma as a decimal. Needs columns, except for a table.').optional(),
  columns: z.strictObject({
    category: z.string().optional(), series: z.string().optional(), value: z.string().optional(),
    categoryLabel: z.string().optional(), seriesLabel: z.string().optional(), unit: z.string().optional(),
    date: z.string().optional(), state: z.string().optional().describe('Column holding na, nm or suppressed for a cell whose value is null.'),
    label: z.string().optional(), type: z.string().optional().describe('Waterfall item type: delta (default), subtotal or total.'),
    x: z.string().optional(), y: z.string().optional(), size: z.string().optional(), group: z.string().optional(),
    source: z.string().optional(), target: z.string().optional(), sourceStage: z.string().optional(), targetStage: z.string().optional(),
    id: z.string().optional().describe('Table row id column. Without it the rows are row-1, row-2, ... .'),
    valueKind: z.enum(['number', 'percent', 'fraction']).default('number'),
  }).optional().describe("Source columns by chart type. Category charts require category,series,value; maps category,value. Waterfall: label,value; optional type (delta|subtotal|total). Scatter/bubble: x,y; optional size,label,group (legend series). Sankey: source,target,value; optional sourceStage,targetStage. Item/point ids are row-1,row-2,... . Table: optional label (row label) and id; spec data.columns declares the columns, and each value, text, status or date column reads the source field named like its id. Histogram: value. Box: category (group id), value; optional categoryLabel, date. A missing or non-numeric observation is refused. valueKind: number (default), percent (50 means 50%) or fraction (0.5 means 50%); applies to value or both x/y, never size; table, histogram and box take number only."),
};

/** What the reading, and measure, report about the rows a chart was drawn from. */
const rowsRead = {
  type: 'object',
  description: 'With rows or rowsFile: the row count, the sha256 of the file bytes (of the canonical JSON for inline rows), the source, the columns nothing read, and the cells a state column suppressed.',
};

const size = { type: 'object', description: 'The layout size in px.', properties: { width: { type: 'number' }, height: { type: 'number' } } };
/** The resolved target and natural output size beside the layout size: one shape for render and measure. */
const presented = {
  target: { type: 'string', enum: [...TARGETS] },
  naturalSize: { type: 'object', description: 'The natural output size: pt for slide and print, else px.', properties: { width: { type: 'number' }, height: { type: 'number' }, unit: { type: 'string', enum: ['px', 'pt'] } } },
  minDisplayWidth: { type: 'number', description: 'The narrowest display width in CSS px that keeps text at its floor.' },
};
/** The optional target argument, shared by render and measure. */
const target = z.enum(TARGETS).optional()
  .describe('Reading context: report (default), dashboard, slide or print. Beats spec options.target.');
/** The notes list of a drawn chart (footer rule). */
const notesList = {
  type: 'array',
  description: 'Every note under the chart in list order: author notes, the engine\'s disclosures (always printed), then method notes, source and map credit. inFrame says whether the drawing prints it; the rest is for an appendix or an info panel. short is the one-line form of a method note or credit.',
  items: {
    type: 'object',
    properties: {
      n: { type: 'number' },
      kind: { type: 'string', enum: ['source', 'credit', 'note', 'method', 'disclosure'] },
      text: { type: 'string' },
      short: { type: 'string' },
      ref: { type: 'number' },
      links: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, href: { type: 'string' } } } },
      inFrame: { type: 'boolean' },
    },
  },
};
const drawn = {
  size, ...presented, svg: { type: 'string' }, notes: notesList,
  reading: {
    type: 'object',
    properties: {
      data: rowsRead,
      counts: readingCountsSchema,
      metricStack: readingMetricStackSchema,
      notes: notesList,
      rounding: { type: 'array', items: { type: 'object' }, description: "Under options.rounding 'sum-consistent' (mekko, pie): each share printed off its nearest rounding so its whole adds up to 100%, with whole, part, share, nearest and printed." },
    },
  },
};
const measured = {
  size: { ...size, description: 'The layout size in px. The height is the height the chart draws: a pinned frame taller than the chart reports only the part the chart uses.' },
  ...presented,
  minWidth: { type: 'number' }, minHeight: { type: 'number' },
  minHeightAtWidth: { type: 'number', description: 'The height needed at exactly the width measured at. minHeight also holds at minWidth and can be taller.' },
  naturalWidth: { type: 'number' }, naturalHeight: { type: 'number' },
  comfortableWidth: { type: 'number' }, comfortableHeight: { type: 'number' },
  compactFloor: { type: 'object', description: 'The smallest size the type still draws at, in compact mode, when it has one.' },
  fit: { type: 'string', enum: ['fill', 'content'] }, mode: { type: 'string' },
  titleLines: { type: ['number', 'null'] },
  refused: { type: ['object', 'null'], description: 'null, or { code, message, required: { width, height } }.' },
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
  sharedOptions: { type: 'string' },
  notAccepted: { type: 'array', items: { type: 'string' }, description: 'Options this type refuses: shared ones it does not read, and ones other types take that it replaces with its own.' },
  sizing: { type: 'object' },
  annotations: { type: ['object', 'array'] }, fixtures: { type: ['object', 'array'] },
  moreFixtures: { type: 'number', description: 'Fixtures left out of the compact list.' },
  presets: { type: 'array', items: { type: 'string' } }, tokens: { type: ['object', 'array'] },
  errorCodes: { type: 'object' },
  part: { type: 'string', enum: ['data', 'options', 'spec', 'design'], description: "path or schema: the half of the spec the answer describes; spec for path name, the bare chart's own name; design for path design." },
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
      type: z.enum([...chartTypes(), 'theme']).describe("A chart type or alias from boardplot_list, or 'theme'."),
      detail: z.enum(['compact', 'full']).default('compact').describe('compact (default) or full.'),
      path: z.string().optional().describe("One field, such as valueAxis.break or data.series[].values; a leading data. or options. picks the half. Not with type 'theme'."),
      schema: z.enum(['data', 'options']).optional().describe('The JSON Schema of the data or the options instead of the contract. Not with path.'),
    }),
    boardplot_render: z.strictObject({
      spec,
      format: z.enum(['svg', 'png']).default('svg').describe('svg (default) or png.'),
      target,
      width: z.number().positive().optional().describe('Canvas width in px; overrides options.size. For pt or mm, put { width, height, unit } in spec options.size instead.'),
      height: z.number().positive().optional().describe('Canvas height in px; overrides options.size.'),
      scale: z.number().positive().max(8).default(2).describe('PNG device pixels per layout unit.'),
      background: z.enum(['theme', 'transparent']).default('theme').describe("theme (default) draws the theme's canvas; transparent leaves it out. Halos keep the theme background colour, so place the result on a surface of that colour."),
      overwrite: z.boolean().optional().describe('Replace existing output files when true. Default false. Chart names within one call still get distinct files.'),
      outDir: absolutePath('Absolute directory for the files, each named after its chart (a bare spec\'s name, default chart), or for a spec with one chart an absolute file path ending in .png or .svg; without format, that extension sets it. It must sit under a client root, the server working directory, the temp folder or a folder in BOARDPLOT_ROWS_ROOTS. By default an existing file is not replaced: a taken name gets a -N suffix, outputs lists the paths written, and an out-name-taken warning names the requested and the written path.').optional(),
      return: z.array(z.enum(['svg', 'reading'])).default(['reading']).describe('What the response carries.'),
      ...rowArguments,
    }),
    boardplot_measure: z.strictObject({
      spec,
      target,
      width: z.number().positive().optional().describe('Width in px to measure at; pt or mm go in spec options.size.'),
      ...rowArguments,
    }),
    boardplot_fixtures: z.strictObject({
      type: z.string().optional().describe('A chart type or alias.'),
      id: z.string().optional().describe('One fixture id.'),
      kind: z.enum(['example', 'torture', 'all']).default('example'),
      cursor: z.string().optional().describe('nextCursor from the previous page.'),
    }),
    boardplot_feedback: z.strictObject({
      category: z.enum(FEEDBACK_CATEGORIES),
      summary: z.string().describe(`One line, at most ${SUMMARY_MAX} characters, on what Boardplot did wrong. No client names, numbers, labels or paths.`),
      type: z.string().optional().describe('The chart type involved.'),
      codes: z.array(z.string()).optional().describe('Warning or error codes from the response, such as label-dropped.'),
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
      description: 'Lists every chart type Boardplot draws, with a one-line summary, two or three typical use cases, its chart IDs (type.variant), aliases and minimum canvas in pixels. Also lists the options shared by all types once, the theme presets and how to get the theme contract, and names chart forms Boardplot does not draw, with the type and option that draw the same thing where one exists. Call it when you do not yet know which type exists; everything else in this server addresses a type by name. A row ending in … is cut: boardplot_describe with that path returns the whole text.',
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
      description: "Returns the authoring contract for one chart type: the data shape, every option with its type, allowed values and default, one minimal working spec, the size floor and the runnable fixtures. Pass type 'theme' for the theme token contract instead (presets, every token, one minimal brand theme). The compact default is enough to write a valid spec; a row ending in … is cut, and path or detail 'full' returns its whole text. To look up one field, pass path (valueAxis.break, data.series[].values): the answer is that field and the fields below it in full, or the reason the type refuses it. A type with a design card (bar, line, waterfall) returns its message, use, not-when and first rules; path 'design' returns every rule. Pass schema 'data' or 'options' for the JSON Schema a constrained generator can fill. A field that is not in the response is not accepted by that type.",
      inputSchema: jsonInput(inputs.boardplot_describe),
      outputSchema: output(described),
      annotations: READ_ONLY,
    },
    {
      name: 'boardplot_render',
      title: 'Draw a chart',
      description: "Lays out and draws one chart from a spec. It validates while drawing: an invalid spec comes back with ok false and one error per field, so there is no separate validation step. By default the response carries a short reading of what was drawn (series, labels placed and dropped, derived numbers, notes); ask for 'svg' in return to get the markup inline, and pass format 'png' to also receive the chart as an image you can look at. Pass outDir only when you need files on disk. Warnings never block the drawing; theme lints carry a path ending in /theme and come once per session for the same theme; design advice (severity advice, at most three per render) comes once per code per session. To draw numbers from a query result, pass rowsFile (or rows) with columns instead of writing them into spec.data. Rows fill categories and series, waterfall items, scatter points or map regions. The reading reports the row count and a sha256 of the data. target sets the reading context (default report); width and height are px, and pt or mm go in spec options.size with unit. Each chart reports its target, layout size in px and natural output size.",
      inputSchema: jsonInput(inputs.boardplot_render),
      outputSchema: output({
        ...drawn,
        charts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ...drawn } } },
        outputs: { type: 'array', items: { type: 'string' } },
      }),
      // overwrite can replace files; the default still allocates fresh names.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: 'boardplot_measure',
      title: 'Measure a chart without drawing',
      description: 'Reports the smallest, natural and comfortable pixel size one spec needs, without drawing. Use it when the chart has to fit a fixed container or a column of known width, or when a render was refused as too small; the response names the exact pixels that would make it fit. titleLines tells you how many lines the title will take at that width. A dashboard card takes minHeightAtWidth as its floor (minHeight is safe at the minimum width too and can be taller), and naturalHeight as its target for a dense chart (many categories, long footer, event lane), never a fixed small height. target and sizes work as on boardplot_render; the answer is in px. rows, rowsFile and columns work as on boardplot_render.',
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
      description: 'Returns complete, runnable example specs with real-looking data, one per use case. The fastest way to a first chart is to take the closest fixture, replace values and text, and keep the option structure. Omit type for the whole catalogue, pass id for one fixture. Torture fixtures are stress cases used for regression; ask for them only when you need edge cases.',
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
        nextCursor: { type: 'string' }, note: { type: 'string' },
      }),
      annotations: READ_ONLY,
    },
    {
      name: 'boardplot_feedback',
      title: 'Draft a problem report',
      description: 'Drafts a report about a Boardplot problem for the user: version, OS, chart type, option names, codes and your one-line summary, plus issueUrl, a prefilled GitHub issue the user opens and submits. It sends nothing. Offer it when Boardplot itself fails, refuses wrongly or draws something misleading, show the user the report, and let the user decide.',
      inputSchema: jsonInput(inputs.boardplot_feedback),
      outputSchema: output({
        sent: { type: 'boolean' }, report: { type: 'object' }, issueUrl: { type: 'string' }, next: { type: 'string' },
      }),
      annotations: READ_ONLY,
    },
  ];
}
