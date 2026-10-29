#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The tracked marketplace skeleton is only ever read. Every build copies it
// into OUTPUT_ROOT (default: the ignored artifacts/plugin, or --out) and
// stamps versions, runtime and notices into that copy, so a build never
// modifies a tracked file.
const SKELETON_ROOT = join(ROOT, 'release/plugin/boardplot-marketplace');
let OUTPUT_ROOT = join(ROOT, 'artifacts/plugin');
let MARKETPLACE_ROOT = join(OUTPUT_ROOT, 'boardplot-marketplace');
let PLUGIN_ROOT = join(MARKETPLACE_ROOT, 'plugins/boardplot');
let RUNTIME_ROOT = join(PLUGIN_ROOT, 'runtime');
let ARCHIVE_PATH = join(OUTPUT_ROOT, 'boardplot-cowork.zip');
let CC_ARCHIVE_PATH = join(OUTPUT_ROOT, 'boardplot-claude-code.zip');
let BUILD_MANIFEST_PATH = join(OUTPUT_ROOT, 'BUILD-MANIFEST.json');

function setOutputRoot(directory) {
  OUTPUT_ROOT = resolve(directory);
  MARKETPLACE_ROOT = join(OUTPUT_ROOT, 'boardplot-marketplace');
  PLUGIN_ROOT = join(MARKETPLACE_ROOT, 'plugins/boardplot');
  RUNTIME_ROOT = join(PLUGIN_ROOT, 'runtime');
  ARCHIVE_PATH = join(OUTPUT_ROOT, 'boardplot-cowork.zip');
  CC_ARCHIVE_PATH = join(OUTPUT_ROOT, 'boardplot-claude-code.zip');
  BUILD_MANIFEST_PATH = join(OUTPUT_ROOT, 'BUILD-MANIFEST.json');
}
const SOURCE_PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (typeof SOURCE_PACKAGE.version !== 'string' || SOURCE_PACKAGE.version.length === 0) {
  throw new Error('build-plugin: package.json has no version');
}
const DEFAULT_TARBALL = join(ROOT, `release/boardplot-${SOURCE_PACKAGE.version}.tgz`);
const NORMALIZED_MTIME = new Date('1980-01-01T00:00:00.000Z');
const REQUIRED_PLUGIN_FILES = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'codex.mcp.json',
  '.mcp.json',
  'LICENSE.txt',
  'README.md',
  'SETUP.md',
  'THIRD_PARTY_NOTICES.md',
  'runtime/README.md',
  'runtime/dist/cli/index.js',
  'runtime/dist/mcp/server.js',
  // The manual ships with the plugin: the runtime
  // tarball carries it through the npm files list, and a missing file fails
  // the build. The reference page of every chart type is checked against the
  // runtime's own list in assertPackagedReference.
  'runtime/docs/manual.md',
  'runtime/docs/FONTS.md',
  'runtime/docs/TELEMETRY.md',
  'runtime/docs/use-cases.md',
  'runtime/THIRD_PARTY_NOTICES.md',
  'runtime/llms.txt',
  'runtime/node_modules/zod/package.json',
  'runtime/package.json',
  // The skill ships as the source tree holds it; npm run docs:build writes
  // its copy of the manual.
  'skills/boardplot-chart/SKILL.md',
  'skills/boardplot-chart/references/manual.md',
  // The skill's CLI fallback; it runs the bundled runtime when one exists.
  'scripts/boardplot.mjs',
];
const REFERENCE_PAGES = ['options', 'theme', 'react', 'fixtures'];

// A claude.ai-hosted plugin is REJECTED at upload when it ships a top-level
// bin/ directory: those entries are added to PATH on the CLI but are not shown
// on the admin approval surface. Executable entry points are declared through
// hooks, commands, or mcpServers instead.
// The packaged layout therefore carries no bin/ directory and puts nothing on
// PATH; the skill names the two supported routes.
// The runtime entry points may retain their npm executable bits, but neither is
// exposed through a top-level plugin bin directory.
const FORBIDDEN_TOP_LEVEL_DIRECTORIES = ['bin'];

// Finder writes .DS_Store files and AppleDouble ._* siblings into any
// directory it opens, and .gitignore hides both from `git status` — so a
// build from a Finder-touched checkout zipped them without any dirty-tree
// warning. Machine-local metadata is never plugin content: collection skips it
// wherever it sits.
function isMacosMetadataName(name) {
  return name === '.DS_Store' || name.startsWith('._');
}

