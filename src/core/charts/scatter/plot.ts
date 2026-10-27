/**
 * Scatter phase 1, second half: the frame, the plot rect it leaves,
 * and the scales over that rect. The frame is solved here, before the scales,
 * because the plot rect comes out of it.
 */

import type { Rect } from '../../geometry';
import { measureValueAxisWidth } from '../../axis';
import {
  frameTextOptions,
  normalizeLegendOption,
  plotHeightAfter,
  solveFrame,
  type FrameInput,
  type FrameResult,
  type LegendItemInput,
  authoredNotes,
} from '../../frame';
import { formatAutomaticNumber } from '../../format';
import { formatterFromExample } from '../../formatSpec';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { linearScale } from '../../scale';
import { logScale, logSpecFormat, logTickTiers } from './logAxis';
import { wrapText, type FontSpec, type TextMeasurer } from '../../text';
import { canvasMargin, markRolePaint, mutedMarkPaint, paintColor, panelTypeClass, seriesPaint as themeSeriesPaint } from '../../theme';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import type { Id } from '../../types/cell';
import type { LegendOptions } from '../../types/options';
import type { LintWarning, Paint } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { NormGroup, NormPt, ScatterDomain, ScatterEnv, ScatterFonts, ScatterPaints, ScatterPlotArea } from './model';
import { drawnValueLines } from './valueLines';
import { bandedAxes, ZONE_BAND_GAP } from './zones';
import { atHardMinimum, HARD_COMPACT_PLOT, plotFloorRows } from '../../sizing';
import { maxOf } from '../../arrays';

/**
 * Point radius when no size channel is active: a dense cloud keeps the small
 * dot so it does not merge, a sparse one draws the larger dot, and a sparse
 * one on a card WIDE_CARD px or wider draws r 5.5. The space lint takes the
 * largest drawn point's diameter as the body of one point (lint/space.ts).
 */
const DOT_R = 3.5;
const DOT_R_SPARSE = 4.5;
const DOT_R_WIDE = 5.5;
/** A card this wide or wider takes DOT_R_WIDE. */
const WIDE_CARD = 720;
/** Above this many points the dots keep the small radius. */
const DOT_DENSE_COUNT = 20;
/** The key dot of a group (the house legend dot). */
const KEY_DOT_R = 5;
/** Bubble radius for size 0 / missing size in bubble mode. */
const MIN_R = 2;
/**
 * Max bubble radius as a fraction of the smaller plot dimension; a narrow
 * plot takes the smaller share, so a crowded group keeps room for its names.
 */
const MAX_R_FRACTION = 0.065;
const MAX_R_FRACTION_NARROW = 0.055;
/** Up to this many bubbles, the largest one keeps at least SPARSE_R_FLOOR px. */
const SPARSE_BUBBLES = 8;
const SPARSE_R_FLOOR = 17;
/** The floor never passes this share of the smaller plot dimension. */
const SPARSE_R_CAP = 0.08;
/** The cap on a narrow strategy grid. */
const SPARSE_R_CAP_NARROW_GRID = 0.06;
/** A plot narrower than this takes the narrow share. */
const NARROW_PLOT = 420;
/** The padding a strategy grid row keeps around its caption and a name. */
const GRID_ROW_PAD = 10;
/** A y band column may take this share of the plot width before its labels wrap. */
const Y_BAND_SHARE = 0.2;

/**
 * Band labels on one line while each fits `maxW`; otherwise each on at most
 * two lines, broken at the widest word of the set or `maxW`, whichever is wider.
 */
function bandLines(labels: readonly string[], font: FontSpec, measure: TextMeasurer, maxW: number): string[][] {
  if (labels.every((label) => measure(label, font).width <= maxW)) return labels.map((label) => [label]);
  const word = maxOf(labels.flatMap((label) => label.split(/\s+/)).map((w) => measure(w, font).width));
  return labels.map((label) => {
    const wrapped = wrapText(label, font, Math.max(word, maxW), 2, measure);
    return wrapped.truncated ? [label] : wrapped.lines;
  });
}

