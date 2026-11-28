import type { RetiredSetting } from '../../retired';

/** The retired settings of waffle: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.cellNote' },
  { at: 'options.fillMode', to: 'options.variant' },
];
