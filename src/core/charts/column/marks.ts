import { NOT_AVAILABLE, NOT_MEANINGFUL, notApplicableGlyph } from '../../format';
/**
 * Column phase 2, mark geometry: the scale and the band in, the scene nodes
 * of the axis, the columns, the ranges, the anomaly furniture, the reference
 * ticks and the net line out, with every rect they claim in a fresh index.
 */

import { emitBarMark, type BarMarkInput } from '../band/barMark';
import { stackConnectors } from '../band/connectors';
import { sk } from '../band/stacks';
import { categoryBreakGlyph, layoutValueAxis } from '../../axis';
import { type Rect } from '../../geometry';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { strokeToken, dashToken, contrastInkPaint, effectiveFill, hatchGroundPaint, resolveSurface } from '../../theme';
import { ribbonPath } from '../../svgPath';
import type { Id } from '../../types/cell';
import type { AxisGeometry, Paint, SceneNode } from '../../types/scene';
import { groupedOffsets } from '../band/groups';
import { breakAxisScale, REFERENCE_MARKER_R, referenceCasing, referenceMarkerPaint, referenceTickGeometry } from '../band/ticks';
import type { ColumnMarks } from './layout';
import {
  ANOMALY_FLAG_GAP,
  ANOMALY_FLAG_H,
  type ColumnArea,
  type ColumnDomain,
  type ColumnMarkGeometry,
  type ColumnPaints,
  type FlagMarker,
} from './model';
import { contentOf, shareTextOf } from './domain';
import { rangeWhisker } from '../band/rangeWhisker';
import { anomalyRuleLines, drawAnomalyRules, emitAnomalyFlag } from './anomaly';
import { pushAll } from '../../arrays';


/** The ground of a hatched bar or segment: its own series tint. */
export function segmentHatchGround(part: string, pattern: string | undefined, fill: Paint): Paint | undefined {
  // A grouped forecast column grounds its hatch in its own series tint
  // too, so two hatched series stay two colours.
  if ((part !== 'segment' && part !== 'bar') || pattern !== 'hatch45') return undefined;
  return hatchGroundPaint(fill);
}

/** The white line between neighbouring ribbons, in px. */


/**
 * Ribbons (options.ribbons): a translucent band joins each series' segment in
 * one column to its segment in the next, behind the columns, with a
 * background-coloured hairline on both edges so neighbouring ribbons separate.
 * Like a connector it skips a category break and a series that changes sign.
 * The fills go first and the separators over all of them, so a ribbon that
 * crosses keeps both edges.
 */
function columnRibbons(domain: ColumnDomain, paints: ColumnPaints, area: ColumnArea, nodes: SceneNode[]): NonNullable<ColumnMarks['ribbons']> {
  const { cats, dataSeries, stacks, theme } = domain;
  const { band, y } = area;
  const surface = resolveSurface(theme);
  const opacity = domain.ribbonRank ? surface.ribbonAlpha : surface.ribbonSheetAlpha;
  const fills: SceneNode[] = [];
  const edges: SceneNode[] = [];
  const out: NonNullable<ColumnMarks['ribbons']> = [];
  for (let ci = 0; ci < cats.length - 1; ci++) {
    const left = cats[ci]!;
    const right = cats[ci + 1]!;
    // A gap, a break or a total column sets the next column apart: no flow crosses it.
    if (left.breakAfter || (left.gapAfter !== undefined && left.gapAfter !== false && left.gapAfter !== 0) || right.role === 'total') continue;
    const x1 = band.position(ci) + band.bandwidth;
    const x2 = band.position(ci + 1);
    dataSeries.forEach((s, si) => {
      const a = stacks[ci]!.segments[si];
      const b = stacks[ci + 1]!.segments[si];
      if (!a || !b || a.value === 0 || b.value === 0 || Math.sign(a.value) !== Math.sign(b.value)) return;
      const top1 = y(Math.max(a.start, a.end));
      const bottom1 = y(Math.min(a.start, a.end));
      const top2 = y(Math.max(b.start, b.end));
      const bottom2 = y(Math.min(b.start, b.end));
      const owner = { seriesId: s.id, categoryId: left.id };
      const id = `ribbon:${left.id}:${right.id}:${s.id}`;
      fills.push({
        t: 'path', id, d: ribbonPath(x1, top1, bottom1, x2, top2, bottom2, false, domain.ribbonRank),
        fill: paints.cell(s, s.vals[ci]!, left, si), opacity, owner, part: 'ribbon',
      });
      edges.push({
        t: 'path', id: `${id}:edge`, d: ribbonPath(x1, top1, bottom1, x2, top2, bottom2, true, domain.ribbonRank),
        stroke: { token: 'background' }, width: strokeToken(theme, 'hair'), owner, part: 'ribbonEdge',
      });
      out.push({ seriesId: s.id, from: left.id, to: right.id, left: { x: x1, top: top1, bottom: bottom1 }, right: { x: x2, top: top2, bottom: bottom2 }, nodeId: id });
    });
  }
  pushAll(nodes, fills);
  pushAll(nodes, edges);
  return out;
}

