import type { Margin, Rect } from '../../geometry';
import { panelTypeClass } from '../../theme';

/**
 * A grid of filled cells with nothing under it keeps the side margin below it too. The 10 px
 * bottom margin is the air under a footer line, and without one the last row of cells ran to
 * the canvas edge. An authored bottom margin stands, and a grid panel takes its grid's spacing.
 */
export function bareGridPlot(plot: Rect, height: number, margin: Margin, options: { margin?: Partial<Margin> }): Rect {
  if (options.margin?.bottom !== undefined || panelTypeClass(options) !== undefined
    || Math.abs(plot.y + plot.h - (height - margin.bottom)) > 0.5) return plot;
  const extra = Math.max(0, margin.left - margin.bottom);
  return extra === 0 ? plot : { ...plot, h: Math.max(10, plot.h - extra) };
}
