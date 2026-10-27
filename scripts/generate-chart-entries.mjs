/**
 * Generates one React entry module per registered chart type into
 * src/react/charts/, so a consumer can import ONE chart instead of the
 * catalogue barrel (which registers all types and is unshakeable by design).
 * Each module carries its type's option key tree (keyTree below), so the
 * entry refuses an unknown option prop without linking zod.
 *
 * `--check` compares the generated modules with the files on disk.
 *
 * --check fails when:
 *   - a registered chart type has no binding here (a 23rd type was added),
 *   - a binding here names a type that is not registered,
 *   - a generated module on disk differs from what this script would write,
 *   - package.json "exports" lacks ./react/<type> for any type,
 *   - tsup.config.ts lacks the entry for any type.
 *
 * `--declarations` runs after `tsc -p tsconfig.build.json` in the build. It
 * writes each published entry's dist/<name>.d.ts as a one-line re-export of
 * the declaration tsc emitted into dist/types/, gives every relative import
 * in those declarations the explicit `.js` path that `moduleResolution:
 * nodenext` consumers need, and deletes the declarations no entry reaches.
 *
 * Usage: node scripts/generate-chart-entries.mjs [--check | --declarations]
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
const outputDirectory = join(repositoryRoot, 'src/react/charts');
const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const declarationsOnly = argv.includes('--declarations');
const unexpectedArguments = argv.filter((argument) => argument !== '--check' && argument !== '--declarations');
if (unexpectedArguments.length > 0 || (checkOnly && declarationsOnly)) {
  throw new Error(`usage: node scripts/generate-chart-entries.mjs [--check | --declarations]; got ${argv.join(' ')}`);
}

const require = createRequire(join(repositoryRoot, 'package.json'));
const esbuild = require('esbuild');

const DATA_TYPES = '../../core/types/data';
/** Types whose rows fill a data shape of their own; src/core/rows.ts has one adapter per shape. */
const OWN_ROWS_SHAPES = ['waterfall', 'scatter', 'table', 'histogram', 'box'];
const OPTION_TYPES = '../../core/types/options';

/**
 * type -> React binding. Component names match src/react/index.ts wherever
 * that barrel exports the type (GridChart, KpiChart, TableChart); the four
 * types the barrel never exported get type-named components here.
 *
 * `panels: true` means the entry registers a loader for the cores its
 * panels name (src/react/loadChartTypes.ts): grid lays its panels out
 * through getChart(panel.type), and `requireChartCores` fetches them first.
 *
 * `links` names the core modules this type's layout needs on EVERY chart,
 * which a React entry otherwise fetches on demand (src/core/deferred). Two
 * types earn an entry here, and each is a measured fact about the layout,
 * not a precaution: pareto derives the cumulative threshold rule as a value
 * line whenever `cumulative` is on, which is the default, and likert builds
 * a theme patch for its statement labels on every layout. Without the
 * static link both would draw the busy placeholder for a pass, and their
 * server pass would write one — for every chart of that type, annotated or
 * not. Every other type reaches these modules only when a chart actually
 * carries the work.
 */
