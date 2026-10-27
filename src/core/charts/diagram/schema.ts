import * as z from 'zod';
import { isIconName, listIcons, type IconName } from '../../icons';
import {
  addCanvasBoundsIssues,
  addDuplicateIdIssues,
  baseOptionsSchema,
  refusedBaseOptions,
} from '../../schema/shared';
import type {
  DiagramData,
  DiagramOptions,
  DiagramVisualRole,
} from '../../types/diagram';

const codePoints = (value: string) => [...value].length;
const boundedIdSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    if (codePoints(value) > 80) ctx.addIssue({ code: 'custom', message: 'id must be at most 80 Unicode code points' });
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'id must not contain control characters' });
    }
    if (value.startsWith('auto:')) {
      ctx.addIssue({ code: 'custom', message: "authored ids must not use the reserved 'auto:' prefix" });
    }
  }).describe('Trimmed identifier of at most 80 Unicode code points; control characters and the auto: prefix are reserved.');

const textSchema = (maximum: number, optional = false) => {
  const schema = z.string().trim().superRefine((value, ctx) => {
    if (codePoints(value) > maximum) {
      ctx.addIssue({ code: 'custom', message: `text must be at most ${maximum} Unicode code points` });
    }
  });
  return (optional ? schema.optional() : schema.min(1)).describe(`Authored text of at most ${maximum} Unicode code points.`);
};

const roleSchema = z.enum([
  'primary',
  'accent',
  'secondary',
  'muted',
  'good',
  'bad',
  'warn',
  'category',
]).describe('Theme-based visual emphasis or semantic judgment; category requires a paletteKey.');

const roleFields = {
  role: roleSchema.optional().describe('Visual emphasis or semantic tone for this element.'),
  paletteKey: boundedIdSchema.optional().describe('Stable categorical color key; required only when role is category.'),
};

const iconNameSchema = z.string().superRefine((value, ctx) => {
  if (!isIconName(value)) {
    ctx.addIssue({ code: 'custom', message: `unknown icon '${value}' — valid: ${listIcons().join(', ')}` });
  }
}).describe('Name from the built-in icon catalogue.') as z.ZodType<IconName>;

const pointSchema = z.strictObject({
  x: z.number().finite().min(0).max(1).describe('Horizontal position as a fraction of the diagram plot width.'),
  y: z.number().finite().min(0).max(1).describe('Vertical position as a fraction of the diagram plot height.'),
}).describe('Point in normalized diagram plot coordinates.');

const nodeSizeSchema = z.strictObject({
  width: z.number().finite().positive().describe('Node width in layout pixels.'),
  height: z.number().finite().positive().describe('Node height in layout pixels.'),
}).describe('Requested width and height of a node.');

const shapeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rectangle').describe('Select the rectangle node shape.') }).describe('Rectangular node outline.'),
  z.strictObject({ kind: z.literal('roundedRect').describe('Select the roundedRect node shape.'), radius: z.number().finite().nonnegative().optional().describe('Corner radius in layout pixels; omission uses the theme-scaled radius.') }).describe('Rectangle with rounded corners.'),
  z.strictObject({ kind: z.literal('circle').describe('Select the circle node shape.') }).describe('Circular node outline.'),
  z.strictObject({ kind: z.literal('pill').describe('Select the pill node shape.') }).describe('Pill-shaped node outline.'),
  z.strictObject({ kind: z.literal('chevron').describe('Select the chevron node shape.'), tip: z.number().finite().min(0.05).max(0.45).optional().describe('Chevron tip depth as a fraction of width; defaults to 0.16 and is capped by shape height.') }).describe('Directional chevron node outline.'),
  z.strictObject({ kind: z.literal('text').describe('Select the text node shape.') }).describe('Node rendered as text without an enclosing outline.'),
  z.strictObject({ kind: z.literal('icon').describe('Select the icon node shape.'), name: iconNameSchema }).describe('Node rendered as a built-in icon.'),
  z.strictObject({
    kind: z.literal('roof').describe('Select the roof node shape.'),
    apex: z.number().finite().min(0.3).max(0.7).optional().describe('Horizontal roof apex as a fraction of width; defaults to 0.5.'),
    eaveInset: z.number().finite().min(0).max(0.15).optional().describe('Inset of each roof eave as a fraction of width; defaults to 0.'),
  }).describe('Roof-shaped node outline.'),
]).describe('Closed set of diagram node shapes.');

