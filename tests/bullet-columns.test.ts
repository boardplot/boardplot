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
  // A reader had to find each target above its tick and read "−7 vs target" at the row end.
  it('prints the target and the gap under headed columns, in English and German', () => {
    const wide = draw({ size: { width: 1200, height: 620 } });
    expect(heads(wide).map((node) => node.lines[0])).toEqual(['Target', 'Gap to target']);
    expect(label(wide, 'target-value:coverage')?.lines).toEqual(['85%']);
    const german = draw({ size: { width: 1200, height: 620 }, locale: { language: 'de' } });
    expect(heads(german).map((node) => node.lines[0])).toEqual(['Ziel', 'Abweichung vom Ziel']);
  });

  // The gap must say which side of the target the value lies on, not only good or bad.
  it('prints the gap in its tone over a muted position line, with the row units', () => {
    const wide = draw({ size: { width: 1200, height: 620 } });
    expect(label(wide, 'delta:coverage')).toMatchObject({ lines: ['−7pp'], ink: { token: 'bad' } });
    expect(label(wide, 'gap-position:coverage')).toMatchObject({ lines: ['below target'], ink: { token: 'inkMuted' } });
    expect(label(wide, 'gap-position:cost')).toMatchObject({ lines: ['above target'] });
  });

  // Mixed-direction rows read their tones only when each row says which way is better.
  it('names each row direction in a muted line under the name', () => {
    const wide = draw({ size: { width: 1200, height: 620 } });
    expect(label(wide, 'direction:coverage')).toMatchObject({ lines: ['higher is better'], ink: { token: 'inkMuted' } });
    expect(label(wide, 'direction:cost')?.lines).toEqual(['lower is better']);
    expect(label(wide, 'category:coverage')?.lines).toEqual(['Coverage']);
  });

  // The columns must give way where they would squeeze the plot, never refuse a size main draws.
  it('shows the columns down to the width they fit, and below it keeps the stacked cards of main', () => {
    expect(heads(draw({ size: { width: 520 } }))).toHaveLength(2);
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
    expect(bottomHeads).toHaveLength(2);
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
    const wide = draw({ size: { width: 1200, height: 620 }, strings: words });
    expect(heads(wide).map((node) => node.lines[0])).toEqual(['Plan', 'Distance']);
    expect(label(wide, 'gap-position:coverage')?.lines).toEqual(['short of target']);
    expect(label(wide, 'gap-position:cost')?.lines).toEqual(['beyond target']);
    const percent = (extra: BulletOptions) => draw({ size: { width: 900 }, sharedScale: 'percentOfTarget', ...extra });
    const heads2 = (geometry: Geometry) => texts(geometry, 'label:header:').map((node) => node.lines[0]);
    expect(heads2(percent({ strings: { actualColumn: 'Now', shareColumn: 'Share of {v1}', deltaColumn: 'Off {v1}' } }))).toEqual(['Now', 'Share of target', 'Off target']);
    // An authored head equal to the built-in word still beats the authored comparison word.
    expect(heads(draw({ size: { width: 1200, height: 620 }, strings: { target: 'plan', targetColumn: 'Target' } }))[0]?.lines[0]).toBe('Target');
    // Every column word has a German form, so no English word is left in a German chart.
    const german = [draw({ size: { width: 1200, height: 620 }, locale: { language: 'de' } }), percent({ locale: { language: 'de' } })];
    const printed = german.flatMap((geometry) => geometry.labels.filter((placed) => /^(header|gap-position|direction):/.test(placed.id)).flatMap((placed) => placed.lines)).join(' ');
    expect(printed).not.toMatch(/\b(Target|Gap|Actual|below|above|better)\b/);
  });

  // A head drawn straight into the scene never met the label solver: it could not be cut or hidden by the same rules.
  it('places the column heads as labels and cuts a head that is far wider than its column', () => {
    const wide = draw({ size: { width: 1200, height: 620 } });
    expect(wide.labels.filter((placed) => placed.id.startsWith('header:')).map((placed) => [placed.id, !placed.hidden])).toEqual([['header:0:target', true], ['header:1:gap', true]]);
    const long = draw({ size: { width: 1200, height: 620 }, strings: { gapColumn: 'Distance from the plan value for the whole fiscal year' } });
    const head = long.labels.find((placed) => placed.id === 'header:1:gap')!;
    expect(head.hidden).toBeFalsy();
    expect(head.lines[0]).toMatch(/…$/);
    expect(long.scene.find((node) => node.t === 'text' && node.id === 'label:header:1:gap')).toMatchObject({ title: 'Distance from the plan value for the whole fiscal year', part: 'tableHeader' });
    // Heads on the top edge of a chart without a top margin stay on the canvas, in both layouts.
    expect(heads(draw({ size: { width: 1200, height: 620 }, margin: { top: 0 } }))).toHaveLength(2);
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
});
