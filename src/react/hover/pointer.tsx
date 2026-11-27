/**
 * The pointer, touch and key handlers of one chart's hover, the cards it
 * opens, and what it tells the page and the other charts of its group. This
 * module is part of the hover engine chunk: `useHover` holds the state and
 * calls in here once the chunk is on the page.
 */

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import type { InteractionRecord } from '../../core/a11y/types';
import { rectContains, type Point } from '../../core/geometry';
import type { HoverGroupStore, HoverLink } from '../hoverGroupContext';
import { SceneRenderer } from '../SceneRenderer';
import type { HoverContext, HoverRefs, RenderHoverContent } from '../useHover';
import { useIsomorphicLayoutEffect } from '../useIsomorphicLayoutEffect';
import { ChartCard, CustomCard, activates, cardFollower, clickedRecord, framedHosts, hoverSelection, hoverViewport, inCardCorridor, pooled, type HoverModel, type HoverSelection, type HoverView } from './engine';
import { keyboardOrder, keyboardReading, keyboardSelection, keyboardStep } from './keyboard';
import { labelCardGeometry } from './labelCard';

/** How long the default card stays after the pointer leaves the chart or every mark, in milliseconds. */
const FOLLOW_CLOSE = 100;

const RECORD_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']);

function isKeyStop(target: EventTarget): boolean {
  return target instanceof Element && target.hasAttribute('data-bp-keys');
}

function clearTimer(refs: HoverRefs, key: 'close' | 'rest'): void {
  if (refs[key] !== undefined) clearTimeout(refs[key]);
  refs[key] = undefined;
}

/**
 * The records of this chart that another chart's hover names: the same
 * category, and the same series where this chart has it. A record that stands
 * for other categories or series (a generated Others bucket) is never matched: two
 * charts give it the same id for different members.
 */
function linkedIds(model: HoverModel, link: HoverLink): string[] {
  const records = model.records.filter(record => record.target.owner.categoryId === link.categoryId
    && record.target.owner.annotationId === undefined && !pooled(record) && record.cardFields?.length !== 0);
  const series = records.filter(record => record.target.owner.seriesId === link.seriesId);
  return (series.length ? series : records).map(record => record.id);
}

/**
 * What a chart shows for the hover of another chart of its group: the
 * highlight of the matching records and a small card with its own numbers
 * beside them, inside its own frame. A chart not yet measured draws no card (`hoverView`).
 */
function linkedSelection({ geometry, refs }: HoverContext, ids: string[]): HoverSelection {
  const host = refs.host;
  const viewport = host ? hoverViewport(host, geometry.size) : undefined;
  return { ids, measurement: host && viewport ? { host, size: geometry.size, viewport } : undefined, position: { linked: true, viewport } };
}

/**
 * Tells the page and the group what this chart's own hover rests on. The page
 * hears a change of the hovered records, also the same marks after a new
 * layout, whose records carry the new values. A linked highlight is not this
 * chart's hover.
 */
export function reportHover(refs: HoverRefs, model: HoverModel, selection: HoverSelection | undefined,
  listener: ((records: InteractionRecord[]) => void) | undefined, group: HoverGroupStore | undefined): void {
  const ids = selection && !selection.position?.linked ? selection.ids : [];
  const records = ids.flatMap(id => model.records.find(record => record.id === id) ?? []);
  if (records.length !== refs.reported.length || records.some((record, index) => record !== refs.reported[index])) {
    refs.reported = records;
    listener?.(records);
  }
  const first = records.find(record => record.target.owner.categoryId !== undefined && record.target.owner.annotationId === undefined && !pooled(record));
  group?.set(refs, first && { categoryId: first.target.owner.categoryId!, seriesId: first.target.owner.seriesId });
}

