import './helpers/link-core';
import { describe, expect, it } from 'vitest';

import { NOT_MEANINGFUL } from '../src/core/format';
import { formatterFromExample } from '../src/core/formatSpec';
import { layoutColumn } from '../src/core/charts/column/layout';
import { layoutLine } from '../src/core/charts/line/layout';
import { layoutPie } from '../src/core/charts/pie/layout';
import { fixtures as pieFixtures } from '../src/core/charts/pie/fixtures';
import { layoutTable } from '../src/core/charts/table/layout';
import { axisGrid, linearScale, niceDomain } from '../src/core/scale';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import type { Geometry, SceneNode } from '../src/core/types/scene';

/**
 * non-finite containment. ONE rule: no non-finite value may reach a
 * formatter, a path `d`, a domain, or a label.
 *
 * The formatter half of that rule is pinned in tests/core/format.test.ts
 * ("non-finite containment across BOTH formatting engines"); this file pins the
 * other three surfaces and the ratioTier that could otherwise print a wrong rate.
 */

const theme = resolveTheme();

/** A document with a denominator that is finite,
 *  schema-valid and not zero, whose quotient still overflows. */
const OVERFLOW_DATA = {
  categories: [
    { id: 'q1', label: 'Q1' },
    { id: 'q2', label: 'Q2' },
  ],
  series: [
    { id: 'output', label: 'Output', values: [1, 2] },
    { id: 'market', label: 'Market', values: [Number.MIN_VALUE, 12] },
  ],
};

const OVERFLOW_TIER = {
  id: 'rate',
  label: 'Rate',
  numeratorSeriesId: 'output',
  denominatorSeriesId: 'market',
  at: ['q1', 'q2'],
  format: '88%',
};

interface TierGeometry {
  derived: {
    ratioTier?: {
      badges: Array<{ categoryId: string; value: number | null; text: string; state: string }>;
    };
  };
  a11y: { desc: string };
  warnings: Array<{ code?: string; severity: string; message: string }>;
}

// column and line are the twin pair that both mount prepareRatioTier; bar
// deliberately omits the option (BarOptions extends Omit<ColumnOptions,
// 'ratioTier'>), so the pair is complete at two.
const TIER_HOSTS: Array<[string, (data: unknown, options: unknown) => unknown]> = [
  ['column', layoutColumn as never],
  ['line', layoutLine as never],
];

