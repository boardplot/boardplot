import { statedInPercent } from '../stackAdds';
import { formatExampleProblem, parseFormatExample } from '../formatSpec';
import type { DocLintWarning } from './index';
import {
  categoriesOf,
  asRecord,
  cellNumber,
  cellsOfSeries,
  formatValuePairs,
  hasAuthoredFootnote,
  labelOf,
  records,
  seriesOf,
  warning,
  type LintRecord,
  type ScopedLintChart,
} from './shared';

/** An ISO day, month, quarter or week: a category id that names one period. */
const ISO_PERIOD = /^\d{4}-(?:\d{2}(?:-\d{2})?|Q[1-4]|W\d{2})$/;

/**
 * A series' number for one category: its `{ categoryId, value }` entry in a
 * keyed list, where a missing category has none, else the value at the
 * category's index.
 */
function cellAt(series: LintRecord, categoryId: unknown, index: number): number | null {
  const values = Array.isArray(series.values) ? series.values : [];
  const isKeyed = (entry: unknown): entry is LintRecord => entry !== null && typeof entry === 'object' && 'categoryId' in entry;
  if (!values.some(isKeyed)) return cellNumber(values[index]);
  const keyed = values.find((entry) => isKeyed(entry) && entry.categoryId === categoryId) as LintRecord | undefined;
  return keyed === undefined ? null : cellNumber(keyed.value);
}

const PARTIAL_PERIOD = /\b(?:YTD|H1|Q1\s*[\u2013\u2014-]\s*3)\b/i;
const FULL_PERIOD = /\b(?:FY(?:\s*(?:20)?\d{2})?|20\d{2})\b/i;
const BASIS_CHANGE = /\b(?:restated|pro\s+forma|adjusted|rebased)\b/i;

