/**
 * The engine side of every tool. It runs inside a render child
 * process (src/worker.ts) and calls the same in-memory verbs as the CLI and the local
 * MCP server: render, measure, describe and list. It copies no layout code.
 */
import '../../src/core/charts';
import { linkStoryLayer } from '../../src/core/storyLayer';
import { linkAnnotateEngine } from '../../src/core/annotateEngine';
import { linkThemeShapeRules } from '../../src/core/themeShapeRules';
import { registerAllGeoPacks } from '../../src/core/geo/packs';
import { render } from '../../src/cli/render';
import { measure } from '../../src/cli/measure';
import { describe } from '../../src/cli/describe';
import { list } from '../../src/cli/list';
import { InputError, runVerb, type VerbResult } from '../../src/cli/result';
import { layoutChart, loadSpec } from '../../src/cli/spec';
import { length, withSize } from '../../src/cli/size';
import { applyRows } from '../../src/cli/rows';
import { rasterize } from '../../src/cli/raster';
import { installedFamilies, loadResvg, primaryFamily, rasterFamily } from '../../src/cli/resvg';
import { interactionRecords } from '../../src/core/a11y/records';
import type { InteractionRecord } from '../../src/core/a11y/types';
import { compositionOptions, hundredPercentComposition, labelCardContent } from '../../src/react/hover/labelCard';
import { canonicalJson, sha256 } from '../../src/core/claims';
import { CHART_TYPE_OF, ROWS_SHAPES } from '../../src/core/rowsTypes';
import type { RenderTarget } from '../../src/core/types/options';
import { chooseTheme, cleanPresets, type Brand, type BrandChange, type ThemeChoice } from './brand';
import { CsvError, parseCsv, type CsvFormat, type RejectedRow } from './csv';
import { DEFAULT_FRAME, LIMITS } from './limits';

linkThemeShapeRules();
linkAnnotateEngine();
linkStoryLayer();
registerAllGeoPacks();

declare const __BOARDPLOT_ENGINE__: { version: string; engineRev: number; git: string; source: string } | undefined;
/** The engine build this server bundles (scripts/build-identity.mjs distributionIdentity()). */
export const ENGINE_IDENTITY = typeof __BOARDPLOT_ENGINE__ === 'object' ? __BOARDPLOT_ENGINE__ : undefined;

export interface ChartInput {
  spec?: Record<string, unknown>;
  rows?: unknown[];
  csv?: string;
  csvFormat?: CsvFormat;
  type?: string;
  columns?: Record<string, unknown>;
  options?: Record<string, unknown>;
  theme?: string | Brand;
  frame?: { width: number; height: number };
  target?: 'report' | 'dashboard' | 'slide';
}

/** The colour scheme the view shows; an explicit theme draws the same in both. */
export type Scheme = 'light' | 'dark';

export interface ViewInput extends ChartInput { revision?: string; seq?: number; scheme?: Scheme }

export interface ExportInput extends ChartInput { format: 'svg' | 'png'; scheme?: Scheme }

/** The MCP tool result the main thread returns as it is. */
export interface ToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

/** One finding in the CLI error shape. */
interface Finding { code: string; path?: string; message: string; suggest?: string; fix?: unknown; severity?: string }

/** Whether the client renders MCP Apps views: true, false, or unknown (a 2025-era stateless request). */
export type AppsSupport = boolean | undefined;

// ---------------------------------------------------------------- errors

const ERROR_LIMIT = 10;
const MESSAGE_LIMIT = 600;

function short(text: string, limit = MESSAGE_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function errorResult(errors: readonly Finding[], warnings: readonly Finding[] = [], fit?: Fit): ToolResult {
  const shown = errors.slice(0, ERROR_LIMIT).map(shape);
  const lines = shown.map((error) => `${error.code}${error.path ? ` at ${error.path}` : ''}: ${error.message}${error.suggest ? ` ${error.suggest}` : ''}`);
  if (errors.length > ERROR_LIMIT) lines.push(`${errors.length - ERROR_LIMIT} more errors left out.`);
  // A sizing refusal still says what size the chart needs (a chart that does not fit gets its needed size).
  const needs = fit && fit.minWidth !== undefined ? `The chart needs at least ${fit.minWidth} px width${fit.minHeightAtWidth ? ` and ${fit.minHeightAtWidth} px height at that width` : ''}${fit.comfortableWidth ? `; comfortable at ${fit.comfortableWidth} px` : ''}.` : '';
  return {
    isError: true,
    content: [{ type: 'text', text: `Boardplot refused the call.\n${lines.join('\n')}${needs ? `\n${needs}` : ''}` }],
    structuredContent: {
      ok: false, errors: shown, warnings: warnings.slice(0, ERROR_LIMIT).map(shape),
      ...(errors.length > ERROR_LIMIT ? { errorsCut: errors.length - ERROR_LIMIT } : {}), ...(fit ? { fit } : {}),
    },
  };
}

/** The CLI error shape: code, path, message, suggest, fix. */
function shape(finding: Finding): Finding {
  const fix = finding.fix && JSON.stringify(finding.fix).length <= 2_000 ? finding.fix : undefined;
  return {
    code: finding.code, ...(finding.path !== undefined ? { path: finding.path } : {}), message: short(finding.message),
    ...(finding.suggest ? { suggest: short(finding.suggest) } : {}), ...(fix ? { fix } : {}),
  };
}

function refusal(code: string, message: string, path: string, suggest?: string): never {
  throw new InputError(code, message, { path, ...(suggest ? { suggest } : {}) });
}

/**
 * Engine paths point into the spec the verb saw; the caller sent a ChartInput.
 * A spec path gets the /spec prefix unless the field came in as a top-level
 * argument (type, options, theme); the verb's width and height are the frame.
 */
function inputPath(path: string | undefined, input: ChartInput | undefined): string | undefined {
  if (path === undefined || !input) return path;
  if (path === '/width' || path === '/height') return `/frame${path}`;
  if (/^\/(?:rows|csv|columns|target|frame|format|seq|revision)(?:\/|$)/.test(path)) return path;
  const top = path.split('/')[1] ?? '';
  if (top === 'type' && input.type !== undefined) return path;
  if (top === 'theme' && input.theme !== undefined) return path;
  if (top === 'options' && input.options && Object.hasOwn(input.options, path.split('/')[2] ?? '')) return path;
  return input.spec ? `/spec${path}` : path;
}

/** Every JSON pointer inside a fix patch (path, from) or a source note, remapped like the finding's own path. */
function remapPointers(value: unknown, input: ChartInput | undefined): unknown {
  if (Array.isArray(value)) return value.map((entry) => remapPointers(entry, input));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    (key === 'path' || key === 'from' || key === 'source') && typeof entry === 'string' && entry.startsWith('/') ? inputPath(entry, input) : remapPointers(entry, input),
  ]));
}

