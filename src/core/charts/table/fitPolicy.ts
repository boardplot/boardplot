/** Ordered numeric table fitting. Candidate records contain only changes to the prepared table. */
import { PLAN_ONLY } from '../../layoutPlan';
import { resolveSize } from '../../normalize/shared';
import { heightOmitted, VERIFY_ADVICE } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { maxOf } from '../../arrays';
import { missesSize, tightSpacingWarning } from '../tableFit';
import { isCohortDensity } from './ladder';
import { ENGINE_NOTES, INDENT_BASE, LABEL_WRAP_FLOOR, SOFT_LABEL_CAP, cellPadX as trackCellPadX } from './tracks';
import type { Geometry } from '../../types/scene';
import type { ResolvedTable, TableData, TableDerived, TableOptions } from '../../types/table';
import type { TableMarks } from './layout';

export const COMPACT_RETRY = Symbol('tableCompactRetry');
/** A class-floor probe reads sizing, not the selected rung's scene. */
export const SIZING_ONLY = Symbol('tableSizingOnly');
/** A ladder step lets the value heads wrap to two lines. */
export const HEAD_LINES = Symbol('tableHeadLines');
/** The tight rung (refuse-less): which air shrinks, across (cell air, gaps, side margins) and down (row air, top and bottom margins). */
export const TIGHT_SPACING = Symbol('tableTightSpacing');
/** The head and group rows at their least air (no air above the head, 7 px to its rule), whatever the theme's `headPad` and `groupPad`. */
export const HEAD_AIR_MIN = Symbol('tableHeadAirMin');
/** The tight rung's last try: a head may break before a short last word ("PERIOD" over "1"). */
export const HEAD_LOOSE = Symbol('tableHeadLoose');
/** The tight rung's cell air; a column gap is twice this, the side margin too. */
export const TIGHT_PAD = 2;
/** The last height step: sub-labels on one line, cut with a title, where a pinned height misses. */
export const SUB_LINES = Symbol('tableSubLines');
/** Regular spacing only: no tight rung. A caller that has other regular forms to try first (dimswitch) or only reads the floor (classFloor) sets it. */
export const REGULAR_SPACING = Symbol('tableRegularSpacing');
/** The compact retry carries the canvas height its caller gave the full table. */
export type LayoutOptions = TableOptions & { [PLAN_ONLY]?: boolean; [SIZING_ONLY]?: boolean; [COMPACT_RETRY]?: number; [HEAD_LINES]?: number; [TIGHT_SPACING]?: { columns: boolean; rows: boolean }; [HEAD_AIR_MIN]?: boolean; [SUB_LINES]?: number; [REGULAR_SPACING]?: boolean; [HEAD_LOOSE]?: boolean; [ENGINE_NOTES]?: string[]; [SOFT_LABEL_CAP]?: boolean; [LABEL_WRAP_FLOOR]?: boolean };
/** The frame gutter of a card-class table: 12 px a side at 480 px and narrower. */
export const CARD_GUTTER = 12;

type TableGeometry = Geometry<TableMarks, TableDerived>;
/** Overrides for one ordered numeric candidate, never a full authored options object. */
export type TableCandidate = Pick<LayoutOptions, 'density' | 'margin' | 'cellPadX' | 'labelIndent' | 'size'> &
  Pick<LayoutOptions, typeof COMPACT_RETRY | typeof HEAD_LINES | typeof TIGHT_SPACING | typeof HEAD_AIR_MIN | typeof SUB_LINES | typeof HEAD_LOOSE>;
export type RunTableCandidate = (candidate: TableCandidate, sizingOnly: boolean,
  selected?: (probe: TableGeometry) => boolean, widthOnlyOnMiss?: boolean | 'regular-rung') => TableGeometry;

