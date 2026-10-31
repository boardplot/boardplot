/**
 * data honesty (src/core/dataGaps.ts): a chart never prints incomplete or
 * non-additive data as complete, and never leaves a slice or a stage unnamed.
 * Missing values must stay distinct from zero and leave a visible explanation.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getChart } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import { SceneRenderer } from '../src/react/SceneRenderer';
import { interactionRecords } from '../src/core/a11y/records';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { render } from '../src/cli/render';
import { claimsForChart } from '../src/core/claims';
import { chartReading } from '../src/core/reading';
import type { Geometry, LintWarning } from '../src/core/types/scene';
import { noteTexts } from './helpers/notes';
import { solveLabels, type LabelRequest } from '../src/core/label/solver';
import { createOccupiedIndex } from '../src/core/label/occupied';
import { measureText } from '../src/core/text';
import type { StatusDerived, StatusMarks } from '../src/core/charts/status/layout';

function lay(type: string, data: unknown, options: Record<string, unknown> = {}): Geometry {
  const definition = getChart(type)!;
  const result = definition.layout(data as never, { ...definition.defaults, title: 't', ...options } as never);
  if (result.refused) throw new Error(result.warnings[0]!.message);
  return result as Geometry;
}
const texts = (g: Geometry): string[] => g.scene.flatMap((n) => (n.t === 'text' ? [n.lines.join(' ')] : []));
const codes = (g: Geometry): string[] => g.warnings.map((w: LintWarning) => w.code);
const cats2 = [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }];
const partial = { categories: cats2, series: [{ id: 'a', label: 'A', values: [60, 50] }, { id: 'b', label: 'B', values: [null, 50] }] };

// A valid state named none must not inflate the missing count or share its legend and claim identity.
it('counts authored none states separately from missing status cells', () => {
  for (const missing of [false, true]) {
    const data = { rows: [{ id: 'row' }], columns: [{ id: 'bound' }, ...(missing ? [{ id: 'empty' }] : [])],
      cells: [{ row: 'row', col: 'bound', state: 'none' }] };
    const result = lay('status', data, { states: [
      { id: 'none', label: 'Cleared', tone: 'good' }, { id: '_none', label: 'Queued', tone: 'neutral' },
    ], legend: 'top' });
    const counts = (result.derived as unknown as StatusDerived).stateCounts;
    expect(counts).toEqual([{ state: 'none', count: 1, displayed: 'Cleared 1' },
      ...(missing ? [{ state: '__none', count: 1, displayed: 'No status 1' }] : [])]);
    const marks = (result.marks as unknown as StatusMarks).cells;
    expect(marks.filter(mark => mark.missing)).toHaveLength(missing ? 1 : 0);
    const claims = claimsForChart('status', result);
    expect(claims.map(claim => claim.id)).toEqual(counts.map(count => `status:count:${count.state}`));
    expect(claims.every(claim => claim.inputs.length === 1 && claim.output.raw === 1)).toBe(true);
    expect(new Set(result.scene.map(node => node.id)).size).toBe(result.scene.length);
    expect(texts(result).filter(text => text === 'Cleared')).toHaveLength(1);
    expect(texts(result).filter(text => text === 'No status')).toHaveLength(missing ? 1 : 0);
  }
});

describe('data gaps', () => {
  // A missing component cannot support an actual total or a gain/loss against a reference.
  it('withholds incomplete variance totals on every variance form', () => {
    const data = { categories: [{ id: 'missing' }, { id: 'zero' }, { id: 'complete' }], series: [
      { id: 'a', values: [60, 0, 60] }, { id: 'b', values: [null, 0, 40] },
      { id: 'plan', role: 'reference', values: [100, 100, 100] },
    ] };
    for (const variant of ['absolute', 'relative', 'integrated']) {
      const g = lay('variance', data, { variant, variance: { of: 'total', vs: 'plan' }, missingMark: 'dash' });
      expect(g.derived).toMatchObject({ ac: { missing: null, zero: 0, complete: 100 }, deltaAbs: { missing: null, zero: -100, complete: 0 }, deltaPct: { missing: null, zero: -100, complete: 0 } });
      expect(g.scene.find((n) => n.id === 'missing:missing')?.display?.state).toBe('missing');
      expect(g.scene.some((n) => n.owner.categoryId === 'missing' && n.part === 'bar')).toBe(false);
      expect(g.a11y.desc).toContain('missing n/a');
      const claims = claimsForChart('variance', g);
      for (const id of ['var:abs:missing', 'var:pct:missing']) expect(claims.find((c) => c.id === id)?.output).toMatchObject({ raw: null, state: 'missing' });
      const request = resolveChartRequest({ type: 'variance', data, options: { variant, variance: { of: 'total', vs: 'plan' } } } as never);
      const records = interactionRecords({ request, geometry: g, scope: request.scope, claims });
      expect(records.find((r) => r.target.owner?.categoryId === 'missing')?.comparisons[0]).toMatchObject({ current: { raw: null }, delta: { raw: null }, percent: { raw: null } });
      const reading = chartReading({ name: 'test', type: 'variance', request, geometry: g, claims });
      expect(reading.values.numbers).toBe(2);
      expect(reading.values.withoutNumber).toEqual([expect.objectContaining({ label: 'missing' })]);
    }
  });

  // A reference must keep isolated values visible and leave missing periods open unless the author requests a disclosed bridge.
  it('splits reference paths at missing periods and marks explicit bridges', () => {
    const categories = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    const draw = (interpolateGaps?: boolean) => lay('line', { categories, series: [
      { id: 'actual', values: [10, 20, 15, 20] },
      { id: 'plan', role: 'reference', values: [30, null, 40, 35], ...(interpolateGaps === undefined ? {} : { interpolateGaps }) },
    ] });
    const base = draw();
    expect(base.scene).toEqual(draw(false).scene);
    const path = base.scene.find((n) => n.part === 'referenceLine');
    expect(path?.t).toBe('path');
    if (path?.t !== 'path') throw new Error('missing reference path');
    expect(path.d.match(/L/g)).toHaveLength(1);
    expect(base.scene.some((n) => n.part === 'gapBridge')).toBe(false);
    const bridged = draw(true);
    expect(bridged.scene.find((n) => n.part === 'gapBridge')).toMatchObject({ stroke: path.stroke });
    expect(bridged.scene.filter((n) => n.part === 'gapMarker').map((n) => n.owner)).toEqual([{ seriesId: 'plan', categoryId: 'b' }]);

    for (const values of [[30, 35, 40, null, 50], [30, null, 40, null, 50]]) {
      const isolated = lay('line', {
        categories: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })),
        series: [
          { id: 'actual', values: [10, 20, 15, 20, 25] },
          { id: 'plan', role: 'reference', values },
        ],
      }, { size: { width: 800, height: 450 } });
      const markers = isolated.scene.filter((n) => n.part === 'marker' && n.owner.seriesId === 'plan');
      const expected = values[1] === null ? [['a', '30'], ['c', '40'], ['e', '50']] : [['e', '50']];
      expect(markers.map((n) => [n.owner.categoryId, n.display?.value])).toEqual(expected);
      for (const marker of markers) expect(marker).toMatchObject({ t: 'circle', r: 3, fill: path.stroke });
      expect(isolated.scene.filter((n) => n.part === 'referenceLine')).toHaveLength(values[1] === null ? 0 : 1);
      expect(isolated.scene.some((n) => n.part === 'gapBridge')).toBe(false);
    }
  });

  it('withholds the shares and totals of a composition with a missing part, and warns', () => {
    const shares = lay('column', partial, { variant: 'stacked100' });
    // A missing part prints nothing on a drawn column; no share of the known parts prints.
    expect(shares.labels.filter((l) => l.kind === 'segment' && l.owner.categoryId === 'q1').map((l) => l.text)).toEqual([]);
    expect(codes(shares)).toContain('incomplete-composition');
    // a stacked column prints the sum of its drawn parts as a plain total, since the note a
    // "(partial)" marker keys to is hidden by default; the notes list and one warning say what it lacks.
    const columnTotals = lay('column', partial, { variant: 'stacked' });
    expect(columnTotals.labels.filter((l) => l.kind === 'grandTotal').map((l) => l.lines ?? [l.text])).toEqual([['60'], ['100']]);
    expect(noteTexts(columnTotals)).toContain('Totals add the known parts only: Q1 without B.');
    expect(columnTotals.warnings.filter((w) => w.code === 'incomplete-composition')).toHaveLength(1);
    // Where disclosures print, the marker and the note naming it are back.
    const marked = lay('column', partial, { variant: 'stacked', notes: { show: ['disclosure'] } });
    expect(marked.labels.filter((l) => l.kind === 'grandTotal').map((l) => l.lines)).toEqual([['60', '(partial)'], ['100']]);
    expect(noteTexts(marked)).toContain('Totals marked (partial) add the known parts only: Q1 without B.');
    // a stack of one drawn part (the others null or 0) printed its number twice, in the segment and as the total.
    // also where a per-series format prints the part as "42.0" beside the total "42".
    for (const type of ['column', 'bar', 'combo']) for (const other of [null, 0]) for (const format of [undefined, '0.0']) {
      const plan = { categories: cats2, series: [{ id: 'old', kind: 'column', ...(format ? { format } : {}), values: [42, other] }, { id: 'new', kind: 'column', values: [other, 51] }] };
      const g = lay(type, plan, type === 'combo' ? {} : { variant: 'stacked', grandTotalLabels: true });
      expect(g.labels.filter((l) => !l.hidden && (l.kind === 'segment' || l.kind === 'grandTotal')).map((l) => `${l.kind} ${Number.parseFloat(l.text)}`)).toEqual(['grandTotal 42', 'grandTotal 51']);
    }
    // A segment label that prints more than the value (a series name, a share) lost it to the total on a one-part stack.
    // A zero part keeps the share known; a missing part withholds it, and the label prints the value alone.
    for (const type of ['column', 'combo']) for (const segment of [['series', 'absolute'], ['absolute', 'percent']]) {
      const plan = { categories: cats2, series: [{ id: 'old', kind: 'column', values: [42, 0] }, { id: 'new', kind: 'column', values: [0, 51] }] };
      const g = lay(type, plan, { ...(type === 'combo' ? {} : { variant: 'stacked', grandTotalLabels: true }), labels: { segment } });
      expect(g.labels.filter((l) => !l.hidden && l.kind === 'segment').map((l) => l.owner.categoryId).sort()).toEqual(['q1', 'q2']);
    }
    // since totals print on one line, two neighbouring totals on one row stood under 6 px from each other.
    // a total one stair step lower (less than half a line shared) is its own row and still prints.
    const daily = getFixtures('column').find((f) => f.id === 'stacked-missing-parts-daily')!;
    const row = lay('column', daily.data, { ...daily.options, size: { width: 320 } }).labels.filter((l) => l.kind === 'grandTotal' && !l.hidden).map((l) => l.rect!);
    for (const a of row) for (const b of row) {
      if (a !== b && a.x < b.x && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) >= Math.min(a.h, b.h) / 2) expect(b.x - (a.x + a.w)).toBeGreaterThanOrEqual(6);
    }
    // a one-line latest total reached two of its own lines over a 1.3 times taller neighbour, and went to the note.
    const lastPartial = structuredClone(daily.data) as { series: { values: (number | null)[] }[] };
    lastPartial.series[3]!.values[15] = null;
    lastPartial.series[0]!.values[14] = 8211;
    const latest = lay('column', lastPartial, { ...daily.options, size: { width: 400 } }).labels.find((l) => l.id === 'grandTotal:2025-03-18')!;
    expect(latest.hidden).toBeUndefined();
    // Half of one line, not of the box: two-line totals 15 px apart share 13 of 28 px, and the second line of one beside the first of the other read as one number.
    const plot = { x: 0, y: 0, w: 400, h: 300 };
    const twoLine = (id: string, x: number, y: number): LabelRequest => ({ id: `grandTotal:${id}`, kind: 'grandTotal', owner: { categoryId: id }, text: '100', lines: ['100', '(partial)'],
      font: { family: 'Inter', size: 12, weight: 400 }, priority: 900, candidates: [{ slot: 'aboveStack', rect: { x, y, w: 37, h: 28 }, penalty: 0 }] });
    const stair = solveLabels([twoLine('a', 100, 100), twoLine('b', 140, 115)], createOccupiedIndex(plot), { density: 'smart', pins: {}, measure: measureText, plot });
    expect(stair.placed.map((l) => l.hidden ?? 'shown')).toEqual(['shown', 'collision']);
    const flagged = getFixtures('combo').find((f) => f.id === 'option-anomaly-line')!;
    expect(lay('combo', flagged.data, { ...flagged.options, size: { width: 480 } }).labels.filter((l) => l.kind === 'grandTotal' && l.hidden)).toEqual([]);
    // a one-part segment too small for its value was named under "Values not printed", although its total prints it.
    const vals = [42, 8, 37, 3, 55, 12, 4, 61, 29, 6, 48, 2, 33, 71, 5, 40];
    const cats16 = vals.map((_, i) => ({ id: `c${i}`, label: `C${i + 1}` }));
    const alternating = { categories: cats16, series: [0, 1].map((side) => ({ id: `s${side}`, format: '0.0', values: vals.map((v, i) => (i % 2 === side ? v : null)) })) };
    const sliced = lay('column', alternating, { variant: 'stacked', grandTotalLabels: true, size: { width: 480 } });
    expect(sliced.labels.filter((l) => l.kind === 'grandTotal' && l.hidden)).toEqual([]);
    expect(noteTexts(sliced).join(' ')).not.toContain('not printed');
    // the sliver and too-wide warnings still named those one-part segments as not printed.
    for (const type of ['column', 'bar']) {
      const g = lay(type, alternating, { variant: 'stacked', grandTotalLabels: true, size: { width: 320, height: type === 'bar' ? 560 : 300 } });
      expect(codes(g).filter((code) => code === 'sliver-labels-hidden' || code === 'segment-labels-hidden')).toEqual([]);
    }
    // two case bars' equal totals stood 2 px apart and read as one number "120 120".
    const cases = getFixtures('waterfall').find((f) => f.id === 'two-case-budget-bridge')!;
    for (const width of [320, 480, 640]) {
      const [left, right] = lay('waterfall', getChart('waterfall')!.normalize!(cases.data), { ...cases.options, size: { width } }).labels
        .filter((l) => l.id.startsWith('total:fy25:') && !l.hidden).map((l) => l.rect!).sort((a, b) => a.x - b.x);
      expect(right!.x - (left!.x + left!.w)).toBeGreaterThanOrEqual(6 - 1e-9);
    }
    // The shift must not hide values: the Conservative step values at 320 px, and all but one of three FY25 totals.
    const conservative = lay('waterfall', getChart('waterfall')!.normalize!(cases.data), { ...cases.options, size: { width: 320 } }).labels
      .filter((l) => l.owner.seriesId === 'conservative' && l.id.startsWith('sum:') && !l.hidden).map((l) => l.text);
    expect(conservative.sort()).toEqual(['+3', '+5', '+8', '−9']);
    const three = { ...(cases.data as { cases: object[] }), cases: [...(cases.data as { cases: object[] }).cases, { id: 'mid', label: 'Middle' }],
      items: [{ id: 'fy25', label: 'FY25 budget', type: 'total', values: [120, 120, 121] }, { id: 'hiring', label: 'Hiring', values: [8, 18, 9] }, { id: 'media', label: 'Media', values: [5, 14, 6] },
        { id: 'tools', label: 'Tools', values: [3, 4, 4] }, { id: 'savings', label: 'Savings', values: [-9, -6, -8] }, { id: 'fy26', label: 'FY26 budget', type: 'total' }] };
    expect(lay('waterfall', getChart('waterfall')!.normalize!(three), { ...cases.options, size: { width: 800 } }).labels
      .filter((l) => l.id.startsWith('total:fy25:') && !l.hidden).map((l) => l.text)).toEqual(['120', '120', '121']);
    // a pinned one-part segment placed before its total, and both printed the value ("42.0" and "42").
    for (const type of ['column', 'bar', 'combo']) {
      const plan = { categories: cats2, series: [{ id: 'old', kind: 'column', format: '0.0', values: [42, null] }, { id: 'new', kind: 'column', values: [null, 51] }] };
      const g = lay(type, plan, { ...(type === 'combo' ? {} : { variant: 'stacked', grandTotalLabels: true }), labelPlacements: { 'segment:old:q1': 'insideMiddle' } });
      expect(g.labels.filter((l) => !l.hidden && l.owner.categoryId === 'q1' && (l.kind === 'segment' || l.kind === 'grandTotal')).map((l) => l.id)).toEqual(['segment:old:q1']);
    }
    // an authored cell text on a one-part stack printed twice, on the segment and on the total ("Peak 42.0" and "42").
    for (const type of ['column', 'bar', 'combo']) for (const pinned of [false, true]) {
      const plan = { categories: cats2, series: [{ id: 'old', kind: 'column', format: '0.0', values: [{ number: 42, label: 'Peak ${value}' }, null] }, { id: 'new', kind: 'column', values: [null, 51] }] };
      const g = lay(type, plan, { ...(type === 'combo' ? {} : { variant: 'stacked', grandTotalLabels: true }), ...(pinned ? { labelPlacements: { 'segment:old:q1': 'insideMiddle' } } : {}) });
      expect(g.labels.filter((l) => !l.hidden && l.owner.categoryId === 'q1' && (l.kind === 'segment' || l.kind === 'grandTotal')).map((l) => l.text)).toEqual(['Peak 42.0']);
    }
    // An authored zero cell beside the one part took over the total ("Zero 0") and hid the segment's 42.
    for (const type of ['column', 'bar']) {
      const plan = { categories: cats2, series: [{ id: 'old', values: [42, 30] }, { id: 'zero', values: [{ number: 0, label: 'Zero ${value}' }, 20] }] };
      const g = lay(type, plan, { variant: 'stacked', grandTotalLabels: true });
      expect(g.labels.filter((l) => !l.hidden && l.id === 'grandTotal:q1').map((l) => l.text)).toEqual(['42']);
    }
    // Combo hid the segment "Peak 42.0" behind a plain total "42" when the stack had a zero sibling.
    const zeroSibling = { categories: cats2, series: [{ id: 'old', kind: 'column', format: '0.0', values: [{ number: 42, label: 'Peak ${value}' }, 30] }, { id: 'new', kind: 'column', values: [0, 20] }] };
    expect(lay('combo', zeroSibling).labels.filter((l) => !l.hidden && l.owner.categoryId === 'q1' && (l.kind === 'segment' || l.kind === 'grandTotal')).map((l) => l.text)).toEqual(['Peak 42.0']);
    // A total that names its category ("Peak Q1") does not carry the value: the segment "Peak 42.0" was hidden and 42 printed nowhere.
    const named = { categories: cats2, series: [{ id: 'old', kind: 'column', format: '0.0', values: [{ number: 42, label: 'Peak ${value}' }, 30] }, { id: 'new', kind: 'column', values: [null, 51] }] };
    expect(lay('combo', named, { labels: { grandTotal: ['category'] } }).labels.filter((l) => !l.hidden && l.id === 'segment:old:q1').map((l) => l.text)).toEqual(['Peak 42.0']);
    const totals = lay('bar', partial, { variant: 'stacked', grandTotalLabels: true });
    expect(totals.labels.filter((l) => l.kind === 'grandTotal').map((l) => l.owner.categoryId)).toEqual(['q1', 'q2']);
    const pie = lay('pie', { categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [{ id: 's', values: [60, null, 40] }] });
    expect(codes(pie)).toContain('incomplete-composition');
    // A stack with no value at all has no total either, not a total of 0.
    const empty = { categories: cats2, series: [{ id: 'a', values: [null, 10] }, { id: 'b', values: [null, 20] }] };
    const emptyBar = lay('bar', empty, { variant: 'stacked' });
    expect(emptyBar.labels.filter((l) => l.kind === 'grandTotal').map((l) => l.owner.categoryId)).toEqual(['q2']);
    expect(emptyBar.derived).toMatchObject({ totals: { q2: 30 } });
    expect((emptyBar.derived as { totals: Record<string, number> }).totals).not.toHaveProperty('q1');
    // An empty row is n/a, not a partial composition, so it does not warn as one.
    expect(codes(emptyBar)).not.toContain('incomplete-composition');
    // The accessible description reads n/a for it, never a zero.
    expect(emptyBar.a11y.desc).toContain('Q1 n/a');
    expect(lay('column', empty, { variant: 'stacked' }).a11y.desc).toContain('Q1 n/a');
    // null for a part that does not apply made every total partial, and the advice never named 0.
    const absent = { categories: cats2, series: [{ id: 'a', values: [40, null] }, { id: 'b', values: [null, 55] }] };
    const advice = lay('column', absent, { variant: 'stacked', grandTotalLabels: true }).warnings.find((w) => w.code === 'incomplete-composition')?.suggest;
    expect(advice).toMatch(/^Every composition misses a part\. A component known to be zero there .* takes 0/);
  });

  it('keeps a missing funnel stage missing: no total, no conversion through it', () => {
    const data = { categories: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], series: [{ id: 's', values: [100, null, 40] }] };
    for (const layout of ['rows', 'centered']) {
      const g = lay('funnel', data, { layout });
      expect((g.derived as { stageTotals: Record<string, number | null> }).stageTotals.s2).toBeNull();
      expect((g.derived as { conversions: unknown[] }).conversions).toEqual([]);
      expect(codes(g)).toContain('missing-value');
      expect(texts(g).join(' ')).toContain('–');
    }
  });

  it('discloses printed shares that do not add to 100 without bending them', () => {
    const g = lay('pie', { categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [{ id: 's', values: [1, 1, 1] }] });
    expect(texts(g).filter((t) => t.includes('(33%)') || t.includes('· 33%'))).toHaveLength(3);
    expect(codes(g)).toContain('share-rounding-drift');
  });

  it("bends them on request: rounding 'sum-consistent' prints thirds as 33 + 33 + 34 and lists the moved one", () => {
    const g = lay('pie', { categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [{ id: 's', values: [1, 1, 1] }] }, { rounding: 'sum-consistent' });
    expect([texts(g).filter((t) => /(?:\(|· )(33|34)%/.test(t)).map((t) => /(?:\(|· )(\d+)%/.exec(t)![1]).sort(), (g.derived as { roundingAdjustments: unknown[] }).roundingAdjustments])
      .toEqual([['33', '33', '34'], [expect.objectContaining({ part: 'a', nearest: '33%', printed: '34%' })]]);
  });

  // A 100% stack moves printed shares by default and rescales parts that miss 100, and only reading.rounding told the reader.
  it('lists a hidden method note when a 100% stack moves or rescales shares', () => {
    const thirds = lay('column', { categories: [{ id: 'q' }], series: ['a', 'b', 'c'].map((id) => ({ id, values: [10] })) }, { variant: 'stacked100' });
    expect(noteTexts(thirds, ['method']).join(' ')).toContain('moved by one step');
    const shares = [59.6, 19.8, 10.7, 5.8, 4.3].map((value, i) => ({ id: `s${i}`, values: [value] }));
    const rescaled = lay('column', { categories: [{ id: 'q', label: 'Sep' }], series: shares }, { variant: 'stacked100', sharesOfOneWhole: true });
    expect(noteTexts(rescaled, ['method']).join(' ')).toContain('Sep: the authored parts do not add up to 100');
    expect(noteTexts(lay('column', { categories: [{ id: 'q' }], series: ['a', 'b'].map((id) => ({ id, values: [50] })) }, { variant: 'stacked100' }), ['method'])).toEqual([]);
  });

  it('omits a CAGR to a partial period and flags a diff that uses one', () => {
    const categories = [{ id: 'y1', label: '2022', date: '2022-12-31' }, { id: 'y2', label: '2023', date: '2023-12-31' }, { id: 'y3', label: '2024 YTD', date: '2024-12-31', partial: true }];
    const g = lay('column', { categories, series: [{ id: 'a', values: [100, 120, 70] }] }, {
      annotations: [{ kind: 'cagr' }, { kind: 'diff', from: 'y2', to: 'y3' }],
    });
    expect(texts(g).some((t) => t.includes('p.a.'))).toBe(false);
    expect(codes(g)).toEqual(expect.arrayContaining(['cagr-partial-period', 'partial-period-comparison']));
  });

  it('names every drawn pie slice when no legend is drawn, and keys only drawn slices', () => {
    const categories = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ id, label: `Name ${id}` }));
    const unkeyed = lay('pie', { categories, series: [{ id: 's', values: [1, 1, 1, 1, 1, 1] }] }, { topN: { n: 10 } });
    for (const c of categories) expect(texts(unkeyed).join(' ')).toContain(c.label);
    const keyed = lay('pie', { categories, series: [{ id: 's', values: [3, 0, 2, null, 1, 1] }] }, { legend: 'bottom' });
    expect(keyed.legend!.items.map((item) => item.id)).toEqual(['A', 'C', 'E', 'F']);
  });

  it('does not sum percentages in a table total, and warns on an authored sum', () => {
    const columns = [{ id: 'label', kind: 'rowLabel' }, { id: 'm', kind: 'value', format: '1.1%' }];
    const rows = [{ id: 't', label: 'Total', role: 'total', children: [{ id: 'a', label: 'A', cells: { m: 12.5 } }, { id: 'b', label: 'B', cells: { m: 8 } }] }];
    expect(texts(lay('table', { columns, rows }))).not.toContain('20.5%');
    const summed = lay('table', { columns: [columns[0], { ...columns[1], aggregate: 'sum' }], rows });
    expect(codes(summed)).toContain('aggregate-non-additive');
    // The parent's own percent format counts too: plain 8 and 10 are no 18.0%.
    const parentPercent = [{ id: 't', label: 'Total', format: '1.0%', children: [{ id: 'a', label: 'A', cells: { m: 8 } }, { id: 'b', label: 'B', cells: { m: 10 } }] }];
    expect(texts(lay('table', { columns: [columns[0], { id: 'm', kind: 'value' }], rows: parentPercent }))).not.toContain('18.0%');
  });

  // Summand rows that differ only in decimals ("$1.2m", "$1.23m") dropped the parent total to a dash, though they add up.
  it('adds a table parent over rows that differ only in decimals, not over rows in another unit', () => {
    const columns = [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }];
    const parent = (bFormat: string) => ({ columns, rows: [{ id: 'p', label: 'P', children: [
      { id: 'a', label: 'A', format: '$1.2m', cells: { v: 2_500_000 } }, { id: 'b', label: 'B', format: bFormat, cells: { v: 1_250_000 } }] }] });
    expect(texts(lay('table', parent('$1.23m')))).toContain('3.8M');
    expect(texts(lay('table', parent('$500k')))).not.toContain('3.8M');
  });

  it('lets a wrap: true text column take the lines it needs instead of the width', () => {
    // Two lines needed 925 px here.
    const note = 'This is an extremely long free-text comment that explains in painful detail why the number moved, including several sub-clauses, caveats and a reference to the appendix.';
    const g = lay('table', {
      columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', format: '1,234' }, { id: 'n', kind: 'text', wrap: true }],
      rows: [{ id: 'a', label: 'Austria and South Tyrol (including transition areas)', cells: { v: 5, n: note } }],
    }, { size: { width: 720, height: 405 } });
    expect(g.size.width).toBe(720);
  });

  it('reports dropped values, empty charts, ignored totals and averages, and hidden slivers', () => {
    const gaps = { categories: cats2, series: [{ id: 'a', values: [10, null] }, { id: 'b', values: [null, 5] }] };
    expect(codes(lay('dot', gaps))).toContain('missing-value');
    expect(codes(lay('butterfly', gaps, { a: 'a', b: 'b' }))).toContain('missing-value');
    expect(codes(lay('line', { categories: cats2, series: [{ id: 'a', values: [null, null] }] }))).toContain('no-plotted-values');
    expect(codes(lay('column', partial, { grandTotalLabels: true }))).toContain('grand-total-ignored');
    expect(codes(lay('bar', partial, { variant: 'stacked100', averageMarker: true }))).toContain('average-marker-ignored');
    const sliver = { categories: cats2, series: [{ id: 'a', values: [100, 100] }, { id: 'b', values: [1, 2] }] };
    expect(codes(lay('column', sliver, { variant: 'stacked' }))).toContain('sliver-labels-hidden');
    // a thin TOP band prints over its edge, so the withheld sliver is a lower one.
    const lowSliver = { categories: cats2, series: [{ id: 'b', values: [1, 2] }, { id: 'a', values: [100, 100] }] };
    expect(codes(lay('line', lowSliver, { variant: 'stacked-area', valueLabels: 'all' }))).toContain('sliver-labels-hidden');
    // An area drop has no seat a density or a pin could open, so the advice is room or a shorter value.
    expect(lay('line', lowSliver, { variant: 'stacked-area', valueLabels: 'all' }).warnings.find((w) => w.code === 'sliver-labels-hidden')?.suggest).toContain('widen');
  });
});

// a line that bridged its nulls drew the bridge solid and the missing points not at all.
describe('stack totals in the description', () => {
  const datedCats = [{ id: 'q1', label: 'Q1', date: '2024-12-31' }, { id: 'q2', label: 'Q2', date: '2025-12-31' }];
  const shares = { categories: cats2, series: [{ id: 'web', label: 'Web share %', values: [55, 60] }, { id: 'app', label: 'App share %', values: [30, 25] }] };
  const money = { categories: cats2, series: [{ id: 'web', label: 'Web', values: [55, 60] }, { id: 'app', label: 'App', values: [30, 25] }] };
  /** The SVG <desc>, checked against the React one. */
  const desc = (g: Geometry): string => {
    const text = (markup: string) => /<desc[^>]*>([^<]*)<\/desc>/.exec(markup)![1]!;
    const theme = resolveTheme();
    const svg = text(renderSvg(g, theme));
    expect(text(renderToStaticMarkup(createElement(SceneRenderer, { geometry: g, theme })))).toBe(svg);
    return svg;
  };
  const totals = (g: Geometry) => (g.derived as { stackTotals: Record<string, number> }).stackTotals;

  it('writes totals only for a stack whose parts add', () => {
    const grouped = lay('column', shares, { variant: 'grouped' });
    expect(desc(grouped)).not.toContain('Totals');
    expect(totals(grouped)).toEqual({});
    const undeclared = lay('column', shares, { variant: 'stacked' });
    expect(desc(undeclared)).not.toContain('Totals');
    expect(totals(undeclared)).toEqual({});
    const declared = lay('column', shares, { variant: 'stacked', sharesOfOneWhole: true });
    expect(desc(declared)).toContain('Totals: Q1 85, Q2 85.');
    expect(totals(declared)).toEqual({ q1: 85, q2: 85 });
    expect(desc(lay('column', money, { variant: 'stacked' }))).toContain('Totals: Q1 85, Q2 85.');
    const combo = lay('combo', { categories: cats2, series: shares.series.map((series) => ({ ...series, kind: 'column' })) });
    expect(desc(combo)).not.toContain('Column totals');
  });

  it('prints no total, hover share or anchored sum on screen for a stack that does not add', () => {
    const annotations = [{ kind: 'abs', at: 'q1' }, { kind: 'note', at: 'q2', text: 'Launch' }];
    /** Grand-total texts, the abs text, the note and the hover share of Web in Q1. */
    const onScreen = (type: string, data: unknown, options: Record<string, unknown>) => {
      const request = resolveChartRequest({ type, data, options: { title: 't', annotations, ...options } } as never);
      const geometry = layoutResolvedRequest(request) as Geometry;
      const shown = geometry.labels.filter((label) => !label.hidden);
      const record = interactionRecords({ request, geometry, scope: request.scope, claims: [] })
        .find((entry) => entry.target.owner?.seriesId === 'web' && entry.target.owner?.categoryId === 'q1');
      return {
        totals: shown.filter((label) => label.kind === 'grandTotal').map((label) => label.text),
        abs: shown.filter((label) => label.owner.annotationId === 'abs-1').map((label) => label.text),
        note: shown.some((label) => label.text === 'Launch'),
        share: record?.share?.percent.raw ?? null,
        dropped: geometry.warnings.some((warning) => warning.code === 'bad-anchor' && warning.message.includes('no total')),
      };
    };
    for (const type of ['column', 'bar']) {
      // The column total already prints this value, so its absolute annotation is redundant.
      const abs = type === 'column' ? [] : ['85'];
      expect(onScreen(type, shares, { variant: 'stacked' }), type).toEqual({ totals: [], abs: [], note: true, share: null, dropped: true });
      expect(onScreen(type, shares, { variant: 'stacked', sharesOfOneWhole: true }), type)
        .toMatchObject({ totals: ['85', '85'], abs, note: true, share: expect.closeTo(64.7, 1), dropped: false });
      expect(onScreen(type, money, { variant: 'stacked' }), type)
        .toMatchObject({ totals: ['85', '85'], abs, note: true, share: expect.closeTo(64.7, 1), dropped: false });
    }
    const comboShares = { categories: cats2, series: shares.series.map((series) => ({ ...series, kind: 'column' })) };
    expect(onScreen('combo', comboShares, {})).toMatchObject({ totals: [], abs: [], share: null, dropped: true });
    // An explicit request for totals on such a stack warns instead of printing a sum.
    const asked = lay('column', shares, { variant: 'stacked', grandTotalLabels: true });
    expect(asked.warnings.find((warning) => warning.code === 'grand-total-ignored')?.message).toContain('parts that add');
  });

  it('draws no mean over a stack that does not add, and names sharesOfOneWhole', () => {
    const annotations = [{ kind: 'valueLine', value: 'mean', label: 'Mean' }];
    for (const type of ['column', 'bar']) {
      const means = (data: unknown, extra: Record<string, unknown>) => {
        const g = lay(type, data, { variant: 'stacked', averageMarker: true, annotations, ...extra });
        return {
          // The Ø marker and the mean line, wherever their labels landed.
          lines: g.labels.filter((label) => label.kind === 'valueLine').length,
          warned: g.warnings.filter((w) => (w.code === 'average-marker-ignored' || w.code === 'no-mean') && w.suggest?.includes('sharesOfOneWhole')).map((w) => w.code).sort(),
        };
      };
      expect(means(shares, {}), type).toEqual({ lines: 0, warned: ['average-marker-ignored', 'no-mean'] });
      expect(means(shares, { sharesOfOneWhole: true }), type).toEqual({ lines: 2, warned: [] });
      expect(means(money, {}), type).toEqual({ lines: 2, warned: [] });
    }
  });

  it('gives a bar row totals only where the parts add, and no receipt for a total that is not one', () => {
    const rowSums = 'Q1 85, Q2 85';
    const barTotals = (g: Geometry) => (g.derived as { totals: Record<string, number> }).totals;
    const grouped = lay('bar', shares, { variant: 'grouped' });
    expect(desc(grouped)).not.toContain(rowSums);
    expect(barTotals(grouped)).toEqual({});
    const undeclared = lay('bar', shares, { variant: 'stacked' });
    expect(desc(undeclared)).not.toContain(rowSums);
    expect(barTotals(undeclared)).toEqual({});
    for (const [data, extra] of [[shares, { sharesOfOneWhole: true }], [money, {}]] as const) {
      const g = lay('bar', data, { variant: 'stacked', ...extra });
      expect(desc(g)).toContain(rowSums);
      expect(barTotals(g)).toEqual({ q1: 85, q2: 85 });
    }
    // The receipts: a CAGR between two stacks is derived from their totals, so it exists only where they add.
    // A printed stack total is a receipt too, also for shares of one whole (it printed with reading.derived empty).
    const receipts = (data: unknown, extra = {}) => (render({ spec: { type: 'bar', data, options: { title: 't', variant: 'stacked', ...extra },
      annotations: [{ kind: 'cagr', from: 'q1', to: 'q2' }] }, return: ['reading'] }).body as { reading: { derived: { op: string }[] } }).reading.derived.map((entry) => entry.op);
    expect(receipts({ ...shares, categories: datedCats })).toEqual([]);
    expect(receipts({ ...money, categories: datedCats })).toEqual(['sum@1', 'sum@1', 'annotation-cagr@1']);
    expect(receipts({ ...shares, categories: datedCats }, { sharesOfOneWhole: true })).toEqual(['sum@1', 'sum@1', 'annotation-cagr@1']);
    // The receipt adds the raw parts: the pie keeps its total rounded to two decimals (0.01, not 0.011).
    const pie = render({ spec: { type: 'pie', data: { categories: ['a', 'b'], series: [{ id: 's', values: [0.004, 0.007] }] }, options: { title: 't', doughnut: 0.5, format: '0.000' } },
      return: ['reading'] }).body as { reading: { derived: { value: number }[] } };
    expect(pie.reading.derived.map((entry) => entry.value)).toEqual([0.011]);
  });

  it('reports a category-level attainment band on such a stack as a value-less anchor, not an empty band', () => {
    const band = { kind: 'band', style: 'attainment', value: 80 };
    const bandWarnings = (data: unknown, options: Record<string, unknown>) =>
      lay('column', data, { variant: 'stacked', annotations: [band], ...options }).warnings
        .filter((warning) => warning.code === 'bad-anchor' || warning.code === 'band-attainment-empty');
    expect(bandWarnings(shares, {})).toMatchObject([{ code: 'bad-anchor', message: expect.stringContaining('no total'), suggest: expect.stringContaining('sharesOfOneWhole') }]);
    expect(bandWarnings(shares, { sharesOfOneWhole: true })).toEqual([]);
    expect(bandWarnings(money, {})).toEqual([]);
  });

  it('counts { pct } cells as stated in percent', () => {
    const pct = { categories: cats2, series: [{ id: 'web', label: 'Web', values: [{ pct: 55 }, { pct: 60 }] }, { id: 'app', label: 'App', values: [{ pct: 30 }, { pct: 25 }] }] };
    const undeclared = lay('column', pct, { variant: 'stacked' });
    expect(totals(undeclared)).toEqual({});
    expect(undeclared.labels.filter((label) => label.kind === 'grandTotal')).toEqual([]);
    expect(totals(lay('column', pct, { variant: 'stacked', sharesOfOneWhole: true }))).toEqual({ q1: 85, q2: 85 });
  });
});

