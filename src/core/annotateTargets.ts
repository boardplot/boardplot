/**
 * Plan corridors, tolerance bands and attainment shading. Geometry lives here;
 * runAnnotatePass only dispatches. Value mapping reuses the chart scale already
 * supplied for valueLine. Missing anchors stay missing.
 */
import { formatAutomaticNumber, formatAutomaticPercent } from './format';
import { autoDecimals } from './formatPrecision';
import { formatterFromExample } from './formatSpec';
import { rectsOverlap, type Rect } from './geometry';
import { PRIORITY, type LabelRequest, type SlotCandidate } from './label/solver';
import type { OccupiedIndex } from './label/occupied';
import { arrowHeadPath } from './svgPath';
import { chartString } from './strings/a11y-valueLineRecords';
import { strokeToken, dashToken, signedFillPaint } from './theme';
import type { TextMeasurer } from './text';
import type { AnchorRef, Annotation } from './types/annotations';
import type { Direction, Id, Scenario } from './types/cell';
import type {
  AnnotationDerivation,
  LintWarning,
  OccupiedRect,
  Paint,
  PlacedAnnotation,
  SceneNode,
} from './types/scene';
import type { StringsSpec } from './types/options';
import type { Theme } from './types/theme';
import { isCategoryAlongY, type CategoryBand } from './annotateFields';
import { valuelessFix } from './stackAdds';
import { minOf, pushAll } from './arrays';







function clipRect(rect: Rect, plot: Rect): Rect | null {
  const x = Math.max(rect.x, plot.x);
  const y = Math.max(rect.y, plot.y);
  const x2 = Math.min(rect.x + rect.w, plot.x + plot.w);
  const y2 = Math.min(rect.y + rect.h, plot.y + plot.h);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

export interface TargetScaleInput {
  yScale?: (v: number) => number;
  xScale?: (v: number) => number;
  bandPlot?: Rect;
  plot: Rect;
  /** Fixed header/ceiling rects that do not shift down when BAND_PAD increases. */
  ceilingRects?: readonly Rect[];
  resolveCategoryBand?: (categoryId: Id) => CategoryBand | null;
  /** On a continuous axis, where a band edge is an exact x: the slot of one drawn period, null at an x no period is drawn at. */
  resolvePeriodSlot?: (categoryId: Id) => CategoryBand | null;
  categoryIds?: Id[];
  resolve(ref: AnchorRef): { value: number; noValue?: string } | null;
  occupied: OccupiedIndex;
  theme: Theme;
  measure: TextMeasurer;
  /** The chart's language for the attainment percent. */
  locale?: string;
  /** The chart's number format, for the bounds a band prints. */
  format?: string;
  /** Caller wording, so a band's range words match its hover card. */
  strings?: StringsSpec;
}

export function isCeilingClaim(o: OccupiedRect, ceilingRects?: readonly Rect[]): boolean {
  if (o.kind === 'frame' || o.kind === 'legend' || o.part === 'axisTitle' || o.part === 'axis:y:title') return true;
  if (o.kind === 'label' && ceilingRects?.some((r) => rectsOverlap(o.rect, r, 1))) return true;
  return false;
}

export function valueMapper(
  input: Pick<TargetScaleInput, 'yScale' | 'xScale'>,
): { scale: (v: number) => number; axis: 'x' | 'y' } | null {
  if (input.yScale) return { scale: input.yScale, axis: 'y' };
  if (input.xScale) return { scale: input.xScale, axis: 'x' };
  return null;
}

export function categorySpanRect(
  from: CategoryBand,
  to: CategoryBand,
  plot: Rect,
): Rect {
  if (isCategoryAlongY(from) && isCategoryAlongY(to)) {
    const y0 = Math.min(from.y, to.y);
    const y1 = Math.max(from.y + from.h, to.y + to.h);
    return { x: plot.x, y: y0, w: plot.w, h: Math.max(y1 - y0, 0) };
  }
  const a = from as { x: number; w: number };
  const b = to as { x: number; w: number };
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  return { x: x0, y: plot.y, w: Math.max(x1 - x0, 0), h: plot.h };
}

function valueBandRect(
  span: Rect,
  low: number,
  high: number,
  mapper: { scale: (v: number) => number; axis: 'x' | 'y' },
  plot: Rect,
): Rect | null {
  const a = mapper.scale(low);
  const b = mapper.scale(high);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const rect =
    mapper.axis === 'y'
      ? { x: span.x, y: Math.min(a, b), w: span.w, h: Math.abs(b - a) }
      : { x: Math.min(a, b), y: span.y, w: Math.abs(b - a), h: span.h };
  return clipRect(rect, plot);
}

export function valueLineStroke(
  plot: Rect,
  valuePx: number,
  axis: 'x' | 'y',
): { x1: number; y1: number; x2: number; y2: number } {
  if (axis === 'x') {
    return { x1: valuePx, y1: plot.y, x2: valuePx, y2: plot.y + plot.h };
  }
  return { x1: plot.x, y1: valuePx, x2: plot.x + plot.w, y2: valuePx };
}

function finitePair(low: unknown, high: unknown): { low: number; high: number } | null {
  if (typeof low !== 'number' || typeof high !== 'number') return null;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low === high) return null;
  return { low, high };
}

function pushWarn(
  warnings: LintWarning[],
  id: Id,
  code: string,
  message: string,
): void {
  warnings.push({ code, severity: 'warn', message, owner: { annotationId: id } });
}

function idsInSpan(ids: Id[], from?: Id, to?: Id): Id[] | string {
  if (from === undefined && to === undefined) return ids;
  if (from === undefined || to === undefined) {
    return "a category span needs both 'from' and 'to' (inclusive, like band)";
  }
  const i = ids.indexOf(from);
  const j = ids.indexOf(to);
  if (i < 0 || j < 0) return 'unresolvable category span';
  const a = Math.min(i, j);
  const b = Math.max(i, j);
  return ids.slice(a, b + 1);
}

/** The wash between a plan corridor's edges. */
const PLAN_CORRIDOR_TINT = 0.72;

