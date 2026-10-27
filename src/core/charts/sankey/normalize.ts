/**
 * Sankey data to a layered graph: link checks, stages, cycles, duplicate
 * links, node totals and the Other bucket. No text and no geometry.
 */

import { NormalizeError } from '../../normalize/shared';
import { parseFormatExample } from '../../formatSpec';
import type { Id } from '../../types/cell';
import type { LintWarning } from '../../types/scene';
import { findCycle, graphColumns, type FlowLink, type FlowNode } from './geometry';
import type { SankeyData, SankeyOptions } from './types';

/** A percent format with nodeValue 'share' or 'value-share' formats the shares, not the flow values. */
export const sankeyShareFormat = (options: SankeyOptions): string | undefined =>
  options.format && (options.nodeValue ?? 'value') !== 'value' && parseFormatExample(options.format).suffix.includes('%') ? options.format : undefined;

/** Nodes under this share of their column's total fold into Other by default. */
export const SANKEY_OTHER_SHARE = 0.02;

export interface GraphNode extends FlowNode {
  key: Id;
  id: Id;
  stage?: Id;
  label: string;
  in: number;
  out: number;
  colorRole?: string;
  fill?: string;
  members?: { id: Id; label: string; value: number }[];
}

export interface GraphLink extends FlowLink {
  key: Id;
}

export interface SankeyGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  columnCount: number;
  /** The stage of each column, when stages are known or `data.stages` names the columns. */
  columns: { id?: Id; label?: string }[];
  staged: boolean;
  order: 'flow' | 'data';
  /** The Other label in this chart's words. */
  otherLabel: string;
  warnings: LintWarning[];
}

/** One key part: `%`, `:` and `>` escaped, so a key never reads as two parts. */
export function keyPart(part: string): string {
  return part.replace(/%/g, '%25').replace(/:/g, '%3A').replace(/>/g, '%3E');
}

const nodeKey = (id: Id, stage?: Id): Id => (stage === undefined ? keyPart(id) : `${keyPart(stage)}:${keyPart(id)}`);
const linkKey = (source: Id, target: Id): Id => `${source}>${target}`;

