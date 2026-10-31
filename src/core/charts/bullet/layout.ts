import { chartString } from '../../strings/bullet';
import { breakUnsupported } from '../chartEnv';
import { labelOn as chartLabelOn } from '../labelOn';
import { structureCount } from '../../structureCounts';
import { bulletBandPaints } from '../../colorRecipes';
import { bandFor } from '../../bandSelect';
/**
 * Bullet chart — the bullet-graph form, horizontal KPI rows:
 * qualitative band rects (tint ladder of neutral, poor→good), a dark
 * measure bar (~40% of row height) from zero, a vertical target tick, the
 * value label (right-aligned in one column right of the bands, under the
 * head Actual where the target columns print),
 * and a semantic delta capsule right of each row ('+7 vs target', tone by
 * `direction` — 'lowerIsBetter' inverts for cost rows). Two x-scale modes
 * (`sharedScale`): rows normalized each to its own zero-based extent (the
 * bullet-graph percent-of-scale — the default when every row declares bands and the rows
 * differ in unit or thresholds, because KPI rows then usually mix units), or
 * one shared nice domain across all rows (the default otherwise; zero always
 * included). Designed for 6–10 rows on the
 * 'dashboard' preset (registry default). Authored qualitative labels render
 * once in a compact legend; unlabeled bands remain backward-compatible but
 * emit an honesty warning unless visible copy explains them.
 */

import type { AnchorResolution } from '../../annotate';
import { BAND_PAD } from '../../annotateParts';
import { runAnnotatePass } from '../../annotatePass';
import { categoryTargetFields, spliceAnnotationNodes } from '../../annotateFields';
import { applyValueAxisTitleInk, layoutValueAxis, planValueAxisTitle, valueAxisTitleRequest } from '../../axis';
import { contrastRatio } from '../../color';
import { formatAutomaticNumber, formatAutomaticPercent, MINUS } from '../../format';
import { formatterFromExample, parseFormatExample } from '../../formatSpec';
import { cleanDiff, rectContains, rectsOverlap, rowLabelX, type Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { REFERENCE_LABEL_CLEARANCE, separationStroke } from '../../markVisibility';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SolveCtx,
} from '../../label/solver';
import { accessibleTitle, MAGNITUDE_CEILING, NormalizeError, resolveHighlight, resolveSize, resolveSubtitle } from '../../normalize/shared';
import { applyAxisBounds, bandScale, linearScale, niceDomain, type BandScale, type LinearScale } from '../../scale';
import { readerFloorPx, textScaleOf } from '../../typeFloors';
import { cardFrameTheme, cardSize } from '../sparkline/layout';
import { frameTextOptions, normalizeLegendOption, solveFrame, type FrameInput, type LegendItemInput, plotHeightAfter, authoredFootnoteCount, authoredNotes } from '../../frame';
import { defaultMeasurer, type FontSpec } from '../../text';
import {
  contrastInkPaint,
  markRolePaint,
  mixedPaint,
  paintColor,
  resolveSemanticPaletteTheme,
  resolveTheme,
  semanticPalettePaint,
  signedFillPaint,
  emphasisWeight,
  secondaryType,
  strokeToken,
  } from '../../theme';
