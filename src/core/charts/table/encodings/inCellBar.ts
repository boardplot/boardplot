import type { Rect } from '../../../geometry';
import { semanticPalettePaint, signedFillPaint } from '../../../theme';
import type { SceneNode } from '../../../types/scene';
import type { EncodingContext } from '../../../types/table';
import { badSide } from './heat';

interface InCellBarMetrics {
  contentBox: Rect;
  maxAbs: number;
  textReserve: number;
}

const TEXT_GAP = 8;
const BAR_HEIGHT = 10;

export function emitInCellBar(context: EncodingContext, metrics: InCellBarMetrics): SceneNode[] {
  const value = context.cell.raw;
  if (
    context.cell.state !== 'value' ||
    typeof value !== 'number' ||
    value === 0 ||
    metrics.maxAbs <= 0
  ) {
    return [];
  }

  const maxWidth = Math.max(0, metrics.contentBox.w - metrics.textReserve - TEXT_GAP);
  const width = maxWidth * Math.min(1, Math.abs(value) / metrics.maxAbs);
  if (width <= 0) return [];

  const height = Math.min(BAR_HEIGHT, metrics.contentBox.h);
  // A bar is a large signed fill: badFill on the bad side of zero,
  // the focus on the other. Under lowerIsBetter a rise is the bad side.
  const fill =
    badSide(value < 0, context.cell.polarity)
      ? { ...signedFillPaint('bad'), tint: 0.55 }
      : semanticPalettePaint(context.theme, context.palette, 'focus', 0.55);
  return [
    {
      t: 'rect',
      id: context.nodeId('bar'),
      rect: {
        x: metrics.contentBox.x,
        y: metrics.contentBox.y + (metrics.contentBox.h - height) / 2,
        w: width,
        h: height,
      },
      fill,
      owner: context.owner,
      part: 'tableBar',
    },
  ];
}