export function sankeyGraph(data: SankeyData, options: SankeyOptions): SankeyGraph {
  const warnings: LintWarning[] = [];
  if (!data || !Array.isArray(data.links) || data.links.length === 0) {
    throw new NormalizeError('empty-data', 'links', 'sankey requires at least one link', 'Add links of source, target and value.');
  }
  const staged = data.links[0]!.sourceStage !== undefined || data.links[0]!.targetStage !== undefined;
  data.links.forEach((link, index) => {
    const value = link.value as unknown;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new NormalizeError('sankey-value-missing', `links[${index}].value`, `link ${link.source} → ${link.target} has no numeric value (${String(value)})`,
        'Send a number, 0 or more, or leave the row out.', undefined, ['data', 'links', index, 'value']);
    }
    if (value < 0) {
      throw new NormalizeError('sankey-value-negative', `links[${index}].value`, `link ${link.source} → ${link.target} has a negative value ${value}; a flow cannot be negative`,
        'Send the flow in the other direction as a positive value, or leave the row out.', undefined, ['data', 'links', index, 'value']);
    }
    const both = link.sourceStage !== undefined && link.targetStage !== undefined;
    const none = link.sourceStage === undefined && link.targetStage === undefined;
    if (staged ? !both : !none) {
      throw new NormalizeError('sankey-stage-mixed', `links[${index}]`, `link ${link.source} → ${link.target} ${staged ? 'misses a stage' : 'names a stage'}, while link 0 ${staged ? 'names both stages' : 'names none'}`,
        'Set sourceStage and targetStage on every link, or on none.', undefined, ['data', 'links', index]);
    }
  });
  const zero = data.links.filter((link) => link.value === 0).length;
  if (zero > 0) warnings.push({ code: 'sankey-zero-link', severity: 'info', message: `${zero} link${zero === 1 ? '' : 's'} with value 0 draw nothing` });
  const links = data.links.map((link, index) => ({ link, index })).filter(({ link }) => link.value > 0);
  if (links.length === 0) throw new NormalizeError('empty-data', 'links', 'every sankey link has value 0, so nothing flows', 'Send at least one link above 0.');

  // ---- the shared id order: data.nodes, then first seen in links ----
  const spec = new Map((data.nodes ?? []).map((node) => [node.id, node] as const));
  const idOrder = new Map<Id, number>();
  for (const node of data.nodes ?? []) idOrder.set(node.id, idOrder.size);
  for (const { link } of links) for (const id of [link.source, link.target]) if (!idOrder.has(id)) idOrder.set(id, idOrder.size);
  const named = new Set(links.flatMap(({ link }) => [link.source, link.target]));
  const unused = (data.nodes ?? []).filter((node) => !named.has(node.id)).map((node) => node.id);
  if (unused.length > 0) warnings.push({ code: 'sankey-unused-node', severity: 'info', message: `data.nodes lists ${unused.map((id) => `'${id}'`).join(', ')}, which no link names, so ${unused.length === 1 ? 'it draws' : 'they draw'} nothing` });

  // ---- stages: their order, and the column of each node ----
  let stageIds: Id[] = [];
  if (staged) {
    const seen: Id[] = [];
    for (const { link } of links) for (const stage of [link.sourceStage!, link.targetStage!]) if (!seen.includes(stage)) seen.push(stage);
    if (data.stages) {
      stageIds = data.stages.map((stage) => stage.id);
      links.forEach(({ link, index }) => {
        for (const [field, stage] of [['sourceStage', link.sourceStage!], ['targetStage', link.targetStage!]] as const) {
          if (!stageIds.includes(stage)) {
            throw new NormalizeError('sankey-unknown-stage', `links[${index}].${field}`, `link ${link.source} → ${link.target} names stage '${stage}', which data.stages does not list`,
              `Add { id: '${stage}' } to data.stages in its place, or correct the stage.`, undefined, ['data', 'links', index, field]);
          }
        }
      });
    } else {
      stageIds = stageOrder(seen, links.map(({ link }) => [link.sourceStage!, link.targetStage!] as const), warnings);
    }
    links.forEach(({ link, index }) => {
      if (stageIds.indexOf(link.targetStage!) <= stageIds.indexOf(link.sourceStage!)) {
        throw new NormalizeError('sankey-stage-backward', `links[${index}]`,
          `link ${link.source} (${link.sourceStage}) → ${link.target} (${link.targetStage}) does not run forward: its target stage ${link.targetStage === link.sourceStage ? 'is its source stage' : 'comes before its source stage'}`,
          'A flow runs from an earlier stage to a later one. Correct the stages, or the order in data.stages.', undefined, ['data', 'links', index]);
      }
    });
  }

  // ---- nodes and merged links ----
  const nodes: GraphNode[] = [];
  const nodeIndex = new Map<Id, number>();
  const nodeOf = (id: Id, stage?: Id): number => {
    const key = nodeKey(id, stage);
    const known = nodeIndex.get(key);
    if (known !== undefined) return known;
    const own = spec.get(id);
    nodeIndex.set(key, nodes.length);
    nodes.push({
      key, id, ...(stage !== undefined ? { stage } : {}), label: own?.label ?? id, column: stage !== undefined ? stageIds.indexOf(stage) : 0,
      value: 0, in: 0, out: 0, first: (stage !== undefined ? stageIds.indexOf(stage) * idOrder.size : 0) + idOrder.get(id)!,
      ...(own?.colorRole ? { colorRole: own.colorRole } : {}), ...(own?.fill ? { fill: own.fill } : {}),
    });
    return nodes.length - 1;
  };
  let merged = mergeLinks(links.map(({ link, index }) => ({
    source: nodeOf(link.source, link.sourceStage), target: nodeOf(link.target, link.targetStage), value: link.value, first: index,
  })), nodes);
  if (merged.duplicates > 0) warnings.push({ code: 'sankey-duplicate-link', severity: 'info', message: `${merged.duplicates} link${merged.duplicates === 1 ? '' : 's'} repeat an earlier source and target and add to it` });

  let columnCount = staged ? stageIds.length : 0;
  if (!staged) {
    const cycle = findCycle(nodes.length, merged.links);
    if (cycle) {
      const names = cycle.map((node) => nodes[node]!.label).join(' → ');
      throw new NormalizeError('sankey-cycle', 'links', `the links form a cycle: ${names}; a sankey draws flows that run one way`,
        "Give every link sourceStage and targetStage, so a repeat visit (the same segment next month) is a new node in a later stage.", undefined, ['data', 'links']);
    }
    const columns = graphColumns(nodes.length, merged.links);
    nodes.forEach((node, i) => { node.column = columns[i]!; });
    columnCount = Math.max(...columns) + 1;
    if (data.stages && data.stages.length !== columnCount) {
      throw new NormalizeError('sankey-stage-count', 'stages', `data.stages names ${data.stages.length} column${data.stages.length === 1 ? '' : 's'}, while the links draw ${columnCount}`,
        `Name the ${columnCount} columns left to right, or give links sourceStage and targetStage.`, undefined, ['data', 'stages']);
    }
    stageIds = data.stages?.map((stage) => stage.id) ?? [];
  }
  totals(nodes, merged.links);

  // ---- the Other bucket ----
  const otherLabel = (options.other ? options.other.label : undefined) ?? options.strings?.others ?? 'Others';
  const otherOption = options.other === undefined ? (staged ? false : {}) : options.other;
  if (otherOption !== false) {
    const share = otherOption.share ?? SANKEY_OTHER_SHARE;
    const columnTotal = new Array<number>(columnCount).fill(0);
    for (const node of nodes) columnTotal[node.column]! += node.value;
    const small = (node: GraphNode) => node.value < share * columnTotal[node.column]!;
    let fold: Set<number>;
    if (staged) {
      // One member set in every stage: an id folds where it appears, or nowhere.
      const ids = [...new Set(nodes.map((node) => node.id))].filter((id) => nodes.every((node) => node.id !== id || small(node)));
      fold = ids.length >= 2 ? new Set(nodes.flatMap((node, i) => (ids.includes(node.id) ? [i] : []))) : new Set();
    } else {
      fold = new Set();
      for (let column = 0; column < columnCount; column++) {
        const candidates = nodes.flatMap((node, i) => (node.column === column && small(node) ? [i] : []));
        if (candidates.length >= 2) candidates.forEach((i) => fold.add(i));
      }
    }
    if (fold.size > 0) {
      const kept: GraphNode[] = [];
      const remap = new Map<number, number>();
      const others = new Map<number, number>();
      nodes.forEach((node, i) => {
        if (!fold.has(i)) { remap.set(i, kept.length); kept.push(node); return; }
        let at = others.get(node.column);
        if (at === undefined) {
          at = kept.length;
          others.set(node.column, at);
          const stage = staged ? stageIds[node.column] : undefined;
          kept.push({
            key: `%other:${node.column}`, id: otherLabel, ...(stage !== undefined ? { stage } : {}), label: otherLabel, column: node.column,
            value: 0, in: 0, out: 0, first: Number.MAX_SAFE_INTEGER, other: true, members: [],
          });
        }
        kept[at]!.members!.push({ id: node.id, label: node.label, value: node.value });
        remap.set(i, at);
      });
      // An Other node is as tall as its members together, so the column keeps its total.
      merged = mergeLinks(merged.links.map((link) => ({ ...link, source: remap.get(link.source)!, target: remap.get(link.target)! })), kept);
      nodes.length = 0;
      nodes.push(...kept);
      totals(nodes, merged.links);
      for (const node of nodes) if (node.other) node.value = node.members!.reduce((sum, member) => sum + member.value, 0);
    }
  }

  const repeats = staged && new Set(nodes.map((node) => node.id)).size < nodes.length;
  return {
    nodes, links: merged.links, columnCount,
    columns: Array.from({ length: columnCount }, (_, c) => {
      const id = stageIds[c];
      const stage = data.stages?.find((entry) => entry.id === id);
      return id === undefined ? {} : { id, label: stage?.label ?? id };
    }),
    staged, order: options.order ?? (repeats ? 'data' : 'flow'), otherLabel, warnings,
  };
}