// The fit ladder changes spacing, not cell values or cohort density.
export function executeTableFit(authoredData: TableData, options: TableOptions, resolved: ResolvedTable, preserveCompactFloor: boolean, run: RunTableCandidate, cutCount: (geometry: TableGeometry) => number, hasHeadAir: (options: TableOptions) => boolean): Geometry<TableMarks, TableDerived> {
  const sizingOnly = (options as LayoutOptions)[SIZING_ONLY] === true;
  const once = (step: TableCandidate, widthOnly: true | 'regular-rung' = true) => run(step, sizingOnly, fits, widthOnly);
  const targetSize = (options as TargetSizeOptions)[TARGET_SIZE];
  // A floor that misses full width never reads its scene. Keep the initial height pass intact.
  const fullSizingOnly = sizingOnly && resolveSize(options.size).width !== targetSize?.sizePx.width;
  // A side the caller left open is no limit: the frame grows there, so only a fixed side can miss.
  // The registry lays an open side out at a provisional size and names it open in TARGET_SIZE.
  const open = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed;
  const widthFits = (geometry: Geometry<TableMarks, TableDerived>) => open?.width === false || geometry.size.width >= (geometry.sizing?.minWidth ?? 0);
  const heightFits = (geometry: Geometry<TableMarks, TableDerived>) => options.size === undefined || open?.height === false || geometry.size.height >= (geometry.sizing?.minHeight ?? 0);
  const fits = (geometry: Geometry<TableMarks, TableDerived>) => widthFits(geometry) && heightFits(geometry);
  // A rung that misses is read for its size, plot and floor only, so it stops before its scene.
  let full = run({}, fullSizingOnly, options.belowMinimum === 'refuse' ? undefined : fits, options.belowMinimum !== 'refuse');
  // A wider-size patch reruns the original spacing. A compact rung must not
  // advertise a width that fits only its temporary margins or cell padding.
  const widthRepair = full.warnings.find(warning => warning.code === 'table-overflow' && warning.fix?.length);
  const withWidthRepair = (drawn: Geometry<TableMarks, TableDerived>) => {
    if (widthRepair) drawn.warnings = drawn.warnings.map(warning =>
      warning.code === 'table-overflow' && warning.fix?.length ? widthRepair : warning);
    return drawn;
  };
  const pad = options.cellPadX ?? trackCellPadX(full.marks.columns.length);
  const margin = { ...options.margin, left: Math.min(options.margin?.left ?? CARD_GUTTER, CARD_GUTTER), right: Math.min(options.margin?.right ?? CARD_GUTTER, CARD_GUTTER) };
  // The gutter rung: the full table with 12 px sides, where the frame's own margin is wider.
  const gutterHelps = full.plot.x > margin.left + 0.5 || full.size.width - (full.plot.x + full.plot.w) > margin.right + 0.5;
  // An open height keeps a rung's own: the frame grows to the rows that rung draws.
  const fixedHeight = !heightOmitted(options.size) && open?.height !== false;
  /** The floor is the last rung's: the compact table draws where this rung's tracks or rows no longer fit. */
  const withFloor = (drawn: Geometry<TableMarks, TableDerived>) => {
    // Ordinary rendering needs the selected spacing to fit, not the minimum of spacing it did not select.
    // Measurement and composed selectors retain the exact compact floor.
    if (!sizingOnly && !preserveCompactFloor && !(options as { [VERIFY_ADVICE]?: boolean })[VERIFY_ADVICE]) return withWidthRepair(drawn);
    const compact = drawn.sizing === undefined ? undefined : compactTable(authoredData, options, full, margin, Math.min(pad, 3), 2, resolved, true, run);
    if (compact?.sizing && !compact.refused) {
      drawn.sizing = { ...drawn.sizing!, minWidth: Math.min(drawn.sizing!.minWidth, compact.sizing.minWidth),
        minHeight: fixedHeight ? Math.min(drawn.sizing!.minHeight, compact.sizing.minHeight) : drawn.sizing!.minHeight };
    }
    return withWidthRepair(drawn);
  };
  if (options.belowMinimum === 'refuse' || !full.sizing) return full;
  if (fits(full)) {
    if (fullSizingOnly) full = run({}, false);
    // A table that fits names the same minimum as one that steps down (one minimum at every width).
    // An open width keeps the full table's: the frame grows to it rather than stepping down.
    const cut = cutCount(full);
    const gutter = cut === 0 || !gutterHelps ? undefined : run({ margin }, false);
    const drawn = gutter?.sizing !== undefined && fits(gutter) && cutCount(gutter) < cut ? gutter : full;
    return open?.width === false ? drawn : withFloor(drawn);
  }
  // Head air gives way before row air: a pinned height that the theme's head and group air
  // alone miss keeps the full rows with the head at its least air.
  if (widthFits(full) && fixedHeight && hasHeadAir(options)) {
    const lean = once({ [HEAD_AIR_MIN]: true });
    if (lean.sizing !== undefined && fits(lean)) {
      withFloor(lean);
      lean.warnings.push({ code: 'table-compact-fallback', severity: 'info', message: 'The full table did not fit. The head and group rows took their least air.' });
      return lean;
    }
  }
  // A table that misses on height alone goes straight to the compact density: air between figures does not buy rows.
  if (widthFits(full)) return withWidthRepair(compactTable(authoredData, options, full, margin, Math.min(pad, 6), undefined, resolved, sizingOnly, run));
  const rung = (step: { pad: number; heads?: number }) =>
    once({ margin, cellPadX: step.pad, ...(step.heads === undefined ? {} : { [HEAD_LINES]: step.heads }) }, 'regular-rung');
  // Each rung is narrower than the one before, so where the narrowest misses the width every rung does.
  const narrowest = rung({ pad: Math.min(pad, 3), heads: 2 });
  if (narrowest.sizing !== undefined && !widthFits(narrowest)) return withWidthRepair(compactTable(authoredData, options, full, margin, Math.min(pad, 3), 2, resolved, sizingOnly, run));
  const tried = new Set<string>(gutterHelps ? [] : [`${pad}`]);
  for (const step of [{ pad }, { pad: Math.min(pad, 6) }, { pad: Math.min(pad, 3) }, { pad: Math.min(pad, 3), heads: 2 }]) {
    const key = `${step.pad}${step.heads === undefined ? '' : `:${step.heads}`}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const last = step.heads === undefined ? rung(step) : narrowest;
    if (last.sizing === undefined || (widthFits(last) && heightFits(last))) {
      withFloor(last);
      last.warnings.push({ code: 'table-compact-fallback', severity: 'info', message: `The full table did not fit. ${step.pad === pad && step.heads === undefined ? '12 px side margins were' : `${step.pad} px cell air${step.heads === undefined ? '' : ', heads on two lines'} and 12 px side margins were`} used.` });
      return last;
    }
  }
  return withWidthRepair(compactTable(authoredData, options, full, margin, Math.min(pad, 3), 2, resolved, sizingOnly, run));
}

/** The last step: the compact density, tight margins and, where the height was left open, a row-driven height. */
function compactTable(
  authoredData: TableData, options: TableOptions, full: Geometry<TableMarks, TableDerived>,
  margin: NonNullable<TableOptions['margin']>, cellPadX: number, heads: number | undefined,
  resolved: ResolvedTable, sizingOnly: boolean, run: RunTableCandidate,
): Geometry<TableMarks, TableDerived> {
  const compactOptions: TableCandidate = {
    density: isCohortDensity(options.density ?? 'regular') ? options.density : 'compact',
    margin,
    // Tighter than the full table, never wider: a dense table already pads 3 or 5 px.
    cellPadX,
    labelIndent: { base: 8 + (options.outlineMarks === true ? INDENT_BASE : 0), step: 8 },
    // A fixed height never grows (docs/manual.md, "Fixed height"): only an omitted height turns automatic.
    size: heightOmitted(options.size) ? { width: full.size.width } : { width: full.size.width, height: full.size.height },
    [COMPACT_RETRY]: full.size.height,
    ...(heads === undefined ? {} : { [HEAD_LINES]: heads }),
  };
  // Refuse-less: comfort air is a preference. Where the compact table still misses
  // a fixed side, the side margins, cell air and spacers shrink to a readable floor, and the row air
  // too where the height misses. Text, numbers and columns stay as they are; the warning names the
  // size that keeps compact spacing.
  // The most the tight rung can take across: cell air on both sides of each track, the side margins,
  // the spacers and the label indents. A miss wider than that skips the futile layout (a dimswitch
  // period search probes many such widths).
  const tightens = (geometry: Geometry<TableMarks, TableDerived>) => {
    const across = 2 * Math.max(0, cellPadX - TIGHT_PAD) * geometry.marks.columns.length
      + Math.max(0, geometry.plot.x - TIGHT_PAD * 2) + Math.max(0, geometry.size.width - geometry.plot.x - geometry.plot.w - TIGHT_PAD * 2)
      + (authoredData.columnGroups ?? []).reduce((sum, group) => sum + Math.max(0, (group.spacer ?? 0) - TIGHT_PAD * 2), 0)
      + 6 + 4 * Math.max(0, maxOf(resolved.rows.map((row) => row.level))) + 4;
    const missed = missesSize(geometry, options);
    const reachable = !missed.width || (geometry.sizing?.minWidth ?? 0) - geometry.size.width <= across;
    return !(options as LayoutOptions)[REGULAR_SPACING] && geometry.sizing !== undefined && (missed.width || missed.height) && reachable;
  };
  // A table the tight rung replaces is read for its size and floor only, so it stops before its scene.
  let compact = run(compactOptions, sizingOnly, (geometry) => !tightens(geometry));
  const misses = missesSize(compact, options);
  const { width: missesWidth, height: missesHeight } = misses;
  let lastOptions = compactOptions;
  if (tightens(compact) && compact.sizing) {
    const tightWarning = tightSpacingWarning(misses, { width: 'cell air, column gaps and side margins', height: 'row air and top and bottom margins' }, 'the table', 'compact', { ...compact, sizing: compact.sizing }, options);
    compact = run(lastOptions = {
      ...compactOptions, [TIGHT_SPACING]: { columns: missesWidth, rows: missesHeight },
      ...(missesWidth ? {
        cellPadX: Math.min(cellPadX, TIGHT_PAD),
        labelIndent: { base: TIGHT_PAD + (options.outlineMarks === true ? INDENT_BASE : 0), step: TIGHT_PAD * 2 },
      } : {}),
      margin: {
        ...(missesHeight ? { top: TIGHT_PAD * 2, bottom: TIGHT_PAD * 2 } : {}), ...margin,
        ...(missesWidth ? { left: Math.min(margin.left ?? CARD_GUTTER, TIGHT_PAD * 2), right: Math.min(margin.right ?? CARD_GUTTER, TIGHT_PAD * 2) } : {}),
      },
    }, sizingOnly);
    // A head kept whole ("WEEK 1") gives way before the table misses its width.
    if (missesSize(compact, options).width && resolved.columns.some((col) => / \S{1,2}$/u.test(col.label ?? ''))) {
      const loose = run({ ...lastOptions, [HEAD_LOOSE]: true }, sizingOnly);
      if (!missesSize(loose, options).width) { compact = loose; lastOptions = { ...lastOptions, [HEAD_LOOSE]: true }; }
    }
    compact.warnings.push(tightWarning);
  }
  // A pinned height that still misses takes the sub-labels back to one line before it refuses:
  // a wrapped sub-label must not refuse a table that draws with it on one line. Each keeps its
  // track's cell air, cut with the full text as a title, as a head label is.
  if (missesHeight && compact.sizing && compact.size.height + 0.5 < compact.sizing.minHeight
    && resolved.columns.some((col) => col.subLabel !== undefined)) {
    const warnings = compact.warnings;
    compact = run({ ...lastOptions, [SUB_LINES]: 1 }, sizingOnly);
    // The tight rung's size advice still holds.
    for (const warning of warnings) if (warning.code === 'table-tight-spacing' && !compact.warnings.includes(warning)) compact.warnings.push(warning);
  }
  compact.warnings.push({ code: 'table-compact-fallback', severity: 'info', message: `The full table did not fit. Compact spacing and tight margins${heightOmitted(options.size) ? ' and automatic height' : ''} were used.` });
  return compact;
}
