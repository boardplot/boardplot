/** One encoding shared by marks, keys, panel collectors and explanation policy. */
import { cellValue, type Cell, type Id } from './types/cell';
import type { Geometry, Paint, LintWarning, SeparationRule, HatchPattern, SceneNode } from './types/scene';
import type { Theme } from './types/theme';
import type { MarkerShape, ScatterData } from './types/data';
import { paintColor } from './theme';

/**
 * A key entry for what the engine left out of the drawing (a series, a column, a row, points): an empty
 * muted box and the words that say what is not drawn and why. Charts add it when the disclosure note
 * does not print, so the reader learns of the omission on the chart itself.
 */
export function omittedKey(id: Id, label: string): SeriesIdentity {
  return { id, label: label.replace(/\.$/, ''), paint: { token: 'inkMuted' }, pattern: 'outline', hollow: true };
}

export interface SeriesIdentity {
  id: Id;
  label: string;
  paint: Paint;
  pattern?: HatchPattern | 'outline';
  /** The ground under a hatched box key's stripes, as its mark has one (the key shows the mark). */
  hatchGround?: Paint;
  /** false: a hatched box key without its edge, as a status cell draws it. */
  hatchEdge?: false;
  /**
   * A line key with a background centre, or a box key for a hollow point: outlined whatever the theme's plan look,
   * which a `pattern: 'outline'` key follows.
   */
  hollow?: boolean;
  /**
   * 'harvey' draws a Harvey ball filled `level` quarters (0–4) in `paint`.
   * 'triangle' draws the anomaly flag marker, a triangle pointing up.
   * 'tick' draws a reference tick as a bar crosses it, a vertical stroke the
   * key's height; a column's tick is the horizontal 'line'. 'whisker' draws
   * an interval, a vertical stem with a cap at each end (every
   * reference is keyed in its real shape).
   */
  key?: 'box' | 'line' | 'marker' | 'harvey' | 'triangle' | 'diamond' | 'bracket' | 'tick' | 'whisker' | 'sizes' | 'glyph' | 'heading';
  /** 'glyph': the text a mark prints as its shape (a table's ↑ ↗ → ↘ ↓), in `paint` at the key font. */
  glyph?: string;
  /**
   * A box key that also keys a line style meaning the same thing: a short
   * stroke drawn after the box, so a hatched column and a dashed line that
   * both mean "forecast" share one entry.
   */
  withLine?: { paint: Paint; dash?: number[]; width?: number; lineCap?: 'butt' | 'round' | 'square' };
  /** A 'line' key for a line that draws point markers: a small mark of that shape at the line's centre, hollow as the plot's are. */
  marker?: { shape: Exclude<MarkerShape, 'none'>; hollow?: boolean };
  /** A 'line' key that keys a range rail draws the rail's end ticks too, as the plot draws them (dot ranges). */
  caps?: { paint: Paint; width?: number; half: number };
  /**
   * 'sizes': the radii of a size key's nested circles, drawn as rings in
   * `paint` on one baseline, largest first. The key row grows to the
   * largest ring (a mapped bubble size is keyed above the plot). The label names
   * the sizes they stand for.
   */
  radii?: number[];
  /** 'sizes': the least key row height the entry reserves, so a ring that shrinks between layout passes keeps its row. */
  ringRow?: number;
  level?: number;
  dash?: number[];
  lineCap?: 'butt' | 'round' | 'square';
  /** Stroke weight of a 'line', 'tick' or 'whisker' key, or of a marker's ring, as the mark draws it; 1.5 by default. */
  width?: number;
  /** A 'marker' key's radius when it draws the mark at the mark's own size; half the key box by default. */
  radius?: number;
  /**
   * Optional 1px outline on a `box` key, or the ring of a `marker` key (a
   * reference dot drawn with a ring over the bar it crosses). Added for the fan's tint ladder: its
   * band swatches are adjacent rungs of one hue, and at the 12px key size a
   * pair one separability step apart is two chips a reader cannot tell from one
   * chip — on `notation-dark` the outermost key is #232323 on a #080808 page. The
   * ladder is a legitimate encoding for a large WASH region and the same
   * numbers are not legible at 9px, so the chip gets an edge. Undefined
   * everywhere else, so no other legend in the repo moves by a pixel.
   */
  stroke?: Paint;
  /** Repaint the key's separating edge against the same backing as its mark. */
  separation?: SeparationRule;
  /** A formatted figure printed in bold after the name: a treemap group total. */
  value?: string;
}

