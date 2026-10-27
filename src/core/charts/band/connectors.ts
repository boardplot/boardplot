/**
 * Series connectors of a stacked bar or column: matching cumulative edges
 * connect through the gap between neighbouring categories. They are emitted
 * before every segment so the marks mask their endpoints. A null omits its
 * named boundary; zero still records the collapsed cumulative edge.
 */

import { strokeBoxPad } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import type { BandScale, LinearScale } from '../../scale';
import { dashToken, strokeToken } from '../../theme';
import type { Id } from '../../types/cell';
import type { SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { edgeFlushEndpoints, fillDirection } from '../seriesConnector';
import type { StackExtents } from './stacks';

interface StackConnectorInput {
  /** The value axis: 'x' for a bar, 'y' for a column. */
  axis: 'x' | 'y';
  theme: Theme;
  cats: readonly { id: Id; breakAfter?: boolean; role?: string }[];
  dataSeries: readonly { id: Id }[];
  stacks: readonly StackExtents[];
  connectorSeries: Set<Id> | null;
  connectorDashed: boolean;
  scale: LinearScale;
  band: BandScale;
}

export function stackConnectors(input: StackConnectorInput, nodes: SceneNode[], claims: OccupiedIndex): void {
  const { axis, theme, cats, dataSeries, stacks, connectorSeries, connectorDashed, scale, band } = input;
  // The level AND which side that series' own fill lies on: the connector is
  // flush against its own silhouette, so it needs both. A positive column
  // segment's fill is below its top edge (larger y); a positive bar segment's
  // fill is left of its right edge (smaller x), so the sign flips.
  const boundaries = cats.map((_, ci) => {
    const edges = new Map<Id, { level: number; fillDir: -1 | 0 | 1 }>();
    const stack = stacks[ci]!;
    dataSeries.forEach((s, si) => {
      const segment = stack.segments[si];
      if (!segment) return;
      edges.set(s.id, { level: segment.end, fillDir: axis === 'y' ? fillDirection(segment.value) : (-fillDirection(segment.value) as -1 | 0 | 1) });
    });
    return edges;
  });
  for (let ci = 0; ci < cats.length - 1; ci++) {
    const first = cats[ci]!;
    const next = cats[ci + 1]!;
    // A connector never bridges a category break or enters a total column.
    if (first.breakAfter || next.role === 'total') continue;
    const firstEdges = boundaries[ci]!;
    const nextEdges = boundaries[ci + 1]!;
    for (const s of dataSeries) {
      if (connectorSeries && !connectorSeries.has(s.id)) continue;
      const firstEdge = firstEdges.get(s.id);
      const nextEdge = nextEdges.get(s.id);
      if (firstEdge === undefined || nextEdge === undefined) continue;
      // A series that changes sign moves to the other stack; its edges are
      // different boundaries and a line between them crosses the gap.
      if (firstEdge.fillDir * nextEdge.fillDir < 0) continue;
      // Endpoints on the band edges exactly, then EDGE-FLUSH: each end is
      // offset half an envelope toward its own segment's fill
      // (../seriesConnector.ts).
      const firstAt = band.position(ci) + band.bandwidth;
      const nextAt = band.position(ci + 1);
      const { p1, p2 } = edgeFlushEndpoints(
        strokeToken(theme, 'rule'),
        axis,
        axis === 'y' ? { x: firstAt, y: scale(firstEdge.level) } : { x: scale(firstEdge.level), y: firstAt },
        axis === 'y' ? { x: nextAt, y: scale(nextEdge.level) } : { x: scale(nextEdge.level), y: nextAt },
        firstEdge.fillDir,
        nextEdge.fillDir,
      );
      const { x: x1, y: y1 } = p1;
      const { x: x2, y: y2 } = p2;
      nodes.push({
        t: 'line',
        id: `seriesConnector:${first.id}:${next.id}:${s.id}`,
        x1,
        y1,
        x2,
        y2,
        stroke: { token: 'leader' },
        width: strokeToken(theme, 'rule'),
        ...(connectorDashed ? { dash: dashToken(theme, 'reference') } : {}),
        owner: { seriesId: s.id, categoryId: first.id },
        part: 'seriesConnector',
      });
      // The ink reaches w/2 PERPENDICULAR to the line, so each axis is padded
      // by that radius projected onto it, not by a flat w/2. The claim owner is
      // foreign to segment labels, so even the first segment's outside
      // candidates route around the gap geometry.
      const pad = strokeBoxPad(strokeToken(theme, 'rule'), x2 - x1, y2 - y1);
      claims.claim(
        {
          x: Math.min(x1, x2) - pad.x,
          y: Math.min(y1, y2) - pad.y,
          w: Math.max(Math.abs(x2 - x1) + 2 * pad.x, 1),
          h: Math.max(Math.abs(y2 - y1) + 2 * pad.y, 1),
        },
        'mark',
        { seriesId: '__seriesConnector', categoryId: first.id },
        'connector',
      );
    }
  }
}
