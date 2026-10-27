import { chartString } from '../strings/geoScale';
import { structureCount } from '../structureCounts';
/**
 * The shared value→paint scale for the geo charts (choropleth and tilemap) —
 * previously maintained as hand-synced TWIN functions in both layouts.
 *
 * The ONE deliberate divergence between the charts is the no-data token,
 * passed in as `nullPaint`: a map region painted `neutral` would read as a
 * data value among its neighbours, so choropleth takes `background` + hatch +
 * border; a tilemap tile on `background` would vanish from the lattice, so it
 * takes `neutral`. Both end up bordered and hatched — neither is invisible.
 */

import type { LegendItemInput } from '../frame';
import { NAMED_COLUMN_STATES, type NamedColumnState } from '../schema/namedColumns';
import { colorblindPaint, semanticPalettePaint } from '../theme';
import type { Direction } from '../types/cell';
import type { LintWarning, Paint } from '../types/scene';
import type { Theme } from '../types/theme';
import { intervalText } from '../format';
import { exampleSpec, formatWithSpec, MAGNITUDE_DIVISOR, parseFormatExample } from '../formatSpec';
import { autoDecimals } from '../formatPrecision';
import { NormalizeError } from '../normalize/shared';
import { claimedRegionIds, resolveGeoRegionId, type GeoRegionIdIndex } from '../geo/resolveRegionId';
import type { FontSpec } from '../text';
import { maxOf, minOf } from '../arrays';

/** The scale/classes/palette slice of the geo option types — structurally satisfied by both. */
interface GeoScaleOptions extends Pick<import('../types/options').BaseOptions, 'locale' | 'strings'> {
  scale?:
    | { kind: 'sequential' }
    | { kind: 'diverging'; midpoint: number; midpointLabel?: string; polarity?: Direction };
  classes?: 3 | 4 | 5 | 6 | 7;
  /** The cohort chart's four ascending thresholds, in the map's source units. */
  steps?: [number, number, number, number];
  palette?: string;
  /** Paints a diverging scale's poles from theme.color.colorblind, as column and status do. */
  colorblindSafe?: boolean;
}

export interface ScaleModel {
  min: number | null;
  max: number | null;
  midpoint: number | null;
  /** Diverging only; null for sequential. Travels into derived.domain so receipts and describe see the declared judgment. */
  polarity: Direction | null;
  paint(value: number | null): Paint;
  legend: LegendItemInput[];
  /**
   * A classed scale's class edges, lowest first, min and max included. The
   * interior edges are the values the key prints, and a region is classed
   * against exactly these: a value on an edge opens the class
   * above it, and the top class includes the maximum.
   */
  edges?: number[];
  explicitSteps?: boolean;
  /** Prints a class edge on the key: round breaks drop the decimals they do not need. */
  edgeFmt: (value: number) => string;
}

/**
 * The notes a geo scale owes the author: an undeclared diverging polarity,
 * and signed values on the one-colour sequential ramp, where zero has no
 * colour of its own.
 */
export function geoScaleHints(values: readonly number[], options: GeoScaleOptions, fmt: (value: number) => string): LintWarning[] {
  const hints: LintWarning[] = [];
  // The poles carry a verdict, so an undeclared direction is worth a nudge:
  // pre-polarity documents keep rendering (high pole good), but the author
  // should confirm that reading or invert it.
  if (options.scale?.kind === 'diverging' && options.scale.polarity === undefined) {
    hints.push({
      code: 'geo-diverging-polarity-defaulted',
      severity: 'info',
      message:
        "diverging scale defaults to polarity 'higherIsBetter' — the high pole paints good; declare scale.polarity to confirm or invert",
    });
  }
  if (options.scale?.kind !== 'diverging' && values.some((v) => v < 0) && values.some((v) => v > 0)) {
    hints.push({
      code: 'geo-sequential-signed',
      severity: 'info',
      message: `values run from ${fmt(minOf(values))} to ${fmt(maxOf(values))} on a one-colour ramp, so values below and above zero read as more and less of one thing`,
      suggest: "declare scale: { kind: 'diverging', midpoint: 0 } to split them at zero",
    });
  }
  return hints;
}