/** Uppercase tracking for quadrant captions (px) — the table-header value. */
const CAPTION_TRACKING = 0.5;
/** Clear space between the y-axis title and the top tick label. */
const AXIS_TITLE_RESERVE = 2;

/**
 * Height of the band above the plot that holds the y-axis title: the title as
 * measured, half the tallest end tick label (a tick at the top of the plot is
 * centred on it, so half of it rises above plot.y) and a reserve. Both heights
 * come from the measurer, since a host font can set the axis title
 * taller than the tick digits.
 */
function yTitleBand(title: string, ends: string[], titleFont: FontSpec, tickFont: FontSpec, measure: TextMeasurer): number {
  const tickH = Math.max(...ends.map((text) => measure(text, tickFont).height));
  return measure(title, titleFont).height + tickH / 2 + AXIS_TITLE_RESERVE;
}

/**
 * The dot radius without a size channel: a dense cloud keeps the small dot, a
 * sparse one the larger dot, and a wide card the wide dot.
 */
export function scatterDotRadius(env: Pick<ScatterEnv, 'size'>, domain: Pick<ScatterDomain, 'ticks' | 'pts'>): number {
  return domain.ticks && domain.pts.length <= DOT_DENSE_COUNT ? (env.size.width >= WIDE_CARD ? DOT_R_WIDE : DOT_R_SPARSE) : DOT_R;
}

/** The marks a fill twin applies to: 12 x 12 px or more, as for a heatmap cell. */
const LARGE_MARK = 12;

/** The smaller side of a point marker's box at radius r, as pointMarkNode draws it. */
function markerSide(marker: NormPt['marker'], r: number): number {
  if (marker === 'circle') return 2 * r;
  if (marker === 'square') return 1.8 * r;
  if (marker === 'triangle') return 2.2 * r;
  if (marker === 'diamond') return 2.6 * r;
  return 0;
}

export function scatterPaints(
  env: ScatterEnv,
  groups: ReadonlyMap<Id, NormGroup>,
  pts: readonly NormPt[] = [],
  /** The dot radius when no size channel is active; a marker this large in a tone fills with its twin. */
  dotR?: number,
): ScatterPaints {
  const { theme, palette, highlights } = env;
  // A tone that prints as text fills a mark of 12 x 12 px or more with its
  // fill twin, as other charts do; the r 5.5 dot made triangles and
  // diamonds that large. A group key follows when all its drawn marks do.
  // A hollow point draws its tone as an outline, which keeps the tone.
  const large = (p: NormPt): boolean => dotR !== undefined && p.scenario !== 'PL' && p.scenario !== 'FC' && markerSide(p.marker, dotR) >= LARGE_MARK;
  const groupLarge = new Map<Id, boolean>();
  for (const gid of groups.keys()) {
    const drawn = pts.filter((p) => p.group === gid && p.marker !== 'none');
    groupLarge.set(gid, drawn.length > 0 && drawn.every(large));
  }
  const rolePaint = (gid: Id, fill: boolean): Paint | undefined => {
    const g = groups.get(gid)!;
    // The rest role recedes as a muted mark: its page-pale 'others' fill would not read as a dot.
    return g.colorRole === 'others' ? mutedMarkPaint() : g.colorRole ? markRolePaint(g.colorRole, fill) : undefined;
  };
  const group = (gid: Id | undefined): Paint => {
    if (gid === undefined) return themeSeriesPaint(0, palette);
    const g = groups.get(gid)!;
    return rolePaint(gid, groupLarge.get(gid) ?? false) ?? themeSeriesPaint(g.idx, palette);
  };
  // A highlighted point keeps its group's fill, so it still matches its key
  // swatch, and takes a ring instead.
  const highlighted = (p: NormPt): boolean => highlights.has(p.id) || (p.group !== undefined && highlights.has(p.group));
  const point = (p: NormPt): Paint => {
    if (p.fill) return { css: p.fill };
    if (p.group !== undefined) return (large(p) ? rolePaint(p.group, true) : undefined) ?? group(p.group);
    // A point outside every group, such as a group average, must not borrow
    // the first group's colour: it takes the neutral mark and its own key.
    if (!p.scenario && groups.size > 0) return { token: 'neutralMark' };
    if (p.scenario) {
      return themeSeriesPaint(0, palette, p.scenario);
    }
    return group(p.group);
  };
  const hollow = (p: NormPt): boolean => p.scenario === 'PL' || p.scenario === 'FC';
  const insideFill = (p: NormPt): string => (hollow(p) ? theme.color.background : paintColor(theme, point(p)));
  // The ring reads apart from every point colour: in standard-dark the focus
  // blue sits 5.6 OKLab from the second Atlantic rank, so a ringed point would
  // read as a bigger dot. Where the focus is that close, the ring takes the ink.
  const apartFrom = [...new Map(pts.map((p) => [JSON.stringify(point(p)), point(p)] as const)).values()];
  const recipe = { kind: 'focus-apart' as const, apartFrom };
  const ring: Paint = { token: paintColor(theme, { token: 'ink', theme: recipe }) === theme.color.ink ? 'ink' : 'focus', theme: recipe };
  return { group, point, hollow, insideFill, highlighted, ring };
}

