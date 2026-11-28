import { a11yDescription } from '../../a11yDescription';
import { chartString } from '../../strings/cohort';
import { structureCount } from '../../structureCounts';
/**
 * Cohort retention triangle — a SEMANTIC ADAPTER. It owns the contract
 * (counts in, derived rates out, refusals) and delegates every pixel to the
 * matrix engine; it adds no geometry, appends nothing after the engine
 * returns, and therefore inherits the occupied-index and label-solver
 * guarantees unchanged.
 *
 * Two things the adapter must never let through:
 *  1. HOST VOCABULARY. An agent that authored `cohorts` must never be told
 *     about the engine underneath, so the full cohort contract is validated
 *     BEFORE delegation and every option that would make the host speak for
 *     itself (palette, sort, valueAxis) is answered here and stripped.
 *  2. THE HOST'S OWN COLUMN MEAN. It is the unweighted mean of the observed
 *     cells in a column; on a triangle that is ever fewer cohorts presented as
 *     an average. `derived` is rebuilt from this package's own arithmetic and
 *     the host's max/min/rowMeans/colMeans never leave.
 *  3. THE HOST'S OWN RAMP ANCHOR. It is the largest OBSERVED cell, so a single
 *     re-activation above its own base repaints the whole exhibit paler and
 *     moves the darkest ink onto the anomaly. This adapter pins the ramp at
 *     100% — the definition of a full cohort — and paints period 0, which is
 *     100% by construction and can never vary, as structural furniture rather
 *     than as the strongest signal on the page.
 */

import { chartTheme } from '../chartEnv';
import { clamp } from '../../geometry';
import { layoutHeatmap, type HeatmapLayoutOptions } from '../heatmap/layout';
import { hostedLayout } from '../../normalize/innerRefusal';
import { sideKeyGivesWay } from '../../sizing';
import { paintColor, resolveSemanticPaletteTheme, semanticPalettePaint } from '../../theme';
import type { Cell, Id } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { HeatmapOptions } from '../../types/options';
import type { Geometry, Paint, SceneNode } from '../../types/scene';
import { AVERAGE_ROW_ID, deriveRetention, missingCohortRate } from './retention';
import { cohortBasisWarnings, cohortFormula } from './wording';
import { layoutCohortExhibit, normalizeVisiblePeriods } from './exhibit';
import { cohortOptionRefusals } from './optionRefusals';
import type {
  CohortCellMark,
  CohortData,
  CohortDerived,
  CohortMarks,
  CohortOptions,
} from './types';
import { ruleFormatter } from '../../numberSets';
import { authoredNotes, withAuthoredFootnotes } from '../../frame';
import { disclosureNote, keepShownNotes } from '../../notes';
import { pushAll } from '../../arrays';
import { claimId, HOST_CLAIMS, type HostClaims } from '../../claims/ids';

/** Options the adapter answers itself rather than forwarding. */
const ANSWERED_HERE = ['palette', 'sort', 'valueAxis', 'annotations'] as const;