const portLocationSchema = z.union([
  z.strictObject({
    side: z.enum(['top', 'right', 'bottom', 'left']).describe('Side of the node bounding rectangle used by this port.'),
    offset: z.number().finite().min(0).max(1).optional().describe('Fraction along the side from left to right or top to bottom; defaults to 0.5.'),
  }).describe('Connection point on a named side.'),
  z.strictObject({ perimeter: z.number().finite().min(0).max(1).describe('Fraction along the node bounding perimeter; 1 wraps to 0.') }).describe('Connection point selected by a perimeter fraction.'),
]).describe('A named side and offset, or a normalized perimeter position.');

const portSchema = z.strictObject({
  id: boundedIdSchema,
  at: portLocationSchema.describe('Authored connection location on the node boundary.'),
  intent: z.enum(['in', 'out', 'bidi']).optional().describe('Allowed edge direction: incoming, outgoing or both.'),
  capacity: z.number().int().min(1).max(32).optional().describe('Maximum number of edge endpoints assigned to this port.'),
}).describe('One named connection port on a node.');

const badgeSchema = z.strictObject({
  text: textSchema(200).describe('Badge text, at most 200 Unicode code points.'),
  ...roleFields,
}).describe('Node-border badge: codes use a circle; longer text uses a pill with reserved space.');

const nodeSchema = z
  .strictObject({
    id: boundedIdSchema,
    kind: z.enum([
      'entity',
      'issue',
      'driver',
      'step',
      'painPoint',
      'vision',
      'objective',
      'initiative',
      'enabler',
      'foundation',
      'milestone',
      'callout',
    ]).describe('Semantic node kind used by the selected variant.'),
    shape: shapeSchema.describe('Node outline or icon-only shape.'),
    label: textSchema(200).describe('Primary visible node label, at most 200 Unicode code points.'),
    secondaryLabel: textSchema(400, true).describe('Secondary line inside the node, at most 400 Unicode code points.'),
    caption: textSchema(400, true).describe('Supporting caption placed near the node, at most 400 Unicode code points.'),
    icon: iconNameSchema.optional().describe('Optional built-in icon displayed with the node label.'),
    badge: badgeSchema.optional().describe('Border badge; long text uses a pill clear of the node label.'),
    ...roleFields,
    minSize: nodeSizeSchema.optional().describe('Minimum node dimensions, also bounded below by measured content.'),
    size: nodeSizeSchema.optional().describe('Requested node dimensions; measured content and minSize remain lower bounds.'),
    position: pointSchema.optional().describe('Authored node position in normalized plot coordinates.'),
    ports: z.array(portSchema).max(16).optional().describe('Up to 16 named connection ports, unique within this node.'),
    groupId: boundedIdSchema.optional().describe('Id of an existing group containing this node.'),
    laneId: boundedIdSchema.optional().describe('Id of an existing lane containing this node.'),
    order: z.number().int().safe().optional().describe('Ordering key: nodes sort by order, a node without one by its 0-based position in nodes, ties by id. Automatic step numbers follow this order.'),
  })
  .superRefine((node, ctx) => {
    addDuplicateIdIssues(ctx, node.ports ?? [], ['ports'], {
      name: `port on node '${node.id}'`,
      keys: 'edge endpoints and port capacity',
    });
    validateRole(node.role, node.paletteKey, ctx, []);
    if (node.badge) validateRole(node.badge.role, node.badge.paletteKey, ctx, ['badge']);
    if (node.shape.kind === 'roof') {
      const apex = node.shape.apex ?? 0.5;
      const inset = node.shape.eaveInset ?? 0;
      if (apex - inset < 0.15 || 1 - inset - apex < 0.15) {
        ctx.addIssue({ code: 'custom', path: ['shape'], message: 'roof apex must remain at least 15% of width inside each eave' });
      }
    }
  }).describe('One node with its labels, appearance and optional connection ports.');

