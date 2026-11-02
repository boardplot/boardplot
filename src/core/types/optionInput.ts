import type { SortOrder } from './options';

type ShortOption<K, V> = [NonNullable<V>] extends [never] ? V : K extends 'footnotes' ? V | string
  : K extends 'source' ? V | string[]
  : K extends 'locale' ? V | string
  : K extends 'sort' ? V | ({ categories: 'desc' } extends NonNullable<V> ? SortOrder | true : never)
  : K extends 'topN' ? V | ({ n: number } extends NonNullable<V> ? number : never)
  : V;

type ShortKeys = 'footnotes' | 'source' | 'locale' | 'sort' | 'topN';
type ShortOptions<O> = { [K in keyof O]: ShortOption<K, O[K]> };

/** Public option input. Chart code continues to read the canonical option types. */
export type OptionsInput<O> = O extends unknown
  ? Omit<O, ShortKeys> & ShortOptions<Pick<O, Extract<keyof O, ShortKeys>>>
  : never;
