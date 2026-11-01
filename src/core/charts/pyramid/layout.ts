import { chartString, localeStrings } from '../../strings/pyramid';
import { resolveTheme, panelTypeClass, themeForWidth, strokeToken } from '../../theme';
import { structureCount } from '../../structureCounts';
/**
 * Population pyramid (registry type 'pyramid') — mirrored bands
 * on ONE shared scale, over the butterfly engine.
 *
 * This module validates and derives; it draws nothing. Every pixel comes from
 * `layoutButterfly`, called with constructed input: categories are the
 * authored bands REVERSED, the two groups become the two mirrored series, and
 * the engine is pinned to `sortBy: 'sheet'`, `sharedScale: true`. There is no
 * geometry arithmetic below and `src/core/charts/butterfly/**` is not touched.
 *
 * What this type owns and butterfly cannot:
 *   - band geometry. `ChartData` has no band, so butterfly cannot know that
 *     `0-4, 5-9, 10-19` mixes a ten-year row into a five-year grid, or that
 *     `0-4, 10-14` drops half a cohort and draws the survivors as neighbours.
 *   - the ordering inversion. Butterfly renders categories top-down in input
 *     order, so age bands authored the way every statistics office publishes
 *     them — ascending — come out as an UPSIDE-DOWN pyramid with no complaint.
 *     That silent-wrong-success is the reason this type is registered.
 *   - the refusals. Butterfly WARNS on negatives and draws |value|; for a
 *     population that is bad data, and drawing it would invert a sign in
 *     silence. Here it is an error, which is why `butterfly-negative` can
 *     never appear on a pyramid.
 *
 * Explicitly NOT derived (statistical contract, stated so the absence is a
 * decision rather than an oversight):
 *   - median age: needs an assumed uniform distribution WITHIN each band.
 *     That is a statistical claim, and this product does not make claims
 *     silently.
 *   - dependency ratio: (0-14 + 65+) / 15-64 is only computable when band
 *     boundaries fall exactly on 15 and 65.
 *   - comparison-year outline: butterfly has no overlay primitive.
 */

import { formatAutomaticPercent } from '../../format';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { accessibleTitle, NormalizeError } from '../../normalize/shared';
import { isPctCell, type Cell, type Id } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { ButterflyOptions } from '../../types/options';
import type { Geometry, LintWarning } from '../../types/scene';
import { layoutButterfly, type ButterflyMarks } from '../butterfly/layout';
import type {
  PyramidBand,
  PyramidData,
  PyramidDerived,
  PyramidGroup,
  PyramidGroupValue,
  PyramidOptions,
} from './types';
import { REFUSED_OPTIONS } from './refusals';

import { authoredNotes, withAuthoredFootnotes } from '../../frame';
import { disclosureNote, keepShownNotes } from '../../notes';
import { maxOf } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export type PyramidMarks = ButterflyMarks;

/**
 * Under `basis: 'shareOfTotal'` the plotted number is DERIVED, so its
 * presentation is derived too. `unit` names what the bars ARE and `format`
 * decides how a percentage prints; letting either through from the author
 * relabels or rescales a number the author did not compute — the same
 * second-source-of-truth this type refuses on the INPUT side with
 * `pyramid-percent-input`. The `%` on the mark follows the house precedent:
 * `bar` variant 'stacked100' prints '71%' directly on the segment
 * (bar/layout.ts `pctText`), and a share of a grand total is the same class
 * of quantity.
 */
const SHARE_FORMAT = '1.5%';
const SHARE_UNIT = localeStrings().pyramidShareSubtitle;

/**
 * Butterfly draws each category-axis baseline as a 1.2px rule that the bars
 * anchor ON (butterfly/layout.ts:342,347), so the rule's inner half covers the
 * first 0.6px of every bar. Ink CLEAR of the rule is what a reader can
 * actually compare against a zero row.
 */
/** Twin of `histogram-tail-below-ink`: under one pixel of ink is not legible. */
const MIN_LEGIBLE_INK = 1;

/** The project's waste bound: no more than 15% of a pane beyond the data edge. */
const PANE_FILL_LINT = 0.15;

/**
 * Band widths are compared with a RELATIVE tolerance: tenure bands of 2.5
 * years sum through binary floats, and 7.5 - 5 is 2.4999999999999996. The
 * tolerance is on the width comparison only; no derived number is rounded
 * (display precision never feeds geometry).
 */
const WIDTH_EPS = 1e-9;

/** The row pitch of an unpinned pyramid at a canvas width, or undefined below 600 px. */
function rowPitchFor(width: number): number | undefined {
  return width >= 600 ? 21 : undefined;
}

/** The pyramid's own default bar share of a row (butterfly keeps 0.7). */
const PYRAMID_BAND_FRACTION = 0.8;

