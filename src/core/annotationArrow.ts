/**
 * The arrow standard every annotation arrow draws with: a drawn arrow, a
 * callout arrow, a CAGR bracket or growth arrow, a difference, a link and the
 * gap and band brackets. One head, one stroke, the same air at both ends, so
 * an arrow never reads smaller than the marker it points at.
 *
 * `marks.arrow` in the theme holds the numbers. Its style 'compact' brings
 * back the look before the standard: each kind its own small head, a 1 px
 * shaft, the tip on its point and no shortest shaft.
 */

import { fmtPathNumber as fmt } from './curve';
import type { Point } from './geometry';
import { arrowHeadPath, arrowShaftEnd } from './svgPath';
import { strokeToken } from './theme';
import type { Theme } from './types/theme';

/** The standard, at rendered size. */
export const ARROW_STANDARD = { head: 8, headWidth: 7, tipGap: 6, tailGap: 4, minShaft: 24 } as const;

export interface ArrowLook {
  /** False under `marks.arrow.style: 'compact'`. */
  standard: boolean;
  /** The shaft's width: `marks.arrow.stroke`, else the thin `stroke.rule` line. */
  stroke: number;
  /** Head length, tip to base, along the shaft. */
  depth: number;
  /** Half the head's base. */
  half: number;
  /** How far behind the tip the shaft stops: inside the head, with no seam and no ink past the tip. */
  shaftEnd: number;
  /** Air between the tip and the edge of the mark it points at. */
  tipGap: number;
  /** Air between the tail and its text. */
  tailGap: number;
  /** The shortest shaft, tail to head base. */
  minShaft: number;
  /** The filled head as a closed path. `angle` points along the shaft. */
  head(tip: Point, angle: number): string;
}

/** The look before the standard, per kind: its old head size and air. */
export interface CompactArrow {
  size: number;
  tipGap?: number;
  tailGap?: number;
}

/** The arrow look of the active theme. `compact` is this kind's look under `marks.arrow.style: 'compact'`. */
export function arrowLook(theme: Pick<Theme, 'marks' | 'stroke'>, compact: CompactArrow): ArrowLook {
  const spec = theme.marks?.arrow;
  if (spec?.style === 'compact') {
    const stroke = strokeToken(theme, 'rule');
    return {
      standard: false,
      stroke,
      depth: compact.size * Math.abs(Math.cos(Math.PI * 0.85)),
      half: compact.size * Math.abs(Math.sin(Math.PI * 0.85)),
      shaftEnd: arrowShaftEnd(compact.size, stroke),
      tipGap: compact.tipGap ?? 0,
      tailGap: compact.tailGap ?? 0,
      minShaft: 0,
      head: (tip, angle) => arrowHeadPath(tip, angle, compact.size),
    };
  }
  const stroke = spec?.stroke ?? strokeToken(theme, 'rule');
  const depth = spec?.head ?? ARROW_STANDARD.head;
  const half = (spec?.headWidth ?? ARROW_STANDARD.headWidth) / 2;
  return {
    standard: true,
    stroke,
    depth,
    half,
    // Depth at which the head is as wide as the shaft, plus half a pixel.
    shaftEnd: Math.min(depth, (stroke / 2) * (depth / half) + 0.5),
    tipGap: spec?.tipGap ?? ARROW_STANDARD.tipGap,
    tailGap: spec?.tailGap ?? ARROW_STANDARD.tailGap,
    minShaft: spec?.minShaft ?? ARROW_STANDARD.minShaft,
    head: (tip, angle) => {
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const bx = tip.x - ux * depth;
      const by = tip.y - uy * depth;
      return `M${fmt(tip.x)} ${fmt(tip.y)}L${fmt(bx - uy * half)} ${fmt(by + ux * half)}L${fmt(bx + uy * half)} ${fmt(by - ux * half)}Z`;
    },
  };
}
