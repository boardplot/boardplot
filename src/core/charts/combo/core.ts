import { AUTO_LEGEND, keylessFitBounds } from '../../legendPolicy';
import { bandKeyFirst, keylessAreaFits } from '../band/keylessFit';
import { withEventsDescribed } from '../../eventReading';
import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing, MIN_COMPACT_PLOT, PLOT_SHARE } from '../../sizing';
import { hasCompleteTextWidths } from '../../fontMetrics/injected';
import { defaultMeasurer } from '../../text';
import { canvasMargin, REMOVED_NAMES } from '../../theme';
import { beforeUnprintedLabelNote, DENSITY_VALUES, freedChromeOf, keylessFrame, LEGEND_HEIGHT, type InternalFootnoteOptions } from '../../frame';
import { chartTheme } from '../chartEnv';
import { fitsInside, INSIDE_MIN_W } from '../band/labels';
/** Zod-free combo chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { BaseOptions, ComboOptions } from '../../types/options';
import { LOCALE_STRINGS, withLocaleStrings } from '../../strings';
import { rankKeyShown, withEngineNotes } from '../../notes';
import { copyFrame, partNeedOf, staticFrame } from '../../footer';
import { TARGET_SIZE } from '../../target';
import { AUTHORED_EXAMPLES, zeroLifts } from '../../formatPrecision';
import { INSIDE_ENDPOINT_IDS, insideEndpointGutters } from './endpoints';
import { MARKER_R } from './model';
import { resolveComboEnv, resolveComboDomain, TOTALS_AXIS } from './domain';
import { comboPaints, comboPlotArea, solveComboFrame } from './plot';
import { layoutCombo, type ComboDerived, type ComboMarks } from './layout';

export const comboCore: ChartCore<ChartData, BaseOptions, ComboMarks, ComboDerived> = {
  type: 'combo',
  frameOwnsSourceLimit: true,
  openingPlot: plainComboOpening,
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
    // Compact fitting also gates the minimum data-plot height. Date and numeric
    // rows keep the same category identities when endpoint gutters change.
    if (options.mode === 'compact' && (area.plot.h < MIN_COMPACT_PLOT || !area.catPlan.dateNumeric)) return false;
    return keylessAreaFits(options, frame, area.plot, opening, printedDisclosure);
  });
});

keylessFitBounds.set(comboCore, comboKeyFirst);

const openingMarkers = new Set<symbol>([AUTO_LEGEND, LEGEND_HEIGHT, TARGET_SIZE, PLOT_SHARE, DENSITY_VALUES,
  AUTHORED_EXAMPLES, REMOVED_NAMES, LOCALE_STRINGS]);
const openingOptions = new Set(['size', 'title', 'mode', 'secondaryAxis', 'target', 'locale', 'measure', 'theme', 'strings',
  'legend', 'footnotes', 'authoredFootnotes']);

/** The static report footer keeps value disclosures in its list. Only the chosen axis
 * and the failed last endpoints can change a plain combo's measured opening. */
function plainComboOpening(data: ChartData, raw: BaseOptions, size: { width: number; height: number }) {
  const options = raw as ComboOptions;
  if (staticFrame.live || staticFrame.pinned || options.target !== 'report' || options.legend !== 'top'
    || (options.measure ?? defaultMeasurer) !== defaultMeasurer
    || Object.entries(options).some(([key, val]) => val !== undefined && !openingOptions.has(key))
    || !Array.isArray(data?.categories) || !Array.isArray(data.series)
    || data.categories.length < 30 || data.categories.some(c => !c || typeof c !== 'object' || !('calendar' in c) || !c.calendar || c.partial || c.footnote !== undefined)
    || data.series.some(s => !s || !Array.isArray(s.values) || s.axis === 'secondary' || s.role || s.scenario || s.kind === 'area'
      || s.values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0))) return;
  // The sole extra footnote can only be the registry's unprinted disclosure.
  // Unknown caller markers may attach claim callbacks or change the chart's frame.
  const plain = beforeUnprintedLabelNote(options);
  if (!plain || Object.getOwnPropertySymbols(plain).some(marker => !openingMarkers.has(marker))) return;
  const counted = staticFrame.countable, lifts = zeroLifts.count;
  try {
    return withEngineNotes(() => {
      const input = withLocaleStrings({ ...options, size });
      const prepared = prepareFractionData(data);
      let answer: { plot: number; freed: number; part: number } | undefined;
      for (const next of [input, { ...input, [TOTALS_AXIS]: true }]) {
        const warnings: import('../../types/scene').LintWarning[] = [];
        const env = resolveComboEnv(next, warnings);
        const domain = resolveComboDomain(prepared, next, warnings, env.theme);
        if (domain.anomaly || domain.lineFloat || domain.anatomy || domain.secondaryActive) return;
        const paints = comboPaints(env, domain);
        const framed = solveComboFrame(env, domain, paints, warnings);
        if (!framed.frame.legend || framed.frame.deficit || framed.frame.frame.noteList?.some(n => n.inFrame)) return;
        const measure = (chosen: typeof domain) => comboPlotArea(env, chosen, paints, {
          ...framed, frame: { ...framed.frame, frame: copyFrame(framed.frame.frame) },
        }, undefined, warnings);
        const without = measure(domain);
        if (without.first.size || without.last.size > 3 || without.gutters.first || without.gutters.last) return;
        const agree = (area: typeof without) => {
          const frame = area.frame.frame;
          if (!area.catPlan.dateNumeric || area.catPlan.cutNotes.length || (frame.minHeight ?? 0) > size.height
            || (frame.plotMinHeight ?? 0) > size.height) return false;
          const trial = { plot: area.plot.h, freed: freedChromeOf(frame), part: partNeedOf(frame) };
          if (answer && (trial.plot !== answer.plot || trial.freed !== answer.freed || trial.part !== answer.part)) return false;
          answer = trial;
          return true;
        };
        if (!agree(without)) return;
        // With no first gutter, the last gutter of any failed subset is the
        // largest individual gutter. Try each such width through the real row planner.
        const measuredGutters = new Set([0]);
        for (const [id, end] of without.last) {
          const ids = new Set([`point:${id}:${domain.cats[end.ci]!.id}`]);
          const gutter = insideEndpointGutters({ ids, first: without.first, last: without.last, cats: domain.cats,
            width: without.endpointWidth, font: without.labelFont, measure: env.measure, markerR: MARKER_R }).last;
          if (measuredGutters.has(gutter)) continue;
          measuredGutters.add(gutter);
          if (!agree(measure({ ...domain, options: { ...domain.options, [INSIDE_ENDPOINT_IDS]: ids } as ComboOptions }))) return;
        }
      }
      return answer;
    }, true);
  } catch {
    // The ordinary drawing owns invalid data, options and error order.
    return;
  } finally {
    zeroLifts.count = lifts;
    staticFrame.countable = counted;
  }
}
