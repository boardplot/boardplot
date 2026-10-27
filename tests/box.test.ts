/**
 * The box plot's own gates.
 *
 * The three claims worth a test are (a) the quantile arithmetic matches the
 * tool the reader will re-check it in, (b) a degenerate group refuses to draw
 * a fake shape and says why, and (c) every mark exists before the solver, so
 * nothing a reader sees can be overlapped by a label.
 */

import { getFixtures } from '../src/fixtures';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { boxDataSchema, boxDefinition } from '../src/core/charts/box';
import { layoutBox } from '../src/core/charts/box/layout';
import { summarizeGroup } from '../src/core/charts/box/summary';
import type { BoxData, BoxOptions } from '../src/core/charts/box/types';
import { claimsForChart } from '../src/core/claims';
import { contrastRatio } from '../src/core/color';
import { rectsOverlap } from '../src/core/geometry';
import { NormalizeError } from '../src/core/normalize/shared';
import { quantileType7, sortAscending } from '../src/core/stats';
import { renderSvg } from '../src/core/svg/renderSvg';
import { defaultMeasurer } from '../src/core/text';
import { paintColor, resolveTheme } from '../src/core/theme';
import type { SceneNode } from '../src/core/types/scene';

const ONE_TO_TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function lay(data: BoxData, options: BoxOptions = {}) {
  return layoutBox(data, { size: { width: 900, height: 520 }, ...options });
}

function codes(geometry: { warnings: { code: string }[] }): string[] {
  return geometry.warnings.map((warning) => warning.code);
}

function nodesOfPart(geometry: { scene: SceneNode[] }, part: string): SceneNode[] {
  return geometry.scene.filter((node) => node.part === part);
}

const evenSample = [2, 4, 4, 5, 7, 9, 11, 12];
const oddSample = [3, 6, 7, 8, 15, 18, 20];

describe('src/core/stats — the shared type-7 implementation', () => {
  it('matches hand-computed odd-n and even-n samples', () => {
    // odd n = 7: h(0.25) = 1.5 -> 6 + 0.5*(7-6) = 6.5; median = x[3] = 8;
    // h(0.75) = 4.5 -> 15 + 0.5*(18-15) = 16.5
    expect(quantileType7(oddSample, 0.25)).toBe(6.5);
    expect(quantileType7(oddSample, 0.5)).toBe(8);
    expect(quantileType7(oddSample, 0.75)).toBe(16.5);
    // even n = 8: h(0.25) = 1.75 -> 4 + 0.75*(4-4) = 4; median = h 3.5 -> 5 + 0.5*(7-5) = 6;
    // h(0.75) = 5.25 -> 9 + 0.25*(11-9) = 9.5
    expect(quantileType7(evenSample, 0.25)).toBe(4);
    expect(quantileType7(evenSample, 0.5)).toBe(6);
    expect(quantileType7(evenSample, 0.75)).toBe(9.5);
  });
});

describe('box summary contract', () => {
  it('stops the tukey whiskers at observations, never at the fences', () => {
    const observations = [10, 12, 13, 14, 15, 16, 17, 18, 19, 60];
    const summary = summarizeGroup({ id: 'g', label: 'g', observations, whiskers: 'tukey' });
    const sorted = sortAscending(observations);
    const q1 = quantileType7(sorted, 0.25);
    const q3 = quantileType7(sorted, 0.75);
    expect(summary.fenceLow).toBe(q1 - 1.5 * (q3 - q1));
    expect(summary.fenceHigh).toBe(q3 + 1.5 * (q3 - q1));
    expect(summary.beyondWhiskers).toEqual([60]);
    // the whisker end is a real observation inside the fence, not the fence
    expect(summary.whiskerHigh).toBe(19);
    expect(summary.whiskerHigh).not.toBe(summary.fenceHigh);
    expect(summary.whiskerLow).toBe(10);
  });

  it("puts 'minmax' whiskers at the extremes with no outliers, and 'p10p90' at the quantiles", () => {
    const observations = [10, 12, 13, 14, 15, 16, 17, 18, 19, 60];
    const minmax = summarizeGroup({ id: 'g', label: 'g', observations, whiskers: 'minmax' });
    expect([minmax.whiskerLow, minmax.whiskerHigh]).toEqual([10, 60]);
    expect(minmax.beyondWhiskers).toEqual([]);

    const percentile = summarizeGroup({ id: 'g', label: 'g', observations, whiskers: 'p10p90' });
    const sorted = sortAscending(observations);
    expect(percentile.whiskerLow).toBe(quantileType7(sorted, 0.1));
    expect(percentile.whiskerHigh).toBe(quantileType7(sorted, 0.9));
    expect(percentile.beyondWhiskers).toEqual([10, 60]);
  });
});