const endpointSchema = z.strictObject({
  nodeId: boundedIdSchema.describe('Id of the existing node at this edge endpoint.'),
  portId: boundedIdSchema.optional().describe('Named port on the endpoint node; omission allows automatic port selection.'),
}).describe('Node and optional named port at an edge endpoint.');

const edgeSchema = z
  .strictObject({
    id: boundedIdSchema,
    source: endpointSchema.describe('Edge origin, with an optional named output port.'),
    target: endpointSchema.describe('Edge destination, with an optional named input port.'),
    routing: z.enum(['straight', 'elbow', 'orthogonal', 'curved']).optional().describe('Requested edge path style. curved draws only in circular-process; other variants draw it orthogonal with diagram-route-degraded.'),
    arrowStart: z.boolean().optional().describe('Whether to draw an arrowhead at the source endpoint.'),
    arrowEnd: z.boolean().optional().describe('Whether to draw an arrowhead at the target endpoint.'),
    dash: z.enum(['solid', 'dashed', 'dotted']).optional().describe('Edge stroke pattern.'),
    weight: z.enum(['hairline', 'normal', 'strong']).optional().describe('Theme-scaled edge stroke weight.'),
    ...roleFields,
    label: textSchema(200, true).describe('Optional visible label, at most 200 Unicode code points.'),
    waypoints: z.array(pointSchema).max(12).optional().describe('Up to 12 authored route waypoints in normalized plot coordinates.'),
  })
  .superRefine((edge, ctx) => validateRole(edge.role, edge.paletteKey, ctx, [])).describe('One directed connection with optional routing and styling.');

const groupSchema = z
  .strictObject({
    id: boundedIdSchema,
    title: textSchema(200).describe('Visible group title, at most 200 Unicode code points.'),
    padding: z.number().finite().nonnegative().optional().describe('Space in layout pixels around the group members.'),
    order: z.number().int().safe().optional().describe('Authored ordering key used by the selected diagram variant.'),
    ...roleFields,
  })
  .superRefine((group, ctx) => validateRole(group.role, group.paletteKey, ctx, [])).describe('Named visual grouping of member nodes.');

const laneSchema = z
  .strictObject({
    id: boundedIdSchema,
    label: textSchema(200, true).describe('Optional visible label, at most 200 Unicode code points.'),
    orientation: z.enum(['horizontal', 'vertical']).describe('Lane direction in the diagram. customer-journey and roadmap, the variants that read lanes, refuse horizontal.'),
    order: z.number().int().safe().optional().describe('Authored ordering key used by the selected diagram variant.'),
    ...roleFields,
  })
  .superRefine((lane, ctx) => validateRole(lane.role, lane.paletteKey, ctx, [])).describe('Named horizontal or vertical diagram lane.');

function validateRole(
  role: DiagramVisualRole | undefined,
  paletteKey: string | undefined,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (role === 'category' && !paletteKey) {
    ctx.addIssue({ code: 'custom', path: [...path, 'paletteKey'], message: "role 'category' requires paletteKey" });
  }
  if (role !== 'category' && paletteKey !== undefined) {
    ctx.addIssue({ code: 'custom', path: [...path, 'paletteKey'], message: "paletteKey is only valid with role 'category'" });
  }
}

const keyEntrySchema = z.union([
  z.strictObject({
    role: roleSchema.describe('The node role whose fill this entry names.'),
    paletteKey: roleFields.paletteKey,
    label: textSchema(80).describe('What the fill means, at most 80 Unicode code points.'),
  })
    .superRefine((entry, ctx) => validateRole(entry.role, entry.paletteKey, ctx, []))
    .describe('One key entry naming what a node fill means.'),
  z.strictObject({
    line: z.enum(['solid', 'dashed', 'dotted']).describe("The edge style this entry names, drawn as the edges draw it."),
    label: textSchema(80).describe('What the line style means, at most 80 Unicode code points.'),
  }).describe('One key entry naming what an edge line style means.'),
]).describe('One key entry: what a node fill or an edge line style means.');