function scenarioPaint(scenario: Scenario | undefined): {
  fill: Paint;
  pattern?: 'hatch45' | 'outline';
  stroke?: Paint;
  strokeWidth?: number;
} {
  const used = scenario ?? 'PL';
  if (used === 'PL') {
    return {
      // Outline renderers use fill as the border ink and supply the background.
      fill: { token: 'ink' },
      pattern: 'outline',
    };
  }
  if (used === 'FC') return { fill: { token: 'others' }, pattern: 'hatch45' };
  if (used === 'PY') return { fill: { token: 'neutralLight' } };
  return { fill: { token: 'others' } };
}

export interface EraBandPlan {
  annotationId: Id;
  labelId: Id;
  text: string;
  noteText: string;
  font: { family: string; size: number; weight: number; lineHeight?: number };
  priority: number;
  rect: Rect;
  bandPlot: Rect;
  style: 'shade' | 'bracket';
  bracketY?: number;
  baseCandidates: SlotCandidate[];
}

interface TargetPassCtx {
  input: TargetScaleInput;
  id: Id;
  nid: (part: string) => Id;
  nodes: SceneNode[];
  placed: PlacedAnnotation[];
  labelRequests: LabelRequest[];
  warnings: LintWarning[];
  bandSpans: { id: Id; rect: Rect }[];
  eraBands?: EraBandPlan[];
}

function overlapBand(ctx: TargetPassCtx, rect: Rect): void {
  for (const prior of ctx.bandSpans) {
    const overlap =
      Math.min(rect.x + rect.w, prior.rect.x + prior.rect.w) - Math.max(rect.x, prior.rect.x);
    const yOverlap =
      Math.min(rect.y + rect.h, prior.rect.y + prior.rect.h) - Math.max(rect.y, prior.rect.y);
    if (overlap > 0 && yOverlap > 0) {
      ctx.warnings.push({
        code: 'band-overlap',
        severity: 'warn',
        message: `band '${ctx.id}' overlaps band '${prior.id}'`,
        owner: { annotationId: ctx.id },
      });
    }
  }
  ctx.bandSpans.push({ id: ctx.id, rect });
}

function corridorLabel(
  ctx: TargetPassCtx,
  ann: Extract<Annotation, { kind: 'band' }>,
  rect: Rect,
  nodeIds: Id[],
): void {
  const text = ann.label ?? '';
  const labelId = text ? `annotation:${ctx.id}` : undefined;
  if (text) {
    const font = { family: ctx.input.theme.type.family, ...ctx.input.theme.type.axis };
    const size = ctx.input.measure(text, font);
    const mapper = valueMapper(ctx.input);
    const alongY = mapper?.axis === 'y';
    const candidates =
      size.width + 8 <= rect.w && size.height + 8 <= rect.h
        ? [
            {
              slot: 'topLeftInside',
              rect: { x: rect.x + 4, y: rect.y + 4, w: size.width, h: size.height },
              penalty: 0,
            },
          ]
        : alongY
          ? [
              {
                slot: 'endOutside',
                rect: {
                  x: rect.x + rect.w + 4,
                  y: rect.y + (rect.h - size.height) / 2,
                  w: size.width,
                  h: size.height,
                },
                penalty: 0,
              },
            ]
          : [
              {
                slot: 'above',
                rect: {
                  x: rect.x + (rect.w - size.width) / 2,
                  y: rect.y - size.height - 4,
                  w: size.width,
                  h: size.height,
                },
                penalty: 0,
              },
            ];
    candidates.push({
      slot: 'above',
      rect: { x: rect.x + (rect.w - size.width) / 2, y: rect.y - size.height - 4, w: size.width, h: size.height },
      penalty: 1,
    }, {
      slot: 'bottomInside',
      rect: { x: rect.x + 4, y: rect.y + rect.h - size.height - 4, w: size.width, h: size.height },
      penalty: 2,
    });
    ctx.labelRequests.push({
      id: labelId!,
      kind: 'annotation',
      owner: { annotationId: ctx.id },
      text,
      lines: [text],
      typeRole: 'axis', font,
      priority: ann.priority ?? PRIORITY.valueLine,
      candidates,
      role: 'note',
    });
  }
  ctx.placed.push({ id: ctx.id, kind: 'band', computedText: text, nodeIds, labelId });
}

/** A bound as the chart prints its numbers. */
function boundText(ctx: TargetPassCtx, v: number): string {
  return ctx.input.format
    ? formatterFromExample(ctx.input.format, ctx.input.locale)(v)
    : formatAutomaticNumber(v, { locale: ctx.input.locale, decimals: autoDecimals(v) });
}

/**
 * A corridor or tolerance band prints both bounds at its
 * edges. On a horizontal value axis they stand over the band's two edges; on
 * a vertical one they sit inside the band at its top and bottom edge.
 */
function boundLabels(ctx: TargetPassCtx, rect: Rect, bounds: { low: number; high: number }, mapper: { scale: (v: number) => number; axis: 'x' | 'y' }, priority: number): void {
  const font = { family: ctx.input.theme.type.family, ...ctx.input.theme.type.axis };
  for (const [end, value] of [['low', bounds.low], ['high', bounds.high]] as const) {
    const text = boundText(ctx, value);
    const size = ctx.input.measure(text, font);
    const edge = mapper.scale(value);
    const candidates: SlotCandidate[] = mapper.axis === 'x'
      ? [
          { slot: 'overEdge', rect: { x: edge - size.width / 2, y: rect.y - size.height - 4, w: size.width, h: size.height }, penalty: 0 },
          { slot: 'insideEdge', rect: { x: edge < rect.x + rect.w / 2 ? edge + 3 : edge - 3 - size.width, y: rect.y + 4, w: size.width, h: size.height }, penalty: 1 },
        ]
      : [
          { slot: 'insideEdgeRight', rect: { x: rect.x + rect.w - 4 - size.width, y: edge < rect.y + rect.h / 2 ? edge + 3 : edge - 3 - size.height, w: size.width, h: size.height }, penalty: 0 },
          { slot: 'besideEdge', rect: { x: rect.x + rect.w + 4, y: edge - size.height / 2, w: size.width, h: size.height }, penalty: 1 },
          { slot: 'insideEdgeLeft', rect: { x: rect.x + 4, y: edge < rect.y + rect.h / 2 ? edge + 3 : edge - 3 - size.height, w: size.width, h: size.height }, penalty: 2 },
        ];
    ctx.labelRequests.push({
      id: `annotation:${ctx.id}:${end}`, kind: 'annotation', owner: { annotationId: ctx.id },
      text, lines: [text], typeRole: 'label', font, priority, candidates, role: 'value',
    });
  }
}

