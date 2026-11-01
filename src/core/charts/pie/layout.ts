import { fmtPathNumber as pf } from '../../curve';
import { DEFAULT_REST_MIN, DEFAULT_TOP_N, restDetailsWarning, restLabel, restSum, topNCut } from '../topN';
import { chartPalette, chartTheme } from '../chartEnv';
import { chartString } from '../../strings/pie';
import { structureCount } from '../../structureCounts';
/**
 * Pie / doughnut chart —
 * single-series share-of-total, keeping the largest `DEFAULT_TOP_N.n` slices
 * by default, the rest merged into Others. Slices run clockwise from 12 o'clock,
 * sorted descending by default (largest first). The
 * label signature: compound "value (percent)" labels inside near
 * the outer edge when the slice is wide enough, cascading to backed rects,
 * then sliding outside along the rim with elbow leaders. Up to four displayed
 * slices default to named outside labels; outside labels
 * spread vertically per side (spread1D) and never overlap. Doughnut holes
 * >= 0.35 carry the total in the center; explode offsets slices radially;
 * nominal pies default to categorical theme hues; ordered/top-N pies retain a
 * perceptually separated monochrome ramp tinted from the theme highlight.
 */

import type { AnchorResolution } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { pieComparisonLayout, pieComparisonRoom } from './comparisons';
import { warnSpreadOverflow } from '../../collide';
import { resolvePaintWarnings } from '../../paintWarnings';
import { seriesValueFormatter, shareSetFormatter } from '../../format';
import { warnIncompleteComposition, warnShareRoundingDrift } from '../../dataGaps';
import { roundWholes, type RoundingAdjustment } from '../../shareRounding';
import { seriesRasterFormatter, formatterFromExample, parseFormatExample, shareFormatExample } from '../../formatSpec';
import { cleanFloat, round2, type Point, type Rect, type Size } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { fitText } from '../../label/fitText';
import { markOutlineOff, namesOnly, separationStroke, sliceOutlineOff } from '../../markVisibility';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { stepDownFont } from '../../label/rowFit';
import { textScaleOf } from '../../typeFloors';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SlotCandidate,
  type SolveCtx,
} from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  normalizeCategory,
  normalizeSeriesValues,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { authoredNotes, frameTextOptions, valueNoteLine, normalizeLegendOption, settledAutoHeight, solveFrame, type FrameInput, type LegendItemInput } from '../../frame';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { disclosureNote, disclosuresShown } from '../../notes';
