import { chartString } from '../../strings/sankey';
/**
 * Sankey. Flows run left to right from sources to ends, in columns (stages).
 * A node's bar is as tall as its flow, max(in, out); a ribbon is as wide as
 * its link. One scale serves every column. Node order per column comes from
 * a deterministic crossing reduction (geometry.ts), long links run through
 * waypoints, and small nodes fold into Other (normalize.ts).
 *
 * Labels: name and bold value beside each node. The first column's labels
 * sit in a left gutter, the last column's in a right gutter, the others to
 * the right of their node over the ribbons, on a halo. A narrow chart gives
 * up a gutter and sets those labels inside too. A column's labels spread
 * vertically in node order; one that cannot fit goes to the note with its value.
 */

import { chartPalette } from '../chartEnv';
import { structureCount } from '../../structureCounts';
import { authoredNotes, fixedPlotChrome, frameTextOptions, hiddenNoteWith, markNotedLabels, solveFrame } from '../../frame';
import { shareSetFormatter } from '../../format';
import { valueNote } from '../../notes';
import { formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { round2, type Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest } from '../../label/solver';
import { accessibleTitle, resolveSize } from '../../normalize/shared';
import { chartSizing, resolveSizing } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { spread1DResult } from '../../collide';
import { defaultMeasurer, graphemes, type FontSpec, type TextMeasurer } from '../../text';
import { canvasMargin, emphasisWeight, markRolePaint, panelTypeClass, resolveTheme, ribbonPaint, seriesPaint, themeForWidth } from '../../theme';
import type { Id } from '../../types/cell';
import type { Geometry, LintWarning, Paint, SceneNode } from '../../types/scene';
import { composedTextRole } from '../../textRole';
import { isOthersFill, othersSeparation } from '../../markVisibility';
import { layer, orderColumns, placeNodes, ribbonPath, segmentBands, weightedCrossings, type NodeBox, type RibbonPiece } from './geometry';
import { sankeyGraph, sankeyShareFormat, type GraphNode } from './normalize';
import type { SankeyData, SankeyDerived, SankeyLinkDerived, SankeyMarks, SankeyNodeDerived, SankeyOptions } from './types';

/** Air between a node bar and its label. */
const LABEL_GAP = 6;
/** Air between two labels of one column. */
const LABEL_STACK_GAP = 2;
/** A gutter takes at most this share of the plot width. */
const GUTTER_SHARE = 0.3;
/** Air under the stage headers. */
const HEADER_GAP = 8;
/** An unpinned plot is about this plus a third of the width tall, as a treemap's. */
const CONTENT_BASE = 120;
/** The narrowest node gap before the chart needs more height. */
const MIN_NODE_GAP = 2;
/** The narrowest run a ribbon takes between two bars, so a gutter never squeezes the flows out. */
const MIN_RIBBON_W = 24;
/** A word longer than its line breaks with a hyphen, keeping this many letters on each side. */
const BREAK_KEEP = 3;

/** The lead for the note of unprinted node names. The registry puts it over the locale fill. */
export function sankeyDefaultStrings(options: SankeyOptions): Record<string, string> {
  return { hiddenLabels: chartString(options, 'sankeyHiddenLead') };
}

/** One node's label: one line ("Paid search 420") or name lines over a bold value line. */
interface LabelText { lines: string[]; oneLine: boolean; w: number; h: number }

export function layoutSankey(data: SankeyData, options: SankeyOptions = {}): Geometry<SankeyMarks, SankeyDerived> {
  const warnings: LintWarning[] = [];
  const size = resolveSize(options.size, options.target);
  const theme = themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? size.width);
  const palette = chartPalette(theme, options.palette, warnings);
  const measure = options.measure ?? defaultMeasurer;
  const locale = options.locale?.language;
  if (options.strings?.hiddenLabels === undefined) options = { ...options, strings: { ...options.strings, ...sankeyDefaultStrings(options) } };

  // ---- graph: nodes, links, columns, order ----
  const graph = sankeyGraph(data, options);
  warnings.push(...graph.warnings);
  const { nodes, links, columnCount } = graph;
  const layered = layer(nodes, links);
  const order = orderColumns(layered.nodes, layered.segments, columnCount, graph.order);
  const realOrder = order.map((column) => column.filter((node) => node < nodes.length));
  const columnTotal = realOrder.map((column) => column.reduce((sum, node) => sum + nodes[node]!.value, 0));

  // ---- paints: palette steps by id, colour-side nodes first in drawn order ----
  const linkColor = options.linkColor ?? 'source';
  const colouring = new Set(links.map((link) => (linkColor === 'source' ? link.source : link.target)));
  const stepOf = new Map<Id, number>();
  for (const column of realOrder) {
    for (const node of column) {
      const own = nodes[node]!;
      if (!own.other && colouring.has(node) && !stepOf.has(own.id)) stepOf.set(own.id, stepOf.size);
    }
  }
  // A node that colours no link draws neutral, unless its id colours links in another stage.
  const paintOf = (node: GraphNode): Paint => {
    if (node.fill) return { css: node.fill };
    if (node.colorRole) return markRolePaint(node.colorRole, true);
    if (node.other) return { token: 'othersMark' };
    const step = stepOf.get(node.id);
    return step === undefined ? { token: 'neutralMark' } : seriesPaint(step, palette ? options.palette : undefined);
  };
  const paints = nodes.map(paintOf);
  const steps = stepOf.size;
  const paletteLength = theme.color.series.length;
  if (steps > paletteLength && nodes.every((node) => !node.fill && !node.colorRole)) {
    warnings.push({
      code: 'sankey-colors-shared', severity: 'info',
      message: `${steps} nodes colour links, and the palette has ${paletteLength} colours, so some nodes share a colour`,
      suggest: 'Set nodes[].fill or nodes[].colorRole on the nodes that matter, or fold small nodes with other.share.',
    });
  }

  // ---- formats: one precision for the node values, one for the shares ----
  const nodeValue = options.nodeValue ?? 'value';
  const percentExample = sankeyShareFormat(options);
  const valueExample = percentExample ? undefined : options.format;
  const values = nodes.map((node) => node.value);
  const numberFormat = seriesRasterFormatter(valueExample, [...values, ...links.map((link) => link.value)], locale, options.unit, options.target);
  const fmt = numberFormat.fmt;
  const shareOf = (node: GraphNode) => (columnTotal[node.column]! > 0 ? (node.value / columnTotal[node.column]!) * 100 : 0);
  const shareFmt = percentExample ? formatterFromExample(percentExample, locale) : shareSetFormatter(nodes.map(shareOf), locale).format;
  const valueText = (node: GraphNode): string => {
    const share = shareFmt(shareOf(node));
    return nodeValue === 'share' ? share : nodeValue === 'value-share' ? `${fmt(node.value)} (${share})` : fmt(node.value);
  };

  // ---- the note: Other members, then the names too small to print ----
  const otherNotes = nodes.filter((node) => node.other).map((node) => {
    const stage = graph.columns[node.column]?.label;
    const name = stage !== undefined ? `${node.label} (${stage})` : columnCount > 2 ? `${node.label} (${node.column + 1})` : node.label;
    // A disclosure that names values the drawing does not print: every folded node with its value.
    const items = node.members!.map((member) => `${member.label} ${fmt(member.value)}`);
    return valueNote(chartString(options, 'otherMembers', { v1: name, v2: items.join(', ') }), items);
  });
  const hiddenNote = hiddenNoteWith({ ...options, notes: { ...options.notes, maxListed: 'all' } }, []);
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const footnotes = options.footnotes === false ? [] : [...(hiddenNote.line.length === 0 ? authoredNotes(options) : hiddenNote.footnotes), ...otherNotes, ...hiddenNote.line];
  const frame = solveFrame({ size, margin, ...frameTextOptions(options), footnotes, theme, measure }, occupied);
  fixedPlotChrome(frame);
  const plot = frame.plot;

  // ---- fonts ----
  const nameFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const valueFont: FontSpec = { ...nameFont, weight: emphasisWeight(theme) };
  const headerFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const lineH = measure('0', nameFont).height;
  const headerLineH = measure('0', headerFont).height;
  const textW = (text: string, font: FontSpec) => measure(text, font).width;
  const barW = size.width >= 480 ? 8 : 6;

  // ---- labels: the narrowest box each node can take, and its box at a width ----
  const nameOf = (node: GraphNode) => node.label;
  const minLabelW = (node: GraphNode): number => Math.max(textW(valueText(node), valueFont), narrowestName(nameOf(node), nameFont, measure));
  const labelAt = (node: GraphNode, width: number): LabelText => {
    const value = valueText(node);
    const one = textW(`${nameOf(node)} `, nameFont) + textW(value, valueFont);
    if (one <= width) return { lines: [`${nameOf(node)} ${value}`], oneLine: true, w: one, h: lineH };
    const nameLines = wrapName(nameOf(node), nameFont, width, measure);
    const w = Math.max(textW(value, valueFont), ...nameLines.map((line) => textW(line, nameFont)));
    return { lines: [...nameLines, value], oneLine: false, w, h: lineH * (nameLines.length + 1) };
  };
  const naturalW = (node: GraphNode) => textW(`${nameOf(node)} `, nameFont) + textW(valueText(node), valueFont);
  const columnNeed = realOrder.map((column) => Math.max(0, ...column.map((node) => minLabelW(nodes[node]!))));
  const columnNatural = realOrder.map((column) => Math.max(0, ...column.map((node) => naturalW(nodes[node]!))));
  const last = columnCount - 1;

  // ---- horizontal form: both gutters, then the right gutter alone, then the left, then none ----
  type Form = { left: boolean; right: boolean };
  const gutterW = (c: number) => Math.max(columnNeed[c]!, Math.min(columnNatural[c]!, plot.w * GUTTER_SHARE));
  const plan = (form: Form) => {
    const gl = form.left ? gutterW(0) + LABEL_GAP : 0;
    const gr = form.right ? gutterW(last) + LABEL_GAP : 0;
    const spacing = (plot.w - gl - gr - barW) / Math.max(1, last);
    // Inside labels: right of their bar; the last column's go left of it without a right gutter,
    // and then share the last gap with the column before.
    const budget = realOrder.map((_, c) => {
      if (c === 0 && form.left) return gutterW(0);
      if (c === last && form.right) return gutterW(last);
      const shared = (c === last || c === last - 1) && !form.right && last >= 1;
      return shared ? (spacing - barW - 3 * LABEL_GAP) / 2 : spacing - barW - 2 * LABEL_GAP;
    });
    const fits = spacing - barW >= MIN_RIBBON_W && budget.every((b, c) => b >= columnNeed[c]! - 0.01);
    return { form, gl, gr, spacing, budget, fits };
  };
  const forms: Form[] = [{ left: true, right: true }, { left: false, right: true }, { left: true, right: false }, { left: false, right: false }];
  const plans = forms.map(plan);
  const chosen = plans.find((p) => p.fits) ?? plans[plans.length - 1]!;
  // The width at which the last form fits: every column gap holds its labels.
  const insideNeed = Math.max(...realOrder.map((_, c) => {
    const shared = (c === last || c === last - 1) && last >= 1;
    return shared ? 2 * columnNeed[c]! + barW + 3 * LABEL_GAP : columnNeed[c]! + barW + 2 * LABEL_GAP;
  }));
  const minPlotW = barW + Math.max(1, last) * Math.max(insideNeed, barW + MIN_RIBBON_W);
  const columnX = (c: number) => plot.x + chosen.gl + c * chosen.spacing;
  const side = (c: number): 'left' | 'right' => ((c === 0 && chosen.form.left) || (c === last && !chosen.form.right) ? 'left' : 'right');

  // ---- stage headers: one row above the plot ----
  const headers = graph.columns.map((column, c) => {
    if (column.label === undefined) return undefined;
    const room = Math.max(columnNeed[c]!, chosen.spacing - 8);
    return { c, lines: wrapName(column.label, headerFont, room, measure) };
  });
  const headerRows = Math.max(0, ...headers.map((header) => header?.lines.length ?? 0));
  const headerH = headerRows > 0 ? headerRows * headerLineH + HEADER_GAP : 0;

  // ---- vertical: the plot the labels want, unpinned ----
  const labelsAt = realOrder.map((column, c) => column.map((node) => labelAt(nodes[node]!, chosen.budget[c]!)));
  const stackNeed = Math.max(...labelsAt.map((column) => column.reduce((sum, label) => sum + label.h + LABEL_STACK_GAP, -LABEL_STACK_GAP)));
  const busiest = Math.max(...order.map((column) => column.length));
  const automatic = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && panelTypeClass(options) === undefined;
  const wantPlotH = headerH + Math.max(stackNeed, (busiest - 1) * MIN_NODE_GAP + busiest, automatic ? Math.round(CONTENT_BASE + size.width / 3) : 0);
  const hardPlotH = headerH + Math.max((busiest - 1) * MIN_NODE_GAP + busiest, lineH);
  const wanted = automatic ? wantPlotH : hardPlotH;
  if (wanted > plot.h) {
    frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0, Math.ceil(size.height + (frame.deficit ?? 0) + wanted - plot.h));
  }
  const top = plot.y + headerH;
  const height = Math.max(1, plot.h - headerH);
  const gap = Math.max(MIN_NODE_GAP, Math.min(12, 0.04 * height, (height - busiest) / Math.max(1, busiest - 1)));

  // ---- nodes and ribbons ----
  const { boxes, scale } = placeNodes(order, layered.nodes, layered.segments, height, gap);
  const bands = segmentBands(layered.segments, boxes, scale);
  const box = (node: number): NodeBox => ({ y0: top + boxes[node]!.y0, y1: top + boxes[node]!.y1 });
  const scene: SceneNode[] = [...frame.nodes];
  const marks: SankeyMarks = { nodes: [], links: [] };
  const linkPaint = (link: { source: number; target: number }) => paints[linkColor === 'source' ? link.source : link.target]!;
  const nodeName = (node: GraphNode) => (node.stage !== undefined && graph.columns[node.column]?.label !== undefined ? `${node.label} (${graph.columns[node.column]!.label})` : node.label);
  // Thick ribbons first, so a thin one stays visible where they overlap.
  const drawOrder = links.map((_, i) => i).sort((a, b) => links[b]!.value - links[a]!.value || links[a]!.first - links[b]!.first);
  for (const i of drawOrder) {
    const link = links[i]!;
    const pieces: RibbonPiece[] = layered.chains[i]!.map((s) => {
      const segment = layered.segments[s]!;
      const from = layered.nodes[segment.source]!.column;
      const virtualFrom = segment.source >= nodes.length;
      return {
        x0: columnX(from) + (virtualFrom ? 0 : barW), x1: columnX(from + 1),
        sy: top + bands[s]!.sy, ty: top + bands[s]!.ty,
      };
    });
    // A waypoint is crossed level over the width of a bar.
    for (let k = 1; k < pieces.length; k++) pieces[k]!.x0 = pieces[k - 1]!.x1 + barW;
    const nodeId = `mark:link:${link.key}`;
    scene.push({
      t: 'path', id: nodeId, d: ribbonPath(pieces, link.value * scale, round2),
      // The Others fill is already a pale tint: translucent it would vanish.
      fill: isOthersFill(linkPaint(link)) ? linkPaint(link) : ribbonPaint(linkPaint(link)),
      owner: { segmentId: link.key }, part: 'sankeyLink',
      display: { value: fmt(link.value) },
    });
    const mid = pieces[Math.floor((pieces.length - 1) / 2)]!;
    const midY = pieces.length % 2 === 1 ? (mid.sy + mid.ty) / 2 : mid.ty;
    marks.links.push({ key: link.key, nodeId, at: { x: round2(pieces.length % 2 === 1 ? (mid.x0 + mid.x1) / 2 : mid.x1 + barW / 2), y: round2(midY + (link.value * scale) / 2) } });
  }
  realOrder.forEach((column, c) => {
    for (const node of column) {
      const own = nodes[node]!;
      const b = box(node);
      const rect: Rect = { x: round2(columnX(c)), y: round2(b.y0), w: barW, h: round2(Math.max(b.y1 - b.y0, 0.5)) };
      const nodeId = `mark:node:${own.key}`;
      const fill = paints[node]!, sep = othersSeparation(fill, theme);
      scene.push({
        t: 'rect', id: nodeId, rect, fill, ...(sep ? { stroke: sep.stroke, strokeWidth: sep.strokeWidth } : {}),
        ...(isOthersFill(fill) ? { separation: { fill, backing: { token: 'background' } as const } } : {}),
        owner: { categoryId: own.key }, part: 'sankeyNode', display: { value: valueText(own) },
      });
      occupied.claim(rect, 'mark', { categoryId: own.key }, 'sankeyNode');
      marks.nodes.push({ key: own.key, nodeId, rect });
    }
  });

  // ---- labels: spread per column in node order; what does not fit goes to the note ----
  const requests: LabelRequest[] = [];
  const valueLines = new Map<Id, number>();
  const oneLine = new Map<Id, { text: string; weight?: number }[]>();
  const leaders = new Map<Id, { x: number; y: number }>();
  const sides = new Map<Id, 'left' | 'right'>();
  realOrder.forEach((column, c) => {
    const where = side(c);
    const outside = (c === 0 && chosen.form.left) || (c === last && chosen.form.right);
    const texts = labelsAt[c]!;
    // Drop the smallest nodes' labels until the column holds the rest.
    const shown = new Set(column.map((_, k) => k));
    const stackOf = () => [...shown].reduce((sum, k) => sum + texts[k]!.h + LABEL_STACK_GAP, -LABEL_STACK_GAP);
    const bySize = column.map((node, k) => ({ k, value: nodes[node]!.value, first: nodes[node]!.first })).sort((a, b) => a.value - b.value || b.first - a.first);
    for (const { k } of bySize) {
      if (stackOf() <= height || shown.size === 0) break;
      shown.delete(k);
    }
    const kept = column.map((node, k) => ({ node, k })).filter(({ k }) => shown.has(k));
    const spread = spread1DResult(kept.map(({ node, k }) => {
      const b = box(node);
      return { desired: (b.y0 + b.y1) / 2, size: texts[k]!.h };
    }), [top, top + height], LABEL_STACK_GAP);
    column.forEach((node, k) => {
      const own = nodes[node]!;
      const text = texts[k]!;
      const id = `node:${own.key}`;
      const owner = { categoryId: own.key };
      const priority = PRIORITY.interior + round2(shareOf(own));
      const note = `${nodeName(own)} ${valueText(own)}`;
      if (!shown.has(k)) {
        requests.push({ id, kind: 'item', owner, text: note, lines: [note], font: nameFont, priority, redundant: true, suppressedAs: 'density', candidates: [], noteText: note, owed: true });
        return;
      }
      const at = spread.positions[kept.findIndex((entry) => entry.k === k)]!;
      const b = box(node);
      const x = where === 'left' ? columnX(c) - LABEL_GAP - text.w : columnX(c) + barW + LABEL_GAP;
      const rect = { x, y: at - text.h / 2, w: text.w, h: text.h };
      if (text.oneLine) oneLine.set(id, [{ text: `${nameOf(own)} ` }, { text: valueText(own), weight: valueFont.weight }]);
      else valueLines.set(id, text.lines.length - 1);
      // A label moved off its node's height gets a leader from the bar.
      sides.set(id, where);
      if (at < b.y0 - 1 || at > b.y1 + 1) leaders.set(id, { x: where === 'left' ? columnX(c) : columnX(c) + barW, y: Math.min(Math.max(at, b.y0), b.y1) });
      requests.push({
        id, kind: 'item', owner, text: text.lines.join(' '), lines: text.lines, font: nameFont, priority, noteText: note, owed: true,
        candidates: [{ slot: outside ? 'outside' : 'inside', rect, penalty: 0, pad: 0, outsidePlot: outside, ...(outside ? {} : { needsBacking: true }) }],
      });
    });
  });
  // A ribbon at least one line high prints its value at its arriving end, right aligned to the next bar.
  if ((options.linkValue ?? 'large') === 'large') {
    const flowH = measure('0', headerFont).height;
    links.forEach((link, i) => {
      if (link.value * scale < flowH) return;
      const s = layered.chains[i]!.at(-1)!;
      const from = layered.nodes[layered.segments[s]!.source]!.column;
      const text = fmt(link.value);
      const w = textW(text, headerFont);
      const x = columnX(from + 1) - LABEL_GAP - w;
      if (x < columnX(from) + barW + LABEL_GAP) return;
      const rect = { x, y: top + bands[s]!.ty + (link.value * scale - flowH) / 2, w, h: flowH };
      requests.push({
        id: `flow:${link.key}`, kind: 'tick', owner: { segmentId: link.key }, text, lines: [text], font: headerFont,
        priority: PRIORITY.interior / 2 + link.value * scale / 100, align: 'end', quietWhenCrowded: true,
        candidates: [{ slot: 'inside', rect, penalty: 0, pad: 0, needsBacking: true }],
      });
    });
  }
  headers.forEach((header) => {
    if (!header) return;
    const w = Math.max(...header.lines.map((line) => textW(line, headerFont)));
    const cx = columnX(header.c) + barW / 2;
    const x = header.c === 0 ? Math.min(columnX(0), plot.x + plot.w - w) : header.c === last ? Math.max(plot.x, columnX(last) + barW - w) : Math.min(Math.max(plot.x, cx - w / 2), plot.x + plot.w - w);
    const id = `stage:${graph.columns[header.c]!.id ?? header.c}`;
    requests.push({
      id, kind: 'axisTitle', owner: {}, text: header.lines.join(' '), lines: header.lines, font: headerFont, priority: PRIORITY.reference,
      align: header.c === 0 ? 'start' : header.c === last ? 'end' : 'middle',
      candidates: [{ slot: 'header', rect: { x, y: plot.y, w, h: header.lines.length * headerLineH }, penalty: 0, pad: 0 }],
    });
  });

  const solved = solveLabels(requests, occupied, labelCtx(theme, size, options, { measure, plot, labelPad: 2 }));
  warnings.push(...solved.warnings);
  for (const label of solved.placed) {
    const from = leaders.get(label.id);
    if (!from || label.hidden) continue;
    const end = { x: sides.get(label.id) === 'left' ? label.rect.x + label.rect.w + 2 : label.rect.x - 2, y: label.rect.y + label.rect.h / 2 };
    label.leader = { d: `M${round2(from.x)} ${round2(from.y)}L${round2(end.x)} ${round2(end.y)}`, curved: false };
  }
  const labelNodes = labelsToNodes(theme, solved.placed, (label) => (label.kind === 'axisTitle' ? headerFont : nameFont)).flatMap((node): SceneNode[] => {
    if (node.t !== 'text' || !node.id.startsWith('label:')) return [node];
    const id = node.id.slice('label:'.length);
    const label = solved.placed.find((l) => l.id === id)!;
    if (label.kind === 'axisTitle') {
      const x = label.align === 'end' ? label.rect.x + label.rect.w : label.align === 'middle' ? label.rect.x + label.rect.w / 2 : label.rect.x;
      return [{ ...node, x, align: label.align ?? 'start', ink: { token: 'inkMuted' }, part: 'stageHeader', role: 'category' }];
    }
    if (id.startsWith('flow:')) return [{ ...node, halo: true, x: label.rect.x + label.rect.w, align: 'end', ink: { token: 'inkMuted' }, role: 'value' }];
    const left = sides.get(id) === 'left';
    const x = left ? label.rect.x + label.rect.w : label.rect.x;
    const align = left ? 'end' : 'start';
    const halo = label.slot === 'inside' ? { halo: true } : {};
    const runs = oneLine.get(id);
    if (runs) return [{ ...node, ...halo, x, align, runs, role: composedTextRole(label.text) }];
    const head = valueLines.get(id)!;
    return [
      { ...node, ...halo, x, align, y: label.rect.y, lines: label.lines.slice(0, head), role: 'category' },
      { ...node, ...halo, id: `${node.id}:value`, x, align, y: label.rect.y + head * lineH, lines: [label.lines[head]!], font: valueFont, role: 'value' },
    ];
  });
  scene.push(...labelNodes);
  marks.nodes.forEach((mark) => { mark.labelNodeId = solved.placed.find((l) => l.owner.categoryId === mark.key && !l.hidden && l.kind === 'item')?.nodeId; });

  // ---- derived, a11y, sizing ----
  const nodesDerived: SankeyNodeDerived[] = realOrder.flat().map((node) => {
    const own = nodes[node]!;
    return {
      key: own.key, id: own.id, ...(own.stage !== undefined ? { stage: own.stage } : {}), label: own.label, column: own.column,
      value: clean(own.value), in: clean(own.in), out: clean(own.out), share: clean(shareOf(own)),
      ...(own.members ? { members: own.members.map((member) => ({ ...member, value: clean(member.value) })) } : {}),
    };
  });
  const linksDerived: SankeyLinkDerived[] = links.map((link) => ({
    key: link.key, source: nodes[link.source]!.key, target: nodes[link.target]!.key, value: clean(link.value),
    shareOfSource: clean(nodes[link.source]!.out > 0 ? (link.value / nodes[link.source]!.out) * 100 : 0),
    shareOfTarget: clean(nodes[link.target]!.in > 0 ? (link.value / nodes[link.target]!.in) * 100 : 0),
  }));
  const { total } = graph;
  const largest = [...links].sort((a, b) => b.value - a.value || a.first - b.first).slice(0, 3)
    .map((link) => chartString(options, 'flowReading', { v1: nodeName(nodes[link.source]!), v2: nodeName(nodes[link.target]!), v3: fmt(link.value) })).join('; ');
  const desc = chartString(options, 'sankeyDesc', { v1: links.length, v2: nodes.length, v3: columnCount, v4: fmt(total) }) + chartString(options, 'largestFlows', { v1: largest });
  const minWidth = Math.ceil(size.width - plot.w + minPlotW);
  const geometry: Geometry<SankeyMarks, SankeyDerived> = {
    type: 'sankey', size,
    sizing: resolveSizing({ ...chartSizing('sankey'), compactFloor: undefined, minWidth: 0, minHeight: 0 }, size, {
      minWidth: chosen.fits ? 0 : minWidth,
      minHeight: Math.ceil(size.height - plot.h + hardPlotH),
    }),
    plot, scene, labels: solved.placed, axes: [], annotations: [], frame: frame.frame, marks,
    derived: {
      total: clean(total),
      stages: graph.columns.map((column, c) => ({ ...(column.id !== undefined ? { id: column.id, label: column.label } : {}), column: c, total: clean(columnTotal[c]!) })),
      nodes: nodesDerived, links: linksDerived,
      crossings: clean(weightedCrossings(order, layered.segments, layered.nodes)),
      formatsShares: percentExample !== undefined,
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'sankeyTitle', { v1: links.length, v2: nodes.length, v3: fmt(total) })),
      counts: [structureCount('flows', links.length, undefined, options), structureCount('nodes', nodes.length, undefined, options)],
      desc,
    },
    warnings, debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
  markNotedLabels(geometry, hiddenNote.ids, { strings: options.strings });
  return geometry;

}
/** The narrowest width a name wraps to: its widest word, or a hyphenated piece of a long word. */
function narrowestName(text: string, font: FontSpec, measure: TextMeasurer): number {
  return Math.max(0, ...text.split(/\s+/).filter(Boolean).map((word) => {
    const chars = graphemes(word);
    if (chars.length < 2 * BREAK_KEEP + 1) return measure(word, font).width;
    // The widest piece when the word breaks into hyphenated pieces of about six letters.
    const piece = Math.max(BREAK_KEEP * 2, Math.ceil(chars.length / Math.ceil(chars.length / 6)));
    return measure(`${chars.slice(0, piece).join('')}-`, font).width;
  }));
}

