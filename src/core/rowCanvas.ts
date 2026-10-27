import { ASPECT_CAPS } from './aspect';
import { panelTypeClass } from './theme';

/**
 * The tallest an unpinned chart whose content grows with its width (a map, a
 * tile grid) may stand: the tallest ladder step, width / 1.33 (541 px at 720).
 * Such a chart passes it as `maxHeight` and reports it as its natural height
 * cap, then draws its content at that height; a 720 px DACH map would
 * otherwise stand about 990 px tall in a React host.
 */
export function tallestContentHeight(width: number): number {
  return Math.round(width / ASPECT_CAPS.tall);
}

/**
 * The height of a chart its host did not size (the sizing contract in
 * `sizing.ts`). A row-based exhibit (table, heatmap, gantt, status, bullet)
 * and any content-fit card take the height their content needs, from title
 * to source: the chrome around the rows plus the rows at their natural
 * pitch. No aspect or plot-share floor pads it; a one-row gantt is as flat as
 * its row. Above 1400px the rows are squeezed instead.
 *
 * Returns the height to relayout with, or undefined when the current canvas
 * already fits (within 2px) or the host sized the chart.
 */
export function rowDrivenHeight(input: {
  options: { size?: unknown };
  width: number;
  height: number;
  /** Everything above and below the rows: title block, headers, legend, footer. */
  chromeH: number;
  /** Rows at their natural pitch. */
  rowsH: number;
  /** A ceiling below 1400px, such as tallestContentHeight(width) for content that scales with the width. */
  maxHeight?: number;
  /** A canvas height the caller already gave; the 1400px squeeze cap does not go below it. */
  ceiling?: number;
}): number | undefined {
  if (input.options.size !== undefined || panelTypeClass(input.options) !== undefined) return undefined;
  // Whole pixels, rounded up so no row is squeezed; a canvas up to 2px taller is kept.
  const cap = Math.max(1400, input.ceiling ?? 0);
  const bounded = Math.min(input.maxHeight ?? cap, cap, Math.ceil(input.chromeH + input.rowsH - 1e-6));
  return bounded > input.height || input.height - bounded > 2 ? bounded : undefined;
}
