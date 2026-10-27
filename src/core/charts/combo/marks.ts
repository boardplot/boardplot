import { comboLineMarkers, inkLeadLine } from './plot';
import { sk } from '../band/stacks';
import type { Theme } from '../../types/theme';
import { strokeToken, dashToken, secondaryFont } from '../../theme';
/**
 * Combo phase 2: the scales in, scene nodes out. The value axes and
 * the baseline, one stacked column group per category, the reference ticks,
 * then areas under lines under markers, in paint order. Everything the phase
 * claims goes into an OccupiedIndex of its own, in claim order.
 */

import { sweepHide } from '../../collide';
import { layoutValueAxis } from '../../axis';
import { curvePathFromSegments, drawnStroke, monotoneSegments, splitCurveSegmentsAtX, type CurveSegment } from '../../curve';
import { formatterFromExample } from '../../formatSpec';
import { round2, type Rect } from '../../geometry';
import { screenEdges } from '../../label/areaGround';
import { AREA_FILL_PART } from '../../label/solver';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { markOutlineOff, segmentSeparationStroke } from '../../markVisibility';
import { defaultAnnotationId } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { AxisGeometry, Paint } from '../../types/scene';
import { markerPath, pathFor as linePathFor } from '../line/marks';
import { REFERENCE_MARKER_R, referenceCasing, referenceMarkerPaint, referenceTickGeometry } from '../band/ticks';
import { primaryLineMean } from './domain';
import type { ComboMarks } from './layout';
import { MARKER_R, type ComboArea, type ComboDomain, type ComboEnv, type ComboMarkGeometry, type ComboPaints, type LinePlan, type NormSer } from './model';

import type { LineInterpolation } from '../../types/options';
import { minOf, pushAll } from '../../arrays';

interface MarkCtx {
  env: ComboEnv;
  domain: ComboDomain;
  area: ComboArea;
  paints: ComboPaints;
  g: ComboMarkGeometry;
}

