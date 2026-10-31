import { chartString } from '../../strings/combo';
import { planLineStyle } from '../../planLineStyle';
import { BAND_PAD, namedLineText, VALUE_LINE_RESERVE } from '../../annotateParts';
import { formatterFromExample, sameUnit } from '../../formatSpec';
import { resolveSubtitle } from '../../normalize/shared';
/**
 * Combo phase 1, second half: the paints, the frame (the legend is a
 * layout participant), the axis titles, the end-label gutters, the category
 * band and row, and the plot rect with its scales. The frame is solved here,
 * before the scales, because the plot rect comes out of it.
 */

import { measureValueAxisWidth } from '../../axis';
import { longDayMonths, type dateTickRow } from '../../calendarLabels';
import type { Rect } from '../../geometry';
import { authoredNotes, frameTextOptions, normalizeLegendOption, noteLine, plotHeightAfter, recordFreedChrome, solveFrame, textCarriesUnit, type FrameBand, type FrameInput, type FrameResult, type LegendItemInput, authoredFootnoteCount } from '../../frame';
import { plotFloorRows } from '../../sizing';
import { CATEGORY_ROW_FROM_END, CATEGORY_ROW_VERTICAL, calendarLike, categoryRowTop, hangingLabelReserve, planCategoryRow, rotatedLeftOverhang } from '../../label/categoryRow';
import { staircaseDirection, staircaseOn, staircaseRoom, staircaseState } from '../../label/staircase';
import { segmentSeparationStroke } from '../../markVisibility';
import { scenarioLegendKeys } from '../../label/legendFidelity';
import { referenceMarkerKey } from '../band/ticks';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { isDateNumericTickSequence, MONTH_START } from '../../label/tickRow';
import { partialAxisWords, partialFootnotes, partialKeyForced, partialLegendKeys, partialPattern, saysToDate, toDateFits } from '../../partialPeriod';
import { bandScale, linearScale } from '../../scale';
import { wrapText, type FontSpec } from '../../text';
import { defaultAnnotationId } from '../../types/annotations';
import {
  canvasMargin,
  effectiveFill,
  labelsOffKeepsNames,
  markRolePaint,
  markRoleToken,
  mutedMarkPaint,
  paintColor,
  panelTypeClass,
  seriesPaint as themeSeriesPaint,
  emphasisWeight,
  strokeToken,
  dashToken,
  recedingSeriesId,
  seriesTextPaint,
  secondaryFont,
} from '../../theme';
import type { Id } from '../../types/cell';
import type { MarkerShape } from '../../types/data';
import { MARKER_MAX_CATS } from '../line/paints';
import type { LabelContent, LabelKind, LegendOptions } from '../../types/options';
import type { LintWarning, Paint } from '../../types/scene';
import { planComboAxisTitles } from './axisTitles';
import { categoryRanksLint, FORCE_CATEGORY_RANKS, withCategoryRanks } from './categoryRanks';
import { comboValueLabels, endpointGutters, FIRST_END_BELOW_TOTALS, INSIDE_ENDPOINT_IDS, insideEndpointGutters, prepareComboEndpointTexts, type EndpointGutters } from './endpoints';
import type { ForecastBoundary } from '../line/forecast';
import { MARKER_R, type ComboArea, type ComboDomain, type ComboEnv, type ComboPaints, type GrowthItem, type NormSer } from './model';
import { formatAutomaticNumber, formatAutomaticPercent, formatShare } from '../../format';
import { comboBandFraction, primaryLineMean, secondaryPrimaryRange } from './domain';
import { autoDecimals } from '../../formatPrecision';
import { valueShareLines } from '../band/labels';
import { categoryLabelsAndMarks, withCategoryNoteNames } from '../../footnoteMark';
import { anomalyLegendItems, anomalyRuleLines, anomalyRuleReserve, columnCorridorPaint } from '../column/anomaly';
import { textScaleOf } from '../../typeFloors';
import { scaleTextPx } from '../../target';
import { disclosureNote, disclosuresShown, knownPartsLead, rankKeyShown } from '../../notes';
import { maxOf, minOf, pushAll } from '../../arrays';

/** Clear air between the plot's right edge and the right-hand tick column. */
const RIGHT_TICK_GAP = 8;
/** Air between the right tick labels and the growth statement. */
const GROWTH_GAP = 12;
/** Canvas width under which the growth statements leave the plot's side for a note line. */
const GROWTH_NOTE_BELOW = 600;
/**
 * The widest share of the canvas a one-line growth statement ("+128% Units
 * sold") may take beside the plot; a longer one breaks the name under the
 * figure.
 */
const GROWTH_ONE_LINE_SHARE = 0.2;

/**
 * Each series' growth from its first to its last value, the line's first.
 * The columns' growth is that of the stack total. A series whose first value
 * is not positive has no growth rate and states none. A partial category is no end of a growth rate; the rate runs
 * between complete categories, and its name says the span when that span
 * does not reach both axis ends.
 */
function growthItems(domain: ComboDomain, lang: string | undefined): GrowthItem[] {
  const { cats, columns, lines, stackTotals, anyByCat } = domain;
  const items: GrowthItem[] = [];
  const label = (ci: number): string => cats[ci]!.label ?? cats[ci]!.id;
  const growth = (values: (number | null)[], name: string): Omit<GrowthItem, 'seriesId' | 'axis' | 'ink'> | undefined => {
    const at = values.flatMap((v, ci) => (v !== null && cats[ci]!.partial !== true ? [ci] : []));
    if (at.length < 2) return undefined;
    const a = at[0]!;
    const b = at[at.length - 1]!;
    const first = values[a]!;
    const last = values[b]!;
    if (!(first > 0)) return undefined;
    const span = a === 0 && b === cats.length - 1 ? '' : `${label(a)}–${label(b)}`;
    const head = name.split(',')[0]!.trim();
    return { text: formatAutomaticPercent((last / first - 1) * 100, 0, true, lang), name: [name, span].filter(Boolean).join(', '), short: [head, span].filter(Boolean).join(', '), last };
  };
  const line = lines.find((s) => s.axis === 'secondary' && s.kind === 'line');
  const lineGrowth = line && growth(line.vals.map((val) => val.v), line.label);
  if (line && lineGrowth) items.push({ seriesId: line.id, ...lineGrowth, axis: 'secondary', ink: 'ink' });
  const columnGrowth = columns.length > 0
    ? growth(cats.map((c, ci) => (anyByCat[ci] ? stackTotals[c.id]! : null)), columns.length === 1 ? columns[0]!.label : '')
    : undefined;
  if (columnGrowth) items.push({ seriesId: columns[0]!.id, ...columnGrowth, axis: 'primary', ink: 'inkMuted' });
  return items;
}

/**
 * The anatomy's growth statements and where they stand. Beside the plot they
 * take a column right of the line end; on a card narrower than
 * GROWTH_NOTE_BELOW they move to one note line, "Units sold +128%, Revenue
 * +33%, 2019–2024.", and the plot keeps the width.
 */
function growthStatements(env: ComboEnv, domain: ComboDomain): {
  items: GrowthItem[]; valueFont: FontSpec; nameFont: FontSpec; reserve: number; inNote: boolean; oneLine: boolean; note?: string;
} {
  const { options } = domain;
  const { theme, measure, size } = env;
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  // Figure and name stand in the label face at the emphasis weight, on one line where it fits.
  const valueFont: FontSpec = { ...labelFont, weight: emphasisWeight(theme) };
  const nameFont: FontSpec = valueFont;
  const items = domain.anatomy && options.dualAxis?.growth ? growthItems(domain, options.locale?.language) : [];
  const oneLineW = items.length > 0 ? GROWTH_GAP + maxOf(items.map((item) => measure(growthLine(item), valueFont).width)) : 0;
  const oneLine = items.length > 0 && oneLineW <= size.width * GROWTH_ONE_LINE_SHARE;
  const reserve = items.length === 0 ? 0 : oneLine ? oneLineW
    : GROWTH_GAP + maxOf(items.flatMap((item) => {
      const name = item.short;
      return [measure(item.text, valueFont).width, name ? measure(name, nameFont).width : 0];
    }));
  const inNote = items.length > 0 && size.width < GROWTH_NOTE_BELOW;
  if (!inNote) return { items, valueFont, nameFont, reserve, inNote, oneLine };
  const { cats } = domain;
  const spans = items.every((item) => !item.name.includes('–'));
  const period = spans && cats.length > 1 ? `, ${cats[0]!.label ?? cats[0]!.id}–${cats[cats.length - 1]!.label ?? cats[cats.length - 1]!.id}` : '';
  const note = `${items.map((item) => `${item.name} ${item.text}`.trim()).join(', ')}${period}.`;
  return { items, valueFont, nameFont, reserve, inNote, oneLine, note };
}