function withInputPaths(findings: readonly Finding[], input: ChartInput | undefined): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    ...(finding.path !== undefined ? { path: inputPath(finding.path, input) } : {}),
    ...(finding.fix !== undefined ? { fix: remapPointers(finding.fix, input) } : {}),
  }));
}

/** What a tool body learned before a refusal: the fit, so a sizing refusal can name the size it needs. */
interface Context { fit?: Fit }

/** Run one tool body; an input error or a verb refusal becomes an isError result. Every result is bounded to `limit` characters. */
export function guarded(work: (context: Context) => ToolResult, input?: ChartInput, limit: number = LIMITS.chartResultChars): ToolResult {
  const context: Context = {};
  let result: ToolResult;
  try {
    result = work(context);
  } catch (error) {
    if (error instanceof CsvError) result = errorResult([{ code: error.code, path: '/csv', message: error.message, suggest: error.suggest }]);
    else if (error instanceof Refused) result = errorResult(withInputPaths(error.errors, input), withInputPaths(error.warnings, input), context.fit);
    else result = errorResult(withInputPaths(runVerb(() => { throw error; }).body.errors as Finding[], input), [], context.fit);
  }
  return bounded(result, limit);
}

/**
 * The final serialized result stays within its budget: long lists are cut
 * first, and a result that still does not fit becomes a short refusal.
 */
export function bounded(result: ToolResult, limit: number): ToolResult {
  if (JSON.stringify(result).length <= limit) return result;
  const structured = result.structuredContent ? { ...result.structuredContent } : undefined;
  if (structured) {
    for (const key of ['rejectedRows', 'warnings', 'notes', 'numbers', 'errors', 'series', 'ignoredColumns'] as const) {
      const list = structured[key];
      if (Array.isArray(list) && list.length > 5) structured[key] = list.slice(0, 5);
    }
    const trimmed = { ...result, structuredContent: structured };
    if (JSON.stringify(trimmed).length <= limit) return trimmed;
  }
  const message = `the result has ${JSON.stringify(result).length} characters; this tool answers with at most ${limit}`;
  return {
    isError: true,
    content: [{ type: 'text', text: `Boardplot refused the call.\nresult-too-large: ${message} Use fewer rows, shorter labels, or a smaller frame.` }],
    structuredContent: { ok: false, errors: [{ code: 'result-too-large', message, suggest: 'Use fewer rows, shorter labels, or a smaller frame.' }], warnings: [] },
  };
}

class Refused extends Error {
  constructor(readonly errors: Finding[], readonly warnings: Finding[]) { super('refused'); }
}

function verb(work: () => VerbResult): Record<string, unknown> {
  const result = runVerb(work);
  if (result.exit !== 0) throw new Refused(result.body.errors as Finding[], (result.body.warnings as Finding[] | undefined) ?? []);
  return result.body;
}

// ---------------------------------------------------------------- input

interface Prepared {
  spec: Record<string, unknown>;
  rows?: Record<string, unknown>[];
  columns?: Record<string, unknown>;
  type: string;
  target: RenderTarget;
  frame: { width: number; height: number };
  theme: ThemeChoice;
  rejectedRows: RejectedRow[];
  csv?: { delimiter: string; decimal: string; missingCells: number };
  /** The column the server added as the one series of a category chart without one. */
  addedSeries?: string;
  revision: string;
}

const SERIES_COLUMN = '(series)';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The short hash of the canonical input: sorted keys, without the frame, the revision and the seq. */
export function revisionOf(input: ViewInput): string {
  // The host's scheme and the view's seq are not part of the chart: dark and light share one revision.
  const { frame: _frame, revision: _revision, seq: _seq, scheme: _scheme, ...rest } = input as ViewInput & { format?: unknown };
  delete (rest as { format?: unknown }).format;
  return sha256(canonicalJson(rest)).slice(0, 12);
}

/**
 * Rows and cells of a spec's data. Rows: every object in any list, nested
 * records included, or the longest list when that is more. Cells: every
 * plain value.
 */
function specVolume(value: unknown): { rows: number; cells: number } {
  let objects = 0;
  let longest = 0;
  let cells = 0;
  const walk = (entry: unknown, depth: number): void => {
    if (depth > 32) return;
    if (Array.isArray(entry)) {
      longest = Math.max(longest, entry.length);
      for (const item of entry) {
        if (isRecord(item)) objects++;
        walk(item, depth + 1);
      }
    } else if (isRecord(entry)) {
      for (const item of Object.values(entry)) walk(item, depth + 1);
    } else {
      cells++;
    }
  };
  walk(value, 0);
  return { rows: Math.max(objects, longest), cells };
}

