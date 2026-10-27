/**
 * Declared units. A measure's unit comes from the data: the
 * series' own `unit`, else the chart's `options.unit`. It is never guessed
 * from a series name. Series drawn against one value scale must declare the
 * same unit; the first that does not is refused with its path and a fix the
 * calling layout names (a titled secondary axis, independent panes).
 */
import type { LintWarning } from '../types/scene';

/** A unit as declared, compared without spacing: '€m' and '€ m' are one unit. */
function unitKey(unit: string | undefined): string | undefined {
  const key = unit?.replace(/\s+/g, '');
  return key ? key : undefined;
}

interface UnitConflict {
  /** Index of the refused series in the array handed in. */
  index: number;
  unit: string;
  /** The unit the scale already carries: the chart unit or an earlier series'. */
  against: string;
}

/**
 * The first series whose declared unit differs from the unit its scale
 * already carries. The scale's unit is `chartUnit` when given, else the first
 * series that declares one. A series without a unit reads the scale's.
 */
export function unitConflict(series: readonly { unit?: string }[], chartUnit?: string): UnitConflict | undefined {
  let against = chartUnit?.trim() || undefined;
  for (const [index, entry] of series.entries()) {
    const unit = entry.unit?.trim();
    if (!unit) continue;
    if (against === undefined) against = unit;
    else if (unitKey(unit) !== unitKey(against)) return { index, unit, against };
  }
  return undefined;
}

/**
 * The refusal a layout raises for a conflict. `seriesIndex` is the series'
 * index in `data.series` (the path names it), `scale` names the shared scale
 * in the message ("the primary axis", "the shared scale") and `suggest` is
 * the fix the type supports.
 */
export function unitConflictRefusal(
  conflict: UnitConflict, seriesId: string, seriesIndex: number, scale: string, suggest: string, chartUnit?: string,
): LintWarning {
  return {
    code: 'unit-conflict',
    severity: 'error',
    message: `series '${seriesId}' is declared in ${conflict.unit}, but ${scale} is in ${conflict.against}; one scale cannot carry two units`,
    suggest: chartUnit?.trim()
      ? `${suggest}. If the chart-level unit is wrong, correct options.unit; each series.unit on this scale must agree with it.`
      : suggest,
    field: ['data', 'series', seriesIndex, 'unit'],
  };
}