describe('an empty category in a stack', () => {
  it('reads n/a once on the baseline, none on a drawn column, and stays out of the partial note', () => {
    const fixture = getFixtures('column').find((entry) => entry.id === 'stacked-empty-weeks')!;
    const g = lay('column', fixture.data, fixture.options as Record<string, unknown>);
    // Footer rule: the note is in the notes list, not drawn.
    expect(noteTexts(g)).toContain('Totals add the known parts only: W34 without Returning.');
    const na = (categoryId: string) => g.labels.filter((l) => l.id.startsWith('na:') && l.owner.categoryId === categoryId && !l.hidden).map((l) => l.id);
    expect([na('w31'), na('w32'), na('w34')]).toEqual([['na:w31'], ['na:w32'], []]);
    expect(g.warnings.find((w) => w.code === 'incomplete-composition')?.message).not.toMatch(/W31|W32/);
    // Bar twin: the empty row is n/a, not a partial row.
    const bar = lay('bar', fixture.data, fixture.options as Record<string, unknown>);
    expect(bar.warnings.find((w) => w.code === 'incomplete-composition')?.message).not.toMatch(/W31|W32/);
    expect(bar.scene.filter((n) => n.t === 'text' && n.part === 'nmMarker').map((n) => n.owner?.categoryId)).toEqual(['w31', 'w32']);
  });
});

