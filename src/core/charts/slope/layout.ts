import { chartString } from '../../strings/slope';
import { breakUnsupported, chartTheme } from '../chartEnv';
import { chartWording } from '../../strings';
import { structureCount } from '../../structureCounts';
import { MARK_CONTRAST_FLOOR } from '../../themeRules';
import { distinguishSeries } from '../../seriesIdentity';
/**
 * Slope chart — exactly two time points, many entities.
 * Two vertical rails at the plot edges, one straight line per series, end
 * labels on both sides placed through spread1D (vertical cluster spreading
 * within plot bounds) with a leader dot at the rail point. Highlighted
 * series get the accent stroke, bold labels, and label-drop immunity; all
 * others de-emphasize to a light tint. Scenario is ignored except FC, which
 * renders dashed. More than two categories is a lint ERROR
 * ('slope-too-many-points'): layout proceeds on first + last only.
 * `options.foldBelowShare` merges the series that stay under that share of the
 * endpoint total at both ends into one summed 'Other' line (see ./fold.ts).
 */

import { cutWithTitle, fitText, lineBox } from '../../label/fitText';
import { stepDownFont } from '../../label/rowFit';
import type { AnchorResolution } from '../../annotate';
import { percentLevels, runAnnotatePass } from '../../annotatePass';
import { spread1DResult, sweepHide, warnSpreadOverflow } from '../../collide';
import { formatAuthoredPercent, formatAutomaticNumber, formatAutomaticPercent } from '../../format';
import { formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { clamp, cleanDiff, cleanFloat, type Rect } from '../../geometry';
import { createOccupiedIndex } from '../../label/occupied';
import { labelsToNodes } from '../../label/emit';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
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
import { applyAxisBounds, linearScale, niceDomain } from '../../scale';
import { authoredNotes, frameTextOptions, normalizeLegendOption, solveFrame, type FrameInput, type LegendItemInput, plotHeightAfter, authoredFootnoteCount } from '../../frame';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import {
  labelsOffKeepsNames,
  seriesPaint,
  canvasMargin,
  markRolePaint,
  panelTypeClass,
  resolveSemanticPaletteTheme,
  mutedMarkPaint,
  semanticPalettePaint,
  emphasisLabelTheme,
  emphasisWeight,
  dashToken,
  strokeToken,
} from '../../theme';
import type { AnchorRef } from '../../types/annotations';
import { cellMeta, cellValue, isPctCell, type Id } from '../../types/cell';
import type { Category, ChartData } from '../../types/data';
import type { LabelContent, LabelKind, LegendOptions, RenderTarget, SlopeOptions } from '../../types/options';
import type {
  AxisGeometry,
  Geometry,
  LintWarning,
  Paint,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import { valueLineExtent } from '../../valueLineDomain';
import { autoDecimals } from '../../formatPrecision';
import {
  foldShareRefusal,
  planSlopeFold,
  type EndVal,
  type NormSer,
  type SlopeFoldRecord,
} from './fold';
import { markedLabel } from '../../footnoteMark';
import { layoutDivergingSlope, type DivergingGroup, type DivergingPanelMark } from './diverging';
import { textScaleOf } from '../../typeFloors';
import { maxOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface SlopeMarks {
  series: {
    seriesId: Id;
    lineNodeId: Id;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }[];
  /** Variant 'diverging': one panel per group, in drawn order. */
  panels?: DivergingPanelMark[];
}

export interface SlopeDerived {
  /** Per plotted series: absolute change and % change (null when base = 0). */
  changes: Record<Id, { abs: number; pct: number | null }>;
  /** Series id with the largest positive change (absent if none rises). */
  steepestUp?: Id;
  /** Series id with the largest negative change (absent if none falls). */
  steepestDown?: Id;
  /** Present when `options.foldBelowShare` merged the small series into one line. */
  folded?: SlopeFoldRecord;
  /** Variant 'diverging': the panel order and each group's shares, net score and base. */
  diverging?: { order: Id[]; groups: Record<Id, DivergingGroup> };
}

/** Gap between an end label and its rail: room for the leader of a spread label. */
const RAIL_GAP = 8;
/** Below this gap between the rails with full end labels, the first rail prints values only. */
const COMPACT_GAP = 120;
/** Seat rank a line without a name on the other rail adds: above any authored priority. */
const NAME_RANK = 1e6;
/** The gap a compact slope keeps between its rails when the second rail takes the freed room. */
const COMPACT_MIN_GAP = 64;
/** From this canvas width an unpinned slope's rails are WIDE_RAIL_BASE + WIDE_RAIL_SHARE × width tall (350 px at 960, 280 at 720). */
const WIDE_RAIL_MIN_WIDTH = 600;
const WIDE_RAIL_BASE = 70;
const WIDE_RAIL_SHARE = 0.29;
/** The gap between the rails is at most this many plot heights. */
const MAX_GAP_RATIO = 1.6;
/**
 * The widest wash toward the page a rail in the fallback reference ink starts
 * from; the walk pulls it back to the lightest mix that still holds 3:1.
 */
const RAIL_WASH = 0.75;
/**
 * Vertical spacing between spread end labels. The line boxes may touch: the
 * pitch is the line box, and never under END_MIN_PITCH. A label moved
 * off its point by the spread takes a leader back to it, so a tight pitch
 * never leaves a value beside the wrong line.
 */
const SPREAD_GAP = 0;
/**
 * spread boxes touch, and a float error of 1e-14 made the solver's
 * pad-0 test read touching as overlapping (a 1200 x 400 report slope hid one
 * end label of six). End labels pad by this much less than zero.
 */
const TOUCH_TOLERANCE = 1e-6;
const END_MIN_PITCH = 13;
/** Sub-rects claimed along each diagonal line (honest occupied substrate). */
const LINE_CLAIM_SEGMENTS = 8;
/** Label-to-arm gap, solver/stroke daylight, and one lift step for a CAGR bracket. */
const CAGR_ENVELOPE_CLEARANCE = 26;

/** Annotation keys whose value is an AnchorRef, which may be a bare id. */
const BARE_ANCHOR_KEYS = new Set(['at', 'from', 'to', 'vs']);

export function layoutSlope(
  data: ChartData,
  options: SlopeOptions = {},
): Geometry<SlopeMarks, SlopeDerived> {
  if (options.variant === 'diverging') return layoutDivergingSlope(data, options);
  const warnings: LintWarning[] = [];
  if (options.diverging !== undefined || data?.series?.some((s) => ['negative', 'n', 'footnote'].some((k) => k in s))) {
    warnings.push({ code: 'slope-diverging-fields-ignored', severity: 'warn', message: "diverging, series negative, n and footnote are read by variant 'diverging' only; the plain slope ignores them", suggest: "set options.variant to 'diverging', or remove them" });
  }
  breakUnsupported('slope', options, warnings);
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  // Authored { pct } cells, never computed shares (the share rule does not apply).
  // Other values print through the shared raster (`formats`, set once the ends are read).
  // A series unit holds its own scale (forSeries): "€m" gets no engine B on top.
  // Each series takes its own precision from its two ends: 0.034 beside 0.5, not 0.03 beside 0.50.
  const seriesKeys = new Map<NormSer, { unit?: string; values: number[] }>();
  const seriesKey = (s: NormSer) => seriesKeys.get(s) ?? seriesKeys.set(s, { unit: s.unit, values: [s.a, s.b].flatMap((end) => (end.isPct || end.v === null ? [] : [end.v])) }).get(s)!;
  const fmtVal = (v: number, isPct: boolean, example: string | undefined, s: NormSer): string =>
    example ? (example === options.format && !s.unit ? formats.fmt(v) : formatterFromExample(example, options.locale?.language, s.unit ?? options.unit)(v))
      : (isPct ? formatAuthoredPercent(v, options.locale?.language) : formats.forSeries(seriesKey(s))(v));
  const highlights = new Set(resolveHighlight(options.highlight));
  const density = options.labelDensity ?? 'smart';

  // ---- normalize ----
  if (!data || !Array.isArray(data.categories) || data.categories.length < 2) {
    throw new NormalizeError(
      'empty-data',
      'categories',
      'slope requires exactly two categories (time points)',
    );
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'slope requires at least one series');
  }
  const allCats: Category[] = data.categories.map((c, i) => normalizeCategory(c as never, i));
  if (allCats.length > 2) {
    warnings.push({
      code: 'slope-too-many-points',
      severity: 'error',
      message: `slope requires exactly 2 categories, got ${allCats.length} — layout uses first and last only`,
      suggest: "use chart type 'line' for more than two time points",
    });
  }
  const i0 = 0;
  const i1 = allCats.length - 1;
  const c0 = allCats[i0]!;
  const c1 = allCats[i1]!;

  const toEnd = (cell: ReturnType<typeof normalizeSeriesValues>[number]): EndVal => {
    const meta = cellMeta(cell);
    return {
      v: cellValue(cell),
      isPct: isPctCell(cell),
      labelOverride: meta?.label,
      format: meta?.format,
      priority: meta?.priority,
    };
  };
  let seriesNorm: NormSer[] = data.series
    .map((s, si) => {
      if (!s?.id) throw new NormalizeError('missing-id', `series[${si}]`, 'series requires an id');
      const cells = normalizeSeriesValues(s, allCats, si);
      return {
        id: s.id,
        label: s.label ?? s.id,
        role: s.role ?? 'data',
        scenario: normalizeScenario(s.scenario as string | undefined, `series[${s.id}].scenario`),
        colorRole: s.colorRole,
        fill: s.fill,
        format: s.format,
        // Carried for the fold: a sum of euros and kilograms is not a quantity.
        ...(typeof s.unit === 'string' ? { unit: s.unit } : {}),
        a: toEnd(cells[i0]!),
        b: toEnd(cells[i1]!),
      };
    })
    .filter((s) => s.role !== 'reference') // reference series are NOT plotted
    .map(({ role: _role, ...rest }) => rest);
  // End values share one raster: one decimal count, the engine scale
  // from 1e6 ("196B", not "196,000,000,000"), and a small value lifted off 0.
  const formats = seriesRasterFormatter(options.format, seriesNorm.flatMap((s) => [s.a, s.b].flatMap((end) => (end.isPct ? [] : [end.v]))),
    options.locale?.language, options.unit, options.target);
  if (seriesNorm.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'slope requires at least one data-role series');
  }

  // ---- plotted set (both endpoints present) + derived changes ----
  let plottedSeries = seriesNorm.filter((s) => {
    const ok = s.a.v !== null && s.b.v !== null;
    if (!ok) {
      warnings.push({
        code: 'slope-missing-endpoint',
        severity: 'warn',
        message: `series '${s.id}': missing endpoint value — series not plotted`,
        owner: { seriesId: s.id },
      });
    }
    return ok;
  });
  // A series an annotation points at is the author's explicit subject. Folding
  // it would drop the annotation with bad-anchor, so it stays out, like a
  // highlight does. A bare-id anchor (`at: 'kestrel'`) names a series too,
  // unless it is one of the two rail ids, which resolveAnchor reads first.
  const kept = new Set<Id>(highlights);
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'seriesId' && typeof inner === 'string') kept.add(inner);
        else if (BARE_ANCHOR_KEYS.has(key) && typeof inner === 'string') {
          if (inner !== c0.id && inner !== c1.id) kept.add(inner);
        } else collect(inner);
      }
    }
  };
  collect(options.annotations);
  const foldRefusal = foldShareRefusal(options.foldBelowShare);
  if (foldRefusal) warnings.push(foldRefusal);
  const fold = foldRefusal || options.foldBelowShare === undefined ? null
    : planSlopeFold(plottedSeries, seriesNorm, options.foldBelowShare, {
      othersLabel: chartWording(options, 'others', 'Other'),
      highlights: kept, warnings,
      format: (v, isPct) => isPct && !options.format ? formatAuthoredPercent(v, options.locale?.language) : formats.fmt(v),
      ...(typeof options.unit === 'string' ? { chartUnit: options.unit } : {}),
      categories: { from: c0.label ?? c0.id, to: c1.label ?? c1.id },
      ...(options.locale?.language !== undefined ? { language: options.locale.language } : {}),
    });
  if (fold) ({ plotted: plottedSeries, listed: seriesNorm } = fold);
  const changes: Record<Id, { abs: number; pct: number | null }> = emptyIdRecord();
  for (const s of plottedSeries) {
    const abs = cleanDiff(s.b.v!, s.a.v!);
    changes[s.id] = {
      abs,
      pct: s.a.v! !== 0 ? cleanFloat((abs / Math.abs(s.a.v!)) * 100) : null,
    };
  }
  const byChange = (dir: 1 | -1): Id | undefined => {
    let best: Id | undefined;
    let bestAbs = 0;
    for (const s of plottedSeries) {
      const c = changes[s.id]!.abs * dir;
      if (c > bestAbs || (c === bestAbs && c > 0 && best !== undefined && s.id < best)) {
        best = s.id;
        bestAbs = c;
      }
    }
    return bestAbs > 0 ? best : undefined;
  };
  const steepestUp = byChange(1);
  const steepestDown = byChange(-1);

  // ---- label-kind gates + text composition ----
  const kindSetting = (kind: LabelKind): boolean | LabelContent => {
    const l = options.labels;
    if (l === false) return kind === 'category' && labelsOffKeepsNames(options);
    const v = l?.[kind];
    return v === undefined ? true : v;
  };
  const contentOf = (kind: LabelKind, dflt: LabelContent): LabelContent | null => {
    const s = kindSetting(kind);
    if (s === false) return null;
    return Array.isArray(s) ? s : dflt;
  };
  // Default end-label composition: '<series label> <value>' on the left rail,
  // '<value> <series label>' on the right rail (mirrored content order).
  // Parts keep the series NAME tagged so over-wide composites can truncate
  // the name alone — values always survive intact.
  const endContent = contentOf('series', ['series', 'absolute']);
  const composeEndParts = (
    s: NormSer,
    end: EndVal,
    cat: Category,
    side: 'left' | 'right',
    compact = false,
  ): { text: string; isName: boolean }[] => {
    if (!endContent) return [];
    // Names mirror to the outer edges where they tell lines apart; a single
    // line reads its name first at both ends ("ARR 48" beside "121 ARR").
    // Compact: the first rail prints values only; the second rail names them.
    // A series whose second label is off keeps its name on the first rail.
    const content = compact && side === 'left' && s.b.labelOverride !== false
      ? endContent.filter((c) => c !== 'series') : endContent;
    const ordered = side === 'left' || plottedSeries.length === 1 ? content : [...content].reverse();
    const parts: { text: string; isName: boolean }[] = [];
    for (const c of ordered) {
      if (c === 'absolute' && end.v !== null) {
        const value = fmtVal(end.v, end.isPct, end.format ?? s.format ?? options.format, s);
        parts.push({ text: typeof end.labelOverride === 'string'
          ? end.labelOverride.replace(/\$\{value\}/g, value) : value, isName: false });
      }
      else if (c === 'percent' && changes[s.id]?.pct != null)
        parts.push({ text: formatAutomaticPercent(changes[s.id]!.pct!, 1, true, options.locale?.language), isName: false });
      else if (c === 'category') parts.push({ text: cat.label ?? cat.id, isName: false });
      else if (c === 'series') parts.push({ text: s.label, isName: true });
    }
    return parts;
  };
  const composeEnd = (s: NormSer, end: EndVal, cat: Category, side: 'left' | 'right', compact = false): string => {
    const text = composeEndParts(s, end, cat, side, compact)
      .map((p) => p.text)
      .join(' ');
    return text;
  };

  // ---- fonts ----
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const hlFont: FontSpec = { ...labelFont, weight: emphasisWeight(theme) };
  const catFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const endFontOf = (s: NormSer): FontSpec => (highlights.has(s.id) ? hlFont : labelFont);
  // End-label vertical rhythm: one line box, at least 13 px.
  const endLineH = labelFont.size * (labelFont.lineHeight ?? 1.2);
  const minPitch = Math.max(END_MIN_PITCH, endLineH);

  // ---- paints (consulting grey + one accent; de-emphasis via light tint) ----
  // A line whose colorRole is 'highlight' is an authored focus too.
  const anyHighlight = highlights.size > 0 || seriesNorm.some((s) => !s.fill && s.colorRole === 'highlight');
  const rawLinePaint = (s: NormSer): Paint => {
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return markRolePaint(s.colorRole);
    if (highlights.has(s.id)) return semanticPalettePaint(theme, options.palette, 'focus');
    // A receded line and its end dots stay 3:1 on the page; a named palette keeps its own rank.
    if (anyHighlight && (options.palette === undefined || theme.color.palettes?.[options.palette] === undefined)) return mutedMarkPaint();
    return semanticPalettePaint(
      theme,
      options.palette,
      anyHighlight ? 'neutralLight' : 'neutralMark',
    );
  };
  // Without a highlight, an explicit key needs distinct series paints.
  // A highlight keeps the context lines quiet; their endpoint labels name them.
  const keyedPaints = !anyHighlight && options.legend && options.legend !== 'none'
    ? new Map(distinguishSeries(seriesNorm.map(s => ({ id: s.id, label: s.label, paint: rawLinePaint(s), key: 'line' as const,
      ...(s.scenario === 'FC' ? { dash: dashToken(theme, 'reference') } : {}),
    })), new Set(seriesNorm.filter(s => s.fill || s.colorRole || highlights.has(s.id)).map(s => s.id)),
    Array.from({ length: theme.color.series.length }, (_, i) => seriesPaint(i, options.palette)), theme).map(identity => [identity.id, identity.paint]))
    : undefined;
  const linePaint = (s: NormSer): Paint => keyedPaints?.get(s.id) ?? rawLinePaint(s);
  // A context line beside a highlight recedes to the mark stroke.
  const lineWidth = (s: NormSer): number =>
    strokeToken(theme, highlights.has(s.id) ? 'focus' : anyHighlight && !s.fill && !s.colorRole ? 'mark' : 'data');

  // ---- frame ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  let legendInput: FrameInput['legend'];
  if (options.legend && options.legend !== 'none' && options.legend !== 'auto') {
    const legendOpts: LegendOptions = normalizeLegendOption(options.legend);
    let items: LegendItemInput[] = seriesNorm
      .filter(s => !anyHighlight || highlights.has(s.id) || s.fill || s.colorRole || s.id === fold?.record.otherId)
      .map((s) => ({
      id: s.id,
      label: s.id === fold?.record.otherId ? fold.legendLabel : s.label,
      paint: linePaint(s),
      // Every slope line draws a dot at both ends: its key carries one.
      key: 'line', width: lineWidth(s), marker: { shape: 'circle' },
      ...(s.scenario === 'FC' ? { dash: dashToken(theme, 'reference') } : {}),
    }));
    if (legendOpts.order) {
      const oi = (id: Id) => {
        const k = legendOpts.order!.indexOf(id);
        return k === -1 ? Number.MAX_SAFE_INTEGER : k;
      };
      items = [...items].sort((a, b) => oi(a.id) - oi(b.id));
    }
    legendInput = { options: legendOpts, items };
  }
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      footnotes: [...authoredNotes(options), ...(fold ? [fold.record.note] : [])],
      legend: legendInput,
      theme,
      measure,
    },
    occupied,
  );

  // ---- reserve side margins from the longest composed end label ----
  // A rail margin must not eat the plot: composites wider than 35% of
  // the frame plot width get their NAME part truncated (value stays intact),
  // so the margin reserved below stays bounded.
  const sideCap = Math.max(40, frameResult.plot.w * 0.35);
  // Two-line end labels need the rail height; else a wrap costs a label to the density drop.
  const wrapRoom = plottedSeries.length * (2 * endLineH + SPREAD_GAP) <= frameResult.plot.h * 0.8;
  const mkEndReq = (s: NormSer, end: EndVal, cat: Category, side: 'left' | 'right', compact = false, maxSideW = sideCap): EndReq => {
    const baseFont = endFontOf(s);
    let text = composeEnd(s, end, cat, side, compact);
    const fit = typeof end.labelOverride === 'string'
      ? undefined
      : fitEndLabel(text, baseFont, { maxSideW, wrapRoom, shrink: stepDownFont(theme, baseFont, 'label', options.target, textScaleOf(options)), target: options.target, measure });
    const font = fit?.font ?? baseFont;
    let lines = fit?.lines ?? [text];
    let tsize = fit?.size ?? measure(text || '0', font);
    let title: string | undefined;
    // A composite wider than the rail-margin cap: truncate the NAME at a
    // word boundary (ellipsize as the last resort) and keep the value intact.
    // Custom label templates are the user's exact text — never truncated.
    if (tsize.width > maxSideW && typeof end.labelOverride !== 'string') {
      const parts = composeEndParts(s, end, cat, side, compact);
      const nameIdx = parts.findIndex((p) => p.isName);
      if (nameIdx !== -1) {
        const budget =
          maxSideW -
          parts.reduce(
            (a, p, k) => (k === nameIdx ? a : a + measure(p.text, font).width),
            measure(' ', font).width * (parts.length - 1),
          );
        const name = parts[nameIdx]!.text;
        if (measure(name, font).width > budget) {
          let fitted = '';
          const words = name.split(' ');
          for (let k = words.length - 1; k >= 1; k--) {
            const cand = `${words.slice(0, k).join(' ')}…`;
            if (measure(cand, font).width <= budget) {
              fitted = cand;
              break;
            }
          }
          if (!fitted) fitted = cutWithTitle(name, font, Math.max(budget, 0), measure).text;
          title = text;
          parts[nameIdx] = { text: fitted, isName: true };
          text = parts.map((p) => p.text).join(' ');
          lines = [text];
          tsize = measure(text || '0', font);
        }
      }
    }
    const change = changes[s.id]?.abs ?? 0;
    const priority =
      end.priority ??
      PRIORITY.endpoint +
        Math.min(99, Math.abs(change)) +
        (highlights.has(s.id) ? PRIORITY.highlightBonus : 0);
    return {
      s,
      text,
      w: tsize.width,
      h: tsize.height,
      priority,
      suppressed: end.labelOverride === false || !text,
      ...(title !== undefined ? { title } : {}),
      ...(font !== baseFont ? { fontStep: font } : {}),
      lines,
    };
  };
  const sideMax = (reqs: EndReq[]): number =>
    reqs.reduce((m, r) => (r.suppressed ? m : Math.max(m, r.w)), 0);
  // Decide from the full text, capped at the room each side can take.
  // A fitted width can fall when a longer name wraps or cuts to a shorter word.
  const sideDemand = (side: 'left' | 'right'): number => plottedSeries.reduce((max, s) => {
    const end = side === 'left' ? s.a : s.b;
    if (end.labelOverride === false) return max;
    const text = composeEnd(s, end, side === 'left' ? c0 : c1, side);
    if (!text) return max;
    const width = measure(text, endFontOf(s)).width;
    return Math.max(max, typeof end.labelOverride === 'string' ? width : Math.min(sideCap, width));
  }, 0);
  // Compact end labels: when names and values on both
  // rails leave the slopes less than COMPACT_GAP px, the first rail prints the
  // values only and the second rail keeps 'value name', with the room the
  // first rail gave up. Only the default label content compacts; an authored
  // labels.series list is drawn as written.
  const fullLeftReqs = plottedSeries.map((s) => mkEndReq(s, s.a, c0, 'left'));
  const fullRightReqs = plottedSeries.map((s) => mkEndReq(s, s.b, c1, 'right'));
  const compactable = endContent !== null && options.labels !== false && !Array.isArray(options.labels?.series)
    && plottedSeries.length > 1 && endContent.includes('series') && endContent.length > 1;
  const gapCompact = compactable
    && frameResult.plot.w - sideDemand('left') - sideDemand('right') - 2 * RAIL_GAP < COMPACT_GAP;
  // Capped demands can fit even though their names do not. Keep the wider
  // name column until both full columns print without a cut.
  const cutCompact = compactable && !gapCompact
    && (fullLeftReqs.some((req) => req.title !== undefined) || fullRightReqs.some((req) => req.title !== undefined));
  const compactLeftReqs = gapCompact || cutCompact ? plottedSeries.map((s) => mkEndReq(s, s.a, c0, 'left', true)) : [];
  const rightCap = gapCompact || cutCompact
    ? Math.max(sideCap, frameResult.plot.w - sideMax(compactLeftReqs) - 2 * RAIL_GAP - COMPACT_MIN_GAP)
    : sideCap;
  const compactRightReqs = gapCompact || cutCompact ? plottedSeries.map((s) => mkEndReq(s, s.b, c1, 'right', true, rightCap)) : [];

  // ---- plot rect: annotation/category headroom on top, label margins at sides ----
  const catH = measure('0', catFont).height;
  const hasCagr = (options.annotations ?? []).some((a) => a.kind === 'cagr');
  const cagrEnvelope = hasCagr
    ? measure('0', { ...labelFont, weight: emphasisWeight(theme) }).height + CAGR_ENVELOPE_CLEARANCE
    : 0;
  const topPad = cagrEnvelope + catH + 10;
  const plotY = frameResult.plot.y + topPad;
  const plotH = plotHeightAfter(frameResult, size.height, frameResult.plot.h - topPad);
  // An unpinned wide slope stands its rails about 350 px tall at 960 and
  // 280 px at 720, so the rails can stand MAX_GAP_RATIO times that apart. The canvas grows to it as to a
  // plot floor; a pinned height and a card keep the plot their canvas gives.
  const wantPlotH = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && panelTypeClass(options) === undefined
    && size.width >= WIDE_RAIL_MIN_WIDTH ? Math.round(WIDE_RAIL_BASE + WIDE_RAIL_SHARE * size.width) : 0;
  if (wantPlotH > plotH) {
    frameResult.frame.plotMinHeight = Math.max(frameResult.frame.plotMinHeight ?? 0, Math.ceil(size.height + (frameResult.deficit ?? 0) + wantPlotH - plotH));
  }

  // ---- value scale (direct labels; no zero requirement on a slope) ----
  let lo = valueLineExtent(options.annotations)?.lo ?? Infinity; // a drawn value line is part of the stated range; authored bounds only widen below (valueLineDomain.ts)
  let hi = valueLineExtent(options.annotations)?.hi ?? -Infinity;
  for (const s of plottedSeries) {
    lo = Math.min(lo, s.a.v!, s.b.v!);
    hi = Math.max(hi, s.a.v!, s.b.v!);
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  let dLo: number;
  let dHi: number;
  if (lo === hi) {
    [dLo, dHi] = niceDomain(lo === 0 ? -1 : lo - Math.abs(lo) * 0.1, hi === 0 ? 1 : hi + Math.abs(hi) * 0.1, 4);
  } else {
    const pad = (hi - lo) * 0.06;
    [dLo, dHi] = niceDomain(lo - pad, hi + pad, 5, {
      dataExtent: [lo, hi],
      preserveDataSideOfZero: true,
      // Two-sided domain — waste SUM bounded by the 0.80 envelope floor.
      maxWasteFraction: 0.15,
      maxTotalWasteFraction: 0.2,
    });
  }
  const va = options.valueAxis ?? {};
  [dLo, dHi] = applyAxisBounds([dLo, dHi], [lo, hi], va, warnings);
  const y = linearScale([dLo, dHi], [plotY + plotH, plotY]);
  // ---- end-label seats: which labels a side keeps, before any is placed ----
  // A side that must drop labels drops the lines named elsewhere first: a
  // line in `unnamed` has no name on the other rail and outranks the rest.
  // A highlighted line still ranks first, so the focus keeps both its values.
  const seatSide = (reqs: EndReq[], side: 'left' | 'right', unnamed: ReadonlySet<Id> = new Set()): { kept: EndReq[]; dropped: EndReq[]; pitch: number } => {
    const rank = (r: EndReq): number => r.priority
      + (unnamed.size === 0 ? 0 : highlights.has(r.s.id) ? 2 * NAME_RANK : unnamed.has(r.s.id) ? NAME_RANK : 0);
    let active = reqs.filter((r) => !r.suppressed);
    const desiredOf = (r: EndReq): number => y(side === 'left' ? r.s.a.v! : r.s.b.v!);
    // A side that cannot seat every end label at its pitch takes one type
    // step down when that seats them all: every line keeps its name.
    let pitch = minPitch;
    const height = (rs: EndReq[], p: number): number => rs.reduce((a, r) => a + Math.max(r.h, p), 0) + SPREAD_GAP * Math.max(0, rs.length - 1);
    const step = stepDownFont(theme, labelFont, 'label', options.target, textScaleOf(options));
    if (step && height(active, pitch) > plotH) {
      const small = active.map((r): EndReq => {
        if (r.fontStep) return r;
        const font = { ...endFontOf(r.s), size: step.size };
        const h = measure(r.lines[0] || '0', font).height + (r.lines.length - 1) * lineBox(font);
        return { ...r, fontStep: font, w: Math.max(...r.lines.map((line) => measure(line || '0', font).width)), h };
      });
      const smallPitch = Math.max(END_MIN_PITCH, step.size * (step.lineHeight ?? 1.2));
      if (height(small, smallPitch) <= plotH) { active = small; pitch = smallPitch; }
    }
    // Effective vertical footprint: at least one line height, so the
    // spread pitch never compresses below the pitch even with a tight measurer.
    const effH = (r: EndReq): number => Math.max(r.h, pitch);
    // Readable rhythm: when the side cannot give every label its pitch,
    // sweep-hide the lowest-priority labels
    // (priority encodes |change|; highlights carry +250 and drop last) at
    // their desired rail positions, so survivors keep readable pitch.
    // Dropped series keep their line — their request re-enters below as
    // redundant, which the solver hides deterministically.
    let kept = [...active];
    const dropped: EndReq[] = [];
    if (kept.length * pitch > plotH) {
      const keepFlags = sweepHide(
        kept.map((r) => ({
          start: desiredOf(r) - pitch / 2,
          size: pitch,
          priority: rank(r),
        })),
        0,
      );
      pushAll(dropped, kept.filter((_, i) => !keepFlags[i]));
      kept = kept.filter((_, i) => keepFlags[i]);
    }
    // Overflow guard: drop lowest-priority labels until the side fits the
    // plot height. Highlights drop last (label-drop immunity).
    const needed = () =>
      kept.reduce((a, r) => a + effH(r), 0) + SPREAD_GAP * Math.max(0, kept.length - 1);
    while (kept.length > 1 && needed() > plotH) {
      let worst = 0;
      for (let i = 1; i < kept.length; i++) {
        const a = kept[i]!;
        const b = kept[worst]!;
        if (rank(a) < rank(b) || (rank(a) === rank(b) && a.s.id > b.s.id)) worst = i;
      }
      dropped.push(...kept.splice(worst, 1));
    }
    return { kept, dropped, pitch };
  };
  // Compact names a line on the second rail only, so it pays only when that
  // rail seats every label: a label dropped for density would leave its line
  // unnamed. The two-rail layout then names each line on the rail that keeps it.
  const compact = (gapCompact || cutCompact) && seatSide(compactRightReqs, 'right').dropped.length === 0;
  const leftReqs = compact ? compactLeftReqs : fullLeftReqs;
  const rightReqs = compact ? compactRightReqs : fullRightReqs;
  const leftMax = endContent ? sideMax(leftReqs) : 0;
  const rightMax = endContent ? sideMax(rightReqs) : 0;
  // A label the spread moves far off its point needs a leader a reader can
  // follow: a 40 px shift over a short run draws a near-vertical hairline.
  // The run grows with the side's largest shift, up to 48 px, so a leader
  // leaves its point at 45 degrees or less.
  const railGapOf = (reqs: EndReq[], side: 'left' | 'right'): number => {
    const active = reqs.filter((r) => !r.suppressed);
    if (!endContent || active.length === 0) return RAIL_GAP;
    const desired = active.map((r) => y(side === 'left' ? r.s.a.v! : r.s.b.v!));
    const spread = spread1DResult(active.map((r, i) => ({ desired: desired[i]!, size: Math.max(r.h, minPitch) })), [plotY, plotY + plotH], SPREAD_GAP);
    const shift = Math.max(0, maxOf(spread.positions.map((position, i) => Math.abs(position - desired[i]!))));
    // The leader stops 0.4 line heights short of the text (leaderTerminus).
    return Math.min(48, Math.max(RAIL_GAP, Math.ceil(shift + 0.4 * endLineH + 1)));
  };
  const railGaps = { left: railGapOf(leftReqs, 'left'), right: railGapOf(rightReqs, 'right') };
  let railL = frameResult.plot.x + (leftMax > 0 ? leftMax + railGaps.left : 0);
  let railR = frameResult.plot.x + frameResult.plot.w - (rightMax > 0 ? rightMax + railGaps.right : 0);
  // The gap between the rails is at most
  // MAX_GAP_RATIO times the plot height, so a wide canvas keeps the slopes'
  // angle; the block of labels and rails is centred in the free width.
  const maxGap = MAX_GAP_RATIO * plotH;
  if (railR - railL > maxGap) {
    const spare = railR - railL - maxGap;
    railL += spare / 2;
    railR -= spare / 2;
  }
  const plot: Rect = { x: railL, y: plotY, w: Math.max(10, railR - railL), h: plotH };

  // ---- rails (thin verticals at the plot edges, color.reference or the axis) ----
  const nodes: SceneNode[] = [...frameResult.nodes];
  const railXs: [number, number] = [plot.x, plot.x + plot.w];
  const railCats: [Category, Category] = [c0, c1];
  // Rails are furniture, lighter than the lines, but a reader needs them to
  // read the chart: they hold 3:1 on the page. An authored color.reference draws them as written; the
  // fallback (the axis ink) takes the lightest wash toward the page that keeps
  // 3:1, about #878D93 on the standard ink.
  const railPaint: Paint = theme.color.reference !== undefined ? { token: 'reference' }
    : { token: 'reference', theme: { kind: 'visible-tint', base: { token: 'reference' }, amount: RAIL_WASH, floor: MARK_CONTRAST_FLOOR } };
  railCats.forEach((c, k) => {
    const rx = railXs[k]!;
    nodes.push({
      t: 'line',
      id: `rail:${c.id}`,
      x1: rx,
      y1: plot.y,
      x2: rx,
      y2: plot.y + plot.h,
      stroke: railPaint,
      width: strokeToken(theme, 'rule'),
      owner: { categoryId: c.id },
      part: 'rail',
    });
    occupied.claim({ x: rx - 1, y: plot.y, w: 2, h: plot.h }, 'axis', { categoryId: c.id });
  });

  // ---- marks: one straight line + endpoint dots per series ----
  const marks: SlopeMarks = { series: [] };
  for (const s of plottedSeries) {
    const yA = y(s.a.v!);
    const yB = y(s.b.v!);
    const lineNodeId = `mark:${s.id}`;
    nodes.push({
      t: 'line',
      id: lineNodeId,
      x1: railXs[0],
      y1: yA,
      x2: railXs[1],
      y2: yB,
      stroke: linePaint(s),
      width: lineWidth(s),
      ...(s.scenario === 'FC' ? { dash: dashToken(theme, 'reference') } : {}),
      owner: { seriesId: s.id },
      part: 'slope',
    });
    // claim the diagonal as a run of small rects (honest occupied substrate)
    const w = railXs[1] - railXs[0];
    for (let k = 0; k < LINE_CLAIM_SEGMENTS; k++) {
      const fx0 = k / LINE_CLAIM_SEGMENTS;
      const fx1 = (k + 1) / LINE_CLAIM_SEGMENTS;
      const sy0 = yA + (yB - yA) * fx0;
      const sy1 = yA + (yB - yA) * fx1;
      occupied.claim(
        {
          x: railXs[0] + w * fx0,
          y: Math.min(sy0, sy1) - 1.5,
          w: w * (fx1 - fx0),
          h: Math.abs(sy1 - sy0) + 3,
        },
        'mark',
        { seriesId: s.id },
      );
    }
    // leader dots at the rail points
    ([[railXs[0], yA, c0] as const, [railXs[1], yB, c1] as const]).forEach(([dx, dy, dc]) => {
      const end = dc.id === c0.id ? s.a : s.b;
      nodes.push({
        t: 'circle',
        id: `dot:${s.id}:${dc.id}`,
        cx: dx,
        cy: dy,
        r: 2.5,
        fill: linePaint(s),
        owner: { seriesId: s.id, categoryId: dc.id },
        part: 'endpointDot',
        display: { value: fmtVal(end.v!, end.isPct, end.format ?? s.format ?? options.format, s) },
      });
      occupied.claim({ x: dx - 2.5, y: dy - 2.5, w: 5, h: 5 }, 'mark', {
        seriesId: s.id,
        categoryId: dc.id,
      });
    });
    marks.series.push({
      seriesId: s.id,
      lineNodeId,
      from: { x: railXs[0], y: yA },
      to: { x: railXs[1], y: yB },
    });
  }

  // ---- end labels: overflow-drop by priority, then spread1D per side ----
  const labelRequests: LabelRequest[] = [];
  const planSide = (reqs: EndReq[], side: 'left' | 'right', unnamed?: ReadonlySet<Id>): EndReq[] => {
    if (!endContent) return [];
    const railX = side === 'left' ? railXs[0] : railXs[1];
    const cat = side === 'left' ? c0 : c1;
    const desiredOf = (r: EndReq): number => y(side === 'left' ? r.s.a.v! : r.s.b.v!);
    const { kept, dropped, pitch } = seatSide(reqs, side, unnamed);
    const effH = (r: EndReq): number => Math.max(r.h, pitch);
    const spread = spread1DResult(
      kept.map((r) => ({ desired: desiredOf(r), size: effH(r) })),
      [plot.y, plot.y + plot.h],
      SPREAD_GAP,
    );
    warnSpreadOverflow(warnings, spread.fits, `${side} endpoint labels exceed the plot height even after spreading — labels stay bounded but overlap; reduce series or enlarge the canvas`);
    const centers = spread.positions;
    const slot = side === 'left' ? 'railLeft' : 'railRight';
    const rectFor = (r: EndReq, centerY: number): Rect => ({
      x: side === 'left' ? railX - railGaps.left - r.w : railX + railGaps.right,
      y: centerY - r.h / 2,
      w: r.w,
      h: r.h,
    });
    kept.forEach((r, i) => {
      labelRequests.push({
        id: `series:${r.s.id}:${cat.id}`,
        kind: 'series',
        owner: { seriesId: r.s.id, categoryId: cat.id },
        text: r.text,
        lines: r.lines,
        ...(r.title !== undefined ? { title: r.title } : {}),
        ...(r.fontStep ? { fontStep: r.fontStep } : {}),
        font: endFontOf(r.s),
        priority: r.priority,
        // Spread boxes may touch (SPREAD_GAP), so the solver pads them by 0.
        pad: -TOUCH_TOLERANCE,
        candidates: [{
          slot,
          rect: rectFor(r, centers[i]!),
          penalty: 0,
          // Moved off its point: a leader from the rail point to the label.
          ...(Math.abs(centers[i]! - desiredOf(r)) > 0.5 ? { leaderFrom: { x: railX, y: desiredOf(r) } } : {}),
        }],
      });
    });
    for (const r of [...dropped, ...reqs.filter((x) => x.suppressed)]) {
      const desired = desiredOf(r);
      labelRequests.push({
        id: `series:${r.s.id}:${cat.id}`,
        kind: 'series',
        owner: { seriesId: r.s.id, categoryId: cat.id },
        text: r.text,
        lines: [r.text],
        font: endFontOf(r.s),
        priority: r.priority,
        redundant: true,
        // Dropped because the side could not give every end label readable
        // pitch — NOT because the name appears elsewhere. Publishing this as
        // 'redundant' told a reader the omission was free when it was not.
        suppressedAs: 'density' as const,
        candidates: [{ slot, rect: rectFor(r, desired), penalty: 0 }],
      });
    }
    return kept;
  };
  const leftKept = planSide(leftReqs, 'left');
  // The second rail first keeps the lines that the first rail leaves without
  // a name, so every line keeps its name on one rail while the rails have room.
  const leftNamed = new Set(compact || !endContent?.includes('series') ? [] : leftKept.map((r) => r.s.id));
  planSide(rightReqs, 'right', compact || !endContent?.includes('series') ? undefined
    : new Set(plottedSeries.filter((s) => !leftNamed.has(s.id)).map((s) => s.id)));

  // ---- category labels above the rails (bold-ish) ----
  let catLabelsShown = false;
  if (kindSetting('category') !== false) {
    catLabelsShown = true;
    railCats.forEach((c, k) => {
      const rx = railXs[k]!;
      const text = markedLabel(c.label ?? c.id, c.footnote, c.id, { count: authoredFootnoteCount(options), warnings });
      const tsize = measure(text, catFont);
      const cy = plot.y - catH - 6;
      const centeredX = clamp(rx - tsize.width / 2, 2, size.width - tsize.width - 2);
      const inwardX = k === 0 ? rx + 4 : rx - tsize.width - 4;
      labelRequests.push({
        id: `category:${c.id}`,
        kind: 'category',
        owner: { categoryId: c.id },
        text,
        lines: [text],
        font: catFont,
        priority: PRIORITY.endpoint,
        candidates: [
          { slot: 'aboveRail', rect: { x: centeredX, y: cy, w: tsize.width, h: catH }, penalty: 0 },
          { slot: 'aboveRailInward', rect: { x: inwardX, y: cy, w: tsize.width, h: catH }, penalty: 1 },
        ],
      });
    });
  }

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    density,
    measure,
    plot,
    labelPad: 2,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);

  // ---- annotations: {seriesId, categoryId} → endpoint ----
  const plottedById = new Map(plottedSeries.map((s) => [s.id, s] as const));
  const endpointOf = (sid: Id, cid: Id): AnchorResolution | null => {
    const s = plottedById.get(sid);
    if (!s) return null;
    const k = cid === c0.id ? 0 : cid === c1.id ? 1 : -1;
    if (k === -1) return null;
    const v = k === 0 ? s.a.v! : s.b.v!;
    const cat = k === 0 ? c0 : c1;
    return {
      x: railXs[k]!,
      y: y(v),
      value: v,
      format: s.format,
      date: cat.date,
      owner: { seriesId: sid, categoryId: cat.id },
    };
  };
  const resolveAnchor = (ref: AnchorRef): AnchorResolution | null => {
    if (typeof ref === 'string') {
      // bare id prefers the category (rail) reading — resolved to the
      // first data series at that rail; otherwise it names a series end.
      if (ref === c0.id || ref === c1.id) {
        const sid = plottedSeries[0]?.id;
        return sid ? endpointOf(sid, ref) : null;
      }
      return endpointOf(ref, c1.id);
    }
    if ('categoryId' in ref && ref.seriesId) return endpointOf(ref.seriesId, ref.categoryId);
    if ('categoryId' in ref) {
      const sid = plottedSeries[0]?.id;
      return sid ? endpointOf(sid, ref.categoryId) : null;
    }
    return null;
  };
  const annResult = runAnnotatePass({
    annotations: options.annotations ?? [],
    resolve: resolveAnchor,
    defaultSpan:
      plottedSeries.length === 1
        ? {
            from: { categoryId: c0.id, seriesId: plottedSeries[0]!.id },
            to: { categoryId: c1.id, seriesId: plottedSeries[0]!.id },
          }
        : undefined,
    occupied,
    plot,
    // Annotation labels draw bold (see labelsToNodes below), so the pass measures them bold.
    theme: emphasisLabelTheme(theme),
    plainLabelWeight: theme.type.label.weight,
    measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    valueLinePercentLevels: options.unit === '%' || percentLevels(plottedSeries.map(series => ({ vals: [series.a, series.b] }))),
    solveCtx,
    yScale: y,
  });
  pushAll(warnings, annResult.warnings);

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];

  const legendNames = legendInput !== undefined && frameResult.legend !== undefined
    ? legendInput.items.map((item) => item.id) : [];
  pushAll(warnings, unnamedSeriesWarnings(seriesNorm, allLabels, legendNames));

  pushAll(nodes, annResult.nodes);
  pushAll(
    nodes,
    labelsToNodes(theme, allLabels, (l) =>
      l.kind === 'category'
        ? catFont
        : l.kind === 'annotation' || l.kind === 'valueLine'
          ? { ...labelFont, weight: emphasisWeight(theme) }
          : highlights.has(l.owner.seriesId ?? '')
            ? hlFont
            : labelFont,
    ),
    // Every leader keeps the thin neutral leader paint; a leader in the
    // highlight colour reads as a hook in its line.
  );

  const axes: AxisGeometry[] = [
    {
      axis: 'x',
      ticks: railCats.map((c, k) => ({
        at: c.id,
        pos: railXs[k]!,
        labelId: catLabelsShown ? `category:${c.id}` : undefined,
      })),
    },
  ];

  // ---- a11y: name the steepest changes ----
  const changeText = (sid: Id): string => {
    const s = plottedById.get(sid)!;
    const ch = changes[sid]!;
    const pctPart = ch.pct !== null ? ` (${formatAutomaticPercent(ch.pct, 1, true, options.locale?.language)})` : '';
    return `${s.label} ${formatAutomaticNumber(ch.abs, { locale: options.locale?.language, signed: true, decimals: autoDecimals(ch.abs) })}${pctPart}`;
  };
  const steepParts: string[] = [];
  if (steepestUp) steepParts.push(chartString(options, 'steepestRiser', { v1: changeText(steepestUp) }));
  if (steepestDown) steepParts.push(chartString(options, 'steepestFaller', { v1: changeText(steepestDown) }));
  const a11yDesc =
    chartString(options, 'slopeDesc', { v1: plottedSeries.length, v2: c0.label ?? c0.id, v3: c1.label ?? c1.id }) +
    (steepParts.length ? `${steepParts.join('; ')}.` : chartString(options, 'seriesUnchanged')) +
    (fold ? ` ${fold.record.note}` : '');

  const derived: SlopeDerived = {
    changes,
    ...(steepestUp !== undefined ? { steepestUp } : {}),
    ...(steepestDown !== undefined ? { steepestDown } : {}),
    ...(fold ? { folded: fold.record } : {}),
  };

  return {
    type: 'slope',
    size,
    plot,
    scene: nodes,
    labels: allLabels,
    axes,
    annotations: annResult.placed,
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived,
    a11y: {
      title:
        accessibleTitle(options.title, chartString(options, 'slopeTitle', { v1: plottedSeries.length, v2: c0.label ?? c0.id, v3: c1.label ?? c1.id })),
      counts: [structureCount('series', plottedSeries.length, undefined, options), ...(fold ? [structureCount('series', fold.record.memberIds.length, undefined, options)] : [])],
      desc: a11yDesc,
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annResult.decisions],
    },
  };
}