/** Wrap a name at spaces to `width`; a word wider than the line breaks with a hyphen, never with an ellipsis. */
function wrapName(text: string, font: FontSpec, width: number, measure: TextMeasurer): string[] {
  const fits = (piece: string) => measure(piece, font).width <= width;
  const words = text.split(/\s+/).filter(Boolean).flatMap((word) => {
    const pieces: string[] = [];
    let rest = graphemes(word);
    while (!fits(rest.join('')) && rest.length > 1) {
      // The longest head that fits with its hyphen, keeping BREAK_KEEP letters on each side where it can.
      let cut = rest.length - 1;
      while (cut > 1 && !fits(`${rest.slice(0, cut).join('')}-`)) cut--;
      if (cut >= BREAK_KEEP && rest.length - cut < BREAK_KEEP) cut = Math.max(BREAK_KEEP, rest.length - BREAK_KEEP);
      pieces.push(`${rest.slice(0, cut).join('')}-`);
      rest = rest.slice(cut);
    }
    pieces.push(rest.join(''));
    return pieces;
  });
  const lines: string[] = [];
  for (const word of words) {
    const previous = lines[lines.length - 1];
    if (previous !== undefined && !previous.endsWith('-') && fits(`${previous} ${word}`)) lines[lines.length - 1] = `${previous} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** Twelve significant digits: drops float sum noise and keeps tiny flows, which fixed decimals would zero. */
function clean(v: number): number {
  return v === 0 ? 0 : Number(v.toPrecision(12));
}
