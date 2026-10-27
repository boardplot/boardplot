import type { Rect } from '../../geometry';
import { wrapText, type FontSpec, type TextMeasurer } from '../../text';
import type { DiagramNode, DiagramOptions } from '../../types/diagram';
import type { Paint } from '../../types/scene';
import type { NormalizedDiagram } from './model';
import { byOrder, type OrgChartLayout } from './orgChart';
import { q, qRect } from './primitives';
import { maxOf } from '../../arrays';

/**
 * The compact linear process. Wide canvases set the steps as one row of
 * chevrons that nest into each other: the icon on top, a white number disc
 * inline before the bold step name, and the description centred below in
 * the muted ink. When a step's disc and name do not fit its chevron, the
 * steps stack down the plot as bands that point down, disc and name at the
 * left, the icon at the right end, and the description right of the band.
 * A process this does not cover (edges, authored geometry, badges, second
 * lines, other shapes) keeps the general layout.
 */
export function linearEligible(data: NormalizedDiagram, options: DiagramOptions): boolean {
  if (options.variant !== 'linear-process') return false;
  if (data.edges.length > 0 || data.groups.length > 0 || data.lanes.length > 0 || data.nodes.length === 0) return false;
  return data.nodes.every((node) => node.kind === 'step' && node.shape.kind === 'chevron' && !node.position
    && !node.ports?.length && !node.size && !node.minSize && !node.badge && !node.secondaryLabel && !node.label.includes('\n'));
}