export function layoutPyramid(
  data: PyramidData,
  options: PyramidOptions = {},
): Geometry<PyramidMarks, PyramidDerived> {
  // A stated count prints through the shared raster: engine scale from 1e6, a small value lifted off 0.
  const fmtCount = (v: number) => seriesRasterFormatter(undefined, [v], options.locale?.language, options.unit, options.target).fmt(v);
  const warnings: LintWarning[] = [];
  // ---- options this type refuses, before anything is derived ----
  const loose = options as PyramidOptions & {
    sort?: unknown;
    sortBy?: unknown;
    sharedScale?: unknown;
    topN?: unknown;
  };
  if (loose.sortBy !== undefined || loose.sort !== undefined) {
    const key = loose.sortBy !== undefined ? 'sortBy' : 'sort';
    throw new NormalizeError(
      REFUSED_OPTIONS.sortBy.code,
      `options.${key}`,
      `options.${key} ${REFUSED_OPTIONS.sortBy.why}`,
      REFUSED_OPTIONS.sortBy.fix,
    );
  }
  if (loose.sharedScale === false) {
    throw new NormalizeError(
      REFUSED_OPTIONS.sharedScale.code,
      'options.sharedScale',
      `options.sharedScale ${REFUSED_OPTIONS.sharedScale.why}`,
      REFUSED_OPTIONS.sharedScale.fix,
    );
  }

  const requestedBasis = options.basis ?? 'count';
  if (requestedBasis !== 'count' && requestedBasis !== 'shareOfTotal' && requestedBasis !== 'shareOfGroup') {
    throw new NormalizeError(
      'pyramid-basis-unknown',
      'options.basis',
      `unknown basis '${String(requestedBasis)}'`,
      "one of 'count', 'shareOfTotal', 'shareOfGroup'",
    );
  }

  // ---- shape ----
  if (!data || !Array.isArray(data.bands) || !Array.isArray(data.groups)) {
    throw new NormalizeError('empty-data', 'data', 'pyramid requires bands and groups');
  }
  if (data.bands.length === 0) {
    throw new NormalizeError('empty-data', 'bands', 'pyramid requires at least one band');
  }
  if (data.groups.length === 0) {
    throw new NormalizeError('empty-data', 'groups', 'pyramid requires two groups');
  }
  if (data.groups.length !== 2) {
    throw new NormalizeError(
      'pyramid-groups-count',
      'groups',
      `a pyramid mirrors exactly two groups; ${data.groups.length} supplied`,
      data.groups.length < 2
        ? 'a one-sided pyramid is a bar chart — use `bar`'
        : 'three or more groups have no mirrored geometry — use a bar or column chart',
    );
  }

  const bands = validateBands(data.bands);
  const bandWidth = closedWidth(bands);
  const openTopBand = bands[bands.length - 1]!.to === undefined ? bands[bands.length - 1]!.id : null;

  // ---- values: authored order, fully validated before anything is summed ----
  const groups = data.groups as [PyramidGroup, PyramidGroup];
  const groupIds: [Id, Id] = [requireGroupId(groups[0], 0), requireGroupId(groups[1], 1)];
  if (groupIds[0] === groupIds[1]) {
    throw new NormalizeError(
      'pyramid-groups-count',
      'groups[1].id',
      `both groups are named '${groupIds[0]}'; the two mirrored sides must be distinguishable`,
      'give each group its own id',
    );
  }
  // Two dated snapshots share no common whole: pooling them gives each side a
  // share of "both years together", and a band whose share fell can read as a
  // rise. A share of the grand total on two dated groups is therefore a share
  // of each snapshot.
  const bothDated = groups[0].date !== undefined && groups[1].date !== undefined;
  const basis: PyramidDerived['basis'] = requestedBasis === 'shareOfTotal' && bothDated ? 'shareOfGroup' : requestedBasis;
  const isShare = basis !== 'count';
  const counts: [number[], number[]] = [
    readValues(groups[0], 0, bands),
    readValues(groups[1], 1, bands),
  ];

  // ---- derive ----
  const values: PyramidDerived['values'] = emptyIdRecord();
  const ratio: PyramidDerived['ratio'] = emptyIdRecord();
  const totals: Record<Id, number> = { [groupIds[0]]: 0, [groupIds[1]]: 0 };
  bands.forEach((band, i) => {
    const a = counts[0][i]!;
    const b = counts[1][i]!;
    values[band.id] = { [groupIds[0]]: a, [groupIds[1]]: b };
    // Infinity is not a ratio and would print as one; a zero denominator is a
    // MISSING answer, and it is emitted as such rather than as a number.
    ratio[band.id] = b === 0 ? null : a / b;
    totals[groupIds[0]] = totals[groupIds[0]]! + a;
    totals[groupIds[1]] = totals[groupIds[1]]! + b;
  });
  const grandTotal = totals[groupIds[0]]! + totals[groupIds[1]]!;

  let shares: PyramidDerived['shares'];
  if (isShare) {
    if (basis === 'shareOfGroup' ? !(totals[groupIds[0]]! > 0 && totals[groupIds[1]]! > 0) : !(grandTotal > 0)) {
      throw new NormalizeError(
        'pyramid-zero-total',
        'groups',
        basis === 'shareOfGroup'
          ? `a group sums to 0 across every band (${groupIds[0]}: ${totals[groupIds[0]]}, ${groupIds[1]}: ${totals[groupIds[1]]}), so its shares would be 0/0`
          : `both groups sum to ${grandTotal} across every band, so every share would be 0/0`,
        "supply at least one positive count per group, or use basis: 'count'",
      );
    }
    shares = emptyIdRecord() as NonNullable<PyramidDerived['shares']>;
    const whole = (id: Id) => (basis === 'shareOfGroup' ? totals[id]! : grandTotal);
    for (const band of bands) {
      shares[band.id] = {
        [groupIds[0]]: (values[band.id]![groupIds[0]]! / whole(groupIds[0])) * 100,
        [groupIds[1]]: (values[band.id]![groupIds[1]]! / whole(groupIds[1])) * 100,
      };
    }
  }

  // ---- lints ----
  // `pyramid-too-many-bands` does not fire past a band count: the count is not
  // the fact, the dropped label is. It is measured off the solved labels AFTER
  // the delegate has run (below), the shape `histogram-bin-labels-thinned` uses.
  if (openTopBand !== null) {
    warnings.push({
      code: 'pyramid-open-top-band',
      severity: 'info',
      message: `band '${openTopBand}' is open-ended (${bands[bands.length - 1]!.from}+): its row is the same height as the ${bandWidth === null ? 'other' : `${trim(bandWidth)}-wide`} bands but covers an unbounded span, so it is not width-comparable with them`,
    });
  }
  const empty = bands.filter(
    (band) => values[band.id]![groupIds[0]] === 0 && values[band.id]![groupIds[1]] === 0,
  );
  // The `pyramid-empty-band` disclosure is emitted AFTER the delegate, because
  // what it can honestly promise depends on what the label solver did. It used
  // to promise the row was "drawn as a labelled zero": the row survives, but
  // its bar is butterfly's 0.5px minimum-width hairline anchored ON a 1.2px
  // baseline rule, so it contributes zero net ink — the warning described a
  // mark that is not there.

  // Under `shareOfTotal` the bars are percentages the engine computed. An
  // authored `unit` or `format` would put the AUTHOR's presentation on the
  // ENGINE's number: 'thousands' on a percentage axis reads 12.4 as 12,400
  // people, and a format of '1,234' rounds 0.8% to 1%. Both are refused rather
  // than merged, and the refusal is visible instead of a silent override.
  if (isShare) {
    const authored = (['unit', 'format'] as const).filter((key) => options[key] !== undefined);
    if (authored.length > 0) {
      const keys = authored.map((key) => `options.${key}`).join(' and ');
      throw new NormalizeError(
        'pyramid-derived-presentation-authored',
        `options.${authored[0]}`,
        `basis '${basis}' plots shares, so the bars are percentages this engine derived; ${keys} (${authored.map((key) => `'${String(options[key])}'`).join(', ')}) would label or round a derived number the author did not compute`,
        `drop ${keys} — shares print as '${SHARE_FORMAT.replace('1.5', '12.4')}' in ${SHARE_UNIT} — or use basis 'count' to plot and label the authored numbers`,
      );
    }
  }

  // ---- constructed butterfly input: derived numbers only, no geometry ----
  const order: Id[] = [...bands].reverse().map((band) => band.id);
  const plotted = (bandId: Id, group: 0 | 1): number =>
    isShare ? shares![bandId]![groupIds[group]]! : values[bandId]![groupIds[group]]!;

  const comparableWidth = bandWidth === null ? '' : chartString(options, 'bandWidthClause', { v1: trim(bandWidth) });
  const footnotes = [
    ...authoredNotes(options),
    ...pyramidNotes({ options,
      bandCount: bands.length,
      bandWidth: bandWidth === null ? null : trim(bandWidth),
      openTop: openTopBand === null ? null : labelOf(bands[bands.length - 1]!),
      openFrom: trim(bands[bands.length - 1]!.from),
      shareBase: basis === 'shareOfTotal' ? fmtCount(grandTotal) : null,
      methodNote: options.methodNote === true,
    }),
  ];

  const butterflyData: ChartData = {
    categories: [...bands].reverse().map((band) => ({ id: band.id, label: labelOf(band) })),
    series: groups.map((group, g) => ({
      id: groupIds[g as 0 | 1],
      // Under shares of the grand total the pane head says how much of
      // the total each group holds, since neither side sums to 100%.
      label: `${group.label ?? groupIds[g as 0 | 1]}${basis === 'shareOfTotal'
        ? chartString(options, 'ofAllClause', { v1: formatterFromExample(SHARE_FORMAT, options.locale?.language)((totals[groupIds[g as 0 | 1]]! / grandTotal) * 100) }) : ''}`,
      values: order.map((bandId) => plotted(bandId, g as 0 | 1) as Cell),
      ...(group.colorRole ? { colorRole: group.colorRole } : {}),
    })),
  };

  // Only the author's own notes keep a number; the rest are derived.
  const butterflyOptions: ButterflyOptions = withAuthoredFootnotes<ButterflyOptions>({
    ...stripPyramidOnly(options),
    // a pyramid's bars fill 0.8 of the row pitch at every
    // width, so the silhouette reads as one shape; an authored value stays.
    bandFraction: options.bandFraction ?? PYRAMID_BAND_FRACTION,
    a: groupIds[0],
    b: groupIds[1],
    // Pinned, not defaulted: both are refused above, so nothing can reach here
    // that would move them.
    sortBy: 'sheet',
    sharedScale: true,
    // Pinned with the basis, not beside it: refused above, so nothing authored
    // can reach here to move them.
    ...(isShare ? { format: SHARE_FORMAT, unit: chartString(options, basis === 'shareOfGroup' ? (bothDated ? 'pyramidShareSnapshotSubtitle' : 'pyramidShareGroupSubtitle') : 'pyramidShareSubtitle') } : {}),
  }, footnotes, options.footnotes);

  const comparison = {
    periods: Object.fromEntries(groups.map(g => [g.id, { date: g.date, label: g.label ?? g.id }])),
    differenceFormat: isShare ? '1.5pp' : undefined,
    rowDriven: false,
    // the scale fills each pane, heads stand at the lane, and
    // cards put values inside the bar end in a lane as narrow as the bands.
    paneFit: true,
  };
  let geo = layoutButterfly(butterflyData, butterflyOptions, comparison);
  // An unpinned pyramid stands its rows at a 21 px pitch from 600 px wide;
  // a narrower card and a pinned height keep the pitch their canvas gives.
  const pitchWanted = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && panelTypeClass(options) === undefined
    ? rowPitchFor(geo.size.width) : undefined;
  const rowsNow = geo.marks.left;
  if (pitchWanted !== undefined && !geo.refused && rowsNow.length > 1) {
    const pitch = (rowsNow[rowsNow.length - 1]!.rect.y - rowsNow[0]!.rect.y) / (rowsNow.length - 1);
    const grow = Math.ceil(rowsNow.length * (pitchWanted - pitch) - 1e-6);
    if (grow > 0) {
      const taller = layoutButterfly(butterflyData, { ...butterflyOptions, size: { width: geo.size.width, height: geo.size.height + grow } }, comparison);
      if (!taller.refused) geo = taller;
    }
  }

  // ---- lints that can only be measured on the solved scene ----
  const placed = new Set(
    geo.labels.filter((label) => label.hidden === undefined).map((label) => label.id),
  );
  const bandLabelsLost = bands.filter((band) => !placed.has(`category:${band.id}`));
  if (bandLabelsLost.length > 0) {
    warnings.push({
      code: 'pyramid-too-many-bands',
      severity: 'warn',
      message: `${bandLabelsLost.length} of ${bands.length} band labels did not fit the category spine and were dropped (${bandLabelsLost
        .slice(0, 3)
        .map((band) => `'${labelOf(band)}'`)
        .join(', ')}${bandLabelsLost.length > 3 ? ', …' : ''}) — an unlabelled band is an unreadable cohort`,
      suggest: 'widen the bands into fewer rows, or raise the canvas height',
    });
  }

  // A bar carries ink only where it clears the baseline rule it anchors on.
  // Below one pixel of clearance a positive count is not distinguishable from
  // the zero row next to it, which is the whole comparison a pyramid is read
  // for. Twin of `histogram-tail-below-ink` (histogram/layout.ts:436).
  const marks = geo.marks as PyramidMarks;
  const belowInk: string[] = [];
  const baselineHalfStroke = strokeToken(themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? geo.size.width), 'rule') / 2;
  for (const [side, group] of [
    [marks.left, 0],
    [marks.right, 1],
  ] as const) {
    for (const row of side) {
      const raw = values[row.id]?.[groupIds[group]];
      if (raw === undefined || raw <= 0) continue;
      if (row.rect.w - baselineHalfStroke < MIN_LEGIBLE_INK) belowInk.push(`${row.id}/${groupIds[group]}`);
    }
  }
  if (belowInk.length > 0) {
    warnings.push({
      code: 'pyramid-below-ink',
      severity: 'warn',
      message: `${belowInk.length} positive value(s) render under one pixel of ink clear of the baseline (${belowInk.slice(0, 3).join(', ')}${belowInk.length > 3 ? ', …' : ''}); the counts are exact and the bars are not distinguishable from a zero row`,
      suggest:
        'the two groups share one scale by design — widen the canvas, or split the smaller group onto its own exhibit',
    });
  }

  // Shared scales can leave one pane mostly empty when group sizes differ.
  // Disclose that measured imbalance rather than making it look like a layout fault.
  const peak = groupIds.map((id) => maxOf(bands.map((band) => values[band.id]![id]!)));
  const longest = [marks.left, marks.right].map((side) =>
    side.length === 0 ? 0 : maxOf(side.map((row) => row.rect.w)),
  ) as [number, number];
  const fill = Math.max(...longest) === 0 ? 1 : Math.min(...longest) / Math.max(...longest);
  if (fill < PANE_FILL_LINT) {
    const small = longest[0]! < longest[1]! ? 0 : 1;
    // Both numbers are read off the solved marks, so the message cannot drift
    // from the picture: these are the two longest bars as rendered.
    warnings.push({
      code: 'pyramid-group-imbalance',
      severity: 'warn',
      message: `'${groupIds[small]}' peaks at ${fmtCount(peak[small]!)} against '${groupIds[1 - small]}' at ${fmtCount(peak[1 - small]!)}, so on the shared scale its longest bar renders ${longest[small]!.toFixed(1)}px against ${longest[1 - small]!.toFixed(1)}px — ${(fill * 100).toFixed(1)}% — and the rest of its pane carries no ink at all`,
      suggest:
        'a pyramid always shares one scale, so this is the data and not a setting — put the two groups on separate exhibits if the smaller one has to be readable in its own right',
    });
  }

  if (empty.length > 0) {
    const names = empty.map((band) => `'${band.id}'`).join(', ');
    const one = empty.length === 1;
    // Only claim the zero the reader can actually read.
    const zerosShown = empty.filter((band) =>
      groupIds.every((_, g) => placed.has(`point:${groupIds[g as 0 | 1]}:${band.id}`)),
    ).length;
    warnings.push({
      code: 'pyramid-empty-band',
      severity: 'info',
      message:
        `${one ? 'band' : 'bands'} ${names} ${one ? 'is' : 'are'} zero in both groups — the ${one ? 'row keeps' : 'rows keep'} full height and ${one ? 'is' : 'are'} never collapsed, so the cohort is not silently removed from the axis. ` +
        (zerosShown === empty.length
          ? `The zero is printed on ${one ? 'the row' : 'each row'}: the bar itself is a sub-pixel hairline covered by the baseline rule, so the printed 0 is the only mark that carries the absence.`
          : `${empty.length - zerosShown} of ${empty.length} zero ${empty.length - zerosShown === 1 ? 'row prints' : 'rows print'} no value label at this canvas, and the bar is a sub-pixel hairline covered by the baseline rule — ${one ? 'the row' : 'those rows'} carry NO visible trace of the absence`),
      ...(zerosShown === empty.length
        ? {}
        : { suggest: 'raise the canvas height so the zero labels place' }),
    });
  }

  const labelA = groups[0].label ?? groupIds[0];
  const labelB = groups[1].label ?? groupIds[1];
  const fmtPlotted = isShare ? (v: number) => formatAutomaticPercent(v, 1, false, options.locale?.language) : fmtCount;
  // Counts are only interpretable with the unit the frame prints beside them.
  // Under shareOfTotal the plotted numbers already carry '%', and the totals
  // below are counts in the authored unit either way.
  const countUnit = options.unit === undefined ? '' : ` ${options.unit}`;
  const desc =
    chartString(options, 'pyramidDesc', { v1: labelA, v2: labelB, v3: bands.length }) +
    chartString(options, 'youngestBottom') +
    (openTopBand === null
      ? chartString(options, 'bandsWidth', { v1: trim(bandWidth ?? 0) })
      : chartString(options, 'openBandDesc', { v1: bands.length - 1, v2: comparableWidth, v3: labelOf(bands[bands.length - 1]!) })) +
    // The totals carry their unit. The visible frame prints 'in thousands' next
    // to the same numbers; a description that says 'grand total 83,420' with no
    // unit is off by a factor of 1000 for the one reader who cannot see the
    // frame, which is worse than omitting the totals entirely.
    chartString(options, 'pyramidTotals', { v1: labelA, v2: fmtCount(totals[groupIds[0]]!), v3: countUnit, v4: labelB, v5: fmtCount(totals[groupIds[1]]!), v6: countUnit, v7: fmtCount(grandTotal), v8: countUnit }) +
    (isShare
      ? chartString(options, basis === 'shareOfGroup' ? 'pyramidSharesOfGroup' : 'pyramidShares')
      : chartString(options, 'pyramidCounts', { v1: countUnit === '' ? '' : chartString(options, 'inUnitClause', { v1: options.unit }) })) +
    [...bands]
      .reverse()
      .map(
        (band) =>
          `${labelOf(band)}: ${labelA} ${fmtPlotted(plotted(band.id, 0))}, ${labelB} ${fmtPlotted(plotted(band.id, 1))}`,
      )
      .join('; ') +
    '.';

  return {
    ...geo,
    type: 'pyramid',
    derived: {
      order,
      bandWidth,
      openTopBand,
      groupIds,
      values,
      totals,
      grandTotal,
      basis,
      ...(shares ? { shares } : {}),
      ratio,
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'pyramidTitle', { v1: labelA, v2: labelB })),
      counts: [structureCount('bands', bands.length, chartString(options, 'orderedBands', { v1: bands.length })),
        ...(openTopBand === null ? [] : [structureCount('bands', bands.length - 1, chartString(options, 'closedBands', { v1: bands.length - 1 }))])],
      desc,
    },
    warnings: [...geo.warnings, ...warnings],
  };
}

