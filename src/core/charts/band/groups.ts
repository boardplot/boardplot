/**
 * Grouped mark offsets inside one category band.
 *
 * One rule wins for both orientations: the gap is 8 percent of the category
 * band, capped at 4 px. This was the column rule. It keeps the visible gap
 * stable when the series count changes, unlike padding tied to a sub-band
 * step. Bar and column now differ only in which screen axis uses the offset.
 */

interface GroupOffset {
  index: number;
  offset: number;
  size: number;
  center: number;
}

export function groupedOffsets(bandSize: number, count: number): GroupOffset[] {
  if (!Number.isFinite(bandSize) || bandSize < 0) {
    throw new RangeError('groupedOffsets bandSize must be finite and nonnegative');
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('groupedOffsets count must be a nonnegative integer');
  }
  if (count === 0) return [];
  const gap = count > 1 ? Math.min(4, bandSize * 0.08) : 0;
  const size = Math.max(1, (bandSize - gap * (count - 1)) / count);
  return Array.from({ length: count }, (_, index) => {
    const offset = index * (size + gap);
    return { index, offset, size, center: offset + size / 2 };
  });
}
