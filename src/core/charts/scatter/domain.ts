import { chartString } from '../../strings/scatter';
/**
 * Scatter phase 1: options and data in, the plotted points and both
 * axis domains out. Nothing here knows a pixel.
 */

import { breakUnsupported, chartPalette, chartTheme } from '../chartEnv';
import { defaultMeasurer } from '../../text';
import { numericViewportRange } from '../../viewport';
import { formatAutomaticNumber, numberRange } from '../../format';
import {
  MAGNITUDE_DIVISOR,
  exampleSpec,
  formatWithSpec,
  formatterFromExample,
  neededDecimals,
  roundedNumber,
  seriesRasterFormatter,
  type NumberFormatSpec,
} from '../../formatSpec';
import { autoDecimals } from '../../formatPrecision';
import {
  NormalizeError,
  normalizeCell,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { applyAxisBounds, niceDomain } from '../../scale';
import type { Annotation } from '../../types/annotations';
import type { Id } from '../../types/cell';
import { cellMeta, cellValue, isDateCell, isPctCell } from '../../types/cell';
import type { ScatterData, ScatterPoint } from '../../types/data';
import type { LintWarning } from '../../types/scene';
import {
  applyMinCount,
  clampSeed,
  planScatterClamp,
  refuseClampedQuadrants,
  refuseClampedRegions,
  refuseClampedValueLines,
  type ScatterClampPlan,
} from './clamp';
import type { Disclosed, NormGroup, NormPt, ScatterDomain, ScatterEnv } from './model';
import { logAxesOf, logDomain, refuseNonPositiveOnLog, type LogAxes } from './logAxis';
import { deriveQuadrants } from './quadrants';
import { planFrontier } from './frontier';
import { fitScatterTrends } from './trend';
import type { ScatterStrategyOptions } from './types';
import {
  drawnValueLines,
  refuseValueLinesOutsideAxis,
  valueLinesInView,
  withValueLines,
  type DrawnValueLine,
} from './valueLines';
import { validateStrategyZones } from './zones';
import { disclosureNote } from '../../notes';

function scatterFormatter(options: ScatterStrategyOptions, format = options.format): (value: number) => string {
  // Business default: whole numbers get 0 decimals; small non-integers keep
  // one, so a 0.4 coordinate never prints as "0". (column/waterfall pattern)
  // A log axis spreads the values under 1 over whole decades, where one
  // decimal would print 0.45 as 0.5, left of the 0.5 tick: there a value
  // under 1 keeps two significant digits.
  const decimalsOf = options.valueAxis?.log
    ? (v: number) => (v !== 0 && Math.abs(v) < 1 ? Math.max(1, neededDecimals(v, 1 - Math.floor(Math.log10(Math.abs(v))))) : autoDecimals(v))
    : autoDecimals;
  const formatValue = format
    ? formatterFromExample(format, options.locale?.language)
    : (v: number) => formatAutomaticNumber(v, { locale: options.locale?.language, decimals: decimalsOf(v) });
  // Repeated coordinates and sizes share their display text within this layout.
  // Keep the cache local so later requests, locales and formats stay independent.
  const formattedValues = new Map<number, string>();
  return (value: number): string => {
    let text = formattedValues.get(value);
    if (text === undefined) {
      text = formatValue(value);
      formattedValues.set(value, text);
    }
    return text;
  };
}

/** Doubles need at most ~17 significant digits; 20 fractional digits is the
 *  practical ceiling at which `toFixed` still round-trips. */
const MAX_DISCLOSED_DECIMALS = 20;

/**
 * A number with no unit: grouped digits and nothing else. The cut points use it
 * when the chart has no authored format, and `minCount` always does, because a
 * count of observations carries neither the axis unit nor its magnitude.
 */
function plainNumberSpec(locale: string | undefined): NumberFormatSpec {
  return {
    decimals: 0,
    locale,
    thousandsSep: ',',
    decimalSep: '.',
    magnitude: 'none',
    prefix: '',
    suffix: '',
    negative: 'minus',
    signed: false,
  };
}

/**
 * Print a boundary so the printed number denotes the applied one exactly, and
 * hand the applied value back with it. Used by the quadrant cut points and by
 * the outlier clamp: printed and applied are one value produced once, not two
 * paths that happen to agree.
 *
 * Sub-representable magnitudes (1e-30 under a plain spec) cannot be printed
 * exactly at any decimal count. Escalating buys nothing there, so the text falls
 * back to the chart's own precision and `exact` is false. The caller then has
 * to apply the number that is printed and say so out loud, which is what the
 * quadrant path's `quadrant-threshold-unprintable` does.
 */
function discloseNumber(raw: number, spec: NumberFormatSpec, authoredFormat: boolean): Disclosed {
  const scaled = Math.abs(raw / MAGNITUDE_DIVISOR[spec.magnitude]);
  const base = authoredFormat ? spec.decimals : autoDecimals(raw);
  let decimals = base;
  while (decimals < MAX_DISCLOSED_DECIMALS && Number(scaled.toFixed(decimals)) !== scaled) {
    decimals += 1;
  }
  const exact = Number(scaled.toFixed(decimals)) === scaled;
  const applied = { ...spec, decimals: exact ? decimals : base };
  const value = exact ? raw : roundedNumber(raw, applied);
  return { value, text: formatWithSpec(value, applied), exact };
}

/**
 * The engine scale of one axis without a format, as bar takes it
 * (seriesRasterFormatter): from a million on a render target, else none.
 */
function engineAxisScale(options: ScatterStrategyOptions, format: string | undefined, data: ScatterData | undefined, axis: 'x' | 'y'): ReturnType<typeof seriesRasterFormatter> | undefined {
  if (format || options.target === undefined || !Array.isArray(data?.points)) return undefined;
  const values: number[] = [];
  for (const point of data.points) {
    const raw: unknown = point?.[axis];
    const value = typeof raw === 'number' ? raw : raw !== null && typeof raw === 'object' && 'number' in raw ? Number((raw as { number: unknown }).number) : NaN;
    if (Number.isFinite(value)) values.push(value);
  }
  if (!values.some((value) => Math.abs(value) >= 1e6)) return undefined;
  const engine = seriesRasterFormatter(undefined, values, options.locale?.language, options.unit, options.target);
  return engine.spec.autoMagnitude ? engine : undefined;
}

/** Resolve the options once: theme, palette, size, measurer and the number formats. */
export function resolveScatterEnv(options: ScatterStrategyOptions, warnings: LintWarning[], data?: ScatterData): ScatterEnv {
  if (options.zones && options.quadrants) {
    throw new NormalizeError(
      'zones-quadrants-conflict',
      'options.zones',
      'scatter strategy zones and quadrants are mutually exclusive',
    );
  }
  breakUnsupported('scatter', options, warnings);
  const theme = chartTheme(options);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const fmt = scatterFormatter(options);
  // Each coordinate prints in its own axis format (axisFormat), else the chart's.
  const axisFormat = { x: options.axisFormat?.x ?? options.format, y: options.axisFormat?.y ?? options.format };
  // An axis without a format takes the engine scale bar takes from a
  // million, chosen once per axis from its largest value: ticks and
  // coordinates print 2.0B and 500M, not 2,000,000,000.
  const engine = { x: engineAxisScale(options, axisFormat.x, data, 'x'), y: engineAxisScale(options, axisFormat.y, data, 'y') };
  const axisFmt = {
    x: options.axisFormat?.x ? scatterFormatter(options, axisFormat.x) : engine.x?.fmt ?? fmt,
    y: options.axisFormat?.y ? scatterFormatter(options, axisFormat.y) : engine.y?.fmt ?? fmt,
  };
  // A chart formatter is a DISPLAY convention; a cut point is a BOUNDARY. Run
  // a boundary through the display formatter and the exhibit states a
  // threshold the classifier never used — a reader can then take the printed
  // number, apply it to a plotted point, and prove that point is filed in a
  // box it does not belong to. So the cut-point disclosure escalates decimals
  // until the printed number denotes the applied one exactly, and the applied
  // value is taken back FROM that disclosure (`disclosed.value`): printed and
  // applied are one value produced once, not two paths that happen to agree.
  const countSpec = plainNumberSpec(options.locale?.language);
  // The same spec prints the axis's ticks: an axis with no example ran each
  // tick through autoDecimals on its own and printed "1.0", "1", "1.1" at
  // 0.95, 1 and 1.05.
  // An authored example prints as the marks print it: the chart locale's separators, the authored word.
  const axisSpecOf = (format: string | undefined, scaled: NumberFormatSpec | undefined): NumberFormatSpec => (format ? exampleSpec(format, options.locale?.language) : scaled ?? countSpec);
  const axisSpec = { x: axisSpecOf(axisFormat.x, engine.x?.spec), y: axisSpecOf(axisFormat.y, engine.y?.spec) };
  // A cut point on a scaled axis prints at its own scale with every digit it needs ("452.345678M").
  const cutSpec = (raw: number, axis: 'x' | 'y'): NumberFormatSpec => {
    if (!engine[axis]) return axisSpec[axis];
    let magnitude: NumberFormatSpec['magnitude'] = 'none';
    for (const step of ['k', 'm', 'bn', 't'] as const) if (Math.abs(raw) >= MAGNITUDE_DIVISOR[step]) magnitude = step;
    return { ...countSpec, magnitude, rollMagnitude: false };
  };
  return {
    options,
    theme,
    palette: paletteRamp ? options.palette : undefined,
    size,
    measure,
    fmt,
    axisFmt,
    axisSpec,
    discloseCut: (raw: number, axis: 'x' | 'y') => discloseNumber(raw, cutSpec(raw, axis), axisFormat[axis] !== undefined),
    discloseCount: (raw: number) => discloseNumber(raw, countSpec, false),
    highlights: new Set(resolveHighlight(options.highlight)),
    va: options.valueAxis ?? {},
    log: logAxesOf(options.valueAxis?.log),
  };
}

function normalizePoint(
  raw: ScatterPoint,
  i: number,
  seenIds: Set<Id>,
  groupMap: Map<Id, NormGroup>,
  warnings: LintWarning[],
  hasAuthoredLabels: boolean,
): NormPt | null {
  if (!raw?.id) throw new NormalizeError('missing-id', `points[${i}]`, 'point requires an id');
  if (seenIds.has(raw.id)) {
    throw new NormalizeError('duplicate-id', `points[${raw.id}]`, `duplicate point id '${raw.id}'`);
  }
  seenIds.add(raw.id);
  const path = `points[${raw.id}]`;
  const xCell = normalizeCell(raw.x, `${path}.x`);
  const yCell = normalizeCell(raw.y, `${path}.y`);
  if ((xCell !== null && isDateCell(xCell)) || (yCell !== null && isDateCell(yCell))) {
    warnings.push({
      code: 'date-axis-unsupported',
      severity: 'warn',
      message: `point '${raw.id}': date cells on scatter axes are not supported in v1 — point dropped`,
      owner: { pointId: raw.id },
    });
    return null;
  }
  // A shared cell accepts `label`, but a scatter coordinate has no label of
  // its own — the drawn name is `points[].label`. The field is reported, not
  // dropped in silence.
  for (const [axis, cell] of [['x', xCell], ['y', yCell]] as const) {
    if (cellMeta(cell)?.label !== undefined) {
      warnings.push({
        code: 'cell-label-unsupported',
        severity: 'warn',
        message: `point '${raw.id}': ${axis}.label is ignored — a scatter point's drawn label is points[].label`,
        owner: { pointId: raw.id },
        suggest: `set label on the point itself: { id: '${raw.id}', label: '…', ${axis}: … }`,
      });
    }
  }
  const xv = cellValue(xCell);
  const yv = cellValue(yCell);
  if (xv === null || yv === null) {
    warnings.push({
      code: 'missing-value',
      severity: 'info',
      message: `point '${raw.id}': missing x or y — point dropped`,
      owner: { pointId: raw.id },
    });
    return null;
  }
  if (raw.group !== undefined && !groupMap.has(raw.group)) {
    // implicit group: declared groups keep their ramp slots, implicit ones follow
    groupMap.set(raw.group, { id: raw.group, label: raw.group, idx: groupMap.size });
  }
  let sizeVal: number | null = raw.size ?? null;
  if (sizeVal !== null && (!Number.isFinite(sizeVal) || sizeVal < 0)) {
    warnings.push({
      code: 'size-invalid',
      severity: 'warn',
      message: `point '${raw.id}': size ${sizeVal} is not a non-negative number — treated as 0`,
      owner: { pointId: raw.id },
    });
    sizeVal = 0;
  }
  const sizeInvalid = raw.size !== undefined && raw.size !== null && (!Number.isFinite(raw.size) || raw.size < 0);
  const group = raw.group !== undefined ? groupMap.get(raw.group) : undefined;
  return {
    id: raw.id,
    group: raw.group,
    label: raw.label ?? (hasAuthoredLabels ? '' : raw.id),
    x: xv,
    y: yv,
    ...(isPctCell(yCell) ? { yIsPct: true as const } : {}),
    size: sizeVal,
    ...(sizeInvalid ? { sizeInvalid: true } : {}),
    fill: raw.fill,
    marker: raw.marker ?? group?.marker ?? 'circle',
    scenario: normalizeScenario(raw.scenario, `${path}.scenario`),
    count: raw.count ?? null,
    idx: i,
  };
}

/** Declared groups first, then the points; a point without x or y is dropped out loud. */
function normalizeScatterData(
  data: ScatterData,
  warnings: LintWarning[],
): { groupMap: Map<Id, NormGroup>; plottable: NormPt[]; noPosition: string[] } {
  if (!data || !Array.isArray(data.points) || data.points.length === 0) {
    throw new NormalizeError('empty-data', 'points', 'scatter requires at least one point');
  }
  const groupMap = new Map<Id, NormGroup>();
  (data.groups ?? []).forEach((g, i) => {
    if (!g?.id) throw new NormalizeError('missing-id', `groups[${i}]`, 'group requires an id');
    if (groupMap.has(g.id)) {
      throw new NormalizeError('duplicate-id', `groups[${g.id}]`, `duplicate group id '${g.id}'`);
    }
    groupMap.set(g.id, {
      id: g.id,
      label: g.label ?? g.id,
      colorRole: g.colorRole,
      marker: g.marker,
      idx: groupMap.size,
    });
  });

  const seenIds = new Set<Id>();
  const plottable: NormPt[] = [];
  const hasAuthoredLabels = data.points.some(point => typeof point?.label === 'string');
  // Points with no x or y draw nothing; they are named on the chart (ScatterDomain.omitted).
  const noPosition: string[] = [];
  data.points.forEach((raw, i) => {
    const p = normalizePoint(raw, i, seenIds, groupMap, warnings, hasAuthoredLabels);
    if (p) plottable.push(p);
    else if (raw?.id !== undefined && (cellValue(normalizeCell(raw.x, `points[${raw.id}].x`)) === null || cellValue(normalizeCell(raw.y, `points[${raw.id}].y`)) === null)) noPosition.push(raw.label ?? raw.id);
  });
  if (plottable.length === 0) {
    throw new NormalizeError('empty-data', 'points', 'scatter has no plottable points (all x/y missing)');
  }
  // With groups declared, a group a point names but the list lacks is most
  // likely a typo: it still gets its own legend entry, named by its id.
  const declared = new Set((data.groups ?? []).map((g) => g.id));
  const undeclared = [...groupMap.keys()].filter((id) => !declared.has(id));
  if (declared.size > 0 && undeclared.length > 0) {
    warnings.push({
      code: 'group-undeclared',
      severity: 'warn',
      message: `points name group${undeclared.length === 1 ? '' : 's'} ${undeclared.map((id) => `'${id}'`).join(', ')} missing from data.groups; each is keyed under its id`,
      suggest: 'declare the group in data.groups, or correct the point\'s group id',
    });
  }
  return { groupMap, plottable, noPosition };
}

function pointExtents(pts: NormPt[]) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of pts) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  return { xMin, xMax, yMin, yMax };
}