/** The one-line growth statement beside the plot: "+128% Units sold". */
export function growthLine(item: GrowthItem): string {
  return item.short ? `${item.text} ${item.short}` : item.text;
}

/**
 * The focus of each band down a stack relative to the top one: the stacked
 * area's ink ramp, 26 / 45 / 70 / 100 %, read from its light end.
 */
const STACK_RAMP = [1, 45 / 26, 70 / 26, 100 / 26];

/**
 * The tint amount of one stacked column series under `marks.comboColumnTint`
 * The top series takes the theme's tint and the series below it
 * step down the stacked-area ramp, capped at the full focus: at 0.74 the
 * bands run 26 / 45 / 70 / 100 % from the top. So the lightest band is on
 * top and the line over the stack stays the story. Past four series the
 * lower bands keep the ramp's last step.
 */
function stackTint(tint: number, count: number, index: number): number {
  const fromTop = count - 1 - Math.max(0, index);
  if (fromTop <= 0) return tint;
  const alpha = Math.min(1, (1 - tint) * STACK_RAMP[Math.min(fromTop, STACK_RAMP.length - 1)]!);
  return Math.round((1 - alpha) * 100) / 100;
}

/**
 * The lead line a theme draws in the ink (`marks.comboLine: 'ink'`):
 * the first line series, with no authored paint, highlight, palette or PY.
 */
export function inkLeadLine(env: ComboEnv, s: NormSer, li: number): boolean {
  return env.theme.marks?.comboLine === 'ink' && li === 0 && s.kind === 'line' && !s.fill && !s.colorRole &&
    !env.highlights.has(s.id) && !env.palette && s.scenario !== 'PY';
}

/**
 * The marker a combo line draws, and whether it draws it at every point
 * (`full`) or only at a partial period (hollow). The anatomy's line carries a
 * ringed dot on every point, a theme without default markers included. A theme
 * without default markers, or a line denser than line's cutoff, keeps only the
 * partial-period one. An authored marker wins. The key shows a full marker.
 */
export function comboLineMarkers(env: ComboEnv, domain: ComboDomain, s: NormSer): { shape: MarkerShape; anatomyDots: boolean; full: boolean } {
  const shape: MarkerShape = s.marker ?? (s.kind === 'line' ? 'circle' : 'none');
  const anatomyDots = domain.anatomy && s.marker === undefined && s.kind === 'line' && s.axis === 'secondary';
  const themeDrops = !anatomyDots && s.marker === undefined && (env.theme.marks?.lineMarkers === 'none' || domain.cats.length > MARKER_MAX_CATS);
  return { shape, anatomyDots, full: shape !== 'none' && !themeDrops };
}

export function comboPaints(env: ComboEnv, domain: ComboDomain): ComboPaints {
  const { theme, palette, highlights } = env;
  const { columns, cats } = domain;
  const css = (p: Paint): string => paintColor(theme, p);
  const columnTint = theme.marks?.comboColumnTint;
  /**
   * A theme's column series, any scenario, with no authored fill,
   * colorRole or palette. The scenario look wins: an actual column is a
   * focus tint, a plan outline and a forecast hatch draw in the full focus
   * (a pale tint would lose the outline and the hatch), and a prior year
   * keeps its own scenario colour. A single series takes the tint itself;
   * stacked series take a ramp of it (`stackTint`).
   */
  const tinted = (s: NormSer, scenario: string | undefined): Paint | undefined => {
    if (columnTint === undefined || palette || s.fill || s.colorRole || scenario === 'PY') return undefined;
    if (scenario === 'PL' || scenario === 'FC') return { token: 'focus' };
    if (columns.length === 1) return { token: 'focus', tint: columnTint };
    const amount = stackTint(columnTint, columns.length, columns.indexOf(s));
    return amount > 0 ? { token: 'focus', tint: amount } : { token: 'focus' };
  };
  const receding = recedingSeriesId([...columns, ...domain.lines], highlights);
  const column = (s: NormSer, colIdx: number): Paint => {
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return markRolePaint(s.colorRole, true);
    if (s.id === receding) return mutedMarkPaint();
    const themed = tinted(s, s.scenario);
    if (themed) return themed;
    if (columns.length === 1) return themeSeriesPaint(colIdx, palette, s.scenario);
    return themeSeriesPaint(colIdx, palette);
  };
  // A derived highlight (pareto's vital few, HIGHLIGHT_KEY) is no authored
  // focus: its columns lead in series 1 and the rest recede.
  const derived = (domain.options as { [HIGHLIGHT_KEY]?: HighlightKey })[HIGHLIGHT_KEY] !== undefined;
  const cell: ComboPaints['cell'] = (s, val, cat, colIdx) => {
    if (val.fill) return { css: val.fill };
    if (highlights.has(cat.id) || highlights.has(s.id)) return derived ? themeSeriesPaint(0, palette) : { token: 'focus' };
    if (derived && !val.scenario && !s.fill && !s.colorRole) return { token: 'rest' };
    if (val.scenario) {
      const themed = tinted(s, val.scenario);
      if (themed) return themed;
      return columns.length === 1 ? themeSeriesPaint(colIdx, palette, val.scenario) : column(s, colIdx);
    }
    return column(s, colIdx);
  };
  const pattern: ComboPaints['pattern'] = (s, val, cat) => partialPattern(cat, scenarioPattern(s, val));
  const inside: ComboPaints['inside'] = (s, val, cat, colIdx) =>
    effectiveFill(css(cell(s, val, cat, colIdx)), pattern(s, val, cat), theme);
  const top: ComboPaints['top'] = (ci, above) => {
    for (let k = columns.length - 1; k >= 0; k--) {
      const s = columns[k]!;
      const val = s.vals[ci]!;
      if (val.v === null) continue;
      if (above ? val.v > 0 : val.v < 0) return { insideFill: inside(s, val, cats[ci]!, k), insidePaint: cell(s, val, cats[ci]!, k), insidePattern: pattern(s, val, cats[ci]!) };
    }
    return { insideFill: paintColor(theme, { token: 'neutralMark' }), insidePaint: { token: 'neutralMark' } };
  };
  /** Line conventions: the ranks after the columns, the focus only for an
   *  authored highlight; scenario PY light. Dash carries the
   *  FC scenario; PL lines use the shared hollow outline. */
  const tickHighlight = (domain.options.referenceStyle ?? 'tick') === 'tick' && domain.options.referenceTick?.color === 'highlight';
  const planStyle = (s: NormSer) => s.kind === 'line' ? planLineStyle(s.scenario, theme) : undefined;
  const lineHollow = (s: NormSer): boolean => planStyle(s) !== undefined;
  const lineWidth = (s: NormSer): number => highlights.has(s.id) ? strokeToken(theme, 'focus')
    : planStyle(s)?.width ?? strokeToken(theme, 'data');
  const line = (s: NormSer, li: number): Paint => {
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return markRolePaint(s.colorRole);
    if (highlights.has(s.id)) return { token: 'focus' };
    if (s.id === receding) return mutedMarkPaint();
    const plan = planStyle(s);
    if (plan) return { token: plan.ink };
    // A prior year recedes, and still reaches 3:1 on the page.
    if (s.scenario === 'PY') return mutedMarkPaint();
    if (inkLeadLine(env, s, li)) return { token: 'markInk' };
    // the accent waits for an authored highlight. The
    // lines take the ranks after the columns, so the lead line stands apart
    // from the series-1 columns.
    if (!palette) return themeSeriesPaint(columns.length + li);
    return themeSeriesPaint(li, palette);
  };
  const dash = (s: NormSer): number[] | undefined => {
    if (s.scenario === 'FC') return dashToken(theme, 'reference');
    if (s.lineStyle === 'dashed') return dashToken(theme, 'reference');
    if (s.lineStyle === 'dotted') return dashToken(theme, 'dotted');
    if (s.scenario === 'PL' && !lineHollow(s)) return dashToken(theme, 'reference');
    return undefined;
  };
  const ref = (s: NormSer): Paint => (tickHighlight ? { token: 'highlight' } : s.fill ? { css: s.fill } : s.colorRole ? { token: markRoleToken(s.colorRole) } : { token: 'ink' });
  const edge: ComboPaints['edge'] = (fill, pattern) => {
    if (pattern || ('tint' in fill && fill.tint !== undefined)) return {};
    const outline = segmentSeparationStroke(fill, theme.color.background, theme);
    return { ...(outline ? { stroke: outline.stroke, width: outline.strokeWidth } : {}),
      separation: { fillStep: true, fill, backing: { token: 'background' } } };
  };
  return { edge, css, column, cell, pattern, inside, top, line, lineHollow, lineWidth, dash, ref };
}

