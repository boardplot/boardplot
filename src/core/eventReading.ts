/**
 * The whole text of an event of the event lane, as one reading: when it
 * happened, its kind, and each item with its detail. The SVG `<title>`, the
 * description, the interaction records and the hover card all read it, so no
 * output holds less than another. Zod-free and tiny: the three chart types
 * with a lane load it with their layout.
 */

import { chartString } from './strings/eventReading';
import type { InteractionEvent } from './a11y/types';
import type { PlacedAnnotation } from './types/scene';

/** "10 Aug 2026, Out of stock": when or where, then the kind. */
export function eventHeading(event: InteractionEvent): string {
  return [event.dateText ?? event.place, event.group].filter(Boolean).join(', ');
}

/** One item: its title, then its detail lines as the key joins them. */
function eventItemText(item: InteractionEvent['items'][number]): string {
  return item.detail.length ? `${item.title} - ${item.detail.join(' · ')}` : item.title;
}

/** "10 Aug 2026, Out of stock: Title - detail / Second title - detail". */
export function eventReading(event: InteractionEvent): string {
  const heading = eventHeading(event);
  const items = event.items.map(eventItemText).join(' / ');
  return heading ? `${heading}: ${items}` : items;
}

/** The sentence a chart's description adds for its events; empty without one. */
function eventsDescription(annotations: readonly PlacedAnnotation[], options?: Pick<import('./types/options').BaseOptions, 'locale' | 'strings'>): string {
  const events = annotations.flatMap((annotation) => (annotation.kind === 'event' && annotation.event ? [eventReading(annotation.event)] : []));
  return events.length ? chartString(options, 'eventsSentence', { v1: events.join('; ') }) : '';
}

/**
 * A chart's layout with its events in the description. The layout of a chart
 * with an event lane (column, combo, line) goes through this, so the SVG
 * `<desc>` and the React `<desc>` list the same events. Mutates and returns
 * the geometry it was given; a refusal or a chart without an event is left
 * as it is.
 */
export function withEventsDescribed<G extends { a11y?: { desc: string }; annotations?: readonly PlacedAnnotation[] }>(geometry: G, options?: Pick<import('./types/options').BaseOptions, 'locale' | 'strings'>): G {
  const events = geometry.a11y && geometry.annotations ? eventsDescription(geometry.annotations, options) : '';
  if (events) geometry.a11y!.desc = `${geometry.a11y!.desc.replace(/\s*\.?\s*$/, '')}.${events}`;
  return geometry;
}
