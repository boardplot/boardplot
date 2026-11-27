import { describe, expect, it } from 'vitest';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { requireGeometry } from '../src/core/sizing';

describe('roadmap with a pinned milestone', () => {
  // A milestone pinned right of an unpinned milestone's lane slot made the trajectory run back, and the layout threw instead of drawing.
  it('draws the milestones in reading order', () => {
    for (const width of [375, 1100]) {
      const geo: any = requireGeometry(layoutResolvedRequest(resolveChartRequest({
        type: 'diagram',
        data: {
          lanes: [
            { id: 'l1', label: 'Phase 1', orientation: 'vertical' },
            { id: 'l2', label: 'Phase 2', orientation: 'vertical' },
          ],
          nodes: [
            { id: 'm1', kind: 'milestone', shape: { kind: 'circle' }, label: 'Start', laneId: 'l1', position: { x: 0.8, y: 0.5 } },
            { id: 'm2', kind: 'milestone', shape: { kind: 'circle' }, label: 'Next', laneId: 'l2' },
          ],
        },
        options: { variant: 'roadmap', size: { width } },
      } as any)));
      const [start, next] = geo.marks.nodes.map((node: any) => node.rect);
      expect(next.x).toBeGreaterThan(start.x);
    }
  });
});