/**
 * Build-contract failures carry a kebab-case `code`, matching the CLI's typed
 * error envelope (`{ code, message }`), so a caller can branch on the class
 * instead of matching prose.
 */
class BuildContractError extends Error {
  constructor(code, message) {
    super(`build-plugin: ${message}`);
    this.name = 'BuildContractError';
    this.code = code;
  }
}

function fail(message, code = 'build-failed') {
  throw new BuildContractError(code, message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Host-independent identity for a file tree. ZIP container bytes are not one:
 * DOS timestamps follow the process timezone and external attributes follow
 * the host. The plugin routes execute through `node <path>`, so file modes are
 * deliberately outside this content contract; names and bytes are the product.
 */
function contentSha256(root) {
  const hash = createHash('sha256');
  hash.update('boardplot-plugin-content-v1\0');
  for (const path of collectFiles(root)) {
    const relativePath = relative(root, path).split(sep).join('/');
    const content = readFileSync(path);
    // Length prefixes make file boundaries unambiguous even when a binary
    // payload itself contains NULs or text that resembles the next path.
    hash.update(`${Buffer.byteLength(relativePath, 'utf8')}:`);
    hash.update(relativePath);
    hash.update(`${content.length}:`);
    hash.update(content);
  }
  return hash.digest('hex');
}

function sourceTarballLabel(path) {
  const fromRoot = relative(ROOT, path);
  return fromRoot === '..' || fromRoot.startsWith(`..${sep}`) ? basename(path) : fromRoot;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assertInsideOutput(path) {
  const fromOutput = relative(OUTPUT_ROOT, path);
  if (
    fromOutput.length === 0 ||
    fromOutput === '..' ||
    fromOutput.startsWith(`..${sep}`) ||
    resolve(path) === resolve(OUTPUT_ROOT)
  ) {
    fail(`refusing to replace non-child output path ${path}`);
  }
}

function resetDirectory(path) {
  assertInsideOutput(path);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function dependencySegments(name) {
  const parts = name.split('/');
  const valid =
    (parts.length === 1 && /^[a-zA-Z0-9._-]+$/.test(parts[0])) ||
    (parts.length === 2 && /^@[a-zA-Z0-9._-]+$/.test(parts[0]) && /^[a-zA-Z0-9._-]+$/.test(parts[1]));
  if (!valid || parts.includes('..')) fail(`unsupported dependency name '${name}'`);
  return parts;
}

/**
 * The distributed plugin runs compiled JavaScript and needs no source maps.
 * The npm tarball ships no maps; this
 * still removes any a `build:debug` tree packed by hand would bring along.
 * The plugin only runs the CLI and the MCP server, so the TypeScript
 * declarations go too.
 */
function stripMapsAndDeclarations(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) stripMapsAndDeclarations(path);
    else if (entry.name.endsWith('.map') || entry.name.endsWith('.d.ts')) rmSync(path);
  }
}

/**
 * The runtime ships no declarations (`stripMapsAndDeclarations`), so its
 * package.json must name none: a `types` condition that points at a missing
 * file breaks a TypeScript host that imports the runtime's React entries.
 */
function dropMissingTypes(directory) {
  const path = join(directory, 'package.json');
  const manifest = readJson(path);
  const prune = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'types' && typeof value === 'string') {
        if (!existsSync(join(directory, value))) delete node[key];
      } else prune(value);
    }
  };
  prune(manifest);
  writeJson(path, manifest);
}

