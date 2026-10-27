/**
 * Standard bar phase 2, mark geometry: the scale and the band in, the scene
 * nodes of the row tints, the value axis, the bars and segments with their
 * range whiskers, the reference ticks, the n.m. glyphs and the net line out,
 * with every rect they claim in a fresh index.
 */

import { emitBarMark } from '../band/barMark';
import { stackConnectors } from '../band/connectors';
import { rangeWhisker } from '../band/rangeWhisker';
import type { AnchorResolution } from '../../annotate';
import { categoryBreakGlyph, layoutValueAxis } from '../../axis';
import { type Rect } from '../../geometry';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { strokeToken, dashToken } from '../../theme';
import type { OwnerRef } from '../../types/cell';
import type { SceneNode } from '../../types/scene';
import { groupedOffsets } from '../band/groups';
import { breakAxisScale, REFERENCE_MARKER_R, referenceCasing, referenceMarkerPaint, referenceTickGeometry } from '../band/ticks';
import { displayFor } from './domain';
import type { BarMarks } from './layout';
import { barHalves, type BarArea, type BarDomain, type BarMarkGeometry, type BarPaints, type BarPlace, type NormCat } from './model';
import { notApplicableGlyph } from '../../format';
import { pushAll } from '../../arrays';

function barAnchor(cat: NormCat, x: number, y: number, value: number, owner: OwnerRef): AnchorResolution {
  return { x, y, value, date: cat.date, label: cat.label ?? cat.id, owner };
}

type RowOutput = Pick<BarMarkGeometry, 'rangeMarks' | 'anchorByCat' | 'anchorBySeg'> & {
  rangeNodes: SceneNode[];
  /** Where reference ticks go: after the whiskers when any bar has a range, else in row order. */
  refTarget: SceneNode[];
};

