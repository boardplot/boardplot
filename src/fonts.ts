// boardplot/fonts: the font-metrics API without a chart engine.

/**
 * A host that measures labels with its own font tables needs these three
 * functions and no chart. The package root exports them too, but the root
 * registers the whole catalogue (see src/index.ts), so importing them from
 * there put every chart engine and geo pack into the host's bundle. This
 * entry links the table parser (zod), the bundled preset tables and the text
 * measurer, and no chart type: `scripts/package-smoke.mjs` holds it to that.
 */

export {
  parseFontMetricTables,
  type FontMetricFace,
  type FontMetricTables,
  type FontMetricStyle,
  type SkippedFont,
} from './core/fontMetrics/tableDocument';
export { createMetricTablesMeasurer, measurableFamilies, metricTablesFamilies } from './core/fontMetrics/injected';