/**
 * Where a label the chart already placed straddles an outlined
 * band's edge, the edge stops under it, so the value is not struck through.
 * A page-colour strip over the edge, behind every mark and text.
 */
function edgeKnockouts(ctx: TargetPassCtx, rect: Rect, axis: 'x' | 'y'): SceneNode[] {
  const nodes: SceneNode[] = [];
  const edges = axis === 'y' ? [rect.y, rect.y + rect.h] : [rect.x, rect.x + rect.w];
  for (const claim of ctx.input.occupied.snapshot()) {
    if (claim.kind !== 'label') continue;
    const r = claim.rect;
    for (const edge of edges) {
      const crosses = axis === 'y'
        ? r.y < edge && r.y + r.h > edge && r.x < rect.x + rect.w && r.x + r.w > rect.x
        : r.x < edge && r.x + r.w > edge && r.y < rect.y + rect.h && r.y + r.h > rect.y;
      if (!crosses) continue;
      nodes.push({
        t: 'rect', id: ctx.nid('edgeGap'), fill: { token: 'background' }, owner: { annotationId: ctx.id }, part: 'band',
        rect: axis === 'y' ? { x: r.x - 1, y: edge - 2, w: r.w + 2, h: 4 } : { x: edge - 2, y: r.y - 1, w: 4, h: r.h + 2 },
      });
    }
  }
  return nodes;
}

function resolveSpan(ctx: TargetPassCtx, from?: Id, to?: Id): Rect | null {
  const plot = ctx.input.bandPlot ?? ctx.input.plot;
  if (from === undefined && to === undefined) return plot;
  if (!ctx.input.resolveCategoryBand) {
    pushWarn(ctx.warnings, ctx.id, 'unsupported', `band '${ctx.id}': chart has no category bands`);
    return null;
  }
  if (from === undefined || to === undefined) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'valueline-scope-invalid',
      `band '${ctx.id}': a category span needs both 'from' and 'to' (inclusive, like band)`,
    );
    return null;
  }
  const start = ctx.input.resolveCategoryBand(from);
  const end = ctx.input.resolveCategoryBand(to);
  if (!start || !end) {
    pushWarn(ctx.warnings, ctx.id, 'bad-anchor', `band '${ctx.id}': unresolvable category span`);
    return null;
  }
  return categorySpanRect(start, end, plot);
}

function placeCorridorOrTolerance(
  ctx: TargetPassCtx,
  ann: Extract<Annotation, { kind: 'band' }>,
  role: 'corridor' | 'tolerance',
): void {
  const mapper = valueMapper(ctx.input);
  if (!mapper) {
    pushWarn(ctx.warnings, ctx.id, 'unsupported', `band '${ctx.id}': chart has no value scale`);
    return;
  }
  const bounds = finitePair(ann.low, ann.high);
  if (!bounds) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-bounds-invalid',
      `band '${ctx.id}': ${role} needs finite, unequal 'low' and 'high'`,
    );
    return;
  }
  const span = resolveSpan(ctx, ann.from, ann.to);
  if (!span) return;
  const plot = ctx.input.bandPlot ?? ctx.input.plot;
  const rect = valueBandRect(span, bounds.low, bounds.high, mapper, plot);
  if (!rect) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-bounds-offscale',
      `band '${ctx.id}': ${role} ${bounds.low} to ${bounds.high} lies outside the value axis`,
    );
    return;
  }
  overlapBand(ctx, rect);
  const bandId = ctx.nid('band');
  const paint =
    role === 'corridor'
      ? scenarioPaint(ann.scenario)
      : { fill: { token: 'others' as const, tint: 0.45 } };
  // A plan corridor is a range, not a box: a pale wash between two thin ink
  // edges at its bounds. A four-sided outline across the plot read as a frame
  // and cut the value labels on its top edge.
  const planRange = paint.pattern === 'outline';
  ctx.nodes.push({
    t: 'rect',
    id: bandId,
    rect,
    ...(planRange ? { fill: { token: 'others' as const, tint: PLAN_CORRIDOR_TINT } } : paint),
    owner: { annotationId: ctx.id },
    part: 'band',
  });
  const edges: SceneNode[] = planRange
    ? (mapper.axis === 'y' ? [rect.y, rect.y + rect.h] : [rect.x, rect.x + rect.w]).map((at) => ({
      t: 'line' as const, id: ctx.nid('edge'),
      ...(mapper.axis === 'y' ? { x1: rect.x, x2: rect.x + rect.w, y1: at, y2: at } : { x1: at, x2: at, y1: rect.y, y2: rect.y + rect.h }),
      stroke: { token: 'ink' as const }, width: strokeToken(ctx.input.theme, 'hair'), owner: { annotationId: ctx.id }, part: 'band',
    }))
    : [];
  pushAll(ctx.nodes, edges);
  const gaps = planRange ? edgeKnockouts(ctx, rect, mapper.axis) : [];
  pushAll(ctx.nodes, gaps);
  corridorLabel(ctx, ann, rect, [bandId, ...edges.map((node) => node.id), ...gaps.map((node) => node.id)]);
  boundLabels(ctx, rect, bounds, mapper, ann.priority ?? PRIORITY.valueLine);
  ctx.placed[ctx.placed.length - 1]!.derivation = {
    basis: 'authored',
    op: role === 'corridor' ? 'annotation-corridor@1' : 'annotation-tolerance@1',
    inputs: [
      { ref: `${ctx.id}.low`, value: bounds.low, state: 'authored' },
      { ref: `${ctx.id}.high`, value: bounds.high, state: 'authored' },
    ],
    raw: bounds.high - bounds.low,
  };
}

