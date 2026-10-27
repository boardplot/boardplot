/**
 * A status chip's paint, one answer for both table surfaces: the SVG
 * draws it as a rect and a text, the React grid writes it into its
 * stylesheet.
 */
import { groundTextPaint, markRolePaint, mixedPaint, resolveSurface, semanticPalettePaint, seriesTextPaint } from '../../theme';
import type { Paint } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { ResolvedCell, ResolvedColumn, ResolvedRow } from '../../types/table';
import { tableInk } from './statement';

type ChipTone = 'good' | 'bad' | 'warn' | 'neutral';

/** Only drawn figures take a tone ground; status chips carry their own ground. */
export function isFigureCell(cell: ResolvedCell, column: ResolvedColumn): boolean {
  return (column.kind === 'value' || column.kind === 'computed') && cell.state === 'value';
}

export function hasPolarityBadge(cell: ResolvedCell, column: ResolvedColumn): boolean {
  return cell.kind !== 'status' && column.cellEncoding?.type === 'polarityBadge' && cell.state === 'value' && cell.tone !== 'neutral' && !cell.deEmphasized;
}

/** A polarity chip keeps the page paints on every row ground. */
export function polarityBadgeInk(theme: Theme, cell: ResolvedCell, column: ResolvedColumn, row: ResolvedRow, palette?: string): Paint {
  if (row.kind === 'driver' && !(row.driverTone && cell.kind !== 'rowLabel')) return tableInk('driver');
  if (cell.kind === 'rowLabel' && (row.kind === 'detail' || row.kind === 'split')) return tableInk('child');
  if (column.emphasis === 'muted' || (cell.relation === 'ofWhich' && theme.table?.ofWhich !== 'ink')) return { token: 'inkMuted' };
  if (theme.table?.tones === 'fill' && isFigureCell(cell, column) && (row.role !== 'total' || row.kind === 'result' || row.kind === 'driver')) return tableInk('figure');
  return cell.tone === 'neutral' ? { token: 'ink' } : toneTextPaint(theme, cell.tone, palette);
}

const TONE_TEXT_PAINTS = new WeakMap<Theme, Map<string, Paint>>();

/** A tone wash behind text mixed toward ink, the publisher badge anatomy; a neutral chip keeps muted ink. */
export function chipPaints(theme: Theme, tone: ChipTone, palette?: string): { fill: Paint; ink: Paint } {
  const tint = resolveSurface(theme).chipTint;
  return tone === 'neutral'
    ? { fill: semanticPalettePaint(theme, palette, tone, tint), ink: { token: 'inkMuted' } }
    : { fill: { token: tone, tint }, ink: mixedPaint({ token: tone }, { token: 'ink' }, 0.65, tone) };
}

/**
 * A tone printed as text (a toned figure, its change line, the hover card's line): the tone
 * deepened until it reads at 4.5:1 on the page and on every ground a table row can carry, the
 * band, the total ground, a column band, a badge and a row wash, and on the grounds the theme
 * authors (`table.grounds.total`, `subtotal`, and every tone ground under `tones: 'fill'`: an inline
 * line with its own tone sits on its parent's fill, which may be another tone's) that sit on the
 * page's side of lightness and read with the page ink; other grounds take their own ink (`onTableGround`).
 * One colour per tone, so the SVG and the grid print the same. The grounds repeat the table
 * layout's recipes; a surface of its own (the hover card) adds its ground in `extraGrounds`.
 */
export function toneTextPaint(theme: Theme, tone: 'good' | 'bad' | 'warn', palette?: string, extraGrounds: readonly Paint[] = []): Paint {
  // Cells with the same tone share one recipe, so painting can resolve it once per theme.
  let cache = TONE_TEXT_PAINTS.get(theme);
  const key = `${tone}:${palette ?? ''}`;
  if (extraGrounds.length === 0) {
    const known = cache?.get(key);
    if (known) return known;
    if (!cache) TONE_TEXT_PAINTS.set(theme, cache = new Map());
  }
  const surface = resolveSurface(theme);
  const total = semanticPalettePaint(theme, palette, 'neutral', 1 - Math.min(1, surface.bandTint * 2));
  // Every ground uses the same page-side rule, decided again in a repaint's theme.
  const fills = theme.table?.tones === 'fill' ? TONE_FILLS.map(tableGround) : [];
  const authored = [theme.table?.grounds?.total, theme.table?.grounds?.subtotal]
    .flatMap((css): Paint[] => css === undefined ? [] : [{ css }])
    .concat(fills);
  const grounds: Paint[] = [
    semanticPalettePaint(theme, palette, 'neutral', 1 - surface.bandTint),
    total,
    { token: 'neutral', theme: { kind: 'mix', from: { token: 'ink' }, to: total, weight: surface.bandTint } },
    semanticPalettePaint(theme, palette, 'neutral', surface.anchorTint),
    chipPaints(theme, tone, palette).fill,
    semanticPalettePaint(theme, palette, 'focus', surface.rowTint),
    ...(['good', 'bad', 'warn'] as const).map((wash): Paint => ({ ...markRolePaint(wash, true), tint: surface.rowTint })),
    ...authored,
    ...extraGrounds,
  ];
  const paint = seriesTextPaint({ token: tone }, grounds.map((ground): Paint => ({ token: 'background', theme: { kind: 'page-side-ground', ground } })));
  if (extraGrounds.length === 0) cache!.set(key, paint);
  return paint;
}

const TONE_FILLS = ['good', 'goodStrong', 'warn', 'bad'] as const;

/** A tone fill under `table.tones: 'fill'`, the ground a judged figure stands on. */
export function tableGround(ground: typeof TONE_FILLS[number]): Paint {
  return { token: 'background', theme: { kind: 'table-ground', ground } };
}

/**
 * Text on a table ground (a row ground, a column band, a tone fill). A ground that reads with the page ink keeps
 * its ink; other grounds (a dark total on a light page) step the tone until it reads at 4.5:1 on that ground
 * alone, primary text takes the ground's readable ink and muted text steps from its own ink. Decided in the theme
 * the scene is painted in, so a repaint from light to dark decides again.
 */
export function onTableGround(ink: Paint, ground: Paint | undefined, tone?: 'good' | 'bad' | 'warn'): Paint {
  if (ground === undefined) return ink;
  if (tone !== undefined) return groundTextPaint(ink, ground, { token: tone });
  return groundTextPaint(ink, ground, 'token' in ink && ink.token === 'ink' ? undefined : ink);
}

/** A chip's height in a row: one chip line plus its air, at least 18 px, and 3 px clear of the row edges. */
export function chipHeight(rowH: number, fontSize: number): number {
  return Math.min(rowH - 6, Math.max(18, fontSize * 1.2 + 4));
}

/** A status square (mark: 'square'): its side and its air before the ink text, from the text size; the grid draws .6em and .4em. */
export function statusSquare(fontSize: number): { side: number; gap: number } {
  return { side: Math.max(6, Math.round(fontSize * 0.6)), gap: Math.max(4, Math.round(fontSize * 0.4)) };
}

/** A status square's fill: the tone itself; neutral takes the muted ink, so the square stays visible on the page. */
export function statusSquarePaint(tone: ChipTone): Paint {
  return tone === 'neutral' ? { token: 'inkMuted' } : { token: tone };
}
