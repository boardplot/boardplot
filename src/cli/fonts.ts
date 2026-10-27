/**
 * `boardplot fonts build <font-dir>`: a licensed font directory becomes
 * one reusable width-table file (docs/FONTS.md). CLI only. `--check`
 * re-derives the file and compares bytes, so a table that drifted from the
 * fonts it claims to describe fails.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FONT_TABLE_FILE_NAME } from '../core/fontMetrics/tableDocument';
import { buildFontTables, serializeFontTables } from './fontTables';
import { FONTS_SUBVERBS } from './grammar';
import { InputError, ok, type VerbResult } from './result';

interface FontsInput {
  sub?: string;
  dir?: string;
  out?: string;
  check?: boolean;
}

/** Quote a path for the suggested POSIX shell command. */
function shellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function fonts(input: FontsInput): VerbResult {
  if (input.sub !== FONTS_SUBVERBS[0]) {
    throw new InputError('unknown-subverb', `fonts supports: ${FONTS_SUBVERBS[0]} <font-dir>`);
  }
  if (!input.dir) throw new InputError('missing-font-dir', 'fonts build needs <font-dir>: the directory holding the licensed font files');
  const dirPath = resolve(input.dir);
  const outPath = input.out === undefined ? join(dirPath, FONT_TABLE_FILE_NAME) : resolve(input.out);
  let built: ReturnType<typeof buildFontTables>;
  try {
    built = buildFontTables(dirPath);
  } catch (error) {
    // A directory without usable fonts is the caller's input, not an engine failure.
    throw new InputError('fonts-unreadable', error instanceof Error ? error.message : String(error), {
      suggest: 'Point fonts build at a directory of licensed .ttf, .otf or .ttc files.',
    });
  }
  const serialized = serializeFontTables(built.tables);
  if (input.check) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    if (current !== serialized) {
      throw new InputError('fonts-drift', `${outPath} is out of date for ${input.dir}; run: boardplot fonts build ${shellArg(input.dir)} -o ${shellArg(outPath)}`);
    }
    return ok({ outputs: [outPath], fontTables: { faces: built.tables.faces.length } });
  }
  writeFileSync(outPath, serialized);
  return ok({
    outputs: [outPath],
    fontTables: { faces: built.tables.faces.length, files: built.filesScanned, skipped: built.skipped.length },
    warnings: built.skipped.map((entry) => ({
      code: 'fonts-skipped',
      severity: 'warn',
      message: `${entry.file}: ${entry.reason}${entry.detail ? ` (${entry.detail})` : ''}`,
    })),
  });
}
