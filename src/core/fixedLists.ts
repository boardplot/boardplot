/**
 * Number lists that never change once made. A deep copy shares such a list, and a content key names it by an id:
 * lists with equal numbers get one id, and an id never names other numbers. A card of a dimension switch carries the
 * figures of every period of each line this way, so the cards of one request share them and their cache key stays short.
 */
const fixed = new WeakSet<readonly number[]>();
const ids = new WeakMap<readonly number[], number>();
const idsByContent = new Map<string, number>();
let nextId = 0;
let contentChars = 0;
/** The text the id map holds at most. Past it the map starts again: an id is never reused, so a list then gets a new one. */
const MAX_CONTENT_CHARS = 8 * 1024 * 1024;

/** Freezes `values` and marks the list as fixed. */
export function fixedNumbers(values: number[]): readonly number[] {
  Object.freeze(values);
  fixed.add(values);
  return values;
}

export const isFixedNumbers = (value: unknown): boolean => fixed.has(value as readonly number[]);

/** The id of a fixed list: the same for every list with the same numbers, −0 and 0 apart. */
export function fixedNumbersId(list: readonly number[]): number {
  let id = ids.get(list);
  if (id !== undefined) return id;
  const content = list.map((value) => (Object.is(value, -0) ? '-0' : String(value))).join(',');
  id = idsByContent.get(content);
  if (id === undefined) {
    if (contentChars + content.length > MAX_CONTENT_CHARS) { idsByContent.clear(); contentChars = 0; }
    id = nextId++;
    idsByContent.set(content, id);
    contentChars += content.length;
  }
  ids.set(list, id);
  return id;
}
