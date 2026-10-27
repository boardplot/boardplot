import { localeStrings } from '../../strings/line';
import { stringFields } from '../../strings';
import { defaultFormatSpec, formatWithSpec, type NumberFormatSpec } from '../../formatSpec';
import type { StringsSpec } from '../../types/options';
import { strokeToken, dashToken } from '../../theme';
import { fanPaintSteps } from '../../colorRecipes';
import type { Theme } from '../../types/theme';
import { fmtPathNumber as fmtN } from '../../curve';
import type { Point } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import { NormalizeError } from '../../normalize/shared';
import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { LintWarning, Paint, SceneNode } from '../../types/scene';
import type { NormSer } from './context';
import type { LineMarks } from './layout';
import type { LineInterpolation, LineOptions } from './types';
import type { LineDomain } from './model';
import { disclosureNote } from '../../notes';
import { formatExactNumber, numberRange } from '../../format';
import { pushAll } from '../../arrays';
import { edgePath, mapEdge, rangeRuns, type LineRange, type RangeEdge } from './range';

type FanSpec = NonNullable<LineOptions['fan']>;

interface FanBandResolved {
  low: NormSer;
  high: NormSer;
  label: string;
  widths: (number | null)[];
}

export interface FanResolved {
  of: NormSer;
  bands: FanBandResolved[];
  showBounds: boolean;
  origin: Id | null;
  boundIds: Set<Id>;
  undeclaredAt: Id[];
}

export interface FanPaintStep {
  paint: Paint;
  css: string;
}

function validateDeclaration(input: {
  spec: FanSpec;
  seriesById: Map<Id, NormSer>;
  seriesNorm: NormSer[];
  variant: 'line' | 'area' | 'stacked-area' | 'stacked100-area';
  isArea: boolean;
  rebase100: LineOptions['rebase100'];
  gapFill: LineOptions['gapFill'];
}): void {
  const { spec, seriesById, seriesNorm, variant, isArea, rebase100, gapFill } = input;
  const named: [string, Id][] = [
    ['fan.of', spec.of],
    ...spec.bands.flatMap((band, k): [string, Id][] => [
      [`fan.bands[${k}].low`, band.low],
      [`fan.bands[${k}].high`, band.high],
    ]),
  ];
  for (const [path, id] of named) {
    if (!seriesById.has(id)) throw new NormalizeError('fan-series-unknown', path, `fan names unknown series '${id}' — a band is DECLARED DATA, so every bound must exist in data.series`, `add a series with id '${id}', or point this bound at one of: ${seriesNorm.map((s) => `'${s.id}'`).join(', ')}`);
  }
  // The key and the notes name each band by its label; a band without one would print as nothing.
  spec.bands.forEach((band, k) => {
    if (typeof band.label !== 'string' || band.label.trim() === '') throw new NormalizeError('fan-band-unlabelled', `fan.bands[${k}].label`, `fan.bands[${k}] has no label — '80% predictive interval' and 'min/max of three scenarios' draw the same band and mean different things`, "add a label that says what the interval means, such as '80% predictive interval'");
  });
  const seen = new Map<Id, string>([[spec.of, 'fan.of']]);
  for (const [path, id] of named.slice(1)) {
    const first = seen.get(id);
    if (first !== undefined) throw new NormalizeError('fan-series-reused', path, `series '${id}' is used twice by the fan (${first} and ${path}) — each bound and the centre must be its own series, or the bands drawn are not the bands declared`, 'give each band its own low/high series; a shared bound means two intervals claim the same numbers');
    seen.set(id, path);
  }
  if (spec.bands.length > 4) throw new NormalizeError('fan-too-many-bands', 'fan.bands', `${spec.bands.length} bands exceed the four the tint ladder can keep apart — past four the washes are indistinguishable and the exhibit claims a precision the reader cannot see`, 'four nested intervals is the legibility limit; drop or merge bands');
  if (variant === 'stacked-area' || variant === 'stacked100-area') throw new NormalizeError('fan-composition-conflict', 'variant', `variant '${variant}' stacks each series onto the ones below it; a band around one member of a composition bounds nothing the reader can see, because the member's own position depends on its neighbours' values`, "use variant 'line' for a fan, and a separate exhibit for the composition");
  if (isArea) throw new NormalizeError('fan-area-conflict', 'variant', `variant '${variant}' fills from the trajectory down to the baseline with an opaque fill that paints OVER the lower half of every band — the reader would see only the upper edge of each interval, i.e. a one-sided uncertainty, while the legend key beside it names the whole interval`, "use variant 'line' for a fan — the fan IS the fill, and a second fill under it hides half of what it declares");
  if (rebase100) throw new NormalizeError('fan-rebase-conflict', 'rebase100', 'rebase100 divides EACH series by its OWN value at the base category, so the bounds and the centre are rescaled by different divisors and the bands stop nesting — the fan would still be drawn, and would be wrong', 'rebase the numbers before authoring them, so centre and bounds share one base, or drop rebase100');
  if (gapFill) throw new NormalizeError('fan-gapfill-conflict', 'gapFill', 'gapFill and fan are two wash systems in one plot — a reader cannot tell an uncertainty band from a shaded difference, and the picture would answer neither question', 'keep the fan and drop gapFill, or split them into two exhibits');
}