describe('box layout', () => {
  // Parking an outlier must not remove another group's median or small-sample point from the scale.
  it('parks only a value used exclusively by outliers', () => {
    const first = { id: 'a', observations: [1, 1, 1, 1, 1, 1, 1, 1, 100] };
    for (const observations of [[100, 100, 100, 100, 100], [100]]) {
      const g = lay({ groups: [first, { id: 'b', observations }] });
      const marks = g.scene.filter((n) => n.owner.categoryId === 'b' && ['boxMedian', 'boxObservation'].includes(n.part ?? ''));
      expect(marks.length).toBeGreaterThan(0);
      for (const n of marks) {
        const x = n.t === 'line' ? n.x1 : n.t === 'circle' ? n.cx : NaN;
        expect(x).toBeGreaterThanOrEqual(g.plot.x);
        expect(x).toBeLessThanOrEqual(g.plot.x + g.plot.w);
      }
      expect(g.scene.some((n) => n.id.includes('park'))).toBe(false);
    }
    expect(lay({ groups: [first] }).scene.some((n) => n.id.includes('park'))).toBe(true);
  });

  it('places the box geometry exactly on the scale', () => {
    const geometry = lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] });
    const rect = geometry.scene.find((node) => node.id === 'box:rect:a');
    const median = geometry.scene.find((node) => node.id === 'box:median:a');
    expect(rect?.t).toBe('rect');
    expect(median?.t).toBe('line');
    const group = geometry.derived.groups[0]!;
    // rect width is exactly the Q1..Q3 span on the value scale
    if (rect?.t !== 'rect' || median?.t !== 'line') throw new Error('missing marks');
    const perUnit = rect.rect.w / (group.q3! - group.q1!);
    expect(median.x1).toBeCloseTo(rect.rect.x + (group.median! - group.q1!) * perUnit, 6);
    expect(median.x1).toBeGreaterThanOrEqual(rect.rect.x);
    expect(median.x1).toBeLessThanOrEqual(rect.rect.x + rect.rect.w);
  });

  it('keeps every outlier and whisker cap inside the plot rect', () => {
    const geometry = lay({
      groups: [
        { id: 'a', observations: [...ONE_TO_TEN, 400] },
        { id: 'b', observations: [...ONE_TO_TEN.map((v) => v + 3), -200] },
      ],
    });
    const plot = geometry.plot;
    for (const node of geometry.scene.filter((n) => n.part === 'boxBeyond')) {
      if (node.t !== 'circle') throw new Error('outlier is not a circle');
      expect(node.cx - node.r).toBeGreaterThanOrEqual(plot.x - 1e-6);
      expect(node.cx + node.r).toBeLessThanOrEqual(plot.x + plot.w + 1e-6);
    }
    for (const node of geometry.scene.filter((n) => n.part === 'boxWhiskerCap')) {
      if (node.t !== 'line') throw new Error('cap is not a line');
      expect(node.x1).toBeGreaterThanOrEqual(plot.x - 1e-6);
      expect(node.x1).toBeLessThanOrEqual(plot.x + plot.w + 1e-6);
    }
    expect(geometry.scene.filter((n) => n.part === 'boxBeyond').length).toBe(2);
  });

  it('carries display truth on every mark', () => {
    const geometry = lay({ groups: [{ id: 'a', observations: [...ONE_TO_TEN, 400] }] });
    const parts = ['boxRect', 'boxMedian', 'boxWhisker', 'boxWhiskerCap', 'boxBeyond'];
    for (const part of parts) {
      const nodes = nodesOfPart(geometry, part);
      expect(nodes.length, part).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(node.display?.value, `${part} value`).toBeDefined();
        expect(node.display?.state, `${part} state`).toBe('box');
      }
    }
    const rect = geometry.scene.find((node) => node.id === 'box:rect:a');
    expect(rect?.display?.value).toBe('3.5–8.5');
  });
});

