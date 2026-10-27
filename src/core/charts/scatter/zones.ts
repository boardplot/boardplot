import { fmtPathNumber as fmtN } from '../../curve';
import { chartString } from '../../strings/scatter';
import type { Theme } from '../../types/theme';
import { strokeToken } from '../../theme';
/**
 * Authored strategy zones on the scatter engine: validation (phase 1) and the
 * background geometry (phase 2). Universe: every cell in the derived grid, or
 * every authored polygon. Fills are decoration and therefore do not claim;
 * their boundary rules and every visible label do claim into the same index as
 * point marks and annotations. The labels themselves are planned in phase 3
 * from the `ZoneLabelSite`s returned here.
 */

import type { Rect } from '../../geometry';
import { cubicPoint, monotoneSegments } from '../../curve';
import type { LegendItemInput } from '../../frame';
import { PALETTE_NORMAL_FLOOR } from '../../themeRules';
import { NormalizeError } from '../../normalize/shared';
import type { Id } from '../../types/cell';
import type { OccupiedIndex } from '../../label/occupied';
import type { Paint, PaintToken, SceneNode } from '../../types/scene';
import { type ScatterDomain, type ScatterEnv, type ScatterPlotArea } from './model';
import type {
  ScatterStrategyOptions,
  StrategyZoneCell,
  StrategyZoneGrid,
  StrategyZoneMark,
  StrategyZoneRegion,
  StrategyZonesDerived,
  StrategyZoneTone,
} from './types';
import { maxOf, minOf } from '../../arrays';

/** Gap between a zone band label and the plot or axis it sits beside. */
export const ZONE_BAND_GAP = 5;
/** The page-colour gap between grid cells (scatter.matrix). */
const CELL_GAP = 2;

/** Whether the chart draws a strategy grid. */
export function gridZones(options: ScatterEnv['options']): boolean {
  return options.zones !== undefined && 'grid' in options.zones && options.zones.grid !== undefined;
}

/**
 * The axes of a strategy grid that print band labels over equal cells: they
 * print no tick numbers, the bands name the thirds (scatter.matrix). An
 * uneven or log axis keeps its numbers.
 */
export function bandedAxes(env: Pick<ScatterEnv, 'options'>, domain: Pick<ScatterDomain, 'evenGrid'>): { x: boolean; y: boolean } {
  const zones = env.options.zones;
  const grid = zones && 'grid' in zones ? zones.grid : undefined;
  return {
    x: (grid?.xLabels?.length ?? 0) > 0 && domain.evenGrid?.x === true,
    y: (grid?.yLabels?.length ?? 0) > 0 && domain.evenGrid?.y === true,
  };
}

/** Where a zone label may go: the box it has to stay inside, and what it says. */
export interface ZoneLabelSite {
  kind: 'cell' | 'region' | 'xBand' | 'yBand';
  id: Id;
  text: string;
  /** A band label as wrapped; one line when absent. */
  lines?: string[];
  box: Rect;
}

/** Phase 2 output for the zones: marks, descriptions and label sites. */
export interface ZoneGeometry {
  marks: StrategyZoneMark[];
  descriptions: string[];
  derived?: StrategyZonesDerived;
  labels: ZoneLabelSite[];
}

/** A zone keyed in the legend row names itself with its label and shows its fill as the swatch. */
function refuseUnkeyableZone(zone: StrategyZoneCell | StrategyZoneRegion, path: string): void {
  if ((zone.labelAt ?? 'plot') === 'plot') return;
  if (!zone.label || zone.tone === 'none') {
    throw new NormalizeError(
      'zone-key-unkeyable',
      `${path}.labelAt`,
      `strategy zone '${zone.id}' is keyed in the legend (labelAt '${zone.labelAt}') ${zone.label ? "with tone 'none', so its swatch would be empty" : 'without a label to key it by'}`,
      zone.label ? "give the zone a tone, or keep labelAt 'plot'" : "add a label, or keep labelAt 'plot'",
    );
  }
}

