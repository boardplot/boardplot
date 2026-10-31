/**
 * Rows as data from the CLI and MCP: a flat table, inline or read from a
 * local JSON or CSV file, becomes a bare chart's data through its column
 * mapping (src/core/rows.ts). Read from a file, the numbers reach the chart
 * without passing through the caller.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import { canonicalJson } from '../core/claims/canonical';
import { sha256 } from '../core/claims/sha256';
import { getTilePack } from '../core/geo/tiles';
import { adaptRows, type RowsPathMap } from '../core/rows';
import type { NamedColumnStateEntry } from '../core/schema/namedColumns';
import { InputError } from './result';

export { rewriteRowsDiagnostics } from '../core/rows';

/** A rows file larger than this is refused before it is read. */
const MAX_ROWS_FILE_BYTES = 2 * 1024 * 1024;

export interface RowsInput {
  rows?: unknown;
  rowsFile?: unknown;
  columns?: unknown;
}

/** What the reading reports about rows the chart was drawn from. */
interface RowsReading {
  rows: number;
  /** sha256 of the file's bytes, or of the canonical JSON of inline rows. */
  sha256: string;
  source: string;
  ignoredColumns: string[];
  states: NamedColumnStateEntry[];
}

type Row = Record<string, unknown>;

/**
 * The field separator, read from the header line: a semicolon when it holds
 * more semicolons than commas outside quotes (a German-locale export), else
 * a comma.
 */
function csvDelimiter(body: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of body) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char === ',') commas++;
    else if (!quoted && char === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * RFC 4180 CSV: a header row, quoted fields with "" for a quote, CRLF or LF.
 * The separator is a comma or, detected from the header, a semicolon.
 */
function parseCsv(text: string): { rows: Row[]; delimiter: ',' | ';' } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = csvDelimiter(body);
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
      started = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[index + 1] === '\n') index++;
      if (started || field !== '') record.push(field);
      if (record.length) records.push(record);
      record = [];
      field = '';
      started = false;
    } else {
      field += char;
      started = true;
    }
  }
  if (quoted) throw new InputError('invalid-rows', 'the CSV ends inside a quoted field', { path: '/rowsFile' });
  if (started || field !== '') record.push(field);
  if (record.length) records.push(record);
  const [header, ...lines] = records;
  if (!header) throw new InputError('invalid-rows', 'the CSV has no header row', { path: '/rowsFile' });
  return {
    delimiter,
    rows: lines.map((line, index) => {
      if (line.length !== header.length) {
        throw new InputError('invalid-rows', `CSV row ${index + 1} has ${line.length} fields, the header has ${header.length}`, { path: '/rowsFile' });
      }
      return Object.fromEntries(header.map((name, column) => [name, line[column]]));
    }),
  };
}

/** A rows finding that does not stop the chart. */
interface RowsWarning {
  code: string;
  severity: 'warn';
  message: string;
  path: string;
  suggest: string;
}

interface LoadedRows {
  rows: unknown;
  bytes?: Buffer;
  source: string;
  decimalComma?: boolean;
  warnings?: RowsWarning[];
}

/**
 * The file's text, and a warning when its bytes are not UTF-8. A Windows-1252
 * export (German Excel) turns each of its umlauts into U+FFFD, and the chart
 * would print that character in its labels. A U+FFFD that the file spells in
 * UTF-8 (EF BF BD) is real text and stays quiet.
 */
function decodeRows(bytes: Buffer): { text: string; warnings: RowsWarning[] } {
  const text = bytes.toString('utf8');
  for (let at = text.indexOf('\uFFFD'); at >= 0; at = text.indexOf('\uFFFD', at + 1)) {
    const offset = Buffer.byteLength(text.slice(0, at));
    if (bytes.subarray(offset, offset + 3).equals(Buffer.from([0xef, 0xbf, 0xbd]))) continue;
    return {
      text,
      warnings: [{
        code: 'rows-encoding-replaced', severity: 'warn', path: '/rowsFile',
        message: `the file is not valid UTF-8: the byte 0x${bytes[offset]!.toString(16)} at offset ${offset} reads as the replacement character, so labels may print it`,
        suggest: 'Save the file as UTF-8 (in Excel, "CSV UTF-8") and pass it again.',
      }],
    };
  }
  return { text, warnings: [] };
}

