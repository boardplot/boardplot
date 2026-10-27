import { strokeToken } from '../../theme';
import { sk } from '../band/stacks';
import { formatterFromExample } from '../../formatSpec';
/**
 * Mekko phase 2: the scale in, scene nodes out. The value axis, the
 * baseline, every stack segment, the n.m. / n/a glyphs of suppressed percent
 * columns and the ridge, in paint order. Everything the phase claims goes
 * into an OccupiedIndex of its own, in claim order.
 */

import { layoutValueAxis } from '../../axis';
import { round2, type Point, type Rect } from '../../geometry';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { markOutlineOff, separationStroke } from '../../markVisibility';
import { linePath } from '../../svgPath';
import type { Id } from '../../types/cell';
import type { AxisGeometry, LintWarning, SceneNode } from '../../types/scene';
import type { MekkoMarks } from './layout';
import { colCx, colW, colX, type MekkoArea, type MekkoDomain, type MekkoEnv, type MekkoMarkGeometry, type MekkoPaints, type SegmentPlace } from './model';
import { notApplicableGlyph } from '../../format';
import { emptyIdRecord } from '../../idRecords';

/** One column's stack, top to bottom: nodes, claims, edges and the drawn segments. */
function stackColumn(
  ci: number,
  input: { env: MekkoEnv; domain: MekkoDomain; area: MekkoArea; paints: MekkoPaints },
  out: Pick<MekkoMarkGeometry, 'nodes' | 'claims' | 'marks' | 'segEdges' | 'segments'>,
): void {
  const { env, domain, area, paints } = input;
  const { mode } = domain;
  const { y, y0 } = area;
  const c = domain.cats[ci]!;
  const bx = colX(area, ci);
  const bw = colW(area, ci);
  const visibleCol = bw >= 0.5;
  const segs: MekkoMarks['columns'][number]['segments'] = [];
  if (domain.invalidAt(ci)) {
    out.marks.columns.push({ categoryId: c.id, x: bx, w: bw, rect: { x: bx, y: y0, w: bw, h: 0.5 }, segments: segs });
    return;
  }
  let posCursor = 0;
  let negCursor = 0;
  const posSum = domain.posTop[ci]!;
  for (const si of domain.order[ci]!) {
    const s = domain.series[si]!;
    const val = s.vals[ci]!;
    const v = domain.plottedAt(s, ci);
    if (v === null) continue;
    let vTop: number;
    let vBot: number;
    if (v >= 0) {
      vTop = posSum - posCursor;
      vBot = vTop - v;
      posCursor += v;
    } else {
      vTop = negCursor;
      vBot = negCursor + v;
      negCursor = vBot;
    }
    out.segEdges.set(sk(s.id, c.id), { top: vTop, bot: vBot, v, abs: domain.absAt(s, ci) });
    if (v === 0 || !visibleCol) continue;
    const sy = y(vTop);
    const rect: Rect = { x: bx, y: sy, w: bw, h: Math.max(y(vBot) - sy, 0.5) };
    const nodeId = `mark:${s.id}:${c.id}`;
    const cellFill = paints.cell(s, val, c, si, v);
    const cellPat = paints.pattern(s, val);
    // MARK VISIBILITY (src/core/markVisibility.ts): the Others column paints
    // ALL THREE of its segments `others` (1.13-1.52:1 on the page, 6/6
    // presets), so the legend was false for the whole column and no boundary
    // showed where one band ended. A patterned cell already carries its own
    // stroke and is left alone.
    const cellSep = cellPat || markOutlineOff(cellFill, env.theme) ? undefined : separationStroke(paints.css(cellFill), env.theme.color.background, env.theme);
    out.nodes.push({
      t: 'rect',
      id: nodeId,
      rect,
      fill: cellFill,
      pattern: cellPat,
      ...(cellSep ?? {}),
      separation: { fill: cellFill, backing: { token: 'background' }, pattern: cellPat },
      owner: { seriesId: s.id, categoryId: c.id },
      part: mode === 'bar' ? 'bar' : 'segment',
      display: {
        value: (mode === 'percent' && env.options.rounding === 'sum-consistent' ? domain.shareTexts.get(`${c.id}\0${s.id}`) : undefined) ??
          ((val.format ?? s.format) ? formatterFromExample((val.format ?? s.format)!, env.options.locale?.language)(mode === 'percent' || val.isPct ? v : domain.absAt(s, ci)!) : val.isPct ? env.authoredPctFmt(v) : mode === 'percent' ? domain.shareTexts.get(`${c.id}\0${s.id}`) ?? env.pctFmt(v) : env.fmt(domain.absAt(s, ci)!)),
      },
    });
    out.claims.claim(rect, 'mark', { seriesId: s.id, categoryId: c.id });
    segs.push({ seriesId: s.id, rect, nodeId });
    out.segments.push({ s, si, ci, v, rect });
  }
  const colTop = y(Math.max(posSum, 0));
  const colBot = y(Math.min(negCursor, 0));
  out.marks.columns.push({
    categoryId: c.id,
    x: bx,
    w: bw,
    rect: { x: bx, y: colTop, w: bw, h: Math.max(colBot - colTop, 0.5) },
    segments: segs,
  });
  // The pooled Others column keeps its series fills and says it
  // is pooled with an ink outline; the note names its members.
  if (c.id === domain.othersId && segs.length > 0) {
    const { x, y: top, w, h } = { x: bx + 0.75, y: colTop + 0.75, w: Math.max(bw - 1.5, 0.5), h: Math.max(colBot - colTop - 1.5, 0.5) };
    const corners = [[x, top], [x + w, top], [x + w, top + h], [x, top + h], [x, top]] as const;
    corners.slice(1).forEach(([x2, y2], k) => {
      const [x1, y1] = corners[k]!;
      out.nodes.push({ t: 'line', id: `othersOutline:${c.id}:${k}`, x1, y1, x2, y2, stroke: { token: 'ink' }, width: strokeToken(env.theme, 'mark'), owner: { categoryId: c.id }, part: 'othersOutline' });
    });
  }
}

