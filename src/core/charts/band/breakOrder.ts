import { paintedBarLength, type BreakBar } from '../../axisBreakOrder';
import { crossesLinearBreak, type LinearScale } from '../../scale';
import type { StackExtents } from './stacks';

/** Positive and negative stack levels each start at zero; segments keep their own origin. */
export function stackBreakReversesOrder(scale: LinearScale, stacks: readonly StackExtents[]): boolean {
  if (!scale.break) return false;
  const entry = (bar: BreakBar, stackIndex: number, segment: boolean) => ({
    value: Math.abs(bar.value), length: paintedBarLength(scale, bar.start, bar.end),
    crossing: crossesLinearBreak(bar.start, bar.end, scale.break!),
    owner: stackIndex * 3 + Math.sign(bar.value) + 1, segment,
  });
  const bars = stacks.flatMap((stack, i) => [
    ...stack.segments.flatMap(s => s ? [entry(s, i, true)] : []),
    ...[stack.positive, stack.negative].filter(value => value !== 0).map(value => entry({ value, start: 0, end: value }, i, false)),
  ]).sort((a, b) => a.value - b.value);
  type Entry = typeof bars[number];
  // Two owners suffice to exclude a level's own same-sign segments.
  const add = (top: Entry[], bar: Entry) => {
    const same = top.find(s => s.owner === bar.owner);
    if (same && same.length >= bar.length) return;
    if (same) top.splice(top.indexOf(same), 1);
    top.push(bar);
    top.sort((a, b) => b.length - a.length);
    if (top.length > 2) top.pop();
  };
  const longest = (top: Entry[], bar: Entry) => top.find(s => bar.segment || s.owner !== bar.owner)?.length ?? -Infinity;
  const smaller: Entry[] = [], smallerCrossing: Entry[] = [];
  for (let first = 0; first < bars.length;) {
    let end = first + 1;
    while (end < bars.length && bars[end]!.value === bars[first]!.value) end++;
    const equal: Entry[] = [], equalCrossing: Entry[] = [];
    for (let i = first; i < end; i++) {
      const bar = bars[i]!;
      if (!bar.segment) continue;
      add(equal, bar);
      if (bar.crossing) add(equalCrossing, bar);
    }
    for (let i = first; i < end; i++) {
      const bar = bars[i]!;
      if (bar.length + 1e-6 < longest(bar.crossing ? smaller : smallerCrossing, bar) + 1
        || bar.length + 1e-6 < longest(bar.crossing ? equal : equalCrossing, bar)) return true;
    }
    for (const bar of equal) add(smaller, bar);
    for (const bar of equalCrossing) add(smallerCrossing, bar);
    first = end;
  }
  return false;
}

/**
 * The refusal of a break style other than 'straight'. The schema accepts only
 * 'straight'; untyped JS callers (React) reach layout without it.
 */
export function breakStyleRefusal(requestedBreak: object): string | undefined {
  const style = (requestedBreak as { style?: string }).style;
  return style !== undefined && style !== 'straight' ? `break style '${style}' is not supported` : undefined;
}
