import { localeStrings } from '../../strings/line';
import { stringFields } from '../../strings';
import type { StringsSpec } from '../../types/options';
import type { Theme } from '../../types/theme';
import { strokeToken } from '../../theme';
import { spread1D, spread1DResult, warnSpreadOverflow } from '../../collide';
import { fmtPathNumber as fmtN } from '../../curve';
import type { Point, Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import { PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import { NormalizeError } from '../../normalize/shared';
import type { FontSpec } from '../../text';
import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { LabelContent } from '../../types/options';
import type { LintWarning, SceneNode } from '../../types/scene';
import type { EndLabel, NormSer } from './context';
import { foldBumpValue, nameSpreadSizes } from './labels';
import { lineLabelModes } from './labelModes';
import type { BumpDerived, LineMarks } from './layout';
import type { LineOptions } from './types';
import { maxOf, minOf } from '../../arrays';

type BumpDirection = 'higherIsBetter' | 'lowerIsBetter';
type ValueAxis = NonNullable<LineOptions['valueAxis']>;

/**
 * the values a first pass could not seat at a point a name stands
 * beside, keyed by label id, which the next pass prints in that name.
 */
export const BUMP_FOLDED = Symbol('bumpFolded');

function validateBumpInput(input: {
  options: LineOptions;
  targetsLength: number;
  dataSeries: NormSer[];
  cats: Category[];
}): void {
  const { options, targetsLength, dataSeries, cats } = input;
  if (dataSeries.length < 2) throw new NormalizeError('bump-two-series', 'series', 'a rank chart needs at least two data-role series — one entity is a flat line at rank 1, which states nothing about who overtook whom');
  if (cats.length < 2) throw new NormalizeError('bump-two-categories', 'categories', "a rank chart needs at least two categories — crossings are the message and one period has none", "use chart type 'slope' for two points");
  const conflicts: [string, boolean][] = [
    ['rebase100', Boolean(options.rebase100)],
    ['ratioTier', options.ratioTier !== undefined],
    ['gapFill', options.gapFill !== undefined],
    ['fan', options.fan !== undefined],
    ['targets', targetsLength > 0],
  ];
  for (const [name, present] of conflicts) if (present) throw new NormalizeError('bump-option-conflict', name, `'${name}' is defined on VALUES; variant 'bump' plots derived ranks, and applying it to a rank would produce a confident, wrong exhibit — remove '${name}' or drop variant 'bump'`);
}

function validateBumpIds(dataSeries: NormSer[]): void {
  const idCounts = new Map<Id, number>();
  for (const series of dataSeries) idCounts.set(series.id, (idCounts.get(series.id) ?? 0) + 1);
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicateIds.length > 0) throw new NormalizeError(
    'bump-duplicate-series-id',
    'series',
    `series id${duplicateIds.length === 1 ? '' : 's'} ${duplicateIds.map((id) => `'${id}'`).join(', ')} appear more than once — the ranking receipt is keyed by series id, so two entities under one id cannot both be ranked, drawn or described`,
    'give every ranked entity its own id',
  );
}

function warnBumpAxis(input: {
  options: LineOptions;
  valueAxis: ValueAxis;
  warnings: LintWarning[];
}): void {
  const { options, valueAxis, warnings } = input;
  const sharedYDeclared = typeof options.scaleGroup?.y === 'string';
  const ignoredAxisOptions = [
    valueAxis.min !== undefined && !sharedYDeclared ? 'min' : null,
    valueAxis.max !== undefined && !sharedYDeclared ? 'max' : null,
    valueAxis.break !== undefined ? 'break' : null,
  ].filter((name): name is string => name !== null);
  if (ignoredAxisOptions.length > 0) warnings.push({
    code: 'bump-axis-option-ignored',
    severity: 'warn',
    message: `valueAxis ${ignoredAxisOptions.map((name) => `'${name}'`).join(', ')} ignored — the rank domain is derived from the data (1 .. maxRank), not authored`,
  });
  if (valueAxis.show === false) warnings.push({ code: 'bump-axis-required', severity: 'warn', message: 'valueAxis.show:false ignored — a rank chart without rank ticks cannot be read; the axis is drawn' });
  // Printed values are the measure, not the rank: the unit rides on each of
  // them, and a bare number beside rank ticks says nothing about what it is.
  const printsValues = lineLabelModes(options, 'bump', 0).values !== 'none';
  if (options.unit && !printsValues) warnings.push({ code: 'bump-unit-ignored', severity: 'warn', message: `unit '${options.unit}' ignored — the plotted quantity is rank, which has no unit`, suggest: 'the plotted quantity is rank; put the measure in the subtitle' });
  if (printsValues && !options.unit && !options.format) warnings.push({
    code: 'bump-values-unnamed',
    severity: 'warn',
    message: 'the printed values are the measure behind the ranks, and with no unit or format nothing on the page says what they are',
    suggest: "set unit (each value carries it) or a format such as '1.0%', or valueLabels 'none'",
  });
}

export function prepareBump(input: {
  isBump: boolean;
  options: LineOptions;
  valueAxis: ValueAxis;
  targetsLength: number;
  dataSeries: NormSer[];
  refSeries: NormSer[];
  seriesNorm: NormSer[];
  cats: Category[];
  warnings: LintWarning[];
}): { bumpDirection: BumpDirection; dataSeries: NormSer[]; refSeries: NormSer[] } {
  const { isBump, options, valueAxis, targetsLength, seriesNorm, cats, warnings } = input;
  const bumpDirection = options.bump?.direction ?? 'higherIsBetter';
  if (!isBump) return { bumpDirection, dataSeries: input.dataSeries, refSeries: input.refSeries };
  validateBumpInput({ options, targetsLength, dataSeries: input.dataSeries, cats });
  let refSeries = input.refSeries;
  if (refSeries.length > 0) {
    warnings.push({ code: 'bump-reference-series-dropped', severity: 'warn', message: `reference series ${refSeries.map((series) => `'${series.id}'`).join(', ')} name levels on the value scale, which the rank axis does not carry — dropped`, suggest: 'plot the reference on a value line chart, or give it role: "data" to rank it with the others' });
    for (const series of refSeries) seriesNorm.splice(seriesNorm.indexOf(series), 1);
    refSeries = [];
  }
  const empty = input.dataSeries.filter((series) => series.vals.every((cell) => cell.v === null));
  if (empty.length > 0) {
    warnings.push({ code: 'bump-series-empty', severity: 'warn', message: `${empty.map((series) => `'${series.id}'`).join(', ')} carry no value in any category and therefore hold no rank anywhere — dropped`, owner: { seriesId: empty[0]!.id } });
    for (const series of empty) seriesNorm.splice(seriesNorm.indexOf(series), 1);
  }
  const dataSeries = seriesNorm.filter((series) => series.role !== 'reference');
  if (dataSeries.length < 2) throw new NormalizeError('bump-two-series', 'series', `after dropping entities that hold no rank anywhere, ${dataSeries.length} data-role series remain — a rank chart needs at least two`);
  validateBumpIds(dataSeries);
  const bridging = dataSeries.filter((series) => series.interpolateGaps);
  if (bridging.length > 0) {
    warnings.push({ code: 'bump-gap-bridging-disabled', severity: 'warn', message: `gap bridging is forced off for ${bridging.map((series) => `'${series.id}'`).join(', ')} — bridging a period with no value would draw a rank the entity never held` });
    for (const series of bridging) series.interpolateGaps = false;
  }
  warnBumpAxis({ options, valueAxis, warnings });
  return { bumpDirection, dataSeries, refSeries };
}

export function deriveBumpRanks(input: {
  isBump: boolean;
  direction: BumpDirection;
  dataSeries: NormSer[];
  cats: Category[];
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  fmt: (value: number) => string;
  format: LineOptions['format'];
  warnings: LintWarning[];
}): BumpDerived | undefined {
  const { isBump, direction, dataSeries, cats, pv, rowOf, fmt, format, warnings } = input;
  if (!isBump) return undefined;
  // Each value is formatted once: the rank loop compares every pair, and the formatter is
  // the expensive part of a bump pass.
  const shown = new Map<number | string, string>();
  const read = (value: number): string => {
    const key = Object.is(value, -0) ? '-0' : value;
    let text = shown.get(key);
    if (text === undefined) { text = fmt(value); shown.set(key, text); }
    return text;
  };
  const sameToTheReader = (a: number, b: number): boolean => a === b || read(a) === read(b);
  const better = (a: number, b: number): boolean => sameToTheReader(a, b) ? false : direction === 'higherIsBetter' ? a > b : a < b;
  const ranks: Record<Id, (number | null)[]> = {};
  const participants: Record<Id, number> = {};
  const ties: BumpDerived['ties'] = [];
  let maxRank = 1;
  for (const series of dataSeries) ranks[series.id] = cats.map(() => null);
  cats.forEach((category, ci) => {
    const present = dataSeries.map((series) => ({ series, value: series.vals[ci]!.v })).filter((entry): entry is { series: NormSer; value: number } => entry.value !== null);
    participants[category.id] = present.length;
    const byRank = new Map<number, Id[]>();
    for (const entry of present) {
      const rank = 1 + present.filter((other) => better(other.value, entry.value)).length;
      ranks[entry.series.id]![ci] = rank;
      maxRank = Math.max(maxRank, rank);
      byRank.set(rank, [...(byRank.get(rank) ?? []), entry.series.id]);
    }
    for (const [rank, seriesIds] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
      if (seriesIds.length < 2) continue;
      ties.push({ categoryId: category.id, rank, seriesIds });
      warnings.push({ code: 'bump-rank-tie', severity: 'warn', message: `category '${category.id}': ${seriesIds.map((id) => `'${id}'`).join(', ')} share rank ${rank} — drawn at the same height, and the next rank is skipped (competition ranking)`, owner: { categoryId: category.id } });
    }
  });
  const census = cats.map((category) => participants[category.id]!);
  if (new Set(census).size > 1) warnings.push({ code: 'bump-participants-vary', severity: 'info', message: `the ranked field changes size across periods (${cats.map((category) => `${category.label ?? category.id}: ${participants[category.id]}`).join(', ')}) — rank ${maxRank} out of ${maxOf(census)} is not the same standing as rank ${maxRank} out of ${minOf(census)}` });
  for (const series of dataSeries) {
    const row = pv[rowOf.get(series)!]!;
    const seriesRanks = ranks[series.id]!;
    for (let ci = 0; ci < cats.length; ci++) row[ci] = seriesRanks[ci]!;
  }
  return { direction, method: 'competition', maxRank, ranks, ties, participants, comparedAt: format ?? 'auto' };
}

export function bumpMethodNote(bump: BumpDerived | undefined, format: LineOptions['format'], strings?: StringsSpec): string[] {
  if (!bump) return [];
  const words = { ...localeStrings(), ...strings };
  return [stringFields(words.rankMethod, {
    direction: bump.direction === 'higherIsBetter' ? words.higherBetter : words.lowerBetter,
    format: format ? stringFields(words.rankFormat, { format }) : '',
    ring: bump.ties.length > 0 ? words.rankRing : '',
  })];
}

export function buildBumpStartLabels(input: {
  isBump: boolean;
  endContent: LabelContent | null;
  dataSeries: NormSer[];
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  cats: Category[];
  composeText: (content: LabelContent, abs: number | null, pct: number | null, category: string, series: string) => string;
  nameBlock: (text: string, seriesId?: Id) => { lines: string[]; w: number; h: number; title?: string };
  /** values that read in the name, keyed by the value's label id. */
  folded?: ReadonlyMap<string, string>;
}): { startLabels: EndLabel[]; startReserve: number } {
  const { isBump, endContent, dataSeries, pv, rowOf, cats, composeText, nameBlock } = input;
  const startLabels: EndLabel[] = [];
  if (isBump && endContent) dataSeries.forEach((series, dataIdx) => {
    const row = pv[rowOf.get(series)!]!;
    const ci = row.findIndex((value) => value !== null);
    if (ci === -1) return;
    const name = composeText(endContent, null, null, cats[ci]!.label ?? cats[ci]!.id, series.label);
    if (!name) return;
    const { text, ...block } = foldBumpValue(name, input.folded?.get(`point:${series.id}:${cats[ci]!.id}`), (line) => nameBlock(line, series.id));
    startLabels.push({ id: `series-start:${series.id}`, kind: 'series', s: series, dataIdx, ci, text, w: block.w, lines: block.lines, h: block.h, ...(block.title !== undefined ? { title: block.title } : {}), ...(block.font ? { font: block.font } : {}) });
  });
  const railStartLabels = startLabels.filter((label) => label.ci === 0);
  return { startLabels, startReserve: railStartLabels.length > 0 ? maxOf(railStartLabels.map((label) => label.w)) + 14 : 0 };
}

export function renderBumpTies(theme: Theme, input: {
  bump: BumpDerived | undefined;
  marks: LineMarks;
  nodes: SceneNode[];
  occupied: OccupiedIndex;
}): void {
  const { bump, marks, nodes, occupied } = input;
  if (!bump || bump.ties.length === 0) return;
  const radius = 7;
  for (const tie of bump.ties) {
    const member = marks.series.find((item) => tie.seriesIds.includes(item.seriesId));
    const point = member?.points.find((item) => item.categoryId === tie.categoryId);
    if (!point) continue;
    const id: Id = `tie:${tie.categoryId}:${tie.rank}`;
    nodes.push({
      t: 'path',
      id,
      d: `M${fmtN(point.x - radius)} ${fmtN(point.y)}A${radius} ${radius} 0 1 0 ${fmtN(point.x + radius)} ${fmtN(point.y)}A${radius} ${radius} 0 1 0 ${fmtN(point.x - radius)} ${fmtN(point.y)}`,
      stroke: { token: 'markInk' },
      width: strokeToken(theme, 'mark'),
      owner: { categoryId: tie.categoryId },
      part: 'tie',
      display: { value: `rank ${tie.rank}`, state: `${tie.seriesIds.length} tied` },
    });
    occupied.claim({ x: point.x - radius, y: point.y - radius, w: radius * 2, h: radius * 2 }, 'mark', { categoryId: tie.categoryId });
  }
}

/**
 * The ring on a shared rank carries a meaning of its own, so it carries its
 * own word: "Tied" beside the first ring, above it first. Every ring is the
 * same mark, so one word names them all. The method note says the same, but
 * a host that drops footnotes would leave a bare ring.
 */
export function placeBumpTieLabels(input: {
  strings?: StringsSpec;
  bump: BumpDerived | undefined;
  marks: LineMarks;
  outsideRankBand: (rect: Rect) => boolean;
  labelRequests: LabelRequest[];
  font: FontSpec;
  measure: (text: string, font: FontSpec) => { width: number; height: number };
}): void {
  const { bump, marks, outsideRankBand, labelRequests, font, measure } = input;
  const pointOf = (tie: BumpDerived['ties'][number]) =>
    marks.series.find((item) => item.seriesId === tie.seriesIds[0])?.points.find((item) => item.categoryId === tie.categoryId);
  const tie = bump?.ties.find(pointOf);
  if (!tie) return;
  const point = pointOf(tie)!;
  // a displaced caption carries the same ring symbol, so it still names the mark.
  const words = { ...localeStrings(), ...input.strings };
  const text = `${words.tiedSymbol} ${words.tied}`;
  const { width: w, height: h } = measure(text, font);
  // Beside its ring the word needs no symbol;
  // only the key seat above the plot, away from the ring, carries it.
  const word = measure(words.tied, font).width;
  const radius = 7;
  const slots: [string, Rect][] = [
    // First above and right of the ring, clear of its line.
    ['aboveRightOfRing', { x: point.x + radius + 2, y: point.y - radius - h + 2, w: word, h }],
    ['aboveRing', { x: point.x - w / 2, y: point.y - radius - 2 - h, w, h }],
    ['belowRing', { x: point.x - w / 2, y: point.y + radius + 2, w, h }],
    ['rightOfRing', { x: point.x + radius + 3, y: point.y - h / 2, w, h }],
    ['leftOfRing', { x: point.x - radius - 3 - w, y: point.y - h / 2, w, h }],
  ];
  // larger tie captions can take a clear diagonal seat and lead back to the ring.
  for (const dx of [12, -12 - w, 28, -28 - w, 48, -48 - w]) {
    for (const dy of [-h - 3, 3, -h - 14, 14]) slots.push(['besideRing', { x: point.x + dx, y: point.y + dy, w, h }]);
  }
  const keyY = minOf(marks.series.flatMap(series => series.points.map(point => point.y))) - h - 10;
  for (const x of [point.x - w / 2, point.x + 12, point.x - w - 12]) slots.push(['tieKey', { x, y: keyY, w, h }]);
  labelRequests.push({
    id: `tieLabel:${tie.categoryId}:${tie.rank}`,
    kind: 'scale',
    owner: { categoryId: tie.categoryId },
    text,
    lines: [text],
    typeRole: 'axis', font,
    // The explanation of a mark outranks any value, a highlighted one too:
    // under valueLabels 'all' a value gives way, never the word for the ring.
    priority: PRIORITY.grandTotal,
    candidates: slots.filter(([slot, rect]) => slot === 'tieKey' || !outsideRankBand(rect)).map(([slot, rect], penalty) => ({
      slot, rect, penalty, ...(slot === 'besideRing' ? { leaderFrom: point } : {}), ...(slot === 'aboveRightOfRing' ? { lines: [words.tied] } : {}),
    })),
  });
}

/**
 * A tie's members print one value, the same at the shared point. The noted
 * tie carries it in its note, "Tied · 8.4%", which outranks every value; the
 * other ties keep their first member's value. Left apart, the members' copies
 * collided and the one that stayed sat by the next rank down.
 */
export function joinTieValues(input: {
  bump: BumpDerived | undefined;
  labelRequests: LabelRequest[];
  font: FontSpec;
  measure: (text: string, font: FontSpec) => { width: number; height: number };
}): void {
  const { bump, labelRequests, font, measure } = input;
  for (const tie of bump?.ties ?? []) {
    const ids = new Set(tie.seriesIds.map((id) => `point:${id}:${tie.categoryId}`));
    const values = labelRequests.filter((request) => ids.has(request.id));
    if (values.length === 0) continue;
    const note = labelRequests.find((request) => request.id === `tieLabel:${tie.categoryId}:${tie.rank}`);
    const keep = note ? undefined : values[0];
    for (let index = labelRequests.length - 1; index >= 0; index--) {
      const request = labelRequests[index]!;
      if (ids.has(request.id) && request !== keep) labelRequests.splice(index, 1);
    }
    if (!note) continue;
    const text = `${note.text} · ${values[0]!.text}`;
    const w = measure(text, font).width;
    const before = note.candidates[0]?.rect.w ?? w;
    note.text = text;
    note.lines = [text];
    // Every seat keeps its side of the ring: centred above and below, the
    // left seat ending where it ended.
    // The bare word beside the ring takes the value too: "Tied · 8.4%".
    const bare = note.candidates.find((candidate) => candidate.lines)?.lines?.[0];
    const bareText = bare === undefined ? undefined : `${bare} · ${values[0]!.text}`;
    const bareW = bareText === undefined ? 0 : measure(bareText, font).width;
    note.candidates = note.candidates.map((candidate) => candidate.lines && bareText !== undefined ? {
      ...candidate, lines: [bareText], rect: { ...candidate.rect, w: bareW },
    } : ({
      ...candidate,
      rect: {
        ...candidate.rect,
        w,
        x: candidate.slot === 'rightOfRing' ? candidate.rect.x
          : candidate.slot === 'leftOfRing' ? candidate.rect.x + before - w
            : candidate.rect.x + before / 2 - w / 2,
      },
    }));
  }
}

function startLabelCandidates(input: {
  slots: [slot: string, rect: Rect, penalty: number][];
  desiredY: number;
  leaderFrom: Point | undefined;
  width: number;
  height: number;
  outsideRankBand: (rect: Rect) => boolean;
}): SlotCandidate[] {
  const { slots, desiredY, leaderFrom, width, height, outsideRankBand } = input;
  return slots.flatMap(([slot, rect, penalty]) => {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height || outsideRankBand(rect)) return [];
    return [{ slot, rect, penalty, ...(leaderFrom && Math.abs(rect.y + rect.h / 2 - desiredY) > 3 ? { leaderFrom } : {}) }];
  });
}

