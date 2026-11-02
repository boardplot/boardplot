/** Scatter-specific log validation. Shared scale helpers stay separate from scatter. */
import { NormalizeError } from '../../normalize/shared';
import type { JsonPatchOperation } from '../../diagnostics/jsonPatch';
import type { ValueAxisOptions } from '../../types/options';
import type { NormPt } from './model';
import type { ScatterStrategyOptions } from './types';
import { drawnValueLines } from './valueLines';
import type { LogAxes } from '../logAxis';
export { fitLogTicks, linearAxisSpec, logAxesOf, logDomain, logScale, logSpecFormat, logTickTiers } from '../logAxis';
export type { LogAxes } from '../logAxis';

/** The patch that takes `axis` off the log scale and keeps the other one on it. */
function dropLogFix(log: ValueAxisOptions['log'], axis: 'x' | 'y'): JsonPatchOperation[] {
  return log === 'both'
    ? [{ op: 'replace', path: '/options/valueAxis/log', value: axis === 'x' ? 'y' : 'x' }]
    : [{ op: 'remove', path: '/options/valueAxis/log' }];
}

/**
 * Every value a log axis would have to place at or below zero is refused,
 * with its path and the patch that drops the log scale on that axis: the
 * points, the view window, the vertical bounds and includeZero, the clamp,
 * the zone regions, the declared quadrant cut points and the value lines.
 * Zone grid thresholds need no check here: the domain check refuses any
 * threshold outside the positive domain.
 */
export function refuseNonPositiveOnLog(options: ScatterStrategyOptions, axes: LogAxes, pts: readonly NormPt[]): void {
  if (!axes.x && !axes.y) return;
  const log = options.valueAxis?.log;
  const side = (axis: 'x' | 'y') => (axis === 'x' ? 'horizontal' : 'vertical');
  const refuse = (axis: 'x' | 'y', what: string, value: number | string, segments: (string | number)[], remove: string): never => {
    const keep = log === 'both' ? ` (log: '${axis === 'x' ? 'y' : 'x'}' keeps the ${side(axis === 'x' ? 'y' : 'x')} axis on a log scale)` : '';
    throw new NormalizeError(
      'log-nonpositive',
      what,
      `${what} is ${value}, and the ${side(axis)} axis is on a log scale, which has no place for zero or a negative value`,
      `${remove}, or drop valueAxis.log${keep}`,
      dropLogFix(log, axis),
      segments,
    );
  };
  for (const axis of ['x', 'y'] as const) {
    if (!axes[axis]) continue;
    for (const p of pts) {
      if (p[axis] <= 0) refuse(axis, `points[${p.id}].${axis}`, p[axis], ['data', 'points', p.idx, axis], 'remove the point');
    }
    const view = options.viewDomain?.[axis];
    if (view && Math.min(...view) <= 0) refuse(axis, `options.viewDomain.${axis}`, `[${view.join(', ')}]`, ['options', 'viewDomain', axis], `start viewDomain.${axis} above zero`);
    const clamp = options.valueAxis?.clamp;
    const bounds = axis === 'y' ? { min: clamp?.min, max: clamp?.max, ...clamp?.y } : { ...clamp?.x };
    for (const bound of ['min', 'max'] as const) {
      const value = bounds[bound];
      if (value !== undefined && value <= 0) refuse(axis, `options.valueAxis.clamp.${axis}.${bound}`, value, ['options', 'valueAxis', 'clamp'], 'clamp at a value above zero');
    }
    for (const [index, region] of (options.zones?.regions ?? []).entries()) {
      const at = region.points.findIndex((point) => point[axis] <= 0);
      if (at >= 0) refuse(axis, `options.zones.regions[${index}].points[${at}].${axis}`, region.points[at]![axis], ['options', 'zones', 'regions', index, 'points', at, axis], 'move the region above zero');
    }
    const cut = options.quadrants?.[axis];
    if (typeof cut === 'number' && cut <= 0) refuse(axis, `options.quadrants.${axis}`, cut, ['options', 'quadrants', axis], 'cut above zero');
  }
  if (!axes.y) return;
  const va = options.valueAxis ?? {};
  for (const bound of ['min', 'max'] as const) {
    const value = va[bound];
    if (value !== undefined && value <= 0) refuse('y', `options.valueAxis.${bound}`, value, ['options', 'valueAxis', bound], `drop valueAxis.${bound}`);
  }
  if (va.includeZero) refuse('y', 'options.valueAxis.includeZero', 'true', ['options', 'valueAxis', 'includeZero'], 'drop valueAxis.includeZero');
  // A value line, or the low edge of its tolerance band, at or below zero.
  const meanY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  for (const line of drawnValueLines(options.annotations, meanY)) {
    const ann = options.annotations![line.index] as { tolerance?: number | { low: number } };
    const low = typeof ann.tolerance === 'number' ? line.value - ann.tolerance : (ann.tolerance?.low ?? line.value);
    if (Math.min(line.value, low) <= 0) refuse('y', `annotations[${line.index}]`, Math.min(line.value, low), ['annotations', line.index], 'move the value line and its band above zero');
  }
}
