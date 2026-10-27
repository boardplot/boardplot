import type { ChartCore } from './registry';

/** A chart's data with its categories named as its axis names them (dates as "7 Sep"). */
export function withCalendarLabels<D>(data: D, language: string | undefined, label: NonNullable<ChartCore['categoryLabels']>): D {
  const categories = (data as { categories?: unknown } | null)?.categories;
  if (!Array.isArray(categories)) return data;
  const labelled = label(categories, language);
  return labelled ? { ...data, categories: labelled } : data;
}

/**
 * A category's name in a note: a date period across more than one
 * calendar year carries its year ("Nov 2023", not "Nov"), so each period is
 * named once in the chart; any other category reads as its label or id.
 */
export function noteName(category: { id: string; label?: string }): string {
  return (category as { calendar?: { named?: string } }).calendar?.named ?? category.label ?? category.id;
}