import { hiddenValueNoteHeight } from '../../staticFooter';
import { defaultMeasurer, wrapText, type FontSpec } from '../../text';
import {
  canvasMargin,
  markRolePaint,
  paintColor,
  panelTypeClass,
  seriesPaint as themeSeriesPaint,
  emphasisLabelTheme,
  emphasisWeight,
  strokeToken,
} from '../../theme';
import type { AnchorRef, Annotation } from '../../types/annotations';
import { cellMeta, cellValue, isPctCell, type Id } from '../../types/cell';
import type { Category, ChartData } from '../../types/data';
import { DEFAULT_OTHERS_SHADE } from '../../othersShade';
import type { LabelContent, LabelKind, LegendOptions, PieOptions } from '../../types/options';
import type {
  AxisGeometry,
  Geometry,
  LintWarning,
  Paint,
  PaintWarningRule,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import { AUTO_LEGEND } from '../../legendPolicy';
import { contentSizing } from '../../sizing';
import { pieLabelContent, pieCenterLines } from './labels';
import { labelAngle, placeColumns, placeRing, RING_GAP, type RingItem } from './ring';
import { composedTextRole } from '../../textRole';
import { maxOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface PieMarks {
  slices: {
    categoryId: Id;
    /** Scene path node of the slice. */
    nodeId: Id;
    /** Degrees clockwise from 12 o'clock, normalized 0–360. */
    midAngle: number;
    value: number;
    /** Fraction of the total, 0–1. */
    share: number;
  }[];
}

export interface PieDerived {
  total: number;
  /** The slices the total adds, keyed by the series. */
  stackParts: Record<Id, Record<Id, number>>;
  /** Percent of total per category id (0–100). */
  shares: Record<Id, number>;
  /** rounding 'sum-consistent': the shares printed off their nearest rounding. */
  roundingAdjustments?: RoundingAdjustment[];
}

/** The smallest radius a pinned pie draws at before it refuses (refuse-less). */
const PIE_MIN_RADIUS = 36;
/** The pie's static height floor; under it a pinned pie draws in the compact band. */
const PIE_STATIC_MIN_HEIGHT = 320;
/** More drawn slices than this warn (pie-too-many-slices). */
export const PIE_SLICE_LIMIT = 8;
/**
 * Under a new target with an automatic height the circle's diameter stays at
 * most 38% of the canvas width, so a slide-wide pie stays a chart, not a
 * poster; a card up to about 480 px may take 44%, up to 210 px. A canvas whose
 * height the author fixed gets no cap: the pie fills the plot, so a fixed frame
 * keeps no white space round the ring.
 */
const diameterCapFor = (width: number, ring: boolean): number => Math.max(0.38 * width, Math.min((ring ? DOUGHNUT_CAP_SHARE : 0.44) * width, 210));
/**
 * A doughnut's ring may take this share of a narrow canvas: the hole holds the
 * total, and at 400 px the ring takes half the width.
 */
const DOUGHNUT_CAP_SHARE = 0.5;
/** Horizontal reserve on each side of the circle for outside labels. */
const OUTSIDE_MARGIN = 90;
/**
 * Under a new target a highlight paints the other slices in a grey ramp: the
 * neutral mark washed this far toward the page, darkest first.
 * The wash is a paint recipe, so a repaint builds the ramp from the neutral of
 * the theme painted in. Each step stays GREY_RAMP_FLOOR from the page, the
 * floor below which a pale slice would get a separation outline, so the ramp
 * ends at the palest grey that needs none (#D8DCE0 in the default theme).
 */
const GREY_RAMP_FIRST = 0.2;
const GREY_RAMP_LAST = 0.74;
const GREY_RAMP_FLOOR = 1.4;
/** Slices at least this wide (degrees) try an inside label first. */
const INSIDE_MIN_DEG = 18;
/** Doughnut holes at least this fraction show the center total. */
const CENTER_TEXT_MIN = 0.35;
/** Under a new target the gap from the rim to a label column: this share of the plot width, COLUMN_GAP_MIN to COLUMN_GAP_MAX. */
const COLUMN_GAP_RATIO = 0.036;
const COLUMN_GAP_MIN = 8;
const COLUMN_GAP_MAX = 36;
/** A name line in a label column takes this share of the plot width, and up to the widest share when two lines do not hold the name. */
const COLUMN_NAME_SHARE = 0.3;
const COLUMN_NAME_WIDEST = 0.4;
/** Smallest natural canvas height of a pie whose labels all sit in columns: the pie floor in sizing.ts. */
const MIN_COLUMN_HEIGHT = 320;
/** Separator between the value and the share on one outside label line. */
const VALUE_SHARE_SEP = ' · ';
/** Least room above and below the circle in a pie's natural height. */
const CIRCLE_PAD = 8;
/** Gap between a label column's overhang past the circle and the plot edge. */
const OVERHANG_GAP = 12;
/** Largest size of a doughnut's centre total under a new target. */
const CENTER_VALUE_MAX = 24;
/** A doughnut's centre total is at most this share of the ring's outer radius, and never below the label size. */
const CENTER_VALUE_RATIO = 0.16;

/**
 * The lines of a column label: the name lines, then the value and the share
 * on one line ("35.6m · 37%"), then any series name.
 */
function outsideLines(content: LabelContent, name: string, value: string, share: string, series: string): string[] {
  const lines: string[] = [];
  const both = content.includes('absolute') && content.includes('percent');
  for (const c of content) {
    if (c === 'category') lines.push(...name.split('\n'));
    else if (c === 'absolute') lines.push(both ? `${value}${VALUE_SHARE_SEP}${share}` : value);
    else if (c === 'percent') { if (!both) lines.push(share); }
    else if (c === 'series') lines.push(series);
  }
  return lines;
}



/**
 * Whether a label box lies wholly on one slice: every point sampled along
 * its four edges within the ring and within the slice's angles. Sampling the
 * edges, not just the corners, covers the doughnut hole and slices wider
 * than half the circle, where an edge can leave the wedge between corners.
 */
function rectOnWedge(rect: Rect, g: Pick<SliceGeom, 'a0' | 'sweep' | 'scx' | 'scy'>, ri: number, r: number): boolean {
  const corners = [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h },
  ];
  for (let edge = 0; edge < 4; edge++) {
    const a = corners[edge]!;
    const b = corners[(edge + 1) % 4]!;
    for (let step = 0; step < 8; step++) {
      const x = a.x + ((b.x - a.x) * step) / 8 - g.scx;
      const y = a.y + ((b.y - a.y) * step) / 8 - g.scy;
      const d = Math.hypot(x, y);
      if (d > r || d < ri) return false;
      const angle = ((((Math.atan2(x, -y) * 180) / Math.PI - g.a0) % 360) + 360) % 360;
      if (angle > g.sweep) return false;
    }
  }
  return true;
}

interface SliceGeom {
  cat: Category;
  v: number;
  share: number;
  a0: number;
  a1: number;
  mid: number;
  sweep: number;
  /** Exploded slice center (equals cx/cy when not exploded). */
  scx: number;
  scy: number;
  paint: Paint;
  fillCss: string;
  isOthers: boolean;
  format?: string;
  labelOverride?: string | false;
  priority?: number;
}

/** Slices whose label the chart could not seat, named in the note line. */
const UNLABELLED = Symbol('pieUnlabelled');
const FIXED_PASS = Symbol('pieFixedPass');
/** The ring drops the smallest label without a good seat, never a lower one to free a seat. */
const BAD_FIRST = Symbol('pieBadFirst');
/** The pass gives a doughnut's centre total priority over the outside-label reserve. */
const CENTRE_FIRST = Symbol('pieCentreFirst');
type PiePassOptions = PieOptions & { [UNLABELLED]?: Map<Id, string>; [FIXED_PASS]?: true; [BAD_FIRST]?: true; [CENTRE_FIRST]?: true };

/**
 * A slice whose label found no seat is named in the note
 * line with its value and share, and gets no leader. The note takes footer
 * height and so shrinks the ring, so the chart is laid out again with it,
 * until the named set holds (one pass per slice at most). Every share then prints
 * once, so a sum-consistent set adds to 100%.
 */
export function layoutPie(
  data: ChartData,
  options: PieOptions = {},
): Geometry<PieMarks, PieDerived> {
  const layout = layoutPieOrdered(data, options);
  if (!layout.centreLost) return layout.geometry;
  // The settled layout drops the total that a larger ring could hold. The whole layout is set again with
  // the total first, and stands only when it draws the total; else the first layout stands unchanged.
  const centred = layoutPieOrdered(data, { ...options, [CENTRE_FIRST]: true } as PiePassOptions);
  return centred.centreLost ? layout.geometry : centred.geometry;
}

function layoutPieOrdered(
  data: ChartData,
  options: PiePassOptions,
): { geometry: Geometry<PieMarks, PieDerived>; centreLost: boolean } {
  const priority = drivePie(data, options);
  if (!priority.swapped) return priority;
  // Freeing a seat for a higher label changes the note, and so the height the driver settles
  // on. The order that keeps more labels wins; on a tie, the priority order.
  const plain = drivePie(data, { ...options, [BAD_FIRST]: true } as PiePassOptions);
  return plain.lost < priority.lost ? plain : priority;
}

function drivePie(
  data: ChartData,
  options: PiePassOptions,
): { geometry: Geometry<PieMarks, PieDerived>; lost: number; swapped: boolean; centreLost: boolean } {
  let named = new Map<Id, string>();
  let swapped = false;
  const run = (passOptions: PiePassOptions) => {
    const result = layoutPiePass(data, passOptions);
    swapped ||= result.swapped;
    return result;
  };
  let pass = run(options);
  // A settled height assumed every slice keeps its label; a hidden one takes the iterated path.
  if (pass.unlabelled.size > 0 && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false) {
    options = { ...options, [FIXED_PASS]: true } as PiePassOptions;
    pass = run(options);
  }
  // A grid panel has no footer of its own to spare: its grid speaks for it.
  if (panelTypeClass(options) !== undefined) return { geometry: pass.geometry, lost: pass.unlabelled.size, swapped, centreLost: pass.centreLost };
  // A note that wraps to one more line shrinks the ring and can unseat one more
  // label, so the note is set again until it names every slice the last pass
  // left unlabelled, so nothing is lost silently. Each round names at least one more
  // slice, so it ends within one round per slice.
  const owed = data.categories.length;
  for (let round = 0; round <= owed && [...pass.unlabelled.keys()].some((id) => !named.has(id)); round++) {
    named = new Map([...named, ...pass.unlabelled]);
    pass = run({ ...options, [UNLABELLED]: named } as PiePassOptions);
  }
  // That note prints only on request (notes.show 'disclosure'). An open height still offers the ring
  // the height its lines would take, never more, and keeps it when every slice then has its label.
  if (named.size > 0 && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && !disclosuresShown(options)) {
    const room = hiddenValueNoteHeight(pass.geometry);
    const { width, height } = pass.geometry.size;
    const taller = room > 0 ? run({ ...options, size: { width, height: Math.ceil(height + room) } } as PiePassOptions) : undefined;
    if (taller && taller.unlabelled.size === 0) return { geometry: taller.geometry, lost: 0, swapped, centreLost: taller.centreLost };
  }
  return { geometry: pass.geometry, lost: new Set([...named.keys(), ...pass.unlabelled.keys()]).size, swapped, centreLost: pass.centreLost };
}

function layoutPiePass(
  data: ChartData,
  options: PiePassOptions,
): { geometry: Geometry<PieMarks, PieDerived>; unlabelled: Map<Id, string>; swapped: boolean; centreLost: boolean } {
  const named = options[UNLABELLED] ?? new Map<Id, string>();
  let swapped = false;
  const warnings: LintWarning[] = [];
  const theme = chartTheme(options);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const highlights = new Set(resolveHighlight(options.highlight));
  const density = options.labelDensity ?? 'smart';

  // ---- normalize (exactly one data series; extras ignored with a warning) ----
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'pie requires at least one category');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'pie requires exactly one series');
  }
  const dataSeries = data.series.filter((s) => s.role !== 'reference');
  const ser = dataSeries[0] ?? data.series[0]!;
  if (!ser.id) throw new NormalizeError('missing-id', 'series[0]', 'series requires an id');
  if (data.series.length > 1) {
    warnings.push({
      code: 'pie-single-series',
      severity: 'warn',
      message:
        `pie plots exactly one series — using '${ser.id}', ignoring ` +
        data.series
          .filter((s) => s !== ser)
          .map((s) => `'${s.id}'`)
          .join(', '),
      owner: { seriesId: ser.id },
      suggest: 'use one series per pie, or a column/bar chart for multi-series comparison',
    });
  }
  const sid = ser.id;
  let cats: Category[] = data.categories.map((c, i) => normalizeCategory(c as never, i));
  const cells = normalizeSeriesValues(ser, cats, 0);
  // A percent options.format sets the precision of the computed shares. It prints the slice values too
  // only when they are percents (a % unit, percent cells, or values adding to 100); counts or money would read as percent.
  const shareExample = shareFormatExample(options);
  const valuesArePercent = [options.unit, ser.unit].some((unit) => unit?.includes('%'))
    || cells.every((cell) => cell === null || isPctCell(cell))
    || Math.abs(cells.map(cellValue).reduce<number>((sum, v) => sum + Math.max(0, v ?? 0), 0) - 100) <= 0.05;
  const valueExample = shareExample && !valuesArePercent ? undefined : options.format;
  if (shareExample && !valuesArePercent) {
    warnings.push({
      code: 'percent-format-on-values',
      severity: 'warn',
      message: `options.format '${options.format}' is a percent format, so it sets how the computed shares print; the slice values are not percents and print in the automatic format`,
      suggest: 'format the slice values with series[].format or a cell format, and keep the percent options.format for the shares',
      field: ['options', 'format'],
    });
  }
  const formats = seriesRasterFormatter(valueExample, cells.map(cellValue), options.locale?.language, options.unit, options.target);
  // The slices are one series: one precision for them all (seriesValueFormatter), not one per value.
  const fmt = ser.format || ser.unit ? formats.forSeries(ser) : valueExample
    ? formatterFromExample(valueExample, options.locale?.language)
    : seriesValueFormatter(cells.map(cellValue), options.locale?.language);
  const sharesFormatter = (percents: Iterable<number>): { decimals: number; format: (percent: number) => string } =>
    shareExample ? { decimals: parseFormatExample(shareExample).decimals, format: formatterFromExample(shareExample, options.locale?.language) }
      : shareSetFormatter(percents, options.locale?.language);
  const sliceText = (slice: { v: number; format?: string }): string => slice.format ? formatterFromExample(slice.format, options.locale?.language)(slice.v) : fmt(slice.v);
  interface Slice {
    cat: Category;
    v: number | null;
    fill?: string;
    format?: string;
    labelOverride?: string | false;
    priority?: number;
    isOthers: boolean;
  }
  // A slice with no value leaves the whole unknown: the shares below are of
  // the known slices only, and the reader is told so.
  warnIncompleteComposition(warnings,
    cats.filter((_, ci) => cellValue(cells[ci]!) === null).map((cat) => cat.label ?? cat.id),
    'the whole is not known, so the printed shares are of the known slices only');
  // A negative slice is not drawn, so the sum of the drawn slices is not the total of the data.
  const negatives: string[] = [];
  let slices: Slice[] = cats.map((cat, ci) => {
    const cell = cells[ci]!;
    const meta = cellMeta(cell);
    let v = cellValue(cell);
    if (v !== null && v < 0) {
      warnings.push({
        code: 'pie-negative-value',
        severity: 'warn',
        message: `category '${cat.id}': negative value ${v} cannot be a share — slice dropped`,
        owner: { seriesId: sid, categoryId: cat.id },
        suggest: 'use a waterfall or bar chart for signed contributions',
      });
      negatives.push(cat.label ?? cat.id);
      v = null;
    }
    return {
      cat,
      v,
      fill: meta?.fill,
      format: meta?.format,
      labelOverride: meta?.label,
      priority: meta?.priority,
      isOthers: false,
    };
  });

  // ---- sort (default desc: largest slice first; 'sheet' preserves) ----
  const catSort = options.sort?.categories ?? 'desc';
  if (catSort !== 'sheet') {
    if (catSort === 'reverse') slices = [...slices].reverse();
    else {
      const dir = catSort === 'asc' ? 1 : -1;
      slices = [...slices]
        .map((s, i) => ({ s, i }))
        .sort((a, b) => ((a.s.v ?? 0) - (b.s.v ?? 0)) * dir || a.i - b.i)
        .map((x) => x.s);
    }
  }

  // ---- topN: keep n largest, aggregate rest into 'Others' (always last) ----
  // The default keeps the seven largest and merges the rest only when it holds
  // three slices at least: a merge of one or two hides a named category for
  // no room gained. An authored topN always applies.
  const topN = options.topN ?? DEFAULT_TOP_N;
  if (topN && topN.n > 0 && slices.length > topN.n && (options.topN !== undefined || slices.length - topN.n >= DEFAULT_REST_MIN)) {
    const cut = topNCut(slices.map((s) => Math.abs(s.v ?? 0)), topN.n);
    const kept = cut.kept.map((i) => slices[i]!);
    const dropped = cut.dropped.map((i) => slices[i]!);
    if (topN.rest === false || dropped.length === 0) {
      slices = kept;
    } else {
      let othersId: Id = 'others';
      while (slices.some((s) => s.cat.id === othersId)) othersId = `_${othersId}`;
      slices = [...kept, { cat: { id: othersId, label: restLabel(topN, options.strings, dropped.length) }, v: restSum(dropped.map((s) => s.v)), isOthers: true }];
      const lostDetails = restDetailsWarning({ categories: data.categories, series: [ser] }, new Set(kept.map((s) => s.cat.id)));
      if (lostDetails) warnings.push(lostDetails);
    }
  }

  // ---- lint: too many slices ----
  if (slices.length > PIE_SLICE_LIMIT) {
    warnings.push({
      code: 'pie-too-many-slices',
      severity: 'warn',
      message: `${slices.length} slices exceed the ${PIE_SLICE_LIMIT}-slice readability limit`,
      suggest: `aggregate with topN: { n: 7, rest: true } or switch to a bar chart`,
    });
  }

  // ---- derive: total + shares ----
  const total = slices.reduce((a, s) => a + (s.v ?? 0), 0);
  if (total <= 0) {
    throw new NormalizeError('empty-data', 'series', 'pie requires a positive total');
  }
  const shares: Record<Id, number> = emptyIdRecord();
  for (const s of slices) shares[s.cat.id] = cleanFloat(((s.v ?? 0) / total) * 100);

  // ---- paints (categorical hues or perceptually stepped sequential tint) ----
  const paintCss = (p: Paint): string => paintColor(theme, p);
  const rampCount = Math.max(1, slices.filter((s) => !s.isOthers).length);
  const apartShade = (options.othersShade ?? DEFAULT_OTHERS_SHADE) === 'apart';
  const hasOthers = slices.some((s) => s.isOthers);
  const withOthers = hasOthers
    ? { withOthers: true as const, ...(apartShade ? { othersShade: 'apart' as const } : {}) }
    : {};
  // A highlight keeps the story slices in the series hues and steps every
  // other slice back into a grey ramp.
  const greyRest = slices.some((s) => highlights.has(s.cat.id));
  const greyCount = slices.filter((s) => !highlights.has(s.cat.id) && (s.v ?? 0) > 0).length;
  // One ramp at every slice count: hues would claim a difference the slices do not have.
  const colorMode = options.colors ?? 'sequential';
  // The ramp base is series 1, or the palette's first rank.
  const rampBase: Paint = themeSeriesPaint(0, paletteRamp ? options.palette : undefined);
  const paintWarningRules: PaintWarningRule[] = colorMode === 'sequential' && !greyRest
    ? [
      { kind: 'pie-ramp-crowded', base: rampBase, count: rampCount, ...withOthers, before: warnings.length },
      ...(hasOthers && !apartShade ? [{ kind: 'others-shade-unavailable' as const, base: rampBase, before: warnings.length }] : []),
    ]
    : [];
  warnings.push(...resolvePaintWarnings(theme, paintWarningRules));
  const rampPaint = (index: number): Paint => ({
    token: 'token' in rampBase ? rampBase.token : 'series-1',
    theme: { kind: 'pie-ramp', base: rampBase, index, count: rampCount, ...withOthers },
  });
  let rampIdx = 0;
  let storyIdx = 0;
  let greyIdx = 0;
  const greyPaint = (index: number): Paint => ({ token: 'neutralMark', theme: { kind: 'visible-tint', base: { token: 'neutralMark' }, floor: GREY_RAMP_FLOOR,
    amount: Number((greyCount <= 1 ? GREY_RAMP_FIRST : GREY_RAMP_FIRST + ((GREY_RAMP_LAST - GREY_RAMP_FIRST) * index) / (greyCount - 1)).toFixed(3)) } });
  const slicePaint = (s: Slice): Paint => {
    if (greyRest) {
      if (!highlights.has(s.cat.id)) {
        const g = (s.v ?? 0) > 0 ? greyIdx++ : 0;
        return s.fill ? { css: s.fill } : greyPaint(g);
      }
      const k = storyIdx++;
      return s.fill ? { css: s.fill } : themeSeriesPaint(k, paletteRamp ? options.palette : undefined);
    }
    if (s.isOthers) return { token: 'othersMark' };
    const i = rampIdx++;
    if (s.fill) return { css: s.fill };
    if (ser.colorRole && rampCount === 1) return markRolePaint(ser.colorRole, true);
    if (colorMode === 'categorical') {
      return themeSeriesPaint(i, paletteRamp ? options.palette : undefined);
    }
    return rampPaint(i);
  };
  const paints = slices.map((s) => slicePaint(s));

  // ---- frame (legend items are the slices) ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  let legendInput: FrameInput['legend'];
  if (options.legend && options.legend !== 'none' && options.legend !== 'auto') {
    const legendOpts: LegendOptions = normalizeLegendOption(options.legend);
    // Only the slices that draw: a key for a zero or missing slice names a
    // colour that is nowhere on the canvas.
    let items: LegendItemInput[] = slices.flatMap((s, i) => ((s.v ?? 0) > 0 ? [{
      id: s.cat.id,
      label: s.cat.label ?? s.cat.id,
      paint: paints[i]!,
    }] : []));
    if (legendOpts.order) {
      const oi = (id: Id) => {
        const k = legendOpts.order!.indexOf(id);
        return k === -1 ? Number.MAX_SAFE_INTEGER : k;
      };
      items = [...items].sort((a, b) => oi(a.id) - oi(b.id));
    }
    legendInput = { options: legendOpts, items };
  }
  const sliceKey = legendInput !== undefined;
  const displayedCount = slices.filter((slice) => (slice.v ?? 0) > 0).length;
  const { insideContent, outsideContent, kindSetting } = pieLabelContent(options, displayedCount, sliceKey);
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const lineH = measure('0', labelFont).height;
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  /** The radius of the circle round a total block: the number in `font`, the unit line in `unitFont`. */
  const centerBlockRadius = (lines: string[], font: FontSpec = strongFont, unitFont: FontSpec = labelFont): number =>
    Math.hypot(Math.max(measure(lines[0]!, font).width, ...lines.slice(1).map((l) => measure(l, unitFont).width)) / 2,
      (measure('0', font).height + (lines.length - 1) * measure('0', unitFont).height) / 2) + 1;
  const widestSliceWord = Math.max(0,
    maxOf(slices.flatMap((slice) => (slice.cat.label ?? slice.cat.id).split(/\s+/)).map((word) => measure(word, labelFont).width)));
  // Every label outside in two columns, two lines
  // each (name; value · share), so the reserve beside the circle is the
  // widest such line and the leader gap, measured before the frame.
  const columns = insideContent === null && outsideContent !== null;
  const shownSlices = slices.filter((slice) => (slice.v ?? 0) > 0);
  const preShares = sharesFormatter(shownSlices.map((slice) => ((slice.v ?? 0) / total) * 100));
  // A name wraps to a label column before the reserve is measured, so a long name does not take the room
  // the circle needs: up to two lines in the narrowest column that holds them, between COLUMN_NAME_SHARE
  // and COLUMN_NAME_WIDEST of the plot width. A name that still does not fit is cut.
  const plotEstimate = Math.max(0, size.width - margin.left - margin.right);
  const columnName = (name: string) => fitText(name, labelFont, COLUMN_NAME_SHARE * plotEstimate, 2, measure, { wider: COLUMN_NAME_WIDEST * plotEstimate });
  const wrappedName = (name: string): string => columns ? columnName(name).lines.join('\n') : name;
  const preLines = (slice: Slice): string[] => outsideLines(outsideContent ?? [], wrappedName(slice.cat.label ?? slice.cat.id), sliceText({ v: slice.v ?? 0, format: slice.format }), preShares.format(((slice.v ?? 0) / total) * 100), ser.label ?? sid);
  // Each label column's height and widest line, from the slices' angles
  // (they do not depend on the radius); index 0 is the right side.
  const column = (() => {
    const heights = [0, 0];
    const counts = [0, 0];
    const widths = [0, 0];
    if (!columns) return { heights, counts, widths };
    let at = 0;
    for (const slice of shownSlices) {
      const mid = ((((options.rotate ?? 0) + ((at + (slice.v ?? 0) / 2) / total) * 360) % 360) + 360) % 360;
      at += slice.v ?? 0;
      const side = mid < 180 ? 0 : 1;
      const lines = preLines(slice);
      heights[side]! += lines.length * lineH;
      counts[side]!++;
      widths[side] = Math.max(widths[side]!, ...lines.map((line) => measure(line, labelFont).width));
    }
    return { heights, counts, widths };
  })();
  const columnStack = maxOf(column.heights.map((h, i) => h + 3 * Math.max(0, column.counts[i]! - 1) + 4));
  /**
   * How far the labels, hung on the ring round a circle of this radius
   * (ring.ts) at their slices' angles, reach above the circle's top and below
   * its bottom. Small slices near 12 or 6 o'clock hang their labels past the
   * rim; the plot holds that overhang, so the pie need not shrink for them.
   */
  const columnOverhang = (radius: number): { top: number; bottom: number } => {
    const out = { top: 0, bottom: 0 };
    if (!columns) return out;
    let at = 0;
    for (const slice of shownSlices) {
      const a0 = (options.rotate ?? 0) + (at / total) * 360;
      at += slice.v ?? 0;
      const mid = (labelAngle(a0, (options.rotate ?? 0) + (at / total) * 360) * Math.PI) / 180;
      const h = preLines(slice).length * lineH;
      const reach = (radius + RING_GAP) * Math.abs(Math.cos(mid)) + (h / 2) * (1 + Math.abs(Math.cos(mid))) - radius;
      if (Math.cos(mid) > 0) out.top = Math.max(out.top, reach);
      else out.bottom = Math.max(out.bottom, reach);
    }
    return out;
  };
  /** Room above and below the circle: the base pad, or the label overhang and a gap when it is more. */
  // A callout above or below a slice takes a line of the room round the circle, its default side below.
  const calloutRoom = (above: boolean) => (options.annotations ?? []).some((a) => a.kind === 'callout' &&
    (above ? a.preferSide === 'above' : a.preferSide === undefined || a.preferSide === 'below')) ? lineH + OVERHANG_GAP : 0;
  const circlePads = (radius: number): { top: number; bottom: number } => {
    const over = columnOverhang(radius);
    return { top: Math.max(CIRCLE_PAD, over.top + OVERHANG_GAP + calloutRoom(true)), bottom: Math.max(CIRCLE_PAD, over.bottom + OVERHANG_GAP + calloutRoom(false)) };
  };
  const columnGap = (width: number): number => Math.max(COLUMN_GAP_MIN, Math.min(COLUMN_GAP_MAX, width * COLUMN_GAP_RATIO));
  /** The room a label column takes beside the circle: its gap and its widest line. */
  const sideReserve = (side: 0 | 1, width: number): number => column.counts[side]! > 0 ? columnGap(width) + column.widths[side]! + 2 : 0;
  const outsideReserve = (width: number): number => {
    if (columns) return (sideReserve(0, width) + sideReserve(1, width)) / 2;
    return Math.max(OUTSIDE_MARGIN, Math.min(width * 0.3, 4 * lineH + 10 + widestSliceWord));
  };
  const heightFixed = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === true;
  const diameterCap = !heightFixed && panelTypeClass(options) === undefined ? diameterCapFor(size.width, (options.doughnut ?? 0) >= CENTER_TEXT_MIN) : Number.POSITIVE_INFINITY;
  const diameterFor = (plotW: number): number => Math.min(diameterCap, Math.max(40, plotW - 2 * outsideReserve(plotW)));
  const compared = (options.annotations ?? []).some((a) => a.kind === 'cagr' || a.kind === 'diff');
  const arcRoom = compared ? pieComparisonRoom(measure('0', { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) }).height) : 0;
  const automatic = !options[FIXED_PASS] && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false
    && panelTypeClass(options) === undefined;
  // labels: false frees the room the labels take. The pie keeps the height of the same pie with labels
  // and no automatic key, and its key fits inside that height.
  const labelled = automatic && options.labels === false
    ? layoutPie(data, { ...options, labels: undefined, ...(AUTO_LEGEND in options ? { legend: undefined } : {}) }) : undefined;
  // A diameter taller than every possible outside-label stack gives the same final natural height.
  const maxLines = outsideContent?.reduce((sum, part) => sum + (part === 'category' ? 2 : 1), 0) ?? 0;
  const maxStack = displayedCount * Math.max(1, maxLines) * lineH + 3 * Math.max(0, displayedCount - 1) + 4;
  const frameResult = solveFrame(
    {
      size,
      ...(automatic && legendInput?.options.position !== 'right' ? { autoHeight: (plot: Rect) => {
        if (labelled) return labelled.size.height;
        if (columns) {
          const diameter = diameterFor(plot.w);
          const pads = circlePads(diameter / 2);
          const need = Math.max(diameter + 2 * arcRoom + pads.top + pads.bottom, columnStack + 8);
          return Math.ceil(Math.max(MIN_COLUMN_HEIGHT, size.height - plot.h + need));
        }
        const circleHeight = diameterFor(plot.w) + 48;
        return circleHeight >= maxStack ? Math.ceil(Math.max(320, size.height - plot.h + circleHeight)) : undefined;
      } } : {}),
      margin,
      ...frameTextOptions(options),
      footnotes: [
        ...authoredNotes(options),
        ...(negatives.length ? [disclosureNote(chartString(options, 'pieNegativeNote', { v1: negatives.join(', ') }))] : []),
        ...valueNoteLine(chartString(options, 'pieHiddenSlices', { v1: named.size, v2: named.size === 1 ? 'slice' : 'slices' }), [...named.values()], options),
      ],
      legend: legendInput,
      theme,
      measure,
    },
    occupied,
  );
  const plot = frameResult.plot;
  // ---- circle geometry ----
  let cx = plot.x + plot.w / 2;
  let cy = plot.y + plot.h / 2;
  const insidePossible = insideContent !== null && slices.some((slice) =>
    slice.labelOverride !== false && ((slice.v ?? 0) / total) * 360 >= INSIDE_MIN_DEG);
  const hole = Math.max(0, Math.min(insidePossible ? 0.72 : 0.9, options.doughnut ?? 0));
  const rotate = options.rotate ?? 0;
  const explode: Record<Id, number> = Object.assign(emptyIdRecord(), options.explode);
  const sliceIds = new Set(slices.map((s) => s.cat.id));
  for (const id of Object.keys(options.explode ?? {}).sort()) {
    if (!sliceIds.has(id)) {
      warnings.push({
        code: 'explode-unknown-id',
        severity: 'info',
        message: `explode['${id}'] does not match any slice — ignored`,
      });
    }
  }
  // A comparison arc and its label run round the outside of the ring: arcRoom above.
  // The reserve beside the circle holds the leader gap of a four-line label and
  // the widest word of a slice name at the target's label size, up to 30% of
  // the plot a side.
  const outsideMargin = outsideReserve(plot.w);
  // The natural height of a pie with label columns holds the circle and the pads that autoHeight
  // reserved for it; any other plot keeps 24 px above and below the circle.
  const naturalPads = columns && automatic ? circlePads(diameterFor(plot.w) / 2) : undefined;
  const verticalPad = naturalPads ? (naturalPads.top + naturalPads.bottom) / 2 : 24;
  // Only a slice that draws (a positive value) moves out, so only its offset shrinks the circle.
  const maxAuthoredExplode = slices.reduce(
    (max, slice) => (slice.v ?? 0) > 0 ? Math.max(max, Math.max(0, explode[slice.cat.id] ?? 0)) : max,
    0,
  );
  // A doughnut's total in the hole can outrank the outside-label reserve. A layout that drops the total
  // is laid out again with CENTRE_FIRST: the ring then grows into the reserve, to the radius whose hole
  // holds the total at the label size, else one type step down, and the ring labels may not shrink it
  // below that radius. Plot width, plot height and the size cap bound the growth. A ring that cannot
  // reach either size is not laid out again, and a layout that draws the total is never changed. Label
  // columns keep their width, so only the ring-label layout grows.
  const centreFirst = options[CENTRE_FIRST] === true;
  const centerLines = hole >= CENTER_TEXT_MIN && kindSetting('total') !== false && !negatives.length
    ? pieCenterLines(fmt(total), options.unit ?? ser.unit, valueExample) : undefined;
  const circleLimit = Math.min(plot.w / 2, plot.h / 2 - verticalPad, diameterCap / 2);
  const reserveFit = Math.min((plot.w - 2 * outsideMargin) / 2, plot.h / 2 - verticalPad, diameterCap / 2);
  const centerStep = centerLines && !columns ? stepDownFont(theme, labelFont, 'label', options.target, textScaleOf(options)) : undefined;
  // The ring radius whose hole holds the total at the label size, else one step down (0.01 px of slack
  // so a hole as large as the block still counts as holding it); 0 when the limits allow neither.
  const centerReach = centerLines && !columns
    ? [centerBlockRadius(centerLines), ...(centerStep ? [centerBlockRadius(centerLines, { ...strongFont, size: centerStep.size }, centerStep)] : [])]
      .map((need) => (need + 0.01) / hole).find((need) => need * (1 + maxAuthoredExplode) + arcRoom <= circleLimit) ?? 0
    : 0;
  const centerR = centreFirst ? centerReach : 0;
  const baseFit = Math.max(
    20,
    Math.max(reserveFit, centerR > 0 ? centerR * (1 + maxAuthoredExplode) + arcRoom : 0) - arcRoom,
  );
  // The circle and its two label columns stand centred as one block.
  if (columns) {
    const left = sideReserve(1, plot.w);
    cx = plot.x + (plot.w - left - 2 * baseFit - sideReserve(0, plot.w)) / 2 + left + baseFit;
  }
  let r = baseFit / (1 + maxAuthoredExplode);
  let pieMinWidth = 0;
  // Refuse-less: a pinned pie draws under its 320 px floor while the circle keeps a readable
  // radius after the explode envelope and the comparison arc; below that the frame records
  // the canvas height that holds it.
  if (!automatic) {
    frameResult.frame.plotMinHeight = Math.max(frameResult.frame.plotMinHeight ?? 0, Math.ceil(size.height
      + (frameResult.deficit ?? 0) + 2 * (PIE_MIN_RADIUS * (1 + maxAuthoredExplode) + arcRoom + verticalPad) - plot.h));
    // Under the 320 px height floor (the compact band) wide outside labels can limit the radius
    // by width; more height does not help there, so the chart names the width that holds it.
    const radiusAt = (width: number) => (width - 2 * outsideReserve(width)) / 2 - arcRoom;
    const need = PIE_MIN_RADIUS * (1 + maxAuthoredExplode);
    if (size.height < PIE_STATIC_MIN_HEIGHT && radiusAt(plot.w) < need) {
      let width = Math.ceil(plot.w);
      while (radiusAt(width) < need && width < 4 * size.width) width += 4;
      pieMinWidth = Math.ceil(size.width - plot.w + width);
    }
  }
  let ri = r * hole;
  // The circle stands where its label columns' overhang fits above and below it,
  // the spare height split evenly; with no room for that it stays centred.
  if (columns) {
    const pads = circlePads(baseFit);
    const spare = plot.h - 2 * (baseFit + arcRoom) - pads.top - pads.bottom;
    if (spare >= 0) cy = plot.y + pads.top + arcRoom + baseFit + spare / 2;
  }

  const polar = (pcx: number, pcy: number, radius: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: pcx + radius * Math.sin(rad), y: pcy - radius * Math.cos(rad) };
  };

  // ---- slice angles (clockwise from 12 o'clock, rotate shifts the start) ----
  const buildGeoms = (): SliceGeom[] => {
  const geoms: SliceGeom[] = [];
  let cum = 0;
  slices.forEach((s, i) => {
    const v = s.v ?? 0;
    if (v <= 0) return; // zero/null slices render nothing
    const share = v / total;
    const a0 = rotate + (cum / total) * 360;
    cum += v;
    const a1 = rotate + (cum / total) * 360;
    const mid = (a0 + a1) / 2;
    const e = Math.max(0, explode[s.cat.id] ?? 0);
    const off = polar(0, 0, e * r, mid);
    const paint = paints[i]!;
    geoms.push({
      cat: s.cat,
      v,
      share,
      a0,
      a1,
      mid,
      sweep: a1 - a0,
      scx: cx + off.x,
      scy: cy + off.y,
      paint,
      fillCss: paintCss(paint),
      isOthers: s.isOthers,
      labelOverride: s.labelOverride,
      format: s.format,
      priority: s.priority,
    });
  });
  return geoms;
  };
  let geoms = buildGeoms();
  // ---- label content ----
  // The room an outside label has beside the rim at its slice's angle, with
  // the leader gap a four-line label takes. A long name on a label that only
  // goes outside wraps to it before it is measured, at most two lines; a cut
  // name keeps its full text as the title.
  const roomBeside = (g: SliceGeom): number => {
    const dy = polar(g.scx, g.scy, r + 4, g.mid).y - g.scy;
    const halfW = Math.sqrt(Math.max(0, r * r - dy * dy));
    // A label near 12 or 6 o'clock hangs centred above or below its slice: it may take the width round its anchor.
    const anchorX = polar(g.scx, g.scy, r + RING_GAP, g.mid).x;
    const centred = Math.abs(Math.cos((g.mid * Math.PI) / 180)) >= 0.9 ? 2 * Math.min(anchorX - plot.x, plot.x + plot.w - anchorX) - 4 : 0;
    const edge = ((g.mid % 360) + 360) % 360 < 180 ? plot.x + plot.w - (g.scx + halfW) : g.scx - halfW - plot.x;
    // A ring label hangs RING_GAP off the rim; with columns it may also take the column's reserve.
    return Math.max(40, centred, edge - RING_GAP - 2, columns ? plot.w / 2 - baseFit - columnGap(plot.w) - 2 : 0);
  };

  // rounding 'sum-consistent': the drawn slices' shares print so they add up to 100%.
  const rounded = options.rounding === 'sum-consistent'
    ? roundWholes([{ id: sid, name: ser.label ?? sid, parts: geoms.map((g) => ({ id: g.cat.id, name: g.cat.label ?? g.cat.id, share: g.share * 100 })) }], options.locale?.language, shareExample ? parseFormatExample(shareExample) : undefined)
    : undefined;
  if (rounded) pushAll(warnings, rounded.warnings);
  // The slices' shares print at one precision, "8%" beside "92%".
  const shareSet = sharesFormatter(geoms.map((g) => g.share * 100));
  const shareText = (g: SliceGeom): string => rounded?.texts.get(`${sid}\0${g.cat.id}`) ?? shareSet.format(g.share * 100);

  /** Compound parts: '35.6M' + '(37%)' when both value and percent print. */
  const composeParts = (g: SliceGeom, content: LabelContent, wrapW?: number): { parts: string[]; title?: string } => {
    const abs = sliceText(g);
    const both = content.includes('absolute') && content.includes('percent');
    // An outside label under a new target sets its value and share on one line.
    const joined = both && wrapW !== undefined;
    const parts: string[] = [];
    const full: string[] = [];
    let cut = false;
    for (const c of content) {
      if (c === 'absolute') parts.push(joined ? `${abs}${VALUE_SHARE_SEP}${shareText(g)}` : abs);
      else if (c === 'percent') {
        if (joined) continue;
        const p = shareText(g);
        parts.push(both ? `(${p})` : p);
      } else if (c === 'category') {
        const name = g.cat.label ?? g.cat.id;
        const wrapped = wrapW === undefined ? { lines: [name], truncated: false } : wrapText(name, labelFont, wrapW, 2, measure);
        parts.push(...wrapped.lines);
        full.push(name);
        cut ||= wrapped.truncated;
        continue;
      } else if (c === 'series') parts.push(ser.label ?? sid);
      full.push(parts[parts.length - 1]!);
    }
    return { parts, ...(cut ? { title: full.join(' ') } : {}) };
  };
  const applyOverride = (g: SliceGeom, text: string): string =>
    typeof g.labelOverride === 'string'
      ? g.labelOverride.replace(/\$\{value\}/g, sliceText(g))
      : text;

  // ---- per-slice label block (same lines inside and outside, catalog style) ----
  interface SliceLabel {
    g: SliceGeom;
    insideEligible: boolean;
    kind: LabelKind;
    lines: string[];
    text: string;
    title?: string;
    w: number;
    h: number;
    /** the outside form of an inside label, drawn when it lands outside (an outside label keeps its name). */
    outside?: { lines: string[]; text: string; title?: string; w: number; h: number; printsFor?: [] };
  }
  // The inside seat of a label w by h on slice g, if its whole box fits on the slice.
  const insideCandidate = (g: SliceGeom, w: number, h: number): SlotCandidate | undefined => {
    const rl = ri > 0 ? (ri + r) / 2 : r * 0.68;
    const p = polar(g.scx, g.scy, rl, g.mid);
    const rect: Rect = { x: p.x - w / 2, y: p.y - h / 2, w, h };
    const chord = 2 * rl * Math.sin((Math.min(g.sweep, 180) / 2) * (Math.PI / 180));
    const radial = ri > 0 ? r - ri : r * 0.6;
    const fits = w + 6 <= chord && h + 4 <= radial;
    // Inside only where the whole box lies on the slice, with its
    // padding or as a tight fit without it; never kept there on a halo.
    return (fits || (w <= chord && h <= radial)) && rectOnWedge(rect, g, ri, r)
      ? { slot: fits ? 'insideEdge' : 'insideEdgeTight', rect, penalty: 0, insideFill: g.fillCss, insidePaint: g.paint }
      : undefined;
  };
  const buildSliceLabels = (): SliceLabel[] => {
  const sliceLabels: SliceLabel[] = [];
  for (const g of geoms) {
    if (named.has(g.cat.id)) continue;
    const blockOf = (inside: boolean) => {
      const content = inside ? insideContent! : outsideContent;
      if (!content) return undefined;
      const { parts, title } = composeParts(g, content, inside ? undefined : columns ? Math.min(roomBeside(g), columnName(g.cat.label ?? g.cat.id).w + 1) : roomBeside(g));
      const lines = typeof g.labelOverride === 'string' ? [applyOverride(g, parts.join(' '))] : parts;
      const w = Math.max(...lines.map((l) => measure(l, labelFont).width), 1);
      return { lines, title, w, h: lineH * Math.max(lines.length, 1) };
    };
    let insideEligible = insideContent !== null && g.sweep >= INSIDE_MIN_DEG;
    let block = blockOf(insideEligible);
    // A label with no seat inside goes outside with the outside content,
    // name included.
    if (insideEligible && block && !insideCandidate(g, block.w, block.h)) {
      insideEligible = false;
      block = blockOf(false);
    }
    if (!block) continue;
    const { lines, title, w, h } = block;
    const text = lines.join(' ');
    if (!text && g.labelOverride !== false) continue;
    const outsideBlock = insideEligible ? blockOf(false) : undefined;
    const outside = outsideBlock && outsideBlock.lines.join(' ') !== text
      ? { lines: outsideBlock.lines, text: outsideBlock.lines.join(' '), ...(outsideBlock.title !== undefined && typeof g.labelOverride !== 'string' ? { title: outsideBlock.title } : {}), w: outsideBlock.w, h: outsideBlock.h, ...namesOnly(outsideContent, g.labelOverride) }
      : undefined;
    sliceLabels.push({
      g,
      insideEligible,
      kind: insideEligible ? 'insidePie' : 'outsidePie',
      lines,
      text,
      ...(title !== undefined && typeof g.labelOverride !== 'string' ? { title } : {}),
      w,
      h,
      ...(outside ? { outside } : {}),
    });
  }
  return sliceLabels;
  };
  let sliceLabels = buildSliceLabels();

  // The printed shares of the drawn slices sum to 100, or the drift is
  // disclosed; no share is bent to close it.
  if (!rounded && sliceLabels.some((sl) => (sl.insideEligible ? insideContent : outsideContent)?.includes('percent'))) {
    warnShareRoundingDrift(warnings, [{ name: ser.label ?? sid, shares: geoms.map((g) => g.share * 100), decimals: shareSet.decimals }]);
  }

  /**
   * Without label columns the outside labels hang on a ring round the circle,
   * each near its own slice with a straight leader (ring.ts). A label that
   * only goes outside spreads along the ring; an inside label's outside seat
   * is its fallback and takes no room from them. When the ring needs a
   * smaller pie, the slices and their labels are set again at that radius.
   */
  /** The authored priority, else the share, with the highlight bonus: the solver's order and the ring's. */
  const labelPriority = (g: SliceGeom) =>
    g.priority ?? PRIORITY.interior + Math.min(99, Math.round(g.share * 1000) / 10) + (highlights.has(g.cat.id) ? PRIORITY.highlightBonus : 0);
  function seatRingLabels(): void {
    const oneLineOf = (form: { lines: string[] }) => {
      const lines = [form.lines.join(' ')];
      return { lines, text: lines[0]!, w: Math.max(measure(lines[0]!, labelFont).width, 1), h: lineH };
    };
    const itemOf = (sl: SliceLabel): RingItem => {
      const form = sl.outside ?? sl;
      const r0 = r;
      const off = { x: sl.g.scx - cx, y: sl.g.scy - cy };
      return {
        mid: labelAngle(sl.g.a0, sl.g.a1),
        center: (radius: number) => ({ x: cx + (off.x * radius) / r0, y: cy + (off.y * radius) / r0 }),
        forms: form.lines.length > 1 && (!sl.insideEligible || sl.outside) ? [form, oneLineOf(form)] : [form],
      };
    };
    // Labels leave the ring, the lowest priority first, until the rest have a good seat. The
    // lowest label leaves when that frees a seat; else the lowest of those with no good seat.
    // The note loop and the open-height pass in drivePie depend on this order: the labels
    // dropped here set the note, the note sets the height the driver settles on, and that
    // height decides which labels stay. A change of the drop order moves that height and can
    // cost a label.
    const dropped = new Set<Id>();
    const seatAll = (minRadius: number) => {
      let spread = sliceLabels.filter((sl) => !sl.insideEligible && !dropped.has(sl.g.cat.id));
      let ring = placeRing(spread.map(itemOf), r, plot, minRadius);
      const lowest = (pool: SliceLabel[]) => pool.reduce((low, sl) => labelPriority(sl.g) <= labelPriority(low.g) ? sl : low);
      while (ring.bad.size > 0) {
        let drop = lowest(spread.filter((_, k) => ring.bad.has(k)));
        const last = lowest(spread);
        const rest = spread.filter((sl) => sl !== last);
        const freed = last !== drop && !options[BAD_FIRST] ? placeRing(rest.map(itemOf), r, plot, minRadius) : undefined;
        if (freed && freed.bad.size < ring.bad.size) { drop = last; swapped = true; }
        dropped.add(drop.g.cat.id);
        spread = spread.filter((sl) => sl !== drop);
        ring = drop === last && freed ? freed : placeRing(spread.map(itemOf), r, plot, minRadius);
      }
      const seats = new Map(spread.map((sl, k) => [sl, { seat: ring.seats[k]!, form: ring.form[k]!, bad: ring.bad.has(k) }] as const));
      for (const sl of sliceLabels) {
        if (seats.has(sl) || dropped.has(sl.g.cat.id)) continue;
        const alone = placeRing([itemOf(sl)], ring.r, plot, ring.r);
        seats.set(sl, { seat: alone.seats[0]!, form: alone.form[0]!, bad: alone.bad.size > 0 });
      }
      return { ring, seats };
    };
    // The ring may shrink the pie for its labels, but not below the radius whose hole holds the total.
    let placed = seatAll(Math.max(PIE_MIN_RADIUS, 0.7 * r, centerR));
    // Labels that all sit in columns by their reserve take two true columns beside the circle when the
    // ring leaves a label without a seat. The ring keeps every pie it seats whole.
    if (columns && (dropped.size > 0 || [...placed.seats.values()].some((s) => s.bad))) {
      const outsideOnly = sliceLabels.filter((sl) => !sl.insideEligible);
      const stacked = placeColumns(outsideOnly.map(itemOf), r, cx, baseFit, columnGap(plot.w), plot, lineH);
      if (stacked.bad.size === 0) {
        dropped.clear();
        placed = { ring: stacked, seats: new Map(outsideOnly.map((sl, k) => [sl, { seat: stacked.seats[k]!, form: 0, bad: false }] as const)) };
      }
    }
    if (placed.ring.r < r) {
      r = placed.ring.r;
      ri = r * hole;
      geoms = buildGeoms();
      sliceLabels = buildSliceLabels();
      placed = seatAll(r);
    }
    warnSpreadOverflow(warnings, dropped.size === 0, 'outside slice labels do not all fit round the pie — the labels that find no seat near their slices are named in the note; fewer slices or a larger canvas fixes it');
    for (const [sl, { seat, form, bad }] of placed.seats) {
      // A seat off the plot, on another label, or whose leader would cut a slice or cross
      // another leader or label is not offered: the slice is named in the note instead.
      if (bad) continue;
      const target = sl.outside ?? sl;
      if (form === 1) {
        const valueLine = target.lines.findIndex((line) => line.includes(VALUE_SHARE_SEP));
        if (valueLine === target.lines.length - 1 && valueLine > 0) oneLineValueAt.set(`${sl.insideEligible ? 'insidePie' : 'outsidePie'}:${sid}:${sl.g.cat.id}`, target.lines.slice(0, valueLine).join(' ').length + 1);
        Object.assign(target, oneLineOf(target));
      }
      outsideSlot.set(sl.g.cat.id, { rect: seat.rect, anchor: seat.from, end: seat.to });
    }
  }

  // ---- outside slots: two label columns, or a ring round the circle near each slice ----
  interface OutsideSlot {
    rect: Rect;
    anchor: { x: number; y: number };
    /** Leader end beside the label. */
    end: { x: number; y: number };
  }
  const outsideSlot = new Map<Id, OutsideSlot>();
  /** A one-line outside label's value offset: the value prints bold from there to its share. */
  const oneLineValueAt = new Map<string, number>();
  // the tallest side's stack of labels that can only go outside; the
  // natural height holds it under a new target, where the reserve narrows the circle.
  let outsideStackH = 0;
  for (const right of [true, false]) {
    const outsideOnly = sliceLabels.filter((sl) => !sl.insideEligible && (((sl.g.mid % 360) + 360) % 360 < 180) === right);
    if (outsideOnly.length > 0) {
      outsideStackH = Math.max(outsideStackH, outsideOnly.reduce((sum, sl) => sum + sl.h, 0) + 3 * (outsideOnly.length - 1) + 4);
    }
  }
  seatRingLabels();

  // ---- marks: slice paths + wedge-approximating occupied claims ----
  const nodes: SceneNode[] = [...frameResult.nodes];
  const marks: PieMarks = { slices: [] };
  const exploded = (g: SliceGeom) => g.scx !== cx || g.scy !== cy;
  geoms.forEach((g, gi) => {
    const nodeId = `mark:${sid}:${g.cat.id}`;
    // A slice between two neighbours (three slices at least, none exploded) whose arc
    // outlasts its two separators is bounded by them.
    const neighbours = geoms.length >= 3 ? [geoms[(gi + geoms.length - 1) % geoms.length]!, geoms[(gi + 1) % geoms.length]!] : [];
    const arc = (r * g.sweep * Math.PI) / 180;
    const joined = neighbours.length > 0 && ![g, ...neighbours].some(exploded) && arc > 2 * strokeToken(theme, 'rule');
    const f1 = {
      // The note item that names the slice with its value, if the frame draws it.
      ...(named.has(g.cat.id) && !namesOnly(outsideContent ?? insideContent ?? [], undefined).printsFor ? { notedAs: named.get(g.cat.id)! } : {}),
      ...(joined ? { bounds: neighbours.map((n) => n.paint) } : {}),
    };
    nodes.push({
      t: 'path',
      id: nodeId,
      d: slicePath(g.scx, g.scy, r, ri, g.a0, g.a1),
      fill: g.paint,
      separation: { fill: g.paint, backing: { token: 'background' } as Paint, fallback: { stroke: { token: 'background' } as Paint, strokeWidth: strokeToken(theme, 'rule') }, ...f1 },
      // One closed stroke bounds the slice on its arc and both radial edges.
      ...((sep) => (sep ? { stroke: sep.stroke, width: sep.strokeWidth } : { stroke: { token: 'background' } as const, width: strokeToken(theme, 'rule') }))(
        // A theme's `marks.sliceOutline: false` keeps the page separator alone.
        sliceOutlineOff('slice', theme) || markOutlineOff(g.paint, theme) ? undefined : separationStroke(paintCss(g.paint), theme.color.background, theme),
      ),
      owner: { seriesId: sid, categoryId: g.cat.id },
      part: 'slice',
      display: { value: sliceText(g) },
    });
    claimWedge(occupied, { seriesId: sid, categoryId: g.cat.id }, g, r, ri, polar);
    marks.slices.push({
      categoryId: g.cat.id,
      nodeId,
      midAngle: round2(((g.mid % 360) + 360) % 360),
      value: g.v,
      share: round4(g.share),
    });
  });

  // ---- label requests: inside near outer edge → backed → outside w/ straight leader ----
  const labelRequests: LabelRequest[] = [];
  const leaderAnchors = new Map<Id, { from: Point; to: Point }>();
  const unseated: SliceGeom[] = [];
  for (const sl of sliceLabels) {
    const { g, kind, lines, text, title, w, h } = sl;
    const candidates: SlotCandidate[] = [];
    const inside = sl.insideEligible ? insideCandidate(g, w, h) : undefined;
    if (inside) candidates.push(inside);
    const out = outsideSlot.get(g.cat.id);
    if (out) {
      candidates.push({
        slot: 'outside',
        rect: out.rect,
        penalty: candidates.length,
        // Its straight leader is drawn after the solve (routeOutsideLeaders).
      });
      leaderAnchors.set(g.cat.id, { from: out.anchor, to: out.end });
    }
    // A label with no seat (the ring found none near its slice) goes to the note.
    if (candidates.length === 0) { unseated.push(g); continue; }

    const priority = labelPriority(g);
    labelRequests.push({
      id: `${kind}:${sid}:${g.cat.id}`,
      kind,
      role: composedTextRole(text),
      owner: { seriesId: sid, categoryId: g.cat.id },
      // An override's ${value} slot holds the slice value itself, whatever the content.
      ...namesOnly(typeof g.labelOverride === 'string' ? undefined : kind === 'insidePie' ? insideContent : outsideContent, g.labelOverride),
      text,
      lines,
      ...(title !== undefined ? { title } : {}),
      font: labelFont,
      // A left label column, or a ring label left of the circle, is set flush right, against it.
      ...(out && out.rect.x + out.rect.w <= cx ? { align: 'end' as const } : {}),
      priority,
      redundant: g.labelOverride === false,
      candidates,
    });
  }

  // ---- doughnut center: total in the hole (hole >= 0.35) ----
  let centerFont: FontSpec | undefined;
  /** The largest bold face, label size to CENTER_VALUE_MAX, whose total block fits in the hole. */
  let centerUnitFont = labelFont;
  const centerValueFont = (lines: string[]): FontSpec => {
    const fits = (font: FontSpec) => centerBlockRadius(lines, font) <= ri;
    // The total scales with the ring: 24 px on a 170 px ring, 15 px on a 95 px ring.
    const cap = Math.min(CENTER_VALUE_MAX, Math.max(labelFont.size, Math.round(2 * CENTER_VALUE_RATIO * r) / 2));
    for (let px = cap; px > labelFont.size; px -= 0.5) {
      const font = { ...strongFont, size: px };
      if (fits(font)) return font;
    }
    // A hole too small for the label size takes the next type step down, number and unit, when that holds it.
    const step = !centreFirst || fits(strongFont) ? undefined : stepDownFont(theme, labelFont, 'label', options.target, textScaleOf(options));
    if (step && centerBlockRadius(lines, { ...strongFont, size: step.size }, step) <= ri) {
      centerUnitFont = step;
      return { ...strongFont, size: step.size };
    }
    return strongFont;
  };
  if (centerLines) {
    const lines = centerLines;
    const text = lines.join(' ');
    // Under a new target the total prints as large as the hole
    // holds (up to CENTER_VALUE_MAX px), its unit below in the regular muted
    // label face.
    centerFont = centerValueFont(lines);
    const tsize = {
      width: Math.max(measure(lines[0]!, centerFont).width, ...lines.slice(1).map((line) => measure(line, centerUnitFont).width)),
      height: measure('0', centerFont).height + (lines.length - 1) * measure('0', centerUnitFont).height,
    };
    // A box wholly inside the hole needs no pad against the ring's claims.
    const inHole = Math.hypot(tsize.width / 2, tsize.height / 2) <= ri - 1;
    labelRequests.push({
      id: `total:${sid}`,
      kind: 'total',
      owner: { seriesId: sid },
      text,
      lines,
      font: strongFont,
      priority: PRIORITY.total,
      candidates: [
        {
          slot: 'center',
          rect: {
            x: cx - tsize.width / 2,
            y: cy - tsize.height / 2,
            w: tsize.width,
            h: tsize.height,
          },
          penalty: 0,
          ...(inHole ? { pad: 0 } : {}),
          insideFill: theme.color.background,
          insidePaint: { token: 'background' },
        },
      ],
    });
  }

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    density,
    measure,
    plot,
    labelPad: 2,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);
  const centreHidden = centerReach > 0 && solved.placed.some((label) => label.kind === 'total' && label.hidden);

  // An inside label that lands outside prints its outside form, name included.
  const outsideForms = new Map<string, NonNullable<SliceLabel['outside']>>(sliceLabels.flatMap((sl) => (sl.outside ? [[`insidePie:${sid}:${sl.g.cat.id}`, sl.outside] as const] : [])));
  for (const label of solved.placed) {
    const form = label.slot === 'outside' ? outsideForms.get(label.id) : undefined;
    if (!form) continue;
    label.lines = form.lines;
    label.text = form.text;
    label.role = composedTextRole(form.text);
    // The outside form decides whether the slice's value prints.
    if (form.printsFor) label.printsFor = form.printsFor;
    else delete label.printsFor;
    if (form.title !== undefined) label.title = form.title;
    else delete label.title;
  }
  routeOutsideLeaders(solved.placed, leaderAnchors);
  // What a hidden slice label would have said, name first, for the note.
  const unlabelled = new Map<Id, string>();
  const noteContent = (outsideContent ?? insideContent ?? []).filter((c) => c !== 'category');
  for (const label of solved.placed) {
    const g = label.hidden && (label.kind === 'insidePie' || label.kind === 'outsidePie')
      ? geoms.find((candidate) => candidate.cat.id === label.owner.categoryId) : undefined;
    if (g) unlabelled.set(g.cat.id, [g.cat.label ?? g.cat.id, ...composeParts(g, noteContent).parts].join(' '));
  }
  for (const g of unseated) unlabelled.set(g.cat.id, [g.cat.label ?? g.cat.id, ...composeParts(g, noteContent).parts].join(' '));

  // ---- annotations: {categoryId} anchors to the outer edge at mid-angle ----
  const geomByCat = new Map(geoms.map((g) => [g.cat.id, g] as const));
  const resolveAnchor = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref } : ref;
    if (!('categoryId' in norm) || (norm.seriesId && norm.seriesId !== sid)) return null;
    const g = geomByCat.get(norm.categoryId);
    if (!g) return null;
    const p = polar(g.scx, g.scy, r + 2, g.mid);
    return {
      x: p.x,
      y: p.y,
      // A callout or note leads to a point on its slice, inside the
      // rim, so its leader shows which slice it speaks of.
      calloutPoint: polar(g.scx, g.scy, ri > 0 ? (ri + r) / 2 : r * 0.85, g.mid),
      value: g.v,
      format: ser.format,
      date: g.cat.date,
      label: g.cat.label ?? g.cat.id,
      owner: { seriesId: sid, categoryId: g.cat.id },
    };
  };
  const annList: Annotation[] = options.annotations ?? [];
  const annResult = runAnnotatePass({
    annotations: annList,
    resolve: resolveAnchor,
    defaultSpan: geoms.length > 1 ? { from: geoms[0]!.cat.id, to: geoms[geoms.length - 1]!.cat.id } : undefined,
    comparisonLayout: pieComparisonLayout(theme, { cx, cy, r, outer: baseFit }, geoms.map((g) => ({ id: g.cat.id, a0: g.a0, sweep: g.sweep, mid: g.mid, scx: g.scx, scy: g.scy }))),
    occupied,
    plot,
    // Annotation labels draw bold (see labelsToNodes below), so the pass measures them bold.
    theme: emphasisLabelTheme(theme),
    measure,
    format: valueExample,
    locale: options.locale?.language,
    strings: options.strings,
    solveCtx,
  });
  pushAll(warnings, annResult.warnings);

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  pushAll(nodes, annResult.nodes);
  pushAll(
    nodes,
    labelsToNodes(theme, allLabels, (l) =>
      l.kind === 'total'
        ? strongFont
        : l.kind === 'annotation'
          ? { ...labelFont, weight: emphasisWeight(theme) }
          : labelFont,
    ),
  );

  const totalNode = nodes.find((node) => node.id === `label:total:${sid}`);
  if (totalNode?.t === 'text') {
    totalNode.x = cx;
    totalNode.align = 'middle';
    // The large total over its regular muted unit line.
    if (centerFont) {
      const [value, ...rest] = totalNode.lines;
      const valueH = centerFont.size * (centerFont.lineHeight ?? 1.2);
      totalNode.font = centerFont;
      totalNode.lines = [value!];
      if (rest.length > 0) {
        nodes.splice(nodes.indexOf(totalNode) + 1, 0, {
          ...totalNode, id: `${totalNode.id}:unit`, y: totalNode.y + valueH, lines: rest, font: centerUnitFont, ink: { token: 'inkMuted' },
        });
      }
    }
  }
  boldColumnValues(nodes, solved.placed, emphasisWeight(theme), oneLineValueAt);

  const axes: AxisGeometry[] = [];
  const shapeName = chartString(options, hole > 0 ? 'doughnutName' : 'pieName');
  const a11yDesc =
    (negatives.length
      ? chartString(options, 'pieDescNoTotal', { v1: shapeName, v2: geoms.length, v3: ser.label ?? sid })
      : chartString(options, 'pieDesc', { v1: shapeName, v2: geoms.length, v3: ser.label ?? sid, v4: fmt(total) })) +
    chartString(options, 'sharesSentence', { v1: geoms
      .map((g) => `${g.cat.label ?? g.cat.id} ${shareText(g)}`)
      .join(', ') });

  const geometry: Geometry<PieMarks, PieDerived> = {
    type: 'pie',
    size,
    sizing: naturalPieSizing(size, plot, labelled?.sizing ? labelled.sizing.naturalHeight - size.height + plot.h : columns
      ? Math.max(diameterFor(plot.w) + 2 * arcRoom + 48, columnStack + 8)
      : Math.max(diameterFor(plot.w) + 48, outsideStackH), contentSizing('pie', size, plot, [
      { x: cx - baseFit, y: cy - baseFit, w: 2 * baseFit, h: 2 * baseFit },
      ...allLabels.filter((label) => !label.hidden).map((label) => label.rect),
    ], true), pieMinWidth),
    plot,
    scene: nodes,
    labels: allLabels,
    axes,
    annotations: annResult.placed,
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: { total: cleanFloat(total), shares, stackParts: { [sid]: Object.fromEntries(geoms.map((g) => [g.cat.id, g.v])) }, ...(rounded ? { roundingAdjustments: rounded.adjustments } : {}) },
    a11y: {
      title:
        accessibleTitle(options.title, chartString(options, 'pieTitle', { v1: shapeName, v2: ser.label ?? sid, v3: geoms.length })),
      counts: [structureCount('slices', geoms.length, undefined, options)],
      desc: a11yDesc,
    },
    warnings,
    ...(paintWarningRules.length ? { paintWarningRules } : {}),
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annResult.decisions],
    },
  };
  const naturalHeight = geometry.sizing?.naturalHeight;
  if (automatic && naturalHeight === size.height) settledAutoHeight.add(geometry.frame);
  // A canvas shorter than the content, or an open height not at its content height, is laid out again by
  // the sizing, which can bring the total back; only a canvas that holds the content has lost it.
  const settled = naturalHeight === undefined || (automatic ? naturalHeight === size.height : naturalHeight <= size.height);
  return { geometry, unlabelled, swapped, centreLost: centreHidden && settled };
}

