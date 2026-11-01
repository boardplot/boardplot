import { CARD_MIN_WIDTH, chartSizing } from '../../sizing';
/** Zod-free diagram chart registration. */

import type { ChartCore } from '../../registry';
import type {
  DiagramData,
  DiagramDerived,
  DiagramMarks,
  DiagramOptions,
} from '../../types/diagram';
import { layoutDiagram } from './layout';

export function normalizeDiagramData(data: DiagramData): DiagramData {
  return {
    nodes: data.nodes.map((node) => ({
      ...node,
      ports: node.ports ? [...node.ports] : undefined,
    })),
    edges: data.edges ? [...data.edges] : [],
    groups: data.groups ? [...data.groups] : [],
    lanes: data.lanes ? [...data.lanes] : [],
    ...(data.key ? { key: [...data.key] } : {}),
    ...(data.channels ? { channels: [...data.channels] } : {}),
  };
}

export const diagramCore: ChartCore<
  DiagramData,
  DiagramOptions,
  DiagramMarks,
  DiagramDerived
> = {
  type: 'diagram',
  // A hierarchy draws as a compact org chart down to a 320 px card; every
  // other layout still reports the 480 px floor itself (layout.ts).
  sizing: { ...chartSizing('diagram'), minWidth: CARD_MIN_WIDTH },
  title: 'Diagram',
  summary:
    'Deterministic node-edge diagrams with eight consulting presets, obstacle-aware routing, and structural descriptions',
  layout: layoutDiagram,
  defaults: {},
  annotationKinds: [],
  prepare: normalizeDiagramData
};
