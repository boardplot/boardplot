import type { BarMarks } from '../charts/bar/layout';
import type { ButterflyMarks } from '../charts/butterfly/layout';
import type { ColumnMarks } from '../charts/column/layout';
import type { ComboMarks } from '../charts/combo/layout';
import type { DotMarks } from '../charts/dot/layout';
import type { HeatmapMarks } from '../charts/heatmap/layout';
import type { LineDerived, LineMarks } from '../charts/line/layout';
import { sharedEndLabelId } from '../charts/line/nearZero';
import type { SlopeMarks } from '../charts/slope/layout';
import type { ChartData } from '../types/data';
import type { RangeMark } from '../rangeRules';
import type { InteractionRecord } from './types';
import type { RecordContext } from './recordsShared';

export interface CellMark {
  categoryId: string;
  seriesId: string;
  nodeIds: string[];
  anchor?: InteractionRecord['anchor'];
}

/**
 * A value key belongs to its series' last point. The end labels of line series
 * that end on the same printed value are joined
 * into one label, which carries the first member's owner. The label belongs to
 * every member, so each member's end record lists it: hovering the label then
 * addresses all of them, never the first series alone.
 */
function withLineEndLabels(ctx: RecordContext, cells: CellMark[]): CellMark[] {
  // A fallback key carries the last value instead of its point label. Keep that value's hover target.
  const endKeys = ctx.geometry.legend?.items.flatMap(item => {
    const label = ctx.geometry.scene.find(node => node.id === item.labelId);
    return label?.owner.seriesId === undefined ? [] : [{ seriesId: label.owner.seriesId, nodeIds: [item.labelId, item.swatchNodeId] }];
  }) ?? [];
  if (endKeys.length > 0) {
    const ends = new Map<string, CellMark>();
    for (const cell of cells) ends.set(cell.seriesId, cell);
    for (const key of endKeys) {
      const end = ends.get(key.seriesId);
      if (end) end.nodeIds.push(...key.nodeIds);
    }
  }
  const tail = (ctx.geometry.derived as unknown as LineDerived).nearZeroTail;
  if (tail?.mode !== 'shared') return cells;
  const seed = sharedEndLabelId(tail.seriesIds);
  const label = ctx.geometry.scene.find(node => node.t === 'text' && (node.id === seed || node.id.endsWith(`:${seed}`)));
  const categoryId = label?.owner.categoryId;
  if (!label || categoryId === undefined) return cells;
  const members = new Set(tail.seriesIds.map(String));
  return cells.map(cell => cell.categoryId === categoryId && members.has(cell.seriesId)
    ? { ...cell, nodeIds: [...cell.nodeIds, label.id] } : cell);
}