/**
 * Flag-marker geometry is solved WITH the bar, not after it, so the value
 * and category labels can be given the clearance the marker will occupy.
 * Placing the marker later and claiming it afterwards is a collision
 * detection failure (the index records the collision instead of preventing it).
 */
function flagMarkerAt(
  domain: ColumnDomain,
  paints: ColumnPaints,
  area: ColumnArea,
  rect: Rect,
  value: number,
  insidePaint: Paint,
  insidePattern?: 'hatch45' | 'outline',
): FlagMarker {
  const { plot } = area.frame;
  const insideFill = effectiveFill(paints.css(insidePaint), insidePattern, domain.theme);
  const up = value >= 0;
  let base = up ? rect.y - ANOMALY_FLAG_GAP : rect.y + rect.h + ANOMALY_FLAG_GAP;
  let tip = up ? base - ANOMALY_FLAG_H : base + ANOMALY_FLAG_H;
  let outside = true;
  // Whatever the engine adds on its own must fit by construction: a
  // flagged column can sit against the top of the domain, where an outside
  // marker would climb into the title band. There it flips inside the column
  // end instead of being drawn where nobody can see it.
  if (up ? tip < plot.y : tip > plot.y + plot.h) {
    outside = false;
    base = up
      ? rect.y + ANOMALY_FLAG_GAP + ANOMALY_FLAG_H
      : rect.y + rect.h - ANOMALY_FLAG_GAP - ANOMALY_FLAG_H;
    tip = up ? rect.y + ANOMALY_FLAG_GAP : rect.y + rect.h - ANOMALY_FLAG_GAP;
  }
  return {
    cx: rect.x + rect.w / 2,
    base,
    tip,
    up,
    outside,
    value,
    insideFill,
    insidePaint,
    ...(insidePattern ? { insidePattern } : {}),
  };
}

type BarGeometry = Pick<ColumnMarkGeometry, 'rangeMarks' | 'bars' | 'subCenters' | 'segEdges' | 'flagMarkers'> & {
  rangeNodes: SceneNode[];
};

