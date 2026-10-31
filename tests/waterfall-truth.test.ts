/**
 * Waterfall truth cases, kept red-capable.
 *
 * a pure-negative waterfall must not inherit an absolute `|| 1` domain
 * fallback — with it a -1e-13 delta rendered as a 0.5px sliver while +1e-13 filled
 * 90.9% of the plot, and the asymmetry reached both finite boundaries
 * (-MIN_VALUE, -MAX_VALUE). The generator sweep never rolls hi === 0 exactly,
 * so these are DIRECTED cases, not rolls (the sweep's universe was
 * mixed-sign traversals; real data includes pure-negative ones).
 *
 * duplicate item ids passed the schema, overwrote the level map, and
 * emitted duplicate scene identities. Refused at the schema now; the segment
 * surface is the in-file twin.
 */
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getChartDefinition } from '../src/core/registry';
import { unscaledFormatLint } from '../src/core/formatSpec';
import { resolveChartRequest } from '../src/index';
import { getFixtures } from '../src/fixtures';
import type { Geometry } from '../src/core/types/scene';

const def = getChartDefinition('waterfall')!;

function barRatio(value: number): number {
  const data = def.normalize({ items: [{ id: 'x', label: 'X', value }] });
  const geometry = def.layout(data as never, {} as never) as unknown as {
    plot: { h: number };
    marks: { bars: { rect: { h: number } }[] };
  };
  return geometry.marks.bars[0]!.rect.h / geometry.plot.h;
}

