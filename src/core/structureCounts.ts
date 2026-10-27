/** Structural counts, recorded by the layout that writes the description. */
export const STRUCTURE_COUNT_KINDS = [
  'categories', 'series', 'reference-series', 'causes', 'columns', 'rows',
  'points', 'groups', 'stages', 'slices', 'panels', 'nodes', 'relationships',
  'regions', 'cohorts', 'periods', 'cells', 'cases', 'bands', 'events',
  'markers', 'phases', 'observations', 'statements', 'scale-points', 'activities', 'methods', 'drivers', 'flows',
] as const;

export interface StructureCount {
  what: typeof STRUCTURE_COUNT_KINDS[number];
  n: number;
  /** Exact phrase in the accessible description. */
  text: string;
}

import { chartString } from './strings/structureCounts';
import type { BaseOptions } from './types/options';

export function structureCount(what: StructureCount['what'], n: number, text: string | undefined = undefined, options?: Pick<BaseOptions, 'locale' | 'strings'>): StructureCount {
  return { what, n, text: text ?? chartString(options, ({"categories":"countCategories","series":"countSeries","reference-series":"countReferenceSeries","causes":"countCauses","columns":"countColumns","rows":"countRows","points":"countPoints","groups":"countGroups","stages":"countStages","slices":"countSlices","panels":"countPanels","nodes":"countNodes","relationships":"countRelationships","regions":"countRegions","cohorts":"countCohorts","periods":"countPeriods","cells":"countCells","cases":"countCases","bands":"countBands","events":"countEvents","markers":"countMarkers","phases":"countPhases","observations":"countObservations","statements":"countStatements","scale-points":"countScalePoints","activities":"countActivities","methods":"countMethods","drivers":"countDrivers","flows":"countFlows"} as const)[what], { v1: n }) };
}
