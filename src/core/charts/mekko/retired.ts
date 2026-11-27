import type { RetiredSetting } from '../../retired';

/** The retired settings of mekko: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.mode', to: 'options.variant', values: { percent: 'stacked100', unit: 'stacked', bar: 'bar' } },
];