interface AxisDomainInput {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  bubbleMode: boolean;
  clamp: ScatterClampPlan | undefined;
  valueLines: DrawnValueLine[];
}

/** Niced, padded domains for both axes, then the authored bounds, view window and clamp edges. */
function scatterAxisDomain(
  input: AxisDomainInput,
  env: ScatterEnv,
  warnings: LintWarning[],
): { dx: [number, number]; dy: [number, number]; annotations: Annotation[]; ticks?: { x: number[]; y: number[] }; evenGrid?: { x: boolean; y: boolean } } {
  const { options, va } = env;
  const fmt = env.axisFmt.y;
  const { clamp, valueLines } = input;
  // Niced domains with padding; includeZero NOT forced (position encoding).
  // Authored polygon vertices are geometry, not decoration: include their full
  // data-space extent so a region is never silently clipped at the plot edge.
  let domainXMin = input.xMin;
  let domainXMax = input.xMax;
  let domainYMin = input.yMin;
  let domainYMax = input.yMax;
  if (options.zones?.regions) {
    for (const region of options.zones.regions) {
      for (const point of region.points) {
        domainXMin = Math.min(domainXMin, point.x);
        domainXMax = Math.max(domainXMax, point.x);
        domainYMin = Math.min(domainYMin, point.y);
        domainYMax = Math.max(domainYMax, point.y);
      }
    }
  }
  const padFrac = input.bubbleMode ? 0.08 : 0.05;
  const padOf = (lo: number, hi: number) => {
    const span = hi - lo;
    if (span > 0) return span * padFrac;
    return Math.abs(hi) > 0 ? Math.abs(hi) * padFrac : 1;
  };
  // The margin an authored valueAxis.min/max keeps around the points. It is
  // sized before the value lines join the seed: a line far below the points
  // must not widen an authored max past a line just above it.
  const pyBound = padOf(...clampSeed(clamp, 'y', domainYMin, domainYMax));
  [domainYMin, domainYMax] = withValueLines(valueLines, domainYMin, domainYMax);
  // A clamp caps what the plot shows, so the domain is sized on the capped
  // values; the edge itself is pinned below, once it is known that a point is
  // actually beyond it.
  [domainXMin, domainXMax] = clampSeed(clamp, 'x', domainXMin, domainXMax);
  [domainYMin, domainYMax] = clampSeed(clamp, 'y', domainYMin, domainYMax);
  const px = padOf(domainXMin, domainXMax);
  const py = padOf(domainYMin, domainYMax);
  // Both scatter domains are TWO-SIDED — no
  // zero anchor pins an edge — so the SUM of the two wastes is bounded by the
  // norm floors: x span floor 0.85 ⇒ total ≤ 0.15; vertical envelope floor
  // 0.80 ⇒ total ≤ 0.20. Per-side keeps the 0.15 headroom cap.
  // A log axis ends on round numbers past the data instead (logDomain).
  let [dxLo, dxHi] = env.log.x ? logDomain(domainXMin, domainXMax) : niceDomain(domainXMin - px, domainXMax + px, 5, {
    dataExtent: [domainXMin, domainXMax],
    preserveDataSideOfZero: true,
    maxWasteFraction: 0.15,
    maxTotalWasteFraction: 0.15,
  });
  let [dyLo, dyHi] = env.log.y ? logDomain(domainYMin, domainYMax) : niceDomain(domainYMin - py, domainYMax + py, 5, {
    dataExtent: [domainYMin, domainYMax],
    preserveDataSideOfZero: true,
    maxWasteFraction: 0.15,
    maxTotalWasteFraction: 0.2,
  });
  // user min/max apply to the y axis and may never clip data; a linear
  // margin below the data could reach zero on a log axis, so that one stops at the data.
  [dyLo, dyHi] = applyAxisBounds([dyLo, dyHi], [env.log.y ? input.yMin : input.yMin - pyBound, env.log.y ? input.yMax : input.yMax + pyBound], va, warnings);
  if (va.includeZero) {
    dyLo = Math.min(dyLo, 0);
    dyHi = Math.max(dyHi, 0);
  }
  // A plain dot scatter reads positions off its axes: both
  // domains end on a labelled tick, with at least five steps between the ends.
  let ticks: { x: number[]; y: number[] } | undefined;
  let evenGrid: { x: boolean; y: boolean } | undefined;
  if (plainDotAxes(input, env)) {
    const ax = tickAlignedAxis(domainXMin, domainXMax);
    const ay = tickAlignedAxis(va.includeZero ? Math.min(domainYMin, 0) : domainYMin, va.includeZero ? Math.max(domainYMax, 0) : domainYMax);
    if (ax && ay) {
      [dxLo, dxHi] = ax.domain;
      [dyLo, dyHi] = ay.domain;
      ticks = { x: ax.ticks, y: ay.ticks };
    }
  } else if (gridAxes(input, env)) {
    // An evenly cut strategy grid draws equal cells: the
    // axis runs one cut step past the outer cuts, as far as the data allow.
    const grid = options.zones!.grid!;
    const ex = evenGridDomain(grid.x, input.xMin, input.xMax);
    const ey = evenGridDomain(grid.y, input.yMin, input.yMax);
    if (ex) [dxLo, dxHi] = ex;
    if (ey) [dyLo, dyHi] = ey;
    evenGrid = { x: ex !== undefined, y: ey !== undefined };
  } else if (quadrantAxes(input, env)) {
    // A 2x2 reads box sizes off its axes: a side of
    // zero close to the data starts the axis at zero, and both axes end on a
    // labelled tick, with bubble room past the outermost points.
    const pad = input.bubbleMode ? BUBBLE_TICK_END_PAD : TICK_END_PAD;
    const from = (lo: number, hi: number) => (lo >= 0 && lo < ZERO_START_SHARE * hi ? 0 : lo);
    const ax = tickAlignedAxis(from(domainXMin, domainXMax), domainXMax, pad);
    const ay = tickAlignedAxis(from(domainYMin, domainYMax), domainYMax, pad);
    if (ax && ay) {
      [dxLo, dxHi] = ax.domain;
      [dyLo, dyHi] = ay.domain;
      ticks = { x: ax.ticks, y: ay.ticks };
    }
  }
  [dxLo, dxHi] = numericViewportRange(options.viewDomain?.x, [dxLo, dxHi]);
  [dyLo, dyHi] = numericViewportRange(options.viewDomain?.y, [dyLo, dyHi]);
  // The axis ends ON the clamp, so a clipped point lands exactly on the edge
  // and the footnote's number is a line the reader can find.
  if (clamp?.edges.x.min !== undefined) dxLo = clamp.edges.x.min;
  if (clamp?.edges.x.max !== undefined) dxHi = clamp.edges.x.max;
  if (clamp?.edges.y.min !== undefined) dyLo = clamp.edges.y.min;
  if (clamp?.edges.y.max !== undefined) dyHi = clamp.edges.y.max;
  const viewY = options.viewDomain?.y ? ([dyLo, dyHi] as [number, number]) : undefined;
  refuseValueLinesOutsideAxis(valueLines, [dyLo, dyHi], viewY ? {} : { min: va.min, max: va.max }, fmt);
  const annotations = valueLinesInView(options.annotations, valueLines, viewY, warnings, fmt);
  return { dx: [dxLo, dxHi], dy: [dyLo, dyHi], annotations, ...(ticks ? { ticks } : {}), ...(evenGrid ? { evenGrid } : {}) };
}