function prepare(input: ViewInput): Prepared {
  const revision = revisionOf(input);
  if (input.rows !== undefined && input.csv !== undefined) refusal('invalid-argument', 'pass rows or csv, not both', '/csv', 'Send the table once, as rows or as csv.');
  const data = input.rows !== undefined || input.csv !== undefined;
  if (!data && !input.spec) refusal('missing-input', 'pass rows or csv with type and columns, or a full Boardplot spec', '/spec', 'Send rows with type and columns, or a spec from boardplot_describe.');
  if (input.spec && (Array.isArray(input.spec.charts) || input.spec.version !== undefined)) {
    refusal('invalid-argument', 'this server draws one chart per call; send a bare spec, not an envelope', '/spec', 'Send each chart of the envelope in its own call.');
  }
  // The row and cell limits hold for every input form, a full spec's data included.
  if (input.spec && input.spec.data !== undefined) {
    const volume = specVolume(input.spec.data);
    if (volume.rows > LIMITS.rows || volume.cells > LIMITS.cells) {
      refusal('too-many-rows', `the spec data has ${volume.rows} rows and ${volume.cells} values; this server draws at most ${LIMITS.rows} rows and ${LIMITS.cells} cells`,
        '/data', 'Aggregate the data to what the chart shows (for example per category and period) before you call again.');
    }
  }
  const template: Record<string, unknown> = { ...(input.spec ?? {}) };
  const type = input.type ?? (typeof template.type === 'string' ? template.type : undefined);
  if (!type) refusal('missing-type', 'name the chart type', '/type', 'Pass type, such as column or waterfall; boardplot_describe lists them.');
  template.type = type;
  if (input.options) template.options = { ...(isRecord(template.options) ? template.options : {}), ...input.options };
  if (!data && input.columns) refusal('invalid-argument', 'columns maps rows or csv, and neither was given', '/columns');
  const canonical = CHART_TYPE_OF.get(type) ?? type;
  const shape = ROWS_SHAPES.get(canonical);
  let rows: Record<string, unknown>[] | undefined;
  let columns = input.columns ? { ...input.columns } : undefined;
  let rejectedRows: RejectedRow[] = [];
  let csv: Prepared['csv'];
  let addedSeries: string | undefined;
  if (data) {
    if (!shape) {
      refusal('rows-not-supported', `'${type}' takes no rows; send a full spec`, '/type',
        `Rows work for ${[...ROWS_SHAPES.keys()].join(', ')}. For ${type}, call boardplot_describe with type ${type} and send a spec.`);
    }
    if (!columns) refusal('invalid-argument', 'rows need columns naming the source column of each role', '/columns', 'Pass columns, such as { category, value } for a column chart.');
    if (input.csv !== undefined) {
      const numeric = ['value', 'x', 'y', 'size'].flatMap((role) => (typeof columns![role] === 'string' ? [columns![role] as string] : []));
      const parsed = parseCsv(input.csv, input.csvFormat, numeric, { rows: LIMITS.rows, cells: LIMITS.cells });
      rows = parsed.rows;
      rejectedRows = parsed.rejectedRows;
      csv = { delimiter: parsed.delimiter, decimal: parsed.decimal, missingCells: parsed.missingCells };
      if (!rows.length) refusal('invalid-csv', 'the CSV has a header but no data row', '/csv', 'Send the data rows under the header.');
    } else {
      // The schema keeps rows shallow, so the row shape is checked here, with one short error.
      const bad = input.rows!.findIndex((row) => !isRecord(row));
      if (bad >= 0) {
        const count = input.rows!.filter((row) => !isRecord(row)).length;
        refusal('invalid-rows', `row ${bad} is ${input.rows![bad] === null ? 'null' : Array.isArray(input.rows![bad]) ? 'a list' : typeof input.rows![bad]}, not an object${count > 1 ? `; ${count} rows are not objects` : ''}`,
          `/rows/${bad}`, 'Send each row as an object of column names and values, such as { "Region": "North", "Revenue": 42 }.');
      }
      rows = input.rows as Record<string, unknown>[];
    }
    const cells = rows.reduce((sum, row) => sum + (isRecord(row) ? Object.keys(row).length : 0), 0);
    if (rows.length > LIMITS.rows || cells > LIMITS.cells) {
      refusal('too-many-rows', `${rows.length} rows with ${cells} cells; this server draws at most ${LIMITS.rows} rows and ${LIMITS.cells} cells`,
        input.csv !== undefined ? '/csv' : '/rows', 'Aggregate the data to what the chart shows (for example per category and period) before you call again.');
    }
    // A category chart without a series column draws one series named after the value column.
    if (shape === 'category' && columns.series === undefined && typeof columns.value === 'string') {
      addedSeries = columns.value;
      columns = { ...columns, series: SERIES_COLUMN };
      rows = rows.map((row) => ({ ...row, [SERIES_COLUMN]: addedSeries }));
    }
  }
  const target = input.target ?? 'report';
  const frame = input.frame ?? DEFAULT_FRAME;
  const theme = chooseTheme(input.theme, template.theme);
  delete template.theme;
  if (theme.seriesFills) applySeriesFills(template, theme.seriesFills, Boolean(rows));
  return {
    spec: template, ...(rows ? { rows } : {}), ...(columns ? { columns } : {}), type, target, frame, theme,
    rejectedRows, ...(csv ? { csv } : {}), ...(addedSeries ? { addedSeries } : {}), revision,
  };
}

/** Brand series colours bind to series names: a series keeps its colour whatever the order or filter. */
function applySeriesFills(spec: Record<string, unknown>, fills: Record<string, string>, fromRows: boolean): void {
  const data = isRecord(spec.data) ? { ...spec.data } : {};
  const series = Array.isArray(data.series) ? data.series as Record<string, unknown>[] : [];
  const named = new Map(series.map((entry) => [String(entry.id), entry]));
  const out = series.map((entry) => {
    const fill = fills[String(entry.id)] ?? (typeof entry.label === 'string' ? fills[entry.label] : undefined);
    return fill ? { ...entry, fill } : entry;
  });
  if (fromRows) for (const [name, fill] of Object.entries(fills)) if (!named.has(name)) out.push({ id: name, fill });
  if (out.length) spec.data = { ...data, series: out };
}