export function layoutCohort(
  data: CohortData,
  options: CohortOptions = {},
): Geometry<CohortMarks, CohortDerived> {
  const warnings = cohortBasisWarnings(options);
  pushAll(warnings, cohortOptionRefusals(options));
  if (options.variant !== undefined && options.variant !== 'heatmap') {
    const geometry = layoutCohortExhibit(data, options);
    // Backstop for direct layout() callers — the options schema refuses this
    // combination upstream. The exhibit presets draw a fixed label set and
    // never consult the toggle map, so an authored `labels` must not pass
    // silently.
    if ((options as { labels?: unknown }).labels !== undefined) {
      geometry.warnings.push({
        code: 'labels-exhibit-unsupported',
        severity: 'warn',
        message:
          "cohort exhibit variants do not consult 'labels' — pure and stepped draw a fixed label set, so the option changed nothing",
        suggest: "drop 'labels', or set variant 'heatmap', which honours it",
      });
    }
    pushAll(geometry.warnings, warnings);
    return geometry;
  }
  const basis = options.basis ?? 'cohort';
  // `total` wins over `averages`: one row, two names.
  const averagesMode = options.total ?? options.averages ?? false;

  // Periods are ordinal time-since-acquisition and cohorts are chronological:
  // reordering either axis by value scrambles the staircase into a shape that
  // is neither a triangle nor true. 'reverse' (newest cohort first) is a
  // reading choice, not a reordering by value, so it is allowed.
  if (options.sort?.categories !== undefined && options.sort.categories !== 'sheet') {
    warnings.push({
      code: 'cohort-sort-ignored',
      severity: 'warn',
      message: `sort.categories '${options.sort.categories}' was ignored — periods are ordinal time since cohort start and cannot be reordered by value`,
      suggest: 'remove options.sort.categories',
    });
  }
  const segmentSort = options.sort?.segments;
  if (segmentSort === 'asc' || segmentSort === 'desc') {
    warnings.push({
      code: 'cohort-sort-ignored',
      severity: 'warn',
      message: `sort.segments '${segmentSort}' was ignored — ranking cohorts by mean retention destroys the chronological staircase the triangle depends on`,
      suggest: "use sort.segments 'reverse' to put the newest cohort at the top",
    });
  }
  if (options.valueAxis !== undefined) {
    warnings.push({
      code: 'cohort-option-ignored',
      severity: 'warn',
      message: 'options.valueAxis was ignored — a retention triangle has no value axis; colour and the in-cell percentages carry the scale',
      suggest: 'remove options.valueAxis',
    });
  }

  const {
    derived: allPeriods,
    warnings: derivedWarnings,
    notMeaningful,
  } = deriveRetention(data, {
    basis,
    averages: averagesMode,
  });
  pushAll(warnings, derivedWarnings);

  const periodCount = allPeriods.periodCount;
  const periodIds = Array.from({ length: periodCount }, (_, t) => `t${t}`);
  const periodIndex = new Map<Id, number>();
  periodIds.forEach((id, t) => periodIndex.set(id, t));
  const periodNames = periodLabels(data.periodLabel, periodCount, options);
  // Rates and averages are derived over all periods: each average belongs to one column and goes with it.
  const everyPeriod = periodIds.map((_, t) => t);
  const visible = normalizeVisiblePeriods(options.visiblePeriods, everyPeriod, warnings);
  const shown = new Set(visible);
  const derived: CohortDerived = options.visiblePeriods === undefined ? allPeriods : { ...allPeriods, visiblePeriods: visible };
  const visibleSpan = (row: CohortDerived['cohorts'][number]) => visible.filter((t) => t < row.observedPeriods);

  // The base belongs in the ROW LABEL, not in the grid: a count in the grid
  // would either pollute the colour ramp or need a second scale, and without a
  // visible base every comparison down a column is unanchored.
  const baseSuffix = new Map<Id, string>();
  // The bases are one count set of cells (the size column is its own set).
  const baseText = ruleFormatter(derived.cohorts.map((row) => row.base), options.locale?.language, { cell: true });
  for (const row of derived.cohorts) {
    baseSuffix.set(row.id, `(n\u00a0=\u00a0${baseText(row.base)})`);
  }
  const cohortLabel = (index: number): string => {
    const authored = data.cohorts[index]!.label ?? data.cohorts[index]!.id;
    return `${authored} ${baseSuffix.get(derived.cohorts[index]!.id)!}`;
  };

  // ---- the colour system, owned here (see header note 3) ----
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  /**
   * The engine's continuous ramp is `1 - v/max(observed)`. Same shape here, but
   * the anchor is PINNED AT 100% — the definition of a whole cohort. Without
   * the pin, one re-activation cell above its own base rescales every other
   * cell paler and hands the darkest ink to the anomaly instead of the story.
   * Values above 100% clamp to full ink; `cohort-above-base` names them.
   */
  const rampTint = (r: number): number => clamp(1 - Math.min(r, 1), 0, 1);
  const cohortPaint = (r: number): Paint =>
    // The ramp is tints of series 1.
    semanticPalettePaint(theme, options.palette, 'sequential', rampTint(r));
  /**
   * Period 0 is 100% BY CONSTRUCTION and can never vary. On the ramp it is the
   * darkest, first-read ink on the page and carries no information at all, so
   * it is painted as structural furniture. Its constant value is stated once in
   * the method note instead of being repeated in every cell — which is also why
   * losing its in-cell numbers on a small canvas is not a silent loss.
   */
  const ANCHOR_PAINT = semanticPalettePaint(theme, options.palette, 'neutral', 0.86);
  /** The computed row is not a cohort; it rides its own grey ramp. */
  const averagePaint = (r: number): Paint =>
    semanticPalettePaint(theme, options.palette, 'neutralMark', rampTint(r));
  const cssOf = (paint: Paint): string => paintColor(theme, paint);
  // Paints are handed to the engine as an explicit fill so the label solver
  // picks its ink against the colour actually painted, then written back onto
  // the scene as SYMBOLIC paint (token + tint) so the theme boundary holds.
  const cellPaint = new Map<Id, Paint>();
  const cellFor = (rowId: Id, t: number, r: number | null, average: boolean): Cell => {
    if (r === null) return null;
    const paint = t === 0 ? ANCHOR_PAINT : average ? averagePaint(r) : cohortPaint(r);
    cellPaint.set(`cell:${rowId}:t${t}`, paint);
    // Without a format the heatmap prints the shown rates as one percent set.
    return { pct: r * 100, fill: cssOf(paint) };
  };

  // 'reverse' is the one sort that survives: it is a reading choice (newest
  // cohort first), not a reordering by value. The computed row is emitted at
  // the opposite end so it stays at the foot of the exhibit either way.
  const reverseRows = segmentSort === 'reverse';
  // An average withheld for a missing count rests on no cohorts, so no support disclosure counts it.
  const shownSupports = derived.averages?.flatMap((a, t) => !shown.has(t) || derived.cohorts.some(row => missingCohortRate(row, t, basis)) ? [] : [{ support: a.support, t }]) ?? [];
  const supports = shownSupports.map((a) => a.support);
  // The support set is the whole health of a computed average, and in a
  // triangle it collapses to the right. Naming the row 'Weighted average' and
  // nothing else lets a reader read a trend across a row whose constituents
  // fall from six cohorts to one, with no way to tell. The range goes in the
  // row label — the one piece of ink that belongs to this row alone.
  const averageSupportSuffix =
    supports.length === 0
      ? ''
      : supports[0] === supports[supports.length - 1]
        ? `(${chartString(options, 'support', { count: String(supports[0]) })})`
        : `(${chartString(options, 'supportRange', { first: String(supports[0]), last: String(supports[supports.length - 1]) })})`;
  const averageLabel =
    [chartString(options, 'weightedAverage'), averageSupportSuffix].filter(Boolean).join(' ');
  const averageRow = derived.averages
    ? [
        {
          id: AVERAGE_ROW_ID,
          label: averageLabel,
          values: visible.map((t): Cell => cellFor(AVERAGE_ROW_ID, t, derived.averages![t]!.value, true)),
        },
      ]
    : [];
  const hostData: ChartData = {
    categories: visible.map((t) => ({ id: periodIds[t]!, label: periodNames[t]! })),
    series: [
      ...(reverseRows ? averageRow : []),
      ...derived.cohorts.map((row, index) => ({
        id: row.id,
        label: cohortLabel(index),
        values: visible.map((t): Cell => {
          if (t >= row.observedPeriods) return null; // not yet reached
          return cellFor(row.id, t, row.retention[t]!, false);
        }),
      })),
      ...(reverseRows ? [] : averageRow),
    ],
  };

  const baseFootnotes = [
    ...authoredNotes(options),
    ...(derived.cohorts.some(row => visibleSpan(row).some((t) => missingCohortRate(row, t, basis))) ? [disclosureNote(chartString(options, 'hatchMissing'))] : []),
    ...cohortNotes(options, basis, shownNotMeaningful(data, derived, visible, notMeaningful)),
  ];

  // Each cell value the matrix prints names its rate claim (claimsForChart, case 'cohort'): a cohort's rate of a
  // period it has reached, or the weighted average of the period.
  const rowById = new Map(derived.cohorts.map((row) => [row.id, row]));
  const hostClaims: HostClaims = ({ kind, owner }) => {
    const t = periodIndex.get(owner.categoryId ?? '');
    if (kind !== 'point' || t === undefined || owner.seriesId === undefined) return undefined;
    if (owner.seriesId === AVERAGE_ROW_ID) return derived.averages?.[t] ? [claimId('cohort-average', `t${t}`)] : undefined;
    return t < (rowById.get(owner.seriesId)?.observedPeriods ?? 0) ? [claimId('cohort', owner.seriesId, `t${t}`)] : undefined;
  };

  const build = (): ReturnType<typeof layoutHeatmap> => {
    // Only the author's own notes keep a number; the rest are derived.
    const inner = withAuthoredFootnotes<HeatmapLayoutOptions & { [HOST_CLAIMS]: HostClaims }>({
      ...stripAnswered(options),
      [HOST_CLAIMS]: hostClaims,
      // Without a format the shown rates are one percent set of cells, printed at
      // every width alike. The unrounded ratio stays in `derived`.
      format: options.format,
      // Continuous ramp, in-cell values. Every cell carries an explicit fill
      // from the pinned ramp above, so the engine's own observed-maximum anchor
      // never reaches the ink.
      scale: 'continuous',
      variant: 'value',
      // The key names the pinned ramp, not the host's observed one.
      heatKey: {
        chartType: 'cohort',
        items: [
          ...[0, 0.25, 0.5, 0.75, 1].map((r) => ({
            id: `scale:${r * 100}`,
            // The top swatch also paints cells above their own base.
            label: r === 1 && derived.cohorts.some((cohort) => visibleSpan(cohort).some((t) => { const value = cohort.retention[t]; return value !== null && value !== undefined && value > 1; })) ? '100%+' : `${r * 100}%`,
            paint: cohortPaint(r),
            ...(rampTint(r) >= 0.8 ? { stroke: { token: 'neutralMark' } as Paint } : {}),
          })),
          // Period 0 is grey, not the ramp's 100%: the key says why.
          ...(shown.has(0) ? [{ id: 'scale:base', label: chartString(options, 'periodBase', { period: periodNames[0] }), paint: ANCHOR_PAINT }] : []),
          // The average row rides its own grey ramp; its swatch shows the
          // ramp at 50%, so the key covers every fill drawn.
          ...(derived.averages ? [{ id: 'scale:average', label: chartString(options, 'averageGrey'), paint: averagePaint(0.5) }] : []),
        ],
      },
      highlight: withAverageRow(options.highlight, derived.averages !== undefined),
      ...(reverseRows ? { sort: { segments: 'reverse' as const } } : {}),
      // A row name too long for the band is cut before its base, never the base.
      rowSuffix: Object.fromEntries(baseSuffix),
    }, baseFootnotes, options.footnotes);
    // The cells are derived rates: a heatmap refusal names a cohort option it was handed, or nothing.
    return hostedLayout(options, inner, () => sideKeyGivesWay(inner, layoutHeatmap(hostData, inner), (keyAbove) => layoutHeatmap(hostData, keyAbove)));
  };

  const host = build();
  const lost = countSuppressed(host, derived, shown);

  // ---- rebuild the parts that would otherwise speak the host's language ----
  const rowIndex = new Map<Id, number>();
  derived.cohorts.forEach((row, index) => rowIndex.set(row.id, index));

  const cells: CohortCellMark[] = [];
  let unobserved = 0;
  for (const node of host.scene) {
    if (node.part !== 'cell' || node.t !== 'rect') continue;
    const rowId = node.owner?.seriesId;
    const periodId = node.owner?.categoryId;
    if (rowId === undefined || periodId === undefined) continue;
    const t = periodIndex.get(periodId)!;
    const isAverage = rowId === AVERAGE_ROW_ID;
    const row = isAverage ? null : derived.cohorts[rowIndex.get(rowId)!]!;
    const notReached = row !== null && t >= row.observedPeriods;
    if (notReached) unobserved += 1;
    const retention = isAverage
      ? derived.averages![t]!.value
      : notReached
        ? null
        : row!.retention[t]!;
    const missing = isAverage
      ? derived.cohorts.some(row => missingCohortRate(row, t, basis))
      : missingCohortRate(row!, t, basis);
    cells.push({
      rowId,
      periodId,
      periodIndex: t,
      rowLabel: isAverage ? chartString(options, 'weightedAverage') : data.cohorts[rowIndex.get(rowId)!]!.label ?? rowId,
      periodLabel: periodNames[t]!,
      kind: isAverage ? 'average' : 'cohort',
      rect: node.rect,
      nodeId: node.id,
      retention,
    });
    // The formatted number is the engine's own — reformatting it here would be
    // a second rounding path. Only the STATE is rewritten: the engine
    // says 'No data' for every empty cell, and "this cohort has not lived that
    // long", "survival cannot be measured here" and "no cohort contributed" are
    // three different facts behind the same dash.
    node.display = withState(
      node.display,
      retention === null
        ? missing
          ? chartString(options, 'noObservation')
          : notReached
          ? chartString(options, 'notReached')
          : isAverage
            ? chartString(options, 'noContributor')
            : 'n.m.'
        : supportState(isAverage ? derived.averages![t]!.support : null, options),
    );
    restoreCohortCellPaint(node, cellPaint.get(node.id), retention, notReached);
  }
  restoreCohortLabelPaints(host, cellPaint);
  cells.sort(compareCells);

  if (lost.total > 0) {
    const where =
      lost.emptyColumns.length > 0
        ? `; ${lost.emptyColumns.map((t) => `'${periodNames[t]}'`).join(', ')} lost every one of theirs`
        : '';
    warnings.push({
      code: 'cohort-values-suppressed',
      severity: 'warn',
      message: `${lost.total} of ${lost.drawn} cells are too small to carry their percentage${where}; those cells read from colour alone, and the exhibit says so in a footnote`,
      suggest: 'widen the canvas, show fewer periods, or read the exact rates from the derived output',
    });
  }

  // The support range is the average row's only per-row disclosure; if the band
  // ate it, the row reads as one more cohort and the collapse is invisible.
  if (derived.averages) {
    const placed = host.labels.find((label) => label.id === `series:${AVERAGE_ROW_ID}`);
    if (placed && !placed.hidden && !placed.lines.join(' ').includes(averageSupportSuffix)) {
      warnings.push({
        code: 'cohort-average-support-truncated',
        severity: 'warn',
        message: `the row band was too narrow for '${averageLabel}' — the computed row now reads like one more cohort, with no sign that its support falls from ${supports[0]} to ${supports[supports.length - 1]}`,
        suggest: 'widen the canvas or shorten the cohort labels so the average row keeps its support range',
      });
    }
  }

  // The base has to be readable or the row is unanchored; if the band ate it,
  // say so rather than let it vanish.
  const truncated: string[] = [];
  for (const row of derived.cohorts) {
    const placed = host.labels.find((label) => label.id === `series:${row.id}`);
    if (!placed || placed.hidden) continue;
    if (!placed.lines.join(' ').includes(baseSuffix.get(row.id)!)) truncated.push(row.id);
  }
  if (truncated.length > 0) {
    warnings.push({
      code: 'cohort-base-truncated',
      severity: 'warn',
      message: `the row band was too narrow for the cohort base of ${truncated.map((id) => `'${id}'`).join(', ')} — the n is cut off, so those rows read without an anchor`,
      suggest: 'shorten the cohort labels, widen the canvas, or move the base into the subtitle',
    });
  }

  pushAll(warnings, host.warnings);

  return {
    ...host,
    type: 'cohort',
    marks: { cells },
    derived,
    a11y: a11yDescription(options, ['Cohort triangle', 'Kohorten-Dreieck'], [structureCount('cohorts', derived.cohorts.length, undefined, options), structureCount('periods', visible.length, undefined, options)], {
      counts: [structureCount('cohorts', derived.cohorts.length, undefined, options), structureCount('periods', visible.length, undefined, options),
        structureCount('cells', unobserved, chartString(options, 'cells', { count: String(unobserved) })),
        ...(derived.averages ? [derived.averages[visible[0]!]!, derived.averages[visible.at(-1)!]!].flatMap(a => a.value === null ? [] : [structureCount('cohorts', a.support, chartString(options, 'support', { count: String(a.support) }))]) : [])],
    }),
    warnings,
  };
}

