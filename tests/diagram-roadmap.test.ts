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
  // A pin on the edge of its own phase is not an outside pin, and a moved name never lands on an arrowhead.
  it('keeps the name of a milestone pinned at its own phase edge, and off arrowheads', () => {
    const node = (id: string, label: string, secondaryLabel: string, laneId: string, x: number, y: number) =>
      ({ id, kind: 'milestone', shape: { kind: 'circle' }, label, secondaryLabel, laneId, position: { x, y } });
    const draw = (laneIds: string[], nodes: unknown[], edges: unknown[], size: object) => requireGeometry(layoutResolvedRequest(resolveChartRequest({
      type: 'diagram', data: { lanes: laneIds.map(id => ({ id, label: id.toUpperCase(), orientation: 'vertical' })), nodes, edges }, options: { variant: 'roadmap', size },
    } as any)));
    const edge = draw(['a', 'b', 'c'], [node('m', 'Name', 'Q1 FY27', 'b', 0.6666, 0.55)], [], { width: 800, height: 300 });
    expect(edge.labels.find(label => label.id === 'node-label:m')!.slot).toBe('aboveInLane');
    const arrows = draw(['l1', 'l2'], [node('m1', 'Regional rollout', 'Target: October 2027', 'l1', 0.6, 0.65), node('m2', 'Two', 'Q1', 'l2', 0.69, 0.59)],
      [{ id: 'e1', source: { nodeId: 'm1' }, target: { nodeId: 'm2' }, arrowEnd: true }], { width: 720, height: 320 });
    const label = arrows.labels.find(l => l.id === 'node-label:m1')!;
    for (const head of arrows.scene.filter(n => n.t === 'path' && n.part === 'diagramArrow')) {
      const [x1, y1, x2, y2, x3, y3] = (head as { d: string }).d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      const hx = [x1!, x2!, x3!], hy = [y1!, y2!, y3!];
      const apart = Math.max(...hx) <= label.rect.x || Math.min(...hx) >= label.rect.x + label.rect.w || Math.max(...hy) <= label.rect.y || Math.min(...hy) >= label.rect.y + label.rect.h;
      expect(apart).toBe(true);
    }
  });
});