/** Links with the same ends add up; the first keeps its place. */
function mergeLinks(list: FlowLink[], nodes: readonly GraphNode[]): { links: GraphLink[]; duplicates: number } {
  const byKey = new Map<Id, GraphLink>();
  let duplicates = 0;
  for (const link of list) {
    const key = linkKey(nodes[link.source]!.key, nodes[link.target]!.key);
    const known = byKey.get(key);
    if (known) { known.value += link.value; duplicates++; continue; }
    byKey.set(key, { ...link, key });
  }
  return { links: [...byKey.values()], duplicates };
}

/** Inflow, outflow and the drawn value, max(in, out), of every node. */
function totals(nodes: GraphNode[], links: readonly GraphLink[]): void {
  for (const node of nodes) { node.in = 0; node.out = 0; }
  for (const link of links) { nodes[link.source]!.out += link.value; nodes[link.target]!.in += link.value; }
  for (const node of nodes) node.value = Math.max(node.in, node.out);
}

/**
 * Stage order from the links alone: topological, the first-seen stage first
 * among those ready. When more than one stage is ready at a step, the links
 * leave the order open; the chart warns. A cycle among stages is refused.
 */
function stageOrder(seen: readonly Id[], pairs: readonly (readonly [Id, Id])[], warnings: LintWarning[]): Id[] {
  const into = new Map(seen.map((stage) => [stage, new Set<Id>()]));
  for (const [from, to] of pairs) if (from !== to) into.get(to)!.add(from);
  const order: Id[] = [];
  let open = false;
  while (order.length < seen.length) {
    const ready = seen.filter((stage) => !order.includes(stage) && [...into.get(stage)!].every((from) => order.includes(from)));
    if (ready.length === 0) {
      const left = seen.filter((stage) => !order.includes(stage));
      throw new NormalizeError('sankey-stage-backward', 'links', `the stages ${left.map((stage) => `'${stage}'`).join(', ')} link to each other in both directions, so they have no order`,
        'Correct the stages of the links that run backward, or set the order in data.stages.', undefined, ['data', 'links']);
    }
    if (ready.length > 1) open = true;
    order.push(ready[0]!);
  }
  if (open) {
    warnings.push({
      code: 'sankey-stage-order-open', severity: 'info',
      message: `the links do not fix the order of every stage, so the stages follow their first appearance: ${order.join(', ')}`,
      suggest: 'List the stages in data.stages to set their order.',
    });
  }
  return order;
}
