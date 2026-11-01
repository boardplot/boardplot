import type { Rect } from '../../geometry';
import { wrapText, type FontSpec, type TextMeasurer } from '../../text';
import type { DiagramNode, DiagramOptions } from '../../types/diagram';
import type { Paint, SceneNode } from '../../types/scene';
import { markRolePaint } from '../../theme';
import type { NormalizedDiagram } from './model';
import { byOrder, type OrgChartLayout } from './orgChart';
import { chevronPath, gapSpread, laneOwner, q, qRect, type DiagramPalette } from './primitives';
import { diagramSceneId } from './ids';
import { maxOf } from '../../arrays';

/**
 * The compact customer journey: phase chevrons over cards that name the pain
 * points, without leaders, anchors or partitions; lane position shows
 * membership. A normal card is white with a solid hairline, and only a card
 * in a judgement role (the critical ones) is filled, in its role's fill, with its icon inline and
 * its label bold. Columns where the cards fit in two lines; below that, and
 * only when the author left `flow` unset, rows: the chevrons stack down the
 * left and the cards sit to their right, two per row.
 */
export function journeyEligible(data: NormalizedDiagram, options: DiagramOptions): boolean {
  if (options.variant !== 'customer-journey' || options.flow === 'serpentine') return false;
  if (data.edges.length > 0 || data.groups.length > 0 || data.lanes.length === 0 || data.lanes.length > 8) return false;
  return data.nodes.every((node) => node.kind === 'painPoint' && node.laneId && !node.position && !node.ports?.length
    && !node.size && !node.minSize && !node.caption && !node.badge && !node.secondaryLabel && !node.label.includes('\n')
    && (node.shape.kind === 'roundedRect' || node.shape.kind === 'rectangle'));
}

const judged = (node: DiagramNode) => node.role === 'bad' || node.role === 'warn' || node.role === 'good';

