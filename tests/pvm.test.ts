/**
 * PVM: the decomposition is the product. A wrong split is invisible to a
 * reader because every bar still adds up, so these tests assert the ARITHMETIC
 * first and the picture second.
 */

import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { claimsForChart } from '../src/core/claims';
import {
  PVM_METHOD_NOTE_COMBINED,
  PVM_METHOD_NOTE_COMBINED_SEPARATE,
  PVM_METHOD_NOTE_IN_PRICE,
  PVM_METHOD_NOTE_SEPARATE,
  assertReconciles,
  decomposePvm,
} from '../src/core/charts/pvm/decompose';
import { fixtures } from '../src/core/charts/pvm/fixtures';
import { assertClosingLevel, layoutPvm as layoutPvmRaw } from '../src/core/charts/pvm/layout';
import { withEngineNotes } from '../src/core/notes';
import type { PvmData, PvmDerived, PvmOptions } from '../src/core/charts/pvm/types';
import { NormalizeError } from '../src/core/normalize/shared';
import { getChartDefinition } from '../src/core/registry';
import { defaultMeasurer } from '../src/core/text';
import { standardTheme } from '../src/core/theme';
import type { Geometry, SceneNode } from '../src/core/types/scene';

// Raw layout unit calls use the same note lifetime as the registered chart.
const layoutPvm: typeof layoutPvmRaw = (...args) => withEngineNotes(() => layoutPvmRaw(...args));

function options(index: number): PvmOptions {
  const definition = getChartDefinition('pvm')!;
  return { ...definition.defaults, ...(fixtures[index]!.options ?? {}) } as PvmOptions;
}

function laid(index: number, extra: Partial<PvmOptions> = {}) {
  return layoutPvm(fixtures[index]!.data, { ...options(index), ...extra });
}

function noteNode(geometry: Geometry<object, object>, text: string) {
  // The frame WRAPS a long footnote to the content width (at most three lines)
  // rather than running it off the canvas — under the footnote layout step the
  // method note legitimately spans two lines, so the sentence is matched over
  // the node's rejoined lines, not line-by-line.
  return geometry.scene.find(
    (candidate): candidate is Extract<SceneNode, { t: 'text' }> =>
      candidate.t === 'text' && candidate.lines.join(' ').includes(text),
  );
}

/** Is this exact sentence actually inked on the canvas? */
function painted(geometry: Geometry<object, object>, text: string) {
  return noteNode(geometry, text) !== undefined;
}

/** Independent re-derivation of the contract, from the definitions only. */
function reference(data: PvmData) {
  const common = data.items.filter((i) => i.prior.qty > 0 && i.current.qty > 0);
  const fresh = data.items.filter((i) => i.prior.qty === 0 && i.current.qty > 0);
  const lost = data.items.filter((i) => i.prior.qty > 0 && i.current.qty === 0);
  const Q0 = common.reduce((a, i) => a + i.prior.qty, 0);
  const Q1 = common.reduce((a, i) => a + i.current.qty, 0);
  const pbar0 = common.reduce((a, i) => a + i.prior.revenue, 0) / Q0;
  const p0 = (i: PvmData['items'][number]) => i.prior.revenue / i.prior.qty;
  const p1 = (i: PvmData['items'][number]) => i.current.revenue / i.current.qty;
  return {
    price: common.reduce((a, i) => a + (p1(i) - p0(i)) * i.current.qty, 0),
    priceLaspeyres: common.reduce((a, i) => a + (p1(i) - p0(i)) * i.prior.qty, 0),
    joint: common.reduce((a, i) => a + (p1(i) - p0(i)) * (i.current.qty - i.prior.qty), 0),
    volume: (Q1 - Q0) * pbar0,
    mix: common.reduce((a, i) => a + (i.current.qty - (Q1 * i.prior.qty) / Q0) * (p0(i) - pbar0), 0),
    new: fresh.reduce((a, i) => a + i.current.revenue, 0),
    lost: -lost.reduce((a, i) => a + i.prior.revenue, 0),
    delta:
      data.items.reduce((a, i) => a + i.current.revenue, 0) -
      data.items.reduce((a, i) => a + i.prior.revenue, 0),
  };
}

const allCommon: PvmData = {
  items: [
    { id: 'a', prior: { qty: 100, revenue: 1000 }, current: { qty: 120, revenue: 1380 } },
    { id: 'b', prior: { qty: 400, revenue: 2000 }, current: { qty: 300, revenue: 1650 } },
    { id: 'c', prior: { qty: 50, revenue: 1500 }, current: { qty: 90, revenue: 2520 } },
  ],
};