describe('box fail-closed behaviour', () => {
  it('throws when there is nothing to draw', () => {
    expect(() => lay({ groups: [] })).toThrow(NormalizeError);
    expect(() => lay({ groups: [{ id: 'a', observations: [] }] })).toThrow(
      /cannot be drawn from zero observations/,
    );
    try {
      lay({ groups: [{ id: 'a', observations: [] }] });
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as NormalizeError).code).toBe('empty-data');
    }
  });

  it('keeps an empty group as a row and marks it, rather than dropping it', () => {
    const geometry = lay({
      groups: [
        { id: 'a', observations: ONE_TO_TEN },
        { id: 'gone', observations: [] },
      ],
    });
    expect(codes(geometry)).toContain('box-empty-group');
    expect(geometry.derived.groupOrder).toEqual(['a', 'gone']);
    expect(geometry.marks.rows.map((row) => row.state)).toEqual(['box', 'empty']);
    const n = geometry.labels.find((label) => label.id === 'boxN:gone');
    expect(n?.text).toBe('n = 0 · no observations');
    expect(n?.hidden).toBeUndefined();
  });

  it('draws observations instead of invented quartiles below n = 5', () => {
    const geometry = lay({ groups: [{ id: 'tiny', observations: [4, 9, 21] }] });
    expect(codes(geometry)).toContain('box-small-n');
    expect(nodesOfPart(geometry, 'boxRect')).toEqual([]);
    expect(nodesOfPart(geometry, 'boxObservation').length).toBe(3);
    expect(geometry.labels.find((label) => label.id === 'boxN:tiny')?.text).toBe(
      'n = 3 · observations shown',
    );
    const none = lay(
      { groups: [{ id: 'tiny', observations: [4, 9, 21] }, { id: 'big', observations: ONE_TO_TEN }] },
      { showObservations: 'none' },
    );
    expect(nodesOfPart(none, 'boxObservation')).toEqual([]);
    expect(none.labels.find((label) => label.id === 'boxN:tiny')?.text).toBe('n = 3 · too few for a box');
  });

  it('draws the median alone when the IQR is zero, and says so', () => {
    const geometry = lay({ groups: [{ id: 'flat', observations: [8, 8, 8, 8, 8, 8] }] });
    expect(codes(geometry)).toContain('box-zero-iqr');
    expect(nodesOfPart(geometry, 'boxRect')).toEqual([]);
    expect(nodesOfPart(geometry, 'boxMedian').length).toBe(1);
    expect(geometry.labels.find((label) => label.id === 'boxN:flat')?.text).toBe('n = 6 · IQR = 0');
  });

  it('warns when the outliers are switched off, and not about the opt-in method note', () => {
    // the method note is opt-in, so leaving it off is the default and
    // says nothing.
    expect(codes(lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] }))).not.toContain('box-method-hidden');
    const hidden = lay({ groups: [{ id: 'a', observations: [...ONE_TO_TEN, 400] }] }, { showOutliers: false });
    expect(codes(hidden)).toContain('box-outliers-hidden');
    expect(nodesOfPart(hidden, 'boxBeyond')).toEqual([]);
    // the outlier is still in the receipt even though it is not painted
    expect(hidden.derived.groups[0]!.beyondWhiskers).toEqual([400]);
  });

  it('warns when labels are off, because n is mandatory furniture', () => {
    const geometry = lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] }, { labels: false });
    expect(codes(geometry)).toContain('box-n-hidden');
    expect(geometry.labels.filter((label) => label.id.startsWith('boxN:'))).toEqual([]);
  });

  it('flags an outlier flood only under the rule that claims to bound it', () => {
    const flooded = [...Array.from({ length: 20 }, (_, i) => 10 + (i % 3)), 90, 91, 92];
    expect(codes(lay({ groups: [{ id: 'a', observations: flooded }] }))).toContain('box-outlier-flood');
    expect(codes(lay({ groups: [{ id: 'a', observations: flooded }] }, { whiskers: 'p10p90' }))).not.toContain(
      'box-outlier-flood',
    );
  });
});

