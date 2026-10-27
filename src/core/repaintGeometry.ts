import { decideFillEdges, marksOnBands, referenceCasings, repaintSeparation } from './markVisibility';
import { refreshPaintWarnings } from './paintWarnings';
import { groundEdges } from './label/emit';
import { paintColor, resolvePalette, resolveTheme } from './theme';
import type { GridMarks } from './grid/layoutGrid';
import type { Geometry, Paint, SceneNode } from './types/scene';
import type { Theme, ThemeRef } from './types/theme';

interface SceneThemeBinding { prefix: string; theme: ThemeRef }

/** Re-evaluate paint and its diagnostics without changing a coordinate or derived value. */
export function repaintGeometry(geometry: Geometry, theme: Theme, options?: { palette?: string }): Geometry {
  const scene = repaintScene(geometry.scene, theme, sceneThemeBindings(geometry));
  let warnings = geometry.paintWarningRules?.length
    ? refreshPaintWarnings(geometry.warnings, geometry.paintWarningRules.map(rule => rule.kind === 'mark-lost-on-band'
      ? { ...rule, pairs: marksOnBands(scene) } : rule), theme)
    : [...geometry.warnings];
  if (options?.palette && warnings.some(warning => warning.code === 'unknown-palette')) {
    let message = '';
    resolvePalette(theme, options.palette, (_code, text) => { message = text; });
    warnings = warnings.flatMap(warning => warning.code === 'unknown-palette'
      ? message ? [{ ...warning, message }] : [] : [warning]);
  }
  if (geometry.type === 'grid') {
    const panels = (geometry.marks as unknown as GridMarks).panels;
    for (const panel of [...panels].reverse()) {
      const chart = panel.chart;
      if (!chart || chart.warningOffset === undefined) continue;
      const child = repaintGeometry(chart.geometry, chart.theme ? resolveTheme(chart.theme) : theme, chart.options);
      warnings.splice(chart.warningOffset, chart.geometry.warnings.length,
        ...child.warnings.map(warning => ({
          ...warning,
          message: `[${panel.id}] ${warning.message}`,
          ...(chart.warningOwnerPrefix === undefined ? {} : {
            owner: warning.owner ? {
              ...warning.owner,
              ...(warning.owner.annotationId === undefined ? {} : { annotationId: chart.warningOwnerPrefix + warning.owner.annotationId }),
              ...(warning.owner.valueLineId === undefined ? {} : { valueLineId: chart.warningOwnerPrefix + warning.owner.valueLineId }),
            } : undefined,
          }),
        })));
    }
  }
  return { ...geometry, scene, warnings };
}

/**
 * Repaint a serialized render scene without reconstructing analytical geometry. `casings`: the
 * scene came from a new target, whose value lines take a page-colour band over a fill they read
 * at under 3:1 on; which fills need one depends on the theme, so the bands are drawn again.
 */
export function repaintScene(scene: SceneNode[], theme: Theme, bindings: SceneThemeBinding[] = []): SceneNode[] {
  const themes = bindings.map(binding => ({ ...binding, theme: resolveTheme(binding.theme) }));
  const themeOf = (node: SceneNode): Theme => {
    let activeTheme = theme;
    for (const binding of themes) if (node.id.startsWith(binding.prefix)) activeTheme = binding.theme;
    return activeTheme;
  };
  scene = referenceCasings(scene);
  const seen = new Map<Theme, Set<string>>();
  const check = (paint: Paint | undefined, activeTheme: Theme) => {
    if (!paint || !('token' in paint) || !paint.theme) return;
    const key = JSON.stringify(paint);
    const checked = seen.get(activeTheme) ?? new Set<string>();
    if (checked.has(key)) return;
    checked.add(key);
    seen.set(activeTheme, checked);
    paintColor(activeTheme, paint); // Retain contrast-exhaustion errors before claims or rendering.
  };
  const repainted = scene.map(node => {
    const activeTheme = themeOf(node);
    if ('fill' in node) check(node.fill, activeTheme);
    if ('stroke' in node) check(node.stroke, activeTheme);
    if (node.t === 'text') check(node.ink, activeTheme);
    return repaintSeparation(node, activeTheme);
  });
  // Which fills take the edge depends on the theme; re-decide from the stored inputs.
  return groundEdges(decideFillEdges(repainted, themeOf, true), themeOf, true);
}

/** Child layouts select separators using their explicit theme, including nested panels. */
export function sceneThemeBindings(geometry: Geometry, prefix = '', result: SceneThemeBinding[] = []): SceneThemeBinding[] {
  if (geometry.type !== 'grid') return result;
  for (const panel of (geometry.marks as unknown as GridMarks).panels) {
    if (!panel.chart) continue;
    const childPrefix = `${prefix}${panel.id}/`;
    if (panel.chart.theme) result.push({ prefix: childPrefix, theme: panel.chart.theme });
    sceneThemeBindings(panel.chart.geometry, childPrefix, result);
  }
  return result;
}
