/**
 * How the CLI and the per-type React entries word an unknown option key
 * how near it is to a key the object takes, and the
 * message and suggest that name that key.
 */
import { toJsonPointer } from '../diagnostics/jsonPatch';
import { editDistance } from '../spelling';
import type { RefusalFinding } from './refusals';
import type { OptionKeyTree, UnknownKey } from './unknownKeys';

/** The keys a tree node names, its wildcards left out. */
export function namedKeys(node: OptionKeyTree): string[] {
  return node === 0 ? [] : Object.keys(node).filter((key) => key !== '*' && key !== '[]');
}

const OPTION_MATCH_MAX_DISTANCE = 0.34;

/** Options whose keys name built-in texts (`strings.hiddenLabels`), not option concepts: a near miss reads only their own name. */
export const WORDING_KEYS: ReadonlySet<string> = new Set(['strings']);

/** Words an author reaches for where the schema has a different key. */
const KEY_SYNONYMS = new Map([['type', 'kind'], ['formula', 'calc']]);

function normalizeOptionTerm(term: string): string {
  let words = term
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length > 1 && (words[0] === 'show' || words[0] === 'data')) words = words.slice(1);
  if (words.length > 1 && words.at(-1) === 'title') words = words.slice(0, -1);
  if (words.join(' ') === 'show values' || words.join(' ') === 'values') words = ['labels'];
  if (words.join(' ') === 'x axis') words = ['category', 'axis'];
  if (words.join(' ') === 'y axis') words = ['value', 'axis'];
  words = words.map((word) => {
    if (word === 'colors' || word === 'colours' || word === 'color' || word === 'colour') return 'palette';
    if (word === 'orientation' || word === 'horizontal' || word === 'vertical') return 'transpose';
    if (word === 'stacked' || word === 'stacking') return 'stack';
    return word;
  });
  return words.join('');
}

function normalizedDistance(a: string, b: string): number {
  if (a === b) return 0;
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : editDistance(a, b) / longest;
}

/** How far two option terms are apart, read as option concepts (showValues, labels) or, when that is closer, as plain spelling with case folded. */
function termDistance(a: string, b: string): number {
  return Math.min(normalizedDistance(normalizeOptionTerm(a), normalizeOptionTerm(b)), normalizedDistance(a.toLowerCase(), b.toLowerCase()));
}

/** The key of `known` closest to `key`, and whether it is close enough to be a typo of it. */
export function closestKey(key: string, known: readonly string[]): { key: string; near: boolean } | undefined {
  const synonym = KEY_SYNONYMS.get(key);
  if (synonym !== undefined && known.includes(synonym)) return { key: synonym, near: true };
  const best = known
    .filter(candidate => candidate !== key)
    .map((candidate) => ({ candidate, distance: termDistance(key, candidate) }))
    .sort((a, b) => a.distance - b.distance || (a.candidate < b.candidate ? -1 : 1))[0];
  return best && { key: best.candidate, near: best.distance <= OPTION_MATCH_MAX_DISTANCE };
}

/**
 * The top-level option a key near-misses, read by its own name first and
 * only then by the words below it (`gridlines` is a typo of nothing at the
 * top, but it names `valueAxis.gridlines`): `terms` lists each top-level key
 * with those words. A word below must not outrank a key's own name, or
 * `tile` would name `a11y`, which holds `a11y.title`, and not `title`.
 */
export function nearestOptionTerm(input: string, terms: Iterable<readonly [string, readonly string[]]>): string | undefined {
  const list = [...terms];
  const rank = (distanceOf: (key: string, words: readonly string[]) => number): string | undefined => {
    let best: { key: string; distance: number } | undefined;
    for (const [key, words] of list) {
      const distance = distanceOf(key, words);
      if (!best || distance < best.distance || (distance === best.distance && key < best.key)) best = { key, distance };
    }
    return best && best.distance <= OPTION_MATCH_MAX_DISTANCE ? best.key : undefined;
  };
  return rank((key) => termDistance(input, key)) ?? rank((_, words) => Math.min(...words.map((word) => termDistance(input, word))));
}

/**
 * The one key of `known` within one edit of `key` once case is folded. Only
 * this match may become a patch: an agent applies a fix without reading it,
 * so a weaker match gets the hint and no patch.
 */
