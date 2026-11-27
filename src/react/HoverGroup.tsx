"use client";

import { useState, type ReactElement, type ReactNode } from 'react';
import { HoverGroupContext, type HoverGroupStore, type HoverLink } from './hoverGroupContext';

export interface HoverGroupProps {
  children?: ReactNode;
}

function createStore(): HoverGroupStore {
  let value: HoverLink | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(source, link) {
      // The same chart on the same category and series changes nothing. A clear from a chart that no longer owns the hover is dropped.
      if (link ? value?.source === source && value.categoryId === link.categoryId && value.seriesId === link.seriesId : value?.source !== source) return;
      value = link && { source, ...link };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * Links the hover of every chart inside it: hovering or focusing a point in
 * one chart highlights the same category in the others. It renders no element.
 */
export function HoverGroup({ children }: HoverGroupProps): ReactElement {
  const [store] = useState(createStore);
  return <HoverGroupContext.Provider value={store}>{children}</HoverGroupContext.Provider>;
}
