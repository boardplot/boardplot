import { accessibleTitle } from './normalize/shared';
import { wordLanguage } from './numberMarks';
import { chartString } from './strings/layoutGrid';
import type { StructureCount } from './structureCounts';
import type { BaseOptions } from './types/options';
import type { Geometry } from './types/scene';

type DescriptionMetadata = Omit<Geometry['a11y'], 'title' | 'desc'>;

/** Give each chart a name and a short description of its structure. */
export function a11yDescription(
  options: Pick<BaseOptions, 'title' | 'locale' | 'strings'>,
  typeName: string | readonly [english: string, german: string],
  summary?: StructureCount[] | false,
  metadata: DescriptionMetadata = {},
): Geometry['a11y'] {
  const localized = typeof typeName === 'string' ? typeName : typeName[/^de(?:[-_]|$)/i.test(wordLanguage(options.locale?.language) ?? '') ? 1 : 0];
  const name = localized.charAt(0).toUpperCase() + localized.slice(1);
  const desc = summary === false ? '' : `${[name, ...(summary ?? []).map(count => count.text)].join(', ')}.`;
  const notes = metadata.compactNotes?.length
    ? chartString(options, 'notesClause', { v1: metadata.compactNotes.join('; ') })
    : '';
  return {
    title: accessibleTitle(options.title, name),
    desc: desc + notes,
    ...(summary ? { counts: summary } : {}),
    ...metadata,
  };
}