/**
 * A scatter of plain dots on two linear axes that no author bound, window,
 * clamp, zone or quadrant pins. Only such an axis is free to end on its ticks.
 */
function plainDotAxes(input: AxisDomainInput, env: ScatterEnv): boolean {
  const { options, va } = env;
  return !input.bubbleMode && !(input.clamp && input.clamp.clipped.size > 0) && !env.log.x && !env.log.y && options.viewDomain === undefined
    && va.min === undefined && va.max === undefined && options.zones === undefined && options.quadrants === undefined
    && options.qualitativeAxes !== true;
}

/**
 * The axes of a 2x2 that no author bound, window, clamp or log scale pins.
 * Such an axis ends on its ticks too.
 */
function quadrantAxes(input: AxisDomainInput, env: ScatterEnv): boolean {
  const { options, va } = env;
  return options.quadrants !== undefined && !(input.clamp && input.clamp.clipped.size > 0) && !env.log.x && !env.log.y
    && options.viewDomain === undefined && va.min === undefined && va.max === undefined && !va.reverse
    && options.qualitativeAxes !== true;
}

/** The axes of a strategy grid that no author bound, window, clamp or log scale pins. */
function gridAxes(input: AxisDomainInput, env: ScatterEnv): boolean {
  const { options, va } = env;
  return options.zones !== undefined && 'grid' in options.zones && options.zones.grid !== undefined
    && !(input.clamp && input.clamp.clipped.size > 0) && !env.log.x && !env.log.y
    && options.viewDomain === undefined && va.min === undefined && va.max === undefined && !va.reverse;
}