/** The columns (grouped) or the stack segments, with their range whiskers and flag markers. */
function columnBars(
  domain: ColumnDomain,
  paints: ColumnPaints,
  area: ColumnArea,
  marks: ColumnMarks,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): BarGeometry {
  const { cats, dataSeries, variant, plottedOf, rangeOf, absOf, valueSpec, anomaly, stacks } = domain;
  const { band, y, y0 } = area;
  const rangeMarks: BarGeometry['rangeMarks'] = [];
  const rangeNodes: SceneNode[] = [];
  const bars: BarGeometry['bars'] = [];
  const subCenters: BarGeometry['subCenters'] = new Map();
  const segEdges: BarGeometry['segEdges'] = new Map();
  const flagMarkers: BarGeometry['flagMarkers'] = new Map();
  const emit = (input: BarMarkInput) => emitBarMark({ axis: 'y', theme: domain.theme, scale: y, activeBreak: domain.activeBreak, css: paints.css }, nodes, claims, input);
  const queueRangeWhisker = (seriesId: Id, categoryId: Id, cx: number, markWidth: number, range: NonNullable<ReturnType<typeof rangeOf>>, offset = 0): void => {
    const whisker = rangeWhisker(domain.theme, { seriesId, categoryId, axis: 'y', center: cx, markSize: markWidth, range, offset, scale: y, activeBreak: domain.activeBreak, fmt: domain.fmt });
    rangeNodes.push(...whisker.nodes);
    for (const claim of whisker.claims) claims.claim(claim.rect, claim.kind, claim.owner, claim.part);
    rangeMarks.push(whisker.mark);
  };
  const groupSlots = groupedOffsets(band.bandwidth, dataSeries.length);
  cats.forEach((c, ci) => {
    const bx = band.position(ci);
    const bw = band.bandwidth;
    const stack = stacks[ci]!;
    const segs: NonNullable<ColumnMarks['bars'][number]['segments']> = [];
    dataSeries.forEach((s, si) => {
      const val = s.vals[ci]!;
      const owner = { seriesId: s.id, categoryId: c.id };
      const nodeId = `mark:${s.id}:${c.id}`;
      if (variant === 'grouped') {
        const v = plottedOf(s, ci);
        const group = groupSlots[si]!;
        const subW = group.size;
        const x = bx + group.offset;
        subCenters.set(sk(s.id, c.id), x + subW / 2);
        if (v === null) return;
        const yv = y(v);
        const rect: Rect = { x, y: Math.min(yv, y0), w: subW, h: Math.max(Math.abs(yv - y0), 0.5) };
        const fill = paints.cell(s, val, c, si);
        const pattern = paints.pattern(s, val, c);
        emit({
          nodeId, rect, start: 0, end: v,
          fill, pattern, outline: paints.outline(c),
          owner, part: 'bar',
          displayValue: valueSpec.forSeries(s, s.vals[ci]?.format)(absOf(s, ci)!),
          ...(anomaly?.flagByCategory.has(c.id) ? { displayState: 'flagged' } : {}),
        });
        marks.bars.push({ seriesId: s.id, categoryId: c.id, rect, nodeId });
        const flagHere = anomaly?.flagByCategory.get(c.id);
        if (flagHere) {
          flagMarkers.set(c.id, flagMarkerAt(domain, paints, area, rect, flagHere.value, fill, pattern));
        }
        const range = rangeOf(s, ci);
        if (range) queueRangeWhisker(s.id, c.id, x + subW / 2, subW, range);
        bars.push({ s, si, c, ci, v, rect });
        return;
      }
      const segment = stack.segments[si];
      if (!segment) return;
      const { value: v, start: v0, end: v1 } = segment;
      segEdges.set(sk(s.id, c.id), { v0, v1, v });
      const range = rangeOf(s, ci);
      if (range) queueRangeWhisker(s.id, c.id, bx + bw / 2, bw, range, v0);
      if (v === 0) {
        // a zero cell draws nothing; an authored label on it still
        // prints, beside the seam where the segment would stand.
        if (typeof val.labelOverride === 'string') bars.push({ s, si, c, ci, v, rect: { x: bx, y: y(v0), w: bw, h: 0 } });
        return;
      }
      const rect: Rect = { x: bx, y: y(Math.max(v0, v1)), w: bw, h: Math.max(Math.abs(y(v0) - y(v1)), 0.5) };
      emit({
        nodeId, rect, start: v0, end: v1,
        fill: paints.cell(s, val, c, si), pattern: paints.pattern(s, val, c), outline: paints.outline(c),
        owner, part: 'segment',
        displayValue:
          variant === 'stacked100'
            ? shareTextOf(domain, c.id, s.id, v, val.isPct)
            : valueSpec.forSeries(s, s.vals[ci]?.format)(absOf(s, ci)!),
      });
      segs.push({ seriesId: s.id, rect, nodeId });
      bars.push({ s, si, c, ci, v, rect });
    });
    if (variant === 'grouped') return;
    const stackTop = y(stack.positive);
    const stackBot = y(stack.negative);
    marks.bars.push({
      categoryId: c.id,
      rect: { x: bx, y: stackTop, w: bw, h: Math.max(stackBot - stackTop, 0.5) },
      segments: segs,
    });
  });
  return { rangeMarks, rangeNodes, bars, subCenters, segEdges, flagMarkers };
}

/**
 * The anomaly furniture: the corridor rules and the median baseline, each
 * with its value in the right margin, then the flag markers. It paints ABOVE
 * the mark fills (z-order is contract) and claims before solveLabels
 * runs, so the rule text and the promoted value labels route around it
 * instead of over it.
 *
 * A rule with no number attached is an encoding the reader cannot decode
 * and under the default the value axis is OFF, so
 * there is no tick to read it off either. The number goes in the right
 * margin, which is reserved for it in `decorationRight`, so it cannot collide
 * with a column, a value label or the other rule.
 *
 * A flagged column gets a MARKER, never a colour change: colour already
 * encodes direction under signColor, so the two encodings compose instead of
 * fighting for the same channel.
 */