function scenarioPattern(s: NormSer, val: { scenario?: string }): 'hatch45' | 'outline' | undefined {
  const sc = val.scenario ?? s.scenario;
  return sc === 'FC' ? 'hatch45' : sc === 'PL' ? 'outline' : undefined;
}

/**
 * Internal option: what a highlight on categories means, as pareto knows it
 * (the causes that reach the threshold, and the rest), and where its key
 * goes. The key names the two column colours and nothing else, and it is
 * drawn whatever `legend` says. It does not look at the colours: a layout
 * never depends on the scheme it is painted in. Authored JSON cannot set it.
 */
export const HIGHLIGHT_KEY = Symbol('highlightKey');
export interface HighlightKey {
  highlighted: string; rest: string; legend: LegendOptions;
  /** The pareto curve's own line item after the two column colours. */
  line?: string;
}

/**
 * The legend. Every pattern the COLUMN cells will paint, from `pattern` — the
 * predicate the segment loop uses — over the cells its guards admit
 * (non-null, non-zero). Scenario is a cell property and a series key can only
 * read the series, so a per-cell `scenario: 'FC'` paints a hatch no series key
 * carries; the scenario key names it. Line series carry their scenario in the
 * dash, which their own `line` key already mirrors.
 */
function comboLegend(env: ComboEnv, domain: ComboDomain, paints: ComboPaints): FrameInput['legend'] {
  const { theme } = env;
  const { options, columns, lines, refs, cats } = domain;
  const highlightKey = (options as { [HIGHLIGHT_KEY]?: HighlightKey })[HIGHLIGHT_KEY];
  // A line that draws markers at its points keys one at its centre.
  const keyMarker = (s: NormSer): Pick<LegendItemInput, 'marker'> => {
    const { shape, full } = comboLineMarkers(env, domain, s);
    return s.kind === 'line' && full && shape !== 'none' ? { marker: { shape, ...(paints.lineHollow(s) ? { hollow: true } : {}) } } : {};
  };
  if (highlightKey && columns.length > 0) {
    return {
      options: highlightKey.legend,
      items: [
        ...columns.flatMap((s, i) => cats.flatMap((cat, ci) => s.vals[ci]!.v === null ? [] : [{
          id: `key:${s.id}:${cat.id}`, label: (Array.isArray(options.highlight) ? options.highlight : [options.highlight]).includes(cat.id) ? highlightKey.highlighted : highlightKey.rest,
          paint: paints.cell(s, s.vals[ci]!, cat, i),
          ...paints.edge(paints.cell(s, s.vals[ci]!, cat, i), paints.pattern(s, s.vals[ci]!, cat)),
        }])),
        ...(highlightKey.line === undefined ? [] : lines.flatMap((s, i) => s.kind !== 'line' || s.vals.every((val) => val.v === null) ? [] : [{
          id: s.id, label: highlightKey.line!, paint: paints.line(s, i), key: 'line' as const, width: paints.lineWidth(s, i), ...keyMarker(s),
          ...(paints.dash(s) ? { dash: paints.dash(s) } : {}),
        }])),
      ],
    };
  }
  // The anomaly marker and corridor are encodings with no other key, as on column.
  const anomalyKeys = domain.anomaly
    ? anomalyLegendItems(theme, domain.anomaly.model, domain.anomaly.corridorShown, domain.anomaly.statFmt, columnCorridorPaint(options.colorblindSafe), options.strings, options.locale?.language)
    : [];
  // A drawn reference or anomaly mark is an encoding, so it brings its key.
  // A grid panel leaves its key to the grid legend, which collects it.
  const referenceDrawn = panelTypeClass(options) === undefined && refs.some((s) => s.vals.some((val) => val.v !== null));
  const position = (anomalyKeys.length > 0 || referenceDrawn) && options.legend === undefined ? 'top' : options.legend;
  if (!position || position === 'none' || position === 'auto') return undefined;
  const legendOpts: LegendOptions = normalizeLegendOption(position);
  const columnItems: LegendItemInput[] = columns.map((s, i) => ({
    id: s.id,
    label: s.label,
    paint: paints.column(s, i),
    pattern: s.scenario === 'FC' ? 'hatch45' : s.scenario === 'PL' ? 'outline' : undefined,
    ...paints.edge(paints.column(s, i), scenarioPattern(s, {})),
  }));
  const painted = columns.flatMap((s) => s.vals.flatMap((val) => (val.v === null || val.v === 0 ? [] : [scenarioPattern(s, val)])));
  const partialHatchPainted = columns.some((s) =>
    s.vals.some((val, ci) => val.v !== null && val.v !== 0 && paints.pattern(s, val, cats[ci]!) !== scenarioPattern(s, val)),
  );
  // The dual-axis key rule: a series its axis title keys with a swatch leaves the key row.
  const axisKeyed = axisKeyedSeries(domain);
  const undrawn = new Set([...columns, ...lines, ...refs].filter(s => s.vals.every(val => val.v === null)).map(s => s.id));
  let items: LegendItemInput[] = [
    ...columnItems,
    ...lines.map((s, i) => ({
      id: s.id,
      label: s.label,
      paint: paints.line(s, i),
      key: s.kind === 'line' ? ('line' as const) : ('box' as const),
      ...(s.kind === 'line' ? { width: paints.lineWidth(s, i) } : {}),
      ...keyMarker(s),
      ...(paints.lineHollow(s) ? { hollow: true, width: paints.lineWidth(s, i) } : {}),
      ...(s.kind === 'line' && paints.dash(s) ? { dash: paints.dash(s), lineCap: paints.dash(s)?.join(',') === dashToken(theme, 'dotted').join(',') ? 'round' as const : 'butt' as const } : {}),
    })),
    ...refs.map((s) => ({
      id: s.id,
      label: s.label,
      paint: paints.ref(s),
      key: 'line' as const,
      ...(options.referenceStyle === 'line' ? { dash: dashToken(theme, 'dotted'), lineCap: 'round' as const, width: strokeToken(theme, 'rule') } : { width: options.referenceTick?.width ?? strokeToken(theme, 'rule') }),
      ...(options.referenceStyle === 'marker' ? referenceMarkerKey(theme, paints.ref(s)) : {}),
    })),
    ...scenarioLegendKeys({ markPatterns: painted, keyPatterns: columnItems.map((item) => item.pattern), paint: { token: 'neutralMark' }, strings: options.strings }),
    ...partialLegendKeys(partialHatchPainted && !partialNamedOnTotals(env, domain), options.strings, cats),
    // A line that turns dashed at its forecast cells keys that dash, 5 on 3 as marks.ts draws it.
    ...(lines.some((s) => s.scenario !== 'FC' && s.vals.some((val) => val.v !== null && val.scenario === 'FC'))
      ? [{ id: '__scenarioFCLine', label: options.strings!.forecast!, paint: { token: 'neutralMark' } as const, key: 'line' as const, width: strokeToken(theme, 'data'), dash: dashToken(theme, 'reference') }]
      : []),
    ...anomalyKeys,
  ].filter((item) => !axisKeyed.has(item.id) && !undrawn.has(item.id));
  // A hatched forecast column and a dashed forecast line are
  // one notation, keyed once: the hatch box with the dash beside it.
  const fcLine = items.find((item) => item.id === '__scenarioFCLine');
  const fcBox = items.find((item) => item.id === '__scenarioFC');
  if (fcLine && fcBox) items = items.flatMap((item) => item === fcLine ? [] : item === fcBox ? [{ ...fcBox, withLine: { paint: fcLine.paint, dash: fcLine.dash, width: fcLine.width, lineCap: fcLine.lineCap } }] : [item]);
  if (items.length === 0) return undefined;
  if (legendOpts.order) {
    const oi = (id: Id) => {
      const k = legendOpts.order!.indexOf(id);
      return k === -1 ? Number.MAX_SAFE_INTEGER : k;
    };
    items = [...items].sort((a, b) => oi(a.id) - oi(b.id));
  }
  return { options: legendOpts, items };
}