/**
 * Annular / wedge slice path built from SVG arc commands. Full-circle slices
 * split into two half arcs (a single 360° arc degenerates).
 */
function slicePath(cx: number, cy: number, r: number, ri: number, a0: number, a1: number): string {
  const pt = (radius: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
  };
  const sweep = a1 - a0;
  if (sweep >= 359.99) {
    const p0 = pt(r, a0);
    const ph = pt(r, a0 + 180);
    let d =
      `M${pf(p0.x)} ${pf(p0.y)}` +
      `A${pf(r)} ${pf(r)} 0 1 1 ${pf(ph.x)} ${pf(ph.y)}` +
      `A${pf(r)} ${pf(r)} 0 1 1 ${pf(p0.x)} ${pf(p0.y)}Z`;
    if (ri > 0) {
      const q0 = pt(ri, a0);
      const qh = pt(ri, a0 + 180);
      d +=
        `M${pf(q0.x)} ${pf(q0.y)}` +
        `A${pf(ri)} ${pf(ri)} 0 1 0 ${pf(qh.x)} ${pf(qh.y)}` +
        `A${pf(ri)} ${pf(ri)} 0 1 0 ${pf(q0.x)} ${pf(q0.y)}Z`;
    }
    return d;
  }
  const la = sweep > 180 ? 1 : 0;
  const p0 = pt(r, a0);
  const p1 = pt(r, a1);
  if (ri > 0) {
    const q1 = pt(ri, a1);
    const q0 = pt(ri, a0);
    return (
      `M${pf(p0.x)} ${pf(p0.y)}` +
      `A${pf(r)} ${pf(r)} 0 ${la} 1 ${pf(p1.x)} ${pf(p1.y)}` +
      `L${pf(q1.x)} ${pf(q1.y)}` +
      `A${pf(ri)} ${pf(ri)} 0 ${la} 0 ${pf(q0.x)} ${pf(q0.y)}Z`
    );
  }
  return (
    `M${pf(cx)} ${pf(cy)}` +
    `L${pf(p0.x)} ${pf(p0.y)}` +
    `A${pf(r)} ${pf(r)} 0 ${la} 1 ${pf(p1.x)} ${pf(p1.y)}Z`
  );
}