/** Percent mode: a suppressed column says why, with an n.m. or n/a glyph on the baseline. */
function suppressedGlyphs(env: MekkoEnv, domain: MekkoDomain, area: MekkoArea, nodes: SceneNode[], claims: OccupiedIndex): void {
  if (domain.mode !== 'percent') return;
  domain.cats.forEach((c, ci) => {
    const glyph = domain.nm.has(c.id) ? 'n.m.' : domain.na.has(c.id) ? notApplicableGlyph(env.options.strings) : null;
    // A zero-width column has no place of its own; its glyph would sit on a neighbour.
    if (!glyph || colW(area, ci) < 0.5) return;
    const glyphFont = { family: env.theme.type.family, ...env.theme.type.label };
    const glyphSize = env.measure(glyph, glyphFont);
    const cx = colCx(area, ci);
    const rect: Rect = { x: cx - glyphSize.width / 2, y: area.y0 - glyphSize.height - 6, w: glyphSize.width, h: glyphSize.height };
    nodes.push({
      t: 'text',
      id: `nm:${c.id}`,
      x: cx,
      y: rect.y,
      lines: [glyph],
      align: 'middle',
      font: glyphFont,
      ink: { token: 'inkMuted' },
      owner: { categoryId: c.id },
      part: 'nmMarker',
      typeRole: 'label',
      display: { state: glyph },
    });
    claims.claim(rect, 'label', { categoryId: c.id });
  });
}

