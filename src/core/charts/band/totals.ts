/**
 * Total-label candidates at a stack end. Vertical stacks read above a
 * positive end or below a negative end. Horizontal stacks keep one right-side
 * reading rail, including all-negative rows, which preserves the bar contract.
 */

import type { Rect } from '../../geometry';
import type { SlotCandidate } from '../../label/solver';
import type { BandOrientation, TextSize } from './labels';

export function totalLabelCandidates(
  orientation: BandOrientation,
  anchor: { x: number; y: number },
  textSize: TextSize,
  direction: 'positive' | 'negative' = 'positive',
): SlotCandidate[] {
  return orientation === 'vertical'
    ? verticalCandidates(anchor, textSize, direction)
    : horizontalCandidates(anchor, textSize);
}

function verticalCandidates(
  anchor: { x: number; y: number },
  size: TextSize,
  direction: 'positive' | 'negative',
): SlotCandidate[] {
  const above = direction === 'positive';
  const firstY = above ? anchor.y - size.height - 4 : anchor.y + 4;
  const shiftedY = above ? anchor.y - 2 * size.height - 8 : anchor.y + size.height + 8;
  const rect = (y: number): Rect => ({
    x: anchor.x - size.width / 2,
    y,
    w: size.width,
    h: size.height,
  });
  return [
    { slot: above ? 'aboveStack' : 'belowStack', rect: rect(firstY), penalty: 0 },
    {
      slot: above ? 'aboveStackShifted' : 'belowStackShifted',
      rect: rect(shiftedY),
      penalty: 1,
    },
  ];
}

function horizontalCandidates(
  anchor: { x: number; y: number },
  size: TextSize,
): SlotCandidate[] {
  const x = anchor.x + 6;
  return [
    {
      slot: 'outsideEnd',
      rect: { x, y: anchor.y - size.height / 2, w: size.width, h: size.height },
      penalty: 0,
    },
    {
      slot: 'outsideEndShifted',
      rect: {
        x,
        y: anchor.y - size.height / 2 - size.height - 2,
        w: size.width,
        h: size.height,
      },
      penalty: 1,
    },
  ];
}