export function identityAppearance(item: SeriesIdentity, theme: Theme): string {
  const color = (paint?: Paint) => paint ? paintColor(theme, paint) : null;
  return JSON.stringify([item.key ?? 'box', color(item.paint), color(item.stroke), item.pattern ?? null,
    item.hollow ?? false, color(item.hatchGround), item.hatchEdge ?? true, item.dash ?? [], item.lineCap ?? 'butt',
    item.glyph ?? null, item.level ?? null, item.width ?? null, item.radius ?? null, item.radii ?? null,
    item.withLine ? [color(item.withLine.paint), item.withLine.dash ?? []] : null, item.marker ? [item.marker.shape, item.marker.hollow ?? false] : null]);
}

/** Distinct names must have distinct key appearances, on every chart. */
export function identityCollisionWarnings(items: readonly SeriesIdentity[], theme: Theme): LintWarning[] {
  const groups = new Map<string, SeriesIdentity[]>();
  for (const item of items) {
    if (item.key === 'heading') continue;
    const appearance = identityAppearance(item, theme);
    const group = groups.get(appearance) ?? [];
    if (!group.some(previous => previous.label === item.label)) group.push(item);
    groups.set(appearance, group);
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => ({
    code: 'series-indistinguishable', severity: 'warn',
    message: `Keys ${group.map(item => `'${item.label}'`).join(', ')} have the same colour and shape`,
    suggest: "use distinct colours, shapes or patterns for distinct meanings; for series, group additive values into 'Other', use small multiples, or set distinct colorRole values or fills", owner: { seriesId: group.at(-1)!.id },
  }));
}

/** Reserve authored colours first. Only unspecified series may take another palette colour. */
export function distinguishSeries(items: SeriesIdentity[], explicit: Set<Id>, alternatives: Paint[], theme: Theme): SeriesIdentity[] {
  const resolved = new Map<Id, SeriesIdentity>();
  const seen = new Map<string, SeriesIdentity>();
  for (const item of [...items.filter(i => explicit.has(i.id)), ...items.filter(i => !explicit.has(i.id))]) {
    let next = item;
    if (!explicit.has(item.id) && seen.has(identityAppearance(item, theme))) {
      const paint = alternatives.find(p => !seen.has(identityAppearance({ ...item, paint: p }, theme)));
      if (paint) next = { ...item, paint };
    }
    const appearance = identityAppearance(next, theme);
    seen.set(appearance, next);
    resolved.set(item.id, next);
  }
  return items.map(item => resolved.get(item.id)!);
}

/** Existing required-key policy: direct names must cover every encoding. */
export function keepsUnnamedSeriesKey(type: string): boolean {
  return type === 'grid';
}

/** These charts cannot name multiple series through their default value labels. */
export function needsSeriesKey(type: string, data: unknown, options?: object, geometry?: Geometry<object, object>): boolean {
  // Tornado already draws its case key; keep that key's existing layout.
  if (type === 'bar' && (options as { variant?: string } | undefined)?.variant === 'tornado') return false;
  if (type === 'scatter' || type === 'bubble') return scatterGroupIdentities(data, geometry).length > 1;
  // default keys cover unnamed columns, bars and dots as well as combo.
  // With every label off, any chart's series fall back to a key
  // (the candidate stays only where the chart draws one and nothing else names them).
  // Row and side names stay with labels off, so these charts still name their series.
  if (['butterfly', 'pyramid', 'heatmap', 'status'].includes(type)) return false;
  if (!['column', 'bar', 'combo', 'dot', 'cleveland', 'dumbbell'].includes(type) && (options as { labels?: unknown } | undefined)?.labels !== false) return false;
  const series = (data as { series?: { role?: string; values?: unknown[] }[] } | undefined)?.series;
  return Array.isArray(series) && series.filter(s => s.role !== 'reference' && s.values?.some(entry => {
    const cell = entry !== null && typeof entry === 'object' && 'categoryId' in entry && 'value' in entry ? entry.value : entry;
    return cellValue(cell as Cell) !== null;
  })).length > 1;
}