// ---------------------------------------------------------------------------

function requireGroupId(group: PyramidGroup | undefined, index: number): Id {
  if (!group || typeof group !== 'object' || !group.id) {
    throw new NormalizeError('missing-id', `groups[${index}]`, 'each pyramid group requires an id');
  }
  return group.id;
}

/**
 * Ascending, contiguous, equal-width. Every failure is an error rather than a
 * silent repair: an unordered band list usually means the author has a
 * different structure in mind, and re-bucketing on their behalf would publish
 * a cohort structure nobody wrote.
 */
function validateBands(raw: PyramidBand[]): PyramidBand[] {
  const seen = new Set<Id>();
  raw.forEach((band, i) => {
    const path = `bands[${i}]`;
    if (!band || typeof band !== 'object' || !band.id) {
      throw new NormalizeError('missing-id', path, 'each pyramid band requires an id');
    }
    if (seen.has(band.id)) {
      throw new NormalizeError('duplicate-id', path, `duplicate band id '${band.id}'`);
    }
    seen.add(band.id);
    if (typeof band.from !== 'number' || !Number.isFinite(band.from)) {
      throw new NormalizeError(
        'pyramid-bands-unordered',
        `${path}.from`,
        `band '${band.id}' has a non-finite lower bound (${String(band.from)})`,
        'every band needs a finite `from`',
      );
    }
    if (band.to !== undefined && (typeof band.to !== 'number' || !Number.isFinite(band.to))) {
      throw new NormalizeError(
        'pyramid-bands-unordered',
        `${path}.to`,
        `band '${band.id}' has a non-finite upper bound (${String(band.to)})`,
        'omit `to` to declare the band open-ended, or give it a finite number',
      );
    }
    if (band.to !== undefined && !(band.to > band.from)) {
      throw new NormalizeError(
        'pyramid-bands-unordered',
        `${path}.to`,
        `band '${band.id}' spans from ${band.from} to ${band.to}: a band's \`to\` must be greater than its \`from\``,
        'bands are authored ascending, lowest first',
      );
    }
  });

  for (let i = 1; i < raw.length; i++) {
    if (!(raw[i]!.from > raw[i - 1]!.from)) {
      throw new NormalizeError(
        'pyramid-bands-unordered',
        `bands[${i}].from`,
        `bands must be authored in strictly ascending order: band '${raw[i]!.id}' starts at ${raw[i]!.from}, which is not above band '${raw[i - 1]!.id}' at ${raw[i - 1]!.from}`,
        'author the bands lowest-first; the engine reverses them for rendering',
      );
    }
  }

  for (let i = 0; i < raw.length - 1; i++) {
    const here = raw[i]!;
    const next = raw[i + 1]!;
    if (here.to === undefined) {
      throw new NormalizeError(
        'pyramid-bands-noncontiguous',
        `bands[${i}].to`,
        `band '${here.id}' is open-ended but is followed by '${next.id}': only the LAST band may omit \`to\`, because an open band in the middle makes contiguity uncheckable`,
        `give '${here.id}' a \`to\` of ${next.from}`,
      );
    }
    if (here.to !== next.from) {
      const gap = next.from - here.to;
      throw new NormalizeError(
        'pyramid-bands-noncontiguous',
        `bands[${i + 1}].from`,
        gap > 0
          ? `bands '${here.id}' and '${next.id}' leave a gap of ${trim(gap)} (${trim(here.to)} to ${trim(next.from)}): that population is missing from the exhibit, and the two bands would be drawn as neighbours`
          : `bands '${here.id}' and '${next.id}' overlap by ${trim(-gap)} (${trim(next.from)} to ${trim(here.to)}): the overlapping population would be counted twice`,
        `set bands[${i + 1}].from to ${trim(here.to)}, or close the gap with another band`,
      );
    }
  }

  const closed = raw.filter((band) => band.to !== undefined);
  if (closed.length > 1) {
    const first = closed[0]!;
    const width = first.to! - first.from;
    for (const band of closed) {
      const w = band.to! - band.from;
      if (Math.abs(w - width) > WIDTH_EPS * Math.max(1, Math.abs(width))) {
        throw new NormalizeError(
          'pyramid-unequal-bands',
          `bands[${raw.indexOf(band)}]`,
          `band '${band.id}' is ${trim(w)} wide but '${first.id}' is ${trim(width)} wide: row heights are equal, so a wider band's bar reads as a larger cohort than it is`,
          `re-bucket every band to a common width of ${trim(width)}`,
        );
      }
    }
  }

  return raw;
}

