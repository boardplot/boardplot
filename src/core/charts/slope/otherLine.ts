import type { Id } from '../../types/cell';

/** The id of the fold's 'Other' line: 'other', prefixed until no series takes it. */
export function otherLineId(taken: readonly { id: Id }[]): Id {
  let id: Id = 'other';
  while (taken.some((s) => s.id === id)) id = `_${id}`;
  return id;
}
