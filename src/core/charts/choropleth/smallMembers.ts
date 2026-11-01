import { chartString } from '../../strings/choropleth';
import type { NamedColumnState } from '../../schema/namedColumns';
import { decodeGeoPack } from '../../geo/decode';
import type { GeoPack, GeoPoint } from '../../geo/types';
import type { Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import type { OccupiedIndex } from '../../label/occupied';
import { PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import { wrapText, type FontSpec, type TextMeasurer } from '../../text';
import type { LegendGeometry, SceneNode, TextRole } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { emphasisWeight, strokeToken } from '../../theme';
import { decimalsOf, geoStatePattern, geoStateLabel, type ScaleModel } from '../geoScale';
import { compareText } from '../../text';
import type { ChoroplethOptions } from './types';
import { composedTextRole } from '../../textRole';
import { stepDownFont } from '../../label/rowFit';
import { NormalizeError } from '../../normalize/shared';
import { maxOf, pushAll } from '../../arrays';

function ringArea(ring: readonly GeoPoint[]): number {
  return Math.abs(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}

/** Area ratios use the pack's projected map bounds, before fitting or label reserves. */
export function smallRegionIds(pack: GeoPack, eligible: Set<string>, explicit: Set<string>, options: ChoroplethOptions): Set<string> {
  const threshold = options.smallRegionArea ?? (options.labels === 'all' ? 0 : 0.001);
  if (threshold <= 0 || eligible.size === 0) return new Set();
  const area = (pack.bounds[2] - pack.bounds[0]) * (pack.bounds[3] - pack.bounds[1]);
  return new Set(decodeGeoPack(pack).regions.filter((region) => {
    if (!eligible.has(region.id) || explicit.has(region.id) || options.labelPlacements?.[`category:${region.id}`] !== undefined) return false;
    const regionArea = region.polygons.reduce((total, polygon) => total + polygon.reduce(
      (sum, ring, index) => sum + (index === 0 ? 1 : -1) * ringArea(ring), 0), 0);
    return regionArea / area < threshold;
  }).map((region) => region.id));
}

const RAMP_H = 8;
/** A boundary tick runs from the ramp top to this far under the ramp. */
const TICK_BELOW = 4;
const RAMP_MIN_W = 160;
const TITLE_MAX_W = 240;
const SWATCH = 12;
const SWATCH_GAP = 5;
/** Between the key and the small-members block. */
const BLOCK_GAP = 24;
/** Between the blocks and the map. */
export const MAP_GAP = 12;
/** The least map height the blocks leave; a taller block list asks the canvas for more height. */
const MIN_MAP_H = 80;

interface MapKeysInput {
  options?: Pick<ChoroplethOptions, 'locale' | 'strings'>;
  target: ChoroplethOptions['target'];
  /** The chart's `textScale`; the labels' step floor scales with it. */
  textScale: number;
  compact?: boolean;
  plot: Rect;
  /**
   * 'right' stacks the blocks in a column right of the map; 'bottom' and 'top'
   * set them side by side in a strip. 'auto' is the strip above the map, where
   * every exhibit keeps its key, and the map takes the full width.
   */
  position: 'right' | 'bottom' | 'top' | 'auto';
  title: string | undefined;
  scale: ScaleModel;
  /** The class count when the map paints classes. */
  classes: number | undefined;
  /** Choropleth bins name their ranges instead of implying equal numeric intervals. */
  classRanges?: boolean;
  /** The key's width, when the layout sets it (the full row, or the block beside the map). */
  keyWidth?: number;
  /** Measure only: return the blocks' size before anything is drawn or claimed. */
  dryRun?: boolean;
  midpointLabel: string | undefined;
  /** A line under the ramp saying which end is better, on a diverging scale. */
  caption: string | undefined;
  smallIds: Set<string>;
  /** The table's heading: 'Small members', or what the regions have in common. */
  smallTitle: string;
  pack: Pick<GeoPack, 'regions'>;
  values: Map<string, number | null>;
  states?: ReadonlyMap<string, NamedColumnState>;
  theme: Theme;
  measure: TextMeasurer;
  fmt: (value: number) => string;
  occupied: OccupiedIndex;
  solveCtx: SolveCtx;
}

/** Horizontal room between two key labels on one row. */
const LABEL_GAP = 6;

interface KeyText {
  id: string;
  lines: string[];
  /** The full text when `lines` had to cut it. */
  title?: string;
  font: FontSpec;
  x: number;
  y: number;
  w: number;
  h: number;
  role: TextRole;
}

/**
 * The colour key and the small-members block, laid out together.
 * One titled key: a ramp painted by the map's own scale, the min and max
 * labelled, a diverging centre ticked and labelled, every class edge
 * labelled on a classed map; the no-data row when a region has none. The
 * small members sit in their own titled block on the same grid, in the same
 * type. Every text goes through the label solver on a fixed cell; the key is
 * never wider than the room it gets, and its labels step down a size, then
 * stagger or wrap every class edge, to fit it. Both blocks are reserved
 * before the map is fitted into what is left.
 */
export function layoutMapKeys(input: MapKeysInput) {
  return mapKeys({ ...input, dryRun: false }) as Exclude<ReturnType<typeof mapKeys>, { dry: unknown }>;
}

/** The key blocks' size at this input, with nothing drawn or claimed. */
export function mapKeysSize(input: MapKeysInput): { w: number; h: number } {
  return (mapKeys({ ...input, dryRun: true }) as { dry: { w: number; h: number } }).dry;
}

/** Boundary ticks first; a key whose tick labels fit nowhere names its class ranges instead. */
function mapKeys(input: MapKeysInput) {
  try {
    return mapKeysOnce(input);
  } catch (error) {
    if (input.classRanges || !(error instanceof NormalizeError) || error.code !== 'geo-key-overflow') throw error;
    return mapKeysOnce({ ...input, classRanges: true });
  }
}

function mapKeysOnce(input: MapKeysInput) {
  const { plot, scale, theme, measure, fmt, occupied } = input;
  const nodes: SceneNode[] = [];
  const font: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const memberFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const heading: FontSpec = { ...font };
  const lineOf = (f: FontSpec) => f.size * (f.lineHeight ?? 1.2);
  const rowH = Math.max(SWATCH + 6, Math.max(lineOf(font), lineOf(memberFont)) + 4);
  const width = (text: string, f: FontSpec = font) => measure(text, f).width;

  // ---- key block: what its labels ask for ----
  const { min, max, midpoint } = scale;
  const noData = scale.legend.find((item) => item.id === 'no-data');
  const noValueKeys = scale.legend.filter((item) => item.id === 'no-data' || item.id === 'not-in-data' || item.id.startsWith('state:'));
  const hasRamp = min !== null && max !== null;
  const classes = hasRamp && (max !== min || scale.explicitSteps) ? (scale.edges ? scale.edges.length - 1 : input.classes) : undefined;
  const named = (value: number) => `${fmt(value)}${input.midpointLabel && value === midpoint ? ` ${input.midpointLabel}` : ''}`;
  // A classed key prints the edges the regions are classed against.
  const edges = !hasRamp ? [] : classes
    ? scale.edges ?? Array.from({ length: classes + 1 }, (_, index) => min! + (index / classes) * (max! - min!))
    : max === min ? [min!] : [min!, max!];
  // A classed key prints one explicit range per band, '<20', '20–<40',
  // …, '≥80', each centred under its band; a continuous ramp labels its ends.
  const edgeText = scale.edgeFmt;
  const ranges = classes && input.classRanges;
  // A classed key without ranges labels the joins only, one number per
  // boundary tick (classes - 1 labels): the first and last classes are open.
  const tickEdges = classes ? edges.slice(1, -1) : edges;
  const edgeTexts = ranges ? Array.from({ length: classes }, (_, i) =>
    i === 0 ? `<${edgeText(edges[1]!)}` : i === classes - 1 ? `≥${edgeText(edges[i]!)}`
      : `${edgeText(edges[i]!)}–<${edgeText(edges[i + 1]!)}`)
    : tickEdges.map(value => classes ? edgeText(value) : named(value));
  const midIn = hasRamp && midpoint !== null && midpoint > min! && midpoint < max!
    && !(classes && input.midpointLabel === undefined && tickEdges.includes(midpoint));
  // A classed key prints the midpoint as its ticks do ('15%' beside '14%') when that is exact.
  const midText = !midIn ? ''
    : classes && decimalsOf(midpoint!) <= Math.max(0, ...tickEdges.map(decimalsOf))
      ? `${edgeText(midpoint!)}${input.midpointLabel ? ` ${input.midpointLabel}` : ''}`
      : named(midpoint!);
  const rowW = (label: string) => SWATCH + SWATCH_GAP + width(label);
  const labelsWant = (f: FontSpec) => {
    const widths = edgeTexts.map((text) => width(text, f));
    // A band label is centred under its band, so each band needs one label width.
    return classes
      ? classes * (ranges ? maxOf(widths) + 2 * LABEL_GAP : maxOf(widths) * 1.5 + LABEL_GAP)
      : widths.reduce((sum, w) => sum + w + LABEL_GAP, 0) + (midIn ? width(midText, f) + LABEL_GAP : 0);
  };
  const natural = Math.max(
    RAMP_MIN_W,
    Math.min(TITLE_MAX_W, input.title ? width(input.title, heading) : 0),
    labelsWant(font),
    maxOf(noValueKeys.map((item) => rowW(item.label))),
  );

  // ---- small-members block: what it asks for ----
  const members = [...input.smallIds].sort(compareText).map((id) => ({
    id,
    code: shortestRegionName(input.pack.regions.find((region) => region.id === id)!, memberFont, measure),
    value: input.values.get(id) ?? null,
    state: input.states?.get(id),
    listed: input.values.has(id),
  }));
  const textOf = (value: number | null, listed: boolean, state?: NamedColumnState) => (state ? geoStateLabel(state, input.options) : !listed ? chartString(input.options, 'notInData') : value === null ? chartString(input.options, 'valueMissing') : fmt(value));
  const smallTitle = input.smallTitle;
  const headerH = lineOf(heading) + 6;
  const codeW = Math.max(0, maxOf(members.map((member) => width(member.code, memberFont))));
  const valueW = Math.max(0, maxOf(members.map((member) => width(textOf(member.value, member.listed, member.state), memberFont))));
  const columnGap = members.length > VALUE_TABLE_MAX_ROWS ? MAP_GAP / 2 : MAP_GAP;
  const columnW = SWATCH + SWATCH_GAP + codeW + 12 + valueW + columnGap;
  /** The block at most `maxW` wide and at least `minRows` tall; more rows when the width runs out. */
  const smallBlock = (maxW: number, minRows: number) => {
    const rows = Math.max(1, minRows, Math.ceil(members.length / Math.max(1, Math.floor((maxW + columnGap) / columnW))));
    const columns = Math.ceil(members.length / rows);
    return {
      rows,
      smallW: members.length ? Math.max(width(smallTitle, heading), columns * columnW - columnGap) : 0,
      smallH: members.length ? headerH + Math.min(rows, members.length) * rowH : 0,
    };
  };
  const columnRows = (keyH: number) => Math.floor((plot.h - keyH - BLOCK_GAP - headerH) / rowH);
  const oneColumnW = members.length ? Math.max(width(smallTitle, heading), columnW - columnGap) : 0;

  // Boundary ticks reach under the ramp, so their labels sit under the ticks.
  const labelDrop = classes && !ranges ? TICK_BELOW + 3 : 3;
  // ---- key block: fit the labels into keyW ----
  const fitKey = (keyW: number) => {
    const at = (value: number) => {
      if (!classes) return max === min ? 0 : ((value - min!) / (max! - min!)) * keyW;
      const index = Math.min(edges.length - 2, Math.max(0, edges.slice(1).filter((edge) => value >= edge).length));
      const span = edges[index + 1]! - edges[index]!;
      return (index + (span ? (value - edges[index]!) / span : 0)) / (edges.length - 1) * keyW;
    };
    const fontLadder = [font];
    for (let next = stepDownFont(theme, font, 'axis', input.target, input.textScale); next; next = stepDownFont(theme, next, 'axis', input.target, input.textScale)) fontLadder.push(next);
    const edgeLayout = (f: FontSpec, step: number, wrap = false) => {
      const place = (index: number, lines: string[]) => {
        const w = Math.max(...lines.map((line) => width(line, f)));
        const center = ranges ? (index + 0.5) / classes! * keyW : at(tickEdges[index]!);
        const left = Math.min(keyW - w, Math.max(0, center - w / 2));
        return { index, lines, left, w, row: index % step };
      };
      const placed = edgeTexts.map((text, index) => {
        const wrapWidth = Math.max(1, keyW / 2 - LABEL_GAP);
        const parts = ranges && text.includes('–<') ? text.replace('–<', '–\n<').split('\n') : [text];
        const wrapped = wrap ? parts.map(part => wrapText(part, f, wrapWidth, 3, measure)) : undefined;
        return { ...place(index, wrapped?.flatMap(part => part.lines) ?? [text]), truncated: wrapped?.some(part => part.truncated) ?? false };
      });
      const fits = placed.every((entry, i) => !entry.truncated && entry.w <= keyW && placed.slice(0, i).every(prior =>
        prior.row !== entry.row || prior.left + prior.w + LABEL_GAP <= entry.left));
      return { placed, fits, place };
    };
    const plan = (() => {
      for (const f of fontLadder) {
        const layout = edgeLayout(f, 1);
        if (layout.fits) return { f, placed: layout.placed };
      }
      const f = fontLadder.at(-1)!;
      for (const wrap of [false, true]) for (const step of [2, 3]) {
        const layout = edgeLayout(f, step, wrap);
        if (layout.fits) return { f, placed: layout.placed };
      }
      throw new NormalizeError('geo-key-overflow', 'options.format', 'Colour-key ticks do not fit after staggering and wrapping; use a shorter format or a wider canvas.');
    })();
    const edgeFont = plan.f;
    const edgeLineH = lineOf(edgeFont);
    const rowLines = Math.max(1, maxOf(plan.placed.map(entry => entry.lines.length)));
    const edgeRows = Math.max(1, maxOf(plan.placed.map(entry => entry.row + 1)));
    const edgeRowGap = ranges ? 3 : 0;
    const edgeRowPitch = rowLines * edgeLineH + edgeRowGap;
    const edgeRowH = edgeRows * edgeRowPitch - edgeRowGap;
    const midLines = midIn ? wrapText(midText, edgeFont, keyW, 2, measure).lines : [];
    const midW = midIn ? Math.max(...midLines.map((line) => width(line, edgeFont))) : 0;
    const midLeft = midIn ? Math.min(keyW - midW, Math.max(0, at(midpoint!) - midW / 2)) : 0;
    // The centre label sits under its tick unless it would touch an edge label; then above the ramp.
    const midAbove = midIn && (classes !== undefined || midLines.length > 1 || plan.placed.some((entry) =>
      midLeft < entry.left + entry.w + LABEL_GAP && midLeft + midW + LABEL_GAP > entry.left));
    const titleWrap = input.title ? wrapText(input.title, heading, keyW, 2, measure) : undefined;
    const titleLines = titleWrap?.lines ?? [];
    let y = titleLines.length ? titleLines.length * lineOf(heading) + 6 : 0;
    const midLabelY = y;
    if (midAbove) y += midLines.length * edgeLineH + 3;
    const rampY = y;
    if (hasRamp) y += RAMP_H + labelDrop + Math.max(edgeRowH, midIn && !midAbove ? edgeLineH : 0);
    const caption = hasRamp && input.caption ? wrapText(input.caption, edgeFont, keyW, 2, measure).lines : [];
    const captionY = y + 3;
    if (caption.length) y = captionY + caption.length * edgeLineH;
    const noDataY = y + (noValueKeys.length && hasRamp ? 6 : 0);
    if (noValueKeys.length) y = noDataY + rowH * noValueKeys.length;
    const keyH = y;
    return { keyW, at, plan, edgeFont, edgeRowPitch, midLines, midLeft, midAbove, titleWrap, titleLines, midLabelY, rampY, noDataY, keyH, caption, captionY };
  };

  // ---- where the blocks go, and how wide the key may be there ----
  // The right column fills the plot height first and takes at most half its
  // width for the key. A strip keeps room for one column of small members
  // beside the key unless that squeezes the key under its minimum; then the
  // small members go under the key.
  const position = input.position === 'auto' ? 'top' : input.position;
  const besideCap = plot.w - (members.length ? BLOCK_GAP + oneColumnW : 0);
  const { keyW, at, plan, edgeFont, edgeRowPitch, midLines, midLeft, midAbove, titleWrap, titleLines, midLabelY, rampY, noDataY, keyH, caption, captionY } =
    position === 'right'
      ? fitKey(Math.max(1, Math.min(input.keyWidth ?? natural, plot.w / 2)))
      : fitKey(Math.max(1, Math.min(input.keyWidth ?? natural, besideCap >= Math.min(natural, RAMP_MIN_W) ? besideCap : plot.w)));

  // ---- placement ----
  // In a strip the small members go beside the key or under it, whichever
  // makes the strip shorter: under it they can use the full plot width.
  const besideBlock = smallBlock(plot.w - keyW - BLOCK_GAP, Math.floor((keyH - headerH) / rowH));
  const underBlock = smallBlock(plot.w, 1);
  const beside = position !== 'right' && members.length > 0 && keyW + BLOCK_GAP + oneColumnW <= plot.w &&
    Math.max(keyH, besideBlock.smallH) <= keyH + BLOCK_GAP + underBlock.smallH;
  const { rows, smallW, smallH } = position === 'right' ? smallBlock(Infinity, columnRows(keyH)) : beside ? besideBlock : underBlock;
  const stacked = !beside && members.length > 0;
  const blocksW = beside ? keyW + (members.length ? BLOCK_GAP + smallW : 0) : Math.max(keyW, smallW);
  const blocksH = beside ? Math.max(keyH, smallH) : keyH + (stacked ? BLOCK_GAP + smallH : 0);
  const keyX = position === 'right' ? plot.x + plot.w - blocksW : plot.x;
  const keyY = position === 'bottom' ? plot.y + plot.h - blocksH : plot.y;
  const smallX = beside ? keyX + keyW + BLOCK_GAP : keyX;
  const smallY = beside ? keyY : keyY + keyH + BLOCK_GAP;
  // The plot height the blocks need, reported as the chart's minimum height.
  // A strip needs its own height and a map still MIN_MAP_H tall above it. The
  // right column already fills the plot height with as many rows as fit, so it
  // reports its height only when even one row per column does not fit.
  const mapGap = input.compact ? 4 : MAP_GAP;
  const minPlotH = position === 'right' ? (blocksH > plot.h ? blocksH : 0) : blocksH + mapGap + MIN_MAP_H;
  if (input.dryRun) return { dry: { w: blocksW, h: blocksH } } as const;
  const mapPlot: Rect = position === 'right'
    ? { ...plot, w: Math.max(10, plot.w - blocksW - MAP_GAP) }
    : { ...plot, y: position === 'top' ? plot.y + blocksH + mapGap : plot.y, h: Math.max(10, plot.h - blocksH - mapGap) };

  // ---- key block: marks, then its texts as fixed-cell label requests ----
  const texts: KeyText[] = [];
  const addText = (id: string, lines: string[], x: number, ty: number, f: FontSpec, role: TextRole, title?: string) =>
    texts.push({ id, lines, x, y: ty, font: f, w: Math.max(...lines.map((line) => width(line, f))), h: lines.length * lineOf(f), role, ...(title ? { title } : {}) });
  const items: LegendGeometry['items'] = [];
  if (titleLines.length) addText('legend-title', titleLines, keyX, keyY, heading, 'caption', titleWrap!.truncated ? input.title : undefined);
  if (hasRamp) {
    const classItems = scale.legend.filter((item) => item.id.startsWith('class-'));
    const steps = classes ?? (max === min ? 1 : Math.max(1, Math.round(keyW / 4)));
    for (let i = 0; i < steps; i++) {
      // The slice takes the paint the map gives its centre value: a class's own paint on a classed map.
      // On a continuous ramp the slice holding the midpoint takes the midpoint's own paint.
      const lo = min! + (i / steps) * (max! - min!);
      const hi = min! + ((i + 1) / steps) * (max! - min!);
      const value = steps === 1 ? min!
        // The last slice includes its upper bound, so a midpoint at the data maximum still shows.
        : !classes && midpoint !== null && midpoint >= lo && (midpoint < hi || (i === steps - 1 && midpoint <= hi)) ? midpoint
        : min! + ((i + 0.5) / steps) * (max! - min!);
      nodes.push({
        t: 'rect', id: `legend-ramp:${i}`,
        // Each slice overlaps the next by half a pixel so no seam shows between them.
        rect: { x: keyX + (i * keyW) / steps, y: keyY + rampY, w: keyW / steps + (i < steps - 1 ? 0.5 : 0), h: RAMP_H },
        fill: classes ? classItems[i]!.paint : scale.paint(value), owner: {}, part: 'swatch',
      });
    }
    occupied.claim({ x: keyX, y: keyY + rampY, w: keyW, h: RAMP_H }, 'legend', {}, 'swatch');
    const labelY = keyY + rampY + RAMP_H + labelDrop;
    for (const entry of plan.placed) {
      const text = edgeTexts[entry.index]!;
      addText(`legend-edge:${entry.index}`, entry.lines, keyX + entry.left, labelY + entry.row * edgeRowPitch, edgeFont, composedTextRole(text),
        entry.lines.join(' ') !== text ? text : undefined);
      if (classes && !ranges) nodes.push({ t: 'line', id: `legend-tick:${entry.index}`, x1: keyX + at(tickEdges[entry.index]!), x2: keyX + at(tickEdges[entry.index]!), y1: keyY + rampY, y2: keyY + rampY + RAMP_H + TICK_BELOW, stroke: { token: 'ink' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'legendTick' });
    }
    if (midpoint !== null && midpoint >= min! && midpoint <= max! && max !== min) {
      const tickX = keyX + at(midpoint);
      nodes.push({ t: 'line', id: 'legend-midpoint', x1: tickX, y1: keyY + rampY - 2, x2: tickX, y2: keyY + rampY + RAMP_H + 2,
        stroke: { token: 'ink' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'legendTick' });
    }
    if (midIn) {
      addText('legend-mid', midLines, keyX + midLeft, midAbove ? keyY + midLabelY : labelY, edgeFont, composedTextRole(midText),
        midLines.join(' ') !== midText ? midText : undefined);
    }
    if (caption.length) addText('legend-caption', caption, keyX, keyY + captionY, edgeFont, 'caption');
    items.push({ id: 'ramp', swatchNodeId: 'legend-ramp:0', labelId: `label:${titleLines.length ? 'legend-title' : 'legend-edge:0'}` });
  }
  for (const [index, item] of noValueKeys.entries()) {
    const ry = keyY + noDataY + index * rowH;
    const rect = { x: keyX, y: ry + (rowH - SWATCH) / 2, w: SWATCH, h: SWATCH };
    nodes.push({ t: 'rect', id: `legend-swatch:${item.id}`, rect, fill: item.paint, ...(item.hollow ? { pattern: 'hollow' as const } : item.pattern ? { pattern: item.pattern } : {}), ...(item.id === 'not-in-data' ? { stroke: { token: 'inkMuted' as const }, strokeWidth: strokeToken(theme, 'hair') } : {}), owner: {}, part: 'swatch' });
    occupied.claim(rect, 'legend', {}, 'swatch');
    addText(`legend-label:${item.id}`, [item.label], keyX + SWATCH + SWATCH_GAP, ry + (rowH - lineOf(font)) / 2, font, 'caption');
    items.push({ id: item.id, swatchNodeId: `legend-swatch:${item.id}`, labelId: `label:legend-label:${item.id}` });
  }
  const requests: LabelRequest[] = texts.map((text) => ({
    id: text.id, kind: 'scale', typeRole: 'axis', owner: {}, text: text.lines.join(' '), lines: text.lines, font: text.font,
    priority: PRIORITY.endpoint, role: text.role, ...(text.title ? { title: text.title } : {}),
    candidates: [{ slot: `${text.id}:fixed`, rect: { x: text.x, y: text.y, w: text.w, h: text.h }, penalty: 0 }],
  }));

  // ---- small-members block ----
  const add = (id: string, label: string, rx: number, ry: number, kind: LabelRequest['kind'], categoryId?: string) => {
    const selected = categoryId ? memberFont : heading;
    const measured = measure(label, selected);
    requests.push({ id, kind, typeRole: categoryId ? 'label' : 'axis', owner: categoryId ? { categoryId } : {}, text: label, lines: [label], font: selected,
      priority: PRIORITY.endpoint, candidates: [{ slot: 'smallMember', rect: { x: rx, y: ry + (rowH - measured.height) / 2, w: measured.width, h: measured.height }, penalty: 0 }],
      // The block heading is a caption, not an annotation value,
      // and so is the "No data" a null region reads out.
      ...(kind === 'annotation' ? { role: 'caption' as const } : { role: composedTextRole(label) }) });
  };
  if (members.length) {
    const measured = measure(smallTitle, heading);
    requests.push({ id: 'small-members:title', kind: 'annotation', typeRole: 'axis', owner: {}, text: smallTitle, lines: [smallTitle], font: heading,
      priority: PRIORITY.endpoint, role: 'caption',
      candidates: [{ slot: 'smallMember', rect: { x: smallX, y: smallY, w: measured.width, h: measured.height }, penalty: 0 }] });
  }
  members.forEach((member, index) => {
    const left = smallX + Math.floor(index / rows) * columnW;
    const ry = smallY + headerH + (index % rows) * rowH;
    const rect = { x: left, y: ry + (rowH - SWATCH) / 2, w: SWATCH, h: SWATCH };
    const state = input.states?.get(member.id);
    // A member without data takes the key's own no-data swatch: the map's
    // no-data fill is the page, and its hatch in the page colour would not show.
    nodes.push({ t: 'rect', id: `small-member-swatch:${member.id}`, rect, fill: state ? { token: 'inkMuted' } : !member.listed ? { token: 'background' } : member.value === null && noData ? noData.paint : scale.paint(member.value),
      ...(state ? { pattern: geoStatePattern(state) } : member.listed && member.value === null ? { pattern: 'hatch45' as const } : {}),
      stroke: { token: 'leader' }, strokeWidth: strokeToken(theme, 'hair'), owner: { categoryId: member.id }, part: 'smallMemberSwatch' });
    occupied.claim(rect, 'legend', { categoryId: member.id }, 'smallMemberSwatch');
    add(`category:${member.id}`, member.code, left + SWATCH + SWATCH_GAP, ry, 'category', member.id);
    const value = state ? geoStateLabel(state, input.options) : textOf(member.value, member.listed, member.state);
    add(`small-member-value:${member.id}`, value, left + columnW - columnGap - width(value, memberFont), ry, 'point', member.id);
  });
  const solved = solveLabels(requests, occupied, input.solveCtx);
  const fontById = new Map(requests.map((request) => [request.id, request.font]));
  pushAll(nodes, labelsToNodes(theme, solved.placed, (label) => fontById.get(label.id) ?? font));
  const keyRect: Rect = { x: keyX, y: keyY, w: keyW, h: keyH };
  occupied.claim(keyRect, 'legend', {}, 'legend');
  if (members.length) occupied.claim({ x: smallX, y: smallY, w: smallW, h: smallH }, 'reserved', {}, 'smallMembers');

  const blocks: Rect = { x: keyX, y: keyY, w: blocksW, h: blocksH };
  return {
    ...solved, nodes, mapPlot, blocks, position, minPlotH,
    legend: { rect: keyRect, items } as LegendGeometry,
  };
}

export function shortestRegionName(
  region: { id: string; anchor: { shortName: string } },
  font: FontSpec,
  measure: TextMeasurer,
): string {
  const forms = [region.anchor.shortName, region.id];
  return forms.reduce((best, candidate) => {
    const width = measure(candidate, font).width;
    const bestWidth = measure(best, font).width;
    return width < bestWidth || (width === bestWidth && compareText(candidate, best) < 0)
      ? candidate
      : best;
  });
}

/** At most this many rows make the automatic value table (more is a list, not a glance). */
export const VALUE_TABLE_MAX_ROWS = 20;
const TABLE_COLUMN_GAP = 16;
/** The extra gap under the top group in every column. */
const GROUP_GAP = 6;
/** A column spread to fill its block grows at most this much. */
const COLUMN_STRETCH = 1.6;

interface ValueTableInput {
  options?: Pick<ChoroplethOptions, 'locale' | 'strings'>;
  /** The regions the table lists, in row order. */
  ids: string[];
  pack: GeoPack;
  values: ReadonlyMap<string, number | null>;
  states?: ReadonlyMap<string, NamedColumnState>;
  scale: ScaleModel;
  fmt: (value: number) => string;
  theme: Theme;
  measure: TextMeasurer;
  /** The value column's heading; no heading row without it. */
  unit: string | undefined;
  /** The rows set in the emphasis weight: the top values. */
  bold: ReadonlySet<string>;
  compact?: boolean;
}

/**
 * The value table beside or under a map: one row per region with its class
 * swatch, its code and its value, ranked by value, highest first, down each
 * column. The top values open the first column in the emphasis weight, with a
 * rule under them, and every column leaves the same gap after that group. Its
 * size comes from its texts, so the map and the frame can be fitted to it.
 */
export function valueTable(input: ValueTableInput) {
  const { theme, measure } = input;
  const regular: FontSpec = { family: theme.type.family, ...theme.type.label };
  const bold: FontSpec = { ...regular, weight: emphasisWeight(theme) };
  const fontOf = (id: string) => (input.bold.has(id) ? bold : regular);
  const lineH = regular.size * (regular.lineHeight ?? 1.2);
  const rowH = Math.max(SWATCH + (input.compact ? 2 : 4), lineH + (input.compact ? 0.4 : 3));
  const columnGap = input.compact ? 8 : TABLE_COLUMN_GAP;
  const rows = input.ids.map((id) => {
    const state = input.states?.get(id);
    const value = input.values.get(id) ?? null;
    return {
      id,
      code: shortestRegionName(input.pack.regions.find((region) => region.id === id)!, fontOf(id), measure),
      text: state ? geoStateLabel(state, input.options) : !input.values.has(id) ? chartString(input.options, 'notInData') : value === null ? chartString(input.options, 'valueMissing') : input.fmt(value),
      value,
      state,
      listed: input.values.has(id),
    };
  }).sort((a, b) => (a.value === null || a.state ? 1 : 0) - (b.value === null || b.state ? 1 : 0)
    || (a.value !== null && b.value !== null && !a.state && !b.state ? b.value - a.value : 0)
    || compareText(a.code, b.code));
  // The top group leads the ranked rows; it is a group only while rows follow it.
  const groupN = rows.slice(0, input.bold.size).every((row) => input.bold.has(row.id)) && input.bold.size < rows.length ? input.bold.size : 0;
  const codeW = Math.max(0, maxOf(rows.map((row) => measure(row.code, fontOf(row.id)).width)));
  const valueW = Math.max(input.unit ? measure(input.unit, bold).width : 0, maxOf(rows.map((row) => measure(row.text, fontOf(row.id)).width)));
  const columnW = SWATCH + SWATCH_GAP + codeW + (input.compact ? 6 : 12) + valueW;
  const caption: FontSpec = { family: theme.type.family, ...theme.type.footnote };
  const headerH = input.unit ? caption.size * (caption.lineHeight ?? 1.2) + 4 : 0;
  const columnsOf = (perColumn: number) => Math.ceil(rows.length / Math.max(1, perColumn));
  /** The rows in each column: the first columns take the remainder. */
  const countsOf = (columns: number) => Array.from({ length: columns }, (_, i) => Math.floor(rows.length / columns) + (i < rows.length % columns ? 1 : 0));
  /** A column's width when the block may spread to `width`. */
  const columnWidth = (columns: number, width?: number, full = false) => width === undefined ? columnW
    : Math.min(full ? Infinity : columnW * COLUMN_STRETCH, Math.max(columnW, (width - (columns - 1) * columnGap) / columns));
  const groupGap = (columns: number) => (groupN > 0 && groupN < countsOf(columns)[0]! ? GROUP_GAP : 0);
  /** The block's size with `perColumn` rows in each column, spread to `width` when given (all of it when `full`). */
  const size = (perColumn: number, width?: number, full = false) => {
    const columns = columnsOf(perColumn);
    const w = columnWidth(columns, width, full);
    return { w: columns * w + (columns - 1) * columnGap, h: headerH + countsOf(columns)[0]! * rowH + groupGap(columns), columns };
  };
  /** The rows that fit in one column `height` tall. */
  const rowsIn = (height: number) => Math.floor((height - headerH - (groupN ? GROUP_GAP : 0)) / rowH);
  /** The columns that fit in `width`. */
  const columnsIn = (width: number) => Math.max(0, Math.floor((width + columnGap) / (columnW + columnGap)));
  /**
   * The rows per column when the block may be `width` wide. Every column
   * keeps a row after the top group, so the group never fills a column.
   */
  const rowsAcross = (width: number, keepGroup = true) => {
    const columns = Math.max(1, Math.min(columnsIn(width), groupN && keepGroup ? Math.floor(rows.length / (groupN + 1)) : Infinity));
    return Math.ceil(rows.length / columns);
  };

  const draw = (x: number, y: number, perColumn: number, occupied: OccupiedIndex, solveCtx: SolveCtx, width?: number, full = false) => {
    const nodes: SceneNode[] = [];
    const requests: LabelRequest[] = [];
    const { columns } = size(perColumn, width, full);
    const colW = columnWidth(columns, width, full);
    const text = (id: string, label: string, f: FontSpec, left: number, top: number, kind: LabelRequest['kind'], categoryId?: string) => {
      const measured = measure(label, f);
      requests.push({
        id, kind, typeRole: categoryId ? 'label' : 'axis', owner: categoryId ? { categoryId } : {}, text: label, lines: [label], font: f,
        priority: PRIORITY.endpoint, role: categoryId ? composedTextRole(label) : 'caption',
        candidates: [{ slot: 'valueTable', rect: { x: left, y: top + (rowH - measured.height) / 2, w: measured.width, h: measured.height }, penalty: 0 }],
      });
    };
    // One caption over the table names the unit of its values.
    if (input.unit) {
      const measured = measure(input.unit, caption);
      requests.push({
        id: 'value-table-unit:0', kind: 'annotation', typeRole: 'footnote', owner: {}, text: input.unit, lines: [input.unit], font: caption,
        priority: PRIORITY.endpoint, role: 'caption',
        candidates: [{ slot: 'valueTable', rect: { x, y, w: measured.width, h: measured.height }, penalty: 0 }],
      });
    }
    const counts = countsOf(columns);
    const gap = groupGap(columns);
    if (gap) {
      const ruleY = y + headerH + groupN * rowH + gap / 2;
      nodes.push({ t: 'line', id: 'value-table-group-rule', x1: x, x2: x + colW, y1: ruleY, y2: ruleY,
        stroke: { token: 'rule' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'rowRule' });
    }
    rows.forEach((row, index) => {
      let column = 0, rowIndex = index;
      while (rowIndex >= counts[column]!) rowIndex -= counts[column++]!;
      const left = x + column * (colW + columnGap);
      const top = y + headerH + rowIndex * rowH + (gap && rowIndex >= groupN ? gap : 0);
      const rect = { x: left, y: top + (rowH - SWATCH) / 2, w: SWATCH, h: SWATCH };
      nodes.push({
        t: 'rect', id: `value-table-swatch:${row.id}`, rect,
        fill: row.state ? { token: 'inkMuted' } : !row.listed ? { token: 'background' } : row.value === null ? input.scale.legend.find((item) => item.id === 'no-data')?.paint ?? { token: 'neutral' } : input.scale.paint(row.value),
        ...(row.state ? { pattern: geoStatePattern(row.state) } : row.listed && row.value === null ? { pattern: 'hatch45' as const } : {}),
        stroke: { token: 'leader' }, strokeWidth: strokeToken(theme, 'hair'), owner: { categoryId: row.id }, part: 'smallMemberSwatch',
      });
      occupied.claim(rect, 'legend', { categoryId: row.id }, 'smallMemberSwatch');
      const f = fontOf(row.id);
      text(`value-table-code:${row.id}`, row.code, f, left + SWATCH + SWATCH_GAP, top, 'category', row.id);
      text(`value-table-value:${row.id}`, row.text, f, left + colW - measure(row.text, f).width, top, 'point', row.id);
    });
    const solved = solveLabels(requests, occupied, solveCtx);
    const fontById = new Map(requests.map((request) => [request.id, request.font]));
    pushAll(nodes, labelsToNodes(theme, solved.placed, (label) => fontById.get(label.id) ?? regular));
    const block = { x, y, ...size(perColumn, width, full) };
    occupied.claim({ x: block.x, y: block.y, w: block.w, h: block.h }, 'reserved', {}, 'smallMembers');
    return { nodes, placed: solved.placed, decisions: solved.decisions, warnings: solved.warnings, rect: { x: block.x, y: block.y, w: block.w, h: block.h } };
  };
  return { rowCount: rows.length, rowH, headerH, columnW, size, rowsIn, rowsAcross, columnsIn, draw };
}