/** Cuts this close to even spacing, as a share of the step, count as even. */
const EVEN_CUT_TOLERANCE = 0.02;

/**
 * One cut step before the first cut and after the last, so every cell of an
 * evenly cut axis is the same size; an end near a round number snaps to it
 * (3.33 and 6.67 give 0 to 10). Undefined for uneven cuts or data outside.
 */
function evenGridDomain(cuts: readonly number[], dataLo: number, dataHi: number): [number, number] | undefined {
  if (cuts.length === 0) return undefined;
  const sorted = [...cuts].sort((a, b) => a - b);
  const steps = sorted.slice(1).map((c, i) => c - sorted[i]!);
  const step = steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : undefined;
  if (step === undefined || !(step > 0) || steps.some((d) => Math.abs(d - step) > EVEN_CUT_TOLERANCE * step)) return undefined;
  const unit = 10 ** Math.floor(Math.log10(step));
  const snap = (v: number) => {
    const round = Math.round(v / unit) * unit;
    return Math.abs(round - v) <= EVEN_CUT_TOLERANCE * step ? Number(round.toPrecision(12)) : v;
  };
  const lo = snap(sorted[0]! - step);
  const hi = snap(sorted[sorted.length - 1]! + step);
  return dataLo >= lo && dataHi <= hi ? [lo, hi] : undefined;
}