const withNewAndLost: PvmData = {
  items: [
    ...allCommon.items,
    { id: 'fresh', prior: { qty: 0, revenue: 0 }, current: { qty: 40, revenue: 900 } },
    { id: 'gone', prior: { qty: 25, revenue: 750 }, current: { qty: 0, revenue: 0 } },
  ],
};

// One item whose price REVERSES the portfolio direction: everything else gets
// dearer, this one gets much cheaper.
const priceReversal: PvmData = {
  items: [
    { id: 'a', prior: { qty: 100, revenue: 1000 }, current: { qty: 110, revenue: 1210 } },
    { id: 'b', prior: { qty: 200, revenue: 4000 }, current: { qty: 260, revenue: 5720 } },
    { id: 'c', prior: { qty: 80, revenue: 3200 }, current: { qty: 300, revenue: 3000 } },
  ],
};

const shapes: [string, PvmData][] = [
  ['all-common', allCommon],
  ['with new and lost', withNewAndLost],
  ['price reversal', priceReversal],
];

describe('pvm decomposition', () => {
  it.each(shapes)('%s: the five effects reconcile to the total change exactly', (_name, data) => {
    const { derived } = decomposePvm(data, 'in-price');
    const expected = reference(data);
    expect(derived.effectValues.volume).toBeCloseTo(expected.volume, 9);
    expect(derived.effectValues.mix).toBeCloseTo(expected.mix, 9);
    expect(derived.effectValues.price).toBeCloseTo(expected.price, 9);
    expect(derived.effectValues.new ?? 0).toBeCloseTo(expected.new, 9);
    expect(derived.effectValues.lost ?? 0).toBeCloseTo(expected.lost, 9);
    expect(derived.delta).toBe(expected.delta);
    // Zero to within one ulp. Bit-exact zero is not achievable in double
    // precision for a decomposition built from divisions, and claiming it
    // would be the kind of number this package exists to refuse.
    expect(Math.abs(derived.relativeResidual)).toBeLessThanOrEqual(Number.EPSILON);
  });

  it.each(shapes)('%s: the interaction split reproduces the single price bar', (_name, data) => {
    const single = decomposePvm(data, 'in-price').derived;
    const split = decomposePvm(data, 'separate').derived;
    expect(split.effectValues['price-laspeyres']! + split.effectValues.joint!).toBeCloseTo(
      single.effectValues.price!,
      9,
    );
    expect(split.delta).toBe(single.delta);
    expect(Math.abs(split.relativeResidual)).toBeLessThanOrEqual(Number.EPSILON);
    expect(single.effectValues['price-laspeyres']).toBeUndefined();
    expect(split.effectValues.price).toBeUndefined();
  });

  it('is invariant to the order of items', () => {
    const reversed: PvmData = { items: [...withNewAndLost.items].reverse() };
    const base = decomposePvm(withNewAndLost, 'in-price').derived;
    const flipped = decomposePvm(reversed, 'in-price').derived;
    for (const id of ['volume', 'mix', 'price', 'new', 'lost']) {
      expect(flipped.effectValues[id], id).toBeCloseTo(base.effectValues[id]!, 9);
    }
  });

  it('omits an empty bucket rather than drawing a fake zero bar, and records the omission', () => {
    const geometry = layoutPvm(allCommon, { title: 'a' });
    const derived = geometry.derived as PvmDerived;
    expect(derived.effects.map((e) => e.id)).toEqual(['volume', 'mix', 'price']);
    expect(derived.omittedEffects).toEqual(['new', 'lost']);
    expect(geometry.scene.some((n) => n.owner?.categoryId === 'new')).toBe(false);
  });

  it('draws and labels an effect that is exactly zero — absence must be readable', () => {
    // Every common item shares the prior price, so mix is identically zero.
    const flatPrices: PvmData = {
      items: [
        { id: 'a', prior: { qty: 100, revenue: 1000 }, current: { qty: 150, revenue: 1650 } },
        { id: 'b', prior: { qty: 200, revenue: 2000 }, current: { qty: 300, revenue: 3600 } },
      ],
    };
    const geometry = layoutPvm(flatPrices, { title: 'Mix is exactly zero', unit: '€k' });
    const derived = geometry.derived as PvmDerived;
    expect(derived.effectValues.mix).toBe(0);
    expect(geometry.marks.bars.some((bar) => bar.id === 'mix')).toBe(true);
    const label = geometry.labels.find((candidate) => candidate.id === 'sum:mix');
    expect(label?.hidden ?? false).toBe(false);
    expect(label?.text).toBe('0');
  });

  it('prints the convention on request, and the note fits the canvas', () => {
    for (const [index, fixture] of fixtures.entries()) {
      // Footer rule: method notes go to the notes list by default; this test draws them all in full.
      const geometry = laid(index, { methodNote: true, notes: { placement: 'frame', show: ['note', 'method'], maxLines: 1000, pointer: false } });
      const derived = geometry.derived as PvmDerived;
      const expected =
        derived.volumeMix === 'combined'
          ? derived.interaction === 'separate' ? PVM_METHOD_NOTE_COMBINED_SEPARATE : PVM_METHOD_NOTE_COMBINED
          : derived.interaction === 'separate' ? PVM_METHOD_NOTE_SEPARATE : PVM_METHOD_NOTE_IN_PRICE;
      expect(derived.methodNote, fixture.id).toBe(expected);
      // All applicable disclosures are inked, and the frame lays footnotes out on
      // ONE unwrapped line: a longer sentence silently leaves the canvas
      // instead of wrapping, so each is measured against the content box.
      const notes = [derived.methodNote, derived.unitBasisNote, derived.coverageNote].filter(
        (line): line is string => line !== null,
      );
      expect(notes.length, `${fixture.id}: method and coverage, plus unit basis when split`)
        .toBe(derived.volumeMix === 'combined' ? 2 : 3);
      for (const text of notes) {
        const node = noteNode(geometry, text);
        expect(node, `${fixture.id}: "${text.slice(0, 40)}..." is painted`).toBeDefined();
        const font = { ...standardTheme.type.footnote, family: standardTheme.type.family };
        const width = defaultMeasurer(node!.lines[0]!, font).width;
        expect(node!.x + width, `${fixture.id}: "${text.slice(0, 40)}..." stays on canvas`).toBeLessThanOrEqual(
          geometry.size.width - node!.x,
        );
      }
    }
  });

  // The page showed both totals but never their difference, so a reader had to subtract.
  it('prints the net change over the closing column, and netChange false removes it', () => {
    const geometry = laid(0);
    const derived = geometry.derived as PvmDerived;
    const net = geometry.labels.find((label) => label.id === 'net:current');
    const percent = ((derived.delta / derived.priorRevenue) * 100).toFixed(1).replace('-', '\u2212');
    expect(net?.text).toContain(`(${derived.delta > 0 ? '+' : ''}${percent}%)`);
    expect(laid(0, { netChange: false }).labels.some((label) => label.id === 'net:current')).toBe(false);
  });

  // Equal revenue with changed quantities left float residue in the accumulated closing level, and the net change printed a loss of 1 on an unchanged revenue.
  it('prints no net change when the revenue is unchanged', () => {
    const items = [{ id: 'a', label: 'Widget', prior: { qty: 3, revenue: 100 }, current: { qty: 7, revenue: 100 } }];
    const geometry = layoutPvm({ items } as PvmData, { ...getChartDefinition('pvm')!.defaults, size: { width: 888, height: 396 } } as PvmOptions);
    expect((geometry.derived as PvmDerived).delta).toBe(0);
    expect(geometry.labels.some((label) => label.id.startsWith('net:'))).toBe(false);
  });

  it('leaves the convention off by default without a warning ', () => {
    for (const extra of [{ methodNote: undefined }, { methodNote: false }]) {
      const geometry = laid(0, extra);
      expect((geometry.derived as PvmDerived).methodNote).toBeNull();
      expect(geometry.warnings.map((w) => w.code)).not.toContain('pvm-note-hidden');
    }
  });

  it('refuses a step highlight while the effects take their sign\'s colour, and keeps it under a palette', () => {
    const refusal = (extra: Partial<PvmOptions>) => laid(0, { highlight: 'price', ...extra }).warnings
      .find((warning) => warning.code === 'pvm-highlight-on-sign');
    expect([refusal({}), refusal({ palette: 'atlantic' })]).toMatchObject([
      { severity: 'error', field: ['options', 'highlight'], fix: [{ op: 'remove', path: '/options/highlight' }] },
      undefined,
    ]);
  });

  it('carries every effect and the reconciliation into the claims receipt', () => {
    const geometry = laid(0);
    const derived = geometry.derived as PvmDerived;
    const claims = claimsForChart('pvm', geometry as never);
    for (const effect of derived.effects) {
      const claim = claims.find((c) => c.id === `pvm:effect:${effect.id}`);
      expect(claim, effect.id).toBeDefined();
      expect(claim!.op).toBe('pvm-effect@1');
      // The receipt carries the effect at 12 significant digits.
      expect(claim!.output.raw).toBeCloseTo(effect.value, 6);
      // The inputs are not the same two endpoints (`priorRevenue`, `currentRevenue`)
      // on every effect: no single effect can be re-derived from two endpoints.
      // The real operands are the per-item terms the decomposition sums,
      // and they add up to the effect — checked here, not just listed.
      expect(claim!.inputs.map((i) => i.ref)).toEqual(
        derived.contributions.map((item) => `${item.id}:${effect.id}`),
      );
      const summed = claim!.inputs.reduce((total, input) => total + (input.value ?? 0), 0);
      expect(summed, effect.id).toBeCloseTo(effect.value, 9);
    }
    const reconciliation = claims.find((c) => c.id === 'pvm:reconciliation')!;
    expect(reconciliation.kind).toBe('reconciliation');
    expect(reconciliation.op).toBe('pvm-reconciliation@1');
    expect(reconciliation.output.raw).toBe(derived.residual);
    // The effects whose residual this IS were the one thing the record left
    // out, so the number it reported could not be checked against the bars it
    // reconciles: delta first, then every effect.
    expect(reconciliation.inputs.map((i) => i.ref)).toEqual([
      'delta',
      ...derived.effects.map((effect) => `effect:${effect.id}`),
    ]);
  });
});