import type { Theme, TypeRoleName } from '../../types/theme';
import type { AnchorRef, Annotation } from '../../types/annotations';
import { valueLineExtent } from '../../valueLineDomain';
import {
  cellMeta,
  cellValue,
  isPctCell,
  type CellMeta,
  type ComparisonDirection,
  type Id,
  type OwnerRef,
} from '../../types/cell';
import { warnMissingValue } from '../../dataGaps';
import type { BulletData, BulletRow } from '../../types/data';
import type { BulletOptions, LabelKind, LegendOptions } from '../../types/options';
import type {
  Geometry,
  LintWarning,
  Paint,
  PlacedAnnotation,
  PlacedLabel,
  SceneNode,
  SeparationRule,
} from '../../types/scene';
import { rowDrivenHeight } from '../../rowCanvas';
import { rowLabelBand } from '../../label/rowLabels';
import { fittedLabel, gutterBudget, stepDownFont } from '../../label/rowFit';
import { chartSizing, heightOmitted, rowSizing } from '../../sizing';
import { DEFAULT_TARGET, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { compactBulletRefusals } from './refusals';
import { asColumnHeads, columnHeadFont, fitHead, headRequest } from './columnHead';
import { layoutTargetScale, targetBandLegendItems, targetWord, type TargetScaleRow } from './targetScale';
import type { OccupiedIndex } from '../../label/occupied';
import type { Margin } from '../../geometry';
import type { TextMeasurer } from '../../text';
import { autoDecimals } from '../../formatPrecision';
import { composedTextRole } from '../../textRole';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface BulletMarks {
  rows: {
    id: Id;
    /** Qualitative band rects, ascending (poor→good range order as authored). */
    bandNodeIds: Id[];
    /** Absent when the row's value is null (bands/target still render). */
    barNodeId?: Id;
    targetNodeId?: Id;
    /** Full row extent across the row's value scale. */
    rect: Rect;
  }[];
}

export interface BulletDerived {
  /** value − target per row (rows with both defined), rounded to 2 decimals. */
  deltaVsTarget: Record<Id, number>;
  /**
   * The row's value in percent of its target (actual ÷ target, in every
   * direction), rounded to 2 decimals; only on the percent-of-target scale.
   */
  percentOfTarget?: Record<Id, number>;
}

interface NormRow {
  id: Id;
  label: string;
  date?: string;
  value: number | null;
  isPct: boolean;
  meta: CellMeta | null;
  target: number | null;
  bands: NormBand[];
  direction: ComparisonDirection;
}

interface NormBand {
  to: number;
  label?: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

const LABEL_GAP = 5;
/** Air between the rightmost mark and the value column. */
const VALUE_COL_GAP = 6;
const CAT_BAND_GAP = 10;
const CAPSULE_GAP = 8;
/** Target and gap columns: plot to the first column, between the columns, and between two lines of one cell. */
const COLUMNS_GAP = 18;
const COLUMN_GAP = 16;
const LINE_GAP = 1;
/** Rows that name their bands: band height (natural, and at most in a tall fixed frame), air between rows, the most a row may take, the edge tick. */
const ROW_BAND = 30;
const ROW_BAND_MAX = 56;
const ROW_AIR = 16;
const ROW_PITCH_MAX = 240;
const EDGE_TICK = 3;
/** Measure bar height as a fraction of the band (row) height: one third. */
const BAR_FRACTION = 1 / 3;
/** Row names print at the weight of the percent-of-target rows' names. */
const NAME_WEIGHT = 600;
const BANDS_UNEXPLAINED =
  'qualitative bands carry meaning the reader cannot decode — label the bands or explain them in a footnote';

// Poor approaches neutral without matching the measure bar; good uses neutralLight.
function bandAmount(row: NormRow, index: number, count: number): number {
  const semanticIndex = row.direction === 'lowerIsBetter' ? count - 1 - index : index;
  return count === 1 ? 0.5 : semanticIndex / (count - 1);
}

function bandLadder(theme: Theme, count: number, palette: string | undefined, warnings: LintWarning[], light: boolean): Paint[] {
  const measure = semanticPalettePaint(theme, palette, 'neutral');
  const good = semanticPalettePaint(theme, palette, 'neutralLight');
  const poor = mixedPaint(measure, good, 0.75);
  return bulletBandPaints(theme, count, poor, good, warnings, light).map((paint, index) => ({
    token: 'token' in paint ? paint.token : 'neutral',
    theme: { kind: 'bullet-band', poor, good, count, index, ...(light ? { light: true as const } : {}) },
  }));
}

/** The bar takes its outline only when it misses 3:1 against a band it lies on (`bands`: the bands under the bar). */
function measureStyle(theme: Theme, fill: Paint, bands: readonly Paint[]): { fill: Paint; stroke?: Paint; strokeWidth?: number; separation: SeparationRule } {
  const css = paintColor(theme, fill);
  const backing = bands.reduce((nearest, band) => {
    const candidate = paintColor(theme, band);
    return contrastRatio(css, candidate) < contrastRatio(css, nearest) ? candidate : nearest;
  }, theme.color.background);
  return { fill, ...separationStroke(css, backing, theme), separation: { fill, backing: { token: 'background' }, alternateBackings: bands } };
}

function legendItemsForBands(rows: NormRow[], paint: (row: NormRow, index: number) => Paint): LegendItemInput[] {
  const byLabel = new Map<string, LegendItemInput & { amount: number }>();
  for (const row of rows) {
    row.bands.forEach((band, index) => {
      if (!band.label) return;
      const signature = JSON.stringify([band.label, paint(row, index)]);
      if (byLabel.has(signature)) return;
      const amount = bandAmount(row, index, row.bands.length);
      byLabel.set(signature, {
        id: `band:${band.label}${[...byLabel.values()].some(item => item.label === band.label) ? ':' + index : ''}`,
        label: band.label,
        paint: paint(row, index),
        key: 'box',
        amount,
      });
    });
  }
  return [...byLabel.values()]
    .sort((a, b) => a.amount - b.amount || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    .map(({ amount: _amount, ...item }) => item);
}

const RAMP_WORD_KEYS = [
  ['worseCapital', 'betterCapital'],
  ['worseCapital', 'middle3', 'betterCapital'],
  ['worseCapital', 'lowerMiddle', 'upperMiddle', 'betterCapital'],
  ['worseCapital', 'lowerMiddle', 'middle5', 'upperMiddle', 'betterCapital'],
] as const;

/**
 * The worse-to-better key: one entry for each band, worst first. It applies when every
 * banded row has the same 2 to 5 bands, no band has a tone and no row is neutral.
 * `auto` also needs both directions and a label on more than one shade (the 5 entries
 * in 2 shades that positional labels give); everything else keeps the labels key.
 */
function rampApplies(rows: NormRow[]): boolean {
  const banded = rows.filter((row) => row.bands.length > 0);
  const n = banded[0]?.bands.length ?? 0;
  return banded.length > 0 && n >= 2 && n <= 5 && banded.every((row) => row.bands.length === n
    && row.direction !== 'neutral' && row.bands.every((band) => !band.tone));
}

function rampKey(rows: NormRow[], options: BulletOptions, paint: (row: NormRow, index: number) => Paint, labelsKey: LegendItemInput[], warnings: LintWarning[]): LegendItemInput[] | undefined {
  // Names that cannot print on their rows fall back to the key 'auto' would choose.
  const mode = options.bandKey === 'row' ? 'auto' : options.bandKey ?? 'auto';
  if (mode === 'labels') return undefined;
  const banded = rows.filter((row) => row.bands.length > 0);
  const applies = rampApplies(rows);
  if (mode === 'ramp' && !applies) {
    warnings.push({
      code: 'band-key-ramp-unavailable', severity: 'warn',
      message: 'bandKey ramp needs the same 2 to 5 bands on every banded row, no band tone and no neutral row; the key keeps the band labels',
      suggest: "Give the banded rows the same band count, or set bandKey to 'labels' or 'auto'.",
    });
  }
  if (!applies) return undefined;
  const bothWays = banded.some((row) => row.direction === 'lowerIsBetter') && banded.some((row) => row.direction === 'higherIsBetter');
  const labels = labelsKey.map((item) => item.label);
  if (mode === 'auto' && !(bothWays && new Set(labels).size < labels.length)) return undefined;
  return rampItems(rows, options, paint);
}

/** One key entry for each band, worst first, in the shades of a higher-is-better row. */
function rampItems(rows: NormRow[], options: BulletOptions, paint: (row: NormRow, index: number) => Paint): LegendItemInput[] {
  const banded = rows.filter((row) => row.bands.length > 0);
  const n = banded[0]!.bands.length;
  const authored = options.strings?.bandKey;
  const words = authored?.length === n ? authored : RAMP_WORD_KEYS[n - 2]!.map(key => chartString(options, key));
  // The key reads like a higher-is-better row: shade i is band i, worst first.
  const reference = banded.find((row) => row.direction === 'higherIsBetter') ?? banded[0]!;
  return words.map((label, index) => ({
    id: `band:ramp:${index}`,
    label,
    paint: paint(reference.direction === 'higherIsBetter' ? reference : { ...reference, direction: 'higherIsBetter' }, index),
    key: 'box' as const,
  }));
}

/**
 * An attainment band paints each row good or bad against its plan; the key
 * names both tones, and a lower-is-better plan says so.
 */
function attainmentKey(options: BulletOptions): LegendItemInput[] {
  const band = (options.annotations ?? []).find((ann) => ann.kind === 'band' && ann.style === 'attainment');
  if (!band || band.kind !== 'band') return [];
  const lower = band.direction === 'lowerIsBetter';
  const target = targetWord(options);
  return [
    // The key draws the band's own fill.
    { id: 'attainment:good', label: lower ? chartString(options, 'bulletBelowLower', { v1: target }) : chartString(options, 'aboveTarget', { v1: target }), paint: signedFillPaint('good') },
    { id: 'attainment:bad', label: lower ? chartString(options, 'aboveTarget', { v1: target }) : chartString(options, 'belowTarget', { v1: target }), paint: signedFillPaint('bad') },
  ];
}

function hasBandExplanation(options: BulletOptions): boolean {
  if (authoredNotes(options).some((footnote) => footnote.trim().length > 0)) return true;
  const subtitle = resolveSubtitle(options.subtitle);
  if (!subtitle) return false;
  const text = [subtitle.company, subtitle.measure, subtitle.period].filter(Boolean).join(' ');
  const namesEncoding = /\b(?:bands?|ranges?|thresholds?|grey|gray)\b/i.test(text);
  const namesAllTiers =
    /\bpoor\b/i.test(text) && /\bsatisfactory\b/i.test(text) && /\bgood\b/i.test(text);
  const mapsShadeEndpoints =
    /\bdark\b/i.test(text) &&
    /\bpoor\b/i.test(text) &&
    /\blight\b/i.test(text) &&
    /\bgood\b/i.test(text);
  return (namesEncoding && namesAllTiers) || mapsShadeEndpoints;
}

function buildBandLadders(rows: NormRow[], theme: Theme, palette: string | undefined, warnings: LintWarning[], light: boolean) {
  const paintWarningRules: { kind: 'bullet-band-lightness'; before: number; count: number; poor: Paint; good: Paint; light?: true }[] = [];
  const ladders = new Map<number, Paint[]>();
  for (const count of new Set(rows.map((row) => row.bands.length))) {
    const before = warnings.filter((warning) => warning.code !== 'band-lightness-insufficient').length;
    const ladder = bandLadder(theme, count, palette, warnings, light);
    ladders.set(count, ladder);
    const source = ladder[0] && 'token' in ladder[0] ? ladder[0].theme : undefined;
    if (source?.kind === 'bullet-band') paintWarningRules.push({ kind: 'bullet-band-lightness', before, count, poor: source.poor, good: source.good, ...(light ? { light: true as const } : {}) });
  }
  return { ladders, paintWarningRules };
}

function resolveBulletAnchor(ref: AnchorRef, anchorByRow: Map<Id, AnchorResolution>, zeroXById: Map<Id, number>): AnchorResolution | null {
  const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
  if (!('categoryId' in norm)) return null;
  const at = anchorByRow.get(norm.categoryId);
  if (!at) return null;
  if (norm.edge === 'start') return { ...at, x: zeroXById.get(norm.categoryId)! };
  return at;
}

/**
 * Zero, the authored bounds and every drawn value line seed the shared domain;
 * all of them only widen it (valueLineDomain.ts), so a value line far outside
 * the data is always inside the plot. Normalized rows have no shared domain.
 */
function sharedDomainSeeds(sharedScale: boolean, options: BulletOptions, annotations: readonly Annotation[]): { lo: number; hi: number } {
  if (!sharedScale) return { lo: 0, hi: 0 };
  const line = valueLineExtent(annotations);
  return {
    lo: Math.min(0, options.valueAxis?.min ?? 0, line?.lo ?? 0),
    hi: Math.max(0, options.valueAxis?.max ?? 0, line?.hi ?? 0),
  };
}

function bulletAnnotations(options: BulletOptions, sharedScale: boolean, warnings: LintWarning[]) {
  return (options.annotations ?? []).filter(annotation => {
    if (sharedScale || (annotation.kind !== 'diff' && annotation.kind !== 'cagr' && annotation.kind !== 'valueLine')) return true;
    if (annotation.kind === 'valueLine') {
      // One value means a different position on every normalized row, so the
      // line would state a number the rows do not share.
      warnings.push({
        code: 'comparison-shared-scale', severity: 'warn',
        message: 'valueLine needs bullet rows on one shared scale; no line was drawn',
        suggest: 'use sharedScale: true only when the rows measure the same unit',
        ...(annotation.id ? { owner: { annotationId: annotation.id } } : {}),
      });
      return false;
    }
    warnings.push({
      code: 'comparison-shared-scale', severity: 'warn',
      message: `${annotation.kind} needs comparable bullet rows on one shared scale; no arrow was drawn`,
      suggest: 'use sharedScale: true only when the rows measure the same unit',
      ...(annotation.id ? { owner: { annotationId: annotation.id } } : {}),
    });
    return false;
  });
}

const BAND_TRIES = Symbol('bandTries');
/** Set when a bold row name would be cut: the chart lays out again with every name at its regular weight. */
const REGULAR_NAMES = Symbol('regularNames');
/** Set when the band names cannot print on their rows: the chart lays out again with the key. */
const ROW_KEY_OFF = Symbol('rowKeyOff');

export function layoutBullet(
  data: BulletData,
  options: BulletOptions = {},
): Geometry<BulletMarks, BulletDerived> {
  const warnings: LintWarning[] = [];
  breakUnsupported('bullet', options, warnings);
  // Card exemption: bullet is a card, not a canvas — no
  // themeForWidth here; the 480-wide card keeps its canonical column.
  const theme = resolveSemanticPaletteTheme(resolveTheme(options.theme), options.palette, warnings);
  // The compact mark keeps bar, bands and target tick and draws no text of its own.
  const compact = options.density === 'compact';
  warnings.push(...compactBulletRefusals(options));
  const compactFloor = chartSizing('bullet', options);
  // Card default (dashboard 480x270) unless the author sized the chart; the compact mark is its floor.
  // The compact mark stays a mark under a render target's default canvas.
  const size = resolveSize(compact ? cardSize(options, { width: compactFloor.minWidth, height: compactFloor.minHeight }) : options.size ?? 'dashboard');
  const target = options.target ?? DEFAULT_TARGET;
  /** A tight row steps text down to `size`; a render target stops at the floor of the text's own role. */
  const stepTo = (font: FontSpec, size: number, role: TypeRoleName): FontSpec =>
    ({ ...font, size: Math.min(font.size, Math.max(size, readerFloorPx(target, role, textScaleOf(options)))) });
  const measure = options.measure ?? defaultMeasurer;
  // Business default (copied from waterfall): whole numbers get 0 decimals;
  // small non-integers keep one, so a 0.4 sliver never prints as "0".
  const fmt = options.format
    ? formatterFromExample(options.format, options.locale?.language)
    : (v: number) => formatAutomaticNumber(v, { locale: options.locale?.language, decimals: autoDecimals(v) });
  const highlights = new Set(resolveHighlight(options.highlight));
  const labelOn = (kind: LabelKind): boolean => !compact && chartLabelOn(options, kind);

  // ---- normalize ----
  if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
    throw new NormalizeError('empty-data', 'rows', 'bullet requires at least one row');
  }
  const seen = new Set<Id>();
  const rows: NormRow[] = data.rows.map((r: BulletRow, i) => {
    if (!r?.id) throw new NormalizeError('missing-id', `rows[${i}]`, 'bullet row requires an id');
    if (seen.has(r.id)) {
      throw new NormalizeError('duplicate-id', `rows[${i}]`, `duplicate row id '${r.id}'`);
    }
    seen.add(r.id);
    const targetFormat = cellMeta(r.target ?? null)?.format;
    const valueFormat = cellMeta(r.value)?.format ?? options.format;
    if (targetFormat && (!valueFormat || JSON.stringify(parseFormatExample(targetFormat)) !== JSON.stringify(parseFormatExample(valueFormat)))) warnings.push({
      code: 'bullet-target-format-ignored', severity: 'warn',
      message: `row '${r.id}': target.format is ignored; target and value use the row's format`,
      field: ['data', 'rows', i, 'target', 'format'],
      suggest: 'Set the shared format on the row value or options.format, then remove target.format.',
    });
    const rawBands: NormBand[] = (r.bands ?? [])
      .map((band) =>
        typeof band === 'number'
          ? { to: band }
          : { to: band.to, ...(band.tone ? { tone: band.tone } : {}), ...(band.label?.trim() ? { label: band.label.trim() } : {}) },
      )
      .filter((band) => Number.isFinite(band.to));
    // The schema refuses these on every validate path, and grid composition
    // forwards child-schema refusals too. The layout keeps its own bound because
    // it receives RAW panel data from callers that never ran the schema; without
    // it one absurd threshold collapses bar and bands to the minimum-paint
    // fallback — a silent misproportion.
    const bounded = rawBands.filter((band) => Math.abs(band.to) <= MAGNITUDE_CEILING);
    if (bounded.length < rawBands.length) {
      warnings.push({
        code: 'band-magnitude',
        severity: 'warn',
        message: `row '${r.id}': band thresholds beyond ±1e15 dropped — rescale the unit instead`,
        owner: { categoryId: r.id },
      });
    }
    const positive = bounded.filter((band) => band.to > 0);
    if (positive.length < bounded.length) {
      warnings.push({
        code: 'band-nonpositive',
        severity: 'warn',
        message: `row '${r.id}': non-positive band thresholds dropped (bands measure from 0)`,
        owner: { categoryId: r.id },
      });
    }
    const bands = [...positive].sort((a, b) => a.to - b.to);
    if (bands.map((band) => band.to).join(',') !== positive.map((band) => band.to).join(',')) {
      warnings.push({
        code: 'bands-unsorted',
        severity: 'info',
        message: `row '${r.id}': bands re-sorted ascending`,
        owner: { categoryId: r.id },
      });
    }
    if (cellValue(r.value) === null) warnMissingValue(warnings, `row '${r.id}'`, { categoryId: r.id }, 'no bar; the bands and target still draw');
    return {
      id: r.id,
      label: r.label ?? r.id,
      date: r.date,
      value: cellValue(r.value),
      isPct: isPctCell(r.value),
      meta: cellMeta(r.value),
      target: cellValue(r.target ?? null),
      bands,
      direction: r.direction ?? 'higherIsBetter',
    };
  });

  // ---- scale mode (decided here because the axis reservation reads it) ----
  // SHARED: one absolute nice domain across all rows — right when the rows
  // share one unit and magnitudes should compare. ROW-NORMALIZED (the
  // bullet-graph percent-of-scale): each row runs zero → its own extent (band maximum,
  // extended by value/target overshoot), so mixed-unit KPI rows keep legible
  // bands instead of collapsing next to the largest row. Default: normalized
  // when EVERY row declares bands (the bands are the per-row scale, and
  // without them there is nothing to normalize to) and the rows differ in
  // unit or thresholds: rows alike are one scale, or per-row extents would
  // draw the same band at different lengths.
  // The percent-of-target scale is one shared scale of its own.
  const targetScale = options.sharedScale === 'percentOfTarget';
  const allBanded = rows.every((row) => row.bands.length > 0);
  const unitOf = (row: NormRow): string => `${row.isPct}|${row.meta?.format ?? ''}`;
  const bandsOf = (row: NormRow): string => row.bands.map((band) => band.to).join('|');
  const alike = rows.every((row) => unitOf(row) === unitOf(rows[0]!) && bandsOf(row) === bandsOf(rows[0]!));
  const sharedScale = targetScale || (typeof options.sharedScale === 'boolean' ? options.sharedScale : !allBanded || alike);
  if (options.sharedScale === undefined && allBanded && !alike && rows.length > 1) {
    warnings.push({
      code: 'bullet-row-scales',
      severity: 'warn',
      message: 'each bullet row runs on its own scale, because the rows differ in unit or bands; bar lengths compare within a row, not across rows',
      suggest: 'set sharedScale: false to confirm per-row scales, or sharedScale: true when the rows measure the same unit',
    });
  }
  if (
    !targetScale &&
    !sharedScale &&
    (options.valueAxis?.show ||
      options.valueAxis?.min !== undefined ||
      options.valueAxis?.max !== undefined)
  ) {
    warnings.push({
      code: 'value-axis-row-scale',
      severity: 'warn',
      message:
        'valueAxis is ignored while bullet rows are normalized to their own scales — one absolute axis cannot describe differently scaled rows',
      suggest: 'set sharedScale: true to keep one absolute axis across rows',
    });
  }

  // ---- per-row formatting (cell format override > pct > chart format) ----
  const rowFmt = (row: NormRow) => (v: number): string => {
    if (row.meta?.format) return formatterFromExample(row.meta.format, options.locale?.language)(v);
    if (row.isPct) return formatAutomaticPercent(v, autoDecimals(v), false, options.locale?.language);
    return fmt(v);
  };
  const valueTextOf = (row: NormRow): string | null => {
    if (row.value === null || row.meta?.label === false) return null;
    const base = rowFmt(row)(row.value);
    return typeof row.meta?.label === 'string'
      ? row.meta.label.replace(/\$\{value\}/g, base)
      : base;
  };
  /** Signed delta: '+7' / '−1.5pp', and with its comparison '+7 vs target'. */
  const deltaBody = (row: NormRow, d: number): string => {
    const sign = d < 0 ? MINUS : '+';
    const body = row.isPct
      ? formatAutomaticNumber(Math.abs(d), { locale: options.locale?.language, decimals: autoDecimals(d), suffix: 'pp' })
      : rowFmt(row)(Math.abs(d));
    return `${sign}${body}`;
  };
  const deltaText = (row: NormRow, d: number): string => `${deltaBody(row, d)} vs ${targetWord(options)}`;
  const deltaTone = (row: NormRow, d: number): 'good' | 'bad' | 'warn' | 'neutral' => {
    if (row.direction === 'neutral') return 'neutral';
    if (row.bands.some(band => band.tone)) return (row.value === null ? row.bands.at(-1)! : bandFor(row.value, row.bands)).tone ?? 'neutral';
    return d === 0 ? 'good' : (d > 0) === (row.direction === 'higherIsBetter') ? 'good' : 'bad';
  };

  // ---- derive: delta vs target ----
  const deltaVsTarget: Record<Id, number> = emptyIdRecord();
  for (const row of rows) {
    if (row.value !== null && row.target !== null) {
      deltaVsTarget[row.id] = cleanDiff(row.value, row.target);
    }
  }

  // ---- fonts ----
  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const capsuleFont = labelFont;
  // Values print bold, as the share column of the percent-of-target rows.
  const valueBaseFont: FontSpec = { ...labelFont, weight: emphasisWeight(theme) };
  const targetFont: FontSpec = { ...tickFont, size: Math.max(readerFloorPx(target, 'label', textScaleOf(options)), tickFont.size) };
  const minimumRowH = Math.max(28, measure('0', labelFont).height + 6, measure('0', tickFont).height + 4);
  // A target value prints in the air above its row: the natural
  // pitch keeps that air one text line tall.
  const bandFraction = options.bandFraction ?? 0.7;
  // One target shared by every row of a shared scale prints once, above the
  // first row; the other rows need no air for it.
  const targetValues = new Set(rows.flatMap((row) => (row.target === null ? [] : [row.target])));
  const firstTargetRow = rows.find((row) => row.target !== null)?.id;
  // Set once the target and gap columns fit: the target then prints in its column, not by its tick.
  let cols = false;
  const targetPrints = (row: NormRow): boolean =>
    !cols && labelOn('annotation') && row.target !== null && (!(sharedScale && targetValues.size === 1) || row.id === firstTargetRow);
  let targetAir = rows.some((row, ri) => ri > 0 && targetPrints(row)) ? measure('0', targetFont).height + 2 : 0;
  // A full band (bandFraction 1) leaves no gap to size from; the target air
  // then takes up to half the pitch, as the row gap below allows.
  const airRowH = targetAir === 0 ? 0 : bandFraction < 1 ? Math.ceil(targetAir / (1 - bandFraction)) : Math.ceil(2 * targetAir);
  let naturalRowH = compact ? minimumRowH : Math.max(44, minimumRowH, airRowH);
  // The gap above a row takes at most half its pitch, and a target value
  // needs its line plus 1 px there, so a pressed row keeps it only at twice
  // that.
  const minimumPitch = targetAir === 0 ? minimumRowH
    : Math.max(minimumRowH, Math.ceil(2 * (measure('0', targetFont).height + 1)));

  // ---- frame (title/subtitle/source/legend measured FIRST) ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  // Bullet is a CARD (aspect class 'card'), and cards are exempt from the
  // width classes that key the canvasMargin token: the compact card margins
  // stay authored.
  // A bare compact mark sits in someone else's cell and draws edge to edge, as a bare sparkline does,
  // with 1 px each side for the half strokes of the baseline and a target tick at the end of the scale.
  const framed = (options.title !== undefined && options.title !== false) || options.subtitle !== undefined
    || options.source !== undefined || authoredNotes(options).length > 0;
  const margin = compact && !framed
    ? { top: 0, right: 1, bottom: 0, left: 1, ...options.margin }
    : { top: 16, right: 20, bottom: 12, left: 20, ...options.margin };
  if (targetScale) {
    return layoutBulletOnTargetScale(data, options, {
      rows, theme, size, measure, margin, occupied, warnings, highlights, labelOn, rowFmt, deltaText, deltaBody, deltaTone, deltaVsTarget,
    });
  }
  // ---- band names on the rows (bandKey 'row') ----
  // A few rows side by side, every band named: each name prints above its band, the band edges are
  // ticked under it and the value prints in the Actual column; the key at the bottom names the bar, the tick
  // and the ramp. Where any of it cannot show, the chart lays out again with the band key (ROW_KEY_OFF).
  const keyMode = options.bandKey ?? 'auto';
  const rowKeyOff = (options as { [ROW_KEY_OFF]?: true })[ROW_KEY_OFF] === true;
  const bandedRows = rows.filter((row) => row.bands.length > 0);
  const namesEveryBand = bandedRows.length > 0 && bandedRows.every((row) => row.bands.every((band) => band.label !== undefined));
  // An authored band fraction sizes today's rows; 'auto' keeps them for it.
  const rowWanted = !rowKeyOff && !compact && labelOn('annotation') && namesEveryBand
    && (keyMode === 'row' || (keyMode === 'auto' && rows.length <= 4 && options.bandFraction === undefined));
  if (rowWanted && options.bandFraction !== undefined) {
    warnings.push({
      code: 'band-fraction-row-ignored', severity: 'warn',
      message: "bandFraction is ignored while bandKey is 'row': rows that name their bands keep their own band height",
      field: ['options', 'bandFraction'],
      suggest: "Remove bandFraction, or set bandKey to 'auto' or 'labels' to size the bands with it.",
    });
  }
  if (keyMode === 'row' && !compact && !rowWanted) {
    warnings.push({
      code: 'band-key-row-unavailable', severity: 'warn',
      message: 'bandKey row needs a name on every band, rows side by side with the target column, and room for each name above its band; the key names the bands',
      suggest: "Name every band or widen the chart, or set bandKey to 'auto'.",
    });
  }
  const { ladders, paintWarningRules } = buildBandLadders(rows, theme, options.palette, warnings, rowWanted);
  const bandPaint = (row: NormRow, index: number): Paint =>
    row.bands[index]!.tone ? markRolePaint(row.bands[index]!.tone!, true)
      : ladders.get(row.bands.length)![row.direction === 'lowerIsBetter' ? row.bands.length - 1 - index : index]!;
  const labelsKey = legendItemsForBands(rows, bandPaint);
  // An authored target word heads its column and keys the tick as written; the built-in word has its own head.
  const builtIn = { locale: options.locale };
  const targetHead = targetWord(options) !== targetWord(builtIn) && options.strings?.targetColumn === undefined
    ? targetWord(options) : chartString(options, 'targetColumn');
  const bandLegendItems = [
    ...(rowWanted
      ? [
        { id: 'key:actual', label: chartString(options, 'actualColumn'), paint: { token: 'markInk' } as Paint, key: 'box' as const },
        { id: 'key:target', label: targetHead, paint: { token: 'ink' } as Paint, key: 'tick' as const, width: strokeToken(theme, 'data') },
        ...(rampApplies(rows) ? rampItems(rows, options, bandPaint) : []),
      ]
      : rampKey(rows, options, bandPaint, labelsKey, warnings) ?? labelsKey),
    ...attainmentKey(options),
  ];
  let legendInput: FrameInput['legend'];
  if (bandLegendItems.length > 0 && options.legend !== 'none' && !compact) {
    const legendOpts: LegendOptions = normalizeLegendOption(options.legend, { position: rowWanted ? 'bottom' : 'top' });
    let items = bandLegendItems;
    if (legendOpts.order) {
      const orderIndex = (id: Id) => {
        const index = legendOpts.order!.indexOf(id);
        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
      };
      items = [...items].sort((a, b) => orderIndex(a.id) - orderIndex(b.id));
    }
    legendInput = { options: legendOpts, items };
  }
  const anyBands = rows.some((row) => row.bands.length > 0);
  // The compact mark has no room for a key or a note: the host's column names the bands.
  if (anyBands && !legendInput && !compact && !hasBandExplanation(options)) {
    warnings.push({ code: 'bands-unexplained', severity: 'warn', message: BANDS_UNEXPLAINED });
  }
  const frameResult = solveFrame(
    {
      size,
      margin,
      // Cards keep compact gaps at every width; see FrameInput.cardGaps.
      cardGaps: true,
      ...frameTextOptions(options),
      legend: legendInput,
      theme: cardFrameTheme(theme, options, size.width),
      measure,
    },
    occupied,
  );
  const plot0 = frameResult.plot;

  // ---- left row-label band ----
  // The value-axis title under the tick row, as on bar; drawn only when authored.
  const axisTitle = options.valueAxis?.show && sharedScale && labelOn('axisTitle')
    ? planValueAxisTitle(options.axisTitles?.primary, theme, measure, plot0.w)
    : undefined;
  const axisH = options.valueAxis?.show && sharedScale
    ? measure('0', tickFont).height + 8 + (axisTitle ? axisTitle.height + 2 : 0)
    : 0;
  const inset = compact ? 0 : 2;
  // The first row's target prints above it too; the rows reserve its air.
  let topAir = rows.length > 0 && targetPrints(rows[0]!) ? measure('0', targetFont).height + 2 : 0;
  let availH = plotHeightAfter(frameResult, size.height, plot0.h - axisH - 2 * inset - topAir);
  const rowsH = Math.min(availH, rows.length * naturalRowH);
  // A frame pressed under the minimum pitch is refused; its names are fitted
  // at that pitch, so the refusal reports the minimum width its fix keeps.
  const stepEst = Math.max(rowsH / rows.length, minimumPitch);
  // compact mode: row labels drop to footnote size when rows get tight
  const regularNames = (options as { [REGULAR_NAMES]?: true })[REGULAR_NAMES] === true;
  const nameFont: FontSpec = regularNames ? tickFont : { ...tickFont, weight: NAME_WEIGHT };
  const catFont: FontSpec =
    stepEst >= tickFont.size * 1.2 + 4
      ? nameFont
      : stepTo(nameFont, theme.type.footnote.size, 'axis');
  const lineH = catFont.size * 1.2;
  // Keep the bounded side-column fit if the stacked rows do not fit the height.
  const card = size.width < 480;
  const catMaxLines = card || stepEst >= 2 * lineH + 4 ? 2 : 1;
  const capW = card ? Math.min(80, Math.max(24, plot0.w * 0.3)) : Math.max(24, plot0.w * 0.26);
  const fitNames = (maxLines: number, font = catFont) => rowLabelBand(
    labelOn('category') ? rows : [], font, capW, maxLines, lineH, measure,
    { wider: card ? capW : gutterBudget(24, plot0.w), shrink: stepDownFont(theme, font, 'axis', target, textScaleOf(options)), target, textScale: textScaleOf(options), typeRole: 'axis', footnoteRefs: { count: authoredFootnoteCount(options), warnings } },
  );
  const sideNames = (font = catFont) => {
    const band = fitNames(catMaxLines, font);
    return band.labels.some((label) => label.title !== undefined) ? fitNames(2, font) : band;
  };
  const fitted = fitNames(catMaxLines);
  let { labels: catLines, width: catBandW } = fitted.labels.some((label) => label.title !== undefined) ? fitNames(2) : fitted;

  // ---- right delta-capsule column (reserved so capsules never collide) ----
  const capsulesOn = labelOn('annotation');
  const capsuleTexts = new Map<Id, string>();
  let capsuleColW = 0;
  if (capsulesOn) {
    for (const row of rows) {
      const d = deltaVsTarget[row.id];
      if (d === undefined) continue;
      const text = deltaText(row, d);
      capsuleTexts.set(row.id, text);
      capsuleColW = Math.max(capsuleColW, measure(text, capsuleFont).width);
    }
  }

  const annotations = bulletAnnotations(options, sharedScale, warnings);
  const cagrColW = annotations.some(ann => ann.kind === 'cagr')
    ? measure('−100.0% p.a.', { ...labelFont, weight: emphasisWeight(theme) }).width + 48 : 0;
  const valueW = labelOn('point') ? Math.max(0, maxOf(rows.map(row => {
    const text = valueTextOf(row);
    return text ? measure(text, valueBaseFont).width : 0;
  }))) : 0;
  const maxLines = Math.max(catMaxLines, ...rows.map(row => row.label.split(/\s+/).length));
  const cardBand = (font: FontSpec) => rowLabelBand(labelOn('category') ? rows : [], font, plot0.w - valueW - CAT_BAND_GAP, maxLines, lineH, measure,
    { target, textScale: textScaleOf(options), typeRole: 'axis', footnoteRefs: { count: authoredFootnoteCount(options), warnings } });
  const cardNames = !compact && annotations.length === 0
    && (catLines.some(label => label.title !== undefined)
      || plot0.w - catBandW - CAT_BAND_GAP - capsuleColW - CAPSULE_GAP < size.width * 0.55)
    ? cardBand(catFont)
    : undefined;
  const cardHeaderH = Math.max(measure('0', labelFont).height, maxOf((cardNames?.labels ?? catLines).map(label => label.h)));
  const cardBandH = Math.max(16, measure('0', labelFont).height);
  const cardFooterH = targetPrints(rows[0]!) || capsuleTexts.size > 0 ? Math.max(measure('0', targetFont).height, measure('0', capsuleFont).height) : 0;
  const cardPitch = cardHeaderH + cardBandH + cardFooterH + 12;
  const fixedHeight = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height ?? !heightOmitted(options.size);
  // A fixed frame keeps the full rows when stacking would require more height.
  const stacked = cardNames !== undefined && (!fixedHeight || rows.length * cardPitch <= availH);
  if (stacked) {
    catLines = cardNames.labels;
    catBandW = cardNames.width;
    naturalRowH = Math.max(naturalRowH, cardPitch);
  } else if (fixedHeight && cardNames) {
    ({ labels: catLines, width: catBandW } = fitted);
  }
  // A whole name outranks its weight: where bold would cut a name or add a line
  // to the tallest one, every name prints regular.
  const tallest = (labels: readonly { lines: readonly string[] }[]) => maxOf(labels.map(label => label.lines.length));
  if (!regularNames && (catLines.some((label) => label.title !== undefined)
    || tallest(catLines) > 1 && tallest(catLines) > tallest((stacked ? cardBand : sideNames)({ ...catFont, weight: tickFont.weight }).labels))) {
    return layoutBullet(data, { ...options, [REGULAR_NAMES]: true } as BulletOptions);
  }
  // Today's side-by-side plot: the minimum width and the fallback read it.
  const sidePlotW = Math.max(10, plot0.w - (catBandW ? catBandW + CAT_BAND_GAP : 0) - (capsuleColW ? capsuleColW + CAPSULE_GAP : 0) - cagrColW);

  // ---- target and gap columns ----
  // Beside side-by-side rows, as on the percent-of-target scale (targetScale.ts): the target and the
  // gap to it under their heads, the gap's position under it and the row's direction under its name.
  // They show only where the plot keeps 45% of the width and every row keeps its two lines; else the
  // target prints by its tick and the delta at the row end, as before.
  // Second lines (gap position, direction) and the band names and edge numbers of rows that name their bands.
  const noteFont: FontSpec = { family: theme.type.family, ...theme.type.axis, size: Math.min(secondaryType(theme).size, Math.max(theme.type.footnote.size, readerFloorPx(target, 'secondary', textScaleOf(options)))) };
  const colsEligible = options.targetColumns !== false && !compact && !stacked && cardNames === undefined && labelOn('annotation')
    && annotations.every((ann) => ann.kind !== 'cagr') && rows.some((row) => row.target !== null)
    && catLines.every((label) => label.title === undefined);
  const planColumns = () => {
    const headerFont = columnHeadFont(theme, target, textScaleOf(options));
    const colTargets = rows.map((row) => (row.target === null ? null : rowFmt(row)(row.target)));
    const colGaps = rows.map((row) => (deltaVsTarget[row.id] === undefined ? null : deltaBody(row, deltaVsTarget[row.id]!)));
    const colPositions = rows.map((row) => {
      const d = deltaVsTarget[row.id];
      return d === undefined ? null : chartString(options, d < 0 ? 'gapBelow' : d > 0 ? 'gapAbove' : 'gapOn', { v1: targetWord(options) });
    });
    // Toned bands judge a row by its band, not its direction, so such a row names no direction.
    const colDirections = rows.map((row) => (!labelOn('category') || row.direction === 'neutral' || row.bands.some((band) => band.tone) ? null
      : chartString(options, row.direction === 'lowerIsBetter' ? 'lowerBetter' : 'higherBetter')));
    const widest = (texts: readonly (string | null)[], font: FontSpec) => Math.max(0, maxOf(texts.map((text) => (text ? measure(text, font).width : 0))));
    const headEnv = { target, textScale: textScaleOf(options) };
    const targetBodyW = widest(colTargets, labelFont);
    const gapBodyW = Math.max(widest(colGaps, valueBaseFont), widest(colPositions, noteFont));
    const colHeads = [
      fitHead(targetHead, headerFont, targetBodyW, measure, headEnv),
      fitHead(chartString(options, 'gapColumn', { v1: targetWord(options) }), headerFont, gapBodyW, measure, headEnv),
    ] as const;
    const targetColW = Math.max(colHeads[0].w, targetBodyW);
    const gapColW = Math.max(colHeads[1].w, gapBodyW);
    const colsW = targetColW + COLUMN_GAP + gapColW;
    const colLeftW = catBandW ? Math.max(catBandW, widest(colDirections, noteFont)) : 0;
    const colPlotW = plot0.w - (colLeftW ? colLeftW + CAT_BAND_GAP : 0) - COLUMNS_GAP - colsW;
    const headerH = measure('0', headerFont).height;
    const noteH = measure('0', noteFont).height;
    const colNameH = (ri: number) => (labelOn('category') ? catLines[ri]!.h : 0) + (colDirections[ri] ? LINE_GAP + noteH : 0);
    const colGapH = (ri: number) => colGaps[ri] ? measure('0', valueBaseFont).height + (colPositions[ri] ? LINE_GAP + noteH : 0)
      : colTargets[ri] ? measure('0', labelFont).height : 0;
    const colBlockH = (ri: number) => Math.max(colNameH(ri), colGapH(ri));
    // Heads share the key line when they fit right of its entries, else they take a line of their own.
    const legendLabels = frameResult.nodes.filter((node) => node.t === 'text' && node.part === 'legendLabel');
    const legendLast = legendLabels.at(-1);
    const legendRight = Math.max(-Infinity, maxOf(legendLabels.map((node) => node.t === 'text' ? node.x + Math.max(...node.lines.map((line) => measure(line, node.font).width)) : -Infinity)));
    // Only a key above the rows can carry the heads.
    const headsOnKey = legendLast?.t === 'text' && legendLast.y < plot0.y && legendRight + 2 * COLUMN_GAP <= plot0.x + plot0.w - colsW;
    const colTopAir = headsOnKey ? 0 : headerH + 4;
    const colAvailH = plotHeightAfter(frameResult, size.height, plot0.h - axisH - 2 * inset - colTopAir);
    const colPitch = Math.max(44, minimumRowH, Math.ceil(maxOf(rows.map((_, ri) => colBlockH(ri))) + 12));
    return { headerFont, noteFont, colTargets, colGaps, colPositions, colDirections, colHeads, targetColW, gapColW, colsW, colLeftW, colPlotW, headerH, noteH, colBlockH, legendLast, headsOnKey, colTopAir, colAvailH, colPitch };
  };
  const colPlan = colsEligible ? planColumns() : undefined;
  const colBlockMax = colPlan ? maxOf(rows.map((_, ri) => colPlan.colBlockH(ri))) : 0;
  if (colPlan && colPlan.colPlotW >= Math.max(80, 0.45 * size.width) && (!fixedHeight || colPlan.colAvailH / rows.length >= colBlockMax + 4)) {
    cols = true;
    targetAir = 0;
    topAir = colPlan.colTopAir;
    availH = colPlan.colAvailH;
    naturalRowH = colPlan.colPitch;
  }
  // Read only where the columns show.
  const cp = colPlan as NonNullable<typeof colPlan>;

  // ---- band names on the rows: the row block ----
  // Names line, band, edge ticks, then air; the heads share the first names line. A fixed frame
  // stretches the rows toward the 56 px band of a slide; a frame too low for the block keeps the key.
  // Without the target column the target would print in the names line, so the key stays too.
  const rowMode = rowWanted && !stacked && cardNames === undefined && (cols || rows.every((row) => !targetPrints(row)));
  const noteH = measure('0', noteFont).height;
  const nameAir = rowMode ? Math.max(noteH, cols ? cp.headerH : 0) + 3 : 0;
  const edgeTicks = rowMode && !sharedScale;
  const tickAir = edgeTicks ? EDGE_TICK + 1 + noteH : 0;
  // The band holds the row's column block, so the cells stay inside its height.
  const bandBase = Math.max(ROW_BAND, cols ? Math.ceil(colBlockMax) : 0);
  let rowBandH = bandBase;
  let rowAir = ROW_AIR;
  if (rowWanted && !rowMode) return layoutBullet(data, { ...options, [ROW_KEY_OFF]: true } as BulletOptions);
  if (rowMode) {
    topAir = 0;
    availH = plotHeightAfter(frameResult, size.height, plot0.h - axisH - 2 * inset);
    const natural = nameAir + bandBase + tickAir + ROW_AIR;
    let pitch = natural;
    if (fixedHeight) {
      if (availH / rows.length < natural) return layoutBullet(data, { ...options, [ROW_KEY_OFF]: true } as BulletOptions);
      pitch = Math.min(availH / rows.length, Math.max(natural, ROW_PITCH_MAX));
      rowBandH = Math.max(bandBase, Math.min(ROW_BAND_MAX, bandBase + 0.4 * (pitch - natural)));
    }
    rowAir = pitch - nameAir - rowBandH - tickAir;
    targetAir = 0;
    naturalRowH = pitch;
  }
  const rawBandPad = (options as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
  const bandPad = rawBandPad > 0 ? Math.max(0, Math.min(rawBandPad, Math.floor(availH - 10))) : 0;
  const plot: Rect = {
    x: stacked ? plot0.x : plot0.x + (cols ? (cp.colLeftW ? cp.colLeftW + CAT_BAND_GAP : 0) : catBandW ? catBandW + CAT_BAND_GAP : 0),
    y: plot0.y + inset + topAir + bandPad,
    w: stacked ? plot0.w : cols ? cp.colPlotW : sidePlotW,
    h: Math.min(availH - bandPad, rows.length * naturalRowH),
  };
  {
    const grow = rowDrivenHeight({ options, width: size.width, height: size.height, chromeH: size.height - availH, rowsH: rows.length * naturalRowH });
    if (grow !== undefined) return layoutBullet(data, { ...options, size: { width: size.width, height: grow } });
  }
  const capsuleX = stacked ? plot.x + plot.w - capsuleColW : plot.x + plot.w + CAPSULE_GAP;

  // ---- rows band scale (needed before the value font / label headroom) ----
  // Rows pressed below their natural pitch keep the target values' air and
  // give up band height, down to half the pitch.
  const gapShare = Math.max(1 - bandFraction, Math.min(0.5, targetAir / (plot.h / rows.length)));
  // A row that names its bands: half the air, the names line, the band, the edge ticks, half the air.
  const band: BandScale = rowMode
    ? {
      step: naturalRowH, bandwidth: rowBandH, count: rows.length, range: [plot.y, plot.y + plot.h],
      position: (index) => plot.y + index * naturalRowH + rowAir / 2 + nameAir,
      center: (index) => plot.y + index * naturalRowH + rowAir / 2 + nameAir + rowBandH / 2,
    }
    : bandScale(rows.length, [plot.y, plot.y + plot.h], {
      paddingInner: gapShare,
      paddingOuter: gapShare / 2,
    });
  const capsuleLabelH = measure('X', capsuleFont).height;
  const capsuleLabelPad = Math.max(0, Math.min(2, (band.step - capsuleLabelH) / 2));
  // compact mode: drop to footnote-size value labels when rows get tight
  const valueFont: FontSpec =
    band.step >= labelFont.size * 1.2 + 6
      ? valueBaseFont
      : stepTo(valueBaseFont, theme.type.footnote.size, 'label');

  // ---- value texts (measured BEFORE the scale for outside-end headroom) ----
  let maxPosW = 0;
  let maxNegW = 0;
  if (labelOn('point')) {
    for (const row of rows) {
      const text = valueTextOf(row);
      if (!text || row.value === null) continue;
      const w = measure(text, valueFont).width;
      if (row.value >= 0) maxPosW = Math.max(maxPosW, w);
      else maxNegW = Math.max(maxNegW, w);
    }
  }

  // ---- x scale(s): zero forced, outside-label headroom ----
  const extents = rows.map((row) => {
    let rowLo = 0;
    let rowHi = 0;
    if (row.value !== null) {
      rowLo = Math.min(rowLo, row.value);
      rowHi = Math.max(rowHi, row.value);
    }
    if (row.target !== null) {
      rowLo = Math.min(rowLo, row.target);
      rowHi = Math.max(rowHi, row.target);
    }
    if (row.bands.length > 0) rowHi = Math.max(rowHi, row.bands[row.bands.length - 1]!.to);
    return { lo: rowLo, hi: rowHi };
  });
  const seeds = sharedDomainSeeds(sharedScale, options, annotations);
  const lo = Math.min(seeds.lo, minOf(extents.map((extent) => extent.lo)));
  const hi = Math.max(seeds.hi, maxOf(extents.map((extent) => extent.hi)));
  // fP/fN are shared across rows in BOTH modes, and the denominator drops fN
  // for rows without a negative side, so (short of the 0.3 clamp) every row's
  // right headroom is exactly fP of the plot: rows whose extent IS their band
  // maximum place it on one shared pixel column — negative rows included —
  // which is what makes percent-of-scale rows read as one exhibit. A row
  // whose value or target overshoots its bands extends its own scale past
  // that column instead (the overshoot test pins this): visible overshoot
  // outranks column alignment.
  // The compact mark prints no value, so it keeps no room for one.
  // Every value prints in one right-aligned column in that headroom, under the head Actual beside
  // the target columns, so a negative row keeps no room on its left.
  const actualHead = cols && labelOn('point') && Math.max(maxPosW, maxNegW) > 0
    ? fitHead(chartString(options, 'actualColumn'), cp.headerFont, Math.max(maxPosW, maxNegW), measure, { target, textScale: textScaleOf(options) })
    : undefined;
  const valueColW = Math.max(maxPosW, maxNegW, actualHead?.w ?? 0);
  const fP = compact || stacked ? 0 : Math.min(0.35, (valueColW + LABEL_GAP + 8) / plot.w);
  const fN = 0;
  const extend = (extentLo: number, extentHi: number): [number, number] => {
    const span = extentHi - extentLo || 1;
    const denom = Math.max(0.3, 1 - fP - (extentLo < 0 ? fN : 0));
    return [
      extentLo < 0 ? extentLo - (span * fN) / denom : 0,
      extentHi + (span * fP) / denom,
    ];
  };
  let scaleAt: (ri: number) => LinearScale;
  let axisScale: LinearScale | null = null;
  if (sharedScale) {
    applyAxisBounds([lo, hi], [lo, hi], options.valueAxis, warnings);
    const [loExt, hiExt] = extend(lo, hi);
    // The fP/fN reserves are occupied by outside-end value labels, so the waste
    // bound measures snap overshoot beyond that label-extended intent, not beyond
    // the raw data (the domain-economy invariant).
    const [dLo, dHi] = niceDomain(loExt, hiExt || 1, 5, {
      dataExtent: [loExt, hiExt || 1],
      maxWasteFraction: 0.15,
    });
    const x = linearScale([dLo, dHi], [plot.x, plot.x + plot.w]);
    axisScale = x;
    scaleAt = () => x;
  } else {
    // No niceDomain here: with no axis to tick, snapping would only push the
    // band maxima off their shared pixel column.
    const rowScales = extents.map((extent) => {
      const [loExt, hiExt] = extend(extent.lo, extent.hi);
      return linearScale([loExt, hiExt || 1], [plot.x, plot.x + plot.w]);
    });
    scaleAt = (ri) => rowScales[ri]!;
  }
  const zeroX = rows.map((_, ri) => scaleAt(ri)(0));
  // The value column ends one value width past the rightmost band, bar or target of all rows.
  const valueColRight = Math.min(plot.x + plot.w, maxOf(extents.map((extent, ri) => scaleAt(ri)(extent.hi))) + VALUE_COL_GAP + valueColW);
  const uniformZeroX = zeroX.every((value) => value === zeroX[0]);
  // Each name fits its own band with 2 px to spare on each side, or the key names the bands.
  if (rowMode && !rows.every((row, ri) => row.bands.every((bandSpec, bi) =>
    measure(bandSpec.label!, noteFont).width + 4 <= scaleAt(ri)(bandSpec.to) - scaleAt(ri)(bi === 0 ? 0 : row.bands[bi - 1]!.to)))) {
    return layoutBullet(data, { ...options, [ROW_KEY_OFF]: true } as BulletOptions);
  }

  // ---- assemble scene ----
  const nodes: SceneNode[] = [...frameResult.nodes];
  const marks: BulletMarks = { rows: [] };
  const labelRequests: LabelRequest[] = [];
  const placedAnnotations: PlacedAnnotation[] = [];
  const axes: Geometry['axes'] = [];

  // value axis (bottom, optional; shared scale only — warned off above otherwise)
  if (options.valueAxis?.show && axisScale) {
    const axisResult = layoutValueAxis(
      {
        scale: axisScale,
        plot,
        orient: 'x',
        gridlines: options.valueAxis.gridlines ?? false,
        format: fmt,
        theme,
        measure,
        canvasWidth: size.width,
      },
      occupied,
    );
    nodes.push(...axisResult.nodes);
    axes.push(axisResult.axis);
    if (axisTitle) {
      labelRequests.push(valueAxisTitleRequest(axisTitle, { x: plot.x + plot.w, y: plot.y + plot.h + 6 + measure('0', tickFont).height + 2 }, 'end', 'axis:x:title'));
    }
  }

  // baseline (vertical, at value 0 — thin solid): one full-height line when
  // every row's zero shares a pixel (always true on the shared scale, and on
  // normalized rows without negatives), else one segment per row band.
  // Rows that name their bands draw the zero on each band only: a full line would cross the names and edge numbers.
  const baselineId = uniformZeroX && !stacked && !rowMode ? 'axis:baseline' : undefined;
  if (baselineId) {
    nodes.push({
      t: 'line',
      id: baselineId,
      x1: zeroX[0]!,
      y1: plot.y,
      x2: zeroX[0]!,
      y2: plot.y + plot.h,
      stroke: { token: 'axis' },
      width: strokeToken(theme, 'rule'),
      owner: {},
      part: 'baseline',
    });
    occupied.claim({ x: zeroX[0]! - 1, y: plot.y, w: 2, h: plot.h }, 'axis', {});
  } else {
    rows.forEach((row, ri) => {
      const rowY = stacked ? plot.y + ri * band.step + cardHeaderH + 3 : band.position(ri);
      const height = stacked ? cardBandH : band.bandwidth;
      nodes.push({
        t: 'line',
        id: `baseline:${row.id}`,
        x1: zeroX[ri]!,
        y1: rowY,
        x2: zeroX[ri]!,
        y2: rowY + height,
        stroke: { token: 'axis' },
        width: strokeToken(theme, 'rule'),
        owner: { categoryId: row.id },
        part: 'baseline',
      });
      occupied.claim(
        { x: zeroX[ri]! - 1, y: rowY, w: 2, h: height },
        'axis',
        { categoryId: row.id },
      );
    });
  }

  /**
   * The measure paints in the mark ink (the ink unless the theme sets
   * color.markInk), the focus when the author highlights the row. The band
   * ladder moves toward the page until it clears 3:1 against that ink where
   * it can (bulletBandPaints); where it cannot, the bar keeps its outline.
   */
  const barPaint = (row: NormRow): Paint => {
    if (row.meta?.fill) return { css: row.meta.fill };
    if (!highlights.has(row.id)) return { token: 'markInk' };
    return semanticPalettePaint(theme, options.palette, 'focus');
  };

  const anchorByRow = new Map<Id, AnchorResolution>();
  const capsuleLabelIds = new Map<string, 'good' | 'bad' | 'warn' | 'neutral'>();
  // Column labels keep their own font and ink: the target in the ink, the gap in its tone (above), the second lines muted.
  const columnFonts = new Map<string, FontSpec>();
  const columnInks = new Map<string, Paint>();

  // ---- column heads ----
  if (cols) {
    const legendFontH = cp.legendLast?.t === 'text' ? measure('0', cp.legendLast.font).height : cp.headerH;
    const headY = rowMode ? band.position(0) - 2 - cp.headerH
      : cp.headsOnKey && cp.legendLast?.t === 'text' ? cp.legendLast.y + (legendFontH - cp.headerH) / 2 : plot0.y + inset;
    const gapRight = plot0.x + plot0.w;
    ([...(actualHead ? [[actualHead, 'actual', valueColRight]] as const : []), [cp.colHeads[0], 'target', gapRight - cp.gapColW - COLUMN_GAP], [cp.colHeads[1], 'gap', gapRight]] as const).forEach(([head, key, right], order) => {
      const request = headRequest(key, order, head, right, headY, cp.headerH, cp.headsOnKey && !rowMode);
      columnFonts.set(request.id, cp.headerFont);
      columnInks.set(request.id, { token: 'inkMuted' });
      labelRequests.push(request);
    });
  }

  // Where an attainment band will wash each row, target to value over the
  // whole pitch (annotateTargets.ts), known before the labels are seated.
  const attainment = (options.annotations ?? []).find((ann) => ann.kind === 'band' && ann.style === 'attainment');
  const plan = attainment?.kind === 'band' && typeof attainment.value === 'number' ? attainment.value : null;
  const washes: Rect[] = plan === null ? [] : rows.flatMap((row, ri) => {
    if (row.value === null) return [];
    const [a, b] = [scaleAt(ri)(plan), scaleAt(ri)(row.value)].sort((p, q) => p - q) as [number, number];
    return [{ x: a, y: band.position(ri) + band.bandwidth / 2 - band.step / 2, w: b - a, h: band.step }];
  });

  rows.forEach((row, ri) => {
    const x = scaleAt(ri);
    const x0 = zeroX[ri]!;
    const cardTop = plot.y + ri * band.step;
    const rowY = stacked ? cardTop + cardHeaderH + 3 : band.position(ri);
    const bw = stacked ? cardBandH : band.bandwidth;
    const rowCenter = rowY + bw / 2;
    const owner: OwnerRef = { categoryId: row.id };
    const rowRect: Rect = { x: plot.x, y: rowY, w: plot.w, h: bw };
    const bandNodeIds: Id[] = [];

    // qualitative band rects (0 → each ascending threshold)
    let prev = 0;
    row.bands.forEach((bandSpec, bi) => {
      const bx0 = x(prev);
      const bx1 = x(bandSpec.to);
      const rect: Rect = { x: bx0, y: rowY, w: Math.max(bx1 - bx0, 0.5), h: bw };
      const nodeId = `band:${row.id}:${bi}`;
      nodes.push({
        t: 'rect',
        id: nodeId,
        rect,
        fill: bandPaint(row, bi),
        owner,
        part: 'band',
      });
      occupied.claim(rect, 'mark', owner);
      bandNodeIds.push(nodeId);
      // The band's name, as authored, centred above it.
      if (rowMode) {
        const name = bandSpec.label!;
        const nsize = measure(name, noteFont);
        const id = `band-name:${row.id}:${bi}`;
        columnFonts.set(id, noteFont);
        columnInks.set(id, { token: 'inkMuted' });
        labelRequests.push({
          id, kind: 'annotation', role: 'note', owner, text: name, lines: [name], font: noteFont, priority: PRIORITY.interior, pad: 0,
          candidates: [{ slot: 'bandName', rect: { x: (bx0 + bx1) / 2 - nsize.width / 2, y: rowY - nsize.height - 2, w: nsize.width, h: nsize.height }, penalty: 0 }],
        });
      }
      prev = bandSpec.to;
    });

    // Ticks and numbers at zero and each band edge under the row. Every edge keeps its tick; a number
    // that would crowd a neighbour gives way, and the last edge's number outranks the ones between.
    if (edgeTicks && row.bands.length > 0) {
      const edges = [0, ...row.bands.map((bandSpec) => bandSpec.to)].map((value) => {
        const text = rowFmt(row)(value);
        return { value, text, x: x(value), w: measure(text, noteFont).width };
      });
      const clear = (a: { x: number; w: number }, b: { x: number; w: number }) => b.x - b.w / 2 >= a.x + a.w / 2 + 4;
      const last = edges.at(-1)!;
      const kept = [edges[0]!];
      for (const edge of edges.slice(1, -1)) if (clear(kept.at(-1)!, edge) && clear(edge, last)) kept.push(edge);
      if (clear(kept.at(-1)!, last)) kept.push(last);
      const y = rowY + bw;
      edges.forEach((edge) => nodes.push({ t: 'line', id: `edgeTick:${row.id}:${edge.value}`, x1: edge.x, y1: y, x2: edge.x, y2: y + EDGE_TICK,
        stroke: { token: 'axis' }, width: strokeToken(theme, 'hair'), owner, part: 'edgeTick' }));
      kept.forEach((edge) => {
        const id = `edge:${row.id}:${edge.value}`;
        columnFonts.set(id, noteFont);
        columnInks.set(id, { token: 'inkMuted' });
        // A scale mark, as an axis tick is: it states no value of the row.
        labelRequests.push({
          id, kind: 'tick', owner: {}, text: edge.text, lines: [edge.text], font: noteFont, priority: PRIORITY.interior, pad: 0,
          candidates: [{ slot: 'edge', rect: { x: edge.x - edge.w / 2, y: y + EDGE_TICK + 1, w: edge.w, h: noteH }, penalty: 0 }],
        });
      });
    }

    // measure bar (~40% of row height, from zero; can exceed the last band)
    let barNodeId: Id | undefined;
    if (row.value !== null) {
      const vx = x(row.value);
      const barH = Math.max(3, bw * BAR_FRACTION);
      const rect: Rect = {
        x: Math.min(x0, vx),
        y: rowCenter - barH / 2,
        w: Math.max(Math.abs(vx - x0), 0.5),
        h: barH,
      };
      barNodeId = `bar:${row.id}`;
      nodes.push({
        t: 'rect',
        id: barNodeId,
        rect,
        ...measureStyle(theme, barPaint(row), row.bands.flatMap((bandSpec, bandIndex) => {
          const from = bandIndex === 0 ? 0 : row.bands[bandIndex - 1]!.to;
          const under = from < Math.max(0, row.value!) && bandSpec.to > Math.min(0, row.value!) || (row.value === 0 && bandIndex === 0);
          return under ? [bandPaint(row, bandIndex)] : [];
        })),
        owner,
        part: 'bar',
        display: { value: rowFmt(row)(row.value) },
      });
      occupied.claim(rect, 'mark', owner);
      anchorByRow.set(row.id, { x: vx, y: rowCenter, value: row.value, date: row.date, label: row.label, owner });

      // value label: right-aligned in the value column right of the bands, one seat on every row,
      // so the values read down one column on their last digit
      if (labelOn('point')) {
        const text = valueTextOf(row);
        if (text) {
          const tsize = measure(text, valueFont);
          labelRequests.push({
            id: `point:${row.id}`,
            kind: 'point',
            owner,
            text,
            lines: [text],
            font: valueFont,
            priority:
              row.meta?.priority ??
              PRIORITY.endpoint + (highlights.has(row.id) ? PRIORITY.highlightBonus : 0),
            candidates: [stacked
              ? { slot: 'cardValue', rect: { x: plot.x + plot.w - tsize.width, y: cardTop, w: tsize.width, h: tsize.height }, penalty: 0 }
              : { slot: 'valueColumn', rect: { x: valueColRight - tsize.width, y: rowCenter - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0 }],
          });
        }
      }
    } else if (row.target !== null) {
      anchorByRow.set(row.id, { x: x(row.target), y: rowCenter, value: row.target, owner });
    }

    // target tick (ink, data stroke, taller than the bar)
    let targetNodeId: Id | undefined;
    if (row.target !== null) {
      const tx = x(row.target);
      const targetStroke = strokeToken(theme, 'data');
      targetNodeId = `target:${row.id}`;
      nodes.push({
        t: 'line',
        id: targetNodeId,
        x1: tx,
        y1: rowY + bw * 0.08,
        x2: tx,
        y2: rowY + bw * 0.92,
        stroke: { token: 'ink' },
        width: targetStroke,
        owner,
        part: 'target',
        display: { value: rowFmt(row)(row.target) },
      });
      occupied.claim({ x: tx - Math.max(1.5, targetStroke / 2 + 0.5), y: rowY + bw * 0.08, w: Math.max(3, targetStroke + 1), h: bw * 0.84 }, 'mark', owner);
      // The target prints by its tick, in the air above the row:
      // a tick alone leaves the number the delta is taken from to a guess.
      if (cols) {
        const text = cp.colTargets[ri]!;
        const tsize = measure(text, labelFont);
        const id = `target-value:${row.id}`;
        columnFonts.set(id, labelFont);
        columnInks.set(id, { token: 'ink' });
        labelRequests.push({
          id, kind: 'annotation', owner, text, lines: [text], font: labelFont, role: 'value', priority: PRIORITY.interior, pad: 0,
          candidates: [{ slot: 'targetColumn', rect: { x: plot0.x + plot0.w - cp.gapColW - COLUMN_GAP - tsize.width, y: rowCenter - cp.colBlockH(ri) / 2, w: tsize.width, h: tsize.height }, penalty: 0 }],
        });
      } else if (targetPrints(row)) {
        const text = `${stacked ? `${targetWord(options)} ` : ''}${rowFmt(row)(row.target)}`;
        const tsize = measure(text, targetFont);
        const seat = (slot: string, rx: number, ry: number, penalty: number) =>
          ({ slot, rect: { x: rx, y: ry, w: tsize.width, h: tsize.height }, penalty });
        const above = rowY - tsize.height - 1;
        labelRequests.push({
          id: `target-value:${row.id}`,
          kind: 'annotation',
          owner,
          text,
          lines: [text],
          font: targetFont,
          role: 'value',
          priority: PRIORITY.interior,
          pad: 0,
          // An attainment wash fills the whole row pitch: a seat on it is not taken.
          candidates: stacked ? [seat('cardTarget', plot.x, rowY + bw + 3, 0)] : [
            seat('aboveTick', tx - tsize.width / 2, above, 0),
            seat('aboveTickEnd', tx - tsize.width, above, 1),
            seat('aboveTickStart', tx, above, 1),
          ].filter((candidate) => !washes.some((wash) => rectsOverlap(wash, candidate.rect))),
        });
      }
    }

    // delta capsule (right column): '+7 vs target', tone by direction; in the
    // gap column the signed gap alone, bold, over its position to the target.
    const capsuleText = cols ? cp.colGaps[ri] ?? undefined : capsuleTexts.get(row.id);
    if (capsuleText !== undefined && cols) {
      const tsize = measure(capsuleText, valueBaseFont);
      const top = rowCenter - cp.colBlockH(ri) / 2;
      const right = plot0.x + plot0.w;
      columnFonts.set(`delta:${row.id}`, valueBaseFont);
      labelRequests.push({
        id: `delta:${row.id}`, kind: 'annotation', role: composedTextRole(capsuleText, 'note'), owner, text: capsuleText, lines: [capsuleText],
        font: valueBaseFont, priority: PRIORITY.extreme,
        candidates: [{ slot: 'gapColumn', rect: { x: right - tsize.width, y: top, w: tsize.width, h: tsize.height }, penalty: 0 }],
      });
      const position = cp.colPositions[ri];
      if (position) {
        const psize = measure(position, cp.noteFont);
        const id = `gap-position:${row.id}`;
        columnFonts.set(id, cp.noteFont);
        columnInks.set(id, { token: 'inkMuted' });
        labelRequests.push({
          id, kind: 'annotation', role: 'note', owner, text: position, lines: [position], font: cp.noteFont, priority: PRIORITY.interior, pad: 0,
          candidates: [{ slot: 'gapColumn', rect: { x: right - psize.width, y: top + tsize.height + LINE_GAP, w: psize.width, h: psize.height }, penalty: 0 }],
        });
      }
    }
    if (capsuleText !== undefined) {
      const d = deltaVsTarget[row.id]!;
      const tone = deltaTone(row, d);
      const tsize = measure(capsuleText, capsuleFont);
      const labelId = `delta:${row.id}`;
      capsuleLabelIds.set(labelId, tone);
      if (!cols) labelRequests.push({
        id: labelId,
        kind: 'annotation', role: composedTextRole(capsuleText, 'note'),
        owner,
        text: capsuleText,
        lines: [capsuleText],
        font: capsuleFont,
        priority: PRIORITY.extreme,
        candidates: [
          {
            slot: 'rowEnd',
            rect: {
              x: capsuleX,
              y: stacked ? rowY + bw + 3 : rowCenter - tsize.height / 2,
              w: tsize.width,
              h: tsize.height,
            },
            penalty: 0,
          },
        ],
      });
      placedAnnotations.push({
        id: `delta-target:${row.id}`,
        kind: 'delta',
        computedText: capsuleText,
        tone,
        nodeIds: [],
        labelId,
        // '+7 vs target' is a subtraction, and both of its operands are right
        // here, so the derivation lists them as inputs: a receipt for the one
        // number on a bullet row a reader cannot get any other way.
        derivation: {
          basis: 'derived',
          op: 'annotation-delta@1',
          inputs: [
            { ref: `${row.id}:value`, value: row.value },
            { ref: `${row.id}:target`, value: row.target },
          ],
          raw: d,
        },
      });
    }

    // row label (left band, right-aligned toward the rows)
    if (labelOn('category')) {
      const cl = catLines[ri]!;
      labelRequests.push({
        id: `category:${row.id}`,
        kind: 'category',
        owner,
        text: row.label,
        ...fittedLabel(cl, catFont),
        font: catFont,
        priority:
          PRIORITY.endpoint + (highlights.has(row.id) ? PRIORITY.highlightBonus : 0),
        candidates: [
          {
            slot: 'left',
            rect: {
              x: stacked ? plot.x : rowLabelX(plot0.x, cols ? cp.colLeftW : catBandW, cl.w, options.rowLabels?.align ?? 'left'),
              y: stacked ? cardTop : cols ? rowCenter - cp.colBlockH(ri) / 2 : rowCenter - cl.h / 2,
              w: cl.w,
              h: cl.h,
            },
            penalty: 0,
          },
        ],
      });
      const direction = cols ? cp.colDirections[ri] : null;
      if (direction) {
        const dsize = measure(direction, cp.noteFont);
        const id = `direction:${row.id}`;
        columnFonts.set(id, cp.noteFont);
        columnInks.set(id, { token: 'inkMuted' });
        labelRequests.push({
          id, kind: 'annotation', role: 'note', owner, text: direction, lines: [direction], font: cp.noteFont, priority: PRIORITY.interior, pad: 0,
          candidates: [{ slot: 'left', rect: { x: rowLabelX(plot0.x, cp.colLeftW, dsize.width, options.rowLabels?.align ?? 'left'), y: rowCenter - cp.colBlockH(ri) / 2 + cl.h + LINE_GAP, w: dsize.width, h: dsize.height }, penalty: 0 }],
        });
      }
    }

    marks.rows.push({ id: row.id, bandNodeIds, barNodeId, targetNodeId, rect: rowRect });
  });

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: capsuleTexts.size > 0 ? capsuleLabelPad : 2,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  applyValueAxisTitleInk(solved.placed);
  pushAll(warnings, solved.warnings);
  const hiddenCapsules = solved.placed.filter((label) => label.id.startsWith('delta:') && label.hidden);
  if (hiddenCapsules.length > 0) {
    warnings.push({
      code: 'bullet-delta-overflow',
      severity: 'warn',
      message: `${hiddenCapsules.length} target delta label${hiddenCapsules.length === 1 ? '' : 's'} cannot fit at this canvas size`,
      suggest: 'increase chart height or suppress delta annotations explicitly',
    });
  }
  // The names on the rows and the columns never cost a label: where one would hide, the key names
  // the bands again, and then the rows draw as before.
  if (rowMode && solved.placed.some((label) => label.hidden)) return layoutBullet(data, { ...options, [ROW_KEY_OFF]: true } as BulletOptions);
  if (cols && solved.placed.some((label) => label.hidden)) return layoutBullet(data, { ...options, targetColumns: false });
  const hiddenTargets = solved.placed.filter((label) => label.id.startsWith('target-value:') && label.hidden);
  if (hiddenTargets.length > 0) {
    warnings.push({
      code: 'bullet-target-overflow',
      severity: 'warn',
      message: `${hiddenTargets.length} target value${hiddenTargets.length === 1 ? '' : 's'} cannot print by ${hiddenTargets.length === 1 ? 'its tick' : 'their ticks'} at this canvas size`,
      suggest: `give each row ${naturalRowH}px (increase chart height) or turn annotation labels off`,
    });
  }
  // semantic tone on delta capsules (deterministic post-solve ink override)
  for (const label of solved.placed) {
    const tone = capsuleLabelIds.get(label.id);
    if (tone) label.ink = { token: tone === 'neutral' ? 'ink' : tone };
    const ink = columnInks.get(label.id);
    if (ink) label.ink = ink;
  }

  // ---- annotation pass: {categoryId: rowId} → bar end / value ----
  const zeroXById = new Map<Id, number>(rows.map((row, ri) => [row.id, zeroX[ri]!]));
  const resolve = (ref: AnchorRef) => resolveBulletAnchor(ref, anchorByRow, zeroXById);
  const annResult = runAnnotatePass({
    annotations, valueAxis: 'horizontal',
    resolve,
    defaultSpan:
      rows.length >= 2 ? { from: rows[0]!.id, to: rows[rows.length - 1]!.id } : undefined,
    occupied,
    plot: cagrColW ? { ...plot, w: plot0.x + plot0.w - plot.x } : plot,
    bandCeiling: plot0.y,
    theme,
    measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    valueLinePercentLevels: options.unit === '%' || rows.some(row => row.value !== null) && rows.every(row => row.value === null || row.isPct),
    solveCtx,
    ...(axisScale ? { xScale: axisScale } : {}),
    ...categoryTargetFields(rows.map((row) => row.id), plot, (i) => band.position(i) + band.bandwidth / 2, 'y'),
  });
  const bandTries = (options as { [BAND_TRIES]?: number })[BAND_TRIES] ?? 0;
  if (annResult.bandNeed > 0 && bandTries < 2) {
    return layoutBullet(data, {
      ...options,
      [BAND_PAD]: rawBandPad + Math.ceil(annResult.bandNeed),
      [BAND_TRIES]: bandTries + 1,
    } as BulletOptions);
  }
  pushAll(warnings, annResult.warnings);

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  // A hair rule in the grid colour halfway between two rows, behind every mark. A target value
  // prints in that gap, so the rule breaks round each label it would cross. A gap that holds a
  // level annotation line (a difference arrow) keeps no rule, which would read as part of the arrow.
  if (!compact) {
    const ruleNodes: SceneNode[] = [];
    const contentBottom = (ri: number) => stacked
      ? plot.y + ri * band.step + cardHeaderH + 3 + cardBandH + (cardFooterH > 0 ? 3 + cardFooterH : 0)
      : band.position(ri) + band.bandwidth + tickAir;
    const rowTop = (ri: number) => stacked ? plot.y + ri * band.step : band.position(ri) - nameAir;
    for (let ri = 0; ri + 1 < rows.length; ri++) {
      const top = contentBottom(ri);
      const bottom = rowTop(ri + 1);
      if (bottom - top < 2) continue;
      const y = (top + bottom) / 2;
      if (annResult.nodes.some((node) => node.t === 'line' && Math.abs(node.y1 - node.y2) < 0.5 && Math.abs(node.y1 - y) < 4)) continue;
      const cuts = allLabels
        .filter((label) => !label.hidden && label.rect.y - 1 <= y && y <= label.rect.y + label.rect.h + 1)
        .map((label) => [label.rect.x - REFERENCE_LABEL_CLEARANCE, label.rect.x + label.rect.w + REFERENCE_LABEL_CLEARANCE] as const)
        .sort((a, b) => a[0] - b[0]);
      let from = plot0.x;
      const end = plot0.x + plot0.w;
      const pieces: [number, number][] = [];
      for (const [cutFrom, cutTo] of cuts) {
        if (cutFrom > from) pieces.push([from, Math.min(cutFrom, end)]);
        from = Math.max(from, cutTo);
      }
      if (from < end) pieces.push([from, end]);
      pieces.filter(([a, b]) => b - a >= 2).forEach(([a, b], pi) => ruleNodes.push({
        t: 'line', id: `rowRule:${rows[ri + 1]!.id}${pi ? `:${pi}` : ''}`, x1: a, y1: y, x2: b, y2: y,
        stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'rowRule',
      }));
    }
    nodes.splice(frameResult.nodes.length, 0, ...ruleNodes);
  }
  spliceAnnotationNodes(nodes, annResult.nodes);
  // attainment paints after placement; outside values read against the actual wash.
  for (const label of allLabels) {
    if (label.hidden || label.kind !== 'point' || label.slot.startsWith('inside')) continue;
    const wash = annResult.nodes.find(node => node.t === 'rect' && node.part === 'attainment' && rectsOverlap(node.rect, label.rect));
    if (wash?.t !== 'rect') continue;
    if (rectContains(wash.rect, label.rect)) label.ink = contrastInkPaint(wash.fill);
    else { label.halo = true; label.ink = { token: 'ink' }; }
  }
  const labelNodes = labelsToNodes(theme, allLabels, (l) =>
      columnFonts.get(l.id) ?? (l.kind === 'category'
        ? catFont
        : l.id.startsWith('delta:')
          ? capsuleFont
          : l.kind === 'point'
            ? valueFont
            // A target value is drawn in the font it was placed in.
            : l.id.startsWith('target-value:')
              ? targetFont
              : labelFont),
    );
  asColumnHeads(labelNodes);
  pushAll(nodes, labelNodes);

  const a11yRows = rows
    .map((row) => {
      const f = rowFmt(row);
      const v = row.value !== null ? f(row.value) : 'n/a';
      const t =
        row.target !== null
          ? ` vs ${targetWord(options)} ${f(row.target)}` +
            (deltaVsTarget[row.id] !== undefined
              ? ` (${deltaText(row, deltaVsTarget[row.id]!)}, ${chartString(options, ({good: 'toneGood', bad: 'toneBad', warn: 'toneWarn', neutral: 'toneNeutral'} as const)[deltaTone(row, deltaVsTarget[row.id]!)])})`
              : '')
          : '';
      return `${row.label} ${v}${t}`;
    })
    .join('; ');
  const a11yDesc =
    chartString(options, 'bulletDescStart', { v1: rows.length }) +
    chartString(options, 'bulletTargetTick', { v1: targetWord(options) }) +
    (anyBands
      ? chartString(options, 'bulletShadingDesc')
      : '') +
    (sharedScale || rows.length < 2
      ? ''
      : chartString(options, 'bulletSeparateScale')) +
    ` ${a11yRows}.`;

  return {
    type: 'bullet',
    ...(paintWarningRules.length ? { paintWarningRules } : {}),
    size,
    sizing: rowSizing('bullet', size, {
      chromeH: size.height - availH,
      minimumRowsH: rows.length * Math.min(
        Math.max(stacked ? cardPitch : minimumPitch, maxOf(catLines.map(label => label.h))),
        stacked && plot0.w - fitted.width - CAT_BAND_GAP - capsuleColW - CAPSULE_GAP - cagrColW >= 80
          ? Math.max(minimumPitch, maxOf(fitted.labels.map(label => label.h))) : Infinity,
      ),
      naturalRowsH: rows.length * naturalRowH,
      // The compact mark prints no value, so the value's width sets no floor there.
      // Stacked cards measure their name/value row and keep at least 160 px of mark width.
      // The unlabelled density:'compact' mark retains its separate 120 px contract.
      // The type floor moved to 320 for the percent-of-target rows (core.ts); these layouts keep 480.
      // The columns give way below their fit, so the side-by-side rows set the floor.
      minWidth: compact ? 0 : Math.max(0, stacked ? size.width - plot.w + Math.max(160, catBandW + Math.max(maxPosW, maxNegW) + CAT_BAND_GAP) : size.width - sidePlotW + Math.max(80, maxOf(rows.map(row => {
        const text = labelOn('point') ? valueTextOf(row) : undefined;
        return text ? measure(text, valueFont).width + 2 * LABEL_GAP : 0;
      })))),
    }),
    plot,
    scene: nodes,
    labels: allLabels,
    axes: [
      {
        axis: 'y',
        ...(baselineId ? { baselineNodeId: baselineId } : {}),
        ticks: rows.map((row, i) => ({
          at: row.id,
          pos: band.center(i),
          labelId: labelOn('category') ? `category:${row.id}` : undefined,
        })),
      },
      ...axes,
    ],
    annotations: [...placedAnnotations, ...annResult.placed],
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: { deltaVsTarget },
    a11y: {
      titleCounts: [structureCount('rows', rows.length, chartString(options, 'kpisCount', { v1: rows.length }))],
      title: accessibleTitle(options.title, chartString(options, 'bulletTitle', { v1: rows.length, v2: targetWord(options) })),
      counts: [structureCount('rows', rows.length, chartString(options, 'kpiRowsCount', { v1: rows.length }))],
      desc: a11yDesc,
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annResult.decisions],
    },
  };

}

/**
 * The percent-of-target branch: its own key and frame, then the
 * rows in targetScale.ts. Authored bands, a value axis and annotations name
 * value units, which this scale does not draw, so each says so and is left out.
 */
function layoutBulletOnTargetScale(
  data: BulletData,
  options: BulletOptions,
  ctx: {
    rows: NormRow[];
    theme: Theme;
    size: { width: number; height: number };
    measure: TextMeasurer;
    margin: Margin;
    occupied: OccupiedIndex;
    warnings: LintWarning[];
    highlights: Set<Id>;
    labelOn: (kind: LabelKind) => boolean;
    rowFmt: (row: NormRow) => (v: number) => string;
    deltaText: (row: NormRow, d: number) => string;
    deltaBody: (row: NormRow, d: number) => string;
    deltaTone: (row: NormRow, d: number) => 'good' | 'bad' | 'warn' | 'neutral';
    deltaVsTarget: Record<Id, number>;
  },
): Geometry<BulletMarks, BulletDerived> {
  const { rows, theme, size, measure, occupied, warnings, rowFmt } = ctx;
  if (rows.some((row) => row.bands.length > 0)) {
    warnings.push({
      code: 'bullet-bands-target-scale',
      severity: 'info',
      message: 'the percent-of-target scale draws its three shared bands; the rows\' own bands were not drawn',
    });
  }
  if (options.valueAxis?.show || options.valueAxis?.min !== undefined || options.valueAxis?.max !== undefined) {
    warnings.push({
      code: 'value-axis-target-scale',
      severity: 'warn',
      message: 'valueAxis is ignored on the percent-of-target scale, which draws its own axis from 0 to 120%',
    });
  }
  if ((options.annotations ?? []).length > 0) {
    warnings.push({
      code: 'bullet-annotations-target-scale',
      severity: 'warn',
      message: 'annotations name value units and are not drawn on the percent-of-target scale',
    });
  }
  const legend = options.density === 'compact' || options.legend === 'none'
    ? undefined
    : { options: normalizeLegendOption(options.legend, { position: 'top' }), items: targetBandLegendItems(rows.map(row => row.direction), targetWord(options), options) };
  const frame = solveFrame(
    { size, margin: ctx.margin, cardGaps: true, ...frameTextOptions(options), legend, theme: cardFrameTheme(theme, options, size.width), measure },
    occupied,
  );
  const valueText = (row: TargetScaleRow): string | null => {
    if (row.value === null || row.meta?.label === false) return null;
    const base = rowFmt(row as NormRow)(row.value);
    return typeof row.meta?.label === 'string' ? row.meta.label.replace(/\$\{value\}/g, base) : base;
  };
  // The note breaks after the target, before its hint (' · lower is better').
  const targetParts = (row: TargetScaleRow): string[] => [
    row.target === null ? `no ${targetWord(options)}` : `${targetWord(options)} ${rowFmt(row as NormRow)(row.target)}`,
    ...(row.direction === 'lowerIsBetter' ? [chartString(options, 'lowerBetterHint')] : []),
  ];
  return layoutTargetScale({
    rows, options, theme, size, measure, frame, occupied, warnings,
    highlights: ctx.highlights,
    labelOn: ctx.labelOn,
    valueText,
    targetText: (row) => targetParts(row).join(''),
    targetParts,
    deltaText: (row, d) => ctx.deltaText(row as NormRow, d),
    deltaBody: (row, d) => ctx.deltaBody(row as NormRow, d),
    deltaTone: (row, d) => ctx.deltaTone(row as NormRow, d),
    deltaVsTarget: ctx.deltaVsTarget,
    grow: (chromeH, rowsH) => {
      const height = rowDrivenHeight({ options, width: size.width, height: size.height, chromeH, rowsH });
      return height === undefined ? undefined : layoutBullet(data, { ...options, size: { width: size.width, height } });
    },
  });
}