function anomalyFurniture(
  domain: ColumnDomain,
  paints: ColumnPaints,
  area: ColumnArea,
  flagMarkers: Map<Id, FlagMarker>,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): NonNullable<ColumnMarks['anomaly']> {
  const { theme, measure, cats, corridorShown, statFmt } = domain;
  const anomaly = domain.anomaly!;
  const { plot, y } = area;
  drawAnomalyRules(theme, {
    rules: anomalyRuleLines(theme, anomaly, corridorShown, statFmt, paints.corridor, domain.options.strings), statFmt, plot, y, labelX: plot.x + plot.w + 4,
    font: { family: theme.type.family, ...theme.type.label }, measure, nodes, claims,
  });
  const anomalyMarks: NonNullable<ColumnMarks['anomaly']> = [];
  const flagSeries = domain.dataSeries[0]!;
  cats.forEach((c) => {
    const flag = anomaly.flagByCategory.get(c.id);
    const geom = flagMarkers.get(c.id);
    if (!flag || !geom) return;
    const nodeId = `mark:${flagSeries.id}:${c.id}`;
    // The warn token reads at 3.5:1 or better against every shipped page
    // colour but at ~1.4:1 against the good/bad/neutral column fills, so an
    // inside-flipped marker takes the auto-ink for the fill it sits on. A
    // marker nobody can see is not a disclosure.
    const markerPaint: Paint = geom.outside
      ? paints.corridor
      : contrastInkPaint(geom.insidePaint, geom.insidePattern);
    // FOREIGN owner on the claim: solveLabels skips mark claims that belong
    // to the label's own (series, category) pair, so claiming it under the
    // real series id would let the promoted value label place straight
    // through the marker.
    const markerNodeId = emitAnomalyFlag(nodes, claims, geom, markerPaint, { seriesId: flagSeries.id, categoryId: c.id }, domain.fmt(flag.value));
    anomalyMarks.push({
      categoryId: c.id,
      nodeId,
      markerNodeId,
      labelId: `point:${flagSeries.id}:${c.id}`,
      score: flag.score,
    });
  });
  return anomalyMarks;
}

/**
 * Reference series: plan ticks / lines / markers, never bars. A 100%
 * composition axis draws none; there the suppressed categories leave the
 * honest trace instead of a hole (table state-glyph philosophy): n.m. for
 * signed data, n/a for nothing-to-compose.
 *
 * `refTickYs` collects, per category, the y of every non-marker tick
 * (leader clearance): such a tick strokes across the bar edge at y(v), and
 * an outside-sliver leader must never attach on top of it.
 */
