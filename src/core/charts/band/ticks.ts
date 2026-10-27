import { strokeToken } from '../../theme';
import type { Theme } from '../../types/theme';
/**
 * Reference-tick geometry shared by bar and column charts. Both orientations
 * use a 4 px claim across the value axis. The wider column claim won because
 * it leaves enough clearance for the rendered stroke and solver padding.
 */

import type { LegendItemInput } from '../../frame';
import type { Rect } from '../../geometry';
import type { OwnerRef } from '../../types/cell';
import type { Paint, SceneNode } from '../../types/scene';
import { linearScale, type LinearScale } from '../../scale';
import type { BandOrientation } from './labels';

/**
 * A reference dot (referenceStyle 'marker') on bar, column and combo: a ring
 * in the reference ink around the page colour. It keeps that one form on the
 * page and across a dark bar alike, and its key draws it at its own size.
 */
export const REFERENCE_MARKER_R = 4.5;

export function referenceMarkerPaint(theme: Theme, ink: Paint): { r: number; fill: Paint; stroke: Paint; strokeWidth: number } {
  return { r: REFERENCE_MARKER_R, fill: { token: 'background' }, stroke: ink, strokeWidth: strokeToken(theme, 'mark') };
}

export function referenceMarkerKey(theme: Theme, ink: Paint): Pick<LegendItemInput, 'key' | 'paint' | 'stroke' | 'width' | 'radius'> {
  return { key: 'marker', paint: { token: 'background' }, stroke: ink, width: strokeToken(theme, 'mark'), radius: REFERENCE_MARKER_R };
}

/**
 * A page-colour band under a reference
 * tick or dash, 1.5 px either side of its stroke, so the reference reads at
 * 3:1 on the bar it crosses as it does on the page. Drawn just before it.
 */
export function referenceCasing(id: string, line: { x1: number; y1: number; x2: number; y2: number }, width: number, owner: OwnerRef): SceneNode {
  const pad = width / 2 + 1.5;
  const rect = line.y1 === line.y2
    ? { x: Math.min(line.x1, line.x2), y: line.y1 - pad, w: Math.abs(line.x2 - line.x1), h: 2 * pad }
    : { x: line.x1 - pad, y: Math.min(line.y1, line.y2), w: 2 * pad, h: Math.abs(line.y2 - line.y1) };
  return { t: 'rect', id: `${id}:casing`, rect, fill: { token: 'background' }, owner, part: 'referenceCasing' };
}

interface ReferenceTickGeometry {
  line: { x1: number; y1: number; x2: number; y2: number };
  claim: Rect;
}

export function referenceTickGeometry(
  orientation: BandOrientation,
  bandStart: number,
  valuePosition: number,
  crossStart: number,
  crossEnd: number,
): ReferenceTickGeometry {
  const start = bandStart + crossStart;
  const end = bandStart + crossEnd;
  if (orientation === 'vertical') {
    return {
      line: { x1: start, y1: valuePosition, x2: end, y2: valuePosition },
      claim: { x: Math.min(start, end), y: valuePosition - 2, w: Math.abs(end - start), h: 4 },
    };
  }
  return {
    line: { x1: valuePosition, y1: start, x2: valuePosition, y2: end },
    claim: { x: valuePosition - 2, y: Math.min(start, end), w: 4, h: Math.abs(end - start) },
  };
}

/**
 * A value axis broken around an outlier gives each side at least
 * three ticks, so the short bars under the break read against an inner tick
 * (0, 50, 100) and not only against the axis ends. Authored step ticks
 * (`valueAxis.tickStep`) keep their step: the ones outside the omitted span
 * print. An unbroken scale is returned as it is.
 */
export function breakAxisScale(scale: LinearScale, stepTicks?: readonly number[]): LinearScale {
  const br = scale.break;
  if (!br) return scale;
  const [d0, d1] = scale.domain;
  const side = (lo: number, hi: number, keep: (v: number) => boolean) =>
    linearScale([lo, hi], [0, 1]).ticks(3).filter(keep);
  const ticks = () => stepTicks ? stepTicks.filter((v) => v < br.from || v > br.to) : [...new Set([
    ...side(d0, br.from, (v) => v < br.from),
    ...side(br.to, d1, (v) => v > br.to),
  ])].sort((a, b) => a - b);
  return Object.assign(((value: number) => scale(value)) as LinearScale, scale, { ticks });
}
