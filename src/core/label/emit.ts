import type { Theme } from '../types/theme';
import type { Paint } from '../types/scene';
import { paintColor, strokeToken } from '../theme';
import { contrastRatio, parseColor } from '../color';
/**
 * Convert solved labels into scene nodes (text + leader paths). Shared by
 * every chart's emit stage. Hidden labels emit nothing but stay in the
 * geometry's label index for the pin UI.
 */

import type { FontSpec } from '../text';
import { emphasisWeight, WEIGHT_EMPHASIS } from '../theme';
import type { PlacedLabel, SceneNode } from '../types/scene';
import { fillEdgesOff, haloHatchedInsideLabels, LABEL_PLATE_RADIUS, labelPlate } from '../markVisibility';
import { composedTextRole, labelTypeRole } from '../textRole';
import { haloLabelsUnderLeaders } from '../annotateCallout';

/** Identity key box geometry for swatch-carrying labels.
 * Callers reserving candidate width must add SWATCH_RESERVE to the text
 * width so the box and text share the solved rect. */
const SWATCH_W = 8;
const SWATCH_GAP = 4;
export const SWATCH_RESERVE = SWATCH_W + SWATCH_GAP;

/**
 * Secondary text takes the muted ink: a label of the
 * secondary role that the solver gave the plain page ink. Series paint,
 * inverse ink and authored inks stay.
 */
const MUTED_SECONDARY_KINDS: ReadonlySet<string> = new Set(['category', 'annotation', 'axisTitle', 'tick']);

/** The value and category labels `theme.labels.ink: 'muted'` greys, stack totals included. */
const MUTED_LABEL_KINDS: ReadonlySet<string> = new Set(['point', 'segment', 'category', 'total', 'grandTotal']);

/**
 * A label on the plain page ink: a highlighted mark's label keeps it, a
 * secondary label and, under `theme.labels.ink: 'muted'`, a value or category
 * label take the muted ink. Series paint, inverse ink and authored inks stay.
 */
function labelInk(theme: Theme, label: PlacedLabel): PlacedLabel['ink'] {
  const plain = 'token' in label.ink && label.ink.token === 'ink' && Object.keys(label.ink).length === 1;
  if (!plain || label.emphasis) return label.ink;
  return (labelTypeRole(label) === 'secondary' && MUTED_SECONDARY_KINDS.has(label.kind)) || (theme.labels?.ink === 'muted' && MUTED_LABEL_KINDS.has(label.kind))
    ? { token: 'inkMuted' } : label.ink;
}

/** A fill under this ratio against the fill it lies on is lost in it (the light-page mark floor). */
const LOST_ON_GROUND = 1.4;

/**
 * A label swatch takes an ink hairline where it would vanish into the fill it lies on (under
 * 1.4:1, the mark floor), on a light or a dark page, and under marks.contrastEdge where it reads
 * under 3:1 on the page. The stroke slot is always there, 0 wide when the fill reads, so a repaint
 * (repaintScene) and a Light/Dark pair keep one node shape; the width is the only
 * theme-dependent part.
 */
export function swatchHairline(theme: Theme, fill: Paint, ground?: Paint): { stroke: Paint; strokeWidth: number } {
  const css = paintColor(theme, fill);
  const edge = !fillEdgesOff(theme) && contrastRatio(css, theme.color.background) < 3;
  return { stroke: { token: 'ink' }, strokeWidth: edge || lostOnGround(theme, fill, ground) ? strokeToken(theme, 'hair') : 0 };
}

function lostOnGround(theme: Theme, fill: Paint, ground?: Paint): boolean {
  if (ground === undefined) return false;
  const groundCss = paintColor(theme, ground);
  return groundCss !== theme.color.background && parseColor(groundCss) !== null && contrastRatio(paintColor(theme, fill), groundCss) < LOST_ON_GROUND;
}

/**
 * The fill a mark lies on: the last of `drawn` (scene indexes of rects) before it that holds it;
 * by default every earlier rect. Absent means the page.
 */
function groundOf(scene: readonly SceneNode[], index: number, drawn?: readonly number[]): Paint | undefined {
  type RectNode = Extract<SceneNode, { t: 'rect' }>;
  const box = (node: RectNode) => ({ x: node.rect.x + (node.tx ?? 0), y: node.rect.y + (node.ty ?? 0), w: node.rect.w, h: node.rect.h });
  const mark = box(scene[index] as RectNode);
  for (let k = drawn ? drawn.length - 1 : index - 1; k >= 0; k--) {
    const i = drawn ? drawn[k]! : k;
    if (i >= index) continue;
    const node = scene[i]!;
    if (node.t !== 'rect' || node.pattern || node.part === 'labelSwatch' || node.part === 'labelPlate') continue;
    const r = box(node);
    if (r.x <= mark.x && r.y <= mark.y && r.x + r.w >= mark.x + mark.w && r.y + r.h >= mark.y + mark.h) return node.fill;
  }
  return undefined;
}