function referenceMarks(
  domain: ColumnDomain,
  paints: ColumnPaints,
  area: ColumnArea,
  refTickYs: Map<Id, number[]>,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): ColumnMarks['referenceTicks'] {
  const { theme, measure, cats, refSeries, variant, plottedOf, refStyle, pyRef, pyGrowth, valueSpec } = domain;
  const { band, y } = area;
  const referenceTicks: ColumnMarks['referenceTicks'] = [];
  if (variant === 'stacked100') {
    cats.forEach((c, ci) => {
      const glyph = domain.nmCats100.has(c.id) ? NOT_MEANINGFUL : domain.naCats100.has(c.id) ? notApplicableGlyph(domain.options.strings) : null;
      if (!glyph) return;
      const font = { family: theme.type.family, ...theme.type.label };
      const size = measure(glyph, font);
      const cx = band.center(ci);
      const rect: Rect = { x: cx - size.width / 2, y: area.y0 - size.height - 6, w: size.width, h: size.height };
      nodes.push({
        t: 'text', id: `nm:${c.id}`, x: cx, y: rect.y, lines: [glyph], align: 'middle', typeRole: 'label', font,
        ink: { token: 'inkMuted' }, owner: { categoryId: c.id }, part: 'nmMarker', display: { state: domain.nmCats100.has(c.id) ? NOT_MEANINGFUL : NOT_AVAILABLE },
      });
      claims.claim(rect, 'label', { categoryId: c.id });
    });
    return referenceTicks;
  }
  // An integrated tick carries its label (planned in phase 3) unless labels.tick is off.
  const tickLabels = contentOf(domain.options, 'tick', ['absolute', 'series']) !== null;
  // A tick beside the column, as an integrated PY tick does (grid.tiers).
  const outside = outsideTickReach(domain, band, 0) !== undefined;
  for (const s of refSeries) {
    cats.forEach((c, ci) => {
      const v = plottedOf(s, ci);
      if (v === null) return;
      const ry = y(v);
      if (refStyle !== 'marker') refTickYs.set(c.id, [...(refTickYs.get(c.id) ?? []), ry]);
      const bx = band.position(ci);
      const bw = band.bandwidth;
      const cx = band.center(ci);
      const owner = { seriesId: s.id, categoryId: c.id };
      const nodeId = `ref:${s.id}:${c.id}`;
      const integrated = pyRef?.id === s.id && pyGrowth.has(c.id);
      // A gap under 4 px for the outside tick falls back to the tick across the column (dense cards).
      const reach = outsideTickReach(domain, band, ci) ?? 8;
      const out = integrated || (outside && reach >= 4);
      const tickGeometry = referenceTickGeometry('vertical', bx, ry, out ? bw : -2, bw + (integrated ? 8 : out ? reach : 2));
      if (refStyle === 'marker') {
        nodes.push({
          t: 'circle',
          id: nodeId,
          cx: bx + bw / 2,
          cy: ry,
          ...referenceMarkerPaint(theme, paints.ref(s)),
          owner,
          part: 'referenceMarker',
          display: { value: valueSpec.forSeries(s, s.vals[ci]?.format)(v) },
        });
      } else {
        nodes.push(referenceCasing(nodeId, tickGeometry.line, strokeToken(theme, 'rule'), owner));
        nodes.push({
          t: 'line',
          id: nodeId,
          ...tickGeometry.line,
          // Plan ticks are quiet furniture: hairline in the axis token.
          // Explicit series fill/colorRole still wins; 'line' keeps its ink.
          stroke: paints.refStroke(s),
          width: strokeToken(theme, 'rule'),
          ...(refStyle === 'line' ? { dash: dashToken(theme, 'dotted'), lineCap: 'round' as const } : {}),
          owner,
          part: refStyle === 'tick' ? 'referenceTick' : 'referenceLine',
          display: { value: valueSpec.forSeries(s, s.vals[ci]?.format)(v) },
        });
      }
      // The claim must cover the INK: a 'marker' reference is a circle of
      // r 3.5 around the category center, and a band-wide ±2px strip
      // undersells it vertically — grand totals solved against the strip sit
      // 4px off tick level and the circle's outer 1.5px strikes through their
      // digits (PY markers vs outside stack labels).
      const claimRect: Rect = integrated
        ? tickGeometry.claim
        : refStyle === 'marker'
          ? { x: bx + bw / 2 - REFERENCE_MARKER_R - 1, y: ry - REFERENCE_MARKER_R - 1, w: 2 * REFERENCE_MARKER_R + 2, h: 2 * REFERENCE_MARKER_R + 2 }
          : tickGeometry.claim;
      if (integrated) claims.claim(claimRect, 'mark', owner, 'referenceTick');
      // A reference drawn as a line is one a highlighted value may cross.
      else claims.claim(claimRect, 'mark', owner, refStyle === 'line' ? 'referenceLine' : undefined);
      const labelId = integrated && tickLabels ? `tick:${s.id}:${c.id}` : undefined;
      referenceTicks.push({
        seriesId: s.id,
        categoryId: c.id,
        rect: claimRect,
        nodeId,
        ...(integrated ? { anchor: { x: cx, y: ry }, value: v } : {}),
        ...(labelId ? { labelId } : {}),
      });
    });
  }
  return referenceTicks;
}

/**
 * Net-line ticks sit above stacks. Ordered column categories may opt out of
 * the default stepped connectors without losing the per-category anatomy.
 * Returns the last edge, where the net line's label hangs.
 */
