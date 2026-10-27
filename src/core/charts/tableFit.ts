/** Fit steps the table family shares: the zero-lift fallback and the tight-spacing rung. */

import { zeroLifts } from '../formatPrecision';
import { heightOmitted, SIZE_TOLERANCE } from '../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../target';
import type { BaseOptions } from '../types/options';
import type { LintWarning } from '../types/scene';

/**
 * Lay out with a lifted figure ("0.0005" for "0.0"), and where the lift costs
 * width that the rounded text does not, with its bound ('compact') or with the rounded
 * text ('none'). `costs(lifted, plain)` is each type's own cost test.
 * `plainDraws(compact, plain)` says when the rounded text draws in place of the
 * bound; by default where the bound costs too.
 */
export function liftOrFallback<G>(layoutAs: (mode: 'full' | 'none' | 'compact') => G, costs: (lifted: G, plain: G) => boolean, lifted = false, plainDraws = costs): G {
  const before = zeroLifts.count;
  const full = layoutAs('full');
  if (!lifted && zeroLifts.count === before) return full;
  const plain = layoutAs('none');
  if (!costs(full, plain)) return full;
  const compact = layoutAs('compact');
  return plainDraws(compact, plain) ? plain : compact;
}

interface Fitted { size: { width: number; height: number }; sizing?: { minWidth: number; minHeight: number } }

/** Which axes a layout misses its minimum on, within SIZE_TOLERANCE, where the frame fixes that axis. */
export function missesSize(geometry: Fitted, options: Pick<BaseOptions, 'size'>): { width: boolean; height: boolean } {
  const open = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed;
  return {
    width: open?.width !== false && geometry.size.width + SIZE_TOLERANCE < (geometry.sizing?.minWidth ?? 0),
    height: open?.height !== false && !heightOmitted(options.size) && geometry.size.height + SIZE_TOLERANCE < (geometry.sizing?.minHeight ?? 0),
  };
}

/**
 * The 'table-tight-spacing' warning: what the tight rung reduced, and the size
 * that keeps `spacing`. `reduced` names the width and the height part.
 */
export function tightSpacingWarning(
  misses: { width: boolean; height: boolean },
  reduced: { width: string; height: string },
  subject: string,
  spacing: string,
  geometry: Fitted & { sizing: { minWidth: number; minHeight: number } },
  options: Pick<BaseOptions, 'size'>,
): LintWarning {
  const value = {
    width: Math.ceil(Math.max(geometry.size.width, geometry.sizing.minWidth)),
    ...(heightOmitted(options.size) ? {} : { height: Math.ceil(Math.max(geometry.size.height, geometry.sizing.minHeight)) }),
  };
  const need = value.height === undefined ? `${value.width} px of width` : `${value.width} × ${value.height} px`;
  return { code: 'table-tight-spacing', severity: 'warn',
    message: `${[misses.width ? reduced.width : '', misses.height ? reduced.height : ''].filter(Boolean).join(' and ').replace(/^./, (c) => c.toUpperCase())} were reduced to fit ${subject}; ${spacing} spacing needs ${need}.`,
    suggest: `Give the table ${need} for ${spacing} spacing.`,
    field: ['options', 'size'], fix: [{ op: 'replace', path: '/options/size', value }] };
}
