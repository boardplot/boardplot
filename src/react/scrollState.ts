/** Where a table's or a scrolling chart's own scroller stands: what a minimap or an edge fade draws. */
export interface TableScrollState {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  /** The vertical twin of the three above, for a scroller that fills a height. */
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /**
   * The px a vertical and a horizontal scrollbar take from the scroller's
   * box, 0 where there is none or the platform overlays it: offset size
   * minus client size. An edge fade stays inside them.
   */
  gutterRight: number;
  gutterBottom: number;
}

/** The scroll state of a scroller, or all zeros before it mounts. */
export function scrollStateOf(scroller: HTMLElement | null): TableScrollState {
  if (scroller === null) {
    return { scrollLeft: 0, scrollWidth: 0, clientWidth: 0, scrollTop: 0, scrollHeight: 0, clientHeight: 0, gutterRight: 0, gutterBottom: 0 };
  }
  return {
    scrollLeft: scroller.scrollLeft,
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    gutterRight: Math.max(0, scroller.offsetWidth - scroller.clientWidth),
    gutterBottom: Math.max(0, scroller.offsetHeight - scroller.clientHeight),
  };
}

/**
 * A scroller whose content overflows takes keyboard focus and a name, so a
 * keyboard reader can scroll it with the arrow keys (WCAG 2.1.1; axe
 * scrollable-region-focusable). One that fits gives both back. Set on the
 * live element, so the server markup stays as it was.
 */
export function markScrollRegion(scroller: HTMLElement, label: string): void {
  const overflows = scroller.scrollWidth > scroller.clientWidth + 1 || scroller.scrollHeight > scroller.clientHeight + 1;
  if (overflows) {
    if (scroller.getAttribute('tabindex') !== '0') scroller.setAttribute('tabindex', '0');
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', label);
  } else if (scroller.hasAttribute('tabindex')) {
    scroller.removeAttribute('tabindex');
    scroller.removeAttribute('role');
    scroller.removeAttribute('aria-label');
  }
}
