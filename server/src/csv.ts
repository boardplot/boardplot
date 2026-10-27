/**
 * The server's CSV reader. Pasted spreadsheet text becomes rows for
 * the engine's rows adapter. It never aggregates, cuts or fills: an empty cell
 * stays missing, a number it cannot read without guessing is refused with its
 * row, and a row with the wrong field count is left out and reported.
 */

export type CsvDelimiter = ',' | ';' | '\t';
export type CsvDecimal = '.' | ',';

export interface CsvFormat {
  delimiter?: CsvDelimiter;
  decimal?: CsvDecimal;
}

export interface RejectedRow {
  /** 1-based data row, the header not counted. */
  row: number;
  /** 1-based line of the text where the row starts. */
  line: number;
  reason: string;
}

export interface CsvRows {
  header: string[];
  rows: Record<string, string | number | null>[];
  delimiter: CsvDelimiter;
  decimal: CsvDecimal;
  /** Where the delimiter and decimal mark came from. */
  detected: { delimiter: boolean; decimal: boolean };
  rejectedRows: RejectedRow[];
  /** Data records and their cells before any record was left out: the server's row and cell limits count these. */
  records: number;
  cells: number;
  /** Numeric cells that were empty or a missing marker such as n/a; they stay missing. */
  missingCells: number;
}

/** A refusal in the CLI error shape (code, path, message, suggest). */
export class CsvError extends Error {
  constructor(readonly code: string, message: string, readonly suggest: string) {
    super(message);
    this.name = 'CsvError';
  }
}

/** Markers a spreadsheet writes for "no value"; they read as missing, never as zero. */
const MISSING = new Set(['', 'na', 'n/a', '#n/a', 'null', 'nan', '-', '–', '—']);

interface CsvRecord { fields: string[]; line: number }

/** The delimiter of the header line, outside quotes: the most frequent of comma, semicolon and tab. */
function detectDelimiter(text: string): CsvDelimiter {
  const counts: { [K in CsvDelimiter]: number } = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && (char === ',' || char === ';' || char === '\t')) counts[char]++;
  }
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  return counts[';'] > counts[','] ? ';' : ',';
}

/** RFC 4180 records: quoted fields with "" for a quote, line breaks inside quotes, CRLF or LF. */
function records(text: string, delimiter: CsvDelimiter): CsvRecord[] {
  const out: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;
  let line = 1;
  let recordLine = 1;
  // After a closing quote only a delimiter or a line break may follow: A,"1"2 is refused, not read as 12.
  let closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (closed && char !== delimiter && char !== '\n' && char !== '\r') {
      throw new CsvError('invalid-csv', `line ${line}, column ${fields.length + 1}: '${char}' follows the closing quote of a quoted field`,
        'Put the whole value inside the quotes, or write a quote inside quotes as "".');
    }
    closed = false;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else {
        if (char === '\n') line++;
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (char === delimiter) {
      fields.push(field);
      field = '';
      started = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      if (started || field !== '') fields.push(field);
      if (fields.length) out.push({ fields, line: recordLine });
      fields = [];
      field = '';
      started = false;
      line++;
      recordLine = line;
    } else {
      field += char;
      started = true;
    }
  }
  if (quoted) throw new CsvError('invalid-csv', `the CSV ends inside a quoted field that starts on line ${recordLine}`, 'Close the quote, or remove the stray quote mark.');
  if (started || field !== '') fields.push(field);
  if (fields.length) out.push({ fields, line: recordLine });
  return out;
}

const DOT_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const COMMA_NUMBER = /^[-+]?(?:\d+,?\d*|,\d+)$/;
/** 1.234 or 12.345: a dot decimal, or a thousands dot in a decimal-comma file. */
const DOT_GROUP_SHAPE = /^[-+]?[1-9]\d{0,2}\.\d{3}$/;
/** 1,234: a comma decimal, or a thousands comma in a decimal-point file. */
const COMMA_GROUP_SHAPE = /^[-+]?[1-9]\d{0,2},\d{3}$/;

/**
 * The decimal mark of the numeric cells when the caller gave none: the mark
 * the decimals use, else the delimiter's custom (a semicolon file is a
 * decimal-comma export). A file that uses both marks as decimals is refused
 * with one line of each. A number like 1.234 that reads either way is refused
 * later with its own row.
 */
function detectDecimal(cells: readonly { cell: string; line: number }[], delimiter: CsvDelimiter): { decimal: CsvDecimal; evidence: boolean } {
  const comma = cells.find(({ cell }) => /^[-+]?\d*,\d+$/.test(cell.trim()) && !COMMA_GROUP_SHAPE.test(cell.trim()));
  const dot = cells.find(({ cell }) => /^[-+]?\d*\.\d+(?:[eE][-+]?\d+)?$/.test(cell.trim()) && !DOT_GROUP_SHAPE.test(cell.trim()));
  if (comma && dot) {
    throw new CsvError('ambiguous-number',
      `line ${comma.line} has a decimal comma ('${comma.cell.trim()}') and line ${dot.line} a decimal point ('${dot.cell.trim()}'), so every value would be a guess`,
      "Pass csvFormat.decimal '.' or ',' to say which mark is the decimal mark.");
  }
  if (comma) return { decimal: ',', evidence: true };
  if (dot) return { decimal: '.', evidence: true };
  return { decimal: delimiter === ';' ? ',' : '.', evidence: false };
}

