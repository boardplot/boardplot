import { chartString, localeStrings } from '../../strings/line';
import { inflate, type Rect } from '../../geometry';
import { LABEL_PLATE_RADIUS, labelPlate } from '../../markVisibility';
import type { OccupiedIndex } from '../../label/occupied';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import type { FontSpec, TextMeasurer } from '../../text';
import { strokeToken, dashToken, paintColor } from '../../theme';
import type { Annotation } from '../../types/annotations';
import type { Category } from '../../types/data';
import type { Paint, PlacedLabel, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { NormSer } from './context';
import type { LineDomain } from './model';
import { forecastBoundaryX, forecastStart, lastActualIndex, type LinePhaseResolved } from './marks';
import { maxOf } from '../../arrays';

export interface ForecastBoundary {
  categoryIndex: number;
  categoryId: string;
  /** Unique furniture identity when several transitions reach the same category. */
  id: string;
  /** The last actual point of the series that share this transition. */
  lastActualIndex: number;
  labelled: boolean;
  divided: boolean;
}

/** Where the actuals turn into forecast; an authored bracket or phase that draws a divider there is `divided`. */
export function forecastBoundaries(series: NormSer[], cats: Category[], annotations: Annotation[], phases: LinePhaseResolved | null, stacked: boolean): ForecastBoundary[] {
  const turning = series.flatMap((item) => {
    const start = forecastStart(item, cats);
    return start > 0 && item.vals.slice(0, start).some((v) => v.v !== null) &&
      item.vals.slice(start).some((v) => v.v !== null) ? [{ start, lastActual: lastActualIndex(item, start, stacked) }] : [];
  });
  const transitions = turning.filter((item, index) => turning.findIndex(other => other.start === item.start && other.lastActual === item.lastActual) === index)
    .sort((a, b) => a.start + a.lastActual - b.start - b.lastActual || a.start - b.start);
  const usedIds = new Set(cats.map(category => category.id));
  return transitions.map(({ start: categoryIndex, lastActual }) => {
    const categoryId = cats[categoryIndex]!.id;
    const atStart = transitions.filter(item => item.start === categoryIndex);
    const authored = lastActual === maxOf(atStart.map(item => item.lastActual));
    let id = categoryId;
    if (atStart.length > 1) {
      id = `${categoryId}:from:${lastActual}`;
      while (usedIds.has(id)) id += ':2';
      usedIds.add(id);
    }
    const bands = annotations.filter((ann): ann is Extract<Annotation, { kind: 'band' }> => ann.kind === 'band' && ann.style === 'bracket');
    const phase = phases?.phases.find((item) => item.from === categoryId);
    return {
      categoryIndex, categoryId, id,
      lastActualIndex: lastActual,
      labelled: authored && (bands.some((band) => band.from === categoryId && /^(fc|forecast)$/i.test(band.label?.trim() ?? '')) ||
        !!phase && /^(fc|forecast)$/i.test(phase.label.trim())),
      divided: authored && (!!phase || bands.some((band) =>
        (band.from === categoryId && (band.divider === 'start' || band.divider === 'both')) ||
        (band.to === cats[categoryIndex - 1]!.id && (band.divider === 'end' || band.divider === 'both')))),
    };
  });
}

/** Retain the resolved colour and its visibility floor when applying a forecast tint. */
export function forecastStroke(paint: Paint, theme: Theme, crossesBand: boolean): Paint {
  const result: Paint = { token: 'token' in paint ? paint.token : 'neutral', theme: { kind: 'line-forecast', base: paint, crossesBand } };
  paintColor(theme, result);
  return result;
}

/** Filled charts share the paint boundary. A plain line keeps the divider off its points. */
export function forecastDividerAt(domain: Pick<LineDomain, 'isArea' | 'fan' | 'phases'>): 'point' | 'band' {
  return domain.isArea || domain.fan || domain.phases ? 'point' : 'band';
}

/**
 * `actual`: a filled chart (line.area and line.stacked-area) also names the
 * actual side, right-aligned 4 px left of the divider ("AC | FC"). It is offered only on a seat
 * that stays inside the plot and left of the divider; with no such seat it is not requested,
 * because the subtitle already names the scenarios.
 */
export function placeForecastHeaders(boundaries: ForecastBoundary[], xOf: (index: number) => number, plot: Rect, headerY: number, font: FontSpec, measure: TextMeasurer, requests: LabelRequest[], occupied: OccupiedIndex, header = localeStrings().forecastHeader, boundaryAt: 'point' | 'band' = 'point', actual?: string): void {
  const measured = measure(header, font);
  const actualSize = actual ? measure(actual, font) : undefined;
  const ordered = [...boundaries].sort((a, b) => forecastBoundaryX(a, xOf, boundaryAt) - forecastBoundaryX(b, xOf, boundaryAt));
  for (const [index, boundary] of ordered.entries()) {
    const x = forecastBoundaryX(boundary, xOf, boundaryAt);
    const end = ordered[index + 1] ? forecastBoundaryX(ordered[index + 1]!, xOf, boundaryAt) : plot.x + plot.w;
    const annotationId = `forecast:${boundary.id}`;
    if (!boundary.divided) occupied.claim({ x: x - 0.5, y: plot.y, w: 1, h: plot.h }, 'annotation', { annotationId }, 'forecastDivider');
    if (boundary.labelled) continue;
    const at = (left: number) => ({ x: Math.max(x, Math.min(left, end - measured.width)), y: headerY + 2, w: measured.width, h: measured.height });
    const start = index > 0 ? forecastBoundaryX(ordered[index - 1]!, xOf, boundaryAt) + 4 : plot.x;
    if (actual && actualSize && ordered.length === 1 && x - 4 - actualSize.width >= start) {
      const actualId = `forecast:actual:${boundary.id}`;
      requests.push({
        id: actualId, kind: 'annotation', role: 'caption', owner: { annotationId }, text: actual, lines: [actual], typeRole: 'secondary', font,
        priority: PRIORITY.valueLine,
        candidates: [{ slot: 'forecastTopActual', rect: { x: x - 4 - actualSize.width, y: headerY + 2, w: actualSize.width, h: actualSize.height }, penalty: 0 }],
      });
    }
    requests.push({
      id: annotationId, kind: 'annotation', role: 'caption', owner: { annotationId }, text: header, lines: [header], typeRole: 'secondary', font,
      priority: PRIORITY.valueLine,
      candidates: [
        { slot: 'forecastTop', rect: at(x + 4), penalty: 0 },
        { slot: 'forecastTopStart', rect: at(x), penalty: 1 },
        { slot: 'forecastTopCentre', rect: at((x + end - measured.width) / 2), penalty: 2 },
        { slot: 'forecastTopEnd', rect: at(end - measured.width - 4), penalty: 3 },
      ],
    });
  }
}

/**
 * The actual-side caption of a filled chart. It pairs with the default
 * forecast code only: an authored forecast header has no matching actual word, so the
 * actual side then stays unnamed.
 */
export function actualHeader(domain: Pick<LineDomain, 'isArea' | 'options'>): string | undefined {
  if (!domain.isArea) return undefined;
  const options = domain.options;
  if (options.strings?.forecastHeader !== chartString({ ...options, strings: undefined }, 'forecastHeader')) return undefined;
  return chartString(options, 'actualHeader');
}

/** The divider between actual and forecast, unless authored furniture already divides there. */
export function emitForecastDividers(theme: Theme, boundaries: ForecastBoundary[], xOf: (index: number) => number, plot: Rect, nodes: SceneNode[], at: 'point' | 'band' = 'point'): void {
  for (const boundary of boundaries) {
    if (boundary.divided) continue;
    const x = forecastBoundaryX(boundary, xOf, at);
    nodes.push({ t: 'line', id: `forecast-divider:${boundary.id}`, x1: x, x2: x,
      y1: plot.y, y2: plot.y + plot.h, stroke: { token: 'leader' }, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference'),
      owner: { annotationId: `forecast:${boundary.id}` }, part: 'forecastDivider' });
  }
}

/**
 * A value on a forecast band reads as one on an actual band does: a box in
 * the forecast region's own fill covers the hatch under it, and the value
 * keeps the ink the solver chose against the band. A forecast value off its band, over a
 * plain area's line, keeps the page halo where the hatch may cross it.
 */
export function backForecastAreaLabels(labels: PlacedLabel[], series: NormSer[], cats: Category[], plot: Rect, bandFill: (series: NormSer, dataIdx: number, forecast: boolean) => Paint, nodes: SceneNode[]): void {
  for (const label of labels) {
    if (label.hidden || label.backing || !label.owner.seriesId || !label.owner.categoryId) continue;
    const dataIdx = series.findIndex((item) => item.id === label.owner.seriesId);
    if (dataIdx < 0) continue;
    const owner = series[dataIdx]!;
    const start = forecastStart(owner, cats);
    const ci = cats.findIndex((cat) => cat.id === label.owner.categoryId);
    // The last actual's value inside its band reaches over the divider into the hatch, so it gets a plate in its own (actual) fill.
    const lastActual = ci === start - 1 && label.slot.startsWith('insideBand');
    if (start < 0 || ci < start && !lastActual) continue;
    const x = label.rect.x + label.rect.w / 2;
    const y = label.rect.y + label.rect.h / 2;
    if (x < plot.x || x > plot.x + plot.w || y < plot.y || y > plot.y + plot.h) continue;
    if (label.slot.startsWith('insideBand')) {
      nodes.push({ t: 'rect', id: `label-backing:${label.id}`, rect: inflate(label.rect, 1), fill: bandFill(owner, dataIdx, !lastActual), owner: label.owner, part: 'labelBacking' });
      continue;
    }
    // Off its band the value stands on a page-colour plate, in front of the hatch.
    nodes.push({ t: 'rect', id: `plate:${label.id}`, rect: labelPlate(label.rect), fill: { token: 'background' }, radius: LABEL_PLATE_RADIUS, owner: label.owner, part: 'labelPlate' });
    label.halo = false;
    if ('token' in label.ink && (label.ink.token === 'ink' || label.ink.token === 'inkInverse' || label.ink.theme?.kind === 'contrast-ink')) label.ink = { token: 'ink' };
  }
}