/**
 * The words a diverging key owes the reader: its poles paint good and bad, so
 * the key says which end is better. A sequential ramp judges
 * nothing and says nothing.
 */
export function geoPolarityCaption(scale: Pick<ScaleModel, 'polarity'>, options?: Pick<import('../types/options').BaseOptions, 'locale' | 'strings'>): string | undefined {
  if (scale.polarity === null) return undefined;
  return chartString(options, scale.polarity === 'lowerIsBetter' ? 'lowerIsBetterCapital' : 'higherIsBetterCapital');
}

/** On a diverging key's list, the two end entries say which is better. */
function poleWord(polarity: Direction | null, index: number, last: number, options?: Pick<import('../types/options').BaseOptions, 'locale' | 'strings'>): string {
  if (polarity === null || (index !== 0 && index !== last)) return '';
  return (index === 0) === (polarity === 'lowerIsBetter') ? chartString(options, 'betterPole') : chartString(options, 'worsePole');
}

/** How far toward the background a diverging ramp's two sides run at the midpoint. */
const MIDPOINT_TINT = 0.82;

/**
 * A region exactly at the diverging midpoint: the palest grey, the ink walked
 * toward the card, that stays 1.25:1 from it. The poles' palest steps sit at
 * 1.2 to 1.4:1 in the shipped themes, so the midpoint is as quiet as they are
 * and still reads as filled. A `neutral` tinted like the poles vanishes
 * where a host's neutral is a band ground (1.02:1 on the card).
 */
const MIDPOINT_PAINT: Paint = {
  token: 'ink',
  theme: { kind: 'visible-tint', base: { token: 'ink' }, amount: 1, floor: 1.25, roundStep: true },
};

/**
 * The value an edge prints as: rounded to the decimals the format prints, so
 * the key states the edge the classes apply: one number, printed and
 * applied. A format with a magnitude ('$1.2M') rounds in its own unit.
 */
function printedEdge(value: number, format: string | undefined): number {
  if (format === undefined) {
    const decimals = autoDecimals(value);
    return Math.round(value * 10 ** decimals) / 10 ** decimals;
  }
  const spec = parseFormatExample(format);
  const unit = MAGNITUDE_DIVISOR[spec.magnitude];
  return Math.round(value / unit * 10 ** spec.decimals) / 10 ** spec.decimals * unit;
}

/** Digits after the point that `value` prints with (12 significant digits). */
export function decimalsOf(value: number): number {
  const text = String(Number(value.toPrecision(12)));
  const point = text.indexOf('.');
  return point < 0 || text.includes('e') ? 0 : text.length - point - 1;
}

/** The largest share of the values one class may hold before a finer round step is tried. */
const MAX_CLASS_SHARE = 0.4;

/**
 * Interior class breaks on a round step (1, 2, 2.5 or 5 times a power of
 * ten, on a grid through `anchor`), `classes - 1` of them. The coarsest step
 * whose best window of consecutive grid lines keeps every class at or under
 * MAX_CLASS_SHARE wins; when none does, the step and window with the
 * smallest largest class. The end classes are open: '<20' and '≥80'.
 * Undefined when no round step at or above `unit` gives enough breaks.
 */
