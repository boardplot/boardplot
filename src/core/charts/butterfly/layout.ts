import { chartString } from '../../strings/butterfly';
import { chartString as commonString } from '../../strings';
import { layoutValueAxis } from '../../axis';
import { restDetailsWarning, restLabel, restSum, topNCut } from '../topN';
import { structureCount } from '../../structureCounts';
/**
 * Butterfly / tornado (alias 'tornado') — two mirrored
 * horizontal panes around a shared center category column. Series `a` bars
 * grow right-to-left in the left pane, series `b` left-to-right in the right
 * pane; centered category labels live in the center column. No value axis —
 * direct labels at bar ends, series headers above each pane.
 */

import { fitText, lineBox } from '../../label/fitText';
import { fitColumn, fittedLabel, GUTTER_MAX_SHARE, stepDownFont } from '../../label/rowFit';
import type { AnchorResolution } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { marginBracketLayout } from '../../annotateLinks';
import { memoFormatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { clamp, deltaGap, type Rect } from '../../geometry';
import { createOccupiedIndex } from '../../label/occupied';
import { labelsToNodes } from '../../label/emit';
import { isOthersFill, othersSeparation } from '../../markVisibility';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SlotCandidate,
  type SolveCtx,
} from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  normalizeCategory,
  normalizeScenario,
  normalizeSeriesValues,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { bandScale, linearScale, niceDomain } from '../../scale';