/** Only geometry is read here. Values always come from the normalized data. */
function cellMarks(ctx: RecordContext): CellMark[] | undefined {
  const marks = ctx.geometry.marks;
  switch (ctx.request.type) {
    case 'column': {
      const { bars, referenceTicks, ribbons = [] } = marks as unknown as ColumnMarks;
      // A ribbon (fill and separator) belongs to its series' segment at both ends.
      const ribbonIds = (categoryId: string, seriesId: string) => ribbons
        .filter(ribbon => ribbon.seriesId === seriesId && (ribbon.from === categoryId || ribbon.to === categoryId))
        .flatMap(ribbon => [ribbon.nodeId, `${ribbon.nodeId}:edge`]);
      return [...bars.flatMap(bar => bar.segments
        ? bar.segments.map(segment => ({ categoryId: bar.categoryId, seriesId: segment.seriesId, nodeIds: [segment.nodeId, ...ribbonIds(bar.categoryId, segment.seriesId)], anchor: segment.rect }))
        : [{ categoryId: bar.categoryId, seriesId: bar.seriesId!, nodeIds: bar.nodeId ? [bar.nodeId] : [], anchor: bar.rect }]),
      ...referenceTicks.map(mark => ({ ...mark, nodeIds: [mark.nodeId], anchor: mark.rect }))];
    }
    case 'bar': {
      const { rows, referenceTicks, ranges } = marks as unknown as BarMarks;
      const cells: CellMark[] = rows.flatMap(row => row.bars.map(bar => ({ categoryId: row.id, seriesId: bar.seriesId, nodeIds: [bar.nodeId], anchor: bar.rect })));
      for (const tick of referenceTicks) cells.push({ ...tick, nodeIds: [tick.nodeId] });
      for (const range of ranges ?? []) if (!cells.some(cell => cell.categoryId === range.categoryId && cell.seriesId === range.seriesId)) {
        cells.push({ categoryId: range.categoryId, seriesId: range.seriesId, nodeIds: range.nodeIds, anchor: rows.find(row => row.id === range.categoryId)?.rect });
      }
      return cells;
    }
    case 'line': return withLineEndLabels(ctx, (marks as unknown as LineMarks).series.flatMap(series => series.points.map(point => ({
      categoryId: point.categoryId, seriesId: series.seriesId, nodeIds: point.nodeId ? [point.nodeId] : [], anchor: { x: point.x, y: point.y },
    }))));
    case 'combo': {
      const { columns, lines } = marks as unknown as ComboMarks;
      return [...columns.flatMap(column => column.segments.map(segment => ({ categoryId: column.categoryId, seriesId: segment.seriesId, nodeIds: [segment.nodeId], anchor: segment.rect }))),
        ...lines.flatMap(line => line.points.map(point => ({ categoryId: point.categoryId, seriesId: line.seriesId, nodeIds: point.markerNodeId ? [point.markerNodeId] : [], anchor: { x: point.x, y: point.y } })))];
    }
    case 'heatmap': return (marks as unknown as HeatmapMarks).cells.map(cell => ({ ...cell, nodeIds: [cell.nodeId], anchor: cell.rect }));
    case 'dot': return (marks as unknown as DotMarks).rows.flatMap(row => row.dots.map(dot => ({ categoryId: row.categoryId, seriesId: dot.seriesId, nodeIds: [dot.nodeId], anchor: { x: dot.cx, y: dot.cy } })));
    case 'slope': {
      const categories = (ctx.request.data as ChartData).categories;
      const id = (index: number) => typeof categories[index] === 'string' ? categories[index] as unknown as string : categories[index]!.id;
      return (marks as unknown as SlopeMarks).series.flatMap(series => [
        { seriesId: series.seriesId, categoryId: id(0), nodeIds: [series.lineNodeId], anchor: series.from },
        { seriesId: series.seriesId, categoryId: id(categories.length - 1), nodeIds: [series.lineNodeId], anchor: series.to },
      ]);
    }
    case 'butterfly': {
      const series = (ctx.request.data as ChartData).series.filter(item => item.role !== 'reference');
      const { left, right } = marks as unknown as ButterflyMarks;
      return [left, right].flatMap((side, index) => side.map(mark => ({ categoryId: mark.id, seriesId: series[index]!.id, nodeIds: [mark.nodeId], anchor: mark.rect })));
    }
    default: return undefined;
  }
}

export function categoryMarks(ctx: RecordContext): CellMark[] | undefined {
  const cells = cellMarks(ctx);
  if (!cells || !['bar', 'column', 'dot'].includes(ctx.request.type)) return cells;
  const byCell = new Map(cells.map(cell => [JSON.stringify([cell.seriesId, cell.categoryId]), cell]));
  const ranges = (ctx.geometry.marks as { ranges?: RangeMark[] }).ranges ?? [];
  for (const range of ranges) {
    const cell = byCell.get(JSON.stringify([range.seriesId, range.categoryId]));
    if (cell) cell.nodeIds = [...new Set([...cell.nodeIds, ...range.nodeIds])];
    else cells.push({ seriesId: range.seriesId, categoryId: range.categoryId, nodeIds: range.nodeIds });
  }
  return cells;
}
