import { AUTO_LEGEND, keylessFitBounds } from '../../legendPolicy';
import { bandKeyFirst, keylessAreaFits, speculate } from '../band/keylessFit';
import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing, MIN_COMPACT_PLOT, PLOT_SHARE, sameContent } from '../../sizing';
import { hasCompleteTextWidths } from '../../fontMetrics/injected';
import { defaultMeasurer } from '../../text';
import { canvasMargin, layoutStepKey, REMOVED_NAMES } from '../../theme';
import { beforeUnprintedLabelNote, comparableOptions, freedChromeOf, keylessFrame, LEGEND_HEIGHT, type InternalFootnoteOptions } from '../../frame';
import { chartTheme } from '../chartEnv';
import { fitsInside, INSIDE_MIN_W } from '../band/labels';
/** Zod-free combo chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { BaseOptions, ComboOptions } from '../../types/options';
import { LOCALE_STRINGS, withLocaleStrings } from '../../strings';
import { disclosuresShown } from '../../notes';
import { copyFrame, partNeedOf, staticFrame } from '../../footer';
import { TARGET_SIZE } from '../../target';
import { AUTHORED_EXAMPLES, currentSmallValues, formatScopeKey } from '../../formatPrecision';
import { INSIDE_ENDPOINT_IDS, insideEndpointGutters } from './endpoints';
import { MARKER_R } from './model';
import { resolveComboEnv, resolveComboDomain, TOTALS_AXIS } from './domain';
import { comboPaints, comboPlotArea, solveComboFrame } from './plot';
import { requestMemo } from '../../layoutPlan';
import { layoutCombo, type ComboDerived, type ComboMarks } from './layout';

export const comboCore: ChartCore<ChartData, BaseOptions, ComboMarks, ComboDerived> = {
  type: 'combo',
  frameOwnsSourceLimit: true,
  openingPlot: plainComboOpening,
  sizing: chartSizing('combo'),
  title: 'Combo',
  summary: 'Stacked columns with line and area overlays and an optional second value scale',
  layout: (data, options) => layoutCombo(prepareFractionData(data), options as ComboOptions | undefined),
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
    if (area.showCatTickRow && disclosuresShown(options) && !area.catPlan.dateNumeric
      && (domain.lines.length || area.catPlan.step !== 'fit' || !area.catPlan.keep.every(Boolean))) return false;
    // Compact fitting also gates the minimum data-plot height. Date and numeric
    // rows keep the same category identities when endpoint gutters change.
    if (options.mode === 'compact' && (area.plot.h < MIN_COMPACT_PLOT || !area.catPlan.dateNumeric)) return false;
    return keylessAreaFits(options, frame, area.plot, opening, printedDisclosure);
  });
});

keylessFitBounds.set(comboCore, comboKeyFirst);

const openingMarkers = new Set<symbol>([AUTO_LEGEND, LEGEND_HEIGHT, TARGET_SIZE, PLOT_SHARE,
  AUTHORED_EXAMPLES, REMOVED_NAMES, LOCALE_STRINGS]);
const openingOptions = new Set(['size', 'title', 'mode', 'secondaryAxis', 'target', 'locale', 'measure', 'theme', 'strings',
  'legend', 'footnotes', 'authoredFootnotes', 'valueLabels']);

/** The static report footer keeps value disclosures in its list. Only the chosen axis
 * and the failed endpoints can change a plain combo's measured opening. */
function plainComboOpening(data: ChartData, raw: BaseOptions, size: { width: number; height: number }) {
  const options = raw as ComboOptions;
  if (staticFrame.live || staticFrame.pinned || options.target !== 'report' || options.legend !== 'top'
    || (options.measure ?? defaultMeasurer) !== defaultMeasurer || options.valueLabels !== undefined && options.valueLabels !== 'all'
    || Object.entries(options).some(([key, val]) => val !== undefined && !openingOptions.has(key))
    || !Array.isArray(data?.categories) || !Array.isArray(data.series)
    || data.categories.length < 30 || data.categories.some(c => !c || typeof c !== 'object' || !('calendar' in c) || !c.calendar || c.partial || c.footnote !== undefined)
    || data.series.some(s => !s || !Array.isArray(s.values) || s.axis === 'secondary' || s.role || s.scenario || s.kind === 'area'
      || s.values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0))) return;
  // The sole extra footnote can only be the registry's unprinted disclosure.
  // Unknown caller markers may attach claim callbacks or change the chart's frame.
  const plain = beforeUnprintedLabelNote(options);
  if (!plain || Object.getOwnPropertySymbols(plain).some(marker => !openingMarkers.has(marker))) return;
  // The ordinary drawing owns invalid data, options and error order.
  return speculate(() => {
    // The sizing caller can change its target plot share or lock hidden labels.
    // Neither changes the plot that this calculation measures. For a new note,
    // check its real footer at both axis settings before returning the old height.
    const shape = comparableOptions(plain, PLOT_SHARE, AUTHORED_EXAMPLES);
    type Opening = { plot: number; freed: number; part: number };
    const state = `${layoutStepKey()}:${staticFrame.countable}:${currentSmallValues()}:${formatScopeKey(options)}:${size.width}:${size.height}`;
    const previous = requestMemo<{ shape: object; answer: Opening }[]>(data, 'combo-opening:' + state, () => []);
    const saved = previous.find(entry => sameContent(entry.shape, shape));
    if (saved) return saved.answer;
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
      if (without.first.size > 3 || without.last.size > 3 || without.gutters.first || without.gutters.last) return;
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
      // At either end positive, complete series have the same category centre.
      // At that centre a failed subset takes the gutter of its widest label.
      // Keep the actual pair calculation because the two gutters narrow one another.
      const representatives = (ends: typeof without.first, ci: number) => {
        if (!without.first.size)
          return [undefined, ...[...ends].map(([id, end]) => `point:${id}:${domain.cats[end.ci]!.id}`)];
        const widths = new Map<number, string>();
        for (const [id, end] of ends) {
          if (end.ci !== ci) return;
          if (!end.suppressed) widths.set(env.measure(end.text || '0', without.labelFont).width, `point:${id}:${domain.cats[ci]!.id}`);
        }
        return [undefined, ...widths.values()];
      };
      const first = representatives(without.first, 0);
      const last = representatives(without.last, domain.cats.length - 1);
      if (!first || !last) return;
      const measuredGutters = new Set(['0:0']);
      for (const left of first) for (const right of last) {
        const ids = new Set([left, right].filter((id): id is string => id !== undefined));
        const room = insideEndpointGutters({ ids, first: without.first, last: without.last, cats: domain.cats,
          width: without.endpointWidth, font: without.labelFont, measure: env.measure, markerR: MARKER_R });
        const key = `${room.first}:${room.last}`;
        if (measuredGutters.has(key)) continue;
        measuredGutters.add(key);
        if (!agree(measure({ ...domain, options: { ...domain.options, [INSIDE_ENDPOINT_IDS]: ids } as ComboOptions }))) return;
      }
    }
    if (answer) previous.push({ shape, answer });
    return answer;
  }, undefined);
}
