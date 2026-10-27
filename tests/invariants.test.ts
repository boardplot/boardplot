import { requireGeometry } from '../src/core/sizing';
// @ts-expect-error jsdom is a test dependency without bundled declarations.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import '../src/core/charts';
import '../src/core/geo/packs';
import { contrastRatio } from '../src/core/color';
import { getFixtures } from '../src/fixtures';
import { fixtureTags } from '../src/fixtures/registry';
import { rectContains, rectHitsConvexPolygon, rectsOverlap, segmentHitsRect } from '../src/core/geometry';
import type { OccupiedClaim } from '../src/core/label/occupied';
import { CROSSABLE_RULE_PART } from '../src/core/label/solver';
import { isColumnPart, isOwnMark } from '../src/core/label/solver';
import { aspectDocLints } from '../src/core/lint/aspect';
import { lineIntegrityDocLints } from '../src/core/lint/lineIntegrity';
import { spaceDocLints } from '../src/core/lint/space';
import { typeDocLints } from '../src/core/lint/type';
import { getChartDefinition, listCharts } from '../src/core/registry';
import { renderSvg } from '../src/core/svg/renderSvg';
import { measureText } from '../src/core/text';
import { effectiveFill, paintColor, resolveTheme } from '../src/core/theme';
import type { Geometry, LintWarning } from '../src/core/types/scene';
import type { Theme } from '../src/core/types/theme';

const CANVAS_TOLERANCE = 0.02;
const CARD_WIDTH = 400;
const MEKKO_MODES = ['stacked100', 'stacked', 'bar'] as const;

function fixtureMode(type: string, options: { variant?: unknown } | undefined): string {
  if (type === 'mekko') return String(options?.variant ?? 'stacked100');
  return 'accepted';
}

const allCases = listCharts().flatMap(({ type }) =>
  getFixtures(type).map(fixture => ({ type, fixtureId: fixture.id, mode: fixtureMode(type, fixture.options) })),
);

// tests/svg-wellformed.test.ts owns the XML rules and the hostile inputs, but on
// one chart. Well-formedness is a property of every renderer, so the parse runs
// here too, where the cases are already derived from the registry.
const { window } = new JSDOM();
function parseFault(svg: string): string | undefined {
  const doc = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
  return doc.getElementsByTagName('parsererror')[0]?.textContent ?? undefined;
}

/** One layout per fixture, the way the CLI and the goldens lay it out, with the document lints it draws. */
function layoutFixture(type: string, fixtureId: string, width?: number): { geometry: Geometry; warnings: LintWarning[] } {
  const definition = getChartDefinition(type)!;
  const fixture = getFixtures(definition.type).find((candidate) => candidate.id === fixtureId)!;
  const options = {
    ...definition.defaults,
    ...definition.optionsSchema.parse(structuredClone(fixture.options ?? {})),
    ...(fixture.annotations ? { annotations: structuredClone(fixture.annotations) } : {}),
    ...(width ? { size: { width } } : {}),
  };
  const geometry = requireGeometry(definition.layout(definition.normalize(structuredClone(fixture.data)), options));
  return { geometry, warnings: [
    ...geometry.warnings,
    ...aspectDocLints(type, options, geometry),
    ...spaceDocLints(type, options, geometry),
    ...typeDocLints(type, options, geometry),
    ...lineIntegrityDocLints(type, options, geometry),
  ] };
}

function legacyOwnMark(
  label: { kind: string; owner: { categoryId?: string; seriesId?: string } },
  occupied: { part?: string; owner: { categoryId?: string; seriesId?: string } },
): boolean {
  if (
    label.owner.categoryId === occupied.owner.categoryId &&
    label.owner.seriesId === occupied.owner.seriesId
  ) {
    return true;
  }
  return (
    (label.kind === 'total' || label.kind === 'grandTotal') &&
    label.owner.seriesId === undefined &&
    label.owner.categoryId !== undefined &&
    occupied.owner.categoryId === label.owner.categoryId &&
    (occupied.part === 'segment' || occupied.part === 'bar')
  );
}

