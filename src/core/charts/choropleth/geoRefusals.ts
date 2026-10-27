/**
 * The geo option refusals, in the words the schema prints. The
 * choropleth and tile map schemas refuse them for the CLI and BoardplotChart;
 * the layouts raise the same code, path and remove patch as error lints, so
 * the per-type React entries, which do not link the schemas, refuse them too.
 * Its own module without zod, so only the two map entries carry it.
 */
import type { LintWarning } from '../../types/scene';

export const COLORBLIND_WITHOUT_PAIR_REFUSED = "colorblindSafe swaps the good/bad poles of a diverging scale, and a sequential scale paints one ramp with no good/bad pair, so it would change nothing; drop colorblindSafe, or declare scale: { kind: 'diverging', midpoint, polarity }";

export const REGION_VALUES_WITHOUT_CODES_REFUSED = 'regionValues prints values under the tile codes, and labels switch the codes off; turn the category labels on, or drop regionValues';

export const LEGEND_NONE_REFUSED = "a map's colours are its values, so its key cannot be hidden; drop legend: 'none', or name where the key goes ('top' or 'bottom')";

export const highlightRefused = (type: string) => `'highlight' is not implemented by '${type}' — a region's colour is its value, so an emphasis colour would read as data; name the regions in the title, or label them with labelRegions`;

/** Why a choropleth refuses regionValues while its labels are off. */
export function regionValuesWithoutLabelsRefused(labels: false | 'none'): string {
  return `regionValues prints values on region labels, and labels: ${labels === false ? 'false' : "'none'"} draws none; set labels to 'auto' or 'all', or drop regionValues`;
}

function refusedKey(key: string, message: string): LintWarning {
  return { code: 'invalid-options', severity: 'error', message, field: ['options', key], fix: [{ op: 'remove', path: `/options/${key}` }] };
}

export function geoOptionRefusals(
  options: { colorblindSafe?: unknown; scale?: { kind?: unknown }; regionValues?: unknown; labels?: unknown; legend?: unknown; highlight?: unknown },
  type: 'choropleth' | 'tilemap',
): LintWarning[] {
  const found: LintWarning[] = [];
  // A map's key cannot be hidden, and a region has no emphasis state.
  if (options.legend === 'none') found.push(refusedKey('legend', LEGEND_NONE_REFUSED));
  if (options.highlight !== undefined) found.push(refusedKey('highlight', highlightRefused(type)));
  if (options.colorblindSafe === true && options.scale?.kind !== 'diverging') {
    found.push(refusedKey('colorblindSafe', COLORBLIND_WITHOUT_PAIR_REFUSED));
  }
  const labels = options.labels as false | 'none' | { category?: unknown } | undefined;
  if (type === 'tilemap' && options.regionValues === true && (labels === false || (typeof labels === 'object' && labels?.category === false))) {
    found.push(refusedKey('regionValues', REGION_VALUES_WITHOUT_CODES_REFUSED));
  }
  if (type === 'choropleth' && options.regionValues === true && (labels === false || labels === 'none')) {
    found.push(refusedKey('regionValues', regionValuesWithoutLabelsRefused(labels)));
  }
  return found;
}