function buildBands(input: {
  spec: FanSpec;
  seriesById: Map<Id, NormSer>;
  cats: Category[];
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
}): FanBandResolved[] {
  const { spec, seriesById, cats, pv, rowOf } = input;
  const catLabel = (ci: number): string => cats[ci]!.label ?? cats[ci]!.id;
  const bands = spec.bands.map((band) => ({
    low: seriesById.get(band.low)!,
    high: seriesById.get(band.high)!,
    label: band.label,
    widths: cats.map(() => null as number | null),
  }));
  bands.forEach((band, k) => {
    const lowRow = pv[rowOf.get(band.low)!]!;
    const highRow = pv[rowOf.get(band.high)!]!;
    cats.forEach((_, ci) => {
      const lo = lowRow[ci]!;
      const hi = highRow[ci]!;
      if (lo === null || hi === null) return;
      if (lo > hi) throw new NormalizeError(
        'fan-band-inverted',
        `fan.bands[${k}]`,
        `band '${band.label}' is inverted at category '${catLabel(ci)}': low '${band.low.id}' = ${lo} is above high '${band.high.id}' = ${hi}`,
        'swap the low and high series ids for this band — the engine will not swap them for you, because a silently corrected bound hides which series is actually which',
      );
      band.widths[ci] = hi - lo;
    });
  });
  return bands;
}

function validateNesting(input: {
  bands: FanBandResolved[];
  cats: Category[];
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
}): void {
  const { bands, cats, pv, rowOf } = input;
  const row = (series: NormSer): (number | null)[] => pv[rowOf.get(series)!]!;
  for (let k = 0; k + 1 < bands.length; k++) {
    const outer = bands[k]!;
    const inner = bands[k + 1]!;
    const [oLow, oHigh, iLow, iHigh] = [row(outer.low), row(outer.high), row(inner.low), row(inner.high)];
    for (let ci = 0; ci < cats.length; ci++) {
      const [ol, oh, il, ih] = [oLow[ci]!, oHigh[ci]!, iLow[ci]!, iHigh[ci]!];
      if (ol === null || oh === null || il === null || ih === null) continue;
      if (ol > il || oh < ih) throw new NormalizeError(
        'fan-bands-crossed',
        `fan.bands[${k + 1}]`,
        `bands are not nested at category '${cats[ci]!.label ?? cats[ci]!.id}': band ${k} '${outer.label}' spans ${ol}..${oh} and does not contain band ${k + 1} '${inner.label}' spanning ${il}..${ih} — bands must be authored OUTERMOST FIRST`,
        'reorder the bands outermost-first in the document, or fix the bound values; the engine will not reorder them, because a reordered fan hides an authoring error the reader can never see',
      );
    }
  }
}

