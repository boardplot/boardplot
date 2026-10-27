import type { Theme } from '../../types/theme';
import { strokeToken } from '../../theme';
import type { Rect } from '../../geometry';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import { type FontSpec, type TextMeasurer } from '../../text';
import { wrapFootnote } from '../../frame';
import type { Id } from '../../types/cell';
import type { OccupiedIndex } from '../../label/occupied';
import type { LintWarning, Paint, PlacedLabel, SceneNode } from '../../types/scene';

type AxisSide = 'primary' | 'secondary';

interface AxisSeries {
  id: Id;
  label: string;
  axis: AxisSide;
}

interface AxisTitleInput<T extends AxisSeries> {
  series: readonly T[];
  titles?: Partial<Record<AxisSide, string>>;
  active: Record<AxisSide, boolean>;
  frame: Rect;
  font: FontSpec;
  /** 'secondary' when the titles take the secondary text face (the anatomy). */
  typeRole?: 'axis' | 'secondary';
  measure: TextMeasurer;
  paintOf: (series: T) => Paint;
  /**
   * What sits between the title row and the plot top: the column total row,
   * or nothing. The top tick label reaches half its height above the plot, so
   * a title row with no total row under it keeps that half clear as well.
   */
  below: number;
  tickHalf: number;
  /**
   * The dual-axis anatomy: titles in the muted ink, each led
   * by a swatch of its axis' one series, a square for columns and a line
   * with a dot for a line.
   */
  swatchOf?: (series: T) => Omit<AxisTitleSwatch, 'offset'> | undefined;
  /**
   * No tick column is drawn (the anatomy labels every value): the titles
   * stand in one row from the left, as a key, when the row fits the frame.
   */
  row?: boolean;
}

/** Air between two titles in one row. */
const ROW_GAP = 18;

/** A swatch drawn before a title: its shape, paint and the room it takes left of the text. */
interface AxisTitleSwatch {
  kind: 'box' | 'line';
  paint: Paint;
  offset: number;
  hollow?: boolean;
  width?: number;
  dash?: number[];
  lineCap?: 'round' | 'butt';
}

export interface ComboAxisTitles {
  height: number;
  requests: LabelRequest[];
  paints: Map<Id, Paint>;
  swatches: Map<Id, AxisTitleSwatch>;
  warnings: LintWarning[];
}

/** Swatch geometry: a 10px square, or a 14px line with a 2.5px dot, then 5px of air. */
const SWATCH_BOX = 10;
const SWATCH_LINE = 14;
const SWATCH_GAP = 5;

/**
 * The title row is one label line plus 4px. The title starts 4px under the
 * top of the frame's plot band, so it clears the column totals under it by
 * the 8px pad every combo keeps above that band. Seating it 4px above the top
 * tick instead would put a title that overhangs its tick column on top of
 * the first or last column total.
 */
const TITLE_GAP = 4;
const TITLE_TOP = 4;

/**
 * The engine draws an axis title only when the author wrote one in
 * `axisTitles`. It composes none from series labels and units, and reserves
 * the title row only when a title is drawn. Longer titles wrap in their
 * measured slot. `anchorComboAxisTitles` moves each over its own tick column once
 * the plot is final.
 */
export function planComboAxisTitles<T extends AxisSeries>(input: AxisTitleInput<T>): ComboAxisTitles {
  const result: ComboAxisTitles = { height: 0, requests: [], paints: new Map(), swatches: new Map(), warnings: [] };
  const titles = (['primary', 'secondary'] as const).flatMap((side) => {
    const text = input.active[side] ? input.titles?.[side] : undefined;
    if (!text?.trim()) return [];
    const series = input.series.filter((item) => item.axis === side);
    return [{ side, unique: series.length === 1 ? series[0] : undefined, text }];
  });
  const maxWidth = Math.max(1, (input.frame.w - (titles.length > 1 ? 12 : 0)) / Math.max(1, titles.length));
  const height = input.measure('0', input.font).height;
  const swatchRoom = (unique: T | undefined): number => {
    const swatch = unique && input.swatchOf ? input.swatchOf(unique) : undefined;
    return swatch ? (swatch.kind === 'box' ? SWATCH_BOX : SWATCH_LINE) + SWATCH_GAP : 0;
  };
  const rowWidths = titles.map(({ unique, text }) => swatchRoom(unique) + input.measure(text, input.font).width);
  const inRow = input.row === true && titles.length > 1
    && rowWidths.reduce((sum, w) => sum + w, 0) + ROW_GAP * (titles.length - 1) <= input.frame.w;
  let rowX = input.frame.x;
  for (const { side, unique, text } of titles) {
    const id = `axis:${side}:title`;
    const swatch = unique && input.swatchOf ? input.swatchOf(unique) : undefined;
    const offset = swatch ? (swatch.kind === 'box' ? SWATCH_BOX : SWATCH_LINE) + SWATCH_GAP : 0;
    if (swatch) result.swatches.set(id, { ...swatch, offset });
    const lines = inRow ? [text] : wrapFootnote(text, input.font, Math.max(1, maxWidth - offset), input.measure);
    const width = Math.max(...lines.map(line => input.measure(line, input.font).width));
    const x = inRow ? rowX + offset : side === 'primary' ? input.frame.x + offset : input.frame.x + input.frame.w - width;
    rowX += offset + width + ROW_GAP;
    const titleHeight = height * lines.length;
    const owner = unique ? { seriesId: unique.id } : {};
    result.height = Math.max(result.height, titleHeight + TITLE_GAP + Math.max(0, input.tickHalf - input.below));
    result.requests.push({
      id, kind: 'axisTitle', owner, text, lines, typeRole: input.typeRole ?? 'axis', font: input.font, fontStep: input.font,
      // A title with a swatch is the key of its series: its name outranks a value it touches.
      priority: swatch ? PRIORITY.grandTotal + PRIORITY.highlightBonus : PRIORITY.grandTotal,
      candidates: [{
        slot: 'above', penalty: 0,
        rect: { x, y: input.frame.y + TITLE_TOP, w: width, h: titleHeight },
      }],
    });
    // A swatch keeps the colour and sets the words in the muted ink.
    result.paints.set(id, swatch || (input.swatchOf && !unique) ? { token: 'inkMuted' } : unique ? input.paintOf(unique) : { token: 'ink' });
  }
  return result;
}