describe('box contract surfaces', () => {
  it('rejects pre-computed summaries and non-finite observations at the schema', () => {
    expect(boxDataSchema.safeParse({ groups: [{ id: 'a', observations: [1, 2, 3] }] }).success).toBe(true);
    // REFUSED, not stripped. A caller who sends q1/median/q3 believes the chart
    // will use them; silently deleting the keys and drawing different quartiles
    // is the failure mode this product exists to remove.
    const hallucinated = boxDataSchema.safeParse({
      groups: [{ id: 'a', q1: 1, median: 2, q3: 3, observations: [1, 2, 3] }],
    });
    expect(hallucinated.success).toBe(false);
    const issues = hallucinated.success ? '' : JSON.stringify(hallucinated.error.issues);
    for (const key of ['q1', 'median', 'q3']) expect(issues).toContain(key);
    // and the refusal reaches the caller through normalize with a path
    let thrown: { code?: string; path?: string; message?: string } = {};
    try {
      boxDefinition.normalize!({ groups: [{ id: 'a', median: 2, observations: [1, 2, 3] }] });
    } catch (error) {
      thrown = error as { code?: string; path?: string; message?: string };
    }
    expect(thrown.code).toBe('invalid-data');
    expect(boxDataSchema.safeParse({ groups: [{ id: 'a', observations: [1, null] }] }).success).toBe(false);
    expect(boxDataSchema.safeParse({ groups: [{ id: 'a', observations: [1, Infinity] }] }).success).toBe(false);
    expect(boxDataSchema.safeParse({ groups: [] }).success).toBe(false);
  });

  it("names the accepted values when an agent hallucinates a whisker rule", () => {
    const parsed = boxDefinition.optionsSchema.safeParse({ whiskers: '1.5iqr' });
    expect(parsed.success).toBe(false);
    const message = parsed.success ? '' : JSON.stringify(parsed.error.issues);
    for (const option of ['tukey', 'minmax', 'p10p90']) {
      expect(message).toContain(option);
    }
  });

  it('emits one quartile claim triple and one count claim per group', () => {
    const geometry = lay({
      groups: [
        { id: 'a', observations: ONE_TO_TEN },
        { id: 'gone', observations: [] },
      ],
    });
    const claims = claimsForChart('box', geometry as never);
    expect(claims.map((claim) => claim.id)).toEqual([
      'box:q1:a',
      'box:median:a',
      'box:q3:a',
      'box:n:a',
      'box:q1:gone',
      'box:median:gone',
      'box:q3:gone',
      'box:n:gone',
    ]);
    expect(claims[0]!.output.raw).toBe(3.25);
    expect(claims[1]!.output.raw).toBe(5.5);
    expect(claims[2]!.output.raw).toBe(7.75);
    expect(claims[3]!.output.raw).toBe(10);
    expect(claims[4]!.output).toEqual({ raw: null, state: 'empty', displayed: '' });
    expect(claims[7]!.output.raw).toBe(0);
  });

  it('states the method on request, a non-Tukey rule always, and the receipt either way', () => {
    const geometry = lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] });
    expect(geometry.derived.method).toBe('type7+tukey1.5');
    // the full Tukey method is a method note; its one-line rule always prints.
    // The note is a method note: engine method notes print only on request (notes.show).
    const shown = lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] }, { notes: { show: ['note', 'disclosure', 'method'] } });
    const plain = renderSvg(shown as never, resolveTheme());
    expect(plain).toContain('Whiskers: 1.5 × IQR; circles: outliers beyond them.');
    expect(plain).not.toContain('type-7 quantiles');
    const svg = renderSvg(lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] }, { methodNote: true, notes: { show: ['note', 'disclosure', 'method'] } }) as never, resolveTheme());
    expect(svg).toContain('type-7 quantiles');
    expect(svg).toContain('1.5×IQR');
    expect(renderSvg(lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] }, { whiskers: 'minmax', notes: { show: ['note', 'disclosure', 'method'] } }) as never, resolveTheme()))
      .toContain('minimum and maximum');
  });

  it('is deterministic and palette-responsive without changing judgment semantics', () => {
    const data: BoxData = { groups: [{ id: 'a', observations: [...ONE_TO_TEN, 400] }] };
    const once = renderSvg(lay(data) as never, resolveTheme());
    const twice = renderSvg(lay(data) as never, resolveTheme());
    expect(once).toBe(twice);
    const atlantic = lay(data, { palette: 'atlantic' });
    expect(renderSvg(atlantic as never, resolveTheme())).not.toBe(once);
    expect(codes(atlantic)).not.toContain('palette-inapplicable');
  });
});