function niceClassBreaks(values: readonly number[], classes: number, anchor: number, unit: number): number[] | undefined {
  const min = minOf(values);
  const max = maxOf(values);
  const range = max - min;
  if (!(range > 0) || values.length === 0) return undefined;
  const steps: number[] = [];
  for (let power = Math.ceil(Math.log10(range)); power >= Math.floor(Math.log10(range / (classes * 4))) - 1; power--) {
    for (const mantissa of [5, 2.5, 2, 1]) {
      const step = Number((mantissa * 10 ** power).toPrecision(12));
      if (step <= range && step >= unit * (1 - 1e-9) && step >= range / (classes * 4) &&
        Math.abs(step / unit - Math.round(step / unit)) < 1e-6) steps.push(step);
    }
  }
  let best: { breaks: number[]; share: number } | undefined;
  for (const step of steps) {
    // An integer index bounds the loop: a rounded running sum can stop growing at a large offset.
    const lines: number[] = [];
    const first = Math.floor((min - anchor) / step);
    const count = Math.ceil((max - anchor) / step) - first;
    for (let i = 0; i < count; i++) {
      const line = Number((anchor + (first + i) * step).toPrecision(12));
      if (line > min && line < max && line > (lines[lines.length - 1] ?? -Infinity)) lines.push(line);
    }
    for (let start = 0; start + classes - 1 <= lines.length; start++) {
      const breaks = lines.slice(start, start + classes - 1);
      const counts = new Array<number>(classes).fill(0);
      for (const value of values) counts[breaks.filter((edge) => value >= edge).length]! += 1;
      const share = maxOf(counts) / values.length;
      if (!best || share < best.share - 1e-9) best = { breaks, share };
    }
    if (best && best.share <= MAX_CLASS_SHARE) return best.breaks;
  }
  return best?.breaks;
}

