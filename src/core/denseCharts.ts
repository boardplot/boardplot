/**
 * A chart with more categories than this is dense. Line and combo draw no point
 * markers past it, and column, bar and combo keep only the first, last, highest
 * and lowest value labels sure of a seat. One cut-off, so "dense" means the same
 * thing for markers and for labels.
 */
export const DENSE_CATEGORY_COUNT = 12;
