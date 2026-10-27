import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateTextWidth, WIDTH_SAFETY } from '../../src/core/text';
import { FACE_TABLES, GLYPH_FALLBACK_FAMILIES } from '../../src/core/fontMetrics/tables.generated';
import { resolveFace } from '../../src/core/fontMetrics';
import { goldenCases, renderGolden } from '../golden/render';

interface Sample {
  fam: string;
  size: number;
  w: number;
  l: string;
  width: number;
}

const samples: Sample[] = readFileSync(join(__dirname, 'fixtures', 'chrome-text-widths.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Sample);

describe('table-based text measurement against Chrome', () => {
  it('borrows only arrows and the dagger, preserving bump circle positions', () => {
    const approved = new Set([0x2190, 0x2191, 0x2192, 0x2193, 0x2197, 0x2198, 0x2020]);
    for (const cp of Object.keys(GLYPH_FALLBACK_FAMILIES)) expect(approved.has(Number(cp))).toBe(true);
    for (const face of FACE_TABLES) {
      for (const cp of face.borrowed?.split(',') ?? []) expect(approved.has(parseInt(cp, 36))).toBe(true);
      for (const cp of [0x2197, 0x2198]) {
        const decoded = resolveFace(face.family, face.weight)!;
        if (decoded.borrowed?.has(cp)) expect(decoded.advance(cp)).toBe(face.weight > 500 ? 977 : 926);
      }
    }
    // Bump start names begin at the frame inset, which moves the plot and tie labels. The tie word sits
    // above and right of its ring without the symbol, and a keyed tie takes the key seat above the plot.
    for (const [id, label, x] of [
      ['brand-share-bump', 'q5:5', '358'], ['bump-torture-focus', 'm1:2', '20.11'],
    ]) {
      const entry = goldenCases().find(entry => entry.key === `line/${id}.authored`)!;
      const svg = renderGolden(entry.definition, entry.fixture, entry.variant).output;
      expect(svg).toMatch(new RegExp(`<text data-id="label:tieLabel:${label}"[^>]* x="${x}"`));
    }
  });

  it('lands within a narrow band above the browser width for every sample', () => {
    expect(samples.length).toBeGreaterThan(60);
    let sum = 0;
    for (const s of samples) {
      const estimate = estimateTextWidth(s.l, { family: s.fam, size: s.size, weight: s.w });
      const ratio = estimate / s.width;
      sum += ratio;
      // Chrome kerns; the tables do not. The safety margin covers that and
      // never lets the estimate fall under the rendered width.
      expect(ratio, `${s.fam} ${s.size}/${s.w} "${s.l}": est ${estimate.toFixed(1)} real ${s.width.toFixed(1)}`).toBeGreaterThan(0.995);
      expect(ratio, `${s.fam} ${s.size}/${s.w} "${s.l}"`).toBeLessThan(1.05);
    }
    const mean = sum / samples.length;
    expect(mean).toBeGreaterThan(1.0);
    expect(mean).toBeLessThan(WIDTH_SAFETY + 0.02);
  });
});