function primitiveBounds(
  node: Geometry['scene'][number],
): { x: number; y: number; w: number; h: number } | null {
  const tx = node.tx ?? 0;
  const ty = node.ty ?? 0;
  if (node.t === 'rect') {
    const stroke = (node.strokeWidth ?? 0) / 2;
    return {
      x: node.rect.x + tx - stroke,
      y: node.rect.y + ty - stroke,
      w: node.rect.w + 2 * stroke,
      h: node.rect.h + 2 * stroke,
    };
  }
  if (node.t === 'line') {
    const stroke = node.width / 2;
    const dx = node.x2 - node.x1;
    const dy = node.y2 - node.y1;
    const length = Math.hypot(dx, dy) || 1;
    const cap = node.lineCap ?? 'butt';
    const padX = cap === 'round' ? stroke : stroke * (Math.abs(dy) + (cap === 'square' ? Math.abs(dx) : 0)) / length;
    const padY = cap === 'round' ? stroke : stroke * (Math.abs(dx) + (cap === 'square' ? Math.abs(dy) : 0)) / length;
    return {
      x: Math.min(node.x1, node.x2) + tx - padX,
      y: Math.min(node.y1, node.y2) + ty - padY,
      w: Math.abs(dx) + 2 * padX,
      h: Math.abs(dy) + 2 * padY,
    };
  }
  if (node.t === 'circle') {
    return {
      x: node.cx + tx - node.r,
      y: node.cy + ty - node.r,
      w: 2 * node.r,
      h: 2 * node.r,
    };
  }
  return null;
}

function assertSeriesIdentity(type: string, geometry: Geometry, fixtureId: string): void {
  const fixture = getFixtures(type).find(entry => entry.id === fixtureId)!;
  // Legacy/manual layouts allow authors to omit identity labels. The automatic
  // legend contract must preserve names when it replaces keys with direct labels.
  const auto = fixture.options?.legend === 'auto' || fixture.options?.legend === undefined &&
    resolveTheme(fixture.options?.theme).legend?.auto === true;
  const explicitKeys = ['top', 'bottom', 'left', 'right'].includes(fixture.options?.legend);
  if ((!auto && !explicitKeys) || fixture.options?.labels === false) return;
  for (const item of geometry.legend?.items ?? []) {
    const node = geometry.scene.find(node => node.id === item.labelId);
    expect(node?.t === 'text' && node.lines.join('').trim().length > 0,
      `${type}/${fixtureId}: key ${item.id} has no visible label`).toBe(true);
  }
  const series = (fixture.data as { series?: { id: string; label?: string }[] }).series;
  if (!Array.isArray(series) || type === 'pie') return;
  const visible = geometry.scene.filter(node => node.t === 'text' &&
    !geometry.labels.some(label => label.nodeId === node.id && label.hidden));
  for (const entry of series) {
    // Fan bounds are identified by their interval key, not separate low/high keys.
    const band = type === 'line' ? fixture.options?.fan?.bands?.findIndex(
      (band: { low: string; high: string }) => band.low === entry.id || band.high === entry.id) : undefined;
    if (band !== undefined && band >= 0) {
      expect(geometry.legend?.items.some(item => item.id === `fan:${band}`),
        `${type}/${fixtureId}: interval ${band} has no key`).toBe(true);
      continue;
    }
    if (!geometry.scene.some(node => node.t !== 'text' && node.owner.seriesId === entry.id)) continue;
    const name = (entry.label ?? entry.id).replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');
    const named = visible.some(node => node.t === 'text' &&
      (node.owner.seriesId === entry.id || geometry.legend?.items.some(item => item.id === entry.id && item.labelId === node.id) ||
        series.length === 1 && [geometry.frame.titleNodeId, geometry.frame.subtitleNodeId].includes(node.id)) &&
      node.lines.join(' ').replace(/\s+/gu, ' ').toLocaleLowerCase('en').includes(name));
    expect(named, `${type}/${fixtureId}: ${entry.id} has no visible name or key`).toBe(true);
  }
}

