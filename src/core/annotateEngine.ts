/**
 * Publishes the annotation placement engine and the event lane (see
 * `core/deferred` and `core/annotatePass`). Linking this module links `annotate.ts` and makes
 * every layout's annotation pass synchronous.
 *
 * It is a module of its own rather than a call inside `annotate.ts`: several
 * layouts import small helpers from there, and a top-level reference to
 * `runAnnotatePass` would pin the whole engine into every bundle that
 * reaches one of them.
 *
 * An entry links it by calling `linkAnnotateEngine()`, for the reason
 * `core/themeShapeRules` gives. Importing the module still publishes.
 */

import { runAnnotatePass } from './annotate';
import { drawCagrArm, drawHorizontalLevelDiff } from './annotateArms';
import { publishDeferred } from './deferred';
import { emitEventLane, settleEventLane } from './eventLane';
import { defaultAnnotationId } from './types/annotations';
import type { PlacedLabel } from './types/scene';

/**
 * the drawn labels of authored callouts and notes whose text
 * prints the anchored value (`${value}`), each with the anchor ids its mark's
 * owner holds. Such a label is the value's label: the note does not name it.
 */
function valueAnnotationLabels(labels: readonly PlacedLabel[], annotations: unknown): [PlacedLabel, object][] {
  return (Array.isArray(annotations) ? annotations : []).flatMap((item, i) => (item?.kind === 'callout' || item?.kind === 'note') && `${item.text}${item.headline}`.includes('${value}')
    ? labels.filter((label) => label.kind === 'annotation' && !label.hidden && label.owner.annotationId === defaultAnnotationId(item, i))
      .map((label): [PlacedLabel, object] => [label, typeof item.at === 'string' ? { categoryId: item.at } : item.at ?? {}]) : []);
}

export function linkAnnotateEngine(): void {
  publishDeferred('annotate', { runAnnotatePass, settleEventLane, emitEventLane, drawCagrArm, drawHorizontalLevelDiff, valueAnnotationLabels });
}

linkAnnotateEngine();
