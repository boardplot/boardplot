/** Browser API. SVGs come from the CLI render verb, without file or raster output. */
import { render as cliRender } from '../../src/cli/render';
import { withSize, length } from '../../src/cli/size';
import { registerCatalogue } from '../../src/core/charts';
import { registerAllGeoPacks } from '../../src/core/geo/packs';
import { linkAnnotateEngine } from '../../src/core/annotateEngine';
import { linkStoryLayer } from '../../src/core/storyLayer';
import { linkThemeShapeRules } from '../../src/core/themeShapeRules';
import { BOARDPLOT_VERSION } from '../../src/version';
import type { DocChart } from '../../src/core/doc/document';
import type { RenderTarget } from '../../src/core/types/options';

linkStoryLayer();
linkAnnotateEngine();
linkThemeShapeRules();
registerCatalogue();
registerAllGeoPacks();
export const version = BOARDPLOT_VERSION;

export function withWidth(spec: Record<string, unknown>, width: number): Record<string, unknown> {
  const sizeChart = (chart: DocChart) => withSize(chart, length('width', width), undefined, chart.options?.target as RenderTarget | undefined);
  if (Array.isArray(spec.charts)) {
    return { ...spec, charts: spec.charts.map(chart => sizeChart(chart as DocChart)) };
  }
  return sizeChart(spec as unknown as DocChart) as unknown as Record<string, unknown>;
}

export function render(spec: unknown) {
  const start = performance.now();
  try {
    const { body } = cliRender({ spec, format: 'svg', return: ['svg'] });
    const charts = body.charts as { svg?: string }[] | undefined;
    return { ok: body.ok === true, svg: (body.svg ?? charts?.[0]?.svg) as string | undefined,
      errors: body.errors ?? [], warnings: body.warnings ?? [], ms: performance.now() - start };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { ok: false, errors: [{ code: failure.code ?? 'render-error', message: failure.message ?? String(error) }],
      warnings: [], ms: performance.now() - start };
  }
}
