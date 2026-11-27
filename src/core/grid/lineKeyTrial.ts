/** Every raw draw of the provisional line must also be the drawing the grid key would select. */
export const GRID_LINE_KEY_TRIAL = Symbol('gridLineKeyTrial');
export interface GridLineKeyTrial { calls: number; same: boolean }

/**
 * On a narrow canvas a plain line whose
 * end names do not fit names its lines where they are drawn, not in a key
 * row; the key row stays the fallback when an inline name finds no seat.
 */
export const INLINE_FALLBACK_MAX_WIDTH = 480;
