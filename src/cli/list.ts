/** `list`: the chart catalogue. */
import '../core/charts';
import { buildCatalog } from '../core/catalog';
import { ok, type VerbResult } from './result';

export function list(): VerbResult {
  return ok(buildCatalog());
}
