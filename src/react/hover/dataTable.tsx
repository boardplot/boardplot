import { useMemo, type ReactElement } from 'react';
import { accessibleDataTable, type A11yTablePlacement } from '../../core/a11y/accessibility';
import { interactionRecords } from '../../core/a11y/records';
import { withChartFormats } from '../../core/formatSpec';
import type { ResolvedChartRequest } from '../../core/request';
import { AccessibleTable } from '../AccessibleTable';
import { isFullGeometry, type PreparedChart, type RenderGeometry } from '../prepared';

export { preparedTableRecords as tableRecords } from '../../core/a11y/structuralRecords';
export { a11ySurfaceStyle as surfaceStyle } from '../a11ySurface';

/** The requested data table does not wait for hover cards or their layout. */
export function DataTable({ request, geometry, prepared, mode }: {
  request: ResolvedChartRequest; geometry: RenderGeometry; prepared?: PreparedChart; mode: A11yTablePlacement;
}): ReactElement | null {
  // The table formats values after layout: it follows the chart's smallValues mode and unit-only formats.
  const table = useMemo(() => withChartFormats(request.options, () => {
    const records = isFullGeometry(geometry)
      ? interactionRecords({ request, geometry, scope: request.scope, claims: [] }) : prepared?.records ?? [];
    return accessibleDataTable(records, { title: geometry.a11y.title, locale: request.locale?.language });
  }), [request, geometry, prepared]);
  return <AccessibleTable table={table} mode={mode} />;
}
