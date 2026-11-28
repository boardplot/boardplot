/**
 * The whole text of an event of the event lane, as one reading: when it
 * happened, its kind, and each item with its detail. SVG titles, interaction
 * records and hover cards use this text.
 */

import type { InteractionEvent } from './a11y/types';

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