function netLineMarks(domain: ColumnDomain, area: ColumnArea, nodes: SceneNode[], claims: OccupiedIndex): { x: number; y: number } | undefined {
  const { cats, dataSeries, stacks, netLineSeries, netLineSteps, posTopP, negBotP } = domain;
  const { band, y } = area;
  // An all-negative chart has no positive top; its default edge is the bottom.
  const defaultEdge = posTopP.some((value) => value > 0) ? posTopP : negBotP;
  const edgeValues = cats.map((_, ci): number | undefined => {
    if (!netLineSeries) return defaultEdge[ci];
    const stack = stacks[ci]!;
    for (let si = 0; si < dataSeries.length; si++) {
      const series = dataSeries[si]!;
      const segment = stack.segments[si];
      if (!segment) {
        if (series.id === netLineSeries.id) return undefined;
        continue;
      }
      if (series.id === netLineSeries.id) return segment.end;
    }
    return undefined;
  });
  const claimOwner = { annotationId: 'netLine' };
  const line = (id: string, x1: number, y1: number, x2: number, y2: number, owner: { seriesId?: Id; categoryId: Id }, claim: Rect) => {
    nodes.push({ t: 'line', id, x1, y1, x2, y2, stroke: { token: 'markInk' }, width: strokeToken(domain.theme, 'rule'), owner, part: 'netLine' });
    claims.claim(claim, 'mark', claimOwner, 'netLine');
  };
  edgeValues.forEach((value, ci) => {
    if (value === undefined) return;
    const yy = y(value);
    const x1 = band.position(ci);
    const x2 = x1 + band.bandwidth;
    const owner = {
      ...(netLineSeries ? { seriesId: netLineSeries.id } : {}),
      categoryId: cats[ci]!.id,
    };
    line(`netLine:${cats[ci]!.id}:edge`, x1, yy, x2, yy, owner, { x: x1, y: yy - 0.7, w: Math.max(x2 - x1, 1), h: 1.4 });
    const next = edgeValues[ci + 1];
    if (!netLineSteps || next === undefined || cats[ci]!.breakAfter) return;
    const nextY = y(next);
    const nextX = band.position(ci + 1);
    const middleX = (x2 + nextX) / 2;
    const pair = `netLine:${cats[ci]!.id}:${cats[ci + 1]!.id}`;
    line(`${pair}:connector-from`, x2, yy, middleX, yy, owner, { x: x2, y: yy - 0.7, w: Math.max(middleX - x2, 1), h: 1.4 });
    line(`${pair}:step`, middleX, yy, middleX, nextY, owner, { x: middleX - 0.7, y: Math.min(yy, nextY), w: 1.4, h: Math.max(Math.abs(nextY - yy), 1) });
    line(`${pair}:connector-to`, middleX, nextY, nextX, nextY, owner, { x: middleX, y: nextY - 0.7, w: Math.max(nextX - middleX, 1), h: 1.4 });
  });
  let last = edgeValues.length - 1;
  while (last >= 0 && edgeValues[last] === undefined) last--;
  return last >= 0 ? { x: band.position(last) + band.bandwidth, y: y(edgeValues[last]!) } : undefined;
}

/** Whether a category's total is a net that falls inside its own stack. */
export function netInsideStack(domain: ColumnDomain, ci: number): boolean {
  const c = domain.cats[ci]!;
  // An integrated PY variance keeps its total over the stack, where its growth arrow reads it.
  return domain.variant === 'stacked' && domain.gtContent !== null && domain.mixedSignCats.has(c.id) &&
    domain.stacks[ci]!.hasValue && !domain.incompleteCats.has(c.id) && !domain.pyGrowth.has(c.id);
}

/**
 * Where a stack mixes signs its total is a net inside the stack,
 * not its top. A tick marks where the net falls, reaching past the column
 * on the right, where the total's label stands beside it.
 */
function netTotalTicks(domain: ColumnDomain, area: ColumnArea, nodes: SceneNode[], claims: OccupiedIndex, tickYs: Map<Id, number[]>): void {
  const { cats, stackTotals } = domain;
  const { band, y } = area;
  cats.forEach((c, ci) => {
    if (!netInsideStack(domain, ci)) return;
    const yy = y(stackTotals[c.id]!);
    const x1 = band.position(ci) - 2;
    const x2 = band.position(ci) + band.bandwidth + NET_TICK_REACH;
    // Its own owner: no segment value of the column may sit across it.
    const owner = { categoryId: c.id, seriesId: '__netTotal' };
    nodes.push({ t: 'line', id: `netTotal:${c.id}`, x1, y1: yy, x2, y2: yy, stroke: { token: 'markInk' }, width: strokeToken(domain.theme, 'rule'), owner, part: 'netTotal' });
    claims.claim({ x: x1, y: yy - 0.7, w: x2 - x1, h: 1.4 }, 'mark', owner, 'netTotal');
    // A segment value centres in the stretch the tick leaves, as beside a PY tick.
    tickYs.set(c.id, [...(tickYs.get(c.id) ?? []), yy]);
  });
}

