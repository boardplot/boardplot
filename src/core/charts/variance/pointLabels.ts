import type { SlotCandidate } from '../../label/solver';

/**
 * A pin value sits centred over its head (under it for a negative pin), so it reads as
 * that pin's value. The one tier over a stacked column (grid.tiers) keeps the slots beside
 * the head as a fallback for a tier too short or too dense for the value over the head.
 * Two or more stacked tiers (`aboveFirst` false) keep the slots beside the head only: a
 * value over the top head would take the room the tier gives back to the column.
 */
export function relativePointCandidates(
  cx: number, y: number, baseline: number,
  size: { width: number; height: number }, negative: boolean, radius: number, beside: boolean, aboveFirst = true,
): SlotCandidate[] {
  const outY = negative ? y + radius + 4 : y - radius - 4 - size.height;
  const shiftY = negative ? outY + size.height + 4 : outY - size.height - 4;
  const candidates: SlotCandidate[] = [
    { slot: negative ? 'belowHead' : 'aboveHead',
      rect: { x: cx - size.width / 2, y: outY, w: size.width, h: size.height }, penalty: 0 },
    { slot: negative ? 'belowHeadShifted' : 'aboveHeadShifted',
      rect: { x: cx - size.width / 2, y: shiftY, w: size.width, h: size.height }, penalty: 1 },
  ];
  if (!beside) return candidates;
  const centeredY = y - size.height / 2;
  const crossesBaseline = centeredY < baseline + 4 && centeredY + size.height > baseline - 4;
  const labelY = crossesBaseline ? negative ? baseline + 4 : baseline - size.height - 4 : centeredY;
  const shiftedY = labelY + (negative ? 1 : -1) * (size.height + 4);
  for (const [dy, shifted] of [[labelY, false], [shiftedY, true]] as const) {
    for (const [side, x] of [['right', cx + radius + 6], ['left', cx - radius - 6 - size.width]] as const) {
      candidates.push({
        slot: `${side}OfHead${shifted ? 'Shifted' : ''}`,
        rect: { x, y: dy, w: size.width, h: size.height },
        penalty: (aboveFirst ? 2 : 0) + (shifted ? 2 : 0) + (side === 'left' ? 1 : 0),
        ...(dy !== centeredY ? { leaderFrom: { x: cx, y } } : {}),
      });
    }
  }
  return aboveFirst ? candidates : candidates.slice(2);
}
