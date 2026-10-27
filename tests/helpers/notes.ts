import type { ChartNote, NoteKind } from '../../src/core/notes';
import type { BaseOptions } from '../../src/core/types/options';

/** Opt a spec into drawing every note (footer rule), for tests whose subject is not the notes list. */
export const ALL_NOTES: NonNullable<BaseOptions['notes']> = { show: ['note', 'method'], maxLines: 1000, pointer: false };

type WithFrame = { frame?: { noteList?: ChartNote[]; notes?: string[] } };

/** Readable note text; treat non-breaking spaces as spaces in content assertions. */
export function noteTexts(geometry: WithFrame, kinds?: NoteKind[]): string[] {
  return (geometry.frame?.noteList ?? [])
    .filter((entry) => (kinds ? kinds.includes(entry.kind) : entry.kind !== 'source' && entry.kind !== 'credit'))
    .map((entry) => entry.text.replace(/\u00a0/g, ' '));
}
