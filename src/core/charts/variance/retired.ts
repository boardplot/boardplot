import type { RetiredSetting } from '../../retired';

/** The retired settings of variance: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.variance.mode', to: 'options.variant' },
  { at: 'options.topN.showRestCount', use: 'A variance chart draws no rest bucket, so it has no count to print.' },
];
