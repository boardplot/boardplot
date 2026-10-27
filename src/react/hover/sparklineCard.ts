/**
 * The sparkline hover card. A KPI table's reader points at one
 * month and wants the shape of the twelve around it. The label card answers
 * with the cell's own facts; this one draws the row across its column group,
 * rings the point under the pointer, and prints the change lines the cell
 * already carries. Every word on it is authored data: the row's label, the
 * column labels, the group's label, the line labels and the drawn values.
 */

import { linePath } from '../../core/svgPath';
import { joinSentences } from '../../core/strings';
import { boxGap, type Rect } from '../../core/geometry';
import { cutWithTitle, fitText, lineBox } from '../../core/label/fitText';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../core/text';
import { strokeToken } from '../../core/theme';
import { toneTextPaint } from '../../core/charts/table/chips';
import { plotSparkline, TABLE_SPARK_STYLE } from '../../core/charts/sparkline/layout';
import type { SceneNode } from '../../core/types/scene';
import type { Theme } from '../../core/types/theme';
import type { Id } from '../../core/types/cell';
import type { ResolvedColumn, ResolvedTable } from '../../core/types/table';
import type { InteractionRecord } from '../../core/a11y/types';
import { CARD_SPACE, activeCoverCost, cardCoverCost, cardFont, cardSurface, cardValueLines, selectCardSlot, tableCardSlots,
  type LabelCardGeometry, type LabelCardInput } from './labelCard';
import { maxOf, minOf } from '../../core/arrays';

const CARD_MIN_WIDTH = 220;
const CARD_MAX_WIDTH = 320;
const SPARK_HEIGHT = 40;

/** The ringed point: an ink dot inside a background collar, so it reads over the line. */
const POINT_RADIUS = 3.2;
const POINT_RING = 0.75;
/** Fewer than three observations is not a shape worth drawing. */
const MIN_POINTS = 3;

interface TableSparklineCardInput {
  record: InteractionRecord;
  table: ResolvedTable;
  /**
   * The columns on screen; a hidden column is not part of the series, unless
   * its group sets `hoverSeries: 'all'`.
   */
  columns: readonly ResolvedColumn[];
  theme: Theme;
  /** The table's options.palette: the card prints tone text in the grid's colours. */
  palette?: string;
  canvas: Rect;
  target?: Rect;
  pointer?: LabelCardInput['pointer'];
  occupied?: LabelCardInput['occupied'];
  forbidden?: readonly Rect[];
  tableBounds?: Rect;
  direction?: 'ltr' | 'rtl';
  measure?: TextMeasurer;
  inlineVisibility?: Readonly<Record<Id, boolean>>;
}

interface TableSparklineCard {
  geometry: LabelCardGeometry;
  rect: Rect;
}

function clampInto(frame: Rect, rect: Rect): Rect {
  return {
    ...rect,
    x: Math.max(frame.x, Math.min(rect.x, frame.x + frame.w - rect.w)),
    y: Math.max(frame.y, Math.min(rect.y, frame.y + frame.h - rect.h)),
  };
}

/**
 * The value columns the hovered one belongs with: its column group, or, for
 * a column in no group, the visible columns in no group that print through
 * the same format. A series of one unit is the only series worth a line. A
 * group's members are the ones on screen; under `hoverSeries: 'all'` they
 * are every member in `columns[]` order, those a column toggle hides
 * included, read from the resolved table rather than from the screen.
 */
function seriesColumns(table: ResolvedTable, columns: readonly ResolvedColumn[], column: ResolvedColumn): ResolvedColumn[] {
  const numeric = (candidate: ResolvedColumn) => candidate.kind === 'value' || candidate.kind === 'computed';
  const group = table.columnGroups.find((candidate) => candidate.columnIds.includes(column.id));
  if (group !== undefined) {
    const members = new Set(group.columnIds);
    const pool = group.hoverSeries === 'all' ? table.columns : columns;
    return pool.filter((candidate) => members.has(candidate.id) && numeric(candidate));
  }
  // A column outside every group of a grouped table (a "FY YTD" block beside
  // the months) runs with the other ungrouped columns alone: the months and
  // a yearly total in one line are not a series.
  const grouped = new Set(table.columnGroups.flatMap((candidate) => candidate.columnIds));
  return columns.filter((candidate) => numeric(candidate) && candidate.format === column.format && !grouped.has(candidate.id));
}

