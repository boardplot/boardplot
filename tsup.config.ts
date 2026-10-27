import { defineConfig } from 'tsup';
import { writeFileSync } from 'node:fs';
import { distributionIdentity } from './scripts/build-identity.mjs';
import { thirdPartyNoticesPlugin } from './scripts/third-party-notices.mjs';
import { stripBareChunkImports } from './scripts/strip-bare-chunk-imports.mjs';

// Entry paths and build inputs share tsup's working directory, even when its config is bundled.
const identity = distributionIdentity(process.cwd());

// Every published entry point. scripts/generate-chart-entries.mjs reads this
// map to write dist/<name>.d.ts next to each runtime entry.
export const libraryEntries = {
  index: 'src/index.ts',
  validate: 'src/validate.ts',
  rows: 'src/rows.ts',
  theme: 'src/theme.ts',
  fonts: 'src/fonts.ts',
  fixtures: 'src/fixtures/index.ts',
  'react/index': 'src/react/index.ts',
  'react/prepare': 'src/react/prepare.ts',
  'react/spec': 'src/react/spec.tsx',
  'react/export': 'src/react/export/index.ts',
  'react/story': 'src/react/story.ts',
  'react/theme': 'src/react/theme.ts',
  'react/bar': 'src/react/charts/bar.ts',
  'react/bartable': 'src/react/charts/bartable.ts',
  'react/box': 'src/react/charts/box.ts',
  'react/bullet': 'src/react/charts/bullet.ts',
  'react/butterfly': 'src/react/charts/butterfly.ts',
  'react/choropleth': 'src/react/charts/choropleth.ts',
  'react/cohort': 'src/react/charts/cohort.ts',
  'react/column': 'src/react/charts/column.ts',
  'react/combo': 'src/react/charts/combo.ts',
  'react/diagram': 'src/react/charts/diagram.ts',
  'react/dot': 'src/react/charts/dot.ts',
  'react/funnel': 'src/react/charts/funnel.ts',
  'react/gantt': 'src/react/charts/gantt.ts',
  'react/grid': 'src/react/charts/grid.ts',
  'react/heatmap': 'src/react/charts/heatmap.ts',
  'react/histogram': 'src/react/charts/histogram.ts',
  'react/creative': 'src/react/charts/creative.ts',
  'react/kpi': 'src/react/charts/kpi.ts',
  'react/likert': 'src/react/charts/likert.ts',
  'react/line': 'src/react/charts/line.ts',
  'react/mekko': 'src/react/charts/mekko.ts',
  'react/pareto': 'src/react/charts/pareto.ts',
  'react/pie': 'src/react/charts/pie.ts',
  'react/pvm': 'src/react/charts/pvm.ts',
  'react/pyramid': 'src/react/charts/pyramid.ts',
  'react/sankey': 'src/react/charts/sankey.ts',
  'react/scatter': 'src/react/charts/scatter.ts',
  'react/slope': 'src/react/charts/slope.ts',
  'react/sparkline': 'src/react/charts/sparkline.ts',
  'react/status': 'src/react/charts/status.ts',
  'react/dimswitch': 'src/react/charts/dimswitch.ts',
  'react/table': 'src/react/charts/table.ts',
  'react/tilemap': 'src/react/charts/tilemap.ts',
  'react/treemap': 'src/react/charts/treemap.ts',
  'react/variance': 'src/react/charts/variance.ts',
  'react/waffle': 'src/react/charts/waffle.ts',
  'react/waterfall': 'src/react/charts/waterfall.ts',
  'geo/index': 'src/core/geo/packs/all.ts',
  'geo/dach': 'src/core/geo/packs/dach.ts',
  'geo/de-states': 'src/core/geo/packs/de-states.ts',
  'geo/eu27': 'src/core/geo/packs/eu27.ts',
  'geo/europe': 'src/core/geo/packs/europe.ts',
  'geo/us-states': 'src/core/geo/packs/us-states.ts',
  'geo/world': 'src/core/geo/packs/world.ts',
};

// Code splitting is REQUIRED here, not incidental: the chart registry and the
// geo pack registry are module-level maps. With `splitting: false` every entry
// gets its own copy of them, and `import 'boardplot/geo/dach'` then
// registers into a map that `boardplot/react/choropleth` cannot see —
// green in Node, broken once packed. The flip side is that
// code two entries share lands in a `dist/chunk-*.js` that package.json does
// not list as side-effectful, so a host bundler drops a chunk nothing names.
// A registration therefore either sits in an entry file only that entry
// imports (the geo entries) or is reached through a call (everything else).
export default defineConfig({
  entry: {
    ...libraryEntries,
    'cli/index': 'src/cli/index.ts',
    'mcp/server': 'src/mcp/server.ts',
  },
  define: { __BOARDPLOT_BUILD_VERSION__: JSON.stringify(identity.version) },
  onSuccess: async () => {
    writeFileSync('dist/build-identity.json', JSON.stringify(identity, null, 2) + '\n');
    stripBareChunkImports('dist');
  },
  format: ['esm'],
  esbuildPlugins: [thirdPartyNoticesPlugin(process.cwd())],
  // Declarations come from one `tsc -p tsconfig.build.json` pass into
  // dist/types/ (see `build:types`). tsup's declaration worker rebuilt the
  // whole options type graph once per entry and needed more than the default
  // heap on a fresh clone.
  dts: false,
  // The published package carries no source maps; `npm run build:debug` adds them.
  sourcemap: false,
  esbuildOptions(options) {
    options.sourcesContent = false;
    options.minifySyntax = true;
  },
  clean: true,
  external: ['react', 'react-dom'],
});