function assertContrast(type: string, geometry: Geometry, theme: Theme): void {
  expect(
    contrastRatio(theme.color.ink, theme.color.background),
    `${type}: ink on background`,
  ).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(theme.color.inkMuted, theme.color.background), `${type}: muted ink on background`)
    .toBeGreaterThanOrEqual(3);
  for (const label of geometry.labels.filter((label) => !label.hidden)) {
    if (!('token' in label.ink) || label.ink.theme?.kind !== 'contrast-ink') continue;
    const fill = effectiveFill(paintColor(theme, label.ink.theme.fill), label.ink.theme.pattern, theme);
    expect(contrastRatio(paintColor(theme, label.ink), fill), `${type}: ${label.id} inside-label contrast`)
      .toBeGreaterThanOrEqual(3);
  }
}

function assertGeometry(type: string, geometry: Geometry, theme: Theme, fixtureId: string): void {
  const canvas = { x: 0, y: 0, w: geometry.size.width, h: geometry.size.height };
  for (const node of geometry.scene) {
    const bounds = primitiveBounds(node);
    if (bounds) {
      expect(rectContains(canvas, bounds, -CANVAS_TOLERANCE), `${type}: ${node.id} leaves canvas`).toBe(true);
    }
  }

  const nonPaintedClaims = new Set(['tableHeader', 'tableRow', 'tableColumn', 'funnel-row-lane']);
  for (const mark of geometry.debug.occupied.filter(
    (entry) => entry.kind === 'mark' && !nonPaintedClaims.has(entry.part ?? ''),
  )) {
    expect(rectContains(canvas, mark.rect, -CANVAS_TOLERANCE), `${type}: ${mark.part} leaves canvas`).toBe(true);
  }

  const visible = geometry.labels.filter((label) => !label.hidden);
  for (let left = 0; left < visible.length; left += 1) {
    const a = visible[left]!;
    expect(rectContains(canvas, a.rect, -1), `${type}: label ${a.id} leaves canvas`).toBe(true);
    const overlap = visible.slice(left + 1).find(b => rectsOverlap(a.rect, b.rect));
    expect(overlap, `${type}: ${a.id} overlaps ${overlap?.id}`).toBeUndefined();
  }

  const occupied: OccupiedClaim[] = geometry.debug.occupied.filter(
    (entry) => entry.kind === 'mark' || entry.kind === 'annotation',
  );
  // The drawn pieces of gantt event and today rules, as vertical segments [x, y1, y2].
  const rulePieces = geometry.scene.flatMap((node) => node.part !== 'eventRule' && node.part !== 'todayLine' ? []
    : node.t === 'line' ? [[node.x1, node.y1, node.y2] as const]
    : node.t === 'path' ? [...node.d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L-?[\d.]+ (-?[\d.]+)/g)].map((m) => [+m[1]!, +m[2]!, +m[3]!] as const) : []);
  for (const label of visible) {
    const overlap = occupied.find(item => {
      // Map-region bounding boxes overlap oceans and neighbouring countries.
      // They are not painted polygons; choropleth's own placement tests cover them.
      if (type === 'choropleth' && item.kind === 'mark') return false;
      if (
        item.kind === 'mark' &&
        item.part === 'funnel-row-lane' &&
        (label.owner.categoryId === undefined || label.owner.categoryId === item.owner.categoryId)
      ) return false;
      if (
        item.kind === 'mark' &&
        isOwnMark(item.owner, label.owner, label.kind, item.part) &&
        legacyOwnMark(label, item)
      ) return false;
      if (item.kind === 'annotation' && label.owner.annotationId === item.owner.annotationId) return false;
      // A gantt span or rule name may sit across an event or today rule (the crossableRule claim part):
      // the rule breaks around it. Only that part is exempt, and only while no drawn rule piece crosses the label.
      if (item.part === CROSSABLE_RULE_PART && label.kind === 'item') {
        const { x, y, w, h } = label.rect;
        return rulePieces.some(([px, y1, y2]) => px >= x && px <= x + w && Math.max(y1, y2) > y && Math.min(y1, y2) < y + h);
      }
      // A value that keeps its seat across a reference line does so on a halo (SlotCandidate.overRules),
      // and so does a scatter name across a trend or Pareto line (the solver's trendLine rule).
      if ((item.part === 'referenceLine' || item.part === 'trendLine') && label.halo === true) return false;
      // a line value whose point lies inside a column
      // is drawn at its point on that column: wholly on it and read against
      // its fill, or with a halo where it only crosses the page.
      if (item.kind === 'mark' && label.slot.endsWith('OnColumn') && isColumnPart(item.part)) return false;
      // A value in contrast ink reads against the ground it names: a fill it sits wholly on
      // (SlotCandidate.onFill), or a combo column, which draws over the area behind it.
      // assertContrast checks that ink.
      if (item.kind === 'mark' && item.part === 'areaFill' && 'token' in label.ink && label.ink.theme?.kind === 'contrast-ink') return false;
      // An area band claims its outline, not only its box.
      return rectsOverlap(label.rect, item.rect) && (item.polygon === undefined || rectHitsConvexPolygon(label.rect, item.polygon));
    });
    expect(overlap, `${type}: ${label.id} overlaps ${overlap?.kind}`).toBeUndefined();
  }

  const nodeIds = geometry.scene.map((node) => node.id);
  const labelIds = geometry.labels.map((label) => label.id);
  expect(new Set(nodeIds).size, `${type}: duplicate scene id`).toBe(nodeIds.length);
  expect(new Set(labelIds).size, `${type}: duplicate label id`).toBe(labelIds.length);
  for (const label of visible) {
    expect(label.nodeId, `${type}: ${label.id} has no node`).toBeDefined();
    expect(nodeIds).toContain(label.nodeId);
  }
  for (const annotation of geometry.annotations) {
    for (const nodeId of annotation.nodeIds) expect(nodeIds).toContain(nodeId);
    if (annotation.labelId) expect(labelIds).toContain(annotation.labelId);
  }

  assertSeriesIdentity(type, geometry, fixtureId);
  assertContrast(type, geometry, theme);
}