export function layoutLinearCompact(
  data: NormalizedDiagram,
  plot: Rect,
  nameFont: FontSpec,
  badgeFont: FontSpec,
  captionFont: FontSpec,
  measure: TextMeasurer,
  u: number,
  badgeText: (node: DiagramNode) => string,
  headerGap = 0,
): OrgChartLayout | undefined {
  const steps = [...data.nodes].sort(byOrder);
  const n = steps.length;
  const size = nameFont.size;
  const lineH = size * (nameFont.lineHeight ?? 1.2);
  const captionLineH = captionFont.size * (captionFont.lineHeight ?? 1.2);
  const nameW = (node: DiagramNode) => measure(node.label, nameFont).width;
  const disc = q(Math.max(20, badgeFont.size * 1.5, maxOf(steps.map((node) => measure(badgeText(node), badgeFont).width + 2 * u))));
  const discGap = 1.5 * u;
  const icons = steps.some((node) => node.icon);
  const rects = new Map<string, Rect>();
  const labelBoxes = new Map<string, Rect>();
  const iconBoxes = new Map<string, Rect>();
  const badges = new Map<string, Rect>();
  const paths = new Map<string, string>();
  const captionBoxes = new Map<string, { rect: Rect; lines: string[] }>();
  const extent: Rect[] = [];
  const fonts = new Map(steps.map((node) => [node.id, nameFont]));
  const result: OrgChartLayout['preset'] = {
    nodeRects: rects, readingOrder: steps.map((node) => node.id),
    edges: [], syntheticEdgeIds: [], groups: [], lanes: [], decorationScene: [], decorationClaims: [], contentTopReserves: new Map(),
  };
  const captionLines = (node: DiagramNode, width: number) => node.caption
    ? wrapText(node.caption, captionFont, Math.max(1, width), 2, measure) : undefined;
  let mode: OrgChartLayout['mode'] | undefined;

  // Row: chevrons nest by their tip, 1.5u apart along the point.
  const rowH = q(icons ? Math.min(10 * size, Math.max(6.5 * size, 0.1 * plot.w)) : 4 * size);
  const tip = q(0.2 * rowH);
  const gap = 1.5 * u;
  const chevronW = (plot.w + (n - 1) * (tip - gap)) / n;
  const pitch = chevronW - tip + gap;
  // A name may take two lines beside its disc; below 12u of room the steps stack instead.
  const nameRoom = chevronW - 2 * tip - 2 * u - disc - discGap;
  const nameLines = (node: DiagramNode) => wrapText(node.label, nameFont, Math.max(1, nameRoom), 2, measure);
  const linesW = (lines: string[]) => Math.max(...lines.map((line) => measure(line, nameFont).width));
  const rowFits = nameRoom >= 12 * u && steps.every((node) => !nameLines(node).truncated)
    && steps.every((node) => { const lines = captionLines(node, pitch - u); return !lines || !lines.truncated; });
  if (rowFits) {
    mode = 'columns';
    const captionH = Math.max(0, maxOf(steps.map((node) => (captionLines(node, pitch - u)?.lines.length ?? 0) * captionLineH)));
    const height = rowH + (captionH > 0 ? 3 * u + captionH : 0);
    // The wide layout leaves two name sizes above the row. Include that
    // gap in content sizing; a pinned short plot may use less of the gap.
    const spare = Math.max(0, plot.h - height);
    const top = q(plot.y + Math.min(headerGap, spare) + Math.max(0, (spare - headerGap) / 2));
    if (headerGap > 0) extent.push(qRect({ x: plot.x, y: top - headerGap, w: plot.w, h: height + headerGap }));
    steps.forEach((node, index) => {
      const x = plot.x + index * pitch;
      const centre = x + chevronW / 2;
      // The node's own box stops where the next chevron starts, so the boxes never overlap.
      rects.set(node.id, qRect({ x, y: top, w: pitch - gap, h: rowH }));
      const right = x + chevronW;
      paths.set(node.id, `M${q(x)} ${top}L${q(right - tip)} ${top}L${q(right)} ${q(top + rowH / 2)}L${q(right - tip)} ${q(top + rowH)}`
        + `L${q(x)} ${q(top + rowH)}` + (index > 0 ? `L${q(x + tip)} ${q(top + rowH / 2)}` : '') + 'Z');
      extent.push(qRect({ x, y: top, w: chevronW, h: rowH }));
      const row = icons ? top + 0.72 * rowH : top + rowH / 2;
      const name = nameLines(node).lines;
      const groupW = disc + discGap + linesW(name);
      const left = centre - groupW / 2;
      badges.set(node.id, qRect({ x: left, y: row - disc / 2, w: disc, h: disc }));
      labelBoxes.set(node.id, { x: q(left + disc + discGap), y: row - (name.length * lineH) / 2, w: Math.ceil(linesW(name)) + 1, h: name.length * lineH });
      if (node.icon) {
        const icon = q(0.3 * rowH);
        iconBoxes.set(node.id, { x: q(centre - icon / 2), y: q(top + 0.32 * rowH - icon / 2), w: icon, h: icon });
      }
      const lines = captionLines(node, pitch - u);
      if (lines) {
        const w = Math.max(...lines.lines.map((line) => measure(line, captionFont).width));
        captionBoxes.set(node.id, { rect: { x: q(centre - w / 2), y: q(top + rowH + 3 * u), w, h: lines.lines.length * captionLineH }, lines: lines.lines });
      }
    });
  }

  // Stack: bands that point down, the description right of each band.
  if (!mode) {
    const bandH = q(Math.max(2.6 * size, lineH + 2 * u, disc + 2 * u));
    const point = q(2 * u);
    const stackGap = 1.5 * u;
    const icon = q(Math.min(22, bandH - 2 * u));
    const lead = 2 * u + disc + discGap;
    const tail = icons ? 2 * u + icon + 2 * u : 2 * u;
    const need = Math.ceil(lead + maxOf(steps.map(nameW)) + tail);
    const captionGap = 3 * u;
    const widestCaption = Math.max(0, maxOf(steps.map((node) => (node.caption ? measure(node.caption, captionFont).width : 0))));
    const room = plot.w - (widestCaption > 0 ? captionGap + widestCaption : 0);
    // The band takes about two thirds of the plot, 75u at most, and never less than its content.
    const bandW = Math.floor(Math.max(need, Math.min(75 * u, Math.round(0.65 * plot.w), room)));
    const captionW = plot.w - bandW - captionGap;
    // A description that does not fit beside the band in two lines leaves the general layout to report it.
    if (bandW > plot.w || steps.some((node) => captionLines(node, captionW)?.truncated)) return undefined;
    const rowPitch = Math.max(bandH + stackGap, maxOf(steps.map((node) =>
      (captionLines(node, captionW)?.lines.length ?? 0) * captionLineH + stackGap)));
    const height = (n - 1) * rowPitch + bandH + point;
    const top = plot.y + Math.max(0, (plot.h - height) / 2);
    steps.forEach((node, index) => {
      const x = q(plot.x);
      const y = q(top + index * rowPitch);
      const right = q(plot.x + bandW);
      const mid = q(plot.x + bandW / 2);
      rects.set(node.id, { x, y, w: right - x, h: bandH });
      paths.set(node.id, `M${x} ${y}` + (index > 0 ? `L${mid} ${q(y + point)}` : '') + `L${right} ${y}L${right} ${q(y + bandH)}`
        + `L${mid} ${q(y + bandH + point)}L${x} ${q(y + bandH)}Z`);
      extent.push({ x, y, w: right - x, h: bandH + point });
      const row = y + bandH / 2 + (index > 0 ? point / 4 : 0);
      badges.set(node.id, qRect({ x: x + 2 * u, y: row - disc / 2, w: disc, h: disc }));
      labelBoxes.set(node.id, { x: q(x + lead), y: row - lineH / 2, w: Math.max(1, right - tail - (x + lead)), h: lineH });
      if (node.icon) iconBoxes.set(node.id, { x: q(right - 2 * u - icon), y: q(row - icon / 2), w: icon, h: icon });
      const lines = captionLines(node, captionW);
      if (lines) {
        const w = Math.max(...lines.lines.map((line) => measure(line, captionFont).width));
        const h = lines.lines.length * captionLineH;
        captionBoxes.set(node.id, { rect: { x: q(right + captionGap), y: q(row - h / 2), w, h }, lines: lines.lines });
      }
    });
    mode = 'rows';
  }
  const muted: Paint = { token: 'inkMuted' };
  const labelInks = new Map<string, Paint>(steps.filter((node) => node.caption).map((node) => [`caption-label:${node.id}`, muted]));
  return { mode, preset: result, routes: new Map(), fonts, labelBoxes, icons: iconBoxes, badges, badgePaint: { token: 'background' },
    paths, captionBoxes, labelInks, extent, plainShape: true };
}