export function validateStrategyZones(options: ScatterStrategyOptions): void {
  const zones = options.zones;
  if (!zones) return;
  if (zones.grid) {
    const { grid } = zones;
    for (const axis of ['x', 'y'] as const) {
      if (!Array.isArray(grid[axis]) || grid[axis].length === 0) {
        throw new NormalizeError(
          'zone-thresholds-empty',
          `options.zones.grid.${axis}`,
          `strategy-zone ${axis} thresholds require at least one value`,
        );
      }
      grid[axis].forEach((value, index) => {
        if (!Number.isFinite(value)) {
          throw new NormalizeError(
            'zone-threshold-nonfinite',
            `options.zones.grid.${axis}[${index}]`,
            'strategy-zone thresholds must be finite',
          );
        }
        if (index > 0 && !(value > grid[axis][index - 1]!)) {
          throw new NormalizeError(
            'zone-threshold-order',
            `options.zones.grid.${axis}[${index}]`,
            'strategy-zone thresholds must be strictly increasing',
          );
        }
      });
    }
    for (const [axis, labels, expected] of [
      ['x', grid.xLabels, grid.x.length + 1],
      ['y', grid.yLabels, grid.y.length + 1],
    ] as const) {
      if (labels && labels.length !== expected) {
        throw new NormalizeError(
          'zone-band-label-count',
          `options.zones.grid.${axis}Labels`,
          `strategy-zone ${axis} band labels require exactly ${expected} entries`,
        );
      }
    }
    const ids = new Set<Id>();
    const positions = new Set<string>();
    for (const [index, cell] of (grid.cells ?? []).entries()) {
      if (ids.has(cell.id)) {
        throw new NormalizeError(
          'duplicate-id',
          `options.zones.grid.cells[${index}]`,
          `duplicate strategy-zone cell id '${cell.id}'`,
        );
      }
      ids.add(cell.id);
      if (cell.column > grid.x.length || cell.row > grid.y.length) {
        throw new NormalizeError(
          'zone-cell-outside-grid',
          `options.zones.grid.cells[${index}]`,
          `strategy-zone cell '${cell.id}' addresses row ${cell.row}, column ${cell.column} outside the derived grid`,
        );
      }
      const position = `${cell.column}:${cell.row}`;
      if (positions.has(position)) {
        throw new NormalizeError(
          'zone-cell-duplicate-position',
          `options.zones.grid.cells[${index}]`,
          `more than one strategy-zone cell addresses row ${cell.row}, column ${cell.column}`,
        );
      }
      positions.add(position);
      refuseUnkeyableZone(cell, `options.zones.grid.cells[${index}]`);
    }
    return;
  }

  if (!Array.isArray(zones.regions) || zones.regions.length === 0) {
    throw new NormalizeError(
      'zone-regions-empty',
      'options.zones.regions',
      'strategy zones require at least one region',
    );
  }
  const ids = new Set<Id>();
  for (const [index, region] of zones.regions.entries()) {
    validateZoneRegion(region, index);
    refuseUnkeyableZone(region, `options.zones.regions[${index}]`);
    if (ids.has(region.id)) {
      throw new NormalizeError(
        'duplicate-id',
        `options.zones.regions[${index}]`,
        `duplicate strategy-zone region id '${region.id}'`,
      );
    }
    ids.add(region.id);
  }
}

function validateZoneRegion(region: StrategyZoneRegion, index: number): void {
  if (!region.id) {
    throw new NormalizeError(
      'missing-id',
      `options.zones.regions[${index}]`,
      'strategy-zone region requires an id',
    );
  }
  if (!Array.isArray(region.points) || region.points.length < 3) {
    throw new NormalizeError(
      'zone-region-too-short',
      `options.zones.regions[${index}].points`,
      'strategy-zone polygon requires at least three points',
    );
  }
  region.points.forEach((point, pointIndex) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new NormalizeError(
        'zone-region-nonfinite',
        `options.zones.regions[${index}].points[${pointIndex}]`,
        'strategy-zone polygon points must be finite',
      );
    }
  });
}

/**
 * A zone is larger than a point: 'info' takes the focus, which falls back to
 * the highlight, and a good, bad or warn wash takes its fill twin.
 */
function zoneToneToken(tone: StrategyZoneTone | undefined, fill = false): PaintToken {
  if (tone === 'good') return fill ? 'goodFill' : 'good';
  if (tone === 'bad') return fill ? 'badFill' : 'bad';
  if (tone === 'warn') return fill ? 'warnFill' : 'warn';
  if (tone === 'info') return 'focus';
  return 'neutral';
}