describe('pvm unit invariance — the split is not a fact about the business alone', () => {
  /** The same business, with item `b` counted in cases of 12 instead of units. */
  const inCases = (data: PvmData, id: string, k: number): PvmData => ({
    ...data,
    items: data.items.map((item) =>
      item.id === id
        ? {
            ...item,
            prior: { qty: item.prior.qty / k, revenue: item.prior.revenue },
            current: { qty: item.current.qty / k, revenue: item.current.revenue },
          }
        : item,
    ),
  });

  const rebased = inCases(withNewAndLost, 'b', 12);

  it('Volume and Mix MOVE when one item is recounted in a different unit', () => {
    const units = decomposePvm(withNewAndLost, 'in-price').derived;
    const cases = decomposePvm(rebased, 'in-price').derived;
    // The thing the exhibit has to disclose: two bars a CFO reads as facts.
    expect(cases.effectValues.volume).not.toBeCloseTo(units.effectValues.volume!, 6);
    expect(cases.effectValues.mix).not.toBeCloseTo(units.effectValues.mix!, 6);
    // ...and the three that are invariant, plus the total, which is why the
    // exhibit still reconciles and the reader gets no warning from the picture.
    expect(cases.effectValues.price).toBeCloseTo(units.effectValues.price!, 9);
    expect(cases.effectValues.new).toBeCloseTo(units.effectValues.new!, 9);
    expect(cases.effectValues.lost).toBeCloseTo(units.effectValues.lost!, 9);
    expect(cases.delta).toBe(units.delta);
    // Volume + Mix is invariant: the boundary moves, the pair does not.
    expect(cases.volumeMixCombined).toBeCloseTo(units.volumeMixCombined, 9);
  });

  it("volumeMix: 'combined' is invariant to the counting unit, effect for effect", () => {
    const units = decomposePvm(withNewAndLost, 'in-price', 'combined').derived;
    const cases = decomposePvm(rebased, 'in-price', 'combined').derived;
    expect(units.effects.map((e) => e.id)).toEqual(['volume-mix', 'price', 'new', 'lost']);
    for (const effect of units.effects) {
      expect(cases.effectValues[effect.id], effect.id).toBeCloseTo(effect.value, 9);
    }
    expect(Math.abs(cases.relativeResidual)).toBeLessThanOrEqual(Number.EPSILON);
    // Rescaling EVERY item, not just one, is also inert.
    let all = withNewAndLost;
    for (const id of ['a', 'b', 'c']) all = inCases(all, id, 7);
    const scaled = decomposePvm(all, 'in-price', 'combined').derived;
    for (const effect of units.effects) {
      expect(scaled.effectValues[effect.id], `${effect.id} (all rescaled)`).toBeCloseTo(effect.value, 9);
    }
  });

  it('states the unit basis on request; coverage under churn prints regardless ', () => {
    const geometry = layoutPvm({ ...withNewAndLost, quantityUnit: 'licences' }, { title: 'a', methodNote: true, notes: { show: ['note', 'disclosure'] } });
    const derived = geometry.derived as PvmDerived;
    expect(derived.quantityUnit).toBe('licences');
    expect(derived.unitBasisNote).toContain('quantities counted in licences');
    expect(derived.unitBasisNote).toContain('their sum does not');
    // The frame prints one short line; the long notes
    // join the notes list when the author sets `notes`.
    expect(painted(geometry, 'Covers the 3 items in both periods; volume and mix at prior prices.')).toBe(true);
    expect(painted(geometry, derived.unitBasisNote!)).toBe(false);
    expect(painted(layoutPvm({ ...withNewAndLost, quantityUnit: 'licences' }, { title: 'a', methodNote: true, notes: { show: ['note', 'method'] } }), derived.unitBasisNote!)).toBe(true);
    // The unit basis is a property of the method, so it goes with the method.
    // Coverage is not: with items entering and leaving the book the bars speak
    // for part of the revenue only, and a reader has to be told.
    const quiet = layoutPvm({ ...withNewAndLost, quantityUnit: 'licences' }, { title: 'a', notes: { show: ['note', 'disclosure'] } });
    const quietDerived = quiet.derived as PvmDerived;
    expect(quietDerived.methodNote).toBeNull();
    expect(quietDerived.unitBasisNote).toBeNull();
    expect(painted(quiet, derived.unitBasisNote!)).toBe(false);
    expect(painted(quiet, 'Covers the 3 items in both periods.')).toBe(true);
    // Full coverage says nothing a reader could misread: a method note too.
    expect((layoutPvm(allCommon, { title: 'a' }).derived as PvmDerived).coverageNote).toBeNull();
    expect((layoutPvm(allCommon, { title: 'a', methodNote: true }).derived as PvmDerived).coverageNote).toContain('100.0%');
  });

  it('warns when the counting unit is undeclared, and stops warning once it is', () => {
    const bare = layoutPvm(withNewAndLost, { title: 'a' });
    const warning = bare.warnings.find((w) => w.code === 'pvm-quantity-unit-undeclared');
    expect(warning?.severity).toBe('warn');
    expect(warning?.message).toMatch(/cases rather than units/);
    expect(warning?.suggest).toContain('volumeMix');
    // With the method notes on, the exhibit states the dependence; it just
    // cannot name the unit.
    expect((layoutPvm(withNewAndLost, { title: 'a', methodNote: true }).derived as PvmDerived).unitBasisNote)
      .toContain('quantities with no common counting unit declared');

    const declared = layoutPvm({ ...withNewAndLost, quantityUnit: 'seats' }, { title: 'a' });
    expect(declared.warnings.map((w) => w.code)).not.toContain('pvm-quantity-unit-undeclared');
    // 'combined' has no unit-dependent boundary, so there is nothing to warn or
    // disclose — and the method note says which convention is in force.
    const combined = layoutPvm(withNewAndLost, { title: 'a', volumeMix: 'combined', methodNote: true });
    expect(combined.warnings.map((w) => w.code)).not.toContain('pvm-quantity-unit-undeclared');
    expect((combined.derived as PvmDerived).unitBasisNote).toBeNull();
    expect((combined.derived as PvmDerived).methodNote).toBe(PVM_METHOD_NOTE_COMBINED);
  });

  it('rejects a hallucinated volumeMix value by naming the accepted ones', () => {
    let thrown: unknown;
    try {
      layoutPvm(allCommon, { volumeMix: 'merged' as never });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as NormalizeError).code).toBe('pvm-volume-mix-invalid');
    expect((thrown as NormalizeError).suggest).toContain("'split', 'combined'");
    expect(getChartDefinition('pvm')!.optionsSchema.safeParse({ volumeMix: 'merged' }).success).toBe(false);
  });
});

