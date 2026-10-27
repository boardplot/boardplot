import { isHatchPattern } from '../core/svgPath';
import type { CSSProperties } from 'react';
import { resolvePaint } from '../core/svg/paint';
import { hatchPaint, unsetRolesAsFallback } from '../core/theme';
import { haloPaint } from '../core/haloPaint';
import type { Geometry, Paint } from '../core/types/scene';
import type { Theme } from '../core/types/theme';

export type ScenePaint = (paint: Paint) => string;

/** Each SVG owns its variables, so nested providers and direct themes cannot leak. */
export function scenePaint(geometry: Pick<Geometry, 'scene'>, theme: Theme) {
  const names = new Map<string, string>();
  const style: Record<string, string> = {};
  const paint: ScenePaint = source => {
    if ('css' in source) return resolvePaint(source, theme);
    // A selected mark names `focus` and a spark line `spark`; a theme
    // without the role shares one variable between it and the role it falls
    // back to.
    const key = JSON.stringify(unsetRolesAsFallback(source, [theme]));
    let name = names.get(key);
    if (!name) {
      name = `--bp-paint-${names.size}`;
      names.set(key, name);
      style[name] = resolvePaint(source, theme);
    }
    return `var(${name})`;
  };
  const background = paint({ token: 'background' });
  for (const node of geometry.scene) {
    if ('fill' in node && node.fill) paint(node.fill);
    if ('stroke' in node && node.stroke) paint(node.stroke);
    if (node.t === 'text') {
      paint(node.ink);
      if (node.halo) paint(haloPaint(node.ink, theme));
    }
    if ((node.t === 'rect' || node.t === 'path') && isHatchPattern(node.pattern) && node.fill) {
      paint(hatchPaint(node.fill, theme, node.t === 'rect' ? node.hatchGround : undefined, node.hatch));
      if (node.t === 'rect' && node.hatchGround) paint(node.hatchGround);
    }
  }
  return { paint, background, style: style as CSSProperties };
}
