import { keylessFitBounds } from '../../legendPolicy';
import { bandKeyFirst, keylessAreaFits } from '../band/keylessFit';
import { withEventsDescribed } from '../../eventReading';
import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
import { hasCompleteTextWidths } from '../../fontMetrics/injected';
import { defaultMeasurer } from '../../text';
import { canvasMargin } from '../../theme';
import { keylessFrame, type InternalFootnoteOptions } from '../../frame';
import { chartTheme } from '../chartEnv';
import { fitsInside, INSIDE_MIN_W } from '../band/labels';
/** Zod-free combo chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { BaseOptions, ComboOptions } from '../../types/options';
import { withLocaleStrings } from '../../strings';
import { rankKeyShown } from '../../notes';
import { resolveComboEnv, resolveComboDomain, TOTALS_AXIS } from './domain';
import { comboPaints, comboPlotArea, solveComboFrame } from './plot';
import { layoutCombo, type ComboDerived, type ComboMarks } from './layout';

export const comboCore: ChartCore<ChartData, BaseOptions, ComboMarks, ComboDerived> = {
  type: 'combo',
  frameOwnsSourceLimit: true,
  sizing: chartSizing('combo'),
  title: 'Combo',
  summary: 'Stacked columns with line/area overlays; gated, tick-synced secondary axis',
  layout: (data, options) => withEventsDescribed(layoutCombo(prepareFractionData(data), options as ComboOptions | undefined), options),
  notesBoundByWidth(data, options, geometry, noted) {
    const measure = options.measure ?? defaultMeasurer;
    if (!hasCompleteTextWidths(measure) || (options as InternalFootnoteOptions).footnotesOff
      || options.annotations?.length || (options as ComboOptions).averageMarker
      || options.labels !== undefined || options.labelPlacements || options.labelOffsets
      || noted.some(label => label.kind !== 'segment' || !label.noted || !label.noteText || label.slots.length > 0)
      || data.series.some(s => s.role === 'reference' || s.kind === 'area' || s.values.some(v => typeof v !== 'number'))) return false;
    // A total may speak for the only nonzero part of a stack.
    const columns = geometry.marks.columns;
    if (!columns.length || columns.some(column => column.segments.length < 2)) return false;
    const width = geometry.size.width;
    const theme = chartTheme({ ...options, size: geometry.size });
    const margin = { ...canvasMargin(theme, width), ...options.margin };
    if (margin.left < 0 || margin.right < 0) return false;
    // Even a plot occupying the entire canvas cannot give a column more
    // than one equal category step. Gutters, insets and gaps only take room.
    const maxWidth = Math.ceil(Math.max(10, width) / columns.length);
    if (maxWidth >= INSIDE_MIN_W) return false;
    const rect = { x: 0, y: 0, w: maxWidth, h: Infinity };
    const font = { family: theme.type.family, ...theme.type.label };
    // Plain segment values use the same data, format and width-class font at
    // every height. A segment that fails even the tight inside seat is named.
    return noted.every(label => !fitsInside(rect, measure(label.text, font), 0));
  },
  categoryLabels: (categories, language) => calendarCategories(categories, language, true),
  prepare: prepareFractionData,
  defaults: {},
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout', 'valueLine', 'abs', 'event', 'band', 'text', 'line', 'arrow', 'box']
};

export const comboKeyFirst = bandKeyFirst((data, options, opening) => {
  const size = { width: (options.size as { width: number }).width, height: opening };
  const base = withLocaleStrings({ ...options, size }) as ComboOptions;
  const prepared = prepareFractionData(data);
  const alternatives = base.valueAxis?.show === undefined ? [base, { ...base, [TOTALS_AXIS]: true }] : [base];
  return alternatives.every(next => {
    const warnings: import('../../types/scene').LintWarning[] = [];
    const env = resolveComboEnv(next, warnings);
    const domain = resolveComboDomain(prepared, next, warnings, env.theme);
    if (domain.secondaryActive || domain.anomaly || domain.lineFloat || domain.options.averageMarker
      || domain.dHi < 0 && domain.negBot.some(bottom => bottom < 0)) return false;
    const paints = comboPaints(env, domain);
    const framed = solveComboFrame(env, domain, paints, warnings);
    const measured = keylessFrame(framed.frame);
    if (!measured) return false;
    const { frame, printedDisclosure } = measured;
    const area = comboPlotArea(env, domain, paints, { ...framed, frame }, undefined, warnings, true);
    // An endpoint retry can narrow a nominal category row and add pointed notes for its cut names.
    if (area.showCatTickRow && rankKeyShown(options) && !area.catPlan.dateNumeric
      && (domain.lines.length || area.catPlan.step !== 'fit' || !area.catPlan.keep.every(Boolean))) return false;
    return keylessAreaFits(options, frame, area.plot, opening, printedDisclosure);
  });
});

keylessFitBounds.set(comboCore, comboKeyFirst);