function attainmentTone(actual: number, plan: number, direction: Direction): 'good' | 'bad' {
  if (actual === plan) return 'good';
  const over = actual > plan;
  return (over === (direction === 'higherIsBetter')) ? 'good' : 'bad';
}

function placeAttainmentBand(
  ctx: TargetPassCtx,
  ann: Extract<Annotation, { kind: 'band' }>,
): void {
  const mapper = valueMapper(ctx.input);
  if (!mapper) {
    pushWarn(ctx.warnings, ctx.id, 'unsupported', `band '${ctx.id}': chart has no value scale`);
    return;
  }
  const plan = ann.value;
  if (typeof plan !== 'number' || !Number.isFinite(plan)) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-bounds-invalid',
      `band '${ctx.id}': attainment needs a finite plan 'value'`,
    );
    return;
  }
  const ids = ctx.input.categoryIds;
  if (!ids || ids.length === 0) {
    pushWarn(ctx.warnings, ctx.id, 'unsupported', `band '${ctx.id}': chart has no category list for attainment`);
    return;
  }
  const spanIds = idsInSpan(ids, ann.from, ann.to);
  if (typeof spanIds === 'string') {
    pushWarn(ctx.warnings, ctx.id, 'bad-anchor', `band '${ctx.id}': ${spanIds}`);
    return;
  }
  const direction = ann.direction ?? 'higherIsBetter';
  const plot = ctx.input.bandPlot ?? ctx.input.plot;
  const nodeIds: Id[] = [];
  let lastActual: number | null = null;
  let lastCategoryId: Id | null = null;
  let painted = 0;
  let valueless: string | undefined;
  for (const categoryId of spanIds) {
    const ref: AnchorRef = ann.seriesId ? { categoryId, seriesId: ann.seriesId } : categoryId;
    const actual = ctx.input.resolve(ref);
    // A stack whose parts do not add has no actual to shade against the plan.
    if (actual?.noValue !== undefined) valueless ??= actual.noValue;
    if (!actual || actual.noValue !== undefined) continue;
    const band = ctx.input.resolveCategoryBand?.(categoryId);
    if (!band) continue;
    const span = categorySpanRect(band, band, plot);
    const rect = valueBandRect(span, actual.value, plan, mapper, plot);
    if (!rect) continue;
    lastActual = actual.value;
    lastCategoryId = categoryId;
    painted += 1;
    const tone = attainmentTone(actual.value, plan, direction);
    const nodeId = ctx.nid(`attainment-${categoryId}`);
    nodeIds.push(nodeId);
    ctx.nodes.push({
      t: 'rect',
      id: nodeId,
      rect,
      // A band between the actual and the plan is a large signed fill.
      fill: signedFillPaint(tone),
      owner: { annotationId: ctx.id, categoryId, seriesId: ann.seriesId },
      part: 'attainment',
    });
  }
  if (painted === 0 && valueless !== undefined) {
    // Said as the other value-less anchors say it (annotate.ts valueless), not as an empty band.
    ctx.warnings.push({
      code: 'bad-anchor', severity: 'warn', owner: { annotationId: ctx.id },
      message: `band '${ctx.id}': ${valueless}, so it prints no value there`,
      suggest: valuelessFix(valueless),
    });
    return;
  }
  if (painted === 0) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-attainment-empty',
      `band '${ctx.id}': no drawable attainment cells — missing or suppressed values were skipped`,
    );
    return;
  }
  const ratio = lastActual !== null && plan !== 0 ? lastActual / plan : null;
  const text = ann.label ?? (ratio === null ? '' : formatAutomaticPercent(ratio * 100, 0, false, ctx.input.locale));
  const labelId = text ? `annotation:${ctx.id}` : undefined;
  if (text && labelId) {
    const font = { family: ctx.input.theme.type.family, ...ctx.input.theme.type.label };
    const size = ctx.input.measure(text, font);
    const last = ctx.nodes[ctx.nodes.length - 1];
    const anchor = last && last.t === 'rect' ? last.rect : plot;
    ctx.labelRequests.push({
      id: labelId,
      kind: 'annotation',
      owner: { annotationId: ctx.id },
      text,
      lines: [text],
      typeRole: 'label', font,
      priority: ann.priority ?? PRIORITY.valueLine,
      // An authored label is prose; the fallback prints the attainment percent.
      role: ann.label ? 'note' : 'value',
      candidates: [
        {
          slot: 'end',
          rect: {
            x: mapper.axis === 'y' ? anchor.x + anchor.w + 4 : anchor.x + (anchor.w - size.width) / 2,
            y: mapper.axis === 'y' ? anchor.y - size.height / 2 : anchor.y - size.height - 4,
            w: size.width,
            h: size.height,
          },
          penalty: 0,
        },
      ],
    });
  }
  const derivation: AnnotationDerivation = {
    basis: 'derived',
    op: 'annotation-attainment@1',
    inputs: [
      { ref: lastCategoryId === null ? 'actual' : `actual:${lastCategoryId}`, value: lastActual },
      { ref: `${ctx.id}.value`, value: plan, state: 'authored' },
    ],
    raw: ratio,
  };
  ctx.placed.push({
    id: ctx.id,
    kind: 'band',
    computedText: text,
    nodeIds,
    labelId,
    derivation,
  });
}

function refuseUnsupportedBand(
  ctx: TargetPassCtx,
  ann: Extract<Annotation, { kind: 'band' }>,
  style: 'corridor' | 'tolerance' | 'attainment',
): boolean {
  if (ann.divider) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-combination-unsupported',
      `band '${ctx.id}': divider applies only to bracket era bands, not ${style}`,
    );
    return true;
  }
  if (ann.tone !== undefined && (style === 'corridor' || style === 'tolerance' || style === 'attainment')) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-combination-unsupported',
      `band '${ctx.id}': tone applies to era bands; ${style} uses scenario or good/bad tokens`,
    );
    return true;
  }
  if (style !== 'attainment' && ann.seriesId !== undefined) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-combination-unsupported',
      `band '${ctx.id}': seriesId is used only with style 'attainment'`,
    );
    return true;
  }
  if (style === 'attainment' && (ann.low !== undefined || ann.high !== undefined)) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-combination-unsupported',
      `band '${ctx.id}': attainment uses 'value' as the plan, not low/high`,
    );
    return true;
  }
  if (style !== 'corridor' && ann.scenario !== undefined) {
    pushWarn(
      ctx.warnings,
      ctx.id,
      'band-combination-unsupported',
      `band '${ctx.id}': scenario notation applies to plan corridors`,
    );
    return true;
  }
  return false;
}

