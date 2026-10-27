#!/usr/bin/env node
/**
 * boardplot bin entry — ALWAYS executes. Bins execute; libraries export:
 * everything importable lives in ./main (tsup chunk-splitting made any
 * import.meta guard here compare against a shared chunk's URL, and the
 * installed CLI silently does nothing).
 */
import module from 'node:module';

// Node keeps compiled code of the CLI chunks in its own cache directory (the OS temp folder unless
// NODE_COMPILE_CACHE names one), so the next start skips most parsing. main loads after this
// call, through import(), so its large chunks are covered.
module.enableCompileCache?.();
const { main } = await import('./main');
const args = process.argv.slice(2);
// Only `fonts build` reads font files; no other verb loads the reader.
if (args[0] === 'fonts') await (await import('./fontTables')).loadFontReader();
// Only a PNG reads raster faces. Any argument that names png (--format png, --out chart.png) loads them.
if (args.some((arg) => /png/i.test(arg))) await (await import('./resvg')).loadRasterFonts();
process.exitCode = main(args);