/** The primary axis, the right-hand ticks at the SAME pixel rows as the primary ticks, and the baseline. */
function comboAxes(ctx: MarkCtx): void {
  const { env, domain, area, g } = ctx;
  const { plot, y, y0 } = area;
  // Value ticks are secondary text, on the right axis as on the left.
  const tickFont = secondaryFont(env.theme);
  const { nodes, claims } = g;
  let primaryDrawn: Set<number> | undefined;
  if (domain.showPrimaryAxis) {
    const axisResult = layoutValueAxis(
      { scale: y, plot, orient: 'y', gridlines: domain.options.valueAxis?.gridlines ?? domain.anatomy, format: domain.fmt, formatSpec: domain.valueSpec, theme: env.theme, measure: env.measure, ticks: domain.pticks },
      claims,
    );
    pushAll(nodes, axisResult.nodes);
    g.axes.push(axisResult.axis);
    primaryDrawn = new Set(axisResult.axis.ticks.flatMap((t) => (typeof t.at === 'number' ? [t.at] : [])));
    g.leftTickX = minOf(axisResult.nodes.map((node) => (node.t === 'text' ? node.x : Infinity)));
  }
  // layoutValueAxis is left-side only: the right-hand ticks emit here.
  if (domain.rightTicks.length > 0) {
    const axis2: AxisGeometry = { axis: 'y', ticks: [] };
    // A right-side valueLine label on the secondary scale that says what a
    // tick says may take that tick's place: the Pareto "80%" on the 80% row
    // would otherwise collide with the tick's claim and be hidden. The tick
    // is claimed in the label's name, which only that label may overlap, and
    // gives way after the annotation pass only if the label was drawn on it.
    const replacing = domain.secondaryDomain
      ? (domain.options.annotations ?? []).filter((a) => a.kind !== 'event').flatMap((a, n) =>
          a.kind === 'valueLine' && a.axis === 'secondary' && (a.side ?? 'right') === 'right' && typeof a.value === 'number' && typeof a.label === 'string'
            ? [{ id: defaultAnnotationId(a, n), value: a.value, text: a.label }] : [])
      : [];
    // thin the secondary ticks at their measured height, like the primary axis.
    const synced = domain.rightTicks.length === domain.pticks.length && domain.rightTicks.every(({ at }, i) =>
      Math.abs((domain.secondaryDomain ? area.y2(at) : y(domain.pticks[i]!)) - y(domain.pticks[i]!)) < 0.5);
    // Synced ticks share the primary rows, so they draw exactly the rows the primary axis kept (twin axes in lockstep).
    const lockstep = primaryDrawn !== undefined && synced;
    let keep = lockstep ? domain.rightTicks.map((_, i) => primaryDrawn!.has(domain.pticks[i]!))
      : sweepHide(domain.rightTicks.map(({ at, text }, i) => {
        const h = env.measure(text, tickFont).height;
        const pos = domain.secondaryDomain ? area.y2(at) : y(domain.pticks[i]!);
        return { start: pos - h / 2, size: h, priority: i === 0 || i === domain.rightTicks.length - 1 ? 1 : 0 };
      }), 4);
    // An unpinned secondary lattice uses the primary's drawn rows, after thinning.
    if (lockstep) {
      // Already in step with the primary rows.
    } else if (domain.secondaryDomain && !(domain.options.secondaryAxis as { domain?: unknown } | undefined)?.domain && domain.showPrimaryAxis) {
      keep = domain.rightTicks.map(({ at }) => g.axes[0]!.ticks.some(tick => Math.abs(tick.pos - area.y2(at)) < 0.01));
    } else if (!domain.options.secondaryAxis || !(domain.options.secondaryAxis as { domain?: unknown }).domain) {
      for (let stride = 1; stride <= keep.length; stride++) {
        const selected = keep.map((_, i) => i % stride === 0);
        const rows = domain.rightTicks.filter((_, i) => selected[i]).map(({ at, text }, i) => {
          const pos = domain.secondaryDomain ? area.y2(at) : y(domain.pticks[i * stride]!);
          const h = env.measure(text, tickFont).height;
          return { start: pos - h / 2, size: h, priority: 0 };
        });
        if (sweepHide(rows, 4).every(Boolean)) { keep = selected; break; }
      }
    }
    domain.rightTicks.forEach(({ at: tv, text }, i) => {
      if (!keep[i]) return;
      // A secondary scale places its own rows; the ruler relabels the primary's.
      const pos = domain.secondaryDomain ? area.y2(tv) : y(domain.pticks[i]!);
      const tsize = env.measure(text, tickFont);
      const rect: Rect = { x: area.rightTickX, y: pos - tsize.height / 2, w: tsize.width, h: tsize.height };
      const labelId = `axis:y2:tick:${i}`;
      nodes.push({ t: 'text', id: labelId, x: rect.x, y: rect.y, lines: [text], align: 'start', typeRole: 'secondary', font: tickFont, ink: { token: 'inkMuted' }, owner: {}, part: 'tick' });
      const by = replacing.find((r) => r.text === text && Math.abs(r.value - tv) < 1e-9);
      if (by) {
        claims.claim(rect, 'annotation', { annotationId: by.id });
        g.yieldingTicks.push({ labelId, annotationId: by.id, rect });
      } else {
        claims.claim(rect, 'axis', {});
      }
      axis2.ticks.push({ at: tv, pos, labelId });
    });
    g.axes.push(axis2);
  }
  // baseline (thin solid, always). The line is 1px of ink centred on y0;
  // claiming more than the ink pushes bottom-segment labels out by a
  // fraction (see insideCenterY).
  nodes.push({ t: 'line', id: 'axis:baseline', x1: plot.x, y1: y0, x2: plot.x + plot.w, y2: y0, stroke: { token: 'axis' }, width: strokeToken(env.theme, 'rule'), owner: {}, part: 'baseline' });
  claims.claim({ x: plot.x, y: y0 - 0.5, w: plot.w, h: 1 }, 'axis', {});
}

