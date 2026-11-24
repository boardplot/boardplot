import type { ChartCore } from './registry';
import type { Category } from './types/data';

/** Grid records and notes name a blank category the same way they name an omitted label. */
export function withBlankCategoryLabelsOmitted<D>(data: D): D {
  const categories = (data as { categories?: (Category | string)[] } | null)?.categories;
  const blank = (category: Category | string): category is Category => typeof category === 'object' && category?.label === '';
  if (!Array.isArray(categories) || !categories.some(blank)) return data;
  return { ...data, categories: categories.map(category => blank(category) ? { ...category, label: undefined } : category) };
}

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