/**
 * Decide the hairline of every mark that lies on another fill and would vanish in it (under
 * 1.4:1): a label swatch (swatchHairline), and a bar or segment on a highlighted row's tint (or a
 * highlighted column's band) that carries no outline of its own. A repaint runs it again. Grid panels
 * arrive translated and already decided in their own theme, so only a repaint (`translated`)
 * decides them again.
 */
export function groundEdges(scene: SceneNode[], themeOf: (node: SceneNode) => Theme, translated: boolean): SceneNode[] {
  const tints = scene.flatMap((node, index) => (node.t === 'rect' && (node.part === 'rowTint' || node.part === 'highlightBand') ? [index] : []));
  return scene.map((node, index) => {
    if (node.t !== 'rect' || !node.fill) return node;
    const swatch = node.part === 'labelSwatch';
    if (!swatch && !((node.part === 'segment' || node.part === 'bar') && !node.pattern && tints.length > 0)) return node;
    if (!translated && (node.tx !== undefined || node.ty !== undefined)) return node;
    const theme = themeOf(node);
    if (swatch) return { ...node, ...swatchHairline(theme, node.fill, groundOf(scene, index)) };
    const ground = groundOf(scene, index, tints);
    // An outline the mark already carries (a separation outline, a drawn stroke) stays; the slot is decided anew otherwise.
    const ownStroke = node.stroke !== undefined && !node.groundEdge;
    if (ground === undefined || ownStroke || (node.separation && (node.strokeWidth ?? 0) > 0)) return node;
    const lost = lostOnGround(theme, node.fill, ground) && !splitHalf(scene, index);
    return { ...node, stroke: { token: 'ink' as const }, strokeWidth: lost ? strokeToken(theme, 'hair') : 0, groundEdge: true as const };
  });
}

/**
 * A segment whose same-fill sibling abuts or overlaps it in the same row (a neutral likert segment split at the
 * axis): the two read as one shape, and a hairline on each would draw their shared edge through the
 * label that straddles it. Lines never cross text, so neither takes one.
 */
function splitHalf(scene: readonly SceneNode[], index: number): boolean {
  type RectNode = Extract<SceneNode, { t: 'rect' }>;
  const self = scene[index] as RectNode;
  const key = JSON.stringify(self.fill);
  const left = self.rect.x + (self.tx ?? 0);
  const right = left + self.rect.w;
  const top = self.rect.y + (self.ty ?? 0);
  return scene.some((other, i) => i !== index && other.t === 'rect' && other.part === self.part && JSON.stringify(other.fill) === key
    && Math.abs(other.rect.y + (other.ty ?? 0) - top) < 0.01 && Math.abs(other.rect.h - self.rect.h) < 0.01
    && other.rect.x + (other.tx ?? 0) <= right + 0.01 && other.rect.x + (other.tx ?? 0) + other.rect.w >= left - 0.01);
}

/**
 * Baseline below the line-box top, as the renderers draw it (renderSvg TEXT_ASCENT). A one-line
 * label whose face the measurer knows is set so its cap band, which carries the figures, centres
 * on the rect centre: the rect is centred on its mark, so the figures sit optically on it.
 * Centring the 1.2 em line box instead set them about 0.08 em high, and faces with other cap
 * heights (Geist 0.71, Newsreader, Inter 0.73) drifted apart. A label without a known face keeps
 * the line-box top.
 */
const TEXT_ASCENT = 0.88;

/**
 * One-line labels of one kind that share a right edge but start at different
 * x are a right-aligned column. They print anchored at that edge: placed at
 * x = edge - measured width, a viewer that substitutes the font (GitHub shows
 * a README SVG in the reader's fonts) moves each right end by its own error.
 */
function rightAlignedColumns(labels: readonly PlacedLabel[]): Set<PlacedLabel> {
  const columns = new Map<string, PlacedLabel[]>();
  for (const label of labels) {
    // An authored align stays: a diagram name set 'start' after its node's icon can end at another's x by chance.
    if (label.hidden || label.swatch || label.rotate || label.align !== undefined || label.lines.length !== 1) continue;
    const key = `${label.kind}\u001f${Math.round((label.rect.x + label.rect.w) * 100)}`;
    const column = columns.get(key);
    if (column) column.push(label);
    else columns.set(key, [label]);
  }
  const flush = new Set<PlacedLabel>();
  for (const column of columns.values()) {
    if (new Set(column.map((label) => Math.round(label.rect.x * 100))).size > 1) for (const label of column) flush.add(label);
  }
  return flush;
}

