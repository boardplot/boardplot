/**
 * The finite icon vocabulary — the ONLY icon source for every surface
 * (diagram nodes, icon callouts, geo status glyphs). Schemas accept these
 * names and nothing else: no raw paths, no SVG, no URLs, so icons can never
 * become a raw-drawing backdoor past the scene contract.
 *
 * Each icon is a deterministic command table on a 24×24 grid, compiled by
 * layouts into ordinary path/circle scene primitives (no new scene node
 * kinds, no renderer involvement). Outline style: stroke-only, rounded
 * caps/joins.
 */

import type { Rect } from './geometry';
import { NormalizeError } from './normalize/shared';
import { fmtPathNumber as fmt } from './curve';

const ICON_VIEWBOX = 24;

type Pt = readonly [number, number];

type IconCommand =
  | { t: 'polyline'; pts: readonly Pt[]; closed?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'cubic'; from: Pt; c1: Pt; c2: Pt; to: Pt };

const ICONS = {
  lock: [
    { t: 'polyline', pts: [[5.5, 11], [18.5, 11], [18.5, 20], [5.5, 20]], closed: true },
    { t: 'cubic', from: [8, 11], c1: [8, 2.5], c2: [16, 2.5], to: [16, 11] },
  ],
  lightbulb: [
    { t: 'circle', cx: 12, cy: 9.5, r: 5.5 },
    { t: 'polyline', pts: [[9.8, 15], [9.8, 18], [14.2, 18], [14.2, 15]] },
    { t: 'polyline', pts: [[10.5, 20.5], [13.5, 20.5]] },
  ],
  people: [
    { t: 'circle', cx: 8, cy: 8.5, r: 2.8 },
    { t: 'circle', cx: 16, cy: 8.5, r: 2.8 },
    { t: 'cubic', from: [4, 19], c1: [4, 15.6], c2: [5.8, 13.8], to: [8, 13.8] },
    { t: 'cubic', from: [8, 13.8], c1: [10.2, 13.8], c2: [12, 15.6], to: [12, 19] },
    { t: 'cubic', from: [12.5, 19], c1: [12.5, 15.9], c2: [14, 13.8], to: [16, 13.8] },
    { t: 'cubic', from: [16, 13.8], c1: [18, 13.8], c2: [19.8, 15.6], to: [19.8, 19] },
  ],
  conversation: [
    {
      t: 'polyline',
      pts: [[3, 5], [14, 5], [14, 13], [9, 13], [6, 16], [6, 13], [3, 13]],
      closed: true,
    },
    {
      t: 'polyline',
      pts: [[16, 10], [21, 10], [21, 17], [19.5, 17], [19.8, 19.6], [17.5, 17], [16, 17]],
      closed: true,
    },
  ],
  workflow: [
    { t: 'polyline', pts: [[3, 4], [10, 4], [10, 9], [3, 9]], closed: true },
    { t: 'polyline', pts: [[14, 4], [21, 4], [21, 9], [14, 9]], closed: true },
    { t: 'polyline', pts: [[8.5, 15], [15.5, 15], [15.5, 20], [8.5, 20]], closed: true },
    { t: 'polyline', pts: [[10, 6.5], [14, 6.5]] },
    { t: 'polyline', pts: [[17.5, 9], [17.5, 12], [12, 12], [12, 15]] },
  ],
  document: [
    { t: 'polyline', pts: [[6, 2.5], [14.5, 2.5], [18, 6], [18, 21.5], [6, 21.5]], closed: true },
    { t: 'polyline', pts: [[14.5, 2.5], [14.5, 6], [18, 6]] },
    { t: 'polyline', pts: [[8.5, 10], [15.5, 10]] },
    { t: 'polyline', pts: [[8.5, 13.5], [15.5, 13.5]] },
    { t: 'polyline', pts: [[8.5, 17], [13, 17]] },
  ],
  gear: [
    { t: 'circle', cx: 12, cy: 12, r: 6.5 },
    { t: 'circle', cx: 12, cy: 12, r: 2.8 },
    { t: 'polyline', pts: [[18.5, 12], [21.5, 12]] },
    { t: 'polyline', pts: [[16.6, 16.6], [18.7, 18.7]] },
    { t: 'polyline', pts: [[12, 18.5], [12, 21.5]] },
    { t: 'polyline', pts: [[7.4, 16.6], [5.3, 18.7]] },
    { t: 'polyline', pts: [[5.5, 12], [2.5, 12]] },
    { t: 'polyline', pts: [[7.4, 7.4], [5.3, 5.3]] },
    { t: 'polyline', pts: [[12, 5.5], [12, 2.5]] },
    { t: 'polyline', pts: [[16.6, 7.4], [18.7, 5.3]] },
  ],
  target: [
    { t: 'circle', cx: 12, cy: 12, r: 8.5 },
    { t: 'circle', cx: 12, cy: 12, r: 5 },
    { t: 'circle', cx: 12, cy: 12, r: 1.6 },
  ],
  flag: [
    { t: 'polyline', pts: [[6, 2.5], [6, 21.5]] },
    { t: 'polyline', pts: [[6, 4], [18.5, 4], [15.5, 7.5], [18.5, 11], [6, 11]], closed: true },
  ],
  calendar: [
    { t: 'polyline', pts: [[3.5, 5], [20.5, 5], [20.5, 20.5], [3.5, 20.5]], closed: true },
    { t: 'polyline', pts: [[3.5, 9.5], [20.5, 9.5]] },
    { t: 'polyline', pts: [[8, 2.5], [8, 6.5]] },
    { t: 'polyline', pts: [[16, 2.5], [16, 6.5]] },
    { t: 'polyline', pts: [[7.5, 13.5], [10, 13.5]] },
    { t: 'polyline', pts: [[12, 16.5], [14.5, 16.5]] },
  ],
  check: [{ t: 'polyline', pts: [[4.5, 13], [10, 18.5], [19.5, 6.5]] }],
  alert: [
    { t: 'polyline', pts: [[12, 3.5], [21.5, 20], [2.5, 20]], closed: true },
    { t: 'polyline', pts: [[12, 9.5], [12, 14.5]] },
    { t: 'circle', cx: 12, cy: 17.3, r: 0.9 },
  ],
  star: [
    {
      t: 'polyline',
      pts: [
        [12, 3.5],
        [14.3, 9.3],
        [20.6, 9.7],
        [15.7, 13.7],
        [15.3, 19.8],
        [12, 16.4],
        [8.7, 19.8],
        [8.3, 13.7],
        [3.4, 9.7],
        [9.7, 9.3],
      ],
      closed: true,
    },
  ],
} as const satisfies Record<string, readonly IconCommand[]>;

