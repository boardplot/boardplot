import { adjacentSeriesWarnings, retainAdjacentWarningRule, type AdjacentWarningCapture, type SeriesColorSample } from '../../adjacentSeries';
import { effectiveFill } from '../../theme';
import type { Theme } from '../../types/theme';
import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { AdjacentSeriesPaintSample, LintWarning, Paint, SceneNode } from '../../types/scene';
import type { NormSer } from './context';
import type { LineMarks } from './layout';

export function lineSeriesAdjacentWarnings(input: {
  marks: LineMarks;
  nodes: readonly SceneNode[];
  cats: readonly Category[];
  drawnSeries: readonly NormSer[];
  cumBot: readonly number[][];
  cumTop: readonly number[][];
  paintedAreaCats: ReadonlyMap<Id, ReadonlySet<number>>;
  isStacked: boolean;
  isArea: boolean;
  highlights: ReadonlySet<Id>;
  paintCss: (paint: Paint) => string;
  theme: Theme;
  capture?: AdjacentWarningCapture;
}): LintWarning[] {
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const categoryIndexes = new Map(input.cats.map((category, index) => [category.id, index]));
  const samples: (SeriesColorSample & AdjacentSeriesPaintSample)[] = [];
  for (const mark of input.marks.series) {
    const index = input.drawnSeries.findIndex((series) => series.id === mark.seriesId);
    if (index < 0) continue;
    // A series an unstacked area draws as a line is read by its line.
    const filled = input.isArea && mark.areaNodeId !== undefined;
    const nodeId = filled ? mark.areaNodeId : mark.pathNodeId ?? mark.fcPathNodeId ?? mark.points.find((point) => point.nodeId)?.nodeId;
    const node = nodeId ? byId.get(nodeId) : undefined;
    const paint = node && ('fill' in node && filled ? node.fill : 'stroke' in node ? node.stroke : 'fill' in node ? node.fill : undefined);
    if (!paint) continue;
    const css = input.paintCss(paint);
    const series = input.drawnSeries[index]!;
    const forecastStart = series.scenario === 'FC' ? 0 : series.vals.findIndex((value) => value.scenario === 'FC');
    const highlighted = input.highlights.has(mark.seriesId) || ('token' in paint && (paint.token === 'highlight' || paint.token === 'focus'));
    for (const point of mark.points) {
      const categoryIndex = categoryIndexes.get(point.categoryId)!;
      if (filled && !input.paintedAreaCats.get(mark.seriesId)?.has(categoryIndex)) continue;
      const hatched = filled && forecastStart >= 0 && categoryIndex >= forecastStart;
      samples.push({
        seriesId: mark.seriesId, categoryId: point.categoryId,
        // A hatch in the series' own colour is read by its stripes, as adjacentSeries.ts reads bars;
        // only an ink hatch, one stripe colour for all, differs by its wash.
        css: hatched && input.theme.pattern.hatchColor === 'ink' ? effectiveFill(css, 'hatch45', input.theme) : css,
        highlighted, paint,
        ...(hatched ? { pattern: 'hatch45' as const, byStripe: true as const } : {}),
        from: input.isStacked ? input.cumBot[index]![categoryIndex]! : point.y,
        to: input.isStacked ? input.cumTop[index]![categoryIndex]! : point.y,
      });
    }
  }
  retainAdjacentWarningRule(samples, input.isStacked, input.capture);
  return adjacentSeriesWarnings(samples, input.isStacked, input.theme);
}
