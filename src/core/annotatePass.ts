/**
 * How a layout reaches the annotation placement pass.
 *
 * `runAnnotatePass` and the two arms the rows funnel draws itself pull
 * `annotate.ts`, `annotateTargets.ts` and `annotateArms.ts` — 39 KB minified
 * of placement engine. Fifteen layouts call the pass, unconditionally,
 * because a chart may carry authored annotations, a value line, a target or
 * a derived callout; most charts carry none of them. A per-type React entry
 * therefore links this accessor instead, and fetches the engine the moment a
 * chart turns out to need it (`core/deferred`): the component draws the busy
 * placeholder for that one round trip and then lays out exactly as before.
 *
 * The CLI, the MCP server, `boardplot`, `boardplot/validate`,
 * `react/prepare`, `useChartLayout` and any graph with the whole chart
 * catalogue import `core/annotateEngine` and never wait.
 *
 * Nothing about the layouts changes: they call the same function with the
 * same input and read the same result. The small helpers beside the pass
 * (`indicator100LabelRect`, `pruneOrphanAnnotationArms`,
 * `categoryTargetFields`, `spliceAnnotationNodes`, `valueLineHasTargetExtras`)
 * stay where they were: each is a few hundred bytes and the bundler drops the
 * rest of their module.
 */

import { DeferredCoreError, loadedDeferred, registerDeferredLoader, requireDeferred, type AnnotateEngine } from './deferred';
import type { AnnotatePassInput, AnnotatePassResult } from './annotate';
import type { EmittedLane, LaneSettleInput, SettledLane } from './eventLane';
import type { FrameResult } from './frame';
import { parseFormatExample, specUnitKind } from './formatSpec';

registerDeferredLoader('annotate', () => import('./annotateEngine'));

/**
 * The annotation placement pass. Identical in signature and result to
 * `annotate.ts`'s, and identical in what it produces.
 *
 * The empty pass is answered here. A layout calls the pass whether or not
 * its chart carries an annotation, and `input.annotations` is the whole of
 * the work: authored annotations, value lines, targets and every derived
 * callout a domain added are all in that list by the time the pass runs. An
 * empty list means the engine walks nothing, solves no label and returns
 * exactly this — no node, no placement, no warning.
 *
 * Nothing else is consulted, and `comparisonLayout` in particular is not. A
 * pie, butterfly, heatmap or funnel hands the pass a fresh comparison helper
 * on every layout whether or not a comparison was authored; treating its
 * presence as work made every one of those charts wait for a chunk with
 * nothing to draw, and made a server pass write the placeholder. The helper
 * is only ever called from inside the pass, and its `emit` over an empty
 * plan list returns no node.
 */
export function runAnnotatePass(input: AnnotatePassInput): AnnotatePassResult {
  const engine = loadedDeferred('annotate');
  if (engine) return engine.runAnnotatePass(input);
  if (input.annotations.length > 0) throw new DeferredCoreError('annotate');
  return { nodes: [], placed: [], labels: [], decisions: [], warnings: [], legDeficit: 0, gapBracketNeed: 0, gapBracketHidden: [], bandNeed: 0 };
}

/** Percent cells, units or examples identify percent levels; an explicit non-percent unit keeps its meaning. */
export function percentLevels(series: readonly { vals: readonly { v: number | null; isPct?: boolean; format?: string }[]; format?: string; unit?: string }[], format?: string, unit?: string): boolean {
  let seen = false;
  for (const source of series) for (const cell of source.vals) {
    if (cell.v === null) continue;
    seen = true;
    const example = cell.format ?? source.format ?? format;
    const sourceUnit = source.unit ?? unit;
    if (!cell.isPct && sourceUnit !== '%' && (sourceUnit !== undefined || !example || specUnitKind(parseFormatExample(example)) !== 'percent')) return false;
  }
  return seen;
}

/**
 * The arm drawers a chart calls from inside its own comparison hook. That
 * hook only ever runs while the pass is running, so the engine is here.
 */
export function annotateEngine(): AnnotateEngine {
  return requireDeferred('annotate');
}

/**
 * The event lane (core/eventLane), which loads with the engine. A chart
 * without an event lays out here with no lane and no key: the chart's frame
 * and plot functions run as they would without this call. A chart with one
 * waits for the engine like any annotated chart.
 */
export function settleEventLane<F extends { frame: FrameResult }, A>(input: LaneSettleInput<F, A>): SettledLane<F, A> {
  if (!input.annotations.some((annotation) => annotation.kind === 'event')) {
    const framed = input.solve(undefined, input.warnings);
    return { framed, area: input.area(framed, input.warnings) };
  }
  return requireDeferred('annotate').settleEventLane(input);
}

/** Draws a settled lane; a lane exists only once the engine is here. */
export function emitEventLane(...args: Parameters<AnnotateEngine['emitEventLane']>): EmittedLane {
  return requireDeferred('annotate').emitEventLane(...args);
}