export function buildGeoScale(
  values: number[],
  options: GeoScaleOptions & { format?: string },
  fmt: (value: number) => string,
  hasNoDataRegion: boolean,
  theme: Theme,
  nullPaint: Paint,
): ScaleModel {
  if (options.steps && (options.steps.length !== 4 || !options.steps.every((step, i) =>
    Number.isFinite(step) && (i === 0 || step > options.steps![i - 1]!)))) {
    throw new NormalizeError('invalid-steps', 'options.steps', 'steps must contain four finite, strictly ascending thresholds');
  }
  if (options.steps && options.classes !== undefined && options.classes !== 5) {
    throw new NormalizeError('invalid-steps', 'options.classes', 'four steps define five classes; remove classes or set it to 5');
  }
  const roundingStep = (value: number) => {
    if (options.format === undefined) return 10 ** -autoDecimals(value);
    const spec = exampleSpec(options.format, options.locale?.language);
    return MAGNITUDE_DIVISOR[spec.magnitude] / 10 ** spec.decimals;
  };
  if (options.steps?.some((step) => Math.abs(printedEdge(step, options.format) - step) > roundingStep(step) * 1e-9)) {
    throw new NormalizeError('geo-steps-format', 'options.format', 'the format rounds an explicit threshold; use more decimals so the key prints the exact steps');
  }
  const kind = options.scale?.kind ?? 'sequential';
  const declaredMidpoint =
    options.scale?.kind === 'diverging' ? options.scale.midpoint : null;
  const polarity: Direction | null =
    options.scale?.kind === 'diverging' ? options.scale.polarity ?? 'higherIsBetter' : null;
  const lowIsGood = polarity === 'lowerIsBetter';
  const min = values.length === 0
    ? null
    : Math.min(minOf(values), ...(declaredMidpoint === null ? [] : [declaredMidpoint]));
  const max = values.length === 0
    ? null
    : Math.max(maxOf(values), ...(declaredMidpoint === null ? [] : [declaredMidpoint]));
  // colorblindSafe swaps the good/bad pair for the colour-vision-safe one.
  const polePaint = (tone: 'good' | 'bad', tint: number): Paint =>
    options.colorblindSafe ? { ...colorblindPaint(tone, true), tint } : { token: tone === 'good' ? 'goodFill' : 'badFill', tint };
  const continuousPaint = (value: number | null): Paint => {
    if (value === null || min === null || max === null) return nullPaint;
    if (kind === 'diverging') {
      const midpoint = declaredMidpoint!;
      // The key's midpoint slice and a region at the midpoint share this paint.
      if (value === midpoint) return MIDPOINT_PAINT;
      // A diverging map is a judgment, so both poles come from the good/bad
      // pair — never the `highlight` accent (a coral accent would paint both
      // sides of the midpoint red). `polarity`
      // flips the poles for measures whose high side is unfavorable.
      // Judgment roles stay palette-invariant.
      // One span both ways from the midpoint, so equal distances paint one strength.
      const below = value < midpoint;
      const span = Math.max(midpoint - min, max - midpoint);
      const strength = span === 0 ? 0 : Math.abs(value - midpoint) / span;
      return polePaint(below === lowIsGood ? 'good' : 'bad', MIDPOINT_TINT * (1 - strength));
    }
    const strength = max === min ? 0.65 : (value - min) / (max - min);
    // Regions and tiles are large: the ramp takes tints of series 1 and the poles
    // the signed fill roles, falling back to good and bad.
    return semanticPalettePaint(
      theme,
      options.palette,
      'sequential',
      0.82 * (1 - strength),
    );
  };
  const classCount = options.steps ? 5 : options.classes;
  // Map and legend paint classes through the SAME function so they cannot
  // disagree. A diverging class that straddles the midpoint is the "around
  // the midpoint" class: sampling its center could land on either side and
  // assert an inverted verdict for regions on the other (a 2.6% region under
  // midpoint 3 painted from a 3.75 sample), so it takes the midpoint paint.
  const classPaint = (index: number): Paint => {
    if (options.steps && kind === 'sequential') return semanticPalettePaint(theme, options.palette, 'sequential', 0.82 * (1 - (index + 0.5) / 5));
    const lo = edges ? edges[index]! : min! + (index / classCount!) * (max! - min!);
    const hi = edges ? edges[index + 1]! : min! + ((index + 1) / classCount!) * (max! - min!);
    // Epsilon-tolerant straddle: a boundary that lands ON the midpoint can
    // compute one ULP low (0..0.3 over three classes puts the 0.1 boundary at
    // 0.09999999999999999), and a raw lo<mid<hi then paints the mathematically
    // high-side class neutral — its regions lose their verdict. Within eps of the midpoint a boundary counts as ON it.
    const eps = (max! - min!) * 1e-9;
    if (
      declaredMidpoint !== null &&
      lo < declaredMidpoint - eps &&
      hi > declaredMidpoint + eps
    ) {
      return continuousPaint(declaredMidpoint);
    }
    // Class center via the sampling expression min + (index + 0.5) / classCount
    // of the span — (lo+hi)/2 is the same number in exact arithmetic but one ULP
    // off in floats, and unsigned classed ramps must stay byte-identical.
    return continuousPaint((options.steps || nice) && kind === 'diverging' ? Math.max(min!, Math.min(max!, (lo + hi) / 2)) : min! + ((index + 0.5) / classCount!) * (max! - min!));
  };
  // Default class breaks sit on a round step and keep each class under
  // about 40 % of the regions where a round step can; equal intervals of the
  // range stay the fallback when no round step suits the format's precision.
  const nice = !options.steps && classCount && min !== null && max !== null && max !== min
    ? niceClassBreaks(values, classCount, declaredMidpoint ?? 0, roundingStep(max - min))
    : undefined;
  const edges = options.steps
    ? [Math.min(min ?? options.steps[0], options.steps[0]), ...options.steps, Math.max(max ?? options.steps[3], options.steps[3])]
    : nice
    ? [min!, ...nice, max!]
    : classCount && min !== null && max !== null && max !== min
    ? Array.from({ length: classCount + 1 }, (_, index) =>
        index === 0 ? min : index === classCount ? max : printedEdge(min + (index / classCount) * (max - min), options.format))
    : undefined;
  const paint = (value: number | null): Paint => {
    if (value === null || !edges) return continuousPaint(value);
    // The class whose printed lower edge the value reaches; the top class holds the maximum.
    const index = Math.max(0, edges.slice(1, -1).filter((edge) => value >= edge).length);
    return classPaint(index);
  };
  const legend = geoScaleLegend({ min, max, kind, declaredMidpoint, edges, hasNoDataRegion, polarity }, options, fmt, classPaint, continuousPaint);
  // A round break prints round: '20' under a '1.1' format, not '20.0'.
  const edgeFmt = nice && options.format !== undefined
    ? (() => {
        const spec = exampleSpec(options.format, options.locale?.language);
        const decimals = Math.min(spec.decimals, Math.max(0, maxOf(nice.map((edge) => decimalsOf(edge / MAGNITUDE_DIVISOR[spec.magnitude])))));
        return (value: number) => formatWithSpec(value, { ...spec, decimals });
      })()
    : fmt;
  return { min, max, midpoint: declaredMidpoint, polarity, paint, legend, edgeFmt, ...(edges ? { edges } : {}), ...(options.steps ? { explicitSteps: true } : {}) };
}