describe('pvm coverage — how much of the book P/V/M actually speak for', () => {
  it('measures the common share and prints it on the exhibit', () => {
    const geometry = layoutPvm({ ...withNewAndLost, quantityUnit: 'licences' }, { title: 'a', notes: { show: ['note', 'disclosure'] } });
    const derived = geometry.derived as PvmDerived;
    // common = a,b,c: prior 4,500 of 5,250; current 5,550 of 6,450.
    expect(derived.commonPriorShare).toBeCloseTo(4500 / 5250, 12);
    expect(derived.commonCurrentShare).toBeCloseTo(5550 / 6450, 12);
    expect(derived.coverageNote).toBe(
      'Price, volume and mix cover the 3 items present in both periods — 85.7% of prior and 86.0% of current revenue.',
    );
    expect(painted(geometry, 'Covers the 3 items in both periods.')).toBe(true);
  });

  it('warns when most of the book churns, so P/V/M cannot be read as the explanation', () => {
    // One small survivor; everything else is new or lost.
    const churn: PvmData = {
      quantityUnit: 'licences',
      items: [
        { id: 'stays', prior: { qty: 100, revenue: 1000 }, current: { qty: 120, revenue: 1320 } },
        { id: 'stays2', prior: { qty: 50, revenue: 400 }, current: { qty: 60, revenue: 510 } },
        { id: 'gone', prior: { qty: 500, revenue: 9000 }, current: { qty: 0, revenue: 0 } },
        { id: 'fresh', prior: { qty: 0, revenue: 0 }, current: { qty: 400, revenue: 8000 } },
      ],
    };
    const geometry = layoutPvm(churn, { title: 'a' });
    const derived = geometry.derived as PvmDerived;
    expect(derived.commonPriorShare).toBeCloseTo(1400 / 10400, 12);
    const warning = geometry.warnings.find((w) => w.code === 'pvm-thin-common-base');
    expect(warning?.severity).toBe('warn');
    expect(warning!.message).toContain('13.5% of prior');
    expect(warning!.message).toContain('18.6% of current');
    // A healthy book does not get the warning.
    expect(
      layoutPvm({ ...withNewAndLost, quantityUnit: 'licences' }, { title: 'a' }).warnings.map((w) => w.code),
    ).not.toContain('pvm-thin-common-base');
  });
});

