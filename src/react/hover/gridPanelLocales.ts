import type { GridMarks } from '../../core/grid/layoutGrid';
import { withNumberMarks } from '../../core/numberMarks';
import type { RequestOptions, ResolvedChartRequest } from '../../core/request';
import type { Geometry } from '../../core/types/scene';

/** The drawn panel locales that differ from the grid's locale, by full panel path. */
export function gridPanelLocales(geometry: Geometry, request: ResolvedChartRequest): [string, string][] | undefined {
  if (geometry.type !== 'grid') return undefined;
  const locales: [string, string][] = [];
  const visit = (grid: Geometry, parent?: string): void => {
    if (grid.type !== 'grid') return;
    for (const { id, chart } of (grid.marks as unknown as GridMarks).panels) {
      if (!chart) continue;
      const path = parent ? `${parent}/${id}` : id;
      const { locale } = withNumberMarks(chart.options as Pick<RequestOptions, 'locale' | 'smallValues'>);
      if (locale?.language !== undefined && locale.language !== request.locale?.language) locales.push([path, locale.language]);
      visit(chart.geometry, path);
    }
  };
  visit(geometry, request.scope.panel);
  return locales.length ? locales : undefined;
}
