import { resolveSize } from '../../normalize/shared';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import type { CanvasSizeInput } from '../../types/options';

/**
 * the registry gives an unsized chart its target's default width
 * (720 px under report). A card (kpi, bullet, sparkline) keeps its own
 * default width instead, as it keeps its width-class exemption, and the
 * height the fit layer measured for it.
 */
export function cardSize(options: { size?: CanvasSizeInput } & TargetSizeOptions, fallback: { width: number; height: number }): CanvasSizeInput {
  if (options.size === undefined || options[TARGET_SIZE]?.fixed.width !== false) return options.size ?? fallback;
  return { width: fallback.width, height: resolveSize(options.size).height };
}