/** A 2x2 axis starts at zero when the data start this close to it, as a share of the data maximum. */
const ZERO_START_SHARE = 0.2;
/** Room past the outermost bubbles, as a share of the data span. */
const BUBBLE_TICK_END_PAD = 0.08;

/** The tick steps a dot axis can take, per decade. */
const TICK_STEP_MANTISSAS = [1, 2, 5];
/** Each step past five costs this share of waste, so a coarser grid wins a near tie. */
const TICK_STEP_COST = 0.01;
/** Room past the outermost dots, as a share of the data span, before the axis ends. */
const TICK_END_PAD = 0.03;

/**
 * An axis that starts and ends on a labelled tick: the
 * data span plus a small pad, snapped out to the step that wastes the least
 * space with 5 to 10 steps between the ends (a 1-2-5 step, so every tick
 * prints exactly), each step past five counted as a little waste; on a tie
 * the larger step. A data side of zero stays on its side.
 */
function tickAlignedAxis(lo: number, hi: number, padShare = TICK_END_PAD): { domain: [number, number]; ticks: number[] } | undefined {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return undefined;
  const pad = span * padShare;
  const a = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  const b = hi <= 0 ? Math.min(0, hi + pad) : hi + pad;
  const decade = Math.floor(Math.log10(span));
  let best: { lo: number; hi: number; step: number; waste: number } | undefined;
  for (let e = decade - 2; e <= decade + 1; e++) {
    for (const m of TICK_STEP_MANTISSAS) {
      const step = m * 10 ** e;
      const sLo = Math.floor(a / step + 1e-9) * step;
      const sHi = Math.ceil(b / step - 1e-9) * step;
      const steps = Math.round((sHi - sLo) / step);
      if (steps < 5 || steps > 10) continue;
      const waste = 1 - span / (sHi - sLo) + TICK_STEP_COST * (steps - 5);
      if (!best || waste < best.waste - 1e-9 || (Math.abs(waste - best.waste) <= 1e-9 && step > best.step)) best = { lo: sLo, hi: sHi, step, waste };
    }
  }
  if (!best) return undefined;
  const digits = Math.max(0, -Math.floor(Math.log10(best.step)) + 2);
  const round = (v: number) => Number(v.toFixed(digits));
  const count = Math.round((best.hi - best.lo) / best.step);
  return { domain: [round(best.lo), round(best.hi)], ticks: Array.from({ length: count + 1 }, (_, i) => round(best!.lo + i * best!.step)) };
}

