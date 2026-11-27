import { linkStoryLayer } from '../../core/storyLayer';
import { linkAnnotateEngine } from '../../core/annotateEngine';
import { linkThemeShapeRules } from '../../core/themeShapeRules';
import { exportSvg } from './svg';
import { exportCsv } from './csv';
import { exportPng, renderPng } from './png';

/**
 * The export engine: layout, the schema and the renderers. The entry loads it at the first export call. The links
 * run through this call, not at module scope, because a host bundler can drop the body of a chunk it treats as free
 * of side effects; with them a patched theme and annotations lay out synchronously.
 */
export function linkedEngine() {
  linkThemeShapeRules();
  linkAnnotateEngine();
  linkStoryLayer();
  return { exportSvg, exportCsv, exportPng, renderPng };
}
