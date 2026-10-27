import { dimswitchCore } from './dimswitch/core';
import type { ChartCore } from '../registry';
import { barCore } from './bar/core';
import { bartableCore } from './bartable/core';
import { boxCore } from './box/core';
import { bulletCore } from './bullet/core';
import { butterflyCore } from './butterfly/core';
import { choroplethCore } from './choropleth/core';
import { cohortCore } from './cohort/core';
import { columnCore } from './column/core';
import { creativeCore } from './creative/core';
import { comboCore } from './combo/core';
import { diagramCore } from './diagram/core';
import { dotCore } from './dot/core';
import { funnelCore } from './funnel/core';
import { ganttCore } from './gantt/core';
import { gridCore } from './grid/core';
import { heatmapCore } from './heatmap/core';
import { histogramCore } from './histogram/core';
import { kpiCore } from './kpi/core';
import { likertCore } from './likert/core';
import { lineCore } from './line/core';
import { mekkoCore } from './mekko/core';
import { paretoCore } from './pareto/core';
import { pieCore } from './pie/core';
import { pvmCore } from './pvm/core';
import { pyramidCore } from './pyramid/core';
import { scatterCore } from './scatter/core';
import { slopeCore } from './slope/core';
import { sankeyCore } from './sankey/core';
import { sparklineCore } from './sparkline/core';
import { statusCore } from './status/core';
import { tableCore } from './table/core';
import { tilemapCore } from './tilemap/core';
import { treemapCore } from './treemap/core';
import { varianceCore } from './variance/core';
import { waffleCore } from './waffle/core';
import { waterfallCore } from './waterfall/core';

export const chartCores: readonly ChartCore<any, any, any, any>[] = [
  barCore,
  bartableCore,
  boxCore,
  bulletCore,
  butterflyCore,
  choroplethCore,
  cohortCore,
  columnCore,
  comboCore,
  creativeCore,
  diagramCore,
  dotCore,
  funnelCore,
  ganttCore,
  gridCore,
  heatmapCore,
  histogramCore,
  kpiCore,
  likertCore,
  lineCore,
  mekkoCore,
  paretoCore,
  pieCore,
  pvmCore,
  pyramidCore,
  sankeyCore,
  scatterCore,
  slopeCore,
  sparklineCore,
  statusCore,
  dimswitchCore,
  tableCore,
  tilemapCore,
  treemapCore,
  varianceCore,
  waffleCore,
  waterfallCore,
];