/** A log axis cannot start at zero, so only a linear one is noted. */
function zeroBaselineNotes(dx: [number, number], dy: [number, number], fmt: ScatterEnv['axisFmt'], log: LogAxes, options: ScatterEnv['options']): string[] {
  const [dxLo, dxHi] = dx;
  const [dyLo, dyHi] = dy;
  const baselineNotes: string[] = [];
  const horizontalNonZero = !log.x && (dxLo > 0 || dxHi < 0);
  const verticalNonZero = !log.y && (dyLo > 0 || dyHi < 0);
  if (horizontalNonZero || verticalNonZero) {
    const axes = [
      ...(horizontalNonZero ? [`x ${numberRange(fmt.x(dxLo), fmt.x(dxHi))}`] : []),
      ...(verticalNonZero ? [`y ${numberRange(fmt.y(dyLo), fmt.y(dyHi))}`] : []),
    ];
    baselineNotes.push(disclosureNote(chartString(options, 'axesNonzero', { v1: axes.join(', ') })));
  }
  return baselineNotes;
}

function refuseZoneThresholdsOutsideDomain(options: ScatterStrategyOptions, dx: [number, number], dy: [number, number]): void {
  if (!options.zones?.grid) return;
  for (const [axis, thresholds, lo, hi] of [
    ['x', options.zones.grid.x, dx[0], dx[1]],
    ['y', options.zones.grid.y, dy[0], dy[1]],
  ] as const) {
    for (const threshold of thresholds) {
      if (threshold <= lo || threshold >= hi) {
        throw new NormalizeError(
          'zone-threshold-outside-domain',
          `options.zones.grid.${axis}`,
          `strategy-zone threshold ${threshold} must fall strictly inside the plotted ${axis} domain ${lo} to ${hi}`,
        );
      }
    }
  }
}