function closedWidth(bands: PyramidBand[]): number | null {
  const first = bands.find((band) => band.to !== undefined);
  return first === undefined ? null : first.to! - first.from;
}

/**
 * Positional array or `{ bandId, value }` records. Either way the result is
 * one finite non-negative number per band, in AUTHORED band order.
 */
function readValues(group: PyramidGroup, index: number, bands: PyramidBand[]): number[] {
  const path = `groups[${index}].values`;
  if (!Array.isArray(group.values)) {
    throw new NormalizeError('empty-data', path, `group '${group.id}' has no values array`);
  }
  // The form is decided by the WHOLE array, not by its first element. Sampling
  // values[0] only meant `[1, {bandId,value}]` took the positional path and was
  // reported as `pyramid-nonfinite-value … ([object Object])` — the wrong code
  // and an unusable value — while the same array reordered was refused
  // correctly. A mixed array is a mixed array whichever end it starts at.
  const recordAt = group.values.map((value, i) => (isBound(value) ? i : -1)).filter((i) => i >= 0);
  const bound = recordAt.length > 0;
  if (bound && recordAt.length !== group.values.length) {
    const bare = group.values.findIndex((value) => !isBound(value));
    throw new NormalizeError(
      'pyramid-values-arity',
      `${path}[${bare}]`,
      `group '${group.id}' mixes bare values with { bandId, value } records (${recordAt.length} of ${group.values.length} are records, and index ${bare} is not); one form per group`,
      'use one form throughout: either a positional array or { bandId, value } for every band',
    );
  }
  const out: number[] = [];

  if (!bound) {
    if (group.values.length !== bands.length) {
      throw new NormalizeError(
        'pyramid-values-arity',
        path,
        `group '${group.id}' supplies ${group.values.length} values for ${bands.length} bands; a positional array is matched band by band, so the counts must agree`,
        `supply ${bands.length} values, or use the { bandId, value } form`,
      );
    }
    bands.forEach((band, i) => {
      out.push(check((group.values as unknown[])[i], `${path}[${i}]`, group.id, band.id));
    });
    return out;
  }

  const records = group.values as PyramidGroupValue[];
  const byBand = new Map<Id, { value: unknown; at: number }>();
  records.forEach((record, i) => {
    if (byBand.has(record.bandId)) {
      throw new NormalizeError(
        'pyramid-values-arity',
        `${path}[${i}]`,
        `group '${group.id}' supplies band '${record.bandId}' twice`,
      );
    }
    byBand.set(record.bandId, { value: record.value, at: i });
  });
  const known = new Set(bands.map((band) => band.id));
  const unknown = records.filter((record) => !known.has(record.bandId)).map((r) => r.bandId);
  const missing = bands.filter((band) => !byBand.has(band.id)).map((b) => b.id);
  if (unknown.length > 0 || missing.length > 0) {
    throw new NormalizeError(
      'pyramid-values-arity',
      path,
      `group '${group.id}' supplies ${records.length} values for ${bands.length} bands` +
        (missing.length > 0 ? `; no value for ${missing.map((id) => `'${id}'`).join(', ')}` : '') +
        (unknown.length > 0 ? `; unknown band ${unknown.map((id) => `'${id}'`).join(', ')}` : ''),
      'every band needs exactly one value per group',
    );
  }
  for (const band of bands) {
    const hit = byBand.get(band.id)!;
    out.push(check(hit.value, `${path}[${hit.at}].value`, group.id, band.id));
  }
  return out;
}