/** One stacked group per category, then the reference series as plan ticks, dashed lines or markers (never bars). */
function columnMarks(ctx: MarkCtx): void {
  const { env, domain, area, paints, g } = ctx;
  const { cats, columns, refs } = domain;
  const { band, y } = area;
  const { nodes, claims } = g;
  if (columns.length > 0) {
    cats.forEach((c, ci) => {
      const bx = band.position(ci);
      const bw = band.bandwidth;
      let pos = 0;
      let neg = 0;
      const segs: ComboMarks['columns'][number]['segments'] = [];
      columns.forEach((s, si) => {
        const val = s.vals[ci]!;
        const v = val.v;
        if (v === null) return;
        const v0 = v >= 0 ? pos : neg;
        const v1 = v0 + v;
        if (v >= 0) pos = v1;
        else neg = v1;
        g.segEdges.set(sk(s.id, c.id), { v0, v1, v });
        if (v === 0) return;
        const rect: Rect = { x: bx, y: y(Math.max(v0, v1)), w: bw, h: Math.max(Math.abs(y(v0) - y(v1)), 0.5) };
        const nodeId = `mark:${s.id}:${c.id}`;
        const cellFill = paints.cell(s, val, c, si);
        const cellPat = paints.pattern(s, val, c);
        // MARK VISIBILITY (src/core/markVisibility.ts), TWIN of mekko's cell
        // emit and bar/column's emitBar. Reachable here via
        // `series.colorRole:'others'` (1.13-1.52:1 in 6/6 presets); combo has
        // no topN path of its own. A patterned cell carries its own stroke.
        // A column the theme washed with `marks.comboColumnTint`
        // is quiet by design and takes no separation outline, in any scheme.
        const washed = 'tint' in cellFill && cellFill.tint !== undefined;
        const cellSep = cellPat || washed || markOutlineOff(cellFill, env.theme) ? undefined
          : segmentSeparationStroke(cellFill, env.theme.color.background, env.theme);
        nodes.push({
          t: 'rect',
          id: nodeId,
          rect,
          fill: cellFill,
          pattern: cellPat,
          ...(cellSep ?? {}),
          ...(washed ? {} : { separation: { fillStep: true as const, fill: cellFill, backing: { token: 'background' as const }, pattern: cellPat } }),
          owner: { seriesId: s.id, categoryId: c.id },
          part: 'segment',
          display: { value: (val.format ?? s.format ?? domain.options.format) ? env.byExample((val.format ?? s.format ?? domain.options.format)!)(v) : val.isPct ? domain.pctFmt(v) : domain.fmt(v) },
        });
        claims.claim(rect, 'mark', { seriesId: s.id, categoryId: c.id }, 'segment');
        segs.push({ seriesId: s.id, rect, nodeId });
        g.segments.push({ s, si, ci, v, rect });
      });
      const stackTop = y(pos);
      const stackBot = y(neg);
      g.marks.columns.push({ categoryId: c.id, rect: { x: bx, y: stackTop, w: bw, h: Math.max(stackBot - stackTop, 0.5) }, segments: segs });
    });
    // the baseline again ABOVE the column fills, as column and bar draw it.
    const { plot, y0 } = area;
    nodes.push({ t: 'line', id: 'axis:baseline:over', x1: plot.x, y1: y0, x2: plot.x + plot.w, y2: y0, stroke: { token: 'axis' }, width: strokeToken(env.theme, 'rule'), owner: {}, part: 'baseline' });
  }
  // referenceStyle and referenceTick mean what they mean on bar and column.
  const style = domain.options.referenceStyle ?? 'tick';
  for (const s of refs) {
    cats.forEach((c, ci) => {
      const v = s.vals[ci]!.v;
      if (v === null) return;
      const ry = y(v);
      const bx = band.position(ci);
      const bw = band.bandwidth;
      const owner = { seriesId: s.id, categoryId: c.id };
      const id = `ref:${s.id}:${c.id}`;
      const display = { value: (s.vals[ci]!.format ?? s.format ?? domain.options.format) ? formatterFromExample((s.vals[ci]!.format ?? s.format ?? domain.options.format)!, domain.options.locale?.language)(v) : s.vals[ci]!.isPct ? domain.pctFmt(v) : domain.fmt(v) };
      if (style === 'marker') {
        const cx = band.center(ci);
        // The page-colour ring the combo line markers carry keeps the dot legible on a dark column.
        nodes.push({ t: 'circle', id, cx, cy: ry, ...referenceMarkerPaint(env.theme, paints.ref(s)), owner, part: 'referenceMarker', display });
        const mr = REFERENCE_MARKER_R + 1;
        claims.claim({ x: cx - mr, y: ry - mr, w: mr * 2, h: mr * 2 }, 'mark', owner);
        return;
      }
      const tick = referenceTickGeometry('vertical', bx, ry, -2, bw + 2);
      const tickWidth = style === 'line' ? strokeToken(env.theme, 'rule') : domain.options.referenceTick?.width ?? strokeToken(env.theme, 'rule');
      nodes.push(referenceCasing(id, tick.line, tickWidth, owner));
      nodes.push({
        t: 'line',
        id,
        ...tick.line,
        stroke: paints.ref(s),
        width: tickWidth,
        ...(style === 'line' ? { dash: dashToken(env.theme, 'dotted'), lineCap: 'round' as const } : {}),
        owner,
        part: style === 'line' ? 'referenceLine' : 'referenceTick',
        display,
      });
      // A reference drawn as a line is one a highlighted value may cross.
      claims.claim(tick.claim, 'mark', owner, style === 'line' ? 'referenceLine' : undefined);
    });
  }
}

