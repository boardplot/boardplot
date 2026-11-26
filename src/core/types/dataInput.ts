import type { Id } from './cell';
import type { ChartData } from './data';

type SeriesInput<S extends ChartData['series'][number]> = S extends unknown
  ? Omit<S, 'values'> & { values: S['values'] | { categoryId: Id; value: S['values'][number] }[] }
  : never;

/** Authored category data accepts category ids and values keyed by category id. */
export type DataInput<D> = D extends ChartData
  ? Omit<D, 'categories' | 'series'> & {
    categories: (D['categories'][number] | string)[];
    series: SeriesInput<D['series'][number]>[];
  }
  : D;