/** Phase 1: data in, the plotted points, both axis domains and the 2x2 cut points out. */
export function resolveScatterDomain(data: ScatterData, env: ScatterEnv, warnings: LintWarning[]): ScatterDomain {
  const { options } = env;
  const { groupMap, plottable, noPosition } = normalizeScatterData(data, warnings);
  // The count filter runs FIRST: a point that is not plotted cannot be clipped,
  // and the extents, the bubble scale and every derived count below read the
  // set that survives it.
  const { kept: pts, record: dropped } = applyMinCount(plottable, options.minCount, env.discloseCount, options);
  refuseNonPositiveOnLog(options, env.log, pts);
  const clamp = planScatterClamp(
    pts,
    {
      options,
      clamp: options.valueAxis?.clamp,
      axisTitles: options.axisTitles ?? {},
      valueAxisBounds: { min: options.valueAxis?.min, max: options.valueAxis?.max },
      hasViewDomain: options.viewDomain !== undefined,
    },
    env.discloseCut,
  );
  const meanY = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const valueLines = drawnValueLines(options.annotations, meanY);
  refuseClampedValueLines(clamp, valueLines, env.axisFmt.y);
  const noPositionNote = noPosition.length === 0 ? undefined
    : disclosureNote(chartString(options, 'noPositionNote', { v1: chartString(options, 'pointsCount', { v1: noPosition.length, v2: noPosition.length === 1 ? '' : 's' }), v2: noPosition.join(', ') }));
  // The points the chart does not draw: the minCount drop and the points with no x or y.
  const omitted = [...(dropped ? [dropped.note] : []), ...(noPositionNote ? [noPositionNote] : [])];
  const derivedNotes = [...omitted, ...(clamp?.notes ?? [])];
  // A group whose every point minCount dropped has nothing left to key, so it
  // leaves the legend and the description; the others keep their style slots.
  const keptGroups = new Set(pts.map((p) => p.group));
  const emptied = new Set(dropped ? plottable.map((p) => p.group).filter((g) => !keptGroups.has(g)) : []);
  const shownGroups = [...groupMap.values()].filter((g) => !emptied.has(g.id));

  const { xMin, xMax, yMin, yMax } = pointExtents(pts);
  const bubbleMode = pts.some((p) => p.size !== null);
  const sizeMax = bubbleMode ? pts.reduce((a, p) => Math.max(a, p.size ?? 0), 0) : undefined;
  const sizeless = bubbleMode ? pts.filter((p) => p.size === null) : [];
  if (sizeless.length > 0) {
    warnings.push({
      code: 'size-missing',
      severity: 'warn',
      message: `bubble chart: point${sizeless.length === 1 ? '' : 's'} ${sizeless.map((p) => `'${p.id}'`).join(', ')} carr${sizeless.length === 1 ? 'ies' : 'y'} no size and ${sizeless.length === 1 ? 'is' : 'are'} drawn at the smallest bubble, which reads as a small value`,
      owner: { pointId: sizeless[0]!.id },
      suggest: 'give every point a size, or drop size from all points for a plain scatter',
    });
  }
  refuseSizeLegend(options, sizeMax, warnings);

  validateStrategyZones(options);
  refuseClampedRegions(clamp, options.zones?.regions);
  if (options.zones && options.valueAxis?.reverse) {
    throw new NormalizeError(
      'zone-scale-unsupported',
      'options.zones',
      'strategy zones require non-reversed scatter axes',
    );
  }
  const axes = scatterAxisDomain({ xMin, xMax, yMin, yMax, bubbleMode, clamp, valueLines }, env, warnings);
  const baselineNotes = zeroBaselineNotes(axes.dx, axes.dy, env.axisFmt, env.log, env.options);
  refuseZoneThresholdsOutsideDomain(options, axes.dx, axes.dy);
  const quadrants = deriveQuadrants(pts, bubbleMode, axes.dx, axes.dy, env, warnings);
  refuseClampedQuadrants(clamp, pts, quadrants.derived);
  // On tick-aligned 2x2 axes a declared cut value prints in its axis row.
  // A computed cut keeps its tag, which names the statistic.
  const q = quadrants.derived;
  const ticks = axes.ticks && q ? {
    x: withCutTick(axes.ticks.x, quadrants.drawX && q.xSource === 'declared' ? q.x : undefined),
    y: withCutTick(axes.ticks.y, quadrants.drawY && q.ySource === 'declared' ? q.y : undefined),
  } : axes.ticks;
  const drawn = pts.filter((p) => inView(options, axes.dx, axes.dy, p));
  const trends = fitScatterTrends(env, drawn, shownGroups.map((g) => g.id), warnings);
  const frontier = planFrontier(env, drawn, warnings);
  return {
    pts,
    groups: groupMap,
    shownGroups,
    dropped,
    clamp,
    meanY,
    xMin,
    xMax,
    yMin,
    yMax,
    bubbleMode,
    sizeMax,
    dx: axes.dx,
    dy: axes.dy,
    ...(ticks ? { ticks } : {}),
    ...(axes.evenGrid ? { evenGrid: axes.evenGrid } : {}),
    annotations: axes.annotations,
    baselineNotes,
    derivedNotes,
    omitted,
    quadrants,
    trends,
    ...(frontier ? { frontier } : {}),
  };
}

