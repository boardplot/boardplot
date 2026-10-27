import { chartString } from '../strings/a11y-eventRecords';
import { eventHeading } from '../eventReading';
import { targetId, textValue, type RecordContext } from './recordsShared';
import type { InteractionRecord } from './types';

/**
 * One record per event of the event lane, a dated event too: the event's own
 * title as the value, its date or category and kind as fields, and every item
 * with its detail in `event`. The hover card and the keyboard stop read it;
 * the accessible data table leaves it out (it is not a plotted value).
 * Its nodes are every node the lane and the key drew for the event.
 */
export function eventRecords(ctx: RecordContext): InteractionRecord[] {
  return ctx.geometry.annotations.flatMap((placed): InteractionRecord[] => {
    const { event } = placed;
    if (placed.kind !== 'event' || !event) return [];
    const owner = { annotationId: placed.id };
    const target = { ...ctx.scope, owner };
    const { anchor, ...reading } = event;
    return [{
      id: targetId(target), target, label: eventHeading(event) || event.items[0]!.title,
      value: textValue(event.items[0]!.title),
      fields: [
        ...(event.dateText ? [{ key: 'date', label: chartString(ctx.request.options, 'date'), value: textValue(event.dateText) }] : []),
        ...(event.place ? [{ key: 'place', label: chartString(ctx.request.options, 'category'), value: textValue(event.place) }] : []),
        ...(event.group ? [{ key: 'group', label: chartString(ctx.request.options, 'recordKind'), value: textValue(event.group) }] : []),
      ],
      comparisons: [], annotations: [], claimIds: [],
      nodeIds: ctx.geometry.scene.filter(node => node.owner.annotationId === placed.id).map(node => node.id),
      ...(anchor ? { anchor } : {}),
      event: reading,
    }];
  });
}