export const diagramDataSchema = z
  .strictObject({
    nodes: z.array(nodeSchema).min(1).max(80).describe('One to 80 uniquely identified diagram nodes.'),
    edges: z.array(edgeSchema).max(160).optional().describe('Up to 160 uniquely identified links between distinct existing nodes.'),
    groups: z.array(groupSchema).max(32).optional().describe('Up to 32 named visual groups referenced by node.groupId.'),
    lanes: z.array(laneSchema).max(32).optional().describe('Up to 32 named partitions referenced by node.laneId.'),
    key: z.array(keyEntrySchema).min(1).max(8).optional().describe('Up to 8 entries naming what a node fill or an edge line style means, drawn as the diagram key above the plot; a good, bad or warn node fill needs one, and so does a dashed or dotted edge.'),
  })
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.nodes, ['nodes'], {
      name: 'diagram node',
      keys: 'ports, edges, membership, scene identities and reading order',
    });
    addDuplicateIdIssues(ctx, data.edges ?? [], ['edges'], {
      name: 'diagram edge',
      keys: 'routes, labels and scene identities',
    });
    addDuplicateIdIssues(ctx, data.groups ?? [], ['groups'], {
      name: 'diagram group',
      keys: 'membership, bounds and scene identities',
    });
    addDuplicateIdIssues(ctx, data.lanes ?? [], ['lanes'], {
      name: 'diagram lane',
      keys: 'membership, partitions and scene identities',
    });
    const nodes = new Map(data.nodes.map((node) => [node.id, node]));
    const groups = new Set((data.groups ?? []).map((group) => group.id));
    const lanes = new Set((data.lanes ?? []).map((lane) => lane.id));
    data.nodes.forEach((node, index) => {
      if (node.groupId && !groups.has(node.groupId)) {
        ctx.addIssue({ code: 'custom', path: ['nodes', index, 'groupId'], message: `unknown group '${node.groupId}'` });
      }
      if (node.laneId && !lanes.has(node.laneId)) {
        ctx.addIssue({ code: 'custom', path: ['nodes', index, 'laneId'], message: `unknown lane '${node.laneId}'` });
      }
    });
    const usage = new Map<string, number>();
    (data.edges ?? []).forEach((edge, index) => {
      if (edge.source.nodeId === edge.target.nodeId) {
        ctx.addIssue({ code: 'custom', path: ['edges', index], message: 'self-loops are not supported in diagram v1' });
      }
      for (const [end, endpoint] of [['source', edge.source], ['target', edge.target]] as const) {
        const node = nodes.get(endpoint.nodeId);
        if (!node) {
          ctx.addIssue({ code: 'custom', path: ['edges', index, end, 'nodeId'], message: `unknown node '${endpoint.nodeId}'` });
          continue;
        }
        if (!endpoint.portId) continue;
        const port = node.ports?.find((candidate) => candidate.id === endpoint.portId);
        if (!port) {
          ctx.addIssue({ code: 'custom', path: ['edges', index, end, 'portId'], message: `unknown port '${endpoint.portId}' on node '${node.id}'` });
          continue;
        }
        if (end === 'source' && port.intent === 'in') {
          ctx.addIssue({ code: 'custom', path: ['edges', index, end, 'portId'], message: `port '${port.id}' is input-only` });
        }
        if (end === 'target' && port.intent === 'out') {
          ctx.addIssue({ code: 'custom', path: ['edges', index, end, 'portId'], message: `port '${port.id}' is output-only` });
        }
        const key = `${node.id}\u0000${port.id}`;
        usage.set(key, (usage.get(key) ?? 0) + 1);
        if (port.capacity !== undefined && usage.get(key)! > port.capacity) {
          ctx.addIssue({ code: 'custom', path: ['edges', index, end, 'portId'], message: `port '${port.id}' on node '${node.id}' exceeds capacity ${port.capacity}` });
        }
      }
    });
  }).describe('Diagram nodes, edges, groups and lanes with validated references.') as unknown as z.ZodType<DiagramData>;

