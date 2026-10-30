import './helpers/link-core';
import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutCombo } from '../src/core/charts/combo/layout';
import { round2 } from '../src/core/geometry';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import type { ChartData } from '../src/core/types/data';
import type { ComboOptions } from '../src/core/types/options';
import type { Geometry } from '../src/core/types/scene';
import { stampFreeSha } from './golden/stamp';

// A secondary area must not show a negative value as positive fill or reserve label space down to the other axis's zero.
it('closes secondary area paths and occupied fills at their own zero', () => {
  const draw = (axis: 'primary' | 'secondary', values: number[], secondaryAxis?: ComboOptions['secondaryAxis']) => {
    const data: ChartData = {
      categories: ['a', 'b', 'c'].map((id) => ({ id })),
      series: [
        { id: 'sales', label: 'Sales', kind: 'column', values: [30, 50, 40] },
        { id: 'aux', label: 'Auxiliary', kind: 'area', axis, values },
      ],
    };
    return requireGeometry(layoutCombo(data, {
      size: { width: 960, height: 540 }, title: 'Area baseline', labels: false,
      secondaryAxis, dualAxis: { anatomy: false },
    }));
  };
  const controls = {
    primary: draw('primary', [-10, 4, 8]),
    aligned: draw('secondary', [-10, 4, 8], { acknowledge: true }),
    positive: draw('secondary', [4, 6, 8], { acknowledge: true, domain: [0, 20] }),
  };
  // SVG bytes for these three invented controls (re-recorded when Helvetica Neue moved to the Liberation Sans widths, for the 280 px compact floor in data-bp-sizing, and when the area moved behind the columns), hashed without the engine stamp.
  const hashes: Record<string, string> = {
    primary: 'cba7a8a06005fafbbbf6b3f07665c69717f657c6880722c44faba85c86b0897a',
    aligned: '428f24734b60d086ff244b02df363fcd71f07f3b01bea5d01549a20ff4d65651',
    positive: 'b17ad2966722d479f7fe35ecbfe69511d2ea80d7939322af8565f2f1fc7acbb9',
  };
  for (const [name, geometry] of Object.entries(controls)) {
    expect(stampFreeSha(renderSvg(geometry as unknown as Geometry, resolveTheme())), name).toBe(hashes[name]);
  }
  // Combo domains retain zero even when the positive pin starts above it.
  const positivePin = draw('secondary', [4, 6, 8], { acknowledge: true, domain: [2, 20] });
  expect(positivePin.derived.secondaryDomain).toEqual([0, 20]);
  expect(renderSvg(positivePin as unknown as Geometry, resolveTheme()))
    .toBe(renderSvg(controls.positive as unknown as Geometry, resolveTheme()));

  const geometry = draw('secondary', [-10, 4, 8], { acknowledge: true, domain: [-20, 20] });
  const secondaryZero = geometry.axes.filter((axis) => axis.axis === 'y').at(-1)!.ticks.find((tick) => tick.at === 0)!.pos;
  const primaryZero = geometry.axes.find((axis) => axis.axis === 'y')!.ticks.find((tick) => tick.at === 0)!.pos;
  expect(secondaryZero).not.toBeCloseTo(primaryZero);
  const path = geometry.scene.find((node) => node.id === 'mark:area:aux');
  if (path?.t !== 'path') throw new Error('missing secondary area');
  const points = geometry.marks.lines.find((line) => line.seriesId === 'aux')!.points;
  expect(path.d).toContain(`L${round2(points.at(-1)!.x)} ${round2(secondaryZero)}L${round2(points[0]!.x)} ${round2(secondaryZero)}Z`);
  const fills = geometry.debug!.occupied.filter((claim) => claim.kind === 'mark' && claim.owner.seriesId === 'aux').slice(0, 4);
  expect(fills).toHaveLength(4);
  for (const [index, claim] of fills.entries()) {
    const segment = Math.floor(index / 2);
    const top = Math.min(points[segment]!.y, points[segment + 1]!.y, secondaryZero);
    const bottom = Math.max(points[segment]!.y, points[segment + 1]!.y, secondaryZero);
    expect(claim.rect.y).toBeCloseTo(top);
    expect(claim.rect.y + claim.rect.h).toBeCloseTo(bottom);
  }
});