interface ScatterGroupIdentity {
  id: Id;
  label: string;
  pointIds: Id[];
}

/** Scatter stores series in point.group, not data.series or mark.owner.seriesId. */
export function scatterGroupIdentities(data: unknown, geometry?: Geometry<object, object>, prefix = ''): ScatterGroupIdentity[] {
  const source = data as Partial<ScatterData> | undefined;
  if (!Array.isArray(source?.points)) return [];
  const declared = new Map((Array.isArray(source.groups) ? source.groups : []).map(group => [group.id, group]));
  const groups = new Map<Id, ScatterGroupIdentity>();
  const drawn = geometry && new Set(geometry.scene.flatMap(node =>
    node.t !== 'text' && node.part === 'point' && node.owner.pointId && node.id.startsWith(prefix)
      ? [node.owner.pointId] : []));
  for (const point of source.points) {
    if (!point?.group) continue;
    const group = declared.get(point.group);
    if (drawn ? !drawn.has(prefix + point.id) && !drawn.has(point.id)
      : cellValue(point.x) === null || cellValue(point.y) === null || (point.marker ?? group?.marker) === 'none') continue;
    const identity = groups.get(point.group) ?? { id: point.group, label: group?.label ?? point.group, pointIds: [] };
    identity.pointIds.push(point.id);
    groups.set(point.group, identity);
  }
  return [...groups.values()];
}

/** A group name beside one of its points maps that group's colour directly. */
export function scatterGroupNameIsDrawn(geometry: Geometry<object, object>, group: ScatterGroupIdentity, prefix = ''): boolean {
  return nameIsDrawn(geometry, group.label, prefix + group.id) || geometry.scene.some(node =>
    node.part === 'point' && node.id.startsWith(prefix) && group.pointIds.some(id =>
      node.owner.pointId === prefix + id || node.owner.pointId === id) && textNames(node, group.label));
}


/** Stop after the layout resolves its key inputs, before frame or mark geometry. */
export const COLLECT_IDENTITIES = Symbol('collectSeriesIdentities');
export interface IdentityCollectionOptions {
  [COLLECT_IDENTITIES]?: (items: SeriesIdentity[]) => never;
}
export function identityCollector(options: object): IdentityCollectionOptions {
  const collect = (options as IdentityCollectionOptions)[COLLECT_IDENTITIES];
  return collect ? { [COLLECT_IDENTITIES]: collect } : {};
}
export function collectSeriesIdentities(layout: (data: unknown, options: any) => unknown, data: unknown, options: object): SeriesIdentity[] {
  const stop = {};
  let identities: SeriesIdentity[] = [];
  try {
    layout(data, { ...options, legend: 'top', [COLLECT_IDENTITIES]: (items: SeriesIdentity[]) => {
      identities = items;
      throw stop;
    } });
  } catch (error) {
    if (error !== stop) throw error;
  }
  return identities;
}


/** Match a complete name in visible text, never a substring of another word. */
export function textNames(node: SceneNode, name: string): boolean {
  if (node.t !== 'text' || !name.trim()) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
  return word.test(node.lines.join(' '));
}

/** A key or direct name maps a series to its marks; prose alone does not. */
export function nameIsDrawn(geometry: Geometry<object, object>, name: string, id?: string): boolean {
  return geometry.scene.some(node => {
    if (node.part === 'subtitle' || node.part === 'footnote' ||
      !(['legendLabel', 'series', 'legendHeading', 'eventKey'].includes(node.part) || (id && node.owner.seriesId === id))) return false;
    if (textNames(node, name)) return true;
    // A distinct short key keeps its series identity in its full-name title.
    if (node.t !== 'text' || node.part !== 'legendLabel' || node.opacity === 0 || node.title !== name || !id ||
      !geometry.legend?.items.some(item => item.id === id && item.labelId === node.id)) return false;
    const text = node.lines.join(' ').trim();
    return text.length > 0 && text !== '…' && !geometry.scene.some(other =>
      other.t === 'text' && other.part === 'legendLabel' && other.id !== node.id && other.title !== node.title &&
      other.lines.join(' ').trim() === text);
  });
}