function specWithTheme(prepared: Prepared, dark: boolean): Record<string, unknown> {
  const theme = dark ? prepared.theme.dark : prepared.theme.light;
  return theme === undefined ? prepared.spec : { ...prepared.spec, theme };
}

// ---------------------------------------------------------------- engine calls

interface Drawing {
  body: Record<string, unknown>;
  svg: string;
}

/** The CLI's render verb: the same SVG, reading and warnings as `boardplot render`. */
function draw(prepared: Prepared, dark: boolean, frame = prepared.frame): Drawing {
  const body = verb(() => render({
    spec: specWithTheme(prepared, dark), rows: prepared.rows, columns: prepared.columns,
    target: prepared.target, width: frame.width, height: frame.height, return: ['svg', 'reading'],
  }));
  return { body, svg: body.svg as string };
}

function measured(prepared: Prepared, dark = false, frame = prepared.frame): Record<string, unknown> {
  return verb(() => measure({ spec: specWithTheme(prepared, dark), rows: prepared.rows, columns: prepared.columns, target: prepared.target, width: frame.width }));
}

/**
 * The drawn chart behind the render verb's SVG, for what the verb does not
 * return: the interaction records and the text a PNG draws. It lays the chart
 * out once more through the verbs' own entry (cli/spec layoutChart).
 */
function laidOut(prepared: Prepared, dark = false, frame = prepared.frame) {
  const rows = applyRows(specWithTheme(prepared, dark), { rows: prepared.rows, columns: prepared.columns });
  const loaded = loadSpec(rows.spec);
  if ('errors' in loaded) return null;
  const chart = loaded.doc.charts[0];
  if (!chart) return null;
  const sized = withSize(chart, length('width', frame.width), length('height', frame.height), prepared.target);
  return layoutChart(loaded.doc, sized, loaded.envelope, {}, prepared.target);
}

/** A record for the view: the mark it belongs to and the hover card's rows, made from the engine's own card text. */
export interface ViewRecord {
  id: string;
  /** SVG data-id values of the mark. */
  n?: string[];
  /** Geometry anchor for a mark without its own node: [x, y] or [x, y, w, h] in layout units. */
  a?: number[];
  /** Card rows: [kind, text] or [kind, label, value]. */
  r: string[][];
}

function viewRecords(drawn: NonNullable<ReturnType<typeof laidOut>>): ViewRecord[] {
  let records: InteractionRecord[];
  try {
    records = interactionRecords({ request: drawn.request, geometry: drawn.geo, scope: drawn.request.scope, claims: drawn.claims });
  } catch {
    return [];
  }
  const locale = drawn.request.locale?.language;
  const hundredPercent = hundredPercentComposition(drawn.def.type, compositionOptions(drawn.def.type, drawn.request.options));
  return records.flatMap((record) => {
    const card = labelCardContent(record, locale, { hundredPercent });
    if (!card.rows.length) return [];
    const anchor = record.anchor;
    const a = anchor === undefined ? undefined : 'w' in anchor ? [anchor.x, anchor.y, anchor.w, anchor.h] : [anchor.x, anchor.y];
    return [{
      id: record.id,
      ...(record.nodeIds.length ? { n: record.nodeIds } : {}),
      ...(a ? { a: a.map((value) => Math.round(value * 100) / 100) } : {}),
      r: card.rows.map((row) => (row.label !== undefined && row.value !== undefined && row.label !== ''
        ? [row.kind, row.label, row.value] : [row.kind, row.text])),
    }];
  });
}

/**
 * One PNG of the drawing at `scale`, in memory with resvg only. The CLI's
 * Chrome fallback writes temp files and starts a browser that a deadline kill
 * would not stop, so this server never uses it: without resvg or a font, the
 * PNG is unavailable.
 */
function png(svg: string, drawn: NonNullable<ReturnType<typeof laidOut>>, scale: number): { data?: Buffer; warnings: Finding[] } {
  if (!loadResvg()) return { warnings: [{ code: 'png-unavailable', message: 'this server has no in-memory rasterizer (resvg)' }] };
  const asked = primaryFamily(drawn.fontFamily);
  const family = rasterFamily(drawn.fontFamily, installedFamilies());
  if (family === null) return { warnings: [{ code: 'png-unavailable', message: `no font for the PNG is installed on this server (the theme asks for ${asked})` }] };
  const raster = rasterize([{
    svg, size: drawn.geo.size, fontFamily: drawn.fontFamily, name: 'chart',
    text: drawn.geo.scene.flatMap((node) => (node.t === 'text' ? node.lines : [])).join('\n'),
  }], scale, 'resvg');
  const warnings = (raster.warnings as Finding[]).map(({ code, message }) => ({ code, message }));
  if (family.toLowerCase() !== asked.toLowerCase()) warnings.push({ code: 'png-font-substituted', message: `the PNG draws its text in ${family}; the theme asks for ${asked}, which this server does not have` });
  return { ...(raster.pngs ? { data: raster.pngs[0]! } : {}), warnings };
}

// ---------------------------------------------------------------- reading

interface Fit {
  fit?: string;
  minWidth?: number;
  comfortableWidth?: number;
  minHeightAtWidth?: number;
  refused?: { code: string; message: string; required?: unknown; suggest?: string } | null;
}

function fitOf(body: Record<string, unknown>): Fit {
  return {
    ...(typeof body.fit === 'string' ? { fit: body.fit } : {}),
    ...(typeof body.minWidth === 'number' ? { minWidth: body.minWidth } : {}),
    ...(typeof body.comfortableWidth === 'number' ? { comfortableWidth: body.comfortableWidth } : {}),
    ...(typeof body.minHeightAtWidth === 'number' ? { minHeightAtWidth: body.minHeightAtWidth } : {}),
    refused: (body.refused as Fit['refused']) ?? null,
  };
}