describe('every public chart', () => {
  it('is discovered from a populated registry and has a fixture', () => {
    expect(allCases.length).toBeGreaterThan(0);
    const types = [...new Set(allCases.map((entry) => entry.type))];
    expect(types).toHaveLength(listCharts().length);
    expect(new Set(allCases.filter((entry) => entry.type === 'mekko').map((entry) => entry.mode))).toEqual(new Set(MEKKO_MODES));
    for (const { type } of listCharts()) {
      expect(getFixtures(type).length, `${type} has no fixture`).toBeGreaterThan(0);
    }
  });

  // Allow report disclosure passes on world maps plus XML parsing.
  it.each(allCases)('$type / $mode / $fixtureId renders and verifies', ({ type, fixtureId }) => {
    const { geometry, warnings } = layoutFixture(type, fixtureId);
    const fixture = getFixtures(type).find((candidate) => candidate.id === fixtureId)!;
    const theme = resolveTheme((fixture.options as { theme?: unknown } | undefined)?.theme as never);
    assertGeometry(type, geometry, theme, fixtureId);

    const svg = renderSvg(geometry as never, theme);
    expect(svg).toContain('<svg');
    expect(parseFault(svg), `${type}: SVG is not well-formed XML`).toBeUndefined();

    // Demo fixtures must draw valid geometry and emit no error-severity diagnostic.
    // Warning contracts are checked by their relevant option or repair tests.
    if (!fixtureTags(fixture).includes('demo')) return;
    expect(warnings.filter((warning) => warning.severity === 'error'), `${type}/${fixtureId} emitted an error-severity warning`).toEqual([]);
  }, 60_000);

  // Goldens draw the default width only; dashboard cards are 320-480 px wide,
  // where most label collisions showed up. A fixture that refuses 400 px is fine.
  it.each(allCases)('$type / $mode / $fixtureId at a 400 px card keeps text apart', ({ type, fixtureId }) => {
    let laidOut: ReturnType<typeof layoutFixture>;
    try {
      laidOut = layoutFixture(type, fixtureId, CARD_WIDTH);
    } catch (error) {
      // A refusal (size-below-floor and the like) is an answer, not a collision.
      if (error instanceof Error && 'code' in error) return;
      throw error;
    }
    const fixture = getFixtures(type).find((candidate) => candidate.id === fixtureId)!;
    const theme = resolveTheme((fixture.options as { theme?: unknown } | undefined)?.theme as never);
    assertGeometry(type, laidOut.geometry, theme, fixtureId);
  }, 60_000);
});