export function placeTargetBand(
  ctx: TargetPassCtx,
  ann: Extract<Annotation, { kind: 'band' }>,
): boolean {
  const style = ann.style;
  if (style !== 'corridor' && style !== 'tolerance' && style !== 'attainment') return false;
  if (refuseUnsupportedBand(ctx, ann, style)) return true;
  if (style === 'attainment') placeAttainmentBand(ctx, ann);
  else placeCorridorOrTolerance(ctx, ann, style);
  return true;
}

function toleranceBounds(
  value: number,
  tolerance: NonNullable<Extract<Annotation, { kind: 'valueLine' }>['tolerance']>,
): { low: number; high: number } | string {
  if (typeof tolerance === 'number') {
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      return 'tolerance must be a positive finite number';
    }
    return { low: value - tolerance, high: value + tolerance };
  }
  const pair = finitePair(tolerance.low, tolerance.high);
  if (!pair) return "tolerance bounds need finite, unequal 'low' and 'high'";
  return pair;
}

export function placeValueLineTargets(
  ctx: TargetPassCtx,
  ann: Extract<Annotation, { kind: 'valueLine' }>,
  value: number,
): void {
  const mapper = valueMapper(ctx.input);
  if (!mapper) return;
  if (ann.tolerance !== undefined) {
    const bounds = toleranceBounds(value, ann.tolerance);
    if (typeof bounds === 'string') {
      pushWarn(ctx.warnings, ctx.id, 'valueline-tolerance-invalid', `valueLine '${ctx.id}': ${bounds}`);
    } else {
      const plot = ctx.input.bandPlot ?? ctx.input.plot;
      const span = resolveSpan(ctx, ann.from, ann.to);
      const rect = span ? valueBandRect(span, bounds.low, bounds.high, mapper, plot) : null;
      if (rect) {
        const bandId = ctx.nid('tolerance');
        ctx.nodes.push({
          t: 'rect',
          id: bandId,
          rect,
          fill: { token: 'others', tint: 0.45 },
          owner: { annotationId: ctx.id },
          part: 'band',
        });
        const placed = ctx.placed.find((item) => item.id === ctx.id);
        const low = boundText(ctx, bounds.low);
        const high = boundText(ctx, bounds.high);
        if (placed) {
          placed.nodeIds = [bandId, ...placed.nodeIds];
          placed.toleranceText = { low, high };
        }
        // The band prints its bounds in the card's words: "85 to 95", "85 bis 95".
        const text = chartString({ locale: ctx.input.locale, strings: ctx.input.strings }, 'valueLineRange', { v1: low, v2: high });
        const font = { family: ctx.input.theme.type.family, ...ctx.input.theme.type.axis };
        const size = ctx.input.measure(text, font);
        const at = (x: number, y: number): Rect => ({ x, y, w: size.width, h: size.height });
        const right = rect.x + rect.w - 4 - size.width;
        ctx.labelRequests.push({
          id: `annotation:${ctx.id}:tolerance`, kind: 'annotation', owner: { annotationId: ctx.id }, text, lines: [text], typeRole: 'footnote', font,
          priority: ann.priority ?? PRIORITY.valueLine, role: 'note',
          candidates: mapper.axis === 'y'
            ? [
                { slot: 'insideTopRight', rect: at(right, rect.y + 3), penalty: 0 },
                { slot: 'insideBottomRight', rect: at(right, rect.y + rect.h - 3 - size.height), penalty: 1 },
                { slot: 'insideTopLeft', rect: at(rect.x + 4, rect.y + 3), penalty: 2 },
              ]
            : [
                { slot: 'above', rect: at(rect.x + (rect.w - size.width) / 2, rect.y - size.height - 4), penalty: 0 },
                { slot: 'insideTop', rect: at(rect.x + (rect.w - size.width) / 2, rect.y + 4), penalty: 1 },
              ],
        });
      } else if (span) {
        pushWarn(
          ctx.warnings,
          ctx.id,
          'band-bounds-offscale',
          `valueLine '${ctx.id}': tolerance band ${bounds.low} to ${bounds.high} lies outside the value axis`,
        );
      }
    }
  }
  if (ann.attainment === undefined || ann.attainment === false) return;
  const spec = ann.attainment === true ? {} : ann.attainment;
  const fakeBand: Extract<Annotation, { kind: 'band' }> = {
    kind: 'band',
    style: 'attainment',
    value,
    seriesId: spec.seriesId,
    from: ann.from,
    to: ann.to,
    direction: spec.direction,
    label: typeof ann.label === 'string' ? ann.label : undefined,
    priority: ann.priority,
  };
  const inner: TargetPassCtx = { ...ctx, id: ctx.id };
  const before = ctx.placed.length;
  placeAttainmentBand(inner, fakeBand);
  if (ctx.placed.length > before) {
    const extra = ctx.placed.pop()!;
    const host = ctx.placed.find((item) => item.id === ctx.id);
    if (host) {
      host.nodeIds = [...host.nodeIds, ...extra.nodeIds];
      host.derivation = extra.derivation;
      if (extra.computedText && !host.computedText) host.computedText = extra.computedText;
    }
  }
}