function validateCenter(input: {
  of: NormSer;
  ofRow: (number | null)[];
  band: FanBandResolved;
  cats: Category[];
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
}): void {
  const { of, ofRow, band, cats, pv, rowOf } = input;
  const low = pv[rowOf.get(band.low)!]!;
  const high = pv[rowOf.get(band.high)!]!;
  for (let ci = 0; ci < cats.length; ci++) {
    const [center, lo, hi] = [ofRow[ci]!, low[ci]!, high[ci]!];
    if (center === null || lo === null || hi === null) continue;
    if (center < lo || center > hi) throw new NormalizeError(
      'fan-center-outside-band',
      'fan.of',
      `the central series '${of.id}' = ${center} at category '${cats[ci]!.label ?? cats[ci]!.id}' lies outside its innermost band '${band.label}' (${lo}..${hi}) — the centre and the bounds do not describe the same quantity`,
      'check that fan.of names the central trajectory and that the bound series are aligned to the same categories; a fan whose centre escapes its own interval is drawing two different series as one',
    );
  }
}

export function resolveFan(input: {
  spec: LineOptions['fan'];
  seriesById: Map<Id, NormSer>;
  seriesNorm: NormSer[];
  cats: Category[];
  variant: 'line' | 'area' | 'stacked-area' | 'stacked100-area';
  isArea: boolean;
  rebase100: LineOptions['rebase100'];
  gapFill: LineOptions['gapFill'];
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  warnings: LintWarning[];
}): FanResolved | null {
  const { spec, seriesById, seriesNorm, cats, variant, isArea, rebase100, gapFill, pv, rowOf, warnings } = input;
  if (!spec) return null;
  validateDeclaration({ spec, seriesById, seriesNorm, variant, isArea, rebase100, gapFill });
  const of = seriesById.get(spec.of)!;
  const ofRow = pv[rowOf.get(of)!]!;
  if (ofRow.every((value) => value === null)) throw new NormalizeError('fan-center-empty', 'fan.of', `the central series '${of.id}' is null in every category — a fan with no trajectory is bands around nothing`, 'give the central series values, or point fan.of at the series that carries the projection');
  const bands = buildBands({ spec, seriesById, cats, pv, rowOf });
  validateNesting({ bands, cats, pv, rowOf });
  validateCenter({ of, ofRow, band: bands[bands.length - 1]!, cats, pv, rowOf });
  const boundIds = new Set<Id>(bands.flatMap((band) => [band.low.id, band.high.id]));
  let origin: Id | null = null;
  for (let ci = 0; ci < cats.length && origin === null; ci++) {
    if (bands.some((band) => (band.widths[ci] ?? 0) > 0)) origin = cats[ci]!.id;
  }
  const row = (series: NormSer): (number | null)[] => pv[rowOf.get(series)!]!;
  const undeclaredAt = cats.filter((_, ci) => bands.some((band) => row(band.low)[ci] === null || row(band.high)[ci] === null)).map((category) => category.id);
  if (origin === null) warnings.push({
    code: 'fan-degenerate',
    severity: 'warn',
    message: 'every fan band has low === high in every category, so there is no interval to wash — the bounds are drawn as ordinary series instead of as a fan',
    suggest: 'drop options.fan if the bounds are meant to coincide, or supply bounds that differ from each other',
  });
  return { of, bands, showBounds: spec.showBounds === true, origin, boundIds, undeclaredAt };
}

/**
 * The outermost band at the last period both its bounds reach: the interval
 * the fan's edge values name, on the chart or in the key.
 */
export function outerFanEdge(domain: Pick<LineDomain, 'seriesNorm' | 'pv' | 'rowOf'>, bands: readonly { low: Id; high: Id }[]): { index: number; ci: number; low: number; high: number } | undefined {
  const byId = new Map(domain.seriesNorm.map((series) => [series.id, series]));
  const rowOfId = (id: Id) => domain.pv[domain.rowOf.get(byId.get(id)!)!]!;
  const edges = bands.flatMap((band, index) => {
    const low = rowOfId(band.low);
    const high = rowOfId(band.high);
    for (let ci = low.length - 1; ci >= 0; ci--) if (low[ci] !== null && high[ci] !== null) return [{ index, ci, low: low[ci]!, high: high[ci]! }];
    return [];
  });
  return edges.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low))[0];
}