/** The handlers of one render, and the two updates the chart runs after a new layout and a new group hover. */
export function hoverDriver(context: HoverContext) {
  const { model, request, geometry, view, selection, setSelection, cursor, setCursor, hover, keys, custom, scrub, grouped, onRecordClick, refs } = context;
  if (refs.host) { if (grouped) framedHosts.add(refs.host); else framedHosts.delete(refs.host); }
  const position = selection.position;
  // A record with no card is a keyboard stop only while a click callback can activate it, or the host draws its card.
  const activation = onRecordClick !== undefined || custom;
  // A linked highlight is not an open card of this chart: the pointer and the close timer treat it as nothing open.
  const open = position?.linked ? 0 : selection.ids.length;
  const inCard = (target: EventTarget | null) => target instanceof Node && refs.card?.contains(target) === true;
  // Only this chart's own card closes: the highlight another chart of the group put here stays until that chart clears it.
  const close = () => { clearTimer(refs, 'close'); clearTimer(refs, 'rest'); refs.follower?.cancel(); setSelection(current => current.position?.linked ? current : { ids: [] }); };
  /** The reading order of the drawn model, built on the first keyboard use and again after a new layout or callback. */
  const records = (): InteractionRecord[] => {
    if (refs.order.model !== model || refs.order.activation !== activation) refs.order = { model, activation, records: keyboardOrder(model, request, geometry, activation) };
    return refs.order.records;
  };
  /** Rest the keyboard on the record at `index` of the order; `open` also opens its card, as the last input. */
  const show = (index: number, opens = true) => {
    // The keyboard takes over: no pending pointer close, re-pick or card move may replace its record.
    clearTimer(refs, 'close'); clearTimer(refs, 'rest'); refs.follower?.cancel();
    const list = records();
    const surface = refs.host;
    if (!surface || !list.length) return;
    const at = Math.min(Math.max(index, 0), list.length - 1);
    const record = list[at]!;
    refs.last = { id: record.id, index: at };
    const reading = keyboardReading(model, request, record);
    setCursor(current => ({ id: record.id, index: at, size: list.length, reading, active: opens || current?.active === true }));
    if (opens) setSelection(current => keyboardSelection(model, request, surface, view, current, record));
  };
  const pick = (event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    setSelection(hoverSelection(model, request, event, view, selection, custom));
  };
  /**
   * A card stays while the pointer travels to it: inside the corridor
   * from the point the record was picked to the card, and getting closer.
   * A pointer that rests there for 250 ms is hit-tested again.
   */
  const towardCard = (event: PointerEvent<HTMLElement>): boolean => {
    // A label card over the points' path lets the pointer through: the pointer picks the point under it.
    const shown = open && (custom || !view.card?.overPath) ? refs.card?.getBoundingClientRect() : undefined;
    const box = shown && shown.width > 0 && shown.height > 0 ? shown : undefined;
    const at = { x: event.clientX, y: event.clientY };
    const distance = box ? Math.hypot(Math.max(box.left - at.x, 0, at.x - box.right), Math.max(box.top - at.y, 0, at.y - box.bottom)) : Infinity;
    const { from } = refs.corridor;
    if (box && from && distance < refs.corridor.distance
      && inCardCorridor(from, { x: box.left, y: box.top, w: box.width, h: box.height }, at, view.cardInput?.path, position?.viewport?.origin)) {
      refs.corridor.distance = distance;
      clearTimer(refs, 'rest');
      const rest = { currentTarget: event.currentTarget, target: event.target, clientX: event.clientX, clientY: event.clientY } as unknown as PointerEvent<HTMLElement>;
      refs.rest = setTimeout(() => { refs.corridor = { from: at, distance: Infinity }; pick(rest); }, 250);
      return true;
    }
    refs.corridor = { from: at, distance: Infinity };
    return false;
  };
  /** `along`: a finger that slides along a line. It reads the category under it, not the element the touch began on. */
  const point = (event: PointerEvent<HTMLElement>, along = false) => {
    // A mouse or pen moves the default card with the pointer; a tap and the host's own card keep their seat beside the mark.
    const follows = !custom && event.pointerType !== 'touch';
    if (!follows) clearTimer(refs, 'close');
    // The card's own content belongs to the host: a pointer in it keeps the card where it is.
    if (inCard(event.target)) { clearTimer(refs, 'close'); clearTimer(refs, 'rest'); return; }
    // A card that holds keyboard focus stays until focus leaves it; a tap still picks a new record.
    if (event.pointerType !== 'touch' && refs.card?.contains(refs.card.ownerDocument.activeElement)) return;
    if (!follows && !along && towardCard(event)) return;
    clearTimer(refs, 'rest');
    setCursor(current => current?.active ? { ...current, active: false } : current);
    const next = hoverSelection(model, request, event, view, selection, custom, along);
    // Nothing open and nothing hit: no state changes, so the chart does not render again.
    // A finger that slides off the marks keeps the card it has.
    if (!next.ids.length && (!open || along)) return;
    if (follows && !next.ids.length) {
      // An empty spot closes the card after a moment, as leaving the chart does, so crossing a gap between marks does not flicker it.
      refs.close ??= setTimeout(close, FOLLOW_CLOSE);
      return;
    }
    clearTimer(refs, 'close');
    if (next === selection) {
      // The same records: only the card moves, outside React.
      if (follows) (refs.follower ??= cardFollower()).move(refs.card, next, geometry.size, event.clientX, event.clientY);
      return;
    }
    refs.follower?.cancel();
    setSelection(next);
  };
  // A click on a mark names the record the hover card names. It runs before the
  // mark's own series click, which then does not fire: the legend keeps it.
  const onClickCapture = onRecordClick && ((event: MouseEvent<HTMLElement>) => {
    // A click in the host's card (a link) is the host's, never a mark's under the card.
    if (inCard(event.target)) return;
    const record = clickedRecord(model, request, event, view);
    if (!record) return;
    event.stopPropagation();
    onRecordClick(record, event);
  });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (inCard(event.target)) {
      // Keys in the card are the host's. Escape closes it and returns the focus to what opened it.
      if (event.key === 'Escape') {
        event.preventDefault();
        refs.quiet = true;
        (refs.opener?.isConnected ? refs.opener : event.currentTarget.querySelector<HTMLElement>('[data-bp-keys]'))?.focus();
        refs.quiet = false;
        close();
      }
      return;
    }
    if (!isKeyStop(event.target) || event.altKey || event.ctrlKey || event.metaKey || !cursor) return;
    if (RECORD_KEYS.has(event.key)) {
      event.preventDefault();
      show(keyboardStep(records(), cursor.index, event.key, model, request));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const record = records()[cursor.index];
      // The key is the last input: the card and highlight return to the record it fires for.
      show(cursor.index);
      if (record && onRecordClick && activates(record)) onRecordClick(record, event);
    } else if (event.key === 'Escape' && open) {
      // The card closes; the focus stays on the record, and the next arrow opens it again.
      close();
    }
  };
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (inCard(event.target)) {
      // The focus holds the card: no pending close or re-pick takes it away.
      clearTimer(refs, 'close'); clearTimer(refs, 'rest');
      // Remember what opened the card: the record stop or an event marker.
      if (event.relatedTarget instanceof HTMLElement && !inCard(event.relatedTarget) && event.currentTarget.contains(event.relatedTarget)) refs.opener = event.relatedTarget;
      return;
    }
    // Escape from the card returns the focus here; the card it closed stays closed.
    if (!isKeyStop(event.target)) { if (hover && !refs.quiet) pick(event); return; }
    const found = records().findIndex(record => record.id === refs.last.id);
    show(found >= 0 ? found : refs.last.index, !refs.quiet);
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof Element)) return;
    // The focus moves into the card: the record and its card stay open.
    if (inCard(event.relatedTarget)) return;
    if (inCard(event.target)) {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) { close(); setCursor(undefined); }
      return;
    }
    if (isKeyStop(event.target)) {
      if (cursor?.active) close();
      setCursor(undefined);
    } else if (hover && event.target.hasAttribute('data-bp-stop')) close();
  };
  /** The finger that moves the card lifts, or the browser takes the touch for a scroll or a zoom: the card stays. */
  const lift = (event: PointerEvent<HTMLElement>) => { if (event.pointerId === refs.touch) refs.touch = undefined; };
  const handlers = { ...onClickCapture && { onClickCapture }, ...keys && { onFocus, onBlur, onKeyDown }, ...hover && {
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') point(event);
      else if (event.pointerId === refs.touch) point(event, true);
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') return;
      if (scrub) {
        // A second finger means a pinch: it picks nothing and ends the slide of the first.
        if (refs.touch !== undefined || event.isPrimary === false) { refs.touch = undefined; return; }
        const at = hoverViewport(event.currentTarget, geometry.size, event)?.pointer;
        const plots = model.placement?.panels?.map(panel => panel.plot) ?? (model.placement?.plot ? [model.placement.plot] : []);
        if (at && plots.some(plot => rectContains(plot, { ...at, w: 0, h: 0 }, 0))) refs.touch = event.pointerId;
      }
      point(event);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      clearTimer(refs, 'rest');
      // A card that holds the focus stays; else the pointer has 150 ms to cross a gap into the host's card.
      // The default card follows the pointer and closes after 100 ms.
      if (refs.card?.contains(refs.card.ownerDocument.activeElement)) return;
      clearTimer(refs, 'close');
      refs.close = setTimeout(close, custom ? 150 : FOLLOW_CLOSE);
    },
    ...scrub && { onPointerUp: lift, onPointerCancel: lift },
  } };
  return {
    handlers,
    /** After a new layout or callback: drop a hovered mark that no longer exists, and keep the focused record where it still exists. */
    sync() {
      setSelection(current => current.ids.length && !model.records.some(record => current.ids.includes(record.id))
        ? { ids: [] } : current);
      if (!cursor) return;
      const list = records();
      const found = list.findIndex(record => record.id === cursor.id);
      if (list.length) show(found >= 0 ? found : cursor.index, cursor.active && open > 0);
      else setCursor(undefined);
    },
    /** The hover of another chart of the group, or none: this chart's own hover and its keyboard focus win over it. */
    follow(link: HoverLink | undefined) {
      const ids = link ? linkedIds(model, link) : [];
      setSelection(current => current.ids.length && !current.position?.linked ? current
        : !ids.length ? (current.ids.length ? { ids: [] } : current)
        : current.ids.length === ids.length && ids.every((id, index) => id === current.ids[index]) ? current
        : linkedSelection(context, ids));
    },
  };
}