/**
 * The OccupiedIndex is rect-based; approximate the wedge with small squares
 * on a polar grid (2–3 radius bands, angular steps sized to the band) so
 * outside labels and annotations stay off the pie while a slice's own inside
 * label — same owner — is exempt in the solver.
 */
function claimWedge(
  occupied: OccupiedIndex,
  owner: { seriesId: Id; categoryId: Id },
  g: SliceGeom,
  r: number,
  ri: number,
  polar: (pcx: number, pcy: number, radius: number, deg: number) => { x: number; y: number },
): void {
  const hs = Math.max(5, Math.min(14, r * 0.12));
  const bands =
    ri > 0
      // No claim square reaches into the hole, which holds the centre total.
      ? [Math.max(ri + (r - ri) * 0.3, Math.min(ri + (r - ri) * 0.5, ri + hs * Math.SQRT2)), ri + (r - ri) * 0.72]
      : [r * 0.32, r * 0.6, r * 0.86];
  const claimAt = (radius: number, deg: number) => {
    const p = polar(g.scx, g.scy, radius, deg);
    occupied.claim({ x: p.x - hs, y: p.y - hs, w: 2 * hs, h: 2 * hs }, 'mark', owner);
  };
  bands.forEach((rb, bi) => {
    if (rb <= 0) return;
    const insetDeg = Math.min(g.sweep / 4, ((hs * 0.7) / rb) * (180 / Math.PI));
    const lo = g.a0 + insetDeg;
    const hi = g.a1 - insetDeg;
    if (hi <= lo) {
      // sliver: one claim at the rim mid-angle only
      if (bi === bands.length - 1) claimAt(rb, g.mid);
      return;
    }
    const stepDeg = Math.max(7, ((hs * 1.5) / rb) * (180 / Math.PI));
    for (let a = lo; a < hi; a += stepDeg) claimAt(rb, a);
    claimAt(rb, hi);
  });
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * A column label's value prints bold beside its regular share
 * ("**35.6m** · 37%"). Its value line, the last, becomes a node of its own
 * with styled runs (runs carry a single line); the name lines keep the label node.
 * A one-line label ("Name **35.6m** · 37%") keeps one node and bolds its value run.
 */
function boldColumnValues(nodes: SceneNode[], labels: PlacedLabel[], weight: number, oneLineValueAt: Map<string, number>): void {
  const shown = labels.filter((label) => !label.hidden && label.slot === 'outside' && label.nodeId);
  const outside = new Set(shown.map((label) => label.nodeId!));
  const oneLine = new Map(shown.flatMap((label) => oneLineValueAt.has(label.id) ? [[label.nodeId!, oneLineValueAt.get(label.id)!] as const] : []));
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const from = node.t === 'text' && node.lines.length === 1 ? oneLine.get(node.id) : undefined;
    if (node.t === 'text' && from !== undefined) {
      const line = node.lines[0]!;
      const at = line.indexOf(VALUE_SHARE_SEP, from);
      if (at > from) node.runs = [{ text: line.slice(0, from) }, { text: line.slice(from, at), weight }, { text: line.slice(at) }];
      continue;
    }
    if (node.t !== 'text' || !outside.has(node.id) || node.lines.length < 2) continue;
    const last = node.lines[node.lines.length - 1]!;
    const at = last.indexOf(VALUE_SHARE_SEP);
    if (at <= 0) continue;
    const lineH = node.font.size * (node.font.lineHeight ?? 1.2);
    const head = node.lines.slice(0, -1);
    nodes.splice(i + 1, 0, {
      ...node,
      id: `${node.id}:value`,
      y: node.y + head.length * lineH,
      lines: [last],
      runs: [{ text: last.slice(0, at), weight }, { text: last.slice(at) }],
    });
    node.lines = head;
    i++;
  }
}

/**
 * An outside label's leader runs straight from its slice's rim to where the
 * label hangs from the ring (ring.ts).
 */
function routeOutsideLeaders(labels: PlacedLabel[], leaderAnchors: Map<string, { from: Point; to: Point }>): void {
  const p = (point: Point) => `${round2(point.x)} ${round2(point.y)}`;
  for (const label of labels) {
    if (label.hidden || label.slot !== 'outside') continue;
    const leader = leaderAnchors.get(label.owner.categoryId!);
    if (leader) label.leader = { d: `M${p(leader.from)}L${p(leader.to)}`, curved: false };
  }
}

/** Fit the circle to the available width while retaining its vertical label clearance. */
function naturalPieSizing(size: Size, plot: Rect, plotNeed: number, measured: ReturnType<typeof contentSizing>, minWidth = 0) {
  // The static 320 px floor stays the natural start; the fit gate applies it (or the compact floor), not the layout.
  return { ...measured, minHeight: measured.measuredMinHeight,
    ...(minWidth > measured.minWidth ? { minWidth, measuredMinWidth: Math.max(measured.measuredMinWidth, minWidth) } : {}), naturalHeight: Math.ceil(Math.max(measured.minHeight, size.height - plot.h + plotNeed)) };
}
