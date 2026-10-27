/**
 * One bar or column mark: its rect, with the break cut across it where it
 * crosses a straight axis break (`barBreakCut`), and the rects it claims. The value runs
 * along x for a bar and along y for a column.
 *
 * MARK VISIBILITY (src/core/markVisibility.ts). A bar sits on the page, so
 * the page is its backing. `outline`/`hatch45` already stroke the mark in its
 * own colour, so they get no separation stroke; a plain fill that cannot
 * clear the contrast floor gets the quiet outline instead of vanishing (the
 * `topN` rest, `series.colorRole: 'others'`).
 */

import { barBreakCut, straightBreakGlyph } from '../../axis';
import type { Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import { markOutlineOff, separationStroke } from '../../markVisibility';
import { crossesLinearBreak, type LinearBreak, type LinearScale } from '../../scale';
import { hatchGroundPaint } from '../../theme';
import type { OwnerRef } from '../../types/cell';
import type { Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';

export interface BarMarkInput {
  nodeId: string;
  rect: Rect;
  start: number;
  end: number;
  fill: Paint;
  pattern?: 'hatch45' | 'outline';
  outline?: boolean;
  owner: OwnerRef;
  /** The owner the collision claim carries, when it is not the mark's own (`barHalves`). */
  claimOwner?: OwnerRef;
  part: 'bar' | 'segment';
  displayValue: string;
  /** Interactive-fold state, e.g. 'flagged' for an anomaly period. */
  displayState?: string;
}

interface BarMarkContext {
  /** The value axis: 'x' for a bar, 'y' for a column. */
  axis: 'x' | 'y';
  theme: Theme;
  scale: LinearScale;
  activeBreak: LinearBreak | null | undefined;
  css: (paint: Paint) => string;
}

export function emitBarMark(ctx: BarMarkContext, nodes: SceneNode[], claims: OccupiedIndex, input: BarMarkInput): void {
  const { axis, theme, scale, activeBreak } = ctx;
  const visibility = input.outline
    ? { stroke: { token: 'ink' } as const, strokeWidth: theme.pattern.outlineStrokeWidth }
    : input.pattern || markOutlineOff(input.fill, theme)
      ? undefined
      : separationStroke(ctx.css(input.fill), theme.color.background, theme);
  // A hatched mark grounds its hatch in its own series tint, so the stripes
  // carry the key colour and two hatched series stay two colours.
  const hatchGround = input.pattern === 'hatch45' ? hatchGroundPaint(input.fill) : undefined;
  const claimOwner = input.claimOwner ?? input.owner;
  const rectNode = (id: string, rect: Rect, part: string, display?: { value: string; state?: string }): SceneNode => ({
    t: 'rect', id, rect, fill: input.fill,
    pattern: input.pattern,
    ...(hatchGround ? { hatchGround } : {}),
    ...(visibility ?? {}),
    ...(!input.outline ? { separation: { fill: input.fill, backing: { token: 'background' } as const, pattern: input.pattern, ...(input.start === input.end ? { empty: true as const } : {}) } } : {}),
    owner: input.owner, part,
    ...(display ? { display } : {}),
  });
  const breakMeta = activeBreak ? scale.break : undefined;
  if (!activeBreak || !breakMeta || !crossesLinearBreak(input.start, input.end, activeBreak)) {
    nodes.push(rectNode(input.nodeId, input.rect, input.part, {
      value: input.displayValue,
      ...(input.displayState ? { state: input.displayState } : {}),
    }));
    claims.claim(input.rect, 'mark', claimOwner, input.part);
    return;
  }
  if (input.pattern !== 'outline') {
    // One rect with one page-colour cut across it. The rect keeps its whole
    // edge (a separation stroke, a hatch edge, a repaint's edge), so the cut
    // shows the same in every theme and no seam runs where two parts meet.
    nodes.push(rectNode(input.nodeId, input.rect, 'bar', { value: input.displayValue }));
    claims.claim(input.rect, 'mark', claimOwner, 'bar');
    const cut = barBreakCut(input.rect, axis, breakMeta.position, `${input.nodeId}:break`, input.owner);
    nodes.push(...cut.nodes);
    claims.claim(cut.rect, 'axis', input.owner, 'barBreak');
    return;
  }
  // An outlined mark is hollow, so a page-colour cut would not show in it: it
  // is drawn in two parts with the two-stroke glyph in the gap between them.
  const startPx = scale(input.start);
  const endPx = scale(input.end);
  const direction = endPx >= startPx ? 1 : -1;
  const primaryEnd = breakMeta.position - direction * 2;
  const beyondStart = breakMeta.position + direction * 2;
  const part = (from: number, to: number): Rect => axis === 'x'
    ? { x: Math.min(from, to), y: input.rect.y, w: Math.max(Math.abs(to - from), 0.5), h: input.rect.h }
    : { x: input.rect.x, y: Math.min(from, to), w: input.rect.w, h: Math.max(Math.abs(to - from), 0.5) };
  const primaryRect = part(startPx, primaryEnd);
  const beyondRect = part(beyondStart, endPx);
  nodes.push(
    rectNode(input.nodeId, primaryRect, 'bar', { value: input.displayValue }),
    rectNode(`${input.nodeId}:beyondBreak`, beyondRect, 'barBeyondBreak'),
  );
  claims.claim(primaryRect, 'mark', claimOwner, 'bar');
  claims.claim(beyondRect, 'mark', claimOwner, 'barBeyondBreak');
  const glyph = straightBreakGlyph(
    theme,
    axis === 'x' ? { x: breakMeta.position, y: input.rect.y + input.rect.h / 2 } : { x: input.rect.x + input.rect.w / 2, y: breakMeta.position },
    `${input.nodeId}:break`,
    input.owner,
    { token: 'axis' },
    'barBreak',
  );
  nodes.push(...glyph.nodes);
  claims.claim(glyph.rect, 'axis', input.owner, 'barBreak');
}