describe('a blank category as an annotation anchor', () => {
  // A blank period was read as a total of 0, so a CAGR or a change printed -100% for data nobody has.
  it('prints no growth on a blank end, as a line does, and keeps a real 0', () => {
    const categories = ['2021', '2022', '2023', '2024'].map((id) => ({ id, date: `${id}-12-31` }));
    const grown = (type: string, last: number | null, more: Record<string, unknown> = {}) => {
      const series = [{ id: 'a', ...(type === 'combo' ? { kind: 'column' } : {}), values: [100, 110, 120, last] }];
      const g = lay(type, { categories, series }, { annotations: [{ kind: 'cagr', from: '2021', to: '2024' }], ...more });
      return {
        drawn: g.labels.some((label) => label.owner.annotationId === 'cagr-1' && !label.hidden),
        warned: g.warnings.some((warning) => warning.code === 'bad-anchor'),
        desc: g.a11y.desc,
      };
    };
    for (const type of ['column', 'bar', 'combo']) {
      expect(grown(type, null), type).toMatchObject({ drawn: false, warned: true });
      expect(grown(type, 0), type).toMatchObject({ drawn: true, warned: false });
    }
    expect(grown('column', null, { variant: 'stacked' })).toMatchObject({ drawn: false, warned: true });
    expect(grown('combo', null).desc).toContain('2024 n/a');
    // A mekko column with an unknown part has no total, so it has no change either and the description omits it.
    const mekko = lay('mekko', { categories: ['A', 'B'], series: [{ id: 'x', values: [100, 120] }, { id: 'y', values: [100, null] }] },
      { annotations: [{ kind: 'diff', from: 'A', to: 'B', mode: 'relative' }] });
    expect(mekko.warnings.some((warning) => warning.code === 'bad-anchor')).toBe(true);
    expect(mekko.labels.some((label) => label.owner.annotationId === 'diff-1' && !label.hidden)).toBe(false);
    expect(mekko.a11y.desc).toContain('Totals: A 200.');
  });
});

