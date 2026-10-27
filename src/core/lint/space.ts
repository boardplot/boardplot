/**
 * Space-core lints — plot-ratio-under-floor, dead-band, ink-envelope (the
 * gate side of the headroom and floor-band checks, with the annotation
 * clause), furniture-budget (warn).
 *
 * POPULATION (named out loud): these run at the DOCUMENT
 * boundary (`layoutDocChart` in the CLI), exactly
 * like the aspect lints, and for the same reason: grid PANELS lay
 * out through the registry with slot-sized canvases and must never reach a
 * canvas gate. They measure the occupancy grid (`geo.debug.occupied`) and
 * the plot rect — the rendered truth, never the authored option.
 *
 * They are SKIPPED when the geometry already carries an error-severity
 * warning: a refused chart gets ONE trace naming the real cause, not
 * a refusal plus a space complaint about the refusal's own render.
 *
 * Scope decisions that narrow the general rule:
 *  - The plot-ratio height AND width floors skip `row-driven` (row-driven is
 *    bound by the pitch minima instead) and the width floor skips card/strip
 *    (cards are exempt from the width classes the floors are keyed to).
 *  - The ink-envelope vertical checks cover charts whose VALUE axis is vertical:
 *    classes standard-cartesian / wide-time minus pie (no value axis),
 *    minus `variant: 'horizontal'` twins (a transposed twin is not a
 *    mirror; gating it wrong is worse than a named gap), minus
 *    the line `bump` variant (rank lanes are ordinal, not a value axis).
 *  - The ink-envelope horizontal check covers charts with a CONTINUOUS numeric
 *    x axis; band and point category axes fill their range by construction,
 *    and authored empty periods belong to the null-stretch policy.
 *  - Degenerate zero-extent data (a flat pair on a padded domain) is the
 *    exactly-empty convention: nothing can fill 80% of a plot with a
 *    1px-tall data body, so the envelope checks stand down.
 */

import { aspectClassFor, furnitureBudget, furnitureScoped, HEIGHT_FLOOR_CLASSES, onLadderStep, type AspectClass } from '../aspect';
import { resolveTheme, spaceTokens } from '../theme';
import type { ThemeRef } from '../types/theme';
import type { Rect } from '../geometry';
import type { Geometry, LintWarning, OccupiedRect } from '../types/scene';
import { contentSized, furnitureShare, plotFloorShare } from '../sizing';
import { maxOf, minOf } from '../arrays';

/** Plot-ratio floors. */
const PLOT_H_FLOOR = 0.6;
// The 0.5 floors are the automatic height's plot share (PLOT_FLOOR_SHARE, frame rule 3), read
// where the lint runs: an automatic height that keeps its share passes, exactly 50 % included.
const PLOT_H_FLOOR_STRIP = 0.45;
const PLOT_W_FLOOR = 0.72;
export const PLOT_W_FLOOR_DEMOTED = 0.62; // right label column / right legend

/** Ink-envelope limits: headroom ≤ 15%, annotation residual ≤ 8px, floor ≤ 8px,
 * vertical envelope ≥ 0.80, horizontal span ≥ 0.85. */
const HEADROOM_MAX = 0.15;
const RESIDUAL_MAX_PX = 8;
const FLOOR_MAX_PX = 8;
const V_ENVELOPE_MIN = 0.8;
const H_ENVELOPE_MIN = 0.85;
/** Measurement grace on ratio gates: half a device pixel on a 250px plot. */
const EPS = 0.002;
/** Sub-pixel grace on absolute px gates. */
const PX_EPS = 0.5;

/** Scope: charts with a vertical value axis (see module comment). */
function verticalValueScope(
  cls: AspectClass,
  type: string,
  options: Record<string, unknown> | undefined,
): boolean {
  if (cls !== 'standard-cartesian' && cls !== 'wide-time') return false;
  if (type === 'pie') return false; // no value axis
  if (options?.variant === 'horizontal') return false; // a named gap, not a wrong gate
  if (options?.variant === 'bump') return false; // rank lanes, not a value axis
  return true;
}

interface Interval {
  from: number;
  to: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((iv) => iv.to > iv.from)
    .sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.from <= last.to) last.to = Math.max(last.to, iv.to);
    else merged.push({ ...iv });
  }
  return merged;
}

