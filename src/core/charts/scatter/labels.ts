import { chartString } from '../../strings/scatter';
import { emphasisWeight, strokeToken } from '../../theme';
/**
 * Scatter phase 3: mark geometry in, label requests out. Zone labels,
 * cut-point tags, quadrant captions and point names, in that order. Planning
 * reads the phase 2 struct only, never the OccupiedIndex; the solver places
 * the requests against the index once every mark claim is committed.
 */

import type { Rect } from '../../geometry';
import { rectContains, rectsOverlap } from '../../geometry';
import { formatAutomaticNumber, seriesValueFormatter } from '../../format';
import { wrapText } from '../../text';
import { labelCtx, PRIORITY, seatLeader, type LabelRequest, type SlotCandidate, type SolveCtx } from '../../label/solver';
import { nameReadsAsOwn } from './nameReading';
import type { LintWarning, Paint } from '../../types/scene';
import { HIGHLIGHT_RING_GAP, quadrantBoxRect, type PlacedPoint, type ScatterMarkGeometry } from './marks';
import {
  QUADRANT_BOXES,
  QUADRANT_BOX_NAME,
  type NormPt,
  type QuadrantPlan,
  type ScatterDomain,
  type ScatterEnv,
  type ScatterPaints,
  type ScatterPlotArea,
} from './model';
import { gridZones, ZONE_BAND_GAP, type ZoneLabelSite } from './zones';
import { composedTextRole } from '../../textRole';

/** Ring gaps for the spiral point labeler. */
const RING1_GAP = 4;
/**
 * Air a point's name or value keeps from another point's labels, where a seat
 * allows it: a name one line under another's read as one two-line name
 * (AeroFreight under VoltStream).
 */
const NAME_GAP = 6;

/** Clear air between a label and a rule it keeps to one side of: the rule's 1 px half-width, the 2 px label pad and 1 px. */
const RULE_GAP = 4;
const RING2_GAP = 16;
/** Two outer rings for a crowded cluster, both on a leader. */
const RING3_GAP = 30;
const RING4_GAP = 46;
/** Inset of quadrant captions from their box edges. */
const CAPTION_PAD = 6;
/** Gap between a quadrant divider and its cut-point tag. */
const DIVIDER_TAG_GAP = 4;
/**
 * The cut point IS the argument of a 2x2 — an unlabelled boundary is an
 * unfalsifiable claim — so its tag outranks every other text on the chart, and
 * the box captions outrank point labels (whose ceiling is
 * extreme 500 + size bonus 99 + highlight 250 = 849).
 */
const PRIORITY_DIVIDER_TAG = PRIORITY.grandTotal + 60;
const PRIORITY_QUADRANT_CAPTION = PRIORITY.grandTotal;

/**
 * Slot cascade shared by both cut-point tags: five stations along the divider
 * (the end a reader looks at first, then inward) x the two sides of the line.
 * `along` is 0 at the preferred end and 1 at the far end; `side` is 'near' for
 * the side the tag prefers (right of a vertical divider, above a horizontal
 * one). Ten candidates, deterministic order.
 */