// A zone wash walks back from 0.91 toward its tone
// until it clears the 1.1 fill-separation floor against the page, so a
// region stays visible on a dark ground. On a dark page a toned wash also
// walks back until it sits the swatch floor (12 OKLab) from the neutral
// wash: at 0.91 the two are 2.5 to 3.4 apart there and read as one grey.
const neutralWash: Paint = { token: 'neutral', theme: { kind: 'visible-tint', base: { token: 'neutral' }, amount: 0.91, floor: 1.1 } };
const zoneFill = (tone: StrategyZoneTone | undefined): Paint | undefined => {
  if (tone === 'none') return undefined;
  if (tone === undefined || tone === 'neutral') return neutralWash;
  const token = zoneToneToken(tone, true);
  return { token, theme: { kind: 'visible-tint', base: { token }, amount: 0.91, floor: 1.1, darkApartFrom: { paint: neutralWash, distance: PALETTE_NORMAL_FLOOR } } };
};

/** The legend entries of the zones whose label goes to the key row (labelAt 'key' or 'both'), in authored order. */
export function zoneKeyItems(options: ScatterStrategyOptions): LegendItemInput[] {
  const zones = options.zones;
  const keyed = [...(zones?.grid?.cells ?? []), ...(zones?.regions ?? [])].filter((zone) => (zone.labelAt ?? 'plot') !== 'plot' && zone.label);
  return keyed.map((zone) => ({ id: `zone:${zone.id}`, label: zone.label!, paint: zoneFill(zone.tone) ?? neutralWash, key: 'box' as const }));
}

const captionedInPlot = (zone: StrategyZoneCell | StrategyZoneRegion | undefined): boolean =>
  zone?.label !== undefined && (zone.labelAt ?? 'plot') !== 'key';

const zoneStroke = (tone: StrategyZoneTone | undefined): Paint => ({
  token: zoneToneToken(tone),
  tint: 0.55,
});

/** Every cell of the derived grid: its fill, its mark and, when authored, its label site. */
function gridZoneCells(
  grid: StrategyZoneGrid,
  bounds: { x: number[]; y: number[] },
  area: ScatterPlotArea,
  fmt: ScatterEnv['axisFmt'],
  nodes: SceneNode[],
  out: ZoneGeometry,
  options: ScatterEnv['options'],
): void {
  const { x, y } = area;
  const { x: xBounds, y: yBounds } = bounds;
  const cellByPosition = new Map((grid.cells ?? []).map((cell) => [`${cell.column}:${cell.row}`, cell] as const));
  for (let row = 0; row < yBounds.length - 1; row++) {
    for (let column = 0; column < xBounds.length - 1; column++) {
      const authored = cellByPosition.get(`${column}:${row}`);
      const id = authored?.id ?? `r${row + 1}-c${column + 1}`;
      const left = x(xBounds[column]!);
      const right = x(xBounds[column + 1]!);
      const top = y(yBounds[row + 1]!);
      const bottom = y(yBounds[row]!);
      const rect: Rect = {
        x: Math.min(left, right),
        y: Math.min(top, bottom),
        w: Math.abs(right - left),
        h: Math.abs(bottom - top),
      };
      const nodeId = `zone:cell:${id}`;
      const description =
        authored?.a11y ??
        chartString(options, 'zoneDesc', { v1: authored?.label ?? chartString(options, 'zoneName', { v1: row + 1, v2: column + 1 }), v2: fmt.x(xBounds[column]!), v3: fmt.x(xBounds[column + 1]!), v4: fmt.y(yBounds[row]!), v5: fmt.y(yBounds[row + 1]!) });
      const fill = zoneFill(authored?.tone);
      if (fill) {
        nodes.push({
          t: 'rect',
          id: nodeId,
          rect,
          fill,
          owner: { categoryId: `zone:${id}` },
          part: 'strategyZoneCell',
          display: { state: description },
        });
      }
      const captioned = captionedInPlot(authored);
      out.marks.push({
        id,
        kind: 'cell',
        ...(fill ? { nodeId } : {}),
        ...(captioned ? { labelId: `zone:label:${id}` } : {}),
        description,
      });
      out.descriptions.push(description);
      if (captioned) out.labels.push({ kind: 'cell', id: `zone:label:${id}`, text: authored!.label!, box: rect });
    }
  }
}

