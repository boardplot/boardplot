"use client";

/**
 * The context a chart reads to follow the hover of the other charts inside
 * one `HoverGroup`. It stays small on purpose: every chart entry links it,
 * and the store itself lives with the provider.
 */

import { createContext } from 'react';
import type { Id } from '../core/types/cell';

/** The hovered category, the pointed series, and the chart that owns the hover. */
export interface HoverLink { source: object; categoryId: Id; seriesId?: Id }

export interface HoverGroupStore {
  get(): HoverLink | undefined;
  /** Without `link` it clears, and only the clear of the owning chart counts. */
  set(source: object, link?: Omit<HoverLink, 'source'>): void;
  subscribe(listener: () => void): () => void;
}

/** Undefined when no provider is above the chart, so a standalone chart is unchanged. */
export const HoverGroupContext = createContext<HoverGroupStore | undefined>(undefined);
