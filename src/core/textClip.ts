import type { FontSpec, TextMeasurer } from './text';
import type { Geometry, LintWarning, SceneNode } from './types/scene';

type TextNode = Extract<SceneNode, { t: 'text' }>;

/** Rounding room only: the layout quantizes widths to 0.5 px. */
const CLIP_TOLERANCE = 0.5;

/**
 * The canvas cuts every glyph past its edge, in SVG and PNG alike. A layout
 * seats its labels by their measured boxes; this pass measures each drawn
 * text again in the font it is drawn in, with the layout's own measurer, and
 * names the ones that still run past an edge, so a clipped text is never
 * silent. The box is the measured advance from the cap line to the
 * baseline, with a descender where the line has one; glyph overhang the
 * measurer does not report stays out of it.
 */
export function clippedTextWarnings(result: Geometry, measure: TextMeasurer): LintWarning[] {
  const { width, height } = result.size;
  const cut: { text: string; id: string; edges: string[]; px: number }[] = [];
  for (const node of result.scene) {
    if (node.t !== 'text' || node.opacity === 0) continue;
    const over = { left: 0, right: 0, top: 0, bottom: 0 };
    for (const box of lineBoxes(node, measure)) {
      over.left = Math.max(over.left, -box.x0);
      over.right = Math.max(over.right, box.x1 - width);
      over.top = Math.max(over.top, -box.y0);
      over.bottom = Math.max(over.bottom, box.y1 - height);
    }
    const edges = (Object.keys(over) as (keyof typeof over)[]).filter((edge) => over[edge] > CLIP_TOLERANCE);
    if (edges.length) cut.push({ text: node.lines.join(' ').replace(/\s+/g, ' '), id: node.id, edges, px: Math.ceil(Math.max(...edges.map((edge) => over[edge]))) });
  }
  if (cut.length === 0) return [];
  const sideways = cut.some((item) => item.edges.includes('left') || item.edges.includes('right'));
  const upright = cut.some((item) => item.edges.includes('top') || item.edges.includes('bottom'));
  return [{
    code: 'text-clipped',
    severity: 'warn',
    message: `${cut.length === 1 ? 'a text runs' : `${cut.length} texts run`} past the canvas edge and ${cut.length === 1 ? 'is' : 'are'} cut off: ${cut
      .map((item) => `'${item.text}' (${item.id}, up to ${item.px} px past the ${item.edges.join(' and ')} edge)`).join(', ')}`,
    suggest: `Give the chart more ${sideways && upright ? 'width and height' : sideways ? 'width' : 'height'}, or shorten the text.`,
  }];
}

/** Each drawn line's box on the canvas: rotated about the node's anchor, then moved by the grid panel offset. */
function lineBoxes(node: TextNode, measure: TextMeasurer): { x0: number; y0: number; x1: number; y1: number }[] {
  const { font } = node;
  const lineH = font.size * (font.lineHeight ?? 1.2);
  // The renderers set the first baseline 0.88 em below y and rotate about (x, that baseline).
  const baseline = node.y + font.size * 0.88;
  const angle = ((node.rotate ?? 0) * Math.PI) / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const place = (px: number, py: number) => ({
    x: node.x + (px - node.x) * c - (py - baseline) * s + (node.tx ?? 0),
    y: baseline + (px - node.x) * s + (py - baseline) * c + (node.ty ?? 0),
  });
  return node.lines.flatMap((line, i) => {
    if (line.trim() === '') return [];
    const w = node.runs && node.lines.length === 1
      ? node.runs.reduce((sum, run) => sum + measure(run.text, runFont(font, run.weight)).width, 0)
      : measure(line, font).width;
    const x0 = node.x - (node.align === 'end' ? w : node.align === 'middle' ? w / 2 : 0);
    const lineBase = baseline + i * lineH;
    const top = lineBase - font.size * 0.72;
    const bottom = lineBase + (/[gjpqy,;_()]/u.test(line) ? font.size * 0.2 : 0);
    const corners = [place(x0, top), place(x0 + w, top), place(x0 + w, bottom), place(x0, bottom)];
    return [{
      x0: Math.min(...corners.map((p) => p.x)), x1: Math.max(...corners.map((p) => p.x)),
      y0: Math.min(...corners.map((p) => p.y)), y1: Math.max(...corners.map((p) => p.y)),
    }];
  });
}

function runFont(font: FontSpec, weight: number | undefined): FontSpec {
  return weight === undefined ? font : { ...font, weight };
}
