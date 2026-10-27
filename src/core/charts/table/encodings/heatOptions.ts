/**
 * The heat options a lane's scale does not read, without the engine or zod,
 * so the table schema and the React table both link it.
 */

import { toJsonPointer } from '../../../diagnostics/jsonPatch';

type HeatOptionKey = 'span' | 'center' | 'steps' | 'bins' | 'cap' | 'tolerance';

/**
 * Heat options the lane's scale does not read (an option without effect is
 * refused): `span` floors the ramp of
 * scale 'column' only, `center` moves the centre of scales 'diverging' and
 * 'status' only, `tolerance` sets the warn band of scale 'status' only, and
 * the traffic light of 'status' has no bands, steps or cap to set. The
 * schema refuses them for the CLI; the React table refuses them from the
 * same list.
 */
export function heatOptionsWithoutEffect(encoding: {
  scale?: unknown; span?: unknown; center?: unknown; steps?: unknown; bins?: unknown; cap?: unknown; tolerance?: unknown;
}): { key: HeatOptionKey; message: string }[] {
  const scale = encoding.scale ?? 'column';
  const found: { key: HeatOptionKey; message: string }[] = [];
  if (encoding.span !== undefined && scale !== 'column') {
    found.push({ key: 'span', message: `span floors the ramp of scale 'column' only and has no effect on scale '${String(scale)}'; drop span` });
  }
  if (encoding.center !== undefined && scale !== 'diverging' && scale !== 'status') {
    found.push({ key: 'center', message: `center moves the centre of scales 'diverging' and 'status' only and has no effect on scale '${String(scale)}'; drop center` });
  }
  if (encoding.tolerance !== undefined && scale !== 'status') {
    found.push({ key: 'tolerance', message: `tolerance sets the warn band of scale 'status' only and has no effect on scale '${String(scale)}'; drop tolerance` });
  }
  if (scale === 'status' && encoding.tolerance !== null && typeof encoding.tolerance === 'object') {
    const { pct, abs } = encoding.tolerance as { pct?: unknown; abs?: unknown };
    if ((pct === undefined) === (abs === undefined)) {
      found.push({ key: 'tolerance', message: 'tolerance takes exactly one of pct (percent of the centre) and abs (column units)' });
    }
  } else if (scale === 'status' && encoding.tolerance !== undefined) {
    // A null or a bare number reaches the React table from JSON, and the
    // traffic light would read `tolerance.abs` off it.
    found.push({ key: 'tolerance', message: `tolerance takes an object, { pct } or { abs }, not ${encoding.tolerance === null ? 'null' : `a ${typeof encoding.tolerance}`}; drop tolerance for the default of 5 % of the centre` });
  }
  if (scale === 'status') {
    for (const key of ['steps', 'bins', 'cap'] as const) {
      if (encoding[key] !== undefined) {
        found.push({ key, message: `scale 'status' paints three fixed grounds (good, warn, bad) and reads no ${key}; drop ${key}` });
      }
    }
  }
  return found;
}

/** The findings the React table refuses for its heat encodings, with the CLI's code, path and remove patch. */
export function heatEncodingRefusals(encodings: Record<string, unknown> | undefined): { code: string; message: string; path: string; fix: { op: 'remove'; path: string }[] }[] {
  return Object.entries(encodings ?? {}).flatMap(([columnId, encoding]) => {
    if (encoding === null || typeof encoding !== 'object' || (encoding as { type?: unknown }).type !== 'heat') return [];
    return heatOptionsWithoutEffect(encoding as { scale?: unknown }).map(({ key, message }) => ({
      code: 'invalid-options',
      message,
      path: `options.encodings.${columnId}.${key}`,
      fix: [{ op: 'remove' as const, path: toJsonPointer(['options', 'encodings', columnId, key]) }],
    }));
  });
}