/**
 * Box labels, tails and method notes must describe the values a reader sees.
 */
describe('box labels and method notes', () => {
  const SALARY = 'salary-bands-p10p90';
  const fixtureOf = (id: string) => getFixtures(boxDefinition.type).find((f) => f.id === id)!;
  const layFixture = (id: string, extra: BoxOptions = {}) =>
    layoutBox(fixtureOf(id).data as BoxData, { ...(fixtureOf(id).options as BoxOptions), ...extra });
  type BoxGeometry = ReturnType<typeof layoutBox>;
  const pointsOf = (geometry: BoxGeometry, rowId?: string) =>
    geometry.scene.filter(
      (node): node is Extract<SceneNode, { t: 'circle' }> =>
        node.t === 'circle' &&
        (node.part === 'boxBeyond' || node.part === 'boxObservation') &&
        (rowId === undefined || node.owner.categoryId === rowId),
    );
  /** Every beyond-whisker value a row accounts for: its dots (×n where values repeat) plus its counted groups. */
  const accountedBeyond = (geometry: BoxGeometry, rowId: string) =>
    geometry.scene.reduce((sum, node) => {
      if (node.owner.categoryId !== rowId) return sum;
      const value = (node as { display?: { value?: string } }).display?.value ?? '';
      if (node.part === 'boxBeyondGroup') return sum + Number(/^(\d+) values/.exec(value)![1]);
      if (node.part === 'boxBeyond') return sum + Number(/\(×(\d+)\)/.exec(value)?.[1] ?? 1);
      return sum;
    }, 0);
  const footnoteText = (geometry: BoxGeometry) =>
    geometry.scene
      .filter((node) => node.t === 'text' && (node.part === 'footnote' || node.part === 'source'))
      .flatMap((node) => (node.t === 'text' ? node.lines : []))
      .join(' ');

  it('showOutliers:false leaves a printed trace of what it withheld', () => {
    const data: BoxData = {
      groups: [
        { id: 'a', observations: [...ONE_TO_TEN, 400, 420] },
        { id: 'b', observations: [...ONE_TO_TEN, 380] },
        { id: 'c', observations: ONE_TO_TEN },
      ],
    };
    const censored = lay(data, { showOutliers: false, notes: { show: ['note', 'disclosure', 'method'] } });
    // 1. the count reaches the machine channel
    expect(censored.derived.withheldBeyond).toEqual({ a: 2, b: 1 });
    // 2. and the printed exhibit: the n column of every affected row
    const nText = (id: string) => censored.labels.find((label) => label.id === `boxN:${id}`)!.text;
    expect(nText('a')).toBe('n = 12 · 2 not shown');
    expect(nText('b')).toBe('n = 11 · 1 not shown');
    expect(nText('c')).toBe('n = 10');
    // 3. and a footnote that names the total AND the axis consequence
    const svg = renderSvg(censored as never, resolveTheme());
    expect(svg).toContain('3 observations outside the whisker rule');
    expect(svg).toContain('excluded from the value axis');
    // 4. the trace survives methodNote: false — turning off a method statement
    //    must not turn off a disclosure that observations are missing
    expect(footnoteText(lay(data, { showOutliers: false, methodNote: false, notes: { show: ['note', 'disclosure', 'method'] } }))).toContain(
      'excluded from the value axis',
    );
    // 5. and it is silent when nothing was withheld
    expect(lay(data).derived.withheldBeyond).toEqual({});
    expect(footnoteText(lay(data, { notes: { show: ['note', 'disclosure', 'method'] } }))).not.toContain('excluded from the value axis');
  });

  it('no two point marks in a row are painted on top of each other', () => {
    for (const fixture of getFixtures(boxDefinition.type)) {
      const geometry = layFixture(fixture.id);
      const byRow = new Map<string, ReturnType<typeof pointsOf>>();
      for (const point of pointsOf(geometry)) {
        const key = String(point.owner.categoryId);
        byRow.set(key, [...(byRow.get(key) ?? []), point]);
      }
      for (const [rowId, points] of byRow) {
        const band = geometry.marks.rows.find((row) => row.id === rowId)!.rect;
        for (let i = 0; i < points.length; i += 1) {
          // every dot stays inside its own row band, so dodging never leaks
          expect(points[i]!.cy - points[i]!.r).toBeGreaterThanOrEqual(band.y - 1e-6);
          expect(points[i]!.cy + points[i]!.r).toBeLessThanOrEqual(band.y + band.h + 1e-6);
          for (let j = i + 1; j < points.length; j += 1) {
            const distance = Math.hypot(points[i]!.cx - points[j]!.cx, points[i]!.cy - points[j]!.cy);
            expect(distance, `${fixture.id}/${rowId}: ${points[i]!.id} vs ${points[j]!.id}`).toBeGreaterThanOrEqual(
              points[i]!.r + points[j]!.r,
            );
          }
        }
      }
    }
  });

  it('the shipped p10p90 tails separate instead of fusing into a chain', () => {
    // touching tail dots become one ring over their span with its
    // exact count, so the twelve outer-decile values stay countable.
    const geometry = layFixture(SALARY);
    expect(accountedBeyond(geometry, 'ic3')).toBe(12);
    const rings = geometry.scene.filter((node) => node.part === 'boxBeyondGroup' && node.owner.categoryId === 'ic3');
    expect(rings.length).toBeGreaterThan(0);
    expect(geometry.labels.filter((label) => label.id.startsWith('group:ic3:') && !label.hidden).map((label) => label.text)).toEqual(['6 values', '6 values']);
  });

  it('the median column uses one decimal convention', () => {
    for (const fixture of getFixtures(boxDefinition.type)) {
      const geometry = layFixture(fixture.id);
      const decimals = geometry.labels
        .filter((label) => label.id.startsWith('median:'))
        .map((label) => (label.text.split('.')[1] ?? '').length);
      expect(new Set(decimals).size, `${fixture.id}: ${decimals.join('/')}`).toBeLessThanOrEqual(1);
    }
    // the specific regression: 107 / 97.6 / 87.5 / 133 / 97.5 down one column
    const deal = layFixture('deal-size-by-region');
    expect(
      deal.derived.groupOrder.map((id) => deal.labels.find((label) => label.id === `median:${id}`)!.text),
    ).toEqual(['Median 97.6', '132.5', '106.5', '87.5', '97.5']);
  });

  it('the median tick stays legible on a highlighted (dark) box', () => {
    // The fixture does not highlight (a fill no key explains); the option still works.
    const geometry = layFixture('deal-size-by-region', { highlight: 'dach' });
    const median = (id: string) => geometry.scene.find((node) => node.id === `box:median:${id}`)!;
    const dach = median('dach');
    const nordics = median('nordics');
    const theme = resolveTheme();
    expect(dach.t === 'line' && paintColor(theme, dach.stroke)).toBe(theme.color.inkInverse);
    expect(nordics.t === 'line' && paintColor(theme, nordics.stroke)).toBe(theme.color.ink);
    // and the choice is a contrast fact, not a preference
    expect(contrastRatio(theme.color.inkInverse, theme.color.highlight)).toBeGreaterThan(
      contrastRatio(theme.color.ink, theme.color.highlight),
    );
    expect(contrastRatio(theme.color.ink, theme.color.neutralLight)).toBeGreaterThan(
      contrastRatio(theme.color.inkInverse, theme.color.neutralLight),
    );
  });

  it('a median label never covers its own row point marks', () => {
    const fixtures = getFixtures(boxDefinition.type);
    const widths = [420, 480, 560, 640, 720, 900];
    const heights = [200, 240, 280, 320, 405, 540];
    let sizesChecked = 0;
    for (const fixture of fixtures) {
      for (const width of widths) {
        for (const height of heights) {
          const geometry = layFixture(fixture.id, { size: { width, height } });
          sizesChecked += 1;
          for (const label of geometry.labels) {
            if (label.hidden || !label.id.startsWith('median:')) continue;
            for (const point of pointsOf(geometry, String(label.owner.categoryId))) {
              expect(
                rectsOverlap(label.rect, {
                  x: point.cx - point.r,
                  y: point.cy - point.r,
                  w: point.r * 2,
                  h: point.r * 2,
                }),
                `${fixture.id} ${width}x${height}: ${label.id} covers ${point.id}`,
              ).toBe(false);
            }
          }
        }
      }
    }
    expect(sizesChecked).toBe(fixtures.length * widths.length * heights.length);
    // and it holds when the reader PINS the label into the slot over the
    // tail dots (the shared solver allows same-owner overlap, so
    // the clearance has to live in the candidate rects)
    const pinned = layFixture(SALARY, { labelPlacements: { 'median:ic3': 'outsideHigh' } as never });
    const label = pinned.labels.find((entry) => entry.id === 'median:ic3')!;
    expect(label.hidden ?? false).toBe(false);
    for (const point of pointsOf(pinned, 'ic3')) {
      expect(
        rectsOverlap(label.rect, { x: point.cx - point.r, y: point.cy - point.r, w: point.r * 2, h: point.r * 2 }),
      ).toBe(false);
    }
  });

  it('no footnote line leaves the canvas, at any size', () => {
    const theme = resolveTheme();
    const footFont = { family: theme.type.family, ...theme.type.footnote };
    for (const fixture of getFixtures(boxDefinition.type)) {
      for (const size of ['dashboard', 'slide-16x9', 'slide-4x3', 'a4'] as const) {
        const geometry = layFixture(fixture.id, { size });
        let lines = 0;
        for (const node of geometry.scene) {
          if (node.t !== 'text' || (node.part !== 'footnote' && node.part !== 'source')) continue;
          for (const line of node.lines) {
            lines += 1;
            expect(
              // Measure at the font the line draws in: the frame may step the
              // footnote below the theme size, and it wraps at that size.
              node.x + defaultMeasurer(line, node.font ?? footFont).width,
              `${fixture.id}/${size}: "${line}"`,
            ).toBeLessThanOrEqual(geometry.size.width);
          }
        }
        expect(lines).toBeGreaterThan(0);
      }
    }
  });

  it('p10p90 never calls the outer deciles outliers', () => {
    const geometry = layFixture(SALARY, { notes: { show: ['note', 'disclosure', 'method'] } });
    expect(geometry.derived.beyondAreOutliers).toBe(false);
    expect(geometry.derived.beyondMeaning).toContain('not outliers');
    // no row is narrated as HAVING outliers; the only mention is the negation
    expect(geometry.a11y.desc).not.toMatch(/\d+ outliers/i);
    expect(geometry.a11y.desc).toContain('not outliers');
    expect(geometry.a11y.desc).toContain('outside the 10th–90th percentile range');
    expect(renderSvg(geometry as never, resolveTheme())).toContain('which are not outliers');
    // the group field is not named `outliers` either
    expect(Object.keys(geometry.derived.groups[0]!)).not.toContain('outliers');
    expect(geometry.derived.groups[0]!.beyondWhiskers.length).toBe(12);
    // …while tukey, which does define an outlier, still says so
    const tukey = layFixture('deal-size-by-region');
    expect(tukey.derived.beyondAreOutliers).toBe(true);
    expect(tukey.derived.beyondMeaning).toContain('1.5×IQR');
  });

  it('reports a density it could not resolve instead of painting it quietly', () => {
    const dense: BoxData = {
      groups: [
        {
          id: 'a',
          observations: [
            ...Array.from({ length: 200 }, (_, i) => 100 + i * 0.01),
            ...Array.from({ length: 40 }, (_, i) => 300 + i * 0.5),
          ],
        },
        { id: 'b', observations: Array.from({ length: 50 }, (_, i) => 100 + i * 0.02) },
        { id: 'c', observations: Array.from({ length: 50 }, (_, i) => 100 + i * 0.02) },
      ],
    };
    const geometry = lay(dense, { size: { width: 420, height: 300 } });
    // the dense tail is grouped and counted rather than painted as a
    // blob; nothing was dropped: every beyond-whisker value is accounted for.
    expect(geometry.scene.some((node) => node.part === 'boxBeyondGroup')).toBe(true);
    expect(accountedBeyond(geometry, 'a')).toBe(geometry.derived.groups[0]!.beyondWhiskers.length);
  });
});