/** Ridge: a bold outline tracing one series' top edge across all columns. */
function ridgeOutline(env: MekkoEnv, domain: MekkoDomain, area: MekkoArea, geometry: MekkoMarkGeometry, warnings: LintWarning[]): void {
  const ridge = env.options.ridge;
  if (!ridge) return;
  const rs = domain.series.find((s) => s.id === ridge);
  if (!rs) {
    warnings.push({ code: 'unknown-ridge', severity: 'warn', message: `ridge series '${ridge}' is not a plotted data series` });
    return;
  }
  const runs: Point[][] = [];
  let run: Point[] = [];
  domain.cats.forEach((c, ci) => {
    const e = geometry.segEdges.get(sk(rs.id, c.id));
    if (!e || colW(area, ci) < 0.5) {
      if (run.length > 1) runs.push(run);
      run = [];
      return;
    }
    const ry = area.y(e.top);
    run.push({ x: colX(area, ci), y: ry }, { x: colX(area, ci) + colW(area, ci), y: ry });
  });
  if (run.length > 1) runs.push(run);
  if (runs.length === 0) return;
  const ridgeId = `ridge:${rs.id}`;
  geometry.nodes.push({ t: 'path', id: ridgeId, d: runs.map((r) => linePath(r)).join(''), stroke: { token: 'markInk' }, width: strokeToken(env.theme, 'data'), owner: { seriesId: rs.id }, part: 'ridge' });
  geometry.marks.ridgeNodeId = ridgeId;
  // No occupied claim: the ridge lies exactly on segment edges already
  // claimed as marks — claiming it would spuriously block the ridge series'
  // own inside labels.
}

/** Phase 2: the plot area, scale and paints in, every mark in paint order out. */
export function layoutMekkoMarks(
  env: MekkoEnv,
  domain: MekkoDomain,
  area: MekkoArea,
  paints: MekkoPaints,
  warnings: LintWarning[],
): MekkoMarkGeometry {
  const { plot, y, y0 } = area;
  const geometry: MekkoMarkGeometry = {
    nodes: [],
    claims: createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height }),
    axes: [] as AxisGeometry[],
    marks: { columns: [] },
    segEdges: new Map(),
    segments: [] as SegmentPlace[],
    widths: emptyIdRecord(),
  };
  const { nodes, claims } = geometry;
  if (area.showAxis) {
    const axisResult = layoutValueAxis(
      { scale: y, plot, orient: 'y', gridlines: env.va.gridlines ?? false, format: area.axisFmt, theme: env.theme, measure: env.measure },
      claims,
    );
    nodes.push(...axisResult.nodes);
    geometry.axes.push(axisResult.axis);
  }
  domain.cats.forEach((c, ci) => {
    geometry.widths[c.id] = round2(colW(area, ci));
    if (colW(area, ci) < 0.5 && domain.anyByCat[ci]) {
      warnings.push({
        code: 'zero-weight-column',
        severity: 'warn',
        message: `category '${c.id}': zero width — column and its labels are suppressed`,
        owner: { categoryId: c.id },
      });
    }
  });
  // baseline (thin solid, always). The line is 1px of ink centred on y0;
  // claiming more than the ink pushes bottom-segment labels out by a fraction
  // (see insideCenterY).
  nodes.push({ t: 'line', id: 'axis:baseline', x1: plot.x, y1: y0, x2: plot.x + plot.w, y2: y0, stroke: { token: 'axis' }, width: strokeToken(env.theme, 'rule'), owner: {}, part: 'baseline' });
  claims.claim({ x: plot.x, y: y0 - 0.5, w: plot.w, h: 1 }, 'axis', {});
  domain.cats.forEach((_c, ci) => stackColumn(ci, { env, domain, area, paints }, geometry));
  // the baseline again ABOVE the cell fills, as column and bar draw it.
  nodes.push({ t: 'line', id: 'axis:baseline:over', x1: plot.x, y1: y0, x2: plot.x + plot.w, y2: y0, stroke: { token: 'axis' }, width: strokeToken(env.theme, 'rule'), owner: {}, part: 'baseline' });
  suppressedGlyphs(env, domain, area, nodes, claims);
  ridgeOutline(env, domain, area, geometry, warnings);
  // valueLine pre-claims (labels must never sit under the line), like column
  (env.options.annotations ?? []).forEach((ann, n) => {
    if (ann.kind !== 'valueLine') return;
    const annId: Id = ann.id ?? `valueLine-${n + 1}`;
    const v = ann.value === 'mean' || ann.value === undefined ? domain.meanValue : ann.value;
    if (v === undefined) return;
    claims.claim({ x: plot.x, y: y(v) - 1, w: plot.w, h: 2 }, 'annotation', { annotationId: annId });
  });
  return geometry;
}
