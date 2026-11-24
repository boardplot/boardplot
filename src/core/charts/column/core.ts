import { withEventsDescribed } from '../../eventReading';
import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
import { HOST_CLAIMS } from '../../claims/ids';
import { hasCompleteTextWidths } from '../../fontMetrics/injected';
import { defaultMeasurer, type FontSpec } from '../../text';
import { canvasMargin } from '../../theme';
import { stepDownFont } from '../../label/rowFit';
import { textScaleOf } from '../../typeFloors';
import { chartTheme } from '../chartEnv';
import { fitsInside } from '../band/labels';
/** Zod-free column chart registration. */

import { prepareRangeData } from '../../rangeRules';
import { captionSizedPanelLayouts, type ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';
import { stepToBar, withoutPatchesThatStep } from './stepToBar';
import { layoutColumn, type ColumnDerived, type ColumnMarks } from './layout';

// These settings keep the segment text, font ladder and note policy fixed as a plain stack grows.
const widthBoundOptions = new Set([
  'variant', 'referenceStyle', 'size', 'mode', 'target', 'title', 'subtitle', 'source', 'unit', 'unitShown',
  'footnotes', 'authoredFootnotes', 'notes', 'theme', 'locale', 'format', 'strings', 'measure', 'legend',
  'margin', 'textScale', 'textSize', 'canvas',
]);

export const columnCore: ChartCore<
  ChartData,
  ColumnOptions,
  ColumnMarks,
  ColumnDerived
> = {
  type: 'column',
  sizing: chartSizing('column'),
  title: 'Column',
  summary:
    'Grouped, stacked, or 100%-stacked vertical bars; stacked columns can integrate an external PY tick and derived growth',
  layout: (data, options) => {
    const prepared = prepareFractionData(data);
    const column = layoutColumn(prepared, options);
    return withEventsDescribed(stepToBar(prepared, options ?? {}, column) ?? withoutPatchesThatStep(prepared, options ?? {}, column), options);
  },
  notesBoundByWidth(data, options, geometry, noted) {
    const measure = options.measure ?? defaultMeasurer;
    if (options.variant !== 'stacked' || !hasCompleteTextWidths(measure) || HOST_CLAIMS in options
      || noted.some(label => label.kind !== 'segment' || !label.noted || label.slots.length !== 0)
      || options.annotations?.length || Object.keys(options).some(key => key !== 'annotations' && !widthBoundOptions.has(key))) return false;
    // Dated categories cannot step to horizontal bars. A total cannot replace
    // a value in a stack with more than one nonzero part.
    const bars = geometry.marks.bars;
    if (!bars.length || bars.length !== data.categories.length || bars.some(bar => (bar.segments?.length ?? 0) < 2)
      || data.categories.some(category => !category.date || category.role || category.partial)
      || data.series.some(series => series.role || series.values.some(value => typeof value !== 'number' || !(value > 0)))) return false;
    const width = geometry.size.width;
    const theme = chartTheme({ ...options, size: geometry.size });
    const margin = { ...canvasMargin(theme, width), ...options.margin };
    if (margin.left < 0 || margin.right < 0) return false;
    const maxBand = Math.ceil(Math.max(10, width) / bars.length);
    let font: FontSpec = { family: theme.type.family, ...theme.type.label };
    let smaller;
    while ((smaller = stepDownFont(theme, font, 'label', options.target, textScaleOf(options)))) font = smaller;
    // This upper bound gives the entire canvas to the marks. Test the
    // smallest possible label font against the tight inside and digit seats.
    const widest = { x: 0, y: 0, w: maxBand, h: Infinity };
    return noted.every(label => {
      const ink = measure(label.text, font);
      return !fitsInside(widest, ink, 0) && ink.width + 4 > maxBand;
    });
  },
  categoryLabels: (categories, language) => calendarCategories(categories, language, true),
  defaults: { variant: 'grouped', referenceStyle: 'tick' },
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout', 'valueLine', 'indicator100', 'abs', 'event', 'band', 'text', 'line', 'arrow', 'box'],
  prepare: prepareRangeData
};

captionSizedPanelLayouts.add(columnCore.layout);
