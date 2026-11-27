import type { RetiredSetting } from '../../retired';

/** The retired settings of treemap: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.order', values: { data: 'sheet' } },
  { at: 'options.shape', to: 'options.variant' },
];
