import { chartString } from '../../strings/bartable';
import { liftOrFallback } from '../tableFit';
import { chartPalette } from '../chartEnv';
import { withSegmentSeams } from '../../markVisibility';
import { structureCount } from '../../structureCounts';
/**
 * Bar table layout. Tracks left to right: the row labels (at most 40 % of
 * the content width, two lines), one right-aligned track per number column,
 * then the panels, which share the rest by weight. A panel is a 16 px gap,
 * the bar run from zero, and a reserve for the widest end label; each panel
 * scales 0 to its own longest bar. No value axis: the end labels carry the
 * numbers, as in a notation table. A row with an authored range fills
 * its segments to the low end, split in their own shares, and runs a light
 * outlined extension from low to high, so the label after it reads as the
 * two ends of the bar. The structure follows the cohort
 * exhibit: a head row with a hairline under it, rows, and a Total row under
 * a stronger rule.
 */

import { accumulateStack } from '../band/stacks';
import { digitSeat, digitSeatEdge } from '../band/labels';
import { deriveCascade } from './cascade';
import { fixedBarRow } from '../bar/model';
import { warnIncompleteComposition } from '../../dataGaps';
import { authoredNotes, frameTextOptions, legendRequired, moreListedText, normalizeLegendOption, solveFrame, type LegendItemInput } from '../../frame';
import { nonAdditiveFormat, roundedNumber, seriesRasterFormatter } from '../../formatSpec';
import type { Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { fitText, lineBox, type FittedText } from '../../label/fitText';
import { createOccupiedIndex } from '../../label/occupied';
import { fittedLabel } from '../../label/rowFit';
import { rowLabelBand } from '../../label/rowLabels';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize, resolveSubtitle } from '../../normalize/shared';
import { formatAutomaticPercent, formatShare, numberRange } from '../../format';
import { fixedHeightCanvas, rowDrivenHeight } from '../../rowCanvas';
import { CARD_CLASS_WIDTH, heightOmitted, rowSizing } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { isNumberAlone } from '../../textRole';
import { fieldHeadFont, fieldHeadText, headInk, headRule, totalGround, totalRule } from '../table/headFace';
import { tableRuleInk } from '../table/statement';
import { defaultMeasurer, splitNameBreaks, type FontSpec, type TextMeasurer } from '../../text';
import {
  canvasMargin,
  markRolePaint,
  paintColor,
  panelTypeClass,
  rampSlots,
  resolveTheme,
  seriesPaint,
  themeForWidth,
  tableEmphasis,
  strokeToken,
  dashToken,
} from '../../theme';
import type { Id, OwnerRef } from '../../types/cell';
import type { Geometry, LintWarning, Paint, SceneNode } from '../../types/scene';
import type {
  BarTableCellState,
  BarTableData,
  BarTablePlainData,
  BarTableValue,
  BarTableEnd,
  BarTableDerived,
  BarTableMarks,
  BarTableOptions,
  BarTablePanelDerived,
} from './types';
import { disclosureNote, quietMethodNote } from '../../notes';
import { shareRoundingNotes } from '../../shareRounding';
import { footerType } from '../../footer';
import { textScaleOf } from '../../typeFloors';
import { maxOf, minOf, pushAll } from '../../arrays';

const LABEL_GAP = 12;
const CELL_AIR = 12;
const PANEL_GAP = 16;
const END_GAP = 6;
const MIN_RUN = 40;
const PREFERRED_RUN = 48;
const ROW_PITCH = 28;
const BAR_H = 14;
/** The most a pinned canvas stretches a row, as a multiple of the natural pitch, and the share of that growth the bar takes. */
const MAX_ROW_GROWTH = 1.25;
const BAR_GROWTH = 0.9;
// A panel prints its parts inside the bars up to this many decimals; a part keeps this padding each side.
const PART_DECIMALS = 1;
const PART_PAD = 3;
// The digits keep 2 px of air over and under them inside a bar shorter than the line box.
const PART_AIR = 4;
const HEAD_GAP = 6;
const TOTAL_GAP = 6;
const RANGE_KEY = '__range';
const RESIDUAL_KEY = '__residual';
const RANGE_FILL: Paint = { token: 'neutralLight' };
// The outline keeps the extension apart from a light segment: the grey ramps
// of the notation themes end in a light grey as well.
const RANGE_STROKE: Paint = { token: 'neutral' };
// Cascade: the share column, the bracket and the shortest track a panel keeps.
const SHARE_GAP = 8;
const BRACKET_GAP = 6;
const BRACKET_ARM = 5;
const BRACKET_TEXT_GAP = 4;
const MIN_TRACK = 56;
const TRACK_FILL: Paint = { token: 'neutralLight' };
const BLOCK_GAP = 12;
const MIN_COMPACT_LABEL = 48;
// A cascade value ends this far left of its segment, or starts this far inside it; a Total starts TOTAL_PAD in.
const VALUE_PAD = 3;
const TOTAL_PAD = 6;
// Interleaved compact form (several panels): one bar line per panel under each row name.
const ROW_GAP = 4;
const THIN_BAR = 7;
const KEY_W = 14;
const KEY_GAP = 6;
const COMBINED_PAD = 4;
const RESIDUAL_FILL: Paint = markRolePaint('neutral', true);

/**
 * Residual rows ("Rest of …") pinned below the others, each keeping its
 * place among its kind: every per-row array follows the new order.
 */
function pinResidual(data: BarTableData): BarTableData {
  const order = data.categories.map((_, r) => r)
    .sort((a, b) => Number(!!data.categories[a]!.residual) - Number(!!data.categories[b]!.residual) || a - b);
  if (order.every((r, i) => r === i)) return data;
  const pick = <T>(values: readonly T[]) => order.map((r) => values[r]!);
  return {
    ...data,
    categories: pick(data.categories),
    ...(data.columns ? { columns: data.columns.map((column) => ({ ...column, values: pick(column.values) })) } : {}),
    panels: data.panels.map((panel) => ({
      ...panel,
      values: Object.fromEntries(Object.entries(panel.values).map(([key, values]) => [key, pick(values)])),
      ...(panel.ends ? { ends: pick(panel.ends) } : {}),
    })),
  };
}

/** The authored state of each cell of a values array, by the identity of its plain twin. */
type CellStates = WeakMap<object, (BarTableCellState | undefined)[]>;

/**
 * An authored state is a null with a reason: the data goes on as numbers and
 * nulls, and the states stand beside it, found by the values array they belong to.
 */
function splitStates(data: BarTableData): { data: BarTablePlainData; states: CellStates } {
  const states: CellStates = new WeakMap();
  const plain = (values: readonly BarTableValue[]): (number | null)[] => {
    if (!values.some((value) => value !== null && typeof value === 'object')) return values as (number | null)[];
    const out = values.map((value) => (typeof value === 'number' ? value : null));
    states.set(out, values.map((value) => (typeof value === 'object' && value !== null ? value.state : undefined)));
    return out;
  };
  const { columns, ...rest } = data;
  return {
    data: {
      ...rest,
      ...(columns ? { columns: columns.map((column) => ({ ...column, values: plain(column.values) })) } : {}),
      panels: data.panels.map((panel) => ({ ...panel, values: Object.fromEntries(Object.entries(panel.values).map(([id, values]) => [id, plain(values)])) })),
    },
    states,
  };
}

/**
 * The aggregate each panel and column prints, set once: percentages, rates and
 * multiples do not add, so a Total over them defaults to 'none'. A panel reads
 * its own format, else options.format, and a '%' unit; a cascade splits its
 * panel total, so its panels keep the sum. An authored 'sum' over such a
 * figure stays and warns once.
 */
function withAggregates(data: BarTablePlainData, options: BarTableOptions, warnings: LintWarning[]): BarTablePlainData {
  const cascade = options.variant === 'cascade';
  const warn = (path: (string | number)[], id: Id) => {
    if (options.total === false) return;
    warnings.push({
      code: 'aggregate-non-additive',
      severity: 'warn',
      message: `'${id}' sums a percentage, a rate or a multiple, which do not add: the Total prints a sum that is no total`,
      suggest: "drop aggregate: 'sum' so the Total stays empty, or author a weighted figure",
      field: path,
    });
  };
  return {
    ...data,
    ...(data.columns ? {
      columns: data.columns.map((column, c) => {
        const additive = !nonAdditiveFormat(column.format);
        if (column.aggregate === 'sum' && !additive) warn(['data', 'columns', c, 'aggregate'], column.id);
        return { ...column, aggregate: column.aggregate ?? (additive ? 'sum' : 'none') };
      }),
    } : {}),
    panels: data.panels.map((panel, p) => {
      const additive = cascade || !(nonAdditiveFormat(panel.format ?? options.format) || panel.unit?.trim() === '%');
      if (panel.aggregate === 'sum' && !additive) warn(['data', 'panels', p, 'aggregate'], panel.id);
      return { ...panel, aggregate: panel.aggregate ?? (additive ? 'sum' : 'none') };
    }),
  };
}

/** The cascade refusals that need data and options together. */
function checkCascade(data: BarTablePlainData, growth: unknown): void {
  const refuse = (path: string, message: string, suggest: string) => {
    throw new NormalizeError('bartable-cascade', path, message, suggest);
  };
  if (growth && data.panels.length < 2) {
    refuse('options.cascade.growth', 'the growth column compares the first panel with the last, and the table has one panel', 'add a second panel, or drop options.cascade.growth');
  }
  // The cascade adds tracks named 'growth' and 'share:<panel>'; an authored id must not take one.
  [...(data.columns ?? []).map((column, i) => ({ id: column.id, path: `data.columns[${i}].id` })), ...data.panels.map((panel, i) => ({ id: panel.id, path: `data.panels[${i}].id` }))]
    .forEach(({ id, path }) => {
      if (id === 'growth' || id.startsWith('share:')) refuse(path, `cascade names its own columns 'growth' and 'share:<panel>', and '${id}' takes one of those names`, 'rename the column or panel');
    });
  if (data.series.length !== 1) {
    refuse('data.series', `cascade draws one part of the panel total per row, and the table has ${data.series.length} segments; a split inside a cascade step has no baseline to compare its parts by length`,
      "keep one entry in data.series, or set variant 'panels' to stack the segments from zero");
  }
  data.panels.forEach((panel, p) => {
    if (panel.ends) refuse(`data.panels[${p}].ends`, 'cascade ends every row where the next starts, so a row has no range', "drop ends, or set variant 'panels'");
    if (panel.aggregate === 'none') refuse(`data.panels[${p}].aggregate`, "cascade splits the panel total, and aggregate 'none' says the rows do not add up", "drop aggregate 'none', or set variant 'panels'");
    const values = panel.values[data.series[0]!.id] ?? [];
    const missing = values.findIndex((value) => value === null);
    if (missing >= 0) refuse(`data.panels[${p}].values.${data.series[0]!.id}[${missing}]`, 'cascade starts each row where the row above ended, so a missing value leaves every row below it without a start', 'give the row a value, or drop the row');
  });
}

/**
 * Internal option: the note naming bars too short to read on their panel's
 * shared scale. The scale is known only once the frame is solved, so
 * a first pass finds them and the table is laid out again with the note.
 */
const SLIVER_NOTE = Symbol('bartableSliverNote');
/** A bar shorter than this reads as a sliver beside its panel's longest. */
const SLIVER_PX = 6;
/** A part narrower than this keeps at most 1 px of fill beside its 1 px seam: it is hidden. */
const HIDDEN_PART_PX = 2;

/** The name of the combined rows: the authored label, else their labels joined ("A, B and C"). */
function combinedLabel(label: string | undefined, names: readonly string[], options: BarTableOptions): string {
  return label ?? names.reduce((text, name, i, all) => (i === 0 ? name : `${text}${i === all.length - 1 ? ` ${chartString(options, 'and')} ` : ', '}${name}`), '');
}

