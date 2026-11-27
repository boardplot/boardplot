import type { RetiredSetting } from '../../retired';

/** The retired settings of butterfly: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.sort.segments', use: 'A butterfly has no stacked segments. sort.categories orders the rows.' },
];