describe('a ratio that overflows fails closed on every surface at once', () => {
  it.each(TIER_HOSTS)('%s: badge, JSON, <desc> and warning all agree', (_name, layout) => {
    const geometry = layout(OVERFLOW_DATA, { ratioTier: OVERFLOW_TIER }) as TierGeometry;
    const svg = renderSvg(geometry as never, theme);
    const badges = geometry.derived.ratioTier!.badges;
    const q1 = badges.find((badge) => badge.categoryId === 'q1')!;
    const q2 = badges.find((badge) => badge.categoryId === 'q2')!;

    // The named warning — not merely "something warned".
    const warning = geometry.warnings.find((item) => item.code === 'ratio-tier-not-meaningful')!;
    expect(warning).toBeDefined();
    expect(warning.severity).toBe('warn');
    // The trace says WHY and names the category.
    expect(warning.message).toContain("'q1'");
    expect(warning.message).toContain('non-finite');

    // The badge is a non-value in every field, so the JSON cannot disagree with
    // the paint: JSON.stringify(Infinity) is null, which is how "Infinity%" and
    // `value: null` shipped side by side.
    expect(q1.value).toBeNull();
    expect(q1.state).toBe('nm');
    expect(q1.text).toBe(NOT_MEANINGFUL);
    expect(JSON.parse(JSON.stringify(q1)).value).toBeNull();

    // Painted SVG and screen-reader description carry the same glyph.
    const svgText = [...svg.matchAll(/>([^<>]+)</g)].map((match) => match[1]!);
    expect(svgText).toContain(NOT_MEANINGFUL);
    expect(geometry.a11y.desc).toContain(`Q1 ${NOT_MEANINGFUL}`);
    expect(svg).not.toMatch(/NaN|Infinity|∞/);
    expect(geometry.a11y.desc).not.toMatch(/NaN|Infinity|∞/);

    // The tier did not vanish: the neighbour still carries its real computed
    // rate, and the text a reader sees equals the value the engine computed.
    const expected = (2 / 12) * 100;
    expect(q2.state).toBe('value');
    expect(q2.value).toBeCloseTo(expected, 12);
    expect(q2.text).toBe(formatterFromExample('88%', undefined)(expected));
    expect(svgText).toContain(q2.text);
  });

  it('an exactly-zero denominator keeps its own distinct state (n/a, not n.m.)', () => {
    const geometry = layoutColumn(
      {
        ...OVERFLOW_DATA,
        series: [
          { id: 'output', label: 'Output', values: [1, 2] },
          { id: 'market', label: 'Market', values: [0, 12] },
        ],
      } as never,
      { ratioTier: OVERFLOW_TIER } as never,
    ) as unknown as TierGeometry;
    const q1 = geometry.derived.ratioTier!.badges.find((badge) => badge.categoryId === 'q1')!;
    expect(q1.state).toBe('na');
    expect(q1.text).toBe('n/a');
    expect(
      geometry.warnings.some((item) => item.code === 'ratio-tier-not-meaningful'),
    ).toBe(false);
  });

  it('ordinary ratios are untouched — no glyph, no warning', () => {
    const geometry = layoutColumn(
      {
        ...OVERFLOW_DATA,
        series: [
          { id: 'output', label: 'Output', values: [1, 2] },
          { id: 'market', label: 'Market', values: [4, 12] },
        ],
      } as never,
      { ratioTier: OVERFLOW_TIER } as never,
    ) as unknown as TierGeometry;
    const badges = geometry.derived.ratioTier!.badges;
    expect(badges.map((badge) => badge.state)).toEqual(['value', 'value']);
    expect(badges.map((badge) => badge.text)).toEqual(['25%', '17%']);
    expect(
      geometry.warnings.some((item) => item.code === 'ratio-tier-not-meaningful'),
    ).toBe(false);
  });
});

describe('a non-finite coordinate can never be written into a path d', () => {
  it('a non-finite pie explode never serializes d="MNaN NaN..."', () => {
    const geometry = layoutPie(
      {
        categories: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        series: [{ id: 's', values: [3, 1] }],
      } as never,
      { explode: { a: Number.NaN } } as never,
    );
    expect(() => renderSvg(geometry as never, theme)).toThrow(
      /invalid SVG path .*: non-finite coordinate 'NaN'/,
    );
  });

  it('refuses each non-finite spelling in an SVG path', () => {
    for (const spelling of ['NaN', 'Infinity', '-Infinity']) {
      const geometry = layoutPie(pieFixtures[0]!.data, pieFixtures[0]!.options) as unknown as Geometry;
      const path = geometry.scene.find(
        (node): node is Extract<SceneNode, { t: 'path' }> => node.t === 'path',
      );
      expect(path).toBeDefined();
      // Sanity: the untouched fixture renders. Without this, a family whose
      // renderSvg throws for an unrelated reason would look like a pass.
      expect(() => renderSvg(geometry, theme)).not.toThrow();
      path!.d = `M0 0L${spelling} 12`;
      expect(() => renderSvg(geometry, theme)).toThrow(/non-finite coordinate/);
    }
  });
});