/** One numeric cell, or a refusal that names the row and column. */
function numberCell(raw: string, decimal: CsvDecimal, where: string, guessed: boolean): number | null {
  const cell = raw.trim().replace(/−/g, '-');
  if (MISSING.has(cell.toLowerCase())) return null;
  // With no decimal in the file to go by, 1.234 or 1,234 may hold a thousands mark.
  if (guessed && (DOT_GROUP_SHAPE.test(cell) || COMMA_GROUP_SHAPE.test(cell))) {
    const [whole] = cell.split(/[.,]/);
    throw new CsvError('ambiguous-number', `${where}: '${cell}' is either ${whole}${cell.slice(whole!.length + 1)} with a thousands mark or a number with a decimal mark`,
      "Pass csvFormat.decimal '.' or ',' to say which mark is the decimal mark, or write the number without grouping marks.");
  }
  if (decimal === '.' && DOT_NUMBER.test(cell)) return Number(cell);
  if (decimal === ',' && COMMA_NUMBER.test(cell)) return Number(cell.replace(',', '.'));
  if (decimal === ',' && DOT_GROUP_SHAPE.test(cell)) {
    throw new CsvError('ambiguous-number', `${where}: '${cell}' is either ${cell.replace('.', '')} with a thousands dot or ${cell} with a decimal point`,
      "Write the number without grouping marks, or pass csvFormat.decimal '.' if the dot is the decimal mark.");
  }
  if (decimal === '.' && COMMA_GROUP_SHAPE.test(cell)) {
    throw new CsvError('ambiguous-number', `${where}: '${cell}' is either ${cell.replace(',', '')} with a thousands comma or ${cell.replace(',', '.')} with a decimal comma`,
      "Write the number without grouping marks, or pass csvFormat.decimal ',' if the comma is the decimal mark.");
  }
  if (/^[-+]?[\d.,'\s  ]+$/.test(cell) && /\d/.test(cell)) {
    throw new CsvError('ambiguous-number', `${where}: '${cell}' has grouping marks, so its value would be a guess`,
      `Write the number alone, without grouping marks, with ${decimal === ',' ? 'a decimal comma, as in 1234,5' : 'a dot as the decimal mark, as in 1234.5'}.`);
  }
  throw new CsvError('invalid-number', `${where}: '${cell}' is not a number`,
    'Write the number alone, without a currency sign, percent sign or unit, or leave the cell empty for a missing value.');
}

/**
 * Parse CSV text into rows. `numericColumns` are the source columns the chart
 * reads as numbers (value, x, y, size); every other cell stays text.
 */
export function parseCsv(text: string, format: CsvFormat = {}, numericColumns: readonly string[] = [], limits?: { rows: number; cells: number }): CsvRows {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = format.delimiter ?? detectDelimiter(body);
  const all = records(body, delimiter);
  const [headerRecord, ...dataRecords] = all;
  if (!headerRecord) throw new CsvError('invalid-csv', 'the CSV has no header row', 'Start the CSV with a header row that names each column.');
  const header = headerRecord.fields.map((name) => name.trim());
  const duplicate = header.find((name, index) => header.indexOf(name) !== index);
  if (duplicate !== undefined) throw new CsvError('invalid-csv', `the header names the column '${duplicate}' twice`, 'Give every column its own name.');
  const missingColumn = numericColumns.find((name) => !header.includes(name));
  if (missingColumn !== undefined) {
    throw new CsvError('invalid-csv', `columns names '${missingColumn}', which the CSV header does not have; the header has ${header.map((name) => `'${name}'`).join(', ')}`,
      'Name a column of the header in columns.');
  }
  const filled = dataRecords.filter((record) => !record.fields.every((field) => field.trim() === ''));
  const cells = filled.reduce((sum, record) => sum + record.fields.length, 0);
  // The limits count every record, also the ones left out below, before any number is read.
  if (limits && (filled.length > limits.rows || cells > limits.cells)) {
    throw new CsvError('too-many-rows', `${filled.length} rows with ${cells} cells; this server draws at most ${limits.rows} rows and ${limits.cells} cells`,
      'Aggregate the data to what the chart shows (for example per category and period) before you call again.');
  }
  const rejectedRows: RejectedRow[] = [];
  const kept: CsvRecord[] = [];
  dataRecords.forEach((record, index) => {
    // A line of delimiters only is an empty spreadsheet row: nothing to draw, nothing to report.
    if (record.fields.every((field) => field.trim() === '')) return;
    if (record.fields.length !== header.length) {
      rejectedRows.push({ row: index + 1, line: record.line, reason: `${record.fields.length} fields, the header has ${header.length}` });
      return;
    }
    kept.push(record);
  });
  const numericIndexes = numericColumns.map((name) => header.indexOf(name));
  const detected = format.decimal ? { decimal: format.decimal, evidence: true } : detectDecimal(kept.flatMap((record) => numericIndexes.map((column) => ({ cell: record.fields[column]!, line: record.line }))), delimiter);
  const decimal = detected.decimal;
  let missingCells = 0;
  const rows = kept.map((record) => {
    const row: Record<string, string | number | null> = {};
    header.forEach((name, column) => {
      const raw = record.fields[column]!;
      if (!numericIndexes.includes(column)) {
        row[name] = raw.trim();
        return;
      }
      const value = numberCell(raw, decimal, `CSV line ${record.line}, column '${name}'`, !detected.evidence);
      if (value === null) missingCells++;
      row[name] = value;
    });
    return row;
  });
  return {
    header, rows, delimiter, decimal, rejectedRows, missingCells, records: filled.length, cells,
    detected: { delimiter: format.delimiter === undefined, decimal: format.decimal === undefined },
  };
}