describe('box readability', () => {
  it("boxValues 'all' prints the quartiles and whisker ends as numbers", () => {
    const geometry = lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] }, { boxValues: 'all', size: { width: 800, height: 300 } });
    const stats = geometry.labels.filter((label) => label.id.startsWith('stat:a:') && !label.hidden).map((label) => label.id.split(':')[2]).sort();
    expect(stats).toEqual(['q1', 'q3', 'whiskerHigh', 'whiskerLow']);
    expect(lay({ groups: [{ id: 'a', observations: ONE_TO_TEN }] }).labels.some((label) => label.id.startsWith('stat:'))).toBe(false);
  });

  it('a group too small for a box prints each observation', () => {
    const geometry = lay({ groups: [{ id: 'big', observations: ONE_TO_TEN }, { id: 'small', observations: [4, 9, 21] }] });
    expect(geometry.labels.filter((label) => label.id.startsWith('obs:small:') && !label.hidden).map((label) => label.text).sort()).toEqual(['21.0', '4.0', '9.0']);
  });

  it('the filled highlighted box is named in a note', () => {
    const svg = renderSvg(lay({ groups: [{ id: 'a', label: 'Alpha', observations: ONE_TO_TEN }, { id: 'b', observations: ONE_TO_TEN }] }, { highlight: ['a'], notes: { show: ['note', 'disclosure', 'method'] } }) as never, resolveTheme());
    expect(svg).toContain('Filled box: Alpha, highlighted.');
  });
});
