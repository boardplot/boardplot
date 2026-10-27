#!/usr/bin/env node
/**
 * Every `docs` pointer a diagnostic can emit has to land on an existing file
 * and heading. Literal pointers are read from the string literals in src; a
 * per-type pointer is expanded over the chart types and, for `#${base}`, over
 * the sections chartSchemaDiagnostic is called with. `--zip <plugin zip>`
 * also checks that every relative link in the packaged SKILL.md and in the
 * skill's references/manual.md resolves inside the zip. `--manual` checks the
 * same manual links in the source tree, before docs:build re-roots them into
 * the skill's copy, without building a package.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/ /g, '-');
const anchors = (markdown) => new Set(markdown.replace(/^```[\s\S]*?^```$/gm, '').split('\n').filter((line) => /^#{1,6} /.test(line)).map((line) => slug(line.replace(/^#+ /, ''))));
// Comments name documents too; only code can emit a pointer.
const uncommented = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const sources = readdirSync(join(ROOT, 'src'), { recursive: true }).filter((file) => /\.tsx?$/.test(file)).map((file) => uncommented(readFileSync(join(ROOT, 'src', file), 'utf8'))).join('\n');
const types = [...readFileSync(join(ROOT, 'src/core/charts/index.ts'), 'utf8').matchAll(/import \{ \w+Definition \} from '\.\/(\w+)'/g)].map((match) => match[1]);
const bases = [...new Set([...sources.matchAll(/chartSchemaDiagnostic\(\s*\w+,\s*\w+,\s*'(\w+)'/g)].map((match) => match[1]))];

const pointers = [...sources.matchAll(/['"`](docs\/[\w./-]+\.md)(?:#([\w-]+))?['"`]/g)].map(([, file, anchor]) => [file, anchor]);
for (const [, section, variable] of sources.matchAll(/`docs\/reference\/\$\{[^}]+\}\.md#(?:([\w-]+)|\$\{(\w+)\})`/g)) {
  if (variable && variable !== 'base') throw new Error(`check-doc-anchors: unknown pointer form #\${${variable}}`);
  for (const type of types) for (const anchor of variable ? bases : [section]) pointers.push([`docs/reference/${type}.md`, anchor]);
}

const failures = [];
for (const [file, anchor] of pointers) {
  if (!existsSync(join(ROOT, file))) failures.push(`${file} does not exist`);
  else if (anchor && !anchors(readFileSync(join(ROOT, file), 'utf8')).has(anchor)) failures.push(`${file}#${anchor} has no such heading`);
}

function checkLinks(file, text, read, location) {
  for (const [, target] of text.replace(/^```[\s\S]*?^```$/gm, '').matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:|^#/.test(target)) continue;
    const [path, anchor] = target.split('#');
    const resolved = posix.normalize(posix.join(posix.dirname(file), path));
    const content = read(resolved);
    if (content === null) failures.push(`${file} links ${target}, which is not in ${location}`);
    else if (anchor && !anchors(content).has(anchor)) failures.push(`${file} links ${target}, which has no such heading`);
  }
}

const manual = process.argv.includes('--manual');
if (manual) {
  const file = 'docs/manual.md';
  checkLinks(file, readFileSync(join(ROOT, file), 'utf8'), (path) => existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : null, 'the source tree');
}

const zip = process.argv.indexOf('--zip');
if (zip !== -1) {
  const archive = process.argv[zip + 1];
  const entries = new Set(execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n').map((entry) => entry.replace(/^\.\//, '')));
  const read = (path) => entries.has(path) ? execFileSync('unzip', ['-p', archive, path], { encoding: 'utf8' }) : null;
  for (const file of ['skills/boardplot-chart/SKILL.md', 'skills/boardplot-chart/references/manual.md']) {
    const text = read(file);
    if (text === null) failures.push(`${file} is not in the zip`);
    else checkLinks(file, text, read, 'the zip');
  }
}

for (const failure of failures) console.error(failure);
console.log(`check-doc-anchors: ${new Set(pointers.map((pointer) => pointer.join('#'))).size} diagnostic pointers${manual ? ', manual links' : ''}${zip === -1 ? '' : ', SKILL.md links'}, ${failures.length} failed`);
process.exitCode = failures.length ? 1 : 0;