function geoScaleLegend(
  domain: { min: number | null; max: number | null; kind: 'sequential' | 'diverging'; declaredMidpoint: number | null; edges?: number[]; hasNoDataRegion: boolean; polarity: Direction | null },
  options: GeoScaleOptions, fmt: (value: number) => string,
  classPaint: (index: number) => Paint, continuousPaint: (value: number | null) => Paint,
): LegendItemInput[] {
  const { min, max, kind, declaredMidpoint, edges, hasNoDataRegion, polarity } = domain;
  const midpointLabel = options.scale?.kind === 'diverging' ? options.scale.midpointLabel : undefined;
  const legend: LegendItemInput[] = [];
  if (min !== null && max !== null) {
    if (edges) {
      const last = edges.length - 2;
      for (let index = 0; index <= last; index++) {
        const lo = edges[index]!;
        const hi = edges[index + 1]!;
        legend.push({
          id: `class-${index + 1}`,
          // A class holds its lower edge and stops short of its upper one,
          // except the last, which includes the maximum: '-12 to under -7',
          // ..., '7 to 12 inclusive', so a value on an edge has one class.
          label: `${options.steps && index === 0 ? chartString(options, 'underValue', { v1: fmt(hi) }) : options.steps && index === last ? chartString(options, 'valueAndAbove', { v1: fmt(lo) }) : intervalText(fmt(lo), fmt(hi), options.steps ? false : index === last, options)}${midpointLabel && declaredMidpoint !== null && declaredMidpoint >= lo && (declaredMidpoint < hi || index === last) ? ` (${fmt(declaredMidpoint)} ${midpointLabel})` : ''}${poleWord(polarity, index, last, options)}`,
          paint: classPaint(index),
        });
      }
    } else {
      const stops = kind === 'diverging'
        ? [min, declaredMidpoint!, max]
        : min === max
          ? [min]
          : [min, min + (max - min) / 2, max];
      const uniqueStops = stops.filter((value, index) => index === 0 || value !== stops[index - 1]);
      uniqueStops.forEach((value, index) =>
        legend.push({
          id: `range-${index + 1}`,
          label: `${fmt(value)}${midpointLabel && value === declaredMidpoint ? ` ${midpointLabel}` : ''}${poleWord(polarity, index, uniqueStops.length - 1, options)}`,
          paint: continuousPaint(value),
        }),
      );
    }
  }
  if (hasNoDataRegion) {
    legend.push({
      id: 'no-data',
      label: chartString(options, 'valueMissing'),
      paint: { token: 'neutral' },
      pattern: 'hatch45',
    });
  }
  return legend;
}

/** A region name, tile code or value prints in the label type. */
export function geoLabelFont(theme: Theme): FontSpec {
  return { family: theme.type.family, ...theme.type.label };
}

/**
 * Map each listed region onto its pack id, for both map types. An unmappable
 * id still CLAIMS every region it could name, so 'J' + 'JP' in one document
 * stays a duplicate. An ambiguous id names none: tinting one of its regions
 * would show a confidently wrong country, so the value is refused out loud.
 */