/** The host's own card content for the open card, or undefined where the host draws none. */
export function hostContent(view: HoverView, render: RenderHoverContent | undefined, keyboard: boolean): ReactNode | undefined {
  const active = view.active?.[0];
  return render && view.card && view.cardInput && active ? render(active, {
    records: view.active!, source: keyboard ? 'keyboard' : 'pointer',
    // The keyboard stop's option reads these facts already; the card's description adds only the host's own content.
    defaultContent: view.card.scene.length ? <div aria-hidden="true"><SceneRenderer geometry={labelCardGeometry(view.card)} theme={view.cardTheme!} responsive={false} /></div> : null,
  }) : undefined;
}

/** The open card of one chart: the host's own content, or the default card and its fade. */
export function Cards({ view, origin, follow, content, hosted, contentId, locale, cardRef }: {
  view: HoverView; origin?: Point; follow: boolean; content?: ReactNode; hosted: boolean; contentId: string; locale?: string;
  cardRef: (node: HTMLElement | null) => void;
}): ReactElement {
  const { card: shown, fading } = useFadingCard(!hosted && view.card && origin
    ? { layout: view.card, theme: view.cardTheme!, origin, follow } : undefined);
  return <>
    {content !== undefined && <CustomCard input={view.cardInput!} theme={view.cardTheme!} origin={origin} label={view.active![0]!.label}
      contentId={contentId} locale={locale} cardRef={cardRef}>{content}</CustomCard>}
    {shown && <ChartCard {...shown} cardRef={cardRef} hidden={fading} />}
  </>;
}

/** How long a closed card that followed the pointer stays mounted and faded out, in milliseconds. */
const LINGER = 500;

/**
 * The default card to draw and whether it is fading out. A card that followed
 * the pointer stays mounted for `LINGER` after it closes, so it fades out, and a
 * card that opens again within that time glides from where it was. Later it
 * unmounts, and the next card fades in at the pointer without travel.
 */
function useFadingCard<T extends { follow: boolean }>(open: T | undefined): { card?: T; fading: boolean } {
  const last = useRef<T | undefined>(undefined);
  const [, expire] = useState(0);
  useIsomorphicLayoutEffect(() => { if (open) last.current = open; });
  const kept = open === undefined && last.current?.follow ? last.current : undefined;
  useEffect(() => {
    if (open !== undefined || !last.current) return;
    if (!last.current.follow) { last.current = undefined; return; }
    const timer = setTimeout(() => { last.current = undefined; expire(count => count + 1); }, LINGER);
    return () => clearTimeout(timer);
  }, [open === undefined]);
  return { card: open ?? kept, fading: kept !== undefined };
}
