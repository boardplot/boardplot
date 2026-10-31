import { chartString } from '../../strings/heatmap';
import { chartTheme } from '../chartEnv';
import { labelOn as chartLabelOn } from '../labelOn';
import { structureCount } from '../../structureCounts';
/**
 * Heatmap / matrix. Categories are COLUMNS,
 * series are ROWS, cells are values. Two scales: 'continuous' (white → theme
 * highlight; a signed matrix or a declared series.direction switches to the
 * good/bad valence poles, inverted per row under 'lowerIsBetter') and
 * 'discrete' (5-step grey → highlight ladder for 0–4 ratings). Two glyphs:
 * 'value' (filled cell with in-cell value labels DEFAULT ON — the consulting
 * version shows numbers,
 * auto-ink per cell) and 'harvey' (0–4 quarter-fill Harvey ball; cells stay white, value labels suppressed).
 */

import type { AnchorResolution } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { marginBracketLayout } from '../../annotateLinks';
import { defaultNumberDecimals, formatAutomaticNumber, NOT_AVAILABLE, numberRange } from '../../format';
import { AUTOMATIC_FORMAT, type AutomaticFormatSource, defaultFormatSpec, exampleSpec, formatNonzeroWithSpec, formatterFromExample, rasterDecimals, seriesRasterFormatter, parseFormatExample, specUnitKind } from '../../formatSpec';
import { cleanFloat, round2, type Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { categoryLineAlign, planCategoryRow, rotatedClaimRect } from '../../label/categoryRow';
import { MONTH_START } from '../../label/tickRow';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import type { TickBandDerived } from '../../label/tickRow';
import { accessibleTitle,
  NormalizeError,
  normalizeCategory,
  normalizeSeriesValues,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { authoredNotes, frameTextOptions, legendOff, legendRequired, normalizeLegendOption, solveFrame, plotHeightAfter, authoredFootnoteCount, valueNoteLine, DEFAULT_NOTE_LIMIT, HIDDEN_LABEL_LEAD, type LegendItemInput } from '../../frame';
import { defaultMeasurer, wrapText, type FontSpec, type TextMeasurer } from '../../text';
import { sequentialShare } from '../../colorRecipes';
import { niceBelow, niceStep } from '../../scale';
import {
  canvasMargin,
  colorblindPaint,
  paintColor,
  panelTypeClass,
  resolveSemanticPaletteTheme,
  semanticPalettePaint,
  emphasisWeight,
  strokeToken,
} from '../../theme';
import type { AnchorRef, Annotation } from '../../types/annotations';
import { cellMeta, cellValue, isPctCell, type CellMeta, type Direction, type Id, type OwnerRef } from '../../types/cell';
import type { HeatmapData } from '../../types/data';
import type { HeatmapOptions, LabelKind, LegendOptions } from '../../types/options';
import type {
  Geometry,
  LintWarning,
  Paint,
  PlacedAnnotation,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import { rowDrivenHeight } from '../../rowCanvas';
import { rowLabelBand } from '../../label/rowLabels';
import { fittedLabel, gutterBudget, GUTTER_MAX_SHARE, stepDownFont } from '../../label/rowFit';
import { capPitch, HARD_MINIMUM, matrixWidths, rowSizing } from '../../sizing';
import { arrowHeadPath, arrowShaftEnd, harveyWedgePath } from '../../svgPath';
import { nonzeroDecimals } from '../../formatPrecision';
import { categoryLabelsAndMarks } from '../../footnoteMark';
import { readerFloorPx, textScaleOf } from '../../typeFloors';
import { DEFAULT_TARGET } from '../../target';
import { disclosureNote } from '../../notes';
import { maxOf, minOf, pushAll } from '../../arrays';
import { headInk as tableHeadInk, plainInk } from '../table/headFace';
import { emptyIdRecord } from '../../idRecords';

export interface HeatmapMarks {
  cells: { seriesId: Id; categoryId: Id; rect: Rect; nodeId: Id; value: number | null }[];
}

export interface HeatmapDerived {
  max: number;
  min: number;
  /** Exact means of the values present; null for a row or column without one. */
  rowMeans: Record<Id, number | null>;
  colMeans: Record<Id, number | null>;
  /** The receipt for the column-header category row. */
  tickBand?: TickBandDerived;
}

/**
 * A row suffix (the cohort size) that does not fit the band whole refuses the width.
 * shortcut: the band grows to at most GUTTER_MAX_SHARE of the plot, so the floor scales the shortfall by it; only a tiny canvas reaches it.
 */
function withSuffixFloor(widths: { minWidth: number; naturalWidth: number }, width: number, short: number) {
  return short > 0 ? { ...widths, minWidth: Math.max(widths.minWidth, width + Math.ceil(short / GUTTER_MAX_SHARE)) } : widths;
}

interface NormRow {
  id: Id;
  label: string;
  direction?: Direction;
  format?: string;
  unit?: string;
  cells: { v: number | null; pct: boolean; meta: CellMeta | null; size: number | null; base: number | null }[];
}

interface NormCol {
  id: Id;
  label: string;
  date?: string;
  /** Authored footnote reference, drawn beside the name. */
  footnote?: number;
}

/** The styled Harvey row: 42 px from 720 px up, 36 px on narrower cards, 27 px in the list form. */
const HARVEY_ROW = 42;
const HARVEY_ROW_CARD = 36;
const HARVEY_LIST_ROW = 27;
/** The width of the ball column in the Harvey list form. */
const HARVEY_LIST_CELL = 28;
/** Wide Harvey cards leave 8 px before the headers and 12 px more below the source. */
const HARVEY_HEADER_GAP = 8;
const HARVEY_BOTTOM_GAP = 12;
/** Gaps between cell rects: 2 px, 1.5 px on the value matrix's own drawing. */
const BASE_CELL_GAP = 2;
const VALUE_CELL_GAP = 1.5;
/** Value matrix row floors: under 480 px and under 720 px. */
const VALUE_ROW_CARD = 22;
const VALUE_ROW_NARROW = 26;
/** The value matrix row at 960 px and wider: 32.5 px cells, 34 px pitch. */
const VALUE_ROW_WIDE = 32.5;
const VALUE_KEY_GAP = 8;
/** The narrowest column pitch at which a wide bubble matrix stays upright with two-tier names. */
const UPRIGHT_TIER_PITCH = 44;
const ROW_BAND_GAP = 8; // row-label band → grid
const HEADER_GAP = 4; // column-header band → grid
/** How far past the grid edge a callout's seat on its row begins (twice the callout gap). */
const CALLOUT_SEAT = 16;
/** Room for the caret between the value matrix and a note row under it. */
const CARET_ROOM = 8;
/** The stripes of a missing cell and its key. */
const NO_DATA_PAINT: Paint = { token: 'grid' };
/** Air between the matrix's right edge and a comparison bracket's ticks. */
const BRACKET_CLEAR = 6;
/** Room past the grid's right edge for a bubble row track's arrow. */
const TRACK_ROOM = 12;
/** Air between the bubble keys and the column headers, and between the two keys. */
const KEY_GAP = 12;
const KEY_GROUP_GAP = 32;
/** Height of the bubble colour key's bar. */
const KEY_BAR_H = 10;
/** Radius of a colour-class dot in the bubble key. */
const KEY_DOT_R = 5.5;
/** Air between a key glyph and its name, and between two key entries. */
const KEY_TEXT_GAP = 5;
const KEY_ENTRY_GAP = 14;
/** Air the largest bubble keeps inside its cell, each side, and on a cell under 40 px. */
const BUBBLE_AIR = 2;
const BUBBLE_AIR_TIGHT = 1;
/** How far a value's figures may reach past the edge of its circle. */
const VALUE_OVERHANG = 1.5;
/** Air between the two tiers of a staggered header, and between two names of one tier. */
const TIER_GAP = 2;
const TIER_NAME_GAP = 8;
/** Air between a tier tick and a lower-tier name beside it (a line never touches text). */
const TICK_CLEAR = 4;
/** A bubble matrix laid out turned: categories as rows, series as columns (internal pass flag). */
const TURNED = Symbol('heatmapTurned');
/**
 * The heatmap's options as an adapter lays it out. `heatKey` is the colour
 * key of an adapter that paints the cells itself (cohort), and the chart type
 * its warning names: a layout channel, not a public option, so neither the
 * schema nor the React props take it.
 */
export type HeatmapLayoutOptions = HeatmapOptions & {
  heatKey?: { chartType: string; items: { id: Id; label: string; paint: Paint; stroke?: Paint }[] };
  /** The end of a row's label that is never cut, by row id: the cohort size (rowLabelBand). */
  rowSuffix?: Record<Id, string>;
  [TURNED]?: true;
};

export function layoutHeatmap(
  data: HeatmapData,
  options: HeatmapLayoutOptions = {},
  /** The right gutter the comparison brackets asked for on a first pass. */
  bracketGutter?: number,
  valueNote?: string,
  forceRows: readonly Id[] = [],
  compactKey = false,
): Geometry<HeatmapMarks, HeatmapDerived> {
  const warnings: LintWarning[] = [];
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const scale = options.scale ?? 'continuous';
  const glyph = options.variant ?? 'value';
  const highlights = new Set(resolveHighlight(options.highlight));
  // labels: false takes the cell values off; the row and column names stay.
  const labelOn = (kind: LabelKind): boolean => chartLabelOn(options, kind, ['series', 'category']);
  // In-cell value labels DEFAULT ON — except in harvey mode (glyph replaces number).
  const cellLabelsOn = glyph !== 'harvey' && labelOn('point');
  const bubble = glyph === 'bubble';
  // The value matrix on its own (no host key such as the cohort's, no grid
  // panel) takes its own style: a short gradient key, 1.5 px gaps, an
  // ink frame and a bold name on the highlighted row, a caret value row.
  const valueStyle = glyph === 'value' && options.heatKey === undefined && panelTypeClass(options) === undefined;
  const CELL_GAP = valueStyle ? VALUE_CELL_GAP : BASE_CELL_GAP;
  // The bubble matrix on its own under a render target takes its own
  // style: radii 2 : 3 : 4 for three levels, values in the largest circles
  // only, a dot key and a size key left-aligned, rules above and below the
  // matrix, row names at the plot edge, and a turned matrix (categories as
  // rows) where the column names cannot stand flat.
  const bubbleStyle = bubble && options.heatKey === undefined && panelTypeClass(options) === undefined;
  // The Harvey matrix on its own under a render target takes its own
  // style: borderless cells between two rules, a taller row,
  // row names at the plot edge, and, where the column names cannot stand flat,
  // a single-row matrix becomes a vertical list (ball, then name).
  const harveyStyle = glyph === 'harvey' && options.heatKey === undefined && panelTypeClass(options) === undefined;
  const turned = (bubbleStyle || harveyStyle) && options[TURNED] === true;
  /** The vertical list form of a turned Harvey row: one ball and its name per line. */
  const harveyList = harveyStyle && turned;
  const harveyWide = harveyStyle && !harveyList && size.width >= 720;

  // ---- normalize ----
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'heatmap requires at least one category (column)');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'heatmap requires at least one series (row)');
  }
  const rawCats = data.categories.map((c, i) => normalizeCategory(c as never, i));
  let cols: NormCol[] = rawCats.map((c) => ({ id: c.id, label: c.label ?? c.id, date: c.date, ...(c.footnote === undefined ? {} : { footnote: c.footnote }) }));
  let rows: NormRow[] = data.series.map((s, i) => {
    if (!s?.id) throw new NormalizeError('missing-id', `series[${i}]`, 'series requires an id');
    const { sizes, bases } = s;
    if ((sizes?.length ?? 0) > rawCats.length || (bases?.length ?? 0) > rawCats.length) {
      throw new NormalizeError('length-mismatch', `series[${s.id}]`, `series '${s.id}' has more sizes or bases than the ${rawCats.length} categories`, 'give one size and one base per category, in category order');
    }
    const cells = normalizeSeriesValues(s, rawCats, i).map((c, ci) => ({
      v: cellValue(c),
      pct: isPctCell(c),
      meta: cellMeta(c),
      size: sizes?.[ci] ?? null,
      base: bases?.[ci] ?? null,
    }));
    return { id: s.id, label: s.label ?? s.id, direction: s.direction, format: s.format, unit: s.unit, cells };
  });
  // A Harvey ball is a rating 0 to 4. Any other value is
  // refused at its data path; a quintile guess would draw ratings nobody gave.
  if (glyph === 'harvey') {
    rows.forEach((r, si) => r.cells.forEach((cell, ci) => {
      const v = cell.v;
      if (v === null || (Number.isInteger(v) && v >= 0 && v <= 4)) return;
      const keyed = data.series[si]!.values.findIndex((raw) => typeof raw === 'object' && raw !== null && 'categoryId' in raw && raw.categoryId === rawCats[ci]!.id);
      const vi = keyed >= 0 ? keyed : ci;
      throw new NormalizeError('harvey-ratings', `series[${r.id}].values[${vi}]`,
        `a Harvey ball shows a rating 0 to 4; series '${r.id}' holds ${v} for '${rawCats[ci]!.id}'`,
        'supply ratings 0 to 4 or use numeric cells',
        [{ op: 'replace', path: '/options/variant', value: 'value' }], ['data', 'series', si, 'values', vi]);
    }));
  }

  // Bubble sizes: ordinal levels 1..n, or a continuous area scale.
  const levels = options.bubble?.levels;
  const hasSizes = data.series.some((s) => s.sizes !== undefined);
  if (bubble && levels) {
    rows.forEach((r, si) => r.cells.forEach((cell, ci) => {
      const v = cell.size;
      if (v === null || (Number.isInteger(v) && v >= 1 && v <= levels.length)) return;
      throw new NormalizeError('bubble-levels', `series[${r.id}].sizes[${ci}]`,
        `a bubble size level runs 1 to ${levels.length} (${levels.join(', ')}); series '${r.id}' holds ${v} for '${rawCats[ci]!.id}'`,
        'supply levels 1 to n or drop options.bubble.levels for a continuous area scale', undefined, ['data', 'series', si, 'sizes', ci]);
    }));
  }
  if (hasSizes && !bubble) warnings.push({ code: 'sizes-ignored', severity: 'warn', message: "series sizes size the bubble glyph only; this matrix draws no circles", suggest: "set variant 'bubble' or drop sizes", field: ['options', 'variant'] });
  if (options.minBase !== undefined && !data.series.some((s) => s.bases !== undefined)) {
    warnings.push({ code: 'min-base-without-bases', severity: 'warn', message: 'minBase marks low-base cells, but no series supplies bases', suggest: 'add series bases or drop minBase', field: ['options', 'minBase'] });
  }
  const lowBase = (cell: NormRow['cells'][number]): boolean => options.minBase !== undefined && cell.base !== null && cell.base < options.minBase;

  // ---- sort (live properties): categories = columns by column mean,
  //      segments = rows by row mean; deterministic tie-break by sheet index ----
  // A mean is exact (the exhibit's formatter rounds it once, at print time)
  // and a row or column without a value has none: it is described as
  // unavailable and sorts last, never as a 0 between the real means.
  const meanOf = (vals: (number | null)[]): number | null => {
    const known = vals.filter((v): v is number => v !== null);
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  };
  const colMeanAt = (ci: number): number | null => meanOf(rows.map((r) => r.cells[ci]!.v));
  const rowMeanOf = (r: NormRow): number | null => meanOf(r.cells.map((c) => c.v));
  const byMean = (means: (number | null)[], direction: 1 | -1) => (a: number, b: number): number => {
    const ma = means[a]!;
    const mb = means[b]!;
    if (ma === null || mb === null) return Number(ma === null) - Number(mb === null) || a - b;
    return direction * (ma - mb) || a - b;
  };
  const catSort = options.sort?.categories ?? 'sheet';
  if (catSort !== 'sheet') {
    const idx = cols.map((_, i) => i);
    const means = cols.map((_, i) => colMeanAt(i));
    if (catSort === 'asc') idx.sort(byMean(means, 1));
    else if (catSort === 'desc') idx.sort(byMean(means, -1));
    else idx.reverse();
    cols = idx.map((i) => cols[i]!);
    rows = rows.map((r) => ({ ...r, cells: idx.map((i) => r.cells[i]!) }));
  }
  const segSort = options.sort?.segments ?? 'sheet';
  if (segSort !== 'sheet') {
    const idx = rows.map((_, i) => i);
    const means = rows.map((r) => rowMeanOf(r));
    if (segSort === 'asc') idx.sort(byMean(means, 1));
    else if (segSort === 'desc') idx.sort(byMean(means, -1));
    else idx.reverse();
    rows = idx.map((i) => rows[i]!);
  }

  // ---- derive: min/max, row/column means ----
  const allValues: number[] = [];
  for (const r of rows) for (const c of r.cells) if (c.v !== null) allValues.push(c.v);
  // One precision for every value, key stop and hover card: the
  // decimals the most precise value needs, so "11" never stands beside
  // "12.4"; no nonzero value rounds to 0.
  const rasterSpec = defaultFormatSpec(options.locale?.language);
  const decimals = rasterDecimals(allValues, rasterSpec);
  const fmt = options.format
    ? formatterFromExample(options.format, options.locale?.language)
    : (v: number) => formatAutomaticNumber(v, { locale: options.locale?.language, decimals: defaultNumberDecimals(v, nonzeroDecimals(v, decimals), options.unit, options.target) });
  const formats = seriesRasterFormatter(options.format, allValues, options.locale?.language, options.unit, options.target);
  const vMax = allValues.length > 0 ? maxOf(allValues) : 0;
  const vMin = allValues.length > 0 ? minOf(allValues) : 0;
  const posMax = Math.max(0, vMax);
  const negMin = Math.min(0, vMin);
  // one scale both ways from zero, so +27 and −27 paint one strength:
  // full at the larger magnitude, or at the authored cap (table heat's cap,
  // in points on a matrix of percent cells).
  const pctMatrix = allValues.length > 0 && rows.every((r) => r.cells.every((c) => c.v === null || c.pct));
  const cap = scale === 'continuous' ? pctMatrix ? options.cap?.pct : options.cap?.abs : undefined;
  const valenceSpan = cap ?? Math.max(posMax, -negMin);
  const rowMeans: Record<Id, number | null> = emptyIdRecord();
  for (const r of rows) rowMeans[r.id] = rowMeanOf(r);
  const colMeans: Record<Id, number | null> = emptyIdRecord();
  cols.forEach((c, ci) => (colMeans[c.id] = colMeanAt(ci)));
  // The data's own rows and columns, for the description: a turned matrix
  // draws the categories as rows but reads as the same table.
  const dataRows = rows, dataCols = cols;
  if (turned) {
    const lead = rows[0]!;
    const turnedRows: NormRow[] = cols.map((c, ci) => ({ id: c.id, label: c.label, direction: lead.direction, format: lead.format, unit: lead.unit, cells: rows.map((r) => r.cells[ci]!) }));
    cols = rows.map((r) => ({ id: r.id, label: r.label }));
    rows = turnedRows;
  }
  /** The data identity of a drawn cell: its series and its category, whichever way the matrix stands. */
  const seriesOf = (r: NormRow, c: NormCol): Id => (turned ? c.id : r.id);
  const categoryOf = (r: NormRow, c: NormCol): Id => (turned ? r.id : c.id);
  const cellKey = (r: NormRow, c: NormCol): string => `${seriesOf(r, c)}:${categoryOf(r, c)}`;
  /** The label ids of the row band and the header: series and category names, swapped on a turned matrix. */
  const rowLabelId = (r: NormRow): string => (turned ? `category:${r.id}` : `series:${r.id}`);
  const colLabelId = (c: NormCol): string => (turned ? `series:${c.id}` : `category:${c.id}`);
  const rowOwner = (r: NormRow): OwnerRef => (turned ? { categoryId: r.id } : { seriesId: r.id });
  const colOwner = (c: NormCol): OwnerRef => (turned ? { seriesId: c.id } : { categoryId: c.id });

  // ---- discrete/harvey level mapping ----
  // 'discrete' expects ratings 0..4; anything else maps to quintiles (warned).
  // Harvey glyphs refused anything else above.
  const isRatingScale = allValues.every((v) => Number.isInteger(v) && v >= 0 && v <= 4);
  const bins = scale === 'discrete' ? options.breaks : undefined;
  if (options.breaks && !bins) warnings.push({ code: 'breaks-ignored', severity: 'warn', message: "breaks bin the discrete scale; the continuous scale ignores them", suggest: "set scale 'discrete' or drop breaks", field: ['options', 'breaks'] });
  if (bins && allValues.some((v) => v < bins[0]! || v > bins.at(-1)!)) {
    warnings.push({ code: 'value-outside-breaks', severity: 'warn', message: `values outside ${numberRange(fmt(bins[0]!), fmt(bins.at(-1)!))} take the nearest end bin`, suggest: 'widen the first or last break', field: ['options', 'breaks'] });
  }
  // A binned key, or a bubble colour key on a directed continuous scale, is one
  // ramp: rows that read it in opposite directions would paint the same colour
  // two ways and the key would contradict one of them.
  const lower = (s: HeatmapData['series'][number]) => s.direction === 'lowerIsBetter';
  const flipped = data.series.findIndex((s) => lower(s) !== lower(data.series[0]!));
  const sharedKey = bins || (glyph === 'bubble' && scale === 'continuous' && data.series.some((s) => s.direction !== undefined));
  if (sharedKey && options.legend !== 'none' && flipped > 0) {
    throw new NormalizeError('mixed-directions', `series[${data.series[flipped]!.id}].direction`,
      `series '${data.series[0]!.id}' and '${data.series[flipped]!.id}' read the colour key in opposite directions, but one shared colour key cannot show both`,
      'give every row one direction, or split the lowerIsBetter rows into their own chart', undefined, ['data', 'series', flipped, 'direction']);
  }
  /** The bin of a value: an edge belongs to the bin above it; values past the ends take the end bins. */
  const binOf = (v: number): number => {
    let i = bins!.length - 2;
    while (i > 0 && v < bins![i]!) i--;
    return i;
  };
  if (scale === 'discrete' && !bins && !isRatingScale && allValues.length > 0) {
    warnings.push({
      code: 'discrete-quintiles',
      severity: 'warn',
      message: `discrete scale expects integer values 0–4; values ${numberRange(fmt(vMin), fmt(vMax))} mapped to quintiles`,
    });
  }
  const levelOf = (v: number): number => {
    if (isRatingScale) return v;
    if (vMax === vMin) return 2;
    return Math.min(4, Math.floor(((v - vMin) / (vMax - vMin)) * 5));
  };

  // ---- cell fill resolution (explicit meta.fill always wins) ----
  // Signed data or explicit direction uses good/bad valence, with lowerIsBetter
  // inverted per row. Unsigned data uses a magnitude ramp. Discrete ratings
  // use the ladder. Paints stay theme-symbolic unless the author supplies a fill.
  const declaredDirections = rows.some((r) => r.direction !== undefined);
  const valence = vMin < 0 || (scale === 'continuous' && declaredDirections);
  if (options.cap && (scale === 'discrete' || glyph === 'harvey')) {
    warnings.push({ code: 'cap-ignored', severity: 'warn', message: `cap does not apply to ${glyph === 'harvey' ? 'harvey glyphs' : 'the discrete rating ladder'}; it sets where the continuous scale saturates`, suggest: 'drop cap', field: ['options', 'cap'] });
  }
  if (declaredDirections && ((scale === 'discrete' && !bins) || glyph === 'harvey')) {
    warnings.push({
      code: 'direction-ignored',
      severity: 'warn',
      message:
        glyph === 'harvey'
          ? "series.direction does not recolor harvey glyphs — cells stay white and the declared judgment is not painted"
          : "series.direction does not apply to the discrete rating ladder — the declared judgment is not painted",
    });
  }
  // The ladder, the unsigned ramp and the harvey fill are marks larger than
  // a point: they take tints of series 1.
  const LADDER_PAINTS: Paint[] = [
    semanticPalettePaint(theme, options.palette, 'neutralMark', 0.85),
    semanticPalettePaint(theme, options.palette, 'sequential', 0.72),
    semanticPalettePaint(theme, options.palette, 'sequential', 0.48),
    semanticPalettePaint(theme, options.palette, 'sequential', 0.24),
    semanticPalettePaint(theme, options.palette, 'sequential'),
  ];
  // A valence cell over 12 x 12 px is a large fill and takes the signed fill
  // role, which falls back to good / bad; a smaller cell keeps them.
  // colorblindSafe swaps the pair for the colour-vision-safe one.
  const valencePaint = (tone: 'good' | 'bad', _large: boolean, tint: number): Paint =>
    options.colorblindSafe ? { ...colorblindPaint(tone, true), tint }
      : { token: tone === 'good' ? 'goodFill' : 'badFill', tint };
  const fillPaint = (v: number | null, meta: CellMeta | null, large: boolean, direction?: Direction): Paint => {
    if (meta?.fill) return { css: meta.fill };
    if (v === null || glyph === 'harvey') return { token: 'background' };
    if (bins) return binPaint(binOf(v), large, direction);
    if (scale === 'discrete') {
      if (valence) return valencePaint(v < 0 ? 'bad' : 'good', large,
        1 - Math.min(1, Math.ceil(Math.abs(v) / (valenceSpan || 1) * 4) / 4));
      return LADDER_PAINTS[Math.max(0, Math.min(4, levelOf(v)))]!;
    }
    const lowIsGood = direction === 'lowerIsBetter';
    if (v >= 0) {
      // A verdict keeps zero as its midpoint; a magnitude ramp spans the data.
      if (valence) {
        const amount = valenceSpan > 0 ? 1 - v / valenceSpan : 1;
        return valencePaint(lowIsGood ? 'bad' : 'good', large, Math.max(0, Math.min(1, amount)));
      }
      const tintAmount = Math.max(0, Math.min(1, 1 - (cap === undefined ? sequentialShare(v, Math.max(0, vMin), posMax) : v / cap)));
      return semanticPalettePaint(theme, options.palette, 'sequential', tintAmount);
    }
    // v < 0 implies vMin < 0, so the continuous negative branch is always valence.
    const amount = valenceSpan > 0 ? 1 + v / valenceSpan : 1;
    return valencePaint(lowIsGood ? 'good' : 'bad', large, Math.max(0, Math.min(1, amount)));
  };

  // Authored bins: without a direction one hue from pale (low) to full (high);
  // with a declared direction the good/bad roles, worst bin bad at full
  // strength, best bin good, a middle bin neutral, so dark = bad is never implicit.
  function binPaint(bin: number, large: boolean, direction?: Direction): Paint {
    const k = bins!.length - 1;
    if (!declaredDirections) return semanticPalettePaint(theme, options.palette, 'sequential', k > 1 ? 0.75 * (k - 1 - bin) / (k - 1) : 0);
    const s = (k > 1 ? (2 * bin) / (k - 1) - 1 : 1) * (direction === 'lowerIsBetter' ? -1 : 1);
    if (Math.abs(s) < 1e-9) return semanticPalettePaint(theme, options.palette, 'neutralMark', 0.55);
    return valencePaint(s < 0 ? 'bad' : 'good', large, 0.6 * (1 - Math.abs(s)));
  }

  // A shared key may use a series format only when every row agrees.
  const keySeries = rows[0]?.format && rows.every(row => row.format === rows[0]!.format) ? rows[0] : undefined;
  const keyLow = cap === undefined ? vMin : Math.max(valence ? -cap : 0, Math.min(cap, vMin));
  const keyHigh = cap === undefined ? vMax : Math.max(valence ? -cap : 0, Math.min(cap, vMax));
  const keyText = (v: number) => {
    const saturated = cap !== undefined && ((v === keyHigh && vMax > cap) || (v === keyLow && vMin < -cap));
    const value = saturated && Number.isInteger(v) && !pctMatrix && !options.format && !keySeries?.format ? formatAutomaticNumber(v, { locale: options.locale?.language, decimals: 0 }) : displayFor(v, pctMatrix, null, keySeries);
    return `${cap !== undefined && v === keyHigh && vMax > cap ? '>=' : cap !== undefined && v === keyLow && vMin < -cap ? '<=' : ''}${value}`;
  };

  // ---- annotations (resolved to cell centers; placed by the shared pass) ----
  const annotations: Annotation[] = (options.annotations ?? []).map((a, n) => ({
    ...a,
    id: a.id ?? `${a.kind}-${n + 1}`,
  }));

  // ---- fonts ----
  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const lineH = tickFont.size * 1.2;
  // The bubble matrix prints its values bold in its largest circles only, so
  // the same cells carry values at every width.
  const valueLabelFont: FontSpec = bubbleStyle ? { ...labelFont, weight: emphasisWeight(theme) } : labelFont;
  const topOnly = bubbleStyle && cellLabelsOn && levels !== undefined && levels.length >= 2
    && rows.some((r) => r.cells.some((c) => c.v !== null && c.size === levels.length));
  /** The radius a value needs to stand inside its circle: its half width and a pixel, and the figures' height. */
  const valueRadius = (text: string): number => {
    const t = measure(text, valueLabelFont);
    return Math.hypot(t.width / 2 + 1, 0.35 * t.height);
  };
  const topValueR = topOnly ? Math.max(0, maxOf(rows.flatMap((r) => r.cells.flatMap((c) => {
    if (c.v === null || c.size !== levels!.length) return [];
    const text = textFor(c.v, c.pct, c.meta, r);
    return text ? [valueRadius(text)] : [];
  })))) : 0;
  const continuousKey = scale === 'continuous' && glyph === 'value' && !options.heatKey
    && vMax > vMin && !compactKey && panelTypeClass(options) === undefined && options.legend !== 'none'
    && !rows.some(r => r.direction === 'lowerIsBetter');
  const keyRight = normalizeLegendOption(options.legend)?.position === 'right';
  // The styled value matrix sets its gradient key 8 px over the month row.
  // The unit sits centred on the bar and its line box is taller than the bar:
  // the key row starts at the top of that box, not at the top of the bar.
  const unitRise = continuousKey && !keyRight && options.unit ? Math.max(0, (measure(options.unit, tickFont).height - KEY_BAR_H) / 2) : 0;
  const continuousKeyH = continuousKey && !keyRight ? unitRise + KEY_BAR_H + 6 + measure('0', tickFont).height + (valueStyle ? VALUE_KEY_GAP : KEY_GAP) : 0;
  const keyBottom = normalizeLegendOption(options.legend)?.position === 'bottom';

  // ---- frame (title/subtitle/source measured FIRST; plot shrinks) ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  if (harveyWide && options.margin?.bottom === undefined) margin.bottom += HARVEY_BOTTOM_GAP;
  // Harvey quarters are a convention the reader brings and the subtitle names
  // the scale, so the level key is drawn only when the spec names a legend
  // position. A grid panel leaves its key to the grid legend, which
  // collects it.
  let legend: { options: LegendOptions; items: LegendItemInput[] } | undefined;
  // The shading says how large each value is, and a reader cannot guess which
  // colour stands for which value: the cells' own ramp, sampled, in
  // one key row. A grid panel leaves it out (panels shade over their own
  // ranges); the cohort adapter hands in its ramp, pinned at 100%.
  // A missing value on a colour scale is hatched, so on a dark page it
  // never passes for the palest value, and the key names it. A host's own key
  // (the cohort triangle's unobserved cells) keeps its plain blanks.
  // `missing: 'blank'` draws no fill and no stripe; the key or note still names it.
  const missingCells = glyph !== 'harvey' && options.heatKey === undefined && rows.some((r) => r.cells.some((c) => c.v === null));
  const missingLook = options.missing ?? 'hatch';
  const hatchMissing = missingCells && missingLook !== 'blank';
  // `legend: 'none'` drops the key, as on the table: a host that
  // draws its own key for the same scale would otherwise show two.
  const anyLowBase = rows.some((r) => r.cells.some((c) => c.v !== null && lowBase(c)));
  const lowBaseKey = `n < ${formatAutomaticNumber(options.minBase ?? 0, { locale: options.locale?.language })}`;
  const scaleItems = glyph !== 'harvey' && !bubble && allValues.length > 0 && panelTypeClass(options) === undefined
    ? options.heatKey?.items ?? [...(continuousKey ? [] : colourScaleKey()), ...(missingCells
      ? [missingLook === 'blank'
        ? { id: 'scale:none', label: chartString(options, 'noData'), paint: { token: 'background' } as Paint, stroke: { token: 'grid' } as Paint }
        : { id: 'scale:none', label: chartString(options, 'noData'), paint: NO_DATA_PAINT, pattern: 'hatch45' as const, hatchGround: { token: 'background' } as Paint, stroke: { token: 'grid' } as Paint }]
      : []), ...(anyLowBase ? [{ id: 'scale:lowBase', label: lowBaseKey, paint: { token: 'neutralMark' } as Paint, pattern: 'hatch45' as const, hatchGround: { token: 'background' } as Paint }] : [])]
    : undefined;
  // The bubble keys (size and colour) stand in their own strip above the matrix.
  const bubbleKeys = bubble && allValues.length > 0 && panelTypeClass(options) === undefined && options.legend !== 'none';
  const derivedNotes = [
    ...(topOnly ? [disclosureNote(chartString(options, 'heatmapTopValuesNote'))] : []),
    ...(valueNote ? [disclosureNote(valueNote)] : []),
    ...(bubble && missingCells ? [disclosureNote(missingLook === 'blank' ? 'Blank cells: no data.' : chartString(options, 'hatchedNoData'))] : []),
    ...(anyLowBase
      ? [disclosureNote(chartString(options, 'heatmapBaseNote', { v1: bubble ? chartString(options, 'circles') : chartString(options, 'cellsLower'), v2: formatAutomaticNumber(options.minBase!, { locale: options.locale?.language }) }))] : []),
  ];
  if (scaleItems && options.legend === 'none') legendOff(warnings, options.heatKey?.chartType ?? 'heatmap', scaleItems.map((item) => item.label));
  const scaleKey = options.legend === 'none' ? undefined : scaleItems;
  if (scaleKey?.length) {
    legend = {
      options: legendRequired(options.legend, warnings, options.heatKey?.chartType ?? 'heatmap', theme, 'the shading says how large each value is'),
      items: scaleKey,
    };
  } else if (glyph === 'harvey' && allValues.length > 0) {
    const legendOptions = normalizeLegendOption(options.legend);
    const step = (vMax - vMin) / 5;
    if (legendOptions) legend = {
      options: legendOptions,
      items: [0, 1, 2, 3, 4].map((level) => ({
        id: `level:${level}`,
        label: isRatingScale ? String(level) : numberRange(fmt(vMin + level * step), fmt(level === 4 ? vMax : vMin + (level + 1) * step)),
        paint: semanticPalettePaint(theme, options.palette, 'sequential'),
        key: 'harvey' as const,
        level,
      })),
    };
  }
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      ...(derivedNotes.length > 0 ? { footnotes: [...authoredNotes(options), ...derivedNotes] } : {}),
      legend,
      theme,
      measure,
    },
    occupied,
  );
  const keyRightW = continuousKey && keyRight ? KEY_BAR_H + 6 + KEY_GAP
    + Math.max(...[vMin, vMax, ...(cap === undefined ? [] : [-cap, cap])].map(v => measure(`>=${displayFor(v, pctMatrix, null, keySeries)}`, tickFont).width)) : 0;
  const plot0 = { ...frameResult.plot, w: Math.max(10, frameResult.plot.w - keyRightW) };

  // ---- row-label band (measured like bar's category band, capped at 28%) ----
  const capW = Math.max(24, plot0.w * 0.28);
  // one-line header estimate to decide row-label wrapping (breaks the circular dependency)
  const cellHEst = (plot0.h - lineH - HEADER_GAP) / rows.length;
  // Under a render target a card (below 480 px) wraps names to two lines.
  // Wider, a name keeps one line, the band widening up to the shared gutter
  // share while the grid keeps its floor, and wraps only where that cuts it.
  // The value matrix tries one line on a card too; a name that does not fit wraps.
  const card = size.width < 480 && !valueStyle;
  const suffixed = options.rowSuffix && !turned ? rows.map((r) => ({ ...r, suffix: options.rowSuffix![r.id] })) : rows;
  const fitRows = (maxLines: number, wider: number) => rowLabelBand(suffixed, tickFont, capW, maxLines, lineH, measure, {
    wider, target: options.target, textScale: textScaleOf(options), typeRole: 'axis',
    shrink: stepDownFont(theme, tickFont, 'axis', options.target, textScaleOf(options)),
  });
  // The grid keeps its natural 28 px per column; the band widens into the rest.
  // The note gutter is settled after the row band (its seats read the band width); the band reserves the bracket gutter.
  const rowGutter = bracketGutter ?? 0;
  const naturalWider = gutterBudget(capW, plot0.w, ROW_BAND_GAP + rowGutter + cols.length * 28 + (cols.length - 1) * CELL_GAP);
  const oneLine = card ? undefined : fitRows(cellHEst >= 2 * lineH + 4 && !(valueStyle && size.width < 480) ? 2 : 1,
    Math.max(naturalWider, gutterBudget(capW, plot0.w, ROW_BAND_GAP + rowGutter + cols.length + (cols.length - 1) * CELL_GAP)));
  const fittedRows = oneLine && !(oneLine.labels.some((label) => label.title !== undefined))
    ? oneLine : fitRows(2, naturalWider);
  // The value matrix draws a highlighted row's name bold (rowFont below): its seat and the band take the bold width.
  const rowLines = fittedRows.labels.map((label, ri) => {
    if (!valueStyle || !highlights.has(rows[ri]!.id)) return label;
    const bold = { ...label.font, weight: emphasisWeight(theme) };
    return { ...label, w: Math.max(label.w, ...label.lines.map((line) => measure(line, bold).width)) };
  });
  const rowBandW = Math.max(fittedRows.width, maxOf(rowLines.map((label) => label.w)));
  const rowSuffixShort = fittedRows.short;

  // A cell note gets a side seat only within 15% of the remaining grid width.
  const notes = annotations.filter(a => a.kind === 'callout' || a.kind === 'note');
  const noteSize = (a: Annotation, width = plot0.w, maxLines?: number) => {
    const ref = 'at' in a ? a.at : undefined;
    const ci = cols.findIndex(c => c.id === (typeof ref === 'string' ? ref : ref && 'categoryId' in ref ? ref.categoryId : undefined));
    const row = rows.find(r => typeof ref !== 'string' && ref && 'seriesId' in ref && r.id === ref.seriesId);
    const value = row?.cells[ci]?.v ?? colMeans[cols[ci]?.id ?? ''] ?? 0;
    let body = 'text' in a ? a.text ?? '${value}' : '${value}';
    // A cell value that fits is already printed; the callout omits its duplicate too.
    if (cellLabelsOn && row && (plot0.w - rowBandW - ROW_BAND_GAP) / cols.length > measure(displayFor(value, pctMatrix, null, row), labelFont).width + 6) {
      body = body.replace(/:\s*\n\$\{value\}$/, '');
    }
    const glyphRoom = ('icon' in a && a.icon) || ('status' in a && a.status) ? 29 : 0;
    const source = `${'headline' in a && a.headline !== undefined ? `${a.headline}\n` : ''}${body}`.replace(/\$\{value\}/g, displayFor(value, pctMatrix, null, row));
    const wrapped = wrapText(source, { ...labelFont, weight: emphasisWeight(theme) }, Math.max(1, width - glyphRoom), maxLines ?? Math.max(1, source.length), measure);
    const lines = wrapped.lines;
    const w = Math.max(...lines.map(line => measure(line, { ...labelFont, weight: emphasisWeight(theme) }).width));
    return { w, h: Math.max(glyphRoom ? 22 : 0, measure('0', labelFont).height * lines.length), sideW: w + (glyphRoom ? 38 : CALLOUT_SEAT), truncated: wrapped.truncated };
  };
  const noteSizes = new Map(notes.map(a => [a.id!, noteSize(a)]));
  const baseGutter = (bracketGutter ?? 0) + (bubble && options.bubble?.track ? TRACK_ROOM : 0);
  const space = plot0.w - rowBandW - ROW_BAND_GAP - baseGutter;
  const sideWrapWidth = Math.max(1, space * 0.15 / 1.15 - CALLOUT_SEAT);
  const sideSizes = new Map(notes.map(a => [a.id!, noteSize(a, sideWrapWidth, 2)]));
  let sideNotes = notes.filter(a => !forceRows.includes(a.id!) && (!('preferSide' in a) || (a.preferSide !== 'above' && a.preferSide !== 'below')));
  const sideWidth = (side: 'left' | 'right') => Math.max(0, maxOf(sideNotes.filter(a => ('preferSide' in a && a.preferSide === 'left') === (side === 'left')).map(a => sideSizes.get(a.id!)!.sideW)));
  for (let pass = 0; pass <= notes.length; pass++) {
    const budget = (space - sideWidth('left') - sideWidth('right')) * 0.15;
    const failing = sideNotes.filter(a => sideSizes.get(a.id!)!.truncated || sideSizes.get(a.id!)!.sideW > budget);
    if (failing.length === 0) break;
    const widest = failing.reduce((a, b) => noteSizes.get(a.id!)!.sideW >= noteSizes.get(b.id!)!.sideW ? a : b);
    sideNotes = sideNotes.filter(a => a !== widest);
  }
  const rowNotes = notes.filter(a => !sideNotes.includes(a));
  for (const a of rowNotes) {
    const ref = 'at' in a ? a.at : undefined;
    if (typeof ref === 'string' || !ref || !('categoryId' in ref) || !ref.seriesId || !('text' in a)) continue;
    const row = rows.find(r => r.id === ref.seriesId), col = cols.find(c => c.id === ref.categoryId);
    // The value matrix keeps the authored line breaks.
    const body = valueStyle ? (a.text ?? '${value}').replace(/[ \t]*\n[ \t]*/g, '\n') : (a.text ?? '${value}').replace(/\s*\n\s*/g, ' ');
    // Under the value matrix the row's name stands once at the left of the note row,
    // and the generated story callout names its column itself ("Aug low").
    if (a.id!.startsWith('lead:')) continue;
    const nameAtLeft = valueStyle && !('preferSide' in a && a.preferSide === 'above');
    const names = [...(nameAtLeft ? [] : [row?.label ?? ref.seriesId]), col?.label ?? ref.categoryId].filter(name => {
      const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`(?:^|[^\\p{L}\\p{N}])${literal}(?:\\s*:|$)`, 'u').test(body);
    });
    a.text = names.length ? `${names.join(' · ')}: ${body}` : body;
    noteSizes.set(a.id!, noteSize(a));
  }
  const aboveNotes = rowNotes.filter(a => 'preferSide' in a && a.preferSide === 'above');
  const belowNotes = rowNotes.filter(a => !aboveNotes.includes(a));
  const rowHeight = (items: Annotation[]) => items.reduce((sum, a) => sum + noteSizes.get(a.id!)!.h + 8, 0);
  const caretRoom = valueStyle && belowNotes.length > 0 ? CARET_ROOM : 0;
  const annotationTopH = rowHeight(aboveNotes);
  let annotationBottomH: number;
  const leftRoom = sideWidth('left'), rightRoom = sideWidth('right');
  const gutterRight = baseGutter + rightRoom + (rowNotes.length && !valueStyle ? 8 : 0);

  // ---- grid metrics ----
  // The Harvey list stands its balls at the plot edge, the names after them.
  const gridX = harveyList ? plot0.x : plot0.x + rowBandW + ROW_BAND_GAP + leftRoom;
  const gridW = harveyList ? HARVEY_LIST_CELL : Math.max(10, plot0.w - rowBandW - ROW_BAND_GAP - gutterRight - leftRoom);
  const cellW = Math.max(1, (gridW - (cols.length - 1) * CELL_GAP) / cols.length);
  const colStep = cellW + CELL_GAP;
  const colCenter = (ci: number) => gridX + ci * colStep + cellW / 2;
  // Notes under the value matrix that stand apart, each centred on its column,
  // share one row, so "−3.1 Aug low" stands beside "−2.8".
  const belowRows: Annotation[][] = [];
  /** The stretch of its row a shared note may use, so it keeps clear of its neighbour and still reaches its caret. */
  const seatBounds = new Map<Id, readonly [number, number]>();
  {
    const centreOf = (a: Annotation) => {
      const ref = 'at' in a ? a.at : undefined;
      const ci = cols.findIndex(c => typeof ref === 'object' && ref !== null && 'categoryId' in ref && c.id === ref.categoryId);
      return ci < 0 ? undefined : colCenter(ci);
    };
    const span = (a: Annotation, [lo, hi] = seatBounds.get(a.id!) ?? [gridX, plot0.x + plot0.w]) => {
      const w = noteSizes.get(a.id!)!.w, cx = centreOf(a);
      const x = cx === undefined ? lo : Math.max(lo, Math.min(cx - w / 2, hi - w));
      return [x, x + w] as const;
    };
    const seriesOfNote = (a: Annotation) => { const ref = 'at' in a ? a.at : undefined; return typeof ref === 'object' && ref !== null && 'seriesId' in ref ? ref.seriesId : undefined; };
    // A note may move along its row, away from a neighbour, while it still spans its caret.
    const seatBeside = (a: Annotation, group: Annotation[]): readonly [number, number] | undefined => {
      let bounds: readonly [number, number] = [gridX, plot0.x + plot0.w];
      const cx = centreOf(a);
      if (cx === undefined || group.some(b => seriesOfNote(b) !== seriesOfNote(a))) return undefined;
      for (const b of group) {
        const [b0, b1] = span(b), bx = centreOf(b) ?? b0;
        bounds = cx < bx ? [bounds[0], Math.min(bounds[1], b0 - 12)] : [Math.max(bounds[0], b1 + 12), bounds[1]];
      }
      const [x0, x1] = span(a, bounds);
      return x0 >= bounds[0] - 1e-6 && x1 <= bounds[1] + 1e-6 && x0 <= cx - 4 && x1 >= cx + 4 ? bounds : undefined;
    };
    for (const a of belowNotes) {
      let bounds: readonly [number, number] | undefined;
      const seat = valueStyle ? belowRows.find(group => (bounds = seatBeside(a, group)) !== undefined) : undefined;
      if (seat) { seat.push(a); seatBounds.set(a.id!, bounds!); } else belowRows.push([a]);
    }
    annotationBottomH = belowRows.reduce((sum, group) => sum + maxOf(group.map(a => noteSizes.get(a.id!)!.h)) + 8, 0) + caretRoom;
  }
  // A styled bubble row with values in its largest circles stands as tall as
  // its names and those values need; upright it may grow to 1.5 times that,
  // up to the column pitch; turned it keeps the short pitch. Without levels
  // every value may print, so a row stays as tall as the column is wide.
  // On a card a cell under 40 px keeps the tight air round its circle, as the radius below does.
  const valueCell = topOnly ? 2 * (topValueR - VALUE_OVERHANG + BUBBLE_AIR_TIGHT) : 0;
  const bubbleLo = Math.max(28, labelFont.size * 1.2 + 8, maxOf(rowLines.map((label) => label.h + 4)), valueCell < 40 && size.width < 720 ? valueCell : 2 * (topValueR - VALUE_OVERHANG + BUBBLE_AIR));
  const bubbleNaturalH = !topOnly ? Math.max(cellW, bubbleLo) : turned ? bubbleLo : Math.max(bubbleLo, Math.min(cellW, 1.5 * bubbleLo));

  // ---- column headers: the shared category cascade ----
  // The heatmap's categories are its COLUMNS, so the reference mark belongs
  // on the header, not in the row band beside the series names.
  // Matrix names are never thinned: they wrap to three
  // lines, step the font down, and rotate 45° only as the last resort. A
  // rotated name ends at its column and runs up-left over the empty corner
  // above the row labels, so it may reach no further left than the plot.
  const SIN45 = Math.SQRT1_2;
  const monthColumns = cols.every(c => MONTH_START.exec(c.label.trim())?.[0] === c.label.trim());
  // A bubble matrix whose column names cannot stand flat turns before any
  // name turns: the categories become rows when there are
  // more of them than series, and every series reads the cells one way.
  const lead = data.series[0]!;
  const turnable = (bubbleStyle || (harveyStyle && rows.length === 1)) && !turned && cols.length > rows.length && !options.bubble?.track && annotations.length === 0
    && !cols.some((c) => c.footnote !== undefined || c.date !== undefined)
    && data.series.every((s) => s.direction === lead.direction && s.format === lead.format && s.unit === lead.unit);
  const headerInput = {
    // A Harvey row plans as before and turns into its list only where its names would rotate.
    rotate: !turnable || harveyStyle,
    ordered: monthColumns,
    plotHeight: plot0.h,
    maxRotatedWidth: Math.min(Math.max(110, (plot0.h * 0.3) / SIN45), (colCenter(0) - plot0.x) / SIN45),
    target: options.target, textScale: textScaleOf(options),
    ...categoryLabelsAndMarks(cols, { count: authoredFootnoteCount(options), warnings }),
    centers: cols.map((_, ci) => colCenter(ci)),
    step: colStep,
    fonts: [tickFont, { family: theme.type.family, ...theme.type.footnote }],
    measure,
  };
  let headerPlan = planCategoryRow(headerInput);
  // The value matrix names every month by its initial (J F M ...) before it
  // thins or turns the names, so each column keeps its name.
  if (valueStyle && monthColumns && headerPlan.step !== 'fit' && !cols.some(c => c.footnote !== undefined)) {
    const initials = planCategoryRow({ ...headerInput, labels: cols.map(c => c.label.trim().charAt(0).toLocaleUpperCase(options.locale?.language)) });
    if (initials.step === 'fit') headerPlan = { ...initials, infos: initials.infos.map((info, ci) => ({ ...info, title: info.title ?? cols[ci]!.label })) };
  }
  // Count a thinned month row back from its final month with one step.
  if (monthColumns && headerPlan.step === 'stride' && !cols.some(c => c.footnote !== undefined)) {
    headerPlan.keep = cols.map((_, ci) => (cols.length - 1 - ci) % headerPlan.stride === 0);
  }
  const flatHeader = (plan: typeof headerPlan) => ['fit', 'wrap', 'font-down'].includes(plan.step) && plan.rotation === 0 && plan.maxLines <= 2;
  // A turned header that cannot stand in one row staggers its names on two
  // tiers, each name the width of two columns.
  const tierLift: number[] = cols.map(() => 0);
  let tierTicks: number[] = [];
  const tiered = (oneLine = false): boolean => {
    const font = headerPlan.font.size >= tickFont.size ? headerPlan.font : tickFont;
    const lineHt = font.size * (font.lineHeight ?? 1.2);
    // A name may take two columns; near the plot's edge it wraps to stay
    // centred, and a word wider than that ends at the edge.
    const info = (label: string, width: number) => {
      // A two-tier name wider than its own column wraps on two lines, so it does not reach
      // across the column rules beside it.
      const one = measure(label, font).width;
      if (one <= width && (oneLine || one <= colStep + 4 || !/\s/.test(label.trim()))) return { lines: [label], w: one, h: lineHt, truncated: false };
      if (one <= width) {
        const narrow = wrapText(label, font, Math.max(colStep + 4, ...label.split(/\s+/).map((word) => measure(word, font).width)), 2, measure);
        const nw = Math.max(1, ...narrow.lines.map((line) => measure(line, font).width));
        if (!narrow.truncated && narrow.lines.length === 2) return { lines: narrow.lines, w: nw, h: 2 * lineHt, truncated: false };
        return { lines: [label], w: one, h: lineHt, truncated: false };
      }
      const wrapped = wrapText(label, font, Math.max(1, width), 2, measure);
      const w = Math.max(1, ...wrapped.lines.map((line) => measure(line, font).width));
      return { lines: wrapped.lines, w, h: wrapped.lines.length * lineHt, truncated: wrapped.truncated || w > width + 1e-6 };
    };
    const twoCols = Math.min(2 * colStep, plot0.w) - 2;
    const centred = (ci: number) => 2 * Math.min(colStep, colCenter(ci) - plot0.x, plot0.x + plot0.w - colCenter(ci)) - 6;
    const widestWord = (label: string) => Math.max(1, ...label.split(/\s+/).map((word) => measure(word, font).width));
    // Either the even or the odd columns take the upper tier. A line never
    // touches text: a lower name stands between the ticks of its
    // upper neighbours, TICK_CLEAR clear of each, and wraps to stay there.
    for (const up of [0, 1]) {
      const room = (ci: number): readonly [number, number] => ci % 2 === up ? [plot0.x, plot0.x + plot0.w]
        : [ci > 0 ? colCenter(ci - 1) + TICK_CLEAR : plot0.x, ci < cols.length - 1 ? colCenter(ci + 1) - TICK_CLEAR : plot0.x + plot0.w];
      const limitOf = (ci: number) => Math.max(1, Math.min(twoCols, room(ci)[1] - room(ci)[0]));
      // Centred over its column and inside its room; a name crowding the next
      // one in its tier moves left while it still spans its column's centre.
      const xsOf = (list: ReturnType<typeof info>[]) => {
        const xs = list.map((item, ci) => Math.max(room(ci)[0], Math.min(room(ci)[1] - item.w, colCenter(ci) - item.w / 2)));
        for (let ci = list.length - 3; ci >= 0; ci--) {
          const limit = xs[ci + 2]! - TIER_NAME_GAP - list[ci]!.w;
          if (xs[ci]! > limit) xs[ci] = Math.max(room(ci)[0], colCenter(ci) - list[ci]!.w, limit);
        }
        return xs;
      };
      // Each tier's names stay a word space apart, inside their room, and none is cut.
      const apartOf = (list: ReturnType<typeof info>[], xs: number[]) => list.every((item, ci) => !item.truncated
        && xs[ci]! >= room(ci)[0] - 1e-6 && xs[ci]! + item.w <= room(ci)[1] + 1e-6
        && (ci < 2 || xs[ci]! >= xs[ci - 2]! + list[ci - 2]!.w + TIER_NAME_GAP));
      let infos = cols.map((c, ci) => info(c.label, limitOf(ci)));
      let xs = xsOf(infos);
      if (!apartOf(infos, xs)) {
        infos = cols.map((c, ci) => { const near = info(c.label, Math.min(limitOf(ci), Math.max(centred(ci), Math.min(twoCols, widestWord(c.label))))); return near.truncated ? info(c.label, limitOf(ci)) : near; });
        xs = xsOf(infos);
      }
      if (apartOf(infos, xs) && infos.every((info) => !info.truncated && (!oneLine || info.lines.length === 1))) {
        const upper = (ci: number) => ci % 2 === up;
        const tierH = [true, false].map((top) => maxOf(infos.filter((_, ci) => upper(ci) === top).map((info) => info.h)));
        cols.forEach((_, ci) => (tierLift[ci] = upper(ci) ? tierH[1]! + TIER_GAP : 0));
        tierTicks = cols.map((_, ci) => ci).filter(upper);
        const finalXs = xs;
        headerPlan = { ...headerPlan, font, infos, keep: cols.map(() => true), stride: 1, rotation: 0, warnings: [], step: 'wrap',
          maxLines: maxOf(infos.map((info) => info.lines.length)), rowHeight: tierH[0]! + TIER_GAP + tierH[1]!,
          x: (ci: number) => finalXs[ci]! };
        return true;
      }
    }
    return false;
  };
  // A wide styled bubble matrix keeps its segments as rows when its
  // touchpoint names stand on two tiers, one line each, and a column still holds a readable bubble.
  const keepUpright = bubbleStyle && turnable && !flatHeader(headerPlan) && cols.length >= 2 && colStep >= UPRIGHT_TIER_PITCH && tiered(true);
  if (turnable && !flatHeader(headerPlan) && !keepUpright) {
    return layoutHeatmap(data, { ...options, [TURNED]: true }, bracketGutter, valueNote, forceRows, compactKey);
  }
  if (turned && !flatHeader(headerPlan) && cols.length >= 2) tiered();
  // The Harvey list names its one column as a heading at the plot edge, on one line.
  if (harveyList) {
    const lineHt = tickFont.size * (tickFont.lineHeight ?? 1.2);
    const infos = cols.map((c) => ({ lines: [c.label], w: measure(c.label, tickFont).width, h: lineHt, truncated: false }));
    headerPlan = { ...headerPlan, font: tickFont, infos, keep: cols.map(() => true), stride: 1, rotation: 0, warnings: [], step: 'fit',
      maxLines: 1, rowHeight: lineHt, x: () => plot0.x };
  }
  const headerRotated = headerPlan.rotation !== 0;
  const colLines = headerPlan.infos;
  const headerFont = headerPlan.font;
  const headerLines = headerPlan.maxLines;
  const showHeaderRow = labelOn('category') && cols.length > 0;
  if (showHeaderRow) pushAll(warnings, headerPlan.warnings);
  const headerH = showHeaderRow ? headerPlan.rowHeight + HEADER_GAP : 0;
  const headerKeep = headerPlan.keep;

  // The bubble keys draw their largest circle at the matrix's own scale. The
  // strip is sized from the column pitch alone, so its height never depends
  // on the canvas height (a content-fit height round-trips).
  const keyFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const keyLineH = keyFont.size * 1.2;
  const keyTitled = options.bubble?.sizeLabel !== undefined || options.bubble?.colorLabel !== undefined;
  const styledKey = bubbleKeys && bubbleStyle ? planStyledBubbleKey() : undefined;
  const keyH = styledKey ? styledKey.height + KEY_GAP : bubbleKeys
    ? (keyTitled ? keyLineH + 4 : 0) + Math.max(hasSizes ? cellW / 2 : 0, KEY_BAR_H) + 3 + keyLineH + KEY_GAP
    : 0;
  const headerGap = harveyWide ? HARVEY_HEADER_GAP : 0;
  const headTop = plot0.y + headerGap + keyH + annotationTopH + (keyBottom ? 0 : continuousKeyH);
  const gridY = headTop + headerH;
  const gridH = plotHeightAfter(frameResult, size.height, plot0.h - headerGap - headerH - keyH - continuousKeyH - annotationTopH - annotationBottomH);
  // A dense matrix needs height for its cells more than a second key row.
  // Use measured cell sides, so a wide sparse matrix can keep its ramp.
  // The value matrix keeps its gradient key at every width.
  if (continuousKey && !keyRight && !valueStyle && cellW < 2 * measure('0', labelFont).height) {
    return layoutHeatmap(data, options, bracketGutter, valueNote, forceRows, true);
  }
  // A Harvey cell stands at most twice its ball (the ball is 0.68
  // of the cell's short side), so a pinned frame leaves room below instead of
  // stretching a 60 px ball into a 395 px cell.
  const fillH = Math.max(1, (gridH - (rows.length - 1) * CELL_GAP) / rows.length);
  // A bubble row stands at most 1.5 times the column pitch: the circle is
  // never wider than a column, so a taller row would only add air.
  const cellH = glyph === 'harvey' ? capPitch(fillH, 1, 2 * 0.68 * cellW) : bubble ? capPitch(fillH, 1, 1.5 * cellW) : fillH;
  const rowStep = cellH + CELL_GAP;
  const rowCenter = (ri: number) => gridY + ri * rowStep + cellH / 2;
  const plot: Rect = { x: gridX, y: gridY, w: gridW, h: gridH };
  // A styled value matrix row is 22 px on a card under 480 px and
  // 26 px under 720 px (28 wider), never less than a value line or its name needs.
  const rowFloor = valueStyle && size.width < 720 ? (size.width < 480 ? VALUE_ROW_CARD : VALUE_ROW_NARROW) : valueStyle && size.width >= 960 ? VALUE_ROW_WIDE : 28;
  // A value matrix whose columns hold no value even at the label floor reads from colour
  // alone, so its rows need no value line.
  const valueLineH = valueStyle && cellLabelsOn && !rows.some((r) => measureRowLabels(r.cells, (v, pct, meta) => textFor(v, pct, meta, r),
    { ...labelFont, size: readerFloorPx(options.target ?? DEFAULT_TARGET, 'label', textScaleOf(options)) }, measure, cellW, Infinity, 4).some((value) => value?.fits))
    ? 0 : labelFont.size * 1.2 + 8;
  const harveyRow = harveyList ? HARVEY_LIST_ROW : size.width >= 720 ? HARVEY_ROW : HARVEY_ROW_CARD;
  const naturalCellH = bubbleStyle ? bubbleNaturalH : harveyStyle ? Math.max(harveyRow, maxOf(rowLines.map(label => label.h + 4))) : Math.max(bubble ? cellW : 0,
    Math.max(rowFloor, valueLineH, maxOf(rowLines.map(label => label.h + 4))));
  // A row keeps 28 px. The colour key's own row, where it cannot sit beside
  // the subtitle, comes out of that, down to the value's line and 4 px above
  // and below it, so a size that held the matrix before the key holds it.
  const keyShare = ((frameResult.legendBand ?? 0) + continuousKeyH + annotationTopH + annotationBottomH) / Math.max(1, rows.length);
  // Refuse-less: at the type's hard minimum (the last fixed-slot step) a row holds its text line
  // and 2 px, not the 28 px comfort row.
  const hard = (options as { [HARD_MINIMUM]?: boolean })[HARD_MINIMUM] === true;
  const minRowH = Math.max(measure('0', labelFont).height + 2, hard ? 0 : 28 - keyShare);
  {
    const grow = rowDrivenHeight({
      options,
      width: size.width,
      height: size.height,
      chromeH: size.height - gridH,
      rowsH: rows.length * naturalCellH + (rows.length - 1) * CELL_GAP,
    });
    if (grow !== undefined) return layoutHeatmap(data, { ...options, size: { width: size.width, height: grow } }, bracketGutter, valueNote, forceRows, compactKey);
  }

  // ---- assemble scene ----
  // Cells and keys keep the same signed fill roles at every width.
  const nodes: SceneNode[] = [...frameResult.nodes];
  if (continuousKey) drawContinuousKey();
  const marks: HeatmapMarks = { cells: [] };
  const labelRequests: LabelRequest[] = [];
  const anchorCell = new Map<string, AnchorResolution>();
  const cellBoxes = new Map<string, Rect>();
  // One wash for a highlighted row or column, behind its label and in its
  // empty cells alike. The wash clears 1.2:1, where `others` sits in the
  // shipped themes, so it reads inside a cell.
  const highlightWash: Paint = {
    token: 'focus',
    theme: { kind: 'visible-tint', base: { token: 'focus' }, amount: 'surface-anchor', floor: 1.2, roundStep: true },
  };

  // highlight tints behind everything — faint column/row background, decorative.
  // On a colour scale a wash would read as data (a salmon or sage row on a
  // red-green ramp), so the highlight is an outline in the focus round the
  // row's or column's cells, drawn over them, and the cells keep their
  // colours. Harvey cells are white, so there the wash stays.
  const barHighlight = glyph !== 'harvey';
  const outlines: { id: Id; rect: Rect; owner: OwnerRef; part: 'colTint' | 'rowTint' }[] = [];
  cols.forEach((c, ci) => {
    if (!highlights.has(c.id)) return;
    const nodeId = `colTint:${c.id}`;
    if (barHighlight) {
      outlines.push({ id: nodeId, rect: { x: gridX + ci * colStep, y: gridY, w: cellW, h: gridH }, owner: colOwner(c), part: 'colTint' });
      return;
    }
    nodes.push({
      t: 'rect',
      id: nodeId,
      rect: { x: gridX + ci * colStep - 2, y: headTop, w: cellW + 4, h: headerH + gridH },
      fill: highlightWash,
      owner: { categoryId: c.id },
      part: 'colTint',
    });
  });
  rows.forEach((r, ri) => {
    if (!highlights.has(r.id)) return;
    const nodeId = `rowTint:${r.id}`;
    if (barHighlight) {
      outlines.push({ id: nodeId, rect: { x: gridX, y: gridY + ri * rowStep, w: gridW, h: cellH }, owner: rowOwner(r), part: 'rowTint' });
      return;
    }
    nodes.push({
      t: 'rect',
      id: nodeId,
      rect: { x: plot0.x, y: gridY + ri * rowStep - 2, w: rowBandW + ROW_BAND_GAP + gridW, h: cellH + 4 },
      fill: highlightWash,
      owner: { seriesId: r.id },
      part: 'rowTint',
    });
  });

  const extremeMax = allValues.length > 0 ? vMax : null;
  const extremeMin = allValues.length > 0 ? vMin : null;
  const bonus = (rowId: Id, colId: Id) =>
    highlights.has(rowId) || highlights.has(colId) ? PRIORITY.highlightBonus : 0;

  // ---- cells (marks claim occupied; harvey glyphs render over white cells) ----
  // The styled Harvey row draws its ball at 0.29 of the row (r 12 in a 42 px row).
  const harveyR = harveyStyle && !harveyList ? Math.min(cellW * 0.34, cellH * 0.286) : Math.min(cellW, cellH) * 0.34;
  // Bubble: the largest circle fills the cell's short side, so neighbours stay
  // the cell gap apart; area is proportional to the level or the size.
  const bubbleR = bubbleStyle ? Math.max(1.5, Math.min(cellW, cellH) / 2 - (Math.min(cellW, cellH) < 40 ? BUBBLE_AIR_TIGHT : BUBBLE_AIR)) : Math.min(cellW, cellH) / 2;
  const sizeMax = Math.max(0, maxOf(rows.flatMap((r) => r.cells.map((c) => c.size ?? 0))));
  const areaShare = (size: number | null): number => {
    if (!hasSizes) return 1;
    if (size === null) return 0;
    if (levels) return size / levels.length;
    return sizeMax > 0 ? size / sizeMax : 0;
  };
  const radiusOf = (size: number | null): number => {
    // Levels on the styled matrix step the radius evenly, 2 : 3 : 4 for three
    // levels, so the smallest circle still shows its colour.
    if (bubbleStyle && levels && size !== null) return size > 0 ? Math.max(1.5, (bubbleR * (size + 1)) / (levels.length + 1)) : 0;
    const share = areaShare(size);
    return share > 0 ? Math.max(1.5, bubbleR * Math.sqrt(share)) : 0;
  };
  const bubbleNodes: SceneNode[] = [];
  let missingSizes = 0;
  // The widest in-cell value, as the fit test measures it: the natural width
  // gives every column room for its numbers, so a host that draws the matrix
  // at its natural width (fit 'content') shows them instead of bare colour.
  let valueCellW = 0;
  let omittedValues = 0;
  /** The cells whose value has no room to print, in drawing order: the note names them. */
  const hiddenCells: { r: NormRow; c: NormCol; v: number }[] = [];
  // One value font for the matrix. It steps down a pixel at a time, to
  // the target's label floor, until every row fits.
  const rowValues = (font: FontSpec) => rows.map((r) => cellLabelsOn && !bubble ? measureRowLabels(r.cells, (v, pct, meta) => textFor(v, pct, meta, r), font, measure, cellW, cellH, 4) : []);
  const valueFloor = readerFloorPx(options.target ?? DEFAULT_TARGET, 'label', textScaleOf(options));
  let valueFont = labelFont;
  let fitted = rowValues(valueFont);
  while (valueFont.size > valueFloor && !fitted.every((values) => values.every((value) => value === null || value.fits))) {
    valueFont = { ...valueFont, size: Math.max(valueFloor, valueFont.size - 1) };
    fitted = rowValues(valueFont);
  }
  rows.forEach((r, ri) => {
    const values = fitted[ri]!;
    for (const value of values) if (value) valueCellW = Math.max(valueCellW, value.size.width + 4);
    cols.forEach((c, ci) => {
      const cell = r.cells[ci]!;
      const rect: Rect = { x: gridX + ci * colStep, y: gridY + ri * rowStep, w: cellW, h: cellH };
      const nodeId = `cell:${cellKey(r, c)}`;
      const owner: OwnerRef = { seriesId: seriesOf(r, c), categoryId: categoryOf(r, c) };
      const needsStroke = (glyph === 'harvey' && !(harveyStyle && cell.v !== null)) || cell.v === null;
      const valuePaint: Paint = fillPaint(cell.v, cell.meta, cellW > 12 && cellH > 12, r.direction);
      let paint: Paint = bubble && !cell.meta?.fill ? { token: 'background' } : valuePaint;
      // css is taken from the data paint BEFORE the highlight-band override
      // below — auto-ink contrasts against the value color, not the wash.
      const css = paintColor(theme, paint);
      const insidePaint = paint;
      // highlighted row/col: background cells take the band's wash, otherwise the
      // opaque cell covers the band and the highlight reads label-only
      // (the band node alone is not enough)
      if (
        !barHighlight &&
        'token' in paint &&
        paint.token === 'background' &&
        !paint.tint &&
        (highlights.has(r.id) || highlights.has(c.id))
      ) {
        paint = highlightWash;
      }
      const noData = hatchMissing && cell.v === null && !cell.meta?.fill;
      // A blank cell keeps the grid stroke and the dash. Force the background
      // so a highlight wash does not colour a cell that has no value.
      const blankCell = missingLook === 'blank' && cell.v === null && !cell.meta?.fill && missingCells;
      const low = !bubble && cell.v !== null && lowBase(cell);
      nodes.push({
        t: 'rect',
        id: nodeId,
        rect,
        fill: noData ? NO_DATA_PAINT : blankCell ? { token: 'background' } : paint,
        ...(noData || low ? { pattern: 'hatch45' as const, hatchGround: { token: 'background' } as Paint } : {}),
        ...(needsStroke ? { stroke: { token: 'grid' } as Paint, strokeWidth: strokeToken(theme, 'hair') } : {}),
        owner,
        part: 'cell',
        display:
          cell.v === null
            ? { state: 'No data' }
            : { value: displayFor(cell.v, cell.pct, cell.meta, r) },
      });
      occupied.claim(rect, 'mark', owner);
      marks.cells.push({ seriesId: seriesOf(r, c), categoryId: categoryOf(r, c), rect, nodeId, value: cell.v });
      cellBoxes.set(`${categoryOf(r, c)}:${seriesOf(r, c)}`, rect);
      if (cell.v !== null) anchorCell.set(`${categoryOf(r, c)}:${seriesOf(r, c)}`, {
        x: rect.x + rect.w / 2, y: rect.y + rect.h / 2,
        value: cell.v, format: r.format, date: c.date, label: c.label, owner,
        // A comparison between cells of one row is a bracket beside that row.
        row: { y: rect.y, h: rect.h, end: gridX + gridW },
      });

      // harvey ball: ring first (white circle, outlined), quarter-fill wedge on top
      if (glyph === 'harvey' && cell.v !== null) {
        const q = Math.max(0, Math.min(4, Math.round(levelOf(cell.v))));
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        nodes.push({
          t: 'circle',
          id: `harveyRing:${r.id}:${c.id}`,
          cx,
          cy,
          r: harveyR,
          fill: { token: 'background' },
          // The styled ring takes the fill's colour.
          stroke: harveyStyle ? semanticPalettePaint(theme, options.palette, 'sequential') : { token: 'neutralMark' }, strokeWidth: strokeToken(theme, 'mark'),
          owner,
          part: 'harveyRing',
        });
        if (q >= 4) {
          nodes.push({
            t: 'circle',
            id: `harveyFill:${r.id}:${c.id}`,
            cx,
            cy,
            r: harveyR,
            fill: semanticPalettePaint(theme, options.palette, 'sequential'),
            owner,
            part: 'harveyFill',
          });
        } else if (q > 0) {
          nodes.push({
            t: 'path',
            id: `harveyFill:${r.id}:${c.id}`,
            d: harveyWedgePath(cx, cy, harveyR, q),
            fill: semanticPalettePaint(theme, options.palette, 'sequential'),
            owner,
            part: 'harveyFill',
          });
        }
      }

      if (bubble) {
        bubbleCell(r, c, cell, rect, owner, valuePaint, css);
        return;
      }
      const value = values[ci];
      if (value?.fits) {
        const { text, size: tsize } = value;
        const basePriority =
          cell.v !== null && (cell.v === extremeMax || cell.v === extremeMin)
            ? PRIORITY.extreme
            : PRIORITY.interior + Math.min(99, Math.abs(cell.v ?? 0));
        labelRequests.push({
          id: `point:${r.id}:${c.id}`,
          kind: 'point',
          typeRole: 'label',
          owner,
          text,
          lines: [text],
          font: valueFont,
          ...(valueFont !== labelFont ? { fontStep: valueFont } : {}),
          priority: cell.meta?.priority ?? basePriority + bonus(r.id, c.id),
          candidates: [
            {
              slot: 'insideCenter',
              rect: {
                x: rect.x + rect.w / 2 - tsize.width / 2,
                y: rect.y + rect.h / 2 - tsize.height / 2,
                w: tsize.width,
                h: tsize.height,
              },
              penalty: 0,
              insideFill: low ? paintColor(theme, { token: 'background' }) : css,
              insidePaint: low ? { token: 'background' } : insidePaint,
            },
          ],
        });
      } else if (cellLabelsOn && cell.v !== null) {
        omittedValues++;
        hiddenCells.push({ r, c, v: cell.v });
      }
    });
  });

  if (missingSizes > 0) warnings.push({ code: 'bubble-size-missing', severity: 'warn', message: `${missingSizes} cell${missingSizes === 1 ? ' has' : 's have'} a value but no size, so no circle is drawn`, suggest: 'give every cell with a value a size' });
  // A row track runs behind its circles, through their centres, to an arrow past the last column.
  if (bubble && options.bubble?.track) {
    const tip = gridX + gridW + TRACK_ROOM - 1;
    rows.forEach((r, ri) => {
      const y = round2(rowCenter(ri));
      const owner = { seriesId: r.id };
      nodes.push({ t: 'line', id: `track:${r.id}`, x1: round2(colCenter(0)), y1: y, x2: round2(tip - 5), y2: y, stroke: { token: 'neutralMark', tint: 0.5 }, width: strokeToken(theme, 'rule'), owner, part: 'track' });
      nodes.push({ t: 'path', id: `trackArrow:${r.id}`, d: arrowHeadPath({ x: tip, y }, 0, 6), fill: { token: 'neutralMark', tint: 0.5 }, owner, part: 'track' });
    });
  }
  pushAll(nodes, bubbleNodes);
  if (styledKey) nodes.push(...styledKey.draw());
  else if (bubbleKeys) nodes.push(...bubbleKeyNodes());
  // Rules above and below the styled bubble and Harvey matrices, across the plot.
  if (bubbleStyle || harveyStyle) {
    const bottom = gridY + rows.length * rowStep - CELL_GAP;
    for (const [id, y] of [['rule:top', gridY - 1], ['rule:bottom', bottom + 1]] as const) {
      nodes.push({ t: 'line', id, x1: round2(plot0.x), y1: round2(y), x2: round2(plot0.x + plot0.w), y2: round2(y), stroke: { token: 'grid' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'gridline' });
    }
    // A staggered header's upper names reach the grid with a hairline tick.
    for (const ci of tierTicks) {
      const x = round2(colCenter(ci));
      nodes.push({ t: 'line', id: `tierTick:${cols[ci]!.id}`, x1: x, y1: round2(headTop + headerH - HEADER_GAP - tierLift[ci]! + 1), x2: x, y2: round2(gridY - 2), stroke: { token: 'leader', tint: 0.5 }, width: strokeToken(theme, 'hair'), owner: colOwner(cols[ci]!), part: 'gridline' });
    }
  }

  // when larger target type cannot print cell values, disclose the loss in static output.
  // Cohort owns its more specific rate disclosure.
  // The note names the hidden values (up to the shared note limit), and the value
  // matrix prints the story value, its highlighted row's extreme, as a callout under the grid.
  if (options.heatKey === undefined && omittedValues > 0 && valueNote === undefined) {
    const lead = valueStyle ? leadCallout() : undefined;
    const next = lead ? { ...options, annotations: [...(options.annotations ?? []), lead] } : options;
    return layoutHeatmap(data, next, bracketGutter, hiddenValuesNote(lead), forceRows, compactKey);
  }

  // ---- row labels (left band, right-aligned toward the grid) ----
  // The value matrix sets a highlighted row's name bold.
  function rowFont(id: Id | undefined): FontSpec {
    return valueStyle && id !== undefined && highlights.has(id) ? { ...tickFont, weight: emphasisWeight(theme) } : tickFont;
  }
  if (labelOn('series')) {
    rows.forEach((r, ri) => {
      const rl = rowLines[ri]!;
      labelRequests.push({
        id: rowLabelId(r),
        kind: turned ? 'category' : 'series',
        owner: rowOwner(r),
        text: r.label,
        ...fittedLabel(rl, tickFont),
        font: rowFont(r.id),
        priority: PRIORITY.endpoint + (highlights.has(r.id) ? PRIORITY.highlightBonus : 0),
        candidates: [
          {
            slot: 'left',
            // The bubble matrix sets its row names at the plot edge.
            rect: { x: harveyList ? gridX + gridW + KEY_TEXT_GAP + 5 : bubbleStyle || harveyStyle ? plot0.x : plot0.x + rowBandW - rl.w, y: rowCenter(ri) - rl.h / 2, w: rl.w, h: rl.h },
            penalty: 0,
          },
        ],
      });
    });
  }

  // ---- column headers ----
  if (showHeaderRow) {
    cols.forEach((c, ci) => {
      const cl = colLines[ci]!;
      labelRequests.push({
        id: colLabelId(c),
        kind: turned ? 'series' : 'category',
        typeRole: 'axis',
        owner: colOwner(c),
        text: c.label,
        lines: cl.lines,
        ...categoryLineAlign(headerPlan, ci),
        ...(cl.title !== undefined ? { title: cl.title } : {}),
        font: headerFont,
        priority: PRIORITY.endpoint + (highlights.has(c.id) ? PRIORITY.highlightBonus : 0),
        redundant: !headerKeep[ci],
        ...(headerRotated ? { rotate: 45 } : {}),
        candidates: headerRotated ? [{ slot: 'top', rect: rotatedClaimRect(colCenter(ci), headTop + headerH - HEADER_GAP - headerFont.size * (headerFont.lineHeight ?? 1.2) * (1 - SIN45 / 2), headerFont.size * (headerFont.lineHeight ?? 1.2)), penalty: 0 }] : [
          {
            slot: 'top',
            rect: {
              x: harveyList ? plot0.x : headerPlan.x(ci),
              y: headTop + headerH - HEADER_GAP - cl.h - tierLift[ci]!,
              w: cl.w,
              h: cl.h,
            },
            penalty: 0,
          },
        ],
      });
    });
  }

  // ---- solve labels ----
  // The highlight outlines lie over the cells they frame, each one
  // closed path just outside its cells, so no side can go missing and a row
  // frame and a column outline that share an edge draw it once.
  // The value matrix frames its highlight at the mark weight (1.25 px on a
  // narrow card), so the story row reads first on any ramp.
  // It keeps the theme's focus colour.
  const outlineW = valueStyle ? size.width < 400 ? 1.25 : strokeToken(theme, 'mark') : strokeToken(theme, 'hair');
  for (const outline of outlines) {
    const { x, y, w, h } = outline.rect;
    const t = valueStyle ? outlineW / 2 + 0.75 : outlineW / 2;
    // The stroke stays on the canvas: at margin 0 the grid ends at its edge.
    const e = outlineW / 2;
    const [x0, y0, x1, y1] = [Math.max(e, x - t), Math.max(e, y - t), Math.min(size.width - e, x + w + t), Math.min(size.height - e, y + h + t)]
      .map((v) => Math.round(v * 100) / 100);
    nodes.push({
      t: 'path', id: outline.id, d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z`, stroke: { token: 'focus' }, width: outlineW,
      owner: outline.owner, part: outline.part,
    });
  }

  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 2,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);

  // ---- annotation pass: {categoryId, seriesId} → cell center;
  //      categoryId alone → column top center (value = column mean) ----
  const resolve = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    if (norm.seriesId) {
      const cell = anchorCell.get(`${norm.categoryId}:${norm.seriesId}`);
      // The cell's own value label, when it was drawn: a note on it need not repeat it.
      const printed = solved.placed.find((label) => label.id === `point:${norm.seriesId}:${norm.categoryId}` && !label.hidden);
      return cell && printed ? { ...cell, printed: { text: printed.text, box: cellBoxes.get(`${norm.categoryId}:${norm.seriesId}`)! } } : cell ?? null;
    }
    const ci = cols.findIndex((c) => c.id === norm.categoryId);
    const mean = colMeans[norm.categoryId];
    if (ci < 0 || mean === null || mean === undefined) return null;
    return {
      x: colCenter(ci),
      y: gridY,
      value: mean, date: cols[ci]!.date, label: cols[ci]!.label,
      owner: { categoryId: norm.categoryId },
    };
  };
  const brackets = marginBracketLayout(theme, { right: gridX + gridW + BRACKET_CLEAR });
  const calloutRows = new Map<string, Rect>();
  for (const [groups, start] of [[aboveNotes.map(a => [a]), plot0.y + keyH + (keyBottom ? 0 : continuousKeyH)], [belowRows, gridY + gridH + caretRoom]] as const) {
    let y = start + 4;
    for (const group of groups) {
      const h = maxOf(group.map(a => noteSizes.get(a.id!)!.h));
      for (const a of group) {
        const [lo, hi] = seatBounds.get(a.id!) ?? [gridX, plot0.x + plot0.w];
        calloutRows.set(a.id!, valueStyle ? { x: lo, y, w: hi - lo, h } : { x: plot0.x, y, w: plot0.w, h });
      }
      y += h + 8;
    }
  }
  const annResult = runAnnotatePass({
    annotations,
    resolve,
    defaultSpan: cols.length >= 2 ? { from: cols[0]!.id, to: cols[cols.length - 1]!.id } : undefined,
    comparisonLayout: brackets,
    occupied,
    plot: { x: gridX, y: gridY, w: gridW + gutterRight, h: gridH },
    gridCallouts: { rows: calloutRows, widths: new Map(sideNotes.map(a => [a.id!, sideWrapWidth])), bounds: { ...plot0 }, grid: plot, sideLimit: gridW * 0.15 },
    theme,
    measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    solveCtx,
  });
  const failedSideNotes = sideNotes.filter(a => annResult.labels.some(l => l.owner.annotationId === a.id && l.hidden !== undefined));
  if (failedSideNotes.length) return layoutHeatmap(data, options, bracketGutter, valueNote, [...forceRows, ...failedSideNotes.map(a => a.id!)], compactKey);
  pushAll(warnings, annResult.warnings);
  // A row note names its cell; a leader around other rows would look like another outline.
  for (const a of rowNotes) {
    const label = annResult.labels.find(l => l.owner.annotationId === a.id && !l.hidden);
    const ref = 'at' in a ? a.at : undefined;
    if (!label || typeof ref === 'string' || !ref || !('categoryId' in ref) || !ref.seriesId) continue;
    const cell = cellBoxes.get(`${ref.categoryId}:${ref.seriesId}`);
    if (!cell) continue;
    const above = label.rect.y < gridY;
    if (valueStyle && !above) {
      // A caret under the anchored column points the note at its cell.
      const cx = round2(cell.x + cell.w / 2), cy = round2(gridY + gridH + 3);
      annResult.nodes.push({ t: 'path', id: `ann:${a.id}:caret`, d: `M${cx} ${cy}l-3.5 5h7z`, fill: { token: 'ink' }, owner: { annotationId: a.id }, part: 'calloutArrow' });
      annResult.placed.find(p => p.id === a.id)?.nodeIds.push(`ann:${a.id}:caret`);
      delete label.leader;
      continue;
    }
    const routeX = gridX + gridW + 4;
    const tailX = label.rect.x + label.rect.w / 2;
    const tailY = above ? label.rect.y + label.rect.h + 4 : label.rect.y - 4;
    const edge = { x: cell.x + cell.w, y: cell.y + cell.h };
    if ('arrow' in a && a.arrow && !('icon' in a && a.icon) && !('status' in a && a.status)) {
      const tip = { x: edge.x + 4, y: edge.y };
      const endX = tip.x + arrowShaftEnd(4, strokeToken(theme, 'rule'));
      const ids = new Set(annResult.placed.find(p => p.id === a.id)?.nodeIds ?? []);
      annResult.nodes = annResult.nodes.filter(n => !ids.has(n.id));
      const owner = { annotationId: a.id };
      annResult.nodes.push(
        { t: 'path', id: `ann:${a.id}:rowArrow`, d: `M${tailX} ${tailY}L${routeX} ${tailY}L${routeX} ${edge.y}L${endX} ${edge.y}`, stroke: { token: 'ink' }, width: strokeToken(theme, 'rule'), owner, part: 'calloutArrow' },
        { t: 'path', id: `ann:${a.id}:rowHead`, d: arrowHeadPath(tip, Math.PI, 4), fill: { token: 'ink' }, owner, part: 'calloutArrow' },
      );
      const placed = annResult.placed.find(p => p.id === a.id)!;
      placed.nodeIds = [`ann:${a.id}:rowArrow`, `ann:${a.id}:rowHead`];
      for (const [a, b] of [[{ x: tailX, y: tailY }, { x: routeX, y: tailY }], [{ x: routeX, y: tailY }, { x: routeX, y: edge.y }], [{ x: routeX, y: edge.y }, { x: endX, y: edge.y }]]) {
        occupied.claim({ x: Math.min(a!.x, b!.x) - 0.5, y: Math.min(a!.y, b!.y) - 0.5, w: Math.abs(a!.x - b!.x) + 1, h: Math.abs(a!.y - b!.y) + 1 }, 'annotation', owner, 'calloutArrow');
      }
      delete label.leader;
    } else {
      delete label.leader;
    }
  }
  // A side note on the value matrix takes a short leader from its cell's edge.
  if (valueStyle) for (const a of sideNotes) {
    const label = annResult.labels.find(l => l.owner.annotationId === a.id && !l.hidden);
    const ref = 'at' in a ? a.at : undefined;
    if (!label || typeof ref === 'string' || !ref || !('categoryId' in ref) || !ref.seriesId || ('arrow' in a && a.arrow)) continue;
    const cell = cellBoxes.get(`${ref.categoryId}:${ref.seriesId}`);
    if (!cell) continue;
    const y = round2(cell.y + cell.h / 2);
    const right = label.rect.x >= cell.x + cell.w;
    const x1 = round2(right ? cell.x + cell.w : cell.x);
    const x2 = round2(right ? label.rect.x - 4 : label.rect.x + label.rect.w + 4);
    if (Math.abs(x2 - x1) >= 4 && label.rect.y <= y && label.rect.y + label.rect.h >= y) {
      label.leader = { d: `M${x1} ${y}H${x2}`, curved: false };
      label.halo = false;
    }
  }
  // A comparison bracket measures its own gutter for one further pass.
  const reach = brackets.need().right > 0 ? BRACKET_CLEAR + brackets.need().right : 0;
  if (bracketGutter === undefined && reach > gutterRight + 0.5) {
    return layoutHeatmap(data, options, Math.ceil(Math.min(reach, plot0.w * 0.35)), valueNote, forceRows, compactKey);
  }

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  pushAll(nodes, annResult.nodes);
  const nullCellLabels = new Set(rows.flatMap((r) => r.cells.flatMap((cell, ci) => (cell.v === null ? [`label:point:${cellKey(r, cols[ci]!)}`] : []))));
  const rowNoteAlign = new Map<string, { align: 'start' | 'middle' | 'end'; x: number }>();
  if (valueStyle) for (const a of belowNotes) {
    const label = annResult.labels.find(l => l.owner.annotationId === a.id && !l.hidden && l.rect.y >= gridY + gridH);
    if (!label || label.lines.length < 2) continue;
    const { x, w } = label.rect;
    const align = x + w >= plot0.x + plot0.w - 0.5 ? 'end' : x <= gridX + 0.5 ? 'start' : 'middle';
    rowNoteAlign.set(`label:${label.id}`, { align, x: round2(align === 'end' ? x + w : align === 'start' ? x : x + w / 2) });
  }
  // The row a note row speaks of stands once at its left, in the row band.
  const namedRows = new Set<Id>();
  if (valueStyle) for (const group of belowRows) {
    const ref = group.map(a => ('at' in a ? a.at : undefined)).find(r => typeof r === 'object' && r !== null && 'seriesId' in r && r.seriesId !== undefined) as { seriesId: Id } | undefined;
    const row = ref && rows.find(r => r.id === ref.seriesId);
    const top = minOf(group.flatMap(a => annResult.labels.filter(l => l.owner.annotationId === a.id && !l.hidden).map(l => l.rect.y)));
    if (!row || !Number.isFinite(top) || namedRows.has(row.id)) continue;
    namedRows.add(row.id);
    // A highlighted row needs no second name: its bold label and frame already
    // point the callout at it, and a lone name under the grid would read as
    // one more row.
    if (highlights.has(row.id)) continue;
    nodes.push({ t: 'text', id: `noteRow:${row.id}`, x: round2(plot0.x + rowBandW), y: round2(top), lines: [row.label], align: 'end', font: labelFont, ink: { token: 'inkMuted' }, typeRole: 'label', owner: { seriesId: row.id }, part: 'annotation' });
  }
  // A wrapped row label is right-aligned line by line to the grid edge.
  const labelRects = new Map(allLabels.map((label) => [`label:${label.id}`, label.rect]));
  const rowBandIds = new Set(rows.map((r) => rowLabelId(r)));
  const headerIds = new Set(cols.map((c) => colLabelId(c)));
  // The column heads print in the table family's head ink; a highlighted or emphasised head keeps its own.
  const headInk = tableHeadInk();
  const headCols = new Map(cols.map((c) => [colLabelId(c), c.id]));
  for (const label of allLabels) {
    const col = headCols.get(label.id);
    if (col !== undefined && !highlights.has(col) && !label.emphasis && plainInk(label.ink)) label.ink = headInk;
  }
  pushAll(nodes, labelsToNodes(theme, allLabels, (l) =>
      headerIds.has(l.id) ? headerFont : rowBandIds.has(l.id) ? rowFont(l.owner.seriesId) : l.kind === 'point' && bubbleStyle ? valueLabelFont : (l.owner.annotationId && annotations.some(a => a.id === l.owner.annotationId && (a.kind === 'cagr' || a.kind === 'diff'))) ? { ...labelFont, weight: emphasisWeight(theme) } : labelFont, nodes,
    ).map((node): SceneNode => node.t === 'text' && !bubbleStyle && !harveyStyle && node.part === 'series' && node.lines.length > 1 && node.align === 'start'
      ? { ...node, align: 'end', x: labelRects.get(node.id)!.x + labelRects.get(node.id)!.w }
      // A note row under the value matrix aligns its lines on the caret.
      : node.t === 'text' && rowNoteAlign.has(node.id) ? { ...node, ...rowNoteAlign.get(node.id)! }
      // A missing value's dash is quieter than any value.
      : node.t === 'text' && node.part === 'point' && node.lines.length === 1 && node.lines[0] === '–' && nullCellLabels.has(node.id)
        ? { ...node, ink: { token: 'inkMuted' } } : node));
  const placedAnnotations: PlacedAnnotation[] = annResult.placed;

  const scaleWord = glyph === 'harvey' ? chartString(options, 'harveyBallName') : bubble ? chartString(options, 'bubbleScaleWord', { v1: hasSizes ? chartString(options, 'circleAreaSize') : '' }) : scale === 'discrete' ? chartString(options, 'discrete') : chartString(options, 'continuous');
  // The per-row pole inversion is an ENCODING, so it is stated in words —
  // hue must not carry it alone (same discipline as variance's
  // "(lower is better)" suffix and column sign-color legends).
  const invertedRows = valence || (bins && declaredDirections) ? dataRows.filter((r) => r.direction === 'lowerIsBetter') : [];
  const a11yDesc =
    chartString(options, 'heatmapDescStart', { v1: scaleWord, v2: dataRows.length, v3: dataCols.length }) +
    (allValues.length > 0 ? chartString(options, 'valuesRange', { v1: fmt(vMin), v2: fmt(vMax) }) : '') +
    (invertedRows.length > 0
      ? chartString(options, 'invertedRowsDesc', { v1: invertedRows.map((r) => r.label).join(', ') })
      : '') +
    chartString(options, 'rowMeansSentence', { v1: dataRows.map((r) => { const mean = rowMeans[r.id]; return `${r.label} ${mean === null || mean === undefined ? NOT_AVAILABLE : fmt(mean)}`; }).join(', ') })
    // The reading lists every value the cells could not print.
    + (hiddenCells.length > 0 && options.heatKey === undefined
      ? ` ${(options as { strings?: { hiddenLabels?: string } }).strings?.hiddenLabels ?? HIDDEN_LABEL_LEAD}: ${hiddenCells.map(hiddenItem).join(', ')}.` : '');

  return {
    type: 'heatmap',
    size,
    sizing: rowSizing('heatmap', size, {
      chromeH: size.height - gridH,
      minimumRowsH: rows.length * Math.max(minRowH, maxOf(rowLines.map((label) => label.h))) + (rows.length - 1) * CELL_GAP,
      naturalRowsH: rows.length * naturalCellH + (rows.length - 1) * CELL_GAP,
      ...withSuffixFloor(
        // A staggered header name spans two columns.
        // The Harvey list needs its ball column and its widest name beside it.
        harveyList ? (() => {
          const w = size.width - plot0.w + gridW + KEY_TEXT_GAP + 5 + Math.max(0, maxOf(rowLines.map((label) => label.w)), maxOf(colLines.map((label) => label.w - gridW - KEY_TEXT_GAP - 5)));
          return { minWidth: w, naturalWidth: w };
        })() : matrixWidths(size.width - gridW, cols.length, CELL_GAP, colLines.map((label) => (tierTicks.length ? label.w / 2 : label.w)), valueCellW),
        size.width,
        rowSuffixShort,
      ),
    }),
    plot,
    scene: nodes,
    labels: allLabels,
    axes: [
      {
        axis: 'x',
        ticks: cols.map((c, ci) => ({ at: c.id, pos: colCenter(ci), labelId: colLabelId(c) })),
      },
      {
        axis: 'y',
        ticks: rows.map((r, ri) => ({ at: r.id, pos: rowCenter(ri), labelId: rowLabelId(r) })),
      },
    ],
    annotations: placedAnnotations,
    frame: frameResult.frame,
    ...(frameResult.legend ? { legend: frameResult.legend } : {}),
    marks,
    derived: {
      max: cleanFloat(vMax),
      min: cleanFloat(vMin),
      rowMeans,
      colMeans,
      ...(showHeaderRow
        ? {
            tickBand: {
              reserved: headerH,
              measuredLines: headerLines,
              lineHeight: headerFont.size * 1.2,
              extra: headerPlan.rowHeight - headerLines * headerFont.size * 1.2,
              dateNumeric: headerPlan.dateNumeric,
              position: 'above' as const,
            },
          }
        : {}),
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'heatmapTitle', { v1: dataRows.length, v2: dataCols.length })),
      counts: [structureCount('rows', dataRows.length, undefined, options), structureCount('columns', dataCols.length, undefined, options)],
      desc: a11yDesc,
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annResult.decisions],
    },
  };

  // ---- helpers ----

  /**
   * The story value of a value matrix with one highlighted row: that row's
   * value farthest from zero, when its cell cannot print it and no authored
   * note points at it. It takes a callout under the grid, "−3.1" over
   * "Aug low".
   */
  function leadCallout(): Annotation | undefined {
    const marked = rows.filter((r) => highlights.has(r.id));
    if (marked.length !== 1 || turned) return undefined;
    const row = marked[0]!;
    let best: { ci: number; v: number } | undefined;
    row.cells.forEach((cell, ci) => {
      if (cell.v !== null && (best === undefined || Math.abs(cell.v) > Math.abs(best.v))) best = { ci, v: cell.v };
    });
    if (!best) return undefined;
    const col = cols[best.ci]!;
    if (!hiddenCells.some((h) => h.r === row && h.c === col)) return undefined;
    const authored = annotations.some((a) => 'at' in a && typeof a.at === 'object' && a.at !== null && 'seriesId' in a.at && a.at.seriesId === row.id && 'categoryId' in a.at && a.at.categoryId === col.id);
    if (authored) return undefined;
    const known = row.cells.flatMap((cell) => (cell.v === null ? [] : [cell.v]));
    const low = best.v === minOf(known);
    return {
      kind: 'callout', id: `lead:${row.id}:${col.id}`, at: { seriesId: row.id, categoryId: col.id },
      headline: '${value}', text: chartString(options, low ? 'heatmapLeadLow' : 'heatmapLeadHigh', { v1: col.label }), preferSide: 'below',
    } as Annotation;
  }

  /** One hidden value as the note and the reading name it: "Iberia Aug −3.1". */
  function hiddenItem(h: { r: NormRow; c: NormCol; v: number }): string {
    const cell = h.r.cells[cols.indexOf(h.c)]!;
    return `${h.r.label} ${h.c.label} ${textFor(h.v, cell.pct, cell.meta, h.r) ?? displayFor(h.v, cell.pct, cell.meta, h.r)}`;
  }

  /**
   * The note for the hidden values: the matrix's extremes
   * first, where hidden, then the rest in order; the first 8 by name, then
   * "and N more". `notes.maxListed` wins; 0 counts them against all values
   * ("15 of 96 values"). The reading lists every hidden value.
   */
  function hiddenValuesNote(lead: Annotation | undefined): string {
    const heading = (options as { strings?: { hiddenLabels?: string } }).strings?.hiddenLabels ?? HIDDEN_LABEL_LEAD;
    // The story value the callout prints under the grid is on the chart: the
    // note does not name or count it; the reading keeps it.
    const leadAt = lead && 'at' in lead && typeof lead.at === 'object' && 'seriesId' in lead.at ? lead.at as { seriesId: Id; categoryId: Id } : undefined;
    const unprinted = hiddenCells.filter((h) => !(leadAt && h.r.id === leadAt.seriesId && h.c.id === leadAt.categoryId));
    const leads = unprinted.length <= DEFAULT_NOTE_LIMIT ? [] : [vMin, vMax].flatMap((extreme) => unprinted.filter((cell) => cell.v === extreme).slice(0, 1));
    return valueNoteLine(heading, [...new Set([...leads, ...unprinted])].map(hiddenItem), options, allValues.length)[0] ?? '';
  }

  /**
   * Swatches of the ramp the cells use, each named by the value it paints:
   * the rating levels on the discrete ladder; the lowest and highest value
   * with round steps between them (and zero on a signed scale) otherwise. A
   * matrix with a lower-is-better row paints a verdict rather than a value,
   * so its key names the verdict.
   */
  function drawContinuousKey(): void {
    const low = keyLow, high = keyHigh;
    // A short bar under the subtitle: round ticks on a
    // 1-2-2.5-5 ladder, each a third of a step clear of the ends, signed on a
    // good/bad scale, the saturated end as '≥', and the unit after the bar.
    const short = !keyRight;
    const step = short ? keyStep((high - low) / 4 || 1) : niceStep((high - low) / 3 || 1);
    const ticks = [low];
    for (let v = Math.ceil(low / step) * step; v < high - step * 1e-9; v += step) {
      if (short ? v - low > step / 3 && high - v > step / 3 : v > low + step * 1e-9) ticks.push(Number(v.toPrecision(12)));
    }
    if (high > low) ticks.push(high);
    const textOf = short ? (v: number) => {
      const text = keyText(v).replace(/^>=/, '≥').replace(/^<=/, '≤');
      if (v === 0 && !pctMatrix && !options.format && !keySeries?.format) return formatAutomaticNumber(0, { locale: options.locale?.language, decimals: 0 });
      // A format that signs its own values ("+0.0%") already printed the plus.
      return valence && v > 0 ? text.replace(/^(≥?)(?![+≥])/, '$1+') : text;
    } : keyText;
    const font = tickFont;
    const left = short ? 0 : measure(textOf(low), font).width / 2;
    const right = short ? 0 : measure(textOf(high), font).width / 2;
    const unitText = short && options.unit ? options.unit : undefined;
    const unitW = unitText ? measure(unitText, font).width + 8 : 0;
    const x = keyRight ? plot0.x + plot0.w + KEY_GAP : plot0.x + left;
    const y = keyRight ? plot0.y + measure(textOf(high), font).height / 2
      : (keyBottom ? plot0.y + plot0.h - continuousKeyH + KEY_GAP : plot0.y) + unitRise;
    const w = keyRight ? KEY_BAR_H : short ? Math.max(1, Math.min(plot0.w - unitW, 240, Math.max(168, plot0.w * 0.45))) : Math.max(1, plot0.w - left - right);
    const h = keyRight ? Math.max(1, plot0.h - measure(textOf(high), font).height) : KEY_BAR_H;
    const length = keyRight ? h : w;
    const at = (v: number) => (keyRight ? y + h : x) + (high > low ? (v - low) / (high - low) * length : length / 2) * (keyRight ? -1 : 1);
    const slices = Math.max(1, Math.ceil(length / 2));
    for (let i = 0; i < slices; i++) nodes.push({
      t: 'rect', id: `scale:ramp:${i}`, rect: keyRight
        ? { x, y: y + h - (i + 1) * h / slices, w, h: h / slices + (i < slices - 1 ? 0.5 : 0) }
        : { x: x + i * w / slices, y, w: w / slices + (i < slices - 1 ? 0.5 : 0), h },
      fill: fillPaint(low + (high - low) * (i + 0.5) / slices, null, true), owner: {}, part: 'swatch',
    });
    const requests: LabelRequest[] = ticks.map((v, i) => {
      const text = textOf(v), size = measure(text, font);
      const pos = at(v);
      nodes.push({ t: 'line', id: `scale:tick:${i}`,
        ...(keyRight ? { x1: x + w, x2: x + w + 3, y1: pos, y2: pos }
          : { x1: pos, x2: pos, y1: y + h, y2: y + h + 3 }),
        stroke: { token: 'inkMuted' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'legendTick' });
      return { id: `scale:tickLabel:${i}`, kind: 'scale', owner: {}, text, lines: [text], typeRole: 'axis', font, fontStep: font,
        priority: i === 0 || i === ticks.length - 1 ? PRIORITY.reference : PRIORITY.endpoint,
        candidates: [{ slot: 'key', penalty: 0, rect: keyRight ? { x: x + w + 6, y: pos - size.height / 2, w: size.width, h: size.height }
          : { x: short && i === 0 ? pos : short && i === ticks.length - 1 ? pos - size.width : pos - size.width / 2, y: y + h + 6, w: size.width, h: size.height } }] };
    });
    if (unitText) nodes.push({ t: 'text', id: 'scale:unit', x: round2(x + w + 8), y: round2(y + h / 2 - measure(unitText, font).height / 2), lines: [unitText], align: 'start', font, ink: { token: 'ink' }, typeRole: 'axis', owner: {}, part: 'legendHeading' });
    const keyRect = keyRight ? { x: x - KEY_GAP, y: plot0.y, w: keyRightW, h: plot0.h }
      : { x: plot0.x, y: y - unitRise, w: plot0.w, h: continuousKeyH - KEY_GAP };
    const keyClaims = createOccupiedIndex(keyRect);
    const solvedKey = solveLabels(requests, keyClaims, { measure, density: 'full', pins: {}, plot: keyRect, labelPad: 2 });
    nodes.push(...labelsToNodes(theme, solvedKey.placed, () => font).map(n => n.t === 'text' ? { ...n, part: 'legendLabel' } : n));
    occupied.claim(keyRect, 'legend', {});
    const items = solvedKey.placed.filter(l => !l.hidden).map(l => ({ id: l.id, swatchNodeId: 'scale:ramp:0', labelId: `label:${l.id}` }));
    if (frameResult.legend) frameResult.legend.items.push(...items);
    else frameResult.legend = { rect: keyRect, items };
  }

  /** A round key step on the 1-2-2.5-5 ladder. */
  function keyStep(raw: number): number {
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const base = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / base;
    return (m <= 1 + 1e-9 ? 1 : m <= 2 + 1e-9 ? 2 : m <= 2.5 + 1e-9 ? 2.5 : m <= 5 + 1e-9 ? 5 : 10) * base;
  }

  function colourScaleKey(): LegendItemInput[] {
    const pale = (paint: Paint) => (('tint' in paint && (paint.tint ?? 0) >= 0.8) || ('token' in paint && paint.token === 'background')
      ? { stroke: { token: 'neutralMark' } as Paint } : {});
    const item = (id: string, label: string, paint: Paint): LegendItemInput => ({ id: `scale:${id}`, label, paint, ...pale(paint) });
    const keyFormat = (value: number) => displayFor(value, pctMatrix, null, keySeries);
    if (bins) {
      return bins.slice(1).map((hi, i) => item(String(i), numberRange(keyFormat(bins[i]!), keyFormat(hi)), binPaint(i, true, rows[0]?.direction)));
    }
    if (scale === 'discrete') {
      if (valence) return [-valenceSpan, -valenceSpan / 2, 0, valenceSpan / 2, valenceSpan].map((v, i) => item(String(i), keyFormat(v), fillPaint(v, null, true)));
      const step = (vMax - vMin) / 5;
      return LADDER_PAINTS.map((paint, level) => item(String(level),
        isRatingScale ? keyFormat(level) : numberRange(keyFormat(vMin + level * step), keyFormat(level === 4 ? vMax : vMin + (level + 1) * step)), paint));
    }
    if (valence && rows.some((r) => r.direction === 'lowerIsBetter')) {
      // The poles show the verdict at full strength: probe values of ±1
      // painted near white whenever the matrix reached past ±1.
      return [item('worse', 'Worse', valencePaint('bad', true, 0)), item('even', 'Even', fillPaint(0, null, true)), item('better', 'Better', valencePaint('good', true, 0))];
    }
    // Round values strictly between two ends, a third of a step clear of both.
    const between = (from: number, to: number, step: number) => {
      const out: number[] = [];
      for (let k = Math.ceil(from / step); k * step < to; k++) {
        const v = Number((k * step).toPrecision(12));
        if (v - from > step / 3 && to - v > step / 3) out.push(v);
      }
      return out;
    };
    const signedStep = niceStep(Math.max(-negMin, posMax) / 2);
    // Under a cap the key names where the scale saturates and nothing beyond.
    const stops = cap !== undefined ? [...new Set([keyLow, ...(keyLow < 0 && keyHigh > 0 ? [0] : []), keyHigh])] : valence
      ? [...(negMin < 0 ? [negMin, ...between(negMin, 0, signedStep)] : []), 0, ...(posMax > 0 ? [...between(0, posMax, signedStep), posMax] : [])]
      : [vMin, ...between(vMin, vMax, niceStep((vMax - vMin) / 3)), vMax];
    const seen = new Set<string>();
    return stops.flatMap((v, i) => {
      const label = keyText(v);
      if (seen.has(label)) return [];
      seen.add(label);
      return [item(String(i), label, fillPaint(v, null, true))];
    });
  }

  /**
   * One bubble: a circle in the cell's colour (hatched for a low base) at the
   * area its size asks for, and its value inside the circle or beside it in
   * the cell where either fits.
   */
  function bubbleCell(r: NormRow, c: NormCol, cell: NormRow['cells'][number], rect: Rect, owner: OwnerRef, paint: Paint, css: string): void {
    if (cell.v === null) return;
    const radius = radiusOf(cell.size);
    if (radius === 0) {
      if (hasSizes && cell.size === null) missingSizes++;
      return;
    }
    const cx = round2(rect.x + rect.w / 2);
    const cy = round2(rect.y + rect.h / 2);
    const rr = round2(radius);
    const low = lowBase(cell);
    bubbleNodes.push(low
      ? { t: 'path', id: `bubble:${cellKey(r, c)}`, d: `M${round2(cx - rr)} ${cy}A${rr} ${rr} 0 1 0 ${round2(cx + rr)} ${cy}A${rr} ${rr} 0 1 0 ${round2(cx - rr)} ${cy}Z`, fill: paint, pattern: 'hatch45', stroke: paint, width: strokeToken(theme, 'mark'), owner, part: 'bubble' }
      : { t: 'circle', id: `bubble:${cellKey(r, c)}`, cx, cy, r: rr, fill: paint, owner, part: 'bubble' });
    if (!cellLabelsOn) return;
    if (topOnly && cell.size !== levels!.length) return;
    const text = textFor(cell.v, cell.pct, cell.meta, r);
    if (!text) return;
    const tsize = measure(text, valueLabelFont);
    // Inside when the text box, with a pixel of air, lies within the circle;
    // the styled matrix measures the figures' height, not the line box.
    const inside = bubbleStyle ? valueRadius(text) <= radius + VALUE_OVERHANG : Math.hypot(tsize.width / 2 + 1, tsize.height / 2 + 1) <= radius;
    const besideX = cx + radius + 2;
    const beside = !inside && besideX + tsize.width <= rect.x + rect.w && tsize.height <= rect.h;
    if (!inside && !beside) {
      omittedValues++;
      hiddenCells.push({ r, c, v: cell.v });
      return;
    }
    const insideFill = low ? paintColor(theme, { token: 'background' }) : css;
    labelRequests.push({
      id: `point:${cellKey(r, c)}`,
      kind: 'point',
      typeRole: 'label',
      owner,
      text,
      lines: [text],
      font: valueLabelFont,
      priority: cell.meta?.priority ?? (cell.v === extremeMax || cell.v === extremeMin ? PRIORITY.extreme : PRIORITY.interior + Math.min(99, Math.abs(cell.v))) + bonus(r.id, c.id),
      candidates: [inside
        ? { slot: 'insideCenter', rect: { x: cx - tsize.width / 2, y: cy - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0, insideFill, insidePaint: low ? { token: 'background' } : paint }
        : { slot: 'right', rect: { x: besideX, y: cy - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0 }],
    });
  }

  /** Round stops between the lowest and the highest value, a third of a step clear of both ends, each label once. */
  function continuousStops(): number[] {
    const step = niceStep((vMax - vMin) / 3 || 1);
    const stops = [vMin];
    for (let k = Math.ceil(vMin / step); k * step < vMax; k++) {
      const v = Number((k * step).toPrecision(12));
      if (v - vMin > step / 3 && vMax - v > step / 3) stops.push(v);
    }
    if (vMax > vMin) stops.push(vMax);
    const seen = new Set<string>();
    return stops.filter((v) => !seen.has(keyText(v)) && !!seen.add(keyText(v)));
  }

  /**
   * The styled bubble keys, left-aligned above the matrix:
   * the colour classes as dots with their names in one row, then the sizes as
   * full circles at the matrix's radii in the neutral class colour, each with
   * its name to the right. The two keys stand side by side where they fit and
   * stack otherwise. The strip's height comes from the column pitch and the
   * natural row pitch, never from the canvas height.
   */
  function planStyledBubbleKey(): { height: number; draw: () => SceneNode[] } {
    const sizeLabel = options.bubble?.sizeLabel;
    const colorLabel = options.bubble?.colorLabel;
    const ink: Paint = { token: 'inkMuted' };
    const textW = (t: string) => measure(t, keyFont).width;
    const keyFormat = (value: number) => displayFor(value, pctMatrix, null, keySeries);
    const direction = rows[0]?.direction;
    // '30–50%': a percent range names its unit once.
    const range = (lo: number, hi: number) => {
      const [a, b] = [keyFormat(lo), keyFormat(hi)];
      return numberRange(a.endsWith('%') && b.endsWith('%') ? a.slice(0, -1) : a, b);
    };
    // Colour classes: authored bins as '<b1', 'b1–b2', '≥bk'; otherwise the cells' own ramp.
    const colours: { id: string; label: string; paint: Paint; stroke?: Paint; hatch?: boolean }[] = bins
      ? bins.slice(1).map((hi, i) => ({
        id: `scale:bin:${i}`,
        label: bins.length === 2 ? range(bins[0]!, hi) : i === 0 ? `<${keyFormat(hi)}` : i === bins.length - 2 ? `≥${keyFormat(bins[i]!)}` : range(bins[i]!, hi),
        paint: binPaint(i, true, direction),
      }))
      : continuousStops().map((v, i) => ({ id: `scale:bin:${i}`, label: keyText(v), paint: fillPaint(v, null, true, direction) }));
    if (anyLowBase) colours.push({ id: 'scale:lowBase', label: lowBaseKey, paint: semanticPalettePaint(theme, options.palette, 'neutralMark', 0.55), hatch: true });
    const rEst = Math.max(1.5, Math.min(cellW, bubbleNaturalH) / 2 - (Math.min(cellW, bubbleNaturalH) < 40 ? BUBBLE_AIR_TIGHT : BUBBLE_AIR));
    const largest = Math.max(0, maxOf(rows.flatMap((r) => r.cells.map((c) => c.size ?? 0))));
    const sizeEntries = !hasSizes ? [] : levels
      ? levels.map((label, i) => ({ label, level: i + 1, r: Math.max(1.5, (rEst * (i + 2)) / (levels.length + 1)) }))
      : (() => {
        const sizeMax = largest;
        const large = niceBelow(sizeMax)[0];
        const small = large === undefined ? undefined : niceBelow(large / 4)[0];
        return [small, large].filter((v): v is number => v !== undefined && v > 0)
          .map((v) => ({ label: formatAutomaticNumber(v, { locale: options.locale?.language }), level: v, r: Math.max(1.5, rEst * Math.sqrt(sizeMax > 0 ? v / sizeMax : 0)) }));
      })();
    const headH = keyTitled ? keyLineH + 4 : 0;
    const colourEntryW = colours.map((c) => 2 * KEY_DOT_R + KEY_TEXT_GAP + textW(c.label));
    const colourW = Math.max(colorLabel ? textW(colorLabel) : 0, colourEntryW.reduce((a, w) => a + w, 0) + KEY_ENTRY_GAP * Math.max(0, colours.length - 1));
    const colourH = Math.max(2 * KEY_DOT_R, keyLineH);
    const sizeEntryW = sizeEntries.map((e) => 2 * e.r + KEY_TEXT_GAP + textW(e.label));
    const sizeW = sizeEntries.length ? Math.max(sizeLabel ? textW(sizeLabel) : 0, sizeEntryW.reduce((a, w) => a + w, 0) + KEY_ENTRY_GAP * Math.max(0, sizeEntries.length - 1)) : 0;
    const sizeH = sizeEntries.length ? Math.max(keyLineH, ...sizeEntries.map((e) => 2 * e.r)) : 0;
    const beside = sizeEntries.length === 0 || colourW + KEY_GROUP_GAP + sizeW <= plot0.w;
    const height = beside ? headH + Math.max(colourH, sizeH) : headH + colourH + 8 + headH + sizeH;
    const draw = (): SceneNode[] => {
      const out: SceneNode[] = [];
      const top = plot0.y + annotationTopH;
      const text = (id: string, line: string, tx: number, cy: number): SceneNode =>
        ({ t: 'text', id, x: round2(tx), y: round2(cy - keyLineH / 2), lines: [line], align: 'start', font: keyFont, ink, typeRole: 'axis', owner: { seriesId: id }, part: id.endsWith('Title') ? 'legendHeading' : 'legendLabel' });
      const circle = (id: string, cx: number, cy: number, rr: number, paint: Paint, hatch?: boolean, stroke?: Paint): SceneNode => hatch
        ? { t: 'path', id, d: `M${round2(cx - rr)} ${round2(cy)}A${round2(rr)} ${round2(rr)} 0 1 0 ${round2(cx + rr)} ${round2(cy)}A${round2(rr)} ${round2(rr)} 0 1 0 ${round2(cx - rr)} ${round2(cy)}Z`, fill: paint, pattern: 'hatch45', stroke: paint, width: strokeToken(theme, 'mark'), owner: { seriesId: id }, part: 'swatch' }
        : { t: 'circle', id, cx: round2(cx), cy: round2(cy), r: round2(rr), fill: paint, ...(stroke ? { stroke, strokeWidth: strokeToken(theme, 'hair') } : {}), owner: { seriesId: id }, part: 'swatch' };
      // Colour classes.
      if (colorLabel) out.push(text('scale:colorTitle', colorLabel, plot0.x, top + keyLineH / 2));
      const colourRowH = beside ? Math.max(colourH, sizeH) : colourH;
      let cy = top + headH + colourRowH / 2;
      let x = plot0.x;
      colours.forEach((c, i) => {
        out.push(circle(c.id, x + KEY_DOT_R, cy, KEY_DOT_R, c.paint, c.hatch, c.stroke));
        out.push(text(`scale:label:${c.id.replace(/^scale:/, '')}`, c.label, x + 2 * KEY_DOT_R + KEY_TEXT_GAP, cy));
        x += colourEntryW[i]! + KEY_ENTRY_GAP;
      });
      // Sizes, at the radii the matrix draws (never larger than the strip holds).
      if (sizeEntries.length) {
        const sx = beside ? plot0.x + colourW + KEY_GROUP_GAP : plot0.x;
        const sTop = beside ? top : top + headH + colourH + 8;
        if (sizeLabel) out.push(text('scale:sizeTitle', sizeLabel, sx, sTop + keyLineH / 2));
        cy = sTop + headH + (beside ? colourRowH : sizeH) / 2;
        x = sx;
        const neutral = semanticPalettePaint(theme, options.palette, 'neutralMark', 0.55);
        sizeEntries.forEach((e, i) => {
          const rr = Math.min(e.r, radiusOf(e.level));
          out.push(circle(`scale:size:${i}`, x + e.r, cy, rr, neutral));
          out.push(text(`scale:sizeLabel:${i}`, e.label, x + 2 * e.r + KEY_TEXT_GAP, cy));
          x += sizeEntryW[i]! + KEY_ENTRY_GAP;
        });
      }
      occupied.claim({ x: plot0.x, y: top, w: plot0.w, h: height }, 'legend', {});
      return out;
    };
    return { height, draw };
  }

  /**
   * The bubble keys, right-aligned above the column headers: half circles at
   * the matrix's own scale with their level or size under each, then the
   * colour bar with its break values under it. Text sits in the key font.
   */
  function bubbleKeyNodes(): SceneNode[] {
    const out: SceneNode[] = [];
    const titleFont: FontSpec = { ...keyFont };
    const titleH = keyTitled ? keyLineH + 4 : 0;
    const sizeLabel = options.bubble?.sizeLabel;
    const colorLabel = options.bubble?.colorLabel;
    // Size entries: every level, or a round size near the largest and one near a quarter of it.
    const sizeEntries = !hasSizes ? [] : levels
      ? levels.map((label, i) => ({ label, r: radiusOf(i + 1) }))
      : (() => {
        const large = niceBelow(sizeMax)[0];
        const small = large === undefined ? undefined : niceBelow(large / 4)[0];
        return [small, large].filter((v): v is number => v !== undefined && v > 0).map((v) => ({ label: formatAutomaticNumber(v, { locale: options.locale?.language }), r: radiusOf(v) }));
      })();
    const rKey = Math.max(0, ...sizeEntries.map((e) => e.r));
    const baseline = headTop - KEY_GAP - 3 - keyLineH;
    const top = baseline - Math.max(rKey, KEY_BAR_H) - titleH;
    const widths = sizeEntries.map((e) => Math.max(2 * e.r, measure(e.label, keyFont).width));
    const sizeW = Math.max(widths.reduce((a, w) => a + w, 0) + 12 * Math.max(0, widths.length - 1), sizeLabel ? measure(sizeLabel, titleFont).width : 0);
    // Colour bar: authored bins with widths in proportion to their spans, or the continuous ramp in five steps.
    const edges = bins ?? [0, 1, 2, 3, 4, 5].map((k) => vMin + ((vMax - vMin) * k) / 5);
    const span = edges.at(-1)! - edges[0]! || 1;
    const shown = bins ?? [vMin, vMax];
    const edgeText = shown.map((v) => displayFor(v, pctMatrix, null, keySeries));
    const barW = Math.max(120, Math.min(200, cellW * 3));
    const colorW = Math.max(barW + measure(edgeText[0]!, keyFont).width / 2 + measure(edgeText.at(-1)!, keyFont).width / 2, colorLabel ? measure(colorLabel, titleFont).width : 0);
    const lowR = 6;
    const lowW = anyLowBase ? 16 + 2 * lowR + 4 + measure(lowBaseKey, keyFont).width : 0;
    const total = (sizeEntries.length > 0 ? sizeW + KEY_GROUP_GAP : 0) + Math.max(colorW, barW + measure(edgeText[0]!, keyFont).width / 2 + measure(edgeText.at(-1)!, keyFont).width / 2 + lowW);
    let x = Math.max(plot0.x, gridX + gridW - total);
    const text = (id: string, line: string, tx: number, ty: number, align: 'start' | 'middle', font: FontSpec, part: string): SceneNode =>
      ({ t: 'text', id, x: round2(tx), y: round2(ty), lines: [line], align, font, ink: { token: 'ink' }, typeRole: 'axis', owner: { seriesId: id }, part });
    if (sizeEntries.length > 0) {
      if (sizeLabel) out.push(text('scale:sizeTitle', sizeLabel, x, top, 'start', titleFont, 'legendHeading'));
      let ex = x;
      sizeEntries.forEach((e, i) => {
        const cx = ex + widths[i]! / 2;
        const rr = round2(e.r);
        out.push({ t: 'path', id: `scale:size:${i}`, d: `M${round2(cx - rr)} ${round2(baseline)}A${rr} ${rr} 0 0 1 ${round2(cx + rr)} ${round2(baseline)}Z`, fill: { token: 'neutralMark', tint: 0.4 }, owner: { seriesId: `scale:size:${i}` }, part: 'swatch' });
        out.push(text(`scale:sizeLabel:${i}`, e.label, cx, baseline + 3, 'middle', keyFont, 'legendLabel'));
        ex += widths[i]! + 12;
      });
      x += sizeW + KEY_GROUP_GAP;
    }
    if (colorLabel) out.push(text('scale:colorTitle', colorLabel, x, top, 'start', titleFont, 'legendHeading'));
    const barX = x + measure(edgeText[0]!, keyFont).width / 2;
    const at = (v: number) => barX + ((v - edges[0]!) / span) * barW;
    edges.slice(1).forEach((hi, i) => {
      const lo = edges[i]!;
      out.push({
        t: 'rect', id: `scale:bin:${i}`, rect: { x: round2(at(lo)), y: round2(baseline - KEY_BAR_H), w: round2(at(hi) - at(lo)), h: KEY_BAR_H },
        fill: bins ? binPaint(i, true, rows[0]?.direction) : fillPaint((lo + hi) / 2, null, true, rows[0]?.direction), owner: { seriesId: `scale:bin:${i}` }, part: 'swatch',
      });
    });
    // Break values under the bar; one that would touch its left neighbour is left out, the ends always print.
    let lastRight = -Infinity;
    shown.forEach((v, i) => {
      const w = measure(edgeText[i]!, keyFont).width;
      const left = at(v) - w / 2;
      if (left < lastRight + 4 && i !== shown.length - 1) return;
      out.push(text(`scale:break:${i}`, edgeText[i]!, at(v), baseline + 3, 'middle', keyFont, 'legendLabel'));
      lastRight = left + w;
    });
    if (anyLowBase) {
      // The low-base key: a hatched circle as the marks draw it, named by its threshold.
      const lx = barX + barW + measure(edgeText.at(-1)!, keyFont).width / 2 + 16 + lowR;
      const ly = round2(baseline - KEY_BAR_H / 2);
      out.push({ t: 'path', id: 'scale:lowBase', d: `M${round2(lx - lowR)} ${ly}A${lowR} ${lowR} 0 1 0 ${round2(lx + lowR)} ${ly}A${lowR} ${lowR} 0 1 0 ${round2(lx - lowR)} ${ly}Z`, fill: { token: 'neutralMark' }, pattern: 'hatch45', stroke: { token: 'neutralMark' }, width: strokeToken(theme, 'mark'), owner: { seriesId: 'scale:lowBase' }, part: 'swatch' });
      out.push(text('scale:lowBaseLabel', lowBaseKey, lx + lowR + 4, ly - keyLineH / 2, 'start', keyFont, 'legendLabel'));
    }
    occupied.claim({ x: Math.max(plot0.x, gridX + gridW - total), y: top, w: total, h: headTop - KEY_GAP - top }, 'legend', {});
    return out;
  }

  function textFor(v: number, pct: boolean, meta: CellMeta | null, series?: NormRow): string | null {
    if (meta?.label === false) return null;
    const base = displayFor(v, pct, meta, series);
    return typeof meta?.label === 'string' ? meta.label.replace(/\$\{value\}/g, base) : base;
  }

  function displayFor(v: number, pct: boolean, meta: CellMeta | null, series?: NormRow): string {
    if (meta?.format) return (meta as CellMeta & AutomaticFormatSource)[AUTOMATIC_FORMAT]
      ? formatNonzeroWithSpec(v, { ...exampleSpec(meta.format, options.locale?.language), automatic: true })
      : formatterFromExample(meta.format, options.locale?.language)(v);
    const format = series?.format || series?.unit ? formats.forSeries(series) : fmt;
    const text = format(v);
    const example = series?.format ?? options.format;
    return pct && (!example || specUnitKind(parseFormatExample(example)) === 'number') ? `${text}%` : text;
  }
}

/** Measure every eligible cell before deciding whether a row can show its values. */
function measureRowLabels(
  cells: NormRow['cells'], textFor: (v: number, pct: boolean, meta: CellMeta | null) => string | null,
  font: FontSpec, measure: TextMeasurer, width: number, height: number, air = 2,
) {
  return cells.map((cell) => {
    const text = cell.meta?.label === false ? null : cell.v === null ? '–' : textFor(cell.v, cell.pct, cell.meta);
    if (!text) return null;
    const size = measure(text, font);
    // A pixel of air each side, across as up and down; the 2 px gap between
    // cells keeps neighbouring values apart. At 2 px a side a minus sign would
    // keep Italy and Iberia blank on the compact card ("−1.4" is 24.8 px in a
    // 26.9 px cell at the 10 px label floor).
    // A target fits each cell on its own, so neighbours in a row keep the
    // 6 px a reader needs between values: 2 px of air each side plus the gap.
    return { text, size, fits: size.width + air <= width && size.height + 2 <= height };
  });
}