function pathFor(points: readonly { x: number; y: number }[], interpolation: LineInterpolation, curve: readonly CurveSegment[] = []): string {
  return interpolation === 'monotone' ? curvePathFromSegments(curve) : linePathFor(points, interpolation);
}

/** Each line series' points and drawable runs; a series with no plotted point is dropped. */
function linePlans(domain: ComboDomain, area: ComboArea): LinePlan[] {
  const { cats, secondaryActive } = domain;
  return domain.lines
    .map((s, li) => {
      const yFor = s.axis === 'secondary' && secondaryActive ? area.y2 : area.y;
      const pts: LinePlan['pts'] = [];
      const runs: LinePlan['runs'] = [];
      let run: LinePlan['pts'] = [];
      cats.forEach((_c, ci) => {
        const v = s.vals[ci]!.v;
        if (v === null) {
          if (!s.interpolateGaps && run.length > 0) {
            runs.push(run);
            run = [];
          }
          return;
        }
        const p = { ci, x: area.band.center(ci), y: yFor(v) };
        pts.push(p);
        run.push(p);
      });
      if (run.length > 0) runs.push(run);
      const interpolation = domain.interpolationFor(s);
      const drawableRuns = s.interpolateGaps ? [pts] : runs;
      return {
        s,
        li,
        interpolation,
        pts,
        runs: drawableRuns,
        curveRuns: interpolation === 'monotone' ? drawableRuns.map((drawableRun) => monotoneSegments(drawableRun)) : [],
      };
    })
    .filter((p) => p.pts.length > 0);
}

/** Areas (fill to baseline) under all lines; claims per-segment trapezoid bounding boxes down to the baseline. */
function areaMarks(ctx: MarkCtx, plans: LinePlan[]): Map<LinePlan, Id> {
  const { domain, area, paints, g } = ctx;
  const areaIds = new Map<LinePlan, Id>();
  for (const plan of plans) {
    if (plan.s.kind !== 'area') continue;
    const y0 = plan.s.axis === 'secondary' && domain.secondaryActive ? area.y2(0) : area.y0;
    const d = plan.runs
      .filter((r) => r.length > 0)
      .map((r, runIndex) => {
        const top = pathFor(r, plan.interpolation, plan.curveRuns[runIndex]);
        const first = r[0]!;
        const last = r[r.length - 1]!;
        return `${top}L${round2(last.x)} ${round2(y0)}L${round2(first.x)} ${round2(y0)}Z`;
      })
      .join('');
    const areaNodeId = `mark:area:${plan.s.id}`;
    g.nodes.push({ t: 'path', id: areaNodeId, d, fill: paints.line(plan.s, plan.li), owner: { seriesId: plan.s.id }, part: 'area' });
    for (const r of plan.runs) {
      if (r.length > 1) g.areaGrounds.push({ seriesId: plan.s.id, ...screenEdges(drawnStroke(r, plan.interpolation), [{ x: r[0]!.x, y: y0 }, { x: r[r.length - 1]!.x, y: y0 }]), paint: paints.line(plan.s, plan.li) });
    }
    for (const r of plan.runs) {
      for (let i = 0; i + 1 < r.length; i++) {
        const a = r[i]!;
        const b = r[i + 1]!;
        const top = Math.min(a.y, b.y, y0);
        const bot = Math.max(a.y, b.y, y0);
        // Each half of a stretch belongs to the category at its end, so
        // the value at either end may sit on the fill beside its point.
        const half = (b.x - a.x) / 2;
        for (const [x, ci] of [[a.x, a.ci], [a.x + half, b.ci]] as const) {
          g.claims.claim({ x, y: top, w: half, h: Math.max(bot - top, 3) }, 'mark', { seriesId: plan.s.id, categoryId: domain.cats[ci]!.id }, AREA_FILL_PART);
        }
      }
    }
    areaIds.set(plan, areaNodeId);
  }
  return areaIds;
}

