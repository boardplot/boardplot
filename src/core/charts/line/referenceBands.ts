import { chartString } from '../../strings/line';
import type { Theme } from '../../types/theme';
import { strokeToken } from '../../theme';
/**
 * Named reference bands (options.referenceBands): thin neutral bands at fixed
 * levels behind the line, each named in a column right of the plot, the bold
 * label and then the plain description. The names keep the bands' order and
 * spread apart where the bands sit closer than the names are tall; a name
 * that leaves its band's level is tied to it by an elbow leader. The leaders
 * run in the gutter between the plot and the column, so they never reach the
 * line, and each takes its own lane so no two cross.
 */

import { spread1DResult, warnSpreadOverflow } from '../../collide';
import type { Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { LineReferenceBand } from '../../types/options';
import type { LintWarning, SceneNode } from '../../types/scene';
import { maxOf } from '../../arrays';

/** A level draws this thick, and no range draws thinner. */
const REFERENCE_BAND_MIN_PX = 4;
/** The share of the canvas width the column takes before its entries wrap. */
const COLUMN_WIDTH_FRACTION = 0.18;
/** From the plot edge to the first elbow, the step between elbow lanes, and the run from the last lane into the name. */
const LANE_START = 4;
const LANE_STEP = 3;
const RUN_IN = 8;
/** Air between two entries of the column, and after the column to the canvas edge. */
const ENTRY_GAP = 4;
const EDGE_AIR = 4;
/** A name within this many px of its band's level reads as level with it and takes no leader. */
const LEVEL_TOLERANCE = 1.5;

interface ColumnLine {
  text: string;
  /** Present when the line mixes the bold name with plain words. */
  runs?: { text: string; weight: number }[];
  /** The whole line is the name. */
  nameOnly: boolean;
}

interface ColumnEntry {
  id: Id;
  low: number;
  high: number;
  label: string;
  description?: string;
  lines: ColumnLine[];
  width: number;
}

/** What the column needs before the frame is solved: its entries and the margin it takes. */
export interface ReferenceBandColumn {
  entries: ColumnEntry[];
  /** Width of the elbow gutter between the plot edge and the names. */
  gutter: number;
  /** Right margin the gutter, the column and its air take. */
  reserve: number;
  nameFont: FontSpec;
  textFont: FontSpec;
  lineH: number;
  minHeight: number;
}

/**
 * The name then the description, broken between words to the column width.
 * The name is never broken: it stays whole at the start of the first line.
 */
function wrapEntry(label: string, description: string | undefined, nameFont: FontSpec, textFont: FontSpec, maxWidth: number, measure: TextMeasurer): { lines: ColumnLine[]; width: number } {
  const nameW = measure(label, nameFont).width;
  const rows: string[][] = [[]];
  const widthOf = (row: number, words: string[]) =>
    (row === 0 ? nameW : 0) + (words.length === 0 ? 0 : measure(`${row === 0 ? ' ' : ''}${words.join(' ')}`, textFont).width);
  for (const word of description?.split(/\s+/u) ?? []) {
    const row = rows.length - 1;
    const next = [...rows[row]!, word];
    if (widthOf(row, next) <= maxWidth || (row > 0 && rows[row]!.length === 0)) rows[row] = next;
    else rows.push([word]);
  }
  const lines = rows.map((words, row): ColumnLine => {
    if (row > 0) return { text: words.join(' '), nameOnly: false };
    if (words.length === 0) return { text: label, nameOnly: true };
    const rest = ` ${words.join(' ')}`;
    return { text: `${label}${rest}`, runs: [{ text: label, weight: nameFont.weight }, { text: rest, weight: textFont.weight }], nameOnly: false };
  });
  return { lines, width: Math.max(...rows.map((words, row) => widthOf(row, words))) };
}

/** The column's entries and the right margin it reserves; undefined without bands. */
export function planReferenceBandColumn(
  bands: readonly LineReferenceBand[] | undefined,
  canvasWidth: number,
  font: FontSpec,
  measure: TextMeasurer,
): ReferenceBandColumn | undefined {
  if (!bands?.length) return undefined;
  const textFont = font;
  const nameFont = font;
  const widestName = maxOf(bands.map((band) => measure(band.label, nameFont).width));
  const maxWidth = Math.max(COLUMN_WIDTH_FRACTION * canvasWidth, widestName);
  // A generated id skips every authored one, and every one handed out
  // before it: two nodes with one id break the React scene.
  const taken = new Set(bands.flatMap((band) => (band.id === undefined ? [] : [band.id])));
  const idOf = (index: number): string => {
    let n = index + 1;
    while (taken.has(`band-${n}`)) n++;
    taken.add(`band-${n}`);
    return `band-${n}`;
  };
  const entries = bands.map((band, index): ColumnEntry => {
    const low = band.value ?? band.low!;
    const high = band.value ?? band.high!;
    return { id: band.id ?? idOf(index), low, high, label: band.label, description: band.description, ...wrapEntry(band.label, band.description, nameFont, textFont, maxWidth, measure) };
  });
  const gutter = LANE_START + LANE_STEP * (bands.length - 1) + RUN_IN;
  const width = maxOf(entries.map((entry) => entry.width));
  const lineH = font.size * (font.lineHeight ?? 1.2);
  return { entries, gutter, reserve: gutter + width + EDGE_AIR, nameFont, textFont, lineH,
    minHeight: entries.reduce((sum, entry) => sum + entry.lines.length * lineH, 0) + Math.max(0, entries.length - 1) * ENTRY_GAP };
}

/** Pairs of bands whose value spans meet; a shared level counts. */
function overlapWarnings(entries: readonly ColumnEntry[], warnings: LintWarning[]): void {
  entries.forEach((a, i) => {
    for (const b of entries.slice(i + 1)) {
      if (a.low > b.high || b.low > a.high) continue;
      warnings.push({
        code: 'reference-band-overlap',
        severity: 'warn',
        message: `reference bands '${a.id}' and '${b.id}' overlap (${a.low}–${a.high} and ${b.low}–${b.high}), so the reader cannot tell which name a value in the shared span belongs to`,
        suggest: 'give each band its own span, or merge the two into one band',
      });
    }
  });
}

/** A name with no word says only what the value axis already says. */
function unexplainedWarnings(entries: readonly ColumnEntry[], warnings: LintWarning[]): void {
  for (const entry of entries) {
    if (/\p{L}/u.test(`${entry.label} ${entry.description ?? ''}`)) continue;
    warnings.push({
      code: 'reference-band-unexplained',
      severity: 'warn',
      message: `reference band '${entry.id}' is named '${entry.label}' only, which repeats the value axis without saying what the level means`,
      suggest: "add a description, such as 'typical cycle'",
    });
  }
}

/**
 * Draws the bands behind the marks and the column with its leaders, and
 * claims the names and the leaders so no later label lands on them.
 * Returns the band rects, which go under the marks, and the column nodes.
 */
export function layoutReferenceBands(theme: Theme, input: {
  column: ReferenceBandColumn;
  plot: Rect;
  y: (value: number) => number;
  claims: OccupiedIndex;
  warnings: LintWarning[];
}): { bands: SceneNode[]; column: SceneNode[] } {
  const { column, plot, y, claims, warnings } = input;
  const { entries, lineH } = column;
  overlapWarnings(entries, warnings);
  unexplainedWarnings(entries, warnings);
  const bands: SceneNode[] = [];
  const nodes: SceneNode[] = [];
  const bottom = plot.y + plot.h;
  const levels = entries.map((entry) => {
    const a = y(entry.low);
    const b = y(entry.high);
    const h = Math.max(Math.abs(a - b), REFERENCE_BAND_MIN_PX);
    const top = Math.min(Math.max((a + b) / 2 - h / 2, plot.y), bottom - h);
    const owner = { annotationId: `referenceBand:${entry.id}` };
    bands.push({ t: 'rect', id: `referenceBand:${entry.id}`, rect: { x: plot.x, y: top, w: plot.w, h }, fill: { token: 'neutralLight' }, owner, part: 'referenceBand' });
    return top + h / 2;
  });
  // First line level with the band: the block centre sits half a block under the name's centre.
  const heights = entries.map((entry) => entry.lines.length * lineH);
  const spread = spread1DResult(entries.map((_, i) => ({ desired: levels[i]! - lineH / 2 + heights[i]! / 2, size: heights[i]! })), [plot.y, bottom], ENTRY_GAP);
  warnSpreadOverflow(warnings, spread.fits, `reference bands: the ${entries.length} names need more height than the plot has, so some touch; shorten the descriptions or drop a band`);
  const edge = plot.x + plot.w;
  const nameX = edge + column.gutter;
  const tops = spread.positions.map((centre, i) => centre - heights[i]! / 2);
  const shift = entries.map((_, i) => tops[i]! + lineH / 2 - levels[i]!);
  // Lanes: names moved up turn first from the top down, names moved down from
  // the bottom up, so a leader never crosses another's run.
  const lane = new Map<number, number>();
  const byLevel = entries.map((_, i) => i).sort((a, b) => levels[a]! - levels[b]! || a - b);
  byLevel.filter((i) => shift[i]! < -LEVEL_TOLERANCE).forEach((i, k) => lane.set(i, k));
  byLevel.reverse().filter((i) => shift[i]! > LEVEL_TOLERANCE).forEach((i, k) => lane.set(i, k));
  entries.forEach((entry, i) => {
    const owner = { annotationId: `referenceBand:${entry.id}` };
    const top = tops[i]!;
    const k = lane.get(i);
    if (k !== undefined) {
      const from = levels[i]!;
      const to = top + lineH / 2;
      const elbow = edge + LANE_START + LANE_STEP * k;
      nodes.push({ t: 'path', id: `referenceBand:${entry.id}:leader`, d: `M${edge} ${from}H${elbow}V${to}H${nameX - 2}`, stroke: { token: 'leader' }, width: strokeToken(theme, 'rule'), owner, part: 'leader' });
      claims.claim({ x: edge, y: from - 0.5, w: elbow - edge, h: 1 }, 'annotation', owner, 'referenceBandLeader');
      claims.claim({ x: elbow - 0.5, y: Math.min(from, to), w: 1, h: Math.abs(to - from) }, 'annotation', owner, 'referenceBandLeader');
      claims.claim({ x: elbow, y: to - 0.5, w: nameX - elbow, h: 1 }, 'annotation', owner, 'referenceBandLeader');
    }
    entry.lines.forEach((line, row) => {
      nodes.push({
        t: 'text', id: `referenceBand:${entry.id}:line${row + 1}`, x: nameX, y: top + row * lineH, lines: [line.text],
        ...(line.runs ? { runs: line.runs } : {}),
        align: 'start', typeRole: 'label', font: line.nameOnly ? column.nameFont : column.textFont, ink: { token: 'ink' }, owner, part: 'referenceBandLabel', role: 'note',
      });
    });
    claims.claim({ x: nameX, y: top, w: entry.width, h: heights[i]! }, 'annotation', owner, 'referenceBandLabel');
  });
  return { bands, column: nodes };
}

/** The accessible sentence: each band's span, in the value axis's format, and its name, after the description. */
export function referenceBandsA11y(column: ReferenceBandColumn | undefined, fmt: (value: number) => string, options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>): string {
  if (!column) return '';
  const span = (entry: ColumnEntry) => (entry.low === entry.high ? fmt(entry.low) : chartString(options, 'spanText', { v1: fmt(entry.low), v2: fmt(entry.high) }));
  return chartString(options, 'referenceBandsSentence', { v1: column.entries.map((entry) => `${span(entry)} (${[entry.label, entry.description].filter(Boolean).join(' ')})`).join(', ') });
}