describe('pure-negative domain symmetry', () => {
  for (const magnitude of [1e-13, 1, 1e13]) {
    it(`|${magnitude}|: the lone negative delta occupies what its positive twin occupies`, () => {
      const positive = barRatio(magnitude);
      const negative = barRatio(-magnitude);
      expect(negative).toBeGreaterThan(0.5);
      expect(Math.abs(negative - positive)).toBeLessThanOrEqual(0.05);
    });
  }

  // The contract now ends at ±1e15 (MAGNITUDE_CEILING): values beyond it are refused at the schema with a rescale-your-
  // unit message, which prevents span overflow for every contract
  // path. The denormal
  // floor remains a layout property worth pinning.
  it(`denormal floor -${Number.MIN_VALUE}: the bar is a bar, not a sliver`, () => {
    expect(barRatio(-Number.MIN_VALUE)).toBeGreaterThan(0.4);
  });

  for (const oversized of [1e15 + 1e3, -8.9e307, Number.MAX_VALUE]) {
    it(`magnitude ${oversized} is refused at the schema, naming the rescale fix`, () => {
      const parsed = def.dataSchema.safeParse({
        items: [{ id: 'x', label: 'X', value: oversized }],
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(
        parsed.error.issues.some((entry) =>
          entry.message.includes('exceeds the supported magnitude of 1e15'),
        ),
      ).toBe(true);
    });
  }

  it('the ceiling itself stays accepted — the class boundary', () => {
    expect(
      def.dataSchema.safeParse({ items: [{ id: 'x', label: 'X', value: 1e15 }] }).success,
    ).toBe(true);
  });
});

describe('the CAGR end drop leg is never a stub', () => {
  it('a closing-heavy bridge keeps at least 16px of end leg', () => {
    const data = def.normalize({
      items: [
        { id: 'open', label: 'Open', type: 'total', value: 135, date: '2020-12-31' },
        { id: 'lift', label: 'Lift', value: 25 },
        { id: 'close', label: 'Close', type: 'total', date: '2024-12-31' },
      ],
    });
    const geometry = def.layout(data as never, {
      annotations: [{ kind: 'cagr' }],
    } as never) as unknown as {
      scene: { part?: string; owner?: { annotationId?: string }; d?: string }[];
    };
    const arm = geometry.scene.find(
      (node) => node.part === 'arm' && node.owner?.annotationId !== undefined,
    );
    expect(arm?.d).toBeDefined();
    const numbers = arm!.d!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    // d = M x0 y0 L x0 armY L x1 armY L x1 endLegY
    const armYValue = numbers[3]!;
    const endLegY = numbers[7]!;
    expect(endLegY - armYValue).toBeGreaterThanOrEqual(15.5);
  });
});

describe('duplicate ids are refused, not overwritten', () => {
  it('duplicate item ids fail the data schema, naming id and position', () => {
    const parsed = def.dataSchema.safeParse({
      items: [
        { id: 'same', label: 'First', value: 7 },
        { id: 'same', label: 'Second', value: 8 },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find((entry) =>
      entry.message.includes("duplicate waterfall item id 'same'"),
    );
    expect(issue?.path).toEqual(['items', 1, 'id']);
  });

  it('duplicate segment ids within one item fail too — the twin surface', () => {
    const parsed = def.dataSchema.safeParse({
      items: [
        {
          id: 'volume',
          label: 'Volume',
          segments: [
            { id: 'b2b', value: 3 },
            { id: 'b2b', value: 4 },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((entry) =>
        entry.message.includes("duplicate segment id 'b2b' in item 'volume'"),
      ),
    ).toBe(true);
  });

  it("colon-composed identity collision is refused — item 'a:b'+seg 'c' vs item 'a'+seg 'b:c' ", () => {
    const parsed = def.dataSchema.safeParse({
      items: [
        { id: 'a:b', label: 'One', segments: [{ id: 'c', value: 1 }] },
        { id: 'a', label: 'Two', segments: [{ id: 'b:c', value: 2 }] },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((entry) =>
        entry.message.includes("compose the same scene identity 'a:b:c'"),
      ),
    ).toBe(true);
  });

  it("a plain item occupies its ':__value' slot — segment '__value' under a twin path collides", () => {
    const parsed = def.dataSchema.safeParse({
      items: [
        { id: 'a', label: 'Plain', value: 5 },
        { id: 'a:__value', label: 'Sneaky', value: 3 },
      ],
    });
    // distinct plain items compose distinct keys — accepted…
    expect(parsed.success).toBe(true);
    const collision = def.dataSchema.safeParse({
      items: [
        { id: 'a', label: 'Plain', value: 5 },
        { id: 'x', label: 'Host', segments: [{ id: 'y', value: 1 }] },
        { id: 'x:y', label: 'Twin path', value: 2 },
      ],
    });
    // …and 'x'+seg 'y' vs plain 'x:y' (key 'x:y:__value') stay distinct too:
    // the guard refuses only genuinely identical composed identities.
    expect(collision.success).toBe(true);
  });

  it('colon ids WITHOUT collision stay accepted — the documented contract is not narrowed', () => {
    const parsed = def.dataSchema.safeParse({
      items: [
        { id: 'fy:21', label: 'FY21', type: 'total', value: 10 },
        { id: 'price:effect', label: 'Price', value: 2 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('distinct ids with duplicate values stay accepted — the class boundary', () => {
    const parsed = def.dataSchema.safeParse({
      items: [
        { id: 'a', label: 'Same', value: 7 },
        { id: 'b', label: 'Same', value: 7 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

});

describe('an opening total without a value', () => {
  it('is derived backward across plain deltas, and refused when it cannot be', () => {
    const run = (end: number | undefined) => def.layout(def.normalize({ items: [
      { id: 'start', type: 'total' }, { id: 'price', value: 20 }, { id: 'cost', value: -5 },
      { id: 'end', type: 'total', ...(end === undefined ? {} : { value: end }) },
    ] }) as never, {} as never) as unknown as { derived: { totals: Record<string, number> }; warnings: { code: string; severity: string }[] };
    expect(run(115).derived.totals.start).toBe(100);
    expect(run(undefined).warnings).toContainEqual(expect.objectContaining({ code: 'waterfall-opening-missing', severity: 'error' }));
  });
});

describe('a subtotal with toBaseline', () => {
  // The subtotal printed the running balance and ignored toBaseline, so a block subtotal (a free cash flow over several steps) showed the cash balance.
  it('prints the steps since the last baseline, skips its connector and leaves the balance to the next step', () => {
    const geometry = def.layout(def.normalize({ items: [
      { id: 'open', type: 'total', value: 100 }, { id: 'a', value: 40 }, { id: 'b', value: -10 }, { id: 'c', value: -35 },
      { id: 'fcf', type: 'subtotal', toBaseline: true }, { id: 'd', value: -20 }, { id: 'end', type: 'total', value: 75 },
    ] }) as never, {} as never) as unknown as Geometry<{ connectors: { from: string; to: string }[] }, {
      totals: Record<string, number>; levels: Record<string, { start: number; end: number }>;
      totalBasis: Record<string, { inputs: { ref: string }[] }>;
    }>;
    const { totals, levels, totalBasis } = geometry.derived;
    expect([totals.fcf, levels.fcf!.start, levels.d!.start, totals.end]).toEqual([-5, 0, 95, 75]);
    expect(totalBasis.fcf!.inputs.map((input) => input.ref)).toEqual(['a', 'b', 'c']);
    expect(geometry.marks.connectors.filter((c) => c.from === 'c' || c.to === 'fcf' || c.from === 'fcf')).toEqual([{ from: 'c', to: 'd', nodeId: 'connector:c:d' }]);
  });
});

describe('a subtotal with toBaseline beside checks, hidden breaks and segments', () => {
  type G = Geometry<{ connectors: { from: string; to: string }[] }, { totals: Record<string, number>; levels: Record<string, { start: number; end: number }> }>;
  const run = (data: object) => def.layout(def.normalize(data) as never, {} as never) as unknown as G;
  const codes = (g: G) => g.warnings.filter((w) => ['check-value-rounded', 'derived-mismatch'].includes(w.code)).map((w) => w.code);

  // A baseline subtotal's check value is its block sum, so the backward opening read it as a running balance and drew 0 and 10 for 100 and 110.
  it('solves an omitted opening past it, not from its block sum', () => {
    const g = run({ items: [{ id: 'o', type: 'total' }, { id: 'a', value: 10 }, { id: 's', type: 'subtotal', toBaseline: true, value: 10 }, { id: 'e', type: 'total', value: 110 }] });
    expect([g.derived.totals.o, g.derived.totals.s, g.derived.totals.e]).toEqual([100, 10, 110]);
  });

  // The default connector skipped a baseline subtotal that carries a hidden break, and drew a line into a step that starts a new sum at zero.
  it('draws no connector across its hidden break', () => {
    const g = run({
      items: [{ id: 'o', type: 'total', value: 100 }, { id: 'a', value: 10 }, { id: 's', type: 'subtotal', toBaseline: true }, { id: 'b', value: 5 }],
      connectors: [{ from: 's', to: 'b', hidden: true }],
    });
    expect([g.derived.levels.b!.start, g.marks.connectors.filter((c) => c.to === 'b')]).toEqual([0, []]);
  });

  // The block's steps were checked as their summed values, so segments of 0.25 and 0.75 gave a tolerance of 0.5 and a check of 1.4 passed as rounding.
  it('checks its value against the authored segments of the block', () => {
    const g = run({ items: [{ id: 'o', type: 'total', value: 0 }, { id: 'a', segments: [{ id: 'x', value: 0.25 }, { id: 'y', value: 0.75 }] }, { id: 's', type: 'subtotal', toBaseline: true, value: 1.4 }] });
    expect(codes(g)).toEqual(['derived-mismatch']);
  });
});

describe('an authored scale word', () => {
  const fixture = getFixtures('waterfall').find((candidate) => candidate.id === 'automatic-axis-break')!;
  const valueTexts = (format: string) => {
    const options = { ...fixture.options, format };
    const geometry = def.layout(def.normalize(structuredClone(fixture.data)) as never, options as never) as unknown as Geometry<object, object>;
    return geometry.labels.filter((label) => /^(sum|total):/.test(label.id)).map((label) => label.text).sort();
  };

  // Decided per label, +50 printed +0.1k and -20 left the thousands, so the labels did not add up to the total.
  it.each(['1.2k', '1,234k', '1.23k'])('holds every value of %s to one scale and one decimal count', (format) => {
    expect(valueTexts(format)).toEqual(['+0.05k', '1.00k', '1.03k', '−0.02k'].sort());
  });

  // The warning named a 0.0k the chart never drew.
  it('says what the chart prints in place of the authored decimals', () => {
    const [warning] = unscaledFormatLint({ ...fixture.options, format: '1.2k' }, fixture.data);
    expect([warning?.code, warning?.message]).toEqual(['format-hides-values', "format '1.2k' cannot show -20 near its size, so the chart prints every value with 2 decimals: -20 as −0.02k"]);
  });
});

describe('two cases in one bridge', () => {
  it('runs each case its own levels side by side in every step, keys the cases and draws no connectors', () => {
    const waterfall = getChartDefinition('waterfall')!;
    const fixture = getFixtures('waterfall').find((candidate) => candidate.id === 'two-case-budget-bridge')!;
    const geometry = waterfall.layout(waterfall.normalize(structuredClone(fixture.data)), { ...fixture.options }) as Geometry<{ bars: { id: string }[]; connectors: unknown[] }, { totals: Record<string, number> }>;
    expect([
      geometry.derived.totals['fy26:conservative'],
      geometry.derived.totals['fy26:aggressive'],
      geometry.marks.bars.length,
      geometry.marks.connectors.length,
      geometry.legend?.items.map((item) => item.id),
    ]).toEqual([127, 150, 12, 0, ['conservative', 'aggressive']]);
  });

  const caseLayout = (data: unknown, options: Record<string, unknown>) => {
    const waterfall = getChartDefinition('waterfall')!;
    return waterfall.layout(waterfall.normalize(structuredClone(data) as never), options as never) as Geometry<{ bars: { id: string; rect: { x: number; y: number; w: number; h: number } }[] }, object>;
  };
  const valueOf = (geometry: ReturnType<typeof caseLayout>, barId: string) =>
    geometry.labels.find((label) => label.id === `sum:${barId}` || label.id === `total:${barId}`)!;

  // A value at its bar's inner edge read as the neighbouring case's number: +8 stood at the right edge of its bar.
  it('centres each value on its own column', () => {
    const fixture = getFixtures('waterfall').find((candidate) => candidate.id === 'two-case-budget-bridge')!;
    const geometry = caseLayout(fixture.data, { ...fixture.options });
    const offCentre = geometry.marks.bars.filter((bar) => {
      const { rect } = valueOf(geometry, bar.id);
      return Math.abs(rect.x + rect.w / 2 - (bar.rect.x + bar.rect.w / 2)) > 0.5;
    });
    expect(offCentre.map((bar) => bar.id)).toEqual([]);
  });

  // Two equal totals closer than the series value gap read as one number, and neither may drop for it.
  it('keeps crowded equal totals apart at their bars\' inner edges', () => {
    const geometry = caseLayout({
      cases: [{ id: 'a' }, { id: 'b' }],
      items: [{ id: 'open', type: 'total', values: [12000, 12000] }, { id: 'step', values: [800, 1800] }, { id: 'mid', values: [500, 1400] }, { id: 'end', type: 'total' }],
    }, { size: { width: 400, height: 225 } });
    const [a, b] = [valueOf(geometry, 'open:a'), valueOf(geometry, 'open:b')];
    expect([a.hidden, b.hidden, b.rect.x - (a.rect.x + a.rect.w) >= 6]).toEqual([undefined, undefined, true]);
  });

  // A centred +18, wider than its bar, hung over +8's seat, and the case's whole value row thinned to every other value.
  it('keeps every value of a narrow bridge whose centred values would touch', () => {
    const fixture = getFixtures('waterfall').find((candidate) => candidate.id === 'two-case-budget-bridge')!;
    const request = resolveChartRequest({ type: 'waterfall', data: fixture.data, options: { ...fixture.options, size: { width: 320, height: 477 } } } as never);
    const geometry = caseLayout(request.data, request.options as Record<string, unknown>);
    expect(geometry.marks.bars.filter((bar) => valueOf(geometry, bar.id).hidden !== undefined).map((bar) => bar.id)).toEqual([]);
  });

  // The horizontal form looked a label's bar up by step id, so case values floated, overprinted other bars or fell to the notes.
  it('seats each value of the bars form just past the end of its own bar, in its row', () => {
    const fixture = getFixtures('waterfall').find((candidate) => candidate.id === 'two-case-budget-bars')!;
    const geometry = caseLayout(fixture.data, { ...fixture.options });
    const misplaced = geometry.marks.bars.filter((bar) => {
      const label = valueOf(geometry, bar.id);
      return label.hidden !== undefined || Math.abs(label.rect.x - (bar.rect.x + bar.rect.w + 8)) > 0.5
        || Math.abs(label.rect.y + label.rect.h / 2 - (bar.rect.y + bar.rect.h / 2)) > 0.5;
    });
    expect(misplaced.map((bar) => bar.id)).toEqual([]);
  });

  // The value ink of the bars form looked the direction up by step id too, so a fall under lowerIsBetter read as bad.
  it('reads a case step\'s direction in the bars form', () => {
    const geometry = caseLayout({
      cases: [{ id: 'a' }, { id: 'b' }],
      items: [{ id: 'open', type: 'total', values: [10, 10] }, { id: 'cost', direction: 'lowerIsBetter', values: [-2, -3] }, { id: 'end', type: 'total' }],
    }, { variant: 'horizontal', theme: { preset: 'standard', overrides: { marks: { bridge: 'sign' } } } });
    expect(valueOf(geometry, 'cost:a').ink).toEqual({ token: 'good' });
  });

  it('refuses a case bridge whose step gives the wrong number of values', () => {
    const waterfall = getChartDefinition('waterfall')!;
    const parsed = waterfall.dataSchema.safeParse({
      cases: [{ id: 'a' }, { id: 'b' }],
      items: [{ id: 'start', type: 'total', values: [10, 10] }, { id: 'step', values: [2] }, { id: 'end', type: 'total' }],
    });
    expect(parsed.success ? '' : parsed.error.issues.map((issue) => issue.message).join('; ')).toMatch(/needs 2 values, one per case/);
  });

  it("derives each case's blank opening backward from that case's closing total", () => {
    const waterfall = getChartDefinition('waterfall')!;
    const geometry = waterfall.layout(waterfall.normalize({
      cases: [{ id: 'a' }, { id: 'b' }],
      items: [{ id: 'start', type: 'total' }, { id: 'step', values: [2, 3] }, { id: 'end', type: 'total', values: [12, 16] }],
    }), {} as never) as Geometry<object, { totals: Record<string, number> }>;
    expect([geometry.derived.totals['start:a'], geometry.derived.totals['start:b']]).toEqual([10, 13]);
  });

  it("refuses a colon in a case id, which would let item 'a' in case 'b:c' and item 'a:b' in case 'c' share a bar id", () => {
    const waterfall = getChartDefinition('waterfall')!;
    expect(() => waterfall.layout(waterfall.normalize({
      cases: [{ id: 'b:c' }, { id: 'c' }],
      items: [{ id: 'a', type: 'total', values: [1, 1] }, { id: 'a:b', values: [2, 3] }],
    }), {} as never)).toThrow(expect.objectContaining({ code: 'waterfall-case-id-colon' }));
  });
});

// stacked in one column, +25 overpainted -33 and the part left showing read -8.
describe('mixed-sign segments draw in sequence', () => {
  it('each part has its own block beside the other, and the step prints its value as the net', () => {
    const fixture = getFixtures('waterfall').find((entry) => entry.id === 'mixed-sign-segments')!;
    const geometry = def.layout(def.normalize(fixture.data) as never, (fixture.options ?? {}) as never) as unknown as Geometry<{ bars: { id: string; segments: { rect: { x: number; w: number } }[] }[] }, object>;
    const [up, down] = geometry.marks.bars.find((bar) => bar.id === 'net')!.segments;
    expect([up!.rect.x + up!.rect.w <= down!.rect.x, geometry.labels.find((label) => label.id === 'sum:net')?.text]).toEqual([true, 'net −8']);
  });
});

describe('a check value off by its inputs\' rounding agrees', () => {
  // Large totals and segment checks must disclose integer gaps without treating decimal addition noise as a gap.
  it('discloses large exact gaps with a binary rounding bound for decimal sums', () => {
    const checks = (items: object[]) => (def.layout(def.normalize({ items }) as never, {} as never) as Geometry)
      .warnings.filter(warning => ['check-value-rounded', 'derived-mismatch'].includes(warning.code)).map(warning => warning.code);
    for (const magnitude of [1e12, 1e15 - 2]) {
      for (const gap of [0, 1, 2]) {
        const expected = gap === 0 ? [] : [gap === 1 ? 'check-value-rounded' : 'derived-mismatch'];
        expect(checks([{ id: 's', type: 'total', value: magnitude }, { id: 'a', value: 0 }, { id: 'e', type: 'total', value: magnitude + gap }])).toEqual(expected);
        expect(checks([{ id: 'a', value: magnitude + gap, segments: [{ id: 'x', value: magnitude }, { id: 'y', value: 0 }] }])).toEqual(expected);
      }
    }
    expect(checks([{ id: 's', type: 'total', value: 1e12 + 0.25 }, { id: 'a', value: 0 }, { id: 'e', type: 'total', value: 1e12 + 0.75 }])).toEqual(['derived-mismatch']);
    expect(checks([{ id: 'a', value: 0.1 }, { id: 'b', value: 0.2 }, { id: 'e', type: 'total', value: 0.3 }])).toEqual([]);
    // fractions added to an integer near 1e15 round away, so the float sum stays an integer that is not the exact sum.
    const fractions = [{ id: 's', type: 'total', value: 999999999999990 }, ...Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, value: 0.025 }))];
    expect(checks([...fractions, { id: 'e', type: 'total', value: 999999999999991 }])).not.toContain('derived-mismatch');
    // the bridge drew the float running sum 999999999999990; it draws the exact sum.
    expect((def.layout(def.normalize({ items: [...fractions, { id: 'e', type: 'total' }] }) as never, {} as never) as Geometry<object, { totals: Record<string, number> }>).derived.totals.e).toBe(999999999999991);
    // the segment sum added plainly, missed the exact total by 0.1 and drew the closing total as one bar.
    const segmented = def.layout(def.normalize({ items: [
      { id: 'a', segments: [{ id: 'x', value: 999999999999990 }, { id: 'y', value: 0.05 }, { id: 'z', value: 0.05 }] },
      { id: 'e', type: 'total' },
    ] }) as never, {} as never) as unknown as Geometry<{ bars: { id: string; segments: unknown[] }[] }, object>;
    expect(segmented.marks.bars.find((bar) => bar.id === 'e')!.segments).toHaveLength(3);
    // at 1.5e15 the step-order total and the segment sum differ by one float step (0.25), and the mid total drew as one bar.
    const large = def.layout(def.normalize({ items: [
      { id: 'a', segments: [{ id: 'x', value: 5e14 }, { id: 'y', value: -0.025 }, { id: 'z', value: 0.1 }] },
      { id: 'b', segments: [{ id: 'x', value: 1e15 }, { id: 'y', value: 0.075 }, { id: 'z', value: -0.025 }] },
      { id: 's', type: 'total' },
      { id: 'c', segments: [{ id: 'y', value: 0.075 }, { id: 'z', value: -0.025 }] },
      { id: 'e', type: 'total' },
    ] }) as never, {} as never) as unknown as Geometry<{ bars: { id: string; segments: unknown[] }[] }, object>;
    expect(large.marks.bars.filter((bar) => bar.id === 's' || bar.id === 'e').map((bar) => bar.segments.length)).toEqual([3, 3]);
  });

  it('allows half a unit of the finest decimal per summand, prints at that precision, and still flags a real mismatch', () => {
    const mismatches = (items: object[]) => (def.layout(def.normalize({ items }) as never, {} as never) as unknown as { warnings: { code: string; message: string }[] })
      .warnings.filter((warning) => warning.code === 'derived-mismatch').map((warning) => warning.message);
    const six = (end: number) => [{ id: 'a', value: 4.127116 }, { id: 'b', value: 6.127116 }, { id: 'end', type: 'total', value: end }];
    expect(mismatches(six(10.254231))).toEqual([]);
    const two = (end: number) => [{ id: 'open', type: 'total', value: 10 }, { id: 'a', value: 1.01 }, { id: 'b', value: 1 }, { id: 'end', type: 'total', value: end }];
    expect(mismatches(two(12))).toEqual([]);
    expect(mismatches(two(12.5))).toEqual(["total 'end': supplied 12.50 ≠ computed 12.01 — computed wins"]);
    expect(mismatches(six(10.25))).toEqual(["total 'end': supplied 10.250000 ≠ computed 10.254232 — computed wins"]);
  });

  // An authored end total inside the rounding slack vanished: 101 drew, and the authored 102 was named nowhere.
  it('discloses a check value inside the rounding slack with both numbers', () => {
    const geometry = def.layout(def.normalize({ items: [
      { id: 's', type: 'total', value: 50 }, { id: 'a', value: 12 }, { id: 'b', value: 23 }, { id: 'c', value: -8 }, { id: 'd', value: 24 },
      { id: 'e', label: 'End', type: 'total', value: 102 },
    ] }) as never, {} as never) as unknown as { warnings: { code: string; message: string }[] };
    expect(geometry.warnings.filter((warning) => warning.code === 'derived-mismatch')).toEqual([]);
    expect(geometry.warnings.filter((warning) => warning.code === 'check-value-rounded').map((warning) => warning.message)).toEqual([
      "total 'e': supplied 102 differs from the computed 101 by less than its inputs' rounding; the computed 101 is drawn and a note names both",
    ]);
    expect(JSON.stringify(geometry)).toContain('End is drawn at 101, the sum of its steps; the data states 102');
    const rounded = (items: object[]) => (def.layout(def.normalize({ items }) as never, {} as never) as unknown as { warnings: { code: string }[] })
      .warnings.filter((warning) => warning.code === 'check-value-rounded').length;
    // A one-unit gap at 1e9 is not float noise; 0.1 + 0.2 against 0.3 is.
    expect(rounded([{ id: 's', type: 'total', value: 1_000_000_000 }, { id: 'a', value: 0 }, { id: 'e', type: 'total', value: 1_000_000_001 }])).toBe(1);
    expect(rounded([{ id: 'a', value: 0.1 }, { id: 'b', value: 0.2 }, { id: 'e', type: 'total', value: 0.3 }])).toBe(0);
  });

  it('takes the precision from the numbers each check sums, not from an unrelated precise step', () => {
    const mismatches = (items: object[]) => (def.layout(def.normalize({ items }) as never, {} as never) as unknown as { warnings: { code: string; message: string }[] })
      .warnings.filter((warning) => warning.code === 'derived-mismatch').map((warning) => warning.message);
    expect(mismatches([
      { id: 'open', type: 'total', value: 10 },
      { id: 'a', value: 1.4 },
      { id: 'sub', type: 'subtotal', value: 11.5 },
      { id: 'mix', value: 11.5, segments: [{ id: 'x', value: 10 }, { id: 'y', value: 1.4 }] },
      { id: 'b', value: 0.123456 },
    ])).toEqual([]);
  });
});

describe('step notes on a broken value axis', () => {
  // The break leaves 12 px over the top bar, so the far seats that lead a note back to its step
  // fall under the key, and both notes stack at a free spot with a stub or no leader.
  it('seats each note on a seat that leads back to its step', () => {
    const data = def.normalize({
      items: [
        { id: 'start', label: 'Unit cost FY25', type: 'total', value: 14.2 },
        { id: 'e0', label: 'Raw materials', value: -0.6, direction: 'lowerIsBetter' },
        { id: 'e1', label: 'Scrap', value: -0.4, direction: 'lowerIsBetter' },
        { id: 'e2', label: 'Energy', value: 0.1, direction: 'lowerIsBetter' },
        { id: 'e3', label: 'Labour', value: -0.1, direction: 'lowerIsBetter' },
        { id: 'e4', label: 'Freight', value: 0.2, direction: 'lowerIsBetter' },
        { id: 'end', label: 'Unit cost FY26', type: 'total', value: 13.4 },
      ],
    });
    const geometry = def.layout(data as never, {
      size: { width: 480, height: 405 },
      theme: 'studio',
      title: 'Cost per unit falls EUR 0.8 on procurement and scrap reduction',
      subtitle: { measure: 'Unit cost' },
      unit: 'EUR/unit',
      format: '1.00',
      source: 'Plant controlling, FY26 vs FY25',
      valueAxis: { break: 'auto' },
      annotations: [
        { kind: 'note', at: { categoryId: 'e0' }, text: 'New supplier contract' },
        { kind: 'note', at: { categoryId: 'e1' }, text: 'Line 3 yield programme' },
      ],
    } as never) as unknown as { labels: { id: string; slot?: string; leader?: unknown }[] };
    const notes = geometry.labels.filter((label) => label.id.startsWith('annotation:'));
    expect(notes).toHaveLength(2);
    for (const note of notes) {
      expect(note.slot).not.toBe('freeSpot');
      expect(note.leader).toBeDefined();
    }
  });

  // The band growth on a small unbroken chart shrank the plot until the second note was hidden
  // for a collision, where the first pass drew both. A grown pass that hides a note is dropped.
  it('keeps every note drawn on a small chart without a break', () => {
    const data = def.normalize({
      items: [
        { id: 'start', label: 'Start', type: 'total', value: 1000 },
        { id: 'e0', label: 'Step 0', value: -100 },
        { id: 'e1', label: 'Step 1', value: 50 },
        { id: 'e2', label: 'Step 2', value: -30 },
        { id: 'e3', label: 'Step 3', value: 20 },
        { id: 'end', label: 'End', type: 'total', value: 940 },
      ],
    });
    const geometry = def.layout(data as never, {
      size: { width: 320, height: 300 },
      theme: 'studio',
      title: 'Title here for the chart',
      unit: 'EUR',
      source: 'Src',
      annotations: [
        { kind: 'note', at: { categoryId: 'e0' }, text: 'New supplier contract' },
        { kind: 'note', at: { categoryId: 'e1' }, text: 'Line 3 yield programme' },
      ],
    } as never) as unknown as { labels: { id: string; hidden?: string }[] };
    const notes = geometry.labels.filter((label) => label.id.startsWith('annotation:'));
    expect(notes).toHaveLength(2);
    expect(notes.filter((note) => note.hidden)).toEqual([]);
  });
});