/** A line's claims: its runs as slices, so one bounding box never over-claims the corners of steep segments. */
function claimLine(claims: OccupiedIndex, plan: LinePlan, catId: (ci: number) => Id): void {
  const { s, runs, interpolation } = plan;
  for (const r of runs) {
    for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i]!;
      const b = r[i + 1]!;
      const owner = { seriesId: s.id, categoryId: catId(a.ci) };
      if (interpolation === 'monotone') {
        claims.claim({ x: a.x, y: Math.min(a.y, b.y) - 1.5, w: b.x - a.x, h: Math.abs(b.y - a.y) + 3 }, 'mark', owner);
        continue;
      }
      const claimPoints =
        interpolation === 'linear'
          ? [a, b]
          : [a, interpolation === 'step-after' ? { ci: a.ci, x: b.x, y: a.y } : { ci: a.ci, x: a.x, y: b.y }, b];
      // Chunk the diagonal into slices — one bounding box over-claims the
      // corners of steep segments and starves labels near column tops.
      for (let pair = 0; pair + 1 < claimPoints.length; pair++) {
        const from = claimPoints[pair]!;
        const to = claimPoints[pair + 1]!;
        const slices = 6;
        for (let k = 0; k < slices; k++) {
          const t0 = k / slices;
          const t1 = (k + 1) / slices;
          const sy0 = from.y + (to.y - from.y) * t0;
          const sy1 = from.y + (to.y - from.y) * t1;
          claims.claim(
            {
              x: Math.min(from.x + (to.x - from.x) * t0, from.x + (to.x - from.x) * t1),
              y: Math.min(sy0, sy1) - 1.5,
              w: Math.max(Math.abs(((to.x - from.x) * 1) / slices), 1),
              h: Math.abs(sy1 - sy0) + 3,
            },
            'mark',
            owner,
          );
        }
      }
    }
  }
}

/**
 * The anatomy's point dot, 3px, with a page-colour ring of the mark stroke:
 * the ring keeps the dot apart from the line and from a dark column behind it.
 */
const ANATOMY_DOT_R = 3;

/** The latest-point ring, as the line chart draws it: on a theme's ink lead line, or where options.latestPoint asks. */
function latestPointRing(theme: Theme, g: MarkCtx['g'], s: NormSer, point: LinePlan['pts'][number] | undefined, cats: ComboDomain['cats']): void {
  if (point === undefined) return;
  const owner = { seriesId: s.id, categoryId: cats[point.ci]!.id };
  g.nodes.push({ t: 'circle', id: `latest-ring:${s.id}`, cx: point.x, cy: point.y, r: 4.5, fill: { token: 'background' }, stroke: { token: 'highlight' }, strokeWidth: strokeToken(theme, 'mark'), owner, part: 'marker' });
  g.nodes.push({ t: 'circle', id: `latest-dot:${s.id}`, cx: point.x, cy: point.y, r: 2, fill: { token: 'markInk' }, owner, part: 'marker' });
  g.claims.claim({ x: point.x - 4.5, y: point.y - 4.5, w: 9, h: 9 }, 'mark', owner);
}

/**
 * The series `latestPoint: 'ring'` rings, as the line chart picks it: the
 * first line series that is not a prior year, a plan or a forecast, else the
 * first line series.
 */
function ringedSeries(plans: LinePlan[]): Id | undefined {
  const lines = plans.filter((p) => p.s.kind === 'line');
  return (lines.find((p) => p.s.scenario === undefined || p.s.scenario === 'AC') ?? lines[0])?.s.id;
}