function restoreCohortCellPaint(
  node: Extract<SceneNode, { t: 'rect' }>,
  paint: Paint | undefined,
  retention: number | null,
  notReached: boolean,
): void {
  // Symbolic paint back onto the scene. The engine was handed the same colour
  // as an explicit fill so its label solver could choose readable ink against
  // it; the token form is what survives a theme change.
  if (paint) node.fill = paint;
  // 'Not meaningful' and 'not yet reached' were byte-identical ink: the same
  // empty cell with the same hairline and the same dash, for two facts that
  // are opposites — one is missing measurement, the other is the future. The
  // unmeasurable cell now carries a wash; the future stays the empty page.
  else if (retention === null && !notReached) {
    node.fill = NM_PAINT;
    node.pattern = 'hatch45';
  }
}

/** Bind label contrast to the restored cell paint after the heatmap layout. */
function restoreCohortLabelPaints(
  host: Pick<Geometry, 'scene' | 'labels'>,
  cellPaint: ReadonlyMap<string, Paint>,
): void {
  // The matrix list the engine was given held explicit fills: it now lists the symbolic paints, each once.
  const matrix = [...new Map([...cellPaint.values()].map((paint) => [JSON.stringify(paint), paint])).values()];
  for (const target of [...host.scene.filter(node => node.t === 'text'), ...host.labels]) {
    const paint = cellPaint.get(`cell:${target.owner.seriesId}:${target.owner.categoryId}`);
    if (paint && 'ink' in target && 'token' in target.ink && target.ink.theme?.kind === 'contrast-ink') {
      target.ink = { ...target.ink, theme: { ...target.ink.theme, fill: paint, ...(target.ink.theme.matrix ? { matrix } : {}) } };
    }
  }
}