describe('a domain is finite and its tick walk terminates', () => {
  const TARGETS = [5];
  const pairs: Array<[number, number]> = [
    [0, 0], [0, Number.MIN_VALUE], [-Number.MIN_VALUE, 0],
    [1e-6, 1e15], [-1, 1], [1e300, 1e300],
    [0, Number.MAX_VALUE], [-Number.MAX_VALUE, 0], [-Number.MAX_VALUE, Number.MAX_VALUE],
  ];

  it('niceDomain never returns a non-finite bound, and still contains its data', () => {
    for (const [min, max] of pairs) {
      for (const target of TARGETS) {
        const [lo, hi] = niceDomain(min, max, target);
        expect(Number.isFinite(lo), `niceDomain(${min}, ${max}, ${target}) lo`).toBe(true);
        expect(Number.isFinite(hi), `niceDomain(${min}, ${max}, ${target}) hi`).toBe(true);
        expect(lo, `niceDomain(${min}, ${max}, ${target}) ordering`).toBeLessThanOrEqual(hi);
        // Containment is asserted at the precision the double type actually
        // offers. niceDomain(-5e-324, 1e15) snaps the low edge to -0 because
        // -5e-324 / 1e15 underflows — that is a float limit, not a lost datum,
        // and it predates this package. One ULP of the larger magnitude is the
        // honest tolerance; a domain that truly dropped data would still fail.
        const slack = Math.max(Math.abs(min), Math.abs(max)) * Number.EPSILON;
        expect(lo, `niceDomain(${min}, ${max}, ${target}) contains min`).toBeLessThanOrEqual(
          min + slack,
        );
        expect(hi, `niceDomain(${min}, ${max}, ${target}) contains max`).toBeGreaterThanOrEqual(
          max - slack,
        );
      }
    }
  });

  it('niceDomain survives non-finite input instead of forwarding it', () => {
    for (const bad of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      for (const [lo, hi] of [
        niceDomain(0, bad, 5),
        niceDomain(bad, 0, 5),
        niceDomain(bad, bad, 5),
        niceDomain(bad, 10, 5, { dataExtent: [2, 9] }),
      ]) {
        expect(Number.isFinite(lo)).toBe(true);
        expect(Number.isFinite(hi)).toBe(true);
        expect(lo).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('replaces non-finite bounds and NOTHING else — a descending domain stays descending', () => {
    // An inverted axis is a legitimate caller intent, and niceDomain is a public
    // export. Descending finite domains must keep their supplied bounds.
    expect(niceDomain(10, 5, 5)).toEqual([10, 5]);
    expect(niceDomain(17, 3, 5)).toEqual([17, 3]);
    expect(niceDomain(40, -40, 5)).toEqual([40, -40]);
    expect(niceDomain(1, 0, 5)).toEqual([1, 0]);
    expect(niceDomain(-1, -10, 5)).toEqual([-1, -10]);
    expect(niceDomain(100, 97, 5)).toEqual([100, 97]);
    expect(niceDomain(17, 3, 5, { dataExtent: [3, 17] })).toEqual([17, 3]);
  });

  it('axisGrid leaves a span past the float range to niceDomain instead of allocating Infinity ticks', () => {
    expect([axisGrid(0, Number.MAX_VALUE), axisGrid(-Number.MAX_VALUE, Number.MAX_VALUE)]).toEqual([undefined, undefined]);
  });

  it('the named repro: niceDomain(0, MAX_VALUE) no longer overflows to Infinity', () => {
    const domain = niceDomain(0, Number.MAX_VALUE, 5);
    expect(domain[1]).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(domain[1])).toBe(true);
    const ticks = linearScale(domain, [0, 100]).ticks(5);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((tick) => Number.isFinite(tick))).toBe(true);
  });

  it('ticks() always terminates, stays finite, and stays inside its structural bound', () => {
    // The bound is a proof, not a tuned threshold: niceStep only ever rounds the
    // raw step UP the 1/2/5 ladder, so step >= span/target and at most
    // target + 1 ticks can fall inside the domain; the drift epsilon can admit
    // one more. Anything above target + 2 means the walk is not converging.
    let observedMax = 0;
    let observedMaxAt = '';
    for (const [d0, d1] of pairs) {
      for (const target of TARGETS) {
        const scale = linearScale(niceDomain(d0, d1, target), [0, 640]);
        const ticks = scale.ticks(target);
        expect(ticks.every((tick) => Number.isFinite(tick)), `${d0}..${d1} @${target}`).toBe(true);
        expect(ticks.length, `${d0}..${d1} @${target}`).toBeLessThanOrEqual(target + 2);
        if (ticks.length / (target + 2) > observedMax) {
          observedMax = ticks.length / (target + 2);
          observedMaxAt = `[${d0}, ${d1}] @${target} -> ${ticks.length} ticks`;
        }
      }
    }
    // Reported, not asserted — the margin against the bound on this population.
    expect(observedMaxAt.length).toBeGreaterThan(0);
  });

  it('a domain whose span is not representable yields its endpoints, not a hang', () => {
    const scale = linearScale([-Number.MAX_VALUE, Number.MAX_VALUE], [0, 100]);
    expect(Number.isFinite(scale.domain[1] - scale.domain[0])).toBe(false);
    expect(scale.ticks(5)).toEqual([-Number.MAX_VALUE, Number.MAX_VALUE]);
  });

  it('a step too small to advance the cursor breaks instead of looping forever', () => {
    // 1e300 + 1 === 1e300: the increment rounds away entirely.
    const ticks = linearScale([1e300, 1e300], [0, 100]).ticks(5);
    expect(ticks.length).toBeLessThanOrEqual(2);
    expect(ticks.every((tick) => Number.isFinite(tick))).toBe(true);
  });

  it('a non-finite tick target cannot widen the walk', () => {
    for (const target of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const ticks = linearScale([0, 1e9], [0, 100]).ticks(target);
      expect(ticks.length).toBeLessThanOrEqual(7);
      expect(ticks.every((tick) => Number.isFinite(tick))).toBe(true);
    }
  });
});

describe('the table computed column takes the same route the badge did', () => {
  // resolve.ts guards div/percentDelta/share with a bare `b === 0`, so a
  // denominator of 5e-324 still returns a non-finite quotient. What that non-finite cannot do is reach a reader: both
  // formatting engines are the boundary, so the document does not paint
  // "Infinity.%" into the SVG.
  //
  // The state residue (`state: 'value'` alongside `raw: null`) is NOT closed
  // here: closing it would change the state-glyph policy in resolve.ts.
  // This test guards exactly the half that IS closed.
  const DOC = {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Company' },
      { id: 'revenue', kind: 'value', label: 'Revenue', format: '€1.2bn' },
      { id: 'gp', kind: 'value', label: 'Gross profit', format: '€1.2bn' },
      {
        id: 'margin',
        kind: 'computed',
        label: 'GP margin',
        calc: { op: 'mul', a: { op: 'div', a: { ref: 'gp' }, b: { ref: 'revenue' } }, b: { lit: 100 } },
        format: '1.1%',
      },
      {
        id: 'vsly',
        kind: 'computed',
        label: 'vs LY',
        calc: { op: 'percentDelta', a: 'gp', b: 'revenue' },
        format: '1.1%',
      },
    ],
    rows: [
      { id: 'tiny', label: 'Tiny denominator', cells: { revenue: Number.MIN_VALUE, gp: 1.65e9 } },
      { id: 'ok', label: 'Ordinary', cells: { revenue: 3.48e9, gp: 1.05e9 } },
    ],
  };

  it('an overflowing computed column paints n.m., never "Infinity.%"', () => {
    const geometry = layoutTable(DOC as never, {
      size: { width: 620, height: 220 },
    } as never) as unknown as {
      derived: {
        table: { rows: Array<{ id: string; cells: Record<string, { displayed: string }> }> };
      };
    };
    const svg = renderSvg(geometry as never, theme);
    const rows = geometry.derived.table.rows;
    const tiny = rows.find((row) => row.id === 'tiny')!;

    expect(tiny.cells.margin!.displayed).toBe(NOT_MEANINGFUL);
    expect(tiny.cells.vsly!.displayed).toBe(NOT_MEANINGFUL);
    expect(svg).not.toMatch(/NaN|Infinity|∞/);
    const svgText = [...svg.matchAll(/>([^<>]+)</g)].map((match) => match[1]!);
    expect(svgText).toContain(NOT_MEANINGFUL);

  });
});
