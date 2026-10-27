import { measure } from '../../src/index';
import { CARD_MIN_WIDTH } from '../../src/core/sizing';
import { rectLineDistance, type Rect } from '../../src/core/geometry';
import { defaultMeasurer } from '../../src/core/text';
import { REFERENCE_LABEL_CLEARANCE } from '../../src/core/markVisibility';

/** A chart request as the fixtures carry it; the helper sets `options.size`. */
export type CardRequest = { type: string; data: unknown; options?: Record<string, unknown>; annotations?: unknown[] };

const REFERENCE_PARTS = new Set(['valueLine', 'reference', 'referenceLine', 'targetLine', 'target', 'targetPath']);
const VALUE_KINDS = new Set(['point', 'segment', 'total', 'grandTotal', 'valueLine']);

function at(request: CardRequest, width: number) {
  return measure({ ...request, options: { ...request.options, size: { width } } } as never) as any;
}

/** The scorecard's (reference clearance under 3 px) and (value labels of one series under 6 px apart). */
export function overlapProblems(geometry: any): string[] {
  const problems: string[] = [];
  const text = geometry.scene.filter((node: any) => node.t === 'text' && node.opacity !== 0 && node.lines.join('').trim() !== '');
  const shown = new Set(text.map((node: any) => node.id));
  const labels = geometry.labels.filter((label: any) => !label.hidden && shown.has(label.nodeId));
  const boxes: Rect[] = labels.map((label: any) => label.rect);
  const boxed = new Set(labels.map((label: any) => label.nodeId));
  for (const node of text) {
    if (boxed.has(node.id)) continue;
    const w = Math.max(...node.lines.map((line: string) => defaultMeasurer(line, node.font).width));
    boxes.push({ x: node.x + (node.tx ?? 0) - (node.align === 'end' ? w : node.align === 'middle' ? w / 2 : 0),
      y: node.y + (node.ty ?? 0), w, h: node.lines.length * node.font.size * (node.font.lineHeight ?? 1.2) });
  }
  // shortcut: straight reference lines only; the scorecard also reads cut path runs.
  for (const node of geometry.scene) {
    if (!REFERENCE_PARTS.has(node.part) || node.t !== 'line') continue;
    const run = [{ x: node.x1 + (node.tx ?? 0), y: node.y1 + (node.ty ?? 0) }, { x: node.x2 + (node.tx ?? 0), y: node.y2 + (node.ty ?? 0) }];
    for (const box of boxes) if (rectLineDistance(box, run) + 1e-6 < REFERENCE_LABEL_CLEARANCE) problems.push(`R1 ${node.id}`);
  }
  const values = labels.filter((label: any) => VALUE_KINDS.has(label.kind));
  for (let a = 0; a < values.length; a++) for (let b = a + 1; b < values.length; b++) {
    const [r, s] = [values[a].rect, values[b].rect];
    if (values[a].owner.seriesId !== values[b].owner.seriesId || values[a].owner.categoryId === values[b].owner.categoryId) continue;
    if (Math.min(r.y + r.h, s.y + s.h) <= Math.max(r.y, s.y) + 1e-6) continue;
    if (Math.max(r.x, s.x) - Math.min(r.x + r.w, s.x + s.w) + 1e-6 < 6) problems.push(`R2 ${values[a].id} / ${values[b].id}`);
  }
  return problems;
}

/** A drawing in its compact form: compact mode, or a table surface's tight spacing. */
const compact = (geometry: any): boolean =>
  geometry.mode === 'compact' || geometry.warnings.some((warning: any) => warning.code === 'table-tight-spacing');

/**
 * The card-width contract for every chart family, with only a width specified:
 * - at the reported minimum width the chart draws;
 * - outside the 8 px width bracket, it draws compact, or refuses with a size of at least 320 px that then draws;
 * a cohort table's compact form is its tight spacing, which it names with `table-tight-spacing`;
 * - at 400 and 320 px a drawn chart has no or overlap.
 * Returns the broken clauses; an empty list passes.
 */
export function cardFloorProblems(request: CardRequest): string[] {
  const problems: string[] = [];
  // A narrower frame can wrap its labels and need less: the minimum is the width that reports itself.
  let minWidth: number = at(request, 720).minWidth;
  let atMin = at(request, minWidth);
  for (let pass = 0; pass < 4 && atMin.minWidth < minWidth; pass++) atMin = at(request, minWidth = atMin.minWidth);
  if (!atMin.geometry) problems.push(`refused at its minimum width ${minWidth}: ${atMin.warnings[0]?.message}`);
  let underWidth = minWidth - 1;
  let under = at(request, underWidth);
  if (under.geometry && !compact(under.geometry)) under = at(request, underWidth = minWidth - 9);
  if (!under.geometry) {
    const fix = under.refused?.warnings.find((warning: any) => warning.code === 'size-below-floor')?.expected?.minimum;
    if (!fix || fix.width < CARD_MIN_WIDTH) problems.push(`refused at ${underWidth} without a fix of at least ${CARD_MIN_WIDTH} px`);
    else if (!measure({ ...request, options: { ...request.options, size: fix } } as never).geometry) problems.push(`its fix ${fix.width} x ${fix.height} does not draw`);
  } else if (!compact(under.geometry)) problems.push(`drew full at ${underWidth}, under its minimum`);
  for (const width of [400, 320]) {
    const drawn = at(request, width).geometry;
    if (drawn) problems.push(...overlapProblems(drawn).map((problem) => `${problem} at ${width}`));
  }
  return problems;
}