const PRIMARY_AXIS_TITLE_ID = 'axis:primary:title';

/**
 * A title sits over its own tick column. The left title starts where
 * the left tick labels start; the right title ends where the right tick
 * labels end. The planner runs before the plot exists, so the caller hands in
 * the measured tick columns once the axes are laid out, and gets the anchored
 * requests back; the plan itself is left as it was. The frame stays the
 * bound, so a title wider than the free space never leaves the canvas.
 */
export function anchorComboAxisTitles(
  titles: ComboAxisTitles,
  columns: { left?: number; right?: number; rightStart?: number },
  frame: Rect,
): LabelRequest[] {
  return titles.requests.map((request) => {
    const candidate = request.candidates[0]!;
    const { w } = candidate.rect;
    // A swatch leads its title: the left one starts over the tick column and
    // the right one where the right tick labels start.
    const offset = titles.swatches.get(request.id)?.offset ?? 0;
    const x = request.id === PRIMARY_AXIS_TITLE_ID
      ? columns.left === undefined ? undefined : columns.left + offset
      : offset > 0 && columns.rightStart !== undefined
        ? columns.rightStart + offset
        : columns.right === undefined ? undefined : columns.right - w;
    if (x === undefined) return request;
    const anchored = { ...candidate, rect: { ...candidate.rect, x: Math.max(frame.x + offset, Math.min(x, frame.x + frame.w - w)) } };
    return { ...request, candidates: [anchored, ...request.candidates.slice(1)] };
  });
}

/** The swatches of the drawn titles, left of their text, centred on its line; each is claimed. */
export function comboAxisTitleSwatches(theme: Theme, labels: readonly PlacedLabel[], titles: ComboAxisTitles, occupied: OccupiedIndex): SceneNode[] {
  const nodes: SceneNode[] = [];
  for (const label of labels) {
    const swatch = titles.swatches.get(label.id);
    if (!swatch || label.hidden) continue;
    const x = label.rect.x - swatch.offset;
    const cy = label.rect.y + label.rect.h / Math.max(1, label.lines.length) / 2;
    const owner = label.owner;
    if (swatch.kind === 'box') {
      const rect = { x, y: cy - SWATCH_BOX / 2, w: SWATCH_BOX, h: SWATCH_BOX };
      nodes.push({ t: 'rect', id: `${label.id}:swatch`, rect, fill: swatch.paint, owner, part: 'axisTitleSwatch' });
      occupied.claim(rect, 'axis', {}, 'axisTitle');
    } else {
      nodes.push({ t: 'line', id: `${label.id}:swatch`, x1: x, y1: cy, x2: x + SWATCH_LINE, y2: cy, stroke: swatch.paint, width: swatch.width ?? strokeToken(theme, 'data'), ...(swatch.dash ? { dash: swatch.dash, lineCap: swatch.lineCap } : {}), owner, part: 'axisTitleSwatch' });
      if (swatch.hollow) nodes.push({ t: 'line', id: `${label.id}:swatch:inner`, x1: x, y1: cy, x2: x + SWATCH_LINE, y2: cy,
        stroke: { token: 'background' }, width: strokeToken(theme, 'hair'), ...(swatch.dash ? { dash: swatch.dash, lineCap: swatch.lineCap } : {}), owner, part: 'axisTitleSwatch' });
      nodes.push({ t: 'circle', id: `${label.id}:swatch:dot`, cx: x + SWATCH_LINE / 2, cy, r: 2.5, fill: swatch.hollow ? { token: 'background' } : swatch.paint, ...(swatch.hollow ? { stroke: swatch.paint, strokeWidth: strokeToken(theme, 'mark') } : {}), owner, part: 'axisTitleSwatch' });
      occupied.claim({ x, y: cy - 3, w: SWATCH_LINE, h: 6 }, 'axis', {}, 'axisTitle');
    }
  }
  return nodes;
}

export function applyComboAxisTitlePaint(labels: PlacedLabel[], titles: ComboAxisTitles): void {
  for (const label of labels) {
    const paint = titles.paints.get(label.id);
    if (paint) label.ink = paint;
  }
}
