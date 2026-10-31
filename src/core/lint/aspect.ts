/**
 * Aspect lints — height-off-ladder, aspect-cap,
 * plot-under-min, over the type→class map.
 *
 * POPULATION (named out loud): these run at the DOCUMENT
 * boundary — `layoutDocChart` in the CLI (validate / lint / render / update,
 * and MCP through it), the surface that ships artifacts to a user. They
 * deliberately do NOT run inside per-chart layout: grid PANELS lay out
 * through the registry with slot-sized canvases
 * (350×190 is a healthy panel and an illegal canvas), and a panel is not a
 * canvas. The grid's own canvas passes this boundary like every other chart.
 *
 * All three lints measure `geo.size` / `geo.plot` — the rendered truth —
 * never the authored option, so a width-economized table is judged at the
 * width it actually ships.
 */

import {
  ASPECT_CAPS,
  ASPECT_LADDER,
  LADDER_TOLERANCE,
  aspectClassFor,
  nearestLadderStep,
  onLadderStep,
  type AspectClass,
  type LadderStepName,
} from '../aspect';
import type { LintWarning } from '../types/scene';
import type { Rect, Size } from '../geometry';
import { contentSized, heightOmitted } from '../sizing';
import { resolveTheme } from '../theme';
import type { ThemeRef } from '../types/theme';

/** Absolute plot floors. */
const PLOT_MIN = { cartesianH: 120, cartesianW: 320, cardH: 40, appliesFromWidth: 720 } as const;

/** Steps a class may legally sit on (non-strip never flatter than 3.60). */
function legalSteps(cls: AspectClass): { name: LadderStepName; ratio: number }[] {
  return ASPECT_LADDER.filter((s) => (cls === 'strip' ? true : s.ratio <= ASPECT_CAPS.flatNonStrip));
}

/** Smallest legal ladder height ≥ `minHeight` at this width that `fits`, or null. */
function nextStepUp(
  width: number,
  minHeight: number,
  cls: AspectClass,
  fits?: (size: Size) => boolean,
): { name: LadderStepName; height: number } | null {
  for (const { name, ratio } of legalSteps(cls)) {
    const height = Math.round(width / ratio);
    if (height >= minHeight && (!fits || fits({ width, height }))) return { name, height };
  }
  return null;
}

/** The height a layout warning's size fix names at this width, or 0. */
function planned(warning: LintWarning, width: number): number {
  const op = warning.fix?.find((o) => o.op === 'replace' && o.path === '/options/size');
  const value = op && 'value' in op ? (op.value as Partial<Size>) : undefined;
  return value?.width === width ? value.height ?? 0 : 0;
}

/**
 * The height a size fix may not go under: the chart's own minimum. The natural height of a content-fit chart
 * is a preference once the height is authored, and the height of a layout `plot-under-floor` fix is an estimate.
 */
function heightFloor(geo: { sizing?: { minHeight?: number } }): number {
  return geo.sizing?.minHeight ?? 0;
}

/**
 * The aspect lints for one top-level chart. Severities come from the
 * norm registry; geometry is never modified.
 */
function hostSlot(options: Record<string, unknown> | undefined): boolean {
  const size = options?.size;
  if (size === 'a4-landscape-content' || size === 'a4-portrait-content') return true;
  if (size === undefined) return options?.target === 'slide' || options?.target === 'print';
  return typeof size === 'object' && size !== null && 'height' in size && typeof size.height === 'number' &&
    'unit' in size && (size.unit === 'pt' || size.unit === 'mm');
}