const BINDINGS = {
  bar: {
    component: 'BarChart',
    data: ['RangeChartData', DATA_TYPES],
    options: ['BarOptions', OPTION_TYPES],
  },
  bartable: {
    component: 'BarTableChart',
    data: ['BarTableData', '../../core/charts/bartable/types'],
    options: ['BarTableOptions', '../../core/charts/bartable/types'],
  },
  box: {
    component: 'BoxChart',
    data: ['BoxData', '../../core/charts/box/types'],
    options: ['BoxOptions', '../../core/charts/box/types'],
  },
  bullet: {
    component: 'BulletChart',
    data: ['BulletData', DATA_TYPES],
    options: ['BulletOptions', OPTION_TYPES],
  },
  butterfly: {
    component: 'ButterflyChart',
    data: ['ChartData', DATA_TYPES],
    options: ['ButterflyOptions', OPTION_TYPES],
  },
  choropleth: {
    component: 'ChoroplethChart',
    data: ['ChoroplethData', '../../core/charts/choropleth/types'],
    options: ['ChoroplethOptions', '../../core/charts/choropleth/types'],
    note: [
      "This entry ships NO map geometry. Register the pack you draw, once:",
      "  import 'boardplot/geo/world';   // or dach | de-states | eu27 | europe | us-states",
      'A pack that is not registered throws from getGeoPack with the fix line.',
    ],
  },
  cohort: {
    component: 'CohortChart',
    data: ['CohortData', '../../core/charts/cohort/types'],
    options: ['CohortOptions', '../../core/charts/cohort/types'],
  },
  column: {
    component: 'ColumnChart',
    data: ['RangeChartData', DATA_TYPES],
    // AnomalyColumnOptions, not ColumnOptions: signColor and anomaly are
    // chart-local (BarOptions extends ColumnOptions, so the shared type would
    // leak them into bar). The published props are enumerated against the
    // RUNTIME option surface, so naming the narrower type here would make the
    // React component reject options the layout accepts.
    options: ['AnomalyColumnOptions', '../../core/charts/column/types'],
  },
  combo: {
    component: 'ComboChart',
    data: ['ChartData', DATA_TYPES],
    options: ['ComboOptions', OPTION_TYPES],
    loose: true,
  },
  diagram: {
    component: 'DiagramChart',
    data: ['DiagramData', '../../core/types/diagram'],
    options: ['DiagramOptions', '../../core/types/diagram'],
  },
  dot: {
    component: 'DotChart',
    data: ['RangeChartData', DATA_TYPES],
    options: ['DotOptions', OPTION_TYPES],
  },
  funnel: {
    component: 'FunnelChart',
    data: ['ChartData', DATA_TYPES],
    options: ['FunnelOptions', OPTION_TYPES],
  },
  gantt: {
    component: 'GanttChart',
    data: ['GanttData', DATA_TYPES],
    options: ['GanttOptions', '../../core/charts/gantt/layout'],
  },
  grid: {
    component: 'GridChart',
    data: ['GridInput', '../../core/charts/grid/normalize'],
    options: ['GridLayoutOptions', '../../core/charts/grid/normalize'],
    panels: true,
    note: [
      'Grid lays its panels out through getChart(panel.type). This entry links',
      'only the grid core and fetches the cores its panels name (core/deferred).',
    ],
  },
  heatmap: {
    component: 'HeatmapChart',
    data: ['HeatmapData', DATA_TYPES],
    options: ['HeatmapOptions', OPTION_TYPES],
  },
  histogram: {
    component: 'HistogramChart',
    data: ['HistogramData', '../../core/charts/histogram/types'],
    options: ['HistogramOptions', '../../core/charts/histogram/types'],
  },
  creative: { component: 'CreativeChart', data: ['CreativeData', '../../core/charts/creative/types'], options: ['CreativeOptions', '../../core/charts/creative/types'] },
  kpi: { component: 'KpiChart', data: ['KpiData', DATA_TYPES], options: ['KpiOptions', OPTION_TYPES] },
  likert: {
    component: 'LikertChart',
    data: ['LikertData', '../../core/charts/likert/layout'],
    options: ['LikertOptions', '../../core/charts/likert/layout'],
    links: [['../../core/themeShapeRules', 'linkThemeShapeRules', 'every likert layout patches the theme for its statement labels']],
  },
  line: {
    component: 'LineChart',
    data: ['LineChartData', DATA_TYPES],
    options: ['LineOptions', OPTION_TYPES],
  },
  mekko: {
    component: 'MekkoChart',
    data: ['ChartData', DATA_TYPES],
    options: ['MekkoOptions', OPTION_TYPES],
  },
  pareto: {
    component: 'ParetoChart',
    data: ['ParetoData', '../../core/charts/pareto/layout'],
    options: ['ParetoOptions', OPTION_TYPES],
    links: [['../../core/annotateEngine', 'linkAnnotateEngine', 'every pareto with its default cumulative curve derives the threshold value line']],
  },
  pie: { component: 'PieChart', data: ['ChartData', DATA_TYPES], options: ['PieOptions', OPTION_TYPES] },
  pvm: {
    component: 'PvmChart',
    data: ['PvmData', '../../core/charts/pvm/types'],
    options: ['PvmOptions', '../../core/charts/pvm/types'],
  },
  pyramid: {
    component: 'PyramidChart',
    data: ['PyramidData', '../../core/charts/pyramid/types'],
    options: ['PyramidOptions', '../../core/charts/pyramid/types'],
  },
  scatter: {
    component: 'ScatterChart',
    data: ['ScatterData', DATA_TYPES],
    options: ['ScatterStrategyOptions', '../../core/charts/scatter/types'],
  },
  slope: {
    component: 'SlopeChart',
    data: ['SlopeChartData', DATA_TYPES],
    options: ['SlopeOptions', OPTION_TYPES],
  },
  sparkline: {
    component: 'SparklineChart',
    data: ['SparklineData', DATA_TYPES],
    options: ['SparklineOptions', OPTION_TYPES],
  },
  status: {
    component: 'StatusChart',
    data: ['StatusData', '../../core/charts/status/layout'],
    options: ['StatusOptions', '../../core/charts/status/layout'],
  },
  dimswitch: { component: 'DimSwitchChart', reexport: '../DimSwitchChart', propsType: 'DimSwitchChartProps, DimSwitchView, DimSwitchViewReason' },
  table: { component: 'TableChart', reexport: '../TableChart', propsType: 'TableChartProps, TableHandle, TableRowLabelLead, TableRowSelectDetail, TableScrollState' },
  tilemap: {
    component: 'TilemapChart',
    data: ['TilemapData', '../../core/charts/tilemap/types'],
    options: ['TilemapOptions', '../../core/charts/tilemap/types'],
  },
  variance: {
    component: 'VarianceChart',
    data: ['ChartData', DATA_TYPES],
    options: ['VarianceOptions', OPTION_TYPES],
  },
  sankey: {
    component: 'SankeyChart',
    data: ['SankeyData', '../../core/charts/sankey/types'],
    options: ['SankeyOptions', '../../core/charts/sankey/types'],
  },
  treemap: {
    component: 'TreemapChart',
    data: ['TreemapData', '../../core/charts/treemap/types'],
    options: ['TreemapOptions', '../../core/charts/treemap/types'],
  },
  waffle: {
    component: 'WaffleChart',
    data: ['ChartData', DATA_TYPES],
    options: ['WaffleOptions', '../../core/charts/waffle/types'],
  },
  waterfall: {
    component: 'WaterfallChart',
    data: ['WaterfallData', DATA_TYPES],
    options: ['WaterfallOptions', OPTION_TYPES],
  },
};

const quoted = (value) => `'${value}'`;

