// Turn SVG files into PNGs beside them with the CLI's rasterizer, for example a golden dump from GOLDEN_WRITE_DIR.
//
//   npx tsx scripts/svg-to-png.mjs <file.svg | folder>... [--scale <n>]
//
// A folder is searched recursively. Size comes from the SVG's viewBox and the font stack from its font-family
// attribute, so the PNG matches `render --format png` of the same chart. --scale defaults to 2, as in the CLI.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rasterize } from '../src/cli/raster.ts';

const args = process.argv.slice(2);
let scale = 2;
const paths = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scale') scale = Number(args[++i]);
  else paths.push(args[i]);
}
if (!paths.length || !(scale > 0)) {
  console.error('usage: npx tsx scripts/svg-to-png.mjs <file.svg | folder>... [--scale <n>]');
  process.exit(2);
}

const svgs = (path) => statSync(path).isDirectory()
  ? readdirSync(path, { recursive: true }).filter((name) => /\.svg$/i.test(name)).map((name) => join(path, name))
  : [path];

let written = 0;
for (const file of paths.flatMap(svgs)) {
  // The PNG path replaces the extension, so a file without one would be overwritten.
  if (!/\.svg$/i.test(file)) { console.error(`${file}: not a .svg file; skipped`); process.exitCode = 1; continue; }
  const svg = readFileSync(file, 'utf8');
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const font = /font-family="([^"]*)"/.exec(svg);
  if (!box || !font) { console.error(`${file}: no viewBox or font-family; skipped`); process.exitCode = 1; continue; }
  const fontFamily = font[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const { pngs, warnings } = rasterize([{ svg, size: { width: Number(box[1]), height: Number(box[2]) }, fontFamily }], scale);
  for (const warning of warnings) console.error(`${file}: ${warning.message}`);
  if (!pngs) { process.exitCode = 1; continue; }
  writeFileSync(file.replace(/\.svg$/i, '.png'), pngs[0]);
  written++;
}
console.log(`${written} PNG files written`);