import { rowDrivenHeight } from '../../rowCanvas';
import { rowSizing } from '../../sizing';
import { unitConflict, unitConflictRefusal } from '../../schema/units';
import { MARK_CONTRAST_FLOOR } from '../../themeRules';
import { authoredFootnoteCount, authoredNotes, frameTextOptions, normalizeLegendOption, solveFrame, fixedPlotChrome, type LegendItemInput } from '../../frame';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import {
  canvasMargin,
  markRolePaint,
  paintColor,
  panelTypeClass,
  resolveSemanticPaletteTheme,
  resolveTheme,
  semanticPalettePaint,
  themeForWidth,
  emphasisWeight,
  strokeToken,
  seriesPaint as themeSeriesPaint,
  labelsOffKeepsNames,
  secondaryFont,
} from '../../theme';
import type { AnchorRef } from '../../types/annotations';
import { cellMeta, cellValue, type CellMeta, type Id, type Scenario } from '../../types/cell';
import { warnMissingValue } from '../../dataGaps';
import type { ChartData, Series } from '../../types/data';
import type { ButterflyOptions, LegendOptions, RenderTarget } from '../../types/options';
import type {
  Geometry,
  LintWarning,
  Paint,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import { footnoteSuffix } from '../../footnoteMark';
import { textScaleOf } from '../../typeFloors';
import { DEFAULT_TARGET, TARGET_SIZE, targetFloorsPx, type TargetSizeOptions } from '../../target';
import { seriesTextPaint } from '../../theme';
import { defaultAnnotationId } from '../../types/annotations';
import { disclosureNote } from '../../notes';
import { maxOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface ButterflyMarks {
  /** Series-a bars (left pane), keyed by categoryId, top-to-bottom order. */
  left: { id: Id; rect: Rect; nodeId: Id }[];
  /** Series-b bars (right pane). */
  right: { id: Id; rect: Rect; nodeId: Id }[];
  /** The shared center category column. */
  center: Rect;
}

export interface ButterflyDerived {
  /** Per-category difference b − a (signed, pre-clamp values). */
  diffs: Record<Id, number>;
}

interface Row {
  id: Id;
  label: string;
  /** The footnote reference mark, drawn after the name and never cut with it. */
  mark: string;
  date?: string;
  a: number | null;
  b: number | null;
  aMeta: CellMeta | null;
  bMeta: CellMeta | null;
  rest: boolean;
}

function barPaint(rest: boolean, meta: CellMeta | null, basePaint: Paint): Paint {
  return rest
    ? { token: 'othersMark' }
    : meta?.fill
      ? { css: meta.fill }
      : basePaint;
}

/** Space between a pane's value labels and a comparison bracket's ticks. */
const BRACKET_CLEAR = 8;
/** A pane whose longest bar is under this share of the other's reads as slivers. */
const SLIVER_SIDE_SHARE = 0.05;
/** The thickest bar a row draws; the gaps between rows take the rest of the height. */
const MAX_BAR_H = 48;
/** A butterfly row's natural pitch at its content height, as a gantt or status row. */
const ROW_PITCH = 40;

export function layoutButterfly(
  data: ChartData,
  options?: ButterflyOptions,
  comparison?: {
    periods?: Record<Id, Pick<AnchorResolution, 'date' | 'label'>>;
    differenceFormat?: string;
    /** Width kept free at each outer edge for the comparison brackets; set by the second pass. */
    bracketRoom?: { left: number; right: number };
    /** False for a caller that is not a row type (the pyramid): it keeps its canvas. */
    rowDriven?: boolean;
    /**
     * Opens the butterfly's pane-fitted scale, inner pane heads and 4 px value
     * gap for a caller that keeps its canvas (the pyramid), with cards that
     * put values inside the bar end and a lane as narrow as its names. The
     * row pitch, row type and pane-coloured heads stay the butterfly's own.
     */
    paneFit?: boolean;
    /** Set where the rows do not fit under the value axes of panes on their own scales: they go, the rows stay. */
    noAxis?: boolean;
  },
): Geometry<ButterflyMarks, ButterflyDerived> {
  const opts = options ?? ({} as ButterflyOptions);
  const warnings: LintWarning[] = [];
  const theme = resolveSemanticPaletteTheme(
    themeForWidth(resolveTheme(opts.theme), panelTypeClass(opts) ?? resolveSize(opts.size).width),
    opts.palette,
    warnings,
  );
  const size = resolveSize(opts.size);
  const byExample = memoFormatterFromExample(opts.locale?.language);
  const measure = opts.measure ?? defaultMeasurer;
  const highlights = new Set(resolveHighlight(opts.highlight));
  const sortBy = opts.sortBy ?? 'sheet';
  const sharedScale = opts.sharedScale ?? true;
  // The butterfly's own rows draw a negative value toward the names from the pane's zero line;
  // `negatives: 'magnitude'` and the pyramid keep the bar length of |value|, a lighter bar and a sign.
  const directed = comparison?.rowDriven !== false && opts.negatives !== 'magnitude';

  // ---- normalize ----
  if (!data || !Array.isArray(data.categories) || !Array.isArray(data.series)) {
    throw new NormalizeError('empty-data', 'data', 'butterfly requires categories and series');
  }
  if (data.series.length === 0 || data.categories.length === 0) {
    throw new NormalizeError('empty-data', data.series.length === 0 ? 'series' : 'categories', 'butterfly requires at least one category and two series');
  }
  if (data.series.length < 2) {
    throw new NormalizeError('too-few-series', 'series', 'butterfly requires at least two series');
  }
  if (!opts.a || !opts.b) {
    throw new NormalizeError('missing-option', 'options.a', "butterfly requires options 'a' and 'b' naming the two mirrored series");
  }
  if (opts.a === opts.b) {
    throw new NormalizeError('invalid-option', 'options.b', "'a' and 'b' must name different series");
  }
  const categories = data.categories.map((c, i) => normalizeCategory(c as never, i));
  const findSeries = (id: Id, key: 'a' | 'b'): Series => {
    const s = data.series.find((x) => x.id === id);
    if (!s) {
      throw new NormalizeError(
        'unknown-series', `options.${key}`,
        `series '${id}' not found`, data.series.map((x) => x.id).join(', '),
      );
    }
    return s;
  };
  const sA = findSeries(opts.a, 'a');
  const sB = findSeries(opts.b, 'b');
  const aLabel = sA.label ?? sA.id;
  const bLabel = sB.label ?? sB.id;
  // One scale carries one unit, and a difference across two
  // units means nothing. Both are refused with the path and the fix.
  const conflict = unitConflict([sA, sB], opts.unit);
  const unitFix = [
    ...(sharedScale ? [{ op: 'replace' as const, path: '/options/sharedScale', value: false }] : []),
    ...(sortBy === 'diff' || sortBy === 'sum' ? [{ op: 'replace' as const, path: '/options/sortBy', value: 'sheet' }] : []),
  ];
  const unitSuggest = `set ${sharedScale ? 'sharedScale: false' : ''}${sharedScale && (sortBy === 'diff' || sortBy === 'sum') ? ' and ' : ''}${sortBy === 'diff' || sortBy === 'sum' ? "sortBy: 'sheet'" : ''} so each pane keeps its own unit`;
  if (conflict && sharedScale) {
    const refused = conflict.index === 0 ? sA : sB;
    warnings.push({
      ...unitConflictRefusal(conflict, refused.id, data.series.indexOf(refused), 'the shared scale',
        unitSuggest, opts.unit),
      fix: unitFix,
    });
  }
  // A sum adds unlike units as a difference subtracts them.
  if (conflict && (sortBy === 'diff' || sortBy === 'sum')) {
    warnings.push({
      code: 'unit-conflict',
      severity: 'error',
      message: sortBy === 'diff'
        ? `sortBy 'diff' subtracts ${aLabel} from ${bLabel}, but they are declared in ${conflict.against} and ${conflict.unit}; a difference across two units means nothing`
        : `sortBy 'sum' adds ${aLabel} and ${bLabel}, but they are declared in ${conflict.against} and ${conflict.unit}; a sum across two units means nothing`,
      suggest: unitSuggest,
      field: ['options', 'sortBy'],
      fix: unitFix,
    });
  }
  const aCells = normalizeSeriesValues(sA, categories, data.series.indexOf(sA));
  const bCells = normalizeSeriesValues(sB, categories, data.series.indexOf(sB));

  // One precision per pane ("6.0" beside "7.9"), through the shared
  // raster: engine scale from 1e6, the nonzero lift, the unit rule,
  // and a pane's own format or unit.
  const paneRaster = (cells: typeof aCells) =>
    seriesRasterFormatter(opts.format, cells.map(cellValue), opts.locale?.language, opts.unit, opts.target);
  const rasterA = paneRaster(aCells);
  const rasterB = paneRaster(bCells);
  const fmtA = rasterA.forSeries(sA);
  const fmtB = rasterB.forSeries(sB);

  let rows: Row[] = categories.map((c, i) => ({
    id: c.id,
    label: c.label ?? c.id,
    mark: footnoteSuffix(c.footnote, c.id, { count: authoredFootnoteCount(opts), warnings }),
    date: c.date,
    a: cellValue(aCells[i]!),
    b: cellValue(bCells[i]!),
    aMeta: cellMeta(aCells[i]!),
    bMeta: cellMeta(bCells[i]!),
    rest: false,
  }));
  for (const row of rows) {
    for (const [side, series] of [['a', sA], ['b', sB]] as const) {
      if (row[side] === null) warnMissingValue(warnings, `series '${series.id}' at '${row.id}'`, { seriesId: series.id, categoryId: row.id });
    }
  }

  // ---- derive: sort key, topN, order ----
  const key = (r: Row): number => {
    const a = r.a ?? 0;
    const b = r.b ?? 0;
    switch (sortBy) {
      case 'a': return a;
      case 'b': return b;
      case 'diff': return b - a;
      case 'sum':
      default: return a + b;
    }
  };
  const originalIndex = new Map(rows.map((row, index) => [row.id, index]));

  if (opts.topN && rows.length > opts.topN.n) {
    const cut = topNCut(rows.map(key), opts.topN.n);
    const dropped = cut.dropped.map((i) => rows[i]!);
    rows = cut.kept.map((i) => rows[i]!);
    if (opts.topN.rest !== false && dropped.length > 0) {
      rows.push({
        id: '__rest',
        label: restLabel(opts.topN, opts.strings, dropped.length),
        a: restSum(dropped.map((r) => r.a)),
        b: restSum(dropped.map((r) => r.b)),
        aMeta: null,
        bMeta: null,
        mark: '',
      rest: true,
      });
      const lostDetails = restDetailsWarning({ categories, series: [sA, sB] }, new Set(rows.map((r) => r.id)));
      if (lostDetails) warnings.push(lostDetails);
    }
  }

  if (sortBy !== 'sheet') {
    // desc by chosen key; rest row pinned last; stable ties by sheet order
    rows = [...rows].sort((x, y) => {
      if (x.rest !== y.rest) return x.rest ? 1 : -1;
      return key(y) - key(x) || originalIndex.get(x.id)! - originalIndex.get(y.id)!;
    });
  }

  if (rows.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'butterfly requires at least one category');
  }

  const diffs: ButterflyDerived['diffs'] = emptyIdRecord();
  for (const r of rows) diffs[r.id] = (r.b ?? 0) - (r.a ?? 0);

  // negatives are not meaningful on mirrored panes: clamp display to abs,
  // keep the sign in the label
  const hasNegative = rows.some((r) => (r.a ?? 0) < 0 || (r.b ?? 0) < 0);
  if (hasNegative && !directed) {
    warnings.push({
      code: 'butterfly-negative',
      severity: 'warn',
      message: 'negative values are not meaningful on mirrored panes — bar lengths use |value|, the sign stays in the label',
      suggest: 'use a variance or bar chart for signed data',
    });
  }
  // On one scale, a side whose longest bar is a sliver of the other's
  // cannot be read; the fix is the per-pane scale.
  const sideMax = (side: 'a' | 'b') => Math.max(0, maxOf(rows.map((r) => Math.abs((side === 'a' ? r.a : r.b) ?? 0))));
  if (sharedScale && Math.min(sideMax('a'), sideMax('b')) > 0 &&
    Math.min(sideMax('a'), sideMax('b')) < SLIVER_SIDE_SHARE * Math.max(sideMax('a'), sideMax('b'))) {
    const small = sideMax('a') < sideMax('b') ? aLabel : bLabel;
    warnings.push({
      code: 'butterfly-side-slivers',
      severity: 'info',
      message: `on the shared scale every ${small} bar is under ${SLIVER_SIDE_SHARE * 100}% of the other pane's longest, so its bars are slivers whose lengths cannot be compared`,
      suggest: 'set sharedScale: false to give each pane its own scale',
    });
  }
  if (!sharedScale) {
    warnings.push({
      code: 'scale-mix',
      severity: 'info',
      message: `panes use independent scales (${aLabel} vs ${bLabel}) — bar lengths are not comparable across the center column`,
      suggest: 'sharedScale: true for comparable panes',
    });
  }

  // ---- fonts ----
  // The butterfly's own rows under a render target (the pyramid keeps
  // its own): one-line names in a tight gutter, row text one pixel under
  // the theme's label size and never under the target floor, bars scaled to
  // the pane, and the delta after a wide gap.
  const redesign = comparison?.rowDriven !== false;
  const signed = directed && hasNegative;
  const paneFit = redesign || comparison?.paneFit === true;
  // A paneFit card (the pyramid below 480 px) puts values inside the bar end.
  const insideCard = !redesign && paneFit && resolveSize(opts.size).width < 480;
  const floors = redesign ? targetFloorsPx(opts.target ?? DEFAULT_TARGET, textScaleOf(opts)) : undefined;
  const rowType = (font: FontSpec, role: 'label' | 'axis'): FontSpec =>
    floors && font.size - 1 >= floors[role] ? { ...font, size: font.size - 1 } : font;
  const labelFont: FontSpec = rowType({ family: theme.type.family, ...theme.type.label }, 'label');
  const strongFont: FontSpec = { ...labelFont, weight: emphasisWeight(theme) };
  const tickFont: FontSpec = rowType({ family: theme.type.family, ...theme.type.axis }, 'axis');
  const tickBold: FontSpec = { ...tickFont, weight: emphasisWeight(theme) };

  // ---- paints ----
  const paintOf = (s: Series, fallback: () => Paint): Paint => {
    if (highlights.has(s.id)) return semanticPalettePaint(theme, opts.palette, 'focus');
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return markRolePaint(s.colorRole, true);
    const scen = normalizeScenario(s.scenario, `series[${s.id}].scenario`);
    if (scen === 'PY') return semanticPalettePaint(theme, opts.palette, 'neutralLight');
    return fallback();
  };
  // The first side is a mark in the neutral: it takes the neutral mark role.
  const paintA = paintOf(sA, () => semanticPalettePaint(theme, opts.palette, 'neutralMark'));
  // The second side leads in series 1; the accent waits for an authored
  // highlight. A palette keeps its second rank, apart
  // from the first side's first rank.
  const paintB = paintOf(sB, () => opts.palette !== undefined && theme.color.palettes?.[opts.palette] !== undefined
    ? semanticPalettePaint(theme, opts.palette, 'focus')
    : themeSeriesPaint(0));
  const patternOf = (scen?: Scenario): 'hatch45' | 'outline' | undefined =>
    scen === 'FC' ? 'hatch45' : scen === 'PL' ? 'outline' : undefined;
  const scenA = normalizeScenario(sA.scenario, `series[${sA.id}].scenario`);
  const scenB = normalizeScenario(sB.scenario, `series[${sB.id}].scenario`);

  const labelsOff = (kind: string): boolean => {
    // labels: false hides values while row and pane names stay outside a grid.
    if (opts.labels === false) return !((kind === 'category' || kind === 'series') && labelsOffKeepsNames(opts));
    const v = opts.labels?.[kind as never];
    return v === false;
  };

  // ---- frame ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...opts.margin };
  const valuesOff = labelsOff('point');
  const legendOpts: LegendOptions | undefined = normalizeLegendOption(
    comparison?.rowDriven !== false && valuesOff && labelsOff('series') && opts.legend === undefined
      ? 'top' : opts.legend,
  );
  const legendItems: LegendItemInput[] = [
    { id: sA.id, label: aLabel, paint: paintA, pattern: patternOf(scenA) },
    { id: sB.id, label: bLabel, paint: paintB, pattern: patternOf(scenB) },
  ];
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(opts),
      footnotes: [...authoredNotes(opts), ...scaleNotes(!sharedScale, hasNegative && !directed, opts).map(disclosureNote)],
      legend: legendOpts ? { options: legendOpts, items: legendItems } : undefined,
      theme,
      measure,
    },
    occupied,
  );
  const plot = frameResult.plot;
  fixedPlotChrome(frameResult);

  // ---- center column + panes ----
  const catLineH = tickFont.size * (tickFont.lineHeight ?? 1.2);
  const maxCatLabelW = Math.max(
    1,
    maxOf(rows.map((r) => measure(`${r.label}${r.mark}`, highlights.has(r.id) ? tickBold : tickFont).width)),
  );
  // header band for series labels above each pane
  const headerH = labelFont.size * (labelFont.lineHeight ?? 1.2) + (paneFit ? 7 : 10);
  const rowsTop = plot.y + headerH;
  // Panes on their own scales each draw a thin value axis under the rows.
  const ownAxis = redesign && !sharedScale && !labelsOff('tick') && comparison?.noAxis !== true;
  const axisFont = secondaryFont(theme);
  const axisH = ownAxis ? axisFont.size * (axisFont.lineHeight ?? 1.2) + AXIS_GAP + 4 : 0;
  const rowsBottom = plot.y + plot.h - axisH;
  // Unpinned, the butterfly takes the height of its rows at their natural
  // pitch, room for a two-line name, so one row does not stand in a 16:9
  // frame. Names that keep one line (the gutter's 35%
  // rule below) take a tighter pitch, closer on a narrow card.
  const oneLineNames = redesign && maxCatLabelW + 20 <= plot.w * 0.35;
  const rowPitch = oneLineNames ? (size.width >= 600 ? ROW_PITCH : size.width >= 480 ? 36 : 34)
    : Math.max(ROW_PITCH, 2 * catLineH + 8);
  const barShare = oneLineNames ? (rowPitch - (size.width >= 600 ? 14 : 12)) / rowPitch : undefined;
  const chromeH = size.height - (rowsBottom - rowsTop);
  const rowDriven = comparison?.rowDriven !== false;
  const grow = rowDriven ? rowDrivenHeight({ options: opts, width: size.width, height: size.height, chromeH, rowsH: rows.length * rowPitch }) : undefined;
  if (grow !== undefined) return layoutButterfly(data, { ...opts, size: { width: size.width, height: grow } }, comparison);
  // A pinned canvas that holds the rows only without the axes keeps its rows.
  if (ownAxis && rowsBottom - rowsTop < rows.length * catLineH - 1e-6) return layoutButterfly(data, options, { ...comparison, noAxis: true });
  // The advertised minimum drops ULP noise (ceilSizing), so the refusal does too:
  // 134.39999999999998 px of rows hold 8 lines of 16.8 px.
  if (rowsBottom <= rowsTop || (rowDriven && rowsBottom - rowsTop < rows.length * catLineH - 1e-6)) {
    const sizing = rowSizing('butterfly', size, { chromeH, minimumRowsH: rows.length * catLineH, naturalRowsH: rows.length * rowPitch });
    return {
      type: 'butterfly', size, sizing, plot, scene: [], labels: [], axes: [], annotations: [],
      frame: frameResult.frame, marks: { left: [], right: [], center: plot }, derived: { diffs: {} },
      a11y: { title: 'Butterfly', desc: chartString(options, 'rowsNeedHeight') },
      warnings: [{ code: 'size-below-floor', severity: 'error', message: `butterfly needs at least ${sizing.minWidth} × ${sizing.minHeight}px`,
        suggest: `use a height of at least ${sizing.minHeight}px` }], debug: { occupied: [], decisions: [] },
    };
  }
  // The rows keep the frame's height; a bar stops at MAX_BAR_H and the gaps take the rest.
  const bf = Math.min(opts.bandFraction ?? barShare ?? 0.7,(MAX_BAR_H * rows.length) / Math.max(1, rowsBottom - rowsTop));
  const band = bandScale(rows.length, [rowsTop, rowsBottom], {
    paddingInner: 1 - bf,
    paddingOuter: (1 - bf) / 2,
  });
  // under a render target, rows tighter than a name's line give the
  // whole name column its one type step, bounded by the target floor.
  // A pyramid on a pinned height keeps its canvas, so a tight row may take its target's readability floor as the one step
  // when the type scale has no smaller role above it. An unpinned one grows to its floor and keeps the full line box.
  const pinnedRows = !rowDriven && (opts as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === true;
  const oneStep = (font: FontSpec, role: 'axis' | 'label'): FontSpec | undefined => {
    const step = stepDownFont(theme, font, role, opts.target, textScaleOf(opts));
    const floor = targetFloorsPx(opts.target ?? DEFAULT_TARGET, textScaleOf(opts))[role];
    return step ?? (pinnedRows && floor < font.size ? { ...font, size: floor } : undefined);
  };
  const smallestName = oneStep(tickFont, 'axis');
  const nameStep = band.step < catLineH + LABEL_PAD ? smallestName : undefined;
  // On a pinned height, a row tighter than a line of its value type gives the values the same one step, and every
  // label of such a row takes the height of its ink instead of a full line box. The row keeps 4 px around the ink.
  const smallestValue = oneStep(labelFont, 'label');
  const tightValues = pinnedRows && band.step < lineBox(labelFont) + LABEL_PAD;
  const valueFont: FontSpec = tightValues ? smallestValue ?? labelFont : labelFont;
  const inkBox = (font: FontSpec) => measure.capHeight?.(font) ?? font.size * 0.72;
  const tightRows = pinnedRows && band.step < catLineH + LABEL_PAD;
  // a pyramid keeps its canvas, so under a render target its rows
  // report the height a value and a name need. The size gate then grows an
  // unsized pyramid to it and refuses a fixed frame with that size, instead
  // of hiding half the rows into a note that shrinks the plot further.
  if (!rowDriven) {
    // Only the text that is drawn is charged, and a tight row charges the ink of its text, not a line box.
    const stepped = (font: FontSpec, step: FontSpec | undefined) => inkBox(step ?? font) + 4;
    const rowNeed = pinnedRows
      ? Math.max(valuesOff ? 0 : stepped(labelFont, smallestValue), labelsOff('category') ? 0 : stepped(tickFont, smallestName), 4)
      : Math.max(measure('0', labelFont).height, lineBox(smallestName ?? tickFont)) + LABEL_PAD;
    // Reported where it holds too, so the size a refusal names reports the same minimum.
    const short = rows.length * rowNeed - (rowsBottom - rowsTop);
    frameResult.frame.plotMinHeight = Math.max(frameResult.frame.plotMinHeight ?? 0, size.height + (frameResult.deficit ?? 0) + short);
  }
  const nameFont: FontSpec = nameStep ?? tickFont;
  const nameBold: FontSpec = { ...nameFont, weight: emphasisWeight(theme) };
  const nameLineH = lineBox(nameFont);
  const catMaxLines = rowDriven || band.step >= 2 * nameLineH + 4 ? 2 : 1;
  const catFontOf = (r: (typeof rows)[number]): FontSpec => (highlights.has(r.id) ? nameBold : nameFont);
  const markW = (r: (typeof rows)[number]): number => (r.mark ? measure(r.mark, catFontOf(r)).width : 0);
  // A cell format prints in its pane's unit, so "$k" holds its scale (exampleSpec).
  const paneUnit = (side: 'a' | 'b') => (side === 'a' ? sA : sB).unit ?? opts.unit;
  const textOf = (v: number | null, meta: CellMeta | null, side: 'a' | 'b'): string => {
    if (v === null) return '';
    const custom = meta?.label;
    const text = meta?.format ? byExample(meta.format, paneUnit(side))(v) : (side === 'a' ? fmtA : fmtB)(v);
    if (typeof custom === 'string') return custom.replace(/\$\{value\}/g, text);
    return text;
  };
  const room = comparison?.bracketRoom ?? { left: 0, right: 0 };
  // Comparison exhibits already use a readable 20 px run. A comparison
  // disclosed in the footer does not need a bracket gutter on the canvas.
  const comparisonRun = opts.annotations?.some(ann => ann.kind === 'cagr' || ann.kind === 'diff') ? 20 : 40;
  const minimumPane = (side: 'a' | 'b', bracketRoom: number) => comparisonRun + (valuesOff ? 0 : Math.max(0, maxOf(rows.map((r) => {
    const text = textOf(side === 'a' ? r.a : r.b, side === 'a' ? r.aMeta : r.bMeta, side);
    return text ? measure(text, labelFont).width + 10 : 0;
  })))) + bracketRoom;
  // The widest centre column that leaves both panes their minimum, brackets included.
  const panesMinimum = comparisonRun === 20 ? minimumPane('a', room.left) + minimumPane('b', room.right)
    : 2 * Math.max(minimumPane('a', room.left), minimumPane('b', room.right));
  // A paneFit card's lane is its widest name plus 4 px a side, where 35% of the plot holds it.
  // A row-driven card (below 480 px) takes the same lane, so the panes keep
  // the room their value and delta labels need.
  const laneCard = insideCard || (redesign && size.width < 480);
  const narrowLane = laneCard && opts.centerColumnWidth === undefined && Math.ceil(maxCatLabelW) + 2 * LANE_PAD <= plot.w * 0.35;
  const namePad = narrowLane ? 2 * LANE_PAD : 16;
  const centerW = narrowLane ? Math.ceil(maxCatLabelW) + 2 * LANE_PAD : centerColumnWidth(rows.map((r) => ({ label: `${r.label}${r.mark}`, font: catFontOf(r) })), {
    authored: opts.centerColumnWidth, natural: maxCatLabelW + 20, plotW: plot.w, maxLines: catMaxLines, measure, target: rowDriven ? opts.target : undefined,
    card: size.width < 480, widest: plot.w - panesMinimum,
  });
  // One column of names: a step down applies to all of them or to none.
  // The mark is reserved and appended after the fit, so an ellipsis takes
  // the tail of the name and never the reference.
  const centerNames = fitColumn(rows.map((r) => ({
    text: r.label, font: catFontOf(r), maxWidth: centerW - namePad - markW(r), maxLines: catMaxLines,
    shrink: stepDownFont(theme, catFontOf(r), 'axis', opts.target, textScaleOf(opts)), target: opts.target, textScale: textScaleOf(opts), typeRole: 'axis' as const,
  })), measure).map((fitted, index) => {
    const row = rows[index]!;
    if (!row.mark) return fitted;
    const lines = [...fitted.lines];
    lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''}${row.mark}`;
    return { ...fitted, lines, w: fitted.w + measure(row.mark, fitted.font).width };
  });
  const paneW = (plot.w - centerW) / 2;
  // On one scale the panes differ in width where only one holds a bracket: the
  // pane without it gives its spare room to the pane with it (see `splitPanes`).
  let paneWA = paneW;
  let paneWB = paneW;
  let centerX0 = plot.x + paneW;
  let centerX1 = centerX0 + centerW;

  // ---- scales (bar length in px per pane) ----
  const absA = rows.map((r) => Math.abs(r.a ?? 0));
  const absB = rows.map((r) => Math.abs(r.b ?? 0));
  const maxA = Math.max(0, maxOf(absA));
  const maxB = Math.max(0, maxOf(absB));
  const reserve = (side: 'a' | 'b'): number => {
    const widths = rows.map((r) => {
      const v = side === 'a' ? r.a : r.b;
      const meta = side === 'a' ? r.aMeta : r.bMeta;
      const t = textOf(v, meta, side);
      return t ? measure(t, labelFont).width : 0;
    });
    return Math.min(paneW * 0.5, Math.max(0, maxOf(widths)) + 10) + (side === 'a' ? room.left : room.right);
  };
  const availA = Math.max(20, paneW - reserve('a'));
  const availB = Math.max(20, paneW - reserve('b'));
  // No value axis exists here, so nothing consumes a nice max: unbounded snap
  // is pure dead pane width. Zero pins the bottom edge; the bound caps top-edge
  // overshoot (the domain-economy invariant).
  const boundedMax = (m: number): number =>
    niceDomain(0, m || 1, 5, { dataExtent: [0, m || 1], maxWasteFraction: 0.15 })[1];
  const dMaxShared = boundedMax(Math.max(maxA, maxB));
  const lenShared = Math.min(availA, availB);
  const lenOf = paneFit ? fittedLengths() : {
    a: sharedScale
      ? linearScale([0, dMaxShared], [0, lenShared])
      : linearScale([0, boundedMax(maxA)], [0, availA]),
    b: sharedScale
      ? linearScale([0, dMaxShared], [0, lenShared])
      : linearScale([0, boundedMax(maxB)], [0, availB]),
  };
  // Pixels per unit such that every row's bar, value label and delta
  // end inside the pane; the longest of them touches its edge (no axis, so a
  // nice maximum is only unused pane).
  function fittedLengths(): Record<'a' | 'b', (v: number) => number> {
    // A card decides inside or outside at the scale it ends with: start from
    // a pane-wide bar and settle in a few passes (the scale only shrinks).
    let kInside = Infinity;
    if (insideCard) {
      for (let pass = 0; pass < 4; pass++) {
        splitPanes(kInside);
        const next = Math.min(pxPerUnit('a'), pxPerUnit('b'));
        if (next === kInside) break;
        kInside = next;
      }
    }
    splitPanes(kInside);
    // Where the two panes carry unequal room, move the name column until both
    // panes end at the same scale: pane A's width is the one that makes
    // `rawPxPerUnit` of A equal B's (A grows with it, B shrinks).
    function splitPanes(kIn: number): void {
      paneWA = paneWB = paneW;
      if (!sharedScale || room.left === room.right) return;
      let lo = 40 + room.left;
      let hi = 2 * paneW - 40 - room.right;
      if (lo >= hi) return;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        paneWA = mid;
        paneWB = 2 * paneW - mid;
        if (rawPxPerUnit('a', kIn) < rawPxPerUnit('b', kIn)) lo = mid; else hi = mid;
      }
      paneWA = (lo + hi) / 2;
      paneWB = 2 * paneW - paneWA;
    }
    function pxPerUnit(side: 'a' | 'b'): number {
      const k = rawPxPerUnit(side, kInside);
      const max = side === 'a' ? maxA : maxB;
      return Number.isFinite(k) ? Math.max(k, max > 0 ? 20 / max : 0) : Infinity;
    }
    function rawPxPerUnit(side: 'a' | 'b', kIn: number): number {
      const bound = side === 'a' ? room.left : room.right;
      const w = side === 'a' ? paneWA : paneWB;
      if (signed) return signedPxPerUnit(side, w - bound, w);
      let k = Infinity;
      for (const r of rows) {
        const v = Math.abs((side === 'a' ? r.a : r.b) ?? 0);
        if (v <= 0) continue;
        const text = valuesOff ? '' : textOf(side === 'a' ? r.a : r.b, side === 'a' ? r.aMeta : r.bMeta, side);
        // A value label takes at most half the pane, a delta after it up to 70%.
        // On a paneFit card a value that goes inside the bar end takes no tail.
        const textW = text ? measure(text, labelFont).width : 0;
        const inside = insideCard && text !== '' && fitsInsideBar(v * kIn, textW);
        const valueTail = inside ? 0 : Math.min(w * 0.5, text ? VALUE_GAP + textW : 0);
        const tail = Math.min(w * 0.7, valueTail + deltaTail(r, side));
        k = Math.min(k, (w - bound - Math.max(valueTail, tail)) / v);
      }
      return k;
    }
    const kA = pxPerUnit('a');
    const kB = pxPerUnit('b');
    centerX0 = plot.x + paneWA;
    centerX1 = centerX0 + centerW;
    const shared = Math.min(kA, kB);
    const k = Number.isFinite(shared) ? shared : 0;
    return sharedScale ? { a: (v) => v * k, b: (v) => v * k }
      : { a: (v) => v * (Number.isFinite(kA) ? kA : 0), b: (v) => v * (Number.isFinite(kB) ? kB : 0) };
  }
  // under a render target a value goes inside only where the bar
  // is as tall as its type; a thinner bar left the digits half on the page
  // in the page-colour ink.
  function fitsInsideBar(len: number, textW: number): boolean {
    return len >= textW + 8 && band.bandwidth >= valueFont.size;
  }
  // The room a delta label on this row and side takes after its value label.
  function deltaTail(r: Row, side: 'a' | 'b'): number {
    let tail = 0;
    for (const ann of opts.annotations ?? []) {
      if (ann.kind !== 'delta') continue;
      const at = typeof ann.at === 'string' ? { categoryId: ann.at } : ann.at as { categoryId?: Id; seriesId?: Id };
      if (at.categoryId !== r.id || (at.seriesId ?? sB.id) !== (side === 'a' ? sA.id : sB.id)) continue;
      const own = side === 'a' ? r.a : r.b;
      const vs = typeof ann.vs === 'number' ? ann.vs : (() => {
        const ref = typeof ann.vs === 'string' ? { categoryId: ann.vs } : ann.vs as { categoryId?: Id; seriesId?: Id };
        const row = rows.find((x) => x.id === ref.categoryId);
        if (!row) return null;
        return (ref.seriesId ?? sB.id) === sA.id ? row.a : row.b;
      })();
      if (own === null || vs === null) continue;
      const d = own - vs;
      const text = ann.text ?? `${d < 0 ? '−' : '+'}${(side === 'a' ? fmtA : fmtB)(Math.abs(d))}`;
      const size = measure(text, strongFont);
      tail = Math.max(tail, deltaGap(size.height) + size.width + 2);
    }
    return tail;
  }

  // The room after a bar end for its value label, and a delta after it.
  function rowTail(r: Row, side: 'a' | 'b', w: number): number {
    const text = valuesOff ? '' : textOf(side === 'a' ? r.a : r.b, side === 'a' ? r.aMeta : r.bMeta, side);
    const valueTail = Math.min(w * 0.5, text ? VALUE_GAP + measure(text, labelFont).width : 0);
    return Math.max(valueTail, Math.min(w * 0.7, valueTail + deltaTail(r, side)));
  }
  // Pixels per unit where the pane holds its negative bars between the zero line and the names
  // and its positive bars (each with its label) outward from the zero line.
  function signedPxPerUnit(side: 'a' | 'b', avail: number, w: number): number {
    const items = rows.flatMap((r) => {
      const v = side === 'a' ? r.a : r.b;
      return v === null ? [] : [{ v, tail: rowTail(r, side, w) }];
    });
    const smallest = Math.min(...items.filter((item) => item.v !== 0).map((item) => Math.abs(item.v)));
    if (!Number.isFinite(smallest)) return Infinity;
    const need = (k: number): number => {
      let neg = 0;
      let pos = 0;
      for (const { v, tail } of items) {
        if (v < 0) neg = Math.max(neg, -v * k + tail); else pos = Math.max(pos, v * k + tail);
      }
      return neg + pos;
    };
    let lo = 0;
    let hi = Math.max(0, avail) / smallest;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (need(mid) <= avail) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Where each pane's zero line stands: at the names' edge, or further out by the room its
  // negative bars and their labels take. Positive bars run outward from it.
  const zeroX = {
    a: centerX0 - (signed ? negativeRoom('a') : 0),
    b: centerX1 + (signed ? negativeRoom('b') : 0),
  };
  function negativeRoom(side: 'a' | 'b'): number {
    const w = side === 'a' ? paneWA : paneWB;
    return maxOf(rows.map((r) => {
      const v = side === 'a' ? r.a : r.b;
      return v !== null && v < 0 ? lenOf[side](-v) + rowTail(r, side, w) : 0;
    }));
  }
  const zeroOf = (side: 'a' | 'b'): number => zeroX[side];
  /** The way a value's bar runs from its zero line: -1 left, +1 right. Positive bars run outward. */
  const dirOf = (side: 'a' | 'b', v: number | null): -1 | 1 =>
    (side === 'a' ? -1 : 1) * (signed && v !== null && v < 0 ? -1 : 1) as -1 | 1;

  const naText = opts.strings?.notApplicable ?? commonString(opts, 'notApplicable');

  // ---- marks ----
  const nodes: SceneNode[] = [...frameResult.nodes];
  const marks: ButterflyMarks = {
    left: [],
    right: [],
    center: { x: centerX0, y: rowsTop, w: centerW, h: rowsBottom - rowsTop },
  };
  const labelRequests: LabelRequest[] = [];

  // category-axis baselines: bars anchor on the center column's edges
  const baselineLeftId = 'axis:baseline:left';
  const baselineRightId = 'axis:baseline:right';
  nodes.push({
    t: 'line', id: baselineLeftId,
    x1: zeroX.a, y1: rowsTop, x2: zeroX.a, y2: rowsBottom,
    stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'baseline',
  });
  nodes.push({
    t: 'line', id: baselineRightId,
    x1: zeroX.b, y1: rowsTop, x2: zeroX.b, y2: rowsBottom,
    stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'baseline',
  });
  occupied.claim({ x: zeroX.a - 0.6, y: rowsTop, w: 1.2, h: rowsBottom - rowsTop }, 'axis', {});
  occupied.claim({ x: zeroX.b - 0.6, y: rowsTop, w: 1.2, h: rowsBottom - rowsTop }, 'axis', {});

  // extreme rows (largest |value| per series) get the 'extreme' priority band
  const extremeA = maxA > 0 ? rows[absA.indexOf(maxA)]?.id : undefined;
  const extremeB = maxB > 0 ? rows[absB.indexOf(maxB)]?.id : undefined;

  const resolveCss = (paint: Paint): string => paintColor(theme, paint);

  rows.forEach((r, i) => {
    const rowY = band.position(i);
    const rowH = band.bandwidth;
    const cy = rowY + rowH / 2;
    const endpoint = i === 0 || i === rows.length - 1;
    const rowHl = highlights.has(r.id);

    for (const side of ['a', 'b'] as const) {
      const series = side === 'a' ? sA : sB;
      const v = side === 'a' ? r.a : r.b;
      const meta = side === 'a' ? r.aMeta : r.bMeta;
      const fmt = side === 'a' ? fmtA : fmtB;
      const len = v === null ? 0 : Math.max(lenOf[side](Math.abs(v)), 0.5);
      const dir = dirOf(side, v);
      const tipX = zeroOf(side) + dir * len;
      const rect: Rect = { x: Math.min(zeroOf(side), tipX), y: rowY, w: len, h: rowH };
      const nodeId = `mark:${series.id}:${r.id}`;
      const basePaint = side === 'a' ? paintA : paintB;
      // Under `negatives: 'magnitude'` a negative value draws lighter, its hue washed toward
      // the page down to the mark floor; its sign stays in the label.
      const paint = v !== null && v < 0 && !signed ? negativePaint(barPaint(r.rest, meta, basePaint)) : barPaint(r.rest, meta, basePaint);
      const scen =
        normalizeScenario(meta?.scenario as string | undefined, `series[${series.id}].values[${r.id}].scenario`) ??
        (side === 'a' ? scenA : scenB);
      // The Others family rule: the rest row's pale bar takes the separation outline.
      const sep = othersSeparation(paint, theme);
      nodes.push({
        t: 'rect',
        id: nodeId,
        rect,
        fill: paint,
        pattern: patternOf(scen),
        ...(sep ? { stroke: sep.stroke, strokeWidth: sep.strokeWidth } : {}),
        ...(isOthersFill(paint) ? { separation: { fill: paint, backing: { token: 'background' } as const } } : {}),
        owner: { seriesId: series.id, categoryId: r.id },
        part: 'bar',
        ...(v === null
          ? {}
          : {
              display: {
                value: meta?.format ? byExample(meta.format, paneUnit(side))(v) : fmt(v),
              },
            }),
      });
      occupied.claim(rect, 'mark', { seriesId: series.id, categoryId: r.id });
      (side === 'a' ? marks.left : marks.right).push({ id: r.id, rect, nodeId });

      // A value the data lacks prints the not-applicable mark at the pane's zero line, in the muted ink.
      if (v === null) {
        if (naText !== '' && !valuesOff && redesign) {
          const naSize = measure(naText, valueFont);
          labelRequests.push({
            id: `na:${series.id}:${r.id}`,
            kind: 'point',
            owner: { seriesId: series.id, categoryId: r.id },
            text: naText,
            lines: [naText],
            font: valueFont,
            priority: PRIORITY.endpoint,
            candidates: [{
              slot: 'outsideEnd',
              rect: {
                x: side === 'a' ? zeroOf(side) - NA_GAP - naSize.width : zeroOf(side) + NA_GAP,
                y: cy - naSize.height / 2, w: naSize.width, h: naSize.height,
              },
              penalty: 0,
            }],
          });
        }
        continue;
      }
      // ---- value label at the bar end (outside-end; inside-end fallback) ----
      const text = textOf(v, meta, side);
      const tsize = measure(text, valueFont);
      if (tightRows) tsize.height = inkBox(valueFont);
      const outsideGap = paneFit ? VALUE_GAP : 6;
      const outside: SlotCandidate = {
        slot: 'outsideEnd',
        rect: {
          x: dir < 0 ? tipX - outsideGap - tsize.width : tipX + outsideGap,
          y: cy - tsize.height / 2,
          w: tsize.width,
          h: tsize.height,
        },
        penalty: 0,
      };
      const candidates: SlotCandidate[] = [outside];
      const fitsInside = fitsInsideBar(len, tsize.width);
      if (fitsInside) {
        // A paneFit card takes the inside seat first (the solver tries seats in
        // order); the outside one stays for a short bar.
        if (insideCard) outside.penalty = 1;
        candidates[insideCard ? 'unshift' : 'push']({
          slot: 'insideEnd',
          rect: {
            x: dir < 0 ? tipX + 4 : tipX - 4 - tsize.width,
            y: cy - tsize.height / 2,
            w: tsize.width,
            h: tsize.height,
          },
          penalty: insideCard ? 0 : 1,
          insideFill: resolveCss(paint),
          insidePaint: paint,
        });
      }
      const priority =
        meta?.priority !== undefined
          ? meta.priority
          : (endpoint
              ? PRIORITY.endpoint
              : r.id === (side === 'a' ? extremeA : extremeB)
                ? PRIORITY.extreme
                : PRIORITY.interior + Math.min(99, Math.abs(v))) +
            (rowHl || highlights.has(series.id) ? PRIORITY.highlightBonus : 0);
      labelRequests.push({
        id: `point:${series.id}:${r.id}`,
        kind: 'point',
        owner: { seriesId: series.id, categoryId: r.id },
        text,
        lines: [text],
        font: valueFont,
        priority,
        redundant: meta?.label === false || labelsOff('point'),
        // A hidden value's note names its side and row: a pyramid's data has no
        // series or categories the shared note could name them from.
        noteText: `${comparison?.periods?.[series.id]?.label ?? (side === 'a' ? aLabel : bLabel)} ${text} (${r.label})`,
        candidates,
      });
    }

    // ---- center category label ----
    const catFont = catFontOf(r);
    const fitted = centerNames[i]!;
    const catW = fitted.w;
    const catH = tightRows && fitted.lines.length === 1 ? inkBox(fitted.font) : fitted.lines.length * (fitted.font === catFont ? nameLineH : lineBox(fitted.font));
    labelRequests.push({
      id: `category:${r.id}`,
      kind: 'category',
      owner: { categoryId: r.id },
      text: `${r.label}${r.mark}`,
      ...fittedLabel(fitted, catFont),
      font: catFont,
      priority: PRIORITY.endpoint + (rowHl ? PRIORITY.highlightBonus : 0),
      redundant: labelsOff('category'),
      candidates: [
        {
          slot: 'center',
          rect: { x: centerX0 + centerW / 2 - catW / 2, y: cy - catH / 2, w: catW, h: catH },
          penalty: 0,
        },
      ],
    });
  });

  // ---- series header labels above each pane ----
  for (const side of ['a', 'b'] as const) {
    const series = side === 'a' ? sA : sB;
    const text = side === 'a' ? aLabel : bLabel;
    const tsize = measure(text, strongFont);
    const paneCenter = side === 'a' ? plot.x + paneWA / 2 : centerX1 + paneWB / 2;
    const centered = clamp(
      paneCenter - tsize.width / 2,
      side === 'a' ? plot.x : centerX1,
      (side === 'a' ? centerX0 : plot.x + plot.w) - tsize.width,
    );
    labelRequests.push({
      id: `series:${series.id}`,
      kind: 'series',
      owner: { seriesId: series.id },
      text,
      lines: [text],
      font: strongFont,
      priority: PRIORITY.endpoint + (highlights.has(series.id) ? PRIORITY.highlightBonus : 0),
      redundant: labelsOff('series'),
      candidates: [
        // Each header stands at its pane's inner edge, by the names.
        ...(paneFit ? [{
          slot: 'aboveInner',
          rect: { x: side === 'a' ? centerX0 - tsize.width : centerX1, y: plot.y, w: tsize.width, h: tsize.height },
          penalty: -1,
        }] : []),
        {
          slot: 'aboveCenter',
          rect: { x: centered, y: plot.y, w: tsize.width, h: tsize.height },
          penalty: 0,
        },
        {
          slot: 'aboveOuter',
          rect: {
            x: side === 'a' ? plot.x : plot.x + plot.w - tsize.width,
            y: plot.y,
            w: tsize.width,
            h: tsize.height,
          },
          penalty: 1,
        },
      ],
    });
  }

  // ---- value axes of panes on their own scales ----
  const valueAxes: Geometry<ButterflyMarks, ButterflyDerived>['axes'] = [];
  if (ownAxis) {
    for (const side of ['a', 'b'] as const) {
      const shown = rows.flatMap((r) => (side === 'a' ? r.a : r.b) ?? []);
      if (shown.length === 0) continue;
      // The axis spans the data: from the longest negative bar to the longest positive one.
      const lo = signed ? Math.min(0, ...shown) : 0;
      const hi = signed ? Math.max(0, ...shown) : Math.max(0, ...shown.map(Math.abs));
      if (hi === lo) continue;
      const outward = side === 'a' ? -1 : 1;
      const at = (value: number): number => zeroOf(side) + outward * lenOf[side](value);
      const axisY = rowsBottom;
      const axis = layoutValueAxis({
        scale: linearScale([lo, hi], [at(lo), at(hi)]),
        plot: { ...plot, h: rowsBottom - plot.y },
        orient: 'x',
        gridlines: false,
        format: side === 'a' ? fmtA : fmtB,
        // The ticks read at the precision of their spacing: 0.5 steps over whole values print 0.5, not 1.
        formatSpec: (side === 'a' ? rasterA : rasterB).specForSeries(side === 'a' ? sA : sB),
        tickCount: 4,
        theme,
        measure,
        canvasWidth: size.width,
      }, occupied);
      // Both axes number their nodes alike: tell the panes apart by id.
      const id = (name: string): string => `${name}:${side}`;
      const nodeIds = new Map(axis.nodes.map((node) => [node.id, id(node.id)] as const));
      for (const node of axis.nodes) nodes.push({ ...node, id: nodeIds.get(node.id)! });
      nodes.push({
        t: 'line', id: id('axis:x:line'), x1: at(lo), y1: axisY, x2: at(hi), y2: axisY,
        stroke: { token: 'axis' }, width: strokeToken(theme, 'hair'), owner: { seriesId: (side === 'a' ? sA : sB).id }, part: 'baseline',
      });
      for (const tick of axis.axis.ticks) {
        nodes.push({
          t: 'line', id: id(`axis:x:mark:${tick.at}`), x1: tick.pos, y1: axisY, x2: tick.pos, y2: axisY + 3,
          stroke: { token: 'axis' }, width: strokeToken(theme, 'hair'), owner: { seriesId: (side === 'a' ? sA : sB).id }, part: 'tick',
        });
        if (tick.labelId) tick.labelId = nodeIds.get(tick.labelId);
      }
      valueAxes.push(axis.axis);
    }
  }

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, opts, {
    measure,
    plot,
    labelPad: LABEL_PAD,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);
  for (const label of solved.placed) if (label.id.startsWith('na:')) label.ink = { token: 'inkMuted' };
  // A header names its pane in the pane's colour, lifted to the text contrast floor.
  if (redesign) {
    for (const label of solved.placed) {
      if (label.kind !== 'series' || label.hidden) continue;
      label.ink = seriesTextPaint(label.owner.seriesId === sA.id ? paintA : paintB);
    }
  }

  // ---- annotations ----
  // Point callouts clear outside value labels; two-anchor comparisons use actual tips.
  const placedById = new Map(solved.placed.map((l) => [l.id, l] as const));
  const anchorX = (dir: -1 | 1, sid: Id, catId: Id, tipX: number): number => {
    const vl = placedById.get(`point:${sid}:${catId}`);
    if (!vl || vl.hidden || vl.slot !== 'outsideEnd') return tipX;
    return dir < 0
      ? Math.min(tipX, vl.rect.x - 4)
      : Math.max(tipX, vl.rect.x + vl.rect.w + 4);
  };
  const resolve = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref } : ref;
    if (!('categoryId' in norm) || !norm.categoryId) return null;
    const i = rows.findIndex((r) => r.id === norm.categoryId);
    if (i < 0) return null;
    const r = rows[i]!;
    const sid = norm.seriesId ?? sB.id;
    const side = sid === sA.id ? 'a' : sid === sB.id ? 'b' : null;
    if (!side) return null;
    const v = side === 'a' ? r.a : r.b;
    if (v === null) return null;
    const len = Math.max(lenOf[side](Math.abs(v)), 0.5);
    return {
      x: anchorX(dirOf(side, v), sid, r.id, zeroOf(side) + dirOf(side, v) * len),
      y: band.position(i) + band.bandwidth / 2,
      value: v,
      format: side === 'a' ? sA.format : sB.format,
      date: comparison?.periods?.[sid]?.date ?? r.date,
      label: comparison?.periods?.[sid]?.label ?? r.label,
      // A pyramid's two sides are its periods, which the label already names.
      ...(comparison?.periods ? {} : { series: { id: sid, label: side === 'a' ? aLabel : bLabel } }),
      row: { y: band.position(i), h: band.bandwidth },
      owner: { seriesId: sid, categoryId: r.id },
    };
  };
  // Comparisons sit as brackets just outside the bars and value labels
  // of the pane they end in.
  const outerEdge = { left: centerX0, right: centerX1 };
  for (const m of marks.left) outerEdge.left = Math.min(outerEdge.left, m.rect.x);
  for (const m of marks.right) outerEdge.right = Math.max(outerEdge.right, m.rect.x + m.rect.w);
  for (const l of solved.placed) {
    if (l.hidden || l.kind !== 'point') continue;
    if (l.owner.seriesId === sA.id) outerEdge.left = Math.min(outerEdge.left, l.rect.x);
    else outerEdge.right = Math.max(outerEdge.right, l.rect.x + l.rect.w);
  }
  const brackets = marginBracketLayout(theme, { left: outerEdge.left - BRACKET_CLEAR, right: outerEdge.right + BRACKET_CLEAR });
  const annResult = runAnnotatePass({
    annotations: opts.annotations ?? [],
    resolve,
    comparisonLayout: brackets,
    defaultSpan:
      rows.length >= 2 ? { from: rows[0]!.id, to: rows[rows.length - 1]!.id } : undefined,
    occupied,
    plot,
    theme,
    measure,
    format: opts.format,
    locale: opts.locale?.language,
    strings: opts.strings,
    differenceFormat: comparison?.differenceFormat,
    solveCtx,
  });
  pushAll(warnings, annResult.warnings);
  if (redesign) seatDeltas();
  // A delta beside its own value, on its row, sits one label height after the
  // value at every width, with no dash: a dash before a negative delta reads
  // as a minus sign ('60 – −21').
  function seatDeltas(): void {
    (opts.annotations ?? []).forEach((ann, index) => {
      if (ann.kind !== 'delta') return;
      const at = typeof ann.at === 'string' ? { categoryId: ann.at } : ann.at as { categoryId?: Id; seriesId?: Id };
      const i = rows.findIndex((r) => r.id === at.categoryId);
      const sid = at.seriesId ?? sB.id;
      if (i < 0 || (sid !== sA.id && sid !== sB.id)) return;
      const label = annResult.labels.find((l) => l.id === `annotation:${defaultAnnotationId(ann, index)}` && !l.hidden);
      if (!label || label.lines && label.lines.length > 1) return;
      const rowY = band.position(i);
      const cy = label.rect.y + label.rect.h / 2;
      if (cy < rowY || cy > rowY + band.bandwidth) return;
      const side = sid === sA.id ? 'a' : 'b';
      const right = dirOf(side, side === 'a' ? rows[i]!.a : rows[i]!.b) > 0;
      const bar = (side === 'b' ? marks.right : marks.left)[i]!.rect;
      const value = placedById.get(`point:${sid}:${rows[i]!.id}`);
      const outside = value && !value.hidden && value.slot === 'outsideEnd';
      const end = right ? (outside ? value.rect.x + value.rect.w : bar.x + bar.w) : (outside ? value.rect.x : bar.x);
      // Only a label already beside its value, on the far side, moves in.
      if (right ? label.rect.x < end : label.rect.x + label.rect.w > end) return;
      const { width: w, height: h } = measure(label.text, strongFont);
      const x = right ? end + deltaGap(h) : end - deltaGap(h) - w;
      const y = rowY + band.bandwidth / 2;
      label.rect = { x, y: y - h / 2, w, h };
      // The pass measured the theme's label size; the row type is drawn.
      if (label.font) label.font = strongFont;
      const cap = measure.capHeight?.(strongFont);
      if (cap !== undefined) label.capHeight = cap;
      delete label.leader;
    });
  }
  // A bracket that runs past the plot takes its width from the bars, once.
  const reach = brackets.need();
  const over = {
    left: reach.left > 0 && outerEdge.left - BRACKET_CLEAR - reach.left < plot.x - 0.5,
    right: reach.right > 0 && outerEdge.right + BRACKET_CLEAR + reach.right > plot.x + plot.w + 0.5,
  };
  if (!comparison?.bracketRoom && (over.left || over.right)) {
    const bracketRoom = { left: over.left ? reach.left + BRACKET_CLEAR : 0, right: over.right ? reach.right + BRACKET_CLEAR : 0 };
    return layoutButterfly(data, options, { ...comparison, bracketRoom });
  }
  // A comparison that went to the note list keeps no room: the bars take it back.
  const leftBracket = annResult.labels.some(label => !label.hidden && label.rect.x + label.rect.w <= centerX0);
  const rightBracket = annResult.labels.some(label => !label.hidden && label.rect.x >= centerX1);
  if ((room.left > 0 && !leftBracket) || (room.right > 0 && !rightBracket)) {
    const bracketRoom = { left: leftBracket ? room.left : 0, right: rightBracket ? room.right : 0 };
    return layoutButterfly(data, options, { ...comparison, bracketRoom });
  }

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  const leftMinimum = minimumPane('a', leftBracket ? room.left : 0);
  const rightMinimum = minimumPane('b', rightBracket ? room.right : 0);
  const minWidth = size.width - plot.w + centerW + (comparisonRun === 20
    ? leftMinimum + rightMinimum : 2 * Math.max(leftMinimum, rightMinimum));
  pushAll(nodes, annResult.nodes);
  pushAll(nodes, labelsToNodes(theme, allLabels, (l) =>
      l.kind === 'series'
        ? strongFont
        : l.kind === 'category'
          ? l.owner.categoryId && highlights.has(l.owner.categoryId)
            ? nameBold
            : nameFont
          : l.kind === 'annotation' || l.kind === 'valueLine'
            ? { ...labelFont, weight: emphasisWeight(theme) }
            : l.kind === 'point' ? valueFont : labelFont, nodes,
    ));

  // Each line of a centre name is centred in the column, not only the block.
  for (const label of allLabels) {
    if (label.kind !== 'category' || label.hidden) continue;
    const node = nodes.find((n) => n.id === `label:${label.id}`);
    if (node?.t === 'text') {
      node.x = label.rect.x + label.rect.w / 2;
      node.align = 'middle';
    }
  }

  const a11yDesc = rows
    .map((r) => `${r.label}: ${aLabel} ${r.a === null ? '–' : fmtA(r.a)}, ${bLabel} ${r.b === null ? '–' : fmtB(r.b)}`)
    .join('; ');

  return {
    type: 'butterfly',
    size,
    ...(rowDriven ? { sizing: rowSizing('butterfly', size, { chromeH, minimumRowsH: rows.length * Math.max(catLineH, maxOf(centerNames.map((name) => name.h))), naturalRowsH: rows.length * rowPitch, minWidth }) } : {}),
    plot,
    scene: nodes,
    labels: allLabels,
    axes: [
      {
        axis: 'y',
        baselineNodeId: baselineLeftId,
        ticks: rows.map((r, i) => ({
          at: r.id,
          pos: band.position(i) + band.bandwidth / 2,
          labelId: `category:${r.id}`,
        })),
      },
      ...valueAxes,
    ],
    annotations: annResult.placed,
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: { diffs },
    a11y: {
      title: accessibleTitle(opts.title, chartString(options, 'butterflyTitle', { v1: aLabel, v2: bLabel })),
      counts: [structureCount('categories', rows.length, undefined, opts)],
      desc: chartString(options, 'butterflyDesc', { v1: aLabel, v2: bLabel, v3: rows.length, v4: a11yDesc }),
    },
    warnings,
    debug: { occupied: occupied.snapshot(), decisions: [...solved.decisions, ...annResult.decisions] },
  };
}

/**
 * Width of the centre name column. The soft width is the widest name plus
 * padding, capped at 35% of the plot (a card's two-line names take 80 px); a name that column would cut widens it
 * first, up to the shared gutter share. An authored width stays.
 */
function centerColumnWidth(
  names: readonly { label: string; font: FontSpec }[],
  input: { authored?: number; natural: number; plotW: number; maxLines: number; measure: TextMeasurer; target?: RenderTarget; card?: boolean; widest?: number },
): number {
  let cap = Math.max(40, input.plotW - 80);
  // A name keeps one line where 35% of the plot holds it, at every width.
  // Past that, a card (below 480 px) under a render target wraps the names
  // in an 80 px column when two lines hold them all. Otherwise the column
  // takes up to 35% and widens before a name is cut.
  if (input.card && input.authored === undefined) {
    const oneLine = Math.max(48, input.natural);
    if (oneLine <= input.plotW * 0.35) return Math.min(cap, oneLine);
    const fitsCard = names.every((name) =>
      fitText(name.label, name.font, 80 - 16, 2, input.measure, { target: input.target, typeRole: 'axis' }).title === undefined);
    if (fitsCard) return Math.min(cap, 80);
    // A card widens no further than its panes' minimum allows, so the column never raises the floor.
    cap = Math.min(cap, Math.max(48, input.widest ?? cap));
  }
  const soft = Math.min(input.authored ?? clamp(input.natural, 48, input.plotW * 0.35), cap);
  if (input.authored !== undefined) return soft;
  const needed = names.map((name) =>
    fitText(name.label, name.font, soft - 16, input.maxLines, input.measure, {
      wider: input.plotW * GUTTER_MAX_SHARE - 16, target: input.target, typeRole: 'axis',
    }).w + 16);
  return Math.min(cap, Math.max(soft, maxOf(needed)));
}

/** The gap between a bar's end and its outside value label. */
const VALUE_GAP = 4;

/** The gap between a pane's zero line and its not-applicable mark. */
const NA_GAP = 8;

/** The gap between the rows and the value axis of a pane on its own scale. */
const AXIS_GAP = 6;

/** A paneFit card's lane padding on each side of its widest name. */
const LANE_PAD = 4;

/** The solver's collision pad between two labels here. */
const LABEL_PAD = 2;

/** A negative bar's paint: the same hue, lighter, still a mark on the page. */
function negativePaint(paint: Paint): Paint {
  return { token: 'token' in paint ? paint.token : 'neutralMark', theme: { kind: 'visible-tint', base: paint, amount: 0.6, floor: MARK_CONTRAST_FLOOR } };
}

/** What the bar lengths mean when the panes do not share one scale or a value is negative. */
function scaleNotes(independent: boolean, negative: boolean, options: ButterflyOptions): string[] {
  const lengths = chartString(options, 'absoluteBarLengths');
  if (independent && negative) return [chartString(options, 'independentNegativeScales', { v1: lengths })];
  if (independent) return [chartString(options, 'independentScalesNote')];
  return negative ? [`${lengths[0]!.toUpperCase()}${lengths.slice(1)}.`] : [];
}