export function fanGapNote(fan: FanResolved | null, cats: Category[], strings?: StringsSpec): string[] {
  if (!fan || fan.origin === null || fan.undeclaredAt.length === 0) return [];
  const label = (id: Id): string => cats.find((category) => category.id === id)?.label ?? id;
  return [disclosureNote(stringFields(strings?.fanGap ?? localeStrings().fanGap, { categories: fan.undeclaredAt.map(label).join(', ') }))];
}

export function buildFanPaints(input: {
  fan: FanResolved | null;
  drawnSeries: NormSer[];
  seriesPaint: (series: NormSer, index: number) => Paint;
  paintCss: (paint: Paint) => string;
  theme: Theme;
  anyHighlight: boolean;
  highlights: Set<Id>;
}): { fanLadder: FanPaintStep[]; fanCentrePaint: Paint | null; fanPaints: boolean } {
  const { fan, drawnSeries, seriesPaint, theme, anyHighlight, highlights } = input;
  if (!fan || fan.origin === null) return { fanLadder: [], fanCentrePaint: null, fanPaints: false };
  const centrePaint = seriesPaint(fan.of, Math.max(0, drawnSeries.indexOf(fan.of)));
  const steps = fanPaintSteps(theme, centrePaint, fan.bands.length, fan.showBounds, fan.of.id, anyHighlight && !highlights.has(fan.of.id));
  const fanLadder = steps.map((step, index) => ({ ...step, paint: {
    token: 'token' in centrePaint ? centrePaint.token : 'highlight',
    theme: { kind: 'fan-step', base: centrePaint, bandCount: fan.bands.length, showBounds: fan.showBounds, index, seriesId: fan.of.id, deEmphasized: anyHighlight && !highlights.has(fan.of.id) },
  } as Paint }));
  return { fanLadder, fanCentrePaint: centrePaint, fanPaints: true };
}

interface FanPoint {
  ci: number;
  x: number;
  yLow: number;
  yHigh: number;
}

function fanBoundText(lo: number, hi: number, fmt: (value: number) => string, spec: NumberFormatSpec): [string, string] {
  const a = fmt(lo);
  const b = fmt(hi);
  if (a !== b || !(hi > lo)) return [a, b];
  // The bounds at the precision that tells them apart, in the chart's marks and the format's grouping.
  const plain = { ...defaultFormatSpec(spec.locale), thousandsSep: spec.thousandsSep };
  for (let digits = 1; digits <= 15; digits++) {
    if (lo.toFixed(digits) !== hi.toFixed(digits)) return [formatWithSpec(lo, { ...plain, decimals: digits }), formatWithSpec(hi, { ...plain, decimals: digits })];
  }
  return [formatExactNumber(lo, spec.locale), formatExactNumber(hi, spec.locale)];
}