const HEADER = '// Generated by scripts/generate-chart-entries.mjs. Do not edit by hand.\n\n"use client";';

// Read both registries so newly registered charts and geo packs enter the checks.
async function registeredEntries() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'boardplot-chart-entries-'));
  try {
    const entryPath = join(temporaryDirectory, 'types-entry.ts');
    const outPath = join(temporaryDirectory, 'types.mjs');
    await writeFile(
      entryPath,
      [
        `import { chartCores } from ${JSON.stringify(join(repositoryRoot, 'src/core/charts/cores'))};`,
        `import { listGeoPacks, registerAllGeoPacks } from ${JSON.stringify(join(repositoryRoot, 'src/core/geo/packs/index'))};`,
        'registerAllGeoPacks();',
        'export const types = chartCores.map((core) => core.type);',
        'export const aliases = Object.fromEntries(chartCores.map((core) => [core.type, [...(core.aliases ?? [])].sort()]));',
        'export const aliasDefaults = Object.fromEntries(chartCores.map((core) => [core.type, core.aliasDefaults]));',
        'export const geoPackIds = listGeoPacks().map((pack) => pack.id);',
        // The options schema of every type as the CLI reads it (chartValidation.ts), for the key trees.
        "import { z } from 'zod';",
        `import ${JSON.stringify(join(repositoryRoot, 'src/core/charts/index'))};`,
        `import { getChartSchemas } from ${JSON.stringify(join(repositoryRoot, 'src/core/registry'))};`,
        `import { LABEL_KINDS } from ${JSON.stringify(join(repositoryRoot, 'src/core/schema/capability'))};`,
        "export const optionSchemas = Object.fromEntries(chartCores.map((core) => [core.type, z.toJSONSchema(getChartSchemas(core.type).optionsSchema, { io: 'input' })]));",
        'export const labelKinds = LABEL_KINDS;',
        // The rows shape of every type, read from its data schema as src/core/rows.ts once did at run time.
        "export const rowsShapes = Object.fromEntries(chartCores.flatMap((core) => {",
        "  if (core.type === 'choropleth' || core.type === 'tilemap') return [[core.type, 'map']];",
        `  if (${JSON.stringify(OWN_ROWS_SHAPES)}.includes(core.type)) return [[core.type, core.type]];`,
        "  if (core.type === 'sankey') return [[core.type, 'flow']];",
        "  const properties = z.toJSONSchema(getChartSchemas(core.type).dataSchema, { io: 'input' }).properties ?? {};",
        "  return Object.hasOwn(properties, 'categories') && Object.hasOwn(properties, 'series') ? [[core.type, 'category']] : [];",
        "}));",
        '',
      ].join('\n'),
    );
    await esbuild.build({
      entryPoints: [entryPath],
      outfile: outPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      absWorkingDir: repositoryRoot,
      nodePaths: [join(repositoryRoot, 'node_modules')],
    });
    const module = await import(pathToFileURL(outPath).href);
    const optionKeys = Object.fromEntries(Object.entries(module.optionSchemas).map(([type, schema]) => {
      const kinds = module.labelKinds[type];
      return [type, kinds ? { tree: keyTree(schema), labels: kinds } : { tree: keyTree(schema) }];
    }));
    return { types: [...module.types].sort(), aliases: module.aliases, aliasDefaults: module.aliasDefaults, geoPackIds: [...module.geoPackIds].sort(), optionKeys, rowsShapes: module.rowsShapes };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * The option keys one schema node takes, as unknownKeys walks them
 * (src/core/schema/unknownKeys.ts): 0 takes any value, an object names the
 * keys it takes, '*' any key, '[]' the items of an array. Union and
 * intersection branches merge, so a key any branch declares is taken. A key
 * the schema refuses by name (`not: {}`) is left out: the capability tables
 * answer it first. Whatever the walk cannot read takes any value, so the
 * tree refuses no key the CLI keeps. A plain object strips an unknown key,
 * which the CLI refuses; a loose one keeps it, and a record keys by id.
 */
const SHAPE_KEYWORDS = ['type', 'properties', 'additionalProperties', 'items', 'prefixItems', 'anyOf', 'oneOf', 'allOf', 'enum', 'const', 'not'];

function keyTree(node) {
  const branches = (schema) => [schema, ...[...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])].flatMap(branches)];
  const merge = (a, b) => {
    if (a === undefined) return b;
    if (a === 0 || b === 0) return 0;
    const merged = { ...a };
    for (const [key, child] of Object.entries(b)) merged[key] = merge(merged[key], child);
    return merged;
  };
  let tree;
  for (const branch of branches(node)) {
    // A branch with no shape (z.any, z.custom, a $ref this walk does not follow) takes anything.
    if (!SHAPE_KEYWORDS.some((keyword) => keyword in branch)) return 0;
    if (branch.properties || (branch.additionalProperties !== undefined && branch.additionalProperties !== false)) {
      const keys = {};
      for (const [key, child] of Object.entries(branch.properties ?? {})) {
        if (!(child.not && Object.keys(child.not).length === 0)) keys[key] = keyTree(child);
      }
      if (branch.additionalProperties !== undefined && branch.additionalProperties !== false) keys['*'] = keyTree(branch.additionalProperties);
      tree = merge(tree ?? {}, keys);
    }
    if (branch.items) tree = merge(tree ?? {}, { '[]': keyTree(branch.items) });
    if (branch.prefixItems) tree = merge(tree ?? {}, { '[]': 0 });
  }
  if (tree === undefined || tree === 0) return 0;
  // Nothing below to check: an array of plain values, a map of any keys.
  const keys = Object.keys(tree);
  if (keys.length === 1 && (keys[0] === '[]' || keys[0] === '*') && tree[keys[0]] === 0) return 0;
  return tree;
}