function pushStartLabel(input: {
  label: EndLabel;
  desiredY: number;
  leaderFrom: Point | undefined;
  slots: [slot: string, rect: Rect, penalty: number][];
  size: { width: number; height: number };
  outsideRankBand: (rect: Rect) => boolean;
  endpointLeaderAnchors: Map<Id, Point>;
  labelRequests: LabelRequest[];
  labelFont: FontSpec;
  highlights: Set<Id>;
  cats: Category[];
}): void {
  const { label, desiredY, leaderFrom, slots, size, outsideRankBand, endpointLeaderAnchors, labelRequests, labelFont, highlights, cats } = input;
  if (leaderFrom) endpointLeaderAnchors.set(label.id, leaderFrom);
  labelRequests.push({
    id: label.id,
    kind: 'series',
    owner: { seriesId: label.s.id, categoryId: cats[label.ci]!.id },
    text: label.text,
    lines: label.lines,
    ...(label.title !== undefined ? { title: label.title } : {}),
    typeRole: 'label', font: label.font ?? labelFont, ...(label.font ? { fontStep: label.font } : {}),
    // A name says whose line it is: an entrant's first value, which takes the
    // seat over its point under valueLabels 'all', gives way to it.
    priority: PRIORITY.endpoint + 50 + (highlights.has(label.s.id) ? PRIORITY.highlightBonus : 0),
    candidates: startLabelCandidates({ slots, desiredY, leaderFrom, width: size.width, height: size.height, outsideRankBand }),
    // a name off its rank row takes a leader only where the leader
    // crosses no name and no rank number; else its next seat, else none.
    leaderClear: true, leaderClearsAxis: true,
  });
}