export function placeEraBand(ctx: TargetPassCtx, ann: Extract<Annotation, { kind: 'band' }>): void {
  if (!ctx.input.resolveCategoryBand) {
    pushWarn(ctx.warnings, ctx.id, 'unsupported', `band '${ctx.id}': chart has no category bands`);
    return;
  }
  if (ann.from === undefined || ann.to === undefined) {
    pushWarn(ctx.warnings, ctx.id, 'bad-anchor', `band '${ctx.id}': era band needs inclusive category from and to`);
    return;
  }
  const from = ctx.input.resolveCategoryBand(ann.from);
  const to = ctx.input.resolveCategoryBand(ann.to);
  if (!from || !to) {
    pushWarn(ctx.warnings, ctx.id, 'bad-anchor', `band '${ctx.id}': unresolvable category span`);
    return;
  }
  const bandPlot = ctx.input.bandPlot ?? ctx.input.plot;
  let rect = categorySpanRect(from, to, bandPlot);
  // A continuous axis puts both edges of a one-period band on one x: the band
  // covers that period's slot, as a category band covers its category. A short
  // band between two distinct x stays as drawn.
  if (rect.w < 0.5 && rect.h > 0 && !isCategoryAlongY(from) && !isCategoryAlongY(to)
    && (from as { x: number }).x === (to as { x: number }).x) {
    const slot = ctx.input.resolvePeriodSlot?.(ann.from);
    if (!slot || isCategoryAlongY(slot) || slot.w < 0.5) {
      pushWarn(ctx.warnings, ctx.id, 'band-zero-width',
        `band '${ctx.id}': from and to are the same x (${String(ann.from)}) and no drawn period sits there, so the band has no width and is not drawn; give 'to' a later x`);
      return;
    }
    rect = categorySpanRect(slot, slot, bandPlot);
  }
  overlapBand(ctx, rect);
  if ((ann.style ?? 'shade') === 'shade') placeEraShade(ctx, ann, rect);
  else placeEraBracket(ctx, ann, rect, bandPlot);
}

function placeEraShade(
  ctx: TargetPassCtx,
  ann: Extract<Annotation, { kind: 'band' }>,
  rect: Rect,
): void {
  const bandId = ctx.nid('band');
  // Equal shade fills need an edge where two inclusive category spans meet.
  const adjacent = ctx.nodes.filter(node => node.t === 'rect' && node.part === 'band');
  for (const node of adjacent) {
    if (node.t !== 'rect') continue;
    const other = node.rect;
    const sameRows = Math.abs(other.y - rect.y) < 0.01 && Math.abs(other.h - rect.h) < 0.01;
    const sameColumns = Math.abs(other.x - rect.x) < 0.01 && Math.abs(other.w - rect.w) < 0.01;
    const x = Math.abs(other.x + other.w - rect.x) < 0.01 ? rect.x
      : Math.abs(rect.x + rect.w - other.x) < 0.01 ? other.x : undefined;
    const y = Math.abs(other.y + other.h - rect.y) < 0.01 ? rect.y
      : Math.abs(rect.y + rect.h - other.y) < 0.01 ? other.y : undefined;
    if ((sameRows && x !== undefined) || (sameColumns && y !== undefined)) ctx.nodes.push({
      t: 'line', id: ctx.nid(`boundary:${node.id}`),
      ...(sameRows && x !== undefined ? { x1: x, x2: x, y1: rect.y, y2: rect.y + rect.h }
        : { x1: rect.x, x2: rect.x + rect.w, y1: y!, y2: y! }),
      stroke: { token: 'inkMuted' }, width: strokeToken(ctx.input.theme, 'hair'), owner: { annotationId: ctx.id }, part: 'bandBoundary',
    });
  }
  ctx.nodes.push({
    t: 'rect',
    id: bandId,
    rect,
    fill: { token: 'others' },
    owner: { annotationId: ctx.id },
    part: 'band',
  });
  const text = ann.label ?? '';
  const labelId = ann.label ? `annotation:${ctx.id}` : undefined;
  if (ann.label) {
    const font = { family: ctx.input.theme.type.family, ...ctx.input.theme.type.axis };
    const size = ctx.input.measure(text, font);
    // A name that fits inside the band with clearance reads centred over it;
    // the start of the band is the seat when the centre is taken.
    const candidates =
      size.width + 8 <= rect.w && size.height + 8 <= rect.h
        ? [
            {
              slot: 'topCenterInside',
              rect: { x: rect.x + (rect.w - size.width) / 2, y: rect.y + 4, w: size.width, h: size.height },
              penalty: 0,
            },
            { slot: 'topLeftInside', rect: { x: rect.x + 4, y: rect.y + 4, w: size.width, h: size.height }, penalty: 1 },
          ]
        : [];
    // Where value labels take the band's top (columns under it), the name
    // reads centred over the band instead of hiding: a shade nothing names
    // leaves the reader to guess what it marks.
    if (size.width <= rect.w) {
      candidates.push({
        slot: 'aboveBand',
        rect: { x: rect.x + (rect.w - size.width) / 2, y: rect.y - size.height - 4, w: size.width, h: size.height },
        penalty: 2,
      });
    }
    // A name wider than its band may run past it, aligned to the band's end or start, so a short
    // span at the plot edge still says what it marks.
    candidates.push(
      { slot: 'aboveBandEnd', rect: { x: rect.x + rect.w - size.width, y: rect.y - size.height - 4, w: size.width, h: size.height }, penalty: 3 },
      { slot: 'aboveBandStart', rect: { x: rect.x, y: rect.y - size.height - 4, w: size.width, h: size.height }, penalty: 4 },
    );
    ctx.labelRequests.push({
      id: labelId!,
      kind: 'annotation',
      owner: { annotationId: ctx.id },
      text,
      lines: [text],
      noteText: ann.label,
      typeRole: 'axis', font,
      priority: ann.priority ?? PRIORITY.valueLine,
      candidates,
      role: 'note',
    });
    ctx.eraBands?.push({
      annotationId: ctx.id,
      labelId: labelId!,
      text,
      noteText: ann.label,
      font,
      priority: ann.priority ?? PRIORITY.valueLine,
      rect,
      bandPlot: ctx.input.bandPlot ?? ctx.input.plot,
      style: 'shade',
      baseCandidates: candidates,
    });
  }
  ctx.placed.push({ id: ctx.id, kind: 'band', computedText: text, nodeIds: [bandId], labelId });
}

