import { chartSizing } from '../../sizing';
import type { ChartSizing } from '../../types/sizing';

/**
 * Slope sizing: the shared content-fit policy, with a
 * 320 px card floor. Lines draw compact end labels there (values only at the
 * first rail); diverging panels wrap to two columns.
 */
export const SLOPE_SIZING: ChartSizing = { ...chartSizing('slope'), minWidth: 320 };