describe('pvm ordinary corporate magnitudes', () => {
  // A €2.8bn revenue book. Its effects sum to the total change with an ABSOLUTE
  // float gap of ~1.2e-7 — 119x the host waterfall's fixed 1e-9 epsilon, and
  // 1.5e-16 RELATIVE. The previous adapter supplied the closing total as a check
  // value, so this book went to a fixed-ABSOLUTE audit it cannot pass, and the
  // message printed "supplied X != computed X" with X identical on both sides.
  // Measured over 500 seeded EUR-bn books: 300 trip that path, 0 trip the shipped one.
  // A bridge that cannot draw a normal revenue book is not a bridge.
  const bigBook: PvmData = {
    quantityUnit: 'units',
    items: [
      { id: 'i0', prior: { qty: 8506, revenue: 248275044 }, current: { qty: 1109, revenue: 37128468 } },
      { id: 'i1', prior: { qty: 6652, revenue: 467903990 }, current: { qty: 6988, revenue: 509349637 } },
      { id: 'i2', prior: { qty: 5643, revenue: 313085068 }, current: { qty: 5753, revenue: 259066362 } },
      { id: 'i3', prior: { qty: 6181, revenue: 573549626 }, current: { qty: 4173, revenue: 389152726 } },
      { id: 'i4', prior: { qty: 8360, revenue: 677256900 }, current: { qty: 8532, revenue: 686466747 } },
      { id: 'i5', prior: { qty: 6127, revenue: 515386627 }, current: { qty: 8277, revenue: 639158127 } },
    ],
  };

  it('draws a EUR 2.8bn book, whose float error is 119x the host absolute epsilon', () => {
    const derived = decomposePvm(bigBook, 'in-price').derived;
    const gap = Math.abs(derived.delta - derived.effects.reduce((a, e) => a + e.value, 0));
    // The pin: this dataset IS past the absolute epsilon, and is nevertheless right.
    expect(gap).toBeGreaterThan(1e-9);
    expect(Math.abs(derived.relativeResidual)).toBeLessThanOrEqual(Number.EPSILON);
    expect(derived.priorRevenue).toBe(2795457255);

    const geometry = layoutPvm(bigBook, { title: 'a', unit: 'EUR' });
    expect((geometry.derived as PvmDerived).currentRevenue).toBe(2520322067);
    expect(geometry.warnings.map((w) => w.code)).not.toContain('derived-mismatch');
    expect(geometry.marks.bars.length).toBeGreaterThan(2);
  });

  it('still refuses a bridge that genuinely does not land on the current revenue', () => {
    // The host is handed a closing level that
    // is wrong by far more than float noise.
    const derived = decomposePvm(allCommon, 'in-price').derived;
    expect(() =>
      assertClosingLevel({ derived: { totals: { current: derived.currentRevenue + 25 } } } as never, derived),
    ).toThrowError(/does not land on the current-period revenue/);
    expect(() =>
      assertClosingLevel({ derived: { totals: {} } } as never, derived),
    ).toThrowError(/no closing level/);
    // Float-scale disagreement is NOT a refusal.
    expect(() =>
      assertClosingLevel(
        { derived: { totals: { current: derived.currentRevenue * (1 + 1e-15) } } } as never,
        derived,
      ),
    ).not.toThrow();
  });
});