/**
 * A library note is at most two lines at the note width. It names the
 * items in order and closes with "and N more" once the next would pass.
 */
function twoLineNote(lead: string, items: readonly string[], tail: string, font: FontSpec, width: number, measure: TextMeasurer, options: BarTableOptions): string {
  const text = (shown: readonly string[], rest: number) =>
    `${lead}: ${[...shown, ...(rest > 0 ? [moreListedText(rest, options)] : [])].join(', ')}${tail}.`;
  const fits = (candidate: string) => fitText(candidate, font, width, 2, measure).title === undefined;
  for (let n = items.length; n > 1; n--) if (fits(text(items.slice(0, n), items.length - n))) return text(items.slice(0, n), items.length - n);
  return text(items.slice(0, 1), items.length - 1);
}

/**
 * The combined share of named rows in each summed panel, with its
 * numerator, denominator and, where rows carry ranges, the end each belongs to.
 */
function combinedShareNotes(
  options: BarTableOptions,
  rows: readonly { id: string; label: string }[],
  panels: readonly { panel: BarTablePlainData['panels'][number]; rowSums: (number | null)[]; ranges: (BarTableEnd | undefined)[]; fmt: (v: number) => string }[],
  locale: string | undefined,
  authored: BarTablePlainData['panels'],
): string[] {
  const combined = options.combinedShare;
  if (!combined) return [];
  const picked = combined.rows.map((id, i) => {
    // The schema refuses a repeat; a direct caller gets the same refusal.
    if (combined.rows.indexOf(id) !== i) {
      throw new NormalizeError('bartable-combined-share-row', `options.combinedShare.rows[${i}]`,
        `combinedShare names row '${id}' twice, which counts it twice; name each row once`, 'drop the repeated row id');
    }
    const r = rows.findIndex((row) => row.id === id);
    if (r < 0) {
      throw new NormalizeError('bartable-combined-share-row', `options.combinedShare.rows[${i}]`,
        `combinedShare names row '${id}', which the table does not have`, `use one of the row ids: ${rows.map((row) => row.id).join(', ')}`);
    }
    return r;
  });
  // The panels form shades the combined rows, and the note names them as such.
  const label = chartString(options, 'combinedShadedLead', { v1: combinedLabel(combined.label, picked.map((r) => rows[r]!.label), options) });
  // A zero whole has no share: say so instead of printing NaN%.
  const pct = (part: number, whole: number) => (whole === 0
    ? chartString(options, 'combinedShareZero')
    : formatShare((part / whole) * 100, locale));
  return panels.flatMap((entry, p) => {
    // Only an authored 'none' drops the readout: a defaulted 'none' (a % unit) still has rows that add.
    if (authored[p]?.aggregate === 'none' || entry.rowSums.some((sum) => sum === null)) return [];
    const unit = entry.panel.unit ? ` ${entry.panel.unit}` : '';
    const at = (end: 'low' | 'high', r: number) => entry.ranges[r]?.[end] ?? entry.rowSums[r]!;
    const sumAt = (end: 'low' | 'high', of: readonly number[]) => of.reduce((sum, r) => sum + at(end, r), 0);
    const all = rows.map((_, r) => r);
    const name = entry.panel.label ?? entry.panel.id;
    if (!entry.ranges.some(Boolean)) {
      const part = sumAt('low', picked);
      const whole = sumAt('low', all);
      // The readout the author asked for with combinedShare: printed like a footnote.
      return [disclosureNote(chartString(options, 'combinedShareNote', { v1: label, v2: entry.fmt(part), v3: entry.fmt(whole), v4: unit, v5: name, v6: pct(part, whole) }))];
    }
    const [lowPart, lowWhole, highPart, highWhole] = [sumAt('low', picked), sumAt('low', all), sumAt('high', picked), sumAt('high', all)];
    return [disclosureNote(chartString(options, 'combinedShareRangeNote', { v1: label, v2: entry.fmt(lowPart), v3: entry.fmt(lowWhole), v4: unit, v5: name, v6: pct(lowPart, lowWhole), v7: entry.fmt(highPart), v8: entry.fmt(highWhole), v9: pct(highPart, highWhole) }))];
  });
}

/** How a cascade growth figure that rounds to 0 prints: full digits, its bound ("<0.1") or the rounded text. */
const CASCADE_LIFT = Symbol('bartableCascadeLift');
type CascadeLift = 'full' | 'none' | 'compact';

export function layoutBarTable(
  authored: BarTableData,
  options: BarTableOptions = {},
): Geometry<BarTableMarks, BarTableDerived> {
  if (options.variant !== 'cascade' || (options as { [CASCADE_LIFT]?: CascadeLift })[CASCADE_LIFT] !== undefined) return layoutBarTableOnce(authored, options);
  // A lifted growth figure ("0.0001") is wider than the rounded "0.0". Where that moves the table
  // under its frame's minimum (the compact form), it prints its bound; where the bound does too, the rounded text.
  const fixedWidth = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.width !== false;
  const misses = (geometry: Geometry<BarTableMarks, BarTableDerived>) => fixedWidth && geometry.sizing !== undefined && geometry.size.width < geometry.sizing.minWidth;
  return liftOrFallback((mode) => layoutBarTableOnce(authored, { ...options, [CASCADE_LIFT]: mode } as BarTableOptions),
    (lifted, plain) => !misses(plain) && misses(lifted));
}

