import type { RetiredSetting } from '../../retired';

/** The retired settings of cohort: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.exhibitStyle', to: 'options.variant' },
];
