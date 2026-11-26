/** Exact height checks for incomplete dated stacks. */
import { AUTO_LEGEND } from '../../legendPolicy';
import { prepareFractionData } from '../../normalize/fraction';
import { PLOT_SHARE, sameContent } from '../../sizing';
import { partNeedOf, staticFrame } from '../../footer';
import { withEngineNotes } from '../../notes';
import { resolveColumnDomain } from './domain';
import { columnPaints } from './paints';
import { columnPlotArea, solveColumnFrame } from './plot';
import { beforeUnprintedLabelNote, DENSITY_VALUES, freedChromeOf, LEGEND_HEIGHT, plotChromeFloor, UNIT_LINE, NOTED_LABELS, HIDDEN_LABEL_LEAD, type LegendBudget } from '../../frame';
import { AUTHORED_EXAMPLES, currentSmallValues, formatScopeKey, zeroLifts } from '../../formatPrecision';
import { LOCALE_STRINGS, withLocaleStrings } from '../../strings';
import { defaultMeasurer } from '../../text';
import { layoutStepKey, REMOVED_NAMES } from '../../theme';
import { stepDownFont } from '../../label/rowFit';
import { textScaleOf } from '../../typeFloors';
import { withValueLabelDefaults } from '../band/valueSelection';
import { fitsInside, linesSize, STACK_ROOM } from '../band/labels';
import type { ChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';
import { cellValueText, COLUMN_LABEL_PAD, planColumnTotals } from './labels';
import { isOwnMark, type LabelRequest } from '../../label/solver';
import type { LintWarning, PlacedLabel } from '../../types/scene';
import { rectsOverlap } from '../../geometry';
import { stackSegmentRect } from './marks';
import { TARGET_SIZE } from '../../target';
import { requestMemo } from '../../layoutPlan';

const openingOptions = new Set(['size', 'variant', 'referenceStyle', 'mode', 'target', 'measure', 'title', 'unit', 'source', 'theme', 'locale', 'strings', 'legend', 'footnotes', 'authoredFootnotes']);
const openingMarkers = new Set([AUTO_LEGEND, LEGEND_HEIGHT, TARGET_SIZE, DENSITY_VALUES, PLOT_SHARE, LOCALE_STRINGS, REMOVED_NAMES, AUTHORED_EXAMPLES, UNIT_LINE]);
type StackOpening = { plot: number; freed: number; part: number; certifiedChrome: number };

/** These plain stacks keep the same values, scale and series colors when the axis appears. */
function heightAxes(data: ChartData, options: ColumnOptions) {
  const prepared = prepareFractionData(data);
  const base = withValueLabelDefaults(withLocaleStrings(options), 'column', 'stacked', []);
  const warnings: LintWarning[] = [];
  const hidden = resolveColumnDomain(prepared, { ...base, valueAxis: undefined }, warnings);
  const paints = columnPaints(hidden, warnings);
  const valueAxis = { show: true };
  const shown = { ...hidden, options: { ...base, valueAxis }, va: valueAxis };
  return { domains: [hidden, shown], paints, warnings };
}

/** The height search discards the opening when the measured plot is too short. Plain dated
 * stacks can measure it without drawing bars when either axis gives the exact same floor. */
export function stackedOpening(data: ChartData, options: ColumnOptions, size: { width: number; height: number }): StackOpening | undefined {
  if (options.variant !== 'stacked' || options.legend !== 'top' || options.target !== 'report' || !options.source
    || (options.measure ?? defaultMeasurer) !== defaultMeasurer || staticFrame.live || staticFrame.pinned
    || Object.entries(options).some(([key, value]) => value !== undefined && !openingOptions.has(key))) return;
  const plain = beforeUnprintedLabelNote(options);
  if (!plain || Object.getOwnPropertySymbols(plain).some(key => !openingMarkers.has(key))) return;
  if (!simpleMissingStack(data)) return;
  const counted = staticFrame.countable, lifts = zeroLifts.count;
  try {
    return withEngineNotes(() => {
      const state = [size.width, size.height, layoutStepKey(), currentSmallValues(), formatScopeKey(options), counted].join(':');
      const { [DENSITY_VALUES]: _locks, [LEGEND_HEIGHT]: budget, ...rest } = plain as ColumnOptions & { [DENSITY_VALUES]?: unknown; [LEGEND_HEIGHT]?: LegendBudget };
      const shape = { ...rest, footnotes: options.footnotes, ...(budget ? { [LEGEND_HEIGHT]: { ...budget, names: [...budget.names] } } : {}) };
      const prior = requestMemo<{ shape: object; answer?: StackOpening }[]>(data, 'column-opening:' + state, () => []);
      const saved = prior.find(entry => sameContent(entry.shape, shape));
      if (saved) return saved.answer;
      const axes = heightAxes(data, { ...options, size });
      let answer: StackOpening | undefined;
      for (const domain of axes.domains) {
        const warnings = [...axes.warnings];
        const framed = solveColumnFrame(domain, axes.paints, warnings).frame;
        if (framed.deficit || !framed.legend || framed.frame.noteList?.some(note => note.inFrame && note.kind !== 'source')) return;
        const area = columnPlotArea(domain, framed, warnings);
        const frame = framed.frame;
        const row = area.catPlan();
        if (!row.dateNumeric || row.cutNotes.length || area.axisTitle || area.ruleH || area.tier
          || (frame.minHeight ?? 0) > size.height || (frame.plotMinHeight ?? 0) > size.height) return;
        const certified = plotChromeFloor.get(frame);
        if (certified === undefined) return;
        const freed = freedChromeOf(frame);
        const trial = { plot: area.plot.h, freed, part: partNeedOf(frame), certifiedChrome: certified + freed };
        if (answer && (trial.plot !== answer.plot || trial.freed !== answer.freed || trial.part !== answer.part || trial.certifiedChrome !== answer.certifiedChrome)) return;
        answer = trial;
      }
      prior.push({ shape, answer });
      return answer;
    }, true);
  } catch {
    // A speculative failure belongs to the ordinary drawing if it reaches that case.
    return;
  } finally {
    staticFrame.countable = counted;
    zeroLifts.count = lifts;
  }
}

function simpleMissingStack(data: ChartData): boolean {
  if (!Array.isArray(data?.categories) || !Array.isArray(data.series) || data.series.length < 2
    || Object.keys(data).some(key => key !== 'categories' && key !== 'series')
    || data.categories.some(c => !c || !c.date || Object.keys(c).some(key => !['id', 'date', 'label', 'calendar'].includes(key)))
    || data.series.some(s => !s || Object.keys(s).some(key => !['id', 'label', 'values'].includes(key)) || !Array.isArray(s.values)
      || s.values.length !== data.categories.length || s.values.some(v => v !== null && (typeof v !== 'number' || !(v > 0 && Number.isFinite(v)))))) return false;
  return data.series.some(series => series.values.includes(null))
    && data.categories.every((_, ci) => data.series.filter(series => series.values[ci] !== null).length >= 2);
}

/** When the width hides the whole segment row, only the noted totals can lower
 * the count at the taller height. A neighbouring bar and an unreachable lift
 * rule out a total without solving the other labels. */
export function stackedNoteCount(data: ChartData, options: ColumnOptions, fixed: ColumnOptions, noted: PlacedLabel[]): boolean {
  if (options.variant !== 'stacked' || options.legend !== 'top' && options.legend !== undefined || options.target !== 'report'
    || !options.source || (options.measure ?? defaultMeasurer) !== defaultMeasurer
    || staticFrame.live || staticFrame.pinned || options.strings?.hiddenLabels !== HIDDEN_LABEL_LEAD
    || Object.entries(options).some(([key, value]) => value !== undefined && !openingOptions.has(key))) return false;
  const plain = beforeUnprintedLabelNote(options);
  if (!plain || Object.getOwnPropertySymbols(plain).some(key => !openingMarkers.has(key)) || !simpleMissingStack(data)) return false;
  const held = (options as ColumnOptions & { [NOTED_LABELS]?: ReadonlySet<string> })[NOTED_LABELS];
  const collisions = noted.filter(label => label.kind !== 'segment' && !held?.has(label.id));
  if (!collisions.length || collisions.some(label => label.kind !== 'grandTotal' || label.hidden !== 'collision')
    || noted.some(label => label.kind !== 'segment' && label.kind !== 'grandTotal')) return false;

  const counted = staticFrame.countable, lifts = zeroLifts.count;
  try {
    return withEngineNotes(() => {
      const size = fixed.size as { width: number; height: number };
      // Plot share changes the stored chrome floor, which this proof does not read.
      // The prepared source-size and scale state still belong to the comparison.
      const { [PLOT_SHARE]: _share, [LEGEND_HEIGHT]: budget, [AUTHORED_EXAMPLES]: examples, ...raw } = plain as ColumnOptions
        & { [PLOT_SHARE]?: number; [LEGEND_HEIGHT]?: LegendBudget; [AUTHORED_EXAMPLES]?: ReadonlySet<string> };
      const shape = { ...raw, size, footnotes: fixed.footnotes, held: held && [...held], lost: collisions.map(label => label.id),
        ...(examples ? { [AUTHORED_EXAMPLES]: [...examples] } : {}),
        ...(budget ? { [LEGEND_HEIGHT]: { ...budget, names: [...budget.names] } } : {}) };
      const state = JSON.stringify([size.width, size.height, options.legend, options.mode, held?.size, layoutStepKey(),
        currentSmallValues(), formatScopeKey(options), counted]);
      const proven = requestMemo<object[]>(data, 'column-taller-notes:' + state, () => []);
      if (proven.some(entry => sameContent(entry, shape))) return true;
      const axes = heightAxes(data, fixed);
      for (const domain of axes.domains) {
        const warnings = [...axes.warnings];
        const framed = solveColumnFrame(domain, axes.paints, warnings).frame;
        // This static report keeps every generated disclosure in its list. Adding
        // the segment or band note leaves the chart's drawing area unchanged.
        if (framed.frame.noteList?.some(note => note.inFrame && note.kind !== 'source') || framed.deficit) return false;
        if (domain.density !== 'smart' || domain.activeBreak || domain.highlights.size || domain.refSeries.length || domain.annList.length) return false;
        const area = columnPlotArea(domain, framed, warnings);
        const row = area.catPlan();
        if (!row.dateNumeric || row.cutNotes.length || area.ruleH || area.tier) return false;

        let font = area.labelFont, next;
        while ((next = stepDownFont(domain.theme, font, 'label', domain.options.target, textScaleOf(domain.options)))) font = next;
        const widest = { x: 0, y: 0, w: area.band.bandwidth, h: Infinity };
        const tooWide = domain.dataSeries.some((series, si) => series.vals.some((_, ci) => {
          const part = domain.stacks[ci]?.segments[si];
          const text = part && cellValueText(domain, series, ci);
          if (!part || !text || part.value === 0) return false;
          const rect = stackSegmentRect(0, widest.w, area.y, part.start, part.end);
          // A witness fits vertically at every font and still exceeds the bar horizontally at its smallest.
          return rect.h >= linesSize([text], area.labelFont, domain.measure).height + STACK_ROOM
            && !fitsInside(widest, linesSize([text], font, domain.measure), 0);
        }));
        if (!tooWide) return false;
        const requests: LabelRequest[] = [];
        planColumnTotals(domain, area, { bars: [] }, requests);
        // With no segment value and an omitted total, the ordinary hidden-axis pass must turn the axis on.
        if (!domain.va.show && requests.some(r => r.suppressedAs === 'density' && !r.rowPeak)) continue;
        for (const label of collisions) {
          const total = requests.find(r => r.id === label.id);
          if (!total || total.redundant || total.rowPeak || total.printedIn || requests.some(r => r.rowPeak?.neighbours.includes(total.id))) return false;
          const natural = total.candidates[0];
          if (!natural || natural.slot !== 'aboveStack' || natural.overColumns || natural.insideFill !== undefined
            || total.owner.seriesId !== undefined || total.pinnedSlot !== undefined || total.protect) return false;
          if (total.candidates.slice(1).some(seat => seat.slot !== 'aboveNeighbours' || seat.reach === undefined
            || Math.abs(seat.rect.y - natural.rect.y) <= seat.reach + 1e-6)) return false;
          // Automatic placement tests this rectangle with its clearance; only pins
          // remove the clearance. A bar belonging to another category is a hard obstacle.
          const padding = natural.pad ?? total.pad ?? COLUMN_LABEL_PAD;
          if (!domain.cats.some((category, ci) => domain.stacks[ci]!.segments.some((part, si) =>
            part && part.value !== 0 && !isOwnMark({ categoryId: category.id, seriesId: domain.dataSeries[si]!.id }, total.owner, total.kind, 'segment')
              && rectsOverlap(natural.rect,
              stackSegmentRect(area.band.position(ci), area.band.bandwidth, area.y, part.start, part.end), padding)))) return false;
        }
      }
      // The band note adds every colliding total to all earlier IDs. The unchanged
      // segment row and retained IDs reach at least the first height's count.
      proven.push(shape);
      return true;
    }, true);
  } catch {
    return false;
  } finally {
    staticFrame.countable = counted;
    zeroLifts.count = lifts;
  }
}
