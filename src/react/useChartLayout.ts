import { linkAnnotateEngine } from '../core/annotateEngine';
import { linkThemeShapeRules } from '../core/themeShapeRules';
import { useMemo } from 'react';
import { chartCores } from '../core/charts/cores';
import { claimsForChart, type ClaimRecordV1 } from '../core/claims/browser';
import { interactionRecords } from '../core/a11y/records';
import type { InteractionRecord } from '../core/a11y/types';
import type { ChartRequest, RequestInputOptions } from '../core/request';
import type { Geometry, LintWarning, RefusedLayout } from '../core/types/scene';
import { registeredType } from './chartEntry';
import { useResolvedChartLayout } from './useResolvedChartLayout';

// Linked by value, so this entry resolves a patched theme and lays out
// annotations synchronously (see core/deferred) in a host bundle too.
linkThemeShapeRules();
linkAnnotateEngine();

export type ChartLayoutResult = {
  geometry: Geometry;
  refused?: undefined;
  warnings: LintWarning[];
  claims: ClaimRecordV1[];
  mode: 'full' | 'compact' | undefined;
  records: InteractionRecord[];
} | {
  geometry?: undefined;
  refused: RefusedLayout;
  warnings: LintWarning[];
  claims: [];
  mode?: undefined;
  records: [];
};

export function useChartLayout<D, O extends object>(request: ChartRequest<D, O & RequestInputOptions>): ChartLayoutResult;
export function useChartLayout<D, O extends object>(type: string, data: D, options?: O & RequestInputOptions): ChartLayoutResult;
export function useChartLayout(typeOrRequest: string | ChartRequest, data?: unknown, options?: RequestInputOptions): ChartLayoutResult {
  for (const core of chartCores) registeredType(core);
  const input = typeof typeOrRequest === 'string' ? { type: typeOrRequest, data, options } : typeOrRequest;
  const { request, geometry } = useResolvedChartLayout(input);
  return useMemo(() => {
    if (geometry.refused) return { refused: geometry, warnings: geometry.warnings, claims: [], records: [] };
    const claims = claimsForChart(request.type, geometry);
    return { geometry, warnings: geometry.warnings, claims, mode: geometry.mode,
      records: interactionRecords({ request, geometry, scope: request.scope, claims }) };
  }, [request, geometry]);
}

export type { InteractionRecord, InteractionTarget, InteractionValue, InteractionScope, InteractionComparison } from '../core/a11y/types';
