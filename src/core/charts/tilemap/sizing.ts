import { chartSizing } from '../../sizing';
import type { ChartSizing } from '../../types/sizing';

/**
 * A dashboard card of 320 px still holds the grid: eu27 keeps 24 px tiles
 * there, wide enough for a two-letter code at the 13 px floor. Narrow tiles
 * drop their values first, then the bold weight of their codes. Like the
 * choropleth, its height is its content: a narrower card is not padded
 * to the height of the next wider one.
 */
export const TILEMAP_SIZING = { ...chartSizing('tilemap'), minWidth: 320, aspect: 'content', fit: 'content' } as const satisfies ChartSizing;