/** One line: a solid and a forecast path, each over a background casing, then its claims and markers. */
function lineMark(ctx: MarkCtx, plan: LinePlan, areaNodeId: Id | undefined, ringed: Id | undefined): void {
  const { env, domain, paints, g } = ctx;
  const { s, li, pts, runs, interpolation } = plan;
  const { cats } = domain;
  const paint = paints.line(s, li);
  const solidRuns: { points: LinePlan['runs'][number]; curve: CurveSegment[] }[] = [];
  const forecastRuns: { points: LinePlan['runs'][number]; curve: CurveSegment[] }[] = [];
  for (const [runIndex, run] of runs.entries()) {
    let solidCurve = plan.curveRuns[runIndex] ?? [];
    let forecastCurve: CurveSegment[] = [];
    const fcStart = s.scenario === 'FC' ? 0 : run.findIndex((point) => s.vals[point.ci]!.scenario === 'FC');
    if (fcStart === -1) {
      solidRuns.push({ points: run, curve: solidCurve });
    } else if (fcStart === 0) {
      forecastRuns.push({ points: run, curve: solidCurve });
    } else {
      if (interpolation === 'monotone') [solidCurve, forecastCurve] = splitCurveSegmentsAtX(solidCurve, run[fcStart - 1]!.x);
      solidRuns.push({ points: run.slice(0, fcStart), curve: solidCurve });
      forecastRuns.push({ points: run.slice(fcStart - 1), curve: forecastCurve });
    }
  }
  const drawable = (list: typeof solidRuns) => list
    .filter((run) => (interpolation === 'monotone' ? run.curve.length > 0 : run.points.length > 1))
    .map((run) => pathFor(run.points, interpolation, run.curve))
    .join('');
  const d = drawable(solidRuns);
  const fcD = drawable(forecastRuns);
  const nodeId = `mark:line:${s.id}`;
  const fcNodeId = `mark:line:${s.id}:fc`;

  const inkLead = inkLeadLine(env, s, li);
  const lineWidth = paints.lineWidth(s, li);
  // The shared casing keeps the line clear where it crosses columns.
  const casingWidth = strokeToken(env.theme, 'casing');
  const emitLine = (path: string, id: Id, forecast: boolean): void => {
    if (!path) return;
    g.nodes.push({ t: 'path', id: forecast ? `casing:line:${s.id}:fc` : `casing:line:${s.id}`, d: path, stroke: { token: 'background' }, width: casingWidth, owner: { seriesId: s.id }, part: 'lineCasing', ...(domain.columns.length > 0 ? { overFills: true as const } : {}) });
    const dash = forecast ? dashToken(env.theme, 'reference') : paints.dash(s);
    g.nodes.push({ t: 'path', id, d: path, stroke: paint, width: lineWidth, dash, lineCap: dash?.join(',') === dashToken(env.theme, 'dotted').join(',') ? 'round' : 'butt', owner: { seriesId: s.id }, part: 'line' });
    if (paints.lineHollow(s)) g.nodes.push({
      t: 'path', id: `${id}:inner`, d: path, stroke: { token: 'background' }, width: strokeToken(env.theme, 'hair'),
      dash, lineCap: dash?.join(',') === dashToken(env.theme, 'dotted').join(',') ? 'round' : 'butt', owner: { seriesId: s.id }, part: 'lineInterior',
    });
  };
  emitLine(d, nodeId, false);
  emitLine(fcD, fcNodeId, true);
  claimLine(g.claims, plan, (ci) => cats[ci]!.id);
  const { shape: markerShape, anatomyDots, full } = comboLineMarkers(env, domain, s);
  const markPoints: ComboMarks['lines'][number]['points'] = [];
  for (const p of pts) {
    const c = cats[p.ci]!;
    let markerNodeId: string | undefined;
    if (markerShape !== 'none' && (full || c.partial === true)) {
      markerNodeId = `marker:${s.id}:${c.id}`;
      // A partial period draws its marker hollow; position and size stay.
      const hollow = c.partial === true || paints.lineHollow(s);
      const markerFill: Paint = hollow ? { token: 'background' } : paint;
      const owner = { seriesId: s.id, categoryId: c.id };
      const value = s.vals[p.ci]!;
      const example = domain.explicitFormatOf(s, value);
      const display = { value: example ? env.byExample(example)(value.v!) : value.isPct ? domain.pctFmt(value.v!) : domain.scaleFmtOf(s)(value.v!) };
      g.nodes.push(anatomyDots && !hollow
        ? { t: 'circle', id: markerNodeId, cx: p.x, cy: p.y, r: ANATOMY_DOT_R, fill: markerFill, stroke: { token: 'background' }, strokeWidth: strokeToken(env.theme, 'mark'), owner, part: 'marker', display }
        : markerShape === 'square'
        ? { t: 'rect', id: markerNodeId, rect: { x: p.x - MARKER_R, y: p.y - MARKER_R, w: MARKER_R * 2, h: MARKER_R * 2 }, fill: markerFill, ...(hollow ? { stroke: paint, strokeWidth: strokeToken(env.theme, 'mark') } : {}), owner, part: 'marker', display }
        // the triangle and diamond line draws.
        : markerShape === 'triangle' || markerShape === 'diamond'
        ? { t: 'path', id: markerNodeId, d: markerPath(markerShape, p), fill: markerFill, ...(hollow ? { stroke: paint, width: strokeToken(env.theme, 'mark') } : {}), owner, part: 'marker', display }
        : { t: 'circle', id: markerNodeId, cx: p.x, cy: p.y, r: MARKER_R, fill: markerFill, stroke: hollow ? paint : { token: 'background' }, strokeWidth: strokeToken(env.theme, 'mark'), owner, part: 'marker', display });
      // A hollow triangle or diamond adds half the mark stroke to its reach.
      const claimR = markerShape === 'triangle' || markerShape === 'diamond' ? 4 + (hollow ? strokeToken(env.theme, 'mark') / 2 : 0) : MARKER_R + 1;
      g.claims.claim({ x: p.x - claimR, y: p.y - claimR, w: claimR * 2, h: claimR * 2 }, 'mark', { seriesId: s.id, categoryId: c.id });
    }
    markPoints.push({ categoryId: c.id, x: p.x, y: p.y, markerNodeId });
  }
  // The ring marks the last observed point: never a forecast or plan one.
  // An authored latestPoint decides; without it the theme's ink lead line does.
  const latest = domain.options.latestPoint;
  if (latest === undefined ? inkLead : latest === 'ring' && s.id === ringed) {
    latestPointRing(env.theme, g, s, pts.filter((p) => {
      const scenario = s.vals[p.ci]!.scenario ?? s.scenario;
      return scenario !== 'FC' && scenario !== 'PL';
    }).pop(), cats);
  }
  g.marks.lines.push({
    seriesId: s.id,
    kind: s.kind === 'area' ? 'area' : 'line',
    axis: s.axis === 'secondary' && domain.secondaryActive ? 'secondary' : 'primary',
    nodeId: d ? nodeId : fcNodeId,
    ...(fcD ? { fcNodeId } : {}),
    areaNodeId,
    points: markPoints,
  });
}