/**
 * Width a value-line label needs right of the plot, where the annotation pass
 * prints it: its text as annotate.ts writes it, in the label font, plus the
 * 4px gap to the plot and 4px of air. Without it a label wider than the
 * canvas margin was hidden while its line was drawn.
 */
function valueLineLabelRight(env: ScatterEnv, domain: ScatterDomain): number {
  const format = env.options.axisFormat?.y ?? env.options.format;
  const fmt = format ? formatterFromExample(format, env.options.locale?.language) : (v: number) => formatAutomaticNumber(v);
  const font = { family: env.theme.type.family, ...env.theme.type.label };
  let width = 0;
  for (const line of drawnValueLines(domain.annotations, domain.meanY)) {
    const ann = domain.annotations[line.index]!;
    if (ann.kind !== 'valueLine' || ann.label === false || (ann.side ?? 'right') !== 'right') continue;
    const text = ann.label ?? (line.isMean ? `Ø ${fmt(line.value)}` : fmt(line.value));
    if (text) width = Math.max(width, env.measure(text, font).width + 8);
  }
  return width;
}

/**
 * A group's key in the shape its points draw: a circle, a
 * triangle, a diamond, or a square, outlined when every point of the group
 * is hollow.
 */
function groupKeyShape(domain: ScatterDomain, gid: Id): Partial<LegendItemInput> {
  const members = domain.pts.filter((p) => p.group === gid);
  const marker = groupMarker(domain, gid);
  const hollow = members.length > 0 && members.every((p) => p.scenario === 'PL' || p.scenario === 'FC');
  return markerKeyShape(marker, hollow);
}

// A group keys in its own marker, else in the first marker its points draw; it is
// 'none' (no key) only when none of its points draws a mark.
const groupMarker = (domain: ScatterDomain, gid: Id): NormPt['marker'] => {
  const own = domain.groups.get(gid)?.marker;
  if (own !== undefined && own !== 'none') return own;
  const members = domain.pts.filter((p) => p.group === gid);
  if (members.length === 0) return own ?? 'circle';
  return members.find((p) => p.marker !== 'none')?.marker ?? 'none';
};

/** A key in a marker's own shape: dot at its own size, triangle, diamond, or square (hollow as drawn). */
function markerKeyShape(marker: NormPt['marker'], hollow: boolean): Partial<LegendItemInput> {
  // A dot keys at its own size; a bubble group keys its colour on the box-sized circle.
  if (marker === 'circle') return { key: 'marker', radius: KEY_DOT_R };
  if (marker === 'triangle') return { key: 'triangle' };
  if (marker === 'diamond') return { key: 'diamond' };
  return hollow ? { hollow: true } : {};
}

