import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type {
  DiagramData,
  DiagramDerived,
  DiagramMarks,
  DiagramOptions,
} from '../../types/diagram';
import { layoutDiagram } from './layout';
import {
  diagramDataSchema,
  diagramOptionsSchema
} from './schema';
import { diagramCore,normalizeDiagramData } from './core';

export const diagramDefinition: ChartDefinition<
  DiagramData,
  DiagramOptions,
  DiagramMarks,
  DiagramDerived
> = {
  ...diagramCore,
  discovery: {
    notFor: 'Quantities to compare; node size and edges encode no values.',
    example: {
      data: {
        nodes: [
          { id: 'draft', kind: 'step', shape: { kind: 'rectangle' }, label: 'Draft' },
          { id: 'review', kind: 'step', shape: { kind: 'rectangle' }, label: 'Review' },
        ],
        edges: [{ id: 'next', source: { nodeId: 'draft' }, target: { nodeId: 'review' }, arrowEnd: true }],
      },
      options: { variant: 'linear-process', title: 'Review follows drafting', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => diagramCore.prepare!(parseData(diagramDataSchema, raw)),
  dataSchema: diagramDataSchema,
  optionsSchema: diagramOptionsSchema,
};

export {
  diagramDataSchema,
  diagramOptionsSchema,
  layoutDiagram,
  normalizeDiagramData
};
