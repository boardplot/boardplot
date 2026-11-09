#!/usr/bin/env node
/**
 * Every `docs` pointer a diagnostic can emit has to land on an existing file
 * and heading. Literal pointers are read from the string literals in src; a
 * per-type pointer is expanded over the chart types and, for `#${base}`, over
 * the sections chartSchemaDiagnostic is called with. The marketplace skill
 * and every local reference are checked on each run. `--zip <plugin zip>`
 * checks the same files in the archive. `--manual` also checks the authored
 * source guides and chart references. Local links include heading anchors.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
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
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) continue;
    const [path, anchor] = target.split('#');
    const resolved = path ? posix.normalize(posix.join(posix.dirname(file), path)) : file;
    const content = read(resolved);
    if (content === null) failures.push(`${file} links ${target}, which is not in ${location}`);
    else if (anchor && !anchors(content).has(anchor)) failures.push(`${file} links ${target}, which has no such heading`);
  }
}

const readSource = (path) => {
  const absolute = join(ROOT, path);
  return existsSync(absolute) && statSync(absolute).isFile() ? readFileSync(absolute, 'utf8') : null;
};

function checkFiles(files, read, location) {
  for (const file of new Set(files)) {
    const text = read(file);
    if (text === null) failures.push(`${file} is not in ${location}`);
    else checkLinks(file, text, read, location);
  }
}

const pluginRoot = 'release/plugin/boardplot-marketplace/plugins/boardplot';
const skillPath = 'skills/boardplot-chart';
const sourceSkill = `${pluginRoot}/${skillPath}`;
const sourceReferences = `${sourceSkill}/references`;
const referenceFiles = readdirSync(join(ROOT, sourceReferences), { recursive: true })
  .filter((file) => file.endsWith('.md')).map((file) => `${sourceReferences}/${file.replaceAll('\\', '/')}`);
checkFiles([`${pluginRoot}/README.md`, `${pluginRoot}/SETUP.md`, `${sourceSkill}/SKILL.md`, `${sourceReferences}/manual.md`, ...referenceFiles],
  (path) => path.startsWith(`${pluginRoot}/`) ? readSource(path) : null, 'the marketplace plugin');

const manual = process.argv.includes('--manual');
if (manual) {
  const references = readdirSync(join(ROOT, 'docs/reference')).filter((file) => file.endsWith('.md'))
    .map((file) => `docs/reference/${file}`);
  checkFiles(['docs/manual.md', 'docs/use-cases.md', 'docs/FONTS.md', 'docs/TELEMETRY.md', ...references],
    readSource, 'the source tree');
}

const zip = process.argv.indexOf('--zip');
if (zip !== -1) {
  const archive = process.argv[zip + 1];
  const entries = new Set(execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n').map((entry) => entry.replace(/^\.\//, '')));
  const contents = new Map();
  const read = (path) => {
    if (!entries.has(path)) return null;
    if (!contents.has(path)) contents.set(path, execFileSync('unzip', ['-p', archive, path], { encoding: 'utf8' }));
    return contents.get(path);
  };
  // Cowork contains the plugin at the ZIP root; Claude Code wraps it in a marketplace.
  const root = entries.has(`${skillPath}/SKILL.md`) ? '' : 'boardplot-marketplace/plugins/boardplot/';
  const skill = `${root}${skillPath}`;
  const references = [...entries].filter((file) => file.startsWith(`${skill}/references/`) && file.endsWith('.md'));
  checkFiles([`${root}README.md`, `${root}SETUP.md`, `${skill}/SKILL.md`, `${skill}/references/manual.md`, ...references], read, 'the zip');
}

for (const failure of failures) console.error(failure);
console.log(`check-doc-anchors: ${new Set(pointers.map((pointer) => pointer.join('#'))).size} diagnostic pointers, marketplace reference links${manual ? ', source reference links' : ''}${zip === -1 ? '' : ', ZIP reference links'}, ${failures.length} failed`);
process.exitCode = failures.length ? 1 : 0;