export function tableSparklineCard(input: TableSparklineCardInput): TableSparklineCard | undefined {
  const { record, table, columns, theme } = input;
  const measure = input.measure ?? defaultMeasurer;
  const { rowId, colId } = record.target.owner;
  if (rowId === undefined || colId === undefined) return undefined;
  const row = table.rows.find((candidate) => candidate.id === rowId);
  const column = columns.find((candidate) => candidate.id === colId);
  // A section heading and a total have no series of their own to draw.
  if (row === undefined || column === undefined || row.role !== 'data') return undefined;
  if (column.kind !== 'value' && column.kind !== 'computed') return undefined;

  const series = seriesColumns(table, columns, column);
  // A cell that names its own format is another unit ("+2.7pp" among
  // percents), so only the cells in the hovered cell's own unit plot.
  const unit = row.cells[column.id]?.format;
  const points = series.map((member) => {
    const cell = row.cells[member.id];
    return cell?.state === 'value' && typeof cell.raw === 'number' && cell.format === unit ? cell.raw : null;
  });
  if (points.filter((value) => value !== null).length < MIN_POINTS) return undefined;
  const index = series.findIndex((member) => member.id === column.id);
  if (index < 0) return undefined;

  const titleFont = cardFont(theme, 12, 600);
  const spanFont = cardFont(theme, 11);
  const valueFont = cardFont(theme, 16, 600);
  const axisFont = cardFont(theme, 11);
  const lineFont = cardFont(theme);

  const group = table.columnGroups.find((candidate) => candidate.columnIds.includes(column.id));
  // The count of drawn points and the group's own label; where the author
  // wrote no label there is no noun to print and the span stays empty.
  const spanText = group?.label ? `${points.filter((value) => value !== null).length} ${group.label}` : '';
  const cell = row.cells[column.id]!;
  const valueText = `${column.label} · ${cell.displayed}`;
  // `visibleInlineRows` is the same one-line test, but it lives in
  // `core/charts/table/view`. The lazy hover engine serves every chart type;
  // importing it here would also load the table resolver for non-table cards.
  const drawn = (row.inlineRows ?? []).filter(
    (line) => input.inlineVisibility?.[line.inlineGroup ?? line.id] !== false,
  );
  // A line with no value in the hovered column ("—", "n/a") prints nothing.
  const lines = drawn.filter((line) => line.cells[column.id]?.state === 'value').map((line) => {
    const lineCell = line.cells[column.id];
    const toned = line.polarity !== undefined && lineCell?.state === 'value' && lineCell.tone !== 'neutral';
    return {
      label: line.label, value: lineCell?.displayed ?? '',
      text: `${line.label} ${lineCell?.displayed ?? ''}`.trim(),
      // The grid's tone colour, also held to 4.5:1 on the card's own ground.
      ink: toned ? toneTextPaint(theme, lineCell!.tone as 'good' | 'bad' | 'warn', input.palette, [{ css: cardSurface(theme).fill }]) : { token: 'inkMuted' as const },
    };
  });

  const pad = CARD_SPACE.x;
  const gap = CARD_SPACE.group;
  const valueWidth = measure(cell.displayed, { ...valueFont, tabular: true }).width;
  const width = Math.min(input.canvas.w, CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH,
    measure(row.label, titleFont).width + 2 * pad,
    measure(column.label, lineFont).width + CARD_SPACE.column + valueWidth + 2 * pad,
    maxOf(lines.map(line => measure(line.label, lineFont).width + CARD_SPACE.column
      + measure(line.value, { ...lineFont, tabular: true }).width + 2 * pad))));
  const inner = width - 2 * pad;
  if (inner <= 0) return undefined;
  const pairWidths = (left: number, right: number) => {
    if (right === 0) return [inner, 0] as const;
    const available = Math.max(0, inner - CARD_SPACE.column);
    const end = Math.min(right, available - Math.min(left, available / 2));
    return [available - end, end] as const;
  };
  // Reserve label space before wrapping values and measuring row heights.
  const [columnWidth, valueRoom] = pairWidths(measure(column.label, lineFont).width, valueWidth);
  const [changeLabelWidth, changesWidth] = pairWidths(
    Math.max(0, maxOf(lines.map(line => measure(line.label, lineFont).width))),
    Math.max(0, maxOf(lines.map(line => measure(line.value, lineFont).width))));
  const span = fitText(spanText, spanFont, inner, 1, measure);
  const valueLines = cardValueLines(cell.displayed, valueFont, Math.max(1, valueRoom), measure);
  const axisH = lineBox(axisFont);
  const valueH = valueLines.length * lineBox(valueFont);
  const changeValues = lines.map(line => cardValueLines(line.value, lineFont, Math.max(1, changesWidth), measure));
  const rest = CARD_SPACE.y * 2 + (spanText ? lineBox(spanFont) : 0) + valueH + SPARK_HEIGHT + axisH + gap * 3
    + (lines.length ? gap + changeValues.reduce((sum, value) => sum + value.length * lineBox(lineFont), 0) : 0);
  // The row's name in full, on the lines the capped card leaves after the value, the sparkline and the change
  // rows: at least one, the last cut with an ellipsis where it runs out. The accessible name keeps it whole.
  const whole = cardValueLines(row.label, titleFont, inner, measure, true);
  const titleRoom = input.canvas.h > 0 ? Math.max(1, Math.floor((input.canvas.h - rest) / lineBox(titleFont))) : Infinity;
  const title: { lines: string[]; title?: string } = whole.length <= titleRoom
    ? { lines: whole } : fitText(row.label, titleFont, inner, titleRoom, measure, { breakAfter: true });
  const height = rest + title.lines.length * lineBox(titleFont);
  // Cap the visible box at the viewport; keep the full accessible reading below.
  const rect = place(input, width, input.canvas.h > 0 ? Math.min(height, input.canvas.h) : height);

  const scene: SceneNode[] = [];
  const owner = record.target.owner;
  const id = (suffix: string) => `spark-card:${suffix}`;
  const surface = cardSurface(theme);
  scene.push({
    t: 'rect', id: id('box'), rect: { x: 0, y: 0, w: width, h: height },
    fill: { css: surface.fill }, stroke: { css: theme.color.grid },
    strokeWidth: strokeToken(theme, 'hair'), radius: surface.radius,
    owner, part: 'interaction-card',
  });

  let y = CARD_SPACE.y;
  const fit = (text: string, font: FontSpec, width: number) => cutWithTitle(text, font, Math.max(0, width), measure);
  scene.push({
    t: 'text', id: id('title'), x: pad, y, lines: title.lines, title: title.title,
    align: 'start', font: titleFont, ink: { css: theme.color.ink }, owner, part: 'interaction-label', role: 'category',
  });
  y += title.lines.length * lineBox(titleFont);
  if (spanText) {
    scene.push({
      t: 'text', id: id('span'), x: pad, y, lines: span.lines, title: span.title,
      align: 'start', font: spanFont, ink: { css: theme.color.inkMuted }, owner, part: 'interaction-label', role: 'caption',
    });
    y += lineBox(spanFont);
  }
  y += gap;
  const columnLabel = fit(column.label, lineFont, columnWidth);
  scene.push({
    t: 'text', id: id('column'), x: pad, y: y + (lineBox(valueFont) - lineBox(lineFont)) / 2,
    lines: [columnLabel.text], title: columnLabel.title, align: 'start', font: lineFont,
    ink: { css: theme.color.inkMuted }, owner, part: 'interaction-label', role: 'category',
  }, {
    t: 'text', id: id('value'), x: width - pad, y, lines: valueLines, align: 'end', font: valueFont,
    ink: { css: theme.color.ink }, owner, part: 'interaction-label', role: 'value',
  });
  y += valueH + gap;

  const domain = sparkDomain(points);
  const plot = plotSparkline({
    box: { x: pad, y, w: inner, h: SPARK_HEIGHT },
    values: points,
    shape: 'line',
    domain,
    style: TABLE_SPARK_STYLE,
  });
  if (domain.min < 0) {
    scene.push({
      t: 'line', id: id('zero'), x1: plot.plot.x, x2: plot.plot.x + plot.plot.w,
      y1: plot.yAt(0), y2: plot.yAt(0), stroke: { css: theme.color.grid }, width: strokeToken(theme, 'hair'),
      owner, part: 'interaction-mark',
    });
  }
  const path = plot.runs.filter((run) => run.length > 1).map((run) => linePath(run)).join('');
  if (path) {
    scene.push({
      t: 'path', id: id('line'), d: path, stroke: { css: theme.color.ink }, width: strokeToken(theme, 'mark'),
      owner, part: 'interaction-mark',
    });
  }
  const hovered = points[index];
  if (hovered !== null && hovered !== undefined) {
    const cx = plot.xAt(index);
    const cy = plot.yAt(hovered);
    scene.push({
      t: 'circle', id: id('point-ring'), cx, cy, r: POINT_RADIUS + POINT_RING,
      fill: { css: surface.fill }, owner, part: 'interaction-mark',
    });
    scene.push({
      t: 'circle', id: id('point'), cx, cy, r: POINT_RADIUS,
      fill: { css: theme.color.ink }, owner, part: 'interaction-mark',
    });
  }
  y += SPARK_HEIGHT + gap;

  const first = series[0]!;
  const last = series[series.length - 1]!;
  const [firstWidth, lastWidth] = pairWidths(measure(first.label, axisFont).width, last.id === first.id ? 0 : measure(last.label, axisFont).width);
  const firstLabel = fit(first.label, axisFont, firstWidth);
  const lastLabel = fit(last.label, axisFont, lastWidth);
  scene.push({
    t: 'text', id: id('axis-first'), x: pad, y, lines: [firstLabel.text], title: firstLabel.title, align: 'start',
    font: axisFont, ink: { css: theme.color.inkMuted }, owner, part: 'interaction-label', role: 'category',
  });
  if (last.id !== first.id) {
    scene.push({
      t: 'text', id: id('axis-last'), x: width - pad, y, lines: [lastLabel.text], title: lastLabel.title, align: 'end',
      font: axisFont, ink: { css: theme.color.inkMuted }, owner, part: 'interaction-label', role: 'category',
    });
  }
  y += axisH + gap;

  lines.forEach((line, lineIndex) => {
    const label = fit(line.label, lineFont, changeLabelWidth);
    scene.push({
      t: 'text', id: id(`line:${lineIndex}:label`), x: pad, y,
      lines: [label.text], title: label.title, align: 'start', font: lineFont,
      ink: { css: theme.color.inkMuted }, owner, part: 'interaction-label', role: 'caption',
    }, {
      t: 'text', id: id(`line:${lineIndex}`), x: width - pad, y,
      lines: changeValues[lineIndex]!, align: 'end', font: lineFont,
      ink: line.ink, owner, part: 'interaction-label', role: 'value',
    });
    y += changeValues[lineIndex]!.length * lineBox(lineFont);
  });

  const reading = joinSentences([
    [row.label, spanText].filter(Boolean).join(', '),
    valueText,
    ...lines.map((line) => line.text),
    `${first.label} to ${last.label}`,
  ]);
  return {
    rect,
    geometry: {
      type: 'interaction-card',
      size: { width, height },
      scene,
      a11y: { title: row.label, desc: reading },
    },
  };
}

/** Negative series include zero; other flat series keep their line on the midline. */
function sparkDomain(points: readonly (number | null)[]): { min: number; max: number } {
  const values = points.filter((value): value is number => value !== null);
  const min = minOf(values);
  const max = maxOf(values);
  return { min, max: min < 0 ? Math.max(0, max) : max };
}

/** Both table cards protect the cell and penalise row and text overlap. Never hide for lack of a seat. */
function place(input: TableSparklineCardInput, width: number, height: number): Rect {
  const { canvas, target } = input;
  if (target === undefined) return clampInto(canvas, { x: canvas.x + 12, y: canvas.y + 12, w: width, h: height });
  const candidates = tableCardSlots(target, canvas, width, height, input);
  const pointer = input.pointer ? { ...input.pointer, w: 0, h: 0 } : target;
  return selectCardSlot(candidates, [target], slot => Math.round((cardCoverCost(slot.rect, input.occupied ?? [], true)
    + activeCoverCost(slot.rect, input.forbidden) + boxGap(slot.rect, pointer)) * 1000) / 1000, input.pointer).rect;
}