/**
 * Evaluate the runtime entry map and the exported library entry map (the
 * entries that get a declaration file). Shared constants or object spreads
 * must not hide a missing runtime or declaration entry from the package checks.
 */
async function loadTsupConfig() {
  const shim = {
    name: 'tsup-defineConfig-shim',
    setup(build) {
      build.onResolve({ filter: /^tsup$/ }, () => ({ path: 'tsup', namespace: 'tsup-shim' }));
      build.onLoad({ filter: /.*/, namespace: 'tsup-shim' }, () => ({
        contents: 'export const defineConfig = (config) => config;',
        loader: 'js',
      }));
    },
  };
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'boardplot-tsup-config-'));
  try {
    const outPath = join(temporaryDirectory, 'tsup.config.mjs');
    await esbuild.build({
      entryPoints: [join(repositoryRoot, 'tsup.config.ts')],
      outfile: outPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      absWorkingDir: repositoryRoot,
      plugins: [shim],
    });
    const module = await import(pathToFileURL(outPath).href);
    const config = module.default;
    if (!config || typeof config !== 'object') throw new Error('tsup.config.ts did not export an object');
    const entry = config.entry;
    const libraryEntries = module.libraryEntries;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('tsup.config.ts `entry` must be an object map of outName -> source path');
    }
    if (!libraryEntries || typeof libraryEntries !== 'object' || Array.isArray(libraryEntries)) {
      throw new Error('tsup.config.ts must export `libraryEntries`, an object map of outName -> source path');
    }
    return { entry, libraryEntries };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

// A relative module specifier in an emitted declaration: `from '../x'`,
// `import('../x')`, the bare `import '../x'`, and tsc's own `import("..")`.
const RELATIVE_SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?(?:\/[^'"]*)?)\2/g;

/** `./x.js` style path from one declaration file to another. */
function declarationSpecifier(fromFile, toFile) {
  const path = relative(dirname(fromFile), toFile).split(sep).join('/').replace(/\.d\.ts$/, '.js');
  return path.startsWith('.') ? path : `./${path}`;
}

function resolveDeclaration(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier.replace(/\.js$/, ''));
  // '.', '..' and a trailing slash name a directory, as in TypeScript's own resolution.
  const directoryOnly = /(^|\/)\.\.?$|\/$/.test(specifier);
  const candidates = directoryOnly ? [join(base, 'index.d.ts')] : [`${base}.d.ts`, join(base, 'index.d.ts')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`${relative(repositoryRoot, fromFile)} imports '${specifier}', which has no declaration file`);
  }
  return found;
}