describe('bridged gaps on a line', () => {
  it('dash the bridge and ring each missing point', () => {
    const categories = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    const geometry = lay('line', { categories, series: [{ id: 's', label: 'S', values: [1, null, null, 4], interpolateGaps: true }] });
    const bridge = geometry.scene.find((node) => node.part === 'gapBridge');
    const rings = geometry.scene.filter((node) => node.part === 'gapMarker').map((node) => node.owner.categoryId);
    expect([bridge?.t === 'path' && bridge.dash !== undefined, rings]).toEqual([true, ['b', 'c']]);
  });
});

// beside an n.m. category, the one valid 100% category drew nothing but two loose shares.
describe('a lone valid 100% category', () => {
  it('stands as a short stacked column with its shares on it, and a note says why its neighbour is withheld', () => {
    const categories = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    const geometry = lay('line', { categories, series: [{ id: 's1', label: 'S1', values: [60, 40] }, { id: 's2', label: 'S2', values: [-20, 60] }] }, { variant: 'stacked100-area', valueLabels: 'all' });
    const columns = geometry.scene.filter((node) => node.part === 'segment' && node.owner.categoryId === 'b');
    // Footer rule: the note is in the notes list, not drawn.
    const note = noteTexts(geometry).some((text) => text.startsWith('A: n.m.'));
    expect([columns.length, note]).toEqual([2, true]);
  });
});