export function runHonestyLints(charts: readonly ScopedLintChart[]): DocLintWarning[] {
  const warnings: DocLintWarning[] = [];

  for (const chart of charts) {
    const labels = comparisonLabels(chart);
    const hasPartial = labels.some((label) => PARTIAL_PERIOD.test(label));
    const hasFull = labels.some((label) => !PARTIAL_PERIOD.test(label) && FULL_PERIOD.test(label));
    if (hasPartial && hasFull && !hasAuthoredFootnote(chart)) {
      warnings.push(
        warning(
          chart,
          'partial-period-pairing',
          'warn',
          'partial period compared to full period - footnote the basis or align periods',
          'add an explanatory footnote or compare like-for-like periods',
        ),
      );
    }
  }

  for (const chart of charts) {
    if (hasAuthoredFootnote(chart)) continue;
    const changed = seriesOf(chart).filter((series) => BASIS_CHANGE.test(labelOf(series) ?? ''));
    if (changed.length > 0) {
      warnings.push(
        warning(
          chart,
          'basis-change',
          'warn',
          `series '${changed.map((series) => labelOf(series)).join("', '")}' changes the comparison basis without a footnote`,
          "footnote what was restated, pro forma, adjusted, or rebased",
          changed.length === 1 && typeof changed[0]!.id === 'string' ? { seriesId: changed[0]!.id } : undefined,
        ),
      );
    }
  }

  for (const chart of charts) {
    const options = chart.options ?? {};
    if ((chart.type !== 'column' && chart.type !== 'bar') || (options.variant !== 'stacked' && options.variant !== 'stacked100')) {
      continue;
    }
    // A name like "Product margin" stacks when its unit is money or a
    // count; only a series stated in percent (its name, or its own or the
    // chart's unit) cannot stack.
    const unitOf = (series: Record<string, unknown>): string =>
      typeof series.unit === 'string' ? series.unit : typeof options.unit === 'string' ? options.unit : '';
    const stacked = seriesOf(chart).filter((series) => series.role !== 'reference');
    // shares the author declared parts of one whole stack, whatever
    // their names and units; a sum over 100 says they are not. A sum under
    // 100 alone proves nothing.
    if (options.sharesOfOneWhole === true) {
      const over = categoriesOf(chart).filter((category, index) =>
        stacked.reduce((sum, series) => sum + (cellAt(series, category.id, index) ?? 0), 0) > 100.5);
      if (over.length > 0) {
        warnings.push(
          warning(
            chart,
            'non-additive-stack',
            'warn',
            `series declared sharesOfOneWhole add to more than 100 in '${over.map((category) => labelOf(category)).join("', '")}' - shares of one whole cannot`,
            'check the shares, or remove sharesOfOneWhole if they are shares of different wholes',
            over.length === 1 && typeof over[0]!.id === 'string' ? { categoryId: over[0]!.id } : undefined,
          ),
        );
      }
      continue;
    }
    const offending = stacked.filter((series) => statedInPercent(labelOf(series) ?? '', unitOf(series),
      cellsOfSeries(series).some((cell) => cell !== null && typeof cell === 'object' && 'pct' in cell)));
    if (offending.length === 0) continue;
    warnings.push(
      warning(
        chart,
        'non-additive-stack',
        'warn',
        `non-additive series '${offending.map((series) => labelOf(series)).join("', '")}' is stacked - percentages do not stack unless they are shares of one whole (options.sharesOfOneWhole)`,
        'use grouped columns/bars or a line instead, or set sharesOfOneWhole: true when every series is a share of the same whole',
        offending.length === 1 && typeof offending[0]!.id === 'string' ? { seriesId: offending[0]!.id } : undefined,
      ),
    );
  }

  for (const chart of charts) {
    const counts = new Map<string, number>();
    const datesByLabel = new Map<string, (string | undefined)[]>();
    const categories = categoriesOf(chart);
    const data = asRecord(chart.data);
    const periods = chart.type === 'grid' && asRecord(chart.options).stack && Array.isArray(data.measures) ? records(data.periods) : [];
    for (const [index, category] of categories.entries()) {
      const period = periods.find(p => {
        const from = categories.findIndex(c => c.id === p.from), to = categories.findIndex(c => c.id === p.to);
        return from >= 0 && index >= from && index <= to;
      });
      // A stack's period row disambiguates repeating month labels on its one axis.
      const label = period ? `${String(period.label)} / ${labelOf(category)}` : labelOf(category);
      // A blank label is a name left out on purpose, not a copy of another.
      if (label !== null && label.trim() !== '') {
        counts.set(label, (counts.get(label) ?? 0) + 1);
        // A month name that comes back in another year names another period, not a copy.
        const date = typeof category.date === 'string' ? category.date : typeof category.id === 'string' && ISO_PERIOD.test(category.id) ? category.id : undefined;
        const dates = datesByLabel.get(label) ?? [];
        dates.push(date);
        datesByLabel.set(label, dates);
      }
    }
    const duplicates = [...counts].filter(([label, count]) => {
      if (count < 2) return false;
      const dates = datesByLabel.get(label)!;
      return !(dates.every((date) => date !== undefined) && new Set(dates).size === dates.length);
    }).map(([label]) => label);
    if (duplicates.length > 0) {
      warnings.push(
        warning(
          chart,
          'duplicate-category-labels',
          'warn',
          `duplicate category label${duplicates.length === 1 ? '' : 's'}: ${duplicates.join(', ')}`,
          'use unique category labels and check for copy-paste artifacts',
        ),
      );
    }
  }

  for (const chart of charts) {
    const offending = formatValuePairs(chart).find(
      // A format the schema refused already has its finding; it judges nothing here.
      ({ format, value }) => Math.abs(value) >= 1000 && !formatExampleProblem(format) && parseFormatExample(format).decimals >= 3,
    );
    if (offending) {
      warnings.push(
        warning(
          chart,
          'spurious-precision',
          'warn',
          `format example '${offending.format}' shows at least 3 decimals for values at or above 1000`,
          'round large values to a decision-useful precision',
        ),
      );
    }
  }

  return warnings;
}

function comparisonLabels(chart: ScopedLintChart): string[] {
  if (chart.type === 'table') {
    return records((chart.data as Record<string, unknown> | null)?.columns)
      .map(labelOf)
      .filter((label): label is string => label !== null);
  }
  return seriesOf(chart)
    .map(labelOf)
    .filter((label): label is string => label !== null);
}