const commonDiagramOptions = z.object({
  a11y: baseOptionsSchema.shape.a11y,
  target: baseOptionsSchema.shape.target,
  textScale: baseOptionsSchema.shape.textScale,
  textSize: baseOptionsSchema.shape.textSize,
  size: baseOptionsSchema.shape.size,
  mode: baseOptionsSchema.shape.mode,
  embed: baseOptionsSchema.shape.embed,
  margin: baseOptionsSchema.shape.margin,
  canvas: baseOptionsSchema.shape.canvas,
  title: baseOptionsSchema.shape.title,
  subtitle: baseOptionsSchema.shape.subtitle,
  source: baseOptionsSchema.shape.source,
  footnotes: baseOptionsSchema.shape.footnotes,
  notes: baseOptionsSchema.shape.notes,
  theme: baseOptionsSchema.shape.theme,
  locale: baseOptionsSchema.shape.locale,
  palette: baseOptionsSchema.shape.palette,
  transpose: baseOptionsSchema.shape.transpose,
  // Ninth common key: consumed by
  // the shared render layer's interactive context, so accepting it is
  // functional here even though diagram layout never reads it.
  interactive: baseOptionsSchema.shape.interactive,
}).superRefine(addCanvasBoundsIssues);

const diagramPresetOptions = z.discriminatedUnion('variant', [
  z.strictObject({ variant: z.literal('hierarchy').describe('Select the hierarchy diagram layout.') }),
  z.strictObject({ variant: z.literal('issue-tree').describe('Select the issue-tree diagram layout.') }),
  z.strictObject({ variant: z.literal('linear-process').describe('Select the linear-process diagram layout.') }),
  z.strictObject({
    variant: z.literal('customer-journey').describe('Select the customer-journey diagram layout.'),
    flow: z.enum(['columns', 'serpentine']).optional().describe('Customer-journey flow; accepted only with variant customer-journey.'),
  }),
  z.strictObject({ variant: z.literal('circular-process').describe('Select the circular-process diagram layout.') }),
  z.strictObject({ variant: z.literal('strategy-house').describe('Select the strategy-house diagram layout.') }),
  z.strictObject({ variant: z.literal('roadmap').describe('Select the roadmap diagram layout.') }),
]);

/**
 * The published object keeps every refused shared option visible to the
 * registry-derived capability census. The refinement delegates the
 * preset-specific surface to the strict discriminated union above, so `flow`
 * cannot become accepted-but-inert on the other six presets.
 */
export const diagramOptionsSchema = commonDiagramOptions
  .safeExtend(refusedBaseOptions('diagram'))
  .safeExtend({
    variant: z.enum([
      'hierarchy',
      'issue-tree',
      'linear-process',
      'customer-journey',
      'circular-process',
      'strategy-house',
      'roadmap',
    ]).describe('Required structural layout variant for the diagram.'),
    flow: z.enum(['columns', 'serpentine']).optional().describe('Customer-journey flow; accepted only with variant customer-journey.'),
  })
  .strict()
  .superRefine((options, ctx) => {
    const presetSpecific = diagramPresetOptions.safeParse(
      options.flow === undefined
        ? { variant: options.variant }
        : { variant: options.variant, flow: options.flow },
    );
    for (const issue of presetSpecific.success ? [] : presetSpecific.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: issue.path,
        message:
          options.variant === 'customer-journey'
            ? issue.message
            : `'flow' is only read by diagram variant 'customer-journey'`,
      });
    }
  }).describe('Shared frame metadata and one diagram layout variant.') as unknown as z.ZodType<DiagramOptions>;