function fmtRatio(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

/**
 * The one change that clears each finding, as one imperative sentence. They
 * live beside the thresholds rather than inside the sweep, so adding a
 * sentence never lengthens the function that reports it.
 */
const REPAIR = {
  plotHeight: 'Shorten the footer, drop the legend, or raise the canvas height.',
  plotWidth: 'Shorten the side labels, widen the canvas, or put the legend in a horizontal band.',
  furniture: 'Trim the footnote stack or raise the canvas height.',
  bracketResidual: 'Lower the value-axis maximum so the annotation sits near the top of the plot.',
  headroom: 'Lower the value-axis maximum towards the largest value.',
  floorBand: 'Raise the value-axis minimum to zero, or remove the extra bottom padding.',
  envelope: 'Narrow the value-axis range to the data.',
  span: 'Narrow the x-axis range to the data.',
  deadBand: 'Remove the margin you set, or lower the canvas height.',
} as const;

/**
 * The furniture finding names the drawn row that costs the most. Frame
 * bands keep their measured height: a two-column event key is one band,
 * and the footer includes its source, notes and credit. Text rows include
 * their first line. A kpi card's value blocks are not frame rows, so a card
 * keeps the general sentence.
 */
function furnitureFinding(
  type: string, furniture: number, budget: number, geo: Geometry, legendRow: boolean, options: Record<string, unknown> | undefined,
): [string, string] {
  const message = `'${type}' spends ${fmtRatio(furniture)} of its height on everything but the plot, over the ${budget} budget.`;
  if (type === 'kpi') return [message, REPAIR.furniture];
  const tokens = spaceTokens(resolveTheme((options as { theme?: ThemeRef } | undefined)?.theme), geo.size.width);
  const framePlot = geo.frame.plotRect ?? geo.plot;
  const text = geo.scene.flatMap((node) => (node.t === 'text' && node.opacity !== 0 ? [node] : []));
  const height = (parts: string[]): number => {
    // A grid's panel headers belong to its plot, not to its outer frame.
    const nodes = text.filter(node => parts.includes(node.part) && node.y < framePlot.y);
    if (nodes.length === 0) return 0;
    return maxOf(nodes.map(node => node.y + node.lines.length * node.font.size * (node.font.lineHeight ?? 1.2)))
      - minOf(nodes.map(node => node.y));
  };
  const footer = geo.frame.footerRect?.h ?? 0;
  const eventKey = geo.frame.eventKeyRect;
  const beforeFooter = eventKey ?? (legendRow && geo.legend && geo.legend.rect.y >= framePlot.y + framePlot.h
    ? geo.legend.rect : framePlot);
  const footerGap = geo.frame.footerRect
    ? Math.max(0, geo.frame.footerRect.y - beforeFooter.y - beforeFooter.h) : 0;
  const title = height(['title']);
  const subtitle = height(['subtitle']);
  const tickBand = (geo.derived as { tickBand?: { reserved?: number; measuredLines?: number; lineHeight?: number } } | undefined)?.tickBand;
  const rows: [string, number, string][] = [
    ['legend', legendRow && geo.legend ? geo.legend.rect.h + tokens.gapLegend : 0, "Set legend to 'none' or raise the canvas height."],
    ['event key', eventKey && eventKey.h > 0 ? eventKey.h + tokens.gapAxisFootnote : 0, 'Shorten the event text, increase events.rows, or raise the canvas height.'],
    ['footer', footer > 0 ? footer + footerGap : 0, 'Shorten the notes or source line, or raise the canvas height.'],
    ['title', title > 0 ? title + (subtitle > 0 ? tokens.gapTitleSubtitle : tokens.gapSubtitlePlot) : 0,
      (geo.frame.titleLines ?? 1) > 1 ? 'Shorten the title to one line or raise the canvas height.' : 'Raise the canvas height.'],
    ['subtitle', subtitle > 0 ? subtitle + tokens.gapSubtitlePlot : 0, 'Shorten or omit the subtitle, or raise the canvas height.'],
    ['category labels', tickBand?.reserved ?? (tickBand?.measuredLines ?? 0) * (tickBand?.lineHeight ?? 0),
      (tickBand?.measuredLines ?? 1) > 1 ? 'Shorten the category labels to one line or raise the canvas height.' : 'Raise the canvas height.'],
  ];
  const [name, px, fix] = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (px <= 0) return [`${message} Every row is at its minimum.`, 'Raise the canvas height.'];
  return [`${message} The ${name} row costs the most at ${Math.round(px)}px.`, fix];
}

export function spaceDocLints(
  type: string,
  options: Record<string, unknown> | undefined,
  geo: Geometry,
): LintWarning[] {
  // One trace per refusal: a chart the layout already refuses, or the
  // aspect gates already block, gets its real cause and nothing stacked on.
  if (geo.warnings.some((w) => w.severity === 'error')) return [];
  const cls = aspectClassFor(type, options, geo.marks);
  if (!cls) return [];
  const warnings: LintWarning[] = [];
  const { width: W, height: H } = geo.size;
  const plot = geo.plot;
  const occupied: OccupiedRect[] = geo.debug.occupied;
  const push = (code: string, message: string, suggest?: string) =>
    warnings.push({
      code,
      severity: 'warn',
      message,
      ...(suggest ? { suggest } : {}),
    });

  const footnoteLines = geo.scene
    .filter((n) => n.t === 'text' && n.part === 'footnote')
    .reduce((sum, n) => sum + (n as { lines: string[] }).lines.length, 0);
  const legendRect = geo.legend?.rect;
  // A horizontal band sits fully above or below the plot; a right legend
  // overlaps the plot's vertical range.
  const legendHorizontal =
    legendRect !== undefined &&
    (legendRect.y + legendRect.h <= plot.y + PX_EPS || legendRect.y >= plot.y + plot.h - PX_EPS);
  const legendRight = legendRect !== undefined && !legendHorizontal;
  // A label column starts at the plot's right edge. A line's end names start inside the plot's
  // half-step past the last point and run out of it; no other label that crosses the edge is a column.
  const labelColumnRight = occupied.some(
    (o) => o.kind === 'label' && o.rect.w > 0 && o.rect.x >= plot.x + plot.w - PX_EPS,
  ) || geo.labels.some((label) => label.kind === 'series' && !label.hidden && label.rect.w > 0 && label.rect.x + label.rect.w > plot.x + plot.w + PX_EPS);

  // ---- plot-ratio-under-floor -----------------------------------------
  // Height binds the FRAME plot band (header/legend/footer vs the rest):
  // the floors were measured off rendered shots, where annotation
  // headroom and the tick row read as exhibit content — with the chart-side
  // plot, a well-composed waterfall with tight
  // headroom and a single-line source would fail the floor it illustrates.
  // Width binds the CHART plot: side label columns are exactly what the
  // 0.72/0.62 floors police, and they live inside the frame band.
  const framePlot = geo.frame.plotRect ?? plot;
  // A y-category cartesian (box) runs its rows horizontally: its left label
  // column is CATEGORY furniture — the row-driven story, not the side-label
  // waste the width floors police — so the width floor stands down there.
  const categoryYAxis = geo.axes.some(
    (a) => a.axis === 'y' && a.ticks.length > 0 && a.ticks.some((t) => typeof t.at !== 'number'),
  );
  // Matrix heights are pitch-derived when the canvas sits off the ladder
  // (snapping a 25-row matrix would corrupt its row density) — those
  // heights belong to the pitch formula's info lint, not to this floor.
  const matrixPitchDriven = cls === 'matrix' && onLadderStep(geo.size) === null;
  // kpi's plot rect is its SPARK SLOT, a subordinate element — the card's
  // data layer is the value block, which no plot ratio can see. The furniture
  // budget (warn) is the card gate for kpi;
  // card-floor blocking stays with bullet, whose plot IS the data area.
  const kpiCard = cls === 'card' && type === 'kpi';
  // A content-sized chart's height is its content, not a canvas proportion.
  const proportioned = !contentSized(type, options, geo.sizing?.fit);
  const heightScoped = proportioned && (
    (HEIGHT_FLOOR_CLASSES.has(cls) && !matrixPitchDriven) ||
    (cls === 'card' && !kpiCard) ||
    cls === 'strip');
  if (heightScoped) {
    // Below 600 px an automatic height keeps 0.4 (plotFloorShare).
    const PLOT_FLOOR_SHARE = plotFloorShare(W);
    const hFloor =
      cls === 'card'
        ? PLOT_FLOOR_SHARE
        : cls === 'strip'
          ? PLOT_H_FLOOR_STRIP
          : W < 720
            ? PLOT_FLOOR_SHARE
          // legend row + ≥2 footnote lines
          : legendHorizontal && footnoteLines >= 2
            ? PLOT_FLOOR_SHARE
            : PLOT_H_FLOOR;
    const hRatio = framePlot.h / H;
    if (hRatio < hFloor - EPS) {
      push(
        'plot-ratio-under-floor',
        `'${type}' gives the plot ${fmtRatio(hRatio)} of the canvas height, under the ${hFloor} floor for this type. Title, legend and footnotes take the rest.`, REPAIR.plotHeight,
      );
    }
    // a rank ladder of two or three periods is its two name columns;
    // the plot needs only its band steps, so the names take the width.
    const fewPeriodBump = (geo.derived as { bump?: unknown } | undefined)?.bump !== undefined &&
      (geo.axes.find((a) => a.axis === 'x')?.ticks.length ?? 0) <= 3;
    if (HEIGHT_FLOOR_CLASSES.has(cls) && !categoryYAxis && !fewPeriodBump) {
      const wFloor = legendRight || labelColumnRight ? PLOT_W_FLOOR_DEMOTED : PLOT_W_FLOOR;
      const wRatio = plot.w / W;
      if (wRatio < wFloor - EPS) {
        push(
          'plot-ratio-under-floor',
          `'${type}' gives the plot ${fmtRatio(wRatio)} of the canvas width, under the ${wFloor} floor. Side labels and the legend take the rest.`, REPAIR.plotWidth,
        );
      }
    }
  }

  // ---- furniture-budget (warn) ----------------------------------------
  // The axis-label row counts as furniture, so the budget adds the
  // tick-band receipt (when the chart carries one) to the frame stack.
  // kpi rejoins here: the budget warn IS the gate for kpi.
  if (proportioned && furnitureScoped(cls, geo.size)) {
    const budget = furnitureBudget(W);
    const furniture = furnitureShare(geo);
    if (furniture > budget + EPS) {
      push('furniture-budget', ...furnitureFinding(type, furniture, budget, geo, legendHorizontal, options));
    }
  }

  // ---- ink-envelope (headroom, floor band, annotation clause) -------------
  // Authored zones/quadrants (growth-share, nine-box, risk matrices) define analytic space:
  // an empty quadrant IS information there, so the waste gates stand down —
  // the rationale targets unauthored slack (headroom, null-stretch),
  // never authored analytic geometry.
  const analyticSpace = options?.zones !== undefined || options?.quadrants !== undefined;
  const comparisonPinnedYDomain =
    (geo.derived as { comparisonPinnedYDomain?: unknown } | undefined)?.comparisonPinnedYDomain === true;
  if (verticalValueScope(cls, type, options) && !analyticSpace) {
    const dataRects = occupied.filter(
      (o) =>
        (o.kind === 'mark' || o.kind === 'label') &&
        o.owner.annotationId === undefined &&
        o.rect.w > 0 &&
        o.rect.h > 0,
    );
    const markRects = dataRects.filter((o) => o.kind === 'mark');
    const categoryY = geo.axes.some(
      (a) => a.axis === 'y' && a.ticks.length > 0 && a.ticks.some((t) => typeof t.at !== 'number'),
    );
    if (markRects.length > 0 && !categoryY) {
      const markTop = minOf(markRects.map((o) => o.rect.y));
      const markBottom = maxOf(markRects.map((o) => o.rect.y + o.rect.h));
      // Flat data renders a marker-height body: the envelope floors are
      // defined over data with vertical extent, so the exactly-degenerate case
      // stands down (the exactly-empty convention). The body of one point is
      // its mark's diameter.
      const degenerate = markBottom - markTop <= singleBody(markRects, 'h') + PX_EPS;
      const dataTop = minOf(dataRects.map((o) => o.rect.y));
      const dataBottom = maxOf(dataRects.map((o) => o.rect.y + o.rect.h));
      const annotationRects = occupied.filter(
        (o) => o.owner.annotationId !== undefined && o.rect.w > 0 && o.rect.h > 0,
      );
      const annotationTop =
        annotationRects.length > 0 ? minOf(annotationRects.map((o) => o.rect.y)) : Infinity;

      // Discriminator: only ARM-carrying brackets (cagr / spanning diff)
      // are top-anchored lane furniture; a level-diff arrow is in-plot ink
      // and keeps the plain headroom rule. The arm claim is the mechanism.
      const armedIds = new Set(
        annotationRects
          .filter((o) => o.part === 'arm')
          .map((o) => o.owner.annotationId as string),
      );
      const bracketRects = annotationRects.filter(
        (o) => armedIds.size > 0 && armedIds.has(o.owner.annotationId as string),
      );
      const bracketTop =
        bracketRects.length > 0 ? minOf(bracketRects.map((o) => o.rect.y)) : Infinity;
      // A broken value axis collapses its domain span; the 15% headroom cap
      // is defined on an unbroken domain (the break's own geometry is judged
      // elsewhere), so headroom stands down there. Envelope still holds.
      const axisBreak = geo.axes.some((a) => a.break !== undefined);

      if (!degenerate && !comparisonPinnedYDomain) {
        if (bracketTop < dataTop) {
          const residual = bracketTop - plot.y;
          if (residual > RESIDUAL_MAX_PX + PX_EPS) {
            push(
              'ink-envelope',
              `'${type}' leaves ${residual.toFixed(1)}px of empty space above its topmost bracket annotation, more than the ${RESIDUAL_MAX_PX}px allowed when that annotation is the highest thing drawn.`, REPAIR.bracketResidual,
            );
          }
        } else if (!axisBreak) {
          const headroom = (dataTop - plot.y) / plot.h;
          if (headroom > HEADROOM_MAX + EPS) {
            push(
              'ink-envelope',
              `'${type}' leaves ${fmtRatio(headroom)} of the plot empty above the data, over the ${HEADROOM_MAX} cap. The value axis reaches further than the numbers do.`, REPAIR.headroom,
            );
          }
        }

        // Floor band: only judged against a drawn zero baseline with no
        // data ink below it (a domain honestly extending below zero exempts).
        const baselineY = zeroBaselineY(geo);
        if (baselineY !== null && markBottom <= baselineY + 1) {
          const floorGap = plot.y + plot.h - Math.max(baselineY, dataBottom);
          if (floorGap > FLOOR_MAX_PX + PX_EPS) {
            push(
              'ink-envelope',
              `'${type}' leaves ${floorGap.toFixed(1)}px between the zero line and the bottom of the plot, more than the ${FLOOR_MAX_PX}px allowed on a chart that starts at zero.`, REPAIR.floorBand,
            );
          }
        }

        // Vertical envelope — annotation ink counts as ink at the top.
        const envTop = Math.max(plot.y, Math.min(dataTop, annotationTop));
        const envBottom = Math.min(plot.y + plot.h, dataBottom);
        const coverage = (envBottom - envTop) / plot.h;
        if (coverage < V_ENVELOPE_MIN - EPS && !tickBoundAxis(geo, 'y', plot, dataTop, dataBottom)) {
          push(
            'ink-envelope',
            `'${type}' data covers ${fmtRatio(coverage)} of the plot height, under the ${V_ENVELOPE_MIN} floor. Most of the plot is empty.`, REPAIR.envelope,
          );
        }
      }
    }

    // Horizontal envelope — two distinct claims behind one measurement:
    //   numeric x + categorical y  = a HORIZONTAL value axis (box):
    //     the value-direction envelope floor 0.80 applies;
    //   numeric x + numeric y      = a continuous x data dimension (scatter,
    //     histogram): the 0.85 span floor applies.
    // Band/point category x-axes fill their range by construction and
    // authored empty periods belong to the null-stretch policy, not ours.
    const numericX = geo.axes.some(
      (a) => a.axis === 'x' && a.ticks.length > 1 && a.ticks.every((t) => typeof t.at === 'number'),
    );
    if (numericX && markRects.length > 0) {
      const floor = categoryY ? V_ENVELOPE_MIN : H_ENVELOPE_MIN;
      const markLeft = minOf(markRects.map((o) => o.rect.x));
      const markRight = maxOf(markRects.map((o) => o.rect.x + o.rect.w));
      // The containment insets value ranges by the point radius so an
      // edge dot is painted inside the plot — ink can therefore trail the
      // domain by up to that inset per side even on a perfect domain. The
      // 8px grace is exactly the two insets, not slack in the floor.
      const span =
        (Math.min(plot.x + plot.w, markRight) - Math.max(plot.x, markLeft) + 8) / plot.w;
      // One point, or points that share one x, draw a marker-width body: no
      // domain would widen it, so the floor stands down as it does for flat
      // data above.
      if (markRight - markLeft > singleBody(markRects, 'w') + PX_EPS && span < floor - EPS && !tickBoundAxis(geo, 'x', plot, markLeft, markRight)) {
        push(
          'ink-envelope',
          `'${type}' data covers ${fmtRatio(span)} of the plot width, under the ${floor} floor. Most of the plot is empty.`, REPAIR.span,
        );
      }
    }
  }

  // ---- dead-band -------------------------------------------------------
  // Blocks are the PLOT RECT plus every non-reserved claim; the plot interior
  // is the envelope checks' jurisdiction (ownership split), so the plot
  // participates as one opaque block here.
  {
    // The frame-solved band is the plot BLOCK; chart-side reserves shrink
    // geometry.plot inside it and must not read as inter-block holes.
    const block = geo.frame.plotRect ?? plot;
    const intervals: Interval[] = [{ from: block.y, to: block.y + block.h }];
    for (const o of occupied) {
      if (o.kind === 'reserved' || o.rect.w <= 0 || o.rect.h <= 0) continue;
      intervals.push({ from: o.rect.y, to: o.rect.y + o.rect.h });
    }
    const merged = mergeIntervals(intervals);
    const threshold = Math.max(16, 0.06 * H);
    // Canvas-edge gaps are legal up to the margin TOKEN (the spacing the
    // theme mandates), never up to the authored margin — an authored
    // 96px top margin is precisely the violation.
    const theme = resolveTheme((options as { theme?: ThemeRef } | undefined)?.theme);
    const tokens = spaceTokens(theme, W);
    const fixedRows = (type === 'bar' || type === 'likert') && theme.space.barRow !== undefined;
    const gaps: { from: number; to: number; where: 'canvas top' | 'between blocks' | 'canvas bottom' }[] = [];
    let cursor = 0;
    for (const iv of merged) {
      if (iv.from > cursor) {
        gaps.push({ from: cursor, to: Math.min(iv.from, H), where: cursor === 0 ? 'canvas top' : 'between blocks' });
      }
      cursor = Math.max(cursor, iv.to);
    }
    if (cursor < H) gaps.push({ from: cursor, to: H, where: 'canvas bottom' });
    for (const gap of gaps) {
      // A fixed row pitch leaves the unused part of a taller host canvas below the chart.
      if (fixedRows && gap.where === 'canvas bottom' && (geo.sizing?.naturalHeight ?? H) < H) continue;
      const allowance =
        gap.where === 'canvas top'
          ? Math.max(threshold, tokens.margin.top + 2)
          : gap.where === 'canvas bottom'
            ? Math.max(threshold, tokens.margin.bottom + 2)
            : threshold;
      const extent = gap.to - gap.from;
      if (extent > allowance + PX_EPS) {
        push(
          'dead-band',
          `'${type}' carries an empty band ${extent.toFixed(0)}px tall at the ${gap.where} (y ${gap.from.toFixed(0)} to ${gap.to.toFixed(0)}), over the ${allowance.toFixed(0)}px allowed there.`, REPAIR.deadBand,
        );
      }
    }
  }

  return warnings;
}

/**
 * The y of the drawn zero baseline, if any axis draws one as a horizontal
 * rule. Returns null when no baseline node exists (axis fully off) —
 * there is then nothing measurable to gate.
 */
/**
 * The body one point draws along an axis: its largest point mark's diameter,
 * or 10 px when the chart draws no point marks.
 */
function singleBody(markRects: readonly OccupiedRect[], side: 'w' | 'h'): number {
  const points = markRects.filter((o) => o.owner.pointId !== undefined);
  return points.length > 0 ? maxOf(points.map((o) => o.rect[side])) : 10;
}

/**
 * An axis that starts and ends on a labelled tick, with the data less than
 * one tick step from each end: no tick-aligned range is tighter, so the
 * envelope floor stands down for it.
 */
function tickBoundAxis(geo: Geometry, orient: 'x' | 'y', plot: Rect, dataLo: number, dataHi: number): boolean {
  const axis = geo.axes.find((a) => a.axis === orient);
  const pos = (axis?.ticks ?? [])
    .filter((t) => typeof t.at === 'number' && t.labelId !== undefined)
    .map((t) => t.pos)
    .sort((a, b) => a - b);
  if (pos.length < 3) return false;
  const lo = orient === 'x' ? plot.x : plot.y;
  const hi = orient === 'x' ? plot.x + plot.w : plot.y + plot.h;
  if (Math.abs(pos[0]! - lo) > 1 || Math.abs(pos[pos.length - 1]! - hi) > 1) return false;
  const step = minOf(pos.slice(1).map((p, i) => p - pos[i]!));
  return dataLo - lo < step && hi - dataHi < step;
}

function zeroBaselineY(geo: Geometry): number | null {
  for (const axis of geo.axes) {
    if (!axis.baselineNodeId) continue;
    const node = geo.scene.find((n) => n.id === axis.baselineNodeId);
    if (node && node.t === 'line' && Math.abs(node.y1 - node.y2) < 0.01) return node.y1;
  }
  return null;
}
