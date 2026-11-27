import type { RetiredSetting } from '../../retired';

/** The retired settings of grid: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.share', to: 'options.sharedAxis', values: { categories: 'category', none: 'none' } },
  { at: ['options.gap', 'options.gutterWidth', 'options.showMaturing', 'options.totalPanel'] },
  { at: 'options.format', use: 'Set the format on each panel.' },
];
