import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { paintColor, resolveTheme } from '../src/core/theme';
import { oklabLightness } from '../src/core/themeRules';
import type { BulletData } from '../src/core/types/data';
import type { BulletOptions } from '../src/core/types/options';
import type { Geometry } from '../src/core/types/scene';

const ladder = getFixtures('bullet').find((fixture) => fixture.id === 'four-band-neutral-ladder')!;
const draw = (options: BulletOptions, data = ladder.data as BulletData): Geometry => {
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data, options: { ...ladder.options, ...options } }));
  if (geometry.refused) throw new Error('refused');
  return geometry;
};
const slide = () => draw({ size: { width: 1200, height: 620 } });
const shown = (geometry: Geometry, prefix: string) => geometry.labels.filter((label) => label.id.startsWith(prefix) && !label.hidden)
  .sort((a, b) => a.rect.x - b.rect.x);
const bandRect = (geometry: Geometry, id: string) => {
  const node = geometry.scene.find((n) => n.id === id);
  if (node?.t !== 'rect') throw new Error(id);
  return node;
};

describe("bullet band names on the rows (bandKey 'row')", () => {
  // A reader had to match four key swatches to four shades on every row.
  it('prints each band name above its band on a few named rows; a dense panel keeps the key', () => {
    const geometry = slide();
    const names = shown(geometry, 'band-name:coverage:');
    expect(names.map((label) => label.lines[0])).toEqual(['Poor', 'Fair', 'Good', 'Leading']);
    const band = bandRect(geometry, 'band:coverage:0').rect;
    expect(names.every((label) => label.rect.y + label.rect.h <= band.y)).toBe(true);
    const dense = getFixtures('bullet').find((fixture) => fixture.id === 'twelve-rows-compact')!;
    const panel = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: dense.data, options: dense.options }));
    expect(!panel.refused && panel.labels.some((label) => label.id.startsWith('band-name:'))).toBe(false);
  });

  // On per-row scales a reader had no number on the row but the value and the target.
  it('numbers zero and each band edge under the row, and thins edges that would crowd', () => {
    expect(shown(slide(), 'edge:coverage:').map((label) => label.lines[0])).toEqual(['0%', '40%', '60%', '80%', '100%']);
    const crowded = draw({ size: { width: 1200, height: 620 } }, { rows: [
      { id: 'a', label: 'Revenue', value: 150000, target: 160000, bands: [{ to: 100000, label: 'A' }, { to: 104000, label: 'B' }, { to: 200000, label: 'C' }] },
      { id: 'b', label: 'Margin', value: 30, target: 35, bands: [{ to: 20, label: 'Low' }, { to: 40, label: 'Mid' }, { to: 50, label: 'High' }] },
    ] });
    expect(shown(crowded, 'edge:a:').map((label) => label.id)).toEqual(['edge:a:0', 'edge:a:100000', 'edge:a:200000']);
    // The crowded edge keeps its tick.
    expect(crowded.scene.some((node) => node.id === 'edgeTick:a:104000')).toBe(true);
  });

  // A value at its bar end on one row and past the band on the next could not be read down one column.
  it('prints every value right-aligned in one column right of the bands', () => {
    const geometry = slide();
    const values = geometry.labels.filter((placed) => placed.id.startsWith('point:') && !placed.hidden);
    expect(values.length).toBeGreaterThan(1);
    expect(new Set(values.map((placed) => placed.slot))).toEqual(new Set(['valueColumn']));
    expect(new Set(values.map((placed) => Math.round((placed.rect.x + placed.rect.w) * 100)))).toHaveProperty('size', 1);
    const lastBand = bandRect(geometry, 'band:cost:3').rect;
    expect(Math.min(...values.map((placed) => placed.rect.x))).toBeGreaterThan(lastBand.x + lastBand.w);
  });

  // The dark ramp under a key made the bar sink into its worst band, and the chart changed weight with its row count.
  it('paints the light ramp on every row; the full band fill keeps the wider steps under a key', () => {
    const full = { preset: 'standard', overrides: { marks: { bulletBandFill: 'full' } } } as const;
    const lightness = (geometry: Geometry, theme = resolveTheme(undefined)) => [0, 1, 2, 3].map((index) => oklabLightness(paintColor(theme, bandRect(geometry, `band:coverage:${index}`).fill!))!);
    const steps = (values: number[]) => values.slice(1).map((value, index) => value - values[index]!);
    for (const step of steps(lightness(slide()))) expect(step).toBeCloseTo(0.065, 2);
    for (const step of steps(lightness(draw({ size: { width: 1200, height: 620 }, bandKey: 'labels' })))) expect(step).toBeCloseTo(0.065, 2);
    const keyed = draw({ size: { width: 1200, height: 620 }, bandKey: 'labels', theme: full });
    for (const step of steps(lightness(keyed, resolveTheme(full)))) expect(step).toBeGreaterThanOrEqual(0.12);
  });

  // Full red and green bands made an on-plan corridor read as an alarm; the wash is decided in the theme the scene is painted in.
  it('washes toned bands and attainment toward the page, and a full-fill theme repaints them full', () => {
    const light = resolveTheme(undefined);
    const full = resolveTheme({ preset: 'boardroom', overrides: { marks: { bulletBandFill: 'full' } } });
    const draw = (id: string) => {
      const fixture = getFixtures('bullet').find((f) => f.id === id)!;
      const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: fixture.data, options: fixture.options, annotations: fixture.annotations }));
      if (geometry.refused) throw new Error('refused');
      return geometry;
    };
    const spend = draw('two-sided-spend');
    const [bad, good] = [bandRect(spend, 'band:spend:0').fill!, bandRect(spend, 'band:spend:1').fill!];
    expect(oklabLightness(paintColor(light, bad))!).toBeGreaterThan(oklabLightness(paintColor(light, good))!);
    expect([paintColor(full, bad), paintColor(full, good)]).toEqual([full.color.badFill ?? full.color.bad, full.color.goodFill ?? full.color.good]);
    const washes = draw('attainment-shading').scene.flatMap((node) => node.t === 'rect' && node.part === 'attainment' ? [node.fill!] : []);
    expect(washes.map((fill) => paintColor(full, fill)).sort()).toEqual([full.color.badFill ?? full.color.bad, full.color.goodFill ?? full.color.good].sort());
  });

  // The key named the bands a second time with built-in words (Worse, Lower middle ...) next to the author's names on the rows.
  it('keys the bar and the target tick at the bottom, and names a band only with the author\'s word', () => {
    const geometry = slide();
    const keyLabels = geometry.scene.filter((node) => node.t === 'text' && node.part === 'legendLabel');
    expect(keyLabels.map((node) => node.t === 'text' && node.lines[0])).toEqual(['Actual', 'Target']);
    const authored = draw({ size: { width: 1200, height: 620 }, strings: { bandKey: ['Weak', 'Low', 'Fine', 'Top'] } });
    expect(authored.scene.flatMap((node) => (node.t === 'text' && node.part === 'legendLabel' ? node.lines : []))).toEqual(['Actual', 'Target', 'Weak', 'Low', 'Fine', 'Top']);
    const lastBand = bandRect(geometry, 'band:cost:3').rect;
    expect(keyLabels.every((node) => node.t === 'text' && node.y > lastBand.y + lastBand.h)).toBe(true);
  });

  // Two rows in a slide-sized frame used a third of it and left the rest empty.
  it('spends a tall frame on taller rows', () => {
    const geometry = slide();
    const first = bandRect(geometry, 'band:coverage:0').rect;
    const last = bandRect(geometry, 'band:cost:0').rect;
    expect(first.h).toBeGreaterThanOrEqual(40);
    expect(last.y + last.h - first.y).toBeGreaterThan(0.45 * 620);
  });

  // A tolerance range needed a spacer band below it, shaded almost like the range, and the spacer judged values outside the range.
  it('starts a band at its from: the space below is unshaded and in no band, and an unusable from is ignored', () => {
    const north = (bands: unknown[], value = 120) => ({ rows: [{ id: 'north', label: 'North', value, target: 99, bands }, { id: 'south', label: 'South', value: 90 }] }) as BulletData;
    const tolerance = { to: 104, label: 'Tolerance 94 to 104', tone: 'neutral' };
    const at = (data: BulletData) => draw({ size: { width: 720 }, sharedScale: true, bandKey: 'labels' }, data);
    const spacer = at(north([94, tolerance]));
    const ranged = at(north([{ ...tolerance, from: 94 }]));
    expect(ranged.scene.filter((node) => node.t === 'rect' && node.part === 'band').map((node) => node.t === 'rect' && node.rect))
      .toEqual([bandRect(spacer, 'band:north:1').rect]);
    for (const id of ['target:north', 'label:delta:north', 'label:target-value:north']) expect(ranged.scene.find((node) => node.id === id)).toEqual(spacer.scene.find((node) => node.id === id));
    expect(bandRect(ranged, 'bar:north').rect).toEqual(bandRect(spacer, 'bar:north').rect);
    expect(ranged.warnings).toEqual(spacer.warnings);
    // A value below the range lies in no band, so the range's tone does not judge it.
    const tone = (geometry: Geometry) => geometry.annotations.find((annotation) => annotation.id === 'delta-target:north')?.tone;
    expect(tone(at(north([{ ...tolerance, from: 94, tone: 'good' }], 50)))).toBe('neutral');
    expect(tone(at(north([{ ...tolerance, from: 94, tone: 'good' }], 100)))).toBe('good');
    // On rows that name their bands, the range's name stands over the range and its from is a numbered edge.
    const named = draw({ size: { width: 1200, height: 620 }, sharedScale: false }, { rows: [{ id: 'a', label: 'Fill rate', value: 97, target: 98, bands: [{ from: 90, to: 100, label: 'Tolerance' }] }] });
    expect(shown(named, 'edge:a:').map((label) => label.lines[0])).toEqual(['0', '90', '100']);
    const range = bandRect(named, 'band:a:0').rect;
    const name = shown(named, 'band-name:a:')[0]!.rect;
    expect(name.x + name.w / 2).toBeCloseTo(range.x + range.w / 2, 5);
    // A from below 0, not below its own to, or below the previous band's to draws the band as without it.
    for (const bands of [[{ to: 40, from: -5 }], [{ to: 40, from: 40 }], [{ to: 20 }, { to: 40, from: 10 }]]) {
      const plain = at(north(bands.map(({ from: _from, ...band }) => band)));
      const ignored = at(north(bands));
      expect(ignored.scene).toEqual(plain.scene);
      expect(ignored.warnings.map((warning) => warning.code)).toContain('band-from-ignored');
      expect(ignored.warnings.filter((warning) => warning.code !== 'band-from-ignored')).toEqual(plain.warnings);
    }
  });

  // A size that draws today must still draw: the names give way to the key, with a warning.
  it('keeps the key on a phone, also when the author asks for the names', () => {
    const phone = draw({ size: { width: 360 }, bandKey: 'row' });
    expect(shown(phone, 'band-name:')).toEqual([]);
    expect(phone.warnings.map((warning) => warning.code)).toContain('band-key-row-unavailable');
    expect(phone.scene.flatMap((node) => (node.t === 'text' && node.part === 'legendLabel' ? node.lines : []))).toEqual(['Poor', 'Fair', 'Good', 'Leading']);
  });
});