export function placeBumpStartLabels(input: {
  startLabels: EndLabel[];
  marks: LineMarks;
  cats: Category[];
  plot: Rect;
  size: { width: number; height: number };
  leftMargin: number;
  outsideRankBand: (rect: Rect) => boolean;
  endpointLeaderAnchors: Map<Id, Point>;
  labelRequests: LabelRequest[];
  labelFont: FontSpec;
  highlights: Set<Id>;
  warnings: LintWarning[];
  /** Width of the value printed at a name's own point, 0 where none prints. */
  valueWidth?: (label: EndLabel) => number;
}): void {
  const { startLabels, marks, cats, plot, size, leftMargin, outsideRankBand, endpointLeaderAnchors, labelRequests, labelFont, highlights, warnings } = input;
  const railLabels = startLabels.filter((label) => label.ci === 0);
  const entrantLabels = startLabels.filter((label) => label.ci !== 0);
  const anchorOf = (label: EndLabel): Point | null => marks.series.find((item) => item.seriesId === label.s.id)?.points.find((item) => item.categoryId === cats[label.ci]!.id) ?? null;
  if (railLabels.length > 0) {
    const anchors = railLabels.map(anchorOf);
    const sizes = nameSpreadSizes(railLabels.map((label) => label.h), anchors.map((anchor) => anchor?.y));
    const items = anchors.map((anchor, index) => ({ desired: anchor?.y ?? plot.y + plot.h / 2, size: sizes[index]! }));
    const railSpread = spread1DResult(items, [plot.y, plot.y + plot.h], 2);
    warnSpreadOverflow(warnings, railSpread.fits, 'start-rail labels exceed the plot height even after spreading — labels stay bounded but overlap; fewer series or a larger canvas fixes it');
    const spreadPositions = railSpread.fits ? railSpread.positions : spread1D(items, [plot.y, plot.y + plot.h], 2);
    railLabels.forEach((label, index) => {
      const anchor = anchors[index];
      const desiredY = anchor?.y ?? plot.y + plot.h / 2;
      const rect = { x: leftMargin - 6 - label.w, y: spreadPositions[index]! - label.h / 2, w: label.w, h: label.h };
      const leaderFrom = anchor ? { x: Math.max(anchor.x - 4, rect.x + rect.w + 2), y: anchor.y } : undefined;
      pushStartLabel({ label, desiredY, leaderFrom, slots: [['lineStart', rect, 0], ['lineStartShifted', { ...rect, y: rect.y + label.h + 2 }, 1]], size, outsideRankBand, endpointLeaderAnchors, labelRequests, labelFont, highlights, cats });
    });
  }
  entrantLabels.forEach((label) => {
    const anchor = anchorOf(label);
    const desiredY = anchor?.y ?? plot.y + plot.h / 2;
    const x = (anchor?.x ?? plot.x) + 6;
    const rect = { x, y: desiredY - label.h / 2, w: label.w, h: label.h };
    const leaderFrom = anchor ? { x: Math.min(anchor.x + 4, rect.x - 2), y: anchor.y } : undefined;
    // Left of its first marker first, level with it, where the rank it enters
    // is still empty, and clear of the value over that marker: over the next
    // point the name took the seat of that point's value, which then had none
    // (Tarn's 3.8% in Q1'24).
    const left = { ...rect, x: (anchor?.x ?? plot.x) - Math.max(6, (input.valueWidth?.(label) ?? 0) / 2 + 4) - label.w };
    pushStartLabel({ label, desiredY, leaderFrom, slots: [['entrantStartLeft', left, 0], ['entrantStart', rect, 1], ['entrantStartAbove', { ...rect, y: rect.y - label.h - 4 }, 2], ['entrantStartBelow', { ...rect, y: rect.y + label.h + 4 }, 2]], size, outsideRankBand, endpointLeaderAnchors, labelRequests, labelFont, highlights, cats });
  });
}