async function listDeclarationFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listDeclarationFiles(path)));
    else if (entry.name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

/** Writes dist/<name>.d.ts per library entry and trims dist/types/ to what those reach. */
async function writeDeclarationEntries(libraryEntries) {
  const distDirectory = join(repositoryRoot, 'dist');
  const typesDirectory = join(distDirectory, 'types');
  const pending = [];
  for (const [outName, sourcePath] of Object.entries(libraryEntries)) {
    const emitted = join(typesDirectory, sourcePath.replace(/^src\//, '').replace(/\.tsx?$/, '.d.ts'));
    if (!existsSync(emitted)) {
      throw new Error(`${relative(repositoryRoot, emitted)} is missing; run tsc -p tsconfig.build.json first`);
    }
    const stub = join(distDirectory, `${outName}.d.ts`);
    await mkdir(dirname(stub), { recursive: true });
    await writeFile(stub, `export * from '${declarationSpecifier(stub, emitted)}';\n`);
    pending.push(emitted);
  }
  const reached = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    const text = await readFile(file, 'utf8');
    const rewritten = text.replace(RELATIVE_SPECIFIER, (_match, keyword, quote, specifier) => {
      const target = resolveDeclaration(file, specifier);
      pending.push(target);
      return `${keyword}${quote}${declarationSpecifier(file, target)}${quote}`;
    });
    if (rewritten !== text) await writeFile(file, rewritten);
  }
  const emitted = await listDeclarationFiles(typesDirectory);
  const unreached = emitted.filter((file) => !reached.has(file));
  await Promise.all(unreached.map((file) => rm(file)));
  console.log(
    `wrote ${Object.keys(libraryEntries).length} declaration entries; ` +
      `dist/types keeps ${reached.size} of ${emitted.length} declaration files`,
  );
}

/** Share repeated data nodes while keeping every key and its order unchanged. */
function sharedKeyTrees(optionKeys) {
  const counts = new Map();
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return;
    const text = JSON.stringify(value);
    if (text.length >= 80) counts.set(text, (counts.get(text) ?? 0) + 1);
    for (const child of Object.values(value)) visit(child);
  };
  for (const keys of Object.values(optionKeys)) visit(keys);
  // A child comes before its parent. Literal text, rather than the host locale, breaks ties.
  const repeated = [...counts].filter(([, count]) => count > 1).map(([text]) => text)
    .sort((left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0));
  const names = new Map(repeated.map((text, index) => [text, `sharedKeys${index}`]));
  const render = (value, used, own) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const name = names.get(JSON.stringify(value));
    if (name && name !== own) {
      used?.add(name);
      return name;
    }
    if (Array.isArray(value)) return `[${value.map((child) => render(child, used)).join(',')}]`;
    return `{${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)}:${render(child, used)}`).join(',')}}`;
  };
  return {
    render,
    source: [
      '// Generated by scripts/generate-chart-entries.mjs. Do not edit by hand.',
      '// Shared option-key data. Each chart keeps the same keys in the same order.',
      '',
      ...repeated.map((text) => `export const ${names.get(text)} = ${render(JSON.parse(text), undefined, names.get(text))} as const;`),
      '',
    ].join('\n'),
  };
}

function renderModule(type, binding, keys, keyTrees) {
  const lines = [HEADER, `// Single-chart React entry for '${type}'.`];
  const shared = new Set();
  const renderedKeys = keyTrees.render(keys, shared);
  if (shared.size) lines.push('', `import { ${[...shared].join(', ')} } from '../optionKeyTrees';`);
  const keyLines = [
    `// The option keys '${type}' takes, from its options schema: a prop outside them draws the unknown-option refusal.`,
    ...(binding.panels ? ["// A panel's options sit in the grid's data and are not checked here; react/spec validates them."] : []),
    `const checkOptionKeys = optionKeyCheck(${renderedKeys});`,
    '',
  ];
  if (binding.note) for (const noteLine of binding.note) lines.push(`// ${noteLine}`);
  lines.push('');
  // A link is a call, not a bare import: a host bundler drops a bare import of
  // the shared chunk that carries the publisher, and keeps a call.
  for (const [module, link, why] of binding.links ?? []) {
    lines.push(`// Linked, not fetched: ${why}.`);
    lines.push(`import { ${link} } from ${quoted(module)};`);
  }
  if (binding.links) lines.push('');

  // A bare `import '../../core/charts/<type>/core'` would be a side-effect-only
  // import, and in the packed form the registration lands in a shared
  // dist/chunk-*.js whose path no "sideEffects" glob can name by intent. The
  // entry therefore routes the chart core through registeredType(),
  // which registers it and returns the type string the exported component is
  // built from: the exported binding has a real data dependency on the
  // registration, so no tree-shaker can keep the component and drop it.
  const coreImport = `import { ${type}Core } from '../../core/charts/${type}/core';`;
  const registered = binding.panels
    ? `registeredTypeWithPanelCores(${type}Core)`
    : `registeredType(${type}Core)`;

  if (binding.reexport) {
    // TableChart renders straight from resolveTable and never consults the
    // registry, so nothing on this subpath breaks if the registration is
    // dropped — but `boardplot describe --fixture table` and every consumer that
    // reaches the catalogue does break, so the registration is value-linked
    // here too rather than left to a droppable bare import.
    lines.push(coreImport);
    lines.push(`import { create${binding.component} } from ${quoted(binding.reexport)};`);
    lines.push("import { registeredType, withRegistered } from '../chartEntry';");
    lines.push("import { optionKeyCheck } from '../../core/schema/unknownKeys';");
    lines.push('');
    lines.push(`export type { ${binding.propsType} } from ${quoted(binding.reexport)};`);
    lines.push('');
    lines.push(...keyLines);
    lines.push(
      `export const ${binding.component} = withRegistered(create${binding.component}(checkOptionKeys), ${registered});`,
    );
    lines.push('');
    return lines.join('\n');
  }

  const [dataName] = binding.data;
  const [optionsName] = binding.options;
  lines.push(coreImport);
  lines.push(
    binding.panels
      ? "import { registeredTypeWithPanelCores } from '../loadChartTypes';"
      : "import { registeredType } from '../chartEntry';",
  );
  lines.push("import { createChartComponent } from '../createChartComponent';");
  lines.push("import { optionKeyCheck } from '../../core/schema/unknownKeys';");
  const typeImports = new Map();
  const addTypeImport = (name, from) => {
    if (!typeImports.has(from)) typeImports.set(from, new Set());
    typeImports.get(from).add(name);
  };
  addTypeImport(...binding.data);
  addTypeImport(...binding.options);
  if (binding.loose) {
    addTypeImport('BaseOptions', OPTION_TYPES);
    addTypeImport('ChartComponentProps', '../createChartComponent');
  }
  if (binding.loose) lines.push("import type { ReactElement } from 'react';");
  for (const from of [...typeImports.keys()].sort()) {
    const names = [...typeImports.get(from)].sort().join(', ');
    lines.push(`import type { ${names} } from ${quoted(from)};`);
  }
  lines.push('');
  lines.push("export type { ChartProps } from '../createChartComponent';");
  lines.push('');
  for (const [, link] of binding.links ?? []) lines.push(`${link}();`);
  if (binding.links) lines.push('');
  lines.push(...keyLines);
  // The deferred modules the entry links count in the server's and the hydrating first frame.
  const DEFERRED_NAMES = { linkThemeShapeRules: 'theme-rules', linkAnnotateEngine: 'annotate' };
  const linkedArg = binding.links ? `, ${JSON.stringify(binding.links.map(([, link]) => DEFERRED_NAMES[link]))}` : '';
  if (binding.links?.some(([, link]) => !DEFERRED_NAMES[link])) throw new Error(`${type}: a link without a deferred module name`);
  if (binding.loose) {
    lines.push(
      `// ${optionsName} narrows a BaseOptions field, so it does not satisfy`,
      "// createChartComponent's BaseOptions constraint. The registry carries the same",
      `// cast (src/core/charts/${type}/index.ts); the props type below is the accurate one.`,
      `export type ${binding.component}Props = Omit<${optionsName}, 'annotations' | 'size'> & ChartComponentProps<${dataName}>;`,
      '',
      `export const ${binding.component}: (props: ${binding.component}Props) => ReactElement =`,
      `  createChartComponent<${dataName}, BaseOptions>(${registered}, checkOptionKeys${linkedArg}) as unknown as (`,
      `    props: ${binding.component}Props,`,
      '  ) => ReactElement;',
    );
  } else {
    lines.push(
      `export const ${binding.component} = createChartComponent<${dataName}, ${optionsName}>(${registered}, checkOptionKeys${linkedArg});`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * The loader map BoardplotChart draws with: one `import()` per chart type, so
 * the spec entry names every type without linking any engine and a host
 * bundler emits one chunk per type. Each loader points at the type's own
 * React entry, so the registration that entry carries is the one the spec
 * path gets — grid's, for one, fetches the cores its panels name.
 */
function renderLoaders(types) {
  return [
    HEADER,
    '// The engine of one chart type, on demand. See src/react/spec.tsx.',
    '',
    '/** type -> the module that registers that type, loaded on first use. */',
    'export const chartLoaders: Readonly<Record<string, () => Promise<unknown>>> = {',
    ...types.map((type) => `  ${type}: () => import('./charts/${type}'),`),
    '};',
    '',
  ].join('\n');
}

/**
 * The schema map BoardplotChart validates with: one `import()` per chart type,
 * pointing at the type's `schema.ts`, which carries its data and options
 * schemas and reaches no layout, no marks and no chart core. Loading one
 * registers no engine — `getChart` stays undefined until `chartLoaders`
 * brings the type's own React entry.
 */
function renderSchemaLoaders(types, aliases, aliasDefaults) {
  const aliased = types.filter((type) => aliases[type].length > 0);
  return [
    HEADER,
    '// The data and options schemas of one chart type, on demand. See src/react/spec.tsx.',
    '',
    "import type { ChartSchemas } from '../core/registry';",
    '',
    '/** type -> its schemas, without its engine, loaded on first use. */',
    'export const schemaLoaders: Readonly<Record<string, () => Promise<ChartSchemas<any, any>>>> = {',
    ...types.map((type) =>
      `  ${type}: () => import('../core/charts/${type}/schema')\n` +
      `    .then((module) => ({ type: '${type}', dataSchema: module.${type}DataSchema, optionsSchema: module.${type}OptionsSchema${type === 'grid' ? ', dataSchemaByOption: { stack: module.metricStackDataSchema }' : ''}${aliasDefaults[type] ? `, aliasDefaults: ${JSON.stringify(aliasDefaults[type])}` : ''} })),`),
    '};',
    '',
    '/** type -> the alias names a spec may write instead, so an aliased type finds its chunk. */',
    'export const chartTypeAliases: Readonly<Record<string, readonly string[]>> = {',
    ...aliased.map((type) => `  ${type}: [${aliases[type].map(quoted).join(', ')}],`),
    '};',
    '',
  ].join('\n');
}

/**
 * The core map the non-React paths load with (`react/export`,
 * `react/prepare`, a grid's panels): one `import()` per chart type, pointing
 * at the type's `core.ts`. Unlike `chartLoaders` it reaches no React entry,
 * so a server graph never meets a "use client" module through it.
 */
function renderCoreLoaders(types) {
  // No "use client": `react/prepare` imports this map in server code.
  return [
    '// Generated by scripts/generate-chart-entries.mjs. Do not edit by hand.',
    '',
    '// The layout core of one chart type, on demand. See src/react/loadChartTypes.ts.',
    '',
    "import type { ChartCore } from '../core/registry';",
    '',
    '/** type -> its chart core, loaded on first use. Registering it is the caller\'s job. */',
    'export const coreLoaders: Readonly<Record<string, () => Promise<ChartCore<any, any, any, any>>>> = {',
    ...types.map((type) => `  ${type}: () => import('../core/charts/${type}/core').then((module) => module.${type}Core),`),
    '};',
    '',
  ].join('\n');
}

/**
 * The chart names and rows shapes src/core/rows.ts reads, so turning rows
 * into data needs no chart registry and no zod: the browser import of
 * `boardplot/rows` stays light.
 */
function renderRowsTypes(types, aliases, rowsShapes) {
  const names = types.flatMap((type) => [[type, type], ...aliases[type].map((alias) => [alias, type])])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    '// Generated by scripts/generate-chart-entries.mjs. Do not edit by hand.',
    '// Chart names and their rows shapes, without the chart registry. See src/core/rows.ts.',
    '',
    `export type RowsShape = ${['category', 'map', ...OWN_ROWS_SHAPES, 'flow'].map(quoted).join(' | ')};`,
    '',
    '/** Every chart type and alias -> its type. */',
    'export const CHART_TYPE_OF: ReadonlyMap<string, string> = new Map([',
    ...names.map(([name, type]) => `  [${quoted(name)}, ${quoted(type)}],`),
    ']);',
    '',
    '/** type -> the rows shape it takes. A type that is absent has no rows mapping. */',
    'export const ROWS_SHAPES: ReadonlyMap<string, RowsShape> = new Map([',
    ...types.filter((type) => rowsShapes[type]).map((type) => `  [${quoted(type)}, ${quoted(rowsShapes[type])}],`),
    ']);',
    '',
  ].join('\n');
}

/**
 * The bindings `boardplot/react` exports: each type's component built again
 * with both fetched modules linked. The barrel registers every chart core,
 * pareto's and likert's link calls included, so a page that imports it holds
 * both modules, and its server and hydrating frames may use them. The
 * per-type bindings stay as they are: their pages hold only what they link.
 */
function renderBarrelBindings(types) {
  const entry = (type) => `${type}Entry`;
  return [
    HEADER,
    '// The components boardplot/react exports. See src/react/index.ts.',
    '',
    "import { linkedBinding } from './linkedBinding';",
    ...types.map((type) => `import { ${BINDINGS[type].component} as ${entry(type)} } from './charts/${type}';`),
    '',
    "const LINKED = ['annotate', 'chart-cores', 'theme-rules'] as const;",
    '',
    ...types.map((type) => `export const ${BINDINGS[type].component} = linkedBinding(${entry(type)}, LINKED);`),
    '',
  ].join('\n');
}

if (declarationsOnly) {
  await writeDeclarationEntries((await loadTsupConfig()).libraryEntries);
  process.exit(0);
}

const { types, aliases, aliasDefaults, geoPackIds, optionKeys, rowsShapes } = await registeredEntries();
const bound = Object.keys(BINDINGS).sort();
const missing = types.filter((type) => !(type in BINDINGS));
const extra = bound.filter((type) => !types.includes(type));
if (missing.length > 0 || extra.length > 0) {
  const parts = [];
  if (missing.length > 0) {
    parts.push(`registered chart types with no React entry binding: ${missing.join(', ')}`);
  }
  if (extra.length > 0) parts.push(`bindings for unregistered types: ${extra.join(', ')}`);
  throw new Error(`${parts.join('; ')} — edit BINDINGS in scripts/generate-chart-entries.mjs`);
}

const keyTrees = sharedKeyTrees(optionKeys);
const modules = new Map(types.map((type) => [`${type}.ts`, renderModule(type, BINDINGS[type], optionKeys[type], keyTrees)]));
const keyTreesFile = join(repositoryRoot, 'src/react/optionKeyTrees.ts');
const loadersFile = join(repositoryRoot, 'src/react/chartLoaders.ts');
const loadersSource = renderLoaders(types);
const schemaLoadersFile = join(repositoryRoot, 'src/react/schemaLoaders.ts');
const schemaLoadersSource = renderSchemaLoaders(types, aliases, aliasDefaults);
const coreLoadersFile = join(repositoryRoot, 'src/react/coreLoaders.ts');
const coreLoadersSource = renderCoreLoaders(types);
const barrelBindingsFile = join(repositoryRoot, 'src/react/barrelCharts.ts');
const barrelBindingsSource = renderBarrelBindings(types);
const rowsTypesFile = join(repositoryRoot, 'src/core/rowsTypes.ts');
const rowsTypesSource = renderRowsTypes(types, aliases, rowsShapes);

const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
const { entry: tsupEntry, libraryEntries } = await loadTsupConfig();
const wiringErrors = [];

/**
 * One subpath is wired only when ALL FOUR of its parts agree: the exports
 * map, the tsup runtime entry, the library entry that gets a declaration
 * file, and the source file the two entries name.
 */
function checkSubpath(subpath, outName, sourcePath) {
  const expected = {
    types: `./dist/${outName}.d.ts`,
    import: `./dist/${outName}.js`,
    // require() of an ES module works on Node 22.12, the engines floor.
    default: `./dist/${outName}.js`,
  };
  const actual = packageJson.exports[subpath];
  if (actual === undefined) {
    wiringErrors.push(`package.json exports lacks "${subpath}"`);
  } else if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    wiringErrors.push(
      `package.json exports["${subpath}"] is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
  if (tsupEntry[outName] !== sourcePath) {
    wiringErrors.push(
      `tsup.config.ts entry["${outName}"] is ${JSON.stringify(tsupEntry[outName] ?? null)}, ` +
        `expected ${JSON.stringify(sourcePath)} — without it dist/${outName}.js is never emitted ` +
        `and "${subpath}" is a dangling path in the tarball`,
    );
  }
  if (libraryEntries[outName] !== sourcePath) {
    wiringErrors.push(
      `tsup.config.ts libraryEntries["${outName}"] is ${JSON.stringify(libraryEntries[outName] ?? null)}, ` +
        `expected ${JSON.stringify(sourcePath)} — without it dist/${outName}.d.ts is never written`,
    );
  }
}

for (const type of types) {
  checkSubpath(`./react/${type}`, `react/${type}`, `src/react/charts/${type}.ts`);
}
checkSubpath('./theme', 'theme', 'src/theme.ts');
checkSubpath('./fonts', 'fonts', 'src/fonts.ts');
checkSubpath('./react/prepare', 'react/prepare', 'src/react/prepare.ts');
checkSubpath('./react/spec', 'react/spec', 'src/react/spec.tsx');
checkSubpath('./react/export', 'react/export', 'src/react/export/index.ts');
checkSubpath('./react/story', 'react/story', 'src/react/story.ts');
checkSubpath('./react/theme', 'react/theme', 'src/react/theme.ts');
for (const id of geoPackIds) {
  checkSubpath(`./geo/${id}`, `geo/${id}`, `src/core/geo/packs/${id}.ts`);
  if (!packageJson.sideEffects?.includes(`**/geo/packs/${id}.ts`)) {
    wiringErrors.push(`package.json sideEffects lacks "**/geo/packs/${id}.ts"`);
  }
  if (!packageJson.sideEffects?.includes(`dist/geo/${id}.js`)) {
    wiringErrors.push(
      `package.json sideEffects lacks "dist/geo/${id}.js" — a bundler would drop the bare ` +
        `import 'boardplot/geo/${id}' and getGeoPack('${id}') would throw for a pack the consumer DID import`,
    );
  }
}
// Reverse direction: a subpath in `exports` with no registered owner is a
// dangling public promise.
for (const subpath of Object.keys(packageJson.exports)) {
  const reactType = /^\.\/react\/(.+)$/.exec(subpath)?.[1];
  if (reactType !== undefined && !['prepare', 'spec', 'export', 'story', 'theme'].includes(reactType) && !types.includes(reactType)) {
    wiringErrors.push(`package.json exports "${subpath}" has no registered chart type`);
  }
  const geoId = /^\.\/geo\/(.+)$/.exec(subpath)?.[1];
  if (geoId !== undefined && !geoPackIds.includes(geoId)) {
    wiringErrors.push(`package.json exports "${subpath}" has no registered geo pack`);
  }
}

if (checkOnly) {
  const errors = [...wiringErrors];
  const present = new Set(
    (await readdir(outputDirectory).catch(() => [])).filter((name) => name.endsWith('.ts')),
  );
  for (const [name, source] of modules) {
    const current = await readFile(join(outputDirectory, name), 'utf8').catch(() => undefined);
    if (current === undefined) errors.push(`src/react/charts/${name} is missing`);
    else if (current !== source) errors.push(`src/react/charts/${name} is stale`);
    present.delete(name);
  }
  for (const name of [...present].sort()) {
    errors.push(`src/react/charts/${name} has no registered chart type`);
  }
  const currentLoaders = await readFile(loadersFile, 'utf8').catch(() => undefined);
  if (currentLoaders === undefined) errors.push('src/react/chartLoaders.ts is missing');
  else if (currentLoaders !== loadersSource) errors.push('src/react/chartLoaders.ts is stale');
  const currentSchemaLoaders = await readFile(schemaLoadersFile, 'utf8').catch(() => undefined);
  if (currentSchemaLoaders === undefined) errors.push('src/react/schemaLoaders.ts is missing');
  else if (currentSchemaLoaders !== schemaLoadersSource) errors.push('src/react/schemaLoaders.ts is stale');
  const currentCoreLoaders = await readFile(coreLoadersFile, 'utf8').catch(() => undefined);
  if (currentCoreLoaders === undefined) errors.push('src/react/coreLoaders.ts is missing');
  else if (currentCoreLoaders !== coreLoadersSource) errors.push('src/react/coreLoaders.ts is stale');
  const currentBarrelBindings = await readFile(barrelBindingsFile, 'utf8').catch(() => undefined);
  if (currentBarrelBindings === undefined) errors.push('src/react/barrelCharts.ts is missing');
  else if (currentBarrelBindings !== barrelBindingsSource) errors.push('src/react/barrelCharts.ts is stale');
  const currentRowsTypes = await readFile(rowsTypesFile, 'utf8').catch(() => undefined);
  if (currentRowsTypes === undefined) errors.push('src/core/rowsTypes.ts is missing');
  else if (currentRowsTypes !== rowsTypesSource) errors.push('src/core/rowsTypes.ts is stale');
  const currentKeyTrees = await readFile(keyTreesFile, 'utf8').catch(() => undefined);
  if (currentKeyTrees === undefined) errors.push('src/react/optionKeyTrees.ts is missing');
  else if (currentKeyTrees !== keyTrees.source) errors.push('src/react/optionKeyTrees.ts is stale');
  if (errors.length > 0) {
    throw new Error(
      `chart entries are out of date; run npm run generate:chart-entries\n${errors
        .map((error) => `- ${error}`)
        .join('\n')}`,
    );
  }
  console.log(
    `chart entries up to date: ${types.length} types, ${geoPackIds.length} geo packs; ` +
      `exports, tsup entry and library entries all agree`,
  );
} else {
  if (wiringErrors.length > 0) {
    console.warn(`WARNING: wiring incomplete\n${wiringErrors.map((e) => `- ${e}`).join('\n')}`);
  }
  await mkdir(outputDirectory, { recursive: true });
  for (const stale of (await readdir(outputDirectory).catch(() => [])).filter(
    (name) => name.endsWith('.ts') && !modules.has(name),
  )) {
    await rm(join(outputDirectory, stale));
  }
  for (const [name, source] of modules) {
    await writeFile(join(outputDirectory, name), source);
  }
  await writeFile(loadersFile, loadersSource);
  await writeFile(schemaLoadersFile, schemaLoadersSource);
  await writeFile(coreLoadersFile, coreLoadersSource);
  await writeFile(barrelBindingsFile, barrelBindingsSource);
  await writeFile(keyTreesFile, keyTrees.source);
  await writeFile(rowsTypesFile, rowsTypesSource);
  console.log(
    `wrote ${modules.size} entries into src/react/charts/, their loader map into src/react/chartLoaders.ts, ` +
      `their schema map into src/react/schemaLoaders.ts, their core map into src/react/coreLoaders.ts, the barrel bindings into src/react/barrelCharts.ts ` +
      `and the rows shapes into src/core/rowsTypes.ts`,
  );
}
