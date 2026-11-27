import { maxOf } from '../../arrays';
import { unionRect, type Rect } from '../../geometry';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import { strokeToken } from '../../theme';
import type { Annotation } from '../../types/annotations';
import type { BarOptions } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import { positionBarLabel } from '../band/labelPosition';
import { authoredTrackWidth, columnOverrideWarnings, trackPlotFloor } from '../columnOverrides';
import { restLabel, restSum, topNCut } from '../topN';
import type { BarLocalAnnotations } from './annotations';
import { barHalves, CAT_BAND_GAP, LABEL_GAP, NAME_TRACK, OTHERS_ID, TOTAL_COLUMN, type BarArea, type BarDomain, type BarMarkGeometry, type BarPaints, type NormCat, type NormSeries } from './model';

/** The optional label track has the same width and warnings in standard and interval bars. */
export function barNameTrack(options: BarOptions, nameColumn: boolean, width: number, warnings: LintWarning[]): number | undefined {
  columnOverrideWarnings('bar', options.columnOverrides, nameColumn ? ['label'] : [], [], warnings);
  const authored = options.columnOverrides?.label?.width;
  return (options as { [NAME_TRACK]?: number })[NAME_TRACK] ?? (authored === undefined || !nameColumn ? undefined
    : authoredTrackWidth('label', authored, 24, width - CAT_BAND_GAP - trackPlotFloor(width), warnings));
}

/** Whole pixels keep the author's fraction of a themed row thick enough for its labels. */
export function fixedRowWithFraction(pitch: number, heights: readonly number[], minBar: number, fraction: number) {
  return { step: Math.max(pitch, Math.ceil(minBar / fraction), maxOf(heights)), fraction };
}

/** Keep the selected rows and collect their remaining cells into the optional Others row. */
export function applyBarTopN(t: NonNullable<BarOptions['topN']>, strings: BarOptions['strings'], cats: NormCat[], normSeries: NormSeries[],
  totalOf: (index: number) => number, warnings: LintWarning[]): NormCat[] {
  const { kept: keptOrder, dropped } = topNCut(cats.map((_, i) => Math.abs(totalOf(i))), Math.max(1, t.n), t.threshold);
  if (dropped.length > 0) {
    if (t.rest ?? true) {
      if (normSeries.some((series) => dropped.some((i) => series.cells[i]!.range))) {
        warnings.push({
          code: 'range-topn-omitted',
          severity: 'warn',
          message: 'topN Others aggregates values but not ranges; dropped-item ranges were omitted',
          suggest: 'set topN.rest to false or pre-aggregate a defensible range upstream',
        });
      }
      for (const s of normSeries) {
        const isPct = dropped.every(i => s.cells[i]!.v === null || s.cells[i]!.isPct);
        s.cells = [...keptOrder.map((i) => s.cells[i]!), { v: restSum(dropped.map((i) => s.cells[i]!.v)), ...(isPct ? { isPct: true } : {}), meta: null }];
      }
      cats = [...keptOrder.map((i) => cats[i]!), { id: OTHERS_ID, label: restLabel(t, strings, dropped.map((i) => cats[i]!.label ?? cats[i]!.id)) }];
    } else {
      for (const s of normSeries) s.cells = keptOrder.map((i) => s.cells[i]!);
      cats = keptOrder.map((i) => cats[i]!);
    }
  }
  return cats;
}

export function positionBarLabels(requests: LabelRequest[], domain: BarDomain, paints: BarPaints, scene: BarMarkGeometry): void {
  const { options, cats, variant } = domain;
  const halves = barHalves(options);
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i]!;
    if (!/^(point|segment|grandTotal):/.test(request.id)) continue;
    const ci = cats.findIndex(cat => cat.id === request.owner.categoryId);
    const cat = cats[ci];
    const first = request.candidates[0];
    if (!cat || !first) continue;
    const bars = scene.bars[ci]!;
    const drawn = bars.filter(bar => bar.v !== 0);
    const total = request.id.startsWith('grandTotal:');
    const bar = total
      ? variant === 'stacked' && !(TOTAL_COLUMN in options) && drawn.length === 1 ? drawn[0] : undefined
      : bars.find(bar => bar.s.id === request.owner.seriesId);
    if (!bar) continue;
    const twin = halves?.pos === bar.s.id ? bars.find(other => other.s.id === halves.neg)?.rect : undefined;
    const rect = twin ? unionRect(twin, bar.rect) : bar.rect;
    const cell = bar.s.cells[ci]!;
    const { paint, pattern } = paints.cell(bar.s, cat, cell.meta, cell.v);
    requests[i] = positionBarLabel(request, options, {
      rect, size: { width: first.rect.w, height: first.rect.h }, orientation: 'horizontal', endPositive: bar.v >= 0, zero: bar.v === 0,
      edgeGap: LABEL_GAP, outsideGap: LABEL_GAP, fallback: total || variant === 'grouped' ? undefined : 'stack', muted: request.bodyInk !== undefined,
      insideFill: paints.css(paint, pattern), insidePaint: paint, insidePattern: pattern,
    });
  }
}

/** indicator100: a small tick above the plot at the 100% position, labelled "100%". */
export function drawBarIndicator(domain: BarDomain, area: BarArea, ann: Annotation, out: BarLocalAnnotations): void {
  const { measure } = domain;
  const { plot, x, tickFont } = area;
  const { nodes, claims, requests, placed } = out;
  const id = ann.id!;
  const vx = x(100);
  const tickId = `ann:${id}:tick`;
  nodes.push({
    t: 'line',
    id: tickId,
    x1: vx,
    y1: plot.y - 12,
    x2: vx,
    y2: plot.y - 4,
    stroke: { token: 'ink' },
    width: strokeToken(domain.theme, 'rule'),
    owner: { annotationId: id },
    part: 'indicator100',
  });
  claims.claim({ x: vx - 1, y: plot.y - 12, w: 2, h: 8 }, 'annotation', { annotationId: id });
  const text = '100%';
  const tsize = measure(text, tickFont);
  const side = (ann as { side?: 'left' | 'right' }).side ?? 'left';
  const leftRect: Rect = {
    x: vx - tsize.width - 5,
    y: plot.y - tsize.height - 6,
    w: tsize.width,
    h: tsize.height,
  };
  const rightRect: Rect = { ...leftRect, x: vx + 5 };
  requests.push({
    id: `indicator100:${id}`,
    kind: 'percentIndicator',
    owner: { annotationId: id },
    text,
    lines: [text],
    typeRole: 'label', font: tickFont,
    priority: ann.priority ?? PRIORITY.valueLine,
    candidates:
      side === 'left'
        ? [
            { slot: 'left', rect: leftRect, penalty: 0 },
            { slot: 'right', rect: rightRect, penalty: 1 },
          ]
        : [
            { slot: 'right', rect: rightRect, penalty: 0 },
            { slot: 'left', rect: leftRect, penalty: 1 },
          ],
  });
  placed.push({
    id,
    kind: 'indicator100',
    computedText: text,
    nodeIds: [tickId],
    labelId: `indicator100:${id}`,
  });
}