/** One row: its bars or segments with their whiskers, its reference ticks, its extent and its anchors. */
function barRow(
  domain: BarDomain,
  paints: BarPaints,
  area: BarArea,
  ci: number,
  marks: BarMarks,
  nodes: SceneNode[],
  claims: OccupiedIndex,
  out: RowOutput,
): BarPlace[] {
  const { cats, dataSeries, refSeries, variant, plotRange, stacks, rowEnds, referenceStyle } = domain;
  const { x, band } = area;
  const cat = cats[ci]!;
  const rowY = band.position(ci);
  const bw = band.bandwidth;
  const rowCenter = rowY + bw / 2;
  const places: BarPlace[] = [];
  const rowBars: BarMarks['rows'][number]['bars'] = [];
  const groupSlots = groupedOffsets(bw, dataSeries.length);
  const grouped = variant === 'grouped';
  dataSeries.forEach((s, si) => {
    const cell = s.cells[ci]!;
    const v = cell.v;
    if (v === null) return;
    const segment = stacks[ci]!.segments[si]!;
    const by = grouped ? rowY + groupSlots[si]!.offset : rowY;
    const bh = grouped ? groupSlots[si]!.size : bw;
    const start = grouped ? 0 : segment.start;
    const end = grouped ? v : segment.end;
    const xA = x(start);
    const xB = x(end);
    const rect: Rect = { x: Math.min(xA, xB), y: by, w: Math.max(Math.abs(xB - xA), 0.5), h: bh };
    const nodeId = `mark:${cat.id}:${s.id}`;
    const owner: OwnerRef = { seriesId: s.id, categoryId: cat.id };
    const { paint, pattern, outline } = paints.cell(s, cat, cell.meta, cell.v);
    const val = grouped ? v : segment.value;
    const halves = barHalves(domain.options);
    emitBarMark({ axis: 'x', theme: domain.theme, scale: area.x, activeBreak: area.activeBreak, css: (paint) => paints.css(paint) }, nodes, claims, {
      nodeId, rect, start, end, fill: paint, pattern, outline, owner,
      ...(halves?.neg === s.id ? { claimOwner: { seriesId: halves.pos, categoryId: cat.id } } : {}),
      part: grouped ? 'bar' : 'segment',
      displayValue: displayFor(domain, v, cell.meta, variant === 'stacked100' ? val : undefined, s, cat.id),
    });
    rowBars.push({ seriesId: s.id, rect, nodeId });
    const range = plotRange(ci, si);
    if (range) {
      const whisker = rangeWhisker(domain.theme, { seriesId: s.id, categoryId: cat.id, axis: 'x', center: by + bh / 2, markSize: bh, range, offset: start, scale: area.x, activeBreak: area.activeBreak, fmt: domain.fmt });
      out.rangeNodes.push(...whisker.nodes);
      for (const claim of whisker.claims) claims.claim(claim.rect, claim.kind, claim.owner, claim.part);
      out.rangeMarks.push(whisker.mark);
    }
    out.anchorBySeg.set(`${cat.id}:${s.id}`, barAnchor(cat, xB, by + bh / 2, v, owner));
    places.push({ s, si, v, val, rect });
  });
  // reference series → vertical tick per row (referenceStyle tick|line|marker)
  (variant !== 'stacked100' ? refSeries : []).forEach((rs) => {
    const { v, meta } = rs.cells[ci]!;
    if (v === null) return;
    const rx = x(v);
    const nodeId = `ref:${cat.id}:${rs.id}`;
    const owner: OwnerRef = { seriesId: rs.id, categoryId: cat.id };
    const tickGeometry = referenceTickGeometry('horizontal', rowY, rx, -2, bw + 2);
    if (referenceStyle !== 'marker') {
      out.refTarget.push(referenceCasing(nodeId, tickGeometry.line, referenceStyle === 'line' ? strokeToken(domain.theme, 'rule') : domain.referenceTick.width, owner));
    }
    out.refTarget.push({
      id: nodeId,
      owner,
      display: { value: displayFor(domain, v, meta, undefined, rs) },
      ...(referenceStyle === 'marker' ? {
        t: 'circle',
        cx: rx,
        cy: rowCenter,
        ...referenceMarkerPaint(domain.theme, paints.reference()),
        part: 'referenceMarker',
      } : {
        t: 'line',
        ...tickGeometry.line,
        stroke: paints.reference(),
        width: referenceStyle === 'line' ? strokeToken(domain.theme, 'rule') : domain.referenceTick.width,
        dash: referenceStyle === 'line' ? dashToken(domain.theme, 'dotted') : undefined, lineCap: 'round' as const,
        part: referenceStyle === 'line' ? 'referenceLine' : 'referenceTick',
      }),
    });
    // Include the marker circle when it extends beyond a thin row band.
    const mr = REFERENCE_MARKER_R + 1;
    const claimTop = referenceStyle === 'marker' ? Math.min(rowY - 2, rowCenter - mr) : rowY - 2;
    const claimBottom = referenceStyle === 'marker' ? Math.max(rowY + bw + 2, rowCenter + mr) : rowY + bw + 2;
    claims.claim(
      referenceStyle === 'marker' ? { x: rx - mr, y: claimTop, w: 2 * mr, h: claimBottom - claimTop } : tickGeometry.claim,
      'mark',
      owner,
      // A reference drawn as a line is one a highlighted value may cross.
      ...(referenceStyle === 'line' ? ['referenceLine'] : []),
    );
    marks.referenceTicks.push({ seriesId: rs.id, categoryId: cat.id, nodeId });
    out.anchorBySeg.set(`${cat.id}:${rs.id}`, barAnchor(cat, rx, rowCenter, v, owner));
  });
  // row extent for marks + category anchor
  const ends = rowEnds[ci]!;
  marks.rows.push({ id: cat.id, rect: { x: x(ends.neg), y: rowY, w: Math.max(x(ends.pos) - x(ends.neg), 0.5), h: bw }, bars: rowBars });
  out.anchorByCat.set(cat.id, barAnchor(cat, x(ends.pos > 0 ? ends.pos : ends.neg), rowCenter, domain.totals[ci]!, { categoryId: cat.id }));
  return places;
}

