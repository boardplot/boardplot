import { useEffect, useMemo, useRef, useState } from 'react';
import { HIDDEN_SERIES } from '../core/hiddenSeriesKey';
import { chartRefusals, isSizeDependentRefusal } from '../core/schema/refusals';
import type { LintWarning } from '../core/types/scene';
import { noZoom, type ZoomHook } from './zoomHook';

const NONE: string[] = [];

/**
 * The view hook of a column or bar chart, in the slot the zoom hook of a line chart takes: a click on a legend entry
 * (the swatch or the label, or Enter or Space on the label) hides that series, and the next click shows it again.
 * The page that passes `onSeriesClick` takes the click, and `hover={false}` is the static chart: then every series
 * shows. The hidden ids reach the layout on the options (hiddenSeries.ts), so the layouts, the hover card and the
 * picture read one list. The buttons are set on the drawn legend after mount, so the server HTML and the hydrating
 * render have none, and only the entries of these two types carry this code.
 */
export const useLegendClick: ZoomHook = (input) => {
  // Rows that are still loading or refused leave no data yet.
  const ids = ((input.data as { series?: { id: string; role?: string }[] } | undefined)?.series ?? []).flatMap((s) => (s.role ?? 'data') === 'data' ? [s.id] : []);
  // One data series has nothing to hide: the last series shown stays.
  // A tornado and a football field lay their rows out of the series cases, so they offer no legend click.
  const variant = input.options.variant;
  const offered = ids.length > 1 && input.hover !== false && input.onSeriesClick === undefined && variant !== 'tornado' && variant !== 'football-field';
  const [list, setList] = useState(NONE);
  // New data keeps the hidden series it still has, and never all of them.
  const key = ids.join('\0');
  const hidden = useMemo(() => {
    const kept = list.filter((id) => ids.includes(id));
    return offered && kept.length < ids.length ? kept : NONE;
  }, [list, key, offered]);
  const options = useMemo(() => (hidden.length ? { ...input.options, [HIDDEN_SERIES]: hidden } : input.options), [input.options, hidden]);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const refused = useRef(false);
  useEffect(() => {
    // A refusal card has no legend to click a series back, and an offer that ends leaves no control: every series shows.
    if (!offered || refused.current) setList(NONE);
    if (!element) return;
    element.onclick = element.onkeydown = offered ? (event: Event) => {
      const id = (event.target as Element).closest('[data-bp-legend-item]')?.getAttribute('data-bp-legend-item');
      if (!id || !ids.includes(id) || event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      // The last series shown stays.
      setList(hidden.includes(id) ? hidden.filter((other) => other !== id) : ids.every((other) => other === id || hidden.includes(other)) ? hidden : [...hidden, id]);
    } : null;
    // The entry of a data series takes the pointer, and its label is a button that says whether the series shows. Every
    // other entry loses what this hook set on it: the offer ended, or React reuses the node for another entry. Only the
    // page's onSeriesClick has React draw a pointer and a button on the legend, and those stay.
    element.querySelectorAll<SVGElement>('[data-bp-legend-item]').forEach((node) => {
      const id = node.getAttribute('data-bp-legend-item')!;
      const label = node.dataset.part === 'legendLabel';
      if (offered && ids.includes(id)) {
        node.style.cursor = 'pointer';
        if (label) node.setAttribute('role', 'button'), node.setAttribute('tabindex', '0'), node.setAttribute('aria-pressed', String(!hidden.includes(id)));
        return;
      }
      node.removeAttribute('aria-pressed');
      if (input.onSeriesClick === undefined) node.removeAttribute('role'), node.removeAttribute('tabindex'), node.style.cursor = '';
    });
  });
  return { ...noZoom(input), options, derived: hidden.length > 0, attach: setElement,
    seen: (geometry) => { refused.current = geometry !== undefined && chartRefusals((geometry as unknown as { warnings: LintWarning[] }).warnings).some((warning) => !isSizeDependentRefusal(warning)); } };
};
