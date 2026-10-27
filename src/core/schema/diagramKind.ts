import { NormalizeError } from '../normalize/shared';
import type { DiagramNode, DiagramOptions } from '../types/diagram';

/** The schema hosts and layout use the same kind check, before placing nodes. */
export function diagramKindError(nodes: DiagramNode[], options: DiagramOptions): NormalizeError | undefined {
  const allowed: DiagramNode['kind'][] | undefined = options.variant === 'customer-journey' ? ['painPoint']
    : options.variant === 'roadmap' ? ['milestone']
    : options.variant === 'linear-process' || options.variant === 'circular-process' ? ['step']
    : options.variant === 'issue-tree' ? ['issue', 'driver']
    : options.variant === 'hierarchy' ? ['entity'] : undefined;
  if (!allowed) return undefined;
  const index = nodes.findIndex(node => !allowed.includes(node.kind));
  if (index < 0) return undefined;
  const invalid = nodes[index]!;
  const callout = invalid.kind === 'callout' && options.variant === 'roadmap';
  return new NormalizeError(
    'invalid-diagram-kind', `nodes[${invalid.id}].kind`,
    `node kind '${invalid.kind}' is not read by variant '${options.variant}'; accepted kinds: ${allowed.join(', ')}${callout ? ': roadmap places milestones only, so a callout has no seat' : ''}`,
    callout ? "put the note in the milestone's caption, which roadmap draws beside the milestone"
      : `Set data.nodes[${index}].kind to ${allowed.map(kind => `'${kind}'`).join(' or ')}, or select a variant that reads '${invalid.kind}'.`,
    undefined, ['data', 'nodes', index, 'kind'],
  );
}