function compareCells(a: CohortCellMark, b: CohortCellMark): number {
  if (a.rowId !== b.rowId) return a.rowId < b.rowId ? -1 : 1;
  return a.periodIndex - b.periodIndex;
}

function supportState(support: number | null, options: CohortOptions): string | undefined {
  return support === null ? undefined : chartString(options, 'support', { count: String(support) });
}

function withState(display: SceneNode['display'], state: string | undefined): SceneNode['display'] {
  const value = display && 'value' in display ? display.value : undefined;
  if (value === undefined) return state === undefined ? undefined : { state };
  return state === undefined ? { value } : { value, state };
}

function periodLabels(periodLabel: string | undefined, count: number, options: CohortOptions): string[] {
  const initial = (periodLabel ?? '').trim().charAt(0).toUpperCase();
  return Array.from({ length: count }, (_, t) => (initial === '' ? chartString(options, 'period', { period: String(t) }) : `${initial}${t}`));
}

function cohortNotes(options: CohortOptions, basis: CohortDerived['basis'], notMeaningful: string[]): string[] {
  return [
    ...(options.methodNote || basis === 'previous'
      ? [chartString(options, 'formulaCount', { formula: cohortFormula(options, basis).replace(/[.!?]$/, '') })] : []),
    ...(notMeaningful.length > 0 ? [disclosureNote(chartString(options, 'hatchNm', { periods: notMeaningful.join(', ') }))] : []),
  ];
}

