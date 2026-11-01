/** Sankey data and options schemas, without the chart engine. */

import * as z from 'zod';
import { addDuplicateIdIssues, baseOptionsSchema, colorRoleField, idSchema, refusedBaseOptions } from '../../schema/shared';
import type { SankeyData, SankeyOptions } from './types';
import { SANKEY_OTHER_SHARE } from './normalize';

const linkSchema = z.strictObject({
  source: idSchema.describe('Id of the node the flow leaves.'),
  target: idSchema.describe('Id of the node the flow enters.'),
  value: z.number().describe('The flow, 0 or more: the link width. A zero link draws nothing and warns sankey-zero-link; a negative value is refused. Links with the same ends (and stages) add up.'),
  sourceStage: idSchema.optional().describe("Stage of the source node. With stages, a node is the pair (stage, id): 'gold' in '2026-01' and 'gold' in '2026-02' are two nodes that share the label and colour of 'gold'. Set both stages on every link or on none."),
  targetStage: idSchema.optional().describe('Stage of the target node; it comes after sourceStage in the stage order and may skip stages.'),
});

const nodeSchema = z.strictObject({
  id: idSchema.describe('Node id that links name in source and target.'),
  label: z.string().optional().describe('Name beside the node; defaults to the id.'),
  colorRole: colorRoleField('Theme colour role of the node and the links it colours.'),
  fill: z.string().optional().describe('Authored fill of the node and the links it colours.'),
});

const stageSchema = z.strictObject({
  id: idSchema.describe('Stage id that links name in sourceStage and targetStage.'),
  label: z.string().optional().describe('Header above the stage column; defaults to the id.'),
});

export const sankeyDataSchema = z
  .strictObject({
    links: z.array(linkSchema).min(1).describe('Flows as rows of source, target and value: the shape of a GROUP BY source, target result. Columns follow from the graph: sources left, ends right. A cycle is refused unless stages separate the visits.'),
    nodes: z.array(nodeSchema).optional().describe('Labels and colours per node id, in the order the nodes take under order "data" and the order colours follow. A link may name an id this list does not hold.'),
    stages: z.array(stageSchema).optional().describe('Stage order and column headers. With stage-qualified links it sets the stage order. Without, it names the drawn columns left to right and must have one entry per column.'),
  })
  .superRefine((data, ctx) => {
    if (data.nodes) addDuplicateIdIssues(ctx, data.nodes, ['nodes'], { name: 'node', keys: 'node labels and colours' });
    if (data.stages) addDuplicateIdIssues(ctx, data.stages, ['stages'], { name: 'stage', keys: 'columns and headers' });
  }) as unknown as z.ZodType<SankeyData>;

export const sankeyOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('sankey')).safeExtend({
  linkColor: z.enum(['source', 'target']).optional().describe(
    "Which end's node colour a ribbon takes. Unset: every node and ribbon draws neutral, and a node with fill, colorRole or a highlight colours the ribbons it touches. 'source' shows where flows come from and 'target' where they go, each with one palette step per node; with a highlight, only the highlighted nodes keep a colour. Nodes that colour no link draw in the neutral mark colour.",
  ),
  order: z.enum(['flow', 'data']).optional().describe(
    "'flow' orders the nodes of each column for the fewest weighted ribbon crossings. 'data' keeps the order of data.nodes, then first seen in links. Default 'flow', and 'data' when stage-qualified ids repeat across stages, so segments keep one order every month.",
  ),
  other: z.union([
    z.literal(false),
    z.strictObject({
      share: z.number().min(0).max(0.5).optional().describe(`Fold nodes under this share of their column's total; default ${SANKEY_OTHER_SHARE}.`),
      label: z.string().optional().describe("Name of the folded node; default strings.others, else 'Others'."),
    }),
  ]).optional().describe(
    `Small nodes folded into one Other node per column, so a long tail stays readable; the note lists every folded node with its value. A column folds only when at least two nodes qualify. The Other node is as tall as its members together, so each column keeps its total. Default { share: ${SANKEY_OTHER_SHARE} } without stages; off with stage-qualified links, where an object folds an id in every stage or in none. false keeps every node.`,
  ),
  nodeValue: z.enum(['value', 'share', 'value-share']).optional().describe(
    "What a node prints in bold after its name: 'value' (default), 'share' of its column's total, or 'value-share' as \"420 (38%)\". A percent format applies to the shares.",
  ),
}) as unknown as z.ZodType<SankeyOptions>;