function layoutBarTableOnce(
  authored: BarTableData,
  options: BarTableOptions,
): Geometry<BarTableMarks, BarTableDerived> {
  const split = splitStates(pinResidual(authored));
  const { states } = split;
  if (options.cascade !== undefined && options.variant !== 'cascade') {
    throw new NormalizeError('bartable-cascade', 'options.cascade', "cascade sets the share cascade, and this table draws variant 'panels'", "set variant 'cascade', or drop cascade");
  }
  if (options.segmentValues !== undefined && options.variant === 'cascade') {
    throw new NormalizeError('bartable-cascade', 'options.segmentValues', "segmentValues sets the part values of variant 'panels', and a cascade bar is one part that prints its own value", "set variant 'panels', or drop segmentValues");
  }
  const cascadeOptions = options.variant === 'cascade' ? options.cascade ?? {} : undefined;
  if (cascadeOptions) checkCascade(split.data, cascadeOptions.growth);
  const warnings: LintWarning[] = [];
  const data = withAggregates(split.data, options, warnings);
  // With the share columns hidden, the bracket and the share change still print from the rounded shares.
  if (options.rounding === 'sum-consistent' && cascadeOptions?.share === false && !options.combinedShare && cascadeOptions.growth?.measure !== 'share-change') {
    throw new NormalizeError('bartable-rounding', 'options.rounding', "rounding 'sum-consistent' sets how the share columns print, and this table prints none", "set cascade.share on, or drop options.rounding");
  }
  if (options.rounding === 'sum-consistent' && !cascadeOptions) {
    throw new NormalizeError('bartable-rounding', 'options.rounding', "rounding 'sum-consistent' sets how the cascade share columns print, and this table has no cascade", "set variant 'cascade', or drop options.rounding");
  }
  const sharedScale = options.sharedScale ?? cascadeOptions !== undefined;
  if (sharedScale && data.panels.some((panel) => panel.weight !== undefined)) {
    throw new NormalizeError('bartable-panel-weight', 'data.panels', "under sharedScale each panel is as wide as its longest bar on the one scale, so a weight has nothing to set", 'drop the weights, or set sharedScale false');
  }
  if (options.rounding === 'nearest' && (!cascadeOptions || (cascadeOptions.share === false && !options.combinedShare && cascadeOptions.growth?.measure !== 'share-change'))) {
    warnings.push({
      code: 'bartable-rounding-ignored', severity: 'warn',
      message: 'rounding has no effect because this chart has no cascade share calculation.',
      suggest: "Set variant: 'cascade' with cascade.share: true, or remove rounding.",
      field: ['options', 'rounding'],
      fix: [{ op: 'remove', path: '/options/rounding' }],
    });
  }
  const size = resolveSize(options.size);
  const theme = themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? size.width);
  chartPalette(theme, options.palette, warnings);
  const measure = options.measure ?? defaultMeasurer;
  const locale = options.locale?.language;
  const glyph = theme.table?.glyphs?.missing ?? '–';
  // An authored state prints as the table prints it: the theme's glyph, else n/a in the locale's words and n.m.
  const stateGlyph: Record<BarTableCellState | 'none', string> = {
    none: glyph,
    na: theme.table?.glyphs?.na ?? options.strings?.notApplicable ?? chartString(options, 'cellNotApplicable'),
    nm: theme.table?.glyphs?.nm ?? 'n.m.',
  };
  const range = numberRange;
  const rows = data.categories.map((row) => ({ id: row.id, label: row.label ?? row.id }));
  const series = data.series;
  const columns = data.columns ?? [];
  const showTotal = options.total !== false;
  const totalLabel = options.strings?.total ?? 'Total';

  // ---- derive: stacks, sums, the Total row, the printed texts ----
  const incomplete = new Set<number>();
  // One segment: a missing value is a missing number, not a sum with a missing part.
  const single = series.length === 1;
  // The state every missing part of a row carries, when they agree; else the row prints the missing glyph.
  const blankState = (panel: BarTablePlainData['panels'][number], r: number): BarTableCellState | undefined => {
    const found = series.filter((s) => panel.values[s.id]?.[r] === null).map((s) => states.get(panel.values[s.id]!)?.[r]);
    return found.every((state) => state === found[0]) ? found[0] : undefined;
  };
  const panels = data.panels.map((panel) => {
    const stacks = rows.map((_, r) => accumulateStack(series.map((s) => panel.values[s.id]?.[r] ?? null)));
    const rowSums = stacks.map((stack, r) => {
      if (!stack.segments.some((segment) => segment === null)) return stack.total;
      if (!single) incomplete.add(r);
      return null;
    });
    const ends = panel.ends ?? [];
    // A range draws where it prints: on a row with every part.
    const ranges = rowSums.map((sum, r) => (sum === null ? undefined : ends[r] ?? undefined));
    const stackTotal = rowSums.every((sum) => sum !== null) ? rowSums.reduce<number>((sum, value) => sum + value!, 0) : null;
    // The Total adds what the rows print: a row without a range counts its sum at both ends.
    const sumOf = (end: 'low' | 'high') => rowSums.reduce<number>((sum, value, r) => sum + (ranges[r]?.[end] ?? value!), 0);
    const total: BarTablePanelDerived['total'] = panel.aggregate === 'none'
      ? undefined
      : stackTotal === null
        ? null
        : ranges.some(Boolean)
          ? { low: sumOf('low'), high: sumOf('high') }
          : stackTotal;
    const raster = [
      ...rowSums.flatMap((sum, r) => {
        const end = ranges[r];
        if (!end) return [sum];
        return [end.low, end.high];
      }),
      ...(total == null ? [] : typeof total === 'number' ? [total] : [total.low, total.high]),
    ];
    const { fmt, spec } = seriesRasterFormatter(panel.format ?? options.format, raster, locale, panel.unit, options.target);
    const endTexts = rowSums.map((sum, r) => {
      const end = ranges[r];
      return sum === null ? stateGlyph[blankState(panel, r) ?? 'none'] : end ? range(fmt(end.low), fmt(end.high)) : fmt(sum);
    });
    const totalText = total === undefined
      ? undefined
      : total === null ? glyph : typeof total === 'number' ? fmt(total) : range(fmt(total.low), fmt(total.high));
    const label = panel.label ?? panel.id;
    // One panel named as the subtitle's measure heads with its unit alone.
    const repeatsSubtitle = data.panels.length === 1 && panel.unit !== undefined &&
      label.trim().toLowerCase() === (resolveSubtitle(options.subtitle)?.measure ?? '').trim().toLowerCase();
    return {
      panel,
      stacks,
      rowSums,
      ranges,
      stackTotal,
      total,
      fmt,
      spec,
      endTexts,
      totalText,
      head: repeatsSubtitle ? panel.unit! : panel.unit ? `${label}, ${panel.unit}` : label,
      // A period panel (cascade, or a year alone) heads with a category value and keeps its case and face;
      // a unit alone keeps its case.
      fieldHead: !repeatsSubtitle && cascadeOptions === undefined && !isNumberAlone(label),
      unitHead: repeatsSubtitle,
      max: Math.max(0, maxOf(stacks.map((stack, r) => ranges[r]?.high ?? stack.positive))),
    };
  });
  const numberColumns = columns.map((column) => {
    const fmt = seriesRasterFormatter(column.format, column.values, locale, undefined, options.target).fmt;
    const summed = column.aggregate !== 'none';
    const missing = column.values.some((value) => value === null);
    if (summed && missing) column.values.forEach((value, r) => value === null && incomplete.add(r));
    const total = summed && !missing ? column.values.reduce<number>((sum, value) => sum + value!, 0) : null;
    return {
      column,
      texts: column.values.map((value, r) => (value === null ? stateGlyph[states.get(column.values)?.[r] ?? 'none'] : fmt(value))),
      total,
      totalText: !summed ? undefined : total === null ? glyph : fmt(total),
    };
  });
  // The page says why a sum is blank, not only the warning. The note names
  // the rows (and the panel when there are several); the missing parts are
  // named in the warning only.
  const blankEntries = panels.flatMap((entry) => entry.rowSums.flatMap((sum, r) => {
    // A stated row (n/a, n.m.) says what it is; only the rows printing the missing glyph need the note.
    if (sum !== null || blankState(entry.panel, r)) return [];
    const missing = series.filter((s) => (entry.panel.values[s.id]?.[r] ?? null) === null).map((s) => s.label ?? s.id);
    const where = panels.length > 1 ? `${rows[r]!.label} in ${entry.panel.label ?? entry.panel.id}` : rows[r]!.label;
    return [{ where, detail: `${where} (no ${missing.join(' or ')})` }];
  }));
  const blanks = blankEntries.map((entry) => entry.where);
  if (single && blanks.length > 0) warnings.push({ code: 'missing-value', severity: 'info', message: `missing value (null) in ${blanks.join(', ')}: prints ${glyph} at the end of that bar` });
  warnIncompleteComposition(
    warnings,
    [...incomplete].sort((a, b) => a - b).map((r) => rows[r]!.label),
    `a missing part prints ${glyph} at the end of that bar${showTotal ? ` and in the Total of its panel or column` : ''}${blankEntries.length > 0 ? `; missing: ${blankEntries.map((entry) => entry.detail).join(', ')}` : ''}`,
  );
  // ---- cascade: starts, shares, the bracket and the growth column ----
  // The note also checks the rows: each once, each a row of the table.
  const shareNotes = combinedShareNotes(options, rows, panels, locale, split.data.panels);
  let bracketRows: number[] | undefined;
  if (cascadeOptions && options.combinedShare) {
    // The bracket spans its rows, so they must stand together.
    bracketRows = options.combinedShare.rows.map((id) => rows.findIndex((row) => row.id === id)).sort((a, b) => a - b);
    if (bracketRows.some((r, i) => i > 0 && r !== bracketRows![i - 1]! + 1)) {
      throw new NormalizeError('bartable-combined-share-row', 'options.combinedShare.rows',
        'under cascade the combined share prints beside a bracket over its rows, and these rows do not stand together',
        'name rows that follow one another, such as the first five');
    }
  }
  const bracketLabel = bracketRows ? combinedLabel(options.combinedShare!.label, bracketRows.map((r) => rows[r]!.label), options) : undefined;
  // The compact combined row: the authored label, else "Top N combined" for rows from the top, else the joined names.
  const comboRowLabel = bracketRows && options.combinedShare!.label === undefined && bracketRows[0] === 0
    ? chartString(options, 'combinedRowLabel', { v1: bracketRows.length })
    : bracketLabel;
  const cascade = cascadeOptions
    ? deriveCascade(rows, data.panels.map((panel) => ({ id: panel.id, label: panel.label ?? panel.id, values: panel.values[series[0]!.id]!.map((value) => value!) })), {
      ...(bracketRows ? { combined: bracketRows } : {}),
      ...(cascadeOptions.growth ? { growth: cascadeOptions.growth } : {}),
      // Under cascade the shares add up to 100% unless the author asks for nearest.
      sumConsistent: (options.rounding ?? 'sum-consistent') === 'sum-consistent',
      ...(locale ? { locale } : {}),
      lift: (options as { [CASCADE_LIFT]?: CascadeLift })[CASCADE_LIFT] ?? 'full',
    })
    : undefined;
  if (cascade) pushAll(warnings, cascade.warnings);
  const showShare = cascadeOptions !== undefined && cascadeOptions.share !== false;
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  // Measured in the size the footer draws (footerType), so a wrapped note breaks where it prints.
  const noteFont: FontSpec = { family: theme.type.family, ...footerType(theme.type.footnote, options.target, textScaleOf(options)) };
  const noteW = Math.max(1, size.width - (margin.left ?? 0) - (margin.right ?? 0));
  // A panel prints its parts inside the bars when its format has at most one decimal: more digits
  // do not fit a part, so such a panel keeps its end labels alone. A row with a range prints no parts,
  // and one segment is the whole bar, which the end label prints already.
  const partsPrinted = panels.map((entry) => !cascade && series.length > 1 && options.segmentValues !== false && entry.spec.decimals <= PART_DECIMALS);
  // Rounded parts may miss the rounded row sum by one step.
  const partsMissTotal = panels.some((entry, p) => partsPrinted[p] && entry.rowSums.some((sum, r) => {
    if (sum === null || entry.ranges[r]) return false;
    const rounded = series.reduce((acc, s) => acc + roundedNumber(Math.max(0, entry.panel.values[s.id]?.[r] ?? 0), entry.spec), 0);
    return Math.abs(rounded - roundedNumber(sum, entry.spec)) > 1e-9 * Math.max(1, Math.abs(sum));
  }));
  const derivedNotes = [
    // Under cascade the bracket prints the combined share.
    ...(cascade ? [] : shareNotes),
    ...(partsMissTotal ? [quietMethodNote(chartString(options, 'partsMissTotal'))] : []),
    ...(blanks.length > 0 ? [disclosureNote(twoLineNote(chartString(options, single ? 'bartableMissingHeading' : 'bartableBlankHeading', { v1: glyph }), blanks, showTotal ? chartString(options, 'bartableBlankTotal') : '', noteFont, noteW, measure, options))] : []),
    ...((options as { [SLIVER_NOTE]?: string[] })[SLIVER_NOTE] ?? []),
    ...shareRoundingNotes(options, cascade?.adjustments ?? []),
  ];

  // ---- paints and the key ----
  const own = series.map((s): Paint | undefined =>
    s.fill ? { css: s.fill } : s.colorRole ? markRolePaint(s.colorRole, true) : undefined);
  const slots = rampSlots(theme, own, options.palette,
    series.length > 1 ? { labels: series.map((s) => s.label ?? s.id), warnings } : undefined);
  const paints = series.map((_, i) => own[i] ?? seriesPaint(slots[i]!, options.palette));
  // Row groups colour the bars by a row attribute; a residual row is neutral.
  const groups = data.rowGroups?.groups ?? [];
  const groupOwn = groups.map((g): Paint | undefined =>
    g.fill ? { css: g.fill } : g.colorRole ? markRolePaint(g.colorRole, true) : undefined);
  const groupSlots = groups.length > 0 ? rampSlots(theme, groupOwn, options.palette, groups.length > 1 ? { labels: groups.map((g) => g.label ?? g.id), warnings } : undefined) : [];
  const groupPaints = groups.map((_, i) => groupOwn[i] ?? seriesPaint(groupSlots[i]!, options.palette));
  const rowPaint = (r: number, s: number): Paint => {
    const row = data.categories[r]!;
    if (row.residual) return RESIDUAL_FILL;
    const g = row.group === undefined ? -1 : groups.findIndex((group) => group.id === row.group);
    return g >= 0 ? groupPaints[g]! : paints[s]!;
  };
  const ranged = panels.some((entry) => entry.ranges.some(Boolean));
  // Beside a key of group colours the Total bar decides again in each theme, so it never reads as one of them (or the rest rows' grey).
  const totalFill: Paint = groups.length > 0 && options.cascade?.totalApart !== false
    ? { ...markRolePaint('total', true), theme: { kind: 'total-apart', apartFrom: [...groupPaints, ...(data.categories.some((row) => row.residual) ? [RESIDUAL_FILL] : [])] } }
    : markRolePaint('total', true);
  // One segment and no range: the head names the measure and no key is due.
  // Two or more segments, or a range extension: nothing else names the
  // colours, so the key stays when the spec hides it.
  const legendOptions = series.length > 1 || ranged || groups.length > 0
    ? legendRequired(options.legend ?? 'top', warnings, 'bartable', theme, groups.length > 0 ? 'the row group colours are named nowhere else' : 'the segment colours and the range extension are named nowhere else')
    : normalizeLegendOption(options.legend);
  // Row groups key the groups under their title in place of the one segment.
  const legendItems: LegendItemInput[] = groups.length > 0
    ? [
      ...(data.rowGroups?.title ? [{ id: '__groups', label: data.rowGroups.title, paint: { token: 'ink' } as Paint, key: 'heading' as const }] : []),
      ...groups.map((g, i): LegendItemInput => ({ id: g.id, label: g.label ?? g.id, paint: groupPaints[i]!, key: 'box' })),
    ]
    : series.map((s, i) => ({ id: s.id, label: s.label ?? s.id, paint: paints[i]!, key: 'box' }));
  // The key swatch draws the range bars' hairline outline (legend-mark parity).
  // A grey rest row is no segment or group: the key names it when it names the colours.
  if ((series.length > 1 || ranged || groups.length > 0) && data.categories.some((row) => row.residual)) {
    legendItems.push({ id: RESIDUAL_KEY, label: chartString(options, 'residualKey'), paint: RESIDUAL_FILL, key: 'box' });
  }
  if (ranged) legendItems.push({ id: RANGE_KEY, label: options.strings?.range ?? 'Range, low to high', paint: RANGE_FILL, stroke: RANGE_STROKE, width: strokeToken(theme, 'hair'), key: 'box' });
  if (legendOptions?.order) {
    const rank = new Map(legendOptions.order.map((id, i) => [id, i]));
    // The heading is no id the author names: it stands just before the first group it heads.
    const headed = groups.flatMap((g) => rank.get(g.id) ?? []);
    if (headed.length > 0) rank.set('__groups', minOf(headed) - 0.5);
    legendItems.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  }

  // ---- frame ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frame = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      ...(derivedNotes.length > 0 ? { footnotes: [...authoredNotes(options), ...derivedNotes] } : {}),
      legend: legendOptions ? { options: legendOptions, items: legendItems } : undefined,
      theme,
      measure,
    },
    occupied,
  );
  const plot = frame.plot;

  // ---- tracks ----
  const cellFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const headFont: FontSpec = { ...cellFont, ...theme.type.axis };
  // Field heads (columns, measure panels, Share, the growth column) print in the table family's head face;
  // period heads are category values and keep the axis face and their case.
  const fieldFont = fieldHeadFont(theme);
  const fieldText = (text: string) => fieldHeadText(text, theme);
  const totalFont: FontSpec = { ...cellFont, weight: tableEmphasis(theme) };
  const width = (text: string, font: FontSpec) => measure(text, font).width;
  // A long row name wraps to a third line before it is cut; the label column stops at 30 % of the table width.
  // Compact mode stacks the panels and puts each row name above its bar.
  const compact = options.mode === 'compact';
  // Several panels in compact mode interleave: one row name, then one bar line per panel.
  const interleaved = compact && panels.length > 1;
  // A row name is never cut: past `lines` it takes more lines (the rows grow), and a word wider
  // than the band widens the band (the width floor grows, so a narrow canvas refuses with a size).
  const fitRows = (maxW: number, lines: number) => {
    // A name breaks at a space or after _ - / . (a campaign name has no spaces), so its pieces are the words here.
    const fit = (w: number, n: number) => rowLabelBand(rows, cellFont, w, n, lineBox(cellFont), measure, { target: options.target, typeRole: 'label', breakAfter: true });
    const cut = (band: ReturnType<typeof fit>) => band.labels.some((label) => label.title !== undefined);
    const pieces = (label: string) => label.split(/\s+/).flatMap(splitNameBreaks);
    let band = fit(maxW, lines);
    const most = Math.max(lines, maxOf(rows.map((row) => pieces(row.label).length)));
    for (let n = lines + 1; cut(band) && n <= most; n++) band = fit(maxW, n);
    if (cut(band)) band = fit(Math.max(maxW, maxOf(rows.flatMap((row) => pieces(row.label).map((word) => width(word, cellFont))))), most);
    return band;
  };
  let { labels: rowText, width: rowBandW } = compact ? { labels: [] as FittedText[], width: 0 } : fitRows(plot.w * 0.3, 3);
  const labelTrack = compact ? 0 : Math.max(rowBandW, showTotal ? width(totalLabel, totalFont) : 0) + LABEL_GAP;
  let x = plot.x + labelTrack;
  const numberTracks = numberColumns.map((entry, i) => {
    const name = entry.column.label ?? entry.column.id;
    const head = fieldText(name);
    // The first column's head may stand over the label column, whose head band is empty: the
    // column then keeps the width of its values, and widens only while the head would be cut.
    const overhang = i === 0 && !compact ? labelTrack : 0;
    let inner = Math.max(
      maxOf(entry.texts.map((text) => width(text, cellFont))),
      showTotal && entry.totalText !== undefined ? width(entry.totalText, totalFont) : 0,
      ...(overhang > 0 ? [] : head.split(/\s+/).map((word) => width(word, fieldFont))),
    );
    const headFitAt = (w: number) => fitText(head, fieldFont, w, 3, measure, { target: options.target, typeRole: 'axis' });
    while (overhang > 0 && headFitAt(inner + overhang).title !== undefined && inner < width(head, fieldFont)) inner += 4;
    const track = { ...entry, name, head, headFit: headFitAt(inner + overhang), right: x + CELL_AIR + inner };
    x += CELL_AIR + inner;
    return track;
  });
  const fixedW = x - plot.x;
  const weights = panels.map((entry) => entry.panel.weight ?? 1);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const endReserves = panels.map((entry) => maxOf(entry.endTexts.map((text) => width(text, cellFont))) + END_GAP);
  // The Total prints from the bar origin, under the bars, so it needs the
  // panel's width past the gap; a longer end reserve would only shorten the bars.
  const totalWidths = panels.map((entry) => (showTotal && entry.totalText !== undefined ? width(entry.totalText, totalFont) : 0));
  // Cascade: a share column after each track, then the bracket and its share; the growth column closes the table.
  const shareHead = fieldText(options.strings?.share ?? chartString(options, 'shareHeading'));
  const shareWs = panels.map((_, p) => (showShare ? Math.max(width(shareHead, fieldFont), maxOf(cascade!.panels[p]!.shareTexts.map((text) => width(text, cellFont)))) : 0));
  const bracketWs = panels.map((_, p) => {
    const combined = cascade?.panels[p]!.combined;
    return combined ? BRACKET_GAP + BRACKET_ARM + BRACKET_TEXT_GAP + width(combined.text, totalFont) : 0;
  });
  const growth = cascade?.growth;
  const growthHead = growth ? fieldText(growth.head) : '';
  // The growth head may stand over the last bracket, whose head band is empty, and in the
  // interleaved form over the share column: the column then keeps the width of its values.
  const growthOverhang = !compact ? bracketWs[panels.length - 1]! : 0;
  let growthInner = growth
    ? Math.max(maxOf(growth.texts.map((text, r) => width(text, r === rows.length ? totalFont : cellFont))), ...(interleaved || growthOverhang > 0 ? [] : growthHead.split(/\s+/).map((word) => width(word, fieldFont))))
    : 0;
  // The head takes up to three lines; the column widens until none is cut.
  const growthFit = (w: number) => fitText(growthHead, fieldFont, w, 3, measure, { target: options.target, typeRole: 'axis' });
  while (growth && !interleaved && growthFit(growthInner + growthOverhang).title !== undefined && growthInner < width(growthHead, fieldFont)) growthInner += 4;
  const growthW = growth ? PANEL_GAP + growthInner : 0;
  // Compact: the side columns sit at the right edge; the names wrap to two lines beside them.
  const sideW = compact ? fixedW + growthW : 0;
  if (compact) {
    numberTracks.forEach((track) => { track.right += plot.w - sideW; });
    ({ labels: rowText } = fitRows(Math.max(MIN_COMPACT_LABEL, plot.w - sideW - LABEL_GAP), 2));
  }
  // What a panel takes beside its bars: the gap, then the end labels, or the share column and the bracket.
  const extras = panels.map((_, p) => PANEL_GAP + (cascade ? (showShare ? SHARE_GAP + shareWs[p]! : 0) + bracketWs[p]! : endReserves[p]!));
  // The length a bar is scaled by: the panel total under cascade, else the longest bar.
  const spans = panels.map((entry) => (cascade ? cascade.panels[panels.indexOf(entry)]!.total : entry.max));
  const compactW = plot.w - (cascade ? sideW : 0);
  const restW = Math.max(0, plot.w - fixedW - growthW);
  const extrasSum = extras.reduce((sum, w) => sum + w, 0);
  const spanSum = spans.reduce((sum, v) => sum + v, 0);
  const sharedK = spanSum > 0 ? Math.max(0, restW - extrasSum) / spanSum : 0;
  const compactK = minOf(spans.map((span, p) => (span > 0 ? Math.max(0, compactW - extras[p]! + PANEL_GAP) / span : Infinity)));
  // Own scales: the weights share the bar runs (not the panel widths), so a 2:1 weight draws 2:1 bars.
  // A panel whose share falls under its floor (PREFERRED_RUN, or room for its Total) keeps the floor,
  // and the others share the rest by weight.
  const runFloors = panels.map((_, p) => Math.max(PREFERRED_RUN, totalWidths[p]! - endReserves[p]!));
  const ownRuns = (() => {
    const total = Math.max(0, restW - panels.reduce((sum, _entry, p) => sum + PANEL_GAP + endReserves[p]!, 0));
    const held = new Set<number>();
    let runs = panels.map(() => 0);
    for (let pass = 0; pass <= panels.length; pass++) {
      const free = total - [...held].reduce((sum, p) => sum + runFloors[p]!, 0);
      const freeWeight = weights.reduce((sum, weight, p) => (held.has(p) ? sum : sum + weight), 0);
      runs = panels.map((_entry, p) => (held.has(p) ? runFloors[p]! : freeWeight > 0 ? Math.max(0, free) * weights[p]! / freeWeight : 0));
      const low = panels.map((_entry, p) => p).filter((p) => !held.has(p) && runs[p]! < runFloors[p]! - 1e-9);
      if (low.length === 0 || held.size + low.length >= panels.length) break;
      low.forEach((p) => held.add(p));
    }
    return runs;
  })();
  const headingFloorRow = Math.max(BAR_H + 4, maxOf(rowText.map((text) => text.h + 2)));
  const headingLines = !compact && !heightOmitted(options.size) && plot.h < 3 * lineBox(headFont) + HEAD_GAP
    + (showTotal ? TOTAL_GAP : 0) + (rows.length + (showTotal ? 1 : 0)) * headingFloorRow ? 2 : 3;
  // Interleaved: every panel starts at the left edge. Under cascade the tracks keep clear of one share
  // column and the growth column; else each bar keeps room for its end label.
  const shareColW = showShare ? SHARE_GAP + Math.max(0, maxOf(shareWs)) : 0;
  // Interleaved cascade: each period is named at the end of its track in the first row, so the run leaves room for the longest name.
  // A name wider than a third of the plot is cut, so one long name cannot squeeze the tracks of every panel.
  const periodNameFull = interleaved && cascade ? maxOf(panels.map((entry) => width(entry.head, headFont))) : 0;
  const periodNameW = interleaved && cascade ? Math.min(periodNameFull, plot.w / 3) + END_GAP : 0;
  const interleavedRun = (p: number) => Math.max(0, cascade ? plot.w - growthW - shareColW - periodNameW : plot.w - endReserves[p]!);
  const interleavedK = minOf(spans.map((span, p) => (span > 0 ? interleavedRun(p) / span : Infinity)));
  const commonShareRight = plot.x + plot.w - growthW;
  // The key of the interleaved form names each panel beside a bar glyph; the heads on the right keep their room.
  const keyTextW = Math.max(1, plot.w - KEY_W - KEY_GAP - CELL_AIR - (cascade
    ? plot.x + plot.w - commonShareRight + (showShare ? width(shareHead, fieldFont) : 0)
    : sideW));
  const panelTracks = panels.map((entry, p) => {
    const face = entry.fieldHead || entry.unitHead ? fieldFont : headFont;
    const head = entry.fieldHead ? fieldText(entry.head) : entry.head;
    if (interleaved) {
      const scale = sharedScale ? (Number.isFinite(interleavedK) ? interleavedK : 0) : spans[p]! > 0 ? interleavedRun(p) / spans[p]! : 0;
      const headFit = cascade ? fitText(head, face, Math.max(1, periodNameW - END_GAP), 1, measure, { target: options.target, typeRole: 'axis' }) : fitText(head, face, keyTextW, 2, measure, { target: options.target, typeRole: 'axis' });
      return { ...entry, head, face, origin: plot.x, scale, trackW: spans[p]! * scale, shareRight: commonShareRight, headFit };
    }
    const w = compact ? compactW + PANEL_GAP : sharedScale ? extras[p]! + spans[p]! * sharedK : cascade ? (restW * weights[p]!) / weightSum : PANEL_GAP + endReserves[p]! + ownRuns[p]!;
    const origin = compact ? plot.x : x + PANEL_GAP;
    const run = Math.max(0, cascade ? w - extras[p]! : w - PANEL_GAP - endReserves[p]!);
    const scale = sharedScale ? (compact ? (Number.isFinite(compactK) ? compactK : 0) : sharedK) : spans[p]! > 0 ? run / spans[p]! : 0;
    const trackW = spans[p]! * scale;
    if (!compact) x += w;
    // Under cascade the head stands over the track, clear of the share head.
    // It may extend over the share column up to the Share head.
    const headW = cascade ? trackW + (showShare ? SHARE_GAP + shareWs[p]! - width(shareHead, fieldFont) - CELL_AIR : 0)
      : compact ? plot.w - sideW - (sideW > 0 ? CELL_AIR : 0) : w - PANEL_GAP;
    const headFit = fitText(head, face, Math.max(1, headW), headingLines, measure, { target: options.target, typeRole: 'axis' });
    if (entry.panel.unit && headFit.lines.length > 1 && headFit.lines.at(-1) === entry.panel.unit) {
      const before = headFit.lines[headFit.lines.length - 2]!.split(' ');
      const word = before.pop()!;
      const last = `${word} ${entry.panel.unit}`;
      if (width(last, face) <= headW) {
        headFit.lines.splice(-2, 2, ...(before.length ? [before.join(' ')] : []), last);
        headFit.w = Math.max(...headFit.lines.map((line) => width(line, face)));
        headFit.h = headFit.lines.length * lineBox(face);
      }
    }
    return { ...entry, head, face, origin, scale, trackW, shareRight: origin + trackW + SHARE_GAP + shareWs[p]!, headFit };
  });
  const growthTrack = growth
    ? { right: plot.x + plot.w, headFit: interleaved ? growthFit(Math.max(growthInner, plot.w * 0.4)) : growthFit(growthInner + growthOverhang) }
    : undefined;
  // Interleaved: a growth head wider than its column stands on the lines above the Share head.
  const growthLift = interleaved && growthTrack && showShare && growthTrack.headFit.w > growthInner ? lineBox(headFont) + 2 : 0;
  // One shared scale per panel stays; the bars it leaves as slivers
  // are listed under a line that states the scale, one row per line with its
  // value and the parts its bar cannot show.
  // Under cascade each row prints its value and its share, so a sliver loses nothing.
  if (!cascade && (options as { [SLIVER_NOTE]?: string[] })[SLIVER_NOTE] === undefined) {
    // `all`: every row the rules below list; `main`: only the bars shorter than SLIVER_PX, the short-bar rule.
    const notesFor = (rule: 'all' | 'main') => panelTracks.flatMap((track) => {
      const items = rows.flatMap((row, r) => {
        const drawn = track.ranges[r]?.high ?? track.stacks[r]!.positive;
        const range = track.ranges[r];
        const k = !range ? 1 : track.stacks[r]!.positive > 0 ? range.low / track.stacks[r]!.positive : 0;
        const values = series.flatMap((s) => {
          const v = track.panel.values[s.id]?.[r];
          return typeof v === 'number' && v !== 0 ? [{ s, v: v * k }] : [];
        });
        // A row is listed when its bar is a sliver, or when the seams hide one of its parts,
        // and the note then names the value of every part. A blank sum
        // prints no number at the bar end, so there a part too short to compare is named as well.
        const sliver = drawn * track.scale < SLIVER_PX;
        const thinPart = values.length > 1 && values.some(({ v }) => Math.abs(v) * track.scale < HIDDEN_PART_PX);
        const blankThin = track.rowSums[r] === null && values.some(({ v }) => Math.abs(v) * track.scale < SLIVER_PX);
        if (!(drawn > 0 && (sliver || (rule === 'all' && (thinPart || blankThin))))) return [];
        // A blank sum still has the parts it draws: they are named as such.
        const known = track.rowSums[r] === null ? chartString(options, 'sliverKnown', { v1: track.fmt(track.stacks[r]!.total) }) : '';
        const parts = values.map(({ s, v }) => `${s.label ?? s.id} ${track.fmt(v)}`);
        // The slivers come first, so a note cut to two lines names them before the rows with a thin part.
        return [{ first: sliver, text: `${row.label} ${track.endTexts[r]}${known}${parts.length > 1 ? ` (${parts.join(', ')})` : ''}` }];
      }).sort((a, b) => Number(b.first) - Number(a.first)).map((item) => item.text);
      // One note of at most two lines; the panel is named only when there are several.
      const scale = panelTracks.length > 1 ? ` ${track.panel.label ?? track.panel.id}` : '';
      return items.length === 0 ? [] : [twoLineNote(chartString(options, 'sliverNote', { v1: scale, v2: track.fmt(track.max) }), items, '', noteFont, noteW, measure, options)];
    });
    const sliverNotes = notesFor('all');
    if (sliverNotes.length > 0) {
      const listed = layoutBarTable(authored, { ...options, [SLIVER_NOTE]: sliverNotes } as BarTableOptions);
      // On a card narrower than the card class, several panels side by side that leave a bar too
      // short to read draw in the interleaved compact form, which gives each panel the whole width.
      // The full form reports the card-class width as its floor there, so the registry falls back to
      // compact. Only where that fallback applies (a host-given size, no authored mode, no
      // `belowMinimum: 'refuse'`, not a grid panel), so no width that draws refuses.
      if (panels.length > 1 && !compact && size.width < CARD_CLASS_WIDTH && options.size !== undefined && options.mode === undefined
        && options.belowMinimum !== 'refuse' && panelTypeClass(options) === undefined
        && !listed.refused && listed.sizing) {
        return { ...listed, sizing: { ...listed.sizing, minWidth: Math.max(listed.sizing.minWidth, CARD_CLASS_WIDTH) } };
      }
      // An authored height does not grow for a note the frame prints (a static footer grows only for
      // the notes left out of the frame). When the longer list does not fit it, the chart keeps
      // the short-bar list, so only short bars need names there.
      const shortBy = Math.max(listed.sizing?.minHeight ?? 0, listed.frame.minHeight ?? 0) - size.height;
      const fits = shortBy <= 0.5 && (listed.sizing?.minWidth ?? 0) <= size.width + 0.5;
      const authoredHeight = !heightOmitted(options.size) && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height !== false;
      // Each note takes at most two lines: a chart short by more than that refuses with the short-bar list too.
      const notesCanFit = shortBy <= sliverNotes.length * (2 * lineBox(noteFont) + 8);
      if (!authoredHeight || fits || !notesCanFit) return listed;
      const mainNotes = notesFor('main');
      if (mainNotes.length > 0) return layoutBarTable(authored, { ...options, [SLIVER_NOTE]: mainNotes } as BarTableOptions);
    }
  }

  // ---- rows ----
  const heads: FittedText[] = [...numberTracks, ...(interleaved ? [] : panelTracks), ...(growthTrack ? [growthTrack] : [])].map((track) => track.headFit);
  // Interleaved: the panel key stacks one line (or two) per panel.
  const keyH = interleaved && !cascade ? panelTracks.reduce((sum, track) => sum + track.headFit.h + 2, 0) - 2 : 0;
  const headH = Math.max(lineBox(headFont), keyH, maxOf(heads.map((head) => head.h)), (growthTrack?.headFit.h ?? 0) + growthLift);
  // Rows take their natural pitch; a canvas the author sized shorter
  // tightens them down to the bar and the label plus a little air.
  const house = fixedBarRow(theme, rowText.map((text) => text.h + 4));
  const naturalRowH = house?.step ?? Math.max(ROW_PITCH, maxOf(rowText.map((text) => text.h + 4)));
  let barH = house ? house.step * house.fraction : BAR_H;
  const floorRowH = Math.max(barH + 4, maxOf(rowText.map((text) => text.h + 2)));
  const rowCount = rows.length + (showTotal ? 1 : 0);
  const blockH = headH + HEAD_GAP + (showTotal ? TOTAL_GAP : 0);
  // Two heading lines set the floor; the third line uses spare height.
  const minimumBlockH = Math.max(lineBox(headFont), maxOf(numberTracks.map((track) => track.headFit.h)),
    maxOf(panelTracks.map((track) => Math.min(track.headFit.h, 2 * lineBox(headFont)))), (growthTrack?.headFit.h ?? 0) + growthLift)
    + HEAD_GAP + (showTotal ? TOTAL_GAP : 0);
  // Compact: a row is its name line(s) and a bar line; the Total likewise.
  // Each line keeps 2 px of air over the solver's label padding.
  // Interleaved: each bar line keeps just the value text's height; a later
  // panel of a non-cascade table draws a thin bar, so the first reads as the main measure.
  // The interleaved form without cascade boxes its one-line names and its end values at the glyph
  // height (line height 1), not the 1.2 line box. The text stays where the 1.2 box puts its baseline
  // relative to the box top, and two boxes still keep the solver's pad apart, so no value hides.
  const tight = interleaved && !cascade;
  const tightFont: FontSpec = { ...cellFont, lineHeight: 1 };
  const valueFont = tight ? tightFont : cellFont;
  const barLineH = Math.max(barH, measure('0', valueFont).height) + (interleaved ? 2 : 6);
  const panelBarH = (p: number) => (interleaved && !cascade && p > 0 ? THIN_BAR : barH);
  const totalLineH = Math.max(lineBox(totalFont), measure(totalLabel, totalFont).height) + 2;
  const nameBoxH = (r: number) => (tight && rowText[r]!.lines.length === 1 ? measure(rowText[r]!.lines[0]!, tightFont).height : rowText[r]!.h);
  const nameH = (r: number) => nameBoxH(r) + 2;
  // A running sum with the same additions in the same order; a push, not a copy of the array per row.
  const unitTops = [0];
  for (let r = 0; r < rows.length; r++) unitTops.push(unitTops[r]! + nameH(r) + (interleaved ? panels.length * barLineH + ROW_GAP : barLineH));
  // Interleaved cascade: the bracket becomes a combined row after its last row, its share per panel on its own line.
  const comboAfter = interleaved && cascade && bracketRows && bracketLabel !== undefined && cascade.panels.some((c) => c.combined) ? bracketRows.at(-1)! : -1;
  const periodTexts = panels.map((entry) => entry.panel.label ?? entry.panel.id);
  const periodW = Math.max(0, maxOf(periodTexts.map((text) => width(text, cellFont))));
  const comboShareW = Math.max(0, maxOf((cascade?.panels ?? []).map((c) => (c.combined ? width(c.combined.text, totalFont) : 0))));
  const comboFit = comboAfter >= 0
    ? fitText(comboRowLabel!, totalFont, Math.max(MIN_COMPACT_LABEL, commonShareRight - comboShareW - periodW - 2 * CELL_AIR - plot.x), 3, measure, { target: options.target, typeRole: 'label' })
    : undefined;
  const comboPitch = lineBox(cellFont) + 2;
  const combinedH = comboFit ? 2 * COMBINED_PAD + Math.max(comboFit.h, panels.length * comboPitch) + ROW_GAP : 0;
  const rowTopIn = (r: number) => unitTops[r]! + (comboAfter >= 0 && r > comboAfter ? combinedH : 0);
  const rowsSpan = unitTops[rows.length]! + combinedH;
  // A later block whose panel prints no Total (aggregate 'none') ends after its rows.
  const totalIn = (p: number) => showTotal && (compact && !interleaved
    ? panels[p]!.totalText !== undefined || (p === 0 && (numberColumns.some((column) => column.totalText !== undefined) || !!growth?.texts[rows.length]))
    : panels.some((panel) => panel.totalText !== undefined) || numberColumns.some((column) => column.totalText !== undefined) || !!growth?.texts[rows.length]);
  // Interleaved Total: its name line, then under cascade a dark bar per summed panel; else the totals print on the name line.
  const totalBars = panels.map((_entry, p) => p).filter((p) => cascade && panels[p]!.totalText !== undefined);
  const compactTotalH = interleaved ? totalLineH + totalBars.length * barLineH : totalLineH + barLineH;
  const compactBlockH = (p: number) => headH + HEAD_GAP + rowsSpan + (showTotal ? TOTAL_GAP : 0) + (totalIn(p) ? compactTotalH : 0);
  const compactRowsH = interleaved ? compactBlockH(0) : panels.reduce((sum, _entry, p) => sum + compactBlockH(p), 0) + (panels.length - 1) * BLOCK_GAP;
  // A pinned canvas with height to spare gives it to the rows, up to a quarter over the natural pitch,
  // and the bar thickens with them (14 px in a 28 px row, 20 px in a 35 px row). A theme row is fixed.
  const spareRowH = options.heightFill !== 'none' && fixedHeightCanvas(options) && !compact && !house ? Math.floor(Math.min(naturalRowH * MAX_ROW_GROWTH, (plot.h - blockH) / rowCount)) : 0;
  const rowH = compact ? barLineH : Math.max(floorRowH, Math.min(naturalRowH, (plot.h - blockH) / rowCount), spareRowH);
  if (rowH > naturalRowH) barH += Math.round((rowH - naturalRowH) * BAR_GROWTH);
  // Cascade bars fill the row, so a value reads inside them.
  // Full form: 20 px bars in a 28 px row, the Total bar 22 px; interleaved bars keep barH.
  const cellBarH = cascade ? (interleaved ? barH : Math.max(barH, rowH - (compact ? 6 : 8))) : barH;
  const totalBarH = cascade ? (interleaved ? barH : Math.max(barH, rowH - 6)) : barH;
  const tableTop = plot.y;
  const rowsTop = tableTop + headH + HEAD_GAP;
  const rowsBottom = rowsTop + rows.length * rowH;
  const totalTop = rowsBottom + TOTAL_GAP;
  const tableH = compact ? compactRowsH : blockH + rowCount * rowH;
  const chromeH = size.height - plot.h;
  const grow = rowDrivenHeight({ options, width: size.width, height: size.height, chromeH, rowsH: compact ? compactRowsH : blockH + rowCount * naturalRowH });
  if (grow !== undefined) return layoutBarTable(authored, { ...options, size: { width: size.width, height: grow } });

  const scene: SceneNode[] = [...frame.nodes];
  // Cascade tracks and their separators, drawn under everything else.
  const under: SceneNode[] = [];
  // Labels inside a bar keep the ink the solver picks against the fill.
  const contrastInk = new Set<Id>();
  const mutedInk = new Set<Id>();
  const marks: BarTableMarks = { segments: [], cells: [] };
  const requests: LabelRequest[] = [];
  const rightAligned = new Set<Id>();
  const fonts = new Map<Id, FontSpec>();
  const tableRight = plot.x + plot.w;
  const line = (id: Id, x1: number, y1: number, x2: number, y2: number, lineWidth: number, stroke: Paint, part: string) =>
    scene.push({ t: 'line', id, x1, y1, x2, y2, stroke, width: lineWidth, owner: {}, part });
  const label = (
    id: Id, kind: LabelRequest['kind'], owner: OwnerRef, text: string, font: FontSpec,
    rect: Rect, fitted?: FittedText,
  ) => {
    fonts.set(id, font);
    requests.push({
      id, kind, owner, text, font, typeRole: kind === 'axisTitle' ? 'axis' : 'label',
      ...(fitted ? fittedLabel(fitted, font) : { lines: [text] }),
      priority: PRIORITY.endpoint,
      candidates: [{ slot: `${id}:fixed`, rect, penalty: 0 }],
    });
  };
  /** A one-line text in a row band: left-aligned at `left`, or right-aligned at `right`. */
  const rowText1 = (text: string, font: FontSpec, top: number, at: { left: number } | { right: number }, bandH = rowH): Rect => {
    const box = measure(text, font);
    return { x: 'left' in at ? at.left : at.right - box.width, y: top + (bandH - box.height) / 2, w: box.width, h: box.height };
  };
  /**
   * Where panel p draws row r (r = rows.length is the Total): the top of its
   * name line, that line's height, and the top of its bar line. Outside the
   * compact form every panel shares one row band.
   */
  const blockTop = (p: number) => tableTop + (compact ? panels.slice(0, p).reduce((sum, _entry, q) => sum + compactBlockH(q) + BLOCK_GAP, 0) : 0);
  const rowsTopOf = (p: number) => blockTop(p) + headH + HEAD_GAP;
  const rowsBottomOf = (p: number) => (compact ? rowsTopOf(p) + rowsSpan : rowsBottom);
  const place = (p: number, r: number) => {
    if (interleaved) {
      if (r < rows.length) {
        const top = rowsTopOf(0) + rowTopIn(r);
        return { labelTop: top, labelH: tight ? nameBoxH(r) : lineBox(cellFont), barTop: top + nameH(r) + p * barLineH };
      }
      const top = rowsBottomOf(0) + TOTAL_GAP;
      return { labelTop: top, labelH: totalLineH, barTop: top + totalLineH + Math.max(0, totalBars.indexOf(p)) * barLineH };
    }
    if (!compact) {
      const top = r < rows.length ? rowsTop + r * rowH : totalTop;
      return { labelTop: top, labelH: rowH, barTop: top };
    }
    if (r < rows.length) {
      const top = rowsTopOf(p) + unitTops[r]!;
      return { labelTop: top, labelH: lineBox(cellFont), barTop: top + nameH(r) };
    }
    const top = rowsBottomOf(p) + TOTAL_GAP;
    return { labelTop: top, labelH: totalLineH, barTop: top + totalLineH };
  };
  /** A row name: one per row, and in the compact form one per block (the first keeps the plain id). */
  const nameId = (p: number, id: string) => (p === 0 ? id : `${id}:${panels[p]!.panel.id}`);
  const blocks = compact && !interleaved ? panels.map((_entry, p) => p) : [0];

  // Heads: bottom-aligned on the head band; numbers right, panels at the bar origin.
  const headBottom = tableTop + headH;
  numberTracks.forEach((track) => {
    const id = `head:${track.column.id}`;
    rightAligned.add(id);
    label(id, 'axisTitle', { colId: track.column.id }, track.head, fieldFont,
      { x: track.right - track.headFit.w, y: headBottom - track.headFit.h, w: track.headFit.w, h: track.headFit.h }, track.headFit);
  });
  panelTracks.forEach((track, p) => {
    if (interleaved) {
      // Under cascade the bars are one colour, so each period is named at its bar: right of its track in the first row.
      // Else the key: a bar glyph and the panel head, one entry per panel, in the order the bars stand.
      const top = cascade ? place(p, 0).barTop : tableTop + headH - keyH + panelTracks.slice(0, p).reduce((sum, other) => sum + other.headFit.h + 2, 0);
      if (cascade) {
        label(`head:${track.panel.id}`, 'axisTitle', { colId: track.panel.id }, track.head, track.face,
          { ...rowText1(track.headFit.lines[0] ?? track.head, track.face, top, { left: track.origin + track.trackW + END_GAP }), w: track.headFit.w }, track.headFit);
      } else {
        const h = Math.max(3, Math.round(panelBarH(p) * 0.7));
        scene.push({ t: 'rect', id: `panel-key:${track.panel.id}`, rect: { x: plot.x, y: top + lineBox(headFont) / 2 - h / 2, w: KEY_W, h }, fill: { token: 'inkMuted' }, owner: {}, part: 'panelKey' });
        label(`head:${track.panel.id}`, 'axisTitle', { colId: track.panel.id }, track.head, track.face,
          { x: plot.x + KEY_W + KEY_GAP, y: top, w: track.headFit.w, h: track.headFit.h }, track.headFit);
      }
      if (isNumberAlone(track.head)) requests[requests.length - 1]!.role = 'axis';
      if (p > 0 || !showShare) return;
      const id = `head:share:${track.panel.id}`;
      const box = measure(shareHead, fieldFont);
      rightAligned.add(id);
      label(id, 'axisTitle', { colId: `share:${track.panel.id}` }, shareHead, fieldFont, { x: track.shareRight - box.width, y: tableTop + headH - box.height, w: box.width, h: box.height });
      return;
    }
    const headBottom = blockTop(p) + headH;
    label(`head:${track.panel.id}`, 'axisTitle', { colId: track.panel.id }, track.head, track.face,
      { x: track.origin, y: headBottom - track.headFit.h, w: track.headFit.w, h: track.headFit.h }, track.headFit);
    // A period head ("2024") reads as an axis label, not as a caption.
    if (isNumberAlone(track.head)) requests[requests.length - 1]!.role = 'axis';
    if (!showShare) return;
    const id = `head:share:${track.panel.id}`;
    const box = measure(shareHead, fieldFont);
    rightAligned.add(id);
    label(id, 'axisTitle', { colId: `share:${track.panel.id}` }, shareHead, fieldFont, { x: track.shareRight - box.width, y: headBottom - box.height, w: box.width, h: box.height });
  });
  if (growthTrack) {
    rightAligned.add('head:growth');
    label('head:growth', 'axisTitle', { colId: 'growth' }, growthHead, fieldFont,
      { x: growthTrack.right - growthTrack.headFit.w, y: headBottom - growthLift - growthTrack.headFit.h, w: growthTrack.headFit.w, h: growthTrack.headFit.h }, growthTrack.headFit);
  }
  /**
   * A cascade value takes one rule in every row: it ends VALUE_PAD left of
   * its segment, on the free part of the track. Only a segment at the track
   * start holds its value inside, from the left. When the rule finds no room
   * the same fallbacks apply in every row: inside, right within the track,
   * left into the panel gap, last right past the track. A Total prints inside
   * its bar from the left.
   */
  const barValue = (id: Id, owner: OwnerRef, text: string, font: FontSpec, rect: Rect, fill: Paint, top: number, lo: number, hi: number, total = false) => {
    const box = measure(text, font);
    const y = top + (rowH - box.height) / 2;
    const candidates: LabelRequest['candidates'] = [];
    const pad = total ? TOTAL_PAD : VALUE_PAD;
    const fitsInside = box.width + 2 * pad <= rect.w;
    const inside = (penalty: number) => candidates.push({ slot: `${id}:inside`, rect: { x: rect.x + pad, y, w: box.width, h: box.height }, penalty, insideFill: paintColor(theme, fill), insidePaint: fill });
    const left = rect.x - VALUE_PAD - box.width;
    const right = rect.x + rect.w + VALUE_PAD;
    const at = (slot: string, x: number, penalty: number) => candidates.push({ slot: `${id}:${slot}`, rect: { x, y, w: box.width, h: box.height }, penalty });
    const atStart = rect.x <= lo + 0.5;
    if (total || atStart) {
      if (fitsInside) inside(0);
    } else {
      if (left >= lo) at('left', left, 0);
      if (fitsInside) inside(1);
    }
    if (right + box.width <= hi) at('right', right, 2);
    if (left < lo && left >= lo - PANEL_GAP + 4) at('leftGap', left, 3);
    at('rightOut', right, 4);
    candidates.splice(0, candidates.length, ...candidates.filter((candidate) => candidate.rect.x >= plot.x && candidate.rect.x + candidate.rect.w <= tableRight));
    fonts.set(id, font);
    contrastInk.add(id);
    requests.push({ id, kind: 'segment', owner, text, font, typeRole: 'label', lines: [text], priority: PRIORITY.endpoint, candidates });
  };
  const head = headRule(theme);
  blocks.forEach((p) => line(nameId(p, 'bartable-head-rule'), plot.x, rowsTopOf(p) - HEAD_GAP / 2, tableRight, rowsTopOf(p) - HEAD_GAP / 2, head.width, head.stroke, 'tableHeaderRule'));

  // The rows the combined-share note names stand on a light band (the bracket marks them under cascade).
  const shaded = new Set(!cascade && options.combinedShare ? options.combinedShare.rows : []);
  rows.forEach((row, r) => {
    if (!shaded.has(row.id)) return;
    const at = place(0, r);
    const air = interleaved ? ROW_GAP / 2 : 0;
    const top = at.labelTop - air;
    const bottom = compact ? (r + 1 < rows.length ? place(0, r + 1).labelTop : rowsBottomOf(0) + 2 * air) - air : at.labelTop + rowH;
    under.push({ t: 'rect', id: `combined-band:${row.id}`, rect: { x: plot.x, y: top, w: tableRight - plot.x, h: bottom - top }, fill: { token: 'others', tint: 0.5 }, owner: {}, part: 'combinedBand' });
  });
  rows.forEach((row, r) => {
    const text = rowText[r]!;
    blocks.forEach((p) => {
      const at = place(p, r);
      // Row rules separate the interleaved row blocks; the full form reads its rows without them.
      const ruleY = at.labelTop - (interleaved ? ROW_GAP / 2 : 0);
      if (r > 0 && !cascade && compact) line(nameId(p, `bartable-row-rule:${row.id}`), plot.x, ruleY, tableRight, ruleY, theme.table?.ruleWidths?.row ?? strokeToken(theme, 'hair'), tableRuleInk(), 'tableRowRule');
      label(nameId(p, `row:${row.id}`), 'category', { categoryId: row.id }, row.label, cellFont,
        { x: plot.x, y: compact ? at.labelTop : at.labelTop + (rowH - text.h) / 2, w: text.w, h: compact ? nameBoxH(r) : text.h }, text);
    });
    // Side columns use the first block's name line in compact mode.
    const side = place(0, r);
    numberTracks.forEach((track) => {
      const id = `cell:${track.column.id}:${row.id}`;
      const rect = rowText1(track.texts[r]!, valueFont, side.labelTop, { right: track.right }, side.labelH);
      rightAligned.add(id);
      label(id, 'point', { categoryId: row.id, colId: track.column.id }, track.texts[r]!, cellFont, rect);
      marks.cells.push({ rowId: row.id, colId: track.column.id, kind: 'column', value: track.column.values[r] ?? null, text: track.texts[r]!, rect });
    });
    panelTracks.forEach((track, p) => {
      const stack = track.stacks[r]!;
      const top = place(p, r).barTop;
      if (cascade) {
        const c = cascade.panels[p]!;
        const seriesId = series[0]!.id;
        const owner: OwnerRef = { categoryId: row.id, seriesId, colId: track.panel.id };
        const barY = top + (rowH - cellBarH) / 2;
        under.push({ t: 'rect', id: `track:${track.panel.id}:${row.id}`, rect: { x: track.origin, y: barY, w: track.trackW, h: cellBarH }, fill: TRACK_FILL, owner: {}, part: 'cascadeTrack' });
        const value = stack.total;
        const rect: Rect = { x: track.origin + c.starts[r]! * track.scale, y: barY, w: value * track.scale, h: cellBarH };
        const text = track.fmt(value);
        marks.segments.push({ rowId: row.id, panelId: track.panel.id, seriesId, value, text, rect });
        const fill = rowPaint(r, 0);
        if (rect.w > 0) {
          scene.push({ t: 'rect', id: `segment:${track.panel.id}:${row.id}:${seriesId}`, rect, fill, owner, part: 'segment', display: { value: text } });
          occupied.claim(rect, 'mark', owner, 'segment');
        }
        barValue(`end:${track.panel.id}:${row.id}`, owner, text, cellFont, rect, fill, top, track.origin, track.origin + track.trackW);
        marks.cells.push({ rowId: row.id, colId: track.panel.id, kind: 'end', value, text, rect });
        if (!showShare) return;
        const id = `cell:share:${track.panel.id}:${row.id}`;
        const shareRect = rowText1(c.shareTexts[r]!, cellFont, top, { right: track.shareRight });
        rightAligned.add(id);
        label(id, 'point', { categoryId: row.id, colId: `share:${track.panel.id}` }, c.shareTexts[r]!, cellFont, shareRect);
        marks.cells.push({ rowId: row.id, colId: `share:${track.panel.id}`, kind: 'share', value: c.shares[r]!, text: c.shareTexts[r]!, rect: shareRect });
        return;
      }
      const pBarH = panelBarH(p);
      const barY = top + (rowH - pBarH) / 2;
      const range = track.ranges[r];
      // A range bar: the segments keep their shares of their sum and together
      // reach the low end, so each draws and reads as its part of low, the
      // record at the precision the panel prints.
      const k = !range ? 1 : stack.positive > 0 ? range.low / stack.positive : 0;
      stack.segments.forEach((segment, s) => {
        if (!segment) return;
        const seriesId = series[s]!.id;
        const owner: OwnerRef = { categoryId: row.id, seriesId, colId: track.panel.id };
        const drawn = segment.value * k;
        const rect: Rect = { x: track.origin + segment.start * k * track.scale, y: barY, w: drawn * track.scale, h: pBarH };
        const text = track.fmt(drawn);
        const value = range ? roundedNumber(drawn, track.spec) : drawn;
        marks.segments.push({ rowId: row.id, panelId: track.panel.id, seriesId, value, text, rect });
        if (rect.w <= 0) return;
        scene.push({
          t: 'rect', id: `segment:${track.panel.id}:${row.id}:${seriesId}`, rect, fill: rowPaint(r, s), owner,
          part: 'segment', display: { value: text },
        });
        occupied.claim(rect, 'mark', owner, 'segment');
        if (!partsPrinted[p] || range) return;
        // The part's value inside it, in the ink that reads on its fill, where the text and its padding fit.
        const partFont = cellFont;
        const box = measure(text, partFont);
        if (box.width + 2 * PART_PAD > rect.w) return;
        const seat = box.height + 2 <= rect.h
          ? { x: rect.x + (rect.w - box.width) / 2, y: rect.y + (rect.h - box.height) / 2, w: box.width, h: box.height }
          : digitSeat(rect, text, box, measure.capHeight?.(partFont), partFont.size, Math.max(PART_AIR, digitSeatEdge(theme, undefined)));
        if (!seat) return;
        const partId = `part:${track.panel.id}:${row.id}:${seriesId}`;
        const fill = rowPaint(r, s);
        fonts.set(partId, partFont);
        contrastInk.add(partId);
        requests.push({
          id: partId, kind: 'segment', owner, text, font: partFont, typeRole: 'label', lines: [text], pad: 0, noLeader: true,
          priority: PRIORITY.interior,
          candidates: [{ slot: `${partId}:inside`, rect: seat, penalty: 0, pad: 0, insideFill: paintColor(theme, fill), insidePaint: fill }],
        });
      });
      const endText = track.endTexts[r]!;
      const owner: OwnerRef = { categoryId: row.id, colId: track.panel.id };
      if (range && range.high > range.low) {
        // Owned like the end label, so its hover and record read as the range.
        const rect: Rect = { x: track.origin + range.low * track.scale, y: barY, w: (range.high - range.low) * track.scale, h: pBarH };
        scene.push({
          t: 'rect', id: `range:${track.panel.id}:${row.id}`, rect, fill: RANGE_FILL, stroke: RANGE_STROKE,
          strokeWidth: strokeToken(theme, 'hair'), owner, part: 'rangeExtension', display: { value: endText },
        });
        occupied.claim(rect, 'mark', owner, 'rangeExtension');
      }
      const rect = rowText1(endText, valueFont, top, { left: track.origin + (range?.high ?? stack.positive) * track.scale + END_GAP });
      label(`end:${track.panel.id}:${row.id}`, 'total', owner, endText, cellFont, rect);
      const sum = track.rowSums[r] ?? null;
      marks.cells.push({ rowId: row.id, colId: track.panel.id, kind: 'end', value: range?.low ?? sum, ...(range ? { range } : {}), text: endText, rect });
    });
    if (growthTrack) {
      const id = `cell:growth:${row.id}`;
      const rect = rowText1(growth!.texts[r]!, cellFont, side.labelTop, { right: growthTrack.right }, side.labelH);
      rightAligned.add(id);
      label(id, 'point', { categoryId: row.id, colId: 'growth' }, growth!.texts[r]!, cellFont, rect);
      marks.cells.push({ rowId: row.id, colId: 'growth', kind: 'growth', value: growth!.values[r] ?? null, text: growth!.texts[r]!, rect });
    }
  });
  panelTracks.forEach((track, p) => {
    // Bars from zero need no baseline: each starts at its panel's left edge under the head.
    if (!cascade) return;
    // The track is one plain bar: the segments alone mark where each row starts.
    const c = cascade.panels[p]!;
    if (!c.combined || !bracketRows) return;
    if (interleaved) {
      // The combined row: between two dashed rules, its name in bold, then per panel the period and the share in bold.
      const top = rowsTopOf(0) + unitTops[comboAfter + 1]!;
      const ruleStroke: Paint = { token: 'inkMuted' };
      if (p === 0) {
        [top + 1, top + combinedH - ROW_GAP - 1].forEach((y, i) => scene.push({ t: 'line', id: `combined-rule:${i === 0 ? 'top' : 'bottom'}`, x1: plot.x, y1: y, x2: commonShareRight, y2: y, stroke: ruleStroke, width: strokeToken(theme, 'hair'), dash: dashToken(theme, 'dotted'), owner: {}, part: 'combinedRule' }));
        label('combined:label', 'category', {}, comboRowLabel!, totalFont, { x: plot.x, y: top + COMBINED_PAD, w: comboFit!.w, h: comboFit!.h }, comboFit);
      }
      const lineTop = top + COMBINED_PAD + p * comboPitch;
      const box = measure(c.combined.text, totalFont);
      const rect: Rect = { x: track.shareRight - box.width, y: lineTop + (lineBox(cellFont) - box.height) / 2, w: box.width, h: box.height };
      rightAligned.add(`combined:${track.panel.id}`);
      label(`combined:${track.panel.id}`, 'total', { colId: `share:${track.panel.id}` }, c.combined.text, totalFont, rect);
      marks.cells.push({ colId: `share:${track.panel.id}`, kind: 'share', combined: true, value: c.combined.value, text: c.combined.text, rect });
      const periodId = `combined:period:${track.panel.id}`;
      mutedInk.add(periodId);
      rightAligned.add(periodId);
      label(periodId, 'category', { colId: track.panel.id }, periodTexts[p]!, cellFont, rowText1(periodTexts[p]!, cellFont, lineTop, { right: rect.x - CELL_AIR }, lineBox(cellFont)));
      return;
    }
    // The bracket over the combined rows, beside the share column, with their share in bold.
    const inset = (rowH - cellBarH) / 2;
    const y1 = place(p, bracketRows[0]!).barTop + inset;
    const y2 = place(p, bracketRows[bracketRows.length - 1]!).barTop + rowH - inset;
    const x0 = (showShare ? track.shareRight : track.origin + track.trackW) + BRACKET_GAP;
    const x1 = x0 + BRACKET_ARM;
    const stroke: Paint = { token: 'axis' };
    line(`bracket:${track.panel.id}:top`, x0, y1, x1, y1, strokeToken(theme, 'rule'), stroke, 'bracket');
    line(`bracket:${track.panel.id}:side`, x1, y1, x1, y2, strokeToken(theme, 'rule'), stroke, 'bracket');
    line(`bracket:${track.panel.id}:bottom`, x0, y2, x1, y2, strokeToken(theme, 'rule'), stroke, 'bracket');
    const box = measure(c.combined.text, totalFont);
    const rect: Rect = { x: x1 + BRACKET_TEXT_GAP, y: (y1 + y2 - box.height) / 2, w: box.width, h: box.height };
    label(`combined:${track.panel.id}`, 'total', { colId: `share:${track.panel.id}` }, c.combined.text, totalFont, rect);
    marks.cells.push({ colId: `share:${track.panel.id}`, kind: 'share', combined: true, value: c.combined.value, text: c.combined.text, rect });
  });

  if (showTotal) {
    // The Total row sits on the table's total ground, between a rule above and a rule below.
    const rule = totalRule(theme);
    const ground = totalGround(theme, options.palette);
    blocks.forEach((p) => {
      const at = place(p, rows.length);
      if (totalIn(p)) {
        // A tall row (wrapped names) keeps its height; the ground and rules hug the Total's own line, centred in it.
        const bandH = compact ? compactTotalH : Math.min(rowH, Math.max(ROW_PITCH, totalLineH + 4, cascade ? totalBarH + 6 : 0));
        const bottom = at.labelTop + (compact ? compactTotalH : (rowH + bandH) / 2);
        const top = !compact && bandH < rowH ? bottom - bandH : rowsBottomOf(p) + TOTAL_GAP / 2;
        under.push({ t: 'rect', id: nameId(p, 'bartable-total-ground'), rect: { x: plot.x, y: top, w: tableRight - plot.x, h: bottom - top }, fill: ground, owner: {}, part: 'tableTotalGround' });
        line(nameId(p, 'bartable-total-rule'), plot.x, top, tableRight, top, rule.width, rule.stroke, 'tableTotalRule');
        line(nameId(p, 'bartable-total-rule-below'), plot.x, bottom, tableRight, bottom, rule.width, rule.stroke, 'tableTotalRule');
      }
      if (totalIn(p)) label(nameId(p, 'total:label'), 'category', {}, totalLabel, totalFont, rowText1(totalLabel, totalFont, at.labelTop, { left: plot.x }, at.labelH));
    });
    const side = place(0, rows.length);
    let totalX = plot.x + width(totalLabel, totalFont) + CELL_AIR;
    numberTracks.forEach((track) => {
      if (track.totalText === undefined) return;
      const id = `total:${track.column.id}`;
      const rect = rowText1(track.totalText, totalFont, side.labelTop, { right: track.right }, side.labelH);
      rightAligned.add(id);
      label(id, 'grandTotal', { colId: track.column.id }, track.totalText, totalFont, rect);
      marks.cells.push({ colId: track.column.id, kind: 'total', value: track.total, text: track.totalText, rect });
    });
    panelTracks.forEach((track, p) => {
      if (track.totalText === undefined) return;
      const totalTop = interleaved && !cascade ? place(p, rows.length).labelTop : place(p, rows.length).barTop;
      if (cascade) {
        // A full dark bar per panel, the total inside it.
        const bar: Rect = { x: track.origin, y: totalTop + (rowH - totalBarH) / 2, w: track.trackW, h: totalBarH };
        const fill = totalFill;
        const owner: OwnerRef = { colId: track.panel.id };
        scene.push({ t: 'rect', id: `total-bar:${track.panel.id}`, rect: bar, fill, owner, part: 'totalBar', display: { value: track.totalText } });
        barValue(`total:${track.panel.id}`, owner, track.totalText, totalFont, bar, fill, totalTop, track.origin, track.origin + track.trackW, true);
        marks.cells.push({ colId: track.panel.id, kind: 'total', value: track.stackTotal, text: track.totalText, rect: bar });
        return;
      }
      // Interleaved: the totals follow the Total name on its line.
      const rect = interleaved
        ? rowText1(track.totalText, totalFont, totalTop, { left: totalX }, totalLineH)
        : rowText1(track.totalText, totalFont, totalTop, { left: track.origin });
      if (interleaved) totalX += rect.w + CELL_AIR;
      label(`total:${track.panel.id}`, 'grandTotal', { colId: track.panel.id }, track.totalText, totalFont, rect);
      const range = typeof track.total === 'object' && track.total !== null ? track.total : undefined;
      marks.cells.push({ colId: track.panel.id, kind: 'total', value: range?.low ?? track.stackTotal, ...(range ? { range } : {}), text: track.totalText, rect });
    });
    if (growthTrack && growth!.texts[rows.length]) {
      const text = growth!.texts[rows.length]!;
      const rect = rowText1(text, totalFont, side.labelTop, { right: growthTrack.right }, side.labelH);
      rightAligned.add('total:growth');
      label('total:growth', 'grandTotal', { colId: 'growth' }, text, totalFont, rect);
      marks.cells.push({ colId: 'growth', kind: 'growth', value: growth!.values[rows.length] ?? null, text, rect });
    }
  }
  const behind = scene.splice(frame.nodes.length);
  pushAll(scene, under);
  pushAll(scene, behind);

  const solved = solveLabels(requests, occupied, labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 1,
  }));
  const ink: Paint = { token: 'ink' };
  // Heads print in the table family's head ink; the period names of the combined row read as captions: muted ink.
  const muted: Paint = { token: 'inkMuted' };
  const headPaint = headInk();
  for (const placed of solved.placed) if (!contrastInk.has(placed.id)) placed.ink = placed.id.startsWith('head:') ? headPaint : mutedInk.has(placed.id) ? muted : ink;
  const texts = labelsToNodes(theme, solved.placed, (placed) => fonts.get(placed.id) ?? cellFont, scene);
  // Number columns end on one edge: anchor their text there, so a face wider
  // than the measurement grows left, away from the neighbouring track.
  const rects = new Map(solved.placed.map((placed) => [`label:${placed.id}`, placed]));
  for (const node of texts) {
    const placed = rects.get(node.id);
    if (node.t !== 'text' || !placed || !rightAligned.has(placed.id)) continue;
    node.x = placed.rect.x + placed.rect.w;
    node.align = 'end';
  }
  pushAll(scene, texts);
  pushAll(warnings, solved.warnings);

  const segmentNames = series.map((s) => s.label ?? s.id).join(', ');
  // Each panel keeps MIN_RUN beside its end labels; weights share the spare width.
  // A cascade track keeps MIN_TRACK, its head's longest word and its Total
  // inside; on one shared scale the panel with the smallest total sets it.
  const minTracks = panels.map((entry, p) => (cascade
    ? Math.max(MIN_TRACK, ...entry.head.split(/\s+/).map((word) => width(word, headFont)), totalWidths[p]! + 2 * END_GAP)
    : Math.max(MIN_RUN, totalWidths[p]! - endReserves[p]!)));
  // On one shared scale a panel is as wide as its total: the smallest total sets the width, and the refusal names it.
  const tightest = sharedScale ? minTracks.reduce((best, min, p) => (spans[p]! > 0 && min / spans[p]! > minTracks[best]! / spans[best]! ? p : best), 0) : -1;
  const widest = spans.indexOf(maxOf(spans));
  const wideHint = (): string | undefined => tightest >= 0 && tightest !== widest && spans[tightest]! > 0
    ? `The '${panels[tightest]!.panel.label ?? panels[tightest]!.panel.id}' panel's total is ${formatAutomaticPercent((spans[tightest]! / spans[widest]!) * 100, spans[tightest]! / spans[widest]! < 0.1 ? 1 : 0, false, locale)} of the '${panels[widest]!.panel.label ?? panels[widest]!.panel.id}' panel's, and the panels share one scale, so its track needs ${Math.round(minTracks[tightest]!)}px. Set options.sharedScale to false to give each panel its own width.`
    : undefined;
  const panelsW = sharedScale
    ? extrasSum + maxOf(minTracks.map((min, p) => (spans[p]! > 0 ? min / spans[p]! : 0))) * spanSum
    : cascade
      ? Math.max(extrasSum + minTracks.reduce((sum, w) => sum + w, 0), maxOf(panels.map((_, p) => ((extras[p]! + minTracks[p]!) * weightSum) / weights[p]!)))
      // Several panels: each longest bar keeps PREFERRED_RUN, or the table goes compact.
      : panels.reduce((sum, _entry, p) => sum + PANEL_GAP + Math.max((panels.length > 1 ? PREFERRED_RUN : MIN_RUN) + endReserves[p]!, totalWidths[p]!), 0);
  // Compact: each block is one panel across the width (beside the side
  // columns under cascade), and the first name line holds a short name beside the side columns.
  const kMin = Math.max(0, maxOf(minTracks.map((min, p) => (spans[p]! > 0 ? min / spans[p]! : 0))));
  const compactPanelsW = maxOf(panels.map((_, p) => extras[p]! - PANEL_GAP + (sharedScale ? spans[p]! * kMin : minTracks[p]!)));
  // Interleaved: the widest bar keeps its floor beside the share and growth columns, or beside its end label.
  // Under cascade the period name takes min(longest name, a third of the plot) beside the tracks: a plot of width w holds the tracks
  // when w - min(name, w / 3) >= the rest, so w = min(rest + name, 1.5 * rest).
  const cascadeRest = growthW + shareColW + END_GAP + (sharedScale ? kMin * maxOf(spans) : maxOf(minTracks));
  const interleavedPanelsW = cascade
    ? Math.min(cascadeRest + periodNameFull, 1.5 * cascadeRest)
    : maxOf(panels.map((_, p) => MIN_RUN + endReserves[p]!));
  const minWidth = size.width - plot.w + (interleaved
    ? Math.max(interleavedPanelsW, sideW + LABEL_GAP + MIN_COMPACT_LABEL)
    : compact
    ? Math.max(compactPanelsW + (cascade ? sideW : 0), sideW + LABEL_GAP + MIN_COMPACT_LABEL)
    : fixedW + growthW + panelsW);

  // Only a refusal carries the hint; a table that fits keeps its sizing unchanged.
  const sizeHint = minWidth > size.width ? wideHint() : undefined;
  return {
    type: 'bartable',
    size,
    sizing: rowSizing('bartable', size, { chromeH, minimumRowsH: compact ? compactRowsH : minimumBlockH + rowCount * floorRowH, naturalRowsH: compact ? compactRowsH : blockH + rowCount * naturalRowH, minWidth, ...(sizeHint ? { hint: sizeHint } : {}) }),
    plot: { x: plot.x, y: tableTop, w: plot.w, h: tableH },
    scene: withSegmentSeams(scene, theme),
    labels: solved.placed,
    axes: [],
    annotations: [],
    ...(frame.legend ? { legend: frame.legend } : {}),
    frame: frame.frame,
    marks,
    derived: {
      panels: panels.map((entry) => ({ id: entry.panel.id, rowSums: entry.rowSums, ...(entry.total === undefined ? {} : { total: entry.total }) })),
      columns: numberColumns.filter((entry) => entry.column.aggregate !== 'none').map((entry) => ({ id: entry.column.id, total: entry.total })),
      // The row order as drawn (residual rows pinned last), for the records.
      rowOrder: rows.map((row) => row.id),
      ...(cascade ? {
        ...(bracketLabel ? { combinedLabel: bracketLabel } : {}),
        cascade: cascade.panels.map((c, p) => ({ id: panels[p]!.panel.id, starts: c.starts, shares: c.shares, ...(c.combined ? { combined: c.combined.value } : {}) })),
        ...(cascade.growth ? { growth: cascade.growth.values } : {}),
        ...(cascade.adjustments.length > 0 ? { roundingAdjustments: cascade.adjustments } : {}),
      } : {}),
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'bartableTitle', { v1: rows.length })),
      counts: [structureCount('rows', rows.length, undefined, options), structureCount('panels', panels.length, panels.length === 1 ? chartString(options, 'barPanelOne') : chartString(options, 'barPanels', { v1: panels.length }))],
      desc: chartString(options, 'bartableDescStart', { v1: rows.length, v2: columns.length ? chartString(options, 'tableColumnsClause', { v1: numberTracks.map((track) => track.name).join(', ') }) : '' }) +
        `${panels.length === 1 ? chartString(options, 'barPanelOne') : chartString(options, 'barPanels', { v1: panels.length })}, ${panels.map((entry) => entry.head).join('; ')}, ${sharedScale ? chartString(options, 'sharedScale') : chartString(options, 'ownScale')}. ` +
        `${cascade ? chartString(options, 'cascadeDesc', { v1: showShare ? chartString(options, 'shareColumnClause') : '', v2: bracketRows ? chartString(options, 'combinedShareBracket', { v1: bracketLabel }) : '', v3: growth ? chartString(options, 'lastColumnClause', { v1: growth.head }) : '' }) : ''}` +
        chartString(options, 'segmentsSentence', { v1: segmentNames, v2: cascade ? chartString(options, 'cascadeValueLabels') : chartString(options, 'barEndTotalRange') + (solved.placed.some((placed) => placed.id.startsWith('part:')) ? chartString(options, 'barPartValues') : '') }) +
        `${ranged ? chartString(options, 'rangeBarDesc') : ''}` +
        `${showTotal ? chartString(options, 'tableTotalRow', { v1: totalLabel }) : ''}`,
    },
    warnings,
    debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
}
