import { EN, authoredWordKeys } from './strings';
import { footerParts, shownNoteKinds, sourceLine } from './notes';
import type { BaseOptions } from './types/options';
import type { Geometry, LintWarning } from './types/scene';

/** The longest stretch of a template outside its {fields}, which a drawn line holds when the word is printed. */
function literal(template: string): string {
  return template.split(/\{[^}]*\}/).map((piece) => piece.trim()).sort((a, b) => b.length - a.length)[0] ?? '';
}

/** Every text the author wrote in the data and the options, except the `strings` block: a drawn line equal to one of them is the author's own text. */
function authoredTexts(value: unknown, into = new Set<string>(), key = ''): Set<string> {
  if (typeof value === 'string') into.add(value.trim());
  else if (Array.isArray(value)) for (const item of value) authoredTexts(item, into);
  else if (value !== null && typeof value === 'object' && key !== 'strings') {
    for (const [name, item] of Object.entries(value)) authoredTexts(item, into, name);
  }
  return into;
}

/** Whether `line` holds `word` as a whole word. */
function holds(line: string, word: string): boolean {
  const at = line.indexOf(word);
  if (at < 0) return false;
  const before = line[at - 1];
  const after = line[at + word.length];
  return !(before && /[\p{L}\p{N}]/u.test(before)) && !(after && /[\p{L}\p{N}]/u.test(after));
}

/**
 * One warning for a chart in a language without a wording table: the built-in English words that it printed,
 * each with the `strings` key that replaces it. A word counts when its text is in a drawn line that the author
 * did not write. `read` holds the words the layout read through a table; the shared words (Source, Others, Total)
 * are found by their text, because the layout reads them from the filled options. `htmlFooter` adds the words of the
 * notes panel and map credit that a React chart draws as HTML.
 */
export function mixedLanguageWarning(
  geo: Pick<Geometry<object, object>, 'scene' | 'frame'>, options: Pick<BaseOptions, 'locale' | 'strings'> & { source?: unknown }, data: unknown,
  language: string, read: ReadonlyMap<string, string>, htmlFooter = false,
): LintWarning | undefined {
  const written = authoredTexts([data, options]);
  const lines = geo.scene.flatMap((node) => (node.t === 'text' ? node.lines : [])).filter((line) => !written.has(line.trim()));
  const authored = authoredWordKeys(options);
  const found = new Map<string, string>();
  const source = typeof options.source === 'string' ? options.source : undefined;
  const candidates: [string, string][] = [...read, ...Object.entries(EN).filter(([, text]) => !text.includes('{'))];
  for (const [key, template] of candidates) {
    if (authored.has(key) || found.has(key)) continue;
    const word = literal(template);
    if (word.length < 3 || !/\p{L}{3}/u.test(word)) continue;
    // A source the author wrote with its own prefix ("Source: INSEE") prints no built-in word.
    if (key === 'source' && (source === undefined || sourceLine(source, word) === source)) continue;
    if (lines.some((line) => holds(line, word))) found.set(key, word);
  }
  // A React chart draws its notes panel and map credit as HTML, so their words are not in the scene.
  if (htmlFooter) {
    const { info, credit, panel } = footerParts(geo.frame?.noteList ?? [], geo.frame?.notePlacement, shownNoteKinds(options as Parameters<typeof shownNoteKinds>[0]),
      (options as { footnotes?: unknown }).footnotes !== false && (options as { notes?: { pointer?: boolean } }).notes?.pointer !== false && !geo.frame?.notesButtonOff);
    const html: (keyof typeof EN)[] = [
      ...panel.length > 0 ? ['notesAndSources' as const, 'close' as const, ...info ? [] : [panel.length === 1 ? 'noteOne' as const : 'noteMany' as const]] : [],
      ...credit ? ['mapCredit' as const] : [],
    ];
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