/** The tick list with the cut value in it, in order. */
function withCutTick(ticks: number[], cut: number | undefined): number[] {
  if (cut === undefined || ticks.some((t) => Math.abs(t - cut) < 1e-9)) return ticks;
  return [...ticks, cut].sort((a, b) => a - b);
}

/** A size key needs bubbles to key, and says what it measures. */
function refuseSizeLegend(options: ScatterStrategyOptions, sizeMax: number | undefined, warnings: LintWarning[]): void {
  if (options.sizeLegend === false) return;
  if (sizeMax === undefined || sizeMax <= 0) {
    // The key is drawn by default; only an explicit request without sizes is refused.
    if (!options.sizeLegend) return;
    throw new NormalizeError(
      'size-legend-without-sizes',
      'options.sizeLegend',
      'options.sizeLegend keys bubble sizes, and no point carries a positive size',
      'add size to the points, or drop options.sizeLegend',
      undefined,
      ['options', 'sizeLegend'],
    );
  }
  if (typeof options.sizeLegend !== 'object' || !options.sizeLegend.label) {
    warnings.push({
      code: 'size-legend-unnamed',
      severity: 'info',
      message: 'the size key shows bubble sizes but not what they measure',
      suggest: "name the measure with sizeLegend.label, e.g. { label: 'Revenue, €bn' }",
      field: ['options', 'sizeLegend'],
    });
  }
}

/** Whether a point is drawn: every point, unless a viewDomain window leaves it out. */
export function inView(options: ScatterStrategyOptions, dx: [number, number], dy: [number, number], p: NormPt): boolean {
  return !options.viewDomain || (p.x >= dx[0] && p.x <= dx[1] && p.y >= dy[0] && p.y <= dy[1]);
}
