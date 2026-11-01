import { chartString } from '../../strings/dot';
import { breakUnsupported, chartPalette, chartTheme } from '../chartEnv';
import { labelOn as chartLabelOn } from '../labelOn';
import { structureCount } from '../../structureCounts';
import { distinguishSeries } from '../../seriesIdentity';
/**
 * Dot family — one layout engine, three
 * styles over ChartData, horizontal rows like bar:
 *   'dot'      Cleveland dot plot — one circle per category (multi-series:
 *              grouped dots per row with series colors + legend),
 *   'dumbbell' two dots + connector (exactly 2 data series; derived gap),
 *   'lollipop' thin stem from the zero baseline to the value + dot head.
 * Position encoding needs a scale, so the value axis is SHOWN BY DEFAULT and
 * zero is NOT forced into the domain — a non-zero baseline is legitimate here
 * and only flagged with an info-level 'nonzero-baseline' lint.
 */

import { rowLabelBand } from '../../label/rowLabels';
import { fittedLabel, gutterBudget, stepDownFont } from '../../label/rowFit';
import { namedLineText } from '../../annotateParts';
import type { AnchorResolution } from '../../annotate';
import { percentCellsOnly, percentLevels, runAnnotatePass } from '../../annotatePass';
import { applyValueAxisTitleInk, layoutValueAxis, planValueAxisTitle, valueAxisTitleRequest } from '../../axis';
import { arrowHeadPath, arrowShaftEnd } from '../../svgPath';
import { formatStatWithSpec, formatterFromExample, neededDecimals, seriesRasterFormatter } from '../../formatSpec';
import { formatAutomaticNumber } from '../../format';
import { autoDecimals } from '../../formatPrecision';
import { localeStrings } from '../../strings/dot';
import { MARK_CONTRAST_FLOOR, palettePerceptualDistance } from '../../themeRules';
import { hueSaturation } from '../../color';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { CONTENT_PLOT_HEIGHT, HARD_MINIMUM, type ContentPlotHeight } from '../../sizing';
import { REFERENCE_LABEL_CLEARANCE } from '../../markVisibility';
import { averageMarkerLine, averageMarkerScope } from '../band/stacks';
import { rowLabelX, type Rect } from '../../geometry';
import { clamp, cleanDiff, round2, unionRect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { seatsPastBlockers } from '../../label/slots';
import {
  labelCtx,
  isOwnMark,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SlotCandidate,
  type SolveCtx,
} from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  normalizeCategory,
  normalizeScenario,
  normalizeSeriesValues,
  resolveHighlight,
  resolveSize,
  resolveSubtitle,
} from '../../normalize/shared';
import { resolveCellRange, type DataRange, type RangeMark } from '../../rangeRules';
import { applyAxisBounds, bandScale, linearScale, niceDomain } from '../../scale';
import { unitPrinted, frameTextOptions, normalizeLegendOption, solveFrame, fixedPlotChrome, type LegendItemInput, plotHeightAfter, authoredFootnoteCount, authoredNotes } from '../../frame';
import { defaultMeasurer, type FontSpec } from '../../text';
import {
  canvasMargin,
  colorRolePaints,
  markRolePaint,
  recedingSeriesId,
  seriesPaint as themeSeriesPaint,
  paintColor,
  mutedMarkPaint,
  emphasisWeight,
  gridDash,
  strokeToken,
  dashToken,
} from '../../theme';
import type { AnchorRef, Annotation } from '../../types/annotations';
import { cellMeta, cellValue, isPctCell, type CellMeta, type Direction, type Id, type OwnerRef, type Scenario } from '../../types/cell';
import { warnMissingValue } from '../../dataGaps';
import type { ChartData } from '../../types/data';
import type { DotOptions, LabelKind, LegendOptions } from '../../types/options';
import type {
  Geometry,
  LintWarning,
  Paint,
  PlacedAnnotation,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import { composedTextRole } from '../../textRole';
import { textScaleOf } from '../../typeFloors';
import { disclosureNote } from '../../notes';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface DotMarks {
  rows: {
    categoryId: Id;
    dots: { seriesId: Id; cx: number; cy: number; nodeId: Id }[];
    /** dumbbell only: the connector line between the two dots. */
    connectorNodeId?: Id;
    /** lollipop only: the stem from the baseline to the dot head. */
    stemNodeId?: Id;
  }[];
  ranges?: RangeMark[];
}

export interface DotDerived {
  /** dumbbell only: second series minus first series, per category. */
  gaps?: Record<Id, number>;
}

interface NormSeries {
  id: Id;
  label: string;
  scenario?: Scenario;
  role: 'data' | 'reference';
  colorRole?: string;
  fill?: string;
  /** Series format example and unit (a series format overrides). */
  format?: string;
  unit?: string;
  /** As authored; only the dumbbell arrow reads it, so the default is not filled in. */
  direction?: Direction;
  slot: number; // ramp slot among data series
  cells: { v: number | null; isPct?: boolean; meta: CellMeta | null; range?: DataRange }[];
}

interface NormCat {
  id: Id;
  label: string;
  /** Carried to the annotation anchors so cagr has a real span to annualise. */
  date?: string;
  /** Authored footnote reference, drawn beside the name. */
  footnote?: number;
}

const LABEL_GAP = 5;
/** The dumbbell arrowhead, from the tip back along the shaft. */
const ARROW_HEAD = 7;
const CAT_BAND_GAP = 10;
/** A card (the frame's card class, sizing.ts CARD_CLASS_WIDTH): a dumbbell names its rows in headers above the pairs. */
const HEADER_ROWS_MAX_WIDTH = 480;

/**
 * The most row pitch an automatic height gives each
 * style, at 600 px and wider and on a narrower card. A plot floor that would draw
 * rows farther apart gives the card less height instead.
 */
const ROW_PITCH_CAP: Record<'dot' | 'dumbbell' | 'lollipop', readonly [wide: number, card: number]> = {
  dot: [44, 40], lollipop: [38, 32], dumbbell: [48, 40],
};
/** The row pitch of a dumbbell that names its rows in headers: 42 px at 480, 40 px narrower. */
const headerRowPitch = (width: number): number => (width >= HEADER_ROWS_MAX_WIDTH ? 42 : 40);
const NARROW_PITCH_WIDTH = 600;
/** Dot radius: 5 px on a dot plot and on a card, 5.5 px on a lollipop and a 720 px dumbbell, 6 px on a 960 px dumbbell. */
function dotRadiusCap(variant: string, width: number): number {
  if (variant === 'lollipop') return 5.5;
  if (variant === 'dumbbell') return width >= 960 ? 6 : width >= NARROW_PITCH_WIDTH ? 5.5 : 5;
  return 5;
}

/** Space between a reference line and a value label beside it. */
const LINE_CLEAR = 7;

/**
 * The dumbbell connector carries the gap, the chart's message: the muted
 * mark, held at the 3:1 non-text floor on the page (WCAG 1.4.11) and so
 * quieter than the dots, which keep their series colour.
 */
const CONNECTOR_PAINT: Paint = mutedMarkPaint();
/** A range rail carries data: the connector's paint, at the focus width. */
const RAIL_PAINT = CONNECTOR_PAINT;
/** Range caps a step darker than the rail, so each bound reads as an end. */
const CAP_PAINT: Paint = { token: 'neutralMark', theme: { kind: 'visible-tint', base: { token: 'neutralMark' }, amount: 0.3, floor: MARK_CONTRAST_FLOOR + 0.5 } };
/** Most rows a missing-midpoint note names before it counts them. */
const MID_NOTE_NAMES = 4;
/** The mid-point marker in the key, as the plot draws it beside a 6 px dot. */
const MID_KEY_R = 3.5;
/** Below this HSV saturation a theme's first series is a grey: the scenario notation. */
const GREY_SATURATION = 0.05;

/**
 * A merged dumbbell label. An unchanged pair says so, and a changed one reads
 * "a to b" (an arrow glyph would set in a fallback face and run into its dot).
 */
const pairText = (ta: string, tb: string, options?: Pick<DotOptions, 'locale' | 'strings'>): string => (ta === tb ? chartString(options, 'unchangedPair', { v1: ta }) : chartString(options, 'spanText', { v1: ta, v2: tb }));

export function layoutDot(data: ChartData, options: DotOptions = {}): Geometry<DotMarks, DotDerived> {
  const warnings: LintWarning[] = [];
  breakUnsupported('dot', options, warnings);
  const theme = chartTheme(options);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const variant = options.variant ?? 'dot';
  if (options.arrow && variant !== 'dumbbell') {
    warnings.push({
      code: 'arrow-dumbbell-only',
      severity: 'warn',
      message: `options.arrow draws the change from the first to the second series of a dumbbell; variant '${variant}' has no pair, so it is ignored`,
      suggest: "set variant: 'dumbbell' with two series, or drop options.arrow",
      field: ['options', 'arrow'],
    });
  }
  const highlights = new Set(resolveHighlight(options.highlight));
  const labelOn = (kind: LabelKind): boolean => chartLabelOn(options, kind);

  // ---- normalize ----
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'dot requires at least one category');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'dot requires at least one series');
  }
  const rawCats = data.categories.map((c, i) => normalizeCategory(c as never, i));
  const normSeries: NormSeries[] = data.series.map((s, i) => {
    if (!s?.id) throw new NormalizeError('missing-id', `series[${i}]`, 'series requires an id');
    const cells = normalizeSeriesValues(s, rawCats, i).map((c, ci) => ({
      v: cellValue(c),
      ...(isPctCell(c) ? { isPct: true } : {}),
      meta: cellMeta(c),
      range: resolveCellRange(
        c,
        `series[${s.id}].values[${ci}]`,
        warnings,
        { seriesId: s.id, categoryId: rawCats[ci]?.id },
      ),
    }));
    cells.forEach((cell, ci) => {
      if (cell.v === null && s.role !== 'reference') warnMissingValue(warnings, `series '${s.id}' at '${rawCats[ci]!.id}'`, { seriesId: s.id, categoryId: rawCats[ci]!.id });
    });
    return {
      id: s.id,
      label: s.label ?? s.id,
      scenario: normalizeScenario(s.scenario, `series[${s.id}].scenario`),
      role: s.role ?? 'data',
      colorRole: s.colorRole,
      fill: s.fill, format: s.format, unit: s.unit,
      ...(s.direction ? { direction: s.direction } : {}),
      slot: 0,
      cells,
    };
  });
  const dataSeries = normSeries.filter((s) => s.role === 'data');
  const rolePaints = colorRolePaints(dataSeries, false);
  if (normSeries.length > dataSeries.length) {
    warnings.push({
      code: 'reference-ignored',
      severity: 'info',
      message: 'dot charts ignore reference-role series — use variant "dumbbell" to compare two levels',
      suggest: "variant: 'dumbbell'",
    });
  }
  if (dataSeries.length === 0) {
    throw new NormalizeError('no-data-series', 'series', 'dot requires at least one data-role series');
  }
  // Exhibit-wide format raster — dot shares the column/bar
  // family rule: style from the example, one precision from the plotted
  // values, range bounds included.
  const valueSpec = seriesRasterFormatter(options.format, normSeries.flatMap((s) =>
      s.cells.flatMap((cell) => [cell.v, cell.range?.low, cell.range?.high, cell.range?.mid]),
    ), options.locale?.language, options.unit, options.target);
  const fmt = valueSpec.fmt;
  const percent = options.unit === '%' || percentLevels(dataSeries.map(series => ({ vals: series.cells })));
  const percentAxis = percentCellsOnly(dataSeries.map((series) => ({ vals: series.cells.map((cell) => ({ ...cell, format: cell.meta?.format })), format: series.format })));
  const referenceFmt = percent && !options.format
    ? (v: number) => formatAutomaticNumber(v, { locale: options.locale?.language, decimals: Math.max(autoDecimals(v), neededDecimals(v)), suffix: '%' }) : fmt;
  // A mean is a derived statistic: it lifts past the raster instead of rounding to another number (column twin).
  const meanFmt = percent && !options.format ? referenceFmt : (v: number) => formatStatWithSpec(v, valueSpec.spec);
  if (variant === 'dumbbell' && dataSeries.length !== 2) {
    throw new NormalizeError(
      'dumbbell-two-series',
      'series',
      `dumbbell requires exactly 2 data series, got ${dataSeries.length}`,
    );
  }
  if (variant === 'lollipop' && dataSeries.length !== 1) {
    throw new NormalizeError(
      'lollipop-one-series',
      'series',
      `lollipop requires exactly 1 data series, got ${dataSeries.length}`,
    );
  }
  dataSeries.forEach((s, i) => (s.slot = i));

  let cats: NormCat[] = rawCats.map((c) => ({
    id: c.id,
    label: c.label ?? c.id,
    ...(c.date === undefined ? {} : { date: c.date }),
    ...(c.footnote === undefined ? {} : { footnote: c.footnote }),
  }));
  // The bar rule (bar/layout.ts restRecedes): one series, a category highlight, the rest recede.
  const restRecedes = dataSeries.length === 1 && cats.some((cat, ci) => highlights.has(cat.id) && dataSeries[0]!.cells[ci]!.v !== null);
  const receding = recedingSeriesId(dataSeries, highlights);
  const applyOrder = (order: number[]) => {
    cats = order.map((i) => cats[i]!);
    for (const s of normSeries) s.cells = order.map((i) => s.cells[i]!);
  };

  // ---- sort: by first series value; dumbbell sorts by gap (b − a) ----
  const sortKey = (ci: number): number =>
    variant === 'dumbbell'
      ? (dataSeries[1]!.cells[ci]!.v ?? 0) - (dataSeries[0]!.cells[ci]!.v ?? 0)
      : (dataSeries[0]!.cells[ci]!.v ?? 0);
  const catSort = options.sort?.categories ?? 'sheet';
  if (catSort !== 'sheet') {
    const idx = cats.map((_, i) => i);
    const key = cats.map((_, i) => sortKey(i));
    if (catSort === 'asc') idx.sort((a, b) => key[a]! - key[b]! || a - b);
    else if (catSort === 'desc') idx.sort((a, b) => key[b]! - key[a]! || a - b);
    else idx.reverse();
    applyOrder(idx);
  }

  // ---- derive: dumbbell gaps ----
  let gaps: Record<Id, number> | undefined;
  if (variant === 'dumbbell') {
    gaps = emptyIdRecord();
    cats.forEach((c, ci) => {
      const a = dataSeries[0]!.cells[ci]!.v;
      const b = dataSeries[1]!.cells[ci]!.v;
      if (a !== null && b !== null) gaps![c.id] = cleanDiff(b, a);
    });
  }

  // ---- annotations: local vertical valueLines; the rest go to the pass ----
  const annotationsAll: Annotation[] = (options.annotations ?? []).map((a, n) => ({
    ...a,
    id: a.id ?? `${a.kind}-${n + 1}`,
  }));
  // The average marker, as on bar and column: the mean of every dot of the
  // series in its scope, a dashed rule labelled Ø.
  const markerScope = averageMarkerScope(options.averageMarker);
  const averageWord = options.strings?.average ?? localeStrings(options.locale?.language).average;
  const averageIds = new Set<Id>();
  /** Marks the key explains, read from the data before the frame is laid out. */
  const directionsDrawn = new Set<'rose' | 'fell'>();
  if (variant === 'dumbbell' && options.arrow === true && dataSeries[1]?.direction) {
    dataSeries[0]!.cells.forEach((cell, ci) => {
      const b = dataSeries[1]!.cells[ci]?.v ?? null;
      if (cell.v !== null && b !== null && b !== cell.v) directionsDrawn.add(b > cell.v ? 'rose' : 'fell');
    });
  }
  const rangesDrawn = dataSeries.some((s) => s.cells.some((cell) => cell.v !== null && cell.range !== undefined));
  // A supplied mid-point draws as an open marker on its rail, keyed, and a
  // note names the rows whose range has none.
  const rangeOptions = options.range as (DotOptions['range'] & { midLabel?: string }) | undefined;
  const midName = rangeOptions?.midLabel ?? chartString(options, 'midName');
  const midsDrawn = dataSeries.some((s) => s.cells.some((cell) => cell.v !== null && cell.range?.mid !== undefined));
  const rowsWithoutMid = midsDrawn
    ? cats.filter((_, ci) => dataSeries.some((s) => s.cells[ci]!.v !== null && s.cells[ci]!.range !== undefined && s.cells[ci]!.range!.mid === undefined))
    : [];
  const midNote = rowsWithoutMid.length === 0 ? undefined
    : rowsWithoutMid.length > MID_NOTE_NAMES ? chartString(options, 'midMissingCount', { v1: midName, v2: rowsWithoutMid.length })
    : chartString(options, 'midMissing', {
      v1: midName,
      v2: rowsWithoutMid.map((c) => c.label).reduce((text, name, i, all) => (i === 0 ? name : `${text}${i === all.length - 1 ? ` ${chartString(options, 'and')} ` : ', '}${name}`), ''),
    });
  if (markerScope !== undefined) {
    const inScope = dataSeries.filter((s) => markerScope === 'all' || markerScope.includes(s.id))
      .flatMap((s) => s.cells.flatMap((cell) => (cell.v === null ? [] : [cell.v])));
    if (inScope.length === 0) {
      warnings.push({ code: 'average-marker-empty', severity: 'warn', message: 'averageMarker scope has no plotted values; marker omitted' });
    } else {
      const mean = inScope.reduce((sum, v) => sum + v, 0) / inScope.length;
      // The marker reads "Average 8.1", not an unexplained "Ø". It
      // takes the plotted values' decimals, as the other value lines do.
      const marker = averageMarkerLine(annotationsAll, mean, meanFmt, undefined, averageWord);
      averageIds.add(marker.id!);
      annotationsAll.push(marker);
    }
  }
  const localAnns = annotationsAll.filter((a) => a.kind === 'valueLine');
  const passAnns = annotationsAll.filter((a) => a.kind !== 'valueLine');
  const allDotValues: number[] = [];
  for (const s of dataSeries) for (const c of s.cells) if (c.v !== null) allDotValues.push(c.v);
  const allRangeValues = dataSeries.flatMap((series) =>
    series.cells.flatMap((cell) => (cell.range ? [cell.range.low, cell.range.high] : [])),
  );
  // TWIN of column's `meanValue` (column/layout.ts). NOT defaulted to 0: with
  // no plotted value there is no mean, and a valueLine drawn at 0 would state a
  // number the data does not support (the shared annotate pass fails this
  // closed with 'no-mean'; the local dot path below mirrors it).
  const meanValue =
    allDotValues.length > 0
      ? allDotValues.reduce((a, b) => a + b, 0) / allDotValues.length
      : undefined;
  const valueLineValue = (a: Annotation & { kind: 'valueLine' }): number | undefined =>
    a.value === undefined || a.value === 'mean' ? meanValue : a.value;

  // ---- raw value extent ----
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of [...allDotValues, ...allRangeValues]) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (variant === 'lollipop' || options.valueAxis?.includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  for (const a of localAnns) {
    if (a.kind !== 'valueLine') continue;
    const v = valueLineValue(a);
    if (v === undefined) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  // user min/max may never clip data
  [lo, hi] = applyAxisBounds([lo, hi], [lo, hi], options.valueAxis, warnings);

  // ---- fonts ----
  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };

  // ---- label texts + which side each dot labels (measured BEFORE the scale) ----
  const textFor = (v: number, cell: { meta: CellMeta | null; isPct?: boolean }, s?: NormSeries): string | null => {
    const { meta } = cell;
    if (meta?.label === false) return null;
    const base = displayFor(v, cell, s);
    return typeof meta?.label === 'string' ? meta.label.replace(/\$\{value\}/g, base) : base;
  };
  // The dots of a row compare across series ("40 unchanged", "48 to 45"): every series keeps the shared precision,
  // and a series format or unit still applies (forSeries on its format and unit alone).
  const seriesKeys = new Map<NormSeries, { format?: string; unit?: string }>();
  const seriesKey = (s: NormSeries) => seriesKeys.get(s) ?? seriesKeys.set(s, { format: s.format, unit: s.unit }).get(s)!;
  // A percent cell keeps its '%', as on column.
  const displayFor = (v: number, cell: { meta: CellMeta | null; isPct?: boolean }, s?: NormSeries): string =>
    cell.meta?.format ? formatterFromExample(cell.meta.format, options.locale?.language)(v)
      : (cell.isPct && !s?.format ? valueSpec.fmtPercent : s ? valueSpec.forSeries(seriesKey(s)) : fmt)(v);
  /** Primary label side for a dot ('right' unless dumbbell-min / negative lollipop). */
  const primarySide = (si: number, ci: number, v: number): 'left' | 'right' => {
    // A row of two dots labels its left dot left and its right dot
    // right, so a close pair such as 48 and 49 never shares a side.
    if (variant === 'dumbbell' || dataSeries.length === 2) {
      const other = dataSeries[1 - si]!.cells[ci]!.v;
      if (other === null) return 'right';
      // left dot labels left, right dot labels right; ties: first series left
      if (v < other) return 'left';
      if (v > other) return 'right';
      return si === 0 ? 'left' : 'right';
    }
    if (variant === 'lollipop') return v < 0 ? 'left' : 'right';
    return 'right';
  };
  let maxRightW = 0;
  let maxLeftW = 0;
  /**
   * A dot on a range is the own value against a benchmark, and a dumbbell's
   * lead dot is the actual or later value: their labels are bold, while the bounds
   * and the earlier value recede.
   */
  const leadIndex = dataSeries.findIndex((series) => series.scenario === 'AC');
  const referenceIndex = dataSeries.findIndex((series) => series.scenario === 'PY' || series.scenario === 'PL' || series.scenario === 'FC');
  /** The dumbbell's lead end: its actuals, else the end that is not a prior year, plan or forecast, else the later (second) series. */
  const leadSi = leadIndex >= 0 ? leadIndex : referenceIndex >= 0 ? 1 - referenceIndex : 1;
  const pointFont = (cell: { range?: DataRange }, si: number): FontSpec => (cell.range || (variant === 'dumbbell' && si === leadSi) ? strongFont : labelFont);
  const boldLabelIds = new Set<Id>();
  const mutedLabelIds = new Set<Id>();
  if (labelOn('point')) {
    cats.forEach((_, ci) => {
      dataSeries.forEach((s, si) => {
        const cell = s.cells[ci]!;
        if (cell.v === null) return;
        // A dot inside its range labels above it, inside the rail's span; the bounds reserve the edges.
        if (cell.range && cell.v >= cell.range.low && cell.v <= cell.range.high) return;
        const text = textFor(cell.v, cell, s);
        if (!text) return;
        const w = measure(text, pointFont(cell, si)).width;
        if (primarySide(si, ci, cell.v) === 'right') maxRightW = Math.max(maxRightW, w);
        else maxLeftW = Math.max(maxLeftW, w);
      });
      // Merged labels use the same candidate slots; reserving them would crowd separate dot values.
    });
  }

  const baseIdentities = dataSeries.map(s => {
    const { paint, hollow } = rawDotPaint(s, '', null);
    return { id: s.id, label: s.label, paint, key: 'marker' as const, ...(hollow ? { hollow: true } : {}) };
  });
  const identities = new Map(distinguishSeries(baseIdentities,
    new Set(dataSeries.filter(s => s.fill || s.colorRole || highlights.has(s.id)).map(s => s.id)),
    [{ token: 'neutralMark' }, ...dataSeries.map((_, i) => themeSeriesPaint(i, paletteRamp ? options.palette : undefined))],
    theme).map(item => [item.id, item]));

  // ---- frame (title/subtitle/legend/source measured FIRST) ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const legendInput = buildLegend();
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      // The mid-point marker's method note prints on request; the note
      // on rows without a mid-point prints whenever some rows have one.
      footnotes: [
        ...authoredNotes(options),
        ...(midNote ? [disclosureNote(midNote)] : []),
        ...(options.methodNote === true && midsDrawn ? [disclosureNote(chartString(options, 'rangeMidNote'))] : []),
      ],
      legend: legendInput,
      theme,
      measure,
    },
    occupied,
  );
  const plot0 = frameResult.plot;

  // ---- plot rect: top annotation strip, left category band, bottom value axis ----
  // Position encoding needs a scale — the value axis is shown by default here.
  // A lollipop whose every dot prints its value needs no value axis: the
  // stems start at the zero baseline. A dropped value brings the axis back (below), and an authored show stands.
  const autoAxis = variant === 'lollipop' && options.valueAxis?.show === undefined && labelOn('point')
    && dataSeries.every((s) => s.cells.every((cell) => cell.v === null || textFor(cell.v, cell, s) !== null));
  const axisShown = autoAxis ? false : options.valueAxis?.show !== false;
  const axisTitle = axisShown && labelOn('axisTitle')
    ? planValueAxisTitle(options.axisTitles?.primary, theme, measure, plot0.w)
    : undefined;
  const annPad = localAnns.length > 0 ? 26 : 8;
  const axisH = axisShown ? measure('0', tickFont).height + 8 + (axisTitle ? axisTitle.height + 2 : 0) : 0;
  fixedPlotChrome(frameResult, annPad + axisH);
  const availH = plotHeightAfter(frameResult, size.height, plot0.h - annPad - axisH);
  const lineH = tickFont.size * 1.2;
  const stepEst = availH / cats.length;
  // A chart that takes its height wraps a category name to the lines it needs
  // and its rows grow; a pinned height cuts with an
  // ellipsis, the full name in the label's title.
  const openHeight = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false;
  // On a card the names sit as headers above
  // their pairs, so the pairs take the full width; a row too short for a
  // header and a pair keeps the side column, as does an authored rowLabels.
  // An automatic height takes the header rows' own pitch (below), so it does not need a tall row first.
  const rowHeaders = variant === 'dumbbell' && labelOn('category') && options.rowLabels === undefined
    && size.width <= HEADER_ROWS_MAX_WIDTH && (openHeight || stepEst >= 2 * lineH + 8);
  const headerH = rowHeaders ? lineH + 3 : 0;
  const air = (options as { [HARD_MINIMUM]?: boolean })[HARD_MINIMUM] === true ? 1 : 4;
  const catMaxLines = rowHeaders ? 1 : openHeight ? Infinity : stepEst >= 2 * lineH + 4 ? 2 : 1;
  const capW = rowHeaders ? plot0.w : Math.max(24, plot0.w * 0.28);
  const { labels: catLines, width: catColumnW } = rowLabelBand(cats, tickFont, capW, catMaxLines, lineH, measure, {
    wider: gutterBudget(24, plot0.w), ...(rowHeaders ? {} : { tightLines: Math.floor((stepEst - air) / lineH) }),
    target: options.target, textScale: textScaleOf(options), typeRole: 'axis',
    shrink: stepDownFont(theme, tickFont, 'axis', options.target, textScaleOf(options)),
    footnoteRefs: { count: authoredFootnoteCount(options), warnings },
  });
  // each category keeps one measured value row before automatic sizing.
  // Refuse-less: at the hard minimum (the last fixed-slot step) a row keeps 1 px of air, not 4.
  const rowHeight = rowHeaders ? measure('0', labelFont).height + headerH + air : Math.max(measure('0', labelFont).height, maxOf(catLines.map(label => label.h))) + air;
  frameResult.frame.plotMinHeight = Math.max(frameResult.frame.plotMinHeight ?? 0,
    size.height + (frameResult.deficit ?? 0) + cats.length * rowHeight - (plot0.h - annPad - axisH));
  const catBandW = rowHeaders ? 0 : catColumnW;
  const catGap = rowHeaders ? 0 : CAT_BAND_GAP;
  const valueBody: Rect = {
    x: plot0.x + catBandW + catGap,
    y: plot0.y + annPad,
    w: Math.max(10, plot0.w - catBandW - catGap),
    h: availH,
  };

  // ---- band + dot radius (band is independent of the value scale) ----
  const bandFraction = options.bandFraction ?? 0.7;
  const band = bandScale(cats.length, [valueBody.y, valueBody.y + valueBody.h], {
    paddingInner: 1 - bandFraction,
    paddingOuter: (1 - bandFraction) / 2,
  });
  const r = clamp(band.step * 0.22, 2.5, dotRadiusCap(variant, size.width));
  /** The mid-point marker: smaller than the dot, so the dot stays the lead mark. */
  const midR = Math.max(2.5, r * 0.65);

  // ---- value scale: label headroom is pixel space, never invented data ----
  // Printed bounds sit outside their caps, so the outer ones get room on the
  // row baseline.
  let boundLeftW = 0;
  let boundRightW = 0;
  if (options.range?.values === true) {
    for (const s of dataSeries) for (const cell of s.cells) {
      if (cell.v === null || !cell.range || cell.range.low === cell.range.high) continue;
      boundLeftW = Math.max(boundLeftW, measure(fmt(cell.range.low), labelFont).width);
      boundRightW = Math.max(boundRightW, measure(fmt(cell.range.high), labelFont).width);
    }
  }
  // A dot on the domain end keeps its whole circle inside the value body.
  const leftReserve = Math.max(r + 2, maxLeftW > 0 ? maxLeftW + LABEL_GAP + r + 8 : 0, boundLeftW > 0 ? boundLeftW + LABEL_GAP + 2 : 0);
  const rightReserve = Math.max(r + 2, maxRightW > 0 ? maxRightW + LABEL_GAP + r + 8 : 0, boundRightW > 0 ? boundRightW + LABEL_GAP + 2 : 0);
  const plot: Rect = {
    x: valueBody.x + leftReserve,
    y: valueBody.y,
    w: Math.max(10, valueBody.w - leftReserve - rightReserve),
    h: valueBody.h,
  };
  // Position encoding: the intent IS the raw extent (labels live in the pixel
  // reserves above), so the bound trims pure snap overshoot on both edges.
  // The domain ends at the data, not at the next nice tick, and the ticks
  // stay inside it.
  let [dLo, dHi] = lo === hi ? niceDomain(lo, hi, 5, { dataExtent: [lo, hi], maxWasteFraction: 0.15 }) : [lo, hi];
  const extentValues = [
    ...allDotValues,
    ...allRangeValues,
    ...localAnns.flatMap((ann) => {
      const v = valueLineValue(ann);
      return v === undefined ? [] : [v];
    }),
    ...(options.valueAxis?.min !== undefined ? [options.valueAxis.min] : []),
    ...(options.valueAxis?.max !== undefined ? [options.valueAxis.max] : []),
  ];
  if (extentValues.length > 0 && extentValues.every((value) => value >= 0)) dLo = Math.max(0, dLo);
  if (extentValues.length > 0 && extentValues.every((value) => value <= 0)) dHi = Math.min(0, dHi);
  if (dLo > 0) {
    warnings.push({
      code: 'nonzero-baseline',
      severity: 'info',
      message: `value scale starts at ${dLo}, not zero — legitimate for position encoding (dot chart)`,
    });
  }
  const x = linearScale([dLo, dHi], [plot.x, plot.x + plot.w]);

  // ---- assemble scene ----
  const nodes: SceneNode[] = [...frameResult.nodes];
  const marks: DotMarks = { rows: [] };
  const rangeMarks: RangeMark[] = [];
  // The title wraps to the first plot width; one wider than the space left of the axis end starts at that plot's left edge, so it stays on the canvas.
  const labelRequests: LabelRequest[] = axisTitle
    ? [valueAxisTitleRequest(axisTitle, { x: Math.max(plot.x + plot.w, plot0.x + axisTitle.width), y: plot.y + plot.h + 6 + measure('0', tickFont).height + 2 }, 'end', 'axis:x:title')]
    : [];
  // Point seats are built once every dot, connector and reference line has
  // claimed, so the seat past a blocker sees all of them.
  const pointSeats: (() => void)[] = [];
  /** A dumbbell value's seat on its own side of its own dot. */
  const ownSideSeats = new Map<Id, SlotCandidate>();
  const placedAnnotations: PlacedAnnotation[] = [];

  // row tints behind everything (multi-series category highlight only) — decorative, not claimed
  cats.forEach((cat, ci) => {
    if (!highlights.has(cat.id) || restRecedes) return;
    const gapHalf = (band.step - band.bandwidth) / 2;
    nodes.push({
      t: 'rect',
      id: `rowTint:${cat.id}`,
      rect: {
        x: valueBody.x,
        y: Math.max(valueBody.y, band.position(ci) - gapHalf),
        w: valueBody.w,
        h: Math.min(band.step, valueBody.y + valueBody.h - (band.position(ci) - gapHalf)),
      },
      fill: { token: 'others' },
      owner: { categoryId: cat.id },
      part: 'rowTint',
    });
  });

  // value axis (bottom) — claims tick labels so nothing collides with them
  const axes: Geometry['axes'] = [];
  const axisAt = nodes.length;
  let valueAxis: Geometry['axes'][number] | undefined;
  // Light gridlines carry the position scale on a dot or dumbbell; a lollipop
  // reads its stems from the baseline.
  const gridOn = options.valueAxis?.gridlines ?? variant !== 'lollipop';
  if (axisShown) {
    const axisResult = layoutValueAxis(
      {
        scale: x,
        plot,
        orient: 'x',
        gridlines: gridOn,
        ...(percentAxis ? { format: valueSpec.fmtPercent, formatSpec: valueSpec.percentSpec } : { format: fmt, formatSpec: valueSpec.spec }),
        theme,
        measure,
        canvasWidth: size.width,
      },
      occupied,
    );
    nodes.push(...axisResult.nodes);
    axes.push(axisResult.axis);
    valueAxis = axisResult.axis;
  }

  // The solid baseline marks zero only: a scale that starts above or ends
  // below zero draws none, so its first tick never reads as zero.
  const baselineId = dLo <= 0 && dHi >= 0 ? 'axis:baseline' : undefined;
  if (baselineId) {
    const baselineX = x(0);
    nodes.push({
      t: 'line',
      id: baselineId,
      x1: baselineX,
      y1: plot.y,
      x2: baselineX,
      y2: plot.y + plot.h,
      stroke: { token: 'axis' },
      width: strokeToken(theme, 'rule'),
      owner: {},
      part: 'baseline',
    });
    occupied.claim({ x: baselineX - 1, y: plot.y, w: 2, h: plot.h }, 'axis', {});
  }

  // anchors for the annotation resolver: {categoryId, seriesId?} → dot center
  const anchorByDot = new Map<string, AnchorResolution>();

  const keyValues = cats.map((_, ci) => sortKey(ci));
  const maxKey = maxOf(keyValues);
  const minKey = minOf(keyValues);
  const bonus = (catId: Id, seriesId?: Id) =>
    highlights.has(catId) || (seriesId !== undefined && highlights.has(seriesId))
      ? PRIORITY.highlightBonus
      : 0;
  const rowBasePriority = (ci: number, v: number) =>
    ci === 0 || ci === cats.length - 1
      ? PRIORITY.endpoint
      : keyValues[ci] === maxKey || keyValues[ci] === minKey
        ? PRIORITY.extreme
        : PRIORITY.interior + Math.min(99, Math.abs(v));

  // ---- marks + label requests ----
  cats.forEach((cat, ci) => {
    const cy = band.position(ci) + band.bandwidth / 2 + headerH / 2;
    const row: DotMarks['rows'][number] = { categoryId: cat.id, dots: [] };
    const rowSceneStart = nodes.length;

    // dumbbell connector first (z-order: under the dots)
    if (variant === 'dumbbell') {
      const a = dataSeries[0]!.cells[ci]!.v;
      const b = dataSeries[1]!.cells[ci]!.v;
      if (a !== null && b !== null) {
        const xa = x(a);
        const xb = x(b);
        const nodeId = `connector:${cat.id}`;
        // The arrow points into the second dot; a pair too close for a
        // head keeps the plain connector. Its paint is the change's sign read
        // against the second series' declared direction.
        const head = options.arrow === true && Math.abs(xb - xa) >= 2 * r + 6;
        const toward = Math.sign(xb - xa);
        const declared = dataSeries[1]!.direction;
        const stroke: Paint = options.arrow && declared && b !== a
          ? { token: (b > a) === (declared === 'higherIsBetter') ? 'good' : 'bad' }
          : CONNECTOR_PAINT;
        const tip = xb - toward * (r + 1);
        const arrowWidth = strokeToken(theme, 'data');
        nodes.push({
          t: 'line',
          id: nodeId,
          x1: xa,
          y1: cy,
          x2: head ? tip - toward * arrowShaftEnd(ARROW_HEAD, arrowWidth) : xb,
          y2: cy,
          stroke,
          // The connector carries the gap: the focus width.
          width: options.arrow ? arrowWidth : strokeToken(theme, 'focus'),
          owner: { categoryId: cat.id },
          part: 'connector',
        });
        if (head) {
          nodes.push({
            t: 'path',
            id: `${nodeId}:head`,
            d: arrowHeadPath({ x: tip, y: cy }, toward > 0 ? 0 : Math.PI, ARROW_HEAD),
            fill: stroke,
            owner: { categoryId: cat.id },
            part: 'arrowHead',
          });
        }
        // Claimed under a synthetic seriesId so value labels (owned by the
        // real series) treat the connector as FOREIGN and never sit on it —
        // keeps the solver's own-mark exception and invariant I1 consistent.
        occupied.claim(
          { x: Math.min(xa, xb), y: cy - 1.5, w: Math.max(Math.abs(xb - xa), 0.5), h: 3 },
          'mark',
          { seriesId: '__connector', categoryId: cat.id },
        );
        row.connectorNodeId = nodeId;
      }
    }

    // Merged dumbbell label: when the two dots nearly touch
    // (|x(a) − x(b)| < dot diameter + 2px), two separate value labels would
    // read as one blob — suppress them and emit a single combined
    // «a → b» label, placed left of the left dot (same slot vocabulary as
    // dotCandidates, applied to the pair), at the higher original priority.
    let mergedLabel = false;
    if (variant === 'dumbbell' && labelOn('point')) {
      const sa = dataSeries[0]!;
      const sb = dataSeries[1]!;
      const ca = sa.cells[ci]!;
      const cb = sb.cells[ci]!;
      if (ca.v !== null && cb.v !== null && Math.abs(x(ca.v) - x(cb.v)) < 2 * r + 2) {
        const ta = textFor(ca.v, ca, sa);
        const tb = textFor(cb.v, cb, sb);
        // Two values label the outer ends of their pair, as every other row
        // does; only an unchanged pair prints one label.
        if (ta && tb && ta === tb) {
          mergedLabel = true;
          const text = pairText(ta, tb, options);
          const tsize = measure(text, labelFont);
          const leftX = Math.min(x(ca.v), x(cb.v));
          const rightX = Math.max(x(ca.v), x(cb.v));
          const midX = (leftX + rightX) / 2;
          const ty = cy - tsize.height / 2;
          labelRequests.push({
            id: `point:${cat.id}`,
            kind: 'point',
            role: composedTextRole(text),
            owner: { categoryId: cat.id },
            text,
            lines: [text],
            typeRole: 'label', font: labelFont,
            priority: Math.max(
              ca.meta?.priority ?? rowBasePriority(ci, ca.v) + bonus(cat.id, sa.id),
              cb.meta?.priority ?? rowBasePriority(ci, cb.v) + bonus(cat.id, sb.id),
            ),
            candidates: insidePlotFirst([
              {
                slot: 'left',
                rect: { x: leftX - r - LABEL_GAP - tsize.width, y: ty, w: tsize.width, h: tsize.height },
                penalty: 0,
              },
              {
                slot: 'right',
                rect: { x: rightX + r + LABEL_GAP, y: ty, w: tsize.width, h: tsize.height },
                penalty: 1,
              },
              {
                slot: 'above',
                rect: { x: midX - tsize.width / 2, y: cy - r - 3 - tsize.height, w: tsize.width, h: tsize.height },
                penalty: 2,
              },
              {
                slot: 'below',
                rect: { x: midX - tsize.width / 2, y: cy + r + 3, w: tsize.width, h: tsize.height },
                penalty: 3,
              },
            ]),
          });
        }
      }
    }

    dataSeries.forEach((s, si) => {
      const cell = s.cells[ci]!;
      const v = cell.v;
      if (v === null) return;
      const cx = x(v);
      const owner: OwnerRef = { seriesId: s.id, categoryId: cat.id };

      if (cell.range) {
        const lowX = x(cell.range.low);
        const highX = x(cell.range.high);
        const capHalf =
          cell.range.low === cell.range.high
            ? Math.max(r + 3, Math.min(8, band.bandwidth * 0.3))
            : Math.max(2.5, Math.min(5, band.bandwidth * 0.22));
        const railId = `range:${s.id}:${cat.id}:rail`;
        const lowId = `range:${s.id}:${cat.id}:low`;
        const highId = `range:${s.id}:${cat.id}:high`;
        const nodeIds = [railId, lowId, highId];
        nodes.push(
          {
            t: 'line',
            id: railId,
            x1: lowX,
            y1: cy,
            x2: highX,
            y2: cy,
            stroke: RAIL_PAINT,
            width: strokeToken(theme, 'focus'),
            owner,
            part: 'rangeRail',
          },
          {
            t: 'line',
            id: lowId,
            x1: lowX,
            y1: cy - capHalf,
            x2: lowX,
            y2: cy + capHalf,
            stroke: CAP_PAINT,
            width: strokeToken(theme, 'mark'),
            owner,
            part: 'rangeCap',
            display: { value: fmt(cell.range.low) },
          },
          {
            t: 'line',
            id: highId,
            x1: highX,
            y1: cy - capHalf,
            x2: highX,
            y2: cy + capHalf,
            stroke: CAP_PAINT,
            width: strokeToken(theme, 'mark'),
            owner,
            part: 'rangeCap',
            display: { value: fmt(cell.range.high) },
          },
        );
        // The mid-point: an open marker on the rail, under the dot, keyed.
        if (cell.range.mid !== undefined) {
          const midId = `range:${s.id}:${cat.id}:mid`;
          nodes.push({
            t: 'circle',
            id: midId,
            cx: x(cell.range.mid),
            cy,
            r: midR,
            fill: { token: 'background' },
            stroke: { token: 'inkMuted' },
            strokeWidth: strokeToken(theme, 'mark'),
            owner,
            part: 'rangeMid',
            display: { value: fmt(cell.range.mid) },
          });
          nodeIds.push(midId);
        }
        occupied.claim(
          {
            x: Math.min(lowX, highX) - 1,
            y: cy - capHalf - 1,
            w: Math.max(Math.abs(highX - lowX) + 2, 2),
            h: capHalf * 2 + 2,
          },
          'mark',
          { seriesId: `__range:${s.id}`, categoryId: cat.id },
          'range',
        );
        // The bounds as numbers, beside the caps, when asked for.
        if (options.range?.values === true && cell.range.low !== cell.range.high) {
          for (const [end, capX, value] of [['low', Math.min(lowX, highX), cell.range.low], ['high', Math.max(lowX, highX), cell.range.high]] as const) {
            const text = fmt(value);
            const size = measure(text, labelFont);
            const side = (dx: number) => ({ x: dx, y: cy - size.height / 2, w: size.width, h: size.height });
            labelRequests.push({
              id: `rangeValue:${s.id}:${cat.id}:${end}`, kind: 'point', role: composedTextRole(text), owner: { categoryId: cat.id, seriesId: `__range:${s.id}` },
              text, lines: [text], typeRole: 'label', font: labelFont, priority: PRIORITY.interior,
              candidates: [
                { slot: end === 'low' ? 'leftOfCap' : 'rightOfCap', rect: side(end === 'low' ? capX - LABEL_GAP - size.width : capX + LABEL_GAP), penalty: 0 },
                // Inside the range under or over the rail, where a bound on the plot edge still fits.
                { slot: 'belowCap', rect: { x: end === 'low' ? capX + 4 : capX - 4 - size.width, y: cy + capHalf + 2, w: size.width, h: size.height }, penalty: 1 },
                { slot: 'aboveCap', rect: { x: end === 'low' ? capX + 4 : capX - 4 - size.width, y: cy - capHalf - 2 - size.height, w: size.width, h: size.height }, penalty: 2 },
              ],
            });
          }
        }
        rangeMarks.push({
          seriesId: s.id,
          categoryId: cat.id,
          low: cell.range.low,
          high: cell.range.high,
          ...(cell.range.mid === undefined ? {} : { mid: cell.range.mid }),
          nodeIds,
        });
      }

      // lollipop stem from the zero baseline to the value
      if (variant === 'lollipop') {
        const x0 = x(0);
        const stemId = `stem:${cat.id}`;
        nodes.push({
          t: 'line',
          id: stemId,
          x1: x0,
          y1: cy,
          x2: cx,
          y2: cy,
          stroke: dotPaint(s, cat.id, cell.meta).paint,
          // The stem is the bar of the lollipop: the data width.
          width: strokeToken(theme, 'data'),
          owner,
          part: 'stem',
        });
        occupied.claim(
          { x: Math.min(x0, cx), y: cy - 1, w: Math.max(Math.abs(cx - x0), 0.5), h: 2 },
          'mark',
          // The stem is no own mark of its value label: a seat over it is blocked, not free.
          { pointId: stemId },
        );
        row.stemNodeId = stemId;
      }

      const { paint, hollow } = dotPaint(s, cat.id, cell.meta);
      const nodeId = `dot:${s.id}:${cat.id}`;
      nodes.push({
        t: 'circle',
        id: nodeId,
        cx,
        cy,
        r,
        // PL (plan) etc. render hollow: background fill + series-colored ring
        fill: hollow ? { token: 'background' } : paint,
        // A dot on a range keeps a page-coloured ring, apart from a mid-point marker under it.
        stroke: hollow ? paint : cell.range ? { token: 'background' } : undefined,
        strokeWidth: hollow ? strokeToken(theme, 'mark') : strokeToken(theme, 'rule'),
        owner,
        part: 'dot',
        display: { value: displayFor(v, cell, s) },
      });
      occupied.claim({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, 'mark', owner);
      row.dots.push({ seriesId: s.id, cx, cy, nodeId });
      anchorByDot.set(`${cat.id}:${s.id}`, {
        x: cx,
        y: cy,
        value: v,
        format: s.format,
        label: cat.label ?? cat.id,
        ...(cat.date === undefined ? {} : { date: cat.date }),
        owner,
      });

      if (labelOn('point') && !mergedLabel) {
        const text = textFor(v, cell, s);
        if (text) {
          const font = pointFont(cell, si);
          if (font === strongFont) boldLabelIds.add(`point:${s.id}:${cat.id}`);
          else if (variant === 'dumbbell') mutedLabelIds.add(`point:${s.id}:${cat.id}`);
          const tsize = measure(text, font);
          const primary = primarySide(si, ci, v);
          const request: LabelRequest = {
            id: `point:${s.id}:${cat.id}`,
            kind: 'point',
            owner,
            text,
            lines: [text],
            typeRole: 'label', font,
            priority: cell.meta?.priority ?? rowBasePriority(ci, v) + bonus(cat.id, s.id),
            candidates: [],
          };
          labelRequests.push(request);
          pointSeats.push(() => {
            request.candidates = dotCandidates(cx, cy, tsize, primary, owner);
            if (variant === 'dumbbell') ownSideSeats.set(request.id, request.candidates[0]!);
          });
        }
      }
    });
    const rowNodes = nodes.splice(rowSceneStart);
    const rangeNodes = rowNodes.filter(
      (node) =>
        node.part === 'rangeRail' || node.part === 'rangeCap' || node.part === 'rangeMid',
    );
    const foregroundNodes = rowNodes.filter(
      (node) =>
        node.part !== 'rangeRail' && node.part !== 'rangeCap' && node.part !== 'rangeMid',
    );
    pushAll(nodes, rangeNodes);
    pushAll(nodes, foregroundNodes);

    marks.rows.push(row);

    // ---- category label (left band, right-aligned toward the rows) ----
    if (labelOn('category')) {
      const cl = catLines[ci]!;
      labelRequests.push({
        id: `category:${cat.id}`,
        kind: 'category',
        owner: { categoryId: cat.id },
        text: cat.label,
        ...fittedLabel(cl, tickFont),
        typeRole: 'axis', font: tickFont,
        priority: PRIORITY.endpoint + bonus(cat.id),
        candidates: [
          {
            slot: 'left',
            // A header clears the value labels beside its pair, solver padding included.
            rect: rowHeaders ? { x: plot0.x, y: cy - Math.max(r, measure('0', labelFont).height / 2) - 3 - cl.h, w: cl.w, h: cl.h } : {
              // Names sit right-aligned against the axis by default.
              x: rowLabelX(plot0.x, catBandW, cl.w, options.rowLabels?.align ?? 'right'),
              y: cy - cl.h / 2,
              w: cl.w,
              h: cl.h,
            },
            penalty: 0,
          },
        ],
      });
    }
  });
  if (rangeMarks.length > 0) marks.ranges = rangeMarks;

  // ---- local annotations: vertical valueLine (bar orientation) ----
  const lineXs: number[] = [];
  for (const ann of localAnns) {
    if (ann.kind !== 'valueLine') continue;
    const id = ann.id!;
    const annFmt = ann.format ? formatterFromExample(ann.format, options.locale?.language) : referenceFmt;
    const v = valueLineValue(ann);
    // Same fail-closed trace the shared annotate pass emits (annotate.ts):
    // no plotted value ⇒ no mean ⇒ no line, and the reason is visible.
    if (v === undefined) {
      warnings.push({
        code: 'no-mean',
        severity: 'warn',
        message: `valueLine '${id}': no mean available`,
      });
      continue;
    }
    const vx = x(v);
    const lineId = `ann:${id}:line`;
    nodes.push({
      t: 'line',
      id: lineId,
      x1: vx,
      y1: plot.y,
      x2: vx,
      y2: plot.y + plot.h,
      stroke: { token: 'ink' },
      width: strokeToken(theme, 'rule'),
      dash: dashToken(theme, 'reference'),
      owner: { annotationId: id },
      part: 'valueLine',
    });
    occupied.claim({ x: vx - 0.5, y: plot.y, w: 1, h: plot.h }, 'annotation', { annotationId: id }, 'referenceLine');
    const isMean = ann.value === undefined || ann.value === 'mean';
    // An authored name prints with the line's value ("Median 2024: 22.1"),
    // unless it carries it already; the mean reads "Average".
    const valueText = isMean && !ann.format ? meanFmt(v) : annFmt(v);
    const labelText = ann.label === false ? ''
      : ann.label === undefined ? (isMean ? `${averageWord} ${valueText}` : valueText)
      : averageIds.has(id) ? ann.label : namedLineText(ann.label, valueText, v, id);
    lineXs.push(vx);
    if (labelText) {
      const lines = labelText.split('\n');
      const w = Math.max(...lines.map((l) => measure(l, strongFont).width));
      const h = lines.length * measure('X', strongFont).height;
      labelRequests.push({
        id: `valueLine:${id}`,
        kind: 'valueLine',
        role: composedTextRole(labelText),
        owner: { annotationId: id },
        text: labelText,
        lines,
        typeRole: 'label', font: strongFont,
        priority: ann.priority ?? PRIORITY.valueLine,
        candidates: [
          { slot: 'aboveLine', rect: { x: vx - w / 2, y: plot.y - h - 6, w, h }, penalty: 0 },
          { slot: 'aboveLineLeft', rect: { x: vx - w - 4, y: plot.y - h - 6, w, h }, penalty: 1 },
          { slot: 'aboveLineRight', rect: { x: vx + 4, y: plot.y - h - 6, w, h }, penalty: 2 },
        ],
      });
    }
    placedAnnotations.push({
      id,
      kind: 'valueLine',
      computedText: labelText,
      valueText,
      nodeIds: [lineId],
      labelId: labelText ? `valueLine:${id}` : undefined,
    });
  }

  for (const seat of pointSeats) seat();

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 2,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  applyValueAxisTitleInk(solved.placed);
  if (autoAxis && solved.placed.some((label) => label.kind === 'point' && label.hidden !== undefined && label.hidden !== 'redundant')) {
    return layoutDot(data, { ...options, valueAxis: { ...options.valueAxis, show: true } });
  }
  pushAll(warnings, solved.warnings);
  // A dot chart that drops values turns its gridlines on,
  // so the reader can still read each dot's position. An authored setting stands.
  if (valueAxis && !gridOn && options.valueAxis?.gridlines === undefined
    && solved.placed.some((label) => label.kind === 'point' && label.hidden !== undefined && label.hidden !== 'redundant')) {
    const grid = valueAxis.ticks.flatMap((tick, seq): SceneNode[] => {
      if (tick.at === 0) return [];
      tick.gridNodeId = `axis:x:grid:${seq}`;
      return [{
        t: 'line', id: tick.gridNodeId, x1: tick.pos, y1: plot.y, x2: tick.pos, y2: plot.y + plot.h,
        stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), ...gridDash(theme), owner: {}, part: 'gridline',
      }];
    });
    nodes.splice(axisAt, 0, ...grid);
  }
  for (const label of solved.placed) {
    if (label.kind !== 'point') continue;
    // The bounds recede behind the own value; a value over a gridline reads on a halo.
    if (label.id.startsWith('rangeValue:') || mutedLabelIds.has(label.id)) label.ink = { token: 'inkMuted' };
    if (gridOn && axisShown) label.halo = true;
  }
  // A dumbbell value sits beside its own dot, on the side
  // away from the pair, and on its row. A reference line through that seat
  // runs behind the text, broken by the halo; a value one row away or past
  // the other dot reads as the wrong dot's value.
  if (variant === 'dumbbell') {
    for (const label of solved.placed) {
      const seat = ownSideSeats.get(label.id);
      // A seat on its own side just past a rule (rightPast) stays.
      if (!seat || label.hidden || label.slot === seat.slot || label.slot === `${seat.slot}Past`) continue;
      if (seat.rect.x < 0 || seat.rect.x + seat.rect.w > size.width) continue;
      const blocked = occupied.hitsWhich(seat.rect, solveCtx.labelPad).some((claim) => claim.part !== 'referenceLine'
        && !(claim.kind === 'mark' && isOwnMark(claim.owner, label.owner, 'point', claim.part))
        && !(claim.kind === 'label' && claim.owner.seriesId === label.owner.seriesId && claim.owner.categoryId === label.owner.categoryId));
      if (blocked) continue;
      label.rect = { ...seat.rect };
      label.slot = seat.slot as typeof label.slot;
      delete label.leader;
      label.halo = true;
      occupied.claim(seat.rect, 'label', label.owner);
    }
  }
  /** Label boxes a reference line passes closer than LINE_CLEAR; the line breaks around their rows. */
  const lineGaps: Rect[] = [];
  // A value label a reference line runs through or grazes steps
  // past the line, away from its dot; one that cannot reads on a halo. A
  // dumbbell value stays at its dot on the halo (above).
  for (const label of solved.placed) {
    if (label.hidden || label.kind !== 'point') continue;
    if (variant === 'dumbbell' && ownSideSeats.has(label.id)) {
      if (lineXs.some((lineX) => lineX > label.rect.x - LINE_CLEAR && lineX < label.rect.x + label.rect.w + LINE_CLEAR)) {
        label.halo = true;
        lineGaps.push(label.rect);
      }
      continue;
    }
    const lx = lineXs.find((lineX) => lineX > label.rect.x - LINE_CLEAR && lineX < label.rect.x + label.rect.w + LINE_CLEAR);
    if (lx === undefined) continue;
    const dot = anchorByDot.get(`${label.owner.categoryId}:${label.owner.seriesId}`);
    if (dot && dot.x < lx && label.rect.x > dot.x) label.rect = { ...label.rect, x: lx + LINE_CLEAR };
    else if (dot && dot.x > lx && label.rect.x < dot.x) label.rect = { ...label.rect, x: lx - LINE_CLEAR - label.rect.w };
    else {
      label.halo = true;
      lineGaps.push(label.rect);
    }
  }
  breakLinesAtLabels();

  // ---- annotation pass (callout/note/delta/abs/diff) ----
  const resolve = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    if (norm.seriesId) return anchorByDot.get(`${norm.categoryId}:${norm.seriesId}`) ?? null;
    // no seriesId: dumbbell rows resolve to the second (current) series' dot,
    // dot/lollipop rows to the first — falling back to whichever dot exists.
    const order =
      variant === 'dumbbell' ? [...dataSeries].reverse() : dataSeries;
    for (const s of order) {
      const hit = anchorByDot.get(`${norm.categoryId}:${s.id}`);
      if (hit) return hit;
    }
    return null;
  };
  // An anchor carries the value its dot already prints, so a note
  // does not repeat it and sits beside the dot and its label.
  const withPrinted = (anchor: AnchorResolution | null): AnchorResolution | null => {
    if (!anchor) return null;
    const label = solved.placed.find((placed) => placed.id === `point:${anchor.owner.seriesId}:${anchor.owner.categoryId}` && !placed.hidden);
    if (!label) return anchor;
    const dot = { x: anchor.x - r, y: anchor.y - r, w: 2 * r, h: 2 * r };
    return { ...anchor, printed: { text: label.text, box: unionRect(dot, label.rect) } };
  };
  const annResult = runAnnotatePass({
    target: options.target,
    annotations: passAnns,
    resolve: (ref) => withPrinted(resolve(ref)),
    deltaAcrossRows: true,
    valueAxis: 'horizontal',
    defaultSpan:
      cats.length >= 2 ? { from: cats[0]!.id, to: cats[cats.length - 1]!.id } : undefined,
    occupied,
    plot,
    theme,
    measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    solveCtx,
    meanValue,
  });
  pushAll(warnings, annResult.warnings);

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  pushAll(nodes, annResult.nodes);
  pushAll(
    nodes,
    labelsToNodes(theme, allLabels, (l) =>
      l.kind === 'category'
        ? tickFont
        : l.kind === 'annotation' || l.kind === 'valueLine' || boldLabelIds.has(l.id)
          ? strongFont
          : labelFont,
    ),
  );

  const variantWord =
    variant === 'dumbbell' ? chartString(options, 'dumbbellName') : variant === 'lollipop' ? chartString(options, 'lollipopName') : chartString(options, 'clevelandName');
  const a11yDesc = cats
    .map((c, ci) => {
      const vals = dataSeries
        .map((s) => {
          const v = s.cells[ci]!.v;
          if (v === null) return null;
          const range = s.cells[ci]!.range;
          // Each value reads as its label prints it: cell or series format and an authored label.
          const cell = s.cells[ci]!;
          const text = textFor(v, cell, s) ?? displayFor(v, cell, s);
          const value = dataSeries.length > 1 ? `${s.label} ${text}` : text;
          return range
            ? chartString(options, 'dotRangeDesc', { v1: value, v2: fmt(range.low), v3: fmt(range.high), v4: range.mid === undefined ? '' : chartString(options, 'midpointClause', { v1: fmt(range.mid) }) })
            : value;
        })
        .filter((t): t is string => t !== null)
        .join(', ');
      return `${c.label} ${vals}`;
    })
    .join('; ');

  const geometry: Geometry<DotMarks, DotDerived> & { [CONTENT_PLOT_HEIGHT]?: ContentPlotHeight } = {
    type: 'dot',
    size,
    plot,
    scene: nodes,
    labels: allLabels,
    axes: [
      {
        axis: 'y',
        ...(baselineId ? { baselineNodeId: baselineId } : {}),
        ticks: cats.map((c, i) => ({ at: c.id, pos: band.center(i) + headerH / 2, labelId: `category:${c.id}` })),
      },
      ...axes,
    ],
    annotations: [...placedAnnotations, ...annResult.placed],
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: gaps ? { gaps } : {},
    a11y: {
      titleCounts: [structureCount('categories', cats.length, undefined, options)],
      title: accessibleTitle(options.title, chartString(options, 'dotTitle', { v1: variantWord, v2: cats.length })),
      counts: [structureCount('series', dataSeries.length, undefined, options)],
      desc: chartString(options, 'dotDesc', { v1: variantWord, v2: dataSeries.length, v3: a11yDesc }),
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annResult.decisions],
    },
  };
  const contentPlot = rowPitchPlot();
  if (contentPlot) geometry[CONTENT_PLOT_HEIGHT] = contentPlot;
  return geometry;

  // ---- helpers ----

  /**
   * A line never touches text: a vertical reference line that passes a value
   * label closer than LINE_CLEAR breaks over the label's row, REFERENCE_LABEL_CLEARANCE px past
   * the box, as the shared clearance breaks a line through a label (dumbbell at 400 and 320 px).
   */
  function breakLinesAtLabels(): void {
    if (lineGaps.length === 0) return;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node.t !== 'line' || node.part !== 'valueLine' || Math.abs(node.x1 - node.x2) > 1e-6) continue;
      const lx = node.x1;
      const from = Math.min(node.y1, node.y2);
      const to = Math.max(node.y1, node.y2);
      const cuts = lineGaps
        .filter((rect) => lx > rect.x - LINE_CLEAR && lx < rect.x + rect.w + LINE_CLEAR)
        .map((rect): [number, number] => [rect.y - REFERENCE_LABEL_CLEARANCE, rect.y + rect.h + REFERENCE_LABEL_CLEARANCE])
        .sort((a, b) => a[0] - b[0]);
      if (cuts.length === 0) continue;
      const runs: [number, number][] = [];
      let start = from;
      for (const [c0, c1] of cuts) {
        if (c0 > start) runs.push([start, Math.min(c0, to)]);
        start = Math.max(start, c1);
      }
      if (start < to) runs.push([start, to]);
      const drawn = runs.filter(([a, b]) => b - a >= 1);
      if (drawn.length === 0) continue;
      const { x1: _x1, y1: _y1, x2: _x2, y2: _y2, t: _t, ...rest } = node;
      nodes[i] = { ...rest, t: 'path', d: drawn.map(([a, b]) => `M${round2(lx)} ${round2(a)}L${round2(lx)} ${round2(b)}`).join('') };
    }
  }

  /**
   * An automatic height draws the rows at the style's row pitch (ROW_PITCH_CAP, or
   * headerRowPitch for header rows). The rows at
   * that pitch are the content plot height (sizing.ts CONTENT_PLOT_HEIGHT): it caps the
   * plot floor, so a few rows give a shorter card, and a dumbbell with header rows takes
   * exactly the room its headers need.
   */
  function rowPitchPlot(): ContentPlotHeight | undefined {
    if (!openHeight || (options.mode ?? 'full') === 'compact' || cats.length === 0) return undefined;
    const pitch = rowHeaders ? headerRowPitch(size.width) : ROW_PITCH_CAP[variant][size.width >= NARROW_PITCH_WIDTH ? 0 : 1];
    return { px: cats.length * pitch, exact: rowHeaders };
  }

  /**
   * Fill for a dot (scenario semantics fixed by spec; circles cannot hatch,
   * so PL *and* FC render hollow — background fill + series-colored ring).
   * Dumbbell defaults: series a in the neutral mark, series b in series 1.
   */
  function dotPaint(s: NormSeries, catId: Id, meta: CellMeta | null): { paint: Paint; hollow: boolean } {
    const raw = rawDotPaint(s, catId, meta);
    return { ...raw, paint: meta?.fill || meta?.scenario || highlights.has(catId) ? raw.paint : identities.get(s.id)!.paint };
  }

  /**
   * A theme in the scenario notation (grey series) draws each end of a
   * PY/AC dumbbell in its own scenario paint, AC solid and PY light, where
   * that pair is farther apart than the neutral and series 1 (#939393
   * against #6D6D6D reads as one grey under notation).
   */
  function scenarioEnds(): boolean {
    const ramp = paletteRamp ? options.palette : undefined;
    const lead = paintColor(theme, themeSeriesPaint(0, ramp));
    if ((hueSaturation(lead)?.saturation ?? 1) >= GREY_SATURATION) return false;
    const py = dataSeries.find((d) => d.scenario === 'PY');
    const ac = dataSeries.find((d) => d !== py);
    if (!py || !ac) return false;
    const own = palettePerceptualDistance(paintColor(theme, themeSeriesPaint(py.slot, ramp, 'PY')), paintColor(theme, themeSeriesPaint(ac.slot, ramp, ac.scenario ?? 'AC')));
    return own > palettePerceptualDistance(paintColor(theme, { token: 'neutralMark' }), lead);
  }
  function rawDotPaint(
    s: NormSeries,
    catId: Id,
    meta: CellMeta | null,
  ): { paint: Paint; hollow: boolean } {
    const scen = meta?.scenario ?? s.scenario;
    // Two dot series on one row differ by shape as well as colour:
    // the second is a ring.
    const hollow = scen === 'PL' || scen === 'FC' || (variant === 'dot' && dataSeries.length === 2 && dataSeries.indexOf(s) === 1);
    if (meta?.fill) return { paint: { css: meta.fill }, hollow };
    if (s.fill) return { paint: { css: s.fill }, hollow };
    if (s.colorRole) return { paint: rolePaints.get(s.id) ?? markRolePaint(s.colorRole), hollow };
    if (highlights.has(s.id)) return { paint: { token: 'focus' }, hollow };
    if (highlights.has(catId) && dataSeries.length === 1) {
      return { paint: { token: 'focus' }, hollow };
    }
    if (s.id === receding) return { paint: mutedMarkPaint(), hollow };
    // A receded dot is still a mark, and reaches 3:1 on the page.
    if (restRecedes && !scen) return { paint: mutedMarkPaint(), hollow };
    // The scenario roles of a dumbbell pair (theme.scenario PY 'solidLight'):
    // the prior year takes the neutral end, the other end leads in series 1.
    if (variant === 'dumbbell' && dataSeries.some((d) => d.scenario === 'PY')) {
      if (scenarioEnds()) return { paint: themeSeriesPaint(s.slot, paletteRamp ? options.palette : undefined, scen), hollow };
      return { paint: scen === 'PY' ? { token: 'neutralMark' } : themeSeriesPaint(0, paletteRamp ? options.palette : undefined), hollow };
    }
    if (scen) {
      return {
        paint:
          dataSeries.length === 1
            ? themeSeriesPaint(s.slot, paletteRamp ? options.palette : undefined, scen)
            : themeSeriesPaint(s.slot, paletteRamp ? options.palette : undefined),
        hollow,
      };
    }
    if (variant === 'dumbbell') {
      // The second slot leads in series 1; the accent waits for an authored highlight.
      return { paint: s.slot === 0 ? { token: 'neutralMark' } : themeSeriesPaint(0, paletteRamp ? options.palette : undefined), hollow };
    }
    return {
      paint: themeSeriesPaint(s.slot, paletteRamp ? options.palette : undefined),
      hollow,
    };
  }

  /**
   * Dot-family cascade: primary side → other side → above → below → just past
   * the blocker, primary side first → reserved row lane.
   */
  /**
   * Prefer a merged label inside the plot. Keep the other seats as fallbacks:
   * a reference line can block every inside seat. The solver still checks
   * the category names and canvas edge before it accepts an outside seat.
   */
  function insidePlotFirst(candidates: SlotCandidate[]): SlotCandidate[] {
    const inside = (c: SlotCandidate) => c.rect.x >= plot.x && c.rect.x + c.rect.w <= plot.x + plot.w;
    // Merged requests have no labelGap, so the solver uses array order.
    return [...candidates.filter(inside), ...candidates.filter(c => !inside(c))];
  }

  function dotCandidates(
    cx: number,
    cy: number,
    tsize: { width: number; height: number },
    primary: 'left' | 'right',
    owner: OwnerRef,
  ): SlotCandidate[] {
    const right: SlotCandidate = {
      slot: 'right',
      rect: { x: cx + r + LABEL_GAP, y: cy - tsize.height / 2, w: tsize.width, h: tsize.height },
      penalty: primary === 'right' ? 0 : 1,
    };
    const left: SlotCandidate = {
      slot: 'left',
      rect: {
        x: cx - r - LABEL_GAP - tsize.width,
        y: cy - tsize.height / 2,
        w: tsize.width,
        h: tsize.height,
      },
      penalty: primary === 'left' ? 0 : 1,
    };
    const above: SlotCandidate = {
      slot: 'above',
      rect: { x: cx - tsize.width / 2, y: cy - r - 3 - tsize.height, w: tsize.width, h: tsize.height },
      penalty: 2,
    };
    const below: SlotCandidate = {
      slot: 'below',
      rect: { x: cx - tsize.width / 2, y: cy + r + 3, w: tsize.width, h: tsize.height },
      penalty: 3,
    };
    const rowLane: SlotCandidate = primary === 'left'
      ? {
          slot: 'rowLaneLeft',
          rect: {
            x: plot.x - r - LABEL_GAP - tsize.width,
            y: cy - tsize.height / 2,
            w: tsize.width,
            h: tsize.height,
          },
          penalty: 4,
          leaderFrom: { x: cx, y: cy },
        }
      : {
          slot: 'rowLaneRight',
          rect: {
            x: plot.x + plot.w + r + LABEL_GAP,
            y: cy - tsize.height / 2,
            w: tsize.width,
            h: tsize.height,
          },
          penalty: 4,
          leaderFrom: { x: cx, y: cy },
        };
    // A thin rule or a neighbour on a side seat: the nearest seat just past
    // it in the row, 3 px clear, beats a lane with a long leader. The slide
    // reaches one label width plus the gaps, enough to clear any rule under
    // the seat and too little to jump a connector or the other dot.
    const obstacles = occupied.snapshot()
      .filter((o) => !(o.kind === 'mark' && isOwnMark(o.owner, owner, 'point', o.part)))
      .map((o) => o.rect);
    const reach = 2 * tsize.width + 2 * LABEL_GAP;
    const past = (slot: string, lo: number, hi: number, from: Rect): SlotCandidate[] =>
      seatsPastBlockers(from, 'x', lo, hi, obstacles, 3).map((rect) => ({ slot, rect, penalty: 4 }));
    const rightPast = past('rightPast', right.rect.x, Math.min(valueBody.x + valueBody.w, right.rect.x + reach), right.rect);
    const leftPast = past('leftPast', Math.max(valueBody.x, left.rect.x + tsize.width - reach), left.rect.x + tsize.width, left.rect);
    return primary === 'left'
      ? [left, right, above, below, ...leftPast, ...rightPast, rowLane]
      : [right, left, above, below, ...rightPast, ...leftPast, rowLane];
  }

  function buildLegend(): { options: LegendOptions; items: LegendItemInput[] } | undefined {
    const l = options.legend;
    // The coloured arrows and the range rails are keyed in
    // their own shape, in a key above the plot when none was asked for.
    const extras: LegendItemInput[] = [
      ...(rangesDrawn ? [{ id: '__range', label: options.range?.label ?? chartString(options, 'rangeName'), paint: RAIL_PAINT, width: strokeToken(theme, 'focus'), key: 'line' as const,
        // The key draws the rail's end ticks as the plot does (its 5 px cap half at full rows).
        caps: { paint: CAP_PAINT, width: strokeToken(theme, 'mark'), half: 5 } }] : []),
      ...(midsDrawn ? [{ id: '__rangeMid', label: midName, key: 'marker' as const, paint: { token: 'background' } as Paint, stroke: { token: 'inkMuted' } as Paint, width: strokeToken(theme, 'mark'), radius: MID_KEY_R }] : []),
      ...(['rose', 'fell'] as const).filter((d) => directionsDrawn.has(d)).map((d) => ({
        id: `__${d}`, label: d === 'rose' ? chartString(options, 'rose') : chartString(options, 'fell'), key: 'line' as const,
        paint: { token: (d === 'rose') === (dataSeries[1]?.direction === 'higherIsBetter') ? 'good' : 'bad' } as Paint,
      })),
    ];
    if (l === 'none' || l === 'auto' || (!l && extras.length === 0)) return undefined;
    const legendOptions: LegendOptions = normalizeLegendOption(l ?? 'top');
    // A compact key shares its row with the unit when a separate unit line
    // would use the height the plotted rows need.
    const keyUnit = options.mode === 'compact' &&
      !unitPrinted({ ...options, subtitle: resolveSubtitle(options.subtitle) }) ? options.unit : undefined;
    // A range key names the dot as well, so the reader sees which mark is ours.
    let items: LegendItemInput[] = [...(l || rangesDrawn ? dataSeries.map((s) => {
      const { paint, hollow } = dotPaint(s, '', null);
      // The key shows the mark it explains: a dot, filled, or a ring as the
      // hollow point draws it (1 px), whatever the theme's plan look.
      // The key dot is drawn at the plot's dot size, not the 6 px key default.
      return { id: s.id, label: keyUnit ? `${s.label} (${keyUnit})` : s.label, key: 'marker' as const, radius: dotRadiusCap(variant, size.width), paint: hollow ? { token: 'background' } as Paint : paint, ...(hollow ? { stroke: paint, width: strokeToken(theme, 'rule') } : {}) };
    }) : []), ...extras];
    if (legendOptions.order) {
      const rank = new Map(legendOptions.order.map((id, i) => [id, i]));
      items = [...items].sort(
        (a, b) =>
          (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return { options: legendOptions, items };
  }
}
