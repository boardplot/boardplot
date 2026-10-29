/**
 * The one refusal path the CLI render and the React chart components share.
 * A layout that raises an error-severity lint has drawn a
 * chart the reader would misread: the CLI answers exit 1 with the lint, and
 * React draws the error card with the same code, message, path and fix
 * instead of the chart.
 *
 * Light on purpose: every React chart entry links it, so it imports types
 * and the zod-free capability tables (capability.ts) only. The unknown-key
 * check comes in from the generated entry.
 */
import type { LayoutResult, LintWarning } from '../types/scene';
import { legendDrawsNothing, schemaRefusedKeys } from './capability';
import type { OptionKeyCheck } from './unknownKeys';
import { retireChartSettings } from '../retired';

/** Every reason a laid-out chart is refused: the layout's own error lints. */
export function chartRefusals(warnings: readonly LintWarning[]): LintWarning[] {
  return warnings.filter((warning) => warning.severity === 'error');
}

/** These layout refusals can clear when the drawing gets more width or height. */
export function isSizeDependentRefusal(finding: Pick<LintWarning, 'code'>): boolean {
  switch (finding.code) {
    case 'size-below-floor':
    case 'diagram-size-too-small':
    case 'diagram-node-label-unplaced':
    case 'diagram-route-unresolved':
    case 'fixed-position-outside':
    case 'fixed-position-overlap':
    // Cohort and status raise a hidden row or series label to a refusal; more width can seat it.
    case 'label-hidden':
    case 'grid-panel-too-short':
    case 'grid-gutters-exceed-space':
    case 'table-overflow':
    case 'creative-text-overflow':
    case 'geo-key-overflow':
    case 'geo-overlay-no-space':
      return true;
    default:
      return false;
  }
}

/**
 * Whether a layout is refused: a size refusal (`refused: true`), or geometry
 * whose own error lints refuse it, which the CLI and React refuse too.
 */
export function isRefused(layout: LayoutResult<object, object>): boolean {
  return layout.refused === true || chartRefusals(layout.warnings).length > 0;
}

/** A refusal as a diagnostic: the fields the CLI envelope and the React error card print. */
export interface RefusalFinding {
  code: string;
  message: string;
  /** The offending field, dotted, relative to the chart; empty for the chart as a whole. */
  path: string;
  suggest?: string;
  fix?: LintWarning['fix'];
}

export function refusalFindings(refusals: readonly LintWarning[]): RefusalFinding[] {
  return refusals.map((refusal) => ({
    code: refusal.code,
    message: refusal.message,
    path: refusal.field?.join('.') ?? '',
    ...(refusal.suggest ? { suggest: refusal.suggest } : {}),
    ...(refusal.fix ? { fix: refusal.fix } : {}),
  }));
}

/** Why a key beside the plot is refused; the schema and React word it alike. */
export const SIDE_KEY_REFUSED = "legend 'right' is refused: a key beside the plot takes the plot's width; use 'top', one row above the plot";

/**
 * A key the schema refuses by name, answered with the remove patch the schema
 * diagnostic gives it and a short sentence: the schema's full reason stays on
 * the schema side (capabilityReasons.ts), which the CLI and MCP print.
 */
function refusedKey(path: readonly string[], message: string): RefusalFinding {
  const pointer = `/${path.join('/')}`;
  return { code: 'invalid-options', message, path: path.join('.'), fix: [{ op: 'remove', path: pointer }] };
}

/**
 * The option values the schemas refuse, for the per-type React entries,
 * which do not link zod: every key the capability tables refuse on `type`
 * (schemaRefusedKeys), a legend value that draws nothing there, and the side
 * key. Each finding carries the code, path and patch the CLI prints.
 * The map entries refuse their own cross-field options
 * in their layouts (charts/choropleth/geoRefusals.ts). With a per-type
 * entry's key check, a chart those leave alone is checked for unknown keys
 * next, as the CLI sweeps them only after the schema parse passed.
 */
export function optionRefusals(options: Record<string, unknown>, type: string, checkKeys?: OptionKeyCheck, providerStrings?: Record<string, unknown>): RefusalFinding[] {
  // A retired setting draws, and the layout request warns about it (retired.ts); it is never refused here.
  options = retireChartSettings(type, { options }).chart.options;
  if (providerStrings) providerStrings = retireChartSettings(type, { options: { strings: providerStrings } }).chart.options.strings;
  const found: RefusalFinding[] = [];
  const refused = schemaRefusedKeys(type);
  for (const key of refused.options) {
    if (options[key] !== undefined) found.push(refusedKey(['options', key], `'${key}' has no effect on ${type}`));
  }
  const valueAxis = options.valueAxis;
  if (valueAxis !== null && typeof valueAxis === 'object' && !refused.options.includes('valueAxis')) {
    for (const key of refused.valueAxis) {
      if ((valueAxis as Record<string, unknown>)[key] !== undefined) {
        found.push(refusedKey(['options', 'valueAxis', key], `'valueAxis.${key}' has no effect on ${type}`));
      }
    }
  }
  const legend = options.legend;
  if (legendDrawsNothing(type, legend)) found.push(refusedKey(['options', 'legend'], `legend '${String(legend)}' has no effect on ${type}`));
  const inObject = typeof legend === 'object' && legend !== null && (legend as { position?: unknown }).position === 'right';
  // A type that refuses legend already answers it with the remove patch; the
  // side key's patch to 'top' would be refused there too.
  if ((legend === 'right' || inObject) && !refused.options.includes('legend')) {
    const path = inObject ? '/options/legend/position' : '/options/legend';
    found.push({
      code: 'invalid-options',
      message: SIDE_KEY_REFUSED,
      path: path.slice(1).replaceAll('/', '.'),
      suggest: "Set legend to 'top'. The key row can need more height; leave the height open or increase the chart size.",
    });
  }
  return found.length || !checkKeys ? found : checkKeys(options, providerStrings);
}