/** The grid's threshold rules, and the lanes beside the plot where band labels go. */
function gridZoneRules(
  grid: StrategyZoneGrid,
  bounds: { x: number[]; y: number[] },
  area: ScatterPlotArea,
  nodes: SceneNode[],
  labels: ZoneLabelSite[],
): void {
  const { x, y, plot } = area;
  for (const threshold of grid.x) {
    const px = x(threshold);
    nodes.push({
      t: 'line',
      id: `zone:grid:x:${threshold}`,
      x1: px,
      y1: plot.y,
      x2: px,
      y2: plot.y + plot.h,
      // A page-colour rule leaves a gap between the tinted cells (scatter.matrix).
      stroke: { token: 'background' },
      width: CELL_GAP,
      owner: {},
      part: 'strategyZoneBoundary',
    });
    // The gap is page colour, so a name may run across it into the next cell (scatter.matrix: Bravo); it claims nothing.
  }
  for (const threshold of grid.y) {
    const py = y(threshold);
    nodes.push({
      t: 'line',
      id: `zone:grid:y:${threshold}`,
      x1: plot.x,
      y1: py,
      x2: plot.x + plot.w,
      y2: py,
      stroke: { token: 'background' },
      width: CELL_GAP,
      owner: {},
      part: 'strategyZoneBoundary',
    });

  }
  grid.xLabels?.forEach((text, column) => {
    const left = x(bounds.x[column]!);
    const right = x(bounds.x[column + 1]!);
    labels.push({
      kind: 'xBand',
      id: `zone:x-band:${column}`,
      text,
      ...(area.xBandLines?.[column] ? { lines: area.xBandLines[column] } : {}),
      box: { x: Math.min(left, right), y: plot.y + plot.h + area.xAxisH, w: Math.abs(right - left), h: area.xBandH },
    });
  });
  grid.yLabels?.forEach((text, row) => {
    const top = y(bounds.y[row + 1]!);
    const bottom = y(bounds.y[row]!);
    labels.push({
      kind: 'yBand',
      id: `zone:y-band:${row}`,
      text,
      ...(area.yBandLines?.[row] ? { lines: area.yBandLines[row] } : {}),
      box: { x: area.inner.x, y: Math.min(top, bottom), w: area.yBandW, h: Math.abs(bottom - top) },
    });
  });
}

/** Authored polygons: fill and outline, boundary claims, and a label site over each one's bounds. */
function regionZones(
  theme: Theme,
  regions: StrategyZoneRegion[],
  area: ScatterPlotArea,
  nodes: SceneNode[],
  claims: OccupiedIndex,
  out: ZoneGeometry,
  options: ScatterEnv['options'],
): void {
  for (const region of regions) {
    const points = region.points.map((point) => ({ x: area.x(point.x), y: area.y(point.y) }));
    const d = region.smooth ? smoothClosedZonePath(points) : polygonPath(points);
    const nodeId = `zone:region:${region.id}`;
    const description =
      region.a11y ?? chartString(options, 'regionBoundaryDesc', { v1: region.label ?? region.id, v2: region.points.length });
    const fill = zoneFill(region.tone);
    nodes.push({
      t: 'path',
      id: nodeId,
      d,
      ...(fill ? { fill } : {}),
      stroke: zoneStroke(region.tone),
      width: strokeToken(theme, 'rule'),
      owner: { categoryId: `zone:${region.id}` },
      part: 'strategyZoneRegion',
      display: { state: description },
    });
    claimZoneBoundary(points, region.smooth ?? false, claims, { categoryId: `zone:${region.id}` });
    out.marks.push({
      id: region.id,
      kind: 'region',
      nodeId,
      ...(captionedInPlot(region) ? { labelId: `zone:label:${region.id}` } : {}),
      description,
    });
    out.descriptions.push(description);
    if (captionedInPlot(region)) {
      out.labels.push({ kind: 'region', id: `zone:label:${region.id}`, text: region.label!, box: pointBounds(points) });
    }
  }
}

/**
 * Phase 2, zones: the authored grid or regions as background geometry. Fills
 * and rules go onto `nodes`, boundary rules claim into the phase's `claims`.
 */