// A value inside its own area, drawn over another area, took its ink against the hidden fill beneath: white text on a light fill.
it('chooses a value ink against the fill drawn on top, not one hidden under it', () => {
  const data: ChartData = {
    categories: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })),
    series: [
      { id: 'back', label: 'Back', kind: 'area', colorRole: 'neutral', values: [150, 150, 150, 150, 150] },
      { id: 'front', label: 'Front', kind: 'area', colorRole: 'neutralLight', values: [80, 80, 80, 80, 80] },
    ],
  };
  const geometry = requireGeometry(layoutCombo(data, { size: { width: 720 }, title: 'Two areas', valueLabels: 'all' }));
  const back = geometry.scene.find((node) => node.id === 'mark:area:back');
  if (back?.t !== 'path') throw new Error('missing back area');
  const lineY = geometry.marks.lines.find((line) => line.seriesId === 'front')!.points[0]!.y;
  const front = geometry.labels.filter((label) => label.owner.seriesId === 'front' && !label.hidden);
  expect(front.length).toBeGreaterThan(0);
  // Under its own line a value sits on its own fill, which covers the back one.
  for (const label of front.filter((label) => label.rect.y > lineY)) expect((label.ink as { theme?: { fill?: unknown } }).theme?.fill).not.toEqual(back.fill);
});

// A negative area draws its line under its baseline; with its edges taken the wrong way round, a value inside its light fill read the dark fill beneath.
it('takes a negative area\'s edges as drawn when it chooses a value ink', () => {
  const data: ChartData = {
    categories: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })),
    series: [
      { id: 'back', label: 'Back', kind: 'area', colorRole: 'neutral', values: [150, 150, 150, 150, 150] },
      { id: 'neg', label: 'Neg', kind: 'area', axis: 'secondary', colorRole: 'neutralLight', values: [-100, -100, -100, -100, -100] },
      { id: 'line', label: 'Line', kind: 'line', values: [60, 60, 60, 60, 60] },
    ],
  };
  const geometry = requireGeometry(layoutCombo(data, {
    size: { width: 720 }, title: 'Negative area', valueLabels: 'all', secondaryAxis: { acknowledge: true, domain: [-200, 0] },
  }));
  const back = geometry.scene.find((node) => node.id === 'mark:area:back');
  if (back?.t !== 'path') throw new Error('missing back area');
  const negY = geometry.marks.lines.find((line) => line.seriesId === 'neg')!.points[0]!.y;
  for (const label of geometry.labels.filter((label) => !label.hidden && label.rect.y + label.rect.h <= negY)) {
    expect((label.ink as { theme?: { fill?: unknown } }).theme?.fill, label.id).not.toEqual(back.fill);
  }
});

// An opaque area drew over the columns and the shadings behind it: Q2 to Q5's
// columns and the corridor below the area's top were hidden.
it('draws a combo area behind the columns, with the shadings read through it', () => {
  const geometry = requireGeometry(layoutCombo({
    categories: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((id) => ({ id })),
    series: [
      { id: 'orders', label: 'Orders', kind: 'column', values: [22, 25, 24, 28, 30, 33] },
      { id: 'capacity', label: 'Capacity', kind: 'area', values: [30, 30, 32, 36, 36, 38] },
    ],
  }, {
    size: { width: 720, height: 400 }, title: 'Capacity',
    annotations: [{ kind: 'band', id: 'corridor', style: 'corridor', low: 20, high: 27 }, { kind: 'band', id: 'launch', from: 'q4', to: 'q5' }],
  }));
  const parts = geometry.scene.map((node) => node.part);
  const area = parts.indexOf('area');
  expect(area).toBeGreaterThanOrEqual(0);
  expect(parts.indexOf('segment')).toBeGreaterThan(Math.max(parts.lastIndexOf('shadingOverFill'), parts.lastIndexOf('bandEdge'), parts.lastIndexOf('columnGap')));
  expect(parts.indexOf('shadingOverFill')).toBeGreaterThan(area);
  expect(parts.filter((part) => part === 'bandEdge')).toHaveLength(2);
  expect(parts.filter((part) => part === 'columnGap')).toHaveLength(6);
});

// A primary max between two ticks left the left axis short of it and off the rows of the right axis.
it('runs the rows of a dual axis up to the authored primary max', () => {
  const geometry = requireGeometry(layoutCombo({
    categories: ['q1', 'q2', 'q3'].map((id) => ({ id })),
    series: [
      { id: 'sales', label: 'Sales', kind: 'column', values: [150, 180, 190] },
      { id: 'visits', label: 'Visits', kind: 'line', axis: 'secondary', values: [15, 18, 21] },
    ],
  }, {
    size: { width: 720, height: 404 }, title: 'Sales and visits',
    valueAxis: { max: 240 }, secondaryAxis: { acknowledge: true, domain: [0, 24] },
  }));
  const ticks = (axis: string) => geometry.scene.flatMap((node) => node.t === 'text' && node.id.startsWith(`axis:${axis}:tick:`) ? [{ text: node.lines[0], y: node.y }] : []);
  expect(ticks('y').map((tick) => tick.text)).toEqual(['0', '60', '120', '180', '240']);
  expect(ticks('y2').map((tick) => tick.y)).toEqual(ticks('y').map((tick) => tick.y));
});