interface Reading {
  type: string;
  variant?: string;
  title: string | null;
  series: string[];
  rows?: number;
  ignoredColumns?: string[];
  rejectedRows?: RejectedRow[];
  numbers: { operation: string; displayed: string; value: number | null }[];
  /** How many values the chart draws (count, not a sum), how many are numbers, and the count per state. */
  values?: { count: number; numbers: number; byState: Record<string, number> };
  labels: { placed: number; truncated: number; dropped: number; droppedBy: Record<string, number>; omissions: { text: string; reason: string }[] };
  notes: { kind: string; text: string }[];
  fit: Fit;
  warnings: { code: string; message: string }[];
  brand: { changes: BrandChange[]; notApplied?: string[] };
  revision: string;
  frame: { width: number; height: number };
  target: string;
}

const NUMBER_LIMIT = 40;

/** The small response: every field from a named engine result or the server's CSV reader. */
function readingOf(prepared: Prepared, drawing: Drawing, fit: Fit, extraWarnings: Finding[] = []): Reading {
  const reading = drawing.body.reading as Record<string, unknown>;
  const rowsRead = reading.data as { rows: number; ignoredColumns: string[] } | undefined;
  const derived = (reading.derived as { operation: string; displayed: string; value: number | null; visible: boolean }[] | undefined) ?? [];
  const values = reading.values as { source: string; total: number; numbers: number; byState: Record<string, number> } | undefined;
  const options = isRecord(prepared.spec.options) ? prepared.spec.options : {};
  const brandWarnings: Finding[] = [
    ...prepared.theme.changes.map((change) => ({ code: 'brand-color-adjusted', message: `brand colour ${change.from} (${change.role}) adjusted to ${change.to} for contrast` })),
    ...(prepared.theme.rejected ? [{ code: 'brand-not-applied', message: `brand colours not applied: contrast (${prepared.theme.rejected.join(', ')})` }] : []),
    ...fontWarnings(prepared),
    ...replacedWarnings(prepared),
  ];
  const warnings = [...brandWarnings, ...(drawing.body.warnings as Finding[]), ...extraWarnings];
  return {
    type: reading.type as string,
    ...(typeof options.variant === 'string' ? { variant: options.variant } : {}),
    title: (reading.title as string | null) ?? null,
    series: ((reading.series as string[]) ?? []),
    ...(rowsRead ? { rows: rowsRead.rows, ignoredColumns: rowsRead.ignoredColumns.filter((column) => column !== SERIES_COLUMN) } : {}),
    ...(prepared.rejectedRows.length ? { rejectedRows: prepared.rejectedRows } : {}),
    numbers: derived.slice(0, NUMBER_LIMIT).map((entry) => ({ operation: entry.operation, displayed: entry.displayed, value: entry.value })),
    ...(values && values.source === 'interaction-records' ? { values: { count: values.total, numbers: values.numbers, byState: values.byState } } : {}),
    labels: {
      placed: reading.labelsPlaced as number,
      truncated: (reading.labelsTruncated as unknown[]).length,
      dropped: reading.labelsDropped as number,
      droppedBy: reading.labelsDroppedBy as Record<string, number>,
      omissions: (reading.omissions as { text: string; reason: string }[]).slice(0, 10).map(({ text, reason }) => ({ text, reason })),
    },
    notes: (reading.notes as { kind: string; text: string }[]).map(({ kind, text }) => ({ kind, text })),
    fit,
    warnings: warnings.slice(0, 12).map(({ code, message }) => ({ code, message })),
    brand: { changes: prepared.theme.changes, ...(prepared.theme.rejected ? { notApplied: prepared.theme.rejected } : {}) },
    revision: prepared.revision,
    frame: prepared.frame,
    target: prepared.target,
  };
}

/** A brand font the engine cannot measure: the chart draws and measures in a fallback font. */
function fontWarnings(prepared: Prepared): Finding[] {
  const family = prepared.theme.fontNotMeasured;
  return family ? [{ code: 'font-not-measured', message: `Boardplot has no metric table for '${family}', so it estimates label widths; text drawn in '${family}' can be wider or narrower than measured.` }] : [];
}

/** A preset or spec theme with floor findings, replaced by the safe theme of its scheme. */
function replacedWarnings(prepared: Prepared): Finding[] {
  const replaced = prepared.theme.replaced;
  if (!replaced) return [];
  const what = replaced.kind === 'brand-preset-replaced' ? `the brand's base preset '${replaced.preset}'` : `the theme '${replaced.preset}'`;
  return [{ code: replaced.kind, message: `${what} fails colour floors (${replaced.codes.join(', ')}), so the safe theme of its scheme draws instead` }];
}

/** Warnings an export carries: CSV rows left out, brand changes, the font check and the raster's own. */
function exportWarnings(prepared: Prepared, drawing: Drawing, extra: Finding[] = []): { code: string; message: string }[] {
  const rejected: Finding[] = prepared.rejectedRows.length ? [{
    code: 'csv-rows-left-out',
    message: `left out ${prepared.rejectedRows.length} CSV rows: ${prepared.rejectedRows.slice(0, 5).map((row) => `line ${row.line} (${row.reason})`).join('; ')}`,
  }] : [];
  const brand: Finding[] = [
    ...prepared.theme.changes.map((change) => ({ code: 'brand-color-adjusted', message: `brand colour ${change.from} (${change.role}) adjusted to ${change.to} for contrast` })),
    ...(prepared.theme.rejected ? [{ code: 'brand-not-applied', message: `brand colours not applied: contrast (${prepared.theme.rejected.join(', ')})` }] : []),
  ];
  return [...rejected, ...brand, ...replacedWarnings(prepared), ...fontWarnings(prepared), ...extra, ...(drawing.body.warnings as Finding[])]
    .slice(0, 12).map(({ code, message }) => ({ code, message: short(message) }));
}

