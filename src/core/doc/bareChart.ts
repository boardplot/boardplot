import { isRecord } from '../lint/shared';

/** A spec without `charts` and `version` is one bare chart. */
export function isBareChart(input: unknown): input is Record<string, unknown> {
  return isRecord(input) && !Object.hasOwn(input, 'charts') && !Object.hasOwn(input, 'version');
}