function isBound(v: unknown): boolean {
  return typeof v === 'object' && v !== null && 'bandId' in (v as object);
}

/** One cell, one refusal per failure mode — no coercion, no substituted zero. */
function check(raw: unknown, path: string, groupId: Id, bandId: Id): number {
  if (isPctCell(raw as Cell)) {
    throw new NormalizeError(
      'pyramid-percent-input',
      path,
      `group '${groupId}' supplies a share for band '${bandId}'; a pyramid derives every share from the counts, and an authored share would be a second source of truth`,
      "supply counts or amounts and set basis: 'shareOfTotal'",
    );
  }
  if (raw === null || raw === undefined) {
    throw new NormalizeError(
      'pyramid-missing-value',
      path,
      `group '${groupId}' has no value for band '${bandId}'; a band with no number renders as zero and reads as "nobody lives here"`,
      'state 0 if the band was measured and is empty, or drop the band from both groups',
    );
  }
  if (typeof raw !== 'number' || Number.isNaN(raw) || !Number.isFinite(raw)) {
    throw new NormalizeError(
      'pyramid-nonfinite-value',
      path,
      `group '${groupId}' has a non-finite value for band '${bandId}' (${String(raw)})`,
      'supply a finite number',
    );
  }
  if (raw < 0) {
    throw new NormalizeError(
      'pyramid-negative-value',
      path,
      `group '${groupId}' is negative for band '${bandId}' (${raw}); a population cannot be negative, and a mirrored pane would draw |value| and hide the sign`,
      'use a butterfly or variance chart for signed data',
    );
  }
  return raw;
}