export function layoutJourneyCompact(
  data: NormalizedDiagram,
  options: DiagramOptions,
  plot: Rect,
  labelFont: FontSpec,
  headerFont: FontSpec,
  measure: TextMeasurer,
  u: number,
  palette: DiagramPalette,
  headWeight: number,
  fixedHeight = false,
): OrgChartLayout | undefined {
  const lanes = data.lanes;
  const members = new Map(lanes.map((lane) => [lane.id, data.nodes.filter((node) => node.laneId === lane.id).sort(byOrder)]));
  // Cards step one size down where the report target's 13 px floor leaves room.
  const card: FontSpec = { ...labelFont, size: labelFont.size > 13 ? labelFont.size - 1 : labelFont.size };
  const bold: FontSpec = { ...card, weight: headWeight };
  const fonts = new Map(data.nodes.map((node) => [node.id, judged(node) ? bold : card]));
  const lineH = card.size * (card.lineHeight ?? 1.2);
  const pad = 2 * u;
  // Card insets: 26 px to the label behind an icon, 6 px on the right.
  const padRight = 1.2 * u;
  const icon = 2.6 * u;
  const lead = (node: DiagramNode) => (node.icon ? 5.2 * u : pad);
  const linesIn = (node: DiagramNode, width: number) =>
    wrapText(node.label, fonts.get(node.id)!, Math.max(1, width - lead(node) - padRight), 3, measure);
  const fits = (node: DiagramNode, width: number, maxLines: number) => {
    const wrapped = linesIn(node, width);
    return !wrapped.truncated && wrapped.lines.length <= maxLines;
  };
  const cardH = (lines: number) => Math.max(6 * u, lines * lineH + 2.6 * u);
  const headerText = (label: string | undefined) => (label ? measure(label, headerFont).width : 0);
  const rects = new Map<string, Rect>();
  const put = (id: string, rect: Rect) => { rects.set(id, qRect(rect)); };
  const result: OrgChartLayout['preset'] = {
    nodeRects: rects, readingOrder: lanes.flatMap((lane) => members.get(lane.id)!.map((node) => node.id)),
    edges: [], syntheticEdgeIds: [], groups: [], lanes: [], decorationScene: [], decorationClaims: [], contentTopReserves: new Map(),
  };
  const header = (laneId: string, d: string, box: Rect, fill: Paint): void => {
    result.decorationScene.push({ t: 'path', id: diagramSceneId('lane', laneId, 'header'), d, fill, owner: laneOwner(laneId), part: 'diagramLaneHeader' } as SceneNode);
    result.decorationClaims.push({ rect: box, owner: laneOwner(laneId), part: 'diagramLaneHeader' });
  };
  let mode: OrgChartLayout['mode'] | undefined;

  // Columns: one chevron per phase, the cards below it.
  const gap = 1.6 * u;
  const pitch = (plot.w + gap) / lanes.length;
  const boxW = pitch - gap;
  const tip = Math.min(1.6 * u, boxW / 6);
  const columnsFit = lanes.every((lane) => headerText(lane.label) <= boxW - 2 * tip - u)
    && data.nodes.every((node) => fits(node, boxW, 2));
  if (columnsFit) {
    mode = 'columns';
    const headerH = 6 * u;
    const rows = Math.max(0, maxOf(lanes.map((lane) => members.get(lane.id)!.length)));
    const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0, maxOf(lanes.map((lane) => {
      const node = members.get(lane.id)![row];
      return node ? cardH(linesIn(node, boxW).lines.length) : 0;
    }))));
    const gapSum = (rows > 0 ? 2 * u : 0) + Math.max(0, rows - 1) * 1.2 * u;
    const bodies = headerH + rowHeights.reduce((sum, value) => sum + value, 0);
    const spread = gapSpread(fixedHeight, plot.h, bodies + gapSum, gapSum);
    const headGap = 2 * u * spread;
    const rowGap = 1.2 * u * spread;
    const height = bodies + (rows > 0 ? headGap : 0) + Math.max(0, rows - 1) * rowGap;
    const top = plot.y + Math.max(0, (plot.h - height) / 2);
    lanes.forEach((lane, index) => {
      const x = plot.x + index * pitch;
      const box = qRect({ x, y: top, w: boxW, h: headerH });
      let y = top + headerH + headGap;
      members.get(lane.id)!.forEach((node, row) => {
        put(node.id, { x, y, w: boxW, h: rowHeights[row]! });
        y += rowHeights[row]! + rowGap;
      });
      const bottom = Math.max(box.y + box.h, maxOf(members.get(lane.id)!.map((node) => rects.get(node.id)!.y + rects.get(node.id)!.h)));
      result.lanes.push({ id: lane.id, bounds: qRect({ x, y: top, w: boxW, h: bottom - top }), headerBox: box, memberNodeIds: members.get(lane.id)!.map((node) => node.id) });
      // The first chevron has no notch: the journey starts there.
      const d = index === 0
        ? `M${q(box.x)} ${q(box.y)}L${q(box.x + box.w - tip)} ${q(box.y)}L${q(box.x + box.w)} ${q(box.y + box.h / 2)}L${q(box.x + box.w - tip)} ${q(box.y + box.h)}L${q(box.x)} ${q(box.y + box.h)}Z`
        : chevronPath(box, tip);
      header(lane.id, d, box, palette.lane(lane.role, lane.paletteKey));
    });
  }

  // Rows: chevrons pointing down the left, two cards per row to their right.
  if (!mode && options.variant === 'customer-journey' && options.flow === undefined) {
    const chevronW = Math.max(maxOf(lanes.map((lane) => headerText(lane.label))) + 4 * u, Math.min(18.4 * u, 0.25 * plot.w));
    const cardGap = 1.2 * u;
    const left = plot.x + chevronW + 1.6 * u;
    const cardW = (plot.x + plot.w - left - cardGap) / 2;
    if (cardW > 0 && data.nodes.every((node) => fits(node, cardW, 3))) {
      mode = 'rows';
      const tipH = 1.2 * u;
      let y = 0;
      const placed: Array<{ lane: string; box: Rect; cards: Array<[string, Rect]> }> = [];
      lanes.forEach((lane) => {
        const cards = members.get(lane.id)!;
        const rowHeights: number[] = [];
        for (let i = 0; i < cards.length; i += 2) {
          rowHeights.push(Math.max(...cards.slice(i, i + 2).map((node) => cardH(linesIn(node, cardW).lines.length))));
        }
        const stack = rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rowHeights.length - 1) * cardGap;
        // The cards sit right of the chevron, clear of its notch, so the
        // band only pads the cards (4 px above and below).
        const bodyH = Math.max(stack + 0.8 * u, 7.6 * u);
        const out: Array<[string, Rect]> = [];
        let cardY = y + (bodyH - stack) / 2;
        rowHeights.forEach((rowH, row) => {
          cards.slice(row * 2, row * 2 + 2).forEach((node, column) =>
            out.push([node.id, { x: left + column * (cardW + cardGap), y: cardY, w: cardW, h: rowH }]));
          cardY += rowH + cardGap;
        });
        placed.push({ lane: lane.id, box: { x: plot.x, y, w: chevronW, h: bodyH }, cards: out });
        y += bodyH + u;
      });
      const natural = y - u + tipH;
      const extra = (gapSpread(fixedHeight, plot.h, natural, (placed.length - 1) * u) - 1) * u;
      const height = natural + (placed.length - 1) * extra;
      const top = plot.y + Math.max(0, (plot.h - height) / 2);
      placed.forEach(({ lane: laneId, box: raw, cards }, index) => {
        const shift = top + index * extra;
        const box = qRect({ ...raw, y: raw.y + shift });
        for (const [id, rect] of cards) put(id, { ...rect, y: rect.y + shift });
        const lane = lanes.find((candidate) => candidate.id === laneId)!;
        const mid = box.x + box.w / 2;
        // A notch on top except for the first phase, a point at the bottom.
        const d = `M${q(box.x)} ${q(box.y)}` + (index > 0 ? `L${q(mid)} ${q(box.y + tipH)}` : '')
          + `L${q(box.x + box.w)} ${q(box.y)}L${q(box.x + box.w)} ${q(box.y + box.h)}L${q(mid)} ${q(box.y + box.h + tipH)}L${q(box.x)} ${q(box.y + box.h)}Z`;
        const label = qRect({ x: box.x, y: box.y + (index > 0 ? tipH : 0), w: box.w, h: box.h - (index > 0 ? tipH : 0) });
        const memberIds = members.get(laneId)!.map((node) => node.id);
        const bottom = Math.max(box.y + box.h + tipH, maxOf(memberIds.map((id) => rects.get(id)!.y + rects.get(id)!.h)));
        result.lanes.push({ id: laneId, bounds: qRect({ x: plot.x, y: box.y, w: plot.w, h: bottom - box.y }), headerBox: label, memberNodeIds: memberIds });
        header(laneId, d, { ...box, h: box.h + tipH }, palette.lane(lane.role, lane.paletteKey));
      });
    }
  }
  if (!mode) return undefined;

  const labelBoxes = new Map<string, Rect>();
  const icons = new Map<string, Rect>();
  const fills = new Map<string, Paint>();
  const rings = new Map<string, { stroke: Paint; width: number }>();
  for (const node of data.nodes) {
    const rect = rects.get(node.id)!;
    const x = rect.x + lead(node);
    labelBoxes.set(node.id, { x, y: rect.y, w: Math.max(1, rect.x + rect.w - padRight - x), h: rect.h });
    if (node.icon) icons.set(node.id, { x: rect.x + 2.8 * u - icon / 2, y: rect.y + (rect.h - icon) / 2, w: icon, h: icon });
    // A critical card keeps its role's fill twin.
    if (!judged(node)) {
      fills.set(node.id, { token: 'background' });
      rings.set(node.id, { stroke: { token: 'leader' }, width: 1 });
    } else if (node.role === 'bad') {
      // A critical journey card takes the bad tone itself, with light text; a
      // journey-only exception to the rule that large fills use badFill.
      fills.set(node.id, markRolePaint('bad'));
    }
  }
  return { mode, preset: result, routes: new Map(), fonts, labelBoxes, icons, rings, fills, plainShape: true };
}