describe('pvm what the reader sees', () => {
  it('the example fixtures draw every effect as a bar, not a hairline', () => {
    for (const [index, fixture] of fixtures.entries()) {
      if (fixture.kind !== 'example') continue;
      const geometry = laid(index);
      const effects = geometry.marks.bars.filter((bar) => bar.id !== 'prior' && bar.id !== 'current');
      const smallest = Math.min(...effects.map((bar) => bar.rect.h));
      // Measured: 10.86px on fy-revenue-bridge, 6.14px on the interaction split.
      // The earlier data drew both at 0.54px, which is a rule, not a bar.
      expect(smallest, `${fixture.id}: smallest effect bar`).toBeGreaterThanOrEqual(5);
    }
  });

  it('no fixture hides a value label, and the torture fixture ships untuned', () => {
    for (const [index, fixture] of fixtures.entries()) {
      const geometry = laid(index);
      expect(geometry.labels.filter((l) => l.hidden).map((l) => l.id), fixture.id).toEqual([]);
      expect(geometry.warnings.map((w) => w.code), fixture.id).not.toContain('label-hidden');
      expect(fixture.options?.labelPlacements, `${fixture.id}: no label pin`).toBeUndefined();
    }
  });

  it('every message title cites only magnitudes the exhibit actually draws', () => {
    for (const [index, fixture] of fixtures.entries()) {
      const derived = laid(index).derived as PvmDerived;
      const drawn = new Set<string>();
      const millions = (v: number) => `$${Math.abs(v / 1000).toFixed(1)}m`;
      for (const effect of derived.effects) drawn.add(millions(effect.value));
      drawn.add(millions(derived.delta));
      // Sums of drawn bars are also checkable by the reader.
      for (const a of derived.effects)
        for (const b of derived.effects) if (a.id !== b.id) drawn.add(millions(a.value + b.value));
      const cited = (fixture.options!.title as string).match(/\$[\d.]+m/g) ?? [];
      expect(cited.length, `${fixture.id}: the title quotes a number`).toBeGreaterThan(0);
      for (const amount of cited) {
        expect(drawn, `${fixture.id}: "${amount}" is a magnitude on the exhibit`).toContain(amount);
      }
      // ...and it names no item, because no item is drawn.
      for (const item of (fixtures[index]!.data as PvmData).items) {
        if (!item.label) continue;
        expect(fixture.options!.title as string, `${fixture.id} names '${item.label}'`).not.toContain(
          item.label,
        );
      }
    }
  });
});