export function layoutScatterZones(
  env: ScatterEnv,
  domain: ScatterDomain,
  area: ScatterPlotArea,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): ZoneGeometry {
  const zones = env.options.zones;
  const out: ZoneGeometry = { marks: [], descriptions: [], labels: [] };
  if (zones && 'grid' in zones && zones.grid) {
    const grid = zones.grid;
    const bounds = { x: [domain.dx[0], ...grid.x, domain.dx[1]], y: [domain.dy[0], ...grid.y, domain.dy[1]] };
    gridZoneCells(grid, bounds, area, env.axisFmt, nodes, out, env.options);
    gridZoneRules(grid, bounds, area, nodes, out.labels);
    out.derived = { kind: 'grid', descriptions: out.descriptions, cellCount: out.marks.length };
  } else if (zones?.regions) {
    regionZones(env.theme, zones.regions, area, nodes, claims, out, env.options);
    out.derived = { kind: 'regions', descriptions: out.descriptions, regionCount: out.marks.length };
  }
  return out;
}

function pointBounds(points: readonly { x: number; y: number }[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = minOf(xs);
  const y = minOf(ys);
  return {
    x,
    y,
    w: maxOf(xs) - x,
    h: maxOf(ys) - y,
  };
}

function polygonPath(points: readonly { x: number; y: number }[]): string {
  return `${points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${fmtN(point.x)} ${fmtN(point.y)}`)
    .join('')}Z`;
}

function claimZoneBoundary(
  points: readonly { x: number; y: number }[],
  smooth: boolean,
  occupied: OccupiedIndex,
  owner: { categoryId: string },
): void {
  const cubics = smooth ? smoothClosedZoneSegments(points) : [];
  const samples = cubics.length
    ? cubics.flatMap((segment) =>
        Array.from({ length: 9 }, (_, index) => cubicPoint(segment, index / 8)),
      )
    : points.flatMap((point, index) => {
        const next = points[(index + 1) % points.length]!;
        return Array.from({ length: 9 }, (_, sample) => ({
          x: point.x + (next.x - point.x) * sample / 8,
          y: point.y + (next.y - point.y) * sample / 8,
        }));
      });
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1]!;
    const to = samples[index]!;
    occupied.claim(
      {
        x: Math.min(from.x, to.x) - 0.5,
        y: Math.min(from.y, to.y) - 0.5,
        w: Math.abs(to.x - from.x) + 1,
        h: Math.abs(to.y - from.y) + 1,
      },
      'axis',
      owner,
      'strategyZoneBoundary',
    );
  }
}

/**
 * Closed smoothing through the shared Steffen authority. The polygon is
 * parameterised by vertex order, then x(t) and y(t) are interpolated with the
 * same limiter. Prepending/appending neighbours gives the closing segment the
 * same cyclic derivative context as every interior segment.
 */
function smoothClosedZonePath(points: readonly { x: number; y: number }[]): string {
  if (points.length < 3) return polygonPath(points);
  const segments = smoothClosedZoneSegments(points);
  return (
    `M${fmtN(points[0]!.x)} ${fmtN(points[0]!.y)}` +
    segments
      .map(
        (segment) =>
          `C${fmtN(segment.c1.x)} ${fmtN(segment.c1.y)} ${fmtN(segment.c2.x)} ${fmtN(segment.c2.y)} ${fmtN(segment.to.x)} ${fmtN(segment.to.y)}`,
      )
      .join('') +
    'Z'
  );
}

interface ZoneCubic {
  from: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  to: { x: number; y: number };
}

function smoothClosedZoneSegments(
  points: readonly { x: number; y: number }[],
): ZoneCubic[] {
  const cyclic = [points[points.length - 1]!, ...points, points[0]!, points[1]!];
  const xSeries = cyclic.map((point, index) => ({ x: index - 1, y: point.x }));
  const ySeries = cyclic.map((point, index) => ({ x: index - 1, y: point.y }));
  const xSegments = monotoneSegments(xSeries).slice(1, points.length + 1);
  const ySegments = monotoneSegments(ySeries).slice(1, points.length + 1);
  return xSegments.map((segment, index) => {
    const ySegment = ySegments[index]!;
    return {
      from: { x: segment.from.y, y: ySegment.from.y },
      c1: { x: segment.c1.y, y: ySegment.c1.y },
      c2: { x: segment.c2.y, y: ySegment.c2.y },
      to: { x: segment.to.y, y: ySegment.to.y },
    };
  });
}
