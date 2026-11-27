import { keylessFitBounds } from '../../legendPolicy';
import { bandKeyFirst, keylessAreaFits, speculate } from '../band/keylessFit';
import { withEventsDescribed } from '../../eventReading';
import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { CARD_CLASS_WIDTH, chartSizing } from '../../sizing';
import { staticFrame } from '../../footer';
import { KEY_EDGE_SERIES, resolveColumnDomain } from './domain';
import { columnPaints } from './paints';
import { COLUMN_FRACTION_MAX, columnPlotArea, solveColumnFrame } from './plot';
import { COLLECT_IDENTITIES } from '../../seriesIdentity';
import { keylessFrame, LEGEND_HEIGHT } from '../../frame';
import { withLocaleStrings } from '../../strings';
import { HOST_CLAIMS } from '../../claims/ids';
import { hasCompleteTextWidths } from '../../fontMetrics/injected';
import { defaultMeasurer, type FontSpec } from '../../text';
import { canvasMargin, classStepWidth, panelTypeClass, WIDE_CANVAS_MIN_WIDTH } from '../../theme';
import { stepDownFont } from '../../label/rowFit';
import { textScaleOf } from '../../typeFloors';
import { chartTheme } from '../chartEnv';
import { rankKeyShown } from '../../notes';
import { withValueLabelDefaults } from '../band/valueSelection';
import { fitsInside } from '../band/labels';
/** Zod-free column chart registration. */

import { prepareRangeData } from '../../rangeRules';
import { captionSizedPanelLayouts, type ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';
import { barDrawsAlike, stepToBar, withoutPatchesThatStep } from './stepToBar';
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
  coveringKey(data, options, baseline) {
    const size = options.size;
    if (baseline.legend?.items.length || baseline.mode !== 'full' || options.variant !== 'stacked'
      || !options.seriesLabels || options.seriesLabels.only !== undefined || options.seriesLabels.cagr
      || !size || typeof size !== 'object' || size.height !== undefined || size.unit !== undefined || size.width !== baseline.size.width
      || size.width < CARD_CLASS_WIDTH || classStepWidth(size.width) >= WIDE_CANVAS_MIN_WIDTH
      || !hasCompleteTextWidths(options.measure ?? defaultMeasurer) || staticFrame.pinned || panelTypeClass(options) !== undefined || HOST_CLAIMS in options
      || COLLECT_IDENTITIES in options || options.footnotes || options.notes || baseline.frame.noteList?.some(note => note.kind !== 'source')
      || baseline.labels.some(label => label.hidden) || options.annotations?.some(annotation => annotation.kind !== 'cagr')
      || Object.keys(options).some(key => key !== 'annotations' && key !== 'seriesLabels' && !widthBoundOptions.has(key))) return;
    // A plain stack has two possible keys: no items while its edge names fit, or all series.
    // Dates keep the column form. Scenario, range and partial marks can bring additional keys.
    if (data.series.length < 2 || data.categories.some(category => !category.date || Object.keys(category).some(key => key !== 'id' && key !== 'label' && key !== 'date'))
      || data.series.some(series => Object.keys(series).some(key => key !== 'id' && key !== 'label' && key !== 'values')
        || series.values.some(value => typeof value !== 'number' || !(value > 0)))
      || Object.keys(data).some(key => key !== 'series' && key !== 'categories')) return;
    if (baseline.labels.filter(label => !label.hidden && label.id.startsWith('seriesEdge:')).length !== data.series.length) return;
    // Use the full key at the widest possible gutters. The value axis can only narrow those gutters.
    const margin = { ...canvasMargin(chartTheme({ ...options, size: baseline.size }), size.width), ...options.margin };
    if (!(margin.left >= 0 && margin.right >= 0)) return;
    // A failure specific to the speculative frame belongs to the ordinary key decision.
    return speculate(() => {
      const forced = { ...withLocaleStrings(options), size: baseline.size, margin, [KEY_EDGE_SERIES]: true, [LEGEND_HEIGHT]: undefined };
      const domain = resolveColumnDomain(data, forced, []);
      if (domain.variant !== 'stacked' || domain.annList.some(annotation => annotation.kind !== 'cagr')) return;
      const key = solveColumnFrame(domain, columnPaints(domain, []), []).frame;
      if (key.legend?.items.length !== data.series.length) return;
      const names = key.legend.items.map(item => key.nodes.find(node => node.id === item.labelId));
      const first = names[0];
      // With one full row, the height budget cannot shorten a key: it only cuts above one row.
      if (first?.t === 'text' && names.every(node => node?.t === 'text' && node.y === first.y
        && node.lines.length === 1 && node.title === undefined)) return { legend: key.legend, scene: key.nodes };
    }, undefined);
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
    // A plain stack takes at most this share of each category step. Gutters,
    // outer padding and category gaps can only narrow it at a taller height.
    const maxBand = Math.ceil(COLUMN_FRACTION_MAX * Math.max(10, width) / bars.length);
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

export const columnKeyFirst = bandKeyFirst((data, options, opening) => {
  const size = { width: (options.size as { width: number }).width, height: opening };
  if (options.valueAxis?.break || options.variant === 'stacked100' || options.valueAxis?.percent
    || options.topN || options.window || options.viewDomain || options.netLine) return false;
  const base = withValueLabelDefaults(withLocaleStrings({ ...options, size }), 'column', options.variant, []);
  const prepared = prepareFractionData(data);
  const mayStep = barDrawsAlike(prepared, base);
  // A lost value can turn the axis on. Measure the two frames the chart can use.
  const axes = base.valueAxis?.show === undefined ? [base.valueAxis, { ...base.valueAxis, show: true }] : [base.valueAxis];
  return axes.every(valueAxis => {
    const warnings: import('../../types/scene').LintWarning[] = [];
    const domain = resolveColumnDomain(prepared, { ...base, valueAxis }, warnings);
    if (domain.annList.length || domain.activeBreak || domain.netLineOn || domain.averageMarker
      || domain.dHi < 0 && domain.negBotP.some(bottom => bottom < 0)) return false;
    const paints = columnPaints(domain, warnings);
    const measured = keylessFrame(solveColumnFrame(domain, paints, warnings).frame);
    if (!measured) return false;
    const { frame, printedDisclosure } = measured;
    const area = columnPlotArea(domain, frame, warnings, undefined, undefined, undefined, true);
    if (area.showCatRow && (mayStep || rankKeyShown(options))) {
      const row = area.catPlan();
      // A numeric date row never makes rank or cut notes. A whole upright row keeps its names
      // at this width, and gives stepToBar nothing to turn into horizontal bars.
      const whole = row.step === 'fit' && row.keep.every(Boolean) && !row.cutNotes.length;
      if (!whole && (mayStep || !row.dateNumeric)) return false;
    }
    return keylessAreaFits(options, frame, area.plot, opening, printedDisclosure);
  });
});

keylessFitBounds.set(columnCore, columnKeyFirst);
