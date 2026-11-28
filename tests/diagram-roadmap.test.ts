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

  // Moving a pinned milestone's name to its circle used to cost crowded roadmaps a name, a date, or the whole drawing.
  it('moves the complete name and date to the circle when they fit and keeps their lane position otherwise', () => {
    const lanes = [
      { id: 'planning', label: 'Planning', orientation: 'vertical' },
      { id: 'delivery', label: 'Delivery', orientation: 'vertical' },
    ];
    const nodes = ['Pilot live', 'First ten sites', 'Platform v2 live', 'All sites live'].map((label, i) => ({
      id: `m${i}`, kind: 'milestone', shape: { kind: 'circle' }, label, secondaryLabel: `Q${i + 1} FY27`,
      laneId: i < 2 ? 'planning' : 'delivery', ...(i === 1 ? { position: { x: 0.575, y: 0.65 } } : {}),
    }));
    for (const width of [375, 1100]) {
      const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({
        type: 'diagram', data: { lanes, nodes }, options: { variant: 'roadmap', size: { width, height: 275 } },
      })));
      const names = geo.labels.filter(label => label.id.startsWith('node-label:') && !label.hidden);
      expect(names.map(name => name.lines.join(' '))).toEqual(nodes.map(node => `${node.label} ${node.secondaryLabel}`));
      const name = names.find(label => label.owner.pointId === 'm1')!;
      if (width === 375) {
        expect(name.slot).toBe('aboveInLane');
        expect(name.rect.x + name.rect.w).toBeLessThan(geo.plot.x + geo.plot.w / 2);
      } else {
        const circle = geo.scene.filter(node => node.t === 'circle').find(node => node.owner.pointId === 'm1')!;
        expect(Math.abs(name.rect.x + name.rect.w / 2 - circle.cx)).toBeLessThanOrEqual(0.5);
      }
    }
  });
});
