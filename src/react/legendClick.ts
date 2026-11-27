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
    element.onclick = offered ? (event: Event) => {
      const id = (event.target as Element).closest<HTMLElement>(`${ITEM},[data-bp-legend-key]`)?.dataset;
      const at = id?.bpLegendItem ?? id?.bpLegendKey;
      if (!at || !ids.includes(at)) return;
      event.preventDefault();
      // The last series shown stays.
      setList(hidden.includes(at) ? hidden.filter((other) => other !== at) : ids.every((other) => other === at || hidden.includes(other)) ? hidden : [...hidden, at]);
    } : null;
    // A pointer clicks the drawn entry. The keyboard and a screen reader reach one button per series beside the SVG,
    // which keeps role="img" and so holds no control. Each button lies over its label, so its focus ring shows there.
    let keys = element.querySelector<HTMLElement>(':scope > [data-bp-legend-keys]');
    if (offered && !keys) {
      keys = element.appendChild(document.createElement('div'));
      keys.dataset.bpLegendKeys = '';
    }
    const labels = new Map<string, Element>();
    element.querySelectorAll<SVGElement>(ITEM).forEach((node) => {
      const id = node.dataset.bpLegendItem!;
      const shown = offered && ids.includes(id);
      if (shown) node.style.cursor = 'pointer';
      else if (ownsClick) node.style.cursor = '';
      if (shown && node.dataset.part === 'legendLabel') labels.set(id, node);
    });
    if (!offered) return void keys?.remove();
    // A button that stays keeps its place in the DOM, so the focus stays on it while its series toggles.
    const old = new Map(Array.from(keys!.children as HTMLCollectionOf<HTMLButtonElement>, (button) => [button.dataset.bpLegendKey!, button]));
    let at = 0;
    labels.forEach((node, id) => {
      let button = old.get(id);
      old.delete(id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.bpLegendKey = id;
        button.style.cssText = 'position:absolute;pointer-events:none;padding:0;border:0;background:none;color:transparent;font-size:0';
      }
      button.textContent = node.textContent;
      button.setAttribute('aria-pressed', String(!hidden.includes(id)));
      button.onfocus = () => {
        const box = node.getBoundingClientRect();
        const frame = element.getBoundingClientRect();
        Object.assign(button!.style, { left: `${box.left - frame.left}px`, top: `${box.top - frame.top}px`, width: `${box.width}px`, height: `${box.height}px` });
      };
      if (keys!.children[at] !== button) keys!.insertBefore(button, keys!.children[at] ?? null);
      at++;
    });
    old.forEach((button) => button.remove());
  });
  return { ...noZoom(input), options, derived: hidden.length > 0, attach: setElement,
    seen: (geometry) => { refused = geometry !== undefined && !chartRefusals((geometry as unknown as { warnings: LintWarning[] }).warnings).every(isSizeDependentRefusal); } };
};