/**
 * A SERIES NAMED NOWHERE IS A SILENT LOSS.
 *
 * When a side cannot give every end label readable pitch, the lowest-priority
 * requests are re-entered with `redundant: true` — and the solver's
 * `redundant` branch, unlike its `collision` branch, emits NO warning. On
 * `slope/dense-20-series` that hid BOTH endpoint labels of seven of the
 * twenty branches (Cologne, Frankfurt, Düsseldorf, Dortmund, Nuremberg,
 * Bochum, Bielefeld), with no legend and no other identity cue, and
 * `geometry.warnings` came back EMPTY: `boardplot validate` and `boardplot
 * render` both exited 0 on an exhibit with seven anonymous lines. The
 * suppression reason is also untrue — nothing about those labels is
 * redundant; they were dropped for density.
 *
 * The lint is stated in the only terms that matter to a reader: the series
 * has no name anywhere on the canvas. It is not a label-placement lint, so a
 * legend key or a visible endpoint on either rail satisfies it. A series the
 * fold merged into 'Other' is not in `series` here: the footnote names it.
 */
function unnamedSeriesWarnings(
  series: readonly NormSer[],
  labels: readonly PlacedLabel[],
  legendNames: readonly Id[],
): LintWarning[] {
  const named = new Set<string>(legendNames);
  for (const label of labels) {
    if (label.hidden) continue;
    if (label.owner.seriesId !== undefined) named.add(label.owner.seriesId);
  }
  const anonymous = series.filter((s) => !named.has(s.id));
  if (anonymous.length === 0) return [];
  return [{
    code: 'series-unnamed',
    severity: 'warn',
    message:
      `${anonymous.length} of ${series.length} series are named nowhere on the canvas ` +
      `(${anonymous.map((s) => s.label).join(', ')}): both endpoint labels were suppressed ` +
      'and there is no legend',
    suggest:
      "add `legend` so every line keeps an identity, increase the chart height, or reduce the number of series",
  }];
}

