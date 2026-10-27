import { readerFloorPx } from '../../../typeFloors';
import { toneTextPaint } from '../chips';
import { DEFAULT_TARGET } from '../../../target';
import type { RenderTarget } from '../../../types/options';
import type { FontSpec } from '../../../text';
import type { SceneNode } from '../../../types/scene';
import type { ArrowScale, EncodingContext, ResolvedColumn, ResolvedRow } from '../../../types/table';
import { maxOf } from '../../../arrays';

interface ArrowMetrics {
  scale: ArrowScale;
  target?: RenderTarget;
  textScale?: number;
  font: FontSpec;
  maxAbs: number;
  valueX: number;
}

const ARROW_GAP = 4;

/**
 * 'absolute' cuts the change itself (a percent column's points) at 10 and 2,
 * so the glyph says what the key says; 'relative' cuts its share of the
 * column's largest change at the same steps.
 */
export function arrowGlyph(value: number, maxAbs: number, scale: ArrowScale): string {
  const share = scale === 'absolute' ? value / 100 : maxAbs > 0 ? value / maxAbs : 0;
  if (share > 0.1) return '↑';
  if (share > 0.02) return '↗';
  if (share >= -0.02) return '→';
  if (share >= -0.1) return '↘';
  return '↓';
}

/** The arrow shapes in the order they rise, with what each means under each cut. */
const ARROW_KEY: readonly (readonly [glyph: string, absolute: string, relative: string])[] = [
  ['↑', 'rise over 10%', 'rise over 10% of the largest change'],
  ['↗', 'rise over 2%, up to 10%', 'rise over 2%, up to 10% of the largest change'],
  ['→', 'within 2%', 'within 2% of the largest change'],
  ['↘', 'fall over 2%, up to 10%', 'fall over 2%, up to 10% of the largest change'],
  ['↓', 'fall over 10%', 'fall over 10% of the largest change'],
];

/** The note that says what the key's percentages are shares of. */
export const ARROW_FOOTNOTE = "An arrow's angle on a relative scale compares the change with the largest change in its column.";

export interface ArrowKeyEntry {
  id: string;
  label: string;
  glyph: string;
}

/**
 * The key of the arrow shapes a table draws, each shape once,
 * in the order they rise. Both surfaces draw these entries.
 */
export function arrowKey(columns: readonly ResolvedColumn[], rows: readonly ResolvedRow[]): ArrowKeyEntry[] {
  const drawn = { absolute: new Set<string>(), relative: new Set<string>() };
  for (const column of columns) {
    if (column.cellEncoding?.type !== 'arrow' || column.kind !== 'computed' || !column.polarity) continue;
    const scale = column.cellEncoding.scale;
    const values = rows.flatMap((row) => {
      const cell = row.cells[column.id];
      return cell?.state === 'value' && typeof cell.raw === 'number' ? [cell.raw] : [];
    });
    const maxAbs = Math.max(0, maxOf(values.map(Math.abs)));
    for (const value of values) drawn[scale].add(arrowGlyph(value, maxAbs, scale));
  }
  // A table with both cuts keys each: the plain shapes first, then the shares of the largest change.
  return (['absolute', 'relative'] as const).flatMap((scale) => ARROW_KEY.filter(([glyph]) => drawn[scale].has(glyph))
    .map(([glyph, absolute, relative]) => ({ id: scale === 'absolute' ? `arrowKey:${glyph}` : `arrowKey:relative:${glyph}`, label: scale === 'absolute' ? absolute : relative, glyph })));
}

export function emitArrow(context: EncodingContext, metrics: ArrowMetrics): SceneNode[] {
  const value = context.cell.raw;
  if (context.cell.state !== 'value' || typeof value !== 'number') return [];

  const glyph = arrowGlyph(value, metrics.maxAbs, metrics.scale);
  let font = metrics.font;
  let glyphWidth = context.measure(glyph, font).width;
  const valueWidth = context.measure(context.cell.displayed, metrics.font).width;
  const valueLeft = metrics.valueX - valueWidth;
  const available = valueLeft - context.box.x - ARROW_GAP;
  if (available <= 0) return [];
  if (glyphWidth > available) {
    const floor = Math.min(font.size, readerFloorPx(metrics.target ?? DEFAULT_TARGET, 'label', metrics.textScale));
    font = { ...font, size: Math.max(floor, (font.size * available) / glyphWidth) };
    glyphWidth = context.measure(glyph, font).width;
    if (glyphWidth > available) return [];
  }

  return [
    {
      t: 'text', typeRole: 'label',
      id: context.nodeId('arrow'),
      x: valueLeft - ARROW_GAP - glyphWidth,
      y: context.box.y + (context.box.h - context.measure(glyph, font).height) / 2,
      lines: [glyph],
      align: 'start',
      font,
      // The glyph prints in its figure's text colour, as the grid's arrow inherits it.
      ink: context.cell.tone === 'neutral' ? { token: 'neutral' } : context.toneInk ?? toneTextPaint(context.theme, context.cell.tone, context.palette),
      owner: context.owner,
      part: 'tableArrow',
    },
  ];
}