/** The line box a text node draws: node.y is its top, each line one font line height. */
function textBox(node: Extract<Geometry['scene'][number], { t: 'text' }>) {
  const w = Math.max(...node.lines.map((line) => measureText(line, node.font).width));
  const x = node.align === 'start' ? node.x : node.align === 'end' ? node.x - w : node.x - w / 2;
  return { x: x + (node.tx ?? 0), y: node.y + (node.ty ?? 0), w, h: node.lines.length * node.font.size * (node.font.lineHeight ?? 1.2) };
}

// Prevents the heatmap's continuous key from clipping its unit ("€m") at the
// canvas top: the unit is centred on a bar shorter than its line box, and a
// dashboard card draws the chart with zero margins and its own title.
it('keeps every heatmap text inside the canvas at zero margins with no title', () => {
  const definition = getChartDefinition('heatmap')!;
  const fixture = getFixtures('heatmap').find((candidate) => candidate.id === 'regional-monthly-capped')!;
  const { title: _t, subtitle: _s, source: _src, ...rest } = structuredClone(fixture.options ?? {}) as Record<string, unknown>;
  const options = { ...definition.defaults, ...definition.optionsSchema.parse({ ...rest, canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } } }) };
  const geometry = requireGeometry(definition.layout(definition.normalize(structuredClone(fixture.data)), options));
  const canvas = { x: 0, y: 0, w: geometry.size.width, h: geometry.size.height };
  expect(geometry.scene.some((node) => node.id === 'scale:unit')).toBe(true);
  for (const node of geometry.scene) {
    if (node.t === 'text' && node.opacity !== 0) expect(rectContains(canvas, textBox(node), -CANVAS_TOLERANCE), `${node.id} leaves canvas`).toBe(true);
  }
});

// Prevents the pie's "labyrinth" of leaders: ten small slices sent their labels to one far
// column, and the leaders ran side by side and crossed. Each leader now runs straight from its
// slice's rim to its own label, and at the default size every slice keeps its label.
it('pie ten-tiny-slices: no leader crosses another leader or a label, and each ends at its own label', () => {
  const { geometry } = layoutFixture('pie', 'ten-tiny-slices');
  const outside = geometry.labels.filter((label) => !label.hidden && label.slot === 'outside');
  expect(outside).toHaveLength(11);
  const leaders = outside.map((label) => {
    const points = [...label.leader!.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    expect(points, label.id).toHaveLength(2);
    return { label, from: points[0]!, to: points[1]! };
  });
  const side = (p: { x: number; y: number }, q: { x: number; y: number }, s: { x: number; y: number }) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
  for (const a of leaders) {
    expect(rectsOverlap(a.label.rect, { x: a.to.x, y: a.to.y, w: 0, h: 0 }, 3), `${a.label.id} ends at its label`).toBe(true);
    for (const b of leaders) {
      if (a === b) continue;
      expect(segmentHitsRect(a.from, a.to, b.label.rect), `${a.label.id} crosses ${b.label.id}`).toBe(false);
      const crosses = side(a.from, a.to, b.from) * side(a.from, a.to, b.to) < 0 && side(b.from, b.to, a.from) * side(b.from, b.to, a.to) < 0;
      expect(crosses, `${a.label.id} crosses the leader of ${b.label.id}`).toBe(false);
    }
  }
});
