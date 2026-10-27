#!/usr/bin/env node

// Usage: node scripts/plugin-version.mjs [--check | --stage]
//
// The plugin's launcher installs and runs `boardplot@<version>` from npm when
// the plugin has no bundled runtime. That pin must equal the `version` in
// package.json, or a user runs another release than the plugin they
// installed. The launcher is the only file that carries the pin.
//
// Without a flag the script writes the version into the pin. --check only
// reads and exits 1 when a pin differs or is missing. --stage writes and then
// stages the changed file; `npm version` runs it this way through the
// "version" script.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'write';
if (process.argv.length > 3 || !['write', '--check', '--stage'].includes(mode)) {
  console.error('Usage: node scripts/plugin-version.mjs [--check | --stage]');
  process.exit(2);
}
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const expected = `'boardplot@${version}'`;

// Each file must hold exactly one pin, written as a quoted string.
const files = ['release/plugin/boardplot-marketplace/plugins/boardplot/scripts/boardplot.mjs'];
const pin = /'boardplot@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?'/g;

const problems = [];
const changed = [];
for (const path of files) {
  if (!existsSync(join(root, path))) {
    problems.push(`${path} is missing`);
    continue;
  }
  const text = readFileSync(join(root, path), 'utf8');
  const pins = text.match(pin) ?? [];
  if (pins.length !== 1) {
    problems.push(`${path} has ${pins.length} boardplot@<version> pins; it needs exactly one`);
    continue;
  }
  if (pins[0] === expected) continue;
  if (mode === '--check') problems.push(`${path}: ${pins[0]}`);
  else {
    writeFileSync(join(root, path), text.replace(pin, expected));
    changed.push(path);
  }
}

if (problems.length > 0) {
  console.error(`package.json has version ${version}, but the plugin pin is wrong:\n  ${problems.join('\n  ')}`);
  if (mode === '--check') console.error('Run `node scripts/plugin-version.mjs` to write the package version into it.');
  process.exit(1);
}
if (mode === '--check') console.log(`Plugin pin matches boardplot@${version}.`);
else {
  if (mode === '--stage' && changed.length > 0) {
    const result = spawnSync('git', ['add', '--', ...changed], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(changed.length > 0 ? `Wrote boardplot@${version} into ${changed.join(', ')}.` : `Plugin pin already matches boardplot@${version}.`);
}