/**
 * The dual-axis key rule: on a combo with an acknowledged
 * secondary axis, an authored axis title over exactly one series carries
 * that series' swatch, so the series is keyed there and the key row lists
 * only what no title names (references, scenarios, anomaly marks).
 */
function axisKeyedSeries(domain: ComboDomain): Set<Id> {
  const keyed = new Set<Id>();
  // Pareto's highlight key paints its columns in two colours: no single swatch names them.
  const highlightKeyed = (domain.options as { [HIGHLIGHT_KEY]?: HighlightKey })[HIGHLIGHT_KEY] !== undefined;
  if (!domain.secondaryActive || kindSetting(domain, 'axisTitle') === false) return keyed;
  const active = { primary: domain.showPrimaryAxis || domain.ticksFromLabels === true, secondary: domain.rightTicks.length > 0 || domain.secondaryTicksHidden };
  for (const side of ['primary', 'secondary'] as const) {
    if (!active[side] || !domain.options.axisTitles?.[side]) continue;
    const series = domain.data.filter((s) => s.axis === side);
    if (series.length === 1 && !(highlightKeyed && series[0]!.kind === 'column')) keyed.add(series[0]!.id);
  }
  return keyed;
}

/** The scale-dependent frame inputs. Plot reserves do not change the frame. */
function comboFrameMargins(env: ComboEnv, domain: ComboDomain) {
  const { theme, size, measure } = env;
  const { options, dLo, dHi, fmt, secondaryActive } = domain;
  const leftAxisReserve = domain.showPrimaryAxis
    ? measureValueAxisWidth([dLo, dHi], fmt, theme, measure, 5, domain.valueSpec)
    : 0;
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  // Try a narrower unused canvas gutter before the category row rotates.
  const axisFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const categoryWidth = Math.max(0, maxOf(domain.cats.map(c => measure(c.label ?? c.id, axisFont).width))) + 4;
  if (domain.cats.length > 0 && categoryWidth > (size.width - margin.left - margin.right - leftAxisReserve) / domain.cats.length) {
    const gutter = measure('0', axisFont).height;
    if (options.margin?.left === undefined) margin.left = Math.min(margin.left, gutter);
    if (options.margin?.right === undefined) margin.right = Math.min(margin.right, gutter);
  }

  // A `side: 'left'` valueLine label lives in the air LEFT of the plot, and
  // nothing else reserved for it: with the axis hidden (pareto's default) the
  // pareto "80%" measured 25px against 28px of base margin, every candidate
  // started 1px off-canvas, and the emergency clamp in annotate.ts printed it
  // flush to the canvas edge — the one piece of ink ignoring the margin.
  // Reserve what the widest such label measures ON TOP of the margin in
  // force (an authored margin.left stays the author's baseline, the label's
  // air is added to it), so the label anchors at that margin like everything
  // else. Only annotations annotate.ts will actually render count: a string
  // label known this early, and — for `axis: 'secondary'` — an acknowledged
  // secondary axis with a numeric value (annotate.ts rejects the rest with a
  // warning, and a reserve for a rejected line is a permanently blank
  // gutter). Mean-derived texts keep the annotate.ts clamp as their backstop.
  const leftLineLabelW = Math.max(
    0,
    maxOf((options.annotations ?? []).flatMap((a) =>
      a.kind === 'valueLine' &&
      a.side === 'left' &&
      typeof a.label === 'string' &&
      a.label &&
      (a.axis !== 'secondary' || (secondaryActive && a.value !== 'mean' && a.value !== undefined))
        ? [measure(a.label, { family: theme.type.family, ...theme.type.label }).width]
        : [],
    )),
  );
  margin.left += leftLineLabelW > 0 ? Math.max(0, leftLineLabelW + 4 - leftAxisReserve) : 0;
  return { margin, leftAxisReserve };
}

/** Refit only the axis gutter when a new scale pair leaves the frame inputs unchanged. */
export function refitComboFrame(
  env: ComboEnv, before: ComboDomain, domain: ComboDomain, framed: ReturnType<typeof solveComboFrame>,
): ReturnType<typeof solveComboFrame> | undefined {
  const next = comboFrameMargins(env, domain);
  if ((['left', 'right', 'top', 'bottom'] as const).some(side => next.margin[side] !== framed.margin[side])
    || before.anomaly?.corridorNote !== domain.anomaly?.corridorNote
    || before.anomaly?.corridorShown.low !== domain.anomaly?.corridorShown.low
    || before.anomaly?.corridorShown.high !== domain.anomaly?.corridorShown.high
    || (before.rightTicks.length > 0) !== (domain.rightTicks.length > 0)) return undefined;
  return { ...framed, ...next };
}

