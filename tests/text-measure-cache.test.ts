import { describe, expect, it } from 'vitest';
import { buildFontTables, loadFontReader } from '../src/cli/fontTables';
import { createMetricTablesMeasurer } from '../src/core/fontMetrics/injected';
import { parseFontMetricTables } from '../src/core/fontMetrics/tableDocument';
import { createMeasurer, type FontSpec, type TextMeasurer } from '../src/core/text';
import { join } from 'node:path';

const TEXT = 'Revenue 1,111,111';

/** The base font, then one font per field: a field left out of the key reads another font's width. */
function oneFieldApart(base: FontSpec, otherFamily: string): FontSpec[] {
  return [
    base,
    { ...base, family: otherFamily },
    { ...base, size: base.size + 1 },
    { ...base, weight: 700 },
    { ...base, style: 'italic' },
    { ...base, lineHeight: 1.5 },
    { ...base, letterSpacing: 0.5 },
    { ...base, tabular: true },
  ];
}

// A key that misses a field draws wrong widths, and a shared result that a caller changes draws them for every later chart.
function checkCache(make: () => TextMeasurer, base: FontSpec, otherFamily: string) {
  const fonts = oneFieldApart(base, otherFamily);
  // A new measurer has an empty cache, so its first answer is the uncached one.
  const uncached = fonts.map((font) => make()(TEXT, font));
  const shared = make();
  for (const round of [fonts, [...fonts].reverse()]) for (const font of round) {
    expect(shared(TEXT, { ...font })).toEqual(uncached[fonts.indexOf(font)]);
  }
  const changedInPlace = { ...base };
  shared(TEXT, changedInPlace);
  changedInPlace.size = base.size + 1;
  expect(shared(TEXT, changedInPlace)).toEqual(uncached[2]);

  const hit = shared(TEXT, base);
  hit.width = -1;
  expect(shared(TEXT, base)).toEqual(uncached[0]);
}

describe('text measurement cache', () => {
  it('answers as the uncached bundled measurer', () => {
    const base = { family: 'Geist', size: 12, weight: 400 };
    checkCache(createMeasurer, base, 'Helvetica');
    // Geist's digits differ, so every field but the unread style changes this answer, and the check above can catch a missing one.
    const answers = oneFieldApart(base, 'Helvetica').filter((font) => font.style === undefined).map((font) => JSON.stringify(createMeasurer()(TEXT, font)));
    expect(new Set(answers).size).toBe(answers.length);
  });

  it('answers as the uncached table measurer, with and without the bundled fallback', async () => {
    await loadFontReader();
    const built = buildFontTables(join(process.cwd(), 'tests', 'fixtures', 'fonts')).tables;
    const family = 'Host Sans';
    const tables = parseFontMetricTables(JSON.parse(JSON.stringify({ ...built, faces: built.faces.map((face) => ({ ...face, family })) })));
    const base = { family, size: 12, weight: 400 };
    checkCache(() => createMetricTablesMeasurer(tables), base, "'Other Sans', sans-serif");
    checkCache(() => createMetricTablesMeasurer(tables, { bundledFallback: true }), base, 'Helvetica');
    // A fallback font takes the bundled measurer's cache through the same stable function.
    checkCache(() => createMetricTablesMeasurer(tables, { bundledFallback: true }), { family: 'Geist', size: 12, weight: 400 }, base.family);
  });
});