function placeEraBracket(
  ctx: TargetPassCtx,
  ann: Extract<Annotation, { kind: 'band' }>,
  rect: Rect,
  bandPlot: Rect,
): void {
  const text = ann.label ?? '';
  const labelId = ann.label ? `annotation:${ctx.id}` : undefined;
  const font = { family: ctx.input.theme.type.family, ...ctx.input.theme.type.axis };
  const size = ctx.input.measure(text || 'X', font);
  const roomAbove = bandPlot.y - ctx.input.plot.y;
  const bracketY = roomAbove >= size.height + 12 ? bandPlot.y - 7 : bandPlot.y + size.height + 6;
  const left = rect.x;
  const right = rect.x + rect.w;
  const arrowInset = Math.min(5, rect.w / 2);
  const bracketIds: Id[] = [];
  const lineId = ctx.nid('bracket');
  bracketIds.push(lineId);
  ctx.nodes.push({
    t: 'line',
    id: lineId,
    x1: left + arrowInset,
    y1: bracketY,
    x2: right - arrowInset,
    y2: bracketY,
    stroke: { token: 'ink' },
    width: strokeToken(ctx.input.theme, 'rule'),
    owner: { annotationId: ctx.id },
    part: 'bandBracket',
  });
  for (const [edge, x, angle] of [
    ['start', left, Math.PI],
    ['end', right, 0],
  ] as const) {
    const headId = ctx.nid(`bracketHead-${edge}`);
    bracketIds.push(headId);
    ctx.nodes.push({
      t: 'path',
      id: headId,
      d: arrowHeadPath({ x, y: bracketY }, angle, 5),
      fill: { token: 'ink' },
      owner: { annotationId: ctx.id },
      part: 'bandArrowHead',
    });
  }
  ctx.input.occupied.claim(
    { x: left - 1, y: bracketY - 4, w: rect.w + 2, h: 8 },
    'annotation',
    { annotationId: ctx.id },
    'bandBracket',
  );
  const divider = ann.divider ?? false;
  const dividerEdges = divider === 'both' ? [left, right] : divider === 'start' ? [left] : divider === 'end' ? [right] : [];
  dividerEdges.forEach((x, edgeIndex) => {
    const dividerId = ctx.nid(`divider-${edgeIndex}`);
    bracketIds.push(dividerId);
    ctx.nodes.push({
      t: 'line',
      id: dividerId,
      x1: x,
      y1: bandPlot.y,
      x2: x,
      y2: bandPlot.y + bandPlot.h,
      stroke: { token: 'leader' },
      width: strokeToken(ctx.input.theme, 'rule'),
      dash: dashToken(ctx.input.theme, 'reference'),
      owner: { annotationId: ctx.id },
      part: 'bandDivider',
    });
    ctx.input.occupied.claim({ x: x - 1.5, y: bandPlot.y, w: 3, h: bandPlot.h }, 'annotation', { annotationId: ctx.id }, 'bandDivider');
  });
  if (ann.label) {
    const candidates: SlotCandidate[] = [
      {
        slot: 'aboveBracket',
        rect: { x: rect.x + (rect.w - size.width) / 2, y: bracketY - size.height - 3, w: size.width, h: size.height },
        penalty: 0,
      },
    ];
    ctx.labelRequests.push({
      id: labelId!,
      kind: 'annotation',
      owner: { annotationId: ctx.id },
      text,
      lines: [text],
      noteText: ann.label,
      typeRole: 'axis', font,
      priority: ann.priority ?? PRIORITY.valueLine,
      role: 'note',
      candidates,
    });
    ctx.eraBands?.push({
      annotationId: ctx.id,
      labelId: labelId!,
      text,
      noteText: ann.label,
      font,
      priority: ann.priority ?? PRIORITY.valueLine,
      rect,
      bandPlot,
      style: 'bracket',
      bracketY,
      baseCandidates: candidates,
    });
  }
  ctx.placed.push({ id: ctx.id, kind: 'band', computedText: text, nodeIds: bracketIds, labelId });
}

function twoLineWrap(
  text: string,
  font: { family: string; size: number; weight: number; lineHeight?: number },
  measure: TextMeasurer,
  singleHeight: number,
): { lines: [string, string]; width: number; height: number } | null {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best: { lines: [string, string]; width: number; height: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ');
    const l2 = words.slice(i).join(' ');
    const s1 = measure(l1, font);
    const s2 = measure(l2, font);
    const w = Math.max(s1.width, s2.width);
    if (!best || w < best.width) {
      best = { lines: [l1, l2], width: w, height: singleHeight * 2 };
    }
  }
  return best;
}