/**
 * Structural categories carry no sequence: each row gets only the
 * breadth-sized tick at its selected cumulative boundary. Returns the last
 * edge, where the net line's label hangs.
 */
function netLineMarks(domain: BarDomain, area: BarArea, nodes: SceneNode[], claims: OccupiedIndex): BarMarkGeometry['netLineEnd'] {
  const { cats, dataSeries, stacks, netLineSeries, rowEnds } = domain;
  const { x, band } = area;
  const edgeValues = cats.map((_, ci): number | undefined => {
    if (!netLineSeries) return rowEnds[ci]!.pos;
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
  edgeValues.forEach((value, ci) => {
    if (value === undefined) return;
    const xx = x(value);
    // The tick stands out of its bar, up to 4 px each side, so it reads as a
    // mark on the bar and not as one more seam.
    const overhang = Math.max(0, Math.min(4, (band.step - band.bandwidth) / 2 - 1));
    const y1 = band.position(ci) - overhang;
    const y2 = band.position(ci) + band.bandwidth + overhang;
    nodes.push({
      t: 'line',
      id: `netLine:${cats[ci]!.id}:edge`,
      x1: xx,
      y1,
      x2: xx,
      y2,
      stroke: { token: 'markInk' },
      width: strokeToken(domain.theme, 'data'),
      owner: {
        ...(netLineSeries ? { seriesId: netLineSeries.id } : {}),
        categoryId: cats[ci]!.id,
      },
      part: 'netLine',
    });
    claims.claim({ x: xx - 0.7, y: y1, w: 1.4, h: Math.max(y2 - y1, 1) }, 'mark', { annotationId: 'netLine' }, 'netLine');
  });
  let last = edgeValues.length - 1;
  while (last >= 0 && edgeValues[last] === undefined) last--;
  return last >= 0 ? { x: x(edgeValues[last]!), ci: last } : undefined;
}

/** The solver's label pad (bar/layout.ts): the baseline claim stops this far short of a halves bar. */
const HALVES_RULE_INSET = 2;

/** Phase 2: the scale and the band in, the scene nodes and their claims out. */
export function layoutBarMarks(domain: BarDomain, paints: BarPaints, area: BarArea): BarMarkGeometry {
  const { options, theme, size, measure, highlights, restRecedes, cats, dataSeries } = domain;
  const { frame, plot, x, x0, band } = area;
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const nodes: SceneNode[] = [...frame.nodes];
  const marks: BarMarks = { rows: [], referenceTicks: [], rowTints: [] };
  // row tints behind everything (highlighted categories of a multi-series
  // chart, see restRecedes) — decorative, not claimed
  cats.forEach((cat, ci) => {
    if (!highlights.has(cat.id) || restRecedes) return;
    const gapHalf = (band.step - band.bandwidth) / 2;
    const nodeId = `rowTint:${cat.id}`;
    nodes.push({
      t: 'rect',
      id: nodeId,
      rect: {
        x: plot.x,
        y: Math.max(plot.y, band.position(ci) - gapHalf),
        w: plot.w,
        h: Math.min(band.step, plot.y + plot.h - (band.position(ci) - gapHalf)),
      },
      fill: { token: 'others' },
      owner: { categoryId: cat.id },
      part: 'rowTint',
    });
    marks.rowTints.push({ categoryId: cat.id, nodeId });
  });
  // value axis (bottom) — claims tick labels so nothing collides with them
  const axes: BarMarkGeometry['axes'] = [];
  if (options.valueAxis?.show) {
    const axisResult = layoutValueAxis(
      {
        scale: breakAxisScale(x),
        plot,
        orient: 'x',
        gridlines: options.valueAxis.gridlines ?? false,
        ...domain.axisFmt,
        theme,
        measure,
        canvasWidth: size.width,
      },
      claims,
    );
    nodes.push(...axisResult.nodes);
    axes.push(axisResult.axis);
  }
  // baseline (vertical, at value 0 — thin solid, always)
  const baseline = (id: string): SceneNode => ({
    t: 'line', id, x1: x0, y1: plot.y, x2: x0, y2: plot.y + plot.h, stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'baseline',
  });
  nodes.push(baseline('axis:baseline'));
  const halves = barHalves(options);
  if (domain.connectorsOn && domain.variant !== 'grouped') stackConnectors({ ...domain, axis: 'x', scale: area.x, band: area.band }, nodes, claims);
  const referenceNodes: SceneNode[] = [];
  const out: RowOutput = {
    rangeMarks: [],
    rangeNodes: [],
    refTarget: dataSeries.some((series) => series.cells.some((cell) => cell.range)) ? referenceNodes : nodes,
    anchorByCat: new Map(),
    anchorBySeg: new Map(),
  };
  const bars = cats.map((_, ci) => barRow(domain, paints, area, ci, marks, nodes, claims, out));
  // With halves the baseline shows only between the bars, and is claimed
  // there, short of each bar by the label pad, so a value that fills its bar
  // is not blocked by the rule showing beyond the bar's edge.
  let from = plot.y;
  for (const row of halves ? marks.rows : []) {
    if (!row.bars.some((bar) => bar.seriesId === halves!.neg)) continue;
    if (row.rect.y - HALVES_RULE_INSET > from) claims.claim({ x: x0 - 1, y: from, w: 2, h: row.rect.y - HALVES_RULE_INSET - from }, 'axis', {});
    from = Math.max(from, row.rect.y + row.rect.h + HALVES_RULE_INSET);
  }
  if (plot.y + plot.h > from) claims.claim({ x: x0 - 1, y: from, w: 2, h: plot.y + plot.h - from }, 'axis', {});
  if (out.rangeNodes.length > 0) {
    pushAll(nodes, out.rangeNodes);
    marks.ranges = out.rangeMarks;
  }
  pushAll(nodes, referenceNodes);
  // baseline re-emitted ABOVE the mark fills: hatched/outlined FC bars carry
  // a light pattern background that would otherwise erase the axis rule.
  // Halves carry their value across it, so there it stays behind.
  if (!halves) nodes.push(baseline('axis:baseline:over'));
  // Category breaks: the glyph in the middle of the gap, on the baseline.
  cats.forEach((c, ci) => {
    if (!c.breakAfter || ci === cats.length - 1) return;
    const glyph = categoryBreakGlyph(theme, { x: x0, y: (area.band.position(ci) + area.band.bandwidth + area.band.position(ci + 1)) / 2 }, 'y', `axis:y:categoryBreak:${c.id}`);
    nodes.push(...glyph.nodes);
    claims.claim(glyph.rect, 'axis', {}, 'categoryBreak');
  });
  // stacked100: suppressed rows leave the honest trace instead of a hole
  // (table state-glyph philosophy) — n.m. for signed data, n/a for
  // nothing-to-compose
  cats.forEach((cat, ci) => {
    const glyph = domain.nmRows[ci] ? 'n.m.' : domain.naRows[ci] ? notApplicableGlyph(options.strings) : null;
    if (!glyph) return;
    const font = { family: theme.type.family, ...theme.type.label };
    const glyphSize = measure(glyph, font);
    const rowCenter = band.position(ci) + band.bandwidth / 2;
    const rect: Rect = { x: x0 + 8, y: rowCenter - glyphSize.height / 2, w: glyphSize.width, h: glyphSize.height };
    nodes.push({
      t: 'text',
      id: `nm:${cat.id}`,
      x: rect.x,
      y: rect.y,
      lines: [glyph],
      align: 'start',
      typeRole: 'label', font,
      ink: { token: 'inkMuted' },
      owner: { categoryId: cat.id },
      part: 'nmMarker',
    });
    claims.claim(rect, 'label', { categoryId: cat.id });
  });
  const netLineEnd = domain.netLineOn ? netLineMarks(domain, area, nodes, claims) : undefined;
  const { rangeMarks, anchorByCat, anchorBySeg } = out;
  return { nodes, claims, axes, marks, rangeMarks, bars, anchorByCat, anchorBySeg, netLineEnd };
}
