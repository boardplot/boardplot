import { expect, test } from 'vitest';
import { prepareConvexPolygon, rectHitsConvexPolygon, rectLineDistance, segmentHitsRect, type Point } from '../src/core/geometry';
import { preparePolyline } from '../src/core/polyline';

// Prevents the cached overlap test from seating a label over a map region or scatter
// hull where the direct test would refuse it, on windings and coordinates no golden draws.
test('prepared polygon tests keep direct overlap results, including touching and unusual coordinates', () => {
  const polygons: Point[][] = [[], [{ x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    Array.from({ length: 16 }, (_, i) => ({ x: 5 * Math.cos(i * Math.PI / 8), y: 5 * Math.sin(i * Math.PI / 8) })),
    [{ x: NaN, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
  ];
  let seed = 0x105;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const scale of [1, 1e-200, 1e16]) for (const points of polygons) for (const reverse of [false, true]) {
    const polygon = points.map(p => ({ x: p.x * scale, y: p.y * scale }));
    if (reverse) polygon.reverse();
    const overlaps = prepareConvexPolygon(polygon);
    for (let i = 0; i < 32; i++) {
      const rect = i === 0 ? { x: 10 * scale, y: 0, w: 1 * scale, h: 10 * scale }
        : { x: (random() * 30 - 15) * scale, y: (random() * 30 - 15) * scale, w: random() * 10 * scale, h: random() * 10 * scale };
      const pad = (i % 3 - 1) * scale;
      expect(overlaps(rect, pad)).toBe(rectHitsConvexPolygon(rect, polygon, pad));
    }
  }
});

// Prevents a pruned stroke from moving a value onto a stroke or nearer a rival at a bound or unusual coordinate.
test('prepared stroke queries keep exact distance and touching results', () => {
  const lines: Point[][] = [[], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    [{ x: -0, y: 0 }, { x: 0, y: 0 }],
    [{ x: NaN, y: 0 }, { x: 10, y: 10 }], [{ x: Infinity, y: 0 }, { x: 10, y: 10 }],
    Array.from({ length: 65 }, (_, i) => ({ x: i - 32, y: 8 * Math.sin(i) })),
    Array.from({ length: 33 }, (_, i) => ({ x: 24 * Math.sin(i * 0.4), y: i - 16 })),
  ];
  let seed = 0x105;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const scale of [1, 1e-200, 1e-70, 1e10, 1e16]) for (const points of lines) for (const reverse of [false, true]) {
    const line = points.map(p => ({ x: p.x * scale, y: p.y * scale }));
    if (reverse) line.reverse();
    const prepared = preparePolyline(line);
    for (let i = 0; i < 32; i++) {
      const rect = i === 0 ? { x: 10 * scale, y: 0, w: scale, h: 10 * scale }
        : i === 1 ? { x: NaN, y: 0, w: scale, h: scale }
        : i === 2 ? { x: 0, y: 0, w: -scale, h: scale }
        : { x: (random() * 60 - 30) * scale, y: (random() * 30 - 15) * scale, w: random() * 10 * scale, h: random() * 10 * scale };
      expect(prepared.distance(rect)).toBe(rectLineDistance(rect, line));
      const pad = (i % 3 - 1) * scale;
      expect(prepared.hits(rect, pad)).toBe(line.some((point, at) => at > 0 && segmentHitsRect(line[at - 1]!, point, rect, pad)));
    }
  }
});
