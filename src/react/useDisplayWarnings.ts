import { useEffect, useRef, useState } from 'react';
import type { LintWarning } from '../core/types/scene';
import type { PresentationInfo } from '../core/types/sizing';


/**
 * A layout width carries fractions (a 615.609375 px container), and the
 * browser reports the drawn width rounded to its own layout unit. Less than
 * this short of the minimum is the same width, not a smaller display.
 */
const SUBPIXEL_PX = 0.5;

/** Host measurements report warnings only. They never enter layout, preparation or exports. */
export function useDisplayWarnings(
  geometry: { warnings?: LintWarning[]; presentation?: Pick<PresentationInfo, 'target' | 'minDisplayWidth'>; refused?: boolean } | undefined,
  onWarnings?: (warnings: LintWarning[]) => void,
  selector: string | null = 'svg[data-bp-chart]',
) {
  const [wrapper, wrapperRef] = useState<HTMLElement | null>(null);
  const [observed, setObserved] = useState<{ svg: Element; width: number }>();
  const svg = selector === null ? wrapper : wrapper?.querySelector(selector);
  const enabled = onWarnings !== undefined && geometry !== undefined && !geometry.refused
    && geometry.presentation !== undefined;
  const connection = useRef<{ svg: Element; observer: ResizeObserver } | undefined>(undefined);
  // Hover can replace the SVG inside the same wrapper. Follow it after each commit.
  useEffect(() => {
    const current = enabled ? selector === null ? wrapper : wrapper?.querySelector(selector) : undefined;
    if (current === connection.current?.svg) return;
    connection.current?.observer.disconnect();
    connection.current = undefined;
    if (!current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      if (connection.current?.observer !== observer) return;
      const width = entries.find(entry => entry.target === current)?.contentRect.width;
      if (width === undefined || !Number.isFinite(width) || width <= 0) return;
      setObserved(previous => previous?.svg === current && previous.width === width ? previous : { svg: current, width });
    });
    connection.current = { svg: current, observer };
    observer.observe(current);
  });
  useEffect(() => () => {
    connection.current?.observer.disconnect();
    connection.current = undefined;
  }, []);

  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!onWarnings || !geometry) return;
    const canonical = geometry.warnings ?? [];
    const minimum = !geometry.refused ? geometry.presentation?.minDisplayWidth : undefined;
    // The width the drawing has now. An observation made before this geometry belongs to the previous
    // drawing: a growing host would otherwise report the new layout as too small for one commit.
    const live = enabled && svg ? parseFloat(getComputedStyle(svg).width) : NaN;
    const width = live > 0 ? live : observed?.svg === svg ? observed?.width : undefined;
    const below = enabled && minimum !== undefined && width !== undefined && width < minimum - SUBPIXEL_PX;
    // The width is deliberately absent: resizing within one warning state must not repeat it.
    const key = JSON.stringify([canonical, below, below ? minimum : undefined]);
    if (last.current === key) return;
    last.current = key;
    onWarnings(below ? [...canonical, {
      code: 'observed-display-too-small', severity: 'warn',
      message: `The displayed chart is narrower than its minimum display width of ${minimum} CSS px.`,
      suggest: 'Lay out the chart at the host width, provide horizontal scrolling, or offer a full-size view.',
      detail: { observedWidth: width, minDisplayWidth: minimum },
    }] : [...canonical]);
  }, [geometry, onWarnings, enabled, observed, svg]);
  return wrapperRef;
}