/** One end label on a rail, measured before the rails are placed. */
interface EndReq {
  s: NormSer;
  text: string;
  w: number;
  h: number;
  priority: number;
  suppressed: boolean; // label:false override
  /** Full composite when the name was cut; the node's `<title>`. */
  title?: string;
  /** One type step down when that saved the name. */
  fontStep?: FontSpec;
  /** Drawn lines: the composite, or its two-line wrap. */
  lines: string[];
}

/**
 * The end-label steps before any cut: the composite on one line,
 * wrapped to two when the rail has the height, then one type step down on
 * one line and on two. `size.width` stays over `maxSideW` when none fits,
 * and the caller then cuts the name.
 */
function fitEndLabel(
  text: string,
  font: FontSpec,
  opts: { maxSideW: number; wrapRoom: boolean; shrink?: FontSpec; target?: RenderTarget; measure: TextMeasurer },
): { font: FontSpec; lines: string[]; size: { width: number; height: number } } {
  const { measure } = opts;
  const one = measure(text || '0', font);
  if (one.width <= opts.maxSideW) return { font, lines: [text], size: one };
  const fonts = opts.shrink && opts.shrink.size < font.size ? [font, opts.shrink] : [font];
  for (const candidate of fonts) {
    const single = measure(text || '0', candidate);
    if (single.width <= opts.maxSideW) return { font: candidate, lines: [text], size: single };
    if (!opts.wrapRoom) continue;
    const wrapped = fitText(text, candidate, opts.maxSideW, 2, measure, { target: opts.target, typeRole: 'label' });
    if (wrapped.title === undefined) {
      const height = measure(wrapped.lines[0] ?? '0', candidate).height + (wrapped.lines.length - 1) * lineBox(candidate);
      return { font: candidate, lines: wrapped.lines, size: { width: wrapped.w, height } };
    }
  }
  // The name is cut next; at the smaller step, when allowed, more of it stays.
  const cutFont = fonts[fonts.length - 1]!;
  return { font: cutFont, lines: [text], size: cutFont === font ? one : measure(text || '0', cutFont) };
}