/** The frame, with the legend as a layout participant; it claims into an index of its own. */
export function solveComboFrame(
  env: ComboEnv,
  domain: ComboDomain,
  paints: ComboPaints,
  warnings: LintWarning[],
  eventKey?: FrameBand,
): { frame: FrameResult; claims: OccupiedIndex; leftAxisReserve: number; margin: ReturnType<typeof comboFrameMargins>['margin'] } {
  const { theme, size, measure } = env;
  const { options } = domain;
  if (domain.anomaly && options.legend === 'none') {
    warnings.push({
      code: 'legend-suppressed-encoding',
      severity: 'warn',
      message: "legend: 'none' suppressed the only key naming this exhibit's encodings (the anomaly corridor and flag marker) — the reader is left to infer them",
      suggest: "drop legend: 'none', or drop anomaly",
    });
  }
  const { margin, leftAxisReserve } = comboFrameMargins(env, domain);
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const legend = comboLegend(env, domain, paints);
  const growthNote = growthStatements(env, domain).note;
  const frameOptions = (options as { [CATEGORY_ROW_FROM_END]?: boolean })[CATEGORY_ROW_FROM_END] === false ? options : withCategoryNoteNames(options, domain.cats);
  const frame = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(frameOptions),
      // The subtitle names the unit only when every plotted series is in it ("in $m" beside a series in k).
      ...(options.unit && domain.data.some((s) => s.unit !== undefined && !sameUnit(s.unit, options.unit!))
        ? { subtitle: resolveSubtitle(options.subtitle), unit: undefined } : {}),
      footnotes: [
        ...partialFootnotes(domain.cats, options.strings, legend?.items.some(item => item.id === '__partial') || partialNamedOnTotals(env, domain)), ...authoredNotes(frameOptions),
        ...noteLine(knownPartsLead(options), domain.columnsAdd ? domain.cats.flatMap((c, ci) => {
          if (!domain.incompleteCats.has(c.id)) return [];
          const missing = domain.columns.filter(s => s.vals[ci]!.v === null).map(s => s.label);
          return [`${c.label ?? c.id} ${options.strings!.without} ${missing.join(` ${options.strings!.and} `)}`];
        }) : [], options.notes?.maxListed === undefined ? undefined : options),
        // The anomaly rule, stated on the exhibit (column prints it over the plot).
        ...(domain.anomaly ? [disclosureNote(`${domain.anomaly.model.rule}${domain.anomaly.corridorNote}`)] : []),
        // The growth statements on a card, where the column beside the plot would cost it the width.
        ...(growthNote === undefined ? [] : [growthNote]),
        // Two scales without tick columns: the note says each series reads on its own.
        ...(domain.secondaryActive && domain.ticksFromLabels === true ? [disclosureNote(chartString(options, 'comboOwnScale'))] : []),
        // Moved shares matter only where the segments print them.
        ...(contentOf(domain, 'segment', ['absolute'])?.includes('percent') ? domain.shareNotes : []),
      ],
      legend,
      ...(eventKey ? { eventKey } : {}),
      theme,
      measure,
    },
    claims,
  );
  return { frame, claims, leftAxisReserve, margin };
}

/** Whether a label kind is on, and with which content. */
export function contentOf(domain: ComboDomain, kind: LabelKind, dflt: LabelContent): LabelContent | null {
  const s = kindSetting(domain, kind);
  if (s === false) return null;
  return Array.isArray(s) ? s : dflt;
}

/**
 * The partial categories whose column total prints the to-date words under it
 * ("316" over "to date"), so the value itself says the period runs. A stack
 * with segment values, the anatomy's inside value and a name that says
 * "to date" already keep the hatch key.
 */
export function toDateOnTotals(env: ComboEnv, domain: ComboDomain): Set<Id> {
  const ids = new Set<Id>();
  if (partialKeyForced(domain.options)) return ids;
  const toDateWords = domain.options.strings?.toDate ?? chartString(domain.options, 'toDate');
  if (!toDateFits(toDateWords, env.theme, env.measure, env.size.width / Math.max(1, domain.cats.length))) return ids;
  const segments = domain.columns.length > 1 && contentOf(domain, 'segment', ['absolute']) !== null;
  // Only a total that prints its value carries the words ('series' or [] content prints none).
  if (domain.columns.length === 0 || !domain.columnsAdd || segments || domain.anatomy || !contentOf(domain, 'grandTotal', ['absolute'])?.includes('absolute')) return ids;
  domain.cats.forEach((c, ci) => {
    if (c.partial !== true || !domain.anyByCat[ci] || saysToDate(c.label ?? c.id, toDateWords)) return;
    const populated = domain.columns.filter(column => column.vals[ci]!.v !== null);
    const override = populated.length === 1 ? populated[0]!.vals[ci]!.labelOverride : undefined;
    if (override === false || (typeof override === 'string' && override.trim() === '')) return;
    ids.add(c.id);
  });
  return ids;
}

/** Every drawn partial category carries the to-date words on its total: no hatch key, note or axis words. */
export function partialNamedOnTotals(env: ComboEnv, domain: ComboDomain): boolean {
  const named = toDateOnTotals(env, domain);
  // A running category with only a line value draws a hollow marker and no total: it keeps the shared cue.
  const drawn = (ci: number) => domain.anyByCat[ci] || domain.lines.some(s => s.vals[ci]!.v !== null);
  return named.size > 0 && domain.cats.every((c, ci) => c.partial !== true || !drawn(ci) || named.has(c.id));
}

export function kindSetting(domain: ComboDomain, kind: LabelKind): boolean | LabelContent {
  const l = domain.options.labels;
  // `labels: false` turns the optional data labels off; an authored axis
  // title names its scale and stays (labels.axisTitle: false removes it), and
  // so do the category names (labelsOffKeepsNames).
  if (l === false) return kind === 'axisTitle' || (kind === 'category' && labelsOffKeepsNames(domain.options));
  const v = l?.[kind];
  return v === undefined ? true : v;
}

/** The label's parts as lines: a value and its share (`value.share`, a stacked segment's) one over the other. */
export function composeLines(
  domain: ComboDomain,
  content: LabelContent,
  value: { abs: number | null; isPct: boolean; share?: number | null; shareText?: string; format?: string },
  catLabel: string,
  serLabel: string,
  serFmt: (v: number) => string,
): string[] {
  const { abs, isPct, share } = value;
  const explicit = !value.format ? undefined : value.format === domain.options.format ? domain.fmt : formatterFromExample(value.format, domain.options.locale?.language);
  const parts: [LabelContent[number], string][] = [];
  for (const c of content) {
    if (c === 'absolute' && abs !== null) parts.push([c, explicit ? explicit(abs) : isPct ? domain.pctFmt(abs) : serFmt(abs)]);
    else if (c === 'percent' && abs !== null && isPct) parts.push([c, explicit ? explicit(abs) : domain.pctFmt(abs)]);
    else if (c === 'percent' && share !== undefined && share !== null) parts.push([c, value.shareText ?? formatShare(share, domain.options.locale?.language)]);
    else if (c === 'category' && catLabel) parts.push([c, catLabel]);
    else if (c === 'series' && serLabel) parts.push([c, serLabel]);
  }
  return valueShareLines(parts);
}

export function composeText(...args: Parameters<typeof composeLines>): string {
  return composeLines(...args).join(' ');
}