/** The reading as short sentences for the model: no IDs, timestamps or versions; the revision is a content hash. */
function sentences(reading: Reading, prepared: Prepared): string {
  const lines: string[] = [];
  const kind = reading.variant ? `${reading.type} (${reading.variant})` : reading.type;
  lines.push(`Drew a ${kind} chart${reading.title ? ` titled "${reading.title}"` : ''} at ${reading.frame.width} × ${reading.frame.height} px for a ${reading.target}. Revision ${reading.revision}.`);
  if (reading.rows !== undefined) {
    const parts = [`${reading.rows} rows used`];
    if (reading.ignoredColumns?.length) parts.push(`columns not used: ${reading.ignoredColumns.join(', ')}`);
    if (prepared.csv?.missingCells) parts.push(`${prepared.csv.missingCells} empty or n/a values stay missing (not zero)`);
    lines.push(`${parts.join('; ')}.`);
  }
  if (reading.rejectedRows?.length) {
    lines.push(`Left out ${reading.rejectedRows.length} CSV rows: ${reading.rejectedRows.slice(0, 5).map((row) => `line ${row.line} (${row.reason})`).join('; ')}.`);
  }
  if (prepared.addedSeries) lines.push(`No series column was named, so the chart has one series, "${prepared.addedSeries}".`);
  else if (reading.series.length) lines.push(`Series: ${reading.series.slice(0, 12).join(', ')}${reading.series.length > 12 ? ` and ${reading.series.length - 12} more` : ''}.`);
  const shown = reading.numbers.filter((entry) => entry.displayed !== 'Not displayed').slice(0, 12);
  if (shown.length) lines.push(`Computed from the values: ${shown.map((entry) => `${entry.operation} ${entry.displayed}`).join('; ')}.`);
  const labels = reading.labels;
  lines.push(`Labels: ${labels.placed} placed${labels.truncated ? `, ${labels.truncated} shortened` : ''}${labels.dropped ? `, ${labels.dropped} left out (${Object.entries(labels.droppedBy).map(([reason, count]) => `${count} ${reason}`).join(', ')})` : ''}.`);
  const fit = reading.fit;
  if (fit.refused) lines.push(`Does not fit ${reading.frame.width} px: ${fit.refused.message}${fit.refused.suggest ? ` ${fit.refused.suggest}` : ''}`);
  else if (fit.minWidth !== undefined) lines.push(`Fits. Needs at least ${fit.minWidth} px width${fit.comfortableWidth ? `, comfortable at ${fit.comfortableWidth} px` : ''}.`);
  for (const change of reading.brand.changes) lines.push(`Brand colour ${change.from} (${change.role}) adjusted to ${change.to} for contrast.`);
  if (reading.brand.notApplied) {
    lines.push(`Brand colours not applied: contrast. ${reading.brand.notApplied.join(', ')} failed a contrast or distance floor after repair, so the preset theme draws.`);
  }
  if (reading.notes.length) lines.push(`Notes: ${reading.notes.slice(0, 5).map((note) => note.text).join(' | ')}`);
  if (reading.warnings.length) lines.push(`Warnings: ${reading.warnings.slice(0, 6).map((warning) => `${warning.code}: ${warning.message}`).join(' | ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- results

const PNG_MIME = 'image/png';

interface ViewPayload {
  /** The light drawing; absent when the view asked for the dark scheme only. */
  svgLight?: string;
  svgDark?: string;
  records: ViewRecord[];
  frame: { width: number; height: number };
  size: { width: number; height: number };
  revision: string;
  title: string | null;
  type: string;
  explicitTheme: boolean;
  fit: Fit;
  brand: { changes: BrandChange[]; notApplied?: string[] };
  warnings: { code: string; message: string }[];
  engine?: string;
  recordsCut?: number;
}

function viewPayload(prepared: Prepared, light: Drawing | undefined, dark: Drawing | undefined, records: ViewRecord[], fit: Fit): ViewPayload {
  const base = (light ?? dark)!;
  const reading = base.body.reading as { title: string | null; type: string };
  const both = (light?.svg.length ?? 0) + (dark?.svg.length ?? 0);
  return {
    ...(light ? { svgLight: light.svg } : {}),
    // Both drawings travel together only below 90,000 characters; the view asks for the other scheme when it needs it.
    ...(dark && (!light || both < LIMITS.viewSvgChars) ? { svgDark: dark.svg } : {}),
    records, frame: prepared.frame,
    size: base.body.size as { width: number; height: number },
    revision: prepared.revision, title: reading.title ?? null, type: reading.type,
    explicitTheme: prepared.theme.explicit, fit,
    brand: { changes: prepared.theme.changes, ...(prepared.theme.rejected ? { notApplied: prepared.theme.rejected } : {}) },
    warnings: exportWarnings(prepared, base),
    ...(ENGINE_IDENTITY ? { engine: ENGINE_IDENTITY.version } : {}),
  };
}

/** Records are cut from the end when the payload would pass its budget; the count of cut ones travels. Null when the SVG alone is too large. */
function withinBudget(payload: ViewPayload, budget: number): ViewPayload | null {
  let size = JSON.stringify(payload).length;
  if (size <= budget) return payload;
  if (payload.svgDark && payload.svgLight) {
    const { svgDark: _dark, ...rest } = payload;
    payload = rest;
    size = JSON.stringify(payload).length;
  }
  const records = [...payload.records];
  let cut = 0;
  while (size > budget && records.length) {
    const removed = records.splice(Math.max(0, records.length - Math.ceil(records.length / 4)));
    cut += removed.length;
    size = JSON.stringify({ ...payload, records }).length;
  }
  return size <= budget ? { ...payload, records, ...(cut ? { recordsCut: cut } : {}) } : null;
}

/** Largest preview raster: at most 4,000 px on a side and about two megapixels, decided before any pixel is drawn. */
const PREVIEW_PIXELS = 2_000_000;

/** The preview PNG for a client without MCP Apps: 2× when it fits the budget, else smaller. */
function previewPng(light: Drawing, drawn: NonNullable<ReturnType<typeof laidOut>>): { data?: string; scale?: number; warnings: Finding[] } {
  const { width, height } = drawn.geo.size;
  let scale = Math.min(2, LIMITS.pngSide / Math.max(width, height), Math.sqrt(PREVIEW_PIXELS / Math.max(1, width * height)));
  scale = Math.floor(scale * 100) / 100;
  for (let attempt = 0; attempt < 4 && scale >= 0.25; attempt++) {
    const out = png(light.svg, drawn, scale);
    if (!out.data) return { warnings: out.warnings };
    const data = out.data.toString('base64');
    if (data.length <= LIMITS.previewPngChars) return { data, scale, warnings: out.warnings };
    scale = Math.floor(scale * Math.sqrt(LIMITS.previewPngChars / data.length) * 0.92 * 100) / 100;
  }
  return { warnings: [{ code: 'preview-too-large', message: 'the preview PNG did not fit the result budget, so no preview is attached' }] };
}

/** boardplot_chart: the reading for the model, the view payload for the app, and a preview PNG where no view draws. */
export function chartTool(input: ChartInput, apps: AppsSupport): ToolResult {
  return guarded((context) => {
    const prepared = prepare(input);
    const fit = fitOf(measured(prepared));
    context.fit = fit;
    const light = draw(prepared, false);
    const dark = prepared.theme.explicit ? undefined : draw(prepared, true);
    const drawn = laidOut(prepared);
    const records = drawn ? viewRecords(drawn) : [];
    const extra: Finding[] = [];
    let preview: ReturnType<typeof previewPng> | undefined;
    if (apps !== true && drawn) {
      preview = previewPng(light, drawn);
      extra.push(...preview.warnings);
    }
    const reading = readingOf(prepared, light, fit, extra);
    const text = sentences(reading, prepared) + (preview?.data && preview.scale !== 2 ? `\nThe preview image is at ${preview.scale}× to fit the result size; boardplot_export with format png gives 2×.` : '');
    const content: ToolResult['content'] = [{ type: 'text', text }];
    if (preview?.data) content.push({ type: 'image', data: preview.data, mimeType: PNG_MIME });
    // Claude Code hands the model structuredContent, so the sentences travel there too.
    const structuredContent = { summary: text, ...reading } as unknown as Record<string, unknown>;
    const budget = LIMITS.chartResultChars - JSON.stringify({ content, structuredContent }).length - 500;
    // A client known to lack MCP Apps draws no view; it gets no view payload.
    const meta = apps === false ? null : withinBudget(viewPayload(prepared, light, dark, records, fit), budget);
    return { content, structuredContent, ...(meta ? { _meta: { boardplot: meta } } : {}) };
  }, input, LIMITS.chartResultChars);
}

/**
 * boardplot_view: the view payload at the view's frame, with the seq it was
 * given. With a scheme, only that scheme's drawing travels, so a large chart
 * still gets its dark drawing. Only the view reads it.
 */
export function viewTool(input: ViewInput): ToolResult {
  return guarded((context) => {
    const prepared = prepare(input);
    const wantLight = input.scheme !== 'dark' || prepared.theme.explicit;
    const wantDark = !prepared.theme.explicit && input.scheme !== 'light';
    // A dark-only answer takes its fit and records from the dark layout.
    const darkOnly = wantDark && !wantLight;
    const fit = fitOf(measured(prepared, darkOnly));
    context.fit = fit;
    const light = wantLight ? draw(prepared, false) : undefined;
    const dark = wantDark ? draw(prepared, true) : undefined;
    const drawn = laidOut(prepared, darkOnly);
    const records = drawn ? viewRecords(drawn) : [];
    // The payload travels twice (content text and structuredContent), and the
    // text form is escaped once more; the budget shrinks until the whole result fits.
    const full = viewPayload(prepared, light, dark, records, fit);
    let budget = Math.floor(LIMITS.chartResultChars / 2) - 300;
    for (let attempt = 0; attempt < 4; attempt++) {
      const payload = withinBudget(full, budget);
      if (!payload) break;
      const out = { ...payload, seq: input.seq ?? 0, ...(input.scheme ? { scheme: input.scheme } : {}) };
      const result: ToolResult = { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out as unknown as Record<string, unknown> };
      const size = JSON.stringify(result).length;
      if (size <= LIMITS.chartResultChars) return result;
      budget -= Math.ceil((size - LIMITS.chartResultChars) / 2) + 500;
    }
    refusal('result-too-large', `the drawing at ${prepared.frame.width} × ${prepared.frame.height} px does not fit a view result of ${LIMITS.chartResultChars} characters`, '/frame',
      'Draw fewer marks or use a smaller frame.');
  }, input, LIMITS.chartResultChars);
}

/** boardplot_export: SVG text, or a PNG at exactly 2×, or a size refusal that names the largest frame that fits. */
export function exportTool(input: ExportInput): ToolResult {
  return guarded((context) => {
    const prepared = prepare(input);
    // The scheme the view shows; an explicit theme draws the same in both.
    const dark = input.scheme === 'dark' && !prepared.theme.explicit;
    const fit = fitOf(measured(prepared, dark));
    context.fit = fit;
    const drawing = draw(prepared, dark);
    const size = drawing.body.size as { width: number; height: number };
    const fitText = fit.refused ? `Does not fit: ${fit.refused.message}` : fit.minWidth !== undefined ? `Fits; needs at least ${fit.minWidth} px width${fit.comfortableWidth ? `, comfortable at ${fit.comfortableWidth} px` : ''}.` : '';
    const scheme = prepared.theme.explicit ? 'theme' : dark ? 'dark' : 'light';
    const base = { format: input.format, scheme, revision: prepared.revision, frame: prepared.frame, size, fit };
    const warningText = (warnings: { code: string; message: string }[]) => (warnings.length ? ` Warnings: ${warnings.map((warning) => `${warning.code}: ${warning.message}`).join(' | ')}` : '');
    if (input.format === 'svg') {
      const warnings = exportWarnings(prepared, drawing);
      const result: ToolResult = {
        content: [{ type: 'text', text: drawing.svg }, { type: 'text', text: `SVG of revision ${prepared.revision} (${scheme}), ${size.width} × ${size.height} px. ${fitText}${warningText(warnings)}` }],
        structuredContent: { ...base, warnings },
      };
      if (JSON.stringify(result).length > LIMITS.exportResultChars) {
        refusal('result-too-large', `the SVG result has ${JSON.stringify(result).length} characters; an export result holds at most ${LIMITS.exportResultChars}`, '/format',
          'Draw fewer marks, or export format png.');
      }
      return result;
    }
    const drawn = laidOut(prepared, dark);
    if (!drawn) refusal('internal-error', 'the chart could not be laid out for the PNG', '/format');
    const sideLimit = LIMITS.pngSide / 2;
    if (size.width > sideLimit || size.height > sideLimit) {
      refusal('png-too-large', `a PNG at 2× of ${size.width} × ${size.height} px passes ${LIMITS.pngSide} px on a side`, '/frame',
        `Pass a frame of at most ${sideLimit} × ${sideLimit} px, or export format svg.`);
    }
    const out = png(drawing.svg, drawn, 2);
    if (!out.data) refusal('png-unavailable', out.warnings[0]?.message ?? 'no rasterizer is available on this server', '/format', 'Export format svg.');
    const data = out.data.toString('base64');
    const warnings = exportWarnings(prepared, drawing, out.warnings);
    const result: ToolResult = {
      content: [{ type: 'image', data, mimeType: PNG_MIME }, { type: 'text', text: `PNG of revision ${prepared.revision} (${scheme}) at 2×: ${size.width * 2} × ${size.height * 2} pixels. ${fitText}${warningText(warnings)}` }],
      structuredContent: { ...base, warnings, scale: 2, pixels: { width: Math.round(size.width * 2), height: Math.round(size.height * 2) } },
    };
    const length = JSON.stringify(result).length;
    if (length > LIMITS.exportResultChars) {
      // The largest frame that fits, from the area this PNG needed per character; never a silent smaller scale.
      const factor = Math.sqrt((LIMITS.exportResultChars - (length - data.length)) / data.length) * 0.95;
      const fits = { width: Math.floor(prepared.frame.width * factor), height: Math.floor(prepared.frame.height * factor) };
      refusal('result-too-large', `the PNG result at 2× has ${length} characters; an export result holds at most ${LIMITS.exportResultChars}`, '/frame',
        `Pass a frame of about ${fits.width} × ${fits.height} px or smaller for a 2× PNG, or export format svg.`);
    }
    return result;
  }, input, LIMITS.exportResultChars);
}

// ---------------------------------------------------------------- describe

/** boardplot_describe: the compact catalog, or one type's data roles, options, limits and example. */
export function describeTool(input: { type?: string; variant?: string }): ToolResult {
  return guarded(() => {
    if (!input.type) {
      const catalog = verb(() => list());
      const types = (catalog.types as { type: string; summary: string; ids?: string[] }[]).map((entry) => ({
        type: entry.type,
        variants: (entry.ids ?? []).map((id) => id.slice(entry.type.length + 1)).filter(Boolean),
        use: entry.summary,
        rows: ROWS_SHAPES.has(entry.type),
      }));
      // Only presets without a colour floor finding: the others draw a replacement theme.
      const body = { types, themes: cleanPresets(), limits: publicLimits() };
      return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
    }
    const described = verb(() => describe({ type: input.type }));
    const canonical = described.type as string;
    const ids = (described.ids as string[] | undefined) ?? [];
    if (input.variant !== undefined && !ids.includes(`${canonical}.${input.variant}`)) {
      refusal('unknown-variant', `'${canonical}' has no variant '${input.variant}'`, '/variant',
        ids.length ? `Pass one of ${ids.map((id) => id.slice(canonical.length + 1)).join(', ')}.` : `'${canonical}' has one form; omit variant.`);
    }
    const shape = ROWS_SHAPES.get(canonical);
    const body = {
      type: canonical, ...(input.variant ? { variant: input.variant } : {}),
      summary: described.summary, useCases: described.useCases,
      variants: ids.map((id) => id.slice(canonical.length + 1)),
      rows: shape ? { shape, columns: ROWS_COLUMNS[shape] } : null,
      data: described.data, options: described.options, sizing: described.sizing,
      example: described.example, limits: publicLimits(),
    };
    return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
  });
}

const ROWS_COLUMNS: Record<string, { required: string[]; optional: string[] }> = {
  category: { required: ['category', 'value'], optional: ['series', 'categoryLabel', 'seriesLabel', 'unit', 'date', 'state', 'valueKind'] },
  map: { required: ['category', 'value'], optional: ['state', 'valueKind'] },
  waterfall: { required: ['label', 'value'], optional: ['type', 'valueKind'] },
  scatter: { required: ['x', 'y'], optional: ['size', 'label', 'group', 'valueKind'] },
};

function publicLimits() {
  return { inputBytes: LIMITS.bodyBytes, rows: LIMITS.rows, cells: LIMITS.cells, pngSide: LIMITS.pngSide, deadlineSeconds: LIMITS.deadlineMs / 1000 };
}