/** Phase 2: the plot area, scales and paints in, every mark in paint order out. */
export function layoutComboMarks(env: ComboEnv, domain: ComboDomain, area: ComboArea, paints: ComboPaints): ComboMarkGeometry {
  const g: ComboMarkGeometry = {
    nodes: [],
    claims: createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height }),
    axes: [],
    leftTickX: Infinity,
    marks: { columns: [], lines: [] },
    segEdges: new Map(),
    yieldingTicks: [],
    areaGrounds: [],
    segments: [],
    plans: [],
    meanValue: undefined,
  };
  const ctx: MarkCtx = { env, domain, area, paints, g };
  comboAxes(ctx);
  const columnStart = g.nodes.length;
  columnMarks(ctx);
  g.plans = linePlans(domain, area);
  const areaStart = g.nodes.length;
  const areaIds = areaMarks(ctx, g.plans);
  // An area draws behind the columns, as a backdrop: an opaque fill over them
  // would hide their values. The lines draw over both.
  g.nodes.splice(columnStart, 0, ...g.nodes.splice(areaStart));
  const ringed = domain.options.latestPoint === 'ring' ? ringedSeries(g.plans) : undefined;
  for (const plan of g.plans) lineMark(ctx, plan, areaIds.get(plan), ringed);
  // valueLine pre-claims (same trick as column): labels never sit under the line
  const { cats, columns, posTop, negBot } = domain;
  // a column stack whose parts do not add has no mean.
  g.meanValue = !domain.columnsAdd ? undefined : domain.sourceMean ?? (
    columns.length > 0 && cats.length > 0
      ? cats.reduce((a, _, ci) => a + posTop[ci]! + negBot[ci]!, 0) / cats.length
      : primaryLineMean(g.plans, domain.secondaryActive));
  (domain.options.annotations ?? []).forEach((ann, n) => {
    if (ann.kind !== 'valueLine') return;
    const annId = ann.id ?? `valueLine-${n + 1}`;
    const v = ann.value === 'mean' || ann.value === undefined ? g.meanValue : ann.value;
    if (v === undefined) return;
    // Every rule is claimed as column claims it, so a total may cross it on a halo (labels.ts).
    // A secondary-axis rule lies where the secondary scale puts it; the primary scale would claim an unrelated row.
    const ry = ann.axis === 'secondary' && domain.secondaryDomain ? area.y2(v) : area.y(v);
    g.claims.claim({ x: area.plot.x, y: ry - 1, w: area.plot.w, h: 2 }, 'annotation', { annotationId: annId },
      'referenceLine');
  });
  return g;
}