/** Axis titles, end-label texts and the band layout that needs them, then the plot rect and scales. */
export function comboPlotArea(
  env: ComboEnv,
  domain: ComboDomain,
  paints: ComboPaints,
  framed: { frame: FrameResult; leftAxisReserve: number },
  gutterOverride: EndpointGutters | undefined,
  warnings: LintWarning[],
): ComboArea {
  const { theme, measure, highlights, size } = env;
  const { frame, leftAxisReserve } = framed;
  const { options, cats, columns, lines, showPrimaryAxis, rightTicks } = domain;
  const rightAxisActive = rightTicks.length > 0;
  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const gtH = measure('0', strongFont).height;
  const gtContent = columns.length > 0 && domain.columnsAdd ? contentOf(domain, 'grandTotal', ['absolute']) : null;
  // The row over the plot for the column totals. The anatomy seats a single
  // column series' value inside its column top (grandTotalLabels), or over a
  // column too short to hold it, below the tallest column's top: the row held
  // nothing there. Other combos keep it: their lines take the first seat over
  // a column, and a Pareto's threshold, drawn after the labels, runs through
  // a total pushed inside.
  // When the scale already leaves the row's
  // height of air over the tallest column, the totals print in that air and the row goes back
  // to the plot (pareto: the share scale runs to the grand total, the columns to 40% of it).
  const tallest = Math.max(0, maxOf(domain.posTop));
  const estPlotH = frame.plot.h - 8 - 4 * gtH;
  const totalsAirInScale = domain.dHi > domain.dLo && tallest > 0
    && (domain.dHi - tallest) / (domain.dHi - domain.dLo) * estPlotH >= gtH + 6 + 4
    // A total seats inside its column only where the column holds it; a narrow column puts it over
    // the top, where a line through the column top (a Pareto's first share point) takes the seat.
    && frame.plot.w / Math.max(1, cats.length) * 0.6 >= Math.max(0, maxOf(cats.map((c) => measure(composeText(domain, gtContent ?? ['absolute'],
      { abs: domain.stackTotals[c.id] ?? 0, isPct: false, format: domain.options.format }, c.label ?? c.id, '', domain.fmt), strongFont).width))) + 8;
  const totalsRow = gtContent && !(domain.anatomy && columns.length === 1) && !totalsAirInScale ? gtH + 6 : 0;
  // A tinted column fill is no text colour: its axis title takes the ink.
  const columnTitlePaint = (paint: Paint): Paint => ('tint' in paint && paint.tint !== undefined ? { token: 'ink' } : paint);
  const titles = { ...domain.options.axisTitles };
  if (domain.secondaryActive) for (const side of ['primary', 'secondary'] as const) {
    const group = domain.data.filter(s => s.axis === side);
    const units = new Set(group.map(s => s.unit).filter(Boolean));
    const unit = side === 'primary' ? options.unit ?? (units.size === 1 ? [...units][0] : undefined) : units.size === 1 ? [...units][0] : undefined;
    if (unit && !textCarriesUnit(titles[side] ?? '', unit)) titles[side] = titles[side] ? `${titles[side]}, ${unit}` : unit;
  }
  const axisTitles = planComboAxisTitles({
    series: domain.data, titles,
    active: { primary: (showPrimaryAxis || domain.ticksFromLabels === true) && kindSetting(domain, 'axisTitle') !== false,
      secondary: (rightAxisActive || domain.secondaryTicksHidden) && kindSetting(domain, 'axisTitle') !== false },
    // The anatomy titles its axes in the axis face at 500, as line,
    // column and bar do; the plain dual axis keeps the label face.
    frame: frame.plot, font: domain.anatomy ? secondaryFont(theme) : labelFont, ...(domain.anatomy ? { typeRole: 'secondary' as const } : {}), measure,
    below: totalsRow, tickHalf: domain.ticksFromLabels ? 0 : measure('0', tickFont).height / 2,
    // With no tick column to stand over, the titles key their series in one row from the left.
    ...(domain.ticksFromLabels ? { row: true } : {}),
    paintOf: (s) => s.kind === 'column'
      ? highlights.has(s.id) ? { token: 'focus' } : columnTitlePaint(paints.column(s, columns.indexOf(s)))
      : paints.line(s, lines.indexOf(s)),
    ...(domain.anatomy || axisKeyedSeries(domain).size > 0 ? {
      swatchOf: (s: NormSer) => !domain.anatomy && !axisKeyedSeries(domain).has(s.id) ? undefined : s.kind === 'line'
        ? { kind: 'line' as const, paint: paints.line(s, lines.indexOf(s)), width: paints.lineWidth(s, lines.indexOf(s)), dash: paints.dash(s),
          lineCap: paints.dash(s)?.join(',') === dashToken(theme, 'dotted').join(',') ? 'round' as const : 'butt' as const,
          ...(paints.lineHollow(s) ? { hollow: true } : {}) }
        : { kind: 'box' as const, paint: s.kind === 'column' && highlights.has(s.id) ? { token: 'focus' as const } : s.kind === 'column' ? paints.column(s, columns.indexOf(s)) : paints.line(s, lines.indexOf(s)) },
    } : {}),
  });
  pushAll(warnings, axisTitles.warnings);
  // A growth bracket seats its label on its run: 16 px over the plot, not 30 (column's CAGR_ON_ARM_ROOM).
  const hasCagr = (domain.options.annotations ?? []).some((a) => a.kind === 'cagr');
  // A row for the "FC" that names where per-cell forecasts start, as line has.
  const forecast = comboForecastBoundaries(domain);
  const forecastRow = forecast.length > 0 ? measure(options.strings!.forecastHeader!, secondaryFont(theme)).height + 8 : 0;
  // Staircase names replace the category row (options.categoryLabels); they take the room they ask for over the plot.
  const stair = staircaseOn(options.categoryLabels, options) && columns.length > 0 && kindSetting(domain, 'category') !== false && cats.length > 1;
  // The on-run growth label keeps 39 px of air under the subtitle (column's CAGR_ON_ARM_ROOM), less the rows over the plot.
  const cagrRoom = Math.max(16, 39 - axisTitles.height);
  let topPad = 8 + axisTitles.height + forecastRow + totalsRow + (hasCagr ? cagrRoom : 0) + (stair ? staircaseState(options).pad : 0);
  // Room the on-run growth label leaves free under its 30 px goes to the plot at an engine-chosen height.
  if (hasCagr && cagrRoom < 30) recordFreedChrome(frame.frame, 'cagr-headroom', 30 - cagrRoom);
  // End-label text is measured before the plot is final, so a gutter can be
  // reserved for a label placed beside the plot. A line end label is
  // the value at its mark; the series name is the author's to add
  // (`labels.point: ['series', 'absolute']`), never composed.
  // valueLabels says which ends the engine labels ('last' the last only,
  // 'none' or `labels.point: false` neither); an authored cell label there
  // still prints, its `${value}` as the plain value.
  const pointContent = contentOf(domain, 'point', ['absolute']);
  const valueLabels = comboValueLabels(options, domain.anatomy, domain.cats.length);
  const texts = prepareComboEndpointTexts(
    lines,
    (series, ci) => {
      const value = series.vals[ci]!;
      return composeText(domain, pointContent ?? ['absolute'], { abs: value.v, isPct: value.isPct, format: domain.explicitFormatOf(series, value) }, cats[ci]!.label ?? cats[ci]!.id,
        series.label, series.format ? env.byExample(series.format) : domain.scaleFmtOf(series));
    },
    { first: s => pointContent !== null && (['ends', 'extremes', 'all'].includes(valueLabels)
      || (options.valueLabels === undefined && domain.secondaryActive && s.axis === 'secondary')),
      last: pointContent !== null && valueLabels !== 'none' },
  );
  // The tick-band reserve must equal what the measured labels need,
  // and the wrap needs the band step, which depends only on the final x-extent.
  const rightAxisReserve = rightAxisActive
    ? Math.max(maxOf(rightTicks.map((tick) => measure(tick.text, secondaryFont(theme)).width)), 1) + 10
    : 0;
  const growthPlan = growthStatements(env, domain);
  const growthList = growthPlan.inNote ? [] : growthPlan.items;
  const { valueFont: growthValueFont, nameFont: growthNameFont } = growthPlan;
  const growthReserve = growthList.length > 0 ? growthPlan.reserve : 0;
  // A gutter only for a label placed beside the plot, only as wide as
  // it overflows; a second run drops a gutter the solver left empty.
  const axisW = showPrimaryAxis ? Math.max(10, frame.plot.w - leftAxisReserve) : frame.plot.w;
  const sharesOnColumns = (domain.options as { [FIRST_END_BELOW_TOTALS]?: boolean })[FIRST_END_BELOW_TOTALS] === true;
  const gutters = gutterOverride ?? endpointGutters({
    // A combo line end stays inside the plot; Pareto's share curve keeps its gutter.
    first: new Map([...texts.first].filter(([id]) => sharesOnColumns || lines.find(s => s.id === id)?.kind !== 'line')),
    last: new Map([...texts.last].filter(([id]) => sharesOnColumns || lines.find(s => s.id === id)?.kind !== 'line')), count: cats.length, font: labelFont, measure, markerR: MARKER_R,
    width: axisW - rightAxisReserve - growthReserve,
    adjacent: { first: showPrimaryAxis, last: rightAxisActive },
  });
  // The anomaly rules carry their numbers right of everything else, as on column.
  const anomalyReserve = domain.anomaly
    ? anomalyRuleReserve(anomalyRuleLines(theme, domain.anomaly.model, domain.anomaly.corridorShown, domain.anomaly.statFmt, { token: 'warn' }, options.strings), labelFont, measure)
    : 0;
  // A right valueLine label reads on its line inside the plot (annotate.ts,
  // rightLineSeats); a gutter comes only from a pass that had to hide it.
  const valueLineFont = { ...labelFont, weight: emphasisWeight(theme) };
  const rightLineLabels = (domain.options.annotations ?? []).filter(a => a.kind !== 'event').flatMap((annotation, index) => {
    if (annotation.kind !== 'valueLine' || annotation.label === false || (annotation.side ?? 'right') !== 'right') return [];
    const value = typeof annotation.value === 'number' ? annotation.value : domain.columnsAdd
      ? domain.sourceMean ?? (columns.length > 0 && cats.length > 0
        ? cats.reduce((sum, _, ci) => sum + domain.posTop[ci]! + domain.negBot[ci]!, 0) / cats.length
        : primaryLineMean(domain.lines.map(s => ({ s, pts: [] })), domain.secondaryActive))
      : undefined;
    if (value === undefined) return [];
    const example = annotation.format ?? domain.options.format;
    const fmt = example ? formatterFromExample(example, domain.options.locale?.language) : (v: number) => formatAutomaticNumber(v, { locale: domain.options.locale?.language, decimals: autoDecimals(v), signed: false });
    const span = domain.meanSpan({ from: annotation.from, to: annotation.to });
    const text = typeof annotation.label === 'string' ? namedLineText(annotation.label, fmt(value), value, annotation.id ?? '') : `${options.strings!.average} ${fmt(value)}${span ? ` (${span})` : ''}`;
    return [{ id: defaultAnnotationId(annotation, index), text, width: measure(text, valueLineFont).width + 8,
      mean: annotation.value === 'mean' || annotation.value === undefined || annotation.id === domain.averageMarkerId }];
  });
  // Keep a mean at its line unless its label would be wider than the remaining plot.
  const lineBudget = Math.max(0, axisW - rightAxisReserve - growthReserve - anomalyReserve - gutters.first - gutters.last) / 2;
  const valueLineRows = new Map<Id, Rect>();
  let rowY = frame.plot.y + axisTitles.height + forecastRow + 8;
  for (const line of rightLineLabels.filter(line => line.mean && line.width > lineBudget)) {
    const lines = wrapText(line.text, valueLineFont, frame.plot.w, Math.max(1, line.text.length), measure).lines;
    const h = measure('0', valueLineFont).height * lines.length;
    valueLineRows.set(line.id, { x: frame.plot.x, y: rowY, w: frame.plot.w, h });
    rowY += h + 8;
    topPad += h + 8;
  }
  const lineLabelReserve = (options as { [VALUE_LINE_RESERVE]?: number })[VALUE_LINE_RESERVE] ?? 0;
  const rightReserve = rightAxisReserve + Math.max(gutters.last + growthReserve + anomalyReserve, lineLabelReserve);
  let plotX0 = frame.plot.x + (showPrimaryAxis ? leftAxisReserve : 0) + gutters.first;
  let plotW0 = Math.max(10, axisW - rightReserve - gutters.first);
  const endpointWidth = plotW0;
  const insideIds = (options as { [INSIDE_ENDPOINT_IDS]?: Set<Id> })[INSIDE_ENDPOINT_IDS];
  const inside = insideEndpointGutters({ ids: insideIds, first: texts.first, last: texts.last,
    cats, width: endpointWidth, font: labelFont, measure, markerR: MARKER_R });
  const bandFraction = comboBandFraction(domain.options, cats.length);
  const bandFor = (x0: number, w: number) =>
    bandScale(cats.length, [x0 + inside.first, x0 + w - inside.last], { paddingInner: 1 - bandFraction, paddingOuter: (1 - bandFraction) / 2 + 0.05 });
  // Staircase names run past the last column on the falling side; the band gives that room.
  if (stair) {
    const direction = staircaseDirection(domain.posTop);
    const room = staircaseRoom({
      names: cats.map((c) => c.label ?? c.id), font: tickFont, measure, direction,
      edge: direction === 'right' ? plotX0 + plotW0 : plotX0, width: plotW0,
      centers: (r) => { const b = bandFor(direction === 'right' ? plotX0 : plotX0 + r, plotW0 - r); return cats.map((_, ci) => b.center(ci)); },
    });
    if (direction === 'left') plotX0 += room;
    plotW0 -= room;
  }
  let band = bandFor(plotX0, plotW0);
  const categoryNames = cats.map(category => category.label ?? category.id);
  const periodRow = cats.some(category => (category as { calendar?: unknown }).calendar) || isDateNumericTickSequence(categoryNames)
    || calendarLike(categoryNames) || categoryNames.every(label => /^[MWT]\d+$/i.test(label));
  // Combo publishes the rank to name mapping, so it takes ranks over a
  // row of cut names. `withCategoryRanks` keeps that decision, and the strings
  // that carry the mapping, out of the shared cascade every type imports.
  const planRow = (b: typeof band, ticked?: ReturnType<typeof dateTickRow>) => {
    const row = categoryLabelsAndMarks(cats, { count: authoredFootnoteCount(options), warnings }, partialAxisWords(options.strings, options, frame.legend?.items.some((item) => item.id === '__partial') || partialNamedOnTotals(env, domain)));
    ticked?.name(row);
    return withCategoryRanks(planCategoryRow({
      rotate: !cats.every(c => MONTH_START.exec((c.label ?? c.id).trim())?.[0] === (c.label ?? c.id).trim()),
      target: options.target, textScale: textScaleOf(options),
      ...row,
      // A ranked row (pareto) is not a timeline: its dates are not a calendar tick row.
      ...((options as { [CATEGORY_ROW_FROM_END]?: boolean })[CATEGORY_ROW_FROM_END] === false ? { dates: undefined } : { reference: { x: frame.plot.x, width: frame.plot.w } }),
      strideFromEnd: periodRow && (options as { [CATEGORY_ROW_FROM_END]?: boolean })[CATEGORY_ROW_FROM_END] !== false,
      rotate90: (options as { [CATEGORY_ROW_VERTICAL]?: boolean })[CATEGORY_ROW_VERTICAL] === true,
      centers: cats.map((_, ci) => b.center(ci)),
      step: b.step,
      fonts: [tickFont, { ...tickFont, size: tickFont.size - scaleTextPx(1, textScaleOf(options)) }, { family: theme.type.family, ...theme.type.footnote }],
      secondary: secondaryFont(theme), periods: periodRow,
      padding: 4,
      measure,
      plotHeight: frame.plot.h,
      // A name the rotated row cuts takes the next note number after the author's.
      // A cut name takes a note mark only where its note prints.
      // Without the rank key, nominal names keep one name per column (rotate, then ellipsis).
      // Under notes.show 'ranks' alone a cut name takes no mark, since its note does not print.
      ...(disclosuresShown(options) ? { cutMarkFrom: authoredFootnoteCount(options) + 1 } : rankKeyShown(options) ? {} : { everyName: true }),
      ...ticked?.plan,
    }), measure, cats.map((c) => c.label ?? c.id), (options as { [FORCE_CATEGORY_RANKS]?: true })[FORCE_CATEGORY_RANKS] === true, rankKeyShown(options));
  };
  let catPlan = planRow(band);
  // A ranked row (pareto) is not a timeline, so it keeps its day names.
  const ticked = (options as { [CATEGORY_ROW_FROM_END]?: boolean })[CATEGORY_ROW_FROM_END] === false ? undefined : longDayMonths(cats, catPlan.stride, options.locale?.language);
  if (ticked) catPlan = planRow(band, ticked);
  const catOverhang = stair ? 0 : rotatedLeftOverhang(catPlan, cats.map((_, ci) => band.center(ci)), 4);
  if (catOverhang > 0) {
    plotX0 += catOverhang;
    plotW0 -= catOverhang;
    band = bandFor(plotX0, plotW0);
    catPlan = planRow(band, ticked);
  }
  const showCatTickRow = kindSetting(domain, 'category') !== false && cats.length > 0 && !stair;
  if (showCatTickRow) {
    pushAll(warnings, catPlan.warnings);
    // The rank plan carries no lint of its own: the mapping belongs to the
    // caller that can publish it.
    if (catPlan.step === 'ranks') warnings.push(categoryRanksLint(cats.map((c) => c.label ?? c.id), band.step));
  }
  const catBandH = showCatTickRow ? catPlan.rowHeight + 8 : 0;
  // The category row reads under the lowest column and the value or
  // total hanging under it; the plot makes that room.
  const hangingRoom = showCatTickRow && domain.options.labels !== false ? Math.max(measure('0', labelFont).height, gtH) + 4 : 0;
  const lowest = Math.min(0, minOf(domain.negBot));
  // A stack's total hangs under it when nothing of the stack is above zero.
  const hangingEnd = Math.min(0, minOf(domain.negBot.map((bottom, ci) => (domain.posTop[ci]! <= 0 ? bottom : 0))));
  const rawBandPad = (options as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
  const baseTopPad = topPad;
  const plotH0NoBand = frame.plot.h - catBandH - baseTopPad;
  const hangingReserveNoBand = hangingLabelReserve(plotH0NoBand, [domain.dLo, domain.dHi], hangingEnd, hangingRoom);
  const minRawH = Math.max(10, options.mode === 'compact' ? 80 : 0);
  let bandPad = rawBandPad > 0 ? Math.max(0, Math.min(rawBandPad, Math.floor(plotH0NoBand - hangingReserveNoBand - minRawH))) : 0;
  while (
    bandPad > 0 &&
    frame.plot.h - catBandH - (baseTopPad + bandPad) -
      hangingLabelReserve(frame.plot.h - catBandH - (baseTopPad + bandPad), [domain.dLo, domain.dHi], hangingEnd, hangingRoom) <
      minRawH
  ) {
    bandPad--;
  }
  topPad = baseTopPad + bandPad;
  const plotH0 = frame.plot.h - catBandH - topPad;
  const hangingReserve = hangingLabelReserve(plotH0, [domain.dLo, domain.dHi], hangingEnd, hangingRoom);
  // Shrink the plot to the pre-measured reserves, in this order.
  const plot = {
    x: frame.plot.x + gutters.first,
    y: frame.plot.y + topPad,
    w: Math.max(10, frame.plot.w - gutters.first),
    h: plotHeightAfter(frame, size.height, plotH0 - hangingReserve),
  };
  // keep room for the value labels and for separated anomaly labels.
  const minPlot = plotFloorRows(options) * measure('0', labelFont).height + 8;
  frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0, size.height + (frame.deficit ?? 0) + minPlot - (plotH0NoBand - hangingReserveNoBand));
  if (showPrimaryAxis) {
    plot.x += leftAxisReserve;
    plot.w = Math.max(10, plot.w - leftAxisReserve);
  }
  plot.w = Math.max(10, plot.w - rightReserve);
  const { dLo, dHi, pticks, secondaryDomain } = domain;
  const secondaryRange = secondaryDomain ? secondaryPrimaryRange(options, secondaryDomain, pticks) : undefined;
  // A line end needs a free text row above its point and any column there.
  // Reserve only the missing room inside the scale. Frame height is unchanged.
  const endpointAir = columns.length === 0 || !(dHi > dLo) || sharesOnColumns ? 0 : Math.max(0,
    maxOf([...texts.first, ...texts.last].flatMap(([id, end]) => {
      const series = lines.find(s => s.id === id);
      if (series?.kind !== 'line' || end.suppressed) return [];
      const raw = series.vals[end.ci]!.v ?? dLo;
      const lower = secondaryRange?.[0] ?? pticks[0]!;
      const upper = secondaryRange?.[1] ?? pticks[pticks.length - 1]!;
      const plotted = series.axis === 'secondary' && secondaryDomain && secondaryDomain[1] > secondaryDomain[0]
        ? lower + (raw - secondaryDomain[0]) / (secondaryDomain[1] - secondaryDomain[0]) * (upper - lower) : raw;
      const value = Math.max(plotted, domain.posTop[end.ci]!);
      const share = Math.max(0, Math.min(1, (dHi - value) / (dHi - dLo)));
      const room = measure(end.text, labelFont).height + MARKER_R + 4;
      return share < 1 ? [Math.ceil((room - share * plot.h) / (1 - share))] : [];
    })));
  const y = linearScale([dLo, dHi], [plot.y + plot.h, plot.y + Math.min(endpointAir, plot.h / 3)]);
  // The engine's own date labels make a date row whatever their words (catPlan.dateNumeric).
  const dateNumericTicks = catPlan.dateNumeric || isDateNumericTickSequence(cats.map((c) => c.label ?? c.id));
  return {
    frame, leftAxisReserve, rightAxisReserve, axisTitles, topPad, tickFont, labelFont, strongFont, gtH, valueLineRows,
    first: texts.first, last: texts.last, gutters, endpointWidth, band, catPlan,
    dateNumericTicks,
    // A date row stays at the plot's bottom band; prose reads under the
    // lowest column and the value or total hanging under it.
    catRowY: dateNumericTicks ? plot.y + plot.h + hangingReserve : categoryRowTop(y, lowest, hangingEnd, hangingRoom),
    showCatTickRow, catBandH, plot,
    // The names may rise to the frame top, under the axis titles.
    ...(stair ? { stairTop: frame.plot.y + axisTitles.height } : {}),
    rightTickX: plot.x + plot.w + RIGHT_TICK_GAP,
    anomalyLabelX: plot.x + plot.w + rightAxisReserve + gutters.last + growthReserve + 4,
    y,
    y0: y(0),
    y2: secondaryDomain ? linearScale(secondaryDomain, [y(secondaryRange![0]), y(secondaryRange![1])]) : y,
    ...(growthList.length > 0 ? {
      growth: {
        x: plot.x + plot.w + rightAxisReserve + GROWTH_GAP - 2, valueFont: growthValueFont, nameFont: growthNameFont, oneLine: growthPlan.oneLine,
        // Each statement takes its series' text twin: the line's ink, or the single column's.
        items: growthList.map((item) => {
          const line = lines.find((s) => s.id === item.seriesId);
          const paint = line ? paints.line(line, lines.indexOf(line)) : columns.length === 1 ? paints.column(columns[0]!, 0) : undefined;
          return paint ? { ...item, textPaint: seriesTextPaint(paint) } : item;
        }),
      },
    } : {}),
    forecast,
    forecastHeaderY: plot.y - totalsRow - forecastRow,
  };
}