describe('pvm fail-closed behaviour', () => {
  const cases: [string, string, string, () => unknown][] = [
    [
      'pvm-negative-quantity',
      'items[a].current.qty',
      'negative volume',
      () =>
        layoutPvm({
          items: [
            { id: 'a', prior: { qty: 10, revenue: 100 }, current: { qty: -5, revenue: 50 } },
            { id: 'b', prior: { qty: 10, revenue: 100 }, current: { qty: 12, revenue: 130 } },
          ],
        }),
    ],
    [
      'pvm-price-undefined',
      'items[a].current',
      'price cannot be derived',
      () =>
        layoutPvm({
          items: [
            { id: 'a', prior: { qty: 10, revenue: 100 }, current: { qty: 0, revenue: 50 } },
            { id: 'b', prior: { qty: 10, revenue: 100 }, current: { qty: 12, revenue: 130 } },
          ],
        }),
    ],
    [
      'pvm-no-common-base',
      'items',
      'undefined',
      () =>
        layoutPvm({
          items: [
            { id: 'a', prior: { qty: 10, revenue: 100 }, current: { qty: 0, revenue: 0 } },
            { id: 'b', prior: { qty: 0, revenue: 0 }, current: { qty: 12, revenue: 130 } },
          ],
        }),
    ],
    ['empty-data', 'items', 'at least one item', () => layoutPvm({ items: [] })],
    [
      'pvm-non-finite',
      'items[a].current',
      'non-finite',
      () =>
        layoutPvm({
          items: [
            { id: 'a', prior: { qty: 10, revenue: 100 }, current: { qty: 10, revenue: Number.NaN } },
          ],
        }),
    ],
  ];

  it.each(cases)('throws %s rather than drawing an impossible exhibit', (code, path, fragment, run) => {
    let thrown: unknown;
    try {
      run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, code).toBeInstanceOf(NormalizeError);
    const error = thrown as NormalizeError;
    expect(error.code).toBe(code);
    expect(error.path).toBe(path);
    expect(error.message).toContain(fragment);
    expect(error.suggest, `${code} carries a remedy`).toBeTruthy();
  });

  it('rejects a hallucinated interaction value by naming the accepted ones', () => {
    let thrown: unknown;
    try {
      layoutPvm(allCommon, { interaction: 'split' as never });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as NormalizeError).code).toBe('pvm-interaction-invalid');
    expect((thrown as NormalizeError).suggest).toContain("'in-price', 'separate'");
    const parsed = getChartDefinition('pvm')!.optionsSchema.safeParse({ interaction: 'split' });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed)).toContain('in-price');
  });

  it('warns without refusing when a positive quantity carries negative revenue', () => {
    const geometry = layoutPvm({
      items: [
        { id: 'a', prior: { qty: 10, revenue: -100 }, current: { qty: 12, revenue: -90 } },
        { id: 'b', prior: { qty: 10, revenue: 500 }, current: { qty: 14, revenue: 750 } },
      ],
    });
    const warning = geometry.warnings.find((w) => w.code === 'pvm-negative-price');
    expect(warning?.severity).toBe('warn');
    expect(warning?.message).toContain('a');
    expect(Math.abs((geometry.derived as PvmDerived).relativeResidual)).toBeLessThanOrEqual(
      Number.EPSILON,
    );
  });

  it('renders an unchanged total and says the effects are offsetting', () => {
    const geometry = layoutPvm({
      items: [
        { id: 'a', prior: { qty: 100, revenue: 1000 }, current: { qty: 50, revenue: 750 } },
        { id: 'b', prior: { qty: 100, revenue: 2000 }, current: { qty: 130, revenue: 2250 } },
      ],
    });
    expect((geometry.derived as PvmDerived).delta).toBe(0);
    const warning = geometry.warnings.find((w) => w.code === 'pvm-zero-net');
    expect(warning?.severity).toBe('info');
    expect(geometry.marks.bars.length).toBeGreaterThan(2);
  });

  it('the reconciliation guard fires on a corrupted effect array', () => {
    const good = decomposePvm(withNewAndLost, 'in-price').derived;
    expect(Math.abs(assertReconciles(good.delta, good.effects))).toBeLessThanOrEqual(
      1e-9 * Math.abs(good.delta),
    );
    const corrupted = good.effects.map((effect) =>
      effect.id === 'mix' ? { ...effect, value: effect.value + 1e-3 } : effect,
    );
    expect(() => assertReconciles(good.delta, corrupted)).toThrowError(/does not reconcile/);
    try {
      assertReconciles(good.delta, corrupted);
    } catch (error) {
      expect((error as NormalizeError).code).toBe('pvm-residual');
      expect((error as NormalizeError).message).toContain(String(good.delta));
    }
  });
});

