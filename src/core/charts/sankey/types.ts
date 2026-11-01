/**
 * Sankey data and option types (registry type 'sankey'). They live in the
 * chart directory: nothing outside this type accepts them.
 */

import type { BaseOptionsFor } from '../../types/options';
import type { ColorRole, Id } from '../../types/cell';
import type { Rect } from '../../geometry';

export interface SankeyLink {
  /** Node id the flow leaves. */
  source: Id;
  /** Node id the flow enters. */
  target: Id;
  /** The flow, 0 or more. A zero link draws nothing. */
  value: number;
  /** Stage of the source node. Set both stages on every link or on none. */
  sourceStage?: Id;
  /** Stage of the target node, after the source's stage. */
  targetStage?: Id;
}

export interface SankeyNode {
  id: Id;
  /** Name beside the node; defaults to the id. */
  label?: string;
  colorRole?: ColorRole;
  fill?: string;
}

export interface SankeyStage {
  id: Id;
  /** Header above the stage's column; defaults to the id. */
  label?: string;
}

export interface SankeyData {
  /** Flows, one per source and target pair (rows of a GROUP BY). Duplicates add up. */
  links: SankeyLink[];
  /** Labels and colours per node id, and the shared node order; optional. */
  nodes?: SankeyNode[];
  /** Stage order and column headers; optional. */
  stages?: SankeyStage[];
}

export interface SankeyOptions extends BaseOptionsFor<'sankey'> {
  /** Which end's node colour a link takes: 'source' (default) or 'target'. */
  linkColor?: 'source' | 'target';
  /** 'flow': fewest crossings. 'data': the node order of `data.nodes`, then first seen. Default 'flow', or 'data' when stage-qualified ids repeat. */
  order?: 'flow' | 'data';
  /** Small nodes folded into one Other node per column; false keeps every node. */
  other?: false | { share?: number; label?: string };
  /** What a node prints after its name: 'value' (default), 'share' of its column, or 'value-share'. */
  nodeValue?: 'value' | 'share' | 'value-share';
  /** Flow values on the ribbons: 'large' (default) prints the value of a ribbon at least one line high at its arriving end; 'none' prints no flow value. */
  linkValue?: 'none' | 'large';
}

export interface SankeyNodeDerived {
  /** Node key: the escaped id, `stage:id` with stages, or `%other:<column>`. */
  key: Id;
  id: Id;
  stage?: Id;
  label: string;
  column: number;
  /** max(in, out): the node's drawn height. */
  value: number;
  in: number;
  out: number;
  /** Share of its column's total, in percent. */
  share: number;
  /** The nodes an Other node holds, with their values. */
  members?: { id: Id; label: string; value: number }[];
}

export interface SankeyLinkDerived {
  key: Id;
  source: Id;
  target: Id;
  value: number;
  /** Share of the source's outflow, in percent. */
  shareOfSource: number;
  /** Share of the target's inflow, in percent. */
  shareOfTarget: number;
}

export interface SankeyDerived {
  /** The first column's total. */
  total: number;
  stages: { id?: Id; label?: string; column: number; total: number }[];
  nodes: SankeyNodeDerived[];
  links: SankeyLinkDerived[];
  /** Value-weighted crossings of the drawn order. */
  crossings: number;
  /** True when options.format is a percent format that formats the shares, so flow values take no format. */
  formatsShares: boolean;
}

export interface SankeyMarks {
  /** In reading order: column by column, top down. */
  nodes: { key: Id; nodeId: Id; rect: Rect; labelNodeId?: Id }[];
  /** `at`: the ribbon's middle, where a card points. */
  links: { key: Id; nodeId: Id; at: { x: number; y: number } }[];
}