/**
 * Points the group keys do not explain: a point drawn in another
 * shape than its group, such as a diamond among dots, and a point outside every
 * group, such as a group average. Each is keyed in its own shape and colour
 * under its own name; more than three ungrouped points share one entry.
 */
function pointKeyItems(domain: ScatterDomain, paints: ScatterPaints): LegendItemInput[] {
  const drawn = domain.pts.filter((p) => p.marker !== 'none');
  const odd = drawn.filter((p) => p.group !== undefined && p.marker !== (domain.groups.get(p.group)?.marker ?? 'circle'));
  const loose = drawn.filter((p) => p.group === undefined);
  const item = (p: NormPt, label: string): LegendItemInput => ({
    id: `point:${p.id}`, label, paint: paints.point(p), ...markerKeyShape(p.marker, paints.hollow(p)),
  });
  return [
    ...odd.map((p) => item(p, `${domain.groups.get(p.group!)?.label ?? p.group}: ${p.label}`)),
    ...(loose.length <= 3 ? loose.map((p) => item(p, p.label)) : [item(loose[0]!, `Without a group: ${loose.map((p) => p.label).join(', ')}`)]),
  ];
}

/** The frame, with the legend as a layout participant; it claims into an index of its own. */
/** An unpinned scatter's plot is at least this plus a share of its width tall, up to the cap (236 px at 270 wide, 272 at 430). */
const UNPINNED_PLOT_BASE = 175;
const UNPINNED_PLOT_SHARE = 0.225;
const UNPINNED_PLOT_CAP = 280;

export function solveScatterFrame(
  env: ScatterEnv,
  domain: ScatterDomain,
  paints: ScatterPaints,
  /** Keys beside the groups, in the key row: the highlight ring, trend lines, bubble sizes. */
  keyItems: readonly LegendItemInput[] = [],
  /** Notes only a later pass knows, such as the names the plot could not place. */
  lateNotes: readonly string[] = [],
  /** The one "Not labelled on the chart" note, with the registry's items and the names; the footnotes it leaves are the authored ones. */
  hiddenNote?: { footnotes: string[]; line: string[] },
): { frame: FrameResult; claims: OccupiedIndex } {
  const { options, theme, size } = env;
  const tokenMargin = canvasMargin(theme, size.width);
  const margin = {
    ...tokenMargin,
    right: Math.max(tokenMargin.right, valueLineLabelRight(env, domain)),
    ...options.margin,
  };
  let legendInput: FrameInput['legend'];
  const named = options.legend !== undefined;
  // a label-only group (marker 'none') draws no mark, so the key has no swatch for it.
  const keyedGroups = domain.shownGroups.filter((g) => groupMarker(domain, g.id) !== 'none');
  const groupsKeyed = named && options.legend !== 'none' && keyedGroups.length > 0;
  if (options.legend !== 'none' && (groupsKeyed || keyItems.length > 0)) {
    // Keys sit in the row above the plot unless the spec names a place.
    const legendOpts: LegendOptions = (named ? normalizeLegendOption(options.legend) : undefined) ?? { position: 'top' };
    let items: LegendItemInput[] = groupsKeyed ? [...keyedGroups.map((g) => ({
      id: g.id,
      label: g.label,
      paint: paints.group(g.id),
      ...groupKeyShape(domain, g.id),
    })), ...pointKeyItems(domain, paints)] : [];
    if (legendOpts.order) {
      const oi = (id: Id) => {
        const k = legendOpts.order!.indexOf(id);
        return k === -1 ? Number.MAX_SAFE_INTEGER : k;
      };
      items = [...items].sort((a, b) => oi(a.id) - oi(b.id));
    }
    legendInput = { options: legendOpts, items: [...items, ...keyItems] };
  }
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frame = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      footnotes: [
        ...(options.methodNote === true ? [...domain.baselineNotes, ...domain.quadrants.notes] : []),
        ...domain.derivedNotes,
        ...lateNotes,
        ...(hiddenNote?.footnotes ?? authoredNotes(options)),
        ...(hiddenNote?.line ?? []),
      ],
      legend: legendInput,
      theme,
      measure: env.measure,
    },
    claims,
  );
  return { frame, claims };
}