/** Where a series turns from actual cells to per-cell forecast ones; a whole-series FC is keyed by its own dash or hatch. */
function comboForecastBoundaries(domain: ComboDomain): ForecastBoundary[] {
  const starts = new Map<string, { categoryIndex: number; lastActualIndex: number }>();
  for (const s of domain.data) {
    if (s.scenario === 'FC') continue;
    const start = s.vals.findIndex((val) => val.v !== null && val.scenario === 'FC');
    if (start > 0 && s.vals.slice(0, start).some((val) => val.v !== null)) {
      let actual = start - 1;
      if (s.kind === 'line' || s.kind === 'area') while (actual > 0 && s.vals[actual]!.v === null) actual--;
      starts.set(`${actual}:${start}`, { categoryIndex: start, lastActualIndex: actual });
    }
  }
  const transitions = [...starts.values()].sort((a, b) => a.categoryIndex + a.lastActualIndex - b.categoryIndex - b.lastActualIndex);
  const usedIds = new Set(domain.cats.map(category => category.id));
  return transitions.map(({ categoryIndex, lastActualIndex }) => {
    const categoryId = domain.cats[categoryIndex]!.id;
    let id = categoryId;
    if (transitions.filter(item => item.categoryIndex === categoryIndex).length > 1) {
      id = `${categoryId}:from:${lastActualIndex}`;
      while (usedIds.has(id)) id += ':2';
      usedIds.add(id);
    }
    return { categoryIndex, categoryId, id, lastActualIndex, labelled: false, divided: false };
  });
}