export function labelsToNodes(
  theme: Theme,
  labels: PlacedLabel[],
  fontOf: (label: PlacedLabel) => FontSpec,
  marks?: readonly SceneNode[],
): SceneNode[] {
  if (marks) haloHatchedInsideLabels(marks, labels);
  const crossing = haloLabelsUnderLeaders(labels);
  const nodes: SceneNode[] = [];
  const leaderOf = (label: PlacedLabel): SceneNode => ({
    t: 'path',
    id: `leader:${label.id}`,
    d: label.leader!.d,
    stroke: { token: 'leader' },
    width: strokeToken(theme, 'rule'),
    owner: label.owner,
    part: 'leader',
  });
  // A leader that crosses a label paints before every label, so the text and its halo lie over it.
  for (const label of labels) if (crossing.has(label.id)) nodes.push(leaderOf(label));
  const flushRight = rightAlignedColumns(labels);
  for (const label of labels) {
    if (label.hidden) continue;
    if (label.leader && !crossing.has(label.id)) nodes.push(leaderOf(label));
    if (label.swatch) {
      nodes.push({
        t: 'rect',
        id: `swatch:${label.id}`,
        rect: {
          x: label.rect.x,
          y: label.rect.y + label.rect.h / 2 - SWATCH_W / 2,
          w: SWATCH_W,
          h: SWATCH_W,
        },
        fill: label.swatch,
        ...swatchHairline(theme, label.swatch),
        owner: label.owner,
        part: 'labelSwatch',
      });
    }
    if (label.plate) {
      nodes.push({ t: 'rect', id: `plate:${label.id}`, rect: labelPlate(label.rect), fill: { token: 'background' }, radius: LABEL_PLATE_RADIUS, owner: label.owner, part: 'labelPlate' });
    }
    const nodeId = `label:${label.id}`;
    label.nodeId = nodeId;
    const own = label.font ?? fontOf(label);
    const font = label.emphasis ? { ...own, weight: emphasisWeight(theme) } : own;
    // A rotated label hangs down-left from its anchor and reads up to it:
    // the anchor is the right edge of its axis-aligned box, the text ends
    // there, and the rotation turns about that point.
    const rotated = label.rotate !== undefined && label.rotate !== 0;
    const lineH = font.size * (font.lineHeight ?? 1.2);
    // A headline prints bold over the rest, which keeps the label's own face.
    const head = label.headLines !== undefined && label.headLines < label.lines.length ? label.headLines : 0;
    nodes.push({
      t: 'text',
      id: nodeId,
      x: rotated || flushRight.has(label) ? label.rect.x + label.rect.w : label.align === 'middle' ? label.rect.x + label.rect.w / 2 : label.align === 'end' ? label.rect.x + label.rect.w : label.rect.x + (label.swatch ? SWATCH_RESERVE : 0),
      y: rotated
        ? label.rect.y + (lineH * Math.SQRT1_2) / 2 - font.size * TEXT_ASCENT
        : label.lines.length === 1 && label.capHeight !== undefined
          ? label.rect.y + label.rect.h / 2 + label.capHeight / 2 - font.size * TEXT_ASCENT
          : label.rect.y,
      lines: head > 0 ? label.lines.slice(0, head) : label.lines,
      ...(label.runs && label.lines.length === 1 && !rotated ? { runs: label.runs } : {}),
      ...(label.title ? { title: label.title } : {}),
      align: rotated || flushRight.has(label) ? 'end' : label.align ?? 'start',
      font: head > 0 ? { ...font, weight: label.headWeight ?? WEIGHT_EMPHASIS } : font,
      ink: head > 0 && label.headInk ? label.headInk : labelInk(theme, label),
      halo: label.halo ?? label.leader !== undefined,
      backing: label.backing,
      ...(label.rotate ? { rotate: label.rotate } : {}),
      owner: label.owner,
      part: label.kind,
      typeRole: labelTypeRole(label),
      // A headline such as "153" is a value over the words, whatever the label's role.
      ...(head > 0 ? { role: composedTextRole(label.lines.slice(0, head).join(' '), 'note') } : label.role ? { role: label.role } : {}),
    });
    if (head > 0) {
      nodes.push({
        t: 'text', id: `${nodeId}:body`, x: label.align === 'middle' ? label.rect.x + label.rect.w / 2 : label.align === 'end' ? label.rect.x + label.rect.w : label.rect.x,
        y: label.rect.y + head * lineH, lines: label.lines.slice(head),
        align: label.align ?? 'start', font: label.bodyFont ?? font, ink: label.bodyInk ?? label.ink, halo: label.halo ?? label.leader !== undefined, owner: label.owner, part: label.kind, typeRole: labelTypeRole(label),
        ...(label.role ? { role: label.role } : {}),
      });
    }
  }
  return nodes;
}
