import { useEffect, useMemo, useState } from 'react';
import { HIDDEN_SERIES } from '../core/hiddenSeriesKey';
import { ranksCategories } from '../core/normalize/shared';
import { chartRefusals, isSizeDependentRefusal } from '../core/schema/refusals';
import type { ChartData } from '../core/types/data';
import type { LintWarning } from '../core/types/scene';
import { noZoom, type ZoomHook } from './zoomHook';

const NONE: string[] = [];
const ITEM = '[data-bp-legend-item]';

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
  const ids = (input.data as ChartData | undefined)?.series?.filter(ranksCategories).map((s) => s.id) ?? NONE;
  // One data series has nothing to hide: the last series shown stays.
  // A tornado and a football field lay their rows out of the series cases, so they offer no legend click.
  const variant = input.options.variant;
  const ownsClick = input.onSeriesClick === undefined;
  // A chart without a legend has no entry to click a series back.
  const offered = ids.length > 1 && input.hover !== false && ownsClick && input.options.legend !== 'none' && variant !== 'tornado' && variant !== 'football-field';
  const [list, setList] = useState(NONE);
  // New data keeps the hidden series it still has, and never all of them.
  const [hidden, options] = useMemo(() => {
    const kept = offered && list.length ? list.filter((id) => ids.includes(id)) : NONE;
    return kept.length && kept.length < ids.length
      ? [kept, { ...input.options, [HIDDEN_SERIES]: kept }] as const
      : [NONE, input.options] as const;
  }, [input.options, list, offered, list.length && ids.join('\0')]);
  const [element, setElement] = useState<HTMLElement | null>(null);
  // The chart calls seen during this render, before its effect runs.
  let refused = false;
  useEffect(() => {
    // A refusal card has no legend to click a series back, and an offer that ends leaves no control: every series shows.
    if (!offered || refused) setList(NONE);
    if (!element) return;
    element.onclick = element.onkeydown = offered ? (event: Event) => {
      const id = (event.target as Element).closest<SVGElement>(ITEM)?.dataset.bpLegendItem;
      if (!id || !ids.includes(id) || event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      // The last series shown stays.
      setList(hidden.includes(id) ? hidden.filter((other) => other !== id) : ids.every((other) => other === id || hidden.includes(other)) ? hidden : [...hidden, id]);
    } : null;
    // The entry of a data series takes the pointer, and its label is a button that says whether the series shows. Every
    // other entry loses what this hook set on it: the offer ended, or React reuses the node for another entry. Only the
    // page's onSeriesClick has React draw a pointer and a button on the legend, and those stay.
    element.querySelectorAll<SVGElement>(ITEM).forEach((node) => {
      const id = node.dataset.bpLegendItem!;
      if (offered && ids.includes(id)) {
        node.style.cursor = 'pointer';
        if (node.dataset.part === 'legendLabel') {
          node.setAttribute('role', 'button');
          node.tabIndex = 0;
          node.setAttribute('aria-pressed', String(!hidden.includes(id)));
        }
      } else {
        node.removeAttribute('aria-pressed');
        if (ownsClick) {
          node.removeAttribute('role');
          node.removeAttribute('tabindex');
          node.style.cursor = '';
        }
      }
    });
  });
  return { ...noZoom(input), options, derived: hidden.length > 0, attach: setElement,
    seen: (geometry) => { refused = geometry !== undefined && !chartRefusals((geometry as unknown as { warnings: LintWarning[] }).warnings).every(isSizeDependentRefusal); } };
};