function collectRuns(input: {
  lowRow: (number | null)[];
  highRow: (number | null)[];
  cats: Category[];
  compositionInvalidAt: (ci: number) => boolean;
  xOf: (ci: number) => number;
  y: (value: number) => number;
  gapCats: Set<Id>;
}): FanPoint[][] {
  const { lowRow, highRow, cats, compositionInvalidAt, xOf, y, gapCats } = input;
  const runs: FanPoint[][] = [];
  let current: FanPoint[] = [];
  cats.forEach((_, ci) => {
    const lo = lowRow[ci]!;
    const hi = highRow[ci]!;
    if (lo === null || hi === null || compositionInvalidAt(ci)) {
      if (lo === null || hi === null) gapCats.add(cats[ci]!.id);
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    current.push({ ci, x: xOf(ci), yLow: y(lo), yHigh: y(hi) });
  });
  if (current.length > 0) runs.push(current);
  return runs;
}

function addFanRun(theme: Theme, input: {
  edges?: RangeEdge[];
  run: FanPoint[];
  runIndex: number;
  band: FanBandResolved;
  bandIndex: number;
  lowRow: (number | null)[];
  highRow: (number | null)[];
  cats: Category[];
  interpolation: LineInterpolation;
  fanLadder: FanPaintStep[];
  showBounds: boolean;
  pathFor: (points: Point[], interpolation: LineInterpolation) => string;
  reversePathTail: (points: Point[], interpolation: LineInterpolation) => string;
  fmt: (value: number) => string;
  /** The value format's spec: its grouping and the chart's marks (numberMarks.ts). */
  numberSpec: NumberFormatSpec;
  occupied: OccupiedIndex;
  fanNodes: SceneNode[];
  hairNodes: SceneNode[];
  gapCats: Set<Id>;
}): Id | null {
  const { run, runIndex, band, bandIndex, lowRow, highRow, cats, interpolation, fanLadder, showBounds, pathFor, reversePathTail, fmt, occupied, fanNodes, hairNodes, gapCats } = input;
  if (run.length < 2) {
    for (const point of run) gapCats.add(cats[point.ci]!.id);
    return null;
  }
  const upper = input.edges?.[0]?.points ?? run.map((point) => ({ x: point.x, y: point.yHigh }));
  const lower = input.edges?.[1]?.points ?? run.map((point) => ({ x: point.x, y: point.yLow }));
  const upperPath = input.edges ? edgePath(input.edges[0]!, points => pathFor([...points], interpolation)) : pathFor(upper, interpolation);
  const lowerCurve = input.edges?.[1]?.curve;
  const reverse = lowerCurve ? [...lowerCurve].reverse().map(c => `C${fmtN(c.c2.x)} ${fmtN(c.c2.y)} ${fmtN(c.c1.x)} ${fmtN(c.c1.y)} ${fmtN(c.from.x)} ${fmtN(c.from.y)}`).join('') : reversePathTail(lower, interpolation);
  const nodeId = `mark:fan:${bandIndex}:${runIndex}`;
  let widestAt = run[0]!.ci;
  for (const point of run) if ((band.widths[point.ci] ?? 0) > (band.widths[widestAt] ?? 0)) widestAt = point.ci;
  const [loText, hiText] = fanBoundText(lowRow[widestAt]!, highRow[widestAt]!, fmt, input.numberSpec);
  fanNodes.push({
    t: 'path',
    id: nodeId,
    d: `${upperPath}L${fmtN(lower[lower.length - 1]!.x)} ${fmtN(lower[lower.length - 1]!.y)}${reverse}Z`,
    fill: fanLadder[bandIndex]!.paint,
    owner: {},
    part: 'fanBand',
    display: { value: `${band.label}: ${numberRange(loText, hiText)} at ${cats[widestAt]!.label ?? cats[widestAt]!.id}${(band.widths[widestAt] ?? 0) > 0 ? ' (widest)' : ''}` },
  });
  for (let k = 0; k + 1 < run.length; k++) {
    const a = run[k]!;
    const b = run[k + 1]!;
    const top = Math.min(a.yHigh, b.yHigh);
    const bottom = Math.max(a.yLow, b.yLow);
    occupied.claim({ x: Math.min(a.x, b.x), y: top, w: Math.max(Math.abs(b.x - a.x), 1), h: Math.max(bottom - top, 1) }, 'mark', {}, 'fanBand');
  }
  if (showBounds) {
    const hairPaint = fanLadder[bandIndex + 1]!.paint;
    for (const [edge, points] of [['high', upper], ['low', lower]] as const) hairNodes.push({
      t: 'path',
      id: `mark:fan-bound:${bandIndex}:${edge}:${runIndex}`,
      d: input.edges ? edgePath(input.edges[edge === 'high' ? 0 : 1]!, pts => pathFor([...pts], interpolation)) : pathFor(points, interpolation),
      stroke: hairPaint,
      width: strokeToken(theme, 'rule'),
      dash: dashToken(theme, 'dotted'), lineCap: 'round' as const,
      owner: { seriesId: edge === 'high' ? band.high.id : band.low.id },
      part: 'fanBound',
      display: { value: `${band.label} ${edge}: ${fmt((edge === 'high' ? highRow : lowRow)[widestAt]!)}` },
    });
  }
  return nodeId;
}

export function renderFanWashes(theme: Theme, input: {
  range?: LineRange;
  xOfValue?: (value: number) => number;
  fan: FanResolved | null;
  fanPaints: boolean;
  fanLadder: FanPaintStep[];
  interpolationFor: (series: NormSer) => LineInterpolation;
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  cats: Category[];
  compositionInvalidAt: (ci: number) => boolean;
  xOf: (ci: number) => number;
  y: (value: number) => number;
  pathFor: (points: Point[], interpolation: LineInterpolation) => string;
  reversePathTail: (points: Point[], interpolation: LineInterpolation) => string;
  fmt: (value: number) => string;
  numberSpec: NumberFormatSpec;
  occupied: OccupiedIndex;
  warnings: LintWarning[];
  nodes: SceneNode[];
  marks: LineMarks;
  analyticalSceneStart: number;
}): void {
  const { fan, fanPaints, fanLadder, interpolationFor, pv, rowOf, cats, compositionInvalidAt, xOf, y, pathFor, reversePathTail, fmt, numberSpec, occupied, warnings, nodes, marks, analyticalSceneStart } = input;
  if (!fan || !fanPaints) return;
  const interpolation = interpolationFor(fan.of);
  const fanNodes: SceneNode[] = [];
  const hairNodes: SceneNode[] = [];
  const fanMarks: NonNullable<LineMarks['fan']> = [];
  const gapCats = new Set<Id>();
  fan.bands.forEach((band, bandIndex) => {
    const lowRow = pv[rowOf.get(band.low)!]!;
    const highRow = pv[rowOf.get(band.high)!]!;
    if (input.range) cats.forEach((cat, ci) => { if (lowRow[ci] === null || highRow[ci] === null) gapCats.add(cat.id); });
    const edges = input.range && input.xOfValue ? rangeRuns(input.range, [input.range.plotted[rowOf.get(band.high)!]!, input.range.plotted[rowOf.get(band.low)!]!], interpolation)
      .map(run => run.map(edge => mapEdge(edge, input.xOfValue!, y))) : undefined;
    const runs = edges ? edges.map(run => run[0]!.points.map((p, i) => ({ ci: p.ci, x: p.x, yHigh: p.y, yLow: run[1]!.points[i]!.y })))
      : collectRuns({ lowRow, highRow, cats, compositionInvalidAt, xOf, y, gapCats });
    const nodeIds = runs.map((run, runIndex) => addFanRun(theme, { ...(edges ? { edges: edges[runIndex] } : {}), run, runIndex, band, bandIndex, lowRow, highRow, cats, interpolation, fanLadder, showBounds: fan.showBounds, pathFor, reversePathTail, fmt, numberSpec, occupied, fanNodes, hairNodes, gapCats })).filter((id): id is Id => id !== null);
    if (nodeIds.length > 0) fanMarks.push({ bandIndex, nodeIds, low: band.low.id, high: band.high.id, label: band.label });
  });
  if (gapCats.size > 0) warnings.push({
    code: 'fan-band-gap',
    severity: 'warn',
    message: `a fan band has no drawable run at ${[...gapCats].map((id) => `'${id}'`).join(', ')} — a category where either bound is null ends the band there rather than bridging an interval that was never declared`,
    suggest: 'supply both bounds at those categories, or accept the break',
  });
  if (fanNodes.length === 0) return;
  marks.fan = fanMarks;
  const analyticalNodes = nodes.splice(analyticalSceneStart);
  const areas = analyticalNodes.filter((node) => node.part === 'area');
  const baseline = analyticalNodes.filter((node) => node.part === 'baseline');
  const foreground = analyticalNodes.filter((node) => node.part !== 'area' && node.part !== 'baseline');
  pushAll(nodes, fanNodes);
  pushAll(nodes, areas);
  pushAll(nodes, hairNodes);
  pushAll(nodes, baseline);
  pushAll(nodes, foreground);
}