export type IconName = keyof typeof ICONS;

/** Registry-derived name census — never hand-list icon names elsewhere. */
export function listIcons(): IconName[] {
  return Object.keys(ICONS).sort() as IconName[];
}

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

function getIcon(name: IconName): readonly IconCommand[] {
  const icon = ICONS[name];
  if (!icon) {
    throw new NormalizeError('unknown-icon', 'icon', `unknown icon '${String(name)}' — valid: ${listIcons().join(', ')}`, `use one of: ${listIcons().join(', ')}`);
  }
  return icon;
}


type CompiledIconPrimitive =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number };

/**
 * Compile an icon into chart-space primitives filling `box` (uniform scale,
 * centered; the 24-grid aspect is square so a square box maps 1:1). All
 * coordinates come out quantized to the shared 2-decimal path format.
 */
export function compileIcon(name: IconName, box: Rect): CompiledIconPrimitive[] {
  const scale = Math.min(box.w, box.h) / ICON_VIEWBOX;
  const ox = box.x + (box.w - ICON_VIEWBOX * scale) / 2;
  const oy = box.y + (box.h - ICON_VIEWBOX * scale) / 2;
  const tx = (x: number) => ox + x * scale;
  const ty = (y: number) => oy + y * scale;

  return getIcon(name).map((cmd): CompiledIconPrimitive => {
    if (cmd.t === 'circle') {
      return {
        kind: 'circle',
        cx: Number(fmt(tx(cmd.cx))),
        cy: Number(fmt(ty(cmd.cy))),
        r: Number(fmt(cmd.r * scale)),
      };
    }
    if (cmd.t === 'cubic') {
      const d =
        `M${fmt(tx(cmd.from[0]))} ${fmt(ty(cmd.from[1]))}` +
        `C${fmt(tx(cmd.c1[0]))} ${fmt(ty(cmd.c1[1]))} ${fmt(tx(cmd.c2[0]))} ${fmt(ty(cmd.c2[1]))} ${fmt(tx(cmd.to[0]))} ${fmt(ty(cmd.to[1]))}`;
      return { kind: 'path', d };
    }
    const d =
      cmd.pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(tx(p[0]))} ${fmt(ty(p[1]))}`)
        .join('') + (cmd.closed ? 'Z' : '');
    return { kind: 'path', d };
  });
}