function vendorDependencyClosure(packageJson) {
  const destinationNodeModules = join(RUNTIME_ROOT, 'node_modules');
  mkdirSync(destinationNodeModules, { recursive: true });

  const required = Object.keys(packageJson.dependencies ?? {});
  const queue = required.map((name) => ({ name, optional: false }));
  const copied = new Map();

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || copied.has(item.name)) continue;
    const segments = dependencySegments(item.name);
    const source = join(ROOT, 'node_modules', ...segments);
    if (!existsSync(source)) {
      if (item.optional) continue;
      fail(`production dependency '${item.name}' is not installed under node_modules`);
    }

    const metadataPath = join(source, 'package.json');
    if (!existsSync(metadataPath)) fail(`dependency '${item.name}' has no package.json`);
    const metadata = readJson(metadataPath);
    const destination = join(destinationNodeModules, ...segments);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
    copied.set(item.name, metadata.version);

    for (const name of Object.keys(metadata.dependencies ?? {})) {
      queue.push({ name, optional: false });
    }
    for (const name of Object.keys(metadata.optionalDependencies ?? {})) {
      queue.push({ name, optional: true });
    }
  }

  return Object.fromEntries([...copied.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function collectFiles(root) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (isMacosMetadataName(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`plugin archive cannot contain symlink ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
      else fail(`plugin archive cannot contain special file ${absolute}`);
    }
  }

  visit(root);
  return files.sort((a, b) => relative(root, a).localeCompare(relative(root, b), 'en'));
}

/** One reference page per chart type the runtime lists, plus the shared pages. */
function assertPackagedReference(types) {
  const missing = [...types, ...REFERENCE_PAGES]
    .map((name) => `runtime/docs/reference/${name}.md`)
    .filter((path) => !existsSync(join(PLUGIN_ROOT, path)));
  if (missing.length > 0) fail(`missing reference page${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`, 'missing-required-file');
}

function assertRequiredPluginFiles() {
  const missing = REQUIRED_PLUGIN_FILES.filter((path) => {
    const absolute = join(PLUGIN_ROOT, path);
    return !existsSync(absolute) || !statSync(absolute).isFile();
  });
  if (missing.length > 0) {
    fail(
      `missing required plugin file${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      'missing-required-file',
    );
  }
}

function relativePosixPaths(root, files) {
  return files.map((path) => relative(root, path).split(sep).join('/'));
}

function assertNoForbiddenEntryPoints(root, files, label) {
  const offenders = relativePosixPaths(root, files).filter((path) =>
    FORBIDDEN_TOP_LEVEL_DIRECTORIES.some((directory) => path.startsWith(`${directory}/`)),
  );
  if (offenders.length > 0) {
    fail(
      `${label} contains forbidden top-level executable entries ` +
        `(${offenders.join(', ')}); claude.ai-hosted plugins may not ship a bin/ ` +
        'directory — declare entry points via mcpServers, hooks, or commands',
      'forbidden-entry-point',
    );
  }
}

function assertMcpDeclaration(root, files, label) {
  const packed = new Set(relativePosixPaths(root, files));
  const configPath = join(root, '.mcp.json');
  if (!existsSync(configPath)) fail(`${label} has no .mcp.json`, 'mcp-declaration');
  const config = readJson(configPath);
  const servers = config.mcpServers;
  if (!servers || typeof servers !== 'object' || Object.keys(servers).length === 0) {
    fail(`${label} .mcp.json declares no mcpServers`, 'mcp-declaration');
  }

  for (const [name, server] of Object.entries(servers)) {
    if (server?.command !== 'node') {
      fail(
        `${label} .mcp.json server '${name}' has command ` +
          `${JSON.stringify(server?.command)}; the documented reference form is ` +
          '"node" with the server path in args (a plugin-relative command would ' +
          'need a bin/ executable and an exec bit surviving the zip)',
        'mcp-declaration',
      );
    }
    const args = server.args;
    if (!Array.isArray(args) || args.length === 0) {
      fail(`${label} .mcp.json server '${name}' declares no args`, 'mcp-declaration');
    }
    const interpolated = args.filter(
      (arg) => typeof arg === 'string' && arg.includes('${CLAUDE_PLUGIN_ROOT}'),
    );
    if (interpolated.length === 0) {
      fail(
        `${label} .mcp.json server '${name}' has no \${CLAUDE_PLUGIN_ROOT}-relative ` +
          'argument; the server path must resolve inside the installed plugin',
        'mcp-declaration',
      );
    }
    for (const arg of interpolated) {
      const target = arg.replaceAll('${CLAUDE_PLUGIN_ROOT}/', '').replaceAll('${CLAUDE_PLUGIN_ROOT}', '');
      if (!packed.has(target)) {
        fail(
          `${label} .mcp.json server '${name}' points at '${arg}', which is not a ` +
            `packed file (resolved to '${target}')`,
          'mcp-declaration',
        );
      }
    }
  }
}

/**
 * Twin of codexPluginVersion for the Claude manifest. The version field used
 * to be DELETED so Git-marketplace update detection fell back to commit SHAs
 * — but a directory install (boardplot-claude-code.zip) then records
 * literal "unknown" and caches under .../boardplot/unknown, so nobody
 * can tell which release is installed.
 * A content-hashed version serves both routes: it changes with every real
 * publication, so Git update detection stays sound, and directory installs
 * become identifiable and versioned on disk. Both host manifests are
 * excluded from the hash so the two stamps cannot chase each other.
 */
function claudePluginVersion(packageVersion) {
  const manifestPath = join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
  const manifest = readJson(manifestPath);
  delete manifest.version;

  const hash = createHash('sha256');
  hash.update('boardplot-claude-plugin-v1\0');
  hash.update(JSON.stringify(manifest));
  hash.update('\0');
  for (const path of collectFiles(PLUGIN_ROOT)) {
    const relativePath = relative(PLUGIN_ROOT, path).split(sep).join('/');
    if (relativePath === '.claude-plugin/plugin.json') continue;
    if (relativePath === '.codex-plugin/plugin.json') continue;
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }

  manifest.version = `${packageVersion}+claude.${hash.digest('hex').slice(0, 12)}`;
  writeJson(manifestPath, manifest);
  return manifest.version;
}

function codexPluginVersion(packageVersion) {
  const manifestPath = join(PLUGIN_ROOT, '.codex-plugin/plugin.json');
  const manifest = readJson(manifestPath);
  delete manifest.version;

  // Codex caches plugins by semantic version. Hash the assembled plugin, not
  // just the npm package version, so a skill, template, manifest, or runtime
  // change automatically produces a fresh installable version.
  const hash = createHash('sha256');
  hash.update('boardplot-codex-plugin-v1\0');
  hash.update(JSON.stringify(manifest));
  hash.update('\0');
  for (const path of collectFiles(PLUGIN_ROOT)) {
    const relativePath = relative(PLUGIN_ROOT, path).split(sep).join('/');
    if (relativePath === '.codex-plugin/plugin.json') continue;
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }

  manifest.version = `${packageVersion}+codex.${hash.digest('hex').slice(0, 12)}`;
  writeJson(manifestPath, manifest);
  return manifest.version;
}

function assertCodexMcpDeclaration(root, files, label) {
  const packed = new Set(relativePosixPaths(root, files));
  const manifestPath = join(root, '.codex-plugin/plugin.json');
  if (!existsSync(manifestPath)) {
    fail(`${label} has no .codex-plugin/plugin.json`, 'codex-mcp-declaration');
  }
  const manifest = readJson(manifestPath);
  // Codex leaves ${PLUGIN_ROOT} in an inline server's cwd unexpanded
  // (its log: Cannot find module '/${PLUGIN_ROOT}/runtime/dist/mcp/server.js').
  // The plugins that work in Codex name a server file, whose cwd '.' is the
  // plugin root, so Boardplot does the same.
  if (typeof manifest.mcpServers !== 'string' || !packed.has(manifest.mcpServers.replace(/^\.\//, ''))) {
    fail(`${label} Codex manifest must name a packed server file in mcpServers, such as ./codex.mcp.json`, 'codex-mcp-declaration');
  }
  const servers = readJson(join(root, manifest.mcpServers)).mcpServers;
  if (!servers || typeof servers !== 'object' || Object.keys(servers).length === 0) {
    fail(`${label} Codex server file declares no mcpServers`, 'codex-mcp-declaration');
  }

  for (const [name, server] of Object.entries(servers)) {
    if (server?.command !== 'node') {
      fail(
        `${label} Codex server '${name}' has command ${JSON.stringify(server?.command)}, expected "node"`,
        'codex-mcp-declaration',
      );
    }
    const args = server.args;
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('${')) || server.cwd !== '.') {
      fail(`${label} Codex server '${name}' needs cwd '.' and relative args without variables`, 'codex-mcp-declaration');
    }
    if (!packed.has(args[0].replace(/^\.\//, ''))) fail(`${label} Codex server '${name}' names a missing runtime`, 'codex-mcp-declaration');
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'plugin-smoke', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ];
    // Model the host: cwd '.' is the plugin root, args go verbatim. Expanding them here would hide the unexpanded-cwd bug above.
    const output = run(server.command, args, { cwd: root, input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', timeout: 15000 });
    const responses = output.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const names = new Set((responses.find(response => response.id === 2)?.result?.tools ?? []).map(tool => tool.name));
    for (const tool of ['boardplot_list', 'boardplot_describe', 'boardplot_fixtures', 'boardplot_measure', 'boardplot_render', 'boardplot_feedback']) {
      if (!names.has(tool)) fail(`${label} Codex server '${name}' did not expose ${tool}`, 'codex-mcp-discovery');
    }
  }
}

/**
 * The npm tarball's own README documents the PUBLISHED package, where `boardplot`
 * is a real bin on PATH — it opens with `npm install boardplot` and then
 * ten line-start `boardplot <verb>` invocations. Copied verbatim into the plugin
 * it is a shipped route that does not exist here, and an agent reading it
 * inside the installed plugin follows it. Replace it at pack time, right after
 * the cpSync that brings it in.
 */
function writeRuntimeReadme(packageJson) {
  const body = `# Boardplot runtime (packaged copy)

This directory is the compiled \`${packageJson.name}\` runtime, vendored into
the Boardplot plugin at pack time. It is not an npm install: the plugin
ships **no \`bin/\` directory**, so it adds no \`boardplot\` command. A \`boardplot\`
that answers \`boardplot --version\` comes from another install: compare its
version with the \`version\` field the MCP tools return before you use it.

It is reached two ways:

1. the Boardplot MCP tools declared in the plugin's \`.mcp.json\`;
2. \`node <plugin root>/runtime/dist/cli/index.js <verb>\`, where the plugin
   root is the directory that holds \`skills/\` and \`runtime/\`.

The manual is \`docs/manual.md\`; the skill carries a copy as
\`../skills/boardplot-chart/references/manual.md\`. The reference of
every chart type is under \`docs/reference/\`.

The project's own README describes the npm package with \`boardplot\` on PATH;
that route belongs to an npm install, not to this copy.

Licence and third-party notices ship at the plugin root as \`LICENSE.txt\` and
\`THIRD_PARTY_NOTICES.md\`.
`;
  writeFileSync(join(RUNTIME_ROOT, 'README.md'), body);
}

/**
 * Keep the compiled-code and font notices from this tarball, then add the
 * licence text of each production dependency copied into the runtime.
 */
function writeThirdPartyNotices(vendoredDependencies) {
  const compiledNoticesPath = join(RUNTIME_ROOT, 'THIRD_PARTY_NOTICES.md');
  if (!existsSync(compiledNoticesPath)) fail('runtime tarball has no compiled-code and font notices', 'missing-license');
  const sections = Object.entries(vendoredDependencies).map(([name, version]) => {
    const directory = join(ROOT, 'node_modules', ...dependencySegments(name));
    const licenseFile = readdirSync(directory).find((entry) => /^licen[cs]e(\.(md|txt))?$/i.test(entry));
    if (!licenseFile) {
      fail(`vendored dependency '${name}' has no LICENSE file under node_modules`, 'missing-license');
    }
    const declared = readJson(join(directory, 'package.json')).license ?? 'license as below';
    const text = readFileSync(join(directory, licenseFile), 'utf8').trimEnd();
    return `## ${name} ${version} (${declared})\n\n\`\`\`text\n${text}\n\`\`\`\n`;
  });
  const body = `${readFileSync(compiledNoticesPath, 'utf8').trimEnd()}

## Vendored runtime dependencies

The packaged runtime vendors the production dependencies listed below from the
installation it was built with. Each section reproduces that dependency's
license text as installed.

${sections.join('\n')}`;
  writeFileSync(join(PLUGIN_ROOT, 'THIRD_PARTY_NOTICES.md'), body);
}

function copySkeleton() {
  if (!existsSync(SKELETON_ROOT)) fail(`static plugin skeleton not found: ${SKELETON_ROOT}`);
  if (resolve(MARKETPLACE_ROOT) === resolve(SKELETON_ROOT)) {
    fail(
      `--out ${relative(ROOT, OUTPUT_ROOT)} would build into the tracked skeleton; choose another directory`,
      'output-is-source',
    );
  }
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  resetDirectory(MARKETPLACE_ROOT);
  // Exclude runtime build output from the source skeleton.
  const staleRuntime = join(SKELETON_ROOT, 'plugins/boardplot/runtime');
  cpSync(SKELETON_ROOT, MARKETPLACE_ROOT, {
    recursive: true,
    filter: (source) => source !== staleRuntime && !isMacosMetadataName(basename(source)),
  });
}

/**
 * The ZIP route runs the bundled runtime, whatever MCP declaration the source
 * folder holds. A public checkout keeps the npx form there, which needs the
 * npm registry; the built folder and both ZIPs work offline instead.
 */
function writeBundledMcpDeclarations() {
  writeJson(join(PLUGIN_ROOT, '.mcp.json'), {
    mcpServers: { boardplot: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/runtime/dist/mcp/server.js'] } },
  });
  writeJson(join(PLUGIN_ROOT, 'codex.mcp.json'), {
    mcpServers: { boardplot: { command: 'node', args: ['./runtime/dist/mcp/server.js'], cwd: '.' } },
  });
}

function normalizeArchiveInputs(files) {
  for (const path of files) utimesSync(path, NORMALIZED_MTIME, NORMALIZED_MTIME);
}

function parseArguments() {
  const args = process.argv.slice(2);
  let tarballPath = DEFAULT_TARBALL;
  let tarballSeen = false;
  let outRoot;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--tarball' && !tarballSeen && args[index + 1]) {
      tarballPath = resolve(ROOT, args[index + 1]);
      tarballSeen = true;
      index += 1;
    } else if (arg === '--out' && outRoot === undefined && args[index + 1]) {
      outRoot = args[index + 1];
      index += 1;
    } else {
      fail('usage: node scripts/build-plugin.mjs [--tarball path/to/boardplot.tgz] [--out scratch/dir]');
    }
  }
  return { tarballPath, outRoot };
}

const { tarballPath, outRoot } = parseArguments();
if (outRoot !== undefined) setOutputRoot(outRoot);
if (!existsSync(tarballPath)) {
  fail(
    `tarball not found: ${tarballPath}; the repository carries no built tarball. ` +
      'Run `npm run smoke:package -- --artifacts <empty dir>` for the full CI build, ' +
      'or `npm pack --pack-destination release` first',
  );
}

copySkeleton();
writeBundledMcpDeclarations();
const scratch = mkdtempSync(join(tmpdir(), 'boardplot-plugin-build-'));
try {
  run('tar', ['-xzf', tarballPath, '-C', scratch]);
  const extractedPackage = join(scratch, 'package');
  const packageJsonPath = join(extractedPackage, 'package.json');
  if (!existsSync(packageJsonPath)) fail('tarball does not contain package/package.json');

  const packageJson = readJson(packageJsonPath);
  if (packageJson.name !== 'boardplot') {
    fail(`expected package name boardplot, got ${String(packageJson.name)}`);
  }
  if (!packageJson.version || typeof packageJson.version !== 'string') {
    fail('runtime package has no semantic version');
  }
  if (packageJson.bin?.boardplot !== './dist/cli/index.js') {
    fail('runtime package has an unexpected boardplot bin path');
  }
  if (packageJson.bin?.['boardplot-mcp'] !== './dist/mcp/server.js') {
    fail('runtime package has an unexpected boardplot-mcp bin path');
  }

  resetDirectory(RUNTIME_ROOT);
  cpSync(extractedPackage, RUNTIME_ROOT, { recursive: true });
  stripMapsAndDeclarations(RUNTIME_ROOT);
  dropMissingTypes(RUNTIME_ROOT);
  writeRuntimeReadme(packageJson);
  const vendoredDependencies = vendorDependencyClosure(packageJson);
  writeThirdPartyNotices(vendoredDependencies);

  const generatedClaudePluginVersion = claudePluginVersion(packageJson.version);

  const marketplaceManifestPath = join(MARKETPLACE_ROOT, '.claude-plugin/marketplace.json');
  const marketplaceManifest = readJson(marketplaceManifestPath);
  const marketplaceEntry = marketplaceManifest.plugins?.find(
    (entry) => entry.name === 'boardplot',
  );
  if (!marketplaceEntry) fail('marketplace has no boardplot entry');
  delete marketplaceManifest.version;
  delete marketplaceEntry.version;
  writeJson(marketplaceManifestPath, marketplaceManifest);

  const generatedCodexPluginVersion = codexPluginVersion(packageJson.version);

  // No chmod pass: the packaged layout has no executables. Both routes go
  // through `node <path>`, so no exec bit has to survive the zip round trip.

  const listOutput = run('node', [join(RUNTIME_ROOT, 'dist/cli/index.js'), 'list'], {
    cwd: scratch,
    env: { ...process.env, NODE_PATH: '' },
  });
  const listEnvelope = JSON.parse(listOutput);
  const chartTypeCount = Array.isArray(listEnvelope.types) ? listEnvelope.types.length : 0;
  if (chartTypeCount === 0) fail('runtime list returned no chart types');

  assertRequiredPluginFiles();
  assertPackagedReference(listEnvelope.types.map((entry) => entry.type));
  const archiveFiles = collectFiles(PLUGIN_ROOT);
  assertNoForbiddenEntryPoints(PLUGIN_ROOT, archiveFiles, 'plugin tree');
  assertMcpDeclaration(PLUGIN_ROOT, archiveFiles, 'plugin tree');
  assertCodexMcpDeclaration(PLUGIN_ROOT, archiveFiles, 'plugin tree');
  normalizeArchiveInputs(archiveFiles);
  rmSync(ARCHIVE_PATH, { force: true });
  const archiveEntries = archiveFiles.map((path) => `./${relative(PLUGIN_ROOT, path).split(sep).join('/')}`);
  run('zip', ['-X', '-q', ARCHIVE_PATH, '-@'], {
    cwd: PLUGIN_ROOT,
    input: `${archiveEntries.join('\n')}\n`,
  });

  // Claude Code's offline route needs the MARKETPLACE shape (a
  // .claude-plugin/marketplace.json wrapping the plugin), not the bare
  // plugin the Cowork zip carries — `claude plugin marketplace add <dir>`
  // refuses a naked plugin directory. Same content, second wrapper: unzip,
  // then `claude plugin marketplace add ./boardplot-marketplace` and
  // `claude plugin install boardplot@boardplot`.
  const ccFiles = collectFiles(MARKETPLACE_ROOT);
  normalizeArchiveInputs(ccFiles);
  rmSync(CC_ARCHIVE_PATH, { force: true });
  const ccEntries = ccFiles.map(
    (path) => `boardplot-marketplace/${relative(MARKETPLACE_ROOT, path).split(sep).join('/')}`,
  );
  run('zip', ['-X', '-q', CC_ARCHIVE_PATH, '-@'], {
    cwd: OUTPUT_ROOT,
    input: `${ccEntries.join('\n')}\n`,
  });

  const uncompressedBytes = archiveFiles.reduce((sum, path) => sum + statSync(path).size, 0);
  const buildManifest = {
    formatVersion: 2,
    sourceTarball: sourceTarballLabel(tarballPath),
    sourceTarballSha256: sha256(tarballPath),
    distributionContentSha256: contentSha256(MARKETPLACE_ROOT),
    runtime: {
      name: packageJson.name,
      version: packageJson.version,
      chartTypeCount,
      vendoredDependencies,
    },
    distribution: {
      claudePluginVersion: generatedClaudePluginVersion,
      codexPluginVersion: generatedCodexPluginVersion,
    },
    coworkArchive: {
      path: relative(OUTPUT_ROOT, ARCHIVE_PATH),
      sha256: sha256(ARCHIVE_PATH),
      contentSha256: contentSha256(PLUGIN_ROOT),
      files: archiveFiles.length,
      uncompressedBytes,
    },
    claudeCodeArchive: {
      path: relative(OUTPUT_ROOT, CC_ARCHIVE_PATH),
      sha256: sha256(CC_ARCHIVE_PATH),
      files: ccFiles.length,
    },
  };
  writeJson(BUILD_MANIFEST_PATH, buildManifest);

  console.log(`built ${relative(ROOT, ARCHIVE_PATH)}`);
  console.log(`built ${relative(ROOT, CC_ARCHIVE_PATH)}`);
  console.log(`runtime ${packageJson.name}@${packageJson.version}: ${chartTypeCount} chart types`);
  console.log(`Claude plugin ${generatedClaudePluginVersion}`);
  console.log(`Codex plugin ${generatedCodexPluginVersion}`);
  console.log(`vendored ${Object.keys(vendoredDependencies).length} production dependencies`);
  console.log(`${archiveFiles.length} files, ${uncompressedBytes} bytes uncompressed`);
  console.log(`sha256 ${buildManifest.coworkArchive.sha256}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