/** How far a net total's tick reaches past its column, where its label starts. */
export const NET_TICK_REACH = 6;

/**
 * A highlighted category of several series keeps each series'
 * fill, so every column matches its key; a light focus band behind the
 * group marks the category instead.
 */
function highlightBands(domain: ColumnDomain, area: ColumnArea): SceneNode[] {
  if (domain.dataSeries.length < 2) return [];
  const { band, plot } = area;
  return domain.cats.flatMap((c, ci) => {
    if (!domain.highlights.has(c.id)) return [];
    const pad = (band.step - band.bandwidth) / 2;
    return [{
      t: 'rect' as const, id: `highlightBand:${c.id}`,
      rect: { x: band.position(ci) - pad, y: plot.y, w: band.bandwidth + 2 * pad, h: plot.h },
      fill: { token: 'focus' as const, tint: 0.88 }, owner: { categoryId: c.id }, part: 'highlightBand',
    }];
  });
}

/** Phase 2: the scale and the band in, the scene nodes and their claims out. */
export function layoutColumnMarks(
  domain: ColumnDomain,
  paints: ColumnPaints,
  area: ColumnArea,
): ColumnMarkGeometry {
  const { theme, size, va, anomaly } = domain;
  const { frame, plot, y, y0 } = area;
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const nodes: SceneNode[] = [...frame.nodes, ...highlightBands(domain, area)];
  const axes: AxisGeometry[] = [];
  // Reserving space in topPad is not the same as HOLDING it: a promoted value
  // label on a tall flagged column reaches upward past plot.y and can take the
  // band, hiding the rule. The reserve is therefore claimed,
  // under the rule label's own annotation id so only that label may use it.
  if (area.ruleH > 0) {
    claims.claim(
      { x: frame.plot.x, y: frame.plot.y, w: frame.plot.w, h: area.ruleH },
      'annotation',
      { annotationId: 'anomaly:rule' },
    );
  }
  if (va.show) {
    const axisResult = layoutValueAxis(
      {
        scale: breakAxisScale(y, domain.stepTicks),
        plot,
        orient: 'y',
        // A 100% stack names its shares on the segments; the axis needs only
        // its ends and the half (0, 50, 100%), not a tick every 20%.
        ...(domain.variant === 'stacked100' && domain.dLo === 0 && Math.abs(domain.dHi - 100) < 1e-6 ? { tickCount: 2 } : {}),
        ...(domain.stepTicks && !domain.activeBreak ? { ticks: domain.stepTicks } : {}),
        gridlines: va.gridlines ?? false,
        format: area.axisFmt,
        ...(area.axisSpec ? { formatSpec: area.axisSpec } : {}),
        theme,
        measure: domain.measure,
      },
      claims,
    );
    nodes.push(...axisResult.nodes);
    axes.push(axisResult.axis);
  }
  // baseline (thin solid, always)
  const baseline = (id: string, x1: number, x2: number): SceneNode => ({
    t: 'line', id, x1, y1: y0, x2, y2: y0, stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'baseline',
  });
  nodes.push(baseline('axis:baseline', Math.max(0.6, plot.x), Math.min(size.width - 0.6, plot.x + plot.w)));
  // The line is 1px of ink centred on y0; claiming more than the ink pushes
  // bottom-segment labels out by a fraction (see insideCenterY).
  claims.claim({ x: plot.x, y: y0 - 0.5, w: plot.w, h: 1 }, 'axis', {});
  const ribbons = domain.ribbonsOn ? columnRibbons(domain, paints, area, nodes) : [];
  if (domain.connectorsOn && domain.variant !== 'grouped') stackConnectors({ ...domain, axis: 'y', scale: area.y, band: area.band }, nodes, claims);
  const marks: ColumnMarks = { bars: [], referenceTicks: [], ...(ribbons.length > 0 ? { ribbons } : {}) };
  const { rangeNodes, ...bars } = columnBars(domain, paints, area, marks, nodes, claims);
  if (rangeNodes.length > 0) {
    pushAll(nodes, rangeNodes);
    marks.ranges = bars.rangeMarks;
  }
  // baseline re-emitted ABOVE the mark fills: hatched/outlined FC bars carry
  // a light pattern background that would otherwise erase the axis rule
  nodes.push(baseline('axis:baseline:over', plot.x, plot.x + plot.w));
  // A total column (categories[].role 'total'): a thin divider in the middle of the gap before it.
  domain.cats.forEach((c, ci) => {
    if (c.role !== 'total' || ci === 0) return;
    const { band } = area;
    const x = (band.position(ci - 1) + band.bandwidth + band.position(ci)) / 2;
    nodes.push({ t: 'line', id: `totalDivider:${c.id}`, x1: x, y1: plot.y, x2: x, y2: y0, stroke: { token: 'leader' }, width: strokeToken(theme, 'rule'), owner: { categoryId: c.id }, part: 'totalDivider' });
    claims.claim({ x: x - 1, y: plot.y, w: 2, h: y0 - plot.y }, 'axis', { categoryId: c.id }, 'totalDivider');
  });
  // Category breaks: the glyph in the middle of the gap, on the baseline.
  domain.cats.forEach((c, ci) => {
    if (!c.breakAfter || ci === domain.cats.length - 1) return;
    const { band } = area;
    const glyph = categoryBreakGlyph(theme, { x: (band.position(ci) + band.bandwidth + band.position(ci + 1)) / 2, y: y0 }, 'x', `axis:x:categoryBreak:${c.id}`);
    nodes.push(...glyph.nodes);
    // The strokes end a hair above the first row of names, so only the part over the baseline is claimed.
    // The whole box would hide a name beside the glyph on a narrow chart.
    claims.claim({ ...glyph.rect, h: y0 - glyph.rect.y }, 'axis', {}, 'categoryBreak');
  });
  if (anomaly) {
    const anomalyMarks = anomalyFurniture(domain, paints, area, bars.flagMarkers, nodes, claims);
    if (anomalyMarks.length > 0) marks.anomaly = anomalyMarks;
  }
  const refTickYs = new Map<Id, number[]>();
  marks.referenceTicks = referenceMarks(domain, paints, area, refTickYs, nodes, claims);
  const netLineEnd = domain.netLineOn ? netLineMarks(domain, area, nodes, claims) : undefined;
  if (!domain.netLineOn) netTotalTicks(domain, area, nodes, claims, refTickYs);
  // valueLine strips are claimed by the annotate pass AFTER labels are solved;
  // their y is known now, so pre-claim (same annotation id) so chart labels
  // never end up under the line. The duplicate claim is harmless.
  domain.annList.forEach((ann, n) => {
    if (ann.kind !== 'valueLine') return;
    const annId = ann.id ?? `valueLine-${n + 1}`;
    const v = ann.value === 'mean' || ann.value === undefined ? domain.meanValue : ann.value;
    if (v === undefined) return;
    claims.claim({ x: plot.x, y: y(v) - 1, w: plot.w, h: 2 }, 'annotation', {
      annotationId: annId,
    }, 'referenceLine');
    // A part the rule crosses seats its value in the stretch the rule leaves, as it does for a tick.
    for (const c of domain.cats) refTickYs.set(c.id, [...(refTickYs.get(c.id) ?? []), y(v)]);
  });
  return { nodes, claims, axes, marks, ...bars, refTickYs, netLineEnd };
}


/**
 * How far a stacked column's reference tick reaches out beside its right edge,
 * or undefined where it crosses the column. A tick across a stack that prints
 * its segment values would cut a short segment and run through its value, so
 * it sits outside, stopping 2 px short of the next column (at most 8 px).
 */
export function outsideTickReach(domain: ColumnDomain, band: ColumnArea['band'], ci: number): number | undefined {
  if (domain.variant !== 'stacked' || domain.refStyle !== 'tick' || contentOf(domain.options, 'segment', ['absolute']) === null) return undefined;
  const bx = band.position(ci);
  return Math.min(8, (ci + 1 < domain.cats.length ? band.position(ci + 1) : bx + band.step) - bx - band.bandwidth - 2);
}