/** Room between a qualitative axis column and the plot. */
export const QUALITATIVE_GAP = 8;

/**
 * The y column of qualitative axes: its ends and its bold title, wrapped to
 * the widest end word or a tenth of the plot width, whichever is wider.
 */
export function qualitativeColumn(env: ScatterEnv, fonts: ScatterFonts, plotW: number): { width: number; lines: string[]; low: string; high: string } {
  const strings = env.options.strings;
  const low = strings?.axisLow ?? 'Lower', high = strings?.axisHigh ?? 'Higher';
  const bold = fonts.axisTitle;
  const ends = Math.max(env.measure(low, fonts.tick).width, env.measure(high, fonts.tick).width);
  const title = env.options.axisTitles?.y ?? '';
  const width = Math.max(ends, Math.min(env.measure(title, bold).width, Math.max(ends, plotW * 0.1)));
  const lines = title ? wrapText(title, bold, width, 4, env.measure).lines : [];
  return { width: Math.max(width, ...lines.map((line) => env.measure(line, bold).width)), lines, low, high };
}

function scatterFonts(theme: Theme): ScatterFonts {
  return {
    tick: { family: theme.type.family, ...theme.type.axis },
    label: {
      family: theme.type.family,
      ...theme.type.label,
    },
    // A quadrant caption names a REGION of the plot; a point label names one
    // unit. Set in the same face they were indistinguishable, and a reader counts
    // "Stars" as a sixth company. So the caption takes the repo's region-furniture
    // register — the same one band annotations already use (`annotate.ts`
    // uppercase at axis size) and table headers use (uppercase, regular, tracked):
    // uppercase, axis size, regular, tracked, muted ink. Four signals, each
    // legible on its own at 96 dpi, none of them a color a reader must decode.
    caption: {
      family: theme.type.family,
      ...theme.type.axis,
      weight: theme.type.axis.weight,
      letterSpacing: CAPTION_TRACKING,
    },
    // Axis titles: the x title sits centred under the tick row, the y title
    // reads horizontally above the axis column (no rotated text on an exhibit).
    axisTitle: { family: theme.type.family, ...theme.type.axis },
  };
}