function uniqueTypo(key: string, known: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  const hits = known.filter((candidate) => candidate !== key && editDistance(lower, candidate.toLowerCase()) <= 1);
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * The rename patch for an unknown option key, or none: the near key must be the
 * one typo of the key in `known`, and the object that holds the key must not
 * set it yet. `field` is the key's path from the chart, `parent` the authored object that holds it.
 */
export function typoRenameFix(field: readonly (string | number)[], nearest: { key: string; near: boolean } | undefined, known: readonly string[], parent: unknown): RefusalFinding['fix'] {
  const key = String(field.at(-1));
  const target = nearest?.near ? uniqueTypo(key, known) : undefined;
  if (target === undefined || target !== nearest!.key || parent === null || typeof parent !== 'object' || Object.hasOwn(parent, target)) return undefined;
  return [
    { op: 'remove', path: toJsonPointer(field) },
    { op: 'add', path: toJsonPointer([...field.slice(0, -1), target]), value: (parent as Record<string, unknown>)[key] },
  ];
}

/**
 * Option keys an author writes where the type does not take them, with the
 * place it does: combo states growth under dualAxis, not as a label
 * kind. Named only where the type takes that place.
 */
const MOVED_KEYS: ReadonlyMap<string, string> = new Map([['labels.growth', 'dualAxis.growth'], ['averageMarker', 'annotations'], ['width', 'size.width'], ['height', 'size.height'], ['preset', 'variant']]);

/** Where a refused dotted option path lives instead, when `takes` accepts that place. */
export function movedKey(dotted: string, takes: (path: readonly string[]) => boolean): string | undefined {
  if (dotted === 'averageMarker' && !takes(['categoryAxis', 'crossesBetween'])) return undefined;
  const target = MOVED_KEYS.get(dotted);
  return target !== undefined && takes(target.split('.')) ? target : undefined;
}

export function unknownOptionMessage(dotted: string, nearest: { key: string; near: boolean } | undefined, moved?: string): string {
  if (dotted === 'averageMarker' && moved === 'annotations') return "unknown option 'averageMarker' — use a mean valueLine annotation";
  return `unknown option '${dotted}'${moved ? ` — it is ${moved}` : nearest?.near ? ` — try: ${nearest.key}` : ''}`;
}

export function unknownKeySuggest(key: string, nearest: { key: string; near: boolean } | undefined, moved?: string): string {
  if (key === 'averageMarker' && moved === 'annotations') return "Remove 'averageMarker'; add { kind: 'valueLine', value: 'mean' } to annotations instead.";
  if (moved) return `Remove '${key}' here and set options.${moved} instead.`;
  if (nearest?.near) return `Rename '${key}' to '${nearest.key}'.`;
  return nearest ? `Remove '${key}'; this key is not supported here.` : `Remove '${key}'; this object takes no keys.`;
}

/**
 * The fix when the near key takes the option but not its value (showValues:
 * true is no labels value): a plain rename would trade one refusal for another.
 */
export function valueChangeSuggest(key: string, target: string, labelKinds?: readonly string[]): string {
  if (target === 'labels') {
    return `Remove '${key}': without it the chart prints its default labels. Set labels to false to hide them${labelKinds?.length ? `, or to an object that sets label kinds (${labelKinds.join(', ')}) to true or false` : ''}.`;
  }
  return `Remove '${key}' and set '${target}' instead, with one of the values its docs list.`;
}

/**
 * Each key a node names with the words below it, through objects and
 * arrays but not into id-keyed maps: the words the CLI reads off a schema.
 */
function termsOf(node: OptionKeyTree): [string, string[]][] {
  if (node === 0) return [];
  const below = (child: OptionKeyTree): string[] => termsOf(child).flatMap(([, words]) => words);
  return namedKeys(node).map((key) => {
    const child = node[key]!;
    if (WORDING_KEYS.has(key)) return [key, [key]];
    return [key, [key, ...below(child), ...(child !== 0 && child['[]'] ? below(child['[]']) : [])]];
  });
}

/** Whether a key tree takes an option path. */
function treeTakes(tree: OptionKeyTree, path: readonly string[]): boolean {
  let node: OptionKeyTree | undefined = tree;
  for (const key of path) {
    if (node === 0) return true;
    node = namedKeys(node).includes(key) ? node[key] : node['*'];
    if (node === undefined) return false;
  }
  return true;
}

/** The refusal for each unknown key, worded as the CLI words it. */
export function wordUnknownKeys(found: readonly UnknownKey[], tree?: OptionKeyTree): RefusalFinding[] {
  return found.map(({ path, node, parent }) => {
    const key = String(path.at(-1));
    // At the top the near miss also reads the words below each option (gridlines -> valueAxis).
    const top = path.length === 1 ? nearestOptionTerm(key, termsOf(node)) : undefined;
    const nearest = top ? { key: top, near: true } : closestKey(key, namedKeys(node));
    const dotted = path.join('.');
    const moved = tree === undefined ? undefined : movedKey(dotted, (target) => treeTakes(tree, target));
    const fix = moved === undefined ? typoRenameFix(['options', ...path], nearest, namedKeys(node), parent) : undefined;
    return { code: 'unknown-option', message: unknownOptionMessage(dotted, nearest, moved), path: `options.${dotted}`, suggest: unknownKeySuggest(key, nearest, moved), ...(fix ? { fix } : {}) };
  });
}
