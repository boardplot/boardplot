import { withBlankCategoryLabelsOmitted, withCalendarLabels } from './calendarData';
import { getChart } from './registry';

/**
 * A panel's data as its note names it: a chart that reads its categories as
 * dates names them as its axis does ("7 Sep"), as a single chart's note does.
 */
export function panelNoteData(type: string, data: unknown, language?: string): unknown {
  const def = getChart(type);
  const named = withBlankCategoryLabelsOmitted(data);
  return def?.categoryLabels ? withCalendarLabels(named, language, def.categoryLabels) : named;
}
