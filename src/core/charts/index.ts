import { linkStaticFooter } from '../staticFooter';
import { dimswitchDefinition } from './dimswitch';
/**
 * The chart catalogue. Importing this module registers every chart type
 * (`registerCatalogue` below); an entry that has to survive a host bundler
 * calls `registerCatalogue()` itself, which is a value dependency. The chart
 * modules do not register themselves.
 */

// A graph with the whole catalogue is a CLI-shaped graph: it links the theme
// checks `resolveTheme` runs over a patched theme and the annotation placement
// pass rather than fetching them (see core/deferred). `registerCatalogue`
// calls both links: a bare import would be dropped by a host bundler, since
// package.json does not list those modules as side-effectful. The per-type
// React entries import a single core.
import { linkThemeShapeRules } from '../themeShapeRules';
import { linkAnnotateEngine } from '../annotateEngine';
import { waterfallDefinition } from './waterfall';
import { butterflyDefinition } from './butterfly';
import { funnelDefinition } from './funnel';
import { barDefinition } from './bar';
import { bartableDefinition } from './bartable';
import { boxDefinition } from './box';
import { columnDefinition } from './column';
import { varianceDefinition } from './variance';
import { dotDefinition } from './dot';
import { bulletDefinition } from './bullet';
import { slopeDefinition } from './slope';
import { lineDefinition } from './line';
import { creativeDefinition } from './creative';
import { comboDefinition } from './combo';
import { gridDefinition } from './grid';
import { scatterDefinition } from './scatter';
import { kpiDefinition } from './kpi';
import { heatmapDefinition } from './heatmap';
import { sparklineDefinition } from './sparkline';
import { statusDefinition } from './status';
import { mekkoDefinition } from './mekko';
import { pieDefinition } from './pie';
import { ganttDefinition } from './gantt';
import { tableDefinition } from './table';
import { choroplethDefinition } from './choropleth';
import { tilemapDefinition } from './tilemap';
import { cohortDefinition } from './cohort';
import { pvmDefinition } from './pvm';
import { histogramDefinition } from './histogram';
import { diagramDefinition } from './diagram';
import { likertDefinition } from './likert';
import { paretoDefinition } from './pareto';
import { pyramidDefinition } from './pyramid';
import { waffleDefinition } from './waffle';
import { treemapDefinition } from './treemap';
import { sankeyDefinition } from './sankey';
import { getChart, registerChart, type ChartDefinition } from '../registry';

/**
 * Consumers that need the whole catalogue import these values so tree shaking
 * retains the definitions and their registrations. The grid React entry uses
 * this array to resolve its panels through getChart at layout time.
 */
export const chartDefinitions = [
  barDefinition,
  bartableDefinition,
  boxDefinition,
  bulletDefinition,
  butterflyDefinition,
  choroplethDefinition,
  cohortDefinition,
  columnDefinition,
  comboDefinition,
  creativeDefinition,
  diagramDefinition,
  dotDefinition,
  funnelDefinition,
  ganttDefinition,
  gridDefinition,
  heatmapDefinition,
  histogramDefinition,
  kpiDefinition,
  likertDefinition,
  lineDefinition,
  mekkoDefinition,
  paretoDefinition,
  pieDefinition,
  pvmDefinition,
  pyramidDefinition,
  sankeyDefinition,
  scatterDefinition,
  slopeDefinition,
  sparklineDefinition,
  statusDefinition,
  dimswitchDefinition,
  tableDefinition,
  tilemapDefinition,
  treemapDefinition,
  varianceDefinition,
  waffleDefinition,
  waterfallDefinition,
] as const;

let catalogueRegistered = false;

/**
 * Registers every definition once. A definition replaces a zod-free core an
 * entry registered first (`registerChart` accepts that upgrade), so the probe
 * asks for the schema rather than for the type.
 */
export function registerCatalogue(): void {
  linkStaticFooter();
  linkThemeShapeRules();
  linkAnnotateEngine();
  if (catalogueRegistered) return;
  catalogueRegistered = true;
  // The registry stores definitions with erased generics; the list is a union
  // of all concrete ones, so this is the widest honest type here.
  for (const definition of chartDefinitions as readonly ChartDefinition<any, any, any, any>[]) {
    if (!getChart(definition.type)?.dataSchema) registerChart(definition);
  }
}

registerCatalogue();