/** The plot rect inside the frame (both value axes SHOWN BY DEFAULT: position encoding) and its scales. */
export function scatterPlotArea(
  env: ScatterEnv,
  domain: ScatterDomain,
  frame: FrameResult,
  warnings: LintWarning[],
): ScatterPlotArea {
  const { options, theme, measure, va } = env;
  const fmt = env.axisFmt.y;
  const [dxLo, dxHi] = domain.dx;
  const [dyLo, dyHi] = domain.dy;
  const fonts = scatterFonts(theme);
  const showAxes = va.show ?? true;
  const tickH = measure('0', fonts.tick).height;
  const zoneGrid = options.zones && 'grid' in options.zones ? options.zones.grid : undefined;
  const banded = bandedAxes(env, domain);
  // A y band column wider than its share of the plot wraps its labels on two lines (scatter.matrix 320–480).
  const yBandLines = zoneGrid?.yLabels?.length ? bandLines(zoneGrid.yLabels, fonts.tick, measure, Y_BAND_SHARE * frame.plot.w) : undefined;
  const yBandW = yBandLines
    ? maxOf(yBandLines.flat().map((line) => measure(line, fonts.tick).width)) + ZONE_BAND_GAP
    : 0;
  // A log y axis is measured over its densest tick set, in its own tick text.
  const yFmt = env.log.y ? logSpecFormat(env.axisSpec.y) : fmt;
  const axisTitles = options.axisTitles ?? {};
  const qualitative = showAxes && options.qualitativeAxes === true;
  const yAxisW = qualitative ? qualitativeColumn(env, fonts, frame.plot.w).width + QUALITATIVE_GAP : showAxes && !banded.y
    ? measureValueAxisWidth([dyLo, dyHi], yFmt, theme, measure, 5, env.log.y ? undefined : env.axisSpec.y, env.log.y ? logTickTiers(dyLo, dyHi)[0] : undefined) : 0;
  // A banded axis prints no numbers, so it reserves no tick row or column (scatter.matrix).
  const xAxisH = showAxes && !banded.x ? tickH + 6 : 0;
  // A qualitative x title shares the row of its ends; the y title sits in the axis column.
  const xTitleH = showAxes && axisTitles.x && !qualitative ? tickH + 4 : 0;
  const yTitleH = showAxes && axisTitles.y && !qualitative
    // A banded y axis has no end tick rising over the plot (scatter.matrix).
    ? banded.y ? measure(axisTitles.y, fonts.axisTitle).height + AXIS_TITLE_RESERVE : yTitleBand(axisTitles.y, ['0', yFmt(dyLo), yFmt(dyHi)], fonts.axisTitle, fonts.tick, measure) : 0;
  if (showAxes && (!axisTitles.x || !axisTitles.y)) {
    warnings.push({
      code: 'scatter-axis-untitled',
      severity: 'warn',
      message: `scatter axes without titles: the reader has to guess which axis is which`,
      suggest: `set axisTitles: { x: '...', y: '...' } (the subtitle measure names the pair, not the sides)`,
    });
  }
  for (const axis of ['x', 'y'] as const) {
    const title = axisTitles[axis];
    if (!showAxes || !env.log[axis] || !title || /\blog/i.test(title)) continue;
    warnings.push({
      code: 'log-axis-unnamed',
      severity: 'info',
      message: `the ${axis === 'x' ? 'horizontal' : 'vertical'} axis is on a log scale and its title does not say so`,
      suggest: `add it to the title, e.g. axisTitles.${axis}: '${title}, log scale'`,
      field: ['options', 'axisTitles', axis],
    });
  }
  const plotX = frame.plot.x + yBandW + yAxisW;
  const plotW = Math.max(10, frame.plot.w - yBandW - yAxisW);
  const x = (env.log.x ? logScale : linearScale)([dxLo, dxHi], [plotX, plotX + plotW]);
  // An x band label wider than its column wraps on two lines (scatter.matrix 320).
  const xBounds = zoneGrid ? [dxLo, ...zoneGrid.x, dxHi] : [];
  const xBandLines = zoneGrid?.xLabels?.length
    ? zoneGrid.xLabels.map((label, i) => bandLines([label], fonts.tick, measure, Math.abs(x(xBounds[i + 1] ?? dxHi) - x(xBounds[i] ?? dxLo)) - 2 * ZONE_BAND_GAP)[0]!)
    : undefined;
  const xBandH = xBandLines ? maxOf(xBandLines.map((lines) => lines.length)) * tickH + ZONE_BAND_GAP : 0;
  const plot: Rect = {
    x: plotX,
    y: frame.plot.y + 8 + yTitleH,
    w: plotW,
    h: plotHeightAfter(frame, env.size.height, frame.plot.h - 8 - yTitleH - xAxisH - xTitleH - xBandH),
  };

  const yScale = env.log.y ? logScale : linearScale;
  const y = va.reverse
    ? yScale([dyLo, dyHi], [plot.y, plot.y + plot.h])
    : yScale([dyLo, dyHi], [plot.y + plot.h, plot.y]);
  // reserve a measured plot after notes, including both caption rows.
  const labelH = measure('0', fonts.label).height;
  // Scatter is outside HOLDS_COMPACT_PLOT, so it holds the hard-minimum plot itself.
  let minPlot = Math.max(plotFloorRows(options) * labelH + 8, atHardMinimum(options) ? HARD_COMPACT_PLOT : 0);
  if (domain.quadrants.derived && options.quadrants?.labels) {
    const split = yScale([dyLo, dyHi], [0, 1])(domain.quadrants.derived.y);
    const shares = [split, 1 - split].filter(share => share > 0 && share < 1);
    if (shares.length) minPlot = Math.max(minPlot,
      (2 * fonts.caption.size * (fonts.caption.lineHeight ?? 1.2) + 12 + labelH + 4) / Math.min(...shares));
  }
  // A strategy grid row holds a cell caption over a point name (scatter.matrix).
  if (zoneGrid) {
    const captionH = fonts.caption.size * (fonts.caption.lineHeight ?? 1.2);
    minPlot = Math.max(minPlot, (zoneGrid.y.length + 1) * (captionH + labelH + GRID_ROW_PAD));
  }
  const rawHeight = frame.plot.h - 8 - yTitleH - xAxisH - xTitleH - xBandH;
  // An unpinned card keeps a plot height for its width: a narrow plot stays
  // near square (272 px for 430 px wide, where the height ladder gives 235). Wide plots keep what the ladder gives.
  // Only a plot under it grows, so a card that has the room reports its real minimum.
  const wish = Math.min(UNPINNED_PLOT_CAP, Math.round(UNPINNED_PLOT_BASE + UNPINNED_PLOT_SHARE * plotW));
  if ((options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && panelTypeClass(options) === undefined && rawHeight < wish) {
    minPlot = Math.max(minPlot, wish);
  }
  frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0,
    env.size.height + (frame.deficit ?? 0) + minPlot - rawHeight);
  const rFraction = plot.w < NARROW_PLOT ? MAX_R_FRACTION_NARROW : MAX_R_FRACTION;
  const { bubbleMode, sizeMax } = domain;
  const plotMin = Math.min(plot.w, plot.h);
  // A few bubbles on a box grid (a 2x2 or a strategy grid) keep a readable
  // largest bubble on a small plot.
  const boxGrid = domain.quadrants.derived !== undefined || zoneGrid !== undefined;
  // A strategy grid on a narrow plot keeps room in each cell for its caption beside the bubble (scatter.matrix 480-320).
  const cap = zoneGrid !== undefined && plot.w < NARROW_PLOT ? SPARSE_R_CAP_NARROW_GRID : SPARSE_R_CAP;
  const sparseFloor = bubbleMode && boxGrid && domain.pts.length <= SPARSE_BUBBLES ? Math.min(SPARSE_R_FLOOR, cap * plotMin) : 0;
  const rMax = Math.max(MIN_R + 2, rFraction * plotMin, sparseFloor);
  const sizeBy = options.sizeBy ?? 'area';
  // The larger dot comes with the tick-aligned axes of a plain dot scatter (domain.ticks).
  // From a 720 px card on, the sparse dot takes the wide radius.
  const dotR = scatterDotRadius(env, domain);
  const radiusOf = (p: Pick<NormPt, 'size'>): number => {
    if (!bubbleMode) return dotR;
    if (p.size === null || sizeMax === undefined || sizeMax <= 0) return MIN_R + 0.5;
    const frac = p.size / sizeMax;
    if (frac <= 0) return MIN_R;
    return Math.max(MIN_R, sizeBy === 'diameter' ? frac * rMax : Math.sqrt(frac) * rMax);
  };
  return {
    plot,
    inner: frame.plot,
    fonts,
    showAxes,
    qualitative,
    axisTitles,
    xAxisH,
    yAxisW,
    xBandH,
    yBandW,
    ...(xBandLines ? { xBandLines } : {}),
    ...(yBandLines ? { yBandLines } : {}),
    x,
    y,
    radiusOf,
  };
}