/** `${from}-${to}` for closed bands, `${from}+` for the open one. */
function labelOf(band: PyramidBand): string {
  if (band.label !== undefined) return band.label;
  return band.to === undefined ? `${trim(band.from)}+` : `${trim(band.from)}–${trim(band.to)}`;
}

/** Business default matching butterfly's: whole numbers get no decimals. */


/**
 * Band bounds are authored numbers and go into MESSAGES, never into geometry.
 * `String()` keeps 2.5 as "2.5" and 5 as "5" without a locale or a formatter
 * deciding how many decimals a boundary has.
 */
function trim(v: number): string {
  return String(v);
}

/**
 * Pyramid-only keys never reach butterfly, and neither do the four options
 * this type refuses: they are absent from PyramidOptions, so a caller can
 * only smuggle them through a cast, and a smuggled `topN` would fold a tail
 * of bands into an "Others" row — the exact structural lie the type exists to
 * prevent.
 */
/**
 * The band convention is a method note, printed with `methodNote: true`.
 * An open-ended top band and the share base change how the bars read and
 * print regardless.
 */
function pyramidNotes(input: {
  options: PyramidOptions;
  bandCount: number;
  bandWidth: string | null;
  openTop: string | null;
  /** The lower bound of the open top band, as authored. */
  openFrom: string;
  shareBase: string | null;
  methodNote: boolean;
}): string[] {
  const { bandCount, bandWidth, openTop, openFrom, shareBase, methodNote, options } = input;
  const width = bandWidth === null ? '' : chartString(options, 'bandWidthClause', { v1: bandWidth });
  const share = shareBase === null
    ? ''
    : chartString(options, 'pyramidSharesDisclosure', { v1: shareBase });
  if (methodNote) {
    return [
      chartString(options, 'pyramidBandsMethod') +
        (openTop === null
          ? chartString(options, 'equalBandsMethod', { v1: bandCount, v2: width })
          : chartString(options, 'openBandsMethod', { v1: bandCount - 1, v2: width, v3: openTop })) +
        share,
    ];
  }
  const required = `${openTop === null ? '' : chartString(options, 'openBandRequired', { v1: openTop, v2: openFrom })}${share}`.trim();
  return required === '' ? [] : [disclosureNote(required)];
}

function stripPyramidOnly(options: PyramidOptions): ButterflyOptions {
  const {
    basis: _basis,
    methodNote: _methodNote,
    footnotes: _footnotes,
    ...rest
  } = options as PyramidOptions & { sort?: unknown; sortBy?: unknown; sharedScale?: unknown };
  const out = { ...rest } as ButterflyOptions & {
    sort?: unknown;
    topN?: unknown;
  };
  delete out.sort;
  delete out.topN;
  // The host never sees `methodNote`; its note kinds travel as `notes.show`.
  return keepShownNotes(options, out) as ButterflyOptions;
}