// Volume -454,249 and Mix +444,849 cancel to 2%, so the split between them is the story and rests on the unit.
describe('pvm method notes where volume and mix cancel', () => {
  it('prints the convention without methodNote', () => {
    const index = fixtures.findIndex((fixture) => fixture.id === 'mix-dominates-sign-flip');
    expect((laid(index, { methodNote: undefined }).derived as PvmDerived).methodNote).not.toBeNull();
  });
});

// Price +4,560 drawn grey beside totals in the accent read as nothing.
describe('pvm effects take their sign colour', () => {
  it('paints a gain and a loss apart unless the theme sets the bridge', () => {
    const fillOf = (geometry: Geometry<object, object>, categoryId: string) => JSON.stringify(geometry.scene.find((node): node is Extract<SceneNode, { t: 'rect' }> => node.t === 'rect' && node.part === 'segment' && node.owner.categoryId === categoryId)?.fill);
    const geometry = laid(0);
    expect([fillOf(geometry, 'price'), fillOf(geometry, 'mix')]).toEqual([expect.stringContaining('good'), expect.stringContaining('bad')]);
  });
});

describe('pvm valueAxis.break', () => {
  it.each([[320, 468], [400, 452], [480, 445], [720, 465], [960, 495]])(
    'keeps the whole-axis height at %i px', async (width, redesignHeight) => {
      const { measure } = await import('../src/index');
      const fixture = fixtures.find(entry => entry.id === 'fy-revenue-bridge')!;
      const result = measure({ type: 'pvm', data: fixture.data, options: { ...fixture.options, valueAxis: { break: false }, notes: { show: ['note', 'disclosure'] }, size: { width } } } as never);
      expect(result.refused).toBeUndefined();
      expect(Math.abs(result.geometry!.size.height / redesignHeight - 1)).toBeLessThanOrEqual(0.03);
      expect(result.geometry!.scene.some(node => node.part === 'barBreak')).toBe(false);
    },
  );

  // A whole axis spent the plot on two totals and drew the steps as slivers.
  it('breaks by default where the base swamps the steps, and false keeps it whole', async () => {
    const { measure } = await import('../src/index');
    const fixture = fixtures.find((entry) => entry.id === 'fy-revenue-bridge')!;
    const broken = (valueAxis?: object) => {
      const result = measure({ type: 'pvm', data: fixture.data, options: { ...fixture.options, ...(valueAxis ? { valueAxis } : {}), notes: { show: ['note', 'disclosure'] }, size: { width: 720 } } } as never) as { geometry?: Geometry<object, object> };
      expect(result.geometry, JSON.stringify(result).slice(0, 400)).toBeDefined();
      return JSON.stringify(result.geometry!.scene).includes('Value axis broken');
    };
    expect(broken()).toBe(true);
    expect(broken({ break: false })).toBe(false);
    expect(broken({ break: 'auto' })).toBe(true);
  });
});