export function buildExtendedEraBandCandidates(
  plan: EraBandPlan,
  input: TargetScaleInput,
  forHeadroomEstimate = false,
): SlotCandidate[] {
  const out: SlotCandidate[] = [...plan.baseCandidates];
  const seen = new Set(out.map((c) => `${Math.round(c.rect.x * 10)}:${Math.round(c.rect.y * 10)}:${Math.round(c.rect.w * 10)}:${Math.round(c.rect.h * 10)}`));
  const push = (cand: SlotCandidate): void => {
    const key = `${Math.round(cand.rect.x * 10)}:${Math.round(cand.rect.y * 10)}:${Math.round(cand.rect.w * 10)}:${Math.round(cand.rect.h * 10)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cand);
  };
  const { rect, font, text, style, bandPlot } = plan;
  const size = input.measure(text, font);
  const wrapped = twoLineWrap(text, font, input.measure, size.height);
  const isHorizontalBar = input.xScale !== undefined && input.yScale === undefined;

  const stepsBetween = (start: number, end: number): number[] =>
    end > start ? [start + (end - start) / 3, start + 2 * (end - start) / 3] : [];

  const abovePositions = (w: number, centerSlot: string, endSlot: string, startSlot: string): { slot: string; x: number; pen: number }[] => {
    const list: { slot: string; x: number; pen: number }[] = [
      { slot: centerSlot, x: rect.x + (rect.w - w) / 2, pen: 0 },
      { slot: endSlot, x: rect.x + rect.w - w, pen: 0.1 },
      { slot: startSlot, x: rect.x, pen: 0.22 },
    ];
    const lo = w + 8 <= rect.w ? rect.x + 4 : rect.x + Math.min(0, rect.w - w);
    const hi = w + 8 <= rect.w ? rect.x + rect.w - w - 4 : rect.x;
    for (const x of stepsBetween(lo, hi)) list.push({ slot: centerSlot, x, pen: 0.35 });
    return list;
  };

  const addLiftedAbove = (
    w: number,
    h: number,
    baseY: number,
    basePen: number,
    centerSlot: string,
    endSlot: string,
    startSlot: string,
    lines?: [string, string],
  ): void => {
    const horiz = abovePositions(w, centerSlot, endSlot, startSlot);
    for (const { slot, x, pen } of horiz) {
      push({ slot, rect: { x, y: baseY, w, h }, penalty: basePen + pen, ...(lines ? { lines } : {}) });
    }
    const maxLift = size.height * 3 + 16;
    for (const { slot, x, pen } of horiz) {
      let curY = baseY;
      for (let step = 0; step < 3; step++) {
        const hits = input.occupied.hitsWhich({ x, y: curY, w, h }, 2,
          (o) => isCeilingClaim(o, input.ceilingRects) ||
            o.kind === 'annotation' && o.owner.annotationId === plan.annotationId);
        if (hits.length === 0) break;
        const minTop = minOf(hits.map((o) => o.rect.y));
        const nextY = minTop - h - 2.5;
        if (nextY >= curY - 0.5 || baseY - nextY > maxLift) break;
        curY = nextY;
        push({ slot, rect: { x, y: curY, w, h }, penalty: basePen + 3 + step + pen, ...(lines ? { lines } : {}) });
      }
      for (const [stepIdx, dy] of [
        [0, 9],
        [1, size.height + 3],
        [2, 2 * (size.height + 3)],
      ] as const) {
        const nextY = baseY - dy;
        if (baseY - nextY <= maxLift) {
          push({ slot, rect: { x, y: nextY, w, h }, penalty: basePen + 4 + stepIdx + pen, ...(lines ? { lines } : {}) });
        }
      }
    }
  };

  if (style === 'shade') {
    if (size.height + 8 <= rect.h) {
      if (size.width + 8 <= rect.w) {
        push({ slot: 'topRightInside', rect: { x: rect.x + rect.w - size.width - 4, y: rect.y + 4, w: size.width, h: size.height }, penalty: 5 });
        for (const x of stepsBetween(rect.x + 4, rect.x + rect.w - size.width - 4)) {
          push({ slot: 'topCenterInside', rect: { x, y: rect.y + 4, w: size.width, h: size.height }, penalty: 5.2 });
        }
        if (isHorizontalBar) {
          push({ slot: 'bottomLeftInside', rect: { x: rect.x + 4, y: rect.y + rect.h - size.height - 4, w: size.width, h: size.height }, penalty: 5.5 });
          push({ slot: 'bottomRightInside', rect: { x: rect.x + rect.w - size.width - 4, y: rect.y + rect.h - size.height - 4, w: size.width, h: size.height }, penalty: 5.6 });
        }
      } else if (size.width <= rect.w) {
        push({ slot: 'topCenterInside', rect: { x: rect.x + (rect.w - size.width) / 2, y: rect.y + 4, w: size.width, h: size.height }, penalty: 5 });
      }
    }
    if (wrapped && wrapped.height + 8 <= rect.h) {
      if (wrapped.width + 8 <= rect.w) {
        push({ slot: 'topCenterInside', rect: { x: rect.x + (rect.w - wrapped.width) / 2, y: rect.y + 4, w: wrapped.width, h: wrapped.height }, penalty: 6, lines: wrapped.lines });
        push({ slot: 'topLeftInside', rect: { x: rect.x + 4, y: rect.y + 4, w: wrapped.width, h: wrapped.height }, penalty: 6.1, lines: wrapped.lines });
        push({ slot: 'topRightInside', rect: { x: rect.x + rect.w - wrapped.width - 4, y: rect.y + 4, w: wrapped.width, h: wrapped.height }, penalty: 6.2, lines: wrapped.lines });
        for (const x of stepsBetween(rect.x + 4, rect.x + rect.w - wrapped.width - 4)) {
          push({ slot: 'topCenterInside', rect: { x, y: rect.y + 4, w: wrapped.width, h: wrapped.height }, penalty: 6.3, lines: wrapped.lines });
        }
      } else if (wrapped.width <= rect.w) {
        push({ slot: 'topCenterInside', rect: { x: rect.x + (rect.w - wrapped.width) / 2, y: rect.y + 4, w: wrapped.width, h: wrapped.height }, penalty: 6.1, lines: wrapped.lines });
      }
    }
    addLiftedAbove(size.width, size.height, rect.y - size.height - 4, 7, 'aboveBand', 'aboveBandEnd', 'aboveBandStart');
    if (wrapped) {
      addLiftedAbove(wrapped.width, wrapped.height, rect.y - wrapped.height - 4, 9, 'aboveBand', 'aboveBandEnd', 'aboveBandStart', wrapped.lines);
    }
  } else {
    const bracketY = plan.bracketY ?? (bandPlot.y - 7);
    if (bracketY <= bandPlot.y || !forHeadroomEstimate) {
      addLiftedAbove(size.width, size.height, bracketY - size.height - 3, 5, 'aboveBracket', 'aboveBracketEnd', 'aboveBracketStart');
      if (wrapped) {
        addLiftedAbove(wrapped.width, wrapped.height, bracketY - wrapped.height - 3, 7, 'aboveBracket', 'aboveBracketEnd', 'aboveBracketStart', wrapped.lines);
      }
    }
    if (forHeadroomEstimate && bracketY > bandPlot.y) {
      const aboveBracketY = bandPlot.y - 7;
      addLiftedAbove(size.width, size.height, aboveBracketY - size.height - 3, 9, 'aboveBracket', 'aboveBracketEnd', 'aboveBracketStart');
      if (wrapped) {
        addLiftedAbove(wrapped.width, wrapped.height, aboveBracketY - wrapped.height - 3, 11, 'aboveBracket', 'aboveBracketEnd', 'aboveBracketStart', wrapped.lines);
      }
    }
  }
  return out;
}