function dividerTagCandidates(
  tsize: { width: number; height: number },
  rectAt: (side: 'near' | 'far', along: number, offset: number) => Rect,
  leaderTo: (rect: Rect) => { x: number; y: number },
): SlotCandidate[] {
  const stations: [string, number][] = [
    ['End', 0],
    ['Quarter', 0.25],
    ['Mid', 0.5],
    ['ThreeQuarter', 0.75],
    ['FarEnd', 1],
  ];
  const out: SlotCandidate[] = [];
  // Adjacent to the line first (both sides, five stations along it). Only when
  // the whole lane is occupied does the tag stand off — and from the second
  // step it carries a LEADER back to its divider, because a tag that drifts
  // away without one stops being that line's tag. A dense bubble field can fill
  // the lane completely; the leader is what keeps the escape honest.
  for (const standoff of [0, 1, 2, 3] as const) {
    for (const [station, along] of stations) {
      for (const side of ['near', 'far'] as const) {
        const rect = rectAt(side, along, standoff * (tsize.height + 5));
        out.push({
          slot: `${side}${station}${standoff ? `Standoff${standoff}` : ''}`,
          rect,
          penalty: out.length,
          ...(standoff >= 2 ? { leaderFrom: leaderTo(rect) } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * Spiral point labeler: insideCenter for bubbles the
 * text fits into, then 8 directions at ring 1 (adjacent), then the same 8
 * at ring 2 with a leader line back to the marker edge.
 */
function spiralCandidates(
  cx: number,
  cy: number,
  r: number,
  tsize: { width: number; height: number },
  insideFill?: string,
  fine = false,
  /** Offer the sideways-slid seats above and below (bubbles). */
  slide = false,
): SlotCandidate[] {
  const w = tsize.width;
  const h = tsize.height;
  const out: SlotCandidate[] = [];
  let penalty = 0;
  if (insideFill !== undefined && w <= 2 * r * 0.85 && h <= 1.4 * r) {
    out.push({
      slot: 'insideCenter',
      rect: { x: cx - w / 2, y: cy - h / 2, w, h },
      penalty: penalty++,
      insideFill,
    });
  }
  const diag = Math.SQRT1_2;
  // [slot base name, ux, uy] — label rect placed beyond the marker edge
  const dirs: [string, number, number][] = [
    ['right', 1, 0],
    ['left', -1, 0],
    ['above', 0, -1],
    ['below', 0, 1],
    ['aboveRight', diag, -diag],
    ['aboveLeft', -diag, -diag],
    ['belowRight', diag, diag],
    ['belowLeft', -diag, diag],
  ];
  const rectFor = (ux: number, uy: number, dist: number): Rect => {
    const ax = cx + ux * dist;
    const ay = cy + uy * dist;
    // anchor the near edge of the label box at (ax, ay) per direction
    const rx = ux > 0.01 ? ax : ux < -0.01 ? ax - w : ax - w / 2;
    const ry = uy > 0.01 ? ay : uy < -0.01 ? ay - h : ay - h / 2;
    return { x: rx, y: ry, w, h };
  };
  for (const [slot, ux, uy] of dirs) {
    out.push({ slot, rect: rectFor(ux, uy, r + RING1_GAP), penalty: penalty++ });
  }
  // Bubbles: a name over or under its point may slide sideways until its
  // edge stands over the point's centre, last among the adjacent seats; next
  // to the plot edge or a neighbour it still touches its own mark.
  if (slide && w > 2 * r) {
    for (const [slot, uy] of [['above', -1], ['below', 1]] as const) {
      const base = rectFor(0, uy, r + RING1_GAP);
      for (const [side, dx] of [['Left', -(w / 2)], ['Right', w / 2]] as const) {
        out.push({ slot: `${slot}Slide${side}`, rect: { ...base, x: base.x + dx }, penalty: penalty++ });
      }
    }
  }
  // A bubble's value has no adjacent seat to fall back on, so its far rings
  // add four directions 22.5 degrees off the sides.
  const [c, s] = [Math.cos(Math.PI / 8), Math.sin(Math.PI / 8)];
  const fineDirs: [string, number, number][] = fine
    ? [['rightHigh', c, -s], ['rightLow', c, s], ['leftHigh', -c, -s], ['leftLow', -c, s]]
    : [];
  for (const [ring, baseGap] of [['Far', RING2_GAP], ['Far3', RING3_GAP], ['Far4', RING4_GAP]] as const) {
    // Every far seat is a displaced name, so it stands to a side where its
    // leader can reach it from the marker's edge; the solver draws no
    // leader straight up or down.
    for (const [slot, ux, uy] of [...dirs.filter(([, ux]) => ux !== 0), ...fineDirs]) {
      // the leader's gutter and minimum drawn length total one text height.
      const gap = Math.max(baseGap, (h + 1) / Math.abs(ux));
      out.push({
        slot: `${slot}${ring}`,
        rect: rectFor(ux, uy, r + gap),
        penalty: penalty++,
        leaderFrom: { x: cx + ux * r, y: cy + uy * r },
      });
    }
  }
  return out;
}

/** Inset of a strategy grid cell's caption from the cell edges. */
const CELL_CAPTION_PAD = 6;
const CELL_CAPTION_BOTTOM_PAD = 1;

/** Candidates for one zone label, by the kind of site it names. */
function zoneLabelCandidates(site: ZoneLabelSite, area: ScatterPlotArea, env: ScatterEnv, placed: readonly { cx: number; cy: number; r: number }[] = []): SlotCandidate[] {
  const { box } = site;
  if (site.kind === 'xBand' || site.kind === 'yBand') {
    const lines = site.lines ?? [site.text];
    const lineH = env.measure('0', area.fonts.tick).height;
    const measured = { width: Math.max(...lines.map((line) => env.measure(line, area.fonts.tick).width)), height: lines.length * lineH };
    const rect: Rect = site.kind === 'xBand'
      ? { x: box.x + (box.w - measured.width) / 2, y: box.y + ZONE_BAND_GAP, w: measured.width, h: measured.height }
      : { x: box.x + box.w - ZONE_BAND_GAP - measured.width, y: box.y + (box.h - measured.height) / 2, w: measured.width, h: measured.height };
    return [{ slot: 'axisBand', rect, penalty: 0 }];
  }
  const measured = env.measure(site.text, area.fonts.caption);
  if (site.kind === 'cell') {
    const pad = CELL_CAPTION_PAD;
    // Over an inner rule the line box's descent is air enough: a caption at
    // the bottom sits closer to it and leaves a point name the room above it
    // (a strategy grid at 320 px: Charlie over Protect). Over the axis it keeps its inset.
    const bottomPad = box.y + box.h < area.plot.y + area.plot.h - 0.5 ? CELL_CAPTION_BOTTOM_PAD : pad;
    // Bubbles: a seat that no bubble circle enters, measured on the
    // circles, needs no pad around its box. The line box holds the air over
    // the capitals.
    const clear = (rect: Rect) => placed.every((m) => Math.hypot(Math.max(rect.x - m.cx, 0, m.cx - rect.x - rect.w), Math.max(rect.y - m.cy, 0, m.cy - rect.y - rect.h)) >= m.r);
    const at = (slot: string, rx: number, ry: number): SlotCandidate => {
      const rect = { x: rx, y: ry, w: measured.width, h: measured.height };
      return { slot, rect, penalty: 0, ...(placed.length > 0 && clear(rect) ? { pad: 0 } : {}) };
    };
    // A corner first, the top left as the eye enters the cell; the centre,
    // where the points sit, last.
    return [
      at('topLeft', box.x + pad, box.y + pad),
      at('bottomLeft', box.x + pad, box.y + box.h - bottomPad - measured.height),
      at('bottomRight', box.x + box.w - pad - measured.width, box.y + box.h - bottomPad - measured.height),
      at('topRight', box.x + box.w - pad - measured.width, box.y + pad),
      at('centre', box.x + (box.w - measured.width) / 2, box.y + (box.h - measured.height) / 2),
    ].map((candidate, index) => ({ ...candidate, penalty: index }));
  }
  const at = (slot: string, xFraction: number, yFraction: number, penalty: number): SlotCandidate => ({
    slot,
    rect: {
      x: box.x + box.w * xFraction - measured.width / 2,
      y: box.y + box.h * yFraction - measured.height / 2,
      w: measured.width,
      h: measured.height,
    },
    penalty,
  });
  return [
    at('centre', 0.5, 0.5, 0),
    at('upperCentre', 0.5, 0.25, 1),
    at('lowerCentre', 0.5, 0.75, 2),
    at('centreLeft', 0.25, 0.5, 3),
    at('centreRight', 0.75, 0.5, 4),
    at('upperLeft', 0.25, 0.25, 5),
    at('upperRight', 0.75, 0.25, 6),
    at('lowerLeft', 0.25, 0.75, 7),
    at('lowerRight', 0.75, 0.75, 8),
  ];
}

/** Zone labels are authored furniture; each one stays inside the cell, region or lane it names. */
function zoneLabelRequests(sites: ZoneLabelSite[], area: ScatterPlotArea, env: ScatterEnv, placed: readonly { cx: number; cy: number; r: number }[] = []): LabelRequest[] {
  return sites.map((site) => ({
    id: site.id,
    kind: 'category',
    owner: { categoryId: String(site.id) },
    text: site.text,
    // A cell caption prints as written.
    lines: site.lines ?? [site.text],
    ...(site.kind === 'yBand' ? { align: 'end' as const } : site.kind === 'xBand' ? { align: 'middle' as const } : {}),
    typeRole: 'axis', font: area.fonts.caption,
    priority: site.kind === 'xBand' || site.kind === 'yBand' ? PRIORITY.valueLine : PRIORITY.total,
    candidates: zoneLabelCandidates(site, area, env, placed).filter((candidate) => rectContains(site.box, candidate.rect, 0)),
  }));
}

/**
 * The tag names the VALUE and the RULE that produced it. Both are needed: a
 * bare number does not say whether the author chose it or the engine computed
 * it, and an unlabelled boundary is an unfalsifiable claim. The value it prints
 * is `quadrants.xText` / `yText` — the SAME string the footnote and the claim
 * receipt carry, produced by the disclosure that also fixed `quadrants.x` /
 * `.y`. Reformatting the number here is what put a threshold on the chart that
 * the classifier had not used.
 */
function dividerTagRequests(q: QuadrantPlan, area: ScatterPlotArea, env: ScatterEnv, requests: LabelRequest[], pts: readonly { x: number; y: number }[], printed: { x: boolean; y: boolean }): void {
  const quadrants = q.derived!;
  const { plot } = area;
  // Measured in the emphasis the layout draws a value line in, so the seat holds the drawn tag.
  const font = { ...area.fonts.label, weight: emphasisWeight(env.theme) };
  // A point exactly on a cut counts right of it or above it. The tag says so
  // on the drawing whenever a point sits there: the footnote that also says
  // it may be off the drawing, and then a point on the line sat in one box
  // with nothing saying why.
  const tie = {
    x: pts.some((p) => p.x === quadrants.x) ? chartString(env.options, 'pointsCountRight') : '',
    y: pts.some((p) => p.y === quadrants.y) ? chartString(env.options, 'pointsCountAbove') : '',
  };
  // Plain words on the line: 'Cut at 1', or 'Median 3' when the
  // engine computed it.
  const tag = (id: 'x' | 'y', source: string, text: string, candidates: (tsize: { width: number; height: number }) => SlotCandidate[]): LabelRequest => {
    const line = `${chartString(env.options, source === 'declared' ? 'cutAt' : source === 'median' ? 'medianName' : 'cutMeanCapital')} ${text}${tie[id]}`;
    return {
      id: `quadrant:cut:${id}`,
      kind: 'valueLine',
      role: composedTextRole(line),
      owner: { valueLineId: `quadrant:${id}` },
      text: line,
      lines: [line],
      typeRole: 'label', font,
      priority: PRIORITY_DIVIDER_TAG,
      candidates: candidates(env.measure(line, font)),
    };
  };
  // A cut value that prints bold in its axis row needs no tag on the line,
  // unless a point sits on it and the tag says which side it counts to.
  const tagged = { x: !printed.x || tie.x !== '', y: !printed.y || tie.y !== '' };
  if (q.drawX && tagged.x) {
    const qx = area.x(quadrants.x);
    // The tag slides ALONG its own line before it gives up: top end first
    // (where a reader looks for a rule's name), then down the line on
    // either side. A cut point without its value is an unfalsifiable claim,
    // so the cascade is deep enough that a dense corner cannot silence it.
    requests.push(tag('x', quadrants.xSource, quadrants.xText, (tsize) => dividerTagCandidates(
      tsize,
      (side, along, offset) => ({
        x: side === 'near' ? qx + DIVIDER_TAG_GAP + offset : qx - DIVIDER_TAG_GAP - offset - tsize.width,
        y: Math.min(plot.y + plot.h - 2 - tsize.height, plot.y + 2 + along * (plot.h - 4 - tsize.height)),
        w: tsize.width,
        h: tsize.height,
      }),
      (rect) => ({ x: qx, y: rect.y + rect.h / 2 }),
    )));
  }
  if (q.drawY && tagged.y) {
    const qy = area.y(quadrants.y);
    requests.push(tag('y', quadrants.ySource, quadrants.yText, (tsize) => dividerTagCandidates(
      tsize,
      (side, along, offset) => ({
        x: Math.max(plot.x + 2, plot.x + plot.w - 2 - tsize.width - along * (plot.w - 4 - tsize.width)),
        y: side === 'near' ? qy - DIVIDER_TAG_GAP - offset - tsize.height : qy + DIVIDER_TAG_GAP + offset,
        w: tsize.width,
        h: tsize.height,
      }),
      (rect) => ({ x: rect.x + rect.w / 2, y: qy }),
    )));
  }
}

/**
 * Captions are authored furniture: they enter the solver before the point
 * labels and carry their own box count, so an empty box states its own
 * emptiness instead of leaving the reader to infer it from missing dots.
 */
function quadrantCaptionRequests(
  env: ScatterEnv,
  domain: ScatterDomain,
  area: ScatterPlotArea,
  split: { x: number; y: number },
  requests: LabelRequest[],
  warnings: LintWarning[],
  placed: readonly { cx: number; cy: number; r: number }[] = [],
): void {
  const quadrants = domain.quadrants.derived!;
  const captionFont = area.fonts.caption;
  const captions = env.options.quadrants?.labels ?? {};
  const centreFirst = (env.options.quadrants?.captionPlacement ?? 'corner') === 'centre';
  for (const box of QUADRANT_BOXES) {
    const authored = captions[box];
    if (authored === undefined || authored === '') continue;
    if (domain.quadrants.voidBoxes.has(box)) {
      warnings.push({
        code: 'quadrant-caption-void-box',
        severity: 'info',
        message: `caption '${authored}' for the ${QUADRANT_BOX_NAME[box]} box was not placed: a cut point outside the plotted domain leaves that box no area, and it holds 0 of ${domain.pts.length} units. The footnote states the collapse.`,
      });
      continue;
    }
    const rect = quadrantBoxRect(box, area.plot, split);
    // A caption wider than its box wraps on two lines.
    const wrapped = wrapText(authored, captionFont, Math.max(1, rect.w - 2 * CAPTION_PAD), 2, env.measure);
    const name = wrapped.truncated ? [authored] : wrapped.lines;
    const lines = [
      ...name,
      `n = ${formatAutomaticNumber(quadrants.counts[box], { locale: env.options.locale?.language, decimals: 0 })}`,
    ];
    const w = Math.max(...lines.map((l) => env.measure(l, captionFont).width));
    const lineH = captionFont.size * (captionFont.lineHeight ?? 1.2);
    const h = lineH * lines.length;
    const left = rect.x + CAPTION_PAD;
    const right = rect.x + rect.w - CAPTION_PAD - w;
    const top = rect.y + CAPTION_PAD;
    const bottom = rect.y + rect.h - CAPTION_PAD - h;
    const cx = rect.x + rect.w / 2 - w / 2;
    const cy = rect.y + rect.h / 2 - h / 2;
    // The top corner on the box's outer side first (the bottom
    // row's points crowd the x axis), then the other two corners off
    // the divider crossing. The box's INNER corner — the one at
    // the divider intersection, i.e. the dead centre of the exhibit — is not a
    // candidate at all: that is where the cloud is densest in a real matrix,
    // and a caption landing there reads as a unit no matter how it is set.
    // Every candidate is filtered to lie inside its own box: a caption that
    // escaped its box would label the wrong quadrant, which is worse than not
    // placing.
    const corners: [string, number, number][] =
      box === 'tl'
        ? [['topLeft', left, top], ['bottomLeft', left, bottom], ['topRight', right, top]]
        : box === 'tr'
          ? [['topRight', right, top], ['bottomRight', right, bottom], ['topLeft', left, top]]
          : box === 'bl'
            ? [['topLeft', left, top], ['bottomLeft', left, bottom], ['bottomRight', right, bottom]]
            : [['topRight', right, top], ['bottomRight', right, bottom], ['bottomLeft', left, bottom]];
    const ordered: [string, number, number][] = centreFirst ? [['centre', cx, cy], ...corners] : [...corners, ['centre', cx, cy]];
    const candidates: SlotCandidate[] = [];
    // The caption's lines, as set (flush to the box's outer
    // side), stand clear of every bubble by CAPTION_PAD, measured on the
    // circles; then the seat needs no pad around its box (the short
    // 'n = 1' line's box met the Nordic Retail bubble's box).
    const endAligned = box === 'tr' || box === 'br';
    const clearOfBubbles = (x: number, y: number): boolean => lines.every((line, i) => {
      const lw = env.measure(line, captionFont).width;
      const lr = { x: endAligned ? x + w - lw : x, y: y + i * lineH, w: lw, h: lineH };
      return placed.every((m) => Math.hypot(Math.max(lr.x - m.cx, 0, m.cx - lr.x - lr.w), Math.max(lr.y - m.cy, 0, m.cy - lr.y - lr.h)) >= m.r + CAPTION_PAD);
    });
    ordered.forEach(([slot, rx, ry]) => {
      const candidate: Rect = { x: rx, y: ry, w, h };
      if (!rectContains(rect, candidate, 0)) return;
      candidates.push({ slot, rect: candidate, penalty: candidates.length, ...(placed.length > 0 && clearOfBubbles(rx, ry) ? { pad: 0 } : {}) });
    });
    requests.push({
      id: `quadrant:caption:${box}`,
      kind: 'category',
      owner: { categoryId: `quadrant:${box}` },
      text: lines.join(' '),
      lines,
      typeRole: 'axis', font: captionFont,
      // A right-hand box sets its caption flush right, on the box's outer edge.
      ...(box === 'tr' || box === 'br' ? { align: 'end' as const } : {}),
      priority: PRIORITY_QUADRANT_CAPTION,
      candidates,
    });
  }
}

const groupFormats = new WeakMap<readonly NormPt[], Map<string, (value: number) => string>>();

/**
 * A point's printed value, the text `labels.value` sets in or beside it: a
 * bubble's size, else y. Each group is one series and takes one precision
 * (seriesValueFormatter); an authored y format or a log y axis prints as the axis formatter does.
 */
export function pointValueText(env: ScatterEnv, domain: Pick<ScatterDomain, 'pts'>, p: NormPt, field: 'size' | 'y'): string | undefined {
  const value = p[field];
  if (value === null) return undefined;
  // A log y axis keeps each label at its own precision: 0.45 on a log scale reads apart from 0.5.
  // An engine-scaled y axis prints its labels at the axis scale: "2.0M", not "2,000,000" beside 2.0M ticks.
  if (field === 'y' && (env.options.format || env.options.axisFormat?.y || env.log.y || env.axisSpec.y.autoMagnitude)) return env.axisFmt.y(value);
  let byGroup = groupFormats.get(domain.pts);
  if (!byGroup) groupFormats.set(domain.pts, byGroup = new Map());
  const key = `${field}\u0000${p.group ?? ''}`;
  let fmt = byGroup.get(key);
  if (!fmt) byGroup.set(key, fmt = seriesValueFormatter(domain.pts.filter((q) => q.group === p.group).map((q) => q[field]), env.options.locale?.language));
  return fmt(value);
}

/** Point names and values: spiral candidates, auto-off above maxPointLabels. */
function pointLabelRequests(
  env: ScatterEnv,
  domain: ScatterDomain,
  area: ScatterPlotArea,
  placed: PlacedPoint[],
  rules: ScatterMarkGeometry['rules'],
  paints: ScatterPaints,
  requests: LabelRequest[],
  warnings: LintWarning[],
  /** Seats built on this plot, by point and text (ScatterMarkGeometry.seatMemo). */
  seatMemo: Map<string, SlotCandidate[]> = new Map(),
  /** Label paints by point (ScatterMarkGeometry.paintMemo). */
  paintMemo: NonNullable<ScatterMarkGeometry['paintMemo']> = new Map(),
): void {
  const { options, highlights } = env;
  const { bubbleMode, sizeMax } = domain;
  const maxPointLabels = options.maxPointLabels ?? 300;
  const pointLabelsOn = options.labels !== false && options.labels?.point !== false;
  // `labels.value`: the size on a bubble chart, y otherwise.
  // Tier 2 prints no bubble value; each value still reaches the page note (below).
  const field = options.labels !== false && options.labels?.value === true ? (bubbleMode ? 'size' : 'y') : undefined;
  if ((pointLabelsOn || field) && placed.length > maxPointLabels) {
    warnings.push({
      code: 'labels-auto-off',
      severity: 'info',
      message: `point labels auto-disabled: ${domain.pts.length} points exceed maxPointLabels (${maxPointLabels})`,
    });
    return;
  }
  if (!pointLabelsOn && !field) return;
  const q = domain.quadrants;
  // The zero lines as marks.ts draws them: none where a quadrant divider takes the zero.
  const zeroRules = {
    x: domain.dx[0] < 0 && domain.dx[1] > 0 && !(q.drawX && q.derived?.x === 0) ? [area.x(0)] : [],
    y: domain.dy[0] < 0 && domain.dy[1] > 0 && !(q.drawY && q.derived?.y === 0) ? [area.y(0)] : [],
  };
  const dividerY = q.drawY && q.derived ? area.y(q.derived.y) : undefined;
  const valueLineYs = rules.y.filter((ry) => !zeroRules.y.includes(ry) && ry !== dividerY);
  // Every drawn mark, for the name-reading rule (nameReading.ts).
  const marks = placed.map(({ p, cx, cy, r }) => ({ id: p.id, cx, cy, r }));
  for (const { p, cx, cy, r } of placed) {
    const extreme = p.x === domain.xMin || p.x === domain.xMax || p.y === domain.yMin || p.y === domain.yMax;
    const sizeBonus =
      bubbleMode && sizeMax && sizeMax > 0 && p.size !== null ? Math.min(99, Math.round((99 * p.size) / sizeMax)) : 0;
    const hl = highlights.has(p.id) || (p.group !== undefined && highlights.has(p.group));
    const priority = (extreme ? PRIORITY.extreme : PRIORITY.interior) + sizeBonus + (hl ? PRIORITY.highlightBonus : 0);
    const value = field ? pointValueText(env, domain, p, field) : undefined;
    // A point name stays inside the frame: the solver only keeps it on the
    // canvas, and a name set into the canvas margin would run past the right
    // edge as soon as the host font sets it wider than the width tables.
    // It flips to another side, or is hidden with a label-hidden warning.
    // The highlighted dot's name is set bold; a bubble keeps its ring alone.
    // A highlighted dot's labels sit outside its ring, not on it.
    const reach = hl && !bubbleMode ? r + HIGHLIGHT_RING_GAP + strokeToken(env.theme, 'mark') : r;
    const ownMark = { id: p.id, cx, cy, r: reach };
    // The point's paints, worked out once per point and run (a seat list holds dozens of seats).
    let pointPaint = paintMemo.get(p.id);
    if (!pointPaint) paintMemo.set(p.id, pointPaint = {});
    const memo = pointPaint;
    const insidePaint = (): Paint => (memo.inside ??= paints.hollow(p) ? { token: 'background' as const } : paints.point(p));
    const insideFill = (): string | undefined => {
      if (!memo.fillKnown) { memo.fill = paints.insideFill(p); memo.fillKnown = true; }
      return memo.fill;
    };
    const nameFont = hl && (!bubbleMode || gridZones(options)) ? { ...area.fonts.label, weight: emphasisWeight(env.theme) } : area.fonts.label;
    // On a 2x2 a seat over or under the point that runs past its box's side
    // gets a copy slid back inside the box, when the slide is at most half the
    // label and the copy stays off the mark (Legacy Hardware).
    const boxSideWidth = (box: string): number => {
      const qx = q.drawX && q.derived ? area.x(q.derived.x) : undefined;
      if (qx === undefined) return area.plot.w;
      return box === 'tr' || box === 'br' ? area.plot.x + area.plot.w - qx : qx - area.plot.x;
    };
    const boxedSeats = (raw: SlotCandidate[]): SlotCandidate[] => {
      if (!q.derived) return raw;
      const box = q.derived.assignment[p.id]!;
      const qx = q.drawX ? area.x(q.derived.x) : undefined;
      const onRight = box === 'tr' || box === 'br';
      const lo = (onRight && qx !== undefined ? qx + RULE_GAP : area.plot.x + RULE_GAP);
      const hi = (!onRight && qx !== undefined ? qx - RULE_GAP : area.plot.x + area.plot.w - RULE_GAP);
      const own = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
      return raw.flatMap((c) => {
        const { rect } = c;
        if (c.insideFill !== undefined || c.leaderFrom !== undefined || rect.w > hi - lo || (rect.x >= lo && rect.x + rect.w <= hi)) return [c];
        const x = Math.min(Math.max(rect.x, lo), hi - rect.w);
        const moved = { ...rect, x };
        if (Math.abs(x - rect.x) > rect.w / 2 || rectsOverlap(moved, own)) return [c];
        return [c, { ...c, slot: `${c.slot}Boxed`, rect: moved }];
      });
    };
    const seats = (text: string, insideFill: string | undefined, fine = false, font = area.fonts.label, block?: { width: number; height: number }, name = false): SlotCandidate[] => {
      const key = `${String(p.id)}\u0000${text}\u0000${insideFill}\u0000${fine}\u0000${font.size}/${font.weight}\u0000${block ? `${block.width}x${block.height}` : ''}\u0000${name}`;
      const known = seatMemo.get(key);
      if (known) return [...known];
      const built = buildSeats(text, insideFill, fine, font, block)
        // A name takes only seats where it reads as this point's
        // name (nameReading.ts); with none left, the note names the point.
        .filter((c) => !name || nameReadsAsOwn(c.rect, c.leaderFrom ? seatLeader(c.rect, c.leaderFrom)?.d : undefined, ownMark, marks, [], font.size));
      seatMemo.set(key, built);
      return [...built];
    };
    const buildSeats = (text: string, insideFill: string | undefined, fine: boolean, font: typeof area.fonts.label, block?: { width: number; height: number }): SlotCandidate[] => {
      // A name never sits in a tick row, under the plot or left of it.
      // A slid seat stops short of the plot's side (it moves at most half its width).
      const plotSlid = (c: SlotCandidate): SlotCandidate => c.slot.includes('Slide')
        ? { ...c, rect: { ...c.rect, x: Math.min(Math.max(c.rect.x, area.plot.x + RULE_GAP), area.plot.x + area.plot.w - RULE_GAP - c.rect.w) } }
        : c;
      const candidates = boxedSeats(spiralCandidates(cx, cy, reach, block ?? env.measure(text, font), insideFill, fine, bubbleMode).map(plotSlid))
        .filter((candidate) => rectContains(area.inner, candidate.rect) &&
          candidate.rect.y + candidate.rect.h <= area.plot.y + area.plot.h && candidate.rect.x >= area.plot.x)
        .map(candidate => ({ ...candidate, insidePaint: insidePaint() }));
      // A seat across a rule from its point (a zero line, a value line) reads
      // as a label of the other side. A rule through the mark itself leaves
      // both sides open. A seat on or just short of a rule gets a copy slid to
      // the point's side of it, when the slide is at most half the label; then
      // adjacent seats on the point's side come first, adjacent seats across a
      // rule next, and the leader seats after them in the same order.
      const across = (rect: Rect) =>
        rules.x.some((rx) => Math.abs(cx - rx) > r && (cx < rx ? rect.x + rect.w > rx : rect.x < rx)) ||
        rules.y.some((ry) => Math.abs(cy - ry) > r && (cy < ry ? rect.y + rect.h > ry : rect.y < ry));
      const slid = (c: SlotCandidate): SlotCandidate[] => {
        const { rect } = c;
        for (const rx of rules.x) {
          if (Math.abs(cx - rx) <= r || rect.x >= rx + RULE_GAP || rect.x + rect.w <= rx - RULE_GAP) continue;
          const x = cx < rx ? rx - RULE_GAP - rect.w : rx + RULE_GAP;
          if (Math.abs(x - rect.x) <= rect.w / 2) return [{ ...c, slot: `${c.slot}Slid`, rect: { ...rect, x } }];
        }
        for (const ry of rules.y) {
          if (Math.abs(cy - ry) <= r || rect.y >= ry + RULE_GAP || rect.y + rect.h <= ry - RULE_GAP) continue;
          const y = cy < ry ? ry - RULE_GAP - rect.h : ry + RULE_GAP;
          if (Math.abs(y - rect.y) <= rect.h / 2) return [{ ...c, slot: `${c.slot}Slid`, rect: { ...rect, y } }];
        }
        return [];
      };
      // A slid copy never lands on its own marker: the solver lets a label touch its own mark, and dark text across a bubble is unreadable.
      const own = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
      let kept = candidates.flatMap((c) => [c, ...slid(c).filter((s) => rectContains(area.inner, s.rect) && !rectsOverlap(s.rect, own))]);
      if (q.derived) {
        // A name must not sit in a box its unit is not in. On a 2x2 the box IS
        // the finding, so a label that drifted across a divider reclassifies
        // the company for the reader — worse than no label. Candidates are
        // filtered to the point's own side of every DRAWN divider; a point that
        // loses all of them loses its label out loud (label-hidden), not
        // quietly. A seat across a divider first gets its copy slid to the
        // point's side (slid, above), so a point just off a divider keeps a seat.
        const box = q.derived.assignment[p.id]!;
        const onRight = box === 'tr' || box === 'br';
        const onTop = box === 'tl' || box === 'tr';
        const qx = area.x(q.derived.x);
        const qy = area.y(q.derived.y);
        kept = kept.filter((c) => {
          if (q.drawX && (onRight ? c.rect.x < qx : c.rect.x + c.rect.w > qx)) return false;
          if (q.drawY && (onTop ? c.rect.y + c.rect.h > qy : c.rect.y < qy)) return false;
          return true;
        });
      }
      // A seat that a zero line runs through may still take the name, in
      // front of the line with a halo,
      // after every seat clear of it.
      // A value line too, where it runs through the point's own mark (AeroFreight on the average).
      const ownLines = valueLineYs.filter((ry) => Math.abs(cy - ry) <= r);
      const onZero = (rect: Rect) => zeroRules.x.some((rx) => rx > rect.x && rx < rect.x + rect.w)
        || [...zeroRules.y, ...ownLines].some((ry) => ry > rect.y && ry < rect.y + rect.h);
      const over = kept.filter((c) => c.insideFill === undefined && onZero(c.rect)).map((c) => ({ ...c, slot: `${c.slot}Over`, overRules: true }));
      const all = [...kept, ...over];
      // The tier is the penalty, so the solver's name gap reorders seats
      // within a tier and never takes a seat across a rule first.
      const tier = (c: SlotCandidate) => c.overRules ? (c.leaderFrom ? 5 : 2) : (c.leaderFrom ? 3 : 0) + (across(c.rect) ? 1 : 0);
      return [0, 1, 2, 3, 4, 5].flatMap((t) => all.filter((c) => tier(c) === t))
        .map((candidate) => ({ ...candidate, penalty: tier(candidate) }));
    };
    // A point's name and value stay together: a value that fits
    // inside its bubble sits there, beside the name's seat; any other value
    // joins the name in one box, so it is never across the mark from it.
    const named = pointLabelsOn && !!p.label;
    // Inside means room in the bubble and no rule (a zero or value line) through the text.
    // The insideCenter seat of spiralCandidates, without building the rest.
    const valueSize = value !== undefined && bubbleMode && insideFill() !== undefined ? env.measure(value, area.fonts.label) : undefined;
    const inside = valueSize && valueSize.width <= 2 * r * 0.85 && valueSize.height <= 1.4 * r
      ? { x: cx - valueSize.width / 2, y: cy - valueSize.height / 2, w: valueSize.width, h: valueSize.height }
      : undefined;
    // Nor a neighbouring bubble over the text (Boreal Mining under NordPower).
    const covered = (rect: Rect) => placed.some((o) => o.p.id !== p.id && o.r > 0 &&
      Math.hypot(Math.max(rect.x - o.cx, 0, o.cx - rect.x - rect.w), Math.max(rect.y - o.cy, 0, o.cy - rect.y - rect.h)) < o.r);
    // A zero line runs behind the bubbles, so inside the circle
    // it is hidden. It leaves a value inside alone when the text's line box
    // stays within the chord the circle hides (Carrier A 6.1 at 320).
    // `offset` is the rule's distance from the centre, `along` the centre along the rule.
    const hiddenBehind = (offset: number, along: number, from: number, to: number) => {
      const half = Math.sqrt(Math.max(0, r * r - offset * offset));
      return bubbleMode && half > 0 && from >= along - half && to <= along + half;
    };
    const fitsInside = inside !== undefined &&
      !rules.x.some((rx) => rx > inside.x - RULE_GAP && rx < inside.x + inside.w + RULE_GAP && !(zeroRules.x.includes(rx) && hiddenBehind(rx - cx, cy, inside.y, inside.y + inside.h))) &&
      !rules.y.some((ry) => ry > inside.y - RULE_GAP && ry < inside.y + inside.h + RULE_GAP && !(zeroRules.y.includes(ry) && hiddenBehind(ry - cy, cx, inside.x, inside.x + inside.w))) &&
      !covered(inside);
    // A zero line hidden behind the bubble crosses the inside seat's box: the solver lets the value stand over its claim.
    const behindZero = fitsInside && (zeroRules.x.some((rx) => rx > inside!.x - RULE_GAP && rx < inside!.x + inside!.w + RULE_GAP)
      || zeroRules.y.some((ry) => ry > inside!.y - RULE_GAP && ry < inside!.y + inside!.h + RULE_GAP));
    // Tier 1 keeps a value only inside its bubble.
    // Tier 2 keeps none. A value left off the plot is named in the
    // page note (no value is hidden without its name on the page).
    const dropped = bubbleMode && (((env.valueTier === 1 || env.valueInsideOnly?.has(p.id) === true) && !fitsInside) || env.valueTier === 2);
    const joined = named && value !== undefined && !fitsInside && !dropped ? value : undefined;
    if (named) {
      // A marker a divider runs through sits in both boxes to the eye; its
      // name says which box it is counted in.
      const box = q.derived?.assignment[p.id];
      const straddles = box !== undefined &&
        ((q.drawX && Math.abs(cx - area.x(q.derived!.x)) < r) || (q.drawY && Math.abs(cy - area.y(q.derived!.y)) < r));
      // A point drawn at a clipped edge prints the value it really has.
      const clipped = (domain.clamp?.records ?? []).filter((record) => record.points.some((point) => point.id === p.id));
      const real = clipped.length ? ` ${[...new Set(clipped.map((record) => record.axis))].map((axis) => env.axisFmt[axis](p[axis])).join(', ')}` : '';
      const plain = straddles ? `${p.label}${real} (${options.quadrants?.labels?.[box] ?? QUADRANT_BOX_NAME[box]})` : `${p.label}${real}`;
      const name = joined === undefined ? plain : `${plain} ${joined}`;
      // A name wider than its 2x2 box wraps on two lines inside it.
      const room = box === undefined ? Infinity : boxSideWidth(box) - 2 * RULE_GAP;
      const wrapped = env.measure(name, nameFont).width > room ? wrapText(name, nameFont, room, 2, env.measure) : undefined;
      const nameLines = wrapped && !wrapped.truncated && wrapped.lines.length === 2 ? wrapped.lines : [name];
      // A callout on this point prints bold under its name: one block, so the callout never stands apart on a leader.
      const callout = nameLines.length === 1 ? env.callouts?.get(p.id) : undefined;
      const boldFont = { ...area.fonts.label, weight: emphasisWeight(env.theme) };
      const nameW = env.measure(name, nameFont).width;
      const wrappedCallout = callout !== undefined && env.calloutWrap
        ? wrapText(callout, boldFont, Math.max(nameW, ...callout.split(/\s+/).map((word) => env.measure(word, boldFont).width)), 3, env.measure)
        : undefined;
      const calloutLines = callout === undefined ? [] : wrappedCallout && !wrappedCallout.truncated ? wrappedCallout.lines : [callout];
      const lines = callout === undefined ? nameLines : [name, ...calloutLines];
      const font = callout === undefined ? nameFont : boldFont;
      const lineH = nameFont.size * (nameFont.lineHeight ?? 1.2);
      const block = callout !== undefined
        ? { width: Math.max(nameW, ...calloutLines.map((line) => env.measure(line, boldFont).width)), height: lines.length * lineH }
        : lines.length > 1
          ? { width: Math.max(...lines.map((line) => env.measure(line, nameFont).width)), height: lines.length * lineH }
          : undefined;
      requests.push({
        id: `point:${p.id}`,
        kind: 'point',
        owner: { pointId: p.id },
        text: callout === undefined ? name : `${name} ${callout}`,
        lines,
        typeRole: 'label', font,
        ...(callout !== undefined ? { headLines: 1, headWeight: nameFont.weight } : {}),
        // An authored callout outranks the plain names.
        priority: callout === undefined ? priority : priority + PRIORITY.highlightBonus,
        // With a value printed, the bubble's centre is the value's seat.
        candidates: seats(name, bubbleMode && value === undefined && !block ? insideFill() : undefined, false, nameFont, block, true),
        labelGap: NAME_GAP,
        // The authored point name, not a value.
        role: 'category',
        // The nearest-mark rule: a seat nearer another point waits, or
        // takes a leader from this one.
        anchor: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r },
        // A bubble's leader crosses no other label; no name's leader does either.
        leaderClear: true,
      });
    }
    if (value === undefined || joined !== undefined) continue;
    // A bubble's value sits inside it, or, without a name, on a leader from
    // its round edge: a bare number beside a bubble reads as any bubble's. A
    // dot's value sits beside it, never on a leader, which would read as a
    // second name.
    // A dropped value has no seat: the solver hides it and the note names it.
    const valueSeats = dropped ? [] : seats(value, bubbleMode ? insideFill() : undefined, bubbleMode)
      .filter((candidate) => (bubbleMode ? candidate.insideFill !== undefined || (!named && candidate.leaderFrom !== undefined) : candidate.leaderFrom === undefined))
      // A value that fits inside its bubble (no rule through it,
      // no neighbouring circle over it, measured on the circles) takes its seat
      // with no pad: the pad met a neighbour's bounding box, not its circle
      // (NordPower 8.4 beside Boreal Mining).
      .map((candidate) => (fitsInside && candidate.slot === 'insideCenter' ? { ...candidate, pad: 0, ...(behindZero ? { overRules: true } : {}) } : candidate));
    requests.push({
      id: `value:${p.id}`,
      kind: 'point',
      owner: { pointId: p.id },
      text: value,
      lines: [value],
      typeRole: 'label', font: area.fonts.label,
      // Names go before values. A value ranks below every name, so a
      // small point keeps its name before a large one prints its number; a
      // highlighted point's value keeps its rank.
      priority: hl ? priority - 1 : priority - 1 - PRIORITY.extreme,
      candidates: valueSeats,
      labelGap: NAME_GAP,
      role: 'value',
      ...(bubbleMode ? { anchor: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, leaderClear: true } : {}),
    });
  }
}

/** Phase 3: every label request, in the order the solver takes them. */
export function planScatterLabels(
  env: ScatterEnv,
  domain: ScatterDomain,
  area: ScatterPlotArea,
  geometry: ScatterMarkGeometry,
  paints: ScatterPaints,
  warnings: LintWarning[],
): LabelRequest[] {
  // Bubbles only: a dot's box is its circle, and the pad is its air.
  const bubbles = domain.bubbleMode ? geometry.placed : [];
  const requests = zoneLabelRequests(geometry.zones.labels, area, env, bubbles);
  if (domain.quadrants.derived) {
    dividerTagRequests(domain.quadrants, area, env, requests, domain.pts, geometry.cutTicks);
    quadrantCaptionRequests(env, domain, area, geometry.split, requests, warnings, bubbles);
  }
  pointLabelRequests(env, domain, area, geometry.placed, geometry.rules, paints, requests, warnings, geometry.seatMemo ??= new Map(), geometry.paintMemo ??= new Map());
  trendLabelRequest(env, area, geometry, requests);
  return requests;
}

/**
 * The author's trend label, once, at an end of the first drawn trend line
 * The engine adds no equation and no r²: those are claims. The seats
 * run from the right end of the fitted segment (just past it, then above or
 * below it with the box's edge on the end), to the same three at the left
 * end, and only then to the interior. A box above or below the line sits on
 * it: its gap is measured from the line where the line runs under the box,
 * so the label follows the slope instead of floating off it. The label is
 * placed before the interior point names, so an end seat is still free.
 */
function trendLabelRequest(env: ScatterEnv, area: ScatterPlotArea, geometry: ScatterMarkGeometry, requests: LabelRequest[]): void {
  const trend = env.options.trend;
  const text = typeof trend === 'object' ? trend.label : undefined;
  const line = geometry.trendLines[0];
  if (!text || !line) return;
  const font = { ...area.fonts.label, weight: emphasisWeight(env.theme) };
  const { width: w, height: h } = env.measure(text, font);
  const { from, to, yAt } = line;
  const GAP = 4;
  /** The box starting at `x0`, above or below the stretch of line under it. */
  const onLine = (x0: number, side: 'above' | 'below') => {
    const lo = Math.max(x0, from.x);
    const hi = Math.min(x0 + w, to.x);
    const ys = lo <= hi ? [yAt(lo), yAt(hi)] : [x0 + w < from.x ? from.y : to.y];
    return { x: x0, y: side === 'above' ? Math.min(...ys) - GAP - h : Math.max(...ys) + GAP, w, h };
  };
  const seats: [string, Rect][] = [
    ['endRight', { x: to.x + GAP + 2, y: to.y - h / 2, w, h }],
    ['endAbove', onLine(to.x - w, 'above')],
    ['endBelow', onLine(to.x - w, 'below')],
    ['endAboveCentre', onLine(to.x - w / 2, 'above')],
    ['endBelowCentre', onLine(to.x - w / 2, 'below')],
    ['startLeft', { x: from.x - GAP - 2 - w, y: from.y - h / 2, w, h }],
    ['startAbove', onLine(from.x, 'above')],
    ['startBelow', onLine(from.x, 'below')],
    ...[0.75, 0.5, 0.25].flatMap((t) => {
      const x0 = from.x + (to.x - from.x) * t - w / 2;
      return [[`above${t * 100}`, onLine(x0, 'above')], [`below${t * 100}`, onLine(x0, 'below')]] as [string, Rect][];
    }),
  ];
  // The fitted line ends at a point, and a seat that hugs a dot reads as that
  // point's name: seats 8 px (two name gaps) clear of every mark go first, in
  // the order above, and the rest follow so the clearance alone never hides it.
  const clear = (rect: Rect) => geometry.placed.every(({ cx, cy, r }) => !rectsOverlap(rect, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, 8));
  const candidates: SlotCandidate[] = [...seats.filter(([, rect]) => clear(rect)), ...seats.filter(([, rect]) => !clear(rect))]
    .map(([slot, rect], penalty) => ({ slot, rect, penalty }));
  requests.push({
    id: `trend:${line.fit.id}`,
    kind: 'valueLine',
    owner: { annotationId: line.nodeId },
    text,
    lines: [text],
    typeRole: 'label', font,
    // Before the interior point names, so an end seat is still free; the
    // extreme points, which usually sit at the line's ends, keep theirs.
    priority: PRIORITY.extreme - 1,
    role: 'note',
    candidates: candidates.filter((candidate) => rectContains(area.plot, candidate.rect)),
  });
}

/** The solver context the point labels and the annotation pass share. */
export function scatterSolveCtx(env: ScatterEnv, area: ScatterPlotArea): SolveCtx {
  const { options, size, theme } = env;
  return labelCtx(theme, size, options, {
    measure: env.measure,
    plot: area.plot,
    labelPad: 2,
  });
}