/**
 * A cell whose rate cannot be measured, drawn the way a deck has always drawn
 * one: hatched. The unobserved corner keeps the page background — nothing has
 * happened there yet — so the two blanks never share an ink. A wash
 * alone is too quiet to survive a projector; the hatch is unmistakable and
 * costs no geometry (the renderer already owns hatch45).
 */
const NM_PAINT: Paint = { token: 'neutral', tint: 0.55 };

interface SuppressionCount {
  /** Drawn rates whose number did not make it onto the exhibit. */
  total: number;
  /** Drawn rates that had a number to lose. */
  drawn: number;
  /** Periods that lost EVERY number they had. */
  emptyColumns: number[];
}

/**
 * What the reader cannot see. The anchor column counts like any other.
 */
function countSuppressed(
  host: Geometry<object, object>,
  derived: CohortDerived,
  shown: ReadonlySet<number>,
): SuppressionCount {
  const visible = new Set(host.labels.filter((label) => !label.hidden).map((label) => label.id));
  const drawnPer = new Map<number, number>();
  const lostPer = new Map<number, number>();
  const count = (rowId: Id, t: number, value: number | null): void => {
    if (value === null || !shown.has(t)) return;
    drawnPer.set(t, (drawnPer.get(t) ?? 0) + 1);
    if (!visible.has(`point:${rowId}:t${t}`)) lostPer.set(t, (lostPer.get(t) ?? 0) + 1);
  };
  for (const row of derived.cohorts) {
    for (let t = 0; t < row.observedPeriods; t++) count(row.id, t, row.retention[t] ?? null);
  }
  (derived.averages ?? []).forEach((average, t) => count(AVERAGE_ROW_ID, t, average.value));
  let drawn = 0;
  let total = 0;
  const emptyColumns: number[] = [];
  for (const [t, n] of [...drawnPer.entries()].sort((a, b) => a[0] - b[0])) {
    const lost = lostPer.get(t) ?? 0;
    drawn += n;
    total += lost;
    if (lost === n) emptyColumns.push(t);
  }
  return { total, drawn, emptyColumns };
}