export function ingestGeoRegions(
  regions: readonly { id: string; value: number | null; state?: unknown }[],
  idIndex: GeoRegionIdIndex,
  pack: { where: string; regionWord: string },
  warnings: LintWarning[],
  unknown: (id: string, index: number) => never,
): { valuesById: Map<string, number | null>; statesById: Map<string, NamedColumnState> } {
  const valuesById = new Map<string, number | null>();
  const statesById = new Map<string, NamedColumnState>();
  const claimedBy = new Map<string, string>();
  regions.forEach((datum, index) => {
    const resolution = resolveGeoRegionId(idIndex, datum.id);
    const claims = claimedRegionIds(resolution);
    const collision = claims.find((id) => claimedBy.has(id));
    if (collision !== undefined) {
      throw new NormalizeError(
        'duplicate-id',
        `regions[${index}].id`,
        resolution.kind === 'ambiguous'
          ? `region '${datum.id}' is ambiguous in ${pack.where} ` +
            `(${resolution.candidates.join(', ')}) and '${collision}' is already listed ` +
            `as '${claimedBy.get(collision)}'`
          : `region '${datum.id}' resolves to duplicate ${pack.regionWord} '${collision}'`,
      );
    }
    for (const id of claims) claimedBy.set(id, datum.id);
    if (resolution.kind === 'ambiguous') {
      warnings.push({
        code: 'geo-ambiguous-region-id',
        severity: 'warn',
        message:
          `region id '${datum.id}' is ambiguous in ${pack.where} — ` +
          `${resolution.candidates.join(', ')} all answer to it; the value is not mapped`,
        owner: { categoryId: datum.id },
        suggest: `use one of ${resolution.candidates.join(', ')}`,
      });
      return;
    }
    if (resolution.kind === 'unknown') return unknown(datum.id, index);
    const state = normalizeGeoRegionState(datum.value, datum.state, index);
    if (state) statesById.set(resolution.id, state);
    valuesById.set(resolution.id, datum.value);
  });
  return { valuesById, statesById };
}

/** Named map states share one pattern, key and description model. */
const GEO_STATES = {
  suppressed: { label: 'Suppressed', reading: 'suppressed', pattern: 'crosshatch' },
  nm: { label: 'Not meaningful', reading: 'not meaningful', pattern: 'horizontal' },
  na: { label: 'Not applicable', reading: 'not applicable', pattern: 'vertical' },
} as const;
function normalizeGeoRegionState(value: number | null, state: unknown, index: number): NamedColumnState | undefined {
  if (state === undefined) return undefined;
  if (!(NAMED_COLUMN_STATES as readonly unknown[]).includes(state)) {
    throw new NormalizeError('invalid-state', `regions[${index}].state`, 'region state must be suppressed, nm or na');
  }
  if (value !== null) throw new NormalizeError('state-with-value', `regions[${index}].state`, 'a region state requires value null');
  return state as NamedColumnState;
}
export const geoStatePattern = (state: NamedColumnState) => GEO_STATES[state].pattern;
export const geoStateLabel = (state: NamedColumnState, options?: Pick<import('../types/options').BaseOptions, 'locale' | 'strings'>) => chartString(options, { suppressed: 'suppressed', nm: 'notMeaningful', na: 'notApplicableName' }[state] as 'suppressed' | 'notMeaningful' | 'notApplicableName');
export function geoStateLegend(states: Iterable<NamedColumnState>, options?: Pick<import('../types/options').BaseOptions, 'locale' | 'strings'>): LegendItemInput[] {
  const present = new Set(states);
  return NAMED_COLUMN_STATES.filter(state => present.has(state)).map(state => ({
    id: `state:${state}`, label: geoStateLabel(state, options), paint: { token: 'inkMuted' }, pattern: geoStatePattern(state),
  }));
}
export function geoStateSummary(states: Iterable<NamedColumnState>, options?: Pick<import('../types/options').BaseOptions, 'locale' | 'strings'>): string {
  return geoStateCounts(states, options).map(count => count.text).join('');
}

export function geoStateCounts(states: Iterable<NamedColumnState>, options?: Pick<import('../types/options').BaseOptions, 'locale' | 'strings'>) {
  const values = [...states];
  return NAMED_COLUMN_STATES.flatMap(state => {
    const count = values.filter(value => value === state).length;
    return count ? [structureCount('regions', count, chartString(options, 'mapStateCount', { v1: count, v2: count === 1 ? ' is' : 's are', v3: chartString(options, { suppressed: 'suppressedReading', nm: 'notMeaningfulReading', na: 'notApplicableReading' }[state] as 'suppressedReading' | 'notMeaningfulReading' | 'notApplicableReading'), v4: count === 1 ? 's' : '' }))] : [];
  });
}
