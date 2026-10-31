/**
 * The unknown-key walk of the per-type React entries: authored
 * options over the key tree generated from the type's options schema
 * (scripts/generate-chart-entries.mjs). Each generated entry links it and
 * hands its check to the component, so nothing else, react/spec included,
 * carries it. The nearest key and the sentences the CLI prints live in
 * unknownKeyWords.ts.
 */
import type { RefusalFinding } from './refusals';
import { readerStrings } from '../readerStrings';
import { namedKeys, wordUnknownKeys } from './unknownKeyWords';

/**
 * The option keys a type takes. 0 takes any value. An object takes the keys
 * it names; '*' stands for any key (a map keyed by ids) and '[]' for the
 * items of an array. Union branches are merged, so a key one branch declares
 * is taken.
 */
export type OptionKeyTree = 0 | { readonly [key: string]: OptionKeyTree };

/** What a per-type React entry checks its option props against. */
export interface OptionKeys {
  tree: OptionKeyTree;
  /** The kinds the type's `labels` map takes (LABEL_KINDS). */
  labels?: readonly string[];
}

/** An authored key the tree does not take: its path, and the tree node of the object it sits in. */
export interface UnknownKey {
  path: (string | number)[];
  node: OptionKeyTree;
  /** The authored object that holds the key. */
  parent?: Record<string, unknown>;
}

/**
 * A component's key check: the refusals for the unknown keys of authored
 * options, and of the strings a BoardplotTheme provider hands every chart.
 */
export type OptionKeyCheck = (options: Record<string, unknown>, providerStrings?: Record<string, unknown>) => RefusalFinding[];

/**
 * Every authored option key `keys` does not take, at any depth. `measure` is
 * the TS-only text measurer a host hands any chart (BaseOptions) and passes.
 */
export function unknownKeys(options: Record<string, unknown>, keys: OptionKeys): UnknownKey[] {
  const found: UnknownKey[] = [];
  const walk = (value: unknown, node: OptionKeyTree, path: (string | number)[]): void => {
    if (node === 0 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const items = node['[]'];
      if (items !== undefined) value.forEach((item, index) => walk(item, items, [...path, index]));
      return;
    }
    const known = namedKeys(node);
    // A node that only takes an array: an object here is a value the layout refuses, not an unknown key.
    if (known.length === 0 && node['*'] === undefined && node['[]'] !== undefined) return;
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined || (path.length === 0 && key === 'measure')) continue;
      let next = known.includes(key) ? node[key] : node['*'];
      // The labels map takes the kinds the type's layout reads, as the CLI checks it.
      if (path.length === 0 && key === 'labels' && keys.labels && next !== undefined) {
        const map = next;
        next = Object.fromEntries(keys.labels.map((kind) => [kind, map === 0 ? 0 : map[kind] ?? map['*'] ?? 0]));
      }
      if (next === undefined) found.push({ path: [...path, key], node, parent: value as Record<string, unknown> });
      else walk(child, next, [...path, key]);
    }
  };
  walk(options, keys.tree, []);
  return found;
}

/** The provider strings no chart option takes: the reader copy and the loading word (BoardplotStrings). */
const PROVIDER_ONLY_STRINGS = Object.fromEntries([...Object.keys(readerStrings()), 'loading'].map((key) => [key, 0 as const]));

/**
 * The check a generated entry hands its component. A provider string is
 * checked against the chart strings plus the provider-only keys; its finding
 * names the provider, and a JSON patch has nothing to remove there.
 */
export function optionKeyCheck(keys: OptionKeys): OptionKeyCheck {
  return (options, providerStrings) => {
    const strings = keys.tree === 0 ? undefined : keys.tree.strings;
    const provider = providerStrings && strings !== undefined && strings !== 0
      ? unknownKeys({ strings: providerStrings }, { tree: { strings: { ...strings, ...PROVIDER_ONLY_STRINGS } } }) : [];
    return [
      ...wordUnknownKeys(unknownKeys(options, keys), keys.tree),
      ...wordUnknownKeys(provider, keys.tree)
        .map(({ fix: _fix, ...finding }) => ({ ...finding, path: `BoardplotTheme.${finding.path.replace(/^options\./, '')}` })),
    ];
  };
}