function withAverageRow(
  highlight: CohortOptions['highlight'],
  hasAverages: boolean,
): CohortOptions['highlight'] {
  if (!hasAverages) return highlight;
  const authored = highlight === undefined ? [] : Array.isArray(highlight) ? highlight : [highlight];
  // The computed row is not a cohort. It carries the band so a reader never
  // mistakes a summary for the thirteenth cohort.
  return [...authored, AVERAGE_ROW_ID];
}

function stripAnswered(options: CohortOptions): HeatmapOptions {
  const rest: Record<string, unknown> = { ...options };
  for (const key of ANSWERED_HERE) delete rest[key];
  delete rest.basis;
  delete rest.averages;
  delete rest.total;
  delete rest.visiblePeriods;
  delete rest.methodNote;
  return keepShownNotes(options, rest) as HeatmapOptions;
}

/** The not-meaningful phrases of the shown cells: each cohort from the first such period the chart shows. */
function shownNotMeaningful(data: CohortData, derived: CohortDerived, visible: readonly number[], phrases: readonly string[]): string[] {
  if (derived.visiblePeriods === undefined) return [...phrases];
  return derived.cohorts.flatMap((row, index) => {
    const from = visible.find((t) => t < row.observedPeriods && row.retention[t] === null && !missingCohortRate(row, t, derived.basis));
    return from === undefined ? [] : [`'${data.cohorts[index]!.label ?? row.id}' from period ${from}`];
  });
}
