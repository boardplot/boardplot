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

  // The number belongs with its bar end; it must never sit under the target tick.
  it('seats the value just past the bar end, and in today\'s seat where the target tick is near', () => {
    expect(shown(slide(), 'point:coverage')[0]?.slot).toBe('pastEnd');
    const near = draw({ size: { width: 1200, height: 620 } }, { rows: [
      { ...(ladder.data as BulletData).rows[0]!, value: { pct: 83 } },
      (ladder.data as BulletData).rows[1]!,
    ] });
    expect(shown(near, 'point:coverage')[0]?.slot).not.toBe('pastEnd');
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

  // Full red and green bands made an on-plan corridor read as an alarm.
  it('washes toned bands and attainment toward the page, bad lighter than good', () => {
    const theme = resolveTheme(undefined);
    const fill = (geometry: Geometry, id: string) => paintColor(theme, bandRect(geometry, id).fill!);
    const corridor = getFixtures('bullet').find((fixture) => fixture.id === 'two-sided-spend')!;
    const spend = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: corridor.data, options: corridor.options }));
    if (spend.refused) throw new Error('refused');
    expect([fill(spend, 'band:spend:0'), fill(spend, 'band:spend:1')]).toEqual(['#f8d8d8', '#b2e0cd']);
    const plan = getFixtures('bullet').find((fixture) => fixture.id === 'attainment-shading')!;
    const shaded = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: plan.data, options: plan.options, annotations: plan.annotations }));
    if (shaded.refused) throw new Error('refused');
    const washes = shaded.scene.filter((node) => node.t === 'rect' && node.part === 'attainment').map((node) => node.t === 'rect' ? paintColor(theme, node.fill!) : '');
    expect(washes.sort()).toEqual(['#b2e0cd', '#f8d8d8']);
  });

  // The rows no longer show which mark is the actual and which the target.
  it('keys the bar, the target tick and the ramp at the bottom', () => {
    const geometry = slide();
    const keyLabels = geometry.scene.filter((node) => node.t === 'text' && node.part === 'legendLabel');
    expect(keyLabels.map((node) => node.t === 'text' && node.lines[0])).toEqual(['Actual', 'Target', 'Worse', 'Lower middle', 'Upper middle', 'Better']);
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

  // A size that draws today must still draw: the names give way to the key, with a warning.
  it('keeps the key on a phone, also when the author asks for the names', () => {
    const phone = draw({ size: { width: 360 }, bandKey: 'row' });
    expect(shown(phone, 'band-name:')).toEqual([]);
    expect(phone.warnings.map((warning) => warning.code)).toContain('band-key-row-unavailable');
    expect(phone.scene.flatMap((node) => (node.t === 'text' && node.part === 'legendLabel' ? node.lines : []))).toEqual(['Poor', 'Fair', 'Good', 'Leading']);
  });
});
