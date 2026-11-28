import { EN, authoredWordKeys } from './strings';
import { footerParts, shownNoteKinds } from './notes';
import type { BaseOptions } from './types/options';
import type { Geometry, LintWarning } from './types/scene';

/** The longest stretch of a template outside its {fields}, which a drawn line holds when the word is printed. */
function literal(template: string): string {
  return template.split(/\{[^}]*\}/).map((piece) => piece.trim()).sort((a, b) => b.length - a.length)[0] ?? '';
}

/**
 * One warning for a chart in a language without a wording table: the built-in English words that it printed,
 * each with the `strings` key that replaces it. A word counts when its text is in a drawn line. `read` holds the
 * words the layout read through a table; the shared words (Source, Others, Total) are found by their text, because
 * the layout reads them from the filled options.
 */
export function mixedLanguageWarning(
  geo: Pick<Geometry<object, object>, 'scene' | 'frame'>, options: Pick<BaseOptions, 'locale' | 'strings'>, language: string, read: ReadonlyMap<string, string>,
  htmlFooter = false,
): LintWarning | undefined {
  const lines = geo.scene.flatMap((node) => (node.t === 'text' ? node.lines : []));
  const authored = authoredWordKeys(options);
  const found = new Map<string, string>();
  const candidates: [string, string][] = [
    ...read,
    ...Object.entries(EN).filter(([, text]) => !text.includes('{')),
  ];
  for (const [key, template] of candidates) {
    if (authored.has(key) || found.has(key)) continue;
    const word = literal(template);
    if (!/\p{L}{3}/u.test(word) || word.length < 4) continue;
    const printed = template.includes('{') ? lines.some((line) => line.includes(word))
      : lines.some((line) => line === word || line.startsWith(`${word}:`));
    if (printed) found.set(key, word);
  }
  // A React chart draws its notes panel and map credit as HTML, so their words are not in the scene.
  if (htmlFooter) {
    const { credit, panel } = footerParts(geo.frame?.noteList ?? [], geo.frame?.notePlacement, shownNoteKinds(options as Parameters<typeof shownNoteKinds>[0]),
      (options as { footnotes?: unknown }).footnotes !== false && (options as { notes?: { pointer?: boolean } }).notes?.pointer !== false && !geo.frame?.notesButtonOff);
    const html: (keyof typeof EN)[] = [...panel.length > 0 ? ['notesAndSources', 'close', panel.length === 1 ? 'noteOne' : 'noteMany'] as const : [], ...credit ? ['mapCredit' as const] : []];
    for (const key of html) if (!authored.has(key) && !found.has(key)) found.set(key, literal(EN[key]) || EN[key]);
  }
  if (found.size === 0) return undefined;
  const keys = [...found.keys()];
  return {
    code: 'mixed-language', severity: 'warn', field: ['options', 'strings'],
    message: `Chart text for '${language}' includes built-in English wording: ${keys.map((key) => `${found.get(key)} (strings.${key})`).join(', ')}.`,
    suggest: `Set ${keys.map((key) => `options.strings.${key}`).join(', ')} to the words to print.`,
  };
}
