import type { RetiredSetting } from '../../retired';

/** The retired settings of table: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.preset', to: 'options.variant', values: { plain: 'hierarchy', steering: 'steering', benchmark: 'benchmark', status: 'status', receipts: 'receipts', hierarchy: 'hierarchy' } },
  // A table row nests through children: the key is retired on the rows of the first eight levels.
  { at: [
    'data.columns.[].fitFormat',
    'data.rows.[].fitFormat',
    'data.rows.[].children.[].fitFormat',
    'data.rows.[].children.[].children.[].fitFormat',
    'data.rows.[].children.[].children.[].children.[].fitFormat',
    'data.rows.[].children.[].children.[].children.[].children.[].fitFormat',
    'data.rows.[].children.[].children.[].children.[].children.[].children.[].fitFormat',
    'data.rows.[].children.[].children.[].children.[].children.[].children.[].children.[].fitFormat',
    'data.rows.[].children.[].children.[].children.[].children.[].children.[].children.[].children.[].fitFormat',
  ], use: 'No format is fitted to a width any more.' },
];
