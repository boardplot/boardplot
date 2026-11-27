import type { RetiredSetting } from '../../retired';

/** The retired settings of table: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.preset', to: 'options.variant', values: { plain: 'hierarchy', steering: 'steering', benchmark: 'benchmark', status: 'status', receipts: 'receipts', hierarchy: 'hierarchy' } },
  ...['data.columns.[].fitFormat', ...Array.from({ length: 8 }, (_, depth) => `data.rows.[].${'children.[].'.repeat(depth)}fitFormat`)].map((at) => ({ at, use: 'No format is fitted to a width any more.' })),
];