function readRowsFile(path: unknown): LoadedRows {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new InputError('invalid-argument', 'rowsFile must be an absolute path', {
      path: '/rowsFile', expected: { condition: 'an absolute path to a .json or .csv file' }, suggest: 'Pass the absolute path of the file.',
    });
  }
  let real: string;
  let size: number;
  try {
    real = realpathSync(path);
    const stat = statSync(real);
    if (!stat.isFile()) throw new Error('not a regular file');
    size = stat.size;
  } catch (error) {
    throw new InputError('rows-unreadable', `cannot read ${path}: ${error instanceof Error ? error.message : error}`, { path: '/rowsFile' });
  }
  const kind = extname(real).toLowerCase();
  if (kind !== '.json' && kind !== '.csv') {
    throw new InputError('rows-unreadable', `rowsFile must be a .json or .csv file, not '${kind || 'no extension'}'`, { path: '/rowsFile' });
  }
  if (size > MAX_ROWS_FILE_BYTES) {
    throw new InputError('rows-too-large', `${path} has ${size} bytes; a rows file holds at most ${MAX_ROWS_FILE_BYTES}`, {
      path: '/rowsFile', suggest: 'Aggregate the rows to what the chart draws before passing the file.',
    });
  }
  const bytes = readFileSync(real);
  const { text, warnings } = decodeRows(bytes);
  if (kind === '.csv') {
    const { rows, delimiter } = parseCsv(text);
    return { rows, bytes, source: path, decimalComma: delimiter === ';', warnings };
  }
  try {
    // A Windows editor may lead the file with a byte order mark; JSON.parse does not skip it.
    return { rows: JSON.parse(text.replace(/^\uFEFF/, '')) as unknown, bytes, source: path, warnings };
  } catch (error) {
    throw new InputError('invalid-json', `${path} is not valid JSON: ${error instanceof Error ? error.message : error}`, { path: '/rowsFile' });
  }
}

/** The spec with its data taken from the rows, or the spec as sent when no rows are given. */
export function applyRows(spec: unknown, input: RowsInput): { spec: unknown; data?: RowsReading; pathMap?: RowsPathMap; warnings?: RowsWarning[] } {
  if (input.rows === undefined && input.rowsFile === undefined && input.columns === undefined) return { spec };
  if (input.rows !== undefined && input.rowsFile !== undefined) {
    throw new InputError('invalid-argument', 'pass rows or rowsFile, not both', { path: '/rowsFile', fix: [{ op: 'remove', path: '/rowsFile' }] });
  }
  if (input.rows === undefined && input.rowsFile === undefined) {
    throw new InputError('invalid-argument', 'columns maps rows, and no rows or rowsFile was given', { path: '/columns', suggest: 'Pass rows inline or rowsFile with the path of a .json or .csv file.' });
  }
  let loaded: LoadedRows | undefined;
  const adapted = adaptRows(spec, input.columns, {
    argument: input.rows !== undefined ? '/rows' : '/rowsFile',
    load: () => (loaded = input.rows !== undefined ? { rows: input.rows, source: 'inline' } : readRowsFile(input.rowsFile)),
    tilePack: getTilePack,
  });
  return {
    spec: adapted.spec,
    pathMap: adapted.pathMap,
    warnings: loaded!.warnings,
    data: {
      rows: adapted.rows,
      sha256: sha256(loaded!.bytes ?? canonicalJson(loaded!.rows)),
      source: loaded!.source,
      ignoredColumns: adapted.ignoredColumns,
      states: adapted.states,
    },
  };
}
