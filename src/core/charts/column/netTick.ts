/** The tick at a mixed-sign stack's net. Combo draws it too, without loading the column marks. */

import type { Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import { strokeToken } from '../../theme';
import type { Id } from '../../types/cell';
import type { SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';

export function netTotalBounds(x: number, w: number, yy: number): Rect {
  const x1 = x - 2;
  return { x: x1, y: yy - 0.7, w: x + w + NET_TICK_REACH - x1, h: 1.4 };
}

/** The tick at a mixed-sign stack's net, across its column and reaching past it on the right (combo draws it too). */
export function netTotalTick(theme: Theme, categoryId: Id, x: number, w: number, yy: number, nodes: SceneNode[], claims: OccupiedIndex): void {
  const x1 = x - 2;
  const x2 = x + w + NET_TICK_REACH;
  // Its own owner: no segment value of the column may sit across it.
  const owner = { categoryId, seriesId: '__netTotal' };
  nodes.push({ t: 'line', id: `netTotal:${categoryId}`, x1, y1: yy, x2, y2: yy, stroke: { token: 'markInk' }, width: strokeToken(theme, 'rule'), owner, part: 'netTotal' });
  claims.claim(netTotalBounds(x, w, yy), 'mark', owner, 'netTotal');
}

/** How far a net total's tick reaches past its column, where its label starts. */
export const NET_TICK_REACH = 6;
