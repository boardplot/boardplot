/**
 * Host font tables for the CLI and the MCP server. A host licensed for a font
 * that is not bundled builds tables with `boardplot fonts build` and names the
 * file with `--font-tables <file>` or the environment variable
 * `BOARDPLOT_FONT_TABLES`. Layout then measures with those tables, as an API
 * host does with `createMetricTablesMeasurer`.
 *
 * The measurer keeps the bundled tables for every family the file does not
 * cover: the first family of a font stack that has a table, in the file or in
 * the bundle, decides which one measures.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMetricTablesMeasurer, measurableFamilies } from '../core/fontMetrics/injected';
import { parseFontMetricTables } from '../core/fontMetrics/tableDocument';
import type { TextMeasurer } from '../core/text';
import { InputError } from './result';

const FONT_TABLES_ENV = 'BOARDPLOT_FONT_TABLES';

interface ActiveFontTables {
  /** Absolute path of the table file. */
  file: string;
  /** Families the file can measure (a normal face exists). */
  families: string[];
  faces: number;
  measure: TextMeasurer;
}

const loaded = new Map<string, ActiveFontTables>();
let scoped: ActiveFontTables | undefined;

/** Read and parse one table file; the same file is parsed once per process while it does not change. */
function loadFontTables(path: string, source: string): ActiveFontTables {
  const file = resolve(path);
  let key: string;
  let raw: string;
  try {
    const stat = statSync(file);
    key = `${file}|${stat.mtimeMs}|${stat.size}`;
    const cached = loaded.get(key);
    if (cached) return cached;
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new InputError('font-tables-unreadable', `cannot read the font tables file ${path} (${source}): ${error instanceof Error ? error.message : error}`, {
      suggest: 'Pass the file that `boardplot fonts build <font-dir> -o <file>` wrote.',
      docs: 'docs/FONTS.md',
    });
  }
  let tables: ReturnType<typeof parseFontMetricTables>;
  try {
    tables = parseFontMetricTables(JSON.parse(raw.replace(/^﻿/, '')));
  } catch (error) {
    throw new InputError('invalid-font-tables', `${path} (${source}) is not a font tables file: ${error instanceof Error ? error.message : error}`, {
      suggest: 'Build the file with `boardplot fonts build <font-dir> -o <file>`.',
      docs: 'docs/FONTS.md',
    });
  }
  const families = measurableFamilies(tables);
  if (families.length === 0) {
    throw new InputError('invalid-font-tables', `${path} (${source}) has no normal face, so it cannot measure any text`, {
      suggest: 'Build the tables from a directory that holds the regular and bold font files.',
      docs: 'docs/FONTS.md',
    });
  }
  const active: ActiveFontTables = {
    file, families, faces: tables.faces.length,
    measure: createMetricTablesMeasurer(tables, { bundledFallback: true }),
  };
  loaded.clear();
  loaded.set(key, active);
  return active;
}

/** The table file the flag names, else the one `BOARDPLOT_FONT_TABLES` names; undefined when neither is set. */
export function requestedFontTables(flag?: string): ActiveFontTables | undefined {
  if (flag !== undefined) return loadFontTables(flag, '--font-tables');
  const env = process.env[FONT_TABLES_ENV];
  return env === undefined || env === '' ? undefined : loadFontTables(env, FONT_TABLES_ENV);
}

/** Run `work` with the requested tables active; a bad file throws before any layout runs. */
export function withFontTables<T>(flag: string | undefined, work: () => T): T {
  const requested = requestedFontTables(flag);
  const before = scoped;
  scoped = requested;
  try {
    return work();
  } finally {
    scoped = before;
  }
}

/** The tables the running verb measures with, if any. */
export function activeFontTables(): ActiveFontTables | undefined {
  return scoped;
}

/** What a result body says about the tables: the file name stays out, the families go in. */
export function fontTablesSummary(active: ActiveFontTables | undefined): { families: string[]; faces: number } | undefined {
  return active ? { families: active.families, faces: active.faces } : undefined;
}