export function aspectDocLints(
  type: string,
  options: Record<string, unknown> | undefined,
  geo: { size: Size; plot: Rect; marks?: unknown; warnings?: LintWarning[]; sizing?: { fit?: 'fill' | 'content'; minHeight?: number; naturalHeight?: number } },
  fits?: (size: Size) => boolean,
): LintWarning[] {
  const cls = aspectClassFor(type, options, geo.marks);
  if (!cls) return []; // unregistered type — nothing to judge against
  // Content sizing wins over the aspect cap: a chart that takes the height of its content (a kpi
  // card, a bar list nobody sized) has no canvas proportion to judge.
  if (contentSized(type, options, geo.sizing?.fit)) return [];
  // a host slot (a physical pt/mm frame, an A4 content preset, or
  // the fixed slide/print target frame) sets its own shape; neither aspect
  // lint judges it against the screen height ladder.
  if (hostSlot(options)) return [];
  const warnings: LintWarning[] = [];
  const { width, height } = geo.size;
  const canvas = `${width}x${height}`;
  const ratio = width / height;
  // The bullet card takes its height from its rows too (rowDrivenHeight).
  const rowDriven = cls === 'row-driven' || cls === 'matrix' || type === 'bullet';
  const fixedRows = (type === 'bar' || type === 'likert') && resolveTheme(options?.theme as ThemeRef | undefined).space.barRow !== undefined;

  // ---- aspect-cap --------------------------------------------------
  // Compared on heights so the ±2% rounding grace of height-off-ladder carries over: a
  // canvas ON the boundary step (band 3.60, tall 1.33) is never capped.
  const flatCapRatio = cls === 'strip' ? ASPECT_CAPS.flatAbsolute : ASPECT_CAPS.flatNonStrip;
  const flatMinHeight = Math.round(width / flatCapRatio);
  const tallMaxHeight = Math.round(width / ASPECT_CAPS.tall);
  const minHeight = heightFloor(geo);
  // A height fix is offered only at a size that draws with no further size fix. The caller's probe says so;
  // without one the size is trusted.
  const sizeFix = (h: number) => (fits && !fits({ width, height: h })
    ? undefined
    : [{ op: 'replace' as const, path: '/options/size', value: { width, height: h } }]);
  // Content can raise an automatic height above every ladder step. Neither
  // aspect lint should ask the caller to undo that required height.
  const automaticTall = height > tallMaxHeight && heightOmitted(options?.size);
  // A table is flat because it has few rows, and its rows keep their pitch:
  // a taller canvas only pads empty space under them, so the flat cap does
  // not judge it. Types that stretch their marks to the canvas keep
  // it. The message names the cap its height comes from.
  if (type !== 'table' && height < flatMinHeight * (1 - LADDER_TOLERANCE)) {
    warnings.push({
      code: 'aspect-cap',
      severity: 'warn',
      message: `'${type}' canvas ${canvas} is ${ratio.toFixed(2)}:1, flatter than the ${flatCapRatio.toFixed(2)}:1 limit this type allows. At width ${width} the height has to be at least ${flatMinHeight}px.`,
      suggest: `Raise the height to ${flatMinHeight}px.`,
      field: ['options', 'size'],
      fix: [{ op: 'replace', path: '/options/size', value: { width, height: flatMinHeight } }],
    });
  } else if (!rowDriven && !automaticTall && height > tallMaxHeight * (1 + LADDER_TOLERANCE)) {
    const lower = tallMaxHeight >= minHeight ? sizeFix(tallMaxHeight) : undefined;
    warnings.push({
      code: 'aspect-cap',
      severity: 'warn',
      message: `'${type}' canvas ${canvas} is ${ratio.toFixed(2)}:1, taller than the ${ASPECT_CAPS.tall.toFixed(2)}:1 limit. Only charts whose height comes from their row count go above it. At width ${width} the height has to be at most ${tallMaxHeight}px.`,
      suggest: lower ? `Lower the height to ${tallMaxHeight}px.` : 'Shorten the chart content or use a wider canvas.',
      field: ['options', 'size'],
      ...(lower ? { fix: lower } : {}),
    });
  }

  // The layout's plot-floor fix is an estimate made without this cap. When it is taller than the cap allows,
  // applying it only trades one warning for the other. The fix then goes to the cap height when that size draws
  // clean. A canvas already at the cap, or a cap height that still needs more, keeps no fix and the advice names both limits.
  const floorWarning = geo.warnings?.find((w) => w.code === 'plot-under-floor' && w.fix);
  const floorHeight = floorWarning ? planned(floorWarning, width) : 0;
  if (floorWarning && !rowDriven && floorHeight > tallMaxHeight * (1 + LADDER_TOLERANCE)) {
    const lower = height < tallMaxHeight * (1 - LADDER_TOLERANCE) ? sizeFix(tallMaxHeight) : undefined;
    if (lower) {
      floorWarning.fix = lower;
      floorWarning.suggest = `Give the chart ${tallMaxHeight}px of height, the most the aspect cap allows at width ${width}. The estimate is ${floorHeight}px, so check it with measure, or widen the chart.`;
    } else {
      delete floorWarning.fix;
      floorWarning.suggest = `Widen the chart or leave the height out. At width ${width} the estimate is ${floorHeight}px and the aspect cap allows at most ${tallMaxHeight}px.`;
    }
  }

  // ---- height-off-ladder / info variant -----------------------------------
  // A height the engine chose (the host left it open) is not judged
  // against the ladder; only an authored height is. The automatic heights follow the content.
  if (onLadderStep(geo.size) === null && !automaticTall && !heightOmitted(options?.size)) {
    const nearest = nearestLadderStep(geo.size);
    if (rowDriven) {
      warnings.push({
        code: 'height-off-ladder:row-driven',
        severity: 'info',
        message: `'${type}' canvas ${canvas} is off the standard height steps. ${fixedRows ? 'The theme fixes the row pitch, and the authored height only adds space under the rows' : type === 'table' ? 'A table takes its height from its rows, and the authored height only adds space under them' : 'This type takes its natural height from its rows, and the authored height stretches them to fill the canvas'}, so this is an observation only. The nearest step is ${nearest.name} at ${width}x${nearest.height}.`,
      });
    } else {
      // The nearest step may sit under the height the chart needs: the smallest legal step above it is the fix.
      const snap = nearest.height >= minHeight && (!fits || fits({ width, height: nearest.height })) ? nearest : nextStepUp(width, minHeight, cls, fits);
      warnings.push({
        code: 'height-off-ladder',
        severity: 'warn',
        message: `'${type}' canvas ${canvas} is off the standard height steps for width ${width}. The nearest step is ${nearest.name} at ${width}x${nearest.height}.`,
        suggest: snap ? `Use height ${snap.height}px at width ${width}.` : 'Shorten the chart content or use a wider canvas.',
        field: ['options', 'size'],
        ...(snap ? { fix: [{ op: 'replace' as const, path: '/options/size', value: { width, height: snap.height } }] } : {}),
      });
    }
  }

  // ---- plot-under-min ----------------------------------------------
  // Cartesian floors at document widths ≥ 720; card floor at every width.
  // Row-driven/matrix rows are floored by the pitch minima, and
  // the funnel silhouette / geo classes have no cartesian plot rect.
  const cartesian = cls === 'standard-cartesian' || cls === 'wide-time';
  const plotW = Math.round(geo.plot.w);
  const plotH = Math.round(geo.plot.h);
  if (cartesian && width >= PLOT_MIN.appliesFromWidth && (plotH < PLOT_MIN.cartesianH || plotW < PLOT_MIN.cartesianW)) {
    const deficit = Math.max(0, PLOT_MIN.cartesianH - plotH);
    const step = nextStepUp(width, height + deficit, cls);
    const roomy = step && plotW >= PLOT_MIN.cartesianW;
    const remedy = roomy
      ? `Raise the height to ${step.height}px, or present the figures as a table.`
      : 'Present the figures as a table.';
    warnings.push({
      code: 'plot-under-min',
      severity: 'warn',
      message: `'${type}' leaves only ${plotW}x${plotH}px for the plot itself, under the ${PLOT_MIN.cartesianW}x${PLOT_MIN.cartesianH}px floor. ${remedy}`,
      suggest: remedy,
      field: ['options', 'size'],
      ...(roomy ? { fix: [{ op: 'replace', path: '/options/size', value: { width, height: step!.height } }] } : {}),
    });
  } else if (cls === 'card' && plotH < PLOT_MIN.cardH) {
    const step = nextStepUp(width, height + (PLOT_MIN.cardH - plotH), cls);
    warnings.push({
      code: 'plot-under-min',
      severity: 'warn',
      message: `'${type}' card plot is ${plotH}px high, under the ${PLOT_MIN.cardH}px floor. ${step ? `Raise the height to ${step.height}px, or present the figures as a table.` : 'Present the figures as a table.'}`,
      suggest: step ? `Raise the height to ${step.height}px.` : 'Present the figures as a table.',
      field: ['options', 'size'],
      ...(step ? { fix: [{ op: 'replace', path: '/options/size', value: { width, height: step.height } }] } : {}),
    });
  }

  return warnings;
}
