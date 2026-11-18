import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { render } from '../src/cli/render';
import type { BulletOptions } from '../src/core/types/options';
import type { Geometry } from '../src/core/types/scene';

const ladder = getFixtures('bullet').find((fixture) => fixture.id === 'four-band-neutral-ladder')!;
const draw = (options: BulletOptions): Geometry => {
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: ladder.data, options: { ...ladder.options, ...options } }));
  if (geometry.refused) throw new Error('refused');
  return geometry;
};
const texts = (geometry: Geometry, prefix: string) => geometry.scene.flatMap((node) => (node.t === 'text' && node.id.startsWith(prefix) ? [node] : []));
const heads = (geometry: Geometry) => texts(geometry, 'label:header:');
const label = (geometry: Geometry, id: string) => geometry.labels.find((placed) => placed.id === id && !placed.hidden);

describe('bullet target and gap columns', () => {
  // Different rounding of a value, target and gap made the printed subtraction disagree and gave zero a sign.
  it('prints each row and its gap at one precision and treats a printed zero as on target', () => {
    const data = { rows: [
      { id: 'ratio', label: 'Ratio', value: 2.6, target: 2.25 },
      { id: 'above', label: 'Above', value: { number: 10.04, format: '1.1' }, target: 10 },
      { id: 'below', label: 'Below', value: { number: 9.96, format: '1.1' }, target: 10 },
      { id: 'rate', label: 'Rate', value: { pct: 6 }, target: { pct: 7.9 } },
    ] };
    for (const options of [{ labels: { position: true } }, { targetColumns: false }, { sharedScale: 'percentOfTarget' }] as BulletOptions[]) {
      const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data,
        options: { size: { width: 1200, height: 500 }, ...options } }));
      if (geometry.refused) throw new Error('refused');
      expect(label(geometry, 'point:ratio')?.text).toBe('2.60'); // Default number rule: before "2.6".
      const target = options.sharedScale === 'percentOfTarget' ? 'target:' : 'target-value:';
      expect(label(geometry, `${target}ratio`)?.text).toContain('2.25'); // Default number rule: before "2.3".
      const suffix = options.targetColumns === false ? ' vs target' : '';
      expect(label(geometry, 'delta:ratio')?.text).toBe(`+0.35${suffix}`); // Default number rule: before "+0.3".
      expect(label(geometry, 'point:rate')?.text).toBe('6.0%');
      expect(label(geometry, `${target}rate`)?.text).toContain('7.9%');
      expect(label(geometry, 'delta:rate')?.text).toBe(`−1.9pp${suffix}`);
      for (const id of ['above', 'below']) {
        expect(label(geometry, `point:${id}`)?.text).toBe('10.0');
        expect(label(geometry, `delta:${id}`)?.text).toBe(`0.0${options.targetColumns === false ? ' on target' : ''}`);
        expect(geometry.annotations.find((annotation) => annotation.id === `delta-target:${id}`)?.tone).toBe('good');
        if (options.targetColumns !== false && options.sharedScale !== 'percentOfTarget') {
          expect(label(geometry, `gap-position:${id}`)?.text).toBe('on target');
        }
      }
      expect(geometry.derived).toMatchObject({ deltaVsTarget: { ratio: 0.35, above: 0.04, below: -0.04, rate: -1.9 } });
    }
  });

  // The engine's precision printed 0.108% and 0.112% alike ("on target"), and 0.0994% against 0.0995% as a gap ten times too large.
  it('prints an unformatted row at the precision that shows its gap', () => {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', options: { size: { width: 1200, height: 400 } }, data: { rows: [
      { id: 'retention', label: 'Retention', value: { pct: 0.108 }, target: { pct: 0.112 } },
      { id: 'uptime', label: 'Uptime', value: { pct: 0.0994 }, target: { pct: 0.0995 } },
    ] } }));
    if (geometry.refused) throw new Error('refused');
    expect(['point:retention', 'target-value:retention', 'delta:retention'].map((id) => label(geometry, id)?.text)).toEqual(['0.108%', '0.112%', '−0.004pp']);
    expect(['point:uptime', 'target-value:uptime', 'delta:uptime'].map((id) => label(geometry, id)?.text)).toEqual(['0.0994%', '0.0995%', '−0.0001pp']);
  });

  // A value and target in scientific notation printed their nonzero gap as "0.0000" beside "above target".
  it('prints a nonzero gap with its digits when the value and target are tiny', () => {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet',
      data: { rows: [{ id: 'rate', label: 'Rate', value: 0.00004, target: 0.00003 }] },
      options: { size: { width: 1200, height: 300 } } }));
    if (geometry.refused) throw new Error('refused');
    expect(label(geometry, 'delta:rate')?.text).toBe('+0.00001'); // Default number rule: before "+1.0 × 10⁻⁵".
  });

  // A reader had to find each target above its tick and read "−7 vs target" at the row end.
  it('prints the target and the gap under headed columns, in English and German', () => {
    const wide = draw({ size: { width: 1200, height: 620 } });
    expect(heads(wide).map((node) => node.lines[0])).toEqual(['Actual', 'Target', 'Gap to target']);
    expect(label(wide, 'target-value:coverage')?.lines).toEqual(['85%']);
    const german = draw({ size: { width: 1200, height: 620 }, locale: { language: 'de' } });
    expect(heads(german).map((node) => node.lines[0])).toEqual(['Ist', 'Ziel', 'Abweichung vom Ziel']);
  });

  // The gap must say which side of the target the value lies on, not only good or bad.
  it('prints the gap in its tone over a muted position line, with the row units', () => {
    const wide = draw({ size: { width: 1200, height: 620 }, labels: { position: true } });
    expect(label(wide, 'delta:coverage')).toMatchObject({ lines: ['−7pp'], ink: { token: 'bad' } });
    expect(label(wide, 'gap-position:coverage')).toMatchObject({ lines: ['below target'], ink: { token: 'inkMuted' } });
    expect(label(wide, 'gap-position:cost')).toMatchObject({ lines: ['above target'] });
  });

  // A direction line under every name made each row taller; the author who needs it asks for it.
  it('names each row direction in a muted line under the name only on request', () => {
    const plain = draw({ size: { width: 1200, height: 620 } });
    expect(plain.labels.filter((placed) => placed.id.startsWith('direction:'))).toEqual([]);
    expect(label(plain, 'category:coverage')?.lines).toEqual(['Coverage']);
    const named = draw({ size: { width: 1200, height: 620 }, labels: { direction: true } });
    expect(label(named, 'direction:coverage')).toMatchObject({ lines: ['higher is better'], ink: { token: 'inkMuted' } });
    expect(label(named, 'direction:cost')?.lines).toEqual(['lower is better']);
  });

  // Target and gap stood on the top line of a two-line text block, higher than the actual value on the same bar.
  it('centres the name and every number of a row on its bar, and hangs a line under one below it', () => {
    const data = { rows: [
      { id: 'north', label: 'North', value: 120, target: 99 },
      { id: 'south', label: 'South region with a long name that wraps', value: 90, target: 95, direction: 'lowerIsBetter' as const },
    ] };
    for (const labels of [undefined, { position: true, direction: true }]) {
      const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data, options: { size: { width: 720 }, ...(labels ? { labels } : {}) } }));
      if (geometry.refused) throw new Error('refused');
      for (const row of data.rows) {
        const bar = geometry.scene.find((node) => node.id === `bar:${row.id}`);
        if (bar?.t !== 'rect') throw new Error(row.id);
        const centre = bar.rect.y + bar.rect.h / 2;
        const middle = (id: string) => { const placed = label(geometry, id)!; return placed.rect.y + placed.rect.h / 2; };
        for (const id of ['category', 'point', 'target-value', 'delta']) expect(Math.abs(middle(`${id}:${row.id}`) - centre)).toBeLessThanOrEqual(0.5);
        const under = (line: string, over: string) => label(geometry, `${line}:${row.id}`)!.rect.y >= label(geometry, `${over}:${row.id}`)!.rect.y + label(geometry, `${over}:${row.id}`)!.rect.h;
        if (labels) expect(under('gap-position', 'delta')).toBe(true);
        if (labels) expect(under('direction', 'category')).toBe(true);
        else expect(label(geometry, `direction:${row.id}`)).toBeUndefined();
      }
      expect(label(geometry, 'category:south')!.lines).toHaveLength(2);
    }
  });

  // A row without a target printed "higher is better" and empty cells, so the reader saw advice with nothing to judge.
  it('prints the not-applicable glyph and no direction or position line on a row without a target', () => {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: { rows: [
      { id: 'north', label: 'North', value: 120, target: 99, bands: [94, { to: 104, label: 'Tolerance 94 to 104', tone: 'neutral' }] },
      { id: 'south', label: 'South', value: 90 },
    ] }, options: { unit: 'units', sharedScale: true, size: { width: 720 } } }));
    if (geometry.refused) throw new Error('refused');
    expect(['target-na:south', 'gap-na:south'].map((id) => label(geometry, id)?.lines)).toEqual([['n/a'], ['n/a']]);
    expect(geometry.labels.filter((placed) => /^(direction|gap-position):/.test(placed.id))).toEqual([]);
    const asked = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: { rows: [{ id: 'a', label: 'A', value: 5, target: 6 }, { id: 'b', label: 'B', value: 4 }] },
      options: { size: { width: 720 }, labels: { direction: true } } }));
    if (asked.refused) throw new Error('refused');
    expect(label(asked, 'direction:a')?.lines).toEqual(['higher is better']);
    expect(label(asked, 'direction:b')).toBeUndefined();
  });

  // The columns must give way where they would squeeze the plot, never refuse a size main draws.
  it('shows the columns down to the width they fit, and below it keeps the stacked cards of main', () => {
    expect(heads(draw({ size: { width: 520 } }))).toHaveLength(3);
    const narrow = draw({ size: { width: 480 } });
    expect(heads(narrow)).toEqual([]);
    expect(label(narrow, 'delta:coverage')?.lines).toEqual(['−7pp vs target']);
    expect(label(narrow, 'target-value:coverage')?.lines).toEqual(['target 85%']);
  });

  // A long value label once hid the target value, and a bottom key once pulled the heads under the chart.
  it('falls back before a label hides, and keeps the heads above the rows under a bottom key', () => {
    const long = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: { rows: [{ id: 'a', label: 'A', value: { number: 78, label: 'Revenue from subscriptions' }, target: 85, bands: [{ to: 100 }] }] }, options: { size: { width: 650, height: 200 }, legend: 'none' } }));
    if (long.refused) throw new Error('refused');
    expect(long.labels.filter((placed) => placed.hidden)).toEqual([]);
    const bottom = draw({ size: { width: 1200, height: 620 }, legend: { position: 'bottom' }, bandKey: 'labels' });
    const bottomHeads = heads(bottom);
    expect(bottomHeads).toHaveLength(3);
    expect(bottomHeads.every((node) => node.y < bottom.plot.y)).toBe(true);
  });

  // An author whose page already lists the targets keeps the full plot width.
  it('keeps the old rows with targetColumns false', () => {
    expect(render({ spec: { type: 'bullet', data: ladder.data, options: { targetColumns: false } }, format: 'svg' }).exit).toBe(0);
    const off = draw({ size: { width: 1200, height: 620 }, targetColumns: false });
    expect(heads(off)).toEqual([]);
    expect(label(off, 'delta:coverage')?.lines).toEqual(['−7pp vs target']);
    expect(label(off, 'direction:coverage')).toBeUndefined();
  });

  // An author could not change or translate the column words: the schema refused the keys.
  it('takes the column and gap words from strings, and prints German words in a German chart', () => {
    const words = { targetColumn: 'Plan', gapColumn: 'Distance', gapBelow: 'short of {v1}', gapAbove: 'beyond {v1}' };
    const wide = draw({ size: { width: 1200, height: 620 }, strings: words, labels: { position: true } });
    expect(heads(wide).map((node) => node.lines[0])).toEqual(['Actual', 'Plan', 'Distance']);
    expect(label(wide, 'gap-position:coverage')?.lines).toEqual(['short of target']);
    expect(label(wide, 'gap-position:cost')?.lines).toEqual(['beyond target']);
    const percent = (extra: BulletOptions) => draw({ size: { width: 900 }, sharedScale: 'percentOfTarget', ...extra });
    const heads2 = (geometry: Geometry) => texts(geometry, 'label:header:').map((node) => node.lines[0]);
    expect(heads2(percent({ strings: { actualColumn: 'Now', shareColumn: 'Share of {v1}', deltaColumn: 'Off {v1}' } }))).toEqual(['Now', 'Share of target', 'Off target']);
    // An authored head equal to the built-in word still beats the authored comparison word.
    expect(heads(draw({ size: { width: 1200, height: 620 }, strings: { target: 'plan', targetColumn: 'Target' } }))[1]?.lines[0]).toBe('Target');
    // Every column word has a German form, so no English word is left in a German chart.
    const german = [draw({ size: { width: 1200, height: 620 }, locale: { language: 'de' }, labels: { position: true, direction: true } }), percent({ locale: { language: 'de' } })];
    const printed = german.flatMap((geometry) => geometry.labels.filter((placed) => /^(header|gap-position|direction):/.test(placed.id)).flatMap((placed) => placed.lines)).join(' ');
    expect(printed).not.toMatch(/\b(Target|Gap|Actual|below|above|better)\b/);
  });

  // A head drawn straight into the scene never met the label solver: it could not be cut or hidden by the same rules.
  it('places the column heads as labels and cuts a head that is far wider than its column', () => {
    const wide = draw({ size: { width: 1200, height: 620 } });
    expect(wide.labels.filter((placed) => placed.id.startsWith('header:')).map((placed) => [placed.id, !placed.hidden])).toEqual([['header:0:actual', true], ['header:1:target', true], ['header:2:gap', true]]);
    const long = draw({ size: { width: 1200, height: 620 }, strings: { gapColumn: 'Distance from the plan value for the whole fiscal year' } });
    const head = long.labels.find((placed) => placed.id === 'header:2:gap')!;
    expect(head.hidden).toBeFalsy();
    expect(head.lines[0]).toMatch(/…$/);
    expect(long.scene.find((node) => node.t === 'text' && node.id === 'label:header:2:gap')).toMatchObject({ title: 'Distance from the plan value for the whole fiscal year', part: 'tableHeader' });
    // Heads on the top edge of a chart without a top margin stay on the canvas, in both layouts.
    expect(heads(draw({ size: { width: 1200, height: 620 }, margin: { top: 0 } }))).toHaveLength(3);
    expect(draw({ size: { width: 900 }, sharedScale: 'percentOfTarget', margin: { top: 0 } }).labels.filter((placed) => placed.id.startsWith('header:') && !placed.hidden)).toHaveLength(3);
    const percent = draw({ size: { width: 900 }, sharedScale: 'percentOfTarget' });
    expect(percent.labels.filter((placed) => placed.id.startsWith('header:')).map((placed) => placed.lines[0])).toEqual(['Actual', '% of target', 'vs target']);
  });

  // The ladder example showed "40" and "78" where its data are percents and dollars.
  it('gives the ladder example the formats its data mean', () => {
    const wide = draw({ size: { width: 1200, height: 620 } });
    expect(label(wide, 'point:coverage')?.lines).toEqual(['78%']);
    expect(label(wide, 'point:cost')?.lines).toEqual(['$32']);
  });

  // An authored target word heads its column as written, so "plan" printed in lower case over capitalised heads.
  it('capitalises an authored target word in the column head', () => {
    const wide = draw({ size: { width: 1200, height: 620 }, strings: { target: 'plan' } });
    expect(heads(wide).map((node) => node.lines[0])).toEqual(['Actual', 'Plan', 'Gap to plan']);
  });
});
