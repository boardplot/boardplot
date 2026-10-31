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

/** Smallest legal ladder height ≥ `minHeight` at this width, or null. It words the plot-under-min message. */
function nextStepUp(
  width: number,
  minHeight: number,
  cls: AspectClass,
): { name: LadderStepName; height: number } | null {
  for (const { name, ratio } of legalSteps(cls)) {
    const height = Math.round(width / ratio);
    if (height >= minHeight) return { name, height };
  }
  return null;
}

/**
 * Names the first height of an ordered list that draws with no size warning, or none. Only `measure` has
 * one: a drawing is what verifies a height, and the render path draws nothing extra.
 */
export type HeightVerifier = (width: number, heights: readonly number[]) => number | undefined;

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
  geo: { size: Size; plot: Rect; marks?: unknown; sizing?: { fit?: 'fill' | 'content'; minHeight?: number } },
  verify?: HeightVerifier,
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
  const minHeight = geo.sizing?.minHeight ?? 0;
  // A size patch names a height that was drawn. Without a verifier the warning carries none and its suggest says how to get one.
  const unverified = 'Call measure for a verified size, widen the chart, or leave the height out.';
  const steps = legalSteps(cls).map((step) => Math.round(width / step.ratio));
  // The ladder heights that satisfy `keeps`, nearest to the current height first. They sit inside both caps.
  const candidates = (keeps: (h: number) => boolean): number[] => [...new Set(steps)]
    .filter((h) => h !== height && h >= minHeight && keeps(h))
    .sort((a, b) => Math.abs(a - height) - Math.abs(b - height) || a - b);
  const patch = (keeps: (h: number) => boolean) => {
    const verified = verify?.(width, candidates(keeps));
    return verified === undefined ? undefined : { height: verified, fix: [{ op: 'replace' as const, path: '/options/size', value: { width, height: verified } }] };
  };
  // Content can raise an automatic height above every ladder step. Neither
  // aspect lint should ask the caller to undo that required height.
  const automaticTall = height > tallMaxHeight && heightOmitted(options?.size);
  // A table is flat because it has few rows, and its rows keep their pitch:
  // a taller canvas only pads empty space under them, so the flat cap does
  // not judge it. Types that stretch their marks to the canvas keep
  // it. The message names the cap its height comes from.
  if (type !== 'table' && height < flatMinHeight * (1 - LADDER_TOLERANCE)) {
    const raised = patch((h) => h >= flatMinHeight * (1 - LADDER_TOLERANCE));
    warnings.push({
      code: 'aspect-cap',
      severity: 'warn',
      message: `'${type}' canvas ${canvas} is ${ratio.toFixed(2)}:1, flatter than the ${flatCapRatio.toFixed(2)}:1 limit this type allows. At width ${width} the height has to be at least ${flatMinHeight}px.`,
      suggest: raised ? `Raise the height to ${raised.height}px.` : unverified,
      field: ['options', 'size'],
      ...(raised ? { fix: raised.fix } : {}),
    });
  } else if (!rowDriven && !automaticTall && height > tallMaxHeight * (1 + LADDER_TOLERANCE)) {
    const lowered = patch((h) => h <= tallMaxHeight * (1 + LADDER_TOLERANCE));
    warnings.push({
      code: 'aspect-cap',
      severity: 'warn',
      message: `'${type}' canvas ${canvas} is ${ratio.toFixed(2)}:1, taller than the ${ASPECT_CAPS.tall.toFixed(2)}:1 limit. Only charts whose height comes from their row count go above it. At width ${width} the height has to be at most ${tallMaxHeight}px.`,
      suggest: lowered ? `Lower the height to ${lowered.height}px.` : unverified,
      field: ['options', 'size'],
      ...(lowered ? { fix: lowered.fix } : {}),
    });
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
      const snapped = patch(() => true);
      warnings.push({
        code: 'height-off-ladder',
        severity: 'warn',
        message: `'${type}' canvas ${canvas} is off the standard height steps for width ${width}. The nearest step is ${nearest.name} at ${width}x${nearest.height}.`,
        suggest: snapped ? `Use height ${snapped.height}px at width ${width}.` : unverified,
        field: ['options', 'size'],
        ...(snapped ? { fix: snapped.fix } : {}),
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
    const raised = roomy ? patch((h) => h >= height + deficit) : undefined;
    warnings.push({
      code: 'plot-under-min',
      severity: 'warn',
      message: `'${type}' leaves only ${plotW}x${plotH}px for the plot itself, under the ${PLOT_MIN.cartesianW}x${PLOT_MIN.cartesianH}px floor. ${remedy}`,
      suggest: raised ? `Raise the height to ${raised.height}px, or present the figures as a table.` : roomy ? unverified : remedy,
      field: ['options', 'size'],
      ...(raised ? { fix: raised.fix } : {}),
    });
  } else if (cls === 'card' && plotH < PLOT_MIN.cardH) {
    const step = nextStepUp(width, height + (PLOT_MIN.cardH - plotH), cls);
    const raised = step ? patch((h) => h >= height + (PLOT_MIN.cardH - plotH)) : undefined;
    warnings.push({
      code: 'plot-under-min',
      severity: 'warn',
      message: `'${type}' card plot is ${plotH}px high, under the ${PLOT_MIN.cardH}px floor. ${step ? `Raise the height to ${step.height}px, or present the figures as a table.` : 'Present the figures as a table.'}`,
      suggest: raised ? `Raise the height to ${raised.height}px.` : step ? unverified : 'Present the figures as a table.',
      field: ['options', 'size'],
      ...(raised ? { fix: raised.fix } : {}),
    });
  }

  return warnings;
}
